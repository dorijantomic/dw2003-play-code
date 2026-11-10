// The book host (web/book-host.js): opens a book through its folds, hands it the pad, shuts it, and gives the pause list back
// only once the pad is let go.
import test from "node:test";
import assert from "node:assert/strict";
import { RELEASE_WAIT_FRAMES, createBookHost } from "../web/book-host.js";
import { createBlankBook } from "../web/book-blank.js";

const DT = 0.02; // one field tick at 50 Hz
function stubBook(log) {
    return {
        windows: ["one", "two"], wall: false,
        act(buttons) { log.push([...buttons].sort().join("+")); return buttons.has("cross") ? "back" : null; },
        tick() { log.push("tick"); },
        draw() {},
    };
}
function setup() {
    const sounds = [], acts = [], backs = [];
    const sfx = { playPacked: (id) => sounds.push(id), play: (name) => sounds.push(name) };
    const host = createBookHost({ sfx, factories: { demo: () => stubBook(acts) } });
    const run = (held, frames) => { for (let i = 0; i < frames; i++) host.update(DT, held); };
    return { host, sounds, acts, backs, run };
}

test("unknown book names do not open, and a second open while one is up is refused", () => {
    const { host } = setup();
    assert.equal(host.open("nope"), false);
    assert.equal(host.isOpen(), false);
    assert.equal(host.open("demo"), true);
    assert.equal(host.open("demo"), false);
    assert.equal(host.isOpen(), true);
});

test("the book gets no pad until its windows are open; then it gets the acting buttons", () => {
    const { host, acts, run, sounds } = setup();
    host.open("demo", null, []);
    assert.deepEqual(sounds, [0x40019], "the first window's open sound at once");
    run(new Set(["down"]), 10);
    assert.equal(acts.filter((a) => a !== "tick").length, 0, "still opening: nothing reaches the book");
    run(new Set(), 20);
    assert.deepEqual(sounds, [0x40019, 0x40019], "the second window opened after the first");
    run(new Set(["down"]), 1);
    assert.ok(acts.includes("down"));
});

test("Back shuts the windows in reverse, plays the back click and the close sounds, then calls back exactly once", () => {
    const { host, sounds, backs, run } = setup();
    host.open("demo", () => backs.push("back"), []);
    run(new Set(), 40);
    sounds.length = 0;
    run(new Set(["cross"]), 1);
    run(new Set(), 40);
    assert.deepEqual(sounds, ["system01", 0x4001a, 0x4001a]);
    assert.deepEqual(backs, ["back"]);
    assert.equal(host.isOpen(), false);
    run(new Set(), 10);
    assert.deepEqual(backs, ["back"], "not again");
});

test("the pause list does not come back while the pad is still held, but does after the wait is over", () => {
    const { host, backs, run } = setup();
    host.open("demo", () => backs.push("back"), []);
    run(new Set(), 40);
    run(new Set(["cross"]), 1);
    run(new Set(["cross"]), 20);
    assert.deepEqual(backs, [], "Back still down: the list would see it as a press and close");
    run(new Set(), 3);
    assert.deepEqual(backs, ["back"], "let go: it comes back");
    assert.ok(RELEASE_WAIT_FRAMES > 0);
});

test("when the wait runs out with Back still down, the callback gets the held buttons to block", () => {
    const { host, run } = setup();
    let got = null;
    host.open("demo", (held) => { got = held; }, []);
    run(new Set(), 40);
    run(new Set(["cross"]), 1);
    run(new Set(["cross"]), RELEASE_WAIT_FRAMES + 40);
    assert.deepEqual(got, ["cross"]);
});

test("a confirm that was down when the book opened does not act", () => {
    const { host, acts, run } = setup();
    host.open("demo", null, ["circle"]);
    run(new Set(["circle"]), 60);
    assert.equal(acts.filter((a) => a.includes("circle")).length, 0);
});

test("the blank book: Back is the only thing it answers, and all three windows are named", () => {
    const book = createBlankBook({ title: "GLOSSARY" });
    assert.deepEqual(book.windows, ["title", "body", "footer"]);
    assert.equal(book.wall, true);
    assert.equal(book.act(new Set(["circle", "down"])), null);
    assert.equal(book.act(new Set(["cross"])), "back");
});

function drawCtx() { return new Proxy({}, { get: () => () => {}, set: () => true }); }

test("the book gets the last frame seconds in its draw view", () => {
    let seen = null;
    const book = { windows: ["a"], wall: false, act: () => null, draw: (_c, view) => { seen = view; } };
    const host = createBookHost({ factories: { x: () => book } });
    host.open("x", null, []);
    host.update(0.02, new Set());
    host.draw(drawCtx(), 640, 480, 0);
    assert.equal(seen.dt, 0.02);
});

test("a book is told when the host drops it", () => {
    let closed = 0;
    const book = { windows: ["a"], wall: false, act: () => null, draw() {}, close() { closed++; } };
    const host = createBookHost({ factories: { x: () => book } });
    host.open("x", null, []);
    host.close();
    assert.equal(closed, 1);
    host.close();
    assert.equal(closed, 1, "closing a host with no book does nothing");
});
