#!/usr/bin/env node
// K20b: GENERATE web/fight/head-cast-constants.js — the head-cast constants the solver reads.
//
// Source: the K20a measurement (/home/dorij/scratch-research/anatomy/head-casts.json + generator
// k20a/measure.mjs), which replayed 115 authored mouth/head casts of 79 models through the real action VM
// and read each cast's own baked channels. AGGREGATES ONLY: no model id, folder or name reaches this file.
//
// Two numbers are measured HERE, from the same corpus, because the solver's gate needs them and K20a does
// not publish them:
//   JUMP       the disc's own frame-to-frame head pitch step (deg/tick): for every cast, the largest
//              |pitch(t+1) - pitch(t)| over the cast's table frames (K20a `rows[].series` = [tick, pitchRel,
//              bodyRel, localPitch, footDrift]); p50/p90 across the 115 casts. A solver's head must not
//              step faster than the disc's own p90 — that is the "no frame-to-frame pose jump" bar.
//   IDLE_JITTER how much a model's OWN idle moves between two consecutive playlist frames: the largest
//              bone travel (share of body height) and the largest joint turn (deg) over the idle playlist,
//              per model, p50/p90 across the corpus models. A cast that starts or ends further from the
//              idle than the idle's own step pops; inside that step it is invisible.
//
//   node tools/k20b_head_cast_constants.mjs [--check]
//
// --check writes nothing and exits 1 when the shipped file differs from what would be generated.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const SRC = "/home/dorij/scratch-research/anatomy/head-casts.json";
const OUT = path.join(ROOT, "web/fight/head-cast-constants.js");

const { poseFromChannels } = await import(path.join(ROOT, "web/fight/firing-axis.js"));
const { bodyHeight } = await import(path.join(ROOT, "web/fight/anim-collision.js"));

const corpus = JSON.parse(fs.readFileSync(SRC, "utf8"));
const cp = corpus.constantsProposal;

const r2 = (x) => Math.round(x * 100) / 100;
const dist = (d) => (d && d.p50 != null ? { n: d.n ?? null, p10: r2(d.p10), p50: r2(d.p50), p90: r2(d.p90) } : null);
const pct = (sorted, q) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const KEYS = ["headLift", "headLiftAboveRelease", "headLiftFromBind", "holdTicks", "pitchAtRelease",
  "yawAtRelease", "returnTicks", "bodyPitchPeak", "rootTravelH", "tickToPeak", "footDriftMaxH"];
const cellOf = (c) => {
  if (!c) return null;
  const out = { n: c.n ?? null };
  for (const k of KEYS) out[k] = dist(c[k]);
  for (const k of ["liftShare", "riseShare", "levelAtRelease", "returnShare"]) if (c[k] != null) out[k] = r2(c[k]);
  return out;
};

const cells = { all: cellOf(cp.all) };
// the byGroup cells name the same measures differently (peak = head lift); map them, do not re-derive
const GROUP_KEYS = { headLift: "peak", headLiftAboveRelease: "peakVSRelease", headLiftFromBind: "liftFromBind" };
const groupCellOf = (c) => {
  if (!c) return null;
  const out = { n: c.n ?? null };
  for (const k of KEYS) out[k] = dist(c[GROUP_KEYS[k] ?? k]);
  if (c.level10 != null) out.levelAtRelease = r2(c.level10);
  if (c.returned != null) out.returnShare = r2(c.returned);
  if (c.liftShare != null) out.liftShare = r2(c.liftShare);
  if (c.riseShare != null) out.riseShare = r2(c.riseShare);
  return out;
};
for (const [k, v] of Object.entries(corpus.byGroup ?? {})) {
  if (!["spell", "throw", "free", "hub"].includes(k)) continue;
  const name = k === "spell" ? "spells" : k === "throw" ? "throws" : k;
  const c = groupCellOf(v);
  if (c) cells[name] = c;
}
for (const k of ["free", "hub"]) if (cp[k] && !cells[k]) cells[k] = cellOf(cp[k]);
const sizes = {};
for (const [k, v] of Object.entries(cp.bySize ?? {})) sizes[k] = cellOf(v);

// ── JUMP: the disc's own frame-to-frame head pitch step ──────────────────────────────────────────────
const perCastJump = [];
for (const r of corpus.rows) {
  const s = r.series;
  if (!Array.isArray(s) || s.length < 2) continue;
  let worst = 0;
  for (let i = 1; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i][1] - s[i - 1][1]));
  perCastJump.push(worst);
}
perCastJump.sort((a, b) => a - b);
const JUMP = {
  n: perCastJump.length,
  p50: r2(pct(perCastJump, 0.5)),
  p90: r2(pct(perCastJump, 0.9)),
  max: r2(perCastJump[perCastJump.length - 1]),
};

// ── IDLE_JITTER: how far a model's own idle moves between two playlist frames ───────────────────────
const folders = [...new Set(corpus.rows.map((r) => r.folder))];
const jitUnits = [], jitDeg = [];
const angleOf = (R) => {
  const c = Math.max(-1, Math.min(1, ((R[0][0] + R[1][1] + R[2][2]) - 1) / 2));
  return Math.acos(c) * 180 / Math.PI;
};
const localOf = (parentW, W) => {          // L = Wp^T * W (row-major 3x3)
  const t = [[parentW[0][0], parentW[1][0], parentW[2][0]], [parentW[0][1], parentW[1][1], parentW[2][1]], [parentW[0][2], parentW[1][2], parentW[2][2]]];
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => t[r][0] * W[0][c] + t[r][1] * W[1][c] + t[r][2] * W[2][c]));
};
for (const folder of folders) {
  const f = path.join(MODELS, folder, "anim.json");
  if (!fs.existsSync(f)) continue;
  const pack = JSON.parse(fs.readFileSync(f, "utf8"));
  pack.folder = folder;
  const tab = pack.timeline?.[1]?.table ?? [];
  const frames = tab.map((e) => e?.value | 0).filter((v) => v >= 0 && v < 0x8000);
  if (frames.length < 2) continue;
  const H = bodyHeight(pack);
  if (!(H > 0)) continue;
  const n = pack.num_bones ?? pack.bones.length;
  const parent = Array.from({ length: n }, (_, i) => (pack.bones[i]?.parent_slot ?? 0) - 1);
  const poses = frames.map((fr) => poseFromChannels(pack, fr));
  /** The farthest VERTEX travel between two poses, share of height - what a viewer sees move. */
  const vtx = (a, b) => {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const Ra = a.rot[i], Rb = b.rot[i], ta = a.pos[i], tb = b.pos[i];
      if (!Ra || !Rb || !ta || !tb) continue;
      const vs = pack.bones[i].verts || [];
      for (const v of vs) {
        const pa = [Ra[0] * v[0] + Ra[3] * v[1] + Ra[6] * v[2] + ta[0], Ra[1] * v[0] + Ra[4] * v[1] + Ra[7] * v[2] + ta[1], Ra[2] * v[0] + Ra[5] * v[1] + Ra[8] * v[2] + ta[2]];
        const pb = [Rb[0] * v[0] + Rb[3] * v[1] + Rb[6] * v[2] + tb[0], Rb[1] * v[0] + Rb[4] * v[1] + Rb[7] * v[2] + tb[1], Rb[2] * v[0] + Rb[5] * v[1] + Rb[8] * v[2] + tb[2]];
        worst = Math.max(worst, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) / H);
      }
    }
    return worst;
  };
  let worstU = 0, worstD = 0;
  for (let k = 0; k < poses.length; k++) {
    const a = poses[k], b = poses[(k + 1) % poses.length];
    worstU = Math.max(worstU, vtx(a, b));
    for (let i = 0; i < n; i++) {
      const Ra = a.rot[i], Rb = b.rot[i];
      if (!Ra || !Rb) continue;
      const toM = (R) => [[R[0], R[3], R[6]], [R[1], R[4], R[7]], [R[2], R[5], R[8]]];
      const Wa = toM(Ra), Wb = toM(Rb);
      const pa = parent[i], WaP = pa >= 0 && pa < n ? toM(a.rot[pa]) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const WbP = pa >= 0 && pa < n ? toM(b.rot[pa]) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const La = localOf(WaP, Wa), Lb = localOf(WbP, Wb);
      const d = angleOf([0, 1, 2].map((r) => [0, 1, 2].map((c) => La[0][c] * Lb[0][r] + La[1][c] * Lb[1][r] + La[2][c] * Lb[2][r])));
      worstD = Math.max(worstD, d);
    }
  }
  jitUnits.push(worstU);
  jitDeg.push(worstD);
}
jitUnits.sort((a, b) => a - b); jitDeg.sort((a, b) => a - b);
const IDLE_JITTER = {
  models: jitUnits.length,
  unitsH: { p50: r2(pct(jitUnits, 0.5)), p90: r2(pct(jitUnits, 0.9)), max: r2(jitUnits[jitUnits.length - 1]) },
  deg: { p50: r2(pct(jitDeg, 0.5)), p90: r2(pct(jitDeg, 0.9)), max: r2(jitDeg[jitDeg.length - 1]) },
};

const body = `// HEAD-CAST CONSTANTS - how the disc's own mouth/head casts move the head.
//
// GENERATED by tools/k20b_head_cast_constants.mjs from the K20a measurement of 115 authored mouth/head
// casts (79 models, 66 spell casts + 49 clip-5 throws, replayed through the real action VM; the per-cast
// rows live in /home/dorij/scratch-research/anatomy/head-casts.json). AGGREGATES ONLY: no model id, folder
// or name is in this file.
//
// FRAME: these are MESH-frame numbers - the geometry the player sees, + up. The module's own firing axis
// (firing-axis.js carriedFacing) reports the exact MIRROR of this pitch: measured per cast, geoPitch +
// axisPitch = 0 on 110 of 115 (K20a). A solver reading the axis must negate its pitch to compare with
// these numbers, and a solver ROTATING a bone must negate the angle it applies (see anim-solver.js).
//
//   headLift            peak head pitch above the model's own neutral, degrees, during the wind-up
//   headLiftAboveRelease  the same measured against the RELEASE pitch (the cast's own lift)
//   holdTicks           ticks within 80% of that peak, contiguous through it
//   tickToPeak          ticks from the cast's first table frame to the peak
//   pitchAtRelease      head pitch relative to neutral at release (p50 ~ level, wide spread)
//   returnTicks         ticks from release until the head is back within max(2 deg, 15% of peak)
//   levelAtRelease      share of casts whose head axis is within 10 deg of horizontal at release
//   bodyPitchPeak       largest torso pitch change during the wind-up (the body tips too)
//   rootTravelH         largest root displacement during the cast, share of body height
//   footDriftMaxH       the feet's own travel during the cast, share of body height
//
// Cells with n < 4 are not constants: headCastFor() falls back to the size-free cells (K20a's rule).
export const HEAD_CAST_CENSUS = ${JSON.stringify({ casts: corpus.census?.measured ?? corpus.rows.length, models: corpus.census?.models ?? null, spells: corpus.census?.spells ?? null, throws: corpus.census?.throws ?? null, free: corpus.census?.free ?? null, hub: corpus.census?.hub ?? null })};

/** The disc's own frame-to-frame head pitch step, degrees per tick (see the generator for how it is read). */
export const HEAD_CAST_JUMP = ${JSON.stringify(JUMP)};

/** How far a model's own idle moves between two playlist frames - the pop threshold (see the generator). */
export const HEAD_CAST_IDLE = ${JSON.stringify(IDLE_JITTER)};

export const HEAD_CAST_SIZES = ${JSON.stringify(Object.keys(sizes))};

/** The measured cells. \`all\` is the fallback for every thin cell; \`spells\`/\`free\` are the honest
 *  sub-corpora a spell solver should prefer when a size cell is thin; \`hub\` (4 casts) never is. */
export const HEAD_CAST = ${JSON.stringify(cells, null, 1)};

/** Per SIZE class: how much the disc lifts a head of that size. */
export const HEAD_CAST_BY_SIZE = ${JSON.stringify(sizes, null, 1)};

/** The fewest casts a size cell needs before it is a constant (K20a's own rule). */
export const HEAD_CAST_MIN_CELL = 4;

/**
 * The head-cast constants for a size class: the size cell when it holds at least \`HEAD_CAST_MIN_CELL\`
 * casts, else the size-free \`spells\` cell (a solver only drives spell casts), else \`all\`. Never \`hub\`:
 * 4 casts, and all four of them are head = root = torso bodies.
 * Returns { ...cell, source } or null.
 */
export function headCastFor(sizeClass = null, { minCell = HEAD_CAST_MIN_CELL } = {}) {
  const size = sizeClass && HEAD_CAST_BY_SIZE[sizeClass] ? HEAD_CAST_BY_SIZE[sizeClass] : null;
  const base = HEAD_CAST.spells ?? HEAD_CAST.all;
  if (size && size.n >= minCell) return { ...base, ...size, source: "size:" + sizeClass };
  return base ? { ...base, source: HEAD_CAST.spells ? "spells" : "all" } : null;
}
`;

if (process.argv.includes("--check")) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (have !== body) { console.error("head-cast-constants.js is STALE: regenerate with tools/k20b_head_cast_constants.mjs"); process.exit(1); }
  console.log("head-cast-constants.js is up to date");
  process.exit(0);
}
fs.writeFileSync(OUT, body);
console.log(`wrote ${path.relative(ROOT, OUT)} (${body.length} bytes)`);
console.log("JUMP", JSON.stringify(JUMP), "IDLE", JSON.stringify(IDLE_JITTER));
