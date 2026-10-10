// engine/dw3/inn.ts — the inn (hotel) rest transaction.
//
// DECODED 2026-08-13. This module used to say "TEXT IS DECODED, BEHAVIOUR IS
// NOT" and took the price from its caller. The whole chain is now read:
//
//   * The innkeeper is NPC 20 (sprite `p039tail`, Gatomon). Its `on_close`
//     dialogue state sets a bank-0x7A flag. The resident set_flag dispatcher
//     `F0x800165ac` routes every 0x7A index that is neither `< 0x1e` (item
//     shop) nor in the card-shop ranges `0x31..0x43` / `0x46..0x4a` to
//     `jal D0x8008c000`, which builds the screen with `F0x80011dac(0x1002)`.
//   * That screen class is `F0x800119a8`. It calls the screen-id getter
//     `D0x8004b438` and linearly scans the 8-byte-stride table `D0x8003edcc`
//     for the current screen id, storing the matched POSITION at obj+0x58.
//     So the inn identifies itself from the MAP, never from the flag index —
//     which is why s650 and s651 share flag index 0x2d and still charge
//     different prices.
//   * Each record is `{ s32 screenId, u16 eshtlnamIndex, u16 pricePerDigimon }`
//     (`fns.s` L1594 draws the name, L1655 draws the price).
//   * `obj+0x60` counts the party slots present, over slots 0..2.
//   * Affordability (`fns.s` L1797-1807): `BIT >= price * count`.
//   * Commit (`fns.s` L2009-2019): `BIT -= price * count`, then `F0x8001104c`.
//   * `F0x8001104c` is the rest itself: per slot 0..2 it copies max HP into
//     current HP, max MP into current MP, and zeroes the three halfwords at
//     roster +0x42/+0x44/+0x46.
//
// DECODED 2026-10-06: those three halfwords are the persistent post-hit STR/DEF/SPD
// stat penalties (`Combatant.statPenalty`, engine/dw3/battle-combat.ts;
// `DAMAGE_TERM_PENALTY_SLOT_STATS`). `F0x8001104c` is the disc's ONLY established
// clearing point for them — a heal and the next battle's setup do not clear them —
// so a stay is what removes a penalty a battle dealt. `restAtInn` zeroes both the
// walker status list and `statPenalty`; the status clear is this module's own
// interpretation, the `statPenalty` clear is `F0x8001104c`'s decoded write.

export interface InnMember {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** Optional walker status list; cleared on a stay (see header caveat). */
  status?: unknown[];
  /**
   * The roster member's three persistent post-hit penalty halfwords (+0x42/+0x44/+0x46),
   * as `Combatant.statPenalty`. Zeroed by the rest, exactly as `F0x8001104c` does.
   */
  statPenalty?: { str?: number; def?: number; spd?: number };
}

/** One row of the resident table `D0x8003edcc`. */
export interface InnRecord {
  /** Position in `D0x8003edcc`; this is what the screen stores at obj+0x58. */
  index: number;
  /** Screen id the getter `D0x8004b438` returns on this map. */
  screen: number;
  /** Walker scene number (`s235` -> 235), via `screen_table.json`. */
  stage: number;
  /** 1-based index into the `eshtlnam` text bank. */
  nameIndex: number;
  name: string;
  /** Halfword at record+0x6 — the `{1}` in "Each Digimon\n{1} BIT". */
  pricePerDigimon: number;
}

/**
 * The 21 inns, in `D0x8003edcc` order.
 *
 * Source: `~/ddw3/rust/dw2003_exe_data/src/data.rs`, `D0x8003edcc` (44 u32 =
 * 21 records plus the zero-screen terminator). Regenerate the browser copy
 * with `tools/extract_inn_ui.py`; this array is the same data, inlined so the
 * engine has no fetch dependency.
 */
export const INN_RECORDS: readonly InnRecord[] = [
  { index: 0, screen: 522, stage: 235, nameIndex: 1, name: "Asuka Inn", pricePerDigimon: 8 },
  { index: 1, screen: 547, stage: 360, nameIndex: 2, name: "Forest Inn", pricePerDigimon: 12 },
  { index: 2, screen: 559, stage: 425, nameIndex: 3, name: "Seiryu Inn", pricePerDigimon: 16 },
  { index: 3, screen: 568, stage: 470, nameIndex: 4, name: "Swamp Inn", pricePerDigimon: 32 },
  { index: 4, screen: 575, stage: 505, nameIndex: 5, name: "Suzaku Inn", pricePerDigimon: 36 },
  { index: 5, screen: 603, stage: 650, nameIndex: 6, name: "Desert Inn", pricePerDigimon: 48 },
  { index: 6, screen: 605, stage: 660, nameIndex: 7, name: "Byakko Hotel", pricePerDigimon: 44 },
  { index: 7, screen: 611, stage: 700, nameIndex: 8, name: "Mountain Inn", pricePerDigimon: 80 },
  { index: 8, screen: 623, stage: 760, nameIndex: 9, name: "Genbu Inn", pricePerDigimon: 84 },
  { index: 9, screen: 621, stage: 750, nameIndex: 10, name: "Chamber Room", pricePerDigimon: 88 },
  { index: 10, screen: 633, stage: 236, nameIndex: 11, name: "Armaterasu Inn", pricePerDigimon: 52 },
  { index: 11, screen: 658, stage: 361, nameIndex: 2, name: "Forest Inn", pricePerDigimon: 56 },
  { index: 12, screen: 669, stage: 426, nameIndex: 12, name: "Qing Long Inn", pricePerDigimon: 60 },
  { index: 13, screen: 677, stage: 471, nameIndex: 4, name: "Swamp Inn", pricePerDigimon: 68 },
  { index: 14, screen: 684, stage: 506, nameIndex: 13, name: "Zhu Que Inn", pricePerDigimon: 72 },
  { index: 15, screen: 708, stage: 651, nameIndex: 6, name: "Desert Inn", pricePerDigimon: 80 },
  { index: 16, screen: 710, stage: 661, nameIndex: 14, name: "Bai Hu Inn", pricePerDigimon: 76 },
  { index: 17, screen: 715, stage: 701, nameIndex: 8, name: "Mountain Inn", pricePerDigimon: 84 },
  { index: 18, screen: 726, stage: 761, nameIndex: 15, name: "Xuan Wu Inn", pricePerDigimon: 88 },
  { index: 19, screen: 585, stage: 560, nameIndex: 21, name: "Pelche Oasis", pricePerDigimon: 44 },
  { index: 20, screen: 691, stage: 561, nameIndex: 21, name: "Pelche Oasis", pricePerDigimon: 76 },
];

const BY_STAGE = new Map<number, InnRecord>(INN_RECORDS.map((r) => [r.stage, r]));

/** Parse `"s235"`, `235` or `"235"` to a stage number, or null. */
function stageNumber(map: number | string | null | undefined): number | null {
  if (typeof map === "number") return Number.isFinite(map) ? map : null;
  if (typeof map !== "string") return null;
  const m = /^s?(\d+)$/.exec(map.trim());
  return m ? Number(m[1]) : null;
}

/**
 * The inn on a given map, or null when that map has none.
 *
 * This is the walker's stand-in for `F0x800119a8`'s scan of `D0x8003edcc` by
 * current screen id: the lookup key is the map you are standing on.
 */
export function innForStage(map: number | string | null | undefined): InnRecord | null {
  const n = stageNumber(map);
  return n == null ? null : BY_STAGE.get(n) ?? null;
}

/** Every map that has an inn, ascending. */
export function innStages(): number[] {
  return INN_RECORDS.map((r) => r.stage).sort((a, b) => a - b);
}

export interface InnQuote {
  /** Digimon that would be charged for — the original counts slots 0..2. */
  count: number;
  /** `pricePerDigimon * count`. */
  total: number;
  /** Whether `bits` covers `total` (`BIT >= total`, not `>`). */
  affordable: boolean;
}

/**
 * Price a stay.
 *
 * The original counts the party slots that answer >= 0 to the party-manager
 * probe over slots 0..2, so a party of two is charged twice, never three
 * times, and the count is capped at 3.
 */
export function quoteInnStay(
  party: readonly InnMember[],
  pricePerDigimon: number,
  bits: number,
): InnQuote {
  const count = Math.min(3, party.length);
  const per = Math.max(0, Math.floor(pricePerDigimon));
  const total = count * per;
  return { count, total, affordable: bits >= total };
}

export interface InnRestResult {
  /** True when the stay happened; false leaves party and bits untouched. */
  rested: boolean;
  /** Bits remaining after the charge. */
  bits: number;
  /** Party after the rest, as new objects — the input is not mutated. */
  party: InnMember[];
  /** Set when `rested` is false. */
  reason?: "unaffordable" | "empty-party";
}

/**
 * Apply a stay: charge `pricePerDigimon * count`, then run the rest effect.
 *
 * The rest effect mirrors `F0x8001104c` — full HP, full MP, and the three cleared
 * roster halfwords `+0x42`/`+0x44`/`+0x46`, which are the persistent STR/DEF/SPD stat
 * penalties (zeroed here on `statPenalty`). It also surfaces the module's own
 * status-clear interpretation. Only the first three slots are restored, as in the
 * original.
 */
export function restAtInn(
  party: readonly InnMember[],
  pricePerDigimon: number,
  bits: number,
): InnRestResult {
  const copy = () => party.map((m) => ({ ...m }));
  if (party.length === 0) {
    return { rested: false, bits, party: copy(), reason: "empty-party" };
  }
  const quote = quoteInnStay(party, pricePerDigimon, bits);
  if (!quote.affordable) {
    return { rested: false, bits, party: copy(), reason: "unaffordable" };
  }
  return {
    rested: true,
    bits: bits - quote.total,
    party: party.map((m, i) =>
      i < 3
        ? {
            ...m,
            hp: m.maxHp,
            mp: m.maxMp,
            ...(m.status !== undefined ? { status: [] } : {}),
            // F0x8001104c: `+0x42` = `+0x44` = `+0x46` = 0 for each present slot.
            statPenalty: { str: 0, def: 0, spd: 0 },
          }
        : { ...m }),
  };
}

/**
 * The `eshtlnam` bank, index == bank index. Index 0 is the bank's empty slot,
 * 1..15 are inn names, 16..20 are the service prompt, and 21 is "Pelche
 * Oasis" — an inn name that sits AFTER the prompt strings, which is why a
 * 1..15 name list misses it. Two records point at index 21.
 */
export const INN_BANK: readonly string[] = [
  "",
  "Asuka Inn",
  "Forest Inn",
  "Seiryu Inn",
  "Swamp Inn",
  "Suzaku Inn",
  "Desert Inn",
  "Byakko Hotel",
  "Mountain Inn",
  "Genbu Inn",
  "Chamber Room",
  "Armaterasu Inn",
  "Qing Long Inn",
  "Zhu Que Inn",
  "Bai Hu Inn",
  "Xuan Wu Inn",
  "BIT",
  "Each Digimon\n{1} BIT",
  "Stay in Inn",
  "Do not stay in Inn",
  "You don't have enough BIT!",
  "Pelche Oasis",
];

/** The 15 contiguous inn names, in `eshtlnam` bank order (bank index 1..15). */
export const INN_NAMES: readonly string[] = INN_BANK.slice(1, 16);

/** Bank index for an inn name, or 0. Covers "Pelche Oasis" at index 21. */
export function innBankIndex(name: string): number {
  const i = INN_BANK.indexOf(name);
  return i <= 0 ? 0 : i;
}

/**
 * True when a bank-0x7A flag index opens the inn.
 *
 * `F0x800165ac`: `< 0x1e` is the item shop, `0x31..0x43` and `0x46..0x4a` are
 * the card shop, and everything else falls through to `jal D0x8008c000`. The
 * shipped innkeeper flags use 0x1e..0x30 and 0x45.
 */
export function isInnLauncherIndex(index: number): boolean {
  if (!Number.isInteger(index) || index < 0x1e) return false;
  if (index >= 0x31 && index <= 0x43) return false;
  if (index >= 0x46 && index <= 0x4a) return false;
  return true;
}
