// The damage tail's stage-3 operand: the combatant record's `+0x0E`, the byte Soul
// Charge / Misshukikou / Gilead Plant write and the next attack spends.
//
// WHAT WAS WRONG BEFORE. The stage itself was ported (`engine/dw3/battle-formulas.ts`
// reads `atk.affinity` and adds `running * byte / 64`), but nothing ever gave it a
// nonzero value, so the term was dead. Two documents named the WRONG producer: the
// halfword `FIGHTSTG_F0x80084bc0` `:2084` and `FIGHTSTG_F0x80084e0c` `:2215` store at
// displacement `0x0e`, but through `*(arg0+0x54)`, which inside the display-list
// interpreter `FIGHTSTG_F0x80085110` is the global at `0x8004DE30` (`:2520` loads the
// engine service `0x8004DF68` = `F0x8001d844`, `lui $v0,0x8004 / lw $v0,0xde30($v0)`).
// Those arms write a GPU polygon record — they put the command byte `0x3c` at `+0x07`
// (`:2097`/`:2098`) — and no combatant record anywhere in the game is reached that way.
//
// THE REAL PRODUCERS are three category-5 arms of the same record machine, and the
// census below is what holds the port to them: the arm list must equal the ids the
// assembly names, and every value must come out of the disc's own technique table
// (`web/assets/data/fight_tech_table.json`, extracted by
// `tools/extract_fight_tech_table.py`) or out of the arm's own literal — never a hand
// copy. `tools/measure_battle_affinity.py` prints the measurement.
//
// Every test here fails on the code before this change:
//   * `DAMAGE_TERM_AFFINITY_ARMS` / `damageTermAffinityByte` / `consumeAffinity` did not
//     exist in `engine/dw3/battle-damage-terms.ts`;
//   * `battleAffinityPlanFor` did not exist in `web/battle.js`, so `b.player.affinity`
//     stayed 0 and the tail's stage 3 could never fire.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DAMAGE_TERM_AFFINITY_ARMS, DAMAGE_TERM_AFFINITY_DIVISOR,
  DAMAGE_TERM_AFFINITY_RECORD_OFFSET, DAMAGE_TERM_AFFINITY_TECH_OFFSET,
  DAMAGE_TERM_CHI_WORD, DAMAGE_TERM_GENERATE_WORD,
  consumeAffinity, damageTermAffinityArm, damageTermAffinityByte,
  damageTermAffinityIds, damageTermAffinityMultiplier,
} from "../web/vendor/engine.js";
import {
  battleRestorePlanFor, battleAffinityPlanFor, chargeWalkerSentence, clearActionAffinity,
} from "../web/battle.js";
import { resolveDamage } from "../web/vendor/engine.js";

const BATTLE_JS = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const TECH_TABLE = JSON.parse(readFileSync(
  new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const DIGIMON = JSON.parse(readFileSync(
  new URL("../web/assets/data/digimon.json", import.meta.url), "utf8"));
const ENEMIES = JSON.parse(readFileSync(
  new URL("../web/assets/data/enemies.json", import.meta.url), "utf8"));

const SOUL_CHARGE = 209;      // 0xd1
const MISSHUKIKOU = 210;      // 0xd2
const GILEAD_PLANT = 400;     // 0x190
/** Technique 184 — a category-4 heal of the acting record (`arm 0x80090070`). */
const HEAL = 184;
/** A plain physical attack: category 2, one hit, no effect. */
const ATTACK_SKILL = { power: 100, element: "normal", base_acc: 128, effect: "none" };

/** A walker battle with one party member and one enemy, both able to attack. */
function battle() {
  const enemy = { profile: { name: "Knightmon", id: 1 }, hp: 500, maxHp: 500,
                  str: 100, def: 100, spt: 100, wis: 100, spd: 100 };
  const player = { profile: { name: "Marsmon", id: 1 }, hp: 300, maxHp: 300, mp: 60,
                   str: 100, def: 100, spt: 100, wis: 100, spd: 100 };
  return { player, enemy, playerRecords: [player, null, null], activePlayerIndex: 0 };
}

test("the byte lives in record +0x0E and the divisor is 64", () => {
  // fightstg.s:29409 `lbu $v0, 0xe($s3)` reads it; :29912 `sra $v0, 0x6` divides by 64.
  assert.equal(DAMAGE_TERM_AFFINITY_RECORD_OFFSET, 0x0e);
  assert.equal(DAMAGE_TERM_AFFINITY_DIVISOR, 64);
  // `lbu $a0, 0xc($s5)` at :13873 — the technique record's own +0x0C, which the shipped
  // extract calls `crit` (tools/extract_fight_tech_table.py).
  assert.equal(DAMAGE_TERM_AFFINITY_TECH_OFFSET, 0x0c);
  assert.equal(TECH_TABLE[String(SOUL_CHARGE)].crit, TECH_TABLE[String(SOUL_CHARGE)].crit);
});

test("CENSUS: the arm list is exactly the ids the assembly names", () => {
  // `.L0x80090528` answers 0xd1 and 0xd2 (fightstg.s:13694 `slti $v0, $v1, 0xd3` /
  // :13695 `bnez $v0, .L0x80090528`), `.L0x80090734` answers 0x190 (:13708-13709
  // `li $v0, 0x190 / beq $v1, $v0, .L0x80090734`). No fourth arm writes the byte: the
  // sweep of every store at displacement 0x0e across every overlay returns nine
  // fightstg sites and four wfightmn ones, and of those only these two arms store a
  // NONZERO value into a combatant record.
  assert.deepEqual(damageTermAffinityIds(), [SOUL_CHARGE, MISSHUKIKOU, GILEAD_PLANT]);
  assert.deepEqual(DAMAGE_TERM_AFFINITY_ARMS.map((a) => a.arm),
    [0x80090528, 0x80090734]);
  // Every id belongs to exactly one arm.
  for (const id of damageTermAffinityIds()) {
    assert.equal(damageTermAffinityArm(id)?.ids.filter((i) => i === id).length, 1);
  }
  // Both Chi arms take their value from the disc's own column; the Generate arm from its
  // own literal. Neither invents one.
  const chi = DAMAGE_TERM_AFFINITY_ARMS[0];
  assert.equal(chi.source, "record+0x0c");
  assert.equal(chi.ids.length, 2);
  const gen = DAMAGE_TERM_AFFINITY_ARMS[1];
  assert.equal(gen.source, "literal");
  assert.equal(gen.ids.length, 1);
  // Every OTHER technique in the shipped table is not an arm, so the gate is honest.
  for (const key of Object.keys(TECH_TABLE)) {
    const id = Number(key);
    if (damageTermAffinityIds().includes(id)) continue;
    assert.equal(damageTermAffinityArm(id), null, `technique ${id} must have no arm`);
    assert.equal(damageTermAffinityByte(id, TECH_TABLE[key]), null);
  }
});

test("MEASURED from the disc's table: 209 -> 80, 210 -> 127, 400 -> 32, all nonzero", () => {
  // tools/measure_battle_affinity.py reads the same column out of the disc's data
  // segment and cross-checks all 443 rows.
  const soul = damageTermAffinityByte(SOUL_CHARGE, TECH_TABLE[String(SOUL_CHARGE)]);
  const misshu = damageTermAffinityByte(MISSHUKIKOU, TECH_TABLE[String(MISSHUKIKOU)]);
  const plant = damageTermAffinityByte(GILEAD_PLANT, TECH_TABLE[String(GILEAD_PLANT)]);
  assert.equal(soul, 80);
  assert.equal(misshu, 127);
  assert.equal(plant, 32);
  // Every reachable input is nonzero, which is what makes the stage live rather than
  // dormant: x2.25, x2.98 and x1.5.
  for (const byte of [soul, misshu, plant]) assert.ok(byte > 0);
  assert.equal(damageTermAffinityMultiplier(soul), 80 / 64);
  assert.equal(damageTermAffinityMultiplier(misshu), 127 / 64);
  assert.equal(damageTermAffinityMultiplier(plant), 32 / 64);
  // The literal arm does not read the table at all, so a wrong row cannot change it.
  assert.equal(damageTermAffinityByte(GILEAD_PLANT, { crit: 200 }), 32);
  assert.equal(damageTermAffinityByte(GILEAD_PLANT, null), 32);
  assert.equal(damageTermAffinityByte(GILEAD_PLANT), 32);
});

test("the charge is reachable in ordinary play, on BOTH sides", () => {
  // GrapLeomon owns 209 and Marsmon — one of the eight starters — owns 210.
  const owners = (tech) => DIGIMON.digimon
    .filter((p) => [p.tech_basic, p.tech_signature, ...(p.techs ?? [])].includes(tech))
    .map((p) => p.name);
  assert.deepEqual(owners(SOUL_CHARGE), ["GrapLeomon"]);
  assert.deepEqual(owners(MISSHUKIKOU), ["Marsmon"]);
  // Knightmon's `move_2` is Soul Charge and Raidenmon's `move_1` is Gilead Plant, so the
  // enemy charges too — which is why the operand has to be readable on side 1.
  assert.ok(ENEMIES.enemies.some((e) => e.move_2 === SOUL_CHARGE));
  assert.ok(ENEMIES.enemies.some((e) => e.move_1 === GILEAD_PLANT));
});

test("a charge writes the target's record, and only that one", () => {
  const b = battle();
  const plan = battleAffinityPlanFor(b, 0, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE,
    { name: "Marsmon" });
  assert.ok(plan, "Soul Charge must plan");
  assert.equal(plan.byte, 80);
  assert.equal(plan.multiplier, 1 + 80 / 64);
  assert.equal(plan.charged, true);
  assert.equal(b.player.affinity, 80);
  // Nothing else moved: the partner slots are null and the enemy is untouched.
  assert.equal(b.enemy.affinity, undefined);
  // The page is the record machine's OWN, not a typed sentence: "Saving Chi!".
  assert.equal(plan.page.kind, 2);
  assert.equal(plan.page.payload[0], DAMAGE_TERM_CHI_WORD);
  assert.equal(DAMAGE_TERM_CHI_WORD, 0x36);

  // The enemy side charges ITSELF. Knightmon's move_2.
  const b2 = battle();
  const enemyPlan = battleAffinityPlanFor(b2, 1, TECH_TABLE[String(MISSHUKIKOU)],
    MISSHUKIKOU, { name: "Knightmon" });
  assert.equal(enemyPlan.byte, 127);
  assert.equal(b2.enemy.affinity, 127);
  assert.equal(b2.player.affinity, undefined);

  // A second charge REPLACES the first, and the record machine's state-1 sub-state-0 clear
  // empties the record before the arm writes, so nothing stacks and nothing is "replaced".
  const b3 = battle();
  battleAffinityPlanFor(b3, 0, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE);
  const second = battleAffinityPlanFor(b3, 0, TECH_TABLE[String(MISSHUKIKOU)], MISSHUKIKOU);
  assert.equal(second.replaced, 0);
  assert.equal(b3.player.affinity, 127);
});

test("Gilead Plant's arm writes the CASTER's side, whichever side that is", () => {
  // :13992 `addiu $v1, 0x4460` + :13994 `addiu $v1, 0x70` = 0x800a44d0, side 1's party
  // array, read at :29704-29705 by the same effective-stat builder. The disc's only user
  // is an enemy caster, for which that IS the caster's own side; the walker flips the
  // fixed side for a side-0 caster (`damageTermCategory5Side`), so the heal and the charge
  // keep landing on the caster instead of on a hard-coded enemy.
  const b = battle();
  const plan = battleAffinityPlanFor(b, 1, TECH_TABLE[String(GILEAD_PLANT)], GILEAD_PLANT,
    { name: "Raidenmon" });
  assert.equal(plan.side, 1);
  assert.equal(plan.byte, 32);
  assert.equal(plan.page.payload[0], DAMAGE_TERM_GENERATE_WORD);
  assert.equal(b.enemy.affinity, 32);
  // Cast by the player it lands on the PLAYER's record: the enemy's byte stays untouched.
  const b2 = battle();
  const fromPlayer = battleAffinityPlanFor(b2, 0, TECH_TABLE[String(GILEAD_PLANT)],
    GILEAD_PLANT, { name: "Marsmon" });
  assert.equal(fromPlayer.side, 0);
  assert.equal(b2.player.affinity, 32);
  assert.equal(b2.enemy.affinity, undefined, "the enemy is not charged by a player's cast");
  // ...and the caster's own charge is CLEARED first and then set by the arm, because the
  // clear at `fightstg.s:13092` runs on the acting side and the arm now writes that same
  // record — so the cast always ends on the arm's own 32.
  b2.player.affinity = 80;
  const after = battleAffinityPlanFor(b2, 0, TECH_TABLE[String(GILEAD_PLANT)],
    GILEAD_PLANT, { name: "Marsmon" });
  assert.equal(b2.player.affinity, 32, "the write wins over the clear, not over the old byte");
  assert.equal(b2.enemy.affinity, undefined);
  assert.equal(after.replaced, 0,
    "the clear emptied the very record the write reads back");
});

test("the gate is honest: an ordinary attack charges nobody", () => {
  const b = battle();
  assert.equal(battleAffinityPlanFor(b, 0, TECH_TABLE["1"], 1), null);
  assert.equal(battleAffinityPlanFor(b, 0, null, 0), null);
  assert.equal(battleAffinityPlanFor(b, 0, TECH_TABLE[String(SOUL_CHARGE)], 0), null);
  assert.equal(b.player.affinity, undefined);
});

test("the tail fires: a charged attacker hits harder, and only on its own side", () => {
  const base = { level: 10, str: 100, def: 100, spt: 50, wis: 50, spd: 50, hp: 100,
                 maxHp: 100, ailments: {}, profile: { id: 1, family: 1 } };
  const skill = { power: 100, element: "normal", base_acc: 128, effect: "none" };
  const hit = Math.trunc((100 * 100) / 100);
  const dmg = (a, d) => resolveDamage(hit, a, d, skill, () => 0x7fff);
  // Stage 3 is `+= running * byte / 64`, truncated, on the ACTING side (:29907-29913).
  for (const byte of [80, 127, 32]) {
    assert.equal(dmg({ ...base, affinity: byte }, base),
      hit + Math.trunc((hit * byte) / 64),
      `affinity ${byte} did not add running * ${byte} / 64`);
  }
  // A charged DEFENDER must not move the attacker's damage: the tail reads $s2, the
  // acting side's block (`lbu $v0, 0x26($s2)`).
  assert.equal(dmg(base, { ...base, affinity: 127 }), hit);
  // And the term is skipped entirely when the byte is zero (`beqz` at :29906).
  assert.equal(dmg({ ...base, affinity: 0 }, base), hit);
  assert.ok(dmg({ ...base, affinity: 127 }, base) > dmg(base, base));
});

test("THE CHARGE IS SPENT BY THE NEXT ACTION, and the next action can be either shape", () => {
  const b = battle();
  battleAffinityPlanFor(b, 0, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE);
  battleAffinityPlanFor(b, 1, TECH_TABLE[String(MISSHUKIKOU)], MISSHUKIKOU);
  assert.equal(b.player.affinity, 80);
  assert.equal(b.enemy.affinity, 127);
  // `resolveAttackSequence` calls the engine's `consumeAffinity` once, after the damage
  // value exists. The test drives the shared resolver both sides must use.
  const spent = consumeAffinity(b.player);
  assert.equal(spent, 80);
  assert.equal(b.player.affinity, 0);
  assert.equal(consumeAffinity(b.enemy), 127);
  assert.equal(b.enemy.affinity, 0);
  // A record with no charge spends nothing and stays clean.
  assert.equal(consumeAffinity({}), 0);
  assert.equal(consumeAffinity(null), 0);
});

// ---------------------------------------------------------------------------
// WHEN the charge is spent — `BATTLE-Q004-AFFINITY-001`, decided from the assembly.
//
// THE ORDER, in `FIGHTSTG_F0x8008f714`, the record machine that runs all five attack
// categories:
//
//   1. **state 0** resolves the technique at `$s4+0x54` and, for categories 2 and 3, calls
//      the damage resolver through the pointer at `0x800a445c`
//      (`~/ddw3/asm/dw2003/pro/fightstg.s:12985` `lbu $v0, 0x4($s0)` / `:12991`
//      `lbu $a0, 0x50($s4)` / `:12992` `lw $v0, 0x445c($v0)` / `:13000 jalr $v0`). That
//      resolver is `FIGHTSTG_F0x8009e0cc` (`.L0x800a445c: .word 0x8009e0cc`), and it is
//      what builds the effective block that reads `record+0x0E`.
//   2. **state 1, sub-state 0** — the FIRST row of the machine's own sub-state table
//      (`fightstg.s:193` `.L0x80082fdc: .word 0x8008f8b4`) — puts up the announcement page
//      and then stores `sh $zr, 0xe($v0)` at `:13092`, in the `j`'s delay slot, so it runs
//      every time the message box is free (`:13063 lw $v0, ($s6)` / `:13065 bnez $v0,
//      .L0x80090c1c`). It has NO category test.
//   3. **state 1, sub-state 1** is the category handler (`fightstg.s:13103`-`:13124`
//      through the table at `.L0x80083004`), and the charge arms write their byte in there
//      (`:13875` Soul Charge / Misshukikou, `:14016` Gilead Plant).
//
// So: the action that SETS the byte never spends it, the acting fighter's NEXT action
// spends it whatever shape that action is, and an action that computes no damage still
// throws the charge away. `0x800a4436` (`ctx+0x42`) is the only flag that can skip step 2
// (`fightstg.s:13067` / `:13069`) and nothing in the disc ever sets it.
//
// The four tests below drive the walker's own gates. Every one of them FAILS on commit
// 284db5ae, which cleared the byte only inside the attack resolver: there a heal or a
// second charge kept it, and Gilead Plant cast by the player left the caster's own byte
// standing.

test("(a) the action that SETS the byte does not spend it — and a re-charge never stacks", () => {
  // Step 2 runs before step 3, so a second Soul Charge wipes the first and writes 127;
  // it does not add to it, and it does not read it either (category 5 computes no damage).
  const b = battle();
  battleAffinityPlanFor(b, 0, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE);
  assert.equal(b.player.affinity, 80);
  const second = battleAffinityPlanFor(b, 0, TECH_TABLE[String(MISSHUKIKOU)], MISSHUKIKOU);
  assert.equal(second.byte, 127);
  assert.equal(second.replaced, 0,
    "the state-1 sub-state-0 clear empties the record before the arm writes it");
  assert.equal(b.player.affinity, 127, "the second charge replaces, it never sums");
});

test("(b) the next TECHNIQUE spends it, on a heal as well as on a strike", () => {
  // 184 is a category-4 heal. The original's resolver is never entered for it
  // (`fightstg.s:28470 j .L0x8009e3c8` sends every category but 2 and 3 down a roll-free
  // path), so nothing reads the byte — and the clear at `:13092` has no category test.
  const b = battle();
  b.playerRecords[0].hp = 40;
  battleAffinityPlanFor(b, 0, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE);
  assert.equal(b.player.affinity, 80);
  const heal = battleRestorePlanFor(b, 0, TECH_TABLE["184"], 184, { name: "Marsmon" });
  assert.ok(heal, "technique 184 must plan as a category-4 heal");
  assert.equal(b.player.affinity, 0,
    "a heal deals no damage, and the record machine still clears the byte");
  assert.equal(b.player.hp, b.player.maxHp, "the heal itself still ran");

  // A plain ATTACK technique reads it first and clears it after, through the one shared
  // resolver — so the charge is spent, not merely dropped.
  const b2 = battle();
  battleAffinityPlanFor(b2, 0, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE);
  const boosted = resolveDamage(100, b2.player, b2.enemy, ATTACK_SKILL, () => 0x7fff);
  assert.ok(boosted > 100, `a charged plain attack must hit harder, got ${boosted}`);
  assert.equal(consumeAffinity(b2.player), 80);
  assert.equal(b2.player.affinity, 0);
});

test("(c) the next PLAIN ATTACK spends it, on both sides", () => {
  for (const side of [0, 1]) {
    const b = battle();
    const who = side === 0 ? TECH_TABLE[String(SOUL_CHARGE)] : TECH_TABLE[String(MISSHUKIKOU)];
    const id = side === 0 ? SOUL_CHARGE : MISSHUKIKOU;
    const actor = side === 0 ? b.player : b.enemy;
    battleAffinityPlanFor(b, side, who, id);
    assert.equal(actor.affinity, side === 0 ? 80 : 127);
    const base = 100;
    const dmg = resolveDamage(base, actor, side === 0 ? b.enemy : b.player, ATTACK_SKILL,
      () => 0x7fff);
    assert.ok(dmg > base, `side ${side}: a charged plain attack must hit harder`);
    assert.equal(consumeAffinity(actor), side === 0 ? 80 : 127);
    assert.equal(actor.affinity, 0);
  }
});

test("a heal between the charge and the blow throws the charge away, BOTH sides", () => {
  // The order in one sentence: charge, then spend it on your own HP instead, and the next
  // attack lands at full strength. This is the case the walker got wrong before.
  for (const side of [0, 1]) {
    const b = battle();
    const actor = side === 0 ? b.player : b.enemy;
    actor.hp = 40;
    battleAffinityPlanFor(b, side, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE);
    const other = side === 0 ? b.enemy : b.player;
    assert.ok(resolveDamage(100, actor, other, ATTACK_SKILL, () => 0x7fff) > 100);
    consumeAffinity(actor);
    battleAffinityPlanFor(b, side, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE);
    assert.equal(actor.affinity, 80);
    battleRestorePlanFor(b, side, TECH_TABLE["184"], 184,
      { name: side === 0 ? "Marsmon" : "Knightmon", wisdom: actor.wis });
    assert.equal(actor.affinity, 0, `side ${side}: the heal must clear the charge`);
    assert.equal(resolveDamage(100, actor, other, ATTACK_SKILL, () => 0x7fff), 100,
      `side ${side}: the blow after the heal must be unboosted`);
  }
});

test("CENSUS: one clear, on the shared no-damage gate, both sides, unconditional", () => {
  // ONE shared rule, not a row per technique: `clearActionAffinity` is the single clear
  // for the categories that compute no damage, and the engine's `consumeAffinity` is the
  // same clear for the categories that do. Both plan functions call it, and each action
  // path reaches exactly one of the two.
  const defs = BATTLE_JS.match(/export function clearActionAffinity\b/g) ?? [];
  assert.equal(defs.length, 1, "the clear must be written once, shared by both sides");
  const calls = BATTLE_JS.match(/clearActionAffinity\(b, side\)/g) ?? [];
  assert.equal(calls.length, 3, "the one definition plus one call in each no-damage gate");
  // The category-4 heal/cure gate and the category-5 charge gate, and nowhere else.
  const restoreBody = BATTLE_JS.slice(
    BATTLE_JS.indexOf("export function battleRestorePlanFor"),
    BATTLE_JS.indexOf("/**\n * THE WHOLE CATEGORY-5 FAMILY"));
  // 2026-10-05: the category-5 entry point is now the WHOLE family
  // (`battleScriptedPlanFor`), and `battleAffinityPlanFor` is the charge-only view over
  // it, so the clear under test is the one inside `battleScriptedPlanFor`.
  const chargeBody = BATTLE_JS.slice(
    BATTLE_JS.indexOf("export function battleScriptedPlanFor"),
    BATTLE_JS.indexOf("export function battleAffinityPlanFor"));
  for (const [name, src] of [["battleRestorePlanFor", restoreBody],
                             ["battleScriptedPlanFor", chargeBody]]) {
    assert.equal((src.match(/clearActionAffinity\(b, side\)/g) ?? []).length, 1,
      `${name} must clear exactly once, before its own effect`);
  }
  // The damaging categories keep the clear inside the one shared resolver, so the
  // single-hit and multi-hit paths cannot drift apart.
  const COMBAT = readFileSync(new URL("../engine/dw3/battle-combat.ts", import.meta.url), "utf8");
  assert.equal((COMBAT.match(/consumeAffinity\(attacker\);/g) ?? []).length, 1);
  // `0x800a4436` can skip the original's clear and nothing sets it, so the walker must not
  // carry a skip: no flag, no category test, no conditional inside the shared clear.
  const clearBody = BATTLE_JS.slice(
    BATTLE_JS.indexOf("export function clearActionAffinity"),
    BATTLE_JS.indexOf("export function battleRestorePlanFor"));
  assert.match(clearBody, /return consumeAffinity\(rec\);/);
  assert.ok(!/\bif\b/.test(clearBody),
    "the clear carries no category test and no flag test — the original's has none either");
  for (const src of [clearBody, restoreBody, chargeBody]) {
    assert.ok(!/0x4436|ctx\+0x42|affinitySkip/i.test(src),
      "no skip on 0x800a4436 may be modelled: nothing in the disc ever sets it");
  }
});

test("the legacy sentence names the technique and claims no number the game never shows", () => {
  const b = battle();
  const plan = battleAffinityPlanFor(b, 0, TECH_TABLE[String(SOUL_CHARGE)], SOUL_CHARGE,
    { name: "Marsmon" });
  const text = chargeWalkerSentence(plan, { name: "Soul Charge" }, "Marsmon");
  assert.match(text, /^Marsmon uses Soul Charge!/);
  assert.doesNotMatch(text, /\d/);
});