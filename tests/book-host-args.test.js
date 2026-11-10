// What the host gives each book it makes (web/book-host.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createBookHost } from "../web/book-host.js";

test("each book is made with the settings store and the batch setter", () => {
    const seen = [];
    const setFxMany = () => {};
    const book = { windows: ["one"], wall: false, act: () => null, draw() {} };
    const host = createBookHost({ factories: { demo: (args) => { seen.push(args); return book; } }, setFxMany });
    assert.equal(host.open("demo"), true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].setFxMany, setFxMany);
    assert.equal(typeof seen[0].setFx, "function");
    assert.equal(typeof seen[0].fx, "function");
});
