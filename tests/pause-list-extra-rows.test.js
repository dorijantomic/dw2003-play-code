// EXTRA rows on the pause home list (not on the disc): the list takes any number of rows after its own,
// keeps the disc's list byte for byte when there are none, and the nine-row case (Folder Bag + QUESTS +
// GLOSSARY + OPTIONS) puts every label on its own widget and picks a panel clip that is tall enough.
import test from "node:test";
import assert from "node:assert/strict";
import { PauseRootSession } from "../engine/dw3/ui/pause-root-session.ts";
import { PAUSE_PANEL_EXTRA_BASE, pausePanelClip, pauseRowSlot, pauseSlotArea } from "../engine/dw3/ui/native/pause-list.ts";
import { pauseResources, pauseSeed } from "./helpers/pause-resources.js";

const THREE = [
    { label: "QUESTS 2", opens: "quests" },
    { label: "GLOSSARY", opens: "glossary" },
    { label: "OPTIONS", opens: "options" },
];
const DISC_ROWS = ["ITEMS", "SORT", "MAP", "TECHNIQUES", "STATUS", "CARD FOLDERS"];

const homeSession = (over = {}) => new PauseRootSession(2, pauseSeed("home", over), pauseResources(2), { playSound: () => {} });
/** Tick until the list is open and waiting for the player (step 3 of its open sequence). */
function settle(session) {
    for (let i = 0; i < 400 && session.mem.read32(session.root + 0x10) !== 3; i++) session.tick([]);
    assert.equal(session.mem.read32(session.root + 0x10), 3, "the list finished opening");
}
/** One press: the button for one frame, then nothing for one frame. */
function press(session, button) { session.tick([button]); session.tick([]); }
/** The text a row widget holds, decoded with the game's codes (0x04+n digit, 0x0E+n capital, 0x28+n lower case, 0x01 0x01 space). */
function widgetText(mem, widget) {
    const rec = widget + 0x5c, buf = mem.read32(rec) >>> 0, len = mem.read16(rec + 6) & 0xff;
    let out = "";
    for (let i = 0; i < len; i++) {
        const c = mem.read8(buf + i);
        if (c === 0x01) { if (mem.read8(buf + i + 1) === 0x01) { out += " "; i++; } continue; }
        if (c >= 0x04 && c <= 0x0d) out += String(c - 0x04);
        else if (c >= 0x0e && c <= 0x27) out += String.fromCharCode(0x41 + c - 0x0e);
        else if (c >= 0x28 && c <= 0x47) out += String.fromCharCode(0x61 + c - 0x28);
    }
    return out;
}
const rowLabels = (session) => {
    const mem = session.mem, slots = mem.read32(session.root + 0x24) >>> 0, count = mem.read32(session.root + 0x5c) | 0;
    return Array.from({ length: count }, (_, i) => widgetText(mem, mem.read32(slots + pauseRowSlot(i)) >>> 0));
};
const panelClips = (session) => session.draw.calls.filter((c) => c.method === "drawSprite" && c.args[0] === 0x02860000 && c.args[1] >= 0x19 && c.args[1] !== 0x1a).map((c) => c.args[1]);

test("the helper numbers: panel clip per row count, row slots, slot block size", () => {
    assert.equal(PAUSE_PANEL_EXTRA_BASE, 0x100);
    assert.deepEqual([5, 6, 7, 8, 9].map(pausePanelClip), [0x1c, 0x1b, 0x19, 0x108, 0x109]);
    assert.deepEqual([0, 1, 6, 7, 8].map(pauseRowSlot), [0x0c, 0x10, 0x24, 0xb4, 0xb8]);
    assert.deepEqual([0, 1, 2, 3].map(pauseSlotArea), [0x84, 0xb4, 0xb8, 0xbc]);
});

test("no extra rows: the list is the disc's (five rows, panel clip 0x1c)", () => {
    const session = homeSession();
    settle(session);
    assert.equal(session.mem.read32(session.root + 0x5c), 5);
    assert.deepEqual(rowLabels(session), DISC_ROWS.slice(0, 5));
    assert.ok(panelClips(session).includes(0x1c), "the five-row panel is drawn");
});

test("one extra row is today's QUESTS row: six rows without the Folder Bag, seven with it", () => {
    const quests = [THREE[0]];
    let session = homeSession({ extraRows: quests });
    settle(session);
    assert.deepEqual(rowLabels(session), [...DISC_ROWS.slice(0, 5), "QUESTS 2"]);
    assert.ok(panelClips(session).includes(0x1b));
    session = homeSession({ extraRows: quests, cardFoldersUnlocked: true });
    settle(session);
    assert.deepEqual(rowLabels(session), [...DISC_ROWS, "QUESTS 2"]);
    assert.ok(panelClips(session).includes(0x19));
});

test("Folder Bag + QUESTS + GLOSSARY + OPTIONS: nine rows, each on its own widget, the nine-row panel", () => {
    const session = homeSession({ extraRows: THREE, cardFoldersUnlocked: true });
    settle(session);
    assert.equal(session.mem.read32(session.root + 0x5c), 9);
    assert.deepEqual(rowLabels(session), [...DISC_ROWS, "QUESTS 2", "GLOSSARY", "OPTIONS"]);
    assert.ok(panelClips(session).includes(0x109), "panel clip for nine rows");
    // the party cards' own widgets were not overwritten by rows 7 and 8
    const slots = session.mem.read32(session.root + 0x24) >>> 0;
    const rowWidgets = new Set(Array.from({ length: 9 }, (_, i) => session.mem.read32(slots + pauseRowSlot(i))));
    assert.equal(rowWidgets.size, 9, "nine different widgets");
});

test("the cursor walks the nine rows without wrapping and picks the right row", () => {
    const session = homeSession({ extraRows: THREE, cardFoldersUnlocked: true });
    settle(session);
    const row = () => session.mem.read32(session.root + 0x58) | 0;
    for (let i = 0; i < 12; i++) press(session, "down");
    assert.equal(row(), 8, "stops on the last row");
    for (let i = 0; i < 12; i++) press(session, "up");
    assert.equal(row(), 0, "stops on the first row");
});

test("choosing GLOSSARY or OPTIONS ends the list with a book result; QUESTS still opens its page", () => {
    const choose = (downs) => {
        const session = homeSession({ extraRows: THREE, cardFoldersUnlocked: true });
        settle(session);
        for (let i = 0; i < downs; i++) press(session, "down");
        press(session, "circle"); // the confirm word in English (engine/systems/input-map.ts PAD_FACE_WORD_SWAP)
        for (let i = 0; i < 200 && !session.finished(); i++) session.tick([]);
        assert.ok(session.finished());
        return session.homeResult();
    };
    assert.deepEqual(choose(6), { kind: "page", page: "quests", row: 6 });
    assert.deepEqual(choose(7), { kind: "book", book: "glossary", row: 7 });
    assert.deepEqual(choose(8), { kind: "book", book: "options", row: 8 });
    assert.deepEqual(choose(5), { kind: "page", page: "cardfolders", row: 5 }, "CARD FOLDERS is untouched");
});

test("without the Folder Bag the extras sit one row higher and still resolve by position", () => {
    const session = homeSession({ extraRows: THREE });
    settle(session);
    assert.equal(session.mem.read32(session.root + 0x5c), 8);
    for (let i = 0; i < 6; i++) press(session, "down");
    press(session, "circle");
    for (let i = 0; i < 200 && !session.finished(); i++) session.tick([]);
    assert.deepEqual(session.homeResult(), { kind: "book", book: "glossary", row: 6 });
});
