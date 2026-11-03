// SKY of the BUILT arena look (web/arena-built.js, Arena Viewer only). Plan Step 4,
// ~/dw3-knowledge/research/PLAN-built-arena.md; research r1/r2/r3 sky.md.
//   dome      Samurai's box: BoxGeometry(1,1,1) = 12 triangles, BackSide, depthTest/depthWrite off, renderOrder -1000,
//             re-parked on the camera in onBeforeRender, scale = max(camera.far, 10) * 0.5. On a cube centred on the
//             camera normalize(position) IS the view ray. (achrefelouafi/SamuraiThirdPersonTemplateThreeJS
//             src/world/Sky.js, MIT.)
//   gradient  sakura-idle skyGradient(): horizon->zenith on pow(y, 0.42), mid stop, zenith value drop + re-saturate
//             (uZenDeep 0.80), Rayleigh-flavour extinction mixed 0.26, haze band hugging the horizon, warm band gated
//             to the sun's azimuth (pow(dot(viewAz, sunAz), 2.2)). (danmana/sakura-idle src/lib/sky-shaders.js, MIT;
//             as quoted in research r2/sky.md section 3.)
//   clouds    sakura-idle cloudLayer(), two decks (near cumulus kf 0.300 / pw 0.55, cirrus kf 0.090 / pw 0.72), baked
//             tiling noise (R height, GB gradient of a blurred copy, A warp), coverage as depth (H-cov)/(1-cov), the
//             7-pixel minimum feather, up-biased screen-frame relief normal, 3-tap screen-direction self-shadow,
//             backlit translucency, unit-brightness shadow tint, aerial wash (r2/sky.md section 4.3, MIT).
//             Our own part: a deck only shows where the view ray meets the arena's own sky ring between its measured
//             heights (recipe sky piece: profile, ymin, ymax), and the coverage grows toward the ring's top, because
//             the measured colours say so (the top quarter's median is cloud white, the bottom quarter's sky blue).
//             OFF BY DEFAULT since the 3D clouds below (user: "flat smeared noise ending in a hard line at the ring
//             top"); createBuiltSky(..., { decks: true }) brings them back, nothing else changes.
//   3D cumulus banks (research r4/clouds.md §7 STEP 1; STEP 3, the raymarch, is NOT taken). The user's complaint about
//             the old puffs was "flat lavender bread loaves with flat bottoms"; what the original has is TALL TOWERING
//             cumulus banks along the horizon, bright white on top and shaded blue-violet underneath.
//             Each bank is a HEAP OF SOFT PUFFS: piles of overlapping lobes, widest and lowest on the flat base plane,
//             lumpy and billowy on top (small crown puffs), shoulders closing the gaps — clean puffy horizon clouds.
//             The lobes are unioned by a SMOOTH-MINIMUM SIGNED-DISTANCE FIELD (so no lobe can read as a bead or a
//             drip), warped once at a long wavelength, cut by the base plane, and turned into a surface by SURFACE NETS
//             at a 0.195 m cell; all 9 banks merge into ONE mesh "builtClouds" (1 draw call, opaque, depth-tested).
//             Lighting is per pixel from the SHARED light (uLightDir / uLightColor: the sun by day, the MOON at night):
//             a wrapped diffuse (clouds have no hard terminator) x a baked SKY-VISIBILITY term (rays cast into the
//             hemisphere above each vertex against the bank's own distance field: the self-shadowing that darkens a
//             crease or an underside) x a height ramp, ramped to the measured white; a fresnel rim gated by the
//             view-to-light angle is a silver lining only toward the sun (the moon at night); aerial() haze last. The
//             albedo pair is the recipe's measured cloud white (p90) + a PICKED blue-violet.
//   sun       two-lobe glow pow(s, 8) * uSunGlow + s * s * uBroadGlow (Samurai Sky.js, MIT), added AFTER the clouds
//             with a bleed factor (cortiz2894/stylized-components SkyDome.tsx, MIT, credit Christian Ortiz). No disc
//             by day (the disc arena shows none that I know of), no god rays.
//   night     DAY OR NIGHT IS READ FROM THE MEASUREMENT, never from a pack name: skyMode() takes the sky ring's own
//             median colour (the recipe's c.all) and its luma in sRGB; below NIGHT.LUMA the arena is night. The same
//             measured colours are then solved as by day (calibrate), so the night gradient is the arena's own dark
//             ring, not a palette. On top of it: (a) the MOON, a disc standing AGAINST the light — the sun's
//             elevation on the opposite side of the sky (plan: "moon disc vs light direction split"), hard edge at
//             sin(radius) with the half-brightness exactly at the radius and a 14 % limb, the two-lobe glow moved to
//             the moon so it is the sky's halo; (b) THREE TEIRS OF STARS by count and brightness, baked once into a
//             2048x1024 equirectangular texture (R faintest / G / B brightest) sampled nearest, so a star is one
//             texel and the JS twin reads the same byte — counts 700 / 200 / 48 at 0.30 / 0.62 / 1.00 linear,
//             above 8 deg elevation. The clouds are moonlit at night (PICKED: nothing cloud-coloured is measured).
//   colours   the recipe's measured colours (sRGB 0-255) converted to linear once. The horizon and zenith stops are
//             SOLVED (calibrate()) so the finished sky gives the measured colour at the measured places: the ring's
//             bottom quarter colour at the horizon, the arena background colour straight up. Below the horizon the
//             haze piece's colour (shared U.uHaze).
// The radiance itself (skyGradient / skySunGlow / skyMoon / skyStars / skyRadiance) lives in shared.js SKY_GLSL,
// because shared.js's aerial() lifts the haze toward skyRadiance(): haze, sky and water read ONE function. This
// module keeps the parts only the dome has (clouds, ring, calibration, the night bake) and the JS twins.
// Exposed for reuse: SKY_U (one uniform object), SKY_GLSL (re-exported from shared.js; already inside LIGHT_GLSL,
// do not include it twice), the JS twins skyGradientJS / skySunGlowJS / skyMoonJS / skyStarsJS / skyRadianceJS /
// skyDomeJS (same maths, for checks and CPU bakes), skyMode(rec) and ringRJS / ringHitYJS.
import * as THREE from "../lib3d/three.module.js";
import * as S from "./shared.js";
import { SKY_U, SKY_GLSL } from "./shared.js";

export { SKY_U, SKY_GLSL };
import { skyData as skyDataOf } from "./place/sky.js";

const RING_MAX = S.SKY_RING_MAX;   // profile points the shader takes
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const arr = (c) => [c.r, c.g, c.b];

// ---------------- night (PICKED numbers: nothing night-lit is measured yet) ----------------
export const NIGHT = {
  LUMA: 0.34,            // sRGB luma of the sky ring's median colour below which the arena is a night arena
  MOON_RADIUS: 0.055,    // rad (3.15 deg): an anime moon, not the real 0.26 deg
  MOON_COLOR: [0.92, 0.95, 1.00],        // linear
  GLOW_COLOR: [0.55, 0.66, 1.00],        // linear: the moon's halo is cool (the day sun's is warm)
  GLOW: 0.26, GLOW_POWER: 26.0, BROAD: 0.020,   // tighter and dimmer than the sun's two lobes
  GLOW_MAX_SHARE: 0.5,   // the halo may carry at most half of the measured colour at the horizon / zenith spots
  HAZE_WARM_K: 0.0,      // the measured warm band is a daylight thing: off at night
  CLOUD_LIT: [150, 160, 190], CLOUD_AMB: [74, 84, 112], CLOUD_DARK: [26, 32, 52],   // sRGB moonlit decks
  STAR_AMP: 1.0,         // gain on the baked star values
  STAR_MIN_EL: 8,        // degrees: no star closer to the horizon than this (the ring's foot is a hard edge)
  STAR_MAP: [2048, 1024],   // texels across (azimuth) and up (elevation): 0.176 deg x 0.176 deg per texel
  // counts, linear brightness, tint [r, g, b] linear. Faintest tier first: R channel, then G, then B.
  STAR_TIERS: [
    { n: 700, mag: 0.30, tint: [0.72, 0.80, 1.00] },
    { n: 200, mag: 0.62, tint: [0.88, 0.92, 1.00] },
    { n: 48, mag: 1.00, tint: [1.00, 0.97, 0.90] },
  ],
};

// ---------------- band mode (the sky piece floats above the floor: meft1008's wall_05) ----------------
// MEASURED on meft1008 (MEASURE.md 2a/2c, research r5): wall_05 = 7.41..14.83 m at r 27.78 m, a pure vertical ramp
// [184,176,224] (foot) .. [232,224,240] (top), no cloud shape. The sky painted into the treeline band's top rows
// continues the same ramp downward ([176,168,224] at 6.95 m, [168,152,216] at 6.02 m): the bottom segment is
// extrapolated down to band share (6.02 - 7.41) / 7.41 = -0.1875 and held below that. Below the ring's foot (y 0)
// the original shows its background colour (the lake), and above the band too.
export const BAND = {
  BELOW: -0.1875,      // MEASURED (above)
  SOFT_M: 1.0,         // PICKED: metres above the ring foot over which the sky meets the lake colour
  FADE_SHARE: 0.1,     // PICKED: share of the band height above its top over which it meets the background
  GLOW_K: 0,           // the sun's glow is not added by day (the measured colours exactly; panel knob BandGlowK)
  // subtle band clouds, three.js Sky.js shading (PICKED numbers; the original has no clouds: AMT 0 = the original).
  // USER 2026-10-30: the sky must be the lavender gradient of the real game, "not flat grey": the grey cloud shading
  // (amount 0.5 before) is OFF by default now; the tuning panel's amount knob still turns it on.
  CLOUDS: { uSkyClAmt: 0.0, uSkyClCover: 0.35, uSkyClDensity: 0.4, uSkyClScale: 1 / 2400, uSkyClStretch: 2.2,
            uSkyClSpeed: 40, uSkyClSilver: 0.6, uSkyClFex: 0.85, uSkyClGain: 1.0 },
};

/** Is this arena a night arena? The sky ring's measured median colour decides (sRGB luma), not the pack name.
 *  force "day" / "night" (the Arena Viewer's "sky time" switch) overrides the measurement; "auto" or nothing keeps it. */
export function skyMode(rec, force = "auto") {
  const sky = rec.pieces.find((p) => p.kind === "sky");
  const ring = sky?.colours?.all || rec.bg || [0, 0, 0];
  const luma = (0.2126 * ring[0] + 0.7152 * ring[1] + 0.0722 * ring[2]) / 255;
  const measured = luma < NIGHT.LUMA ? "night" : "day";
  const forced = force === "day" || force === "night";
  return { mode: forced ? force : measured, measured, forced, request: forced ? force : "auto", luma, threshold: NIGHT.LUMA, ring };
}

// ---------------- the star map: one texel per star, the three tiers in R / G / B ----------------
const starHash = (seed) => {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};
/** Texel (i, j) centre -> unit direction: the inverse of the shader's uv (u = atan2(z,x)/2pi + 0.5, v = asin(y)/pi + 0.5). */
export function starTexelDir(i, j, W, H) {
  const u = (i + 0.5) / W, v = (j + 0.5) / H;
  const az = (u - 0.5) * 2 * Math.PI, el = (v - 0.5) * Math.PI;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}
/** Bake the three tiers into one RGBA8 equirect texture. One star = one texel, unique across tiers. No star is
 *  placed where the moon disc has any light (the moon stands in front of the stars): a texel is skipped when its
 *  centre is within the disc's outer edge (asin(1.06 r), where skyMoon() reaches 0) plus one texel diagonal. */
function bakeStars(seed, W, H, tiers, moon = null, moonR = 0) {
  const data = new Uint8Array(W * H * 4), used = new Uint8Array(W * H), rnd = starHash(seed);
  const jMin = Math.ceil((0.5 + NIGHT.STAR_MIN_EL / 180) * H), jMax = H - 2;
  const texDiag = Math.hypot(2 * Math.PI / W, Math.PI / H);
  const cosKeep = moon ? Math.cos(Math.asin(Math.min(1, moonR * 1.06)) + texDiag) : 2;
  let skippedMoon = 0;
  const out = [];
  for (const [t, tier] of tiers.entries()) {
    const dirs = [];
    for (let guard = 0; dirs.length < tier.n && guard < tier.n * 200; guard++) {
      const i = 1 + Math.floor(rnd() * (W - 2)), j = jMin + Math.floor(rnd() * (jMax - jMin));
      const k = j * W + i;
      if (used[k]) continue;
      const dir = starTexelDir(i, j, W, H);
      if (moon && dir[0] * moon[0] + dir[1] * moon[1] + dir[2] * moon[2] > cosKeep) { skippedMoon++; continue; }
      used[k] = 1;
      data[k * 4 + t] = Math.round(tier.mag * 255);
      dirs.push(dir);
    }
    out.push({ n: dirs.length, want: tier.n, mag: tier.mag, tint: tier.tint, dirs });
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;     // one texel is one star: nearest keeps it exactly one texel
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return { tex, data, W, H, tiers: out, skippedMoon };
}

// ---------------- clouds (only the dome has these; the maths is sakura's, the band is ours) ----------------
const CLOUD_GLSL = /* glsl */`
  uniform vec2 uWindDir; uniform float uWindTime;   // the shared wind (U), cloud drift only
  uniform sampler2D uNoiseA, uNoiseC;                // baked cloud noise (SKY_U; only the dome samples it)
  uniform float uGradS, uPxRad, uCloudAmt, uCloudLitK, uCloudCoreK, uCloudFormK, uCloudShadeK, uSunBleed;
  uniform vec3 uCloudLit, uCloudAmb, uCloudDark;
  uniform vec4 uDeckA[2], uDeckB[2], uDeckC[2];
  uniform float uRingT;                               // uRing / uRingN / uRingEye / uBandY: declared in SKY_GLSL
  uniform vec2 uBandS; uniform float uBandRamp, uBandTop;
  uniform float uSkyClAmt, uSkyClCover, uSkyClDensity, uSkyClScale, uSkyClStretch, uSkyClSpeed, uSkyClSilver, uSkyClFex, uSkyClGain;
  // BAND CLOUDS (band mode only): the cloud SHADING of three.js examples/jsm/objects/Sky.js (MIT, mrdoob/three.js):
  // Beer-Powder shade, Henyey-Greenstein-like silver lining on the mask's edge, opacity 1 - exp(-depth*density*12),
  // aerial composite mix(sky, cloud, Fex). Ours: the noise lives on the sky ring itself (the point where the view ray
  // meets the cylinder, so it never stretches or seams), it fades in and out inside the measured band, and the cloud
  // white is the arena's own background colour (uHaze), so the clouds stay inside the measured palette.
  // Hash: Dave Hoskins "Hash without Sine" hash13 (MIT, shadertoy.com/view/4djSRW).
  float clHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float clNoise(vec3 p) {                            // value noise, -0.5..0.5
    vec3 i = floor(p), f = p - i; f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(clHash(i), clHash(i + vec3(1, 0, 0)), f.x), mix(clHash(i + vec3(0, 1, 0)), clHash(i + vec3(1, 1, 0)), f.x), f.y);
    float b = mix(mix(clHash(i + vec3(0, 0, 1)), clHash(i + vec3(1, 0, 1)), f.x), mix(clHash(i + vec3(0, 1, 1)), clHash(i + vec3(1, 1, 1)), f.x), f.y);
    return mix(a, b, f.z) - 0.5;
  }
  vec3 bandClouds(vec3 d, vec3 sky, out float cover) {
    cover = 0.0;
    float t = skyBandT(d);
    float h = uRingEye.y + t * d.y;
    float fb = (h - uBandY.x) / max(uBandY.y - uBandY.x, 1e-3);
    float fade = smoothstep(0.0, 0.25, fb) * (1.0 - smoothstep(0.80, 1.0, fb));   // never a hard line at the band edges
    if (fade <= 0.0) return sky;
    vec2 xz = uRingEye.xz + t * d.xz - uWindDir * (uWindTime * uSkyClSpeed);
    vec3 p = vec3(xz.x, h * uSkyClStretch, xz.y) * uSkyClScale;
    float n = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { n += a * clNoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
    float cloudNoise = clamp(n * 1.4 + 0.5, 0.0, 1.0);                             // Sky.js: fbm * 0.7 + 0.5
    float threshold = 1.0 - uSkyClCover;
    float cloudMask = smoothstep(threshold, threshold + 0.3, cloudNoise);
    float depth = max(0.0, cloudNoise - threshold);
    float beer = exp(depth * -4.0);
    float powder = 1.0 - beer * beer;
    float shade = mix(0.45, 1.0, clamp(beer * powder * 2.6, 0.0, 1.0));
    float cosTheta = dot(d, uGlowDir);
    float silver = clamp(0.51 / pow(1.49 - cosTheta * 1.4, 1.5), 0.0, 3.0);
    float edge = cloudMask * (1.0 - cloudMask) * 4.0;
    vec3 lit = uHaze * uSkyClGain;
    vec3 cloudColor = mix(sky, lit, shade);                                        // between the band and its white
    cloudColor += lit * silver * edge * 0.6 * uSkyClSilver * skyGlowK();
    float alpha = (1.0 - exp(depth * uSkyClDensity * -12.0)) * fade * uSkyClAmt;
    vec3 cloudAerial = mix(sky, cloudColor, uSkyClFex);
    cover = clamp(alpha, 0.0, 1.0);
    return mix(sky, cloudAerial, cover);
  }
  float ringR(float y) {                              // radius of the sky ring at height y (profile, linear between)
    vec2 a = uRing[0];
    if (y <= a.x || uRingN < 2) return a.y;
    for (int i = 1; i < ${RING_MAX}; i++) {
      if (i >= uRingN) break;
      vec2 b = uRing[i];
      if (y <= b.x || i == uRingN - 1) return a.y + (b.y - a.y) * (y - a.x) / max(b.x - a.x, 1e-3);
      a = b;
    }
    return a.y;
  }
  float ringG(vec3 d, float t) { return length(uRingEye.xz + t * d.xz) - ringR(uRingEye.y + t * d.y); }
  float ringHitY(vec3 d) {                            // height where the ray meets the ring (bisection; g is convex)
    if (ringG(d, 0.0) >= 0.0 || ringG(d, uRingT) < 0.0) return -1e9;
    float lo = 0.0, hi = uRingT;
    for (int i = 0; i < 24; i++) { float m = 0.5 * (lo + hi); if (ringG(d, m) < 0.0) lo = m; else hi = m; }
    return uRingEye.y + 0.5 * (lo + hi) * d.y;
  }
  // sakura cloudLayer() (r2/sky.md 4.3). cov is the coverage at the ring top; w (0..1) lowers it toward the ring's foot.
  vec4 cloudDeck(vec3 d, vec3 skyC, vec4 A, vec4 B, vec4 C, float w, float fade) {
    float kf = A.x, pw = A.y, scl = A.z, spd = A.w;
    float cov = mix(0.97, B.x, w), bump = B.y, amt = B.z, stretch = B.w;
    float warpAmt = C.x, detAmt = C.y, aer = C.z;
    float y  = max(d.y, 0.004);
    float ss = sqrt(max(1.0 - y * y, 1e-4));
    vec2  Ph = d.xz / max(length(d.xz), 1e-4);
    vec2  Rt = vec2(Ph.y, -Ph.x);
    float r    = ss / (y + kf);
    float R0   = 1.0 / (0.55 + kf);
    float rp   = R0 * pow(max(r, 1e-4) / R0, pw);
    float rpMx = R0 * pow((1.0 / kf) / R0, pw);
    float tN   = clamp(rp / rpMx, 0.0, 1.0);
    float drdy = -(y / (ss * (y + kf)) + ss / ((y + kf) * (y + kf)));
    float dpdr = pw * pow(max(r, 1e-4) / R0, pw - 1.0);
    float cU = scl * abs(drdy * dpdr) * ss;
    float cR = scl * rp / max(ss, 0.10);
    float uvPx = sqrt(max(cU * cR, 1e-9)) * uPxRad;
    vec2 P = Ph * rp * scl;
    vec2 wd = uWindDir, wp = vec2(-wd.y, wd.x);
    vec2 Q = vec2(dot(P, wd) / stretch, dot(P, wp) * stretch) - vec2(uWindTime * spd, uWindTime * spd * 0.06);
    Q += (vec2(texture2D(uNoiseA, Q * 0.23 + 0.13).a, texture2D(uNoiseC, Q * 0.19 + 0.61).a) - 0.5) * warpAmt;
    vec4  Cf = texture2D(uNoiseC, Q);
    float H  = Cf.r + (texture2D(uNoiseC, Q * 3.7 + vec2(2.9, 5.3)).a - 0.5) * detAmt;
    float inv = 1.0 / max(1.0 - cov, 1e-3);
    float dens = (H - cov) * inv;
    float awP  = max(0.065 * inv, 7.0 * inv * uGradS * uvPx);   // never narrower than ~7 px of feather
    float alpha = smoothstep(0.0, awP, dens);
    float thick = smoothstep(0.0, awP * 3.0, dens);
    vec2 gq = (Cf.gb - 0.5) * 2.0 * uGradS;                     // dH/dQ
    vec2 g  = wd * (gq.x / stretch) + wp * (gq.y * stretch);    // dH/dP
    float gU = -dot(g, Ph) * cU, gR = dot(g, Rt) * cR;
    float sNorm = max(uGradS * sqrt(max(cU * cR, 1e-6)), 1e-4);
    vec2 gs = vec2(gR, gU) * (bump / sNorm);
    gs /= 1.0 + 0.30 * length(gs);
    float hiRel = smoothstep(0.35, 0.85, d.y);
    float upB = mix(0.88, 0.18, hiRel);
    float nz  = mix(0.55, 0.26, hiRel);
    vec3  Nr  = normalize(vec3(-gs.x, -gs.y + upB, nz * mix(1.0, 1.45, hiRel)));
    vec3 R3 = vec3(Rt.x, 0.0, Rt.y);
    vec3 U3 = normalize(cross(d, R3));
    vec3 Lr = vec3(dot(uGlowDir, R3), dot(uGlowDir, U3), dot(uGlowDir, -d));
    vec2 sScr = normalize(Lr.xy + vec2(1e-4, 1e-4));
    float hl = dot(Nr, normalize(Lr + vec3(1e-5))) * 0.5 + 0.5;
    float band = smoothstep(0.18, 0.38, hl) * 0.30 + smoothstep(0.34, 0.56, hl) * 0.36 + smoothstep(0.52, 0.84, hl) * 0.34;
    vec2 sv = Rt * (cR * sScr.x) - Ph * (cU * sScr.y);
    vec2 sQ = normalize(vec2(dot(sv, wd) / stretch, dot(sv, wp) * stretch) + vec2(1e-5)) * 0.024;
    float occ = texture2D(uNoiseC, Q + sQ * 1.0).r * 0.42 + texture2D(uNoiseC, Q + sQ * 2.2).r * 0.34
              + texture2D(uNoiseC, Q + sQ * 3.8).r * 0.24;
    float shadow = 1.0 - smoothstep(cov + 0.008, cov + 0.17, occ) * 0.58;
    float down  = skySat(gs.y * 0.85) * mix(1.0, 0.40, smoothstep(0.42, 0.86, d.y));
    float muS   = max(dot(d, uGlowDir), 0.0);
    float back  = skySat(-Lr.z * 0.85 + 0.15);
    float trans = back * (0.30 + 0.70 * pow(muS, 2.0));
    float mv    = texture2D(uNoiseA, Q * 0.115 + vec2(0.71, 0.29)).r;
    float lit = skySat(0.10 + band * 0.72 * uCloudLitK + shadow * 0.18) * mix(1.0, 0.56, down * 0.85);
    lit *= mix(0.86, 1.05, mv);
    float coreF = mix(0.21, 0.52, smoothstep(0.30, 0.70, d.y)) * uCloudCoreK;
    float formK = mix(uCloudFormK, 1.0, band);
    lit = max(lit, trans * (coreF + (1.04 - coreF) * pow(1.0 - thick, 1.35)) * formK);
    vec3 c = mix(uCloudDark, uCloudAmb, skySat(lit * 2.0));
    c = mix(c, uCloudLit, skySat(lit * 2.0 - 1.0));
    vec3 stChroma = mix(vec3(1.0), uShadowTint / max(skyLuma(uShadowTint), 1e-4), 0.45);
    c = mix(c * uCloudShadeK * stChroma, c, skySat(band * 1.35 + shadow * 0.40 - 0.32 - down * 0.55));
    // sakura writes smoothstep(0.075, 0.010, d.y) (edges reversed, undefined in GLSL): the same curve, defined
    c = mix(c, skyC * 1.03 + uHaze * 0.04, skySat(max((1.0 - exp(-tN * 2.4)) * aer, (1.0 - smoothstep(0.010, 0.075, d.y)) * 0.90)));
    alpha *= fade * uCloudAmt * amt;
    return vec4(max(c, vec3(0.0)), skySat(alpha));
  }
`;

function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith(),
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}            // already ends with SKY_GLSL + aerial()
      ${CLOUD_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 g = skyGradient(d);
        vec3 c = g + skyMoon(d) + skyStars(d);   // the moon and the stars stand IN the sky: the clouds go over them
        float cover = 0.0;
        float s = d.y / max(length(d.xz), 1e-6);
        if (uCloudAmt > 0.0 && s >= uBandS.x && s <= uBandS.y) {
          float hy = ringHitY(d);
          if (hy >= uBandY.x && hy <= uBandY.y) {
            float f = (hy - uBandY.x) / max(uBandY.y - uBandY.x, 1e-3);
            float w = smoothstep(0.0, uBandRamp, f), fade = 1.0 - smoothstep(1.0 - uBandTop, 1.0, f);
            vec4 ci = cloudDeck(d, g, uDeckA[1], uDeckB[1], uDeckC[1], w, fade);   // cirrus first (farther)
            c = mix(c, ci.rgb, ci.a);
            vec4 cu = cloudDeck(d, g, uDeckA[0], uDeckB[0], uDeckC[0], w, fade);   // near cumulus over it
            c = mix(c, cu.rgb, cu.a);
            cover = 1.0 - (1.0 - ci.a) * (1.0 - cu.a);
          }
        }
        if (uSkyClAmt > 0.0 && uBandMix > 0.0) c = bandClouds(d, c, cover);   // band mode only
        c += skySunGlow(d) * mix(1.0, uSunBleed, cover) * skyGlowK();   // the light's glow is added after the clouds
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: false,
  });
}

// ---------------- 3D cumulus: every number that changes what the banks look like ----------------
// STEP 1 (baked banks) of research r4/clouds.md §7. Shapes and the shading terms are PICKED (nothing cloud-shaped is
// measured on this arena); the band heights come from the arena's own sky ring profile and
// the lit albedo from the ring's measured p90, so each arena keeps its own cloud colour and its own sky band.
export const CLOUDS = {
  BANKS: 9,                 // banks along the horizon (r4: 6-10)
  R: [9600, 10400],         // bank centre radius (render units)
  WIDTH_DEG: [22, 40],      // each bank's width round the ring (broad, low puffy banks: wider than they are tall)
  GAP_JIT: 0.26,            // azimuth jitter, share of the ring spacing: uneven gaps, never a regular fence
  BASE_F: 0.08,             // the flat base sits at this share of the sky ring's measured band ...
  TOP_F: [0.34, 0.70],      // ... each bank's top at this one (band share seen from the ring's centre): an uneven skyline
  DEPTH: [0.55, 0.80],      // bank depth as a share of its width
  VOXEL: 78,                // bake cell size: 0.195 m (400 units = 1 m) — the silhouette's detail
  SEED: 1013,
  // The shape: a bank is a HEAP of soft puffs — 3-5 piles of overlapping lobes, widest and lowest at the flat base,
  // rounded and slightly lumpy on top, with smaller puffs crowning each pile and shoulders closing the gaps. The lobes
  // are unioned by a smooth-minimum distance field, so the heap is ONE smooth mass and no lobe can read as a bead.
  SHAPE: {
    PILES: [3, 5],          // piles of lobes per bank
    R_PUFF: 0.30,           // a pile's base puff radius, share of the bank's height (a heap is ~2-3 puffs tall)
    TAPER: 0.22,            // how much a pile narrows from its base puff to its top puff
    STEP: 0.52,             // distance between two puffs up a pile, share of the puff's own radius (they overlap)
    LEAN: 0.05,             // how far a pile leans over its own height (jitter, share of H)
    CROWNS: 3,              // small puffs round the top of each pile: the lumpy, billowy edge
    CROWN_R: 0.55,          // their radius, share of the top puff's
    BASE_LOBES: 5,          // broad lobes lying on the base plane (the wide, scalloped foot of the bank)
    R_BASE: 0.26,           // their radius, share of H
    SHOULDERS: 3,           // lobes between the piles (they close the mass into one cloud)
    R_SHOULDER: 0.26,       // their radius, share of H
    JITTER: 0.10,           // puff-centre jitter, share of the puff's own radius
    SMELL: 0.60,            // smooth-union radius, share of the smaller lobe: the fillet between two puffs
  },
  WARP: { AMP: 0.035, WAVE: 0.32 },  // the field's own billow: amplitude and wavelength, shares of H (0 = smooth)
  AO: { STEPS: 4, LEN: 1.5 },    // baked sky visibility: march steps per ray (9 fixed directions), reach (puff radii)
  BLUR: 1,                  // field smoothing passes (removes the bake grid's staircase)
};

// The shading model. Colours are sRGB 0-1 like the rest of the file; LIT is the recipe's measured cloud white.
// A cumulus is a scattering body: no hard terminator, a bright white top, a blue-violet side away from the sun, and a
// dark flat base. `key` is the one number that drives the ramp — wrapped diffuse x how much sky the surface can see
// (the baked sky visibility) x height — so the tops reach the measured white and everything the sun cannot reach
// falls to the shade and then, in the creases and under the base, to the deep.
export const CLOUD_LOOK = {
  SHADE: [0.46, 0.52, 0.66],   // PICKED: blue-violet albedo of a shadowed side
  DEEP: [0.27, 0.32, 0.46],    // PICKED: the darkest creases and the flat base
  RIM: [1.00, 0.99, 0.97],     // PICKED: the silver lining, times the shared light's colour
  WRAP: 1.90,                  // wrapped diffuse (n.L + WRAP) / (1 + WRAP): clouds have no hard terminator, and
                               // even the side facing away from the sun keeps the sky's fill (a daylight cloud is never black)
  KEY_POW: 1.0,                // > 1 hardens the terminator
  HEIGHT_POW: 1.0,             // the height ramp: 0 at the base, 1 at the top
  BASE_K: 0.45,                // how much of the key survives at the cloud's foot
  VIS_FLOOR: 0.32,             // the baked sky visibility's floor: multiple scattering keeps a crease visible
  KEY_LO: 0.17, KEY_HI: 0.66,  // where the albedo goes from the blue-violet shade to the measured white
  DEEP_HI: 0.06,               // below this key the albedo sinks to DEEP: the flat base and the deep creases
  SKY_TINT: 0.22,              // how far the shade colour follows the arena's own sky hue
  KEY_GAIN: 1.0,               // the shared light's gain on the albedo: 1 = a fully lit top IS the measured white
  RIM_POW: 2.5, RIM_BACK: 1.8, RIM_GAIN: 0.40,   // the lining's strength (share of the albedo added at the edge)
  BILLOW: 0.09, BILLOW_W: 900, // one low-frequency octave on the key, so the body is not a smooth ramp
};


const CLOUD_VERT = /* glsl */`
  attribute vec3 aCloud;            // x = height share in the bank 0..1, y = baked sky visibility 0..1, z unused
  varying vec3 vW, vN, vC;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);       // the arena group's scale is uniform (worldScale)
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vC = aCloud;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const CLOUD_FRAG = /* glsl */`
  varying vec3 vW, vN, vC;
  uniform vec3 uCloudLit, uCloudShade, uCloudDeep, uCloudRim;
  uniform vec4 uCloudA, uCloudB, uCloudC;   // wrap, keyPow, heightPow, baseK | visFloor, deepHi, rimPow, rimBack
                                            // | keyGain, rimGain, billow, billowW
  uniform vec2 uCloudRamp;                  // keyLo, keyHi: where the albedo turns from the shade to the cloud white
  ${S.NOISE_GLSL}
  ${S.LIGHT_GLSL}
  void main() {
    vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
    float h = clamp(vC.x, 0.0, 1.0), vis = clamp(vC.y, 0.0, 1.0);
    // wrapped diffuse: a cloud scatters, so it has no hard terminator. The height ramp and the baked sky visibility
    // darken what the sky above cannot reach (the foot of the bank, the creases between two lobes) — that is the
    // cloud's own self-shadowing, and it is the term that makes a lit top read against a shaded underside.
    float wrap = clamp((dot(N, uLightDir) + uCloudA.x) / (1.0 + uCloudA.x), 0.0, 1.0);
    float key = pow(wrap, uCloudA.y) * mix(uCloudA.w, 1.0, pow(h, uCloudA.z)) * mix(uCloudB.x, 1.0, vis);
    // one LOW-frequency octave (billows, not dirt) so a big surface is not a perfectly flat ramp
    key += (noise3(vW * (1.0 / uCloudC.w)) - 0.5) * uCloudC.z;
    key = clamp(key, 0.0, 1.0);
    vec3 alb = mix(uCloudShade, uCloudLit, smoothstep(uCloudRamp.x, uCloudRamp.y, key));   // white lit, blue-violet shade
    alb = mix(uCloudDeep, alb, smoothstep(0.0, uCloudB.y, key));                          // the base and the deep creases sink
    vec3 col = alb * (uLightColor * uCloudC.x);                                          // the shared sun / moon
    // rim: the light BEHIND the bank (forward scattering), so it is the sun's silver lining, never a plastic sheen
    float fres = pow(1.0 - max(dot(N, V), 0.0), uCloudB.z);
    float back = pow(max(-dot(V, uLightDir), 0.0), uCloudB.w);
    col += uCloudRim * uLightColor * (fres * back * uCloudC.y);
    // A cloud pixel is never brighter than the measured cloud white: the albedo IS this arena's measurement, and the
    // rim is light on the edge, not a licence to blow the tone out past it.
    vec3 out3 = min(aerial(col, vW), uCloudLit);                                        // the shared haze, then the clamp
    gl_FragColor = vec4(out3, 1.0);
    #include <colorspace_fragment>
  }`;

// ---------------- STEP 1: the banks ----------------
const cloudRng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
/** The directions the baked sky visibility is measured in: a small fixed cosine-weighted hemisphere — one straight up,
 *  four at 40 deg and four at 72 deg. Fixed, so a bank bakes to the same numbers every time. */
const AO_DIRS = (() => {
  const out = [], add = (el, az, w) => out.push([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el), w]);
  add(Math.PI / 2, 0, 1.7);
  for (let i = 0; i < 4; i++) add(40 * Math.PI / 180, i * Math.PI / 2 + 0.4, 1.0);
  for (let i = 0; i < 4; i++) add(72 * Math.PI / 180, i * Math.PI / 2 + 1.15, 0.55);
  return out;
})();
/** The height at radius rc that stands at the same elevation, seen from the ring's centre, as the ring's own point
 *  at band share f — the same projection the old puffs used, so a bank stands where the ring's cloud band stood. */
const atR = (sky, f, rc) => { const y = sky.ymin + f * (sky.ymax - sky.ymin); return y * rc / Math.max(ringRJS(y), 1); };

/** One bank's lobes, in the bank's own frame (x across the ring, y up from the base plane, z in and out): a heap of
 *  soft puffs — piles of overlapping lobes that narrow as they rise, broad lobes lying ON the base plane, a few small
 *  puffs crowning each pile (the lumpy billowy edge) and shoulders that close the gaps into one mass. */
function bankLobes(spec, rnd) {
  const SH = CLOUDS.SHAPE, { W, D, H } = spec, out = [];
  const jit = (a) => (rnd() - 0.5) * 2 * a;
  const add = (x, y, z, r) => { if (r > 0) out.push({ x, y, z, r }); };
  const nP = SH.PILES[0] + Math.floor(rnd() * (SH.PILES[1] - SH.PILES[0] + 1));
  for (let j = 0; j < nP; j++) {
    const fx = nP === 1 ? 0 : ((j + 0.5) / nP) * 2 - 1;           // -1..1 across the bank
    const tx = fx * W * 0.34 + jit(W * 0.05);
    const tz = jit(D * 0.20);
    const R0 = H * SH.R_PUFF * (0.78 + 0.34 * rnd());
    const h = H * (0.50 + 0.50 * rnd());                          // heaps of clearly different height: an uneven skyline
    const leanX = jit(SH.LEAN * H), leanZ = jit(SH.LEAN * H), ph = rnd() * Math.PI * 2;
    let y = R0 * 0.22, lastX = tx, lastZ = tz, lastY = y, lastR = R0, i = 0;
    while (y < h && i < 8) {
      const t = Math.min(1, y / h);
      const r = R0 * (1 - SH.TAPER * Math.pow(t, 1.2)) * (0.90 + 0.16 * rnd());
      // the pile drifts and leans a little as it rises: a puff heap is never a straight column
      const wx = leanX * t * t + Math.cos(ph + i * 1.9) * r * SH.JITTER;
      const wz = leanZ * t * t + Math.sin(ph + i * 1.9) * r * SH.JITTER;
      add(tx + wx, y, tz + wz, r);
      lastX = tx + wx; lastZ = tz + wz; lastY = y; lastR = r;
      y += r * SH.STEP;
      i++;
    }
    // crown: smaller puffs round the top lobe, so the pile ends lumpy and billowy instead of in a ball
    for (let c = 0; c < SH.CROWNS; c++) {
      const a = ph + (c / Math.max(1, SH.CROWNS)) * Math.PI * 2 + jit(0.45);
      const rr = lastR * SH.CROWN_R * (0.80 + 0.36 * rnd());
      const off = lastR * (0.34 + 0.20 * rnd());
      add(lastX + Math.cos(a) * off, lastY + lastR * 0.26 + rr * 0.30, lastZ + Math.sin(a) * off, rr);
    }
    add(lastX + jit(lastR * 0.18), lastY + lastR * 0.34, lastZ + jit(lastR * 0.18), lastR * 0.86);
  }
  // the wide, scalloped foot: broad lobes lying on the base plane, spread over the bank's whole width
  const nB = SH.BASE_LOBES + Math.floor(rnd() * 2);
  for (let i = 0; i < nB; i++) {
    const t = nB === 1 ? 0 : (i / (nB - 1)) * 2 - 1;
    const r = H * SH.R_BASE * (0.84 + 0.26 * (1 - Math.abs(t) * 0.5)) * (0.88 + 0.24 * rnd());
    add(t * W * 0.38 + jit(W * 0.03), r * (0.12 + 0.16 * rnd()), jit(D * 0.28), r);
  }
  // shoulders: lobes between the piles, so the bank is one cloud and not a row of separate blobs
  for (let i = 0; i < SH.SHOULDERS; i++) {
    add(jit(W * 0.30), H * (0.20 + 0.30 * rnd()), jit(D * 0.34), H * SH.R_SHOULDER * (0.85 + 0.5 * rnd()));
  }
  return out;
}

/** Three separable [1,2,1] passes over the grid: the bake grid's staircase and any single-cell spike go, the shape
 *  (and the flat base, to within a cell) stays. */
function blur3(F, nx, ny, nz) {
  const n = F.length, T = new Float32Array(n), at = (i, j, k) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    T[at(i, j, k)] = (F[at(Math.max(0, i - 1), j, k)] + 2 * F[at(i, j, k)] + F[at(Math.min(nx - 1, i + 1), j, k)]) * 0.25;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    F[at(i, j, k)] = (T[at(i, Math.max(0, j - 1), k)] + 2 * T[at(i, j, k)] + T[at(i, Math.min(ny - 1, j + 1), k)]) * 0.25;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    T[at(i, j, k)] = (F[at(i, j, Math.max(0, k - 1))] + 2 * F[at(i, j, k)] + F[at(i, j, Math.min(nz - 1, k + 1))]) * 0.25;
  F.set(T);
}

/** The bank's field on a grid: a signed distance to the lobes with INSIDE POSITIVE (so the surface-nets winding and the
 *  -gradient normals are the ones the rest of this file already agrees with), unioned with a smooth maximum so two
 *  lobes flow into one another with a fillet instead of meeting in a crease, plus one low-frequency warp, then cut by
 *  the FLAT BASE plane. Nothing here can make a thin finger: a lobe is a lobe. */
function bankField(spec, rnd) {
  const V = CLOUDS.VOXEL, { H } = spec, SH = CLOUDS.SHAPE, Wp = CLOUDS.WARP;
  const lobes = bankLobes(spec, rnd);
  // the bank must stay inside the ring's measured band: if a crown puff pokes above the bank's own top, sink the lot
  let yTop = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const L of lobes) {
    yTop = Math.max(yTop, L.y + L.r); x0 = Math.min(x0, L.x - L.r); x1 = Math.max(x1, L.x + L.r);
    z0 = Math.min(z0, L.z - L.r); z1 = Math.max(z1, L.z + L.r);
  }
  const dy = Math.min(0, H - yTop);
  if (dy) for (const L of lobes) L.y += dy;
  const pad = 2 * V, cut = 0.35 * V, gx0 = x0 - pad, gy0 = 0, gz0 = z0 - pad;
  const nx = Math.ceil((x1 - x0 + 2 * pad) / V) + 1, nz = Math.ceil((z1 - z0 + 2 * pad) / V) + 1;
  const ny = Math.ceil((H + pad) / V) + 1;
  const F = new Float32Array(nx * ny * nz).fill(-1e9), at = (i, j, k) => (k * ny + j) * nx + i;
  // Inigo Quilez's polynomial smooth minimum, mirrored into a smooth MAXIMUM: a fillet of width k where two lobes meet
  const smax = (a, b, k) => { const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (a - b) / k)); return b + (a - b) * h + k * h * (1 - h); };
  for (const L of lobes) {
    const k = L.r * SH.SMELL, R = L.r + k;
    const i0 = Math.max(0, Math.floor((L.x - R - gx0) / V)), i1 = Math.min(nx - 1, Math.ceil((L.x + R - gx0) / V));
    const j0 = Math.max(0, Math.floor((L.y - R - gy0) / V)), j1 = Math.min(ny - 1, Math.ceil((L.y + R - gy0) / V));
    const k0 = Math.max(0, Math.floor((L.z - R - gz0) / V)), k1 = Math.min(nz - 1, Math.ceil((L.z + R - gz0) / V));
    for (let kk = k0; kk <= k1; kk++) {
      const dz = gz0 + kk * V - L.z, dz2 = dz * dz;
      for (let j = j0; j <= j1; j++) {
        const dyy = gy0 + j * V - L.y, d2 = dyy * dyy + dz2;
        for (let i = i0; i <= i1; i++) {
          const dx = gx0 + i * V - L.x, o = at(i, j, kk);
          F[o] = smax(F[o], L.r - Math.sqrt(dx * dx + d2), k);       // + inside, - outside, magnitude = distance
        }
      }
    }
  }
  // one LOW-frequency warp: the surface breathes, and no puff stays a perfect sphere (2.5x the amplitude, then nothing)
  const wl = Math.max(Wp.WAVE * H, 1e-3), amp = Wp.AMP * H;
  if (amp > 0) for (let kk = 0; kk < nz; kk++) for (let j = 0; j < ny; j++) {
    const y = gy0 + j * V;
    for (let i = 0; i < nx; i++) {
      const o = at(i, j, kk), f = F[o];
      if (f < -amp * 2.5 || f > amp * 2.5) continue;
      F[o] = f + (S.noise3JS((gx0 + i * V) / wl, y / wl, (gz0 + kk * V) / wl) - 0.5) * 2 * amp;
    }
  }
  // the FLAT BASE: the cloud is intersected with the half-space above the plane (min of two inside-positive distances),
  // so the underside closes as one hard flat surface with the lobes' scalloped edge round it — applied AFTER the warp,
  // so the base plane cannot ripple
  for (let j = 0; j < ny; j++) {
    const c = gy0 + j * V - cut;
    for (let kk = 0; kk < nz; kk++) for (let i = 0; i < nx; i++) { const q = at(i, j, kk); if (c < F[q]) F[q] = c; }
  }
  for (let p = 0; p < CLOUDS.BLUR; p++) blur3(F, nx, ny, nz);
  return { F, nx, ny, nz, x0: gx0, y0: gy0, z0: gz0, V, cut, at, lobes: lobes.length };
}

/** Trilinear sample of a grid, clamped at its edges. */
function gridSampler(F, nx, ny, nz, x0, y0, z0, V) {
  const at = (i, j, k) => (k * ny + j) * nx + i;
  return (x, y, z) => {
    let fx = (x - x0) / V, fy = (y - y0) / V, fz = (z - z0) / V;
    let i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    fx -= i; fy -= j; fz -= k;
    const i0 = Math.min(Math.max(i, 0), nx - 1), i1 = Math.min(i + 1, nx - 1);
    const j0 = Math.min(Math.max(j, 0), ny - 1), j1 = Math.min(j + 1, ny - 1);
    const k0 = Math.min(Math.max(k, 0), nz - 1), k1 = Math.min(k + 1, nz - 1);
    const a = at(i0, j0, k0), b = at(i1, j0, k0), c = at(i0, j1, k0), d = at(i1, j1, k0);
    const e = at(i0, j0, k1), f = at(i1, j0, k1), g = at(i0, j1, k1), h = at(i1, j1, k1);
    const s = (p, q, t) => p + (q - p) * t;
    return s(s(s(F[a], F[b], fx), s(F[c], F[d], fx), fy), s(s(F[e], F[f], fx), s(F[g], F[h], fx), fy), fz);
  };
}

/** Surface nets (S. Gibson 1998; the algorithm of mikolaj/iso-surface, MIT — no case tables): one vertex per cell that
 *  straddles the isosurface, one quad per straddling grid edge, wound so the face agrees with the field's gradient.
 *  The field is a distance, so its zero level is the surface; the normals are that field's gradient (the true, smooth
 *  normal of the distance field, so a low-poly surface still shades as one soft mass). */
function bankSurface(f) {
  const { F, nx, ny, nz, x0, y0, z0, V } = f, ISO = 0;
  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellV = new Int32Array(cnx * cny * cnz).fill(-1);
  const cAt = (i, j, k) => (k * cny + j) * cnx + i;
  const pos = [], idx = [];
  const EX = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const V8 = new Float32Array(8);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
    V8[0] = F[f.at(i, j, k)]; V8[1] = F[f.at(i + 1, j, k)]; V8[2] = F[f.at(i, j + 1, k)]; V8[3] = F[f.at(i + 1, j + 1, k)];
    V8[4] = F[f.at(i, j, k + 1)]; V8[5] = F[f.at(i + 1, j, k + 1)]; V8[6] = F[f.at(i, j + 1, k + 1)]; V8[7] = F[f.at(i + 1, j + 1, k + 1)];
    let mask = 0;
    for (let c = 0; c < 8; c++) if (V8[c] > ISO) mask |= 1 << c;
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = EX[e][0], b = EX[e][1], va = V8[a], vb = V8[b];
      if ((va > ISO) === (vb > ISO)) continue;
      const t = (ISO - va) / (vb - va);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t;
      sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      n++;
    }
    cellV[cAt(i, j, k)] = pos.length / 3;
    pos.push(x0 + (i + sx / n) * V, y0 + (j + sy / n) * V, z0 + (k + sz / n) * V);
  }
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }   // [a,b,c,d] -> [a,d,c,b]: the SAME quad, wound the other way
    idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < cnz; k++) for (let j = 1; j < cny; j++) for (let i = 0; i < cnx; i++) {   // edges along x
    const fa = F[f.at(i, j, k)], fb = F[f.at(i + 1, j, k)];
    if ((fa > ISO) === (fb > ISO)) continue;
    quad(cellV[cAt(i, j - 1, k - 1)], cellV[cAt(i, j, k - 1)], cellV[cAt(i, j, k)], cellV[cAt(i, j - 1, k)], !(fa > fb));
  }
  for (let k = 1; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 1; i < cnx; i++) {   // edges along y
    const fa = F[f.at(i, j, k)], fb = F[f.at(i, j + 1, k)];
    if ((fa > ISO) === (fb > ISO)) continue;
    quad(cellV[cAt(i - 1, j, k - 1)], cellV[cAt(i, j, k - 1)], cellV[cAt(i, j, k)], cellV[cAt(i - 1, j, k)], fa > fb);
  }
  for (let k = 0; k < cnz; k++) for (let j = 1; j < cny; j++) for (let i = 1; i < cnx; i++) {   // edges along z
    const fa = F[f.at(i, j, k)], fb = F[f.at(i, j, k + 1)];
    if ((fa > ISO) === (fb > ISO)) continue;
    quad(cellV[cAt(i - 1, j - 1, k)], cellV[cAt(i, j - 1, k)], cellV[cAt(i, j, k)], cellV[cAt(i - 1, j, k)], !(fa > fb));
  }
  return { pos, idx };
}

/** Bake all the banks: for each one, place it round the ring, build its surface, then take per-vertex the height share,
 *  the sky visibility and the outward normal. */
export function buildCloudBanks(sky) {
  const rnd = cloudRng(CLOUDS.SEED), V = CLOUDS.VOXEL;
  const banks = [], P = [], N = [], C = [], I = [];
  let tris = 0;
  for (let b = 0; b < CLOUDS.BANKS; b++) {
    const az = ((b + 0.5 + (rnd() - 0.5) * 2 * CLOUDS.GAP_JIT) / CLOUDS.BANKS) * Math.PI * 2;
    const wid = (CLOUDS.WIDTH_DEG[0] + rnd() * (CLOUDS.WIDTH_DEG[1] - CLOUDS.WIDTH_DEG[0])) * Math.PI / 180;
    const rc = CLOUDS.R[0] + rnd() * (CLOUDS.R[1] - CLOUDS.R[0]);
    const topF = CLOUDS.TOP_F[0] + rnd() * (CLOUDS.TOP_F[1] - CLOUDS.TOP_F[0]);
    const base = atR(sky, CLOUDS.BASE_F, rc), top = atR(sky, topF, rc);
    const W = 2 * rc * Math.sin(wid / 2), D = W * (CLOUDS.DEPTH[0] + rnd() * (CLOUDS.DEPTH[1] - CLOUDS.DEPTH[0]));
    const spec = { az, rc, W, D, H: top - base, base, top, wid };
    const f = bankField(spec, rnd);
    const m = bankSurface(f);
    const samp = gridSampler(f.F, f.nx, f.ny, f.nz, f.x0, f.y0, f.z0, V);
    // sky visibility per vertex, from the field itself: cast AO.AO_RAYS rays into the hemisphere above the surface
    // and count how much of the sky the cloud's own mass covers. This is the whole of the cloud's self-shadowing —
    // the crease between two lobes and the underside of a tower go dark, an outer lobe stays open to the sky.
    const reach = CLOUDS.AO.LEN * spec.H * CLOUDS.SHAPE.R_PUFF;   // how far the sky is sampled: a puff radius and a half
    const ao = (x, y, z, nx, ny, nz) => {
      // a frame with +z along the normal (any up will do: pick the world axis the normal is least aligned with)
      let ux, uy, uz;
      if (Math.abs(ny) < 0.9) { ux = -nz; uy = 0; uz = nx; } else { ux = 1; uy = 0; uz = 0; }
      let l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      let occ = 0, wsum = 0;
      for (let r = 0; r < AO_DIRS.length; r++) {
        const d = AO_DIRS[r];
        const dx = ux * d[0] + vx * d[1] + nx * d[2], dy = uy * d[0] + vy * d[1] + ny * d[2], dz = uz * d[0] + vz * d[1] + nz * d[2];
        let blocked = 0;
        for (let s = 1; s <= CLOUDS.AO.STEPS; s++) {
          const t = (reach * s) / CLOUDS.AO.STEPS;
          if (samp(x + dx * t, y + dy * t, z + dz * t) > 0) { blocked = 1 - (s - 1) / CLOUDS.AO.STEPS; break; }
        }
        occ += blocked * d[3]; wsum += d[3];
      }
      return Math.min(1, Math.max(0, 1 - occ / wsum));
    };
    const cs = Math.cos(az), sn = Math.sin(az), cut = f.cut, hSpan = Math.max(top - base - cut, 1), o0 = P.length / 3;
    // The bank is built in its own frame (x across, y up, z in and out) and placed round the ring by a RIGHT-HANDED
    // transform: tangent (sin, 0, -cos) x up = radial (cos, 0, sin), determinant +1, so the mesh is not mirrored (a
    // mirrored placement turns every triangle inside out) and the normals must ride the same rotation as the vertices.
    let yMin = 1e9, yMax = -1e9, rMin = 1e9, rMax = -1e9;
    for (let v = 0; v < m.pos.length; v += 3) {
      const x = m.pos[v], y = m.pos[v + 1], z = m.pos[v + 2];
      const rr = rc + z, wy = base + y - cut;
      P.push(rr * cs + x * sn, wy, rr * sn - x * cs);
      // normal: the field's gradient (outward = the direction the distance grows to), turned into the ring's frame
      const h = V * 0.6;
      const dx = samp(x + h, y, z) - samp(x - h, y, z);
      const dy = samp(x, y + h, z) - samp(x, y - h, z);
      const dz = samp(x, y, z + h) - samp(x, y, z - h);
      const L = Math.hypot(dx, dy, dz) || 1;
      const nx = -dx / L, ny = -dy / L, nz = -dz / L;
      N.push(nz * cs + nx * sn, ny, nz * sn - nx * cs);
      C.push(Math.min(1, Math.max(0, (y - cut) / hSpan)), ao(x, y, z, nx, ny, nz), 0);
      yMin = Math.min(yMin, wy); yMax = Math.max(yMax, wy);
      const rad = Math.hypot(P[P.length - 3], P[P.length - 1]);
      rMin = Math.min(rMin, rad); rMax = Math.max(rMax, rad);
    }
    for (let i = 0; i < m.idx.length; i++) I.push(m.idx[i] + o0);
    tris += m.idx.length / 3;
    banks.push({ az: +(az * 180 / Math.PI).toFixed(1), widthDeg: +(wid * 180 / Math.PI).toFixed(1), r: Math.round(rc),
                 w: Math.round(W), d: Math.round(D), base: Math.round(base), top: Math.round(top),
                 y: [Math.round(yMin), Math.round(yMax)], rr: [Math.round(rMin), Math.round(rMax)],
                 tris: m.idx.length / 3, v0: o0, vn: m.pos.length / 3, lobes: f.lobes });
  }
  return { pos: P, nor: N, cloud: C, idx: I, banks, tris, verts: P.length / 3 };
}

function createClouds(scene, sky, c, worldScale) {
  const t0 = performance.now();
  const M = buildCloudBanks(sky);
  const bakedMs = performance.now() - t0;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(M.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(M.nor, 3));
  g.setAttribute("aCloud", new THREE.Float32BufferAttribute(M.cloud, 3));
  g.setIndex(M.verts > 65535 ? new THREE.Uint32BufferAttribute(M.idx, 1) : new THREE.Uint16BufferAttribute(M.idx, 1));
  g.computeBoundingSphere();
  // colours: LIT is the recipe's measured cloud white (the ring's brightest tenth), SHADE / DEEP the picked blue-greys,
  // pushed a little toward this arena's own sky hue so the shade belongs to the sky it stands in
  const L = CLOUD_LOOK;
  const lit = S.srgb(c.p90 || c.all);
  // how far the picked blue-greys follow this arena's own sky hue (the ring's measured bottom colour, unit brightness)
  const ringC = S.srgb(c.bottom || c.all), ringL = Math.max(0.2126 * ringC.r + 0.7152 * ringC.g + 0.0722 * ringC.b, 1e-4);
  const hue = [ringC.r / ringL, ringC.g / ringL, ringC.b / ringL].map((v) => Math.min(1.9, Math.max(0.55, v)));
  const mixHue = (col) => {
    const s = S.srgb(col.map((v) => Math.round(v * 255)));
    return new THREE.Color(s.r * (1 + (hue[0] - 1) * L.SKY_TINT), s.g * (1 + (hue[1] - 1) * L.SKY_TINT),
                           s.b * (1 + (hue[2] - 1) * L.SKY_TINT));
  };
  const shade = mixHue(L.SHADE), deep = mixHue(L.DEEP), rim = S.srgb(L.RIM.map((v) => Math.round(v * 255)));
  const mat = new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uCloudLit: { value: lit }, uCloudShade: { value: shade }, uCloudDeep: { value: deep }, uCloudRim: { value: rim },
      uCloudA: { value: new THREE.Vector4(L.WRAP, L.KEY_POW, L.HEIGHT_POW, L.BASE_K) },
      uCloudB: { value: new THREE.Vector4(L.VIS_FLOOR, L.DEEP_HI, L.RIM_POW, L.RIM_BACK) },
      uCloudC: { value: new THREE.Vector4(L.KEY_GAIN, L.RIM_GAIN, L.BILLOW, L.BILLOW_W) },
      uCloudRamp: { value: new THREE.Vector2(L.KEY_LO, L.KEY_HI) },
    }),
    vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "builtClouds"; mesh.userData.kind = "clouds"; mesh.userData.role = "banks"; mesh.frustumCulled = false;
  mesh.scale.setScalar(worldScale() || 1);
  // the ring is in recipe units: follow the arena group's scale (set before this frame's draw, as the dome's eye is)
  mesh.onBeforeRender = () => { const s = worldScale() || 1; if (mesh.scale.x !== s) { mesh.scale.setScalar(s); mesh.updateMatrixWorld(); } };
  scene.add(mesh);
  const s8 = (col) => col.clone().convertLinearToSRGB().toArray().map((v) => Math.round(v * 255));
  return { mesh, material: mat, info: {
    banks: M.banks.length, triangles: M.tris, vertices: M.verts, list: M.banks,
    lobes: M.banks.reduce((a, b) => a + b.lobes, 0), meshes: 1,
    tones: { lit: s8(lit), shade: s8(shade), deep: s8(deep), rim: s8(rim) },
    look: { ...CLOUD_LOOK, SHADE: CLOUD_LOOK.SHADE, DEEP: CLOUD_LOOK.DEEP }, shape: { ...CLOUDS },
    bakedMs: Math.round(bakedMs), light: "shared uLightDir / uLightColor (sun by day, moon at night) + aerial()" } };
}


// ---------------- JS twins (same maths as the GLSL above) ----------------
const U = S.U;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lumaA = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const n2 = (x, z) => { const L = Math.hypot(x, z); return [x / L, z / L]; };
/** sakura skyGradient(), linear RGB [r, g, b], for a unit direction [x, y, z]. */
export function skyGradientJS(rd) {
  const H = arr(SKY_U.uHorizon.value), Z = arr(SKY_U.uZenith.value), M = arr(SKY_U.uMid.value);
  const ey = Math.max(rd[1], 0), t = Math.pow(ey, SKY_U.uZenithPow.value);
  let c = H.map((h, k) => h + (Z[k] - h) * t);
  const mk = (1 - Math.abs(t * 2 - 1)) * SKY_U.uMidAmt.value;
  c = c.map((v, k) => v + (M[k] - v) * mk);
  const td = smooth(0.36, 0.82, t), deep = SKY_U.uZenDeep.value;
  c = c.map((v) => v * (1 + (deep - 1) * td));
  const lz = lumaA(c), sk = 1 + td * (1 - deep) * 1.75;
  c = c.map((v) => lz + (v - lz) * sk);
  const am = 1 / (ey + 0.10);
  const ext = [0.030, 0.072, 0.170].map((b) => Math.exp(-b * (am - 1))), em = Math.max(...ext);
  c = c.map((v, k) => v * (1 + (ext[k] / em - 1) * 0.26));
  const hb = Math.exp(-Math.max(rd[1], -0.06) / SKY_U.uHazeH.value);
  const sd = U.uSunDir.value;
  const dxz = n2(rd[0] + 1e-5, rd[2] + 1e-5), sxz = n2(sd.x + 1e-5, sd.z + 1e-5);
  const azi = Math.pow(Math.max(dxz[0] * sxz[0] + dxz[1] * sxz[1], 0), 2.2);
  const hz = arr(U.uHaze.value), hm = clamp01(hb * SKY_U.uHazeAmt.value), wm = arr(SKY_U.uHazeWarm.value);
  const wk = hb * azi * SKY_U.uHazeAmt.value * SKY_U.uHazeWarmK.value;
  const out = c.map((v, k) => v + (hz[k] - v) * hm + wm[k] * wk);
  const bm = SKY_U.uBandMix.value;
  if (bm > 0) { const b = skyBandJS(rd); return out.map((v, k) => v + (b[k] - v) * bm); }
  return out;
}
/** Band mode: distance along rd from the ring-frame eye to the ring cylinder, and the height there (as skyBandT/H). */
export function skyBandTJS(rd, eye = SKY_U.uRingEye.value) {
  const R = SKY_U.uRing.value[0].y, a = rd[0] * rd[0] + rd[2] * rd[2];
  if (a < 1e-8) return 1e9;
  const b = eye.x * rd[0] + eye.z * rd[2], c = eye.x * eye.x + eye.z * eye.z - R * R;
  return (-b + Math.sqrt(Math.max(b * b - a * c, 0))) / a;
}
export function skyBandHJS(rd, eye = SKY_U.uRingEye.value) {
  return Math.min(1e8, Math.max(-1e8, eye.y + Math.min(skyBandTJS(rd, eye), 1e9) * rd[1]));
}
/** Band mode colour (linear) at the height where rd meets the ring (shared.js skyBand()). */
export function skyBandJS(rd, eye = SKY_U.uRingEye.value) {
  return skyBandAtJS(skyBandHJS(rd, eye));
}
/** The same colour by ring height h (render units), for checks and CPU bakes. */
export function skyBandAtJS(h) {
  const B = SKY_U.uBandY.value, H = arr(SKY_U.uHorizon.value), M = arr(SKY_U.uMid.value), Z = arr(SKY_U.uZenith.value);
  const hz = arr(U.uHaze.value);
  const f = Math.max((h - B.x) / Math.max(B.y - B.x, 1e-3), SKY_U.uBandBelow.value);
  let c = f < 0.5 ? H.map((v, k) => v + (M[k] - v) * (f - S.BAND_BOTTOM_SHARE) / (0.5 - S.BAND_BOTTOM_SHARE)) : M.map((v, k) => v + (Z[k] - v) * Math.min((f - 0.5) / 0.375, 1));
  c = c.map((v) => Math.max(v, 0));
  const sa = smooth(B.y, B.y + SKY_U.uBandFade.value, h);
  c = c.map((v, k) => v + (hz[k] - v) * sa);
  const sb = smooth(0, SKY_U.uBandSoft.value, h);
  return hz.map((v, k) => v + (c[k] - v) * sb);
}
export function skyGlowKJS() { const m = SKY_U.uBandMix.value; return m > 0 ? 1 + (SKY_U.uBandGlowK.value - 1) * m : 1; }
/** The two-lobe glow, around uGlowDir (the sun by day, the moon at night). */
export function skySunGlowJS(rd) {
  const gd = SKY_U.uGlowDir.value, s = Math.max(rd[0] * gd.x + rd[1] * gd.y + rd[2] * gd.z, 0);
  const k = Math.pow(s, SKY_U.uSunGlowPower.value) * SKY_U.uSunGlow.value + s * s * SKY_U.uBroadGlow.value;
  return arr(SKY_U.uSunGlowColor.value).map((v) => v * k);
}
/** The moon disc (0 by day). */
export function skyMoonJS(rd) {
  if (SKY_U.uMoonAmt.value <= 0) return [0, 0, 0];
  const md = SKY_U.uMoonDir.value, r = SKY_U.uMoonRadius.value;
  const c = rd[0] * md.x + rd[1] * md.y + rd[2] * md.z, dd = Math.sqrt(Math.max(1 - c * c, 0));
  const disc = 1 - smooth(r * 0.94, r * 1.06, dd), limb = 1 - 0.14 * smooth(0, r, dd), a = SKY_U.uMoonAmt.value;
  return arr(SKY_U.uMoonColor.value).map((v) => v * disc * limb * a);
}
/** The stars (0 by day): the same baked texel the shader reads, nearest sampled. */
export function skyStarsJS(rd) {
  const m = current.stars;
  if (SKY_U.uStarAmt.value <= 0 || !m || rd[1] <= 0.02) return [0, 0, 0];
  const u = Math.atan2(rd[2], rd[0]) * 0.15915494 + 0.5;
  const v = Math.asin(Math.min(1, Math.max(-1, rd[1]))) * 0.31830989 + 0.5;
  const i = Math.min(m.W - 1, Math.max(0, Math.floor(u * m.W))), j = Math.min(m.H - 1, Math.max(0, Math.floor(v * m.H)));
  const k = (j * m.W + i) * 4, s = [m.data[k] / 255, m.data[k + 1] / 255, m.data[k + 2] / 255];
  const tint = [arr(SKY_U.uStarTint0.value), arr(SKY_U.uStarTint1.value), arr(SKY_U.uStarTint2.value)];
  const g = SKY_U.uStarAmt.value * smooth(0.02, 0.10, rd[1]);
  return [0, 1, 2].map((ch) => (s[0] * tint[0][ch] + s[1] * tint[1][ch] + s[2] * tint[2][ch]) * g);
}
export function skyRadianceJS(rd) { const a = skyGradientJS(rd), b = skySunGlowJS(rd), g = skyGlowKJS(); return a.map((v, k) => v + b[k] * g); }
/** What the dome draws with the clouds off: radiance + moon disc + stars. */
export function skyDomeJS(rd) {
  const c = skyRadianceJS(rd), m = skyMoonJS(rd), s = skyStarsJS(rd);
  return c.map((v, k) => v + m[k] + s[k]);
}
/** Ring radius at height y and the height where a ray from the ring-frame eye meets the ring (as ringHitY()). */
export function ringRJS(y) {
  const P = SKY_U.uRing.value, n = SKY_U.uRingN.value;
  let a = P[0]; if (y <= a.x || n < 2) return a.y;
  for (let i = 1; i < n; i++) { const b = P[i]; if (y <= b.x || i === n - 1) return a.y + (b.y - a.y) * (y - a.x) / Math.max(b.x - a.x, 1e-3); a = b; }
  return a.y;
}
export function ringHitYJS(d, eye = SKY_U.uRingEye.value) {
  const g = (t) => Math.hypot(eye.x + t * d[0], eye.z + t * d[2]) - ringRJS(eye.y + t * d[1]);
  const T = SKY_U.uRingT.value;
  if (g(0) >= 0 || g(T) < 0) return -1e9;
  let lo = 0, hi = T;
  for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (g(m) < 0) lo = m; else hi = m; }
  return eye.y + 0.5 * (lo + hi) * d[1];
}

// ---------------- colours: measured, then the two stops solved so the finished sky gives them ----------------
/** Solve uHorizon / uZenith so skyRadiance(horizon dir) = horizon target and skyRadiance(up) = zenith target. */
function calibrate(tH, tZ, dirH) {
  const H = SKY_U.uHorizon.value, Z = SKY_U.uZenith.value;
  H.setRGB(tH[0], tH[1], tH[2]); Z.setRGB(tZ[0], tZ[1], tZ[2]);
  for (let i = 0; i < 60; i++) {
    const h = skyRadianceJS(dirH), z = skyRadianceJS([0, 1, 0]);
    H.setRGB(H.r * tH[0] / h[0], H.g * tH[1] / h[1], H.b * tH[2] / h[2]);
    Z.setRGB(Z.r * tZ[0] / z[0], Z.g * tZ[1] / z[1], Z.b * tZ[2] / z[2]);
  }
  const h = skyRadianceJS(dirH), z = skyRadianceJS([0, 1, 0]);
  return Math.max(...h.map((v, k) => Math.abs(v - tH[k])), ...z.map((v, k) => Math.abs(v - tZ[k])));
}

// ---------------- baked tiling noise (sakura's layout: R height, GB gradient of a blurred copy, A warp) ----------------
function bakeNoise(seed, N, billow) {
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const perms = Array.from({ length: 12 }, (_, k) => S.makePerm(seed * 31 + k + 1));
  const val = (u, v, p, perm) => {   // value noise, period p cells over the tile (u, v in [0, 1))
    const x = u * p, y = v * p, ix = Math.floor(x), iy = Math.floor(y), fx = fade(x - ix), fy = fade(y - iy);
    const h = (i, j) => perm[(perm[((i % p) + p) % p] + (((j % p) + p) % p)) & 255] / 255;
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (u, v, p0, oct, o0, bil) => {
    let s = 0, a = 0.5, n = 0;
    for (let k = 0; k < oct; k++) { const q = val(u, v, p0 << k, perms[o0 + k]); s += a * (bil ? Math.abs(2 * q - 1) : q); n += a; a *= 0.5; }
    return s / n;
  };
  const R = new Float32Array(N * N), A = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N;
    R[j * N + i] = billow ? 1 - fbm(u, v, 4, 5, 0, true) : fbm(u, v, 4, 5, 0, false);
    A[j * N + i] = fbm(u, v, billow ? 8 : 2, billow ? 4 : 3, 6, false);
  }
  const equalise = (F) => {   // rank -> [0, 1]: a coverage threshold cov then leaves exactly (1 - cov) of the tile above it
    const ix = Array.from(F.keys()).sort((a, b) => F[a] - F[b]), out = new Float32Array(F.length);
    ix.forEach((k, r) => { out[k] = r / (F.length - 1); });
    return out;
  };
  const He = equalise(R), Ae = equalise(A);
  let B = He;   // blurred copy (box 5x5, twice, wrapping) for the gradient
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) s += B[((j + dj + N) % N) * N + ((i + di + N) % N)];
      o[j * N + i] = s / 25;
    }
    B = o;
  }
  const gx = new Float32Array(N * N), gy = new Float32Array(N * N);
  let G = 1e-6;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    gx[j * N + i] = (B[j * N + (i + 1) % N] - B[j * N + (i - 1 + N) % N]) * N / 2;              // per uv unit
    gy[j * N + i] = (B[((j + 1) % N) * N + i] - B[((j - 1 + N) % N) * N + i]) * N / 2;
    G = Math.max(G, Math.abs(gx[j * N + i]), Math.abs(gy[j * N + i]));
  }
  const px = new Uint8Array(N * N * 4), b8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let k = 0; k < N * N; k++) {
    px[k * 4] = b8(He[k]); px[k * 4 + 1] = b8(0.5 + gx[k] / (2 * G)); px[k * 4 + 2] = b8(0.5 + gy[k] / (2 * G)); px[k * 4 + 3] = b8(Ae[k]);
  }
  const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return { tex: t, G };
}

export const current = { sky: null, stars: null, rebuildWith: null };

/** ASSET: the sky dome from the slot's data (web/built/place/sky.js skyData: the measured ring, band, colours). It sets
 *  the shared sky uniforms (SKY_U: calibrated stops, day / night, moon, stars) and draws one camera-following box in the
 *  scene. ctx: { scene, world (its scale: the ring is in recipe units), materials, info, camera }. */
export function buildSky(slot, ctx) {
  const D = slot.data, sky = D.sky, opts = D.opts || {}, scene = ctx.scene;
  const worldScale = ctx.worldScaleFn || (() => ctx.world?.scale.x || 1);
  const t0 = performance.now();
  const c = sky.colours, bg = D.bg || c.all;
  const night = skyMode({ pieces: [sky], bg: D.bg }, D.mode ?? opts.mode);
  const sd = U.uSunDir.value, perp = n2(-sd.z, sd.x);
  const dirH = [perp[0], 0, perp[1]];   // the horizon at right angles to the light: no warm band there

  // ---- night first: calibrate() below must see the glow that will actually be in the sky ----
  if (night.mode === "night") {
    // the moon stands AGAINST the light: the sun's elevation, the opposite side of the sky (plan: disc vs light split)
    SKY_U.uMoonDir.value.set(-sd.x, sd.y, -sd.z).normalize();
    SKY_U.uMoonColor.value.setRGB(...NIGHT.MOON_COLOR);
    SKY_U.uMoonRadius.value = NIGHT.MOON_RADIUS; SKY_U.uMoonAmt.value = 1;
    SKY_U.uGlowDir.value.copy(SKY_U.uMoonDir.value);                       // the glow is the moon's halo
    SKY_U.uSunGlowColor.value.setRGB(...NIGHT.GLOW_COLOR);
    SKY_U.uSunGlow.value = NIGHT.GLOW; SKY_U.uSunGlowPower.value = NIGHT.GLOW_POWER; SKY_U.uBroadGlow.value = NIGHT.BROAD;
    SKY_U.uHazeWarmK.value = NIGHT.HAZE_WARM_K;
    SKY_U.uCloudLit.value.copy(S.srgb(NIGHT.CLOUD_LIT));                    // moonlit decks (PICKED)
    SKY_U.uCloudAmb.value.copy(S.srgb(NIGHT.CLOUD_AMB));
    SKY_U.uCloudDark.value.copy(S.srgb(NIGHT.CLOUD_DARK));
    const m = bakeStars(1013, NIGHT.STAR_MAP[0], NIGHT.STAR_MAP[1], NIGHT.STAR_TIERS, SKY_U.uMoonDir.value.toArray(), NIGHT.MOON_RADIUS);
    SKY_U.uStarTex.value = m.tex; SKY_U.uStarAmt.value = NIGHT.STAR_AMP;
    SKY_U.uStarTint0.value.setRGB(...NIGHT.STAR_TIERS[0].tint);
    SKY_U.uStarTint1.value.setRGB(...NIGHT.STAR_TIERS[1].tint);
    SKY_U.uStarTint2.value.setRGB(...NIGHT.STAR_TIERS[2].tint);
    current.stars = m;
  } else {   // day: everything the night branch touches goes back to the day values, so a rebuild is not sticky
    SKY_U.uMoonAmt.value = 0; SKY_U.uStarAmt.value = 0; SKY_U.uStarTex.value = null;
    SKY_U.uGlowDir.value.copy(sd);                                         // the glow is the sun's
    SKY_U.uSunGlowColor.value.setRGB(1.0, 0.85, 0.6);
    SKY_U.uSunGlow.value = 0.30; SKY_U.uSunGlowPower.value = 8.0; SKY_U.uBroadGlow.value = 0.03;
    SKY_U.uHazeWarmK.value = 0.80;
    current.stars = null;
  }

  // ring
  let prof = sky.profile?.length ? sky.profile : [[sky.ymin, sky.rmax], [sky.ymax, sky.rmin]];   // no profile: a cone
  if (prof.length > RING_MAX) prof = Array.from({ length: RING_MAX }, (_, i) => prof[Math.round(i * (prof.length - 1) / (RING_MAX - 1))]);
  prof.forEach(([y, r], i) => SKY_U.uRing.value[i].set(y, r));
  SKY_U.uRingN.value = prof.length; SKY_U.uRingT.value = 8 * sky.rmax;
  SKY_U.uBandY.value.set(sky.ymin, sky.ymax);
  // measured colours -> linear, once
  const lin = (rgb) => arr(S.srgb(rgb));
  const tH = lin(c.bottom || c.all), tZ = lin(bg);
  SKY_U.uMid.value.setRGB((tH[0] + tZ[0]) / 2, (tH[1] + tZ[1]) / 2, (tH[2] + tZ[2]) / 2);   // PICKED: nothing measured between
  // night: the measurement wins over the picked halo. calibrate() can only scale the stops (never below 0), so the
  // moon's glow alone must stay under the measured colour at the two calibration spots; if it does not, both glow
  // lobes are scaled down together until the glow there is at most NIGHT.GLOW_MAX_SHARE of the measured colour.
  let glowScale = 1;
  if (night.mode === "night") {
    for (const [dir, tgt] of [[dirH, tH], [[0, 1, 0], tZ]]) {
      const g = skySunGlowJS(dir);
      for (let k = 0; k < 3; k++) if (g[k] > 0) glowScale = Math.min(glowScale, NIGHT.GLOW_MAX_SHARE * tgt[k] / g[k]);
    }
    SKY_U.uSunGlow.value *= glowScale; SKY_U.uBroadGlow.value *= glowScale;
  }
  // BAND MODE, by measurement: the sky piece floats above the floor (its ymin > 0), i.e. a painted sky band stands on
  // top of another band (a treeline). Then a direction-only gradient is wrong (the band's elevation depends on the
  // azimuth and the eye: from 10 m off centre it spans 8.7..19.3 deg on the far side and 18..36.8 deg on the near
  // side), so the colour is read from the height where the view ray meets the ring (shared.js skyBand()).
  const band = D.band;
  let residual;
  if (band) {
    // the measured colours ARE the stops (no solve): bottom quarter / median / top quarter of the band picture at
    // band share BAND_BOTTOM_SHARE / 0.5 / 0.875; the sun glow is off (BAND.GLOW_K) so the dome shows exactly them
    const tM = lin(c.all), tT = lin(c.top || c.all);
    SKY_U.uHorizon.value.setRGB(...tH); SKY_U.uMid.value.setRGB(...tM); SKY_U.uZenith.value.setRGB(...tT);
    SKY_U.uBandMix.value = 1;
    SKY_U.uBandBelow.value = BAND.BELOW; SKY_U.uBandSoft.value = BAND.SOFT_M * S.UNITS_PER_M;
    SKY_U.uBandFade.value = BAND.FADE_SHARE * (sky.ymax - sky.ymin);
    SKY_U.uBandGlowK.value = night.mode === "night" ? 1 : BAND.GLOW_K;   // at night the halo is the moon's (picked)
    for (const [k, v] of Object.entries(BAND.CLOUDS)) SKY_U[k].value = v;
    const err = (h, t) => { const g = skyBandAtJS(h); return Math.max(...g.map((v, k) => Math.abs(v - t[k]))); };
    const y = (f) => sky.ymin + f * (sky.ymax - sky.ymin);
    residual = Math.max(err(y(S.BAND_BOTTOM_SHARE), tH), err(y(0.5), tM), err(y(0.875), tT));
  } else {
    SKY_U.uBandMix.value = 0; SKY_U.uSkyClAmt.value = 0; SKY_U.uBandGlowK.value = 0;
    residual = calibrate(tH, tZ, dirH);
  }
  if (night.mode === "day") {
    SKY_U.uCloudLit.value.copy(S.srgb(c.p90 || c.all));     // the ring's brightest tenth
    SKY_U.uCloudAmb.value.copy(S.srgb(c.top || c.all));     // the ring's top quarter (median: cloud)
    SKY_U.uCloudDark.value.copy(S.srgb(c.p90 || c.all).lerp(S.srgb(c.all), 0.6));   // PICKED: brightest tenth toward the median
  }
  // the old projected noise decks: OFF unless asked for (opts.decks); their noise is only baked when they are on
  const decks = !!opts.decks;
  SKY_U.uCloudAmt.value = decks ? 1 : 0;
  const A = decks ? bakeNoise(1013, 256, false) : null, C = decks ? bakeNoise(2027, 256, true) : null;
  SKY_U.uNoiseA.value = A?.tex ?? null; SKY_U.uNoiseC.value = C?.tex ?? null; SKY_U.uGradS.value = C?.G ?? 1;
  // dome
  const mat = skyMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  mesh.name = "builtSky"; mesh.renderOrder = -1000; mesh.frustumCulled = false;
  const tmpH = new THREE.Vector2();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    mesh.position.copy(camera.position);
    mesh.scale.setScalar(Math.max(camera.far ?? 400, 10) * 0.5);
    mesh.updateMatrixWorld();
    const rt = renderer.getRenderTarget();
    const h = rt ? rt.height : renderer.getDrawingBufferSize(tmpH).y;
    SKY_U.uPxRad.value = 2 * Math.tan((camera.fov ?? 45) * Math.PI / 360) / Math.max(1, h);
    const s = worldScale() || 1, e = SKY_U.uRingEye.value.copy(camera.position).divideScalar(s);
    // slopes outside which no ray from this eye can meet the band (nearest ring point is >= rmin - |eye| away)
    const D = Math.max(1, sky.rmin - Math.hypot(e.x, e.z));
    SKY_U.uBandS.value.set((sky.ymin - e.y) / D, (sky.ymax - e.y) / D);
  };
  scene.add(mesh);
  // the 3D cumulus banks (one mesh, in the ring's measured band, behind the trees)
  // (band mode: not built unless opts.clouds === true — meft1008's band picture has no cloud shape at all, every
  //  texel row is 1-2 colours, std <= 4/255; the subtle band clouds in the dome stand in for them)
  const clouds = null;   // the cloud banks are their own slot (sky.clouds, buildClouds below)
  const info = { triangles: mesh.geometry.index.count / 3, ring: prof, band: [sky.ymin, sky.ymax], calibResidual: residual,
                 gradS: decks ? [A.G, C.G] : null, decks, clouds: clouds?.info ?? null, ms: Math.round(performance.now() - t0), mode: night.mode, glowScale,
                 night: { mode: night.mode, measured: night.measured, forced: night.forced, request: night.request, ringLuma: +night.luma.toFixed(4), threshold: night.threshold, ring: night.ring,
                          moonDir: SKY_U.uMoonDir.value.toArray(), moonRadius: SKY_U.uMoonRadius.value,
                          moonDeg: +(SKY_U.uMoonRadius.value * 180 / Math.PI).toFixed(3), glowDir: SKY_U.uGlowDir.value.toArray(),
                          stars: current.stars ? { size: [current.stars.W, current.stars.H],
                            texelDeg: [360 / current.stars.W, 180 / current.stars.H], skippedMoon: current.stars.skippedMoon,
                            tiers: current.stars.tiers.map((t) => ({ n: t.n, mag: t.mag })) } : null },
                 targets: { horizon: c.bottom || c.all, zenith: bg, haze: D.haze },
                 bandMode: band ? { stops: { bottom: c.bottom || c.all, median: c.all, top: c.top || c.all, at: [S.BAND_BOTTOM_SHARE, 0.5, 0.875] },
                   band: [sky.ymin, sky.ymax], ringR: SKY_U.uRing.value[0].y, below: SKY_U.uBandBelow.value, soft: SKY_U.uBandSoft.value,
                   fade: SKY_U.uBandFade.value, glowK: SKY_U.uBandGlowK.value, lake: U.uHaze.value.clone().convertLinearToSRGB().toArray().map((v) => Math.round(v * 255)),
                   clouds: Object.fromEntries(Object.keys(BAND.CLOUDS).map((k) => [k, SKY_U[k].value])) } : null };
  const noise = decks ? [A.tex, C.tex] : [], stars = current.stars;
  // the arena's material list: a rebuild (sky time) replaces the old dome's material in place
  const mats = ctx.materials, prev = current.sky?.scene === scene ? current.sky.material : null, k = mats && prev ? mats.indexOf(prev) : -1;
  if (k >= 0) mats[k] = mat; else mats?.push(mat);
  if (ctx.info) ctx.info.sky = info;
  current.sky = { mesh, material: mat, info, scene, worldScale, noise, clouds, opts, data: D };
  return { objects: [mesh], meshes: [mesh], dome: mesh, material: mat, info,
           dispose() { mesh.geometry.dispose(); mat.dispose(); for (const t of noise) t.dispose(); stars?.tex?.dispose(); } };
}

/** ASSET: the 3D cumulus banks in the ring's measured band, behind the trees (slot sky.clouds). */
export function buildClouds(slot, ctx) {
  const sky = slot.data.sky, worldScale = ctx.worldScaleFn || (() => ctx.world?.scale.x || 1);
  const cl = createClouds(ctx.scene, sky, sky.colours, worldScale);
  if (ctx.info?.sky) ctx.info.sky.clouds = cl.info;
  if (current.sky) { current.sky.clouds = cl; current.sky.info.clouds = cl.info; }
  return { objects: [cl.mesh], meshes: [cl.mesh], info: cl.info,
           dispose() { cl.mesh.geometry.dispose(); cl.material.dispose(); if (current.sky?.clouds === cl) current.sky.clouds = null; } };
}

/** The sky of a recipe on its own (the checkers' stand-alone build): skyData (placement) + buildSky + buildClouds. */
export function createBuiltSky(scene, rec, pal, worldScale = () => 1, opts = {}) {
  const D = skyDataOf(rec, opts);
  if (!D) return null;
  const slot = { data: D }, ctx = { scene, worldScaleFn: worldScale, materials: null, info: null };
  current.sky = null;
  const dome = buildSky(slot, ctx);
  scene.add(dome.dome);
  if (D.clouds) { const cl = buildClouds(slot, ctx); scene.add(cl.objects[0]); current.sky.clouds = cl; current.sky.cloudInst = cl; }
  current.sky.pal = pal; current.sky.rec = rec; current.sky.dispose = () => { dome.dispose(); current.sky.cloudInst?.dispose(); };
  return current.sky;
}

/** The Arena Viewer's "sky time" switch: rebuild ONLY the sky of the last createBuiltSky() call with mode "auto"
 *  (the measurement decides), "day" or "night". The old dome, its noise and its star map are removed and freed; the
 *  shared sky uniforms (SKY_U) are rewritten by the rebuild, so the haze of every lit material follows at once. */
export function setBuiltSkyMode(mode = "auto") {
  const o = current.sky;
  if (!o) return null;
  if (!o.rec && current.rebuildWith) return current.rebuildWith(mode);   // an arena's sky: its slots build again
  o.scene.remove(o.mesh); if (o.cloudInst) o.scene.remove(o.cloudInst.objects[0]);
  o.dispose?.();
  return createBuiltSky(o.scene, o.rec, o.pal, o.worldScale, { ...o.opts, mode });
}
