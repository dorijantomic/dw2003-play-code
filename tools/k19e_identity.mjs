#!/usr/bin/env node
// K19e skeptic — byte-identity of every built script with the O3 hook OFF vs ON (the K19 slice).
//
//   node tools/k19e_identity.mjs [--out /home/dorij/scratch-research/anim-k19e-identity.json]
//
// The claim under test: enabling the solver's scope for the three slice pairs changes NOTHING except
// those three (model, technique) scripts. For every battle model and every (clip, technique) the game
// can ask resolveClipScript for on clips 5/9/10/13, the script is built twice from an identical pristine
// model — once with the scope null (shipped default) and once with the slice — and compared as JSON.
// A model-state digest is taken around each build, so a build that quietly rewrites the model (the
// solver appends keys/tables) is caught even when the script text matches.
//
// A second pass reproduces the ORDER a battle puts a model through (cast, then basic, then another
// spell, ...) on ONE model instance, because the solver's writes persist: a solved cast that leaks its
// table into a later, unrelated build is exactly the defect this pass exists to find.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const MODELS = path.join(REPO, "web/assets/battle/models");
const DATA = path.join(REPO, "web/assets/data");
const argv = process.argv.slice(2);
const ARG = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const OUT = ARG("out", "/home/dorij/scratch-research/anim-k19e-identity.json");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const cb = await import(url.pathToFileURL(path.join(REPO, "web/fight/clip-fallback.js")));
const solver = await import(url.pathToFileURL(path.join(REPO, "web/fight/anim-solver.js")));
const ft = await import(url.pathToFileURL(path.join(REPO, "web/fight/fight-tables.js")));

// ── the slice exactly as the viewer's harness names it (harness data, not engine logic) ──────────────
const SLICE = [
  { folder: "m228piem", tech: "Darkness Chaos" },
  { folder: "m094icem", tech: "Snowstorm" },
  { folder: "m050coca", tech: "Air Blast" },
];
const sliceKey = (folder, tech) => `${folder}|${String(tech ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
const SLICE_KEYS = new Set(SLICE.map((x) => sliceKey(x.folder, x.tech)));

// ── data: donors, models, forms ────────────────────────────────────────────────────────────────────
const donor = readJson(path.join(MODELS, "m005grey/anim.json"));
cb.setFallbackDonor(donor.actions);
const donorCache = new Map();
cb.setDonorLoader((folder) => {
  if (!donorCache.has(folder)) {
    const file = path.join(MODELS, folder, "anim.json");
    donorCache.set(folder, fs.existsSync(file) ? readJson(file) : null);
  }
  return Promise.resolve(donorCache.get(folder));
});

const index = readJson(path.join(MODELS, "index.json"));
const modelMap = readJson(path.join(REPO, "web/assets/battle/model_map.json"));
const digimon = readJson(path.join(DATA, "digimon.json"));
const extra = readJson(path.join(DATA, "extra_species.json"));
const canonical = (n) => ({ "BK WarGreymon": "BKWarGreymon", "Imperialdramon-F": "ImperialdramonFM", "Imperialdramon-P": "ImperialdramonPM" }[n] ?? n);
const skillById = new Map(digimon.skills.map((s) => [s.id | 0, s]));
const techTable = readJson(path.join(DATA, "fight_tech_table.json"));
// the host loads these two before any resolve (battle3d.js); without them techName() is null and the
// solver's (model, technique) scope can never match — the harness would silently test nothing
ft.setSkillTable(digimon);
ft.setTechTable(techTable);

// every (model folder, technique) pair a species form can put through the animator, on these clips
const perFolder = new Map();     // folder -> Set(techId)
for (const s of [...(digimon.digimon || []), ...(extra.digimon || [])]) {
  const folder = modelMap[canonical(s.name)];
  if (!folder || !index.includes(folder)) continue;
  const techs = [...new Set([...(s.techs || []), s.tech_basic, s.tech_signature].filter((t) => t && skillById.has(t | 0)))];
  if (!perFolder.has(folder)) perFolder.set(folder, new Set());
  for (const t of techs) perFolder.get(folder).add(t);
}
// hits exactly as setAnimByTech derives them (dispatch 9 -> the skill's hit count, else 1)
function techHits(techId) {
  const rec = techTable[String(techId)] || null;
  const sk = skillById.get(techId | 0) || null;
  const dispatch = rec?.dispatch ?? 0;
  if (dispatch < 2) return 1;
  if (dispatch === 9) return Math.max(1, sk?.hits ?? 1);
  return 1;
}
function callFor(techId) {
  const rec = ft.techRecord(techId);
  return {
    clip: ft.techToClip(techId),
    target: ft.techTargetClass(techId),
    hits: techHits(techId),
    element: rec?.elem1 ?? 1,
    planted: rec?.attack_category === "magical",
    tech: ft.techName(techId),
    techId,
  };
}

const modelCache = new Map();
function rawModel(folder) {
  if (!modelCache.has(folder)) modelCache.set(folder, readJson(path.join(MODELS, folder, "anim.json")));
  return modelCache.get(folder);
}
const prepared = new Map();
async function preparedModel(folder) {
  if (!prepared.has(folder)) {
    const m = structuredClone(rawModel(folder));
    await cb.prepareModelDonors(m);
    prepared.set(folder, m);
  }
  return prepared.get(folder);
}
const clone = (m) => structuredClone(m);
const digest = (m) => crypto.createHash("sha1").update(JSON.stringify({
  b: (m.bones ?? []).map((b) => [b.anim?.ch1?.length ?? 0, b.anim?.ch2?.length ?? 0]),
  t: Object.keys(m.timeline ?? {}).length,
  s: m.solverCasts ? Object.keys(m.solverCasts) : null,
  n: m.__solverBakes ?? 0,
})).digest("hex").slice(0, 10);
const scriptText = (s) => (s == null ? "null" : JSON.stringify(s));

// ── pass 1: hook OFF vs ON, every case from a pristine model ───────────────────────────────────────
const CLIPS = [5, 9, 10, 13];
const rows = [];
const violations = [];
const diffs = [];
let cases = 0, builds = 0;
let tSolver = 0;

function build(folderModel, call, scopeOn) {
  solver.setSolverScope(scopeOn ? SLICE : null);
  const before = digest(folderModel);
  const t0 = performance.now();
  const script = cb.resolveClipScript(folderModel, call.clip, {
    element: call.element, target: call.target, hits: call.hits, planted: call.planted, tech: call.tech,
  });
  const ms = performance.now() - t0;
  const after = digest(folderModel);
  builds++;
  return { script, ms, before, after, text: scriptText(script) };
}

const folders = index.filter((f) => fs.existsSync(path.join(MODELS, f, "anim.json")));
for (const folder of folders) {
  const base = await preparedModel(folder);
  const techs = [...(perFolder.get(folder) ?? [])];
  const calls = [];
  for (const clip of CLIPS) {
    // an unnamed clip (item / no technique): the pure clip-level build
    calls.push({ clip, target: "enemy", hits: null, element: 1, planted: false, tech: null, techId: null });
    // every technique this body can own that lands on this clip
    for (const t of techs) {
      const c = callFor(t);
      if (c.clip === clip) calls.push(c);
    }
    // the item / self-cast arm
    calls.push({ clip, target: "self", hits: null, element: 1, planted: false, tech: null, techId: null });
  }
  for (const call of calls) {
    const a = build(clone(base), call, false);
    const b = build(clone(base), call, true);
    tSolver += b.ms - a.ms;
    cases++;
    const same = a.text === b.text;
    const key = sliceKey(folder, call.tech);
    const expected = !same && SLICE_KEYS.has(key);
    if (!same) {
      diffs.push({ folder, clip: call.clip, tech: call.tech, techId: call.techId, expected,
        offKind: a.script?.buildKind ?? null, onKind: b.script?.buildKind ?? null,
        offOps: a.script?.ops?.length ?? 0, onOps: b.script?.ops?.length ?? 0 });
      if (!expected) violations.push({ kind: "script-changed", folder, clip: call.clip, tech: call.tech });
    }
    // a build must not rewrite its model when the scope is off
    if (a.before !== a.after) violations.push({ kind: "model-mutated-hook-off", folder, clip: call.clip, tech: call.tech });
    // with the scope ON, only the slice pair may rewrite the model
    if (b.before !== b.after && !SLICE_KEYS.has(key)) violations.push({ kind: "model-mutated-hook-on", folder, clip: call.clip, tech: call.tech });
    rows.push({ folder, clip: call.clip, tech: call.tech, techId: call.techId, target: call.target,
      same, expected, offKind: a.script?.buildKind ?? null, onKind: b.script?.buildKind ?? null, msOn: +b.ms.toFixed(2) });
  }
}

// ── pass 2: the battle ORDER on one model instance (does a solved cast leak into later builds?) ────
// The game resolves a script per action, on the SAME model object, all battle long. If the solver's
// appended table/channels change a later build (byMotion picks the widest moving table; tableIndices
// now lists the solver's), that later action plays the wrong body — and no per-case test can see it.
const norm = (s) => {
  if (s == null) return "null";
  const ops = (s.ops ?? []).map((o) => (o.op === 2 && (o.words?.[0] | 0) === 0 ? { op: 2, w: [0, 0, "T"] } : o));
  return JSON.stringify({ ops, kind: s.buildKind ?? null, cam: s.camAuthored ?? null, synth: !!s.synthesized });
};
const sizeOf = (m) => JSON.stringify({ b: m.bones, t: m.timeline }).length;
const order = [];
for (const ex of SLICE) {
  const base = await preparedModel(ex.folder);
  const live = clone(base);
  const liveBytes0 = sizeOf(base);
  const calls = [...(perFolder.get(ex.folder) ?? [])].map(callFor);
  const own = calls.find((c) => c.tech === ex.tech) ?? null;
  const other9 = calls.find((c) => c.clip === 9 && c.tech && c.tech !== ex.tech) ?? null;
  const basic = calls.find((c) => c.clip === 5) ?? null;
  const seq = [
    { label: "own cast", call: own },
    { label: "basic", call: basic },
    { label: "other clip 9", call: other9 },
    { label: "clip 13 (no tech)", call: { clip: 13, target: "enemy", hits: 3, element: 1, planted: false, tech: null } },
    { label: "clip 10 enemy", call: { clip: 10, target: "enemy", hits: 1, element: 1, planted: false, tech: null } },
    { label: "clip 10 self", call: { clip: 10, target: "self", hits: null, element: 1, planted: false, tech: null } },
    { label: "own cast again", call: own, repeat: true },
  ].filter((s) => s.call);
  const gotText = new Map();
  for (let i = 0; i < seq.length; i++) {
    const { label, call, repeat } = seq[i];
    solver.setSolverScope(SLICE);
    const before = sizeOf(live);
    const got = cb.resolveClipScript(live, call.clip, { element: call.element, target: call.target, hits: call.hits, planted: call.planted, tech: call.tech });
    const after = sizeOf(live);
    const ref = build(clone(base), call, false);          // pristine model, hook off
    const same = norm(got) === norm(ref.script);
    if (!repeat) gotText.set(label, norm(got));
    const expected = !same && (label === "own cast" || label === "own cast again");
    if (!same && !expected) {
      const kinds = (s) => (s?.ops ?? []).map((o) => o.op).join(",");
      const shape = kinds(got) === kinds(ref.script);
      violations.push({ kind: shape ? "order-drift" : "order-shape-changed", folder: ex.folder, clip: call.clip, tech: call.tech, label,
        off: scriptText(ref.script).slice(0, 400), on: scriptText(got).slice(0, 400) });
    }
    if (label === "own cast again") {
      const first = gotText.get("own cast") ?? null;
      order.push({ folder: ex.folder, label, clip: call.clip, tech: call.tech, sameAsFirstCast: first === norm(got) });
    }
    order.push({ folder: ex.folder, label, clip: call.clip, tech: call.tech, kind: got?.buildKind ?? null,
      refKind: ref.script?.buildKind ?? null, sameAsPristineOff: same,
      modelBytesBefore: before, modelBytesAfter: after, modelGrewBy: after - before, liveBytes0 });
  }
  order.push({ folder: ex.folder, liveModelBytesAfterAll: sizeOf(live), liveBytes0 });
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────────
const summary = {
  generated: new Date().toISOString(),
  models: folders.length, cases, builds,
  hookOffModelMutated: violations.filter((v) => v.kind === "model-mutated-hook-off").length,
  hookOnModelMutatedOutsideSlice: violations.filter((v) => v.kind === "model-mutated-hook-on").length,
  scriptsChanged: diffs.length, expectedSliceChanges: diffs.filter((d) => d.expected).length,
  unexpectedChanges: violations.filter((v) => v.kind === "script-changed").length,
  orderChanges: violations.filter((v) => v.kind === "order-drift" || v.kind === "order-shape-changed").length,
  orderDrift: violations.filter((v) => v.kind === "order-drift").length,
  orderShapeChanged: violations.filter((v) => v.kind === "order-shape-changed").length,
  otherViolations: violations.filter((v) => v.kind !== "script-changed").slice(0, 20),
  diffs, violationRows: violations.slice(0, 40), order,
  solverCostMs: { totalExtra: +tSolver.toFixed(0) },
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
console.log(`models ${summary.models} · cases ${summary.cases} · builds ${summary.builds}`);
console.log(`scripts changed: ${summary.scriptsChanged} (expected slice pairs ${summary.expectedSliceChanges}, unexpected ${summary.unexpectedChanges}); order changes ${summary.orderChanges}`);
console.log(`model mutated with hook OFF: ${summary.hookOffModelMutated}; outside the slice with hook ON: ${summary.hookOnModelMutatedOutsideSlice}`);
for (const d of diffs.filter((x) => x.expected)) console.log(`  slice change: ${d.folder} clip ${d.clip} "${d.tech}" ${d.offKind} -> ${d.onKind} ops ${d.offOps} -> ${d.onOps}`);
for (const v of violations.slice(0, 20)) console.log(`  VIOLATION ${v.kind}: ${v.folder} clip ${v.clip} "${v.tech}"${v.label ? " " + v.label : ""}`);
console.log("order pass:");
for (const o of order) {
  if (o.liveModelBytesAfterAll != null) console.log(`  ${o.folder}: model bytes ${o.liveBytes0} -> ${o.liveModelBytesAfterAll} after the whole sequence (+${o.liveModelBytesAfterAll - o.liveBytes0})`);
  else if (o.sameAsFirstCast != null) console.log(`  ${o.folder} ${o.label}: same motion as the first cast = ${o.sameAsFirstCast}`);
  else console.log(`  ${o.folder} ${o.label}: ${o.kind} sameAsPristineOff=${o.sameAsPristineOff} model +${o.modelGrewBy} bytes`);
}
console.log("wrote", OUT);
process.exitCode = summary.unexpectedChanges || summary.hookOffModelMutated || summary.hookOnModelMutatedOutsideSlice || summary.orderChanges ? 1 : 0;
