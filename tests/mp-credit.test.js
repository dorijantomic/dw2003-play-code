// The shared kill: a co-op win counts for both tamers' quests.
//
// In a normal fight the game emits `battleWon` from web/battle.js and the quest layer ticks the "defeat" steps.
// A many-vs-many co-op fight (web/mpbattle.js) never did: it ends in its own `finish`, which said nothing to the
// quest layer on either machine. Now a real co-op win (a second HUMAN was in the fight; a practice 2v2 with a
// computer partner is not one) emits one `battleWon` on both machines, because both call `finish`.
//
// The fight's map is the HOST's: a guest can join from another stage, so `A.mapId()` would name the guest's own
// map and a "defeat on this map" step would never tick. The host's map rides the existing `setup` packet and
// `finish` reads `f.mapId`.
//
// The pure event builder is web/mp-credit.js; the wiring is proved against the real sources and the real quest
// layer (web/quests.js) with a fixture quest, as tests/quest-arrival-trigger.test.js does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { winEvent, sameEvent } from "../web/mp-credit.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ---------------------------------------------------------------- the pure event builder
const KUNE = { name: "Kunemon", level: 5, hp: 60, mp: 20, stat_scale: 16 };
const AGUM = { name: "Agumon", level: 6, hp: 80, mp: 30, stat_scale: 16 };

test("winEvent: the fight's enemies by name, with the fight's own map and screen", () => {
    const host = winEvent([KUNE, AGUM], { mapId: "s330", screenId: 12 });
    assert.deepEqual(host, { enemies: ["Kunemon", "Agumon"], mapId: "s330", screenId: 12 });

    // the guest builds the event from what the setup packet carried: the same foes, the host's map
    const packet = JSON.parse(JSON.stringify({ foes: [KUNE, AGUM], mapId: "s330", screenId: 12 }));
    const guest = winEvent(packet.foes, { mapId: packet.mapId, screenId: packet.screenId });
    assert.ok(sameEvent(host, guest), "host and guest name the same fight");

    // a bare name is a name too, and a missing screen is simply unknown
    assert.deepEqual(winEvent(["Kunemon"], { mapId: "s330" }), { enemies: ["Kunemon"], mapId: "s330", screenId: null });
});

test("winEvent: no foe carrying a name is no event at all", () => {
    assert.equal(winEvent([], { mapId: "s330" }), null);
    assert.equal(winEvent(null, { mapId: "s330" }), null);
    assert.equal(winEvent(undefined, {}), null);
    assert.equal(winEvent([{}, { name: "" }, { name: 7 }, null], { mapId: "s330" }), null);
    // one named foe among the junk is enough (the junk itself is dropped)
    assert.deepEqual(winEvent([{}, KUNE, { name: null }], { mapId: "s330", screenId: null }), { enemies: ["Kunemon"], mapId: "s330", screenId: null });
});

test("sameEvent: one fight seen from two machines; another map, other foes or no event is not the same", () => {
    const a = winEvent([KUNE, AGUM], { mapId: "s330", screenId: 12 });
    assert.ok(sameEvent(a, winEvent([KUNE, AGUM], { mapId: "s330", screenId: 12 })));
    assert.ok(sameEvent(null, null), "both machines with nothing to credit are the same nothing");
    assert.equal(sameEvent(a, null), false);
    assert.equal(sameEvent(null, a), false);
    assert.equal(sameEvent(a, winEvent([KUNE, AGUM], { mapId: "s331", screenId: 12 })), false, "another map");
    assert.equal(sameEvent(a, winEvent([KUNE, AGUM], { mapId: "s330", screenId: 13 })), false, "another screen");
    assert.equal(sameEvent(a, winEvent([KUNE], { mapId: "s330", screenId: 12 })), false, "another line-up");
    // the same event written out plainly compares equal: the shape is the whole record
    assert.ok(sameEvent(a, { enemies: ["Kunemon", "Agumon"], mapId: "s330", screenId: 12 }));
});

// ---------------------------------------------------------------- the sources
const mpb = () => read("../web/mpbattle.js");

test("source: a co-op win emits battleWon once, inside the won-and-not-fled branch, on a real second human", () => {
    const src = mpb();
    assert.match(src, /import \{ emit \} from "\.\/gameEvents\.js";/, "the game's event bus");
    assert.match(src, /import \{ winEvent \} from "\.\/mp-credit\.js";/, "the pure event builder");

    const wonAt = src.indexOf("if (won && !fled) {");
    const emitAt = src.indexOf('emit("battleWon"');
    const restoreAt = src.indexOf("if (!won && !fled) A.restore");
    assert.ok(wonAt >= 0, "finish still has its won-and-not-fled branch");
    assert.ok(emitAt > wonAt, "the emit sits inside that branch");
    assert.ok(restoreAt > emitAt, "and before the loss arm");
    assert.equal(src.split('emit("battleWon"').length - 1, 1, "once per fight, never twice");

    const branch = src.slice(wonAt, emitAt);
    assert.match(branch, /window\.__fx\?\.mpcredit/, "F2 -> Extras -> Co-op wins count for quests gates it (off = no event)");
    assert.match(branch, /people\(f\.ids, f\)\.length > 0/, "only a real second human, never a practice bot");
    assert.match(src, /winEvent\(f\.foes, \{ mapId: f\.mapId, screenId: f\.screenId \}\)/, "the event names the fight's own foes and map");
});

test("source: the host's map rides the setup packet; a guest's begin reads setup.mapId; a guest passes it on", () => {
    const src = mpb();
    assert.match(src, /mapId: setup\.mapId \?\? A\.mapId\?\.\(\) \?\? null/, "begin keeps the fight's map (fallback: my own map)");
    assert.match(src, /k: "setup",[^\n]*mapId: F\.mapId/, "the setup packet carries it");
    assert.match(src, /mapId: d\.mapId/, "a guest's setup message passes the packet's map to begin");
    assert.match(src, /mapId: A\.mapId\?\.\(\)/, "the host's fight is stamped with the host's map at mpbHost");
    // the guest must never overwrite it with its own current map inside finish
    assert.doesNotMatch(src.slice(src.indexOf("function finish"), src.indexOf("// ------------------------------------------------------------ install")), /A\.mapId\?\.\(\)/,
        "finish reads f.mapId, never the machine's own map");
});

test("the F2 switch is an Extras row, off by default, never a URL flag", () => {
    const amb = read("../web/ambience.js");
    assert.match(amb, /\["mpcredit", "Co-op wins count for quests"\]/, "the Extras row");
    const experimental = amb.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"mpcredit"/, "off until the player switches it on");
    assert.doesNotMatch(amb, /(get|has)\(\s*["']mpcredit["']\s*\)/, "never a URL flag");
});

// ---------------------------------------------------------------- the real wiring: web/quests.js
// The quest layer is a browser module (it imports web/ambience.js for the F2 flags), so this file stands in for the few
// browser globals it touches and serves the small JSON files it fetches (the same shim as tests/quest-arrival-trigger.test.js).
const store = Object.create(null);
globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};
store["dw.quests.v1"] = JSON.stringify({ v: 1, active: {}, done: {}, visited: [], met: [], duelWins: 0, announced: {}, seen: {}, triggers: {}, gen: { n: 0, def: null } });
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
if (typeof globalThis.addEventListener !== "function") globalThis.addEventListener = () => {};
globalThis.location = { search: "" };
globalThis.document = {
    head: { appendChild() {} },
    createElement: () => ({ style: {}, textContent: "" }),
    getElementById: () => null,
    addEventListener() {},
};
const FIXTURE = { id: "fixture", title: "A fixture quest", objectives: [{ type: "defeat", species: ["Kunemon"], count: 3, maps: ["s330"] }] };
const FILES = {
    "quests.json": { quests: [FIXTURE] },
    "map-variants.json": {},
    "assets/manifest.json": { maps: [] },
    "assets/data/field_encounters.json": { screens: {} },
    "assets/data/stage_encounters.json": { stages: {} },
};
globalThis.fetch = async (url) => {
    const key = String(url);
    return key in FILES ? { ok: true, json: async () => FILES[key] } : { ok: false, json: async () => ({}) };
};

test("wiring: co-op wins tick a defeat step on the fight's own map; another map or another foe never counts", async () => {
    const { fx } = await import("../web/ambience.js");
    const { installQuests } = await import("../web/quests.js");
    const { emit } = await import("../web/gameEvents.js");
    await installQuests({ stageEl: { append() {} }, idle: () => true });
    const q = globalThis.__quests;
    assert.ok(q, "the quest layer installed");
    assert.equal(fx.mpcredit, true, "Co-op wins count for quests starts on (auto in web/ship-list.js)");

    const begin = () => { q.lab.reset(); assert.equal(q.accept("fixture"), true, "the fixture quest is accepted"); };
    const win = (mapId = "s330", name = "Kunemon") => winEvent([{ name, level: 5 }], { mapId, screenId: 4 });
    const doWin = (ev) => { if (ev) emit("battleWon", ev); };          // mpbattle emits only a real event
    const progress = () => q.state.active.fixture.p[0];

    begin();
    for (let i = 0; i < 3; i++) doWin(win());
    assert.equal(progress(), 3, "3 of 3");
    assert.equal(q.status("fixture"), "ready");

    begin();
    doWin(win()); doWin(win());
    assert.equal(progress(), 2, "2 of 3");
    assert.equal(q.status("fixture"), "active");

    begin();
    doWin(win("s331"));
    assert.equal(progress(), 0, "a fight on another map is not this step");

    begin();
    doWin(win("s330", "Agumon"));
    assert.equal(progress(), 0, "another species is not this step");

    // the guest's event is built from the setup packet: the host's foes and the host's map
    begin();
    const packet = JSON.parse(JSON.stringify({ foes: [{ name: "Kunemon", level: 5 }], mapId: "s330", screenId: 4 }));
    doWin(winEvent(packet.foes, { mapId: packet.mapId, screenId: packet.screenId }));
    assert.equal(progress(), 1, "the guest's own machine credits the same quest");
});
