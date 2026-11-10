// The six translated battle menus share one scaffold (web/battle-menu-adapter.js).
// This drives it with a fake session so the shared parts are pinned without a
// browser: the press queue's depth and its one-tick pulse, the ready gate, the
// open/close lifecycle, the answer hand-back, the language byte and the strip
// guard.
import test from "node:test";
import assert from "node:assert/strict";
import { createBattleMenuAdapter, battleMenuLanguage, stripCanvas, BATTLE_QUEUE_LIMIT } from "../web/battle-menu-adapter.js";

function fakeSession(overrides = {}) {
    return {
        _ready: true, _finished: false, _chosen: -2, ticks: [], disposed: 0,
        ready() { return this._ready; },
        finished() { return this._finished; },
        chosen() { return this._chosen; },
        tick(buttons, frameTick) { this.ticks.push({ buttons: [...buttons], frameTick }); },
        dispose() { this.disposed++; },
        moves: [],
        ...overrides,
    };
}

function build(spec = {}, session = fakeSession()) {
    const r = createBattleMenuAdapter({
        renderer: { stats: { packs: 0 } },
        options: { getState: () => ({ languageByte: 2 }) },
        load: () => Promise.resolve({}),
        loadFailure: "battle menu data failed to load",
        failureMessage: "translated menu failed",
        failureConsole: "Translated battle menu failed",
        languageError: "Battle menu language index is invalid",
        seed: () => ({ tag: "seed" }),
        start: () => session,
        ...spec,
    });
    // The data is already in, so update() starts the session on its first call.
    r._data = {};
    r.open();
    return { r, session };
}

/** Run the clock until the session has taken `n` display ticks. */
function pump(r, n = 1) {
    const target = r._ticks + n;
    for (let i = 0; i < 8 && r._ticks < target; i++) r.update();
    assert.ok(r._ticks >= target, "the display clock did not tick");
}

test("a queued press is held for one display tick, then released for one", () => {
    const { r, session } = build();
    pump(r);
    r.press("down");
    assert.equal(r.diagnostics().queued, 1);
    const from = session.ticks.length;
    pump(r, 2);
    const sent = session.ticks.slice(from).map((t) => t.buttons);
    assert.deepEqual(sent.filter((buttons) => buttons.includes("down")), [["down"]]);
    assert.equal(sent.at(-1).includes("down"), false);
    assert.equal(r.diagnostics().queued, 0);
});

test("presses wait while the session does not read the pad", () => {
    const session = fakeSession({ _ready: false });
    const { r } = build({}, session);
    pump(r);
    r.press("up");
    r.press("cross");
    pump(r, 2);
    assert.equal(session.ticks.some((t) => t.buttons.length > 0), false);
    assert.equal(r.diagnostics().queued, 2);
    session._ready = true;
    const from = session.ticks.length;
    pump(r, 2);
    const sent = session.ticks.slice(from).map((t) => t.buttons);
    assert.deepEqual(sent.filter((buttons) => buttons.includes("up")), [["up"]]);
});

test("the queue keeps its own depth (2 for the form list, 16 by default)", () => {
    const two = build({ queueLimit: 2 });
    for (const button of ["up", "down", "circle", "cross"]) two.r.press(button);
    assert.equal(two.r.diagnostics().queued, 2);

    const sixteen = build();
    for (const button of ["up", "down", "circle", "cross"]) sixteen.r.press(button);
    assert.equal(sixteen.r.diagnostics().queued, 4);
    assert.equal(BATTLE_QUEUE_LIMIT, 16);
});

test("a button the screen does not take is not queued", () => {
    const { r } = build({ pulseButtons: new Set(["cross"]) });
    r.press("up");
    r.press("cross");
    assert.equal(r.diagnostics().queued, 1);
});

test("the answer is handed back once, and chosen() keeps it", () => {
    const session = fakeSession();
    const { r } = build({ answer: (state, s) => {
        if (!s.finished()) return null;
        state._chosen = s.chosen();
        return { value: s.chosen() };
    } }, session);
    pump(r);
    assert.equal(r.update(), null);
    session._finished = true;
    session._chosen = 7;
    let value = null;
    for (let i = 0; i < 8 && value === null; i++) value = r.update();
    assert.equal(value, 7);
    assert.equal(r.chosen(), 7);
});

test("close disposes an unfinished session and only then", () => {
    const live = fakeSession();
    const one = build({}, live);
    pump(one.r);
    one.r.close();
    assert.equal(live.disposed, 1);
    assert.equal(one.r.isOpen(), false);

    const over = fakeSession({ _finished: true });
    const two = build({}, over);
    pump(two.r);
    two.r.close();
    assert.equal(over.disposed, 0);
});

test("done() decides when a session that closed itself is left alone", () => {
    const session = fakeSession({ step: () => "done" });
    const { r } = build({ done: (s) => s.step() === "done" }, session);
    pump(r);
    r.close();
    assert.equal(session.disposed, 0);
});

test("the language byte defaults to 2 and only takes the seven disc languages", () => {
    const options = { getState: () => ({}) };
    assert.equal(battleMenuLanguage(options, "bad"), 2);
    assert.equal(battleMenuLanguage({ getState: () => ({ languageByte: 5 }) }, "bad"), 5);
    assert.throws(() => battleMenuLanguage({ getState: () => ({ languageByte: 7 }) }, "bad"), /bad/);
});

test("the strip is not decoded without a document", () => {
    assert.equal(stripCanvas(new Uint8Array(4), 2, 2), null);
});
