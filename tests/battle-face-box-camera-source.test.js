// The face box's camera has to come out of the PLAYER'S record, so the shipped data has to
// carry it and the renderer has to read it off the player's own model key. Four source
// guards, no imports, so they run against any tree: each one names the line of the original
// it enforces.
//
//   tools/extract_smdldata.py   FIGHTSTG_F0x80091C1C, fightstg.s:15355-15409 — the group is
//                               picked by the side and read at record+0x1A+6g, +0x62+6g and
//                               +0xAA+2g, with Y and Z negated.
//   web/fight/battle-camera.js  FIGHTSTG_F0x80094064, fightstg.s:17805-17840 — one fighter
//                               record, handed over as both the index (+0x14) and the
//                               record, so the speaker cannot move it.
//   web/battle3d.js             FIGHTSTG_F0x80091B8C, fightstg.s:15316-15352 — the look-at
//                               is built from that stored eye and target, at that H, with
//                               the player's fighter as the subject.
//                               web/battle3d.js previously guessed a camera from the model's
//                               bounding box (head height, 85% of body height, 40 degrees),
//                               which is the thing this port removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the extractor reads the two face-box groups at the offsets the routine uses", () => {
  const src = read("tools/extract_smdldata.py");
  assert.match(src, /FACE_BOX_EYE_AT = 0x1A/);
  assert.match(src, /FACE_BOX_TARGET_AT = 0x62/);
  assert.match(src, /FACE_BOX_H_AT = 0xAA/);
  assert.match(src, /FACE_BOX_GROUPS = \(6, 7\)/);
});

test("the shipped placement data carries the framing for every record", () => {
  const data = JSON.parse(read("web/assets/battle/model_placement.json"));
  const rows = Object.values(data.models);
  assert.equal(rows.length, 248);
  for (const r of rows) {
    assert.ok(Array.isArray(r.face_box) && r.face_box.length === 2,
      `record ${r.resource} has no face_box rows`);
  }
  // The two sides must differ, or "pick the side's group" would be untestable.
  const k = Object.keys(data.models)[0];
  assert.ok(JSON.stringify(data.models[k].face_box[0])
         !== JSON.stringify(data.models[k].face_box[1]));
});

test("the renderer builds the box camera from the PLAYER's record, never the speaker's", () => {
  const src = read("web/battle3d.js");
  // fightstg.s:17819-17829 — one manager lookup, and its +0x14 and the record itself both
  // come from it. The record is therefore chosen once, by the player.
  assert.match(src, /faceBoxSource\(placementTable, modelKeyFromFolder\(playerFolder\)/,
    "the box's record must be the player's fighter's, from the player's own model key");
  // Nothing may pick the box's record, its buffers or its placement off the enemy.
  assert.doesNotMatch(src, /enemySpeaks \? enemyFolder : playerFolder/,
    "the box must not follow the speaker's model folder");
  assert.doesNotMatch(src, /_faceBoxBuffers\(gl, /,
    "the box has one subject, so it has one position buffer");
  assert.doesNotMatch(src, /boxPos\(tKey\)/,
    "the box's subject is placed from the player's own record, not from a per-side lookup");
  // And the subject it draws is the player's mesh, buffers, texture and bones.
  assert.match(src, /_updateSkeletalVBOGL\(gl, playerModel, boxBufs, pBwm, boxPos/,
    "the box must draw the player's fighter");
  assert.doesNotMatch(src, /enemySpeaks \? enemyModel : playerModel/);
  assert.match(src, /faceBoxFovY\(faceShot\.H\)/,
    "the box must project at the record's own projection distance");
  // The old guess: eye = head height - 20% of body height, distance = 85% of body height,
  // 40 degree vertical field of view. It is GONE, and nothing stands in its place either:
  // F0x80091c1c reads the record's own projection distance and hands it to the view with no
  // test on it (fightstg.s:153cc4 -> :153bf0 -> exe/fns.s:29902), so a record whose distance
  // is not a distance projects nothing at all rather than getting a camera of ours. See
  // tests/battle-face-box-projection.test.js.
  assert.doesNotMatch(src, /\/\/ Aim at the head \(just below the AABB top\)/,
    "the head-aimed camera comment is gone; the framing is the record's now");
  assert.doesNotMatch(src, /FALLBACK, OURS/,
    "there is no fallback framing left to have to say it is ours");
  assert.match(src, /const boxDraws = faceBoxDraws\(faceShot\)/,
    "the record's own projection distance is what decides whether the box draws");
});

test("the shared rule lives in one place, in the camera module", () => {
  // One function, so no caller can re-derive "whose record" on its own.
  const cam = read("web/fight/battle-camera.js");
  assert.match(cam, /export function faceBoxSource\(placementTable, playerModelKey, side\)/);
  assert.match(cam, /record = \(key != null && placementTable\) \? \(placementTable\[key\]/);
  assert.equal((cam.match(/export function faceBoxSource/g) || []).length, 1);
  const b3d = read("web/battle3d.js");
  assert.equal((b3d.match(/faceBoxShot\(/g) || []).length, 0,
    "the renderer must go through faceBoxSource, not call the shot picker itself");
});
