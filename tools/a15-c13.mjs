// A15 measurement harness (C13 idle resumes / C14 no duplicate geometry / C15 launch from the weapon).
// Drives the REAL ActorAnimator + FightCoordinator headless for one (model, tech/clip, side), then keeps
// ticking past the script's end and compares the resumed idle against a PRISTINE copy of the same pack.
import fs from "node:fs";
import path from "node:path";

const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const DATA = path.join(REPO, "web/assets/data");
const PLACEMENT = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/battle/model_placement.json"), "utf8")).models;

const b3 = await import(path.join(REPO, "web/battle3d.js"));
const ft = await import(path.join(REPO, "web/fight/fight-tables.js"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const { ActorAnimator } = await import(path.join(REPO, "web/fight/actor-animator.js"));
const { FightCoordinator } = await import(path.join(REPO, "web/fight/fight-coordinator.js"));

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const digimon = readJson(path.join(DATA, "digimon.json"));
const techTable = readJson(path.join(DATA, "fight_tech_table.json"));
const skillById = new Map(digimon.skills.map((s) => [s.id | 0, s]));
const cache = new Map();
const getModel = (folder) => {
  if (!cache.has(folder)) cache.set(folder, readJson(path.join(MODELS, folder, "anim.json")));
  return cache.get(folder);
};
cb.setFallbackDonor(getModel("m005grey").actions);
ft.setTechTable(techTable);
cb.setDonorLoader((folder) => { try { return Promise.resolve(getModel(folder)); } catch { return Promise.resolve(null); } });

const sit = (folder, side) => { const m = getModel(folder); return new ActorAnimator({ ...m }); };

async function actor(folder, side) {
  const pack = readJson(path.join(MODELS, folder, "anim.json"));
  const model = structuredClone(pack);
  model.folder = folder;
  await cb.prepareModelDonors(model);
  const a = new ActorAnimator(model);
  a.resetSlotPlacement(b3.arenaSlotFor(folder, side, PLACEMENT));
  return a;
}

function pose(model, frame, blend) {
  const { mats } = b3.buildBoneWorldMatrices(model, frame, blend);
  const out = [];
  for (let b = 0; b < model.bones.length; b++) {
    const m = mats[b];
    out.push(m ? [m[12], m[13], m[14]] : null);
  }
  return out;
}
const H = (model) => {
  const p = pose(model, model.timeline?.[0]?.table?.[0]?.value ?? 0, null);
  let lo = Infinity, hi = -Infinity;
  for (const v of p) if (v) { lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
  return hi - lo;
};
function maxDist(a, b) {
  let d = 0, at = -1;
  for (let i = 0; i < a.length; i++) {
    if (!a[i] || !b[i]) continue;
    const v = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
    if (v > d) { d = v; at = i; }
  }
  return { d, at };
}
// the bind/rest pose: every local rotation = 0 (what the renderer draws for an all-zero ch2)
function bindPose(model) {
  const m = { ...model, bones: model.bones.map((b) => ({ ...b, anim: { ...(b.anim || {}), ch2: [[0, 0, 0, 0]], ch1: b.anim?.ch1 } })) };
  const out = pose(m, 0, null);
  return out;
}

export async function measure(folder, techId, side = "near", { extraTicks = 140 } = {}) {
  const atk = await actor(folder, side === "near" ? "player" : "enemy");
  const def = await actor(folder, side === "near" ? "enemy" : "player");
  const coord = new FightCoordinator(atk, def);
  const hooks = {};
  const started = techId != null
    ? coord.attack(atk, def, techId, hooks, { lethal: false, miss: false })
    : atk.setAction(9, hooks, { element: 1 });
  const script = techId != null
    ? cb.resolveClipScript(atk.model, ft.techToClip(techId), { element: techTable[String(techId)]?.elem1 ?? 1, target: ft.techTargetClass(techId), tech: skillById.get(techId | 0)?.name ?? null })
    : cb.resolveClipScript(atk.model, 9, { element: 1 });
  let tick = 0, endTick = null;
  const trail = [];
  const during = [];
  while (tick < 900) {
    if (coord.active) coord.tick(1);
    tick++;
    if (!coord.active && endTick == null) endTick = tick;
    if (endTick != null) {
      break;
    }
    trail.push({ tick, frame: atk.currentFrame(), table: atk.timelineTable, vm: !!atk.vm });
    if (tick % 4 === 0 || tick > 150) during.push({ tick, frame: atk.currentFrame(), table: atk.timelineTable });
  }
  // now the idle: 140 further ticks, sample the pose the RENDERER would draw
  const idle = [];
  for (let k = 0; k < extraTicks; k++) {
    atk.tick(1);
    const f = atk.currentFrame();
    const bl = atk.currentBlend();
    idle.push({ k, frame: f, table: atk.timelineTable, blend: bl, pose: pose(atk.model, f, bl) });
  }
  const pristine = sit(folder, side === "near" ? "player" : "enemy");
  const refPose = (f) => pose(pristine.model, f, null);
  const bind = bindPose(pristine.model);
  const h = H(pristine.model) || 1;
  // idle manifold: how far the model's own idle travels from the bind pose (its own distance scale)
  const idleTab = pristine.model.timeline?.[0]?.table ?? [];
  const frames = idleTab.filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0);
  let idleAway = 0;
  for (const f of frames) idleAway = Math.max(idleAway, maxDist(pose(pristine.model, f, null), bind).d);
  const rows = idle.map((s) => {
    const ref = refPose(s.frame);
    const cmp = s.blend ? pose(pristine.model, s.frame, s.blend) : ref;
    const dRef = maxDist(s.pose, cmp).d;
    const dBind = maxDist(s.pose, bind).d;
    return { k: s.k, frame: +s.frame.toFixed(1), table: s.table, dRef: +dRef.toFixed(1), dBind: +dBind.toFixed(1), dBindShare: +(dBind / h).toFixed(3) };
  });
  const worstRef = rows.reduce((a, r) => (r.dRef > a.dRef ? r : a), rows[0]);
  const minBind = rows.reduce((a, r) => (r.dBind < a.dBind ? r : a), rows[0]);
  // the WHOLE action: the pose each tick draws vs the bind pose and vs the pristine pack at that frame
  const bindShare = (p) => +(maxDist(p, bind).d / h).toFixed(3);
  const duringRows = during.map((d) => ({ ...d, dBindShare: bindShare(pose(atk.model, d.frame, null)),
    dRef: +maxDist(pose(atk.model, d.frame, null), refPose(d.frame)).d.toFixed(1) }));
  const flatDuring = duringRows.filter((r) => r.dBindShare < 0.5 * (idleAway / h)).length;
  // C14: mesh census — bones and their mesh ids; a mesh drawn twice is a duplicate part
  const meshIds = (m) => m.bones.map((b, i) => [i, b.mesh_bin ?? null]).filter((r) => r[1] != null);
  const meshes = meshIds(atk.model);
  const dupes = [];
  const seen = new Map();
  for (const [i, id] of meshes) { if (seen.has(id)) dupes.push([seen.get(id), i, id]); else seen.set(id, i); }
  return {
    folder, techId, side, started, hint: script?.buildKind, retargeted: !!script?.retargeted,
    endTick, idleRows: rows, worstRef, minBind, idleAway: +idleAway.toFixed(1), H: +h.toFixed(0),
    duringRows, flatDuring,
    bones: atk.model.bones.length, meshes: meshes.length, dupMeshes: dupes,
    tabs: [...new Set(rows.map((r) => r.table))],
    trail: trail.slice(-8),
  };
}

if (process.argv[1] && process.argv[1].endsWith("a15-c13.mjs")) {
  const folder = process.argv[2] || "m190bolt";
  const tech = process.argv[3] ? Number(process.argv[3]) : null;
  const side = process.argv[4] || "near";
  const r = await measure(folder, tech, side);
  const { idleRows, duringRows, ...head } = r;
  console.log(JSON.stringify(head, null, 1));
  console.log("during rows (tick, frame, table, dBindShare, dRef):");
  for (const row of duringRows.filter((x, i) => i % 5 === 0 || x.tick > 150)) console.log(JSON.stringify(row));
  console.log("idle rows (k, frame, table, dRef, dBind):");
  for (const row of idleRows.filter((_, i) => i % 10 === 0 || i < 12)) console.log(JSON.stringify(row));
}
