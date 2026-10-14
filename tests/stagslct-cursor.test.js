// The walker's STAGSLCT gate/area-travel menu (web/stagslct.js) cursor rule.
//
// The original mover F0x80084a5c (claim `stagslct-movecursor-address-2026-10-11`)
// never wraps: at either end of the list it restores the entry position, so a
// press that cannot move leaves the cursor where it is. The screen's flat list
// is already filtered to the selectable rows, so the rule reduces to a clamp.
// The full mover is proved against the original in
// tests/lane-b/stage-select-move-cursor.test.js; this file pins the web menu's
// use of the same rule (a wrap here was the mismatch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cursorStep } from "../web/stagslct.js";

test("the cursor clamps at both ends instead of wrapping", () => {
    // Up at the first row and down at the last row keep the entry position.
    assert.equal(cursorStep(0, 270, -1), 0, "up at the top stays");
    assert.equal(cursorStep(269, 270, 1), 269, "down at the bottom stays");
    // A wrap would have produced 269 and 0 here.
    assert.notEqual(cursorStep(0, 270, -1), 269, "up at the top does not wrap");
    assert.notEqual(cursorStep(269, 270, 1), 0, "down at the bottom does not wrap");
});

test("the cursor still steps one row mid-list", () => {
    assert.equal(cursorStep(5, 270, 1), 6);
    assert.equal(cursorStep(5, 270, -1), 4);
    assert.equal(cursorStep(0, 270, 1), 1);
    assert.equal(cursorStep(269, 270, -1), 268);
});

test("an empty list keeps the cursor at zero", () => {
    assert.equal(cursorStep(0, 0, 1), 0);
    assert.equal(cursorStep(3, 0, -1), 0);
});
