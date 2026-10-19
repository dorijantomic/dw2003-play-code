// F4 — the three FIXED-SIDE category-5 arms when the PLAYER is the one casting them.
//
// WHAT WAS WRONG. `DAMAGE_TERM_ARMS_CATEGORY5` carried 391 as `target: "playerActive"`
// and 392/400 as `target: "enemy"`, and `damageTermCategory5Side` read those literally: the
// side was fixed whichever fighter cast. That is what the disc's own streams say —
// 391 stages its status event on `0x800a4468` (`FIGHTSTG_F0x8009cff4` :27256) and 392/400
// read `0x800a4468` / `0x800a446c` for the two records they move MP between or heal
// (:13938-:13939, :13993) — but it is only CORRECT because the retail data never lets the
// player cast them (391 sits on Persiamon's enemy row; 392/400 on no player row at all).
//
// The walker's extra species row carries `techs: [390, 391, ...]`, so 391 IS player-
// reachable here, and the literal reading put the status on the caster. The repair keeps
// the arm's MEANING: the fixed side is the side the technique is aimed at, i.e. the
// opponent of whoever casts. For an enemy caster that is the player (391) or the enemy
// itself (392/400, which steal for / heal the caster); for a player caster the same
// operand is the enemy (391) or the player (392/400). `fixedSide` on the arm table names
// the disc's side and `damageTermCategory5Side` flips it for a side-0 caster only.
//
// Every assertion below fails on the code before this change, where the three arms
// reported the disc's literal side for both casters.

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
    profile: { name: "Marsmon", id: 1, family: 1 }, level: 10, hp: 300, maxHp: 300,
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
  // 392 and 400 write side 1, the caster's own side for the only caster the disc has.
  assert.equal(sideOf(392, 1), 1, "the MP drain reads 0x800a446c, the enemy's index");
  assert.equal(sideOf(392, 0), 0, "which is the PLAYER's side when the player casts it");
  assert.equal(sideOf(400, 1), 1, "Gilead Plant heals the enemy's active fighter");
  assert.equal(sideOf(400, 0), 0, "and the player's when the player casts it");
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
    { side: 0, rollStatusLanded: true, playerActiveAttackModifier: 0 }).side, 1);
  assert.equal(category5Plan(record(391), 391,
    { side: 1, rollStatusLanded: true, playerActiveAttackModifier: 0 }).side, 0,
  "the enemy's cast still lands on the player");
});

test("392 cast by the player drains the ENEMY's MP into the player", () => {
  const b = battle();
  b.player.mp = 20;      // headroom below the maximum, so the landing MP is visible
  b.enemy.mp = 80;
  const plan = battleScriptedPlanFor(b, 0, record(392), 392, { name: "Marsmon" });
  assert.equal(plan.effect, "mpDrain");
  // `maxMP * record[+0x0C] / 128` with the SOURCE's maximum, capped at what it has: the
  // enemy's 100 MP max, record 392's +0x0C byte of 8.
  assert.equal(plan.mpMoved, 6, "trunc(100 * 8 / 128)");
  assert.equal(b.enemy.mp, 74, "the source loses the whole amount");
  assert.equal(b.player.mp, 26, "the caster gains it");
  assert.equal(plan.page.kind, 18);
  assert.equal(plan.page.slots[0], "6");
  // The caster is clamped to its OWN maximum, and the source still pays in full.
  const bAtMax = battle();
  bAtMax.enemy.mp = 80;
  const atMax = battleScriptedPlanFor(bAtMax, 0, record(392), 392, { name: "Marsmon" });
  assert.equal(atMax.mpMoved, 6);
  assert.equal(bAtMax.player.mp, 60, "already at 60/60");
  assert.equal(bAtMax.enemy.mp, 74);
});

test("392 cast by the player refuses when the ENEMY has no MP", () => {
  const b = battle();
  b.enemy.mp = 0;
  const plan = battleScriptedPlanFor(b, 0, record(392), 392, { name: "Marsmon" });
  assert.equal(plan.mpMoved, 0);
  assert.equal(plan.page.kind, 2);
  assert.deepEqual(plan.page.payload, [0x2f, 0x10]);
  assert.equal(b.player.mp, 60, "the caster keeps its MP");
  assert.equal(b.enemy.mp, 0);
  // The enemy's cast is still the shipped arm: the player's MP is the source.
  const byEnemy = battle();
  byEnemy.player.mp = 0;
  const refused = battleScriptedPlanFor(byEnemy, 1, record(392), 392, { name: "Persiamon" });
  assert.equal(refused.mpMoved, 0);
  assert.equal(byEnemy.enemy.mp, 100);
});

test("400 cast by the player heals and charges the PLAYER, not the enemy", () => {
  const b = battle();
  b.player.maxHp = 9000;
  b.player.hp = 100;
  b.player.affinity = 80;
  const plan = battleScriptedPlanFor(b, 0, record(400), 400, { name: "Marsmon" });
  assert.equal(plan.effect, "healCharge");
  assert.equal(plan.side, 0, "the fixed side 0x800a446c flipped to the caster");
  // The power term is record 400's own and the wisdom term the CASTER's (`$a0` is the
  // acting side's byte, :13996), which for a player cast is the player's 40.
  assert.equal(plan.healAmount, damageTermHealAmount(TECH_TABLE["400"].power, 40));
  assert.equal(plan.healAmount, 512 + 40);
  assert.equal(b.player.hp, 100 + plan.healAmount);
  assert.equal(b.player.affinity, 0x20, "the arm's literal 32 lands on the caster");
  assert.equal(b.enemy.hp, 500, "the enemy is untouched");
  assert.equal(b.enemy.affinity, 0);
  // The clear at `fightstg.s:13092` runs first on the acting side, so the record the arm
  // reads back is already empty — `affinityBefore` is 0 however charged the cast was.
  assert.equal(plan.affinityBefore, 0);
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

test("the heal is capped by the caster's own maximum HP on a player cast", () => {
  const b = battle();
  b.player.hp = 290;
  battleScriptedPlanFor(b, 0, record(400), 400, { name: "Marsmon" });
  assert.equal(b.player.hp, 300, "the `+0x06` cap is the record the arm writes");
});
