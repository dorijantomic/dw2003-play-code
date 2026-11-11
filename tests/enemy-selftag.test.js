// The enemy's own tag (switch to another member of its team), exactly as the original:
//   src/battle/battle_mode/enemy_turn.c  FIGHTSTG_updateEnemyTurn substates 2, 4, 5, 6 (the turn),
//   FIGHTSTG_pickEnemySwitch (:9-62), FIGHTSTG_testEnemyCondition (:~290), FIGHTSTG_getEnemyAction (:438-470),
//   normal_battle/menu.c:1088-1096 (the next enemy after a KO: the lowest slot with id != 0 and hp != 0),
//   battle_mode/entrance.c FIGHTSTG_startEntrance(id, 1, 0) -> side 0x10 entrance (commit f114).
// Rules and file:line are written out in /home/dorij/dv-camera/BUILD-selftag-dw2003-play-integration.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  enemySwitchTarget, pickEnemySwitch, firstAliveEnemySlot, enemyTeamSlots, enemySelfTagPick,
  ENEMY_SWITCH_MSG_TAKING_OUT, ENEMY_SWITCH_MSG_FAILED, ENEMY_SELFTAG_NAME_FRAME,
} from "../web/enemy-switch.js";
import { pickEnemyAiMove } from "../engine/dw3/battle-formulas.ts";
import {
  FormChangeProgram, formChangeState, entranceCameraSchedule,
} from "../engine/systems/blast-presentation.ts";

const BATTLE = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");

// A rng that records its draws and returns the queued values.
function rng(...values) {
  const queue = [...values];
  const f = () => { f.draws++; return queue.shift() ?? 0; };
  f.draws = 0;
  return f;
}
const slot = (id, hp) => ({ id, hp });

// ── getEnemyAction: the table's action kinds 5..8 are the targets -2..-5 (enemy_turn.c:456-466) ──────────
test("action kinds 5..8 are the switch targets -2..-5, nothing else is", () => {
  assert.deepEqual([5, 6, 7, 8].map(enemySwitchTarget), [-2, -3, -4, -5]);
  for (const kind of [0, 1, 2, 3, 4, 9]) assert.equal(enemySwitchTarget(kind), 0, `kind ${kind}`);
});

// ── pickEnemySwitch cases -2 / -3 / -4 (enemy_turn.c:16-39) ───────────────────────────────────────────
test("a named slot is taken only when its id differs from the active one's and it has hp", () => {
  const team = [slot(10, 50), slot(20, 50), slot(30, 50)];
  assert.equal(pickEnemySwitch(team, 0, -3, rng()), 1);
  assert.equal(pickEnemySwitch(team, 0, -4, rng()), 2);
  assert.equal(pickEnemySwitch(team, 1, -2, rng()), 0);
  // the slot that is already active: its id equals the active id -> -1
  assert.equal(pickEnemySwitch(team, 1, -3, rng()), -1);
  // the same SPECIES in another slot: ids equal -> -1 (the compare is of ids, not of slots)
  assert.equal(pickEnemySwitch([slot(10, 50), slot(10, 50), slot(30, 50)], 0, -3, rng()), -1);
  // fainted or empty slot: hp 0 -> -1
  assert.equal(pickEnemySwitch([slot(10, 50), slot(20, 0), slot(0, 0)], 0, -3, rng()), -1);
  assert.equal(pickEnemySwitch([slot(10, 50), slot(20, 0), slot(0, 0)], 0, -4, rng()), -1);
  // no random draw on these three cases
  const r = rng(1);
  pickEnemySwitch(team, 0, -3, r);
  assert.equal(r.draws, 0);
});

// ── pickEnemySwitch default (-5): one of the OTHER living slots (enemy_turn.c:40-60) ──────────────────
test("target -5: none -> -1, one -> it, two -> found[rand & 1]; one draw only for two", () => {
  let r = rng(1);
  assert.equal(pickEnemySwitch([slot(10, 50), slot(20, 0), slot(0, 0)], 0, -5, r), -1);
  assert.equal(r.draws, 0, "no candidates: no draw");
  r = rng(1);
  assert.equal(pickEnemySwitch([slot(10, 50), slot(20, 0), slot(30, 9)], 0, -5, r), 2);
  assert.equal(r.draws, 0, "one candidate: no draw");
  r = rng(0x1234);   // even
  assert.equal(pickEnemySwitch([slot(10, 50), slot(20, 7), slot(30, 9)], 0, -5, r), 1);
  assert.equal(r.draws, 1);
  r = rng(0x1235);   // odd
  assert.equal(pickEnemySwitch([slot(10, 50), slot(20, 7), slot(30, 9)], 0, -5, r), 2);
  // active in the middle: the list is the other two in slot order
  r = rng(0);
  assert.equal(pickEnemySwitch([slot(10, 5), slot(20, 7), slot(30, 9)], 1, -5, r), 0);
  r = rng(1);
  assert.equal(pickEnemySwitch([slot(10, 5), slot(20, 7), slot(30, 9)], 1, -5, r), 2);
  // the active slot never counts, an id-0 slot never counts
  assert.equal(pickEnemySwitch([slot(10, 50), slot(0, 5), slot(30, 0)], 0, -5, rng(1)), -1);
});

// ── the whole decision: table rows + state + rng -> tag or not, and which member ──────────────────────
test("decision: a row with action 6 (slot 1) whose condition 10 holds tags to slot 1", () => {
  const rows = [
    { action: 1, comparator: 3, value: 20 },        // cond 3: hp >= 20/128 share -> would attack first
    { action: 6, comparator: 10, value: 365 },
    { action: 4, comparator: 13, value: 1 },
    { action: 1, comparator: 0, value: 0 },
  ];
  // hp under the cond-3 share so row 0 fails; cond 10 (species 365 alive in another slot) holds
  const self = { hp: 1, maxHp: 1000 };
  const team = [{ profile: { id: 7 }, hp: 1 }, { profile: { id: 365 }, hp: 80 }, null];
  const ctx = { enemySlots: enemyTeamSlots(team), activeEnemyIndex: 0 };
  const move = pickEnemyAiMove(rows, self, () => 0, undefined, ctx);
  assert.equal(move.action, 6);
  assert.equal(enemySelfTagPick(move, enemyTeamSlots(team), 0, rng()), 1);
  // slot 1 fainted: cond 10 fails, falls to the unconditional row 3 (attack): no tag
  const dead = [{ profile: { id: 7 }, hp: 1 }, { profile: { id: 365 }, hp: 0 }, null];
  const ctx2 = { enemySlots: enemyTeamSlots(dead), activeEnemyIndex: 0 };
  const move2 = pickEnemyAiMove(rows, self, () => 0, undefined, ctx2);
  assert.equal(move2.action, 1);
  assert.equal(enemySelfTagPick(move2, enemyTeamSlots(dead), 0, rng()), null, "an attack is not a tag");
});

test("decision: the 128-roll row (cond 1) uses the rng before the switch pick", () => {
  const rows = [{ action: 8, comparator: 1, value: 64 }, { action: 1, comparator: 0, value: 0 },
    { action: 1, comparator: 0, value: 0 }, { action: 1, comparator: 0, value: 0 }];
  const team = [{ profile: { id: 7 }, hp: 9 }, { profile: { id: 8 }, hp: 9 }, { profile: { id: 9 }, hp: 9 }];
  const slots = enemyTeamSlots(team);
  const ctx = { enemySlots: slots, activeEnemyIndex: 0 };
  const draws = [];
  const roll = (v) => () => { draws.push(v); return v; };
  // enemyMoveCondition's cond 1 is `rand % 128 < value`
  assert.equal(pickEnemyAiMove(rows, { hp: 9, maxHp: 9 }, roll(63), undefined, ctx).action, 8);
  assert.equal(pickEnemyAiMove(rows, { hp: 9, maxHp: 9 }, roll(64), undefined, ctx).action, 1);
});

test("an enemy with no team members never tags", () => {
  const solo = enemyTeamSlots([{ profile: { id: 7 }, hp: 9 }]);
  for (const action of [5, 6, 7, 8]) {
    assert.equal(enemySelfTagPick({ action }, solo, 0, rng(1, 1)), -1, `action ${action}`);
  }
  assert.equal(ENEMY_SWITCH_MSG_FAILED, 0x8e, "the failed switch page stays esmfight 0x8E");
});

// ── the next enemy after a KO: lowest living slot (menu.c:1088-1096) ──────────────────────────────────
test("after a KO the next enemy is the lowest slot with an id and hp", () => {
  assert.equal(firstAliveEnemySlot([slot(10, 0), slot(20, 5), slot(30, 5)]), 1);
  assert.equal(firstAliveEnemySlot([slot(10, 5), slot(20, 0), slot(30, 5)]), 0, "a tagged-out member returns");
  assert.equal(firstAliveEnemySlot([slot(10, 0), slot(0, 0), slot(30, 0)]), -1);
});

// ── the presentation: the side 0x10 entrance, commit at f114, name message after it ───────────────────
test("self-tag runs the enemy entrance: commit on f114, the name page on the next update", () => {
  const sch = entranceCameraSchedule(1);
  assert.equal(sch.swapFrame, 114);
  assert.equal(formChangeState(FormChangeProgram.ENTRANCE_ENEMY, 113).showNewModel, false);
  assert.equal(formChangeState(FormChangeProgram.ENTRANCE_ENEMY, 114).showNewModel, true);
  // enemy_turn.c:279-286: substate 6 sees done and sets 4, substate 4 makes the message on the next update
  assert.equal(ENEMY_SELFTAG_NAME_FRAME, sch.swapFrame + 1);
  assert.equal(ENEMY_SWITCH_MSG_TAKING_OUT, 0x4d);
});

test("battle.js wires it: pick -> 0x4D page -> side 1 entrance -> commit at the cut -> name page", () => {
  assert.match(BATTLE, /from "\.\/enemy-switch\.js"/);
  const apply = BATTLE.match(/function applyEnemyAction\(\) \{([\s\S]*?)\n  function /)?.[1] ?? "";
  assert.match(apply, /enemySelfTagPick\(/, "the action 5..8 arm picks through the original's rule");
  assert.match(apply, /ENEMY_SWITCH_MSG_TAKING_OUT/, "the first page is esmfight 0x4D, kind 1");
  assert.match(BATTLE, /_selfTag/, "the turn's rest waits for the entrance");
  const start = BATTLE.match(/function startEnemySelfTag\(([\s\S]*?)\n  \}\n/)?.[0] ?? "";
  assert.match(start, /startEntrance\(b, \{\s*side: 1/, "the side 0x10 entrance, reused");
  assert.match(start, /onSwap/, "the active slot is committed at the cut");
  assert.match(start, /ENEMY_SELFTAG_NAME_FRAME/, "the name page is raised on its own frame");
  // KO: the next enemy is the lowest living slot, not index + 1
  assert.match(BATTLE, /firstAliveEnemySlot\(/);
  // the status events of the turn come after the tag finishes (enemy_turn.c substate 3), not before
  assert.match(BATTLE, /if \(!b\._selfTag\) queueAfterAction\(b, "enemy"\)/);
});
