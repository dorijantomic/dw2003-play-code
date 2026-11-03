// Fluffy anime crowns, after leoawen/fluffytree-threejs (github.com/leoawen/fluffytree-threejs, index.html,
// MIT, (c) 2025 Leonardo Soares Goncalves; licence in ./LICENSE). Only the METHOD is taken, no file of it:
//   - a crown is a few overlapping clumps ("NOVA COPA" spheres in its model); each clump is many small leaf cards
//     with random orientations filling the clump's volume (measured from its GLB: |card normal . radial| spreads
//     evenly over 0..1, card centres from 0.2 to 0.8 of the clump radius, card side ~ 1/5 of the clump radius);
//   - the shading ignores the card's own normal: it uses normalize(fragment world position - clump centre), so the
//     clump lights as ONE soft sphere (its createCustomCanopyMaterial: fromCenterToSurface . light), with a second
//     brighter "highlight" ramp on the side facing the light;
//   - alpha-tested cut-out leaves (its alphaTest 0.5, double sided, depth written), wind on the vertices.
// Not taken: its leaf texture (TreeLeaves03b, a third-party picture), its 18k-triangle model, its colours, its
// Lambert/HDRI light. Our cards are bigger (few triangles), the leaf cluster alpha is drawn here on a canvas, and
// the light is the built arena's shared toonLight (web/built/shared.js), so sun by day and moon by night.

/** Seeded uniform random in [0, 1). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Leaf-cluster alpha on a canvas (no image file): a round core with many pointed leaves round it, their tips
 *  pointing outward, so the cut-out edge is frilly like fluffytree's leaf cards. White on clear, size x size. */
export function drawLeafCluster(doc, size = 256, seed = 5) {
  const c = doc.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"), r = rng(seed), h = size / 2;
  g.fillStyle = "#fff";
  const leafShape = (x, y, ang, len, wid) => {   // a pointed leaf: two quadratic arcs from base to tip
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = (u, v) => [x + ca * u - sa * v, y + sa * u + ca * v];
    g.beginPath(); g.moveTo(...P(0, 0));
    g.quadraticCurveTo(...P(len * 0.5, wid), ...P(len, 0));
    g.quadraticCurveTo(...P(len * 0.5, -wid), ...P(0, 0));
    g.fill();
  };
  g.beginPath(); g.arc(h, h, size * 0.27, 0, Math.PI * 2); g.fill();   // the dense core
  for (let k = 0; k < 90; k++) {
    const a = r() * Math.PI * 2, d = size * (0.12 + 0.2 * Math.sqrt(r()));
    const x = h + Math.cos(a) * d, y = h + Math.sin(a) * d;
    const len = size * (0.1 + r() * 0.08), out = a + (r() - 0.5) * 0.9;   // tips point outward, a little jitter
    leafShape(x, y, out, len, len * (0.22 + r() * 0.1));
  }
  return c;
}

/** Cards for one clump: centre C [x,y,z], radius R, n cards, side s (object units). Card centres spread through
 *  the clump volume (0.2..0.62 R), card normals = mix(radial, random, 0.6), random spin about the normal. Pushes
 *  4 vertices per card into pos/uv (uv.y = 0 on the card's lower edge: the wind flutter keeps it fixed) and two
 *  triangles into idx, and [Cx, Cy, Cz, R] per vertex into clump; returns nothing. */
export function clumpCards(C, R, n, s, r, out) {
  const { pos, uv, idx, clump } = out;
  const unit = () => { const z = r() * 2 - 1, a = r() * Math.PI * 2, q = Math.sqrt(1 - z * z); return [q * Math.cos(a), z, q * Math.sin(a)]; };
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let k = 0; k < n; k++) {
    const d = unit(), f = 0.2 + 0.42 * Math.cbrt(r());                      // volume-even between 0.2 and 0.62 R
    const m = [C[0] + d[0] * f * R, C[1] + d[1] * f * R, C[2] + d[2] * f * R];
    const rn = unit(), nn = norm([d[0] * 0.4 + rn[0] * 0.6, d[1] * 0.4 + rn[1] * 0.6, d[2] * 0.4 + rn[2] * 0.6]);
    const ref = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let t = norm(cross(ref, nn)); let b = cross(nn, t);
    const sp = r() * Math.PI * 2, cs = Math.cos(sp), sn = Math.sin(sp);
    [t, b] = [t.map((x, i) => x * cs + b[i] * sn), t.map((x, i) => -x * sn + b[i] * cs)];
    const base = pos.length / 3;
    for (const [u, v] of [[0, 1], [0, 0], [1, 0], [1, 1]]) {
      const a = (u - 0.5) * s, e = (v - 0.5) * s;
      pos.push(m[0] + t[0] * a + b[0] * e, m[1] + t[1] * a + b[1] * e, m[2] + t[2] * a + b[2] * e);
      uv.push(u, v); clump.push(C[0], C[1], C[2], R);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** k-means (seeded farthest-point start) of 3D points into k groups: returns [{ c:[x,y,z], members:[i...] }]. */
export function kmeans(pts, k, iters = 12) {
  const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const cs = [pts[0].slice()];
  while (cs.length < k) {
    let best = 0, bd = -1;
    for (let i = 0; i < pts.length; i++) { const d = Math.min(...cs.map((c) => D(c, pts[i]))); if (d > bd) { bd = d; best = i; } }
    cs.push(pts[best].slice());
  }
  let groups = [];
  for (let it = 0; it < iters; it++) {
    groups = cs.map(() => []);
    for (let i = 0; i < pts.length; i++) {
      let j = 0; for (let q = 1; q < cs.length; q++) if (D(cs[q], pts[i]) < D(cs[j], pts[i])) j = q;
      groups[j].push(i);
    }
    for (const [j, g] of groups.entries()) if (g.length) for (let a = 0; a < 3; a++) cs[j][a] = g.reduce((s, i) => s + pts[i][a], 0) / g.length;
  }
  return cs.map((c, j) => ({ c, members: groups[j] })).filter((g) => g.members.length);
}

/** Fragment GLSL: the fluffytree normal and highlight. Needs varyings vW (world position), vClump (clump centre,
 *  world, after the same wind), vClumpR (clump radius, world), uniform uCrownMix (share of the whole-crown centre
 *  direction blended in so clumps stay one tree), vCrown (crown centre, world). */
export const FLUFFY_GLSL = /* glsl */`
  uniform float uCrownMix, uInnerVis, uHiLo, uHiHi; uniform vec3 uHiTint;
  vec3 fluffyNormal(vec3 w, vec3 c, vec3 k) {
    vec3 a = w - c, b = w - k;
    return normalize(mix(a / max(length(a), 1e-3), b / max(length(b), 1e-3), uCrownMix));
  }
  // deep in a clump = in its own shade (fluffytree's cards behind the outer ones are dark): the toon light's sunVis
  float fluffyVis(vec3 w, vec3 c, float R) { return mix(uInnerVis, 1.0, smoothstep(0.2, 0.62, length(w - c) / max(R, 1e-3))); }
  // fluffytree's second ramp: smoothstep(highlightStart, highlightEnd, light . fromCentre) toward the lit colour
  vec3 fluffyHighlight(vec3 col, vec3 N, vec3 L, vec3 sunCol) {
    float h = smoothstep(uHiLo, uHiHi, dot(N, L));
    return mix(col, min(col * uHiTint, vec3(0.97)), h * clamp(dot(sunCol, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0));
  }
`;
