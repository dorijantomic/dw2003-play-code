// Review focus: the book draws over a wide window too (web/book-host.js draw), and draws nothing when no book is open.
import test from "node:test";
import assert from "node:assert/strict";
import { createBookHost } from "../web/book-host.js";

function fakeCtx() {
    const log = [];
    return new Proxy({}, { get: (_t, n) => (n === "log" ? log : (...a) => { log.push([n, ...a]); }), set: () => true });
}
const book = (wall) => ({ windows: ["w"], wall, act: () => null, draw(ctx, view) { ctx.fillRect(1, 2, 3, 4); view.progress("w"); } });

test("nothing is drawn while no book is open", () => {
    const host = createBookHost({ factories: { demo: () => book(false) } });
    const ctx = fakeCtx();
    host.draw(ctx, 640, 480, 0);
    assert.deepEqual(ctx.log, []);
});

test("the dim covers the wide-screen sides: from -padL to viewW + padL, full height", () => {
    const host = createBookHost({ factories: { demo: () => book(false) } });
    host.open("demo");
    const ctx = fakeCtx();
    host.draw(ctx, 640, 480, 120);
    const dim = ctx.log.find((c) => c[0] === "fillRect");
    assert.deepEqual(dim.slice(1), [-120, 0, 640 + 240, 480]);
});

test("the book is drawn in the 320 x 240 box: the canvas is scaled by viewW / 320", () => {
    const host = createBookHost({ factories: { demo: () => book(false) } });
    host.open("demo");
    const ctx = fakeCtx();
    host.draw(ctx, 640, 480);
    const scale = ctx.log.find((c) => c[0] === "scale");
    assert.deepEqual(scale.slice(1), [2, 2]);
    assert.ok(ctx.log.some((c) => c[0] === "fillRect" && c[1] === 1 && c[4] === 4), "the book's own draw ran");
});

test("a wall book fills the dim solid (alpha 1) before the wall", () => {
    const host = createBookHost({ factories: { demo: () => book(true) } });
    host.open("demo");
    const ctx = { fillStyle: "", log: [], fillRect(...a) { this.log.push([this.fillStyle, ...a]); }, save() {}, restore() {}, scale() {}, translate() {} };
    host.draw(ctx, 320, 240, 0);
    assert.equal(ctx.log[0][0], "rgba(0, 0, 0, 1)");
});

test("a wide view: the 640 x 480 box keeps scale 2 and its place, the dim covers the strips, nothing is stretched", () => {
    const host = createBookHost({ factories: { demo: () => book(false) } });
    host.open("demo");
    const ctx = fakeCtx();
    host.draw(ctx, 640, 480, 106);
    assert.deepEqual(ctx.log.find((c) => c[0] === "fillRect").slice(1), [-106, 0, 640 + 212, 480]);
    assert.deepEqual(ctx.log.find((c) => c[0] === "scale").slice(1), [2, 2]);
    assert.deepEqual(ctx.log.find((c) => c[0] === "translate").slice(1), [0, 0]);
});

test("a view that is not 4:3 is not stretched: one scale, box centred", () => {
    const host = createBookHost({ factories: { demo: () => book(false) } });
    host.open("demo");
    const ctx = fakeCtx();
    host.draw(ctx, 426, 240, 0);
    assert.deepEqual(ctx.log.find((c) => c[0] === "scale").slice(1), [1, 1]);
    assert.deepEqual(ctx.log.find((c) => c[0] === "translate").slice(1), [53, 0]);
});

test("sides left to the field cover: the dim stops at the box and a wall is clipped to the box", () => {
    const host = createBookHost({ factories: { demo: () => book(true) } });
    host.open("demo");
    const ctx = fakeCtx();
    host.draw(ctx, 640, 480, 106, true);
    assert.deepEqual(ctx.log.find((c) => c[0] === "fillRect").slice(1), [0, 0, 640, 480]);
    assert.ok(ctx.log.some((c) => c[0] === "clip"), "the wall is clipped");
});
