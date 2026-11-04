// Enemy tells — the every-Nth countdown and the pattern breaker (web/enemy-tells.js).
//
// 27 shipped AI rows sit on condition 18 (`self.turnCounter % value === 0`,
// engine/dw3/battle-formulas.ts case 18): 2 x14, 3 x10, 4 x3, spread over 22
// enemies. The enemy turn bumps its own +0x04 counter before the AI runs
// (web/battle.js applyEnemyAction, wfightmn.s:4144-4148), so a `value 3` row
// fires on turns 3, 6, 9. F2 -> Battle -> "Enemy tells" prints one line under
// the enemy plate counting down to the nearest such row; F2 -> Battle ->
// "Pattern breaker" hands the AI selection one turn further on, so every
// comparator-18 row fires a turn early. Both switches are OFF by default.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enemyMoveCondition, pickEnemyAiMove } from "../engine/dw3/battle-formulas.ts";
import {
  everyNthRows, turnsUntil, nextTurnNumber, nearestTell, tellText,
} from "../web/enemy-tells.js";

const SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const AMB = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
const MODULE = readFileSync(new URL("../web/enemy-tells.js", import.meta.url), "utf8");
const ENEMIES = JSON.parse(
  readFileSync(new URL("../web/assets/data/enemies.json", import.meta.url), "utf8")).enemies;

const at = (v) => () => v;

test("turnsUntil: 0 is the coming turn, otherwise how many turns away", () => {
  assert.equal(turnsUntil(1, 3), 2);
  assert.equal(turnsUntil(3, 3), 0);
  assert.equal(turnsUntil(4, 3), 2);
  assert.equal(turnsUntil(1, 2), 1);
  assert.equal(turnsUntil(2, 2), 0);
  assert.equal(turnsUntil(5, 4), 3);
  assert.equal(turnsUntil(6, 3), 0);
  // value 0 divides by zero on the disc; the port says never, and the tell says nothing.
  assert.equal(turnsUntil(1, 0), null);
});

test("nextTurnNumber is the counter plus the coming turn's bump", () => {
  assert.equal(nextTurnNumber(0), 1);
  assert.equal(nextTurnNumber(7), 8);
  assert.equal(nextTurnNumber(undefined), 1);
});

test("everyNthRows: only comparator 18, each with its row index", () => {
  const kunemon = ENEMIES.find((en) => en.enemy_id === "Kunemon");
  assert.ok(kunemon, "Kunemon ships");
  assert.deepEqual(everyNthRows(kunemon.ai_moves), []);
  const rows = [
    { action: 2, comparator: 18, value: 3 },
    { action: 1, comparator: 1, value: 64 },
  ];
  assert.deepEqual(everyNthRows(rows), [{ rowIndex: 0, value: 3, action: 2 }]);
});

test("the shipped file: 27 every-Nth rows on 22 enemies, values 2/3/4 = 14/10/3", () => {
  let rows = 0;
  let owners = 0;
  const byValue = {};
  for (const en of ENEMIES) {
    const hits = everyNthRows(en.ai_moves);
    if (!hits.length) continue;
    owners++;
    for (const hit of hits) {
      rows++;
      byValue[hit.value] = (byValue[hit.value] ?? 0) + 1;
    }
  }
  assert.equal(rows, 27);
  assert.equal(owners, 22);
  assert.deepEqual(byValue, { 2: 14, 3: 10, 4: 3 });
});

test("nearestTell reads the live counter: the soonest row wins, a turn-3 row never counts", () => {
  const rows = [
    { action: 4, comparator: 18, value: 2 },
    { action: 4, comparator: 18, value: 3 },
    { action: 1, comparator: 0, value: 0 },
    { action: 1, comparator: 0, value: 0 },
  ];
  // Turn 0 has started no enemy action: the coming turn is 1, value 2 fires then.
  assert.deepEqual(nearestTell(rows, 0), { rowIndex: 0, value: 2, action: 4, turns: 1 });
  // After one action the coming turn is 2: the value-2 row fires on it.
  assert.deepEqual(nearestTell(rows, 1), { rowIndex: 0, value: 2, action: 4, turns: 0 });
  // After two actions the coming turn is 3: the value-3 row is now the nearest.
  assert.deepEqual(nearestTell(rows, 2), { rowIndex: 1, value: 3, action: 4, turns: 0 });
  // A cond-18 row in slot 3 is the unconditional fallback, never condition-tested.
  const fallbackOnly = [
    { action: 1, comparator: 0, value: 0 },
    { action: 1, comparator: 0, value: 0 },
    { action: 1, comparator: 0, value: 0 },
    { action: 2, comparator: 18, value: 2 },
  ];
  assert.equal(nearestTell(fallbackOnly, 0), null);
  // A row with value 0 divides by zero on the disc: it never promises a turn.
  assert.equal(nearestTell([{ action: 2, comparator: 18, value: 0 }], 0), null);
  assert.equal(nearestTell([], 3), null);
});

test("a tie goes to the earlier row, the one the AI tests first", () => {
  const rows = [
    { action: 2, comparator: 18, value: 2 },
    { action: 3, comparator: 18, value: 4 },
  ];
  // Coming turn 3: value 2 is 1 away and value 4 is 1 away; row 0 is tested first.
  assert.deepEqual(nearestTell(rows, 2), { rowIndex: 0, value: 2, action: 2, turns: 1 });
});

test("the line's words: \"special on turn 3 - in 2\", and \"now\" on the firing turn", () => {
  assert.equal(tellText({ value: 3, turns: 2 }), "special on turn 3 - in 2");
  assert.equal(tellText({ value: 3, turns: 0 }), "special on turn 3 - now");
  assert.equal(tellText(null), "");
});

test("the breaker's operand: one turn further on passes cond 18 a turn early", () => {
  const self = { mp: 0, hp: 100, maxHp: 100, turnCounter: 2 };
  assert.equal(enemyMoveCondition(18, 3, self, at(0)), false);
  assert.equal(enemyMoveCondition(18, 3, { ...self, turnCounter: self.turnCounter + 1 }, at(0)), true);
  const rows = [
    { action: 2, comparator: 18, value: 3 },
    { action: 1, comparator: 0, value: 0 },
    { action: 1, comparator: 0, value: 0 },
    { action: 1, comparator: 0, value: 0 },
  ];
  assert.equal(pickEnemyAiMove(rows, self, at(0)).action, 1, "turn 2: the row does not pass");
  assert.equal(pickEnemyAiMove(rows, { ...self, turnCounter: 3 }, at(0)).action, 2,
    "the shifted turn 3 passes the row");
});

test("battle.js hands the shifted counter over only under window.__fx?.aishift", () => {
  const fn = SRC.match(/function pickEnemyMove\(en\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(fn, "pickEnemyMove is present");
  const body = fn[1];
  assert.match(body,
    /if \(window\.__fx\?\.aishift\) en = \{ \.\.\.en, turnCounter: \(en\.turnCounter \?\? 0\) \+ 1 \};/,
    "the switch-off path leaves the enemy record itself: same picks, same RNG draws");
  assert.match(body, /pickEnemyAiMove\(moves, en, RAND_U16, battle\.player, context\)/,
    "the engine reads the chosen operand");
  assert.equal((SRC.match(/aishift/g) || []).length, 1,
    "only the AI selection reads the breaker");
});

test("the countdown is drawn only under window.__fx?.enemytells", () => {
  assert.match(SRC, /import \{[^}]*nearestTell[^}]*\} from "\.\/enemy-tells\.js"/,
    "battle.js imports the module");
  const block = SRC.match(/if \(window\.__fx\?\.enemytells\) \{([\s\S]*?)\n    \}/);
  assert.ok(block, "the HUD line is behind the switch");
  assert.match(block[1], /nearestTell\(b\.enemy\.eStats\?\.ai_moves, b\.enemy\.turnCounter \?\? 0\)/,
    "it reads the same ai_moves rows and the live +0x04 counter");
  assert.match(block[1], /nativeText\(tellText\(tell\)/, "one line of text");
  assert.match(block[1], /enemy\.y \+ enemy\.h/, "under the enemy plate");
  assert.equal((SRC.match(/window\.__fx\?\.enemytells/g) || []).length, 1,
    "one gate only: switch off means no line");
});

test("ambience.js offers both switches in the Battle row, off by default", () => {
  assert.match(AMB, /\["enemytells", "Enemy tells: every-Nth countdown \(new\)"\]/);
  assert.match(AMB, /\["aishift", "Pattern breaker: every-Nth rows one turn early \(new\)"\]/);
  const battle = AMB.match(/\["Battle", \[([\s\S]*?)\]\]/);
  assert.ok(battle, "the Battle group is present");
  assert.match(battle[1], /"enemytells"/, "the countdown lives in the Battle row");
  assert.match(battle[1], /"aishift"/, "the breaker lives in the Battle row");
  assert.match(AMB, /const EXPERIMENTAL = \[[^\]]*"enemytells"/, "off until switched on");
  assert.match(AMB, /const EXPERIMENTAL = \[[^\]]*"aishift"/, "off until switched on");
});

test("enemy-tells.js is pure: no imports, no DOM, no writes", () => {
  assert.ok(!/^\s*import\s/m.test(MODULE), "no imports");
  assert.ok(!/document\.|window\.|localStorage|requestAnimationFrame/.test(MODULE), "no browser");
});
