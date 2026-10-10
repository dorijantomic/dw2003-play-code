// Phase 4 oracle: engine/dw3/ui/text-widget-resource.ts
// widgetSetLineFromSource (F0x800196E4, slot +0x120) and
// widgetSetLine0FromSource (F0x800194E8, slot +0x114) must match the original
// resident code. The original runs through engine/native with the shared
// text-service block F0x8001FCC0 stubbed to install a deterministic lookup;
// the port gets the same lookup as a callback. widgetSetLineString (F0x80019370)
// is the real translated callee on both sides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    LINE_BUFFER,
    LINE_CAPACITY,
    LINE_FLAG,
    LINE_LENGTH,
    LINE_RECORD_BASE,
    LINE_RECORD_STRIDE,
} from "../engine/dw3/ui/text-widget-line.ts";
import {
    LINE_FLAG_WORD,
    widgetSetLine0FromSource,
    widgetSetLineFromSource,
} from "../engine/dw3/ui/text-widget-resource.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF_A = 0x80188000;
const SELF_B = 0x8018a000;
const GETTER_STUB = 0x0fd40000;
const STR_BASE = 0x80186000;
const STR_STRIDE = 0x40;
const STR_EMPTY = STR_BASE + 4 * STR_STRIDE;
const STR_DIRECT = STR_BASE + 0x200;
let PORT_HEAP = 0x8019a000;

/** Deterministic shared lookup: index 3 misses, index 4 is the empty string. */
function stringById(_source, index) {
    if (index < 0 || index > 9) return 0;
    if (index === 3) return 0;
    return STR_BASE + index * STR_STRIDE;
}

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function writeString(rt, addr, s) {
    for (let i = 0; i < 0x40; i++) rt.mem.write8(addr + i, 0);
    for (let i = 0; i < s.length; i++) rt.mem.write8(addr + i, s.charCodeAt(i));
    return addr;
}

function seedStrings(rt) {
    writeString(rt, STR_BASE + 0 * STR_STRIDE, "Potion");
    writeString(rt, STR_BASE + 1 * STR_STRIDE, "DigiEgg");
    writeString(rt, STR_BASE + 2 * STR_STRIDE, "Omnimon");
    writeString(rt, STR_BASE + 3 * STR_STRIDE, "unreachable");
    writeString(rt, STR_EMPTY, "");
    writeString(rt, STR_DIRECT, "Direct");
}

function initSelf(rt, self) {
    for (let i = 0; i < 0x200; i += 4) rt.mem.write32(self + i, 0);
    rt.mem.write16(self + 0x62, 0x1234);
    rt.mem.write8(self + 0xc1, 0xee);
    rt.mem.write16(self + 0xaa, 0);
    for (let line = 0; line < 6; line++) {
        const rec = self + LINE_RECORD_BASE + line * LINE_RECORD_STRIDE;
        rt.mem.write32(rec + LINE_BUFFER, 0);
        rt.mem.write16(rec + LINE_CAPACITY, 0);
        rt.mem.write16(rec + LINE_LENGTH, 0);
        rt.mem.write16(rec + LINE_FLAG, 0);
        rt.mem.write16(self + line * LINE_RECORD_STRIDE + LINE_FLAG_WORD, 0x7fff);
    }
}

function bytes(rt, addr, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rt.mem.read8(addr + i));
    return out;
}

function state(rt, self) {
    const out = {
        c1: rt.mem.read8(self + 0xc1),
        a4: rt.mem.read16(self + 0xa4),
        a6: rt.mem.read16(self + 0xa6),
        a8: rt.mem.read16(self + 0xa8),
        aa: rt.mem.read16(self + 0xaa),
    };
    for (let line = 0; line < 6; line++) {
        const rec = self + LINE_RECORD_BASE + line * LINE_RECORD_STRIDE;
        const buf = rt.mem.read32(rec + LINE_BUFFER) >>> 0;
        const cap = rt.mem.read16(rec + LINE_CAPACITY) & 0xffff;
        out[`len${line}`] = rt.mem.read16(rec + LINE_LENGTH) & 0xffff;
        out[`flag${line}`] = rt.mem.read16(rec + LINE_FLAG) & 0xffff;
        out[`cap${line}`] = cap;
        out[`word${line}`] = rt.mem.read16(self + line * LINE_RECORD_STRIDE + LINE_FLAG_WORD) & 0xffff;
        out[`null${line}`] = buf === 0;
        out[`bytes${line}`] = buf === 0 ? null : bytes(rt, buf, cap);
    }
    return out;
}

function portHost() {
    return {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = PORT_HEAP;
            PORT_HEAP += n;
            return p;
        },
        free() {},
        stringById,
    };
}

function runOriginal(rt, fn, self, args) {
    rt.cpu.setStub(0x8001fcc0, (c) => {
        rt.mem.write32(c.reg(4) >>> 0, GETTER_STUB);
        return 0;
    });
    rt.cpu.setStub(GETTER_STUB, (c) => stringById(c.reg(4) >>> 0, c.reg(5) | 0));
    rt.cpu.call(fn, [self, ...args]);
}

const CASES = [
    { name: "line0 via resource index 0", fn: 0x800194e8, port: "line0", args: [0x1234, 0] },
    { name: "line0 via resource index 2", fn: 0x800194e8, port: "line0", args: [0x1234, 2] },
    { name: "line3 via resource index 1", fn: 0x800196e4, port: "line", args: [0x1234, 1, 3] },
    { name: "line0 direct literal (index -1)", fn: 0x800194e8, port: "line0", args: [STR_DIRECT, -1] },
    { name: "miss (lookup returns 0) is a no-op", fn: 0x800194e8, port: "line0", args: [0x1234, 3] },
    { name: "empty string installs an empty line", fn: 0x800194e8, port: "line0", args: [0x1234, 4] },
    { name: "line5 via resource index 9", fn: 0x800196e4, port: "line", args: [0x1234, 9, 5] },
    { name: "line5 direct literal", fn: 0x800196e4, port: "line", args: [STR_DIRECT, -1, 5] },
];

test("resource line setters match F0x800194E8 / F0x800196E4", () => {
    const rt = runtime();
    seedStrings(rt);
    for (const c of CASES) {
        initSelf(rt, SELF_A);
        initSelf(rt, SELF_B);
        PORT_HEAP = 0x8019a000;
        const hostB = portHost();

        runOriginal(rt, c.fn, SELF_A, c.args);
        if (c.port === "line0") {
            widgetSetLine0FromSource(rt.mem, hostB, SELF_B, c.args[0], c.args[1]);
        } else {
            widgetSetLineFromSource(rt.mem, hostB, SELF_B, c.args[0], c.args[1], c.args[2]);
        }

        assert.deepEqual(state(rt, SELF_B), state(rt, SELF_A), c.name);
    }
});

test("sanity: the original actually installs a line (guards a silent no-op oracle)", () => {
    const rt = runtime();
    seedStrings(rt);
    initSelf(rt, SELF_A);
    runOriginal(rt, 0x800194e8, SELF_A, [0x1234, 0]);
    const rec = SELF_A + LINE_RECORD_BASE;
    assert.equal(rt.mem.read16(rec + LINE_LENGTH) & 0xffff, 6, "installed length");
    const buf = rt.mem.read32(rec + LINE_BUFFER) >>> 0;
    assert.notEqual(buf, 0, "allocated buffer");
    assert.equal(rt.mem.read8(buf), "P".charCodeAt(0), "first byte");
});
