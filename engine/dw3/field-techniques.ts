/**
 * Field techniques — the pause menu's TECHNIQUES screen.
 *
 * Decoded 2026-08-14, see docs/research/ui/pause-menu-screen-tree-2026-08-14.md §5
 * and ledger claim UI-PAUSEMENU-TECHNIQUES-ARE-HEALS-2026-08-14.
 *
 * The screen does NOT teach a technique and does not cost HP. It uses one of the
 * five healing techniques, it costs MP, and the MP is spent only when the heal
 * actually did something.
 *
 * `ststatus` F0x800937a4 builds the row list by walking the Digimon's loaded
 * forms, taking each form's technique ids, and keeping only those satisfying
 * `(id - 0xB8) < 5` — de-duplicated, in first-seen order, capped at five rows.
 * Ids 0xB8..0xBC are Small Heal, Mega Heal, Full Heal, Giga Heal, Final Heal.
 */

export const FIELD_TECH_FIRST_ID = 0xb8; // 184, Small Heal
export const FIELD_TECH_COUNT = 5;       // F0x800937a4: `(id - 0xB8) < 5`
export const FIELD_TECH_MAX_ROWS = 5;    // same function: `if (var_s2 >= 5) return`

/**
 * Target scope, from the technique record byte at +0x05 (`f3` in
 * web/assets/data/fight_tech_table.json). F0x80093a58 branches
 * `if (record->unk5 == 3)` for a single target; every other value is party-wide.
 * The shipped values for the five field heals are 3,3,3,4,4.
 *
 * The game's own English descriptions agree from a completely separate source:
 * Small/Mega/Full Heal read "…of your HP", Giga/Final Heal read "…of allies HP".
 */
const SINGLE_TARGET_SCOPE = 3;
const FIELD_TECH_SCOPE: Record<number, number> = {
  184: 3, 185: 3, 186: 3, 187: 4, 188: 4,
};

/**
 * Which caster stat scales the heal.
 *
 * F0x800939e8 reads a SIGNED HALFWORD at offset 0x12 of the buffer that the
 * resident service `[0x8004b468]` fills for the caster (assembly
 * `lh $v0, 0x22($sp)` against `addiu $a1, $sp, 0x10`). By the established
 * 19-halfword stat layout (`stat-block-nineteen-field-display-set`: level, TP,
 * cur/max HP, cur/max MP, STR, DEF, SPT, WIS, SPD, CHR, then seven
 * resistances) offset 0x12 is WIS.
 *
 * NOT FULLY ESTABLISHED: that the service fills that exact layout was not read.
 * U-26: $a0 is the caster party-member id (CONFIRMED); naming dest+0x12
 * Wisdom stays STRONGLY INFERRED. It is named here so it is a one-line change.
 */
export const HEAL_SCALE_STAT = "wis";

/** True when the technique id is one of the five field-usable healing techniques. */
export function isFieldTechnique(id: number): boolean {
  return (id - FIELD_TECH_FIRST_ID) >>> 0 < FIELD_TECH_COUNT;
}

/** True when the technique heals the whole party rather than one Digimon. */
export function isPartyWide(id: number): boolean {
  return (FIELD_TECH_SCOPE[id] ?? SINGLE_TARGET_SCOPE) !== SINGLE_TARGET_SCOPE;
}

/**
 * The rows the TECHNIQUES screen shows for one Digimon: its field-usable
 * techniques, de-duplicated in first-seen order, capped at five.
 */
export function fieldTechniqueRows(techIds: readonly number[] | null | undefined): number[] {
  const rows: number[] = [];
  for (const raw of techIds ?? []) {
    const id = raw & 0x1fff; // F0x800937a4 masks the stored word before testing
    if (!isFieldTechnique(id)) continue;
    if (rows.includes(id)) continue;
    rows.push(id);
    if (rows.length >= FIELD_TECH_MAX_ROWS) break;
  }
  return rows;
}

/**
 * How much one use heals.
 *
 * F0x800939e8, read from ststatus.s at file offset 0x10d38:
 *   K = unsigned byte at techRecord+0x0c   (the `crit` column of the extracted
 *       tech table, which for the five heals equals the skill record's `power`)
 *   S = signed halfword at casterStats+0x12
 *   heal = (K << 6) + trunc(K * S / 8)
 * The `bgez/addiu 7/sra 3` sequence is a divide-by-8 rounding toward zero, so a
 * negative product truncates rather than floors.
 */
export function healAmount(power: number, scaleStat: number): number {
  const k = power & 0xff;
  const product = k * (scaleStat | 0);
  const scaled = product < 0 ? -Math.floor(-product / 8) : Math.floor(product / 8);
  return (k << 6) + scaled;
}

export interface FieldHealTarget {
  hp: number;
  maxHp: number;
}

export interface FieldHealCaster {
  mp: number;
}

export interface FieldHealResult {
  ok: boolean;
  msg: string;
  /** Total HP restored across every target that moved. */
  healed: number;
  /** MP actually spent — zero on every refusal. */
  mpSpent: number;
  /** True when every target was already at maximum HP. */
  clampedAll: boolean;
}

/**
 * Apply one field technique. Mutates `caster.mp` and each target's `hp` in place,
 * exactly like F0x80093a58 does.
 *
 * Order of the original's checks, preserved here because it is player-visible:
 *  1. "Not enough MP." is raised by the state machine BEFORE the apply handler
 *     runs (F0x80094fbc), so it wins over "No effect.".
 *  2. The MP is subtracted INSIDE the success branch. A heal that moved nothing
 *     costs nothing and reports "No effect." (esstatus 0x6A).
 *  3. If every target clamped to maximum the message is "HP healed to maximum."
 *     (0x52); otherwise it is "{N} HP healed." (0x53).
 */
export function useFieldTechnique(
  caster: FieldHealCaster,
  targets: FieldHealTarget[],
  mpCost: number,
  power: number,
  scaleStat: number,
): FieldHealResult {
  const none = { healed: 0, mpSpent: 0, clampedAll: false };
  if (caster.mp < mpCost) return { ok: false, msg: "Not enough MP.", ...none };

  const amount = healAmount(power, scaleStat);
  let healed = 0;
  let moved = false;
  let clamped = 0;
  let considered = 0;

  for (const t of targets) {
    if (!t) continue;
    considered += 1;
    if (t.hp >= t.maxHp) { clamped += 1; continue; }
    const next = t.hp + amount;
    moved = true;
    if (next > t.maxHp) { healed += t.maxHp - t.hp; t.hp = t.maxHp; clamped += 1; }
    else { healed += amount; t.hp = next; }
  }

  if (!moved) return { ok: false, msg: "No effect.", ...none };

  caster.mp -= mpCost;
  const clampedAll = considered > 0 && clamped === considered;
  return {
    ok: true,
    msg: clampedAll ? "HP healed to maximum." : `${healed} HP healed.`,
    healed,
    mpSpent: mpCost,
    clampedAll,
  };
}
