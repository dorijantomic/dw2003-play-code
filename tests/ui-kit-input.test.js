// The book screens' pad reader (web/ui-kit-input.js): repeat ladder, no repeat on face buttons, the opening press is ignored.
import test from "node:test";
import assert from "node:assert/strict";
import { REPEATING, WORD, createKitInput } from "../web/ui-kit-input.js";
import { buttonForKey } from "../web/vendor/engine.js";

/** Hold `buttons` from tick 1 to tick `last`; list the ticks on which `name` acts. */
function actingTicks(buttons, name, last, input = createKitInput()) {
    const out = [];
    for (let tick = 1; tick <= last; tick++) if (input.step(new Set(buttons), tick).has(name)) out.push(tick);
    return out;
}

test("a held direction acts on the press, then at ticks 16, 22, 26, 30, ... (15, then 6, then every 4)", () => {
    assert.deepEqual(actingTicks(["down"], "down", 60), [1, 16, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58]);
});

test("a held face button, shoulder or Start acts once and never repeats", () => {
    for (const name of ["circle", "cross", "l1", "r1", "start", "square"]) {
        assert.deepEqual(actingTicks([name], name, 80), [1], name);
    }
    assert.deepEqual([...REPEATING], ["up", "down", "left", "right"]);
});

test("the words are the English ones: Enter confirms as circle, Escape backs out as cross, Q and E are l1 and r1", () => {
    assert.equal(buttonForKey("enter", 2), WORD.confirm);
    assert.equal(buttonForKey("escape", 2), WORD.back);
    assert.equal(buttonForKey("q", 2), WORD.prev);
    assert.equal(buttonForKey("e", 2), WORD.next);
    assert.equal(buttonForKey("i", 2), WORD.start);
});

test("a button that was down when the screen opened does nothing until it is let go", () => {
    const input = createKitInput();
    input.reset(["circle"]);
    for (let tick = 1; tick <= 5; tick++) assert.equal(input.step(new Set(["circle"]), tick).size, 0, `tick ${tick}`);
    assert.equal(input.step(new Set(), 6).size, 0);
    assert.ok(input.step(new Set(["circle"]), 7).has("circle"), "a fresh press acts");
});

test("words that are not pad buttons (letters, F keys) are ignored", () => {
    const input = createKitInput();
    assert.equal(input.step(new Set(["f", "a", "circle"]), 1).size, 1);
});

test("two directions held together both act", () => {
    const input = createKitInput();
    const act = input.step(new Set(["up", "left"]), 1);
    assert.deepEqual([...act].sort(), ["left", "up"]);
});

test("advance gives 50 displayed frames for one second", () => {
    const input = createKitInput();
    assert.equal(input.advance(1, new Set()).length, 50);
});
