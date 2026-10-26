// dwr.mjs — the DW3 rig layer of the K26d motion-language prototype.
// In the repo since 2026-10-26 (from the private research prototype): paths come from ./paths.mjs, the logic is unchanged.
//
// Everything here is derived from data that already exists: the pack (anim.json), the body atlas
// (bodies.json, K26a) and the proven pose math of the repo's anim-retarget.js (imported READ-ONLY).
// No file of the game is modified.
//
// Frame (the renderer's own, documented in firing-axis.js): +X = the character's RIGHT, +Y = DOWN,
// +Z = FORWARD (the way the pack faces once the D(180) root flip is baked in). All rotations below are
// expressed in this VISUAL frame and converted to the channel frame with the F·R·F conjugation the
// repo uses (generic-motion.js FDF). All distances are model units; `H` = the body height at the
// neutral pose, so every length in a motion can be written as a fraction of H.
import fs from "node:fs";
import { RIGS as ATLAS, modelPath, fightModule } from "./paths.mjs";

const R = await import(fightModule("anim-retarget.js"));
const SM = await import(fightModule("side-mirror.js"));
const LP = await import(fightModule("launch-plan.js"));
export const K = R.MOTION_KIT;
export const TAU = (Math.PI * 2) / 4096;          // PS1 angle unit: 4096 = 360 deg
export const DEG = Math.PI / 180;
export const ARENA_HALF = LP.ARENA_HALF;

// ── tiny row-major 3×3 helpers (same convention as MOTION_KIT) ──────────────────────────────
export const mul = K.k16mul, tr = K.k16tr, mv = K.k16mv;
export const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const F = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]];
export const FLIP = F;
export const FDF = (M) => mul(F, mul(M, F));        // visual rotation -> channel-frame rotation
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const l = len(a); return l > 1e-9 ? scl(a, 1 / l) : [0, 0, 0]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const ss = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
export const rot = (axis, radians) => K.k16axisAngle(unit(axis), radians);
export const fromTo = (u, v) => K.k16fromTo(u, v);

let ATLAS_CACHE = null;
export function atlas() { return (ATLAS_CACHE ??= JSON.parse(fs.readFileSync(ATLAS, "utf8"))); }

/**
 * The pack's neutral standing frame = the FIRST frame of timeline table 0 (the normal idle).
 * NOT the repo's k23NeutralFrame(): that returns the first frame of timeline[1], and the fight code
 * (web/fight/actor-animator.js `baseTable`: "0 = the normal idle, 1 = the low-HP stance") says table 1
 * is the badly-hurt stance. Measured on 6 packs, table 1's first frame is a hunched pose 0.11-0.44 H
 * smaller than table 0's (Meramon H 4481 -> 3699, mean bone moved 682 units). The repo is not edited.
 */
export function neutralFrame(model) {
  let lo = Infinity;
  for (const e of model?.timeline?.[0]?.table ?? []) { const v = e?.value | 0; if (v >= 0 && v < 0x8000 && v < lo) lo = v; }
  return Number.isFinite(lo) ? lo : 0;
}

/** Load a pack + its atlas entry, and measure the rest pose (the neutral idle frame). */
export function loadBody(folder, { facing = "auto" } = {}) {
  const path = modelPath(folder);
  const model = JSON.parse(fs.readFileSync(path, "utf8"));
  const a = atlas().models[folder];
  if (!a) throw new Error(`no atlas entry for ${folder}`);
  const neutral = neutralFrame(model);
  const rest = K.k16Pose(model, neutral);
  const cloud = K.k23Cloud(model, rest);
  // FACING LAW (2026-10-23, from the engine, not the atlas): every DW3 battle model faces +Z of the k16Pose visual
  // frame toward its opponent, on both sides and whether the pack was built as an enemy or a player
  // (battle-presentation.ts arenaPlacement: one rotY per side for all models; battle3d.js: player yaw 0, enemy yaw PI;
  // op2 mode 4 only turns slot 12 by 180 and back, and small aim turns). bodies.json facing.az is a head-over-torso
  // heuristic and is NOT used ("auto" = 0). A scene may still say "facing <deg>" but must say why in a note.
  const az = facing === "auto" ? 0 : +facing;
  const body = {
    folder, model, a, neutral, rest, cloud,
    n: model.num_bones, H: cloud.H, floorY: cloud.floor,
    mass: cloud, hips: [0, 0, 0],
    par: model.bones.map((b) => ((b.parent_slot | 0) > 0 ? (b.parent_slot | 0) - 1 : -1)),
    az, side: SM.authoredSide(model), homeZ: LP.homeLine(model),
    contact: a.ground?.contact ?? null,
    chains: a.chains || {}, boneList: a.boneList, sites: a.sites || {}, plan: a.plan, cls: a.class,
    massCentre: () => (a.mass?.c ? [a.mass.c[0], a.mass.c[1], a.mass.c[2]] : [0, 0, cloud.mz]),
  };
  // the hips = the average of the leg-chain roots (the pivot a lean turns the upper body about)
  const legRoots = [body.chains.legL, body.chains.legR].filter(Boolean).map((c) => c[0]);
  body.hips = legRoots.length
    ? scl(legRoots.reduce((acc, b) => add(acc, rest.P[b]), [0, 0, 0]), 1 / legRoots.length)
    : rest.P[body.chains.trunk?.[0] ?? 0];
  body.order = orderOf(body);
  // a held weapon: the hand bone whose mesh reaches far beyond a hand (a sword, a staff). u = the unit axis from the
  // bone origin to its farthest vertex (the blade direction in the bone's own frame), tip = that vertex.
  body.weapon = null;
  for (const key of ["armR", "armL"]) {
    const ch = body.chains[key];
    if (!ch?.length) continue;
    const h = ch[ch.length - 1];
    const vs = model.bones[h]?.verts || [];
    let far = 0, tip = null;
    for (const v of vs) { const d = Math.hypot(v[0], v[1], v[2]); if (d > far) { far = d; tip = v; } }
    if (tip && far > 0.35 * body.H && (!body.weapon || far > body.weapon.len)) {
      body.weapon = { bone: h, chain: key, len: far, tip: [tip[0], tip[1], tip[2]], u: unit([tip[0], tip[1], tip[2]]) };
    }
  }
  // tallest/lowest vertex of the rest pose (for "feet on the floor" checks in body heights)
  return body;
}

function orderOf(body) {
  const { n, par } = body;
  const kids = Array.from({ length: n }, () => []);
  par.forEach((p, i) => { if (p >= 0) kids[p].push(i); });
  const out = [], seen = new Set();
  const go = (i) => { if (seen.has(i)) return; seen.add(i); out.push(i); kids[i].forEach(go); };
  for (let i = 0; i < n; i++) go(i);
  return out;
}

/** shortest-arc easing of a rotation vector (axis·angle) so interpolation never takes the long way */
function lerpRot(a, b, t) {
  const A = { axis: a.axis, ang: a.ang }, B = { axis: b.axis, ang: b.ang };
  if (A.ang < 1e-9) A.axis = B.axis;
  if (B.ang < 1e-9) B.axis = A.axis;
  let d = A.axis[0] * B.axis[0] + A.axis[1] * B.axis[1] + A.axis[2] * B.axis[2];
  let angB = B.ang;
  if (d < 0) { angB = -B.ang; }
  const ang = A.ang + (angB - A.ang) * t;
  // axis: nlerp of the two axes along the shorter arc
  const ax = unit(lerp3(A.axis, scl(B.axis, d < 0 ? -1 : 1), t));
  return rot(ax, ang);
}

// ── the pose spec ────────────────────────────────────────────────────────────────────────────
/**
 * A pose is a description in the body's own frame (all angles in DEGREES, all lengths as H fractions):
 *   lean: {p,y,r}      torso+head above the hips, p>0 = lean FORWARD, y>0 = turn RIGHT, r>0 = right side down
 *   head: {p,y,r}      the head bone alone, same signs
 *   turn: deg          the whole body yawed about the vertical through the hips, >0 = to its right
 *   shift: [x,y,z]     the whole body moved, +x right, +y DOWN, +z forward (H fractions)
 *   flip: {axis, deg}  the whole body rotated rigidly about its mass centre (a flip/tumble)
 *   ground: 0..1       how much of "the lowest vertex sits on the floor" correction to apply
 *   aim: {chain: {dir:[x,y,z], amt}}   a limb turned rigidly from its rest direction toward a world direction
 *   joint: {boneIndex: {p,y,r}}        extra Euler on one bone in its own (body) frame
 *   wrist: {chain: deg}                a bend at the last joint of a chain (elbow/knee style)
 *   legs: {chain: {off:[x,y,z], air:0..1, tuck:[x,y,z]}}   foot placement (IK target, H fractions)
 */
export function blankPose(body) {
  return { lean: { p: 0, y: 0, r: 0 }, head: { p: 0, y: 0, r: 0 }, turn: 0, shift: [0, 0, 0],
    flip: { axis: [1, 0, 0], deg: 0 }, ground: 1, aim: {}, joint: {}, bend: {}, legs: {}, blade: {}, follow: {}, plant: 0, knee: {}, lift: 0, anchor: [], anchorW: 0, sink: 0 };
}
const lerpN = (a, b, t) => a + (b - a) * t;
// direction blend that never collapses through the origin: two directions more than ~140 degrees apart (hanging down ->
// pointing up) are joined through the body's FORWARD axis (a front raise), each half a stable lerp
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function dirMix(a, b, t) {
  if (dotv(unit(a), unit(b)) > -0.75) return unit(lerp3(a, b, t));
  // route through the front for hanging<->overhead, but through DOWN when both ends are low/horizontal (a swing from
  // behind the back to the front goes past the hip, not through the origin of a front lerp)
  const m = unit(a)[1] + unit(b)[1] > 0.25 ? [0, 1, 0] : [0, 0, 1];
  return t < 0.5 ? unit(lerp3(a, m, t * 2)) : unit(lerp3(m, b, t * 2 - 1));
}
// the rest direction of a limb chain, written in the INPUT frame (the frame the scene's direction words use)
export function kneeBoneOf(body, key) {
  const ch = body.chains?.[key];
  if (!ch || ch.length < 3) return null;
  const y = (c, k) => body.rest.P[c[k]][1];
  const mid = (c) => (y(c, 0) + y(c, c.length - 1)) / 2;
  // a limb pair (armL/armR, legL/legR) of the same length uses ONE index for both sides (so the two knees are the same bone), the
  // one whose joint height is nearest the halfway height summed over both sides
  const partnerKey = { armL: "armR", armR: "armL", legL: "legR", legR: "legL" }[key];
  const pc = partnerKey ? body.chains?.[partnerKey] : null;
  const pair = pc && pc.length === ch.length;
  let bi = 1, bd = Infinity;
  for (let i = 1; i < ch.length - 1; i++) {
    const d = Math.abs(y(ch, i) - mid(ch)) + (pair ? Math.abs(y(pc, i) - mid(pc)) : 0);
    if (d < bd) { bd = d; bi = i; }
  }
  return ch[bi];
}

function restChainDir(body, key) {
  const ch = body.chains?.[key];
  if (!ch || ch.length < 2) return null;
  const d = unit(sub(body.rest.P[ch[ch.length - 1]], body.rest.P[ch[0]]));
  return mv(rot([0, 1, 0], -(body.az || 0) * DEG), d);
}
function restBladeDir(body) {
  const w = body.weapon;
  if (!w) return null;
  const d = unit(mv(F, mv(body.rest.W[w.bone], w.u)));
  return mv(rot([0, 1, 0], -(body.az || 0) * DEG), d);
}

// ── rotations as quaternions: blend joints along the SHORT way, never by averaging angle triples (an euler triple near its gimbal pole spins the bone) ──
export function matToQuat(R) {
  const t = R[0][0] + R[1][1] + R[2][2]; let w, x, y, z;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (R[2][1] - R[1][2]) / s; y = (R[0][2] - R[2][0]) / s; z = (R[1][0] - R[0][1]) / s; }
  else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) { const s = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2; w = (R[2][1] - R[1][2]) / s; x = s / 4; y = (R[0][1] + R[1][0]) / s; z = (R[0][2] + R[2][0]) / s; }
  else if (R[1][1] > R[2][2]) { const s = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2; w = (R[0][2] - R[2][0]) / s; x = (R[0][1] + R[1][0]) / s; y = s / 4; z = (R[1][2] + R[2][1]) / s; }
  else { const s = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2; w = (R[1][0] - R[0][1]) / s; x = (R[0][2] + R[2][0]) / s; y = (R[1][2] + R[2][1]) / s; z = s / 4; }
  const n = Math.hypot(w, x, y, z) || 1; return [w / n, x / n, y / n, z / n];
}
export function quatToMat(q) {
  const [w, x, y, z] = q, n = Math.hypot(w, x, y, z) || 1, a = w / n, b = x / n, c = y / n, d = z / n;
  return [[1 - 2 * (c * c + d * d), 2 * (b * c - a * d), 2 * (b * d + a * c)], [2 * (b * c + a * d), 1 - 2 * (b * b + d * d), 2 * (c * d - a * b)], [2 * (b * d - a * c), 2 * (c * d + a * b), 1 - 2 * (b * b + c * c)]];
}
export function slerpQ(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b;
  if (d < 0) { d = -d; bb = b.map((v) => -v); }
  if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i] - v) * t); const n = Math.hypot(...r) || 1; return r.map((v) => v / n); }
  const th = Math.acos(d), s = Math.sin(th), k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s;
  return a.map((v, i) => v * k0 + bb[i] * k1);
}

export function mixPose(A, B, t, body = null) {
  const out = blankPose();
  for (const k of ["p", "y", "r"]) out.lean[k] = lerpN(A.lean[k], B.lean[k], t);
  for (const k of ["p", "y", "r"]) out.head[k] = lerpN(A.head[k], B.head[k], t);
  out.turn = lerpN(A.turn, B.turn, t);
  out.shift = lerp3(A.shift, B.shift, t);
  out.flip = { axis: unit(lerp3(A.flip.axis, B.flip.axis, t)), deg: lerpN(A.flip.deg, B.flip.deg, t) };
  out.ground = lerpN(A.ground, B.ground, t);
  out.plant = lerpN(A.plant || 0, B.plant || 0, t);
  out.lift = lerpN(A.lift || 0, B.lift || 0, t);
  out.anchorW = lerpN(A.anchorW || 0, B.anchorW || 0, t);
  out.sink = lerpN(A.sink || 0, B.sink || 0, t);
  out.anchor = [...new Set([...((A.anchorW || 0) > 0 ? A.anchor || [] : []), ...((B.anchorW || 0) > 0 ? B.anchor || [] : [])])];
  for (const k of new Set([...Object.keys(A.knee || {}), ...Object.keys(B.knee || {})])) out.knee[k] = lerpN((A.knee || {})[k] || 0, (B.knee || {})[k] || 0, t);
  for (const ch of new Set([...Object.keys(A.aim), ...Object.keys(B.aim)])) {
    let a = A.aim[ch];
    if (!a) {
      // first use of this chain: if the target is a long way from where the limb hangs, start FROM the rest direction at
      // full amount (so the blend can route through the front); a short turn keeps the plain amount ramp
      const rd = body && restChainDir(body, ch);
      a = rd && dotv(unit(rd), unit(B.aim[ch].dir)) < -0.4 ? { dir: rd, amt: 1 } : { dir: B.aim[ch].dir, amt: 0 };
    }
    const b = B.aim[ch] || { dir: a.dir, amt: 0 };
    out.aim[ch] = { dir: dirMix(a.dir, b.dir, t), amt: lerpN(a.amt, b.amt, t) };
  }
  for (const ch of new Set([...Object.keys(A.blade || {}), ...Object.keys(B.blade || {})])) {
    let a = (A.blade || {})[ch];
    if (!a) {
      const rd = body && restBladeDir(body);
      a = rd && dotv(unit(rd), unit(B.blade[ch].dir)) < 0.5 ? { dir: rd, amt: 1 } : { dir: B.blade[ch].dir, amt: 0 };
    }
    const b = (B.blade || {})[ch] || { dir: a.dir, amt: 0 };
    out.blade[ch] = { dir: dirMix(a.dir, b.dir, t), amt: lerpN(a.amt, b.amt, t) };
  }
  for (const k of new Set([...Object.keys(A.follow || {}), ...Object.keys(B.follow || {})])) {
    const a = (A.follow || {})[k] || { ...B.follow[k], amt: 0, spin: 0 }, b = (B.follow || {})[k] || { ...a, amt: 0, spin: 0 };
    out.follow[k] = { hand: b.hand, off: lerp3(a.off, b.off, t), amt: lerpN(a.amt, b.amt, t), spin: lerpN(a.spin || 0, b.spin || 0, t) };
  }
  for (const ch of new Set([...Object.keys(A.bend), ...Object.keys(B.bend)])) {
    const a = A.bend[ch] || { deg: 0, toward: B.bend[ch]?.toward }, b = B.bend[ch] || { deg: 0, toward: a.toward };
    out.bend[ch] = { deg: lerpN(a.deg, b.deg, t), toward: unit(lerp3(a.toward || [0, 0, 1], b.toward || [0, 0, 1], t)) };
  }
  const jq = (e) => (e ? (e.q ?? matToQuat(euler(e.p, e.y, e.r))) : [1, 0, 0, 0]);
  for (const b of new Set([...Object.keys(A.joint), ...Object.keys(B.joint)])) out.joint[b] = { q: slerpQ(jq(A.joint[b]), jq(B.joint[b]), t) };   // a joint is a rotation: blend it as one
  for (const ch of new Set([...Object.keys(A.legs), ...Object.keys(B.legs)])) {
    const a = A.legs[ch] || { off: [0, 0, 0], air: 0, tuck: [0, 0, 0] }, c = B.legs[ch] || a;
    out.legs[ch] = { off: lerp3(a.off, c.off, t), air: lerpN(a.air, c.air, t), tuck: lerp3(a.tuck, c.tuck, t) };
  }
  return out;
}

/** euler about visual axes in the order yaw(Y) · roll(Z) · pitch(X), pitch>0 = forward/down */
export function euler(p, y, r) {
  return mul(rot([0, 1, 0], y * DEG), mul(rot([0, 0, 1], r * DEG), rot([1, 0, 0], -p * DEG)));
}

// ── twist-free aim for arms (K28) ──────────────────────────────────────────────────────────
// fromTo() from the REST direction is the shortest turn, but for an arm going from hanging down to pointing up (nearly
// opposite vectors) its axis is ill-conditioned: the arm swings up sideways and rolls about its own length (shoulders
// merge, arms cross); a closed-form front-raise (Rz*Rx) flips the roll by 180 degrees when the arm points forward.
// So an arm is moved in SMALL steps: each tick turns the previous tick's orientation by the shortest turn from the
// previous direction to the new one (parallel transport). A planar path (down -> forward -> up) then adds no roll at
// all. Needs the ticks in order; a repeated call with the same direction changes nothing.
export let SAG = false;
const aimState = new Map();
export const setSagittal = (v) => { SAG = !!v; aimState.clear(); };
export function transportR(chainKey, d0, d1) {
  const st = aimState.get(chainKey) || { d: d0, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
  const step = fromTo(st.d, d1);
  const R = mul(step, st.R);
  aimState.set(chainKey, { d: d1, R });
  return R;
}

/** Solve one pose to world rotations/positions ({W: mat3 per bone, P: position per bone}). */
export function solvePose(body, pose, { azShift = body.az, _noBlade = false } = {}) {
  const { n, par, order, rest } = body;
  const Wr = rest.W, Pr = rest.P;
  // 1. per-bone visual rotation requests, in the order they compose (later = applied on top)
  const req = new Map();      // bone -> {R, pivot(REST coords)}
  const put = (b, Rm, pivot) => { if (b == null || b < 0) return; const cur = req.get(b); req.set(b, { R: cur ? mul(Rm, cur.R) : Rm, pivot: pivot ?? cur?.pivot ?? null }); };
  // the direction words are given in the ATLAS facing frame; az turns them into the model's own frame
  const azM = rot([0, 1, 0], (azShift || 0) * DEG);
  const dirIn = (d) => mv(azM, unit(d));
  // whole-body yaw (turn) — about the vertical through the hips
  if (pose.turn) for (const c of Object.values(body.chains)) if (c?.length) put(c[0], rot([0, 1, 0], pose.turn * DEG), body.hips);
  // torso lean about the hips: the trunk root, plus any separate head chain that does not hang off it
  if (pose.lean.p || pose.lean.y || pose.lean.r) {
    const Rl = euler(pose.lean.p, pose.lean.y, pose.lean.r);
    const trunk = body.chains.trunk || [];
    put(trunk[0], Rl, body.hips);
  }
  if (pose.head.p || pose.head.y || pose.head.r) {
    const hb = body.sites?.head?.bone ?? body.chains.trunk?.[1];
    if (hb != null) put(hb, euler(pose.head.p, pose.head.y, pose.head.r), null);
  }
  // limb aims: turn the chain rigidly from its rest direction toward the asked direction
  for (const [ch, spec] of Object.entries(pose.aim)) {
    const chain = body.chains[ch];
    if (!chain || chain.length < 2 || !spec || spec.amt <= 1e-4) continue;
    const root = chain[0], tip = chain[chain.length - 1];
    const d0 = unit(sub(Pr[tip], Pr[root]));
    const d1 = dirIn(spec.dir);
    const R = SAG && ch.startsWith("arm") ? transportR(ch, d0, d1) : fromTo(d0, d1);
    put(root, lerpRot({ axis: [0, 0, 1], ang: 0 }, K.k16axisOf(R), Math.min(1, spec.amt)), null);
  }
  // elbow / knee: bend the last joint of a chain toward a world direction (default: forward)
  for (const [ch, spec] of Object.entries(pose.bend)) {
    const chain = body.chains[ch];
    if (!chain || chain.length < 2 || !spec || !spec.deg) continue;
    // the chain's MIDDLE joint (elbow / knee), as motion-language.md says; the old code took the second-to-last bone, which on a
    // 4-bone leg is the ANKLE
    const b = kneeBoneOf(body, ch) ?? chain[chain.length - 2];
    const prev = chain[Math.max(0, chain.indexOf(b) - 1)];
    if (b === prev) continue;
    const d = unit(sub(Pr[b], Pr[prev]));                       // the bone's own rest direction
    const toward = dirIn(spec.toward || [0, 0, 1]);
    let hinge = unit(crossVec(d, toward));
    if (len(hinge) < 0.3) hinge = unit(crossVec(d, [0, 0, 1]));  // bone already points that way: any hinge
    put(b, rot(hinge, spec.deg * DEG), null);
  }
  // a real KNEE: flex the middle joint of a leg chain (the shin swings BACK about the lateral axis); `bend` acts on the
  // second-to-last bone, which on a leg is the ANKLE
  for (const [ch, deg] of Object.entries(pose.knee || {})) {
    if (!deg) continue;
    const kb = kneeBoneOf(body, ch);
    if (kb == null) continue;
    put(kb, rot(mv(azM, [1, 0, 0]), -deg * DEG), null);
  }
  // per-bone extra rotation
  for (const [b, e] of Object.entries(pose.joint)) {
    put(+b, e.q ? quatToMat(e.q) : euler(e.p, e.y, e.r), null);
  }
  // the held weapon: turn the hand bone so the BLADE points along a world direction (the arm pose is solved first)
  if (!_noBlade && pose.blade && Object.keys(pose.blade).length && body.weapon) {
    const p0 = solvePose(body, { ...pose, blade: {} }, { azShift, _noBlade: true });
    for (const spec of Object.values(pose.blade)) {
      if (!spec || spec.amt <= 1e-4) continue;
      const h = body.weapon.bone;
      const cur = unit(mv(F, mv(p0.W[h], body.weapon.u)));   // channel frame -> visual frame
      const D = fromTo(cur, dirIn(spec.dir));
      put(h, lerpRot({ axis: [0, 0, 1], ang: 0 }, K.k16axisOf(D), Math.min(1, spec.amt)), null);
    }
  }
  // a carried part (a shield held by a hand): where the part should be = the hand + an offset; blended by amt from where
  // the part normally sits. Solved against a first pass without it (the part is a leaf: nothing else moves with it).
  const carry = new Map();
  for (const [k, spec] of Object.entries(pose.follow || {})) if (spec && Math.abs(spec.spin || 0) > 1e-4) put(+k, rot([0, 1, 0], spec.spin * DEG), null);
  if (!_noBlade && pose.follow && Object.keys(pose.follow).length) {
    const p0 = solvePose(body, { ...pose, follow: {}, blade: {} }, { azShift, _noBlade: true });
    for (const [k, spec] of Object.entries(pose.follow)) {
      if (!spec || spec.amt <= 1e-4) continue;
      const bone = +k;
      const tgt = add(p0.P[spec.hand], scl(mv(azM, spec.off), body.H));   // off is in body heights, not a unit direction
      carry.set(bone, scl(sub(tgt, p0.P[bone]), Math.min(1, spec.amt)));
    }
  }
  // keep the feet FLAT: after a leg has been aimed and bent, turn each foot back so its orientation in the world is its rest
  // orientation (otherwise rotating the whole leg outward/forward leaves the foot pointing down, off the floor)
  if (!_noBlade && (pose.plant || 0) > 1e-4) {
    const p0 = solvePose(body, { ...pose, plant: 0, blade: {}, follow: {} }, { azShift, _noBlade: true });
    for (const key of ["legL", "legR"]) {
      const ch = body.chains[key];
      if (!ch || ch.length < 2) continue;
      const foot = ch[ch.length - 1], par0 = body.par[foot];
      if (par0 < 0) continue;
      const Dp = FDF(mul(p0.W[par0], tr(Wr[par0])));                 // the parent's accumulated delta (visual frame)
      put(foot, lerpRot({ axis: [0, 0, 1], ang: 0 }, K.k16axisOf(tr(Dp)), Math.min(1, pose.plant)), null);
    }
  }
  // 2. propagate: shift each root, carry the parent's delta, apply this bone's own rotation about its pivot
  const shift = scl(pose.shift, body.H);
  const W = new Array(n).fill(null), P = new Array(n).fill(null), D = new Array(n).fill(null);
  for (const i of order) {
    const p = par[i];
    let Wd, Pd, q0 = null;
    if (p < 0) { Wd = Wr[i]; Pd = add(Pr[i], shift); }
    else { Wd = mul(FDF(D[p]), Wr[i]); Pd = add(P[p], mv(D[p], sub(Pr[i], Pr[p]))); }
    const r = req.get(i);
    if (r) {
      const q = r.pivot ? (p < 0 ? add(r.pivot, shift) : add(P[p], mv(D[p], sub(r.pivot, Pr[p])))) : null;
      W[i] = mul(FDF(r.R), Wd);
      P[i] = q ? add(q, mv(r.R, sub(Pd, q))) : Pd;
    } else { W[i] = Wd; P[i] = Pd; }
    if (carry.has(i)) P[i] = add(P[i], carry.get(i));
    D[i] = FDF(mul(W[i], tr(Wr[i])));
  }
  // 3. the whole-body flip about the mass centre (a backflip is this and nothing else)
  if (Math.abs(pose.flip.deg) > 1e-6) {
    const c = add(body.massCentre(), shift);
    const Rf = rot(pose.flip.axis, pose.flip.deg * DEG);
    for (let i = 0; i < n; i++) { W[i] = mul(FDF(Rf), W[i]); P[i] = add(c, mv(Rf, sub(P[i], c))); }
  }
  // 4. feet on the floor: lift/lower the whole body so the lowest CONTACT vertex (the feet) sits on the
  //    rest floor. A tail or a hand may go below it — the verifier reports that so the pose can be tuned.
  if (pose.ground > 1e-6) {
    let dy;
    if ((pose.anchorW || 0) > 1e-6 && (pose.anchor || []).length) {
      // planted feet (converter output): the feet DW2 has on its floor at this pose stand on THEIR idle floor, whatever the leg lengths; the body moves up or down to make it so.
      // Two planted feet that disagree: the body goes up until the lower one touches (neither sinks).
      body.footFloor ??= {};
      let need = Infinity;
      for (const f of pose.anchor) { body.footFloor[f] ??= lowestY(body, body.rest.W, body.rest.P, { only: [f] }); need = Math.min(need, body.footFloor[f] - lowestY(body, W, P, { only: [f] })); }
      if (Number.isFinite(need) && Math.abs(need) > 1e-9) { const a = need * Math.min(1, pose.anchorW); for (let i = 0; i < n; i++) P[i] = [P[i][0], P[i][1] + a, P[i][2]]; }
    }
    if ((pose.lift || 0) > 1e-6) {
      // lift-only grounding (converter output): the lowest vertex of the WHOLE body may not go under the floor (a tumble puts a tail or a wing below it while the feet are in the air).
      // The reference is the idle pose's own lowest vertex when that is below the feet floor, so a body that rests with a tail under the floor is not lifted at rest.
      body.restLow ??= Math.max(body.floorY, lowestY(body, body.rest.W, body.rest.P));
      dy = Math.min(0, body.restLow + (pose.sink || 0) * body.H - lowestY(body, W, P));   // pose.sink = how far under the floor the DONOR body itself goes at this pose (body heights)
    } else dy = (body.floorY - lowestY(body, W, P, { only: body.contact })) * Math.min(1, pose.ground);   // lift only: raise the body if the feet would sink, never pull it down onto the floor (DW2 hips follow the clip)
    if (Math.abs(dy) > 1e-9) for (let i = 0; i < n; i++) P[i] = [P[i][0], P[i][1] + dy, P[i][2]];
  }
  return { W, P };
}

function crossVec(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

/** The lowest point of the posed mesh (+Y is DOWN, so this is the MAX y over all transformed verts).
 *  `only` = a bone set (the atlas CONTACT set = the feet) so a tail or a hand can go below the floor
 *  without lifting the whole body: grounding means the FEET stand on the floor. */
export function lowestY(body, W, P, { stride = 1, only = null } = {}) {
  let low = -Infinity;
  const bones = body.model.bones;
  const set = only ? new Set(only) : null;
  for (let i = 0; i < body.n; i++) {
    if (set && !set.has(i)) continue;
    const vs = bones[i]?.verts;
    if (!vs || !vs.length || !W[i] || !P[i]) continue;
    const Rm = W[i], Pm = P[i];
    for (let k = 0; k < vs.length; k += stride) {
      const v = vs[k];
      const x = Rm[0][0] * v[0] + Rm[0][1] * v[1] + Rm[0][2] * v[2];
      const y = Rm[1][0] * v[0] + Rm[1][1] * v[1] + Rm[1][2] * v[2];
      const z = Rm[2][0] * v[0] + Rm[2][1] * v[1] + Rm[2][2] * v[2];
      if (y + Pm[1] > low) low = y + Pm[1];
    }
  }
  return low;
}
