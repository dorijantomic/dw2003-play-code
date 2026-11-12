// Two disc-value fixes: (1) stat buff/debuff techs 198..208 each use THEIR OWN stat row;
// (2) DNA result techs 374-380 / 432-434 use their record's element, accuracy, category;
// 375 (category 4) fully restores and cures, it is not a hit of power 0.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { battleScriptedPlanFor, battleRestorePlanFor, dnaResultAttack } from "../web/battle.js";

const T = JSON.parse(readFileSync(new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const mk = (hp) => ({ profile: { name: "x", id: 100, family: 1 }, level: 10, hp, maxHp: 300, mp: 60, maxMp: 60,
  str: 150, def: 100, spt: 100, wis: 40, spd: 80, affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {} });
function battle() {
  const player = mk(300), enemy = mk(500);
  return { player, enemy, playerRecords: [player, null, null], activePlayerIndex: 0, encounterGateBytes: new Array(14).fill(0) };
}

test("stat techs each change their own stat", () => {
  const out = {};
  for (const id of [198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208]) {
    const b = battle();
    const plan = battleScriptedPlanFor(b, 0, T[String(id)], id, { roll7: 0, rollLanded: true });
    out[id] = plan.stats.map((s) => JSON.stringify(s));
  }
  console.log(JSON.stringify(out));
  const expect = { 198: 0, 199: 0, 200: 1, 201: 1, 202: 2, 203: 2, 204: 0, 205: 1, 206: 1, 207: 2, 208: 2 };
  for (const [id, s] of Object.entries(expect)) {
    assert.ok(out[id].length > 0, `tech ${id} changed nothing`);
    assert.equal(JSON.parse(out[id][0]).stat, s, `tech ${id}`);
  }
});

test("DNA results use the record", () => {
  for (const id of [374, 375, 376, 377, 378, 379, 380, 432, 433, 434]) {
    const r = T[String(id)];
    const a = dnaResultAttack(id, r, { power: 0, category: 0, element: 1 }, "x");
    assert.equal(a.skill.base_acc, 127);
    assert.equal(a.restore, r.category === 4);
    assert.equal(a.skill.attack_category, r.category === 2 ? "physical" : "magical");
  }
  const b = battle();
  b.player.hp = 10;
  b.player.ailments = { poison: true };
  const plan = battleRestorePlanFor(b, 0, T["375"], 375, { name: "x" });
  console.log("375 hp", b.player.hp, "ailments", JSON.stringify(b.player.ailments));
  assert.equal(b.player.hp, 300);
  assert.equal(b.player.ailments.poison, undefined);
  assert.ok(plan);
});
