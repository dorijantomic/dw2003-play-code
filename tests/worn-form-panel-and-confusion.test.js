// Two leftovers of the worn-form rule. The partner keeps its STARTER's grown numbers and a form change
// only writes the roster's "current form" word; in battle F0x8009EC94 builds the fighter block from the
// roster record's own row and then adds the live form's species row on top.
//
// 1. The battle digivolve panel's own block is the F0x80017174 scratch (exe/fns.s:7741 copies the roster
//    record's +0x1C block; the worn gear is folded in at :7837-7934), so its element halfwords carry the
//    ROSTER row's base, never the worn form's. The panel then adds the cursor row's base itself.
// 2. The confusion gag reads the block F0x8009EC94 has just rebuilt (pro/fightstg.s:32129 `jal` and then
//    the +0x1E/+0x12 halfwords at :32136-32139), i.e. the in-battle sum with the live form added, with the
//    block's floor of 1 (engine/dw3/effective-stats.ts:105-113).
//
// Invented numbers only; every value below comes from the shared helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { elementValue } from "../engine/dw3/effective-stats.ts";
import { combatantElements } from "../engine/dw3/battle-combat.ts";

const SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");

test("the digivolve panel's own block uses the roster row's base, not the worn form's", () => {
  assert.match(SRC, /elemValue\(rec\?\.savedProfile, rec\?\.elemBonuses, k\)/);
  assert.doesNotMatch(SRC, /elemValue\(rec\?\.profile, rec\?\.elemBonuses, k\)/);

  const savedProfile = { resistances: { wind: 30, fire: 10 } };
  const wornProfile = { resistances: { wind: 90, fire: 50 } };
  const points = { wind: 7, fire: 5 };
  assert.equal(elementValue(savedProfile, points, "wind"), 37);
  assert.equal(elementValue(wornProfile, points, "wind"), 97);
});

test("the confusion gag's wind term is the in-battle sum, not the worn form's own row", () => {
  assert.match(SRC, /const effectiveWind = combatantElements\(b\.player\)\.wind;/);
  assert.doesNotMatch(SRC, /elementValue\(b\.player\.profile, b\.player\.elemBonuses, "wind"\)/);

  const rec = {
    savedSpeciesId: 6,
    savedProfile: { resistances: { wind: 30, fire: 10 } },
    profile: { id: 7, resistances: { wind: 90, fire: 50 } },
    elemBonuses: { wind: 7, fire: 5 },
  };
  const els = combatantElements(rec);
  assert.equal(els.wind, 127);
  assert.equal(els.fire, 65);
  assert.equal(els.wind, elementValue(rec.savedProfile, rec.elemBonuses, "wind") + rec.profile.resistances.wind);
});

test("a value the worn row would make negative still floors at 1 in the block", () => {
  const rec = {
    savedSpeciesId: 6,
    savedProfile: { resistances: { wind: 2 } },
    profile: { resistances: { wind: 0 } },
    elemBonuses: { wind: -9 },
  };
  assert.equal(combatantElements(rec).wind, 1);
});
