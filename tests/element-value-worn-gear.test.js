// A worn piece's coded resist ADDS to the trained points on the element row; it
// never replaces them. The original folds the gear into the trainer's own
// halfword (exe/fns.s L7742-L8054, F0x80017578 codes 8..14), and every screen
// reads that one halfword — the status sheet, the shop preview, the gym HUD and
// the battle divisor. The gym HUD used to spread the gear over `elemBonuses`, so
// a trained +5 under a +10 piece printed 10 instead of 15.
//
// One home: web/party.js elementPointsWithGear / elementValueWithGear, over
// engine/dw3/effective-stats.ts's elementValue. Rows here are invented on
// purpose — no game data in this repo.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { elementPointsWithGear, elementValueWithGear } from "../web/party.js";

// An invented species row: base 40 fire resist, everything else small.
const row = { id: 901, name: "TestRow", resistances: { fire: 40, water: 7, ice: 0, wind: 0, thunder: 0, machine: 0, dark: 0 } };

// a. Trained +5 under a +10 piece is 15, not 10 (the reported bug).
test("elementPointsWithGear: the gear adds to the trained point", () => {
  const points = elementPointsWithGear({ fire: 5 }, { fire: 10 });
  assert.equal(points.fire, 15);
});

// b. A key the gear leaves alone keeps its trained point; a key only the gear has
// gets it outright; nothing is lost and nothing is invented as 0.
test("elementPointsWithGear: per element, not one table over another", () => {
  const points = elementPointsWithGear({ fire: 5, water: 3 }, { fire: 10, ice: 4 });
  assert.deepEqual(points, { fire: 15, water: 3, ice: 4 });
});

// c. Missing inputs are the empty table, never a crash.
test("elementPointsWithGear: null tables", () => {
  assert.deepEqual(elementPointsWithGear(undefined, undefined), {});
  assert.deepEqual(elementPointsWithGear(null, { fire: 2 }), { fire: 2 });
  assert.deepEqual(elementPointsWithGear({ fire: 2 }, null), { fire: 2 });
});

// d. The value a screen prints: species base + trained + worn, capped at 999.
test("elementValueWithGear: base plus trained plus worn, capped", () => {
  assert.equal(elementValueWithGear(row, { fire: 5 }, { fire: 10 }, "fire"), 55);
  assert.equal(elementValueWithGear(row, { water: 3 }, { water: 4 }, "water"), 14);
  assert.equal(elementValueWithGear(row, { fire: 5 }, { fire: 10 }, "ice"), 0);
  assert.equal(elementValueWithGear(row, { fire: 900 }, { fire: 900 }, "fire"), 999);
  // The worn value alone must not stand in for the trained one.
  assert.notEqual(elementValueWithGear(row, { fire: 5 }, { fire: 10 }, "fire"), 50);
});

// e. Every screen goes through the helper: the three hand-rolled copies are gone.
test("the sheet, the battle divisor and the gym HUD call the one helper", () => {
  const read = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");

  const menu = read("menu.js");
  assert.match(menu, /return elementValueWithGear\(p\?\.profile, p\?\.elemBonuses, b\.elemResists, res\);/);
  assert.doesNotMatch(menu, /\[res\]: \(p\?\.elemBonuses\?\.\[res\] \?\? 0\) \+ worn/);

  const battle = read("battle.js");
  assert.match(battle, /const pElem = elementPointsWithGear\(ps\.elemBonuses, eb\.elemResists\);/);
  assert.doesNotMatch(battle, /pElem\[el\] = \(pElem\[el\] \?\? 0\) \+ v/);

  const gym = read("gym.js");
  assert.match(gym, /const v = elementValueWithGear\(starter, st\?\.elemBonuses, worn, res\);/);
  // The spread that let the gear REPLACE the trained points.
  assert.doesNotMatch(gym, /elementValue\(prof, \{ \.\.\.\(st\?\.elemBonuses \?\? \{\}\), \.\.\.worn \}, res\)/);
  // The res rows sit on the starter's base, not the worn form's.
  assert.match(gym, /const starter = driStarterAt\(state, member\.index \?\? g\.trainSlot, g\.digimonById\) \?\? prof;/);
});
