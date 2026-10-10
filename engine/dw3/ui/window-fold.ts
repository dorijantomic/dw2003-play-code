// The window-fold tween, translated bit-exactly from the original EXE/overlay
// bodies (Phase 4 translation, docs/plans/2026-09-14-native-screen-port-plan.md).
//
// Oracle: tests/window-fold-oracle.test.js runs the original stitshop addresses
// F0x8008C2DC (start) and F0x8008C370 (tick) through engine/native and compares
// every touched field and the return value against this port.
//
// DECODED: docs/research/ui/window-fold-tween-homolog-family-2026-08-04.md —
// 15 start + 17 tick structural homologues across 13 modules, fingerprint-
// identical. The shared state is FOUR WORDS:
//
//   +0x00 duration   the caller's step count (vsyncs)
//   +0x04 delta      signed per-tick step, in 0x1000 = fully-open units
//   +0x08 value      published fold amount, 0 .. 0x1000
//   +0x0C active     nonzero while the tween runs
//
// start(obj, direction):
//   active = 1
//   open  (direction != 0): play SFX 0x40019; value = 0;
//                           delta =   0x1000 / duration
//   close (direction == 0): play SFX 0x4001A; value = 0x1000;
//                           delta = -(0x1000 / duration) * 2
// tick(obj):
//   if !active return 1
//   value += delta
//   delta > 0: if value <  0x1001 return 0; else value = 0x1000; active = 0; return 1
//   delta <= 0: if value >= 0      return 0; else value = 0;      active = 0; return 1
//
// The doubled closing step is original behaviour, not a rounding correction.
// The divide is the MIPS signed `div` (truncate toward zero), reproduced here
// including the hardware's divide-by-zero quotient, so the oracle matches even
// on the caller-error edge.
//
// RELATION TO fold-tween.ts: that module is the RENDERER-side convenience
// representation (an 8.8 fixed-point accumulator on a named struct), used by the
// walker to draw a folding window. Its curve is equivalent but not bit-identical
// to this memory layout, which is why the oracle proves THIS module. The two
// are not duplicates: this one is the executable contract, the other is the
// drawing helper.

/** Field offsets of the four-word fold state, matching the original object. */
export const FOLD_DURATION = 0x00;
export const FOLD_DELTA = 0x04;
export const FOLD_VALUE = 0x08;
export const FOLD_ACTIVE = 0x0c;

/** 0x1000 = fully open, the fold's unity (12.4 fixed point). */
export const FOLD_FULL = 0x1000;

/** The SFX pair the start routine plays; the host serves the actual sound. */
export const WINDOW_FOLD_OPEN_SFX = 0x40019;
export const WINDOW_FOLD_CLOSE_SFX = 0x4001a;

export interface FoldMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/**
 * MIPS signed `div` quotient, as engine/native/mips.ts computes it: truncation
 * toward zero, plus the hardware's defined quotients for divide-by-zero and the
 * INT_MIN / -1 overflow case. Kept local so the port is independent of the
 * interpreter it is checked against.
 */
function divLo(a: number, b: number): number {
    if (b === 0) return a >= 0 ? -1 : 1;
    if (a === -0x80000000 && b === -1) return -0x80000000;
    return (a / b) | 0;
}

/**
 * F0x8008C2DC (and its 14 structural homologues): begin a fold.
 * `direction` is the original's boolean — nonzero opens, zero closes.
 * The caller plays the SFX; this port only writes the state the oracle checks.
 */
export function windowFoldStart(mem: FoldMemory, obj: number, direction: number): void {
    const duration = mem.read32(obj + FOLD_DURATION) | 0;
    mem.write32(obj + FOLD_ACTIVE, 1);
    if ((direction | 0) !== 0) {
        mem.write32(obj + FOLD_VALUE, 0);
        mem.write32(obj + FOLD_DELTA, divLo(FOLD_FULL, duration));
    } else {
        mem.write32(obj + FOLD_VALUE, FOLD_FULL);
        mem.write32(obj + FOLD_DELTA, (-(divLo(FOLD_FULL, duration) << 1)) | 0);
    }
}

/**
 * F0x8008C370 (and its 16 structural homologues): advance one vsync.
 * Returns 1 when the fold is done (or was never running), 0 while it moves —
 * exactly the boolean the original's callers branch on.
 */
export function windowFoldTick(mem: FoldMemory, obj: number): number {
    if ((mem.read32(obj + FOLD_ACTIVE) | 0) === 0) return 1;
    const delta = mem.read32(obj + FOLD_DELTA) | 0;
    const value = (mem.read32(obj + FOLD_VALUE) + delta) | 0;
    mem.write32(obj + FOLD_VALUE, value);
    if (delta > 0) {
        if (value < FOLD_FULL + 1) return 0; // slti value, 0x1001 (signed)
        mem.write32(obj + FOLD_VALUE, FOLD_FULL);
        mem.write32(obj + FOLD_ACTIVE, 0);
        return 1;
    }
    if (value >= 0) return 0; // bgez value (signed)
    mem.write32(obj + FOLD_VALUE, 0);
    mem.write32(obj + FOLD_ACTIVE, 0);
    return 1;
}
