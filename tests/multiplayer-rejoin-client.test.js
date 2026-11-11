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

const SEAT = "dw.mp.seat";
const seatNow = () => JSON.parse(store.get(SEAT) ?? "null");

test("connect always sends rj=1; a new room has no key; welcome saves the seat", () => {
    reset();
    try {
        connect({ base: BASE, create: true });
        const ws = sockets[0];
        assert.equal(ws.q.get("rj"), "1");
        assert.equal(ws.q.get("create"), "1");
        assert.equal(ws.q.get("key"), null);
        welcome(ws, { key: KEY1 });
        assert.deepEqual(seatNow(), { base: BASE, room: "ABCDE", key: KEY1 });
    } finally { disconnect(); realTimers(); }
});

test("a retry after a drop carries the room and the key", () => {
    reset();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1 });
        sockets[0].drop();
        fireNext();
        const q = sockets[1].q;
        assert.equal(q.get("rj"), "1"); assert.equal(q.get("room"), "ABCDE"); assert.equal(q.get("key"), KEY1);
    } finally { disconnect(); realTimers(); }
});

test("a resumed welcome keeps my id and says nothing about joining", () => {
    reset();
    const lines = [];
    const off = mpOn((t, d) => { if (t === "sys") lines.push(d.text); });
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1 });
        sockets[0].drop(); fireNext();
        welcome(sockets[1], { key: KEY1, resumed: true, at: { map: "s1", x: 1, y: 2, dir: "down" } });
        assert.equal(myId(), 7);
        assert.equal(isOnline(), true);
        assert.equal(lines.filter((l) => l.startsWith("You joined")).length, 1, "only the first welcome says it");
    } finally { off(); disconnect(); realTimers(); }
});

test("err gone after a drop: the seat is cleared and the client joins ONCE as a new player (no key)", () => {
    reset();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1 });
        sockets[0].drop(); fireNext();
        sockets[1].say({ t: "err", reason: "gone" });
        assert.equal(seatNow(), null);
        assert.equal(sockets.length, 3);
        assert.equal(sockets[2].q.get("key"), null);
        assert.equal(sockets[2].q.get("room"), "ABCDE");
        welcome(sockets[2], { id: 9, key: KEY2 });
        assert.equal(myId(), 9);
        assert.deepEqual(seatNow(), { base: BASE, room: "ABCDE", key: KEY2 });
    } finally { disconnect(); realTimers(); }
});

test("no_room after a drop (relay restarted): seat cleared, no new socket, no retry loop", () => {
    reset();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1 });
        sockets[0].drop(); fireNext();
        sockets[1].say({ t: "err", reason: "no_room" });
        sockets[1].drop();
        assert.equal(seatNow(), null);
        assert.equal(sockets.length, 2);
        assert.equal(live().length, 0);
        assert.equal(isOnline(), false);
    } finally { disconnect(); realTimers(); }
});

test("second tab: Join sends the saved key; a new-player welcome does not overwrite the first tab's seat", () => {
    reset();
    try {
        store.set(SEAT, JSON.stringify({ base: BASE, room: "ABCDE", key: KEY1 }));
        connect({ base: BASE, room: "abcde" });
        assert.equal(sockets[0].q.get("key"), KEY1);
        welcome(sockets[0], { id: 9, key: KEY2 });                       // the seat was live: a new player, no `resumed`
        assert.deepEqual(seatNow(), { base: BASE, room: "ABCDE", key: KEY1 });
    } finally { disconnect(); realTimers(); }
});

test("seat for another room: not sent", () => {
    reset();
    try {
        store.set(SEAT, JSON.stringify({ base: BASE, room: "ZZZZZ", key: KEY1 }));
        connect({ base: BASE, room: "ABCDE" });
        assert.equal(sockets[0].q.get("key"), null);
        welcome(sockets[0], { key: KEY2 });
        assert.deepEqual(seatNow(), { base: BASE, room: "ABCDE", key: KEY2 }, "a seat for another room is replaced");
    } finally { disconnect(); realTimers(); }
});

test("Leave sends bye, closes, and clears my seat", () => {
    reset();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1 });
        disconnect();
        assert.deepEqual(sockets[0].sent, [{ t: "bye" }]);
        assert.equal(seatNow(), null);
    } finally { realTimers(); }
});

test("Leave in tab two keeps the seat the first tab saved", () => {
    reset();
    try {
        store.set(SEAT, JSON.stringify({ base: BASE, room: "ABCDE", key: KEY1 }));
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { id: 9, key: KEY2 });
        disconnect();
        assert.deepEqual(seatNow(), { base: BASE, room: "ABCDE", key: KEY1 });
    } finally { realTimers(); }
});

test("quiet disconnect (every retry) keeps my id, so GAME's myId() ?? 1 never turns me into player 1", () => {
    reset();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { id: 7, key: KEY1 });
        sockets[0].drop(); fireNext();                                   // connect() ran disconnect(true)
        assert.equal(myId(), 7);
    } finally { disconnect(); realTimers(); }
});

const { peerList, peerOf, peerHere, playingCount } = await import("../web/multiplayer.js");
const seen = () => { const ev = []; const off = mpOn((t, d) => ev.push([t, d])); return { ev, off, names: () => ev.map((e) => e[0]) }; };

test("away and back mark the peer; peerHere hides an away peer; peerList carries away; the count skips away players", () => {
    reset();
    const s = seen();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1, roster: [{ id: 3, name: "Ana", map: "s1", card: null }] });
        assert.equal(playingCount(), 2);
        sockets[0].say({ t: "away", id: 3 });
        assert.equal(peerOf(3).away, true);
        assert.equal(peerHere(3), null);
        assert.equal(peerList().find((p) => p.id === 3).away, true);
        assert.equal(playingCount(), 1);
        assert.ok(s.ev.some((e) => e[0] === "away" && e[1].id === 3));
        sockets[0].say({ t: "back", id: 3 });
        assert.equal(peerHere(3).name, "Ana");
        assert.ok(s.ev.some((e) => e[0] === "back" && e[1].id === 3));
    } finally { s.off(); disconnect(); realTimers(); }
});

test("a roster row with away:true arrives marked away", () => {
    reset();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1, roster: [{ id: 3, name: "Ana", map: null, card: null, away: true }] });
        assert.equal(peerHere(3), null);
        assert.equal(peerOf(3).away, true);
    } finally { disconnect(); realTimers(); }
});

test("a drop emits linklost once, before roster; the resumed welcome emits linkback {resumed:true}", () => {
    reset();
    const s = seen();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1 });
        s.ev.length = 0;
        sockets[0].drop();
        assert.deepEqual(s.names().filter((n) => n === "linklost" || n === "roster"), ["linklost", "roster"]);
        fireNext(); sockets[1].drop();                                   // a failed retry does not say it again
        assert.equal(s.names().filter((n) => n === "linklost").length, 1);
        fireNext();
        welcome(sockets[2], { key: KEY1, resumed: true });
        assert.deepEqual(s.ev.filter((e) => e[0] === "linkback").map((e) => e[1]), [{ resumed: true }]);
    } finally { s.off(); disconnect(); realTimers(); }
});

test("after err gone the new-player welcome emits linkback {resumed:false}", () => {
    reset();
    const s = seen();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1 });
        sockets[0].drop(); fireNext();
        sockets[1].say({ t: "err", reason: "gone" });
        welcome(sockets[2], { id: 9, key: KEY2 });
        assert.deepEqual(s.ev.filter((e) => e[0] === "linkback").map((e) => e[1]), [{ resumed: false }]);
    } finally { s.off(); disconnect(); realTimers(); }
});

test("giving up emits no linkback; Leave never emits linklost", () => {
    reset();
    const s = seen();
    try {
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[0], { key: KEY1 });
        disconnect();
        assert.equal(s.names().includes("linklost"), false);
        connect({ base: BASE, room: "ABCDE" });
        welcome(sockets[1], { key: KEY1 });
        sockets[1].drop();
        while (live().length) { fireNext(); sockets.at(-1).drop(); }
        assert.equal(s.names().includes("linkback"), false);
    } finally { s.off(); disconnect(); realTimers(); }
});

const { rejoinSaved } = await import("../web/multiplayer.js");
import { readFileSync } from "node:fs";

test("page start: no saved seat -> no socket", () => {
    reset();
    try {
        assert.equal(rejoinSaved(() => "Ken"), false);
        assert.equal(sockets.length, 0);
    } finally { disconnect(); realTimers(); }
});

test("page start: one try with the key; a failed try does not retry and does not join as a new player", () => {
    reset();
    try {
        store.set(SEAT, JSON.stringify({ base: BASE, room: "ABCDE", key: KEY1 }));
        assert.equal(rejoinSaved(() => "Ken"), true);
        assert.equal(sockets.length, 1);
        assert.equal(sockets[0].q.get("key"), KEY1);
        assert.equal(sockets[0].q.get("room"), "ABCDE");
        sockets[0].drop();                                               // could not reach the relay
        assert.equal(live().length, 0);
        assert.equal(sockets.length, 1);
        assert.equal(isOnline(), false);
    } finally { disconnect(); realTimers(); }
});

test("page start: err gone clears the seat and stops (no plain join)", () => {
    reset();
    try {
        store.set(SEAT, JSON.stringify({ base: BASE, room: "ABCDE", key: KEY1 }));
        rejoinSaved(() => "Ken");
        sockets[0].say({ t: "err", reason: "gone" });
        assert.equal(seatNow(), null);
        assert.equal(sockets.length, 1);
    } finally { disconnect(); realTimers(); }
});

test("page start: a resumed welcome puts me back; err no_room clears the seat", () => {
    reset();
    try {
        store.set(SEAT, JSON.stringify({ base: BASE, room: "ABCDE", key: KEY1 }));
        rejoinSaved(() => "Ken");
        welcome(sockets[0], { key: KEY1, resumed: true });
        assert.equal(isOnline(), true);
        disconnect();
        store.set(SEAT, JSON.stringify({ base: BASE, room: "ABCDE", key: KEY1 }));
        rejoinSaved(() => "Ken");
        sockets.at(-1).say({ t: "err", reason: "no_room" });
        assert.equal(seatNow(), null);
    } finally { disconnect(); realTimers(); }
});

test("multiplayerTick makes the page-start try once, after installMultiplayer gave it a name source", () => {
    const src = readFileSync(new URL("../web/multiplayer.js", import.meta.url), "utf8");
    const tick = src.slice(src.indexOf("export function multiplayerTick"), src.indexOf("function sendPresence"));
    assert.match(tick, /if \(!mp\.autoTried && mp\.defaultName\) \{ mp\.autoTried = true; rejoinSaved\(mp\.defaultName\); \}/);
    assert.match(src, /mp\.defaultName = defaultName;/);
});
