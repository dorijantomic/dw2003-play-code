// The battle AI's WIRING (web/battle.js) against F0x80088564 / F0x80089148 / F0x800a1608.
//
// The engine side of each rule is pinned by tests/engine/unit/enemy-ai-move-condition.test.ts
// and tests/engine/systems/battle-formulas.test.ts; this file keeps the call sites
// data-driven, the way tests/ambush-roll-wiring.test.js keeps the ambush roll's.
//
// Claims behind the four checks:
//   fightstg-enemy-turn-task-and-condition-2026-10-10  (the selection loop, row 3 fallback)
//   fightstg-move-condition-tester-2026-10-11          (check_move_cond arms)
//   wfightmn-runaway-recover-clearfield-2026-10-10     (the runAway arm's pages)
//   escape-roll-is-a-flat-base-plus-speed-bonus-not-a-speed-ratio-2026-10-09
//   the-enemy-flee-roll-refuses-on-sleep-and-halves-its-base-on-frozen-2026-10-09

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");

test("the enemy move pick goes through the engine's F0x80088564 loop", () => {
    const pick = SRC.match(/function pickEnemyMove\(en\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(pick, "pickEnemyMove is present");
    const body = pick[1];
    assert.match(body, /pickEnemyAiMove\(moves, en, RAND_U16, battle\.player, context\)/,
        "the loop lives in engine/dw3/battle-formulas.ts");
    // The old local walk tested EVERY row including the fourth; the loop's row 3 is
    // the unconditional fallback (`slti $s1, 0x3` exit, fightstg.s:6052-6056).
    assert.ok(!/for \(const m of moves\)/.test(body), "no local four-row walk");
    assert.match(body, /return \{ action: 1 \};/, "the no-fourth-row fallback stays explicit");
});

test("check_move_cond's operands are supplied from the battle object", () => {
    const pick = SRC.match(/function pickEnemyMove\(en\)\s*\{([\s\S]*?)\n  \}/)[1];
    assert.match(pick, /partyAilmentByte: battleAilmentByte\(battle\.player\)/,
        "cond 9 reads the active party member's +0x1c byte, not the enemy's");
    assert.match(pick, /encounterGateByte: battle\.encounterGateBytes\?\.\[1\]/,
        "cond 13 reads 0x80042b59 (config byte 1)");
});

test("the enemy technique pays its MP only when it can: else the disc's \"No MP!\" page", () => {
    const act = SRC.match(/function applyEnemyAction\(\)\s*\{([\s\S]*?)\n  \}\n/);
    assert.ok(act, "applyEnemyAction is present");
    const body = act[1];
    assert.match(body, /if \(en\.mp < mpCost\) \{/,
        "curMP is tested against the cost first (fightstg.s:6086-6090)");
    assert.match(body, /payload: \[MSG\.NO_MP\]/, "esmfight[0x8d] \"No MP!\"");
    // The gate returns before the subtraction, so a refused action never pays.
    const gate = body.indexOf("if (en.mp < mpCost) {");
    const pay = body.indexOf("en.mp -= mpCost;");
    assert.ok(gate >= 0 && pay > gate, "the refusal returns before any subtraction");
});

test("the enemy flee shows the disc's 0x5E page before its outcome", () => {
    const act = SRC.match(/function applyEnemyAction\(\)\s*\{([\s\S]*?)\n  \}\n/)[1];
    assert.match(act, /payload: \[MSG\.TRYING_TO_FLEE\]/,
        "0x5E \"Trying to flee.\" precedes the roll (fightstg.s file 0x6125-0x6137)");
    assert.match(act, /setResultPages\(b, \[/,
        "both pages go up as one Circle-gated sequence");
});

test("the player's Run is refused by the encounter's own 0x80042b65 byte", () => {
    assert.match(SRC, /escapeBlocked: \(b\.encounterGateBytes\?\.\[13\] \?\? 0\) !== 0/,
        "byte 13 of the encounter config is F0x800a1608's first player-side test");
});

test("the player's Run shows the disc's 0x41 page before its 0x43 outcome", () => {
    const run = SRC.match(/else if \(sel === "run"\) \{([\s\S]*?)\n    \}\n  \}/);
    assert.ok(run, "the Run command branch is present");
    const body = run[1];
    assert.match(body, /payload: \[MSG\.RUN\]/,
        "esmfight[0x41] \"Run!\" is the command arm's own page (wfightmn.s file 0x18a8)");
    assert.match(body, /payload: \[runAwayLine\(0\)\]/, "then the runAway arm's 0x43");
    assert.match(body, /setResultPages\(b, \[/, "both pages go up as one Circle-gated sequence");
    // The battle ends only after the pages have been read, through the advance hook.
    assert.match(SRC, /if \(b\._runAwayEnd\) \{ const run = b\._runAwayEnd; b\._runAwayEnd = null; run\(\); return; \}/,
        "the exit runs from advanceAfterResult, not a timer");
    // The disc prints NO second page on a failed Run; the old typed sentence is gone.
    assert.ok(!SRC.includes('b.message = "Can\'t escape!"'), "no typed refusal sentence");
});
