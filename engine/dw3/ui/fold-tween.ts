// The window-open animation every DDW3 menu uses.
//
// DECODED: ledger UI-C001 (the family: 15 start + 17 tick homologues across 13
// resident and overlay modules) and UI-STGMCARD-FOLD-AND-TABLES-001, which gives
// the exact four-word field layout and arithmetic:
//
//   start(obj, from, to, steps):
//     +0x00 steps
//     +0x08 value                       the published value
//     +0x0C value << 8                  the 8.8 fixed-point accumulator
//     +0x10 target = to
//     +0x14 delta  = ((to - from) << 8) / steps
//     +0x18 active = 1
//   tick():
//     +0x0C += delta
//     +0x08  = +0x0C >> 8
//     clamp DIRECTION-CORRECTLY at the target
//     return 1 when done
//
// What the value drives — UI-Q001, RESOLVED 2026-08-13 with no rig:
// in fieldstg, stfgtrep, stitshop and stgtrain alike the caller passes it as
//   setScale(value, 0x1000, 0x1000)
// through draw-context slot +0x8c, reached via stack slot sp+0x9c under an
// sp+0x10 context base — the SAME slot and base in all four.
// Claims UI-C-FOLD-VALUE-IS-SCALE, UI-C-FOLD-{STFGTREP,STITSHOP,STGTRAIN}-
// VALUE-IS-SCALE-2026-08-13.
//
// So a window opens by scaling from 0 to unity on ONE axis while the other two
// stay at unity.
//
// WHICH AXIS — SETTLED 2026-09-03, docs/research/ui/screen-rendering-model.md
// section 10. The first of the three scale terms multiplies the matrix's first
// column, which is the X input axis, so the first term is the horizontal one.
// The gym is the worked case: its chrome draw sets seven scales whose first
// term is a field of the screen and whose other two terms are 0x1000, and every
// one of those seven fields sits exactly +0x08 into a sixteen-byte block --
// which is this tween's `value` slot. Each is hinged on a fixed point at x = 0,
// x = 320 or one interior seam, so the panel widens from an edge.
//
// Counted over all 318 scale calls in the game: 213 animate the horizontal
// term, 69 the vertical, and exactly one passes a third term at all (a zero).
// So width is the ordinary fold and height is the exception -- but 69 calls is
// not a rounding error, and callers still pass the axis rather than assuming.
//
// The save screen additionally ADDS the value to the window's Y for a slide-in
// (UI-STGMCARD-FOLD-AND-TABLES-001: from 0x97, to 0, steps 0xA — a 151-pixel
// vertical slide over 10 vsyncs). That is a per-screen use of the same value,
// not a different tween.

/**
 * A window SHUTS IN HALF THE TIME IT OPENS.
 *
 * DECODED: docs/research/ui/window-fold-tween-homolog-family-2026-08-04.md.
 * The start routine branches on its direction argument. Opening sets value to 0
 * and delta to +(0x1000 / duration). Closing sets value to 0x1000 and delta to
 * -2 * (0x1000 / duration) -- the same duration, twice the step. The document
 * states plainly that the doubling is original behaviour, not a rounding
 * correction.
 */
export const FOLD_CLOSE_RATE = 2;

/**
 * The two window sounds, from the same routine: opening plays packed SFX
 * 0x40019, closing plays 0x4001A. A window in this game is never silent.
 */
export const FOLD_OPEN_SFX = 0x40019;
export const FOLD_CLOSE_SFX = 0x4001a;

/** 4.12 fixed-point unity — the fold's "fully open" value, and the scale unity. */
export const FOLD_MAX = 0x1000;

/** The four-word tween object, named rather than offset-addressed. */
export interface FoldTween {
  steps: number;   // +0x00
  value: number;   // +0x08  published; this is what callers pass to setScale
  accum: number;   // +0x0C  value << 8
  target: number;  // +0x10
  delta: number;   // +0x14
  active: boolean; // +0x18
}

export function createFoldTween(): FoldTween {
  return { steps: 0, value: 0, accum: 0, target: 0, delta: 0, active: false };
}

/**
 * Begin a fold. `steps` is in vsyncs — menus use 0xA (10 frames, 0.2s PAL).
 * A zero or negative `steps` lands on the target immediately rather than
 * dividing by zero.
 */
export function startFold(t: FoldTween, from: number, to: number, steps: number): void {
  t.steps = steps;
  t.value = from;
  t.accum = from << 8;
  t.target = to;
  // INTEGER division, as the original's MIPS div does. A float here leaves the
  // fold a fraction short of its target on the final step and costs an extra
  // frame, which is exactly what the test caught.
  t.delta = steps > 0 ? Math.trunc(((to - from) << 8) / steps) : 0;
  t.active = true;
  if (steps <= 0) {
    t.value = to;
    t.accum = to << 8;
    t.active = false;
  }
}

/**
 * Begin a close. The same `steps` as the matching open, because the original
 * hands the same duration to both and gets a shorter animation out of the
 * doubled step -- see FOLD_CLOSE_RATE. Passing a halved `steps` here instead
 * would double-count the speed-up.
 */
export function startFoldClose(t: FoldTween, steps: number): void {
  startFold(t, FOLD_MAX, 0, steps);
  if (steps > 0) t.delta = Math.trunc((-FOLD_MAX << 8) / steps) * FOLD_CLOSE_RATE;
}

/**
 * Advance one vsync. Returns true when the fold has landed — which is exactly
 * the boolean the original's callers branch on to gate a state transition.
 *
 * The clamp is direction-correct: a rising fold clamps at or above the target,
 * a falling one at or below it. A single-sided clamp would overshoot on the
 * slide-in case, where `to` is less than `from`.
 */
export function tickFold(t: FoldTween): boolean {
  if (!t.active) return true;
  t.accum += t.delta;
  // Arithmetic shift, matching MIPS sra: floors for negative accumulators too,
  // which a divide-and-truncate would not.
  t.value = t.accum >> 8;
  const rising = t.delta >= 0;
  if ((rising && t.value >= t.target) || (!rising && t.value <= t.target)) {
    t.value = t.target;
    t.accum = t.target << 8;
    t.active = false;
    return true;
  }
  return false;
}

/** True once the window has finished opening — labels draw only after this. */
export function foldComplete(t: FoldTween): boolean {
  return !t.active;
}

/**
 * The scale triple the original passes to draw-context +0x8c every animating
 * frame: the fold value on the chosen axis, unity on the other two.
 *
 * The caller supplies the axis because the original does not distinguish it in
 * any evidence we have — see the note at the top of this file. Do not guess one
 * here; a screen that knows its window slides vertically passes "y".
 */
export function foldScale(t: FoldTween, axis: FoldAxis): { x: number; y: number; z: number } {
  return {
    x: axis === "x" || axis === "xy" ? t.value : FOLD_MAX,
    y: axis === "y" || axis === "xy" ? t.value : FOLD_MAX,
    z: FOLD_MAX,
  };
}

/**
 * True while the fold should be drawn scaled at all. The original skips the
 * setScale call entirely when the value is 0 (not started) or exactly FOLD_MAX
 * (fully open), taking a different branch in both cases.
 */
export function foldIsAnimating(t: FoldTween): boolean {
  return t.value !== 0 && t.value !== FOLD_MAX;
}

/** The fold as 0..1, which is the form a canvas transform wants. */
export function foldProgress(t: FoldTween): number {
  return Math.min(1, Math.max(0, t.value / FOLD_MAX));
}

/**
 * Everything a renderer needs to draw one folding window, in the exact shape
 * web/shop.js uses — the implementation the operator has confirmed correct
 * against the real game.
 *
 * The original scales AROUND A PIVOT: draw-context slot +0x94 sets the anchor
 * (`UI-DRAWCTX-VTABLE-001`), and the same function that calls set-scale through
 * sp+0x9c calls set-anchor through sp+0xa4 — confirmed in stfgtrep, stitshop
 * and stgtrain assembly on 2026-08-13. A renderer therefore translates to the
 * pivot, scales one axis, and translates back.
 *
 * `ready` is the boolean the original's callers branch on: labels and contents
 * draw only once the window has landed.
 */
/**
 * Which axis the fold scales. "xy" scales both together — the status menu uses
 * it for windows that grow from a corner rather than unrolling along one edge.
 */
export type FoldAxis = "x" | "y" | "xy";

export interface FoldTransform {
  ready: boolean;
  progress: number;
  pivotX: number;
  pivotY: number;
  scaleX: number;
  scaleY: number;
}

export function foldTransform(
  t: FoldTween,
  pivotX: number,
  pivotY: number,
  axis: FoldAxis,
): FoldTransform {
  const p = foldProgress(t);
  return {
    ready: p >= 1,
    progress: p,
    pivotX,
    pivotY,
    scaleX: axis === "y" ? 1 : p,
    scaleY: axis === "x" ? 1 : p,
  };
}

/**
 * The same transform driven by a free-running clock instead of a tween object,
 * which is how web/shop.js currently animates. `startedAt` of null means the
 * window was never animated and is already open.
 *
 * Menus use steps = 0xA, i.e. 10 vsyncs = 0.2s at PAL — the duration the shop
 * uses and the value `UI-STGMCARD-FOLD-AND-TABLES-001` records at its one
 * pinned call site.
 */
export const FOLD_DEFAULT_STEPS = 0xa;
export const FOLD_DEFAULT_SECONDS = 0.2;

export function foldTransformAtTime(
  now: number,
  startedAt: number | null,
  pivotX: number,
  pivotY: number,
  axis: FoldAxis,
  duration = FOLD_DEFAULT_SECONDS,
): FoldTransform {
  const p = startedAt == null
    ? 1
    : Math.min(1, Math.max(0, (now - startedAt) / duration));
  return {
    ready: p >= 1,
    progress: p,
    pivotX,
    pivotY,
    scaleX: axis === "y" ? 1 : p,
    scaleY: axis === "x" ? 1 : p,
  };
}

/**
 * The closing animation, driven by the same clock as `foldTransformAtTime`.
 *
 * Pass the SAME `duration` the window opened with. The halving happens here,
 * because the doubled step is a property of the tween, not of the caller --
 * see FOLD_CLOSE_RATE.
 *
 * `progress` runs from 1 down to 0, so a renderer uses it as the scale exactly
 * as it does when opening. `ready` means the window has finished shutting and
 * the screen may be taken down.
 */
export function foldCloseTransformAtTime(
  now: number,
  startedAt: number | null,
  pivotX: number,
  pivotY: number,
  axis: FoldAxis,
  duration = FOLD_DEFAULT_SECONDS,
): FoldTransform {
  const closeSeconds = duration / FOLD_CLOSE_RATE;
  const t = startedAt == null
    ? 1
    : Math.min(1, Math.max(0, (now - startedAt) / closeSeconds));
  const p = 1 - t;
  return {
    ready: p <= 0,
    progress: p,
    pivotX,
    pivotY,
    scaleX: axis === "y" ? 1 : p,
    scaleY: axis === "x" ? 1 : p,
  };
}
