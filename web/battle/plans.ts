import {
  damageTermCategory5Arm,
  damageTermCategory5Side,
  RAND_U16,
  damageTermRoll,
  category5Plan,
  effStats as engineEffStats,
  DAMAGE_TERM_STAT_ROWS,
} from "../vendor/engine.js";
import { battleRestoreTargets, clearActionAffinity } from "./restore.js";
import { applyCategory5Plan } from "./status.js";
import { effStats } from "./hit-results.js";
import type { ScriptedPlanOptions } from "./core/types.js";
import type { BattleState, FightTechRow } from "../types/battle.js";
import type { PlayerRecord, EnemyBattleRecord } from "../types/battle.js";

/**
 * THE WHOLE CATEGORY-5 FAMILY — one call per technique, both sides of a battle.
 *
 * THE SHARED SYSTEM. `FIGHTSTG_F0x8008f714`'s category-5 handler `0x8009021c`
 * (`~/ddw3/asm/dw2003/pro/fightstg.s:13665`-`:14028`) is ONE routine with EIGHT arms, and
 * its whole classifier is nine comparisons on the technique id (`:13670`-`:13712`). Every
 * category-5 record in the shipped 443-row table lands on exactly one of them: 198..208
 * through the two eight-byte stat tables at `.L0x800a33cc` and `.L0x800a3414`, 209/210,
 * 211, 212, 391, 392 and 400 through the six compares below them. It is NOT a converted
 * copy with hand rows: `engine/dw3/battle-damage-terms.ts` holds the port
 * (`DAMAGE_TERM_ARMS_CATEGORY5`, `category5Plan`, `damageTermStatModifier`,
 * `damageTermMpMoved`) and every line is quoted there, so there is no per-technique
 * branch in this file — the arm is decided by the table and the plan by
 * `category5Plan`.
 *
 * WHAT EACH ARM DOES, in the words a player meets:
 *
 *   * `.L0x800902dc` — **198, 200, 202, 204..208** (Double Power, Double Guard, Speed
 *     Up, Lovely Charm, Armor Break, Armor Off, Slow Down, Mega Break): one stat on one
 *     fighter. The row's `+0x2` is the direction, `+0x4` the stat (0 attack / 1 defense /
 *     2 speed) and the magnitude is `direction * record[+0x0C]` (`:13759 mult` /
 *     `:13770 mflo`), so 198 adds 48/128 of the target's attack, 205 takes 24/128 of its
 *     defense and 208 takes 32/128 of its speed. The write is the target's own record
 *     halfword at `+0x10 + 2*stat` through `FIGHTSTG_F0x800a1aa8`
 *     (`:13768 lw $v0, 0x4664($v0)` / `:13771 jalr $v0`), and `damageTermStatModifier`
 *     is that routine's own arithmetic. A `[arrow-down]` row XORs the side with 1
 *     (`:13738 xor $s2, $a0`) so it lands on the FAR side, and reads the per-encounter
 *     gate byte `0x80042b1c + stat + 0x46` (`:13743`): a nonzero byte answers
 *     `esmfight[0x2f]` "No effect!" through kind 1 and touches nothing.
 *   * `.L0x800903f4` — **199, 201, 203** (Mega Strength, Mega Protection, Mega Boost):
 *     the same stat on every living slot of the acting side, through the same routine,
 *     and a kind-9 page.
 *   * `.L0x80090528` — **209, 210** (Soul Charge, Misshukikou): the charge byte in the
 *     target's record `+0x0E`, which the damage tail's stage 3 multiplies by
 *     (`engine/dw3/battle-damage-terms.ts::consumeAffinity` spends it), and
 *     `esmfight[0x36]` "Saving Chi!".
 *   * `.L0x80090584` — **211** (Capture Beam) and `.L0x800905c8` — **212** (Hold Beam):
 *     a `(rand & 0x7f) < 80` roll, then the no-flee / no-digivolve lock and
 *     `esmfight[0x44]` / `esmfight[0x45]`. A lost roll says **"No effect!"** on line one:
 *     `li $v0, 0x2f` is in the delay slot of the roll's `beqz` (pro/fightstg.s:13889 and
 *     :13907), and the branch's own target stores it (:13896 / :13914) before asking
 *     kind 1.
 *   * `.L0x80090610` — **391** (Helter Skelter): the same roll at 96/128, and a landed
 *     roll puts up NO page at all (`:13930` writes 3 into the panel's own `+0xc`). Its
 *     getter is NOT the other two's: `FIGHTSTG_F0x800a13c0` first walks eight
 *     `DIGIMON_PROFILES` rows against the player's active record `+0x10` and answers zero
 *     on a match without drawing (:31761-:31774), so a blocked cast draws nothing.
 *   * `.L0x80090654` — **392** (Vampire Jewel): MP moved OFF the player's active fighter
 *     ONTO the enemy's — the two sides are hard-coded (`:13938` reads the enemy's active
 *     index, `:13939` the player's), so this arm does not walk the party. A source with no
 *     MP answers "No effect!" through **kind 2** with 0x10 in word 1 (`:13946` jumps to
 *     `:13989`, whose delay slot loads 0x2f and whose tail asks kind 2 at `:14022`).
 *     The two sides are fixed whoever casts (0x80090654-0x800906fc): the source is always
 *     the PLAYER's active fighter and the destination the ENEMY's, so a player cast moves
 *     the player's MP onto the enemy (`mpSource`/`mpDest` in `battleScriptedPlanFor`).
 *   * `.L0x80090734` — **400** (Gilead Plant): HP restored on the enemy's active fighter
 *     (`:14006 sh $v0, 0x8($s0)`, capped at `+0x06` at `:14010`-`:14014`) and its charge
 *     byte set to the literal 32 (`:14015`-`:14016). The heal's amount comes from
 *     **record 400's own power**: the branch that reaches this arm leaves `$a1` at 400
 *     (`:13710 li $a1, 0x190`, the `beq`'s delay slot) and the getter indexes the record
 *     by `$a1`, so the amount is `400's power * 64 + wisdom` — the shipped table's 8 and
 *     not some other record's. The fixed side is the caster's own, so a player cast heals
 *     the player and charges it.
 *
 * WHEN THE CHARGE IS SPENT — read out of the assembly, not out of the technique's wording.
 * `FIGHTSTG_F0x8008f714` computes an action's damage in its **state 0** (`:13000 jalr
 * $v0`, the resolver `F0x8009e0cc` through the pointer at `0x800a445c`, which is what reads
 * the byte into the effective block) and clears the byte in its **state 1, sub-state 0**
 * (`:13092 sh $zr, 0xe($v0)`), which also runs *before* sub-state 1 — the category handler
 * these arms live in. So the action that sets the byte never spends it, the acting
 * fighter's NEXT action spends it (a technique or a plain attack alike — categories 2 and
 * 3 share state 0), and an action that computes no damage still clears it. The engine's
 * `consumeAffinity` is that one clear: `resolveAttackSequence` calls it on the damaging
 * categories, and `clearActionAffinity` calls it on the two no-damage gates.
 *
 * The clear runs HERE, ahead of every arm, which is what the original does and what makes
 * Gilead Plant interesting: its write lands on the caster's own record (the fixed side
 * `0x800a446c`, which a player cast flips to the player), so the charge the acting fighter
 * threw away is set again by the arm itself — the clear happens first and the write wins.
 *
 * `null` means "this technique is not a category-5 member", so a caller can use it as the
 * gate the way `battleRestorePlanFor` is used for category 4.
 */
export function battleScriptedPlanFor(b, side: number, record, techniqueId: number, options: ScriptedPlanOptions = {}) {
  const id = techniqueId | 0;
  if ((record?.category | 0) !== 5) return null;
  const arm = damageTermCategory5Arm(id);
  if (!arm) return null;
  // State 1, sub-state 0, ahead of this category handler and with no category test
  // (`pro/fightstg.s:13092`). It matters for Gilead Plant: that arm hard-codes the ENEMY
  // record, so the clear on the ACTING side is not overwritten by the write below.
  clearActionAffinity(b, side);
  const acting = (side | 0) < 1 ? 0 : 1;
  const targetSide = damageTermCategory5Side(arm, acting, category5Row(arm, id));
  const activeSlot = acting < 1 ? ((b?.activePlayerIndex ?? 0) | 0) : 0;
  // The fixed-side arms name the active fighter of THEIR side, not the acting side's
  // slot index.
  const targetSlot = damageTermCategory5Arm(id)?.fixedSide !== undefined ? activeSlotOf(b, targetSide) : activeSlot;
  const targetRec = battleRestoreTargets(b, targetSide)[targetSlot] ?? null;
  const targets = category5Targets(b, targetSide, arm, id);
  // The three arms that roll: `(rand & 0x7f) < record[+0x0B]`, the threshold being the
  // technique record's own `f8` byte (the extractor's name for `+0x0B`).
  // The three arms that roll draw INSIDE the arm, exactly as `jalr rand` does at
  // fightstg.s:31861 — so a technique of any other arm never spends a draw, and the
  // walker's own random order is the original's. A caller may hand the draw in instead.
  const rolls = arm.effect === "lockFlee" || arm.effect === "lockDigivolve" ||
    arm.effect === "statusOnly";
  // The status-only arm's getter is FIGHTSTG_F0x800a13c0 = FIGHTSTG_rollDedigivolve (battle_mode/rolls.c): it walks the
  // eight partner base Digimon against the PLAYER's active fighter id (record +0x00) BEFORE it draws (pro/fightstg.s:
  // 31761-:31774; a match answers `move_ $v0, $zr` in the `bne`'s delay slot at :31771). A match spends no random
  // number at all, so a blocked cast must not take a draw either.
  const playerActiveRookie = playerActiveIsRookie(b);
  const rollBlocked = arm.effect === "statusOnly" && playerActiveRookie;
  const roll7 = options.roll7 ?? (rolls && !rollBlocked ? (RAND_U16()! & 0x7f) : 0);
  const rollLanded = options.rollLanded ?? (rolls && damageTermRoll(record.f8 ?? 0, roll7));
  const rollStatusLanded = rollBlocked ? false
    : (options.rollStatusLanded ?? rollLanded);
  const playerRec = b?.player ?? null;
  const enemyRec = b?.enemy ?? null;
  // The MP-drain arm and the heal arm name their two ACTIVE records by SIDE, not by role:
  // MP moves off `0x800a4468`'s fighter (the player, :13939) onto `0x800a446c`'s (the
  // enemy, :13938), and the heal writes the `0x800a446c` one (:14006). Whichever side
  // casts, the source is the player and the destination the enemy.
  const mpSource = playerRec;
  const mpDest = enemyRec;
  const plan = category5Plan(record, id, {
    side: acting,
    name: options.name ?? null,
    roll7,
    rollLanded,
    rollStatusLanded,
    targets,
    // The raw 0x80042b58..0x80042b65 encounter bytes the factory stores on `b`. The
    // stat-down gate reads 0x80042b62..0x80042b64, i.e. indexes 10..12 of that run.
    gateBytes: encounterGateBytes(b),
    sourceMp: mpSource?.mp ?? 0,
    sourceMaxMp: mpSource?.maxMp ?? 0,
    destMp: mpDest?.mp ?? 0,
    destMaxMp: mpDest?.maxMp ?? 0,
    targetHp: mpDest?.hp ?? 0,
    targetMaxHp: mpDest?.maxHp ?? 0,
    healWisdom: actingFighterWisdom(b, acting),
    playerActiveRookie,
    affinityBefore: targetRec?.affinity ?? 0,
  });
  if (!plan) return null;
  applyCategory5Plan(b, plan, {
    activeSlot, playerRec, mpSource, mpDest, targetRec,
    targets: battleRestoreTargets(b, targetSide),
    recordMagnitude: record.crit | 0,
  });
  return {
    ...plan,
    slot: activeSlot,
    /** The charge byte this arm wrote, for the tests and the legacy sentence. */
    byte: plan.affinity ?? 0,
    charged: plan.affinity !== null && !!targetRec,
    /** Kept for the charge arms' callers: the byte the target already held. */
    replaced: plan.affinityBefore,
    /** What actually changed, in the walker's own records. */
    changed: {
      stats: plan.stats.length,
      affinity: plan.affinity,
      mpMoved: plan.mpMoved | 0,
      heal: plan.healAmount | 0,
      locked: plan.effect === "lockFlee" ? "flee"
        : plan.effect === "lockDigivolve" ? "digivolve" : null,
    },
    page: plan.page,
  };
}

/**
 * The charge arms only — the 2026-10-04 entry point, kept as a VIEW over the whole
 * family so its proof (`tests/battle-affinity-stage.test.js`) still measures what it
 * measured. It returns null for every other category-5 arm, which is exactly the
 * question it was written to answer: "does this technique charge anybody?"
 */
export function battleAffinityPlanFor(b, side: number, record, techniqueId: number, options = {}) {
  const plan = battleScriptedPlanFor(b, side, record, techniqueId, options);
  if (!plan) return null;
  return plan.effect === "affinity" || plan.effect === "healCharge" ? plan : null;
}

/**
 * The per-encounter gate bytes the category-5 debuffs read, in the original's order.
 *
 * `lbu $v0, 0x46($v1)` at `pro/fightstg.s:13743` reads `0x80042b1c + stat + 0x46`, and
 * `0x80042b62..0x80042b64` are three of the fourteen bytes the battle setup copies out of
 * the selected screen's own record (`0x80042b58..0x80042b65`, `battleConfig.raw_2b58_2b65`,
 * which `web/battle.js` already keeps on the battle object). Index 0 here is `0x80042b62`.
 */
export function encounterGateBytes(b) {
  const raw = b?.encounterGateBytes;
  if (!Array.isArray(raw)) return [];
  return [0, 1, 2].map((i) => (Number(raw[10 + i]) | 0) & 0xff);
}

/**
 * The slots one category-5 arm may touch, as the original's own gate reads them.
 *
 * `FIGHTSTG_F0x800a1aa8` skips an empty record (`lh $v0, ($v1)` / `beqz` at `:32250` /
 * `:32252`) and a fallen one (`lh $v0, 0x8($v1)` / `beqz` at `:32254` / `:32256`), and the
 * party arm reads those same two fields 0x10 below its own base (`:13825` / `:13829`). The
 * effective value each row needs is the target's own `effStats()` for that stat, which is
 * the block the arm reads at `+0x02 + 2 * .L0x800a4694[stat]`.
 */
function category5Targets(b, targetSide: number, arm, techniqueId: number) {
  const stat = damageTermStatRowId(arm, techniqueId);
  if (stat === null) return [];
  const slots = arm.effect === "statParty" ? [0, 1, 2] : [activeSlotOf(b, targetSide)];
  const out = [];
  for (const slot of slots) {
    const rec = battleRestoreTargets(b, targetSide)[slot] ?? null;
    if (!rec) continue;
    const modifier = statModifier(rec, stat);
    out.push({
      slot,
      species: rec.profile?.id ?? 1,
      hp: rec.hp | 0,
      // The CLEAN value, which is what the original measures the delta from: the
      // effective block already carries the modifier (F0x8009ec94 adds record
      // `+0x10 + 2*stat`), and FIGHTSTG_F0x800a1aa8 takes it back OFF first when it is
      // nonzero (`lh $v0, 0x10($a1)` / `beqz` :32259-:32261, then `subu $v0, $a0` /
      // `sh $v0, 0x2($v1)` :32271-:32272) — so a second cast of the same technique adds
      // the same number again instead of compounding on itself.
      effective: statValue(rec, stat) - modifier,
      modifier,
    });
  }
  return out;
}

/** Tech 0x187 (391): its roll landed, so tech_action.c:586-588 queues EVENT_DIGIDEVOLVE and builds no page. */
export function forcedDedigivolveLanded(plan) {
  return plan?.effect === "statusOnly" && plan.rollLanded === true;
}

export function activeSlotOf(b, side: number) {
  return (side | 0) < 1 ? ((b?.activePlayerIndex ?? 0) | 0) : 0;
}

/**
 * The PLAYER's active fighter is one of the eight partner base Digimon (the walker's ids 1..8, `rookieId`'s space):
 * `FIGHTSTG_rollDedigivolve` (rolls.c:400-409) compares `DIGIMON_DATA[0..PARTNER_COUNT).id` with the record's id
 * (`+0x00`; the old `+0x10` reading added the base's own 0x10 twice, see engine/dw3/battle-damage-terms.ts). Whichever
 * side casts, it is the PLAYER's active record it reads.
 */
function playerActiveIsRookie(b) {
  const rec = battleRestoreTargets(b, 0)[activeSlotOf(b, 0)];
  const id = Number(rec?.profile?.id ?? rec?.rookieId ?? 0);
  return id >= 1 && id <= 8;
}

/** The acting side's active fighter's WIS, the getter's own second operand. */
function actingFighterWisdom(b, actingSide: number) {
  const slot = activeSlotOf(b, actingSide);
  const rec = battleRestoreTargets(b, actingSide)[slot];
  return rec ? engineEffStats(rec).wis : 0;
}

/** The stat index the arm's row addresses, or null when the arm has no row. */
function damageTermStatRowId(arm: { ids: number[]; }, techniqueId: number) {
  // The row is the technique id's own (the two stat tables are indexed by id), never the arm's first.
  const row = DAMAGE_TERM_STAT_ROWS.find((r) => r.id === (techniqueId | 0) && arm.ids.includes(r.id));
  return row ? row.stat : null;
}

/** The row this arm's technique id addresses, or null when it has none. */
function category5Row(arm, techniqueId: number) {
  return DAMAGE_TERM_STAT_ROWS.find((r) => r.id === (techniqueId | 0)) ?? null;
}

/** The stat the arm changes, 0 attack / 1 defense / 2 speed, for one record. */
export function statValue(rec, stat: number) {
  const values = engineEffStats(rec);
  return [values.str, values.def, values.spd][stat]! | 0;
}

/**
 * One combatant's EFFECTIVE SPD — the block's `+0x0a` halfword, never the stored one.
 *
 * The delay routine `F0x8009bda4` builds both sides' blocks through `F0x8009ec94` and
 * takes the delay off `lh $v0, 0xa($a3)` / `lh $v1, 0xa($s0)`
 * (`pro/fightstg.s:26308-26309`), and the escape roll `F0x800a1608` reads the same
 * field from the two blocks it builds itself (`:31974-31975` player side,
 * `:32001-32004` enemy side). The live form, the three stat modifiers and the
 * persistent penalty only reach SPD through that builder, so a raw halfword diverges
 * from the disc on a form change, a buff/debuff, or an earlier battle's penalty.
 * A missing record answers 0, which is what the raw sites passed.
 */
export function effectiveSpd(rec: PlayerRecord | EnemyBattleRecord | undefined) {
  return rec ? effStats(rec).spd | 0 : 0;
}

/** One record's own modifier for that stat — the walker's `statMods`, absent is 0. */
export function statModifier(rec, stat: number) {
  return [rec?.statMods?.str ?? 0, rec?.statMods?.def ?? 0, rec?.statMods?.spd ?? 0][stat] | 0;
}

export function setStatModifier(rec: { statMods: { str: number; def: number; spd: number; }; }, stat: number, value: number) {
  if (!rec) return;
  const key = ["str", "def", "spd"][stat];
  const mods = rec.statMods ?? { str: 0, def: 0, spd: 0 };
  mods[key] = value | 0;
  rec.statMods = mods;
}
