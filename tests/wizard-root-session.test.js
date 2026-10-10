// The translated registration wizard, driven the way a player drives it: wait out
// the clerk's introduction, accept the account name, pick a starter pack, answer
// YES and watch the registration finish. No original instruction runs; the data
// tail, font, glyph and text banks come from the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WizardRootSession } from "../engine/dw3/ui/wizard-root-session.ts";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const bytes = (path) => new Uint8Array(readFileSync(join(data, path)));
const manifest = JSON.parse(readFileSync(join(data, "wizard/manifest.json"), "utf8"));
const KEYBOARD = 0x80085a70, PACK_LIST = 0x80087a30, CONFIRM = 0x80086eb8;

function resources(language) {
    const banks = new Map();
    for (const offset of [0x8d, 0x4e, 0x86]) banks.set(offset + language, bytes(`wizard/${offset + language}.bin`));
    return {
        tables: bytes("wizard/tables.bin"), font: bytes("shop_font.bin"), banks,
        members: manifest.starterMembers.bytes, cursorGlyphs: manifest.cursorGlyphs, textButtons: manifest.textButtons,
    };
}
const name = (text) => new Uint8Array([...text].map((c) => 0x0e + c.charCodeAt(0) - 65));
const decode = (raw) => [...raw].map((b) => String.fromCharCode(65 + b - 0x0e)).join("");

function open(language = 2, account = "JUN") {
    const sounds = [];
    const session = new WizardRootSession(language, name(account), resources(language),
        { playSound: (id) => sounds.push(id) });
    return { session, sounds };
}
const task = (session, cls) => [...session.tree.tasks.values()].find((t) => t.classId === cls);
const field = (session, cls, off) => {
    const t = task(session, cls);
    return t ? session.mem.read32(t.address + off) | 0 : null;
};
function until(session, pred, limit = 4000) {
    for (let i = 0; i < limit && !session.finished(); i++) {
        if (pred()) return i;
        session.tick([]);
    }
    assert.ok(pred(), "condition was not reached");
    return limit;
}
function press(session, button, wait = 12) {
    session.tick([button]);
    for (let i = 0; i < wait; i++) session.tick([]);
}
const CHROME = 0x80083774;
// The clerk's introduction waits for a button at each page; press through it.
function passIntro(session) {
    let seen = false;
    for (let i = 0; i < 8000; i++) {
        session.tick(i % 9 === 0 ? ["circle"] : []);
        const here = task(session, CHROME) !== undefined;
        if (here) seen = true;
        else if (seen) return;
    }
    assert.fail("the introduction did not finish");
}
const typing = (s) => field(s, KEYBOARD, 0x10) === 2 && field(s, KEYBOARD, 0xc) === 1;

test("the introduction plays, then the keyboard opens on the account name", () => {
    const { session } = open();
    passIntro(session);
    until(session, () => typing(session));
    assert.equal(session.registration(), null, "nothing is committed yet");
    const kb = task(session, KEYBOARD).address;
    const slots = [0, 1, 2, 3].map((i) => session.mem.read16(kb + 0x78 + i * 2));
    assert.deepEqual(slots.slice(0, 3), [0x8260 + 9, 0x8260 + 20, 0x8260 + 13].map((v) => ((v & 0xff) << 8) | (v >> 8)),
        "the keyboard shows the seeded name JUN");
});

test("registering pack B with a typed name commits pack, name and members once", () => {
    const { session } = open();
    passIntro(session);
    until(session, () => typing(session));
    press(session, "start");                       // jump to OK
    press(session, "circle");                      // accept the name
    until(session, () => field(session, PACK_LIST, 0xc) === 1);
    press(session, "down");                        // pack B
    assert.equal(field(session, PACK_LIST, 0x6c), 1);
    press(session, "circle");                      // accept the pack
    until(session, () => field(session, CONFIRM, 0xc) === 1 && field(session, CONFIRM, 0x10) === 0);
    assert.equal(field(session, CONFIRM, 0x5c), 1, "the panel shows pack B");
    press(session, "circle");                      // YES
    until(session, () => session.finished(), 6000);
    const r = session.registration();
    assert.ok(r, "the registration committed");
    assert.equal(r.pack, 1);
    assert.equal(decode(r.accountName), "JUN");
    assert.deepEqual(r.members, [2, 3, 6], "pack B is Kotemon, Kumamon and Betamon's roster slots");
});

test("answering NO at the confirm returns to the pack list and commits nothing", () => {
    const { session } = open();
    passIntro(session);
    until(session, () => typing(session));
    press(session, "start"); press(session, "circle");
    until(session, () => field(session, PACK_LIST, 0xc) === 1);
    press(session, "circle");
    until(session, () => field(session, CONFIRM, 0xc) === 1 && field(session, CONFIRM, 0x10) === 0);
    press(session, "down");                        // NO
    press(session, "circle");
    until(session, () => field(session, PACK_LIST, 0xc) === 1 && field(session, CONFIRM, 0xc) === 2);
    assert.equal(session.registration(), null);
    assert.equal(session.finished(), false);
});

test("backing out of the pack list returns to the keyboard", () => {
    const { session } = open();
    passIntro(session);
    until(session, () => typing(session));
    press(session, "start"); press(session, "circle");
    until(session, () => field(session, PACK_LIST, 0xc) === 1);
    press(session, "cross");
    until(session, () => typing(session));
    assert.equal(session.registration(), null);
});
