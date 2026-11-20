// The one leave fade the hand-authored screens share: dim the frame to black
// over a fixed number of vsyncs, then close. Nine screens had written the same
// eight lines out (the 0xFF00 ceiling, the step, the 8.8 level and the landing
// test), three of them with a different clock and two with a different count.
//
// The original runs one ramp object for all of them: the start method stores
// the direction and `+0x60 = 0xFF00 / frames` (MIPS signed div), the handler
// adds the step to the 8.8 word each vsync and clamps at 0xFF00 or 0, and the
// draw paints the word >> 8 as the per-channel dim. The count is the caller's:
// 0xA (ten frames) where a screen's exit band says so — the card album
// (screen-object-methods.md:263), the folder deck (:205) and the pause page's
// dim-quad (:296) — and 0x1E (thirty) for the gym (:108), the fight report
// (:231), the lab/desk (:183), the card shop (cards-gap:124), the continent
// select (menus-gap:260), the item shop (town-gap:183) and the save screen.
export const LEAVE_FADE_MAX = 0xff00;
export const VSYNC_MS = 20;
export const VSYNC_S = VSYNC_MS / 1000;

/** The step a ramp of `frames` vsyncs stores at +0x60: 0xFF00 / frames, truncated. */
export function leaveFadeStep(frames) {
  return Math.trunc(LEAVE_FADE_MAX / frames) | 0;
}

/** Whole vsyncs since `t0`, on a clock counted in milliseconds (performance.now). */
export function leaveFadeFramesMs(nowMs, t0Ms) {
  return Math.max(0, Math.floor((nowMs - t0Ms) / VSYNC_MS));
}

/** The same on a clock counted in seconds (the screen's own simulation time). */
export function leaveFadeFrames(nowS, t0S) {
  return Math.max(0, Math.floor((nowS - t0S) / VSYNC_S));
}

/** The dim level 0..1 after `frames` vsyncs of a ramp stepping by `step`. */
export function leaveFadeLevel(frames, step) {
  return Math.min(255, (frames * step) >> 8) / 255;
}

/** The ramp has landed: the screen can close. */
export function leaveFadeDone(frames, step) {
  return frames * step >= LEAVE_FADE_MAX;
}
