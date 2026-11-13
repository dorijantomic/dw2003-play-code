// tests/fly-points.test.js -- the FLY rules (web/fly-points.js), the quest that unlocks them, and how they are wired. node --test, no browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
    FLY_POINTS, FLY_QUEST, FLY_ROW_LABEL, NO_AIR_LINE, NO_FREE_LINE, flyLabel, flyPlaces, arrivalSpot, flyBlock, createFlyModel,
} from "../web/fly-points.js";
import { isOpenAirMapName } from "../web/map-open-air.js";
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
    const g = read("../web/game.js");
    assert.match(g, /fly: questDone\(FLY_QUEST\)/);
    assert.match(g, /async function flyTo\(id\)/);
    const body = g.slice(g.indexOf("async function flyTo(id)"), g.indexOf("// Dev / test hooks (nothing in the game reads these): window.__fly"));
    for (const need of ["FLY_POINTS.includes(id)", "questDone(FLY_QUEST)", "flyFree()", "flyAirNow()", "flySeen(id)", "arrivalSpot("]) assert.ok(body.includes(need), need);
    assert.match(g, /runStageHandoff\(\{ to: mapId, spawnX: spot\.x, spawnY: spot\.y, scripted: true/);
    assert.ok(!/__fx\??\.fly|get\("fly"\)|\?fly=/.test(g), "no switch, no URL flag");
    assert.ok(!/fly/i.test(read("../web/options-model.js")), "no OPTIONS row");
});
