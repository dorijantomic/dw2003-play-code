// The host's battle rules in the relay (server/room-core.mjs): only the host may send them, the latest is kept per room,
// every joiner gets them in welcome, the others are told when they change, and a new host's rules replace the old ones.
import test from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../server/room-core.mjs";

function client(hub, opts) {
    const got = [];
    const r = hub.open((s) => got.push(JSON.parse(s)), { rj: true, ...opts });
    return { got, ...r, last: (t) => got.filter((m) => m.t === t).at(-1), all: (t) => got.filter((m) => m.t === t) };
}
const send = (c, o) => c.session.onMessage(JSON.stringify(o));
const RULES = { battlespeed: true, battleSpeed: 2, encounterdial: true, encounterDialMode: "rare", fusionbosses: false, bossphases: true, aishift: false, practice2v2: false };

test("only the host may send rules; a guest's rules are dropped", () => {
    const hub = new Hub();
    const host = client(hub, { create: true, name: "Ken" });
    const room = host.last("welcome").room;
    const guest = client(hub, { room, name: "Ana" });
    send(guest, { t: "rules", rules: { ...RULES, battleSpeed: 3 } });
    assert.equal(host.last("rules"), undefined);
    const late = client(hub, { room, name: "Bo" });
    assert.equal(late.last("welcome").rules, undefined);
});

test("a joiner gets the host's rules in welcome; the room is told when they change", () => {
    const hub = new Hub();
    const host = client(hub, { create: true, name: "Ken" });
    const room = host.last("welcome").room;
    assert.equal(host.last("welcome").rules, undefined);
    const early = client(hub, { room, name: "Ana" });
    send(host, { t: "rules", rules: RULES });
    assert.deepEqual(early.last("rules").rules, RULES);
    assert.equal(host.last("rules"), undefined);                 // not echoed to the sender
    const late = client(hub, { room, name: "Bo" });
    assert.deepEqual(late.last("welcome").rules, RULES);
    send(host, { t: "rules", rules: { ...RULES, battleSpeed: 3 } });
    assert.equal(early.last("rules").rules.battleSpeed, 3);
    assert.equal(late.last("rules").rules.battleSpeed, 3);
    assert.equal(client(hub, { room, name: "Cy" }).last("welcome").rules.battleSpeed, 3);   // the latest is kept
});

test("rules are cleaned: known keys, valid small values only; junk is ignored", () => {
    const hub = new Hub();
    const host = client(hub, { create: true, name: "Ken" });
    const room = host.last("welcome").room;
    const guest = client(hub, { room, name: "Ana" });
    send(host, { t: "rules", rules: { ...RULES, hack: "x", battleSpeed: 99, encounterDialMode: "evil", aishift: "yes", fusionbosses: true } });
    const r = guest.last("rules").rules;
    assert.equal("hack" in r, false);
    assert.equal(r.battleSpeed, 3);                              // clamped
    assert.equal("encounterDialMode" in r, false);
    assert.equal("aishift" in r, false);
    assert.equal(r.fusionbosses, true);
    send(host, { t: "rules", rules: "nonsense" });
    send(host, { t: "rules" });
    send(host, { t: "rules", rules: { hack: 1 } });
    assert.equal(guest.all("rules").length, 1);                  // nothing valid: nothing stored, nothing sent
});

test("too long a rules message is dropped by the relay's size limit", () => {
    const hub = new Hub();
    const host = client(hub, { create: true, name: "Ken" });
    const guest = client(hub, { room: host.last("welcome").room, name: "Ana" });
    send(host, { t: "rules", rules: { ...RULES, pad: "x".repeat(700) } });
    assert.equal(guest.last("rules"), undefined);
});

test("when the host leaves, the new host's rules replace the old ones", () => {
    const hub = new Hub();
    const host = client(hub, { create: true, name: "Ken" });
    const room = host.last("welcome").room;
    const ana = client(hub, { room, name: "Ana" });
    const bo = client(hub, { room, name: "Bo" });
    send(host, { t: "rules", rules: RULES });
    send(host, { t: "bye" });
    host.session.onClose();
    assert.equal(ana.last("host").id, ana.session.id);
    send(bo, { t: "rules", rules: { ...RULES, battleSpeed: 1 } });         // Bo is not the host now: dropped
    assert.equal(ana.last("rules").rules.battleSpeed, 2);
    send(ana, { t: "rules", rules: { ...RULES, battleSpeed: 3, practice2v2: true } });
    assert.equal(bo.last("rules").rules.battleSpeed, 3);
    assert.equal(bo.last("rules").rules.practice2v2, true);
    assert.equal(client(hub, { room, name: "Cy" }).last("welcome").rules.battleSpeed, 3);
});

test("a returning seat gets the latest rules in its welcome", () => {
    const hub = new Hub();
    const host = client(hub, { create: true, name: "Ken" });
    const room = host.last("welcome").room;
    const ana = client(hub, { room, name: "Ana" });
    const key = ana.last("welcome").key;
    send(host, { t: "rules", rules: RULES });
    ana.session.onClose();                                       // a drop: the seat is kept
    send(host, { t: "rules", rules: { ...RULES, battleSpeed: 1 } });
    const back = client(hub, { room, name: "Ana", key });
    assert.equal(back.last("welcome").resumed, true);
    assert.equal(back.last("welcome").rules.battleSpeed, 1);
});
