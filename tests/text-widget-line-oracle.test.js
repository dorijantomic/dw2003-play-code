// Phase 4 oracle: engine/dw3/ui/text-widget-line.ts widgetSetLineString must
// match the original F0x80019370 on the line-record fields, the widget flags
// and the copied string. The resident image runs through engine/native as the
// oracle; its allocator is the host bump arena, the port gets a matching bump.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    DEFAULT_LINE_STRING,
    LINE_BUFFER,
    LINE_CAPACITY,
    LINE_FLAG,
    LINE_LENGTH,
    LINE_RECORD_BASE,
    setWidgetString as setWidgetStringForTest,
    setWidgetStringIndexed,
    widgetSetLineNumber,
    widgetSetLineString,
} from "../engine/dw3/ui/text-widget-line.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF_A = 0x80188000;
const SELF_B = 0x80190000;
const STR = 0x80180000;
let PORT_HEAP = 0x80198000;

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function initSelf(rt, self) {
    for (let i = 0; i < 0x200; i += 4) rt.mem.write32(self + i, 0);
    rt.mem.write16(self + 0x62, 0x1234);
    const line = self + LINE_RECORD_BASE;
    rt.mem.write32(line + LINE_BUFFER, 0);
    rt.mem.write16(line + LINE_CAPACITY, 0);
    rt.mem.write16(line + LINE_LENGTH, 0);
    rt.mem.write16(line + LINE_FLAG, 0);
    rt.mem.write8(self + 0xc1, 0xee);
    rt.mem.write16(self + 0xaa, 0);
}

function writeString(rt, s) {
    for (let i = 0; i < 0x80; i++) rt.mem.write8(STR + i, 0x41);
    for (let i = 0; i < s.length; i++) rt.mem.write8(STR + i, s.charCodeAt(i));
    rt.mem.write8(STR + s.length, 0);
    return STR;
}

function fields(rt, self) {
    const line = self + LINE_RECORD_BASE;
    return {
        buffer: rt.mem.read32(line + LINE_BUFFER) >>> 0,
        capacity: rt.mem.read16(line + LINE_CAPACITY) & 0xffff,
        length: rt.mem.read16(line + LINE_LENGTH) & 0xffff,
        flag: rt.mem.read16(line + LINE_FLAG) & 0xffff,
        c1: rt.mem.read8(self + 0xc1),
        a4: rt.mem.read16(self + 0xa4) & 0xffff,
        a6: rt.mem.read16(self + 0xa6) & 0xffff,
        a8: rt.mem.read16(self + 0xa8) & 0xffff,
        aa: rt.mem.read16(self + 0xaa) & 0xffff,
    };
}


const COMPARE_FIELDS = ["capacity", "length", "flag", "c1", "a4", "a6", "a8", "aa"];

function newPortHost(rt) {
    return {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = PORT_HEAP;
            PORT_HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
        free() {},
    };
}

function compare(label, rt) {
    const fa = fields(rt, SELF_A);
    const fb = fields(rt, SELF_B);
    for (const k of COMPARE_FIELDS) assert.equal(fb[k], fa[k], `${label} ${k} (a=${fa[k]} b=${fb[k]})`);
    if (fa.buffer === 0 || fb.buffer === 0) {
        assert.equal(fb.buffer === 0, fa.buffer === 0, `${label} buffer nullity`);
        return;
    }
    assert.equal(fb.capacity, fa.capacity, `${label} capacity`);
    for (let i = 0; i < fa.capacity; i++) {
        assert.equal(rt.mem.read8(fb.buffer + i), rt.mem.read8(fa.buffer + i), `${label} byte ${i}`);
    }
}

test("widgetSetLineString matches the interpreter across lengths", () => {
    const rt = runtime();
    for (const s of ["", "a", "hello", "Digimon World 2003", "x".repeat(20), "y".repeat(64)]) {
        initSelf(rt, SELF_A);
        initSelf(rt, SELF_B);
        PORT_HEAP = 0x80198000;
        const cstr = writeString(rt, s);
        const hostB = newPortHost(rt);
        rt.cpu.call(0x80019370, [SELF_A, SELF_A + LINE_RECORD_BASE, cstr]);
        widgetSetLineString(rt.mem, hostB, SELF_B, SELF_B + LINE_RECORD_BASE, cstr);
        compare(`len ${s.length}`, rt);
    }
});

test("widgetSetLineString keeps a big enough buffer then reallocates like the interpreter", () => {
    const rt = runtime();
    initSelf(rt, SELF_A);
    initSelf(rt, SELF_B);
    PORT_HEAP = 0x80198000;
    const hostB = newPortHost(rt);
    for (const s of ["hello", "ab", "x".repeat(20), "z".repeat(4), "y".repeat(64)]) {
        const cstr = writeString(rt, s);
        rt.cpu.call(0x80019370, [SELF_A, SELF_A + LINE_RECORD_BASE, cstr]);
        widgetSetLineString(rt.mem, hostB, SELF_B, SELF_B + LINE_RECORD_BASE, cstr);
        compare(`seq ${s.length}`, rt);
    }
});

test("widgetSetLineString NULL cString replaces it with the default literal", () => {
    const rt = runtime();
    initSelf(rt, SELF_A);
    initSelf(rt, SELF_B);
    PORT_HEAP = 0x80198000;
    const hostB = newPortHost(rt);
    rt.cpu.call(0x80019370, [SELF_A, SELF_A + LINE_RECORD_BASE, 0]);
    widgetSetLineString(rt.mem, hostB, SELF_B, SELF_B + LINE_RECORD_BASE, 0);
    compare("null", rt);
    // Both sides took the same branch, so the default literal's length decides.
    assert.equal(rt.mem.read16(SELF_A + LINE_RECORD_BASE + LINE_LENGTH), rt.mem.read16(SELF_B + LINE_RECORD_BASE + LINE_LENGTH));
});

test("setWidgetString matches the interpreter (F0x800194C4)", () => {
    const rt = runtime();
    for (const s of ["", "buy", "Potion x3"]) {
        initSelf(rt, SELF_A);
        initSelf(rt, SELF_B);
        PORT_HEAP = 0x80198000;
        const cstr = writeString(rt, s);
        const hostB = newPortHost(rt);
        rt.cpu.call(0x800194c4, [SELF_A, cstr]);
        setWidgetStringForTest(rt.mem, hostB, SELF_B, cstr);
        compare(`setWidgetString len ${s.length}`, rt);
    }
});

function lineFields(rt, self, idx) {
    const line = self + LINE_RECORD_BASE + idx * 0x0c;
    return {
        capacity: rt.mem.read16(line + LINE_CAPACITY) & 0xffff,
        length: rt.mem.read16(line + LINE_LENGTH) & 0xffff,
        flag: rt.mem.read16(line + LINE_FLAG) & 0xffff,
    };
}

function compareLine(label, rt, idx) {
    const fa = lineFields(rt, SELF_A, idx);
    const fb = lineFields(rt, SELF_B, idx);
    assert.deepEqual(fb, fa, `${label} line ${idx}`);
    const lineA = SELF_A + LINE_RECORD_BASE + idx * 0x0c;
    const lineB = SELF_B + LINE_RECORD_BASE + idx * 0x0c;
    const bufA = rt.mem.read32(lineA + LINE_BUFFER) >>> 0;
    const bufB = rt.mem.read32(lineB + LINE_BUFFER) >>> 0;
    assert.equal(bufB === 0, bufA === 0, `${label} line ${idx} buffer nullity`);
    if (bufA !== 0 && bufB !== 0) {
        for (let i = 0; i < fa.capacity; i++) {
            assert.equal(rt.mem.read8(bufB + i), rt.mem.read8(bufA + i), `${label} line ${idx} byte ${i}`);
        }
    }
}

test("widgetSetLineNumber matches the interpreter (F0x800195B0)", () => {
    const rt = runtime();
    const SCRATCH_B = 0x801a0000;
    for (const idx of [0, 1, 5, 6, 7]) {
        for (const value of [0, 7, 123, 9999]) {
            initSelf(rt, SELF_A);
            initSelf(rt, SELF_B);
            PORT_HEAP = 0x80198000;
            const hostB = newPortHost(rt);
            rt.cpu.call(0x800195b0, [SELF_A, idx, value]);
            widgetSetLineNumber(rt.mem, hostB, SELF_B, idx, value, SCRATCH_B);
            const affected = idx < 6 ? idx : 0;
            compareLine(`num idx=${idx} v=${value}`, rt, affected);
            const fa = fields(rt, SELF_A);
            const fb = fields(rt, SELF_B);
            for (const k of ["c1", "a4", "a6", "a8", "aa"]) {
                assert.equal(fb[k], fa[k], `num idx=${idx} v=${value} ${k}`);
            }
        }
    }
});

test("setWidgetStringIndexed matches F0x8001968C on every index", () => {
    const rt = runtime();
    for (const index of [0, 1, 2, 5, 6, 7, 0xff]) {
        for (const s of ["hi", "Digimon", "x".repeat(40)]) {
            initSelf(rt, SELF_A);
            initSelf(rt, SELF_B);
            PORT_HEAP = 0x80198000;
            const cstr = writeString(rt, s);
            const hostB = newPortHost(rt);
            rt.cpu.call(0x8001968c, [SELF_A, cstr, index]);
            setWidgetStringIndexed(rt.mem, hostB, SELF_B, cstr, index);
            const affected = index >= 1 && index <= 5 ? index : 0;
            compareLine(`idx=${index} len=${s.length}`, rt, affected);
            const fa = fields(rt, SELF_A);
            const fb = fields(rt, SELF_B);
            for (const k of ["c1", "a4", "a6", "a8", "aa"]) {
                assert.equal(fb[k], fa[k], `idx=${index} len=${s.length} ${k}`);
            }
        }
    }
});
