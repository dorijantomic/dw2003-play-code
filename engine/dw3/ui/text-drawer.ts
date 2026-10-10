// F0x800197A4 — the resident text drawer: one widget's visible run turned into
// GPU primitives.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/text-drawer-oracle.test.js runs the original through
// engine/native on the shipped resident image with the display service, the
// packet cursor, the ordering-table bucket and the three libgte helpers stubbed
// identically on both sides, and compares the whole widget, the packet arena and
// the ordered boundary calls.
//
// Authority 2 (original assembly):
//   ~/ddw3/asm/dw2003/exe/fns.s L10435-L11010 (F0x800197A4 and its five labels)
//   exe-decomp/c/_asm/F0x800197A4.s, checked block by block against m2c in
//   exe-decomp/c/F0x800197a4.c (m2c mistranslates the +0xCC early return and
//   flattens the jump-table arms, so the listing is the authority).
// Field contract and the decode of the per-glyph emit order:
//   .dw3-research/autonomous-team/researcher/results/text-drawer-contract/worker.md
//   (accepted 2026-09-15).
//
// WHAT IT IS. One call per frame for a visible text widget. The widget owns six
// line records at +0x5C (stride 0xC) and a reveal window: +0xA6 is the first
// token offset drawn, +0xA4 the end offset (both halfword offsets into line 0).
// The drawer walks one token per iteration through the resident decoder
// (F0x8001D264) and the token stepper (F0x8001A48C), and for each placed glyph
// writes its sprite into the packet arena, links it into the layer's
// ordering-table bucket, then advances the pen.
//
// The dispatch after the stepper is its own masked return value, and its five
// arms are NOT separate functions — they share this routine's 0xA0 frame and
// exit through its epilogue, which is why the coverage report lists
// 0x80019994/0x8001999C/0x800199A4/0x80019ED0/0x80019F68 as native rows while
// the routine is one translation:
//   0 / >= 5  stop: flush the packet cursor and return (no trailing DR_TPAGE)
//   1         count the glyph, then emit it (falls into the loop check)
//   2         emit the glyph without counting it (the substituted next-glyph)
//   3         loop check only (a control token that consumed no glyph)
//   4         count the glyph, loop check only (a wait: no prim)
//
// Emission order per glyph in the plain path is fixed and must not be reordered:
// [DR_TPAGE previous page] [SPRT] [DR_TPAGE current page]. Each prim is linked
// into the bucket with the AddPrim head-insert, so the GPU walks the chain in
// reverse. The leading DR_TPAGE appears only when the page changed since the
// last emitted glyph, and never on the first emitted glyph.
//
// The transform path (widget +0xCC != 0 and a non-identity scale) writes one
// 0x28-byte four-corner quad instead: the corners go through the resident libgte
// ApplyMatrixSV against the matrix the entry built. Those three libgte helpers
// are host boundaries here (the browser runtime does not run libgte), as are the
// display-service view lookup, the bucket lookup, the packet cursor and the
// flush. Each is a named method of TextDrawerHost, never a silent simplification.

import { decodeTextToken } from "./text-decode.ts";
import { setDrawTPage } from "../psx-env.ts";
import { stepToken, type TextWindowMemory, type TextStepperHost } from "./text-window.ts";

export interface TextDrawerMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface TextDrawerHost {
    /** [D0x8004DE10 + 0x17C] = F0x8001DA84: layer id -> layer object, 0 when absent. */
    viewForKey(key: number): number;
    /** [view + 0x138] = F0x8001DFA8: the ordering-table bucket entry address. */
    bucketFor(view: number, depth: number): number;
    /** [D0x8004DE10 + 0x158] = F0x8001D844: the current packet write cursor. */
    packetCursor(): number;
    /** [D0x8004DF6C] = F0x8001D854: publish the consumed cursor. */
    flushPacketCursor(cursor: number): void;
    /** F0x8002B65C RotMatrixYXZ_gte: resident libgte. The original passes
     *  a0 = widget+0xE8 (the angle triple) and a1 = widget+0xF0 (the matrix). */
    rotMatrixYXZ(angles: number, matrix: number): void;
    /** F0x8002B23C ScaleMatrix(dst, scale): resident libgte. */
    scaleMatrix(dst: number, scale: number): void;
    /** F0x8002B1DC ApplyMatrixSV(matrix, vector, out): resident libgte. */
    applyMatrixSV(matrix: number, vector: number, out: number): void;
}

/** The text host the stepper's control handlers need (line setters + lookup). */
export type TextDrawerStepperHost = TextDrawerHost & TextStepperHost;

/** Widget fields the drawer reads and writes. */
export const TEXT_DRAW = {
    font: 0x50,
    viewKey: 0x54,
    depth: 0x58,
    line0: 0x5c,
    vramX: 0xac,
    paletteAdd: 0xae,
    penX: 0xb0,
    penY: 0xb2,
    cellWidth: 0xb4,
    penRunX: 0xb8,
    penRunY: 0xba,
    measureWidth: 0xbc,
    paletteMode: 0xbe,
    colourRow: 0xc0,
    visible: 0xc1,
    fixedPitch: 0xc2,
    paused: 0xc3,
    transformOn: 0xcc,
    scaleX: 0xd0,
    scaleY: 0xd4,
    pivotX: 0xe0,
    pivotY: 0xe4,
    angles: 0xe8,
    matrix: 0xf0,
} as const;

/** Line record fields the drawer's loop reads (line 0 at widget+0x5C). */
export const TEXT_DRAW_LINE = { buffer: 0x00, cursor: 0x08, flag: 0x0a } as const;

/**
 * The scratch the routine keeps on its own frame, addressed relative to the
 * `scratch` argument. The stepper writes the chosen glyph record at +0x0C and
 * reads the decoded code/type at +0x14/+0x16 (the same layout as
 * text-window.ts's TEXT_TOKEN) and its page/wait handler keeps its counter at
 * +0x18 (the original's own `sh $zero, 0x28($sp)` at entry zeroes exactly that
 * halfword, so it is not the dead store an earlier reading called it). The
 * transform path stages its corner vector at +0x28 and the libgte output at
 * +0x20, so a caller must supply 0x48 bytes.
 */
export const TEXT_DRAW_SCRATCH = {
    glyph: 0x0c,
    code: 0x14,
    type: 0x16,
    waitCounter: 0x18,
    matrixOut: 0x20,
    corner: 0x28,
} as const;

/** F0x800197A4 and the five body labels the coverage report lists separately. */
export const DRAW_TEXT_ELEMENT = 0x800197a4;
export const TEXT_DRAW_ARM_COUNT_EMIT = 0x80019994;
export const TEXT_DRAW_ARM_COUNT_LOOP = 0x8001999c;
export const TEXT_DRAW_ARM_EMIT = 0x800199a4;
export const TEXT_DRAW_ARM_LOOP = 0x80019ed0;
export const TEXT_DRAW_ARM_STOP = 0x80019f68;

const s8 = (v: number): number => (v << 24) >> 24;
const s16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;
const read16s = (mem: TextDrawerMemory, addr: number): number => mem.read16s(addr);

/**
 * F0x800197A4(self). Translates one visible text run into GPU primitives and
 * publishes the consumed packet cursor through the host. `scratch` is the
 * caller-owned stand-in for the routine's own frame (see TEXT_DRAW_SCRATCH).
 */
export function drawTextElement(
    mem: TextDrawerMemory,
    host: TextDrawerStepperHost,
    self: number,
    scratch: number,
): void {
    let page = 0; // s7: this glyph's texpage word
    let previousPage = 0; // sp+0x68: the page the last emitted DR_TPAGE set
    let transformed = 0; // sp+0x6C
    if ((mem.read32(self + TEXT_DRAW.line0) | 0) === 0) {
        mem.write8(self + TEXT_DRAW.visible, 0);
        return;
    }
    // The original clears the six line records' draw cursors (+0x64..+0xA0,
    // descending); the order is unobservable, the set is not.
    for (let i = 0; i < 6; i++) mem.write16(self + 0x64 + i * 0x0c, 0);
    mem.write8(self + TEXT_DRAW.paused, 0);
    // 0x80019818: the page/wait handler's counter lives on this frame and the
    // original zeroes it here, once per call.
    mem.write16(scratch + TEXT_DRAW_SCRATCH.waitCounter, 0);
    mem.write16(self + TEXT_DRAW.penRunX, u16(-s16(mem.read16(self + TEXT_DRAW.measureWidth))));
    mem.write16(self + TEXT_DRAW.penRunY, 0);
    const line0 = (self + TEXT_DRAW.line0) >>> 0;
    if ((mem.read32(self + TEXT_DRAW.transformOn) | 0) !== 0) {
        const scaleX = mem.read32(self + TEXT_DRAW.scaleX) | 0;
        const scaleY = mem.read32(self + TEXT_DRAW.scaleY) | 0;
        if (scaleX === 0 && scaleY === 0) return; // 0x80019848: straight to the epilogue
        if (scaleX === 0x1000 && scaleY === scaleX) {
            mem.write32(self + TEXT_DRAW.transformOn, 0);
        } else {
            transformed = 1;
            host.rotMatrixYXZ(self + TEXT_DRAW.angles, self + TEXT_DRAW.matrix);
            host.scaleMatrix(self + TEXT_DRAW.matrix, self + TEXT_DRAW.scaleX);
        }
    }

    const view = host.viewForKey(mem.read32(self + TEXT_DRAW.viewKey) | 0) | 0;
    const bucket = host.bucketFor(view, mem.read32(self + TEXT_DRAW.depth) | 0) | 0;
    let cursor = host.packetCursor() >>> 0;
    mem.write16(line0 + TEXT_DRAW_LINE.cursor, mem.read16(self + 0xa6));
    const runLength = read16s(mem, self + 0xa4) - read16s(mem, self + 0xa6);
    let count = 0; // s4: how many glyphs the window has consumed
    let stopWithoutPage = false; // the arm-0 exit: flush only, no trailing DR_TPAGE
    if (runLength > 0) {
        for (;;) {
            if ((mem.read8(self + TEXT_DRAW.paused) & 0xff) !== 0) break; // 0x80019EEC
            const token = decodeTextToken(
                mem,
                (mem.read32(line0) + read16s(mem, line0 + TEXT_DRAW_LINE.cursor)) >>> 0,
                mem.read8(line0 + TEXT_DRAW_LINE.flag) & 0xff,
                mem.read32(self + TEXT_DRAW.font) >>> 0,
            );
            mem.write16(scratch + TEXT_DRAW_SCRATCH.code, token & 0xffff);
            mem.write16(scratch + TEXT_DRAW_SCRATCH.type, (token >>> 8) & 0xff);
            const arm = stepToken(
                mem as TextWindowMemory,
                host,
                self,
                line0,
                scratch,
                (line0 + TEXT_DRAW_LINE.cursor) >>> 0,
            ) >>> 0;
            let emit = false;
            if (arm === 1) {
                count += 1;
                emit = true;
            } else if (arm === 2) {
                emit = true;
            } else if (arm === 4) {
                count += 1;
            } else if (arm !== 3) {
                // 0 and anything >= 5: 0x80019F68, the flush without a DR_TPAGE
                stopWithoutPage = true;
                break;
            }
            if (emit) {
                const glyph = substituteGlyph(mem, self, scratch);
                const x = u16(
                    mem.read16(self + TEXT_DRAW.penRunX) + mem.read16(self + TEXT_DRAW.penX) + s8(mem.read8(glyph + 7)),
                );
                const y = u16(
                    mem.read16(self + TEXT_DRAW.penRunY) + mem.read16(self + TEXT_DRAW.penY) + s8(mem.read8(glyph + 8)),
                );
                page = texPage(mem, self, glyph);
                const clut = clutWord(mem, self, glyph);
                if (transformed === 0) {
                    const out = emitSprite(mem, self, cursor, bucket, x, y, page, clut, glyph, count, previousPage);
                    cursor = out.cursor;
                    previousPage = out.page;
                } else {
                    cursor = emitQuad(mem, host, self, scratch, cursor, bucket, x, y, page, clut, glyph);
                }
                advancePen(mem, self, glyph);
            }
            if (!(count < runLength)) break;
        }
    }
    if (!stopWithoutPage && transformed === 0) {
        // 0x80019EEC: one last DR_TPAGE for the final page, then the flush.
        setDrawTPage(mem, cursor, 0, 1, page);
        addPrim(mem, cursor, bucket);
        cursor = (cursor + 8) >>> 0;
    }
    host.flushPacketCursor(cursor);
}

/**
 * 0x800199A4's glyph substitution: a record whose first byte is 0xFF means
 * "draw the font's basic glyph 0", so the font record's +0x04 pointer replaces
 * it (and the substitution is stored back into the frame slot, as the original
 * writes to its own stack).
 */
function substituteGlyph(mem: TextDrawerMemory, self: number, scratch: number): number {
    let glyph = mem.read32(scratch + TEXT_DRAW_SCRATCH.glyph) >>> 0;
    if ((mem.read8(glyph) & 0xff) === 0xff) {
        glyph = mem.read32(mem.read32(self + TEXT_DRAW.font) + 4) >>> 0;
        mem.write32(scratch + TEXT_DRAW_SCRATCH.glyph, glyph);
    }
    return glyph;
}

/** The 16-bit CLUT word the SPRT/quad carries (frame slot +0x60). */
function clutWord(mem: TextDrawerMemory, self: number, glyph: number): number {
    const paletteAdd = mem.read16(self + TEXT_DRAW.paletteAdd) & 0xffff;
    const vramX = read16s(mem, self + TEXT_DRAW.vramX);
    const x = mem.read8(self + TEXT_DRAW.colourRow) + (paletteAdd + mem.read8(glyph + 4));
    const y = ((vramX + mem.read8(glyph + 3)) >> 4) & 0x3f;
    return u16((x << 6) | y);
}

/** The texpage word this glyph's DR_TPAGE and quad carry. */
function texPage(mem: TextDrawerMemory, self: number, glyph: number): number {
    const paletteAdd = mem.read16(self + TEXT_DRAW.paletteAdd) & 0xffff;
    const vramX = read16s(mem, self + TEXT_DRAW.vramX);
    const mode = s8(mem.read8(self + TEXT_DRAW.paletteMode));
    const base = mode === -1 ? 0x20 : (mem.read8(self + TEXT_DRAW.paletteMode) & 3) << 5;
    return (
        base |
        ((paletteAdd & 0x100) >> 4) |
        (((vramX + mem.read8(glyph) * 0x40) & 0x3ff) >> 6) |
        ((paletteAdd & 0x200) << 2)
    );
}

/** One AddPrim head insertion: prim -> bucket, bucket head -> prim. */
function addPrim(mem: TextDrawerMemory, prim: number, bucket: number): void {
    const primWord = mem.read32(prim) >>> 0;
    const bucketWord = mem.read32(bucket) >>> 0;
    mem.write32(prim, ((primWord & 0xff000000) | (bucketWord & 0x00ffffff)) >>> 0);
    mem.write32(bucket, ((bucketWord & 0xff000000) | (prim & 0x00ffffff)) >>> 0);
}

/**
 * 0x800199A4's plain path for one glyph: an optional DR_TPAGE for the page the
 * previous glyph left set, the SPRT itself (0x14 bytes) and a DR_TPAGE for this
 * glyph's page, each linked into the bucket.
 */
function emitSprite(
    mem: TextDrawerMemory,
    self: number,
    cursorIn: number,
    bucket: number,
    x: number,
    y: number,
    page: number,
    clut: number,
    glyph: number,
    count: number,
    previousIn: number,
): { cursor: number; page: number } {
    let cursor = cursorIn >>> 0;
    let previous = count === 0 ? page : previousIn;
    if ((page & 0xffff) !== (previous & 0xffff)) {
        setDrawTPage(mem, cursor, 0, 1, previous);
        addPrim(mem, cursor, bucket);
        cursor = (cursor + 8) >>> 0;
        previous = page;
    }
    mem.write8(cursor + 3, 4);
    mem.write8(cursor + 7, 0x64);
    if (s8(mem.read8(self + TEXT_DRAW.paletteMode)) !== -1) {
        mem.write8(cursor + 7, (mem.read8(cursor + 7) & 0xff) | 2);
    }
    mem.write8(cursor + 6, 0x80);
    mem.write8(cursor + 5, 0x80);
    mem.write8(cursor + 4, 0x80);
    mem.write16(cursor + 8, x & 0xffff);
    mem.write16(cursor + 0xa, y & 0xffff);
    mem.write8(cursor + 0xc, mem.read8(glyph + 1));
    mem.write8(cursor + 0xd, mem.read8(glyph + 2));
    mem.write16(cursor + 0x10, mem.read8(glyph + 5));
    mem.write16(cursor + 0x12, mem.read8(glyph + 6));
    mem.write16(cursor + 0xe, clut & 0xffff);
    addPrim(mem, cursor, bucket);
    cursor = (cursor + 0x14) >>> 0;
    setDrawTPage(mem, cursor, 0, 1, page & 0xffff);
    addPrim(mem, cursor, bucket);
    cursor = (cursor + 8) >>> 0;
    return { cursor, page: previous };
}

/**
 * 0x80019CAC's transform path for one glyph: the four corners of the glyph box,
 * pivoted and pushed through libgte ApplyMatrixSV, become one 0x28-byte
 * four-point textured quad (no DR_TPAGE — the quad carries the page at +0x16).
 */
function emitQuad(
    mem: TextDrawerMemory,
    host: TextDrawerStepperHost,
    self: number,
    scratch: number,
    cursor: number,
    bucket: number,
    x: number,
    y: number,
    page: number,
    clut: number,
    glyph: number,
): number {
    mem.write8(cursor + 3, 9);
    mem.write8(cursor + 7, 0x2c);
    mem.write8(cursor + 6, 0x80);
    mem.write8(cursor + 5, 0x80);
    mem.write8(cursor + 4, 0x80);
    const pivotX = mem.read16(self + TEXT_DRAW.pivotX) & 0xffff;
    const pivotY = mem.read16(self + TEXT_DRAW.pivotY) & 0xffff;
    const w = mem.read8(glyph + 5);
    const h = mem.read8(glyph + 6);
    const x0 = x - pivotX;
    const y0 = y - pivotY;
    // (x0,y0) (x0+w,y0) (x0,y0+h) (x0+w,y0+h), in that order.
    const corners: ReadonlyArray<readonly [number, number]> = [
        [x0, y0],
        [x0 + w, y0],
        [x0, y0 + h],
        [x0 + w, y0 + h],
    ];
    for (let i = 0; i < 4; i++) {
        const corner = corners[i] as readonly [number, number];
        mem.write16(scratch + TEXT_DRAW_SCRATCH.corner, corner[0] & 0xffff);
        mem.write16(scratch + TEXT_DRAW_SCRATCH.corner + 2, corner[1] & 0xffff);
        host.applyMatrixSV(self + TEXT_DRAW.matrix, scratch + TEXT_DRAW_SCRATCH.corner, scratch + TEXT_DRAW_SCRATCH.matrixOut);
        const outX = mem.read16(scratch + TEXT_DRAW_SCRATCH.matrixOut) + pivotX;
        const outY = mem.read16(scratch + TEXT_DRAW_SCRATCH.matrixOut + 2) + pivotY;
        mem.write16(cursor + i * 8 + 8, outX & 0xffff);
        mem.write16(cursor + i * 8 + 0xa, outY & 0xffff);
    }
    const u = mem.read8(glyph + 1);
    const v = mem.read8(glyph + 2);
    mem.write8(cursor + 0x1c, u);
    mem.write8(cursor + 0x0c, u);
    const u1 = (mem.read8(cursor + 0x0c) + w - 1) & 0xff;
    mem.write8(cursor + 0x24, u1);
    mem.write8(cursor + 0x14, u1);
    mem.write8(cursor + 0x15, v);
    mem.write8(cursor + 0x0d, v);
    const v1 = (mem.read8(cursor + 0x0d) + h - 1) & 0xff;
    mem.write8(cursor + 0x25, v1);
    mem.write8(cursor + 0x1d, v1);
    if (s8(mem.read8(self + TEXT_DRAW.paletteMode)) !== -1) {
        mem.write8(cursor + 7, (mem.read8(cursor + 7) & 0xff) | 2);
    }
    mem.write16(cursor + 0x16, page & 0xffff);
    mem.write16(cursor + 0x0e, clut & 0xffff);
    addPrim(mem, cursor, bucket);
    return (cursor + 0x28) >>> 0;
}

/** F0x80019E80: the pen advance both emit paths fall into. */
function advancePen(mem: TextDrawerMemory, self: number, glyph: number): void {
    if ((mem.read8(self + TEXT_DRAW.fixedPitch) & 0xff) !== 0) {
        mem.write16(
            self + TEXT_DRAW.penRunX,
            u16(mem.read16(self + TEXT_DRAW.penRunX) + mem.read16(self + TEXT_DRAW.cellWidth)),
        );
        return;
    }
    mem.write16(
        self + TEXT_DRAW.penRunX,
        u16(mem.read16(self + TEXT_DRAW.penRunX) + mem.read8(glyph + 9) + s8(mem.read8(glyph + 7))),
    );
}
