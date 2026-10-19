// The category-5 scripted technique family, every member, on both sides of a battle.
//
// WHAT WAS WRONG BEFORE. `web/battle.js` had `battleAffinityPlanFor`, which answered for
// THREE of the eighteen category-5 records (the two Chi arms and Gilead Plant's charge
// byte) and returned null for the other fifteen. So Double Power / Double Guard / Speed
// Up and their three party-wide twins did nothing at all — no stat moved, no page — and
// four more arms had the WRONG reason for what they did:
//
//   * 211 / 212 were read as story-flag refusals. The words at `0x800a4648` / `0x800a464c`
//     are FUNCTION POINTERS (fightstg.s:35038-35039), and all three of the bodies behind
//     them are the same roll: `(rand & 0x7f) < record[+0x0B]`
//     (:31834 `lbu $s0, 0xb($v1)` / :31864 `andi $v0, 0x7f` / :31865 `slt $v0, $s0`), with
//     `$a1` the TECHNIQUE id the arm's delay slot names (`li $a1, 0xd3` :13887,
//     `li $a1, 0xd4` :13905). A lost roll prints a BLANK line through kind 1
//     (`sw $v0, 0x64($s4)` :13896 stores the getter's own zero), not "No effect!".
//   * 199 / 201 / 203 were given the one-fighter page. They are the PARTY arm
//     `.L0x800903f4`, whose page is kind 9 (`li $a1, 0x9` :13859).
//   * 392 was documented as walking the party for a combatant with MP. It reads the two
//     ACTIVE indices and moves MP off the player's active fighter onto the enemy's
//     (:13938 / :13939), and never walks anything.
//   * 400's heal was skipped entirely: only its charge byte was written.
//
// WHAT WAS WRONG AGAIN, in the correction pass on c163fde1 (the three reads below all came
// from ignoring that an instruction in a branch's DELAY SLOT always runs):
//
//   * 400's heal read RECORD 2's power. `li $a1, 0x2` (:13696) is the delay slot of the
//     209/210 branch and never reaches this arm; the branch that DOES reach it leaves
//     `$a1` at 400 (`li $a1, 0x190` :13710), so the amount is record 400's own power.
//   * A LOST ROLL prints `esmfight[0x2f]` "No effect!", not a blank line: `li $v0, 0x2f`
//     sits in the delay slot of the roll's `beqz` (:13889 / :13907 / :13924), so the
//     store the branch target makes (:13896 / :13914 / :13931) writes 0x2f.
//   * 391's roll function is NOT the body 211/212 share. `[0x800a4640]` is
//     `FIGHTSTG_F0x800a13c0`, which walks eight `DIGIMON_PROFILES` rows against the
//     player's active record `+0x10` and answers zero on a match WITHOUT drawing.
//
// The census below is what holds the port to the arm list: every category-5 record in the
// shipped 443-row table must land on exactly one of the eight arms, that arm list must be
// the one the assembly's nine comparisons produce, and every value must come out of the
// disc's own table (`web/assets/data/fight_tech_table.json`) or the arm's own literal.
//
// Every test here fails on the code before this change: `category5Plan`,
// `damageTermCategory5Arm`, `damageTermStatRow`, `damageTermStatModifier`,
// `damageTermMpMoved`, `damageTermPartyWord`, `damageTermRoll`, `battleScriptedPlanFor`
// and `scriptedWalkerSentence` did not exist, and the eleven stat-family records changed
// nothing on either side.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DAMAGE_TERM_ARMS_CATEGORY5, DAMAGE_TERM_CHI_WORD, DAMAGE_TERM_HEAL_POWER_ID,
  DAMAGE_TERM_ROLL_DIGIVOLVE,
  DAMAGE_TERM_ROLL_FLEE, DAMAGE_TERM_ROLL_STATUS, DAMAGE_TERM_STAT_BLOCK_BASE,
  DAMAGE_TERM_STAT_NAMES, DAMAGE_TERM_STAT_RECORD_OFFSETS, DAMAGE_TERM_STAT_ROWS,
  DAMAGE_TERM_STAT_TABLE_ONE, DAMAGE_TERM_STAT_TABLE_PARTY, DAMAGE_TERM_STATUS_ROLL_PROFILES,
  category5Plan, damageTermCategory5Arm, damageTermCategory5Side, damageTermHealAmount,
  damageTermMpMoved, damageTermPartyWord, damageTermRoll, damageTermStatApplies,
  damageTermStatModifier, damageTermStatRow, damageTermStatusRollBlocked,
  damageTermTechniqueIds, effStats,
  emptyStatusEventPool, statusEventLockHeld, statusEventActionDelay,
} from "../web/vendor/engine.js";
import {
  battleScriptedPlanFor, scriptedWalkerSentence, clearActionAffinity,
  battleStatusEventAdvance,
} from "../web/battle.js";
import { battleAilmentByte } from "../web/battlecmd-translated.js";

const BATTLE_JS = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const TECH_TABLE = JSON.parse(readFileSync(
  new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;

/** Every category-5 record in the shipped table, ascending. */
const CATEGORY5_IDS = damageTermTechniqueIds(TECH_TABLE, 5);

/** A walker battle: one party member and one enemy, both able to act. */
function battle() {
  const enemy = {
    profile: { name: "Knightmon", id: 1, family: 1 }, level: 10, hp: 500, maxHp: 500,
    mp: 100, maxMp: 100, str: 100, def: 100, spt: 100, wis: 100, spd: 100,
    affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {},
  };
  const player = {
    profile: { name: "Marsmon", id: 1, family: 1 }, level: 10, hp: 300, maxHp: 300,
    mp: 60, maxMp: 60, str: 100, def: 100, spt: 100, wis: 40, spd: 100,
    affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {},
  };
  return {
    player, enemy, playerRecords: [player, null, null], activePlayerIndex: 0,
    encounterGateBytes: new Array(14).fill(0),
  };
}

const record = (id) => TECH_TABLE[String(id)];

// ── The census ───────────────────────────────────────────────────────────────

test("CENSUS: every category-5 record lands on exactly one of the eight arms", () => {
  // The eighteen ids, from the shipped table's own `category` byte — nothing is
  // hand-listed here.
  assert.deepEqual(CATEGORY5_IDS, [198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208,
    209, 210, 211, 212, 391, 392, 400]);
  assert.equal(DAMAGE_TERM_ARMS_CATEGORY5.length, 8);
  const listed = DAMAGE_TERM_ARMS_CATEGORY5.flatMap((a) => [...a.ids]);
  assert.deepEqual([...listed].sort((a, b) => a - b), CATEGORY5_IDS,
    "the arm list and the disc's own category-5 ids must be the same set");
  for (const id of CATEGORY5_IDS) {
    const owners = DAMAGE_TERM_ARMS_CATEGORY5.filter((a) => a.ids.includes(id));
    assert.equal(owners.length, 1, `technique ${id} is on ${owners.length} arms`);
  }
  // And the reverse: every other record in the 443 has no category-5 arm, so the gate is
  // honest — a plain attack must not plan.
  for (const key of Object.keys(TECH_TABLE)) {
    const id = Number(key);
    if (CATEGORY5_IDS.includes(id)) continue;
    assert.equal(damageTermCategory5Arm(id), null, `technique ${id} must have no arm`);
    assert.equal(category5Plan(TECH_TABLE[key], id, { side: 0 }), null);
  }
});

test("CENSUS: the arm list is the one the handler's nine comparisons produce", () => {
  // fightstg.s:13670-:13712 — `slti`/`li`/`beq`/`bnez`/`j` on the technique id at
  // `lw $v1, 0x54($s4)` (:13668). Nine compares, no table beyond the two stat tables.
  const armOf = (id) => damageTermCategory5Arm(id)?.arm ?? null;
  // id < 0xd1 fails `slti $v0, $v1, 0xd1` (:13670) -> the 0xd1..0xd4 block.
  assert.equal(armOf(0xd1), 0x80090528, "0xd1 fails :13670's < 0xd1? no -> .L0x80090280");
  assert.equal(armOf(0xd2), 0x80090528);
  assert.equal(armOf(0xd3), 0x80090584, "0xd3 is NOT < 0xd3, so it falls to the flee arm");
  assert.equal(armOf(0xd4), 0x800905c8, "0xd4 is `li $v0, 0xd4 / beq` at :13690-:13691");
  // id >= 0xd5 reaches :13699 and the 0x187/0x188/0x189/0x190 compares.
  assert.equal(armOf(0x187), 0x80090610);
  assert.equal(armOf(0x188), 0x80090654);
  assert.equal(armOf(0x190), 0x80090734);
  // The ranges: everything in [0xcc, 0xd1) goes to the one-stat table arm
  // (`slti $v0, $v1, 0xcc` :13672 / `beqz $v0, .L0x800902dc` :13673).
  for (const id of [0xcc, 0xcd, 0xce, 0xcf, 0xd0]) {
    assert.equal(armOf(id), 0x800902dc, `0x${id.toString(16)} is inside the 0xcc range`);
  }
  // The three explicit compares below it: 0xc6 and 0xc8 to the one-stat arm, 0xca too,
  // and 0xc7 to the party arm (`li $v0, 0xc7 / beq $v1, $v0, .L0x800903f4` :13680-13681).
  assert.equal(armOf(0xc6), 0x800902dc);
  assert.equal(armOf(0xc7), 0x800903f4);
  assert.equal(armOf(0xc8), 0x800902dc);
  assert.equal(armOf(0xc9), 0x800903f4, "0xc9 skips 0xc8 and lands on the party arm's jump");
  assert.equal(armOf(0xca), 0x800902dc);
  assert.equal(armOf(0xcb), 0x800903f4);
  // Everything else reaches `j .L0x8009096c` (:13683 / :13706 / :13711) — no page at all.
  for (const id of [0, 1, 100, 197, 0xd5, 0x186, 0x189, 0x18f, 0x191, 442]) {
    assert.equal(armOf(id), null, `technique ${id} must reach no arm`);
  }
});

test("CENSUS: the two stat tables are the eleven rows the assembly lists", () => {
  // `.L0x800a33cc` (:33855-:33870) is eight rows and a -1 terminator; `.L0x800a3414`
  // (:33873-:33878) is three rows and a terminator. Each row is
  // `{i16 id, i16 direction, i16 stat, i16 word}`.
  assert.deepEqual(DAMAGE_TERM_STAT_TABLE_ONE.map((r) => [r.id, r.direction, r.stat, r.word]),
    [[198, 1, 0, 0x30], [200, 1, 1, 0x31], [202, 1, 2, 0x32],
      [204, -1, 0, 0x33], [205, -1, 1, 0x34], [206, -1, 1, 0x34],
      [207, -1, 2, 0x35], [208, -1, 2, 0x35]]);
  assert.deepEqual(DAMAGE_TERM_STAT_TABLE_PARTY.map((r) => [r.id, r.direction, r.stat, r.word]),
    [[199, 1, 0, 0x30], [201, 1, 1, 0x31], [203, 1, 2, 0x32]]);
  assert.equal(DAMAGE_TERM_STAT_ROWS.length, 11);
  // The words are the disc's own bank, so the arrow words are the game's and not ours.
  for (const row of DAMAGE_TERM_STAT_ROWS) {
    assert.ok(ESMFIGHT[row.word].includes("arrow"),
      `esmfight[0x${row.word.toString(16)}] must be one of the stat words`);
  }
  // `.L0x800a4694` (:35080-:35081) is `0x00010000, 0x00000004`, so the halfwords are
  // [0, 1, 4] and the block offsets are +0x02 / +0x04 / +0x0a — attack / defense / speed.
  assert.deepEqual([...DAMAGE_TERM_STAT_BLOCK_BASE], [0, 1, 4]);
  assert.deepEqual(DAMAGE_TERM_STAT_NAMES.map((_n, i) => 0x02 + 2 * DAMAGE_TERM_STAT_BLOCK_BASE[i]),
    [0x02, 0x04, 0x0a]);
  assert.deepEqual([...DAMAGE_TERM_STAT_RECORD_OFFSETS], [0x10, 0x12, 0x14]);
  // Every row's stat index is one of the three, so no row can address past the table.
  for (const row of DAMAGE_TERM_STAT_ROWS) {
    assert.ok(row.stat >= 0 && row.stat <= 2, `stat ${row.stat} is out of range`);
    assert.equal(damageTermStatRow(row.id), row);
  }
  assert.equal(damageTermStatRow(209), null, "a Chi arm has no stat row");
});

// ── One behaviour test per arm ───────────────────────────────────────────────

test("ARM 0x800902dc, one stat on one fighter: a raise and a drop, both sides", () => {
  // 198 Double Power (attack up, magnitude 48) on the caster; 205 Armor Break
  // (defense down, magnitude -24) on the OTHER side, because `xor $s2, $a0` (:13738)
  // with `$a0 = 1` (:13731) lands the down rows on the far side.
  const b = battle();
  const up = battleScriptedPlanFor(b, 0, record(198), 198, { name: "Marsmon" });
  assert.equal(up.effect, "statOne");
  assert.equal(up.side, 0, "an up row keeps the acting side");
  assert.equal(up.stats.length, 1);
  assert.equal(up.stats[0].stat, 0, "198's row addresses attack");
  // delta = trunc(eff * 48 / 128) on the target's own effective attack (100) = 37.
  assert.equal(up.stats[0].modifier, 37);
  assert.equal(b.player.statMods.str, 37);
  // ...and the effective block reads it back: 100 base + 37 modifier.
  assert.equal(effStats(b.player).str, 137);
  assert.equal(up.page.kind, 2);
  // Word 1 is `$s2 << 4` over the side this arm picked (pro/fightstg.s:13760 over the
  // `srl $s2, $v1, 0x4` at :13734, stored by `sw $s2, 0x68($s4)` :13778): 0 for the player,
  // 16 for the enemy. It is the TARGET side, the other way round from the `sltiu` selector
  // the category-2/3 arms use.
  assert.deepEqual(up.page.payload, [0x30, 0, 0], "the target side * 16 is in word 1");

  const b2 = battle();
  const down = battleScriptedPlanFor(b2, 0, record(205), 205, { name: "Marsmon" });
  assert.equal(down.side, 1, "a down row XORs the side, so it lands on the enemy");
  assert.equal(down.stats[0].stat, 1);
  // trunc(100 * -24 / 128) = -18, and the lower bound -trunc(100/2) = -50 lets it through.
  assert.equal(down.stats[0].modifier, -18);
  assert.equal(b2.enemy.statMods.def, -18);
  assert.equal(effStats(b2.enemy).def, 82, "the block adds it modularly: 100 - 18");

  // The ENEMY casting the same debuff lands it on the player, symmetrically.
  const b3 = battle();
  const fromEnemy = battleScriptedPlanFor(b3, 1, record(207), 207, { name: "Knightmon" });
  assert.equal(fromEnemy.side, 0);
  assert.equal(b3.player.statMods.spd, -12, "trunc(100 * -16 / 128) = -12 (toward zero)");
});

test("ARM 0x800902dc's per-encounter gate refuses a debuff and leaves the stat alone", () => {
  // `lbu $v0, 0x46($v1)` at :13743 reads 0x80042b1c + stat + 0x46, which is three of the
  // fourteen bytes the battle setup copies from the screen's own record. Index 0 here is
  // 0x80042b62 — the 11th byte of the walker's own `encounterGateBytes` run.
  const b = battle();
  b.encounterGateBytes[11] = 1;   // 0x80042b63: the defense byte
  const refused = battleScriptedPlanFor(b, 0, record(205), 205, { name: "Marsmon" });
  assert.equal(refused.refused, true);
  assert.equal(refused.stats.length, 0, "a refused arm writes nothing");
  assert.equal(b.enemy.statMods.def, 0);
  assert.equal(refused.page.kind, 1);
  assert.equal(refused.page.payload[0], 0x2f, "esmfight[0x2f] 'No effect!'");
  // The gate is only on the DOWN path: `bgtz $v0, .L0x80090380` (:13735) skips it for an
  // up row, so 200 still raises the defender's own defense with the byte set.
  const up = battleScriptedPlanFor(b, 0, record(200), 200, { name: "Marsmon" });
  assert.equal(up.refused, false);
  assert.equal(b.player.statMods.def, 37);
});

test("ARM 0x800903f4, the party arm: every living slot of the acting side", () => {
  // The walk reads each record 0x10 below its own base (:13848), so its two gates land on
  // record `+0x00` (a species) and record `+0x08` (current HP) — the same two fields
  // FIGHTSTG_F0x800a1aa8 tests (:32250 / :32254). A slot with no species or no HP is
  // skipped.
  const b = battle();
  const partner = { profile: { name: "Veemon", id: 2, family: 1 }, hp: 200, maxHp: 200,
                    str: 80, def: 80, spt: 80, wis: 30, spd: 80,
                    affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {} };
  const fallen = { profile: { name: "Gabumon", id: 3, family: 1 }, hp: 0, maxHp: 200,
                   str: 70, def: 70, spt: 70, wis: 30, spd: 70,
                   affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {} };
  b.playerRecords = [b.player, partner, fallen];
  const plan = battleScriptedPlanFor(b, 0, record(199), 199, { name: "Marsmon" });
  assert.equal(plan.effect, "statParty");
  assert.deepEqual(plan.stats.map((s) => s.slot), [0, 1],
    "the fallen slot is skipped on its own HP, not on the arm");
  assert.equal(b.player.statMods.str, 50, "trunc(100 * 64 / 128)");
  assert.equal(partner.statMods.str, 40, "trunc(80 * 64 / 128) — the partner's OWN stat");
  assert.equal(fallen.statMods.str, 0);
  // Its page is kind 9: word 0 is the RAW acting-side byte (`lbu $v0, 0x50($s4)` :13803 /
  // `sw $v0, 0x64($s4)` :13840) and word 1 is the stat's own code (:13846-:13855). Kind 9
  // reads word 0 as the side its ten-row scan walks (`.L0x80098de0`), so an enemy cast has
  // to carry 0x10 there and not the player's 0.
  assert.equal(plan.page.kind, 9);
  assert.deepEqual(plan.page.payload, [0, 2]);
  assert.deepEqual([damageTermPartyWord(0), damageTermPartyWord(1), damageTermPartyWord(2)],
    [2, 8, 9]);
  // Cast by the ENEMY it is the enemy's own side — and the walker has one enemy record,
  // which is the same limit the category-4 party heal already reports.
  const b2 = battle();
  const fromEnemy = battleScriptedPlanFor(b2, 1, record(203), 203, { name: "Knightmon" });
  assert.equal(fromEnemy.side, 1);
  assert.equal(b2.enemy.statMods.spd, 37, "trunc(100 * 48 / 128) — 203's own magnitude");
  assert.equal(fromEnemy.page.payload[0], 0x10,
    "word 0 is the raw side byte, so the scan reads the ENEMY's side");
  assert.equal(fromEnemy.page.payload[1], 9, "203 is the speed row, so word 1 = 9");
});

test("ARM 0x80090528, the Chi arms: the charge byte lands on the target's record", () => {
  // The value is the technique record's own `+0x0C` (`lbu $a0, 0xc($s5)` :13873), and the
  // target is the acting side's own active slot (:13866-13872).
  const b = battle();
  const soul = battleScriptedPlanFor(b, 0, record(209), 209, { name: "Marsmon" });
  assert.equal(soul.effect, "affinity");
  assert.equal(soul.affinity, TECH_TABLE["209"].crit);
  assert.equal(soul.multiplier, 1 + TECH_TABLE["209"].crit / 64);
  assert.equal(b.player.affinity, TECH_TABLE["209"].crit);
  assert.deepEqual(soul.page.payload, [DAMAGE_TERM_CHI_WORD, 0]);
  // A second charge replaces the first, because the machine's state-1 sub-state-0 clear
  // (`sh $zr, 0xe($v0)` :13092) empties the record first and this function calls it once.
  const second = battleScriptedPlanFor(b, 0, record(210), 210, { name: "Marsmon" });
  assert.equal(second.affinityBefore, 0);
  assert.equal(b.player.affinity, TECH_TABLE["210"].crit);
  // The enemy's own Chi arm is the same code with the other side.
  const b2 = battle();
  const enemy = battleScriptedPlanFor(b2, 1, record(210), 210, { name: "Knightmon" });
  assert.equal(b2.enemy.affinity, TECH_TABLE["210"].crit);
  assert.equal(b2.player.affinity, 0);
  assert.equal(enemy.page.payload[1], 0x10, "the raw side byte is in word 1");
});

/**
 * Is one of the two locks queued in the battle's status-event pool?
 *
 * The locks are pool entries now (`FIGHTSTG_F0x8009cd1c`, `pro/fightstg.s:27049`), not
 * walker booleans: code `0x10` on the player's active slot is the no-flee lock and `0x11`
 * the no-digivolve one (`.L0x800a43ec`, `:27118`-`:27121`).
 */
function lockQueued(b, lockIndex) {
  const pool = b.statusEvents ?? [];
  const code = lockIndex === 0 ? 0x10 : 0x11;
  return pool.some((e) => e.code === code);
}

test("ARM 0x80090584 / 0x800905c8, the two rolls: a lock or \"No effect!\"", () => {
  // The three words at 0x800a4640/48/4c are function pointers, and each body is
  // `(rand & 0x7f) < record[+0x0B]` (:31834 / :31864 / :31865). `$a1` is the technique id
  // the arm's delay slot names — 0xd3, 0xd4, 0x187 — not a story flag.
  assert.deepEqual([DAMAGE_TERM_ROLL_FLEE, DAMAGE_TERM_ROLL_DIGIVOLVE,
                    DAMAGE_TERM_ROLL_STATUS], [0xd3, 0xd4, 0x187]);
  assert.equal(record(211).f8, 80);
  assert.equal(record(391).f8, 96);
  assert.equal(damageTermRoll(record(211).f8, 79), true);
  assert.equal(damageTermRoll(record(211).f8, 80), false);

  const b = battle();
  const landed = battleScriptedPlanFor(b, 0, record(211), 211,
    { name: "Marsmon", roll7: 10 });
  assert.equal(landed.rollLanded, true);
  assert.equal(landed.effect, "lockFlee");
  assert.ok(lockQueued(b, 0), "the no-flee lock is a queued pool entry, not a flag");
  assert.equal(landed.page.kind, 2);
  assert.deepEqual(landed.page.payload, [0x44, 0], "esmfight[0x44], word 1 = 0 (:13895)");
  assert.equal(ESMFIGHT[0x44], "Can't run away!");

  // A LOST ROLL SAYS "No effect!". `beqz $v0, .L0x800905b8` :13888 carries
  // `li $v0, 0x2f` :13889 in its DELAY slot, so `$v0` is 0x2f on both paths and the
  // branch's own target stores it (:13896) before asking kind 1 (:13899).
  const b2 = battle();
  const lost = battleScriptedPlanFor(b2, 0, record(211), 211, { name: "Marsmon", roll7: 120 });
  assert.equal(lost.rollLanded, false);
  assert.equal(lockQueued(b2, 0), false, "a lost roll locks nothing");
  assert.equal(lost.page.kind, 1);
  assert.deepEqual(lost.page.payload, [0x2f], "esmfight[0x2f], not a blank line");
  assert.equal(ESMFIGHT[0x2f], "No effect!");
  assert.equal(ESMFIGHT[0], "", "esmfight[0x00] is the empty string -- a blank box, which is "
    + "NOT what the arm prints");

  // 212's lost roll is the same page, from its own branch (:13906 / :13907 / :13914).
  const b5 = battle();
  const dvLost = battleScriptedPlanFor(b5, 0, record(212), 212,
    { name: "Marsmon", roll7: 120 });
  assert.equal(dvLost.rollLanded, false);
  assert.equal(lockQueued(b5, 1), false);
  assert.equal(dvLost.page.kind, 1);
  assert.deepEqual(dvLost.page.payload, [0x2f]);

  const b3 = battle();
  const dv = battleScriptedPlanFor(b3, 0, record(212), 212, { name: "Marsmon", roll7: 3 });
  assert.equal(dv.effect, "lockDigivolve");
  assert.ok(lockQueued(b3, 1), "the digivolve lock is a queued pool entry");
  assert.deepEqual(dv.page.payload, [0x45, 0]);
  assert.equal(ESMFIGHT[0x45], "Can't digivolve!");
  // The enemy's version of the same arm still locks the PLAYER: `FIGHTSTG_F0x8009cd1c`
  // reads `lw $s1, 0x4468($v0)` (:27051), the player's active index, whichever side cast.
  const b4 = battle();
  const fromEnemy = battleScriptedPlanFor(b4, 1, record(211), 211,
    { name: "Knightmon", roll7: 3 });
  assert.equal(fromEnemy.side, 0);
  assert.ok(lockQueued(b4, 0), "an enemy cast still locks the PLAYER");
  assert.equal(lockQueued(b4.enemy, 0), false);
});

test("THE QUEUE: Double Power RAISES the attack and then wears it off", () => {
  // Before the pool, `applyCategory5Plan` wrote the modifier and nothing ever took it
  // off, so a Digimon stayed at +48 attack for the rest of the battle. The original
  // stages code 0x0d through `FIGHTSTG_F0x8009cc20` (`pro/fightstg.s:13776`) with a
  // delay of opcode 12, and the expiry puts the halfword back to zero
  // (`sh $zr, 0x10($v1)` `pro/wfightmn.s:2816`).
  const b = battle();
  b.statusEvents = emptyStatusEventPool();
  const plan = battleScriptedPlanFor(b, 0, record(198), 198, { name: "Marsmon" });
  assert.equal(plan.effect, "statOne");
  assert.equal(plan.stats.length, 1);
  assert.ok(b.player.statMods.str > 0, "the arm raised the attack");
  // One queued entry, on the PLAYER's side (the arm chose the acting side), code 0x0d.
  const queued = b.statusEvents.filter((e) => e.code !== 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].code, 0x0d);
  assert.equal(queued[0].side, 0);
  assert.equal(queued[0].payload, 0, "attack is stat 0");
  // One action is `statusEventActionDelay(100, 100)` = 1000 units; the delay is
  // `2000 + rand % 2001 + 10 * SPT`, so two actions are short and it comes due on the
  // third or fourth. The modifier must NOT drop early.
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(battleStatusEventAdvance(b, "player"), []);
    assert.ok(b.player.statMods.str > 0, `the buff survived action ${i + 1}`);
  }
  let guard = 0;
  const expiries = [];
  while (guard++ < 20 && expiries.length === 0) {
    expiries.push(...battleStatusEventAdvance(b, "player"));
  }
  assert.equal(expiries.length, 1);
  assert.equal(expiries[0].kind, "stat");
  assert.equal(expiries[0].stat, 0);
  assert.equal(b.player.statMods.str, 0, "the buff wore off, as it does in the original");
  assert.equal(b.statusEvents.filter((e) => e.code !== 0).length, 0, "its slot was freed");
});

test("THE QUEUE: the no-flee lock is RELEASED, so the escape comes back", () => {
  const b = battle();
  b.statusEvents = emptyStatusEventPool();
  const plan = battleScriptedPlanFor(b, 0, record(211), 211,
    { name: "Marsmon", roll7: 3 });
  assert.equal(plan.effect, "lockFlee");
  assert.ok(lockQueued(b, 0), "Capture Beam queued the lock");
  assert.equal(statusEventLockHeld(b.statusEvents, 0, 0, 0), true,
    "the escape gate reads the queue, and the queue says locked");
  // The stager ALSO sets the record's own +0x1c bit (`ori $v0, 0x10` :27134) —
  // the byte the command-menu row greys (F0x80093cf4 :17595), the DNA tests and
  // the escape roll read. A pool-only model left it clear and the greys dead.
  assert.equal(battleAilmentByte(b.player) & 0x10, 0x10,
    "the record byte carries the cannot-flee bit while the lock is held");
  const before = b.statusEvents.find((e) => e.code === 0x10).time;
  let guard = 0;
  const expiries = [];
  while (guard++ < 20 && expiries.length === 0) {
    expiries.push(...battleStatusEventAdvance(b, "player"));
  }
  assert.equal(expiries.length, 1);
  assert.equal(expiries[0].kind, "lock");
  assert.equal(expiries[0].bit, 0x10);
  assert.ok(before > 0);
  assert.equal(statusEventLockHeld(b.statusEvents, 0, 0, 0), false,
    "the queue released it, so the escape is offered again");
  assert.equal(battleAilmentByte(b.player) & 0x10, 0,
    "the expiry clears the record's bit too (pro/wfightmn.s:2743-:2773)");
});

test("the cannot-digivolve lock sets the record's 0x20 bit the DV row greys on", () => {
  const b = battle();
  b.statusEvents = emptyStatusEventPool();
  const plan = battleScriptedPlanFor(b, 0, record(212), 212,
    { name: "Marsmon", roll7: 3 });
  assert.equal(plan.effect, "lockDigivolve");
  assert.equal(statusEventLockHeld(b.statusEvents, 1, 0, 0), true);
  assert.equal(battleAilmentByte(b.player) & 0x20, 0x20,
    "the record byte carries the cannot-digivolve bit (ori $v0, 0x20 :27141)");
  assert.equal(battleAilmentByte(b.enemy) & 0x20, 0, "the enemy record is untouched");
});

test("ARM 0x80090610: a landed roll shows NOTHING and a lost roll says \"No effect!\"", () => {
  // `li $v0, 0x3` / `sw $v0, 0xc($v1)` (:13928-:13930) writes the panel's own phase and
  // jumps to the machine's finish, so no page is built at all.
  const b = battle();
  const landed = battleScriptedPlanFor(b, 0, record(391), 391, { name: "Marsmon", roll7: 5 });
  assert.equal(landed.effect, "statusOnly");
  assert.equal(landed.rollLanded, true);
  assert.equal(landed.page, null);

  const b2 = battle();
  const lost = battleScriptedPlanFor(b2, 0, record(391), 391,
    { name: "Marsmon", roll7: 127 });
  assert.equal(lost.rollLanded, false);
  assert.equal(lost.page.kind, 1);
  assert.deepEqual(lost.page.payload, [0x2f],
    "`li $v0, 0x2f` :13924 is in the DELAY slot of `beqz $v0, .L0x80090644` :13923");
  assert.equal(ESMFIGHT[0x2f], "No effect!");
});

test("391's ROLL FUNCTION is not 211/212's: eight profile rows gate it", () => {
  // `[0x800a4640]` (fightstg.s:35036 `.word 0x800a13c0`) is FIGHTSTG_F0x800a13c0, and its
  // first act is a walk of eight DIGIMON_PROFILES rows against ONE halfword of the
  // PLAYER's active record: `lw $v0, 0x8($v1)` :31761 (the player's active index),
  // `addiu $a0, -0x10a4` :31762 (0x8003ef5c), `lh $v1, 0x10($v0)` :31765 over
  // `0x800a4460 + index*0x20` = the record's `+0x10`, `lhu $v0, ($a0)` :31766 (the row's own
  // first halfword), `slti $v0, $a2, 0x8` :31772 and `addiu $a0, 0x58` :31774. A match
  // returns zero in the `bne`'s delay slots (`j .L0x800a1448` / `move_ $v0, $zr` :31770-
  // :31771) — so it never calls `rand` at all.
  assert.equal(DAMAGE_TERM_STATUS_ROLL_PROFILES.length, 8);
  // The eight ids are rows 0..7 of the disc's own profile table, read out of the committed
  // resident image the same way tools/verify_dna.mjs reads it.
  const IMAGE = readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url));
  const u16 = (at) => IMAGE[at] | (IMAGE[at + 1] << 8);
  const FROM_DISC = Array.from({ length: 8 },
    (_, row) => u16(0x8003ef5c - 0x80010000 + row * 0x58));
  assert.deepEqual([...DAMAGE_TERM_STATUS_ROLL_PROFILES], FROM_DISC,
    "the guard must be the disc's own eight profile ids, not a typed list");
  for (const id of DAMAGE_TERM_STATUS_ROLL_PROFILES) {
    assert.equal(damageTermStatusRollBlocked(id), true, `modifier ${id} is refused`);
  }
  for (const id of [0, 1, 5, 30, 32, 100, 144, 146, 365, 367, 374, 382, 386, 500]) {
    assert.equal(damageTermStatusRollBlocked(id), false, `modifier ${id} is not refused`);
  }

  // The blocked halfword is record `+0x10`, the ATTACK MODIFIER, on the PLAYER's active
  // fighter -- whichever side casts.
  const blocked = battle();
  blocked.player.statMods = { str: 383, def: 0, spd: 0 };
  const byPlayer = battleScriptedPlanFor(blocked, 0, record(391), 391,
    { name: "Marsmon", roll7: 1 });
  assert.equal(byPlayer.rollBlocked, true);
  assert.equal(byPlayer.rollLanded, false, "the getter answers zero before it rolls");
  assert.equal(byPlayer.page.payload[0], 0x2f, "so the box says \"No effect!\"");
  const byEnemy = battleScriptedPlanFor(blocked, 1, record(391), 391, { name: "Knightmon" });
  assert.equal(byEnemy.rollBlocked, true, "the getter reads the PLAYER's record either way");

  // An attack modifier that is not one of the eight lets the roll happen as before.
  const free = battle();
  free.player.statMods = { str: DAMAGE_TERM_STATUS_ROLL_PROFILES[7] + 1, def: 0, spd: 0 };
  const lands = battleScriptedPlanFor(free, 0, record(391), 391,
    { name: "Marsmon", roll7: 5 });
  assert.equal(lands.rollBlocked, false);
  assert.equal(lands.rollLanded, true);
  assert.equal(lands.page, null);

  // And the plan's own answer is the getter's, whether the caller supplies the roll or not.
  const viaPlan = category5Plan(record(391), 391, {
    side: 0, rollStatusLanded: true, playerActiveAttackModifier: 145,
  });
  assert.equal(viaPlan.rollBlocked, true);
  assert.equal(viaPlan.rollLanded, false);
  assert.equal(category5Plan(record(391), 391, {
    side: 0, rollStatusLanded: true, playerActiveAttackModifier: 144,
  }).rollLanded, true);
});

test("ARM 0x80090654: MP moves off the player's active fighter onto the enemy's", () => {
  // `lw $a0, 0xc($v0)` (:13938) is the ENEMY's active index and `lw $v1, 0x8($v0)`
  // (:13939) the player's — the two sides are read, never walked. The amount is
  // `maxMP * record[+0x0C] / 128` (:13951-:13960), capped at what the source has (:13963),
  // and the receiver is clamped to its own maximum (:13975-:13984).
  const b = battle();
  b.enemy.mp = 90;   // headroom, so the landing MP is visible
  const plan = battleScriptedPlanFor(b, 1, record(392), 392, { name: "Knightmon" });
  assert.equal(plan.effect, "mpDrain");
  assert.equal(plan.mpMoved, 3, "trunc(60 * 8 / 128)");
  assert.equal(b.player.mp, 57);
  assert.equal(b.enemy.mp, 93);
  // ...and an enemy already at its maximum is CLAMPED, while the source still loses the
  // whole amount (`sh $v0, 0xc($a0)` :13970 then `sh $v1, 0xc($a0)` :13984).
  const bAtMax = battle();
  const atMax = battleScriptedPlanFor(bAtMax, 1, record(392), 392, { name: "Knightmon" });
  assert.equal(atMax.mpMoved, 3);
  assert.equal(bAtMax.enemy.mp, 100);
  assert.equal(bAtMax.player.mp, 57);
  assert.equal(plan.page.kind, 18);
  assert.equal(plan.page.payload[2], 1, "word 2 is what prints '{1} MP absorbed!'");
  assert.equal(plan.page.slots[0], "3");

  // Capped by what the source has.
  const b2 = battle();
  b2.player.mp = 2;
  const capped = battleScriptedPlanFor(b2, 1, record(392), 392, { name: "Knightmon" });
  assert.equal(capped.mpMoved, 2);
  assert.equal(b2.player.mp, 0);
  assert.equal(b2.enemy.mp, 100, "the enemy was already at its maximum");

  // A source with no MP is the arm's own refusal (:13946): nothing moves, and the page is
  // KIND 2 with esmfight[0x2f] "No effect!" on line two and 0x10 in word 1 -- the refusal
  // jumps to `.L0x800907a0` :13989, whose delay slot loads 0x2f (:13990), and that IS the
  // landed arm's own tail (`sw` :14018 / `li $v0, 0x10` :14019 / `sw` :14020 /
  // `li $a1, 0x2` :14022).
  const b3 = battle();
  b3.player.mp = 0;
  const nothing = battleScriptedPlanFor(b3, 1, record(392), 392, { name: "Knightmon" });
  assert.equal(nothing.mpMoved, 0);
  assert.equal(nothing.page.kind, 2);
  assert.deepEqual(nothing.page.payload, [0x2f, 0x10]);
  assert.equal(ESMFIGHT[0x2f], "No effect!");
  assert.equal(b3.enemy.mp, 100);

  // And the engine's own helper is the same arithmetic, so a caller can ask first.
  assert.equal(damageTermMpMoved(record(392),
    { sourceMp: 60, sourceMaxMp: 60, destMp: 100, destMaxMp: 100 }), 3);
  // The receiver's maximum does NOT reduce the amount: the arm adds it all and then
  // clamps the receiver (:13967-:13970 then :13975-:13984).
  assert.equal(damageTermMpMoved(record(392),
    { sourceMp: 60, sourceMaxMp: 60, destMp: 99, destMaxMp: 100 }), 3);
});

test("ARM 0x80090734: Gilead Plant heals and charges its caster's side", () => {
  // The record base is 0x800a4460 + 0x70 = 0x800a44d0 (:14017 / :14019) — side 1's
  // array, which is the ENEMY's for the only caster the disc gives this record, and the
  // player's own once the walker lets a side-0 caster use it (the fixed side is flipped,
  // `damageTermCategory5Side`). The heal adds to record `+0x08` with the cap from `+0x06`
  // in the `beqz`'s delay slot (:14033 / :14045).
  const b = battle();
  b.enemy.maxHp = 9000;
  b.enemy.hp = 100;
  const plan = battleScriptedPlanFor(b, 1, record(400), 400, { name: "Raidenmon" });
  assert.equal(plan.effect, "healCharge");
  assert.equal(plan.side, 1);
  // The getter is FIGHTSTG_F0x800a0108 with `$a0` = the acting side, and `$a1` is the
  // TECHNIQUE id the branch's DELAY SLOT left there: `li $a1, 0x190` at pro/fightstg.s
  // :13710 runs whether or not `beq $v1, $v0, .L0x80090734` (:13709) is taken, and the
  // arm `.L0x80090734`-`:80090758` never writes `$a1` again before `jalr` (:13999). So the
  // power term is RECORD 400's own `+0x02` -- 8 in the shipped table -- and the wisdom is
  // the CASTER's: here the enemy that cast it, not the fighter it heals.
  assert.equal(DAMAGE_TERM_HEAL_POWER_ID, 400);
  const amount = damageTermHealAmount(TECH_TABLE["400"].power, 100);
  assert.equal(amount, 8 * 64 + Math.trunc((100 * 8) >> 3));
  assert.equal(amount, 512 + 100);
  assert.equal(plan.healAmount, amount);
  assert.notEqual(plan.healAmount, damageTermHealAmount(TECH_TABLE["2"].power, 100),
    "record 2's power is the 209/210 branch's `$a1`, which never reaches this arm");
  assert.equal(b.enemy.hp, 100 + amount);
  assert.equal(b.enemy.affinity, 0x20, "the literal 32 (:14046-:14047)");
  assert.deepEqual(plan.page.payload, [0x46, 0x10]);
  assert.equal(ESMFIGHT[0x46], "Generating!");

  // The cap is the healed record's own maximum HP.
  const b2 = battle();
  b2.enemy.hp = 480;
  battleScriptedPlanFor(b2, 1, record(400), 400, { name: "Raidenmon" });
  assert.equal(b2.enemy.hp, b2.enemy.maxHp);

  // Cast by the PLAYER the fixed side flips to the player: the heal and the charge land
  // on the caster, which is the same operand the enemy's cast gets. The wisdom term is
  // the PLAYER's, because the getter's `$a0` is the acting side's byte (:14021).
  const b3 = battle();
  b3.player.maxHp = 9000;
  b3.player.hp = 100;
  b3.player.affinity = 80;
  const fromPlayer = battleScriptedPlanFor(b3, 0, record(400), 400, { name: "Marsmon" });
  assert.equal(fromPlayer.side, 0);
  assert.equal(fromPlayer.healAmount, damageTermHealAmount(TECH_TABLE["400"].power, 40));
  assert.equal(fromPlayer.healAmount, 512 + 40);
  assert.equal(b3.player.hp, 100 + fromPlayer.healAmount);
  assert.equal(b3.enemy.hp, 500, "the enemy is not touched");
  assert.equal(b3.player.affinity, 0x20, "the charge lands on the record the arm writes");
  assert.equal(b3.enemy.affinity, 0);
  assert.equal(fromPlayer.affinityBefore, 0,
    "the state-1 clear runs first on the acting side, which is now the arm's own record");
  // A second cast reads the same cleared record, so the reading is stable.
  const again = battleScriptedPlanFor(b3, 0, record(400), 400, { name: "Marsmon" });
  assert.equal(again.affinityBefore, 0);
  // And the constant the delay slot names IS the record the arm belongs to.
  assert.equal(DAMAGE_TERM_HEAL_POWER_ID, 400);
  assert.equal(TECH_TABLE[String(DAMAGE_TERM_HEAL_POWER_ID)], TECH_TABLE["400"],
    "the branch's delay slot names this very record, so `record.power` is the power");
  assert.equal(TECH_TABLE["2"].power, 60,
    "the constant the 209/210 branch leaves in `$a1`, which this arm never reads");
});

test("every arm: one sentence, no number the disc's own box does not print", () => {
  for (const id of CATEGORY5_IDS) {
    const b = battle();
    const plan = battleScriptedPlanFor(b, 0, record(id), id,
      { name: "Marsmon", roll7: 1 });
    assert.ok(plan, `technique ${id} must plan`);
    const text = scriptedWalkerSentence(plan, { name: `T${id}` }, "Marsmon");
    assert.match(text, /^Marsmon uses T\d+!/, `technique ${id}'s sentence`);
  }
});

test("the gate: an ordinary attack and a heal are not category-5 members", () => {
  const b = battle();
  assert.equal(battleScriptedPlanFor(b, 0, record(1), 1), null, "a plain attack");
  assert.equal(battleScriptedPlanFor(b, 0, record(184), 184), null, "a category-4 heal");
  assert.equal(battleScriptedPlanFor(b, 0, null, 0), null, "no record at all");
  assert.equal(battleScriptedPlanFor(b, 0, record(209), 0), null, "id 0 is not an arm");
  assert.equal(b.player.affinity, 0);
  assert.deepEqual(b.player.statMods, { str: 0, def: 0, spd: 0 });
});

test("ONE shared entry point: no per-technique branch in the walker's file", () => {
  // The arm is decided by the engine's table; `web/battle.js` may not test a technique id
  // of its own. This is the whole-system rule the repo asks for: one function, both sides.
  const defs = BATTLE_JS.match(/export function battleScriptedPlanFor\b/g) ?? [];
  assert.equal(defs.length, 1, "one shared category-5 entry point");
  const body = BATTLE_JS.slice(
    BATTLE_JS.indexOf("export function battleScriptedPlanFor"),
    BATTLE_JS.indexOf("export function battleAffinityPlanFor"));
  assert.doesNotMatch(body, /\b(198|199|200|201|202|203|204|205|206|207|208|209|210|211|212|391|392|400)\b/,
    "web/battle.js names no category-5 technique id: the arm table decides");
  // Both sides call it, once each, before the category-4 gate.
  assert.equal((BATTLE_JS.match(/battleScriptedPlanFor\(b, 0,/g) ?? []).length, 1);
  assert.equal((BATTLE_JS.match(/battleScriptedPlanFor\(b, 1,/g) ?? []).length, 1);
  assert.match(body, /clearActionAffinity\(b, side\)/);
});

test("the modifier arithmetic is the routine's own, clamps included", () => {
  // `srl $v0, 0x1f` (:32285) is short-form, so it shifts the register it names — the
  // effective stat already shifted left by sixteen — and NOT the product's high word.
  // That is what makes the lower bound -trunc(eff/2) rather than -|product|/2, which is
  // what lets a [arrow-down] row keep a NEGATIVE modifier.
  assert.equal(damageTermStatModifier(100, 0, 48), 37);
  assert.equal(damageTermStatModifier(100, 0, -24), -18);
  assert.equal(damageTermStatModifier(100, 0, 16), 12);
  assert.equal(damageTermStatModifier(100, 0, -16), -12);
  // A second application is measured from the CLEAN value, because the routine takes the
  // current modifier off the block first (:32271 `subu $v0, $a0`).
  assert.equal(damageTermStatModifier(100, 37, 48), 74, "37 + 37");
  // The lower bound: a debuff bigger than half the stat is clamped to -trunc(eff/2).
  assert.equal(damageTermStatModifier(100, 0, -128), -50, "-trunc(100 / 2)");
  // The upper bound: the modifier may not exceed the effective value it was measured from
  // (:32304 / :32307).
  assert.equal(damageTermStatModifier(100, 90, 48), 100);
  // The 16-bit store wraps, and the read-back is signed.
  assert.equal(damageTermStatModifier(100, 0, -128 * 4), -50, "clamped before the wrap");
  // **The lower clamp reads the value it just stored, not the delta.** `sh $v0,
  // 0x10($a1)` :32296 writes `current + delta`, then `sll $v0, 0x1` / `sra $v0, 0x10`
  // :32297-:32298 sign-extend that stored halfword and `slt $v0, $v0, $a2` :32299 -- the
  // SHORT form, so `$v0` is the operand -- tests it against the bound. So a second debuff
  // on a fighter already carrying a negative modifier is floored even though its own delta
  // is inside the bound: delta -37 on an existing -20 gives -57, and the store floors it
  // to -trunc(100/2) = -50. (A single debuff from zero is unchanged: -37 > -50.)
  assert.equal(damageTermStatModifier(100, -20, -48), -50, "the stored value is floored");
  assert.equal(damageTermStatModifier(100, 0, -48), -37, "the delta alone is not floored");
  assert.equal(damageTermStatModifier(100, -45, -16), -50,
    "-45 + -12 = -57, floored to -50");
  assert.equal(damageTermStatModifier(100, -45, 48), -8, "37 - 45 = -8, inside the bound");
  assert.equal(damageTermStatModifier(100, -45, 80), 17, "62 - 45 = 17");
  // The entry gates: an empty slot and a fallen one are both skipped (:32250 / :32254).
  assert.equal(damageTermStatApplies(0, 100), false);
  assert.equal(damageTermStatApplies(373, 0), false);
  assert.equal(damageTermStatApplies(373, 1), true);
});

test("which side each arm writes to, from the table and nothing else", () => {
  const sideOf = (id, acting) =>
    damageTermCategory5Side(damageTermCategory5Arm(id), acting, damageTermStatRow(id));
  // The Chi arms and an up row keep the acting side; a down row XORs it; the two lock
  // arms hard-code the player's active fighter.
  assert.equal(sideOf(209, 0), 0);
  assert.equal(sideOf(209, 1), 1);
  assert.equal(sideOf(198, 1), 1);
  assert.equal(sideOf(205, 0), 1);
  assert.equal(sideOf(205, 1), 0);
  assert.equal(sideOf(211, 1), 0, "the lock reads 0x800a4468, the player's index (:27051)");
  assert.equal(sideOf(212, 1), 0);
  // THE FIXED-SIDE ARMS. The disc's stream names 0x800a4468 (391) or 0x800a446c (392/400)
  // outright, so for an enemy caster the status lands on the player and the steal/heal on
  // the enemy itself. A PLAYER cast flips it, because a fixed side of 1 then means the
  // caster — the technique keeps aiming at the opponent and never at the fighter that
  // cast it (the walker's extra rows put 391 in a player's hands).
  assert.equal(sideOf(391, 1), 0);
  assert.equal(sideOf(391, 0), 1);
  assert.equal(sideOf(392, 1), 1, "the MP drain reads the enemy's active index (:13938)");
  assert.equal(sideOf(392, 0), 0);
  assert.equal(sideOf(400, 1), 1, "Gilead Plant's base is the enemy array (:14019)");
  assert.equal(sideOf(400, 0), 0);
});

test("the per-action clear still runs once for every category-5 arm", () => {
  // `sh $zr, 0xe($v0)` at :13092 is in the `j`'s delay slot, so it always runs, before
  // this handler, with no category test. A charge thrown by the acting fighter is therefore
  // spent by any category-5 technique, including one that only changes a stat.
  const b = battle();
  b.player.affinity = 80;
  battleScriptedPlanFor(b, 0, record(198), 198, { name: "Marsmon" });
  assert.equal(b.player.affinity, 0, "a stat change throws the charge away too");
  const clears = BATTLE_JS.match(/clearActionAffinity\(b, side\)/g) ?? [];
  assert.equal(clears.length, 3,
    "one definition, the category-4 gate, and this one gate");
  assert.equal(typeof clearActionAffinity, "function");
});