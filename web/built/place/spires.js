// PLACEMENT of the cliff spires (data only, no geometry, no material): the wall panels and sea islands of every recipe
// spire card (where, how tall, how many pillars, their tones, lean, skirt), measured against the arena's ground (the
// bound ground surfaces: pctx.groundMeshes) and the recipe's water pieces; then the KEEP-OUT (place): each group is
// pushed straight outward until it clears the fight radius and every view cone, or dropped. The rock / shrub / card
// geometry is the asset's (web/built/spires.js buildSpires, registry mod.spires): a group's parts name their pillar
// template (tplKind, tplIdx), the asset owns the templates.
import { SPIRE } from "../spires.js";
import * as S0 from "../shared.js";
import * as F from "../../lib3d/fluffytree/fluffy.js";   // rng only
import { itemsFrom } from "../slots.js";

/** A piece's wall lean, measured from its own triangles: the slope of the minimum-radius envelope (the nearest wall
 *  face) across the piece's wall height. The minimum is always the wall - the sea cards of the same piece sit farther
 *  out - so this reads the wall's batter without guessing. */
function measuredLean(piece, baseY, topY) {
  const a = piece.pos || [];
  if (!a.length || !(topY > baseY)) return 0;
  const NB = 6, lo = new Array(NB).fill(Infinity);
  for (let i = 0; i + 3 <= a.length; i += 3) {
    const y = a[i + 1];
    const b = Math.min(NB - 1, Math.max(0, Math.floor((y - baseY) / (topY - baseY) * NB)));
    lo[b] = Math.min(lo[b], Math.hypot(a[i], a[i + 2]));
  }
  const pts = [];
  for (let b = 0; b < NB; b++) if (Number.isFinite(lo[b])) pts.push([baseY + (topY - baseY) * (b + 0.5) / NB, lo[b]]);
  if (pts.length < 3) return 0;
  const [y0, r0] = pts[0], [y1, r1] = pts[pts.length - 1];
  return Math.max(0, Math.min(0.30, y1 > y0 ? (r1 - r0) / (y1 - y0) : 0));
}

/** Everything the builder needs, measured once: the wall panels and the sea islands of every recipe card, the water and
 *  ground numbers, and what was skipped (and why). */
function prepare(pctx) {
  const P = SPIRE;
  const pieces = pctx.pieces("spire")
    .filter((p) => (p.cards || []).length);
  if (!pieces.length) return null;
  const recipeRmin = Math.min(...pieces.map((p) => (p.rmin ?? Infinity)));
  const ground = pctx.groundMeshes();

  // ---- the water and the sea, measured (their surface, their floors, and the triangles the island test reads) ----
  const waterPieces = (pctx.rec?.pieces || []).filter((p) => p.kind === "water" || p.kind === "sea");
  let waterTop = -Infinity, waterFloor = Infinity, seaFloor = Infinity;
  const waterTris = [];
  for (const w of waterPieces) {
    const a = w.pos; if (!a || !a.length) continue;
    for (let i = 0; i + 9 <= a.length; i += 9) {
      waterTris.push([a[i], a[i + 2], a[i + 3], a[i + 5], a[i + 6], a[i + 8]]);
      for (let k = 1; k < 9; k += 3) {
        waterTop = Math.max(waterTop, a[i + k]);
        if (w.kind === "water") waterFloor = Math.min(waterFloor, a[i + k]);
        else seaFloor = Math.min(seaFloor, a[i + k]);
      }
    }
  }
  const floorY = Number.isFinite(waterFloor) ? waterFloor : (Number.isFinite(seaFloor) ? seaFloor : null);

  /** the highest sand/shore vertex within rad of (x, z): what the arena's own ground reaches at this spot */
  function groundPatch(x, z, rad) {
    let n = 0, top = -Infinity;
    for (const m of ground) {
      const a = m.geometry?.attributes?.position; if (!a) continue;
      for (let i = 0; i < a.count; i++) {
        const dx = a.getX(i) - x, dz = a.getZ(i) - z;
        if (dx * dx + dz * dz > rad * rad) continue;
        n++; top = Math.max(top, a.getY(i));
      }
    }
    return { n, top };
  }
  /** xz distance from (x, z) to the nearest water/sea triangle: 0 inside one, else the nearest edge */
  function waterDist(x, z) {
    let best = Infinity;
    for (const t of waterTris) {
      const ax = t[0], az = t[1], bx = t[2], bz = t[3], cx = t[4], cz = t[5];
      const side = (px, pz, qx, qz) => (x - qx) * (pz - qz) - (px - qx) * (z - qz);
      const d1 = side(ax, az, bx, bz), d2 = side(bx, bz, cx, cz), d3 = side(cx, cz, ax, az);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0;   // inside a water triangle
      for (let k = 0; k < 3; k++) {
        const px = t[k * 2], pz = t[k * 2 + 1], qx = t[((k + 1) % 3) * 2], qz = t[((k + 1) % 3) * 2 + 1];
        const dx = qx - px, dz = qz - pz, L = dx * dx + dz * dz;
        const u = L > 1e-9 ? Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / L)) : 0;
        const ex = x - (px + dx * u), ez = z - (pz + dz * u);
        best = Math.min(best, ex * ex + ez * ez);
      }
    }
    return Math.sqrt(best);
  }

  // ---- templates: each pillar names one of four wall shapes / three island shapes (the asset makes them) ----

  const groups = [], walls = [], islands = [], skipped = [];
  const rnd0 = F.rng(P.SEED);

  for (const p of pieces) {
    const col = p.colours || {};
    const pale = S0.srgb(col.p90 || col.other || col.all || [194, 180, 211]);
    const mid = S0.srgb(col.other || col.p90 || col.all || [131, 118, 146]);
    const dark = S0.srgb(col.p10 || col.all || [28, 33, 20]);
    const green = S0.srgb(col.green || [55, 71, 36]);
    const cards = p.cards || [];
    // the piece's wall height range: its tallest card base up to that card's top
    const baseYs = cards.map((c) => c.base[1]);
    const wallBase = Math.max(...baseYs);
    const wallTop = Math.max(...cards.filter((c) => c.base[1] === wallBase).map((c) => c.base[1] + c.h));
    const lean = measuredLean(p, wallBase, wallTop);

    for (const [ci, card] of cards.entries()) {
      const b = card.base, w = card.w, h = card.h;
      const rCard = Math.hypot(b[0], b[2]) || 1;
      const az = Math.atan2(b[0], b[2]);
      const span = 2 * Math.atan2(w / 2, rCard);
      const patch = groundPatch(b[0], b[2], P.GROUND_PATCH);
      const onSand = patch.n > 0 && Math.abs(patch.top - b[1]) <= P.GROUND_TOL;
      const wd = onSand || !waterTris.length ? Infinity : waterDist(b[0], b[2]);
      const inWater = !onSand && Number.isFinite(waterTop) && Math.abs(b[1] - waterTop) <= P.GROUND_TOL && wd <= P.WATER_PATCH;
      if (!onSand && !inWater) {
        skipped.push({ piece: p.name, card: ci, r: Math.round(rCard), baseY: b[1], ground: patch.n ? patch.top : null,
                       water: Number.isFinite(wd) ? Math.round(wd) : null,
                       why: patch.n ? "not on the shore" : (waterTris.length ? "neither shore nor water under it" : "no shore or water under it") });
        continue;
      }
      const wall = onSand;
      const pitch = h * (wall ? P.PILLAR_W_K : P.ISLAND_W_K);
      // pillars per panel: the panel's own width over the pitch, but never fewer than MIN_PER_PANEL (a narrow card
      // would otherwise round to one pillar). The `|| 1` is the guard that matters: a pitch that came out 0 or
      // undefined must fall back to ONE pillar, never to NaN - NaN here used to poison n, arcPitch, R, the panel's
      // axis AND its mass's column count, i.e. 96 of the 208 card vertices and every rock vertex.
      const n = Math.max(wall ? P.MIN_PER_PANEL : 1, Math.round(w / pitch) || 1);
      const arcPitch = (span * rCard) / n;
      const R = (arcPitch / 2) * P.PACK;
      const skirt = wall ? P.WALL_SKIRT
                         : Math.max(0, b[1] - ((floorY ?? b[1] - 400) - P.STACK_SKIRT_BURY));
      const rGroup = wall ? Math.max(rCard, recipeRmin + R + P.MARGIN) : rCard;
      const g = { id: groups.length, kind: wall ? "wall" : "island", piece: p.name, card: ci, az, r0: rGroup, r: rGroup,
                  baseY: b[1], H: h, R, Rmax: R, pitch, n, span, lean: wall ? lean * P.LEAN_K : 0, skirt,
                  green: [green.r, green.g, green.b], tone0: [green.r, green.g, green.b], rCard,
                  cx0: Math.sin(az) * rGroup, cz0: Math.cos(az) * rGroup, dx: 0, dz: 0,
                  parts: [], mass: null, hidden: false, push: 0, proved: false };
      // ---- the pillars ----
      for (let i = 0; i < n; i++) {
        // edge to edge, NOT centre-in-slot: an (i+0.5)/n spread stops half a pitch short of the card's own edge on
        // both sides, so every seam between two recipe cards opened a full-pitch slot of SKY straight through the
        // wall (measured: a 1.1 deg gap, 52 px wide, top to bottom). Edge to edge, the last pillar of one card and the
        // first of the next sit exactly one pitch apart, i.e. the same spacing as inside a card.
        const t = n === 1 ? 0.5 : i / (n - 1);
        const pAz = az + span * (t - 0.5);
        // a per-pillar tone: +-TONE_JIT of value and a couple of degrees of hue (report 1.8), so pillars separate
        const j = 1 + (rnd0() - 0.5) * 2 * P.TONE_JIT, hue = (rnd0() - 0.5) * 2 * P.TONE_HUE;
        const tone = [pale.r * j * (1 + hue), pale.g * j, pale.b * j * (1 - hue),
                      mid.r * j * (1 + hue), mid.g * j, mid.b * j * (1 - hue),
                      dark.r, dark.g, dark.b, green.r, green.g, green.b];
        const topVar = wall ? P.TOP_VAR : P.ISLAND_TOP_VAR;
        const hv = 1 - topVar * (0.5 + 0.5 * S0.noise3JS(pAz * 2.7 + ci * 1.9, p.name.length, i * 0.7));
        const jit = wall ? 0 : (rnd0() - 0.5) * 2 * P.ISLAND_JITTER * R;      // an island's pillars cluster in depth
        const pr = rGroup + jit;
        g.parts.push({ type: "pillar", tplKind: wall ? "wall" : "island", tplIdx: i % (wall ? 4 : 3),
                       az: pAz, r: pr, cx: Math.sin(pAz) * pr, cz: Math.cos(pAz) * pr, H: h * hv, R, y0: b[1],
                       lean: g.lean, aoK: 1, tone, vvar: rnd0() * 10, pitch, skirt, wall,
                       bushP: wall || rCard < P.CARD_ISLAND_R ? 1 : 0 });   // a near stack always gets its shrubs; a far one is cards
        g.Rmax = Math.max(g.Rmax, R + Math.abs(g.lean) * h);
      }
      if (wall) {
        const cols = Math.max(5, Math.round(n * 4) + 1), rows = 4;
        g.mass = { type: "mass", rows, cols, az0: az, span, r: rGroup + P.DEPTH_BACK * R, y0: b[1], H: h,
                   lean: g.lean, aoK: P.AO_BACK, vvar: rnd0() * 10, jag: P.BACK_JAG, top: P.BACK_TOP, seed: ci,
                   tone: [mid.r * P.BACK_TONE, mid.g * P.BACK_TONE, mid.b * P.BACK_TONE,
                          mid.r * P.BACK_TONE, mid.g * P.BACK_TONE, mid.b * P.BACK_TONE,
                          dark.r, dark.g, dark.b, green.r, green.g, green.b] };
        g.parts.push(g.mass);
        g.Rmax = Math.max(g.Rmax, P.DEPTH_BACK * R + R);
        walls.push(g);
      } else islands.push(g);
      groups.push(g);
    }
  }

  // ---- audit: every number that reached a group must be FINITE. A NaN in one of these used to travel all the way
  // into the rock and card buffers (Float32Array(NaN) silently becomes a 0-length buffer, and 24 mass cards wrote
  // NaN positions), so they are counted here and reported, never assumed ----
  const problems = [];
  const chk = (g, k, v) => { if (!Number.isFinite(v)) problems.push(`${g.kind} ${g.piece} card ${g.card}: ${k} = ${v}`); };
  for (const g of groups) {
    for (const k of ["az", "r0", "r", "baseY", "H", "R", "Rmax", "pitch", "n", "span", "skirt", "cx0", "cz0", "lean"]) chk(g, k, g[k]);
    for (const p of g.parts) {
      if (p.type === "pillar") for (const k of ["az", "r", "cx", "cz", "H", "R", "y0", "lean", "pitch"]) chk(g, `pillar.${k}`, p[k]);
      else for (const k of ["r", "y0", "H", "cols", "rows", "az0", "span", "top", "jag"]) chk(g, `mass.${k}`, p[k]);
      if (p.tone.some((v) => !Number.isFinite(v))) problems.push(`${g.kind} ${g.piece} card ${g.card}: ${p.type}.tone not finite`);
    }
  }

  // ---- a group's bounding bands (used by the live keep-out only when the analytic proof does not apply) ----
  for (const g of groups) {
    const y0 = g.baseY - g.skirt, y1 = g.baseY + g.H;
    g.bands = [];
    for (let b = 0; b < P.BANDS; b++) {
      const lo = y0 + (y1 - y0) * b / P.BANDS, hi = y0 + (y1 - y0) * (b + 1) / P.BANDS;
      let rmax = g.Rmax;
      g.bands.push({ y: (lo + hi) / 2, r: Math.sqrt(rmax * rmax + ((hi - lo) / 2) ** 2) });
    }
  }
  return { pieces, groups, walls, islands, skipped, recipeRmin, problems,
           measured: { recipeRmin, waterTop, waterFloor, seaFloor },
           leak: 0 };
}


/** The keep-out of every group for this state: push outward (PUSH steps up to PUSH_MAX) or drop. Writes g.dx / dz /
 *  hidden / push and returns the stats + whether anything moved. */
function keepOut(L, st, test, first) {
  const P = SPIRE, { groups, recipeRmin } = L;
  const fightR = st?.fightR ?? 0;
  const farSurf = Math.max(0, ...(st?.fighters || []).map((f) => Math.hypot(f.c[0], f.c[2]) + f.r));
  const ringMax = Math.max(0, ...(st?.rings || []).map((g) => g.r));
  const nearMin = Math.max(fightR + P.NEAR_CLEAR, farSurf + P.NEAR_CLEAR, Number.isFinite(recipeRmin) ? recipeRmin : 0);
  const stats = { fightR: Math.round(fightR), farSurf: Math.round(farSurf), ringMax: Math.round(ringMax),
                  nearMin: Math.round(nearMin), pushed: 0, dropped: 0, proved: 0, byReason: {} };
  let moved = first;
  for (const g of groups) {
    let ok = null, why = null;
    for (let push = 0; push <= P.PUSH_MAX + 1e-6; push += P.PUSH) {
      const rad = g.r0 + push * g.Rmax;
      const clear = rad - g.Rmax;                    // the nearest vertex this group can ever have
      if (clear < nearMin) { why = "fight"; continue; }
      // every point of every view cone is inside the hull of the eye ring and a fighter sphere, so it is within
      // max(ring radius, farthest fighter surface) of the axis: a group beyond that cannot be in ANY cone
      if (clear >= Math.max(ringMax, farSurf)) { ok = { rad, push, proved: true }; break; }
      let bad = null;
      for (const b of g.bands) {
        const c = [Math.sin(g.az) * rad, b.y, Math.cos(g.az) * rad];
        bad = test ? test(c, b.r) : null;
        if (bad) break;
      }
      if (!bad) { ok = { rad, push, proved: false }; break; }
      why = bad;
    }
    if (!ok) {
      stats.dropped++; stats.byReason[why] = (stats.byReason[why] || 0) + 1;
      g.hidden = true; g.why = why; g.push = 0; moved = true;
      continue;
    }
    if (ok.proved) stats.proved++;
    if (ok.push > 0) stats.pushed++;
    g.hidden = false; g.why = null; g.push = ok.push; g.proved = ok.proved;
    const dx = Math.sin(g.az) * ok.rad - g.cx0, dz = Math.cos(g.az) * ok.rad - g.cz0;
    if (Math.abs(dx - g.dx) > 1e-6 || Math.abs(dz - g.dz) > 1e-6) { g.dx = dx; g.dz = dz; moved = true; }
    g.r = ok.rad;
  }
  stats.rebuilt = moved;
  return stats;
}

export function plan(pctx) {
  const L = prepare(pctx);
  if (!L) return null;
  let first = true;
  /** one item per shown group (where a foreign asset stands); the native asset reads data.groups (moved in place) */
  const itemsOfGroups = (stats) => {
    const it = itemsFrom(L.groups.filter((g) => !g.hidden).map((g) => ({ p: [g.cx0 + g.dx, g.baseY, g.cz0 + g.dz], yaw: g.az, h: g.H, rad: Math.max(g.R, g.span * g.rCard / 2), grp: 0 })));
    it.stats = stats; it.moved = stats.rebuilt;
    return it;
  };
  const run = (state) => {
    const st = state || pctx.keepOut?.state || null;
    const stats = keepOut(L, st, st ? pctx.keepOut?.reject : null, first);   // (arena-built's reject() needs its ko state: never call early)
    first = false;
    return itemsOfGroups(stats);
  };
  const slot = {
    id: "spires.rock", label: "Cliff spires (wall + sea stacks)", kind: "rock", layer: "builtSpire", default: "mod.spires",
    items: run(null), data: L, userData: { kind: "spire" },
    place(state) { return run(state); },
  };
  const inst = () => pctx.slots.instanceOf(slot.id) || {};
  const layer = {
    get info() { return pctx.info.spires; },
    get meshes() { return pctx.slots.meshesOf(slot.id); },
    walls: L.walls, islands: L.islands, groups: L.groups,
    get rockMesh() { return inst().rockMesh; }, get bushMeshes() { return inst().bushMeshes; }, get cardMesh() { return inst().cardMesh; },
    get materials() { return inst().materials; }, get gemini() { return inst().gemini || null; },
    setGemini: async (on) => (inst().setGemini ? inst().setGemini(on) : null),
    place: (st) => pctx.slots.replace(slot.id, st || pctx.keepOut?.state),
    setVisible: (v) => pctx.slots.setVisible(slot.id, v),
  };
  return { slots: [slot], layer };
}
