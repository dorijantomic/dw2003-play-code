// MOUNTAIN procedural assets (no download, our own code, no licence needed): terrain ground shader (slope / altitude splat: meadow, rock with strata, lichen,
// scree, snow, glacier ice, wet banks), alpine water (tarn + stream, same depth-band / foam / caustic law as the lake water), waterfall, distant mountain ranges,
// cloud decks / cloud sea, blowing snow + spindrift, crags, cliff faces, scree chips, glacier + seracs, snow drift, gentian, edelweiss-like, saxifrage, heather,
// lichen, moss cushions, dwarf shrubs, juniper, krummholz (wind-bent dwarf pine), silver snag, weather shader hook (snow dust / lichen on any material).
// Terrain law (JS + GLSL) is in mtlaw.js. 1 unit = 1 metre. Parts are [{geo, mat}] with the toon material of toolkit.js.
import * as THREE from "three";
import { toonify, rng, U, noiseTexture, light } from "./toolkit.js";
import { GB, tube, ribbon, canvasTex, mixc, V } from "./beachproc.js";
import * as M from "./mtlaw.js";

const { sstep, vnoise } = M;
const fr = (x) => x - Math.floor(x);
const hash1 = (n) => fr(Math.sin(n * 127.1 + 4.1) * 43758.5453);
const lerpP = (P, t) => { const k = Math.min(P.length - 2, Math.floor(t * (P.length - 1))), f = t * (P.length - 1) - k; return P[k].clone().lerp(P[k + 1], f); };
const vcMat = (tag, t, o = {}) => { const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...o }); m.userData.tag = tag; return toonify(m, t); };
const vcSolid = (tag, t, o = {}) => vcMat(tag, t, { side: THREE.FrontSide, ...o });
const done = (gb, mat) => [{ geo: gb.geo(true), mat }];

// ------------------------------------------------------------------ indexed icosphere (shared vertices -> smooth normals), cached per detail
const _ico = {};
function icoBase(detail) {
  if (_ico[detail]) return _ico[detail];
  const t = (1 + Math.sqrt(5)) / 2, P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = new Map(), mid = (a, b) => { const k = a < b ? a + "_" + b : b + "_" + a; let i = cache.get(k); if (i === undefined) { const m = [0, 1, 2].map((c) => (P[a][c] + P[b][c]) / 2), l = Math.hypot(...m); P.push(m.map((c) => c / l)); i = P.length - 1; cache.set(k, i); } return i; };
    const G = []; for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); G.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); } F = G;
  }
  return (_ico[detail] = { P, F });
}
/** append a displaced ico blob to gb. fn(x,y,z unit) -> {r:[sx,sy,sz] multiplier, c:[r,g,b]} ; centre c0, base radii rad */
function addBlob(gb, detail, c0, rad, fn, rotY = 0, tiltX = 0) {
  const { P, F } = icoBase(detail), base = gb.p.length / 3, e = new THREE.Euler(tiltX, rotY, 0), q = new THREE.Quaternion().setFromEuler(e), v = new THREE.Vector3();
  for (const p of P) {
    const o = fn(p[0], p[1], p[2]), k = o.k ?? 1; v.set(p[0] * rad[0] * k, p[1] * rad[1] * k, p[2] * rad[2] * k).applyQuaternion(q);
    gb.v(c0.x + v.x, c0.y + v.y, c0.z + v.z, o.c[0], o.c[1], o.c[2], 0.5 + p[0] * 0.5, 0.5 + p[2] * 0.5);
  }
  for (const f of F) gb.tri(base + f[0], base + f[1], base + f[2]);
}
function leaf(gb, p0, yaw, len, hw, lift, droop, c0, c1, segs = 3) {
  const P = [], S = [], dx = Math.cos(yaw), dz = Math.sin(yaw);
  for (let i = 0; i <= segs; i++) { const u = i / segs; P.push(V(p0.x + dx * len * u * 0.9, p0.y + len * (lift * u - droop * u * u), p0.z + dz * len * u * 0.9)); S.push(V(-dz, 0, dx)); }
  ribbon(gb, P, S, (t) => hw * (1 - 0.85 * Math.pow(t, 1.4)) + 0.0006, (t) => mixc(c0, c1, t));
}
const arc = (ox, oz, a, H, lean, n = 5) => { const P = []; for (let i = 0; i < n; i++) { const t = i / (n - 1); P.push(V(ox + Math.cos(a) * lean * H * t * t, H * t, oz + Math.sin(a) * lean * H * t * t)); } return P; };

// ------------------------------------------------------------------ WEATHER hook: snow dust on up-facing surfaces + lichen patches on any toon material
/** o: { snow 0..1 coverage, snowAlt world y where snow starts (default everywhere), lichen 0..1 } */
export function weather(parts, o = {}) {
  const wx = [o.snow ?? 0, o.snowAlt ?? -1e4, o.lichen ?? 0];
  for (const p of parts) {
    const prev = p.mat.onBeforeCompile, tag = (p.mat.userData.tag || "") + "wx" + (wx[0] > 0 ? "s" : "") + (wx[2] > 0 ? "l" : ""); p.mat.userData.tag = tag;
    p.mat.onBeforeCompile = (sh) => {
      prev(sh); sh.uniforms.uWx = { value: new THREE.Vector3(...wx) };
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uWx;")
        .replace("vec3 alb = diffuseColor.rgb;", `{ float nn = texture2D(uNoise, vWP.xz * 0.45 + vWP.y * 0.3).r, nm = texture2D(uNoise, vWP.zy * 1.7 + 2.0).g;
    float up = vWN.y * 0.75 + (nn - 0.5) * 0.7 + (nm - 0.5) * 0.2;
    float lw = uWx.z * smoothstep(0.55, 0.66, nn * 0.6 + nm * 0.5) * (1.0 - smoothstep(0.5, 0.9, vWN.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.86, 0.56, 0.12), vec3(0.58, 0.66, 0.28), nm), lw * 0.8);
    float ga = smoothstep(uWx.y - 6.0, uWx.y + 6.0, vWP.y), th = mix(0.95, 0.12, uWx.x);
    float sn = uWx.x > 0.0 ? smoothstep(th, th + 0.12, up) * ga : 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), sn); }
  vec3 alb = diffuseColor.rgb;`);
    };
    p.mat.needsUpdate = true;
  }
  return parts;
}

// ------------------------------------------------------------------ TERRAIN GROUND: altitude / slope splat with toon bands
/** T = { grass, rock, scree, snow, lichen } textures. o: { tile m, snowline m } */
export function mountainGround(T, o = {}) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.userData.tag = "mtground";
  toonify(m, { grade: o.grade || { sat: 1.12, post: 0.5 }, shadeK: 0.78, rim: 0 });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    prev(sh);
    sh.uniforms.uTG = { value: T.grass }; sh.uniforms.uTR = { value: T.rock }; sh.uniforms.uTS = { value: T.scree }; sh.uniforms.uTN = { value: T.snow }; sh.uniforms.uTL = { value: T.lichen };
    sh.uniforms.uMt = { value: new THREE.Vector4(o.snowline ?? M.SNOWLINE, o.tile ?? 3.2, o.treeline ?? M.TREELINE, 0) };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLoc;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  vLoc = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("vec3 bGrade(vec3 c, float sat, float post){", `uniform sampler2D uTG, uTR, uTS, uTN, uTL; uniform vec4 uMt; varying vec3 vLoc;
${M.streamGlsl()}
vec3 mTap(sampler2D t, vec2 p){ vec3 a = texture2D(t, p).rgb; vec3 b = texture2D(t, mat2(0.8, 0.6, -0.6, 0.8) * p * 0.37 + 0.31).rgb; float n = texture2D(uNoise, p * 0.043).b; return mix(a, b, smoothstep(0.3, 0.7, n) * 0.6); }
vec3 mTri(sampler2D t, vec3 P, vec3 N, float s){ vec3 w = pow(abs(N), vec3(5.0)); w /= (w.x + w.y + w.z); return mTap(t, P.zy * s) * w.x + mTap(t, P.xz * s) * w.y + mTap(t, P.xy * s) * w.z; }
vec3 bGrade(vec3 c, float sat, float post){`)
      .replace("#include <map_fragment>", `
  { vec3 P = vLoc; float alt = P.y; vec2 q = P.xz / uMt.y;
    vec4 nz = texture2D(uNoise, P.xz * 0.011), nz2 = texture2D(uNoise, P.xz * 0.043 + 3.0), nz3 = texture2D(uNoise, P.xz * 0.17 + 7.0);
    float ny = clamp(vWN.y, 0.0, 1.0);
    vec3 grass = mTap(uTG, q) * mix(vec3(0.84, 1.22, 1.70), vec3(0.62, 1.28, 1.90), smoothstep(0.35, 0.65, nz.g));
    vec3 rock = mTri(uTR, P, vWN, 1.0 / (uMt.y * 1.6)); rock = mix(vec3(dot(rock, vec3(0.333))), rock, 0.38) * 1.18;
    float band = sin(P.y * 1.55 + nz.r * 6.0 + nz2.g * 3.0) * 0.5 + 0.5; band = floor(band * 3.0 + 0.5) / 3.0;                   // rock strata
    rock *= (0.78 + 0.36 * band) * mix(vec3(1.0), vec3(1.10, 0.97, 0.84), smoothstep(0.45, 0.65, nz2.r + 0.3 * band));
    vec3 lic = mTap(uTL, q * 1.3); lic = mix(lic * vec3(1.2, 1.1, 0.6), vec3(0.8, 0.62, 0.16), 0.4);
    float lw = smoothstep(0.58, 0.66, nz3.r * 0.55 + nz2.b * 0.55) * smoothstep(8.0, 26.0, alt) * (1.0 - smoothstep(uMt.x * 0.7, uMt.x, alt));
    rock = mix(rock, lic, lw * 0.75);
    vec3 scree = mTap(uTS, q * 1.8); scree = mix(vec3(dot(scree, vec3(0.333))), scree, 0.4) * 1.3;
    float sc = smoothstep(0.54, 0.62, ny) * (1.0 - smoothstep(0.80, 0.88, ny)) * smoothstep(0.28, 0.5, nz2.g + 0.25);
    float gw = smoothstep(0.80, 0.86, ny + (nz.g - 0.5) * 0.06) * (1.0 - smoothstep(55.0, 84.0, alt + (nz.r - 0.5) * 30.0));
    vec3 c = rock; c = mix(c, scree, sc * (1.0 - gw)); c = mix(c, grass, gw);
    float sl = uMt.x + (nz.r - 0.5) * 28.0 + (nz2.b - 0.5) * 10.0;                                                                // snowline wanders with noise
    float snowF = smoothstep(sl - 5.0, sl + 5.0, alt) * smoothstep(0.30, 0.52, ny + 0.3 * smoothstep(sl, sl + 70.0, alt) + (nz3.g - 0.5) * 0.18);
    vec3 snowC = mix(vec3(0.90, 0.95, 1.0), mTap(uTN, q * 0.8), 0.3);
    float iw = smoothstep(0.58, 0.64, nz.b * 0.6 + nz3.b * 0.4) * smoothstep(0.86, 0.94, ny) * smoothstep(sl - 5.0, sl + 30.0, alt) * (1.0 - smoothstep(sl + 60.0, sl + 90.0, alt));
    vec3 ice = mix(vec3(0.46, 0.74, 0.90), vec3(0.80, 0.93, 0.98), nz3.a); ice = mix(ice, vec3(0.18, 0.42, 0.66), (1.0 - smoothstep(0.0, 0.03, abs(nz3.r - 0.5))) * 0.7);
    c = mix(c, snowC, snowF); c = mix(c, ice, iw * snowF);
    // wet bank + pebble apron + bed colour around the stream and the tarn
    float inS = step(-52.0, P.z) * step(P.z, 66.0), wd = max(inS > 0.5 ? sD(P.xz) : -99.0, tD(P.xz));
    float apron = (1.0 - smoothstep(0.2, 1.8, -wd + (nz3.r - 0.5) * 1.2)) * step(-4.0, wd);
    c = mix(c, mTap(uTS, q * 2.6) * vec3(0.92, 0.96, 1.0), apron * 0.85);
    c *= mix(1.0, 0.62, 1.0 - smoothstep(0.0, 0.7 + 0.5 * nz2.g, -wd));
    c *= mix(vec3(1.0), vec3(0.55, 0.78, 0.82), smoothstep(0.0, 1.2, wd));
    c *= 0.9 + 0.2 * nz2.a;
    diffuseColor.rgb *= c; }
`);
  };
  return m;
}

// ------------------------------------------------------------------ ALPINE WATER (tarn + stream): same law as the lake water: depth bands, caustics, foam line, ripples, sparkle
const FOGV = THREE.UniformsLib.fog;
/** kind 0 = stream (shore law sD, flowing +z with white water), kind 1 = tarn (tD). Geometry in world coordinates (vLoc = position). */
export function alpineWater(kind = 0) {
  const C = (h) => new THREE.Color(h);
  const uni = THREE.UniformsUtils.merge([FOGV, { uC0: { value: C(0xbfe8d8) }, uC1: { value: C(0x62c4c4) }, uC2: { value: C(0x2a8fb0) }, uC3: { value: C(0x1b5f8c) }, uC4: { value: C(0x123f70) } }]);
  Object.assign(uni, { uTime: U.uTime, uNoise: { value: noiseTexture() }, uSunV: U.uSunV, uUpV: U.uUpV, uSkyCol: U.uSkyCol, uKind: { value: kind } });
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, uniforms: uni,
    vertexShader: `varying vec3 vLoc; varying vec3 vBV;
#include <fog_pars_vertex>
void main(){ vLoc = position; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vBV = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `precision highp float; varying vec3 vLoc; varying vec3 vBV;
uniform float uTime, uKind; uniform sampler2D uNoise; uniform vec3 uSunV, uUpV, uSkyCol, uC0, uC1, uC2, uC3, uC4;
${M.streamGlsl()}
#include <fog_pars_fragment>
void main(){
  vec2 P = vLoc.xz; float st = step(uKind, 0.5);
  float d = st > 0.5 ? sD(P) : tD(P); if (d <= 0.0) discard;
  float dep = st > 0.5 ? min(0.9 * d * 0.55 + 0.1, 0.8) : tDepth(d);
  float fadeEnd = st > 0.5 ? (1.0 - smoothstep(50.0, 62.0, P.y)) * smoothstep(-52.0, -48.0, P.y) : 1.0;
  vec2 fl = st > 0.5 ? vec2(0.0, uTime * 1.25) : vec2(0.0);                                      // the stream flows towards +z
  vec2 w1 = texture2D(uNoise, P * vec2(0.9, 0.22) - fl * vec2(0.0, 0.12) * 1.0).rg - 0.5, w2 = texture2D(uNoise, P * vec2(1.7, 0.55) - fl * vec2(0.0, 0.3)).ba - 0.5;
  if (st < 0.5) { w1 = texture2D(uNoise, P * 0.19 + vec2(uTime * 0.011, uTime * 0.006)).rg - 0.5; w2 = texture2D(uNoise, P * 0.57 - vec2(uTime * 0.019, uTime * 0.014)).ba - 0.5; }
  vec2 off = w1 * 0.7 + w2 * 0.45;
  float nA = texture2D(uNoise, P * 0.08 + vec2(uTime * 0.01, 0.0)).r, nB = texture2D(uNoise, P * 0.4 - vec2(0.0, uTime * 0.02)).g;
  float dj = dep + (nA - 0.5) * 0.4;
  vec3 col = mix(uC0, uC1, smoothstep(0.22, 0.28, dj)); col = mix(col, uC2, smoothstep(0.85, 0.91, dj)); col = mix(col, uC3, smoothstep(1.7, 1.78, dj)); col = mix(col, uC4, smoothstep(2.6, 2.7, dj));
  float a = mix(0.46, 0.62, smoothstep(0.22, 0.28, dj)); a = mix(a, 0.78, smoothstep(0.85, 0.91, dj)); a = mix(a, 0.9, smoothstep(1.7, 1.78, dj)); a = mix(a, 0.95, smoothstep(2.6, 2.7, dj));
  float el = step(abs(dj - 0.25), 0.02) + step(abs(dj - 0.88), 0.025) + step(abs(dj - 1.74), 0.03);
  col = mix(col, vec3(1.0), clamp(el, 0.0, 1.0) * 0.1);
  float c1 = texture2D(uNoise, P * 0.42 + off * 0.12 + vec2(uTime * 0.05, uTime * 0.03)).r, c2 = texture2D(uNoise, P * 0.55 + off * 0.1 - vec2(uTime * 0.04, -uTime * 0.035) + 7.0).g;
  float cau = smoothstep(0.93, 1.0, 1.0 - abs(c1 - c2) * 5.0) * (1.0 - smoothstep(0.5, 1.9, dep));
  col += vec3(0.95, 1.0, 0.85) * cau * 0.5; a = max(a, cau * 0.7);
  vec3 Vv = normalize(vBV); float frn = pow(1.0 - clamp(dot(uUpV, Vv), 0.0, 1.0), 2.4);
  vec3 rc = mix(uSkyCol, vec3(1.0), 0.25); rc = mix(rc, floor(rc * 9.0 + 0.5) / 9.0, 0.45);
  float rs = (0.2 + 0.6 * frn) * (0.5 + 0.5 * smoothstep(0.15, 1.2, dep)); col = mix(col, rc, rs); a = max(a, rs * 0.9);
  float foam = smoothstep(0.26 + 0.1 * nB, 0.02, d) * (0.55 + 0.45 * nB);
  foam = max(foam, smoothstep(0.045, 0.0, abs(d - 0.6 - 0.12 * sin(P.x * 2.3 + uTime * 0.7 + nA * 4.0))) * step(0.5, nB) * 0.5);
  if (st > 0.5) {                                                                                   // white water: elongated streaks along the flow
    float rap = texture2D(uNoise, vec2(P.x * 1.4, P.y * 0.35 - uTime * 1.5)).r * texture2D(uNoise, vec2(P.x * 3.1 + 2.0, P.y * 0.8 - uTime * 2.1)).g;
    foam = max(foam, smoothstep(0.30, 0.42, rap) * (0.35 + 0.65 * (1.0 - smoothstep(0.1, 0.9, d))));
  }
  col = mix(col, vec3(0.96, 0.99, 0.98), foam * 0.85); a = max(a, foam * 0.92);
  vec3 Rr = reflect(-Vv, uUpV); float g = 0.3 + 0.7 * pow(max(dot(Rr, uSunV), 0.0), 4.0);
  float s = texture2D(uNoise, P * 1.3 + vec2(uTime * 0.05, uTime * 0.03)).b * texture2D(uNoise, P * 0.83 - vec2(uTime * 0.04, 0.0)).a;
  col += vec3(1.0, 0.97, 0.88) * step(0.52, s) * g * (1.0 - foam);
  gl_FragColor = vec4(col, a * fadeEnd);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  return m;
}
/** stream ribbon from z0 to z1 in world coordinates; cell metres along the flow */
export function streamMesh(z0 = M.STREAM.z0, z1 = 62, cell = 0.7) {
  const n = Math.max(2, Math.round((z1 - z0) / cell)), pos = [], idx = [];
  for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n, x = M.streamX(z), W = M.streamW(z) + 0.5, y = M.streamY(z) + 0.03; for (const k of [-1, -0.5, 0, 0.5, 1]) pos.push(x + k * W, y, z); }
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const a = i * 5 + k, b = a + 1, c = a + 5, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, alpineWater(0)); m.renderOrder = 5; m.frustumCulled = false; m.name = "stream"; return m;
}
export function tarnMesh() {
  const R = M.TARN.R * 1.4, g = new THREE.CircleGeometry(R, 72); g.rotateX(-Math.PI / 2); g.translate(M.TARN.x, M.TARN.y, M.TARN.z);
  const m = new THREE.Mesh(g, alpineWater(1)); m.renderOrder = 5; m.frustumCulled = false; m.name = "tarn"; return m;
}

// ------------------------------------------------------------------ WATERFALL: a sheet of falling water (scrolling streaks), foam pool ring, spray points
export function waterfallParts(w = M.FALL.w, h = M.FALL.h) {
  const g = new THREE.Group(), geo = new THREE.PlaneGeometry(w, h + 0.5, 8, 28), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = p.getY(i) / (h + 0.5) + 0.5, z = 0.8 * Math.pow(1 - v, 3.0) * 0.0 + 0.45 * Math.pow(Math.max(0, v - 0.82) / 0.18, 2) * -0.0; p.setZ(i, z + (1 - v) * 0.12); }
  geo.translate(0, (h + 0.5) / 2 - 0.1, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([FOGV, { uTime: U.uTime, uNoise: { value: noiseTexture() }, uH: { value: h } }]),
    vertexShader: `varying vec2 vUv; varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `precision highp float; varying vec2 vUv; varying vec3 vW; uniform float uTime, uH; uniform sampler2D uNoise;
#include <fog_pars_fragment>
void main(){
  float y = (1.0 - vUv.y) * uH;                                                                  // metres below the lip
  float s1 = texture2D(uNoise, vec2(vUv.x * 5.0, y * 0.11 - uTime * 0.9)).r, s2 = texture2D(uNoise, vec2(vUv.x * 11.0 + 3.0, y * 0.23 - uTime * 1.6)).g;
  float streak = smoothstep(0.35, 0.75, s1 * 0.6 + s2 * 0.5);
  float across = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
  float lip = smoothstep(0.0, 0.5, y), foot = smoothstep(uH, uH - 0.7, y);
  vec3 col = mix(vec3(0.55, 0.82, 0.92), vec3(0.97, 1.0, 1.0), streak * (0.5 + 0.5 * smoothstep(0.0, uH, y)));
  float a = (0.5 + 0.4 * streak) * across * (0.4 + 0.6 * lip);
  col = mix(col, vec3(1.0), (1.0 - foot) * 0.8); a = max(a, (1.0 - foot) * 0.85 * across);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  const sheet = new THREE.Mesh(geo, mat); sheet.renderOrder = 6; sheet.name = "fall sheet"; g.add(sheet);
  // foam ring where it lands + spray
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, w * 0.95, 28, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([FOGV, { uTime: U.uTime, uNoise: { value: noiseTexture() }, uR: { value: w * 0.95 } }]),
    vertexShader: `varying vec2 vP;
#include <fog_pars_vertex>
void main(){ vP = position.xy; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `precision highp float; varying vec2 vP; uniform float uTime, uR; uniform sampler2D uNoise;
#include <fog_pars_fragment>
void main(){ float r = length(vP) / uR, n = texture2D(uNoise, vP * 1.3 + vec2(uTime * 0.2, -uTime * 0.3)).r, n2 = texture2D(uNoise, vP * 3.0 - uTime * 0.4).g;
  float a = (1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.45)) * smoothstep(0.38, 0.62, n * 0.6 + n2 * 0.5) * 0.9;
  gl_FragColor = vec4(vec3(0.97, 1.0, 1.0), a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.07, 0.9); ring.renderOrder = 7; ring.name = "fall foam"; g.add(ring);
  g.add(spray(110, w, 0.9));
  g.name = "waterfall"; return g;
}
function spray(n, w, lift) {
  const r = rng(77), pos = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = (r() - 0.5) * w; pos[i * 3 + 1] = 0.1; pos[i * 3 + 2] = 0.9 + (r() - 0.5) * 1.0; ph[i] = r(); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("aPh", new THREE.BufferAttribute(ph, 1)); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 1), 8);
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms: { uTime: U.uTime, uScale: { value: 420 }, uLift: { value: lift } },
    vertexShader: `attribute float aPh; uniform float uTime, uScale, uLift; varying float vA;
void main(){ float t = fract(uTime * 0.45 + aPh), a = aPh * 6.283; vec3 p = position + vec3(cos(a) * t * 0.9, sin(t * 3.14159) * uLift * 1.8, sin(a * 1.7) * t * 0.7);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vA = sin(t * 3.14159) * 0.8; gl_PointSize = clamp(uScale * 0.05 / -mv.z, 1.5, 12.0); }`,
    fragmentShader: `precision highp float; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, d) * vA; gl_FragColor = vec4(vec3(0.96, 0.99, 1.0), a);
  #include <colorspace_fragment>
}` });
  const pts = new THREE.Points(geo, m); pts.frustumCulled = false; pts.renderOrder = 8; pts.name = "fall spray"; return pts;
}

// ------------------------------------------------------------------ DISTANT RANGES: layered silhouette bands with aerial haze (cheap: 3 layers x ~2k tris, follow the camera)
export function rangeLayer(i, n = 3, fogCol = new THREE.Color(0xc9dcec)) {
  const R = 318 + i * 22, seg = 240, rows = [-70, 0, 1], pos = [], idx = [], hs = [];
  const prof = (t) => { const a = t * 6.2832; return (1 - i * 0.18) * (46 + 38 * vnoise(Math.cos(a) * 5, Math.sin(a) * 5, 1, 40 + i) + 30 * Math.pow(1 - Math.abs(2 * vnoise(Math.cos(a) * 11, Math.sin(a) * 11, 1, 50 + i) - 1), 2) + 12 * vnoise(Math.cos(a) * 29, Math.sin(a) * 29, 1, 60 + i)); };
  for (let s = 0; s <= seg; s++) { const t = s / seg, a = t * 6.2832, x = Math.cos(a) * R, z = Math.sin(a) * R, H = prof(t % 1); for (let r = 0; r < 3; r++) { const y = r === 0 ? -70 : r === 1 ? H * 0.6 : H; pos.push(x, y, z); hs.push(y); } }
  for (let s = 0; s < seg; s++) for (let r = 0; r < 2; r++) { const a = s * 3 + r, b = a + 3; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const haze = 0.40 + 0.2 * i, base = new THREE.Color(0x5f7894).lerp(fogCol, haze);
  const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, fog: false, uniforms: { uBase: { value: base }, uFog: { value: fogCol.clone() }, uSunDir: { value: light.dir }, uH: { value: 40 + (1 - i * 0.18) * 60 }, uNoise: { value: noiseTexture() }, uHaze: { value: haze } },
    vertexShader: `varying vec3 vL; varying vec3 vW; void main(){ vL = position; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: `precision highp float; varying vec3 vL; varying vec3 vW; uniform vec3 uBase, uFog, uSunDir; uniform float uH, uHaze; uniform sampler2D uNoise;
void main(){ vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.0) n = -n;
  float l = dot(n, normalize(uSunDir)) * 0.5 + 0.5; float b = l < 0.42 ? 0.78 : (l < 0.62 ? 0.95 : 1.1);                   // 3 toon bands
  float nz = texture2D(uNoise, vL.xz * 0.02 + vL.y * 0.01).r;
  float snow = smoothstep(uH * 0.72 + nz * 8.0, uH * 0.8 + nz * 8.0, vL.y) * smoothstep(0.2, 0.55, n.y + 0.2);
  vec3 c = uBase * b; c = mix(c, vec3(0.93, 0.96, 1.0) * mix(1.0, 0.82, uHaze), snow);
  c = mix(c, uFog, uHaze * 0.5 + (1.0 - smoothstep(-10.0, uH * 0.55, vL.y)) * 0.45);                                           // aerial haze thicker low down
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}` });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = -900 + i; mesh.name = "range " + i;
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.set(cam.position.x, 0, cam.position.z); mesh.updateMatrixWorld(); };
  return mesh;
}

// ------------------------------------------------------------------ CLOUD DECKS / CLOUD SEA: toon layers (3 steps), invisible near the camera, anchored in world space
export function cloudDeck(o = {}) {
  const ys = o.y || [14], size = o.size || 900, col = o.col || [0.97, 0.98, 1.0], sh = o.shade || [0.66, 0.74, 0.9];
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: U.uTime, uNoise: { value: noiseTexture() }, uCam: U.uCam, uCol: { value: new THREE.Vector3(...col) }, uSh: { value: new THREE.Vector3(...sh) }, uNear: { value: o.near ?? 140 }, uFar: { value: o.far ?? 300 }, uCov: { value: o.cover ?? 0.5 }, uSize: { value: size }, uSun: { value: light.dir }, uScale: { value: o.scale ?? 0.0045 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `precision highp float; varying vec3 vW; uniform sampler2D uNoise; uniform vec3 uCol, uSh, uCam, uSun; uniform float uTime, uNear, uFar, uCov, uSize, uScale;
void main(){ vec2 p = vW.xz * uScale + vec2(uTime * 0.004, uTime * 0.0022) + vW.y * 0.05;
  float n = texture2D(uNoise, p).r * 0.55 + texture2D(uNoise, p * 2.3 + 4.0).g * 0.3 + texture2D(uNoise, p * 5.1 + 9.0).b * 0.15;
  vec2 q = p + normalize(uSun.xz + 1e-4) * 0.012; float n2 = texture2D(uNoise, q).r * 0.55 + texture2D(uNoise, q * 2.3 + 4.0).g * 0.3 + texture2D(uNoise, q * 5.1 + 9.0).b * 0.15;
  float thr = 1.0 - uCov * 0.62, dens = smoothstep(thr, thr + 0.2, n);
  float dc = distance(vW.xz, uCam.xz), fade = smoothstep(uNear, uFar, dc) * (1.0 - smoothstep(uSize * 0.42, uSize * 0.5, dc));
  float a = floor(dens * 3.0 + 0.5) / 3.0 * fade * 0.96;
  float lit = smoothstep(-0.02, 0.05, n - n2 + 0.06);
  gl_FragColor = vec4(mix(uSh, uCol, lit), a);
  #include <colorspace_fragment>
}` });
  const g = new THREE.Group();
  ys.forEach((y, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 30 + i; m.frustumCulled = false; g.add(m);
    if (!o.fixed) m.onBeforeRender = (r, s, cam) => { m.position.x = cam.position.x; m.position.z = cam.position.z; m.updateMatrixWorld(); }; else m.position.set(o.fixed[0], y, o.fixed[1]); });
  g.name = o.name || "cloud deck"; return g;
}

// ------------------------------------------------------------------ BLOWING SNOW + SPINDRIFT (GPU points, no CPU work)
/** kind "blow": a wrap-around box (w x h x w) of fine flakes streaming along the wind around the camera. kind "spindrift": plumes streaming off crest points downwind. */
export function snowPoints(kind = "blow", o = {}) {
  const r = rng(o.seed || 9), n = o.n || (kind === "blow" ? 1400 : 1800), pos = new Float32Array(n * 3), ph = new Float32Array(n * 2);
  const crests = o.crests || [[0, 0, 0]];
  for (let i = 0; i < n; i++) {
    if (kind === "blow") { pos[i * 3] = r(); pos[i * 3 + 1] = r(); pos[i * 3 + 2] = r(); }
    else { const c = crests[i % crests.length]; pos[i * 3] = c[0] + (r() - 0.5) * 14; pos[i * 3 + 1] = c[1] + (r() - 0.5) * 3; pos[i * 3 + 2] = c[2] + (r() - 0.5) * 14; }
    ph[i * 2] = r(); ph[i * 2 + 1] = r();
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("aPh", new THREE.BufferAttribute(ph, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(...(o.centre || [0, 0, 0])), o.radius || 1e5);
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms: { uTime: U.uTime, uCam: U.uCam, uWindDir: U.uWindDir, uBox: { value: o.box || 70 }, uScale: { value: o.scale || 520 }, uKind: { value: kind === "blow" ? 0 : 1 }, uLife: { value: o.life || 9 }, uSpeed: { value: o.speed || 9 } },
    vertexShader: `attribute vec2 aPh; uniform float uTime, uBox, uScale, uKind, uLife, uSpeed; uniform vec3 uCam; uniform vec2 uWindDir; varying float vA;
void main(){ vec3 p; float a;
  vec2 w = normalize(uWindDir);
  if (uKind < 0.5) { vec3 q = position * uBox; q.x += uTime * uSpeed * w.x * (0.7 + aPh.x * 0.6); q.z += uTime * uSpeed * w.y * (0.7 + aPh.x * 0.6); q.y = q.y * 0.35 + sin(uTime * 0.8 + aPh.y * 20.0) * 0.4 - uTime * 0.25 * aPh.y;
    vec3 c = uCam; p = vec3(mod(q.x - c.x + uBox * 0.5, uBox) - uBox * 0.5 + c.x, mod(q.y - c.y + 8.0, 16.0) - 8.0 + c.y + 4.0, mod(q.z - c.z + uBox * 0.5, uBox) - uBox * 0.5 + c.z); a = 0.55; }
  else { float t = fract(uTime / uLife + aPh.x); p = position + vec3(w.x, 0.15 - t * 0.35, w.y) * (t * uSpeed * uLife) + vec3(sin(aPh.y * 40.0 + t * 6.0), cos(aPh.y * 30.0 + t * 5.0) * 0.6, cos(aPh.y * 50.0 + t * 7.0)) * (1.0 + t * 7.0); a = sin(t * 3.14159) * 0.8; }
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vA = a;
  gl_PointSize = clamp(uScale * (uKind < 0.5 ? 0.035 : 0.5) / -mv.z, 1.0, uKind < 0.5 ? 5.0 : 26.0); }`,
    fragmentShader: `precision highp float; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.1, d) * vA; gl_FragColor = vec4(vec3(0.97, 0.99, 1.0), a * 0.9);
  #include <colorspace_fragment>
}` });
  const pts = new THREE.Points(geo, m); pts.frustumCulled = false; pts.renderOrder = 55; pts.name = kind === "blow" ? "blowing snow" : "spindrift"; return pts;
}

// ------------------------------------------------------------------ ROCK STRATA texture (canvas, painted)
let _strata = null;
export function strataTexture() {
  return _strata || (_strata = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#8a8782"; g.fillRect(0, 0, w, h);
    const r = rng(31); let y = 0; const cols = ["#8d8a85", "#9a948a", "#777470", "#a39a8b", "#6f6d6c", "#948d83"];
    while (y < h) { const t = 6 + r() * 26; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(0, y, w, t);
      g.strokeStyle = "rgba(35,32,30,0.55)"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + (r() - 0.5) * 2.5); g.stroke(); y += t; }
    for (let i = 0; i < 70; i++) { const x = r() * w, y0 = r() * h, L = 8 + r() * 38; g.strokeStyle = `rgba(30,28,26,${0.15 + r() * 0.3})`; g.lineWidth = 0.8 + r(); g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (r() - 0.5) * 6, y0 + L); g.stroke(); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "20,20,20"},${0.04 + r() * 0.07})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  }));
}
const strataCol = (band, f, y) => { const k = hash1(band * 3.7 + 0.5), b = k < 0.34 ? [0.50, 0.49, 0.47] : k < 0.67 ? [0.56, 0.50, 0.42] : [0.40, 0.40, 0.42]; const s = 0.78 + 0.28 * sstep(0.1, 0.7, f); return [b[0] * s, b[1] * s, b[2] * s]; };

// ------------------------------------------------------------------ CRAGS and SPIRES (strata-banded, ridged, ledges), CLIFF FACES
const ridged = (x, y, z, f, s) => 1 - Math.abs(2 * vnoise(x * f + y * f * 0.7, z * f - y * f * 0.9, 1, s) - 1);
export function cragParts(seed = 1, o = {}) {
  const r = rng(seed * 71 + 5), H = o.h ?? (4.5 + 3 * r()), W = o.w ?? (1.1 + 0.6 * r()), lean = (r() - 0.5) * 0.5, gb = new GB(), sd = seed * 13;
  addBlob(gb, o.detail ?? 4, V(0, H * 0.5, 0), [W, H * 0.5, W * (0.8 + 0.3 * r())], (x, y, z) => {
    const yn = (y + 1) / 2, taper = 1 - 0.55 * Math.pow(yn, 1.25);
    const s = (y * H * 0.5 + H * 0.5) / (0.9 + 0.5 * hash1(sd)), f = fr(s), band = Math.floor(s);
    const ledge = 1 + 0.07 * (1 - sstep(0.05, 0.5, f)), rid = 1 + 0.3 * ridged(x, y, z, 1.7, sd + 1) + 0.12 * ridged(x, y, z, 4.1, sd + 2) - 0.2;
    const k = taper * ledge * rid * (1 + lean * y * 0.4);
    const c = strataCol(band, f, y); const dark = 0.82 + 0.3 * ridged(x, y, z, 1.7, sd + 1);
    return { k, c: [c[0] * dark, c[1] * dark, c[2] * dark * (1 + 0.04 * yn)] };
  }, r() * 6, 0);
  // pointed top: lift the highest ring
  const p = gb.p; let top = 0; for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]);
  for (let i = 1; i < p.length; i += 3) if (p[i] > top * 0.86) p[i] += (p[i] - top * 0.86) * 0.9;
  return done(gb, vcSolid("crag", { height: H, shadeK: 0.74, rim: 0.12, grade: { sat: 1.12, post: 0.3 } }));
}
export function spireCluster(seed = 1) {
  const g = new GB(), r = rng(seed * 17), all = [];
  const parts = [];
  for (let i = 0; i < 4; i++) { const c = cragParts(seed * 10 + i, { h: i === 0 ? 8 : 3.5 + 2.5 * r(), w: i === 0 ? 1.4 : 0.8 + 0.4 * r(), detail: 3 }); const a = r() * 6.28, d = i === 0 ? 0 : 1.1 + 0.6 * r(); c[0].geo.translate(Math.cos(a) * d, 0, Math.sin(a) * d); parts.push(c[0].geo); }
  // merge the four geometries into one (all have position/normal/uv/color)
  let n = 0; for (const geo of parts) n += geo.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), UV = new Float32Array(n * 2), I = []; let o = 0;
  for (const geo of parts) { P.set(geo.attributes.position.array, o * 3); N.set(geo.attributes.normal.array, o * 3); C.set(geo.attributes.color.array, o * 3); UV.set(geo.attributes.uv.array, o * 2); const ix = geo.index.array; for (let i = 0; i < ix.length; i++) I.push(ix[i] + o); o += geo.attributes.position.count; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(P, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(N, 3)); geo.setAttribute("color", new THREE.BufferAttribute(C, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(UV, 2)); geo.setIndex(I); geo.computeBoundingSphere();
  return [{ geo, mat: vcSolid("spire", { height: 8, shadeK: 0.74, rim: 0.12, grade: { sat: 1.12, post: 0.3 } }) }];
}
export function cliffParts(seed = 1, o = {}) {
  const W = o.w ?? 12, Hc = o.h ?? 9, sx = 60, sy = 44, gb = new GB(), sd = seed * 7;
  const ids = [];
  for (let j = 0; j <= sy; j++) { const row = []; for (let i = 0; i <= sx; i++) {
    const u = i / sx, v = j / sy, x = (u - 0.5) * W, y = v * Hc;
    const s = y / (1.15 + 0.5 * hash1(sd)) + 0.5 * vnoise(x, 0, 0.35, sd), f = fr(s), band = Math.floor(s);
    let z = 0.8 * (vnoise(x, 0, 0.42, sd + 1) - 0.5) + 0.42 * ridged(x * 1.7, y * 0.08, 0, 1, sd + 2) + 0.18 * ridged(x * 4.1, y * 0.15, 0, 1, sd + 3);
    z += 0.3 * (1 - sstep(0.1, 0.5, f)) + 0.5 * (vnoise(x, y, 0.5, sd + 4) - 0.5);
    z += Math.max(0, 1.3 - y) * 0.85 + 0.5 * Math.pow(Math.abs(u - 0.5) * 2, 3);          // talus apron at the foot, rolled-back sides
    const stain = sstep(0.68, 0.9, vnoise(x, 0, 1.3, sd + 5)) * sstep(0.2, 1.0, v) * 0.38;
    const c = strataCol(band, f, y), dk = (0.86 + 0.18 * z) * (1 - stain);
    row.push(gb.v(x, y, z, c[0] * dk, c[1] * dk, c[2] * dk, x / 3.2, y / 3.2));
  } ids.push(row); }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) gb.quad(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]);
  const geo = gb.geo(true), mat = new THREE.MeshLambertMaterial({ map: strataTexture(), vertexColors: true, side: THREE.DoubleSide }); mat.userData.tag = "cliff";
  toonify(mat, { height: Hc, shadeK: 0.74, rim: 0.12, grade: { sat: 1.1, post: 0.25 } });
  return [{ geo, mat }];
}
/** loose angular shards (scree): a patch of 10 chips ~1.4 m wide, instanced */
export function screeParts(seed = 1) {
  const r = rng(seed * 33 + 1), gb = new GB(), { P, F } = icoBase(0);
  for (let c = 0; c < 10; c++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * 0.65, s = 0.05 + 0.1 * r() * r() * 3, tint = 0.72 + 0.4 * r(), warm = r() < 0.3, rot = new THREE.Euler(r() * 6, r() * 6, r() * 6), q = new THREE.Quaternion().setFromEuler(rot), base = gb.p.length / 3;
    const jit = P.map(() => [0.7 + 0.6 * r(), 0.45 + 0.35 * r(), 0.7 + 0.6 * r()]);
    P.forEach((p, i) => { const v = new THREE.Vector3(p[0] * jit[i][0], p[1] * jit[i][1], p[2] * jit[i][2]).multiplyScalar(s).applyQuaternion(q); gb.v(Math.cos(a) * d + v.x, Math.max(0.0, v.y + s * 0.4), Math.sin(a) * d + v.z, (warm ? 0.55 : 0.48) * tint, (warm ? 0.5 : 0.48) * tint, (warm ? 0.42 : 0.47) * tint); });
    for (const f of F) gb.tri(base + f[0], base + f[1], base + f[2]);
  }
  return done(gb, vcSolid("scree", { height: 0.2, shadeK: 0.76, rim: 0.05, fade: [30, 52], grade: { sat: 1.1, post: 0.3 } }));
}

// ------------------------------------------------------------------ GLACIER tongue with crevasses, moraine edge, seracs
export function glacierParts(seed = 1) {
  const gb = new GB(), L = 22, W = 10, sx = 40, sz = 80, sd = seed * 5, ids = [], cre = [];
  for (let k = 0; k < 6; k++) cre.push({ z: -L / 2 + 2.5 + k * 3.4 + hash1(sd + k) * 1.5, w: 0.16 + 0.22 * hash1(sd + k + 9), tilt: (hash1(sd + k + 3) - 0.5) * 0.5 });
  for (let j = 0; j <= sz; j++) { const row = []; for (let i = 0; i <= sx; i++) {
    const u = i / sx, v = j / sz, x = (u - 0.5) * W, z = (v - 0.5) * L, e = Math.abs(u - 0.5) * 2, mid = 1 - sstep(0.55, 1.0, e);
    let y = 1.2 * (1 - e * e) + 0.45 * (vnoise(x, z, 0.5, sd) - 0.5) + 0.12 * (vnoise(x, z, 1.8, sd + 1) - 0.5) + 0.06 * Math.sin(z * 0.9 + x * 0.3);
    let cd = 0; for (const c of cre) { const dz = (z - c.z) - c.tilt * x, g = Math.exp(-((dz / c.w) ** 2)); cd = Math.max(cd, g * (1 - sstep(0.7, 0.95, e))); }
    y -= cd * 1.3; y *= 0.6 + 0.4 * (1 - sstep(0.8, 1.0, v) * 0.7);
    const ice = [0.80, 0.92, 0.98], deep = [0.16, 0.44, 0.72], grit = [0.42, 0.40, 0.38];
    let c = mixc(ice, deep, Math.min(1, cd * 1.1)); c = mixc(c, [0.62, 0.8, 0.9], 0.3 * (1 - mid)); const mor = sstep(0.82, 0.97, e + 0.1 * (vnoise(x, z, 1.0, sd + 2) - 0.5)); c = mixc(c, grit, mor * 0.85);
    row.push(gb.v(x, y, z, c[0], c[1], c[2], x / 3, z / 3));
  } ids.push(row); }
  for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) gb.quad(ids[j][i], ids[j + 1][i], ids[j + 1][i + 1], ids[j][i + 1]);
  const r = rng(sd + 40);
  for (let k = 0; k < 7; k++) {                                                                  // seracs: tilted jagged ice blocks
    const x = (r() - 0.5) * 5, z = -L / 2 + 1 + r() * (L - 2), h = 1.1 + 1.8 * r(), w = 0.5 + 0.5 * r(), tilt = (r() - 0.5) * 0.5, base = gb.p.length / 3, sides = 5;
    const cx = x, cz = z, y0 = 0.7 * (1 - (x / (W / 2)) ** 2) - 0.2;
    for (let s = 0; s < sides; s++) { const a = (s / sides) * 6.283 + r() * 0.3; gb.v(cx + Math.cos(a) * w, y0, cz + Math.sin(a) * w, 0.62, 0.84, 0.94); }
    for (let s = 0; s < sides; s++) { const a = (s / sides) * 6.283 + r() * 0.3; gb.v(cx + Math.cos(a) * w * 0.7 + tilt * h, y0 + h * (0.8 + 0.25 * r()), cz + Math.sin(a) * w * 0.7, 0.86, 0.96, 1.0); }
    const tip = gb.v(cx + tilt * h * 1.2, y0 + h * 1.18, cz, 0.95, 0.99, 1.0);
    for (let s = 0; s < sides; s++) { const s2 = (s + 1) % sides; gb.quad(base + s, base + s2, base + sides + s2, base + sides + s); gb.tri(base + sides + s, base + sides + s2, tip); }
  }
  return done(gb, vcMat("glacier", { height: 3, shadeK: 0.9, rim: 0.5, emissive: [0.015, 0.05, 0.075], trans: 0.35, grade: { sat: 1.15, post: 0.25 } }));
}

// ------------------------------------------------------------------ SNOW DRIFT (wind-sculpted mound, sastrugi ripples)
export function snowDriftParts(seed = 1) {
  const gb = new GB(), W = 6, D = 3.2, sx = 48, sz = 24, ids = [], sd = seed * 3;
  for (let j = 0; j <= sz; j++) { const row = []; for (let i = 0; i <= sx; i++) {
    const u = i / sx - 0.5, v = j / sz - 0.5, x = u * W, z = v * D, e = Math.sqrt((u * 1.9) ** 2 + (v * 2.0) ** 2), env = 1 - sstep(0.35, 1.0, e);
    let y = env * (0.55 + 0.25 * Math.sin(x * 1.3 + sd)) * (1 - 0.6 * Math.max(0, v)) + env * 0.04 * Math.sin(x * 9 + z * 3 + 2.0 * vnoise(x, z, 1.2, sd));
    y += env * 0.05 * (vnoise(x, z, 3.0, sd + 1) - 0.5);
    const c = mixc([0.88, 0.93, 1.0], [0.97, 0.985, 1.0], sstep(0.0, 0.6, y));
    row.push(gb.v(x, y, z, c[0], c[1], c[2], x, z));
  } ids.push(row); }
  for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) gb.quad(ids[j][i], ids[j + 1][i], ids[j + 1][i + 1], ids[j][i + 1]);
  return done(gb, vcMat("drift", { height: 1, shadeK: 0.9, rim: 0.35, emissive: [0.02, 0.03, 0.05], grade: { sat: 1.0, post: 0.2 } }));
}

// ------------------------------------------------------------------ ALPINE FLOWERS
export function gentianParts(seed = 1) {
  const r = rng(seed * 41 + 3), gb = new GB();
  for (let l = 0; l < 8; l++) leaf(gb, V(0, 0.004, 0), l * 0.785 + r() * 0.3, 0.05 + 0.025 * r(), 0.011, 0.35, 0.5, [0.14, 0.34, 0.1], [0.3, 0.5, 0.16], 3);
  const nF = 4 + Math.floor(r() * 2);
  for (let f = 0; f < nF; f++) {
    const a = (f / nF) * 6.28 + r(), d = 0.012 + 0.03 * r(), H = 0.07 + 0.05 * r(), ox = Math.cos(a) * d, oz = Math.sin(a) * d;
    const P = [V(ox, 0.004, oz), V(ox, H * 0.5, oz), V(ox + Math.cos(a) * 0.004, H, oz + Math.sin(a) * 0.004)];
    tube(gb, P, [0.0018, 0.0016, 0.0014], 3, () => [0.2, 0.4, 0.15], [false, false]);
    const top = P[2], T = [top.clone(), top.clone().add(V(0, 0.016, 0)), top.clone().add(V(0, 0.032, 0)), top.clone().add(V(0, 0.044, 0))], R = [0.003, 0.0055, 0.0085, 0.0105];
    tube(gb, T, R, 5, (i, jf, ang) => (i === 0 ? [0.2, 0.42, 0.2] : (Math.floor(jf * 5) % 2 ? [0.08, 0.2, 0.86] : [0.12, 0.28, 0.9])), [false, false]);
    for (let k = 0; k < 5; k++) leaf(gb, T[3], (k / 5) * 6.283 + a, 0.02, 0.0085, 0.2, 0.55, [0.08, 0.22, 0.88], [0.18, 0.36, 0.95], 2);
    gb.tri(gb.v(T[3].x, T[3].y, T[3].z, 0.9, 0.95, 1), gb.v(T[3].x + 0.004, T[3].y, T[3].z, 0.9, 0.95, 1), gb.v(T[3].x, T[3].y, T[3].z + 0.004, 0.9, 0.95, 1));
  }
  return done(gb, vcMat("gentian", { wind: 0.8, height: 0.14, flutter: 0.2, fade: [22, 40], shadeK: 0.8, rim: 0.25, trans: 0.3 }));
}
export function edelweissParts(seed = 1) {
  const r = rng(seed * 59 + 1), gb = new GB();
  for (let l = 0; l < 6; l++) leaf(gb, V(0, 0.005, 0), l * 1.05 + r() * 0.3, 0.06 + 0.03 * r(), 0.009, 0.4, 0.5, [0.52, 0.6, 0.46], [0.72, 0.76, 0.66], 3);
  const nF = 3 + Math.floor(r() * 2);
  for (let f = 0; f < nF; f++) {
    const a = (f / nF) * 6.28 + r(), d = 0.01 + 0.025 * r(), H = 0.1 + 0.07 * r(), ox = Math.cos(a) * d, oz = Math.sin(a) * d;
    const P = [V(ox, 0.005, oz), V(ox + 0.004, H * 0.5, oz), V(ox + 0.006, H, oz)];
    tube(gb, P, [0.0022, 0.002, 0.0018], 3, (i) => mixc([0.55, 0.62, 0.5], [0.78, 0.8, 0.72], i / 2), [false, false]);
    for (let l = 0; l < 2; l++) leaf(gb, P[1], a + l * 3.14, 0.035, 0.005, 0.2, 0.2, [0.6, 0.66, 0.55], [0.76, 0.8, 0.7], 2);
    const top = P[2];
    for (let k = 0; k < 7; k++) leaf(gb, top.clone().add(V(0, 0.004, 0)), (k / 7) * 6.283 + f, 0.036, 0.0075, 0.04, 0.0, [0.94, 0.94, 0.88], [0.8, 0.8, 0.74], 2);          // woolly bracts, nearly flat
    for (let k = 0; k < 5; k++) { const aa = (k / 5) * 6.283; addBlob(gb, 0, top.clone().add(V(Math.cos(aa) * 0.006, 0.008, Math.sin(aa) * 0.006)), [0.0032, 0.0032, 0.0032], () => ({ c: [0.84, 0.78, 0.26] })); }
  }
  return done(gb, vcMat("edelweiss", { wind: 0.8, height: 0.2, flutter: 0.25, fade: [22, 40], shadeK: 0.8, rim: 0.3, trans: 0.3 }));
}
export function saxifrageParts(seed = 1) {
  const r = rng(seed * 23 + 9), gb = new GB(), pink = seed % 2 === 0;
  addBlob(gb, 2, V(0, 0.018, 0), [0.12, 0.06, 0.12], (x, y, z) => { const n = vnoise(x * 6, z * 6, 1, seed), k = y < -0.1 ? 0.5 : 1 + 0.1 * (n - 0.5); const m = 0.6 + 0.5 * n; return { k, c: [0.16 * m, 0.34 * m + 0.05, 0.12 * m] }; });
  for (let f = 0; f < 11; f++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * 0.1, H = 0.035 + 0.03 * r(), x = Math.cos(a) * d, z = Math.sin(a) * d, y0 = 0.07 * Math.sqrt(Math.max(0, 1 - (d / 0.12) ** 2));
    tube(gb, [V(x, y0, z), V(x, y0 + H, z)], [0.0012, 0.001], 3, () => [0.3, 0.42, 0.2], [false, false]);
    const col = pink ? [0.9, 0.38, 0.55] : [0.97, 0.96, 0.95];
    for (let k = 0; k < 5; k++) leaf(gb, V(x, y0 + H, z), (k / 5) * 6.283, 0.011, 0.0052, 0.1, 0.3, col, mixc(col, [1, 1, 0.6], 0.2), 2);
    addBlob(gb, 0, V(x, y0 + H + 0.003, z), [0.0021, 0.0021, 0.0021], () => ({ c: [0.9, 0.78, 0.2] }));
  }
  return done(gb, vcMat("saxifrage", { wind: 0.4, height: 0.12, flutter: 0.15, fade: [22, 40], shadeK: 0.8, rim: 0.2 }));
}
export function heatherParts(seed = 1) {
  const r = rng(seed * 47 + 2), gb = new GB();
  for (let s = 0; s < 9; s++) {
    const a = r() * 6.28, H = 0.22 + 0.2 * r(), P = arc(Math.cos(a) * 0.03, Math.sin(a) * 0.03, a, H, 0.5 + 0.4 * r(), 5);
    tube(gb, P, P.map((_, i) => 0.0042 * (1 - 0.6 * i / 4)), 4, (i) => mixc([0.32, 0.22, 0.16], [0.28, 0.4, 0.14], i / 4), [false, false]);
    for (let l = 0; l < 7; l++) { const p = lerpP(P, 0.2 + 0.1 * l); leaf(gb, p, a + l * 2.4, 0.032, 0.0065, 0.5, 0.25, [0.14, 0.3, 0.1], [0.24, 0.42, 0.16], 2); }
    for (let k = 0; k < 8; k++) { const p = lerpP(P, 0.6 + 0.052 * k), aa = k * 2.1; addBlob(gb, 0, p.clone().add(V(Math.cos(aa) * 0.005, 0, Math.sin(aa) * 0.005)), [0.0052, 0.0064, 0.0052], () => ({ c: k % 3 ? [0.66, 0.26, 0.58] : [0.76, 0.4, 0.68] })); }
  }
  return done(gb, vcMat("heather", { wind: 0.7, height: 0.4, flutter: 0.25, fade: [30, 55], shadeK: 0.78, rim: 0.2, trans: 0.2 }));
}
export function lichenParts(seed = 1) {
  const r = rng(seed * 13 + 7), gb = new GB(), cols = [[0.92, 0.56, 0.12], [0.72, 0.78, 0.22], [0.62, 0.7, 0.55], [0.18, 0.17, 0.16], [0.88, 0.74, 0.16]];
  for (let b = 0; b < 5; b++) {
    const cx = (r() - 0.5) * 0.5, cz = (r() - 0.5) * 0.5, R0 = 0.05 + 0.08 * r(), c = cols[Math.floor(r() * cols.length)], y = 0.012 + b * 0.0008, seg = 16, ctr = gb.v(cx, y + 0.004, cz, c[0] * 1.08, c[1] * 1.08, c[2] * 1.08);
    const ring = []; for (let s = 0; s < seg; s++) { const a = (s / seg) * 6.283, rr = R0 * (0.7 + 0.5 * vnoise(Math.cos(a) * 3 + b * 7, Math.sin(a) * 3, 1, seed)); ring.push(gb.v(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr, c[0] * 0.82, c[1] * 0.82, c[2] * 0.82)); }
    for (let s = 0; s < seg; s++) gb.tri(ctr, ring[s], ring[(s + 1) % seg]);
  }
  const geo = gb.geo(true), n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return [{ geo, mat: vcSolid("lichen", { height: 0.1, fade: [20, 36], shadeK: 0.85, rim: 0 }) }];
}
export function mossCushionParts(seed = 1) {
  const r = rng(seed * 29 + 11), gb = new GB();
  for (let c = 0; c < 4; c++) {
    const a = r() * 6.28, d = c ? 0.16 + 0.12 * r() : 0, R = c ? 0.09 + 0.07 * r() : 0.18 + 0.05 * r(), Hh = R * (0.55 + 0.2 * r());
    addBlob(gb, 3, V(Math.cos(a) * d, 0, Math.sin(a) * d), [R, Hh, R], (x, y, z) => {
      const n = vnoise(x * 7 + c * 3, z * 7, 1, seed), k = y < 0 ? 0.25 + 0.6 * (1 + y) : 1 + 0.07 * (n - 0.5);
      const g = 0.7 + 0.5 * n, top = Math.max(0, y); return { k, c: [0.26 * g + 0.1 * top, 0.5 * g + 0.04 * top, 0.12 * g] };
    });
  }
  return done(gb, vcSolid("mosscush", { height: 0.12, fade: [24, 44], shadeK: 0.82, rim: 0.25, trans: 0.15 }));
}
export function dwarfShrubParts(seed = 1, variant = 0) {
  const r = rng(seed * 61 + variant * 5 + 1), gb = new GB(), red = variant === 1;
  for (let s = 0; s < 7; s++) {
    const a = (s / 7) * 6.28 + r() * 0.5, L = 0.3 + 0.25 * r(), P = [];
    for (let i = 0; i <= 5; i++) { const t = i / 5; P.push(V(Math.cos(a + t * 0.8) * L * t, 0.015 + 0.05 * Math.sin(t * 3) + 0.02 * t, Math.sin(a + t * 0.8) * L * t)); }
    tube(gb, P, P.map((_, i) => 0.006 * (1 - 0.6 * i / 5)), 4, (i) => mixc([0.34, 0.24, 0.17], [0.4, 0.3, 0.2], i / 5), [false, false]);
    for (let k = 0; k < 4; k++) {
      const p = lerpP(P, 0.38 + 0.18 * k), col = red ? (r() < 0.5 ? [0.55, 0.16, 0.14] : [0.4, 0.44, 0.15]) : (r() < 0.6 ? [0.42, 0.55, 0.38] : [0.5, 0.6, 0.42]);
      addBlob(gb, 1, p.clone().add(V(0, 0.018, 0)), [0.046, 0.026, 0.046], (x, y, z) => { const n = 0.75 + 0.5 * vnoise(x * 5 + k, z * 5, 1, seed); return { k: 1, c: [col[0] * n, col[1] * n, col[2] * n] }; });
      if (red && k === 2) addBlob(gb, 0, p.clone().add(V(0.02, 0.012, 0.01)), [0.011, 0.011, 0.011], () => ({ c: [0.12, 0.08, 0.12] }));
      if (!red && k === 3) addBlob(gb, 1, p.clone().add(V(0, 0.05, 0)), [0.017, 0.028, 0.017], () => ({ c: [0.9, 0.88, 0.7] }));        // catkin
    }
  }
  return done(gb, vcMat("dwarf" + variant, { wind: 0.4, height: 0.2, flutter: 0.15, fade: [26, 48], shadeK: 0.78, rim: 0.2, trans: 0.2 }));
}
export function juniperParts(seed = 1) {
  const r = rng(seed * 83 + 2), gb = new GB();
  const nB = 7;
  for (let b = 0; b < nB; b++) {
    const a = (b / nB) * 6.28 + r() * 0.4, L = 0.7 + 0.6 * r(), P = [];
    for (let i = 0; i <= 5; i++) { const t = i / 5; P.push(V(Math.cos(a) * L * t, 0.08 + 0.3 * Math.sin(t * 1.6) * (0.6 + 0.5 * r() * 0), Math.sin(a) * L * t)); }
    tube(gb, P, P.map((_, i) => 0.03 * (1 - 0.8 * i / 5)), 5, (i) => mixc([0.36, 0.26, 0.2], [0.3, 0.3, 0.22], i / 5), [false, false]);
    for (let k = 0; k < 4; k++) {
      const p = lerpP(P, 0.35 + 0.2 * k), g = 0.75 + 0.45 * r(), top = k === 3 ? 0.7 : 1.0;
      addBlob(gb, 1, p.clone().add(V(0, 0.07, 0)), [0.2 * top, 0.11, 0.2 * top], (x, y, z) => { const n = 0.8 + 0.4 * vnoise(x * 4 + k + b, z * 4, 1, seed); const tipc = Math.max(0, y); return { k: 1 + 0.08 * (n - 1), c: [(0.2 + 0.1 * tipc) * g * n, (0.38 + 0.1 * tipc) * g * n, (0.32 + 0.06 * tipc) * g * n] }; });
      if (k === 1 && b % 2 === 0) addBlob(gb, 0, p.clone().add(V(0.05, 0.1, 0.03)), [0.018, 0.018, 0.018], () => ({ c: [0.2, 0.26, 0.5] }));    // berries
    }
  }
  return done(gb, vcMat("juniper", { wind: 0.25, height: 0.6, flutter: 0.2, fade: [40, 70], shadeK: 0.74, rim: 0.2, trans: 0.2 }));
}

// ------------------------------------------------------------------ KRUMMHOLZ (wind-bent dwarf pine, flagged: foliage on the lee side) and the SILVER SNAG
export function krummholzParts(seed = 1) {
  const r = rng(seed * 97 + 4), bark = new GB(), fol = new GB(), lee = r() * 0.6 - 0.3;
  const nT = 2 + (seed % 2);
  for (let t = 0; t < nT; t++) {
    const H = 1.3 + 1.0 * r(), a0 = t * 2.4 + r(), P = [], R = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8, bend = Math.pow(u, 1.7) * (1.5 + 1.0 * r() * 0); P.push(V(Math.cos(a0) * 0.1 * u + Math.cos(lee) * bend * H * 0.55, H * Math.pow(u, 0.8) * (1 - 0.3 * u), Math.sin(a0) * 0.1 * u + Math.sin(lee) * bend * H * 0.55 + Math.sin(u * 5 + t) * 0.04)); R.push(0.11 * (1 - 0.78 * u) + 0.01); }
    tube(bark, P, R, 6, (i, jf) => (Math.floor(jf * 6) % 2 ? [0.3, 0.22, 0.17] : [0.24, 0.18, 0.14]), [false, true]);
    for (let b = 0; b < 7; b++) {
      const u = 0.3 + 0.7 * (b / 7), p0 = lerpP(P, u), side = b % 3 === 2 ? -1 : 1, ba = lee + (r() - 0.5) * 1.4 + (side < 0 ? 3.14 : 0), L = (0.5 + 0.5 * r()) * (side < 0 ? 0.35 : 1) * (1.2 - u * 0.5), BP = [];
      for (let i = 0; i <= 3; i++) { const q = i / 3; BP.push(V(p0.x + Math.cos(ba) * L * q, p0.y + 0.1 * q - 0.18 * q * q * L, p0.z + Math.sin(ba) * L * q)); }
      tube(bark, BP, [0.03, 0.022, 0.015, 0.008], 4, () => [0.26, 0.2, 0.15], [false, false]);
      if (side > 0) for (let k = 1; k <= 3; k++) {
        const p = BP[k], g = 0.8 + 0.4 * r();
        addBlob(fol, 1, p.clone().add(V(0, 0.05, 0)), [0.2 + 0.05 * r(), 0.09, 0.2], (x, y, z) => { const n = 0.8 + 0.4 * vnoise(x * 4 + k, z * 4, 1, seed + b); return { k: 1, c: [(0.09 + 0.05 * Math.max(0, y)) * g * n, (0.22 + 0.08 * Math.max(0, y)) * g * n, (0.12 + 0.03 * Math.max(0, y)) * g * n] }; });
      }
    }
  }
  return [{ geo: bark.geo(true), mat: vcMat("krumbark", { wind: 0.04, height: 2.2, shadeK: 0.7, rim: 0.1 }) }, { geo: fol.geo(true), mat: vcMat("krumfol", { wind: 0.5, height: 2.4, flutter: 0.4, shadeK: 0.72, rim: 0.2, trans: 0.2 }) }];
}
export function snagParts(seed = 1) {
  const r = rng(seed * 101 + 6), gb = new GB(), H = 7 + 3 * r(), n = 11, P = [], R = [];
  for (let i = 0; i <= n; i++) { const u = i / n; P.push(V(Math.sin(u * 3.2 + seed) * 0.28 * u + (r() - 0.5) * 0.04, H * u, Math.cos(u * 2.6 + seed) * 0.22 * u)); R.push(0.34 * (1 - 0.8 * Math.pow(u, 0.8)) + 0.03 + 0.18 * Math.max(0, 0.12 - u) * 4); }
  const grain = (i, jf) => { const k = Math.floor(jf * 14), cr = hash1(k * 3.1 + seed) < 0.28; const base = [0.66, 0.64, 0.58]; const s = 0.82 + 0.3 * hash1(k + i * 0.13 + seed); return cr ? [0.3, 0.28, 0.26] : [base[0] * s, base[1] * s, base[2] * s]; };
  tube(gb, P, R, 9, grain, [false, true]);
  const tip = P[n]; for (let s = 0; s < 3; s++) { const a = s * 2.1; tube(gb, [tip.clone().add(V(Math.cos(a) * 0.05, -0.2, Math.sin(a) * 0.05)), tip.clone().add(V(Math.cos(a) * 0.04, 0.35 + 0.25 * r(), Math.sin(a) * 0.04))], [0.045, 0.004], 4, grain, [false, false]); }       // splintered top
  for (let b = 0; b < 8; b++) {
    const u = 0.25 + 0.7 * r(), p0 = lerpP(P, u), a = r() * 6.28, L = (0.5 + 1.3 * r()) * (1.1 - u * 0.5), BP = [];
    for (let i = 0; i <= 3; i++) { const q = i / 3; BP.push(V(p0.x + Math.cos(a) * L * q, p0.y + 0.15 * L * q - 0.12 * q * q * L + (b % 3 === 0 ? 0.5 * q * L : 0), p0.z + Math.sin(a) * L * q)); }
    tube(gb, BP, [0.045, 0.035, 0.022, 0.008].map((v) => v * (1.1 - u * 0.5)), 5, grain, [false, true]);
  }
  return done(gb, vcMat("snag", { wind: 0.04, height: H, shadeK: 0.7, rim: 0.18, grade: { sat: 0.9, post: 0.3 } }));
}
