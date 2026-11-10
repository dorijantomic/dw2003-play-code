// One home for a party member's stored numbers (card 01-partner-numbers).
//
// Every screen that shows a roster record must read the six core stats and the
// seven element values from ONE place: storedNumbers in web/party.js — the
// STARTER's row plus the trained points and chips, never the worn form. These
// tests fail if a screen starts rebuilding the two arrays by hand again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storedNumbers, partyRosterView } from "../web/party.js";

// Invented numbers. digimon 1 is the starter Kotemon row; 77 is the worn form
// and every one of its numbers is unmistakable, so a leak is easy to spot.
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

const stats = (digimonId, extra = {}) => ({
    digimonId, level: 3, xp: 0, hp: 10, maxHp: 10, mp: 5, maxMp: 5,
    stats: {}, bonuses: {}, elemBonuses: {}, ...extra,
});

test("storedNumbers reads the starter's row, never the worn form", () => {
    const rec = stats(77); // worn form 77, char id still the Kotemon slot
    const numbers = storedNumbers("p003pken", rec, DB);
    assert.deepEqual(numbers.core, [11, 12, 13, 14, 15, 16]);
    assert.deepEqual(numbers.elements, [101, 102, 103, 104, 105, 106, 107]);
});

test("storedNumbers adds the trained points and the stat chips", () => {
    const rec = stats(77, {
        stats: { str: 60, def: 61, spt: 62, wis: 63, spd: 64, chr: 65 },
        bonuses: { str: 1, def: 2, spt: 3, wis: 4, spd: 5, chr: 6 },
        elemBonuses: { fire: 7, water: 8, ice: 9, wind: 10, thunder: 11, machine: 12, dark: 13 },
    });
    const numbers = storedNumbers("p003pken", rec, DB);
    assert.deepEqual(numbers.core, [61, 63, 65, 67, 69, 71]);
    assert.deepEqual(numbers.elements, [108, 110, 112, 114, 116, 118, 120]);
});

test("storedNumbers keeps the caller's fallback only when the char id has no row", () => {
    const rec = stats(77);
    assert.deepEqual(storedNumbers(null, rec, DB, DB[77]).core, [901, 902, 903, 904, 905, 906]);
    assert.deepEqual(storedNumbers("p010pata", rec, {}).core, [0, 0, 0, 0, 0, 0]);
});

test("partyRosterView's core and elements ARE storedNumbers", () => {
    const rec = stats(77, { stats: { str: 60 }, bonuses: { str: 1 }, elemBonuses: { fire: 2 } });
    const [view] = partyRosterView(["p003pken"], rec, [], DB);
    assert.deepEqual(view.core, storedNumbers("p003pken", rec, DB).core);
    assert.deepEqual(view.elements, storedNumbers("p003pken", rec, DB).elements);
    assert.equal(view.core[0], 61);
});

const src = (name) => readFileSync(new URL(`../web/${name}`, import.meta.url), "utf8");

test("the roster screens take their numbers from the one helper", () => {
    for (const file of ["shop-native.js", "shop-translated.js", "gym-native.js", "nameentry-native.js", "dri.js"]) {
        assert.match(src(file), /storedNumbers/, `${file} must use storedNumbers`);
        assert.doesNotMatch(src(file), /(core|elements):\s*(CORE|ELEMENTS)\.map\(/, `${file} still rebuilds an array`);
        assert.doesNotMatch(src(file), /elementValue\((member|v|rec|ps|record)\.?(profile|stats)/, `${file} still reads the worn form`);
    }
});

test("name-entry seeds the third core column from spt, not spr", () => {
    const name = src("nameentry-native.js");
    assert.doesNotMatch(name, /core\?\.spr/);
    assert.doesNotMatch(name, /\bspr\b/);
});

test("the DRI panel draws the stored record, and a form preview keeps its own row", () => {
    const dri = src("dri.js");
    assert.match(dri, /storedNumbers\(member\?\.charId, member\?\.stats, d\.digimonById\)/);
    assert.doesNotMatch(dri, /profile: target \}, key\)/);
    assert.match(dri, /statValue\(member, key, target\)/);
});
