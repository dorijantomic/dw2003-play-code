// engine/systems/equip-preview.ts
// The shop's per-Digimon effect cards ("[circle] Button: Effects" view) —
// rig-verified 2026-07-10 on the Windows PCSX-Redux rig (Suzaku Pawn Shop
// savestates); the four rows and their numbers are stitshop F0x80089274 +
// F0x800890b0 over the two stat blocks F0x80088a64 builds (claim
// EQUIP-C016-shop-gear-stat-contributions):
//   weapon / armour: row 0 = POW / DEF (the item's own primary stat, drawn with
//                    the arrow), row 1 = CHR — every piece of gear moves CHR,
//                    from its stat record's first word
//   accessory:       row 0 = CHR, row 1 = the stat its record codes, and that
//                    row is hidden when the code names no single stat (a status
//                    ring's card therefore moves no row)
//   rows 2-3: up to two further stats whose before and after differ, in the
//             game's own scan order (the other core stats, then the seven
//             elemental resists)
// The two fixed rows carry the arrow glyph; the trailing rows do not.
// Increases render blue, unchanged white; a DECREASE renders as just the
// after-value in red with no arrow (verified pixel-exact: Renamon losing her
// +10 SPD accessory to a Power Gem/Flame Ring shows red "143").
import {
  EQUIPMENT_BY_ID, equipmentBonuses, gearCodedStat, gearPrimaryStat, shopEquipSwap,
  GEAR_CORE_STATS, GEAR_ELEMENTS,
  type EquipmentItem, type EquipmentSlots, type EquipSlot,
} from "../dw3/equipment.ts";

export interface EquipPreviewRow {
  /** "str" | "def" | "spt" | "wis" | "spd" | "chr" | "elem_<element>" */
  stat: string;
  before: number;
  after: number;
}

export interface EquipPreview {
  rows: EquipPreviewRow[];
  /** The slot the candidate would occupy. */
  slot: EquipSlot | null;
  /** The item it would replace there (if any). */
  replaced?: number;
}

const CORE = ["str", "def", "spt", "wis", "spd", "chr"] as const;

function effective(base: Record<string, number>, equipment: EquipmentSlots): Record<string, number> {
  const b = equipmentBonuses(equipment);
  const out: Record<string, number> = {};
  for (const s of CORE) out[s] = (base[s] ?? 0) + b[s];
  for (const [el, v] of Object.entries(b.elemResists)) {
    out[`elem_${el}`] = (base[`elem_${el}`] ?? 0) + v;
  }
  // carry base-only elemental resists too
  for (const k of Object.keys(base)) {
    if (k.startsWith("elem_") && !(k in out)) out[k] = base[k] ?? 0;
  }
  return out;
}

// The order stitshop F0x800890b0 scans for the card's two trailing rows: the
// display-index table 0x8008CAE8 walked as 0..0xC, i.e. the six core stats then
// the seven elemental resists.
const SCAN_ORDER = [
  ...GEAR_CORE_STATS, ...GEAR_ELEMENTS.map((e) => `elem_${e}`),
] as const;

/** The card's two fixed rows, per F0x80089274's layout switch. An accessory
 *  (family 21-24) leads with Charisma and shows its own coded stat second, hiding
 *  that row when the code names no single stat — which is why a status ring's card
 *  moves no row. A weapon leads with POW and any other gear with DEF, then
 *  Charisma. The first of these rows is the one drawn with the arrow. */
function fixedRows(item: EquipmentItem): string[] {
  if (item.family >= 21 && item.family <= 24) {
    const coded = gearCodedStat(item);
    return coded ? ["chr", coded] : ["chr"];
  }
  return [gearPrimaryStat(item), "chr"];
}

/**
 * Preview equipping `itemId` for one party member.
 * `base` = the member's UNEQUIPPED core stats (str/def/spt/wis/spd/chr and
 * optional elem_<element> resists); `equipment` = their current slots.
 */
export function computeEquipPreview(
  base: Record<string, number>, equipment: EquipmentSlots, itemId: number,
): EquipPreview | null {
  const item = EQUIPMENT_BY_ID[itemId];
  if (!item) return null;
  const swap = shopEquipSwap(equipment, itemId);
  if (!swap) return null;

  const before = effective(base, equipment);
  const after = effective(base, swap.equipment);

  const fixed = fixedRows(item);
  const rows: EquipPreviewRow[] = fixed.map((stat) => ({
    stat, before: before[stat] ?? 0, after: after[stat] ?? 0,
  }));
  const used = new Set(fixed);
  for (const s of SCAN_ORDER) {
    if (rows.length >= 4) break;
    if (used.has(s)) continue;
    if ((before[s] ?? 0) === (after[s] ?? 0)) continue;
    rows.push({ stat: s, before: before[s] ?? 0, after: after[s] ?? 0 });
  }
  const replaced = equipment[swap.slot];
  return { rows, slot: swap.slot, ...(replaced != null ? { replaced } : {}) };
}
