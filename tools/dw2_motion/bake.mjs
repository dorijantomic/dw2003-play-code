#!/usr/bin/env node
// Bake the converted DW2 motions onto the DW3 bodies and write the generated motion assets (K22c).
//
//   node tools/dw2_motion/bake.mjs --jobs ~/.cache/dw2-motion/jobs --out web/assets/battle/dw2motion
//
// Reads one JOB per species (written by tools/build_dw2_motion.py): the DW3 target model, the
// converted DW2 donor, the donor's bone map, the arm-mirror decision and the motion letters.
// For every letter it bakes with web/fight/anim-retarget.js `bakeRetargetByRole` twice (with the
// bounded IK and without), judges each candidate with the swap gate, and keeps the first accepted
// (IK first). The output is ONE file per species holding, per motion: the appended per-bone
// rotation keys, the root's translation keys, the offset-shifted frame playlist and the gate
// numbers. Nothing here writes anything into git's tracked tree: `--out` is under web/assets,
// which is ignored.
//
// THE GATE. K22a owns the acceptance rule (`web/fight/motion-swap-gate.js`, judge(bake, kind,
// model)). This tool imports it when it exists. Until it lands it uses FALLBACK_GATE below, whose
// bars are castGate's own numbers relaxed ONLY where K21d's DW3->DW3 control measured castGate to
// be stricter than any borrowed cast:
//   ankle  0.10 -> 0.30 H   (the DW3->DW3 control itself measures 0.224 H, K21d section 4)
//   return 2.60 -> 6.00 rad (the control measures 4.09; a death clip never returns at all)
//   energy 3.50 -> 6.00     (Kokatorimon's F measures 4.05 on honest motion; castGate refuses it)
//   speed  2.50 -> 3.50     (Kokatorimon's F measures 3.62 and is the run the operator called good,
//                            so 3.5 still refuses it: the number is left at castGate's own class)
// Every generated motion records which gate judged it (`gateSource`).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BONEMAP } from "../../web/fight/digimon-bonemap.js";
import { bakeRetargetByRole, bakeRetargetWorld, castGate, rigOf } from "../../web/fight/anim-retarget.js";

const A = process.argv.slice(2);
const arg = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const jobsDir = arg("--jobs");
const outDir = arg("--out");
const only = (arg("--only", "") || "").split(",").filter(Boolean);
if (!jobsDir || !outDir) { console.error("need --jobs DIR --out DIR"); process.exit(2); }

let gateMod = null;
try {
  gateMod = await import("../../web/fight/motion-swap-gate.js");
} catch { gateMod = null; }
const judgeA = typeof gateMod?.judge === "function" ? gateMod.judge : null;
const swapLadder = typeof gateMod?.swapLadder === "function" ? gateMod.swapLadder : null;
const kindOfSlot = typeof gateMod?.kindOfSlot === "function" ? gateMod.kindOfSlot : null;

export const FALLBACK_GATE = {
  minCovered: 0.55,
  hand: [0.20, 8.0],
  energy: [0.25, 6.0],
  speed: 3.5,
  ankle: 0.30,
  returnByKind: { idle: 6.0, attack: 6.0, cast: 6.0, signature: 6.0, flinch: 3.0, evade: 3.0, survive: 3.0, self: 6.0, throw: 6.0, death: null },
  motion: 0.35,
  folds: 0,
};

function fallbackJudge(bake, kind) {
  const g = castGate(bake);                  // the existing metrics + castGate's own verdict
  const B = FALLBACK_GATE;
  const reasons = [];
  const m = g;
  if ((m.covered ?? 0) < B.minCovered) reasons.push("coverage");
  if (m.hand != null && (m.hand > B.hand[1] || m.hand < B.hand[0])) reasons.push("hand");
  if (m.energy != null && (m.energy > B.energy[1] || m.energy < B.energy[0])) reasons.push("energy");
  if (m.speed != null && m.speed > B.speed) reasons.push("speed");
  if (m.ankle != null && m.ankle > B.ankle) reasons.push("ankle");
  const rb = B.returnByKind[kind] ?? 6.0;
  if (rb != null && m.returnGap != null && m.returnGap > rb) reasons.push("return");
  if (m.motion != null && m.motion < B.motion) reasons.push("motion");
  if ((m.folds ?? 0) > B.folds) reasons.push("fold");
  return { pass: reasons.length === 0, keys: reasons, numbers: m, source: "k22c-fallback" };
}

const judge = (bake, kind, target) => (judgeA ? { ...judgeA(bake, kind, target), source: "k22a" } : fallbackJudge(bake, kind));

/**
 * THE JUDGE FOR A WORLD BAKE (K23). The world-space retarget does not copy joint deltas, so K22a's
 * FIDELITY keys (hand/energy/motion/speed vs the donor) do not describe it: it aims limbs along the
 * donor's DIRECTIONS and eases back to the body's own idle, which is a different promise. What the
 * operator asked to be held is K22a's SHAPE set — the same bars, measured on the DW3 corpus:
 *   return      ends at the body's own idle (K22a: only for the kinds that hand back)
 *   step        no pose jump beyond what the clip's own body does (K22a: p99 of the corpus, per kind)
 *   ankle / groundBelow / groundAbove / pen   feet and the body's own floor
 * So: K22a's measureSwap + judgeNumbers, with the fidelity bars neutralised.
 */
function worldJudge(bake, kind, target) {
  if (!gateMod?.measureSwap || !gateMod?.judgeNumbers || !gateMod?.SWAP_BARS) return fallbackJudge(bake, kind);
  const numbers = gateMod.measureSwap(bake);
  if (!numbers) return { pass: false, keys: ["empty"], numbers: null, source: "k22a-shape" };
  const base = gateMod.SWAP_BARS[kind] ?? gateMod.SWAP_BARS.attack;
  const bars = { ...base, hand: Infinity, energy: Infinity, motion: 0, speed: Infinity };
  const own = gateMod.ownNumbers ? gateMod.ownNumbers(target) : null;
  const v = gateMod.judgeNumbers({ ...numbers, covered: 1, limbs: null, hand: null, energy: null, motion: null, speed: null },
    kind, { bars, own });
  return { ...v, source: "k22a-shape" };
}

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const letterOf = (model, L) => (model.clips || []).find((c) => c.name === L)
  ?? (model.clips || []).find((c) => c.letter === L) ?? null;   // C0/C1/C2 share the letter "C"

// bakeRetargetByRole reads a clip's BODY table from its op2 bind and ignores tables 0/1 (the base
// idle / return tables of a pack). The converter writes one table per clip starting at 0, so the
// FIRST clip's table (the idle A) would look like a base table and the bake would refuse it. Lift
// every clip table above the base pair once, in memory: the table is moved, the frames do not move.
function liftSourceTables(source) {
  const n = (source.timeline || []).length;
  const shift = 2;
  const map = new Map();
  for (let i = 0; i < n; i++) map.set(i, i + shift);
  const tl = [];
  for (const [from, to] of map) tl[to] = source.timeline[from];
  source.timeline = tl;
  for (const act of Object.values(source.actions || {})) {
    for (const o of act?.ops ?? []) {
      if (o.op === 2 && (o.words?.[0] | 0) === 0 && map.has(o.words[2] | 0)) o.words[2] = map.get(o.words[2] | 0);
    }
  }
}

const LETTER_KIND_SLOT = { A: 0, C0: 1, C1: 4, C2: 2, K: 3, I: 5, F: 9, G: 9, H: 9 };
// The letters each DW3 slot can take (tools/build_dw2_motion.py DW2_CLIP_MAP, kept in step by hand:
// both sides are the same table and the build FAILS loudly if a slot names a letter this file lacks).
const SLOT_LETTERS = {
  0: ["A"], 1: ["C0"], 2: ["C2"], 3: ["K"], 4: ["C1"], 5: ["I"], 6: ["I"], 7: ["I"], 8: ["I"],
  9: ["F", "G", "H"], 10: ["A"], 11: ["I", "F", "G", "H"], 13: ["F", "G", "H"], 14: ["I"],
  15: ["F", "G", "H"], 16: ["F", "G", "H"], 17: ["C1"],
};

const jobs = (only.length ? only : readdirSync(jobsDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")))
  .map((f) => join(jobsDir, `${f}.json`))
  .filter((p) => existsSync(p));

mkdirSync(outDir, { recursive: true });
let done = 0, failed = [];
const summary = [];
for (const jobPath of jobs) {
  let job;
  try { job = readJSON(jobPath); } catch (e) { failed.push([jobPath, `job unreadable: ${e.message}`]); continue; }
  const target = readJSON(job.target);
  const source = readJSON(job.source);
  source.folder = job.dw2folder;
  liftSourceTables(source);
  BONEMAP[source.folder] = job.bonemap;         // the same table rigOf() reads for our own models
  const S = rigOf(source);
  // The K23 world bake pairs part CLOUDS by geometry and needs no role map, so a donor whose K12 map
  // derivation failed still bakes; the map is only used for the report fields below.
  const donorMapped = S.source === "bonemap";
  const motions = {};
  const owned = job.ownedSlots || {};
  for (const row of job.letters) {
    // THE USER RULE: DW2 motion only FILLS a slot the DW3 model does not own. Never replace a clip the
    // model already plays (its own authored script is ground truth and stays byte-identical).
    const slotsForLetter = Object.entries(SLOT_LETTERS).filter(([s, ls]) => ls.includes(row.letter)).map(([s]) => +s);
    const gapsUsingLetter = slotsForLetter.filter((s) => !owned[s]);
    if (!gapsUsingLetter.length) { summary.push([job.folder, row.letter, "unused"]); continue; }
    const clip = letterOf(source, row.letter);
    if (!clip) { summary.push([job.folder, row.letter, "missing-donor"]); continue; }
    const clipIndex = clip.index ?? clip.motion_id;
    // K22a's rule: the KIND is the engine's own slot use (kindOfSlot), not the letter
    const gateKind = (kindOfSlot ? kindOfSlot(LETTER_KIND_SLOT[row.letter] ?? 0) : null) ?? row.kind;
    // K23: the WORLD-SPACE retarget (bakeRetargetWorld) — parts paired by chain geometry, limb bones
    // aimed along the donor's direction, eased in from and back to the body's own idle. The K16 role
    // bake was visibly wrong on these bodies (the user: a bird tipped and contorted).
    let bake = null;
    try { bake = bakeRetargetWorld(target, source, clipIndex, { offset: row.offset }); }
    catch (e) { summary.push([job.folder, row.letter, "throw:" + String(e.message || e).slice(0, 40)]); continue; }
    if (!bake) { summary.push([job.folder, row.letter, "nobake"]); continue; }
    bake.source = source;
    bake.method = "world";
    const verdict = worldJudge(bake, gateKind, target);
    if (!verdict.pass) {
      motions[row.letter] = {
        letter: row.letter, kind: row.kind, gateKind, table: row.table, offset: row.offset,
        rootBone: 0, lo: 0, hi: 0, frames: 0, used: false, ik: null, method: "world",
        gateSource: verdict.source ?? null, gate: verdict.numbers ?? null, keys: {}, ch1: {}, playlist: [],
        gaps: gapsUsingLetter, keys_: verdict.keys ?? [],
      };
      summary.push([job.folder, row.letter, "refuse:" + gapsUsingLetter.join("/"), (verdict.keys || []).join("+"),
        verdict.numbers?.ankle, verdict.numbers?.step, verdict.numbers?.return]);
      continue;
    }
    const baked = bake.model;
    const playlist = baked.timeline?.[bake.table]?.table ?? [];
    let lo = Infinity, hi = -1;
    for (const e of playlist) { const v = e?.value | 0; if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    // only the keys the bake APPENDED (frames at or past the offset) — the model's own channels are
    // untouched on disk and stay untouched in memory until the hook merges these in. The world bake
    // writes BOTH channels for every bone (positions carry the limb direction), so both are kept.
    const keys = {}, ch1 = {};
    for (let i = 0; i < baked.bones.length; i++) {
      const r2 = (baked.bones[i]?.anim?.ch2 ?? []).filter((r) => r[3] !== 30000 && r[3] >= row.offset);
      if (r2.length) keys[i] = r2;
      // POSITIONS: only a ROOT bone's translation is merged. The world bake also moves every chain
      // START to the donor's part position, which changes a bone's distance from its parent from frame
      // to frame — a stretched joint, i.e. a seam the PS1 skinning cannot hide (the contract's C7
      // rigidity rule measures exactly the parent-child distance). Keeping the body's own offsets and
      // the donor's DIRECTIONS gives the aimed limbs without the seam; the root still travels.
      const isRoot = ((target.bones[i]?.parent_slot ?? 0) | 0) <= 0;
      if (!isRoot) continue;
      const r1 = (baked.bones[i]?.anim?.ch1 ?? []).filter((r) => r[3] !== 30000 && r[3] >= row.offset);
      if (r1.length) ch1[i] = r1;
    }
    motions[row.letter] = {
      letter: row.letter, kind: row.kind, gateKind, method: "world", table: bake.table, offset: row.offset,
      rootBone: job.bonemap.r ?? 0,
      lo, hi, frames: hi >= lo ? hi - lo + 1 : 0,
      used: true, ik: null, yaw: bake.metrics?.yaw ?? null, pairs: bake.pairs?.length ?? 0,
      gateSource: verdict.source ?? null, gate: verdict.numbers ?? null,
      keys, ch1, playlist,
      gaps: gapsUsingLetter,
    };
    summary.push([job.folder, row.letter, "pass:" + gapsUsingLetter.join("/"), "", verdict.numbers?.ankle, verdict.numbers?.step, verdict.numbers?.return]);
  }
  const out = {
    v: 2, folder: job.folder, dw2: job.dw2folder, name: job.name ?? null,
    ownedSlots: job.ownedSlots ?? null,
    gapSlots: job.gapSlots ?? null,
    motions,
    builtBy: "tools/build_dw2_motion.py + tools/dw2_motion/bake.mjs (K23 world-space retarget)",
    gate: judgeA ? "k22a-shape" : "k22c-fallback",
  };
  writeFileSync(join(outDir, `${job.folder}.json`), JSON.stringify(out));
  done++;
}
console.log(`baked ${done}/${jobs.length} species -> ${outDir}`);
for (const f of failed) console.log("  FAIL", f[0], f[1]);
const pick = summary.filter((s) => s.length > 2);
const passed = pick.filter((s) => String(s[2]).startsWith("pass")).length;
console.log(`motions: ${pick.length} baked, ${passed} passed the gate (${(100 * passed / Math.max(1, pick.length)).toFixed(0)}%)`);
for (const s of pick) console.log("  ", s.join("  "));
