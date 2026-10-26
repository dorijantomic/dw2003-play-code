// K22a — THE ACCEPTANCE RULE FOR A MOTION SWAP.
//
// A "swap" is different from a "gap fill": the model ALREADY owns a clip of this kind, and the swap
// replaces its body with a retargeted donor clip (today a Digimon World 2 clip, but nothing here knows
// that). castGate() (anim-retarget.js) was tuned for filling a MISSING cast and is absolute: it refuses
// every borrowed clip measured in K21d, including a plain DW3->DW3 control (ankle 0.224 H and return
// 4.09 rad are stricter than the corpus itself). This module is the rule for a swap:
//
//   1. SHAPE — the swapped clip must not do anything the BODY ITSELF never does. Every bar is measured
//      from the DW3 corpus (249 packs, 2793 clips): per clip KIND, the p95 of each metric over every
//      model's own clips of that kind, raised to the target's own worst clip when the body itself is
//      more mobile (a bird's feet leave the floor in its own clips; a statue's do not).
//        ankle        worst ankle rise/fall, share of body height
//        step         worst per-frame joint step, rad (a one-frame snap a player sees)
//        pen          deepest penetration past the body's own authored floor, share of body height
//        groundBelow/groundAbove  lowest mesh vertex vs the clip's first pose, share of body height
//        groundEnd    the last pose's lowest vertex vs the first, share (a death must end on the floor)
//        return       last pose vs the pose the model's IDLE begins in, rad — only required for the
//                     kinds that hand back to idle (idle loop, hit reaction, cast); a death clip and an
//                     attack are never judged on it
//   2. FIDELITY — the swap must still be the donor's motion. Bars from a DW3->DW3 cross-bake corpus
//      (42 targets x donors x 6 kinds, 492 bakes): the p95 of what a same-engine retarget does to
//         speed        worst per-frame joint step / the donor's own step on the same bone (0.25 rad floor)
//         hand         the hand/prop's travel / the donor's own, height-scaled
//         energy       whole-body travel, end vs start, summed / the donor's, height-scaled
//         motion       the largest single-bone excursion / the donor's, height-scaled
//      Direction error vs the donor is measured and REPORTED but is not a key: the same-engine control
//      is 158 deg off, so it cannot separate good from bad on its own.
//   3. COVERAGE — every limb the KIND needs must be mapped (arms+legs for idle/hit/cast/attack, the legs
//      for death, nothing for an item pose); unmapped wings/tail are not a failure (Kokatorimon's DW2 rig
//      has no tail chain and the retarget leaves those bones at rest, which is correct).
//
// The numbers in SWAP_BARS are data, not taste: see SWAP_BARS_SOURCE. Re-measure with the scripts
// described there; the table is regenerated, never hand-edited.
//
// OFF BY DEFAULT: nothing here is imported by the game yet. K22c owns the hook (`?dw2motion=1`), K22b
// owns anim-retarget.js; this module only decides.
import { rigOf, bakeRetargetByRole, bakeRetargetGeometry, bakeRetargetWorld } from "./anim-retarget.js";
import { penetration, clearanceTolerance } from "./anim-collision.js";
import { poseFromChannels } from "./firing-axis.js";

/** The clip kinds a swap is judged by. Slot -> kind is the engine's own clip use (fight-tables.js). */
export const SWAP_KINDS = Object.freeze(["idle", "hit", "death", "attack", "cast", "item"]);
export const SWAP_SLOTS = Object.freeze({
  idle: [0],
  hit: [1, 2, 4],          // multi-hit, survives, evade (REACTION_*_CLIP)
  death: [3],              // killed
  attack: [5, 6, 7, 8, 11], // basic, combos, signature/finisher
  cast: [9, 13],           // ranged/spell casts
  item: [10, 14, 15, 16, 17], // item use / self casts / throws
});
const SLOT_KIND = new Map();
for (const [kind, slots] of Object.entries(SWAP_SLOTS)) for (const s of slots) SLOT_KIND.set(s, kind);
/** The kind of a DW3 clip slot, or null for a slot no rule covers. */
export function kindOfSlot(slot) {
  return SLOT_KIND.get(slot | 0) ?? null;
}

/**
 * MEASURED BARS. Every number is a p95 (or p99 where noted) over a corpus of the DW3 packs, except the
 * fidelity rows, which are a p95 over same-engine (DW3->DW3) retargets of the same kind. `n` is how many
 * clips the row was measured on. A null row is not judged for that kind.
 */
export const SWAP_BARS_SOURCE = Object.freeze({
  shape: {
    corpus: "web/assets/battle/models (249 packs, 2793 clips, every model's own clips)",
    measured: "2026-10-21",
    perKindClips: { idle: 249, hit: 653, death: 244, attack: 487, cast: 53, item: 858 },
    quantile: "p95 for ankle/ground/return, p99 for step/penetration",
  },
  fidelity: {
    corpus: "DW3->DW3 cross-bakes: 42 targets x donors x 6 kinds, 492 bakes (this same judge's numbers)",
    measured: "2026-10-21, re-measured after K22b's retarget edits (the first fit was within 2-5% except attack speed, 6.99, which was 2.4x too loose against the 2.95 null)",
    quantile: "p95 (ik=true candidate)",
  },
  note: "DW2 donor clips were measured too (108 converted species) and fall inside these envelopes; no",
  note2: "DW2-derived number is stored here (the disc data may never be committed).",
});

export const SWAP_BARS = Object.freeze({
  idle: Object.freeze({ n: 249, ankle: 0.138, step: 0.149, pen: 0.370, groundBelow: 0.490, groundAbove: 0.300, groundEnd: 0.031, return: 0.10, speed: 5.45, hand: 6.18, energy: 3.18, motion: 3.85 }),
  hit: Object.freeze({ n: 653, ankle: 0.422, step: 0.773, pen: 0.290, groundBelow: 0.490, groundAbove: 0.290, groundEnd: 0.519, return: 2.86, speed: 4.30, hand: 6.85, energy: 3.10, motion: 2.95 }),
  death: Object.freeze({ n: 244, ankle: 0.258, step: 2.959, pen: 0.290, groundBelow: 0.490, groundAbove: 0.290, groundEnd: 0.408, return: null, speed: 4.30, hand: 6.85, energy: 3.10, motion: 2.95 }),
  attack: Object.freeze({ n: 487, ankle: 0.732, step: 2.282, pen: 0.450, groundBelow: 0.420, groundAbove: 0.250, groundEnd: 0.389, return: null, speed: 3.05, hand: 2.55, energy: 1.90, motion: 2.00 }),
  cast: Object.freeze({ n: 53, ankle: 0.380, step: 1.453, pen: 0.420, groundBelow: 0.290, groundAbove: 0.260, groundEnd: 0.029, return: 2.94, speed: 5.75, hand: 4.20, energy: 1.65, motion: 2.05 }),
  item: Object.freeze({ n: 858, ankle: 0.515, step: 3.088, pen: 0.370, groundBelow: 0.490, groundAbove: 0.300, groundEnd: 0.315, return: null, speed: 5.45, hand: 6.18, energy: 3.18, motion: 3.85 }),
});

/** The kinds that must hand the body back to the idle pose (a death clip and an attack must not). */
export const SWAP_RETURNS = Object.freeze({ idle: true, hit: true, cast: true, death: false, attack: false, item: false });
/** The limbs a kind needs mapped on the target: "all" = arms and legs, "legs" = the legs. */
export const SWAP_NEEDS = Object.freeze({ idle: "all", hit: "all", death: "legs", attack: "all", cast: "all", item: "legs" });

// ── measuring ─────────────────────────────────────────────────────────────────────────────────────────

const ROT_STEP = (A, B) => {
  let d = 0;
  for (let k = 0; k < 9; k++) d += A[k] * B[k];
  return Math.acos(Math.max(-1, Math.min(1, (d - 1) / 2)));
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
const pick = (a, n) => (a.length <= n ? a.slice() : Array.from({ length: n }, (_, k) => a[Math.round(((a.length - 1) * k) / (n - 1))]));
/** The frames a timeline table plays, in order (0x8000+ entries are LOOP markers, not frames). */
export function playedFrames(model, table) {
  const out = [];
  for (const e of model?.timeline?.[table]?.table ?? []) {
    const v = e?.value | 0;
    if (v >= 0 && v < 0x8000) out.push(v);
  }
  return out;
}
/** Lowest mesh vertex of a pose (world y, +Y down), ignoring bones the pose hides by scale. */
function lowestY(model, pose) {
  let lo = -Infinity;
  for (let i = 0; i < model.bones.length; i++) {
    if (pose.visible?.[i] === false) continue;
    const R = pose.rot[i], t = pose.pos[i];
    if (!R || !t) continue;
    for (const v of model.bones[i].verts || []) {
      const y = R[1] * v[0] + R[4] * v[1] + R[7] * v[2] + t[1];
      if (y > lo) lo = y;
    }
  }
  return lo;
}

const OWN = new WeakMap();

/**
 * What the body itself does, over every clip it owns: the worst value of each metric. This is the
 * per-model half of the shape bars - a swap may not exceed the body's own repertoire.
 */
export function ownNumbers(model, { samples = 6, penFrames = 1, slots = null } = {}) {
  if (!model) return null;
  if (!slots) { const hit = OWN.get(model); if (hit) return hit; }
  const rig = rigOf(model);
  const H = rig.box.h || 1;
  const tol = clearanceTolerance(model, model.folder, { samples: 96 });
  const stanceFrames = playedFrames(model, 0);
  const stance = poseFromChannels(model, stanceFrames.length ? stanceFrames[0] : 0);
  const out = { clips: 0, ankle: 0, step: 0, pen: 0, groundBelow: 0, groundAbove: 0, groundEnd: 0, height: Math.round(H), legs: rig.legs.length, arms: rig.arms.length, hips: 0 };
  const list = slots ?? Array.from({ length: model.clips?.length ?? 18 }, (_, i) => i);
  for (const slot of list) {
    const frames = playedFrames(model, slot);
    if (frames.length < 2) continue;
    out.clips++;
    const pose = (f) => poseFromChannels(model, f);
    const first = pose(frames[0]), last = pose(frames[frames.length - 1]);
    for (let k = 1; k < frames.length; k++) {
      const a = pose(frames[k - 1]).rot, b = pose(frames[k]).rot;
      for (let i = 0; i < model.bones.length; i++) out.step = Math.max(out.step, ROT_STEP(a[i], b[i]));
    }
    for (const leg of rig.legs) {
      const bone = leg.chain[leg.chain.length - 1];
      const r = stance.pos[bone];
      for (const f of pick(frames, samples)) out.ankle = Math.max(out.ankle, Math.abs(pose(f).pos[bone][1] - r[1]));
    }
    const lo0 = lowestY(model, stance);
    for (const f of pick(frames, Math.min(4, frames.length))) {
      const d = lowestY(model, pose(f)) - lo0;
      if (d > out.groundBelow) out.groundBelow = d;
      if (-d > out.groundAbove) out.groundAbove = -d;
    }
    out.groundEnd = Math.max(out.groundEnd, Math.abs(lowestY(model, last) - lo0));
    for (const f of pick(frames, penFrames)) {
      const pen = penetration(model, pose(f), { folder: model.folder, tolerance: tol });
      for (const v of pen.violations) out.pen = Math.max(out.pen, v.over);
    }
  }
  const normalized = {
    ...out,
    ankle: out.ankle / H, pen: out.pen / H,
    groundBelow: out.groundBelow / H, groundAbove: out.groundAbove / H, groundEnd: out.groundEnd / H,
  };
  if (!slots) OWN.set(model, normalized);
  return normalized;
}

/**
 * Every number a verdict uses, for one retarget bake (`bake` = bakeRetargetByRole / bakeRetargetGeometry
 * with `.source` set). The donor is sampled at `frame - bake.offset`, the target at the baked table.
 */
export function measureSwap(bake, { samples = 12, penFrames = 3 } = {}) {
  const baked = bake?.model, source = bake?.source;
  if (!baked || !source || !Array.isArray(bake.map)) return null;
  const off = bake.offset | 0;
  const T = rigOf(baked), S = rigOf(source);
  const H = T.box.h || 1, HD = S.box.h || 1;
  const frames = playedFrames(baked, bake.table);
  if (frames.length < 2) return null;
  const lo = frames[0], hi = frames[frames.length - 1];
  const poseT = (f) => poseFromChannels(baked, f);
  const poseS = (f) => poseFromChannels(source, f - off);
  const sampleT = pick(frames, samples);
  const first = poseT(lo), last = poseT(hi);

  // shape: step, ankle, ground
  let step = 0, stepBone = -1, stepAt = -1;
  for (let k = 1; k < frames.length; k++) {
    const a = poseT(frames[k - 1]).rot, b = poseT(frames[k]).rot;
    for (let i = 0; i < baked.bones.length; i++) {
      const s = ROT_STEP(a[i], b[i]);
      if (s > step) { step = s; stepBone = i; stepAt = frames[k]; }
    }
  }
  // the stance: the pose this model's IDLE stands in (the floor the body stands on). A clip's own first
  // pose can itself be lifted - K21d's floating death hid behind exactly that.
  const idleFrames = playedFrames(baked, 0);
  const stance = idleFrames.length ? poseT(idleFrames[0]) : poseT(0);
  let ankle = 0, ankleLat = 0;
  for (const leg of T.legs) {
    const bone = leg.chain[leg.chain.length - 1];
    const r = stance.pos[bone];
    for (const f of sampleT) {
      const p = poseT(f).pos[bone];
      ankle = Math.max(ankle, Math.abs(p[1] - r[1]));
      ankleLat = Math.max(ankleLat, Math.hypot(p[0] - r[0], p[2] - r[2]));
    }
  }
  const lo0 = lowestY(baked, stance);
  let groundBelow = 0, groundAbove = 0;
  for (const f of pick(frames, Math.min(8, frames.length))) {
    const d = lowestY(baked, poseT(f)) - lo0;
    if (d > groundBelow) groundBelow = d;
    if (-d > groundAbove) groundAbove = -d;
  }
  const groundEnd = lowestY(baked, last) - lo0;

  // return: the last pose against the pose this model's IDLE begins in
  let ret = null, startGap = null;
  if (idleFrames.length) {
    ret = 0; startGap = 0;
    for (let i = 0; i < baked.bones.length; i++) {
      if (bake.map[i] < 0) continue;
      ret = Math.max(ret, ROT_STEP(last.rot[i], stance.rot[i]));
      startGap = Math.max(startGap, ROT_STEP(first.rot[i], stance.rot[i]));
    }
    startGap = +startGap.toFixed(2);
  }
  const endToStart = (() => {
    let v = 0;
    for (let i = 0; i < baked.bones.length; i++) v = Math.max(v, ROT_STEP(last.rot[i], first.rot[i]));
    return v;
  })();

  // penetration past the body's own authored floor
  const tol = clearanceTolerance(baked, baked.folder, { samples: 96 });
  let pen = 0, penWorst = Infinity;
  for (const f of pick(frames, penFrames)) {
    const p = penetration(baked, poseT(f), { folder: baked.folder, tolerance: tol });
    penWorst = Math.min(penWorst, p.clearance);
    for (const v of p.violations) pen = Math.max(pen, v.over);
  }

  // fidelity: hand travel + direction, whole-body energy and motion, per-frame speed vs the donor.
  // The donor's "hand" is the bone the MAP pairs with the target's hand - comparing against the
  // donor's own right arm instead measures a different limb and reported the control as 154 deg off.
  const hand = (T.props.find((p) => p.side === "right") ?? T.props[0])?.bone
    ?? (T.arms.find((a) => a.side === "right") ?? T.arms[0])?.chain.slice(-1)[0];
  const mappedHand = hand != null && bake.map[hand] >= 0 ? bake.map[hand] : null;
  const donorHand = mappedHand ?? ((S.props.find((p) => p.side === "right") ?? S.props[0])?.bone
    ?? (S.arms.find((a) => a.side === "right") ?? S.arms[0])?.chain.slice(-1)[0]);
  let handRatio = null, dir = null, handTravel = null, donorTravel = null;
  if (hand != null && donorHand != null) {
    const p0 = first.pos[hand], s0 = poseS(lo).pos[donorHand];
    let bt = 0, btAt = lo, bts = 0, btsAt = lo;
    for (const f of frames) {
      const d = dist(poseT(f).pos[hand], p0); if (d > bt) { bt = d; btAt = f; }
      const ds = dist(poseS(f).pos[donorHand], s0); if (ds > bts) { bts = ds; btsAt = f; }
    }
    handTravel = bt / H; donorTravel = bts / HD;
    if (donorTravel > 1e-6) handRatio = handTravel / donorTravel;
    if (bt > 0.02 * H && bts > 0.02 * HD) {
      const dT = unit([poseT(btAt).pos[hand][0] - p0[0], poseT(btAt).pos[hand][1] - p0[1], poseT(btAt).pos[hand][2] - p0[2]]);
      const dS = unit([poseS(btsAt).pos[donorHand][0] - s0[0], poseS(btsAt).pos[donorHand][1] - s0[1], poseS(btsAt).pos[donorHand][2] - s0[2]]);
      dir = angleDeg(dT, dS);
    }
  }
  let eT = 0, eS = 0, mT = 0, mS = 0;
  for (let i = 0; i < baked.bones.length; i++) {
    const m = bake.map[i];
    if (m < 0) continue;
    const pt0 = first.pos[i], pt1 = last.pos[i];
    const ps0 = poseS(lo).pos[m], ps1 = poseS(hi).pos[m];
    if (!pt0 || !pt1 || !ps0 || !ps1) continue;
    eT += dist(pt1, pt0) / H;
    eS += dist(ps1, ps0) / HD;
    for (const f of sampleT) mT = Math.max(mT, dist(poseT(f).pos[i], pt0) / H);
    for (const f of sampleT) mS = Math.max(mS, dist(poseS(f).pos[m], ps0) / HD);
  }
  let speed = 0, speedAt = -1, speedBone = -1;
  for (let k = 1; k < frames.length; k++) {
    const a = poseT(frames[k - 1]).rot, b = poseT(frames[k]).rot;
    const sa = poseS(frames[k - 1]).rot, sb = poseS(frames[k]).rot;
    for (let i = 0; i < baked.bones.length; i++) {
      const m = bake.map[i];
      if (m < 0) continue;
      const r = ROT_STEP(a[i], b[i]) / Math.max(0.25, ROT_STEP(sa[m], sb[m]));
      if (r > speed) { speed = r; speedAt = frames[k]; speedBone = i; }
    }
  }
  return {
    frames: frames.length, range: [lo, hi], table: bake.table,
    covered: +(+bake.covered).toFixed(3), mapped: bake.map.filter((m) => m >= 0).length,
    bones: baked.bones.length, height: Math.round(H), donorHeight: Math.round(HD), sizeRatio: +(H / HD).toFixed(2),
    mirror: !!bake.mirror, ik: bake.method === "geometry" ? "geometry" : (bake.metrics?.ikSolved != null || bake.ik !== false ? "role+ik" : "role"),
    ikClamped: bake.metrics?.ikClamped ?? null,
    step: +step.toFixed(3), stepBone, stepAt,
    ankle: +(ankle / H).toFixed(3), ankleLat: +(ankleLat / H).toFixed(3),
    groundBelow: +(groundBelow / H).toFixed(3), groundAbove: +(groundAbove / H).toFixed(3), groundEnd: +(groundEnd / H).toFixed(3),
    pen: +(pen / H).toFixed(3), penWorst: +(penWorst / H).toFixed(3), penFloor: +(tol.floor / H).toFixed(3),
    return: ret == null ? null : +ret.toFixed(2), start: startGap, endToStart: +endToStart.toFixed(2),
    speed: speed ? +speed.toFixed(2) : null, speedAt, speedBone,
    hand: handRatio == null ? null : +handRatio.toFixed(2), handTravel: handTravel == null ? null : +handTravel.toFixed(3),
    donorTravel: donorTravel == null ? null : +donorTravel.toFixed(3), dir: dir == null ? null : +dir.toFixed(1),
    energy: eS > 0.01 ? +(eT / eS).toFixed(2) : null, motion: mS > 0.01 ? +(mT / mS).toFixed(2) : null,
    donorEnergy: +eS.toFixed(3), donorMotion: +mS.toFixed(3),
    limbs: { targetArms: T.arms.length, targetLegs: T.legs.length, props: T.props.length, donorArms: S.arms.length, donorLegs: S.legs.length },
  };
}

// ── judging ──────────────────────────────────────────────────────────────────────────────────────────

const over = (v, bar) => v != null && bar != null && v > bar;

/**
 * The verdict for ONE measured swap. `numbers` is measureSwap()'s output; `own` is ownNumbers() of the
 * target (per-model allowance, optional); `bars` is the kind's row of SWAP_BARS.
 * Returns { pass, keys, numbers, bars, notes } — `keys` names every failed bar, in the ladder's order.
 */
export function judgeNumbers(numbers, kind, { own = null, bars = null, needs = null } = {}) {
  const B = bars ?? SWAP_BARS[kind];
  if (!B) return { pass: false, keys: ["kind"], numbers, bars: null, notes: ["no bars for kind " + kind] };
  const keys = [], notes = [];
  const N = numbers;
  const uses = (name, v, bar) => { if (over(v, bar)) { keys.push(name); return `${name} ${v} > ${bar}`; } return null; };
  // 1. coverage of the limbs the kind needs
  if (N.limbs) {
    const wantArms = (needs ?? SWAP_NEEDS[kind]) === "all";
    if (wantArms && N.limbs.targetArms > 0 && N.limbs.donorArms === 0) keys.push("coverage(arms)");
    if (N.limbs.targetLegs > 0 && N.limbs.donorLegs === 0) keys.push("coverage(legs)");
  }
  if (N.covered < 0.55) keys.push("coverage");
  // 2. shape, with the body's own repertoire as the floor of the bar
  const shapeBar = (k) => Math.max(B[k] ?? 0, own?.[k] ?? 0);
  uses("ankle", N.ankle, shapeBar("ankle"));
  uses("step", N.step, Math.max(B.step, own?.step ?? 0));
  uses("pen", N.pen, shapeBar("pen"));
  uses("groundBelow", N.groundBelow, shapeBar("groundBelow"));
  uses("groundAbove", N.groundAbove, shapeBar("groundAbove"));
  if (kind === "death") uses("groundEnd", Math.abs(N.groundEnd), Math.max(B.groundEnd, own?.groundEnd ?? 0));
  // 3. return to idle, only for the kinds that hand back
  if (SWAP_RETURNS[kind]) {
    if (N.return == null) notes.push("return not measurable (no idle table)");
    else uses("return", N.return, B.return);
  }
  // 4. fidelity to the donor (a ratio needs a donor that moves at all: a static donor's energy is 0/0)
  for (const [name, lo, hi] of [["hand", 0.2, B.hand], ["energy", 0.25, B.energy], ["motion", 0.25, B.motion]]) {
    const v = N[name];
    if (v == null) { notes.push(`${name} not measurable`); continue; }
    if (name === "energy" && (N.donorEnergy ?? 1) < 0.05) { notes.push("donor static: energy not judged"); continue; }
    if (name === "motion" && (N.donorMotion ?? 1) < 0.02) { notes.push("donor static: motion not judged"); continue; }
    if (v < lo) keys.push(`${name}(frozen)`);
    else if (v > hi) keys.push(name);
  }
  uses("speed", N.speed, B.speed);
  return { pass: keys.length === 0, keys, numbers: N, bars: B, notes };
}

/** The verdict for one bake. `model` = the target as it was before the bake (for its own repertoire). */
export function judge(bake, kind, model = null, opts = {}) {
  const numbers = measureSwap(bake, opts);
  if (!numbers) return { pass: false, keys: ["empty"], numbers: null, bars: SWAP_BARS[kind] ?? null, notes: ["no table / no map"] };
  const own = opts.own ?? ownNumbers(model ?? bake.model, opts);
  return judgeNumbers(numbers, kind, { ...opts, own });
}

/**
 * THE REFUSAL LADDER for one (target, donor, source clip) swap. Tries, in order, the candidates the
 * retarget can produce and returns the first that the judge accepts:
 *   1. role bake WITH the bounded IK      (bakeRetargetByRole, ik: true)
 *   2. role bake WITHOUT it               (a limb the IK cannot reach is better left alone)
 *   3. the geometry bake                  (for a rig with no role map)
 *   4. the model's CURRENT clip           (no bake: the caller keeps what it plays today)
 * `build` lets the caller inject the first three candidates (K22c's batch builder does); by default the
 * three are produced here. Returns { pass, chosen, method, steps, fallback }.
 */
export function swapLadder(target, source, clip, kind, {
  offset = 6000, bars = null, own = null, build = null, judgeOpts = {},
} = {}) {
  const steps = [];
  const candidates = build ? build({ target, source, clip, kind })
    : [() => bakeRole(target, source, clip, offset, true, "role+ik"),
       () => bakeRole(target, source, clip, offset, false, "role"),
       () => bakeGeometry(target, source, clip, offset, "geometry")];
  for (const make of candidates) {
    let bake = null;
    try { bake = make(); } catch (e) { steps.push({ method: "throw", pass: false, keys: [String(e.message || e).slice(0, 80)] }); continue; }
    if (!bake) { steps.push({ method: make.method ?? "?", pass: false, keys: ["no-bake"] }); continue; }
    if (!bake.source) bake.source = source;
    const verdict = judgeNumbers(measureSwap(bake, judgeOpts), kind, { bars, own: own ?? ownNumbers(target, judgeOpts) });
    steps.push({ method: bake.method ?? "role+ik", pass: verdict.pass, keys: verdict.keys, numbers: verdict.numbers });
    if (verdict.pass) return { pass: true, chosen: bake, method: bake.method ?? "role+ik", steps, fallback: null };
  }
  return { pass: false, chosen: null, method: null, steps, fallback: "keep-own" };
}

// the ladder's default candidates, in the order they are tried
function bakeRole(target, source, clip, offset, ik, method) {
  const bake = bakeRetargetByRole(target, source, clip, { offset, ik });
  if (bake) { bake.source = source; bake.method = method; bake.ik = ik; }
  return bake;
}
function bakeGeometry(target, source, clip, offset, method) {
  const bake = bakeRetargetGeometry(target, source, clip, { offset });
  if (bake) { bake.source = source; bake.method = method; }
  return bake;
}

// ── K23: the WORLD bake, and the rule for A FILL (an empty slot, never a clip the model owns) ────────
//
// The operator's rule: DW2 motion only fills a slot the DW3 model does NOT own, and a fill is judged on
// the world bake (bakeRetargetWorld), not with castGate's numbers. The criteria, measured here:
//   owned        refuse a slot the model already plays (that is a swap, and swaps are out of scope)
//   rest-idle    the world bake keys from, and blends back to, the target's own REST frame; if that rest
//                is not the pose its idle clip starts in, the fill will pop when idle resumes
//   start/end    the first and last played frame must be the bake's own rest pose (the blend it eases
//                through) and, for every kind but a death, the last frame must be there too. Note this
//                is the K23 rest frame, NOT the first frame of the idle clip: `restIdle` prints that
//                difference (1.1-1.2 rad on today's bodies) as a note until K23's neutral frame moves.
//   pose jump    the worst per-frame joint step, against the same-engine world-bake envelope
//   feet/ground  ankle rise and the lowest vertex, against the same-engine world-bake envelope
//   penetration  past the body's own authored floor, against the same-engine world-bake envelope (the
//                operator's stricter "the body's own IDLE range" is reported as `idleRange` and noted:
//                it is ~0 for every body, and today's world bakes go past it)
//   fidelity     speed and motion against the world-bake envelope; hand travel where both sides have a
//                hand. `energy` is NOT judged on a world bake: the bake returns to rest by construction,
//                so its end-vs-start travel is 0 and the ratio is meaningless.
// start/end are absolute: every same-engine world bake begins and ends exactly on its own rest (125/125 measured
// 0.0), so a fill that pops there is wrong, not "unusual". groundAbove is the null's MAX, not its p95: a cast or a
// jump legitimately lifts the feet off the floor, and a p95 bar refused the DW3->DW3 control (0.062 vs 0.034). The
// floor (groundBelow), penetration, ankle and step stay at p95 — going *through* the floor is never legitimate.
export const WORLD_BARS = Object.freeze({
  idle: Object.freeze({ n: 25, start: 0.25, end: 0.25, step: 2.27, speed: 3.39, motion: 3.00, pen: 0.50, ankle: 0.50, groundBelow: 0.57, groundAbove: 0.15 }),
  hit: Object.freeze({ n: 25, start: 0.25, end: 0.25, step: 0.72, speed: 2.90, motion: 3.00, pen: 0.35, ankle: 0.40, groundBelow: 0.70, groundAbove: 0.15 }),
  death: Object.freeze({ n: 25, start: 0.25, end: null, step: 0.72, speed: 2.90, motion: 3.00, pen: 0.35, ankle: 0.40, groundBelow: 0.70, groundAbove: 0.15 }),
  attack: Object.freeze({ n: 25, start: 0.25, end: 0.25, step: 1.54, speed: 6.15, motion: 3.00, pen: 0.34, ankle: 0.40, groundBelow: 0.57, groundAbove: 0.36 }),
  cast: Object.freeze({ n: 25, start: 0.25, end: 0.25, step: 2.27, speed: 3.39, motion: 2.71, pen: 0.50, ankle: 0.50, groundBelow: 0.57, groundAbove: 0.07 }),
  item: Object.freeze({ n: 25, start: 0.25, end: 0.25, step: 1.54, speed: 6.15, motion: 3.00, pen: 0.34, ankle: 0.40, groundBelow: 0.57, groundAbove: 0.36 }),
});
export const WORLD_BARS_SOURCE = Object.freeze({
  corpus: "DW3->DW3 bakes with bakeRetargetWorld: 25 targets x donors x 5 kinds, 125 bakes, measured 2026-10-21",
  quantile: "p95 of the same-engine world bake for step/speed/motion/pen/ankle/groundBelow; groundAbove is that null's max; start/end are absolute (the blend)",
});

/** max rotation gap of a pose against another frame's pose, over the mapped bones. */
function gapToFrame(model, pose, frame, map) {
  const ref = poseFromChannels(model, frame);
  let v = 0;
  for (let i = 0; i < model.bones.length; i++) {
    if (map && map[i] != null && map[i] < 0) continue;
    v = Math.max(v, ROT_STEP(pose.rot[i], ref.rot[i]));
  }
  return v;
}

/**
 * The verdict for a FILL of `slot` on `model` (the target as it was before the bake) by a world bake.
 * Returns { pass, keys, numbers, bars, notes, kind, slot, owned }.
 */
export function judgeFill(bake, slot, model = null, opts = {}) {
  const kind = kindOfSlot(slot);
  const target = model ?? bake?.model;
  const B = WORLD_BARS[kind] ?? opts.bars ?? null;
  const numbers = bake ? measureSwap(bake, opts) : null;
  const keys = [], notes = [];
  const owned = !!target && playedFrames(target, slot).length >= 2;
  if (!B || !numbers) return { pass: false, keys: ["kind", ...(owned ? ["owned"] : [])], numbers, bars: B, notes: ["no bars / no numbers"], kind, slot, owned };
  if (owned) keys.push("owned");
  const neutral = bake?.metrics?.neutralFrame ?? 0;
  const idleFrame = playedFrames(target, 0)[0] ?? 0;
  const baked = bake.model;
  const frames = playedFrames(baked, bake.table);
  const first = poseFromChannels(baked, frames[0]), last = poseFromChannels(baked, frames[frames.length - 1]);
  const startGap = gapToFrame(baked, first, neutral, bake.map);
  const endGap = gapToFrame(baked, last, neutral, bake.map);
  const restIdle = target ? gapToFrame(target, poseFromChannels(target, neutral), idleFrame) : null;
  numbers.startRest = +startGap.toFixed(3);
  numbers.endRest = +endGap.toFixed(3);
  numbers.restIdle = restIdle == null ? null : +restIdle.toFixed(3);
  numbers.idleRange = { pen: opts.ownIdle?.pen ?? null, ankle: opts.ownIdle?.ankle ?? null, step: opts.ownIdle?.step ?? null };
  if (restIdle != null && restIdle > 0.25) notes.push(`rest-idle: the bake's rest frame is ${restIdle.toFixed(2)} rad from the idle clip's start (K23 neutralFrame)`);
  if (startGap > B.start) keys.push("start");
  if (kind !== "death" && endGap > (B.end ?? 0.25)) keys.push("end");
  if (numbers.covered < 0.55) keys.push("coverage");
  const over = (name, v, bar) => { if (v != null && bar != null && v > bar) keys.push(name); };
  over("step", numbers.step, B.step);
  over("ankle", numbers.ankle, B.ankle);
  over("groundBelow", numbers.groundBelow, B.groundBelow);
  over("groundAbove", numbers.groundAbove, B.groundAbove);
  over("pen", numbers.pen, B.pen);
  // The operator's criteria list does not include the per-bone speed ratio, and on a world bake it is
  // noisy (a bone the donor barely moves gets a correction, and a bird's spare bones inflate it): it is
  // printed, not judged. The absolute pose jump above is the gate.
  if (numbers.speed != null) notes.push(`speed ratio ${numbers.speed} (same-engine world p95 ${B.speed}; printed, not judged)`);
  if (numbers.motion != null && numbers.motion < 0.25) keys.push("motion(frozen)");
  if (numbers.hand != null && numbers.hand < 0.2) keys.push("hand(frozen)");
  else if (numbers.hand == null) notes.push("hand not measurable");
  notes.push("energy is not judged on a world bake (it returns to rest by construction)");
  return { pass: keys.length === 0, keys: [...new Set(keys)], numbers, bars: B, notes, kind, slot, owned };
}

/**
 * THE FILL LADDER: a world bake first, then the K16 role candidates as a fallback, then the current
 * behaviour (a slot the model does not own keeps whatever clip-fallback.js builds today).
 */
export function fillLadder(target, source, clip, slot, { offset = 6000, build = null, ownIdle = null, judgeOpts = {} } = {}) {
  const kind = kindOfSlot(slot);
  const idle = ownIdle ?? ownNumbers(target, { slots: [0] });
  const steps = [];
  const cands = build ? build({ target, source, clip, slot })
    : [() => { const b = bakeRetargetWorld(target, source, clip, { offset }); if (b) { b.source = source; b.method = "world"; } return b; },
       () => bakeRole(target, source, clip, offset, true, "role+ik"),
       () => bakeRole(target, source, clip, offset, false, "role")];
  for (const make of cands) {
    let bake = null;
    try { bake = make(); } catch (e) { steps.push({ method: "throw", pass: false, keys: [String(e?.message || e).slice(0, 80)] }); continue; }
    if (!bake) { steps.push({ method: "?", pass: false, keys: ["no-bake"] }); continue; }
    if (!bake.source) bake.source = source;
    const nums = bake.method === "world" ? null : measureSwap(bake, judgeOpts);
    const v = bake.method === "world"
      ? judgeFill(bake, slot, target, { ...judgeOpts, ownIdle: idle })
      : (nums ? judgeNumbers(nums, kind, { own: ownNumbers(target, judgeOpts), ...judgeOpts }) : { pass: false, keys: ["no-numbers"], numbers: null });
    steps.push({ method: bake.method ?? "?", pass: v.pass, keys: v.keys, numbers: v.numbers });
    if (v.pass) return { pass: true, chosen: bake, method: bake.method ?? "?", steps, fallback: null, kind, slot };
  }
  return { pass: false, chosen: null, method: null, steps, fallback: "keep-own", kind, slot };
}
