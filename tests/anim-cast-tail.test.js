// A15 — the RETARGETED CAST'S TAIL. Two regressions, both measured on the shipped code paths.
//
// The operator's report (Boltmon, spell): after the shot the model "resets to a flat pose (hands and feet
// against the body)" and "a second axe appears". Root cause: applyCastBake re-based the donor's playlist
// by adding the frame offset to EVERY loop_target, but a pure LOOP marker's loop_target is a TABLE INDEX.
// The shifted index (50 -> 6050 in an 82-entry table) walked the sampler off the end of the table, where
// every read is frame 0 = the bind pose; Boltmon's pack carries the THROWN axe as a second mesh (bone 19)
// that the idle scales to 0, so the bind pose drew it at full size.
//
// Test 1 pins the playlist arithmetic over EVERY baked gap row (data, not a species list).
// Test 2 pins the pose the renderer would draw: a built cast never draws the bind pose.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import * as b3 from "../web/battle3d.js";
import { applyCastBake } from "../web/fight/anim-retarget.js";
import { ANIM_DONOR_GAPS, donorRow } from "../web/fight/anim-donor-map.js";
import { resolveClipScript, registerDonorAnim, setFallbackDonor, prepareModelDonors, setDonorLoader } from "../web/fight/clip-fallback.js";
import { ActorAnimator } from "../web/fight/actor-animator.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE = fs.existsSync(path.join(MODELS, "m190bolt/anim.json"));
const skip = HAVE ? false : "model packs are not installed";
const read = (folder) => JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));

const isRanged = (clip, script) =>
  clip === 9 || clip === 13 || (script?.ops ?? []).some((o) => o.op === 6 && (o.words?.[0] | 0) === 0);

test("a baked playlist keeps every pure LOOP marker's target INSIDE its own table", { skip }, () => {
  let baked = 0, markers = 0;
  for (const folder of Object.keys(ANIM_DONOR_GAPS)) {
    for (const clip of Object.keys(ANIM_DONOR_GAPS[folder])) {
      if (Number(clip) === 5) continue;
      const row = donorRow(folder, Number(clip));
      if (!row) continue;
      let donor, target;
      try { donor = read(row.d); target = read(folder); } catch { continue; }
      const script = donor.actions?.[clip];
      if (!script || !isRanged(Number(clip), script)) continue;
      const bake = applyCastBake(target, donor, Number(clip));
      if (!bake?.table) continue;                       // the gate rejected the pair: nothing is played
      baked++;
      const tab = target.timeline[bake.table].table;
      for (const e of tab) {
        if ((e.value | 0) !== 0x8000) continue;         // only the PURE loop marker carries an index
        markers++;
        assert.ok((e.loop_target | 0) < tab.length,
          `${folder} clip ${clip}: loop target ${e.loop_target} outside a ${tab.length}-entry table`);
      }
      // the frames the table plays must lie inside the keys the bake appended (6000..offset+range)
      for (const e of tab) {
        const v = e.value | 0;
        if (v >= 0 && v < 0x8000) assert.ok(v >= 6000, `${folder} clip ${clip}: un-shifted frame ${v}`);
      }
    }
  }
  assert.ok(baked > 20 && markers > 0, `baked ${baked} tables, ${markers} loop markers`);
});

test("a retargeted cast never draws the model's bind pose", { skip }, async () => {
  setFallbackDonor(read("m005grey").actions);
  const folder = "m172mtar";                              // a K16 USED pair (Ice Shower builds from a bake)
  const donorFolder = donorRow(folder, 9).d;
  registerDonorAnim(donorFolder, read(donorFolder));
  const pack = read(folder);
  pack.folder = folder;
  setDonorLoader((f) => Promise.resolve(read(f)));
  await prepareModelDonors(pack);                          // the K16 bake is made at model load
  const a = new ActorAnimator(pack);
  a.resetSlotPlacement({ x: 0, y: -900, z: -5120, side: "player" });
  const script = resolveClipScript(pack, 9, { element: 4, target: "enemy", tech: "Ice Shower" });
  assert.ok(script?.retargeted, "the pair bakes (the fixture is a retargeted cast)");
  a.setAction(9, {}, { element: 4, target: "enemy", tech: "Ice Shower" });
  const bind = (() => {
    const m = { ...pack, bones: pack.bones.map((b) => ({ ...b, anim: { ...(b.anim || {}), ch2: [[0, 0, 0, 0]] } })) };
    return b3.buildBoneWorldMatrices(m, 0, null).mats.map((x) => [x[12], x[13], x[14]]);
  })();
  const dist = (mats) => {
    let d = 0;
    for (let i = 0; i < mats.length; i++) if (mats[i] && bind[i]) d = Math.max(d, Math.hypot(mats[i][12] - bind[i][0], mats[i][13] - bind[i][1], mats[i][14] - bind[i][2]));
    return d;
  };
  let flat = 0, n = 0, worst = 0;
  for (let tick = 0; tick < 200 && a.vm && !a.vm.ended; tick++) {
    a.tick(2);
    if (tick % 6) continue;
    n++;
    const d = dist(b3.buildBoneWorldMatrices(pack, a.currentFrame(), a.currentBlend()).mats);
    worst = Math.max(worst, d);
    if (d === 0) flat++;
  }
  assert.ok(n > 10, `sampled ${n} ticks`);
  assert.equal(flat, 0, "no tick is drawn in the bind pose");
  assert.ok(worst > 100, `the cast travels (${Math.round(worst)} units from the bind pose)`);
});
