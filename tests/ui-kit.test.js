// The window kit (web/ui-kit.js): folds 10 / 5 steps, windows opening one after another, small drawing helpers.
import test from "node:test";
import assert from "node:assert/strict";
import {
    BOX_H, BOX_W, OPEN_STEPS, SFX_CLOSE, SFX_OPEN, barFill, createFold, createFoldChain, drawPanel, layoutTabs, panelPixelHeight, withFold,
} from "../web/ui-kit.js";

/** A canvas that only records what is asked of it. */
function recordingCtx() {
    const log = [];
    const ctx = new Proxy({}, {
        get: (_t, name) => (name === "log" ? log : (...args) => { log.push([name, ...args]); }),
        set: () => true,
    });
    return ctx;
}
const ticksUntil = (fold, state, limit = 100) => { let n = 0; while (fold.state() !== state && n < limit) { fold.tick(); n++; } return n; };

test("the box is 320 x 240, a window folds in 10 steps and the sounds are the game's SYSTEM03 / SYSTEM04 words", () => {
    assert.deepEqual([BOX_W, BOX_H, OPEN_STEPS], [320, 240, 10]);
    assert.equal(SFX_OPEN, 0x40019);
    assert.equal(SFX_CLOSE, 0x4001a);
});

test("a fold opens in ten steps of motion and lands on the eleventh (the game's integer step), and shuts in five", () => {
    const fold = createFold();
    assert.equal(fold.state(), "shut");
    assert.equal(fold.progress(), 0);
    fold.open();
    const seen = [];
    for (let i = 0; i < 10; i++) { fold.tick(); seen.push(fold.progress()); }
    assert.ok(seen.every((p, i) => p > (seen[i - 1] ?? 0) && p < 1), "rising and not yet 1 after ten steps");
    assert.ok(seen[9] > 0.999, "ten steps reach 4095 of 4096");
    assert.equal(fold.state(), "opening");
    fold.tick();
    assert.equal(fold.state(), "open");
    assert.equal(fold.progress(), 1);
    fold.close();
    assert.equal(ticksUntil(fold, "shut"), 5, "shuts in five steps (twice the speed)");
    assert.equal(fold.progress(), 0);
});

test("closing a fold that is half open only goes down", () => {
    const fold = createFold();
    fold.open();
    for (let i = 0; i < 4; i++) fold.tick();
    const mid = fold.progress();
    assert.ok(mid > 0.3 && mid < 0.5);
    fold.close();
    let last = mid;
    for (let i = 0; i < 10 && fold.state() !== "shut"; i++) {
        fold.tick();
        assert.ok(fold.progress() <= last, "never goes back up");
        last = fold.progress();
    }
    assert.equal(fold.state(), "shut");
});

test("three windows open one after another and shut in the reverse order, each with its sound", () => {
    const events = [];
    const chain = createFoldChain(["title", "body", "footer"], { onStart: (name, opening) => events.push([name, opening]) });
    chain.open();
    assert.deepEqual(events, [["title", true]], "only the first window starts at once");
    let n = 0;
    while (chain.phase() !== "open" && n < 200) { chain.tick(); n++; if (events.length === 2) assert.equal(chain.folds.title.state(), "open", "body waits for title"); }
    assert.equal(chain.phase(), "open");
    assert.deepEqual(events.map((e) => e[0]), ["title", "body", "footer"]);
    assert.equal(n, 33, "three windows of eleven ticks");
    events.length = 0;
    chain.close();
    n = 0;
    while (chain.phase() !== "shut" && n < 200) { chain.tick(); n++; }
    assert.deepEqual(events, [["footer", false], ["body", false], ["title", false]]);
    assert.equal(n, 15, "three windows of five ticks");
});

test("closing a chain that is still opening shuts only the windows that were started", () => {
    const events = [];
    const chain = createFoldChain(["a", "b", "c"], { onStart: (name, opening) => events.push([name, opening]) });
    chain.open();
    for (let i = 0; i < 14; i++) chain.tick();           // a is open, b has started
    events.length = 0;
    chain.close();
    for (let i = 0; i < 60; i++) chain.tick();
    assert.deepEqual(events, [["b", false], ["a", false]], "c never started, so it is never closed");
    assert.equal(chain.phase(), "shut");
    assert.equal(chain.folds.c.state(), "shut");
});

test("withFold draws nothing at 0, plainly at 1, and squeezed about the pivot in between", () => {
    const ctx = recordingCtx();
    let drawn = 0;
    assert.equal(withFold(ctx, 0, 10, 20, "x", () => drawn++), false);
    assert.equal(drawn, 0);
    withFold(ctx, 1, 10, 20, "x", () => drawn++);
    assert.equal(drawn, 1);
    assert.deepEqual(ctx.log, [], "no transform at full size");
    withFold(ctx, 0.5, 10, 20, "x", () => drawn++);
    assert.deepEqual(ctx.log.map((c) => c[0]), ["save", "translate", "scale", "translate", "restore"]);
    assert.deepEqual(ctx.log[2], ["scale", 0.5, 1]);
    ctx.log.length = 0;
    withFold(ctx, 0.25, 0, 0, "y", () => {});
    assert.deepEqual(ctx.log[2], ["scale", 1, 0.25]);
});

test("panel height is 22 + 14 per band + 20, and the tab labels are laid out left to right", () => {
    assert.deepEqual([3, 4, 5, 7].map(panelPixelHeight), [84, 98, 112, 140]);
    assert.deepEqual(layoutTabs(["AA", "BBBB", "C"], (s) => s.length * 8, 100, 12), [100, 128, 172]);
});

test("barFill: proportional, clamped, and zero for a missing or empty maximum", () => {
    assert.equal(barFill(50, 100, 80), 40);
    assert.equal(barFill(150, 100, 80), 80);
    assert.equal(barFill(-5, 100, 80), 0);
    assert.equal(barFill(5, 0, 80), 0);
    assert.equal(barFill(undefined, 100, 80), 0);
    assert.equal(barFill(1, 1000, 80), 0, "a sliver rounds to nothing");
});

test("drawPanel draws one tile per column per band and says no until the sheet has loaded", () => {
    const frame = (frame, h) => ({ frame, x: frame, y: 0, w: 40, h, dx: 0, dy: 0 });
    const pack = { img: {}, ids: { 28: { layers: [frame(56, 22), frame(57, 22), frame(58, 14), frame(59, 14), frame(60, 20), frame(61, 20)] } } };
    const ctx = recordingCtx();
    assert.equal(drawPanel(ctx, 5, 6, 8, 7, pack), true);
    assert.equal(ctx.log.filter((c) => c[0] === "drawImage").length, 8 * (7 + 2));
    assert.equal(drawPanel(ctx, 0, 0, 8, 7, { img: null, ids: pack.ids }), false);
    assert.equal(drawPanel(ctx, 0, 0, 8, 7, { img: {}, ids: {} }), false);
});
