// Rejoin over real WebSockets (server/relay.mjs): drop a rj=1 client, come back with its key.
import test from "node:test";
import assert from "node:assert/strict";
import { startRelay } from "../server/relay.mjs";

function open(url) {
    const ws = new WebSocket(url);
    const got = [], waiters = [];
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        got.push(m);
        for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    };
    const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const next = (pred) => new Promise((res, rej) => {
        const hit = got.find(pred);
        if (hit) return res(hit);
        const t = setTimeout(() => rej(new Error("timed out; got " + JSON.stringify(got))), 3000);
        waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
    });
    return { ws, got, ready, next };
}

test("rejoin over a real socket: same id, name and place back; A sees away then back", async () => {
    const relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const base = `ws://127.0.0.1:${relay.port}/`;
    try {
        const a = open(base + "?create=1&name=Ken&rj=1");
        await a.ready;
        const { room } = await a.next((m) => m.t === "welcome");
        const b = open(base + `?room=${room}&name=Ana&rj=1`);
        await b.ready;
        const bw = await b.next((m) => m.t === "welcome");
        assert.match(bw.key, /^[0-9a-f]{32}$/);
        b.ws.send(JSON.stringify({ t: "pos", map: "s330", x: 100, y: 200, dir: "left", mv: 0 }));
        await a.next((m) => m.t === "at" && m.id === bw.id);
        b.ws.close();
        await a.next((m) => m.t === "away" && m.id === bw.id);
        const b2 = open(base + `?room=${room}&name=Zed&rj=1&key=${bw.key}`);
        await b2.ready;
        const w = await b2.next((m) => m.t === "welcome");
        assert.equal(w.id, bw.id);
        assert.equal(w.resumed, true);
        assert.deepEqual(w.at, { map: "s330", x: 100, y: 200, dir: "left" });
        await a.next((m) => m.t === "back" && m.id === bw.id);
        a.ws.close(); b2.ws.close();
    } finally { await relay.close(); }
});
