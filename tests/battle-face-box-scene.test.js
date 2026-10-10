// What the battle close-up box DRAWS, not just where it is and when it is up.
//
// tests/battle-face-box.test.js owns the box's on-screen rule and
// tests/battle-face-box-camera.test.js owns the camera inside it (the record's own group 6/7
// shot). This file owns the third thing: the box is a window onto the SAME 3D scene, so the
// stage is in it.
//
// The original, read:
//   fightstg.s:17774-17781  the box driver writes the rectangle 208,76,100,60 and registers
//                            it as layer key 0x1009 — a view, not a sprite slot.
//   fightstg.s:17795        +0x118(0x102, 0x6A): the window's centre, 258,106.
//   fightstg.s:17800        +0x148(0x32). `+0x148` is exe/fns.s F0x8001e1e8, which stores the
//                            argument at view+0x78 and allocates argument*20 bytes: 0x32 = 50
//                            is the view's ORDERING-TABLE DEPTH, not a half-width.
//   exe/fns.s F0x8001d504   the render pass: for all 30 views, if view+0x84 (the enable flag
//                            `+0x15C` sets) then view+0x158 (push the projection distance,
//                            F0x8001e470 -> GTE register 26), view+0x160, then view+0x154
//                            = F0x8001e38c, which walks that view's own table and calls each
//                            submitted entry.
//   exe/fns.s F0x8001e240   `+0x14C`: append {sortKey, extra, a, b} and splice it into the
//                            table's linked list SORTED ASCENDING on the key.
// So the battle view and the box are two separate views with two separate tables over the
// same scene — which is what the reference frame shows:
// docs/research/battle/captures/face-box-rounds-2026-10-03/1-round1-menu-box-up.png has the
// battle stage's cloud sky across the top third of the box and its grass floor and far cliff
// below the head.
//
// The port therefore draws the stage objects the battle view ALREADY has in the same frame —
// no second sky texture, no second floor — through the box's own camera, and only the head
// after them. `faceBoxScene` is that ordered list, in one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cam = () => import("../web/fight/battle-camera.js");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the box's draw list contains the stage: sky, then floor, then the head", async () => {
  const { faceBoxScene } = await cam();
  const scene = faceBoxScene();
  assert.deepEqual(scene.map((i) => i.what), ["sky", "floor", "subject"]);
  // Order matters and is the point: the backdrop is BEHIND the head, which is why the box
  // needs it at all. A list that put the subject first would show the head against nothing.
  assert.ok(scene.findIndex((i) => i.what === "floor")
         < scene.findIndex((i) => i.what === "subject"));
  assert.ok(scene.findIndex((i) => i.what === "sky")
         < scene.findIndex((i) => i.what === "floor"));
});

test("the stage goes through the BOX camera; only the screen-space sky quad does not", async () => {
  const { faceBoxScene } = await cam();
  const by = Object.fromEntries(faceBoxScene().map((i) => [i.what, i]));
  // The walker's sky is a clip-space quad drawn with the identity MVP so it covers whatever
  // viewport it lands in — inside the 100x60 box viewport that is exactly the box.
  assert.equal(by.sky.mvp, "identity");
  // The floor and the head are world geometry and MUST go through the box's own projection,
  // or the arena would not line up with the head standing in it.
  assert.equal(by.floor.mvp, "box");
  assert.equal(by.subject.mvp, "box");
});

test("the box's backdrop follows the battle view's own backdrop rule", async () => {
  const { faceBoxScene } = await cam();
  // Normal battle: the walker's gradient sky.
  const normal = faceBoxScene({ backdropOnly: false });
  assert.equal(normal.find((i) => i.what === "sky").tex, "sky");
  assert.ok(normal.some((i) => i.what === "floor"));
  // While a special attack has replaced the arena with its own backdrop, the battle view
  // drops the floor and paints the flat void (web/battle3d.js render(), the sky/floor block).
  // The box must not keep a floor the main view no longer has.
  const special = faceBoxScene({ backdropOnly: true });
  assert.deepEqual(special.map((i) => i.what), ["sky", "subject"]);
  assert.equal(special.find((i) => i.what === "sky").tex, "void");
  assert.deepEqual(special.find((i) => i.what === "sky").tint, [0, 0, 0, 1]);
});

test("the head is always last, with or without a stored framing", async () => {
  const { faceBoxScene } = await cam();
  // 196 of the 248 records carry no stored group 6/7 and fall back to the walker's own head
  // camera. That fallback moves the CAMERA, not the list: the backdrop is drawn either way,
  // so those Digimon also get sky and ground behind them.
  for (const backdropOnly of [false, true]) {
    const scene = faceBoxScene({ backdropOnly });
    assert.equal(scene[scene.length - 1].what, "subject");
    assert.equal(scene.filter((i) => i.what === "subject").length, 1);
  }
});

test("the renderer draws the box's list inside the box window, and reuses the frame's stage", () => {
  const src = read("web/battle3d.js");
  // One loop over the shared list — the renderer must not grow a second, private draw order.
  // The list is asked for once and walked once; `draws` is the record's own projection
  // distance, so an unusable record empties the list instead of substituting a camera
  // (tests/battle-face-box-projection.test.js).
  assert.match(src, /const scene = faceBoxScene\(\{\s*backdropOnly: dfActive \|\| dnaVoidActive, draws: boxDraws,\s*\}\);/);
  assert.match(src, /for \(const item of scene\)/);
  assert.match(src, /if \(item\.what === "sky"\)/);
  assert.match(src, /else if \(item\.what === "floor"\)/);
  assert.match(src, /drawQuad\(gl, texP, mvp, skyBufs,/);
  assert.match(src, /drawQuad\(gl, texP, mvp, floorBufs, arenaTexture \|\| whiteTex/);
  // The stage objects are the ones render() already built for the battle view: the sky quad
  // and texture, and the arena floor buffers and texture. Each is built exactly once in the
  // file, at the top of the renderer, so the box cannot be loading its own copy.
  assert.equal((src.match(/const skyBufs = makeQuadBuffers/g) || []).length, 1,
    "the sky quad must be built once, for the battle view, and shared");
  assert.equal((src.match(/const floorBufs = makeQuadBuffers/g) || []).length, 1,
    "the arena floor must be built once, for the battle view, and shared");
  assert.equal((src.match(/skyTexture = gl\.createTexture\(\)/g) || []).length, 1);
  assert.equal((src.match(/arenaTexture = gl\.createTexture\(\)/g) || []).length, 1);
  // Both are declared before the face-box block, so they are already resident when it runs.
  assert.ok(src.indexOf("const skyBufs = makeQuadBuffers")
         < src.indexOf("// ── Face-cam:"), "the sky quad must exist before the box draws it");
  assert.ok(src.indexOf("const floorBufs = makeQuadBuffers")
         < src.indexOf("// ── Face-cam:"), "the arena floor must exist before the box draws it");
  // And the backdrop only appears once the scissor is on the box window, so it cannot leak
  // into the battle view: the viewport/scissor pair must come before the scene loop.
  const iWindow = src.indexOf("gl.scissor(fx, glY, fw, fh);");
  const iScene = src.indexOf("for (const item of scene)");
  assert.ok(iWindow > 0 && iScene > iWindow,
    "the box's backdrop must be drawn after the scissor is set to the box window");
});

test("the shared list is defined once, next to the box's other rules", () => {
  const c = read("web/fight/battle-camera.js");
  assert.equal((c.match(/export function faceBoxScene/g) || []).length, 1);
  // It belongs with the box's window and camera, not somewhere the renderer can bypass.
  assert.ok(c.indexOf("export function faceBoxScene") > c.indexOf("export const FACE_BOX_RECT"));
});

test("the box's window is the rectangle, and 50 is the table's depth", async () => {
  const { FACE_BOX_RECT, FACE_BOX_CENTRE, FACE_BOX_HALF_W, FACE_BOX_ORDERING_TABLE } = await cam();
  // fightstg.s:17774-17781 — the rectangle is what clips the picture.
  assert.deepEqual(FACE_BOX_RECT, { x: 208, y: 76, w: 100, h: 60 });
  // :17795 — +0x118(0x102, 0x6A) is the window's centre, which is the rectangle's centre.
  assert.deepEqual(FACE_BOX_CENTRE, { x: 258, y: 106 });
  assert.equal(FACE_BOX_CENTRE.x, FACE_BOX_RECT.x + FACE_BOX_RECT.w / 2);
  assert.equal(FACE_BOX_CENTRE.y, FACE_BOX_RECT.y + FACE_BOX_RECT.h / 2);
  // :17800 — +0x148(0x32) is the ordering table's DEPTH (F0x8001e1e8 stores the count at
  // view+0x78 and allocates count*20 bytes), NOT a half-width. Both earlier passes read it as
  // one; the half-width is the rectangle's, and it is derived from the rectangle so the two
  // cannot drift apart again.
  assert.equal(FACE_BOX_ORDERING_TABLE, 50);
  assert.equal(FACE_BOX_HALF_W, FACE_BOX_RECT.w / 2);
});