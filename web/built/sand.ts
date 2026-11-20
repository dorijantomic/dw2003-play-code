// SAND ground and the SHORE band of the BUILT arena look (Arena Viewer look=built only; beach arenas, meft1002).
// Recipe kinds (tools/arena_built_recipe.py):
//   sand   the arena's own floor triangles (the fighters stand on them, y 0..4.5, r 224..4913)
//   shore  the band from the sand up to the grass (meft1002: r 3611-4911, y 4.5 -> 273, at the foot of the big rock
//          spire) — kept EXACTLY as it was: each vertex paints the measured colour of its picture row (recipe uvr and
//          rows), and the band carries aGreen (the measured green share of its row) for grass.js.
//
// WHAT CHANGED AND WHY (the brief: "flat grey with big white blobs and stripes; the original is warm beige with fine
// grain"). The old sand was two measured tones in HARD 3.6 m blobs plus 65 cm ripple stripes, both stepped by
// smoothstep(0.5 - fwidth, 0.5 + fwidth, fbm) — i.e. posterised noise, which is what read as grey plaster. The new one
// follows sand.md 7 (steps 1-6):
//   1 band-limit helper      blFade(): every procedural octave is faded to its mean by the pixel footprint
//                            (`smoothstep(s0, s1, fwidth(p) * k)`), so nothing crawls at 10-30 m (sand.md R1/R2)
//   2 Poly Haven CC0         aerial_beach_01 albedo + normal, 2 m tile (800 units), mipmaps + anisotropy 8, wrapped:
//                            the albedo's own RGB IS the paint (tinted to the measured colour, see below), the normal
//                            map is the grain
//   3 Journey two lobes      base lobe on the smooth (ripple) normal x detail lobe on the grain normal (GDC 2013 /
//                            AtwoodDeng SansRenderingShader.shader, CC-BY-SA-4.0: the STRUCTURE is copied, no line of
//                            its code — see sand.md C1 and its licence note), plus the modified Oren-Nayar diffuse
//                            (the normal's y squashed before it meets the shared light)
//   4 glitter                one fixed-cell noise, its CONTRAST faded by the footprint while its MEAN is kept
//                            (sand.md C6c, the Shadertoy ldlcRf / AtwoodDeng idea; no sharp texture tap, so no crawl)
//   5 wet band + sheen       from the SAME wetness the water reads (water.js SHORE_GLSL + WATER_BODY_GLSL): the sand
//                            within water.js WET_MAX (1.1 m) of the waterline is darker and glossier, and where the swash film covers
//                            it the sand is tinted by the water's own shallow body colour, with the foam edge on top
//                            (WaterThreeJS MIT src/Island.js 99-124 + Jensen 1999; the waterline is water.js's bake)
//   6 colour mottle          one band-limited octave at MOTTLE units, a gentle MULTIPLY (1 +- MOTTLE_K/2), so the
//                            beach varies at metre scale; its mean is 1, so the sand's average colour does not move
//
// THE PAINT IS THE CC0 PHOTO'S OWN COLOUR, TINTED TO THE PIECE'S MEASURED MEAN. Continuous, no threshold (the old paint
// thresholded a field at 0.5 into the piece's p10 / p90 tones: every pixel was one of two flat tones, which read as
// blotchy white/grey camouflage). Now: albedo = photo rgb (linear) x uTint, where uTint = srgb(piece `all`) / the
// photo's own linear mean RGB, measured once off the full-size decoded image when it loads (sandTextures(), mean
// [0.283, 0.237, 0.196] linear = [145,134,122] sRGB for aerial_beach_01). So the sand's mean colour IS the measured
// `all` ([202,200,164] on meft1002, warm beige) and every pixel carries the photo's real grain. CONTRAST scales each
// pixel's distance from that mean (mean kept; the photo alone spans only luminance p90/p10 = 1.21 at full size, the
// piece's measured p10..p90 span 2.0). The 2 m tile repeat is broken by a SECOND tap of the same photo at TILE2,
// turned ROT2 radians, swapped in by one band-limited noise at SWAP units (both taps have the same mean, so the swap
// cannot move it), plus the mottle. Before the photo loads (or if it fails) uTexOn = 0 and the sand paints the flat
// measured `all`. tools/verify_built_sand.mjs measures the mean, the continuity and the frame-to-frame stability.
//
// VALUES PICKED (not measured), render units (400 units = 1 m) unless said, all in SAND below:
//   TILE 800 (2 m, sand.md C2), TILE2 2090 (5.2 m), ROT2 0.61 rad (35 deg), SWAP 2600 (6.5 m), CONTRAST 1.5,
//   ANISO 8, GRAIN 26 (6.5 cm cells), GRAIN_K 0.10 (a +-5 % multiply), MOTTLE 1400 (3.5 m),
//   MOTTLE_K 0.20, NORMAL_K 0.55, GRAIN_TILT 0.16,
//   RIP_LEN 40 (10 cm, sand.md R5), RIP_AMP 1.8 (4.5 mm high: 1/22 of the spacing), RIP_WARP 260, RIP_CREST 0.55,
//   GLIT_CELL 11 (2.8 cm), GLIT_K 0.55, SPEC_BASE 90 (broad lobe), SPEC_DETAIL 620 (the grain's glint),
//   SPEC_K 1.1, DRY_K 0.30 (dry sand glints 30 % of wet), SHEEN_POW 42, SHEEN_K 0.30,
//   WET_BAND 900 (no longer read: the damp strip is water.js WATER.DAMP, one source), WET_DARK 0.55, WET_SAT 1.15 (the wet colour: darker and more saturated), FILM_FADE 120
//   (3 cm: the film's front), FILM_BED 0.75, FOAM_K 0.85, UP 0.45 (the Oren-Nayar squash of the normal's y).
import * as THREE from "../lib3d/three.module.js";
import * as S from "./shared.js";
import { shoreField, shoreUniforms, SHORE_GLSL, WATER_BODY_GLSL, anchors, WATER } from "./water.js";

export const SAND = {
  TILE: 800, ANISO: 8, ROWS: 8,
  TILE2: 2090, ROT2: 0.61, SWAP: 2600, CONTRAST: 1.5,
  GRAIN: 26, GRAIN_K: 0.10, MOTTLE: 1400, MOTTLE_K: 0.20,
  NORMAL_K: 0.55, GRAIN_TILT: 0.16,
  RIP_LEN: 40, RIP_AMP: 1.8, RIP_WARP: 260, RIP_CREST: 0.55,
  GLIT_CELL: 11, GLIT_K: 0.55,
  SPEC_BASE: 90, SPEC_DETAIL: 620, SPEC_K: 1.1, DRY_K: 0.30, SHEEN_POW: 42, SHEEN_K: 0.30,
  WET_BAND: 900, WET_DARK: 0.55, WET_SAT: 1.15, FILM_FADE: 120, FILM_BED: 0.75, FOAM_K: 0.85,
  UP: 0.45, RIM: 0.0,
  TEX: { dir: "assets-hd/battle/built/tex/", albedo: "aerial_beach_01_diff_2k.jpg", normal: "aerial_beach_01_nor_gl_2k.jpg",
         credit: "Poly Haven aerial_beach_01, CC0 (polyhaven.com/a/aerial_beach_01) - albedo + normal, 2 m tile" },
};

// ---------------- the CC0 textures (one pair per page, mipmapped + anisotropic) ----------------
let TEX = null;
/** The 2 m sand tile: albedo (sRGB) + normal (linear), RepeatWrapping, mipmaps, anisotropy 8 (three clamps it to the
 *  backend's maximum). Loaded once; `loaded` flips when both images are in (the checkers wait for it). */
export function sandTextures() {
  if (TEX) return TEX;
  const loader = new THREE.TextureLoader();
  // mean = the photo's mean linear RGB (null until read), albedoMean = its luminance (info only)
  const state = { albedo: null, normal: null, loaded: false, mean: null, albedoMean: null, px: 0, readMs: 0, credit: SAND.TEX.credit, error: null };
  let left = 2;
  const finish = () => {
    if (state.loaded || state.error) return;
    // the albedo's own mean RGB (LINEAR), read off the FULL-SIZE decoded image once (a downscaled drawImage would
    // average in sRGB and bias it): the paint's tint is the measured `all` divided by this, so the sand's mean colour
    // is the measured one whatever photo is loaded
    try {
      const t0 = performance.now();
      const img = state.albedo.image, w = img.width, h = img.height;
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      const lut = new Float64Array(256);
      for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += lut[d[i]]; gg += lut[d[i + 1]]; b += lut[d[i + 2]]; }
      const n = w * h;
      state.mean = [r / n, gg / n, b / n];
      state.albedoMean = 0.2126 * state.mean[0] + 0.7152 * state.mean[1] + 0.0722 * state.mean[2];
      state.px = w;
      state.readMs = Math.round(performance.now() - t0);
    } catch (e) { /* the image is there but unreadable (cross-origin): mean stays null, the sand paints the flat `all` */ }
    state.loaded = true;
  };
  const mk = (file, srgb) => {
    const t = loader.load(SAND.TEX.dir + file, () => { if (--left <= 0) finish(); }, undefined, () => { state.error = file; if (--left <= 0) finish(); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = SAND.ANISO;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.userData.file = file;
    return t;
  };
  state.albedo = mk(SAND.TEX.albedo, true);
  state.normal = mk(SAND.TEX.normal, false);
  TEX = state;
  return state;
}
/** Wait for the tile (the checkers call this instead of polling the flag). */
export function sandTexturesReady() {
  const t = sandTextures();
  return new Promise((res) => {
    if (t.loaded || t.error) return res(t);
    const tick = () => ((t.loaded || t.error) ? res(t) : setTimeout(tick, 30));
    tick();
  });
}

// ---------------- the paint: the CC0 photo's colour, tinted to the piece's measured mean ----------------
export const SAND_GLSL = /* glsl */`
  uniform vec3 uSandLo, uSandHi, uSandAll, uTint;
  uniform sampler2D uAlbedo, uNormal;
  uniform float uTexOn, uTile, uTile2, uRot2, uSwap, uContrast, uGrain, uGrainK, uMottle, uMottleK, uNormalK, uGrainTilt;
  uniform float uRipLen, uRipAmp, uRipWarp, uRipCrest, uGlitCell, uGlitK;
  uniform vec2 uRipDir;

  // THE BAND-LIMIT HELPER (sand.md C3, iq's 3tScWd rule, MIT): one octave's CONTRAST is faded to its mean by the
  // pixel's own footprint, before it can alias. s0/s1 in the same units as fp; returns 1 while the feature is
  // resolved (>= 2 px per period) and 0 once it is not.
  float blFade(float fp, float s0, float s1) { return 1.0 - smoothstep(s0, s1, fp); }

  // THE PAINT (linear): the photo's own rgb x uTint (mean = the measured piece colour uSandAll), continuous. Two taps
  // of the photo (the 2 m tile, and a larger turned one) swapped by one band-limited noise so the tile does not
  // repeat; contrast about the measured mean; then two gentle multiplies of mean 1 (mottle, grain), band-limited.
  // The texture taps are band-limited by their mips + anisotropy; every procedural octave by blFade().
  vec3 sandPaint(vec3 w) {
    vec2 p = w.xz;
    float fp = max(length(fwidth(p)), 1e-4);                       // units per pixel
    vec3 a = texture2D(uAlbedo, p / uTile).rgb;                    // the 2 m tile
    float cr = cos(uRot2), sr = sin(uRot2);
    vec3 b = texture2D(uAlbedo, mat2(cr, sr, -sr, cr) * p / uTile2 + vec2(0.37, 0.61)).rgb;   // the turned big tap
    float s = noise3(vec3(p / uSwap, 2.9));                        // which tap where (6.5 m blobs, soft edges)
    s = mix(0.5, s, blFade(fp, uSwap * 0.18, uSwap * 0.70));
    vec3 c = mix(a, b, smoothstep(0.30, 0.70, s)) * uTint;
    c = uSandAll + (c - uSandAll) * uContrast;
    float m = noise3(vec3(p / uMottle, 9.1));                      // the mottle (3.5 m)
    c *= 1.0 + (m - 0.5) * uMottleK * blFade(fp, uMottle * 0.18, uMottle * 0.70);
    float g = noise3(vec3(p / uGrain, 0.37));                      // the grain (6.5 cm)
    c *= 1.0 + (g - 0.5) * uGrainK * blFade(fp, uGrain * 0.45, uGrain * 1.25);
    return max(mix(uSandAll, c, uTexOn), vec3(0.0));               // flat measured colour until the photo is in
  }

  // WIND RIPPLES (sand.md R5): 10 cm apart, 4.5 mm high, in the NORMAL only (0.69 px of height at 10 m), their crests
  // warped by one noise octave so they split and terminate instead of running as rails, faded before they alias.
  float ripplePhase(vec2 p) { return dot(p, uRipDir) * 6.2831853 / uRipLen + (noise3(vec3(p / uRipWarp, 4.3)) - 0.5) * 4.0; }
  float rippleFade(vec3 w) { return blFade(length(fwidth(w.xz)), uRipLen * 0.16, uRipLen * 0.5); }
  // the crest's own mask: 1 on a crest, 0 in the trough (the paint probe's alpha, and the sheen's gate)
  float sandRipple(vec3 w) { return smoothstep(uRipCrest, 1.0, sin(ripplePhase(w.xz)) + 0.25 * sin(2.0 * ripplePhase(w.xz))) * rippleFade(w); }
  // the ripple normal's slope: d/dp of the asymmetric profile, along the ripple direction
  vec2 sandRippleGrad(vec3 w) {
    float ph = ripplePhase(w.xz);
    float d = cos(ph) + 0.5 * cos(2.0 * ph);
    return uRipDir * (d * 6.2831853 / uRipLen * uRipAmp * rippleFade(w));
  }
  // the sediment's own tilt under the normal map: one band-limited octave, faded by the footprint
  vec2 sandGrainGrad(vec3 w) {
    vec2 p = w.xz;
    float fp = length(fwidth(p));
    float e = max(fwidth(p.x), 1e-4);
    float n0 = noise3(vec3(p / uGrain, 1.7)), nx = noise3(vec3((p + vec2(e, 0.0)) / uGrain, 1.7)), nz = noise3(vec3((p + vec2(0.0, e)) / uGrain, 1.7));
    return vec2(nx - n0, nz - n0) / e * uGrainTilt * blFade(fp, uGrain * 0.4, uGrain * 1.1);
  }
  // GLITTER (sand.md C6c): one fixed-cell noise; as the footprint grows its CONTRAST dies but its MEAN is kept, so a
  // distant pixel gets the same light spread smoothly instead of a boiling pattern (and no texture tap can crawl)
  float sandGlitter(vec3 w) {
    float fp = length(fwidth(w.xz));
    float pat = smoothstep(0.60, 0.95, noise3(vec3(w.xz / uGlitCell, 0.77)));
    return mix(pat, 0.20, smoothstep(0.35, 1.6, fp / uGlitCell)) * uGlitK;
  }
`;

/** The shore's row table: the measured colour of the picture row, bin centres at (b + 0.5) / ROWS, linear between
 *  bins (the same interpolation rowValue() does on the CPU for aGreen). */
export const SHORE_ROW_GLSL = /* glsl */`
  uniform vec3 uRows[${SAND.ROWS}];
  vec3 shoreRow(float row) {
    float p = clamp(row * ${SAND.ROWS}.0 - 0.5, 0.0, ${SAND.ROWS - 1}.0);
    int i = int(floor(p)); int j = min(i + 1, ${SAND.ROWS - 1});
    vec3 a = uRows[0], b = uRows[0];
    for (int k = 0; k < ${SAND.ROWS}; k++) { if (k == i) a = uRows[k]; if (k == j) b = uRows[k]; }
    return mix(a, b, p - floor(p));
  }
`;

const FLAT_VS = /* glsl */`
  attribute float aRow;
  varying vec3 vW; varying vec3 vN; varying float vRow;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vRow = aRow;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** uTint = the measured piece colour / the photo's mean (both linear); uTexOn = 1 once the mean is read */
function setTint(u, tex) {
  if (!tex.loaded || !tex.mean) return;
  const all = u.uSandAll.value;
  u.uTint.value.set(all.r / Math.max(tex.mean[0], 1e-4), all.g / Math.max(tex.mean[1], 1e-4), all.b / Math.max(tex.mean[2], 1e-4));
  u.uTexOn.value = 1;
}

function sandUniforms(lo, hi, all, field, A = anchors(field.rec)) {
  const tex = sandTextures();
  const u = {
    ...shoreUniforms(field),
    uSandLo: { value: lo }, uSandHi: { value: hi }, uSandAll: { value: all },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uTexOn: { value: 0 },
    uAlbedo: { value: tex.albedo }, uNormal: { value: tex.normal },
    uTile: { value: SAND.TILE }, uTile2: { value: SAND.TILE2 }, uRot2: { value: SAND.ROT2 }, uSwap: { value: SAND.SWAP },
    uContrast: { value: SAND.CONTRAST },
    uGrain: { value: SAND.GRAIN }, uGrainK: { value: SAND.GRAIN_K },
    uMottle: { value: SAND.MOTTLE }, uMottleK: { value: SAND.MOTTLE_K },
    uNormalK: { value: SAND.NORMAL_K }, uGrainTilt: { value: SAND.GRAIN_TILT },
    uRipLen: { value: SAND.RIP_LEN }, uRipAmp: { value: SAND.RIP_AMP }, uRipWarp: { value: SAND.RIP_WARP },
    uRipCrest: { value: SAND.RIP_CREST }, uRipDir: S.U.uWindDir,
    uGlitCell: { value: SAND.GLIT_CELL }, uGlitK: { value: SAND.GLIT_K },
    // the water's own anchors: the swash film and the wet sand are painted with the SAME body colour as the sea
    uDeep: { value: S.srgb(A.deep) }, uShallow: { value: S.srgb(A.shallow) }, uBed: { value: S.srgb(A.bed) },
    uFoam: { value: S.srgb(A.foam) },
    uAbsorb: { value: WATER.ABSORB }, uBedSlope: { value: WATER.BED_SLOPE }, uBedK: { value: WATER.BED_K },
    uShallowK: { value: WATER.SHALLOW_K },
    uSpecBase: { value: SAND.SPEC_BASE }, uSpecDetail: { value: SAND.SPEC_DETAIL }, uSpecK: { value: SAND.SPEC_K },
    uDryK: { value: SAND.DRY_K }, uSheenPow: { value: SAND.SHEEN_POW }, uSheenK: { value: SAND.SHEEN_K },
    uWetBand: { value: SAND.WET_BAND }, uWetDark: { value: SAND.WET_DARK }, uWetSat: { value: SAND.WET_SAT },
    uFilmFade: { value: SAND.FILM_FADE }, uFilmBed: { value: SAND.FILM_BED }, uFoamK: { value: SAND.FOAM_K },
    uUp: { value: SAND.UP }, uRim: { value: SAND.RIM },
    uBedLuma: { value: (() => { const c = S.srgb(A.bed); return Math.max(0.05, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b); })() },
  };
  setTint(u, tex);
  return u;
}

function sandMaterial(lo, hi, all, field, A) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith(sandUniforms(lo, hi, all, field, A)),
    vertexShader: FLAT_VS,
    fragmentShader: /* glsl */`
      varying vec3 vW; varying vec3 vN; varying float vRow;
      uniform float uSpecBase, uSpecDetail, uSpecK, uDryK, uSheenPow, uSheenK, uWetBand, uWetDark, uWetSat;
      uniform float uFilmFade, uFilmBed, uFoamK, uUp, uRim, uBedLuma;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${SHORE_GLSL}
      ${WATER_BODY_GLSL}
      ${SAND_GLSL}
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        // ---- the waterline: ONE baked distance, the same the sea reads (water.js shoreField) ----
        // water.js sandWater(): x film, y foam edge, z wetness, already gated to the thin swash band at the real
        // water edge (none on the rest of the beach, none against the grass bank; water.js WATER.RUNUP / DAMP)
        vec3 sw = sandWater(vW.xz, uTime);
        float wet = sw.z;
        // ---- the paint: the CC0 photo tinted to the measured colour, then the wet look (darker, more saturated) ----
        vec3 alb = sandPaint(vW);
        alb *= mix(1.0, uWetDark, wet);
        alb = mix(alb, alb * alb * uWetSat * 2.0, wet * 0.55);
        // ---- the swash film: the water's own shallow body colour over the sand, and its foam edge on top ----
        float film = sw.x;
        float cover = smoothstep(0.0, uFilmFade, film);
        if (cover > 0.0) {
          vec3 under = filmBody(film, uSandHi, uBedLuma);
          alb = mix(alb, under, cover * uFilmBed);
          alb = mix(alb, uFoam, sw.y * uFoamK * (1.0 - cover * 0.35));
        }
        // ---- the normals: the ripples (smooth) and the grain (detail), Journey's two layers ----
        vec2 rip = sandRippleGrad(vW);
        vec3 nm = texture2D(uNormal, vW.xz / uTile).xyz * 2.0 - 1.0;
        vec2 grain = nm.xy * uNormalK + sandGrainGrad(vW);
        vec3 N = normalize(vec3(-rip.x, 1.0, -rip.y));                 // the smooth normal: the sheen's
        vec3 Nd = normalize(vec3(-(rip + grain).x, 1.0, -(rip + grain).y));   // the detailed normal: the glint's
        // ---- light: the SHARED one, with the Oren-Nayar/Journey squash of the normal's y (the terminator sits soft) ----
        vec3 Ns = normalize(vec3(Nd.x, Nd.y * uUp, Nd.z));
        vec3 col = toonLight(alb, Ns, V, vW, 1.0, uRim);
        // ---- the two-lobe specular (base x detail) + the glitter + the wet sheen ----
        vec3 H = normalize(uLightDir + V);
        float lo = pow(max(dot(N, H), 0.0), uSpecBase);
        float hi = pow(max(dot(Nd, H), 0.0), uSpecDetail);
        float glit = sandGlitter(vW);
        col += uLightColor * (lo * hi * uSpecK * (0.35 + 1.6 * glit) * mix(uDryK, 1.0, max(wet, cover)));
        col += uLightColor * pow(max(dot(N, H), 0.0), uSheenPow) * (wet * 0.6 + cover) * uSheenK;
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

function shoreMaterial(rows) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ uRows: { value: rows } }),
    vertexShader: FLAT_VS,
    fragmentShader: /* glsl */`
      varying vec3 vW; varying vec3 vN; varying float vRow;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${SHORE_ROW_GLSL}
      void main() {
        vec3 N = normalize(gl_FrontFacing ? vN : -vN);
        vec3 col = toonLight(shoreRow(vRow), N, normalize(cameraPosition - vW), vW, 1.0, 0.0);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

/** The paint ALONE — no light, no haze, no colour-space write — through the mesh material's OWN uniform objects and
 *  the same GLSL the material uses, so a checker reads the very paint the arena is drawn with:
 *  sand -> rgb = sandPaint(w), alpha = sandRipple(w); shore -> rgb = shoreRow(row), alpha = 1. */
export function paintProbeMaterial(mesh) {
  const shore = !!mesh.geometry.attributes.aGreen;
  return new THREE.ShaderMaterial({
    uniforms: mesh.material.uniforms,   // the SAME uniform objects: one paint, one set of numbers
    vertexShader: FLAT_VS,
    fragmentShader: shore
      ? /* glsl */`varying vec3 vW; varying vec3 vN; varying float vRow;
        ${SHORE_ROW_GLSL}
        void main() { gl_FragColor = vec4(shoreRow(vRow), 1.0); }`
      : /* glsl */`varying vec3 vW; varying vec3 vN; varying float vRow;
        ${S.NOISE_GLSL}
        ${S.LIGHT_GLSL}
        ${SAND_GLSL}
        void main() { gl_FragColor = vec4(sandPaint(vW), sandRipple(vW)); }`,
    side: THREE.DoubleSide,
  });
}

/** green share of a shore vertex = the measured green share of its picture row (same bin interpolation as the paint) */
export function rowValue(rows, row, get) {
  const n = rows.length, p = Math.min(n - 1, Math.max(0, row * n - 0.5)), i = Math.floor(p), j = Math.min(i + 1, n - 1);
  const a = get(rows[i] ?? rows.find(Boolean)), b = get(rows[j] ?? rows[i] ?? rows.find(Boolean));
  return a + (b - a) * (p - i);
}

/** Build the sand and shore meshes. Returns { meshes, ground, shore, update, info }. */
/** ASSET: the sand + shore surfaces from the slot's data (web/built/place/sand.js): one mesh per piece, named as the
 *  piece, the sand shader (shared waterline + water anchors) or the shore band's measured rows. */
export function buildSand(slot, { materials = [], info = {} } = {}) {
  const t0 = performance.now();
  const meshes = [], shore = [];
  const { pieces, field, anchors: A, sandHi } = slot.data;
  for (const p of pieces) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p.pos.slice(), 3));
    g.setAttribute("aRow", new THREE.BufferAttribute(p.row.slice(), 1));
    g.computeVertexNormals();
    const c = p.colours;
    const lo = S.srgb(c.p10 || c.all), hi = S.srgb(c.p90 || c.all), all = S.srgb(c.all || c.p90);
    let mat;
    if (p.rows) {
      // the band paints the piece's measured row colours EXACTLY (no pattern or jitter on top)
      mat = shoreMaterial(p.rows.map((rgb) => S.srgb(rgb)));
      g.setAttribute("aGreen", new THREE.BufferAttribute(p.green.slice(), 1));
    } else {
      mat = sandMaterial(lo, hi, all, field, A);
    }
    materials?.push(mat);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = p.name; mesh.userData.kind = p.kind;
    // grass.js reads bladeColours on the MESH (not on its geometry): the shore's measured greens
    if (p.blade) mesh.userData.bladeColours = p.blade;
    meshes.push(mesh);
    if (p.kind === "shore") shore.push(mesh);
  }
  const tex = sandTextures();
  const out = {
    meshes: meshes.length, shore: shore.length, triangles: meshes.reduce((s, m) => s + m.geometry.attributes.position.count / 3, 0),
    params: SAND, waterline: { bakeMs: field.ms, sectors: field.wl.r.length, rMin: Math.round(Math.min(...field.wl.r)), rMax: Math.round(Math.max(...field.wl.r)) },
    tex: { ready: tex.loaded, mean: tex.mean, albedoMean: tex.albedoMean, px: tex.px, readMs: tex.readMs, aniso: SAND.ANISO, tile: SAND.TILE, credit: SAND.TEX.credit },
    anchors: { lo: [...A.bed], hi: [...sandHi] },
    ms: Math.round(performance.now() - t0),
  };
  if (info) info.sand = out;
  return {
    objects: meshes, meshes,
    /** the tile finishes after the world is built: keep the flag the checkers wait on current, and once the photo's
     *  mean is read, set each sand material's tint (once: uTexOn flips to 1) */
    update() {
      const t = sandTextures();
      if (out.tex.ready !== t.loaded) out.tex.ready = t.loaded;
      if (!t.loaded || !t.mean || out.tex.mean) return;
      Object.assign(out.tex, { mean: t.mean, albedoMean: t.albedoMean, px: t.px, readMs: t.readMs });
      for (const m of meshes) { const u = m.material.uniforms; if (u?.uTint) setTint(u, t); }
    },
    dispose() { for (const m of meshes) m.geometry.dispose(); },
  };
}
/** ASSET for any other slot: a plain sand-coloured surface (no waterline there) */
export function sandSurfaceMaterial(colours) {
  const c = colours || { p10: [196, 176, 132], p90: [232, 214, 170] };
  const lo = S.srgb(c.p10 || c.all), hi = S.srgb(c.p90 || c.all);
  return lo.clone().lerp(hi, 0.5);
}
