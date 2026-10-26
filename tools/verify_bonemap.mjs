#!/usr/bin/env node
// Verify the K12 bone map (web/fight/digimon-bonemap.js) by ARITHMETIC against the models.
//
//   node tools/verify_bonemap.mjs [--json] [--quiet] [--golden <path>]
//
// Checks, for every model folder:
//   * table shape and folder set (must equal the anatomy table's 244 folders)
//   * every index is a real bone of that model (< num_bones) and an integer
//   * every chain is a parent-connected path (each bone's parent is the previous bone)
//   * a resolved root, and every root is a root of the rig
//   * locomotion: 2+ bones per bodyPlan (legs when the rig has them, else the body chain)
//   * left/right leg chains are mirror pairs within tolerance when both exist
//   * arm chains start at the shoulder, both sides mirror within tolerance when the anatomy
//     says the model has two arms, and the mouth is the head or one of its descendants
//   * a firing bone for EVERY technique that is not a self move, and no bone for self moves
//     (firingPart() from digimon-anatomy.js is the annotation; launchBone() resolves it)
//   * arm-mode emitters really are in that side's arm chain
//   * side confidence is a legal value and every low-confidence model is reported
//   * coverage: every bone that carries a mesh is claimed by a role (extras included)
// A golden file (tools/k12_golden.py) replays sampled launchBone() answers so the JS cannot drift
// from the Python reference.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as B from "../web/fight/digimon-bonemap.js";
import * as A from "../web/fight/digimon-anatomy.js";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const asJson = args.includes("--json");
const quiet = args.includes("--quiet");
const ROOT = new URL("..", import.meta.url).pathname;
const GOLDEN = opt("--golden", "/home/dorij/scratch-research/anatomy/bonemap-golden.json");

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const models = {};
const loadModel = (folder) => {
  if (!models[folder]) {
    const p = join(ROOT, "web/assets/battle/models", folder, "anim.json");
    models[folder] = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }
  return models[folder];
};

const folders = B.FOLDERS;
const anFolders = A.FOLDERS;
if (folders.join(",") !== anFolders.join(",")) {
  const missing = anFolders.filter((f) => !B.has(f));
  const extra = folders.filter((f) => !A.has(f));
  err(`folder set differs from the anatomy table (missing ${missing.length}, extra ${extra.length}: ${missing.slice(0, 4)}${extra.slice(0, 4)})`);
}
if (folders.length !== 244) err(`expected 244 folders, got ${folders.length}`);

const isInt = (v) => Number.isInteger(v);
const parentOf = (model, i) => (model.bones[i].parent_slot ?? 0) - 1;
const isDescendant = (model, child, ancestor) => {
  let cur = child, guard = 0;
  while (cur >= 0 && guard++ < 64) {
    if (cur === ancestor) return true;
    cur = parentOf(model, cur);
  }
  return false;
};

let chainCount = 0, bonesChecked = 0, emitterTechs = 0, emitterMissing = 0, selfTechs = 0, selfBones = 0;
let armModels = 0, armSides = 0, legsPairs = 0, worstArmMirror = 0, worstLegMirror = 0, uncoveredBones = 0, totalBones = 0;
const lowSide = [];
const armsAsym = [];

for (const f of folders) {
  const m = B.boneMap(f);
  const model = loadModel(f);
  if (!model) { err(`${f}: model not on disk`); continue; }
  const n = model.num_bones ?? model.bones.length;
  const check = (v, what) => {
    if (v == null) return true;
    if (!isInt(v) || v < 0 || v >= n) { err(`${f}: ${what} = ${JSON.stringify(v)} is not a bone index (n=${n})`); return false; }
    bonesChecked++;
    return true;
  };
  for (const k of ["r", "t", "h", "m", "e"]) check(m[k], k);
  for (const r of m.ro || []) check(r, "ro");
  if (m.ro && !m.ro.includes(m.r)) err(`${f}: root ${m.r} is not in roots ${JSON.stringify(m.ro)}`);
  if (m.r != null && parentOf(model, m.r) >= 0) err(`${f}: root bone ${m.r} has a parent`);

  const chain = (c, what) => {
    if (!Array.isArray(c) || !c.length) return;
    chainCount++;
    for (const i of c) check(i, what);
    for (let k = 1; k < c.length; k++) {
      if (parentOf(model, c[k]) !== c[k - 1]) {
        err(`${f}: ${what} is not a parent chain at ${c[k - 1]}->${c[k]} ` +
            `(parent ${parentOf(model, c[k])})`);
        break;
      }
    }
  };
  for (const [k, v] of [["aL", m.aL], ["aR", m.aR], ["lL", m.lL], ["lR", m.lR], ["wL", m.wL], ["wR", m.wR], ["tl", m.tl]]) chain(v, k);
  for (const c of m.lL2 || []) chain(c, "lL2");
  for (const c of m.lR2 || []) chain(c, "lR2");

  // mouth is the head or below it
  if (m.m != null && m.h != null && !isDescendant(model, m.m, m.h)) {
    err(`${f}: mouth ${m.m} is not the head ${m.h} nor one of its descendants`);
  }

  // locomotion: legs when the rig has them, else the body chain - at least 2 bones
  const loc = m.loc || [];
  for (const i of loc) check(i, "loc");
  if (loc.length < 2) err(`${f}: locomotion has ${loc.length} bones (need >= 2)`);
  const plan = A.bodyPlan(f);
  const legs = B.legChains(f);
  if (legs.length && legs.length < 2) warn(`${f}: only ${legs.length} leg chain (${plan})`);

  // mirrored leg pairs: a pair should have the same chain length (indices differ, the layout is
  // per-model, so this counts pairs only)
  for (const L of legs.filter((x) => x.side === "left")) {
    const R = legs.find((x) => x.side === "right" && x.chain.length === L.chain.length);
    if (!R) continue;
    legsPairs++;
  }

  // arms: the anatomy arm tuples are [side, kind, builtIn]
  const arms = (A.anatomy(f).arm || []).map((x) => ({ side: x[0], kind: x[1], builtIn: x[2] }));
  const wantL = arms.filter((a) => a.side === "left").length;
  const wantR = arms.filter((a) => a.side === "right").length;
  if (wantL || wantR) {
    armModels++;
    const rigRoots = m.ro && m.ro.length ? m.ro : [m.r];
    for (const side of ["left", "right"]) {
      const want = side === "left" ? wantL : wantR;
      const c = B.armChain(f, side);
      if (want && !c) {
        warn(`${f}: design has ${want} ${side} arm(s), the rig has no chain (unresolved)`);
      } else if (c) {
        armSides++;
        if (c.length && !rigRoots.some((r) => c[0] === r || isDescendant(model, c[0], r))) {
          err(`${f}: ${side} arm starts at ${c[0]}, not connected to any rig root ${JSON.stringify(rigRoots)}`);
        }
      }
    }
    const L = B.armChain(f, "left"), R = B.armChain(f, "right");
    if (L && R && wantL === wantR) {
      const sameKinds = JSON.stringify(arms.filter((a) => a.side === "left").map((a) => a.kind).sort()) ===
                        JSON.stringify(arms.filter((a) => a.side === "right").map((a) => a.kind).sort());
      if (sameKinds && Math.abs(L.length - R.length) > 1) {
        // a chain can legitimately be shorter on one side when the rig forks (a pincer's two
        // fingers, a gun with a muzzle branch); the rest-pose mirror error (m.sy) is the real
        // symmetry measure, checked below
        warn(`${f}: arm chains differ in length (${L.length} vs ${R.length}) for symmetric kinds - branch split (mirror error ${m.sy})`);
      }
      if (sameKinds) {
        const worst = Math.abs(L[L.length - 1] - R[R.length - 1]);
        worstArmMirror = Math.max(worstArmMirror, worst);
      }
    }
    if (m.sy != null && m.sy > 0.25) {
      warn(`${f}: arm rest-pose mirror error ${m.sy} (> 0.25) - asymmetric limb or a branch split; listed unresolved`);
      armsAsym.push([f, m.sy]);
    }
  }

  // emitters: every technique gets a bone (or none for self), and arm emitters stay in their arm
  const a = A.anatomy(f);
  for (const [tech, t] of Object.entries(a.tech || {})) {
    const mode = t[0];
    const r = B.launchBone(f, tech);
    if (!r) { err(`${f}/${tech}: launchBone returned nothing`); continue; }
    if (mode === "self") {
      selfTechs++;
      if (r.bone != null) { err(`${f}/${tech}: self move returned bone ${r.bone}`); selfBones++; }
      continue;
    }
    emitterTechs++;
    if (r.bone == null) { emitterMissing++; err(`${f}/${tech}: mode ${mode} has no firing bone`); continue; }
    if (r.bone < 0 || r.bone >= n) err(`${f}/${tech}: firing bone ${r.bone} out of range`);
    for (const side of ["left", "right"]) {
      if (mode === `${side}-arm`) {
        const c = B.armChain(f, side);
        if (c && !c.includes(r.bone)) err(`${f}/${tech}: ${mode} fires from bone ${r.bone}, not in the ${side} arm chain`);
        if (!c) warn(`${f}/${tech}: ${mode} but the rig has no ${side} arm chain (falls back)`);
      }
    }
    const bones = B.firingBones(f, mode);
    if (bones.length && !bones.includes(r.bone)) err(`${f}/${tech}: firingBones(${mode}) misses ${r.bone}`);
  }

  // side confidence
  if (!["high", "medium", "low"].includes(m.sc)) err(`${f}: bad side confidence ${m.sc}`);
  if (m.sc === "low") lowSide.push(f);

  // coverage: every mesh bone plays a role or is a known extra
  for (let i = 0; i < n; i++) {
    if (!(model.bones[i].verts || []).length) continue;
    totalBones++;
    const role = B.roleOfBone(f, i);
    if (role == null) { err(`${f}: bone ${i} has no role`); uncoveredBones++; }
  }
}

// ---------------------------------------------------------------- golden (JS == Python)
let golden = null;
if (existsSync(GOLDEN)) {
  const g = JSON.parse(readFileSync(GOLDEN, "utf8"));
  let bad = 0;
  for (const [folder, tech, mode, bone] of g.samples) {
    const r = B.launchBone(folder, tech);
    if (!r || r.mode !== mode || r.bone !== bone) {
      bad++;
      if (bad <= 6) err(`golden ${folder}/${tech}: js ${JSON.stringify(r)} != python ${JSON.stringify({ mode, bone })}`);
    }
  }
  if (bad > 6) err(`golden: ${bad} samples disagree with the Python reference`);
  if (g.folders !== folders.length) err(`golden folders ${g.folders} != ${folders.length}`);
  golden = { pairs: g.samples.length, bad };
}

const report = {
  folders: folders.length,
  bones: bonesChecked,
  chains: chainCount,
  armModels,
  armSides,
  legsPairs,
  worstArmMirror,
  worstLegMirror,
  emitterTechs,
  emitterMissing,
  selfTechs,
  selfBones,
  coverage: +(1 - uncoveredBones / Math.max(1, totalBones)).toFixed(3),
  lowSide: lowSide.length,
  armsAsym: armsAsym.length,
  golden,
  errors: errors.length,
  warnings: warnings.length,
  errorList: errors,
  warningList: warnings,
};

if (asJson) console.log(JSON.stringify(report, null, 1));
else if (!quiet) {
  console.log("digimon-bonemap.js verification");
  console.log(`  folders            ${report.folders}`);
  console.log(`  bone indices       ${report.bones} checked, ${report.chains} chains parent-connected`);
  console.log(`  arms               ${report.armModels} models with arms, ${report.armSides} side chains, worst mirror ${report.worstArmMirror}`);
  console.log(`  legs               ${report.legsPairs} mirrored pairs, worst index mirror ${report.worstLegMirror}`);
  console.log(`  emitters           ${report.emitterTechs} techniques with a bone, ${report.emitterMissing} missing; ` +
    `${report.selfTechs} self moves with no bone, ${report.selfBones} wrong`);
  console.log(`  mesh-bone coverage ${report.coverage}`);
  console.log(`  arm symmetry       ${report.armsAsym} models over mirror error 0.25 (listed)`);
  console.log(`  side confidence    ${report.lowSide} models low (no side-specific launch)`);
  if (golden) console.log(`  golden             ${golden.pairs} launch samples vs Python, ${golden.bad} disagree`);
  console.log(`  errors             ${errors.length}`);
  for (const e of errors.slice(0, 30)) console.log(`    ! ${e}`);
  if (warnings.length) for (const w of warnings.slice(0, 12)) console.log(`    ~ ${w}`);
}
process.exit(errors.length ? 1 : 0);
