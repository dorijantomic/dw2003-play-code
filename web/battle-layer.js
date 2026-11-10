// battle-layer.js — the 3D battle picture as its OWN canvas, stacked under the 2D game canvas.
//
// Before: the battle's WebGL canvas was an OffscreenCanvas that battle.js copied into the 2D game canvas
// with ctx.drawImage every frame. Chrome does that copy on the GPU; Firefox reads the whole WebGL frame
// back to the CPU first (measured 89.7 ms of a 99 ms frame at 1600x1200 on Central Park, High).
// Now: the WebGL canvas is a real <canvas> in the same parent, directly under the game canvas, with the
// same size and CSS (class "battle-fs": same box, same image-rendering). While it is shown the 2D game
// canvas is cleared instead of filled, so the 3D picture shows through and the browser stacks the two on
// the GPU. No pixels of the WebGL canvas are copied.
//
// Two things a transparent 2D canvas cannot do, so a frame that needs either is drawn the old way (3D
// copied into the 2D canvas, layer hidden), which gives the same picture:
//   1. A draw that BLENDS with the pixels already under it (PSX semi-transparent sprites: additive
//      "lighter", subtractive "difference"/"multiply", the screen dims). Those call noteBackdropBlend().
//   2. A reader of the finished frame: the pixel filter, the HD-2D look, a screenshot, a clip recording,
//      the debug frame copy. A WebGL canvas can only be read in the task that drew it, so a reader asks
//      for a flat frame with setFlatReader(name, true) (or the page sets window.__flatFrame = true).

let blends = 0;
/** A draw just used a blend that needs the pixels under it (additive, subtractive, screen dim). */
export function noteBackdropBlend() { blends++; }
/** How many such draws happened since the last call (battle.js asks once per frame). */
export function takeBackdropBlends() { const n = blends; blends = 0; return n; }

const flatReaders = new Set();
/** A reader of the finished game frame is on (true) or off (false). The battle draws flat frames while any is on. */
export function setFlatReader(name, on) { if (on) flatReaders.add(name); else flatReaders.delete(name); }
/** True while something needs the 3D picture inside the 2D game canvas. */
export function flatFrameWanted() {
  return flatReaders.size > 0 || (typeof window !== "undefined" && !!(window.__flatFrame || window.__frameCopy));
}

/**
 * Whether this frame can keep the 3D picture in its own layer. It cannot when a draw blends with the
 * pixels under it: one did last frame (`blendedBefore`, from takeBackdropBlends), or one is certain this
 * frame (`certain`: the effect list holds a blended sprite, the defeat fade is up); or a reader needs a flat frame.
 */
export function layerFrameOk(blendedBefore, certain, flatWanted = flatFrameWanted()) {
  return !(blendedBefore || certain || flatWanted);
}

let layer = null;   // { canvas, game, parent, parentPosition, shown, gamePosition, gameBackground }

/** Remove the layer and give the game canvas its own style back. Safe to call any time. */
export function releaseBattleLayer() {
  const l = layer;
  if (!l) return;
  layer = null;
  l.game.style.position = l.gamePosition;
  l.game.style.background = l.gameBackground;
  if (l.parentPosition != null) l.parent.style.position = l.parentPosition;
  l.canvas.remove();
}

/**
 * Make a fresh WebGL canvas under `game` (same parent, same size, hidden until shown). A new canvas per
 * battle: a canvas keeps its first WebGL context. Returns null when there is no page to put it in.
 */
export function createBattleLayer(game) {
  releaseBattleLayer();
  const parent = game?.parentElement;
  if (!parent || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.className = "battle-fs";
  canvas.dataset.battleLayer = "1";
  canvas.width = game.width; canvas.height = game.height;
  canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;visibility:hidden";
  // Both canvases positioned, no z-index: they stack in DOM order, so the layer (first) is the lower one.
  let parentPosition = null;
  if (getComputedStyle(parent).position === "static") { parentPosition = parent.style.position; parent.style.position = "relative"; }
  layer = { canvas, game, parent, parentPosition, shown: false,
    gamePosition: game.style.position, gameBackground: game.style.background };
  game.style.position = "relative";
  parent.insertBefore(canvas, game);
  return canvas;
}

/** Show or hide the 3D layer (and make the game canvas see-through or opaque to match). False = no layer. */
export function showBattleLayer(on) {
  const l = layer;
  if (!l) return false;
  if (l.shown !== on) {
    l.shown = on;
    l.canvas.style.visibility = on ? "visible" : "hidden";
    l.game.style.background = on ? "transparent" : l.gameBackground;
  }
  return true;
}

/** True for the layer canvas (lets "find the game canvas" code skip it). */
export function isBattleLayer(el) { return !!el?.dataset?.battleLayer; }
