#!/usr/bin/env node
// K19d postconditions for the SOLVER's output (the "after" numbers).
//
// The lead's solver (web/fight/anim-solver.js) bakes its cast into the model's own channels at a far
// table (A15 offset). This tool calls `solveCast` on each exemplar, then reads the baked channels back
// EXACTLY as the renderer will (poseFromChannels at offset+t) and measures the postconditions BRIEF6
// asks the harness for:
//
//   aim at release        emitter firing axis vs the victim line (deg) — and the best tick, so a pose
//                         that aims a few frames early is visible rather than a single number
//   release point         emitter origin at release vs the K19a medians, in body-height shares
//   wind-up               how far behind/above the emitter went before release, vs K19a's median
//   convergence           emitter distance at release vs the K19c combined/spread rule
//   penetration           anim-collision over the whole cast (worst clearance vs the authored floor)
//   joint margin          elbow flexion and the worst per-tick bone step
//   ground                lowest vertex range and root travel (feet planted)
//   idle resumes          the model's own table 0 is untouched and its pose is the rest pose
//
// It also checks the solver's OWN numbers against the read-back: solveCast's `report.aim` is measured
// inside the solve, and a pose that is verified there but drawn differently is exactly the class of bug
// a harness is for.
//
//   node tools/k19d_solver_measure.mjs
//   node tools/k19d_solver_measure.mjs --json /tmp/x.json --md /tmp/x.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const PLACEMENT = path.join(ROOT, "web/assets/battle/model_placement.json");
const BASE_Z = 5120;
const VICTIM_LINE = 2 * BASE_Z;

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const OUT_JSON = arg("json", "/home/dorij/scratch-research/anim-k19d-solver.json");
const ONLY = arg("model", null);

// the slice (BRIEF6: the test harness is the only place these ids appear)
const EXEMPLARS = [
  { key: "bare-hands", folder: "m228piem", name: "Piedmon", tech: "Darkness Chaos", techId: 167, clip: 9, motionClass: "both-hands" },
  { key: "prop-arm", folder: "m178kngt", name: "Knightmon", tech: "Electro Bolt", techId: 158, clip: 9, motionClass: "prop" },
  { key: "mouth-head", folder: "m050coca", name: "Kokatorimon", tech: "Air Blast", techId: 153, clip: 9, motionClass: "mouth" },
];

const { prepareModelDonors, setDonorLoader, resolveClipScript } = await import(path.join(ROOT, "web/fight/clip-fallback.js"));
const S = await import(path.join(ROOT, "web/fight/anim-solver.js"));
const FA = await import(path.join(ROOT, "web/fight/firing-axis.js"));
const AC = await import(path.join(ROOT, "web/fight/anim-collision.js"));
const A = await import(path.join(ROOT, "web/fight/digimon-anatomy.js"));
const MC = await import(path.join(ROOT, "web/fight/motion-constants.js"));
const DM = await import(path.join(ROOT, "web/fight/digimon-bonemap.js"));

const placement = JSON.parse(fs.readFileSync(PLACEMENT, "utf8")).models || {};
const cache = new Map();
setDonorLoader((folder) => {
  if (!cache.has(folder)) {
    const f = path.join(MODELS, folder, "anim.json");
    cache.set(folder, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
  }
  return Promise.resolve(cache.get(folder));
});
const loadModel = (folder) => {
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
  m.folder = folder;
  return m;
};
const clone = (v) => JSON.parse(JSON.stringify(v));

const deg = (r) => (r * 180) / Math.PI;
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

function jointAngle(pose, a, b, c) {
  if (a == null || b == null || c == null) return null;
  if (!pose.pos[a] || !pose.pos[b] || !pose.pos[c]) return null;
  const u = FA.sub(pose.pos[a], pose.pos[b]), v = FA.sub(pose.pos[c], pose.pos[b]);
  if (FA.len(u) < 1e-9 || FA.len(v) < 1e-9) return null;
  const cos = Math.max(-1, Math.min(1, FA.dot(FA.unit(u), FA.unit(v))));
  return deg(Math.acos(cos));
}

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

function measure(ex) {
  const pristine = loadModel(ex.folder);
  const model = loadModel(ex.folder);
  const box = restBox(model);
  const H = box.height;

  const group = S.solverGroup(model, { tech: ex.tech });
  const plan = group.ok ? S.planCast(model, group) : null;
  const res = group.ok && plan?.ok ? S.solveCast(model, { tech: ex.tech, apply: true }) : null;
  if (!res) {
    // the group/plan refused (not a cast, no emitter geometry, or a rule the engine will not take):
    // report that plainly rather than as an exception
    return { ...ex, H: r2(H), size: A.sizeClass(ex.folder),
      group: group.ok ? { cls: group.cls, mode: group.mode, sites: (group.sites || []).map((s) => s.id) } : { ok: false, why: group.why ?? null },
      plan: plan ? { ok: plan.ok, why: plan.why ?? null } : null, solved: false, refused: true };
  }
  const out = {
    ...ex, H: r2(H), size: A.sizeClass(ex.folder),
    group: group.ok ? { cls: group.cls, mode: group.mode, sites: (group.sites || []).map((s) => s.id) } : { ok: false, why: group.why ?? null },
    plan: plan ? { ok: plan.ok, release: plan.release, windup: plan.windup, flight: plan.flight, follow: plan.follow, ticks: plan.ticks } : null,
    solved: !!res?.ok, table: res?.table ?? null, offset: res?.offset ?? null, ticks: res?.ticks ?? null,
    gate: res?.report?.gate ?? null, pass: !!res?.report?.pass,
    solverReport: res?.report ? {
      worstAim: r2(res.report.worstAim),
      aim: (res.report.aim || []).map((a) => ({ id: a.id, cls: a.cls, err: r2(a.error) })),
      reached: res.report.reached, clearance: { ok: res.report.penetration?.ok, clearance: r2(res.report.penetration?.clearance), tolerance: r2(res.report.penetration?.tolerance), over: r2(res.report.penetration?.over), clasp: res.report.penetration?.clasp ?? null },
      rootDrift: r3(res.report.rootDrift), metrics: res.report.metrics, shared: res.report.shared, constants: res.report.constants,
    } : null,
  };
  if (!res?.ok) return out;

  // ── read the drawn pose back ──────────────────────────────────────────────────────────────────
  const off = res.offset, n = res.ticks, release = res.tick;
  const frames = [];
  for (let t = 0; t < n; t++) frames.push({ t, pose: FA.poseFromChannels(model, off + t) });

  // the emitters the plan named
  const ids = ((res.plan?.sites || res.group?.sites || [])).map((s) => s.id).filter(Boolean);
  const axisAt = (f, id) => FA.firingAxis(model, ex.folder, id, f.pose);
  const targetFor = (o) => [0, o[1], VICTIM_LINE];

  // aim over the WHOLE cast: at release, and the best tick (a pose that aims early reads as a bug too)
  const aims = [];
  let best = null;
  for (const id of ids) {
    let atRel = null;
    for (const f of frames) {
      const ax = axisAt(f, id);
      if (!ax) continue;
      const err = FA.aimError(ax.axis, ax.origin, targetFor(ax.origin));
      if (!best || Math.abs(err.full) < best.err) best = { id, t: f.t, err: r2(err.full) };
      if (f.t === release) atRel = { id, cls: ax.cls, err: r2(err.full), yaw: r2(err.yaw), pitch: r2(err.pitch), origin: ax.origin };
    }
    if (atRel) aims.push(atRel);
  }
  out.aim = { atRelease: aims, bestTick: best, worstAtRelease: aims.length ? r2(Math.max(...aims.map((a) => Math.abs(a.err)))) : null };

  // release point vs the K19a median
  const rel = aims.map((a) => {
    const height = box.floor - a.origin[1], forward = a.origin[2], lateral = a.origin[0];
    return { id: a.id, height: r2(height), forward: r2(forward), lateral: r2(lateral),
             hFrac: r3(height / H), fFrac: r3(forward / H), lFrac: r3(lateral / H) };
  });
  const armEquip = A.armEquipSides(ex.folder);
  const armSide = (ids[0] || "").replace("-arm", "") || null;
  const armLen = armSide && armEquip?.[armSide]?.features ? armEquip[armSide].features[0] * H : null;
  const median = MC.releasePoint({ emitterClass: ex.motionClass, sizeClass: A.sizeClass(ex.folder), bodyHeight: H, quantile: 0.5 });
  out.release = {
    points: rel,
    median: median ? { height: r2(median.height), forward: r2(median.forward), lateral: r2(median.lateral), source: median.source } : null,
    error: rel.length && median ? { height: r2(rel[0].height - median.height), forward: r2(rel[0].forward - median.forward), lateral: r2(rel[0].lateral - median.lateral) } : null,
    hand: { armSide, armLen: r2(armLen) },
  };

  // wind-up: the emitter's own excursion before the release
  const wu = [];
  for (const a of aims) {
    let back = 0, up = 0, travel = 0, apex = null;
    for (const f of frames) {
      if (f.t > release) break;
      const ax = axisAt(f, a.id);
      if (!ax) continue;
      const d = FA.sub(a.origin, ax.origin);
      if (d[2] > back) { back = d[2]; apex = f.t; }
      up = Math.max(up, d[1]);
      travel = Math.max(travel, FA.len(FA.sub(ax.origin, a.origin)));
    }
    wu.push({ id: a.id, back: r2(back), up: r2(up), travel: r2(travel), backH: r3(back / H), upH: r3(up / H), travelH: r3(travel / H), apexTick: apex });
  }
  const wuMedian = MC.windupFor({ emitterClass: ex.motionClass, sizeClass: A.sizeClass(ex.folder), bodyHeight: H, quantile: 0.5 });
  out.windup = { emitters: wu, median: wuMedian ? { back: r2(wuMedian.back), up: r2(wuMedian.up), travel: r2(wuMedian.travel), phases: { windup: wuMedian.windup, flight: wuMedian.flight, follow: wuMedian.follow } } : null };

  // convergence at release, and the closest the pair ever got
  let gap = null, gapMin = null;
  if (ids.length >= 2) {
    const at = frames.find((f) => f.t === release);
    const pts = at ? ids.map((id) => axisAt(at, id)?.origin).filter(Boolean) : [];
    const pairMin = (ps) => { let m = Infinity; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) m = Math.min(m, FA.dist(ps[i], ps[j])); return m; };
    if (pts.length >= 2) gap = pairMin(pts);
    gapMin = Infinity;
    for (const f of frames) {
      const ps = ids.map((id) => axisAt(f, id)?.origin).filter(Boolean);
      if (ps.length >= 2) gapMin = Math.min(gapMin, pairMin(ps));
    }
  }
  const rule = ids.length >= 2 ? AC.sharedShotMode({ mode: res.mode, emitters: ids }, ids.length) : null;
  out.convergence = {
    gap: r2(gap), gapH: r3(gap == null ? null : gap / H),
    minGap: r2(gapMin), minGapH: r3(gapMin == null || !Number.isFinite(gapMin) ? null : gapMin / H),
    mode: res.mode, rule, combinedGapH: AC.SHARED_SHOT.combinedGap, minSeparationH: AC.SHARED_SHOT.minSeparation,
  };

  // penetration over the whole cast, clasp declared for a combined shot
  const clasp = res.mode === "combined";
  let worst = Infinity, worstInfo = null, violations = 0;
  for (const f of frames) {
    const p = AC.penetration(model, f.pose, { folder: ex.folder, clasp });
    if (p.clearance < worst) { worst = p.clearance; worstInfo = p.worst; }
    if (!p.ok) violations++;
  }
  out.penetration = { clearance: r2(worst), clearanceH: r3(worst / H), violations, frames: frames.length,
                      worst: worstInfo ? { roleA: worstInfo.roleA, roleB: worstInfo.roleB, boneA: worstInfo.boneA, boneB: worstInfo.boneB, prop: !!worstInfo.prop, floor: r2(worstInfo.floor) } : null };

  // joints: the emitter arm's own chain (elbow when it has one), and the biggest per-tick bone move
  const joints = [];
  for (const id of ids) {
    const side = /left-arm/.test(id) ? "left" : /right-arm/.test(id) ? "right" : null;
    if (!side) continue;
    const chains = DM.armChains(ex.folder) || [];
    const c = side === "left" ? (chains[0] || null) : (chains[chains.length - 1] || null);
    if (!c || c.length < 2) continue;
    const angles = [], swings = [];
    for (const f of frames) {
      if (c.length >= 3) {
        const a = jointAngle(f.pose, c[c.length - 3], c[c.length - 2], c[c.length - 1]);
        if (a != null) angles.push(a);
      } else {
        const u = FA.sub(f.pose.pos[c[c.length - 1]], f.pose.pos[c[0]]);
        const torso = FA.sub(f.pose.pos[DM.BONEMAP[ex.folder]?.h ?? 0], f.pose.pos[0]);
        swings.push(deg(Math.acos(Math.max(-1, Math.min(1, FA.dot(FA.unit(u), FA.unit(torso)))))));
      }
    }
    joints.push({ id, bones: c.length,
      bendMin: r2(angles.length ? Math.min(...angles) : null), bendMax: r2(angles.length ? Math.max(...angles) : null),
      swingMin: r2(swings.length ? Math.min(...swings) : null), swingMax: r2(swings.length ? Math.max(...swings) : null) });
  }
  const steps = [];
  for (let i = 1; i < frames.length; i++) {
    let mx = 0;
    for (let b = 1; b < model.bones.length; b++) mx = Math.max(mx, FA.dist(frames[i - 1].pose.pos[b], frames[i].pose.pos[b]));
    steps.push(mx / H);
  }
  steps.sort((a, b) => a - b);
  out.joints = { rows: joints, worstStep: r3(steps.length ? steps[steps.length - 1] : null), medianStep: r3(steps.length ? steps[Math.floor(steps.length / 2)] : null),
                 limitDeg: S.K16?.maxJoint != null ? r2(deg(S.K16.maxJoint)) : null };

  // ground: lowest vertex over the cast and the root's own travel
  const lows = frames.map((f) => lowestVertex(model, f.pose) - box.floor);
  let rootMax = 0;
  for (const f of frames) {
    const d = FA.len(FA.sub(f.pose.pos[0], frames[0].pose.pos[0]));
    if (Number.isFinite(d) && d > rootMax) rootMax = d;
  }
  out.ground = {
    lowestMin: r2(Math.min(...lows)), lowestMax: r2(Math.max(...lows)),
    driftH: r3((Math.max(...lows) - Math.min(...lows)) / H),
    rootMax: r3(rootMax / H),
  };

  // idle: the model's own authored channels are untouched, and table 0 still poses the rest shape
  let changed = 0;
  for (let i = 0; i < model.bones.length; i++) {
    const a0 = (pristine.bones[i]?.anim?.ch2 || []).map((r) => r.join(",")).join(";");
    const a1 = (model.bones[i]?.anim?.ch2 || []).filter((r) => r[3] < S.SOLVER.offset).map((r) => r.join(",")).join(";");
    if (a0 !== a1) changed++;
  }
  const idlePose = FA.poseFromChannels(pristine, 0);
  let idleDist = 0;
  for (let i = 0; i < pristine.bones.length; i++) idleDist = Math.max(idleDist, FA.dist(idlePose.pos[i], box.pose.pos[i]));
  out.idle = { authoredChannelsChanged: changed, table0VsRest: r3(idleDist / H), resumes: changed === 0 && idleDist / H < 0.02 };

  out.script = (() => {
    // what the ENGINE would play for this clip today (the hook may not be wired yet): the harness says
    // which of the two the numbers above describe.
    const sc = resolveClipScript(model, ex.clip, {});
    return { buildKind: sc?.buildKind ?? null, retargeted: !!sc?.retargeted, solverTable: res.table, hookUsesSolver: (sc?.ops || []).some((o) => o.op === 2 && (o.words?.[0] | 0) === 0 && (o.words?.[2] | 0) === res.table) };
  })();
  return out;
}

const results = [];
for (const ex of EXEMPLARS) {
  if (ONLY && ONLY !== ex.folder) continue;
  try { results.push(measure(ex)); }
  catch (e) { results.push({ ...ex, error: String((e && e.stack) || e) }); }
}
const doc = { generatedAt: new Date().toISOString(), victimLine: VICTIM_LINE, results };
fs.writeFileSync(OUT_JSON, JSON.stringify(doc, null, 1));

const f = (x, n = 2) => (x == null || !Number.isFinite(x) ? "—" : (+x).toFixed(n));
console.log("K19d solver postconditions (read back from the baked channels)");
for (const r of results) {
  if (r.error) { console.log(`\n${r.name}: ERROR ${r.error.slice(0, 300)}`); continue; }
  console.log(`\n${r.name} (${r.folder}) ${r.tech} — ${r.group.cls}/${r.group.mode} sites ${JSON.stringify(r.group.sites)} H ${f(r.H, 0)}`);
  console.log(`  solver: solved=${r.solved} table=${r.table} ticks=${r.ticks} release=${r.plan?.release} gate=${JSON.stringify(r.gate)} pass=${r.pass}`);
  if (r.solverReport) {
    console.log(`  solver's own aim: ${JSON.stringify(r.solverReport.aim)}`);
    console.log(`  solver's own reached (body frac): ${(r.solverReport.reached || []).map((x) => `${x?.id} h${f(x?.height, 3)} f${f(x?.forward, 3)} l${f(x?.lateral, 3)}`).join(", ")}`);
    console.log(`  solver's own clearance: ${JSON.stringify(r.solverReport.clearance)}`);
    console.log(`  solver metrics: ${JSON.stringify(r.solverReport.metrics?.unreachable != null ? { unreachable: r.solverReport.metrics.unreachable, ikClamped: r.solverReport.metrics.ikClamped, jointsClamped: r.solverReport.metrics.jointsClamped, bones: r.solverReport.metrics.bones, aimAfter: r.solverReport.metrics.aimAfter } : r.solverReport.metrics)}`);
    console.log(`  constants: rel h${f(r.solverReport.constants?.rel?.height)} f${f(r.solverReport.constants?.rel?.forward)} l${f(r.solverReport.constants?.rel?.lateral)} (${r.solverReport.constants?.rel?.source}); windup back${f(r.solverReport.constants?.windup?.back)} up${f(r.solverReport.constants?.windup?.up)} travel${f(r.solverReport.constants?.windup?.travel)}`);
  }
  if (r.aim) {
    console.log(`  READ-BACK aim at release: ${r.aim.worstAtRelease == null ? "—" : f(r.aim.worstAtRelease, 1) + "°"} ${r.aim.atRelease.map((a) => `${a.id}:${f(a.err, 1)}°`).join(" ")}; best tick ${r.aim.bestTick ? `t${r.aim.bestTick.t} ${f(r.aim.bestTick.err, 1)}°` : "—"}`);
    for (const p of r.release.points) console.log(`  read-back release ${p.id}: h ${f(p.hFrac, 3)} f ${f(p.fFrac, 3)} l ${f(p.lFrac, 3)} H`);
    console.log(`  median (${r.release.median?.source}): h ${f(r.release.median?.height)} f ${f(r.release.median?.forward)} l ${f(r.release.median?.lateral)}; error h/f/l ${f(r.release.error?.height)}/${f(r.release.error?.forward)}/${f(r.release.error?.lateral)}`);
    for (const w of r.windup.emitters) console.log(`  read-back wind-up ${w.id}: back ${f(w.backH, 3)} up ${f(w.upH, 3)} travel ${f(w.travelH, 3)} H, apex t${w.apexTick}; median ${f(r.windup.median?.back)}/${f(r.windup.median?.up)}/${f(r.windup.median?.travel)}`);
    console.log(`  convergence: release gap ${f(r.convergence.gapH, 3)} H, min gap ${f(r.convergence.minGapH, 3)} H, mode ${r.convergence.mode}, rule ${r.convergence.rule} (combined ${r.convergence.combinedGapH} H, min sep ${r.convergence.minSeparationH} H)`);
    console.log(`  penetration: worst ${f(r.penetration.clearanceH, 3)} H, violations ${r.penetration.violations}/${r.penetration.frames}, worst pair ${r.penetration.worst ? r.penetration.worst.roleA + "/" + r.penetration.worst.roleB : "—"}`);
    console.log(`  joints: ${r.joints.rows.map((j) => `${j.id} bend ${f(j.bendMin, 0)}..${f(j.bendMax, 0)}° swing ${f(j.swingMin, 0)}..${f(j.swingMax, 0)}°`).join(", ") || "—"}; worst step ${f(r.joints.worstStep, 3)} median ${f(r.joints.medianStep, 3)}`);
    console.log(`  ground: lowest ${f(r.ground.lowestMin)}..${f(r.ground.lowestMax)} (drift ${f(r.ground.driftH, 3)} H), root travel ${f(r.ground.rootMax, 3)} H`);
    console.log(`  idle: authored channels changed ${r.idle.authoredChannelsChanged}, table0 vs rest ${f(r.idle.table0VsRest, 3)} H -> ${r.idle.resumes ? "resumes" : "NO"}`);
    console.log(`  engine script today: ${r.script.buildKind}${r.script.retargeted ? " retargeted" : ""}; hook plays solver table: ${r.script.hookUsesSolver}`);
  }
}
console.log(`\nwrote ${OUT_JSON}`);
