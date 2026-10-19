// closestCameraRef (web/battle3d.js): an extra form on our side borrows the camera of the partner closest to it in size and shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { closestCameraRef } from "../web/battle3d.js";

const camera = { camera: { eye: new Array(12).fill([0, 0, 0]) } };
const table = { 1: camera, 2: camera, 3: camera, 9: {} };            // 9 has no near camera of its own
const sizes = { 1: [700, 480], 2: [2600, 2700], 3: [9700, 7500], 9: [1000, 1000] };

test("a small model gets the small partner, a big one the big partner", () => {
  assert.equal(closestCameraRef(sizes, { h: 900, w: 600 }, table).key, "1");
  assert.equal(closestCameraRef(sizes, { h: 2500, w: 2400 }, table).key, "2");
  assert.equal(closestCameraRef(sizes, { h: 10000, w: 8000 }, table).key, "3");
});

test("only partners that carry their own camera shots are candidates", () => {
  assert.equal(closestCameraRef({ 9: [1000, 1000] }, { h: 1000, w: 1000 }, table), null);
});

test("shape breaks a tie in size: a tall thin model prefers a tall thin partner", () => {
  const t = { 1: camera, 2: camera };
  const s = { 1: [4000, 1000], 2: [2000, 4000] };                       // same frame size (4000), different shape
  assert.equal(closestCameraRef(s, { h: 3900, w: 1100 }, t).key, "1");
  assert.equal(closestCameraRef(s, { h: 2100, w: 3800 }, t).key, "2");
});

test("nothing is picked before the sizes or the model are known", () => {
  assert.equal(closestCameraRef(null, { h: 1, w: 1 }, table), null);
  assert.equal(closestCameraRef(sizes, null, table), null);
});

test("the measured size file covers every partner with a near camera", { skip: fs.existsSync("web/assets/battle/camera_ref_sizes.json") ? false : "needs the disc-derived data" }, () => {
  const placement = JSON.parse(fs.readFileSync("web/assets/battle/model_placement.json", "utf8")).models;
  const sizes2 = JSON.parse(fs.readFileSync("web/assets/battle/camera_ref_sizes.json", "utf8")).sizes;
  const withCam = Object.entries(placement).filter(([, v]) => (v.camera?.eye?.length | 0) >= 12).map(([k]) => k);
  assert.deepEqual(withCam.filter((k) => !sizes2[k]), []);
});
