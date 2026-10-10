// The field conversation balloon's TAIL: the pointer from the balloon to the
// speaker, which grows on open and shrinks on close. Translated from the
// resident EXE F0x8001C85C (create), F0x8001C7D8 (tick) and F0x8001C4EC (the
// grow / shrink wipe), plus the two libgte helpers the wipe calls.
//
// Oracle: tests/lane-b/dialogue-tail.test.js runs the original through
// engine/native on resident.bin. The interpreter has no GTE, so the two GTE
// helpers are run there by a small instruction-level executor over the real
// instruction words (not by this file); the wipe's packet bytes and ordering
// links then compare end to end.
//
// Tail object (0xC0 bytes, handler F0x8001C7D8; fields): +0x0C state (1 = wipe
// running, 2 and 3 = idle, anything else = reset), +0x28 / +0x38 methods,
// +0x50 / +0x52 anchor x / y (s16), +0x54 / +0x56 origin x / y, +0x58 width
// (arg + 0x20), +0x5A height, +0x5C step (s16), +0x60 scale 0..0x1000,
// +0x64 draw layer, +0x68 and +0x78 zero, +0x6C / +0x6E table offsets,
// +0x70 / +0x74 / +0x78 scale vector (v, v, 0), +0x80 angle vector (rx, ry, rz s16),
// +0x88 / +0x8C / +0x90 reset position, +0x98 five-word matrix, +0xB8 closing
// flag (0 = grow, else shrink), +0xBC set to 1 when a grow completes.
//
// Layout table D0x8004DCF4: 0x20 bytes per mode, the s16 pair at +8 / +0xA is
// the tail origin (mode 0 (0,-74), 1 (0,12), 2 (-26,-74), 3 (-26,12)).
// Vertex-order words D0x80010288 = {1, 3, 0, 2}: line i runs from corner i to
// corner order[i] (corners TL, TR, BL, BR), so the wipe draws a closed outline.
// The wipe draws four flat LINE_F2 primitives (not quads), 0x10 bytes each:
// tag byte 3 = 3 words, rgb (0, 0, 0xFF), code 0x40 (opaque), x0 y0 x1 y1 s16.
//
// Host boundaries: the object allocator F0x80014504, the layer object getter
// D0x8004DF8C, the ordering-table head [obj+0x138], the primitive allocator
// D0x8004DF68 and advance D0x8004DF6C, and the object's own methods +0x28 and
// +0x38.

import type { FrameMemory } from "./dialogue-frame.ts";
import { scaleMatrix } from "./wizard-misc.ts";

export const TAIL_HANDLER = 0x8001c7d8;
export const TAIL_SIZE = 0xc0;
export const TAIL_LAYOUT_TABLE = 0x8004dcf4;
export const TAIL_ORDER_TABLE = 0x80010288;
export const TRIG_TABLE = 0x80056a28;
export const TAIL_PRIM_SIZE = 0x10;

/** What the browser paints for one tail line (the packet bytes stay authoritative). */
export interface TailLineIntent {
    primitive: "LINE_F2";
    code: number;
    color: [number, number, number];
    semiTransparent: false;
    /** Endpoints x0, y0, x1, y1 (signed, screen space relative to the draw origin). */
    points: [number, number, number, number];
}

export interface TailHost {
    /** F0x80014504(handler, 0xC0, 0): the new object's address. */
    createObject(handler: number, size: number, flags: number): number;
    /** D0x8004DF8C(layer): the layer's draw object. */
    layerObject(layer: number): number;
    /** obj.method[0x138](obj, 0): address of the ordering-table head word. */
    orderingHead(obj: number): number;
    /** D0x8004DF68(): address of the first free primitive slot. */
    allocPrim(): number;
    /** D0x8004DF6C(next): advance the packet pointer past the four lines. */
    commitPrim(next: number, lines: TailLineIntent[]): void;
    /** [obj+0x28](obj, state): the state-change method. */
    setState(obj: number, state: number): void;
    /** [obj+0x38](obj): the reset method. */
    onReset(obj: number): void;
}

const u32 = (v: number): number => v >>> 0;
const s16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;
const sat16 = (v: number): number => (v < -0x8000 ? -0x8000 : v > 0x7fff ? 0x7fff : v);

/** F0x8001C85C(layer, x, y, width, height, mode): create the tail object. */
export function dialogueTailCreate(
    mem: FrameMemory, host: TailHost,
    layer: number, x: number, y: number, width: number, height: number, mode: number,
): number {
    const obj = u32(host.createObject(TAIL_HANDLER, TAIL_SIZE, 0));
    let sub = width | 0;
    mem.write32(obj + 0x64, layer);
    mem.write16(obj + 0x54, x);
    mem.write16(obj + 0x56, y);
    mem.write16(obj + 0x58, (width + 0x20) | 0);
    mem.write16(obj + 0x5a, height);
    if (u32((mode | 0) - 2) < 2) sub = 0;
    const entry = u32(TAIL_LAYOUT_TABLE + ((mode | 0) << 5));
    mem.write16(obj + 0x6c, mem.read16(entry + 8) - sub);
    mem.write16(obj + 0x6e, mem.read16(entry + 0xa));
    mem.write16(obj + 0x50, (x + mem.read16(obj + 0x6c)) | 0);
    mem.write16(obj + 0x52, (y + mem.read16(obj + 0x6e)) | 0);
    return obj;
}

/** F0x8001C7D8(obj): state 1 runs the wipe; 2 and 3 idle; the rest reset. */
export function dialogueTailTick(mem: FrameMemory, host: TailHost, obj: number): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        dialogueTailWipe(mem, host, obj);
    } else if (state < 2 || state >= 4) {
        mem.write32(obj + 0x68, 0);
        mem.write32(obj + 0x60, mem.read32(obj + 0xb8) === 0 ? 0 : 0x1000);
        mem.write32(obj + 0x90, 0);
        mem.write32(obj + 0x88, mem.read16s(obj + 0x54));
        mem.write32(obj + 0x8c, mem.read16s(obj + 0x56));
        host.onReset(obj);
    }
}

/** The trig lookup of F0x8002B65C: the packed (cos << 16 | +-sin) word for one angle. */
function trig(mem: FrameMemory, angle: number): { c: number; s: number } {
    const a = s16(angle);
    const neg = a < 0;
    const w = mem.read32(TRIG_TABLE + (((neg ? -a : a) * 4) & 0x3ffc));
    const lo = w & 0xffff;
    return { c: w >> 16, s: s16(neg ? -lo & 0xffff : lo) };
}

/** GTE GPF with sf = 1, lm = 0: IR_n = sat((IR0 * IR_n) >> 12). */
const gpf = (ir0: number, a: number, b: number, c: number): [number, number, number] =>
    [sat16((ir0 * a) >> 12), sat16((ir0 * b) >> 12), sat16((ir0 * c) >> 12)];

/**
 * F0x8002B65C(angles, matrix): the three-angle rotation matrix. angles = rx, ry
 * (s16 at +0 / +2) and rz (s16 at +4); the five-word matrix is written in the
 * original's store order (m33 half, then words 2, 0, 1, 3).
 */
export function rotMatrix(mem: FrameMemory, angles: number, matrix: number): void {
    const rz = trig(mem, mem.read16s(angles + 4));
    const word0 = mem.read32(angles);
    const ry = trig(mem, word0 >> 16);
    const rx = trig(mem, s16(word0));
    const [cx, sx, cy, sy, cz, sz] = [rx.c, rx.s, ry.c, ry.s, rz.c, rz.s];
    const [t0, t1, t2] = gpf(cy, sx, sz, cz);
    const m33 = (cx * cy) >> 12;
    const [t3, t4, t5] = gpf(sy, sx, sz, cz);
    const cxsy = (cx * sy) >> 12;
    const [a0, a1, a2] = gpf(cz, cx, t3, t0);
    const [g0, g1, g2] = gpf(sz, cx, t3, t0);
    mem.write16(matrix + 0x10, m33);
    mem.write32(matrix + 0x8, ((a0 & 0xffff) | (-sx << 16)) >>> 0);
    mem.write32(matrix + 0x0, (((a1 - t1) << 16) | u16(t2 + g1)) >>> 0);
    mem.write32(matrix + 0x4, ((g0 << 16) | u16(cxsy)) >>> 0);
    mem.write32(matrix + 0xc, (((a2 + t4) << 16) | u16(g2 - t5)) >>> 0);
}

/**
 * F0x8002B1DC(matrix, vec, out): GTE MVMVA (rotation matrix * s16 vector (x, y, z),
 * no translation, shift 12, 16-bit saturation). Writes three halves at out.
 */
export function applyMatrix(mem: FrameMemory, matrix: number, vec: number, out: number): void {
    const m = [0, 1, 2, 3, 4].map((i) => mem.read32(matrix + i * 4) | 0);
    const r = mvmva(m, [mem.read16s(vec), mem.read16s(vec + 2), mem.read16s(vec + 4)]);
    r.forEach((v, i) => mem.write16(out + 2 * i, v));
}

/** The GTE multiply on the five matrix words: three saturated shifted dot products. */
function mvmva(m: number[], v: [number, number, number]): [number, number, number] {
    const rows = [
        [s16(m[0]!), s16(m[0]! >> 16), s16(m[1]!)],
        [s16(m[1]! >> 16), s16(m[2]!), s16(m[2]! >> 16)],
        [s16(m[3]!), s16(m[3]! >> 16), s16(m[4]!)],
    ];
    const f = (row: number[]): number =>
        sat16(Math.floor((row[0]! * v[0] + row[1]! * v[1] + row[2]! * v[2]) / 4096));
    return [f(rows[0]!), f(rows[1]!), f(rows[2]!)];
}

/** F0x8001C4EC(obj): advance the scale, rebuild the matrix, queue four LINE_F2s. */
export function dialogueTailWipe(mem: FrameMemory, host: TailHost, obj: number): void {
    const layerObj = host.layerObject(mem.read32(obj + 0x64) | 0);
    const ot = u32(host.orderingHead(layerObj));
    const step = mem.read16s(obj + 0x5c);
    if (mem.read32(obj + 0xb8) === 0) {
        const v = (mem.read32(obj + 0x60) | 0) + step;
        mem.write32(obj + 0x60, v);
        if (v >= 0x1001) {
            mem.write32(obj + 0x60, 0x1000);
            mem.write32(obj + 0xbc, 1);
            host.setState(obj, 3);
        }
    } else {
        const v = (mem.read32(obj + 0x60) | 0) - step;
        mem.write32(obj + 0x60, v);
        if (v < 0) {
            mem.write32(obj + 0x60, 0);
            host.setState(obj, 3);
        }
    }
    const scale = mem.read32(obj + 0x60);
    mem.write32(obj + 0x78, 0);
    mem.write32(obj + 0x74, scale);
    mem.write32(obj + 0x70, scale);
    rotMatrix(mem, obj + 0x80, obj + 0x98);
    scaleMatrix(mem as never, obj + 0x98, obj + 0x70);

    const x0 = u16(mem.read16(obj + 0x50) - mem.read16(obj + 0x54));
    const x1 = u16(x0 + mem.read16(obj + 0x58));
    const y0 = u16(mem.read16(obj + 0x52) - mem.read16(obj + 0x56));
    const y1 = u16(y0 + mem.read16(obj + 0x5a));
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    // Each corner (x, y, 0) goes through the matrix, then the origin is added (16-bit wrap).
    const matrixWords = [0, 1, 2, 3, 4].map((i) => mem.read32(obj + 0x98 + i * 4) | 0);
    const ox = mem.read16(obj + 0x54);
    const oy = mem.read16(obj + 0x56);
    const pts: Array<[number, number]> = corners.map(([cx, cy]) => {
        const [px, py] = mvmva(matrixWords, [s16(cx!), s16(cy!), 0]);
        return [u16(px + ox), u16(py + oy)];
    });

    const order = [0, 1, 2, 3].map((i) => mem.read32(TAIL_ORDER_TABLE + 4 * i) | 0);
    let prim = u32(host.allocPrim());
    const lines: TailLineIntent[] = [];
    for (let i = 0; i < 4; i++) {
        const [ax, ay] = pts[i]!;
        const [bx, by] = pts[order[i]!]!;
        mem.write8(prim + 3, 3);
        mem.write8(prim + 7, 0x40);
        mem.write8(prim + 4, 0);
        mem.write8(prim + 5, 0);
        mem.write8(prim + 6, 0xff);
        mem.write16(prim + 8, ax);
        mem.write16(prim + 0xa, ay);
        mem.write16(prim + 0xc, bx);
        mem.write16(prim + 0xe, by);
        mem.write32(prim, ((mem.read32(prim) & 0xff000000) | (mem.read32(ot) & 0xffffff)) >>> 0);
        mem.write32(ot, ((mem.read32(ot) & 0xff000000) | (prim & 0xffffff)) >>> 0);
        lines.push({
            primitive: "LINE_F2", code: 0x40, color: [0, 0, 0xff], semiTransparent: false,
            points: [s16(ax), s16(ay), s16(bx), s16(by)],
        });
        prim = u32(prim + TAIL_PRIM_SIZE);
    }
    host.commitPrim(prim, lines);
}
