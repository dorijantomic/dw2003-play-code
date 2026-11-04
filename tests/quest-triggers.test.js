// Walk-in quest triggers (web/quest-triggers.js): a quest scene that starts because the player stepped into a patch of
// ground. The shape is the original field VM's own: op-8 `start_event` steps sit on a type-7 trigger grid and every one
// is flag-gated (docs/research/scripting/field-script-engine-verified.md). Here the patch is an authored rectangle.
//
// The pure decision (enterTrigger) and the per-frame runner are proved with plain values, then the authored data, the
// build script and the build-time checker are proved against the real tree (and a tiny fake one for the checker's own
// failures). One test drives the real web/quests.js wiring: loadState keeps `triggers`, questsTick asks the runner, a
// fire marks the trigger and a scene that did not run leaves it armed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { enterTrigger, installTriggers } from "../web/quest-triggers.js";
import { castOf, validateScene } from "../web/quest-scenes.js";
import { questGrid, questStandFree, questFreeCellNear } from "../web/quest-walk.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CHECKER = join(ROOT, "tools", "check_triggers.mjs");
const BUILD = join(ROOT, "tools", "build_quests.py");
const load = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------- the pure decision and the runner
const MAP = "s200";
const RECT = [100, 100, 40, 40];                     // x, y, width, height in world pixels
const OUT = { x: 40, y: 40 }, IN = { x: 120, y: 120 };
const STATUSES = ["available", "active", "ready", "done"];
const trg = (over = {}) => ({ id: "demo", map: MAP, rect: RECT, scene: [{ wait: 1 }], ...over });
const state = () => ({ triggers: {} });
const baseCtx = (over = {}) => ({
    enabled: () => true,
    statusOf: () => "active",
    idle: () => true,
    dialogBusy: false,
    battle: false,
    ...over,
});

test("enter-only: outside to inside fires; inside to inside, another map and a first tick never do", () => {
    const t = trg();
    assert.equal(enterTrigger([t], MAP, OUT, IN, state(), baseCtx())?.id, "demo");
    assert.equal(enterTrigger([t], MAP, IN, IN, state(), baseCtx()), null, "already inside");
    assert.equal(enterTrigger([t], "s201", OUT, IN, state(), baseCtx()), null, "another map");
    assert.equal(enterTrigger([t], MAP, null, IN, state(), baseCtx()), null, "no previous place (a map change)");
});

test("once: a fired trigger stays quiet; once:false fires on every walk-in", () => {
    const fired = { triggers: { demo: 1 } };
    assert.equal(enterTrigger([trg()], MAP, OUT, IN, fired, baseCtx()), null, "once defaults to true");
    assert.equal(enterTrigger([trg({ once: false })], MAP, OUT, IN, fired, baseCtx())?.id, "demo");
    // inside -> outside -> inside, with the mark the runner writes after the first fire
    const st = state();
    const t = trg();
    assert.ok(enterTrigger([t], MAP, OUT, IN, st, baseCtx()));
    st.triggers[t.id] = 1;
    assert.equal(enterTrigger([t], MAP, IN, OUT, st, baseCtx()), null);
    assert.equal(enterTrigger([t], MAP, OUT, IN, st, baseCtx()), null, "the second walk-in");
});

test("a when gate must match the quest layer's own status, and an unknown quest never fires", () => {
    for (const status of STATUSES) {
        const t = trg({ when: { quest: "q1", status } });
        assert.ok(enterTrigger([t], MAP, OUT, IN, state(), baseCtx({ statusOf: () => status })), `fires at ${status}`);
        for (const other of STATUSES.filter((s) => s !== status)) {
            assert.equal(enterTrigger([t], MAP, OUT, IN, state(), baseCtx({ statusOf: () => other })), null, `${status} gate vs ${other}`);
        }
    }
    // the quest layer's "locked" (not unlocked yet) is not one of the four statuses a trigger may name
    assert.equal(enterTrigger([trg({ when: { quest: "q1", status: "active" } })], MAP, OUT, IN, state(), baseCtx({ statusOf: () => "locked" })), null);
    // an id the layer does not know answers null, and a gate with no status is never guessed
    assert.equal(enterTrigger([trg({ when: { quest: "nope", status: "active" } })], MAP, OUT, IN, state(), baseCtx({ statusOf: () => null })), null);
    assert.equal(enterTrigger([trg({ when: { quest: "q1" } })], MAP, OUT, IN, state(), baseCtx()), null);
});

test("a busy game never fires: not idle (a battle, a cutscene, a menu), a quest dialog, a quest fight, the toggle off", () => {
    for (const [what, ctx] of [
        ["idle() false", baseCtx({ idle: () => false })],
        ["a quest dialog", baseCtx({ dialogBusy: true })],
        ["a quest fight", baseCtx({ battle: true })],
        ["F2 -> Extras -> Quest triggers off", baseCtx({ enabled: () => false })],
    ]) {
        assert.equal(enterTrigger([trg()], MAP, OUT, IN, state(), ctx), null, what);
    }
});

test("only the current map's triggers are read: three elsewhere cost zero status calls", async () => {
    let calls = 0;
    const ctx = baseCtx({ state, statusOf: () => { calls++; return "active"; }, playScene: () => ({ answer: null }), save() {} });
    const elsewhere = [0, 1, 2].map((i) => trg({ id: `other${i}`, map: "s201", when: { quest: "q1", status: "active" } }));
    const runner = installTriggers(elsewhere, ctx);
    assert.equal(runner.tick(MAP, OUT.x, OUT.y, IN.x, IN.y), null);
    assert.equal(calls, 0);
    assert.equal(enterTrigger(elsewhere, MAP, OUT, IN, state(), ctx), null);
    assert.equal(calls, 0, "the pure function filters by map before it asks anything");
});

test("a scene that did not run (null) leaves the trigger armed and writes no mark and no save", async () => {
    const st = state();
    let plays = 0, saves = 0;
    const runner = installTriggers([trg()], baseCtx({ state: () => st, playScene: () => { plays++; return null; }, save: () => saves++ }));
    assert.equal(await runner.tick(MAP, OUT.x, OUT.y, IN.x, IN.y), null);
    assert.equal(plays, 1, "the scene was tried");
    assert.deepEqual(st.triggers, {}, "no fired mark");
    assert.equal(saves, 0, "nothing was saved");
    // still armed: walking out and in again tries once more
    assert.equal(await runner.tick(MAP, IN.x, IN.y, OUT.x, OUT.y), null);
    assert.equal(await runner.tick(MAP, OUT.x, OUT.y, IN.x, IN.y), null);
    assert.equal(plays, 2);
});

test("after a fire the trigger is marked, saved once, and does not fire again", async () => {
    const st = state();
    let plays = 0, saves = 0;
    const seen = [];
    const runner = installTriggers([trg()], baseCtx({
        state: () => st,
        playScene: (scene) => { plays++; seen.push(scene); return { answer: null }; },
        save: () => saves++,
    }));
    const fired = await runner.tick(MAP, OUT.x, OUT.y, IN.x, IN.y);
    assert.deepEqual(fired, { answer: null });
    assert.equal(plays, 1);
    assert.deepEqual(seen, [[{ wait: 1 }]]);
    assert.ok(st.triggers.demo, "st.triggers[id] is set");
    assert.equal(saves, 1, "one save");
    assert.equal(await runner.tick(MAP, IN.x, IN.y, OUT.x, OUT.y), null);
    assert.equal(await runner.tick(MAP, OUT.x, OUT.y, IN.x, IN.y), null, "once:true keeps it quiet");
    assert.equal(plays, 1);
});

// ---------------------------------------------------------------- the authored data
const authored = load(join(ROOT, "data", "authored", "quests", "triggers.json")).triggers;
const manifest = load(join(ROOT, "web", "assets", "manifest.json"));
const mapIds = new Set(manifest.maps.map((m) => m.id));
const sceneNpcs = new Map();                          // map -> Set(npc ids that stand there)
for (const m of manifest.maps) {
    const p = join(ROOT, "web", "assets", "scenes", `${m.id}.json`);
    if (!existsSync(p)) continue;
    const set = new Set();
    for (const n of load(p).npcs ?? []) if (n.x || n.y) set.add(n.npc_id);
    sceneNpcs.set(m.id, set);
}
const extraPath = join(ROOT, "web", "extra_npcs.json");
if (existsSync(extraPath)) {
    for (const r of load(extraPath).residents ?? []) {
        if (!sceneNpcs.has(r.map)) sceneNpcs.set(r.map, new Set());
        sceneNpcs.get(r.map).add(r.npc_id);
    }
}
const gridOf = (map) => {
    const p = join(ROOT, "web", "assets", "collision", `${map}.json`);
    return existsSync(p) ? questGrid(load(p)) : null;
};

test("data: every authored trigger names a real map, a standable patch and a scene that compiles", () => {
    assert.ok(authored.length >= 1, "the authored source holds at least the demo");
    assert.equal(new Set(authored.map((t) => t.id)).size, authored.length, "ids are unique");
    for (const t of authored) {
        assert.ok(mapIds.has(t.map), `${t.id}: map ${t.map} is in the manifest`);
        assert.ok(Array.isArray(t.rect) && t.rect.length === 4 && t.rect.every(Number.isFinite), `${t.id}: rect is [x, y, w, h]`);
        const grid = gridOf(t.map);
        assert.ok(grid, `${t.id}: ${t.map} has collision data`);
        const [x, y, w, h] = t.rect;
        // at least one standable cell inside the rectangle
        let standable = 0;
        for (let cy = y; cy < y + h; cy += grid.cell) for (let cx = x; cx < x + w; cx += grid.cell) if (questStandFree(grid, cx, cy)) standable++;
        assert.ok(standable >= 1, `${t.id}: the rectangle holds standable ground`);
        // the centre, or a standable cell within 2 cells of it
        const cx = x + w / 2, cy = y + h / 2;
        assert.ok(questStandFree(grid, cx, cy) || questFreeCellNear(grid, cx, cy, 2), `${t.id}: the centre is walkable or 2 cells from walkable ground`);
        // the scene compiles, and every character it names stands on the map
        assert.deepEqual(validateScene(t.scene), [], `${t.id}: the scene compiles`);
        for (const id of castOf(t.scene)) assert.ok(sceneNpcs.get(t.map)?.has(id), `${t.id}: npc ${id} stands on ${t.map}`);
    }
});

test("data: the demo exists, is a draft (it ships only with --with-drafts), and its patch is on a real map", () => {
    const demo = authored.find((t) => t.draft === true);
    assert.ok(demo, "one demo trigger is marked draft");
    assert.equal(demo.draft, true);
    assert.ok(mapIds.has(demo.map));
    assert.ok(Array.isArray(demo.scene) && demo.scene.length > 0);
});

test("the build-time checker passes the real tree", () => {
    let out;
    try {
        out = execFileSync("node", [CHECKER, "--json"], { cwd: ROOT, encoding: "utf8" });
    } catch (e) {
        assert.fail(`check_triggers failed: ${e.stdout || e.message}`);
    }
    const data = JSON.parse(out);
    const fails = data.problems.filter((p) => p.severity === "fail");
    assert.deepEqual(fails, [], "no failures");
    assert.ok(data.checked >= authored.length, `every authored trigger was checked (${data.checked})`);
});

// ---------------------------------------------------------------- the checker, on a tiny fake tree
const W = 24, H = 12;
const WALL = { c0: 4, c1: 10, r0: 4, r1: 10 };        // a 7x7 block of wall in the middle of the pen
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
    const root = mkdtempSync(join(tmpdir(), "quest-triggers-"));
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
const goodTrigger = { id: "good", map: "s1", rect: [16, 16, 32, 32], scene: goodScene };

test("the checker passes a trigger on real ground with a compiling scene and its actor on the map", () => {
    const root = fakeTree([goodTrigger]);
    const { status, data } = runChecker(root);
    assert.equal(status, 0, JSON.stringify(data.problems));
    assert.equal(data.checked, 1);
});

test("the checker fails an unknown map, a patch inside a wall, a centre far from ground, a bad scene and a missing actor", () => {
    const root = fakeTree([
        goodTrigger,
        { id: "no-map", map: "sX", rect: [16, 16, 32, 32], scene: goodScene },
        { id: "all-wall", map: "s1", rect: [32, 32, 16, 16], scene: goodScene },          // inside the wall block
        { id: "far", map: "s1", rect: [32, 32, 64, 64], scene: goodScene },               // ground inside, centre 3 cells from it
        { id: "bad-scene", map: "s1", rect: [16, 16, 32, 32], scene: [{ walk: 27, to: [24, 24] }, { nope: 1 }] },
        { id: "no-actor", map: "s1", rect: [16, 16, 32, 32], scene: [{ walk: 99, to: [24, 24] }] },
        { id: "no-scene", map: "s1", rect: [16, 16, 32, 32], scene: [] },
    ]);
    const { status, data } = runChecker(root);
    assert.equal(status, 1);
    const fails = data.problems.filter((p) => p.severity === "fail");
    const ids = new Set(fails.map((p) => p.id));
    for (const id of ["no-map", "all-wall", "far", "bad-scene", "no-actor", "no-scene"]) assert.ok(ids.has(id), `${id} was reported`);
    assert.equal(ids.has("good"), false, "the good trigger is not blamed");
});

// ---------------------------------------------------------------- the build script
test("build: the demo trigger is in a --with-drafts build and not in the shipped one", () => {
    const tmp = mkdtempSync(join(tmpdir(), "quest-trigger-build-"));
    try {
        execFileSync("python3", [BUILD, "--with-drafts", "--out", join(tmp, "a.json")], { cwd: ROOT, encoding: "utf8" });
        execFileSync("python3", [BUILD, "--out", join(tmp, "b.json")], { cwd: ROOT, encoding: "utf8" });
        const withDrafts = load(join(tmp, "a.json")).triggers;
        const shipped = load(join(tmp, "b.json")).triggers;
        const demo = authored.find((t) => t.draft === true);
        assert.ok(withDrafts.some((t) => t.id === demo.id), "the demo is in the --with-drafts build");
        assert.equal(shipped.some((t) => t.id === demo.id), false, "the draft demo is not in the shipped build");
        assert.deepEqual(shipped, authored.filter((t) => t.draft !== true), "the shipped build holds exactly the non-draft triggers");
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------- the real wiring: web/quests.js
// The quest layer is a browser module (it imports web/ambience.js for the F2 flags), so this file stands in for the few
// browser globals it touches and serves the small JSON files it fetches. Only the trigger wiring is under test here.
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
    "quests.json": { quests: [], triggers: [{ id: "wire_demo", map: "s200", rect: [100, 100, 40, 40], scene: [{ wait: 1 }] }] },
    "map-variants.json": {},
    "assets/manifest.json": { maps: [{ id: "s200", name: "A place" }] },
    "assets/data/field_encounters.json": { screens: {} },
    "assets/data/stage_encounters.json": { stages: {} },
};
globalThis.fetch = async (url) => {
    const key = String(url);
    return key in FILES ? { ok: true, json: async () => FILES[key] } : { ok: false, json: async () => ({}) };
};

test("wiring: quests.js keeps st.triggers, ticks the runner, and the F2 switch really turns it off", async () => {
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
    assert.deepEqual(q.state.triggers, {}, "loadState gives an old save its triggers map");

    // the switch is off by default: walking in does nothing at all
    assert.notEqual(fx.questtriggers, true, "Quest triggers starts off");
    questsTick("s200", 40, 40);
    questsTick("s200", 120, 120);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(plays, 0, "no scene with the switch off");
    assert.deepEqual(q.state.triggers, {}, "no fired mark with the switch off");

    // switch it on and walk out and back in: the authored patch starts its scene once
    fx.questtriggers = true;
    questsTick("s200", 40, 40);
    questsTick("s200", 120, 120);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(plays, 1, "the scene played");
    assert.ok(q.state.triggers.wire_demo, "the trigger is marked");
    questsTick("s200", 40, 40);
    questsTick("s200", 120, 120);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(plays, 1, "once:true keeps it quiet");
});
