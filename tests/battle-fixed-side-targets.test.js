// The three FIXED-SIDE category-5 arms when the PLAYER is the one casting them.
//
// 392 and 400 are the disc's literal answer whoever casts (fightstg.s 0x80090654-0x800906fc
// and 0x80090734-0x80090798): 392 moves MP from the PLAYER's active record
// (0x800a4470 + [0x800a4468]*0x20) to the ENEMY's (0x800a44d0 + [0x800a446c]*0x20), and
// 400 heals the ENEMY's active record and sets its charge byte to 32; the heal amount
// reads the ACTING side's WIS ($a0 = lbu 0x50($s4)). A player cast of either gives the
// same two records, so a player cast of 392 gives the enemy MP and 400 heals the enemy.
//
// 391 is the one walker repair kept: its stream stages the status on 0x800a4468 (the
// player), which for a player cast would be a self-write, so the walker aims it at the
// enemy instead (the shipped table gives 391 to Persiamon's enemy row only).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DAMAGE_TERM_ARMS_CATEGORY5, category5Plan, damageTermCategory5Arm,
  damageTermCategory5Side, damageTermHealAmount, damageTermStatRow,
} from "../web/vendor/engine.js";
import { battleScriptedPlanFor } from "../web/battle.js";

const TECH_TABLE = JSON.parse(readFileSync(
  new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));

const record = (id) => TECH_TABLE[String(id)];
const sideOf = (id, acting) =>
  damageTermCategory5Side(damageTermCategory5Arm(id), acting, damageTermStatRow(id));

/** A walker battle: one party member and one enemy, both with MP and HP to move. */
function battle() {
  const enemy = {
    profile: { name: "Persiamon", id: 1, family: 1 }, level: 10, hp: 500, maxHp: 500,
    mp: 100, maxMp: 100, str: 100, def: 100, spt: 100, wis: 100, spd: 100,
    affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {},
  };
  const player = {
    profile: { name: "Marsmon", id: 100, family: 1 }, level: 10, hp: 300, maxHp: 300,
    mp: 60, maxMp: 60, str: 100, def: 100, spt: 100, wis: 40, spd: 100,
    affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {},
  };
  return {
    player, enemy, playerRecords: [player, null, null], activePlayerIndex: 0,
    encounterGateBytes: new Array(14).fill(0),
  };
}

test("the arm table marks exactly the three fixed-side arms, with the disc's side", () => {
  // 391 names 0x800a4468 and 392/400 name 0x800a446c, so the marked sides are 0, 1, 1.
  const marked = DAMAGE_TERM_ARMS_CATEGORY5
    .filter((a) => a.fixedSide !== undefined)
    .flatMap((a) => a.ids.map((id) => [id, a.fixedSide]));
  assert.deepEqual(marked, [[391, 0], [392, 1], [400, 1]]);
  // The two lock arms are fixed-side in the disc's stream too, but they are enemy-only
  // (no player row lists 211/212), so this repair deliberately does not touch them.
  assert.equal(damageTermCategory5Arm(211).fixedSide, undefined);
  assert.equal(damageTermCategory5Arm(212).fixedSide, undefined);
});

test("the side a fixed-side arm writes to, from the caster's side", () => {
  // 391: the player's active fighter when an enemy casts it, the enemy's when the player
  // casts it — never the caster itself.
  assert.equal(sideOf(391, 1), 0, "Persiamon's Helter Skelter lands on the player");
  assert.equal(sideOf(391, 0), 1, "and on the enemy when the player casts it");
  // 392 and 400 write side 1 whoever casts them (0x80090654-0x800906fc, 0x80090734-0x80090798).
  assert.equal(sideOf(392, 1), 1, "the MP drain reads 0x800a446c, the enemy's index");
  assert.equal(sideOf(392, 0), 1, "and the same index when the player casts it");
  assert.equal(sideOf(400, 1), 1, "Gilead Plant heals the enemy's active fighter");
  assert.equal(sideOf(400, 0), 1, "and the enemy's when the player casts it");
  // The arms the disc targets by ROLE are untouched: a debuff row still XORs, and the
  // two locks still name the player.
  assert.equal(sideOf(205, 0), 1);
  assert.equal(sideOf(205, 1), 0);
  assert.equal(sideOf(211, 1), 0);
  assert.equal(sideOf(198, 0), 0);
});

test("391 cast by the player stages on the ENEMY, not on the caster", () => {
  const b = battle();
  // A non-profile attack modifier, so the arm's own getter lets the roll happen.
  b.player.statMods = { str: 0, def: 0, spd: 0 };
  const plan = battleScriptedPlanFor(b, 0, record(391), 391, { name: "Marsmon", roll7: 5 });
  assert.equal(plan.effect, "statusOnly");
  assert.equal(plan.rollLanded, true);
  assert.equal(plan.side, 1, "the status event is staged on the enemy's active fighter");
  // The landed arm raises no page (`:13930` writes 3 into the panel and jumps to the
  // machine's finish), and it touches neither record directly.
  assert.equal(plan.page, null);
  assert.equal(b.player.hp, 300);
  assert.deepEqual(b.player.statMods, { str: 0, def: 0, spd: 0 });
  // The plan's own target side is the same answer the helper gives.
  assert.equal(category5Plan(record(391), 391,
    { side: 0, rollStatusLanded: true, playerActiveRookie: false }).side, 1);
  assert.equal(category5Plan(record(391), 391,
    { side: 1, rollStatusLanded: true, playerActiveRookie: false }).side, 0,
  "the enemy's cast still lands on the player");
});

test("392 cast by the player moves the PLAYER's MP onto the enemy (disc fixed sides)", () => {
  const b = battle();
  b.player.mp = 60;
  b.enemy.mp = 80;
  const plan = battleScriptedPlanFor(b, 0, record(392), 392, { name: "Marsmon" });
  assert.equal(plan.effect, "mpDrain");
  // `maxMP * record[+0x0C] / 128` with the SOURCE's maximum, capped at what it has
  // (0x80090688-0x8009069c): the player's 60 MP max, record 392's +0x0C byte of 8.
  assert.equal(plan.mpMoved, 3, "trunc(60 * 8 / 128)");
  assert.equal(b.player.mp, 57, "the source (the player) loses the whole amount");
  assert.equal(b.enemy.mp, 83, "the destination (the enemy) gains it");
  assert.equal(plan.page.kind, 18);
  assert.equal(plan.page.slots[0], "3");
  // The destination is clamped to its OWN maximum, and the source still pays in full.
  const bAtMax = battle();
  bAtMax.enemy.mp = 99;
  const atMax = battleScriptedPlanFor(bAtMax, 0, record(392), 392, { name: "Marsmon" });
  assert.equal(atMax.mpMoved, 3);
  assert.equal(bAtMax.player.mp, 57);
  assert.equal(bAtMax.enemy.mp, 100, "clamped at 100/100");
});

test("392 refuses when the PLAYER (the source) has no MP, whoever casts it", () => {
  const b = battle();
  b.player.mp = 0;
  const plan = battleScriptedPlanFor(b, 0, record(392), 392, { name: "Marsmon" });
  assert.equal(plan.mpMoved, 0);
  assert.equal(plan.page.kind, 2);
  assert.deepEqual(plan.page.payload, [0x2f, 0x10]);
  assert.equal(b.player.mp, 0);
  assert.equal(b.enemy.mp, 100);
  // The enemy's cast is the same arm: the player's MP is the source.
  const byEnemy = battle();
  byEnemy.player.mp = 0;
  const refused = battleScriptedPlanFor(byEnemy, 1, record(392), 392, { name: "Persiamon" });
  assert.equal(refused.mpMoved, 0);
  assert.equal(byEnemy.enemy.mp, 100);
});

test("400 cast by the player heals and charges the ENEMY (disc fixed side)", () => {
  const b = battle();
  b.enemy.maxHp = 9000;
  b.enemy.hp = 100;
  b.enemy.affinity = 80;
  b.player.affinity = 80;
  const plan = battleScriptedPlanFor(b, 0, record(400), 400, { name: "Marsmon" });
  assert.equal(plan.effect, "healCharge");
  assert.equal(plan.side, 1, "the fixed side 0x800a446c: the enemy, whoever casts");
  // The power term is record 400's own and the wisdom term the CASTER's (`$a0` is the
  // acting side's byte, :13996), which for a player cast is the player's 40.
  assert.equal(plan.healAmount, damageTermHealAmount(TECH_TABLE["400"].power, 40));
  assert.equal(plan.healAmount, 512 + 40);
  assert.equal(b.enemy.hp, 100 + plan.healAmount);
  assert.equal(b.enemy.affinity, 0x20, "the arm's literal 32 lands on the enemy");
  assert.equal(b.player.hp, 300, "the caster is untouched");
  assert.equal(b.player.affinity, 0, "the clear at fightstg.s:13092 spent the caster's own byte");
  // The enemy's cast is unchanged: it heals itself.
  const byEnemy = battle();
  byEnemy.enemy.maxHp = 9000;
  byEnemy.enemy.hp = 100;
  const theirs = battleScriptedPlanFor(byEnemy, 1, record(400), 400, { name: "Persiamon" });
  assert.equal(theirs.side, 1);
  assert.equal(theirs.healAmount, damageTermHealAmount(TECH_TABLE["400"].power, 100));
  assert.equal(byEnemy.enemy.hp, 100 + theirs.healAmount);
  assert.equal(byEnemy.player.hp, 300);
});

test("the heal is capped by the healed (enemy) record's maximum HP on a player cast", () => {
  const b = battle();
  b.enemy.hp = 490;
  battleScriptedPlanFor(b, 0, record(400), 400, { name: "Marsmon" });
  assert.equal(b.enemy.hp, 500, "the `+0x06` cap is the record the arm writes");
});
