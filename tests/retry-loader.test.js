// web/retry-loader.js: the glossary getters run every frame; a failed load must not refetch before the delay.
import test from "node:test";
import assert from "node:assert/strict";
import { createRetryLoader } from "../web/retry-loader.js";

const settle = () => new Promise((r) => setTimeout(r, 0));

test("a failed load is not refetched within the delay, then is; the getter shows null meanwhile", async () => {
    let t = 1000, calls = 0, ok = false;
    const l = createRetryLoader(async () => { calls++; return ok ? { a: 1 } : null; }, { retryMs: 5000, now: () => t });
    assert.equal(l.get(), null);
    for (let i = 0; i < 50; i++) { assert.equal(l.get(), null); await settle(); }   // 50 "frames"
    assert.equal(calls, 1);
    t += 4999; l.get(); await settle();
    assert.equal(calls, 1, "still inside the delay");
    t += 1; ok = true; l.get(); await settle();
    assert.equal(calls, 2, "retried after 5 s");
    assert.deepEqual(l.get(), { a: 1 });
    t += 99999; l.get(); await settle();
    assert.equal(calls, 2, "loaded data is never refetched");
});

test("a throwing load counts as a failure and waits too; no refetch while one is in flight", async () => {
    let t = 0, calls = 0, release;
    const l = createRetryLoader(() => { calls++; return calls === 1 ? Promise.reject(new Error("x")) : new Promise((r) => { release = r; }); }, { retryMs: 5000, now: () => t });
    l.get(); await settle(); l.get(); await settle();
    assert.equal(calls, 1);
    t = 5000; l.get(); await settle(); l.get(); l.get();
    assert.equal(calls, 2, "one fetch in flight");
    release({ ok: 1 }); await settle();
    assert.deepEqual(l.get(), { ok: 1 });
});
