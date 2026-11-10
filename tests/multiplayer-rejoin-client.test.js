// The client side of multiplayer rejoin (web/multiplayer.js) run in node with a fake WebSocket, localStorage and timers.
import test from "node:test";
import assert from "node:assert/strict";

const sockets = [];
class FakeWS {
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
    get q() { return new URL(this.url).searchParams; }
    say(o) { this.onmessage({ data: JSON.stringify(o) }); }
    drop() { this.readyState = 3; this.onclose(); }
}
Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: FakeWS });
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
let timers = [];
function fakeTimers() {
    timers = [];
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; };
    globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].live = false; };
}
const realTimers = () => { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; };
const live = () => timers.filter((t) => t.live);
const fireNext = () => { const t = live()[0]; t.live = false; t.fn(); return t.ms; };

const { connect, disconnect, mpOn, myId, isOnline } = await import("../web/multiplayer.js");

const BASE = "ws://127.0.0.1:20031";
const KEY1 = "a".repeat(32), KEY2 = "b".repeat(32);
function reset() { disconnect(); sockets.length = 0; store.clear(); fakeTimers(); }
const welcome = (ws, over = {}) => ws.say({ t: "welcome", id: 7, room: "ABCDE", host: 7, roster: [], ...over });

test("a retry that fails before its own welcome still retries: 1 + 5 sockets, waits 1500..24000", () => {
    reset();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0]);
        const waits = [];
        sockets[0].drop();
        for (let i = 0; i < 7 && live().length; i++) {
            waits.push(fireNext());
            sockets.at(-1).drop();                       // each retry dies before its own welcome
        }
        assert.deepEqual(waits, [1500, 3000, 6000, 12000, 24000]);
        assert.equal(sockets.length, 6);
        assert.equal(live().length, 0, "no sixth retry");
    } finally { disconnect(); realTimers(); }
});

test("after giving up the flag is cleared: a fresh connect that never gets a welcome does not retry", () => {
    reset();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0]);
        sockets[0].drop();
        while (live().length) { fireNext(); sockets.at(-1).drop(); }
        const before = sockets.length;
        connect({ base: BASE, room: "ABCDE" });
        sockets.at(-1).drop();
        assert.equal(live().length, 0, "never in a room: no retry");
        assert.equal(sockets.length, before + 1);
    } finally { disconnect(); realTimers(); }
});
