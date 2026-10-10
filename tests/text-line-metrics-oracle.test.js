// Phase 4 oracle: engine/dw3/ui/text-line-metrics.ts must leave memory exactly
// as F0x8001A2AC does. The resident image runs through engine/native as the
// oracle (widget A); the port runs on a twin widget B with a matching bump heap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { textLineMetrics } from "../engine/dw3/ui/text-line-metrics.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF_A = 0x80188000;
const SELF_B = 0x80190000;
const BUF_A = 0x80180000;
const BUF_B = 0x80181000;
const FONT = 0x80151000;
const HEAP = 0x80198000;
const NAME = 0x80048d88;
let heap = HEAP;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write16(FONT + 0x14, 0x20); // basic limit
    rt.mem.write16(FONT + 0x16, 3);    // ext count
    // Convert-mode lookup tables: empty, terminated at once (0xFFFF).
    rt.mem.write32(FONT + 0x0c, FONT + 0x100);
    rt.mem.write32(FONT + 0x10, FONT + 0x100);
    rt.mem.write16(FONT + 0x100, 0xffff);
    rt.mem.write16(FONT + 0x110, 0xffff); // table A is read from +0x10
    for (const [i, ch] of [..."AGUMON\0"].entries()) rt.mem.write8(NAME + i, ch.charCodeAt(0));
    return rt;
}

function setup(rt, self, buf, bytes, flag, lines = {}) {
    for (let i = 0; i < 0x200; i += 4) rt.mem.write32(self + i, 0);
    rt.mem.write32(self + 0x50, FONT);
    for (let i = 0; i < 0x40; i++) rt.mem.write8(buf + i, 0);
    for (let i = 0; i < bytes.length; i++) rt.mem.write8(buf + i, bytes[i]);
    rt.mem.write32(self + 0x5c, buf);
    rt.mem.write16(self + 0x62, bytes.length);
    rt.mem.write16(self + 0x66, flag);
    for (const [n, f] of Object.entries(lines)) rt.mem.write16(self + 0x66 + n * 12, f);
}

const portHost = (rt) => ({
    alloc(size) {
        const n = ((size >>> 0) + 0xf) & ~0xf;
        const p = heap;
        heap += n;
        for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
        return p;
    },
    free() {},
});

// Widget words (buffer pointers masked, they differ between the twins) plus
// every line buffer's contents up to its capacity.
function snapshot(rt, self) {
    const out = [];
    for (let a = 0x50; a < 0x100; a += 2) {
        const rel = a - 0x5c;
        const isPtr = rel >= 0 && rel < 6 * 12 && rel % 12 < 4;
        out.push(isPtr ? 0 : rt.mem.read16(self + a));
    }
    for (let n = 0; n < 6; n++) {
        const p = rt.mem.read32(self + 0x5c + n * 12) >>> 0;
        out.push(p === 0 ? -1 : -2);
        if (p !== 0) {
            const cap = rt.mem.read16(self + 0x5c + n * 12 + 4);
            for (let i = 0; i < Math.min(cap, 0x40); i++) out.push(rt.mem.read8(p + i));
        }
    }
    return out;
}

function run(rt, label) {
    rt.cpu.call(0x8001a2ac, [SELF_A]);
    textLineMetrics(rt.mem, portHost(rt), SELF_B);
    assert.deepEqual(snapshot(rt, SELF_B), snapshot(rt, SELF_A), label);
}

function both(label, bytes, flag = 0, lines = {}) {
    const rt = runtime();
    heap = HEAP;
    setup(rt, SELF_A, BUF_A, bytes, flag, lines);
    setup(rt, SELF_B, BUF_B, bytes, flag, lines);
    run(rt, label);
    return rt;
}

test("arm 0 basic glyphs and arm 3 invalid glyphs step one byte", () => {
    both("basic", [4, 5, 6, 0]);
    both("invalid then basic", [3, 0, 7, 0]);
    both("basic past the limit is invalid", [0x30, 5, 0]);
});

test("arm 0 and 3 step two bytes when line 0 is in convert mode", () => {
    both("convert basic", [4, 5, 6, 7, 0], 1);
    both("convert pair", [2, 1, 9, 9, 0], 1);
});

test("arm 1 extended glyph steps two bytes", () => {
    both("ext", [1, 1, 4, 1, 2, 0]);
    both("ext clamp", [1, 9, 4, 0]);
});

test("arm 2 control tokens advance by the operand table", () => {
    for (const op of [0, 1, 2, 3, 5, 6, 7, 9]) both(`op ${op}`, [4, 2, op, 1, 4, 0]);
});

test("arm 2 operand 8 installs the player name on line n and clears its flag", () => {
    for (const n of [1, 2, 5]) {
        const rt = both(`op8 line ${n}`, [4, 2, 8, n, 4, 0], 0, { [n]: 7 });
        assert.equal(rt.mem.read16(SELF_A + 0x66 + n * 12), 0);
        assert.equal(rt.mem.read16(SELF_B + 0x66 + n * 12), 0);
    }
    both("op8 line 0 replaces line 0", [4, 2, 8, 0, 4, 0]);
    both("op8 index out of range", [4, 2, 8, 7, 4, 0]);
    both("op8 twice (buffer reuse)", [2, 8, 2, 4, 2, 8, 2, 4, 0]);
});

test("arm 4 end token stops the walk before the length", () => {
    both("end mid-buffer", [4, 0, 2, 8, 1, 4, 5]);
});

test("guards: empty text, null buffer, non-positive length", () => {
    both("empty text", [0]);
    both("zero length", []);
    const rt = runtime();
    heap = HEAP;
    setup(rt, SELF_A, BUF_A, [4, 0], 0);
    setup(rt, SELF_B, BUF_B, [4, 0], 0);
    rt.mem.write32(SELF_A + 0x5c, 0);
    rt.mem.write32(SELF_B + 0x5c, 0);
    run(rt, "null buffer");
    setup(rt, SELF_A, BUF_A, [4, 2, 8, 1, 0], 0);
    setup(rt, SELF_B, BUF_B, [4, 2, 8, 1, 0], 0);
    rt.mem.write16(SELF_A + 0x62, 0xffff);
    rt.mem.write16(SELF_B + 0x62, 0xffff);
    run(rt, "negative length");
});
