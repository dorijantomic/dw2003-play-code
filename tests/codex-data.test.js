// The Digimon Codex data, part 1: the partner rows (web/codex-data.js).
//
// One row per partner profile the game can hold: the disc's 55, plus the 135 enemy-only
// species web/extra-roster.js merges into digimon.json at runtime. Every number is read from
// the same tables the battle reads, never hand-written here. (The in-game Codex screen is
// gone; the glossary reads these rows.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeDigimon, mergeEvolutions } from "../web/extra-roster.js";
import {
  partnerRows,
  lineTargets,
} from "../web/codex-data.js";

const disc = JSON.parse(readFileSync("web/assets/data/digimon.json", "utf8"));
const evolutions = JSON.parse(readFileSync("web/assets/data/evolutions.json", "utf8"));
const extra = JSON.parse(readFileSync("web/assets/data/extra_species.json", "utf8"));
const mergedDisc = mergeDigimon(disc, extra);
const mergedEvolutions = mergeEvolutions(evolutions, extra);

test("the disc's 55 partner profiles, and exactly the eight starters", () => {
  const rows = partnerRows(disc, disc.skills);
  assert.equal(rows.length, 55);
  assert.equal(rows.filter((r) => r.is_starter).length, 8);
  assert.deepEqual(
    rows.filter((r) => r.is_starter).map((r) => r.name),
    ["Kotemon", "Kumamon", "Monmon", "Agumon", "Veemon", "Guilmon", "Renamon", "Patamon"],
  );
  // every disc row is a disc species, none is flagged added
  assert.ok(rows.every((r) => r.added === false));
});

test("the merged roster is 190 rows and Kunemon (id 56) is flagged added", () => {
  const rows = partnerRows(mergedDisc, disc.skills);
  assert.equal(rows.length, 190);
  const kunemon = rows.find((r) => r.id === 56);
  assert.ok(kunemon, "Kunemon is row 56");
  assert.equal(kunemon.name, "Kunemon");
  assert.equal(kunemon.added, true);
  assert.equal(rows.filter((r) => r.added).length, 135);
});

test("Kotemon's page carries the battle's own numbers: family 1, three resistances, Hot Head, five Blasts", () => {
  const rows = partnerRows(disc, disc.skills);
  const k = rows.find((r) => r.id === 1);
  assert.equal(k.name, "Kotemon");
  assert.equal(k.family, 1);
  assert.equal(k.resistances.fire, 85);
  assert.equal(k.resistances.water, 125);
  assert.equal(k.resistances.thunder, 115);
  assert.equal(k.resistances.ice, 80);
  assert.equal(k.resistances.wind, 80);
  assert.equal(k.resistances.machine, 100);
  assert.equal(k.resistances.dark, 95);
  // the six core stats and HP/MP, straight from the profile
  assert.deepEqual(k.stats, { str: 48, def: 44, spt: 41, wis: 34, spd: 33, chr: 1 });
  assert.equal(k.hp, 150);
  assert.equal(k.mp, 100);
  assert.equal(k.signature.id, 53);
  assert.equal(k.signature.name, "Hot Head");
  assert.equal(k.signature.power, 75);
  assert.equal(k.signature.element, "fire");
  assert.deepEqual(k.blasts, ["Dinohumon", "Kyukimon", "GuardiAngemon", "GranKuwagamon", "MaloMyotismon"]);
  // seven resistances and five status resistances
  assert.equal(Object.keys(k.resistances).length, 7);
  assert.equal(Object.keys(k.statusResist).length, 5);
  assert.equal(k.statusResist.poison, 50);
});

test("a line's records resolve to real profile names: 44 on the disc, 179 after the merge", () => {
  const profiles = disc.digimon;
  const names = lineTargets(evolutions, 0, profiles);
  assert.equal(names.length, 44);
  assert.equal(new Set(names).size, 44);
  const real = new Set(profiles.map((p) => p.name));
  for (const n of names) assert.ok(real.has(n), `${n} is a real profile name`);
  assert.equal(names[0], "Dinohumon");
  // the whole digimon.json object is accepted too
  assert.deepEqual(lineTargets(evolutions, 0, disc), names);

  const merged = lineTargets(mergedEvolutions, 0, mergedDisc);
  assert.equal(merged.length, 179);
  assert.equal(new Set(merged).size, 179);
  assert.equal(merged[44], "Kunemon");
  // a slot the data does not have is an empty list, never a guessed line
  assert.deepEqual(lineTargets(evolutions, 99, profiles), []);
});
