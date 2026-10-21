// An enemy-only species the player owns plays its far-side-authored camera operands from the NEAR side. Its preset 1
// ("cut to the near fighter") framed the attacker itself; the mirror turns it to the opposing fighter.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mirrorCameraWords, mirrorPresetShot, authoredSide } from "../web/fight/side-mirror.js";
import { op5ShotSlot } from "../web/battle3d.js";

test("an explicit camera transform is turned half way round the arena", () => {
  const w = [0, 1, -1280, 998, 3200, 422, 832, 5529, 100, 5, -200, 0, 0, 0, 0, 226];
  const m = mirrorCameraWords(w);
  assert.deepEqual([m[2], m[4], m[5], m[7], m[8], m[10]], [1280, -3200, -422, -5529, -100, 200]);
  assert.deepEqual([m[0], m[1], m[3], m[6], m[9], m[15]], [w[0], w[1], w[3], w[6], w[9], w[15]], "heights, lens and flags are untouched");
  assert.notEqual(m, w, "the original operands are not modified");
  assert.equal(w[2], -1280);
});

test("a preset operand list is returned as it came", () => {
  const w = [0, 0, 1];
  assert.equal(mirrorCameraWords(w), w);
});

test("the victim shots (presets 1-4) become the far fighter shots, the attacker own shots (5-7) the near fighter shots", () => {
  assert.deepEqual(mirrorPresetShot(1), { side: "enemy", index: 0 });
  assert.deepEqual(mirrorPresetShot(2), { side: "enemy", index: 1 });
  assert.deepEqual(mirrorPresetShot(3), { side: "enemy", index: 2 });
  assert.deepEqual(mirrorPresetShot(4), { side: "enemy", index: 2 }, "the far fighter has three shots");
  assert.deepEqual(mirrorPresetShot(5), { side: "player", index: 8 });
  assert.deepEqual(mirrorPresetShot(7), { side: "player", index: 10 });
  assert.equal(mirrorPresetShot(0), null);
  assert.equal(mirrorPresetShot(8), null);
});

test("it is always the opposite slot of what the unmirrored preset reads", () => {
  for (const p of [1, 2, 3, 4, 5, 6, 7]) assert.notEqual(mirrorPresetShot(p).side, op5ShotSlot(p).side, `preset ${p}`);
});

test("Meramon is an enemy-authored script, and a clip of it opens on preset 1 (the near fighter)", { skip: fs.existsSync("web/assets/battle/models/m009mera/anim.json") ? false : "needs the disc-derived data" }, () => {
  const model = JSON.parse(fs.readFileSync("web/assets/battle/models/m009mera/anim.json", "utf8"));
  assert.equal(authoredSide(model), "enemy");
  const presets = model.actions.flatMap((a) => (a?.ops ?? []).filter((o) => o.op === 5 && o.words[1] === 0).map((o) => o.words[2]));
  assert.ok(presets.includes(1), "the authored cut is preset 1");
});

// A script built from a DONOR or the model's own body drops the authored camera CUT: an op5 preset names a
// SLOT, so a cut written for the donor frames the wrong fighter once the script is mirrored (A10/A11 C8).
// A built script is therefore always marked "own" and carries no op5; only an owner's own clip keeps its cut.
import { setFallbackDonor, resolveClipScript } from "../web/fight/clip-fallback.js";

test("a built script drops the authored cut and is marked own, so the camera is not turned twice", () => {
  const donor = [];
  donor[9] = { ops: [{ op: 5, words: [0, 0, 3] }, { op: 255, words: [] }] };      // a spell: a camera preset, then end
  donor[6] = { ops: [{ op: 255, words: [] }] };
  setFallbackDonor(donor);
  const model = { actions: [] };
  model.actions[5] = { ops: [{ op: 2, words: [0, 0, 2] }, { op: 5, words: [0, 0, 1] }, { op: 255, words: [] }] };   // its own basic attack
  model.timeline = { 2: { table: [1] } };
  const spell = resolveClipScript(model, 9, { element: 2 });
  assert.equal(spell.camAuthored, "own", "a built spell carries no donor cut");
  assert.equal(spell.ops.find((o) => o.op === 5), undefined, "the donor's preset is dropped");
  const combo = resolveClipScript(model, 6, { element: 1 });
  assert.equal(combo.camAuthored, "own", "a combo is the model's own basic attack plus the effect");
  assert.equal(combo.ops.find((o) => o.op === 5), undefined, "and its own cut is dropped too");
  assert.equal(resolveClipScript(model, 5), model.actions[5], "its own clip is returned as it is");
  setFallbackDonor(null);
});
