import {
  STATUS_EVENT_POOL_SIZE,
  advanceStatusEvents,
  statusEventActionDelay,
  endStatusEventRegen,
  regenTick as engineRegenTick,
  RAND_U16,
  poisonTimelineDamage as enginePoisonTimelineDamage,
  stageStatusEventLock,
  emptyStatusEventPool,
  effStats as engineEffStats,
  stageStatusEventStat,
  damageTermPenaltyMode,
  statPenaltyOf,
  applyDamageTermPenalty,
  damageTermPenaltyByStat,
  damageTermFleeLockRoll,
  damageTermPostHitSlotPage,
  damageTermPostHitMpAbsorb,
  damageTermPostHitMpPage,
} from "../vendor/engine.js";
import { activeSlotOf, effectiveSpd, setStatModifier } from "./plans.js";
import { RAND_FRAC, battleRestoreTargets } from "./restore.js";

/**
 * Advance the battle's status-event pool by one action and apply every expiry.
 *
 * The original has no frame tick for this system: `FIGHTSTG_F0x8009ba4c`
 * (`pro/fightstg.s:25779`) picks the queued entry with the smallest `+0x2`, subtracts
 * that time from every other entry, and hands the fired code back. Each action
 * resolution re-enqueues the turn event with `[0x800a437c](side, 0)`
 * (`pro/wfightmn.s:4090`-`:4098`), so the distance one action covers IS the opcode-0
 * delay -- `trunc(1000 * opp.SPD / isqrt(own.SPD * opp.SPD))`, clamped to `[707, 1414]`
 * (`pro/fightstg.s:26168`-`:26294` and the triple at `:34855`). The expiry itself is the
 * original's: a stat code puts the record's modifier halfword back to zero
 * (`sh $zr, 0x10($v1)` `pro/wfightmn.s:2816`) and a lock code clears its `+0x1c` bit
 * (`lbu $v1, 0x1c($a1)` / `addiu $v0, 0x4` / `sllv $v0, $a2, $v0` / `nor $v0, $zr, $v0`
 * / `and $v1, $v0` / `sb $v1, 0x1c($a1)` `pro/wfightmn.s:2743`-`:2773`).
 *
 * Exported so the category-5 tests can drive one action without the whole battle loop.
 */
export function battleStatusEventAdvance(b, playerSpd) {
  const pool = b?.statusEvents;
  if (!pool || pool.length !== STATUS_EVENT_POOL_SIZE) return [];
  // The original asks for the delay with the PLAYER side's byte whatever acted
  // (`move_ $a0, $zr` in the `jalr` delay slot, `pro/wfightmn.s:1210`), and the routine's
  // numerator is that side's own effective SPD (`lh $v0, 0xa($a3)` `:26284`), with the
  // other side only feeding the `isqrt` seed (`:26238`). So this is not per-acted-side.
  const expiries = advanceStatusEvents(
    pool, statusEventActionDelay(playerSpd ?? effectiveSpd(b.player), effectiveSpd(b.enemy)));
  for (const expiry of expiries) {
    if (expiry.kind === "clearField") {
      // Code 7 (clearField, wfightmn.s:2469-2498): line 0x6A, both field words zeroed.
      b.field = null;
      b._fieldCleared = true;
      continue;
    }
    if (expiry.kind === "sideTick") {
      // Code 5 (endAutoRecover, wfightmn.s:2261-2342): Auto Recover ends. The regen entry is
      // freed unless the fighter wears the Recover Crest, which keeps it with payload 0.
      const fighter = battleAilmentTarget(b, expiry.side | 0, expiry.slot | 0);
      // The crest source is the per-action tick here, so the pool entry is freed either way.
      endStatusEventRegen(pool, expiry.side | 0, false);
      if (fighter) fighter.autoRecover = false;
      continue;
    }
    if (expiry.kind === "regen") {
      // The regen machine (wfightmn.s:2343-2457, code 6): one tick per 1000 units, heal only
      // while 0 < HP < max (:2394), amount from F0x800a01ac with payload 189 (rand%9+8).
      const target = battleAilmentTarget(b, expiry.side | 0, expiry.slot | 0);
      if (!target || !target.autoRecover || target.hp <= 0 || target.hp >= target.maxHp) continue;
      const amount = engineRegenTick(target.maxHp, RAND_U16, true);
      target.hp = Math.min(target.maxHp, target.hp + amount);
      (b._regenEvents ?? (b._regenEvents = [])).push(
        { combatant: target, ailment: "regen", kind: "regen", amount });
      continue;
    }
    if (expiry.kind === "stat" || expiry.kind === "lock") {
      const records = battleRestoreTargets(b, (expiry.side | 0) < 1 ? 0 : 1);
      const rec = records[expiry.slot | 0];
      if (!rec) continue;
      if (expiry.kind === "stat") {
        const key = ["str", "def", "spd"][expiry.stat ?? 0];
        const mods = rec.statMods ?? { str: 0, def: 0, spd: 0 };
        mods[key] = 0;
        rec.statMods = mods;
      }
      if (expiry.lock === 0) rec.cantFlee = false;
      if (expiry.lock === 1) rec.cantDigivolve = false;
      continue;
    }
    // The record an entry names is the side byte it was queued with and its slot. The
    // walker's two sides are one fighter each, so the slot is the walker's own side slot.
    const target = battleAilmentTarget(b, expiry.side | 0, expiry.slot | 0);
    if (expiry.kind === "poison") {
      // `FIGHTSTG_F0x8009c7d4`'s entry KEEPS its slot: `0x800a3800`'s word for code 0x09 is
      // `-1`, so `FIGHTSTG_F0x8009ba4c` fires it and leaves it queued with its time spent,
      // and the consumer machine re-arms it — `li $v0, 0x3e8` in the `j`'s delay slot
      // `sh $v0, 0x2($s1)` (`pro/wfightmn.s:2607`-`:2609`). That is the poison's period.
      if (!target || target.hp <= 0) continue;
      const fields = poisonDefenceFieldsOf(target);
      const amount = enginePoisonTimelineDamage(
        target.maxHp, target.ailments.poison?.power ?? 0, fields.water, fields.poisonResistance);
      target.hp = Math.max(0, target.hp - amount);
      const entry = pool.find((e) => e.code === 0x09
        && (e.side | 0) === (expiry.side | 0) && (e.slot | 0) === (expiry.slot | 0));
      if (entry) entry.time = 1000;
      b._poisonTick = { combatant: target, amount };
      continue;
    }
    if (expiry.kind !== "ailment") continue;
    // The recovery came due, so the ailment is over. That is the disc's rule in the other
    // direction too: `FIGHTSTG_F0x8009c330` frees the entry and clears the record's `+0x1c`
    // bit together (`pro/fightstg.s:26421`-`:26443`).
    if (!target || !target.ailments?.[expiry.ailment]) continue;
    delete target.ailments[expiry.ailment];
    b._ailmentCures = (b._ailmentCures ?? []).concat([
      { combatant: target, ailment: expiry.ailment },
    ]);
  }
  return expiries;
}

/** The combatant a pool entry names, or null when the walker's one-per-side model has none. */
function battleAilmentTarget(b, side, slot) {
  void slot;
  if ((side | 0) < 1) return b?.player ?? null;
  return b?.enemy ?? null;
}

/** The poison formula's two inputs, the same pair `advanceAilmentTimeline` used to read. */
function poisonDefenceFieldsOf(c) {
  const eStats = c.eStats;
  const water = c.statusResists?.water ?? eStats?.status_resist?.water ?? 0;
  const poisonResistance = c.statusResists?.poison
    ?? eStats?.status_resist?.poison ?? 0;
  return { water: water | 0, poisonResistance: poisonResistance | 0 };
}

/**
 * Write one decided category-5 plan onto the walker's own records.
 *
 * Every line here is the record offset the arm's instruction stream writes; which arm
 * writes what is `category5Plan`'s decision, not this function's.
 */
export function applyCategory5Plan(b, plan, ctx) {
  const { playerRec, targetRec, targets } = ctx;
  // Each change names ITS OWN slot: the party arm writes every living record of the side
  // (`.L0x800903f4`'s walk, `:13857 addiu $s1, 0x1` / `:13858 slti $v0, $s1, 0x3`), so a
  // single-slot target would put the partner's number on the leader.
  for (const change of plan.stats) {
    setStatModifier(targets?.[change.slot] ?? targetRec, change.stat, change.modifier);
  }
  if (plan.effect === "affinity" || plan.effect === "healCharge") {
    if (targetRec && plan.affinity !== null) targetRec.affinity = plan.affinity;
  }
  // The MP transfer follows the two SIDES the arm names, not the two roles: `mpSource`
  // is the player's active fighter and `mpDest` the enemy's whichever side acted.
  if (plan.effect === "mpDrain" && ctx.mpSource && ctx.mpDest) {
    const moved = plan.mpMoved | 0;
    if (moved > 0) {
      ctx.mpSource.mp = Math.max(0, (ctx.mpSource.mp | 0) - moved);
      ctx.mpDest.mp = Math.min(ctx.mpDest.maxMp | 0, (ctx.mpDest.mp | 0) + moved);
    }
  }
  if (plan.effect === "healCharge" && targetRec) {
    // `sh $v0, 0x8($s0)` :14006 adds the getter's amount to the healed record's `+0x08`,
    // and the `beqz`'s DELAY slot :14045 puts `+0x06` (the maximum) back when the sum
    // overshot it — so the cap is that record's own maximum HP. `targetRec` is the side
    // `damageTermCategory5Side` picked: the enemy's active fighter, whoever cast.
    const before = targetRec.hp | 0;
    targetRec.hp = Math.min(targetRec.maxHp | 0, before + (plan.healAmount | 0));
  }
  // THE TWO LOCKS ARE TIMED EVENTS, not flags. `FIGHTSTG_F0x8009cd1c`
  // (`pro/fightstg.s:27049`) enqueues code 0x10 / 0x11 on the PLAYER's active slot and
  // sets the record's `+0x1c` bit `0x10` / `0x20` (`:27134` / `:27141`); the POOL is what
  // releases it (`pro/wfightmn.s:2758`-`:2775`: `lbu $v1, 0x1c($a1)` /
  // `addiu $v0, 0x4` / `sllv $v0, $a2, $v0` / `nor $v0, $zr, $v0` / `and $v1, $v0` /
  // `sb $v1, 0x1c($a1)`). `b.statusEvents` IS that pool -- 99 slots of 28 bytes -- so
  // the escape gate below reads the queue rather than a boolean the walker invented.
  if (plan.rollLanded && playerRec
      && (plan.effect === "lockFlee" || plan.effect === "lockDigivolve")) {
    stageStatusEventLock(
      b.statusEvents ?? (b.statusEvents = emptyStatusEventPool()),
      plan.effect === "lockFlee" ? 0 : 1,
      activeSlotOf(b, 0),
      // `lbu $v1, 0xc($s4)` :27092 -- the technique record's own `+0x0c`, through the
      // record pointer `sll $v0, $a0, 0x3` / `addu $v0, $a0` / `sll $v0, 0x1` +
      // `lui $v1, 0x8004` / `addiu $v1, 0x2bca` at :27024-:27040. That byte is the
      // record's `crit` field (`category5Plan`'s own `row.direction * record.crit`).
      ctx.recordMagnitude | 0,
      RAND_FRAC,
    );
    // The stager ALSO sets the record's own `+0x1c` bit (`ori $v0, 0x10` :27134 /
    // `ori $v0, 0x20` :27141). The record byte is the interface every consumer
    // reads: the command menu's row greys (`FIGHTSTG_F0x80093cf4` :17595 reads
    // actor +0x1c & 0x20 for the DV row), the DNA pane's rejection tests and the
    // escape roll. The walker keeps the two bits as per-record booleans, cleared
    // by the pool's expiry below.
    if (plan.effect === "lockFlee") playerRec.cantFlee = true;
    else playerRec.cantDigivolve = true;
  }
  // The stat arms stage their own expiry: `jal FIGHTSTG_F0x8009cc20` :13776 with the code
  // from `.L0x800a43e0[stat]` (`:26986`) and the delay of OPCODE 12 -- `2000 + rand % 2001
  // + 10 * own[+0x06]` (`pro/fightstg.s:26087`-`:26110`, the arm `0x8009c130`). A stat
  // change therefore wears off instead of lasting the whole battle.
  if (plan.stats.length) {
    const pool = b.statusEvents ?? (b.statusEvents = emptyStatusEventPool());
    const sideDir = (plan.side | 0) < 1 ? 0 : 0x10;
    // `FIGHTSTG_F0x8009cc20` passes the TARGET's side to the delay routine (`move_ $a0,
    // $s1` :13778, where `$s1` is the side the arm chose), so the target's own spirit
    // sets how long the change lasts -- `lh $v1, 0x6($s0)` :26204 is `0x800a4580`'s
    // `+0x06`, the effective SPT.
    const spt = targetRec ? (engineEffStats(targetRec).spt | 0) : 0;
    for (const change of plan.stats) {
      stageStatusEventStat(pool, sideDir, change.slot | 0, change.stat, spt, RAND_FRAC);
    }
  }
}

/**
 * FIGHTSTG_F0x8009df78 — the post-hit secondary-effect dispatcher, run once per LANDED
 * action from the move resolver FIGHTSTG_F0x8009e0cc.
 *
 * THE CALL SITE. The resolver's tail is where the original invokes it: after the accuracy
 * leaves write the hit flag (`sb $v0, 0x30($s1)` at `pro/fightstg.s:28484` for category 2
 * and `:28566` for category 3) and after the damage and the five status/drain appliers, it
 * reads that flag back and calls the dispatcher on a hit —
 * `pro/fightstg.s:28579 .L0x8009e3ac: lbu $v0, 0x30($s1)` / `:28582 beqz $v0, .L0x8009e3c8`
 * / `:28588 .L0x8009e3bc: jal FIGHTSTG_F0x8009df78`. The dispatcher indexes the technique's
 * record by the action's technique id (`lw $v1, 0x4418($v0)`, `:28102`) and switches on
 * record `+0x0a` through the 33-word table `0x80083234`.
 *
 * The walker reaches those same two moments for an ordinary attack — a hit landed and the
 * damage dealt — on all three paths: the technique path and the basic-attack path (side 0)
 * and the enemy path (side 1). This function IS that call. It is the one place the walker
 * runs a hit's SECONDARY effect off the record's dispatch byte, as distinct from the
 * technique's own `effect` string that `tryInflict` reads.
 *
 * WHICH ARMS. This port implements the three that write the PERSISTENT stat penalty
 * (dispatch 32/33/34 -> F0x8009daac/db94/dc8c, engine/dw3/battle-damage-terms.ts). Every
 * other dispatch is a no-op here, and deliberately: dispatch 2..8's appliers are the
 * status/drain family the walker already runs through `tryInflict` and the engine's damage
 * leaves, and every remaining word in the table is the dispatcher's own bare return
 * (`DAMAGE_TERM_POST_HIT_RETURN`, nothing runs). So this is the penalty arm, not a second
 * copy of the status machine — `damageTermPenaltyMode` is the gate.
 *
 * WHICH FIGHTER, AND HOW MUCH. The arms write the PLAYER's active member whichever side
 * acted: they read `lw $a0, 0x4468($v0)` (0x800a4468 = the active party-member index;
 * `docs/research/battle/fightstg-command-dispatch.md`) and resolve it through F0x80017b4c
 * to `&DIGIMON_CUR_STATS + slot*0x3dc`, then `lhu` the slot, add the record's `+0x0c` and
 * store it back. The landing chance is F0x800a1458 (`:31793`): it rebuilds BOTH sides'
 * effective blocks and tests `record[+0x0b] + trunc((enemyWIS - playerWIS)/8)` against
 * `rand & 0x7f`, ignoring the side byte it is handed. The shipped family is the Cardmon
 * enemy attacks (techniques 421..428, all category 2), so the target really is the player.
 *
 * Returns null when the record carries no penalty dispatch (the dispatcher's own no-op),
 * else `{ dispatch, landed, queueWord, penalty }`. `penalty` is the record's three
 * halfwords after the arm ran.
 */
export function applyPostHitDispatch(b, record, options = {}) {
  const dispatch = Number(record?.dispatch) | 0;
  if (dispatch === 13) return applyFleeLockDispatch(b, record, options);
  if (dispatch === 29) return applyMpAbsorbDispatch(b, record, options);
  if (damageTermPenaltyMode(dispatch) === null) return null;
  // The member the arms resolve: 0x800a4468, the player's active record.
  const target = battleRestoreTargets(b, 0)[activeSlotOf(b, 0)] ?? null;
  if (!target) return null;
  const before = statPenaltyOf(target);
  const slots = [before.str, before.def, before.spd];
  const result = applyDamageTermPenalty(slots, {
    effectP1: record.f8 | 0,
    // Block 0x800a4580 holds the ENEMY's effective stats and 0x800a45c0 the PLAYER's
    // (F0x8009ec94 `beqz $s6` picks 0x45c0 for side 0, 0x4580 for side 1; F0x800a1458
    // calls it for (0, [0x4468]) then (1, [0x446c])), so the difference is enemy - player.
    wisHigh: (b.enemy ? engineEffStats(b.enemy).wis : 0) | 0,
    wisLow: engineEffStats(b.player).wis | 0,
    magnitude: record.crit | 0,
    dispatch,
    rng: options.rng ?? RAND_U16,
  });
  const landed = result.queueWord !== 0;
  if (landed) {
    // The appliers store the slot back on the persistent member (`sh $v0, 0x42($s0)`).
    // The walker keeps those three halfwords on the record, and `writeBackBattleVitals`
    // carries them to the roster member at the battle's end, where the inn rests them away.
    target.statPenalty = damageTermPenaltyByStat(result);
    if (target.statsRecord) target.statsRecord.statPenalty = { ...target.statPenalty };
  }
  return { dispatch, landed, queueWord: result.queueWord, penalty: statPenaltyOf(target) };
}

/**
 * Dispatch 13 -- 430 Dark Pupil's post-hit flee lock (F0x8009e0b4 -> F0x8009dd64, fightstg.s:28170-28200).
 * After a landed hit: `(rand & 0x7f) < record +0x0b` (64); a success queues slot 13, whose consumer calls
 * F0x8009cd1c with record 211 (`:15233`), so the lock time is `(rand % 101 + 100) * 211.f9` (24) = 2400..4800
 * units on the PLAYER's active slot, the flee bit (+0x1c bit 0x10) is set, and the page is esmfight[0x44]
 * "Can't run away!". The pool's expiry clears the bit (wfightmn.s:2925-2948). `options.rng` is a 16-bit draw.
 */
function applyFleeLockDispatch(b, record, options = {}) {
  const rng = options.rng ?? RAND_U16;
  if (!damageTermFleeLockRoll(record?.f8 | 0, rng)) return { dispatch: 13, landed: false, page: null };
  const slot = activeSlotOf(b, 0);
  const rec = battleRestoreTargets(b, 0)[slot] ?? null;
  if (!rec) return { dispatch: 13, landed: false, page: null };
  // `lbu $v1, 0xc($s4)` :27098 reads record 211 (`options.lockRecord`), never 430 (whose own +0x0c is 32).
  const magnitude = options.lockRecord?.crit | 0;
  stageStatusEventLock(b.statusEvents ?? (b.statusEvents = emptyStatusEventPool()), 0, slot, magnitude | 0, RAND_FRAC);
  rec.cantFlee = true;
  const name = options.playerName ?? rec.profile?.name ?? null;
  const spec = damageTermPostHitSlotPage(0x44, name, 1);
  return { dispatch: 13, landed: true, slot, page: spec ? { text: `${name ?? ""} can't run away!`.trim(), spec } : null };
}

/**
 * Dispatch 29 -- 431 Vemmon's MP absorb (F0x8009da0c, fightstg.s:27943-27985; consumer :15066-15109). After a
 * landed hit the player's active fighter loses `floor(maxMP * record.f9 / 128)` (431: 8 -> 6.25%), capped at its
 * current MP, and the enemy's active fighter gains it (clamped at its own maximum). Page: kind 18 with payload
 * word 2 = 1, "{1} MP absorbed!" (esmfight[0x8f]), the amount in slot 1.
 */
function applyMpAbsorbDispatch(b, record, options = {}) {
  const src = battleRestoreTargets(b, 0)[activeSlotOf(b, 0)] ?? null;
  const dst = battleRestoreTargets(b, 1)[activeSlotOf(b, 1)] ?? null;
  if (!src || !dst) return { dispatch: 29, landed: false, page: null };
  const amount = damageTermPostHitMpAbsorb(record, src.mp | 0, src.maxMp | 0);
  if (amount <= 0) return { dispatch: 29, landed: false, page: null };
  src.mp = Math.max(0, (src.mp | 0) - amount);
  dst.mp = Math.min(dst.maxMp | 0, (dst.mp | 0) + amount);
  const name = options.enemyName ?? dst.profile?.name ?? null;
  const spec = damageTermPostHitMpPage(name, amount);
  return { dispatch: 29, landed: true, amount, page: spec ? { text: `${amount} MP absorbed!`, spec } : null };
}
