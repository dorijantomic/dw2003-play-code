// The 3D battle picture is its own canvas under the 2D game canvas (web/battle-layer.js): the pure rules
// that decide when a frame may stay in the layer, and the layer's own DOM bookkeeping on a fake page.
import test from "node:test";
import assert from "node:assert/strict";
import {
  noteBackdropBlend, takeBackdropBlends, setFlatReader, flatFrameWanted, layerFrameOk,
  createBattleLayer, showBattleLayer, releaseBattleLayer, isBattleLayer,
} from "../web/battle-layer.js";
import { effectsBlendBackdrop } from "../web/fight/effect-player.js";

test("layerFrameOk: only a plain frame stays in the layer", () => {
  assert.equal(layerFrameOk(false, false, false), true);
  assert.equal(layerFrameOk(true, false, false), false);   // a blend drew last frame
  assert.equal(layerFrameOk(false, true, false), false);   // a blend is certain this frame
  assert.equal(layerFrameOk(false, false, true), false);   // a reader wants a flat frame
});

test("backdrop blends are counted and taken once", () => {
  takeBackdropBlends();
  noteBackdropBlend(); noteBackdropBlend();
  assert.equal(takeBackdropBlends(), 2);
  assert.equal(takeBackdropBlends(), 0);
});

test("flat readers: any one on means a flat frame, all off means the layer", () => {
  assert.equal(flatFrameWanted(), false);
  setFlatReader("a", true); setFlatReader("b", true);
  assert.equal(flatFrameWanted(), true);
  setFlatReader("a", false);
  assert.equal(flatFrameWanted(), true);
  setFlatReader("b", false);
  assert.equal(flatFrameWanted(), false);
});

test("effectsBlendBackdrop: semi 1, 2 and 3 blend with the picture under them, 0 and plain do not", () => {
  const manifest = { archives: { 5: { clips: {
    10: { semi: 0 }, 11: { semi: 1 }, 12: { semi: 2 }, 13: { semi: 3 }, 14: {},
    "11@4": { semi: 0 },
  } } } };
  const one = (frame, clutShift = 0) => [{ arch: 5, frame, clutShift }];
  assert.equal(effectsBlendBackdrop(one(10), manifest), false);
  assert.equal(effectsBlendBackdrop(one(14), manifest), false);
  assert.equal(effectsBlendBackdrop(one(11), manifest), true);
  assert.equal(effectsBlendBackdrop(one(12), manifest), true);
  assert.equal(effectsBlendBackdrop(one(13), manifest), true);
  assert.equal(effectsBlendBackdrop(one(11, 4), manifest), false, "the palette-cycled variant is the clip drawn");
  assert.equal(effectsBlendBackdrop([{ arch: 9, frame: 11 }], manifest), false, "unknown archive draws nothing");
  assert.equal(effectsBlendBackdrop([...one(10), ...one(13)], manifest), true, "one blended sprite is enough");
  assert.equal(effectsBlendBackdrop([], manifest), false);
  assert.equal(effectsBlendBackdrop(null, manifest), false);
});

// A page just big enough for createBattleLayer: parent, game canvas, document, getComputedStyle.
function fakePage(parentPosition = "static") {
  const mk = () => ({ style: {}, dataset: {}, removed: false, remove() { this.removed = true; } });
  const parent = Object.assign(mk(), { style: { position: "" }, computed: parentPosition, children: [],
    insertBefore(el, ref) { this.children.splice(this.children.indexOf(ref), 0, el); } });
  const game = Object.assign(mk(), { width: 1600, height: 1200, parentElement: parent, style: { position: "", background: "" } });
  parent.children.push(game);
  globalThis.document = { createElement: () => mk() };
  globalThis.getComputedStyle = (el) => ({ position: el.computed });
  return { parent, game };
}

test("layer: created under the game canvas, same size, shown and hidden, released cleanly", () => {
  const { parent, game } = fakePage("static");
  const layer = createBattleLayer(game);
  assert.equal(parent.children[0], layer, "first in the parent = painted under the game canvas");
  assert.equal(parent.children[1], game);
  assert.equal(layer.className, "battle-fs", "same CSS box and image-rendering as the game canvas");
  assert.equal(isBattleLayer(layer), true);
  assert.equal(isBattleLayer(game), false);
  assert.deepEqual([layer.width, layer.height], [1600, 1200]);
  assert.equal(layer.style.cssText.includes("visibility:hidden"), true);
  assert.equal(game.style.position, "relative", "positioned so the DOM order decides the stacking");
  assert.equal(parent.style.position, "relative", "a static parent gets positioned for the layer");

  assert.equal(showBattleLayer(true), true);
  assert.equal(layer.style.visibility, "visible");
  assert.equal(game.style.background, "transparent", "the game canvas lets the 3D picture through");
  showBattleLayer(false);
  assert.equal(layer.style.visibility, "hidden");
  assert.equal(game.style.background, "");

  showBattleLayer(true);
  releaseBattleLayer();
  assert.equal(layer.removed, true);
  assert.equal(game.style.position, "");
  assert.equal(game.style.background, "");
  assert.equal(parent.style.position, "");
  assert.equal(showBattleLayer(true), false, "no layer after release");
  releaseBattleLayer();   // twice is fine
});

test("layer: a second battle replaces the first one's canvas", () => {
  const { parent, game } = fakePage("relative");
  const first = createBattleLayer(game);
  const second = createBattleLayer(game);
  assert.notEqual(first, second);
  assert.equal(first.removed, true);
  assert.equal(parent.style.position, "", "a positioned parent is left alone");
  releaseBattleLayer();
});

test("layer: no parent means no layer (battle.js falls back to the copy)", () => {
  fakePage();
  assert.equal(createBattleLayer({ width: 1, height: 1, style: {}, parentElement: null }), null);
});
