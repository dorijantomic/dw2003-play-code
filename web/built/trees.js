// NEAR TREE RING of a forest-and-lake arena (meft1008), built look (Arena Viewer, look=built). Loaded by
// web/arena-built.js for the recipe kinds
//   cypress_wall   a closed band of tall, narrow, cypress-like trees (floor_01: solid 0..13.5 m, ragged top to 16 m)
//   cypress_grove  shrubs at the foot (dense 0..3.5 m) with taller cypress-like trees above, a thin waist at ~4 m
//                  between them (floor_00, floor_02)
//   far_pines      the FAR PINES (wall_00): REAL 3D pine trees (trunk, drooping whorls, needle comb), one row at the
//                  recipe's own radius (27.78 m), tops 4.7..7.3 m; see the PINE/FAR section below (user verdict: the
//                  earlier painted ribbon looked like cardboard).
// What the pieces ARE is the user's word (meft1008 BUILD-BRIEF): shrubs at the foot, tall narrow cypress-like trees
// behind them, NOT pines; and the far wall is pines (3D, wall_00). The cypresses have visible bark trunks and leafy,
// broken edges (jagged rings + a shader edge breakup). WHERE they stand is the arena's own cards
// (tools/arena_built_recipe.py, only the cards above y 0: each floor piece also holds its upside-down lake copy,
// which is NOT built here; see `reflection` below).
// The SHAPE numbers (spacing, heights, crown base, widest point, taper) were fitted so the ring's opaque share per
// height, seen from the arena centre, matches the cards' measured opaque share per 0.5 m row
// (~/dw3-knowledge/research/r5-meft1008/MEASURE.md 2c); tools/verify_built_trees.mjs measures the built result.
//
// Methods reused: the instancing + wind of the pines in web/arena-built.js (geometry height 1, one InstancedMesh per
// species and 90 deg sector, shared builtWorldPos() wind before the instance matrix, shared toonLight + aerial haze);
// the shrubs are web/arena-built.js's fluffy bush (fluffytree method, MIT, web/lib3d/fluffytree/LICENSE) with taller
// clumps. The cypress is a lathe (surface of revolution) with vertical "flame" lobes, normals half from the smooth
// profile so the crown shades as one soft column, and tufts in the fragment from the shared noise (no textures,
// no image files, nothing downloaded).
// Wind: the shared field plus the shared travelling ring gust (U.uWindRing, settled on the meft1008 board), which
// this module turns on (0 elsewhere, so meft1013/meft1002 do not move differently).
import { foliageMaterial, fluffyPart, buildGeometry, leafClumpTexture } from "../arena-built.js";

const M = 400;   // render units per metre (shared.js UNITS_PER_M)

// ---- fitted shapes (metres). FITTED = least-squares fit of the opaque share per height to MEASURE.md 2c
//      (scratch model: solids of revolution, 0.25 deg columns from the centre); PICKED = a look choice, no data.
export const WALL = {
  spacing: 1.0,        // FITTED: m between trees along the card, front row; the back row sits between them
  depth: 0.7,          // PICKED: m between the front and back row (radially), both inside the measured 14.6..16.5 m
  H0: 14.4, HR: 1.7,   // FITTED (13.76 + 2.2 on the scratch model), then raised on the built geometry: its flame lobes
                       //         and pointed tip read ~0.7 m lower than the model (verify_built_trees.mjs column tops);
                       //         front row 14.4..16.1 m (measured column tops p10/p50/p90 14.55 / 15.49 / 15.86, max 16.07)
  backDrop: 0.62,      // FITTED: the back row is this much lower
  Rm: 1.15,            // FITTED: widest crown radius (m) (search bounded at 1.15 to stay narrow: H / 2Rm ~ 6.5)
  tm: 0.56,            // FITTED: widest at this share of the crown height
  p: 0.45,             // FITTED: taper exponent above the widest point (< 1 = round-shouldered, cypress-like)
  b0: 0.62,            // PICKED (was 0.86 FITTED): radius at the crown's foot / Rm; the foliage now starts at cb, so it begins narrower
  cb: 1.3,             // PICKED (was 0, FITTED): crown foot (m). USER: the cypresses had no trunk. Trunks 0..1.3 m now show; the two
                       //         staggered rows' trunks (r 0.2..0.3 m at 1 m spacing) keep the wall's 0..1.3 m rows mostly closed
  trunk: 0.2,          // PICKED (was 0): trunk radius (m) at the crown foot; the foot flares to 1.5x
};
export const GROVE = {
  spacing: 1.51,       // FITTED
  out: 0.3,            // FITTED: trees stand this far behind the card line (m)
  H0: 15.27, HR: 0.72, // FITTED: heights 15.3..16.0 m
  cb: 5.18,            // FITTED: crown foot (m): below it only trunks and the shrubs (the measured waist at 4 m)
  tm: 0.31, p: 0.61, b0: 0.63,
  Rm: 0.61,            // FITTED
  trunk: 0.22,         // FITTED: trunk radius (m)
};
export const SHRUB = {
  spacing: 2.14,       // FITTED
  front: 0.5,          // FITTED: shrubs stand this far in front of the card line (m)
  H0: 2.54, HR: 1.45,  // FITTED: 2.5..4.0 m tall (measured dense mass 0..3.5 m)
  radiusK: 0.32,       // FITTED: half-width / height
};
// cypress lathe resolution (PICKED): sides round, rows up the crown
const SIDES = 12, ROWS = 22, LOBES = 5, LOBE_AMP = 0.16, NORMAL_SOFT = 0.5;
const JAG = 0.20;        // PICKED: leafy broken outline - each ring vertex's radius is pushed +-JAG by a seeded hash, alternate sides in/out (USER: smooth sticks on poles)
export const GUST = 0.25;   // the shared ring gust depth (board: amp *= 1 + 0.25 x ring)

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** crown radius (m) at height y (m) of a tree with shape S and height H; 0 above the top. */
export function crownRadius(S, H, y) {
  if (y < 0 || y > H) return 0;
  let r = 0;
  if (y >= S.cb) {
    const t = (y - S.cb) / (H - S.cb);
    r = t < S.tm ? S.Rm * (S.b0 + (1 - S.b0) * Math.sqrt(t / S.tm)) : S.Rm * Math.pow((1 - t) / (1 - S.tm), S.p);
  }
  return Math.max(r, y < S.cb + 0.2 ? S.trunk : 0);
}

// ---- cypress geometry: height 1, base at the origin, radius in units of the reference height ----
export function cypressGeometry(THREE, S, Href, seed) {
  const R = rng(seed), ph = Array.from({ length: 4 }, () => R() * Math.PI * 2);
  const k = 1 / Href, cb = S.cb * k, pos = [], nor = [], hgt = [], kind = [], idx = [];
  const prof = (t) => crownRadius(S, Href, cb * Href + t * (Href - S.cb)) * k;   // t 0..1 up the crown
  // rows: denser toward the top (the taper), t = 1 - (1 - s)^1.4
  const ts = Array.from({ length: ROWS + 1 }, (_, i) => 1 - Math.pow(1 - i / ROWS, 1.4));
  const ring = (y, rr, t, lobed) => {
    const base = pos.length / 3;
    for (let s = 0; s <= SIDES; s++) {
      const sm = s % SIDES, a = sm / SIDES * Math.PI * 2;
      // flames: LOBES vertical lobes that drift round with height, plus a slower wobble (seeded)
      const lobe = lobed ? 1 + LOBE_AMP * (0.6 * Math.sin(LOBES * a + ph[0] + t * 5.0) + 0.4 * Math.sin(3 * a + ph[1] - t * 8.0)) * Math.min(1, t * 6) : 1;
      const jag = lobed ? 1 + JAG * ((((sm * 7 + Math.round(t * 997) * 13) % 11) / 11 - 0.5) * 2) * (sm % 2 ? 1 : -0.6) * Math.min(1, t * 8) : 1;
      const r = rr * lobe * jag;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r); hgt.push(y); kind.push(lobed ? 0 : 1); nor.push(0, 0, 0);
    }
    return base;
  };
  const rows = [];
  // trunk (grove only): a plain cylinder up into the crown
  if (S.trunk > 0) {
    // bark: a flared foot, a waist, then up into the crown; kind 1 = bark colour in the shader (the trunk was crown-green)
    const tr = S.trunk * k, ys = [-0.02 / Href, cb * 0.12, cb * 0.5, cb + 0.03], rs = [tr * 1.55, tr * 1.2, tr * 0.95, tr * 0.8];
    const tb = ys.map((y, i) => ring(y, rs[i], 0, false));
    for (let i = 0; i < tb.length - 1; i++) for (let s = 0; s < SIDES; s++) idx.push(tb[i] + s, tb[i] + s + 1, tb[i + 1] + s + 1, tb[i] + s, tb[i + 1] + s + 1, tb[i + 1] + s);
  }
  // (the wall's foot starts 2 cm into the ground; object y 1 = Href metres)
  for (const t of ts) rows.push(ring(t === 0 && cb <= 0 ? -0.02 / Href : cb + t * (1 - cb), t < 1 ? prof(t) : 0, t, true));
  for (let i = 0; i < rows.length - 1; i++) for (let s = 0; s < SIDES; s++) {
    const a = rows[i] + s, b = rows[i] + s + 1, c = rows[i + 1] + s + 1, d = rows[i + 1] + s;
    idx.push(a, b, c, a, c, d);
  }
  // the crown's underside (grove: it floats on the trunk): a fan to the axis
  if (cb > 0) { const ctr = pos.length / 3; pos.push(0, cb - 0.004, 0); hgt.push(cb); nor.push(0, -1, 0); for (let s = 0; s < SIDES; s++) idx.push(ctr, rows[0] + s + 1, rows[0] + s); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // soft column: blend the lobed normal with the smooth profile's own normal (cos a, -dr/dy, sin a)
  const n = g.attributes.normal.array, p = g.attributes.position.array, v = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < n.length; i += 3) {
    const y = p[i + 1], rr = Math.hypot(p[i], p[i + 2]);
    if (rr < 1e-6 || y < cb) continue;   // the axis point and the trunk keep their own normals
    const t = (y - cb) / (1 - cb), e = 0.01;
    const dr = (prof(Math.min(1, t + e)) - prof(Math.max(0, t - e))) / (2 * e * (1 - cb));
    d.set(p[i] / rr, -dr, p[i + 2] / rr).normalize();
    v.fromArray(n, i).lerp(d, NORMAL_SOFT).normalize().toArray(n, i);
  }
  g.setAttribute("hgt", new THREE.Float32BufferAttribute(hgt, 1));
  g.setAttribute("kind", new THREE.Float32BufferAttribute(kind.concat(Array(pos.length / 3 - kind.length).fill(0)), 1));
  g.computeBoundingSphere();
  g.userData = { H: 1, Href, Rm: S.Rm * k, cb, tris: idx.length / 3 };
  return g;
}

export function cypressMaterial(THREE, S, cols) {
  const v3 = (c) => new THREE.Vector3(c.r, c.g, c.b);
  const m = new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uColBot: { value: v3(cols.bottom) }, uColTop: { value: v3(cols.top) }, uColTip: { value: v3(cols.tip) },
      uTreeGain: { value: 1.0 },       // PICKED start; tools/verify_built_trees.mjs reports the frame colour vs measured
      uTuftScale: { value: 1.3 },      // PICKED: tufts per metre
      uTuftBump: { value: 0.55 },      // PICKED: how much the tufts tilt the shading normal
      uCrevice: { value: 0.55 },       // PICKED: albedo in the deepest crevices
      uTipMix: { value: 0.45 },        // PICKED: lit tuft tips toward the measured p90 colour
      uBarkCol: { value: new THREE.Vector3(...[78, 62, 46].map((v) => S.srgb([v, v, v]).r)) },   // PICKED: grey-brown bark (sRGB 78/62/46 -> linear)
      uErode: { value: 0.5 },          // PICKED: how far in from the silhouette the leaf edge breaks up (share of the view angle)
    }),
    vertexShader: /* glsl */`
      attribute float hgt; attribute float kind;
      varying vec3 vW; varying vec3 vN; varying vec3 vT; varying float vH; varying vec3 vTint; varying float vKind;
      ${S.NOISE_GLSL}
      ${S.WIND_GLSL}
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vW = builtWorldPos(position, vec2(0.0), 0.0, im);
        vec3 s2 = vec3(dot(im[0].xyz, im[0].xyz), dot(im[1].xyz, im[1].xyz), dot(im[2].xyz, im[2].xyz));
        vN = normalize(mat3(modelMatrix) * (mat3(im) * (normal / s2)));   // inverse-transpose of rotation x scale
        vT = position * sqrt(s2) / ${M.toFixed(1)} + im[3].xyz * 0.0137;   // metres, object frame; offset per tree
        vH = hgt; vKind = kind;
        vTint = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColBot, uColTop, uColTip, uBarkCol; uniform float uTreeGain, uTuftScale, uTuftBump, uCrevice, uTipMix, uErode;
      varying vec3 vW; varying vec3 vN; varying vec3 vT; varying float vH; varying vec3 vTint; varying float vKind;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        if (vKind > 0.5) {   // bark: grey-brown with vertical furrows, lit like the crown
          float fur = 0.75 + 0.35 * step(0.5, fract(atan(vT.z, vT.x) * 2.2 + vT.y * 0.35));
          gl_FragColor = vec4(aerial(toonLight(uBarkCol * fur * vTint, N, V, vW, 1.0, 0.0), vW), 1.0);
          #include <colorspace_fragment>
          return;
        }
        // leafy broken edge: toward the silhouette (view angle) whole cells of the crown drop out, so the outline is
        // ragged foliage and not a smooth lathe (USER: smooth green sticks)
        float rim = 1.0 - abs(dot(N, V));
        vec3 cell = floor(vT * 7.0 + vec3(3.0));
        float hs = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        if (rim > 1.0 - uErode && hs < (rim - (1.0 - uErode)) / uErode * 0.9) discard;
        // tufts: vertical flames of foliage (stretched noise), the second octave breaks them up
        vec3 q = vT * uTuftScale;
        float n1 = noise3(q * vec3(1.0, 0.45, 1.0)), n2 = noise3(q * 2.3 + vec3(11.0, 5.0, 3.0));
        float tuft = n1 * 0.65 + n2 * 0.35;
        vec3 side = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4);
        N = normalize(N + uTuftBump * ((tuft - 0.5) * vec3(0.0, 1.6, 0.0) + (n2 - 0.5) * side));
        vec3 alb = mix(uColBot, uColTop, smoothstep(0.05, 0.95, vH)) * vTint * uTreeGain;
        alb *= mix(uCrevice, 1.0, smoothstep(0.25, 0.65, tuft));
        vec3 col = toonLight(alb, N, V, vW, 1.0, 0.25);
        float litK = smoothstep(0.0, 0.35, dot(N, uLightDir)) * smoothstep(0.58, 0.78, tuft);
        col = mix(col, uColTip * vTint * uLightColor, uTipMix * litK);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  return m;
}

// fluffy shrub: four clumps stacked into a rounded mound, height ~1 at scale 1, half-width ~0.32 (SHRUB.radiusK)
// (two wide clumps at the foot: the measured mass is densest at the ground, 0.97 at 0 m)
const SHRUB_CLUMPS = [{ c: [-0.17, 0.2, 0.02], R: 0.27 }, { c: [0.17, 0.2, -0.02], R: 0.27 }, { c: [0.0, 0.33, 0.0], R: 0.3 },
                      { c: [-0.38, 0.1, 0.03], R: 0.2 }, { c: [0.38, 0.1, -0.03], R: 0.2 },
                      { c: [-0.12, 0.55, 0.06], R: 0.25 }, { c: [0.11, 0.6, -0.06], R: 0.23 }, { c: [0.0, 0.8, 0.0], R: 0.18 }];
const SHRUB_CARDS = 64;
// shrub core: an opaque dark half-ellipsoid inside each shrub (the leaf cards alone leave the foot see-through;
// measured floor_00/02 share at 0..0.5 m is 0.96-0.97). Radius and height in shrub heights, fitted by the checker.
const CORE = { R: 0.3, H: 0.42 };
export function coreGeometry(THREE) {
  const SIDES = 10, ROWS = 5, pos = [], hgt = [], idx = [];
  for (let j = 0; j <= ROWS; j++) {
    const u = j / ROWS, y = j === 0 ? -0.006 : CORE.H * Math.sin(u * Math.PI / 2), r = CORE.R * Math.cos(u * Math.PI / 2);
    for (let s = 0; s <= SIDES; s++) { const a = (s % SIDES) / SIDES * Math.PI * 2; pos.push(Math.sin(a) * r, y, Math.cos(a) * r); hgt.push(0); }
  }
  for (let j = 0; j < ROWS; j++) for (let s = 0; s < SIDES; s++) {
    const a = j * (SIDES + 1) + s, b = a + 1, c = a + SIDES + 2, d = a + SIDES + 1;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("hgt", new THREE.Float32BufferAttribute(hgt, 1));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  g.userData = { H: 1, tris: idx.length / 3 };
  return g;
}

// ================ the far pines (wall_00): REAL 3D pine trees, one row round the ring ================
// The user rejected the painted ribbon ("cardboard") and wants actual pines: ONE row of distinct, saturated green
// pines, opaque, crisp, each a cone of its own, touching its neighbours, on the recipe's own radius (27.78 m).
// METHOD (research: ~/dw3-knowledge/research/r5-meft1008/pines-online.md; nothing downloaded, no licence to carry):
//  - procedural conifer in code, after ez-tree (dgreenheck, MIT: tapered trunk + recursive whorled branches) and the
//    three.js forum's cheap pine recipe (Phil Crowther in discourse t/88610: a trunk with stacked, cone-shaped rings of
//    drooping branches, bigger rings low). Not a copy of any code.
//  - per tree: tapered 6-sided trunk (leaning a little), 11-14 whorls from 16 % of the height to the tip, 8 limbs per
//    low whorl down to 5 at the top, each limb a drooping three-ring spine (flat diamond section, tip curling up) =
//    20 triangles of real 3D, a leader spike on top. Four variants (seeded: whorl count, limb jitter, lean).
//  - the NEEDLES are the fragment: a pinnate (herringbone) comb along every limb - the sawtooth discards the limb's
//    edge into needle points, the same sawtooth shades each needle row dark at its root to lit at its tip. Opaque,
//    no sorting, no blending.
//  - colours: the arena's own measured picture rows of wall_00 (recipe `rows`, top first: [57,81,46] lit tips,
//    [28,45,25] mid, [23,40,20] darkest). Lit by hand (no toonLight, no aerial(), NO grey haze: user verdict).
//  - InstancedMesh per variant (4 draws for the whole ring), per-instance yaw / height / width / colour.
// TOP HEIGHTS follow MEASURE.md 2c (silhouette min 4.70 / p10 5.02 / median 6.08 / p90 6.89 / max 7.32 m): the same
// group noise as the old band picks each tree's height, clamped to LO..HI.
export const PINE = {
  RM: 0.36,            // PICKED: widest whorl's reach / tree height (the cone is 0.68 H wide at the foot)
  TAPER: 0.75,         // PICKED: reach ~ (1 - height)^TAPER: < 1 = a full cone (spruce-like), so neighbours overlap low down
  WHORLS: [11, 14],    // PICKED: whorls per tree (inclusive range, per variant)
  LIMBS: [7, 4],       // PICKED: limbs per whorl, lowest -> highest
  T0: 0.16, T1: 0.95,  // PICKED: lowest / highest whorl (share of the height); below T0 the trunk shows
  VARIANTS: 4,
  SPACING_K: 1.15,     // PICKED: centre-to-centre spacing in crown radii (< 2 = the cones touch and overlap)
  NEEDLES: 9,          // PICKED: needle rows per limb
  TOOTH: 0.55,         // PICKED: share of the limb's width that is never cut (the rest is the needle points)
  RADIAL: 0.3,         // PICKED: m, a tree stands this far off the ring radius at most (not a rigid circle)
};
export const FAR = {
  LO: 4.70, HI: 7.32, MED: 6.08,   // MEASURED silhouette min / max / median (m)
  P10: 5.02, P90: 6.89,            // MEASURED silhouette p10 / p90 (m)
  CENTRE: 6.05, GROUP: 3.4, WOBBLE: 0.7, JITTER: 0.9,   // FITTED: tree top = CENTRE + group noise + wobble + jitter, clamped
};

/** One pine, height 1 (y 0..1), crown radius PINE.RM, base at the origin. kind 0 = needle limb, 1 = bark. */
export function pineGeometry(THREE, seed) {
  const Rn = rng(seed);
  const pos = [], aUV = [], aH = [], aK = [], idx = [];
  const V = (p, u, v, h, k) => { pos.push(p[0], p[1], p[2]); aUV.push(u, v); aH.push(h); aK.push(k); return pos.length / 3 - 1; };
  const lean = [(Rn() - 0.5) * 0.03, (Rn() - 0.5) * 0.03];
  const ctr = (y) => [lean[0] * y * y, lean[1] * y * y];
  // trunk: 5 rings x 6 sides, tapered, flared at the foot, leaning a little
  { const ys = [0, 0.1, 0.35, 0.65, 0.97], SIDES = 6, base = [];
    for (const [i, y] of ys.entries()) {
      const c = ctr(Math.max(y, 0)), r = (0.021 * (1 - y) + 0.004) * (i === 0 ? 1.4 : 1);
      const b = pos.length / 3;
      for (let s = 0; s <= SIDES; s++) { const a = (s % SIDES) / SIDES * Math.PI * 2; V([c[0] + Math.sin(a) * r, y, c[1] + Math.cos(a) * r], 0, 0, y, 1); }
      base.push(b);
    }
    for (let i = 0; i < base.length - 1; i++) for (let s = 0; s < SIDES; s++) idx.push(base[i] + s, base[i] + s + 1, base[i + 1] + s + 1, base[i] + s, base[i + 1] + s + 1, base[i + 1] + s);
  }
  const add = (a, b, c) => [a[0] + b[0] * c, a[1] + b[1] * c, a[2] + b[2] * c];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // a flat-diamond ring: corners +side, +up, -side, -up. v = across (1 at the side corners, 0 on the ridge / keel)
  const ring = (c, s, u, w, th, uu, h) => [
    V(add(c, s, w), uu, 1, h, 0), V(add(c, u, th), uu, 0, h, 0), V(add(c, s, -w), uu, -1, h, 0), V(add(c, u, -th), uu, 0, h, 0)];
  const join = (A, B) => { for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; idx.push(A[i], A[j], B[j], A[i], B[j], B[i]); } };
  const cap = (A, tip) => { for (let i = 0; i < 4; i++) idx.push(A[i], A[(i + 1) % 4], tip); };
  const limb = (t, az, reach, k) => {
    const o = [Math.sin(az), 0, Math.cos(az)], L = reach / 0.8;
    const c0 = ctr(t), P0 = [c0[0] + o[0] * 0.004, t, c0[1] + o[2] * 0.004];
    const e0 = -0.12 + 0.57 * k + (Rn() - 0.5) * 0.12, e1 = e0 - (0.30 - 0.15 * k) - Rn() * 0.1, e2 = e1 + 0.5;
    const dir = (e) => [Math.cos(e) * o[0], Math.sin(e), Math.cos(e) * o[2]];
    const P1 = add(P0, dir(e0), 0.5 * L), P2 = add(P1, dir(e1), 0.5 * L), A = add(P2, dir(e2), 0.22 * L);
    P2[1] = Math.max(P2[1], 0.02); A[1] = Math.max(A[1], 0.012);   // no needle under the ground
    const w = 0.21 * L, th = 0.3 * w;
    const side = norm(cross([0, 1, 0], o)), frame = (d) => { const s = norm(cross(d, [0, 1, 0]).every((x) => Math.abs(x) < 1e-6) ? side : cross([0, 1, 0], d)); return [s, norm(cross(d, s))]; };
    const d0 = norm([P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]]), d1 = norm([P2[0] - P0[0], P2[1] - P0[1], P2[2] - P0[2]]), d2 = norm([A[0] - P1[0], A[1] - P1[1], A[2] - P1[2]]);
    const [s0, u0] = frame(d0), [s1, u1] = frame(d1), [s2, u2] = frame(d2);
    const r0 = ring(P0, s0, u0, 0.35 * w, 0.35 * th, 0.0, t), r1 = ring(P1, s1, u1, w, th, 0.42, t), r2 = ring(P2, s2, u2, 0.55 * w, 0.6 * th, 0.78, t);
    join(r0, r1); join(r1, r2);
    cap(r2, V(A, 1, 0, t, 0));
  };
  const nW = PINE.WHORLS[0] + Math.floor(Rn() * (PINE.WHORLS[1] - PINE.WHORLS[0] + 1));
  for (let i = 0; i < nW; i++) {
    const s = i / (nW - 1), t = PINE.T0 + (PINE.T1 - PINE.T0) * (1 - Math.pow(1 - s, 1.25));
    const k = (t - PINE.T0) / (0.99 - PINE.T0);                                   // 0 bottom .. 1 top
    const Rc = PINE.RM * Math.pow(Math.max(0, 1 - k), PINE.TAPER) + 0.014;
    const nL = Math.round(PINE.LIMBS[0] + (PINE.LIMBS[1] - PINE.LIMBS[0]) * k);
    const a0 = Rn() * Math.PI * 2;
    // the whorl's inner skirt (kind 2): a serrated 12-sided frustum under the limbs, so the layers read as one dense
    // pine and the tree is not see-through (the measured wall_00 has no see-through texel). Spikes alternate long / short.
    { const SK = 12, c = ctr(t), top = [], bot = [], drop = 0.075 + 0.05 * (1 - k);
      for (let q = 0; q < SK; q++) {
        const a = a0 + q / SK * Math.PI * 2, long = q % 2 === 0, rt = 0.14 * Rc, rb = Rc * (long ? 0.9 : 0.5) * (0.9 + Rn() * 0.2);
        top.push(V([c[0] + Math.sin(a) * rt, t + 0.012, c[1] + Math.cos(a) * rt], 0, 0, t, 2));
        bot.push(V([c[0] + Math.sin(a) * rb, Math.max(t - drop * (long ? 1 : 0.55), 0.012), c[1] + Math.cos(a) * rb], 1, 0, t, 2));
      }
      for (let q = 0; q < SK; q++) { const r = (q + 1) % SK; idx.push(top[q], top[r], bot[r], top[q], bot[r], bot[q]); } }
    for (let j = 0; j < nL; j++) limb(t, a0 + (j + (Rn() - 0.5) * 0.35) / nL * Math.PI * 2, Rc * (0.88 + Rn() * 0.24), k);
  }
  // leader: a vertical spike to exactly y = 1 (the tree's measured top)
  { const c = ctr(0.9), B = ring([c[0], 0.9, c[1]], [1, 0, 0], [0, 0, 1], 0.016, 0.016, 0.0, 0.93);
    cap(B, V([ctr(1)[0], 1.0, ctr(1)[1]], 1, 0, 0.99, 0)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aUV", new THREE.Float32BufferAttribute(aUV, 2));
  g.setAttribute("aH", new THREE.Float32BufferAttribute(aH, 1));
  g.setAttribute("aK", new THREE.Float32BufferAttribute(aK, 1));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  g.userData = { H: 1, Rm: PINE.RM, tris: idx.length / 3, whorls: nW };
  return g;
}

export function pineMaterial(THREE, S, greens) {
  const v3 = (c) => { const q = S.srgb(c); return new THREE.Vector3(q.r, q.g, q.b); };
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uPineLo: { value: v3(greens.lo) }, uPineMid: { value: v3(greens.mid) }, uPineHi: { value: v3(greens.hi) },
      uBark: { value: v3([70, 52, 36]) }, uNeedleN: { value: PINE.NEEDLES }, uTooth: { value: PINE.TOOTH },
    }),
    vertexShader: /* glsl */`
      attribute vec2 aUV; attribute float aH; attribute float aK;
      varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vUV; varying float vH; varying float vK;
      ${S.NOISE_GLSL}
      ${S.WIND_GLSL}
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vW = builtWorldPos(position, vec2(0.0), 0.0, im);
        vec3 s2 = vec3(dot(im[0].xyz, im[0].xyz), dot(im[1].xyz, im[1].xyz), dot(im[2].xyz, im[2].xyz));
        vN = normalize(mat3(modelMatrix) * (mat3(im) * (normal / s2)));
        vUV = aUV; vH = aH; vK = aK;
        vTint = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uPineLo, uPineMid, uPineHi, uBark; uniform float uNeedleN, uTooth;
      varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vUV; varying float vH; varying float vK;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        if (dot(N, V) < 0.0) N = -N;                   // both faces lit the same (thin limbs)
        vec3 col; float inner = 1.0;
        if (vK > 1.5) {                                  // inner skirt: dark needle mass under the limbs
          float sk = fract(vUV.x * 3.0 + vW.y * 0.05);
          col = mix(uPineLo, uPineMid, 0.35 + 0.5 * vUV.x) * (0.8 + 0.3 * sk); inner = 0.9;
        } else if (vK > 0.5) {
          col = uBark * (0.72 + 0.4 * step(0.5, fract(vW.y * 0.021 + vW.x * 0.013 + vW.z * 0.011)));
        } else {
          float u = vUV.x, v = abs(vUV.y);
          float saw = fract(u * uNeedleN - v * 1.15);   // pinnate comb: needle rows leaning toward the limb's tip
          if (v > uTooth + (1.0 - uTooth) * saw) discard;
          float x = clamp(0.06 + 0.5 * u + 0.38 * saw + 0.22 * vH, 0.0, 1.0);
          col = x < 0.5 ? mix(uPineLo, uPineMid, x * 2.0) : mix(uPineMid, uPineHi, (x - 0.5) * 2.0);
          inner = mix(0.70, 1.0, smoothstep(0.0, 0.45, u));   // dark toward the trunk
        }
        float day = clamp(dot(uLightColor, vec3(0.3333)), 0.15, 1.0);
        float lit = 0.74 + 0.46 * smoothstep(-0.35, 0.85, dot(N, uLightDir));
        col *= lit * inner * vTint * day;
        gl_FragColor = vec4(col, 1.0);                   // opaque, no haze pass: saturated green, crisp against the sky
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

/** The shrub of the grove (fluffytree clumps), height 1, foot 0.01 under y 0: { geo, mat }. c = { bottom, top } linear colours.
 *  Lifted out of addTrees so the asset registry (web/built/registry.js) can make the same shrub with no placement. */
export function shrubSpecies(THREE, S, c) {
    const clumps = SHRUB_CLUMPS.map((q) => ({ c: [...q.c], R: q.R }));
    const part = fluffyPart(clumps, SHRUB_CARDS, 7, c.bottom);
    // the cards round the low clumps reach under the floor: lift the shrub so its lowest vertex is 0.01 below y 0
    // and scale it to height 1 (the instance scale is then the shrub height in metres x 400)
    let lo = Infinity, hi = -Infinity; for (let i = 1; i < part.pos.length; i += 3) { lo = Math.min(lo, part.pos[i]); hi = Math.max(hi, part.pos[i]); }
    const k = 1 / (hi - lo), sh = (x, i) => (i % 3 === 1 ? (x - lo) * k - 0.01 : x * k);
    part.pos = part.pos.map(sh);
    part.clump = part.clump.map((x, i) => (i % 4 === 1 ? (x - lo) * k - 0.01 : x * k));
    for (const q of clumps) { q.c = q.c.map((x, i) => (i === 1 ? (x - lo) * k - 0.01 : x * k)); q.R *= k; }
    const geo = buildGeometry([part]);
    const C = [0, 0, 0]; for (const q of clumps) for (let a = 0; a < 3; a++) C[a] += q.c[a] / clumps.length;
    geo.userData = { crown: C, H: 1, tris: geo.index.count / 3 };
    const hiTint = ["r", "g", "b"].map((k) => c.top[k] / Math.max(c.bottom[k], 1e-4));
  return { geo, mat: foliageMaterial(leafClumpTexture(), C, hiTint) };
}

/** the cypress colours of a slot: its measured piece colours (sRGB) -> linear */
export function cypressCols(S, colours) {
  const lin = (c) => S.srgb(c);
  return { bottom: lin(colours.bottom || colours.all), top: lin(colours.top || colours.all), tip: lin(colours.p90 || colours.all), mid: lin(colours.green || colours.all) };
}
/** the asset parts of the ring's slots (registry mod.cypress_wall / mod.cypress_grove / mod.shrub / mod.far_pines) */
export function cypressAsset(THREE, S, which, colours) {
  const sh = which === "wall" ? WALL : GROVE, Href = sh.H0 + sh.HR / 2;
  return { geo: cypressGeometry(THREE, sh, Href, which === "wall" ? 31 : 47), mat: cypressMaterial(THREE, S, cypressCols(S, colours)) };
}
export function shrubAsset(THREE, S, colours) {
  const c = cypressCols(S, colours);
  const shrub = shrubSpecies(THREE, S, c);
  const core = { geo: coreGeometry(THREE), mat: cypressMaterial(THREE, S, cypressCols(S, colours)) };
  core.mat.uniforms.uErode.value = 0;   // the shrub's solid foot keeps its smooth edge
  return [shrub, core];
}
export function farPinesAsset(THREE, S, greens) {
  const geos = Array.from({ length: PINE.VARIANTS }, (_, v) => pineGeometry(THREE, 9000 + v * 17));
  const mat = pineMaterial(THREE, S, greens);
  return { geos, mat };
}
