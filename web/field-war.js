// web/field-war.js — the elemental field war: which element follows which, and the
// disc's own seven words for it.
//
// This module is pure (no DOM, no battle state) so the cycle and the words can be
// read without running a fight.
//
// Where the facts come from:
//   * the seven field ITEMS are ids 77..83, FlameField..DarkField (item 84,
//     UnknownField, rolls its own element and is not one of the seven). Their
//     handler FIGHTSTG_F0x8008e4e0 stores `ItemId - 0x4b` (2..8 = fire..dark) into
//     the battle header's field element and 0x40 (64) into its power
//     (fightstg 0x800a4530/+2).
//   * the seven field TECHNIQUES are records 213..219, category 6, elem1 2..8, and
//     all seven carry 64 in their own +0x0c byte (the `crit` field of the shipped
//     record dump) — the same power the items write.
//   * the words are the disc's battle message bank indices `elem1 + 0x61`, i.e.
//     esmfight[0x63..0x69] = "Fire field!" .. "Dark field!".
//   * the arithmetic a field changes is engine/dw3/battle-formulas.ts
//     `elementalFieldAdjustment` (F0x8009f644): +base*power/128 for a matching
//     element, -base*power/256 for the element it counters. This module never does
//     damage; it only names the field the fight is in.

/** The field power the seven field items and the seven field techniques write. */
export const FIELD_POWER = 64;

/**
 * The field order, ending in "no field": fire -> water -> ice -> wind -> thunder ->
 * machine -> dark -> none. `null` is the original's "no field" state (field id 0),
 * not a missing value, so the cycle is eight entries and step 8 comes back to fire.
 */
export const FIELD_CYCLE = Object.freeze([
  "fire", "water", "ice", "wind", "thunder", "machine", "dark", null,
]);

/** The disc's word for each of the seven fields (esmfight 0x63..0x69). */
const FIELD_WORDS = Object.freeze({
  fire: "Fire field!",
  water: "Water field!",
  ice: "Ice field!",
  wind: "Wind field!",
  thunder: "Thunder field!",
  machine: "Machine field!",
  dark: "Dark field!",
});

/**
 * The word a field prints, or null when there is no such field (no field at all,
 * or a name the disc's seven words do not cover).
 */
export function fieldName(element) {
  return FIELD_WORDS[element] ?? null;
}

/**
 * The field `step` turns further along the cycle.
 *
 * `field` is the battle's own `{ element, power }` (or null for "no field"). The
 * step preserves the power already on the battlefield — the field keeps its
 * strength while only its element moves — and uses the items' own 64 when the
 * field starts from none. Landing on "none" returns null, because that is the
 * state the damage formula already understands as no field at all.
 */
export function nextField(field, step = 1) {
  const current = field?.element ? FIELD_CYCLE.indexOf(field.element) : -1;
  // An unknown element (or no field) starts from the none slot, so the first step
  // always lands on fire — the cycle's own order.
  const start = current >= 0 ? current : FIELD_CYCLE.length - 1;
  const turns = Number.isFinite(step) ? Math.trunc(step) : 1;
  const index = ((start + turns) % FIELD_CYCLE.length + FIELD_CYCLE.length) % FIELD_CYCLE.length;
  const element = FIELD_CYCLE[index];
  if (element === null) return null;
  const power = Number.isFinite(field?.power) && field.power > 0 ? field.power : FIELD_POWER;
  return { element, power };
}
