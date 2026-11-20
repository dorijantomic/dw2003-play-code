// PLACEMENT of the grass blades (data only, no geometry, no material): where each blade stands on the arena's ground
// surfaces (the ground placement's grass pieces, read against its paint mask, and the sand placement's shore band,
// read against its measured greenness), its yaw, width, height, and its colours (root = the ground's own albedo there,
// mid / tip toward the blade's palette colour), curl / twist / phase and the ground normal. Area-weighted, inside
// GRASS.RADIUS, never on dirt / path / rock / cliff paint. Slot: grass.blades. Default mod.grass (web/built/grass.js).
import * as S from "../shared.js";
import { GRASS, groundAlbedo } from "../grass.js";
import { itemsFrom, composeYaw } from "../slots.js";

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function plan(pctx) {
  const { rec, info } = pctx, t0 = performance.now();
  // the surfaces, in the order the ground meshes stand: the ground pieces (+ apron), then the sand pieces
  const G = pctx.plans.ground?.data, sand = pctx.slots.get("sand.ground")?.data;
  const surfaces = [];
  for (const p of G?.pieces || []) surfaces.push({ name: p.name, pos: p.pos, mask: p.kind === "grass" ? G.maskReader : null, green: null, blade: null });
  for (const p of sand?.pieces || []) surfaces.push({ name: p.name, pos: p.pos, mask: null, green: p.green || null, blade: p.blade || null });
  const tris = [];   // { a, b, c, n (up), area, piece colours }
  const masks = new Map();
  let effArea = 0;   // the surface the blades can actually grow on (a shore counts only its green share)
  for (const sf of surfaces) {
    const piece = rec.pieces.find((p) => p.name === sf.name), c = piece?.colours || {};
    const mask = sf.mask, green = sf.green;
    if (!mask && !green) continue;   // an unmarked surface (sand, sea): no blades
    masks.set(sf.name, mask);
    const bc = green && sf.blade;   // the shore's own measured greens; a grass arena keeps its palette
    const lo = S.srgb(bc?.p10 || c.p10 || [90, 120, 60]), hi = S.srgb(bc?.p90 || c.p90 || [110, 150, 80]);
    const P = sf.pos;
    for (let i = 0; i < P.length; i += 9) {
      const a = [P[i], P[i + 1], P[i + 2]], b = [P[i + 3], P[i + 4], P[i + 5]], cc = [P[i + 6], P[i + 7], P[i + 8]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(...n); if (L < 1e-9) continue;
      n = n.map((x) => x / L); if (n[1] < 0) n = n.map((x) => -x);   // the face normal, turned to point up
      const vi = i / 3;
      const g3 = green ? [green[vi], green[vi + 1], green[vi + 2]] : null;
      effArea += (L / 2) * (g3 ? (g3[0] + g3[1] + g3[2]) / 3 : 1);
      tris.push({ a, b, c: cc, n, area: L / 2, lo, hi, mesh: sf.name, index: i / 9, green: g3 });
    }
  }
  if (!tris.length) { info.grass = { blades: 0, note: "no grass surface in this arena" }; return null; }
  const cum = new Float64Array(tris.length); let tot = 0;
  tris.forEach((t, i) => { tot += t.area; cum[i] = tot; });
  const pickTri = (x) => { let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return lo; };

  // blades per unit of surface, so a small surface (a beach's green fringe) gets a proportional count, not 450k
  const N = Math.min(GRASS.COUNT, Math.max(GRASS.MIN_COUNT, Math.round(GRASS.DENSITY * effArea)));
  const r = rng(GRASS.SEED), R = GRASS.RADIUS;
  const mats = new Float32Array(N * 16), pp = new Float32Array(N * 3), yawA = new Float32Array(N), hA = new Float32Array(N), radA = new Float32Array(N);
  const root = new Float32Array(N * 3), mid = new Float32Array(N * 3), tip = new Float32Array(N * 3), gn = new Float32Array(N * 3);
  const blade = new Float32Array(N * 3), triOf = new Int32Array(N), bary = new Float32Array(N * 3), maskAt = new Float32Array(N * 4);
  let made = 0, tries = 0, offPaint = 0;
  while (made < N && tries < N * 60) {
    tries++;
    const ti = pickTri(r() * tot), t = tris[ti];
    const s1 = Math.sqrt(r()), s2 = r();
    const w = [1 - s1, s1 * (1 - s2), s1 * s2];   // uniform barycentric point
    const p = [0, 1, 2].map((k) => w[0] * t.a[k] + w[1] * t.b[k] + w[2] * t.c[k]);
    const rad = Math.hypot(p[0], p[2]), yaw = r() * Math.PI * 2, hr = r(), wr = r(), keep = r();
    const cr = r(), tw = r(), ph = r(), vr = r();
    if (rad > R) continue;   // rejection keeps the density area-weighted inside the radius
    // only where the ground paints GRASS (not dirt, path, rock, cliff); thinner and shorter toward a paint edge
    const mk = masks.get(t.mesh), m = mk ? mk.sample(p[0], p[2]) : { dirt: 0, rock: 0, path: 0, ao: 1 };
    if (mk && 1 - t.n[1] >= mk.cliffLo) { offPaint++; continue; }
    // green share: the ground's own paint on a grass arena, the shore's measured picture row on a beach
    const g = t.green ? w[0] * t.green[0] + w[1] * t.green[1] + w[2] * t.green[2]
                      : 1 - smooth(GRASS.MASK_EDGE[0], GRASS.MASK_EDGE[1], Math.max(m.dirt, m.rock, m.path));
    if (t.green ? g <= GRASS.GREEN_MIN : keep >= g) { offPaint++; continue; }
    const gk = t.green ? smooth(GRASS.GREEN_MIN, GRASS.GREEN_FULL, g) : g;
    const h = (GRASS.H[0] + (GRASS.H[1] - GRASS.H[0]) * hr) * smooth(R, R * GRASS.EDGE, rad) * (0.55 + 0.45 * gk);
    const wd = GRASS.W[0] + (GRASS.W[1] - GRASS.W[0]) * wr;
    mats.set(composeYaw(p, yaw, wd, Math.max(h, 1e-3), wd), made * 16);
    pp.set(p, made * 3); yawA[made] = yaw; hA[made] = Math.max(h, 1e-3); radA[made] = wd / 2;
    // colours: root = the ground's own albedo there (grass pattern x the ground's AO), so the root vanishes into it
    const ao = mk ? 1 + (m.ao - 1) * mk.aoAmt : 1;
    const pc = t.green ? [t.lo.r + (t.hi.r - t.lo.r) * vr, t.lo.g + (t.hi.g - t.lo.g) * vr, t.lo.b + (t.hi.b - t.lo.b) * vr]
                       : groundAlbedo(t.lo, t.hi, p);
    const rc = pc.map((x) => x * ao);
    const lo = [t.lo.r, t.lo.g, t.lo.b], hi = [t.hi.r, t.hi.g, t.hi.b];
    root.set(rc, made * 3);
    for (let k = 0; k < 3; k++) {
      const own = lo[k] + (hi[k] - lo[k]) * vr;                  // this blade's own palette colour
      mid[made * 3 + k] = pc[k] + (own - pc[k]) * GRASS.VAR;
      tip[made * 3 + k] = mid[made * 3 + k] + (hi[k] * GRASS.TIP_LIFT - mid[made * 3 + k]) * GRASS.TIP_MIX;
    }
    blade.set([GRASS.CURL[0] + (GRASS.CURL[1] - GRASS.CURL[0]) * cr, GRASS.TWIST[0] + (GRASS.TWIST[1] - GRASS.TWIST[0]) * tw, ph * Math.PI * 2], made * 3);
    gn.set(t.n, made * 3); triOf[made] = ti; bary.set(w, made * 3);
    maskAt.set([m.dirt, m.rock, m.path, m.ao], made * 4);
    made++;
  }
  const cut = (a, k) => a.subarray(0, made * k);
  const items = { n: made, p: cut(pp, 3), yaw: cut(yawA, 1), h: cut(hA, 1), rad: cut(radA, 1), m: cut(mats, 16),
                  attrs: { aRoot: { size: 3, array: cut(root, 3) }, aMid: { size: 3, array: cut(mid, 3) }, aTip: { size: 3, array: cut(tip, 3) },
                           aGroundN: { size: 3, array: cut(gn, 3) }, aBlade: { size: 3, array: cut(blade, 3) } } };
  const blades = { triOf, bary, tris, maskAt };
  const slot = {
    id: "grass.blades", label: "Grass blades", kind: "grass", layer: "grass_blades", default: "mod.grass", items, frustumCulled: false,
    data: { fighters: () => pctx.opts.keepOut?.()?.fighters || [] },
    meshName: () => "grass_blades",
    meshData: () => ({ kind: "grassBlades", ...blades, params: GRASS }),
  };
  const stats = { blades: made, target: N, effArea: Math.round(effArea), density: GRASS.DENSITY, tries, offPaint, masked: [...masks.values()].some(Boolean) };
  function after() {   // info.grass: what is placed, and the bound asset's triangles
    const geo = pctx.slots.get(slot.id)?.asset?.parts?.[0]?.geo;
    const tpb = geo ? (geo.index ? geo.index.count : geo.attributes.position.count) / 3 : 0;
    info.grass = { ...stats, trianglesPerBlade: tpb, verticesPerBlade: geo?.attributes.position.count ?? 0,
                   triangles: made * tpb, groundTriangles: tris.length, radius: R, ms: Math.round(performance.now() - t0) };
  }
  return { slots: [slot], after };
}
