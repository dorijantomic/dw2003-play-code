// web/mount3d.js — live, pixelated three.js rendering of a DW2 mount model.
//
// DW2 models are self-contained glTF 2.0 files written by "dw2_model_converter": every buffer and the texture
// embedded as a base64 data URI, one non-indexed triangle list per bone, parented under bone_N nodes, and the
// clips animate those nodes' TRS. The rig is RIGID — no JOINTS_0/WEIGHTS_0 — so a pose is just the node tree's
// local TRS walk (the same decoding rules as ~/dw2003-play-anim/web/anim-viewer-dw2.js, which measured the rigs).
//
// The rendering follows web/water3d.js and web/grass3d.js: a hidden WebGL canvas drawn into the 2D field each
// frame through ctx.drawImage. The difference is the target size: this one renders at GAME PIXELS (no ZOOM
// scaling), then a CPU pass maps it to a fixed 16-colour palette and adds a 1 px near-black outline, so the
// mount reads as a pixel sprite standing in a 320x240 field rather than a smooth 3D model.
//
// Nothing here reads game state: mount.js owns the riding rules.
import * as THREE from "./lib3d/three.module.min.js";

export const MOUNT_VIEW = { w: 112, h: 104 };      // game pixels of the sprite cell
const PITCH = (50 * Math.PI) / 180;                // the field's own isometric pitch (web/grass3d.js)
const SIN = Math.sin(PITCH);
const COS = Math.cos(PITCH);

// ── the fixed palette (16 colours) and the near-black outline ───────────────────────────────────
// A neutral ramp (shadows to highlights) plus two accents. Flat shading and the palette together are what
// make the render read as painted pixel art instead of a lit 3D object.
export const PALETTE = [
  [16, 16, 22], [32, 32, 42], [52, 52, 64], [78, 78, 92],
  [104, 104, 120], [132, 132, 148], [160, 160, 176], [190, 190, 202],
  [214, 214, 222], [238, 238, 242],
  [86, 62, 44], [126, 94, 62], [176, 142, 96],
  [58, 92, 148], [104, 150, 206], [206, 150, 120],
];
export const OUTLINE = [10, 10, 14];

// ── glTF decoding (the DW2 subset: non-indexed triangles, rigid node TRS, LINEAR clips) ─────────
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT = {
  5120: { Ctor: Int8Array, get: "getInt8", size: 1, norm: 127 },
  5121: { Ctor: Uint8Array, get: "getUint8", size: 1, norm: 255 },
  5122: { Ctor: Int16Array, get: "getInt16", size: 2, norm: 32767 },
  5123: { Ctor: Uint16Array, get: "getUint16", size: 2, norm: 65535 },
  5125: { Ctor: Uint32Array, get: "getUint32", size: 4, norm: 0 },
  5126: { Ctor: Float32Array, get: "getFloat32", size: 4, norm: 0 },
};

function decodeBase64(b64) {
  if (typeof atob === "function") {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));   // unit tests in node
}

function dataUri(uri) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(uri || ""));
  return m && m[2] ? decodeBase64(m[3]) : null;
}

/** Parse a self-contained DW2 glTF into the shapes the renderer and the tests need. */
export function parseDw2Gltf(json) {
  if (!json || !Array.isArray(json.nodes)) throw new Error("not a glTF");
  const model = {
    json,
    buffers: new Map(),
    accessors: new Map(),
    nodes: json.nodes,
    parents: new Int32Array(json.nodes.length).fill(-1),
    roots: (json.scenes?.[json.scene ?? 0]?.nodes || []).slice(),
    meshes: [],
    materials: [],
    images: [],
    anims: [],
    texcoordSets: 0,
  };
  for (const r of model.roots) walkParents(json, r, -1, model.parents);
  for (let i = 0; i < json.nodes.length; i++)
    if (model.parents[i] === -1 && !model.roots.includes(i)) model.roots.push(i);

  for (const m of json.meshes || []) {
    const prims = [];
    for (const p of m.primitives || []) {
      if ((p.mode ?? 4) !== 4 || p.indices != null) continue;      // DW2 writes non-indexed triangles only
      const pos = readAccessor(model, p.attributes.POSITION);
      if (!pos) continue;
      const uv = p.attributes.TEXCOORD_0 != null ? readAccessor(model, p.attributes.TEXCOORD_0) : null;
      const nrm = p.attributes.NORMAL != null ? readAccessor(model, p.attributes.NORMAL) : null;
      prims.push({ pos, nrm, uv, count: json.accessors[p.attributes.POSITION].count | 0, material: p.material ?? -1 });
    }
    model.meshes.push({ prims });
  }
  model.materials = (json.materials || []).map((m) => ({
    name: m.name || null,
    alphaMode: m.alphaMode || "OPAQUE",
    alphaCutoff: m.alphaCutoff != null ? +m.alphaCutoff : 0.5,
    image: m.pbrMetallicRoughness?.baseColorTexture?.index != null
      ? json.textures?.[m.pbrMetallicRoughness.baseColorTexture.index]?.source ?? null : null,
  }));
  model.images = (json.images || []).map((im) => ({ uri: im.uri || null }));
  model.anims = (json.animations || []).map((a, i) => {
    const channels = [];
    for (const ch of a.channels || []) {
      const s = a.samplers[ch.sampler];
      const times = readAccessor(model, s.input);
      const values = readAccessor(model, s.output);
      const path = ch.target.path;
      if (!times || !values) continue;
      channels.push({
        node: ch.target.node | 0,
        path,
        comps: path === "rotation" ? 4 : 3,
        interp: s.interpolation || "LINEAR",
        times: times instanceof Float32Array ? times : Float32Array.from(times),
        values,
      });
    }
    let dur = 0;
    for (const ch of channels) if (ch.times.length) dur = Math.max(dur, ch.times[ch.times.length - 1]);
    return { index: i, name: a.name || `clip ${i}`, dur, channels };
  });
  // mesh-local boxes (accessor min/max, or a scan) for pose bounds
  for (const mesh of model.meshes) {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.prims) {
      if (!p.pos.length) continue;
      for (let i = 0; i < p.pos.length; i += 3) for (let c = 0; c < 3; c++) {
        const v = p.pos[i + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    mesh.min = min.every(Number.isFinite) ? min : [0, 0, 0];
    mesh.max = max.every(Number.isFinite) ? max : [0, 0, 0];
  }
  return model;
}

function walkParents(json, idx, parent, out) {
  out[idx] = parent;
  for (const c of json.nodes[idx]?.children || []) walkParents(json, c, idx, out);
}

/** One accessor as a typed array (de-interleaved when the bufferView says so). */
export function readAccessor(model, idx) {
  if (idx == null) return null;
  if (model.accessors.has(idx)) return model.accessors.get(idx);
  const g = model.json, a = g.accessors?.[idx];
  if (!a || a.bufferView == null) return null;
  const info = COMPONENT[a.componentType];
  if (!info) throw new Error(`accessor ${idx}: componentType ${a.componentType}`);
  const comps = COMPONENTS[a.type] || 1;
  const bv = g.bufferViews[a.bufferView];
  let bytes = model.buffers.get(bv.buffer);
  if (!bytes) {
    bytes = dataUri(g.buffers[bv.buffer]?.uri);
    if (!bytes) throw new Error(`buffer ${bv.buffer} is not embedded`);
    model.buffers.set(bv.buffer, bytes);
  }
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const elem = comps * info.size;
  const stride = bv.byteStride && bv.byteStride !== elem ? bv.byteStride : elem;
  const out = new info.Ctor(a.count * comps);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const norm = a.normalized && info.norm ? info.norm : 0;
  for (let i = 0; i < a.count; i++) {
    const at = base + i * stride;
    for (let c = 0; c < comps; c++) {
      const v = dv[info.get](at + c * info.size, true);
      out[i * comps + c] = norm ? v / norm : v;
    }
  }
  model.accessors.set(idx, out);
  return out;
}

// ── posing (local TRS per node, then world matrices) ────────────────────────────────────────────
export function bindPose(model) {
  const n = model.nodes.length;
  const pose = {
    model,
    t: new Float32Array(n * 3), r: new Float32Array(n * 4), s: new Float32Array(n * 3),
    world: new Float32Array(n * 16), n,
  };
  model.nodes.forEach((node, i) => {
    pose.t.set(node.translation || [0, 0, 0], i * 3);
    pose.r.set(node.rotation || [0, 0, 0, 1], i * 4);
    pose.s.set(node.scale || [1, 1, 1], i * 3);
  });
  return pose;
}

export function composeTRS(t, r, s, out = new Float32Array(16)) {
  const x = r[0], y = r[1], z = r[2], w = r[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[0], sy = s[1], sz = s[2];
  out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx; out[3] = 0;
  out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
  out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}

export function mat4Mul(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}

export function updateWorld(pose) {
  const local = new Float32Array(16);
  const walk = (i, parent) => {
    composeTRS(pose.t.subarray(i * 3, i * 3 + 3), pose.r.subarray(i * 4, i * 4 + 4), pose.s.subarray(i * 3, i * 3 + 3), local);
    const out = pose.world.subarray(i * 16, i * 16 + 16);
    if (parent) mat4Mul(parent, local, out); else out.set(local);
    for (const c of pose.model.nodes[i].children || []) walk(c, out);
  };
  for (const r of pose.model.roots) walk(r, null);
  return pose.world;
}

/** Sample a clip onto a fresh bind pose (a channel only touches its own node). */
export function sampleClipPose(model, clipIndex, timeSec) {
  const pose = bindPose(model);
  const clip = model.anims[clipIndex];
  if (clip) {
    for (const ch of clip.channels) applyChannel(pose, ch, Math.max(0, timeSec || 0));
  }
  updateWorld(pose);
  return pose;
}

function applyChannel(pose, ch, time) {
  const { times, values, comps } = ch;
  const n = times.length;
  if (!n) return;
  const dst = ch.path === "rotation" ? pose.r : ch.path === "translation" ? pose.t : pose.s;
  const off = ch.node * comps;
  const put = (i) => { for (let c = 0; c < comps; c++) dst[off + c] = values[i * comps + c]; };
  if (n === 1 || time <= times[0]) return put(0);
  if (time >= times[n - 1]) return put(n - 1);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
  if (ch.interp === "STEP") return put(lo);
  const a = times[hi] > times[lo] ? (time - times[lo]) / (times[hi] - times[lo]) : 0;
  for (let c = 0; c < comps; c++) dst[off + c] = values[lo * comps + c] + (values[hi * comps + c] - values[lo * comps + c]) * a;
  if (ch.path === "rotation") {                                  // shortest-arc nlerp, then normalise
    let d = 0;
    for (let c = 0; c < 4; c++) d += values[lo * 4 + c] * values[hi * 4 + c];
    if (d < 0) for (let c = 0; c < 4; c++) dst[off + c] = values[lo * 4 + c] - (values[lo * 4 + c] + values[hi * 4 + c]) * a;
    let len = 0;
    for (let c = 0; c < 4; c++) len += dst[off + c] * dst[off + c];
    len = Math.sqrt(len) || 1;
    for (let c = 0; c < 4; c++) dst[off + c] /= len;
  }
}

const point = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/** World-space AABB of a pose (each mesh's local box through its node's world matrix). */
export function poseBounds(model, pose, out = {}) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  model.nodes.forEach((node, i) => {
    if (node.mesh == null) return;
    const mesh = model.meshes[node.mesh];
    if (!mesh) return;
    const m = pose.world.subarray(i * 16, i * 16 + 16);
    for (let c = 0; c < 8; c++) {
      const p = point(m, c & 1 ? mesh.max[0] : mesh.min[0], c & 2 ? mesh.max[1] : mesh.min[1], c & 4 ? mesh.max[2] : mesh.min[2]);
      for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
    }
  });
  if (!min.every(Number.isFinite)) { min.fill(0); max.fill(0); }
  out.min = min; out.max = max;
  out.center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  out.size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return out;
}

// ── what the rig IS, measured: leg chains, feet, forward axis, back height ──────────────────────
/**
 * Measure a DW2 rig from its bind pose alone.
 *
 *   legs    one entry per leg chain found by walking down from the body root: { hip, end, depth }
 *           (a chain of >= 2 joints hanging below the body's middle; the DW2 rigs put each leg's mesh
 *           on the chain's last bone)
 *   feet    the chain-end joint indices, ordered by bind-pose z (front pair first)
 *   forward the unit vector (model space) the model faces, measured as the horizontal axis from the
 *           body's centroid to the HEAD joint — the leaf joint highest up that no leg contains
 *   height  the bind-pose height in model units
 *   back    the body-root joint's bind-pose y, i.e. where a rider sits in model units
 */
export function measureRig(model) {
  const bind = bindPose(model);
  updateWorld(bind);
  const bounds = poseBounds(model, bind);
  const H = bounds.size[1] || 1;
  const nodes = model.nodes;
  const joints = (model.json.skins?.[0]?.joints || nodes.map((_, i) => i)).filter((i) => nodes[i]?.mesh == null);
  const jointSet = new Set(joints);
  // the body root: the joint with the most descendants
  const countChildren = (i) => (nodes[i].children || []).reduce((s, c) => s + 1 + countChildren(c), 0);
  let body = joints[0], best = -1;
  for (const j of joints) { const d = countChildren(j); if (d > best) { best = d; body = j; } }
  // leg chains: from every root's children, walk to the chain end. A LEG is a chain of >= 3 joints whose
  // end hangs in the lower half of the model (the DW2 rigs also hang a 1-2 joint tail and armour pieces off
  // the roots, and those must not be walked).
  const legs = [];
  const walk = (i, chain) => {
    chain.push(i);
    const kids = (nodes[i].children || []).filter((c) => jointSet.has(c));
    if (!kids.length) return;
    for (const k of kids) walk(k, chain);
  };
  for (const root of model.roots) {
    for (const c of (nodes[root].children || []).filter((x) => jointSet.has(x))) {
      const chain = [];
      walk(c, chain);
      legs.push({ chain, end: chain[chain.length - 1], top: chain[0], root });
    }
  }
  const legsBelow = legs.filter((L) => L.chain.length >= 3
    && bind.world[L.end * 16 + 13] < bounds.min[1] + 0.4 * H            // the end hangs low
    && bind.world[L.end * 16 + 13] < bind.world[L.top * 16 + 13]);      // and the chain descends to it
  const feet = legsBelow.map((L) => L.end);
  // head: the highest joint that is not on a leg
  const legNodes = new Set(legsBelow.flatMap((L) => L.chain));
  let head = -1, headY = -Infinity;
  for (const j of joints) {
    if (legNodes.has(j) || j === body) continue;
    const y = bind.world[j * 16 + 13];
    if (y > headY) { headY = y; head = j; }
  }
  // forward: from the body's centroid toward the head, on the horizontal plane, as the dominant axis
  let fwd = [0, 0, 0];
  if (head >= 0) {
    const dx = bind.world[head * 16 + 12] - bind.world[body * 16 + 12];
    const dz = bind.world[head * 16 + 14] - bind.world[body * 16 + 14];
    if (Math.abs(dx) > Math.abs(dz)) fwd = [Math.sign(dx), 0, 0];
    else fwd = [0, 0, Math.sign(dz)];
  }
  return {
    height: H,
    body,
    legs: legsBelow.map((L) => ({ hip: L.top, end: L.end, depth: L.chain.length, chain: L.chain })),
    feet,
    head,
    forward: fwd,
    forwardAxis: fwd[0] !== 0 ? "x" : "z",
    back: bind.world[body * 16 + 13] + H * 0.16,          // the rider sits a little above the body root
    bounds,
    bind,
  };
}

// ── the gait: swing each leg chain about the axis that moves its foot ALONG the model's forward axis ──
/**
 * Calibrate a gait for a measured rig: for every leg, find the local rotation axis (in the hip's parent
 * space) that swings the foot farthest along the model's forward axis, and the sign that swings it forward.
 * This is measured, not assumed: the DW2 rigs bind their bones with non-identity rotations, so "rotate
 * about X" is wrong for some of them.
 */
export function calibrateGait(model, rig, swingDeg = 14) {
  const bind = rig.bind;
  const legs = rig.legs.map((L) => {
    const hip = L.hip;
    const parent = model.parents[hip];
    // world rotation of the hip's parent, inverted, so a model-space axis can be expressed in parent space
    const pw = parent >= 0 ? bind.world.subarray(parent * 16, parent * 16 + 16) : null;
    const axes = [];
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const local = pw ? worldVecToLocal(pw, axis) : axis;
      const probe = bindPose(model);
      rotateJoint(probe, hip, local, (swingDeg * Math.PI) / 180);
      updateWorld(probe);
      const d = [
        probe.world[L.end * 16 + 12] - bind.world[L.end * 16 + 12],
        probe.world[L.end * 16 + 14] - bind.world[L.end * 16 + 14],
      ];
      const along = rig.forwardAxis === "x" ? d[0] * rig.forward[0] : d[1] * rig.forward[2];
      axes.push({ axis: local, along });
    }
    axes.sort((a, b) => Math.abs(b.along) - Math.abs(a.along));
    const pick = axes[0];
    return { hip, end: L.end, axis: pick.axis, sign: pick.along >= 0 ? 1 : -1, swing: pick.along };
  });
  return legs;
}

function worldVecToLocal(m, v) {
  // inverse of the rotation part (a rigid transform): transpose
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
}

function rotateJoint(pose, node, axis, angle) {
  const q = quatFromAxis(axis, angle);
  const off = node * 4;
  const b = [pose.r[off], pose.r[off + 1], pose.r[off + 2], pose.r[off + 3]];
  const r = quatMul(q, b);                        // extra rotation applied in the bone's PARENT space
  pose.r[off] = r[0]; pose.r[off + 1] = r[1]; pose.r[off + 2] = r[2]; pose.r[off + 3] = r[3];
}

export function quatFromAxis(axis, angle) {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2);
  return [(axis[0] / len) * s, (axis[1] / len) * s, (axis[2] / len) * s, Math.cos(angle / 2)];
}

export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/**
 * One frame of the walk gait on a bind pose: four-beat footfall (LF, RF, LH, RH at 0, 1/2, 1/4, 3/4),
 * the hip swinging ±swing and the knee bending while the leg is in the air, plus the body's own bob.
 * `phase` is 0..1 of the cycle. Pure: no three.js, no clock, unit-testable.
 */
export function applyGait(pose, rig, legs, phase, { swing = 0.28, lift = 0.45, bob = 0.02 } = {}) {
  const order = [0, 0.5, 0.25, 0.75];            // the phases of the four legs, front pair first
  legs.forEach((L, i) => {
    const p = (phase + (order[i] ?? i / 4)) % 1;
    const angle = Math.sin(p * Math.PI * 2) * swing * L.sign;
    rotateJoint(pose, L.hip, L.axis, angle);
    if (L.chain && L.chain.length >= 2) {
      const knee = L.chain[L.chain.length - 2];
      // the knee bends while the foot is off the ground (the second half of the leg's cycle)
      const bend = Math.max(0, Math.sin(p * Math.PI * 2 + Math.PI)) * lift;
      rotateJoint(pose, knee, L.axis, bend * L.sign * 0.5);
    }
  });
  const bodyBob = Math.sin(phase * Math.PI * 4) * bob * rig.height;
  pose.t[rig.body * 3 + 1] += bodyBob;
  updateWorld(pose);
  return pose;
}

/** Where each foot is (model space) for a given gait phase — the footfall proof. */
export function gaitFootfalls(model, rig, legs, steps = 16) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const pose = bindPose(model);
    applyGait(pose, rig, legs, i / steps);
    out.push(legs.map((L) => [
      pose.world[L.end * 16 + 12], pose.world[L.end * 16 + 13], pose.world[L.end * 16 + 14],
    ]));
  }
  return out;
}

/**
 * Score one clip as a walk, from its joint data alone: is it in place, does it loop, do >= 2 feet alternate
 * between planted and lifted, and does a planted foot slide along the ground? Returns the numbers, so the
 * mount table's `walk` can be justified (or refused) instead of guessed.
 */
export function clipWalkStats(model, clipIndex, rig = null) {
  const clip = model.anims[clipIndex];
  if (!clip) return null;
  rig = rig || measureRig(model);
  const fps = 30;                                   // DW2 keys its clips at 1/30 s (measured: key step 0.033333)
  const nticks = Math.max(4, Math.round(clip.dur * fps));
  const P = [];
  for (let t = 0; t <= nticks; t++) {
    const pose = sampleClipPose(model, clipIndex, t / fps);
    P.push(rig.legs.map((L) => [pose.world[L.end * 16 + 12], pose.world[L.end * 16 + 13], pose.world[L.end * 16 + 14]]));
  }
  const H = rig.height || 1;
  if (rig.legs.length < 2) {
    return { clip: clip.name, dur: clip.dur, ticks: nticks + 1, inPlace: false, loops: false, loopErr: 0,
      bodyTravel: 0, feet: rig.legs.length, usableFeet: 0, alternation: 0, walk: false,
      why: "no measured leg chains" };
  }
  const bodyTravel = Math.max(...P.map((f, t) => Math.abs(f[0][0] - P[0][0][0])
    + Math.abs(f[0][2] - P[0][0][2])));
  let loopErr = 0;
  for (let i = 0; i < rig.legs.length; i++) {
    loopErr = Math.max(loopErr, Math.hypot(
      P[P.length - 1][i][0] - P[0][i][0], P[P.length - 1][i][1] - P[0][i][1], P[P.length - 1][i][2] - P[0][i][2]));
  }
  const feet = rig.legs.map((L, fi) => {
    const ys = P.map((f) => f[fi][1]);
    const yMin = Math.min(...ys), lift = Math.max(...ys) - yMin;
    const zs = P.map((f) => f[fi][rig.forwardAxis === "x" ? 0 : 2]);
    const vs = zs.map((z, t) => (t ? z - zs[t - 1] : 0));
    const vMax = Math.max(...vs.map(Math.abs), 1e-9);
    const low = ys.map((y) => y <= yMin + Math.max(0.06 * lift, 1e-6));
    const planted = low.map((l, t) => l && Math.abs(vs[t]) <= 0.3 * vMax);
    let runs = 0, was = false;
    for (const p of planted) { if (p && !was) runs++; was = p; }
    const stance = vs.filter((_, t) => planted[t]);
    return { lift, runs, duty: planted.filter(Boolean).length / planted.length,
      planted, slide: stance.length ? stance.reduce((a, c) => a + c, 0) / stance.length : 0 };
  });
  const usable = feet.filter((f) => f.runs >= 2 && f.duty >= 0.1 && f.lift > 0.04 * H);
  let alternation = 0;
  if (usable.length >= 2) {
    const [A, B] = usable.sort((a, c) => c.runs - a.runs || c.duty - a.duty);
    let only = 0;
    for (let t = 0; t < P.length; t++) if (A.planted[t] !== B.planted[t]) only++;
    alternation = only / P.length;
  }
  const inPlace = bodyTravel <= 0.06 * H;
  const loops = loopErr <= 0.03 * H;
  const walk = inPlace && loops && usable.length >= 2 && alternation >= 0.3
    && usable.some((f) => Math.abs(f.slide) >= 0.002 * H);
  return { clip: clip.name, dur: clip.dur, ticks: nticks + 1, inPlace, loops, loopErr, bodyTravel,
    feet: feet.length, usableFeet: usable.length, alternation, walk };
}

/** The clip index the table names, or -1 (the procedural gait is used then). */
export function walkClipIndex(model, walk) {
  if (!walk || walk.kind !== "clip") return -1;
  const i = model.anims.findIndex((a) => a.name === walk.name);
  return i;
}

// ── three.js: geometry, material, render, pixel pass ────────────────────────────────────────────
// uCut is a plane in world space (xyz normal, w constant): a fragment whose signed distance is below 0 is cut away.
// (0,0,0,1) keeps everything. The rider split renders once more with the plane through the saddle, facing the
// camera, keeping only what lies nearer the camera than the rider. The distance is linear, so the varying is exact.
const VERT = `
  uniform vec4 uCut;
  varying vec2 vUV;
  varying vec3 vNrm;
  varying float vCut;
  void main() {
    vNrm = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz) * normal;
    vUV = uv;
    vCut = dot(uCut.xyz, (modelMatrix * vec4(position, 1.0)).xyz) + uCut.w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FRAG = `
  precision mediump float;
  uniform sampler2D uTex;
  uniform float uAlphaCut;
  varying vec2 vUV;
  varying vec3 vNrm;
  varying float vCut;
  void main() {
    if (vCut < 0.0) discard;
    vec4 c = texture2D(uTex, vUV);
    if (c.a < uAlphaCut) discard;
    vec3 L = normalize(vec3(0.35, 0.80, 0.48));
    float d = abs(dot(normalize(vNrm), L));
    // flat lighting: a narrow band, so the palette pass lands on 3-4 shades per material
    vec3 rgb = c.rgb * mix(0.66, 1.0, floor(d * 3.0 + 0.5) / 3.0);
    gl_FragColor = vec4(rgb, 1.0);
  }`;

let renderer = null, scene = null, camera = null;
const loaded = new Map();        // model path -> { model, rig, legs, group, meshes, texture } | null

function ensureRenderer() {
  if (renderer) return true;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = MOUNT_VIEW.w;
    canvas.height = MOUNT_VIEW.h;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(MOUNT_VIEW.w, MOUNT_VIEW.h, false);
    renderer.setClearColor(0x000000, 0);
  } catch (e) {
    console.warn("mount3d: WebGL unavailable", e);
    renderer = null;
    return false;
  }
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(0, MOUNT_VIEW.w, 0, -MOUNT_VIEW.h, -1e5, 1e5);
  camera.rotation.x = -PITCH;
  return true;
}

async function imageFrom(uri) {
  const img = new Image();
  img.src = uri;
  if (img.decode) { try { await img.decode(); } catch { return null; } } else {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  }
  return img;
}

/**
 * Load one mount model from `url` (a path under web/, git-ignored, never shipped). Returns null when the
 * file is not there, so the mount feature hides itself and nothing else breaks.
 */
const loading = new Map();       // key -> the in-flight load, so two callers share one copy
export function loadMountAsset(key, url) {
  if (loaded.has(key)) return Promise.resolve(loaded.get(key));
  if (!loading.has(key)) loading.set(key, loadMountAssetOnce(key, url).finally(() => loading.delete(key)));
  return loading.get(key);
}

async function loadMountAssetOnce(key, url) {
  let asset = null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const model = parseDw2Gltf(await res.json());
    const rig = measureRig(model);
    const legs = calibrateGait(model, rig);
    if (!ensureRenderer()) throw new Error("no WebGL");
    const group = new THREE.Group();
    const meshes = [];
    const material = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null }, uAlphaCut: { value: 0.5 }, uCut: { value: new THREE.Vector4(0, 0, 0, 1) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    const image = model.images[0]?.uri ? await imageFrom(model.images[0].uri) : null;
    let texture = null;
    if (image) {
      texture = new THREE.Texture(image);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      // glTF UVs put v = 0 on the image's TOP row; three flips textures by default, which sent 328QUNI's
      // triangles onto see-through texels (0% opaque flipped vs 97% as glTF reads V) and 033UNIM's onto wrong colours
      texture.flipY = false;
      texture.needsUpdate = true;
      material.uniforms.uTex.value = texture;
    }
    // one mesh per primitive, parented to a group per bone node (three composes the hierarchy for us)
    const boneGroups = new Map();
    const groupOf = (node) => {
      if (boneGroups.has(node)) return boneGroups.get(node);
      const obj = new THREE.Object3D();
      obj.matrixAutoUpdate = false;
      obj.__node = node;
      boneGroups.set(node, obj);
      const parent = model.parents[node];
      (parent >= 0 ? groupOf(parent) : group).add(obj);
      return obj;
    };
    model.nodes.forEach((node, i) => {
      if (node.mesh == null) return;
      groupOf(i);                       // the bone's own group exists even if it holds no primitive
      const parent = groupOf(i);
      for (const prim of model.meshes[node.mesh].prims) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(prim.pos, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(prim.nrm || new Float32Array(prim.count * 3).fill(0), 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(prim.uv || new Float32Array(prim.count * 2), 2));
        geo.boundingSphere = null;
        const mesh = new THREE.Mesh(geo, material);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        parent.add(mesh);
        meshes.push(mesh);
      }
    });
    // scale so the model stands `size` game pixels tall, and put its feet on y = 0 / the ground point
    asset = { model, rig, legs, group, meshes, texture, material };
    scene.add(group);
  } catch (e) {
    console.warn(`mount3d: ${url} not loaded (${e.message}); the mount stays hidden`);
    asset = null;
  }
  loaded.set(key, asset);
  return asset;
}

const _m = new THREE.Matrix4();

/**
 * Render one frame of a mount standing at field pixel (x, y), facing `dir` (an 8-way field direction
 * name). Returns the hidden canvas (MOUNT_VIEW sized, palette-quantised, outlined) or null.
 */
function standFloor(asset, walk) {
  if (!walk?.idle) return null;
  asset._floor ??= {};
  if (!(walk.idle in asset._floor)) {
    const i = asset.model.anims.findIndex((a) => a.name === walk.idle);
    asset._floor[walk.idle] = i >= 0 ? poseBounds(asset.model, sampleClipPose(asset.model, i, 0)).min[1] : null;
  }
  return asset._floor[walk.idle];
}

export function renderMount(asset, { x, y, dir = "down", phase = 0, moving = false, size = 64, timeSec = 0, walk = null, still = null, seat = null, hide = null }) {
  if (!asset || !ensureRenderer()) return null;
  const { model, rig, legs, group } = asset;
  // A model whose own clip passed the walk test (clipWalkStats) walks with that clip; otherwise the gait
  // web/mount3d.js calibrated from this very rig drives the legs.
  const clipIndex = walkClipIndex(model, walk);
  const clip = clipIndex >= 0 ? model.anims[clipIndex] : null;
  let pose;
  const stillIndex = still ? model.anims.findIndex((a) => a.name === still.clip) : -1;
  // a held frame of one of the model's own clips (`still.at` 0..1, 1 = the clip's last frame): a pose, not a motion
  if (stillIndex >= 0) pose = sampleClipPose(model, stillIndex, (still.at ?? 1) * model.anims[stillIndex].dur);
  else if (moving && clip) pose = sampleClipPose(model, clipIndex, (phase % 1) * clip.dur);
  else if (moving) pose = applyGait(bindPose(model), rig, legs, phase % 1);
  else if (walk?.idle && model.anims.some((a) => a.name === walk.idle)) {
    // standing: the model's own idle clip, looped
    const ii = model.anims.findIndex((a) => a.name === walk.idle);
    pose = sampleClipPose(model, ii, timeSec % model.anims[ii].dur);
  } else {
    // standing: the bind pose, with a slow breath in the body root
    pose = bindPose(model);
    pose.t[rig.body * 3 + 1] += Math.sin(timeSec * 1.7) * rig.height * 0.004;
    updateWorld(pose);
  }
  // push the pose into the three hierarchy: each bone group takes its LOCAL TRS, three composes the tree
  for (const [node, obj] of boneObjects(asset)) {
    const o = node * 3, q = node * 4;
    _t.set(pose.t[o], pose.t[o + 1], pose.t[o + 2]);
    _q.set(pose.r[q], pose.r[q + 1], pose.r[q + 2], pose.r[q + 3]);
    _s.set(pose.s[o], pose.s[o + 1], pose.s[o + 2]);
    obj.matrix.compose(_t, _q, _s);
    obj.matrixWorldNeedsUpdate = true;
  }
  // scale + ground the model: feet on the ground point, `size` pixels tall
  const b = rig.bounds;
  const scale = size / (b.size[1] || 1);
  const facing = { down: 0, "down-left": -Math.PI / 4, left: -Math.PI / 2, "up-left": (-3 * Math.PI) / 4,
    up: Math.PI, "up-right": (3 * Math.PI) / 4, right: Math.PI / 2, "down-right": Math.PI / 4 }[dir] ?? 0;
  // every loaded model sits in the one shared scene; only the one asked for may appear in this render
  for (const kid of scene.children) kid.visible = kid === group;
  // a verifier may leave named bones out of the render (which part covers the rider?)
  for (const [node, obj] of boneObjects(asset)) obj.visible = !hide?.includes(node);
  group.scale.setScalar(scale);
  group.rotation.y = facing;
  // a held frame (lying down) is grounded on its OWN lowest point; the scale stays the standing body's
  // a model with its own stand clip keeps that clip's floor (DW2 field models: hooves at y 0 in anim_E0, while the
  // bind pose reaches -369, which floated the mount ~12 px); one value per asset, so a gallop's leap still leaves it
  const ground = stillIndex >= 0 ? poseBounds(model, pose).min[1] : standFloor(asset, walk) ?? b.min[1];
  group.position.set(x, -ground * scale, y / SIN);
  // the camera window: `x` centred, the ground row `y` near the bottom of the cell
  camera.left = x - MOUNT_VIEW.w / 2;
  camera.right = x + MOUNT_VIEW.w / 2;
  camera.top = -y + MOUNT_VIEW.h - 8;
  camera.bottom = -y - 8;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const out = pixelate(renderer.domElement);
  lastSplit = seat ? splitAtSeat(asset, out, seat) : null;
  return out;
}

// ── the rider split: the mount cut in two at the saddle, so the rider draws between the halves ──────────
const _seat = new THREE.Vector3(), _view = new THREE.Vector3();
const splitCanvases = typeof document !== "undefined"
  ? { back: document.createElement("canvas"), front: document.createElement("canvas"), read: document.createElement("canvas") } : null;
let lastSplit = null;

/** The last renderMount's split (null when it was rendered without `seat`): { back, front, seatX, seatY }. */
export function mountSplit() { return lastSplit; }

/**
 * Cut the pixelated render `pix` in two by depth. The rider is a flat sprite standing on the saddle point
 * (`seat.at`, local to bone `seat.node`, so it rides the pose), facing the camera. A pixel goes FRONT when the
 * nearest surface under it lies nearer the camera than that plane (one more render that keeps only those
 * fragments: along an orthographic ray a near fragment is always nearer than any far one), BACK otherwise.
 * An outline pixel follows a front neighbour. seatX/seatY are the saddle point in cell pixels.
 */
function splitAtSeat(asset, pix, seat) {
  const obj = boneObjects(asset).get(seat.node);
  if (!obj || !splitCanvases) return null;
  const w = MOUNT_VIEW.w, h = MOUNT_VIEW.h;
  asset.group.updateMatrixWorld(true);
  _seat.set(seat.at[0], seat.at[1], seat.at[2]);
  obj.localToWorld(_seat);
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_view);                  // unit, from the camera into the scene
  // The rider is an UPRIGHT figure, so his plane is vertical: only the view's ground direction counts. A plane
  // facing the 50 deg camera leans back instead, and every high part (Unimon's head, facing up) came out "nearer"
  // than the rider's head: sin50 * height above the saddle beat cos50 * distance behind him.
  _view.y = 0;
  _view.normalize();
  // keep dot(p - R, view) < 0 (nearer than R): the cut keeps dot(-view, p) + dot(view, R) >= 0
  const cut = asset.material.uniforms.uCut.value;
  cut.set(-_view.x, -_view.y, -_view.z, _view.dot(_seat));
  renderer.render(scene, camera);
  cut.set(0, 0, 0, 1);
  const rd = splitCanvases.read;
  if (rd.width !== w || rd.height !== h) { rd.width = w; rd.height = h; }
  const rc = rd.getContext("2d", { willReadFrequently: true });
  rc.clearRect(0, 0, w, h);
  rc.drawImage(renderer.domElement, 0, 0);
  const near = rc.getImageData(0, 0, w, h).data;
  const src = pix.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
  const s = src.data;
  const isNear = (p) => near[p * 4 + 3] >= 40;     // the same solid test as pixelate()
  const front = new ImageData(w, h), back = new ImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4;
    if (s[i + 3] === 0) continue;
    // a body pixel goes by its own nearest surface; an outline pixel (no surface under it) goes front with a near neighbour
    const f = lastSolid?.[p] ? isNear(p)
      : (x > 0 && isNear(p - 1)) || (x < w - 1 && isNear(p + 1)) || (y > 0 && isNear(p - w)) || (y < h - 1 && isNear(p + w));
    const d = f ? front.data : back.data;
    d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = s[i + 3];
  }
  for (const [k, img] of [["front", front], ["back", back]]) {
    const c = splitCanvases[k];
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext("2d", { willReadFrequently: true }).putImageData(img, 0, 0);
  }
  const ndc = _seat.clone().project(camera);
  return { back: splitCanvases.back, front: splitCanvases.front, seatX: ((ndc.x + 1) / 2) * w, seatY: ((1 - ndc.y) / 2) * h };
}

/** Render the mount's own scene and the same group in a fresh scene: narrows down an empty render. */
export function sceneProbe() {
  if (!ensureRenderer()) return null;
  const cam = new THREE.OrthographicCamera(0, MOUNT_VIEW.w, 0, -MOUNT_VIEW.h, -1e5, 1e5);
  cam.rotation.x = -PITCH;
  cam.updateMatrixWorld(true);
  renderer.render(scene, cam);
  const sameScene = renderer.info.render.calls;
  const g = scene.children[0];
  let info = null;
  if (g) g.traverse((o) => { if (!info && o.isMesh) info = { pos: o.geometry?.attributes?.position?.count ?? null, idx: !!o.geometry?.index, range: o.geometry?.drawRange?.count ?? null, mw: Array.from(o.matrixWorld?.elements?.slice(12, 15) ?? []) }; });
  let freshScene = null;
  if (g) {
    const s2 = new THREE.Scene();
    s2.add(g);
    renderer.render(s2, cam);
    freshScene = renderer.info.render.calls;
    scene.add(g);
  }
  return { sameScene, freshScene, info, camWorld: Array.from(cam.matrixWorld.elements.slice(0, 16)) };
}

/** Render a plain box through the same renderer: isolates "the renderer draws" from "this model draws". */
export function renderSelfTest() {
  if (!ensureRenderer()) return null;
  const s = new THREE.Scene();
  const m = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
  m.position.set(56, 0, 60);
  s.add(m);
  const cam = new THREE.OrthographicCamera(0, MOUNT_VIEW.w, 0, -MOUNT_VIEW.h, -1e5, 1e5);
  cam.rotation.x = -PITCH;
  renderer.render(s, cam);
  const gl = renderer.getContext();
  const buf = new Uint8Array(MOUNT_VIEW.w * MOUNT_VIEW.h * 4);
  gl.readPixels(0, 0, MOUNT_VIEW.w, MOUNT_VIEW.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let alpha = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) alpha++;
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, alpha };
}

/** Read the renderer's own framebuffer (not a 2D copy): how many pixels the last render actually wrote. */
export function probeFramebuffer() {
  if (!renderer) return null;
  const gl = renderer.getContext();
  const w = renderer.domElement.width, h = renderer.domElement.height;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let alpha = 0, rgb = 0;
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] > 0) alpha++;
    if (buf[i] + buf[i + 1] + buf[i + 2] > 0) rgb++;
  }
  return { w, h, alpha, rgb, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
}

/** What the last render submitted (numbers only: the tests and verifier read this, never a picture). */
export function mountRenderInfo() {
  let meshes = 0, visibleMeshes = 0, depth = 0, matVisible = 0, layerMask = 0;
  const walk = (o, d) => {
    depth = Math.max(depth, d);
    if (o.isMesh) {
      meshes++;
      if (o.visible) visibleMeshes++;
      if (o.material?.visible !== false) matVisible++;
      layerMask |= o.layers?.mask ?? 0;
    }
    for (const c of o.children) walk(c, d + 1);
  };
  if (scene) walk(scene, 0);
  return {
    calls: renderer?.info?.render?.calls ?? 0,
    tris: renderer?.info?.render?.triangles ?? 0,
    sceneKids: scene?.children.length ?? -1,
    kidKids: scene?.children.map((c) => c.children.length) ?? [],
    cam: camera ? [camera.left, camera.right, camera.top, camera.bottom] : null,
    gl: renderer ? `${renderer.domElement.width}x${renderer.domElement.height}` : null,
    meshes, visibleMeshes, depth,
    matVisible, layerMask, camMask: camera?.layers?.mask ?? null,
    groupVisible: scene?.children[0]?.visible ?? null,
    lost: renderer?.getContext?.()?.isContextLost?.() ?? null,
    programs: renderer?.info?.programs?.length ?? null,
  };
}

const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();

function boneObjects(asset) {
  if (!asset._bones) {
    const map = new Map();
    const walk = (obj) => {
      if (obj.__node != null) map.set(obj.__node, obj);
      for (const child of obj.children) walk(child);
    };
    walk(asset.group);
    asset._bones = map;
  }
  return asset._bones;
}

// ── palette + outline (the pixel look) ───────────────────────────────────────────────────────────
const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;
let lastSolid = null;            // the last pixelate()'s body mask (1 = a rendered surface, 0 = empty or outline)

/** Map the render to the fixed palette and add a 1 px outline around the silhouette. */
export function pixelate(srcCanvas) {
  if (!scratch) return srcCanvas;
  const w = srcCanvas.width, h = srcCanvas.height;
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const c2 = scratch.getContext("2d", { willReadFrequently: true });
  c2.clearRect(0, 0, w, h);
  c2.drawImage(srcCanvas, 0, 0);
  const img = c2.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  lastSolid = solid;
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    if (d[i + 3] < 40) { d[i + 3] = 0; continue; }
    solid[p] = 1;
    const [r, g, b] = nearestPalette(d[i], d[i + 1], d[i + 2]);
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  // outline: any empty pixel that touches a solid one becomes the outline colour
  const out = new Uint8Array(solid);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (solid[p]) continue;
    if ((x > 0 && solid[p - 1]) || (x < w - 1 && solid[p + 1]) ||
        (y > 0 && solid[p - w]) || (y < h - 1 && solid[p + w])) {
      const i = p * 4;
      d[i] = OUTLINE[0]; d[i + 1] = OUTLINE[1]; d[i + 2] = OUTLINE[2]; d[i + 3] = 255;
      out[p] = 1;
    }
  }
  c2.putImageData(img, 0, 0);
  return scratch;
}

/** The palette index nearest to an RGB triple (Euclidean in RGB; the palette is small and spread out). */
export function nearestPalette(r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const p = PALETTE[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const dd = dr * dr + dg * dg + db * db;
    if (dd < bestD) { bestD = dd; best = i; }
  }
  return PALETTE[best];
}

/** How many model pixels are on screen (tests/verify use the number, never a picture). */
export function solidPixelCount(canvas) {
  if (!canvas || !canvas.getContext) return 0;
  const c2 = canvas.getContext("2d", { willReadFrequently: true });
  const d = c2.getImageData(0, 0, canvas.width, canvas.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
}
