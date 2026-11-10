// web/translated-screen-host.js: one home for the open/close/_finish blocks the nine translated
// screens used to copy by hand. Each case pins one of the divergences the copies had drifted into.
import test from "node:test";
import assert from "node:assert/strict";

import {
    CLOSE_SILENT, CLOSE_NOTIFY, DISPOSE_NEVER, DISPOSE_ALWAYS, DISPOSE_UNLESS_FINISHED,
    createTranslatedScreenHost,
} from "../web/translated-screen-host.js";

function screen(extra = {}) {
    return { _open: false, _pending: false, _session: null, _onClose: null, _request: 0, _closes: 0, ...extra };
}

function session({ done = false } = {}) {
    const s = { disposed: 0, finished: () => done, dispose() { s.disposed += 1; } };
    return s;
}

test("begin raises the screen and invalidates an older load", () => {
    const g = screen();
    const host = createTranslatedScreenHost(g, {});
    const first = host.begin({ onClose: () => {} });
    assert.equal(g._open, true);
    assert.equal(g._pending, true);
    assert.equal(host.current(first), true);
    const second = host.begin();
    assert.equal(second, first + 1);
    assert.equal(host.current(first), false);
    assert.equal(host.current(second), true);
});

test("a silent close disposes and notifies nobody", () => {
    const g = screen();
    let called = 0;
    const host = createTranslatedScreenHost(g, { closeMode: CLOSE_SILENT, closeDispose: DISPOSE_ALWAYS });
    host.begin({ onClose: () => { called += 1; } });
    g._session = session();
    assert.equal(host.close(), true);
    assert.equal(g._open, false);
    assert.equal(g._session, null);
    assert.equal(called, 0);
    assert.equal(g._session, null);
    // A second close is a no-op.
    assert.equal(host.close(), false);
    assert.equal(called, 0);
});

test("a notified close runs the continuation once, after the screen is shut", () => {
    const g = screen();
    const seen = [];
    const host = createTranslatedScreenHost(g, { closeMode: CLOSE_NOTIFY, closeDispose: DISPOSE_ALWAYS });
    host.begin({ onClose: () => seen.push({ open: g._open, session: g._session }) });
    const s = session();
    g._session = s;
    host.close();
    assert.deepEqual(seen, [{ open: false, session: null }]);
    assert.equal(s.disposed, 1);
});

test("closeDispose: ALWAYS disposes a finished session, UNLESS_FINISHED leaves it", () => {
    for (const [policy, expected] of [[DISPOSE_ALWAYS, 1], [DISPOSE_UNLESS_FINISHED, 0], [DISPOSE_NEVER, 0]]) {
        const g = screen();
        const host = createTranslatedScreenHost(g, { closeDispose: policy });
        host.begin();
        const s = session({ done: true });
        g._session = s;
        host.close();
        assert.equal(s.disposed, expected, `close with ${policy}`);
    }
    const g = screen();
    const host = createTranslatedScreenHost(g, { closeDispose: DISPOSE_UNLESS_FINISHED });
    host.begin();
    const running = session({ done: false });
    g._session = running;
    host.close();
    assert.equal(running.disposed, 1, "an unfinished session is disposed");
});

test("release reads the session before any teardown, then the continuation runs", () => {
    const g = screen();
    const order = [];
    const host = createTranslatedScreenHost(g, {
        closeMode: CLOSE_NOTIFY, finishDispose: DISPOSE_UNLESS_FINISHED, countsCloses: true,
        release(s) {
            order.push(["release", s ? s.disposed : null, g._open]);
        },
    });
    host.begin({ onClose: () => order.push(["onClose", g._session]) });
    const s = session({ done: false });
    g._session = s;
    host.finish();
    assert.deepEqual(order, [["release", 0, false], ["onClose", null]]);
    assert.equal(s.disposed, 1);
    assert.equal(g._closes, 1);
});

test("finish on a finished session skips teardown but still releases and closes", () => {
    const g = screen();
    let released = 0;
    const host = createTranslatedScreenHost(g, {
        closeMode: CLOSE_NOTIFY, finishDispose: DISPOSE_UNLESS_FINISHED, closeDispose: DISPOSE_UNLESS_FINISHED,
        release() { released += 1; },
    });
    host.begin();
    const s = session({ done: true });
    g._session = s;
    host.finish();
    assert.equal(released, 1);
    assert.equal(s.disposed, 0);
    assert.equal(g._closes, 0, "closes are counted only where the screen asks for it");
});

test("a screen that does not track pending and keeps its session", () => {
    const g = screen({ _session: null });
    const host = createTranslatedScreenHost(g, { tracksPending: false, clearSession: false, closeDispose: DISPOSE_NEVER });
    host.begin();
    assert.equal(g._pending, false, "pending is left to the screen's own diagnostics");
    const s = session();
    g._session = s;
    host.close();
    assert.equal(g._session, s, "the merchant kept its session");
    assert.equal(s.disposed, 0);
});

test("abandon drops the screen with no continuation, teardown or close", () => {
    const g = screen();
    let called = 0;
    const host = createTranslatedScreenHost(g, { closeMode: CLOSE_NOTIFY, closeDispose: DISPOSE_ALWAYS, countsCloses: true });
    const token = host.begin({ onClose: () => { called += 1; } });
    const s = session();
    g._session = s;
    assert.equal(host.abandon(), true);
    assert.equal(g._open, false);
    assert.equal(host.current(token), false);
    assert.equal(g._closes, 0);
    assert.equal(s.disposed, 0);
    assert.equal(called, 0);
    assert.equal(g._session, s, "the caller's own path takes over the session it was given");
    assert.equal(host.abandon(), false, "abandoning a shut screen does nothing");
});
