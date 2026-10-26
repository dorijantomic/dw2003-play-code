// DW2 model support for the animation viewer (web/anim-viewer.html) — K21b.
//
// Digimon World 2's models are NOT DW3 models: they are one glTF 2.0 file per character, written by
// the community converter (asset.generator "dw2_model_converter"), with every buffer and the texture
// embedded as base64 data URIs. The rig is RIGID: no JOINTS_0/WEIGHTS_0, no primitive indices — one
// non-indexed triangle list per bone, parented under `bone_N` nodes, and the clips animate those
// nodes' TRS. So "skinning" here is just the node hierarchy: pose = compose(TRS per node) down the
// tree, and each mesh draws with its own bone's world matrix. That is why this module has no
// three.js: the whole loader is accessor decoding + a TRS walk + one textured draw per mesh.
//
// Everything here is dev-only: the model files live OUTSIDE the repo (see the viewer's `?src=dw2`
// source and the `web/dw2-models` symlink, git-excluded in .git/info/exclude), and this module never
// ships them — it fetches from the local mount the page is served from.
//
// Pure parts (index building, glTF parsing, clip sampling, bounds) are importable in node so
// tests/anim-viewer-dw2.test.js can prove them without a browser. Only createDw2Renderer touches WebGL.

export const DW2_DEFAULT_ROOT = "dw2-models";

// ── the local index ─────────────────────────────────────────────────────────────────────────────
/**
 * Normalise the dev index (~/dw2-models/index.json, built by k21b/make_index.py from the K21a
 * inventory). One entry per glTF file; `path` is relative to the mount's `root` directory.
 */
export function buildDw2Index(inv, { root = null } = {}) {
  const models = (inv?.models || [])
    .filter((m) => m && m.path)
    .map((m) => ({
      path: String(m.path),
      name: String(m.name || m.species || m.path),
      stage: String(m.stage || "?"),
      species: m.species || null,
      sub: m.sub || null,
      code: m.code || null,
      joints: m.joints | 0,
      meshes: m.meshes | 0,
      prims: m.prims | 0,
      materials: m.materials | 0,
      bytes: m.bytes | 0,
      anims: Array.isArray(m.anims) ? m.anims.slice() : [],
      durs: Array.isArray(m.durs) ? m.durs.slice() : [],
    }))
    .sort((a, b) => a.stage.localeCompare(b.stage) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  const stages = {};
  for (const m of models) stages[m.stage] = (stages[m.stage] || 0) + 1;
  return { root: root || inv?.root || "extract", count: models.length, stages, models };
}

/** Case-insensitive substring search over the display name, the folder and the file code. */
export function matchesDw2Query(entry, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return `${entry.name} ${entry.path} ${entry.code || ""}`.toLowerCase().includes(q);
}

/** The list's filters: free-text query + stage. */
export function filterDw2(models, { query = "", stage = "" } = {}) {
  return (models || []).filter((m) => (stage ? m.stage === stage : true) && matchesDw2Query(m, query));
}

// ── glTF decoding ───────────────────────────────────────────────────────────────────────────────
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT = {
  5120: { ctor: Int8Array, get: "getInt8", size: 1, norm: 127 },
  5121: { ctor: Uint8Array, get: "getUint8", size: 1, norm: 255 },
  5122: { ctor: Int16Array, get: "getInt16", size: 2, norm: 32767 },
  5123: { ctor: Uint16Array, get: "getUint16", size: 2, norm: 65535 },
  5125: { ctor: Uint32Array, get: "getUint32", size: 4, norm: 0 },
  5126: { ctor: Float32Array, get: "getFloat32", size: 4, norm: 0 },
};

/** base64 → bytes, in a browser or in node (unit tests). */
export function decodeBase64(b64) {
  if (typeof atob === "function") {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  // eslint-disable-next-line no-undef
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function decodeUri(uri) {
  const s = String(uri || "");
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(s);
  if (!m) return { external: s, bytes: null };
  return m[2] ? { external: null, bytes: decodeBase64(m[3]) } : { external: null, bytes: null, text: decodeURIComponent(m[3]) };
}

/**
 * Parse a self-contained glTF 2.0 file (the DW2 converter's output) into the shapes this viewer
 * needs. Throws a plain-language error on anything else, so the UI can say what is wrong instead of
 * failing in the renderer.
 */
export function parseGltf(json) {
  if (!json || !Array.isArray(json.nodes) || !Array.isArray(json.meshes)) throw new Error("not a glTF: no nodes/meshes");
  const buffers = (json.buffers || []).map((b, i) => {
    const d = decodeUri(b.uri);
    if (!d.bytes) throw new Error(`buffer ${i} is not embedded (${b.uri || "no uri"}); this viewer only reads self-contained files`);
    return d.bytes;
  });
  const model = {
    json,
    buffers,
    gen: json.asset?.generator || "?",
    // node -> parent (the glTF stores children only)
    parent: new Int32Array(json.nodes.length).fill(-1),
    roots: [],
    accessors: new Map(),
    meshes: [],
    materials: [],
    images: [],
    anims: [],
    texts: (json.textures || []).length,
  };
  const scene = json.scenes?.[json.scene ?? 0];
  model.roots = (scene?.nodes || []).slice();
  for (const rootIdx of model.roots) walkParents(json, rootIdx, -1, model.parent);
  // nodes that no scene root reaches still exist in the array; treat them as their own roots
  for (let i = 0; i < json.nodes.length; i++) if (model.parent[i] === -1 && !model.roots.includes(i)) model.roots.push(i);

  for (const m of json.meshes) {
    const prims = [];
    for (const p of m.primitives || []) {
      if ((p.mode ?? 4) !== 4) continue;                       // TRIANGLES only; DW2 writes nothing else
      if (p.indices != null) continue;                          // non-indexed in these files
      const pos = readAccessor(model, p.attributes.POSITION);
      const nrm = p.attributes.NORMAL != null ? readAccessor(model, p.attributes.NORMAL) : null;
      const uv = p.attributes.TEXCOORD_0 != null ? readAccessor(model, p.attributes.TEXCOORD_0) : null;
      if (!pos) continue;
      prims.push({
        pos, nrm, uv,
        posIdx: p.attributes.POSITION,
        count: p.attributes.POSITION != null ? (json.accessors[p.attributes.POSITION].count | 0) : 0,
        material: p.material ?? -1,
      });
    }
    model.meshes.push({ prims });
  }
  model.materials = (json.materials || []).map((m) => {
    const tex = m.pbrMetallicRoughness?.baseColorTexture?.index;
    const image = tex != null ? json.textures?.[tex]?.source ?? null : null;
    return {
      name: m.name || null,
      alphaMode: m.alphaMode || "OPAQUE",
      alphaCutoff: m.alphaCutoff != null ? +m.alphaCutoff : 0.5,
      blendMode: m.extras?.blend_mode ?? null,
      tex,
      image,
      baseColor: m.pbrMetallicRoughness?.baseColorFactor || null,
    };
  });
  model.images = (json.images || []).map((im) => ({ name: im.name || null, uri: im.uri || null }));
  model.anims = (json.animations || []).map((a, i) => ({
    index: i,
    name: a.name || `clip ${i}`,
    loopMask: a.extras?.loop_mask ?? null,
    termMask: a.extras?.termination_mask ?? null,
    channels: (a.channels || []).map((ch) => {
      const s = a.samplers[ch.sampler];
      const times = readAccessor(model, s.input);
      const values = readAccessor(model, s.output);
      const path = ch.target.path;
      return {
        node: ch.target.node | 0,
        path,
        comps: path === "rotation" ? 4 : 3,
        interp: s.interpolation || "LINEAR",
        times: times instanceof Float32Array ? times : Float32Array.from(times || []),
        values,
      };
    }),
  }));
  for (const a of model.anims) {
    let dur = 0;
    for (const ch of a.channels) if (ch.times.length) dur = Math.max(dur, ch.times[ch.times.length - 1]);
    a.dur = dur;
  }
  // local bind-pose bounds per mesh (accessor min/max when present, else a scan)
  model.meshes.forEach((mesh, mi) => {
    const prim = mesh.prims[0];
    if (!prim) { mesh.min = [0, 0, 0]; mesh.max = [0, 0, 0]; return; }
    const acc = json.accessors[prim.posIdx];
    let min = acc?.min, max = acc?.max;
    if (!min || !max) {
      min = [Infinity, Infinity, Infinity]; max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < prim.count; i++) for (let c = 0; c < 3; c++) {
        const v = prim.pos[i * 3 + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    mesh.min = min; mesh.max = max;
  });
  return model;
}

function walkParents(json, idx, parent, out) {
  out[idx] = parent;
  for (const c of json.nodes[idx]?.children || []) walkParents(json, c, idx, out);
}

/** Read one accessor into a typed array (de-interleaving when byteStride says so). */
export function readAccessor(model, idx) {
  if (idx == null) return null;
  model.accessors ||= new Map();
  const hit = model.accessors.get(idx);
  if (hit) return hit;
  const g = model.json, a = g.accessors?.[idx];
  if (!a || a.bufferView == null) return null;
  const info = COMPONENT[a.componentType];
  if (!info) throw new Error(`accessor ${idx}: componentType ${a.componentType} not supported`);
  const comps = COMPONENTS[a.type] || 1;
  const bv = g.bufferViews[a.bufferView];
  const bytes = model.buffers[bv.buffer];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const elem = comps * info.size;
  const stride = bv.byteStride && bv.byteStride !== 0 ? bv.byteStride : elem;
  const out = new info.ctor(a.count * comps);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const get = info.get;
  const norm = a.normalized && info.norm ? info.norm : 0;
  for (let i = 0; i < a.count; i++) {
    const at = base + i * stride;
    for (let c = 0; c < comps; c++) {
      const v = dv[get](at + c * info.size, true);
      out[i * comps + c] = norm ? v / norm : v;
    }
  }
  model.accessors.set(idx, out);
  return out;
}

/** The clip picker's list: name + duration, in the file's own order. */
export function clipList(model) {
  return (model?.anims || []).map((a) => ({
    index: a.index,
    name: a.name,
    dur: a.dur,
    channels: a.channels.length,
    loopMask: a.loopMask,
    termMask: a.termMask,
  }));
}

// ── posing (rigid: node TRS down the tree) ───────────────────────────────────────────────────────
/** Column-major TRS compose, the same layout as anim-viewer-camera.js. */
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

/** Column-major 4x4 product a·b. */
export function mat4Mul(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}

const point = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/** The bind pose (no clip): every node's own TRS from the file. */
export function bindPose(model) {
  const n = model.json.nodes.length;
  const pose = { model, t: new Float32Array(n * 3), r: new Float32Array(n * 4), s: new Float32Array(n * 3), n };
  model.json.nodes.forEach((node, i) => {
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    pose.t.set(t, i * 3); pose.r.set(r, i * 4); pose.s.set(s, i * 3);
  });
  pose.world = new Float32Array(n * 16);
  worldMatrices(pose);
  return pose;
}

/** Sample one channel at `time` (seconds) into the pose's local arrays. */
function applyChannel(pose, ch, time) {
  const { times, values, comps, interp } = ch;
  const n = times.length;
  if (!n) return;
  const dst = ch.path === "rotation" ? pose.r : ch.path === "translation" ? pose.t : pose.s;
  const off = ch.node * comps;
  const put = (i, a) => {
    if (interp === "CUBICSPLINE") {
      const base = i * comps * 3 + comps;                    // (inTangent, value, outTangent)
      for (let c = 0; c < comps; c++) dst[off + c] = values[base + c];
      return;
    }
    for (let c = 0; c < comps; c++) dst[off + c] = values[i * comps + c];
  };
  if (n === 1 || time <= times[0]) { put(0); return; }
  if (time >= times[n - 1]) { put(n - 1); return; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
  if (interp === "STEP") { put(lo); return; }
  const t0 = times[lo], t1 = times[hi];
  const a = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
  if (interp === "CUBICSPLINE") {                              // no tangents in these files; lerp the values
    const b0 = lo * comps * 3 + comps, b1 = hi * comps * 3 + comps;
    for (let c = 0; c < comps; c++) dst[off + c] = values[b0 + c] + (values[b1 + c] - values[b0 + c]) * a;
    return;
  }
  for (let c = 0; c < comps; c++) dst[off + c] = values[lo * comps + c] + (values[hi * comps + c] - values[lo * comps + c]) * a;
  if (ch.path === "rotation") {
    // nlerp with the shortest arc, then normalise (glTF LINEAR quaternions)
    let d = 0;
    for (let c = 0; c < 4; c++) d += values[lo * 4 + c] * values[hi * 4 + c];
    const sign = d < 0 ? -1 : 1;
    let len = 0;
    const q = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      q[c] = values[lo * 4 + c] + (values[hi * 4 + c] * sign - values[lo * 4 + c]) * a;
      len += q[c] * q[c];
    }
    len = Math.sqrt(len) || 1;
    for (let c = 0; c < 4; c++) dst[off + c] = q[c] / len;
  }
}

function worldMatrices(pose) {
  const model = pose.model;
  const nodes = model.json.nodes;
  const local = new Float32Array(16);
  const walk = (i, parentMat) => {
    const node = nodes[i];
    composeTRS(pose.t.subarray(i * 3, i * 3 + 3), pose.r.subarray(i * 4, i * 4 + 4), pose.s.subarray(i * 3, i * 3 + 3), local);
    const out = pose.world.subarray(i * 16, i * 16 + 16);
    if (parentMat) mat4Mul(parentMat, local, out); else out.set(local);
    for (const c of node.children || []) walk(c, out);
  };
  for (const r of model.roots) walk(r, null);
  return pose.world;
}

/**
 * Pose the model at `timeSec` of `clipIndex` (-1 = the bind pose). Returns the pose object with
 * `world` filled in; meshes draw with `pose.world[nodeIndex * 16 …]`.
 */
export function samplePose(model, clipIndex, timeSec) {
  const pose = bindPose(model);                    // fresh local TRS every call: a channel only touches its own node
  if (clipIndex != null && clipIndex >= 0 && model.anims[clipIndex]) {
    for (const ch of model.anims[clipIndex].channels) applyChannel(pose, ch, Math.max(0, timeSec || 0));
  }
  worldMatrices(pose);
  return pose;
}

/** World-space AABB of a pose (mesh-local boxes through each mesh node's world matrix). */
export function poseBounds(model, pose, out = {}) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  model.json.nodes.forEach((node, i) => {
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

/** Shift a pose in world space (applied to the root nodes, so every child follows) and re-pose it. */
export function offsetPose(model, pose, [dx, dy, dz] = [0, 0, 0]) {
  if (!dx && !dy && !dz) return pose;
  for (const r of model.roots) {
    pose.t[r * 3] += dx; pose.t[r * 3 + 1] += dy; pose.t[r * 3 + 2] += dz;
  }
  worldMatrices(pose);
  return pose;
}

/** Move a pose so the model stands with its lowest point at y=0 and its feet on the origin. */
export function groundPose(model, pose, { centerXZ = true } = {}) {
  const b = poseBounds(model, pose);
  const dy = -b.min[1];
  const dx = centerXZ ? -b.center[0] : 0;
  const dz = centerXZ ? -b.center[2] : 0;
  return offsetPose(model, pose, [dx, dy, dz]);
}

/** What the Info tab says about a file (all numbers measured, no labels invented). */
export function modelStats(model) {
  let prims = 0, tris = 0, verts = 0, textured = 0;
  for (const mesh of model.meshes) for (const p of mesh.prims) {
    prims++; tris += p.count / 3; verts += p.count;
    if (model.materials[p.material]?.image != null) textured++;
  }
  return {
    gen: model.gen,
    nodes: model.json.nodes.length,
    meshes: model.meshes.length,
    prims, tris, verts,
    materials: model.materials.length,
    textured,
    images: model.images.length,
    clips: model.anims.length,
    roots: model.roots.length,
    joints: model.json.skins?.[0]?.joints?.length ?? 0,
    hasIndices: (model.json.meshes || []).some((m) => (m.primitives || []).some((p) => p.indices != null)),
    hasSkinAttrs: (model.json.meshes || []).some((m) => (m.primitives || []).some((p) => p.attributes?.JOINTS_0 != null)),
  };
}

// ── the WebGL renderer (one textured pass over the rigid meshes) ────────────────────────────────
const VS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec2 aUV;
uniform mat4 uViewProj;
uniform mat4 uModel;
varying vec2 vUV;
varying vec3 vNrm;
void main() {
  vNrm = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNrm;
  vUV = aUV;
  gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
}`;
const FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uAlphaCut;
uniform vec3 uFlat;
varying vec2 vUV;
varying vec3 vNrm;
void main() {
  vec4 c = texture2D(uTex, vUV);
  if (c.a < uAlphaCut) discard;
  vec3 L = normalize(vec3(0.35, 0.78, 0.52));
  float d = abs(dot(normalize(vNrm), L));
  vec3 rgb = c.rgb * mix(uFlat, vec3(1.0), d);
  gl_FragColor = vec4(rgb, c.a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/**
 * A renderer over one WebGL1 canvas. `loadModel(url)` fetches + parses a glTF and uploads its
 * geometry and texture; `draw(model, pose, viewProj)` renders it. The page draws this canvas into
 * the viewer's own 2D canvas, so the HUD, screenshot and orbit controls all keep working.
 */
export function createDw2Renderer(canvas, { flat = 0.62 } = {}) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: true })
    || canvas.getContext("experimental-webgl", { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL unavailable");
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  const loc = {
    aPos: gl.getAttribLocation(program, "aPos"),
    aNrm: gl.getAttribLocation(program, "aNrm"),
    aUV: gl.getAttribLocation(program, "aUV"),
    uViewProj: gl.getUniformLocation(program, "uViewProj"),
    uModel: gl.getUniformLocation(program, "uModel"),
    uTex: gl.getUniformLocation(program, "uTex"),
    uAlphaCut: gl.getUniformLocation(program, "uAlphaCut"),
    uFlat: gl.getUniformLocation(program, "uFlat"),
  };
  const blank = { pos: new Float32Array(3), nrm: new Float32Array([0, 0, 1]), uv: new Float32Array(2) };

  const upload = (data, target, usage) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  };

  function makeTexture(img) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  async function loadImage(uri) {
    if (!uri) return null;
    const img = new Image();
    img.src = uri;
    if (img.decode) { try { await img.decode(); } catch { return null; } }
    else await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    return img;
  }

  const renderer = {
    canvas, gl, program,
    drawCalls: 0,

    /** Fetch + parse + upload one model. Rejects with a readable message on a bad file. */
    async loadModel(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const json = await res.json();
      const model = parseGltf(json);
      model.url = url;
      model.stats = modelStats(model);
      model.textures = [];
      for (const im of model.images) {
        if (!im.uri) { model.textures.push(null); continue; }
        const img = await loadImage(im.uri);
        model.textures.push(img ? makeTexture(img) : null);
        im.width = img?.naturalWidth || 0;
        im.height = img?.naturalHeight || 0;
      }
      // geometry: one buffer set per primitive, the draw list flattened
      model.draws = [];
      model.meshes.forEach((mesh, mi) => {
        model.json.nodes.forEach((node, ni) => {
          if (node.mesh !== mi) return;
          for (const p of mesh.prims) {
            p.gpu = {
              pos: upload(p.pos, gl.ARRAY_BUFFER, gl.STATIC_DRAW),
              nrm: upload(p.nrm || blank.nrm, gl.ARRAY_BUFFER, gl.STATIC_DRAW),
              uv: upload(p.uv || blank.uv, gl.ARRAY_BUFFER, gl.STATIC_DRAW),
            };
            const mat = model.materials[p.material] || {};
            model.draws.push({
              node: ni, prim: p,
              blend: mat.alphaMode === "BLEND",
              alphaCut: mat.alphaMode === "MASK" ? (mat.alphaCutoff ?? 0.5) : mat.alphaMode === "BLEND" ? 0.02 : 0,
              tex: mat.image != null ? model.textures[mat.image] || null : null,
            });
          }
        });
      });
      model.stats.draws = model.draws.length;
      model.stats.textureSizes = model.images.map((i) => (i.width ? `${i.width}x${i.height}` : "—")).join(" ");
      return model;
    },

    /** Render one pose. `viewProj` is the camera's column-major matrix; `bg` a CSS colour. */
    draw(model, pose, viewProj, { bg = "#0b0d12", tint = null } = {}) {
      const W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      const c = hexRgb(bg);
      gl.clearColor(c[0], c[1], c[2], 1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);                 // the DW2 rig flips handedness per bone (scale 1,-1,-1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!model || !pose) return 0;
      gl.useProgram(program);
      gl.uniformMatrix4fv(loc.uViewProj, false, viewProj);
      gl.uniform1i(loc.uTex, 0);
      gl.uniform3f(loc.uFlat, flat, flat, flat);
      gl.activeTexture(gl.TEXTURE0);
      const drawOne = (d) => {
        const p = d.prim;
        gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.pos);
        gl.enableVertexAttribArray(loc.aPos);
        gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.nrm);
        gl.enableVertexAttribArray(loc.aNrm);
        gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, p.gpu.uv);
        gl.enableVertexAttribArray(loc.aUV);
        gl.vertexAttribPointer(loc.aUV, 2, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(loc.uModel, false, pose.world.subarray(d.node * 16, d.node * 16 + 16));
        gl.uniform1f(loc.uAlphaCut, d.alphaCut);
        gl.bindTexture(gl.TEXTURE_2D, d.tex || whiteTex);
        gl.drawArrays(gl.TRIANGLES, 0, p.count);
      };
      const opaque = model.draws.filter((d) => !d.blend);
      const blended = model.draws.filter((d) => d.blend);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      for (const d of opaque) drawOne(d);
      if (blended.length) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        // back-to-front, measured from the eye at the matrix's translation
        const eye = [viewProj[12], viewProj[13], viewProj[14]];
        blended.sort((a, b) => depthOf(pose, b, eye) - depthOf(pose, a, eye));
        for (const d of blended) drawOne(d);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      renderer.drawCalls = model.draws.length;
      return model.draws.length;
    },
  };

  // 1x1 white texture so an untextured primitive still shades
  const whiteTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, whiteTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([220, 220, 220, 255]));

  return renderer;
}

function depthOf(pose, d, eye) {
  const m = pose.world;
  const x = m[d.node * 16 + 12] - eye[0], y = m[d.node * 16 + 13] - eye[1], z = m[d.node * 16 + 14] - eye[2];
  return x * x + y * y + z * z;
}

function hexRgb(hex) {
  const s = String(hex || "#000").replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
