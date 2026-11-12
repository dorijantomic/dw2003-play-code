// The elemental field techniques (213..219). Before: F2 -> Extras switch, off by default. Now always on (see battle.js castFieldTechnique).
// The seven field ITEMS (77..83) have always written the battlefield element. The
// seven field TECHNIQUES (213..219) are the record machine's category-6 arm and
// print the disc's own word (esmfight[elem1 + 0x61], "Fire field!" .. "Dark
// field!"), but the browser never wrote `b.field` for them. This spec wires the
// techniques to the same field pair and, with the switch on, walks the field on
// its own every four player actions through fire .. dark and back to none.
//
// The numbers: power 64 is the byte all seven technique records carry (record
// +0x0c, the `crit` field) and the value the seven field items write. The field
// adjustment itself is the existing engine leaf (engine/dw3/battle-formulas.ts
// `elementalFieldAdjustment`): a matching element adds base*power/128, the
// countered element subtracts base*power/256.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIELD_CYCLE, nextField, fieldName } from "../web/field-war.js";
import { elementalFieldAdjustment } from "../engine/dw3/battle-formulas.ts";

const DATA = new URL("../web/assets/data/", import.meta.url);
const techTable = JSON.parse(readFileSync(new URL("fight_tech_table.json", DATA), "utf8"));
const itemTable = JSON.parse(readFileSync(new URL("items.json", DATA), "utf8"));
const BATTLE_SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const AMBIENCE_SRC = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");

test("the seven field techniques are records 213..219: category 6, elem1 2..8, mp 100, power byte 64", () => {
    const rows = [];
    for (let id = 213; id <= 219; id++) {
        const row = techTable[String(id)];
        assert.ok(row, `technique record ${id} is in the shipped table`);
        rows.push(row);
    }
    assert.equal(rows.length, 7, "exactly seven field techniques");
    rows.forEach((row, index) => {
        assert.equal(row.category, 6, `record ${213 + index} is the category-6 field arm`);
        assert.equal(row.elem1, index + 2, `record ${213 + index} carries its own element (fire..dark)`);
        assert.equal(row.mp, 100, `record ${213 + index} costs 100 MP`);
        assert.equal(row.crit, 64, `record ${213 + index} carries the field power byte (64, like the field items)`);
    });
    // No other row is a field technique: the category-6 arm's whole population is these seven.
    const others = Object.entries(techTable)
        .filter(([id, row]) => row.category === 6 && !(Number(id) >= 213 && Number(id) <= 219));
    assert.deepEqual(others, [], "category 6 holds nothing but the seven field techniques");
});

test("the seven field items are FlameField..DarkField, and UnknownField (84) is not one of them", () => {
    const byId = new Map(itemTable.items.map((item) => [item.id, item]));
    const names = [];
    for (let id = 77; id <= 83; id++) {
        const item = byId.get(id);
        assert.ok(item, `item ${id} is in the shipped item table`);
        names.push(item.name);
    }
    assert.deepEqual(names, [
        "FlameField", "WaterField", "IceField", "WindField",
        "ThunderField", "MachineField", "DarkField",
    ]);
    assert.equal(byId.get(84)?.name, "UnknownField", "item 84 rolls its own element and is not in the cycle");
});

test("the cycle is fire -> water -> ice -> wind -> thunder -> machine -> dark -> none", () => {
    assert.deepEqual(FIELD_CYCLE, ["fire", "water", "ice", "wind", "thunder", "machine", "dark", null]);
});

test("nextField steps forward through the cycle and wraps from none back to fire", () => {
    assert.deepEqual(nextField({ element: "fire", power: 100 }, 1),
        { element: "water", power: 100 }, "one step from fire is water, the power stays");
    let field = { element: "fire", power: 64 };
    for (let step = 0; step < 8; step++) field = nextField(field, 1);
    assert.deepEqual(field, { element: "fire", power: 64 }, "eight steps from fire return to fire");
    assert.deepEqual(nextField(null, 1), { element: "fire", power: 64 },
        "no field steps to fire with the field items' own 64 power");
    assert.equal(nextField({ element: "dark", power: 64 }, 1), null, "after dark the field is gone");
});

test("fieldName is the disc's own word, and nothing for a name it does not hold", () => {
    assert.equal(fieldName("fire"), "Fire field!");
    assert.equal(fieldName("dark"), "Dark field!");
    assert.equal(fieldName("normal"), null);
    assert.equal(fieldName("bogus"), null);
    assert.equal(fieldName(null), null);
});

test("the engine's field adjustment is the real +base*power/128 and -base*power/256", () => {
    // F0x8009f644: a matching field adds base*power/128 ...
    assert.equal(elementalFieldAdjustment(1000, "fire", { element: "fire", power: 100 }), 781);
    // ... and the field that counters the attack element subtracts base*power/256.
    assert.equal(elementalFieldAdjustment(1000, "water", { element: "fire", power: 100 }), -390);
    // A normal attack has no element and is never adjusted.
    assert.equal(elementalFieldAdjustment(1000, "normal", { element: "fire", power: 100 }), 0);
});

test("battle.js writes the field from the category-6 record, always, with the disc power and timer", () => {
    // F0x800907cc: no switch. The technique's own record writes the field pair.
    assert.doesNotMatch(BATTLE_SRC, /fieldWarEnabled|__fx\?\.fieldwar/, "no fieldwar gate");
    assert.match(BATTLE_SRC, /castFieldTechnique\(b, 0, restoreRecord, elementNameForElem1\(restoreRecord\.elem1\)\)/);
    assert.match(BATTLE_SRC, /castFieldTechnique\(b, 1, restoreRecord, elementNameForElem1\(restoreRecord\.elem1\)\)/);
    assert.match(BATTLE_SRC, /Math\.min\(127, \(record\.crit \| 0\) \+ Math\.trunc\(spt \/ 10\)\)/, "power 64 + SPT/10, cap 127");
    assert.match(BATTLE_SRC, /1000 \+ 12 \* spt/, "duration 1000 + 12*SPT");
});

test("ambience.js carries no fieldwar switch", () => {
    assert.doesNotMatch(AMBIENCE_SRC, /fieldwar/);
});
