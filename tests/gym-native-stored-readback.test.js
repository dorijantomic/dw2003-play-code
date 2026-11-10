// The native gym's write-back is the exact inverse of its seed (card
// 08-gym-native-readback).
//
// web/gym-native.js seeds the roster record from storedNumbers (stored stats +
// permanent chips; starter base + trained element points) and then reads the
// trained record back. A straight copy folds the chips into the stored stats
// and the species base into the trained points, so every visit counted both
// twice. storedFromRecord (web/party.js) is that inverse; this file proves a
// seed -> no training -> commit round trip leaves the partner block untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storedNumbers, storedFromRecord } from "../web/party.js";

// The record's element halfword order (engine/dw3/effective-stats.ts
// ELEMENT_KEYS, which is also web/gym-native.js's ELEMENTS).
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const CORE = ["str", "def", "spt", "wis", "spd", "chr"];

// Invented numbers. Row 1 is the starter (Kotemon slot p003pken), row 77 the
// digivolution it is wearing: the write-back must never read the worn row.
const DB = {
    1: {
        name: "Kotemon", hp: 111, mp: 22, level: 1,
        str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16,
        resistances: { fire: 101, water: 102, ice: 103, wind: 104, thunder: 105, machine: 106, dark: 107 },
    },
    77: {
        name: "WornForm", hp: 999, mp: 999, level: 1,
        str: 901, def: 902, spt: 903, wis: 904, spd: 905, chr: 906,
        resistances: { fire: 901, water: 902, ice: 903, wind: 904, thunder: 905, machine: 906, dark: 907 },
    },
};

const partner = () => ({
    digimonId: 77, level: 5, xp: 0, tp: 9, hp: 40, maxHp: 55, mp: 6, maxMp: 8,
    stats: { str: 60, def: 61, spt: 62, wis: 63, spd: 64, chr: 65 },
    bonuses: { str: 1, def: 2, spt: 3, wis: 4, spd: 5, chr: 6 },
    elemBonuses: { fire: 7, water: 8, ice: 9, wind: 10, thunder: 11, machine: 12, dark: 13 },
});

test("storedFromRecord undoes the seed: record -> the partner block it came from", () => {
    const ps = partner();
    const rec = storedNumbers("p003pken", ps, DB); // what the seed writes
    const back = storedFromRecord("p003pken", rec.core, rec.elements, ps, DB);
    assert.deepEqual(back.stats, ps.stats);
    assert.deepEqual(back.elemBonuses, ps.elemBonuses);
});

test("the chips and the species base really are in the record (so the copy was wrong)", () => {
    const ps = partner();
    const rec = storedNumbers("p003pken", ps, DB);
    assert.deepEqual(rec.core, [61, 63, 65, 67, 69, 71]);          // stored + chips
    assert.deepEqual(rec.elements, [108, 110, 112, 114, 116, 118, 120]); // base + trained
    assert.notDeepEqual(rec.core, CORE.map((k) => ps.stats[k]));
    assert.notDeepEqual(rec.elements, ELEMENTS.map((k) => ps.elemBonuses[k]));
});

test("a visit that trains nothing leaves the partner block unchanged, visit after visit", () => {
    const ps = partner();
    const before = JSON.parse(JSON.stringify(ps));
    for (let visit = 0; visit < 3; visit++) {
        const rec = storedNumbers("p003pken", ps, DB);
        const back = storedFromRecord("p003pken", rec.core, rec.elements, ps, DB);
        ps.stats = back.stats;
        ps.elemBonuses = back.elemBonuses;
        assert.deepEqual(ps.stats, before.stats, `visit ${visit + 1} moved the stored stats`);
        assert.deepEqual(ps.elemBonuses, before.elemBonuses, `visit ${visit + 1} moved the trained points`);
        assert.deepEqual(ps.bonuses, before.bonuses, `visit ${visit + 1} moved the chips`);
    }
    assert.deepEqual(ps, before);
});

test("what the screen does train still lands, on top of the untouched chips and base", () => {
    const ps = partner();
    const rec = storedNumbers("p003pken", ps, DB);
    rec.core[0] += 4;      // +4 STR from the drill rolls
    rec.elements[0] += 2;  // +2 fire
    const back = storedFromRecord("p003pken", rec.core, rec.elements, ps, DB);
    assert.equal(back.stats.str, 64);      // stored 60 + 4, chips still beside it
    assert.equal(back.stats.def, 61);
    assert.equal(back.elemBonuses.fire, 9); // trained 7 + 2
    assert.equal(back.elemBonuses.water, 8);
});

test("gym-native's commit reads the record back through the helper", () => {
    const src = readFileSync(new URL("../web/gym-native.js", import.meta.url), "utf8");
    assert.match(src, /import \{[^}]*storedFromRecord[^}]*\} from "\.\/party\.js"/);
    assert.match(src, /storedFromRecord\(party\[i\], recCore, recElements, ps, tables\?\.digimonById \?\? \{\}\)/);
    assert.match(src, /ps\.stats = stored\.stats;/);
    assert.match(src, /ps\.elemBonuses = stored\.elemBonuses;/);
    assert.doesNotMatch(src, /ps\.stats = core;/, "gym-native still copies the record's core straight back");
    assert.doesNotMatch(src, /ps\.elemBonuses = elems;/, "gym-native still copies the record's elements straight back");
});
