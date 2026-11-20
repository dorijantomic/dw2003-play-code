// LAKE procedural assets (no download, our own code, no licence needed): lake law (shoreline + bowl depth, JS and GLSL), toon lake water with
// planar-reflection (low-res mirror render of a small layer-1 set), lake-bank ground shader (mud / pebbles / wet bank), reeds, cattails, bulrush,
// rushes, sedge, marsh grass, horsetail, water iris, loosestrife, lily pads + flowers + lotus, duckweed / algae mats, submerged eelgrass / milfoil /
// pondweed, weeping willow (hanging strand cards, wind), overhanging branch, fallen log, mist sheets, light motes.
// Shore law shared by JS and GLSL: lakeD(x,z) = distance to the shore in metres, > 0 inside the lake. lakeDepth(d) the bowl depth. Water level y = 0.
import * as THREE from "three";
import { toonify, groundMaterial, rng, U, noiseTexture, light } from "./toolkit.js";
import { GB, tube, ribbon, canvasTex, mixc, V, addGeo } from "./beachproc.js";
import { grassClumpParts } from "./procedural.js";

// ------------------------------------------------------------------ lake law
export const LAKE_C = [0, -26];
export const lakeR = (t) => 44 + 5.5 * Math.sin(2 * t + 0.8) + 3.2 * Math.sin(3 * t + 2.1) + 1.8 * Math.sin(5 * t + 0.3);
export const lakeD = (x, z) => { const qx = x - LAKE_C[0], qz = z - LAKE_C[1]; return lakeR(Math.atan2(qz, qx)) - Math.hypot(qx, qz); };
export const lakeDepth = (d) => Math.min(0.14 * d + 0.012 * d * d, 4.2);
/** point at angle th (0 = +x, pi/2 = +z, the near bank) and e metres inland of the shore (e < 0 = in the water) */
export const polar = (th, e) => { const r = lakeR(th) + e; return [LAKE_C[0] + Math.cos(th) * r, LAKE_C[1] + Math.sin(th) * r]; };
export const angleOf = (x, z) => Math.atan2(z - LAKE_C[1], x - LAKE_C[0]);
export const GLSL_LAKE = /* glsl */`
float lkR(float t){ return 44.0 + 5.5 * sin(2.0 * t + 0.8) + 3.2 * sin(3.0 * t + 2.1) + 1.8 * sin(5.0 * t + 0.3); }
float lkD(vec2 p){ vec2 q = p - vec2(0.0, -26.0); return lkR(atan(q.y, q.x)) - length(q); }
float lkDepth(float d){ return min(0.14 * d + 0.012 * d * d, 4.2); }
`;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function vnoise(x, z, f, s = 0) {
  const X = x * f + s * 17.3, Z = z * f + s * 9.1, xi = Math.floor(X), zi = Math.floor(Z), fx = X - xi, fz = Z - zi;
  const h = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - sx) + h(xi + 1, zi) * sx) * (1 - sz) + (h(xi, zi + 1) * (1 - sx) + h(xi + 1, zi + 1) * sx) * sz;
}
/** terrain height (m). Water level is y = 0; the lake bed is a bowl, the bank rises gently, hills far away */
export function lakeH(x, z) {
  const d = lakeD(x, z);
  if (d > 0) return -lakeDepth(d);
  const e = -d;
  let h = 0.05 * Math.min(e, 14) + 0.22 * vnoise(x, z, 0.12, 2) * sstep(0.5, 5, e);
  const dn = sstep(26, 90, e);
  if (dn > 0) h += dn * (2.5 + 9.0 * vnoise(x, z, 0.012, 4) + 3.0 * vnoise(x, z, 0.04, 5));
  return h;
}

// ------------------------------------------------------------------ materials + small helpers
const vcMat = (tag, t, o = {}) => { const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...o }); m.userData.tag = tag; return toonify(m, t); };
const cardMat = (tag, map, t, o = {}) => { const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5, ...o }); m.alphaToCoverage = true; m.userData.tag = tag; return toonify(m, t); };
/** floating on water: small bob + drift in the vertex shader (after toonify) */
export function floaty(m, tag, amp = 0.016) {
  const prev = m.onBeforeCompile; m.userData.tag = tag;
  m.onBeforeCompile = (sh) => {
    prev(sh);
    sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", `{ float bph = bIP.x * 1.7 + bIP.z * 2.3; transformed.y += ${amp} * sin(uTime * 0.9 + bph) + ${amp * 0.4} * sin(uTime * 1.7 + bph * 1.3);
  transformed.xz += ${amp * 0.8} * vec2(sin(uTime * 0.5 + bph), cos(uTime * 0.43 + bph * 0.7)); }
#include <project_vertex>`);
  };
  return m;
}
/** waterline look for rocks / logs / posts: dark wet band, algae fringe and a teal tint below y = 0 (world space) */
export function waterlineify(parts, o = {}) {
  const mode = o.mode === "object" ? 1 : 0, level = o.level || 0, col = o.algae || [0.10, 0.30, 0.12];
  for (const p of parts) {
    const prev = p.mat.onBeforeCompile, tag = (p.mat.userData.tag || "") + "wl"; p.mat.userData.tag = tag;
    p.mat.onBeforeCompile = (sh) => {
      prev(sh);
      sh.uniforms.uAlg = { value: new THREE.Vector3(col[0], col[1], col[2]) }; sh.uniforms.uWLm = { value: mode }; sh.uniforms.uWLo = { value: level };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vOY;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  vOY = position.y;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uAlg; uniform float uWLm, uWLo; varying float vOY;")
        .replace("#include <opaque_fragment>", `{ float yy = uWLm > 0.5 ? vOY - uWLo : vWP.y, nn = texture2D(uNoise, vWP.xz * 1.3 + vWP.y * 0.8).r;
  float wet = 1.0 - smoothstep(0.10, 0.34 + 0.22 * nn, yy);                       // wet band above the water
  float alg = (1.0 - smoothstep(-0.05, 0.16 + 0.1 * nn, yy)) * smoothstep(-1.2, -0.05, yy);   // algae fringe at the line
  outgoingLight *= mix(1.0, 0.62, wet);
  outgoingLight = mix(outgoingLight, uAlg * (0.75 + 0.5 * nn) * 1.6, alg * 0.55);
  outgoingLight *= mix(vec3(1.0), vec3(0.55, 0.78, 0.72), smoothstep(0.0, -1.2, yy)); }
#include <opaque_fragment>`);
    };
    p.mat.needsUpdate = true;
  }
  return parts;
}
function leaf(gb, p0, yaw, len, hw, lift, droop, c0, c1, segs = 4) {
  const P = [], S = [], dx = Math.cos(yaw), dz = Math.sin(yaw);
  for (let i = 0; i <= segs; i++) { const u = i / segs; P.push(V(p0.x + dx * len * u * 0.9, p0.y + len * (lift * u - droop * u * u), p0.z + dz * len * u * 0.9)); S.push(V(-dz, 0, dx)); }
  ribbon(gb, P, S, (t) => hw * (1 - 0.88 * Math.pow(t, 1.5)) + 0.002, (t) => mixc(c0, c1, t));
}
const lerpP = (P, t) => { const k = Math.min(P.length - 2, Math.floor(t * (P.length - 1))), f = t * (P.length - 1) - k; return P[k].clone().lerp(P[k + 1], f); };
const arcP = (ox, oz, a, H, lean, n = 5, curl = 1) => { const P = []; for (let i = 0; i < n; i++) { const t = i / (n - 1); P.push(V(ox + Math.cos(a) * lean * H * t * t * curl, H * t, oz + Math.sin(a) * lean * H * t * t * curl)); } return P; };
const done = (gb, mat) => [{ geo: gb.geo(true), mat }];

// ------------------------------------------------------------------ REEDS (common reed, Phragmites): culms, arching straps, plumes, a few dead culms
export function reedParts(seed = 1, variant = 0) {
  const r = rng(seed * 53 + 7), gb = new GB(), n = variant === 1 ? 5 : 6;
  for (let s = 0; s < n; s++) {
    const a = r() * 6.28, rad = r() * 0.14, ox = Math.cos(a) * rad, oz = Math.sin(a) * rad, H = (variant === 1 ? 1.5 : 1.9) + 0.9 * r(), lean = 0.1 + 0.24 * r(), dead = s % 5 === 4;
    const P = arcP(ox, oz, a + 1.2, H, lean, 5), R = P.map((_, i) => 0.0125 * (1 - 0.5 * i / 4));
    const c0 = dead ? [0.62, 0.52, 0.3] : [0.5, 0.48, 0.24], c1 = dead ? [0.7, 0.6, 0.34] : [0.42, 0.58, 0.22];
    tube(gb, P, R, 3, (i) => mixc(c0, c1, i / 4), [false, false]);
    if (!dead) {
      for (let l = 0; l < 6; l++) { const p = lerpP(P, 0.25 + 0.13 * l); leaf(gb, p, a + l * 2.4 + (r() - 0.5) * 0.8, 0.55 + 0.4 * r(), 0.03, 0.55, 1.15, [0.36, 0.55, 0.2], [0.52, 0.6, 0.27], 4); }
      const tip = P[4], d = P[4].clone().sub(P[3]).normalize(), pl = [tip, tip.clone().addScaledVector(d, 0.14).add(V(0, 0, 0)), tip.clone().addScaledVector(d, 0.3).add(V(Math.cos(a) * 0.05, -0.05, Math.sin(a) * 0.05))];
      tube(gb, pl, [0.012, 0.034, 0.006], 5, (i) => (i === 1 ? [0.5, 0.36, 0.38] : [0.62, 0.52, 0.42]), [false, true]);
    } else leaf(gb, lerpP(P, 0.5), a + 1.0, 0.5, 0.025, 0.3, 0.9, [0.62, 0.55, 0.32], [0.7, 0.62, 0.38], 3);
  }
  return done(gb, vcMat("reed", { wind: 1.0, height: 3.0, flutter: 0.22, fade: [36, 62], shadeK: 0.78, rim: 0.2, trans: 0.35 }));
}
// ------------------------------------------------------------------ CATTAIL (Typha): stalk, brown sausage head with spike, long straps
export function cattailParts(seed = 1, variant = 0) {
  const r = rng(seed * 61 + 3), gb = new GB(), n = variant === 1 ? 3 : 4;
  for (let s = 0; s < n; s++) {
    const a = r() * 6.28, rad = r() * 0.12, ox = Math.cos(a) * rad, oz = Math.sin(a) * rad, H = 1.5 + 0.7 * r(), P = arcP(ox, oz, a, H, 0.08 + 0.12 * r(), 5);
    tube(gb, P, P.map((_, i) => 0.011 * (1 - 0.35 * i / 4)), 3, (i) => mixc([0.48, 0.55, 0.26], [0.4, 0.52, 0.22], i / 4), [false, false]);
    const h0 = lerpP(P, 0.74), h1 = lerpP(P, 0.9), dirv = h1.clone().sub(h0).normalize(), hp = [h0, h0.clone().addScaledVector(dirv, 0.1), h0.clone().addScaledVector(dirv, 0.22), h1.clone().addScaledVector(dirv, 0.02)];
    tube(gb, hp, [0.02, 0.032, 0.031, 0.021], 6, (i, jf) => mixc([0.32, 0.18, 0.1], [0.2, 0.11, 0.07], (jf * 3 + i) % 1), [true, true]);
    tube(gb, [h1.clone().addScaledVector(dirv, 0.02), h1.clone().addScaledVector(dirv, 0.2)], [0.006, 0.002], 3, () => [0.5, 0.45, 0.25], [false, false]);
  }
  for (let l = 0; l < 6; l++) leaf(gb, V((r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.1), r() * 6.28, 1.3 + 0.7 * r(), 0.034, 1.0, 0.9, [0.3, 0.5, 0.2], [0.45, 0.6, 0.25], 5);
  return done(gb, vcMat("cattail", { wind: 0.95, height: 2.4, flutter: 0.15, fade: [36, 62], shadeK: 0.78, rim: 0.2, trans: 0.3 }));
}
// ------------------------------------------------------------------ BULRUSH (round stems, brown spikelet clusters)
export function bulrushParts(seed = 1) {
  const r = rng(seed * 29 + 11), gb = new GB();
  for (let s = 0; s < 9; s++) {
    const a = r() * 6.28, rad = r() * 0.12, H = 1.1 + 0.8 * r(), P = arcP(Math.cos(a) * rad, Math.sin(a) * rad, a + 0.6, H, 0.1 + 0.14 * r(), 4);
    tube(gb, P, P.map((_, i) => 0.0085 * (1 - 0.45 * i / 3)), 3, (i) => mixc([0.42, 0.52, 0.24], [0.28, 0.5, 0.2], i / 3), [false, false]);
    const t3 = P[3], dir = P[3].clone().sub(P[2]).normalize();
    for (let k = 0; k < 3; k++) { const b = t3.clone().addScaledVector(dir, -0.03 + 0.02 * k).add(V((r() - 0.5) * 0.05, 0, (r() - 0.5) * 0.05)); tube(gb, [b, b.clone().add(V((r() - 0.5) * 0.06, 0.05, (r() - 0.5) * 0.06))], [0.012, 0.01], 4, () => (k % 2 ? [0.42, 0.26, 0.12] : [0.34, 0.2, 0.1]), [true, true]); }
    tube(gb, [t3, t3.clone().addScaledVector(dir, 0.18).add(V(0.05, -0.02, 0))], [0.005, 0.002], 3, () => [0.3, 0.5, 0.2], [false, false]);
  }
  return done(gb, vcMat("bulrush", { wind: 0.95, height: 2.0, flutter: 0.12, fade: [36, 62], shadeK: 0.78, rim: 0.2, trans: 0.3 }));
}
// ------------------------------------------------------------------ RUSHES (Juncus): dense clump of thin arching round stems with small brown flower clusters
export function rushParts(seed = 1) {
  const r = rng(seed * 17 + 5), gb = new GB();
  for (let s = 0; s < 20; s++) {
    const a = r() * 6.28, rad = r() * 0.1, H = 0.55 + 0.5 * r(), P = arcP(Math.cos(a) * rad, Math.sin(a) * rad, a, H, 0.3 + 0.5 * r(), 4);
    tube(gb, P, P.map((_, i) => 0.0055 * (1 - 0.6 * i / 3)), 3, (i) => mixc([0.34, 0.46, 0.2], [0.22, 0.46, 0.16], i / 3), [false, false]);
    if (s % 2 === 0) { const p = lerpP(P, 0.8); for (let k = 0; k < 3; k++) tube(gb, [p, p.clone().add(V((r() - 0.5) * 0.1, 0.06, (r() - 0.5) * 0.1))], [0.006, 0.01], 3, () => [0.4, 0.26, 0.12], [false, true]); }
  }
  return done(gb, vcMat("rush", { wind: 1.0, height: 1.0, flutter: 0.15, fade: [30, 55], shadeK: 0.78, rim: 0.2, trans: 0.3 }));
}
// ------------------------------------------------------------------ SEDGE (Carex): arching straps + seed spikes
export function sedgeParts(seed = 1) {
  const g = grassClumpParts({ blades: 9, segs: 3, h: [0.45, 0.85], w: 0.05, rootCol: [0.14, 0.3, 0.08], tipCol: [0.5, 0.68, 0.2], seed: seed * 11 + 2, spread: 0.12, fade: [30, 55], wind: 1.0 });
  const r = rng(seed * 7 + 1), gb = new GB();
  for (let s = 0; s < 4; s++) { const a = r() * 6.28, P = arcP(Math.cos(a) * 0.04, Math.sin(a) * 0.04, a, 0.7 + 0.3 * r(), 0.5, 4); tube(gb, P, P.map((_, i) => 0.005 * (1 - 0.3 * i / 3)), 3, () => [0.4, 0.5, 0.2], [false, false]);
    const e = P[3]; tube(gb, [e, e.clone().add(V(0.02, 0.07, 0)), e.clone().add(V(0.04, 0.15, 0.01))], [0.012, 0.016, 0.004], 4, () => [0.46, 0.36, 0.16], [false, true]); }
  return [...g, ...done(gb, vcMat("sedgespike", { wind: 1.0, height: 1.0, flutter: 0.1, fade: [30, 55], shadeK: 0.78, rim: 0.2 }))];
}
// ------------------------------------------------------------------ MARSH GRASS (tall, moist meadow) + LOOSESTRIFE (purple spikes)
export function marshGrassParts(seed = 1) {
  return grassClumpParts({ blades: 7, segs: 4, h: [0.8, 1.45], w: 0.05, rootCol: [0.1, 0.26, 0.07], tipCol: [0.62, 0.72, 0.24], seed: seed * 13 + 3, spread: 0.2, fade: [30, 56], wind: 1.2 });
}
export function loosestrifeParts(seed = 1) {
  const r = rng(seed * 23 + 9), gb = new GB();
  for (let s = 0; s < 5; s++) {
    const a = r() * 6.28, H = 0.75 + 0.45 * r(), P = arcP(Math.cos(a) * 0.05, Math.sin(a) * 0.05, a, H, 0.12, 4);
    tube(gb, P, P.map((_, i) => 0.008 * (1 - 0.4 * i / 3)), 4, () => [0.28, 0.46, 0.2], [false, false]);
    for (let l = 0; l < 4; l++) leaf(gb, lerpP(P, 0.15 + 0.17 * l), a + l * 1.6, 0.16, 0.025, 0.4, 0.5, [0.26, 0.5, 0.2], [0.36, 0.58, 0.24], 2);
    const e = P[3], d = P[3].clone().sub(P[2]).normalize();
    for (let k = 0; k < 9; k++) { const t = k / 8, p = e.clone().addScaledVector(d, -0.26 + 0.28 * t); addGeo(gb, new THREE.IcosahedronGeometry(0.02 * (1 - 0.4 * t), 0), new THREE.Matrix4().makeTranslation(p.x + (r() - 0.5) * 0.025, p.y, p.z + (r() - 0.5) * 0.025), () => (k % 2 ? [0.7, 0.2, 0.62] : [0.56, 0.16, 0.5])); }
  }
  return done(gb, vcMat("loose", { wind: 0.9, height: 1.3, flutter: 0.25, fade: [28, 50], shadeK: 0.78, rim: 0.2 }));
}
// ------------------------------------------------------------------ WATER IRIS (sword leaves + yellow flowers)
export function irisParts(seed = 1) {
  const r = rng(seed * 31 + 5), gb = new GB();
  for (let l = 0; l < 8; l++) {
    const a = (l / 8) * 6.28 + r() * 0.5, len = 0.7 + 0.5 * r(), p0 = V(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03), P = [], S = [], k = 0.28 + 0.4 * r();
    for (let i = 0; i <= 5; i++) { const u = i / 5; P.push(V(p0.x + Math.cos(a) * len * k * u * u, len * u * (1 - 0.3 * k * u), p0.z + Math.sin(a) * len * k * u * u)); S.push(V(-Math.sin(a), 0, Math.cos(a))); }
    ribbon(gb, P, S, (t) => 0.034 * (1 - 0.75 * Math.pow(t, 1.6)) + 0.002, (t) => mixc([0.2, 0.42, 0.18], [0.38, 0.6, 0.26], t));
  }
  for (let f = 0; f < 3; f++) {
    const a = r() * 6.28, H = 0.85 + 0.35 * r(), P = arcP(Math.cos(a) * 0.04, Math.sin(a) * 0.04, a, H, 0.2, 4), top = P[3];
    tube(gb, P, P.map(() => 0.008), 3, () => [0.3, 0.5, 0.2], [false, false]);
    if (f < 2) {
      const yaw0 = r() * 6.28;
      for (let k = 0; k < 3; k++) {   // falls (drooping) + standards (upright)
        const ya = yaw0 + k * 2.094, c = V(Math.cos(ya), 0, Math.sin(ya));
        const b0 = gb.v(top.x, top.y, top.z, 0.9, 0.78, 0.15), b1 = gb.v(top.x + c.x * 0.07 + c.z * 0.03, top.y + 0.0, top.z + c.z * 0.07 - c.x * 0.03, 0.98, 0.84, 0.2), b2 = gb.v(top.x + c.x * 0.07 - c.z * 0.03, top.y, top.z + c.z * 0.07 + c.x * 0.03, 0.98, 0.84, 0.2);
        const b3 = gb.v(top.x + c.x * 0.14, top.y - 0.07, top.z + c.z * 0.14, 0.95, 0.76, 0.14); gb.quad(b0, b1, b3, b2);
        const s0 = gb.v(top.x, top.y + 0.01, top.z, 0.95, 0.82, 0.2), s1 = gb.v(top.x + Math.cos(ya + 1.05) * 0.03, top.y + 0.1, top.z + Math.sin(ya + 1.05) * 0.03, 0.98, 0.86, 0.24), s2 = gb.v(top.x - Math.cos(ya + 1.05) * 0.03 + c.x * 0.03, top.y + 0.1, top.z - Math.sin(ya + 1.05) * 0.03 + c.z * 0.03, 0.92, 0.78, 0.2); gb.tri(s0, s1, s2);
      }
    } else addGeo(gb, new THREE.IcosahedronGeometry(0.02, 0), new THREE.Matrix4().makeScale(1, 2.2, 1).setPosition(top.x, top.y + 0.03, top.z), () => [0.5, 0.58, 0.2]);
  }
  return done(gb, vcMat("iris", { wind: 0.7, height: 1.3, flutter: 0.15, fade: [30, 55], shadeK: 0.78, rim: 0.2, trans: 0.25 }));
}
// ------------------------------------------------------------------ HORSETAIL (Equisetum): jointed stem, whorls of needles
export function horsetailParts(seed = 1) {
  const r = rng(seed * 41 + 7), gb = new GB();
  for (let s = 0; s < 7; s++) {
    const a = r() * 6.28, H = 0.7 + 0.5 * r(), P = arcP(Math.cos(a) * 0.1 * r(), Math.sin(a) * 0.1 * r(), a, H, 0.1, 9);
    tube(gb, P, P.map((_, i) => 0.0085 * (1 - 0.4 * i / 8)), 3, (i) => (i % 2 ? [0.3, 0.46, 0.2] : [0.2, 0.36, 0.17]), [false, false]);
    for (let i = 1; i < 8; i++) {
      const p = P[i], len = 0.16 * (1 - i / 10) + 0.04;
      for (let k = 0; k < 5; k++) { const ang = a + (k / 5) * 6.283 + i, up = 0.55, e = p.clone().add(V(Math.cos(ang) * len, len * up, Math.sin(ang) * len)), w = 0.004; const v0 = gb.v(p.x - w, p.y, p.z, 0.22, 0.44, 0.17), v1 = gb.v(p.x + w, p.y, p.z, 0.22, 0.44, 0.17), v2 = gb.v(e.x, e.y, e.z, 0.4, 0.6, 0.24); gb.tri(v0, v1, v2); }
    }
    const t = P[8]; tube(gb, [t, t.clone().add(V(0, 0.035, 0)), t.clone().add(V(0, 0.07, 0))], [0.008, 0.011, 0.002], 4, () => [0.36, 0.3, 0.16], [false, true]);
  }
  return done(gb, vcMat("horsetail", { wind: 0.8, height: 1.3, flutter: 0.2, fade: [28, 50], shadeK: 0.78, rim: 0.2 }));
}

// ------------------------------------------------------------------ WATER LILIES: pads (notched, cupped), flowers (white / pink), lotus (tall)
function pad(gb, cx, cz, rad, yaw, y0, r, cup = 0.05) {
  const N = 14, c = gb.v(cx, y0 + 0.01, cz, 0.42, 0.66, 0.24), ids = [];
  for (let j = 0; j < N; j++) {
    const a = yaw + 0.16 + (j / (N - 1)) * (6.283 - 0.32), w = 1 + 0.06 * Math.sin(j * 3.1 + r() * 6), g = 0.9 + 0.2 * (j % 2);
    ids.push(gb.v(cx + Math.cos(a) * rad * w, y0 + cup * w * w * 0.6, cz + Math.sin(a) * rad * w, 0.2 * g, 0.43 * g, 0.14 * g));
  }
  for (let j = 0; j < N - 1; j++) gb.tri(c, ids[j + 1], ids[j]);
}
function lilyFlower(gb, cx, y0, cz, size, pink, r) {
  const rings = [{ n: 8, pitch: 0.7, len: 1.0, w: 0.34 }, { n: 7, pitch: 1.0, len: 0.75, w: 0.3 }, { n: 5, pitch: 1.3, len: 0.5, w: 0.26 }];
  for (const [ri, rg] of rings.entries()) for (let k = 0; k < rg.n; k++) {
    const a = (k / rg.n) * 6.283 + ri * 0.4 + r() * 0.1, L = size * rg.len, W = size * rg.w, cx_ = Math.cos(a), cz_ = Math.sin(a), px = -cz_, pz = cx_;
    const base = pink ? [0.98, 0.7, 0.8] : [0.99, 0.99, 0.96], tip = pink ? [0.96, 0.45, 0.62] : [0.99, 0.96, 0.9];
    const b = gb.v(cx, y0, cz, base[0], base[1], base[2]), m1 = gb.v(cx + cx_ * L * 0.45 + px * W, y0 + L * 0.3 * Math.sin(rg.pitch), cz + cz_ * L * 0.45 + pz * W, base[0], base[1], base[2]);
    const m2 = gb.v(cx + cx_ * L * 0.45 - px * W, y0 + L * 0.3 * Math.sin(rg.pitch), cz + cz_ * L * 0.45 - pz * W, base[0], base[1], base[2]), t = gb.v(cx + cx_ * L * Math.cos(rg.pitch * 0.6), y0 + L * 0.7 * Math.sin(rg.pitch), cz + cz_ * L * Math.cos(rg.pitch * 0.6), tip[0], tip[1], tip[2]);
    gb.quad(b, m1, t, m2);
  }
  addGeo(gb, new THREE.IcosahedronGeometry(size * 0.2, 0), new THREE.Matrix4().makeScale(1, 0.7, 1).setPosition(cx, y0 + size * 0.1, cz), () => [1.0, 0.82, 0.12]);
}
export function lilyPadParts(seed = 1, n = 1) {
  const r = rng(seed * 37 + 1), gb = new GB();
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = n > 1 ? 0.25 + 0.4 * r() * Math.sqrt(i) : 0; pad(gb, Math.cos(a) * d, Math.sin(a) * d, 0.17 + 0.12 * r(), r() * 6.28, 0.012, r); }
  return done(gb, floaty(vcMat("lilypad", { height: 0.1, fade: [34, 58], shadeK: 0.8, rim: 0.2, trans: 0.2 }), "lilypad"));
}
export function waterLilyParts(seed = 1, pink = false) {
  const r = rng(seed * 43 + 5), gb = new GB(), pg = new GB(), fl = new GB();
  for (let i = 0; i < 6; i++) { const a = i * 1.05 + r() * 0.5, d = 0.22 + 0.5 * r(); pad(pg, Math.cos(a) * d, Math.sin(a) * d, 0.17 + 0.13 * r(), r() * 6.28, 0.012, r); }
  const nf = 1 + (seed % 2); for (let f = 0; f < nf; f++) { const a = r() * 6.28, d = 0.15 + 0.3 * r(); lilyFlower(fl, Math.cos(a) * d, 0.02, Math.sin(a) * d, 0.1 + 0.03 * r(), pink, r); }
  const t = { height: 0.2, fade: [34, 58], shadeK: 0.8, rim: 0.2 };
  return [{ geo: pg.geo(true), mat: floaty(vcMat("lilypad", { ...t, trans: 0.2 }), "lilypad") }, { geo: fl.geo(true), mat: floaty(vcMat("lilyflower", { ...t, shadeK: 0.9, trans: 0.4 }), "lilyflower") }];
}
export function lotusParts(seed = 1) {
  const r = rng(seed * 59 + 3), gb = new GB(), pg = new GB(), fl = new GB();
  for (let i = 0; i < 3; i++) {
    const a = r() * 6.28, d = 0.2 + 0.4 * r(), H = 0.5 + 0.5 * r(), x = Math.cos(a) * d, z = Math.sin(a) * d;
    tube(gb, [V(x, 0, z), V(x + 0.03, H * 0.5, z), V(x, H, z)], [0.012, 0.011, 0.01], 4, () => [0.3, 0.5, 0.22], [false, false]);
    pad(pg, x, z, 0.3 + 0.1 * r(), r() * 6.28, H, r, 0.1);
  }
  for (let f = 0; f < 2; f++) {
    const a = r() * 6.28, d = 0.1 + 0.3 * r(), H = 1.0 + 0.4 * r(), x = Math.cos(a) * d, z = Math.sin(a) * d;
    tube(gb, [V(x, 0, z), V(x + 0.04, H * 0.5, z), V(x, H, z)], [0.014, 0.012, 0.011], 4, () => [0.34, 0.5, 0.22], [false, false]);
    lilyFlower(fl, x, H, z, 0.2, true, r);
  }
  const t = { height: 1.5, wind: 0.5, fade: [38, 62], shadeK: 0.8, rim: 0.2 };
  return [{ geo: gb.geo(true), mat: vcMat("lotusstem", t) }, { geo: pg.geo(true), mat: vcMat("lotuspad", { ...t, trans: 0.2 }) }, { geo: fl.geo(true), mat: vcMat("lotusfl", { ...t, shadeK: 0.9, trans: 0.4 }) }];
}

// ------------------------------------------------------------------ DUCKWEED / ALGAE mats: alpha-cut speckle texture on a flat floating quad
const _mats = {};
function matTexture(kind) {
  return _mats[kind] || (_mats[kind] = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); const r = rng(kind === "algae" ? 77 : 33);
    const centres = kind === "algae" ? 10 : 22;
    for (let c = 0; c < centres; c++) {
      const cx = 40 + r() * (w - 80), cy = 40 + r() * (h - 80), rad = 22 + r() * 30, n = kind === "algae" ? 30 : 70;
      for (let i = 0; i < n; i++) {
        const a = r() * 6.283, d = Math.pow(r(), 0.6) * rad, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (kind === "algae") { g.strokeStyle = ["#586b2a", "#6c7a30", "#4a5e26", "#7d8636"][i % 4]; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 8, y - 6, x + 12, y + 7, x + 22 + r() * 8, y + (r() - 0.5) * 12); g.stroke(); }
        else { g.fillStyle = ["#9fe03f", "#7fc72f", "#b4ea55", "#6db72a"][i % 4]; g.beginPath(); g.ellipse(x, y, 3.2 + r() * 2.2, 2.4 + r() * 1.6, r() * 3, 0, 7); g.fill(); }
      }
    }
  }));
}
export function matParts(kind = "duckweed") {
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0.014, 0);
  const m = new THREE.MeshLambertMaterial({ map: matTexture(kind), side: THREE.DoubleSide, alphaTest: 0.5 }); m.alphaToCoverage = true;
  const mat = floaty(toonify(m, { height: 0.1, fade: [60, 90], shadeK: 0.85, rim: 0, tint: kind === "algae" ? [1.0, 1.0, 0.9] : [1.05, 1.1, 0.9] }), "mat_" + kind, 0.008);
  return [{ geo: g, mat }];
}

// ------------------------------------------------------------------ SUBMERGED: eelgrass ribbons, milfoil cards, broad pondweed leaves
export function eelgrassParts(seed = 1) {
  const r = rng(seed * 47 + 2), gb = new GB();
  for (let b = 0; b < 12; b++) {
    const a = r() * 6.28, rad = r() * 0.14, H = 0.5 + 0.8 * r(), ox = Math.cos(a) * rad, oz = Math.sin(a) * rad, P = [], S = [], yaw = r() * 6.28, bend = 0.1 + 0.3 * r();
    for (let i = 0; i <= 5; i++) { const u = i / 5; P.push(V(ox + Math.cos(yaw) * bend * H * u * u, H * u, oz + Math.sin(yaw) * bend * H * u * u)); S.push(V(-Math.sin(yaw), 0, Math.cos(yaw))); }
    ribbon(gb, P, S, (t) => 0.02 * (1 - 0.6 * t) + 0.002, (t) => mixc([0.12, 0.34, 0.14], [0.36, 0.58, 0.22], t));
  }
  return done(gb, vcMat("eelgrass", { wind: 0.8, height: 1.4, flutter: 0.1, fade: [30, 55], shadeK: 0.85, rim: 0, trans: 0.2 }));
}
let _milTex = null;
function milfoilTex() {
  return _milTex || (_milTex = canvasTex(128, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.lineCap = "round"; const r = rng(5);
    g.strokeStyle = "#3d7a42"; g.lineWidth = 3; g.beginPath(); g.moveTo(64, h); g.quadraticCurveTo(70, h / 2, 62, 6); g.stroke();
    for (let i = 0; i < 26; i++) { const t = i / 25, y = h - 12 - t * (h - 24), len = 46 * Math.sin(Math.PI * (0.1 + 0.85 * t)) + 6; for (const s of [-1, 1]) { g.strokeStyle = i % 2 ? "#4f9a4a" : "#62b04e"; g.lineWidth = 2.4 - t; g.beginPath(); g.moveTo(64 + (r() - 0.5) * 3, y); g.quadraticCurveTo(64 + s * len * 0.6, y - 8, 64 + s * len, y + 4 + r() * 6); g.stroke(); } }
  }));
}
export function milfoilParts(seed = 1) {
  const r = rng(seed * 19 + 4), gb = new GB();
  for (let k = 0; k < 4; k++) {
    const a = r() * 3.14, H = 0.7 + 0.5 * r(), W = 0.5, sx = Math.cos(a), sz = Math.sin(a), ox = (r() - 0.5) * 0.3, oz = (r() - 0.5) * 0.3, bend = 0.25 * r(), rows = [];
    for (let i = 0; i <= 3; i++) { const u = i / 3, hw = W * 0.5 * (0.5 + 0.5 * Math.sin(Math.PI * (0.15 + 0.7 * u))), cx = ox + Math.cos(a + 1.57) * bend * u * u, cz = oz + Math.sin(a + 1.57) * bend * u * u;
      rows.push([gb.v(cx - sx * hw, H * u, cz - sz * hw, 1, 1, 1, 0, u), gb.v(cx + sx * hw, H * u, cz + sz * hw, 1, 1, 1, 1, u)]); }
    for (let i = 0; i < 3; i++) gb.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
  }
  return [{ geo: gb.geo(true), mat: cardMat("milfoil", milfoilTex(), { wind: 0.8, height: 1.2, flutter: 0.1, fade: [30, 55], shadeK: 0.85, rim: 0, trans: 0.2 }) }];
}
export function pondweedParts(seed = 1) {
  const r = rng(seed * 33 + 8), gb = new GB();
  for (let s = 0; s < 5; s++) {
    const a = r() * 6.28, H = 0.6 + 0.6 * r(), P = arcP(Math.cos(a) * 0.1, Math.sin(a) * 0.1, a, H, 0.2, 5);
    tube(gb, P, P.map(() => 0.007), 3, () => [0.4, 0.4, 0.2], [false, false]);
    for (let l = 0; l < 7; l++) { const p = lerpP(P, 0.2 + 0.11 * l), ya = a + l * 2.2, c = V(Math.cos(ya), 0, Math.sin(ya)), s2 = V(-c.z, 0, c.x), L = 0.16, W = 0.05;
      const v0 = gb.v(p.x, p.y, p.z, 0.3, 0.46, 0.2), v1 = gb.v(p.x + c.x * L * 0.5 + s2.x * W, p.y + 0.03, p.z + c.z * L * 0.5 + s2.z * W, 0.4, 0.6, 0.26), v2 = gb.v(p.x + c.x * L, p.y + 0.02, p.z + c.z * L, 0.5, 0.64, 0.28), v3 = gb.v(p.x + c.x * L * 0.5 - s2.x * W, p.y + 0.03, p.z + c.z * L * 0.5 - s2.z * W, 0.4, 0.6, 0.26); gb.quad(v0, v1, v2, v3); }
  }
  return done(gb, vcMat("pondweed", { wind: 0.7, height: 1.3, flutter: 0.15, fade: [30, 55], shadeK: 0.85, rim: 0 }));
}

// ------------------------------------------------------------------ WEEPING WILLOW: forked trunk, arching limbs, hanging strand cards (alpha leaves), wind sway
let _strandTex = null, _clusterTex = null;
function strandTexture() {
  return _strandTex || (_strandTex = canvasTex(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); const r = rng(9); g.lineCap = "round";
    g.strokeStyle = "#4d5a2a"; g.lineWidth = 2.2; g.beginPath(); g.moveTo(32, 0); for (let y = 0; y <= h; y += 16) g.lineTo(32 + Math.sin(y * 0.05) * 2.5, y); g.stroke();
    for (let y = 10; y < h; y += 7) for (const s of [-1, 1]) {
      const t = y / h, ang = 0.6 + (r() - 0.5) * 0.3, len = 22 + 7 * r(), x0 = 32 + Math.sin(y * 0.05) * 2.5;
      g.fillStyle = `hsl(${78 + t * 16 + r() * 8},${48 + t * 8}%,${44 + t * 12 + r() * 8}%)`; g.beginPath();
      g.moveTo(x0, y); g.quadraticCurveTo(x0 + s * len * 0.55, y + len * 0.1, x0 + s * len * Math.cos(ang), y + len * Math.sin(ang) * 0.9); g.quadraticCurveTo(x0 + s * len * 0.5, y + len * 0.45, x0, y + 2.5); g.fill();
    }
  }));
}
function clusterTexture() {
  return _clusterTex || (_clusterTex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); const r = rng(21);
    for (let i = 0; i < 26; i++) { const x = 14 + r() * 100, y = 14 + r() * 100, a = r() * 6.283, L = 15 + r() * 8; g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = `hsl(${88 + r() * 24},${46 + r() * 12}%,${30 + r() * 18}%)`; g.beginPath(); g.ellipse(L * 0.5, 0, L * 0.5, L * 0.27, 0, 0, 7); g.fill();
      g.strokeStyle = "rgba(255,255,200,0.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(L, 0); g.stroke(); g.restore(); }
  }));
}
/** hanging card: top point p, length L, width w, azimuth az, bow outward; two crossed cards if cross */
function strandCard(gb, p, L, w, az, bow, shade, cross, ph) {
  for (let c = 0; c < (cross ? 2 : 1); c++) {
    const a = az + c * 1.5708, sx = Math.cos(a), sz = Math.sin(a), ox = -sz * bow, oz = sx * bow, ids = [];
    for (let k = 0; k <= 5; k++) {
      const v = k / 5, sw = Math.sin(v * 3.1 + ph) * 0.07 * v, hw = w * 0.5 * (0.65 + 0.35 * Math.sin(Math.PI * Math.min(1, v * 0.85 + 0.12)));
      const cx = p.x + ox * Math.sin(v * 1.6) + sw * sz, cz = p.z + oz * Math.sin(v * 1.6) - sw * sx, y = p.y - L * v;
      ids.push([gb.v(cx - sx * hw, y, cz - sz * hw, shade, shade, shade, 0, 1 - v), gb.v(cx + sx * hw, y, cz + sz * hw, shade, shade, shade, 1, 1 - v)]);
    }
    for (let k = 0; k < 5; k++) gb.quad(ids[k][0], ids[k][1], ids[k + 1][1], ids[k + 1][0]);
  }
}
const barkCol = (i, jf) => (Math.floor(jf * 14) % 2 ? [0.3, 0.25, 0.19] : [0.22, 0.18, 0.14]);
export function willowParts(seed = 1, lod = 0) {
  const r = rng(seed * 91 + 13), bark = new GB(), cards = new GB();
  const H0 = 2.0 + 0.6 * r(), la = r() * 6.28, lx = Math.cos(la) * 0.5, lz = Math.sin(la) * 0.5;
  const T = [], TR = [0.55, 0.46, 0.38, 0.32, 0.27, 0.24];
  for (let i = 0; i < 6; i++) { const t = i / 5; T.push(V(lx * t * t * 1.4 + Math.sin(t * 5 + seed) * 0.06, H0 * t, lz * t * t * 1.4)); }
  tube(bark, T, TR, lod ? 6 : 8, barkCol, [false, false]);
  const fork = T[5], nL = 5 + (seed % 2), strands = [];
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * 6.283 + r() * 0.5, Lh = 3.0 + 1.6 * r(), Lv = 3.0 + 1.0 * r(), P = [], R = [];
    for (let k = 0; k <= 6; k++) { const u = k / 6; P.push(V(fork.x + Math.cos(a) * Lh * u, fork.y + Lv * u * (1.6 - u * 1.1), fork.z + Math.sin(a) * Lh * u)); R.push(0.18 * (1 - 0.82 * u) + 0.025); }
    tube(bark, P, R, lod ? 4 : 5, barkCol, [false, false]);
    for (const u of [0.45, 0.7]) {
      const k0 = lerpP(P, u), sa = a + (r() < 0.5 ? -1 : 1) * (0.5 + 0.4 * r()), TP = [], TRr = [];
      for (let k = 0; k < 4; k++) { const v = k / 3; TP.push(V(k0.x + Math.cos(sa) * 1.5 * v, k0.y + 0.5 * v - 0.7 * v * v, k0.z + Math.sin(sa) * 1.5 * v)); TRr.push(0.05 * (1 - 0.7 * v) + 0.01); }
      if (!lod) tube(bark, TP, TRr, 3, barkCol, [false, false]);
      for (let k = 1; k <= (lod ? 2 : 3); k++) strands.push({ p: TP[k], az: sa });
    }
    const ns = lod ? 5 : 10;
    for (let k = 0; k < ns; k++) strands.push({ p: lerpP(P, 0.3 + 0.7 * (k / (ns - 1))), az: a });
  }
  for (const [i, s] of strands.entries()) {
    const ground = 0.15 + 0.7 * r(), L = Math.max(1.0, Math.min(4.6, s.p.y - ground)), shade = 0.8 + 0.3 * r();
    strandCard(cards, s.p.clone().add(V((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3)), L, (lod ? 0.7 : 0.42) + 0.12 * r(), s.az + (r() - 0.5) * 1.2, 0.18 + 0.2 * r(), shade, !lod, i * 1.7);
  }
  const bm = vcMat("willowbark", { wind: 0.15, height: 5.5, shadeK: 0.7, rim: 0.12 }), cm = cardMat("willowcards", strandTexture(), { wind: 1.1, height: 6.0, flutter: 0.35, hang: 1, trans: 0.6, shadeK: 0.78, rim: 0.2 });
  return [{ geo: bark.geo(true), mat: bm }, { geo: cards.geo(true), mat: cm }];
}
// ------------------------------------------------------------------ OVERHANGING BRANCH: leaning limb out over the water (+z), leaf clusters + hanging twigs
export function overhangParts(seed = 1) {
  const r = rng(seed * 71 + 5), bark = new GB(), lf = new GB(), n = 10, P = [], R = [];
  for (let k = 0; k < n; k++) { const u = k / (n - 1); P.push(V(Math.sin(u * 4 + seed) * 0.3 * u, 3.3 * Math.sin(u * 1.35) - 0.5 * u * u, -1.6 + 6.6 * Math.pow(u, 1.2))); R.push(0.3 * (1 - 0.9 * u) + 0.025); }
  tube(bark, P, R, 7, barkCol, [false, true]);
  const leafPts = [];
  for (let k = 4; k < n; k++) leafPts.push(P[k]);
  for (const [bi, u] of [0.45, 0.55, 0.65, 0.78, 0.92].entries()) {
    const k0 = lerpP(P, u), side = bi % 2 ? 1 : -1, TP = [], TR = [];
    for (let k = 0; k < 4; k++) { const v = k / 3; TP.push(V(k0.x + side * 1.3 * v, k0.y + 0.4 * v - 0.5 * v * v, k0.z + 0.7 * v)); TR.push(0.04 * (1 - 0.7 * v) + 0.008); }
    tube(bark, TP, TR, 3, barkCol, [false, false]); leafPts.push(TP[2], TP[3]);
  }
  for (const [i, p0] of leafPts.entries()) for (let c = 0; c < 3; c++) {   // leaf clusters: three offsets, each two crossed quads
    const p = p0.clone().add(V((r() - 0.5) * 0.9, (r() - 0.5) * 0.5, (r() - 0.5) * 0.9)); const s = 1.0 + 0.5 * r(), a = r() * 3.14, sx = Math.cos(a) * s * 0.5, sz = Math.sin(a) * s * 0.5, q = [-1, 1], y0 = p.y - 0.3 * s, ids = [];
    const b = 0.85 + 0.25 * r();
    ids.push(lf.v(p.x - sx, y0, p.z - sz, b, b, b, 0, 0), lf.v(p.x + sx, y0, p.z + sz, b, b, b, 1, 0), lf.v(p.x + sx, y0 + s * 0.8, p.z + sz, b, b, b, 1, 1), lf.v(p.x - sx, y0 + s * 0.8, p.z - sz, b, b, b, 0, 1)); lf.quad(ids[0], ids[1], ids[2], ids[3]);
    if (c >= 0) { const a2 = a + 1.5708, tx = Math.cos(a2) * s * 0.5, tz = Math.sin(a2) * s * 0.5; ids.length = 0; ids.push(lf.v(p.x - tx, y0, p.z - tz, b, b, b, 0, 0), lf.v(p.x + tx, y0, p.z + tz, b, b, b, 1, 0), lf.v(p.x + tx, y0 + s * 0.8, p.z + tz, b, b, b, 1, 1), lf.v(p.x - tx, y0 + s * 0.8, p.z - tz, b, b, b, 0, 1)); lf.quad(ids[0], ids[1], ids[2], ids[3]); }
  }
  for (let k = 0; k < 6; k++) { const p = lerpP(P, 0.7 + 0.3 * (k / 5)); strandCard(lf, p, 1.0 + 0.8 * r(), 0.26, r() * 6.28, 0.1, 0.9 + 0.2 * r(), false, k * 2); }
  const lm = cardMat("overleaf", clusterTexture(), { wind: 0.9, height: 4.0, flutter: 0.6, trans: 0.5, shadeK: 0.76, rim: 0.2 });
  // the hanging strands use the willow strand texture but this part shares the cluster map: keep them subtle (they read as hanging leaf chains)
  return [{ geo: bark.geo(true), mat: vcMat("overbark", { wind: 0.12, height: 4.0, shadeK: 0.7, rim: 0.12 }) }, { geo: lf.geo(true), mat: lm }];
}
// ------------------------------------------------------------------ FALLEN LOG (procedural): curved trunk, root flare, broken stubs; moss + waterline in the shader
export function logParts(seed = 1) {
  const r = rng(seed * 83 + 1), gb = new GB(), L = 4.2 + 1.6 * r(), P = [], R = [];
  for (let i = 0; i <= 7; i++) { const u = i / 7; P.push(V(-L / 2 + L * u, 0.3 * Math.sin(u * 3 + seed) * 0.4 + 0.08 * u, 0.25 * Math.sin(u * 2.4 + seed * 2))); R.push(0.34 * (1 - 0.28 * u) * (0.94 + 0.06 * Math.sin(u * 13 + seed))); }
  tube(gb, P, R, 9, (i, jf) => (Math.floor(jf * 18) % 2 ? [0.34, 0.27, 0.2] : [0.26, 0.2, 0.15]), [true, true]);
  for (let k = 0; k < 5; k++) {   // root flare at the thick end
    const a = (k / 5) * 6.28 + r(), q = P[0].clone(); const rp = [q.clone().add(V(0, 0.05, 0)), q.clone().add(V(-0.35, 0.0, Math.cos(a) * 0.35)), q.clone().add(V(-0.8, -0.16, Math.cos(a) * 0.8 + Math.sin(a) * 0.3))];
    tube(gb, rp, [0.12, 0.07, 0.02], 4, barkCol, [false, true]);
  }
  for (let k = 0; k < 3; k++) { const p = lerpP(P, 0.25 + 0.25 * k), a = r() * 6.28, d = V(0, Math.cos(a), Math.sin(a)); tube(gb, [p.clone().addScaledVector(d, 0.25), p.clone().addScaledVector(d, 0.45), p.clone().addScaledVector(d, 0.85)], [0.07, 0.055, 0.03], 5, barkCol, [false, true]); }
  return done(gb, vcMat("loglake", { height: 1.0, shadeK: 0.7, rim: 0.12, moss: 0.75, fade: [70, 100] }));
}

// ------------------------------------------------------------------ MIST over the water (alpha masked by the lake law) + light MOTES
export function lakeMist(size = 220, layers = 3, y0 = 0.2, centre = LAKE_C) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: U.uTime, uNoise: { value: noiseTexture() }, uCol: { value: new THREE.Color(0.86, 0.92, 0.95) }, uSize: { value: size }, uCam: U.uCam },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `precision highp float; varying vec3 vW; uniform sampler2D uNoise; uniform vec3 uCol, uCam; uniform float uTime, uSize; ${GLSL_LAKE}
void main(){ vec2 p = vW.xz * 0.032 + vec2(uTime * 0.007, uTime * 0.0035) + vW.y * 0.9;
  float n = texture2D(uNoise, p).r * 0.6 + texture2D(uNoise, p * 2.1 + 4.0).g * 0.4;
  float d = lkD(vW.xz); float over = smoothstep(-14.0, 6.0, d);                       // thick over the water, thin banks of it on the land
  float edge = smoothstep(0.5, 0.32, length(vW.xz - uCam.xz) / (uSize * 0.5));
  float dc = smoothstep(2.0, 9.0, distance(vW, uCam));
  float a = smoothstep(0.40 - 0.1 * over, 0.78, n) * (0.14 + 0.32 * over) * edge * dc;
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
}`,
  });
  for (let i = 0; i < layers; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat); m.rotation.x = -Math.PI / 2; m.position.set(centre[0], y0 + i * 0.42, centre[1]); m.renderOrder = 40 + i; m.frustumCulled = false; g.add(m); }
  g.name = "lakemist"; return g;
}
export function moteCloud(n = 180, seed = 4, area = [0, -2, 40, 26], y = [0.3, 3.2]) {
  const r = rng(seed), pos = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = area[0] + (r() * 2 - 1) * area[2]; pos[i * 3 + 1] = y[0] + (y[1] - y[0]) * r(); pos[i * 3 + 2] = area[1] + (r() * 2 - 1) * area[3]; ph[i] = r() * 6.28; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(area[0], 1.5, area[1]), 120);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: U.uTime, uCol: { value: new THREE.Color(1.0, 0.9, 0.5) }, uScale: { value: 520 } },
    vertexShader: `attribute float aPh; uniform float uTime, uScale; varying float vA;
void main(){ vec3 p = position; float t = uTime * 0.35 + aPh;
  p += vec3(sin(t * 1.3 + aPh * 3.0) * 0.8, sin(t * 0.9) * 0.35, cos(t * 1.1 + aPh) * 0.8);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  float fl = pow(max(sin(uTime * (1.2 + fract(aPh) * 1.4) + aPh * 7.0), 0.0), 3.0); vA = 0.15 + 0.85 * fl;
  gl_PointSize = clamp(uScale * (0.06 + 0.05 * fl) / -mv.z, 1.5, 22.0); }`,
    fragmentShader: `precision highp float; uniform vec3 uCol; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a; gl_FragColor = vec4(uCol * a * vA, 1.0);
  #include <colorspace_fragment>
}`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 60; pts.name = "motes"; return pts;
}

// ------------------------------------------------------------------ LAKE GROUND: splat base + mud / pebble apron by distance to shore + wet bank + underwater tint
export function lakeGround(texs, mud, peb, o = {}) {
  const m = groundMaterial(texs, { tile: o.tile || 3.0, tints: o.tints || [[1.0, 1.04, 0.9], [1.0, 0.96, 0.86], [0.9, 1.0, 0.78], [0.96, 0.94, 0.9]], splat: o.splat || [0.5, 0.6, 0, 9] });
  m.userData.tag = "lakeground" + (o.disc ? "D" : "");
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    prev(sh);
    sh.uniforms.uMudT = { value: mud }; sh.uniforms.uPebT = { value: peb }; sh.uniforms.uDisc = { value: o.disc ? 1 : 0 };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLoc;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  vLoc = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vLoc; uniform sampler2D uMudT, uPebT; uniform float uDisc; float lWet = 0.0;
${GLSL_LAKE}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  { vec2 P = vLoc.xz; float e = mix(-lkD(P), (P.y + 1.3) * 2.8 - 0.8, uDisc);
    float n1 = texture2D(uNoise, P * 0.06).r, n2 = texture2D(uNoise, P * 0.33 + 3.0).g, n3 = texture2D(uNoise, P * 1.1).b;
    float zone = 1.0 - smoothstep(3.0 + 3.5 * n1, 5.0 + 5.0 * n1, e);
    float pebW = smoothstep(0.45, 0.58, n2 * 0.65 + n3 * 0.35) * (1.0 - smoothstep(1.0, 4.5, e + n1 * 2.0)) + smoothstep(0.64, 0.72, n2 * 0.7 + n3 * 0.3);
    vec3 mudc = bGrade(bTap(uMudT, P / 2.4, 0.0), 1.25, 0.3), pebc = bGrade(bTap(uPebT, P / 1.5, 0.0), 1.3, 0.35);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(mudc, pebc, clamp(pebW, 0.0, 1.0)), zone);
    float wl = 0.45 + 0.55 * n1, wet = 1.0 - smoothstep(wl, wl + 0.35, e);
    diffuseColor.rgb *= mix(1.0, 0.58, wet);
    diffuseColor.rgb *= 1.0 - 0.14 * smoothstep(0.35, 0.0, abs(e - wl - 0.45));
    float sub = mix(smoothstep(0.0, -2.5, vLoc.y), smoothstep(0.0, 3.0, -e), uDisc); diffuseColor.rgb *= mix(vec3(1.0), vec3(0.56, 0.74, 0.66), sub);
    lWet = wet; }`)
      .replace("#include <opaque_fragment>", `{ vec3 Vv = normalize(vBV); float fr = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 3.0); outgoingLight += uSkyCol * lWet * fr * 0.5; }
#include <opaque_fragment>`);
  };
  return m;
}

// ------------------------------------------------------------------ LAKE WATER: depth colour bands, planar reflection (low-res mirror), ripples, caustics, soft shore foam, sparkle
const FOGV = THREE.UniformsLib.fog;
export const reflection = { tex: null, mat: new THREE.Matrix4(), on: { value: 0 } };
export function lakeWaterMaterial(o = {}) {
  const C = (h) => new THREE.Color(h);
  const uni = THREE.UniformsUtils.merge([FOGV, { uC0: { value: C(0xcfe8a0) }, uC1: { value: C(0x6fc0a0) }, uC2: { value: C(0x2f8f9a) }, uC3: { value: C(0x1f6782) }, uC4: { value: C(0x154a68) } }]);
  Object.assign(uni, { uTime: U.uTime, uNoise: { value: noiseTexture() }, uSunV: U.uSunV, uUpV: U.uUpV, uSkyCol: U.uSkyCol, uRefl: { value: reflection.tex }, uReflM: { value: reflection.mat }, uReflOn: reflection.on, uDisc: { value: o.disc ? 1 : 0 } });
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, uniforms: uni,
    vertexShader: `uniform mat4 uReflM; varying vec3 vLoc; varying vec3 vBV; varying vec4 vRefl;
#include <fog_pars_vertex>
void main(){ vLoc = position; vRefl = uReflM * vec4(position, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vBV = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `${GLSL_LAKE}
precision highp float; varying vec3 vLoc; varying vec3 vBV; varying vec4 vRefl;
uniform float uTime, uReflOn, uDisc; uniform sampler2D uNoise, uRefl; uniform vec3 uSunV, uUpV, uSkyCol, uC0, uC1, uC2, uC3, uC4;
#include <fog_pars_fragment>
void main(){
  vec2 P = vLoc.xz;
  float d = lkD(P); if (uDisc > 0.5) d = (0.2 - P.y) * 6.0; if (d <= 0.0) discard;
  float dep = lkDepth(d);
  vec2 w1 = texture2D(uNoise, P * 0.19 + vec2(uTime * 0.011, uTime * 0.006)).rg - 0.5, w2 = texture2D(uNoise, P * 0.57 - vec2(uTime * 0.019, uTime * 0.014)).ba - 0.5, w3 = texture2D(uNoise, P * 1.6 + vec2(uTime * 0.03, -uTime * 0.025)).rg - 0.5;
  vec2 off = w1 * 0.7 + w2 * 0.45 + w3 * 0.2;
  // ring ripples (4 drops), thin bright lines
  float ring = 0.0;
  for (int i = 0; i < 4; i++) { float fi = float(i); vec2 c = vec2(sin(fi * 2.7 + 1.0) * 14.0 + 3.0, -26.0 + cos(fi * 3.9) * 12.0 + 14.0); if (uDisc > 0.5) c = vec2(0.2 * fi - 0.3, 0.1);
    float t = fract(uTime * 0.14 + fi * 0.27), rr = length(P - c), R = t * (uDisc > 0.5 ? 0.9 : 7.0); ring += smoothstep(0.1, 0.0, abs(rr - R) * (uDisc > 0.5 ? 6.0 : 1.0)) * (1.0 - t) * step(rr, R + 0.5); }
  off += vec2(ring * 0.25);
  float nA = texture2D(uNoise, P * 0.08 + vec2(uTime * 0.01, 0.0)).r, nB = texture2D(uNoise, P * 0.4 - vec2(0.0, uTime * 0.02)).g;
  float dj = dep + (nA - 0.5) * 0.45;
  vec3 col = mix(uC0, uC1, smoothstep(0.22, 0.28, dj)); col = mix(col, uC2, smoothstep(0.85, 0.91, dj)); col = mix(col, uC3, smoothstep(2.1, 2.2, dj)); col = mix(col, uC4, smoothstep(3.4, 3.5, dj));
  float a = mix(0.34, 0.5, smoothstep(0.22, 0.28, dj)); a = mix(a, 0.72, smoothstep(0.85, 0.91, dj)); a = mix(a, 0.88, smoothstep(2.1, 2.2, dj)); a = mix(a, 0.95, smoothstep(3.4, 3.5, dj));
  float el = step(abs(dj - 0.25), 0.02) + step(abs(dj - 0.88), 0.025) + step(abs(dj - 2.15), 0.03);
  col = mix(col, vec3(1.0), clamp(el, 0.0, 1.0) * 0.1);
  // caustics in the shallows: thin bright net where two drifting noises cross
  float c1 = texture2D(uNoise, P * 0.42 + off * 0.12 + vec2(uTime * 0.05, uTime * 0.03)).r, c2 = texture2D(uNoise, P * 0.55 + off * 0.1 - vec2(uTime * 0.04, -uTime * 0.035) + 7.0).g;
  float cau = smoothstep(0.93, 1.0, 1.0 - abs(c1 - c2) * 5.0) * (1.0 - smoothstep(0.5, 1.9, dep));
  col += vec3(0.95, 1.0, 0.8) * cau * 0.55; a = max(a, cau * 0.7);
  // reflection
  vec3 Vv = normalize(vBV); float fr = pow(1.0 - clamp(dot(uUpV, Vv), 0.0, 1.0), 2.4);
  vec2 ruv = vRefl.xy / vRefl.w + off * 0.032 * (0.6 + 0.4 * fr);
  vec3 rc = uReflOn > 0.5 ? texture2D(uRefl, ruv).rgb : mix(uSkyCol, vec3(1.0), 0.25); rc = mix(rc, floor(rc * 9.0 + 0.5) / 9.0, 0.45) * vec3(0.9, 0.98, 0.98);
  float rs = (0.22 + 0.68 * fr) * (0.5 + 0.5 * smoothstep(0.15, 1.4, dep));
  col = mix(col, rc, rs); a = max(a, rs * 0.92);
  // soft foam line at the shore + a faint second line, sparkle
  float foam = smoothstep(0.26 + 0.1 * nB, 0.02, d) * (0.55 + 0.45 * nB);
  foam = max(foam, smoothstep(0.045, 0.0, abs(d - 0.62 - 0.12 * sin(P.x * 2.3 + uTime * 0.7 + nA * 4.0))) * step(0.5, nB) * 0.55);
  col = mix(col, vec3(0.95, 0.99, 0.97), foam * 0.85); a = max(a, foam * 0.9);
  vec3 Rr = reflect(-Vv, uUpV); float g = 0.3 + 0.7 * pow(max(dot(Rr, uSunV), 0.0), 4.0);
  float s = texture2D(uNoise, P * 1.3 + vec2(uTime * 0.05, uTime * 0.03)).b * texture2D(uNoise, P * 0.83 - vec2(uTime * 0.04, 0.0)).a;
  col += vec3(1.0, 0.97, 0.85) * step(0.52, s) * g * (1.0 - foam); col += vec3(1.0) * ring * 0.18;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
}
/** Planar reflection, low-res: renders only objects on layer 1 (sky, tree impostors, rocks, a coarse bank mesh) from the mirrored camera into a small target. */
export class LakeReflector {
  constructor(renderer, w = 384, h = 288) {
    this.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, colorSpace: THREE.NoColorSpace });
    this.cam = new THREE.PerspectiveCamera(); this.cam.layers.set(1);
    this.busy = false; reflection.tex = this.rt.texture; reflection.on.value = 1;
    this._cw = new THREE.Vector3(); this._v = new THREE.Vector3(); this._t = new THREE.Vector3(); this._u = new THREE.Vector3(); this._rm = new THREE.Matrix4(); this._n = new THREE.Vector3(0, 1, 0); this._z = new THREE.Vector3();
    this.ms = 0;
  }
  render(renderer, scene, camera) {
    if (this.busy) return; this.busy = true;
    const t0 = performance.now(), c = this.cam, n = this._n;
    camera.updateMatrixWorld(); this._cw.setFromMatrixPosition(camera.matrixWorld); this._rm.extractRotation(camera.matrixWorld);
    const mir = (v) => v.set(v.x, -v.y, v.z);                                  // mirror about the water plane y = 0
    c.position.copy(mir(this._v.copy(this._cw)));
    this._t.set(0, 0, -1).applyMatrix4(this._rm).add(this._cw); mir(this._t);
    this._u.set(0, 1, 0).applyMatrix4(this._rm); mir(this._u); c.up.copy(this._u); c.lookAt(this._t);
    c.fov = camera.fov; c.aspect = camera.aspect; c.near = camera.near; c.far = camera.far; c.updateProjectionMatrix(); c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
    reflection.mat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    const sun = U.uSunV.value.clone(), up = U.uUpV.value.clone(), ar = renderer.info.autoReset, rt0 = renderer.getRenderTarget(), shadow = renderer.shadowMap.autoUpdate;
    U.uSunV.value.copy(light.dir).transformDirection(c.matrixWorldInverse); U.uUpV.value.set(0, 1, 0).transformDirection(c.matrixWorldInverse);
    renderer.info.autoReset = false; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, c);
    renderer.setRenderTarget(rt0); renderer.info.autoReset = ar; renderer.shadowMap.autoUpdate = shadow;
    U.uSunV.value.copy(sun); U.uUpV.value.copy(up); this.busy = false; this.ms = performance.now() - t0;
  }
}
