import { battleAilmentByte } from "../battlecmd-translated.js";
import {
  cureAllStatusEvents,
  cureStatusEvent,
  RAND_U16,
  emptyStatusEventPool,
  stageStatusEventSideTick,
  effStats as engineEffStats,
  stageStatusEventRegen,
  AUTO_RECOVER_PAYLOAD,
  stageStatusEventGlobal,
  damageTermStatApplies,
  damageTermStatModifier,
  stageStatusEventStat,
  damageTermPostHitSlotPage,
  DAMAGE_TERM_STRENGTH_DOWN_WORD,
  DAMAGE_TERM_DEFENSE_DOWN_WORD,
  consumeAffinity,
  category4RestorePlan,
} from "../vendor/engine.js";
import { activeSlotOf, encounterGateBytes, setStatModifier, statModifier, statValue } from "./plans.js";
import type { RestorePlanOptions, StatDebuffNames } from "./core/types.js";
import type { FightTechRow } from "../types/battle.js";

import type { BattleState } from "../types/battle.js";
export function battleRestoreParty(b, side: number) {
  if ((side | 0) < 1) {
    const records = b?.playerRecords ?? [];
    return [0, 1, 2].map((i) => {
      const rec = records[i];
      return rec
        ? { present: true, hp: rec.hp | 0, maxHp: rec.maxHp | 0, ailments: battleAilmentByte(rec) }
        : { present: false, hp: 0, maxHp: 0, ailments: 0 };
    });
  }
  const en = b?.enemy;
  return [0, 1, 2].map((i) => (i === 0 && en
    ? { present: true, hp: en.hp | 0, maxHp: en.maxHp | 0, ailments: battleAilmentByte(en) }
    : { present: false, hp: 0, maxHp: 0, ailments: 0 }));
}

/** The walker's own records for one side, in the original's slot order. */
export function battleRestoreTargets(b, side: number) {
  if ((side | 0) < 1) {
    const records = b?.playerRecords ?? [];
    return [0, 1, 2].map((i) => records[i] ?? null);
  }
  return [b?.enemy ?? null, null, null];
}

/**
 * Clear the ailment bits `mask` names off one of the walker's own records.
 *
 * `FIGHTSTG_F0x8009c330` clears them in place with `nor $v0, $zr, $v0` / `and $v1, $v0` /
 * `sb $v1, 0x1c($a2)` (pro/fightstg.s:26421 / :26422 / :26425), and the all-ailments cure
 * `FIGHTSTG_F0x8008f5d4` zeroes the whole byte with `sb $zr, 0x1c($s0)` (:12933). The
 * walker keeps ailments by name AND, when a record carries them, the raw `+0x1c` byte in
 * `statusBits` — so both are cleared here, or the two representations would drift apart.
 */
function clearRestoreAilments(rec, mask: number) {
  if (!rec || !mask) return;
  const a = rec.ailments;
  if (a) {
    if (mask & 0x01) delete a.poison;
    if (mask & 0x02) delete a.frozen;
    if (mask & 0x04) delete a.confuse;
    if (mask & 0x08) delete a.sleep;
  }
  if (Number.isInteger(rec.statusBits)) rec.statusBits &= ~mask & 0xff;
}

/**
 * Run one category-4 restore plan on the walker's own records and report what moved.
 *
 * The plan is the port's, so this only translates the port's per-slot numbers back into
 * the walker's records. Returns the slot indices whose HP actually rose.
 */
export function applyBattleRestorePlan(b, side: number, plan) {
  const targets = battleRestoreTargets(b, side);
  const healed = [];
  const pool = b?.statusEvents;
  // The disc's cure is the RECORD's own bit clear plus the pool entry's free, both inside
  // `FIGHTSTG_F0x8009c330` (`sb $v1, 0x1c($a2)` :26425 and `sh $zr, ($v0)` :26443), so a
  // cured ailment's recovery must not be left queued. An ALL-status mask (`0x3f`, or
  // technique 375's whole-byte `0xff`) additionally cancels the six codes of
  // `STATUS_EVENT_ALL_CURE_CODES` — the two tech-abort locks among them.
  for (let i = 0; i < targets.length; i++) {
    const rec = targets[i];
    if (!rec) continue;
    const before = rec.hp | 0;
    if (plan?.fullRestore?.[i]) {
      rec.hp = rec.maxHp | 0;
    } else if ((plan?.heal?.[i] | 0) > 0) {
      rec.hp = Math.min(rec.maxHp | 0, before + (plan.heal[i] | 0));
    }
    const mask = plan?.cure?.[i] | 0;
    clearRestoreAilments(rec, mask);
    // The even half of the cure window (190/192/194/196) runs F0x8009c330 on every PRESENT
    // slot (record halfword +0 non-zero, fallen or not) and frees that ailment's pending
    // event there whatever the record's ailment bits say (0x8009c37c-0x8009c49c: the bit
    // clear `sb $v1, 0x1c($a2)` is unconditional, the free reads only the `which` index
    // from the technique id). which 0/1/2 = one code from `.L0x800a43d4`, 3 = the six codes.
    if (plan?.arm?.name === "cureWindow" && !plan.arm.oddHalf) {
      const evSide = (side | 0) < 1 ? 0 : 0x10;
      const evSlot = (rec.slot ?? i) | 0;
      const which = plan.arm.cureSlot | 0;
      if (which === 3) cureAllStatusEvents(pool, evSide, evSlot);
      else cureStatusEvent(pool, ["poison", "frozen", "confuse"][which], evSide, evSlot);
    }
    if (mask) {
      const sideByte = (side | 0) < 1 ? 0 : 0x10;
      // The record's own slot when it carries one (the walker's active fighter does), the
      // party position otherwise — the disc's cure helper walks slots 0..2 by index.
      const slot = (rec.slot ?? i) | 0;
      if (mask & 0x30) {
        // `which` 3 / F0x8008f5d4: the four recoveries AND the two locks. The walker's
        // records are one fighter per side and a lock is staged on the side's ACTIVE slot,
        // so every slot of that side is swept.
        for (let s = 0; s < 3; s++) cureAllStatusEvents(pool, sideByte, s);
      } else {
        if (mask & 0x01) cureStatusEvent(pool, "poison", sideByte, slot);
        if (mask & 0x02) cureStatusEvent(pool, "frozen", sideByte, slot);
        if (mask & 0x04) cureStatusEvent(pool, "confuse", sideByte, slot);
        if (mask & 0x08) cureStatusEvent(pool, "sleep", sideByte, slot);
      }
    }
    // AUTO RECOVER (189), whichever side casts it: the arm stages the per-side tick (code 5,
    // opcode 2 = max(1001, rand%2001 + 10*SPT), fightstg.s:13288-13289, :26565-26611) and the
    // regen source (code 6, payload 189 so the tick is rand%9+8, :13299, :26615-26654) on
    // the CASTER's side, active slot.
    if (plan?.regen && i === activeSlotOf(b, side)) startAutoRecover(b, side, rec);
    if ((rec.hp | 0) > before) healed.push(i);
  }
  return healed;
}

/**
 * Start Auto Recover on one fighter: the code-6 regen event (payload 189, tick rand%9+8) is
 * staged in the status-event pool, so it ticks every 1000 timeline units (wfightmn.s:2381),
 * and the code-5 event is staged to end it. A Recover Crest wearer keeps the crest source
 * (rand%5+4, `rec.regeneration`) after it ends (`wfightmn.s:2320-2329`); that source stays
 * the per-action tick and is paused while Auto Recover runs.
 */
/** The pool stagers take a draw in [0,1) (they scale it to 16 bits); RAND_U16 is the integer draw itself (battle-combat.ts:637 wraps it the same way). */
export const RAND_FRAC = () => (RAND_U16() % 0x10000) / 0x10000;

function startAutoRecover(b: { statusEvents: { code: number; time: number; side: number; slot: number; payload: number; payload2: number; }[]; }, side: number, rec: { autoRecover: boolean; }) {
  if (!rec) return;
  const pool = b.statusEvents ?? (b.statusEvents = emptyStatusEventPool());
  const sideDir = (side | 0) < 1 ? 0 : 0x10;
  stageStatusEventSideTick(pool, sideDir, engineEffStats(rec).spt | 0, RAND_FRAC);
  stageStatusEventRegen(pool, sideDir, activeSlotOf(b, side), AUTO_RECOVER_PAYLOAD);
  rec.autoRecover = true;
}

/**
 * The field techniques (category 6, 213..219): `FIGHTSTG_F0x800907cc` (`pro/fightstg.s:14029`-`:14095`).
 * The field word pair is { element, power = min(127, f9 + trunc(SPT/10)) } with SPT the caster's
 * effective +0x06 (`:14050`-`:14067`), and F0x8009c740 queues code 7 with time 1000 + 12*SPT
 * (clamped 0x7fff) that zeroes both words (`:14068`-`:14074`; consumer wfightmn.s:2469-2498).
 * A new field tech replaces the field and rewrites the timer.
 */
export function castFieldTechnique(b: BattleState, side: number, record: { crit: number; }, _techElementName: string) {
  // The stored element is record byte +0x04 (the category, 6 for every field tech), NOT the tech own
  // element (+0x07, which only picks the message page): measured in the game, rig-field-and-scale.md.
  // Element id 6 is "thunder" in the engine table (battle-formulas.ts ELEMENT_ID).
  const elementName = "thunder";
  // fightstg.s:13092: the state-1 clear has no category test, so a field technique clears the byte too.
  clearActionAffinity(b, side);
  const rec = battleRestoreTargets(b, side)[activeSlotOf(b, side)] ?? ((side | 0) < 1 ? b.player : b.enemy);
  const spt = rec ? (engineEffStats(rec).spt | 0) : 0;
  b.field = { element: elementName, power: Math.min(127, (record.crit | 0) + Math.trunc(spt / 10)) };
  stageStatusEventGlobal(b.statusEvents ?? (b.statusEvents = emptyStatusEventPool()), 1000 + 12 * spt);
}

/**
 * The post-hit dispatch arms for dispatch 26 / 27 (`F0x8009d858` attack down, `F0x8009d944`
 * defense down; table `0x80083234`, `pro/fightstg.s:27828`-`:27940`): after a LANDED hit the
 * OPPOSING side's active fighter takes the stat setter with magnitude -f9 (record +0x0c), then
 * the stat expiry is staged with the same opcode-12 delay as the stat techs. The attack arm is
 * skipped when the PLAYER acts and encounter gate byte 0x80042b62 is non-zero (`:27840`-`:27850`).
 * Returns the change or null.
 */
export function applyStatDebuffDispatch(b: { statusEvents: { code: number; time: number; side: number; slot: number; payload: number; payload2: number; }[]; }, actingSide: number, record: FightTechRow | null, names: StatDebuffNames = {}) {
  const dispatch = Number(record?.dispatch) | 0;
  if (dispatch !== 26 && dispatch !== 27) return null;
  const stat = dispatch === 26 ? 0 : 1;
  if (stat === 0 && (actingSide | 0) < 1 && encounterGateBytes(b)[0]) return null;
  const targetSide = (actingSide | 0) < 1 ? 1 : 0;
  const slot = activeSlotOf(b, targetSide);
  const rec = battleRestoreTargets(b, targetSide)[slot] ?? null;
  if (!rec || !damageTermStatApplies(rec.profile?.id ?? 1, rec.hp | 0)) return null;
  const before = statModifier(rec, stat);
  const effective = statValue(rec, stat) - before;
  const modifier = damageTermStatModifier(effective, before, -(record.crit | 0));
  setStatModifier(rec, stat, modifier);
  const pool = b.statusEvents ?? (b.statusEvents = emptyStatusEventPool());
  stageStatusEventStat(pool, targetSide < 1 ? 0 : 0x10, slot, stat, engineEffStats(rec).spt | 0, RAND_FRAC);
  // The queue consumer's page (fightstg.s:15238-15243, :15264-15269): slot 26 -> esmfight[0x33]
  // "Strength [down]!", slot 27 -> esmfight[0x34] "Defense [down]!", kind 2, naming the debuffed side.
  const targetName = (targetSide < 1 ? names.player : names.enemy) ?? rec.profile?.name ?? null;
  const spec = damageTermPostHitSlotPage(
    stat === 0 ? DAMAGE_TERM_STRENGTH_DOWN_WORD : DAMAGE_TERM_DEFENSE_DOWN_WORD, targetName, actingSide);
  const text = `${targetName ?? ""} ${stat === 0 ? "Strength" : "Defense"} down!`.trim();
  return { stat, slot, side: targetSide, before, modifier, page: spec ? { text, spec } : null };
}

/**
 * The record machine's per-action clear of the charge byte, on the acting side.
 *
 * ONE shared rule, ported from the assembly rather than per technique, and it is the
 * reason a Digimon can throw its own charge away. `FIGHTSTG_F0x8008f714` runs for all
 * five attack categories; its **state 1, sub-state 0** (`pro/fightstg.s:193
 * .L0x80082fdc: .word 0x8008f8b4`, the first row of its own sub-state table) puts up the
 * announcement page and then stores `sh $zr, 0xe($v0)` at `:13092` — in the `j`'s delay
 * slot, so it always runs once the battle message box is free (`:13063 lw $v0, ($s6)` /
 * `:13065 bnez $v0, .L0x80090c1c`). It has **no category test**, so a technique that deals
 * no damage at all still clears the byte, and it runs *before* sub-state 1, the category
 * handler that the charge arms write from (`:13875`, `:14016`).
 *
 * So the walker clears on the two no-damage gates — the category-5 charge arms and the
 * category-4 heal/cure family — and the damaging categories keep the engine's
 * `consumeAffinity` inside `resolveAttackSequence`, which is the original's order (state 0
 * reads the byte into the effective block, state 1 sub-state 0 clears it). Calling this
 * before the resolver instead would break the multiplier, which is why it is not called
 * from the top of the action.
 *
 * `0x800a4436` (`ctx+0x42`) is the only flag that can skip that clear
 * (`pro/fightstg.s:13067` / `:13069`) and nothing in the disc ever sets it, so the walker
 * does not model a path that never runs.
 *
 * Returns the byte that was cleared, exactly as `consumeAffinity` does.
 */
export function clearActionAffinity(b, side: number) {
  const s = (side | 0) < 1 ? 0 : 1;
  const activeSlot = s < 1 ? ((b?.activePlayerIndex ?? 0) | 0) : 0;
  const rec = battleRestoreTargets(b, s)[activeSlot];
  return consumeAffinity(rec);
}

/**
 * What one category-4 technique does, with the record machine's own arms, on one side.
 *
 * Returns null when the technique is not a category-4 member, so a caller can use it as
 * the gate: that null IS the "this technique is an ordinary attack" answer.
 */
export function battleRestorePlanFor(b, side: number, record: { category: number; }, techniqueId: number, options: RestorePlanOptions = {}) {
  if ((record?.category | 0) !== 4) return null;
  // The record machine's state-1 sub-state-0 clear runs BEFORE this category handler and
  // has no category test (`pro/fightstg.s:13092 sh $zr, 0xe($v0)`), so a heal throws the
  // acting fighter's own charge away even though a heal never reads it.
  clearActionAffinity(b, side);
  const sides = {
    0: battleRestoreParty(b, 0),
    1: battleRestoreParty(b, 1),
  };
  const activeSlot = (side | 0) < 1 ? ((b?.activePlayerIndex ?? 0) | 0) : 0;
  const actor = battleRestoreTargets(b, side)[activeSlot];
  const plan = category4RestorePlan(record, techniqueId | 0, {
    side: side | 0,
    wisdom: Number(options.wisdom ?? actor?.wis ?? 0),
    activeSlot,
    name: options.name ?? null,
  }, sides);
  if (!plan) return null;
  // `arm.side` is where the ORIGINAL acts, which for 100 and 375 is the player's party
  // whichever side cast them (`sw $zr, 0x64($s4)` and `addiu $a0, $v0, 0x4470`).
  plan.healed = applyBattleRestorePlan(b, plan.side, plan);
  return plan;
}
