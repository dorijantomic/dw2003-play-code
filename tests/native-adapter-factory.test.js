// One lifecycle for every native screen adapter (web/native-screen-host.js
// `createNativeAdapter`).
//
// The 13 adapters that boot a shipped overlay each carried their own copy of
// the same six steps: kick the manifest preload, boot or wait (`_pending`),
// write the held-key pad word, tick one frame, detect the screen's own finish,
// and close by reading the RAM back and tearing the host down. The copies had
// drifted: web/carddeck-native.js and web/cardduel-native.js read the RAM back
// while `_host` was still set, while web/dri-native.js and web/save-native.js
// cleared it first, so a commit that looked at `this._host` saw two different
// worlds depending on which screen the player closed.
//
// These tests drive the factory directly. No overlay manifest is loaded here,
// so `openNativeScreen` returns null and `_begin()` takes the pending path; the
// booted path is exercised with a stand-in host, which is what the RAM-read-back
// ordering is about.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch ??= async () => ({ json: async () => ({}) });

const { createNativeAdapter } = await import("../web/native-screen-host.js");

/** An adapter object in the shape the screens use, plus the factory's methods. */
function adapter(overrides = {}) {
    const owner = { _open: false, _pending: false, _host: null, _state: null, _onClose: null, _lastDiagnostic: null };
    return createNativeAdapter({ owner, moduleId: "pro/testonly", ...overrides });
}

/** A host stand-in that records the order it is touched in. */
function standIn(events) {
    return {
        setPad(mask) { events.push(`pad:${mask}`); },
        tick() { events.push("tick"); return false; },
        draw() { events.push("draw"); },
        teardown() { events.push("teardown"); },
        state() { return null; },
    };
}

test("open() without the manifest preloaded leaves the screen pending, not dead", () => {
    const a = adapter({ label: "native test boot failed" });
    a._begin();
    assert.equal(a._open, true, "the screen is open (the caller will keep updating it)");
    assert.equal(a._pending, true, "no manifest yet: the boot is deferred, not skipped");
    assert.equal(a._host, null);
    // The pending frame before the manifest lands is a no-op, not a crash.
    assert.doesNotThrow(() => a.update(1 / 60));
    assert.equal(a._open, true);
});

test("close reads the RAM back BEFORE the host is torn down", () => {
    const events = [];
    const a = adapter({
        commit: (host) => {
            assert.equal(host, a._host, "commit sees the live host it is reading");
            events.push("commit");
        },
    });
    a._open = true;
    a._host = standIn(events);
    a._onClose = () => events.push("onClose");
    a.close();
    assert.deepEqual(events, ["commit", "teardown", "onClose"],
        "read back, tear down, then hand control back to the parent screen");
    assert.equal(a._host, null);
    assert.equal(a._open, false);
});

test("close() twice reads back once", () => {
    let commits = 0;
    let closes = 0;
    const events = [];
    const a = adapter({ commit: () => { commits += 1; } });
    a._open = true;
    a._host = standIn(events);
    a._onClose = () => { closes += 1; };
    a.close();
    a.close();
    assert.equal(commits, 1, "a second close must not re-read a host that is gone");
    assert.equal(closes, 1, "and must not call the parent back twice");
});

test("_finish(false) tears down without reading back (the cancelled naming screen)", () => {
    const events = [];
    const a = adapter({ commit: () => events.push("commit") });
    a._open = true;
    a._host = standIn(events);
    a._finish(false);
    assert.deepEqual(events, ["teardown"], "a cancelled screen has no result to record");
    assert.equal(a._open, false);
});

test("update writes the pad word from the screen's own hook and closes on its frame", () => {
    const events = [];
    const a = adapter({
        pad: () => 0x1234,
        frame: (host) => { host.tick(); return true; },
    });
    a._open = true;
    a._host = standIn(events);
    a.update(1 / 60, { keys: {} });
    assert.deepEqual(events, ["pad:4660", "tick", "teardown"],
        "pad is written before the tick, and a finished tick closes the screen");
    assert.equal(a._open, false);
});

test("update binds the walker state the first time it sees one, and keeps it", () => {
    const a = adapter({ frame: () => false });
    const first = { keys: ["cross"] };
    const second = { keys: ["circle"] };
    a._open = true;
    a._host = standIn([]);
    a.update(1 / 60, first);
    a.update(1 / 60, second);
    assert.equal(a._state, first, "the state object handed in at open time wins");
});

test("the default draw paints only while a host is live", () => {
    const events = [];
    const a = adapter();
    const ctx = {};
    assert.equal(a.draw(ctx, 640, 480), false, "nothing to paint before the boot");
    a._open = true;
    a._host = standIn(events);
    assert.equal(a.draw(ctx, 640, 480), true);
    assert.deepEqual(events, ["draw"]);
});
