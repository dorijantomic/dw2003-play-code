// The ordinary field camera — the one rule that decides which part of a stage's
// map fills the 320x240 screen while you walk.
//
// What a player meets: the room scrolls so that the character you are leading
// stays at a fixed spot on the screen until the map edge stops the scroll. That
// spot is (160, 140) native pixels from the top-left of the screen, and it is
// clamped to the map so the view never shows past an edge.
//
// DECODE — ~/ddw3/asm/dw2003/pro/fieldstg.s (overlay base 0x80082cb0):
//
//   * `F0x8008D998` is the resident type-0x10 field camera controller's
//     per-frame callback (`exe-decomp/fieldstg_c/F0x8008d998.c`). Its default
//     arm resolves the leader through the type-5 lookup `0x8004B7BC(5,-1,0)`
//     — fieldstg's resident "name 5" object is the character you control — and
//     copies that actor's world position (`+0x54`/`+0x58`) into the camera's
//     target (`+0x54`/`+0x58`). Scripted cases 1/2 override the target from
//     FN6A (actor snap/follow) or FN6B (a point), and case 1's `+0x14==1`
//     sub-mode eases toward the target in quarter/half steps — that path is the
//     cutscene pan, not free roam. In free roam the target is the leader, copied
//     every frame with no lag and no dead band.
//   * `F0x8008D788` (`exe-decomp/fieldstg_c/F0x8008d788.c`) submits that target
//     to the display. It loads the target and subtracts a FIXED view centre:
//         fieldstg_c/_asm/F0x8008d788.s .L0x0000ab18  addiu $s2, $v1, -0xa0   ; x = targetX - 160
//         fieldstg_c/_asm/F0x8008d788.s .L0x0000ab28  addiu $s3, $a0, -0x8c   ; y = targetY - 140
//     then clamps x to [0, mapW-0x140] and y to [0, mapH-0xF0] (the 320x240
//     view; the map width/height come from the type-4 dimension object), adds a
//     4-phase 8-byte shake offset table at `0x80097B38` (index `+0x60` cycling
//     1..4 while `+0x5C` is non-zero, with cue COMCD203/204), and calls the
//     display object's `+0x120` position setter with the pair shifted left 8.
//     The routine issues no draw call; it only positions the view.
//
//   The SAME 160x140 centre is already what the walker applies to the
//   capture-backed stages — `manifest.json` `cutsceneCameraCenter: [160, 140]`
//   on s415, consumed by the `nativeCenter` branch of `web/game.js`. The
//   ordinary-follow branch used `VIEW/2` = (160, 120), which sits the camera 20
//   map pixels too high: the original puts the leader 140 lines from the top of
//   the screen, not 120. That 20-pixel divergence is this module's whole reason
//   to exist.
//
// This is a shared system, ported once: every free-roam stage and every
// scripted camera target run through the same two numbers.

/** Native screen width the field camera is built against (0x140). */
export const CAMERA_VIEW_W = 320;
/** Native screen height the field camera is built against (0xF0). */
export const CAMERA_VIEW_H = 240;
/** Horizontal centre the camera target is placed at, `0xA0`. */
export const CAMERA_CENTRE_X = 0xa0;
/** Vertical centre the camera target is placed at, `0x8C` — 20 px below `VIEW_H/2`. */
export const CAMERA_CENTRE_Y = 0x8c;

export interface FieldCamera {
  /** Top-left corner of the view, in map pixels. */
  x: number;
  y: number;
}

/**
 * The camera top-left for a target, before the map clamp — `target - (160,140)`,
 * exactly the two `addiu` immediates in `F0x8008D788`.
 */
export function fieldCameraCentreOf(targetX: number, targetY: number): FieldCamera {
  return { x: targetX - CAMERA_CENTRE_X, y: targetY - CAMERA_CENTRE_Y };
}

function clampToView(v: number, ceiling: number): number {
  // The native's exact composition (F0x8008D788): clamp the LOW end to zero
  // first (`bgez` skips, else the value becomes 0), then apply the ceiling
  // unconditionally (`slt` ceiling < value -> value = ceiling). With a map
  // narrower or shorter than the view the ceiling is NEGATIVE and the camera
  // pins to it — the view shows the map right-aligned / bottom-aligned, not
  // pinned to zero. The walker's old clampInt returned zero there instead.
  return Math.min(Math.max(v, 0), ceiling);
}

/**
 * The ordinary free-roam camera: centre the target at (160,140) and clamp the
 * view inside the map — the same two-step clamp `F0x8008D788` applies before it
 * adds the shake offset. A map narrower than 320 or shorter than 240 pins the
 * camera to the negative ceiling (`mapW-320` / `mapH-240`), which the native
 * does because its ceiling test runs after the low clamp and is unconditional.
 */
export function fieldCameraFollow(
  targetX: number,
  targetY: number,
  mapW: number,
  mapH: number,
): FieldCamera {
  const { x, y } = fieldCameraCentreOf(targetX, targetY);
  return {
    x: clampToView(x, mapW - CAMERA_VIEW_W),
    y: clampToView(y, mapH - CAMERA_VIEW_H),
  };
}
