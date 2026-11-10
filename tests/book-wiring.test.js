// How the books are wired into web/game.js. Source checks in this repo's style (tests/battle-speed.test.js): the real game
// cannot be imported under node.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const game = read("../web/game.js");

test("one host, created after the sound players, opened only from the pause list's book result", () => {
    assert.equal((game.match(/createBookHost\(/g) || []).length, 1);
    assert.ok(game.indexOf("const books = createBookHost(") > game.indexOf("window.__sfx = sfx;"));
    assert.match(game, /const openBook = \(book, row\) => \{\n\s*books\.open\(book, \(held\) => \{\n\s*pauseHome\(row\);\n\s*status\?\.blockUntilReleased\?\.\(held\);\n\s*\}, state\.keys\);\n\};/);
    assert.match(game, /const pauseHome = \(row = 0\) => openPauseHome\(\{ state, status, menu, row \}\);/);
});

test("while a book is open: the field is frozen, presses stay off the field, the book draws after the other overlays", () => {
    assert.match(game, /function update\(dt\) \{\n[^\n]*\n\s*books\.update\(dt, state\.keys\);\n\s*if \(books\.isOpen\(\)\) return;/);
    assert.match(game, /if \(books\.isOpen\(\)\) \{\n\s*e\.preventDefault\?\.\(\);\n\s*return;\n\s*\}/);
    assert.ok(game.indexOf("if (books.isOpen()) {") < game.indexOf("if (cutContentPress(k)) {"), "before every other overlay's press");
    assert.match(game, /replayOpen\(\) \|\| books\.isOpen\(\)/, "counts as a screen that owns the whole picture");
    assert.ok(game.indexOf("replayDraw(ctx, VIEW_W, VIEW_H);") < game.indexOf("books.draw(ctx, VIEW_W, VIEW_H, wideField.padL, wideField.padL > 0);"));
});

test("the dev hook opens a book only while its switch is exactly true", () => {
    assert.match(game, /window\.__openBook = \(name\) => !!\(window\.__fx\?\.\[name\] === true && state\.started/);
});

test("a Back still held when the book has shut is handed to the reopened pause list, which ignores it until it is let go", () => {
    // the host calls back(heldPadWords) after its release cap (web/book-host.js); the list must not read that Back as a press
    const at = game.indexOf("const openBook = ");
    const block = game.slice(at, game.indexOf("\n};", at));
    assert.ok(block.indexOf("pauseHome(row)") < block.indexOf("blockUntilReleased?.(held)"), "the list is rebuilt first, then told which buttons to ignore");
    const status = read("../web/status-translated.js");
    assert.match(status, /st\.blockUntilReleased = \(words = \[\]\) => \{ st\._blocked = new Set\(words\); \};/);
    assert.match(status, /if \(st\._blocked\?\.size\)/);
});
