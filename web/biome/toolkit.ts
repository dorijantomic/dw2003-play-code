// BIOME TOOLKIT (web/biome-gallery.html). Standalone: nothing here imports the game or web/built/*.
// Units: 1 render unit = 1 metre. three.js r186 (web/lib3d).
//   toonify()      Lambert base (fog, instancing, alpha-to-coverage, vertex colours stay three's) + our 3-band toon light:
//                  dark / shade / lit bands, TINTED shade (albedo x cool tint, never grey), sky fill from above, sun-side rim.
//                  Idea + constants family: web/built/shared.js toonLight (summer-cycle toonT). One uniform object U for all.
//   wind           GPU, in object space before the instance matrix: main bend weighted by height^2 + 3-harmonic flutter,
//                  phase from the instance position (ez-tree / shared.js builtWind idea, Crysis bend, GPU Gems 3 ch.16).
//   fade           per-instance distance scale-to-zero in the vertex shader (grass, small plants) - no CPU work.
//   scatter        seeded jittered rejection sampling on the terrain height function, density callback.
//   LODSpecies     InstancedMesh per LOD level, CPU re-bin of instances every few frames by camera distance,
//                  last level = yaw-billboard impostor from a baked 8-view atlas (bakeImpostor).
//   groundMaterial 4-layer splat (noise texture RGBA driven), anti-tile double tap, photoreal albedo -> graded toon.
//   skyMaterial    gradient + sun + toon cloud deck from one 128px noise texture, 12 taps-free (2 texture reads).
//   GpuTimer       EXT_disjoint_timer_query_webgl2 ring; falls back to CPU submit time when unavailable.
import * as THREE from "three";
import { mergeGeometries } from "./vendor/BufferGeometryUtils.js";

export { THREE };

// ------------------------------------------------------------------ random + noise
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
let _noiseTex = null;
/** 256^2 RGBA tileable value-noise (4 independent channels, 2 octaves each). Repeat wrapped, linear, no mips needed. */
export function noiseTexture() {
  if (_noiseTex) return _noiseTex;
  const N = 256, d = new Uint8Array(N * N * 4);
  for (let c = 0; c < 4; c++) {
    const r = rng(1234 + c * 77), G = 16 << (c & 1), lat = new Float32Array(G * G).map(() => r()), lat2 = new Float32Array(G * 2 * G * 2).map(() => r());
    const sm = (t) => t * t * (3 - 2 * t);
    const samp = (L, g, u, v) => { const x = u * g, y = v * g, xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
      const h = (i, j) => L[((j % g + g) % g) * g + ((i % g + g) % g)];
      return (h(xi, yi) * (1 - fx) + h(xi + 1, yi) * fx) * (1 - fy) + (h(xi, yi + 1) * (1 - fx) + h(xi + 1, yi + 1) * fx) * fy; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) d[(j * N + i) * 4 + c] = Math.min(255, 255 * (0.65 * samp(lat, G, i / N, j / N) + 0.35 * samp(lat2, G * 2, i / N, j / N)));
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; _noiseTex = t; return t;
}
/** terrain height in metres (same function for ground mesh and scatter) */
export function terrainH(x, z, amp = 1) {
  const r = Math.hypot(x, z), flat = THREE.MathUtils.smoothstep(r, 6, 18);
  return amp * flat * (1.3 * Math.sin(x * 0.045 + 1) * Math.cos(z * 0.05) + 0.55 * Math.sin(x * 0.13 + z * 0.11) + 0.25 * Math.sin(x * 0.31 - z * 0.27));
}

// ------------------------------------------------------------------ shared uniforms (one object, every material holds the same refs)
export const U = {
  uTime: { value: 0 },
  uSunV: { value: new THREE.Vector3(0.4, 0.8, 0.3) },       // sun direction in VIEW space (updated per frame)
  uUpV: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1.0, 0.93, 0.80) },
  uShadeTint: { value: new THREE.Color(0.52, 0.60, 0.86) },   // shade = albedo x this (cooler, darker)
  uSkyCol: { value: new THREE.Color(0.55, 0.72, 1.0) },
  uRimCol: { value: new THREE.Color(1.0, 0.86, 0.6) },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  uWindStr: { value: 1.0 },
  uCam: { value: new THREE.Vector3() },
};
export const light = { dir: new THREE.Vector3(0.45, 0.78, 0.35).normalize() };   // world sun direction (towards the sun)
export function tickUniforms(camera, t) {
  camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  U.uTime.value = t;
  U.uSunV.value.copy(light.dir).transformDirection(camera.matrixWorldInverse);
  U.uUpV.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  U.uCam.value.copy(camera.position);
}

export const GLSL_GRADE = /* glsl */`
vec3 bGrade(vec3 c, float sat, float post){
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, sat);
  vec3 q = floor(c * 7.0 + 0.5) / 7.0;
  return mix(c, q, post);
}`;

// ------------------------------------------------------------------ toon material
/**
 * opts: { wind: 0..1 amplitude as fraction of height, height (m), flutter 0..1, fade: [near, far] or null, grade: {sat, post}|null,
 *         tint: [r,g,b] multiplier on albedo, trans: 0..1 backlit translucency, shadeK (0.55..1), emissive: [r,g,b] added after light }
 */
export function toonify(mat, opts = {}) {
  const o = Object.assign({ wind: 0, height: 1, flutter: 0, fade: null, grade: null, tint: null, trans: 0, shadeK: 0.72, emissive: null, rim: 0.28, hang: 0, moss: 0 }, opts);
  mat.userData.toon = o;
  mat.onBeforeCompile = (sh) => {
    for (const k in U) sh.uniforms[k] = U[k];
    sh.uniforms.uWH = { value: Math.max(0.05, o.height) };
    sh.uniforms.uWindAmp = { value: o.wind };
    sh.uniforms.uFlutter = { value: o.flutter };
    sh.uniforms.uFade = { value: new THREE.Vector2(...(o.fade || [1e6, 2e6])) };
    sh.uniforms.uTint = { value: new THREE.Vector3(...(o.tint || [1, 1, 1])) };
    sh.uniforms.uTrans = { value: o.trans };
    sh.uniforms.uShadeK = { value: o.shadeK };
    sh.uniforms.uRim = { value: o.rim };
    sh.uniforms.uEmis = { value: new THREE.Vector3(...(o.emissive || [0, 0, 0])) };
    sh.uniforms.uHang = { value: o.hang ? 1 : 0 }; sh.uniforms.uMoss = { value: o.moss }; sh.uniforms.uMossCol = { value: new THREE.Vector3(0.16, 0.34, 0.07) }; sh.uniforms.uNoise = { value: noiseTexture() };
    sh.uniforms.uGrade = { value: new THREE.Vector2(o.grade ? o.grade.sat : 1, o.grade ? o.grade.post : 0) };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
uniform float uTime, uWH, uWindAmp, uFlutter, uWindStr, uHang; uniform vec2 uWindDir, uFade; uniform vec3 uCam;
varying vec3 vWP; varying vec3 vBV; varying vec3 vWN;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 bIP = instanceMatrix[3].xyz; mat3 bIM = mat3(instanceMatrix);
#else
  vec3 bIP = modelMatrix[3].xyz; mat3 bIM = mat3(1.0);
#endif
  { float h = clamp(transformed.y / uWH, 0.0, 1.5); h = mix(h, 1.0 - min(h, 1.0), uHang);
    float fd = 1.0 - smoothstep(uFade.x, uFade.y, distance(bIP, uCam)); transformed *= fd;
    if (uWindAmp > 0.0) {
      float ph = bIP.x * 0.31 + bIP.z * 0.23;
      float g = 0.55 + 0.45 * sin(uTime * 0.7 + ph * 0.4);
      float s1 = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.4;
      vec3 wl = transpose(bIM) * vec3(uWindDir.x, 0.0, uWindDir.y); wl = normalize(wl + vec3(1e-5));
      float bend = h * h * uWH * uWindAmp * uWindStr * (0.06 + 0.05 * s1) * (0.6 + g);
      transformed.xz += wl.xz * bend; transformed.y -= bend * bend * 0.4 / max(uWH, 0.1);
      if (uFlutter > 0.0) {
        float f = uTime * 6.0 + dot(position, vec3(7.0, 5.0, 9.0)) + ph;
        transformed += vec3(sin(f), sin(f * 1.31 + 1.0) * 0.5, cos(f * 0.87)) * uFlutter * 0.035 * uWH * h * uWindStr;
      }
    }
  }`)
      .replace("#include <project_vertex>", `#include <project_vertex>
  { vec4 wp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
#endif
    wp = modelMatrix * wp; vWP = wp.xyz; vBV = -mvPosition.xyz; vWN = normalize(mat3(modelMatrix) * (bIM * objectNormal)); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uSunV, uUpV, uSunCol, uShadeTint, uSkyCol, uRimCol, uTint, uEmis; uniform float uShadeK, uRim, uTrans, uMoss; uniform vec3 uMossCol; uniform sampler2D uNoise; uniform vec2 uGrade;
varying vec3 vWP; varying vec3 vBV; varying vec3 vWN;
${GLSL_GRADE}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
  diffuseColor.rgb = bGrade(diffuseColor.rgb * uTint, uGrade.x, uGrade.y);
  if (uMoss > 0.0) { float mn = texture2D(uNoise, vWP.xz * 0.35 + vWP.y * 0.2).r; float mn2 = texture2D(uNoise, vWP.zy * 0.9).g;
    float mm = smoothstep(0.35, 0.7, vWN.y * 0.9 + (mn - 0.5) * 0.9 + (mn2 - 0.5) * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, uMossCol * (0.75 + 0.5 * mn2), mm * uMoss); }`)
      .replace("#include <opaque_fragment>", `
  { vec3 alb = diffuseColor.rgb;
    vec3 V = normalize(vBV);
    float ndl = dot(normal, uSunV);
    float w = ndl * 0.5 + 0.5;
    vec3 dark = alb * uShadeTint * uShadeK * 0.78;
    vec3 shade = alb * uShadeTint * (uShadeK + 0.2);
    vec3 lit = alb * uSunCol;
    vec3 col = mix(dark, shade, smoothstep(0.30, 0.34, w));
    col = mix(col, lit, smoothstep(0.52, 0.57, w));
    col += alb * uSkyCol * (0.5 + 0.5 * dot(normal, uUpV)) * 0.16;
    float rim = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 3.0) * smoothstep(0.45, 0.8, w);
    col += uRimCol * rim * uRim * alb;
    if (uTrans > 0.0) { float t = pow(clamp(dot(V, -uSunV), 0.0, 1.0), 4.0) * smoothstep(0.55, 0.2, w); col += alb * uSunCol * t * uTrans; }
    col += uEmis;
    outgoingLight = min(col, vec3(1.6)); }
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => "toon" + JSON.stringify([o.wind > 0, o.flutter > 0, !!o.fade, !!o.grade, o.trans > 0, !!o.emissive, o.hang ? 1 : 0, o.moss > 0 ? 1 : 0, mat.map ? 1 : 0, mat.vertexColors ? 1 : 0, mat.userData.tag || ""]);
  return mat;
}
/** plain toon material from colour/map */
export function toonMat(o = {}, t = {}) {
  const m = new THREE.MeshLambertMaterial(o);
  if (o.alphaTest) { m.alphaToCoverage = true; }
  return toonify(m, t);
}
export const GRADE_PHOTO = { sat: 1.38, post: 0.35 };    // photoreal albedo -> painted: saturate + posterise 35 %

// ------------------------------------------------------------------ geometry helpers
export function tris(geo) { return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; }
/** keep only position/normal/uv (+color if all have it) so geometries from different files merge */
export function normaliseGeo(g, keepColor = false) {
  // one attribute layout for every source (so merges never fail): plain Float32 position / normal / uv, always indexed
  const f32 = (at, n) => {
    if (at && !at.isInterleavedBufferAttribute && at.array instanceof Float32Array && at.itemSize === n && !at.normalized) return at;
    const out = new Float32Array((at ? at.count : 0) * n); if (at) for (let i = 0; i < at.count; i++) { out[i * n] = at.getX(i); if (n > 1) out[i * n + 1] = at.getY(i); if (n > 2) out[i * n + 2] = at.getZ(i); }
    return new THREE.BufferAttribute(out, n);
  };
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", f32(g.attributes.position, 3));
  out.setAttribute("normal", f32(g.attributes.normal || (g.computeVertexNormals(), g.attributes.normal), 3));
  out.setAttribute("uv", g.attributes.uv ? f32(g.attributes.uv, 2) : new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (keepColor && g.attributes.color) out.setAttribute("color", f32(g.attributes.color, 3));   // opt-in (own TripoSR objects); every existing caller passes nothing = unchanged
  if (g.index) out.setIndex(g.index); else { const n = g.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; out.setIndex(new THREE.BufferAttribute(ix, 1)); }
  return out;
}
/** Stats of an Object3D: triangles drawn + draw calls (instanced mesh = 1 call, count instances for triangles). */
export function objStats(obj) {
  let t = 0, dc = 0;
  obj.updateMatrixWorld(true);
  obj.traverse((m) => {
    if (!(m.isMesh || m.isPoints || m.isLine) || m.visible === false) return;
    const g = m.geometry, n = m.isInstancedMesh ? m.count : 1;
    if (m.isMesh) t += tris(g) * n; else t += 0;
    dc += Array.isArray(m.material) ? m.material.length : 1;
  });
  return { tris: Math.round(t), draws: dc };
}

// ------------------------------------------------------------------ instancing + scatter
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function composeTRS(out, i, x, y, z, yaw, sc, tilt = 0, tiltDir = 0, sy = null) {
  _e.set(Math.sin(tiltDir) * tilt, yaw, Math.cos(tiltDir) * tilt, "YXZ"); _q.setFromEuler(_e);
  _p.set(x, y, z); _s.set(sc, sy == null ? sc : sy, sc);
  _m.compose(_p, _q, _s); out.set(_m.elements, i * 16);
}
/**
 * scatter: returns Float32Array of n matrices. area = [cx, cz, halfW, halfD]; density(x,z) -> 0..1 (rejection);
 * ok(x,z) optional hard filter. opts: scale [min,max], tilt (rad), yOffset, sink.
 */
export function scatter(n, seed, area, density, opts = {}) {
  const r = rng(seed), [cx, cz, hw, hd] = area, out = new Float32Array(n * 16), pos = [];
  const sc = opts.scale || [0.9, 1.2], tilt = opts.tilt || 0;
  let i = 0, tries = 0;
  while (i < n && tries++ < n * 40) {
    const x = cx + (r() * 2 - 1) * hw, z = cz + (r() * 2 - 1) * hd;
    if (density && r() > density(x, z)) continue;
    const s = sc[0] + (sc[1] - sc[0]) * r();
    composeTRS(out, i, x, terrainH(x, z) + (opts.yOffset || 0), z, r() * Math.PI * 2, s, tilt * r(), r() * 6.28);
    pos.push(x, z); i++;
  }
  return { mats: out.subarray(0, i * 16), count: i, pos };
}

/** An InstancedMesh of merged parts (parts: [{geo, mat}]). One mesh per part. */
export function instancedParts(parts, mats, count, name = "") {
  const g = new THREE.Group(); g.name = name;
  for (const p of parts) {
    const im = new THREE.InstancedMesh(p.geo, p.mat, Math.max(1, count));
    im.instanceMatrix.array.set(mats.subarray(0, count * 16)); im.count = count; im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false; g.add(im);
  }
  return g;
}

// ------------------------------------------------------------------ cell culling for scattered instances (grass, rocks, reeds ...)
/**
 * CullSet: like instancedParts(), but the instances are sorted into square cells (default 16 m) once; update(camera) uploads only the
 * cells inside the view frustum and inside the largest GPU fade distance of the parts (shader scale-to-zero, so nothing visible is lost).
 * Cell test is conservative (sphere = cell box + biggest instance radius). Runs only when the camera moved/turned.
 */
export class CullSet {
  constructor() { this.items = []; this._p = new THREE.Vector3(1e9, 0, 0); this._q = new THREE.Quaternion(); this._fr = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._s = new THREE.Sphere(); this._fov = 0; this.stats = { total: 0, drawn: 0 }; }
  add(parts, mats, count, name = "", cell = 16) {
    let md = 0, gr = 0;
    for (const p of parts) {
      const f = p.mat.userData.toon && p.mat.userData.toon.fade; md = Math.max(md, f && f[1] < 1e5 ? f[1] : Infinity);
      if (!p.geo.boundingSphere) p.geo.computeBoundingSphere(); gr = Math.max(gr, p.geo.boundingSphere.center.length() + p.geo.boundingSphere.radius);
    }
    const map = new Map();
    for (let i = 0; i < count; i++) { const k = Math.floor(mats[i * 16 + 12] / cell) * 100003 + Math.floor(mats[i * 16 + 14] / cell); let l = map.get(k); if (!l) map.set(k, l = []); l.push(i); }
    const sorted = new Float32Array(Math.max(1, count) * 16), cells = []; let o = 0;
    for (const l of map.values()) {
      let y0 = 1e9, y1 = -1e9, sm = 0, sx = 0, sz = 0;
      for (const i of l) {
        sorted.set(mats.subarray(i * 16, i * 16 + 16), o * 16);
        const e = mats, b = i * 16, y = e[b + 13]; y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += e[b + 12]; sz += e[b + 14];
        sm = Math.max(sm, Math.hypot(e[b], e[b + 1], e[b + 2]), Math.hypot(e[b + 4], e[b + 5], e[b + 6]), Math.hypot(e[b + 8], e[b + 9], e[b + 10])); o++;
      }
      const cx = Math.floor(mats[l[0] * 16 + 12] / cell) * cell + cell / 2, cz = Math.floor(mats[l[0] * 16 + 14] / cell) * cell + cell / 2;
      cells.push({ x: cx, y: (y0 + y1) / 2, z: cz, r: Math.hypot(cell / 2, cell / 2, (y1 - y0) / 2) + gr * sm, start: o - l.length, n: l.length });
    }
    const g = new THREE.Group(); g.name = name; const meshes = [];
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, Math.max(1, count)); im.instanceMatrix.array.set(sorted); im.count = count; im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; g.add(im); meshes.push(im);
    }
    this.items.push({ sorted, cells, meshes, md, count }); this._p.set(1e9, 0, 0);
    return g;
  }
  update(camera, force = false) {
    if (!force && camera.position.distanceToSquared(this._p) < 0.04 && camera.quaternion.angleTo(this._q) < 0.004 && camera.fov === this._fov) return;
    this._p.copy(camera.position); this._q.copy(camera.quaternion); this._fov = camera.fov;
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this._fr.setFromProjectionMatrix(this._m);
    const cp = camera.position, S = this._s; let tot = 0, drawn = 0;
    for (const it of this.items) {
      let n = 0; const arr = it.meshes[0].instanceMatrix.array;
      for (const c of it.cells) {
        tot += c.n;
        if (it.md < Infinity && Math.hypot(c.x - cp.x, c.y - cp.y, c.z - cp.z) - c.r > it.md) continue;
        S.center.set(c.x, c.y, c.z); S.radius = c.r; if (!this._fr.intersectsSphere(S)) continue;
        arr.set(it.sorted.subarray(c.start * 16, (c.start + c.n) * 16), n * 16); n += c.n;
      }
      drawn += n;
      for (let k = 0; k < it.meshes.length; k++) {
        const im = it.meshes[k]; if (k > 0) im.instanceMatrix.array.set(arr.subarray(0, n * 16));
        im.count = n; im.visible = n > 0; im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, n * 16); im.instanceMatrix.needsUpdate = true;
      }
    }
    this.stats.total = tot; this.stats.drawn = drawn;
  }
}

// ------------------------------------------------------------------ LOD species: lod0 mesh, lod1 mesh, impostor
/**
 * levels: [{parts}, {parts}, {impostor: Mesh factory}] (parts as above). dist: [d0, d1] switch distances.
 * All instances share the matrices in `mats`. update(camera) re-bins; call every few frames.
 */
export class LODSpecies {
  constructor(name, levels, mats, count, dist) {
    this.name = name; this.mats = mats; this.n = count; this.dist = dist; this.group = new THREE.Group(); this.group.name = name;
    this.levels = levels.map((lv) => {
      const meshes = (lv.parts || []).map((p) => { const im = new THREE.InstancedMesh(p.geo, p.mat, count); im.frustumCulled = false; im.count = 0; this.group.add(im); return im; });
      if (lv.impostor) { const im = lv.impostor(count); im.frustumCulled = false; im.count = 0; this.group.add(im); meshes.push(im); }
      return meshes;
    });
    this.idx = this.levels.map(() => new Int32Array(count));
    this._last = new THREE.Vector3(1e9, 0, 0); this._pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { this._pos[i * 3] = mats[i * 16 + 12]; this._pos[i * 3 + 1] = mats[i * 16 + 13]; this._pos[i * 3 + 2] = mats[i * 16 + 14]; }
  }
  update(camera, force = false) {
    if (!force && camera.position.distanceToSquared(this._last) < 1.0) return;
    this._last.copy(camera.position);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, L = this.levels.length, cnt = new Array(L).fill(0);
    const d0 = this.dist[0] ** 2, d1 = (this.dist[1] ?? 1e9) ** 2;
    for (let i = 0; i < this.n; i++) {
      const dx = this._pos[i * 3] - cx, dy = this._pos[i * 3 + 1] - cy, dz = this._pos[i * 3 + 2] - cz, d = dx * dx + dy * dy + dz * dz;
      let l = d < d0 ? 0 : d < d1 ? 1 : 2; if (l >= L) l = L - 1;
      const dst = l; this.idx[dst][cnt[dst]++] = i;
    }
    for (let l = 0; l < L; l++) for (const im of this.levels[l]) {
      const arr = im.instanceMatrix.array, ix = this.idx[l];
      for (let k = 0; k < cnt[l]; k++) { const s = ix[k] * 16; arr.set(this.mats.subarray(s, s + 16), k * 16); }
      im.count = cnt[l]; im.visible = cnt[l] > 0; im.instanceMatrix.needsUpdate = true;
    }
  }
  counts() { return this.levels.map((ms) => ms[0] ? ms[0].count : 0); }
}

// ------------------------------------------------------------------ impostor (yaw billboard, 8 views)
/**
 * Bake `obj` (a Group of toon meshes) into an 8-view atlas with `renderer`; returns {factory(count) -> InstancedMesh, tex, w, h, size}.
 * Light baked from the upper left of each view (the cheap-impostor trade-off).
 */
export function bakeImpostor(renderer, obj, frames = 8, px = 256) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const R = Math.max(size.x, size.z, size.y) * 0.5 * 1.04;
  const rt = new THREE.WebGLRenderTarget(px * frames, px, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  rt.texture.generateMipmaps = false;
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.1, R * 6);
  sc.add(obj);
  const saved = { sun: light.dir.clone(), sv: U.uSunV.value.clone(), up: U.uUpV.value.clone(), t: renderer.getRenderTarget(), ac: renderer.getClearAlpha(), cc: renderer.getClearColor(new THREE.Color()), vp: renderer.getViewport(new THREE.Vector4()), fog: sc.fog };
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.autoClear = false;
  for (let f = 0; f < frames; f++) {
    const a = (f / frames) * Math.PI * 2;
    cam.position.set(ctr.x + Math.sin(a) * R * 3, ctr.y, ctr.z + Math.cos(a) * R * 3); cam.lookAt(ctr); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    U.uSunV.value.set(-0.45, 0.65, 0.6).normalize(); U.uUpV.value.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
    U.uCam.value.copy(cam.position);
    renderer.setViewport(f * px, 0, px, px); renderer.setScissor(f * px, 0, px, px); renderer.setScissorTest(true);
    renderer.render(sc, cam);
  }
  renderer.setScissorTest(false); renderer.autoClear = true; renderer.setRenderTarget(saved.t); renderer.setClearColor(saved.cc, saved.ac); renderer.setViewport(saved.vp);
  light.dir.copy(saved.sun); U.uSunV.value.copy(saved.sv); U.uUpV.value.copy(saved.up);
  sc.remove(obj);
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
  const W = R * 2, H = R * 2, yOff = ctr.y - R - 0;     // quad covers [ctr.y-R, ctr.y+R]
  const factory = (count) => {
    const m = new THREE.MeshBasicMaterial({ map: rt.texture, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCam = U.uCam; sh.uniforms.uQ = { value: new THREE.Vector4(W, H, yOff, frames) };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
uniform vec3 uCam; uniform vec4 uQ;`)
        .replace("#include <uv_vertex>", `#include <uv_vertex>
  vec3 bP = instanceMatrix[3].xyz; vec3 tc = uCam - bP; float ang = atan(tc.x, tc.z); if (ang < 0.0) ang += 6.2831853;
  float fr = floor(ang / 6.2831853 * uQ.w + 0.5); fr = mod(fr, uQ.w);
  vMapUv = vec2((uv.x + fr) / uQ.w, uv.y);`)
        .replace("#include <project_vertex>", `
  float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
  vec3 fw = normalize(vec3(tc.x, 0.0, tc.z) + vec3(1e-5)); vec3 rt = vec3(fw.z, 0.0, -fw.x);
  vec3 wp = bP + rt * position.x * uQ.x * sx + vec3(0.0, uQ.z * sy + position.y * uQ.y * sy, 0.0);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0); gl_Position = projectionMatrix * mvPosition;`);
    };
    m.customProgramCacheKey = () => "impostor";
    return new THREE.InstancedMesh(geo, m, count);
  };
  return { factory, tex: rt.texture, rt, size: new THREE.Vector2(W, H) };
}

// ------------------------------------------------------------------ ground splat
export function groundMaterial(texs, o = {}) {
  const noise = noiseTexture();
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.userData.tag = "ground";
  toonify(m, { grade: o.grade || GRADE_PHOTO, shadeK: 0.78, rim: 0 });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    prev(sh);
    sh.uniforms.uT0 = { value: texs[0] }; sh.uniforms.uT1 = { value: texs[1] || texs[0] }; sh.uniforms.uT2 = { value: texs[2] || texs[0] }; sh.uniforms.uT3 = { value: texs[3] || texs[0] };
    sh.uniforms.uNoise = { value: noise };
    sh.uniforms.uTile = { value: o.tile || 4.0 };
    sh.uniforms.uCols = { value: (o.tints || [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]).map((c) => new THREE.Vector3(...c)) };
    sh.uniforms.uSplat = { value: new THREE.Vector4(...(o.splat || [0.45, 0.62, 0.5, 0.7])) };   // litter thr, moss thr, path thr, slope rock thr
    sh.fragmentShader = sh.fragmentShader
      .replace("vec3 bGrade(vec3 c, float sat, float post){", `uniform sampler2D uT0, uT1, uT2, uT3; uniform float uTile; uniform vec3 uCols[4]; uniform vec4 uSplat;
vec3 bTap(sampler2D t, vec2 p, float k){ // anti-tile: two taps at different scale/rotation, blended by low-freq noise
  vec3 a = texture2D(t, p).rgb;
  vec3 b = texture2D(t, mat2(0.8, 0.6, -0.6, 0.8) * p * 0.37 + 0.31).rgb;
  float n = texture2D(uNoise, p * 0.043).b;
  return mix(a, b, smoothstep(0.3, 0.7, n) * 0.6);
}
vec3 bGrade(vec3 c, float sat, float post){`)
      .replace("#include <map_fragment>", `
  { vec2 q = vWP.xz / uTile;
    vec4 nz = texture2D(uNoise, vWP.xz * 0.012); vec4 nz2 = texture2D(uNoise, vWP.xz * 0.045 + 3.0);
    vec3 c0 = bTap(uT0, q, 0.0) * uCols[0];
    vec3 c1 = bTap(uT1, q * 1.1, 0.0) * uCols[1];
    vec3 c2 = bTap(uT2, q * 0.9, 0.0) * uCols[2];
    vec3 c3 = bTap(uT3, q * 1.3, 0.0) * uCols[3];
    float wl = smoothstep(uSplat.x, uSplat.x + 0.12, nz.r * 0.7 + nz2.r * 0.3);                 // litter patches
    float wm = smoothstep(uSplat.y, uSplat.y + 0.1, nz.g * 0.6 + nz2.g * 0.4) * (1.0 - wl * 0.6); // moss / mud
    float path = abs(vWP.x * 0.5 + sin(vWP.z * 0.08) * 6.0 + 3.0); float wp = (1.0 - smoothstep(0.8, 2.2, path + (nz2.b - 0.5) * 2.5)) * uSplat.z;
    float slope = 1.0 - clamp(vWN.y, 0.0, 1.0); float wr = smoothstep(uSplat.w * 0.1, uSplat.w * 0.1 + 0.07, slope);
    vec3 c = c0; c = mix(c, c1, wl); c = mix(c, c2, wm); c = mix(c, c3, clamp(wp + wr, 0.0, 1.0));
    c *= 0.88 + 0.24 * nz2.a;
    diffuseColor.rgb *= c; }
`);
  };
  return m;
}

// ------------------------------------------------------------------ sky
export function skyMaterial(o = {}) {
  const cols = { zenith: new THREE.Color(o.zenith ?? 0x4f86e8), mid: new THREE.Color(o.mid ?? 0x8dc2ff), horizon: new THREE.Color(o.horizon ?? 0xd9ecff), sun: new THREE.Color(1.0, 0.95, 0.8) };
  const m = new THREE.ShaderMaterial({
    side: o.side ?? THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uZen: { value: cols.zenith }, uMid: { value: cols.mid }, uHor: { value: cols.horizon }, uSun: { value: cols.sun }, uSunDir: { value: light.dir }, uTime: U.uTime,
      uNoise: { value: noiseTexture() }, uCloud: { value: o.cloud ?? 0.5 }, uClouds: { value: o.clouds === false ? 0 : 1 }, uTone: { value: o.tone ?? 1 }, uGradient: { value: o.gradient === false ? 0 : 1 } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; varying vec3 vD; uniform vec3 uZen, uMid, uHor, uSun, uSunDir; uniform float uTime, uCloud, uClouds, uTone, uGradient; uniform sampler2D uNoise;
float band(float x){ return x; }
void main(){
  vec3 d = normalize(vD); float y = max(d.y, 0.0);
  vec3 col;
  if (uGradient > 0.5) {
    float t = pow(y, 0.55);
    col = mix(uHor, uMid, smoothstep(0.0, 0.45, t)); col = mix(col, uZen, smoothstep(0.35, 1.0, t));
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSun * (pow(sd, 400.0) * 1.2 + pow(sd, 14.0) * 0.18);                  // disc + warm glow
    col = mix(col, floor(col * 18.0 + 0.5) / 18.0, 0.25 * uTone);                   // painted banding
  } else col = uHor;
  float a = 0.0;
  if (uClouds > 0.5) {
    vec2 uv = d.xz / (y + 0.22) * 0.55 + vec2(uTime * 0.004, uTime * 0.002);
    float n = texture2D(uNoise, uv).r * 0.62 + texture2D(uNoise, uv * 2.7 + 5.0).g * 0.38;
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.035;
    float n2 = texture2D(uNoise, uv - toSun).r * 0.62 + texture2D(uNoise, (uv - toSun) * 2.7 + 5.0).g * 0.38;
    float thr = 1.0 - uCloud * 0.55;
    a = smoothstep(thr, thr + 0.035, n) * smoothstep(0.02, 0.18, y);
    float lit = smoothstep(-0.02, 0.05, n - n2 + 0.05);                            // toon light: edge facing the sun is white
    vec3 cc = mix(vec3(0.70, 0.76, 0.93), vec3(1.0, 0.99, 0.96), lit);
    col = mix(col, cc, a * 0.96);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
  });
  return m;
}
export function skyDome(o = {}) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial(o));
  mesh.renderOrder = -1000; mesh.frustumCulled = false; mesh.name = "sky";
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.scale.setScalar(cam.far * 0.9); mesh.updateMatrixWorld(); };
  return mesh;
}

// ------------------------------------------------------------------ GPU timer
export class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext(); this.ext = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.ms = []; this.cpu = []; this.pending = null; this.active = null; this.supported = !!this.ext;
  }
  _poll() {
    if (!this.pending) return;
    const gl = this.gl, q = this.pending;
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) { this.ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); if (this.ms.length > 120) this.ms.shift(); }
      gl.deleteQuery(q); this.pending = null;
    }
  }
  begin() {
    this.t0 = performance.now();
    if (!this.ext) return;
    this._poll();
    if (!this.pending) { const q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.active = q; }
  }
  end() {
    this.cpu.push(performance.now() - this.t0); if (this.cpu.length > 120) this.cpu.shift();
    if (this.active) { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending = this.active; this.active = null; }
  }
  gpuMs() { return this.ms.length ? this.ms.reduce((a, b) => a + b, 0) / this.ms.length : null; }
  cpuMs() { return this.cpu.length ? this.cpu.reduce((a, b) => a + b, 0) / this.cpu.length : null; }
  reset() { this.ms.length = 0; this.cpu.length = 0; }
}
