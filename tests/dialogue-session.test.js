// Frame-owner test for the field conversation box: the controller, plain window + band, and the
// four balloon quadrants run headless as one task tree. The ports are proved against the original in
// tests/lane-b/dialogue-*.test.js; this file checks the composition (open, reveal, page turn, close).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DialogueSession, dialogueRangesFromResident } from "../engine/dw3/ui/dialogue-session.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resident = new Uint8Array(readFileSync(join(root, "web/assets/native/screens/resident.bin")));
const font = new Uint8Array(readFileSync(join(root, "web/assets/data/shop_font.bin")));
const resources = () => ({ font, ranges: dialogueRangesFromResident(resident) });

// Token codec (native, convert flag 0): A-Z = 0x0E+n, a-z = 0x28+n, space = 01 01, 02 07 = name tab,
// 02 02 00 = wait for the confirm button (page turn), 00 ends the line.
const tok = (text) => [...text].flatMap((c) => (c === " " ? [1, 1] : c >= "a" ? [0x28 + c.charCodeAt(0) - 97] : [0x0e + c.charCodeAt(0) - 65]));
const NAME = [2, 7, ...tok("Mia"), 2, 7];
const WAIT = [2, 2, 0];
function pack(lines) {
    const head = 4 + 4 * lines.length;
    const out = new Uint8Array(head + lines.reduce((n, l) => n + l.length + 1, 0));
    const view = new DataView(out.buffer);
    view.setUint32(0, lines.length, true);
    let at = head;
    lines.forEach((l, i) => { view.setUint32(4 + 4 * i, at, true); out.set(l, at); at += l.length + 1; });
    return out;
}
const PACK = pack([[...NAME, ...tok("Hello"), ...WAIT, ...tok("Bye"), ...WAIT], [...tok("Hi there"), ...WAIT]]);

// The cutscene SAY banks as they ship: one ESDMG entry is a [count][offsets] pack of lines.
function esdmgEntry(file, entry) {
    const data = readFileSync(resolve(root, `web/assets/data/dialogue-box/${file}.bin`));
    const entries = data.readUInt32LE(0) / 4;
    const start = data.readUInt32LE(entry * 4);
    const end = entry + 1 < entries ? data.readUInt32LE((entry + 1) * 4) : data.length;
    return new Uint8Array(data.subarray(start, end));
}
const PRESS = { pressed: 1 << 13, held: 1 << 13 };
const IDLE = { pressed: 0, held: 0 };

function run(s, until, limit = 1200) {
    const seen = { sounds: [], clips: new Set(), raw: new Set(), kinds: new Set(), frames: 0, waits: 0, wipeFrames: 0 };
    for (let i = 0; i < limit; i++) {
        // The player presses confirm only while the text waits at a page break (state 2, sub-mode 1).
        const waiting = s.textWidgets().some((w) => s.mem.read32(w.addr + 0xc) === 2 && s.mem.read32(w.addr + 0x10) === 1);
        if (waiting) seen.waits++;
        s.tick(waiting && seen.waits % 8 === 4 ? PRESS : IDLE);
        seen.frames++;
        seen.sounds.push(...s.takeSounds());
        const intents = s.drawIntents();
        if (seen.sounds.includes(0x4001a)) seen.wipeFrames += intents.calls.filter((c) => c.method === "drawSprite" && c.args[1] === 8).length;
        for (const c of intents.calls) if (c.method === "drawSprite") seen.clips.add(c.args[1]);
        for (const r of intents.raw) seen.raw.add(r.kind);
        const st = s.state();
        if (st?.child) seen.kinds.add(st.child);
        if (until(s, seen)) return seen;
    }
    throw new Error(`dialogue did not reach the goal in ${limit} frames (${JSON.stringify(s.state())})`);
}

test("plain window: open, reveal, page turn, close", () => {
    let closes = 0;
    const s = new DialogueSession(resources(), () => { closes++; });
    s.openSay(PACK, 0, null, 0, true);
    assert.equal(s.isOpen(), true);
    const seen = run(s, (x) => !x.isOpen());
    assert.equal(closes, 1);
    assert.ok(seen.kinds.has("dialogue plain window"));
    assert.ok(seen.sounds.includes(0x40019), "band open sound");
    assert.ok(seen.sounds.includes(0x4001a), "close sound");
    assert.ok(seen.clips.has(8) && seen.clips.has(9), "band strips");
    assert.ok(seen.clips.has(10), "advance blink marker");
    assert.ok(seen.wipeFrames >= 4, "band wipe-out keeps drawing after the close sound");
    assert.ok(seen.waits >= 2, "the text waited at the page breaks");
    s.tick(IDLE);
    assert.equal(closes, 1, "onClose fires once");
    assert.equal(s.tree.tasks.size, 0, "every task retired");
});

test("plain window: text widget is exposed while open and the line is the pack's", () => {
    const s = new DialogueSession(resources());
    s.openSay(PACK, 1, null, 0, true);
    for (let i = 0; i < 6; i++) s.tick(IDLE);
    const widgets = s.textWidgets();
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0].lines[0].bytes.slice(0, 2).join(), [0x0e + 7, 0x28 + 8].join());
    assert.equal(widgets[0].penX, 0x12);
    assert.equal(widgets[0].penY, 0xb0);
});

for (const mode of [0, 1, 2, 3]) {
    test(`balloon mode ${mode} opens and closes`, () => {
        let closes = 0;
        const s = new DialogueSession(resources(), () => { closes++; });
        s.openSay(PACK, 0, { x: 100, y: 120, actorId: 1 }, mode, false);
        const seen = run(s, (x) => !x.isOpen());
        assert.equal(closes, 1);
        assert.ok(seen.kinds.has("dialogue balloon"));
        assert.ok(seen.sounds.includes(0x40019) && seen.sounds.includes(0x4001a));
        assert.ok(seen.clips.has(7), "marker");
        assert.ok(seen.clips.has(0) && seen.clips.has(2), "frame pieces 0 and 2");
        assert.ok([3, 4, 5, 6].some((c) => seen.clips.has(c)), "frame corner piece 3..6");
        assert.ok(seen.raw.has("frameFill") && seen.raw.has("tailLine"));
        assert.equal(s.tree.tasks.size, 0);
    });
}

test("talk: the NPC facing and screen position pick the quadrant", () => {
    const quadrant = (x, y, facing) => {
        const s = new DialogueSession(resources());
        s.openTalk(PACK, 0, { x, y, facing, actorId: 5 }, (px, py) => ({ sx: px, sy: py }));
        s.tick(IDLE);
        const task = [...s.tree.tasks.keys()][0];
        return s.mem.read32(task + 0x58);
    };
    assert.equal(quadrant(200, 140, 0), 0);
    assert.equal(quadrant(100, 140, 0), 2);
    assert.equal(quadrant(200, 140, 4), 1);
    assert.equal(quadrant(100, 140, 4), 3);
    assert.equal(quadrant(200, 100, 0), 1, "near the top flips below");
    assert.equal(quadrant(100, 180, 4), 2, "near the bottom flips above");
});

test("talk with a name-tab line draws the tab and body widgets and follows the NPC", () => {
    const s = new DialogueSession(resources());
    let sy = 130;
    s.openTalk(PACK, 0, { x: 200, y: 140, facing: 0, actorId: 5 }, (x) => ({ sx: x, sy }));
    for (let i = 0; i < 40; i++) s.tick(IDLE);
    assert.equal(s.textWidgets().length, 2, "name tab + body");
    const before = s.drawIntents().raw.find((r) => r.kind === "frameFill").intent.corners[1];
    sy = 150;
    s.tick(IDLE);
    const after = s.drawIntents().raw.find((r) => r.kind === "frameFill").intent.corners[1];
    assert.equal(after - before, 20, "re-anchored every frame");
    s.dispose();
    assert.equal(s.isOpen(), false);
});

test("the opening's own line (the player speaking) opens as a balloon and closes", () => {
    // s200's PRE event, esdmg200 entry 11 line 2 — the second of the scene's three SAY lines,
    // spoken by actor 1, which in that stage is the player (docs/research/scripting/
    // wstag-script-decode.md:136). The raw line opens with `02 07 02 09 02 07`: the balloon
    // build (F0x8001CE44) reads that as "the speaker's name is the game string at 0x80048d88"
    // and starts the body at the second `02 07`. Only a balloon can draw this line, so a host
    // that answered "no speaker" and used the unanchored bottom window left the player
    // stuck on a box that never closed.
    const pack = esdmgEntry("esdmg200", 11);
    let closes = 0;
    const s = new DialogueSession(resources(), () => { closes++; });
    s.openSay(pack, 2, { x: 1000, y: 236, actorId: 1 }, 0, false);
    s.tick(IDLE);
    assert.deepEqual(s.textWidgets().length, 2, "a name tab and a body");
    const [tab, body] = s.textWidgets();
    const read = (rec, n) => [...Array(n)].map((_, i) => s.mem.read8(rec.ptr + i));
    const playerName = [...Array(8)].map((_, i) => s.mem.read8(0x80048d88 + i));
    assert.deepEqual(read(tab.lines[0], 8), playerName, "the tab carries the player name");
    assert.equal(read(body.lines[0], 1)[0], 2, "the body starts at its own 02 07 marker");
    const seen = run(s, (x) => !x.isOpen());
    assert.equal(closes, 1);
    assert.ok(seen.kinds.has("dialogue balloon"));
    assert.ok(seen.waits >= 1, "the line waited at its page break");
    assert.equal(s.tree.tasks.size, 0);
});

test("plain window: a real page-break line closes when the player presses the button", () => {
    // A mode-4 SAY line exactly as the disc ships it — s210 event 58, bank esdmg200 entry 18
    // line 4 (SAY 0 4 2 4) — 268 bytes with three `02 02 02 02 03` page breaks. 50 of the 70 mode-4
    // lines in the 384 shipped wstag events have an interior page break, so this is the path a
    // player meets whenever a long unanchored message ends: the text widget parks in its own
    // state 2 / sub-mode 1 (the decoded page turn F0x8001AC14 waits for the logical button
    // D0x8004DCCC[2] = 0xD, bit 13), and only a press finishes the line and closes the window.
    const pack = esdmgEntry("esdmg200", 18);
    const atWait = (s) => s.textWidgets().some(
        (w) => s.mem.read32(w.addr + 0xc) === 2 && s.mem.read32(w.addr + 0x10) === 1);

    let closes = 0;
    const idle = new DialogueSession(resources(), () => { closes++; });
    idle.openSay(pack, 4, null, 0, true);
    let waits = 0;
    for (let i = 0; i < 600 && idle.isOpen(); i++) {
        idle.tick(IDLE);
        if (atWait(idle)) waits++;
    }
    assert.equal(waits > 0, true, "the line parked at a page break");
    assert.equal(idle.isOpen(), true, "and an untouched box never closes itself");
    assert.equal(closes, 0);
    idle.dispose();

    closes = 0;
    const s = new DialogueSession(resources(), () => { closes++; });
    s.openSay(pack, 4, null, 0, true);
    // The player pressing Circle every frame the box waits at a page break, as the browser's
    // adapter feeds it. The line types at 7 frames a character (setTextScroll(6)), so a
    // 265-character line needs a few thousand display frames.
    let frames = 0;
    let presses = 0;
    let breaks = 0;
    let wasWaiting = false;
    const sounds = [];
    while (s.isOpen() && frames < 8000) {
        const waiting = atWait(s);
        if (waiting && !wasWaiting) breaks++;
        wasWaiting = waiting;
        if (waiting) presses++;
        s.tick(waiting ? PRESS : IDLE);
        sounds.push(...s.takeSounds());
        frames++;
    }
    assert.equal(closes, 1, "the press closed the window");
    assert.equal(s.isOpen(), false);
    assert.equal(breaks, 4, "three page breaks and the closing 02 02 02 each stop for a press");
    assert.ok(presses >= 3, "and every one of them was answered with a press");
    assert.ok(sounds.includes(0x4001a), "the close sound plays");
    assert.ok(sounds.includes(0x40019), "the band opens first");
    s.tick(IDLE);
    assert.equal(closes, 1, "onClose fires once");
    assert.equal(s.tree.tasks.size, 0, "every task retired");
});
