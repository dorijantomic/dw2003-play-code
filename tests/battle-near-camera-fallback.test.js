// An enemy-only Digimon on OUR side (an extra species, or a new partner's form) has a 0x48
// staging record: three far-side shots, no near table. Without a near table nothing ever cut a
// camera record, render() held on an empty frame and the arena never drew. nearCameraFor lends
// it the twelve near shots of the partner record whose stand-off is closest.
import test from "node:test";
import assert from "node:assert/strict";

const { nearCameraFor, arenaShotFor } = await import("../web/battle3d.js");

const shots = (n, tag) => ({
  eye: Array.from({ length: n }, (_, i) => [tag, i, 0]),
  look: Array.from({ length: n }, (_, i) => [tag, i, 1]),
  view: Array.from({ length: n }, () => 280),
});
const table = {
  5: { standoff: 384, hover: 0, camera: shots(12, 5) },      // partner, mid size
  12: { standoff: 704, hover: 0, camera: shots(12, 12) },    // partner, big
  32: { standoff: 640, hover: 0, shot: 1, camera: shots(3, 32) },   // enemy-only
  383: { standoff: 192, hover: 0, shot: 2, camera: shots(3, 383) }, // enemy-only, far side
};

test("a partner keeps its own near table", () => {
  assert.equal(nearCameraFor(table, "5"), table[5].camera);
});

test("an enemy-only Digimon borrows the near table of the closest stand-off", () => {
  assert.equal(nearCameraFor(table, "32"), table[12].camera);
  assert.equal(nearCameraFor(table, "383"), table[5].camera);
});

test("no record, no camera", () => {
  assert.equal(nearCameraFor(table, "999"), null);
  assert.equal(nearCameraFor(null, "5"), null);
});

test("the opening arena shot resolves with an enemy-only Digimon on the near side", () => {
  const shot = arenaShotFor(table, "m032kune", "m383pken");
  assert.deepEqual(shot.eye, [12, 1, 0]);
  assert.deepEqual(shot.target, [12, 1, 1]);
});
