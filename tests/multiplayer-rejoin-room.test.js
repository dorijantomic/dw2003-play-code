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
