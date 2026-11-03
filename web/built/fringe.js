// GRASS / REED FRINGE of the BUILT arena (Arena Viewer, look=built only; recipe kind "fringe", meft1008 wall_07).
// ASSET ONLY (blade emit + material); the blade plan is web/built/place/fringe.js. WHERE: one clump per upright card of the piece, from the recipe's own `cards` (tools/arena_built_recipe.py; 5 cards
// on meft1008 at az 50.3 / 75.1 / 101.3 / 120.1 / -156.3 deg, r 17.4..24.4 m, 2.24 m wide, 2.02-3.55 m tall) — never
// a hard-coded azimuth. The four in the bay stand out in the LAKE, 8-15 m past the land's edge (MEASURE.md 2b/2d).
// WHAT: crossed tapered blade ribbons (2 per blade, 7 tris each, opaque — no alpha texture, no sorting), 26 blades
// per card, in ONE merged BufferGeometry = one draw call.
// THE HALF BELOW y = 0 IS THE REFLECTION: the original paints it into the same card (MEASURE.md 2d: alpha equal at
// the mirrored point 87.8 % of the time; above y 0 median [8,64,16], below [8,32,32] — darker and bluer). So every
// blade is mirrored about the water line with the measured tint (G x0.5, B x2.0, lifted toward the lake blue-grey)
// and a slightly stronger wobble; the above-water block and the reflection block are laid out as two contiguous
// index ranges (info.aboveIndexCount) so the checker can render each half on its own. Nothing is drawn below the
// card's own measured half-height, so the reflection is exactly as deep as the reeds are tall.
// WIND: the ONE shared field (shared.js U: uWindDir/uWindTime/uWindStrength/uWindGust, and the travelling ring gust
// uWindRing that trees.js turns on for this arena) — no second wind system. Bend amplitude only, growing as t^2 from
// the water line, so a clump sways as a mass and its reflection sways with it.
// Research: ~/dw3-knowledge/research/r5-meft1008/grass.md §1.2 and §6 step 4 (the measured card table, double-sided,
// alphaTest never blended, "the reflection is painted into the same card").
import * as THREE from "../lib3d/three.module.js";
import * as S0 from "./shared.js";

const M = 400;   // render units per metre (shared.js UNITS_PER_M)

// ---- the numbers (PICKED unless noted; lengths in metres) ----
export const FRINGE = {
  // USER (2026-10-30, comparing with the real game): "dense, bright saturated green grass clumps, wide and full, with
  // dark reflections under them" -- the first build (26 thin 3.5-6 cm blades per card) read as sparse dark reeds.
  BLADES: 200,         // per card (2.24 m wide); grouped into TUFTS below, so the card reads as a full clump
  TUFTS: 10,           // tufts across a 2.24 m card (a tuft = BLADES/TUFTS blades fanning out from one root)
  BW: [0.070, 0.120],  // blade width (m): wide meadow/reed blades, not lawn
  HERO: 6,             // blades that reach the card's own half height (the measured silhouette)
  HMIN: 0.40,          // the shortest blade, as a share of that half height
  CURVE: 0.34,         // sideways bow of a blade at its tip, x its height (fans the tuft out: width and fullness)
  JITTER: 0.45,        // m of depth scatter across the card line (a clump, not a wall)
  CROSSED: 1,          // ribbons per blade (random yaw each, double-sided: 200 blades read as a mass from every side)
  TAN: 0.26,           // toonLight rim (kept for the old checker key)
  // COLOURS, MEASURED (k-means of the opaque texels of wall_07's above-water half, original palette sheet):
  //   tip [26,86,20] 26 %, lit mid [17,72,17] 17 %, mid [9,61,18] 20 %, shade [3,36,19]..[3,43,17] 26 %
  // The module reads the piece's own p90 (= tip), median (= mid) from the recipe; the root is the median x ROOT_K.
  ROOT_K: 0.62,
  // the three stops, MEASURED from the above-water half's opaque texels (k-means, see above): shade/root, mid, lit tip
  MID: [12, 64, 18], TIP: [26, 86, 20],
  // the painted-in reflection half (below y 0), k-means of its opaque texels: [16,39,47] 23 %, [10,34,37], [9,28,29],
  // [24,46,56] 11 % lit, [6,8,16]..[9,14,24] 29 % dark -> a dark blue-green, ~0.4x the green above
  REF_TIP: [24, 46, 56], REF_MID: [12, 34, 38], REF_ROOT: [6, 10, 18],   // sRGB
  RIPPLE: 0.012,       // extra wobble of the reflection, x its blade height
  SEED: 1007,
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// the one place a fringe vertex's sway is made (the material and the checker's JS probe both call this)
const f = (x) => x.toFixed(4);
export const FRINGE_GLSL = /* glsl */`
  // p: the vertex (render units, |y| <= H), anchor: the blade's foot on the water line, t: 0 at the root .. 1 at the
  // tip, H: the blade's own height (render units), refl: 1 for the mirrored reflection vertex.
  vec3 fringeWind(vec3 p, vec3 anchor, float t, float H, float refl) {
    vec2 wO = normalize(uWindDir + vec2(1e-5, 0.0));
    float ph = 6.2831853 * noise3(anchor / 97.0 + vec3(17.0, 3.0, 5.0));
    float gust = noise3(vec3(anchor.xz / uWindPhaseScale, uWindTime * 0.15));
    float amp = uWindStrength * (0.65 + 0.35 * sin(uWindTime * uWindFreq + ph)) * (1.0 + uWindGust * (gust - 0.5) * 2.0);
    if (uWindRing != 0.0) amp *= 1.0 + uWindRing * sin(atan(anchor.z, anchor.x) * 3.0 - uWindTime * 0.9);
    float k = t * t;
    p.xz += wO * (amp * H * 2.0) * k;                       // bend amplitude only (never a phase term)
    p.x += refl * sin(uWindTime * 1.7 + anchor.x * 0.013 + abs(p.y) * 0.02) * H * ${f(FRINGE.RIPPLE)} * k;
    return p;
  }
`;

/** JS twin of fringeWind (position only), for the checker. u: { windDir:[x,y], time, strength, gust, freq,
 *  phaseScale, ring } — the same numbers the shared uniforms hold. */
export function fringeWindJS(p, anchor, t, H, refl, u) {
  if (!u || !(u.strength > 0)) return [...p];
  const wl = Math.hypot(u.windDir[0], u.windDir[1]) || 1, wx = u.windDir[0] / wl, wz = u.windDir[1] / wl;
  const NO = S0.noise3JS;   // the JS twin of the shader's noise3()
  const ph = 6.2831853 * NO(anchor[0] / 97 + 17, anchor[1] / 97 + 3, anchor[2] / 97 + 5);
  const gust = NO(anchor[0] / u.phaseScale, u.time * 0.15, anchor[2] / u.phaseScale);
  let amp = u.strength * (0.65 + 0.35 * Math.sin(u.time * u.freq + ph)) * (1 + u.gust * (gust - 0.5) * 2);
  if (u.ring) amp *= 1 + u.ring * Math.sin(Math.atan2(anchor[2], anchor[0]) * 3 - u.time * 0.9);
  const k = t * t, q = [...p];
  q[0] += wx * amp * H * 2 * k; q[2] += wz * amp * H * 2 * k;
  q[0] += refl * Math.sin(u.time * 1.7 + anchor[0] * 0.013 + Math.abs(p[1]) * 0.02) * H * FRINGE.RIPPLE * k;
  return q;
}

export function fringeMaterial(S, uni) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith(uni),
    vertexShader: /* glsl */`
      attribute vec3 aAnchor; attribute float aT; attribute float aH; attribute float aRef; attribute float aTint;
      varying vec3 vW; varying vec3 vN; varying float vT; varying float vRef; varying float vTint;
      ${S.NOISE_GLSL}
      ${S.WIND_GLSL}
      ${FRINGE_GLSL}
      void main() {
        vec3 p = fringeWind(position, aAnchor, aT, aH, aRef);
        #ifdef USE_INSTANCING
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vec4 w = modelMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
        #endif
        vW = w.xyz;
        vT = aT; vRef = aRef; vTint = aTint;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uRootCol, uMidCol, uTipCol, uRefRoot, uRefMid, uRefTip;
      varying vec3 vW; varying vec3 vN; varying float vT; varying float vRef; varying float vTint;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        if (!gl_FrontFacing) N = -N;
        float t = smoothstep(0.0, 0.95, vT);
        vec3 base = (t < 0.30 ? mix(uRootCol, uMidCol, t / 0.30) : mix(uMidCol, uTipCol, (t - 0.30) / 0.70)) * vTint;
        // a blade is lit from above/behind: a soft sun term and the shared brightness, not the 3-band toon step
        // (the measured colours ARE the lit grass; a band step would paint it darker than the original's clump)
        float sun = 0.88 + 0.24 * clamp(dot(N, normalize(uLightDir + vec3(0.0, 0.6, 0.0))) * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = base * sun;
        if (vRef > 0.5) {
          // the painted-in reflection: dark blue-green, lighter toward the tips (= nearest the waterline)
          col = (t < 0.5 ? mix(uRefRoot, uRefMid, t * 2.0) : mix(uRefMid, uRefTip, (t - 0.5) * 2.0)) * vTint;
        }
        gl_FragColor = vec4(col, 1.0);   // no aerial lift: the measured greens are the target
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: false,
  });
}

/** the default asset of the slot fringe.clumps: the blades of web/built/place/fringe.js emitted as ONE geometry
 *  (above-water blades first, then their reflections). Returns { objects, meshes, info, ... }. */
export function buildFringe(slot, env) {
  const { S = S0 } = env;
  const t0 = performance.now();
  const c0 = slot.data.colours || {};
  const lin = (c, k = 1) => S.srgb(c || [10, 41, 21], k);

  const mid = FRINGE.MID, tipc = FRINGE.TIP;   // measured stops (the recipe's piece colours mix in the reflection half)
  const uni = {
    uRootCol: { value: lin(mid.map((v) => v * FRINGE.ROOT_K)) },   // dark foot of the clump
    uMidCol: { value: lin(mid) },                                  // the piece's measured median
    uTipCol: { value: lin(tipc) },                                 // lit tips (measured p90)
    uRefRoot: { value: lin(FRINGE.REF_ROOT) }, uRefMid: { value: lin(FRINGE.REF_MID) }, uRefTip: { value: lin(FRINGE.REF_TIP) },
  };

  const plan = slot.data.clusters;

  // ---- 2. emit: every above-water blade first, then every reflection (two contiguous index ranges) ----
  const rows = [0, 0.35, 0.68, 0.90];   // ribbon rows + a tip vertex
  const P = [], NRM = [], AN = [], AT = [], AH = [], AR = [], ATI = [], IDX = [];
  const push = (c, n, anchor, t, H, ref, tint) => {
    P.push(c[0], c[1], c[2]); NRM.push(n[0], n[1], n[2]); AN.push(anchor[0], anchor[1], anchor[2]);
    AT.push(t); AH.push(H); AR.push(ref); ATI.push(tint); return P.length / 3 - 1;
  };
  for (const ref of [0, 1]) {
    for (const cl of plan) {
      const start = IDX.length, vStart = P.length / 3;
      for (const bl of cl.blades) {
        for (const rot of (FRINGE.CROSSED > 1 ? [0, Math.PI / 2] : [0])) {   // CROSSED ribbons per blade (random yaw each)
          const a = bl.yaw + rot, wx = Math.cos(a), wz = Math.sin(a);   // the ribbon's width axis
          const nrm = [-wz, 0, wx];                                     // its normal stays horizontal
          const bx = -Math.sin(a), bz = Math.cos(a);                    // where the bow leans
          const [fx, , fz] = bl.foot, flip = ref ? -1 : 1;
          const ids = [];
          for (const t of rows) {
            const y = bl.H * t, hw = bl.bw * 0.5 * (1 - 0.82 * Math.pow(t, 1.15));
            const ox = bx * bl.bow * t * t, oz = bz * bl.bow * t * t;
            ids.push(push([fx + ox - wx * hw, y * flip, fz + oz - wz * hw], nrm, bl.foot, t, bl.H, ref, bl.tint));
            ids.push(push([fx + ox + wx * hw, y * flip, fz + oz + wz * hw], nrm, bl.foot, t, bl.H, ref, bl.tint));
          }
          ids.push(push([fx + bx * bl.bow, bl.H * flip, fz + bz * bl.bow], nrm, bl.foot, 1, bl.H, ref, bl.tint));
          for (let q = 0; q < rows.length - 1; q++) {
            const i0 = ids[q * 2], i1 = ids[q * 2 + 1], i2 = ids[q * 2 + 2], i3 = ids[q * 2 + 3];
            if (ref) IDX.push(i0, i2, i1, i1, i2, i3); else IDX.push(i0, i1, i2, i1, i3, i2);
          }
          const i4 = ids[rows.length * 2 - 2], i5 = ids[rows.length * 2 - 1], i6 = ids[rows.length * 2];
          if (ref) IDX.push(i4, i6, i5); else IDX.push(i4, i5, i6);
        }
      }
      cl[ref ? "refRange" : "aboveRange"] = [start, IDX.length - start, vStart, P.length / 3 - vStart];
    }
  }
  const aboveIndexCount = plan.reduce((a, c) => a + c.aboveRange[1], 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(NRM), 3));
  geo.setAttribute("aAnchor", new THREE.BufferAttribute(new Float32Array(AN), 3));
  geo.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(AT), 1));
  geo.setAttribute("aH", new THREE.BufferAttribute(new Float32Array(AH), 1));
  geo.setAttribute("aRef", new THREE.BufferAttribute(new Float32Array(AR), 1));
  geo.setAttribute("aTint", new THREE.BufferAttribute(new Float32Array(ATI), 1));
  geo.setIndex(IDX);
  geo.computeBoundingSphere();

  const mat = fringeMaterial(S, uni);
  env.materials?.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "builtFringe"; mesh.userData.kind = "fringe";

  const info2 = {
    clusters: plan.length, blades: plan.reduce((a, c) => a + c.blades.length, 0),
    tris: IDX.length / 3, trisAbove: aboveIndexCount / 3, verts: P.length / 3,
    calls: 1, crossed: FRINGE.CROSSED, tufts: FRINGE.TUFTS, aboveIndexCount, values: FRINGE,
    band: { r: [Math.min(...plan.map((c) => c.r)), Math.max(...plan.map((c) => c.r))] },
    cards: plan.map((c) => ({ piece: c.piece, az: +c.az.toFixed(2), r: +c.r.toFixed(1), w: +c.w.toFixed(1),
                              half: +c.half.toFixed(1), blades: c.blades.length,
                              heroH: +Math.max(...c.blades.map((b) => b.H)).toFixed(1),
                              aboveRange: c.aboveRange, refRange: c.refRange })),
    colours: { root: mid.map((v) => v * FRINGE.ROOT_K), mid, tip: tipc, all: c0.all, ref: { root: FRINGE.REF_ROOT, mid: FRINGE.REF_MID, tip: FRINGE.REF_TIP } },
    buildMs: Math.round(performance.now() - t0),
  };
  env.info && (env.info.fringe = info2);

  // the sway lives entirely in the shader: the only per-frame input is the shared uWindTime (shared.js wind.tick)
  const api = { objects: [mesh], meshes: [mesh], info: info2, clusters: plan, mesh, geo, material: mat, uniforms: uni };
  mesh.userData.fringe = api;
  return api;
}
