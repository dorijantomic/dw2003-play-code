// GROUND of the BUILT arena look (Arena Viewer look=built only): the baked arena mask, the painted ground,
// the bank strips, boulders, cliffs and the distant hill ribbons. Plan Step 3,
// ~/dw3-knowledge/research/PLAN-built-arena.md; the measured numbers at the top of that file are authoritative
// (render units, 400 units ~ 1 m, floor y 0, ground out to ~6741, fighters 1970-2360 from the centre).
//   arenaMask  ONE texture baked at build over the ground's own footprint (+-MASK_EXTENT units): R dirt, G rock,
//              B path, A ambient occlusion, each a smooth 0..1 amount. The dirt/rock/path fields are made from the
//              shared seeded noise (shared.js noise3JS/fbm3JS, so they are the same numbers the GLSL sees) plus the
//              arena's measured layout; the AO is baked from a height raster of the ground's own triangles. Read by
//              the ground, by the boulders (moss) and by the bank; grass, water and later steps read the same
//              texture through GROUND_GLSL + mask.sample() (the JS twin), never a second copy.
//   painted    the ground albedo is 3 HARD colour steps - grass / dirt / path - not a smooth blend: each step is
//              smoothstep(0.5-w, 0.5+w, mask) with w = fwidth(mask) * STEP_W, so the edge is ~1 pixel wide at any
//              distance and never crawls. The grass step keeps the pattern grass.js already uses (uA/uB/uScale =
//              its GROUND_SCALE), so blades and ground still agree.
//   cliffs     rock from the mask AND from a slope threshold on the ground's own face normals (1 - N.y), with a
//              second, harder band above it: no cliff geometry, only paint - the recipe's outer ground really does
//              rise (mean slope 13-17 deg at r 5000-6500, up to 37 deg), so the band lands where a cliff is.
//   boulders   ConvexGeometry hulls (three.js addon, MIT, vendored at web/lib3d/addons/ConvexGeometry.js +
//              ConvexHull.js), 20 points on a jittered sphere = 36 triangles, one geometry, ONE InstancedMesh,
//              half buried (each boulder's origin, its widest ring, sits on the ground; the lower half is under it).
//              Moss on the up-facing faces; the mask's dirt amount thins it.
//   hills      3 painted silhouette rings past the ground's own edge (r 7250 / 8150 / 9050), two hard colour bands
//              each (a contour that follows the ridge), a per-ribbon painted aerial wash and then the shared
//              aerial(). Only the far arc is ever inside the frustum (the near arc is behind the battle camera).
//   KEEP-OUT   no boulder anywhere near the fight: every candidate's bounding sphere must clear
//              max(furthest fighter + 1000, MIN_R) of the centre and every view cone (shared.js inViewCone) from
//              every eye ring seen so far, swept round the full circle in 3 deg steps because the idle camera
//              spins. A rejected candidate is pushed straight outward (up to 1.2 of its size) then dropped. The
//              checks re-test every final vertex, not the spheres.
//
// VALUES PICKED (not measured), all in render units unless said:
//   MASK_RES 512 over +-MASK_EXTENT 7200 (texel 28.1 units, ~7 cm: the mask is a broad shape, the hard edge comes
//     from the shader's fwidth step, not from texels), DIRT noise 1700, clearing radius 2300-3150 (+-650 wander),
//     bare-earth ramp 3800-5800, ROCK noise 1150 with base 0.30 and +-0.55, rock ramp 4300-6000, PATH ring
//     r 3400 with a 460-wide band (+-350 wander), CLIFF thresholds slope 0.0865 / 0.152 (= 24 deg / 32 deg),
//     STEP_W 0.75 px, AO 0.34 at heights 150-1600, MOSS threshold N.y 0.55, boulders: 20 hull points, 34
//     candidates (bank stride 900, 5 big) + 24 scattered at r 3650-6450, width 220-620 (big 620-1000),
//     height 0.62 of the width, MIN_R 3600 (the fight radius when no fighter has been seen yet), MARGIN 150,
//     SINK 0.02 (each boulder is lowered by it so a float32 instance matrix can never read back a base vertex
//     above the surface),
//     hills: radii 7250/8150/9050, ridge heights 2300/2900/3550 * 0.55-1.15, 96 segments, base y -2600,
//     contour at 0.46 of the ridge, painted haze 0.12/0.30/0.50, hill colours = grass p10 -> haze mixes.
import * as THREE from "../lib3d/three.module.js";
import { ConvexGeometry } from "../lib3d/addons/ConvexGeometry.js";
import * as S from "./shared.js";
import { GROUND_SCALE } from "./grass.js";
import { SOIL, soilMaterial, apronGeometry } from "./soil.js";

export const GROUND = {
  MASK_RES: 512, MASK_EXTENT: 7200,
  DIRT_SCALE: 1700, DIRT_CLEAR: [2300, 3150], DIRT_FAR: [3800, 5800],
  ROCK_SCALE: 1150, ROCK_BASE: 0.30, ROCK_NOISE: 0.55, ROCK_FAR: [4300, 6000],
  PATH_R: 3400, PATH_W: 460,
  CLIFF_LO: 0.0865, CLIFF_HI: 0.152,     // 1 - N.y at 24 deg / 32 deg
  STEP_W: 0.75, AO_AMT: 1.0, AO_H: [150, 1600], AO_RIM: 0.34, MOSS_LO: 0.55,
  ROCKS: { HULL_PTS: 20, SEED: 4242, BANK_STRIDE: 900, BANK_OUT: 330, SCATTER: 24, BIG: 5,
           S: [220, 620], BIG_S: [620, 1000], FLAT: 0.62, MIN_R: 3600, MARGIN: 150, MAX_R: 6450,
           PUSH: 0.12, PUSH_MAX: 1.2, SINK: 0.02 },
  HILLS: { R: [7250, 8150, 9050], H: [2300, 2900, 3550], SEG: 96, BASE: -2600, CONTOUR: 0.46,
           HAZE: [0.12, 0.30, 0.50], SEED: 77 },
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth01 = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const b8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));

// palette, mask bake and the boulder candidates are PLACEMENT (web/built/place/ground.js), re-exported for older importers
export { groundPalette, bakeArenaMask, rockCandidates } from "./place/ground.js";
import { groundPalette } from "./place/ground.js";

// ---------------- GLSL (the ground, bank, rock and hill materials all take their look from here) ----------------
export const GROUND_GLSL = /* glsl */`
  uniform sampler2D uMask; uniform float uMaskSpan;
  uniform vec3 uA, uB, uDirt, uPath, uRockLo, uRockHi;
  uniform float uScale, uCliffLo, uCliffHi, uStepW, uAOAmt;

  vec4 groundMaskAt(vec2 xz) { return texture2D(uMask, xz / uMaskSpan + 0.5); }
  /** a HARD 0..1 step on a mask amount, anti-aliased over about uStepW pixels whatever the distance
   *  (w = fwidth * STEP_W: the screen-space width of the edge, never a blend between two colours). */
  float groundStep(float v) { float w = max(fwidth(v), 1e-4) * uStepW; return smoothstep(0.5 - w, 0.5 + w, v); }
  /** the painted albedo at a world point, BEFORE the baked AO, the light and the haze: grass / dirt / path / rock.
   *  The checks sample this same function, so the palette entries are what the material really paints. */
  vec3 groundPaint(vec3 wpos, vec3 N) {
    vec4 m = groundMaskAt(wpos.xz);
    float n = fbm3(wpos * uScale);                       // the ground's own pattern (the one grass.js bakes against)
    vec3 c = mix(uA, uB, smoothstep(0.35, 0.65, n));
    c = mix(c, uDirt, groundStep(m.r));
    c = mix(c, uPath, groundStep(m.b));
    float slope = 1.0 - N.y;                             // 0 flat .. 1 vertical; the ground's normals are per face
    float wc = max(fwidth(slope), 1e-4) * uStepW;
    float cliff = smoothstep(uCliffLo - wc, uCliffLo + wc, slope);
    float high = smoothstep(uCliffHi - wc, uCliffHi + wc, slope);
    c = mix(c, mix(uRockLo, uRockHi, high), max(groundStep(m.g), cliff));
    return c;
  }
  float groundAO(vec2 xz) { return texture2D(uMask, xz / uMaskSpan + 0.5).a; }
`;

// one shared vertex shader for the flat pieces (ground, bank): world position + normal
const FLAT_VS = /* glsl */`
  varying vec3 vW; varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

function groundMaterial({ a, b, mask, gp }) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uMask: { value: mask.texture }, uMaskSpan: { value: mask.span },
      uA: { value: a }, uB: { value: b }, uScale: { value: GROUND_SCALE },     // grass.js's pattern, unchanged
      uDirt: { value: gp.dirt }, uPath: { value: gp.path }, uRockLo: { value: gp.rockLo }, uRockHi: { value: gp.rockHi },
      uCliffLo: { value: GROUND.CLIFF_LO }, uCliffHi: { value: GROUND.CLIFF_HI }, uStepW: { value: GROUND.STEP_W },
      uAOAmt: { value: GROUND.AO_AMT },
    }),
    vertexShader: FLAT_VS,
    fragmentShader: /* glsl */`
      varying vec3 vW; varying vec3 vN;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${GROUND_GLSL}
      void main() {
        vec3 N = normalize(gl_FrontFacing ? vN : -vN);
        vec3 base = groundPaint(vW, N) * mix(1.0, groundAO(vW.xz), uAOAmt);
        vec3 col = toonLight(base, N, normalize(cameraPosition - vW), vW, 1.0, 0.0);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

// the bank strips: the recipe's own wall triangles, one mesh, a gradient bottom -> top per piece (per vertex)
function bankMaterial({ mask, gp }) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ uMask: { value: mask.texture }, uMaskSpan: { value: mask.span }, uBankScale: { value: 0.003 } }),
    vertexShader: /* glsl */`
      attribute vec3 aBottom, aTop; attribute vec2 aY;
      varying vec3 vW; varying vec3 vN; varying vec3 vBot, vTop; varying vec2 vY;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vBot = aBottom; vTop = aTop; vY = aY;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uBankScale;
      varying vec3 vW; varying vec3 vN; varying vec3 vBot, vTop; varying vec2 vY;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        float n = fbm3(vW * uBankScale);
        vec3 base = mix(vBot, vTop, clamp((vW.y - vY.x) / max(vY.y - vY.x, 1e-3) + (n - 0.5) * 0.5, 0.0, 1.0));
        vec3 N = normalize(gl_FrontFacing ? vN : -vN);
        vec3 col = toonLight(base, N, normalize(cameraPosition - vW), vW, 1.0, 0.25);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

// boulders: rock tones + moss on the up-facing faces (hard band), the mask's dirt amount thins the moss
function rockMaterial({ mask, gp }) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uMask: { value: mask.texture }, uMaskSpan: { value: mask.span },
      uRockLo: { value: gp.rockLo }, uRockHi: { value: gp.rockHi }, uMoss: { value: gp.moss },
      uStepW: { value: GROUND.STEP_W }, uMossLo: { value: GROUND.MOSS_LO },
    }),
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN; varying vec3 vTint;
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vW = (modelMatrix * im * vec4(position, 1.0)).xyz;
        // inverse-transpose of the instance's (diagonal) scale, so a squashed boulder still lights right
        vec3 sc = vec3(1.0 / max(length(im[0].xyz), 1e-6), 1.0 / max(length(im[1].xyz), 1e-6), 1.0 / max(length(im[2].xyz), 1e-6));
        vN = normalize(mat3(modelMatrix) * (mat3(im) * (normal * sc)));
        vTint = vec3(1.0, 0.5, 1.0);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uMoss; uniform float uMossLo;
      varying vec3 vW; varying vec3 vN; varying vec3 vTint;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${GROUND_GLSL}
      void main() {
        vec3 N = normalize(gl_FrontFacing ? vN : -vN);
        float w = max(fwidth(N.y), 1e-4) * uStepW;
        float up = smoothstep(uMossLo - w, uMossLo + w, N.y);                 // hard band: flat tops get moss
        float bare = smoothstep(0.35, 0.7, groundMaskAt(vW.xz).r);            // dirt ground: less moss
        vec3 base = mix(uRockLo, uRockHi, clamp(vTint.g, 0.0, 1.0)) * clamp(vTint.r, 0.6, 1.4);
        base = mix(base, uMoss * clamp(vTint.r, 0.6, 1.4), up * (1.0 - 0.55 * bare));
        vec3 col = toonLight(base, N, normalize(cameraPosition - vW), vW, 1.0, 0.15);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

// distant hills: unlit painted ribbons, two hard colour bands, a painted haze per ribbon, then the shared aerial()
function hillMaterial({ mask, gp }) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uMask: { value: mask.texture }, uMaskSpan: { value: mask.span }, uHillShade: { value: 0.84 },
      uStepW: { value: GROUND.STEP_W }, uHillHaze: { value: gp.haze },
    }),
    vertexShader: /* glsl */`
      attribute vec3 aCol; attribute float aBand, aHaze;
      varying vec3 vW; varying vec3 vCol; varying float vBand, vHaze;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vCol = aCol; vBand = aBand; vHaze = aHaze;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHillHaze; uniform float uHillShade, uStepW;
      varying vec3 vW; varying vec3 vCol; varying float vBand, vHaze;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        float w = max(fwidth(vBand), 1e-4) * uStepW;
        float hi = smoothstep(0.5 - w, 0.5 + w, vBand);          // the contour that follows the ridge
        vec3 c = vCol * mix(uHillShade, 1.0, hi);
        c = mix(c, uHillHaze, vHaze);                            // painted aerial wash for this ribbon
        c *= uUnlitK;                                            // sun/moon light level (shared.js setBuiltLight; 1 by day)
        gl_FragColor = vec4(aerial(c, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

// ---------------- geometry ----------------
/** Boulder hull: 20 points on a jittered sphere -> ConvexGeometry -> exactly 36 triangles (Euler: F = 2V - 4).
 *  Normalised to width 1, height 0.78 of the width, centred on its own bounding box (its widest ring at y = 0). */
function boulderHull(seed) {
  const r = rng(seed), n = GROUND.ROCKS.HULL_PTS, pts = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) * 2 / n, rad = Math.sqrt(Math.max(0, 1 - y * y)), th = i * ga + (r() - 0.5) * 0.25;
    const rr = 0.80 + r() * 0.20;
    pts.push(new THREE.Vector3(Math.cos(th) * rad * rr, y * rr, Math.sin(th) * rad * rr));
  }
  const g = new ConvexGeometry(pts);
  g.computeBoundingBox();
  const bb = g.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2,
        cy = (bb.min.y + bb.max.y) / 2, w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
  const P = g.attributes.position.array;
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (P[i] - cx) / w; P[i + 1] = (P[i + 1] - cy) / w * 0.78; P[i + 2] = (P[i + 2] - cz) / w;
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();   // flat face normals after the squash
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData = { tris: P.length / 9, width: 1, height: 0.78 };
  return g;
}

/** 3 silhouette rings past the ground's edge: base row, contour row, ridge row; 4 triangles per segment. */
function hillsGeometry(pal) {
  const P = GROUND.HILLS, parts = [];
  const cols = [
    pal.grassLo.clone().lerp(pal.haze, 0.30),
    pal.grassLo.clone().lerp(pal.haze, 0.55),
    pal.haze.clone().lerp(pal.skyHorizon, 0.45),
  ];
  for (let i = 0; i < P.R.length; i++) {
    const R = P.R[i], H = P.H[i], SEG = P.SEG, col = cols[i];
    const pos = [], band = [], haze = [], colsA = [];
    const rows = [];   // per segment boundary: 3 vertices (base, contour, ridge) as [x, y, z]
    for (let k = 0; k <= SEG; k++) {
      const a = (k % SEG) / SEG * Math.PI * 2;             // k = SEG wraps onto k = 0: the ring closes without a seam
      const c = Math.cos(a), s2 = Math.sin(a);
      const n1 = S.fbm3JS(c * 2.7 + i * 5.1, 1.3 + i, s2 * 2.7 + i * 3.7);
      const n2 = S.noise3JS(c * 6.2 + i, 7.1, s2 * 6.2);
      const top = P.BASE + Math.max(H * 0.45, H * (0.62 + 1.1 * (n1 - 0.5) + 0.36 * (n2 - 0.5)));
      const mid = P.BASE + (top - P.BASE) * P.CONTOUR;
      const x = s2 * R, z = c * R;
      rows.push([[x, P.BASE, z], [x, mid, z], [x, top, z]]);
    }
    for (let k = 0; k < SEG; k++) {
      const A = rows[k], B = rows[k + 1];
      for (const lo of [0, 1]) {                            // band 0: base->contour, band 1: contour->ridge
        const hi = lo + 1, quad = [A[lo], B[lo], B[hi], A[lo], B[hi], A[hi]];
        const bands = [lo * 0.5, lo * 0.5, hi * 0.5, lo * 0.5, hi * 0.5, hi * 0.5];   // 0 / 0.5 / 1: a hard contour
        for (let v = 0; v < 6; v++) {
          const q = quad[v];
          pos.push(q[0], q[1], q[2]); band.push(bands[v]); haze.push(P.HAZE[i]);
          colsA.push(col.r, col.g, col.b);
        }
      }
    }
    parts.push({ pos, band, haze, col: colsA });
  }
  return parts;
}

/** Merge the hill ribbons into one non-indexed geometry with its per-vertex attributes. */
function mergeHills(parts) {
  let n = 0; for (const p of parts) n += p.pos.length / 3;
  const pos = new Float32Array(n * 3), band = new Float32Array(n), haze = new Float32Array(n), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.pos, o * 3); band.set(p.band, o); haze.set(p.haze, o); col.set(p.col, o * 3);
    o += p.pos.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aBand", new THREE.BufferAttribute(band, 1));
  g.setAttribute("aHaze", new THREE.BufferAttribute(haze, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------- the ASSETS (data: web/built/place/ground.js) ----------------
/** The paint mask's texture: the placement's bytes, made once per mask (linear, clamped, no mipmaps). */
export function maskTexture(mask) {
  if (mask.texture) return mask.texture;
  const tex = new THREE.DataTexture(mask.data, mask.res, mask.res, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  Object.defineProperty(mask, "texture", { value: tex, enumerable: false, writable: true, configurable: true });
  return tex;
}
const withTex = (D) => { maskTexture(D.mask); return { mask: D.mask, gp: D.gp }; };

/** ASSET mod.ground: the arena's own ground triangles, painted (grass: the mask paint; soil: soil.js's floor + the
 *  apron under the tree ring). One mesh per piece, named as the piece. */
export function buildFloor(slot, { materials = [] } = {}) {
  const D = slot.data, { mask, gp } = withTex(D);
  const meshes = [];
  let soilInfo = null, soilMat = null;
  for (const p of D.pieces) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p.pos.slice(), 3));
    g.computeVertexNormals();
    const c = p.colours;
    let mat;
    if (p.kind === "soil") {
      // one soil paint tinted to the piece's OWN measured colours, no uMask so grass grows no blades on it
      soilInfo = soilInfo || {};
      const sm = soilMaterial(c, soilInfo);
      mat = sm.material; soilMat ||= mat;
    } else {
      mat = groundMaterial({ a: S.srgb(c.p10 || gp.src.grassLo), b: S.srgb(c.p90 || gp.src.grassHi), mask, gp });
    }
    materials?.push(mat);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = p.name; mesh.userData.kind = p.kind;
    meshes.push(mesh);
  }
  if (D.apron && soilMat) {
    const ag = apronGeometry(D.apron.outline);
    const apron = new THREE.Mesh(ag, soilMat);
    apron.name = "builtApron"; apron.userData.kind = "soil";
    meshes.push(apron);
    const L = D.apron.land;
    soilInfo.apron = { tris: ag.userData.tris, cellsKept: ag.userData.cellsKept, cellsOnFloor: ag.userData.cellsOnFloor,
                       cards: L.cards, in: SOIL.APRON.IN, out: SOIL.APRON.OUT };
    soilInfo.shore = { rim: L.rim, stepDeg: L.stepDeg, az0: L.az0, landEnd: L.landEnd, floorEnd: L.floorEnd, ms: L.ms,
                       how: "soil.js soilLand(rec): landAt/floorAt/apronRange/outline" };
  }
  return { objects: meshes, meshes, soilInfo, dispose() { for (const m of meshes) m.geometry.dispose(); } };
}

/** ASSET mod.bank: the recipe's bank strips merged into ONE mesh, a gradient bottom -> top per piece. */
export function buildBank(slot, { materials = [] } = {}) {
  const D = slot.data, { mask, gp } = withTex(D);
  const parts = D.bank.map((b) => {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(b.pos.slice(), 3));
    g.computeVertexNormals();
    const nor = g.attributes.normal.array, n = b.pos.length / 3;
    const aBottom = new Float32Array(n * 3), aTop = new Float32Array(n * 3), aY = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { aBottom.set(b.bottom, i * 3); aTop.set(b.top, i * 3); aY[i * 2] = b.y0; aY[i * 2 + 1] = b.y1; }
    g.dispose();
    return { pos: b.pos, nor, aBottom, aTop, aY };
  });
  let n = 0; for (const p of parts) n += p.pos.length;
  const pos = new Float32Array(n), nor = new Float32Array(n), aBottom = new Float32Array(n), aTop = new Float32Array(n), aY = new Float32Array(n / 3 * 2);
  let ov = 0;
  for (const p of parts) { pos.set(p.pos, ov); nor.set(p.nor, ov); aBottom.set(p.aBottom, ov); aTop.set(p.aTop, ov); aY.set(p.aY, ov / 3 * 2); ov += p.pos.length; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("aBottom", new THREE.BufferAttribute(aBottom, 3));
  g.setAttribute("aTop", new THREE.BufferAttribute(aTop, 3));
  g.setAttribute("aY", new THREE.BufferAttribute(aY, 2));
  g.computeBoundingSphere();
  const mat = bankMaterial({ mask, gp }); materials?.push(mat);
  const mesh = new THREE.Mesh(g, mat); mesh.name = "builtBank"; mesh.userData.kind = "bank";
  return { objects: [mesh], meshes: [mesh], dispose() { g.dispose(); } };
}

/** ASSET mod.hills: 3 painted silhouette ribbons past the ground's edge. */
export function buildHills(slot, { materials = [] } = {}) {
  const { mask, gp } = withTex(slot.data);
  const g = mergeHills(hillsGeometry(gp)), mat = hillMaterial({ mask, gp });
  materials?.push(mat);
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "builtHills"; mesh.userData.kind = "hills"; mesh.frustumCulled = false;
  return { objects: [mesh], meshes: [mesh], dispose() { g.dispose(); } };
}

/** ASSET mod.ground_rocks: one boulder hull (width 1) in the ground's rock + moss shader, instanced (instanceColor =
 *  tone, rock mix, 1). In another arena (no ground mask) the mask reads as clean ground. */
export function rockPart(env, slot) {
  const D = slot?.default === "mod.ground_rocks" ? slot.data : null;
  const mask = D ? maskTexture(D.mask) && D.mask : { texture: null, span: 2 * GROUND.MASK_EXTENT };
  const gp = D ? D.gp : groundPalette({ pieces: [] });
  const mat = rockMaterial({ mask, gp });
  env?.materials?.push(mat);
  return { geo: boulderHull(GROUND.ROCKS.SEED), mat };
}
