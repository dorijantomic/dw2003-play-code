// The fight pause (web/mpbattle-pause.js): the pure rules of who is away, what waits, which timer ends. Real Arena for the order-of-actions check.
import test from "node:test";
import assert from "node:assert/strict";
import { Arena } from "../web/mpbattle-rules.js";
import { createPause, createLink, pzText, AWAY_MS, BACK_WAIT_MS, SELF, LINK_TEXT } from "../web/mpbattle-pause.js";

// Arena's choice of WHICH player a foe hits is Math.random (web/mpbattle-rules.js:468 — the game's own table does not cover it).
// A fixed value keeps the two runs below comparable call for call; nothing else in the arena reads it.
Math.random = () => 0.5;

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
