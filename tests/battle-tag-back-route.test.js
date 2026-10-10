// Back on the Tag partner list closes it; Back on the "nobody to tag" pane does
// nothing, and only Circle does.
//
// Both halves are the original's, and neither is the walker's:
//
//   * The partner list is FIGHTSTG_F0x80097498 (pro/fightstg.s:21180). Its state 1
//     draws the panels and then reads the pad: cancel word 0x4000, gated on
//     `self+0x58 != 0` (the forced TAG has no cancel), at :21294-:21299. The arm
//     plays `lui $a0, 0x8004` :21434 plus the delay-slot `ori $a0, 0x50bd` :21438 —
//     the whole pair, sound id 0x800450BD — writes -2 to the out word :21441-:21442
//     and moves the screen to state 3 :21443-:21446. It writes NO row: the confirm
//     arm's `sw $a0, ($v0)` :21326 is the only store to the row cell, so a cancel
//     leaves the row the caller remembered untouched.
//
//   * The pane is the same routine's state 2, reached only when the party scan
//     found no candidate (`blez $v1`, :21248 -> :21269-:21284). Its pad read is at
//     :21343-:21348 and the only test between there and the routine's end (:21485)
//     is `andi $v0, 0x2000`. There is no 0x4000 arm on that screen at all, so Back
//     leaves it exactly as it is. Circle answers -2 (:21356-:21363) with sound
//     `lui $a0, 0x4` :21350 plus delay-slot `ori $a0, 0x1c` :21355 = 0x0004001C,
//     and hides the message widget (:21364-:21369).
//
// What the -2 buys the battle is the command list again, on the row it was taken
// from: see tools/verify_translated_battlecmd.mjs and the phase decode in
// docs/research/battle/fightstg-command-dispatch.md.
//
// The original half of each rule is pinned against the assembled routine by
// tests/lane-b/fight-tag-menu.test.js (its cases "cancel", "cancel while forced"
// and "cancel does nothing"); this file drives the shipped session so the same
// rules cannot rot in the browser-facing wrapper either.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    FightTagSession, FIGHT_TAG_BANKS, FIGHT_TAG_TABLES_SIZE,
} from "../engine/dw3/ui/fight-tag-session.ts";
import { PROFILE_ROWS } from "../engine/dw3/ui/native/pause-status.ts";
import { TAG_RESULT_CANCEL, TAG_CANCEL_SOUND, TAG_CONFIRM_SOUND } from "../engine/dw3/ui/native/battle-tag-menu.ts";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const bytes = (path) => new Uint8Array(readFileSync(join(data, path)));

const RESOURCES = {
    tables: bytes("battlecmd/tag-tables.bin"),
    profiles: bytes("digimon_profiles.bin"),
    font: bytes("shop_font.bin"),
    banks: new Map(FIGHT_TAG_BANKS.map((bank) => [bank + 2, bytes(`battlecmd/${bank + 2}.bin`)])),
};

const member = (digimonId, hp) => ({ digimonId, hp, maxHp: 200, mp: 80, maxMp: 80, name: 0 });

function openTag({ interactive = 1, activeIndex = 0, members, cursorRow = 0 } = {}) {
    const sounds = [];
    const session = new FightTagSession(2, { activeIndex, interactive, members, cursorRow },
        RESOURCES, { playSound: (id) => sounds.push(id >>> 0) });
    let tick = 0;
    // One button per three ticks: the pad's pressed word is an edge, so the button
    // has to be released before the next press can be seen, and the screen that
    // answered is retired by the tick after the one that read the pad.
    const step = (button) => {
        session.tick([], tick++);
        session.tick(button ? [button] : [], tick++);
        session.tick([], tick++);
    };
    /** Ticks with nothing held until `ready` reads true, or gives up. */
    const settle = (ready, tries = 12) => {
        for (let i = 0; i < tries && !ready(); i++) step(null);
    };
    return { session, sounds, press: step, settle };
}

test("the tag config block and the profile table are the sizes the screen expects", () => {
    assert.equal(RESOURCES.tables.length, FIGHT_TAG_TABLES_SIZE);
    assert.equal(RESOURCES.profiles.length, PROFILE_ROWS * 0x58);
});

test("with a partner in reserve the screen opens its partner list, not the pane", () => {
    const { session, settle } = openTag({ members: [member(1, 60), member(3, 200), null] });
    settle(() => session.ready());
    assert.equal(session.ready(), true, "the list is live after its first tick");
    assert.equal(session.messageOpen(), false);
    assert.deepEqual(session.candidates(), [1], "the only other member is a row");
    assert.equal(session.rows(), 1);
});

test("Back on the partner list answers -2 with the original's cancel blip", () => {
    const { session, sounds, press, settle } = openTag({ members: [member(1, 60), member(3, 200), null] });
    settle(() => session.ready());
    assert.equal(session.selection(), 0, "the cursor opens on the row the caller remembered");
    press("cross");
    assert.equal(session.finished(), true, "the screen closed");
    assert.equal(session.chosen(), TAG_RESULT_CANCEL);
    assert.ok(sounds.includes(TAG_CANCEL_SOUND),
        `cancel blip 0x${TAG_CANCEL_SOUND.toString(16)} in ${sounds.map((s) => `0x${s.toString(16)}`)}`);
});

test("a cancel writes no row, so the list still opens on the row the caller remembered", () => {
    const { session, press, settle } = openTag({
        members: [member(1, 60), member(3, 200), member(8, 200)], cursorRow: 1,
    });
    settle(() => session.ready());
    assert.equal(session.rows(), 2, "both partners are rows");
    assert.equal(session.selection(), 1, "the list opened on row 1");
    press("cross");
    assert.equal(session.chosen(), TAG_RESULT_CANCEL);
    assert.equal(session.chosenRow(), 1, "the cancel leaves the row cell alone (fightstg.s:21434-21446)");
});

test("a forced tag has no cancel at all", () => {
    const { session, sounds, press, settle } = openTag({
        interactive: 0, members: [member(1, 60), member(3, 200), null],
    });
    settle(() => session.ready());
    press("cross");
    assert.equal(session.finished(), false, "the list is still up");
    assert.equal(session.chosen(), null);
    assert.equal(sounds.length, 0, `no blip, got ${sounds.map((s) => `0x${s.toString(16)}`)}`);
});

test("with nobody in reserve the screen opens the pane and reads no Back", () => {
    const { session, sounds, press, settle } = openTag({ members: [member(1, 60), null, null] });
    settle(() => session.messageOpen());
    assert.equal(session.messageOpen(), true, "state 2, the pane");
    assert.equal(session.rows(), 0);
    assert.equal(session.ready(), false, "the partner list is never built");
    press("cross");
    assert.equal(session.finished(), false, "Back changed nothing on this screen");
    assert.equal(session.chosen(), null);
    assert.equal(sounds.length, 0, "Back played nothing");
    press("cross");
    assert.equal(session.finished(), false, "and it stays that way");
});

test("Circle closes the pane with -2 and the confirm blip", () => {
    const { session, sounds, press, settle } = openTag({ members: [member(1, 60), null, null] });
    settle(() => session.messageOpen());
    assert.equal(session.messageOpen(), true);
    press("circle");
    assert.equal(session.finished(), true);
    assert.equal(session.chosen(), TAG_RESULT_CANCEL);
    assert.ok(sounds.includes(TAG_CONFIRM_SOUND),
        `confirm blip 0x${TAG_CONFIRM_SOUND.toString(16)} in ${sounds.map((s) => `0x${s.toString(16)}`)}`);
});