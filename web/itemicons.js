// web/itemicons.js — real per-item icons (shop buy list / bag lists).
//
// The item's icon class is Unknown1.f4 ("family", byte +9 of the 12-byte
// D0x80041838 item record) — shipped per item in assets/data/item_effects.json.
// family → CMFONTCS clip id was decoded 2026-07-10 on the Windows rig by
// rewriting the family byte of the 8 on-screen Suzaku Item Shop entries and
// pixel-matching every rendered icon against our extracted cmfont sheet
// (zero-SAD matches for all 28 values). Flat +72 EXCEPT 13/14, which swap
// down to 73/72.
import { loadPack, drawClip, packReady } from "./screenpack.js";
import { FAMILY_TO_CLIP } from "./itemicons-data.js";

export { FAMILY_TO_CLIP };

const cmfont = loadPack("cmfont");
let familyById = null; // itemId -> family (icon class)

fetch("assets/data/item_effects.json")
  .then((r) => r.json())
  .then((j) => {
    familyById = {};
    for (const it of j.items) familyById[it.id] = it.family;
  })
  .catch(() => {});

export function itemIconClip(itemId) {
  const fam = familyById?.[itemId];
  return FAMILY_TO_CLIP[fam] ?? null;
}

/**
 * The item's icon class (record byte +9) — the value `FAMILY_TO_CLIP` and the exe's
 * cel table at 0x80042BA8 are both indexed by. It is the ONE number every list row's
 * icon resolves from, so a caller that has to hand it onward (the translated battle
 * ITEM list seeds it into FightItemSession, engine/dw3/ui/fight-item-session.ts) reads
 * it here rather than passing a literal. `null` until item_effects.json has loaded.
 */
export function itemFamily(itemId) {
  return familyById?.[itemId] ?? null;
}

/** Draw item `itemId`'s real 14×14 icon with its top-left at (x, y). */
export function drawItemIcon(ctx, itemId, x, y, scale = 1) {
  const clip = itemIconClip(itemId);
  if (clip == null || !packReady(cmfont)) return false;
  return drawClip(ctx, cmfont, clip, x, y, scale);
}
