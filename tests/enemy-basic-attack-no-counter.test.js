// Disc fightstg.s:28440-28463: an enemy basic attack (record f7 == 10, e.g. 302/303/335 "Fight")
// takes the ordinary attack path and sets no counter stance. Named techniques are unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { setEnemyCounterStance } from "../web/battle.js";

const fight = { id: 335, effect: "counter", basic_attack: true };
const named = { id: 63, effect: "counter" };

test("enemy basic attack (action 1) sets no stance even when effect is counter", () => {
  const en = {};
  assert.equal(setEnemyCounterStance(fight, en, false), false);
  assert.equal(en.counterStance, undefined);
});
test("enemy named counter technique still sets the stance", () => {
  const en = {};
  assert.equal(setEnemyCounterStance(named, en, true), true);
  assert.deepEqual(en.counterStance, { uses: 3 });
});
test("non-counter technique sets nothing", () => {
  const en = {};
  assert.equal(setEnemyCounterStance({ id: 1, effect: "damage" }, en, true), false);
  assert.equal(en.counterStance, undefined);
});
