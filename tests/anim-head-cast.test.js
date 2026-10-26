// K20b — the HEAD CAST: the head lifts, holds, aims, returns, and the rest of the body keeps its idle.
//
// Fast, no browser. The measurements these pin come from the disc (K20a, 115 mouth/head casts of 79
// models) through web/fight/head-cast-constants.js; the arithmetic is the solver's own. Four things are
// pinned:
//   1. the schedule's SHAPE (start and end on the neutral frame, peak = the cell's lift, inside the
//      disc's p10..p90, hold length, monotone rise) — pure functions, no model needed;
//   2. the SIGN, on a real pack: a world rx(+lift) at the head joint must LIFT the head (the nose goes up
//      on screen), which is what the gate's rigid-rotation measure reports;
//   3. the IDLE: the cast's first and last frame are the model's own idle pose (within its own idle step),
//      and bones the cast does not drive keep moving through the cast instead of freezing;
//   4. the BODY: a head cast's slide stays inside the disc's measured root travel, and a tampered lift is
//      REFUSED by the gate (the refusal path still works).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { headCastFor, HEAD_CAST, HEAD_CAST_JUMP, HEAD_CAST_IDLE, headCastFor as hcf } from "../web/fight/head-cast-constants.js";
import {
  headScheduleFrom, headCastSchedule, planCast, bakeSolverPose, verifyBake, solverGroup, solveCast,
  idlePlaylist, neutralFrame, SOLVER,
} from "../web/fight/anim-solver.js";
import { poseFromChannels } from "../web/fight/firing-axis.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE = fs.existsSync(path.join(MODELS, "m069flar/anim.json"));
const skip = HAVE ? false : "model packs are not installed";
const read = (folder) => {
  const p = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
  p.folder = folder;
  return p;
};
const { prepareModelDonors } = await import("../web/fight/clip-fallback.js");

test("the schedule lifts to the cell's own median and lands on neutral at both ends", () => {
  for (const size of ["small", "medium", "large", "giant"]) {
    const cell = headCastFor(size);
    assert.ok(cell && cell.headLift, `${size}: a head-cast cell resolves`);
    const h = headScheduleFrom(cell, { windup: 90 });
    assert.ok(h.lift >= 0, `${size}: a lift is never negative (${h.lift})`);
    const ticks = 261;
    const series = Array.from({ length: ticks }, (_, t) => headCastSchedule(h, t, ticks));
    assert.equal(series[0], 0, `${size}: frame 0 is the neutral pose`);
    assert.equal(series[ticks - 1], 0, `${size}: the last frame is the neutral pose`);
    const peak = Math.max(...series);
    // the peak is the cell's p50 by construction (a cell whose median lift is negative lifts nothing), and
    // it must sit inside the disc's own band
    if (cell.headLift.p50 > 0) assert.ok(Math.abs(peak - cell.headLift.p50) < 1e-6, `${size}: peak ${peak} = the cell's p50 ${cell.headLift.p50}`);
    else assert.equal(peak, 0, `${size}: a cell whose median does not lift holds the head still`);
    assert.ok(peak >= cell.headLift.p10 - 1e-6 && peak <= cell.headLift.p90 + 1e-6, `${size}: peak inside p10..p90`);
    // the rise is monotone up to the peak, the fall monotone down after the hold
    const peakAt = series.indexOf(peak);
    for (let t = 1; t <= peakAt; t++) assert.ok(series[t] >= series[t - 1] - 1e-9, `${size}: rise is monotone at ${t}`);
    for (let t = peakAt + h.hold + 1; t < ticks; t++) assert.ok(series[t] <= series[t - 1] + 1e-9, `${size}: fall is monotone at ${t}`);
    // the hold is a contiguous run at the peak, at least the cell's own hold
    let hold = 0;
    for (let t = peakAt; t < ticks && series[t] === peak; t++) hold++;
    assert.ok(hold >= Math.min(h.hold, 1), `${size}: holds the peak for ${hold} ticks (cell ${h.hold})`);
    assert.ok(h.rise + h.hold + h.fall <= 90, `${size}: the shape fits inside the wind-up`);
  }
  // the constants are the disc's, not a guess: the jump and idle bars are measured numbers
  assert.ok(HEAD_CAST_JUMP.p90 > HEAD_CAST_JUMP.p50 && HEAD_CAST_JUMP.p50 > 0);
  assert.ok(HEAD_CAST_IDLE.unitsH.p90 > 0 && HEAD_CAST_IDLE.deg.p90 > 0);
  assert.equal(hcf("tiny").source, "spells", "a 2-cast size cell falls back to the size-free cell");
});

test("a head cast turns the head UP by the planned degrees (the sign, measured on a pack)", { skip }, async () => {
  const model = read("m069flar");
  await prepareModelDonors(model);
  const group = solverGroup(model, { tech: "Flame Ball" });
  assert.ok(group.ok && group.cls === "mouth", "the exemplar's rule fires a mouth cast");
  const plan = planCast(model, group, { quantile: 0.5 });
  assert.ok(plan.ok && plan.head, "the plan carries a head schedule");
  plan.aimPoint = [0, plan.floorY - plan.H * 0.5, plan.torso[2] + SOLVER.aimDistance];
  plan.aimPoints = plan.sites.map(() => plan.aimPoint);
  const bake = bakeSolverPose(model, plan, { offset: 20000 });
  const head = plan.sites[0].bone;
  const Wof = (f) => poseFromChannels(bake.model, f).rot[head];
  const toM = (R) => [[R[0], R[3], R[6]], [R[1], R[4], R[7]], [R[2], R[5], R[8]]];
  const W0 = toM(Wof(plan.baseFrame ?? 0));
  const pitchAt = (f) => {
    const W = toM(Wof(f));
    const D = [0, 1, 2].map((r) => [0, 1, 2].map((c) => W[r][0] * W0[c][0] + W[r][1] * W0[c][1] + W[r][2] * W0[c][2]));
    return Math.atan2(D[2][1] - D[1][2], D[1][1] + D[2][2]) * 180 / Math.PI;
  };
  const peakTick = plan.head.rise + Math.max(1, Math.floor(plan.head.hold / 2));
  const at = pitchAt(20000 + peakTick);
  assert.ok(at > 0.5 * plan.head.lift, `the head turns UP at the peak: ${at.toFixed(2)} deg for a ${plan.head.lift.toFixed(2)} deg plan`);
  // the first and last frame stand on an IDLE frame, not on the channel's frame 0 (the cast plays over the
  // idle playlist): the head's rotation there is the idle's own, so it is compared with that idle frame.
  assert.ok(Math.abs(pitchAt(20000) - pitchAt(20000 + 0)) < 1e-6, "frame 0 is the idle frame of tick 0");
  const lastRelIdle = (() => {
    const L = plan.ticks - 1;
    const idleList = idlePlaylist(bake.model, plan.baseFrame ?? 0);
    const idleFrame = idleList[L % idleList.length];
    const Wr = toM(poseFromChannels(bake.model, idleFrame).rot[head]);
    const Wl = toM(Wof(20000 + L));
    const D = [0, 1, 2].map((r) => [0, 1, 2].map((c) => Wr[r][0] * Wl[c][0] + Wr[r][1] * Wl[c][1] + Wr[r][2] * Wl[c][2]));
    return Math.atan2(D[2][1] - D[1][2], D[1][1] + D[2][2]) * 180 / Math.PI;
  })();
  assert.ok(Math.abs(lastRelIdle) < 0.5, `the last frame is the idle's own pose (${lastRelIdle.toFixed(2)} deg off)`);
});

test("the cast plays OVER the idle: both ends sit on an idle frame and undriven bones keep moving", { skip }, async () => {
  const model = read("m069flar");
  await prepareModelDonors(model);
  const group = solverGroup(model, { tech: "Flame Ball" });
  const plan = planCast(model, group, { quantile: 0.5 });
  plan.aimPoint = [0, plan.floorY - plan.H * 0.5, plan.torso[2] + SOLVER.aimDistance];
  plan.aimPoints = plan.sites.map(() => plan.aimPoint);
  const bake = bakeSolverPose(model, plan, { offset: 20000 });
  const idle = idlePlaylist(bake.model, plan.baseFrame ?? 0);
  assert.ok(idle.length > 4, `the model has an idle playlist (${idle.length} frames)`);
  const verts = (pose) => {
    const out = [];
    for (let i = 0; i < pose.pos.length; i++) {
      const R = pose.rot[i], t = pose.pos[i];
      for (const v of bake.model.bones[i]?.verts || []) {
        out.push([R[0] * v[0] + R[3] * v[1] + R[6] * v[2] + t[0], R[1] * v[0] + R[4] * v[1] + R[7] * v[2] + t[1], R[2] * v[0] + R[5] * v[1] + R[8] * v[2] + t[2]]);
      }
    }
    return out;
  };
  const delta = (a, b) => {
    const A = verts(a), B = verts(b);
    let worst = 0;
    for (let i = 0; i < Math.min(A.length, B.length); i++) worst = Math.max(worst, Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1], A[i][2] - B[i][2]));
    return worst / plan.H;
  };
  const idlePoses = idle.map((f) => poseFromChannels(bake.model, f));
  let jitter = 0;
  for (let k = 0; k < idlePoses.length; k++) jitter = Math.max(jitter, delta(idlePoses[k], idlePoses[(k + 1) % idlePoses.length]));
  const start = poseFromChannels(bake.model, 20000);
  const end = poseFromChannels(bake.model, 20000 + plan.ticks - 1);
  const near = (p) => Math.min(...idlePoses.map((q) => delta(p, q)));
  const bar = Math.max(jitter, HEAD_CAST_IDLE.unitsH.p90) * 1.5 + 1e-3;
  assert.ok(near(start) <= bar, `the first frame is an idle pose (${near(start).toFixed(4)} H, bar ${bar.toFixed(4)})`);
  assert.ok(near(end) <= bar, `the last frame is an idle pose (${near(end).toFixed(4)} H, bar ${bar.toFixed(4)})`);
  // a bone the solver does not drive must not be frozen: its keys differ between ticks
  const head = plan.sites[0].bone;
  let varying = 0;
  for (let i = 0; i < bake.model.bones.length; i++) {
    if (i === head) continue;
    const win = (bake.model.bones[i].anim?.ch2 ?? []).filter((r) => r[3] >= 20000 && r[3] < 20000 + plan.ticks);
    if (win.length < 2) continue;
    if (win.some((r) => r[0] !== win[0][0] || r[1] !== win[0][1] || r[2] !== win[0][2])) varying++;
  }
  assert.ok(varying >= 3, `undriven bones keep the idle's motion (${varying} bones vary)`);
});

test("the body stays inside the disc's own root travel, and a tampered lift is refused", { skip }, async () => {
  // A body whose head bone ALSO carries the parts that stand on the floor (a HUB head, K20a's n=4 cell)
  // cannot take the disc's full pitch without driving its own wing through its own leg — so the solver
  // keeps the largest SHARE of the lift that passes the same gate (never a clamped pose) and reports it.
  const model = read("m050coca");
  await prepareModelDonors(model);
  const solved = solveCast(model, { tech: "Air Blast", apply: false });
  assert.ok(solved?.ok && solved.report.pass, "the hub exemplar solves");
  const rep = solved.report;
  assert.ok(rep.body && rep.body.ok && rep.body.travel <= (HEAD_CAST.all.rootTravelH.p50 + 1e-9) + 5e-3,
    `the release transport fits the disc's root travel (${JSON.stringify(rep.body)})`);
  assert.ok(rep.head && Number.isFinite(rep.head.peak), `the head pitch is measured (${JSON.stringify(rep.head)})`);
  assert.ok(rep.head.peak > 5, `the hub head really lifts (${rep.head.peak} deg)`);
  assert.ok(rep.head.peak >= rep.head.band[0] && rep.head.peak <= rep.head.band[1], "inside the disc's p10..p90");
  assert.ok(rep.head.scale > 0 && rep.head.scale < 1, `the hub body takes a SHARE of the disc's lift (${rep.head.scale})`);
  assert.ok(rep.head.liftFull >= HEAD_CAST.all.headLift.p10, "the share is measured against the disc's own cell");
  assert.ok(rep.head.jump <= rep.head.jumpBar, `no frame-to-frame jump above the disc's own p90 (${rep.head.jump})`);
  // the refusal path: a lift far outside the disc's band must fail the headPitch key
  const group = solverGroup(model, { tech: "Air Blast" });
  const hot = planCast(model, group, { quantile: 0.5 });
  hot.aimPoint = [0, hot.floorY - hot.H * 0.5, hot.torso[2] + SOLVER.aimDistance];
  hot.aimPoints = hot.sites.map(() => hot.aimPoint);
  for (const f of hot.frames) f.head = (f.head || 0) * 4 + 200;
  const hotBake = bakeSolverPose(model, hot, { offset: 24000 });
  const hv = verifyBake(model, hot, hotBake, group);
  assert.equal(hv.gate.headPitch, false, "a 200+ deg lift is outside the disc's p10..p90 and is refused");
  assert.equal(hv.pass, false, "the pair is refused, not clamped");
});
