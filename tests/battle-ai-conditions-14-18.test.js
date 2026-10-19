// The AI move conditions 14-18 (F3), their per-enemy-slot turn counter, and the far-side
// counter row (B-F/B4).
//
// Engine halves pin the decoded check_move_cond arms (pro/fightstg/check_move_cond.s
// .L24-.L28, fightstg.s:381-421) and the counter row's action map; the source half keeps
// the browser call sites honest, the way tests/battle-ai-wiring.test.js does:
//
//   wfightmn.s:4140-4148   record +0x04 = enemy action turns started, bumped once per turn
//   fightstg.s:12506-12528 the far-side counter row (+0x42 action, +0x43 cond, +0x44 value)
//   fightstg.s:6159-6188   actions 5..8 fail as "Switch failed!" and spend the turn

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enemyMoveCondition, pickEnemyAiMove } from "../engine/dw3/battle-formulas.ts";

const SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const at = (v) => () => v;
const self = (over = {}) => ({ mp: 0, hp: 100, maxHp: 100, ...over });

test("cond 14: the record's +0x0e affinity, nonzero passes", () => {
    assert.equal(enemyMoveCondition(14, 0, self({ affinity: 0 }), at(0)), false);
    assert.equal(enemyMoveCondition(14, 0, self({ affinity: 5 }), at(0)), true);
    assert.equal(enemyMoveCondition(14, 0, self({ affinity: -1 }), at(0)), true);
    // No record field -> the predicate is unmodelled, not false (callers skip the row).
    assert.equal(enemyMoveCondition(14, 0, self(), at(0)), null);
});

test("conds 15/16/17: a NEGATIVE stat modifier passes (+0x10 STR, +0x12 DEF, +0x14 SPD)", () => {
    const debuffed = self({ statMods: { str: -3, def: 0, spd: 7 } });
    assert.equal(enemyMoveCondition(15, 0, debuffed, at(0)), true);
    assert.equal(enemyMoveCondition(16, 0, debuffed, at(0)), false);
    assert.equal(enemyMoveCondition(17, 0, debuffed, at(0)), false);
    const allDown = self({ statMods: { str: -1, def: -1, spd: -1 } });
    assert.equal(enemyMoveCondition(15, 0, allDown, at(0)), true);
    assert.equal(enemyMoveCondition(16, 0, allDown, at(0)), true);
    assert.equal(enemyMoveCondition(17, 0, allDown, at(0)), true);
    // A positive modifier is a buff, never a debuff.
    assert.equal(enemyMoveCondition(15, 0, self({ statMods: { str: 9 } }), at(0)), false);
    assert.equal(enemyMoveCondition(15, 0, self(), at(0)), null);
});

test("cond 18: the per-slot enemy-turn counter modulo the row value", () => {
    assert.equal(enemyMoveCondition(18, 3, self({ turnCounter: 3 }), at(0)), true);
    assert.equal(enemyMoveCondition(18, 3, self({ turnCounter: 6 }), at(0)), true);
    assert.equal(enemyMoveCondition(18, 3, self({ turnCounter: 4 }), at(0)), false);
    // The first turn reads 1 (the bump happens at the turn's start).
    assert.equal(enemyMoveCondition(18, 1, self({ turnCounter: 1 }), at(0)), true);
    // value 0 divides by zero on the disc: the port says never.
    assert.equal(enemyMoveCondition(18, 0, self({ turnCounter: 3 }), at(0)), false);
    assert.equal(enemyMoveCondition(18, 3, self(), at(0)), null);
});

test("pickEnemyAiMove takes the first cond-18 row whose turn comes up", () => {
    const rows = [
        { action: 2, comparator: 18, value: 3 },
        { action: 3, comparator: 18, value: 2 },
        { action: 1, comparator: 0, value: 0 },
        { action: 1, comparator: 0, value: 0 },
    ];
    assert.equal(pickEnemyAiMove(rows, self({ turnCounter: 3 }), at(0)).action, 2);
    assert.equal(pickEnemyAiMove(rows, self({ turnCounter: 2 }), at(0)).action, 3);
    // Turn 5 passes neither modulo row and lands on row 2 (the always row).
    assert.equal(pickEnemyAiMove(rows, self({ turnCounter: 5 }), at(0)).action, 1);
});

test("the enemy turn bumps record +0x04 once, before every gate", () => {
    const act = SRC.match(/function applyEnemyAction\(\)\s*\{([\s\S]*?)\n  \}\n/);
    assert.ok(act, "applyEnemyAction is present");
    const body = act[1];
    assert.match(body, /en\.turnCounter = \(en\.turnCounter \?\? 0\) \+ 1;/,
        "the acting slot's counter is bumped (wfightmn.s:4144-4148)");
    const bump = body.indexOf("en.turnCounter = (en.turnCounter ?? 0) + 1;");
    const gate = body.indexOf("processTurnStart(en, name)");
    assert.ok(bump >= 0 && gate > bump, "the bump precedes the ailment gate, so a skipped turn counts");
    assert.match(SRC, /turnCounter: 0,/, "a fresh enemy record starts the counter at 0");
});

test("the counter row drives the enemy counter, not a hard-coded basic attack", () => {
    const fn = SRC.match(/function triggerEnemyCounterRow\(([\s\S]*?)\n  \}\n/);
    assert.ok(fn, "triggerEnemyCounterRow is present");
    const body = fn[1];
    assert.match(body, /defender\.eStats\?\.counter/, "the 0x46-byte row's +0x42..+0x44");
    assert.match(body, /damage <= 0 \|\| defender\.hp <= 0/, "only a landed, surviving blow counters");
    assert.match(body, /if \(!row \|\| !\(row\.comparator \| 0\)\) return "";/,
        "+0x43 == 0 is tested directly (fightstg.s:12512-12514)");
    assert.match(body, /enemyMoveCondition\(row\.comparator/, "the row's condition is check_move_cond");
    assert.match(body, /enemyActionSkillId\(action, defender\.eStats/, "action 1/2/3 -> attack/move_1/move_2");
    assert.match(body, /resolveAttack\(defender, attacker/, "a full attack by the defender");
    // Both enemy-side counter sites (the basic attack and the technique path).
    const calls = SRC.match(/triggerEnemyCounterRow\(b, b\.player, b\.enemy, total, pname, enemyName\)/g) ?? [];
    assert.equal(calls.length, 2, "basic-attack and technique commits both read the row");
    // The player-side counter stays profile +0x1C (phase2-rtarget 2.2).
    assert.match(SRC, /const basic = skillDB\[defender\.profile\?\.tech_basic\];/,
        "triggerPlayerCounter still counters with the player's tech_basic");
});

test("actions 5..8 spend the turn on the disc's 0x8E \"Switch failed!\" page", () => {
    const act = SRC.match(/function applyEnemyAction\(\)\s*\{([\s\S]*?)\n  \}\n/)[1];
    assert.match(act, /\(move\.action \| 0\) >= 5 && \(move\.action \| 0\) <= 8/,
        "the four switch actions are handled before the skill map");
    assert.match(act, /MSG\.SWITCH_FAILED/, "esmfight 0x8E is the page");
    const switchArm = act.indexOf("MSG.SWITCH_FAILED");
    const skillMap = act.indexOf("enemyActionSkillId(move.action || 1");
    assert.ok(switchArm >= 0 && skillMap > switchArm, "the arm returns before any attack is resolved");
});
