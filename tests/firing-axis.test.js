// web/fight/firing-axis.js — the arithmetic, pinned. No disc data: every pose here is built by hand,
// and the authored class mapping is read from the K12 bone map / K17 arm table (both in git).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as FA from "../web/fight/firing-axis.js";
import { poseFromChannels, boneMatrix, firingAxis, emitterClass, pca, aimError, angleBetween,
         carriedFacing, restPoseOf, armAxisCandidates, vertexWorld, EMITTER_CLASSES } from "../web/fight/firing-axis.js";

// ── a synthetic rig: root at the origin, a torso above it (y is DOWN), a head bound to the torso,
// and a right arm of two bones ending in a long prop. Channels are constant, so the pose is the rest
// pose and every number below is arithmetic a reader can check by hand.
function rig({ torsoRot = [0, 0, 0], headRot = [0, 0, 0], armRot = [0, 0, 0], propRot = [0, 0, 0] } = {}) {
  const ch = (rot, t) => ({ ch1: [[t[0], t[1], t[2], 0], [0, 0, 0, 30000]], ch2: [[rot[0], rot[1], rot[2], 0], [0, 0, 0, 30000]] });
  return {
    num_bones: 5,
    bones: [
      //     index parent  channels                                         mesh
      { parent_slot: 0, anim: ch([0, 0, 0], [0, 0, 0]), verts: [[0, 0, 0], [400, 0, 200], [-400, 0, 200]] },             // 0 root
      { parent_slot: 1, anim: ch(torsoRot, [0, -1200, 0]), verts: [[0, 0, 0], [0, -400, 0], [0, 0, 300]] },               // 1 torso
      { parent_slot: 2, anim: ch(headRot, [0, -600, 0]), verts: [[0, 0, 0], [0, 0, 500], [0, -200, 300]] },               // 2 head (mouth)
      { parent_slot: 2, anim: ch(armRot, [-300, 0, 0]), verts: [[0, 0, 0]] },                                             // 3 arm (upper)
      { parent_slot: 4, anim: ch(propRot, [-600, 0, 0]), verts: [[0, 0, 0], [0, 0, 900], [40, 0, 900], [-40, 0, 900]] },  // 4 prop (a blade along +z)
    ],
    clips: [{ index: 0, start_frame: 0 }],
    timeline: [],
  };
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("poseFromChannels: a parent's rotation carries the child, and ch1 signs follow the renderer", () => {
  const m = rig();
  const p = poseFromChannels(m, 0);
  assert.deepEqual(p.pos[0].map((v) => Math.round(v) + 0), [0, 0, 0]);
  assert.deepEqual(p.pos[1].map((v) => Math.round(v) + 0), [0, -1200, 0]);      // y is down and keeps its sign
  assert.deepEqual(p.pos[2].map((v) => Math.round(v) + 0), [0, -1800, 0]);      // head hangs 600 below the torso
  assert.equal(p.visible.every(Boolean), true);
  assert.deepEqual(p.scale[0], [1, 1, 1]);
  assert.ok(near(p.rot[1][0], 1) && near(p.rot[1][4], 1) && near(p.rot[1][8], 1), "no rotation = identity");
});

test("poseFromChannels: a 1024-unit (90 deg) yaw on the torso turns the head's front to +X", () => {
  const m = rig({ torsoRot: [0, 1024, 0] });
  const rest = poseFromChannels(rig(), 0);
  const now = poseFromChannels(m, 0);
  const fwd = carriedFacing(2, now, rest);       // the head's rest +Z, carried by its own rotation
  // PS1 yaw is a turn about +Y (down), so 90 deg takes +Z to ... a horizontal axis; either +X or -X
  assert.ok(near(Math.abs(fwd[0]), 1, 1e-6), `expected a lateral facing, got ${fwd}`);
  assert.ok(near(fwd[1], 0, 1e-6) && near(fwd[2], 0, 1e-6));
});

test("pca: a line reads its own axis as the major one, a plate reads its thin axis as the mirror", () => {
  const line = [];
  for (let i = 0; i < 20; i++) line.push([(i % 3) - 1, 0, i * 10]);     // a blade along +Z
  const P = pca(line);
  assert.ok(Math.abs(P.axes[0].axis[2]) > 0.99, `major axis should be Z, got ${P.axes[0].axis}`);
  assert.ok(P.axes[0].sigmaPct > 0.9, "an elongated cloud is dominated by one axis");
  const plate = [];
  for (let i = 0; i < 40; i++) plate.push([(i % 2 ? 0.5 : -0.5), (i % 7) - 3, (i % 5) - 2]);   // thin in X, broad in Y/Z
  const Q = pca(plate);
  assert.ok(Math.abs(Q.axes[2].axis[0]) > 0.95, `the thinnest axis of a plate is X, got ${Q.axes[2].axis}`);
});

test("aimError: yaw is signed about +Y (positive = the body's right), pitch is elevation", () => {
  // the target is straight ahead: an axis pointing to +X is 90 deg to the RIGHT
  const e = aimError([1, 0, 0], [0, 0, 0], [0, 0, 1000]);
  assert.ok(near(Math.round(e.yaw), 90), `yaw ${e.yaw}`);
  assert.ok(near(Math.round(e.full), 90), `full ${e.full}`);
  // an axis 45 deg up (y is DOWN) against a level target reads +45 pitch
  const up = aimError([0, -1, 1], [0, 0, 0], [0, 0, 1000]);
  assert.ok(near(Math.round(up.pitch), 45), `pitch ${up.pitch}`);
  // a straight-up axis has no bearing: the error says so instead of returning a fake yaw
  assert.equal(aimError([0, -1, 0], [0, 0, 0], [0, 0, 1000]).flat, true);
  assert.equal(Math.round(angleBetween([0, 0, 1], [0, 0, -1])), 180);
});

test("emitterClass: the authored tables decide, not the caller", () => {
  // Knightmon: right arm ends in a long sword (K17 elongated), left is a bare hand block
  assert.equal(emitterClass("m178kngt", "right-arm").cls, "prop");
  assert.equal(emitterClass("m178kngt", "left-arm").cls, "hand");
  assert.equal(emitterClass("m005grey", "mouth").cls, "head");
  assert.equal(emitterClass("m254pldr", "chest").cls, "chest");
  assert.equal(emitterClass("m026skul", "back").cls, "back");
  assert.equal(emitterClass("m009mera", "whole-body").cls, "body");
  assert.ok(EMITTER_CLASSES.includes(emitterClass("m006devi", "wings").cls));
});

test("firingAxis: a mouth is the head's carried front, and a bone the rig lacks has no axis", () => {
  const m = rig();
  const pose = poseFromChannels(m, 0);
  const rest = restPoseOf(m);
  const mouth = firingAxis(m, "m005grey", "mouth", pose, { rest });
  assert.ok(mouth && mouth.cls === "head");
  assert.ok(Math.abs(mouth.axis[2]) > 0.99, `head front should be +Z at rest, got ${mouth.axis}`);
  // Knightmon's right hand is bone 10 of a 26-bone rig; this 5-bone rig has no such bone, and the
  // module must say so instead of inventing an axis out of the wrong bone
  assert.equal(firingAxis(m, "m178kngt", "right-arm", pose, { rest }), null);
});

test("boneMatrix: the ch3 draw scale multiplies the rotation columns (the renderer's own order)", () => {
  const p = { rot: [[1, 0, 0, 0, 1, 0, 0, 0, 1]], pos: [[10, 20, 30]], scale: [[2, 3, 4]], visible: [true] };
  assert.deepEqual(boneMatrix(p, 0), [2, 0, 0, 0, 3, 0, 0, 0, 4, 10, 20, 30]);
  // a hidden part (ch3 = 0) collapses to a zero matrix, and vertexWorld then returns the pivot
  const h = { rot: [[1, 0, 0, 0, 1, 0, 0, 0, 1]], pos: [[5, 6, 7]], scale: [[0, 0, 0]], visible: [false] };
  assert.deepEqual(boneMatrix(h, 0).slice(0, 9), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(vertexWorld({ bones: [{}] }, 0, [100, 100, 100], h), [5, 6, 7]);
});

// ── a rig with a REAL arm chain: Knightmon's right arm is bones 6..10 of its 26-bone rig (K12), so
// a model with 11 bones lets the module classify the tip as a prop and read its geometry. Wrist 9,
// prop 10, the prop a blade along +Z. Everything else is a stub.
function armRig({ tipVerts = [[0, 0, 0], [0, 0, 900], [40, 0, 900], [-40, 0, 900]], tipScale = null, tipRot = [0, 0, 0] } = {}) {
  const ch = (rot, t, scale = null) => {
    const o = { ch1: [[t[0], t[1], t[2], 0], [0, 0, 0, 30000]], ch2: [[rot[0], rot[1], rot[2], 0], [0, 0, 0, 30000]] };
    if (scale) o.ch3 = [[scale[0], scale[1], scale[2], 0], [0, 0, 0, 30000]];
    return o;
  };
  const bones = [];
  for (let i = 0; i < 11; i++) bones.push({ parent_slot: 1, anim: ch([0, 0, 0], [0, 0, 0]), verts: [[0, 0, 0]] });
  bones[0] = { parent_slot: 0, anim: ch([0, 0, 0], [0, 0, 0]), verts: [[0, 0, 0]] };
  bones[9] = { parent_slot: 1, anim: ch([0, 0, 0], [-900, 0, 0]), verts: [[0, 0, 0]] };                  // wrist
  bones[10] = { parent_slot: 10, anim: ch(tipRot, [-200, 0, 0], tipScale), verts: tipVerts };           // prop/hand
  return { num_bones: 11, bones, clips: [{ index: 0, start_frame: 0 }], timeline: [] };
}

test("firingAxis: a prop reads its blade; a COLLAPSED prop (ch3 = 0) says so instead of inventing one", () => {
  const m = armRig();
  const pose = poseFromChannels(m, 0);
  const ok = firingAxis(m, "m178kngt", "right-arm", pose, { rest: pose });
  assert.equal(ok.cls, "prop");
  assert.equal(ok.method, "pca-long-axis");
  assert.equal(ok.confidence, "high");
  assert.ok(Math.abs(ok.axis[2]) > 0.99, `blade should be +Z, got ${ok.axis}`);
  // the disc retracts a part by drawing it at scale 0: every vertex sits on the joint, so there is
  // no principal axis at all. Before K19b's fix this returned confidence "high" from numerical noise.
  const flat = armRig({ tipScale: [0, 0, 0] });
  const fpose = poseFromChannels(flat, 0);
  const gone = firingAxis(flat, "m178kngt", "right-arm", fpose, { rest: fpose });
  assert.ok(gone, "still returns the arm's direction, not null");
  assert.equal(gone.confidence, "low");
  assert.ok(gone.axisQuality < 0.5, `axisQuality ${gone.axisQuality}`);
  assert.match(gone.method, /fallback$/);
  assert.ok(near(Math.hypot(...gone.axis), 1, 1e-6), "the fallback is a unit vector");
});

test("aimAxisFor: an arm emitter aims the ARM, not the blade (the disc's own habit, K19b)", () => {
  // the blade raised ~30 deg off the forearm: a sword held up, the classic cast pose the disc animates
  const m = armRig({ tipRot: [0, 512, 0] });          // 512 of 4096 = 45 deg of PS1 yaw
  const pose = poseFromChannels(m, 0);
  const geo = firingAxis(m, "m178kngt", "right-arm", pose, { rest: pose });
  const aim = FA.aimAxisFor(m, "m178kngt", "right-arm", pose, { rest: pose });
  assert.equal(aim.cls, "prop");
  assert.match(aim.method, /\+arm-push$/);
  const sep = angleBetween(geo.axis, aim.axis);
  assert.ok(sep > 10, `the blade and the arm should disagree here, got ${sep}`);
  // the calibrated axis IS the wrist -> block candidate (aimAxisFor must not invent a fourth one)
  const c = armAxisCandidates(m, "m178kngt", "right-arm", pose);
  assert.deepEqual(aim.axis, c.push);
  assert.ok(near(Math.hypot(...aim.axis), 1, 1e-6), "and it is a unit vector");
  // a body-attached emitter has nothing to re-aim: aimAxisFor is firingAxis
  const mouth = FA.aimAxisFor(m, "m005grey", "mouth", pose, { rest: pose });
  assert.equal(mouth.calibrated, true);
  assert.deepEqual(mouth.axis, firingAxis(m, "m005grey", "mouth", pose, { rest: pose }).axis);
});

test("R1: the calibrated acceptance is loosest where the disc is loosest, and none on a back part", () => {
  assert.equal(FA.r1Acceptance("head").yaw < FA.r1Acceptance("hand").yaw, true);
  assert.equal(FA.r1Acceptance("head").pitch, 25, "a mouth's own tilt is allowed");
  assert.equal(FA.r1Acceptance("back").enforce, "shot", "the disc's one back shot points 180 deg away");
  assert.deepEqual(FA.r1Acceptance("no-such-class"), { yaw: 25, pitch: 30, enforce: "axis" });
  // the measured table keeps the per-class sample sizes, so a caller can see n = 1 for back
  assert.equal(FA.R1.measured.head.n, 22);
  assert.equal(FA.R1.measured.back.n, 1);
  assert.equal(FA.R1.measured.prop.armAxis.push < FA.R1.measured.prop.medianAbsYaw, true);
});
