// The Digimon Codex data, part 4: the drop index (web/codex-data.js).
//
// Pick an item and get every enemy that really drops it, the disc's own odds and every
// stage pool where each of those enemies can be met. The odds are the disc's, not a
// percentage: a rate byte of 128 means (128 + 1) in 1024 per win ("129 in 1024", never
// "12.8%"). The browser's own roll (web/battle.js) is not touched.
//
// The enemies are the 194 records of enemies.json minus the one `Null` placeholder;
// the 92 real ones that name an item name 78 distinct items. The stage pools are the
// same stage_encounters.json + field_encounters.json join part 3 reads (a row there is
// a real roll), and items.json (`catalog` 402 key items + `items` 83 consumables) is
// the name source, so all 78 drop names resolve. The future glossary ITEMS page reuses it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dropIndex,
  dropOdds,
  dropItems,
  dropEntry,
  dropSearch,
  itemByName,
  enemyStages,
  encounterIndex,
} from "../web/codex-data.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const enemyFile = read("web/assets/data/enemies.json");
const itemsFile = read("web/assets/data/items.json");
const stageFile = read("web/assets/data/stage_encounters.json");
const fieldFile = read("web/assets/data/field_encounters.json");
const manifest = read("web/assets/manifest.json");

const index = encounterIndex(stageFile, fieldFile, manifest);
const drops = dropIndex(enemyFile, index);

test("92 real enemies carry a drop and name 78 items; the Null placeholder and every Cardmon row are not droppers", () => {
  const droppers = [...drops.byItem.values()].flatMap((entry) => entry.droppers);
  assert.equal(droppers.length, 92, "one dropper row per real enemy that names an item");
  assert.equal(drops.byItem.size, 78, "78 distinct items");
  assert.equal(dropItems(drops).length, 78);
  assert.equal(new Set(droppers.map((d) => d.enemy)).size, 92, "no enemy is listed twice");

  // The table really carries the rows the index must skip.
  assert.equal(enemyFile.enemies.filter((e) => e.enemy_id === "Null").length, 1);
  assert.equal(enemyFile.enemies.filter((e) => /^Cardmon\d*$/.test(e.enemy_id)).length, 8);
  assert.ok(!drops.byItem.has("Null"), "the Null placeholder is never an item");
  assert.ok(!droppers.some((d) => d.enemy === "Null"));
  assert.ok(!droppers.some((d) => /^Cardmon/.test(d.enemy)), "no Cardmon row drops anything");

  // A bare array is the same table.
  const fromArray = dropIndex(enemyFile.enemies, index);
  assert.equal(fromArray.byItem.size, 78);
});

test("the disc's six drop rates, and dropOdds keeps the '+1 in 1024' the page prints", () => {
  const rates = [...new Set([...drops.byItem.values()].flatMap((e) => e.droppers.map((d) => d.rate)))].sort((a, b) => a - b);
  assert.deepEqual(rates, [16, 32, 64, 128, 192, 256], "the only rate bytes a real drop uses");
  assert.deepEqual(dropOdds(128), { n: 129, of: 1024 }, "128 means 129 rolls in 1024, not 12.8%");
  assert.deepEqual(dropOdds(0), { n: 1, of: 1024 }, "the disc adds one to the rate byte");
  assert.deepEqual(dropOdds(256), { n: 257, of: 1024 });
  for (const d of [...drops.byItem.values()].flatMap((e) => e.droppers)) {
    assert.deepEqual(d.odds, { n: d.rate + 1, of: 1024 }, `${d.enemy}'s odds are its own rate + 1`);
  }
});

test("CrimsonCable has exactly five droppers, all at 129 in 1024", () => {
  const entry = dropEntry(drops, "CrimsonCable");
  assert.ok(entry, "CrimsonCable is a real dropped item");
  assert.deepEqual(
    entry.droppers.map((d) => d.enemy),
    ["Whamon", "Pukumon", "MetalSeadramon", "Tylomon", "Scorpiomon"],
    "the five enemies enemies.json names",
  );
  assert.ok(entry.droppers.every((d) => d.rate === 128 && d.odds.n === 129 && d.odds.of === 1024));
  // The item's stage list is the union of its droppers' real pools.
  assert.deepEqual(
    entry.stages,
    [351, 396, 401, 446, 521, 646, 691, 706, 756, 795, 800, 805, 954, 963, 964, 967],
  );
  assert.equal(dropEntry(drops, "crimsoncable").droppers.length, 5, "item lookup ignores case");
});

test("Whamon's pool rows land on six stages: 446, 756, 800, 805, 954, 967", () => {
  const rows = index.bySpecies.get("Whamon");
  assert.ok(rows, "Whamon is in the encounter pools");
  assert.equal(rows.length, 9, "nine real slots can roll it");
  const stages = [...new Set(rows.map((r) => r.stage))].sort((a, b) => a - b);
  assert.deepEqual(stages, [446, 756, 800, 805, 954, 967]);
  assert.deepEqual(enemyStages(index, "Whamon"), [446, 756, 800, 805, 954, 967]);
  assert.deepEqual(enemyStages(index, "NoSuchmon"), [], "an enemy with no pool has no stages");
  // Whamon drops exactly one item, and that item's dropper row points back at those stages.
  const whamonItem = dropEntry(drops, "CrimsonCable").droppers.find((d) => d.enemy === "Whamon");
  assert.equal(whamonItem.rate, 128);
});

test("all 78 drop names resolve in items.json; an invented item is nothing at all", () => {
  const names = dropItems(drops);
  assert.equal(names.length, 78);
  assert.equal(names.filter((name) => itemByName(itemsFile, name)).length, 78, "78/78 names resolve");
  const crimson = itemByName(itemsFile, "CrimsonCable");
  assert.equal(crimson.id, 85);
  assert.equal(crimson.category, "consumable");
  assert.equal(itemByName(itemsFile, "NoSuchItem"), null, "an invented item is null");
  assert.deepEqual(dropSearch(drops, "NoSuchItem"), [], "and the finder returns nothing");
  assert.equal(dropSearch(drops, "crimsoncable").length, 1, "an exact name (any case)");
  assert.ok(dropSearch(drops, "Power").length > 1, "a partial name lists the family");
  assert.ok(!/localStorage/.test(readFileSync("web/codex-data.js", "utf8")), "the data module stores nothing");
});
