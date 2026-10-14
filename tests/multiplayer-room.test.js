// The multiplayer relay's room logic (server/room-core.mjs): codes, joining, who is told what, and the safety limits.
import test from "node:test";
import assert from "node:assert/strict";
import { Hub, cleanCode, cleanName, makeCode, MAX_PEERS, MAX_ROOMS } from "../server/room-core.mjs";

function client(hub, opts) {
    const got = [];
    const r = hub.open((s) => got.push(JSON.parse(s)), opts);
    return { got, ...r, last: (t) => got.filter((m) => m.t === t).at(-1) };
}
const send = (c, o) => c.session.onMessage(JSON.stringify(o));
const pos = (map, x = 10, y = 20, extra = {}) => ({ t: "pos", map, x, y, dir: "down", mv: 0, ...extra });

test("codes use only unambiguous letters and are accepted case-insensitively", () => {
    const c = makeCode();
    assert.match(c, /^[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(cleanCode(c.toLowerCase()), c);
    assert.equal(cleanCode("ab-cde"), "ABCDE");
    assert.equal(cleanCode("abcd"), null);
});

test("a created room welcomes its first player with the code", () => {
    const hub = new Hub();
    const a = client(hub, { create: true, name: "Ken" });
    assert.ok(a.session);
    const w = a.last("welcome");
    assert.equal(w.room.length, 5);
    assert.deepEqual(w.roster, []);
});

test("joining needs an existing room; the roster and join events are sent", () => {
    const hub = new Hub();
    const a = client(hub, { create: true, name: "Ken" });
    const room = a.last("welcome").room;
    assert.equal(client(hub, { room: "ZZZZZ" }).error, "no_room");
    assert.equal(client(hub, { room: "no" }).error, "bad");
    const b = client(hub, { room: room.toLowerCase(), name: "Ana" });
    assert.deepEqual(b.last("welcome").roster, [{ id: a.session.id, name: "Ken" }]);
    assert.deepEqual(a.last("join"), { t: "join", id: b.session.id, name: "Ana" });
});

test("a room holds at most MAX_PEERS and is deleted when the last player leaves", () => {
    const hub = new Hub();
    const first = client(hub, { create: true });
    const room = first.last("welcome").room;
    const rest = [];
    for (let i = 1; i < MAX_PEERS; i++) rest.push(client(hub, { room }));
    assert.equal(client(hub, { room }).error, "full");
    first.session.onClose();
    rest.forEach((c) => c.session.onClose());
    assert.equal(hub.rooms.size, 0);
});

test("positions only reach players in the same stage; leaving a stage sends 'gone'", () => {
    const hub = new Hub();
    const a = client(hub, { create: true });
    const room = a.last("welcome").room;
    const b = client(hub, { room });
    const c = client(hub, { room });
    send(a, pos("s330"));
    send(b, pos("s330", 50, 60));
    send(c, pos("s415"));
    assert.equal(a.last("pos").id, b.session.id);           // a sees b
    assert.equal(b.last("pos").id, a.session.id);           // b sees a (also the catch-up on entering)
    assert.equal(c.got.filter((m) => m.t === "pos").length, 0);   // c is elsewhere and nobody else is there
    send(b, pos("s415", 1, 2));                              // b walks into c's stage
    assert.deepEqual(a.last("gone"), { t: "gone", id: b.session.id });
    assert.equal(c.last("pos").id, b.session.id);
    assert.equal(b.last("pos").id, c.session.id);            // b is shown who is already there
});

test("emotes reach the same stage only, and only the numbers 0..7", () => {
    const hub = new Hub();
    const a = client(hub, { create: true });
    const room = a.last("welcome").room;
    const b = client(hub, { room });
    const c = client(hub, { room });
    [a, b].forEach((x) => send(x, pos("s330")));
    send(c, pos("s415"));
    send(a, { t: "emote", e: 3 });
    send(a, { t: "emote", e: 99 });
    send(a, { t: "emote", e: "x" });
    assert.deepEqual(b.got.filter((m) => m.t === "emote"), [{ t: "emote", id: a.session.id, e: 3 }]);
    assert.equal(c.got.filter((m) => m.t === "emote").length, 0);
});

test("bad input is ignored: junk JSON, huge or non-finite numbers, odd map ids, oversize messages", () => {
    const hub = new Hub();
    const a = client(hub, { create: true });
    const b = client(hub, { room: a.last("welcome").room });
    send(b, pos("s330"));
    const before = b.got.length;
    a.session.onMessage("not json");
    a.session.onMessage("x".repeat(1000));
    send(a, pos("s330", 1e12, 0));
    send(a, pos("s330", NaN, 0));
    send(a, pos("../etc", 1, 1));
    send(a, pos("s330", 1, 1, { dir: "<script>" }));          // the direction is replaced, the position still counts
    assert.equal(b.got.length - before, 1);
    assert.equal(b.last("pos").dir, "down");
});

test("a player who floods messages is rate limited", () => {
    let t = 0;
    const hub = new Hub({ now: () => t });
    const a = client(hub, { create: true });
    const b = client(hub, { room: a.last("welcome").room });
    send(b, pos("s330"));
    for (let i = 0; i < 1000; i++) send(a, pos("s330", i, 0));
    assert.ok(b.got.filter((m) => m.t === "pos").length < 200);
    t += 2000;                                                // a couple of seconds later it may talk again
    send(a, pos("s330", 5, 5));
    assert.equal(b.last("pos").x, 5);
});

test("names are cleaned and a relay refuses new rooms once it is full", () => {
    assert.equal(cleanName("  <b>Ken</b>\u0007 with a very long name  "), "bKen/b with");
    assert.equal(cleanName(""), "Tamer");
    const hub = new Hub();
    for (let i = 0; i < MAX_ROOMS; i++) client(hub, { create: true });
    assert.equal(client(hub, { create: true }).error, "busy");
});
