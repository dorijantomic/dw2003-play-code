// FOLIAGE ASSETS of the built arenas (assets only: geometry + material, no placement). Moved here from
// web/arena-built.js unchanged; WHERE these stand is web/built/place/foliage.js (the recipe's pine / tree / treeline
// cards and the bank's top edge) and web/built/place/trees.js (meft1008's shrubs reuse the fluffy bush).
// Broadleaf branches and leaf cards from ez-tree (github.com/dgreenheck/ez-tree, MIT, (c) Daniel Greenheck;
// web/lib3d/ez-tree.es.js + ez-tree.LICENSE), seeded. FLUFFY crowns and bushes after leoawen/fluffytree-threejs (MIT,
// web/lib3d/fluffytree/fluffy.js + LICENSE): the crown = a few clumps (k-means of ez-tree's own leaf spots), each
// filled with small randomly turned leaf-cluster cards; per-pixel normal from the clump centre (30 % crown centre),
// fluffytree's highlight ramp, all through the shared toonLight. Leaf alpha drawn on a canvas, alphaTest 0.4; wind
// bent in object space before the instance matrix (shared.js builtWind). Pines: cone stacks.
import * as THREE from "../lib3d/three.module.js";
import { Tree, TreePreset } from "../lib3d/ez-tree.es.js";
import * as S from "./shared.js";
import * as F from "../lib3d/fluffytree/fluffy.js";

function rng(seed) {   // small seeded random, so the same arena always builds the same
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------------- foliage ----------------
// Leaf-cluster alpha (no image file): fluffy.js draws a round core with pointed leaves round it, white on clear.
export function leafClumpTexture() {   // exported: web/built/trees.js (meft1008 shrubs) reuses it
  const t = new THREE.CanvasTexture(F.drawLeafCluster(document, 256, 5));
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 1;
  return t;
}

// Fluffy shading numbers. From fluffytree's index.html: highlightStart 0.5, highlightEnd 1.8 (its smoothstep on
// light . fromCentre). PICKED here: CROWN_MIX (share of the whole-crown direction), INNER_VIS (sunVis at a clump's
// core: 0.45 keeps the core in the shade band).
const CROWN_MIX = 0.3, INNER_VIS = 0.45, HI_LO = 0.5, HI_HI = 1.8;
export function foliageMaterial(leafTex, crown, hiTint) {
  const m = new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ uLeafTex: { value: leafTex }, uLeafAlpha: { value: 0.4 },
      uCrown: { value: new THREE.Vector3(...crown) }, uCrownMix: { value: CROWN_MIX }, uInnerVis: { value: INNER_VIS },
      uHiLo: { value: HI_LO }, uHiHi: { value: HI_HI }, uHiTint: { value: new THREE.Vector3(...hiTint) } }),
    vertexShader: /* glsl */`
      attribute vec3 tint; attribute float leaf; attribute vec4 clump;
      uniform vec3 uCrown;
      varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vUv; varying float vLeaf;
      varying vec3 vClump; varying vec3 vCrown; varying float vClumpR;
      ${S.NOISE_GLSL}
      ${S.WIND_GLSL}
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vW = builtWorldPos(position, uv, leaf, im);
        vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        vTint = tint;
        #ifdef USE_INSTANCING_COLOR
          vTint *= instanceColor;
        #endif
        vUv = uv; vLeaf = leaf;
        // the clump and crown centres bend with the same main wind as the cards (uv.y 0, leaf 0: no flutter)
        vClump = builtWorldPos(clump.xyz, vec2(0.0), 0.0, im);
        vCrown = builtWorldPos(uCrown, vec2(0.0), 0.0, im);
        vClumpR = clump.w * length((modelMatrix * im)[0].xyz);
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uLeafTex; uniform float uLeafAlpha;
      varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying vec2 vUv; varying float vLeaf;
      varying vec3 vClump; varying vec3 vCrown; varying float vClumpR;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      ${F.FLUFFY_GLSL}
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        vec3 col;
        if (vLeaf > 0.5) {
          float a = texture2D(uLeafTex, vUv).a;
          vec2 tu = vUv * vec2(textureSize(uLeafTex, 0));
          float mip = max(0.0, 0.5 * log2(max(dot(dFdx(tu), dFdx(tu)), dot(dFdy(tu), dFdy(tu)))));
          a *= 1.0 + mip * 0.25;                  // keep the clump's coverage in the small mips
          if (a < uLeafAlpha) discard;
          // fluffytree: the card's own normal is ignored; the pixel's direction from its clump centre (same on
          // both faces, so the crown cannot flicker), deep pixels in the clump's shade, then the highlight ramp
          N = fluffyNormal(vW, vClump, vCrown);
          col = toonLight(vTint, N, V, vW, fluffyVis(vW, vClump, vClumpR), 0.0);
          col = fluffyHighlight(col, N, uSunDir, uSunColor);
        } else {
          if (!gl_FrontFacing) N = -N;
          col = toonLight(vTint, N, V, vW, 1.0, 0.3);
        }
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: false, defines: { TOON_LEAF: "" },
  });
  m.alphaTest = 0.4;   // documents the cut (the shader's uLeafAlpha does it); never blended
  return m;
}

// Geometry builder: parts of { pos, nor, uv, idx, tint:[r,g,b] per vertex or one, leaf 0/1, clump:[x,y,z,R] per
// vertex (leaf cards) or absent (0) } -> one indexed geometry
export function buildGeometry(parts) {
  let nv = 0, ni = 0; for (const p of parts) { nv += p.pos.length / 3; ni += p.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2),
        tint = new Float32Array(nv * 3), leaf = new Float32Array(nv), clump = new Float32Array(nv * 4), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) {
    const n = p.pos.length / 3;
    pos.set(p.pos, ov * 3); nor.set(p.nor, ov * 3); uv.set(p.uv, ov * 2); leaf.fill(p.leaf, ov, ov + n);
    if (p.clump) clump.set(p.clump, ov * 4);
    for (let i = 0; i < n; i++) tint.set(p.tint.length === 3 ? p.tint : p.tint.slice(i * 3, i * 3 + 3), (ov + i) * 3);
    for (let i = 0; i < p.idx.length; i++) idx[oi + i] = p.idx[i] + ov;
    ov += n; oi += p.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
  g.setAttribute("leaf", new THREE.BufferAttribute(leaf, 1));
  g.setAttribute("clump", new THREE.BufferAttribute(clump, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// Fluffy leaf part from clumps [{ c:[x,y,z], R }]: cards spread over the clumps by clump area (R^2), at least 6
// each; card side CARD_K x R (PICKED 0.75: with centres out to 0.62 R the clump's edge is ~1.15 R). The vertex
// normal attribute is the radial direction from the clump centre (the fragment shader recomputes it per pixel).
const CARD_K = 0.75;
export function fluffyPart(clumps, cards, seed, mid) {
  const r = F.rng(seed), out = { pos: [], uv: [], idx: [], clump: [] }, tint = [];
  const w = clumps.map((q) => q.R * q.R), W = w.reduce((a, b) => a + b, 0);
  let left = cards;
  for (const [i, q] of clumps.entries()) {
    const n = i === clumps.length - 1 ? left : Math.max(6, Math.round(cards * w[i] / W));
    left -= n;
    const before = out.pos.length / 3;
    F.clumpCards(q.c, q.R, n, q.R * CARD_K, r, out);
    for (let k = 0; k < n; k++) {
      const j = 0.92 + r() * 0.16;
      for (let v = 0; v < 4; v++) tint.push(mid.r * j, mid.g * j, mid.b * j);
    }
    if (out.pos.length / 3 - before !== n * 4) throw new Error("fluffy cards");
  }
  const pos = Float32Array.from(out.pos), nor = new Float32Array(pos.length);
  for (let v = 0; v < pos.length / 3; v++) {
    const d = [0, 1, 2].map((a) => pos[v * 3 + a] - out.clump[v * 4 + a]), l = Math.hypot(...d) || 1;
    for (let a = 0; a < 3; a++) nor[v * 3 + a] = d[a] / l;
  }
  return { pos, nor, uv: out.uv, idx: out.idx, tint, leaf: 1, clump: out.clump };
}

// Broadleaf tree from ez-tree's "Oak Medium" rules cut down to one branch level: 7 boughs (trunk + boughs kept);
// ez-tree's leaf cards are only used to find where the leaves hang: their centres are grouped into CLUMPS (k-means,
// PICKED 6) and each clump of fluffy cards sits there. Triangles per tree: TREE_TRIS (PICKED 760: 23 trees, 101
// bushes and 2 pines stay under the checker's 25k). Height normalised to 1, base at the origin.
const BROADLEAF = { branch: { levels: 1, children: { 0: 7 }, sections: { 0: 4, 1: 3 }, segments: { 0: 5, 1: 3 }, start: { 1: 0.45 } },
                    leaves: { count: 10, size: 9, start: 0.2 } };
const CLUMPS = 6, TREE_TRIS = 760;
function setDeep(o, m) { for (const [k, v] of Object.entries(m)) (typeof v === "object" ? setDeep(o[k], v) : (o[k] = v)); }
export function broadleafGeometry(seed, pal) {
  const t = new Tree();
  t.options.copy(structuredClone(TreePreset["Oak Medium"]));
  setDeep(t.options, BROADLEAF);
  t.options.seed = seed; t.options.bark.textured = false;
  t.generate();
  const bg = t.branchesMesh.geometry, lg = t.leavesMesh.geometry;
  const bp = bg.attributes.position.array, lp = lg.attributes.position.array;
  // where ez-tree's leaf cards hang (card centres, raw units) -> clumps; radius = 1.1 x the 80th-percentile spread
  const spots = []; for (let q = 0; q < lp.length / 12; q++) spots.push([0, 1, 2].map((a) => (lp[q * 12 + a] + lp[q * 12 + 3 + a] + lp[q * 12 + 6 + a] + lp[q * 12 + 9 + a]) / 4));
  const leafSize = t.options.leaves.size;
  const clumps = F.kmeans(spots, CLUMPS).map((g) => {
    const d = g.members.map((i) => Math.hypot(...[0, 1, 2].map((a) => spots[i][a] - g.c[a]))).sort((a, b) => a - b);
    return { c: g.c, R: Math.max(leafSize * 0.6, 1.1 * d[Math.floor(0.8 * (d.length - 1))] + leafSize * 0.35) };
  });
  const branchTris = bg.index.count / 3;
  const leafPart = fluffyPart(clumps, Math.floor((TREE_TRIS - branchTris) / 2), seed * 7 + 1, pal.crownMid);
  let H = 0; for (let i = 1; i < bp.length; i += 3) H = Math.max(H, bp[i]); for (let i = 1; i < leafPart.pos.length; i += 3) H = Math.max(H, leafPart.pos[i]);
  const k = 1 / H;
  const bpos = Float32Array.from(bp, (x) => x * k);
  for (let i = 1; i < bpos.length; i += 3) if (bpos[i] < 1e-6) bpos[i] = -0.02;   // trunk foot a little into the ground
  leafPart.pos = leafPart.pos.map((x) => x * k);
  leafPart.clump = leafPart.clump.map((x) => x * k);
  const C = [0, 0, 0]; for (const q of clumps) for (let a = 0; a < 3; a++) C[a] += q.c[a] * k / clumps.length;   // crown centre
  const out = buildGeometry([
    { pos: bpos, nor: bg.attributes.normal.array, uv: bg.attributes.uv.array.map((x, i) => (i % 2 ? 0 : x)), idx: bg.index.array,
      tint: [pal.bark.r, pal.bark.g, pal.bark.b], leaf: 0 },
    leafPart,
  ]);
  // ez-tree's own leaf cards, materials and textures are not drawn
  t.branchesMesh.material.dispose(); t.leavesMesh.material.map?.dispose(); t.leavesMesh.material.dispose();
  bg.dispose(); lg.dispose();
  out.userData = { crown: C, cards: leafPart.pos.length / 12, H: 1,
                   clumps: clumps.map((q) => ({ c: q.c.map((x) => x * k), R: q.R * k })) };
  return out;
}

// Bush: three fluffy clumps (same cards and shading as the crowns), about 0.7 tall at scale 1, 28 cards = 56
// triangles. Clump spots and radii PICKED (a low wide mound).
const BUSH_CLUMPS = [{ c: [-0.24, 0.27, 0.02], R: 0.27 }, { c: [0.22, 0.25, -0.06], R: 0.25 }, { c: [0.0, 0.40, 0.05], R: 0.26 }];
export function bushGeometry(seed, pal) {
  const part = fluffyPart(BUSH_CLUMPS, 28, seed, pal.bushMid);
  const g = buildGeometry([part]);
  const C = [0, 0, 0]; for (const q of BUSH_CLUMPS) for (let a = 0; a < 3; a++) C[a] += q.c[a] / BUSH_CLUMPS.length;
  g.userData = { crown: C, cards: part.pos.length / 12, H: 0.7, clumps: BUSH_CLUMPS };
  return g;
}

// Pine: a stack of jittered cones (imaginu-style cone stack, far conifer, no alpha), normals blended toward the
// stack's axis centre so it shades as one soft mass. Height 1, base at the origin.
export function pineGeometry(seed, pal) {
  const parts = [], r = rng(seed);
  const trunk = new THREE.CylinderGeometry(0.03, 0.05, 0.32, 7); trunk.translate(0, 0.14, 0);
  const tp = trunk.attributes.position.array;   // foot at y -0.02: a little into the ground
  parts.push({ pos: tp, nor: trunk.attributes.normal.array, uv: trunk.attributes.uv.array.map(() => 0), idx: trunk.index.array,
               tint: [pal.needleBark.r, pal.needleBark.g, pal.needleBark.b], leaf: 0 });
  const C = new THREE.Vector3(0, 0.55, 0);
  for (let k = 0; k < 4; k++) {
    const rad = 0.27 - k * 0.055, h = 0.36 - k * 0.04;
    const c = new THREE.ConeGeometry(rad, h, 12, 2); c.translate(0, 0.22 + k * 0.19 + h / 2, 0);
    const p = c.attributes.position.array, seen = new Map();
    for (let i = 0; i < p.length; i += 3) {
      const key = `${p[i].toFixed(3)},${p[i + 1].toFixed(3)},${p[i + 2].toFixed(3)}`;
      if (!seen.has(key)) seen.set(key, 1 + (r() - 0.5) * 0.12);
      const s = seen.get(key); p[i] *= s; p[i + 2] *= s;
    }
    c.computeVertexNormals();
    const n = c.attributes.normal.array, v = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = 0; i < n.length; i += 3) {
      v.fromArray(n, i); d.fromArray(p, i).sub(C).normalize();
      v.lerp(d, 0.5).normalize().toArray(n, i);
    }
    const col = k % 2 ? pal.needleLit : pal.needleMid;
    parts.push({ pos: p, nor: n, uv: c.attributes.uv.array.map(() => 0), idx: c.index.array, tint: [col.r, col.g, col.b], leaf: 0 });
  }
  const g = buildGeometry(parts);
  g.userData = { crown: C.toArray(), cards: 0, H: 1 };
  return g;
}

// ---------------- the registry's makers (web/built/registry.js) ----------------
/** species asset: geometry + material, the matrices of web/built/place/foliage.js are made for exactly this geometry */
export function speciesAsset(name, pal, leafTex = leafClumpTexture()) {
  const def = { broadleaf: [broadleafGeometry, 21, [pal.crownLit, pal.crownMid]], pine: [pineGeometry, 11, null], bush: [bushGeometry, 7, [pal.bushLit, pal.bushMid]] }[name];
  const geo = def[0](def[1], pal);
  // highlight tint = the palette's lit colour / its mid colour (measured for the crown; bushLit is mid x 1.15)
  const hiTint = def[2] ? ["r", "g", "b"].map((c) => def[2][0][c] / Math.max(def[2][1][c], 1e-4)) : [1, 1, 1];
  const mat = foliageMaterial(leafTex, geo.userData.crown, hiTint);
  return { geo, mat };
}
