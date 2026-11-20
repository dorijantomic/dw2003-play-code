// BOULDER PILES of a forest-and-lake arena (meft1008, wall_03), built look (Arena Viewer, look=built). Loaded by
// web/arena-built.js for the recipe kind
//   rock   two stacked boulder piles standing on the floor, one per card of the piece (wall_03), facing the centre
// ASSET ONLY (geometry + material): WHERE they stand is web/built/place/boulders.js (slot data). It was the arena's own cards (tools/arena_built_recipe.py, kind "rock": only the triangles above y 0;
// the piece also holds its lake copy wall_04, which is NOT built here — the `reflection` hand-off below is for the
// mirror/lake module). MEASURED (MEASURE.md 2d, from geometry.json through the pack -> render transform):
//   A  az -65.5 deg, r 24.17 m, 2.93 m wide, y 0..1.72 m   (behind floor_00's card at -70.2)
//   B  az 128.1 deg, r 22.98 m, 3.81 m wide, y 0..2.15 m   (in the bay gap: visible)
//   colour: warm red-brown, median [96,64,64], p10 [32,24,24], p90 [168,128,112], 0 % green (NO moss on these)
// rocks.md 6 (P0+P1): 2 piles, 3-5 hull lumps each, flat normals, baked per-vertex AO, one BufferGeometry for both
// piles, one mesh, one draw call, no textures. The lump hull is ground.js boulderHull()'s scheme (jittered sphere ->
// ConvexGeometry), with more points here (26 -> 48 triangles a lump) because these are seen as separate lumps.
import * as THREE from "../lib3d/three.module.js";
import { ConvexGeometry } from "../lib3d/addons/ConvexGeometry.js";
import * as S from "./shared.js";

export const BOULDERS = {
  // USER (2026-10-30, comparing with the real game): "a stacked pile of brown/pink cobbles with dark cracks between the
  // stones, standing in the water" -- the first build (4-5 smooth faceted lumps per pile) read as smooth pink blobs.
  // So each pile is now 14-30 separate rounded cobbles stacked in layers (a pyramid pack), a dark core fills the gaps,
  // and every cobble is darkened where it nears a neighbour (the cracks).
  PILE_A: 3,        // layers in pile A (the smaller, mostly hidden pile)
  PILE_B: 4,        // layers in pile B
  STONE_D: 0.78,    // PICKED: mean cobble diameter (m); the pile is then fitted to the card's measured width and height
  DETAIL: 2,        // icosphere detail of a cobble: 320 triangles
  BUMP: 0.10,       // low-frequency lumpiness of a cobble (share of its radius)
  SINK: 0.06,       // share of the pile's height its lowest layer is sunk into the floor (PICKED)
  AO_GROUND: 0.60,  // baked AO multiplier at the floor line (PICKED)
  CRACK_K: 0.78,    // how dark a cobble gets next to a neighbour: the dark crack (PICKED)
  CRACK_W: 0.30,    // width of that zone, in neighbour radii beyond its surface (PICKED)
  AO_TOP: 0.30,     // height (share of the pile's height) over which the ground occlusion clears (PICKED)
  DEPTH_K: 0.62,    // the pile's own depth (radially) as a share of the card's width (PICKED: a lump, not a flat card)
  TINT0: 0.50,      // stone tone at the middle of the noise (0.5 = the piece's measured median colour)
  // MEASURED tones of wall_03 (k-means of its opaque texels, share): dark [28,23,24] 22 %, [66,49,50] 20 %,
  // [101,71,71] 21 %, [135,99,95] 15 %, [169,126,115] 14 %, [202,157,141] 7 %. The cobble tone index runs along the
  // piece's p10 .. median .. p90 ramp; the spread below puts the cobbles over that whole range.
  TONE: [0.30, 0.95],   // per-cobble base tone range along the ramp (0 = p10 crevice, 0.5 = median, 1 = p90 lit)
  GRAIN: 1.15,      // noise scale of the stone grain, per metre (PICKED)
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** One cobble: an icosphere (detail DETAIL, 320 triangles) with a seeded low-frequency lump, normalised to width 1,
 *  height 1, bottom at y 0, centred on x = z = 0. Normals are the SMOOTH ellipsoid normals (a river cobble is
 *  round; the facet edges must not show in the light). Non-indexed. */
export function cobbleMesh(seed) {
  const ico = new THREE.IcosahedronGeometry(1, BOULDERS.DETAIL).toNonIndexed();
  const P = ico.attributes.position.array, r = rng(seed);
  const f = [1 + r() * 2.5, 1 + r() * 2.5, 1 + r() * 2.5], ph = [r() * 6.3, r() * 6.3, r() * 6.3];
  const out = new Float32Array(P.length), nrm = new Float32Array(P.length);
  const sq = [0.9 + r() * 0.25, 0.62 + r() * 0.30, 0.9 + r() * 0.25];     // a flattened, slightly squarish cobble
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    const bump = 1 + BOULDERS.BUMP * (Math.sin(x * f[0] * 2 + ph[0]) * Math.sin(y * f[1] * 2 + ph[1]) + 0.6 * Math.sin(z * f[2] * 2.3 + ph[2] + x));
    out[i] = x * sq[0] * bump; out[i + 1] = y * sq[1] * bump; out[i + 2] = z * sq[2] * bump;
    const nx = x / (sq[0] * sq[0]), ny = y / (sq[1] * sq[1]), nz = z / (sq[2] * sq[2]), L = Math.hypot(nx, ny, nz) || 1;
    nrm[i] = nx / L; nrm[i + 1] = ny / L; nrm[i + 2] = nz / L;
  }
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < out.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], out[i + a]); hi[a] = Math.max(hi[a], out[i + a]); }
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, w = Math.max(hi[0] - lo[0], hi[2] - lo[2]) || 1, h = (hi[1] - lo[1]) || 1;
  for (let i = 0; i < out.length; i += 3) { out[i] = (out[i] - cx) / w; out[i + 1] = (out[i + 1] - lo[1]) / h; out[i + 2] = (out[i + 2] - cz) / w; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(out, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData = { tris: out.length / 9, width: 1, height: 1 };
  return g;
}

/** A pile's cobbles in pile-local metres (x sideways, y up from the floor, z toward the viewer; the card's own width
 *  w and height h): `layers` rows stacked as a pyramid pack -- each row narrower than the one below, its cobbles
 *  resting in the gaps of the row under them -- in two staggered depth rows, plus one dark core filling the middle.
 *  PICKED, but the whole silhouette is then fitted to exactly the card's measured width and height. */
function pileLumps(w, h, layers, seed) {
  const r = rng(seed), out = [];
  const d = BOULDERS.STONE_D, hd = h / (1 + (layers - 1) * 0.62 * 1.18);       // cobble diameter so that `layers` rows reach h
  const dd = Math.min(d, hd * 1.15);
  for (let k = 0; k < layers; k++) {
    const rowW = w * (1 - 0.20 * k), n = Math.max(2, Math.round(rowW / (dd * 0.84)));
    for (let zr = 0; zr < 2; zr++) {                                           // two staggered depth rows per layer
      const nn = zr ? Math.max(2, n - 1) : n;
      for (let i = 0; i < nn; i++) {
        const t = (i + 0.5) / nn, shift = zr ? 0.0 : 0.0;
        const lw = dd * (0.80 + 0.40 * r()), lh = lw * (0.62 + 0.26 * r());
        const x = (t - 0.5) * rowW * (zr ? 0.94 : 1.0) + (r() - 0.5) * dd * 0.18 + shift;
        const z = (zr ? 0.22 : -0.20) * w * BOULDERS.DEPTH_K + (r() - 0.5) * dd * 0.25;
        const y = k * dd * 0.62 * 1.18 - (k === 0 ? BOULDERS.SINK * h : 0) + (r() - 0.5) * dd * 0.06 + (zr ? dd * 0.10 : 0);
        out.push({ x, y, z, w: lw, h: lh, yaw: r() * Math.PI * 2, seed: seed * 31 + out.length,
                   tone: BOULDERS.TONE[0] + (BOULDERS.TONE[1] - BOULDERS.TONE[0]) * Math.pow(r(), 0.85) + 0.05 * k,
                   hue: r() * 2 - 1 });
      }
    }
  }
  // the dark core: fills the gaps so a crack shows dark stone, never the sky behind the pile
  out.push({ x: 0, y: h * 0.10, z: 0, w: w * 0.62, h: h * 0.62, yaw: 0, seed: seed * 31 + 999, tone: 0.0, hue: 0, core: true });
  return out;
}

/** Both piles merged into ONE non-indexed geometry: position, normal, aTint (0..1 stone tone), aAO (baked occlusion).
 *  Each pile is normalised so its silhouette is exactly the card's measured width and height. */
function pilesGeometry(THREE_, pieces, cols) {
  const pos = [], nor = [], tint = [], ao = [], hue = [], piles = [];
  const hulls = Array.from({ length: 8 }, (_, i) => cobbleMesh(7000 + i * 13));   // 8 cobble shapes, scaled and turned per stone
  for (const [pi, card] of pieces.entries()) {
    const w = card.w, h = card.h;                       // render units (card corner width / height)
    const wM = w / 400, hM = h / 400;
    const lumps = pileLumps(wM, hM, pi === 0 ? BOULDERS.PILE_A : BOULDERS.PILE_B, 401 + pi * 17);
    // place the lumps, then fit the pile to the card's own size (and sit it on the floor)
    const placed = [], M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Yv = new THREE.Vector3(0, 1, 0);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], tris = 0;
    for (const [li, L] of lumps.entries()) {
      const g = hulls[(L.seed + li) % hulls.length];
      const src = g.attributes.position.array, nsrc = g.attributes.normal.array;
      Q.setFromAxisAngle(Yv, L.yaw);
      M4.compose(new THREE.Vector3(L.x, L.y, L.z), Q, new THREE.Vector3(L.w, L.h, L.w));
      const P = new Float32Array(src.length), N = new Float32Array(nsrc.length);
      const v = new THREE.Vector3(), nm = new THREE.Vector3();
      const invT = new THREE.Matrix3().getNormalMatrix(M4);
      for (let i = 0; i < src.length; i += 3) {
        v.fromArray(src, i).applyMatrix4(M4); v.toArray(P, i);
        nm.fromArray(nsrc, i).applyMatrix3(invT).normalize().toArray(N, i);
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); }
      }
      tris += src.length / 9;
      placed.push({ L, P, N, c: [L.x, L.y + L.h * 0.5, L.z], rad: [L.w * 0.5, L.h * 0.5, L.w * 0.5] });
    }
    // fit: sideways (along the card's own dir) to the card's width, depth to DEPTH_K x the width (a pile is a lump,
    // not a flat card), y to the card's height, bottom on the floor. The pile frame is the card's own frame, so the
    // silhouette it shows the arena centre is exactly the measured one.
    const rad = Math.hypot(card.base[0], card.base[2]) || 1;
    const nx = card.base[0] / rad, nz = card.base[2] / rad;                       // radial (the card's normal)
    const dx = card.dir ? card.dir[0] : -nz, dz = card.dir ? card.dir[1] : nx;    // sideways (the card's own dir)
    const fx = w / Math.max(1e-6, hi[0] - lo[0]), fz = BOULDERS.DEPTH_K * w / Math.max(1e-6, hi[2] - lo[2]),
          fy = h / Math.max(1e-6, hi[1] - lo[1]);
    const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
    const toPile = (p) => {
      const lx = (p[0] - cx) * fx, lz = (p[2] - cz) * fz, y = (p[1] - lo[1]) * fy;
      return [card.base[0] + dx * lx + nx * lz, y, card.base[2] + dz * lx + nz * lz];
    };
    let topY = 0;
    for (const q of placed) {
      for (let i = 0; i < q.P.length; i += 3) {
        const p = toPile([q.P[i], q.P[i + 1], q.P[i + 2]]);
        topY = Math.max(topY, p[1]);
        // baked AO: (a) the floor line, (b) the CRACKS: a vertex that comes near another cobble's surface (measured in
        // that cobble's own ellipsoid, pre-fit metres) goes dark -- the dark lines between the stones
        let a = BOULDERS.AO_GROUND + (1 - BOULDERS.AO_GROUND) * Math.min(1, Math.max(0, p[1] / Math.max(1e-6, BOULDERS.AO_TOP * h)));
        if (!q.L.core) {
          for (const o of placed) {
            if (o === q) continue;
            const sd = Math.hypot((q.P[i] - o.c[0]) / o.rad[0], (q.P[i + 1] - o.c[1]) / o.rad[1], (q.P[i + 2] - o.c[2]) / o.rad[2]) - 1;
            if (sd < BOULDERS.CRACK_W) a *= 1 - BOULDERS.CRACK_K * Math.min(1, (BOULDERS.CRACK_W - sd) / (BOULDERS.CRACK_W + 0.10));
          }
        }
        a = Math.max(0.10, Math.min(1, a));
        pos.push(p[0], p[1], p[2]);
        nor.push(q.N[i], q.N[i + 1], q.N[i + 2]);
        // cobble tone: its own base tone along the piece's p10 .. median .. p90 ramp, a little shared-noise grain, and
        // top faces a touch lighter; the dark core is the p10 end
        const nz = S.fbm3JS(p[0] / 400 * BOULDERS.GRAIN, p[1] / 400 * BOULDERS.GRAIN, p[2] / 400 * BOULDERS.GRAIN);
        const up = Math.max(0, q.N[i + 1]);
        tint.push(Math.max(0, Math.min(1, q.L.tone + 0.34 * (nz - 0.5) + 0.16 * up)));
        hue.push(q.L.hue);
        ao.push(a);
      }
    }
    piles.push({ card: card.name || `card${pi}`, az: Math.atan2(card.base[0], card.base[2]) * 180 / Math.PI,
                 r: Math.hypot(card.base[0], card.base[2]) / 400, w: wM, h: hM, lumps: lumps.length, topY: topY / 400,
                 x: card.base[0], z: card.base[2], tris });
  }
  const g = new THREE_.BufferGeometry();
  g.setAttribute("position", new THREE_.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE_.Float32BufferAttribute(nor, 3));
  g.setAttribute("aTint", new THREE_.Float32BufferAttribute(tint, 1));
  g.setAttribute("aAO", new THREE_.Float32BufferAttribute(ao, 1));
  g.setAttribute("aHue", new THREE_.Float32BufferAttribute(hue, 1));
  g.computeBoundingSphere();
  return { geometry: g, piles, cols };
}

// warm red-brown stone, no moss (the piece is 0 % green): the measured p10 / median / p90 as the three tones, the
// shared noise for the grain, the baked AO for the crevices, the shared toon light and aerial haze
export function boulderMaterial(cols) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uRockLo: { value: cols.lo }, uRockMid: { value: cols.mid }, uRockHi: { value: cols.hi },
      uRockGrain: { value: 1.0 },   // grain amount
      uRockAO: { value: 1.0 },      // baked crevice occlusion
      uRockScrape: { value: 1.0 },  // facet-to-facet value break (the chiselled look)
    }),
    vertexShader: /* glsl */`
      attribute float aTint; attribute float aAO; attribute float aHue;
      varying vec3 vW; varying vec3 vN; varying float vTint; varying float vAO; varying float vHue;
      void main() {
        #ifdef USE_INSTANCING
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
        #endif
        vW = w.xyz; vTint = aTint; vAO = aAO; vHue = aHue;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uRockLo, uRockMid, uRockHi;
      uniform float uRockGrain, uRockAO, uRockScrape;
      varying vec3 vW; varying vec3 vN; varying float vTint; varying float vAO; varying float vHue;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        // grain: one fbm octave-set over world metres, the second noise breaking the edges up
        float g1 = fbm3(vW / 400.0 * ${BOULDERS.GRAIN.toFixed(2)});
        float g2 = noise3(vW / 400.0 * 4.3 + vec3(7.1, 2.3, 5.5));
        float t = clamp(vTint + (g1 - 0.5) * 0.55 * uRockGrain + (g2 - 0.5) * 0.15, 0.0, 1.0);
        vec3 base = t < 0.5 ? mix(uRockLo, uRockMid, t * 2.0) : mix(uRockMid, uRockHi, (t - 0.5) * 2.0);
        // brown <-> pink cobbles (the piece is warm red-brown, 0 % green): a small hue push either way
        base *= vHue > 0.0 ? mix(vec3(1.0), vec3(1.04, 0.95, 1.06), vHue) : mix(vec3(1.0), vec3(1.07, 1.0, 0.86), -vHue);
        // a facet's own tilt: the chipped faces catch the light at their own angle (flat normals, so hard steps)
        float facet = clamp(dot(N, normalize(vec3(0.28, 1.0, 0.22))), 0.0, 1.0);
        base *= mix(1.0, 0.84 + 0.30 * facet, uRockScrape);
        base *= mix(1.0, vAO, uRockAO);
        // a warm, mostly-diffuse light: ambient + sun, kept in the stone's own hue (the 3-band toon step's blue shade
        // tint made the measured red-brown [96,64,64] read pink-grey)
        float ndl = clamp(dot(N, uLightDir), 0.0, 1.0);
        vec3 col = base * (0.70 + 0.46 * ndl);
        gl_FragColor = vec4(col, 1.0);   // no aerial lift: the measured stone colour is the target
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

/** the default asset of the slot boulders.piles: builds the piles from the slot's cards + measured colours */
export function buildBoulders(slot, env) {
  const T = THREE, SH = S, { materials, info } = env;
  const pieces = slot.data.pieces;
  const t0 = performance.now();
  // the piece's own measured colours (p10 = crevice, median, p90 = lit face); the recipe reads them from the arena
  const lin = (c) => SH.srgb(c);
  const out = { pieces: [], piles: [], tris: 0, meshes: 1, drawCalls: 1, buildMs: 0 };
  let geo = null, mat = null;
  const meshes = [];
  for (const p of pieces) {
    const cards = p.cards;
    const cols = { lo: lin(p.colours.p10 || p.colours.all), mid: lin(p.colours.all), hi: lin(p.colours.p90 || p.colours.top || p.colours.all) };
    const made = pilesGeometry(T, cards, cols);
    mat = boulderMaterial(cols); mat.name = "builtBouldersMaterial";
    const mesh = new T.Mesh(made.geometry, mat);
    mesh.name = "builtBoulderPiles";
    mesh.userData = { kind: "rocks", piles: made.piles.map((q) => ({ az: +q.az.toFixed(1), r: +q.r.toFixed(2) })) };
    materials.push(mat); meshes.push(mesh);
    out.pieces.push({ name: p.name, cards: cards.length, colours: p.colours });
    out.piles.push(...made.piles.map((q) => ({ ...q, az: +q.az.toFixed(2), r: +q.r.toFixed(2), w: +q.w.toFixed(2), h: +q.h.toFixed(2), topY: +q.topY.toFixed(2) })));
    out.tris += made.geometry.attributes.position.count / 3;
    geo = made.geometry;   // kept OUT of info (info is numbers only; the buffers go in `reflection` below)
  }
  if (!meshes.length) return null;
  // baked AO and stone tone ranges, as built (the checker reads them)
  const rngOf = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return [+lo.toFixed(3), +hi.toFixed(3)]; };
  out.ao = rngOf(geo.attributes.aAO.array); out.tint = rngOf(geo.attributes.aTint.array);
  out.vertices = geo.attributes.position.count;
  out.buildMs = Math.round(performance.now() - t0);
  out.lumpTris = 20 * 4 ** BOULDERS.DETAIL;
  info.boulders = out;
  return {
    objects: meshes, meshes,
    info: out,
    // for the mirror/lake module: the SAME geometry and material, one mesh; draw it again under a parent with
    // scale.y = -1 and a tint (MEASURE.md 2e: wall_04 is wall_03's darker, greener, flatter copy). Nothing is
    // mirrored here.
    reflection: { mesh: meshes[0], geometry: geo, material: mat, piles: out.piles },
  };
}

/** the same rock as an instanced part (one cobble in the piles' own shader): what mod.boulder_piles draws in any other slot */
export function boulderPart(env, colours = null) {
  const lin = (c) => S.srgb(c);
  const c = colours || { p10: [44, 38, 34], all: [112, 100, 90], p90: [176, 164, 150] };   // a neutral stone when the slot has no colours of its own
  const mat = boulderMaterial({ lo: lin(c.p10 || c.all), mid: lin(c.all), hi: lin(c.p90 || c.top || c.all) }); mat.name = "builtBouldersMaterial";
  return { geo: cobbleMesh(7000), mat, attrs: { aTint: [1, 0.5], aAO: [1, 1], aHue: [1, 0] } };
}
