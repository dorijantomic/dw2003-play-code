// FOREST-FLOOR GROUND COVER of the BUILT arena look (Arena Viewer look=built): real 3D ferns, clover, grass tufts, leaf
// litter, twigs and pebbles scattered on the soil, loaded by web/arena-built.js for the recipe kind "soil" (meft1008
// wall_02 only; meft1013 has a "grass" ground and meft1002 none, so neither loads this file). The soil texture
// (soil.js) stays underneath; nothing here changes it.
//
// WHAT THE ORIGINAL FLOOR IS (measured from the 88x88 texel picture, research/r5-meft1008/floor-online.md): white-noise
// speckle on dark brown. Shares: near-black/neutral 34.7 %, dark red-brown 48.5 %, green-ish [32,40,24] 10.2 %, light
// yellow/orange-brown (max channel >= 56) 6.6 %. Flecks are 1-4 texels = 5-20 cm (1 texel = 0.051 m). I do not know
// yet whether a fleck is a leaf, moss, a twig or a plant. So the cover uses ONLY the measured colours below, and the
// litter mix follows the measured shares (brown : yellow-orange : green = 48.5 : 6.6 : 10.2).
//
// METHOD (floor-online.md): procedural geometry in code, no download, no licence. InstancedMesh per type and per
// azimuth sector (three.js culls a sector as a unit; discourse.threejs.org/t/88610, MIT), a vertex-shader distance
// fade that collapses far instances to their root, two fern detail levels switched on the CPU by distance, rejection
// sampling with jittered yaw / lean / scale (three.js ForestGenerator idea), per-instance colour (instanceColor), and
// the shared wind (shared.js builtWind: the same bend + flutter the trees use, times uFcWind).
//
// ASSET ONLY (geometry + cover material); the placement is web/built/place/floorcover.js. WHERE: land only (soilLand(rec).landAt). Nothing inside the fight clear radius (ctx.keepOut state.fightR, the very
// one the trees use; before the first place() a default of 8.5 m); the tall plants (ferns) also go through
// ctx.keepOut.reject (the eye -> fighter view cones). From there to the land edge of each azimuth the density rises
// as t^P (t 0..1), so it is sparse in the middle and dense under the tree ring.
// Units: render units, 400 = 1 m, floor y 0. Azimuth az = atan2(x, z).
//
// PICKED (not measured): every count, size range and curve below.
import * as THREE from "../lib3d/three.module.js";
import * as S from "./shared.js";

const M = S.UNITS_PER_M;

export const COVER = {
  SEED: 20261030,
  CLEAR_DEFAULT_M: 8.5,        // used until the arena reports its fight radius (fighters 5.9 m out + 2.5 m)
  REBUILD_STEP: 100,           // render units: a new fight radius this much different rebuilds the layer
  SECTORS: 6,                  // azimuth sectors per type (one InstancedMesh each, culled as a unit)
  // type: count (before density thinning), height / length range in metres, density exponent, minimum t
  FERN:   { n: 150,   h: [0.22, 0.42], p: 1.0, tMin: 0.10, sectors: 1 },
  CLOVER: { n: 260,   h: [0.07, 0.13], p: 0.8, tMin: 0.0,  sectors: 4 },
  TUFT:   { n: 260,   h: [0.12, 0.26], p: 0.9, tMin: 0.0,  sectors: 4 },
  LITTER: { n: 6500,  h: [0.06, 0.15], p: 0.9, tMin: 0.0,  sectors: 6 },
  TWIG:   { n: 520,   h: [0.14, 0.46], p: 1.1, tMin: 0.0,  sectors: 4 },
  PEBBLE: { n: 380,   h: [0.03, 0.09], p: 0.9, tMin: 0.0,  sectors: 4 },
  PATCH_M: 3.0,                // noise patch size (m): the cover comes in drifts, not an even sprinkle
  FERN_NEAR_M: 6.5,            // ferns nearer than this to the eye use the detailed geometry
  FAR0_M: 20, FAR1_M: 27,      // vertex-shader fade-out distance (m) from the eye
  WIND_K: 3.0,                 // the shared wind times this for small plants (their height units are tiny)
};

// MEASURED colours (sRGB) of wall_02's 15-colour picture (original palette sheet wall_c32_r254, rect 164,0,252,88)
export const MEAS = {
  brown: [[40, 24, 24, 18.4], [32, 16, 16, 12.8], [32, 24, 16, 9.7], [48, 24, 16, 7.6]],
  light: [[64, 48, 16, 3.1], [56, 56, 32, 2.1], [88, 80, 24, 0.7], [96, 64, 24, 0.3], [96, 88, 48, 0.2], [80, 64, 16, 0.1]],
  green: [[32, 40, 24, 10.2]],
  neutral: [[16, 16, 16, 19.4], [24, 24, 24, 6.8], [24, 16, 24, 8.5]],
  shares: { brown: 48.5, light: 6.6, green: 10.2, neutral: 34.7 },
};

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickW = (list, u) => { let tot = 0; for (const c of list) tot += c[3]; let a = u * tot; for (const c of list) { a -= c[3]; if (a <= 0) return c; } return list[list.length - 1]; };

// ---------------------------------------------------------------- geometry builders
/** Flat-shaded triangle soup builder. Normals are the face normal turned to point up, then 45 % pulled toward +y
 *  (soft light on small leaves); the material is two-sided and does not flip them. */
class Soup {
  constructor() { this.p = []; this.n = []; this.t = []; this.l = []; }
  tri(a, b, c, ta, tb, tc, la = 1, lb = 1, lc = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nx += 0.0; ny += Math.hypot(nx, ny, nz) * 0.8;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    for (const [q, tt, ll] of [[a, ta, la], [b, tb, lb], [c, tc, lc]]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.t.push(tt); this.l.push(ll); }
  }
  quad(a, b, c, d, ta, tb, tc, td, la, lb, lc, ld) { this.tri(a, b, c, ta, tb, tc, la, lb, lc); this.tri(a, c, d, ta, tc, td, la, lc, ld); }
  /** scale so the tallest point is y = 1 (object units = plant heights, what builtWind() expects) */
  normalize(by = null) {
    let hy = 0; for (let i = 1; i < this.p.length; i += 3) hy = Math.max(hy, this.p[i]);
    const k = 1 / (by || hy || 1);
    for (let i = 0; i < this.p.length; i++) this.p[i] *= k;
    return k;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(this.t, 1));
    g.setAttribute("aLeaf", new THREE.Float32BufferAttribute(this.l, 1));
    g.computeBoundingSphere();
    g.userData = { tris: this.p.length / 9 };
    return g;
  }
}
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm3 = (a) => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

/** Fern: 7 arching fronds round a crown. near = rachis ribbon + 6 leaflet pairs a frond (diamond leaflets);
 *  far = one tapered ribbon a frond. Height normalised to 1. */
export function fernGeometry(near) {
  const so = new Soup(), r = rng(near ? 11 : 12), NF = 7, SEG = near ? 8 : 5;
  for (let f = 0; f < NF; f++) {
    const yaw = (f + (r() - 0.5) * 0.5) / NF * Math.PI * 2, len = 0.85 + 0.3 * r();
    const phi0 = 0.30 + 0.45 * r(), bend = 1.5 + 0.9 * r();
    const cy = Math.cos(yaw), sy = Math.sin(yaw), B = [-sy, 0, cy];
    const pts = []; let rr = 0.03, yy = 0;
    for (let i = 0; i <= SEG; i++) {
      pts.push([cy * rr, yy, sy * rr]);
      const a = phi0 + bend * Math.pow((i + 0.5) / SEG, 1.25), ds = len / SEG;
      rr += Math.sin(a) * ds; yy += Math.cos(a) * ds;
    }
    for (let i = 0; i < SEG; i++) {
      const P = pts[i], Q = pts[i + 1], s0 = i / SEG, s1 = (i + 1) / SEG;
      const w0 = near ? 0.012 : 0.14 * (1 - s0 * 0.92), w1 = near ? 0.012 : 0.14 * (1 - s1 * 0.92);
      so.quad(add3(P, B, -w0), add3(P, B, w0), add3(Q, B, w1), add3(Q, B, -w1), s0, s0, s1, s1, 0.3, 0.3, 0.6, 0.6);
    }
    if (near) for (let i = 2; i < SEG; i++) {
      const P = pts[i], Q = pts[i + 1], T = norm3([Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]]), s = i / SEG;
      const L = 0.30 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * s)), 0.8) * (1 - 0.45 * s) + 0.03, w = L * 0.32;
      for (const side of [-1, 1]) {
        const dir = norm3(add3(add3([B[0] * side * 0.9, 0, B[2] * side * 0.9], T, 0.35), [0, -0.22, 0]));
        const tip = add3(P, dir, L), mid = add3(P, dir, L * 0.5);
        so.tri(P, add3(mid, T, w), tip, s, s, Math.min(1, s + 0.12), 0.0, 1, 1);
        so.tri(P, tip, add3(mid, T, -w), s, Math.min(1, s + 0.12), s, 0.0, 1, 1);
      }
    }
  }
  so.normalize();
  return so.geometry();
}

/** Clover / weed tuft: 4 stems, each a ribbon ending in a three-lobed leaf (three 5-sided fans). Height 1. */
export function cloverGeometry() {
  const so = new Soup(), r = rng(21);
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + r(), off = 0.10 + 0.22 * r(), h = 0.60 + 0.40 * r();
    const base = [Math.cos(a) * off * 0.4, 0, Math.sin(a) * off * 0.4], top = [Math.cos(a) * off, h, Math.sin(a) * off];
    const side = [-Math.sin(a), 0, Math.cos(a)];
    so.quad(add3(base, side, -0.012), add3(base, side, 0.012), add3(top, side, 0.008), add3(top, side, -0.008), 0, 0, 0.5, 0.5, 0, 0, 0.2, 0.2);
    for (let l = 0; l < 3; l++) {
      const th = l / 3 * Math.PI * 2 + a, c = [top[0] + Math.cos(th) * 0.17, top[1] + 0.03, top[2] + Math.sin(th) * 0.17];
      const rad = 0.19; let prev = null;
      for (let q = 0; q <= 5; q++) {
        const ph = q / 5 * Math.PI * 2, v = [c[0] + Math.cos(ph) * rad, c[1] + Math.sin(ph * 2) * 0.02, c[2] + Math.sin(ph) * rad];
        if (prev) so.tri(top, prev, v, 0.6, 1, 1, 0.1, 1, 1);
        prev = v;
      }
    }
  }
  so.normalize();
  return so.geometry();
}

/** Grass tuft: 8 bent ribbon blades. Height 1. */
export function tuftGeometry() {
  const so = new Soup(), r = rng(31);
  for (let b = 0; b < 8; b++) {
    const a = r() * Math.PI * 2, off = 0.08 * r(), h = 0.55 + 0.45 * r(), lean = 0.25 + 0.5 * r(), w = 0.035 + 0.02 * r();
    const dir = [Math.cos(a), 0, Math.sin(a)], side = [-Math.sin(a), 0, Math.cos(a)];
    let prev = null;
    for (let i = 0; i <= 3; i++) {
      const s = i / 3, c = [dir[0] * (off + lean * s * s * h), h * s, dir[2] * (off + lean * s * s * h)];
      const ww = w * (1 - s * 0.95);
      const L = add3(c, side, -ww), R = add3(c, side, ww);
      if (prev) so.quad(prev[0], prev[1], R, L, prev[2], prev[2], s, s, prev[2] * 0, prev[2] * 0, 1, 1);
      prev = [L, R, s];
    }
  }
  so.normalize();
  return so.geometry();
}

/** A fallen leaf: pointed ellipse, length 1 along x, width 0.55, a raised midrib (V) and a cupped edge. */
export function leafGeometry() {
  const so = new Soup();
  const base = [-0.5, 0, 0], tip = [0.5, 0.03, 0], rl = [-0.12, 0.05, 0.27], rr = [-0.12, 0.05, -0.27], ml = [0.18, 0.05, 0.2], mr = [0.18, 0.05, -0.2];
  const mid = [0.0, 0.07, 0.0];
  so.tri(base, rl, mid, 0, 0.3, 0.5, 1, 1, 1); so.tri(base, mid, rr, 0, 0.5, 0.3, 1, 1, 1);
  so.tri(rl, ml, mid, 0.3, 0.7, 0.5, 1, 1, 1); so.tri(rr, mid, mr, 0.3, 0.5, 0.7, 1, 1, 1);
  so.tri(ml, tip, mid, 0.7, 1, 0.5, 1, 1, 1); so.tri(mr, mid, tip, 0.7, 0.5, 1, 1, 1, 1);
  return so.geometry();   // not normalised: length 1
}

/** A twig: two bent segments of a tapering three-sided stick, length 1 along x, base thickness 0.05. */
export function twigGeometry() {
  const so = new Soup();
  const pts = [[-0.5, 0.02, 0, 0.026], [-0.05, 0.03, 0.05, 0.020], [0.5, 0.02, -0.03, 0.006]];
  const ring = (p) => [0, 1, 2].map((k) => { const a = k / 3 * Math.PI * 2 + 0.5; return [p[0], p[1] + Math.sin(a) * p[3], p[2] + Math.cos(a) * p[3]]; });
  for (let i = 0; i < 2; i++) {
    const A = ring(pts[i]), B = ring(pts[i + 1]);
    for (let k = 0; k < 3; k++) { const k2 = (k + 1) % 3; so.quad(A[k], A[k2], B[k2], B[k], i / 2, i / 2, (i + 1) / 2, (i + 1) / 2, 0, 0, 0, 0); }
  }
  return so.geometry();
}

/** A pebble: an icosahedron (20 triangles) squashed to 1 x 0.5 x 0.8, bottom at y 0. */
export function pebbleGeometry() {
  const ico = new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed(), P = ico.attributes.position.array, so = new Soup();
  const r = rng(41), v = [];
  for (let i = 0; i < P.length; i += 3) { const j = 1 + (r() - 0.5) * 0.28; v.push([P[i] * j, P[i + 1] * 0.5 * j + 0.2, P[i + 2] * 0.8 * j]); }
  for (let i = 0; i < v.length; i += 3) so.tri(v[i], v[i + 1], v[i + 2], 0.5, 0.5, 0.5, 0, 0, 0);
  return so.geometry();
}

// ---------------------------------------------------------------- material
const FC_VS = (dn) => /* glsl */`
  attribute float aT; attribute float aLeaf;
  uniform float uFcWind, uFcFar0, uFcFar1, ${dn};
  varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vT;
  ${S.NOISE_GLSL}
  ${S.WIND_GLSL}
  void main() {
    mat4 im = instanceMatrix;
    vec3 anchorW = (modelMatrix * vec4(im[3].xyz, 1.0)).xyz;
    float sc = max(length(modelMatrix[0].xyz), 1e-4);
    float dM = distance(anchorW, cameraPosition) / (sc * ${M.toFixed(1)});
    float keep = 1.0 - smoothstep(uFcFar0, uFcFar1, dM);
    float h = fract(sin(dot(im[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    keep *= step(h, ${dn});
    vec3 p = position * keep;
    vec3 pw = builtWind(p, vec2(0.0, aT), aLeaf, im);
    pw = p + (pw - p) * uFcWind;
    vec4 w = modelMatrix * im * vec4(pw, 1.0);
    vW = w.xyz;
    vec3 s2 = vec3(dot(im[0].xyz, im[0].xyz), dot(im[1].xyz, im[1].xyz), dot(im[2].xyz, im[2].xyz));
    vN = normalize(mat3(modelMatrix) * (mat3(im) * (normal / max(s2, vec3(1e-6)))));
    vT = aT;
    vTint = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const FC_FS = /* glsl */`
  uniform float uFcGain, uFcRootK, uFcTipK, uFcDim;
  varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vT;
  ${S.NOISE_GLSL}
  ${S.LIGHT_GLSL}
  void main() {
    vec3 N = normalize(vN);
    // a soft sun term and the measured colour (as fringe.js: a toon band step would paint the small leaves darker
    // than the original's colours)
    float sun = 0.88 + 0.24 * clamp(dot(N, normalize(uLightDir + vec3(0.0, 0.6, 0.0))) * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = vTint * mix(uFcRootK, uFcTipK, vT) * sun * uFcGain * uFcDim;
    gl_FragColor = vec4(col, 1.0);   // no aerial lift: the measured colours are the target
    #include <colorspace_fragment>
  }`;

export function coverMaterial(shared, densName, name) {
  const m = new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ ...shared, [densName]: { value: 1.0 } }),
    vertexShader: FC_VS(densName), fragmentShader: FC_FS, side: THREE.DoubleSide,
  });
  m.name = name;
  return m;
}

// ---------------------------------------------------------------- the assets (WHERE they lie: web/built/place/floorcover.js)
const GEO = { fern: () => fernGeometry(true), clover: cloverGeometry, tuft: tuftGeometry, litter: leafGeometry, twig: twigGeometry, pebble: pebbleGeometry };
const DENS = { fern: "uFcDensFern", clover: "uFcDensClover", tuft: "uFcDensTuft", litter: "uFcDensLitter", twig: "uFcDensTwig", pebble: "uFcDensPebble" };
/** the uniforms every cover material of one arena shares (wind, fade, gain, night dim) */
export function coverUniforms() {
  return { uFcWind: { value: COVER.WIND_K }, uFcFar0: { value: COVER.FAR0_M }, uFcFar1: { value: COVER.FAR1_M },
           uFcGain: { value: 1.0 }, uFcRootK: { value: 0.72 }, uFcTipK: { value: 1.18 }, uFcDim: { value: 1.0 } };
}
/** one cover type as an asset: { parts, lod? (ferns: near / far geometry), update (night dim) } */
export function coverAsset(kind, shared) {
  const mat = coverMaterial(shared, DENS[kind], `builtFloorcover_${kind}`);
  const update = () => { const night = S.light.mode === "night" ? 0.45 : 1.0; if (shared.uFcDim.value !== night) shared.uFcDim.value = night; };
  if (kind === "fern") {
    const near = [{ geo: fernGeometry(true), mat }], far = [{ geo: fernGeometry(false), mat }];
    return { parts: near, lod: { near, far, names: ["near", "far"] }, update, mat };
  }
  return { parts: [{ geo: GEO[kind](), mat }], update, mat };
}
