// SOIL ground of the BUILT arena look (Arena Viewer look=built only): a forest floor of bare earth and leaf litter, for
// an arena whose recipe names its ground piece kind "soil" (meft1008, wall_02). Only that kind reaches this file, so
// every arena with a "grass" ground (meft1013) or no ground (meft1002) is untouched. ground.js builds the arena's own
// soil triangles (the fighters stand on them), bakes its mask as for any ground, and asks this file for:
//   soilMaterial()  the paint: Poly Haven brown_mud_leaves_01 (CC0, Rob Tuytel, polyhaven.com/a/brown_mud_leaves_01,
//                   licence polyhaven.com/license "Our assets are all licensed as CC0"; 13 x 13 m photogrammetry scan,
//                   2K diffuse + 2K nor_gl in assets-hd/battle/built/tex/, git-ignored) with sand.js's two-tap
//                   anti-tiling (iq's "texture repetition" technique 3 cut to two taps: the photo at TILE_A with a crop
//                   offset, a second tap at TILE_B turned ROT_B, swapped by one band-limited noise), the photo's own
//                   colour TINTED so its linear mean IS the piece's measured `all`, and its contrast about that mean
//                   SOLVED so the painted p10..p90 luma span equals the piece's measured p10..p90 luma span (the photo's
//                   own percentiles, read once off the full-size decoded image). No hard steps, no dirt/path/rock
//                   paint: the whole floor is one soil (the original's ground picture is one flat dark brown).
//   apron           a flat soil band under the tree ring (every upright card piece whose cards stand within
//                   CARD_R_MAX of the floor's rim), from APRON.IN inside to APRON.OUT outside each card line, only on
//                   the azimuths the cards cover and only where the floor does not already reach: the trees stand on
//                   soil, the lake bay (no cards there) stays open. Same material as the floor.
//   soilLand(rec)   the LAND outline (floor triangles + apron), for the lake builder: landAt(x, z), floorAt(x, z),
//                   apronRange(azDeg), and per 1 deg of azimuth the land intervals along the ray from the centre,
//                   the first lake radius (landEnd) and the floor-only one (floorEnd). Cached per recipe, so the lake
//                   module calling soilLand(ctx.rec) gets the very object ground.js built the apron from.
// No grass blades grow on soil: the soil material carries no uMask, so grass.js's groundMaskReader() returns null and
// the surface is skipped ("unmarked surface"), the same rule that keeps blades off a beach's sand.
// Azimuth az = atan2(x, z) in degrees (the recipe's `edge` convention); render units, 400 = 1 m, floor y 0.
//
// VALUES PICKED (not measured), render units: TILE_A 1800 (4.5 m = the original ground picture's own repeat, 88 texels
// at 19.47 texels/m, ground.md 0.2), OFF_A (0.13, 0.41), TILE_B 5400 (13.5 m ~ the scan's own 13 m), ROT_B 0.61 rad,
// SWAP 2400 (6 m), MOTTLE 1400 (3.5 m), MOTTLE_K 0.15, NORMAL_K 0.55, ANISO 8; apron IN 240 (0.6 m, a card is a chord: its ends stand 0.52 m outside its middle) / OUT 160 (0.4 m: a footing, not land; the original has lake past its shore, ~92% of the old 2.5 m apron was lake),
// STEP 1 deg x 100 units, CARD_R_MAX 1.10 of the floor rim; shore outline 1 deg x 20 units (0.05 m, MEASURE.md's step).
// MEASURED (per arena, at load): the tint target = the piece's `all`, the contrast target = its p10/p90 luma.
import * as THREE from "../lib3d/three.module.js";
import * as S from "./shared.js";

// Which recipe kinds may grow an apron under their cards: the TREE ring only (a fringe card stands in the lake).
export const APRON_KINDS = new Set(["tree", "treeline", "pine", "cypress_wall", "cypress_grove"]);

export const SOIL = {
  TILE_A: 1800, OFF_A: [0.13, 0.41], TILE_B: 5400, ROT_B: 0.61, SWAP: 2400,
  MOTTLE: 1400, MOTTLE_K: 0.15, NORMAL_K: 0.55, ANISO: 8,
  APRON: { IN: 240, OUT: 160, STEP_DEG: 1, STEP_R: 100, CARD_R_MAX: 1.10 },
  SHORE: { STEP_DEG: 1, STEP_R: 20, R_MAX: 12000 },
  TEX: { dir: "assets-hd/battle/built/tex/", albedo: "brown_mud_leaves_01_diff_2k.jpg", normal: "brown_mud_leaves_01_nor_gl_2k.jpg",
         credit: "Poly Haven brown_mud_leaves_01 (Rob Tuytel), CC0 (polyhaven.com/a/brown_mud_leaves_01) - 2K diffuse + nor_gl" },
};

const lumaLin = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linOf = (rgb) => rgb.map((v) => toLin(v / 255));

// ---------------- the CC0 photo (loaded once) ----------------
let TEX = null;
/** albedo (sRGB) + normal (linear), RepeatWrapping, mipmaps, anisotropy 8. When both are in: the albedo's linear mean
 *  RGB (full-size image, one pass) and a 1024-bin histogram of its luma per channel weight, kept so the contrast can be
 *  solved for any tint (soilTone()). `loaded` flips when both images are in (the checker waits on it). */
export function soilTextures() {
  if (TEX) return TEX;
  const loader = new THREE.TextureLoader();
  const st = { albedo: null, normal: null, loaded: false, mean: null, px: 0, readMs: 0, pixels: null, credit: SOIL.TEX.credit, error: null };
  let left = 2;
  const finish = () => {
    if (st.loaded || st.error) { st.loaded = true; return; }
    try {
      const t0 = performance.now();
      const img = st.albedo.image, w = img.width, h = img.height;
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = toLin(i / 255);
      // keep every pixel's linear rgb (decimated 2x2 for the percentile pass: 1M samples are plenty for p10/p90)
      const n = w * h, px = new Float32Array(Math.ceil(w / 2) * Math.ceil(h / 2) * 3);
      let r = 0, gg = 0, b = 0, k = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, R = lut[d[i]], G = lut[d[i + 1]], B = lut[d[i + 2]];
        r += R; gg += G; b += B;
        if (!(x & 1) && !(y & 1)) { px[k++] = R; px[k++] = G; px[k++] = B; }
      }
      st.mean = [r / n, gg / n, b / n];
      st.pixels = px.subarray(0, k);
      st.px = w; st.readMs = Math.round(performance.now() - t0);
    } catch (e) { st.error = "unreadable: " + String(e?.message || e).slice(0, 120); }
    st.loaded = true;
  };
  const mk = (file, srgb) => {
    const t = loader.load(SOIL.TEX.dir + file, () => { if (--left <= 0) finish(); },
                          undefined, () => { st.error = file; if (--left <= 0) finish(); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = SOIL.ANISO;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.userData.file = file;
    return t;
  };
  st.albedo = mk(SOIL.TEX.albedo, true);
  st.normal = mk(SOIL.TEX.normal, false);
  TEX = st;
  return st;
}
export function soilTexturesReady() {
  const t = soilTextures();
  return new Promise((res) => { const tick = () => ((t.loaded || t.error) ? res(t) : setTimeout(tick, 30)); tick(); });
}

/** The tone numbers for a piece: tint = measured `all` / photo mean (linear, per channel), and the contrast K that
 *  makes the tinted photo's luma p10..p90 span equal the piece's measured one (luma of its p10 and p90 colours).
 *  c' = all + (photo * tint - all) * K, so the mean stays `all` and the span becomes the measured span. */
export function soilTone(tex, colours) {
  const all = linOf(colours.all), lo = linOf(colours.p10 || colours.all), hi = linOf(colours.p90 || colours.all);
  const tint = [0, 1, 2].map((c) => all[c] / Math.max(tex.mean[c], 1e-5));
  const L = new Float32Array(tex.pixels.length / 3);
  for (let i = 0, j = 0; i < tex.pixels.length; i += 3, j++) L[j] = 0.2126 * tex.pixels[i] * tint[0] + 0.7152 * tex.pixels[i + 1] * tint[1] + 0.0722 * tex.pixels[i + 2] * tint[2];
  L.sort();
  const q = (p) => L[Math.min(L.length - 1, Math.floor(p * (L.length - 1)))];
  const photoSpan = q(0.9) - q(0.1), target = lumaLin(hi) - lumaLin(lo);
  const contrast = photoSpan > 1e-6 ? target / photoSpan : 1;
  return { tint, contrast, all, target: { p10: lumaLin(lo), p90: lumaLin(hi), span: target },
           photo: { p10: q(0.1), p50: q(0.5), p90: q(0.9), span: photoSpan } };
}

// ---------------- the paint ----------------
export const SOIL_GLSL = /* glsl */`
  uniform vec3 uSoilAll, uSoilTint;
  uniform sampler2D uSoilAlbedo, uSoilNormal;
  uniform float uSoilOn, uSoilTileA, uSoilTileB, uSoilRotB, uSoilSwap, uSoilContrast, uSoilMottle, uSoilMottleK, uSoilNormalK;
  uniform vec2 uSoilOffA;
  // an octave's contrast faded to its mean by the pixel footprint (sand.js blFade, iq's rule)
  float soilFade(float fp, float s0, float s1) { return 1.0 - smoothstep(s0, s1, fp); }
  // linear albedo: two crops of the photo swapped by one band-limited noise, tinted to the measured mean, contrast
  // about that mean, one gentle mottle of mean 1; the flat measured colour until the photo is in
  vec3 soilPaint(vec3 w) {
    vec2 p = w.xz;
    float fp = max(length(fwidth(p)), 1e-4);
    vec3 a = texture2D(uSoilAlbedo, p / uSoilTileA + uSoilOffA).rgb;
    float cr = cos(uSoilRotB), sr = sin(uSoilRotB);
    vec3 b = texture2D(uSoilAlbedo, mat2(cr, sr, -sr, cr) * p / uSoilTileB + vec2(0.37, 0.61)).rgb;
    float s = noise3(vec3(p / uSoilSwap, 2.9));
    s = mix(0.5, s, soilFade(fp, uSoilSwap * 0.18, uSoilSwap * 0.70));
    vec3 c = mix(a, b, smoothstep(0.30, 0.70, s)) * uSoilTint;
    c = uSoilAll + (c - uSoilAll) * uSoilContrast;
    float m = noise3(vec3(p / uSoilMottle, 9.1));
    c *= 1.0 + (m - 0.5) * uSoilMottleK * soilFade(fp, uSoilMottle * 0.18, uSoilMottle * 0.70);
    return max(mix(uSoilAll, c, uSoilOn), vec3(0.0));
  }
  // the floor is flat (y 0, normal +y): the photo's GL normal map in the xz plane (u along +x, v along +z),
  // its tilt scaled by uSoilNormalK; tap A only (the swap would need the normal turned with tap B)
  vec3 soilNormal(vec3 w) {
    vec3 nm = texture2D(uSoilNormal, w.xz / uSoilTileA + uSoilOffA).xyz * 2.0 - 1.0;
    return normalize(vec3(nm.x * uSoilNormalK * uSoilOn, max(nm.z, 0.2), nm.y * uSoilNormalK * uSoilOn));
  }
`;

const FLAT_VS = /* glsl */`
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

function setTone(u, tex, colours, info) {
  if (!tex.loaded || !tex.mean || !tex.pixels) return false;
  const t = soilTone(tex, colours);
  u.uSoilTint.value.set(...t.tint);
  u.uSoilContrast.value = t.contrast;
  u.uSoilOn.value = 1;
  if (info) info.tone = { tint: t.tint, contrast: t.contrast, target: t.target, photo: t.photo, mean: tex.mean, px: tex.px, readMs: tex.readMs };
  return true;
}

/** The soil material for a piece's measured colours (sRGB 0-255 `all`, `p10`, `p90`). One material serves the floor
 *  AND the apron (same uniform objects). update() sets the tint/contrast once the photo is in. */
export function soilMaterial(colours, info = {}) {
  const tex = soilTextures();
  const u = {
    uSoilAll: { value: S.srgb(colours.all) }, uSoilTint: { value: new THREE.Vector3(1, 1, 1) }, uSoilOn: { value: 0 },
    uSoilAlbedo: { value: tex.albedo }, uSoilNormal: { value: tex.normal },
    uSoilTileA: { value: SOIL.TILE_A }, uSoilOffA: { value: new THREE.Vector2(...SOIL.OFF_A) },
    uSoilTileB: { value: SOIL.TILE_B }, uSoilRotB: { value: SOIL.ROT_B }, uSoilSwap: { value: SOIL.SWAP },
    uSoilContrast: { value: 1 }, uSoilMottle: { value: SOIL.MOTTLE }, uSoilMottleK: { value: SOIL.MOTTLE_K },
    uSoilNormalK: { value: SOIL.NORMAL_K },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: S.uniformsWith(u),
    vertexShader: FLAT_VS,
    fragmentShader: /* glsl */`
      varying vec3 vW;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${SOIL_GLSL}
      void main() {
        vec3 alb = soilPaint(vW);
        vec3 N = soilNormal(vW);
        vec3 col = toonLight(alb, N, normalize(cameraPosition - vW), vW, 1.0, 0.0);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  mat.name = "soil";
  info.measured = { all: colours.all, p10: colours.p10, p90: colours.p90 };
  info.credit = SOIL.TEX.credit;
  const update = () => (u.uSoilOn.value ? true : setTone(u, tex, colours, info));
  if (!update()) soilTexturesReady().then(update);
  return { material: mat, update, uniforms: u };
}

/** The paint alone (linear rgb = soilPaint, no light, no haze) through the SAME uniform objects: for the checker. */
export function soilProbeMaterial(mesh) {
  return new THREE.ShaderMaterial({
    uniforms: mesh.material.uniforms,
    vertexShader: FLAT_VS,
    fragmentShader: /* glsl */`varying vec3 vW;
      ${S.NOISE_GLSL}
      ${SOIL_GLSL}
      void main() { gl_FragColor = vec4(soilPaint(vW), 1.0); }`,
    side: THREE.DoubleSide,
  });
}

// The LAND outline (soilLand) and the apron's triangles are PLACEMENT data: web/built/place/land.js (re-exported for
// older importers and the checkers).
export { soilLand, apronOutline } from "./place/land.js";

/** The apron mesh's geometry from its outline (web/built/place/land.js apronOutline): all at y 0, normal +y. */
export function apronGeometry(o) {
  const pos = o.pos, cellsKept = o.cellsKept, cellsOnFloor = o.cellsOnFloor;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos instanceof Float32Array ? pos : new Float32Array(pos), 3));
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  g.userData = { cellsKept, cellsOnFloor, tris: pos.length / 9 };
  return g;
}
