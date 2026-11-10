// The Digimon Codex data, part 3: the encounter index (web/codex-data.js).
//
// A species search that answers "where can I meet it?": every real slot of every
// stage's encounter pools that can roll it, with the stage number, the stage's own
// manifest name, the 1-based geographic zone (each selector group is four zones of
// eight slots), the slot, the global screen id, and the party's level / HP / stat
// scale, plus that zone block's own rate level.
//
// The two tables are the ones the encounter driver reads (web/battle.js, via
// engine/dw3/encounters.ts): stage_encounters.json picks the screen, field_encounters
// .screens turns that screen into the party. A row is therefore a real roll, and the
// same party stored twice (screen 5) honestly appears twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encounterIndex,
  encounterSearch,
  encounterSpecies,
} from "../web/codex-data.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const stageFile = read("web/assets/data/stage_encounters.json");
const fieldFile = read("web/assets/data/field_encounters.json");
const manifest = read("web/assets/manifest.json");

const mapName = new Map(manifest.maps.map((m) => [m.id, m.name]));
const index = encounterIndex(stageFile, fieldFile, manifest);

test("the index reads all 203 stages, indexes 4,029 non-zero slots as 4,254 real rows, and names every stage", () => {
  assert.equal(Object.keys(stageFile.stages).length, 203, "the extracted table still holds 203 stages");
  assert.equal(index.rows.length, 4254, "one row per party member of every non-zero slot");
  assert.equal(index.bySpecies.size, 193, "the pool rolls 193 distinct species");

  // Count the slots from the stage table itself, not from the index.
  const slots = [];
  for (const [key, stage] of Object.entries(stageFile.stages)) {
    assert.equal(stage.zones.length % 4, 0, `s${key} carries whole selector groups (four zones each)`);
    for (const zone of stage.zones) {
      assert.equal(zone.slots.length, 8, `s${key} keeps its eight-slot pool`);
      for (const id of zone.slots) if (id) slots.push(id);
    }
  }
  assert.equal(slots.length, 4029, "4,029 non-zero slots");
  assert.equal(new Set(slots).size, 332, "332 distinct screens are referenced");
  for (const id of slots) {
    const party = fieldFile.screens[String(id)];
    assert.ok(Array.isArray(party) && party.length > 0, `screen ${id} exists in field_encounters`);
  }

  // All 203 stage keys have a manifest name, and every row joins its own.
  for (const key of Object.keys(stageFile.stages)) {
    assert.equal(typeof mapName.get(`s${key}`), "string", `s${key} has a manifest name`);
  }
  for (const row of index.rows) {
    assert.equal(row.stageName, mapName.get(`s${row.stage}`), `stage ${row.stage}'s name is the manifest's own`);
    assert.equal(typeof row.stageName, "string");
    assert.ok(Number.isInteger(row.stage), "stage is a number");
    assert.ok(row.zone >= 1 && row.zone <= 4, `zone ${row.zone} is a geographic zone (1..4)`);
    assert.ok(row.slot >= 1 && row.slot <= 8, `slot ${row.slot} is a pool slot (1..8)`);
    assert.ok(Number.isInteger(row.screen) && row.screen > 0);
    assert.equal(typeof row.name, "string");
    for (const k of ["level", "hp", "statScale", "rateLevel"]) {
      assert.equal(typeof row[k], "number", `${k} is a number`);
    }
  }
  assert.equal(new Set(index.rows.map((r) => r.stage)).size, 202, "202 stages roll something; s656's pools are all empty");
});

test("Kunemon is reachable on exactly nine stages: 205, 232, 233, 330, 335, 350, 355, 500, 940", () => {
  const rows = index.bySpecies.get("Kunemon");
  assert.ok(rows, "Kunemon has a pool");
  assert.equal(rows.length, 43, "43 real slots can roll it");
  assert.deepEqual(
    [...new Set(rows.map((r) => r.stage))].sort((a, b) => a - b),
    [205, 232, 233, 330, 335, 350, 355, 500, 940],
  );
  assert.ok(rows.every((r) => r.name === "Kunemon"), "every indexed row is Kunemon");
  const first = rows[0];
  assert.equal(first.stage, 205);
  assert.equal(first.stageName, "Central Sector — Asuka Bridge");
  assert.equal(first.zone, 4);
  assert.equal(first.slot, 1);
  assert.equal(first.screen, 263);
  assert.equal(first.level, 6);
  assert.equal(first.hp, 264);
  assert.equal(first.statScale, 35);
  assert.equal(first.rateLevel, 0);
});

test("screen 5 contributes two Numemon rows with the same party, exactly as the disc ships it", () => {
  const rows = index.rows.filter((r) => r.screen === 5);
  assert.equal(rows.length, 2, "the party holds Numemon twice, so the index keeps both");
  const [a, b] = rows;
  assert.deepEqual(a, {
    stage: 675,
    stageName: "Byakko City — Byakko Dome",
    zone: 4,
    slot: 1,
    screen: 5,
    name: "Numemon",
    level: 27,
    hp: 768,
    statScale: 17,
    rateLevel: 0,
  });
  assert.deepEqual(b, a, "the same party twice, never collapsed into one invented row");
  assert.equal(stageFile.stages["675"].zones[3].slots[0], 5, "the slot really holds screen 5");
});

test("rateLevel copies the zone's own byte: 0..5, and stage 330 copies [3, 1, 0, 0]", () => {
  assert.deepEqual(stageFile.rate_table, [2000, 3, 4, 6, 9, 18], "the driver's rate table");
  for (const row of index.rows) {
    assert.ok(Number.isInteger(row.rateLevel), `rate level ${row.rateLevel} is a byte`);
    assert.ok(row.rateLevel >= 0 && row.rateLevel <= 5, `rate level ${row.rateLevel} is in the table's range`);
  }
  const s330 = index.rows.filter((r) => r.stage === 330);
  assert.ok(s330.length > 0);
  const levels = [3, 1, 0, 0];
  for (const row of s330) {
    assert.equal(row.rateLevel, levels[row.zone - 1], `s330 zone ${row.zone} copies its block's byte`);
  }
  assert.deepEqual(stageFile.stages["330"].zones.map((z) => z.rate_level), levels, "the table itself stays [3, 1, 0, 0]");
});

test("the search returns a species' real rows, and an unknown species returns nothing at all", () => {
  assert.equal(encounterSearch(index, "Kunemon").length, 43);
  assert.equal(encounterSearch(index, "kunemon").length, 43, "the search ignores case");
  assert.equal(encounterSearch(index, "  Kunemon  ").length, 43, "and surrounding spaces");
  assert.deepEqual([...new Set(encounterSearch(index, "Kunemon").map((r) => r.stage))].sort((a, b) => a - b),
    [205, 232, 233, 330, 335, 350, 355, 500, 940]);
  assert.deepEqual(encounterSpecies(index, "Kunemon"), ["Kunemon"], "an exact name wins");
  assert.deepEqual(encounterSearch(index, "Agumon"), [], "a partner with no wild pool has no rows");
  assert.deepEqual(encounterSearch(index, "NoSuchmon"), [], "an invented species is never fabricated");
  assert.deepEqual(encounterSearch(index, ""), [], "an empty search is not a species");
  assert.deepEqual(encounterSpecies(index, "Numemon"), ["Numemon"], "an exact name never drags in its numbered variants");
  assert.equal(encounterSpecies(index, "umemon").length, 7, "a partial name lists the whole Numemon family");
});
