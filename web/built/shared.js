// Shared parts of the BUILT arena look (web/arena-built.js, Arena Viewer only). Every built material takes its
// shared uniforms from the ONE object `U` below (same uniform references, so one write per frame reaches all), and
// its GLSL from the strings here, so the ground, the trees and the sky cannot drift apart.
// Plan: ~/dw3-knowledge/research/PLAN-built-arena.md, Step 0.
//   noise    seeded value noise + fbm. The lattice is a 256-entry permutation shuffled once per seed (Fisher-Yates)
//            and handed to GLSL as a 256x1 texture, so noise3JS() gives the same numbers as the shader's noise3().
//   toonLight 3 bands (dark / shade / lit), the shadow folded in BEFORE banding, the shade colour = albedo times the
//            palette's shadow tint normalised to unit brightness (darker and cooler, never grey), sky fill from above,
//            warm ground bounce from below, a sun-side rim, a world-space brush jitter on the terminator that fades
//            out with the pixel footprint so it does not crawl. Model: summer-cycle `toonT` + `brush()`
//            (github.com/StarKnightt/summer-cycle, src/render/materials.ts, MIT, (c) 2026 Prasenjit), constants
//            from there; the footprint is in metres (400 units = 1 m) so their constants keep their meaning.
//            MeshToonMaterial is not used: its ramp reads the red channel only, so it cannot tint a shadow.
//   wind     one field ticked once per frame (uWindDir, uWindTime, uWindStrength, uWindGust). builtWind() bends a
//            plant in its OWN object space before the instance matrix: Crysis length-preserving main bend (GPU Gems
//            3 ch.16, maths only) + ez-tree's 3-harmonic leaf flutter (github.com/dgreenheck/ez-tree, MIT,
//            (c) Daniel Greenheck). Amplitudes are fractions of the plant's height.
//   palette  the recipe's measured colours, sRGB converted to linear once.
//   aerial   desaturate first, then lift toward the sky colour along the view ray, f = 1 - exp(-k d)
//            (sakura's applySkyAerial / aerialAt, MIT; k = 0.0022 per metre).
//   arenaMask is NOT here yet: it is a baked ground texture and belongs to Step 3 (ground, rocks, bank).
import * as THREE from "../lib3d/three.module.js";

export const UNITS_PER_M = 400;

// ---------------- noise ----------------
export function makePerm(seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  return p;
}
let PERM = makePerm(1);
const wrap = (v) => ((v % 256) + 256) % 256;
const h3 = (x, y, z) => PERM[wrap(PERM[wrap(PERM[wrap(x)] + y)] + z)] / 255;
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
export function noise3JS(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const X = wrap(ix), Y = wrap(iy), Z = wrap(iz), X1 = wrap(ix + 1), Y1 = wrap(iy + 1), Z1 = wrap(iz + 1);
  return lerp(lerp(lerp(h3(X, Y, Z), h3(X1, Y, Z), fx), lerp(h3(X, Y1, Z), h3(X1, Y1, Z), fx), fy),
              lerp(lerp(h3(X, Y, Z1), h3(X1, Y, Z1), fx), lerp(h3(X, Y1, Z1), h3(X1, Y1, Z1), fx), fy), fz);
}
export function fbm3JS(x, y, z) {
  let v = 0, a = 0.5;
  for (let k = 0; k < 4; k++) { v += a * noise3JS(x, y, z); x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return v;
}
const permTex = new THREE.DataTexture(new Uint8Array(256), 256, 1, THREE.RedFormat, THREE.UnsignedByteType);
permTex.magFilter = permTex.minFilter = THREE.NearestFilter; permTex.generateMipmaps = false;
export function initNoise(seed) {
  PERM = makePerm(seed);
  permTex.image.data.set(PERM); permTex.needsUpdate = true;
  U.uNoiseSeed.value = seed;
}

export const NOISE_GLSL = /* glsl */`
  uniform sampler2D uPerm;
  float permAt(float i) { return floor(texelFetch(uPerm, ivec2(int(i), 0), 0).r * 255.0 + 0.5); }
  float h3n(float x, float y, float z) { return permAt(mod(permAt(mod(permAt(x) + y, 256.0)) + z, 256.0)) / 255.0; }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = p - i;
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec3 a = mod(i, 256.0), b = mod(i + 1.0, 256.0);
    return mix(mix(mix(h3n(a.x, a.y, a.z), h3n(b.x, a.y, a.z), f.x), mix(h3n(a.x, b.y, a.z), h3n(b.x, b.y, a.z), f.x), f.y),
               mix(mix(h3n(a.x, a.y, b.z), h3n(b.x, a.y, b.z), f.x), mix(h3n(a.x, b.y, b.z), h3n(b.x, b.y, b.z), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { v += a * noise3(p); p *= 2.03; a *= 0.5; } return v; }
`;

// ---------------- the ONE shared uniform object ----------------
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (r, g, b) => new THREE.Color(r, g, b);
export const U = {
  uPerm: { value: permTex }, uNoiseSeed: { value: 1 },
  // light
  uSunDir: { value: v3(0.45, 0.8, 0.4).normalize() }, uSunColor: { value: new THREE.Color(1, 1, 1) },
  uShadowTint: { value: new THREE.Color(0.5, 0.5, 0.7) }, uShadowMix: { value: 0.35 }, uShadeK: { value: 0.62 },
  uShadeCore: { value: v3(0.7, 0.72, 0.84) }, uSkyFill: { value: new THREE.Color(0.4, 0.4, 0.8) },
  uGroundBounce: { value: v3(0.07, 0.045, 0.02) }, uRimColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uSoft: { value: 0.03 }, uPaint: { value: 1.0 },
  // what LIGHTS the scene now (the sun by day, the moon by night): written only by setBuiltLight() below, read by
  // toonLight. uSunDir above stays the sun (sky.js places the moon and the warm haze from it).
  uLightDir: { value: v3(0.45, 0.8, 0.4).normalize() }, uLightColor: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: new THREE.Color(1, 1, 1) },   // multiplies the shade bands (1 by day = today's look)
  uUnlitK: { value: new THREE.Color(1, 1, 1) },    // multiplies painted unlit parts (the far hills)
  // sky / aerial
  uSkyZenith: { value: new THREE.Color(0.1, 0.1, 0.6) }, uSkyHorizon: { value: new THREE.Color(0.3, 0.3, 0.7) },
  uHaze: { value: new THREE.Color(0.3, 0.3, 0.7) }, uAerialK: { value: 0.0022 / UNITS_PER_M }, uAerialDesat: { value: 0.5 },
  // wind
  uWindDir: { value: new THREE.Vector2(1, 0.4).normalize() }, uWindTime: { value: 0 },
  uWindStrength: { value: 0.03 }, uWindGust: { value: 0.3 }, uWindBend: { value: 0.2 },
  uWindPhaseScale: { value: 1500 }, uWindFreq: { value: 0.9 },
  uWindRing: { value: 0 },   // the shared travelling gust's depth (0 = off; web/built/trees.js sets it on meft1008)
};
// ---------------- the sky's ONE colour function (dome, haze, water) ----------------
// Lives here, not in sky.js, because the haze must read the SAME radiance the dome draws: LIGHT_GLSL below embeds
// SKY_GLSL and its aerial() lifts distant colours toward skyRadiance(), so ground, grass, trees, the hills and the
// dome agree over the whole sky, not only at the horizon. Whether it is day or night (and where the moon and the
// stars stand) is decided in sky.js from the recipe's measured ring colours (SKY_U below only holds the numbers).
const RING_MAX = 8;
export const SKY_U = {
  // gradient (sakura constants; uHorizon / uZenith are solved by sky.js calibrate(), uMid set from the two targets)
  uHorizon: { value: col(0.1, 0.1, 0.5) }, uZenith: { value: col(0.1, 0.1, 0.5) }, uMid: { value: col(0.1, 0.1, 0.5) },
  uMidAmt: { value: 0.16 }, uZenithPow: { value: 0.42 }, uZenDeep: { value: 0.80 },
  uHazeH: { value: 0.055 }, uHazeAmt: { value: 0.46 }, uHazeWarmK: { value: 0.80 },
  uHazeWarm: { value: col(0.10, 0.06, 0.02) },                       // PICKED (nothing warm is measured)
  // the glow lobe (Samurai names; values PICKED). uGlowDir is the sun by day and the MOON at night: the glow is
  // whatever lights the sky, so the haze and the water glow toward the same place the dome does.
  uGlowDir: { value: v3(0.45, 0.8, 0.4).normalize() },
  uSunGlowColor: { value: col(1.0, 0.85, 0.6) }, uSunGlow: { value: 0.30 }, uSunGlowPower: { value: 8.0 },
  uBroadGlow: { value: 0.03 }, uSunBleed: { value: 0.35 },
  // night (PICKED; off unless the measured ring says night): moon disc against the light, three-tier stars
  uMoonDir: { value: v3(0, 1, 0) }, uMoonColor: { value: col(0.92, 0.95, 1.0) },
  uMoonRadius: { value: 0.055 }, uMoonAmt: { value: 0.0 },
  uStarTex: { value: null }, uStarAmt: { value: 0.0 },
  uStarTint0: { value: col(0.72, 0.80, 1.00) }, uStarTint1: { value: col(0.88, 0.92, 1.00) },
  uStarTint2: { value: col(1.00, 0.97, 0.90) },
  // clouds
  uNoiseA: { value: null }, uNoiseC: { value: null }, uGradS: { value: 1 }, uPxRad: { value: 0.001 },
  uCloudAmt: { value: 1.0 }, uCloudLitK: { value: 1.0 }, uCloudCoreK: { value: 0.88 }, uCloudFormK: { value: 0.80 },
  uCloudShadeK: { value: 0.50 },
  uCloudLit: { value: col(0.8, 0.8, 0.8) }, uCloudAmb: { value: col(0.7, 0.7, 0.8) }, uCloudDark: { value: col(0.4, 0.4, 0.6) },
  // per deck: A = kf, pw, uv scale, drift speed; B = coverage at the ring top, relief, opacity, stretch;
  //           C = warp, detail, aerial wash, unused. Deck 0 = near cumulus, deck 1 = cirrus (sakura decks 0 and 3).
  uDeckA: { value: [new THREE.Vector4(0.300, 0.55, 1.05, 0.0135), new THREE.Vector4(0.090, 0.72, 3.60, 0.0062)] },
  uDeckB: { value: [new THREE.Vector4(0.40, 1.60, 1.00, 1.0), new THREE.Vector4(0.762, 0.45, 0.15, 2.2)] },
  uDeckC: { value: [new THREE.Vector4(0.30, 0.22, 0.45, 0), new THREE.Vector4(0.50, 0.30, 0.60, 0)] },
  // the arena's sky ring (render units): profile [height, radius], the eye in the ring's frame, the band heights
  uRing: { value: Array.from({ length: RING_MAX }, () => new THREE.Vector2()) }, uRingN: { value: 0 },
  uRingEye: { value: v3(0, 0, 0) }, uRingT: { value: 1e5 }, uBandY: { value: new THREE.Vector2(0, 1) },
  uBandS: { value: new THREE.Vector2(-1, 1) },   // ray slopes dy/|dxz| outside which no ray can meet the band
  uBandRamp: { value: 0.75 }, uBandTop: { value: 0.03 },   // PICKED shape: coverage full at 75 % of the band, fade in the top 3 %
  // BAND MODE (sky.js turns it on only when the recipe's sky piece floats above the floor, ymin > 0: a painted sky
  // band standing on top of a treeline band, meft1008). 0 = the code path above, untouched (bit-identical).
  // In band mode the colour is read from the HEIGHT where the view ray meets the sky ring (a cylinder of radius
  // uRing[0].y), like the painted band itself: uHorizon / uMid / uZenith = the measured bottom-quarter / median /
  // top-quarter colours at band share BAND_BOTTOM_SHARE (0.18) / 0.5 / 0.875; uHaze (the arena background, = the lake)
  // above the band and below the ring's foot (y 0).
  uBandMix: { value: 0 },
  uBandBelow: { value: -0.1875 },   // band share the bottom segment is extrapolated down to (then held): MEASURED, see sky.js
  uBandSoft: { value: 400 },        // render units above the ring foot over which the sky fades into the lake colour (PICKED 1 m)
  uBandFade: { value: 296 },        // render units above the band top over which it fades into the background (PICKED 1/10 band)
  uBandGlowK: { value: 0 },         // share of the sun glow kept in band mode (0 = the measured colours exactly)
  // subtle band clouds (three.js examples/jsm/objects/Sky.js cloud shading, MIT; band mode only, amount 0 elsewhere)
  uSkyClAmt: { value: 0 }, uSkyClCover: { value: 0.35 }, uSkyClDensity: { value: 0.4 }, uSkyClScale: { value: 1 / 2400 },
  uSkyClStretch: { value: 2.2 }, uSkyClSpeed: { value: 40 }, uSkyClSilver: { value: 0.6 }, uSkyClFex: { value: 0.85 },
  uSkyClGain: { value: 1.0 },
};
export const SKY_RING_MAX = RING_MAX;
// BAND MODE's bottom stop: the share of the band height where the measured bottom-quarter colour sits. The
// bottom quarter's centre would be 0.125, but the picture is FLAT at its foot ([184,176,224] over the lowest
// 22 % of the band, MEASURE.md 2c/2a) and only then starts to climb, so a ramp anchored at 0.125 runs about one
// palette step (8/255) bright at 8.6-9.8 m. 0.18 (the flat stretch's own upper end) fits every measured texel row
// to < 7/255: tools/verify_built_sky_band.mjs, check "band rows vs dome".
export const BAND_BOTTOM_SHARE = 0.18;

export const SKY_GLSL = /* glsl */`
  uniform vec3 uHorizon, uZenith, uMid, uHazeWarm, uSunGlowColor, uGlowDir, uMoonDir, uMoonColor;
  uniform vec3 uStarTint0, uStarTint1, uStarTint2;
  uniform float uMidAmt, uZenithPow, uZenDeep, uHazeH, uHazeAmt, uHazeWarmK, uSunGlow, uSunGlowPower, uBroadGlow;
  uniform float uMoonRadius, uMoonAmt, uStarAmt;
  uniform sampler2D uStarTex;
  uniform vec2 uRing[${RING_MAX}]; uniform int uRingN; uniform vec3 uRingEye; uniform vec2 uBandY;
  uniform float uBandMix, uBandBelow, uBandSoft, uBandFade, uBandGlowK;
  float skySat(float x) { return clamp(x, 0.0, 1.0); }
  float skyLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // band mode: distance along rd from the ring-frame eye to the ring cylinder (radius uRing[0].y), closed form
  float skyBandT(vec3 rd) {
    vec2 e = uRingEye.xz, d = rd.xz; float R = uRing[0].y;
    float a = dot(d, d), b = dot(e, d), c = dot(e, e) - R * R;
    if (a < 1e-8) return 1e9;
    return (-b + sqrt(max(b * b - a * c, 0.0))) / a;
  }
  float skyBandH(vec3 rd) { return clamp(uRingEye.y + min(skyBandT(rd), 1e9) * rd.y, -1e8, 1e8); }
  vec3 skyBand(vec3 rd) {                           // the painted band's colour at the height the ray meets the ring
    float h = skyBandH(rd);
    float f = max((h - uBandY.x) / max(uBandY.y - uBandY.x, 1e-3), uBandBelow);
    vec3 c = f < 0.5 ? mix(uHorizon, uMid, (f - ${BAND_BOTTOM_SHARE.toFixed(3)}) / ${(0.5 - BAND_BOTTOM_SHARE).toFixed(3)}) : mix(uMid, uZenith, min((f - 0.5) / 0.375, 1.0));
    c = max(c, vec3(0.0));
    c = mix(c, uHaze, smoothstep(uBandY.y, uBandY.y + uBandFade, h));   // above the band: the background
    return mix(uHaze, c, smoothstep(0.0, uBandSoft, h));                // below the ring foot: the lake (exactly)
  }
  float skyGlowK() { return uBandMix > 0.0 ? mix(1.0, uBandGlowK, uBandMix) : 1.0; }
  vec3 skyGradient(vec3 rd) {                       // sakura skyGradient(): no sun, no clouds
    float ey = max(rd.y, 0.0);
    float t = pow(ey, uZenithPow);
    vec3 c = mix(uHorizon, uZenith, t);
    c = mix(c, uMid, (1.0 - abs(t * 2.0 - 1.0)) * uMidAmt);
    float td = smoothstep(0.36, 0.82, t);            // value drop toward the zenith, then re-saturate
    c *= mix(1.0, uZenDeep, td);
    float lz = skyLuma(c);
    c = mix(vec3(lz), c, 1.0 + td * (1.0 - uZenDeep) * 1.75);
    float am = 1.0 / (ey + 0.10);                     // Rayleigh flavour without a physical model
    vec3 ext = exp(-vec3(0.030, 0.072, 0.170) * (am - 1.0));
    c *= mix(vec3(1.0), ext / max(max(ext.r, ext.g), ext.b), 0.26);
    float hb = exp(-max(rd.y, -0.06) / uHazeH);       // haze band hugging the horizon, warm on the sun's side only
    vec2 dxz = normalize(vec2(rd.x, rd.z) + 1e-5);
    vec2 sxz = normalize(vec2(uSunDir.x, uSunDir.z) + 1e-5);
    float azi = pow(max(dot(dxz, sxz), 0.0), 2.2);
    c = mix(c, uHaze, skySat(hb * uHazeAmt));
    c += uHazeWarm * hb * azi * uHazeAmt * uHazeWarmK;
    if (uBandMix > 0.0) c = mix(c, skyBand(rd), uBandMix);   // band mode only (0 elsewhere: this line does nothing)
    return c;
  }
  vec3 skySunGlow(vec3 rd) {                         // the glow of whatever lights the sky (sun by day, moon by night)
    float s = max(dot(rd, uGlowDir), 0.0);
    return uSunGlowColor * (pow(s, uSunGlowPower) * uSunGlow + s * s * uBroadGlow);
  }
  vec3 skyMoon(vec3 rd) {                            // the disc: a hard edge at sin(radius); uMoonAmt 0 by day
    if (uMoonAmt <= 0.0) return vec3(0.0);
    float c = dot(rd, uMoonDir);
    float dd = sqrt(max(1.0 - c * c, 0.0));          // sin(angle from the moon's centre)
    float disc = 1.0 - smoothstep(uMoonRadius * 0.94, uMoonRadius * 1.06, dd);   // half brightness exactly at the radius
    float limb = 1.0 - 0.14 * smoothstep(0.0, uMoonRadius, dd);                  // a limb, not a sticker
    return uMoonColor * disc * limb * uMoonAmt;
  }
  vec3 skyStars(vec3 rd) {                           // three tiers baked in one equirect texture: R / G / B
    if (uStarAmt <= 0.0 || rd.y <= 0.02) return vec3(0.0);
    float u = atan(rd.z, rd.x) * 0.15915494 + 0.5;
    float v = asin(clamp(rd.y, -1.0, 1.0)) * 0.31830989 + 0.5;
    vec3 s = texture2D(uStarTex, vec2(u, v)).rgb;
    return (s.r * uStarTint0 + s.g * uStarTint1 + s.b * uStarTint2) * (uStarAmt * smoothstep(0.02, 0.10, rd.y));
  }
  vec3 skyRadiance(vec3 rd) { return skyGradient(rd) + skySunGlow(rd) * skyGlowK(); }   // what haze and water read: no clouds, no disc, no stars
`;

/** The shared uniforms plus a material's own: the shared ones keep their object reference. The sky's uniforms come
 *  along too: the haze (aerial, below) reads the sky's own radiance, so every lit material needs them. */
export const uniformsWith = (own = {}) => Object.assign({}, U, SKY_U, own);

// ---------------- palette ----------------
export const srgb = (c, k = 1) => new THREE.Color().setRGB(c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k, THREE.SRGBColorSpace);
/** Colours measured by tools/arena_built_recipe.py (sRGB 0-255), converted to linear once, into named slots. */
export function makePalette(rec) {
  const by = (kind) => rec.pieces.filter((p) => p.kind === kind);
  const one = (kind) => by(kind)[0]?.colours;
  const bg = rec.bg || [96, 88, 200];
  const sky = one("sky"), haze = one("haze"), grass = one("grass"), tree = one("tree") || one("treeline"),
        line = one("treeline") || tree, pine = one("pine") || tree, bank = one("bank");
  const pick = (c, k, d) => c?.[k] || d;
  const pal = {
    skyZenith: srgb(bg), skyHorizon: srgb(pick(sky, "bottom", bg)), cloud: srgb(pick(sky, "p90", bg)),
    cloudShade: srgb(pick(sky, "top", bg), 0.85), haze: srgb(pick(haze, "all", bg)),
    shadowTint: srgb(pick(sky, "all", bg)), skyFill: srgb(pick(sky, "all", bg)),
    grassLo: srgb(pick(grass, "p10", [90, 120, 60])), grassHi: srgb(pick(grass, "p90", [110, 150, 80])),
    bark: srgb(pick(tree, "other", [70, 52, 44])),
    crownShade: srgb(pick(tree, "p10", [40, 60, 40])), crownMid: srgb(pick(tree, "green", [70, 100, 60])),
    crownLit: srgb(pick(tree, "top", [90, 125, 80])),
    lineMid: srgb(pick(line, "green", [70, 100, 60])), lineLit: srgb(pick(line, "top", [90, 125, 80])),
    needleMid: srgb(pick(pine, "green", [60, 80, 55])), needleLit: srgb(pick(pine, "top", [90, 110, 75])),
    needleBark: srgb(pick(pine, "other", [56, 48, 45])),
    bushMid: srgb(pick(bank, "green", [100, 135, 75])), bushLit: srgb(pick(bank, "green", [100, 135, 75]), 1.15),
  };
  U.uSkyZenith.value.copy(pal.skyZenith); U.uSkyHorizon.value.copy(pal.skyHorizon); U.uHaze.value.copy(pal.haze);
  U.uShadowTint.value.copy(pal.shadowTint); U.uSkyFill.value.copy(pal.skyFill);
  DAY_PAL = { shadowTint: pal.shadowTint.clone(), skyFill: pal.skyFill.clone(), haze: pal.haze.clone(),
              skyZenith: pal.skyZenith.clone(), skyHorizon: pal.skyHorizon.clone() };
  return pal;
}

// ---------------- the ONE light state (sun by day, moon by night) ----------------
// Every lit built material reads it through the shared uniforms above (uLightDir / uLightColor / uAmbient /
// uShadowTint / uSkyFill / uGroundBounce / uRimColor / uUnlitK); battle3d gets the same light via modelLight().
// DAY = today's values exactly (the day look does not change). NIGHT: the key comes FROM THE MOON's direction
// (SKY_U.uMoonDir, placed by sky.js). Hues from sakura-idle (github.com/danmana/sakura-idle, MIT, as quoted in
// ~/dw3-knowledge/research/r1/sky.md 6.2): moon 0x9fb6e8, night shadow tint 0x6e76a8, night fog 0x1b2440.
// Every strength below is PICKED (nothing night-lit is measured on this arena).
let DAY_PAL = null;   // the palette's measured day colours (makePalette), so night -> day restores them
export const NIGHT_LIGHT = {
  KEY_HUE: [0x9f, 0xb6, 0xe8],   // sRGB, sakura moon
  KEY_K: 0.45,                    // PICKED: moon key strength (linear), the sun's is 1
  AMBIENT_K: 0.18,                // PICKED: shade bands x this (the day's are x 1)
  SHADOW_TINT: [0x6e, 0x76, 0xa8],// sRGB, sakura night shadow tint
  SKY_FILL: [0x1b, 0x24, 0x40],   // sRGB, sakura night fog
  BOUNCE_K: 0.1,                  // PICKED: warm ground bounce x this
  RIM_K: 0.45,                    // PICKED: rim = moon hue x this
  UNLIT_K: 0.45,                  // PICKED: unlit painted hills = moon hue x this
  // forced night on a DAY arena only: the calibrated day sky is desaturated toward its luma by SKY_SAT and
  // multiplied by SKY_GAIN (both PICKED), the moon glow scaled with it, so it reads as night, not as a blue day
  SKY_SAT: 0.35, SKY_GAIN: [0.10, 0.13, 0.26],
};
const DAY_LIGHT = { dir: U.uSunDir.value.clone(), colour: [1, 1, 1], ambient: [1, 1, 1], bounce: [0.07, 0.045, 0.02],
                    rim: [1, 0.95, 0.85], unlit: [1, 1, 1] };
/** The light state now (for checks): mode, whether the sky got the night grade, the numbers written. */
export const light = { mode: "day", skyGraded: false, gradedFor: null };
const lumaJS = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
function gradeNight(c) {   // forced-night sky grade, in place, on a THREE.Color
  const l = lumaJS(c), s = NIGHT_LIGHT.SKY_SAT, g = NIGHT_LIGHT.SKY_GAIN;
  c.setRGB((l + (c.r - l) * s) * g[0], (l + (c.g - l) * s) * g[1], (l + (c.b - l) * s) * g[2]);
}
/** Light the built world from the sky's mode. skyNight = the sky's info.night ({mode, measured}); call it after every
 *  sky (re)build. Day writes today's values back; night lights from the moon. A night FORCED on a measured-day arena
 *  also darkens and cools the freshly calibrated sky stops and the haze (once per sky build: skyInfo is the key). */
export function setBuiltLight(skyNight, skyInfo = null) {
  const night = skyNight?.mode === "night";
  const N = NIGHT_LIGHT;
  if (night) {
    const hue = srgb(N.KEY_HUE);
    U.uLightDir.value.copy(SKY_U.uMoonDir.value).normalize();
    U.uLightColor.value.copy(hue).multiplyScalar(N.KEY_K);
    U.uAmbient.value.setRGB(N.AMBIENT_K, N.AMBIENT_K, N.AMBIENT_K);
    U.uShadowTint.value.copy(srgb(N.SHADOW_TINT));
    U.uSkyFill.value.copy(srgb(N.SKY_FILL));
    U.uGroundBounce.value.set(...DAY_LIGHT.bounce.map((v) => v * N.BOUNCE_K));
    U.uRimColor.value.copy(hue).multiplyScalar(N.RIM_K);
    U.uUnlitK.value.copy(hue).multiplyScalar(N.UNLIT_K);
  } else {
    U.uLightDir.value.copy(DAY_LIGHT.dir);
    U.uLightColor.value.setRGB(...DAY_LIGHT.colour);
    U.uAmbient.value.setRGB(...DAY_LIGHT.ambient);
    if (DAY_PAL) { U.uShadowTint.value.copy(DAY_PAL.shadowTint); U.uSkyFill.value.copy(DAY_PAL.skyFill); }
    U.uGroundBounce.value.set(...DAY_LIGHT.bounce);
    U.uRimColor.value.setRGB(...DAY_LIGHT.rim);
    U.uUnlitK.value.setRGB(...DAY_LIGHT.unlit);
  }
  // the palette's flat sky pair and the haze: day values first, graded below if night is forced on a day arena
  if (DAY_PAL) { U.uHaze.value.copy(DAY_PAL.haze); U.uSkyZenith.value.copy(DAY_PAL.skyZenith); U.uSkyHorizon.value.copy(DAY_PAL.skyHorizon); }
  const grade = night && skyNight?.measured === "day";
  if (grade) {
    for (const c of [U.uHaze.value, U.uSkyZenith.value, U.uSkyHorizon.value]) gradeNight(c);
    if (skyInfo && light.gradedFor !== skyInfo) {   // the sky stops are rewritten by each sky build: grade them once
      const z0 = lumaJS(SKY_U.uZenith.value);
      for (const c of [SKY_U.uHorizon.value, SKY_U.uZenith.value, SKY_U.uMid.value]) gradeNight(c);
      const k = z0 > 0 ? lumaJS(SKY_U.uZenith.value) / z0 : 1;
      SKY_U.uSunGlow.value *= k; SKY_U.uBroadGlow.value *= k;   // the halo keeps its share of the sky
      light.gradedFor = skyInfo;
    }
  } else light.gradedFor = null;
  light.mode = night ? "night" : "day"; light.skyGraded = grade;
  return light;
}
const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
/** The same light for battle3d's Digimon (they shade sRGB texels): the direction (render space = this world's), the
 *  lit multiplier and the shade multiplier, both as toonLight makes them on a white albedo, sRGB-encoded. */
export function modelLight() {
  const st = U.uShadowTint.value, l = Math.max(lumaJS(st), 1e-4), m = U.uShadowMix.value, k = U.uShadeK.value, a = U.uAmbient.value;
  const sh = [st.r, st.g, st.b].map((v, i) => (1 + (v / l - 1) * m) * k * [a.r, a.g, a.b][i]);
  const lc = U.uLightColor.value;
  return { dir: U.uLightDir.value.toArray(), colour: [lc.r, lc.g, lc.b].map(enc), ambient: sh.map(enc) };
}

// ---------------- light + aerial GLSL (fragment side) ----------------
export const LIGHT_GLSL = /* glsl */`
  uniform vec3 uSunDir, uSunColor, uShadowTint, uShadeCore, uSkyFill, uGroundBounce, uRimColor;
  uniform vec3 uLightDir, uLightColor, uAmbient, uUnlitK;
  uniform float uShadowMix, uShadeK, uSoft, uPaint;
  uniform vec3 uSkyZenith, uSkyHorizon, uHaze; uniform float uAerialK, uAerialDesat;
  float lumaB(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // summer-cycle brush(): two octaves in a stretched frame, each faded to its mean by the pixel footprint (metres)
  float brushB(vec3 wpos) {
    #ifdef TOON_LEAF
      return 0.5;   // leaves: no per-pixel brush noise (plan: TOON_LEAF has the jitter off)
    #endif
    vec3 wm = wpos / ${UNITS_PER_M.toFixed(1)};
    float fp = length(wpos - cameraPosition) / ${UNITS_PER_M.toFixed(1)} * 0.0011;
    float k1 = 1.0 - smoothstep(0.25, 0.6, fp * 6.0), k2 = 1.0 - smoothstep(0.25, 0.6, fp * 13.0);
    vec2 q = vec2(wm.x * 0.8 + wm.z * 0.6, wm.y + 0.3 * (wm.z * 0.8 - wm.x * 0.6));
    return 0.5 + (noise3(vec3(q * vec2(1.1, 6.0), 3.7)) - 0.5) * 0.6 * k1 + (noise3(vec3(q * vec2(2.3, 13.0), 9.1)) - 0.5) * 0.4 * k2;
  }
  vec3 toonLight(vec3 base, vec3 N, vec3 V, vec3 wpos, float sunVis, float rimAmt) {
    float br = brushB(wpos);
    float t = dot(N, uLightDir) + (br - 0.5) * 0.32 * uPaint;
    t = min(t, mix(-1.0, 1.0, sunVis));                       // shadow folded in before banding
    float lit = smoothstep(0.02 - uSoft, 0.06 + uSoft, t);
    float mid = smoothstep(-0.5 - uSoft, -0.44 + uSoft, t);
    vec3 tintN = uShadowTint / max(lumaB(uShadowTint), 1e-4);  // unit brightness: only the hue shifts
    float al = lumaB(base);
    float chroma = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
    float whiteK = smoothstep(0.35, 0.75, al) * (1.0 - smoothstep(0.12, 0.3, chroma));
    vec3 cSh = base * mix(mix(vec3(1.0), tintN, uShadowMix), vec3(0.6, 0.65, 0.84), whiteK) * uShadeK * uAmbient;
    vec3 cDk = cSh * uShadeCore;
    vec3 col = mix(cDk, cSh, mid);
    col = mix(col, base * uLightColor, lit);
    col += base * uSkyFill * 0.1 * (N.y * 0.5 + 0.5);
    col += base * uGroundBounce * (0.5 - N.y * 0.5) * (1.0 - lit);
    float fr = 1.0 - max(dot(N, V), 0.0);
    float rim = smoothstep(0.58, 0.72, fr) * rimAmt;
    float sunSide = smoothstep(-0.3, 0.3, dot(N, uLightDir) + 0.2);
    col += uRimColor * base * rim * (0.2 + 0.8 * sunSide) * 0.8;
    col *= 1.0 + (br - 0.5) * 0.14 * uPaint;
    return min(col, vec3(0.97));
  }
  vec3 skyColour(vec3 d) {                       // the palette's flat pair: kept for the hills' painted wash only
    vec3 col = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.6, d.y));
    return mix(col, uHaze, smoothstep(0.0, -0.04, d.y));
  }
  ${SKY_GLSL}
  // aerial haze: desaturate first, then lift toward the SKY'S OWN radiance along the view ray, f = 1 - exp(-k d)
  // (sakura's applySkyAerial / aerialAt, MIT; k = 0.0022 per metre). The colour is skyRadiance() — the same function
  // the dome writes — so haze and sky agree over the whole sky, not just at the horizon.
  vec3 aerial(vec3 col, vec3 wpos) {
    vec3 ray = wpos - cameraPosition; float d = length(ray);
    float f = clamp(1.0 - exp(-d * uAerialK), 0.0, 1.0);
    col = mix(col, vec3(lumaB(col)), clamp(f * uAerialDesat, 0.0, 1.0));   // desaturate FIRST
    return mix(col, skyRadiance(ray / max(d, 1e-4)), f);                   // then lift toward the sky
  }
`;

// ---------------- wind GLSL (vertex side) ----------------
// builtWind(): p is the vertex in the plant's object space (base at the origin, 1 unit = the plant's height);
// returns the moved vertex, STILL in object space, so the instance matrix runs after it. The world wind is brought
// into the instance's frame with transpose(mat3(instanceMatrix)). With uWindStrength 0 it returns p exactly.
export const WIND_GLSL = /* glsl */`
  uniform vec2 uWindDir; uniform float uWindTime, uWindStrength, uWindGust, uWindBend, uWindPhaseScale, uWindFreq, uWindRing;
  vec3 builtWind(vec3 p, vec2 uv, float leaf, mat4 im) {
    if (uWindStrength <= 0.0) return p;
    vec3 anchor = im[3].xyz;
    vec3 wO = transpose(mat3(im)) * vec3(uWindDir.x, 0.0, uWindDir.y);
    wO = wO / max(length(wO), 1e-6);
    float ph = 6.2831853 * noise3(anchor / 97.0 + vec3(17.0, 3.0, 5.0));   // one phase per plant (cells smaller than the plant spacing)
    float gust = noise3(vec3(anchor.xz / uWindPhaseScale, uWindTime * 0.15));
    float amp = uWindStrength * (0.65 + 0.35 * sin(uWindTime * uWindFreq + ph)) * (1.0 + uWindGust * (gust - 0.5) * 2.0);
    // the ONE travelling gust trees and grass share (settled on the meft1008 board): 3 lobes running round the
    // arena, on the bend amplitude only (never the flutter phase). uWindRing 0 (every arena but meft1008) = skipped.
    if (uWindRing != 0.0) amp *= 1.0 + uWindRing * sin(atan(anchor.z, anchor.x) * 3.0 - uWindTime * 0.9);
    // Crysis main bend: 0 at the base, grows fast upward; then back onto the original radius (no stretch)
    float bf = max(p.y, 0.0) * uWindBend + 1.0; bf *= bf; bf = bf * bf - bf;
    vec3 q = p; q.xz += wO.xz * amp * bf;
    float L = length(p); if (L > 1e-5) q = normalize(q) * L;
    // ez-tree leaf flutter (3 harmonics, noise phase per card), card base fixed (uv.y = 0 there)
    float o = 6.2831853 * noise3(p * 6.0 + vec3(ph));
    float f = uWindFreq * 2.5;
    float sway = 0.5 * sin(uWindTime * f + o) + 0.3 * sin(2.0 * uWindTime * f + 1.3 * o) + 0.2 * sin(5.0 * uWindTime * f + 1.5 * o);
    q += leaf * uv.y * uWindStrength * 0.25 * sway * vec3(wO.x, 0.35, wO.z);
    return q;
  }
  // the one place the world position of a built vertex is made (materials and the checker's probe both call it)
  vec3 builtWorldPos(vec3 p, vec2 uv, float leaf, mat4 im) { return (modelMatrix * im * vec4(builtWind(p, uv, leaf, im), 1.0)).xyz; }
`;

// ---------------- wind object (ticked once per frame) ----------------
export const wind = {
  t0: null,
  tick(nowMs) {
    if (this.t0 == null) this.t0 = nowMs;
    U.uWindTime.value = (nowMs - this.t0) / 1000;
  },
};

// ---------------- keep-out (build time) ----------------
/** Does a sphere (centre c, radius rho) touch the view cone from eye e to the fighter sphere (f, R)? The cone is the
 *  convex hull of the eye and the fighter's sphere (tangent lines from the eye, closed by the sphere), so only what
 *  stands BETWEEN the eye and the fighter counts. Worked in the plane of the axis: a = along, d = off the axis. */
export function inViewCone(c, rho, e, f, R) {
  const ax = [f[0] - e[0], f[1] - e[1], f[2] - e[2]], L = Math.hypot(...ax);
  const v = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
  if (Math.hypot(c[0] - f[0], c[1] - f[1], c[2] - f[2]) <= R + rho) return true;   // touches the fighter's sphere
  if (L <= R) return true;                                                          // the eye is in the fighter's sphere
  const a = (v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]) / L;
  const d = Math.sqrt(Math.max(0, v[0] * v[0] + v[1] * v[1] + v[2] * v[2] - a * a));
  const t = Math.sqrt(L * L - R * R), ta = t * t / L, td = t * R / L;               // tangent point (along, off)
  if (a >= 0 && a <= ta && d * ta <= a * td) return true;                           // centre inside the cone part
  // distance from (a, d) to the segment eye -> tangent point (the cone's side)
  const k = Math.max(0, Math.min(1, (a * ta + d * td) / (ta * ta + td * td)));
  return Math.hypot(a - k * ta, d - k * td) < rho;
}
