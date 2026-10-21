#!/usr/bin/env node
// Verify the authored anatomy table (web/fight/digimon-anatomy.js) that K11 produced.
//
//   node tools/verify_digimon_anatomy.mjs [--golden <path>] [--json] [--quiet]
//
// Checks the table's shape, every record's enums, the firingPart() resolution chain, the
// similarity() properties (self = 1, symmetry, bounds) and - when a golden file is available -
// that the JS similarity agrees EXACTLY with the Python reference that generated the table
// (python3 /home/dorij/scratch-research/anatomy/tools/k11_js.py writes it).
//
// Exit code 0 = clean, 1 = violations.
import { readFileSync, existsSync } from "node:fs";
import * as A from "../web/fight/digimon-anatomy.js";

const args = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const asJson = args.includes("--json");
const quiet = args.includes("--quiet");
const GOLDEN_DEFAULT = "/home/dorij/scratch-research/anatomy/js-golden.json";
const goldenPath = opt("--golden", existsSync(GOLDEN_DEFAULT) ? GOLDEN_DEFAULT : null);

const SIDES = new Set(["left", "right", "center"]);
const KINDS = new Set(["hand", "claw", "blade", "gun", "cannon", "hammer", "axe", "sword", "lance",
  "shield", "tentacle", "wing", "fist", "pincer", "none"]);
const SIZES = new Set(["tiny", "small", "medium", "large", "giant"]);
const MODES = new Set(A.MODES);
const BODY_PLANS = new Set(Object.keys(A.BODY_FAMILY));

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ---------------------------------------------------------------- table shape
const folders = Object.keys(A.ANATOMY);
if (!folders.length) err("ANATOMY is empty");
if (A.FOLDERS.length !== folders.length) err(`FOLDERS has ${A.FOLDERS.length} entries, ANATOMY ${folders.length}`);
if (folders.length !== 244) err(`expected 244 model folders, got ${folders.length}`);
if (A.FOLDERS.join(",") !== [...folders].sort().join(",")) err("FOLDERS is not the sorted key list");

// ---------------------------------------------------------------- per-record schema
const modeHist = new Map();
let annotations = 0;
const aliased = [];
for (const f of folders) {
  const a = A.ANATOMY[f];
  if (typeof a.n !== "string" || !a.n) err(`${f}: bad name`);
  if (!BODY_PLANS.has(a.plan)) err(`${f}: bad bodyPlan ${a.plan}`);
  if (A.BODY_FAMILY[a.plan] !== a.fam) err(`${f}: body family mismatch ${a.fam} vs ${A.BODY_FAMILY[a.plan]}`);
  if (!SIZES.has(a.size)) err(`${f}: bad sizeClass ${a.size}`);
  if (!Number.isInteger(a.legs) || a.legs < 0) err(`${f}: bad legs ${a.legs}`);
  if (!Number.isInteger(a.wings) || a.wings < 0) err(`${f}: bad wings ${a.wings}`);
  if (![null, "left", "right", "both"].includes(a.side)) err(`${f}: bad dominantSide ${a.side}`);
  if (typeof a.conf !== "number" || a.conf < 0 || a.conf > 1) err(`${f}: bad confidence ${a.conf}`);
  if (!Array.isArray(a.arm)) err(`${f}: arms not an array`);
  for (const arm of a.arm) {
    if (!Array.isArray(arm) || arm.length !== 3) { err(`${f}: bad arm tuple ${JSON.stringify(arm)}`); continue; }
    if (!SIDES.has(arm[0])) err(`${f}: bad arm side ${arm[0]}`);
    if (!KINDS.has(arm[1])) err(`${f}: bad arm kind ${arm[1]}`);
    if (typeof arm[2] !== "boolean") err(`${f}: arm builtIn not boolean`);
  }
  if (!Array.isArray(a.armament)) err(`${f}: armament not an array`);
  for (const m of a.armament || []) {
    if (!Array.isArray(m) || m.length !== 3) { err(`${f}: bad armament tuple`); continue; }
    if (!["left-arm", "right-arm", "both-arms", "mouth", "head", "chest", "back", "tail", "eyes", "whole-body"].includes(m[0]))
      err(`${f}: bad armament where ${m[0]}`);
    if (!["projectile", "melee", "beam", "area", "self"].includes(m[1])) err(`${f}: bad armament kind ${m[1]}`);
  }
  if (a.alias.length) aliased.push([f, a.n, a.alias]);
  for (const [tech, t] of Object.entries(a.tech)) {
    annotations++;
    if (!Array.isArray(t) || t.length !== 3) { err(`${f}/${tech}: bad annotation tuple`); continue; }
    if (!MODES.has(t[0])) err(`${f}/${tech}: bad emitter mode ${t[0]}`);
    if (typeof t[2] !== "string" || !t[2]) err(`${f}/${tech}: empty bodyPart annotation`);
    modeHist.set(t[0], (modeHist.get(t[0]) || 0) + 1);
  }
}

// ---------------------------------------------------------------- helpers
for (const f of folders) {
  const a = A.ANATOMY[f];
  for (const [tech, t] of Object.entries(a.tech)) {
    const p = A.firingPart(f, tech);
    if (p.source !== "annotation") err(`${f}/${tech}: firingPart resolved by ${p.source}, annotation ignored`);
    if (p.mode !== t[0]) err(`${f}/${tech}: firingPart mode ${p.mode} != annotation ${t[0]}`);
    const side = A.firingSide(f, tech);
    if (t[0] === "left-arm" && side !== "left") err(`${f}/${tech}: left-arm annotation but firingSide ${side}`);
    if (t[0] === "right-arm" && side !== "right") err(`${f}/${tech}: right-arm annotation but firingSide ${side}`);
    if (t[0] === "self" && side !== null) err(`${f}/${tech}: self move must not name a side (got ${side})`);
    if (["mouth", "head", "eyes", "chest", "back", "tail", "wings", "whole-body"].includes(t[0]) && side !== null)
      err(`${f}/${tech}: ${t[0]} move must not name an arm side (got ${side})`);
  }
  // unknown / unannotated technique names must still resolve to a legal mode, never undefined
  for (const probe of ["zzz-not-a-technique", "", null]) {
    const p = A.firingPart(f, probe);
    if (!p || !MODES.has(p.mode)) err(`${f}: firingPart(${JSON.stringify(probe)}) -> ${JSON.stringify(p)}`);
  }
  const arma = A.armament(f);
  if (arma.length !== a.armament.length) err(`${f}: armament() length mismatch`);
  const built = A.builtInWeapons(f);
  const expectBuilt = a.arm.filter((x) => x[2] && x[1] !== "hand").length;
  if (built.length !== expectBuilt) err(`${f}: builtInWeapons() length mismatch`);
  if (A.bodyPlan(f) !== a.plan) err(`${f}: bodyPlan() mismatch`);
  if (A.bodyFamily(f) !== a.fam) err(`${f}: bodyFamily() mismatch`);
  if (A.dominantSide(f) !== a.side) err(`${f}: dominantSide() mismatch`);
  if (!A.has(f)) err(`${f}: has() false`);
  if (A.anatomy("nope") !== null) err("anatomy(unknown) should be null");
}

// ---------------------------------------------------------------- K14 emitters
// One shot per head/barrel: every model has emitters, every technique a shots rule, every
// launching rule resolves to at least one real emitter, and per-emitter shots never exceed
// the model's own launch points.
const EM_PARTS = new Set(A.EMITTER_PARTS);
const EM_KINDS = new Set(A.EMITTER_KINDS);
const SHOT_MODE_SET = new Set(A.SHOT_MODES);
let emitterRows = 0;
let shotRules = 0;
let perEmitterRules = 0;
let singleRules = 0;
let contactRules = 0;
let noneRules = 0;
let launchPointTotal = 0;
const launchPointsOf = {};
for (const f of folders) {
  const rows = A.EMITTERS[f];
  if (!Array.isArray(rows)) { err(`${f}: no EMITTERS row`); continue; }
  const ids = new Set();
  const kindOf = new Map();
  let launch = 0;
  let primaries = 0;
  for (const r of rows) {
    emitterRows++;
    if (!Array.isArray(r) || r.length !== 6) { err(`${f}: bad emitter tuple ${JSON.stringify(r)}`); continue; }
    const [id, part, count, kind, primary, mouth] = r;
    if (typeof id !== "string" || !id) err(`${f}: bad emitter id`);
    if (ids.has(id)) err(`${f}: duplicate emitter id ${id}`);
    ids.add(id);
    if (!EM_PARTS.has(part)) err(`${f}/${id}: bad emitter part ${part}`);
    if (!Number.isInteger(count) || count < 1) err(`${f}/${id}: bad emitter count ${count}`);
    if (!EM_KINDS.has(kind)) err(`${f}/${id}: bad emitter kind ${kind}`);
    if (primary !== 0 && primary !== 1) err(`${f}/${id}: bad primary flag ${primary}`);
    if (mouth !== 0 && mouth !== 1) err(`${f}/${id}: bad mouth flag ${mouth}`);
    if (primary) primaries++;
    if (kind !== "melee") launch += count;
    kindOf.set(id, kind);
  }
  launchPointsOf[f] = launch;
  launchPointTotal += launch;
  if (launch > 0 && primaries !== 1) err(`${f}: ${primaries} primary emitters, expected exactly 1`);
  if (launch === 0 && primaries !== 0) err(`${f}: primary emitter but no launch site`);
  const listed = A.emitters(f);
  if (listed.length !== rows.length) err(`${f}: emitters() length ${listed.length} != ${rows.length}`);
  for (const e of listed) {
    if (!ids.has(e.id)) err(`${f}: emitters() returned unknown id ${e.id}`);
    if (typeof e.primary !== "boolean" || typeof e.mouth !== "boolean")
      err(`${f}: emitters() flags are not booleans`);
  }
  if (launch > 0 && A.primaryEmitter(f) === null) err(`${f}: primaryEmitter() null despite launch sites`);
  if (A.launchPoints(f) !== launch) err(`${f}: launchPoints() ${A.launchPoints(f)} != ${launch}`);
  const shots = A.SHOTS[f];
  if (!shots || typeof shots !== "object") { err(`${f}: no SHOTS table`); continue; }
  for (const [tech, rule] of Object.entries(shots)) {
    shotRules++;
    if (!Array.isArray(rule) || rule.length !== 3) { err(`${f}/${tech}: bad shots rule`); continue; }
    const [mode, out, n] = rule;
    if (!SHOT_MODE_SET.has(mode)) err(`${f}/${tech}: bad shots mode ${mode}`);
    if (!Array.isArray(out)) { err(`${f}/${tech}: shots emitters not an array`); continue; }
    for (const i of out) if (!ids.has(i)) err(`${f}/${tech}: unknown emitter id ${i}`);
    if (!Number.isInteger(n) || n < 0) err(`${f}/${tech}: bad shot count ${n}`);
    if (mode === "none" && (out.length || n !== 0)) err(`${f}/${tech}: none rule carries shots`);
    if (mode === "single" && (out.length !== 1 || n !== 1))
      err(`${f}/${tech}: single rule must list 1 emitter and 1 shot`);
    if (mode === "per-emitter" && (out.length < 1 || n < out.length))
      err(`${f}/${tech}: per-emitter rule inconsistent (${out.length} emitters, ${n} shots)`);
    if (mode === "per-emitter" && n > launch)
      err(`${f}/${tech}: ${n} per-emitter shots > ${launch} launch points`);
    if (mode === "per-limb-contact" && (out.length < 1 || n < 1))
      err(`${f}/${tech}: per-limb-contact rule empty`);
    const ann = A.ANATOMY[f].tech[tech];
    const style = ann ? ann[1] : null;
    const launching = style === "fires-projectile" || style === "beam" || style === "breath";
    if (launching && mode !== "single" && mode !== "per-emitter")
      err(`${f}/${tech}: launching move has shots mode ${mode}`);
    if (launching && out.length < 1) err(`${f}/${tech}: launching move with no emitter`);
    if (launching) {
      for (const i of out) {
        if (kindOf.get(i) === "melee") err(`${f}/${tech}: projectile launches from melee limb ${i}`);
      }
    }
    if (mode === "per-emitter") perEmitterRules++;
    else if (mode === "single") singleRules++;
    else if (mode === "per-limb-contact") contactRules++;
    else if (mode === "none") noneRules++;
    const fn = A.shotsFor(f, tech);
    if (fn.mode !== mode || fn.shots !== n || fn.emitters.join(",") !== out.join(","))
      err(`${f}/${tech}: shotsFor() ${JSON.stringify(fn)} != stored ${JSON.stringify(rule)}`);
  }
}
// every annotated technique has a rule, and every model resolves an unknown technique legally
for (const f of folders) {
  const shots = A.SHOTS[f] || {};
  for (const tech of Object.keys(A.ANATOMY[f].tech)) {
    if (!(tech in shots)) err(`${f}/${tech}: annotation without a shots rule`);
  }
  for (const probe of ["zzz-not-a-technique", "", null]) {
    const s = A.shotsFor(f, probe);
    if (!s || !SHOT_MODE_SET.has(s.mode)) err(`${f}: shotsFor(${JSON.stringify(probe)}) -> ${JSON.stringify(s)}`);
    if (s.mode === "single" && (s.emitters.length !== 1 || s.shots !== 1))
      err(`${f}: fallback single rule malformed for ${JSON.stringify(probe)}`);
    if (s.mode === "none" && s.shots !== 0) err(`${f}: fallback none rule carries shots`);
  }
}
if (A.emitters("nope").length !== 0) err("emitters(unknown folder) should be []");
if (A.shotsFor("nope", "Fight").mode !== "none") err("shotsFor(unknown folder) should be none");

// ---------------------------------------------------------------- K17 arm equipment
// Every arm of every model has a measured verdict (what the chain ends in), with the numbers behind
// it; the table must reproduce the Python derivation exactly (golden.armEquip) and keep the brief's
// controls: SkullSatamon's staff arm elongated, Minotarumon's gun arm bulky, Gallantmon's lance
// elongated and its shield flat, Knightmon's sword arm elongated and its left hand bare.
const ARM_CLASSES = new Set(A.ARM_EQUIP_CLASSES);
const ARM_ATTACH = new Set(["a", "t", "b", "h", "l", "y"]);
const equipClass = new Map();
let equipRows = 0;
let equipHigh = 0;
let equipPropBone = 0;
for (const f of folders) {
  const rows = A.ARM_EQUIP[f];
  if (!rows || typeof rows !== "object") { err(`${f}: no ARM_EQUIP row`); continue; }
  const sides = new Set((A.ANATOMY[f].arm || []).map((x) => x[0]));
  for (const side of Object.keys(rows)) {
    equipRows++;
    if (side !== "left" && side !== "right") err(`${f}: ARM_EQUIP side ${side}`);
    const row = rows[side];
    if (!Array.isArray(row) || row.length !== 6) { err(`${f}/${side}: bad ARM_EQUIP tuple`); continue; }
    const [cls, conf, src, bone, attach, feats] = row;
    if (!ARM_CLASSES.has(cls)) err(`${f}/${side}: bad arm class ${cls}`);
    if (conf !== 0 && conf !== 1) err(`${f}/${side}: bad arm confidence ${conf}`);
    if (src !== "m" && src !== "p") err(`${f}/${side}: bad arm source ${src}`);
    if (!Number.isInteger(bone)) err(`${f}/${side}: bad arm bone ${bone}`);
    if (!ARM_ATTACH.has(attach)) err(`${f}/${side}: bad arm attachment ${attach}`);
    if (!Array.isArray(feats) || feats.length !== 6 || feats.some((x) => typeof x !== "number"))
      err(`${f}/${side}: bad arm feature vector`);
    if (conf) equipHigh++;
    if (src === "p") equipPropBone++;
    equipClass.set(cls, (equipClass.get(cls) || 0) + 1);
    const eq = A.armEquip(f, side);
    if (eq.class !== cls || eq.bone !== bone || eq.source !== (src === "m" ? "hand-mesh" : "prop-bone"))
      err(`${f}/${side}: armEquip() ${JSON.stringify(eq)} != stored ${JSON.stringify(row)}`);
    if (eq.confidence !== (conf ? "high" : "low")) err(`${f}/${side}: armEquip confidence`);
    if (!Array.isArray(A.ANATOMY[f].arm) || A.ANATOMY[f].arm.length === 0) {
      if (eq.class !== cls) err(`${f}/${side}: armEquip on a model without arms`);
    }
  }
  // a rig can lack a chain on one side (bone-map unresolved); only rows that exist are checked
}
if (A.armEquip("nope", "left").class !== "none") err("armEquip(unknown) should be none");
if (A.armArmed("nope", "left")) err("armArmed(unknown) should be false");

const K17_CONTROLS = [
  ["m244skst", "right", "elongated", "SkullSatamon staff arm"],
  ["m244skst", "left", "bare", "SkullSatamon claw hand"],
  ["m399mta2", "left", "bulky", "Minotarumon gun housing"],
  ["m369duke", "right", "elongated", "Gallantmon lance"],
  ["m369duke", "left", "flat", "Gallantmon shield"],
  ["m178kngt", "right", "elongated", "Knightmon greatsword"],
  ["m178kngt", "left", "bare", "Knightmon empty left hand"],
];
for (const [f, side, cls, why] of K17_CONTROLS) {
  const got = A.armEquip(f, side).class;
  if (got !== cls) err(`${f}/${side}: K17 control ${why} -> ${got}, expected ${cls}`);
}

// ---------------------------------------------------------------- similarity properties
let worstSelf = 1;
let asym = 0;
let outOfBounds = 0;
for (const f of folders) {
  const s = A.similarity(f, f);
  worstSelf = Math.min(worstSelf, s);
  if (Math.abs(s - 1) > 1e-9) err(`${f}: similarity(self) = ${s}, expected 1`);
}
const sample = A.FOLDERS.filter((_, i) => i % 7 === 0);
for (const a of sample) {
  for (const b of sample) {
    const s1 = A.similarity(a, b);
    const s2 = A.similarity(b, a);
    if (s1 !== s2) asym++;
    if (!(s1 >= 0 && s1 <= 1)) outOfBounds++;
  }
}
if (asym) err(`similarity is not symmetric on ${asym} pairs`);
if (outOfBounds) err(`similarity out of [0,1] on ${outOfBounds} pairs`);

// rankDonors: excludes the target, sorted descending, limited
const ranked = A.rankDonors("m399mta2", null, 10);
if (ranked.some((r) => r.folder === "m399mta2")) err("rankDonors included the target");
for (let i = 1; i < ranked.length; i++) if (ranked[i - 1].score < ranked[i].score) err("rankDonors not sorted");

// ---------------------------------------------------------------- golden cross-check
let golden = null;
if (goldenPath && existsSync(goldenPath)) {
  const g = JSON.parse(readFileSync(goldenPath, "utf8"));
  let bad = 0;
  let maxDelta = 0;
  for (const [a, b, score] of g.pairs) {
    const js = A.similarity(a, b);
    const d = Math.abs(js - score);
    maxDelta = Math.max(maxDelta, d);
    if (d > 1e-9) {
      bad++;
      if (bad <= 5) err(`golden ${a}/${b}: js ${js} != python ${score}`);
    }
  }
  if (bad > 5) err(`golden: ${bad} pairs disagree with the Python reference`);
  if (g.folders !== folders.length) err(`golden folders ${g.folders} != ${folders.length}`);
  if (g.annotationKeys !== annotations) err(`golden annotationKeys ${g.annotationKeys} != ${annotations}`);
  // K14: the emitter rows and shots rules must be exactly the Python derivation's
  let emBad = 0;
  let ruleBad = 0;
  if (!g.emitters) err("golden has no emitters section (re-run tools/k11_js.py)");
  else {
    for (const f of folders) {
      if (JSON.stringify(A.EMITTERS[f] || []) !== JSON.stringify(g.emitters[f] || [])) {
        emBad++;
        if (emBad <= 5) err(`golden emitters ${f}: JS rows differ from the Python derivation`);
      }
      if (JSON.stringify(A.SHOTS[f] || {}) !== JSON.stringify(g.shots[f] || {})) {
        ruleBad++;
        if (ruleBad <= 5) err(`golden shots ${f}: JS rules differ from the Python derivation`);
      }
    }
    if (emBad > 5) err(`golden: ${emBad} folders' emitter rows disagree`);
    if (ruleBad > 5) err(`golden: ${ruleBad} folders' shots rules disagree`);
  }
  // K17: the measured arm-equipment rows must be exactly the Python derivation's
  let armBad = 0;
  if (!g.armEquip) err("golden has no armEquip section (re-run tools/k11_js.py)");
  else {
    for (const f of folders) {
      if (JSON.stringify(A.ARM_EQUIP[f] || {}) !== JSON.stringify(g.armEquip[f] || {})) {
        armBad++;
        if (armBad <= 5) err(`golden armEquip ${f}: JS rows differ from the Python derivation`);
      }
    }
    if (armBad > 5) err(`golden: ${armBad} folders' arm-equipment rows disagree`);
  }
  golden = { path: goldenPath, pairs: g.pairs.length, bad, maxDelta, emitters: emBad, shots: ruleBad,
    armEquip: armBad };
}

// ---------------------------------------------------------------- K14 named cases
// Deltamon: three mouths, so a fire move is three fireballs - one per head.
const delt = "m138delt";
const deltEm = A.emitters(delt);
const deltMouths = deltEm.filter((e) => e.mouth && e.kind !== "melee");
if (deltMouths.length !== 3) err(`${delt}: expected 3 mouth emitters, got ${deltMouths.length}`);
for (const tech of ["Triple Fire", "Flame Ball", "Flame Breath"]) {
  const s = A.shotsFor(delt, tech);
  if (s.mode !== "per-emitter") err(`${delt}/${tech}: must be per-emitter, got ${s.mode}`);
  if (s.shots !== 3) err(`${delt}/${tech}: must fire 3 projectiles, got ${s.shots}`);
  if (new Set(s.emitters).size !== 3) err(`${delt}/${tech}: needs 3 distinct emitters`);
  for (const id of s.emitters) {
    const e = deltEm.find((x) => x.id === id);
    if (!e || e.kind === "melee") err(`${delt}/${tech}: emitter ${id} is not a launch site`);
  }
}

// Minotarumon: the gun arm is the LEFT one, so that is the launch emitter; the DW3 throw is
// the RIGHT limb (per-limb-contact), never the gun.
const minoGunEm = A.emitters("m399mta2").find((e) => e.part === "left-arm");
if (!minoGunEm || minoGunEm.kind === "melee")
  err("m399mta2: the left Demon Arm must be a launch emitter");
if (A.shotsFor("m399mta2", "Fight").emitters.join(",") !== "right-arm")
  err("m399mta2: Fight must be a contact move from the right arm");

// ---------------------------------------------------------------- the named case from the brief
const mino = "m399mta2";
const minoArms = A.ANATOMY[mino] ? A.ANATOMY[mino].arm.map((x) => `${x[0]}:${x[1]}`) : [];
const minoFight = A.firingPart(mino, "Fight");
const minoGunArm = A.ANATOMY[mino] ? A.ANATOMY[mino].arm.find((x) => x[1] === "gun" || x[1] === "cannon") : null;
if (!A.ANATOMY[mino]) err(`${mino}: Minotarumon missing`);
else {
  if (A.dominantSide(mino) !== "left") err(`${mino}: Minotarumon's gun arm must be recorded as LEFT, got ${A.dominantSide(mino)}`);
  if (!minoGunArm || minoGunArm[0] !== "left") err(`${mino}: no left gun/cannon arm`);
  if (minoFight.side !== "right") err(`${mino}: the DW3 throw must come from the RIGHT limb, got ${minoFight.side}`);
}

const multiEmitterModels = folders.filter((f) => (launchPointsOf[f] || 0) > 1).length;
const report = {
  folders: folders.length,
  annotations,
  modeHist: Object.fromEntries([...modeHist.entries()].sort((x, y) => y[1] - x[1])),
  aliasedFolders: aliased,
  errors: errors.length,
  warnings: warnings.length,
  errorList: errors.slice(0, 40),
  warningList: warnings.slice(0, 20),
  golden,
  minotarumon: { arms: minoArms, dominantSide: A.dominantSide(mino), fight: minoFight },
  k17: {
    rows: equipRows,
    highConfidence: equipHigh,
    propBoneRows: equipPropBone,
    classes: Object.fromEntries([...equipClass.entries()].sort((x, y) => y[1] - x[1])),
  },
  k14: {
    emitterRows,
    shotRules,
    launchPoints: launchPointTotal,
    multiEmitterModels,
    modes: {
      single: singleRules,
      "per-emitter": perEmitterRules,
      "per-limb-contact": contactRules,
      none: noneRules,
    },
    deltamon: {
      emitters: deltEm.map((e) => `${e.id}:${e.kind}${e.mouth ? "/mouth" : ""}`),
      tripleFire: A.shotsFor(delt, "Triple Fire"),
    },
  },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 1));
} else if (!quiet) {
  console.log("digimon-anatomy.js verification");
  console.log(`  folders            ${report.folders}`);
  console.log(`  technique annotations ${report.annotations}`);
  console.log(`  emitter modes      ${Object.entries(report.modeHist).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  console.log(`  K14 emitters       ${emitterRows} rows, ${launchPointTotal} launch points, ` +
    `${multiEmitterModels} models with more than one`);
  console.log(`  K14 shots rules    ${shotRules} (single ${singleRules}, per-emitter ${perEmitterRules}, ` +
    `contact ${contactRules}, none ${noneRules})`);
  if (aliased.length) {
    const shown = aliased.slice(0, 6).map((x) => `${x[0]} = ${x[1]} + ${x[2].join(", ")}`);
    console.log(`  alias notes        ${aliased.length} folders carry a second name` +
      (aliased.length ? ` (e.g. ${shown.join("; ")}${aliased.length > 6 ? "; ..." : ""})` : ""));
  }
  if (golden) console.log(`  golden             ${golden.pairs} pairs vs Python, ${golden.bad} disagree, ` +
    `max delta ${golden.maxDelta}; emitters ${golden.emitters} bad, shots ${golden.shots} bad, ` +
    `armEquip ${golden.armEquip} bad`);
  console.log(`  K17 arm equipment  ${equipRows} arms (${equipHigh} high confidence, ${equipPropBone} on a ` +
    `prop bone): ${Object.entries(report.k17.classes).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  console.log(`  Deltamon           ${report.k14.deltamon.emitters.join(" ")} -> Triple Fire ` +
    `${report.k14.deltamon.tripleFire.mode} x${report.k14.deltamon.tripleFire.shots}`);
  console.log(`  Minotarumon        arms ${minoArms.join(" ")} dominant ${A.dominantSide(mino)} ` +
    `Fight -> ${minoFight.mode} (${minoFight.bodyPart})`);
  console.log(`  errors             ${errors.length}`);
  for (const e of errors.slice(0, 40)) console.log(`    ! ${e}`);
  if (warnings.length) for (const w of warnings.slice(0, 20)) console.log(`    ~ ${w}`);
}
process.exit(errors.length ? 1 : 0);
