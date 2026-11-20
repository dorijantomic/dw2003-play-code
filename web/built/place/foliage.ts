// PLACEMENT of the foliage (data only, no geometry, no material): where the broadleaf trees, pines and bushes stand.
// From the recipe: one tree per copy of the picture on each pine / tree / treeline card (a tree line's picture holds a
// row: trees about half a tree height apart), and bushes every ~350 units along the bank strips' top edge.
// KEEP-OUT (place): no plant whose keep-out spheres (the BOUND asset's shape) come within the fight radius, and none
// inside a view cone from any eye ring to a fighter; a plant that fails at its recipe spot is pushed straight outward
// (up to one plant height, 10 steps) and dropped if it still fails; bushes on the bank are never moved.
// The assets (web/built/foliage.js speciesAsset, registry ids mod.broadleaf / mod.pine / mod.bush) know nothing of this.
import { rng, itemsFrom, composeYaw } from "../slots.js";

const SPECIES = [
  ["broadleaf", "Broadleaf trees", "tree"],
  ["pine", "Pines", "tree"],
  ["bush", "Bushes (bank top)", "bush"],
];

/** pctx (web/arena-built.js) -> { slots, candidates, stats, resetStats(), report(), species } */
export function plan(pctx) {
  const { rec, pal, info, S } = pctx;
  pctx.world.add(pctx.foliageGroup);   // the one parent of every foliage mesh (B.foliage)
  const rgb = S.srgb;
  const candidates = { broadleaf: [], pine: [], bush: [] };
  for (const p of rec.pieces) {
    const c = p.colours;
    if (p.kind === "grass") continue;
    if (p.kind === "bank") {
      if (c.green) {
        for (let i = 0; i < p.pos.length; i += 9) {
          const v = [0, 1, 2].map((k) => p.pos.slice(i + k * 3, i + k * 3 + 3)).sort((a, b) => b[1] - a[1]);
          const [a, b] = v; const L = Math.hypot(a[0] - b[0], a[2] - b[2]);
          for (let t = 0; t < L; t += 350) {
            const q = [a[0] + (b[0] - a[0]) * t / L, (a[1] + b[1]) / 2, a[2] + (b[2] - a[2]) * t / L];
            // strips share edges: a spot closer than half the spacing to a bush already there is the same bush
            if (candidates.bush.some((o) => Math.hypot(o.q[0] - q[0], o.q[1] - q[1], o.q[2] - q[2]) < 175)) continue;
            candidates.bush.push({ q, s: 420, seed: candidates.bush.length, piece: p.name, onGround: false });
          }
        }
      }
      info.pieces[p.name] ||= { kind: p.kind, tris: p.tris };
    } else if (p.kind === "pine" || p.kind === "tree" || p.kind === "treeline") {
      const list = p.kind === "pine" ? candidates.pine : candidates.broadleaf;
      // colour of this piece relative to the species' albedo (one material per species; per-instance colour)
      const mid = p.kind === "pine" ? pal.needleMid : pal.crownMid, own = rgb(c.green || c.all);
      const ratio = [own.r / mid.r, own.g / mid.g, own.b / mid.b];
      for (const [ci, card] of p.cards.entries()) {
        const n = p.kind === "treeline" ? Math.max(1, Math.round(card.w / (card.h * 0.45))) : card.copies || 1;
        const out = Math.hypot(card.base[0], card.base[2]) || 1;
        for (let k = 0; k < n; k++) {
          const r = rng(ci * 97 + k * 13 + 5), t = (k + 0.5) / n - 0.5;
          const back = (r() - 0.3) * card.h * 0.25;   // a little in front of / behind the card line
          list.push({ q: [card.base[0] + card.dir[0] * t * card.w + card.base[0] / out * back, card.base[1],
                          card.base[2] + card.dir[1] * t * card.w + card.base[2] / out * back],
                      s: card.h * (0.85 + r() * 0.3), seed: ci * 31 + k, piece: p.name, ratio, onGround: true });
        }
      }
      info.pieces[p.name] = { kind: p.kind, cards: p.cards.length };
    }
  }

  const stats = { round: -1 };
  const resetStats = () => Object.assign(stats, { candidates: 0, accepted: 0, rejectedAtRecipeSpot: 0, moved: 0, dropped: 0, noGround: 0, byReason: { fight: 0, cone: 0 }, list: [] });
  resetStats();
  const shapes = {};
  const slots = SPECIES.map(([name, label, kind]) => ({
    id: "foliage." + name, label, kind, layer: name, parent: pctx.foliageGroup, default: "mod." + name,
    items: itemsFrom([]), native: null, wantsShape: true, windShare: 0.04, placeOrder: 1,
    meshName: (g) => `${name}_s${g}`,
    meshData: (g, idx) => { const it = slotRef[name].cur; return { kind: "foliage", species: name, sector: g, at: idx.map((i) => [it.p[i * 3], it.p[i * 3 + 1], it.p[i * 3 + 2]]), scale: idx.map((i) => it.list[i].s), onGround: idx.map((i) => it.list[i].onGround) }; },
    data: { candidates: candidates[name] },
    place(state, shape) {
      if (!shape) return null;
      shapes[name] = shape;
      const sectors = [[], [], [], []];
      for (const it of candidates[name]) {
        stats.candidates++;
        const out = Math.hypot(it.q[0], it.q[2]) || 1, ux = it.q[0] / out, uz = it.q[2] / out;
        let ok = null, first = true, lastWhy = null;
        it.yaw = rng(it.seed + 1)() * Math.PI * 2;
        for (let push = 0; push <= 1.0001; push += 0.1) {
          const x = it.q[0] + ux * push * it.s, z = it.q[2] + uz * push * it.s;
          const y = it.onGround ? pctx.ko.groundHeight(x, z) : it.q[1];
          if (y == null) { if (push === 0) stats.noGround++; lastWhy = "offGround"; (it.seq ||= []).push("offGround"); first = false; if (!it.onGround) break; continue; }
          const why = pctx.ko.rejectReason(pctx.ko.worldBands(shape, [x, y, z], it.s, it.yaw));
          lastWhy = why; (it.seq ||= []).push(why);
          if (!why) { ok = { x, y, z, push }; break; }
          if (first) { stats.rejectedAtRecipeSpot++; stats.byReason[why]++; }
          first = false;
          if (!it.onGround) break;   // bushes sit on the bank's top edge: never moved
        }
        stats.list.push([name, it.piece, Math.round(Math.hypot(it.q[0], it.q[2])), ok ? +ok.push.toFixed(1) : (first ? "noGround" : "dropped"), lastWhy, (it.seq || []).join(",")]); it.seq = null;
        if (!ok) { if (!first) stats.dropped++; continue; }
        if (ok.push > 0) stats.moved++;
        stats.accepted++;
        const az = Math.atan2(ok.z, ok.x), sector = ((Math.floor((az + Math.PI) / (Math.PI / 2)) % 4) + 4) % 4;
        sectors[sector].push({ ...it, at: [ok.x, ok.y, ok.z] });
      }
      // exact transforms for the default asset (its units: the species geometry); h / rad = the plant's world size
      const H = shape.box.max[1] - shape.box.min[1], R = 0.5 * Math.max(shape.box.max[0] - shape.box.min[0], shape.box.max[2] - shape.box.min[2]);
      const list = [];
      for (const [si, l] of sectors.entries()) for (const it of l) {
        const r = rng(it.seed + 1); r();   // first draw = the yaw (it.yaw)
        const v = 0.92 + r() * 0.16, ra = it.ratio || [1, 1, 1];   // a little light/dark variety per plant
        list.push({ p: it.at, yaw: it.yaw, h: it.s * H, rad: it.s * R, grp: si, s: it.s, onGround: it.onGround,
                    m: composeYaw(it.at, it.yaw, it.s), col: [ra[0] * v, ra[1] * v, ra[2] * v] });
      }
      return itemsFrom(list);
    },
  }));
  const slotRef = Object.fromEntries(SPECIES.map(([name], i) => [name, slots[i]]));
  // B.species[name]: what is bound in that slot now (geometry, material, keep-out shape)
  const species = {};
  for (const [name] of SPECIES) Object.defineProperty(species, name, { enumerable: true, get() {
    const s = slotRef[name], a = s.asset, sh = shapes[name] || null, part = a?.parts?.[0];
    return part ? { geo: part.geo, mat: part.mat, bands: sh?.bands || [], tris: sh?.tris ?? 0, box: sh?.box || null, asset: a.id } : null;
  } });
  function report() {
    for (const [name] of SPECIES) info.instances[name] = slotRef[name].cur?.n ?? 0;
    const meshes = pctx.foliageGroup.children;
    info.foliage = {
      species: Object.fromEntries(SPECIES.filter(([n]) => species[n]).map(([n]) => { const sp = species[n]; return [n, { trisPerPlant: sp.tris, cards: sp.geo.userData.cards, bands: sp.bands.map((g) => ({ c: g.c, r: g.r, tris: g.tris.length })), box: sp.box }]; })),
      meshes: meshes.length,
      triangles: meshes.reduce((s, m) => s + m.count * (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0),
    };
  }
  return { slots, candidates, stats, resetStats, report, species };
}

