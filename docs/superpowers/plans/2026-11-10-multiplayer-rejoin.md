# Multiplayer rejoin after a drop: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A player who crashes, closes the tab or loses the network comes back to the same room with the same id, name and place, and to the same fight. Rejoin is always on.

**Architecture:** The relay (`server/room-core.mjs`) keeps a dropped player's seat "away" for 2 minutes under a 128-bit key it made itself; the client (`web/multiplayer.js`) saves `{base, room, key}` in localStorage and sends `key=` when it reconnects. The relay tells rejoin-aware clients `away`/`back` and older clients `leave`/`join`, so older games behave exactly as today. In a fight, the referee pauses (a gate at the top of `nextTurn` and `foeTurn`) while a guest is away, up to 60 s; the pure pause and link rules live in a new `web/mpbattle-pause.js` that node can test.

**Tech Stack:** Plain ES modules (`web/`, `server/`), Node 24 `node --test`, the `ws` package (relay and one test client). No browser, no Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-multiplayer-rejoin-design.md` (approved). Background: `docs/multiplayer-how-it-works.md`. Line numbers below are for the files as they are on branch `integration/all` BEFORE Task 1 (`MP` = `web/multiplayer.js`, `ROOM` = `server/room-core.mjs`, `RELAY` = `server/relay.mjs`, `BAT` = `web/mpbattle.js`, `SOC` = `web/mpsocial.js`, `GAME` = `web/game.js`). They shift as tasks land; every edit below is anchored on exact text, not on the number alone.

Repo: `/home/dorij/dw2003-play-integration` (WSL). Run one test file like this (quote the PATH, it contains spaces):

```
wsl.exe -d Ubuntu -- bash -lc 'cd ~/dw2003-play-integration && PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" node --test tests/FILE.test.js'
```

## Global Constraints

- **Rejoin is ALWAYS ON.** No OPTIONS row, no `mprejoin` key, no ship-list entry, no F2 switch, no URL flag. `tests/options-model.test.js` is not touched.
- **Older clients (no `rj`, no `key`) behave exactly as today**: no seat kept, `leave` and `join` instead of `away` and `back`, welcome roster without away seats, no `key`/`resumed`/`at` in their welcome, 30 s ping rhythm.
- Seat kept **2 min** (`AWAY_MS = 120000`). Relay ping **5 s** for sockets that sent `rj=1` or `key=` (checked every beat), **30 s** for the others (every 6th beat).
- Client retry wait `1500 * 2 ** mp.retry++`, **5 tries** (1.5, 3, 6, 12, 24 s).
- Fight pause **60 s** (`AWAY_MS` in `web/mpbattle-pause.js`); a returned guest waits **10 s** for a `st` (`BACK_WAIT_MS`).
- Seat key: **128-bit hex (32 chars) made by the relay** (`makeKey`, `globalThis.crypto.getRandomValues`), sent in `welcome`. Client storage: localStorage key `dw.mp.seat`, value `{ base, room, key }`.
- Play-code repo only (`~/dw2003-play-integration`). This is a multiplayer feature, not a disc-faithful fix, so the two-repo rule does not apply.
- **No commits** (the user commits). Every task ends with "Stop - no commit". Report changed files with `git status --short` limited to the files the task names.
- No browser, no Playwright, no Chrome, no pictures. Node tests only. Run only the test files the task touches, never the full suite.
- **Never touch `launcher/`, the installer, `packaging/`, `build_all.py`, or CI files.** Another session is working there; `git status` already shows changes in those places that are not yours.
- Public repo: no disc-derived data. Nothing in this plan carries any.

## Not known yet (the builder reads these first, nobody guesses)

- Whether the game can put a player back on the saved spot after a page reload: the relay sends `welcome.at` (Task 2) but this plan does not use it on the client. Builder reads the save/load code before anyone adds that.
- Whether a background browser tab answers WebSocket pings within 5 s: not measured; no step depends on it.
- Whether the on-screen fight wiring (DOM, WebGL) works: `web/mpbattle.js` loads in node (checked: `import("./web/mpbattle.js")` resolves) but `begin()` needs a DOM and a scene, so only source-text checks and the pure module can be proven here.
- When the first `multiplayerTick` call happens (GAME:11071 sits in the field draw path) and whether `state.playerName` is set by then: Task 7 builder reads GAME around 11071 and the `installMultiplayer` call (GAME:504) before wiring the page-start try.
- What a duel in progress shows when the other side goes away: Task 11 treats away like gone at SOC:311 and the roster branch; the on-screen text is not proven.

## Review Focus (inputs the tests could miss)

1. **Two tabs, one key.** Hub: a key for a live seat joins as a new player with a new id and key, the first tab keeps its seat, then gets it back after dropping (Task 2 test `two tabs`). Client: the second tab must not overwrite the saved seat, and its Leave must not erase the first tab's seat (Task 5 tests `second tab` and `Leave in tab two`).
2. **A key for another room.** Hub: the same key offered to another room is `err gone` (Task 2). Client: a saved seat whose room differs from the room being joined is not sent (Task 5 test `seat for another room`).
3. **Relay restart.** Keys are dead: `no_room`. Client clears the seat and does not loop (Task 5 test `no_room after a drop`); a fight ends through the guest's 60 s timer (Task 8 `createLink` tests).
4. **Drop during an enemy action.** `later(700, foeTurn)` can land after the guest went away: the `foe` gate parks it without touching the Arena, and releasing runs it exactly once (Task 8 test with the real `Arena`).
5. **Older referee.** An older game ignores `mpb {k:"back"}`: the guest's 10 s wait must end the fight cleanly (Task 8 `createLink` test `reconnected waits 10 s`, Task 10 wiring). Also: `myId()` must not turn into `null` (GAME:517 turns that into `1`) while a retry is connecting (Task 5 test `quiet disconnect keeps my id`).

## Added beyond the spec (found while reading the code; tell the user)

- **`bye` message.** A normal close (Leave pressed) and a drop look the same to the relay, so without a signal a player who pressed Leave would stay "away" for 2 min. The client sends `{t:"bye"}` before it closes on Leave; the relay then removes the seat at once (Task 2, Task 5). An older relay drops the unknown message silently.
- **Host with everyone away.** If the host drops while every other player is also away, the role cannot pass at once. The host id stays; the first seat that returns takes the role (Task 2 `#resume`). Otherwise the room would have a host who is not there.
- **Quiet disconnect keeps `mp.id`/`mp.room`/`mp.hostId`** (Task 5), because `connect()` calls `disconnect(true)` for every retry and GAME:517 maps a `null` id to `1`.
- **`pingMs` option** of `startRelay` (default `PING_MS = 5000`) so the ping test runs in about a second.
- Give-up also clears `mp.hadWelcome` (Task 1) so a later fresh Join does not inherit the retry rule.
- The fight constants `AWAY_MS` and `BACK_WAIT_MS` are exported from `web/mpbattle-pause.js`, not defined in `web/mpbattle.js`.
- My own turn stays usable while someone else is away (the pause only stops the NEXT action), so a drop never costs another player their turn; the "Waiting for ..." text shows when it is not my turn.

---

## Task 1: Retry bug fix (`mp.hadWelcome`)

**Files:**
- Modify: `web/multiplayer.js` (MP:36-44 `mp` object; MP:98 `let gotWelcome`; MP:102 welcome; MP:111-113 err; MP:158-167 `onclose`; MP:191-199 `disconnect`)
- Create: `tests/multiplayer-rejoin-client.test.js`

**Interfaces:**
- Consumes: `connect(want)`, `disconnect(quiet)`, `mpOn` from `web/multiplayer.js` (already exported).
- Produces: `mp.hadWelcome` (boolean on the shared `mp` object, true once this link has been in a room, cleared by `disconnect(false)`, by any `err`, and when retries give up). Later tasks read it.

- [ ] **Step 1: Create the test file with the fake browser and the failing retry test**

`web/multiplayer.js` loads in node (checked). It touches `document`/`window` only in `installMultiplayer`, which these tests never call. It needs a `WebSocket`, `localStorage` and timers, faked here.

```js
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
```

- [ ] **Step 2: Run it, expect FAIL**

Run the command at the top with `tests/multiplayer-rejoin-client.test.js`. Expected: the first test FAILS (`waits` is `[1500]`, 2 sockets: the bug, `gotWelcome` is per `connect()`). The second test passes before the fix (it guards the fix).

- [ ] **Step 3: Minimal code in `web/multiplayer.js`**

1. Replace `    retry: 0, retryTimer: 0, want: null, beat: 0,` with
   `    retry: 0, retryTimer: 0, want: null, beat: 0, hadWelcome: false,   // hadWelcome: this link has been in a room (one flag for every retry: connect() runs again for each)`
2. Delete the line `    let gotWelcome = false;` (MP:98).
3. Replace `            gotWelcome = true; mp.retry = 0;` with `            mp.hadWelcome = true; mp.retry = 0;`
4. Replace
   ```js
        } else if (m.t === "err") {
            mp.want = null;
   ```
   with
   ```js
        } else if (m.t === "err") {
            mp.hadWelcome = false;
            mp.want = null;
   ```
5. Replace the two `gotWelcome` reads in `ws.onclose`:
   ```js
        if (mp.want && gotWelcome && mp.retry < 5) {
   ```
   with `        if (mp.want && mp.hadWelcome && mp.retry < 5) {` and replace
   ```js
        } else if (mp.status !== "off") setStatus("off", gotWelcome ? "Connection lost." : "Could not reach your friend. Check the address, that you are on the same Hamachi / Tailscale network, and that their game is still hosting.");
   ```
   with
   ```js
        } else if (mp.status !== "off") {
            const had = mp.hadWelcome; mp.hadWelcome = false;             // giving up: the next fresh connect starts clean
            setStatus("off", had ? "Connection lost." : "Could not reach your friend. Check the address, that you are on the same Hamachi / Tailscale network, and that their game is still hosting.");
        }
   ```
6. In `disconnect`, replace `    if (!quiet) mp.hosting = false;` with `    if (!quiet) { mp.hosting = false; mp.hadWelcome = false; }`.

- [ ] **Step 4: Run it, expect PASS** (both tests).

- [ ] **Step 5: Stop - no commit.** Changed files: `web/multiplayer.js`, `tests/multiplayer-rejoin-client.test.js`.

---

## Task 2: Relay seat keeping (key, welcome, resumed, away/back, sweep, bye)

**Files:**
- Modify: `server/room-core.mjs` (header comment ROOM:1-27; constructor ROOM:80-88; `open` ROOM:91-126; `#close` ROOM:135-155; `#message` ROOM:157-169)
- Modify: `server/relay.mjs` (RELAY:56 only; the ping rhythm is Task 4)
- Create: `tests/multiplayer-rejoin-room.test.js`, `tests/multiplayer-rejoin-relay.test.js`

**Interfaces:**
- Consumes: `Hub`, `cleanCode`, `cleanName`, `LIMIT`, `packLeague`, `forfeit`, `nextPairing` (already in `room-core.mjs`).
- Produces: `Hub.open(send, { room, create, name, rj, key })` returning `{ session }` or `{ error }` where error may now be `"gone"`; exports `AWAY_MS`, `makeKey`; `Hub.sweep()`; constructor options `awayMs`, `keyGen`; peer fields `rj, key, away, awayAt, gen, bye`; messages relay to client `welcome {id, room, host, roster, key?, resumed?, at?}`, `away {id}`, `back {id}`, `err {reason:"gone"}`; client to relay `bye`.

- [ ] **Step 1: Write the failing Hub tests** in `tests/multiplayer-rejoin-room.test.js`

```js
// Rejoin in the relay's room logic (server/room-core.mjs): a seat kept away for 2 minutes under a key the relay made.
import test from "node:test";
import assert from "node:assert/strict";
import { Hub, AWAY_MS } from "../server/room-core.mjs";

function client(hub, opts) {
    const got = [];
    const r = hub.open((s) => got.push(JSON.parse(s)), opts);
    return { got, ...r, last: (t) => got.filter((m) => m.t === t).at(-1), all: (t) => got.filter((m) => m.t === t) };
}
const send = (c, o) => c.session.onMessage(JSON.stringify(o));
const KEY = /^[0-9a-f]{32}$/;
function room(extra = {}) {
    let t = 1000;
    const clock = { now: () => t, advance: (ms) => { t += ms; } };
    const hub = new Hub({ now: clock.now, ...extra });
    const a = client(hub, { create: true, name: "Ken", rj: true });
    return { hub, a, code: a.last("welcome").room, clock };
}

test("a rj=1 player (host too) gets a 128-bit hex key in welcome; a plain client gets none", () => {
    const { hub, a, code } = room();
    assert.match(a.last("welcome").key, KEY);
    const b = client(hub, { room: code, name: "Ana" });
    assert.equal("key" in b.last("welcome"), false);
});

test("a dropped rj player is kept away and the key gives the same id, name and place back", () => {
    const { hub, a, code } = room();
    const b = client(hub, { room: code, name: "Ana", rj: true });
    const key = b.last("welcome").key, id = b.session.id;
    send(b, { t: "pos", map: "s330", x: 100, y: 200, dir: "left", mv: 0 });
    b.session.onClose();
    assert.deepEqual(a.last("away"), { t: "away", id });
    assert.equal(a.all("leave").length, 0);
    const b2 = client(hub, { room: code, name: "Other", key });
    const w = b2.last("welcome");
    assert.equal(b2.session.id, id);
    assert.equal(w.id, id);
    assert.equal(w.resumed, true);
    assert.equal(w.key, key);
    assert.deepEqual(w.at, { map: "s330", x: 100, y: 200, dir: "left" });
    assert.deepEqual(w.roster, [{ id: a.session.id, name: "Ken", map: null, card: null }]);
    assert.deepEqual(a.last("back"), { t: "back", id });
    assert.equal(hub.rooms.get(code).peers.get(id).name, "Ana", "the name in the URL is ignored on a return");
});

test("a key the room does not know is err gone; a missing room stays no_room; a key from another room is gone", () => {
    const { hub, code } = room();
    const b = client(hub, { room: code, rj: true });
    const key = b.last("welcome").key;
    const other = client(hub, { create: true, rj: true });
    const code2 = other.last("welcome").room;
    assert.equal(client(hub, { room: code, key: "0".repeat(32) }).error, "gone");
    assert.equal(client(hub, { room: code, key: "not-a-key" }).error, "gone");
    assert.equal(client(hub, { room: "ZZZZZ", key }).error, "no_room");
    assert.equal(client(hub, { room: code2, key }).error, "gone");
});

test("two tabs: a key for a live seat joins as a new player and never takes the seat; after the first drops the key works", () => {
    const { hub, code } = room();
    const b = client(hub, { room: code, name: "Ana", rj: true });
    const key = b.last("welcome").key;
    const b2 = client(hub, { room: code, name: "Ana", key });
    const w2 = b2.last("welcome");
    assert.notEqual(w2.id, b.session.id);
    assert.notEqual(w2.key, key);
    assert.equal("resumed" in w2, false);
    assert.equal(hub.rooms.get(code).peers.get(b.session.id).away, false, "the first tab keeps its seat");
    assert.equal(hub.rooms.get(code).peers.size, 3);
    b.session.onClose();
    const b3 = client(hub, { room: code, key });
    assert.equal(b3.last("welcome").id, b.session.id);
    assert.equal(b3.last("welcome").resumed, true);
});

test("a seat expires after AWAY_MS: sweep removes it, the others hear leave, the key is gone, the room ends when only dead seats are left", () => {
    const { hub, a, code, clock } = room();
    const b = client(hub, { room: code, rj: true });
    const key = b.last("welcome").key, id = b.session.id;
    b.session.onClose();
    clock.advance(AWAY_MS - 1000); hub.sweep();
    assert.equal(a.all("leave").length, 0);
    clock.advance(1000); hub.sweep();
    assert.deepEqual(a.last("leave"), { t: "leave", id });
    assert.equal(client(hub, { room: code, key }).error, "gone");
    a.session.onClose();                                       // the last seat goes away: the room stays
    assert.equal(hub.rooms.size, 1);
    clock.advance(AWAY_MS); hub.sweep();
    assert.equal(hub.rooms.size, 0);
});

test("a superseded socket closing again does not drop the returned player", () => {
    const { hub, code } = room();
    const b = client(hub, { room: code, rj: true });
    const key = b.last("welcome").key, id = b.session.id;
    b.session.onClose();
    client(hub, { room: code, key });
    b.session.onClose();                                       // the old socket reports its close a second time
    assert.equal(hub.rooms.get(code).peers.get(id).away, false);
});

test("bye frees the seat at once: the others hear leave, the key is gone", () => {
    const { hub, a, code } = room();
    const b = client(hub, { room: code, rj: true });
    const key = b.last("welcome").key, id = b.session.id;
    send(b, { t: "bye" });
    b.session.onClose();
    assert.deepEqual(a.last("leave"), { t: "leave", id });
    assert.equal(client(hub, { room: code, key }).error, "gone");
});

test("the host goes away: the next present player becomes host; the returning host is a normal member", () => {
    const { hub, a, code } = room();
    const b = client(hub, { room: code, name: "Ana", rj: true });
    const bid = b.session.id, akey = a.last("welcome").key;
    a.session.onClose();
    assert.deepEqual(b.last("host"), { t: "host", id: bid });
    const a2 = client(hub, { room: code, key: akey });
    assert.equal(a2.last("welcome").host, bid);
    assert.equal(hub.rooms.get(code).host, bid);
});

test("everyone away: the first seat to return runs the room, the later ones are normal members", () => {
    const { hub, a, code } = room();
    const b = client(hub, { room: code, name: "Ana", rj: true });
    const aid = a.session.id, akey = a.last("welcome").key, bkey = b.last("welcome").key;
    a.session.onClose();                                       // host passes to b
    b.session.onClose();                                       // b is host and nobody else is present
    const a2 = client(hub, { room: code, key: akey });
    assert.equal(a2.last("welcome").host, aid);
    const b2 = client(hub, { room: code, key: bkey });
    assert.equal(b2.last("welcome").host, aid);
});

test("an open trade ends with reason away for the other player", () => {
    const { hub, a, code } = room();
    const b = client(hub, { room: code, rj: true });
    send(a, { t: "trade", op: "ask", to: b.session.id });
    send(b, { t: "trade", op: "yes" });
    b.session.onClose();
    assert.deepEqual(a.last("trade"), { t: "trade", op: "end", reason: "away" });
});

test("an away seat counts for the room's size, and its own return is never refused as full", () => {
    const { hub, code } = room({ maxPeers: 2 });
    const b = client(hub, { room: code, rj: true });
    const key = b.last("welcome").key;
    b.session.onClose();
    assert.equal(client(hub, { room: code, name: "Cy" }).error, "full");
    assert.equal(client(hub, { room: code, key }).last("welcome").resumed, true);
});
```

Real-socket test (spec test a) in `tests/multiplayer-rejoin-relay.test.js`:

```js
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
```

- [ ] **Step 2: Run both, expect FAIL**

`tests/multiplayer-rejoin-room.test.js` and `tests/multiplayer-rejoin-relay.test.js`. Expected: `AWAY_MS` is not exported, so the room file fails at import; the relay test fails (no `key` in welcome, no `away`).

- [ ] **Step 3: Minimal code in `server/room-core.mjs`**

3a. Header comment: in the list of client messages (after the `{t:"ping"}` line, ROOM:19) add
`//   {t:"bye"}                     I am leaving for good (the Leave button): my seat is freed at once, not kept`
and change the connect paragraph (ROOM:7-8) by adding after "joins one.":
`// Add `&rj=1` to say "I know about seats" (every current game does): the relay then keeps a dropped player's seat "away" for AWAY_MS and sends `key` in `welcome`; `&key=...` takes that seat back (same id, name, place). Older games send neither and are treated exactly as before.`
and in the "receives" list (after the `welcome` line, ROOM:21) add
`//   welcome also carries key (rj only), and for a returning seat resumed:true and at:{map,x,y,dir}; roster entries of away seats carry away:true`
`//   {t:"away", id} / {t:"back", id}   a rj player's seat went away / came back (older games get leave / join instead)`
and change the err line to `reasons: no_room, full, exists, busy, bad, gone (the key is not a seat of this room, or it expired)`.

3b. After the `CARD_MAX` constants (ROOM:40) add:

```js
export const AWAY_MS = 120000;       // how long a dropped rejoin-aware player's seat is kept (id, name, place, card)
const KEY_RE = /^[0-9a-f]{32}$/;
const NOOP = () => {};

/** A seat key: 128 random bits from the platform's secure generator (never Math.random), 32 hex characters. The relay makes it; a client cannot choose it. */
export function makeKey() {
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
```

3c. Replace everything from `export class Hub {` through the end of `#close` (ROOM:80-155) with the following. The block already contains `#to` and `#others` (ROOM:128-133) unchanged; `#message` (ROOM:157) follows it and is edited in 3d.

```js
export class Hub {
    constructor({ rand = Math.random, now = () => Date.now(), maxPeers = MAX_PEERS, awayMs = AWAY_MS, keyGen = makeKey } = {}) {
        this.rand = rand;
        this.now = now;
        this.maxPeers = maxPeers;
        this.awayMs = awayMs;
        this.keyGen = keyGen;
        this.rooms = new Map();      // code -> { peers: Map(id -> peer), host, league, pair }; an away seat stays in `peers` with away = true
        this.trades = new Map();     // peer id -> its open trade (both players point at the same object)
        this.nextId = 1;
    }

    /** Connect a client. `send(string)` delivers to it. `rj` = it knows about seats; `key` = it wants its old seat back. Returns { session } or { error }. */
    open(send, { room, create, name, rj = false, key = null } = {}) {
        const aware = !!rj || !!key;                     // every current game; an older game sends neither and is treated as before
        let code, seat = null;
        if (create) {
            if (this.rooms.size >= MAX_ROOMS) return { error: "busy" };
            code = room ? cleanCode(room) : null;
            if (room && !code) return { error: "bad" };
            if (!code) {
                for (let i = 0; i < 20 && (!code || this.rooms.has(code)); i++) code = makeCode(this.rand);
            }
            if (this.rooms.has(code)) return { error: "exists" };
            this.rooms.set(code, { peers: new Map(), host: null, league: null, pair: null });
        } else {
            code = cleanCode(room);
            if (!code) return { error: "bad" };
            const known = this.rooms.get(code);
            if (!known) return { error: "no_room" };
            if (key) {
                seat = KEY_RE.test(key) ? ([...known.peers.values()].find((p) => p.key === key) ?? null) : null;
                if (!seat) return { error: "gone" };        // not a seat of THIS room, or it expired
                if (!seat.away) seat = null;                // still live (a second tab): no take-over, join as a new player below
            }
            if (!seat && known.peers.size >= this.maxPeers) return { error: "full" };
        }
        const r = this.rooms.get(code);
        if (seat) return this.#resume(code, r, seat, send);
        const peer = {
            id: this.nextId++, name: cleanName(name), send, map: null, x: 0, y: 0, dir: "down", mv: 0,
            card: null, lastChat: 0, tokens: LIMIT * 2, last: this.now(),
            rj: aware, key: aware ? this.keyGen() : null, away: false, awayAt: 0, gen: 0, bye: false,
        };
        const roster = [...r.peers.values()].map((p) => this.#entry(p));
        r.peers.set(peer.id, peer);
        if (r.host == null) r.host = peer.id;               // whoever made the room runs its Server Champ nights
        this.#to(peer, { t: "welcome", id: peer.id, room: code, host: r.host, roster, ...(aware ? { key: peer.key } : {}) });
        if (r.league) this.#to(peer, { t: "lg", op: "state", host: r.host, ev: null, pair: r.pair, lg: packLeague(r.league) });   // join mid-night: see the bracket
        for (const o of r.peers.values()) if (o !== peer) this.#to(o, { t: "join", id: peer.id, name: peer.name });
        return { session: this.#session(code, peer) };
    }

    /** One roster row. Only an away seat carries `away`, so a plain roster has the same shape as before. */
    #entry(p) {
        return p.away ? { id: p.id, name: p.name, map: p.map, card: p.card, away: true } : { id: p.id, name: p.name, map: p.map, card: p.card };
    }

    /** The handle a socket gets. A close or message from a socket that has since been replaced by a return (gen moved on) is ignored. */
    #session(code, peer) {
        const gen = peer.gen;
        return {
            id: peer.id, room: code,
            onMessage: (raw) => { if (peer.gen === gen) this.#message(code, peer, raw); },
            onClose: () => { if (peer.gen === gen) this.#close(code, peer); },
        };
    }

    /** A returning seat: same id, name, card and place. The name in the URL is ignored. */
    #resume(code, r, peer, send) {
        peer.send = send; peer.gen++; peer.away = false; peer.awayAt = 0;
        peer.tokens = LIMIT * 2; peer.last = this.now();
        const roster = [...r.peers.values()].filter((p) => p !== peer).map((p) => this.#entry(p));
        const cur = r.peers.get(r.host);
        const takeHost = r.host !== peer.id && (!cur || cur.away);   // every present player left while the host was away: the first to return runs the room
        if (takeHost) r.host = peer.id;
        this.#to(peer, { t: "welcome", id: peer.id, room: code, host: r.host, roster, key: peer.key, resumed: true, at: { map: peer.map, x: peer.x, y: peer.y, dir: peer.dir } });
        if (r.league) this.#to(peer, { t: "lg", op: "state", host: r.host, ev: null, pair: r.pair, lg: packLeague(r.league) });
        for (const o of r.peers.values()) if (o !== peer) this.#to(o, { t: "back", id: peer.id });
        if (takeHost) for (const o of r.peers.values()) if (o !== peer) this.#to(o, { t: "host", id: r.host });
        this.#show(r, peer);
        return { session: this.#session(code, peer) };
    }

    /** Tell the room where a returning player stands: the same fan-out as walking into a stage (#pos). */
    #show(r, peer) {
        if (!peer.map) return;
        this.#others(r, peer, { t: "at", id: peer.id, map: peer.map });
        const msg = { t: "pos", id: peer.id, map: peer.map, x: peer.x, y: peer.y, dir: peer.dir, mv: 0 };
        for (const o of r.peers.values()) {
            if (o === peer || o.away || o.map !== peer.map) continue;
            this.#to(o, msg);
            this.#to(peer, { t: "pos", id: o.id, map: o.map, x: o.x, y: o.y, dir: o.dir, mv: o.mv });
        }
    }

    #to(peer, obj) {
        if (!peer) return;
        try { peer.send(JSON.stringify(obj)); } catch { /* the socket is already going away */ }
    }

    #others(r, peer, msg) { for (const o of r.peers.values()) if (o !== peer) this.#to(o, msg); }

    #close(code, peer) {
        const r = this.rooms.get(code);
        if (!r || !r.peers.has(peer.id) || peer.away) return;
        if (peer.rj && !peer.bye) { this.#away(r, peer); return; }   // a drop keeps the seat; "bye" (Leave) does not
        this.#remove(code, r, peer);
    }

    /** The old removal, unchanged: the player is gone for good. */
    #remove(code, r, peer) {
        r.peers.delete(peer.id);
        this.#endTrade(r, peer, "left");
        for (const o of r.peers.values()) this.#to(o, { t: "leave", id: peer.id });
        if (!r.peers.size) { this.rooms.delete(code); return; }   // the room and its Server Champ night are gone
        this.#dropFromNight(r, peer);
    }

    /** A rj player's socket closed: keep the seat for awayMs. Id, name, map, x, y, dir and card stay. */
    #away(r, peer) {
        peer.away = true; peer.awayAt = this.now(); peer.send = NOOP;
        this.#endTrade(r, peer, "away");              // the client shows "ended the trade." for a reason it has no text for
        for (const o of r.peers.values()) if (o !== peer) this.#to(o, { t: "away", id: peer.id });
        this.#dropFromNight(r, peer);
    }

    /** Host role and Server Champ night when `peer` is gone or away (the rules of the old #close, unchanged). */
    #dropFromNight(r, peer) {
        if (r.host === peer.id) {
            // only the host can run a night, so theirs ends here; the next present tamer can open a new one
            const next = [...r.peers.values()].find((p) => p !== peer && !p.away);
            const had = r.league != null;
            r.league = null; r.pair = null;
            if (!next) return;                        // everyone else is away too: the first to return takes the role (#resume)
            r.host = next.id;
            if (had) this.#league(r, { k: "closed" });
            for (const o of r.peers.values()) this.#to(o, { t: "host", id: r.host });
        } else if (r.league && r.league.ids.includes(peer.id) && !r.league.dropped.includes(peer.id)) {
            // a tamer who disconnects mid-night counts as a loss for that fight and leaves the night (no re-entry)
            const res = forfeit(r.league, peer.id);
            if (res.ok) {
                r.pair = nextPairing(r.league);
                this.#league(r, { k: "drop", id: peer.id, w: res.to ?? undefined });
            }
        }
    }

    /** Remove every away seat older than awayMs. The relay calls this on every heartbeat. */
    sweep() {
        const t = this.now();
        for (const [code, r] of [...this.rooms]) {
            for (const p of [...r.peers.values()]) {
                if (!p.away || t - p.awayAt < this.awayMs) continue;
                r.peers.delete(p.id);
                for (const o of r.peers.values()) this.#to(o, { t: "leave", id: p.id });
            }
            if (!r.peers.size) this.rooms.delete(code);
        }
    }
```

3d. In `#message`, replace
```js
        if (!r || typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
```
with `        if (!r || peer.away || typeof raw !== "string" || raw.length > MAX_MESSAGE) return;`
and replace `        if (m.t === "ping") return this.#to(peer, { t: "pong" });` with
```js
        if (m.t === "bye") { peer.bye = true; return; }   // the Leave button: my close is not a drop
        if (m.t === "ping") return this.#to(peer, { t: "pong" });
```
(In this task `sweep` sends `leave` to everyone; Task 3 narrows it to rejoin-aware peers together with the other older-client rules.)

3e. `server/relay.mjs` line 56: replace
```js
        const r = hub.open(sendRaw, { room: q.get("room"), create: q.get("create") === "1", name: q.get("name") });
```
with
```js
        const r = hub.open(sendRaw, { room: q.get("room"), create: q.get("create") === "1", name: q.get("name"), rj: q.get("rj") === "1", key: q.get("key") });
```

- [ ] **Step 4: Run both new test files, then the three existing relay-side files the change touches, expect PASS**

`tests/multiplayer-rejoin-room.test.js`, `tests/multiplayer-rejoin-relay.test.js`, `tests/multiplayer-room.test.js`, `tests/multiplayer-social.test.js`, `tests/multiplayer-relay.test.js` (the last three prove older clients are unchanged: spec test f). Expected: all pass.

- [ ] **Step 5: Stop - no commit.** Changed: `server/room-core.mjs`, `server/relay.mjs`, the two new test files.

---

## Task 3: Older clients unchanged (leave/join), roster rule, guards on away seats

**Files:**
- Modify: `server/room-core.mjs` (`open` roster line; `#away`; `#resume`; `sweep`; `#direct`, `#coop`, `#mpb`, `#trade` ask, `#lg` open)
- Modify: `tests/multiplayer-rejoin-room.test.js` (append)

**Interfaces:**
- Consumes: Task 2 peer fields (`rj`, `away`).
- Produces: older sockets (peer.rj false) get `leave {id}` when a seat goes away and `join {id,name}` (+ `at`, `card`) when it returns, never `away`/`back`, never an away seat in their welcome roster; sends to an away seat are dropped (trade ask answers `end gone`; league `open` refuses it with `why:"ids"`).

- [ ] **Step 1: Append the failing tests**

```js
test("older clients (no rj, no key) see leave then join, never away or back, and no second leave from the sweep", () => {
    const { hub, a, code, clock } = room();
    const b = client(hub, { room: code, name: "Ana", rj: true });
    const key = b.last("welcome").key, id = b.session.id;
    send(b, { t: "pos", map: "s330", x: 1, y: 2, dir: "down", mv: 0 });
    send(b, { t: "card", card: { lv: 5 } });
    const old = client(hub, { room: code, name: "Old" });
    b.session.onClose();
    assert.deepEqual(old.last("leave"), { t: "leave", id });
    assert.equal(old.all("away").length, 0);
    const b2 = client(hub, { room: code, key });
    assert.deepEqual(old.last("join"), { t: "join", id, name: "Ana" });
    assert.deepEqual(old.last("at"), { t: "at", id, map: "s330" });
    assert.deepEqual(old.last("card"), { t: "card", id, card: { lv: 5 } });
    assert.equal(old.all("back").length, 0);
    assert.equal(a.all("away").length, 1, "the rj client still gets away");
    b2.session.onClose();                                      // away again
    assert.equal(old.all("leave").length, 2);
    clock.advance(AWAY_MS); hub.sweep();
    assert.equal(old.all("leave").length, 2, "the sweep sends no second leave to an older client");
    assert.deepEqual(a.last("leave"), { t: "leave", id }, "the rj client hears the final leave");
});

test("welcome to an older joiner leaves out away seats; a rj joiner sees them with away:true", () => {
    const { hub, code } = room();
    const b = client(hub, { room: code, name: "Ana", rj: true });
    b.session.onClose();
    const old = client(hub, { room: code, name: "Old" });
    assert.deepEqual(old.last("welcome").roster.map((p) => p.name), ["Ken"]);
    const fresh = client(hub, { room: code, name: "Cy", rj: true });
    const row = fresh.last("welcome").roster.find((p) => p.name === "Ana");
    assert.equal(row.away, true);
    assert.equal("away" in fresh.last("welcome").roster.find((p) => p.name === "Ken"), false);
});

test("messages aimed at an away seat are dropped; a trade ask answers gone; a night cannot include it", () => {
    const { hub, a, code } = room();
    const b = client(hub, { room: code, rj: true });
    const bid = b.session.id;
    b.session.onClose();
    const before = a.got.length;
    send(a, { t: "trade", op: "ask", to: bid });
    assert.deepEqual(a.last("trade"), { t: "trade", op: "end", reason: "gone" });
    send(a, { t: "duel", op: "ask", to: bid });
    send(a, { t: "coop", op: "pask", to: bid });
    send(a, { t: "mpb", to: [bid], d: { k: "st" } });
    assert.equal(a.got.length, before + 1, "only the trade answer came back");
    assert.equal(hub.trades.size, 0);
    send(a, { t: "lg", op: "open", ids: [a.session.id, bid] });
    assert.deepEqual(a.last("lg"), { t: "lg", op: "no", why: "ids" });
});
```
- [ ] **Step 2: Run `tests/multiplayer-rejoin-room.test.js`, expect FAIL** (older client gets `away`; roster includes the away seat; trade ask answers `busy`/nothing; league accepts the id).

- [ ] **Step 3: Minimal code in `server/room-core.mjs`**

1. `open`: replace `        const roster = [...r.peers.values()].map((p) => this.#entry(p));` with
   `        const roster = [...r.peers.values()].filter((p) => aware || !p.away).map((p) => this.#entry(p));   // an older client never hears about an away seat (as if it had left)`
2. `#away`: replace the loop line with
   `        for (const o of r.peers.values()) if (o !== peer) this.#to(o, o.rj ? { t: "away", id: peer.id } : { t: "leave", id: peer.id });`
3. `#resume`: replace the `back` loop line with
   ```js
        for (const o of r.peers.values()) {
            if (o === peer) continue;
            if (o.rj) this.#to(o, { t: "back", id: peer.id });
            else { this.#to(o, { t: "join", id: peer.id, name: peer.name }); if (peer.card) this.#to(o, { t: "card", id: peer.id, card: peer.card }); }
        }
   ```
4. `sweep`: replace the inner loop line `for (const o of r.peers.values()) this.#to(o, { t: "leave", id: p.id });` with
   `                for (const o of r.peers.values()) if (o.rj) this.#to(o, { t: "leave", id: p.id });   // older clients got their leave when the seat went away`
5. `#direct`: replace `        if (!to || to === peer || !ops.has(m.op)) return;` with `        if (!to || to === peer || to.away || !ops.has(m.op)) return;`
6. `#coop`: replace `        if (!to || to === peer || !COOP_OPS.has(m.op)) return;` with `        if (!to || to === peer || to.away || !COOP_OPS.has(m.op)) return;`
7. `#mpb`: replace `            if (to && to !== peer) this.#to(to, { t: "mpb", from: peer.id, d: m.d });` with `            if (to && to !== peer && !to.away) this.#to(to, { t: "mpb", from: peer.id, d: m.d });`
8. `#trade` ask: replace
   ```js
            if (!to || to === peer || tr || this.trades.has(to.id)) return this.#to(peer, { t: "trade", op: "end", reason: to ? "busy" : "gone" });
   ```
   with
   ```js
            if (!to || to.away || to === peer || tr || this.trades.has(to.id)) return this.#to(peer, { t: "trade", op: "end", reason: to && !to.away ? "busy" : "gone" });
   ```
9. `#lg` open: replace `                || !ids.every((id) => Number.isInteger(id) && r.peers.has(id))) return no("ids");` with
   `                || !ids.every((id) => Number.isInteger(id) && r.peers.has(id) && !r.peers.get(id).away)) return no("ids");`

- [ ] **Step 4: Run, expect PASS:** `tests/multiplayer-rejoin-room.test.js`, `tests/multiplayer-rejoin-relay.test.js`, `tests/multiplayer-room.test.js`, `tests/multiplayer-social.test.js`, `tests/multiplayer-relay.test.js`, `tests/mp-league.test.js` (touches `#lg`).

- [ ] **Step 5: Stop - no commit.** Note for the final report: `maxPeers` counts away seats (spec 2.5 "one honest difference"); the test `an away seat counts for the room's size` from Task 2 already pins it.

---

## Task 4: 5 s ping for rejoin-aware sockets, sweep on the beat

**Files:**
- Modify: `server/relay.mjs` (RELAY:33 signature, RELAY:58-59, RELAY:70-76)
- Create: `tests/multiplayer-rejoin-ping.test.js`

**Interfaces:**
- Consumes: `Hub.sweep()` (Task 2); the `ws` package (client side in the test).
- Produces: `export const PING_MS = 5000`; `startRelay({ port, host, hub, pingMs })`; `ws.fast` on sockets that sent `rj=1` or `key=`.

- [ ] **Step 1: Failing test** `tests/multiplayer-rejoin-ping.test.js`

```js
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
```

- [ ] **Step 2: Run, expect FAIL** (`PING_MS` not exported; with `pingMs` unknown the relay beats at 30 s so `away` never comes in time).

- [ ] **Step 3: Minimal code in `server/relay.mjs`**

1. After `const PER_IP = 12; ...` add
   ```js
export const PING_MS = 5000;             // the heartbeat; sockets that sent rj=1 or key= are checked every beat (found in 5 to 10 s), the others every 6th (30 s, as before)
const SLOW_EVERY = 6;
   ```
2. Signature: replace `export function startRelay({ port = 20031, host = "0.0.0.0", hub = new Hub({ maxPeers: Number(process.env.MP_MAX) || undefined }) } = {}) {` with
   `export function startRelay({ port = 20031, host = "0.0.0.0", hub = new Hub({ maxPeers: Number(process.env.MP_MAX) || undefined }), pingMs = PING_MS } = {}) {`
3. After `ws.isAlive = true;` add `        ws.fast = q.get("rj") === "1" || !!q.get("key");   // rejoin-aware: the fast rhythm`
4. Replace the `const beat = ...` block (RELAY:70-76) with
   ```js
    let tick = 0;
    const beat = setInterval(() => {
        tick++;
        for (const ws of wss.clients) {
            if (!ws.fast && tick % SLOW_EVERY !== 0) continue;   // older games: judged every 30 s, exactly as today
            if (!ws.isAlive) { ws.terminate(); continue; }
            ws.isAlive = false;
            ws.ping();
        }
        hub.sweep();                                             // expire away seats
    }, pingMs);
   ```
   and update the comment above it to "drop sockets that stopped answering (...)" keeping the existing words.

- [ ] **Step 4: Run, expect PASS:** `tests/multiplayer-rejoin-ping.test.js`, `tests/multiplayer-rejoin-relay.test.js`, `tests/multiplayer-relay.test.js`.

- [ ] **Step 5: Stop - no commit.**

---

## Task 5: Client seat: rj=1, save/clear the key, key= on retry and Join, bye on Leave

**Files:**
- Modify: `web/multiplayer.js` (MP:36-44 `mp`; MP:75-81 `REASONS`; MP:86-97 `connect` head; MP:101-113 welcome/err; MP:191-199 `disconnect`)
- Modify: `tests/multiplayer-rejoin-client.test.js` (append)

**Interfaces:**
- Consumes: Task 1 `mp.hadWelcome`; the relay messages of Task 2.
- Produces: `mp.want = { base, room, key }`; helpers `loadSeat()`, `saveSeat(seat)`, `clearSeat()`, `dropSeat({key, room})`, `seatKeyFor(base, room)`, `keepSeat(base, welcomeMsg)` (module-private); `mp.lost` and `mp.autoTry` fields (used by Tasks 6 and 7); `REASONS.gone`; localStorage `dw.mp.seat`; quiet `disconnect(true)` now keeps `mp.id`, `mp.room`, `mp.hostId`.

- [ ] **Step 1: Failing tests** (append to `tests/multiplayer-rejoin-client.test.js`)

```js
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
```

- [ ] **Step 2: Run `tests/multiplayer-rejoin-client.test.js`, expect FAIL** (no `rj`, no seat saved, id nulled by the quiet disconnect, no `bye`).

- [ ] **Step 3: Minimal code in `web/multiplayer.js`**

1. `mp` object: replace the line from Task 1 with `    retry: 0, retryTimer: 0, want: null, beat: 0, hadWelcome: false, lost: false, autoTry: false,   // hadWelcome: this link has been in a room (one flag for every retry); lost: the link dropped and no welcome yet; autoTry: the page-start try`
2. After `const KEY_ADDR = "dw.mp.addr";` add `const KEY_SEAT = "dw.mp.seat";        // { base, room, key }: my seat in the last room, so a crash or a closed tab can come back to it`
3. In `REASONS` add `    gone: "Your place in that room has expired. Join again with the code.",`
4. Before `function setStatus` add the seat helpers:
   ```js
// ------------------------------------------------------------ my seat (the relay's key for me, kept so a drop can come back)
const SEAT_ROOM = /^[A-HJ-NP-Z2-9]{5}$/, SEAT_KEY = /^[0-9a-f]{32}$/;
function loadSeat() {
    try {
        const s = JSON.parse(localStorage.getItem(KEY_SEAT) || "null");
        return s && typeof s.base === "string" && SEAT_ROOM.test(s.room ?? "") && SEAT_KEY.test(s.key ?? "") ? s : null;
    } catch { return null; }
}
function saveSeat(s) { try { localStorage.setItem(KEY_SEAT, JSON.stringify({ base: s.base, room: s.room, key: s.key })); } catch { /* storage blocked */ } }
function clearSeat() { try { localStorage.removeItem(KEY_SEAT); } catch { /* storage blocked */ } }
/** Clear the saved seat only when it is the one named (another tab's seat is not mine to erase). */
function dropSeat({ key = null, room = null } = {}) {
    const s = loadSeat();
    if (s && (!key || s.key === key) && (!room || s.room === String(room).toUpperCase())) clearSeat();
}
/** The saved key for this base and room, or null (a seat for another room is ignored). */
const seatKeyFor = (base, room) => { const s = loadSeat(); return s && s.base === base && s.room === String(room ?? "").toUpperCase() ? s.key : null; };
/** Save the seat from a welcome, unless it is a NEW player who joined because the seat in storage was still live (that seat is another tab's). */
function keepSeat(base, m) {
    const old = loadSeat();
    if (m.resumed || !old || old.base !== base || old.room !== m.room || old.key === m.key) saveSeat({ base, room: m.room, key: m.key });
}
   ```
5. `connect` head: replace
   ```js
    const q = new URLSearchParams({ name: mp.name });
    if (want.create) q.set("create", "1"); else q.set("room", want.room);
   ```
   with
   ```js
    const q = new URLSearchParams({ name: mp.name, rj: "1" });          // always: "I know about seats"
    let sentKey = null;
    if (want.create) q.set("create", "1");
    else { q.set("room", want.room); sentKey = want.key ?? seatKeyFor(base, want.room); if (sentKey) q.set("key", sentKey); }
   ```
   and the doc comment above `connect` becomes `/** want = { base: "ws://host:port", create: true } or { base, room: "ABCDE", key?: seat key } */`.
6. Replace the welcome and err branches (from `if (m.t === "welcome") {` through the `setStatus("off", REASONS[m.reason] ?? "The server said no.");` line and its closing brace) with:
   ```js
        if (m.t === "welcome") {
            mp.hadWelcome = true; mp.autoTry = false; mp.retry = 0;
            mp.id = m.id; mp.room = m.room; mp.hostId = m.host ?? null;
            mp.want = { base, room: m.room, key: m.key ?? null };         // a reconnect rejoins this room with this seat
            if (m.key) keepSeat(base, m);
            mp.peers.clear();
            for (const p of m.roster) { const q = newPeer(p.name); q.map = p.map ?? null; q.card = p.card ?? null; mp.peers.set(p.id, q); }
            mp.sent.at = 0; mp.sent.map = null;                                  // announce myself straight away
            setStatus("online");
            if (!m.resumed) emit("sys", { text: `You joined room ${m.room}.` });
            emit("roster");
        } else if (m.t === "err") {
            mp.hadWelcome = false;
            if (m.reason === "gone") dropSeat({ key: sentKey });
            else if (m.reason === "no_room") dropSeat({ room: mp.want?.room });
            if (m.reason === "gone" && !mp.autoTry && mp.want?.room) { connect({ base, room: mp.want.room }); return; }   // my seat is lost: join once as a new player
            mp.autoTry = false;
            mp.want = null;
            setStatus("off", REASONS[m.reason] ?? "The server said no.");
   ```
   The `        } else if (m.t === "join") {` line that follows in the file stays exactly as it is.
7. Replace `disconnect` with:
   ```js
export function disconnect(quiet = false) {
    clearTimeout(mp.retryTimer);
    const myKey = mp.want?.key ?? null;
    if (!quiet) mp.hosting = false;
    const ws = mp.ws; mp.ws = null; mp.want = quiet ? mp.want : null;
    if (ws) {
        // Leave frees my seat at once ("bye"); a drop keeps it. An older relay ignores the unknown message.
        if (!quiet) { try { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "bye" })); } catch { /* already closed */ } }
        try { ws.close(); } catch { /* already closed */ }
    }
    mp.peers.clear();
    if (!quiet) {
        mp.room = null; mp.id = null; mp.hostId = null; mp.hadWelcome = false; mp.lost = false; mp.autoTry = false;
        if (myKey) dropSeat({ key: myKey });                 // only my own seat: another tab may hold a different one
    }                                                        // (a quiet disconnect is the start of every retry: it keeps my id, so the fight screen's myId() stays mine)
    resetChatQueue();                             // lines still waiting die with the connection, and say so
    if (!quiet) setStatus("off");
}
   ```
   Note: `sentKey` is declared inside `connect` with `let`; the `err` branch above sits inside `connect`'s `ws.onmessage`, so it is in scope.

- [ ] **Step 4: Run `tests/multiplayer-rejoin-client.test.js`, expect PASS** (Task 1 tests too).

- [ ] **Step 5: Stop - no commit.** Whether the saved base for a host is `ws://127.0.0.1:20031` and works on a later page load: Task 7 covers the page-start try; the launcher is not touched.

---

## Task 6: Client events: linklost, linkback, away, back, peerHere, away players listed

**Files:**
- Modify: `web/multiplayer.js` (MP:62 `peerList`; MP:117-125 near `leave`; MP:158-167 `onclose`; `render` MP:345 and MP:357)
- Modify: `tests/multiplayer-rejoin-client.test.js` (append)

**Interfaces:**
- Consumes: Task 5 (`mp.lost`, welcome handling).
- Produces: events via `mpOn`: `linklost` `{}` (once per drop, before `roster`), `linkback` `{ resumed }` (on the welcome that ends a lost link), `away` `{ id }`, `back` `{ id }`; exports `peerHere(id)` (peer or null when missing or away) and `playingCount()`; `peerList()` rows now carry `away`.

- [ ] **Step 1: Failing tests** (append)

```js
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
```

- [ ] **Step 2: Run, expect FAIL** (`peerHere`/`playingCount` are not exported).

- [ ] **Step 3: Minimal code in `web/multiplayer.js`**

1. Replace the `peerList` line (MP:62) with
   ```js
export const peerList = () => [...mp.peers].map(([id, p]) => ({ id, name: p.name, map: p.map, card: p.card, away: !!p.away }));
   ```
   and after `export const peerOf = ...` add
   ```js
/** The peer, only when they are really here: a player who is away (dropped, seat kept) is not. */
export const peerHere = (id) => { const p = mp.peers.get(id); return p && !p.away ? p : null; };
/** How many are playing, me included, not counting players who are away. */
export const playingCount = () => [...mp.peers.values()].filter((p) => !p.away).length + 1;
   ```
2. Welcome branch (Task 5 text): after `mp.hadWelcome = true; mp.autoTry = false; mp.retry = 0;` add `            const wasLost = mp.lost; mp.lost = false;`; change the roster loop to
   ```js
            for (const p of m.roster) { const q = newPeer(p.name); q.map = p.map ?? null; q.card = p.card ?? null; if (p.away) { q.away = true; q.hidden = true; } mp.peers.set(p.id, q); }
   ```
   and after `            emit("roster");` (the last line of the welcome branch) add `            if (wasLost) emit("linkback", { resumed: !!m.resumed });   // the fight screen decides what a new id means`
3. After the `leave` branch (the one ending `if (p) emit("sys", { text: `${p.name} left.` }); emit("roster");`) add:
   ```js
        } else if (m.t === "away") {
            const p = mp.peers.get(m.id);
            if (p) { p.away = true; p.hidden = true; emit("away", { id: m.id }); emit("sys", { text: `${p.name} lost connection.` }); emit("roster"); }
        } else if (m.t === "back") {
            const p = mp.peers.get(m.id);
            if (p) { p.away = false; emit("back", { id: m.id }); emit("sys", { text: `${p.name} is back.` }); emit("roster"); }
   ```
4. `ws.onclose`: replace `        mp.ws = null; mp.peers.clear(); emit("roster");` with
   ```js
        mp.ws = null; mp.peers.clear();
        if (mp.hadWelcome && !mp.lost) { mp.lost = true; emit("linklost"); }   // once per drop, before the list is told it changed
        emit("roster");
   ```
   and in the give-up branch from Task 1 add `mp.lost = false; mp.autoTry = false;` after `mp.hadWelcome = false;`.
5. `render`: replace `` `ROOM ${mp.room}  ·  ${mp.peers.size + 1} playing` `` with `` `ROOM ${mp.room}  ·  ${playingCount()} playing` `` and replace `.map((p) => p.name)].join(", ")` in the roster line with `.map((p) => (p.away ? `${p.name} (away)` : p.name))].join(", ")`.

- [ ] **Step 4: Run `tests/multiplayer-rejoin-client.test.js`, expect PASS** (all earlier tests too).

- [ ] **Step 5: Stop - no commit.**

---

## Task 7: Page-start rejoin (one try, no fallback to a new player)

**Files:**
- Modify: `web/multiplayer.js` (`multiplayerTick` MP:259; `installMultiplayer` MP:367)
- Modify: `tests/multiplayer-rejoin-client.test.js` (append)
- Read first (not known yet): `web/game.js` around 11071 (`multiplayerTick(m.id, state)`) and 504 (`installMultiplayer(...)`): confirm `state.playerName` exists at the first tick. If it does not, the builder keeps the try on the first tick but passes `defaultName` that falls back to "Tamer" (it already does: `state.playerName || "Tamer"`). The name is ignored by the relay on a return; it only matters if the seat turned out to be live.

**Interfaces:**
- Consumes: `loadSeat`, `connect`, `mp.autoTry` (Task 5).
- Produces: `export function rejoinSaved(defaultName)` returns true when it started a try; `mp.autoTried`, `mp.defaultName` fields.

- [ ] **Step 1: Failing tests** (append)

```js
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
```

- [ ] **Step 2: Run, expect FAIL** (`rejoinSaved` is not exported).

- [ ] **Step 3: Minimal code in `web/multiplayer.js`**

1. `mp` object: add `autoTried: false, defaultName: null,` to the line from Task 5.
2. After `disconnect` add:
   ```js
/** Page start: if my last room left a seat in storage, try ONCE to take it back (same id, name, place). A failure stops with a message;
 *  it never joins as a new player and never retries. Returns true when it started a try. */
export function rejoinSaved(defaultName) {
    if (mp.status !== "off") return false;
    const seat = loadSeat(); if (!seat) return false;
    mp.name = String((typeof defaultName === "function" ? defaultName() : defaultName) || "Tamer").slice(0, 12);
    mp.hosting = false; mp.host = seat.base.replace(/^ws:\/\//, "");
    mp.autoTry = true;
    connect({ base: seat.base, room: seat.room, key: seat.key });
    return true;
}
   ```
3. `multiplayerTick`: after the `const dt = ...; mp.lastTick = now;` lines and before `mp.me.map = mapId;` add
   `    if (!mp.autoTried && mp.defaultName) { mp.autoTried = true; rejoinSaved(mp.defaultName); }   // page start: take my old seat back, once`
4. `installMultiplayer`: right after `mp.ui = {...}` (MP:413) add `    mp.defaultName = defaultName;               // the first multiplayerTick uses it for the page-start rejoin`.

- [ ] **Step 4: Run `tests/multiplayer-rejoin-client.test.js`, expect PASS.**

- [ ] **Step 5: Stop - no commit.**

---

## Task 8: Pure `web/mpbattle-pause.js` (pause set, gate, link timers) with the real Arena

**Files:**
- Create: `web/mpbattle-pause.js`
- Create: `tests/mpbattle-pause.test.js`

**Interfaces:**
- Consumes: `Arena` from `web/mpbattle-rules.js` (test only; the module itself has no imports, no DOM).
- Produces (all exported): `AWAY_MS = 60000`, `BACK_WAIT_MS = 10000`, `SELF = "self"`, `LINK_TEXT = { lost, ref, back }`, `createPause({ now, setT, clearT, awayMs })` returning `{ size, has(id), add(id, onExpire|null), remove(id), gate(name, fn), release({covered}), view(), clear() }`, `pzText(pz, players)`, `createLink({ onEnd, setT, clearT })` returning `{ text, active, lost(), refWait(), reconnected(), clear() }`.

- [ ] **Step 1: Failing tests** `tests/mpbattle-pause.test.js`

```js
// The fight pause (web/mpbattle-pause.js): the pure rules of who is away, what waits, which timer ends. Real Arena for the order-of-actions check.
import test from "node:test";
import assert from "node:assert/strict";
import { Arena } from "../web/mpbattle-rules.js";
import { createPause, createLink, pzText, AWAY_MS, BACK_WAIT_MS, SELF, LINK_TEXT } from "../web/mpbattle-pause.js";

function clock() {
    let t = 0, id = 0; const q = new Map();
    return {
        now: () => t,
        setT: (fn, ms) => { q.set(++id, { at: t + ms, fn }); return id; },
        clearT: (h) => q.delete(h),
        advance(ms) { t += ms; for (const [h, e] of [...q]) if (e.at <= t && q.has(h)) { q.delete(h); e.fn(); } },
        pending: () => q.size,
    };
}

const FIGHT = { id: 335, name: "Fight", mp_cost: 0, attack_category: "physical", effect: "counter", power: 20, hits: 1 };
const kit = { skillDB: () => ({ 335: FIGHT }), techRecord: () => null };
const mon = () => ({ profile: { id: 7, name: "T" }, hp: 400, maxHp: 400, mp: 60, maxMp: 60, level: 5, str: 30, def: 20, spd: 25, wit: 20, ailments: {} });
const foeRec = () => ({ ...mon(), eStats: { attack: 335 } });
const arena = () => new Arena({
    kit, players: [{ id: 1, name: "A", rec: mon() }, { id: 2, name: "B", rec: mon() }],
    foes: [{ name: "E1", rec: foeRec() }, { name: "E2", rec: foeRec() }], rng: () => 3,
});
// one action: the same calls nextTurn / foeTurn / armTurnTimer's timeout make in web/mpbattle.js
function step(ar, order) {
    const nx = ar.next();
    order.push(nx.key);
    const res = nx.key[0] === "e" ? ar.foeAction(nx.key) : { lines: [], rows: [], a: nx.key, sk: 0, kind: "run" };
    ar.finish(nx.key, res);
}
const hpOf = (ar) => ar.P.map((p) => p.rec.hp);

test("a paused referee consumes nothing: the same actors in the same order, the same timeline, as a run that never paused", () => {
    const ref = arena(), refOrder = [];
    for (let i = 0; i < 8; i++) step(ref, refOrder);

    const ar = arena(), order = [], c = clock(), pause = createPause(c);
    const turn = () => { if (pause.gate("next", turn)) return; step(ar, order); };
    for (let i = 0; i < 3; i++) turn();
    const timeBefore = JSON.stringify([...ar.time]), hpBefore = hpOf(ar);
    pause.add(2, () => {});
    for (let i = 0; i < 4; i++) turn();                                    // four tries while guest 2 is away: all park, one remembered
    assert.equal(order.length, 3);
    assert.equal(JSON.stringify([...ar.time]), timeBefore);
    assert.deepEqual(hpOf(ar), hpBefore);
    assert.equal(pause.release(), null, "still away: nothing to run");
    pause.remove(2);
    const run = pause.release();
    assert.equal(run.length, 1, "parked calls of one name are kept once");
    run[0]();
    while (order.length < 8) turn();
    assert.deepEqual(order, refOrder);
    assert.equal(JSON.stringify([...ar.time]), JSON.stringify([...ref.time]));
    assert.deepEqual(hpOf(ar), hpOf(ref));
});

test("a drop during an enemy action: the foe gate holds it, nothing is rolled, and it runs exactly once on release", () => {
    const ar = arena(), c = clock(), pause = createPause(c);
    let key;
    do { key = ar.next().key; if (key[0] === "p") ar.finish(key, { lines: [], rows: [], a: key, sk: 0, kind: "run" }); } while (key[0] !== "e");
    let fired = 0;
    const go = () => { if (pause.gate("foe", go)) return; ar.finish(key, ar.foeAction(key)); fired++; };
    const hpBefore = hpOf(ar);
    pause.add(1, () => {});
    go(); go();
    assert.equal(fired, 0);
    assert.deepEqual(hpOf(ar), hpBefore, "foeAction was not rolled while paused");
    pause.remove(1);
    const run = pause.release(); assert.equal(run.length, 1);
    run[0]();
    assert.equal(fired, 1);
    assert.equal(pause.release().length, 0, "released once: nothing left to run twice");
});

test("two guests away: the gate stays shut until both are back or gone", () => {
    const c = clock(), pause = createPause(c);
    pause.add(1, () => {}); pause.add(2, () => {});
    assert.equal(pause.gate("next", () => {}), true);
    pause.remove(1);
    assert.equal(pause.release(), null);
    pause.remove(2);
    assert.equal(pause.release().length, 1);
});

test("a guest who is not back in AWAY_MS: onExpire runs once with the id, the entry is gone; remove() before that stops it", () => {
    const c = clock(), pause = createPause(c);
    const gone = [];
    pause.add(5, (id) => gone.push(id));
    pause.add(6, (id) => gone.push(id));
    c.advance(AWAY_MS - 1);
    assert.deepEqual(gone, []);
    pause.remove(6);
    c.advance(1);
    assert.deepEqual(gone, [5]);
    assert.equal(pause.has(5), false);
    c.advance(AWAY_MS);
    assert.deepEqual(gone, [5]);
});

test("release({covered}) leaves out calls another path already schedules (hostGone's own nextTurn)", () => {
    const pause = createPause(clock());
    pause.add(1, () => {});
    pause.gate("next", () => "n"); pause.gate("foe", () => "f");
    pause.remove(1);
    assert.deepEqual(pause.release({ covered: ["next"] }).map((f) => f()), ["f"]);
});

test("SELF is held with no timer, is not shown in view(), and still shuts the gate", () => {
    const c = clock(), pause = createPause(c);
    pause.add(SELF, null);
    c.advance(AWAY_MS * 10);
    assert.equal(pause.has(SELF), true);
    assert.equal(pause.view(), null);
    assert.equal(pause.gate("next", () => {}), true);
});

test("view() lists the away ids and the seconds left; pzText names them", () => {
    const c = clock(), pause = createPause(c);
    pause.add(2, () => {});
    c.advance(15000);
    assert.deepEqual(pause.view(), { ids: [2], s: 45 });
    assert.equal(pzText({ ids: [2], s: 45 }, [{ id: 1, pn: "Ken" }, { id: 2, pn: "Ana" }]), "Waiting for Ana (45s)");
    assert.equal(pzText({ ids: [9], s: 3 }, []), "Waiting for player (3s)");
});

test("clear() drops every timer and every parked call", () => {
    const c = clock(), pause = createPause(c);
    pause.add(1, () => {}); pause.gate("next", () => {});
    pause.clear();
    assert.equal(c.pending(), 0);
    assert.equal(pause.size, 0);
    assert.deepEqual(pause.release(), []);
});

test("link: lost shows its text and ends the fight after AWAY_MS, once", () => {
    const c = clock(); let ended = 0;
    const link = createLink({ onEnd: () => ended++, setT: c.setT, clearT: c.clearT });
    link.lost();
    assert.equal(link.text, LINK_TEXT.lost); assert.equal(link.active, true);
    c.advance(AWAY_MS - 1); assert.equal(ended, 0);
    c.advance(1); assert.equal(ended, 1);
    assert.equal(link.active, false);
    c.advance(AWAY_MS); assert.equal(ended, 1);
});

test("link: reconnected waits BACK_WAIT_MS (10 s) for the referee; an older referee that ignores back ends the fight cleanly", () => {
    const c = clock(); let ended = 0;
    const link = createLink({ onEnd: () => ended++, setT: c.setT, clearT: c.clearT });
    link.lost();
    c.advance(AWAY_MS - 1000);
    link.reconnected();                                                  // the 60 s timer is replaced by the 10 s one
    assert.equal(link.text, LINK_TEXT.back);
    c.advance(BACK_WAIT_MS - 1); assert.equal(ended, 0);
    c.advance(1); assert.equal(ended, 1);
});

test("link: a snapshot (clear) stops the wait; refWait uses the same 60 s", () => {
    const c = clock(); let ended = 0;
    const link = createLink({ onEnd: () => ended++, setT: c.setT, clearT: c.clearT });
    link.reconnected(); link.clear();
    c.advance(BACK_WAIT_MS * 3); assert.equal(ended, 0);
    assert.equal(link.text, null);
    link.refWait(); assert.equal(link.text, LINK_TEXT.ref);
    c.advance(AWAY_MS); assert.equal(ended, 1);
});
```

- [ ] **Step 2: Run `tests/mpbattle-pause.test.js`, expect FAIL** (module missing).

- [ ] **Step 3: Create `web/mpbattle-pause.js`**

```js
// EXPERIMENT: multiplayer rejoin, the fight side (not original game content). Pure rules, no DOM, no imports: node tests them
// (tests/mpbattle-pause.test.js) and web/mpbattle.js wires them in.
//
// PAUSE (referee): while a guest is away (their link dropped, the relay kept their seat) the referee does not start the next
// action. `gate(name, fn)` is called at the top of nextTurn and foeTurn: when someone is away it remembers `fn` (once per name)
// and says "parked"; when the last one is back or gone, `release()` hands the remembered calls back to run. Each away guest has a
// timer; when it ends, onExpire(id) runs (the referee marks them fled, as it always did for a left player).
// LINK (any player): my own link dropped, or the referee's did. One timer at a time: 60 s waiting for the link, or 10 s
// waiting for the referee's snapshot after my link came back. When it ends, onEnd() closes the fight cleanly.
export const AWAY_MS = 60000;          // how long a fight waits for a dropped player
export const BACK_WAIT_MS = 10000;     // how long a returned guest waits for a snapshot before leaving the fight
export const SELF = "self";            // the referee's own dropped link, held in the pause with no timer
export const LINK_TEXT = { lost: "Connection lost. Reconnecting...", ref: "Waiting for the referee...", back: "Reconnected. Waiting for the fight..." };

const real = { now: () => Date.now(), setT: (fn, ms) => setTimeout(fn, ms), clearT: (h) => clearTimeout(h) };

export function createPause({ now = real.now, setT = real.setT, clearT = real.clearT, awayMs = AWAY_MS } = {}) {
    const away = new Map();            // id -> { at, timer }
    let parked = [];                   // [{ name, fn }]
    return {
        get size() { return away.size; },
        has: (id) => away.has(id),
        /** Mark `id` away. onExpire(id) runs after awayMs; onExpire null = held until remove() (the referee's own link). False if already away. */
        add(id, onExpire) {
            if (away.has(id)) return false;
            const e = { at: now(), timer: 0 };
            if (onExpire) e.timer = setT(() => { if (away.get(id) !== e) return; away.delete(id); onExpire(id); }, awayMs);
            away.set(id, e);
            return true;
        },
        remove(id) { const e = away.get(id); if (!e) return false; clearT(e.timer); away.delete(id); return true; },
        /** True = someone is away: `fn` is remembered (one per name) and the caller must return. False = go on. */
        gate(name, fn) {
            if (!away.size) return false;
            parked = parked.filter((p) => p.name !== name);
            parked.push({ name, fn });
            return true;
        },
        /** null while someone is still away; otherwise the remembered calls (minus `covered` names), and the memory is emptied. */
        release({ covered = [] } = {}) {
            if (away.size) return null;
            const out = parked.filter((p) => !covered.includes(p.name)).map((p) => p.fn);
            parked = [];
            return out;
        },
        /** For the snapshot: { ids, s } (the away guests and the least seconds left), or null. The referee's own SELF is not listed. */
        view() {
            const ids = [...away.keys()].filter((id) => id !== SELF);
            if (!ids.length) return null;
            const left = Math.min(...ids.map((id) => awayMs - (now() - away.get(id).at)));
            return { ids, s: Math.max(0, Math.ceil(left / 1000)) };
        },
        clear() { for (const e of away.values()) clearT(e.timer); away.clear(); parked = []; },
    };
}

/** "Waiting for Ana (45s)". players = the snapshot's S.P rows ({ id, pn }). */
export function pzText(pz, players = []) {
    const names = pz.ids.map((id) => players.find((p) => p.id === id)?.pn ?? "player");
    return `Waiting for ${names.join(", ")} (${pz.s}s)`;
}

export function createLink({ onEnd, setT = real.setT, clearT = real.clearT } = {}) {
    let cur = null;
    const stop = () => { if (cur) clearT(cur.timer); cur = null; };
    const start = (text, ms) => { stop(); const me = { text, timer: 0 }; me.timer = setT(() => { if (cur !== me) return; cur = null; onEnd(); }, ms); cur = me; };
    return {
        get text() { return cur ? cur.text : null; },
        get active() { return !!cur; },
        lost: () => start(LINK_TEXT.lost, AWAY_MS),            // my own link dropped
        refWait: () => start(LINK_TEXT.ref, AWAY_MS),          // the referee's link dropped
        reconnected: () => start(LINK_TEXT.back, BACK_WAIT_MS),// my link is back: the referee must answer with a snapshot soon
        clear: stop,
    };
}
```

- [ ] **Step 4: Run `tests/mpbattle-pause.test.js`, expect PASS.**

- [ ] **Step 5: Stop - no commit.**

---

## Task 9: Referee wiring in `web/mpbattle.js` and `web/game.js` (away/back, gates, pz, display)

**Files:**
- Modify: `web/mpbattle.js` (import after BAT:30; `snapshot` BAT:569-576; `render` BAT:335-337; `renderCmd` BAT:378-381; `nextTurn` BAT:609-643; `foeTurn` BAT:669-676; `hostGone` BAT:711-719; `begin` BAT:764-767; `mpbMessage` BAT:811; `mpbPeerGone` neighbour BAT:821; `finish` BAT:830)
- Modify: `web/game.js` (import line GAME:62; handler GAME:4986-4991)
- Create: `tests/mpbattle-pause-wiring.test.js`

**Interfaces:**
- Consumes: Task 8 module; Task 6 events `away`/`back` (`d.id`).
- Produces in `web/mpbattle.js`: `export function mpbPeerAway(id)`, `export function mpbPeerBack(id)`; module functions `hostAway(from)`, `hostBack(from)`, `releasePause(covered)`, `rearmTurn()`, `armForcedTimer(key, actor)`; `hostGone` now returns `true` when it scheduled `nextTurn`; snapshot field `pz` (`{ ids, s }`, only while someone is away); `F.H.pause`; mpb message `{k:"back", fid}` (guest to referee) answered with a full `st` or `left`.

- [ ] **Step 1: Failing tests** `tests/mpbattle-pause-wiring.test.js`. `web/mpbattle.js` imports fine in node (checked), so exports are called for real; the on-screen parts are proven by reading the source, the same way `tests/mp-credit.test.js` does.

```js
// Wiring of the fight pause into web/mpbattle.js and web/game.js. The screen itself needs a DOM and WebGL, so what is proved here is the
// real exports (safe with no fight running) and the order of the real source lines. The pure rules are in tests/mpbattle-pause.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as bat from "../web/mpbattle.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const src = read("../web/mpbattle.js");
const fn = (name, next) => src.slice(src.indexOf(`function ${name}(`), src.indexOf(next));

test("the new exports exist and do nothing when no fight is running", () => {
    for (const n of ["mpbPeerAway", "mpbPeerBack"]) assert.equal(typeof bat[n], "function", n);
    assert.doesNotThrow(() => { bat.mpbPeerAway(5); bat.mpbPeerBack(5); });
});

test("nextTurn parks at its very top, before it clears the timer or asks the Arena who is next", () => {
    const body = fn("nextTurn", "/** PRACTICE");
    const gate = body.indexOf('H.pause.gate("next", nextTurn)');
    assert.ok(gate > 0, "gate present");
    assert.ok(gate < body.indexOf("clearTimeout(H.turnTimer)"));
    assert.ok(gate < body.indexOf("ar.next()"));
});

test("foeTurn parks before the Arena rolls the enemy action", () => {
    const body = fn("foeTurn", "/** A player's choice");
    const gate = body.indexOf('H.pause.gate("foe", () => foeTurn(key))');
    assert.ok(gate > 0 && gate < body.indexOf("ar.foeAction(key)"));
});

test("snapshot carries pz only while someone is away; the pause lives on F.H and is cleared by finish", () => {
    assert.match(fn("snapshot", "/** The other PEOPLE"), /const pz = H\.pause\?\.view\(\);[\s\S]*\.\.\.\(pz \? \{ pz \} : \{\}\)/);
    assert.match(src, /pause: createPause\(\)/);
    assert.match(fn("finish", "// ------------------------------------------------------------ install"), /f\.H\?\.pause\?\.clear\(\)/);
});

test("hostGone says whether it scheduled nextTurn; hostAway keeps the turn and clears only the timer; hostBack answers a fled player with left", () => {
    assert.match(fn("hostGone", "function hostEnd"), /later\(MIN_ANIM_MS, nextTurn\); return true; \}[^\n]*\n\s*return false;/);
    const away = fn("hostAway", "function hostBack");
    assert.match(away, /if \(H\.turn === p\.key\) clearTimeout\(H\.turnTimer\);/);
    assert.doesNotMatch(away, /p\.fled = true/);
    assert.match(fn("hostBack", "function rearmTurn"), /if \(p\.fled\) \{ A\.send\(\[from\], \{ k: "left", fid: F\.fid \}\); return; \}/);
});

test("mpbMessage hands a guest's back to the referee only", () => {
    const body = src.slice(src.indexOf("export function mpbMessage"), src.indexOf("/** Someone left the room mid-fight. */"));
    assert.match(body, /else if \(d\.k === "back"\) hostBack\(from\);/);
});

test("the status and hint show the wait, but my own turn stays usable", () => {
    assert.match(src, /import \{[^}]*\bcreatePause\b[^}]*\bpzText\b[^}]*\} from "\.\/mpbattle-pause\.js";/);
    assert.match(src, /t === "p" \+ A\.myId\(\) \? "YOUR TURN" : S\.pz \? pzText\(S\.pz, S\.P\)/);
    assert.match(src, /S\?\.ph === "play" \? \(S\.pz \? pzText\(S\.pz, S\.P\) : "Waiting\.\.\."\) : ""/);
});

test("game.js sends away and back to the fight code, and leave still ends it", () => {
    const g = read("../web/game.js");
    assert.match(g, /import \{[^}]*mpbPeerAway, mpbPeerBack[^}]*\} from "\.\/mpbattle\.js"/);
    assert.match(g, /else if \(type === "leave"\) mpbPeerGone\(d\.id\);\s*else if \(type === "away"\) mpbPeerAway\(d\.id\);\s*else if \(type === "back"\) mpbPeerBack\(d\.id\);/);
});
```

- [ ] **Step 2: Run `tests/mpbattle-pause-wiring.test.js`, expect FAIL** (no exports, no gates).

- [ ] **Step 3: Code in `web/mpbattle.js`**

1. After `import { winEvent } from "./mp-credit.js";` (BAT:30) add `import { createPause, pzText } from "./mpbattle-pause.js";   // rejoin: who is away, what waits (pure, tested in node)`.
2. `begin()`: in the `F.H = { ... }` object (BAT:764-767) add `pause: createPause(),` after `res: new Map(),`.
3. `snapshot` (BAT:569-576): replace `    const H = F.H, ar = H.arena;\n    return {` with `    const H = F.H, ar = H.arena;\n    const pz = H.pause?.view();                                // who is away and for how long, only while someone is\n    return {` and replace the closing of the returned object `ac: p.act })),\n    };` with `ac: p.act })),\n        ...(pz ? { pz } : {}),\n    };`.
4. `render` (BAT:337): replace
   ```js
    U.status.textContent = S.ph !== "play" ? "" : t === "p" + A.myId() ? "YOUR TURN" : t ? `${who}'s turn` : "";
   ```
   with
   ```js
    U.status.textContent = S.ph !== "play" ? "" : t === "p" + A.myId() ? "YOUR TURN" : S.pz ? pzText(S.pz, S.P) : t ? `${who}'s turn` : "";
   ```
5. `renderCmd` (BAT:381): replace `S?.ph === "play" ? "Waiting..." : ""` with `S?.ph === "play" ? (S.pz ? pzText(S.pz, S.P) : "Waiting...") : ""`.
6. `nextTurn` (BAT:609-611): replace
   ```js
function nextTurn() {
    const H = F.H, ar = H.arena;
    clearTimeout(H.turnTimer);
   ```
   with
   ```js
function nextTurn() {
    const H = F.H, ar = H.arena;
    if (H.pause.gate("next", nextTurn)) return;                // a player is away: wait here, nothing is lost (web/mpbattle-pause.js)
    clearTimeout(H.turnTimer);
   ```
   and replace the forced-swap timer (BAT:624-627)
   ```js
        H.turnTimer = later(TURN_MS, () => {
            const slot = actor.party.findIndex((r, i) => i !== actor.act && r.hp > 0);
            if (H.forced && H.turn === key && slot >= 0) hostCommand(Number(key.slice(1)), { fid: F.fid, c: { k: "tag", slot } });
        });
        return;
   ```
   with `        armForcedTimer(key, actor);\n        return;` and add, right after `armTurnTimer`:
   ```js
function armForcedTimer(key, actor) {                          // the forced swap's own timer (it was inline in nextTurn)
    const H = F.H;
    clearTimeout(H.turnTimer);
    H.turnTimer = later(TURN_MS, () => {
        const slot = actor.party.findIndex((r, i) => i !== actor.act && r.hp > 0);
        if (H.forced && H.turn === key && slot >= 0) hostCommand(Number(key.slice(1)), { fid: F.fid, c: { k: "tag", slot } });
    });
}
   ```
7. `foeTurn` (BAT:669-671): replace `    const H = F.H, ar = H.arena;\n    const res = ar.foeAction(key);` with
   ```js
    const H = F.H, ar = H.arena;
    if (H.pause.gate("foe", () => foeTurn(key))) return;       // the enemy's action (already due) waits until nobody is away
    const res = ar.foeAction(key);
   ```
8. `hostGone` (BAT:711-719): replace the whole function with
   ```js
function hostGone(from) {                                     // a player's connection dropped mid-fight
    const H = F.H; if (!H?.arena) return false;
    const p = H.arena.byKey("p" + from); if (!p || p.fled) return false;
    p.fled = true; say(`${p.name} left the fight.`);
    const wasTurn = H.turn === p.key;
    if (wasTurn) { clearTimeout(H.turnTimer); H.turn = null; }
    broadcast();
    if (wasTurn || H.arena.state() !== "play") { later(MIN_ANIM_MS, nextTurn); return true; }   // true: nextTurn is already on its way
    return false;
}

/** A guest's link dropped (the relay said `away`): wait for them up to AWAY_MS. They are NOT marked fled; their turn, if it is theirs, stays theirs. */
function hostAway(from) {
    const H = F.H; if (!H?.arena) return;
    const p = H.arena.byKey("p" + from);
    if (!p || p.fled || F.bots?.has(from) || H.pause.has(from)) return;
    if (H.turn === p.key) clearTimeout(H.turnTimer);           // their 45 s must not run while they cannot answer
    H.pause.add(from, (id) => { if (!F?.H) return; releasePause(hostGone(id) ? ["next"] : []); });   // not back in time: they have left, as before
    say(`${p.name} lost connection. Waiting...`);
    broadcast();                                               // everyone's screen shows "Waiting for ..."
}

/** The guest's own game says it is back (mpb `back`). A guest who already left gets `left`; otherwise everyone gets the full picture. */
function hostBack(from) {
    const H = F.H; if (!H?.arena) return;
    const p = H.arena.byKey("p" + from); if (!p) return;
    if (p.fled) { A.send([from], { k: "left", fid: F.fid }); return; }
    const was = H.pause.remove(from);
    if (was) say(`${p.name} is back.`);
    broadcast();                                               // the current full snapshot: clears "Waiting" and gives the returner the fight (also when never marked away)
    if (!was) return;
    if (!H.pause.size) rearmTurn();
    releasePause();
}

function rearmTurn() {                                         // the turn that was waiting gets its full 45 s again
    const H = F.H, key = H.turn;
    if (!key || key[0] !== "p") return;
    const actor = H.arena.byKey(key);
    if (!actor || actor.fled || F.bots.has(actor.id)) return;
    if (H.forced) armForcedTimer(key, actor); else armTurnTimer(key, actor);
}

/** Run what the gate held back, once nobody is away. `covered` = calls another path already schedules (hostGone's nextTurn). */
function releasePause(covered = []) {
    const run = F.H.pause.release({ covered });
    if (!run) return;                                          // someone is still away: stay parked
    for (const f of run) later(0, f);
}
   ```
9. `mpbMessage` (BAT:811): after `        else if (d.k === "cmd") hostCommand(from, d);` add `        else if (d.k === "back") hostBack(from);` (the previous line ends with `;` already; keep the `else if` chain: the existing last branch is `else if (d.k === "cmd") hostCommand(from, d);`, so the new branch is appended as its own `else if` on the next line).
10. After `mpbPeerGone` (BAT:821-826) add:
    ```js
/** The relay says someone's link dropped but their seat is kept. As referee: wait for them. (Guests: Task 10.) */
export function mpbPeerAway(id) {
    if (!F) return;
    if (F.isHost) { if (F.H?.arena) hostAway(id); else mpbPeerGone(id); }   // before the fight starts there is nothing to wait for: as a left player
}
/** The relay says a seat is back. The referee waits for that guest's own `back` message instead (a reloaded page has no fight to come back to). */
export function mpbPeerBack(id) { void id; }
    ```
11. `finish` (BAT:830-831): after `clearTimeout(f.H?.readyTimer); clearTimeout(f.H?.turnTimer);` add `    f.H?.pause?.clear();`.

- [ ] **Step 4: Code in `web/game.js`**

1. GAME:62: add `mpbPeerAway, mpbPeerBack, ` to the import list (after `mpbPeerGone, `).
2. GAME:4990: replace `    } else if (type === "leave") mpbPeerGone(d.id);` with
   ```js
    } else if (type === "leave") mpbPeerGone(d.id);
    else if (type === "away") mpbPeerAway(d.id);
    else if (type === "back") mpbPeerBack(d.id);
   ```
   (the closing `});` follows unchanged).

- [ ] **Step 5: Run `tests/mpbattle-pause-wiring.test.js`, `tests/mpbattle-pause.test.js`, `tests/mp-credit.test.js` (it reads mpbattle.js source), `tests/mp-enemy-counter-gate.test.js`, expect PASS.**

- [ ] **Step 6: Stop - no commit.** Not proven in node: the on-screen text and the real timers during a real fight.

---

## Task 10: Own-link and referee-link handling (guest wait, referee drop)

**Files:**
- Modify: `web/mpbattle.js` (`begin` F literal BAT:740-744; `renderCmd` mineTurn BAT:378; `driveNative` BAT:473; `render` BAT:337 and the `!S` early return BAT:306; `mpbMessage` guest branch BAT:814; `mpbPeerAway`/`mpbPeerBack` from Task 9; `finish` BAT:830)
- Modify: `web/game.js` (import GAME:62; handler GAME:4986-4991)
- Modify: `tests/mpbattle-pause-wiring.test.js` (append)

**Interfaces:**
- Consumes: Task 8 `createLink`, `LINK_TEXT`; Task 6 events `linklost`, `linkback {resumed}`; Task 9 `hostLinkLost` is new here.
- Produces: `export function mpbLinkLost()`, `export function mpbLinkBack(resumed)`; `F.link` (a `createLink` object per fight); `hostLinkLost()`, `hostLinkBack()` (module-private); guest `mpb {k:"back", fid}` is sent to `F.hostId` on `linkback {resumed:true}`.

- [ ] **Step 1: Failing tests** (append to `tests/mpbattle-pause-wiring.test.js`)

```js
test("the link exports exist and do nothing when no fight is running", () => {
    for (const n of ["mpbLinkLost", "mpbLinkBack"]) assert.equal(typeof bat[n], "function", n);
    assert.doesNotThrow(() => { bat.mpbLinkLost(); bat.mpbLinkBack(true); bat.mpbLinkBack(false); });
});

test("every fight gets a link that closes it cleanly (fled, hostLeft) when it runs out; finish clears it", () => {
    assert.match(src, /link: createLink\(\{ onEnd: \(\) => \{ if \(F\) finish\(false, \{ fled: true, hostLeft: true \}\); \} \}\)/);
    assert.match(fn("finish", "// ------------------------------------------------------------ install"), /f\.link\?\.clear\(\)/);
});

test("a guest's link back sends back to the referee and waits; a new id (not resumed) leaves at once; the referee resumes itself", () => {
    const body = src.slice(src.indexOf("export function mpbLinkBack"), src.indexOf("function finish("));
    assert.match(body, /if \(!resumed\) \{ finish\(false, \{ fled: true, hostLeft: true \}\); return; \}/);
    assert.match(body, /F\.link\.reconnected\(\);[^\n]*\n\s*A\.send\(\[F\.hostId\], \{ k: "back", fid: F\.fid \}\);/);
    assert.match(body, /if \(F\.isHost\) \{ F\.link\.clear\(\); hostLinkBack\(\); render\(\); return; \}/);
});

test("a snapshot from the referee ends the guest's wait", () => {
    assert.match(src, /else if \(d\.k === "st"\) \{ F\.S = d\.S; F\.link\.clear\(\); render\(\); \}/);
});

test("while the link is down nobody can choose, and the status line says why", () => {
    assert.match(src, /const mineTurn = S && S\.ph === "play" && S\.t === myKey && F\.me\.hp > 0 && !F\.iFled && !F\.link\.active;/);
    assert.match(src, /const mineTurn = !!\(S && S\.ph === "play" && S\.t === myKey && !F\.iFled && !F\.link\.active && mine && \(forced \|\| !mine\.ko\)\);/);
    assert.match(src, /U\.status\.textContent = F\.link\.text \?\? \(S\.ph !== "play"/);
});

test("the referee's drop: guests wait for it (refWait); its own link loss holds the pause with no timer", () => {
    const peer = src.slice(src.indexOf("export function mpbPeerAway"), src.indexOf("export function mpbPeerBack"));
    assert.match(peer, /if \(!F\.isHost\) \{ if \(id === F\.hostId\) \{ F\.link\.refWait\(\); render\(\); \} return; \}/);
    assert.match(src, /H\.pause\.add\(SELF, null\)/);
});

test("game.js passes linklost and linkback on", () => {
    const g = read("../web/game.js");
    assert.match(g, /mpbLinkLost, mpbLinkBack/);
    assert.match(g, /else if \(type === "linklost"\) mpbLinkLost\(\);\s*else if \(type === "linkback"\) mpbLinkBack\(d\.resumed\);/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Code in `web/mpbattle.js`**

1. Import: change the Task 9 import to `import { createPause, createLink, pzText, SELF } from "./mpbattle-pause.js";`.
2. `begin()` F literal (BAT:743): add `link: createLink({ onEnd: () => { if (F) finish(false, { fled: true, hostLeft: true }); } }),` to the object (e.g. before `timers: new Set()`).
3. `renderCmd` (BAT:378): replace `const mineTurn = S && S.ph === "play" && S.t === myKey && F.me.hp > 0 && !F.iFled;` with `const mineTurn = S && S.ph === "play" && S.t === myKey && F.me.hp > 0 && !F.iFled && !F.link.active;`.
4. `driveNative` (BAT:473): replace `const mineTurn = !!(S && S.ph === "play" && S.t === myKey && !F.iFled && mine && (forced || !mine.ko));` with `const mineTurn = !!(S && S.ph === "play" && S.t === myKey && !F.iFled && !F.link.active && mine && (forced || !mine.ko));`.
5. `render` (BAT:337, as changed in Task 9): replace the whole statement
   ```js
    U.status.textContent = S.ph !== "play" ? "" : t === "p" + A.myId() ? "YOUR TURN" : S.pz ? pzText(S.pz, S.P) : t ? `${who}'s turn` : "";
   ```
   with
   ```js
    U.status.textContent = F.link.text ?? (S.ph !== "play" ? "" : t === "p" + A.myId() ? "YOUR TURN" : S.pz ? pzText(S.pz, S.P) : t ? `${who}'s turn` : "");
   ```
   In the `!S` early return (BAT:306) replace `U.status.textContent = "Waiting for everyone to get ready...";` with `U.status.textContent = F.link.text ?? "Waiting for everyone to get ready...";`.
6. `mpbMessage` guest branch (BAT:814): replace `        else if (d.k === "st") { F.S = d.S; render(); }` with `        else if (d.k === "st") { F.S = d.S; F.link.clear(); render(); }`.
7. Replace `mpbPeerAway` and `mpbPeerBack` from Task 9 with:
   ```js
/** The relay says someone's link dropped but their seat is kept. Referee: wait for that guest. Guest: if it is the referee, wait for it. */
export function mpbPeerAway(id) {
    if (!F) return;
    if (!F.isHost) { if (id === F.hostId) { F.link.refWait(); render(); } return; }
    if (F.H?.arena) hostAway(id); else mpbPeerGone(id);        // before the fight starts there is nothing to wait for: as a left player
}
/** The relay says a seat is back. Guest: the referee is back, stop waiting for it (it sends a snapshot on its own link back).
 *  Referee: nothing, it waits for that guest's own `back` message (a reloaded page has no fight to come back to). */
export function mpbPeerBack(id) {
    if (!F || F.isHost) return;
    if (id === F.hostId && F.link.text === LINK_TEXT.ref) { F.link.clear(); render(); }
}

/** MY link dropped (multiplayer.js `linklost`): keep the screen, say so, disable choices, give up after AWAY_MS. */
export function mpbLinkLost() {
    if (!F) return;
    F.cmd = null; if (F.nat) { F.nat.close(); F.nat.clearSay(); }
    F.link.lost();
    if (F.isHost) hostLinkLost();                              // nothing may run on while nobody can hear me
    render();
}
/** MY link is back (`linkback`). resumed = the relay gave me my old id. A new id cannot rejoin the fight: leave cleanly. */
export function mpbLinkBack(resumed) {
    if (!F) return;
    if (!resumed) { finish(false, { fled: true, hostLeft: true }); return; }
    if (F.isHost) { F.link.clear(); hostLinkBack(); render(); return; }
    F.link.reconnected();                                      // 10 s for the referee's snapshot, left or end; an older referee ignores `back`
    A.send([F.hostId], { k: "back", fid: F.fid });
    render();
}

function hostLinkLost() {
    const H = F.H; if (!H?.arena) return;
    clearTimeout(H.turnTimer);                                 // a guest's 45 s must not run while its answer cannot reach me
    H.pause.add(SELF, null);
}
function hostLinkBack() {
    const H = F.H; if (!H?.arena) return;
    H.pause.remove(SELF);
    broadcast();                                               // everyone carries on from the current picture
    if (!H.pause.size) rearmTurn();
    releasePause();
}
   ```
   and add `LINK_TEXT` to the import in step 1: `import { createPause, createLink, pzText, SELF, LINK_TEXT } from "./mpbattle-pause.js";`.
8. `finish` (BAT:830-831): after `f.H?.pause?.clear();` add `    f.link?.clear();`.

- [ ] **Step 4: Code in `web/game.js`**

1. GAME:62: add `mpbLinkLost, mpbLinkBack, ` right after `mpbPeerBack, ` in the import list.
2. In the handler from Task 9 add after the `back` line:
   ```js
    else if (type === "linklost") mpbLinkLost();
    else if (type === "linkback") mpbLinkBack(d.resumed);
   ```

- [ ] **Step 5: Run `tests/mpbattle-pause-wiring.test.js`, `tests/mpbattle-pause.test.js`, `tests/mp-credit.test.js`, expect PASS.**

- [ ] **Step 6: Stop - no commit.** Every path ends in a snapshot, `left`, `end` or a timer: guest 60 s (`lost`), 10 s (`reconnected`), referee-away 60 s (`refWait`), referee link 60 s (`lost` on the referee). The screen itself is not provable in node.

---

## Task 11: Social dock: away players

**Files:**
- Modify: `web/mpsocial.js` (SOC:11 import; SOC:73 `badge`; SOC:104-122 `drawPlayers`; SOC:176, SOC:287, SOC:311, SOC:370, SOC:375, SOC:390; SOC:716-723 roster branch)
- Create: `tests/mpsocial-away.test.js`

**Interfaces:**
- Consumes: `peerHere`, `playingCount`, `peerOf` from `web/multiplayer.js` (Task 6).
- Produces: no new exports; away players show "(away)", get no Trade/Duel/Team up/Go buttons; the roster branch treats an away peer like a gone one (ends trade, duel not yet fighting, partner, party ask, co-op invite).

- [ ] **Step 1: Failing test** `tests/mpsocial-away.test.js` (the dock needs a DOM, so the real source lines are checked, as `tests/mp-credit.test.js` does; the behaviour behind `peerHere` is proven by Task 6)

```js
// web/mpsocial.js: a player who is away is not "here" for trades, duels, party, co-op and the player list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../web/mpsocial.js", import.meta.url), "utf8");

test("the multiplayer import carries peerHere and playingCount", () => {
    assert.match(src, /import \{[^}]*\bpeerHere\b[^}]*\bplayingCount\b[^}]*\} from "\.\/multiplayer\.js";|import \{[^}]*\bplayingCount\b[^}]*\bpeerHere\b[^}]*\} from "\.\/multiplayer\.js";/);
});

test("the roster branch asks peerHere, not peerOf, for all five waiting states", () => {
    const at = src.indexOf('else if (type === "roster") {');
    const body = src.slice(at, src.indexOf('else if (type === "trade") onTrade(d);'));
    for (const re of [/if \(trade && !peerHere\(trade\.id\)\)/, /if \(duel && !peerHere\(duel\.id\) && duel\.st !== "fight"\)/,
        /if \(partner != null && !peerHere\(partner\)\)/, /if \(partyAsk && !peerHere\(partyAsk\.id\)\)/, /if \(coop && !peerHere\(coop\.id\)\)/]) assert.match(body, re);
    assert.doesNotMatch(body, /peerOf\(/);
});

test("a duel that has not been answered when the other side is away ends as 'left before finishing'", () => {
    assert.match(src, /if \(!duel\.theirs\) \{ if \(!peerHere\(duel\.id\)\) endDuel\(`\$\{n\} left before finishing the duel\.`\); return; \}/);
    assert.match(src, /const p = peerHere\(duel\?\.id\);\s*if \(!p\) \{ endDuel\("They left\."\); return; \}/);
});

test("co-op and team-up are offered only to a partner who is here", () => {
    assert.match(src, /export const coopReady = \(\) => !!\(isOnline\(\) && partner != null && peerHere\(partner\) && /);
    assert.match(src, /if \(!\(isOnline\(\) && partner != null && peerHere\(partner\) && !coop && !duel && !trade\)\) return false;/);
});

test("asking an away player to trade, duel or team up says so instead of waiting forever", () => {
    assert.equal((src.match(/if \(p\.away\) \{ note\(`\$\{p\.name\} is away\.`\); return; \}/g) ?? []).length, 3);
});

test("the player list marks away players and gives them no actions but Inspect; the tab counts only the present", () => {
    assert.match(src, /p\.away \? h\("span", "sub", "  \(away\)"\) : ""/);
    assert.match(src, /if \(!p\.self && !p\.away\) \{\s*acts\.append\(btn\("Trade"/);
    assert.match(src, /const n = playingCount\(\);/);
});
```

- [ ] **Step 2: Run `tests/mpsocial-away.test.js`, expect FAIL.**

- [ ] **Step 3: Minimal code in `web/mpsocial.js`**

1. SOC:11: add `peerHere, playingCount, ` to the import (after `peerOf, `).
2. `badge` (SOC:73): replace `    const n = peerList().length + 1;` with `    const n = playingCount();`.
3. `drawPlayers` (SOC:104-122): in the final `el.players.append(h("div", "pl", h("div", "who", nm, p.self ? " (you)" : "", isChamp(p) ? h("span", "chmp", "  SERVER CHAMP") : ""), where, acts));` line, insert `p.away ? h("span", "sub", "  (away)") : "",` after the `p.self ? " (you)" : "",` argument; replace `        if (!p.self) {` (SOC:107) with `        if (!p.self && !p.away) {` (so the Trade / Duel / Team up / Go buttons are off for an away player; Inspect stays).
4. `askTrade` (SOC:176), `askDuel` (SOC:287) and `askParty` (SOC:390): each has the line `    const p = peerOf(id); if (!p) return;` — after it add `    if (p.away) { note(`${p.name} is away.`); return; }` (three places).
5. `startFight` (SOC:296-297): replace `    const p = peerOf(duel?.id);\n    if (!p) { endDuel("They left."); return; }` with `    const p = peerHere(duel?.id);\n    if (!p) { endDuel("They left."); return; }`.
6. `verdict` (SOC:311): replace `if (!peerOf(duel.id)) endDuel(` with `if (!peerHere(duel.id)) endDuel(`.
7. `coopReady` (SOC:370) and `coopTry` (SOC:375): replace `peerOf(partner)` with `peerHere(partner)` in both lines.
8. Roster branch (SOC:718-722): replace the five `!peerOf(...)` tests with `!peerHere(...)`: `trade && !peerHere(trade.id)`, `duel && !peerHere(duel.id) && duel.st !== "fight"`, `partner != null && !peerHere(partner)`, `partyAsk && !peerHere(partyAsk.id)`, `coop && !peerHere(coop.id)`.

- [ ] **Step 4: Run `tests/mpsocial-away.test.js`, `tests/multiplayer-social.test.js`, expect PASS.**

- [ ] **Step 5: Stop - no commit.** What a duel that is already fighting shows when the other side goes away: not known yet (spec edge case); this task makes the unanswered case end, and a fight in progress keeps today's behaviour.

---

## Final check (after Task 11, still no commit)

- [ ] Run once, each file separately, nothing else: `tests/multiplayer-rejoin-client.test.js`, `tests/multiplayer-rejoin-room.test.js`, `tests/multiplayer-rejoin-relay.test.js`, `tests/multiplayer-rejoin-ping.test.js`, `tests/mpbattle-pause.test.js`, `tests/mpbattle-pause-wiring.test.js`, `tests/mpsocial-away.test.js`, plus the existing `tests/multiplayer-relay.test.js`, `tests/multiplayer-room.test.js`, `tests/multiplayer-social.test.js`, `tests/mp-league.test.js`, `tests/mp-credit.test.js`, `tests/mp-enemy-counter-gate.test.js`.
- [ ] `git status --short` and confirm the change list is exactly: `server/room-core.mjs`, `server/relay.mjs`, `web/multiplayer.js`, `web/mpbattle.js`, `web/mpbattle-pause.js` (new), `web/mpsocial.js`, `web/game.js`, and the seven new test files. Nothing under `launcher/`, `packaging/`, `build_all.py`, installer or CI.
- [ ] Update `docs/multiplayer-how-it-works.md` sections 3 and 5 only if the user asks (the spec does not list it). Update the spec's "Not known yet (collected)" with what Tasks 1 to 11 settled: `web/multiplayer.js` loads in node (yes), `web/mpbattle.js` imports in node (yes; running a fight there is still not possible), the exact name-label lines in `web/mpsocial.js` (SOC:104-122).

## Self-review against the spec

- 2.1 seat key: relay-made 128-bit hex in `welcome` (Task 2 `makeKey`); localStorage `dw.mp.seat {base, room, key}` (Task 5); room stored with the key and a seat for another room ignored (Task 5 `seat for another room`); two tabs (Task 2 `two tabs`, Task 5 `second tab`, `Leave in tab two`); saved at welcome, cleared on Leave, `err no_room`, `err gone` (Task 5); 2 min away with id/name/place/card kept, name in URL ignored (Task 2); `welcome.at` returned (Task 2), client use after reload stays "not known yet"; host role passes at once and does not come back, plus the all-away gap (Task 2).
- 2.2 ping: 5 s for `rj`/`key` sockets, every 6th beat for the rest, `hub.sweep()` on the beat (Task 4); background-tab answer stays "not known yet".
- 2.3 retry: `mp.hadWelcome` read at MP:162/166, set at welcome, cleared by `disconnect(false)`, any `err` and give-up; wait formula unchanged; 1 + 5 sockets proven (Task 1).
- 2.4 fights: guest away -> `away` event -> `mpbPeerAway` -> `hostAway`, pause set, 60 s timer, `pz` in the snapshot, gates in `nextTurn`/`foeTurn`, `back` -> full snapshot and gate release with re-armed 45 s, expiry -> `hostGone`, a late `back` answered by `left` (Tasks 8, 9). Guest own link: `linklost` -> `mpbLinkLost`, `linkback` -> `back` + 10 s wait, not-resumed or timeout -> `finish(false, {fled:true, hostLeft:true})` (Tasks 6, 8, 10). Referee drop: guests `refWait` 60 s, referee own link holds the pause, no hand-over (Task 10).
- 2.5 always on and older clients: four rules in Tasks 2, 3, 4; no option anywhere (Global Constraints). `maxPeers` note pinned by the Task 2 `size` test.
- Section 3 per-file table: ROOM header comment, constructor `awayMs`, `open`, peer record, resume, same-key-live, `onClose` gen, `#close`/`#away`, `sweep`, guards in `#direct`/`#coop`/`#mpb`/trade ask (Tasks 2, 3); RELAY lines 56, 59, 70-76 (Tasks 2, 4); MP lines 42, 62, 92-93, 98/162/166, 101-113, 117-125, 158-167, 191-199, installMultiplayer page-start (Tasks 1, 5, 6, 7); BAT/GAME lines (Tasks 9, 10); SOC lines (Task 11); settings files untouched.
- Section 4 edge cases: two tabs, room ends while away (Task 2 sweep test), relay restart (Task 5 `no_room` test), referee drop (Task 10), trade pending (`reason: "away"`, Task 2), duel/team-up/co-op pending (Task 11), Server Champ (Task 2 `#dropFromNight`), stolen key (unchanged, no new door), rate limit (tokens reset in `#resume`), chat bubbles (`hidden = true` on `away`, Task 6).
- Section 5 tests: a (Task 2 relay file), b (Task 2 fake clock + Task 3 older client), c (Task 4, shortened with `pingMs`, constant pinned), d (Task 1), e (Tasks 8, 9, 10: pure part with the real `Arena`, wiring by source order; the screen is not provable, said above), f (Tasks 2 and 3 rerun the three existing relay files), g (Task 2 `two tabs`).
- Names checked consistent across tasks: `mp.hadWelcome`, `mp.lost`, `mp.autoTry`, `mp.autoTried`, `mp.defaultName`, `peerHere`, `playingCount`, `rejoinSaved`, `createPause`, `createLink`, `pzText`, `SELF`, `LINK_TEXT`, `AWAY_MS` (room-core 120000, mpbattle-pause 60000: different modules, different meaning, each named in its Global Constraint line), `BACK_WAIT_MS`, `hostAway`, `hostBack`, `hostLinkLost`, `hostLinkBack`, `releasePause`, `rearmTurn`, `armForcedTimer`, `mpbPeerAway`, `mpbPeerBack`, `mpbLinkLost`, `mpbLinkBack`, events `linklost`/`linkback`/`away`/`back`, message `bye`.
- Open items for the user (decisions I made where the spec was silent, listed above under "Added beyond the spec"): `bye`, host pick-up when everyone is away, my own turn stays usable during another player's pause.
