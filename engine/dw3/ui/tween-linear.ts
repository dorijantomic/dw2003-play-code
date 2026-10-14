// The 8.8 fixed-point linear tween, translated from the shared resident routine
// F0x80087FDC (start) / F0x8008801C (tick), as reached by pro/stgmcard through
// the module block 0x80088768 +0x30/+0x34.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/tween-linear-oracle.test.js runs the original through
// engine/native on pro_stgmcard.bin and compares the memory writes and the
// tick return value.
//
// DECODED: exe-decomp/stgmcard_c/_asm/F0x80087fdc.s (37 lines) and
// F0x8008801c.s (37 lines). This is the engine/dw3/ui/fold-tween.ts arithmetic
// on a raw memory struct; it is NOT the same routine as the window-fold pair
// (0x80087EDC/0x80087F70) — that one is direction/±2x and is already ported in
// window-fold.ts. Field layout:
//   +0x00 steps
//   +0x08 value            the published 8.8 value (>> 8 of the accumulator)
//   +0x0C accumulator      value << 8
//   +0x10 target
//   +0x14 delta            ((target - from) << 8) / steps
//   +0x18 active
//
// start writes nothing when from == target. tick returns 1 once the value
// reaches the target STRICTLY past it (target < value when rising, value <
// target when falling) and clears active; otherwise 0.

export interface TweenLinearMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export const TWEEN_STEPS = 0x00;
export const TWEEN_VALUE = 0x08;
export const TWEEN_ACCUM = 0x0c;
export const TWEEN_TARGET = 0x10;
export const TWEEN_DELTA = 0x14;
export const TWEEN_ACTIVE = 0x18;

const s32 = (v: number): number => v | 0;

/** F0x80087FDC(obj, from, to, steps): begin the 8.8 tween. */
export function tweenLinearStart(
    mem: TweenLinearMemory,
    obj: number,
    from: number,
    to: number,
    steps: number,
): void {
    if (from === to) return;
    const start = s32(from);
    const target = s32(to);
    const count = s32(steps);
    const dividend = ((target - start) << 8) | 0;
    // MIPS `div` with a zero divisor: -1 for a non-negative dividend, +1 for a
    // negative one. (A zero step count is not reachable from the shipped call
    // sites; the oracle pins it because the instruction's quotient is defined.)
    const delta = count === 0 ? (dividend >= 0 ? -1 : 1) : Math.trunc(dividend / count);
    mem.write32(obj + TWEEN_STEPS, count >>> 0);
    mem.write32(obj + TWEEN_ACCUM, (start << 8) >>> 0);
    mem.write32(obj + TWEEN_VALUE, start >>> 0);
    mem.write32(obj + TWEEN_TARGET, target >>> 0);
    mem.write32(obj + TWEEN_ACTIVE, 1);
    mem.write32(obj + TWEEN_DELTA, delta >>> 0);
}

/** F0x8008801C(obj): advance one frame; 1 when it has landed. */
export function tweenLinearTick(mem: TweenLinearMemory, obj: number): number {
    if (s32(mem.read32(obj + TWEEN_ACTIVE)) === 0) return 1;
    const accum = (s32(mem.read32(obj + TWEEN_ACCUM)) + s32(mem.read32(obj + TWEEN_DELTA))) | 0;
    mem.write32(obj + TWEEN_ACCUM, accum >>> 0);
    const value = accum >> 8;
    mem.write32(obj + TWEEN_VALUE, value >>> 0);
    const delta = s32(mem.read32(obj + TWEEN_DELTA));
    const target = s32(mem.read32(obj + TWEEN_TARGET));
    if (delta > 0) {
        if (target < value) {
            mem.write32(obj + TWEEN_VALUE, target >>> 0);
            mem.write32(obj + TWEEN_ACTIVE, 0);
            return 1;
        }
        return 0;
    }
    if (value < target) {
        mem.write32(obj + TWEEN_VALUE, target >>> 0);
        mem.write32(obj + TWEEN_ACTIVE, 0);
        return 1;
    }
    return 0;
}
