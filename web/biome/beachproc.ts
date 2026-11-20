// BEACH procedural assets (no download, our own code, no licence needed): palms (segmented trunk + alpha-card fronds), sea grape,
// marram / sea oats, driftwood, shells, seaweed / kelp, sea stacks, the toon ocean + pool water, sea spray, the wet-sand ground shader.
// Shore law shared by JS and GLSL: shoreZ(x) is the waterline, d = z - shoreZ is the distance inland, seabed(e) the depth at e metres offshore.
import * as THREE from "three";
import { mergeGeometries } from "./vendor/BufferGeometryUtils.js";
import { toonify, groundMaterial, rng, U, noiseTexture, light, GRADE_PHOTO } from "./toolkit.js";
import { grassClumpParts } from "./procedural.js";

// ------------------------------------------------------------------ shore law (JS) + same in GLSL
export const shoreZ = (x) => -12 + 3.0 * Math.sin(x * 0.031 + 0.7) + 1.4 * Math.sin(x * 0.083 + 2.1);
export const seaDepth = (e) => Math.min(0.07 * e + 0.0018 * e * e, 14);
export const GLSL_SHORE = /* glsl */`
float bShoreZ(float x){ return -12.0 + 3.0 * sin(x * 0.031 + 0.7) + 1.4 * sin(x * 0.083 + 2.1); }
float bDepth(float e){ return min(0.07 * e + 0.0018 * e * e, 14.0); }
`;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, z, f, s = 0) {
  const X = x * f + s * 17.3, Z = z * f + s * 9.1, xi = Math.floor(X), zi = Math.floor(Z), fx = X - xi, fz = Z - zi;
  const h = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - sx) + h(xi + 1, zi) * sx) * (1 - sz) + (h(xi, zi + 1) * (1 - sx) + h(xi + 1, zi + 1) * sx) * sz;
}
export { vnoise, sstep };
/** tide pools: [x, z, radius] (placed on the right rock shelf) */
export const POOLS = [[50, 0, 2.3], [58.5, 4.5, 1.9], [45, 6.5, 1.6]].map(([x, dd, r]) => [x, shoreZ(x) + 7 + dd, r]);
/** terrain height (m). Sea level is y = 0. */
export function beachH(x, z) {
  const d = z - shoreZ(x);
  if (d < 0) return -seaDepth(-d);
  let h = 0.045 * Math.min(d, 26);
  const dn = sstep(22, 46, d);
  if (dn > 0) {
    const u = x * 0.8 + z * 0.6, v = -x * 0.6 + z * 0.8;                    // ridges lie across the wind
    const rid = 1 - Math.abs(2 * vnoise(u, v, 0.012, 3) - 1), rid2 = 1 - Math.abs(2 * vnoise(u * 2.3, v * 2.3, 0.02, 5) - 1);
    h += dn * (0.9 + 3.6 * rid * rid + 0.9 * rid2 * rid2 + 0.8 * vnoise(x, z, 0.06, 1));
  }
  for (const [px, pz, r] of POOLS) { const q = Math.hypot(x - px, z - pz); if (q < r * 1.8) h -= 0.55 * (1 - sstep(r * 0.55, r * 1.25, q)); }
  return h;
}

// ------------------------------------------------------------------ geometry builder
class GB {
  constructor() { this.p = []; this.c = []; this.u = []; this.i = []; }
  v(x, y, z, r = 1, g = 1, b = 1, u = 0, w = 0) { this.p.push(x, y, z); this.c.push(r, g, b); this.u.push(u, w); return this.p.length / 3 - 1; }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  tri(a, b, c) { this.i.push(a, b, c); }
  geo(color = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    if (color) g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function addGeo(gb, geo, m, colFn) {   // append a three geometry (transformed) into gb with vertex colours
  const g = geo.index ? geo : geo.toNonIndexed(), P = g.attributes.position, N = P.count, base = gb.p.length / 3, v = new THREE.Vector3();
  for (let i = 0; i < N; i++) { v.fromBufferAttribute(P, i); if (m) v.applyMatrix4(m); const c = colFn ? colFn(v, i) : [1, 1, 1]; gb.v(v.x, v.y, v.z, c[0], c[1], c[2]); }
  if (g.index) for (let i = 0; i < g.index.count; i++) gb.i.push(base + g.index.getX(i)); else for (let i = 0; i < N; i++) gb.i.push(base + i);
}
/** tube along points P with radii R; colFn(ringIndex, sideFraction, angle) -> rgb; caps = cone cap at the ends */
function tube(gb, P, R, sides, colFn, caps = [true, true]) {
  const n = P.length, rings = []; let pn = null;
  for (let i = 0; i < n; i++) {
    const T = P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize();
    let N = pn ? pn.clone().sub(T.clone().multiplyScalar(pn.dot(T))) : (Math.abs(T.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).sub(T.clone().multiplyScalar(Math.abs(T.y) < 0.9 ? T.y : T.x));
    if (N.lengthSq() < 1e-8) N = V(1, 0, 0); N.normalize(); pn = N;
    const B = new THREE.Vector3().crossVectors(T, N), ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2, c = colFn ? colFn(i, j / sides, a) : [1, 1, 1];
      ring.push(gb.v(P[i].x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * R[i], P[i].y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * R[i], P[i].z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * R[i], c[0], c[1], c[2]));
    }
    rings.push({ ring, T });
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) { const a = rings[i].ring[j], b = rings[i].ring[(j + 1) % sides], c = rings[i + 1].ring[(j + 1) % sides], d = rings[i + 1].ring[j]; gb.quad(a, d, c, b); }
  const cap = (k, dir) => { const e = rings[k], c = colFn ? colFn(k, 0, 0) : [1, 1, 1], ap = gb.v(P[k].x + e.T.x * R[k] * 0.35 * dir, P[k].y + e.T.y * R[k] * 0.35 * dir, P[k].z + e.T.z * R[k] * 0.35 * dir, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8);
    for (let j = 0; j < sides; j++) { const a = e.ring[j], b = e.ring[(j + 1) % sides]; if (dir > 0) gb.tri(a, ap, b); else gb.tri(a, b, ap); } };
  if (caps[0]) cap(0, -1); if (caps[1]) cap(n - 1, 1);
}
/** flat ribbon along points P (side direction S) with half width fn */
function ribbon(gb, P, S, hw, colFn) {
  const n = P.length, ids = [];
  for (let i = 0; i < n; i++) {
    const w = hw(i / (n - 1)), c = colFn(i / (n - 1));
    ids.push([gb.v(P[i].x - S[i].x * w, P[i].y - S[i].y * w, P[i].z - S[i].z * w, c[0], c[1], c[2]), gb.v(P[i].x + S[i].x * w, P[i].y + S[i].y * w, P[i].z + S[i].z * w, c[0], c[1], c[2])]);
  }
  for (let i = 0; i < n - 1; i++) gb.quad(ids[i][0], ids[i][1], ids[i + 1][1], ids[i + 1][0]);
}
const canvasTex = (w, h, draw) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
};
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------ PALMS
let _frondTex = null, _fanTex = null, _leafTex = null;
function frondTexture() {
  return _frondTex || (_frondTex = canvasTex(128, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.lineCap = "round";
    g.strokeStyle = "#35602a"; g.lineWidth = 3.4; g.beginPath(); g.moveTo(64, h); g.lineTo(64, 4); g.stroke();
    const N = 44;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), yy = h - 30 - t * (h - 44), len = 60 * Math.pow(Math.sin(Math.PI * (0.18 + 0.78 * t)), 0.75) + 4;
      for (const sgn of [-1, 1]) {
        const ex = 64 + sgn * len, ey = yy - len * 0.55, cx = 64 + sgn * len * 0.55, cy = yy - len * 0.42 - 6;
        g.strokeStyle = (i % 2 ? `hsl(${96 + t * 12},56%,${26 + t * 16}%)` : `hsl(${100 + t * 12},60%,${34 + t * 18}%)`);
        g.lineWidth = 4.6 - 2.2 * t; g.beginPath(); g.moveTo(64, yy); g.quadraticCurveTo(cx, cy, ex, ey + 5); g.stroke();
      }
    }
  }));
}
function fanTexture() {
  return _fanTex || (_fanTex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); const N = 19;
    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + (-1 + (2 * i) / (N - 1)) * 1.12, a2 = a + 0.5 * (2.24 / (N - 1)), len = 122, ox = 64, oy = h - 2;
      g.fillStyle = i % 2 ? "#3f8a30" : "#56a83a"; g.beginPath(); g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(a - 0.05) * len, oy + Math.sin(a - 0.05) * len); g.lineTo(ox + Math.cos(a2 + 0.02) * len * 0.93, oy + Math.sin(a2 + 0.02) * len * 0.93); g.closePath(); g.fill();
    }
    g.strokeStyle = "#2f5f26"; g.lineWidth = 3; g.beginPath(); g.moveTo(64, h); g.lineTo(64, 14); g.stroke();
  }));
}
function roundLeafTexture() {
  return _leafTex || (_leafTex = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = "#4aa03a"; g.beginPath(); g.ellipse(32, 33, 28, 29, 0, 0, 7); g.fill();
    g.fillStyle = "#6bc24a"; g.beginPath(); g.ellipse(32, 24, 22, 20, 0, 0, 7); g.fill();
    g.strokeStyle = "#c9d98a"; g.lineWidth = 2.2; g.beginPath(); g.moveTo(32, 62); g.lineTo(32, 6); for (let i = 0; i < 4; i++) { const y = 50 - i * 11; g.moveTo(32, y); g.lineTo(10, y - 10); g.moveTo(32, y); g.lineTo(54, y - 10); } g.stroke();
    g.strokeStyle = "#2c6a28"; g.lineWidth = 2.2; g.beginPath(); g.ellipse(32, 33, 28, 29, 0, 0, 7); g.stroke();
  }));
}
/** one frond (or fan leaf) card along a drooping arc */
function frondGeo(gb, o) {
  const { origin, yaw, pitch, droop, L, W, segs, fold = 0.32, fan = false, three = true } = o;
  const hx = Math.cos(yaw), hz = Math.sin(yaw), sx = -hz, sz = hx;
  let x = origin.x, y = origin.y, z = origin.z; const rows = [];
  for (let k = 0; k <= segs; k++) {
    const s = k / segs, ang = pitch - droop * Math.pow(s, 1.3);
    if (k > 0) { const st = L / segs; x += hx * Math.cos(ang) * st; z += hz * Math.cos(ang) * st; y += Math.sin(ang) * st; }
    const hw = fan ? W * 0.5 * (0.35 + 0.65 * Math.min(1, s * 2.2)) : W * 0.5 * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * s)), 0.6);
    const row = [];
    const xs = three ? [-1, 0, 1] : [-1, 1];
    for (const m of xs) row.push(gb.v(x + sx * hw * m, y - (fan ? 0.5 : 1) * fold * hw * Math.abs(m) * (fan ? 0.6 : 1), z + sz * hw * m, 1, 1, 1, (m + 1) / 2, s));
    rows.push(row);
  }
  for (let k = 0; k < segs; k++) for (let m = 0; m < rows[k].length - 1; m++) gb.quad(rows[k][m], rows[k][m + 1], rows[k + 1][m + 1], rows[k + 1][m]);
}
const PALM = {
  coconut: { H: 7.4, r0: 0.27, r1: 0.15, bend: 0.12, S: 0.05, fr: 15, L: 3.4, W: 1.15, pitch: [1.15, -0.55], nuts: 6 },
  curved: { H: 6.6, r0: 0.24, r1: 0.14, bend: 0.62, S: 0.22, fr: 12, L: 3.0, W: 1.05, pitch: [1.0, -0.5], nuts: 3 },
  young: { H: 2.4, r0: 0.11, r1: 0.08, bend: 0.07, S: 0.0, fr: 10, L: 2.0, W: 0.72, pitch: [1.3, 0.1], nuts: 0 },
  fan: { H: 2.6, r0: 0.15, r1: 0.12, bend: 0.05, S: 0.0, fr: 15, L: 1.5, W: 1.7, pitch: [1.0, -0.15], nuts: 0, fan: true },
};
export const PALM_KINDS = Object.keys(PALM);
const _palmMat = {};
/** palm parts [{geo,mat}]: trunk (+nuts / petioles, vertex colours) and fronds (alpha cards). lod 0 / 1. */
export function palmParts(kind = "coconut", seed = 1, lod = 0) {
  const K = PALM[kind], r = rng(seed * 101 + kind.length * 7), gb = new GB(), fg = new GB();
  const S = lod ? 7 : 18, sides = lod ? 6 : 9, dirA = r() * 6.28, bx = Math.cos(dirA), bz = Math.sin(dirA);
  const P = [], R = [];
  for (let i = 0; i <= S; i++) {
    const t = i / S, off = K.bend * K.H * t * t, sway = K.S * K.H * Math.sin(t * Math.PI * 1.3) * 0.5;
    P.push(V(bx * off - bz * sway, K.H * t * (1 - 0.15 * K.bend * t), bz * off + bx * sway));
    R.push((K.r1 + (K.r0 - K.r1) * Math.pow(1 - t, 1.2) + K.r0 * 0.55 * Math.exp(-t * K.H * 1.6)) * (1 + 0.22 * sstep(0.9, 1, t)));
  }
  const bark = kind === "fan" ? [0.50, 0.40, 0.30] : [0.56, 0.45, 0.33];
  tube(gb, P, R, sides, (i, f, a) => {
    const t = i / S, band = i % 2 ? 0.78 : 1.0, st = 0.93 + 0.07 * Math.sin(a * 5 + i * 1.7);
    let c = bark.map((v) => v * band * st * (0.92 + 0.2 * t)); if (t > 0.94) c = mixc(c, [0.38, 0.52, 0.2], 0.8); return c;
  }, [false, true]);
  const top = P[S].clone(), nf = lod ? Math.ceil(K.fr * 0.7) : K.fr, segs = lod ? 3 : 8;
  for (let i = 0; i < nf; i++) {
    const t = i / (nf - 1), yaw = i * 2.399963 + r() * 0.35, pitch = K.pitch[0] + (K.pitch[1] - K.pitch[0]) * t + (r() - 0.5) * 0.18;
    const L = K.L * (0.8 + 0.3 * r()) * (0.78 + 0.22 * (1 - Math.abs(t - 0.4))), droop = 0.45 + 0.9 * t + r() * 0.2;
    const org = top.clone().add(V(Math.cos(yaw) * 0.07, -0.04 * t + 0.05, Math.sin(yaw) * 0.07));
    if (K.fan) {
      const pl = 0.55 + 0.5 * r(), pe = org.clone().add(V(Math.cos(yaw) * pl * 0.7, pl * Math.sin(Math.max(0.2, pitch * 0.9)), Math.sin(yaw) * pl * 0.7));
      tube(gb, [org, org.clone().lerp(pe, 0.5).add(V(0, 0.05, 0)), pe], [0.018, 0.014, 0.011], 4, () => [0.36, 0.42, 0.2], [false, false]);
      frondGeo(fg, { origin: pe, yaw, pitch: Math.min(0.9, pitch * 0.55 + 0.2), droop: 0.4 + 0.5 * t, L: K.L * (0.85 + 0.25 * r()), W: K.W * (0.9 + 0.2 * r()), segs: lod ? 2 : 4, fan: true, three: !lod });
    } else frondGeo(fg, { origin: org, yaw, pitch, droop, L, W: K.W, segs, three: !lod });
  }
  if (K.nuts) {
    const ico = new THREE.IcosahedronGeometry(0.11, lod ? 0 : 1);
    for (let i = 0; i < K.nuts; i++) { const a = r() * 6.28, m = new THREE.Matrix4().compose(top.clone().add(V(Math.cos(a) * 0.2, -0.12 - r() * 0.12, Math.sin(a) * 0.2)), new THREE.Quaternion(), V(1, 1.15, 1));
      addGeo(gb, ico, m, (v) => (v.y > top.y - 0.13 ? [0.34, 0.44, 0.16] : [0.40, 0.46, 0.18])); }
  }
  const H = K.H + K.L * 0.5;
  const key = kind + lod;
  if (!_palmMat[key]) {
    const tm = new THREE.MeshLambertMaterial({ vertexColors: true }); tm.userData.tag = "palmtrunk";
    const fm = new THREE.MeshLambertMaterial({ map: kind === "fan" ? fanTexture() : frondTexture(), side: THREE.DoubleSide, alphaTest: 0.5 }); fm.alphaToCoverage = true; fm.userData.tag = "palmfrond";
    _palmMat[key] = [tm, fm];
  }
  const [tm, fm] = _palmMat[key];
  // materials are shared between species of the same kind (wind height differs little); each part set clones the toon settings
  const tmc = tm.clone(), fmc = fm.clone(); tmc.userData.tag = tm.userData.tag; fmc.userData.tag = fm.userData.tag; fmc.alphaToCoverage = true;
  toonify(tmc, { wind: 0.30, height: H, shadeK: 0.72, rim: 0.12 });
  toonify(fmc, { wind: 0.30, height: H, flutter: 0.9, trans: 0.5, shadeK: 0.75, rim: 0.2 });
  return [{ geo: gb.geo(true), mat: tmc }, { geo: fg.geo(false), mat: fmc }];
}
/** a single frond card on a stalk (for the grid) */
export function frondCardParts() {
  const fg = new GB(); frondGeo(fg, { origin: V(0, 0, 0), yaw: 0, pitch: 0.9, droop: 1.2, L: 2.6, W: 1.0, segs: 8 });
  const fm = new THREE.MeshLambertMaterial({ map: frondTexture(), side: THREE.DoubleSide, alphaTest: 0.5 }); fm.alphaToCoverage = true; fm.userData.tag = "palmfrond";
  return [{ geo: fg.geo(false), mat: toonify(fm, { wind: 0.3, height: 2, flutter: 0.9, trans: 0.5, shadeK: 0.75 }) }];
}

// ------------------------------------------------------------------ sea grape (round leaves + grape clusters), beach shrub
export function seaGrapeParts(seed = 1, big = 1) {
  const r = rng(seed * 37 + 5), gb = new GB(), lg = new GB();
  const leafTpl = (() => { const g = new GB(); const c = g.v(0, 0.03, 0, 1, 1, 1, 0.5, 0.5); const ids = []; for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283; ids.push(g.v(Math.cos(a) * 0.5, -0.03 * (1 - 0.4 * Math.cos(a)), Math.sin(a) * 0.5 - 0.5, 1, 1, 1, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5)); } for (let i = 0; i < 9; i++) g.tri(c, ids[i], ids[(i + 1) % 9]); return g.geo(false); })();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const stems = 5;
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * 6.283 + r() * 0.6, lean = 0.5 + 0.7 * r(), len = (0.7 + 0.5 * r()) * big, P = [], Rr = [];
    for (let i = 0; i <= 4; i++) { const t = i / 4; P.push(V(Math.cos(a) * lean * len * t * 0.9, len * (t - 0.25 * t * t) * 0.8, Math.sin(a) * lean * len * t * 0.9)); Rr.push(0.032 * (1 - t * 0.7) * big); }
    tube(gb, P, Rr, 5, () => [0.38, 0.30, 0.22], [false, true]);
    for (let l = 0; l < 7; l++) {
      const t = 0.3 + 0.7 * (l / 6), idx = Math.min(3, Math.floor(t * 4)), f = t * 4 - idx, p = P[idx].clone().lerp(P[idx + 1], f);
      e.set(-0.4 + (r() - 0.5) * 0.8, a + (r() - 0.5) * 2.2, (r() - 0.5) * 0.6, "YXZ"); q.setFromEuler(e);
      const sz = (0.26 + 0.12 * r()) * big; m.compose(p.clone().add(V(0, 0.02, 0)), q, V(sz, sz, sz * 1.1));
      const lgeo = leafTpl.clone().applyMatrix4(m); const base = lg.p.length / 3, pa = lgeo.attributes.position, ua = lgeo.attributes.uv;
      for (let i = 0; i < pa.count; i++) lg.v(pa.getX(i), pa.getY(i), pa.getZ(i), 1, 1, 1, ua.getX(i), ua.getY(i));
      for (let i = 0; i < lgeo.index.count; i++) lg.i.push(base + lgeo.index.getX(i));
    }
    if (s < 2) {   // grape cluster
      const ico = new THREE.IcosahedronGeometry(0.028 * big, 0), p0 = P[3].clone().add(V(0, -0.1 * big, 0));
      for (let k = 0; k < 7; k++) addGeo(gb, ico, new THREE.Matrix4().makeTranslation(p0.x + (r() - 0.5) * 0.08, p0.y - k * 0.025 * big + (r() - 0.5) * 0.02, p0.z + (r() - 0.5) * 0.08), () => (k % 3 ? [0.48, 0.2, 0.38] : [0.55, 0.3, 0.22]));
    }
  }
  const tm = new THREE.MeshLambertMaterial({ vertexColors: true }); tm.userData.tag = "sgstem";
  const lm = new THREE.MeshLambertMaterial({ map: roundLeafTexture(), side: THREE.DoubleSide, alphaTest: 0.5 }); lm.alphaToCoverage = true; lm.userData.tag = "sgleaf";
  return [{ geo: gb.geo(true), mat: toonify(tm, { wind: 0.25, height: 1.2 * big, shadeK: 0.72 }) }, { geo: lg.geo(false), mat: toonify(lm, { wind: 0.4, height: 1.2 * big, flutter: 0.6, trans: 0.4, shadeK: 0.78, fade: [40, 70] }) }];
}

// ------------------------------------------------------------------ marram / sea oats
export function marramParts(variant = 0, seed = 3) {
  const cfg = [
    { blades: 6, segs: 3, h: [0.5, 1.0], w: 0.03, rootCol: [0.28, 0.33, 0.12], tipCol: [0.80, 0.78, 0.38], spread: 0.2 },
    { blades: 6, segs: 3, h: [0.35, 0.65], w: 0.028, rootCol: [0.34, 0.38, 0.14], tipCol: [0.88, 0.86, 0.52], spread: 0.17 },
    { blades: 5, segs: 3, h: [0.7, 1.3], w: 0.04, rootCol: [0.2, 0.32, 0.1], tipCol: [0.62, 0.74, 0.28], spread: 0.22 },
  ][variant % 3];
  return grassClumpParts({ ...cfg, seed: seed + variant * 5, fade: [30, 55], wind: 1.2 });
}
export function seaOatsParts(seed = 2) {
  const r = rng(seed * 19), gb = new GB(); const n = 6;
  for (let s = 0; s < n; s++) {
    const a = r() * 6.28, rad = r() * 0.1, H = 0.9 + 0.5 * r(), lean = 0.12 + 0.2 * r(), P = [], Rr = [];
    for (let i = 0; i <= 4; i++) { const t = i / 4; P.push(V(Math.cos(a) * (rad + lean * t * t * H), H * t, Math.sin(a) * (rad + lean * t * t * H))); Rr.push(0.008 * (1 - t * 0.5)); }
    tube(gb, P, Rr, 4, (i) => mixc([0.38, 0.45, 0.16], [0.82, 0.74, 0.4], i / 4), [false, false]);
    const tip = P[4], d = P[4].clone().sub(P[3]).normalize();    // plume
    const pl = [tip, tip.clone().addScaledVector(d, 0.1), tip.clone().addScaledVector(d, 0.2)];
    tube(gb, pl, [0.022, 0.03, 0.006], 5, (i) => (i === 1 ? [0.92, 0.82, 0.48] : [0.85, 0.76, 0.42]), [false, true]);
  }
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); m.userData.tag = "oats";
  return [{ geo: gb.geo(true), mat: toonify(m, { wind: 0.9, height: 1.4, flutter: 0.3, fade: [28, 50], shadeK: 0.78, rim: 0.2, trans: 0.3 }) }];
}

// ------------------------------------------------------------------ driftwood (bleached, grain stripes, root stubs, a fork)
export function driftwoodParts(seed = 1, kind = 0) {
  const r = rng(seed * 13 + kind * 3 + 1), gb = new GB();
  const L = [1.8, 2.5, 1.2][kind % 3], R0 = [0.09, 0.075, 0.13][kind % 3], n = 9;
  const col = (i, f, a) => { const g = 0.88 + 0.12 * Math.sin(a * 4 + i * 0.9) * Math.cos(i * 0.5), b = [0.74, 0.68, 0.58]; return b.map((v) => v * g * (0.92 + 0.14 * ((i * 7 + Math.floor(f * 8)) % 3) / 2)); };
  const P = [], Rr = [], wob = r() * 6;
  for (let i = 0; i < n; i++) { const t = i / (n - 1); P.push(V((t - 0.5) * L, 0.07 + 0.09 * Math.sin(t * 3 + wob) + 0.03 * r(), 0.12 * Math.sin(t * 4 + wob * 2))); Rr.push(R0 * (1.15 - 0.45 * t) * (0.88 + 0.28 * r()) * (i === 3 ? 1.25 : 1)); }
  tube(gb, P, Rr, 7, col, [true, true]);
  for (let k = 0; k < 4; k++) {   // root stubs at the thick end
    const a = (k / 4) * 6.28 + r(), q = [P[0], P[0].clone().add(V(-0.1 - 0.1 * r(), 0.08 * Math.cos(a), 0.14 * Math.sin(a))), P[0].clone().add(V(-0.28 - 0.2 * r(), 0.18 * Math.cos(a) + 0.04, 0.3 * Math.sin(a)))];
    tube(gb, q, [R0 * 0.55, R0 * 0.4, R0 * 0.14], 5, col, [false, true]);
  }
  const f0 = P[4], fk = [f0, f0.clone().add(V(0.08, 0.16, 0.12)), f0.clone().add(V(0.2, 0.34, 0.3))];
  tube(gb, fk, [Rr[4] * 0.55, Rr[4] * 0.42, Rr[4] * 0.16], 6, col, [false, true]);
  const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.userData.tag = "drift";
  return [{ geo: gb.geo(true), mat: toonify(m, { fade: [45, 80], shadeK: 0.74, rim: 0.1, height: 0.5 }) }];
}

// ------------------------------------------------------------------ shells (vertex coloured)
export function shellParts(kind = "scallop", seed = 1) {
  const r = rng(seed * 29 + kind.length), gb = new GB();
  if (kind === "scallop") {
    const nt = 14, nr = 6, W = 0.1, ids = [];
    for (let ir = 0; ir <= nr; ir++) { const row = [], u = ir / nr; for (let it = 0; it <= nt; it++) {
      const th = (-1 + (2 * it) / nt) * 1.15, rr = u * W, rib = 0.007 * Math.cos(th * 9) * u, cup = 0.026 * (1 - Math.pow(u * 1.25 - 0.5, 2) * 3.3) * Math.cos(th * 0.8);
      const c = mixc([0.96, 0.9, 0.8], [0.9, 0.55, 0.45], u * 0.9); const k = Math.cos(th * 9) > 0 ? 1 : 0.86;
      row.push(gb.v(rr * Math.sin(th), Math.max(0, cup + rib), rr * Math.cos(th), c[0] * k, c[1] * k, c[2] * k)); } ids.push(row); }
    for (let ir = 0; ir < nr; ir++) for (let it = 0; it < nt; it++) gb.quad(ids[ir][it], ids[ir][it + 1], ids[ir + 1][it + 1], ids[ir + 1][it]);
  } else if (kind === "conch" || kind === "whelk") {
    const M = 24, sides = 7, rings = [], turns = kind === "conch" ? 3.4 : 4.6, hgt = kind === "conch" ? 0.11 : 0.15;
    for (let i = 0; i <= M; i++) {
      const u = i / M, phi = u * turns * 6.283, rh = 0.055 * Math.pow(u, 0.85) + 0.004, rt = 0.008 + 0.042 * Math.pow(u, 1.05), cy = (1 - u) * hgt + rt * 0.5, band = (i % 4 < 2) ? 1 : 0.8;
      const row = []; for (let j = 0; j < sides; j++) { const a = (j / sides) * 6.283, c = mixc([0.96, 0.86, 0.72], [0.82, 0.5, 0.32], 0.5 + 0.5 * Math.sin(phi * 1.5 + a));
        row.push(gb.v(Math.cos(phi) * (rh + Math.cos(a) * rt), cy + Math.sin(a) * rt * 0.9, Math.sin(phi) * (rh + Math.cos(a) * rt), c[0] * band, c[1] * band, c[2] * band)); } rings.push(row);
    }
    for (let i = 0; i < M; i++) for (let j = 0; j < sides; j++) gb.quad(rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % sides], rings[i][(j + 1) % sides]);
  } else if (kind === "clam") {
    for (const side of [0, 1]) {
      const sp = new THREE.SphereGeometry(0.5, 12, 6, 0, 2 * Math.PI, 0, Math.PI / 2), P = sp.attributes.position;
      const m = new THREE.Matrix4().compose(V(0, side ? 0.012 : 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(side ? Math.PI + 0.38 : 0, 0, 0)), V(0.09, 0.034, 0.07));
      addGeo(gb, sp, m, (v) => { const rho = Math.hypot(v.x, v.z) / 0.09, ring = Math.floor(rho * 8) % 2; return ring ? [0.88, 0.84, 0.78] : [0.74, 0.62, 0.5]; });
    }
  } else if (kind === "cowrie") {
    const sp = new THREE.SphereGeometry(0.5, 12, 8), m = new THREE.Matrix4().makeScale(0.075, 0.048, 0.05);
    addGeo(gb, sp, m, (v) => (v.y < -0.012 && Math.abs(v.z) < 0.012 ? [0.95, 0.9, 0.82] : mixc([0.78, 0.55, 0.36], [0.55, 0.34, 0.2], (Math.sin(v.x * 140) * Math.cos(v.z * 160) + 1) / 2 * 0.6)));
    gb.p = gb.p.map((v, i) => (i % 3 === 1 ? v + 0.024 : v));
  } else {   // sand dollar
    const pr = [[0, 0.016], [0.02, 0.0165], [0.04, 0.0145], [0.058, 0.009], [0.068, 0.003], [0.07, 0]].map(([x, y]) => new THREE.Vector2(x, y));
    const lg = new THREE.LatheGeometry(pr, 20), m = new THREE.Matrix4();
    addGeo(gb, lg, m, (v) => { const a = Math.atan2(v.z, v.x), rho = Math.hypot(v.x, v.z), pet = Math.pow(Math.max(0, Math.cos(2.5 * a * 2 * 0.5 + 0.0)), 6); const pa = Math.pow(Math.cos(a * 5 * 0.5) ** 2, 3); return rho > 0.012 && rho < 0.05 && pa > 0.5 ? [0.72, 0.68, 0.6] : [0.88, 0.85, 0.78]; });
  }
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); m.userData.tag = "shell";
  return [{ geo: gb.geo(true), mat: toonify(m, { fade: [28, 48], shadeK: 0.82, rim: 0.12, height: 0.1 }) }];
}

// ------------------------------------------------------------------ seaweed / kelp / wrack
export function wrackParts(seed = 1) {
  const r = rng(seed * 43 + 2), gb = new GB(); const n = 9;
  for (let s = 0; s < n; s++) {
    const yaw = r() * 6.28, len = 0.35 + 0.5 * r(), ox = (r() - 0.5) * 0.35, oz = (r() - 0.5) * 0.35, ph = r() * 6, P = [], S = [];
    for (let i = 0; i < 9; i++) { const t = i / 8, x = t * len, z = 0.07 * Math.sin(t * 9 + ph) * len * 3; P.push(V(ox + Math.cos(yaw) * x - Math.sin(yaw) * z, 0.012 + 0.012 * Math.sin(t * 6 + ph) + 0.015 * s / n, oz + Math.sin(yaw) * x + Math.cos(yaw) * z)); S.push(V(-Math.sin(yaw + 1.57) * 0, 0.0, 0).set(Math.sin(yaw), 0, -Math.cos(yaw))); }
    const kind = s % 3, base = kind === 0 ? [0.34, 0.3, 0.1] : kind === 1 ? [0.2, 0.32, 0.12] : [0.4, 0.22, 0.1];
    ribbon(gb, P, S, (t) => 0.022 * (1 + 0.5 * Math.sin(t * 22 + ph)) * (1 - 0.5 * t) + 0.004, (t) => mixc(base, [base[0] * 0.55, base[1] * 0.6, base[2] * 0.5], t));
    if (kind === 0) for (let b = 0; b < 3; b++) { const p = P[2 + b * 2]; addGeo(gb, new THREE.IcosahedronGeometry(0.018, 0), new THREE.Matrix4().makeTranslation(p.x, p.y + 0.012, p.z), () => [0.5, 0.42, 0.12]); }
  }
  for (let s = 0; s < 2; s++) {   // sea lettuce sheet
    const cx = (r() - 0.5) * 0.3, cz = (r() - 0.5) * 0.3, c0 = gb.v(cx, 0.02, cz, 0.35, 0.6, 0.2), ids = []; for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283, rr = 0.09 * (0.7 + 0.5 * r()); ids.push(gb.v(cx + Math.cos(a) * rr, 0.012 + 0.012 * (i % 2), cz + Math.sin(a) * rr, 0.25, 0.52, 0.18)); }
    for (let i = 0; i < 9; i++) gb.tri(c0, ids[i], ids[(i + 1) % 9]);
  }
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); m.userData.tag = "wrack";
  return [{ geo: gb.geo(true), mat: toonify(m, { fade: [26, 46], shadeK: 0.8, height: 0.1 }) }];
}
export function kelpParts(seed = 1) {
  const r = rng(seed * 61 + 4), gb = new GB();
  for (let s = 0; s < 4; s++) {
    const yaw = r() * 6.28, H = 1.0 + 0.8 * r(), ox = (r() - 0.5) * 0.3, oz = (r() - 0.5) * 0.3, ph = r() * 6, P = [], S = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; P.push(V(ox + Math.cos(yaw) * 0.12 * t * H * Math.sin(t * 2 + ph), H * t, oz + Math.sin(yaw) * 0.12 * t * H * Math.sin(t * 2 + ph))); S.push(V(Math.sin(yaw), 0, -Math.cos(yaw))); }
    ribbon(gb, P, S, (t) => 0.06 * (0.8 + 0.3 * Math.sin(t * 17 + ph)) * (1 - 0.6 * t) + 0.01, (t) => mixc([0.32, 0.28, 0.1], [0.5, 0.45, 0.14], t));
  }
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); m.userData.tag = "kelp";
  return [{ geo: gb.geo(true), mat: toonify(m, { wind: 1.0, height: 1.9, flutter: 0.5, fade: [30, 50], shadeK: 0.8 }) }];
}

// ------------------------------------------------------------------ sea stack (strata bands, noisy radius, grassy cap)
export function seaStackParts(seed = 1, H = 12, R = 3) {
  const r = rng(seed * 71 + 9), gb = new GB(), rows = 18, cols = 18, ids = [];
  const strata = [[0.62, 0.55, 0.45], [0.5, 0.46, 0.42], [0.72, 0.62, 0.48], [0.45, 0.42, 0.4], [0.66, 0.58, 0.5]];
  const nz = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, row = []; const band = strata[Math.floor(i * 0.5 + seed) % strata.length];
    const prof = (1 + 0.55 * Math.exp(-t * 5)) * (0.78 + 0.22 * Math.cos(t * 1.4)) * (1 - 0.35 * Math.pow(t, 3)) * (i % 4 === 0 ? 1.1 : 1);
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * 6.283, k = 1 + 0.18 * Math.sin(a * 3 + nz[0] + t * 2) + 0.1 * Math.sin(a * 7 + nz[1] + t * 5) + 0.05 * Math.sin(a * 13 + nz[2]);
      const rr = R * prof * k, top = i === rows ? 0.6 : 1;
      const cap = t > 0.97 ? [0.35, 0.5, 0.2] : band, sh = 0.88 + 0.12 * Math.sin(a * 5 + t * 9);
      row.push(gb.v(Math.cos(a) * rr * top, t * H - 1.0 + (i === rows ? 0.6 * Math.sin(a * 2 + nz[0]) : 0), Math.sin(a) * rr * top, cap[0] * sh, cap[1] * sh, cap[2] * sh));
    }
    ids.push(row);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) gb.quad(ids[i][j], ids[i][(j + 1) % cols], ids[i + 1][(j + 1) % cols], ids[i + 1][j]);
  const topc = gb.v(0, H - 1.0 + 0.2, 0, 0.35, 0.5, 0.2); for (let j = 0; j < cols; j++) gb.tri(ids[rows][j], topc, ids[rows][(j + 1) % cols]);
  const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.userData.tag = "stack";
  return [{ geo: gb.geo(true), mat: toonify(m, { shadeK: 0.7, rim: 0.12, height: H, moss: 0.0 }) }];
}

// ------------------------------------------------------------------ OCEAN (toon): hard depth colour bands, shore foam, breaking lines, vertex waves, sparkle
const FOGV = THREE.UniformsLib.fog;
const live = (u, shared) => Object.assign(u, shared);   // UniformsUtils.merge clones numbers/textures: re-attach the shared live uniform objects
export function oceanMaterial() {
  const C = (h) => new THREE.Color(h);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    uniforms: live(THREE.UniformsUtils.merge([FOGV, { uC0: { value: C(0x92e8d8) }, uC1: { value: C(0x45c4c8) }, uC2: { value: C(0x2594c4) }, uC3: { value: C(0x1d6aac) }, uC4: { value: C(0x174a88) } }]),
      { uTime: U.uTime, uNoise: { value: noiseTexture() }, uSunV: U.uSunV, uUpV: U.uUpV, uSkyCol: U.uSkyCol }),
    vertexShader: `${GLSL_SHORE}
uniform float uTime; varying vec3 vLoc; varying vec3 vBV;
#include <fog_pars_vertex>
void main(){
  vec3 p = position; float d = p.z - bShoreZ(p.x); float depth = d >= 0.0 ? -1.0 : bDepth(-d);
  float amp = 0.17 * smoothstep(0.15, 2.5, depth);
  float w = sin(p.x * 0.31 + uTime * 1.05) * 0.5 + sin(p.z * 0.23 - uTime * 0.85 + p.x * 0.11) * 0.35 + sin((p.x + p.z) * 0.55 + uTime * 1.7) * 0.15;
  p.y += w * amp; vLoc = p;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); vBV = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `${GLSL_SHORE}
precision highp float; varying vec3 vLoc; varying vec3 vBV;
uniform float uTime; uniform sampler2D uNoise; uniform vec3 uSunV, uUpV, uSkyCol, uC0, uC1, uC2, uC3, uC4;
#include <fog_pars_fragment>
void main(){
  vec2 P = vLoc.xz; float dd = P.y - bShoreZ(P.x); if (dd >= 0.0) discard;
  float vDepth = bDepth(-dd);
  float nA = texture2D(uNoise, P * 0.11 + vec2(uTime * 0.02, 0.0)).r, nB = texture2D(uNoise, P * 0.35 - vec2(0.0, uTime * 0.03)).g;
  float dj = vDepth + (nA - 0.5) * 0.35;
  vec3 col; float a;
  if (dj < 0.30) { col = uC0; a = 0.52; } else if (dj < 1.1) { col = uC1; a = 0.74; } else if (dj < 2.6) { col = uC2; a = 0.88; } else if (dj < 5.5) { col = uC3; a = 0.96; } else { col = uC4; a = 1.0; }
  float el = step(abs(dj - 0.30), 0.025) + step(abs(dj - 1.1), 0.03) + step(abs(dj - 2.6), 0.035) + step(abs(dj - 5.5), 0.04);
  col = mix(col, vec3(1.0), clamp(el, 0.0, 1.0) * 0.16);
  float sw = 0.5 + 0.5 * sin(uTime * 0.55 + P.x * 0.17), se = 0.05 + 0.20 * sw;
  float foam = step(vDepth, se + (nB - 0.5) * 0.08);
  foam = max(foam, step(abs(vDepth - (se + 0.28)), 0.035) * step(0.42, nB));
  float ph = vDepth * 0.45 + uTime * 0.18 + nA * 0.25, f = fract(ph);
  float lw = 0.045 * (1.0 - smoothstep(1.0, 4.5, vDepth));
  foam = max(foam, step(f, lw * 2.2) * step(0.42, nB) * step(0.35, vDepth) * (1.0 - step(5.0, vDepth)));
  col = mix(col, vec3(0.97, 0.99, 1.0), foam); a = max(a, foam * 0.96);
  vec3 Vv = normalize(vBV); vec3 R = reflect(-Vv, uUpV);
  float g = 0.35 + 0.65 * pow(max(dot(R, uSunV), 0.0), 4.0);
  float s = texture2D(uNoise, P * 1.1 + vec2(uTime * 0.05, uTime * 0.03)).b * texture2D(uNoise, P * 0.77 - vec2(uTime * 0.04, 0.0)).a;
  col += vec3(1.0, 0.97, 0.85) * step(0.5, s) * g * (1.0 - foam);
  float fr = pow(1.0 - clamp(dot(uUpV, Vv), 0.0, 1.0), 3.0);
  col = mix(col, uSkyCol, floor(fr * 3.0) / 3.0 * 0.5);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  return m;
}
/** tide pool water disc (radius R): hard bands from the rim to the centre, sparkle */
export function poolMaterial(R = 2) {
  const C = (h) => new THREE.Color(h);
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: live(THREE.UniformsUtils.merge([FOGV, { uR: { value: R }, uC0: { value: C(0x9be7b0) }, uC1: { value: C(0x4cc7b4) }, uC2: { value: C(0x2a93b4) } }]),
      { uTime: U.uTime, uNoise: { value: noiseTexture() }, uSunV: U.uSunV, uUpV: U.uUpV }),
    vertexShader: `varying vec3 vLoc; varying vec3 vBV;
#include <fog_pars_vertex>
void main(){ vLoc = position; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vBV = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `precision highp float; varying vec3 vLoc; varying vec3 vBV; uniform float uTime, uR; uniform sampler2D uNoise; uniform vec3 uSunV, uUpV, uC0, uC1, uC2;
#include <fog_pars_fragment>
void main(){
  vec2 P = vLoc.xz; float n = texture2D(uNoise, P * 0.4 + uTime * 0.01).r; float q = length(P) / uR + (n - 0.5) * 0.18;
  vec3 col = q > 0.72 ? uC0 : q > 0.4 ? uC1 : uC2; float a = q > 0.72 ? 0.55 : q > 0.4 ? 0.75 : 0.9;
  if (q > 0.93) { col = vec3(0.35, 0.62, 0.3); a = 0.85; }
  float s = texture2D(uNoise, P * 1.6 + vec2(uTime * 0.04, 0.0)).b * texture2D(uNoise, P * 1.1 - vec2(0.0, uTime * 0.03)).a;
  col += vec3(1.0, 0.97, 0.85) * step(0.5, s) * 0.8;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
}
/** sea spray / surf mist: n soft billboard puffs pulsing along the waterline */
export function seaSpray(xs, seed = 3, zOf = (x) => shoreZ(x) - 0.4) {
  const r = rng(seed), n = xs.length, m = new THREE.Matrix4();
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: U.uTime, uNoise: { value: noiseTexture() } },
    vertexShader: `uniform float uTime; varying vec2 vUv; varying float vA;
void main(){ vUv = uv; vec3 bp = instanceMatrix[3].xyz; float id = bp.x * 0.37 + bp.z * 0.11;
  float pulse = max(sin(uTime * 0.9 + id * 2.0 + bp.x * 0.17), 0.0); vA = pulse * 0.34;
  vec3 c = (modelMatrix * vec4(bp, 1.0)).xyz; float sz = length(modelMatrix[0].xyz) * length(instanceMatrix[0].xyz);
  c.y += (0.2 + pulse * 0.9) * length(modelMatrix[1].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 wp = c + right * position.x * sz * (1.0 + pulse * 0.6) + vec3(0.0, 1.0, 0.0) * position.y * sz * 0.8 * (1.0 + pulse * 0.5);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
    fragmentShader: `precision highp float; varying vec2 vUv; varying float vA; uniform float uTime; uniform sampler2D uNoise;
void main(){ float rr = length(vUv - 0.5) * 2.0; float n = texture2D(uNoise, vUv * 1.5 + vec2(uTime * 0.03)).r; float a = smoothstep(1.0, 0.15, rr) * vA * (0.5 + 0.9 * n);
  gl_FragColor = vec4(0.96, 0.99, 1.0, a);
  #include <colorspace_fragment>
}`,
  });
  const im = new THREE.InstancedMesh(geo, mat, n);
  for (let i = 0; i < n; i++) { const x = xs[i], z = zOf(x) - r() * 1.4, s = 1.4 + r() * 1.6; m.compose(V(x, 0.05, z), new THREE.Quaternion(), V(s, s, s)); im.setMatrixAt(i, m); }
  im.frustumCulled = false; im.renderOrder = 45; im.name = "spray"; return im;
}

// ------------------------------------------------------------------ ground shader: 4-layer sand splat + wet line + ripples + underwater tint
/** texs = [dry, patch1, patch2, rock]; wetTex = damp sand. o.disc = thumbnail disc (wet gradient across the disc instead of the world shore) */
export function beachGround(texs, wetTex, o = {}) {
  const m = groundMaterial(texs, { tile: o.tile || 3.0, tints: o.tints || [[1.04, 1.0, 0.93], [1.0, 0.98, 0.92], [1.05, 1.02, 0.97], [0.95, 0.93, 0.9]], splat: o.splat || [0.62, 0.66, 0, 9], grade: o.grade });
  m.userData.tag = "beachground" + (o.disc ? "D" : "");
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    prev(sh);
    sh.uniforms.uWetT = { value: wetTex }; sh.uniforms.uRip = { value: o.ripples ?? 0.2 }; sh.uniforms.uDisc = { value: o.disc ? 1 : 0 };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLoc;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  vLoc = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vLoc; uniform sampler2D uWetT; uniform float uRip, uDisc, uTime; float bWet = 0.0;
${GLSL_SHORE}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  { vec2 P = vLoc.xz; float nn = texture2D(uNoise, P * 0.05).r; float nm = texture2D(uNoise, P * 0.21 + 7.0).g;
    float dS = P.y - bShoreZ(P.x); float dD = (P.y + 1.3) * 2.6 - 0.4; float d = mix(dS, dD, uDisc);
    float sw = 0.5 + 0.5 * sin(uTime * 0.55 + P.x * 0.17);
    float wl = 2.4 + 1.5 * sw + (nn - 0.5) * 1.6;
    float wet = 1.0 - smoothstep(wl, wl + 0.18, d);
    float damp = (1.0 - smoothstep(wl, wl + 6.0, d)) * 0.5;
    vec3 wc = bGrade(texture2D(uWetT, P / 2.6).rgb, 1.38, 0.35) * 0.66;
    diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.22 * damp), wc, wet);
    float rp = sin(d * 6.5 + nm * 5.0 + sin(P.x * 0.45) * 1.4 + 1.0);
    float rr = smoothstep(0.55, 0.9, rp) * smoothstep(-1.0, 0.5, d) * (1.0 - smoothstep(8.0, 22.0, d)) * uRip * (0.5 + nm);
    diffuseColor.rgb *= 1.0 - rr;
    float sub = smoothstep(0.0, -1.5, vLoc.y); diffuseColor.rgb *= mix(vec3(1.0), vec3(0.50, 0.72, 0.78), sub);
    bWet = wet; }`)
      .replace("#include <opaque_fragment>", `{ vec3 Vv = normalize(vBV); float fr = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 3.0); outgoingLight += uSkyCol * bWet * fr * 0.55; }
#include <opaque_fragment>`);
  };
  return m;
}

// ------------------------------------------------------------------ algae on rocks (re-colour the shader moss)
export function algaeify(parts, amt = 0.9, col = [0.1, 0.4, 0.2]) {
  for (const p of parts) {
    p.mat.userData.toon.moss = amt; p.mat.userData.tag = "algae";
    const prev = p.mat.onBeforeCompile; p.mat.onBeforeCompile = (sh) => { prev(sh); sh.uniforms.uMossCol.value.set(col[0], col[1], col[2]); };
    p.mat.needsUpdate = true;
  }
  return parts;
}
export { GRADE_PHOTO, light };
// shared geometry helpers for lakeproc.js
export { GB, tube, ribbon, canvasTex, mixc, V, addGeo };
