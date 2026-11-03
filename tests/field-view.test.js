// HD Remaster wide overworld (web/field-view.js, F2 -> Screen -> Wide overworld, off by default): the view
// width from the screen's shape, the wide camera clamp around the original 320 box, which scenes keep the
// original framing, and the wide canvas backing / pointer mapping (web/canvas-resolution.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  widePadFor, mapFitsWide, wideBoxCameraX, scriptIsStaged, fieldFrameRule, easeLevel,
  setFieldViewPad, FIELD_VIEW_W, FIELD_VIEW_PAD,
} from "../web/field-view.js";
import { fieldCameraFollow } from "../engine/systems/field-camera.ts";
import { createCanvasResolutionController, canvasEventToLogical } from "../web/canvas-resolution.js";

test("pad: 4:3 is the original, 16:9 is 427 wide, 21:9 is the cap", () => {
  assert.equal(widePadFor(640, 480), 0);
  assert.equal(widePadFor(1920, 1080), 53);          // round(240 * 16/9) = 427 -> (427 - 320) / 2
  assert.equal(widePadFor(2560, 1080), 120);         // 21:9 -> 560
  assert.equal(widePadFor(5120, 1080), 120);         // wider than 21:9 is capped
  assert.equal(widePadFor(1000, 1000), 0);           // narrower than 4:3 never shrinks the view
  assert.equal(widePadFor(0, 0), 0);
});

test("live view width follows the pad", () => {
  setFieldViewPad(53);
  assert.equal(FIELD_VIEW_PAD, 53);
  assert.equal(FIELD_VIEW_W, 426);
  setFieldViewPad(0);
  assert.equal(FIELD_VIEW_W, 320);
});

test("wide camera: centred like the original, box in the middle, clamped inside the map", () => {
  const pad = 53, mapW = 1280;
  // Mid-map: the box sits exactly where the original puts it (target - 160).
  assert.equal(wideBoxCameraX(640, mapW, pad), 640 - 160);
  assert.equal(wideBoxCameraX(640, mapW, pad), fieldCameraFollow(640, 300, mapW, 896).x);
  // Left edge: the WIDE view's left edge stops at 0, so the box is pad in.
  assert.equal(wideBoxCameraX(10, mapW, pad), pad);
  // Right edge: the wide view's right edge stops at the map's.
  assert.equal(wideBoxCameraX(1270, mapW, pad) + 320 + pad, mapW);
  // A map narrower than the wide view keeps the original framing.
  assert.equal(mapFitsWide(400, pad), false);
  assert.equal(wideBoxCameraX(200, 400, pad), null);
  assert.equal(mapFitsWide(426, pad), true);
});

test("staged scenes: anything that moves an actor or the camera; a plain talk is not", () => {
  assert.equal(scriptIsStaged(["SAY 1 2", "WAITCTX", "END"]), false);
  assert.equal(scriptIsStaged(["SETANIM 3 1 1", "SAY 1 2", "END"]), false);
  assert.equal(scriptIsStaged(["SAY 1 2", "WALKTO 3 100 200", "END"]), true);
  assert.equal(scriptIsStaged(["SETPOS 3 0 0"]), true);
  assert.equal(scriptIsStaged(["FN6A 3 1"]), true);
  assert.equal(scriptIsStaged(["  FN6B 100 200"]), true);
  assert.equal(scriptIsStaged(null), false);
});

test("frame rule", () => {
  const base = { pad: 53, mapW: 1280 };
  assert.deepEqual(fieldFrameRule({ ...base }), { wideCamera: true, showSides: true });
  assert.deepEqual(fieldFrameRule({ ...base, fullScreenUi: true }), { wideCamera: true, showSides: false });
  for (const k of ["stagedScene", "fixedViewport", "nativeCentre", "labCamera"])
    assert.deepEqual(fieldFrameRule({ ...base, [k]: true }), { wideCamera: false, showSides: false }, k);
  assert.deepEqual(fieldFrameRule({ ...base, mapW: 400 }), { wideCamera: false, showSides: false });
  assert.deepEqual(fieldFrameRule({ pad: 0, mapW: 1280 }), { wideCamera: false, showSides: false });
});

test("ease", () => {
  assert.equal(easeLevel(0, 1, 0.1, 4), 0.4);
  assert.equal(easeLevel(1, 0, 1, 10), 0);
  assert.equal(easeLevel(0.5, 0.5, 1), 0.5);
});

function fakeCanvas(cssW, cssH) {
  const listeners = {};
  const view = { devicePixelRatio: 1, addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener() {} };
  const canvas = {
    width: 640, height: 480, clientWidth: cssW, clientHeight: cssH, dataset: {},
    ownerDocument: { defaultView: view, addEventListener() {}, removeEventListener() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: cssW, height: cssH }),
  };
  const calls = [];
  const ctx = { setTransform: (...a) => calls.push(a), imageSmoothingEnabled: false, imageSmoothingQuality: "low" };
  return { canvas, ctx, calls };
}

test("backing: the wide canvas is the box plus padX each side, the box shifted to the middle", () => {
  const { canvas, ctx, calls } = fakeCanvas(1440, 1080);
  const res = createCanvasResolutionController(canvas, ctx);
  // 53 native px = 106 logical px each side; stage 1080 tall at dpr 1.
  const f = res.beginFrame(true, { padX: 106, stageHeight: 1080 });
  assert.equal(canvas.height, 1080);
  assert.equal(canvas.width, Math.round(1080 * (640 + 212) / 480));
  assert.equal(f.padX, 106);
  const [a, , , d, e] = calls.at(-1);
  assert.ok(Math.abs(a - d) < 0.01, "square pixels");
  assert.ok(Math.abs(e - 106 * a) < 1e-9, "box origin padX in");
  // Pointer: the canvas's left edge is -padX in box coordinates, its middle the box's middle.
  canvas.clientWidth = canvas.width; canvas.clientHeight = canvas.height;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height });
  assert.equal(canvasEventToLogical(canvas, { clientX: 0, clientY: 0 }).x, -106);
  assert.ok(Math.abs(canvasEventToLogical(canvas, { clientX: canvas.width / 2, clientY: 0 }).x - 320) < 1e-9);
  // Off again: the backing takes the box's own shape back from the (still wide) CSS box.
  res.beginFrame(true, null);
  assert.equal(canvas.width, Math.round(canvas.height * 640 / 480));
  assert.equal(calls.at(-1)[4], 0);
});

test("Authentic never goes wide", () => {
  const { canvas, ctx, calls } = fakeCanvas(1920, 1080);
  const res = createCanvasResolutionController(canvas, ctx);
  res.beginFrame(false, { padX: 106, stageHeight: 1080 });
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 480);
  assert.equal(calls.at(-1)[4], 0);
});
