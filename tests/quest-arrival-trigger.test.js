// Arrival quest scenes (web/quest-triggers.js): a trigger with "on": "enter" and no rectangle fires on the first field
// tick of a map load, not because the player walked into a patch. That is the disc's own commonest scene shape: every
// place's entry object asks its candidate chain once per field load and starts at most one event
// (engine/systems/scene-arrival.ts; the reset band runs once per field load,
// docs/research/scripting/field-script-engine-verified.md:1473-1512). The record, the gate vocabulary and the scene
// runner are the walk-in triggers' own; only the condition is the map load instead of a rectangle.
//
// The pure decision (arrivalTrigger) and the runner's arm are proved with plain values; then the source order, the
// build-time checker and its refusal of an ambiguous row are proved against the real tree and a tiny fake one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { arrivalTrigger, installTriggers } from "../web/quest-triggers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CHECKER = join(ROOT, "tools", "check_triggers.mjs");
const load = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------- the pure decision and the runner
const MAP = "s330";                                  // Asuka's street: a real stage id
const OTHER = "s205";                                // the Bridge: a different load
const STATUSES = ["available", "active", "ready", "done"];
const enter = (over = {}) => ({ id: "hello", map: MAP, on: "enter", scene: [{ wait: 1 }], ...over });
const state = () => ({ triggers: {} });
const baseCtx = (over = {}) => ({
    enabled: () => true,
    statusOf: () => "active",
    idle: () => true,
    dialogBusy: false,
    battle: false,
    ...over,
});

test("arrivalTrigger: only on-enter rows of this map; a rectangle is not the condition", () => {
    const row = enter();
    assert.equal(arrivalTrigger([row], MAP, state(), baseCtx())?.id, "hello");
    assert.equal(arrivalTrigger([row], OTHER, state(), baseCtx()), null, "another map");
    // a walk-in rectangle on the same map is not an arrival row
    const rect = { id: "patch", map: MAP, rect: [100, 100, 40, 40], scene: [{ wait: 1 }] };
    assert.equal(arrivalTrigger([rect], MAP, state(), baseCtx()), null);
    // a fired mark keeps a once:true row quiet; once:false is asked again
    const fired = { triggers: { hello: 1 } };
    assert.equal(arrivalTrigger([row], MAP, fired, baseCtx()), null);
    assert.ok(arrivalTrigger([enter({ once: false })], MAP, fired, baseCtx()));
});

test("arrivalTrigger: the when gate is the walk-in vocabulary, an unknown quest never fires and nothing throws", () => {
    for (const status of STATUSES) {
        const row = enter({ when: { quest: "q1", status } });
        assert.ok(arrivalTrigger([row], MAP, state(), baseCtx({ statusOf: () => status })), `fires at ${status}`);
        for (const other of STATUSES.filter((s) => s !== status)) {
            assert.equal(arrivalTrigger([row], MAP, state(), baseCtx({ statusOf: () => other })), null, `${status} gate vs ${other}`);
        }
    }
    assert.equal(arrivalTrigger([enter({ when: { quest: "q1", status: "active" } })], MAP, state(), baseCtx({ statusOf: () => "locked" })), null);
    assert.equal(arrivalTrigger([enter({ when: { quest: "nope", status: "active" } })], MAP, state(), baseCtx({ statusOf: () => null })), null);
    assert.equal(arrivalTrigger([enter({ when: { quest: "q1" } })], MAP, state(), baseCtx()), null);
});

test("arrivalTrigger: a busy game, a quest dialog, a quest fight and the F2 switch off all refuse", () => {
    for (const [what, ctx] of [
        ["idle() false", baseCtx({ idle: () => false })],
        ["a quest dialog", baseCtx({ dialogBusy: true })],
        ["a quest fight", baseCtx({ battle: true })],
        ["F2 -> Extras -> Quest triggers off", baseCtx({ enabled: () => false })],
    ]) {
        assert.equal(arrivalTrigger([enter()], MAP, state(), ctx), null, what);
    }
});

test("the first tick of a load fires once; a walk tick and another map never do; a new load fires again", async () => {
    const st = state();
    let plays = 0;
    const runner = installTriggers([enter({ once: false })], baseCtx({
        state: () => st,
        playScene: () => { plays++; return { answer: null }; },
        save() {},
    }));
    // the first tick of the load has no previous place: the map load IS the condition
    assert.deepEqual(await runner.tick(MAP, null, null, 100, 100), { answer: null });
    assert.equal(plays, 1);
    // the next tick has a real previous place: an arrival row is not a patch, so it stays quiet
    assert.equal(await runner.tick(MAP, 100, 100, 110, 100), null);
    assert.equal(plays, 1);
    // never on another map, even on that map's own first tick
    assert.equal(await runner.tick(OTHER, null, null, 10, 10), null);
    assert.equal(plays, 1);
    // another map change back is a new load: once:false fires again
    assert.deepEqual(await runner.tick(MAP, null, null, 100, 100), { answer: null });
    assert.equal(plays, 2);
});

test("busy on the load tick: the row stays armed for this load and fires exactly once when the game is idle", async () => {
    const st = state();
    let plays = 0, idle = false;
    const runner = installTriggers([enter()], baseCtx({
        state: () => st,
        idle: () => idle,
        playScene: () => { plays++; return { answer: null }; },
        save() {},
    }));
    assert.equal(await runner.tick(MAP, null, null, 100, 100), null, "the load tick is busy (the game's own arrival chain)");
    assert.equal(plays, 0);
    assert.equal(await runner.tick(MAP, 100, 100, 110, 100), null, "still busy");
    assert.equal(plays, 0);
    idle = true;                                       // the arrival chain (or a menu) is over
    assert.deepEqual(await runner.tick(MAP, 110, 100, 120, 100), { answer: null });
    assert.equal(plays, 1, "fires on the first idle tick");
    assert.equal(await runner.tick(MAP, 120, 100, 130, 100), null);
    assert.equal(plays, 1, "one arrival scene per field load, even while the game stays idle");
});

test("one arrival scene per load: two passing rows start one, once:true is marked once, once:false fires again", async () => {
    const st = state();
    const played = [];
    let saves = 0;
    const rows = [enter({ id: "first", once: true, scene: [{ wait: 1 }] }), enter({ id: "second", once: false, scene: [{ wait: 2 }] })];
    const runner = installTriggers(rows, baseCtx({
        state: () => st,
        playScene: (scene) => { played.push(scene); return { answer: null }; },
        save: () => saves++,
    }));
    await runner.tick(MAP, null, null, 100, 100);
    assert.deepEqual(played, [[{ wait: 1 }]], "the first passing row, exactly one scene");
    assert.ok(st.triggers.first, "once:true wrote its fired mark");
    assert.equal(saves, 1, "one save");
    // leave and come back: the first row is marked, so the second (once:false) is the first one passing
    await runner.tick(OTHER, null, null, 10, 10);
    await runner.tick(MAP, null, null, 100, 100);
    assert.deepEqual(played, [[{ wait: 1 }], [{ wait: 2 }]]);
    // a third load: the once:true row stays quiet, the once:false row fires again
    await runner.tick(OTHER, null, null, 10, 10);
    await runner.tick(MAP, null, null, 100, 100);
    assert.equal(played.length, 3);
    assert.deepEqual(played[2], [{ wait: 2 }]);
    assert.equal(saves, 3);
});

test("a failing gate or an unknown quest starts no scene; the switch off never calls playScene", async () => {
    let plays = 0;
    const ctx = baseCtx({
        state,
        statusOf: () => "done",
        playScene: () => { plays++; return { answer: null }; },
        save() {},
    });
    const gated = installTriggers([enter({ when: { quest: "q1", status: "active" } })], ctx);
    assert.equal(await gated.tick(MAP, null, null, 100, 100), null);
    assert.equal(plays, 0, "the gate does not hold");
    // and the decision is made once per load: the gate turning true later in the same visit does not fire it
    ctx.statusOf = () => "active";
    assert.equal(await gated.tick(MAP, 100, 100, 110, 100), null);
    assert.equal(plays, 0);

    const unknown = installTriggers([enter({ when: { quest: "nope", status: "active" } })], baseCtx({
        state, statusOf: () => null, playScene: () => { plays++; return { answer: null }; }, save() {},
    }));
    assert.equal(await unknown.tick(MAP, null, null, 100, 100), null);
    assert.equal(plays, 0, "an unknown quest id is not a gate that holds");

    const off = installTriggers([enter()], baseCtx({ enabled: () => false, state, playScene: () => { plays++; return { answer: null }; } }));
    assert.equal(await off.tick(MAP, null, null, 100, 100), null);
    assert.equal(plays, 0, "F2 -> Extras -> Quest triggers off");
});

// ---------------------------------------------------------------- the real wiring: web/quests.js
// The quest layer is a browser module (it imports web/ambience.js for the F2 flags), so this file stands in for the few
// browser globals it touches and serves the small JSON files it fetches. questsTick already passes prev null on a map
// change; this proves an arrival row rides that existing call.
const store = Object.create(null);
globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};
store["dw.quests.v1"] = JSON.stringify({ v: 1, active: {}, done: {}, visited: [] });   // an older save: no `triggers` yet
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
if (typeof globalThis.addEventListener !== "function") globalThis.addEventListener = () => {};
globalThis.location = { search: "" };
globalThis.document = {
    head: { appendChild() {} },
    createElement: () => ({ style: {}, textContent: "" }),
    getElementById: () => null,
    addEventListener() {},
};
const FILES = {
    "quests.json": { quests: [], triggers: [{ id: "arrive_wire", map: "s200", on: "enter", scene: [{ wait: 1 }] }] },
    "map-variants.json": {},
    "assets/manifest.json": { maps: [{ id: "s200", name: "A place" }] },
    "assets/data/field_encounters.json": { screens: {} },
    "assets/data/stage_encounters.json": { stages: {} },
};
globalThis.fetch = async (url) => {
    const key = String(url);
    return key in FILES ? { ok: true, json: async () => FILES[key] } : { ok: false, json: async () => ({}) };
};

test("wiring: a map load through quests.js starts the arrival scene with the switch on and never with it off", async () => {
    const { fx } = await import("../web/ambience.js");
    const { installQuests, questsTick } = await import("../web/quests.js");
    let plays = 0;
    await installQuests({
        stageEl: { append() {} },
        idle: () => true,
        scene: async () => { plays++; return { answer: null }; },
    });
    const q = globalThis.__quests;
    assert.ok(q, "the quest layer installed");
    assert.notEqual(fx.questtriggers, true, "Quest triggers starts off");
    questsTick("s200", 100, 100);                       // the first tick of the load, switch off
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(plays, 0, "no arrival test with the switch off");
    assert.deepEqual(q.state.triggers, {}, "no fired mark with the switch off");
    fx.questtriggers = true;
    questsTick("s205", 10, 10);                         // another map loads: nothing authored there
    questsTick("s200", 100, 100);                       // and this one: prev null is the arrival tick
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(plays, 1, "the authored arrival scene played on the load");
    assert.ok(q.state.triggers.arrive_wire, "the row is marked");
    questsTick("s200", 110, 100);                       // a walk tick is not a second load
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(plays, 1, "once:true keeps it quiet on the same load");
});

// ---------------------------------------------------------------- the source order
test("source: the arrival arm sits before the prev == null early return in the runner", () => {
    const src = readFileSync(join(ROOT, "web", "quest-triggers.js"), "utf8");
    const tickAt = src.indexOf("tick(mapId");
    assert.ok(tickAt > 0, "the runner has a tick");
    const body = src.slice(tickAt);
    const arrivalAt = body.indexOf("arrivalTrigger(");
    const returnAt = body.indexOf("prevX == null || prevY == null) return null");
    assert.ok(arrivalAt >= 0, "tick calls arrivalTrigger");
    assert.ok(returnAt >= 0, "tick still has its prev == null early return");
    assert.ok(arrivalAt < returnAt, "the arrival arm runs before the early return");
});

// ---------------------------------------------------------------- the build-time checker on a tiny fake tree
const W = 24, H = 12;
const WALL = { c0: 4, c1: 10, r0: 4, r1: 10 };
function penRows() {
    const rows = [];
    for (let r = 0; r < H; r++) {
        let s = "";
        for (let c = 0; c < W; c++) s += c >= WALL.c0 && c <= WALL.c1 && r >= WALL.r0 && r <= WALL.r1 ? "1" : "0";
        rows.push(s);
    }
    return rows;
}
function fakeTree(triggers) {
    const root = mkdtempSync(join(tmpdir(), "quest-arrival-"));
    mkdirSync(join(root, "web", "assets", "collision"), { recursive: true });
    mkdirSync(join(root, "web", "assets", "scenes"), { recursive: true });
    mkdirSync(join(root, "data", "authored", "quests"), { recursive: true });
    writeFileSync(join(root, "web", "assets", "manifest.json"), JSON.stringify({ maps: [{ id: "s1" }, { id: "s2" }] }));
    writeFileSync(join(root, "web", "assets", "collision", "s1.json"), JSON.stringify({ cell: 8, cols: W, rows: H, blocked: penRows() }));
    writeFileSync(join(root, "web", "assets", "scenes", "s1.json"), JSON.stringify({ npcs: [{ npc_id: 27, x: 24, y: 24, dir: "down" }] }));
    writeFileSync(join(root, "web", "assets", "scenes", "s2.json"), JSON.stringify({ npcs: [] }));
    writeFileSync(join(root, "web", "quests.json"), JSON.stringify({ quests: [] }));
    writeFileSync(join(root, "data", "authored", "quests", "triggers.json"), JSON.stringify({ triggers }));
    return root;
}
const runChecker = (root) => {
    try {
        const out = execFileSync("node", [CHECKER, "--json", "--root", root], { encoding: "utf8" });
        return { status: 0, data: JSON.parse(out) };
    } catch (e) {
        return { status: e.status, data: JSON.parse(e.stdout) };
    }
};
const goodScene = [{ walk: 27, to: [24, 24] }, { say: 27, name: "Someone", text: "Hello." }];

test("the checker passes an on-enter row on a real map and refuses on with a rect as ambiguous", () => {
    const ok = fakeTree([{ id: "arrive", map: "s1", on: "enter", scene: goodScene }]);
    try {
        const { status, data } = runChecker(ok);
        assert.equal(status, 0, JSON.stringify(data.problems));
        assert.equal(data.checked, 1);
    } finally {
        rmSync(ok, { recursive: true, force: true });
    }
    const bad = fakeTree([
        { id: "both", map: "s1", on: "enter", rect: [16, 16, 32, 32], scene: goodScene },
        { id: "wrong-on", map: "s1", on: "walk", scene: goodScene },
        { id: "no-actor", map: "s1", on: "enter", scene: [{ walk: 99, to: [24, 24] }] },
        { id: "no-map", map: "sX", on: "enter", scene: goodScene },
    ]);
    try {
        const { status, data } = runChecker(bad);
        assert.equal(status, 1);
        const fails = data.problems.filter((p) => p.severity === "fail");
        const ids = new Set(fails.map((p) => p.id));
        for (const id of ["both", "wrong-on", "no-actor", "no-map"]) assert.ok(ids.has(id), `${id} was reported`);
        assert.match(fails.find((p) => p.id === "both").what, /rect/, "the ambiguity is named");
    } finally {
        rmSync(bad, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------- the real data still passes
test("the checker passes the real tree with the authored triggers it has", () => {
    const authored = existsSync(join(ROOT, "data", "authored", "quests", "triggers.json"))
        ? load(join(ROOT, "data", "authored", "quests", "triggers.json")).triggers
        : [];
    const { status, data } = runChecker(ROOT);
    assert.equal(status, 0, JSON.stringify(data.problems));
    assert.ok(data.checked >= authored.length);
});
