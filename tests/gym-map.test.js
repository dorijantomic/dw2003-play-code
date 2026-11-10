// The gym map — the nine training gyms and the whole rank ladder each greeter opens
// (web/gym-map.js, web/gym-map.html).
//
// The disc binds every gym greeter to a list of STGTRAIN rank menus: the greeter checks
// the player's ID cards in the file's own order and the FIRST fully satisfied option
// launches that rank group. The ladder is the same at every gym — no licence, the
// SilverID, SilverID + GoldID, the PlatinumID — but each gym spells it with its own
// groups, because each group is a different 14-rank drill menu.
//
// Sources (all shipped, all read by the page):
//   web/assets/data/gym_ranks.json   9 gyms: {stage, npc_id, sprite, options:[{group, requires:[{item, owned}]}]}
//   web/assets/data/progression.json gym.tp_costs [1, 5, 10] and gym.rank_menus (14 groups, 158 drills)
//   web/assets/data/item_effects.json names for 40 SilverID / 41 GoldID / 42 PlatinumID
// ddw3-walker/docs/research/battle/gym-entry-and-rank-chain-2026-07-08.md is the decode
// behind the table: the greeter's on_close writes flag bank 0x94 with the group index,
// and the index IS the 0-based rank_menus group.
//
// F2 -> Extras -> "Gym map (new)" (off by default). With the switch off there is no row,
// no page and no fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gymRows, rankLadder, groupDrills, groupSizes } from "../web/gym-map.js";
import { greeterText, placeName, gateText, drillText, mapSummary } from "../web/gym-map-page.js";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const RANKS = readJson("web/assets/data/gym_ranks.json");
const PROG = readJson("web/assets/data/progression.json");
const GYM = PROG.gym;
const ITEMS = readJson("web/assets/data/item_effects.json");
const names = new Map(ITEMS.items.map((item) => [item.id, item.name]));

const rows = gymRows(RANKS, GYM);
const rowOf = (stage) => rows.find((row) => row.stage === stage);

test("the map has the nine gyms of the file, each with its greeter's npc and sprite", () => {
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map((row) => row.stage), ["s330", "s331", "s495", "s496", "s570", "s571", "s720", "s721", "s940"]);
  for (const row of rows) {
    assert.equal(typeof row.npc, "number", `${row.stage} carries its greeter npc`);
    assert.equal(typeof row.sprite, "string", `${row.stage} carries its greeter sprite`);
    assert.ok(Array.isArray(row.options) && row.options.length > 0, `${row.stage} has a ladder`);
  }
  assert.equal(rowOf("s330").npc, 27);
  assert.equal(rowOf("s330").sprite, "p047leom");
  assert.equal(rowOf("s721").npc, 140);
  assert.equal(rowOf("s721").sprite, "p054mgna");
});

test("s330 Leomon's rungs are groups [1, 6, 0, 13], in the file's own order", () => {
  assert.deepEqual(rowOf("s330").options.map((option) => option.group), [1, 6, 0, 13]);
  // The gate patterns exactly as the file has them: Silver only, Silver + Gold, none,
  // Platinum. `mustOwn` is the REQUIRED value of the possession flag, not a sample.
  assert.deepEqual(rowOf("s330").options.map((option) => option.gates), [
    [{ item: 42, mustOwn: false }, { item: 41, mustOwn: false }, { item: 40, mustOwn: true }],
    [{ item: 42, mustOwn: false }, { item: 40, mustOwn: true }, { item: 41, mustOwn: true }],
    [{ item: 42, mustOwn: false }, { item: 40, mustOwn: false }],
    [{ item: 42, mustOwn: true }],
  ]);
});

test("every gym's ladder is the file's ladder: same groups, same gates, same order", () => {
  for (const gym of RANKS.gyms) {
    const row = rowOf(gym.stage);
    assert.deepEqual(row.options.map((option) => option.group), gym.options.map((option) => option.group), `${gym.stage} groups`);
    for (let i = 0; i < gym.options.length; i++) {
      assert.deepEqual(row.options[i].gates, gym.options[i].requires.map((r) => ({ item: r.item, mustOwn: r.owned })), `${gym.stage} rung ${i}`);
    }
  }
});

test("the drill table is the 14 groups of progression, sizes [5,10,11,12 x 11], 158 drills", () => {
  assert.equal(groupSizes(GYM).length, 14);
  assert.deepEqual(groupSizes(GYM), [5, 10, 11, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
  assert.equal(groupSizes(GYM).reduce((sum, n) => sum + n, 0), 158);
  for (let group = 0; group < 14; group++) {
    assert.deepEqual(groupDrills(GYM, group), GYM.rank_menus[group], `group ${group} is the table's own list`);
    assert.equal(groupDrills(GYM, group).length, groupSizes(GYM)[group]);
  }
  assert.deepEqual(groupDrills(GYM, 14), [], "a rank past 14 has no drills");
  assert.deepEqual(groupDrills(GYM, -1), []);
  const drills = groupSizes(GYM).flatMap((_, group) => groupDrills(GYM, group));
  assert.equal(drills.length, 158);
  for (const drill of drills) assert.ok(drill.drill >= 1 && drill.drill <= 24, `drill ${drill.drill} is one of the 24 drills`);
});

test("every group a greeter launches is one of the 14 ranks", () => {
  for (const row of rows) {
    for (const option of row.options) {
      assert.ok(Number.isInteger(option.group) && option.group >= 0 && option.group < 14, `${row.stage} launches group ${option.group}`);
      assert.equal(option.rowCount, groupSizes(GYM)[option.group], `${row.stage} group ${option.group} counts its own rows`);
      assert.equal(option.rowCount, option.drills.length);
    }
  }
});

test("every gate is an ID card (40, 41 or 42), and an unknown stage has no row", () => {
  const items = new Set();
  for (const gym of RANKS.gyms) for (const option of gym.options) for (const gate of option.requires) items.add(gate.item);
  assert.deepEqual([...items].sort((a, b) => a - b), [40, 41, 42]);
  assert.deepEqual(gymRows(RANKS, GYM, "s999"), []);
  assert.deepEqual(gymRows("s999"), [], "a lone stage asks a map with no tables: no row");
  assert.equal(gymRows(RANKS, GYM, "s330").length, 1);
  assert.equal(gymRows("s330", RANKS, GYM).length, 1, "stage-first call shape works too");
  assert.equal(gymRows("s330", RANKS, GYM)[0].options.length, 4);
});

test("a rung's TP cost is progression's tp_costs, never a literal in the module", () => {
  for (const row of rows) for (const option of row.options) assert.deepEqual(option.tpCost, GYM.tp_costs);
  const source = readFileSync("web/gym-map.js", "utf8");
  assert.doesNotMatch(source, /\[\s*1\s*,\s*5\s*,\s*10\s*\]/, "the trio is read, not written");
  assert.doesNotMatch(source, /tpCost\s*[:=]\s*\[/, "tpCost is copied from the table");
  // Data-driven proof: change the table and every rung follows it.
  const changed = gymRows(RANKS, { ...GYM, tp_costs: [7, 8, 9] });
  for (const row of changed) for (const option of row.options) assert.deepEqual(option.tpCost, [7, 8, 9]);
});

test("rankLadder(gym) is the greeter's gate ladder, in the file's own order", () => {
  for (const gym of RANKS.gyms) {
    const ladder = rankLadder(gym);
    assert.deepEqual(ladder.map((rung) => rung.group), gym.options.map((option) => option.group));
    for (let i = 0; i < ladder.length; i++) {
      assert.deepEqual(ladder[i].gates, gym.options[i].requires.map((r) => ({ item: r.item, mustOwn: r.owned })));
    }
  }
  // A row the map already built carries the same ladder.
  assert.deepEqual(rankLadder(rowOf("s330")), rankLadder(RANKS.gyms[0]));
});

test("the module is pure: no DOM, no storage, no fetch and no flag write", () => {
  const source = readFileSync("web/gym-map.js", "utf8");
  for (const word of ["document", "window", "localStorage", "sessionStorage", "fetch", "XMLHttpRequest", "setFlag", "set_flag", "flag-store"]) {
    assert.ok(!source.includes(word), `web/gym-map.js never names ${word}`);
  }
  assert.doesNotMatch(source, /^\s*import\s/m, "the tables are handed in; the module imports nothing");
});

test("the page names its greeter and each rung in plain words", () => {
  const row = rowOf("s330");
  assert.equal(greeterText(row, new Map([["p047leom", { name: "Leom" }]])), "Leom · npc 27 · p047leom");
  assert.equal(greeterText(row), "npc 27 · p047leom", "a sprite the manifest does not name is still named by its id");
  assert.equal(placeName("s330", new Map([["s330", { name: "Central Sector — Central Park" }]])), "Central Sector — Central Park");
  assert.equal(placeName("s999", new Map()), "s999", "an unnamed stage keeps its id");
  assert.equal(gateText([{ item: 40, mustOwn: true }], names), "SilverID");
  assert.equal(gateText([{ item: 42, mustOwn: true }], names), "PlatinumID");
  assert.equal(gateText([{ item: 40, mustOwn: true }, { item: 41, mustOwn: true }], names), "SilverID + GoldID");
  assert.equal(gateText([{ item: 42, mustOwn: false }, { item: 40, mustOwn: true }], names), "needs SilverID; must not have PlatinumID");
  assert.equal(gateText([{ item: 42, mustOwn: false }, { item: 41, mustOwn: false }], names), "must not have PlatinumID or GoldID");
  assert.equal(gateText([]), "always open");
  assert.equal(drillText({ drill: 7, primary: 9, secondary: 2 }), "water, risks defence");
  assert.equal(drillText({ drill: 6, primary: 8, secondary: 16 }), "fire, plus max MP");
  assert.equal(drillText({ drill: 1, primary: 1, secondary: 0 }), "strength");
  assert.deepEqual(mapSummary(rows, GYM), { gyms: 9, ranks: 14, drills: 158, tp: [1, 5, 10] });
});

test("the F2 switch is the Extras pair and EXPERIMENTAL, with a button row hidden while off", () => {
  const ambience = readFileSync("web/ambience.js", "utf8");
  assert.ok(ambience.includes('["gymmap", "Gym map (new)"]'), "the Extras row has the pair");
  assert.match(ambience, /const EXPERIMENTAL = \[[^\]]*"gymmap"/, "gymmap is off until switched on");
  const devModel = readFileSync("web/dev-panel-model.js", "utf8"), devPanel = readFileSync("web/dev-panel.js", "utf8");
  assert.match(devModel, /gymmap: P\("gym-map\.html"/, "the Open button's page is in the F2 page model");
  assert.match(ambience, /if \(!o \|\| !fx\[key\]\) return;/, "opened only behind the switch (the Open guard)");
  assert.match(devPanel, /b\.disabled = !fx\[/, "the Open button is disabled while the switch is off");
  assert.doesNotMatch(readFileSync("web/game.js", "utf8"), /gym-map|gymmap/, "the map is not a game.js hook");
});

test("the page exists, imports the module and reads the shipped tables", () => {
  assert.ok(existsSync("web/gym-map.html"));
  assert.ok(existsSync("web/gym-map-page.js"));
  const html = readFileSync("web/gym-map.html", "utf8");
  assert.match(html, /from "\.\/gym-map-page\.js"/);
  assert.match(html, /id="gyms"/);
  assert.match(html, /Gym map/);
  const page = readFileSync("web/gym-map-page.js", "utf8");
  for (const file of ["assets/data/gym_ranks.json", "assets/data/progression.json", "assets/data/item_effects.json"]) {
    assert.ok(page.includes(file), `the page reads ${file}`);
  }
  assert.match(page, /from "\.\/gym-map\.js"/);
});
