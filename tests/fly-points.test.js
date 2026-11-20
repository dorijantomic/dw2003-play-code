// tests/fly-points.test.js -- the FLY rules (web/fly-points.js), the quest that unlocks them, and how they are wired. node --test, no browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
    FLY_POINTS, FLY_QUEST, FLY_ROW_LABEL, NO_AIR_LINE, NO_FREE_LINE, flyLabel, flyPlaces, arrivalSpot, flyBlock, createFlyModel,
    mapTwins, mapWorlds, WORLDS, flyCopyFor, flyCopiesOf,
} from "../web/fly-points.js";
import { isOpenAirMapName } from "../web/map-open-air.js";
import { readSource } from "./helpers/source.js";
import { pauseExtraRows, pauseLabelOk } from "../web/pause-extra-rows.js";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const manifestUrl = new URL("../web/assets/manifest.json", import.meta.url);
const maps = fs.existsSync(manifestUrl) ? JSON.parse(fs.readFileSync(manifestUrl, "utf8")).maps : null;   // disc-derived, local only
const scenesOf = (id) => JSON.parse(fs.readFileSync(new URL(`../web/assets/scenes/${id}.json`, import.meta.url), "utf8"));

// the places that only a dig or a swim reaches, or that are interiors / dungeons: never a fly point
const NEVER = /^(West Sector|North Sector|Kusanagi City)|Duel Island|Divermon's Lake|Phoenix Bay|South Cape|Plug Cape|Shell Beach|Lake of Ice|Cave|Tunnel|Dungeon|Room|Hall|Lobby|Inn|Cruiser|Tower/;

test("the fly points are a short explicit list of unique stage ids", () => {
    assert.ok(FLY_POINTS.length >= 1 && FLY_POINTS.length <= 8);
    assert.equal(new Set(FLY_POINTS).size, FLY_POINTS.length);
    for (const id of FLY_POINTS) assert.match(id, /^s\d+$/);
    assert.ok(Object.isFrozen(FLY_POINTS));
});

test("every fly point is an open-air town or hub in the manifest, and never a dig / swim / interior place", (t) => {
    if (!maps) return t.skip("web/assets/manifest.json is not here (disc-derived, local only)");
    for (const id of FLY_POINTS) {
        const m = maps.find((x) => x.id === id);
        assert.ok(m, `${id} is in the manifest`);
        assert.ok(isOpenAirMapName(m.name), `${id} ${m.name} is open air`);
        assert.ok(!NEVER.test(m.name), `${id} ${m.name} is not a swim / dig / indoor place`);
    }
});

test("every fly point is reached by an exit from another open-air map (a way on foot, not only a hole)", (t) => {
    if (!maps) return t.skip("web/assets/manifest.json is not here");
    for (const id of FLY_POINTS) {
        const exits = scenesOf(id).exits ?? [];
        const openAirNeighbour = exits.some((e) => { const n = maps.find((m) => m.id === e.to); return n && isOpenAirMapName(n.name); });
        assert.ok(openAirNeighbour, `${id} leads to an open-air map`);
    }
});

test("flyLabel keeps the place after the sector", () => {
    assert.equal(flyLabel("Central Sector — Asuka City"), "Asuka City");
    assert.equal(flyLabel("Kusanagi"), "Kusanagi");
    assert.equal(flyLabel(null), "");
});

const MAPS = [
    { id: "s200", name: "Central Sector — Asuka City" },
    { id: "s201", name: "Central Sector — Amaterasu City" },
    { id: "s330", name: "Central Sector — Central Park" },
    { id: "s420", name: "East Sector — Seiryu City" },
    { id: "s395", name: "East Sector — Wind Prairie" },
    { id: "s999", name: "West Sector — Byakko City" },
];

test("only visited fly points are offered, never the map you stand on, never a map outside the list", () => {
    const seen = new Set(["s200", "s330", "s395", "s999"]);
    const out = flyPlaces({ maps: MAPS, seen: (id) => seen.has(id), currentId: "s330" });
    assert.deepEqual(out, [{ id: "s200", label: "Asuka City" }]);
    assert.deepEqual(flyPlaces({ maps: MAPS, seen: () => true, currentId: null }).map((p) => p.id), ["s200", "s201", "s330", "s420"]);
    assert.deepEqual(flyPlaces({ maps: MAPS, seen: () => false }), [], "nothing visited, nothing to fly to");
    assert.deepEqual(flyPlaces({ maps: [], seen: () => true }), [], "a map that is not in the manifest is dropped");
});

test("arrivalSpot is the spawn of the first exit that leads there; null when none does", () => {
    const scenes = {
        s300: { exits: [{ to: "s200", spawnX: 5, spawnY: 6, dir: "up" }] },
        s205: { exits: [{ to: "s200", spawnX: 100, spawnY: 200, dir: "down-left" }, { to: "s330", spawnX: 1, spawnY: 2 }] },
    };
    assert.deepEqual(arrivalSpot(scenes, "s200"), { x: 100, y: 200, dir: "down-left" });
    assert.deepEqual(arrivalSpot(scenes, "s330"), { x: 1, y: 2, dir: "down" });
    assert.equal(arrivalSpot(scenes, "s420"), null);
    assert.equal(arrivalSpot(null, "s200"), null);
    assert.equal(arrivalSpot({ s1: { exits: [{ to: "s200", spawnX: null, spawnY: null }] } }, "s200"), null);
});

test("flight is refused unless the field is free and the air is open", () => {
    assert.equal(flyBlock({ openAir: true, free: true }), null);
    assert.equal(flyBlock({ openAir: false, free: true }), NO_AIR_LINE);
    assert.equal(flyBlock({ openAir: true, free: false }), NO_FREE_LINE);
    assert.equal(flyBlock({ openAir: false, free: false }), NO_FREE_LINE, "a busy field comes first");
});

test("the list cursor wraps and stays put with one place", () => {
    const m = createFlyModel([{ id: "a" }, { id: "b" }, { id: "c" }]);
    assert.equal(m.current().id, "a");
    m.move(-1); assert.equal(m.current().id, "c");
    m.move(1); assert.equal(m.current().id, "a");
    const one = createFlyModel([{ id: "a" }]);
    assert.equal(one.move(1), false);
    assert.equal(createFlyModel([]).current(), null);
});

test("the FLY row is on the pause list only when the quest is done, after QUESTS, with a label the codec can draw", () => {
    assert.equal(FLY_ROW_LABEL, "FLY");
    assert.ok(pauseLabelOk(FLY_ROW_LABEL));
    assert.deepEqual(pauseExtraRows({ quests: { label: "QUESTS" }, fx: {}, fly: false }).map((r) => r.label), ["QUESTS"]);
    assert.deepEqual(pauseExtraRows({ quests: { label: "QUESTS" }, fx: {}, fly: true }), [{ label: "QUESTS", opens: "quests" }, { label: "FLY", opens: "fly" }]);
    assert.deepEqual(pauseExtraRows({ quests: null, fx: {}, fly: "yes" }), [], "only a real true");
});

test("the quest zz_fly is authored, shipped and built into web/quests.json, and pays nothing that is not in the item table", () => {
    assert.equal(FLY_QUEST, "zz_fly");
    assert.match(read("../data/authored/quests/shipped.txt"), /^zz_fly$/m);
    const q = JSON.parse(read("../web/quests.json")).quests.find((x) => x.id === FLY_QUEST);
    assert.ok(q, "in web/quests.json");
    assert.equal(q.offer.npc, 57);
    assert.ok(q.objectives.some((o) => o.type === "visit" && o.map === "s395"));
    assert.ok(!(q.reward?.items?.length), "no invented item");
    for (const l of [...q.offer.lines, ...q.offer.doneLines, ...q.offer.remindLines]) assert.match(l, /^[A-Za-z0-9 .,'\-:"!?]*$/);
});

test("wiring: game.js re-checks every rule in flyTo, the row needs the quest, no option row, no URL flag", () => {
    const g = readSource(new URL("../web/game.js", import.meta.url));
    assert.match(g, /fly: questDone\(FLY_QUEST\)/);
    assert.match(g, /async function flyTo\(id\)/);
    const start = g.indexOf("async function flyTo(id)");
    const body = g.slice(start, g.indexOf("\n}\n", start) + 2);
    for (const need of ["FLY_POINTS.includes(id)", "questDone(FLY_QUEST)", "flyFree()", "flyAirNow()", "flySeenAny(id)", "flyCopyFor(", "arrivalSpot(state.scenes, copy.id)"]) assert.ok(body.includes(need), need);
    assert.match(g, /runStageHandoff\(\{ to: mapId, spawnX: spot\.x, spawnY: spot\.y, scripted: true/);
    assert.ok(!/__fx\??\.fly|get\("fly"\)|\?fly=/.test(g), "no switch, no URL flag");
    assert.ok(!/fly/i.test(read("../web/options-model.js")), "no OPTIONS row");
});

// ---- which copy: the world you stand in decides (a door never leaves its own world) ----
const ex = (x, y, to) => ({ x, y, w: 64, h: 64, to, spawnX: 10, spawnY: 20 });
const AIR = "Central Sector — Asuka City";
const M = (id, w = 1000, h = 800, name = AIR) => ({ id, name, width: w, height: h });
const TMAPS = [
    M("s200"), M("s201"), M("s920"), M("s205", 500, 500), M("s206", 500, 500), M("s922", 500, 500),
    M("s330", 600, 600), M("s331", 600, 600),                       // a place with no s9xx copy
    M("s930", 100, 100), M("s781", 90, 90), M("s950", 80, 80),      // lone maps: s930 only touches the s9xx world, s781 nothing, s950 two worlds
    M("s850", 400, 400, "Underground — Seabed"),                    // a hub joining the worlds: never followed
];
const TSCENES = {
    s200: { exits: [ex(1, 1, "s205")] }, s201: { exits: [ex(1, 1, "s206")] }, s920: { exits: [ex(1, 1, "s922")] },
    s205: { exits: [ex(2, 2, "s200"), ex(3, 3, "s850")] }, s206: { exits: [ex(2, 2, "s201"), ex(3, 3, "s850")] }, s922: { exits: [ex(2, 2, "s920"), ex(3, 3, "s930")] },
    s330: { exits: [ex(5, 5, "s205")] }, s331: { exits: [ex(5, 5, "s206")] },
    s950: { exits: [ex(6, 6, "s205"), ex(7, 7, "s206")] },
};

test("mapTwins groups copies by size + exit rectangles, sorted by id; a lone map is absent", () => {
    const t = mapTwins(TMAPS, TSCENES);
    assert.deepEqual(t.get("s201"), ["s200", "s201", "s920"]);
    assert.deepEqual(t.get("s206"), ["s205", "s206", "s922"]);
    assert.deepEqual(t.get("s331"), ["s330", "s331"]);
    assert.equal(t.has("s781"), false);
    assert.deepEqual(flyCopiesOf(TMAPS, TSCENES, "s781"), ["s781"]);
});

test("mapWorlds: twinned maps by rank, lone maps by their agreeing open-air neighbours, hubs and ambiguous maps stay out", () => {
    const w = mapWorlds(TMAPS, TSCENES);
    assert.deepEqual(WORLDS, ["normal", "amaterasu", "s9xx"]);
    for (const [id, n] of [["s200", 0], ["s201", 1], ["s920", 2], ["s205", 0], ["s206", 1], ["s922", 2], ["s330", 0], ["s331", 1]]) assert.equal(w.get(id), n, id);
    assert.equal(w.get("s930"), 2, "lone map next to the s9xx world");
    assert.equal(w.has("s781"), false, "no neighbour: unknown");
    assert.equal(w.has("s950"), false, "neighbours in two worlds: unknown, never a guess");
    assert.equal(w.has("s850"), false, "not open air");
});

test("flyCopyFor: the copy in your world; a reason when there is none, never a guess", () => {
    const f = (currentId, id) => flyCopyFor({ maps: TMAPS, scenes: TSCENES, currentId, id });
    assert.deepEqual(f("s205", "s200"), { id: "s200" });
    assert.deepEqual(f("s206", "s200"), { id: "s201" }, "standing in the Amaterasu world -> the Amaterasu copy");
    assert.deepEqual(f("s922", "s200"), { id: "s920" }, "standing in the s9xx world -> the s9xx copy");
    assert.deepEqual(f("s930", "s200"), { id: "s920" }, "a lone map takes its neighbours world");
    assert.deepEqual(f("s206", "s330"), { id: "s331" }, "a group of two, whichever the size");
    assert.deepEqual(f("s922", "s330"), { why: "no-copy" }, "the s9xx world has no copy of it");
    assert.deepEqual(f("s781", "s200"), { why: "world-unknown" });
    assert.deepEqual(f("s950", "s200"), { why: "world-unknown" });
    assert.deepEqual(f(null, "s200"), { why: "world-unknown" });
    assert.deepEqual(f("s205", "s781"), { why: "no-copy" }, "a point with no twin");
});

test("flyPlaces with scenes: visited = any copy seen, own place hidden in any copy, no-copy left out, one entry per place, label of the copy", () => {
    const names = TMAPS.map((m) => (m.id === "s201" ? { ...m, name: "Central Sector — Amaterasu City" } : m));
    const run = (currentId, seen, points = ["s200"]) => flyPlaces({ maps: names, scenes: TSCENES, currentId, seen: (id) => seen.includes(id), points });
    assert.deepEqual(run("s206", ["s201"]), [{ id: "s200", label: "Amaterasu City" }], "only the Amaterasu copy visited, still offered");
    assert.deepEqual(run("s205", ["s201"]).map((p) => p.id), ["s200"]);
    assert.deepEqual(run("s205", []), []);
    assert.deepEqual(run("s201", ["s200", "s201"]), [], "standing in a copy of it");
    assert.deepEqual(run("s781", ["s200"]), [], "world unknown: not offered");
    assert.deepEqual(run("s922", ["s330"], ["s330"]), [], "no copy in the s9xx world: left out");
    assert.deepEqual(run("s205", ["s200"], ["s200", "s201"]).map((p) => p.id), ["s200"], "s200 and s201 are one place: listed once");
});

test("real data: worlds of every open-air map, what each world can fly to, and that every open-air map with a known world can fly somewhere", (t) => {
    if (!maps) return t.skip("web/assets/manifest.json is not here (disc-derived, local only)");
    const scenes = {};
    for (const m of maps) { try { scenes[m.id] = scenesOf(m.id); } catch { /* none */ } }
    const air = maps.filter((m) => isOpenAirMapName(m.name));
    const worlds = mapWorlds(maps, scenes);
    const stat = [0, 1, 2].map((w) => air.filter((m) => worlds.get(m.id) === w));
    const unknown = air.filter((m) => !worlds.has(m.id));
    const reach = (cur) => FLY_POINTS.filter((id) => flyCopyFor({ maps, scenes, currentId: cur, id }).id).map((id) => flyCopyFor({ maps, scenes, currentId: cur, id }).id);
    const canFly = air.filter((m) => flyPlaces({ maps, scenes, currentId: m.id, seen: () => true }).length > 0);
    console.log(`open-air maps ${air.length}; world unknown ${unknown.map((m) => m.id).join(",") || "none"}; can fly anywhere ${canFly.length}`);
    WORLDS.forEach((name, w) => console.log(`  ${name}: ${stat[w].length} open-air maps, reaches ${[...new Set(reach(stat[w][0]?.id))].join(",")}`));
    assert.equal(worlds.size + unknown.length, air.length);
    assert.ok(stat.every((s) => s.length > 0), "every world has open-air maps");
    // a door never leaves its world: every exit between two open-air maps with known worlds stays inside one world
    for (const m of air) for (const e of scenes[m.id]?.exits ?? []) {
        if (worlds.has(m.id) && worlds.has(e.to)) assert.equal(worlds.get(e.to), worlds.get(m.id), `${m.id} -> ${e.to}`);
    }
    // each world flies to the copy of the point that lies in it, and that copy has an arrival spot
    for (const id of FLY_POINTS) {
        const g = mapTwins(maps, scenes).get(id);
        assert.ok(g && g.length >= 2, `${id} has copies`);
        for (const w of [0, 1, 2]) {
            const cur = stat[w].find((m) => !g.includes(m.id))?.id;
            const r = flyCopyFor({ maps, scenes, currentId: cur, id });
            assert.equal(worlds.get(r.id), w, `${id} from ${cur} (${WORLDS[w]}) -> ${r.id}`);
            assert.ok(arrivalSpot(scenes, r.id), `${r.id} has an arrival spot`);
        }
    }
    assert.equal(flyCopyFor({ maps, scenes, currentId: "s205", id: "s200" }).id, "s200");
    assert.equal(flyCopyFor({ maps, scenes, currentId: "s206", id: "s200" }).id, "s201");
    assert.equal(flyCopyFor({ maps, scenes, currentId: "s345", id: "s200" }).id, "s200", "Plug Cape (group of two) flies to Asuka City");
    assert.equal(flyCopyFor({ maps, scenes, currentId: "s346", id: "s200" }).id, "s201");
    assert.equal(canFly.length, air.length - unknown.length, "every open-air map with a known world can fly");
});
