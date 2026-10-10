// The screen dim — what every menu's leave-fade and the title screen's
// darkening actually are.
//
// DECODED 2026-09-03 from checked decompilation (authority 3) with the
// blending word read as the hardware defines it. Canonical write-up:
// docs/research/ui/screen-rendering-model.md section 4.
//
// TWO DIFFERENT THINGS SHARE ONE NAME.
//
// 1. The flat dim. `ststatus F0x80084d18` builds ONE untextured quad over the
//    whole screen -- corners (0,0), (320,0), (0,256), (320,256) -- with GP0
//    command 0x2A, colour (k,k,k) on all three channels, followed by the draw
//    mode word 0xE1000245. The same routine is compiled into fourteen further
//    overlays; `cardgame`, `fieldstg`, `cnty_sel`, `stcrdabm`, `stcrddek`,
//    `stcrdshp`, `stdgname`, `stfgtrep`, `stgdglab`, `stgmcard`, `stgtrain`,
//    `stitshop`, `wstag745` and `wstag746` all carry a copy.
//
//    Its ramp lives in the handler `F0x80084e5c`: an accumulator at +0x5C that
//    adds +0x60 every frame and stops at 0xFF00 going up or 0 coming down. The
//    published level is the accumulator's high byte.
//
// 2. The title screen's vignette, which is NOT that quad. `stdwtitl
//    F0x80085d64` builds FOUR gouraud triangles (GP0 command 0x32, tag word
//    count 6) in a fan about the screen centre (160, 120), one per screen
//    edge, taking each triangle's two outer points from the eight-byte records
//    at 0x80087DBC (`~/ddw3/asm/dw2003/pro/stdwtitl.s` L5197-L5204). The centre
//    vertex carries the level; both outer vertices carry twice the level,
//    saturating at 255. So the picture darkens from its edges inward and the
//    middle stays brightest -- a vignette, not a flat wash.
//
// WHAT THE BLENDING WORD MEANS, AND WHY IT MATTERS TO A RENDERER.
//
// 0xE1000245 is a draw-mode word. Its semi-transparency field is bits 5 and 6,
// and (0x245 >> 5) & 3 = 2. Hardware mode 2 is `background MINUS foreground`.
//
// So a dim in this game SUBTRACTS. It does not lay translucent black over the
// screen. Subtracting k gives max(0, c - k); blending black at opacity a gives
// c * (1 - a). Both finish at black, and everything between them differs: under
// subtraction a bright area stays bright far longer and a dark area reaches
// black much sooner. Every fade the walker drew before this module was the
// alpha curve, which is the wrong one.
//
// This module is the arithmetic only. The compositing lives in
// web/screendim.js, because it needs a canvas.

import { rsin } from "../rsin.ts";

/** The dim accumulator's full-scale value: 8.8 fixed point, 0xFF00 = level 255. */
export const DIM_FULL = 0xff00;

/** The leave fade every menu uses: 0xFF00 over 30 vsyncs. */
export const DIM_DEFAULT_FRAMES = 30;

/** The per-frame accumulator step for a dim of `frames` vsyncs. Integer, as the original's divide is. */
export function dimDelta(frames: number): number {
  return frames > 0 ? Math.trunc(DIM_FULL / frames) : DIM_FULL;
}

/**
 * The published dim level (0..255) after `frames` vsyncs of a ramp whose step
 * is `delta`. This is exactly `min(255, (frames * delta) >> 8)`, the shape the
 * screens already used -- it is gathered here so eight copies become one.
 */
export function dimLevelAtFrame(frames: number, delta: number = dimDelta(DIM_DEFAULT_FRAMES)): number {
  if (frames <= 0) return 0;
  return Math.min(255, (frames * delta) >> 8);
}

/** The same, driven by a clock. `startedAt` of null means no dim is running. */
export function dimLevelAtTime(
  now: number,
  startedAt: number | null,
  delta: number = dimDelta(DIM_DEFAULT_FRAMES),
  vsyncSeconds = 0.02,
): number {
  if (startedAt == null) return 0;
  // The epsilon keeps a clock that lands exactly on a vsync boundary from
  // floating a hair below it and losing a whole frame off the ramp.
  const frames = Math.max(0, Math.floor((now - startedAt) / vsyncSeconds + 1e-9));
  return dimLevelAtFrame(frames, delta);
}

/** True once the dim has reached full black and the screen may be swapped. */
export function dimComplete(frames: number, delta: number = dimDelta(DIM_DEFAULT_FRAMES)): boolean {
  return frames * delta >= DIM_FULL;
}

// ── the title screen's vignette ─────────────────────────────────────────────

/** The vignette runs 30 vsyncs; `F0x80085f44` hands over at counter 0x1E. */
export const TITLE_VIGNETTE_FRAMES = 0x1e;

/** The fan's shared vertex: the screen centre. */
export const TITLE_VIGNETTE_CENTRE = { x: 0xa0, y: 0x78 };

/**
 * The four outer edges, read as signed halfword pairs from 0x80087DBC. They
 * overshoot the screen -- 15 pixels above the top and 4 below the bottom -- so
 * the fan covers every pixel with no seam at the border.
 */
export const TITLE_VIGNETTE_EDGES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -15, 320, -15],   // top
  [320, -15, 320, 260], // right
  [0, 260, 320, 260],   // bottom
  [0, -15, 0, 260],     // left
];

/**
 * The outer vertices carry twice the centre's level. The original computes
 * `level * 2` and, the moment that reaches 0x100, stores -1 into a signed byte
 * -- which is 255. So the edges saturate at full black while the middle is
 * still only half dark.
 */
export function titleVignetteEdgeLevel(level: number): number {
  return level * 2 >= 0x100 ? 0xff : level * 2;
}

/**
 * The level curve, `F0x80085cd4`. It is a quarter sine, quantised to thirty
 * steps: the angle sweeps from 0 to just under a quarter turn over the thirty
 * frames, so the screen darkens quickly at first and then eases out.
 *
 * It goes through the shared `rsin`, which is the game's own sine folded over a
 * 0x1000-unit turn. That function's quarter-wave table is computed rather than
 * extracted -- see engine/dw3/rsin.ts -- so a value here can differ from a real
 * console by at most one unit in 4096. The `* 30 >> 12` below then buckets the
 * range into thirty steps, and at frame 23 the product sits about 26 units from
 * a bucket edge, which is inside that tolerance. So ONE frame of the thirty
 * could show one step, eight levels out of 255, away from the console for one
 * fiftieth of a second. `titleVignetteQuantisationMargin` reports the distance
 * so the claim stays measurable rather than remembered.
 */
export function titleVignetteLevel(frame: number): number {
  if (frame >= TITLE_VIGNETTE_FRAMES) return 0xff;
  if (frame <= 0) return 0;
  const angle = Math.trunc((frame << 10) / 30);          // 0 .. just under 0x400
  return Math.trunc(((rsin(angle) * 30) >> 12) * 0xff / 30);
}

/** How close the sine product sits to a bucket edge at `frame`, in units of 1/4096. */
export function titleVignetteQuantisationMargin(frame: number): number {
  const angle = Math.trunc((frame << 10) / 30);
  const exact = Math.sin((angle * 2 * Math.PI) / 0x1000) * 0x1000 * 30;
  return Math.min(exact - Math.floor(exact / 0x1000) * 0x1000,
                  Math.ceil(exact / 0x1000) * 0x1000 - exact);
}
