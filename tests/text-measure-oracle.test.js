// Phase 4 oracle: engine/dw3/ui/text-measure.ts must return exactly what the
// original measure loop returns, and store exactly what F0x8001A25C stores.
// engine/native (the interpreter) runs both original addresses as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { measureLine, measureTextWidth } from "../engine/dw3/ui/text-measure.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const LINE = 0x80150000;   // line 0; siblings at +0xC
const BUF = 0x80150200;
const FONT = 0x80151000;
const GLYPH = 0x80152000;  // glyph(code) = GLYPH + 11*code - 0x2C
const EXT = 0x80153000;    // ext(code)   = EXT + 11*code - 0xB
const SELF = 0x80154000;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    // Font record: table bases, basic limit, ext count.
    rt.mem.write32(FONT + 4, GLYPH);
    rt.mem.write32(FONT + 8, EXT);
    rt.mem.write16(FONT + 0x14, 0x20);
    rt.mem.write16(FONT + 0x16, 3);
    // Glyph records: +7 signed dx, +9 advance.
    for (let c = 0; c < 0x20; c++) {
        const g = GLYPH + 11 * c - 0x2c;
        rt.mem.write8(g + 7, (c % 7) - 3);      // signed dx in [-3, 3]
        rt.mem.write8(g + 9, 5 + (c % 5));
        const e = EXT + 11 * c - 0xb;
        rt.mem.write8(e + 7, (c % 5) - 2);
        rt.mem.write8(e + 9, 9 + (c % 4));
    }
    rt.mem.write8(GLYPH + 7, 0xfb);             // -5, the invalid arm's glyph 0
    rt.mem.write8(GLYPH + 9, 0x11);             // 17
    return rt;
}

function setLine(rt, line, bytes, flag) {
    rt.mem.write32(line + 0, BUF);
    rt.mem.write16(line + 6, bytes.length);
    rt.mem.write16(line + 0xa, flag);
    for (let i = 0; i < bytes.length; i++) rt.mem.write8(BUF + i, bytes[i]);
    for (let i = bytes.length; i < 16; i++) rt.mem.write8(BUF + i, 0);
}

function caseBoth(rt, label, bytes, flag, fixed) {
    setLine(rt, LINE, bytes, flag);
    const oracle = rt.cpu.call(0x8001f770, [LINE, FONT, fixed]) | 0;
    const port = measureLine(rt.mem, LINE, FONT, fixed) | 0;
    assert.equal(port, oracle, `${label}: bytes=[${bytes}] flag=${flag} fixed=${fixed}`);
    return oracle;
}

test("measureLine matches F0x8001F770 on basic / ext / invalid / end tokens", () => {
    const rt = runtime();
    for (const fixed of [0, 8, -3]) {
        caseBoth(rt, "basic", [4, 5, 6, 0], 0, fixed);
        caseBoth(rt, "basic+ext", [4, 1, 1, 0], 0, fixed);
        caseBoth(rt, "ext codes 1..3", [1, 1, 1, 2, 1, 3, 0], 0, fixed);
        caseBoth(rt, "invalid", [3, 0], 0, fixed);
        caseBoth(rt, "basic then invalid", [4, 3, 0], 0, fixed);
        caseBoth(rt, "empty buffer", [0], 0, fixed);
    }
});

test("measureLine matches F0x8001F770 on control operands", () => {
    const rt = runtime();
    // operand 1 and 3 flush the page: max/width bookkeeping
    caseBoth(rt, "op1 flush", [4, 2, 1, 4, 0], 0, 0);
    // a flush followed by the end token: the exit must return the page's max
    caseBoth(rt, "op1 flush then end", [4, 5, 2, 1, 0], 0, 0);
    caseBoth(rt, "op3 flush then end", [4, 5, 2, 3, 0], 0, 0);
    // and one that exits through the shared loop check with max > width
    caseBoth(rt, "op1 flush then overrun", [4, 5, 2, 1], 0, 0);
    caseBoth(rt, "op3 flush", [4, 2, 3, 4, 0], 0, 0);
    // operand 0 / 2 only advance
    caseBoth(rt, "op0", [4, 2, 0, 0], 0, 0);
    caseBoth(rt, "op2", [4, 2, 2, 0], 0, 0);
    // operand 5 recurses into the sibling line record
    setLine(rt, LINE + 0xc, [5, 0], 0);
    caseBoth(rt, "op5 recurse", [4, 2, 5, 1, 0], 0, 0);
    setLine(rt, LINE + 0xc, [6, 6, 0], 0);
    caseBoth(rt, "op5 recurse twice", [4, 2, 5, 1, 4, 2, 5, 1, 0], 0, 0);
});

test("measureLine matches F0x8001F770 on the guards", () => {
    const rt = runtime();
    setLine(rt, LINE, [4, 0], 0);
    rt.mem.write32(LINE, 0);
    assert.equal(measureLine(rt.mem, LINE, FONT, 0), rt.cpu.call(0x8001f770, [LINE, FONT, 0]) | 0);
    assert.equal(measureLine(rt.mem, LINE, FONT, 0), 0);
    setLine(rt, LINE, [4, 0], 0);
    rt.mem.write16(LINE + 6, 0);
    assert.equal(measureLine(rt.mem, LINE, FONT, 0), rt.cpu.call(0x8001f770, [LINE, FONT, 0]) | 0);
    rt.mem.write16(LINE + 6, 0xffff); // s16 -1
    assert.equal(measureLine(rt.mem, LINE, FONT, 0), rt.cpu.call(0x8001f770, [LINE, FONT, 0]) | 0);
});

test("measureLine matches with the convert flag set", () => {
    const rt = runtime();
    // convert path: b0 >= 4 -> basic if below the limit; b0 < 4 -> pairs
    caseBoth(rt, "convert basic", [4, 5, 0], 1, 0);
    caseBoth(rt, "convert pair", [2, 1, 0], 1, 0);
});

test("measureTextWidth matches F0x8001A25C", () => {
    const rt = runtime();
    setLine(rt, SELF + 0x5c, [4, 5, 0], 0);
    rt.mem.write32(SELF + 0x50, FONT);
    for (const enable of [0, 1, 2, 0x100, 0xff]) {
        rt.mem.write16(SELF + 0xb4, 0);
        rt.mem.write16(SELF + 0xbc, 0xdead);
        rt.cpu.call(0x8001a25c, [SELF, enable]);
        const oracle = rt.mem.read16(SELF + 0xbc);
        rt.mem.write16(SELF + 0xbc, 0xdead);
        measureTextWidth(rt.mem, SELF, enable);
        assert.equal(rt.mem.read16(SELF + 0xbc), oracle, `enable=${enable}`);
    }
    // with a fixed cell
    rt.mem.write16(SELF + 0xb4, 7);
    rt.cpu.call(0x8001a25c, [SELF, 1]);
    const oracle = rt.mem.read16(SELF + 0xbc);
    rt.mem.write16(SELF + 0xbc, 0);
    measureTextWidth(rt.mem, SELF, 1);
    assert.equal(rt.mem.read16(SELF + 0xbc), oracle);
});
