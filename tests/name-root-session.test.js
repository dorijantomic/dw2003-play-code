// The translated naming screen, driven the way a player drives it: pick the
// second partner, type a letter, confirm, then leave the list. No original
// instruction runs; the data tail, font and text banks come from the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NameRootSession } from "../engine/dw3/ui/name-root-session.ts";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const bytes = (path) => new Uint8Array(readFileSync(join(data, path)));

function resources(language) {
    const banks = new Map();
    for (const offset of [0x40, 0x86]) banks.set(offset + language, bytes(`name/${offset + language}.bin`));
    return { tables: bytes("name/tables.bin"), font: bytes("shop_font.bin"), banks };
}
// The game's own letter codes: 0x0E is A, 0x0F is B, 0x10 is C.
const name = (text) => new Uint8Array([...text].map((c) => 0x0e + c.charCodeAt(0) - 65));
const decode = (raw) => [...raw].map((b) => String.fromCharCode(65 + b - 0x0e)).join("");

function open(language = 2) {
    const sounds = [];
    const session = new NameRootSession(language,
        [{ rosterSlot: 0, nameBytes: name("ABC") }, { rosterSlot: 1, nameBytes: name("XYZ") }],
        resources(language), { playSound: (id) => sounds.push(id) });
    return { session, sounds };
}

function frames(session, count, buttons = []) {
    for (let i = 0; i < count && !session.finished(); i++) session.tick(buttons);
}
function press(session, button, wait = 20) {
    frames(session, 1, [button]);
    frames(session, wait);
}

test("the chooser appears, points at the first partner, and moves down", () => {
    const { session } = open();
    frames(session, 240);
    assert.equal(session.finished(), false);
    assert.equal(session.selectedPosition(), 0);
    press(session, "down");
    assert.equal(session.selectedPosition(), 1);
    press(session, "up");
    assert.equal(session.selectedPosition(), 0);
});

test("naming the second partner commits only that partner's name", () => {
    const { session } = open();
    frames(session, 240);
    press(session, "down");
    press(session, "circle", 240);              // choose; the keyboard opens
    press(session, "circle");                   // type the letter under the cursor
    press(session, "start");                    // jump to OK
    press(session, "circle", 240);              // confirm
    assert.equal(session.commits.length, 1);
    assert.equal(session.commits[0].position, 1);
    const [first, second] = session.names().map(decode);
    assert.equal(first, "ABC");
    assert.match(second, /^A?YZ$|^.YZ$/, `second partner is now ${second}`);
    assert.notEqual(second, "XYZ");
});

test("cancelling the chooser leaves every name alone and closes", () => {
    const { session } = open();
    frames(session, 240);
    press(session, "cross", 10);
    frames(session, 240);
    assert.equal(session.finished(), true);
    assert.equal(session.commits.length, 0);
    assert.deepEqual(session.names().map(decode), ["ABC", "XYZ"]);
});

const cursor = (session) => {
    for (const task of session.tree.tasks.values()) {
        if (task.classId !== 0x80085078) continue;
        const o = task.address;
        return {
            col: session.mem.read32(o + 0x9c), row: session.mem.read32(o + 0xa0),
            insert: session.mem.read32(o + 0x90), page: session.mem.read32(o + 0xb0),
            sub: session.mem.read32(o + 0x10),
            slots: Array.from({ length: 8 }, (_, i) => session.mem.read16(o + 0x78 + i * 2)),
        };
    }
    return null;
};
const toKeyboard = (session, down = 1) => {
    frames(session, 240);
    for (let i = 0; i < down; i++) press(session, "down");
    press(session, "circle", 240);
};

test("DEL clears a letter, SPC blanks one, and the arrows move the insert point", () => {
    const { session } = open();
    toKeyboard(session, 0);
    assert.equal(cursor(session).insert, 0);
    press(session, "cross");                                  // the back button deletes
    // Cursor on the first slot: it is blanked, insert point stays.
    assert.equal(cursor(session).slots[0], 0x4081);
    // The right-arrow key sits just left of OK; the left-arrow key left of that.
    press(session, "start");
    press(session, "left");
    press(session, "circle");
    assert.equal(cursor(session).insert, 1, "the right arrow moved the insert point");
    press(session, "left");
    press(session, "circle");
    assert.equal(cursor(session).insert, 0, "the left arrow moved it back");
    // SPC is the wide key above the arrows: it blanks the slot and steps on.
    press(session, "up");
    press(session, "circle");
    assert.equal(cursor(session).slots[0], 0x4081, "SPC left a blank");
    assert.equal(cursor(session).insert, 1, "SPC stepped to the next slot");
});

test("confirming an empty name is refused, then typing works again", () => {
    const sounds = [];
    const session = new NameRootSession(2, [{ rosterSlot: 0, nameBytes: new Uint8Array(0) }],
        resources(2), { playSound: (id) => sounds.push(id) });
    frames(session, 240);
    press(session, "circle", 240);
    press(session, "start");
    press(session, "circle", 60);
    assert.equal(session.commits.length, 0);
    assert.ok([0x14, 0x15, 0x16].includes(cursor(session).sub), `refusal state ${cursor(session).sub}`);
    press(session, "circle", 60);                             // dismiss the message
    assert.equal(cursor(session).sub, 2, "back to typing");
    assert.equal(session.commits.length, 0);
});

test("the Japanese layout has five slots and three character pages", () => {
    const { session } = open(0);
    toKeyboard(session, 0);
    const k = cursor(session);
    assert.equal(k.page, 0);
    press(session, "r1");
    assert.equal(cursor(session).page, 1);
    press(session, "r1");
    assert.equal(cursor(session).page, 2);
    press(session, "r1");
    assert.equal(cursor(session).page, 0, "the pages wrap");
    press(session, "l1");
    assert.equal(cursor(session).page, 2);
    for (let i = 0; i < 5; i++) press(session, "circle");
    assert.equal(cursor(session).insert, 4, "the insert point stops at the fifth slot");
});

test("Back is dropped until the chooser reads the pad, then one Back leaves the screen", () => {
    const { session } = open();
    frames(session, 240);
    press(session, "down");
    press(session, "circle", 240);              // choose; the keyboard opens
    press(session, "circle");                   // type the letter under the cursor
    press(session, "start");                    // jump to OK
    press(session, "circle");                   // confirm: the chooser comes back
    assert.equal(session.commits.length, 1);

    // F0x80085DE4 reads the pad in exactly one sub-state: F0x8008601C, slot 4
    // of the seven-word jump table at 0x80082F58, the only branch that calls
    // F0x80085B70. Slots 0..3 walk the rows forward a step per ready widget, so
    // a button pressed while the chooser is still building its rows is dropped
    // by the screen itself. That is what a player sees, so the walk must match.
    assert.equal(session.finished(), false, "the chooser is up again");
    assert.equal(session.chooserReadingPad(), false,
        `the chooser came back on sub ${session.chooserSubState()}, not the input sub-state`);
    press(session, "cross", 20);
    assert.equal(session.finished(), false,
        `Back during setup was dropped, as the original does (sub ${session.chooserSubState()})`);

    let waited = 0;
    while (!session.chooserReadingPad() && waited < 3000 && !session.finished()) {
        frames(session, 1);
        waited += 1;
    }
    assert.equal(session.chooserReadingPad(), true,
        `the chooser never reached the input sub-state (stopped on ${session.chooserSubState()})`);

    // One Cross there plays 0x800450BD, writes -1 into the root's +0x60 and
    // calls its +0x68; F0x80086184 case 1 (0x800861F4) sees +0x60 == -1 and goes
    // straight to its own sub-state 5, the exit path.
    frames(session, 1, ["cross"]);
    let closed = 0;
    while (!session.finished() && closed < 3000) {
        frames(session, 1);
        closed += 1;
    }
    assert.equal(session.finished(), true, `one Back should close the screen (waited ${closed} frames)`);
    assert.equal(session.commits.length, 1, "the committed name survived the exit");
    assert.deepEqual(session.names().map(decode), ["ABC", "AYZ"]);
});
