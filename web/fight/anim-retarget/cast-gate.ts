import { bakeRetargetGeometry, restPose, rolesOf, sample, shiftPlaylistEntry } from "./rig-basics.js";
import { bakeRetargetByRole } from "./by-role.js";
import {
  k16FromCh2,
  k16Pose,
  k16ToCh2,
  k16axisAngle,
  k16axisOf,
  k16fromTo,
  k16mul,
  k16mv,
  k16tr,
} from "./k16-rig.js";
import { k23Cloud, k23NeutralFrame } from "./world.js";
import type { RetargetBake } from "./types.js";
import type { RetargetModel, RigProp } from "./types.js";
interface HandPointResult {
  bone: number;
  weapon: boolean;
  x: number;
  y: number;
  z: number;
  frame: number;
}

interface HandPointOptions {
  table?: string | null;
  side?: RigProp["side"] | null;
}


/**
 * The retarget entry point. Candidates, best first:
 *   1. the K16 role bake WITH the bounded IK reach correction,
 *   2. the same role bake WITHOUT it (a donor whose own arc needs no correction is closer to its own
 *      motion that way - and a limb the IK cannot reach without a visible pop is better left alone),
 *   3. the A6 geometry bake (rigs with no K12 bone map).
 * The A10 automatic gate is the arbiter: the first candidate it accepts is returned, so a pair is only
 * ever used when its own numbers pass. When none passes, the first candidate is returned and the caller
 * keeps the planted cast, exactly as before.
 */
export function bakeRetarget(target, source, clip: number, { offset = 6000, mirror = null, ...opts } = {}) {
  // A/B switch used by the K16 measurements (tools/check_cast_contract.mjs --geometry) and nothing else:
  // it reproduces the pre-K16 bake without touching any other module.
  if (typeof process !== "undefined" && process.env?.K16_MODE === "geometry") {
    const g: RetargetBake = bakeRetargetGeometry(target, source, clip, { offset });
    if (g) { g.source = source; g.method = "geometry"; }
    return g;
  }
  const tries = [];
  const withIk = bakeRetargetByRole(target, source, clip, { offset, mirror, ik: true, ...opts });
  if (withIk) tries.push(withIk);
  const noIk = bakeRetargetByRole(target, source, clip, { offset, mirror, ik: false, ...opts });
  if (noIk) tries.push(noIk);
  const geo = bakeRetargetGeometry(target, source, clip, { offset });
  if (geo) tries.push(geo);
  if (!tries.length) return null;
  for (const t of tries) {
    t.source = source;
    const verdict = castGate(t);
    t.gate = verdict;
    t.method = t === geo ? "geometry" : (t === withIk ? "role+ik" : "role");
    if (verdict.used) return t;
  }
  return tries[0];
}

// ── A10: the CAST body, and the automatic quality gate that decides whether a pair is used ─────────────
//
// A spell on the disc is a CAST: a planted pose with the weapon raised, a projectile leaving the weapon, a
// strike. The build above already carries a model's own motion for the clips it has, but a model missing
// clip 9 has no cast of its own - its own basic attack (a lunge, a jump, a swing) is the wrong motion.
// The donor the ranker picked for that clip HAS an authored cast (its clip 9), and bakeRetarget() above can
// put the donor's ROTATION keys on this model's bones. What was missing is a way to decide, without a human
// looking at a picture, whether a given (target, donor) pair's retarget is a usable cast.
//
// castGate() is that decision, and it is arithmetic over the two skeletons and their poses:
//   coverage    the share of the target's bones the role map covers, and every limb the cast needs
//               (both arms, both legs, the weapon arm when the target carries a prop) must be mapped
//   reach       per limb, the tip-to-root distance over the clip against the donor's, scaled by height: a
//               retarget that swings a limb far outside the donor's own envelope is not the same motion
//   crossing    an arm/leg tip never crosses the body's centre line (a joint that folds through the torso)
//   speed       per mapped bone, the per-frame rotation step stays within the donor's own (× a bound)
//   planted     the ankle drift stays inside the donor's drift, scaled
//   return      the last pose is close to the model's own rest pose, so the clip ends without a snap
//   motion      the pose leaves the rest pose by a share of the donor's own motion energy (a cast that
//               froze is not a cast)
// A pair that fails ANY metric is not used: the caller keeps the planted own-body cast (clip-fallback.js).
// The thresholds are constants here, not per-pair data; the printout (tools/check_cast_contract.mjs) names
// each metric so a failing row says WHY, and tuning them tunes the gate for every pair at once.
export const CAST_GATE = {
  minCovered: 0.55,      // share of the target's bones with a mapped donor bone
  handLo: 0.20,          // the casting hand/prop travel vs the donor's own, scaled by height
  handHi: 8.00,
  energyLo: 0.25,        // whole-body travel (sum over mapped bones) vs the donor's, scaled
  energyHi: 3.50,
  speedRatio: 2.50,      // per-frame rotation step vs the donor's, same bone, same tick
  speedFloor: 0.25,      // rad: a small absolute step is allowed even when the donor's own joint is still
                         // (a rest-frame retarget legitimately moves a joint the donor holds; the ratio
                         // alone would reject every pair for a correction a player cannot see)
  foldCos: -0.90,        // a joint never folds back onto its own parent segment
  ankleShare: 0.10,      // share of the body height the ankles may travel
  returnGap: 2.60,       // radians between the clip's last pose and the model's rest pose
  motionShare: 0.35,     // share of the donor's motion energy the retarget must keep
  samples: 12,
};

const TAU_R = (Math.PI * 2) / 4096;

const angOf = (ch2, frame: number | undefined) => sample(ch2, frame!).map((v) => v * TAU_R);

const angBetween = (a: number[], b: number[]) => {
  let d = 0;
  for (let i = 0; i < 3; i++) {
    let x = a[i]! - b[i]!;
    while (x > Math.PI) x -= 2 * Math.PI;
    while (x < -Math.PI) x += 2 * Math.PI;
    d += x * x;
  }
  return Math.sqrt(d);
};

/**
 * The point a projectile should leave from: the terminal prop (a weapon's blade/lance/hammer head) when the
 * model carries one, else the tip of the arm on `side`. Taken at the frame where that bone is HIGHEST over
 * the clip's own frame range - a cast raises the weapon, and the highest point of the cast is where the
 * disc's own packs launch (Gallantmon's raw op6 x is his lance bone's x, y is 7424 = above the head).
 * `table` is the baked cast table on the model; without one the rest pose is used.
 */
export function handPoint(model: RetargetModel, { table = null, side = null } = {}): HandPointResult | null {
  if (!model) return null;
  const roles = rolesOf(model);
  const own = roles.props.length
    ? (side ? (roles.props.find((p) => p.side === side) ?? roles.props[0]) : roles.props[0])
    : null;
  let bone = own ? own.bone : null;
  if (bone == null && roles.arms.length) {
    const arm = side ? (roles.arms.find((a) => a.side === side) ?? roles.arms[0]) : roles.arms[0];
    bone = arm!.chain[arm!.chain.length - 1];
  }
  if (bone == null) return null;
  let lo = Infinity, hi = -1;
  const tab = table != null ? model.timeline?.[table]?.table : null;
  if (Array.isArray(tab)) {
    for (const e of tab) {
      const v = e?.value | 0;
      if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  const frames = [];
  if (hi > lo) {
    for (let k = 0; k < 16; k++) frames.push(Math.round(lo + ((hi - lo) * k) / 15));
  } else frames.push(0);
  let best = null;
  for (const f of frames) {
    const p = restPose(model, f).pos[bone];
    if (!best || p[1] < best.y) best = { x: p[0], y: p[1], z: p[2], frame: f };
  }
  return best ? { ...best, bone, weapon: !!own } : null;
}

/**
 * The quality gate for one (target, donor, clip) retarget. `bake` is bakeRetarget()'s result on the target.
 * Returns every metric plus `used`: the pair's cast body is played only when `used` is true.
 */
export function castGate(bake, { samples = CAST_GATE.samples } = {}) {
  const { model: baked, roles } = bake;
  const T = roles.target, S = roles.source;
  const off = bake.offset;
  const tab = baked.timeline?.[bake.table]?.table ?? [];
  let lo = Infinity, hi = -1;
  for (const e of tab) {
    const v = e?.value | 0;
    if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (!(hi > lo)) return { used: false, reason: "empty-table", covered: bake.covered };
  const frames = [];
  for (let k = 0; k < samples; k++) frames.push(Math.round(lo + ((hi - lo) * k) / (samples - 1)));

  const source = bake.source;
  if (!source) return { used: false, reason: "no-source", covered: bake.covered };
  const H = T.box.h || 1, HD = S.box.h || 1;
  const Trest = restPose(baked, 0);

  // coverage: the bones every cast needs, plus the share the map covers
  const need = [];
  for (const side of ["left", "right"]) {
    const ta = T.arms.find((a: { side: string; }) => a.side === side), sa = S.arms.find((a: { side: string; }) => a.side === side);
    const tl = T.legs.find((l: { side: string; }) => l.side === side), sl = S.legs.find((l: { side: string; }) => l.side === side);
    if (ta) need.push({ kind: "arm", side, mapped: !!sa });
    if (tl) need.push({ kind: "leg", side, mapped: !!sl });
  }
  for (const p of T.props) {
    const parent = (T.pose ? 0 : 0) + ((baked.bones[p.bone]?.parent_slot ?? 0) - 1);
    need.push({ kind: "prop", side: p.side, mapped: bake.map[p.bone] >= 0 || (parent >= 0 && bake.map[parent] >= 0) });
  }
  const missing = need.filter((r) => !r.mapped).map((r) => `${r.kind}:${r.side}`);
  const covered = bake.covered;

  // per-frame poses
  const chainOf = (roles2, kind: string, side: string) =>
    (kind === "arm" ? roles2.arms : roles2.legs).find((c: { side: string; }) => c.side === side)?.chain ?? null;
  let speedWorst = 0, ankleDrift = 0, motionT = 0, motionS = 0, returnGap = 0;
  let folds = 0, movedBones = 0, energyT = 0, energyS = 0;
  const baseT = new Map(), baseS = new Map(), rotPrev = new Map(), rotPrevS = new Map();
  const handBone = T.props.length ? (T.props.find((p: { side: string; }) => p.side === "right") ?? T.props[0]).bone
    : (T.arms.find((a: { side: string; }) => a.side === "right") ?? T.arms[0])?.chain.slice(-1)[0];
  // the donor's own casting hand: its prop on the same side, else its arm tip - whichever bone the map used
  const donorHand = (S.props.find((p: { side: string; }) => p.side === "right") ?? S.props[0])?.bone
    ?? (S.arms.find((a: { side: string; }) => a.side === "right") ?? S.arms[0])?.chain.slice(-1)[0];
  let handT = 0, handS = 0;
  const handBaseT = [], handBaseS = [];
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k], sf = f! - off;
    const Tp = restPose(baked, f), Sp = restPose(source, sf);
    if (handBone != null && Tp.pos[handBone]) {
      if (!handBaseT.length) { handBaseT.push(...Tp.pos[handBone]); }
      handT = Math.max(handT, Math.hypot(Tp.pos[handBone][0] - handBaseT[0], Tp.pos[handBone][1] - handBaseT[1], Tp.pos[handBone][2] - handBaseT[2]));
      const mh = bake.map[handBone];
      if (donorHand != null && Sp.pos[donorHand]) {
        if (!handBaseS.length) handBaseS.push(...Sp.pos[donorHand]);
        handS = Math.max(handS, Math.hypot(Sp.pos[donorHand][0] - handBaseS[0], Sp.pos[donorHand][1] - handBaseS[1], Sp.pos[donorHand][2] - handBaseS[2]));
      } else if (mh >= 0 && Sp.pos[mh]) {
        if (!handBaseS.length) handBaseS.push(...Sp.pos[mh]);
        handS = Math.max(handS, Math.hypot(Sp.pos[mh][0] - handBaseS[0], Sp.pos[mh][1] - handBaseS[1], Sp.pos[mh][2] - handBaseS[2]));
      }
    }
    for (let i = 1; i < baked.bones.length; i++) {
      const m = bake.map[i];
      if (m < 0) continue;
      if (!baseT.has(i)) { baseT.set(i, Tp.pos[i]); baseS.set(i, Sp.pos[m]); }
      const b0 = baseT.get(i), s0 = baseS.get(i);
      const dt = Math.hypot(Tp.pos[i][0] - b0[0], Tp.pos[i][1] - b0[1], Tp.pos[i][2] - b0[2]);
      const ds = Math.hypot(Sp.pos[m][0] - s0[0], Sp.pos[m][1] - s0[1], Sp.pos[m][2] - s0[2]);
      if (ds > 0.01 * H) movedBones++;
      if (k === frames.length - 1) { energyT += dt; energyS += ds; }
      // a joint never folds back onto its own parent segment
      const par = (baked.bones[i].parent_slot ?? 0) - 1;
      const kids = baked.bones.map((b, j) => ((b.parent_slot ?? 0) - 1 === i ? j : -1)).filter((j: number) => j >= 0);
      if (par >= 0 && kids.length === 1) {
        const u = [Tp.pos[i][0] - Tp.pos[par][0], Tp.pos[i][1] - Tp.pos[par][1], Tp.pos[i][2] - Tp.pos[par][2]];
        const v = [Tp.pos[kids[0]][0] - Tp.pos[i][0], Tp.pos[kids[0]][1] - Tp.pos[i][1], Tp.pos[kids[0]][2] - Tp.pos[i][2]];
        const lu = Math.hypot(...u), lv = Math.hypot(...v);
        if (lu > 1 && lv > 1) {
          const c = (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (lu * lv);
          if (c < CAST_GATE.foldCos) folds++;
        }
      }
      // rotation speed, same bone, same tick, against the donor
      const a = angOf(baked.bones[i].anim?.ch2, f);
      const b = angOf(source.bones[m].anim?.ch2, sf);
      const prev = rotPrev.get(i), prevS = rotPrevS.get(i);
      if (prev && prevS) speedWorst = Math.max(speedWorst, angBetween(a, prev) / Math.max(CAST_GATE.speedFloor, angBetween(b, prevS)));
      rotPrev.set(i, a);
      rotPrevS.set(i, b);
      if (k > 0) {
        motionT = Math.max(motionT, angBetween(a, angOf(baked.bones[i].anim?.ch2, lo)));
        motionS = Math.max(motionS, angBetween(b, angOf(source.bones[m].anim?.ch2, lo - off)));
      }
    }
    // feet: the ankle's travel against its own rest height
    for (const side of ["left", "right"]) {
      const tc = chainOf(T, "leg", side);
      if (!tc) continue;
      ankleDrift = Math.max(ankleDrift, Math.abs(Tp.pos[tc[tc.length - 1]][1] - Trest.pos[tc[tc.length - 1]][1]));
    }
    // return gap: last pose against the model's own rest pose
    if (k === frames.length - 1) {
      for (let i = 1; i < baked.bones.length; i++) {
        if (bake.map[i] < 0) continue;
        returnGap = Math.max(returnGap, angBetween(angOf(baked.bones[i].anim?.ch2, f), angOf(baked.bones[i].anim?.ch2, 0)));
      }
    }
  }
  const ankleShare = ankleDrift / H;
  const scale = H / HD;
  const handRatio = handS > 1 ? handT / (handS * scale) : 1;
  const energyRatio = energyS > 1 ? energyT / (energyS * scale) : 1;
  const metrics = {
    covered: +covered.toFixed(3),
    missing,
    hand: +handRatio.toFixed(2),
    energy: +energyRatio.toFixed(2),
    moved: movedBones,
    folds,
    speed: +speedWorst.toFixed(2),
    ankle: +ankleShare.toFixed(3),
    returnGap: +returnGap.toFixed(2),
    motion: +(motionT / Math.max(0.02, motionS)).toFixed(2),
  };
  const reasons = [];
  if (missing.length) reasons.push(`unmapped(${missing.join(",")})`);
  if (covered < CAST_GATE.minCovered) reasons.push("coverage");
  if (handRatio > CAST_GATE.handHi || handRatio < CAST_GATE.handLo) reasons.push("hand");
  if (energyRatio > CAST_GATE.energyHi || energyRatio < CAST_GATE.energyLo) reasons.push("energy");
  if (folds > 0) reasons.push("fold");
  if (speedWorst > CAST_GATE.speedRatio) reasons.push("speed");
  if (ankleShare > CAST_GATE.ankleShare) reasons.push("ankle");
  if (returnGap > CAST_GATE.returnGap) reasons.push("return");
  if (metrics.motion < CAST_GATE.motionShare) reasons.push("motion");
  return { used: reasons.length === 0, reasons, ...metrics };
}

/**
 * Retarget `clip`'s body table from `source` onto `target` IN PLACE (the live model object the renderer
 * draws) when the gate passes. Adds the baked table at a free index and returns { table, offset, gate };
 * null when the pair's retarget is not used (the caller keeps the planted own-body cast).
 * The bake is memory only: the model object is a per-load copy, never written to disk.
 */
export function applyCastBake(target, source, clip: number, { offset = null } = {}) {
  const from = Math.max(0, (target.timeline?.length ?? 0));
  let table = Math.max(62, from);
  while (target.timeline?.[table]?.table) table++;
  const off = offset ?? 6000 + 4000 * (target.__castBakes ?? 0);
  const bake = bakeRetarget(target, source, clip, { offset: off });
  if (!bake) return null;
  bake.source = source;
  const bakedTable = bake.table;
  bake.model!.timeline[table] = bake.model!.timeline[bakedTable];
  bake.table = table;
  const gate = castGate(bake);
  if (!gate.used) return { table: null, offset: off, gate };
  // write the bake onto the live model: appended ch2 keys + the re-based playlist at `table`
  for (let i = 0; i < target.bones.length; i++) {
    const b = bake.model!.bones[i];
    if (b !== target.bones[i]) target.bones[i] = b;
  }
  if (!target.timeline) target.timeline = [];
  target.timeline[table] = bake.model!.timeline[bakedTable];
  target.__castBakes = (target.__castBakes ?? 0) + 1;
  return { table, offset: off, gate, map: bake.map, covered: bake.covered };
}

/**
 * The pose/rotation primitives the generic-motion generator (generic-motion.js) shares with the retarget.
 * Exported only so a second baker can use the SAME renderer-faithful arithmetic; nothing here changes behaviour.
 */
export const MOTION_KIT = {
  sample, k16Pose, k16FromCh2, k16ToCh2, k16mul, k16tr, k16mv, k16fromTo, k16axisAngle, k16axisOf,
  k23Cloud, k23NeutralFrame, shiftPlaylistEntry,
};
