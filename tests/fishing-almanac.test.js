// The Angler's almanac: the 46 fishing stages, their spots, their two catches
// and the reward record each catch's battle screen pays — joined from the
// tables the game already ships, with nothing written back.
//
// The numbers below are the data's own, measured from:
//   * web/assets/data/fishing_spots.json — 46 stages, 212 spot records, 92
//     catch records (slots "4" and "7" on every stage);
//   * web/assets/data/field_encounters.json — `screens`, the party a catch
//     screen fights with (slot 4 is a Cardmon party on all 46 stages);
//   * web/assets/data/progression.json — `battle_rewards`, an ARRAY indexed by
//     screen id: [dvexp, exp, bits];
//   * web/assets/manifest.json — `maps`, the stage's own name.
//
// The module is pure (no DOM, no fs); the page (web/fishing-almanac.html)
// imports it and the field HUD line (web/game.js) reads castsLeft().
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { almanac, cardmonStages, waterIndex, castsLeft, rewardFor } from "../web/fishing-almanac.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const fish = JSON.parse(read("../web/assets/data/fishing_spots.json"));
const encounters = JSON.parse(read("../web/assets/data/field_encounters.json"));
const progression = JSON.parse(read("../web/assets/data/progression.json"));
const manifest = JSON.parse(read("../web/assets/manifest.json"));

const rows = almanac(fish, encounters.screens, progression.battle_rewards, manifest.maps);
const stageKeys = Object.keys(fish);

// The 10 water species the shipped slot-7 catches resolve to, by name.
const WATER_SPECIES = [
    "Coelamon", "Divermon", "Dolphmon", "Ebidramon", "Ebidramon2",
    "MegaSeadramon2", "Scorpiomon2", "Seadramon", "Shellmon", "Whamon2",
];

test("the data holds 46 stages, 212 spots and 92 catch records (46 in each slot)", () => {
    assert.equal(stageKeys.length, 46, "46 fishing stages");
    let spots = 0, catches = 0, slot4 = 0, slot7 = 0;
    for (const stage of stageKeys) {
        spots += fish[stage].spots.length;
        for (const slot of Object.keys(fish[stage].catch ?? {})) {
            catches++;
            if (slot === "4") slot4++;
            if (slot === "7") slot7++;
        }
    }
    assert.equal(spots, 212, "212 spot records across the 46 stages");
    assert.equal(catches, 92, "92 catch records");
    assert.equal(slot4, 46, "one slot-4 catch on every stage");
    assert.equal(slot7, 46, "one slot-7 catch on every stage");
});

test("every catch screen resolves in field_encounters.screens, and slot 4 is always a Cardmon", () => {
    const screens = new Set();
    for (const stage of stageKeys) {
        for (const slot of ["4", "7"]) {
            screens.add(fish[stage].catch[slot].screenId);
        }
    }
    assert.equal(screens.size, 14, "the 92 catches resolve to 14 distinct battle screens");
    let missing = 0;
    for (const screen of screens) {
        if (!encounters.screens[String(screen)]) missing++;
    }
    assert.equal(missing, 0, "every catch screen exists in field_encounters.screens");
    for (const stage of stageKeys) {
        const screen = fish[stage].catch["4"].screenId;
        const party = encounters.screens[String(screen)];
        assert.ok(party?.[0]?.name?.includes("Cardmon"),
            `${stage}: slot 4 (screen ${screen}) is a Cardmon party, not ${party?.[0]?.name}`);
    }
});

test("the slot-7 species are exactly the 10 water Digimon, and the index has one row each", () => {
    const species = new Set();
    for (const stage of stageKeys) {
        const screen = fish[stage].catch["7"].screenId;
        species.add(encounters.screens[String(screen)][0].name);
    }
    assert.deepEqual([...species].sort(), WATER_SPECIES, "the slot-7 species set");
    const index = waterIndex(rows);
    assert.equal(index.length, 10, "waterIndex has one row per distinct water species");
    for (const entry of index) {
        assert.ok(WATER_SPECIES.includes(entry.species), `${entry.species} is a shipped water species`);
        assert.ok(entry.stages.length > 0, `${entry.species} hooks at least one stage`);
        for (const stage of entry.stages) {
            assert.ok(fish[stage]?.catch?.["7"], `${entry.species}: ${stage} has a slot-7 catch`);
        }
    }
    // Printed, not hardcoded: what the index holds today.
    console.log("water species index:", index.map((e) => `${e.species} (${e.stages.length})`).join(", "));
});

test("almanac returns one row per stage, each with the sixteen-cast budget", () => {
    assert.equal(rows.length, 46, "46 rows");
    for (const row of rows) {
        assert.equal(row.budget, 16, `${row.stage}: a visit starts with sixteen casts`);
        assert.equal(typeof row.name, "string");
        assert.ok(row.name.length > 0, `${row.stage} carries its map's name`);
        assert.equal(row.spots, fish[row.stage].spots.length, `${row.stage}: the spot count is the data's`);
    }
});

test("stage s202 names its two catches and their screens", () => {
    const row = rows.find((r) => r.stage === "s202");
    assert.ok(row, "s202 is one of the 46 stages");
    assert.equal(row.name, "Central Sector — Asuka City", "the map's own name");
    assert.deepEqual(row.cardmon, { screen: 328, species: "Cardmon2" });
    assert.deepEqual(row.water, { screen: 54, species: "Coelamon" });
    assert.equal(row.spots, 3, "s202 has three spot records");
});

test("rewardFor reads battle_rewards by screen id, and never invents a zero", () => {
    const record = progression.battle_rewards[54];
    assert.deepEqual(record, [8, 40, 80], "screen 54 pays [dvexp, exp, bits] in the shipped array");
    assert.deepEqual(rewardFor(progression.battle_rewards, 54),
        { dvexp: record[0], exp: record[1], bits: record[2] },
        "rewardFor(54) is the shipped record at index 54, in named fields");
    assert.deepEqual(rewardFor(progression.battle_rewards, 328), { dvexp: 12, exp: 60, bits: 120 },
        "the Cardmon screen pays its own record");
    // A screen the array does not reach prints unknown, never 0.
    assert.equal(rewardFor([8, 40, 80], 54), null, "an index past the end is null");
    assert.equal(rewardFor([], 0), null, "an empty table is null");
    assert.equal(rewardFor(undefined, 54), null, "no table is null");
    assert.equal(rewardFor(progression.battle_rewards, -1), null, "no negative index");
});

test("the page's reward column is the water screen's record, not a hand-written number", () => {
    const row = rows.find((r) => r.stage === "s202");
    assert.deepEqual(row.reward, { dvexp: 8, exp: 40, bits: 80 },
        "s202's row pays what screen 54 pays");
    assert.deepEqual(row.reward, rewardFor(progression.battle_rewards, row.water.screen));
});

test("cardmonStages lists the stages that hook a Cardmon (all 46 today)", () => {
    const stages = cardmonStages(rows);
    assert.equal(stages.length, 46, "every stage hooks a Cardmon");
    assert.deepEqual(stages.map((r) => r.stage), rows.map((r) => r.stage), "in the almanac's order");
    // The filter is data-driven: a row whose slot-4 catch is not a Cardmon drops out.
    const filtered = cardmonStages([...rows, { stage: "sX", cardmon: { screen: 1, species: "Agumon" } }]);
    assert.equal(filtered.length, 46, "a non-Cardmon row is not a Cardmon stage");
});

test("castsLeft clamps the visit's budget to 0..16", () => {
    assert.equal(castsLeft(16), 16);
    assert.equal(castsLeft(0), 0);
    assert.equal(castsLeft(-3), 0);
    assert.equal(castsLeft(99), 16);
    assert.equal(castsLeft(7), 7, "a live budget passes through");
    assert.equal(castsLeft(undefined), 16, "no budget yet means a fresh visit");
});

test("the page module and the page write nothing and touch no flag", () => {
    for (const [name, text] of [
        ["fishing-almanac.js", read("../web/fishing-almanac.js")],
        ["fishing-almanac.html", read("../web/fishing-almanac.html")],
    ]) {
        assert.doesNotMatch(text, /localStorage|sessionStorage/, `${name} stores nothing`);
        assert.doesNotMatch(text, /setFlag|__story|storyFlag|S\.flags/, `${name} sets no game flag`);
        assert.doesNotMatch(text, /method:\s*["'](POST|PUT|DELETE)["']/i, `${name} posts nothing`);
    }
});

test("the page imports the pure module and reads the four shipped tables", () => {
    const page = read("../web/fishing-almanac.html");
    assert.match(page, /import\s*\{[^}]*\balmanac\b[^}]*\}\s*from\s*"\.\/fishing-almanac\.js"/,
        "the page imports the almanac");
    assert.match(page, /import\s*\{[^}]*\bcardmonStages\b[^}]*\}/, "the Cardmon filter comes from the module");
    assert.match(page, /import\s*\{[^}]*\bwaterIndex\b[^}]*\}/, "the species index comes from the module");
    for (const file of ["assets/data/fishing_spots.json", "assets/data/field_encounters.json",
        "assets/data/progression.json", "assets/manifest.json"]) {
        assert.ok(page.includes(file), `the page fetches ${file}`);
    }
    // The manifest shipped by build_assets.py sits in web/assets/; a bare
    // "manifest.json" would be /manifest.json next to the page and 404 on a
    // plain static server, so the assets prefix is part of the contract.
    assert.match(page, /fetch\("assets\/manifest\.json"\)/, "the manifest is fetched from assets/");
    assert.doesNotMatch(page, /["'`]manifest\.json["'`]/,
        "no bare manifest.json without the assets prefix");
    assert.match(page, /id="cardmonOnly"/, "the Cardmon-only filter");
    assert.match(page, /id="species"/, "the species index");
});

test("the field line is behind the toggle, on a spot, and reads the live budget", () => {
    const game = read("../web/game.js");
    const at = game.indexOf("if (fx.anglermap");
    assert.ok(at >= 0, "web/game.js guards the line with if (fx.anglermap)");
    const block = game.slice(at, at + 1600);
    assert.match(block, /fishingSpotHere\(\)/, "the line appears only while standing on a spot");
    assert.match(block, /Casts left this visit:/, "the line's own words");
    assert.match(block, /castsLeft\(state\.fishingBudget \?\? FISHING_BUDGET\)/,
        "the count is the live state.fishingBudget, clamped by the module");
    // Nothing else in the field changed: the line only draws.
    assert.doesNotMatch(block, /state\.fishingBudget\s*=/, "the HUD never writes the budget");
});

test("the F2 Extras row is off by default and the page opens only behind it", () => {
    const ambience = read("../web/ambience.js");
    assert.match(ambience, /\["anglermap", "Angler's almanac"\]/, "the Extras row");
    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"anglermap"/, "off until the player switches it on");
    const devModel = readFileSync(new URL("../web/dev-panel-model.js", import.meta.url), "utf8"), devPanel = readFileSync(new URL("../web/dev-panel.js", import.meta.url), "utf8");
    const refs = devModel.split("fishing-almanac.html").length - 1;
    assert.equal(refs, 1, "one reference to the page, no other link into it");
    assert.match(devModel, /anglermap: P\("fishing-almanac\.html"/, "the Open button's page is in the F2 page model");
    assert.match(ambience, /if \(!o \|\| !fx\[key\]\) return;/, "opened only behind the switch (the Open guard)");
    assert.match(devPanel, /b\.disabled = !fx\[/, "the Open button is disabled while the switch is off");
    assert.doesNotMatch(ambience, /(get|has)\("anglermap"\)/, "never a URL flag");
});
