// Two small helpers of the registration wizard, translated from the original
// pro/stplnmet bodies (Part D of docs/plans/2026-09-28-translated-game-completion-plan.md;
// oracle tests/lane-b/wizard-misc.test.js).
//
//   F0x80082F58 centreOnRect     centre a widget on a rectangle's width and height.
//   F0x80088538 tweenLinearStart start a linear tween from one value to another.
//   F0x80088578 tweenLinearTick  advance the tween one frame; 1 once it has arrived.
//
// Tween record: +0x00 frames, +0x08 value, +0x0C 8.8 accumulator, +0x10 target,
// +0x14 step (8.8 per frame), +0x18 active.

export interface WizardMiscMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80082F58(widget, rect): set the widget's number and justify from a rectangle. */
export function centreOnRect(
    mem: WizardMiscMemory,
    widget: number,
    rect: number,
    callMethod: (target: number, slot: number, args: number[]) => void,
): void {
    const w = mem.read16(rect + 4);
    const h = mem.read16(rect + 6);
    const half = (v: number): number => (s16(v) + ((((v << 16) >>> 0) >>> 0x1f))) >> 1;
    callMethod(widget, 0x118, [half(w), half(h)]);
    callMethod(widget, 0x148, [5]);
}

/** F0x80088538(tween, from, to, frames). */
export function tweenLinearStart(
    mem: WizardMiscMemory, tween: number, from: number, to: number, frames: number,
): void {
    if (from === to) return;
    mem.write32(tween + 0x0, frames | 0);
    mem.write32(tween + 0xc, from << 8);
    mem.write32(tween + 0x8, from | 0);
    mem.write32(tween + 0x10, to | 0);
    mem.write32(tween + 0x18, 1);
    const span = (to - from) << 8;
    mem.write32(tween + 0x14, frames === 0 ? (span >= 0 ? -1 : 1) : Math.trunc(span / (frames | 0)));
}

/** F0x80088578(tween): one tween frame; 1 when finished or idle. */
export function tweenLinearTick(mem: WizardMiscMemory, tween: number): number {
    if ((mem.read32(tween + 0x18) | 0) === 0) return 1;
    const step = mem.read32(tween + 0x14) | 0;
    const acc = ((mem.read32(tween + 0xc) | 0) + step) | 0;
    mem.write32(tween + 0xc, acc);
    const value = acc >> 8;
    mem.write32(tween + 0x8, value);
    const target = mem.read32(tween + 0x10) | 0;
    const arrived = step > 0 ? target < value : value < target;
    if (arrived) {
        mem.write32(tween + 0x8, target);
        mem.write32(tween + 0x18, 0);
        return 1;
    }
    return 0;
}

export interface MatrixMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/**
 * F0x8002B23C(matrix, scale): libgte ScaleMatrix. Each matrix row is multiplied
 * by the three scale words (12-bit fixed point); the matrix is five words, the
 * last holding only the bottom-right element.
 */
export function scaleMatrix(mem: MatrixMemory, matrix: number, scale: number): void {
    const sx = mem.read32(scale) | 0;
    const sy = mem.read32(scale + 4) | 0;
    const sz = mem.read32(scale + 8) | 0;
    const pair = (word: number, lo: number, hi: number): number =>
        ((((s16(word & 0xffff) * lo) >> 12) & 0xffff) | (((word >> 16) * hi) >> 12 << 16)) | 0;
    mem.write32(matrix + 0x0, pair(mem.read32(matrix + 0x0), sx, sy));
    mem.write32(matrix + 0x4, pair(mem.read32(matrix + 0x4), sz, sx));
    mem.write32(matrix + 0x8, pair(mem.read32(matrix + 0x8), sy, sz));
    mem.write32(matrix + 0xc, pair(mem.read32(matrix + 0xc), sx, sy));
    mem.write32(matrix + 0x10, ((s16(mem.read32(matrix + 0x10) & 0xffff) * sz) >> 12) | 0);
}
