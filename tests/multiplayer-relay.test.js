// The multiplayer relay over real WebSockets (server/relay.mjs): create a room, join it, see each other, hear about leaving.
import test from "node:test";
import assert from "node:assert/strict";
import { startRelay } from "../server/relay.mjs";

function open(url) {
    const ws = new WebSocket(url);
    const got = [];
    const waiters = [];
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        got.push(m);
        for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    };
    const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const next = (pred) => new Promise((res, rej) => {
        const hit = got.find(pred);
        if (hit) return res(hit);
        const t = setTimeout(() => rej(new Error("timed out waiting for a message; got " + JSON.stringify(got))), 3000);
        waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
    });
    return { ws, got, ready, next };
}

test("two clients over a real socket: create, join, move, leave", async () => {
    const relay = await startRelay({ port: 0, host: "127.0.0.1" });
    const base = `ws://127.0.0.1:${relay.port}/`;
    try {
        const a = open(base + "?create=1&name=Ken");
        await a.ready;
        const { room, id: aid } = await a.next((m) => m.t === "welcome");
        assert.equal(room.length, 5);

        const b = open(base + `?room=${room}&name=Ana`);
        await b.ready;
        const w = await b.next((m) => m.t === "welcome");
        assert.deepEqual(w.roster, [{ id: aid, name: "Ken", map: null, card: null }]);
        await a.next((m) => m.t === "join" && m.name === "Ana");

        a.ws.send(JSON.stringify({ t: "pos", map: "s330", x: 100, y: 200, dir: "left", mv: 1 }));
        b.ws.send(JSON.stringify({ t: "pos", map: "s330", x: 5, y: 6, dir: "up", mv: 0 }));
        const seen = await b.next((m) => m.t === "pos" && m.id === aid && m.x === 100);
        assert.equal(seen.dir, "left");

        b.ws.close();
        await a.next((m) => m.t === "leave");

        const bad = open(base + "?room=QQQQQ");
        await bad.ready;
        assert.equal((await bad.next((m) => m.t === "err")).reason, "no_room");
        a.ws.close();
    } finally {
        await relay.close();
    }
});
