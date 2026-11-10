// The pause list's extra rows (web/pause-extra-rows.js) and how they are wired into the game.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOOK_LABELS, pauseExtraRows, pauseLabelOk } from "../web/pause-extra-rows.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("with both dev switches off the list has exactly today's rows: QUESTS when quests are on, nothing otherwise", () => {
    assert.deepEqual(pauseExtraRows({ quests: { label: "QUESTS 2" }, fx: {} }), [{ label: "QUESTS 2", opens: "quests" }]);
    assert.deepEqual(pauseExtraRows({ quests: null, fx: {} }), []);
    assert.deepEqual(pauseExtraRows({ quests: null, fx: { glossary: false, options: false } }), []);
    assert.deepEqual(pauseExtraRows(), []);
});

test("the book rows follow their own switch, only on a real true, after QUESTS and in the order GLOSSARY, OPTIONS", () => {
    const quests = { label: "QUESTS" };
    assert.deepEqual(pauseExtraRows({ quests, fx: { glossary: true, options: true } }).map((r) => r.label), ["QUESTS", "GLOSSARY", "OPTIONS"]);
    assert.deepEqual(pauseExtraRows({ quests, fx: { options: true } }).map((r) => r.opens), ["quests", "options"]);
    assert.deepEqual(pauseExtraRows({ quests: null, fx: { glossary: "yes" } }), [], "anything but true is off");
});

test("every label fits the pause text codec (letters, digits, spaces)", () => {
    for (const label of Object.values(BOOK_LABELS)) assert.ok(pauseLabelOk(label), label);
    assert.equal(pauseLabelOk("QUESTS 12"), true);
    assert.equal(pauseLabelOk("A/B"), false);
    assert.equal(pauseLabelOk(""), false);
    assert.deepEqual(pauseExtraRows({ quests: { label: "Q/A" }, fx: {} }), [], "a label the codec cannot draw is dropped, not drawn as boxes");
});

test("ambience.js lists both switches in Extras and in EXPERIMENTAL (off at first), and never reads them from the URL", () => {
    const src = read("../web/ambience.js");
    assert.match(src, /\["glossary", "[^"]+"\]/);
    assert.match(src, /\["options", "[^"]+"\]/);
    const experimental = src.match(/const EXPERIMENTAL = \[([^\]]*)\];/)[1];
    assert.match(experimental, /"glossary"/);
    assert.match(experimental, /"options"/);
    assert.doesNotMatch(src, /(get|has)\("(glossary|options)"\)/);
});

test("game.js hands the rows to the pause list and opens the books from the pause list's own result", () => {
    const game = read("../web/game.js");
    assert.match(game, /extraRows: \(\) => pauseExtraRows\(\{ quests: questsPauseRow\(\), fx: window\.__fx \}\),/);
    assert.match(game, /onBook: \(book, row\) => openBook\(book, row\),/);
    assert.doesNotMatch(game, /extraRow: \(\) => questsPauseRow\(\)/, "the single-row option is gone");
    const status = read("../web/status-translated.js");
    assert.match(status, /result\?\.kind === "book"/);
    assert.match(status, /opts\.onBook\?\.\(result\.book, result\.row\)/);
    assert.match(status, /extraRows/);
});
