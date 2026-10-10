// The battle HP plate's drain, as the player watches it: a hit does not move the
// bar on the frame it lands, the bar rides the original's 30-frame sine ease-out
// afterwards, and a second hit during that drain restarts it from where the bar
// already is.
//
// The shared system here is the plate object's own mode-1 arm, ported once in
// engine/dw3/ui/native/battle-hp-plate.ts from pro/fightstg's FIGHTSTG_F0x80093108 (the
// 8-frame poll) and FIGHTSTG_F0x8009328c (the tween). This file is the player-facing
// reading of that port; tests/lane-b/battle-hp-plate.test.js is the oracle that runs
// the original's two routines instruction for instruction and compares every field.

import test from "node:test";
import assert from "node:assert/strict";
import {
    HP_PLATE_POLL_INTERVAL, HP_PLATE_TWEEN_FRAMES,
    createHpPlateState, hpPlateShown, hpPlateTick,
} from "../engine/dw3/ui/native/battle-hp-plate.ts";

const MAX = 320;
const ENEMY_HP = 210;
const ENEMY_MAX = 210;

/** A fresh plate and the side list the poll reads, both at full health. */
function plate(hp = MAX, maxHp = MAX) {
    const members = [{ index: 0, hp, maxHp }, { index: 0, hp: ENEMY_HP, maxHp: ENEMY_MAX }];
    return { members, state: createHpPlateState(members) };
}

/** One displayed frame at delta 1: the common case, 60 frames a second. */
function frame(plateState, members, delta = 1) {
    hpPlateTick(plateState, members, delta);
}

/** The bar's value after `n` more displayed frames. */
function after(plateState, members, n, delta = 1) {
    for (let i = 0; i < n; i++) frame(plateState, members, delta);
    return hpPlateShown(plateState, 0);
}

test("the plate's poll interval is eight of a frame's sixty parts, and the tween is thirty frames", () => {
    assert.equal(HP_PLATE_POLL_INTERVAL, 8);
    assert.equal(HP_PLATE_TWEEN_FRAMES, 30);
});

test("a fresh plate shows both bars at their live HP with nothing running", () => {
    const p = plate();
    assert.equal(hpPlateShown(p.state, 0), MAX);
    assert.equal(hpPlateShown(p.state, 1), ENEMY_HP);
    assert.equal(p.state.sides[0].active, 0);
    assert.equal(p.state.sides[0].length, 0, "the build arm leaves the length at zero");
    assert.equal(p.state.acc, 0);
    assert.equal(p.state.interval, 8);
});

test("a hit is noticed at the next eight-frame poll, not on the frame it lands", () => {
    const p = plate();
    // Three quiet frames, then the record drops from 320 to 120 on frame 4.
    after(p.state, p.members, 3);
    p.members[0].hp = 120;
const seen = [];
    let atPoll = null;
    for (let i = 0; i < 10; i++) {
        frame(p.state, p.members);
        seen.push(hpPlateShown(p.state, 0));
        if (atPoll === null && seen[i] < MAX) atPoll = { ...p.state.sides[0] };
    }
    // Frames 4..8: the live HP has changed and the bar has not moved, because the
    // original only re-reads the record every eighth frame.
    assert.deepEqual(seen.slice(0, 5), [MAX, MAX, MAX, MAX, MAX],
        "five frames after the hit the bar is still full");
    // Frame 9 is the first poll (the accumulator starts at zero and the test is
    // `interval < accumulator`), and the tween has already run its first frame.
    assert.ok(atPoll, `frame 9 moves the bar, got ${JSON.stringify(seen)}`);
    assert.equal(atPoll.target, 120);
    assert.equal(atPoll.frame, 1);
    assert.equal(atPoll.length, HP_PLATE_TWEEN_FRAMES);
    assert.equal(atPoll.active, 1);
    assert.equal(atPoll.start, MAX, "the tween starts where the bar was");
    // Frame 10 runs the tween's second frame, so the counter is on 5 five frames later.
    assert.equal(p.state.sides[0].frame, atPoll.frame + 4);
});

test("the drain is the original's 30-frame sine ease-out, landing exactly on the live HP", () => {
    const p = plate();
    after(p.state, p.members, 8);          // the poll lands on frame 9
    p.members[0].hp = 120;
    frame(p.state, p.members);
    const curve = [hpPlateShown(p.state, 0)];
    for (let i = 0; i < HP_PLATE_TWEEN_FRAMES - 1; i++) {
        frame(p.state, p.members);
        curve.push(hpPlateShown(p.state, 0));
    }
    assert.equal(curve.length, HP_PLATE_TWEEN_FRAMES);
    // Ease-out: the first frames take small bites and the last ones take large ones.
    assert.deepEqual(curve.slice(0, 6), [314, 300, 294, 280, 274, 260]);
    // sin(45 deg) is 0.707, so half way through the 30 frames the bar has covered
    // 200 * 0.707 = 141 of its 200 points, truncated to 140.
    assert.equal(curve[14], 180);
    // Never below the live HP and never above where it came from.
    for (const v of curve) assert.ok(v <= MAX && v >= 120, `out of range: ${v}`);
    for (let i = 1; i < curve.length; i++) assert.ok(curve[i] <= curve[i - 1], `frame ${i} rose`);
    assert.equal(curve[HP_PLATE_TWEEN_FRAMES - 1], 120, "the 30th frame lands on the live HP");
    assert.equal(p.state.sides[0].active, 0, "and the tween is finished");
    // Afterwards the bar sits on the live HP and no longer moves.
    assert.equal(after(p.state, p.members, 40), 120);
});

test("a second hit during a drain waits for the next poll and restarts from where the bar is", () => {
    const p = plate();
    after(p.state, p.members, 3);
    p.members[0].hp = 120;                // the hit, live on frame 4
    after(p.state, p.members, 9);         // frames 4..12; the poll on frame 9 drained it to 280
    assert.equal(hpPlateShown(p.state, 0), 280);
    assert.equal(p.state.sides[0].target, 120);
    // A heal on frame 13, between the poll on frame 9 and the one on frame 17.
    p.members[0].hp = 250;
    frame(p.state, p.members);
    assert.equal(hpPlateShown(p.state, 0), 274, "frame 13 keeps draining");
    assert.equal(p.state.sides[0].target, 120, "the tween is still going to the old value");
    after(p.state, p.members, 3);         // frames 14, 15, 16
    assert.equal(hpPlateShown(p.state, 0), 240);
    assert.equal(p.state.sides[0].target, 120, "nor do frames 14 to 16 know about the heal");
    frame(p.state, p.members);
    // Frame 17 polls, sees 250, and starts a fresh 30-frame tween from the value
    // the bar is showing now — the drain to 120 is abandoned half way.
    assert.equal(p.state.sides[0].target, 250);
    assert.equal(p.state.sides[0].start, 240);
    assert.equal(p.state.sides[0].frame, 1);
    assert.equal(hpPlateShown(p.state, 0), 240, "one thirtieth of a 10-point rise truncates to 0");
    assert.ok(after(p.state, p.members, 5) > 240, "then it climbs back toward 250");
    assert.equal(after(p.state, p.members, 40), 250);
});

test("the acting Digimon changing snaps that plate's bar on the frame it changes", () => {
    const p = plate();
    after(p.state, p.members, 3);
    p.members[0].hp = 90;
    after(p.state, p.members, 6);          // frames 4..9: the poll started a tween
    assert.equal(p.state.sides[0].active, 1);
    // Member 1 takes the field. The snap is not behind the poll: it runs on the very
    // frame the index moved, and it kills the running tween.
    p.members[0] = { index: 1, hp: 300, maxHp: 300 };
    frame(p.state, p.members);
    assert.equal(hpPlateShown(p.state, 0), 300);
    assert.equal(p.state.sides[0].active, 0);
    assert.equal(p.state.sides[0].index, 1);
    assert.equal(after(p.state, p.members, 40), 300);
});

test("a frame worth two sixtieths polls one frame early and steps the tween twice", () => {
    const p = plate();
    after(p.state, p.members, 7);
    // Seven deltas of 1 leave the accumulator at 7; one delta of 2 takes it to 9,
    // which is past the interval of 8, so THIS frame polls.
    p.members[0].hp = 150;
    frame(p.state, p.members, 2);
    assert.equal(p.state.acc, 1, "the interval came off the accumulator once");
    assert.equal(p.state.sides[0].active, 1, "the poll came a frame early");
    assert.equal(p.state.sides[0].frame, 2, "and the tween took the whole delta");
    assert.equal(after(p.state, p.members, 40, 2), 150);
});

test("both plates keep their own numbers, and each is the value its bar is drawn from", () => {
    const p = plate();
    after(p.state, p.members, 3);
    p.members[0].hp = 100;                // the player's Digimon is hit
    p.members[1].hp = 40;                 // so is the enemy's, on the same frame
    frame(p.state, p.members);
    assert.equal(hpPlateShown(p.state, 0), MAX, "the player's bar has not moved yet");
    assert.equal(hpPlateShown(p.state, 1), ENEMY_HP);
    after(p.state, p.members, 5);         // frames 5..9: the poll is frame 9
    assert.ok(hpPlateShown(p.state, 0) < MAX);
    assert.ok(hpPlateShown(p.state, 1) < ENEMY_HP);
    after(p.state, p.members, 40);
    assert.equal(hpPlateShown(p.state, 0), 100);
    assert.equal(hpPlateShown(p.state, 1), 40);
});