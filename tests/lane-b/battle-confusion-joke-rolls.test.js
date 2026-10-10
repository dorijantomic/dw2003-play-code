// Lane B oracle for the confusion (command-scramble) leaves.
//
// Confusion is ailment bit 0x04. Two decoded pro/fightstg routines are pure and
// ported in engine/dw3/battle-confusion.ts:
//
//   0x800a1910  confusionGagRoll   the confirm roll: gab if rand%128 < age - (wind+res)/8
//   0x8009a898  shuffleJokeMenu    the Fisher-Yates shuffle, then the first 6 rows
//
// The boundaries here are the routine's own: the threshold has no explicit clamp,
// so <=0 always resolves as Attack and >=128 always gags (the draw is 0..127);
// and the shuffle must be a permutation that only ever consumes rng in the
// original's own 8-step order.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    confusionGagRoll, shuffleJokeMenu, JOKE_COMMANDS, JOKE_FLAVOR,
} from "../../engine/dw3/battle-confusion.ts";

const at = (v) => () => v;

test("0x800a1910 confusionGagRoll: rand%128 < magnitude - (wind+res)/8", () => {
    // magnitude 100, no defence -> threshold 100.
    assert.equal(confusionGagRoll(100, 0, 0, at(99)), true);
    assert.equal(confusionGagRoll(100, 0, 0, at(100)), false);
    // The defensive term truncates (wind+res)/8.
    assert.equal(confusionGagRoll(100, 40, 40, at(89)), true);  // 100 - 10
    assert.equal(confusionGagRoll(100, 40, 40, at(90)), false);
});

test("0x800a1910 confusionGagRoll: a nonpositive threshold always Attacks", () => {
    assert.equal(confusionGagRoll(0, 0, 0, at(0)), false);
    assert.equal(confusionGagRoll(5, 400, 400, at(0)), false);
});

test("0x800a1910 confusionGagRoll: a threshold of 128 or more always gags", () => {
    assert.equal(confusionGagRoll(200, 0, 0, at(127)), true);
});

test("0x8009a898 shuffleJokeMenu: Fisher-Yates over the 8-table, first 6 drawn", () => {
    // rng()==0 makes every j 0, so the shuffle is the pinned sequence of swaps.
    const rows = shuffleJokeMenu(at(0));
    assert.equal(rows.length, 6, "only the first six entries are visible");
    assert.deepEqual(rows.map((r) => r.jokeIndex), [6, 7, 1, 0, 3, 2]);
    // The label always names that joke's own command.
    for (const r of rows) assert.equal(r.label, JOKE_COMMANDS[r.jokeIndex]);
});

test("0x8009a898 shuffleJokeMenu: any draw yields six distinct jokes from the table", () => {
    let seed = 0x1234;
    const rng = () => (seed = (seed * 1103515245 + 12345) >>> 0);
    const rows = shuffleJokeMenu(rng);
    assert.equal(rows.length, 6);
    const seen = new Set(rows.map((r) => r.jokeIndex));
    assert.equal(seen.size, 6, "no joke is shown twice");
    for (const j of seen) assert.ok(j >= 0 && j < JOKE_FLAVOR.length);
});
