// PLACEMENT of the boulder piles (meft1008 wall_03; data only): one pile per card of each "rock" piece that stands
// above the floor (never a lake copy). Item = the card: base (render units), facing the centre, height = the card's
// height, footprint = half its width. data = the cards (base, dir, w, h) and the piece's measured colours.
// Default asset: mod.boulder_piles (web/built/boulders.js buildBoulders: the stacked cobbles fitted to each card).
import { itemsFrom, layerFacade } from "../slots.js";

export function plan(pctx) {
  const pieces = [];
  const list = [];
  for (const p of pctx.pieces("rock")) {
    const cards = (p.cards || []).filter((c) => c.base[1] >= -1);   // never a lake copy (wall_04 is another piece)
    if (!cards.length) continue;
    pieces.push({ name: p.name, cards: cards.map((c) => ({ ...c, name: p.name })), colours: p.colours });
    for (const c of cards) list.push({ p: [c.base[0], Math.max(0, c.base[1]), c.base[2]], yaw: Math.atan2(-c.base[0], -c.base[2]), h: c.h, rad: c.w * 0.5 });
  }
  if (!pieces.length) return null;
  const slot = { id: "boulders.piles", label: "Boulder piles", kind: "rock", layer: "builtBoulderPiles", default: "mod.boulder_piles",
                 items: itemsFrom(list), data: { pieces } };
  return { slots: [slot], layer: layerFacade(pctx.slots, slot.id) };
}
