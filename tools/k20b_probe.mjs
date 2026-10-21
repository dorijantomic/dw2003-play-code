#!/usr/bin/env node
// K20b probe: what the cast solver makes of a HEAD/MOUTH emitter TODAY (before the head-cast work).
//
// Exemplars are chosen by RULE from the K20a corpus (anatomy/head-casts.json) + the shipped packs, never
// by name:
//   A  the brief's own example: the (folder, technique) pair its exemplar line names  (m050coca Air Blast)
//   B  another mouth body that really casts a SPELL: a clip-9 head-cast row whose model owns more than
//      its basic + signature technique (a base species has no learnable technique, so it cannot be one);
//      the first by folder order, so the pick is deterministic
//   C  a body with a SEPARATE NECK CHAIN: a clip-9/5 head-cast row whose head bone has at least one
//      non-grounded ancestor between it and the root; the first by folder order
//
// For each it prints the numbers the report quotes: head pitch series (mesh frame, degrees relative to the
// model's own neutral), body slide (share of height), idle pop at both ends of the cast (max bone travel
// against the model's own idle, share of height, and the model's own idle-to-idle jitter for scale), aim
// error and which gate keys pass.
//
//   node tools/k20b_probe.mjs [--solver] [--json out.json]
//
// --solver turns the O3 hook ON for the pairs (setSolverScope), which is the shipped viewer's `&solver=1`
// path; without it the solver still runs (solveCast is called directly) but the printed numbers are the
// same: this probe is about what the solver MAKES, not who is enabled.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const RESEARCH = "/home/dorij/scratch-research/anatomy";
const HAVE = fs.existsSync(path.join(MODELS, "m050coca/anim.json"));
if (!HAVE) { console.error("model packs are not installed"); process.exit(2); }

const { prepareModelDonors, setDonorLoader } = await import(path.join(ROOT, "web/fight/clip-fallback.js"));
const S = await import(path.join(ROOT, "web/fight/anim-solver.js"));
const { firingAxis, poseFromChannels } = await import(path.join(ROOT, "web/fight/firing-axis.js"));
const { rigOf, K16 } = await import(path.join(ROOT, "web/fight/anim-retarget.js"));
const { bodyHeight } = await import(path.join(ROOT, "web/fight/anim-collision.js"));
const { emitterBone, chainPrevBone } = await import(path.join(ROOT, "web/fight/launch-plan.js"));
const V = await import(path.join(ROOT, "web/anim-viewer-data.js"));
const { ANIM_DONOR_GAPS } = await import(path.join(ROOT, "web/fight/anim-donor-map.js"));

const json = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const cache = new Map();
setDonorLoader((folder) => {
  if (!cache.has(folder)) cache.set(folder, json(path.join(MODELS, folder, "anim.json")));
  return Promise.resolve(cache.get(folder));
});

const dj = json(path.join(ROOT, "web/assets/data/digimon.json"));
const extra = json(path.join(ROOT, "web/assets/data/extra_species.json"));
const canon = json(path.join(ROOT, "web/assets/data/extra_species_canon.json"));
const modelMap = json(path.join(ROOT, "web/assets/battle/model_map.json"));
const folders = json(path.join(ROOT, "web/assets/battle/models/index.json"));
const techTable = json(path.join(ROOT, "web/assets/data/fight_tech_table.json"));
const skills = new Map((dj?.skills ?? []).map((s) => [s.id | 0, s]));
const index = V.buildModelIndex({ digimon: dj, extraSpecies: extra, extraCanon: canon, modelMap, folders, gaps: ANIM_DONOR_GAPS });
const byFolder = new Map(index.filter((e) => e.folder).map((e) => [e.folder, e]));

const corpus = json(path.join(RESEARCH, "head-casts.json"));
const rows = (corpus?.rows ?? []).filter((r) => r.series?.length);

// the technique a model OWNS for a clip: its own technique ids (buildModelIndex) resolved through the
// shipped skill table and the fight tech table (both carry the technique's clip)
function techsFor(folder, clip) {
  const e = byFolder.get(folder);
  const out = [];
  for (const raw of e?.techs ?? []) {
    const id = Number(raw?.techId ?? raw?.id ?? raw);
    if (!Number.isFinite(id)) continue;
    const sk = skills.get(id | 0);
    const rec = techTable?.[String(id | 0)] ?? null;
    const c = Number(sk?.clip ?? rec?.clip ?? -1);
    if (c !== Number(clip)) continue;
    if (!sk?.name) continue;
    out.push({ techId: id, tech: sk.name, clip: c });
  }
  return out.filter((t) => t.tech);
}

const chainOf = (folder) => {
  const pack = json(path.join(MODELS, folder, "anim.json"));
  if (!pack) return null;
  pack.folder = folder;
  const rig = rigOf(pack);
  return { pack, rig };
};
/** Ancestors of the head bone that are NOT the root and carry no grounded mesh. */
function neckAncestors(pack, headBone) {
  const H = bodyHeight(pack);
  const rest = poseFromChannels(pack, S.neutralFrame(pack));
  const n = pack.num_bones ?? pack.bones.length;
  const parent = Array.from({ length: n }, (_, i) => (pack.bones[i]?.parent_slot ?? 0) - 1);
  const low = S.lowestVertex(pack, rest);
  const grounded = new Set();
  if (Number.isFinite(low.y)) {
    for (let i = 0; i < n; i++) {
      const vs = pack.bones[i].verts || [];
      if (!vs.length) continue;
      const R = rest.rot[i], t = rest.pos[i];
      for (const v of vs) {
        const y = R[1] * v[0] + R[4] * v[1] + R[7] * v[2] + t[1];
        if (y >= low.y - 0.12 * H) { grounded.add(i); break; }
      }
    }
  }
  const subs = (b) => { const out = new Set([b]); for (let k = 0; k < n; k++) { let p = k, g = 0; while (p >= 0 && p < n && g++ < n) { if (p === b) { out.add(k); break; } p = parent[p]; } } return out; };
  const out = [];
  let p = parent[headBone], guard = 0;
  while (p >= 0 && p < n && guard++ < n) {
    const grounds = [...subs(p)].some((b) => grounded.has(b));
    if (!grounds) out.push(p);
    p = parent[p];
  }
  return out;
}

// ── exemplar selection ───────────────────────────────────────────────────────────────────────────────
const clip9 = rows.filter((r) => Number(r.clip) === 9);
const picked = [];
const groupOf = (folder, tech) => {
  const pack = json(path.join(MODELS, folder, "anim.json"));
  if (!pack) return null;
  pack.folder = folder;
  return S.solverGroup(pack, { tech });
};
const given = { folder: "m050coca", tech: "Air Blast", why: "A: the brief's exemplar line" };
if (techsFor(given.folder, 9).some((t) => t.tech === given.tech)) picked.push({ ...given, name: byFolder.get(given.folder)?.name ?? null });
const isHeadCast = (folder, tech) => {
  const g = groupOf(folder, tech);
  return g?.ok && g.cls === "mouth" && g.sites.every((s) => s.cls === "head" || s.cls === "eyes");
};
for (const r of clip9.slice().sort((a, b) => a.folder.localeCompare(b.folder))) {
  if (picked.some((p) => p.folder === r.folder)) continue;
  const e = byFolder.get(r.folder);
  const learnable = (e?.techs ?? []).length - 2;            // basic + signature are not learnable
  if (!(learnable > 0)) continue;
  const t = techsFor(r.folder, 9)[0];
  if (!t || !isHeadCast(r.folder, t.tech)) continue;
  picked.push({ folder: r.folder, name: r.name, tech: t.tech, techId: t.techId, clip: 9, size: r.size, why: `B: clip-9 spell from the head, ${learnable} learnable technique(s)` });
  break;
}
for (const r of clip9.slice().sort((a, b) => a.folder.localeCompare(b.folder))) {
  if (picked.some((p) => p.folder === r.folder)) continue;
  const c = chainOf(r.folder);
  if (!c) continue;
  const neck = neckAncestors(c.pack, r.headBone);
  if (neck.length < 2) continue;
  const t = techsFor(r.folder, 9)[0];
  if (!t || !isHeadCast(r.folder, t.tech)) continue;
  picked.push({ folder: r.folder, name: r.name, tech: t.tech, techId: t.techId, clip: 9, size: r.size, neck: neck.length, why: `C: separate neck chain (${neck.length} non-grounded ancestor(s) above the head)` });
  break;
}

// ── measurement ─────────────────────────────────────────────────────────────────────────────────────
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const meshPitch = (axis) => Math.atan2(axis[1], Math.hypot(axis[0], axis[2])) * 180 / Math.PI;   // MESH frame (+ up); the module's aim pitch is its mirror
function idleFrames(pack) {
  const tab = pack.timeline?.[1]?.table ?? [];
  const out = tab.map((e) => e?.value | 0).filter((v) => v >= 0 && v < 0x8000);
  return out.length ? out : [S.neutralFrame(pack)];
}
function maxBoneDelta(a, b, H) {
  let d = 0;
  for (let i = 0; i < a.pos.length; i++) {
    const p = a.pos[i], q = b.pos[i];
    if (!p || !q) continue;
    d = Math.max(d, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / H);
  }
  return d;
}

const out = [];
for (const ex of picked) {
  const pack = json(path.join(MODELS, ex.folder, "anim.json"));
  pack.folder = ex.folder;
  await prepareModelDonors(pack);
  const model = JSON.parse(JSON.stringify(pack));      // the solver mutates a copy: the packs stay clean
  model.folder = ex.folder;
  await prepareModelDonors(model);
  const group = S.solverGroup(model, { tech: ex.tech });
  const H = bodyHeight(model);
  const base = S.neutralFrame(model);
  const neutral = poseFromChannels(model, base);
  const site = group.ok ? group.sites[0] : null;
  const prev = site ? chainPrevBone(ex.folder, site.id, site.bone) : null;
  const pitch0 = site ? meshPitch((firingAxis(model, ex.folder, site.id, neutral)?.axis) ?? [0, 0, 1]) : 0;
  const rig = rigOf(model);
  const rootC1 = (m, f) => {
    const ch = m.bones[rig.root]?.anim?.ch1 ?? [];
    if (!ch.length) return [0, 0, 0];
    let lo = ch[0], hi = ch[0];
    for (const rec of ch) { if (rec[3] === 30000) break; if (rec[3] <= f) lo = rec; else { hi = rec; break; } }
    if (lo === hi || hi[3] === 30000 || hi[3] <= lo[3]) return [lo[0], lo[1], lo[2]];
    const t = (f - lo[3]) / (hi[3] - lo[3]);
    return [lo[0] + t * (hi[0] - lo[0]), lo[1] + t * (hi[1] - lo[1]), lo[2] + t * (hi[2] - lo[2])];
  };
  const rootNeutral = rootC1(model, base);
  const idle = idleFrames(model);
  let idleJit = 0;
  for (let k = 0; k < idle.length; k++) {
    const a = poseFromChannels(model, idle[k]), b = poseFromChannels(model, idle[(k + 1) % idle.length]);
    idleJit = Math.max(idleJit, maxBoneDelta(a, b, H));
  }
  const res = group.ok ? S.solveCast(model, { tech: ex.tech, apply: true }) : null;
  const rep = res?.report ?? null;
  let series = null, slide = null, pop0 = null, popEnd = null, frozen = null, aim = null;
  if (res?.ok && res.table != null) {
    const off = res.offset, ticks = res.ticks;
    series = [];
    for (let t = 0; t < ticks; t++) {
      const pose = poseFromChannels(model, off + t);
      const fa = firingAxis(model, ex.folder, site.id, pose);
      series.push([t, r3(meshPitch(fa.axis) - pitch0)]);
    }
    slide = 0;
    for (let t = 0; t < ticks; t++) {
      const c1 = rootC1(model, off + t);
      slide = Math.max(slide, Math.hypot(c1[0] - rootNeutral[0], c1[1] - rootNeutral[1], c1[2] - rootNeutral[2]) / H);
    }
    pop0 = maxBoneDelta(poseFromChannels(model, off), neutral, H);
    popEnd = maxBoneDelta(poseFromChannels(model, off + ticks - 1), neutral, H);
    // frozen bones: a bone whose ch2 key values are identical on every tick of the cast
    let frozenBones = 0, keyed = 0;
    for (const b of model.bones) {
      const ch = b.anim?.ch2 ?? [];
      const win = ch.filter((r) => r[3] >= off && r[3] < off + ticks);
      if (win.length < 2) continue;
      keyed++;
      const same = win.every((r) => r[0] === win[0][0] && r[1] === win[0][1] && r[2] === win[0][2]);
      if (same) frozenBones++;
    }
    frozen = { keyed, frozen: frozenBones };
    aim = rep.aim?.map((a) => ({ id: a.id, err: r3(a.error) }));
  }
  out.push({
    folder: ex.folder, name: ex.name ?? null, tech: ex.tech, why: ex.why, size: ex.size ?? null,
    cls: group.ok ? group.cls : group.reason, site: site ? { id: site.id, cls: site.cls, bone: site.bone, neck: neckAncestors(model, site.bone).length } : null,
    H: r3(H), solved: res?.ok ? { table: res.table, ticks: res.ticks, release: res.release, offset: res.offset } : null,
    gate: rep?.gate ?? null, pass: rep?.pass ?? null, aim,
    headGate: rep?.head ?? null, bodyGate: rep?.body ?? null, idlePopGate: rep?.idlePop ?? null,
    headPitch: series ? { peak: Math.max(...series.map((s) => s[1])), peakTick: series.find((s) => s[1] === Math.max(...series.map((q) => q[1])))?.[0], release: series[res.release]?.[1] ?? null } : null,
    bodySlideH: r3(slide), idlePop: { start: r3(pop0), end: r3(popEnd), ownJitter: r3(idleJit) },
    frozen, rootDrift: r3(rep?.rootDrift), motion: rep?.motion ?? null, series,
  });
}

const only = process.argv.includes("--no-series");
const printable = out.map((o) => ({ ...o, series: only ? undefined : o.series }));
console.log(JSON.stringify(printable, null, 1));
const outFile = process.argv.indexOf("--json");
if (outFile >= 0 && process.argv[outFile + 1]) fs.writeFileSync(process.argv[outFile + 1], JSON.stringify(printable, null, 1));
