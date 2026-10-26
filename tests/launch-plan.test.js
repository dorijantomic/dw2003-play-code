// K13 — the LAUNCH PLAN: how many projectiles a built technique fires and from WHICH bone of this model.
//
// The rule under test is the user's own (BRIEF5 K14): a body that fires from three mouths fires three
// fireballs, one per head; a single-shot move fires once from the primary site; an arm that is a gun fires
// from that arm's tip. The plan is pure arithmetic over the authored anatomy + bone map (K11/K12/K14), so
// these tests read the model packs only for the skeleton poses and skip when the packs are not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import * as A from "../web/fight/digimon-anatomy.js";
import * as B from "../web/fight/digimon-bonemap.js";
import * as LP from "../web/fight/launch-plan.js";
import { restPose } from "../web/fight/anim-retarget.js";
import { resolveClipScript, prepareModelDonors, registerDonorAnim, setFallbackDonor, scriptTableSeq } from "../web/fight/clip-fallback.js";
import { donorRow } from "../web/fight/anim-donor-map.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE_PACKS = fs.existsSync(path.join(MODELS, "m138delt/anim.json"));
const read = (folder) => JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
const skip = HAVE_PACKS ? false : "model packs are not installed";

/**
 * A skeleton-shaped stub for one model: as many bones as its bone map uses, all parented to the root and
 * holding a single static key, so the arithmetic (which bone, how many launches) can be checked without
 * the disc-derived packs. Pose values are meaningless - only the bone indices matter here.
 */
function stubModel(folder) {
  const m = B.boneMap(folder);
  let max = 0;
  const scan = (v) => {
    if (Array.isArray(v)) for (const x of v) scan(x);
    else if (typeof v === "number" && v > max) max = v;
  };
  for (const v of Object.values(m)) scan(v);
  const bones = Array.from({ length: max + 1 }, () => ({ parent_slot: 0, anim: { ch1: [[0, 0, 0, 0]], ch2: [[0, 0, 0, 0]] } }));
  return { folder, num_bones: bones.length, bones, timeline: [], actions: [] };
}

// ── the data half: no skeletons needed ────────────────────────────────────────────────────────────
test("every emitter id resolves to a bone of that model, and to the RIGHT limb", () => {
  let ids = 0, sidedBlind = 0, noArm = 0;
  for (const folder of A.FOLDERS) {
    const map = B.boneMap(folder);
    const low = B.sideConfidence(folder) === "low";
    const arms = B.armChains(folder, "left").length + B.armChains(folder, "right").length;
    for (const e of A.emitters(folder)) {
      const bone = LP.emitterBone(folder, e.id);
      assert.equal(typeof bone, "number", `${folder}/${e.id}: bone resolved`);
      ids++;
      const site = /^(left-arm|right-arm)-(\d+)$/.exec(e.id);
      const sided = /^(left-arm|right-arm|both-arms)/.test(e.id);
      // K12's side audit is the gate: a LOW-side model must not launch from a named arm, and a rig with no
      // arm chain has no arm to launch from - both fire from the model's centre / body emitter instead.
      if (sided && low) {
        assert.equal(bone, LP.centreEmitterBone(folder), `${folder}/${e.id}: side-blind -> the centre emitter`);
        sidedBlind++;
        continue;
      }
      if (sided && !arms) {
        assert.equal(bone, LP.bodyEmitterBone(folder), `${folder}/${e.id}: no arm chain -> the body emitter`);
        noArm++;
        continue;
      }
      // an arm site is that arm's own hand: the last bone of the arm chain of that side
      if (site) {
        const chains = B.armChains(folder, site[1] === "left-arm" ? "left" : "right");
        const chain = chains[(site[2] | 0) - 1] || chains[0];
        assert.equal(bone, chain[chain.length - 1], `${folder}/${e.id}: the tip of arm #${site[2]}`);
      } else if (map.f?.[e.part] != null) {
        assert.equal(bone, map.f[e.part], `${folder}/${e.id}: the bone map's firing bone`);
      }
    }
  }
  assert.equal(ids, 862, "every emitter entry of all 244 models is covered");
  assert.ok(sidedBlind > 0 && noArm > 0, `side-blind ${sidedBlind}, no-arm ${noArm}`);
});

test("a left-arm gun is a LEFT-arm bone, a mouth is the mouth bone, a three-headed body has three sites", () => {
  // Minotarumon: anatomy says the left arm is a gun and the right is a fist
  assert.equal(LP.emitterBone("m172mtar", "left-arm"), B.armChain("m172mtar", "left").at(-1));
  assert.notEqual(LP.emitterBone("m172mtar", "left-arm"), B.armChain("m172mtar", "right").at(-1));
  // Deltamon: its own mouth plus the mouth on each arm
  const sites = LP.emitterBones("m138delt").map((s) => s.id).sort();
  assert.deepEqual(sites, ["left-arm", "mouth", "right-arm"]);
  // the second arm of a four-armed rig is a separate chain where the bone map carries one (Kabuterimon)
  assert.notEqual(LP.emitterBone("m019kabu", "left-arm-2"), LP.emitterBone("m019kabu", "left-arm"));
  assert.equal(LP.emitterBone("m019kabu", "left-arm-2"), B.armChains("m019kabu", "left")[1].at(-1));
  // ...and a rig the map gives only one arm on that side falls back to it rather than to no bone
  assert.equal(LP.emitterBone("m060hkab", "left-arm-2"), LP.emitterBone("m060hkab", "left-arm"));
  // Kabuterimon's side read is LOW confidence (K12 side audit): its arm sites fire from the CENTRE emitter
  // rather than from a left/right bone the audit could not establish
  assert.equal(LP.emitterBone("m060hkab", "left-arm"), LP.centreEmitterBone("m060hkab"));
  assert.equal(LP.emitterBone("m060hkab", "left-arm-2"), LP.centreEmitterBone("m060hkab"));
});

test("the shots rule decides the launch count for every technique of every model", () => {
  let launch = 0, contact = 0, none = 0;
  for (const folder of A.FOLDERS) {
    for (const tech of Object.keys(A.ANATOMY[folder].tech || {})) {
      const rule = A.shotsFor(folder, tech);
      const model = stubModel(folder);
      const plan = LP.launchPointsFor(model, { folder, tech, volley: false });
      if (rule.mode === "per-limb-contact") { contact++; assert.equal(plan.points.length, 0, `${folder}/${tech}: a contact move launches nothing`); assert.ok(plan.limbs.length >= 1, `${folder}/${tech}: names a striking limb`); }
      else if (rule.mode === "none") { none++; assert.equal(plan.points.length, 0); }
      else {
        launch++;
        // the point count is the rule's shot count: one per site, times the site's own barrel/eye count
        assert.equal(plan.points.length, rule.shots, `${folder}/${tech}: ${plan.points.length} launches vs ${rule.shots} shots`);
        for (const p of plan.points) assert.equal(typeof p.bone, "number", `${folder}/${tech}: launch has a bone`);
        assert.deepEqual([...new Set(plan.points.map((p) => p.id))], rule.emitters, `${folder}/${tech}: the rule's sites`);
      }
    }
  }
  assert.ok(launch > 300 && contact > 250 && none > 250, `kinds counted: ${launch}/${contact}/${none}`);
});

// ── the geometry half: real skeletons ────────────────────────────────────────────────────────────
test("a launch point sits on its emitter's tip: the weapon's when the arm carries a prop, else the bone's", { skip }, () => {
  for (const [folder, tech, volley] of [["m138delt", "Triple Fire", true], ["m172mtar", "Ice Blow", false], ["m005grey", "Flame Ball", false]]) {
    const model = read(folder);
    const plan = LP.launchPointsFor(model, { tech, volley, table: null });
    assert.ok(plan.points.length >= 1, `${folder}/${tech}: plans a launch`);
    const H = 3000; // any body: the ring spread is a small share of height; compare to the point itself
    for (const p of plan.points) {
      // A15 (C15): the launch point is the WEAPON's tip when the arm's K17 data says it ends in a prop
      // (an axe blade, a gun muzzle), else the hand bone's own tip - launch-plan.tipPointFor is the one
      // place that decides, and the contract's C11/C15 cross-checks the same function.
      const want = LP.tipPointFor(model, p, p.frame);
      assert.ok(want, `${folder}/${tech}/${p.id}: the plan's own tip resolves`);
      const d = Math.hypot(want[0] - p.x, want[1] - p.y, want[2] - p.z);
      assert.ok(d <= LP.LAUNCH_SPREAD * H, `${folder}/${tech}/${p.id}: point within the ring of its tip (${Math.round(d)})`);
      // and the prop verdict really is the model data's: an armed arm fires from a prop tip
      const side = LP.emitterSide(p.id);
      if (side && A.armArmed(folder, side)) assert.equal(p.source, "prop", `${folder}/${tech}/${p.id}: an armed arm fires from its prop`);
    }
  }
});

test("Deltamon fires one volley from each of its three mouths; Minotarumon fires from the LEFT arm", { skip }, async () => {
  setFallbackDonor(read("m005grey").actions);
  // Deltamon: Triple Fire (clip 13) is a gap on this pack -> built from the map's donor cast
  const delt = read("m138delt");
  const deltDonor = donorRow("m138delt", 13).d;
  registerDonorAnim(deltDonor, read(deltDonor));
  await prepareModelDonors(delt);
  const triple = resolveClipScript(delt, 13, { element: 2, target: "enemy", hits: 3, tech: "Triple Fire" });
  const shots = (triple?.ops ?? []).filter((o) => o.op === 6 && (o.words?.[0] | 0) === 0);
  assert.equal(shots.length, 3, "three fireballs, one per mouth");
  assert.deepEqual(shots.map((o) => o.launch.id).sort(), ["left-arm", "mouth", "right-arm"]);
  const leftHand = B.armChain("m138delt", "left").at(-1);
  assert.equal(shots.find((o) => o.launch.id === "left-arm").launch.bone, leftHand);

  // Minotarumon: its left arm is a gun, its right arm is not. Ice Blow must leave the LEFT arm.
  const mino = read("m172mtar");
  const minoDonor = donorRow("m172mtar", 9).d;
  registerDonorAnim(minoDonor, read(minoDonor));
  await prepareModelDonors(mino);
  const ice = resolveClipScript(mino, 9, { element: 4, target: "enemy", hits: 1, tech: "Ice Blow" });
  const iceShots = (ice?.ops ?? []).filter((o) => o.op === 6 && (o.words?.[0] | 0) === 0);
  assert.equal(iceShots.length, 1, "one shot");
  assert.equal(iceShots[0].launch.id, "left-arm");
  assert.equal(iceShots[0].launch.bone, B.armChain("m172mtar", "left").at(-1), "the left arm's tip, not the right's");
  // ...and the emitted words decode back to that bone's tip in the script's own frame. The builder plans
  // the launch over the whole body-table sequence it binds (spellFromBasic passes `tables`), so the test
  // asks for the same window rather than the first table alone.
  const want = LP.launchFrom(mino, LP.launchPointsFor(mino, { tech: "Ice Blow", tables: scriptTableSeq(ice) }).points[0]);
  const got = [iceShots[0].words[2], -iceShots[0].words[3], -iceShots[0].words[4]];
  assert.deepEqual(got, want, "op6 words decode to the emitter's tip");
});

test("a contact technique launches nothing; a single shot leaves the primary site", { skip }, () => {
  const delt = read("m138delt");
  const planFight = LP.launchPointsFor(delt, { tech: "Fight" });
  assert.equal(planFight.mode, "per-limb-contact");
  assert.equal(planFight.points.length, 0);
  assert.ok(planFight.limbs.every((l) => l.bone != null), "each striking limb resolves to a bone");
  const grey = read("m005grey");
  const ball = LP.launchPointsFor(grey, { tech: "Flame Ball" });
  assert.equal(ball.mode, "single");
  assert.equal(ball.points.length, 1);
  assert.equal(ball.points[0].id, "mouth", "Greymon's flame leaves the mouth");
});
