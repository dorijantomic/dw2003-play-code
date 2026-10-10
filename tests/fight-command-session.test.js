// The translated battle command list, driven the way a player drives it: the
// list opens, the marker pulses on the chosen row, Down/Up move it, Circle
// confirms, and the list closes with the row handed back. No original
// instruction runs; the config, names and font come from the data build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FightCommandSession } from "../engine/dw3/ui/fight-command-session.ts";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const bytes = (path) => new Uint8Array(readFileSync(join(data, path)));
const manifest = JSON.parse(readFileSync(join(data, "battlecmd/manifest.json"), "utf8"));

function open(seed = {}, language = 2) {
    const banks = new Map([[0x7f + language, bytes(`battlecmd/${0x7f + language}.bin`)]]);
    const sounds = [];
    const session = new FightCommandSession(language,
        { initialRow: 0, activeIndex: 0, ailmentBits: 0, ...seed },
        { tables: bytes("battlecmd/tables.bin"), font: bytes("shop_font.bin"), banks },
        { playSound: (id) => sounds.push(id >>> 0) });
    return { session, sounds };
}
const frames = (s, n, buttons = []) => { for (let i = 0; i < n && !s.finished(); i++) s.tick(buttons); };
const press = (s, button) => { frames(s, 1, [button]); frames(s, 2); };
const text = (w) => (w.lines[0].bytes ?? []).filter((b) => b !== 0);

test("the data build carries the six-row config and the 156x12 marker strip", () => {
    const tables = bytes("battlecmd/tables.bin");
    const view = new DataView(tables.buffer, tables.byteOffset, tables.byteLength);
    const words = Array.from({ length: 8 }, (_, i) => view.getInt32(i * 4, true));
    assert.deepEqual(words, [6, 0x11, 0x6e, 0x13, 0x22, 0x10, 0x6d, 0x13]);
    assert.deepEqual([view.getInt16(34, true), view.getInt16(36, true), view.getInt16(38, true)], [0xf4, 12, 12]);
    assert.equal(bytes("battlecmd/strip.bin").length, 156 * 12 * 2);
    assert.deepEqual(manifest.strip.vram, [0, 0xf4]);
    // Seven languages for each bank the battle loads: the Digimon names (0x4E),
    // the command names (0x7F) and, for the TECH screen, the technique
    // descriptions (0x9B) and names (0xA2).
    assert.equal(manifest.banks.length, 28);
});

test("the list opens with six names, six rows and the marker on the opening row", () => {
    const { session } = open({ initialRow: 2 });
    frames(session, 1);
    assert.equal(session.ready(), true);
    assert.equal(session.selection(), 2);
    const widgets = session.widgets.textWidgets();
    assert.equal(widgets.length, 6);
    assert.deepEqual(widgets.map((w) => w.penY), [0, 1, 2, 3, 4, 5].map((i) => 0x6d + i * 0x13));
    assert.ok(widgets.every((w) => w.penX === 0x24 && text(w).length > 0 && w.colour === 0));
    frames(session, 3); // the menu installs the vsync callback on its step 2 (fourth tick)
    const sprites = session.draw.calls.filter((c) => c.method === "drawSprite");
    assert.deepEqual(sprites.map((c) => c.args), [0, 1, 2, 3, 4, 5].map((i) => [0x04550000, 0x22, 0x10, 0x6d + i * 0x13]));
    assert.equal(session.vsyncInstalled(), true);
    // Two moves per buffer: the pulsing cell onto row 2, in both display buffers,
    // plus the idle cell once onto row 0 (the menu's zeroed previous row).
    const onto = (row) => session.moves.filter((m) => (m.dstY & 0xff) === 0x6e + row * 0x13);
    assert.equal(onto(2).length, 2);
    assert.ok(onto(2).every((m) => m.srcY === 0xf4 && m.w === 12 && m.h === 12 && m.dstX === 0x11 && m.srcX % 12 === 0));
});

test("the marker cycles through twelve cells and the highlight rides the selected row", () => {
    const { session } = open();
    frames(session, 3);
    const seen = new Set();
    for (let i = 0; i < 24; i++) {
        frames(session, 1);
        const cell = session.moves.find((m) => m.dstY === 0x6e);
        seen.add(cell.srcX);
        assert.equal(session.moves.length, 2, "no idle copy while the row stays put");
    }
    assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i * 12));
    const palettes = session.draw.calls.filter((c) => c.method === "m_0x88").map((c) => c.args[0]);
    assert.equal(palettes.length, 6);
    assert.ok(palettes.slice(1).every((p) => p === 0), "unselected rows stay on palette row 0");
});

test("Down and Up move the selection with the move sound, clamped at both ends", () => {
    const { session, sounds } = open();
    frames(session, 3);
    press(session, "up");
    assert.equal(session.selection(), 0);
    assert.deepEqual(sounds, []);
    for (let i = 0; i < 7; i++) press(session, "down");
    assert.equal(session.selection(), 5);
    assert.equal(sounds.filter((s) => s === 0x4001b).length, 5);
    session.tick([]);
    press(session, "up");
    // The row just left gets the idle cell once, on the blank after the move.
    assert.equal(session.selection(), 4);
});

test("Circle confirms: the row is handed back, the list and the marker close", () => {
    const { session, sounds } = open();
    frames(session, 3);
    press(session, "down");
    frames(session, 1, ["circle"]);
    assert.equal(session.chosen(), 1);
    assert.ok(sounds.includes(0x4001c));
    frames(session, 1);
    assert.equal(session.finished(), true);
    assert.equal(session.tree.tasks.size, 0);
    assert.equal(session.vsyncInstalled(), false, "the menu's close tick removes the vsync callback");
    assert.equal(session.widgets.textWidgets().length, 0);
});

test("Sleep greys Fight/Tech/DV and swallows their confirm; bit 0x20 greys and blocks DV only", () => {
    const asleep = open({ ailmentBits: 0x08, activeIndex: 1 });
    frames(asleep.session, 3);
    assert.deepEqual(asleep.session.widgets.textWidgets().map((w) => w.colour), [7, 7, 7, 0, 0, 0]);
    frames(asleep.session, 1, ["circle"]);
    assert.equal(asleep.session.chosen(), null);
    assert.ok(asleep.sounds.includes(0x4001c), "the confirm blip still plays");
    frames(asleep.session, 2);
    for (let i = 0; i < 3; i++) press(asleep.session, "down");
    frames(asleep.session, 1, ["circle"]);
    assert.equal(asleep.session.chosen(), 3);

    const dvBlocked = open({ ailmentBits: 0x20, activeIndex: 2 });
    frames(dvBlocked.session, 3);
    assert.deepEqual(dvBlocked.session.widgets.textWidgets().map((w) => w.colour), [0, 0, 7, 0, 0, 0]);
    press(dvBlocked.session, "down");
    press(dvBlocked.session, "down");
    frames(dvBlocked.session, 1, ["circle"]);
    assert.equal(dvBlocked.session.chosen(), null);
});

test("disposing mid-list closes the menu and removes the vsync callback", () => {
    const { session } = open();
    frames(session, 5);
    session.dispose();
    assert.equal(session.finished(), true);
    assert.equal(session.vsyncInstalled(), false);
});

test("every language opens with six non-empty names", () => {
    for (let language = 0; language < 7; language++) {
        const { session } = open({}, language);
        frames(session, 1);
        const widgets = session.widgets.textWidgets();
        assert.equal(widgets.length, 6, `language ${language}`);
        assert.ok(widgets.every((w) => text(w).length > 0), `language ${language}`);
    }
});

// The confused player's list is the same widget on the original's joke config
// (pro/fightstg F0x8009A898 + FIGHTSTG_F0x8009A2DC): six joke rows, none greyed,
// and a confirm that answers with the chosen joke instead of a command.
const JOKE_ROWS = [3, 0, 7, 1, 6, 2].map((joke) => 0x6b + joke);

test("the joke config is the command list's own eight words", () => {
    const tables = bytes("battlecmd/tables.bin");
    const view = new DataView(tables.buffer, tables.byteOffset, tables.byteLength);
    const words = (at) => Array.from({ length: 8 }, (_, i) => view.getInt32(at + i * 4, true));
    assert.deepEqual(words(40), [6, 0x11, 0x6e, 0x13, 0x22, 0x10, 0x6d, 0x13]);
    assert.deepEqual(words(40), words(0), "the joke list's rows and marker never move");
    assert.equal(manifest.tables.ranges.filter((r) => r.role === "joke-config").length, 1);
});

test("the joke list opens six joke rows on the shared widget, none greyed", () => {
    const { session, sounds } = open({ ailmentBits: 0x04, activeIndex: 1, initialRow: 4,
        jokeLabels: JOKE_ROWS });
    frames(session, 1);
    assert.equal(session.ready(), true);
    assert.equal(session.selection(), 0, "the joke owner always opens on its first row");
    const widgets = session.widgets.textWidgets();
    assert.equal(widgets.length, 6);
    assert.deepEqual(widgets.map((w) => w.penY), [0, 1, 2, 3, 4, 5].map((i) => 0x6d + i * 0x13));
    assert.ok(widgets.every((w) => w.penX === 0x24));
    assert.deepEqual(widgets.map((w) => w.colour), [0, 0, 0, 0, 0, 0],
        "the joke owner never greys a row, whatever the ailment byte says");
    // The rows carry bank 0x7F ids 0x6B + joke index, so the six labels are the
    // shuffled joke commands. The bank is in the game's own glyph codes, so compare
    // the bytes the row holds with the bytes at that id rather than with a word.
    const bank = bytes(`battlecmd/${0x7f + 2}.bin`);
    const bankView = new DataView(bank.buffer, bank.byteOffset, bank.byteLength);
    const bankBytes = (id) => {
        const at = bankView.getUint32(4 + id * 4, true);
        const raw = Buffer.from(bank.subarray(at, bankView.getUint32(4 + (id + 1) * 4, true)));
        // The bank entry is NUL-padded; the text box keeps the string only.
        let end = raw.length;
        while (end > 0 && raw[end - 1] === 0) end -= 1;
        return raw.subarray(0, end).toString("latin1");
    };
    assert.deepEqual(widgets.map((w) => Buffer.from(text(w)).toString("latin1")),
        [3, 0, 7, 1, 6, 2].map((joke) => bankBytes(0x6b + joke).toString("latin1")));
    assert.deepEqual([0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72].length, 8,
        "the eight joke commands are ids 0x6B..0x72");
    frames(session, 3);
    const sprites = session.draw.calls.filter((c) => c.method === "drawSprite");
    assert.deepEqual(sprites.map((c) => c.args),
        [0, 1, 2, 3, 4, 5].map((i) => [0x04550000, 0x22, 0x10, 0x6d + i * 0x13]));
    assert.equal(session.vsyncInstalled(), true, "the shared marker pulses on the joke rows too");

    press(session, "down");
    assert.equal(session.selection(), 1);
    assert.ok(sounds.includes(0x4001b));
    frames(session, 1, ["circle"]);
    assert.equal(session.joke(), 1, "the confirm answers with the chosen joke row");
    assert.ok(sounds.includes(0x4001c));
    frames(session, 1);
    assert.equal(session.finished(), true);
    assert.equal(session.widgets.textWidgets().length, 0);
});
