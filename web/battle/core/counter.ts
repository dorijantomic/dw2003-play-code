import { contactDamager } from "../../fight/contact-damage.js";
import { battleKindOf, finalBossPhaseSwitchesTrack } from "../form-blast.js";
import {
  frozenGateBlocksTurn,
  RAND_U16,
  counterCrestProc,
  resolveCounterBlow as engineResolveCounterBlow,
  elementId,
  enemyMoveCondition,
  enemyActionSkillId,
} from "../../vendor/engine.js";
import { MSG_KIND, MSG } from "../messages.js";
import { battleStatusEventAdvance } from "../status.js";
import { noteHit } from "../hit-results.js";
import { battleAilmentByte } from "../../battlecmd-translated.js";
import type { BattleContext } from "../../types/battle.js";

import type { BattleState } from "../../types/battle.js";
// moved by tools/rewrite/split-closure.mjs
export function makeCounter(B: BattleContext) {
/**
   * Arm a technique's result so it lands when the ACTION is over, not only on a contact.
   *
   * **A technique's result page is the record machine's, and the record machine never
   * reads the animation.** Its apply arm is entered from the technique-execution object's
   * own step and its only gate is the technique record's category byte
   * (`pro/fightstg.s:13114` `.L0x8008f980` sltiu $v0, $v1, 0x5` over
   * `lbu $v0, 0x4($s5)` at `:13111`); nothing on the way there looks at record `+0x10`,
   * the clip the animation plays. The action script's contact opcode is presentation:
   * `FIGHTSTG_F0x8008c454` (op10) only spawns an effect and reads the attacker's active
   * part. So a clip that fires no contact must still produce its page.
   *
   * The 443 records group by clip, and seven of them — the field techniques 213..219 —
   * sit on clip 15, whose script is `op4 / op4 / wait 90 / op4 / wait 60 / op255` in
   * every one of the 53 models that have it: no `op10` at all, so no contact. Before
   * this, those techniques put up no page of any kind and the walker's own HP arithmetic
   * never ran either. Rather than a rule per technique, every one of the three
   * `commitImpact` sites (the basic attack, the player's technique and the enemy's) arms
   * itself here, and `commitPendingImpact` runs it once the action is over. The contact
   * stays the EARLY commit, so every technique that has one still lands its page at the
   * strike.
   */
  function armPendingImpact(b: { _pendingImpact: { (): void; (): void; } | null; }, commit: () => void) {
    // Whichever way the result lands — the contact or the end of the action — the
    // armed slot is cleared, so an early contact cannot leave a second commit pending.
    const armed = () => {
      if (b._pendingImpact === armed) b._pendingImpact = null;
      commit();
    };
    b._pendingImpact = armed;
  }
/**
   * The per-contact damage of a multi-contact action (A12) — the arithmetic lives in
   * web/fight/contact-damage.js so the contract is testable without a battle.
   *
   * A built combo/volley presents several `op10 98` contacts before its single `op10 99`
   * strike (clip 8 = 2x98+1x99, clip 13 = 2x98+1x99, a 4-hit basic = 3x98+1x99 — the disc's
   * own authored shapes). Each contact is one of the technique's hits, so the damage comes
   * off the victim hit by hit: an intermediate contact takes ONE hit's value (the
   * resolver's `dmgPerHit`, the value the original computes once for the whole action),
   * and the final strike takes the remainder, so the sum over the contacts is exactly the
   * resolved total — never the total per contact, never a lost remainder. The page,
   * the ailment/weapon/steal/dispatch machinery and the hit gauge stay on the FINAL
   * commit, which is also where the defender's outcome clip (2 survive / 3 death /
   * 4 evade) is dispatched — an intermediate flinch (clip 1) can never end the fight,
   * and the intermediates are capped so the victim is still standing for the strike
   * that carries the death reaction.
   */
  function armContactDamage(target: { hp: number; }, total, dmgPerHit, attempts) {
    return contactDamager({
      total, perHit: dmgPerHit, hits: attempts, hp: target.hp,
      pay: (amount: number) => { target.hp = Math.max(0, target.hp - amount); },
    });
  }
/**
   * A counter is an attack of its own: the defender swings back at the attacker AFTER the blow that provoked it has
   * played out. It used to subtract the HP and print the line the instant the blow landed, so the damage appeared on
   * the attacker with no swing at all. Now the outcome is decided where the blow lands (so the page can say it), and
   * the swing is queued: when the provoking action's animation is over the defender plays its own basic attack
   * toward the attacker, and the HP comes off at that attack's contact. `from` is the countering side.
   */
  function queueCounter(b: BattleState, from: string, { dmg, hit = true, techId }) {
    b._counter = { from, dmg: Math.max(0, dmg | 0), hit, techId, phase: "wait", applied: false };
  }
function applyCounter(b: BattleState, c) {
    if (c.applied) return;
    c.applied = true;
    if (!c.hit) return;
    const target = c.from === "player" ? b.enemy : b.player;
    target.hp = Math.max(0, target.hp - c.dmg);
  }
/** Advance the queued counter. True while it still owns the result phase (the next page must wait for it). */
  function stepCounter(b: BattleState) {
    const c = b._counter;
    if (!c) return false;
    if (B.animBusy()) return true;             // the blow that provoked it is still playing
    if (c.phase === "wait") {
      const target = c.from === "player" ? b.enemy : b.player;
      const attack = c.from === "player" ? B.renderer3d?.playerAttack : B.renderer3d?.enemyAttack;
      const started = attack?.call(B.renderer3d, c.techId, {
        lethal: c.hit && c.dmg >= target.hp, miss: !c.hit,
        onHit: (rec: { type: number; }) => { if (rec.type === 99) applyCounter(b, c); },
      });
      c.phase = "run";
      if (started) return true;              // the swing is playing; its contact lands the damage
    }
    applyCounter(b, c);                      // the swing finished (or there is no renderer): settle whatever is left
    b._counter = null;
    return false;
  }
/** Run an armed result once no action is playing. The armed closure is one-shot. */
  function commitPendingImpact(b: BattleState) {
    const commit = b._pendingImpact;
    if (!commit || B.animBusy()) return false;
    b._pendingImpact = null;
    commit();
    return true;
  }
/**
   * The final boss's scripted phase transition — the ONE mid-battle boss-track play.
   *
   * WFIGHTMN zeroes the two transition counters only for battle 0x144, the Galacticmon
   * sequence (.L0x00001090-.L0x0000109c: mode 4, then `sb 0, +0xdb` / `sb 0, +0xda`).
   * Its damage-apply wrapper F0x800aab10 counts player-side applications whose delta is
   * nonzero (.L0x00004d30-.L0x00004da8) — but only while the kind word is 6, the head
   * phase (`.L0x00004d48-.L0x00004d50`: `lh $v1, 0xd6` / `li $v0, 6` / `bne` returns),
   * and only until `+0xdb` is set. On the third it calls fightstg F0x8009d06c, which
   * spawns battle effect 0x1d3 (.L0x8009d0a0), latches `+0xdb := 1` (:27300-:27303) and
   * enqueues kind 0x18. That effect's actor F0x80086a00 then plays 0x60980000 = archive
   * 38 boss04 (LASTB_02) through [0x80055c48] and saves it to [0x80042b30]
   * (.L0x80086e84-.L0x80086ea0) — the only battle-side boss-track play in the whole
   * game (sound-system.md 2026-07-03h).
   */
  function noteFinalBossPhaseDamage(b: { _bossPhaseDone: boolean; _bossPhaseCount: number; specialMode: number; _battleTrack: string; }) {
    if (b._bossPhaseDone) return;
    // The wrapper's own kind gate: +0xda counts only while the head stands. The walker's
    // three call sites are the player's own landed damaging commits (basic, technique,
    // DNA) — the closest faithful condition for the wrapper's per-application count,
    // which is only reachable through a pointer in the original.
    if (battleKindOf(b) !== 6) return;
    b._bossPhaseCount = (b._bossPhaseCount ?? 0) + 1;
    if (!finalBossPhaseSwitchesTrack(b.specialMode, battleKindOf(b), b._bossPhaseCount)) return;
    b._bossPhaseDone = true;
    b._battleTrack = "boss04";   // the register update at .L0x00086ea0
    B.bgm?.play(b._battleTrack);
  }
/**
   * The Frozen gate in front of the command menu — `F0x800a7418` step 1, the one place
   * in the battle where the menu is armed.
   *
   * The original's step 1 waits while a line is up (`wfightmn.s:1494-1496`, file
   * `0x173c-0x1744`, the read the walker already does in `commandPhaseWaitsForLine`), then
   * resolves the ACTING Digimon — `0x800a4470 + 32*[0x800a4468]` (`:1498-1502`) — and tests
   * its status byte `+0x1c` (`:1503-1506`, file `0x1760-0x176c`):
   *
   * * `& 0x2` (Frozen) -> the roll at `[0x800a4660](0)`, i.e. `F0x800a19d8` called with
   *   the argument `0` = the player side (`:1507-1512`, file `0x1770-0x1784`). A nonzero
   *   return BLOCKS the turn: message `0x56` "Frozen and can't move!" is put up through the
   *   line object's `+0xac` with kind 2 and the pair at `instr+0x50` (`:1514-1525`, file
   *   `0x178c-0x17b8`), so the panel reads the partner's name on line one and the game's
   *   sentence on line two. A zero return falls through to the confuse test.
   * * `& 0x4` (Confused) -> `instr+0x2C(0x11)`, state 17 = the joke handler (`:1541-1550`,
   *   file `0x17f8-0x181c`); the walker's own confused menu is that path, not this gate's.
   * * otherwise -> `jal 0x80092d80` with argument 2 arms the command list and the step
   *   counter moves to 2 (`:1552-1556`, file `0x1824-0x1834`).
   *
   * What the blocked turn does next is the tail at `:1526-1540` (file `0x17bc-0x17f4`):
   * the speed-relative
   * delay `[0x800a437c](0, 0)` (`F0x8009bda4` opcode 0 = `clamp(1000*sqrt(SPDopp/SPDown),
   * 707, 1414)`) is handed to `F0x8009c4bc`, which re-enqueues the player action event at
   * that cost, and only then `instr+0x2C(2)` returns control to the controller. So the turn
   * is lost at the ordinary turn cost and the enemy still gets its own turn — which is what
   * `queueAfterAction(b, "player")` is. No command is committed and no list ever opens.
   *
   * The roll is taken ONCE per turn, when the command phase arrives: `+0x14` is the
   * instruction's own step, and step 1 is passed for good the moment the list is armed,
   * so cancelling out of TECH and back does not roll again. `_turnSeq` is the walker's
   * turn identity for that purpose and moves whenever the shared scheduler advances the
   * timeline (`queueAfterAction`, `defeatCurrentEnemy`).
   *
   * Returns true when the turn is already lost, so no pad press reaches the list.
   */
  function frozenGateLosesTurn(b: BattleState) {
    if (b._frozenGateTurn === b._turnSeq) return b._frozenGateLost === true;
    b._frozenGateTurn = b._turnSeq;
    if (!frozenGateBlocksTurn(b.player, RAND_U16)) {
      b._frozenGateLost = false;
      return false;
    }
    b._frozenGateLost = true;
    b.pendingAction = null;
    const pname = b.player.profile.name;
    B.sayOriginal(b, {
      kind: MSG_KIND.OUTCOME, payload: [MSG.FROZEN_BLOCK], name: pname,
    }, `${pname} is frozen and can't move!`);
    // The lost turn is a real turn on the shared timeline: the enemy still acts before
    // the partner's command phase comes round again.
    B.queueAfterAction(b, "player");
    return true;
  }
/** The battle loop's call into the pool; the body is the exported advance below. */
  function statusEventQueueAdvance(b, playerSpd) {
    return battleStatusEventAdvance(b, playerSpd);
  }
// Our Digimon swings back (Counter Crest). The outcome is decided here, so the page can name it; the
  // swing itself is queued and plays after the enemy's blow (queueCounter), where the damage lands at its contact.
  function triggerPlayerCounter(b: BattleState, attacker, defender, damage: number, attackerName: string, defenderName: string) {
    if (!defender.counterCrest || defender.hp <= 0 || damage <= 0 ||
        !counterCrestProc(damage, defender.maxHp, RAND_U16)) return "";
    const basic = B.skillDB[defender.profile?.tech_basic];
    const skill = basic ? { ...basic, attack_category: "physical" } : null;
    const counterSkill = skill ? { ...skill, basic_attack: true } : null;
    // The Crest's swing is F0x8008ee84 -> the damage method F0x8009ff40 (0x800a4610) on the
    // player's own basic technique: `s3 == 1` (side 0 and the technique id equals the
    // profile's basic id, 0x8009ff6c-0x8009ffb0), so the physical tail runs on base = the
    // damage taken, unscaled, with the Multi Crest byte held off (0x800a0044-0x800a0070).
    const r = noteHit("counter", engineResolveCounterBlow(defender, attacker, counterSkill, damage, 0, RAND_U16, b.field, true));
    queueCounter(b, "player", { dmg: r.hit ? r.dmg : 0, hit: !!r.hit, techId: defender.profile?.tech_basic });
    if (!r.hit) return ` ${defenderName} countered, but ${attackerName} evaded!`;
    return ` ${defenderName} countered for ${r.dmg} damage!`;
  }
/**
   * The FAR-SIDE counter row — F0x8008ee84's `+0x42/+0x43/+0x44` arm.
   *
   * The damage machine spawns the reaction object for the side OPPOSITE the attacker
   * (`fightstg.s:10589-10594`) and hands it the blow's damage word; the object's first
   * step aborts when that word is zero (`fightstg.s:12419-12423`), so a blow that dealt
   * nothing never reaches the row. For an enemy defender the row is the FIFTH four-byte
   * move row of its 0x46-byte stats record (`+0x42` action, `+0x43` comparator, `+0x44`
   * value): the comparator is tested for zero directly (`:12512-12514`) and otherwise
   * through check_move_cond, and the action through F0x80089148 (`:12522-12523`) — 1 =
   * the record's own attack (`+0x08`), 2/3 = move_1/move_2 (`+0x0a`/`+0x0c`), 4..8/0 =
   * no counter. The `sw` at `:12528` stores those negative codes anyway, but that is the
   * branch's delay slot, not a rule; the port maps them to "no counter".
   *
   * The counter is the defender's accuracy roll, then F0x8009ff40's scaled base (damage taken times the
   * mapped record's f9 / 64, / 32 when the defender is charged) through the damage tail. The disc runs it
   * once per damage application, which is the caller's `total` (all hits of one action summed).
   *
   * A new partner (species id 191+, no 0x1CF enemy row) resolves no `eStats`, so it has
   * no row and never counters — never the 0x58-byte player profile's bytes at +0x42..+0x44,
   * which are growth fields (`phase2-rtarget.md` 2.2).
   */
  function triggerEnemyCounterRow(b: BattleState, attacker: { hp: number; }, defender, damage: number, attackerName: string, defenderName: string) {
    if (damage <= 0 || defender.hp <= 0) return "";
    // Gate 2 (fightstg.s:12433-12440, .L0x8008ef14-.L0x8008ef40): a Frozen defender whose Frozen roll
    // F0x800a19d8 returns non-zero starts no reaction. Gate 4: comparator 0 means NO counter, never "always".
    if (frozenGateBlocksTurn(defender, RAND_U16)) return "";
    const row = defender.eStats?.counter;
    if (!row || !(row.comparator | 0)) return "";
    // The same operands `pickEnemyMove` supplies: the counter's condition runs through
    // the one check_move_cond port. The walker fights one enemy at a time, so the slot
    // scan sees only the defender — the multi-slot quirk (the disc reads the row of the
    // enemy whose TURN it is) cannot differ here.
    const context = {
      partyProfileId: B.battle.player?.profile?.id ?? null,
      partyAilmentByte: battleAilmentByte(B.battle.player),
      fieldElementId: B.battle.field ? elementId(B.battle.field.element) : 0,
      battleId: B.battle.screenId ?? null,
      encounterGateByte: B.battle.encounterGateBytes?.[1] ?? null,
      ...B.enemyConditionSlots(B.battle, defender),
    };
    if (enemyMoveCondition(row.comparator, row.value ?? 0, defender, RAND_U16,
      attacker, context) !== true) return "";
    const action = row.action | 0;
    const skillId = enemyActionSkillId(action, defender.eStats ?? {});
    const base = skillId ? B.skillDB[skillId] : null;
    if (!base) return "";
    // Action 1 is the species' own attack, the plain-attack shape the enemy turn uses;
    // 2/3 are its two technique slots as they stand.
    const skill = action === 1
      ? { ...base, attack_category: "physical", basic_attack: true }
      : base;
    // F0x8009ff40 (fightstg.s:30399-30520): the blow's base is the damage just taken times the countering
    // record's own f9 (+0x0c) / 64, or / 32 while the countering fighter's charge byte +0x1b (Aura Plug) is on.
    const r = noteHit("counter", engineResolveCounterBlow(defender, attacker, skill, damage,
      B.fightTechDB?.[String(skillId)]?.crit | 0, RAND_U16, b.field));
    if (!r.hit) return ` ${defenderName} countered, but ${attackerName} evaded!`;
    attacker.hp = Math.max(0, attacker.hp - r.dmg);
    return ` ${defenderName} countered for ${r.dmg} damage!`;
  }
  return { armPendingImpact, armContactDamage, queueCounter, applyCounter, stepCounter, commitPendingImpact, noteFinalBossPhaseDamage, frozenGateLosesTurn, statusEventQueueAdvance, triggerPlayerCounter, triggerEnemyCounterRow };
}
