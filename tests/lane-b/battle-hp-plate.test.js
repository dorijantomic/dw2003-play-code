// Lane B oracle: engine/dw3/ui/native/battle-hp-plate.ts must match the original
// pro/fightstg HP plate's poll and tween, instruction for instruction.
//
//   FIGHTSTG_F0x80093108  the 8-frame poll that notices a live HP change
//   FIGHTSTG_F0x8009328c  the 30-frame sine tween the bar and the number ride
//
// Both run here exactly as the plate object's own mode-1 arm calls them
// (FIGHTSTG_F0x80093a74 .L0x80093c70/:17488 the poll, :17490 the tween on the
// player's block at +0x58, :17492 the tween on the enemy's block at +0x6c), and
// every frame of every case compares all sixteen words the two side blocks hold
// plus the accumulator and the interval.
//
// The frame delta is the original's own accessor: `[0x8004DF9C]` points at
// `F0x8001D704`, which returns `[0x8004DE28]` (exe/fns.s:14751-14754), and the
// runtime's stub for that getter reads the cell this test writes — so the
// original sees the delta through its own call, not through a seam. The sine is
// the runtime's exact port of `F0x8002abcc` over the disc's own table, while the
// engine port uses engine/dw3/rsin.ts's computed quarter wave.
//
// The extracted overlay in web/assets/native/screens/pro_fightstg.bin is
// word-swapped for the interpreter, so the reference copy in this test loads the
// swapped bytes on purpose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    HP_PLATE_POLL_INTERVAL, HP_PLATE_TWEEN_FRAMES, HP_PLATE_SIDES,
    createHpPlateState, hpPlateTick,
} from "../../engine/dw3/ui/native/battle-hp-plate.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const HUD = 0x80150000;   // the plate object, 0x88 bytes
const ARENA = 0x80151000; // the widget block the plate's tick is handed as a1
const POLL = 0x80093108;   // FIGHTSTG_F0x80093108
const TWEEN = 0x8009328c; // FIGHTSTG_F0x8009328c
/** `[0x8004DE28]` — the word `F0x8001D704` returns, the frame's published delta. */
const DELTA_CELL = 0x8004de28;
/** `[0x800a4468]` / `[0x800a446c]` — each side's active member index. */
const ACTIVE_SLOT = 0x800a4468;
/** `0x800a4470`, and `+0x60` for the enemy side (`.L0x80093c20`, `.L0x80093278`). */
const RECORDS = 0x800a4470;
const RECORD_STRIDE = 0x20;
const SIDE_RECORD_STRIDE = 0x60;
/** `HUD+0x58` and `HUD+0x6c` — the two side blocks, 0x14 apart. */
const SIDE_OFFSETS = [0x58, 0x6c];

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} };
    return new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

/**
 * The plate's BUILD arm, `.L0x80093bd0-.L0x80093c60`: both blocks snap to their
 * member's live HP with no tween and no length, each caches its member index, the
 * accumulator is zeroed and the interval is eight. Written out here from the
 * assembly so the oracle's starting memory is the original's, not the port's.
 */
function seedPlate(rt, members) {
    for (let i = 0; i < 0x88; i += 4) rt.mem.write32(HUD + i, 0);
    rt.mem.write32(HUD + 0x80, 0);                     // :17482
    rt.mem.write32(HUD + 0x84, HP_PLATE_POLL_INTERVAL); // :17481/:17484
    SIDE_OFFSETS.forEach((off, side) => {
        const m = members[side];
        rt.mem.write32(HUD + off + 0x00, m.hp);   // :17455
        rt.mem.write32(HUD + off + 0x04, m.hp);   // :17462
        rt.mem.write32(HUD + off + 0x08, m.hp);   // :17470
        rt.mem.write16(HUD + off + 0x0c, 0);      // :17469
        rt.mem.write16(HUD + off + 0x0e, m.index); // :17475
        rt.mem.write16(HUD + off + 0x10, 0);      // :17473
        rt.mem.write16(HUD + off + 0x12, 0);      // :17474
        rt.mem.write32(ACTIVE_SLOT + side * 4, m.index);
    });
}

/** The live member records the poll reads: `+0x06` maximum, `+0x08` current. */
function seedMembers(rt, members) {
    members.forEach((m, side) => {
        rt.mem.write16(ACTIVE_SLOT + side * 4, m.index);
        const rec = RECORDS + side * SIDE_RECORD_STRIDE + m.index * RECORD_STRIDE;
        rt.mem.write16(rec + 0x06, m.maxHp);
        rt.mem.write16(rec + 0x08, m.hp);
    });
}

/** One displayed frame of the plate: the poll, then one tween per side. */
function originalFrame(rt, delta) {
    rt.mem.write32(DELTA_CELL, delta);
    rt.cpu.call(POLL, [HUD, ARENA], 400000);
    for (const off of SIDE_OFFSETS) rt.cpu.call(TWEEN, [HUD + off], 400000);
}

function readSide(rt, off) {
    return {
        start: rt.mem.read32(HUD + off + 0x00) | 0,
        target: rt.mem.read32(HUD + off + 0x04) | 0,
        shown: rt.mem.read32(HUD + off + 0x08) | 0,
        active: rt.mem.read16(HUD + off + 0x0c) >>> 0,
        index: rt.mem.read16(HUD + off + 0x0e) >>> 0,
        frame: (rt.mem.read16(HUD + off + 0x10) << 16) >> 16,
        length: (rt.mem.read16(HUD + off + 0x12) << 16) >> 16,
    };
}

function readPlate(rt) {
    return {
        acc: rt.mem.read32(HUD + 0x80) | 0,
        interval: rt.mem.read32(HUD + 0x84) | 0,
        sides: SIDE_OFFSETS.map((off) => readSide(rt, off)),
    };
}

/**
 * Run a frame script on both sides and compare after every frame.
 * `frames` is one entry per displayed frame: the live members as that frame's
 * poll will read them, and the delta that frame published.
 */
function runBoth(rt, first, frames) {
    seedPlate(rt, first);
    const port = createHpPlateState(first);
    assert.deepEqual(port.sides.length, HP_PLATE_SIDES, "two sides");

    const original = [];
    const ported = [];
    for (const frame of frames) {
        const members = frame.members ?? first;
        seedMembers(rt, members);
        originalFrame(rt, frame.delta ?? 1);
        original.push(readPlate(rt));
        hpPlateTick(port, members, frame.delta ?? 1);
        ported.push(JSON.parse(JSON.stringify(port)));
    }
    return { original, ported };
}

/** The same script on both sides, with the state after every frame compared. */
function compare(rt, first, frames, label) {
    const { original, ported } = runBoth(rt, first, frames);
    ported.forEach((state, i) => {
        assert.deepEqual(state, original[i], `${label}: frame ${i + 1}`);
    });
    return original;
}

const PARTY = [
    { index: 0, hp: 320, maxHp: 320 },
    { index: 0, hp: 210, maxHp: 210 },
];
/** `frames` of nothing happening. */
const idle = (n, members = PARTY) => Array.from({ length: n }, () => ({ members }));

test("nothing moving: the poll's accumulator climbs to the interval and polls", () => {
    const rt = runtime();
    const seen = compare(rt, PARTY, idle(24), "idle");
    // 8 is the build arm's interval, and the accumulator reaches it on the ninth
    // frame, so the first poll is nine frames in and then every eighth.
    assert.deepEqual(seen.map((s) => s.acc),
        [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(seen.map((s) => s.interval), Array(24).fill(HP_PLATE_POLL_INTERVAL));
    assert.deepEqual(seen[23].sides.map((s) => s.shown), [320, 210]);
});

test("a hit does not move the bar until the next poll, then rides the 30-frame sine", () => {
    const rt = runtime();
    const hit = [{ index: 0, hp: 120, maxHp: 320 }, PARTY[1]];
    // The damage lands on frame 4; the polls are on frames 9, 17, 25...
    const frames = [
        ...idle(3),
        { members: hit },                       // frame 4: the record now says 120
        ...Array.from({ length: 5 }, () => ({ members: hit })),
        ...idle(40, hit),
    ];
    const seen = compare(rt, PARTY, frames, "hit");
    // Frames 1..8 hold the old value and run no tween at all: the live HP is not
    // read until the ninth displayed frame, which is the first poll.
    assert.deepEqual(seen.slice(0, 8).map((s) => s.sides[0].shown), Array(8).fill(320));
    assert.deepEqual(seen.slice(0, 8).map((s) => s.sides[0].active), Array(8).fill(0));
    // The poll frame starts the tween AND advances it, so the bar has already moved
    // by the time that frame is drawn.
    assert.equal(seen[8].sides[0].active, 1);
    assert.equal(seen[8].sides[0].target, 120);
    assert.equal(seen[8].sides[0].start, 320);
    assert.equal(seen[8].sides[0].length, HP_PLATE_TWEEN_FRAMES);
    assert.equal(seen[8].sides[0].frame, 1);
    // The whole drain: monotone, eased, and landing exactly on the live value.
    const curve = seen.map((s) => s.sides[0].shown);
    for (let i = 1; i < curve.length; i++) assert.ok(curve[i] <= curve[i - 1], `frame ${i} rose`);
    assert.equal(curve[curve.length - 1], 120, "the bar ends on the live HP");
    // Halfway through the 30 frames the sine has covered sin(45°) = 0.707, and
    // (120-320)*0.707/30 truncates to -6 per unit of 21/30: 320 - 140 = 180.
    const half = seen[8 + 14].sides[0];
    assert.equal(half.frame, 15);
    assert.equal(half.shown, 180);
});

test("a second hit during a tween restarts it from where the bar is", () => {
    const rt = runtime();
    const first = [{ index: 0, hp: 120, maxHp: 320 }, PARTY[1]];
    const second = [{ index: 0, hp: 250, maxHp: 320 }, PARTY[1]];
    // Poll on frame 9 starts the drain to 120; the next poll is frame 17, and the
    // record is healed back to 250 on frame 14 — after that poll's window closed.
    const frames = [
        ...idle(3),
        { members: first },
        ...Array.from({ length: 9 }, () => ({ members: first })),
        { members: second },
        ...Array.from({ length: 40 }, () => ({ members: second })),
    ];
    const seen = compare(rt, PARTY, frames, "second hit");
    const at = (n) => seen[n - 1].sides[0];
    assert.equal(at(9).target, 120, "the first poll frame");
    assert.ok(at(9).shown < 320, "and the tween has already run one frame");
    // The tween advances EVERY frame; only the target waits for the poll. The
    // record is healed back to 250 on frame 14, between two polls, so the bar
    // keeps draining toward 120 until the poll at frame 17.
    assert.ok(at(14).shown < at(13).shown, "still draining toward the old target");
    assert.equal(at(14).target, 120, "the target does not move between polls");
    // Frame 17 is the next poll: the tween restarts from where the bar is, so the
    // drain to 120 is abandoned mid-flight rather than finished.
    assert.equal(at(17).start, at(16).shown, "the new tween starts where the bar is");
    assert.equal(at(17).target, 250);
    assert.equal(at(17).frame, 1, "and its frame counter is back to one");
    // The first step of the new tween is 1/30th of a 10-point gap, which truncates
    // to nothing, so the bar holds its value for that frame and climbs after it.
    assert.equal(at(17).shown, at(16).shown);
    assert.ok(at(18).shown > at(17).shown, "then climbs toward 250");
    assert.equal(seen[seen.length - 1].sides[0].shown, 250);
});

test("the acting member changing snaps the bar on that frame, with no tween", () => {
    const rt = runtime();
    const hurt = [{ index: 0, hp: 90, maxHp: 320 }, PARTY[1]];
    const swapped = [{ index: 1, hp: 300, maxHp: 300 }, PARTY[1]];
    const frames = [
        ...idle(3),
        { members: hurt },
        ...Array.from({ length: 5 }, () => ({ members: hurt })),
        { members: swapped },                        // frame 10: member 1 takes the field
        ...idle(30, swapped),
    ];
    const seen = compare(rt, PARTY, frames, "swap");
    assert.equal(seen[8].sides[0].target, 90, "frame 9 is still draining to 90");
    assert.equal(seen[8].sides[0].active, 1);
    // The snap runs before the accumulator test, so it lands on the very frame the
    // index moved — not on the next poll — and it kills the running tween.
    assert.equal(seen[9].sides[0].shown, 300, "frame 10 snaps to the new member's HP");
    assert.equal(seen[9].sides[0].target, 300);
    assert.equal(seen[9].sides[0].start, 300);
    assert.equal(seen[9].sides[0].active, 0, "and no tween is left running");
    assert.equal(seen[9].sides[0].index, 1);
    assert.equal(seen[seen.length - 1].sides[0].shown, 300);
});

test("the poll clamps the live HP into the record's own range", () => {
    const rt = runtime();
    const under = [{ index: 0, hp: -5, maxHp: 320 }, PARTY[1]];
    const over = [{ index: 0, hp: 400, maxHp: 320 }, PARTY[1]];
    // Frame 9's poll sees a record below zero and targets zero; the tween runs its
    // 30 frames and ends on it. Frame 49's sees a record above the maximum and
    // targets the MAXIMUM, not the record's number.
    const frames = [
        ...idle(8),
        ...Array.from({ length: 34 }, () => ({ members: under })),
        ...Array.from({ length: 40 }, () => ({ members: over })),
    ];
    const seen = compare(rt, PARTY, frames, "clamp");
    assert.equal(seen[8].sides[0].target, 0, "below zero, the target is zero");
    assert.equal(seen[41].sides[0].shown, 0, "and the bar drains all the way to it");
    assert.equal(seen[41].sides[0].active, 0, "the tween ended on its 30th frame");
    assert.equal(seen[41].sides[0].start, 0, "which snaps the start too");
    assert.equal(seen[48].sides[0].target, 320, "above the maximum, the target is the maximum");
    assert.equal(seen[seen.length - 1].sides[0].shown, 320);
    // The bar had to climb back up, so it is a tween and not a snap.
    assert.ok(seen[seen.length - 1].sides[0].shown > 0);
});

test("each side runs the same rule on its own block", () => {
    const rt = runtime();
    const hurt = [
        { index: 0, hp: 320, maxHp: 320 },
        { index: 0, hp: 60, maxHp: 210 },
    ];
    const frames = [
        ...idle(3),
        { members: hurt },
        ...Array.from({ length: 45 }, () => ({ members: hurt })),
    ];
    const seen = compare(rt, PARTY, frames, "two sides");
    assert.equal(seen[8].sides[0].shown, 320, "the player's bar has not moved");
    assert.equal(seen[8].sides[0].active, 0);
    assert.ok(seen[8].sides[1].shown < 210, "the enemy's bar has");
    assert.equal(seen[8].sides[1].target, 60);
    assert.equal(seen[seen.length - 1].sides[1].shown, 60);
});

test("a frame worth two sixtieths advances the counter twice and brings a poll forward", () => {
    const rt = runtime();
    const hit = [{ index: 0, hp: 150, maxHp: 320 }, PARTY[1]];
    // Seven frames of one, then a frame of two: the accumulator is 9 on the eighth
    // displayed frame, so that frame polls instead of the ninth. The damage lands
    // on that frame, which is what the poll then reads.
    const frames = [
        ...idle(7),
        { members: hit, delta: 2 },
        ...Array.from({ length: 40 }, () => ({ members: hit, delta: 2 })),
    ];
    const seen = compare(rt, PARTY, frames, "delta two");
    assert.deepEqual(seen.slice(0, 8).map((s) => s.acc), [1, 2, 3, 4, 5, 6, 7, 1]);
    assert.equal(seen[7].sides[0].active, 1, "the poll came a frame early");
    assert.equal(seen[7].sides[0].frame, 2, "and the tween's own counter took the whole delta");
    assert.equal(seen[seen.length - 1].sides[0].shown, 150);
});