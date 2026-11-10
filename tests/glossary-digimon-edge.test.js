// Odd inputs must give every line a text and never throw (Review Focus 5).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSpecies, listRows, pageOne, pageTwoLines } from "../web/glossary-digimon.js";

const fakeLog = { metCount: () => 1, beatenCount: () => 1, totals: () => ({ met: 0, beaten: 0 }) };

test("empty and missing tables give an empty list, not an error", () => {
    for (const args of [{}, { digimon: null, enemies: null }, { digimon: { digimon: [], skills: [] }, enemies: { enemies: [] } }]) {
        const { species } = buildSpecies(args);
        assert.deepEqual(species, []);
        assert.deepEqual(listRows(species, fakeLog, []), []);
    }
});

test("a wild-only species with no encounter, no model map, no drop gives text on every line", () => {
    const enemies = { enemies: [{ enemy_id: "Lonely", digimon_id: "Lonely", attack: 0, move_1: 0, move_2: 0, str: 1, def: 1, spt: 1, wis: 1, spd: 1, resistances: {}, status_resist: {}, digimon_type: 0, drop_item: "Null", drop_rate: 0, ai_moves: [] }] };
    const { species, world, maxima } = buildSpecies({ digimon: { digimon: [], skills: [] }, enemies, modelMap: null, encounters: {} });
    assert.equal(species.length, 1);
    const p1 = pageOne(species[0], "known", fakeLog, null);
    assert.equal(p1.row1, "", "no encounter row and not your partner: no level line");
    assert.equal(p1.lives, "", "no map: no Lives in line");
    assert.equal(p1.drops, "", "no drop: no Drops line");
    for (const line of pageTwoLines(species[0], "known", null, world, maxima)) {
        assert.ok(line.kind === "head" || typeof line.label === "string");
        if (line.kind === "text") assert.ok(typeof line.text === "string" && line.text.length > 0, JSON.stringify(line));
    }
});

test("a partner whose line is missing from evolutions.json still builds", () => {
    const digimon = { digimon: [{ id: 1, name: "A", hp: 1, mp: 1, str: 1, def: 1, spt: 1, wis: 1, spd: 1, chr: 1, family: 1, resistances: {}, tech_slots: [], blasts: [] }], skills: [] };
    const { species, world, maxima } = buildSpecies({ digimon, evolutions: null, enemies: { enemies: [] } });
    const lines = pageTwoLines(species[0], "known", { slot: 5, rookie: "A", form: "A", level: 1, live: { level: 1, formLevels: {} } }, world, maxima);
    assert.ok(lines.length > 0);
});
