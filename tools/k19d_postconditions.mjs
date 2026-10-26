#!/usr/bin/env node
// K19d postconditions — the numbers behind the exemplar contact sheets.
//
// For each exemplar it plays the technique the viewer shows, through the SAME runtime the battle and
// the viewer use (resolveClipScript -> ActorAnimator -> ActionVM -> timeline -> firing-axis/anim-collision),
// and reports the postconditions BRIEF6 asks for:
//
//   aim error at release      emitter firing axis vs the victim line (deg, the R1 measure of K19b)
//   release point             emitter origin at release, vs the K19a medians (body-height shares)
//   wind-up                   how far behind/above the release point the emitter went, before it
//   convergence gap           distance between the emitters at release vs the K19c combined/spread rule
//   penetration               anim-collision's pose test over the whole action (worst clearance, count)
//   joint margin              elbow/shoulder flexion and the worst per-tick angular step (limits if the
//                             solver exports them, otherwise the straight-joint 180 deg bar)
//   ground drift              lowest vertex and root travel over the action (feet planted)
//   idle resumes              the animator hands back to its own idle after the script ends
//
// Nothing here names a species in battle logic: the exemplar list is the TEST HARNESS (BRIEF6) and the
// measurement code is generic.
//
//   node tools/k19d_postconditions.mjs
//   node tools/k19d_postconditions.mjs --tag before --md /home/dorij/scratch-research/anim-k19d.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const PLACEMENT = path.join(ROOT, "web/assets/battle/model_placement.json");
const BASE_Z = 5120;
const VICTIM_LINE = 2 * BASE_Z;
const TICK_SPEED = 2;
const CAP_TICKS = 1400;

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const TAG = arg("tag", "before");
const OUT_JSON = arg("json", "/home/dorij/scratch-research/anim-k19d-post.json");
const OUT_MD = arg("md", null);
// --solver: the AFTER pass. The harness owns the solver's scope (the engine only takes over the pairs a
// scope enables), then resolves exactly as the viewer does — the technique's own name included, without
// which the solver can never see the pair.
const SOLVER = argv.includes("--solver") || TAG === "after";

// ── the slice (BRIEF6: three exemplars, one per emitter class) ────────────────────────────────
// Chosen by tools/k19d_select.mjs: Piedmon is the user's two-bare-hands example (still the planted
// own-body cast today), Knightmon the user's held-prop example (right-arm greatsword; today the A10
// gate bakes the Duke donor cast into it, so its "before" is that bake), Kokatorimon is the
// mouth-emitter class (Air Blast, mouth, large, planted today).
const EXEMPLARS = [
  { key: "bare-hands", folder: "m228piem", name: "Piedmon", techId: 167, tech: "Darkness Chaos", clip: 9, motionClass: "both-hands", emitters: ["left-arm", "right-arm"] },
  { key: "prop-arm", folder: "m178kngt", name: "Knightmon", techId: 158, tech: "Electro Bolt", clip: 9, motionClass: "prop", emitters: ["right-arm"] },
  { key: "mouth-head", folder: "m050coca", name: "Kokatorimon", techId: 153, tech: "Air Blast", clip: 9, motionClass: "mouth", emitters: ["mouth"] },
];

const { ActorAnimator } = await import(path.join(ROOT, "web/fight/actor-animator.js"));
const { prepareModelDonors, setDonorLoader, resolveClipScript } = await import(path.join(ROOT, "web/fight/clip-fallback.js"));
const { setSkillTable, setTechTable, techRecord, techTargetClass } = await import(path.join(ROOT, "web/fight/fight-tables.js"));
const { basicAttackHitCount } = await import(path.join(ROOT, "web/vendor/engine.js"));
const FA = await import(path.join(ROOT, "web/fight/firing-axis.js"));
const AC = await import(path.join(ROOT, "web/fight/anim-collision.js"));
const A = await import(path.join(ROOT, "web/fight/digimon-anatomy.js"));
const MC = await import(path.join(ROOT, "web/fight/motion-constants.js"));
const DM = await import(path.join(ROOT, "web/fight/digimon-bonemap.js"));
const S = await import(path.join(ROOT, "web/fight/anim-solver.js"));
if (SOLVER) S.setSolverScope("all");

// ── data ──────────────────────────────────────────────────────────────────────────────────────
const dj = JSON.parse(fs.readFileSync(path.join(ROOT, "web/assets/data/digimon.json"), "utf8"));
const techTable = JSON.parse(fs.readFileSync(path.join(ROOT, "web/assets/data/fight_tech_table.json"), "utf8"));
const placement = JSON.parse(fs.readFileSync(PLACEMENT, "utf8")).models || {};
setSkillTable(dj.skills);
setTechTable(techTable);
const skills = new Map((dj.skills || []).map((s) => [s.id | 0, s]));
const modelNumber = (folder) => folder.match(/^m(\d+)/)?.[1] ?? "0";
const cache = new Map();
setDonorLoader((folder) => {
  if (!cache.has(folder)) {
    const f = path.join(MODELS, folder, "anim.json");
    cache.set(folder, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
  }
  return Promise.resolve(cache.get(folder));
});
const loadModel = (folder) => JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));

/** The fighter's slot (K19b's worldToLocal convention): x=0, y=-hover, z=±(base+standoff). */
function slotOf(folder, side) {
  const rec = placement[modelNumber(folder)] || {};
  const standoff = rec.standoff | 0, hover = rec.hover | 0;
  return { side, x: 0, y: -hover, z: side === "enemy" ? BASE_Z + standoff : -(BASE_Z + standoff), standoff, hover };
}

// ── small math ───────────────────────────────────────────────────────────────────────────────
const deg = (r) => (r * 180) / Math.PI;
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
const median = (xs) => quantile(xs, 0.5);

/** Angle (deg) at joint b between segments b->a and b->c. */
function jointAngle(pose, a, b, c) {
  if (a == null || b == null || c == null) return null;
  if (!pose.pos[a] || !pose.pos[b] || !pose.pos[c]) return null;
  const u = FA.sub(pose.pos[a], pose.pos[b]), v = FA.sub(pose.pos[c], pose.pos[b]);
  if (FA.len(u) < 1e-9 || FA.len(v) < 1e-9) return null;
  const cos = Math.max(-1, Math.min(1, FA.dot(FA.unit(u), FA.unit(v))));
  return deg(Math.acos(cos));
}

/** The model's own floor and height in the rest pose. The pose frame is +Y DOWN (firing-axis.js's
 *  convention, the PS1 one): the floor is the LARGEST vertex y and the crown the smallest. */
function restBox(model) {
  const pose = FA.restPoseOf(model);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < model.bones.length; i++) {
    for (const v of model.bones[i].verts || []) {
      const y = FA.vertexWorld(model, i, v, pose)[1];
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return { floor: hi, top: lo, height: hi - lo, pose };
}

/** Lowest point of a posed model (the ground contact) — +Y is down, so it is the LARGEST vertex y. */
function lowestVertex(model, pose) {
  let lo = -Infinity;
  for (let i = 0; i < model.bones.length; i++) {
    for (const v of model.bones[i].verts || []) {
      const y = FA.vertexWorld(model, i, v, pose)[1];
      if (y > lo) lo = y;
    }
  }
  return lo;
}

// ── the technique's own launch sites (K14 shots -> emitter ids; else the body's named emitter) ──
function sitesFor(folder, techName) {
  const em = A.emitters(folder);
  const byId = new Map(em.map((e) => [e.id, e]));
  const shot = A.shotsFor(folder, techName);
  let ids = [];
  if (shot && shot.mode !== "none" && (shot.emitters || []).length) ids = shot.emitters.slice();
  if (!ids.length) {
    const ranged = em.filter((e) => e.kind !== "melee").map((e) => e.id);
    if (ranged.length) ids = ranged;
  }
  if (!ids.length) {
    const primary = em.find((e) => e.primary);
    if (primary) ids = [primary.id];
  }
  return { shot, ids, byId };
}

// ── the measurement ───────────────────────────────────────────────────────────────────────────
async function measure(ex) {
  const model = loadModel(ex.folder);
  await prepareModelDonors(model);
  model.folder = ex.folder;
  const skill = skills.get(ex.techId | 0);
  const rec = techRecord(ex.techId);
  const opts = {
    element: rec?.elem1 ?? 1,
    target: techTargetClass(ex.techId),
    hits: basicAttackHitCount(false, { effect_id: rec?.dispatch ?? 2, hits: skill?.hits ?? rec?.hits ?? 1 }),
    planted: rec?.attack_category === "magical",
    tech: skill?.name ?? null,
  };
  const script = resolveClipScript(model, ex.clip, opts);
  const box = restBox(model);
  const slot = slotOf(ex.folder, "near");

  // play the script exactly as the viewer does
  const anim = new ActorAnimator(model);
  anim.homeSlot = slot;
  anim.baseTable = 0;
  const frames = [], releases = [], strikes = [], fx = [];
  let tick = 0;
  const ok = anim.setAction(ex.clip, {
    setLunge: (l) => { if (l && l.sub === 0 && Array.isArray(l.from)) releases.push({ tick, id: l.id, from: l.from.slice() }); },
    onEffect: (r) => fx.push({ tick, type: r.type, x: r.x | 0, y: r.y | 0, z: r.z | 0 }),
    onHit: (r) => strikes.push({ tick, type: r.type }),
  }, opts);
  if (!ok) return { ...ex, ok: false, error: "no script built" };
  while (anim.vm && tick < CAP_TICKS) {
    anim.tick(TICK_SPEED);
    frames.push({ tick, frame: anim.currentFrame(), blend: anim.currentBlend(), move: anim.moveDelta().slice(), pose: FA.poseFromChannels(model, anim.currentFrame(), { blend: anim.currentBlend() }) });
    tick++;
    if (frames.length > 8 && anim.vm?.ended) break;
  }
  const endTick = frames.length ? frames[frames.length - 1].tick : 0;
  const scriptEnded = !anim.vm || anim.vm.ended;

  // idle handoff: let the animator resume idle the way the renderer does, then read the pose
  const idleTicks = [];
  for (let i = 0; i < 24; i++) {
    anim.tick(TICK_SPEED);
    idleTicks.push({ tick: tick + i, frame: anim.currentFrame(), blend: anim.currentBlend(), vm: !!anim.vm, ended: !!anim.vm?.ended });
  }
  const idleResumed = !anim.vm || anim.vm.ended;
  const idleFrame = anim.currentFrame();

  const release = releases[0] || null;
  const releaseTick = release ? release.tick : (strikes.find((s) => (s.type | 0) === 99) || strikes[0])?.tick ?? Math.floor(endTick / 2);
  const strikeTick = (strikes.find((s) => (s.type | 0) === 99) || strikes[strikes.length - 1])?.tick ?? null;
  const at = (t) => frames[Math.max(0, Math.min(frames.length - 1, t))] || null;

  // emitter sites
  const siteInfo = sitesFor(ex.folder, A.techKey(ex.tech));
  let ids = ex.emitters && ex.emitters.length ? ex.emitters.slice() : siteInfo.ids.slice();
  // an id that the rig does not resolve is dropped (firingAxis says so); a mouth site that the shot
  // names but this body has no bone for is reported as missing
  const releaseFrame = at(releaseTick);
  const releasePose = releaseFrame?.pose || null;
  const emittersAt = (pose) => {
    const out = [];
    for (const id of ids) {
      const ax = FA.firingAxis(model, ex.folder, id, pose);
      if (!ax) continue;
      out.push({ id, cls: ax.cls, bone: ax.bone, method: ax.method, origin: ax.origin, axis: ax.axis });
    }
    return out;
  };
  const atRelease = releasePose ? emittersAt(releasePose) : [];

  // aim: the emitter axis vs the victim line at the emitter's own height (K19b's R1 measure)
  const aims = atRelease.map((e) => {
    const target = [0, e.origin[1], VICTIM_LINE];
    const err = FA.aimError(e.axis, e.origin, target);
    const toTarget = FA.unit(FA.sub(target, e.origin));
    return { id: e.id, cls: e.cls, bone: e.bone, method: e.method, yaw: r2(err.yaw), pitch: r2(err.pitch), angle: r2(err.full) };
  });
  const aim = aims.length ? Math.min(...aims.map((a) => Math.abs(a.angle ?? 999))) : null;

  // release point, in body-height shares, and the class medians it is compared with
  const H = box.height;
  const armEquip = A.armEquipSides(ex.folder);
  const armSide = atRelease[0]?.cls === "prop" || ex.motionClass === "prop"
    ? (ex.emitters[0] || "").replace("-arm", "") || "right" : null;
  const armLen = armSide && armEquip?.[armSide]?.features ? armEquip[armSide].features[0] * H : null;
  const releasesOut = atRelease.map((e) => {
    const height = box.floor - e.origin[1];                   // y down: floor - y = height above the floor
    const forward = e.origin[2];
    const lateral = e.origin[0];
    return { id: e.id, height: r2(height), forward: r2(forward), lateral: r2(lateral),
             hFrac: r3(height / H), fFrac: r3(forward / H), lFrac: r3(lateral / H) };
  });
  const medianRelease = MC.motionFor(ex.motionClass, A.sizeClass(ex.folder));
  const targetRelease = MC.releasePoint({ emitterClass: ex.motionClass, sizeClass: A.sizeClass(ex.folder), bodyHeight: H, armLength: armLen, quantile: 0.5 });
  const releaseErr = releasesOut.length && targetRelease ? {
    height: r2(releasesOut[0].height - targetRelease.height),
    forward: r2(releasesOut[0].forward - targetRelease.forward),
    lateral: r2(releasesOut[0].lateral - targetRelease.lateral),
    unit: targetRelease.unit,
  } : null;

  // wind-up: the emitter's own excursion before the release
  const pre = frames.filter((f) => f.tick <= releaseTick);
  const windup = [];
  for (const e of atRelease) {
    let back = 0, up = 0, travel = 0;
    for (const f of pre) {
      const ax = FA.firingAxis(model, ex.folder, e.id, f.pose);
      if (!ax) continue;
      const d = FA.sub(e.origin, ax.origin);
      back = Math.max(back, d[2]);           // behind = the sample's z is smaller than the release point's
      up = Math.max(up, d[1]);               // above = the sample's y is smaller (y is down)
      travel = Math.max(travel, FA.len(FA.sub(ax.origin, e.origin)));
    }
    windup.push({ id: e.id, back: r2(back), up: r2(up), travel: r2(travel), backH: r3(back / H), upH: r3(up / H), travelH: r3(travel / H) });
  }
  const targetWindup = MC.windupFor({ emitterClass: ex.motionClass, sizeClass: A.sizeClass(ex.folder), bodyHeight: H, quantile: 0.5 });

  // convergence: distance between the emitters at release, against the K19c rule
  let gap = null, gapRule = null;
  const pts = atRelease.map((e) => e.origin);
  if (pts.length >= 2) {
    let mn = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) mn = Math.min(mn, FA.dist(pts[i], pts[j]));
    gap = mn;
    const mode = siteInfo.shot?.mode ?? null;
    gapRule = AC.sharedShotMode({ mode, emitters: ex.emitters }, pts.length);
  }

  // penetration over the action (sampled every tick; the rig's own tolerance)
  const rig = AC.rigColliders(model, ex.folder);
  let worstClear = Infinity, violations = 0, worstPair = null;
  for (const f of frames) {
    const p = AC.penetration(model, f.pose, { folder: ex.folder, rig });
    if (p.clearance < worstClear) { worstClear = p.clearance; worstPair = p.worst; }
    if (!p.ok) violations++;
  }

  // joint margin: the emitter arm's own chain. A 3+ bone chain has an elbow to measure; a 2-bone
  // arm has no elbow, so the shoulder swing is reported instead and the margin is against the
  // straight-joint 180 deg bar (the solver's own limits, when it exports them, replace that bar).
  const jointRows = [];
  for (const id of ids) {
    const armSide = /left-arm/.test(id) ? "left" : /right-arm/.test(id) ? "right" : null;
    const chains = armSide ? (DM.armChains(ex.folder) || []) : [];
    const c = armSide === "left" ? (chains[0] || null) : (chains[chains.length - 1] || null);
    if (!c || c.length < 2) continue;
    const angles = [], swings = [];
    for (const f of frames) {
      if (c.length >= 3) {
        const a = jointAngle(f.pose, c[c.length - 3], c[c.length - 2], c[c.length - 1]);
        if (a != null) angles.push(a);
      } else {
        const u = FA.sub(f.pose.pos[c[c.length - 1]], f.pose.pos[c[0]]);
        const torso = FA.sub(f.pose.pos[DM.BONEMAP[ex.folder]?.h ?? 0], f.pose.pos[0]);
        const a = deg(Math.acos(Math.max(-1, Math.min(1, FA.dot(FA.unit(u), FA.unit(torso))))));
        swings.push(a);
      }
    }
    const bend = angles.length ? Math.min(...angles) : null;
    jointRows.push({ id, chain: c, bones: c.length,
      bendMin: r2(bend), bendMax: r2(angles.length ? Math.max(...angles) : null),
      swingMin: r2(swings.length ? Math.min(...swings) : null), swingMax: r2(swings.length ? Math.max(...swings) : null),
      margin: r2(bend != null ? 180 - bend : null) });
  }
  const worstStep = frames.length > 1 ? r3(Math.max(...frames.map((f, i) => {
    if (!i) return 0;
    const p0 = frames[i - 1].pose, p1 = f.pose;
    let mx = 0;
    for (let b = 1; b < model.bones.length; b++) mx = Math.max(mx, FA.dist(p0.pos[b], p1.pos[b]));
    return mx / H;
  }))) : null;

  // ground: lowest vertex and root travel over the action
  const lows = frames.map((f) => lowestVertex(model, f.pose) - box.floor);
  const rootXZ = frames.map((f) => [f.pose.pos[0][0], f.pose.pos[0][2]]);
  const ground = {
    lowestMin: r2(Math.min(...lows)), lowestMax: r2(Math.max(...lows)),
    driftH: r3((Math.max(...lows) - Math.min(...lows)) / H),
    rootDx: r2(Math.max(...rootXZ.map((p) => p[0])) - Math.min(...rootXZ.map((p) => p[0]))),
    rootDz: r2(Math.max(...rootXZ.map((p) => p[1])) - Math.min(...rootXZ.map((p) => p[1]))),
  };

  // the script's own shape, so a reader can tell planted from retargeted from solver
  const tables = [...new Set((script?.ops || []).filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0).map((o) => o.words?.[2]))];
  return {
    ...ex, ok: true, tag: TAG,
    model: { height: r2(H), floor: r2(box.floor), size: A.sizeClass(ex.folder), plan: A.anatomy(ex.folder)?.plan ?? null },
    script: { buildKind: script?.buildKind ?? null, retargeted: !!script?.retargeted, synthesized: !!script?.synthesized,
              tables, ops: script?.ops?.length ?? 0, castBakes: Object.keys(model.castBakes || {}), solverBakes: Object.keys(model.solverBakes || {}),
              solver: script?.solver ? { cls: script.solver.cls, mode: script.solver.mode, table: script.solver.table,
                                          release: script.solver.release, flight: script.solver.flight,
                                          aim: r2(script.solver.report?.worstAim), gate: script.solver.report?.gate ?? null,
                                          pass: script.solver.report?.pass ?? null,
                                          clearance: script.solver.report?.penetration ? { ok: script.solver.report.penetration.ok, clearance: r2(script.solver.report.penetration.clearance), tolerance: r2(script.solver.report.penetration.tolerance) } : null } : null },
    ticks: { end: endTick, release: releaseTick, strike: strikeTick, frames: frames.length, scriptEnded },
    launches: releases.length,
    emitters: atRelease.map((e) => ({ id: e.id, cls: e.cls, bone: e.bone, method: e.method })),
    aims, aimWorst: r2(aim),
    release: releasesOut, releaseMedian: targetRelease ? { height: r2(targetRelease.height), forward: r2(targetRelease.forward), lateral: r2(targetRelease.lateral), source: targetRelease.source, unit: targetRelease.unit } : null,
    releaseErr,
    windup, windupMedian: targetWindup ? { back: r2(targetWindup.back), up: r2(targetWindup.up), travel: r2(targetWindup.travel), phases: { windup: targetWindup.windup, flight: targetWindup.flight, follow: targetWindup.follow } } : null,
    convergence: { gap: r2(gap), gapH: r3(gap == null ? null : gap / H), rule: gapRule, combinedGapH: AC.SHARED_SHOT.combinedGap, minSeparationH: AC.SHARED_SHOT.minSeparation },
    penetration: { clearance: r2(worstClear), clearanceH: r3(worstClear / H), violations, worst: worstPair },
    joints: { rows: jointRows, worstStep },
    ground,
    idle: { resumed: idleResumed, frame: idleFrame, ticks: idleTicks.slice(0, 4) },
    fx: fx.slice(0, 6),
  };
}

const results = [];
for (const ex of EXEMPLARS) {
  try { results.push(await measure(ex)); }
  catch (e) { results.push({ ...ex, ok: false, error: String(e && e.stack || e) }); }
}
const doc = { tag: TAG, generatedAt: new Date().toISOString(), tickSpeed: TICK_SPEED, victimLine: VICTIM_LINE, results };
fs.writeFileSync(OUT_JSON, JSON.stringify(doc, null, 1));

// ── the table ────────────────────────────────────────────────────────────────────────────────
const f = (x, n = 2) => (x == null || !Number.isFinite(x) ? "—" : (+x).toFixed(n));
console.log(`K19d postconditions [${TAG}]`);
for (const r of results) {
  if (!r.ok) { console.log(`\n${r.name} (${r.folder}) FAILED: ${r.error}`); continue; }
  console.log(`\n${r.name} (${r.folder}) ${r.tech} clip ${r.clip} — ${r.script.buildKind}${r.script.retargeted ? " retargeted" : " planted"}${r.script.solver ? " SOLVED " + r.script.solver.cls + "/" + r.script.solver.mode + " aim " + (r.script.solver.aim == null ? "—" : r.script.solver.aim + "°") + " gate " + JSON.stringify(r.script.solver.gate) : ""}`);
  console.log(`  release tick ${r.ticks.release} of ${r.ticks.end}, ${r.launches} op6 launch(es), strike ${r.ticks.strike ?? "—"}, script ended ${r.ticks.scriptEnded}`);
  console.log(`  aim error at release: ${r.aimWorst == null ? "—" : f(r.aimWorst, 1) + "°"} ${r.aims.map((a) => `${a.id}:${f(a.angle, 1)}°`).join(" ")}`);
  for (const rel of r.release) console.log(`  release point ${rel.id}: height ${f(rel.height)} (${f(rel.hFrac)} H), forward ${f(rel.forward)} (${f(rel.fFrac)} H), lateral ${f(rel.lateral)} (${f(rel.lFrac)} H)`);
  if (r.releaseMedian) console.log(`  median ${r.releaseMedian.source} ${r.releaseMedian.unit}: height ${f(r.releaseMedian.height)} forward ${f(r.releaseMedian.forward)} lateral ${f(r.releaseMedian.lateral)}; error h/f/l ${f(r.releaseErr?.height)}/${f(r.releaseErr?.forward)}/${f(r.releaseErr?.lateral)}`);
  for (const w of r.windup) console.log(`  wind-up ${w.id}: back ${f(w.back)} (${f(w.backH)} H) up ${f(w.up)} (${f(w.upH)} H) travel ${f(w.travel)} (${f(w.travelH)} H)`);
  console.log(`  convergence: gap ${f(r.convergence.gap)} (${f(r.convergence.gapH)} H) vs mode ${r.convergence.rule ?? "—"} (combined ${r.convergence.combinedGapH} H, min sep ${r.convergence.minSeparationH} H)`);
  console.log(`  penetration: worst clearance ${f(r.penetration.clearance)} (${f(r.penetration.clearanceH)} H), violations ${r.penetration.violations} of ${r.ticks.frames}`);
  console.log(`  joints: ${r.joints.rows.map((j) => `${j.id} bend ${f(j.bendMin, 0)}° margin ${f(j.margin, 0)}°`).join(", ") || "—"}; worst per-tick bone step ${f(r.joints.worstStep)}`);
  console.log(`  ground: lowest ${f(r.ground.lowestMin)}..${f(r.ground.lowestMax)} (drift ${f(r.ground.driftH, 3)} H), root dx/dz ${f(r.ground.rootDx)}/${f(r.ground.rootDz)}`);
  console.log(`  idle resumes: ${r.idle.resumed ? "yes" : "NO"} (frame ${r.idle.frame})`);
}
if (OUT_MD) fs.writeFileSync(OUT_MD, "report written by tools/k19d_postconditions.mjs\n");
console.log(`\nwrote ${OUT_JSON}`);
