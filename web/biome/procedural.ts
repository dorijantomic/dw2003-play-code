// Procedural biome assets (no download, our own code, no licence needed): mushrooms (lathe), ivy / hanging vines,
// leaf litter cards, twigs, grass clumps (al-ro-style ribbon blades, ideas only), light shafts, mist sheets.
// All return parts [{geo, mat}] or Object3D built with the toon material from toolkit.js.
import * as THREE from "three";
import { mergeGeometries } from "./vendor/BufferGeometryUtils.js";
import { toonify, toonMat, rng, U, noiseTexture, light } from "./toolkit.js";

const canvasTex = (w, h, draw, srgb = true) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
};
const prep = (geo) => { geo.computeBoundingSphere(); return geo; };

// ------------------------------------------------------------------ leaf textures (grey-white painted, tinted by colour)
function leafPath(g, kind, w, h) {
  g.beginPath();
  if (kind === "ivy") {   // five-lobed ivy leaf, tip up
    const P = [[0.5, 0.02], [0.62, 0.3], [0.95, 0.34], [0.72, 0.55], [0.86, 0.86], [0.52, 0.72], [0.5, 0.98], [0.48, 0.72], [0.14, 0.86], [0.28, 0.55], [0.05, 0.34], [0.38, 0.3]];
    P.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
  } else if (kind === "maple") {
    const n = 5, pts = []; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2, r = (i % 2 ? 0.2 : 0.47) * (i === 0 ? 1.08 : 1); pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]); }
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
  } else {                 // oak: lobed ellipse
    const N = 40; for (let i = 0; i <= N; i++) { const t = i / N, wd = Math.pow(Math.sin(Math.PI * t), 0.8) * (0.62 + 0.3 * Math.sin(t * Math.PI * 7)) * 0.5; g.lineTo((0.5 + wd) * w, (0.02 + t * 0.96) * h); }
    for (let i = N; i >= 0; i--) { const t = i / N, wd = Math.pow(Math.sin(Math.PI * t), 0.8) * (0.62 + 0.3 * Math.sin(t * Math.PI * 7)) * 0.5; g.lineTo((0.5 - wd) * w, (0.02 + t * 0.96) * h); }
  }
  g.closePath();
}
const _leafTex = {};
export function leafTexture(kind) {
  if (_leafTex[kind]) return _leafTex[kind];
  return (_leafTex[kind] = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    leafPath(g, kind, w, h);
    const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, "#c9c9c9"); gr.addColorStop(1, "#ffffff"); g.fillStyle = gr; g.fill();
    g.save(); leafPath(g, kind, w, h); g.clip();
    g.strokeStyle = "rgba(90,90,90,0.55)"; g.lineWidth = 2.2; g.beginPath(); g.moveTo(w * 0.5, h * 0.98); g.lineTo(w * 0.5, h * 0.08); g.stroke();
    g.lineWidth = 1.4; for (let i = 0; i < 5; i++) { const y = h * (0.85 - i * 0.15); g.beginPath(); g.moveTo(w * 0.5, y); g.lineTo(w * 0.12, y - h * 0.16); g.moveTo(w * 0.5, y); g.lineTo(w * 0.88, y - h * 0.16); g.stroke(); }
    g.restore(); g.strokeStyle = "rgba(60,60,60,0.9)"; g.lineWidth = 3; leafPath(g, kind, w, h); g.stroke();
  }));
}

// ------------------------------------------------------------------ mushrooms (lathe cap + stem, painted texture)
const _mushTex = {};
function mushTexture(kind) {
  if (_mushTex[kind]) return _mushTex[kind];
  const pal = { agaric: ["#d3342a", "#f5eede", "#fff8e8"], brown: ["#8a5a35", "#d9c7a3", "#e8dcc0"], glow: ["#37c9c6", "#bff7f0", "#e6fffb"] }[kind];
  const r = rng(11);
  return (_mushTex[kind] = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = pal[2]; g.fillRect(0, 0, w, h * 0.46);        // stem + gills (bottom of the profile = low v at bottom of canvas)
    g.fillStyle = pal[0]; g.fillRect(0, h * 0.46, w, h * 0.54);   // cap
    if (kind === "agaric") { g.fillStyle = pal[1]; for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(r() * w, h * (0.52 + r() * 0.44), 6 + r() * 7, 4 + r() * 5, 0, 0, 7); g.fill(); } }
    if (kind === "brown") { const gr = g.createLinearGradient(0, h * 0.46, 0, h); gr.addColorStop(0, "#6e4527"); gr.addColorStop(1, "#b07a4a"); g.fillStyle = gr; g.fillRect(0, h * 0.46, w, h * 0.54); }
    if (kind === "glow") { g.fillStyle = pal[1]; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(r() * w, h * (0.55 + r() * 0.4), 2 + r() * 3, 0, 7); g.fill(); } }
    g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 1; for (let i = 0; i < 48; i++) { g.beginPath(); g.moveTo(i * w / 48, h * 0.30); g.lineTo(i * w / 48, h * 0.46); g.stroke(); }  // gills
  }));
}
function mushroomGeo(sx = 1, sy = 1) {
  const pr = [[0.20, 0], [0.17, 0.10], [0.14, 0.26], [0.125, 0.42], [0.20, 0.44], [0.40, 0.47], [0.60, 0.52], [0.66, 0.58], [0.62, 0.68], [0.50, 0.79], [0.30, 0.88], [0.0, 0.92]];
  const pts = pr.map(([x, y]) => new THREE.Vector2(x * sx, y * sy));
  const g = new THREE.LatheGeometry(pts, 16);   // uv v follows the profile index
  // v: stem part (first 4 points) -> canvas bottom region; cap -> top region
  const uv = g.attributes.uv, n = pr.length;
  for (let i = 0; i < uv.count; i++) { const k = i % n, v = k < 4 ? k / 3 * 0.44 : 0.48 + (k - 4) / (n - 5) * 0.5; uv.setY(i, v); }
  return g;
}
/** cluster of 5 mushrooms of `kind`: parts, ~height 0.28 m */
export function mushroomParts(kind = "agaric", seed = 5) {
  const r = rng(seed), gs = [];
  const set = [[0, 0, 1.0], [0.20, 0.08, 0.7], [-0.16, 0.12, 0.55], [0.06, -0.22, 0.45], [-0.12, -0.14, 0.38]];
  for (const [x, z, s] of set) {
    const g = mushroomGeo(1 + r() * 0.3, 1 + r() * 0.3); g.scale(0.28 * s, 0.30 * s, 0.28 * s);
    g.rotateZ((r() - 0.5) * 0.25); g.rotateY(r() * 6); g.translate(x * 0.5, 0, z * 0.5); gs.push(g);
  }
  const geo = mergeGeometries(gs);
  const mat = toonify(new THREE.MeshLambertMaterial({ map: mushTexture(kind), side: THREE.DoubleSide }),
    { height: 0.3, shadeK: 0.75, rim: 0.45, emissive: kind === "glow" ? [0.05, 0.38, 0.40] : null, tint: kind === "glow" ? [0.9, 1.0, 1.0] : null });
  mat.userData.tag = "mush" + kind;
  return [{ geo: prep(geo), mat }];
}

// ------------------------------------------------------------------ ivy on a trunk + hanging vines
function leafQuad(c, n, s, rollR, rnd, up = 1) {
  // quad centred at c, facing n (unit), size s, rotated randomly about n
  const t = new THREE.Vector3(0, 1, 0); if (Math.abs(n.y) > 0.9) t.set(1, 0, 0);
  const a = new THREE.Vector3().crossVectors(t, n).normalize(), b = new THREE.Vector3().crossVectors(n, a);
  const ang = rnd() * 6.28, ca = Math.cos(ang), sa = Math.sin(ang);
  const ax = a.clone().multiplyScalar(ca).addScaledVector(b, sa), bx = b.clone().multiplyScalar(ca).addScaledVector(a, -sa);
  const v = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]].map(([u, w]) => c.clone().addScaledVector(ax, u * s).addScaledVector(bx, (w - 0.3) * s * 1.1));
  return v;
}
function quadsGeometry(quads, uvs, normals, cols) {
  const pos = [], nor = [], uv = [], col = [], idx = []; let base = 0;
  quads.forEach((q, i) => {
    q.forEach((p, k) => { pos.push(p.x, p.y, p.z); nor.push(normals[i].x, normals[i].y, normals[i].z); uv.push([0, 1, 1, 0][k], [0, 0, 1, 1][k]); col.push(cols[i][0], cols[i][1], cols[i][2]); });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3); base += 4;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); return g;
}
function tube(path, r0, r1, sides = 5) {
  const pos = [], idx = [], nor = [], uv = []; const N = path.length;
  for (let i = 0; i < N; i++) {
    const p = path[i], q = path[Math.min(N - 1, i + 1)], o = path[Math.max(0, i - 1)], tg = new THREE.Vector3().subVectors(q, o).normalize();
    const a = new THREE.Vector3().crossVectors(tg, Math.abs(tg.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize(), b = new THREE.Vector3().crossVectors(tg, a);
    const r = r0 + (r1 - r0) * i / (N - 1);
    for (let k = 0; k < sides; k++) { const t = k / sides * 6.2832, d = a.clone().multiplyScalar(Math.cos(t)).addScaledVector(b, Math.sin(t)); pos.push(p.x + d.x * r, p.y + d.y * r, p.z + d.z * r); nor.push(d.x, d.y, d.z); uv.push(k / sides, i / (N - 1)); }
  }
  for (let i = 0; i < N - 1; i++) for (let k = 0; k < sides; k++) { const a = i * sides + k, b = i * sides + (k + 1) % sides; idx.push(a, b, a + sides, b, b + sides, a + sides); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
}
const solid = (g, rgb) => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; } g.setAttribute("color", new THREE.BufferAttribute(c, 3)); return g; };
function leafMaterial(kind, o = {}) {
  const m = new THREE.MeshLambertMaterial({ map: leafTexture(kind), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  m.userData.tag = "leaf" + kind; return toonify(m, Object.assign({ shadeK: 0.7, trans: 0.4 }, o));
}
/** Ivy climbing a trunk of radius R (unit 0.3) for H metres: helical stems + heart leaves. ~300 tris. */
export function ivyParts(R = 0.3, H = 4.0, seed = 3) {
  const r = rng(seed), quads = [], norms = [], cols = [], stems = [];
  const nS = 3;
  for (let s = 0; s < nS; s++) {
    const a0 = r() * 6.28, turns = 1.2 + r() * 0.8, path = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, a = a0 + t * turns * 6.28, h = t * H * (0.6 + 0.4 * r()) * (s === 0 ? 1 : 0.8); path.push(new THREE.Vector3(Math.cos(a) * (R + 0.015), 0.2 + h, Math.sin(a) * (R + 0.015))); }
    stems.push(solid(tube(path, 0.012, 0.006, 4), [0.17, 0.12, 0.07]));
    for (let i = 1; i < path.length; i++) for (let k = 0; k < 5; k++) {
      const p = path[i].clone().lerp(path[i - 1], r()), nrm = new THREE.Vector3(p.x, 0, p.z).normalize().add(new THREE.Vector3(0, 0.25 + r() * 0.3, 0)).normalize();
      p.addScaledVector(nrm, 0.03 + r() * 0.04);
      quads.push(leafQuad(p, nrm, 0.13 + r() * 0.08, R, r)); norms.push(nrm.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.6, 0)).normalize());
      const gsh = 0.75 + r() * 0.35; cols.push([0.30 * gsh, 0.62 * gsh, 0.20 * gsh]);
    }
  }
  const geoL = prep(quadsGeometry(quads, null, norms, cols)), geoS = prep(mergeGeometries(stems));
  return [{ geo: geoL, mat: leafMaterial("ivy", { wind: 0.25, height: H, flutter: 0.6 }) },
          { geo: geoS, mat: toonify(new THREE.MeshLambertMaterial({ vertexColors: true }), { height: H, shadeK: 0.7 }) }];
}
/** Hanging vines (attached at y = len, free tip at 0): a bunch of 5 ropes with leaves. */
export function vineParts(len = 2.6, seed = 9) {
  const r = rng(seed), quads = [], norms = [], cols = [], ropes = [];
  for (let s = 0; s < 5; s++) {
    const ox = (r() - 0.5) * 0.7, oz = (r() - 0.5) * 0.7, L = len * (0.55 + 0.45 * r()), path = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; path.push(new THREE.Vector3(ox + Math.sin(t * 5 + s) * 0.04, len - t * L, oz + Math.cos(t * 4 + s * 2) * 0.04)); }
    ropes.push(solid(tube(path, 0.010, 0.004, 4), [0.2, 0.15, 0.08]));
    for (let i = 1; i < path.length; i++) for (let k = 0; k < 3; k++) {
      const p = path[i].clone(), nrm = new THREE.Vector3(r() - 0.5, 0.2, r() - 0.5).normalize(); p.addScaledVector(new THREE.Vector3(r() - 0.5, 0, r() - 0.5), 0.12);
      quads.push(leafQuad(p, nrm, 0.12 + r() * 0.08, 0, r)); norms.push(new THREE.Vector3(0, 1, 0).add(nrm).normalize());
      const gsh = 0.7 + r() * 0.4; cols.push([0.28 * gsh, 0.58 * gsh, 0.18 * gsh]);
    }
  }
  return [{ geo: prep(quadsGeometry(quads, null, norms, cols)), mat: leafMaterial("ivy", { wind: 0.5, height: len, flutter: 0.5, hang: true }) },
          { geo: prep(mergeGeometries(ropes)), mat: toonify(new THREE.MeshLambertMaterial({ vertexColors: true }), { height: len, wind: 0.5, hang: true, shadeK: 0.7 }) }];
}

// ------------------------------------------------------------------ leaf litter, twigs
/** A flat leaf card lying on the ground (2 tris), tinted per instance with setColorAt. kind: oak|maple */
export function litterParts(kind = "oak", size = 0.11) {
  const g = new THREE.PlaneGeometry(size, size); g.rotateX(-Math.PI / 2); g.translate(0, 0.012, 0);
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const m = new THREE.MeshLambertMaterial({ map: leafTexture(kind), side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  m.userData.tag = "litter" + kind;
  return [{ geo: prep(g), mat: toonify(m, { fade: [18, 34], shadeK: 0.8, rim: 0 }) }];
}
export const LITTER_COLOURS = ["#b8651f", "#8c4a1a", "#c98a2a", "#6b5a22", "#a33c1a", "#7a6a2c", "#4a5a22", "#d1a13a"].map((c) => new THREE.Color(c));
/** twig bundle: 3 curved sticks with a fork each, ~0.6 m */
export function twigParts(seed = 2) {
  const r = rng(seed), gs = [];
  for (let s = 0; s < 3; s++) {
    const L = 0.45 + r() * 0.4, path = [], a = r() * 6.28; let x = 0, y = 0.012, z = 0, dx = Math.cos(a), dz = Math.sin(a);
    for (let i = 0; i <= 6; i++) { path.push(new THREE.Vector3(x, y, z)); x += dx * L / 6; z += dz * L / 6; dx += (r() - 0.5) * 0.35; dz += (r() - 0.5) * 0.35; y += (r() - 0.35) * 0.012; }
    gs.push(solid(tube(path, 0.011, 0.004, 5), [0.30, 0.20, 0.12]));
    const f = path.slice(3).map((p, i) => new THREE.Vector3(p.x + dz * 0.04 * i, p.y + i * 0.01, p.z - dx * 0.04 * i)); gs.push(solid(tube(f, 0.007, 0.0025, 4), [0.28, 0.19, 0.11]));
  }
  const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.userData.tag = "twig";
  return [{ geo: prep(mergeGeometries(gs)), mat: toonify(m, { fade: [20, 40], shadeK: 0.75, rim: 0.1, height: 0.1 }) }];
}

// ------------------------------------------------------------------ grass clumps (ribbon blades: curl, taper, root->tip gradient)
export function grassClumpParts(o = {}) {
  const O = Object.assign({ blades: 4, segs: 3, h: [0.35, 0.7], w: 0.035, rootCol: [0.07, 0.20, 0.05], tipCol: [0.55, 0.78, 0.22], seed: 1, fade: [28, 46], spread: 0.16, wind: 1 }, o);
  const r = rng(O.seed), pos = [], nor = [], col = [], idx = []; let base = 0;
  for (let b = 0; b < O.blades; b++) {
    const a = r() * 6.28, rad = r() * O.spread, ox = Math.cos(a) * rad, oz = Math.sin(a) * rad, yaw = r() * 6.28;
    const H = O.h[0] + (O.h[1] - O.h[0]) * r(), W = O.w * (0.8 + 0.5 * r()), lean = 0.15 + r() * 0.5, curl = 0.2 + r() * 0.5;
    const fx = Math.cos(yaw), fz = Math.sin(yaw), rx = -fz, rz = fx;
    const tint = 0.85 + r() * 0.3, ring = [];
    for (let s = 0; s <= O.segs; s++) {
      const t = s / O.segs, h = t * H, f = lean * t * t * H + curl * t * t * t * H * 0.5;
      const w = W * (1 - t * 0.92) * (s === O.segs ? 0 : 1);
      const cx = ox + fx * f, cz = oz + fz * f, cy = h * (1 - 0.25 * lean * t);
      const c = [0, 1, 2].map((k) => (O.rootCol[k] + (O.tipCol[k] - O.rootCol[k]) * Math.pow(t, 0.8)) * tint);
      const nx = -fx * (0.35 + 0.4 * t), nz = -fz * (0.35 + 0.4 * t), nl = Math.hypot(nx, nz, 1);
      for (const sgn of s === O.segs ? [0] : [-1, 1]) { pos.push(cx + rx * w * sgn, cy, cz + rz * w * sgn); nor.push(nx / nl, 1 / nl, nz / nl); col.push(...c); ring.push(pos.length / 3 - 1); }
    }
    const per = []; let k = 0; for (let s = 0; s <= O.segs; s++) { if (s === O.segs) { per.push([k]); k += 1; } else { per.push([k, k + 1]); k += 2; } }
    for (let s = 0; s < O.segs; s++) {
      const A = per[s], B = per[s + 1];
      if (B.length === 1) idx.push(base + A[0], base + A[1], base + B[0]); else idx.push(base + A[0], base + A[1], base + B[0], base + A[1], base + B[1], base + B[0]);
    }
    base += k;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); g.setIndex(idx);
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); m.userData.tag = "grass";
  return [{ geo: prep(g), mat: toonify(m, { wind: 0.5 * O.wind, height: O.h[1], flutter: 0.25, fade: O.fade, shadeK: 0.78, rim: 0.2, trans: 0.35 }) }];
}

// ------------------------------------------------------------------ light shafts + mist
export function lightShafts(n = 7, seed = 4, spread = 12) {
  const g = new THREE.Group(), r = rng(seed);
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1); geo.translate(0, -0.5, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: U.uTime, uCol: { value: new THREE.Color(1.0, 0.86, 0.55) } },
    vertexShader: `varying vec2 vUv; varying float vId; void main(){ vUv = uv; vId = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; varying vec2 vUv; varying float vId; uniform float uTime; uniform vec3 uCol;
void main(){ float across = 1.0 - abs(vUv.x - 0.5) * 2.0; across = smoothstep(0.0, 0.7, across);
  float along = smoothstep(1.0, 0.75, vUv.y) * smoothstep(0.0, 0.25, vUv.y);
  float fl = 0.75 + 0.25 * sin(uTime * 0.6 + vId * 3.0);
  gl_FragColor = vec4(uCol * across * along * fl * 0.20, 1.0); }`,
  });
  const im = new THREE.InstancedMesh(geo, mat, n); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const w = 1.4 + r() * 2.0, len = 14 + r() * 5; e.set(0.38 + r() * 0.1, r() * 0.5 - 0.1, 0.2); q.setFromEuler(e);
    m.compose(new THREE.Vector3((r() - 0.5) * spread * 2, 16, (r() - 0.5) * spread * 2), q, new THREE.Vector3(w, len, 1)); im.setMatrixAt(i, m);
  }
  im.frustumCulled = false; im.renderOrder = 50; g.add(im); g.name = "lightShafts"; return g;
}
export function mistSheets(size = 60, layers = 4, y0 = 0.15) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: U.uTime, uNoise: { value: noiseTexture() }, uCol: { value: new THREE.Color(0.80, 0.88, 0.95) }, uSize: { value: size }, uCam: U.uCam },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `precision highp float; varying vec3 vW; uniform sampler2D uNoise; uniform vec3 uCol, uCam; uniform float uTime, uSize;
void main(){ vec2 p = vW.xz * 0.045 + vec2(uTime * 0.006, uTime * 0.003) + vW.y * 0.7;
  float n = texture2D(uNoise, p).r * 0.6 + texture2D(uNoise, p * 2.3 + 4.0).g * 0.4;
  float edge = smoothstep(0.5, 0.35, length(vW.xz - uCam.xz) / (uSize * 0.5));
  float dc = smoothstep(1.5, 6.0, distance(vW, uCam));   // do not blind the camera
  float a = smoothstep(0.42, 0.78, n) * 0.42 * edge * dc;
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
}`,
  });
  for (let i = 0; i < layers; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat); m.rotation.x = -Math.PI / 2; m.position.y = y0 + i * 0.35; m.renderOrder = 40 + i; g.add(m); }
  g.name = "mist"; return g;
}
