// Multiplayer social layer in the relay's room logic: chat, activity feed, player cards, who-is-where, trading.
import test from "node:test";
import assert from "node:assert/strict";
import { Hub, MAX_PEERS } from "../server/room-core.mjs";

function client(hub, opts) {
    const got = [];
    const r = hub.open((s) => got.push(JSON.parse(s)), opts);
    return { got, ...r, last: (t) => got.filter((m) => m.t === t).at(-1) };
}
const send = (c, o) => c.session.onMessage(JSON.stringify(o));
function pair(hub = new Hub()) {
    const a = client(hub, { create: true, name: "SENIOR" });
    const b = client(hub, { room: a.last("welcome").room, name: "Ana" });
    return { a, b, hub };
}

test("chat goes to the whole room, cleaned and rate limited; feed and card too", () => {
    let t = 1000;
    const { a, b } = pair(new Hub({ now: () => t }));
    send(a, { t: "chat", text: "  hi   <b>there</b>\n " });
    assert.deepEqual(b.last("chat"), { t: "chat", id: a.session.id, text: "hi b there /b", map: null });
    send(a, { t: "chat", text: "again" });                       // too soon
    assert.equal(b.got.filter((m) => m.t === "chat").length, 1);
    t += 700;
    send(a, { t: "chat", text: "x".repeat(500) });
    assert.equal(b.last("chat").text.length, 100);
    send(a, { t: "feed", kind: "level", text: "SENIOR's Agumon reached Lv 5" });
    send(a, { t: "feed", kind: "hack", text: "nope" });
    assert.deepEqual(b.got.filter((m) => m.t === "feed").map((m) => m.kind), ["level"]);
    send(a, { t: "card", card: { name: "SENIOR", lead: { name: "Agumon", level: 5 } } });
    send(a, { t: "card", card: { big: "y".repeat(3000) } });     // too big: ignored
    assert.equal(b.last("card").card.lead.level, 5);
    assert.equal(b.got.filter((m) => m.t === "card").length, 1);
});

test("everyone hears where a player is, and a late joiner gets cards and places in the roster", () => {
    const { a, b, hub } = pair();
    send(a, { t: "pos", map: "s200", x: 1, y: 2, dir: "down", mv: 0 });
    assert.deepEqual(b.last("at"), { t: "at", id: a.session.id, map: "s200" });
    send(a, { t: "card", card: { name: "SENIOR" } });
    const c = client(hub, { room: a.last("welcome").room, name: "Cy" });
    const first = c.last("welcome").roster.find((p) => p.id === a.session.id);
    assert.equal(first.map, "s200");
    assert.equal(first.card.name, "SENIOR");
});

test("trade: ask, accept, offers reset the OKs, both OK -> done for both with what each gives and gets", () => {
    const { a, b } = pair();
    const ida = a.session.id, idb = b.session.id;
    send(a, { t: "trade", op: "ask", to: idb });
    assert.deepEqual(b.last("trade"), { t: "trade", op: "ask", from: ida });
    send(b, { t: "trade", op: "yes" });
    assert.equal(a.last("trade").op, "open");
    send(a, { t: "trade", op: "offer", items: [{ id: 7, qty: 2, name: "Recovery" }, { id: 7, qty: 1 }, { id: -1, qty: 1 }], bits: 50 });
    assert.deepEqual(b.last("trade").items, [{ id: 7, qty: 2, name: "Recovery" }]);   // duplicate and bad ids dropped
    send(a, { t: "trade", op: "ok" });
    send(b, { t: "trade", op: "offer", items: [], bits: 10 });                         // changing an offer clears the OKs
    send(b, { t: "trade", op: "ok" });
    assert.equal(a.got.some((m) => m.op === "done"), false);
    send(a, { t: "trade", op: "ok" });
    assert.deepEqual(a.last("trade"), { t: "trade", op: "done", gives: { items: [{ id: 7, qty: 2, name: "Recovery" }], bits: 50 }, gets: { items: [], bits: 10 } });
    assert.deepEqual(b.last("trade").gets, { items: [{ id: 7, qty: 2, name: "Recovery" }], bits: 50 });
    send(a, { t: "trade", op: "ok" });                                                  // nothing is open any more
    assert.equal(a.got.filter((m) => m.op === "done").length, 1);
});

test("trade ends cleanly when declined, cancelled, or the partner leaves; nobody is in two trades", () => {
    const { a, b, hub } = pair();
    const c = client(hub, { room: a.last("welcome").room, name: "Cy" });
    send(a, { t: "trade", op: "ask", to: b.session.id });
    send(c, { t: "trade", op: "ask", to: b.session.id });
    assert.deepEqual(c.last("trade"), { t: "trade", op: "end", reason: "busy" });
    send(b, { t: "trade", op: "no" });
    assert.deepEqual(a.last("trade"), { t: "trade", op: "end", reason: "declined" });
    send(a, { t: "trade", op: "ask", to: b.session.id });
    send(b, { t: "trade", op: "yes" });
    b.session.onClose();
    assert.deepEqual(a.last("trade"), { t: "trade", op: "end", reason: "left" });
    send(a, { t: "trade", op: "ask", to: c.session.id });                               // free again
    assert.equal(c.last("trade").op, "ask");
});

test("rooms hold 50 by default and maxPeers can be changed", () => {
    assert.equal(MAX_PEERS, 50);
    const hub = new Hub({ maxPeers: 2 });
    const a = client(hub, { create: true });
    const room = a.last("welcome").room;
    assert.ok(client(hub, { room }).session);
    assert.equal(client(hub, { room }).error, "full");
});

test("duel messages go only to the player they name, with the sender filled in and results cleaned", () => {
    const { a, b, hub } = pair();
    const c = client(hub, { room: a.last("welcome").room, name: "Cy" });
    send(a, { t: "duel", op: "ask", to: b.session.id });
    assert.deepEqual(b.last("duel"), { t: "duel", op: "ask", from: a.session.id });
    assert.equal(c.last("duel"), undefined);
    send(b, { t: "duel", op: "yes", to: a.session.id, from: 999 });          // "from" cannot be forged
    assert.deepEqual(a.last("duel"), { t: "duel", op: "yes", from: b.session.id });
    send(a, { t: "duel", op: "result", to: b.session.id, hp: 7, won: 1 });
    assert.deepEqual(b.last("duel"), { t: "duel", op: "result", from: a.session.id, hp: 1, won: true });
    send(a, { t: "duel", op: "explode", to: b.session.id });                  // unknown op ignored
    send(a, { t: "duel", op: "ask", to: a.session.id });                      // not to myself
    send(a, { t: "duel", op: "ask", to: 12345 });                             // nobody there
    assert.equal(b.got.filter((m) => m.t === "duel").length, 2);
});

test("co-op messages: foes are cleaned, hits are bounds-checked, the sender is filled in", () => {
    const { a, b } = pair();
    send(a, { t: "coop", op: "pask", to: b.session.id });
    assert.deepEqual(b.last("coop"), { t: "coop", op: "pask", from: a.session.id });
    send(a, { t: "coop", op: "ask", to: b.session.id, label: "Boss <x>", foes: [
        { name: "Kunemon", level: 5, hp: 120, mp: 10, stat_scale: 16 }, { name: "", level: 5, hp: 1 }, { name: "Bad", level: 500, hp: 1 }, null] });
    const ask = b.last("coop");
    assert.deepEqual(ask.foes, [{ name: "Kunemon", level: 5, hp: 120, mp: 10, stat_scale: 16 }]);
    assert.equal(ask.label, "Boss x");
    const before = b.got.length;
    send(a, { t: "coop", op: "ask", to: b.session.id, foes: [] });                  // nothing to fight: ignored
    send(a, { t: "coop", op: "hit", to: b.session.id, i: 0, hp: -5 });             // out of range: ignored
    send(a, { t: "coop", op: "hit", to: b.session.id, i: 99, hp: 5 });
    send(a, { t: "coop", op: "bogus", to: b.session.id });
    assert.equal(b.got.length, before);
    send(a, { t: "coop", op: "hit", to: b.session.id, i: 1, hp: 77 });
    assert.deepEqual(b.last("coop"), { t: "coop", op: "hit", from: a.session.id, i: 1, hp: 77 });
});

test("fight messages go to the named players only, with the sender filled in, and are size limited", () => {
    const { a, b, hub } = pair();
    const c = client(hub, { room: a.last("welcome").room, name: "Cy" });
    send(a, { t: "mpb", to: [b.session.id], d: { k: "setup", fid: 1 } });
    assert.deepEqual(b.last("mpb"), { t: "mpb", from: a.session.id, d: { k: "setup", fid: 1 } });
    assert.equal(c.last("mpb"), undefined);
    send(a, { t: "mpb", to: [b.session.id, c.session.id, a.session.id, 999], d: { k: "st" } });
    assert.equal(c.got.filter((m) => m.t === "mpb").length, 1);
    assert.equal(a.got.filter((m) => m.t === "mpb").length, 0);                // not back to the sender
    send(a, { t: "mpb", to: [b.session.id], d: { k: "big", pad: "x".repeat(1600) } });   // too big
    send(a, { t: "mpb", to: [b.session.id], d: [1, 2] });                       // not an object
    assert.equal(b.got.filter((m) => m.t === "mpb").length, 2);
});
