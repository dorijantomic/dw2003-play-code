// K19c - the collision/clearance rule (R4's "no part passes through another") and the shared-shot
// convergence rule (R3). The module is pure arithmetic over the model JSON, so these tests run the
// same functions the solver runs:
//
//   1. the capsule arithmetic itself (segment distances) - analytic cases with exact answers;
//   2. the collider set of real packs: a capsule per meshed bone, hand/prop identities from the bone
//      map and K17's arm equipment;
//   3. the pose test: a legal authored pose passes its own body's bar, a hand driven into the head
//      fails it, and a pair the body keeps fused is not judged at all;
//   4. R3: a combined shot closes two emitters to the measured gap and leaves from their midpoint; a
//      per-emitter volley mirrors its emitters about the aim line and never puts two shots closer
//      than one hand block; both scale with body height (no absolute unit anywhere).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SHARED_SHOT, MIN_BONE_DISTANCE, bodyHeight, rigColliders, poseCollider, allowedPairs,
  pairClearance, segmentDistance, penetration, clearanceTolerance, emitterSpan, sharedShotMode,
  sharedShotTargets,
} from "../web/fight/anim-collision.js";
import { restPose } from "../web/fight/anim-retarget.js";
import { BONEMAP, armChains } from "../web/fight/digimon-bonemap.js";
import { emitters, shotsFor } from "../web/fight/digimon-anatomy.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE_PACKS = fs.existsSync(path.join(MODELS, "m178kngt/anim.json"));
const skip = HAVE_PACKS ? false : "model packs are not installed";
const read = (folder) => JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));

// ── 1. capsule arithmetic ───────────────────────────────────────────────────────────────────────────
test("segment distance: parallel, crossing, point-to-segment, symmetry", () => {
  // two parallel unit segments 2 apart along y
  let r = segmentDistance([0, 0, 0], [0, 0, 1], [2, 0, 0], [2, 0, 1]);
  assert.ok(Math.abs(r.d - 2) < 1e-12, `parallel distance ${r.d}`);
  // crossing segments (one along x at y=0, one along z at the same origin) touch
  r = segmentDistance([-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]);
  assert.ok(Math.abs(r.d) < 1e-12, `crossing distance ${r.d}`);
  // a point (zero-length segment) 3 units from a segment
  r = segmentDistance([0, 3, 0], [0, 3, 0], [-1, 0, 0], [1, 0, 0]);
  assert.ok(Math.abs(r.d - 3) < 1e-12, `point-segment distance ${r.d}`);
  // swapped order gives the same distance
  const a = segmentDistance([0, 0, 0], [1, 2, 3], [4, 0, 1], [2, 2, 0]);
  const b = segmentDistance([4, 0, 1], [2, 2, 0], [0, 0, 0], [1, 2, 3]);
  assert.ok(Math.abs(a.d - b.d) < 1e-12, `symmetry ${a.d} vs ${b.d}`);
});

test("pair clearance is the gap between the capsule surfaces", () => {
  const a = { a: [0, 0, 0], b: [0, 0, 10], r: 1 };
  const b = { a: [4, 0, 0], b: [4, 0, 10], r: 1 };
  const p = pairClearance(a, b);
  assert.ok(Math.abs(p.clearance - 2) < 1e-12, `clearance ${p.clearance}`);
  const overlapping = pairClearance(a, { a: [1.5, 0, 0], b: [1.5, 0, 10], r: 1 });
  assert.ok(Math.abs(overlapping.clearance + 0.5) < 1e-12, `overlap ${overlapping.clearance}`);
});

// ── 2. R3: shared-shot convergence ─────────────────────────────────────────────────────────────────
const H = 3000;
const pts2 = [
  { id: "left-arm", site: "left-arm", x: -0.21 * H, y: 0, z: 1200 },
  { id: "right-arm", site: "right-arm", x: 0.21 * H, y: 0, z: 1200 },
];

test("combined shot: emitters close to the measured gap and one shot leaves the midpoint", () => {
  const r = sharedShotTargets({ points: pts2, mode: "combined", height: H });
  assert.equal(r.origins.length, 1, "one combined shot, not one per emitter");
  assert.ok(Math.abs(emitterSpan(r.points) - SHARED_SHOT.combinedGap * H) < 1e-9,
    `span ${emitterSpan(r.points)} vs gap ${SHARED_SHOT.combinedGap * H}`);
  // symmetry preserved, the midpoint unmoved
  const m = r.points[0].x + r.points[1].x;
  assert.ok(Math.abs(m) < 1e-9, `midpoint x ${m}`);
  assert.ok(Math.abs(r.origins[0].z - 1200) < 1e-9, "the shot still leaves at the emitters' own forward point");
  // already-close emitters do not get pushed apart by a "converge" rule
  const close = sharedShotTargets({ points: [pts2[0], { ...pts2[1], x: -0.20 * H }], mode: "combined", height: H });
  assert.ok(emitterSpan(close.points) <= SHARED_SHOT.combinedGap * H + 1e-9);
});

test("combined shot of unlike sites lines up ALONG the aim instead of clasping", () => {
  const points = [
    { id: "mouth", site: "mouth", x: 0, y: -400, z: 1600 },
    { id: "chest", site: "chest", x: 0, y: 200, z: 0 },
  ];
  const r = sharedShotTargets({ points, mode: "combined", height: H });
  assert.equal(r.origins.length, 1);
  const dz = Math.abs(r.points[0].z - r.points[1].z);
  assert.ok(dz <= SHARED_SHOT.combinedGap * H + 1e-9, `along-aim span ${dz}`);
  // their lateral/vertical places are untouched: a chest cannot climb into a mouth
  assert.ok(Math.abs(r.points[0].y - (-400)) < 1e-9 && Math.abs(r.points[1].y - 200) < 1e-9);
});

test("per-emitter volley: symmetric about the aim line, at least one hand block apart", () => {
  const centre = { x: 0, y: 0, z: 0 };
  // an asymmetric pair (the body's own pose says -0.30 / +0.18) becomes a symmetric one about the
  // body's own centre line, and each emitter keeps its own forward position
  const r = sharedShotTargets({
    points: [
      { id: "left-arm", site: "left-arm", x: -0.30 * H, y: 0, z: 1200 },
      { id: "right-arm", site: "right-arm", x: 0.18 * H, y: 0, z: 900 },
    ],
    mode: "spread", height: H, origin: centre,
  });
  assert.equal(r.origins.length, 2, "one shot per emitter");
  assert.ok(Math.abs(r.points[0].x + r.points[1].x) < 1e-9, `the pair straddles the aim line (${r.points[0].x}, ${r.points[1].x})`);
  assert.ok(Math.abs(r.points[0].z - 1200) < 1e-9 && Math.abs(r.points[1].z - 900) < 1e-9, "forward positions untouched");
  assert.ok(Math.abs(r.points[0].x) > 0 && Math.abs(r.points[0].x - r.points[1].x) >= SHARED_SHOT.minSeparation * H - 1e-9);
  // three emitters: the middle one sits ON the aim line, the other two mirror each other
  const three = sharedShotTargets({
    points: [
      { id: "left-arm", site: "left-arm", x: -0.31 * H, y: 0, z: 800 },
      { id: "right-arm", site: "right-arm", x: 0.33 * H, y: 0, z: 800 },
      { id: "mouth", site: "mouth", x: 0.01 * H, y: -900, z: 1400 },
    ],
    mode: "spread", height: H, origin: centre,
  });
  assert.ok(Math.abs(three.points[2].x - 0) < 1e-9, `middle x ${three.points[2].x}`);
  assert.ok(Math.abs(three.points[0].x + three.points[1].x) < 1e-9);
  // two emitters stacked on one point are pushed apart to the minimum separation
  const stacked = sharedShotTargets({
    points: [{ id: "mouth", site: "mouth", x: 0, y: 0, z: 1000 }, { id: "chest", site: "chest", x: 0, y: 0, z: 1000 }],
    mode: "spread", height: H, origin: centre,
  });
  const d = Math.hypot(stacked.points[0].x - stacked.points[1].x, stacked.points[0].y - stacked.points[1].y, stacked.points[0].z - stacked.points[1].z);
  assert.ok(d >= SHARED_SHOT.minSeparation * H - 1e-9, `stacked pair separation ${d}`);
});

test("both rules scale with body height and a lone emitter is left alone", () => {
  const big = sharedShotTargets({ points: pts2.map((p) => ({ ...p, x: p.x * 2, z: p.z * 2 })), mode: "combined", height: H * 2 });
  assert.ok(Math.abs(emitterSpan(big.points) - SHARED_SHOT.combinedGap * H * 2) < 1e-6);
  const lone = sharedShotTargets({ points: [pts2[0]], mode: "combined", height: H });
  assert.equal(lone.origins.length, 1);
  assert.deepEqual([lone.points[0].x, lone.points[0].z], [pts2[0].x, pts2[0].z]);
  // the aim axis is honoured: with the aim along +X the spread happens in the horizontal Y/Z plane
  // (sideways = cross(aim, up), up = -Y -> -Z here), and each emitter's own height is untouched
  const alongX = sharedShotTargets({
    points: [{ id: "a", site: "left-arm", x: 0, y: -300, z: 0 }, { id: "b", site: "right-arm", x: 0, y: 300, z: 0 }],
    mode: "spread", height: H, aim: [1, 0, 0], origin: { x: 0, y: 0, z: 0 },
  });
  assert.ok(Math.abs(alongX.points[0].z + alongX.points[1].z) < 1e-9, "the pair is mirrored across the aim axis");
  assert.ok(Math.abs(alongX.points[0].z - alongX.points[1].z) >= SHARED_SHOT.minSeparation * H - 1e-9);
  assert.ok(Math.abs(alongX.points[0].y - (-300)) < 1e-9 && Math.abs(alongX.points[1].y - 300) < 1e-9, "heights untouched");
  assert.ok(Math.abs(alongX.points[0].x) < 1e-9 && Math.abs(alongX.points[1].x) < 1e-9, "no motion along the aim");
});

test("the R3 mode follows the technique's own shots rule (K14)", () => {
  assert.equal(sharedShotMode({ mode: "single", emitters: ["mouth"] }, 2), "combined");
  assert.equal(sharedShotMode({ mode: "per-emitter", emitters: ["left-arm", "right-arm", "mouth"] }, 3), "spread");
  assert.equal(sharedShotMode({ mode: "single", emitters: ["mouth"] }, 1), null, "one emitter has nothing to share");
  assert.equal(sharedShotMode({ mode: "per-limb-contact", emitters: ["left-arm", "right-arm"] }, 2), null);
  assert.equal(sharedShotMode(null, 3), null);
});

// ── 3. real packs: colliders, tolerance, the pose test ─────────────────────────────────────────────
test("colliders: a capsule per meshed bone, hands and props named from data", { skip }, () => {
  for (const folder of ["m178kngt", "m138delt", "m228piem"]) {
    const model = read(folder);
    const rig = rigColliders(model, folder);
    assert.ok(rig.colliders.length > 10, `${folder}: ${rig.colliders.length} colliders`);
    const H = bodyHeight(model);
    assert.ok(H > 0);
    for (const c of rig.colliders) {
      assert.ok(c.radius > 0 && Number.isFinite(c.radius), `${folder} bone ${c.bone} radius`);
      assert.ok(c.radius < H, `${folder} bone ${c.bone} radius ${c.radius} vs height ${H}`);
      assert.ok(c.role, `${folder} bone ${c.bone} has no role`);
    }
    // the hand is the end of an arm chain
    for (const side of ["left", "right"]) {
      const ch = armChains(folder, side)[0];
      if (!ch || !ch.length) continue;
      const hand = rig.colliders.find((c) => c.bone === ch[ch.length - 1]);
      if (hand) assert.equal(hand.hand, true, `${folder} ${side} hand flagged`);
    }
  }
  // Knightmon's greatsword is a prop on the right arm (K17's measurement, not a hand-picked fact)
  const rig = rigColliders(read("m178kngt"), "m178kngt");
  assert.ok(rig.colliders.some((c) => c.prop), "Knightmon carries a prop collider");
});

test("colliders are cached per model object and poses are not mutated", { skip }, () => {
  const model = read("m228piem");
  const a = rigColliders(model, "m228piem");
  const b = rigColliders(model, "m228piem");
  assert.equal(a, b);
  const pose = restPose(model, 10);
  const before = JSON.stringify(pose.pos);
  penetration(model, pose);
  assert.equal(JSON.stringify(pose.pos), before, "the pose test must not write to the pose");
  // a solver that builds its pose bone by bone (an array of {rot,pos}) gets the same answer
  const asArray = pose.pos.map((p, i) => ({ rot: pose.rot[i], pos: p }));
  const p1 = penetration(model, pose, { folder: "m228piem" });
  const p2 = penetration(model, asArray, { folder: "m228piem" });
  assert.equal(p1.ok, p2.ok);
  assert.ok(Math.abs(p1.clearance - p2.clearance) < 1e-9, `${p1.clearance} vs ${p2.clearance}`);
});

test("every collider pair the rule tests is more than the family distance apart", { skip }, () => {
  const model = read("m005grey");
  const rig = rigColliders(model, "m005grey");
  const pairs = allowedPairs(rig);
  assert.ok(pairs.length > 50);
  for (const [i, j] of pairs) {
    assert.notEqual(rig.colliders[i].bone, rig.colliders[j].bone);
    assert.ok(MIN_BONE_DISTANCE >= 3);
  }
});

test("the body's own animation passes its own clearance bar", { skip }, () => {
  for (const folder of ["m005grey", "m178kngt", "m138delt", "m228piem"]) {
    const model = read(folder);
    const tol = clearanceTolerance(model, folder);
    assert.ok(tol.byPair.size > 20, `${folder}: ${tol.byPair.size} pair bars`);
    const total = model.total_frames | 0;
    for (let k = 0; k < 10; k++) {
      const f = Math.round((total - 1) * k / 9);
      const p = penetration(model, restPose(model, f), { folder });
      assert.equal(p.ok, true, `${folder} frame ${f}: ${p.worst?.roleA} vs ${p.worst?.roleB} over by ${p.over}`);
    }
  }
});

test("a hand driven into the head is a violation, not a pass", { skip }, () => {
  let checked = 0;
  for (const folder of ["m005grey", "m178kngt", "m228piem", "m138delt"]) {
    const model = read(folder);
    const rig = rigColliders(model, folder);
    const rp = restPose(model, 0);
    const hand = rig.colliders.find((c) => c.hand && c.role === "arm:left") || rig.colliders.find((c) => c.hand);
    const head = rig.colliders.find((c) => c.role === "head") || rig.colliders.find((c) => c.role === "torso");
    if (!hand || !head) continue;
    const headWorld = poseCollider(head, rp);
    const target = headWorld.r !== undefined ? headWorld.a : null;
    if (!target) continue;
    const pose = { rot: rp.rot.slice(), pos: rp.pos.map((p) => (p ? p.slice() : p)) };
    pose.pos[hand.bone] = target.slice();
    const p = penetration(model, pose, { folder });
    assert.equal(p.ok, false, `${folder}: a hand inside the head must fail the pose test`);
    assert.ok(p.violations.length > 0);
    assert.ok(p.violations.some((v) => v.boneA === hand.bone || v.boneB === hand.bone), `${folder}: the hand pair is named`);
    checked++;
  }
  assert.ok(checked >= 2, "the artificial pose was exercised on at least two bodies");
});

test("a pair the body keeps fused is not judged; a pair with room is", { skip }, () => {
  let sawFused = false, sawRoom = false;
  for (const folder of ["m178kngt", "m138delt", "m228piem", "m005grey", "m060hkab"]) {
    const model = read(folder);
    const tol = clearanceTolerance(model, folder);
    for (const [, v] of tol.byPair) {
      if (v === null) sawFused = true;
      else sawRoom = true;
    }
    // every collider pair has a bar: the fused ones null, the rest a number in model units
    const rig = rigColliders(model, folder);
    assert.equal(tol.byPair.size, allowedPairs(rig).length, `${folder}: one bar per tested pair`);
  }
  assert.ok(sawRoom, "at least one judged pair exists");
  assert.ok(sawFused, "at least one fused pair was recognised");
});

test("a combined shot's clasp is measured, not failed (R3 is an authored intent)", { skip }, () => {
  let checked = 0;
  for (const folder of ["m228piem", "m060hkab", "m054mgdr"]) {
    const model = read(folder);
    const rig = rigColliders(model, folder);
    const hands = rig.colliders.filter((c) => c.hand);
    if (hands.length < 2) continue;
    const rp = restPose(model, 0);
    const pose = { rot: rp.rot.slice(), pos: rp.pos.map((q) => (q ? q.slice() : q)) };
    const mid = [0, 1, 2].map((k) => (rp.pos[hands[0].bone][k] + rp.pos[hands[1].bone][k]) / 2);
    pose.pos[hands[0].bone] = mid.slice();
    pose.pos[hands[1].bone] = mid.slice();
    const plain = penetration(model, pose, { folder });
    assert.ok(plain.violations.some((v) => hands.some((h) => h.bone === v.boneA) && hands.some((h) => h.bone === v.boneB)),
      `${folder}: hands on one point must be a violation without the clasp declaration`);
    const clasped = penetration(model, pose, { folder, clasp: true });
    assert.ok(!clasped.violations.some((v) => hands.some((h) => h.bone === v.boneA) && hands.some((h) => h.bone === v.boneB)),
      `${folder}: the declared clasp is not a violation`);
    assert.ok(clasped.clasp && clasped.clasp.clearance < 0, `${folder}: the clasp gap is still measured`);
    checked++;
  }
  assert.ok(checked >= 2, "the clasp path was exercised on at least two bodies");
});

test("penetration reports the deepest pair and its clearance in model units", { skip }, () => {
  const model = read("m178kngt");
  const p = penetration(model, restPose(model, 0), { folder: "m178kngt", tolerance: 0 });
  assert.ok(Number.isFinite(p.clearance));
  assert.equal(p.tested, allowedPairs(rigColliders(model, "m178kngt")).length - 0);
  assert.ok(p.worst && p.worst.roleA && p.worst.roleB);
  assert.equal(typeof p.depth, "number");
});

test("the shots rule of a real body maps to the R3 mode", { skip }, () => {
  // Deltamon is the disc's three-mouthed volley body: per-emitter, three shots (K14)
  const delt = shotsFor("m138delt", "triplefire", { volley: true });
  assert.equal(delt.mode, "per-emitter");
  const n = emitters("m138delt").filter((e) => e.kind !== "melee").length;
  assert.equal(sharedShotMode(delt, n), "spread");
  // a single-shot body with two launch sites combines
  const piem = emitters("m228piem").filter((e) => e.kind !== "melee");
  assert.ok(piem.length >= 2);
  assert.equal(sharedShotMode({ mode: "single", emitters: ["both-arms"] }, piem.length), "combined");
});
