// The relay heartbeat: rejoin-aware sockets are checked every beat (5 s), older ones every 6th beat (30 s, as before).
import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startRelay, PING_MS } from "../server/relay.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function open(url, opts) {
    const ws = new WebSocket(url, opts);
    const got = [];
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));
    const ready = new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
    const until = async (pred, ms = 3000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { const hit = got.find(pred); if (hit) return hit; await sleep(20); }
        throw new Error("timed out; got " + JSON.stringify(got));
    };
    return { ws, got, ready, until };
}

test("the heartbeat is 5 s", () => { assert.equal(PING_MS, 5000); });

test("a rj socket that stops answering pings goes away within two beats; an older one is not dropped before the sixth", async () => {
    const relay = await startRelay({ port: 0, host: "127.0.0.1", pingMs: 100 });
    const base = `ws://127.0.0.1:${relay.port}/`;
    const all = [];
    try {
        const a = open(base + "?create=1&name=Ken&rj=1"); all.push(a);
        await a.ready;
        const { room } = await a.until((m) => m.t === "welcome");
        const b = open(base + `?room=${room}&name=Ana&rj=1`, { autoPong: false }); all.push(b);
        const c = open(base + `?room=${room}&name=Old`, { autoPong: false }); all.push(c);
        await b.ready; await c.ready;
        const bw = await b.until((m) => m.t === "welcome");
        const cw = await c.until((m) => m.t === "welcome");
        const t0 = Date.now();
        await a.until((m) => m.t === "away" && m.id === bw.id);
        assert.ok(Date.now() - t0 < 600, "found within about two beats");
        await sleep(300);
        assert.equal(a.got.some((m) => (m.t === "leave" || m.t === "away") && m.id === cw.id), false, "older socket still held");
        await a.until((m) => m.t === "leave" && m.id === cw.id, 3000);
        assert.ok(Date.now() - t0 >= 700, "not before the sixth beat");
    } finally { for (const x of all) x.ws.terminate(); await relay.close(); }
});
