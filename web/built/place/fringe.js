// PLACEMENT of the grass / reed fringe (meft1008 wall_07; data only): one clump per upright card of the "fringe"
// pieces, TUFTS per card, each a fan of blades from one root: every blade's foot, height, yaw, width, bow and tint
// (deterministic). Items = the clumps (card base, half height, half width). Default asset: mod.fringe
// (web/built/fringe.js buildFringe: emits the blades + their painted-in reflection as one geometry).
import { rng, itemsFrom, layerFacade } from "../slots.js";
import { FRINGE } from "../fringe.js";
const M = 400;

export function plan(pctx) {
  const pieces = pctx.pieces("fringe");
  const cards = pieces.flatMap((p) => (p.cards || []).map((c) => ({ ...c, piece: p.name, colours: p.colours })));
  if (!cards.length) return null;
  // ---- 1. plan the blades (deterministic), TUFTS per card, each a fan of blades from one root
  const r = rng(FRINGE.SEED), lerp = (a, b) => a + (b - a) * r();
  const plan = [];
  cards.forEach((c, ci) => {
    const [bx, by, bz] = c.base, w = c.w;
    const half = Math.min(by + c.h, c.h * 0.5);    // the cards are centred on the water line: half above, half below
    if (!(half > 0)) return;
    const dir = c.dir || [0, 1], across = [-dir[1], dir[0]];
    const nb = Math.max(8, Math.round(FRINGE.BLADES * (w / M) / 2.24));
    const nt = Math.max(3, Math.round(FRINGE.TUFTS * (w / M) / 2.24));
    const tuftH = Array.from({ length: nt }, (_, k) => (k === 0 || k === nt >> 1 || k === nt - 1 ? 1.0 : 0.62 + 0.38 * r()));
    const blades = [];
    for (let b = 0; b < nb; b++) {
      const tk = b % nt, hero = b < FRINGE.HERO;
      const s = Math.max(-0.5, Math.min(0.5, (tk + 0.5) / nt - 0.5 + (r() - 0.5) * 1.5 / nt));   // the tuft's root +- 0.75 tuft
      const jit = (r() * 2 - 1) * FRINGE.JITTER * M;
      const H = half * (hero ? 1.0 : tuftH[tk] * lerp(FRINGE.HMIN, 1.0));
      blades.push({
        foot: [bx + dir[0] * s * w + across[0] * jit, 0, bz + dir[1] * s * w + across[1] * jit],
        H,
        yaw: r() * Math.PI * 2,
        bw: lerp(FRINGE.BW[0], FRINGE.BW[1]) * M * (hero ? 1.15 : 1),
        bow: FRINGE.CURVE * H * lerp(0.5, 1.5),           // the bow grows with the blade's own height
        tint: 0.84 + 0.30 * r(),
      });
    }
    plan.push({ i: ci, piece: c.piece, c: [bx, 0, bz], r: Math.hypot(bx, bz), az: Math.atan2(bx, bz) * 180 / Math.PI,
                w, half, blades });
  });
  if (!plan.length) return null;
  const slot = { id: "fringe.clumps", label: "Reed / grass fringe", kind: "grass", layer: "builtFringe", default: "mod.fringe",
                 items: itemsFrom(plan.map((c) => ({ p: c.c, yaw: Math.atan2(-c.c[0], -c.c[2]), h: c.half, rad: c.w * 0.5 }))),
                 data: { clusters: plan, colours: pieces[0].colours || {} } };
  return { slots: [slot], layer: layerFacade(pctx.slots, slot.id) };
}
