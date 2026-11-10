// The Digimon Codex data, part 2: the wild rows (web/codex-data.js).
//
// One row per real wild record in enemies.json: name, the five core stats the record
// carries, the seven element resistances, the five status resistances, the family
// (digimon_type), the basic attack and the two special move ids with their real
// technique names, the drop item, and the record's four AI rows in plain words.
// The disc's one `Null` placeholder record is skipped, so there are 193 enemies, not 194.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  wildRows,
  wildSearch,
  dropText,
} from "../web/codex-data.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const enemyFile = read("web/assets/data/enemies.json");
const enemies = enemyFile.enemies;
const digimon = read("web/assets/data/digimon.json");
const models = read("web/assets/battle/model_map.json");

const rows = wildRows(enemies, digimon.skills, models);

test("the wild table is 193 rows: the disc's one Null placeholder is the only record skipped", () => {
  assert.equal(enemies.length, 194, "the extracted table still holds 194 records");
  assert.equal(rows.length, 193, "193 real wild records");
  const byName = new Map(rows.map((r) => [r.name, r]));
  const skipped = enemies.filter((r) => !byName.has(r.enemy_id)).map((r) => r.enemy_id);
  assert.deepEqual(skipped, ["Null"], "exactly one input row is dropped, and it is the Null placeholder");
  assert.equal(new Set(rows.map((r) => r.name)).size, 193, "no name repeats");
  assert.ok(rows.every((r) => r.number >= 1 && r.number <= 193), "every row is numbered 1..193");
});

test("Kunemon's row carries the battle's own numbers, four AI rows, and its basic attack resolves to a named skill", () => {
  const k = rows.find((r) => r.name === "Kunemon");
  assert.ok(k, "Kunemon is a wild row");
  assert.equal(k.number, 1, "Kunemon is the first record on the disc");
  assert.equal(k.family, 8, "family = digimon_type");
  assert.equal(k.stats.str, 50);
  assert.equal(k.stats.def, 42);
  assert.equal(k.stats.spt, 40);
  assert.equal(k.stats.wis, 50);
  assert.equal(k.stats.spd, 48);
  assert.deepEqual(k.resists, {
    fire: 90, water: 90, ice: 90, wind: 60, thunder: 160, machine: 90, dark: 160,
  });
  assert.deepEqual(k.status, {
    poison: 99, paralyze: 50, confuse: 50, sleep: 50, ko: 0,
  });
  assert.equal(k.drop, "Null", "the Null drop is the disc's no-item placeholder");
  assert.equal(k.model, "m032kune", "the model folder the battle draws it with");
  assert.equal(k.aiRows.length, 4, "the record always carries four AI rows");
  for (const ai of k.aiRows) {
    assert.equal(ai.action, 1);
    assert.equal(ai.comparator, 0);
    assert.equal(ai.value, 0);
  }
  assert.equal(k.attack.id, 220, "the basic attack id the record stores");
  assert.equal(k.attack.name, "Fight", "resolved through digimon.json's skills");
  assert.deepEqual(k.move1, { id: 0, name: null }, "id 0 is no technique, never a guess");
  assert.deepEqual(k.move2, { id: 0, name: null });
});

test("Numemon's row carries its real dark resist and drop, and the Numemon search finds the seven rows", () => {
  const n = rows.find((r) => r.name === "Numemon");
  assert.ok(n, "Numemon is a wild row");
  assert.equal(n.resists.dark, 280);
  // The card text said Numemon's drop is Null. The extracted record says BinderCrest at
  // rate 64; the Null drops among the Numemon family are Numemon4 and BKKingNumemon.
  assert.equal(n.drop, "BinderCrest");
  assert.equal(n.dropRate, 64);
  const found = wildSearch(rows, "Numemon");
  assert.equal(found.length, 7);
  assert.deepEqual(
    found.map((r) => r.name),
    ["Numemon", "Numemon2", "Numemon3", "Numemon4", "Numemon5", "Numemon6", "BKKingNumemon"],
  );
  assert.equal(wildSearch(rows, "numemon").length, 7, "the search ignores case");
  assert.equal(wildSearch(rows, "  numemon  ").length, 7, "and surrounding spaces");
  assert.equal(wildSearch(rows, "zzz").length, 0);
});

test("every drop is the disc's Null placeholder or one of the 78 real drop names, and no Cardmon row drops anything", () => {
  const named = new Set(rows.map((r) => r.drop).filter((d) => d !== "Null"));
  assert.equal(named.size, 78, "78 real drop items across the 193 records");
  for (const r of rows) {
    assert.ok(r.drop === "Null" || named.has(r.drop), `${r.name} drop ${r.drop} is a real item`);
    assert.equal(dropText(r), r.drop === "Null" ? "none" : r.drop);
  }
  const cardmon = rows.filter((r) => /^Cardmon\d*$/.test(r.name));
  assert.equal(cardmon.length, 8, "the eight Cardmon records are in the table");
  for (const r of cardmon) {
    assert.equal(r.drop, "Null");
    assert.equal(dropText(r), "none", "no Cardmon row shows a drop");
    assert.equal(r.dropRate, 0);
  }
});

test("all 193 real rows resolve a model folder, and the skipped Null placeholder is the only name without one", () => {
  assert.equal(Object.keys(models).length, 250, "the model map keeps 250 species");
  for (const r of rows) {
    assert.equal(typeof r.model, "string", `${r.name} resolves a model folder`);
    assert.equal(r.model, models[r.name], `${r.name}'s folder is the map's own`);
  }
  const realNames = new Set(rows.map((r) => r.name));
  const withoutModel = enemies.map((r) => r.enemy_id).filter((n) => !(n in models));
  assert.deepEqual(withoutModel, ["Null"], "the Null placeholder is the only record the map does not name");
  assert.equal(realNames.size, 193);
});
