import { boneMap as k16BoneMap } from "../digimon-bonemap.js";
import { TAU, normaliseRoots, rolesOf, sample } from "./rig-basics.js";
import type { K16Rig } from "./types.js";
type K16Vec3 = [number, number, number];

interface K16TwoBoneResult {
  elbow: K16Vec3;
  tip: K16Vec3;
  reach: number;
  clamped: boolean;
  straight?: boolean;
  bendDir: number[] | null;
}


// ── K16: the math retarget — role based, scale aware, rest-frame conjugation, IK reach ───────────
//
// bakeRetargetGeometry() above copies the donor's ch2 KEYS onto the target's bones. That is only right
// for a pose-identical twin: it assumes the donor's rest orientation, its limb lengths and its firing
// side are the target's, and it derives the roles from mesh geometry (which fails on the 23 rigs with
// no arm chain and on every body whose limbs are drawn on the torso mesh). K16 replaces the copy with a
// retarget computed per frame in the target's own rest frame, from the K12 bone maps
// (digimon-bonemap.js: authored bone indices, no geometry guessed at runtime):
//
//   roles    target bone -> donor bone by ANATOMY: root, torso, head, mouth, the left/right arm chain,
//            the left/right leg chain, wings, tail. A role the target HAS and the donor LACKS is left at
//            the target's own rest rotation; a target with MORE arms keeps its extra arms on their own
//            idle (they are never mapped), and a donor's extra roles are ignored. Chain joints are
//            matched proportionally, and one donor joint never drives two target joints.
//   lengths  per role chain, the ratio of the target's chain length to the donor's (sum of its own bone
//            lengths, so it is the model's real proportion, not its height).
//   frame    per mapped bone the donor's pose is divided by its OWN rest orientation and the quotient is
//            applied to the TARGET's rest orientation:
//                delta = W_donor_rest^-1 * W_donor(frame)
//                W_t   = W_target_rest * delta             (W = world rotation, real matrices)
//            The donor's joint motion therefore arrives in the target's frame, and at the clip's first
//            frame every bone is exactly at the target's own rest pose (no snap, no inherited lean).
//   scale    the ONLY translation that carries body motion is the root's ch1; it is scaled by the height
//            ratio (target height / donor height). Every other ch1 stays the target's own, so no bone
//            length changes: nothing can stretch.
//   reach    the end effector of each arm (hand/weapon tip) and each leg (ankle) is solved with a bounded
//            analytic TWO-BONE IK after the conjugation: the hand is driven to the point the donor's hand
//            would occupy, scaled by the chain's length ratio; the elbow angle comes from the law of
//            cosines, the reach is clamped inside the chain's own length (|a-b| .. a+b), and the bend
//            plane is the one the conjugated pose already had. The ankle's vertical travel is clamped to
//            K16.ankleShare of body height, so a borrowed cast cannot lift a foot.
//   limits   every joint's departure from its rest orientation is clamped to K16.maxJoint, so a donor
//            joint that sits past the target's plausible range cannot invert the target's limb.
//   mirror   when the donor's FIRING arm is the other side (measured over the clip: which arm's tip
//            travels, with the design's dominant side as the tie-break) and both models' sides are
//            confident (bone map sc != "low"), the arm delta is mirrored across the model's own sagittal
//            plane (S*delta*S, S = diag(-1,1,1)) and the donor's opposite arm chain is the source. A
//            model whose side confidence is LOW never mirrors: it takes the same-side chain, which is
//            mirror-safe by construction (no side assumption is made at all).
//
// The result is the same shape bakeRetargetGeometry() returns, so castGate() and applyCastBake() are
// unchanged and the A10 automatic gate keeps deciding whether a pair is used or the planted cast is kept.
export const K16 = {
  maxJoint: 2.62,        // rad (150 deg): a joint never departs its rest orientation by more than this
  reachSlack: 0.985,     // the IK never asks for more than this share of the chain's own length
  ankleShare: 0.055,     // an ankle may rise/fall by this share of the body height (the gate allows 0.10)
  rootLiftShare: 0.03,   // the borrowed root translation may lift the body by this share of its height
  mirrorMinTravel: 0.10, // an arm must out-travel the other by this share to name the firing side
  ikDeadband: 0.02,      // a limb already within this share of body height of its target is not corrected
  maxIk: 1.40,           // rad: the largest correction a single IK pass may apply to one link
  // K22b reach rule: a pair whose IK clamps on this share of its arm solves is not reaching the donor's
  // points at all, so the bake follows the donor's hand PATH instead (see bakeRetargetByRole's `reach`).
  reachSwitchShare: 0.10,
};

// real row-major 3x3 helpers. A ch2 triple (c0,c1,c2) is the rotation RZ(c2)*RY(c1)*RX(c0) in the
// renderer's own arithmetic (verified against restPose(): identical to 0.0e+0 on every bone).
export const k16mul = (A: number[][], B: number[][]): number[][] => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));

export const k16tr = (A: number[][]): number[][] => A[0].map((_, j) => A.map((r) => r[j]));

export const k16mv = (A, v) => A.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

export const k16dot = (a: number[] | K16Vec3, b: number[] | (number | undefined)[]) => a[0] * b[0]! + a[1] * b[1]! + a[2] * b[2]!;

export const k16sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const k16scale = (a, s: number) => [a[0] * s, a[1] * s, a[2] * s];

export const k16norm = (a) => Math.hypot(a[0], a[1], a[2]);

export const K16_ID = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export const K16_SX = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];

const k16rz = (t: number) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];

const k16ry = (t: number) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];

const k16rx = (t: number) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];

const k16local = (c0: number, c1: number, c2: number) => k16mul(k16rz(c2), k16mul(k16ry(c1), k16rx(c0)));

export const k16perp = (a: number[]) => {
  const t = Math.abs(a[0]!) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const p = [a[1]! * t[2]! - a[2]! * t[1]!, a[2]! * t[0]! - a[0]! * t[2]!, a[0]! * t[1]! - a[1]! * t[0]!];
  const n = k16norm(p);
  return n > 1e-9 ? k16scale(p, 1 / n) : [0, 0, 1];
};

export function k16axisAngle(axis, ang) {
  const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
          [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
          [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}

/** The rotation's axis and angle (identity for a zero rotation). */
export function k16axisOf(M) {
  const c = Math.max(-1, Math.min(1, (M[0][0] + M[1][1] + M[2][2] - 1) / 2));
  const ang = Math.acos(c);
  if (ang < 1e-9) return { axis: [0, 0, 1], ang: 0 };
  if (Math.PI - ang < 1e-6) {
    // 180 deg: the axis is the dominant diagonal
    const d = [M[0][0], M[1][1], M[2][2]];
    const i = d[0] >= d[1] && d[0] >= d[2] ? 0 : (d[1] >= d[2] ? 1 : 2);
    const v = [Math.sqrt(Math.max(0, (M[i][0] + 1) / 2)), Math.sqrt(Math.max(0, (M[i][1] + (i === 1 ? 1 : 0)) / 2)),
               Math.sqrt(Math.max(0, (M[i][2] + (i === 2 ? 1 : 0)) / 2))];
    return { axis: k16perp(v), ang };
  }
  const ax = [M[2][1] - M[1][2], M[0][2] - M[2][0], M[1][0] - M[0][1]];
  const n = k16norm(ax);
  return { axis: n > 1e-9 ? k16scale(ax, 1 / n) : [0, 0, 1], ang };
}

/** Clamp a rotation's angle to `max` (a joint limit applied in the joint's own frame). */
export function k16clampRot(M: number[][], max: number) {
  const { axis, ang } = k16axisOf(M);
  if (ang <= max) return M;
  return k16axisAngle(axis, max);
}

/** Minimal-arc rotation taking direction u onto direction v. */
export function k16fromTo(u, v) {
  const nu = k16norm(u), nv = k16norm(v);
  if (nu < 1e-9 || nv < 1e-9) return K16_ID;
  const a = k16scale(u, 1 / nu), b = k16scale(v, 1 / nv);
  const c = k16dot(a, b);
  if (c > 1 - 1e-9) return K16_ID;
  if (c < -1 + 1e-9) return k16axisAngle(k16perp(a), Math.PI);
  const ax = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const s = k16norm(ax);
  return k16axisAngle(k16scale(ax, 1 / s), Math.atan2(s, c));
}

/** A ch2 triple (in RAW units) -> the real local rotation matrix. */
export const k16FromCh2 = (t) => k16local(t[0] * TAU, t[1] * TAU, t[2] * TAU);

/**
 * Real local rotation -> a ch2 triple in raw units, RZ(c2)*RY(c1)*RX(c0), picked to be the branch
 * nearest `prev`: a ZYX decomposition has a second, equivalent solution (c0+180, 180-c1, c2+180), and
 * flipping between the two between two frames would be read as a 180-deg jump by the gate (speed) and
 * by the renderer (a visible twitch), so the branch closest to the previous key is always taken.
 */
export function k16ToCh2(M, prev = null) {
  const cb = Math.hypot(M[0][0], M[1][0]);
  let c0, c1, c2;
  if (cb > 1e-7) {
    c1 = Math.atan2(-M[2][0], cb);
    c2 = Math.atan2(M[1][0], M[0][0]);
    c0 = Math.atan2(M[2][1], M[2][2]);
  } else {
    c1 = Math.atan2(-M[2][0], cb);
    c2 = Math.atan2(-M[0][1], M[1][1]);
    c0 = 0;
  }
  let t = [c0 / TAU, c1 / TAU, c2 / TAU];
  if (prev) {
    const wrapNear = (x: number, p) => {
      let d = x - p;
      d = ((d % 4096) + 4096) % 4096;
      if (d > 2048) d -= 4096;
      return p + d;
    };
    const alt = [t[0]! + 2048, 2048 - t[1]!, t[2]! + 2048];
    const cost = (v) => Math.abs(v[0] - prev[0]) + Math.abs(v[1] - prev[1]) + Math.abs(v[2] - prev[2]);
    const a = t.map((x, i) => wrapNear(x, prev[i]));
    const b = alt.map((x, i) => wrapNear(x, prev[i]));
    t = cost(a) <= cost(b) ? a : b;
  }
  const norm = (x: number | undefined) => {
    let r = Math.round(x!) % 4096;
    if (r < 0) r += 4096;
    return r >= 2048 ? r - 4096 : r;
  };
  return [norm(t[0]), norm(t[1]), norm(t[2])];
}

/** Every bone's world rotation and world position at `frame` (the renderer's own arithmetic). */
export function k16Pose(model, frame: number) {
  const n = model.num_bones ?? model.bones.length;
  const W = new Array(n).fill(null), P = new Array(n).fill(null);
  const go = (i: number) => {
    const c2 = sample(model.bones[i]?.anim?.ch2, frame);
    const L = k16FromCh2(c2);
    const p = (model.bones[i]?.parent_slot ?? 0) - 1;
    const c1 = sample(model.bones[i]?.anim?.ch1, frame);
    if (p < 0 || p >= n) { W[i] = L; P[i] = [-c1[0], c1[1], -c1[2]]; return; }
    if (!W[p]) go(p);
    W[i] = k16mul(W[p], L);
    const o = k16mv(W[p], c1);
    P[i] = [P[p][0] - o[0], P[p][1] + o[1], P[p][2] - o[2]];
  };
  for (let i = 0; i < n; i++) if (!W[i]) go(i);
  return { W, P };
}

const k16RigCache = new Map();

const k16RestCache = new Map();

export function k16Subtrees(model) {
  const n = model.num_bones ?? model.bones.length;
  const kids = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const p = (model.bones[i]?.parent_slot ?? 0) - 1;
    if (p >= 0 && p < n) kids[p]!.push(i);
  }
  const out = Array.from({ length: n }, () => []);
  const walk = (i, acc) => { acc.push(i); for (const k of kids[i]!) walk(k, acc); return acc; };
  for (let i = 0; i < n; i++) out[i] = walk(i, []);
  return out;
}

/**
 * The anatomical rig of a model: role chains from the K12 bone map when the model has one, else from the
 * geometry heuristics (rolesOf). Shaped for castGate() (arms/legs/props/box/pose) plus the fields the
 * retarget needs (root/torso/head/mouth/wings/tail/dom/side confidence).
 */
export function rigOf(model) {
  const n = model.num_bones ?? model.bones.length;
  const folder = model?.folder ?? null;
  const cacheKey = folder ?? `__${n}`;
  if (folder && k16RigCache.has(cacheKey)) return k16RigCache.get(cacheKey);
  const geo = rolesOf(model);                 // mesh box, weapon props, geometry pose
  const bm = folder ? k16BoneMap(folder) : null;
  const rig = {
    folder, n, box: geo.box, pose: geo.pose, props: geo.props, roots: geo.roots, cape: geo.cape,
    source: bm ? "bonemap" : "geometry",
    root: bm ? (bm.r ?? 0) : (geo.roots[0] ?? 0),
    torso: bm ? (bm.t ?? null) : null,
    head: bm ? (bm.h ?? geo.head) : geo.head,
    mouth: bm ? (bm.m ?? null) : null,
    arms: [], legs: [], wings: [], tail: [],
    dom: bm ? (bm.dom ?? null) : null,
    sc: bm ? (bm.sc ?? null) : null,
  } as K16Rig;
  if (bm) {
    for (const [k, side] of [["aL", "left"], ["aR", "right"]]) if (bm[k]?.length) rig.arms.push({ side, ordinal: 0, chain: bm[k].slice() });
    for (const [k, side] of [["aLe", "left"], ["aRe", "right"]]) (bm[k] ?? []).forEach((c, i) => { if (c?.length) rig.arms.push({ side, ordinal: i + 1, chain: c.slice() }); });
    for (const [k, side] of [["lL", "left"], ["lR", "right"]]) if (bm[k]?.length) rig.legs.push({ side, ordinal: 0, chain: bm[k].slice() });
    for (const [k, side] of [["lL2", "left"], ["lR2", "right"]]) (bm[k] ?? []).forEach((c, i) => { if (c?.length) rig.legs.push({ side, ordinal: i + 1, chain: c.slice() }); });
    for (const [k, side] of [["wL", "left"], ["wR", "right"]]) if (bm[k]?.length) rig.wings.push({ side, ordinal: 0, chain: bm[k].slice() });
    if (bm.tl?.length) rig.tail = bm.tl.slice();
  } else {
    for (const a of geo.arms) rig.arms.push({ side: a.side, ordinal: 0, chain: a.chain.slice() });
    for (const l of geo.legs) rig.legs.push({ side: l.side, ordinal: 0, chain: l.chain.slice() });
  }
  // K22b rule 1: normalise which root is the root ON THIS SIDE, from the rig's own shape. A no-op for a
  // rig whose stored root already carries the legs and which has no second upper-body root.
  const nr = normaliseRoots(rig, model);
  rig.rootRaw = nr.rootRaw;
  rig.torsoRaw = nr.torsoRaw;
  rig.root = nr.root;
  rig.torso = nr.torso;
  rig.roots = nr.roots;
  rig.rootFix = {
    legRoot: nr.legRoots[0] ?? null, upperRoot: nr.upperRoot,
    rawCarriesLegs: nr.legRoots.includes(nr.rootRaw!),
    moved: nr.root !== nr.rootRaw || nr.torso !== nr.torsoRaw,
  };
  if (folder) k16RigCache.set(cacheKey, rig);
  // the bones this rig claims as ROLES (the coverage the retarget can be judged on: a viz bone or an
  // extra arm the design doesn't animate is not a role, and leaving it at rest is correct)
  const roles = new Set([rig.root, rig.torso, rig.head, rig.mouth].filter((v) => v != null && v >= 0));
  for (const a of [...rig.arms, ...rig.legs, ...rig.wings]) for (const b of a.chain) roles.add(b);
  for (const b of rig.tail) roles.add(b);
  rig.roleBones = [...roles];
  return rig;
}

export function k16Rest(model) {
  const key = model?.folder ?? null;
  if (key && k16RestCache.has(key)) return k16RestCache.get(key);
  const p = k16Pose(model, 0);
  if (key) k16RestCache.set(key, p);
  return p;
}

/** Chain length = the sum of the bone-to-bone distances along the chain, in the pose given. */
export function k16ChainLen(P, chain) {
  let L = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = P[chain[i - 1]], b = P[chain[i]];
    if (!a || !b) continue;
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
}

/** Worst per-frame rotation step in a key map (rad): the snap a played clip shows. K22b's tie-break. */
export function k16WorstStep(keys) {
  let worst = 0;
  for (const arr of keys.values()) {
    for (let i = 1; i < arr.length; i++) {
      const d = Math.hypot(arr[i][0] - arr[i - 1][0], arr[i][1] - arr[i - 1][1], arr[i][2] - arr[i - 1][2]);
      if (d > worst) worst = d;
    }
  }
  return worst * TAU;
}

/**
 * The model's own longest LOOPING clip, as a frame span — the motion an unmapped role keeps alive during
 * a bake (K22b rule 4). Read from the model's own timeline, so no clip index is assumed.
 */
export function k16IdleSpan(model) {
  let best = null;
  for (const [idx, t] of (model.timeline ?? []).entries()) {
    const tab = t?.table;
    if (!Array.isArray(tab)) continue;
    let lo = Infinity, hi = -1, loops = false;
    for (const e of tab) {
      const v = e?.value | 0;
      if (v === 0x8000) loops = true;              // the pure loop marker: a playhead index
      if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    if (!loops || !(hi > lo)) continue;
    if (!best || hi - lo > best.hi - best.lo) best = { lo, hi, len: hi - lo + 1, table: idx };
  }
  return best;
}

/**
 * target bone -> donor bone by ROLE. `mirror` swaps the arm sides (the donor's right arm drives the
 * target's left arm). Extra arms of a multi-armed target are deliberately left unmapped.
 */
export function roleBoneMap(T, S, { mirror = false } = {}) {
  const map = new Array(T.n).fill(-1);
  const pairs = [];
  if (S.root >= 0 && T.root >= 0) map[T.root] = S.root;
  for (const [t, s] of [[T.torso, S.torso], [T.head, S.head], [T.mouth, S.mouth]]) {
    // a torso that IS the root is already mapped as the root: mapping it again would overwrite the root
    // rotation with the donor's torso (the K22b bug, one step removed)
    if (t != null && s != null && t >= 0 && s >= 0 && t !== T.root) map[t] = s;
  }
  const chainMap = (tc, sc) => {
    const m = tc.length, n = sc.length;
    const taken = new Set();
    for (let i = 0; i < m; i++) {
      const j = m === 1 ? n - 1 : Math.round((i * (n - 1)) / (m - 1));
      if (taken.has(j)) continue;
      taken.add(j);
      map[tc[i]] = sc[j];
    }
  };
  for (const side of ["left", "right"]) {
    const ss = mirror ? (side === "left" ? "right" : "left") : side;
    const ta = T.arms.find((a) => a.side === side && a.ordinal === 0);
    const sa = S.arms.find((a) => a.side === ss && a.ordinal === 0);
    if (ta && sa) { chainMap(ta.chain, sa.chain); pairs.push({ kind: "arm", side, tc: ta.chain, sc: sa.chain }); }
    const tl = T.legs.find((a) => a.side === side && a.ordinal === 0);
    const sl = S.legs.find((a) => a.side === side && a.ordinal === 0);
    if (tl && sl) { chainMap(tl.chain, sl.chain); pairs.push({ kind: "leg", side, tc: tl.chain, sc: sl.chain }); }
    const tw = T.wings.find((a) => a.side === side && a.ordinal === 0);
    const sw = S.wings.find((a) => a.side === side && a.ordinal === 0);
    if (tw && sw) chainMap(tw.chain, sw.chain);
  }
  if (T.tail?.length && S.tail?.length) chainMap(T.tail, S.tail);
  if (T.cape && S.cape) chainMap(T.cape, S.cape);
  return { map, pairs };
}

/** Which arm the donor's clip actually fires with: the arm whose tip travels most over the clip. */
function k16FiringSide(S, source, lo: number, hi: number) {
  const a = k16Pose(source, lo), b = k16Pose(source, hi);
  const travel: Record<string, number> = {};
  for (const arm of S.arms.filter((x) => x.ordinal === 0)) {
    const tip = arm.chain[arm.chain.length - 1];
    travel[arm.side] = Math.hypot(...k16sub(b.P[tip], a.P[tip]));
  }
  const l = travel.left ?? 0, r = travel.right ?? 0;
  if (l + r > 1e-6) {
    const big = Math.max(l, r), small = Math.min(l, r);
    if (small <= 1e-6 || (big - small) / big >= K16.mirrorMinTravel) return l > r ? "left" : "right";
  }
  return (S.dom === "left" || S.dom === "right") ? S.dom : null;
}

/**
 * Mirror the arm motion? Only when both models are side-CONFIDENT and the donor's firing arm is the
 * other side from the target's own weapon side. A LOW-confidence target never mirrors (mirror-safe).
 */
export function shouldMirror(T, S, source, clip, lo: number, hi: number) {
  if (T.sc === "low" || S.sc === "low") return false;
  const td = T.dom;
  if (td !== "left" && td !== "right") return false;
  const sd = k16FiringSide(S, source, lo, hi);
  return !!sd && sd !== td;
}

/** Bounded analytic two-bone IK: shoulder S0, wanted tip H, link lengths a (S0..elbow) and b.
 *  `hint` is the current elbow direction and `plane` the previous frame's bend direction: near a
 *  straight limb the bend plane is undefined, and without continuity the knee/elbow pops sideways. */
function k16TwoBone(S0: K16Vec3, H: K16Vec3, a: number, b: number, hint: K16Vec3 | null, plane = null): K16TwoBoneResult {
  const d0 = k16sub(H, S0);
  const d = k16norm(d0);
  const maxR = (a + b) * K16.reachSlack;
  const minR = Math.abs(a - b) * 1.02 + 1e-6;
  const dist = Math.min(maxR, Math.max(minR, d));
  const u = d > 1e-9 ? k16scale(d0, 1 / d) : [0, 1, 0];
  const angle = (a * a + dist * dist - b * b) / (2 * a * dist);
  // a limb that reaches its target nearly straight has NO defined bend plane: solving it with the
  // cosine law there picks an arbitrary plane and the elbow pops sideways between frames, so it is
  // solved as a straight chain instead (one rotation, no knee/elbow).
  if (angle >= 0.995 || dist >= (a + b) * 0.995) {
    return {
      elbow: [S0[0] + a * u[0]!, S0[1] + a * u[1]!, S0[2] + a * u[2]!],
      tip: [S0[0] + dist * u[0]!, S0[1] + dist * u[1]!, S0[2] + dist * u[2]!],
      reach: d / Math.max(1e-6, a + b), clamped: Math.abs(dist - d) > 1e-6, straight: true, bendDir: null,
    };
  }
  const cosA = Math.max(-1, Math.min(1, angle));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perpOf = (src: K16Vec3 | null) => (src ? k16sub(src, k16scale(u, k16dot(src, u))) : [0, 0, 0]);
  let v = perpOf(hint);
  if (k16norm(v) < 0.25 * Math.max(1e-6, k16norm(hint || [0, 0, 0]))) v = perpOf(plane);
  if (k16norm(v) < 1e-6) v = k16perp(u);
  v = k16scale(v, 1 / k16norm(v));
  return {
    elbow: [S0[0] + a * (cosA * u[0]! + sinA * v[0]!), S0[1] + a * (cosA * u[1]! + sinA * v[1]!), S0[2] + a * (cosA * u[2]! + sinA * v[2]!)],
    tip: [S0[0] + dist * u[0]!, S0[1] + dist * u[1]!, S0[2] + dist * u[2]!],
    reach: d / Math.max(1e-6, a + b),
    clamped: Math.abs(dist - d) > 1e-6,
    bendDir: v,
  };
}
