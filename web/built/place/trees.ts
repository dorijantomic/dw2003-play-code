// PLACEMENT of meft1008's tree ring and far pines (data only): where every cypress, grove tree, shrub and far pine
// stands, how tall / wide it is, its yaw and its colour (the piece's own measured colour over the species' first
// piece, x a little variety). From the recipe's cards above the floor (each floor piece also holds its lake copy,
// never built). The SHAPE numbers (spacing, heights, crown radius) are the fitted ones of web/built/trees.js.
// Slots: trees.wall, trees.grove, trees.shrub (the fluffy shrub + its solid core, one composite), trees.far (4 pine
// variants = 4 groups). All under one group "builtTreeRing". Defaults: mod.cypress_wall / mod.cypress_grove /
// mod.shrub / mod.far_pines (web/built/trees.js factories). The ring stands far outside the fight: never moved by the
// keep-out, only reported (keepOutTouching).
import { rng, itemsFrom, composeYaw } from "../slots.js";
import { WALL, GROVE, SHRUB, PINE, FAR, GUST } from "../trees.js";
const M = 400;

/** The ring's plan, in render units: every card above the floor merged by ground spot (the recipe cuts some cards
 *  into a low and a high quad), then trees / shrubs along each card. Pure numbers (the checker re-uses it). */
export function planRing(pieces) {
  const cards = [];
  for (const p of pieces) {
    for (const c of p.cards || []) {
      if (c.base[1] < -1) continue;   // never a lake copy (the recipe gives none for these kinds; belt and braces)
      const same = cards.find((o) => o.piece === p.name && Math.hypot(o.c[0] - c.base[0], o.c[1] - c.base[2]) < 50);
      if (same) { same.top = Math.max(same.top, c.base[1] + c.h); same.w = Math.max(same.w, c.w); continue; }
      cards.push({ piece: p.name, kind: p.kind, c: [c.base[0], c.base[2]], dir: c.dir, w: c.w, top: c.base[1] + c.h });
    }
  }
  const trees = [], shrubs = [];
  for (const [ci, cd] of cards.entries()) {
    const r = Math.hypot(cd.c[0], cd.c[1]) || 1, u = [cd.c[0] / r, cd.c[1] / r];
    const R = rng(1008 + ci * 131);
    const at = (t, dr) => [cd.c[0] + cd.dir[0] * t * cd.w + u[0] * dr * M, cd.c[1] + cd.dir[1] * t * cd.w + u[1] * dr * M];
    const wM = cd.w / M;
    if (cd.kind === "cypress_wall") {
      const S = WALL, n = Math.max(1, Math.round(wM / S.spacing));
      for (let k = 0; k < n; k++) {
        const H = S.H0 + R() * S.HR;
        trees.push({ species: "wall", piece: cd.piece, card: ci, xz: at((k + 0.5) / n - 0.5 + (R() - 0.5) * 0.1 / n, -S.depth / 2 + (R() - 0.5) * 0.3), H, Rm: S.Rm });
        const H2 = S.H0 - S.backDrop + R() * S.HR;
        trees.push({ species: "wall", piece: cd.piece, card: ci, xz: at((k + 1) / n - 0.5, S.depth / 2), H: H2, Rm: S.Rm });
      }
    } else {
      const S = GROVE, n = Math.max(1, Math.round(wM / S.spacing));
      for (let k = 0; k < n; k++)
        trees.push({ species: "grove", piece: cd.piece, card: ci, xz: at((k + 0.5) / n - 0.5 + (R() - 0.5) * 0.15 / n, S.out), H: S.H0 + R() * S.HR, Rm: S.Rm });
      const ns = Math.max(1, Math.round(wM / SHRUB.spacing));
      for (let k = 0; k < ns; k++) {
        const H = SHRUB.H0 + R() * SHRUB.HR;
        shrubs.push({ species: "shrub", piece: cd.piece, card: ci, xz: at((k + 0.5) / ns - 0.5 + (R() - 0.5) * 0.2 / ns, -SHRUB.front), H, Rm: SHRUB.radiusK * H });
      }
    }
  }
  return { cards, trees, shrubs };
}

/** The top height (m) of the pine at azimuth az (rad, atan2(x, z)); S (web/built/shared.js) supplies the shared noise. */
export function farTop(az, S) {
  const c = Math.cos(az), s = Math.sin(az);
  const g = S.fbm3JS(c * 2.6, 1.7, s * 2.6);                 // groups of tall / short trees
  const w = S.noise3JS(c * 7.7 - 2.3, 5.5, s * 7.7 + 4.1);   // one slower wobble
  return FAR.CENTRE + (g - 0.5) * FAR.GROUP + (w - 0.5) * FAR.WOBBLE;
}

/** The far pines' plan from the recipe piece (pure numbers; the checker re-uses it). R = ring radius in RENDER UNITS,
 *  Rm in metres. trees: [{az (rad), r (render units), x, z, H (m), Rc (crown radius, m), variant, yaw}]. */
export function planFar(piece, S) {
  const cards = piece.cards || [];
  const hasRing = piece.rmax != null && piece.ymax != null;
  const R = hasRing ? piece.rmax : Math.max(...cards.map((c) => Math.hypot(c.base[0], c.base[2])));
  const Rm = R / 400;
  const rows = (piece.rows || []).map((r) => (r ? r.rgb : null));   // top first: 0 sky .. 2 lit tips .. 6 darkest .. 7 foot
  const greens = rows.length >= 8 && rows[2] && rows[4] && rows[6]
    ? { lo: rows[6], mid: rows[4], hi: rows[2], source: "recipe rows" }
    : { lo: piece.colours.p10 || piece.colours.all, mid: piece.colours.green || piece.colours.all, hi: piece.colours.all, source: "piece colours" };
  const n = Math.round(2 * Math.PI * Rm / (PINE.SPACING_K * PINE.RM * FAR.CENTRE));
  const r = (() => { let s = 1008 * 7 + 5; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const trees = [];
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const az = ((i + (r() - 0.5) * 0.22) / n) * Math.PI * 2;
    let H = Math.min(FAR.HI, Math.max(FAR.LO, farTop(az, S) + (r() - 0.5) * FAR.JITTER));
    if (H >= FAR.HI - 1e-6) H -= r() * 0.5; else if (H <= FAR.LO + 1e-6) H += r() * 0.5;   // trees at a clamp are not all the same height
    let variant = Math.floor(r() * PINE.VARIANTS); if (variant === prev) variant = (variant + 1) % PINE.VARIANTS; prev = variant;
    const rr = R + (r() - 0.5) * 2 * PINE.RADIAL * 400;
    trees.push({ az, r: rr, x: Math.sin(az) * rr, z: Math.cos(az) * rr, H, Rc: PINE.RM * H * (0.92 + r() * 0.18), variant, yaw: r() * Math.PI * 2 });
  }
  // the tallest tree of each variant reaches the measured maximum (so every variant's mirrored copy hangs the full 7.32 m)
  for (let v = 0; v < PINE.VARIANTS; v++) {
    const mine = trees.filter((t) => t.variant === v);
    if (!mine.length) continue;
    const top = mine.reduce((a, b) => (b.H > a.H ? b : a));
    if (top.H < FAR.HI - 0.01) { top.H = FAR.HI - 0.005; top.Rc = PINE.RM * top.H; }
  }
  return { R, Rm, n, greens, rows, trees, hasRows: rows.length >= 8 };
}


const sectorOf = (x, z) => { const az = Math.atan2(z, x); return ((Math.floor((az + Math.PI) / (Math.PI / 2)) % 4) + 4) % 4; };

export function plan(pctx) {
  const { S, pieces: P, slots: api } = pctx;
  const pieces = [...P("cypress_wall"), ...P("cypress_grove")];
  const farPieces = P("far_pines");
  if (!pieces.length && !farPieces.length) return null;
  const t0 = performance.now();
  if (pieces.length) S.U.uWindRing.value = GUST;   // this arena's trees and grass share the travelling gust (reset to 0 per arena build)
  const ring = planRing(pieces);
  const lin = (c) => S.srgb(c);
  const midOf = (p) => lin(p.colours.green || p.colours.all);
  const first = (kind) => pieces.find((p) => p.kind === kind);
  const ratio = (p, base) => { const a = midOf(p), b = midOf(base); return [a.r / b.r, a.g / b.g, a.b / b.b]; };
  const byPiece = Object.fromEntries(pieces.map((p) => [p.name, p]));
  const group = pctx.newGroup("builtTreeRing");   // the ring's one parent
  const wallP = first("cypress_wall"), groveP = first("cypress_grove");
  const instances = [];
  /** items of one species: by 90 deg sector, the exact transform made for the default asset's geometry */
  function ringItems(name, list, base, geoRm, inst = [name]) {
    const sectors = [[], [], [], []];
    for (const it of list) sectors[sectorOf(it.xz[0], it.xz[1])].push(it);
    const out = [];
    for (const [si, L] of sectors.entries()) for (const it of L) {
      const r = rng(Math.round(it.xz[0] * 7 + it.xz[1] * 13) >>> 0);
      const yaw = r() * Math.PI * 2, H = it.H * M;
      const sxz = geoRm ? it.Rm * M / geoRm : H;   // cypress: radius from the geometry's own Rm; shrub: uniform
      const ra = ratio(byPiece[it.piece], base), v = 0.93 + r() * 0.14;
      out.push({ p: [it.xz[0], 0, it.xz[1]], yaw, h: H, rad: it.Rm * M, grp: si, m: composeYaw([it.xz[0], 0, it.xz[1]], yaw, sxz, H, sxz), col: [ra[0] * v, ra[1] * v, ra[2] * v] });
    }
    for (const nm of inst) for (const [si, L] of sectors.entries()) for (const it of L) instances.push({ species: nm, piece: it.piece, card: it.card, x: it.xz[0], z: it.xz[1], H: it.H, Rm: it.Rm, sector: si });
    return itemsFrom(out);
  }
  const geoRm = (sh) => { const k = 1 / (sh.H0 + sh.HR / 2); return sh.Rm * k; };   // cypressGeometry's userData.Rm
  const partName = (name, pi) => (pi ? (pi > 1 ? "core" + pi : "core") : name);
  const ringSlot = (name, label, items, colours) => ({
    id: "trees." + name, label, kind: name === "shrub" ? "bush" : "tree", layer: "ring_" + name, parent: group, default: "mod." + (name === "shrub" ? "shrub" : "cypress_" + name),
    items, data: { colours },
    meshName: (g, part, pi) => `ring_${partName(name, pi)}_s${g}`,
    meshData: (g, idx, part, pi) => ({ kind: "foliage", ring: true, species: partName(name, pi), sector: g }),
  });
  const slots = [];
  if (wallP) slots.push(ringSlot("wall", "Cypress wall", ringItems("wall", ring.trees.filter((t) => t.species === "wall"), wallP, geoRm(WALL)), wallP.colours));
  if (groveP) {
    slots.push(ringSlot("grove", "Cypress grove", ringItems("grove", ring.trees.filter((t) => t.species === "grove"), groveP, geoRm(GROVE)), groveP.colours));
    slots.push(ringSlot("shrub", "Shrubs (grove foot)", ringItems("shrub", ring.shrubs, groveP, 0, ["shrub", "core"]), groveP.colours));
  }
  let fplan = null;
  if (farPieces.length) {
    fplan = planFar(farPieces[0], S);
    const out = [];
    for (let v = 0; v < PINE.VARIANTS; v++) for (const t of fplan.trees.filter((q) => q.variant === v)) {
      const rr = rng(Math.round(t.az * 1000) + 77), sx = t.Rc * M / PINE.RM;
      const j = 0.92 + rr() * 0.16;
      out.push({ p: [t.x, 0, t.z], yaw: t.yaw, h: t.H * M, rad: t.Rc * M, grp: v, m: composeYaw([t.x, 0, t.z], t.yaw, sx, t.H * M, sx),
                 col: [j * (0.96 + rr() * 0.08), j, j * (0.94 + rr() * 0.1)] });   // per-tree value and a little hue drift
    }
    slots.push({ id: "trees.far", label: "Far pines", kind: "tree", layer: "builtFarPines", parent: group, default: "mod.far_pines",
                 items: itemsFrom(out), data: { greens: fplan.greens, plan: fplan },
                 meshName: (g) => `builtFarPines_v${g}`, meshData: (g) => ({ kind: "farPines", far: true, variant: g, radius: fplan.R }) });
  }
  const ringIds = slots.filter((s) => s.id !== "trees.far").map((s) => s.id);
  const ringMeshes = () => ringIds.flatMap((id) => api.meshesOf(id));
  const farMeshes = () => api.meshesOf("trees.far");
  const refl = (m) => ({ name: m.name, species: m.userData.species, geometry: m.geometry, material: m.material, instanceMatrix: m.instanceMatrix, instanceColor: m.instanceColor, count: m.count });
  const triOf = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  let out = null;
  const layer = {
    get meshes() { return ringMeshes(); },
    get info() { return out; },
    instances,   // [{species, piece, card, x, z (render units), H, Rm (m), sector}]
    // for the lake reflection: the SAME geometry, material and instance matrices of what is bound now
    get reflection() {
      const fm = farMeshes();
      return { group, meshes: ringMeshes().map(refl), far: fm.length ? { meshes: fm.map((m) => { const { species, ...q } = refl(m); return q; }), radiusM: +fplan.Rm.toFixed(3) } : null };
    },
    place(state) {   // report only: does any ring plant touch the fight radius or a view cone seen so far?
      let rejected = 0;
      for (const it of instances) {   // four spheres up the plant, each as wide as the crown
        const rr = Math.max(it.H * M / 8, it.Rm * M);
        if ([0.125, 0.375, 0.625, 0.875].some((f) => pctx.keepOut.reject([it.x, it.H * M * f, it.z], rr))) rejected++;
      }
      if (out) { out.keepOutTouching = rejected; out.keepOutFightR = Math.round(state?.fightR ?? 0); }
    },
  };
  function report() {   // the numbers of what is bound (info.trees)
    const meshes = ringMeshes(), fm = farMeshes(), farA = api.get("trees.far")?.asset;
    const species = {};
    for (const id of ringIds) { const a = api.get(id).asset; const nm = id.slice(6); (a?.parts || []).forEach((p, pi) => { species[partName(nm, pi)] = p.geo; }); }
    let far = null;
    if (fplan) {
      const tops = fplan.trees.map((t) => t.H).sort((a, b) => a - b);
      const q = (p) => +tops[Math.min(tops.length - 1, Math.floor(p * tops.length))].toFixed(3);
      const geos = (farA?.variants || [farA?.parts || []]).map((v) => v[0]?.geo).filter(Boolean);
      far = { trees: fplan.trees.length, tris: fm.reduce((s, m) => s + m.count * triOf(m.geometry), 0),
              trisPerTree: geos.map((g) => g.userData?.tris), whorls: geos.map((g) => g.userData?.whorls),
              r: +fplan.Rm.toFixed(3), tops: { min: q(0), p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(0.999999) },
              draws: fm.length, greens: fplan.greens, source: fplan.greens.source };
    }
    out = {
      cards: ring.cards.map((c) => ({ piece: c.piece, kind: c.kind, az: +(Math.atan2(c.c[0], c.c[1]) * 180 / Math.PI).toFixed(2),
                                       r: +(Math.hypot(...c.c) / M).toFixed(3), w: +(c.w / M).toFixed(3), top: +(c.top / M).toFixed(3) })),
      counts: Object.fromEntries(Object.keys(species).map((k) => [k, instances.filter((i) => i.species === k).length])),
      trisPerPlant: Object.fromEntries(Object.entries(species).map(([k, g]) => [k, triOf(g)])),
      triangles: meshes.reduce((s, m) => s + m.count * triOf(m.geometry), 0), meshes: meshes.length, gust: GUST, buildMs: Math.round(performance.now() - t0),
      far,
    };
    pctx.info.trees = out;
  }
  return { slots, layer, after: report, afterPlace: (st) => layer.place(st) };
}
