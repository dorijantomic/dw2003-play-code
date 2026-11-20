// WATER + SEA of the BUILT arena look (Arena Viewer look=built only; beach arenas, meft1002 South Cape / Shell
// Beach). Recipe kinds (tools/arena_built_recipe.py): water = floor_02/03/04, sea = floor_05.
//
// THE MEASURED GAP THIS FIXES (forensics on the viewer camera at 960x720, 12 azimuths, 2026-10-30): the recipe's water
// is four upright PICTURE CARDS standing at r 5593-10041 with their picture tops at y 0 and bottoms at y -1193 — a
// painted backdrop, not a surface. The sand's own outer edge is at r 2480-4913 (rec.beach bins), so between the two
// there was no triangle at all: measured over the viewer camera, 85-96 % of the below-horizon half of the screen was
// the sky dome's violet-blue (task: "3-10 %"; the real share is worse). This module now builds a SEA SURFACE at
// y SEA_Y from the sand's own edge out to r 48000 (120 m) and a HORIZON BAND at r 48500 that meets the sky, so the
// sand meets water everywhere and the far sea meets the sky. Measured before/after: tools/verify_built_water.mjs.
//
// ONE SOURCE OF TRUTH FOR THE WATERLINE. shoreField(rec) bakes, once per recipe, a signed distance field to the LAND's
// own outline (land = the sand piece + the shore piece; rasterise their triangles -> exact euclidean distance
// transform, Felzenszwalb 1982) over a 1024^2, +-16000 unit map, and the same outline gives the sea's inner ring. The
// sea, the swash, the foam edge and the sand's wet band all read that one field through SHORE_GLSL (exported here and
// imported by sand.js), so the foam cannot sit anywhere but on the sand's wet band — the Ultra-Water pattern the
// report asks for (water.md 5, rule 2). Measured on meft1002 (2026-10-30): the land's outline is one loop of 38 edges,
// one crossing per direction, and the waterline (256 sectors, 3-tap blur) is within 12 units of it at every 10 deg.
//
// THE BEACH-WIDE DARKENING (user, 2026-10-30: "as the waves move they poke through the sand and darken it across the
// beach"). Cause, measured: the first port of Ultra-Water's swash() left out its two gate lines (`if (hgt > R) return
// (0, 0, 0.5 * smoothstep(1.5R, R, hgt))` and the early-out). Without them every sand pixel farther inland than the
// run-up got sPass = RISE and wet = exp(-dry / 5 s), dry 0..6.4 s, i.e. a wetness cycling 0.28 .. 1 everywhere, moved
// by the swash's 2.5 m / 0.9 m phase noise: 100 % of the sand samples were wet > 0.05, mean wetness 0.60, reaching
// 5.7-7.6 m inland (the whole sand, to the centre), and the sand's albedo was multiplied by 0.61-0.89 in moving
// patches. Now: the gate is back (wetness 0 beyond 1.5 R), the run-up and the damp band are thin (WATER below), and the
// sand's edge against the grass BANK (meft1002 az -150 .. -35, the shore piece) is not a water edge at all
// (beachOpen()), so nothing gets wet there. tools/verify_built_water.mjs measures the reach per direction.
//
// THE STRIPES AND THE RESET (user, 2026-10-30: "weird different color lines" across the sea, violet toward the
// horizon; "the wave reaches the beach and snaps back"). Measured from the viewer camera, open sea, 6 directions
// (tools/verify_built_water.mjs 10 + 11). Stripes: the reflection on the wave normals. At the grazing angle the
// fresnel is 0.6-1 and a crest a few rows apart tipped the reflected ray between the sky and the violet haze under
// the horizon; with the shading terms switched off one by one, the body alone was smooth and the reflection on waves
// made the bands (row-mean jumps up to 76 /255, a row up to 88 /255 off the gradient). Smaller: the straight-line depth
// ramp's kinks at its 8 stops (8.6 /255) and the baked field's square edge at +-16000 (the depth stopped growing).
// Fixed: the wave octaves band-limited by footprint (BAND_LO/HI), the reflected ray folded above the horizon, a
// monotone cubic ramp, the distance grown past the square: now a row is at most 2.8 /255 off the gradient. Reset:
// the bore line vanished at full strength when its phase wrapped (a 1.0 jump in one frame), the lace switched
// noises with fract(t) (0.65), the swash edge was cut at s 0.35 and popped on at the wrap (1.0), the wetness jumped
// 0.64 at the gate. All are continuous now: the largest change between two frames is 0.16 (a moving front).
//
// WHAT FOLLOWS THE RECIPE (water.md 5, steps 1-7):
//   1 baked shore distance + bed      shoreField(): one 1024^2 half-float map, 0 runtime cost, 1 tap per pixel
//   2 depth-graded body colour        T = exp(-ABSORB * depth_m); body = seaRamp(1 - T), the sea piece's own 8
//                                     measured picture rows (near turquoise -> far deep blue), with the sand bed
//                                     showing through as T^2 (daniel shervheim, BSD-3, `Stylized Water.shader` lines
//                                     268-294 — the formula only: lerp(deep, shallow * bed, T))
//   3 swash up the sand and back      swash() = Ultra-Water's own maths (Humpalumps/Ultra-Water, MIT,
//                                     src/water/OceanSurface.js lines 88-104): a 30 % rise / 70 % drain per period,
//                                     run-up R, phase noise, and the wetness out.
//   4 moving foam edge + lace         the swash front's band (Ultra-Water) on the sand; on the sea a broken-wave BORE
//                                     line that runs in from SURF_W to the waterline once per swash period and arrives
//                                     as the run-up starts (Cyanilux's phase-lock rule: one swash per incoming wave);
//                                     + noise lace scrolled in two phases crossfaded (three.js Water2's flowLerp idea)
//   5 wet sand from the SAME wetness  sand.js reads sandWater() (here): film, foam edge, wetness, already gated to
//                                     the thin band (WaterThreeJS, MIT, src/Island.js lines 99-124; Jensen 1999)
//   6 sparkle                         one fixed-cell noise, contrast faded by the pixel footprint while its mean is
//                                     kept (sand.md C6c + C8), gated by the sun/moon specular lobe
//   7 horizon fade into the sky       aerial() (shared) + an explicit fade to skyRadiance() over the last 60 % of the
//                                     sea's reach; the horizon band IS skyRadiance(), so the join is exact
//   reflection                        Schlick fresnel (F0 0.02) toward the sky's own radiance at the reflected ray —
//                                     the shared skyRadiance(), so the sea mirrors the sky the dome draws (day or night)
//
// The light is the SHARED one (shared.js toonLight / LIGHT_GLSL): the body is lit by the sun by day and the moon by
// night, the specular uses uLightColor, the haze is aerial(). Nothing here knows about day or night.
//
// UNITS: render space, 400 units = 1 m (shared.js UNITS_PER_M), floor y 0. Every metre number below is written as
// `<metres> * M` once, here, and the GLSL converts a distance to metres once (D / M) where a formula is metric.
//
// VALUES MEASURED FROM THE RECIPE (meft1002.json, tools/arena_built_recipe.py; sRGB 0-255):
//   RAMP      sea floor_05 rows 7 .. 0     [81,231,225] near ... [7,16,146] far: the depth ramp, stop for stop
//   DEEP      sea floor_05 p10            [8, 19, 147]   the picture's far/top row (deep blue)
//   SHALLOW   water floor_02..05 row 7    their near rows (turquoise) - averaged
//   FOAM      floor_02..05 p90 mean lifted 0.55 toward white
//   BED       sand floor_01 p90           [221, 221, 204]  what shows through the shallow water
//   waterline the land's (sand + shore) own outline: 2474 .. 4879 units from the centre (rec.beach sandRmax agrees)
// VALUES PICKED (not measured), the look knobs, all in WATER below (metres x M):
//   THE THIN BAND: RUNUP 0.6 m (R = 0.47 .. 0.74 m with SET_K), wetness gate 1.5 R (Ultra-Water) = at most 1.10 m
//   inland, DAMP 0.4 m (the always-damp strip at the waterline), so NOTHING is wet more than WET_MAX = 1.10 m (441
//   units) inland of the real edge; the bank (shore piece) side never.
//   ABSORB 0.25 /m, BED_SLOPE 0.5 (depth = 0.5 x the distance offshore), BED_K 0.35, SEA_Y -3 units, FAR_R 120 m,
//   BAND 121.25 m tall enough to cover the horizon from any arena eye, SECTORS 256, RINGS 9, OVERLAP 0.65 m,
//   PERIOD 6.4 s, RISE 0.30 (Ultra-Water's 30/70), WET_TAU 5 s (Ultra-Water), FOAM_W 0.22 m, SURF_W 4.5 m, BORE_W 0.35 m,
//   FOAM_RANGE 5.5 m, LACE 1.1 m, REFL_K 0.85, SPEC_POW 700, SPEC_K 1.6, GLINT 1.4, SPARK 0.028 m cell,
//   CHOP (three wave slopes) 0.055 / 0.045 / 0.03 at 7.5 m / 3.1 m / 1.15 m.
import * as THREE from "../lib3d/three.module.js";
import * as S from "./shared.js";
import { soilLand } from "./soil.js";

const M = S.UNITS_PER_M;   // 400

export const WATER = {
  // ---- where the sea is ----
  SEA_Y: -3,                     // units: the surface, 7.5 mm under the arena floor (no z-fight with the sand's rim)
  FAR_R: 120 * M,                // 48000 units: the sea's outer edge, inside the built camera's far clip (60000)
  BAND_R: 121.25 * M,            // 48500 units: the horizon band's radius
  BAND_Y: [-10 * M, 5 * M],      // the band's height range: covers the horizon from any eye the arena uses
  SECTORS: 256, RINGS: 9,        // the sea's polar grid: 256 x 8 = 2048 quads = 4096 triangles (256 = the waterline's own)
  BAND_SEGS: 128, BAND_ROWS: 3,
  OVERLAP: 0.65 * M,             // the sea tucks this far under the land's own edge, so no seam can open
  POLY_OFFSET: [1, 4],           // the sea's depth pushed back (factor, units): under the land it can never z-fight up
  // ---- colour (the recipe's own measured anchors; anchors() fills these from the recipe) ----
  ABSORB: 0.25,                  // Beer-Lambert per metre of depth: turquoise for the first ~4 m out, deep past ~15 m
  BED_SLOPE: 0.5,                // depth_m = 0.5 x the distance offshore in m
  BED_K: 0.35,                   // how much of the sand bed shows through the shallowest water (x T^2)
  SHALLOW_K: 1.0,
  // ---- the swash: THE THIN BAND at the real edge (metres / seconds; Ultra-Water's numbers, retuned) ----
  RUNUP: 0.6 * M,                // 240 units: the mean run-up; R = RUNUP x (1 +- SET_K/2) = 0.47 .. 0.74 m
  DAMP: 0.4 * M,                 // 160 units: the always-damp strip just above the waterline
  PERIOD: 6.4,                   // s: one up-and-back
  RISE: 0.30,                    // share of the period spent running up (Ultra-Water: 0.3)
  WET_TAU: 5.0,                  // s: the wetness left behind dries as exp(-t / 5) (Ultra-Water)
  PHASE1: 1 / (2.5 * M),         // 1/unit: the swash's raggedness, 2.5 m and 0.9 m wavelengths
  PHASE2: 1 / (0.9 * M),
  PHASE_SLOW: 0.5,               // of a period: the slow part of the swash's phase (one 10 m noise)
  RAG: 0.1,                      // of a period, either way: its ragged part (the 2.5 m + 0.9 m noises)
  RAG_FADE: 1.5 * M,             // 600 units: the bore keeps the ragged part only this near the waterline
  SET_K: 0.45,                   // how much the run-up varies set to set
  OPEN_W: 0.4 * M,               // the beach/bank switch: sea within this much of the bank (not the sand) gets no surf
  SOFT_FRONT: 0.1 * M,           // 40 units: the run-up front's soft width (foam edge + wetness), so it moves ~0.15 a frame
  // ---- foam ----
  FOAM_W: 0.22 * M,              // 88 units: the band at the moving water's edge (Ultra-Water's 5 cm x ours)
  SURF_W: 4.5 * M,               // 1800 units: where the bore (the incoming broken wave's foam line) starts out
  BORE_W: 0.35 * M,              // 140 units: the bore line's half-width at the shore (narrower far out)
  FOAM_RANGE: 5.5 * M,           // 2200 units: how far offshore the lace reaches
  LACE: 1.1 * M,                 // 440 units: the lace's cell
  LACE_K: 0.62,                  // the lace's coverage threshold
  // ---- water surface ----
  W1: 7.5 * M, W2: 3.1 * M, W3: 1.15 * M,     // wavelengths, units (30 m, 12.4 m, 4.6 m)
  S1: 0.55, S2: 0.9, S3: 1.7,                 // rad/s
  CHOP1: 0.055, CHOP2: 0.045, CHOP3: 0.030,   // slopes (2 pi a / lambda)
  BAND_LO: 12, BAND_HI: 48,      // a wave octave fades from full (wavelength >= 48 pixel footprints) to 0 (<= 12):
                                 // measured on the open sea, 4/16 left rows 18.6 /255 off the gradient, 8/32 8.7,
                                 // 12/48 = the flat sea's own 4.3 (no wave stripes left)
  REFL_K: 0.85,                  // share of the Schlick fresnel that is taken
  SPEC_POW: 700, SPEC_K: 1.6,    // the sun/moon glint
  GLINT: 1.4, GLINT_CELL: 0.028 * M, GLINT_K: 0.6,   // the sparkle cells: 11 units = 2.8 cm
  HFADE0: 0.35, HFADE1: 1.0,     // the horizon fade, as shares of FAR_R
  ROWS: 8,
};
/** The farthest inland anything can be wet (units): the gate 1.5 x the largest run-up, or the damp strip. */
export const WET_MAX = Math.max(1.5 * WATER.RUNUP * (1 + WATER.SET_K / 2), WATER.DAMP);

export const SHORE = {
  SIZE: 1024,          // the baked field: texels per side
  SPAN: 16000,         // units: covers [-SPAN, SPAN]^2 = 40 m, the near shore (the far sea is deep there already)
  SECTORS: 256,        // the waterline polygon's resolution
  SMOOTH_N: 1440,      // the SMOOTH waterline's samples (one per 0.25 deg: 20 units of arc at r 4600)
  SMOOTH: 400,         // units: its Gaussian width along the shore (1 m); see smoothWaterline()
  EXACT: 640,          // units: within this of the smooth line the distance is exact (to the curve), past it the EDT
};

// ---------------- the bake: ONE waterline, ONE distance field ----------------
const key2 = (x, z) => `${x.toFixed(3)},${z.toFixed(3)}`;

/** The sand piece's boundary in XZ: every triangle edge used by exactly one triangle of the piece. */
export function sandOutline(pos) {
  const at = new Map();
  for (let t = 0; t < pos.length / 9; t++) {
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const ax = pos[t * 9 + i * 3], az = pos[t * 9 + i * 3 + 2];
      const bx = pos[t * 9 + j * 3], bz = pos[t * 9 + j * 3 + 2];
      const ka = key2(ax, az), kb = key2(bx, bz), k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = at.get(k);
      if (e) e.n++; else at.set(k, { a: [ax, az], b: [bx, bz], n: 1 });
    }
  }
  return [...at.values()].filter((e) => e.n === 1).map((e) => ({ a: e.a, b: e.b }));
}

/** The waterline's radius per azimuth (radians, az = atan2(x, z)), ray-cast off the sand's own outline: the
 *  OUTERMOST crossing of the ray from the arena centre. Smoothed once round the circle (a 3-tap blur) so the sea's
 *  inner ring cannot spike; returns { r: Float32Array(N), az: Float32Array(N) }. */
export function waterline(outline, n = SHORE.SECTORS) {
  const r = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 - Math.PI;
    const dx = Math.sin(a), dz = Math.cos(a);      // az = atan2(x, z): x = sin, z = cos
    let best = 0;
    for (const s of outline) {
      const ex = s.b[0] - s.a[0], ez = s.b[1] - s.a[1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (s.a[0] * ez - s.a[1] * ex) / den;               // ray parameter (origin at 0,0)
      const u = (s.a[0] * dz - s.a[1] * dx) / den;               // segment parameter
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
    }
    r[k] = best;
  }
  // one circular 3-tap blur: the ray's outermost crossing can jump between two outline points of the same bay
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = (r[(k + n - 1) % n] + 2 * r[k] + r[(k + 1) % n]) / 4;
  return { r: out, az: Float32Array.from({ length: n }, (_, k) => (k / n) * Math.PI * 2 - Math.PI) };
}

/** THE SMOOTH WATERLINE (user, 2026-10-30, free camera at the shore: "the waterline follows the sand's old hard
 *  edge: straight segments and sharp corners"; measured: the land outline is 40 straight edges of 425-1002 units
 *  turning by up to 46 deg at a vertex, and every wet / swash / foam contour of the old distance field repeated those
 *  corners inland). The land's radius per direction (the outermost crossing, SMOOTH_N directions) is smoothed with a
 *  Gaussian SMOOTH units wide ALONG THE SHORE, then moved inland wherever it came out seaward of the land edge (a
 *  window maximum of that excess, smoothed again), so the smooth line is never on the sea side of the sand: the sand
 *  seaward of it is drawn as covered by the water (swash(), d < 0), and no old edge is left between wet and dry.
 *  Returns { r, az, n, sigma, raw, dev: { max, mean }, clamped } (dev = land radius - smooth radius, units). */
export function smoothWaterline(outline, P = SHORE) {
  const n = P.SMOOTH_N, raw = new Float64Array(n), az = new Float32Array(n), da = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    const a = k * da - Math.PI, dx = Math.sin(a), dz = Math.cos(a); az[k] = a;
    let best = 0;
    for (const e of outline) {
      const ex = e.b[0] - e.a[0], ez = e.b[1] - e.a[1], den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (e.a[0] * ez - e.a[1] * ex) / den, u = (e.a[0] * dz - e.a[1] * dx) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
    }
    raw[k] = best;
  }
  const sig = P.SMOOTH;
  const gauss = (v, width) => {               // circular Gaussian in arc length (units) at each sample's own radius
    const o = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const K = Math.min(n >> 1, Math.ceil((3 * width) / Math.max(raw[k] * da, 1)));
      let sw = 0, sv = 0;
      for (let j = -K; j <= K; j++) { const x = j * da * raw[k], w = Math.exp(-(x * x) / (2 * width * width)); sw += w; sv += w * v[(k + j + n) % n]; }
      o[k] = sv / sw;
    }
    return o;
  };
  const g = gauss(raw, sig), sh = new Float64Array(n), ex = new Float64Array(n), m = new Float64Array(n);
  for (let it = 0; it < 6; it++) {           // the excess seaward of the land edge, removed smoothly (a few rounds)
    let any = 0;
    for (let k = 0; k < n; k++) { ex[k] = Math.max(0, g[k] - sh[k] - raw[k]); any = Math.max(any, ex[k]); }
    if (any < 0.5) break;
    for (let k = 0; k < n; k++) {
      const K = Math.ceil((2 * sig) / Math.max(raw[k] * da, 1));
      let v = 0; for (let j = -K; j <= K; j++) v = Math.max(v, ex[(k + j + n) % n]);
      m[k] = v;
    }
    const add = gauss(m, sig);
    for (let k = 0; k < n; k++) sh[k] += add[k];
  }
  const r = new Float32Array(n);
  let clamped = 0, dmax = 0, dsum = 0;
  for (let k = 0; k < n; k++) {
    let v = g[k] - sh[k];
    if (v > raw[k]) { v = raw[k]; clamped++; }
    r[k] = v; dmax = Math.max(dmax, raw[k] - v); dsum += raw[k] - v;
  }
  return { r, az, n, sigma: sig, raw: Float32Array.from(raw), dev: { max: Math.round(dmax), mean: Math.round(dsum / n) }, clamped };
}

/** The smooth waterline's radius at an azimuth (radians, az = atan2(x, z)), linear between its samples. */
export function smoothWaterlineAt(sm, az) {
  const TWO = Math.PI * 2, a = ((az + Math.PI) % TWO + TWO) % TWO;
  const u = (a / TWO) * sm.n, i = Math.floor(u) % sm.n, j = (i + 1) % sm.n, f = u - Math.floor(u);
  return sm.r[i] + (sm.r[j] - sm.r[i]) * f;
}

/** Exact euclidean distance transform of a binary grid (Felzenszwalb & Huttenlocher 1982, the 1D lower envelope,
 *  run on every row and then every column). zero = the texels the distance is measured FROM. Squared texels out. */
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt2d(zero, size) {
  const g = new Float32Array(size * size);
  const INF = 1e20;
  for (let i = 0; i < size * size; i++) g[i] = zero[i] ? 0 : INF;
  const n = Math.max(size, 2), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) f[x] = g[y * size + x];
    edt1d(f, size, d, v, z);
    for (let x = 0; x < size; x++) g[y * size + x] = d[x];
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) f[y] = g[y * size + x];
    edt1d(f, size, d, v, z);
    for (let y = 0; y < size; y++) g[y * size + x] = d[y];
  }
  return g;
}

/** Rasterise a piece's triangles into a mask (texel centre inside a triangle's XZ footprint). */
function rasterise(pos, mask, size, span, upx) {
  for (let t = 0; t < pos.length / 9; t++) {
      const xs = [pos[t * 9], pos[t * 9 + 3], pos[t * 9 + 6]], zs = [pos[t * 9 + 2], pos[t * 9 + 5], pos[t * 9 + 8]];
      const i0 = Math.max(0, Math.floor((Math.min(...xs) + span) / upx)), i1 = Math.min(size - 1, Math.ceil((Math.max(...xs) + span) / upx));
      const j0 = Math.max(0, Math.floor((Math.min(...zs) + span) / upx)), j1 = Math.min(size - 1, Math.ceil((Math.max(...zs) + span) / upx));
      const x0 = xs[0], z0 = zs[0], x1 = xs[1] - x0, z1 = zs[1] - z0, x2 = xs[2] - x0, z2 = zs[2] - z0;
      const den = x1 * z2 - x2 * z1;
      if (Math.abs(den) < 1e-12) continue;
      for (let j = j0; j <= j1; j++) {
        const pz = (j + 0.5) * upx - span - z0;
        for (let i = i0; i <= i1; i++) {
          const px = (i + 0.5) * upx - span - x0;
          const v = (px * z2 - x2 * pz) / den, w = (x1 * pz - px * z1) / den;
          if (v >= -1e-9 && w >= -1e-9 && v + w <= 1 + 1e-9) mask[j * size + i] = 1;
        }
      }
  }
}

/** The bake. LAND = the sand piece + the shore piece (the grass bank behind the sand on meft1002): the waterline is
 *  the land's outer edge, so where the bank stands between the sand and the sea the sand's own edge is NOT a water edge.
 *  RGBA half float, units:  R = signed distance to the land's edge (+ inland, - at sea)
 *                           G = 1 on the sand (bilinear: fractional along its border)
 *                           B = distance to the nearest SAND texel (0 on the sand)
 *                           A = distance to the nearest SHORE (bank) texel (0 on the bank; SPAN x 4 if no bank) */
function bakeShore(rec) {
  const t0 = performance.now();
  const sand = (rec.pieces || []).find((p) => p.kind === "sand");
  const banks = (rec.pieces || []).filter((p) => p.kind === "shore" && p.pos);
  const P = SHORE, size = P.SIZE, span = P.SPAN, upx = (2 * span) / size, N = size * size;
  const onSand = new Uint8Array(N), onBank = new Uint8Array(N), inside = new Uint8Array(N);
  if (sand && sand.pos) rasterise(sand.pos, onSand, size, span, upx);
  for (const b of banks) rasterise(b.pos, onBank, size, span, upx);
  for (let i = 0; i < N; i++) inside[i] = onSand[i] | onBank[i];
  // R is the distance to the SMOOTH waterline (smoothWaterline()), not to the outline's straight edges: "land" for R
  // is every texel inside that curve. G, B and A keep the pieces' own rasters (which piece a texel is on).
  const landPos = [...(sand?.pos || []), ...banks.flatMap((b) => b.pos)];
  const outline = landPos.length ? sandOutline(landPos) : [];
  const sm = outline.length ? smoothWaterline(outline) : null;
  const wet = new Uint8Array(N);          // inside the smooth line
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + 0.5) * upx - span, z = (j + 0.5) * upx - span;
    wet[j * size + i] = sm ? (Math.hypot(x, z) < smoothWaterlineAt(sm, Math.atan2(x, z)) ? 1 : 0) : inside[j * size + i];
  }
  const outside = new Uint8Array(N);
  for (let i = 0; i < N; i++) outside[i] = wet[i] ? 0 : 1;
  const dOut = edt2d(outside, size);      // for inside texels: distance to the nearest outside texel
  const dIn = edt2d(wet, size);           // for outside texels: distance to the nearest inside texel
  // near the line, the EXACT distance to the curve (the raster's 0.5-texel staircase would wiggle every contour of
  // the swash band by +-16 units); blended into the EDT between 0.75 and 1 x EXACT
  const ptsX = sm ? Float64Array.from(sm.r, (r, k) => Math.sin(sm.az[k]) * r) : null;
  const ptsZ = sm ? Float64Array.from(sm.r, (r, k) => Math.cos(sm.az[k]) * r) : null;
  const exactAt = (x, z, de) => {
    const rho = Math.hypot(x, z), a = Math.atan2(x, z), n = sm.n, da = (Math.PI * 2) / n;
    const win = Math.min(n >> 1, Math.ceil(Math.asin(Math.min(1, (Math.abs(de) + 2 * upx) / Math.max(rho, 1))) / da) + 2);
    const k0 = Math.floor((a + Math.PI) / da);
    let best = Infinity;
    for (let j = -win; j <= win; j++) {
      const p = ((k0 + j) % n + n) % n, q = (p + 1) % n;
      const ax = ptsX[p], az = ptsZ[p], bx = ptsX[q] - ax, bz = ptsZ[q] - az, l2 = bx * bx + bz * bz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2)) : 0;
      const dx = x - ax - t * bx, dz = z - az - t * bz, dd = dx * dx + dz * dz;
      if (dd < best) best = dd;
    }
    return Math.sqrt(best);
  };
  const dSand = edt2d(onSand, size);      // every texel: distance to the nearest sand texel
  const dBank = banks.length ? edt2d(onBank, size) : null;
  const half = new Uint16Array(N * 4);
  const toHalf = THREE.DataUtils?.toHalfFloat || ((v) => v);
  for (let i = 0; i < N; i++) {
    // texel centres are 0.5 texel inside the boundary the raster put between the two classes
    let d = (wet[i] ? Math.sqrt(dOut[i]) - 0.5 : -(Math.sqrt(dIn[i]) - 0.5)) * upx;
    if (sm && Math.abs(d) < SHORE.EXACT) {
      const x = ((i % size) + 0.5) * upx - span, z = (Math.floor(i / size) + 0.5) * upx - span;
      const de = (wet[i] ? 1 : -1) * exactAt(x, z, d), b = Math.abs(d) / SHORE.EXACT, w = b < 0.75 ? 0 : (b - 0.75) / 0.25;
      d = de + (d - de) * w * w * (3 - 2 * w);
    }
    half[i * 4] = toHalf(d);                                               // R: signed distance to the smooth line, + inland
    half[i * 4 + 1] = toHalf(onSand[i]);                                   // G: 1 on the sand
    half[i * 4 + 2] = toHalf(Math.sqrt(dSand[i]) * upx);                   // B: distance to the sand
    half[i * 4 + 3] = toHalf(dBank ? Math.sqrt(dBank[i]) * upx : 4 * span); // A: distance to the bank
  }
  const tex = new THREE.DataTexture(half, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const wl = waterline(outline);
  return { tex, span, size, outline, wl, smooth: sm, sand: sand?.name || null, banks: banks.map((b) => b.name), inside, onSand, onBank,
           ms: Math.round(performance.now() - t0) };
}

let FIELD = null;
/** The one shore field for a recipe (built on the first call, shared by the sand and the water after it). */
export function shoreField(rec) {
  if (!FIELD || FIELD.rec !== rec) FIELD = { rec, ...bakeShore(rec) };
  return FIELD;
}

/** The waterline radius at an azimuth (radians, az = atan2(x, z)) — the JS twin of the shader's own lookup, used by
 *  the sea's inner ring and by the checkers. */
export function waterlineAt(field, az) {
  const { r, az: A } = field.wl, n = r.length;
  const TWO = Math.PI * 2, a = ((az + Math.PI) % TWO + TWO) % TWO - Math.PI;   // [-pi, pi)
  const u = (a + Math.PI) / TWO * n;
  const i = Math.floor(u) % n, j = (i + 1) % n, f = u - Math.floor(u);
  const s = f * f * (3 - 2 * f);                                             // smooth, so the ring has no corners
  return r[i] + (r[j] - r[i]) * s;
}

// ---------------- the shared GLSL: the waterline, the swash, the wetness ----------------
// Imported by sand.js as well: the sand's wet band, the swash film and its foam are the SAME numbers the sea reads.
// GLSL ES 1.00 (varying / texture2D / gl_FragColor), as every source in the report is written.
export const SHORE_GLSL = /* glsl */`
  uniform sampler2D uShore;      // R = signed distance to the waterline, units (+ inland), half float
  uniform float uShoreSpan;      // the baked map's half-width, units
  uniform float uSeaY;           // the sea surface's y, units
  uniform float uTime;           // seconds (the shared wind clock)
  uniform float uRunup, uPeriod, uRise, uWetTau, uPhase1, uPhase2, uSetK, uDamp, uOpenW;
  uniform float uFoamW, uFoamRange, uLace, uLaceK, uSoftFront;

  // the baked field (one bilinear tap): r = distance to the waterline (+ on land, - at sea), g = on the sand,
  // b = distance to the sand, a = distance to the bank
  // Past the baked square (|x| or |z| > uShoreSpan) the clamped texture would hold the edge texel's distance, so the
  // far sea's depth stopped growing at the square's edge and its colour showed the square as a faint line (measured
  // 2026-10-30: the body 12,22,148 inside vs 7,17,146 past it). The distance now keeps growing past the square.
  vec4 shoreTap(vec2 xz) {
    vec4 s = texture2D(uShore, (xz + uShoreSpan) / (2.0 * uShoreSpan));
    s.r -= max(max(abs(xz.x), abs(xz.y)) - uShoreSpan, 0.0);
    return s;
  }
  float shoreDist(vec2 xz) { return shoreTap(xz).r; }
  // 1 where the nearest water edge is a BEACH (the sand meets the sea), 0 where it is the grass bank (the shore
  // piece): on land, a sand pixel whose bank is no nearer than the sea; at sea, a pixel whose nearest land is sand
  float beachOpen(vec4 s) {
    // g is the bilinear sand mask: 0.5 on the texel that holds the waterline, so the wetness dropped there to about half
    // (measured 2026-10-30: a lighter strip 0-40 units inland on every beach ray, wetness 0.46 below the band behind it)
    if (s.r > 0.0) return clamp(s.g * 2.0, 0.0, 1.0) * smoothstep(1.0, 1.5, s.a / max(s.r, 1.0));
    return 1.0 - smoothstep(uOpenW * 0.25, uOpenW, s.b + s.r);
  }

  // THE FOOT ON THE WATERLINE: the point of the waterline nearest xz (xz moved along the distance's gradient by d).
  // Every swash / bore number is read at the foot, so it is the same all along one line across the shore. Measured
  // 2026-10-30: read at xz itself, the phase changed along the way out to sea (its 0.9 m noise), so the bore's
  // place (SURF_W x (1 - s)) was met at up to 5 distances on one ray at once: 2-5 parallel foam lines (user: "several
  // thin parallel white lines").
  vec2 shoreFoot(vec2 xz, float d) {
    const float e = 32.0;                                   // ~1 baked texel (32000 / 1024 = 31 units)
    vec2 g = vec2(shoreTap(xz + vec2(e, 0.0)).r - shoreTap(xz - vec2(e, 0.0)).r, shoreTap(xz + vec2(0.0, e)).r - shoreTap(xz - vec2(0.0, e)).r);
    return xz - d * g / max(length(g), 1e-4);             // the gradient points inland (+ d)
  }
  // THE SWASH'S PHASE over the beach = a SLOW part (the wave reaches one stretch of beach a little before the next,
  // one noise 10 m long, PHASE_SLOW of a period) + the RAGGED part (Ultra-Water's 2.5 m and 0.9 m noises, RAG of a
  // period either way). Measured 2026-10-30: with the ragged part at its old full size (0.66 + 0.34 of a period) the
  // phase changed by up to a whole period over 1-2 m of shore and of sea, so the bore broke into short pieces at
  // different distances (2-3 bore lines across the shore at once) and the swash edge into staggered steps.
  float swashSlow(vec2 xz) { return 6.2831853 * ${WATER.PHASE_SLOW.toFixed(3)} * noise3(vec3(xz * uPhase1 * 0.25, 0.61)); }
  float swashRag(vec2 xz) {
    float a = noise3(vec3(xz * uPhase1, 0.61));
    float b = noise3(vec3(xz * uPhase2, 3.17));
    return 6.2831853 * ${WATER.RAG.toFixed(3)} * (2.0 * (0.66 * a + 0.34 * b) - 1.0);
  }
  float swashPhase(vec2 xz, float t) { return swashSlow(xz) + swashRag(xz) + t * 0.0; }
  // the bore's: the slow part where it is, the ragged part of its foot only near the waterline (fading out to sea over
  // RAG_FADE), so across the shore the bore's place SURF_W x (1 - s) is met once (its slope along the way < 1)
  float borePhase(vec2 xz, float off) {
    return swashSlow(xz) + swashRag(shoreFoot(xz, -off)) * (1.0 - smoothstep(0.0, ${WATER.RAG_FADE.toFixed(1)}, off));
  }
  // THE WATERLINE BAND FOLLOWS THE WAVE (user, 2026-10-30: "several thin parallel white lines"; measured: the band at
  // the waterline was always at >= 0.72, so whenever the swash edge was up the beach or the bore was out at sea there
  // were 2-3 white lines across the shore at once). It is now bright only while the wave arrives (the bore reaching
  // the waterline, s 0.72 .. 1) and as the run-up leaves it (s 0 .. 0.2), and a faint 0.2 in between: one line moves
  // in (the bore), turns into the band and runs up the sand (the swash edge). Continuous through the wrap (1 at s = 1
  // and at s = 0).
  float waveArrive(vec2 xz, float d, float t) {
    float s = fract((6.2831853 / uPeriod * t + swashPhase(shoreFoot(xz, d), t)) / 6.2831853);
    return mix(0.2, 1.0, max(smoothstep(0.72, 0.92, s), 1.0 - smoothstep(0.0, 0.04, s)));
  }
  // Ultra-Water's swash() (MIT), driven by the baked distance instead of its shore texture, in UNITS:
  //   x = the film's thickness (units, 0 = no water), y = the foam edge (1 while the water runs up and is thin),
  //   z = the wetness (1 under water, then dries as exp(-t / uWetTau) after the backwash uncovers that spot)
  vec3 swash(vec2 xz0, float d, float t) {
    vec2 xz = shoreFoot(xz0, d);                         // the swash is one number per line across the shore
    // the run-up, set to set (a bigger set reaches further: one slow noise over the beach)
    float R = uRunup * (1.0 - uSetK * 0.5 + uSetK * noise3(vec3(xz * uPhase1 * 0.21, 7.7 + t * 0.045)));
    float h = max(d, 0.0);                               // how far inland this pixel is (the beach is near flat)
    // Ultra-Water's own gate (OceanSurface.js lines 69 + 73): past 1.5 R nothing, between R and 1.5 R only the damp
    // left by the bigger sets. Leaving these two lines out is what made the whole beach wet (see the header).
    if (h > 1.5 * R) return vec3(0.0);
    if (h > R) return vec3(0.0, 0.0, 0.5 * smoothstep(1.5 * R, R, h));
    float w = 6.2831853 / uPeriod;                       // rad/s
    float s = fract((w * t + swashPhase(xz, t)) / 6.2831853);
    // fast rise (uRise of the period), slow drain: the asymmetry that reads as water, not as a sine
    float eta = R * (s < uRise ? sin(s / uRise * 1.5707963) : cos((s - uRise) / (1.0 - uRise) * 1.5707963));
    // the film's thickness where it covers the sand; seaward of the SMOOTH waterline (d < 0: the sand piece's old
    // straight edge pokes out there) the sand is always under water, 4 units deeper per unit out, so the old edge
    // never shows as sand between the smooth line and the sea
    float th = eta - h + max(-d, 0.0) * 4.0;
    // CONTINUOUS IN TIME (2026-10-30, measured: the edge was cut at s = 0.35 and popped on at the period's wrap, a
    // 1.0 jump between two frames; the rising front was a 4-unit step that the run-up crosses at up to 4 units per
    // frame, and the wetness jumped 0.64 at h = R where the gate below takes over). Now: the edge fades in over the
    // first 4 % of the period and out between 28 and 40 %, its front is 40 units soft, it fades out before the gate
    // (h -> R), the wetness rises ahead of the front over the same 40 units and meets the gate's 0.5 at h = R.
    float win = smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.28, 0.40, s));
    float edge = win * smoothstep(-uSoftFront, 0.0, th) * (1.0 - smoothstep(0.0, uFoamW, th)) * (1.0 - smoothstep(0.85 * R, R, h));
    float sPass = uRise + (1.0 - uRise) * acos(clamp(h / max(R, 1e-3), 0.0, 1.0)) / 1.5707963;
    float dry = (s > sPass ? s - sPass : s + 1.0 - sPass) * uPeriod;    // seconds since the backwash passed here
    float wet = max(exp(-dry / uWetTau), smoothstep(-uSoftFront, 0.0, th));   // 1 under water (th >= 0)
    wet = mix(wet, 0.5, smoothstep(0.8 * R, R, h));
    return vec3(max(th, 0.0), edge, clamp(wet, 0.0, 1.0));
  }
  // the wet sand band: the waterline itself, tied to the MEAN waterline (not the moving waves, or it flickers)
  float shoreWet(float d, float dM) { return 1.0 - smoothstep(0.0, dM, max(d, 0.0)); }
  // EVERYTHING THE SAND READS FROM THE WATER (sand.js): x = the swash film (units), y = its foam edge, z = wetness
  // 0..1. Gated: only on the beach (beachOpen), only within WET_MAX of the waterline (swash gate + the damp strip).
  vec3 sandWater(vec2 xz, float t) {
    vec4 s = shoreTap(xz);
    float open = beachOpen(s);
    if (open <= 0.0) return vec3(0.0);
    vec3 sw = swash(xz, s.r, t);
    // on the sand seaward of the smooth line: the same foam band the sea draws there (seaFoam), so sand and sea
    // carry one band across the sand piece's old edge
    float off = max(-s.r, 0.0);
    float band = off > 0.0 ? smoothstep(uFoamW, 0.0, off) * waveArrive(xz, s.r, t) : 0.0;
    return vec3(sw.x, max(sw.y, band), max(sw.z * 0.9, shoreWet(s.r, uDamp))) * open;
  }
`;

// ---------------- the water's BODY colour (shared by the sea and by the swash film on the sand) ----------------
// danielshervheim/unity-stylized-water (BSD-3-Clause) `Stylized Water.shader` lines 268-294: T = exp(-density *
// opticalDepth); base = lerp(deep, shallow * fragColor, T). Our optical depth is the baked distance's own depth (we
// own the heightfield, so no depth buffer is needed - water.md 4), and the "fragColor" behind the water is the bed.
export const WATER_BODY_GLSL = /* glsl */`
  uniform vec3 uDeep, uShallow, uBed, uFoam;         // the recipe's measured anchors (water.js anchors())
  uniform vec3 uRamp[${WATER.ROWS}];                  // the sea piece's 8 measured picture rows: [0] near .. [7] far
  uniform vec3 uRampM[${WATER.ROWS}];                 // their monotone tangents (rampTangents(), per stop)
  uniform float uAbsorb, uBedSlope, uBedK, uShallowK;
  // the measured ramp through its stops: u = 0 -> uRamp[0] (the picture's bottom row, at the shore), u = 1 -> uRamp[7]
  // (its top row, far out); stop k sits at u = k / 7. A MONOTONE CUBIC (Fritsch-Carlson 1980) through the stops, not
  // straight lines: the straight-line ramp had a kink at every stop, and the sea seen from the arena puts the whole
  // ramp into ~20 screen rows, so each kink was a visible line (measured 2026-10-30: a row off the gradient by up to
  // 8.6 /255 with the waves and the reflection off). Still exact at the stops, and never overshoots them.
  vec3 seaRamp(float u) {
    float p = clamp(u, 0.0, 1.0) * ${WATER.ROWS - 1}.0;
    int i = int(floor(p)); int j = min(i + 1, ${WATER.ROWS - 1});
    vec3 a = uRamp[0], b = uRamp[0], ma = vec3(0.0), mb = vec3(0.0);
    for (int k = 0; k < ${WATER.ROWS}; k++) {
      if (k == i) { a = uRamp[k]; ma = uRampM[k]; }
      if (k == j) { b = uRamp[k]; mb = uRampM[k]; }
    }
    float f = p - floor(p), f2 = f * f, f3 = f2 * f;
    return (2.0 * f3 - 3.0 * f2 + 1.0) * a + (f3 - 2.0 * f2 + f) * ma + (3.0 * f2 - 2.0 * f3) * b + (f3 - f2) * mb;
  }
  vec3 seaBody(float dUnits) {                       // dUnits = the signed shore distance: + inland, - at sea
    float depthM = max(-dUnits, 0.0) * uBedSlope / ${M.toFixed(1)};
    float T = clamp(exp(-uAbsorb * depthM) * uShallowK, 0.0, 1.0);
    // daniel's lerp(deep, shallow * bed, T): the deep->shallow part IS the measured ramp; the bed shows through as T^2
    return mix(seaRamp(1.0 - T), uShallow * uBed, uBedK * T * T);
  }
  // the film the swash leaves on the sand: the same body colour at the film's own thickness, tinted by the bed
  vec3 filmBody(float filmUnits, vec3 bed, float bedLuma) {
    vec3 body = seaBody(-filmUnits);
    return body * mix(1.0, max(lumaB(bed) / max(bedLuma, 1e-3), 0.2), 0.75);
  }
`;

// ---------------- the sea's own GLSL: the surface, the foam, the sparkle ----------------
// expects NOISE_GLSL, LIGHT_GLSL (uLightDir/uLightColor/toonLight/aerial/skyRadiance), SHORE_GLSL and
// WATER_BODY_GLSL before it. (No varying here: the material declares vW itself.)
export const SEA_GLSL = /* glsl */`
  uniform float uReflK, uSpecPow, uSpecK, uGlint, uGlintCell, uGlintK;
  uniform vec2 uWindDir;
  uniform float uW1, uW2, uW3, uS1, uS2, uS3, uChop1, uChop2, uChop3;
  uniform float uHFade0, uHFade1, uSurfW, uBoreW, uBandLo, uBandHi;

  // THE MOVING FOAM ON THE WAVE EDGE (sea side): the incoming broken wave's bore, one per swash period, phase-locked
  // to the swash the sand draws (the same swashPhase at the same point): it runs in from uSurfW offshore and reaches
  // the waterline at s = 0, the moment the run-up starts on the sand (Cyanilux's rule). off = distance offshore.
  // CONTINUOUS IN TIME (2026-10-30, measured: the line arrived at the waterline at full strength and vanished in one
  // frame when s wrapped 1 -> 0, a 1.0 jump: "the wave reaches the beach and snaps back"). It now dissolves into the
  // waterline band over the last 14 % of the period, so at the wrap both the old and the new line are 0.
  // fp = the pixel's footprint (units): the line is widened by it and dimmed by the same share (band-limited, mean kept).
  float seaBore(vec2 xz, float off, float t, float fp) {
    float s = fract((6.2831853 / uPeriod * t + borePhase(xz, off)) / 6.2831853);   // ONE line across the shore
    float pos = uSurfW * (1.0 - s);                          // where the line is now
    float w = uBoreW * (0.45 + 0.55 * s);                    // thin far out, wider as it breaks near the shore
    float wf = w + fp;
    float line = (1.0 - smoothstep(0.0, wf, abs(off - pos))) * (w / wf);
    float fadeIn = smoothstep(0.0, 0.22, s);                 // born out at uSurfW, not popped in
    float fadeOut = 1.0 - smoothstep(0.86, 1.0, s);          // dissolves into the waterline band, not cut
    // its wake: falls off behind the line (seaward) in ONE slope. It used to rise again to a second bright band 3 widths
    // behind the line (0.35 after a dip to 0.09): measured 2026-10-30 as a second parallel line on 818 of 1152 ray-times.
    float trail = step(pos, off) * (1.0 - smoothstep(pos, pos + wf * 7.0, off)) * 0.35 * (w / wf);
    return max(line, trail) * fadeIn * fadeOut;
  }

  // three directional waves' analytic slope (the report's GPU Gems 1 ch.1 rule: 2-3 big waves in the geometry, the
  // detail in the normal). BAND-LIMITED by the pixel footprint fp (units): each octave is at full strength while its
  // wavelength spans >= uBandHi pixels and fades smoothly to 0 by uBandLo pixels (it used to switch off with a hard
  // 'if' at 4 px). The far sea is seen at a grazing angle, where a wave crest a few pixels apart flips the fresnel
  // reflection between the sky above and the haze at the horizon: measured 2026-10-30, the violet / blue stripes.
  float seaBand(float lambda, float fp) { return smoothstep(uBandLo, uBandHi, lambda / max(fp, 1e-3)); }
  vec2 seaSlope(vec2 p, float t, float fp) {
    vec2 d1 = uWindDir, d2 = vec2(-uWindDir.y, uWindDir.x), d3 = normalize(d1 * 0.55 + d2 * 0.83);
    float k1 = 6.2831853 / uW1, k2 = 6.2831853 / uW2, k3 = 6.2831853 / uW3;
    vec2 g = d1 * (cos(dot(p, d1) * k1 - t * uS1) * k1 * uW1 * uChop1 * seaBand(uW1, fp))
           + d2 * (cos(dot(p, d2) * k2 - t * uS2 + 1.7) * k2 * uW2 * uChop2 * seaBand(uW2, fp))
           + d3 * (cos(dot(p, d3) * k3 - t * uS3 + 3.1) * k3 * uW3 * uChop3 * seaBand(uW3, fp));
    return g * 0.5;   // the slope of a sine of amplitude a = chop * lambda / (2 pi) is chop; 0.5 because three add up
  }
  // the foam lace: one noise that EVOLVES through its third axis (continuous for ever: the lattice wraps at 256 cells,
  // where noise3 is periodic). It used to be mix(a, b, fract(t * 0.16)), which snapped from b back to a every 6.25 s:
  // a 0.65 jump between two frames (measured). Its contrast fades to the noise's mean 0.5 once a pixel covers a cell.
  float seaLace(vec2 p, float t, float fp) {
    float a = noise3(vec3(p / uLace, t * 0.11));
    return mix(a, 0.5, smoothstep(0.35, 1.2, fp / uLace));
  }
  // how bright the sparkle is: one fixed-cell noise, its CONTRAST faded by the footprint while its MEAN is kept
  // (sand.md C6c: fade contrast, keep the mean - the correct answer when a pixel covers many glints)
  float seaSparkle(vec2 p, float t, float fp) {
    float cell = noise3(vec3(p / uGlintCell, t * 0.55));
    float pat = smoothstep(0.55, 0.95, cell);
    float fade = smoothstep(0.35, 1.6, fp / uGlintCell);
    return mix(pat, 0.22, fade);          // 0.22 = the pattern's own mean, so the light it adds does not change
  }
  // ALL the sea's foam at one point (0..1): the band at the waterline (in step with the swash the sand draws), the bore
  // running in on the wave edge and the lace it leaves; only off a beach (open), none at the foot of the grass bank.
  // sh = shoreTap(xz), fp = the pixel's footprint (units). The checker probes this same function over time.
  float seaFoam(vec2 xz, vec4 sh, float t, float fp) {
    float d = sh.r, open = beachOpen(sh), off = max(-d, 0.0);
    if (open <= 0.0 || off >= uSurfW + uBoreW * 7.0) return 0.0;
    float nearShore = 1.0 - smoothstep(0.0, uFoamRange, off);
    float band = smoothstep(uFoamW, 0.0, off) * waveArrive(xz, d, t);
    float lc = seaLace(xz, t, fp);
    float bore = seaBore(xz, off, t, fp) * smoothstep(0.25, 0.6, lc);   // the line breaks up along its length
    float lace = smoothstep(uLaceK - 0.12, uLaceK + 0.12, lc) * nearShore * nearShore;
    return clamp(max(max(band, bore * 0.9), lace * 0.6), 0.0, 1.0) * open;
  }
`;

// ---------------- uniforms ----------------
const bytes = (c) => (Array.isArray(c) ? c.map((v) => Math.max(0, Math.min(255, Math.round(v)))) : null);
const mean = (list) => [0, 1, 2].map((i) => list.reduce((s, c) => s + c[i], 0) / list.length);
const lift = (c, k) => [0, 1, 2].map((i) => c[i] + (255 - c[i]) * k);
const rows8 = (p) => Array.from({ length: WATER.ROWS }, (_, k) => (p.rows?.[k]?.rgb) || p.rows?.find(Boolean)?.rgb || p.colours?.all);

/** The measured anchors: the recipe's own rows / percentiles, averaged over the pieces of each kind. */
export function anchors(rec) {
  const P = rec.pieces || [];
  const water = P.filter((p) => p.kind === "water"), sea = P.filter((p) => p.kind === "sea");
  const sand = P.find((p) => p.kind === "sand");
  const near = [...water, ...sea].map((p) => rows8(p)[WATER.ROWS - 1]).filter(Boolean);
  const p90s = [...water, ...sea].map((p) => bytes(p.colours?.p90)).filter(Boolean);
  const deepPiece = sea[0] || water[0] || null;
  const deep = bytes(deepPiece?.colours?.p10) || bytes(rows8(deepPiece || {})[0]) || [8, 19, 147];
  const shallowSrc = near.length ? mean(near) : (bytes(water[0]?.colours?.all) || [82, 220, 225]);
  const foamSrc = lift(p90s.length ? mean(p90s) : shallowSrc, 0.55);
  const bed = bytes(sand?.colours?.p90) || bytes(sand?.colours?.all) || [221, 221, 204];
  // the depth ramp: the sea piece's own rows, near (its picture bottom, row 7) first, far (row 0) last; a recipe
  // without a sea piece uses the first water piece's rows; none at all -> shallow .. deep
  const rampSrc = deepPiece?.rows?.some(Boolean) ? rows8(deepPiece).slice().reverse() : null;
  const ramp = rampSrc ? rampSrc.map((c) => bytes(c)) : Array.from({ length: WATER.ROWS }, (_, k) => {
    const f = k / (WATER.ROWS - 1); return [0, 1, 2].map((i) => Math.round(shallowSrc[i] + (deep[i] - shallowSrc[i]) * f));
  });
  return {
    ramp, rampFrom: rampSrc ? deepPiece.name : null,
    deep: deep.map(Math.round), shallow: shallowSrc.map(Math.round), foam: foamSrc.map(Math.round), bed,
    near: near.map((c) => c.map(Math.round)), p90: p90s.map((c) => c.map(Math.round)),
    rows: water.map((p) => ({ name: p.name, rows: p.rows ? p.rows.map((r) => r?.rgb || null) : null, p10: bytes(p.colours?.p10), p90: bytes(p.colours?.p90) }))
              .concat(sea.map((p) => ({ name: p.name, rows: p.rows ? p.rows.map((r) => r?.rgb || null) : null, p10: bytes(p.colours?.p10), p90: bytes(p.colours?.p90) }))),
  };
}

/** Monotone cubic tangents (Fritsch & Carlson 1980) for the ramp's stops (linear THREE.Colors, spacing 1), per
 *  channel: the secant mean, 0 at a local extremum or a flat step, limited so the curve never overshoots a stop. */
export function rampTangents(cols) {
  const n = cols.length, ch = ["r", "g", "b"], out = Array.from({ length: n }, () => new THREE.Vector3());
  for (let c = 0; c < 3; c++) {
    const y = cols.map((q) => q[ch[c]]), d = [], m = new Array(n).fill(0);
    for (let k = 0; k < n - 1; k++) d.push(y[k + 1] - y[k]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (let k = 0; k < n - 1; k++) {
      if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
      const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
    }
    for (let k = 0; k < n; k++) out[k].setComponent(c, m[k]);
  }
  return out;
}

/** The shore chunk's uniforms for a material: the same baked field texture and the same shared clock, so the sand and
 *  the sea cannot drift apart (one waterline, one swash). Exported because sand.js builds its own material. */
export function shoreUniforms(field, P = WATER) {
  const A = anchors(field.rec);
  return {
    uShore: { value: field.tex }, uShoreSpan: { value: field.span }, uSeaY: { value: P.SEA_Y },
    uTime: S.U.uWindTime,
    uRunup: { value: P.RUNUP }, uPeriod: { value: P.PERIOD }, uRise: { value: P.RISE }, uWetTau: { value: P.WET_TAU },
    uPhase1: { value: P.PHASE1 }, uPhase2: { value: P.PHASE2 }, uSetK: { value: P.SET_K },
    uDamp: { value: P.DAMP }, uOpenW: { value: P.OPEN_W },
    uFoamW: { value: P.FOAM_W }, uFoamRange: { value: P.FOAM_RANGE }, uLace: { value: P.LACE }, uLaceK: { value: P.LACE_K },
    uSoftFront: { value: P.SOFT_FRONT },
    // the body colour's anchors (WATER_BODY_GLSL), so any material that takes these uniforms paints the same water
    uRamp: { value: A.ramp.map((c) => S.srgb(c)) },
    uRampM: { value: rampTangents(A.ramp.map((c) => S.srgb(c))) },
    uDeep: { value: S.srgb(A.deep) }, uShallow: { value: S.srgb(A.shallow) }, uBed: { value: S.srgb(A.bed) },
    uFoam: { value: S.srgb(A.foam) },
    uAbsorb: { value: P.ABSORB }, uBedSlope: { value: P.BED_SLOPE }, uBedK: { value: P.BED_K }, uShallowK: { value: P.SHALLOW_K },
  };
}

// ---------------- geometry ----------------
/** The sea: a polar ring from the sand's own edge (pulled OVERLAP inland, so it always tucks under the sand) out to
 *  FAR_R, on the plane y = SEA_Y. All shading is per pixel, so 8 rings of 128 sectors is all it needs. */
export function seaGeometry(field, P = WATER) {
  const NS = P.SECTORS, NR = P.RINGS, nv = (NS + 1) * NR;
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const r0 = new Float32Array(NS + 1);
  for (let j = 0; j <= NS; j++) {
    const az = (j / NS) * Math.PI * 2 - Math.PI;
    r0[j] = Math.max(200, waterlineAt(field, az) - P.OVERLAP);
  }
  for (let i = 0; i < NR; i++) {
    const f = i / (NR - 1);
    for (let j = 0; j <= NS; j++) {
      const az = (j / NS) * Math.PI * 2 - Math.PI;
      const r = r0[j] * Math.pow(P.FAR_R / r0[j], f);      // geometric: the near rings stay tight, the far ones wide
      const o = i * (NS + 1) + j;
      pos[o * 3] = Math.sin(az) * r; pos[o * 3 + 1] = P.SEA_Y; pos[o * 3 + 2] = Math.cos(az) * r;
      uv[o * 2] = j / NS; uv[o * 2 + 1] = f;
    }
  }
  const idx = [];
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NS; j++) {
    const a = i * (NS + 1) + j, b = a + 1, c = a + NS + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.userData = { r0: Array.from(r0), far: P.FAR_R, y: P.SEA_Y, tris: idx.length / 3 };
  return g;
}

/** The horizon band: a wall at BAND_R from BAND_Y[0] to BAND_Y[1], painted skyRadiance() per pixel. It is what makes
 *  the sea meet the sky: every below-horizon ray that misses the sea's outer edge lands here, and every ray above the
 *  horizon lands on the sky dome at the same colour, so the seam is invisible by construction. */
export function bandGeometry(P = WATER) {
  const NS = P.BAND_SEGS, NR = P.BAND_ROWS;
  const pos = new Float32Array((NS + 1) * NR * 3);
  for (let i = 0; i < NR; i++) {
    const y = P.BAND_Y[0] + (P.BAND_Y[1] - P.BAND_Y[0]) * (i / (NR - 1));
    for (let j = 0; j <= NS; j++) {
      const az = (j / NS) * Math.PI * 2 - Math.PI, o = i * (NS + 1) + j;
      pos[o * 3] = Math.sin(az) * P.BAND_R; pos[o * 3 + 1] = y; pos[o * 3 + 2] = Math.cos(az) * P.BAND_R;
    }
  }
  const idx = [];
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NS; j++) {
    const a = i * (NS + 1) + j, b = a + 1, c = a + NS + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.userData = { tris: idx.length / 3, r: P.BAND_R, y: P.BAND_Y };
  return g;
}

// ---------------- materials ----------------
function seaMaterial(field, P, A) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      ...shoreUniforms(field, P),
      uDeep: { value: S.srgb(A.deep) }, uShallow: { value: S.srgb(A.shallow) },
      uBed: { value: S.srgb(A.bed) }, uFoam: { value: S.srgb(A.foam) },
      uAbsorb: { value: P.ABSORB }, uBedSlope: { value: P.BED_SLOPE }, uBedK: { value: P.BED_K }, uShallowK: { value: P.SHALLOW_K },
      uReflK: { value: P.REFL_K }, uSpecPow: { value: P.SPEC_POW }, uSpecK: { value: P.SPEC_K },
      uGlint: { value: P.GLINT }, uGlintCell: { value: P.GLINT_CELL }, uGlintK: { value: P.GLINT_K },
      uWaveDir: S.U.uWindDir,
      uW1: { value: P.W1 }, uW2: { value: P.W2 }, uW3: { value: P.W3 },
      uS1: { value: P.S1 }, uS2: { value: P.S2 }, uS3: { value: P.S3 },
      uChop1: { value: P.CHOP1 }, uChop2: { value: P.CHOP2 }, uChop3: { value: P.CHOP3 },
      uHFade0: { value: P.HFADE0 }, uHFade1: { value: P.HFADE1 },
      uSurfW: { value: P.SURF_W }, uBoreW: { value: P.BORE_W },
      uBandLo: { value: P.BAND_LO }, uBandHi: { value: P.BAND_HI },
    }),
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vW;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${SHORE_GLSL}
      ${WATER_BODY_GLSL}
      ${SEA_GLSL}
      void main() {
        vec3 rd = normalize(vW - cameraPosition);          // eye -> surface
        vec3 V = -rd;
        vec4 sh = shoreTap(vW.xz);
        float d = sh.r;                                    // + inland, - at sea
        float open = beachOpen(sh);                        // 1 off a beach, 0 at the foot of the grass bank
        float t = uTime;
        float fp = length(fwidth(vW.xz));                  // the pixel's footprint on the sea, units
        // 1. the surface's normal: three wave slopes (each faded by its own footprint) + the swell's own tilt
        vec2 g = seaSlope(vW.xz, t, fp);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        // 2. the body, depth graded, lit by the SHARED light (sun by day, moon by night)
        vec3 col = toonLight(seaBody(d), N, V, vW, 1.0, 0.0);
        // 3. the sky in the sea: Schlick fresnel toward the sky's own radiance at the reflected ray. A ray a wave tips
        //    below the horizon would meet the next wave, not the haze under the horizon: it is folded back up (abs).
        vec3 rr = reflect(rd, N); rr.y = abs(rr.y);
        vec3 refl = skyRadiance(rr);
        float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
        col = mix(col, refl, clamp(F * uReflK, 0.0, 1.0));
        // 4. the sun's (or the moon's) glint + the fixed-cell sparkle
        vec3 H = normalize(uLightDir + V);
        float spec = pow(max(dot(N, H), 0.0), uSpecPow) * uSpecK;
        spec *= mix(0.25, 1.0, seaSparkle(vW.xz, t, fp));      // wet-looking, and it never boils
        col += uLightColor * spec;
        // 5. foam: the band at the waterline (in step with the swash the sand draws), the bore running in on the wave
        //    edge, and the lace it leaves; only off a beach (open), none at the foot of the grass bank
        float foam = seaFoam(vW.xz, sh, t, fp);
        col = mix(col, uFoam, foam * 0.92);
        // 6. the horizon: the shared haze, then the sea's own fade into the sky over its last share of the reach
        float dist = length(vW - cameraPosition);
        float fade = smoothstep(uHFade0 * ${WATER.FAR_R.toFixed(1)}, uHFade1 * ${WATER.FAR_R.toFixed(1)}, dist);
        col = mix(col, skyRadiance(rd), fade);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: false, depthWrite: true,
    // the sea runs OVERLAP under the land: its depth is pushed back so the land always wins there (no poke-through)
    polygonOffset: true, polygonOffsetFactor: P.POLY_OFFSET[0], polygonOffsetUnits: P.POLY_OFFSET[1],
  });
}

function bandMaterial(P) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({}),
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      varying vec3 vW;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        // the sky's OWN radiance at this direction: the band is the sea at the horizon, i.e. a mirror of the sky
        vec3 col = skyRadiance(normalize(vW - cameraPosition));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: false, depthWrite: true,
  });
}

// ======================================================================================================
// PRESETS: one water module, a preset per kind of water (build-water3, 2026-10-30; user: "we've already built the
// ocean water ... why can't we make it reusable?").  RULE: water = this file with a preset; never hand-roll water per arena.
//   "ocean"  the beach sea above, byte-identical to before (meft1002): baked shore field from the SAND piece, swash, bore,
//            lace, foam, surf, recipe-measured depth ramp. Chosen when the recipe has sea / water pieces.
//   "lake"   a calm lake (meft1008): the same shore-field + depth-ramp + light + haze + horizon-band machinery, but the
//            shore field is baked from the SOIL's own outline (soilLand), no surf, no swash, no foam, small slow ripples
//            from the two normal maps of three.js's own webgl_water example (Water_1_M_Normal / Water_2_M_Normal, the
//            maps examples/jsm/objects/Water2.js is shown with; two scrolling taps = the Water.js/Water2 recipe) and a REAL
//            planar reflection of the scene (a render target drawn from the camera mirrored in the water plane with an
//            oblique near plane: three.js examples/jsm/objects/Reflector.js, MIT, r186) mixed in by a Schlick Fresnel.
//            Chosen when the recipe has no sea / water pieces but has the lake's mirror pieces (pine_mirror / rock_mirror).
// The preset is read from the RECIPE's pieces (waterPreset), never from an arena name.
// ======================================================================================================
export function waterPreset(rec) {
  const P = rec?.pieces || [];
  if (P.some((p) => p.kind === "sea" || p.kind === "water")) return "ocean";
  if (P.some((p) => p.kind === "pine_mirror" || p.kind === "rock_mirror")) return "lake";
  return null;
}

/** The lake preset's numbers (units: 400 = 1 m). MEASURED: nothing about the water colour (the pack has no water texel,
 *  MEASURE.md 2a); the colour is PICKED: dark blue-green-grey, from the user's comparison with the game ("dark, rippled,
 *  tree and rock reflections visible"). The cast agrees with the measured reflections (all blue-grey, MEASURE 2e). */
export const LAKE_PRESET = {
  ...WATER,
  SEA_Y: 2,                      // 5 mm ABOVE the soil floor: the water covers the land seaward of the smooth shore curve
  ERODE: 0.9 * M, BLUR: 0.8 * M, SOFT: 0.18 * M,   // smooth shore: land eroded 0.9 m, blurred 0.8 m; the water edge is 18 cm soft
  FAR_R: 75 * M, BAND_R: 76.25 * M,
  SECTORS: 192, RINGS: 10,
  INNER: 3.5 * M,                // the water starts this far from the centre; the soil floor (>= 5.05 m everywhere) covers it
  ABSORB: 0.42, BED_SLOPE: 0.5, BED_K: 0, SHALLOW_K: 1.0,   // depth grading: green-grey shallows -> deep blue-grey within ~8 m of the shore
  SHALLOW: [40, 62, 62], DEEP: [11, 24, 36],                 // PICKED (sRGB), the body colour at the shore and in deep water
  MUD: [20, 26, 22], MUD_W: 0.55 * M, MUD_K: 0.65,           // PICKED: the wet shore a little under the surface, 55 cm wide, soft
  NORMAL_FILES: ["lib3d/water/Water_1_M_Normal.jpg", "lib3d/water/Water_2_M_Normal.jpg"],   // three.js examples/textures/water (webgl_water)
  REP: [9 * M, 5 * M],           // units per repeat of the two taps
  SLOPE: [0.20, 0.14],           // strength of the two taps (small, calm ripples)
  SPEED: [[0.010, 0.006], [-0.007, 0.011]],   // repeats per second
  SLOPE_FAR: 0.35,               // share of the ripple left at 45 m (stops far shimmer)
  F0: 0.30, REFL_K: 1.0,         // Schlick F0 (water 0.02, a little higher for the calm lake) and the share taken
  REFL_DIM: 0.92, REFL_SAT: 0.85, // the reflected scene is dimmed and slightly greyed (a dark lake, not a mirror)
  DISTORT: 0.035,                // screen-uv shift per unit of normal slope (Water.js distortionScale idea)
  REFL_SCALE: 0.5,               // reflection target = half the canvas
  SPEC_POW: 260, SPEC_K: 0.5,
  HFADE0: 0.45, HFADE1: 1.0,
  HIDE_IN_REFLECTION: ["floorcover"],   // meshes (userData.kind) the reflection pass skips: tiny litter nobody sees mirrored
};

/** The lake's shore field: the SAME texture layout the ocean's bake makes (R = signed distance to the land edge, + inland),
 *  baked from soil.js's own land (soilLand().landAt) on the SAME 1024^2 +-16000 map. Only the annulus the land edge lives in
 *  is sampled with landAt (inside the min radius is land, outside the max is water). */
function bakeLakeField(rec, P) {
  const t0 = performance.now();
  const L = soilLand(rec);
  const size = SHORE.SIZE, span = SHORE.SPAN, upx = (2 * span) / size, N = size * size;
  let rLo = Infinity, rHi = 0;
  for (const v of L.outline.landEnd) if (v != null) { rLo = Math.min(rLo, v); rHi = Math.max(rHi, v); }
  rLo = Math.max(0, rLo - 4 * upx); rHi += 4 * upx;
  const wet = new Uint8Array(N);          // 1 = land
  let calls = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + 0.5) * upx - span, z = (j + 0.5) * upx - span, r = Math.hypot(x, z);
    if (r <= rLo) wet[j * size + i] = 1;
    else if (r < rHi) { calls++; wet[j * size + i] = L.landAt(x, z) ? 1 : 0; }
  }
  // THE SMOOTH SHORE (user: "polygonal straight segments"): the soil's own edge is a polygon (floor triangles + 1 deg apron
  // columns). The water is drawn OVER the land seaward of a SMOOTH curve that lies inside that polygon: the land mask is
  // eroded ERODE inland, blurred (two box passes, radius BLUR) and cut at 0.5; the water then covers the polygon's edge.
  const e0 = new Uint8Array(N); for (let i = 0; i < N; i++) e0[i] = wet[i] ? 0 : 1;
  const dE = edt2d(e0, size);
  const er = P.ERODE / upx, br = Math.max(1, Math.round(P.BLUR / upx));
  let a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = Math.sqrt(dE[i]) > er ? 1 : 0;
  let b2 = new Float32Array(N);
  const box = (src, dst, horiz) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let sum = 0; for (let k = -br; k <= br; k++) { const xx = horiz ? Math.min(size - 1, Math.max(0, x + k)) : x, yy = horiz ? y : Math.min(size - 1, Math.max(0, y + k)); sum += src[yy * size + xx]; }
      dst[y * size + x] = sum / (2 * br + 1);
    }
  };
  for (let pass = 0; pass < 2; pass++) { box(a, b2, true); box(b2, a, false); }
  const smoothLand = new Uint8Array(N); for (let i = 0; i < N; i++) smoothLand[i] = a[i] > 0.5 ? 1 : 0;
  for (let i = 0; i < N; i++) wet[i] = smoothLand[i];
  const outside = new Uint8Array(N); for (let i = 0; i < N; i++) outside[i] = wet[i] ? 0 : 1;
  const dOut = edt2d(outside, size), dIn = edt2d(wet, size);
  const half = new Uint16Array(N * 4), toHalf = THREE.DataUtils?.toHalfFloat || ((v) => v);
  for (let i = 0; i < N; i++) {
    const d = (wet[i] ? Math.sqrt(dOut[i]) - 0.5 : -(Math.sqrt(dIn[i]) - 0.5)) * upx;
    half[i * 4] = toHalf(d); half[i * 4 + 1] = 0; half[i * 4 + 2] = toHalf(4 * span); half[i * 4 + 3] = toHalf(4 * span);
  }
  const tex = new THREE.DataTexture(half, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false; tex.needsUpdate = true;
  // the inner ring of the water: a circle well inside the land (the floor covers it everywhere), so no gap can open
  const n = 8, wl = { r: new Float32Array(n).fill(P.INNER + P.OVERLAP), az: Float32Array.from({ length: n }, (_, k) => (k / n) * Math.PI * 2 - Math.PI) };
  return { rec, tex, span, size, outline: [], wl, smooth: null, sand: null, banks: [], landCalls: calls, landR: [rLo, rHi],
           ms: Math.round(performance.now() - t0) };
}
let LAKE_FIELD = null;
export function lakeField(rec, P = LAKE_PRESET) {
  if (!LAKE_FIELD || LAKE_FIELD.rec !== rec) LAKE_FIELD = bakeLakeField(rec, P);
  return LAKE_FIELD;
}

/** The two normal maps (Water_1_M_Normal / Water_2_M_Normal), loaded once. Until a file is in, a flat 1x1 normal stands
 *  in (no ripple), so a missing file never breaks the frame. `ready()` is true when both are in or failed. */
let LAKE_NMAPS = null;
function lakeNormalMaps(P) {
  if (LAKE_NMAPS) return LAKE_NMAPS;
  const flat = () => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; return t; };
  const st = { a: { value: flat() }, b: { value: flat() }, left: P.NORMAL_FILES.length, failed: [], files: P.NORMAL_FILES };
  const loader = new THREE.TextureLoader();
  P.NORMAL_FILES.forEach((f, i) => {
    loader.load(f, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
      (i ? st.b : st.a).value = t; st.left--;
    }, undefined, () => { st.failed.push(f); st.left--; });
  });
  st.ready = () => st.left <= 0;
  return (LAKE_NMAPS = st);
}

/** PLANAR REFLECTION (the Reflector.js method, MIT, three.js r186 examples/jsm/objects/Reflector.js): the camera is mirrored in
 *  the water plane, the scene is drawn from there into a half-resolution HalfFloat target with the plane as the oblique near
 *  plane (Lengyel 2005, so nothing under the surface is drawn), and the water shader looks the target up with a texture
 *  matrix. It runs from the water mesh's onBeforeRender, once per drawn frame per camera. Anything in `hide()` and the water
 *  itself are skipped; the sky dome (parked on the camera) is moved to the mirrored eye for that pass. */
export function createPlanarReflection(P, { hide = () => [] } = {}) {
  const R = { enabled: true, scale: P.REFL_SCALE, target: null, matrix: new THREE.Matrix4(), size: [0, 0], passes: 0, lastMs: 0, skipped: 0, uniforms: null };
  const vcam = new THREE.PerspectiveCamera(); vcam.userData.isReflection = true;
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const wp = new THREE.Vector3(), cp = new THREE.Vector3(), nrm = new THREE.Vector3(0, 1, 0), view = new THREE.Vector3(), tgt = new THREE.Vector3(), look = new THREE.Vector3(), rot = new THREE.Matrix4(), v2 = new THREE.Vector2();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  let hidden = [], hiddenAt = -1;
  R.render = (renderer, scene, camera, mesh) => {
    if (!R.enabled || camera.userData.isReflection) { R.skipped++; return; }
    const t0 = performance.now();
    renderer.getDrawingBufferSize(v2);
    const w = Math.max(64, Math.round(v2.x * R.scale)), h = Math.max(64, Math.round(v2.y * R.scale));
    if (!R.target || R.size[0] !== w || R.size[1] !== h) {
      R.target?.dispose();
      R.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true });
      R.target.texture.name = "builtLakeReflection"; R.size = [w, h];
      if (R.uniforms) R.uniforms.uReflTex.value = R.target.texture;
    }
    mesh.updateWorldMatrix(true, false);
    wp.set(0, P.SEA_Y, 0).applyMatrix4(mesh.matrixWorld);                 // a point on the plane (world)
    cp.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(wp, cp);
    if (view.dot(nrm) > 0) { R.skipped++; return; }                       // the eye is under the water: nothing to mirror
    // the mirrored camera (Reflector.js)
    view.reflect(nrm).negate(); view.add(wp);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(cp);
    tgt.subVectors(wp, look); tgt.reflect(nrm).negate(); tgt.add(wp);
    vcam.position.copy(view);
    vcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(nrm);
    vcam.lookAt(tgt);
    vcam.near = camera.near; vcam.far = camera.far;
    vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(camera.projectionMatrix);
    vcam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    R.matrix.copy(bias).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);   // world -> reflection uv
    // oblique near plane = the water plane (Lengyel), so only what is above it is drawn
    plane.setFromNormalAndCoplanarPoint(nrm, wp); plane.applyMatrix4(vcam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = vcam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + e[8]) / e[0]; q.y = (Math.sign(clip.y) + e[9]) / e[5]; q.z = -1; q.w = (1 + e[10]) / e[14];
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1 - 0.003; e[14] = clip.w;
    // what to skip: the water itself, the litter, anything the caller names (re-collected every 90 passes)
    if (hiddenAt < 0 || R.passes - hiddenAt > 90) { hidden = hide(scene); hiddenAt = R.passes; }
    const was = hidden.map((o) => o.visible); hidden.forEach((o) => { o.visible = false; }); const mv = mesh.visible; mesh.visible = false;
    const sky = scene.getObjectByName("builtSky"), skyPos = sky ? sky.position.clone() : null; if (sky) sky.position.copy(vcam.position);
    const prevRT = renderer.getRenderTarget(), prevReset = renderer.info.autoReset, prevXR = renderer.xr.enabled, prevShadow = renderer.shadowMap.autoUpdate;
    renderer.info.autoReset = false; renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(R.target);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, vcam);
    renderer.setRenderTarget(prevRT);
    renderer.info.autoReset = prevReset; renderer.xr.enabled = prevXR; renderer.shadowMap.autoUpdate = prevShadow;
    if (sky) sky.position.copy(skyPos);
    mesh.visible = mv; hidden.forEach((o, i) => { o.visible = was[i]; });
    R.passes++; R.lastMs = performance.now() - t0;
  };
  return R;
}

// the lake's surface shader: the ocean's GLSL libraries (shore field, depth-graded body, light, haze, sky) with a calm main
function lakeMaterial(field, P, A, nmaps, refl) {
  const uniforms = S.uniformsWith({
    ...shoreUniforms(field, P),
    uRamp: { value: A.ramp.map((c) => S.srgb(c)) }, uRampM: { value: rampTangents(A.ramp.map((c) => S.srgb(c))) },
    uDeep: { value: S.srgb(A.deep) }, uShallow: { value: S.srgb(A.shallow) }, uBed: { value: S.srgb(A.bed) }, uFoam: { value: S.srgb(A.foam) },
    uAbsorb: { value: P.ABSORB }, uBedSlope: { value: P.BED_SLOPE }, uBedK: { value: P.BED_K }, uShallowK: { value: P.SHALLOW_K },
    uSpecPow: { value: P.SPEC_POW }, uSpecK: { value: P.SPEC_K },
    uNormA: nmaps.a, uNormB: nmaps.b, uRepA: { value: P.REP[0] }, uRepB: { value: P.REP[1] },
    uSlopeA: { value: P.SLOPE[0] }, uSlopeB: { value: P.SLOPE[1] }, uSlopeFar: { value: P.SLOPE_FAR },
    uSpeedA: { value: new THREE.Vector2(...P.SPEED[0]) }, uSpeedB: { value: new THREE.Vector2(...P.SPEED[1]) },
    uReflTex: { value: null }, uReflMat: { value: refl.matrix },
    uReflOn: { value: 1 }, uReflF0: { value: P.F0 }, uReflK: { value: P.REFL_K }, uReflDim: { value: P.REFL_DIM }, uReflSat: { value: P.REFL_SAT },
    uDistort: { value: P.DISTORT },
    uMud: { value: S.srgb(P.MUD) }, uMudW: { value: P.MUD_W }, uMudK: { value: P.MUD_K },
    uHFade0: { value: P.HFADE0 }, uHFade1: { value: P.HFADE1 },
  });
  refl.uniforms = uniforms;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vW;
      uniform sampler2D uNormA, uNormB, uReflTex;
      uniform mat4 uReflMat;
      uniform vec2 uSpeedA, uSpeedB;
      uniform vec3 uMud;
      uniform float uRepA, uRepB, uSlopeA, uSlopeB, uSlopeFar, uReflOn, uReflF0, uReflK, uReflDim, uReflSat, uDistort, uMudW, uMudK;
      uniform float uSpecPow, uSpecK, uHFade0, uHFade1;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${SHORE_GLSL}
      ${WATER_BODY_GLSL}
      void main() {
        vec3 rd = normalize(vW - cameraPosition);          // eye -> surface
        vec3 V = -rd;
        vec4 sh = shoreTap(vW.xz);
        float d = sh.r;                                    // + inland (under the soil), - on the water
        float t = uTime;
        float dh = length(vW.xz - cameraPosition.xz);
        float dist = length(vW - cameraPosition);
        // 1. the surface normal: two scrolling taps of the example's normal maps (Water.js / Water2.js), calmer far away and at the shore
        vec3 nA = texture2D(uNormA, vW.xz / uRepA + uSpeedA * t).xyz * 2.0 - 1.0;
        vec3 nB = texture2D(uNormB, vW.xz / uRepB + uSpeedB * t).xyz * 2.0 - 1.0;
        float far = mix(1.0, uSlopeFar, smoothstep(${(8 * M).toFixed(1)}, ${(45 * M).toFixed(1)}, dh));
        float calm = mix(0.35, 1.0, smoothstep(0.0, uMudW * 2.0, max(-d, 0.0)));
        vec2 sl = (nA.xy * uSlopeA + nB.xy * uSlopeB) * far * calm;
        vec3 N = normalize(vec3(sl.x, 1.0, sl.y));
        // 2. the body (depth graded from the shore, lit by the shared light, hazed by the shared aerial())
        vec3 col = aerial(toonLight(seaBody(d), N, V, vW, 1.0, 0.0), vW);
        // 3. the reflection: the planar target (the scene seen from the mirrored camera) looked up with the texture matrix,
        //    shifted by the surface normal (Water.js distortion, less far away); without it, the sky's own radiance
        vec4 mc = uReflMat * vec4(vW, 1.0);
        vec2 ruv = mc.xy / mc.w + sl * uDistort / (0.5 + dh * ${(0.10 / M).toFixed(6)});
        vec3 rp = texture2D(uReflTex, clamp(ruv, vec2(0.003), vec2(0.997))).rgb;
        vec3 rr = reflect(rd, N); rr.y = abs(rr.y);
        vec3 rs = skyRadiance(rr);
        vec3 refl = mix(rs, rp, uReflOn);
        refl = mix(vec3(lumaB(refl)), refl, uReflSat) * uReflDim;
        float F = uReflF0 + (1.0 - uReflF0) * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
        col = mix(col, refl, clamp(F * uReflK, 0.0, 1.0));
        // 4. a slight sun glint
        vec3 H = normalize(uLightDir + V);
        col += uLightColor * pow(max(dot(N, H), 0.0), uSpecPow) * uSpecK;
        // 5. the wet shore: the water goes dark and clear over the mud within MUD_W of the land, with no hard edge
        col = mix(col, uMud, (1.0 - smoothstep(0.0, uMudW, max(-d, 0.0))) * uMudK * step(d, 0.0));
        // 6. the horizon: the sea's own fade into the sky
        float fade = smoothstep(uHFade0 * ${P.FAR_R.toFixed(1)}, uHFade1 * ${P.FAR_R.toFixed(1)}, dist);
        col = mix(col, skyRadiance(rd), fade);
        float cover = 1.0 - smoothstep(-${P.SOFT.toFixed(1)}, 0.0, d);   // 0 on the land, 1 in the water, soft over SOFT
        if (cover < 0.004) discard;
        gl_FragColor = vec4(col, cover);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: true, depthWrite: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,   // pulled toward the eye: 5 mm above the soil is under the depth resolution beyond ~15 m
  });
}

export function lakeAnchors(P) {
  const ease = (f) => f * f * (3 - 2 * f);
  const ramp = Array.from({ length: P.ROWS }, (_, k) => { const f = ease(k / (P.ROWS - 1)); return [0, 1, 2].map((i) => Math.round(P.SHALLOW[i] + (P.DEEP[i] - P.SHALLOW[i]) * f)); });
  return { ramp, rampFrom: "lake preset (picked)", deep: P.DEEP, shallow: P.SHALLOW, foam: [200, 205, 210], bed: P.SHALLOW, near: [], p90: [], rows: [] };
}

/** The lake preset: surface (the soil-bound shore field), the horizon band, the planar reflection. */
function buildLake(slot, { materials = [], info = {} }) {
  const t0 = performance.now();
  const { P, field, anchors: A } = slot.data;
  const nmaps = lakeNormalMaps(P);
  const refl = createPlanarReflection(P, {
    hide: (scene) => { const l = []; scene.traverse((o) => { if ((o.isMesh || o.isPoints) && P.HIDE_IN_REFLECTION.includes(o.userData?.kind)) l.push(o); }); return l; },
  });
  const geo = seaGeometry(field, P), mat = lakeMaterial(field, P, A, nmaps, refl);
  const sea = new THREE.Mesh(geo, mat);
  sea.name = "sea_surface"; sea.userData.kind = "sea"; sea.userData.preset = "lake"; sea.frustumCulled = false;
  sea.onBeforeRender = (renderer, scene, camera) => refl.render(renderer, scene, camera, sea);
  const bandGeo = bandGeometry(P), bandMat = bandMaterial(P);
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.name = "sea_horizon"; band.userData.kind = "sea"; band.frustumCulled = false;
  materials?.push(mat, bandMat);
  const meshes = [sea, band];
  const api = {
    objects: meshes, meshes, materials: [mat, bandMat], field,
    place(k) { info.water.keepOut = { fightR: k?.fightR ?? null }; },
    update() { info.water.time = S.U.uWindTime.value; info.water.reflection.passes = refl.passes; info.water.reflection.lastMs = +refl.lastMs.toFixed(3); },
    setLayer(name, on) { if (name === "water" || name === "sea") { for (const m of meshes) m.visible = on; return true; } return false; },
    lake: { ready: () => nmaps.ready(), reflection: refl, normalMaps: nmaps },
    info: null,
  };
  info.water = {
    preset: "lake", meshes: meshes.length, materials: 2, triangles: geo.userData.tris + bandGeo.userData.tris,
    sea: { r0: P.INNER, far: P.FAR_R, y: P.SEA_Y, sectors: P.SECTORS, rings: P.RINGS, tris: geo.userData.tris },
    band: { r: P.BAND_R, y: P.BAND_Y, tris: bandGeo.userData.tris },
    shore: { source: "soilLand", landCalls: field.landCalls, landR: field.landR, bakeMs: field.ms },
    reflection: { method: "Reflector.js (three r186, MIT): mirrored camera + oblique near plane, HalfFloat target", scale: P.REFL_SCALE, passes: 0, lastMs: 0, hides: P.HIDE_IN_REFLECTION },
    normalMaps: P.NORMAL_FILES, colour: { shallow: P.SHALLOW, deep: P.DEEP, picked: true },
    anchors: A, params: P, time: 0, keepOut: null, ms: Math.round(performance.now() - t0),
  };
  api.info = info.water;
  return api;
}

// ---------------- the layer ----------------
/** ASSET: the sea surface and the horizon band from the slot's data (web/built/place/water.js: preset, shore field,
 *  anchors, measured pieces). Returns { objects, meshes, place, update, setLayer, info, field, lake? }. */
export function buildWater(slot, ctx) {
  if (slot.data.preset === "lake") return buildLake(slot, ctx);   // the calm-lake preset (above); an ocean runs everything that follows unchanged
  const t0 = performance.now();
  const { materials = [], info = {} } = ctx;
  const { P, field, anchors: A, pieces } = slot.data;

  const seaGeo = seaGeometry(field, P), seaMat = seaMaterial(field, P, A);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.name = "sea_surface"; sea.userData.kind = "sea";
  sea.frustumCulled = false;

  const bandGeo = bandGeometry(P), bandMat = bandMaterial(P);
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.name = "sea_horizon"; band.userData.kind = "sea";
  band.frustumCulled = false;

  materials?.push(seaMat, bandMat);

  const meshes = [sea, band], mats = [seaMat, bandMat];
  const r0 = seaGeo.userData.r0;
  let rMin = Infinity, rMax = 0;
  for (const v of r0) { rMin = Math.min(rMin, v); rMax = Math.max(rMax, v); }
  // the recipe's own pieces, as measured (the cards the surface replaces): kept in the info so the checkers and the
  // report can name them, with the rows the colours came from
  const state = { fightR: null };
  const api = {
    objects: meshes, meshes,
    materials: mats,
    field,             // the one baked shore field these materials read (the checkers probe it, never re-bake it)
    /** the keep-out state from arena-built: only recorded - the sea is outside the fight by construction */
    place(k) {
      state.fightR = k?.fightR ?? null;
      info.water.keepOut = { fightR: state.fightR, waterlineMin: Math.round(rMin), clear: state.fightR == null ? null : Math.round(rMin - state.fightR) };
    },
    /** per frame: nothing to write (uTime IS the shared wind clock); the numbers the checkers read are kept fresh */
    update(camera, ms) {
      info.water.time = S.U.uWindTime.value;
    },
    /** the layer switch: "water" and "sea" both belong to this module's two meshes */
    setLayer(name, on) {
      if (name === "water" || name === "sea") { for (const m of meshes) m.visible = on; return true; }
      return false;
    },
    info: null,
  };
  info.water = {
    pieces, meshes: meshes.length, materials: mats.length,
    triangles: meshes.reduce((s, m) => s + m.geometry.userData.tris, 0),
    sea: { r0min: Math.round(rMin), r0max: Math.round(rMax), far: P.FAR_R, y: P.SEA_Y, sectors: P.SECTORS, rings: P.RINGS,
           tris: seaGeo.userData.tris, inner: r0 },
    band: { r: P.BAND_R, y: P.BAND_Y, tris: bandGeo.userData.tris },
    waterline: { sectors: field.wl.r.length, rMin: Math.round(Math.min(...field.wl.r)), rMax: Math.round(Math.max(...field.wl.r)),
                 sand: field.sand, banks: field.banks, outline: field.outline.length, bakeMs: field.ms },
    // the thin band at the real edge (units; 400 = 1 m): nothing is wet farther inland than wetMax
    swashBand: { runup: P.RUNUP, runupMax: Math.round(P.RUNUP * (1 + P.SET_K / 2)), damp: P.DAMP, wetMax: Math.round(WET_MAX),
                 surf: P.SURF_W, bore: P.BORE_W },
    anchors: A, params: P, shore: SHORE, time: 0, keepOut: null, ms: Math.round(performance.now() - t0),
  };
  api.info = info.water;
  api.place(slot.data.keepOut?.state || null);
  return api;
}
