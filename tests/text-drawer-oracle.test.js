// Phase 4 oracle: engine/dw3/ui/text-drawer.ts must reproduce the resident text
// drawer F0x800197A4 (and the five body labels the coverage report lists as its
// own rows: 0x80019994/0x8001999C/0x800199A4/0x80019ED0/0x80019F68).
//
// The original runs through engine/native on the shipped resident image and the
// port runs beside it on an identical seed. The display-service view lookup
// (F0x8001DA84) runs the shipped body on one side and the already-ported
// findRegisteredHandleByKey on the other, against the same seeded block; the
// ordering-table bucket method, the packet cursor getter/flush and the three
// resident libgte helpers are stubbed identically on both sides and their order
// is compared. The whole widget, the packet arena the glyphs were written into
// and the published cursor cell are compared byte for byte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { DISPLAY_SERVICE, findRegisteredHandleByKey } from "../engine/dw3/display-service.ts";
import { drawTextElement, DRAW_TEXT_ELEMENT } from "../engine/dw3/ui/text-drawer.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const W = 0x80150000; // the widget
const BUF = 0x80151000; // line 0's buffer
const BUF1 = 0x80151100; // line 1's buffer (the next-glyph opcode)
const FONT = 0x80152000; // the font bank record
const GLYPH = 0x80153000; // basic glyph table (code 4 at +0)
const GLYPH_EXT = 0x80153200; // extended glyph table (code 1 at +0)
const SCRATCH = 0x80154000; // the port's frame stand-in
const VIEW = 0x80155000; // the layer object the display service finds
const BUCKET = 0x80156000; // the ordering-table bucket the view's +0x138 returns
const BUCKET_METHOD = 0x0fd00020;
const CURSOR = 0x80140000; // the packet arena the screen runtime also uses
const VIEW_KEY = 3;
const DEPTH = 0x0c;
const WINDOW = 0x180;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** The original's boundaries: the RAM cells still hold the shipped targets. */
function stubOriginal(rt, events) {
    const mem = rt.mem;
    rt.cpu.setStub(0x8001d844, () => {
        const v = mem.read32(0x8004de30) >>> 0;
        events.push(["packetCursor", v]);
        return v;
    });
    rt.cpu.setStub(0x8001d854, (c) => {
        const v = c.reg(4) >>> 0;
        events.push(["flush", v]);
        mem.write32(0x8004de30, v);
        return 0;
    });
    rt.cpu.setStub(BUCKET_METHOD, (c) => {
        events.push(["bucket", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return BUCKET;
    });
    rt.cpu.setStub(0x8002b65c, (c) => {
        events.push(["rot", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(0x8002b23c, (c) => {
        events.push(["scale", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(0x8002b1dc, (c) => {
        const matrix = c.reg(4) >>> 0;
        const vector = c.reg(5) >>> 0;
        const out = c.reg(6) >>> 0;
        // The vector/out addresses are frame-owned (they differ by design), so
        // the log carries the matrix identity and the vector contents.
        events.push(["sv", matrix, mem.read16s(vector), mem.read16s(vector + 2)]);
        mem.write16(out, (mem.read16s(vector) + 0x10) & 0xffff);
        mem.write16(out + 2, (mem.read16s(vector + 2) - 0x20) & 0xffff);
        return 0;
    });
}

function portHost(mem, events) {
    const stepperHost = {
        alloc: () => 0x801b0000,
        free: () => {},
        stringById: () => 0,
    };
    return Object.assign(stepperHost, {
        viewForKey: (key) => findRegisteredHandleByKey(mem, key),
        bucketFor: (view, depth) => {
            events.push(["bucket", view >>> 0, depth >>> 0]);
            return BUCKET;
        },
        packetCursor: () => {
            const v = mem.read32(0x8004de30) >>> 0;
            events.push(["packetCursor", v]);
            return v;
        },
        flushPacketCursor: (cursor) => {
            events.push(["flush", cursor >>> 0]);
            mem.write32(0x8004de30, cursor >>> 0);
        },
        rotMatrixYXZ: (angles, matrix) => {
            events.push(["rot", angles >>> 0, matrix >>> 0]);
        },
        scaleMatrix: (matrix, scale) => {
            events.push(["scale", matrix >>> 0, scale >>> 0]);
        },
        applyMatrixSV: (matrix, vector, out) => {
            events.push(["sv", matrix >>> 0, mem.read16s(vector), mem.read16s(vector + 2)]);
            mem.write16(out, (mem.read16s(vector) + 0x10) & 0xffff);
            mem.write16(out + 2, (mem.read16s(vector + 2) - 0x20) & 0xffff);
        },
    });
}

/** The font bank record: basic table +4, extended table +8, limits +0x14/+0x16. */
function seedFont(mem) {
    mem.write32(FONT + 4, GLYPH);
    mem.write32(FONT + 8, GLYPH_EXT);
    mem.write8(FONT + 1, 2); // the wait handler's line delta (s8)
    mem.write16(FONT + 0x14, 0x20); // basic code limit (s16)
    mem.write16(FONT + 0x16, 4); // extended glyph count (u16)
    for (let code = 4; code < 0x20; code++) {
        // stepToken: font+4 + code*0xb - 0x2c, so code 4 sits at GLYPH+0.
        const rec = GLYPH + (code - 4) * 0xb;
        writeGlyph(mem, rec, { texpage: 0, u: 0x20 + code, v: 0x30 + code, clutX: code, clutRow: 0, w: 6, h: 8, xBear: 1, yOff: -2, ink: 3 });
    }
    for (let code = 1; code <= 6; code++) {
        // font+8 + code*0xb - 0xb, so code 1 sits at GLYPH_EXT+0.
        const rec = GLYPH_EXT + (code - 1) * 0xb;
        writeGlyph(mem, rec, { texpage: 0, u: 0x40 + code, v: 0x50 + code, clutX: code + 8, clutRow: 1, w: 7, h: 9, xBear: 2, yOff: -3, ink: 4 });
    }
}

function writeGlyph(mem, rec, g) {
    mem.write8(rec + 0, g.texpage & 0xff);
    mem.write8(rec + 1, g.u & 0xff);
    mem.write8(rec + 2, g.v & 0xff);
    mem.write8(rec + 3, g.clutX & 0xff);
    mem.write8(rec + 4, g.clutRow & 0xff);
    mem.write8(rec + 5, g.w & 0xff);
    mem.write8(rec + 6, g.h & 0xff);
    mem.write8(rec + 7, g.xBear & 0xff);
    mem.write8(rec + 8, g.yOff & 0xff);
    mem.write8(rec + 9, g.ink & 0xff);
}

function seed(rt, c) {
    const mem = rt.mem;
    seedFont(mem);
    for (let i = 0; i < WINDOW; i++) mem.write8(W + i, 0);
    mem.write32(0x8004de30, CURSOR);
    // the display service: slot 0 points at VIEW with handle VIEW_KEY
    mem.write32(DISPLAY_SERVICE + 0x60, VIEW);
    mem.write32(DISPLAY_SERVICE + 0xd8, VIEW_KEY);
    mem.write32(VIEW + 0x138, BUCKET_METHOD);
    for (let i = 0; i < 0x200; i++) mem.write8(CURSOR + i, 0);
    // widget
    mem.write32(W + 0x50, FONT);
    mem.write32(W + 0x54, VIEW_KEY);
    mem.write32(W + 0x58, DEPTH);
    mem.write32(W + 0x5c, BUF);
    mem.write16(W + 0x62, c.bytes.length);
    for (let k = 0; k < 6; k++) mem.write16(W + 0x64 + k * 0xc, 0xeeee);
    mem.write16(W + 0x66, c.flag ?? 0);
    mem.write16(W + 0xa4, c.a4);
    mem.write16(W + 0xa6, c.a6);
    mem.write16(W + 0xaa, c.lineWidth ?? 0);
    mem.write16(W + 0xac, c.vramX ?? 0x140);
    mem.write16(W + 0xae, c.paletteAdd ?? 1);
    mem.write16(W + 0xb0, 0x30);
    mem.write16(W + 0xb2, 0x40);
    mem.write16(W + 0xb4, c.cellWidth ?? 0);
    mem.write16(W + 0xb8, 0x1111);
    mem.write16(W + 0xba, 0x2222);
    mem.write16(W + 0xbc, c.measureWidth ?? 0);
    mem.write8(W + 0xbe, c.paletteMode ?? 0xff);
    mem.write8(W + 0xbf, c.pageBudget ?? 2);
    mem.write8(W + 0xc0, c.colourRow ?? 5);
    mem.write8(W + 0xc1, 1);
    mem.write8(W + 0xc2, c.fixedPitch ?? 0);
    mem.write8(W + 0xc3, c.paused ?? 0);
    mem.write32(W + 0xcc, c.transformOn ?? 0);
    mem.write32(W + 0xd0, c.scaleX ?? 0x1000);
    mem.write32(W + 0xd4, c.scaleY ?? 0x1000);
    mem.write16(W + 0xe0, c.pivotX ?? 0x10);
    mem.write16(W + 0xe4, c.pivotY ?? 0x20);
    // line 0's token stream
    for (let i = 0; i < 0x80; i++) mem.write8(BUF + i, 0);
    c.bytes.forEach((b, i) => mem.write8(BUF + i, b));
    // the next-glyph opcode's sibling line 1
    for (let i = 0; i < 0x40; i++) mem.write8(BUF1 + i, 0);
    if (c.nested) {
        const rec = W + 0x5c + 0xc;
        mem.write32(rec, BUF1);
        mem.write16(rec + 0x6, 2);
        mem.write16(rec + 0x8, 0);
        mem.write16(rec + 0xa, 0);
        [5, 6].forEach((b, i) => mem.write8(BUF1 + i, b));
    }
    if (c.pageShiftCode !== undefined) {
        mem.write8(GLYPH + (c.pageShiftCode - 4) * 0xb, 1);
    }
    if (c.substituteCode !== undefined) {
        mem.write8(GLYPH + (c.substituteCode - 4) * 0xb, 0xff);
    }
}

/**
 * The port's scratch stands in for the routine's own stack frame, so its prior
 * contents are garbage by definition: poison it before every draw and require
 * the port to produce the same result anyway (the original zeroes the one slot
 * it reads before writing it).
 */
function poisonScratch(mem) {
    for (let i = 0; i < 0x48; i++) mem.write8(SCRATCH + i, 0xa5);
}

function bytesOf(mem, base, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(mem.read8(base + i));
    return out;
}

function runCase(c, seedFn, draws = 1) {
    const evA = [];
    const a = runtime();
    stubOriginal(a, evA);
    seedFn(a);
    for (let i = 0; i < draws; i++) a.cpu.call(DRAW_TEXT_ELEMENT, [W]);

    const evB = [];
    const b = runtime();
    seedFn(b);
    const port = portHost(b.mem, evB);
    for (let i = 0; i < draws; i++) {
        poisonScratch(b.mem);
        drawTextElement(b.mem, port, W, SCRATCH);
    }

    assert.deepEqual(evB, evA, `boundary calls differ: ${c.name}`);
    const wa = bytesOf(a.mem, W, WINDOW);
    const wb = bytesOf(b.mem, W, WINDOW);
    for (let i = 0; i < wa.length; i++) {
        assert.equal(wb[i], wa[i], `widget differs at +0x${i.toString(16)}: port ${wb[i]} original ${wa[i]} (${c.name})`);
    }
    const pa = bytesOf(a.mem, CURSOR, 0x400);
    const pb = bytesOf(b.mem, CURSOR, 0x400);
    for (let i = 0; i < pa.length; i++) {
        assert.equal(pb[i], pa[i], `packet arena differs at +0x${i.toString(16)}: port ${pb[i]} original ${pa[i]} (${c.name})`);
    }
    assert.equal(b.mem.read32(0x8004de30) >>> 0, a.mem.read32(0x8004de30) >>> 0, `cursor cell differs: ${c.name}`);
}

const CASES = [
    { name: "three basic glyphs", bytes: [5, 6, 7], a6: 0, a4: 3 },
    { name: "window length reached before the buffer ends", bytes: [5, 6, 7, 8], a6: 0, a4: 3 },
    { name: "extended glyph then basic", bytes: [1, 2, 5, 6], a6: 0, a4: 3 },
    { name: "end token pauses mid-run", bytes: [5, 0, 6, 7], a6: 0, a4: 3 },
    { name: "reveal window starts mid-buffer", bytes: [5, 6, 7, 8], a6: 1, a4: 4 },
    { name: "page changes on the second glyph", bytes: [5, 6], a6: 0, a4: 2, pageShiftCode: 6 },
    { name: "palette mode 2 sets the texpage base", bytes: [5, 6], a6: 0, a4: 2, paletteMode: 2, paletteAdd: 0x101 },
    { name: "palette add bits reach the texpage", bytes: [5, 6], a6: 0, a4: 2, paletteAdd: 0x201 },
    { name: "palette mode 3", bytes: [5, 6], a6: 0, a4: 2, paletteMode: 3, paletteAdd: 0x302 },
    { name: "fixed pitch pen", bytes: [5, 6], a6: 0, a4: 2, fixedPitch: 1, cellWidth: 10 },
    { name: "0xFF glyph substitutes the basic record", bytes: [5, 6], a6: 0, a4: 2, substituteCode: 5 },
    { name: "control operand 0 stops the run (arm 0)", bytes: [2, 0, 5, 6], a6: 0, a4: 3 },
    { name: "wait token counts without drawing (arm 4)", bytes: [2, 1, 1, 3], a6: 0, a4: 3, flag: 1 },
    { name: "next-glyph opcode emits line 1 (arm 2)", bytes: [2, 5, 1, 0], a6: 0, a4: 3, nested: true },
    { name: "empty window still flushes", bytes: [5], a6: 2, a4: 2 },
    { name: "identity transform is cleared", bytes: [5, 6], a6: 0, a4: 2, transformOn: 1, scaleX: 0x1000, scaleY: 0x1000 },
    { name: "scaled transform writes one quad", bytes: [5, 6], a6: 0, a4: 2, transformOn: 1, scaleX: 0x2000, scaleY: 0x1000 },
    { name: "scaled transform with a shifted pivot", bytes: [5, 6], a6: 0, a4: 2, transformOn: 1, scaleX: 0x1800, scaleY: 0x2000, pivotX: 0x1234, pivotY: 0xfff0 },
    { name: "zero scale returns without drawing", bytes: [5, 6], a6: 0, a4: 2, transformOn: 1, scaleX: 0, scaleY: 0 },
    { name: "a paused widget is resumed by the entry clear", bytes: [5, 6], a6: 0, a4: 2, paused: 1 },
    { name: "right-aligned run from the measured width", bytes: [5, 6], a6: 0, a4: 2, measureWidth: 0x40 },
    { name: "measured width wraps", bytes: [5, 6], a6: 0, a4: 2, measureWidth: 0x8000 },
    { name: "wait token with a poisoned frame", bytes: [2, 1, 1, 3], a6: 0, a4: 3, flag: 1, measureWidth: 0x20 },
    { name: "a second wait token spends the page budget", bytes: [2, 1, 2, 1, 5, 6], a6: 0, a4: 3 },
];

test("drawTextElement matches F0x800197A4 over the token and geometry cases", () => {
    let n = 0;
    for (const c of CASES) {
        runCase(c, (rt) => seed(rt, c));
        n += 1;
    }
    assert.equal(n, CASES.length);
});

test("a null line 0 clears visibility and draws nothing", () => {
    const c = { name: "null line 0", bytes: [5, 6], a6: 0, a4: 2 };
    const run = (draw) => {
        const rt = runtime();
        const events = [];
        stubOriginal(rt, events);
        seed(rt, c);
        rt.mem.write32(W + 0x5c, 0);
        draw(rt, events);
        return { events, visible: rt.mem.read8(W + 0xc1), cursor: rt.mem.read32(0x8004de30) >>> 0, arena: bytesOf(rt.mem, CURSOR, 0x80) };
    };
    const a = run((rt) => rt.cpu.call(DRAW_TEXT_ELEMENT, [W]));
    const b = run((rt, ev) => drawTextElement(rt.mem, portHost(rt.mem, ev), W, SCRATCH));
    assert.deepEqual(b.events, a.events);
    assert.equal(a.events.length, 0, "no boundary call for a null line 0");
    assert.equal(b.visible, a.visible);
    assert.equal(a.visible, 0);
    assert.equal(b.cursor, a.cursor);
    assert.deepEqual(b.arena, a.arena);
});

test("two draws in a row keep the page bookkeeping and the cursor", () => {
    const first = { name: "draw 1", bytes: [5, 6], a6: 0, a4: 2, pageShiftCode: 6 };
    const second = { name: "draw 2", bytes: [6, 5], a6: 0, a4: 2, pageShiftCode: 6 };
    const run = (draw) => {
        const rt = runtime();
        const events = [];
        stubOriginal(rt, events);
        seed(rt, first);
        poisonScratch(rt.mem);
        draw(rt, events);
        const mid = { widget: bytesOf(rt.mem, W, WINDOW), arena: bytesOf(rt.mem, CURSOR, 0x400), cursor: rt.mem.read32(0x8004de30) >>> 0 };
        // re-seed only the token stream and window, keeping the cursor cell
        const cursor = rt.mem.read32(0x8004de30) >>> 0;
        seed(rt, second);
        rt.mem.write32(0x8004de30, cursor);
        poisonScratch(rt.mem);
        draw(rt, events);
        return { events, mid, widget: bytesOf(rt.mem, W, WINDOW), arena: bytesOf(rt.mem, CURSOR, 0x400), cursor: rt.mem.read32(0x8004de30) >>> 0 };
    };
    const a = run((rt) => rt.cpu.call(DRAW_TEXT_ELEMENT, [W]));
    const b = run((rt, ev) => drawTextElement(rt.mem, portHost(rt.mem, ev), W, SCRATCH));
    assert.deepEqual(b.events, a.events);
    assert.deepEqual(b.mid, a.mid);
    assert.deepEqual(b.widget, a.widget);
    assert.deepEqual(b.arena, a.arena);
    assert.equal(b.cursor, a.cursor);
});
