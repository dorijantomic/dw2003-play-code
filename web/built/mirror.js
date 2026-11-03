// THE LAKE AND ITS REFLECTIONS in the BUILT arena look (Arena Viewer, look=built), for an arena whose recipe carries
// the mirror pieces (meft1008: wall_01 kind "pine_mirror", wall_04 kind "rock_mirror").
//
// WHAT THE ORIGINAL IS (measured, ~/dw3-knowledge/research/r5-meft1008/MEASURE.md 2a/2e, mirror.md):
// the ground is an island in a flat, calm, pale lilac lake whose colour IS the arena background (bg [240,232,248]);
// everything mirrored in it is an upside-down copy BELOW y 0 — the near tree/shrub ring, the far pine treeline and the
// boulder piles — re-painted and re-paletted by hand into a cooler, washed-out blue-grey (loses 10-20 % green, gains
// blue; the far treeline is cut to ~1/3 contrast and lifted toward [~50,~50,~60], 24 % of it transparent where the
// sky is). There is no water mesh and no water texel: the "lake" is that flat colour plus the copies. So this module
// draws (a) the flat surface outside the shore, very nearly the measured colour, with the water cues kept UNDER a few
// percent so the mean stays [240,232,248], and (b) the three mirrored copies below y 0, each tinted to its own
// measured reflection colour and faded into the lake colour with depth.
//
// WHERE THE LAND ENDS is not copied here: soil.js's soilLand(rec) is the one outline ground.js built the floor and the
// apron from (landAt / outline.intervals / landEnd), so the shore in this file is the same shore the fighters stand on.
//
// THE REFLECTIONS ARE BELOW THE WATER, the land is above it, and the water surface writes no depth: a fragment of a
// reflected tree is hidden by the land or the tree in front of it (depth test) but never by the water it is reflected
// in. Draw order inside the transparent pass is renderOrder: lake 5, reflections 6..8.
// Nothing here pokes above y = 0 (the shader discards vW.y > -0.5 units, 1 mm) and the mirrored copies hang from a
// parent with scale.y = -1, so a vertex that stood at +y stands at exactly -y.
//
// SOURCES: nothing downloaded. The near ring re-uses the tree module's OWN geometry and instance matrices
// (web/built/trees.js `reflection` / the "builtTreeRing" meshes, userData { kind: "foliage", ring: true }) with a
// material written here (it must be dimmer and cooler than the thing it mirrors — mirror.md 6); the far treeline band
// and the boulder quads are built from the recipe's own profile (rmin/rmax/ymin/ymax) exactly as the original's
// wall_01 / wall_04 stand there. Wind, noise, light and haze are the shared ones (web/built/shared.js): the copies sway
// with the trees (same builtWorldPos(), same uWindRing gust) and fade into the same skyRadiance() the dome paints.
// The ripple after mirror.md 5.1 (mirror.js's own plan): two sine trains in the vertex shader, amplitude growing with
// depth. Reflection tint rule: MEASURE.md 2e's per-channel fit (sRGB), applied to the piece's own measured colour.
import * as THREE from "../lib3d/three.module.js";
import * as S from "./shared.js";
import { soilLand } from "./soil.js";

const M = S.UNITS_PER_M;   // 400 render units = 1 m

export const LAKE = {
  Y: -2,            // the surface sits 5 mm under the land: the land always hides it, and 5 mm is ~250x the depth
                    // resolution at 20-40 m, so nothing z-fights (measured against the 1..60000 camera)
  R_OUT: 30000,     // 75 m: well past the far treeline (27.78 m) and inside the camera's 60000 far plane
  STEP_DEG: 3,      // azimuth step of the surface mesh (the shore outline itself is 1 deg / 20 units)
  OVERLAP: 300,     // each water run starts this far UNDER the land (0.75 m), so the tessellated shore has no gap
  ROW0: 150, GROW: 1.28,   // radial rows: 0.38 m at the shore, growing to ~25 m at the far edge
  SHORE_W: 500,     // 1.25 m: the width of the shore ring (wet edge + lapping foam line)
  // WATER LOOK (user, 2026-10-30, comparing with the real game: dark grey / blue-grey, rippled, darker toward us,
  // tree and rock reflections visible, slight glint, soft shore). The MEASURED part is the cast: every re-painted
  // reflection in the pack is blue-grey (MEASURE.md 2e; wall_01 clusters [27,27,31] [43,46,54] [61,67,77] [77,85,96],
  // wall_04 [12,12,12] [25,29,29] [38,46,45]). The water body is a dark step of that same cast. The two colours are
  // PICKED from the user's words (no water texel exists in the pack: MEASURE.md 2a).
  NEAR: [24, 28, 40],      // sRGB, the water right under the camera (darkest)
  FAR: [40, 46, 62],       // sRGB, 25 m and more away (the cast the far reflections are lifted toward)
  D0: 4 * 400, D1: 26 * 400,   // distance range (render units) over which NEAR turns into FAR
  TEX_REPEAT: [7.0, 2.3],  // metres per repeat of the two normal-map taps
  SLOPE: [0.55, 0.40],     // normal strength of the two taps (PICKED)
  SLOPE_FAR: 0.30,         // share of that strength left at 40 m (stops far shimmer)
  SPEED: [[0.020, 0.012], [-0.013, 0.021]],   // texture repeats per second of each tap
  HEIGHT_K: 0.32,          // brightness swing of the water body with the wave height (the "rocky ripple" texture)
  F0: 0.02,                // Fresnel at normal incidence (water)
  SKY_K: 0.20,
  SKY_SAT: 0.45, SKY_DIM: 0.85,   // the reflected sky is greyed and dimmed (the lake is dark grey/blue-grey, not lilac)             // share of the Fresnel sky reflection that is kept (the game's water is dark, not a mirror)
  SPEC_K: 0.50, SPEC_POW: 80,   // sun glint: slight
  SHORE_COL: [18, 18, 20], SHORE_K: 0.55,   // the wet dark edge under the land
  FOAM_COL: [120, 130, 142], FOAM_K: 0.30,  // the lapping line at the waterline (soft)
};

// The grass bank at the foot of the far pines. WHICH PIECE IT IS (measured, MEASURE.md 2c + this module's pieces
// check): wall_00's bottom picture row, 0.93 m high, [96,112,80] median -- paler than the trees above it ([16,32,16]).
// Seen from the fight camera across the lake (a vertical 0.93 m card at 27.5 m, 2 degrees tall) it reads as a flat
// light-green strip behind the water. Built here as a real low bank (a ring segment that rises from the water to
// that height), grass-shaded.
export const BANK = {
  R0: 25.2, R1: 27.55,    // metres: where it leaves the water / where it meets the pines' feet (r 27.54 at the quads)
  H: 0.93,                // metres: the picture row's own height (7.41 m / 8)
  SEG: 180,               // azimuth segments
  PROFILE: [0, 0.03, 0.30, 0.78, 1.0, 1.0],   // height share across the width (a shelf, not a wall)
  COL: [96, 112, 80],     // sRGB fallback; the live number is read from the far-pines piece's foot row
};

export const REFL = {
  // MEASURE.md 2e, fitted per channel in sRGB over the three floor pieces: floor_00 R .80x+10 G .93x-2 B 1.03x+11,
  // floor_01 R .85x+3.5 G .83x-4.5 B 1.01x+3.5, floor_02 R .80x+11 G .89x-2.5 B 1.11x+10 (averaged below).
  K: [0.817, 0.883, 1.05], C: [8.2, -3.0, 8.2],
  ALPHA: 0.95,      // PICKED, from the measured clear shares (wall_01 24 %, wall_04 41 %, the ring 0 %): the copies are
                    // opaque where their source picture is, and their see-through parts are the lake colour anyway
  ALPHA_K: 0.22,    // PICKED: the deepest part of a copy keeps 78 % of that alpha (a fade, not a disappearance)
  FADE: 0.045,      // per metre of depth: the copy drifts toward the pale lake colour...
  FADE_MAX: 0.30,   // ...but never more than this share of it (the original's copies stay readable to their bottom)
  RIPPLE: 0.020,    // metres of lateral wobble per metre of depth (PICKED: 0.16 m at 8 m — a ripple, not a warp)
  BAND_TOP: [4.75, 7.30],   // MEASURE 2c pine silhouette min/max above the water (m) — the mirrored band's jagged edge
};

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** The measured reflection tint (MEASURE.md 2e) applied to a piece's measured sRGB colour -> linear THREE.Color. */
export function reflectColour(rgb255, k = REFL.K, c = REFL.C) {
  const out = rgb255.map((v, i) => Math.min(255, Math.max(0, k[i] * v + c[i])) / 255);
  return new THREE.Color().setRGB(...out.map(toLin));
}

// ------------------------------------------------------------------ the lake surface
/** The water runs (render units, along the ray) at azimuth az, as the complement of soil.js's land intervals.
 *  Pure numbers; the checker re-uses it against soilLand(). */
export function waterRuns(land, azDeg, R = LAKE.R_OUT) {
  const k = Math.round(((azDeg + 180) % 360 + 360) % 360 / land.outline.stepDeg) % land.outline.intervals.length;
  const iv = land.outline.intervals[k] || [];
  const runs = [];
  let r = 0;
  for (const [a, b] of iv) { if (a > r) runs.push([r, a]); r = Math.max(r, b); }
  if (r < R) runs.push([r, R]);
  return runs.filter(([a, b]) => b - a > 1);
}

/** Polar water mesh: per azimuth column, cells from the shore (OVERLAP under the land) out to R_OUT, rows growing
 *  outwards. `edge` = 1 at the waterline and 0 SHORE_W out (the shore ring), all at y = LAKE.Y. */
export function lakeGeometry(land, R = LAKE.R_OUT) {
  const pos = [], edge = [], idx = [];
  const cols = Math.round(360 / LAKE.STEP_DEG);
  let tris = 0, verts = 0;
  for (let i = 0; i < cols; i++) {
    const az0 = -180 + i * LAKE.STEP_DEG, az1 = az0 + LAKE.STEP_DEG;
    const a0 = az0 * Math.PI / 180, a1 = az1 * Math.PI / 180;
    const runs = waterRuns(land, (az0 + az1) / 2, R);
    for (const [ra, rb] of runs) {
      const start = Math.max(0, ra - LAKE.OVERLAP);
      const rs = [];
      for (let r = start, step = LAKE.ROW0; r < rb; step *= LAKE.GROW) rs.push(Math.min(rb, r += step));
      rs.unshift(start);
      if (rs.length < 2) continue;
      const base = verts;
      for (const r of rs) for (const az of [a0, a1]) {
        pos.push(Math.sin(az) * r, LAKE.Y, Math.cos(az) * r);
        edge.push(1 - Math.min(1, Math.max(0, (r - ra) / LAKE.SHORE_W)));
        verts++;
      }
      for (let j = 0; j < rs.length - 1; j++) {
        const q = base + j * 2;
        idx.push(q, q + 2, q + 3, q, q + 3, q + 1);   // wound to face +y
        tris += 2;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("edge", new THREE.BufferAttribute(new Float32Array(edge), 1));
  g.setIndex(idx.length > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  g.userData = { tris, verts, cols, rOut: R };
  return g;
}

// ------------------------------------------------------------------ the water's normal map
/** A tileable ripple normal map made here (no download, no licence): RGB = tangent-space normal, A = wave height.
 *  Four octaves of periodic value noise folded into ridges (abs(2n-1)), which is what makes the ripples look cut like
 *  rippled rock rather than smooth swell; normals by wrapped central differences. The same two-tap, scrolling,
 *  distance-faded use of a normal map as three.js examples/jsm/objects/Water.js (MIT; its waternormals.jpg is
 *  replaced by this generated map), shaded for a dark, calm lake. Deterministic: the seed is fixed. */
export function makeWaterNormalData(size = 256, seed = 20261030) {
  let st = seed >>> 0;
  const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296);
  const H = new Float32Array(size * size);
  const oct = [[4, 0.50], [8, 0.27], [16, 0.15], [32, 0.08]];
  for (const [per, amp] of oct) {
    const lat = new Float32Array(per * per);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const at = (x, y) => lat[((y % per) + per) % per * per + ((x % per) + per) % per];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / size * per, fy = y / size * per, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy, ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
      const n = (at(ix, iy) * (1 - ux) + at(ix + 1, iy) * ux) * (1 - uy) + (at(ix, iy + 1) * (1 - ux) + at(ix + 1, iy + 1) * ux) * uy;
      H[y * size + x] += amp * (1 - Math.abs(2 * n - 1));
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const data = new Uint8Array(size * size * 4);
  const h = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  const K = 3.2;   // slope gain before the shader's own strength
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * K * size / 64, dy = (h(x, y + 1) - h(x, y - 1)) * K * size / 64;
    const L = Math.hypot(dx, dy, 1), o = (y * size + x) * 4;
    data[o] = Math.round((-dx / L * 0.5 + 0.5) * 255); data[o + 1] = Math.round((-dy / L * 0.5 + 0.5) * 255);
    data[o + 2] = Math.round((1 / L * 0.5 + 0.5) * 255);
    data[o + 3] = Math.round((h(x, y) - lo) / Math.max(1e-6, hi - lo) * 255);
  }
  return { size, data, range: [lo, hi] };
}
let _wn = null;
function waterNormalTexture() {
  if (_wn) return _wn;
  const { size, data } = makeWaterNormalData();
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true; t.name = "builtWaterNormals";
  return (_wn = t);
}

// ------------------------------------------------------------------ the lake surface shader
const LAKE_VS = /* glsl */`
  attribute float edge;
  varying vec3 vW; varying float vEdge;
  void main() {
    vEdge = edge;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// DARK RIPPLED WATER. Body colour: NEAR (darkest, under the camera) to FAR with distance. Two scrolling taps of the
// normal map bend the normal; the height channel modulates the body (the rocky ripple texture); a Schlick Fresnel
// (darker looking down, more reflective at grazing angles) mixes in a share of the sky the bent normal reflects; a
// Blinn glint from the sun; a wet dark edge and a soft lapping line at the waterline. The reflections themselves
// are the mirrored copies drawn after this surface.
const LAKE_FS = /* glsl */`
  uniform sampler2D uWN;
  uniform vec3 uLakeNear, uLakeFar, uShoreCol, uFoamCol;
  uniform vec2 uLakeRep, uLakeSlope, uSpeedA, uSpeedB;
  uniform float uLakeD0, uLakeD1, uSlopeFar, uHeightK, uF0, uSkyK, uSpecK, uSpecPow, uShoreK, uFoamK, uLakeAmt, uWindTime, uSkySat, uSkyDim;
  varying vec3 vW; varying float vEdge;
  ${S.NOISE_GLSL}
  ${S.LIGHT_GLSL}
  void main() {
    vec3 Vv = cameraPosition - vW;
    float d = length(Vv);
    vec3 V = Vv / d;
    float dh = length(Vv.xz);
    float t = uWindTime;
    vec2 uA = vW.xz / (uLakeRep.x * 400.0) + uSpeedA * t;
    vec2 uB = vW.xz / (uLakeRep.y * 400.0) + uSpeedB * t;
    vec4 tA = texture2D(uWN, uA), tB = texture2D(uWN, uB);
    float atten = mix(1.0, uSlopeFar, smoothstep(6.0 * 400.0, 40.0 * 400.0, dh));
    atten *= 1.0 - 0.7 * vEdge;                                // calm, small ripples right at the waterline (soft shore)
    vec2 sl = ((tA.xy - 0.5) * 2.0 * uLakeSlope.x + (tB.xy - 0.5) * 2.0 * uLakeSlope.y) * atten;
    vec3 n = normalize(vec3(sl.x, 1.0, sl.y));
    float hgt = (tA.a + tB.a) * 0.5;                          // 0..1 wave height (ridged)
    // body: darker toward us, the ripple height modulates it
    vec3 body = mix(uLakeNear, uLakeFar, smoothstep(uLakeD0, uLakeD1, dh));
    body *= 1.0 + (hgt - 0.5) * 2.0 * uHeightK * mix(1.0, 0.45, smoothstep(10.0 * 400.0, 40.0 * 400.0, dh));
    // Fresnel (Schlick) on the bent normal: low looking down, high at grazing angles
    float cosT = clamp(dot(V, n), 0.0, 1.0);
    float F = uF0 + (1.0 - uF0) * pow(1.0 - cosT, 5.0);
    vec3 R = reflect(-V, n);
    vec3 sky = skyRadiance(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
    sky = mix(vec3(lumaB(sky)), sky, uSkySat) * uSkyDim;   // a dark lake reflects a greyed, dimmed sky
    vec3 c = body * (1.0 - F * uSkyK) + sky * F * uSkyK;
    // slight sun glint (Blinn) on the ripples
    vec3 Hh = normalize(uLightDir + V);
    // the glint reads the broad (first) tap only: wide soft highlights on the swell, not per-pixel sparkle
    vec2 slS = (tA.xy - 0.5) * 2.0 * uLakeSlope.x * atten;
    vec3 nS = normalize(vec3(slS.x, 1.0, slS.y));
    float sp = pow(max(dot(nS, Hh), 0.0), uSpecPow) * uSpecK * (0.4 + 0.6 * smoothstep(0.35, 0.8, hgt));
    c += uSunColor * sp * 0.5;
    // the shore: a wet dark edge, then a soft lapping line
    float lap = smoothstep(0.50, 0.95, vEdge + (hgt - 0.5) * 0.55 + 0.07 * sin(t * 0.9 + vW.x * 0.004 + vW.z * 0.003));
    c = mix(c, uShoreCol, smoothstep(0.55, 1.0, vEdge) * uShoreK);
    c = mix(c, uFoamCol, lap * (1.0 - smoothstep(0.80, 1.0, vEdge)) * uFoamK);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

// ------------------------------------------------------------------ the reflections
// Vertex: the shared wind (so a mirrored tree sways with its own tree), then two sine trains that wobble the copy
// sideways, growing linearly with the depth below the waterline (mirror.md 5.1: the difference between "reflection"
// and "duplicate"). y is never touched: a copy stays exactly as deep as its source is tall.
const REFL_VS = /* glsl */`
  #ifdef MIRROR_CARDS
    attribute float leaf;   // 1 on a leaf card, 0 on the shrub's opaque core (web/built/trees.js geometry)
  #endif
  varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vUv; varying float vLeaf; varying float vDepth;
  ${S.NOISE_GLSL}
  ${S.WIND_GLSL}
  uniform float uRipple;
  void main() {
    mat4 im = mat4(1.0);
    #ifdef USE_INSTANCING
      im = instanceMatrix;
    #endif
    vTint = vec3(1.0);                                  // per-instance variety only (the piece colour is the uniform)
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #endif
    vLeaf = 0.0;
    #ifdef MIRROR_CARDS
      vLeaf = leaf;
    #endif
    vec4 wp = modelMatrix * im * vec4(builtWind(position, uv, vLeaf, im), 1.0);
    float depth = max(0.0, -wp.y) / ${M.toFixed(1)};
    float w1 = sin(depth * 2.7 + uWindTime * 0.9 + wp.x * 0.021);
    float w2 = sin(depth * 6.1 - uWindTime * 0.6 + wp.z * 0.033);
    wp.x += (0.6 * w1 + 0.4 * w2) * uRipple * depth;
    wp.z += (0.4 * w1 - 0.6 * w2) * uRipple * depth;
    vW = wp.xyz;
    vDepth = depth;
    vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

// Fragment: the measured reflection colour (per piece), shaded in three soft bands (a reflection is not lit like the
// thing it mirrors), faded into the lake colour with depth. No part of it is ever above the waterline.
const REFL_FS = /* glsl */`
  uniform vec3 uTint, uLakeMid;
  uniform float uAlpha, uFadeK, uFadeMax, uAlphaK, uDeep;
  #ifdef MIRROR_CARDS
    uniform float uLeafAlpha; uniform sampler2D uLeafTex;
  #endif
  varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vUv; varying float vLeaf; varying float vDepth;
  ${S.NOISE_GLSL}
  ${S.LIGHT_GLSL}
  // the depth fade is done in sRGB, not linear: the measured numbers (MEASURE 2e) are sRGB, and a 1 % linear lift
  // toward the very bright lake colour would repaint a dark reflection by 20/255 on its own
  vec3 reflEnc(vec3 c) { return mix(1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, 12.92 * c, step(c, vec3(0.0031308))); }
  vec3 reflDec(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045))); }
  vec3 reflFade(vec3 col, float f) { return reflDec(mix(reflEnc(col), reflEnc(uLakeMid), f)); }
  void main() {
    if (vW.y > -0.5) discard;                       // never above the water (1 mm under the surface)
    #ifdef MIRROR_CARDS
      if (vLeaf > 0.5 && texture2D(uLeafTex, vUv).a < uLeafAlpha) discard;   // the cards' own see-through mask
    #endif
    float depth = max(0.0, -vW.y) / ${M.toFixed(1)};
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    float t = dot(N, uLightDir);
    float band = smoothstep(-0.35, 0.55, t);                 // three soft bands, no hard toon step
    float shade = 1.0 + (band - 0.5) * 0.36;                  // mean 1: the copy's own mean IS the measured colour
    // a cheap variation instead of a noise tap: the copies are 15-30 m away and only a couple of per cent of their
    // colour range is legible there (one noise3 = 24 texture fetches per pixel at this range: not worth 24 taps)
    float spread = 0.86 + 0.28 * clamp(0.35 + 0.5 * t + 0.22 * sin(vW.x * 0.013 + vW.y * 0.021 + vW.z * 0.017), 0.0, 1.0);
    vec3 col = uTint * shade * spread * vTint;
    // deeper into the water the copy drifts toward the pale lake colour and thins out — but it stays readable to its
    // own bottom (the original's wall_01 is a 24 %-see-through picture all the way down, not a gradient)
    float f = min(1.0 - exp(-depth * uFadeK), uFadeMax);
    col = reflFade(col, f);
    float a = uAlpha * (1.0 - uAlphaK * smoothstep(0.0, uDeep, depth));
    col = mix(col, uLakeMid, 0.05);   // the couple of per cent of sky haze a 15-30 m distance is worth (no aerial() call:
                                   // its skyRadiance() is the dome's whole gradient per pixel, for 5 % of colour)
    gl_FragColor = vec4(col, a * smoothstep(0.0, 0.05, depth));
    #include <colorspace_fragment>
  }`;

// The far treeline's mirrored band: the pines' own skyline (MEASURE 2c, 4.70..7.32 m above the water) as the band's
// lower edge, sampled round the circle so the jagged edge has no seam, and a vertical gradient inside it.
const BAND_FS = /* glsl */`
  uniform vec3 uTint, uTintLo, uTintHi, uLakeMid;
  uniform float uAlpha, uFadeK, uFadeMax, uAlphaK, uDeep;
  uniform vec2 uSkyline;      // min / max metres above the water (MEASURE 2c)
  varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vUv; varying float vLeaf; varying float vDepth;
  ${S.NOISE_GLSL}
  ${S.LIGHT_GLSL}
  vec3 reflEnc(vec3 c) { return mix(1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, 12.92 * c, step(c, vec3(0.0031308))); }
  vec3 reflDec(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045))); }
  void main() {
    float depth = max(0.0, -vW.y) / ${M.toFixed(1)};
    float az = atan(vW.x, vW.z);
    vec3 ring = vec3(cos(az), sin(az), 0.0);
    float n1 = noise3(ring * 3.1 + vec3(0.0, 0.0, 1.3));
    float n2 = noise3(ring * 9.7 + vec3(0.0, 0.0, 7.9));
    float top = mix(uSkyline.x, uSkyline.y, clamp(n1 * 0.72 + n2 * 0.28, 0.0, 1.0));
    float a = 1.0 - smoothstep(top - 0.6, top + 0.12, depth);   // the mirrored tree tops: a soft, ragged edge
    if (a < 0.02) discard;
    float g = clamp(depth / max(top, 0.5), 0.0, 1.0);
    vec3 col = mix(uTintHi, uTintLo, g) * (0.88 + 0.24 * sin(vW.x * 0.011 + vW.z * 0.009));
    float f = min(1.0 - exp(-depth * uFadeK), uFadeMax);
    col = reflDec(mix(reflEnc(col), reflEnc(uLakeMid), f));
    float thin = uAlpha * (1.0 - uAlphaK * smoothstep(0.0, uDeep, depth));
    col = mix(col, uLakeMid, 0.05);
    gl_FragColor = vec4(col, thin * a);
    #include <colorspace_fragment>
  }`;

// The far treeline's copy when trees.js's own painted band (wall_00, "builtFarPines") exists: the SAME geometry
// (position buffer shared, nothing copied), so the reflected skyline is exactly the skyline above. Only its colour is
// replaced: the measured reflection tint of wall_01 (MEASURE 2e), lighter at the waterline, faded into the lake.
const SHARED_VS = /* glsl */`
  uniform float uRipple;
  varying vec3 vW; varying float vDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float depth = max(0.0, -wp.y) / ${M.toFixed(1)};
    float w1 = sin(depth * 2.7 + uWindTime * 0.9 + wp.x * 0.021);
    float w2 = sin(depth * 6.1 - uWindTime * 0.6 + wp.z * 0.033);
    wp.x += (0.6 * w1 + 0.4 * w2) * uRipple * depth;
    wp.z += (0.4 * w1 - 0.6 * w2) * uRipple * depth;
    vW = wp.xyz; vDepth = depth;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const SHARED_FS = /* glsl */`
  uniform vec3 uTintLo, uTintHi, uLakeMid;
  uniform float uAlpha, uFadeK, uFadeMax, uAlphaK, uDeep, uBandH;
  varying vec3 vW; varying float vDepth;
  ${S.NOISE_GLSL}
  ${S.LIGHT_GLSL}
  vec3 reflEnc(vec3 c) { return mix(1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, 12.92 * c, step(c, vec3(0.0031308))); }
  vec3 reflDec(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045))); }
  void main() {
    float depth = max(0.0, -vW.y) / ${M.toFixed(1)};
    float g = clamp(depth / uBandH, 0.0, 1.0);
    vec3 col = mix(uTintHi, uTintLo, g) * (0.88 + 0.24 * sin(vW.x * 0.011 + vW.z * 0.009));
    float f = min(1.0 - exp(-depth * uFadeK), uFadeMax);
    col = reflDec(mix(reflEnc(col), reflEnc(uLakeMid), f));
    float thin = uAlpha * (1.0 - uAlphaK * smoothstep(0.0, uDeep, depth));
    col = mix(col, uLakeMid, 0.05);
    gl_FragColor = vec4(col, thin * smoothstep(0.0, 0.05, depth));
    #include <colorspace_fragment>
  }`;

function reflectionMaterial(THREE, own = {}, defines = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: S.uniformsWith(own),
    vertexShader: defines.MIRROR_SHARED ? SHARED_VS : REFL_VS,
    fragmentShader: defines.MIRROR_SHARED ? SHARED_FS : defines.MIRROR_BAND ? BAND_FS : REFL_FS,
    defines,
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });
  // attributes three fills when a geometry does not carry them (cypress geometry has no tint/leaf/uv)
  m.defaultAttributeValues = { tint: [1, 1, 1], leaf: [0], uv: [0, 0] };
  return m;
}

/** Probe for the checker: the reflection colour at N depths below the waterline (metres, the `depth` attribute),
 *  drawn as a grid of points through the SAME uniform objects as the real material. Output is the DISPLAY
 *  (sRGB-encoded) colour the real material would write at that depth, so it can be compared with the measured sRGB
 *  means in MEASURE.md 2e. `cols`/`rows` lay the points out on the target. */
export function mirrorProbeMaterial(uniforms, cols = 32, rows = 8) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, uniforms, { uGrid: { value: new THREE.Vector2(cols, rows) } }),
    vertexShader: /* glsl */`
      attribute float pid; attribute float depth;
      uniform vec2 uGrid;
      varying float vD;
      void main() {
        vD = depth; gl_PointSize = 2.0;
        gl_Position = vec4((mod(pid, uGrid.x) + 0.25) / uGrid.x * 2.0 - 1.0,
                           (floor(pid / uGrid.x) + 0.25) / uGrid.y * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTint, uLakeMid; uniform float uFadeK, uFadeMax;
      varying float vD;
      vec3 pEnc(vec3 c) { return mix(1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, 12.92 * c, step(c, vec3(0.0031308))); }
      vec3 pDec(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045))); }
      void main() {
        // exactly what REFL_FS writes: base colour, faded toward the lake in sRGB, then display-encoded — but with no
        // shading (a flat base), so the number is the piece's own measured reflection colour
        float f = min(1.0 - exp(-vD * uFadeK), uFadeMax);
        vec3 col = pDec(mix(pEnc(uTint), pEnc(uLakeMid), f));
        gl_FragColor = vec4(pEnc(col), 1.0);
      }`,
    transparent: false, depthTest: false, depthWrite: false,
  });
}

// ------------------------------------------------------------------ geometry helpers
/** The far ring band the original's mirror copy is (r unused by the caller's material: it is a flat band). */
function bandGeometry(THREE, piece, seg = 96, rows = 8) {
  const r = (piece.rmin + piece.rmax) / 2;
  const yTop = piece.ymax, yBot = piece.ymin;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, y = yTop + (yBot - yTop) * Math.pow(t, 1.25);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(i / seg, t);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 2, d = a + seg + 1;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.userData = { tris: idx.length / 3, r, yTop, yBot };
  return g;
}

/** The two boulder piles as quads facing the centre (MEASURE.md 2d: az -65.5 r 24.17 2.93 x 1.72 m; az 128.1
 *  r 22.98 3.81 x 2.15 m), hanging from y 0 down — the original's own four triangles for wall_04. */
const PILES = [{ az: -65.5, r: 24.17, w: 2.93, h: 1.72 }, { az: 128.1, r: 22.98, w: 3.81, h: 2.15 }];
function pileGeometry(THREE, piles = PILES) {
  const pos = [], idx = [];
  let n = 0;
  for (const p of piles) {
    const a = p.az * Math.PI / 180, ux = Math.sin(a), uz = Math.cos(a);   // radial
    const tx = Math.cos(a), tz = -Math.sin(a);                            // tangent
    // built UPWARD from y 0: the caller hangs it from a parent with scale.y = -1, like every other mirrored copy
    const r = p.r * M, w = p.w * M / 2, y1 = p.h * M;
    const P = [[-w, 0], [w, 0], [w, y1], [-w, y1]].map(([t, y]) => [ux * r + tx * t, y, uz * r + tz * t]);
    pos.push(...P[0], ...P[2], ...P[1], ...P[0], ...P[3], ...P[2]);
    idx.push(n, n + 1, n + 2, n + 3, n + 4, n + 5);
    n += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.userData = { tris: idx.length / 3, piles };
  return g;
}

/** The grass bank ring at the foot of the far pines: a ring segment R0..R1 whose height follows BANK.PROFILE up to H. */
export function bankGeometry(THREE, B = BANK, seg = BANK.SEG) {
  const pos = [], uv = [], idx = [], n = B.PROFILE.length;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < n; j++) {
      const r = (B.R0 + (B.R1 - B.R0) * j / (n - 1)) * M, y = B.PROFILE[j] * B.H * M;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(i / seg, j / (n - 1));
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * n + j, b = a + n, c = b + 1, d = a + 1;
    idx.push(a, d, c, a, c, b);        // wound to face up
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.userData = { tris: idx.length / 3, r: [B.R0, B.R1], h: B.H };
  return g;
}

const BANK_FS = /* glsl */`
  uniform vec3 uBankCol;
  varying vec3 vW; varying vec3 vN;
  ${S.NOISE_GLSL}
  ${S.LIGHT_GLSL}
  void main() {
    vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
    float n1 = noise3(vec3(vW.xz / 360.0, 3.0));
    float streak = 0.5 + 0.5 * sin(dot(vW.xz, vec2(0.8, 0.6)) / 14.0 + 5.0 * n1);   // wind-combed grass stripes
    vec3 base = uBankCol * (0.80 + 0.40 * n1) * (0.90 + 0.18 * streak);
    // nearly unlit: the measured colour IS the lit grass; a gentle sun term only (the 3-band toon step and its blue
    // shade tint would pull a pale green toward grey)
    float sun = 0.90 + 0.14 * clamp(dot(N, uLightDir), 0.0, 1.0);
    gl_FragColor = vec4(base * sun, 1.0);   // no aerial lift: the original has no fog, and the measured colour is the target
    #include <colorspace_fragment>
  }`;
const BANK_VS = /* glsl */`
  varying vec3 vW; varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** One InstancedMesh with every mesh of a species' sector batches merged (same geometry, same instance matrices). */
function mergeInstances(THREE, meshes, material) {
  const total = meshes.reduce((s, m) => s + m.count, 0);
  const mat = new THREE.InstancedBufferAttribute(new Float32Array(total * 16), 16);
  const anyCol = meshes.some((m) => m.instanceColor);
  const col = anyCol ? new THREE.InstancedBufferAttribute(new Float32Array(total * 3).fill(1), 3) : null;
  let k = 0;
  for (const m of meshes) {
    mat.array.set(m.instanceMatrix.array.subarray(0, m.count * 16), k * 16);
    if (col && m.instanceColor) col.array.set(m.instanceColor.array.subarray(0, m.count * 3), k * 3);
    k += m.count;
  }
  const mesh = new THREE.InstancedMesh(meshes[0].geometry, material, total);
  mesh.instanceMatrix = mat;
  if (col) mesh.instanceColor = col;
  mesh.frustumCulled = false;   // one band under the water; culling it per sphere buys nothing and can drop it
  return mesh;
}

// ------------------------------------------------------------------ the module
/** ASSET: the lake's bank and (without water.js's real lake) the faked surface + the mirrored copies of what is BOUND
 *  in the tree / far-pine / boulder slots now (found in the world by their userData; web/built/place/mirror.js
 *  rebuilds this on every swap of those slots). Data: web/built/place/mirror.js. */
export function buildMirror(slot, ctx) {
  const { THREE: T, S: SH, world, materials = [], info = {} } = ctx;
  const D = slot.data, pine = D.pine, rock = D.rock;
  const t0 = performance.now();
  // build-water3: when web/built/water.js built the lake (preset "lake": a real planar reflection), this module keeps only
  // what the shared water cannot do: the grass bank at the foot of the far pines. The faked surface and the mirrored
  // copies below remain the fallback for a build without water.js.
  const REAL = D.real;
  const group = new T.Group(); group.name = "builtLake";
  const meshes = [], out = {}, own = [];

  // ---- the surface: the land's own outline (soil.js), the water outside it
  const land = D.land;
  const lakeGeo = !REAL && land.tris ? lakeGeometry(land) : null;
  own.push(lakeGeo);
  // the water's own colours: linear THREE.Colors made from the sRGB numbers in LAKE (one shared object, so the copies
  // fade toward the SAME water the surface draws)
  const lin = (c) => SH.srgb(c);
  const lakeMid = lin(LAKE.NEAR.map((v, i) => (v + LAKE.FAR[i]) / 2));
  const lakeU = {
    uWN: { value: waterNormalTexture() },
    uLakeNear: { value: lin(LAKE.NEAR) }, uLakeFar: { value: lin(LAKE.FAR) }, uShoreCol: { value: lin(LAKE.SHORE_COL) },
    uFoamCol: { value: lin(LAKE.FOAM_COL) },
    uLakeRep: { value: new T.Vector2(...LAKE.TEX_REPEAT) }, uLakeSlope: { value: new T.Vector2(...LAKE.SLOPE) },
    uSpeedA: { value: new T.Vector2(...LAKE.SPEED[0]) }, uSpeedB: { value: new T.Vector2(...LAKE.SPEED[1]) },
    uLakeD0: { value: LAKE.D0 }, uLakeD1: { value: LAKE.D1 }, uSlopeFar: { value: LAKE.SLOPE_FAR },
    uHeightK: { value: LAKE.HEIGHT_K }, uF0: { value: LAKE.F0 }, uSkyK: { value: LAKE.SKY_K },
    uSpecK: { value: LAKE.SPEC_K }, uSpecPow: { value: LAKE.SPEC_POW }, uShoreK: { value: LAKE.SHORE_K },
    uFoamK: { value: LAKE.FOAM_K }, uLakeAmt: { value: 1 }, uSkySat: { value: LAKE.SKY_SAT }, uSkyDim: { value: LAKE.SKY_DIM },
  };
  const lakeMidU = { value: lakeMid };
  if (lakeGeo) {
    const mat = new T.ShaderMaterial({ uniforms: SH.uniformsWith(lakeU), vertexShader: LAKE_VS, fragmentShader: LAKE_FS,
                                       side: T.DoubleSide, transparent: true, depthWrite: false });
    mat.name = "lake";
    const m = new T.Mesh(lakeGeo, mat);
    m.name = "builtLakeSurface"; m.renderOrder = 5; m.frustumCulled = false;
    m.userData = { kind: "mirror", part: "surface" };
    group.add(m); meshes.push(m); materials.push(mat);
    const le = land.outline.landEnd.filter((v) => v != null);
    out.lake = { tris: lakeGeo.userData.tris, verts: lakeGeo.userData.verts, cols: lakeGeo.userData.cols,
                 rOut: LAKE.R_OUT / M, shoreMin: Math.min(...le) / M, shoreMax: Math.max(...le) / M,
                 y: LAKE.Y / M, colour: { near: LAKE.NEAR, far: LAKE.FAR }, landTris: land.tris };
  }

  // ---- the near ring's copy: the tree module's own meshes, drawn again under a parent with scale.y = -1
  const ring = [];
  world.traverse((o) => { if (o.isInstancedMesh && o.userData?.kind === "foliage" && o.userData.ring) ring.push(o); });
  const leafSrc = ring.map((m) => m.material?.uniforms).find((u) => u?.uLeafTex);
  const leafTex = leafSrc?.uLeafTex.value || null;
  const leafAlpha = leafSrc?.uLeafAlpha?.value ?? 0.4;
  if (!REAL && ring.length) {
    const flip = new T.Group(); flip.name = "builtLakeRing"; flip.scale.y = -1; group.add(flip);
    const bySpecies = new Map();
    for (const m of ring) { const sp = m.userData.species || "ring"; if (!bySpecies.has(sp)) bySpecies.set(sp, []); bySpecies.get(sp).push(m); }
    // the piece each species is built from (trees.js: wall <- cypress_wall, the rest <- cypress_grove)
    const pieceOf = (sp) => D.ringColours[sp === "wall" ? "wall" : "grove"] || null;
    const near = { meshes: 0, tris: 0, instances: 0, species: {} };
    for (const [sp, list] of bySpecies) {
      const cols = pieceOf(sp);
      if (!cols) continue;
      const u = { uTint: { value: reflectColour(cols.all || cols.green) },
                  uAlpha: { value: REFL.ALPHA }, uFadeK: { value: REFL.FADE }, uFadeMax: { value: REFL.FADE_MAX },
                  uAlphaK: { value: REFL.ALPHA_K }, uDeep: { value: 16.24 }, uRipple: { value: REFL.RIPPLE }, uLakeMid: lakeMidU,
                  uLeafTex: { value: leafTex }, uLeafAlpha: { value: leafAlpha } };
      const mat = reflectionMaterial(T, u, sp === "shrub" ? { MIRROR_CARDS: "" } : {});
      mat.name = `lake_${sp}`;
      materials.push(mat);
      const mesh = mergeInstances(T, list, mat);
      mesh.name = `builtLakeRing_${sp}`;
      mesh.renderOrder = 6;
      mesh.userData = { kind: "mirror", part: "ring", species: sp };
      flip.add(mesh); meshes.push(mesh);
      near.meshes++; near.instances += mesh.count;
      near.tris += mesh.count * (list[0].geometry.index ? list[0].geometry.index.count : list[0].geometry.attributes.position.count) / 3;
      near.species[sp] = { instances: mesh.count, geometry: list[0].geometry.index.count / 3 };
    }
    out.ring = near;
  }

  // ---- the far treeline's copy (wall_01): the pines' band, mirrored below the water
  if (pine && !REAL) {
    const u = { uTint: { value: SH.srgb(pine.colours.all) }, uTintLo: { value: SH.srgb(pine.colours.p10 || pine.colours.all) },
                uTintHi: { value: SH.srgb(pine.colours.p90 || pine.colours.all) },
                uAlpha: { value: REFL.ALPHA }, uFadeK: { value: REFL.FADE }, uFadeMax: { value: REFL.FADE_MAX },
                uAlphaK: { value: REFL.ALPHA_K }, uDeep: { value: 7.41 }, uRipple: { value: REFL.RIPPLE }, uLakeMid: lakeMidU,
                uSkyline: { value: new T.Vector2(...REFL.BAND_TOP) } };
    // trees.js's REAL 3D far pines (wall_00, InstancedMesh userData.kind "farPines", one per variant): the SAME geometry
    // and instance matrices drawn again under scale.y = -1 with the washed-out wall_01 tint (reflection material);
    // [build-trees2]. When they are absent: the painted band / the old procedural band below.
    const farInst = [];
    world.traverse((o) => { if (o.isInstancedMesh && o.userData?.kind === "farPines") farInst.push(o); });
    if (farInst.length) {
      const flip = new T.Group(); flip.name = "builtLakeFar"; flip.scale.y = -1; group.add(flip);
      const fu = { uTint: { value: SH.srgb(pine.colours.all) }, uAlpha: { value: REFL.ALPHA }, uFadeK: { value: REFL.FADE },
                   uFadeMax: { value: REFL.FADE_MAX }, uAlphaK: { value: REFL.ALPHA_K }, uDeep: { value: 7.41 }, uRipple: { value: REFL.RIPPLE }, uLakeMid: lakeMidU };
      const fmat = reflectionMaterial(T, fu, {});
      fmat.name = "lake_treeline";
      materials.push(fmat);
      let tris = 0, count = 0;
      for (const src of farInst) {
        const m = mergeInstances(T, [src], fmat);
        m.name = "builtLakeTreeline"; m.renderOrder = 7;
        m.userData = { kind: "mirror", part: "treeline", shared: true, variant: src.userData.variant };
        flip.add(m); meshes.push(m);
        tris += src.count * src.geometry.index.count / 3; count += src.count;
      }
      out.treeline = { tris, r: farInst[0].userData.radius / M, y: [-7.41, 0], skyline: REFL.BAND_TOP, colour: pine.colours.all,
                       src: "trees.js real 3D pines (shared geometry + instances)", shared: true, instances: count, draws: farInst.length };
    } else {
    // trees.js's own painted band (wall_00 "builtFarPines") when it exists: share its geometry, flipped under the
    // water; else the old procedural band (a hand-made 89x8 grid with a noise skyline)
    let farSrc = null;
    world.traverse((o) => { if (!farSrc && o.isMesh && !o.isInstancedMesh && o.name === "builtFarPines") farSrc = o; });
    const shared = !!(farSrc && farSrc.geometry?.attributes?.position);
    if (shared) { u.uBandH = { value: (REFL.BAND_TOP[0] + REFL.BAND_TOP[1]) / 2 }; delete u.uSkyline; }
    const mat = reflectionMaterial(T, u, shared ? { MIRROR_SHARED: "" } : { MIRROR_BAND: "" });
    mat.name = "lake_treeline";
    materials.push(mat);
    const g = shared ? farSrc.geometry : bandGeometry(T, pine);
    if (!shared) own.push(g);
    const m = new T.Mesh(g, mat);
    m.name = "builtLakeTreeline"; m.renderOrder = 7; m.frustumCulled = false;
    m.userData = { kind: "mirror", part: "treeline", shared };
    let target = group;
    if (shared) { target = new T.Group(); target.name = "builtLakeFar"; target.scale.y = -1; group.add(target); }
    target.add(m); meshes.push(m);
    if (shared) {
      const pc = g.attributes.position;
      let hi = 0, r0 = Infinity, r1 = 0;
      for (let i = 0; i < pc.count; i++) { hi = Math.max(hi, pc.getY(i)); const r = Math.hypot(pc.getX(i), pc.getZ(i)); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
      out.treeline = { tris: pc.count / 3, r: r0 / M, y: [-hi / M, 0], skyline: REFL.BAND_TOP, colour: pine.colours.all,
                       src: "trees.js builtFarPines (shared geometry)", shared: true };
    } else {
      out.treeline = { tris: g.userData.tris, r: g.userData.r / M, y: [g.userData.yBot / M, g.userData.yTop / M],
                       skyline: REFL.BAND_TOP, colour: pine.colours.all, src: "wall_01" };
    }
    }
  }

  // ---- the grass bank at the foot of the far pines. Gate by MEASUREMENT, no arena name: the far-pines piece's FOOT
  // picture row is clearly paler/greener than the row above it (meft1008: [98,114,77] vs [23,40,20], luma 3x).
  const fp = D.farPines;
  const rowsFP = fp?.rows || [];
  const foot = rowsFP.length > 2 ? rowsFP[rowsFP.length - 1]?.rgb : null, above = rowsFP.length > 2 ? rowsFP[rowsFP.length - 2]?.rgb : null;
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (foot && above && lum(foot) > 2.0 * lum(above) && foot[1] >= foot[0]) {
    const bg = bankGeometry(T); own.push(bg);
    const bankCol = lin(foot);
    const bm = new T.ShaderMaterial({ uniforms: SH.uniformsWith({ uBankCol: { value: bankCol } }), vertexShader: BANK_VS,
                                      fragmentShader: BANK_FS, side: T.DoubleSide });
    bm.name = "lake_bank"; materials.push(bm);
    const bmesh = new T.Mesh(bg, bm);
    bmesh.name = "builtLakeBank"; bmesh.renderOrder = 4; bmesh.frustumCulled = false;
    bmesh.userData = { kind: "mirror", part: "bank" };
    group.add(bmesh); meshes.push(bmesh);
    // its reflection: the same geometry hung under the water, in the measured reflection tint, faded into the lake
    // (not with the real planar reflection: the water mirrors the bank itself)
    if (!REAL) {
    const ru = { uTint: { value: reflectColour(foot) }, uAlpha: { value: REFL.ALPHA }, uFadeK: { value: REFL.FADE },
                 uFadeMax: { value: REFL.FADE_MAX }, uAlphaK: { value: REFL.ALPHA_K }, uDeep: { value: BANK.H },
                 uRipple: { value: REFL.RIPPLE }, uLakeMid: lakeMidU };
    const rm = reflectionMaterial(T, ru, {}); rm.name = "lake_bank_refl"; materials.push(rm);
    const flipB = new T.Group(); flipB.name = "builtLakeBankFlip"; flipB.scale.y = -1; group.add(flipB);
    const rmesh = new T.Mesh(bg, rm); rmesh.name = "builtLakeBankReflection"; rmesh.renderOrder = 7; rmesh.frustumCulled = false;
    rmesh.userData = { kind: "mirror", part: "bank-reflection" };
    flipB.add(rmesh); meshes.push(rmesh);
    }
    out.bank = { tris: bg.userData.tris, r: bg.userData.r, h: bg.userData.h, colour: foot, rowAbove: above, from: `${fp.name} foot picture row` };
  }

  // ---- the boulder piles' copy (wall_04): the rock module's own mesh if it is there, else the original's two quads
  let rockAdopt = null;
  if (rock && !REAL) {
    const u = { uTint: { value: SH.srgb(rock.colours.all) }, uTintLo: { value: SH.srgb(rock.colours.p10 || rock.colours.all) },
                uTintHi: { value: SH.srgb(rock.colours.p90 || rock.colours.all) },
                uAlpha: { value: REFL.ALPHA }, uFadeK: { value: REFL.FADE }, uFadeMax: { value: REFL.FADE_MAX },
                uAlphaK: { value: REFL.ALPHA_K }, uDeep: { value: 2.24 }, uRipple: { value: REFL.RIPPLE }, uLakeMid: lakeMidU };
    const mat = reflectionMaterial(T, u, {});
    mat.name = "lake_boulders";
    materials.push(mat);
    // the rock module ([rocks]) builds "builtBoulders" (userData.kind "boulder"). It is not in the repo yet, and a
    // layer added after this one in arena-built.js's LAYERS list would not be there at build time either, so the copy
    // is made from the original's own two quads (wall_04) and ADOPTS the rock mesh the first time it shows up.
    const flip = new T.Group(); flip.scale.y = -1; group.add(flip);
    const g0 = pileGeometry(T); own.push(g0);
    const m = new T.Mesh(g0, mat);
    out.boulders = { tris: g0.userData.tris, from: "recipe quads (wall_04)", piles: PILES };
    const findRocks = () => {
      let src = null;
      world.traverse((o) => {
        if (src || !o.isMesh || o.isInstancedMesh) return;   // never the scattered near boulders (they are instanced)
        if (o.name === "builtBoulderPiles" || o.name === "builtBoulders" || o.userData?.kind === "boulder") src = o;
      });
      return src;
    };
    const adopt = () => {
      const src = findRocks();
      if (!src || src.userData.lakeAdopted) return;
      src.userData.lakeAdopted = true;
      m.geometry = src.geometry;
      m.position.copy(src.position); m.quaternion.copy(src.quaternion); m.scale.copy(src.scale);
      out.boulders = { tris: (src.geometry.index?.count ?? src.geometry.attributes.position.count) / 3, from: "rocks module (builtBoulders)" };
    };
    adopt();
    rockAdopt = adopt;
    m.name = "builtLakeBoulders"; m.renderOrder = 8; m.frustumCulled = false;
    m.userData = { kind: "mirror", part: "boulders" };
    flip.add(m); meshes.push(m);
  }

  out.mode = REAL ? "bank only: the reflection is water.js's planar reflection" : "faked surface + mirrored copies (no water.js lake)";
  out.group = group.name; out.meshes = meshes.length;
  out.triangles = meshes.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1), 0);
  out.buildMs = Math.round(performance.now() - t0);
  out.colour = { lakeNear: LAKE.NEAR, lakeFar: LAKE.FAR, bg: D.bg };
  info.mirror = out;

  let visible = true;
  return {
    objects: [group], meshes,
    dispose() { for (const g of own) g?.dispose?.(); },   // only the geometry made here (the copies share the bound meshes')
    info: out,
    // the checker's handles: the surface mesh, the mirrored copies, and the probe for their measured colour
    lake: meshes.find((m) => m.userData.part === "surface") || null,
    reflections: meshes.filter((m) => m.userData.part !== "surface" && m.userData.part !== "bank"),
    probeMaterial: (mesh, cols, rows) => mirrorProbeMaterial(mesh.material.uniforms, cols, rows),
    update(camera, ms) {   // nothing per frame (the ripple rides the shared uWindTime); only the rock hand-off waits
      if (rockAdopt) { rockAdopt(); rockAdopt = null; }
    },
    setVisible(v) { visible = v; for (const m of meshes) m.visible = v; return visible; },
    place(state) {   // report only; also the one moment a late-loading rock module can hand its mesh over
      if (rockAdopt) { rockAdopt(); rockAdopt = null; }
      out.keepOutTouching = 0; out.keepOutFightR = Math.round(state?.fightR ?? 0);
    },
  };
}
