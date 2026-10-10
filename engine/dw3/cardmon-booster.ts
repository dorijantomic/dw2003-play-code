// Cardmon booster reward — which Booster pack a defeated Cardmon leaves.
//
// DECODE (fieldstg.s, PAL SLES-03936; overlay base 0x80082cb0). Beat a Cardmon
// (the Card-Battle-themed enemy ids 0x1C9..0x1D0 = 457..464, names
// Cardmon..Cardmon8) and the result screen hands you a Booster pack. That is NOT
// the ordinary drop: those sprites carry drop_rate 0 and a Null item. The battle
// setup F0x8008B798 tests `(enemy_id - 0x1C9) < 8`, then:
//   - the enemy-id PARITY picks the table: odd -> 0x80082F08 (screens
//     0x21D..0x2CE), even -> 0x800831D0 (0x201..0x2CE);
//   - RAND_U16 ([0x8004dc0c]) masked to 0x1f (odd) or 0xf (even) indexes it;
//   - a few arms also test the master progress word [0x8004b370] == 0x2d;
//   - out of range falls to the default Booster1b (rand != 0) / RBooster01 (0).
// No screen yields a single fixed pack. The chosen id is stored at 0x80042B6C
// and the outcome routine F0x800a7c00 writes it into the report item slot,
// overriding the generic drop.
//
// The screen tables are extracted by tools/extract_cardmon_boosters.py into
// web/assets/data/cardmon_boosters.json; this module is the pure selection.

export interface BoosterChoice {
  /** Pack item id when RAND_U16 & mask != 0 (the common draw). */
  nz: number;
  /** Pack item id when RAND_U16 & mask == 0 (rare). */
  z: number;
  /** The same two packs when the master progress ordinal is 0x2d. */
  story2d?: { nz: number; z: number };
}

export interface CardmonBoosterTable {
  odd: Record<string, BoosterChoice>;
  even: Record<string, BoosterChoice>;
  default: BoosterChoice;
}

/** The Cardmon family's runtime enemy ids (Cardmon..Cardmon8). */
export const CARDMON_ENEMY_IDS = [457, 458, 459, 460, 461, 462, 463, 464] as const;

export function isCardmonEnemyId(enemyId: number | null | undefined): boolean {
  return typeof enemyId === "number" && enemyId >= 457 && enemyId <= 464;
}

/**
 * The Booster pack ITEM ID a defeated Cardmon leaves, or null for any other
 * enemy. The caller resolves the id to a display name through the item table
 * (item-names.ts), whose spelling differs from the raw catalog.
 *
 * `screen` is the decimal field screen the battle started on (mapId "s554" ->
 * 554); `rand` is a raw 16-bit draw; `progressOrdinal` is [0x8004b370].
 */
export function cardmonBooster(
  table: CardmonBoosterTable | null | undefined,
  opts: { screen: number; enemyId: number; rand: number; progressOrdinal?: number },
): number | null {
  if (!table || !isCardmonEnemyId(opts.enemyId)) return null;
  const odd = (opts.enemyId & 1) === 1;
  const mask = odd ? 0x1f : 0xf;
  const choice =
    (odd ? table.odd : table.even)[String(opts.screen)] ?? table.default;
  const active =
    opts.progressOrdinal === 0x2d && choice.story2d ? choice.story2d : choice;
  return (opts.rand & mask) === 0 ? active.z : active.nz;
}
