// THE FIRING AXIS - which way an emitter points, derived from the model's own geometry.
//
// A cast reads as an attack only if the part that fires it points at the target when the shot
// leaves. This module answers "which way does it point" from the data that is already there: the
// K12 bone map (which bone fires), the K17 arm classification (what that arm ends in: a bare hand
// block or a weapon-like prop), and the posed mesh. No species names, no per-move styles, no disc
// coordinates: the same arithmetic runs for every body.
//
// Frame. The pose frame is the PS1 battle frame the renderer's own bone matrices live in
// (battle3d.js buildBoneWorldMatrices): +X is the character's RIGHT, +Y is DOWN, +Z is the way the
// body faces. Every model is extracted with the D(180 deg) root flip baked in, so in its OWN frame
// a model always faces +Z - the near-side player and the far-side enemy alike (battle3d.js applies
// the enemy's extra half turn in render space, not here). A script authored for an enemy aims -Z in
// the arena's world frame; `toLocal()` turns any authored point into this frame.
//
// Axis per emitter class (EMITTER_CLASSES):
//   prop    the arm ends in a weapon-like extension (K17: elongated / flat / bulky). Axis = the
//           long axis of the prop's own mesh (PCA), signed away from the shoulder. This is the one
//           class where "where it points" is a property of the geometry, not of the joint chain:
//           a sword held out sideways points sideways even while the arm points forward.
//   hand    a bare hand block (K17: bare). Two candidate axes, both geometric: `palm` = the THIN
//           axis of the hand block (its palm normal - a flat block's normal is its smallest
//           extent), `push` = the wrist->hand direction (a fist or a palm thrust delivers along the
//           forearm). armAxis() returns the class default; axisVariants() returns both, and the
//           K19b calibration picked between them on the disc's own casts (see
//           /home/dorij/scratch-research/anim-k19b.md).
//   head    mouth / head / eyes: the head bone's rest facing, carried by the head's own rotation.
//   chest   the torso bone's rest facing, carried by the torso.
//   back    the torso's facing reversed (a back cannon points away from the chest).
//   tail    the tail chain's own direction, tip-ward.
//   wing    the wing chain's own direction, tip-ward (same rule as a prop arm).
//   body    whole-body: the root bone's rest facing, carried by the root.
//
// "Carried facing" is the honest form of "the front of this part": the front of a head in the rest
// pose is +Z; when the head turns, the front turns with it. It is the bone's world rotation applied
// to the rest-pose direction that was +Z, i.e. R_now * R_rest^T * (+Z). Nothing is assumed about the
// part's shape, so it holds for a mouth with no muzzle mesh and for a helmet with a crest.
//
// Pure arithmetic over the model JSON (no DOM, no fetch), so the solver, the calibration harness and
// a node test all compute the same axis from the same function.
//
// WHERE R1 USES THIS: firingAxis() answers "which way does this part point", which is a geometry
// question. R1's question is "which way does this attack leave", and on the disc's own casts those
// two are not the same axis for an arm (a raised sword's blade is 28 deg off while the wrist->tip line
// is 10.7). aimAxisFor() below is the calibrated answer, and R1 (measured + acceptance, per emitter
// class) is the rule the generator must satisfy. See /home/dorij/scratch-research/anim-k19b.md.

import { armEquip } from "./digimon-anatomy.js";
import { BONEMAP, armChain, tailChain, wingChains, boneMap } from "./digimon-bonemap.js";
import { authoredSide } from "./side-mirror.js";

const TAU = (Math.PI * 2) / 4096;          // PS1 angle units: 4096 = one turn
const UP = [0, -1, 0];                      // +Y is DOWN in this frame, so "up" is -Y

export const EMITTER_CLASSES = ["prop", "hand", "head", "chest", "back", "tail", "wing", "body"];

// ---------------------------------------------------------------- vector helpers

export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function len(a) { return Math.sqrt(dot(a, a)); }
export function unit(a) { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0]; }
export function dist(a, b) { return len(sub(a, b)); }

/** The angle between two vectors in degrees (0 = same direction, 180 = opposite). */
export function angleBetween(a, b) {
  const ua = unit(a), ub = unit(b);
  const c = Math.max(-1, Math.min(1, dot(ua, ub)));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * Aim error of `axis` at `target` from `origin`:
 *   full  the 3-D angle between the axis and the origin->target line (degrees)
 *   yaw   signed horizontal error, + = the axis points to the body's RIGHT of the target
 *   pitch signed elevation error, + = the axis points ABOVE the line (remember +Y is down)
 * `flat` is true when the target is ~directly overhead/underfoot (yaw undefined).
 */
export function aimError(axis, origin, target) {
  const d = sub(target, origin);
  const dl = len(d);
  const full = angleBetween(axis, d);
  const ah = Math.hypot(axis[0], axis[2]), dh = Math.hypot(d[0], d[2]);
  if (ah < 1e-6 || dh < 1e-6 * Math.max(1, dl)) {
    return { full, yaw: 0, pitch: 0, flat: true, distance: dl };
  }
  const aYaw = Math.atan2(axis[0], axis[2]) * (180 / Math.PI);
  const dYaw = Math.atan2(d[0], d[2]) * (180 / Math.PI);
  let yaw = aYaw - dYaw;
  while (yaw > 180) yaw -= 360;
  while (yaw < -180) yaw += 360;
  const aPitch = Math.atan2(-axis[1], ah) * (180 / Math.PI);
  const dPitch = Math.atan2(-d[1], dh) * (180 / Math.PI);
  return { full, yaw, pitch: aPitch - dPitch, flat: false, distance: dl };
}

// ---------------------------------------------------------------- the pose

function sampleChannel(ch, frame) {
  if (!ch || !ch.length) return [0, 0, 0];
  let lo = ch[0], hi = ch[0];
  for (const rec of ch) {
    if (rec[3] === 30000) break;
    if (rec[3] <= frame) lo = rec; else { hi = rec; break; }
  }
  if (lo === hi || hi[3] === 30000 || hi[3] <= lo[3]) return [lo[0], lo[1], lo[2]];
  const t = (frame - lo[3]) / (hi[3] - lo[3]);
  return [lo[0] + t * (hi[0] - lo[0]), lo[1] + t * (hi[1] - lo[1]), lo[2] + t * (hi[2] - lo[2])];
}

// Rz(ax) x Ry(ay) x Rx(az), column-major 3x3 - battle3d.js ps1AnglesToMat3, and the argument order
// (c2[2], c2[1], c2[0]) is the renderer's, not a typo.
function ps1Mat3(ax, ay, az) {
  const cx = Math.cos(ax * TAU), sx = Math.sin(ax * TAU);
  const cy = Math.cos(ay * TAU), sy = Math.sin(ay * TAU);
  const cz = Math.cos(az * TAU), sz = Math.sin(az * TAU);
  const Rz = [cx, sx, 0, -sx, cx, 0, 0, 0, 1];
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const Rx = [1, 0, 0, 0, cz, sz, 0, -sz, cz];
  return mat3Mul(Rz, mat3Mul(Ry, Rx));
}
function mat3Mul(a, b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let s = 0; for (let k = 0; k < 3; k++) s += a[k * 3 + r] * b[c * 3 + k];
    o[c * 3 + r] = s;
  }
  return o;
}
function applyRot(R, v) {
  return [R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
          R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
          R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
}
function transpose3(R) { return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]; }

/**
 * The pose at `frame`: per-bone world rotation (3x3, column-major) and world translation, in the
 * frame described at the top. This is the renderer's own arithmetic (battle3d.js
 * buildBoneWorldMatrices: Rz x Ry x Rx per bone, ch1 with the x/z sign correction, composed down
 * the hierarchy) plus its optional timeline blend `{ from, t }`. tools/verify_firing_axis.mjs
 * pins it against the live renderer's matrices element for element, so a node caller and the
 * battle view agree.
 *
 * `scale[i]` is the bone's ch3 draw scale ([1,1,1] when the pack has none) and `visible[i]` is false
 * when any axis of it is 0 - the disc hides a retracted part exactly that way, and the renderer
 * collapses its matrix. The ROTATION reported here is always the unscaled one: a direction (which
 * way a muzzle faces) does not shrink, while a POSITION read off the mesh does.
 */
export function poseFromChannels(model, frame, { blend = null } = {}) {
  const n = model.num_bones ?? model.bones.length;
  const rot = new Array(n).fill(null), pos = new Array(n).fill(null);
  const scale = new Array(n).fill(null), visible = new Array(n).fill(true);
  const sample = (ch) => {
    const a = sampleChannel(ch, frame);
    if (!blend || blend.from == null) return a;
    const b = sampleChannel(ch, blend.from);
    const t = blend.t;
    return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t];
  };
  const proc = (i) => {
    const b = model.bones[i];
    if (!b || !b.anim) { rot[i] = ps1Mat3(0, 0, 0); pos[i] = [0, 0, 0]; scale[i] = [1, 1, 1]; return; }
    const c2 = sample(b.anim.ch2), c1 = sample(b.anim.ch1);
    const R = ps1Mat3(c2[2], c2[1], c2[0]);
    const p = (b.parent_slot ?? 0) - 1;
    if (p < 0) { rot[i] = R; pos[i] = [-c1[0], c1[1], -c1[2]]; } else {
      if (!rot[p]) proc(p);
      rot[i] = mat3Mul(rot[p], R);
      const rt = applyRot(rot[p], c1);
      pos[i] = [pos[p][0] - rt[0], pos[p][1] + rt[1], pos[p][2] - rt[2]];
    }
    if (b.anim.ch3) {
      const c3 = sample(b.anim.ch3);
      scale[i] = [c3[0] / 4096, c3[1] / 4096, c3[2] / 4096];
      visible[i] = scale[i][0] !== 0 && scale[i][1] !== 0 && scale[i][2] !== 0;
    } else scale[i] = [1, 1, 1];
  };
  for (let i = 0; i < n; i++) if (!rot[i]) proc(i);
  return { rot, pos, scale, visible, frame };
}

/** The renderer's matrix for one bone at this pose: the rotation columns times the ch3 draw scale. */
export function boneMatrix(pose, i) {
  const R = pose.rot[i], s = pose.scale?.[i] || [1, 1, 1], t = pose.pos[i];
  return [R[0] * s[0], R[1] * s[0], R[2] * s[0],
          R[3] * s[1], R[4] * s[1], R[5] * s[1],
          R[6] * s[2], R[7] * s[2], R[8] * s[2],
          t[0], t[1], t[2]];
}

/** One mesh vertex of `boneIdx` in the pose frame (the renderer's vertex path, D-flip included). */
export function vertexWorld(model, boneIdx, v, pose) {
  const R = pose.rot[boneIdx], t = pose.pos[boneIdx];
  const s = pose.scale?.[boneIdx] || [1, 1, 1];
  const x = v[0] * s[0], y = v[1] * s[1], z = v[2] * s[2];
  return [
    -(R[0] * x + R[3] * y + R[6] * z) + t[0],
     (R[1] * x + R[4] * y + R[7] * z) + t[1],
    -(R[2] * x + R[5] * y + R[8] * z) + t[2],
  ];
}

/** Every bone index in the subtree rooted at `root` (root included). */
export function subtree(model, root) {
  const n = model.num_bones ?? model.bones.length;
  const kids = new Map();
  for (let i = 0; i < n; i++) {
    const p = (model.bones[i].parent_slot ?? 0) - 1;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(i);
  }
  const out = [];
  const walk = (i) => { out.push(i); for (const k of kids.get(i) ?? []) walk(k); };
  walk(root);
  return out;
}

/** The posed mesh of a set of bones: [x,y,z] per vertex, in the pose frame. */
export function pointsOf(model, bones, pose) {
  const out = [];
  for (const b of bones) for (const v of model.bones[b]?.verts || []) out.push(vertexWorld(model, b, v, pose));
  return out;
}

// ---------------------------------------------------------------- PCA

function jacobiEigen3(A) {
  // symmetric 3x3 -> eigenvalues/vectors (cyclic Jacobi; 3x3 converges in a few sweeps)
  const a = A.map((r) => r.slice());
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-21) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const eig = [a[0][0], a[1][1], a[2][2]];
  const order = [0, 1, 2].sort((x, y) => eig[y] - eig[x]);
  return {
    values: order.map((i) => eig[i]),
    vectors: order.map((i) => [V[0][i], V[1][i], V[2][i]]),
  };
}

/**
 * Principal axes of a point cloud: { mean, axes: [{axis, sigma, sigmaPct}], extents }.
 * `sigma` is the standard deviation along that axis, `sigmaPct` its share of the total variance, so
 * an elongated prop reads sigmaPct[0] ~ 0.8-0.95 and a cube reads ~0.33 on all three.
 */
export function pca(points) {
  const n = points.length;
  if (!n) return { mean: [0, 0, 0], axes: [], extents: [0, 0, 0], n: 0 };
  const mean = [0, 0, 0];
  for (const p of points) { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2]; }
  mean[0] /= n; mean[1] /= n; mean[2] /= n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] /= n;
  const { values, vectors } = jacobiEigen3(C);
  const total = values[0] + values[1] + values[2];
  const axes = vectors.map((v, i) => ({
    axis: v,
    sigma: Math.sqrt(Math.max(0, values[i])),
    sigmaPct: total > 0 ? values[i] / total : 0,
  }));
  const extents = [0, 0, 0];
  for (const p of points) {
    const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
    for (let i = 0; i < 3; i++) {
      const e = Math.abs(dot(d, axes[i].axis));
      if (e > extents[i]) extents[i] = e;
    }
  }
  return { mean, axes, extents: extents.map((e) => e * 2), n };
}

// ---------------------------------------------------------------- emitter class

/** The arm chain a bone belongs to ('left' | 'right' | null), and whether it is that arm's tip. */
export function armOfBone(folder, boneIdx) {
  const m = boneMap(folder);
  if (!m) return null;
  const sides = [["left", m.aL], ["right", m.aR]];
  for (const [side, chain] of sides) {
    if (chain && chain.length && chain[chain.length - 1] === boneIdx) return { side, chain, tip: true };
    if (chain && chain.indexOf(boneIdx) >= 0) return { side, chain, tip: false };
  }
  for (const key of ["aLe", "aRe"]) {
    for (const chain of m[key] || []) {
      if (chain && chain.length && chain[chain.length - 1] === boneIdx) {
        return { side: key === "aLe" ? "left" : "right", chain, tip: true, extra: true };
      }
      if (chain && chain.indexOf(boneIdx) >= 0) return { side: key === "aLe" ? "left" : "right", chain, tip: false, extra: true };
    }
  }
  return null;
}

/**
 * The geometry class of one emitter site: what kind of thing that site fires from. Derived from the
 * K12 roles and the K17 arm classification only.
 *   { cls, bone, arm: {side, chain} | null, equip, reason }
 * `cls` is one of EMITTER_CLASSES; null for an unknown model or a site the rig does not have.
 */
export function emitterClass(folder, emitterId) {
  const m = boneMap(folder);
  if (!m) return { cls: null, bone: null, reason: "no-model" };
  const id = String(emitterId || "");
  const part = id.replace(/-\d+$/, "");
  const armSite = /^(left-arm|right-arm)(-\d+)?$/.exec(id);
  if (armSite || part === "both-arms") {
    // which arm chain: the site's own side, else the model's dominant side, else the first arm it has
    let side = armSite ? armSite[1].slice(0, -4) : null;
    if (!side) side = m.dom === "left" || m.dom === "right" ? m.dom : (m.aR?.length ? "right" : "left");
    const chains = [];
    if (armSite && armSite[2]) {
      const idx = (armSite[2].slice(1) | 0) - 1;
      const extra = (side === "left" ? m.aLe : m.aRe) || [];
      if (extra[idx]) chains.push(extra[idx]);
    }
    const primary = armChain(folder, side);
    if (primary) chains.unshift(primary);
    const chain = chains[0];
    if (!chain || !chain.length) return { cls: "body", bone: m.f?.["whole-body"] ?? m.t ?? m.r ?? 0, reason: "no-arm-chain" };
    const bone = chain[chain.length - 1];
    const equip = armEquip(folder, side);
    // K17's verdict decides: a weapon-like extension is a prop, a plain hand block is a hand
    const cls = equip.class === "bare" || equip.class === "none" ? "hand" : "prop";
    return { cls, bone, arm: { side, chain }, equip, reason: `k17:${equip.class}` };
  }
  // body-located sites
  const map = { mouth: "head", head: "head", eyes: "head", chest: "chest", back: "back", tail: "tail", wings: "wing", "whole-body": "body" };
  const cls = map[part];
  if (!cls) return { cls: null, bone: null, reason: "unknown-site" };
  const bone = part === "tail" ? (tailChain(folder) || []).slice(-1)[0] ?? m.t ?? m.r
    : part === "wings" ? ((wingChains(folder)[0] || {}).chain || []).slice(-1)[0] ?? m.t
    : part === "mouth" ? (m.f?.mouth ?? m.h ?? m.t)
    : part === "head" ? (m.f?.head ?? m.h ?? m.t)
    : part === "eyes" ? (m.f?.eyes ?? m.h ?? m.t)
    : part === "chest" ? (m.f?.chest ?? m.t ?? m.r)
    : part === "back" ? (m.f?.back ?? m.t ?? m.r)
    : (m.f?.["whole-body"] ?? m.r ?? m.t);
  if (bone == null) return { cls: null, bone: null, reason: "no-bone" };
  return { cls, bone, arm: null, reason: `site:${part}` };
}

// ---------------------------------------------------------------- the axis

/** The rest-pose direction that was +Z for a bone, carried into the current pose. */

/**
 * Bone-local "front" carried by the bone's rotation. `rest` is the model's rest pose
 * (poseFromChannels(model, restFrame)); the direction that was +Z in the rest pose is turned by
 * R_now * R_rest^T. The result is unit length.
 */
export function carriedFacing(boneIdx, pose, rest) {
  const R = pose.rot[boneIdx], R0 = rest.rot[boneIdx];
  if (!R || !R0) return [0, 0, 1];
  const local = applyRot(transpose3(R0), [0, 0, 1]);
  return unit(applyRot(R, local));
}

/** The direction of a bone CHAIN in the pose (first joint -> last joint), unit length. */
export function chainDirection(chain, pose) {
  if (!chain || chain.length < 2) return [0, 0, 1];
  return unit(sub(pose.pos[chain[chain.length - 1]], pose.pos[chain[0]]));
}

function propAxis(model, bone, pose, bones, kind = "elongated", anchor = null) {
  const pts = pointsOf(model, bones ?? subtree(model, bone), pose);
  const P = pca(pts);
  if (!P.axes.length) return null;
  // Which principal axis is "the way it fires"? A barrelled / bladed / blunt prop fires along its
  // LENGTH (the major axis). A flat plate - a shield - fires out of its FACE, which is its THIN axis
  // (the normal); taking a shield's long axis would point the beam along its rim. K17's classes say
  // which is which, so this is still pure geometry.
  let axis, which, spread;
  if (kind === "flat") {
    axis = unit(P.axes[2].axis);
    which = "face-normal";
    spread = P.axes[2].sigmaPct;
  } else {
    axis = unit(P.axes[0].axis);
    which = "long-axis";
    spread = P.axes[0].sigmaPct;
  }
  // sign: away from the joint the prop hangs off (the wrist, or the shoulder when that is all there is)
  const root = anchor || pose.pos[0];
  if (dot(axis, sub(P.mean, root)) < 0) axis = mul(axis, -1);
  const reach = kind === "flat" ? P.extents[2] : P.extents[0];
  const far = add(P.mean, mul(axis, reach / 2));
  const near = sub(P.mean, mul(axis, reach / 2));
  if (dist(near, root) > dist(far, root)) axis = mul(axis, -1);
  // IS THERE AN AXIS AT ALL? Two ways a posed mesh refuses to have one:
  //   collapsed  the disc hides a part by drawing it at ch3 scale 0, so its posed vertices all sit
  //              on the joint. Every direction is equally principal; whatever the eigensolver hands
  //              back is numerical noise (and used to be reported as "high" confidence).
  //   unstable   two principal variances are within a hair of each other (a cube-ish block, or a
  //              sub-pixel pose difference near a degenerate saddle). The eigenvector then flips 90
  //              degrees between two runs that differ only by rounding - tools/verify_firing_axis
  //              caught exactly that on m372sgrg / m443sgr2.
  // `sep` is the variance share that separates the chosen axis from its neighbour: a blade reads
  // ~0.8, a round block ~0.
  const sep = kind === "flat"
    ? P.axes[1].sigmaPct - P.axes[2].sigmaPct
    : P.axes[0].sigmaPct - P.axes[1].sigmaPct;
  const collapsed = !(P.axes[0].sigma > 1e-3);
  const unstable = collapsed || sep < 0.02;
  return { axis, pca: P, which, spread, sep, collapsed, unstable };
}

function handAxes(model, bone, pose, arm) {
  const P = pca(pointsOf(model, subtree(model, bone), pose));
  if (!P.axes.length) return null;
  // push: from the wrist (the bone before the hand in the chain) into the hand block
  const chain = arm?.chain ?? [];
  const wrist = chain.length >= 2 ? pose.pos[chain[chain.length - 2]] : pose.pos[bone];
  const push = unit(sub(P.mean, wrist));
  // palm: the thinnest axis of the hand block, signed outward (same sign as push)
  const thinnest = P.axes.slice().sort((a, b) => a.sigma - b.sigma)[0];
  let palm = unit(thinnest.axis);
  if (dot(palm, push) < 0) palm = mul(palm, -1);
  // A block centred on its own joint has no "push" direction (the difference is zero), and a block
  // with no thin side (a cube) has no palm normal. Both are reported so the caller can fall back
  // instead of aiming along a zero vector.
  const sepThin = P.axes[1].sigmaPct - P.axes[2].sigmaPct;
  return {
    push, palm, pca: P, thin: thinnest.sigmaPct, sepThin,
    pushLen: len(push), palmUnstable: P.axes[0].sigma <= 1e-3 || sepThin < 0.02 || len(push) === 0,
  };
}

/**
 * The firing axis of one emitter site at one pose.
 *
 *   firingAxis(model, folder, emitterId, pose, { rest, variant })
 *     -> { emitterId, cls, bone, method, origin, axis, joint, confidence, detail }
 *
 * `origin` is the business end of the emitter (the furthest mesh point of the prop/hand block, the
 * head bone for a mouth, the chest bone for a chest cannon); `joint` is the bone's own pivot.
 * `variant` picks the hand-class candidate ('push' | 'palm'); the class default comes from the
 * calibration (HAND_DEFAULT). Returns null when the site has no geometry to read.
 */
export function firingAxis(model, folder, emitterId, pose, { rest = null, variant = null } = {}) {
  const info = emitterClass(folder, emitterId);
  if (!info.cls || info.bone == null) return null;
  const bone = info.bone;
  const joint = pose.pos[bone] || [0, 0, 0];
  const restPose = rest || pose;
  let axis = null, method = null, detail = {}, quality = 1;

  if (info.cls === "prop") {
    const chain = info.arm?.chain ?? [];
    const anchor = chain.length >= 2 ? pose.pos[chain[chain.length - 2]] : null;
    const r = propAxis(model, bone, pose, undefined, info.equip?.class || "elongated", anchor);
    if (!r) return null;
    detail = { sigmaPct: r.spread, sep: r.sep, length: r.pca.extents[0], equip: info.equip?.class || null, collapsed: r.collapsed };
    if (r.unstable) {
      // This pose has no readable prop axis (a collapsed part, or a block with no long side). Aim
      // the way the ARM goes instead: wrist -> block, then the chain, then the bone's own front.
      const push = r.collapsed ? [0, 0, 0] : (anchor ? unit(sub(r.pca.mean, anchor)) : [0, 0, 0]);
      if (len(push)) { axis = push; method = "prop-push-fallback"; quality = 0.3; }
      else if (chain.length >= 2) { axis = chainDirection(chain, pose); method = "prop-chain-fallback"; quality = 0.3; }
      else { axis = carriedFacing(bone, pose, restPose); method = "prop-facing-fallback"; quality = 0.2; }
    } else {
      axis = r.axis; method = `pca-${r.which}`;
      quality = Math.min(1, r.sep * 5);
    }
  } else if (info.cls === "hand") {
    const r = handAxes(model, bone, pose, info.arm);
    if (!r) return null;
    const pick = variant || HAND_DEFAULT;
    detail = { thinPct: r.thin, sepThin: r.sepThin, push: r.push, palm: r.palm };
    const chain = info.arm?.chain ?? [];
    if (pick === "palm" && r.palmUnstable) {
      // a palm normal that cannot be told from the block's other side, or a cube: use the push
      axis = r.push; method = "palm-unstable:push"; quality = r.pushLen ? 0.4 : 0;
    } else if (pick === "palm") {
      axis = r.palm; method = "palm-normal"; quality = Math.min(1, r.sepThin * 5);
    } else {
      axis = r.push; method = "push"; quality = r.pushLen ? 1 : 0;
    }
    if (!len(axis)) {
      if (chain.length >= 2) { axis = chainDirection(chain, pose); method = "hand-chain-fallback"; quality = 0.3; }
      else { axis = carriedFacing(bone, pose, restPose); method = "hand-facing-fallback"; quality = 0.2; }
    }
  } else if (info.cls === "tail" || info.cls === "wing") {
    const chain = info.cls === "tail" ? tailChain(folder)
      : ((wingChains(folder).find((w) => w.chain.includes(bone)) || {}).chain || null);
    axis = chain && chain.length >= 2 ? chainDirection(chain, pose) : carriedFacing(bone, pose, restPose);
    method = chain && chain.length >= 2 ? "chain" : "facing";
  } else if (info.cls === "back") {
    axis = mul(carriedFacing(bone, pose, restPose), -1);
    method = "facing-reversed";
  } else {
    axis = carriedFacing(bone, pose, restPose);
    method = "facing";
  }
  axis = unit(axis);
  if (!len(axis)) return null;
  // The business end: the furthest mesh point of the part along its own axis (a muzzle's front
  // surface, a blade's tip, knuckles, the back plate of a back cannon). A weapon/hand block is a
  // CHAIN of bones (a blade, a hilt, a spike), so it reads its whole subtree; a head, torso, tail or
  // wing reads its own mesh, or a root bone's subtree would make "the back of the body" win every
  // match on a model whose torso IS the root. No mesh -> the bone pivot.
  const chained = info.cls === "prop" || info.cls === "hand";
  let pts = pointsOf(model, chained ? subtree(model, bone) : [bone], pose);
  if (!pts.length) pts = pointsOf(model, subtree(model, bone), pose);
  const origin = pts.length
    ? pts.reduce((best, p) => (dot(p, axis) > dot(best, axis) ? p : best), pts[0])
    : joint;
  const spread = model?.bones?.[bone]?.verts?.length ?? 0;
  // Confidence is about the GEOMETRY, not the vertex count: a collapsed block has 30 verts and no
  // axis, and reporting "high" there is how a caller ends up aiming at nothing.
  return {
    emitterId: String(emitterId), cls: info.cls, bone, method,
    origin, joint, axis, detail,
    confidence: pts.length >= 3 && quality >= 0.5 ? "high" : "low",
    axisQuality: Math.round(quality * 100) / 100,
    arm: info.arm || null,
  };
}

/** The hand-class default axis, chosen by the K19b calibration on the disc's own casts. */
export const HAND_DEFAULT = "push";

/**
 * Every candidate firing axis of an ARM site, so a caller can compare them: `push` (wrist -> hand
 * block: the way a fist or a palm thrust delivers), `long` (the prop's major axis: a blade, barrel or
 * club) and `thin` (the block's thinnest axis: a palm's normal or a shield's face). All three are
 * unit vectors in the pose frame; none is right for every arm design, which is why the K19b
 * calibration measured them against the disc's own casts and firingAxis() picks by class.
 */
export function armAxisCandidates(model, folder, emitterId, pose) {
  const info = emitterClass(folder, emitterId);
  if (!info.bone) return null;
  const bone = info.bone;
  const pts = pointsOf(model, subtree(model, bone), pose);
  if (!pts.length) return null;
  const P = pca(pts);
  if (!P.axes.length) return null;
  const chain = info.arm?.chain ?? [];
  const wrist = chain.length >= 2 ? pose.pos[chain[chain.length - 2]] : pose.pos[bone];
  const push = unit(sub(P.mean, wrist));
  const out = { push, long: unit(P.axes[0].axis), thin: unit(P.axes[2].axis), pca: P };
  // sign every candidate outward (away from the wrist), so a comparison is not a sign coin-flip
  for (const k of ["long", "thin"]) if (dot(out[k], push) < 0) out[k] = mul(out[k], -1);
  return out;
}

/** Both hand-class candidates, so a caller (or the calibration) can compare them. */
export function axisVariants(model, folder, emitterId, pose, { rest = null } = {}) {
  const out = {};
  for (const v of ["push", "palm"]) out[v] = firingAxis(model, folder, emitterId, pose, { rest, variant: v });
  return { push: out.push, palm: out.palm };
}

/** Authored arena coordinates -> this model's own pose frame (+Z = the way it faces). */
export function toLocal(model, p) {
  return authoredSide(model) === "enemy" ? [-p[0], p[1], -p[2]] : [p[0], p[1], p[2]];
}

/** The model's rest pose, cached per model object (frame 0 of the model's own channels). */
const restCache = new WeakMap();
export function restPoseOf(model, frame = null) {
  const key = frame == null ? -1 : frame | 0;
  let e = restCache.get(model);
  if (!e) { e = new Map(); restCache.set(model, e); }
  if (!e.has(key)) e.set(key, poseFromChannels(model, key === -1 ? (model.clips?.[0]?.start_frame ?? 0) : key));
  return e.get(key);
}

// ─────────────────────────────────────────────────────────────────────────────── R1, calibrated
//
// Rule R1 says: at the release tick the emitter's firing axis points at the target. A rule the disc
// violates is a wrong rule, so K19b measured R1 on the disc's own authored casts and this is what
// came back (tools/k19b_calibrate_firing_axis.mjs -> anim-k19b-calibration.json / anim-k19b.md).
// Read it as two separate claims, because the disc treats them differently:
//
//   YAW (does the part point the right WAY?)  yes for body-attached emitters (median 0 deg on 22
//   mouth casts, 9 chest, 5 whole-body). For an arm, the disc aims the ARM and not the prop: over
//   the 12 prop shots whose geometry is well conditioned, the wrist->prop direction sits 10.7 deg off
//   the aim line (median; 7/12 within 15) while the blade's own long axis sits 28.1 deg off (6/12
//   within 15) and the module's chosen-axis median is 19.3. A flat prop (a shield) is the exception
//   in the other direction: its face normal beats its long axis 10.5 vs 79.7 deg, which is why
//   firingAxis() already fires flat props out of the face. A bare hand block gives no clean answer at
//   all (push 40.1, palm 23.2 but with a sign that flips between shots, 0/9 within 15 deg): the disc
//   simply does not aim bare hands, so R1 for the hand class is a DESIGN rule (an aimed palm reads
//   better) and not a disc fact.
//
//   PITCH (does it point at the target in the vertical?)  no: a mouth is 24.1 deg off level at
//   release (median |pitch|; signed bias -18.3, i.e. below the aim line), a chest 15.5 (above), a
//   whole body 6.7, a prop 47.4 - a prop cast is a SWING, the blade arcs through the release and the
//   shot leaves anyway. Copying that would make every synthesized prop cast point its blade half a
//   right angle away from the target, which is exactly what R1 exists to prevent. So the acceptance
//   below is TIGHTER than the disc for props and about equal to it for body-attached emitters:
//   aim as well as the disc does where the disc aims, and better where it just swings.
//
//   BACK / WING / TAIL  no usable sample: one back shot aims exactly 180 deg away while its shot
//   leaves 0.3 body heights from it and flies at the target (the part points backwards, the shot
//   does not), and the wing/tail rows never had a launch point the particle reached. R1 is not
//   enforced on those part axes; aim the body and let the appendage follow.
//
// `measured` is what the disc does (medians over the shots whose launch point the attributed part
// could actually reach; for prop, over the 12 of 14 whose blade is well conditioned); `acceptance`
// is what a synthesized cast must satisfy. Nothing here names a species or a move: the numbers are
// per emitter class only.
export const R1 = {
  measured: {
    body:  { n: 5,  models: 5,  medianAbsYaw: 0,    medianPitch: 0,     medianAbsPitch: 6.7,  median3D: 14.8, within15Yaw: 4 },
    chest: { n: 9,  models: 6,  medianAbsYaw: 0,    medianPitch: 5.5,   medianAbsPitch: 15.5, median3D: 15.5, within15Yaw: 9 },
    head:  { n: 22, models: 16, medianAbsYaw: 0,    medianPitch: -18.3, medianAbsPitch: 24.1, median3D: 24.7, within15Yaw: 19 },
    prop:  { n: 12, models: 11, medianAbsYaw: 19.3, medianPitch: 22.7,  medianAbsPitch: 47.4, median3D: 48.0, within15Yaw: 6,
             note: "12 of 14 shots: geometry well conditioned; 2 fell back to the arm",
             armAxis: { push: 10.7, blade: 28.1, faceNormal: 10.7 } },
    hand:  { n: 9,  models: 9,  medianAbsYaw: 40.1, medianPitch: -23.1, medianAbsPitch: 23.1, median3D: 42.8, within15Yaw: 0,
             armAxis: { push: 40.1, long: 37.8, thin: 23.2 }, note: "palm sign ambiguous; no disc evidence of aiming" },
    back:  { n: 1,  models: 1,  medianAbsYaw: 180,  medianPitch: -59.9, medianAbsPitch: 59.9, median3D: 120.1, within15Yaw: 0 },
  },
  /** The acceptance for a synthesized cast: aim error the generator must stay inside, degrees. */
  acceptance: {
    body:  { yaw: 12, pitch: 15, enforce: "axis" },
    chest: { yaw: 12, pitch: 18, enforce: "axis" },
    head:  { yaw: 12, pitch: 25, enforce: "axis" },
    prop:  { yaw: 22, pitch: 30, enforce: "axis" },
    hand:  { yaw: 25, pitch: 30, enforce: "axis" },
    back:  { yaw: null, pitch: null, enforce: "shot" },
    wing:  { yaw: null, pitch: null, enforce: "shot" },
    tail:  { yaw: null, pitch: null, enforce: "shot" },
  },
};

/** R1's acceptance for one emitter class (an unknown class gets the loose arm-class values). */
export function r1Acceptance(cls) {
  return R1.acceptance[cls] ?? { yaw: 25, pitch: 30, enforce: "axis" };
}

/**
 * The axis R1 should be applied to — the CALIBRATED aim axis, which for an arm emitter is the arm's
 * own push direction (wrist -> block/prop), not the blade. Returns the same object firingAxis()
 * does, with `axis` replaced and `method` suffixed "+arm-push" when it differs, plus
 * `calibrated: true`. For every non-arm class this is firingAxis() unchanged.
 *
 * Use this in the solver's aim step and firingAxis() when you need the geometry (where the tip is,
 * how well the prop is conditioned). They differ by design: a raised sword's blade can point 56 deg
 * off while the arm that fires the spell points at the target.
 */
export function aimAxisFor(model, folder, emitterId, pose, { rest = null } = {}) {
  const fa = firingAxis(model, folder, emitterId, pose, { rest });
  if (!fa) return null;
  if (fa.cls !== "prop" && fa.cls !== "hand") return { ...fa, calibrated: true };
  const c = armAxisCandidates(model, folder, emitterId, pose);
  if (!c || !len(c.push)) return { ...fa, calibrated: false };
  return { ...fa, axis: c.push, method: `${fa.method}+arm-push`, calibrated: fa.method !== "push" };
}
