// web/blast-presentation.js — the non-sprite half of the form-change transformation.
//
// WHAT THIS USED TO BE, AND WHY IT IS SMALLER NOW
// ----------------------------------------------
// Until 2026-08-13 this file drew procedural EVOLUTION ribbons, a flame wall, a
// data-burst hexagram and a circuit fill, all marked WALKER VISUAL, because the
// record said the transformation's actor scripts were undecoded and needed a rig
// capture. That was wrong twice over. Tracing it (claims
// form-change-sequences-are-message-strings-2026-08-13 and
// blast-dv-visuals-are-e000evol-effects-2026-08-13) showed:
//
//   * the "sequences" 0x61/0x62/0x37/0x38 are MESSAGE STRINGS, not clips;
//   * the visuals come from FIGHTSTG_F0x80089cd8, which spawns effect ids
//     0x3E8/0x3E9/0x3EA/0x3EB (manual DV) and 0x3EF/0x3EA/0x3F0 (Blast) — types
//     1000-1003, 1007, 1008, every one file **E000EVOL**, and every one ALREADY
//     EXTRACTED into web/assets/battle/effects/.
//
// So the ribbons, fire, hexagram and circuit fill are gone: they were a hand-made
// approximation of art this repository already shipped. The real sprites are
// spawned through the ordinary EffectPlayer (battle3d `blastSpawnEffect`) and
// drawn by the same op3 path every technique uses.
//
// What remains here is the part that is NOT a sprite: the two-layer curtain the
// controller animates itself, and the full-frame washes.

/**
 * Is the digivolution cutscene switched on?
 *
 * This is the pause menu's "Digivolve Demo" setting. It lives here rather than
 * in menu.js so that battle.js can read it without importing the menu, which
 * would close an import cycle (menu.js already imports battle.js).
 *
 * Default ON — the authentic game, which has this screen but no way to open it
 * (ledger UI-DEMO-SETUP-SCREEN-HAS-NO-SELECTOR-WRITE-2026-08-14).
 */
export function digivolveDemoOn() {
  try { return localStorage.getItem("digivolveDemo") !== "0"; } catch { return true; }
}

export function setDigivolveDemo(on) {
  try { localStorage.setItem("digivolveDemo", on ? "1" : "0"); } catch { /* ignore */ }
}


/**
 * The curtain is decoded. `F0x80089cd8` keeps four halfwords at +0x60..+0x6E and
 * steps them against the frame delta, driving display layers 0x1004 and 0x1003
 * through their +0x110/+0x114 methods. Its extents are `0x140 x 0xF0` —
 * **320 x 240**, the full frame — which is why the capture shows the arena
 * squeezed away to black from the top and bottom at once.
 */
export const NATIVE_W = 320;
export const NATIVE_H = 240;

/** The 320x240 game area inside a device-pixel canvas. */
export function nativeRect(w, h) {
  const scale = Math.min(w / NATIVE_W, h / NATIVE_H);
  return { scale, x: (w - NATIVE_W * scale) / 2, y: (h - NATIVE_H * scale) / 2 };
}

/**
 * How far the curtain has closed, 0..1, from the presentation state.
 *
 * The controller closes it in its case 3 and reopens it in case 8, each time by
 * stepping the halfwords until they hit the 0 / 0xF0 limits. The walker drives
 * the same shape off the decoded phase boundaries rather than off a live
 * halfword, so the CLOSE and OPEN points are captured and the ramp between them
 * is a WALKER VISUAL.
 */
export function curtainClosed(s) {
  if (!s) return 0;
  // Closed across the vortex, the transformation and the resolve; open again by
  // the time the camera returns.
  return Math.max(0, Math.min(1, s.voidAlpha));
}

/**
 * Paint the curtain UNDER the E000EVOL sprites of the transformation over the composited 3D
 * frame, in DEVICE pixels. Call it after the 3D blit and BEFORE the battle
 * chrome — the capture keeps both HP plates on top of the whole effect.
 *
 * The E000EVOL sprites are NOT drawn here; they go through the effect player and
 * are composited by the op3 path in battle.js draw().
 */
export function drawBlastCurtain(ctx, s, w, h) {
  // Deliberately draws NOTHING, and that is a finding rather than a stub.
  //
  // The controller's +0x60..+0x6E halfwords are not black bars: they are the
  // extents of display layers 0x1004 and 0x1003, one shrinking from 0xF0 to 0
  // while the other grows from 0 to 0xF0. It is a layer SWAP — the battle view
  // gives way to the effect stage — and its visible result in the runtime
  // capture is simply that the background turns black, which the renderer
  // already does with its void.
  //
  // Implementing it as two closing black bars was wrong twice: geometrically it
  // covers the entire frame at full closure (top half + bottom half = all of
  // it), so it hid the transforming Digimon AND the E000EVOL sprites it was
  // meant to sit behind.
  //
  // Kept as a named no-op so the compositor's ordering comment stays true and
  // the next person does not re-add bars. Which walker layer each of 0x1003 /
  // 0x1004 corresponds to is NOT established.
  void ctx; void s; void w; void h;
}

export function drawBlastFlash(ctx, s, w, h) {
  if (!s || s.flashAlpha <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = s.flashAlpha;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
