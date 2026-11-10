// Cursor, window top, page and card reveal of GLOSSARY > DIGIMON (web/glossary-model.js). Pure.
import test from "node:test";
import assert from "node:assert/strict";
import { VISIBLE, createGlossaryModel } from "../web/glossary-model.js";

test("one step at a time, no wrap at either end, and a move that does nothing reports false", () => {
    const m = createGlossaryModel({ count: 240 });
    assert.equal(m.move(-1), false);
    assert.equal(m.move(1), true);
    assert.equal(m.index(), 1);
    assert.equal(m.jump(10), true);
    assert.equal(m.index(), 11);
    assert.equal(m.jump(-100), true, "jumping past the top stops at the top");
    assert.equal(m.index(), 0);
    m.jump(1000);
    assert.equal(m.index(), 239);
    assert.equal(m.move(1), false);
    assert.equal(m.jump(10), false);
});

test("the window always holds the cursor", () => {
    const m = createGlossaryModel({ count: 240 });
    for (let i = 0; i < 239; i++) { m.move(1); assert.ok(m.index() >= m.top() && m.index() < m.top() + VISIBLE, `index ${m.index()} top ${m.top()}`); }
    for (let i = 0; i < 239; i++) { m.move(-1); assert.ok(m.index() >= m.top() && m.index() < m.top() + VISIBLE); }
    assert.equal(m.top(), 0);
});

test("a list shorter than the window never scrolls", () => {
    const m = createGlossaryModel({ count: 3 });
    m.jump(10);
    assert.deepEqual([m.index(), m.top()], [2, 0]);
    assert.equal(createGlossaryModel({ count: 0 }).move(1), false, "an empty list has nowhere to go");
});

test("page 2 opens only when allowed; going back always works; page 2 scroll stops at both ends", () => {
    const m = createGlossaryModel({ count: 10 });
    assert.equal(m.setPage(1, false), false);
    assert.equal(m.page(), 0);
    assert.equal(m.setPage(1, true), true);
    assert.equal(m.page(), 1);
    assert.equal(m.setPage(1, true), false, "already there");
    assert.equal(m.scrollLine(1, 3), true);
    assert.equal(m.scrollLine(1, 3), true);
    assert.equal(m.scrollLine(1, 3), false, "three lines: the cursor stops on the last");
    assert.equal(m.line(), 2);
    assert.equal(m.setPage(0, false), true);
    assert.equal(m.line(), 0, "a page change resets the scroll");
});

test("moving to another species resets page-2 scroll but keeps the page", () => {
    const m = createGlossaryModel({ count: 10 });
    m.setPage(1, true);
    m.scrollLine(1, 9);
    m.move(1);
    assert.deepEqual([m.page(), m.line()], [1, 0]);
});

test("the card reveals one line every 2 frames, restarts on a change, and never exceeds the total", () => {
    const m = createGlossaryModel({ count: 10 });
    assert.equal(m.reveal(4), 0);
    m.tickReveal(); m.tickReveal();
    assert.equal(m.reveal(4), 1);
    for (let i = 0; i < 20; i++) m.tickReveal();
    assert.equal(m.reveal(4), 4);
    m.move(1);
    assert.equal(m.reveal(4), 0, "a new species starts the reveal again");
});
