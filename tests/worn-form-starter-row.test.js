// The stored numbers belong to the STARTER's row, never the worn form's.
//
// The disc keeps a partner's base stats, element base, growth rate and level-up
// gains on the starter's growth row and copies them into the roster record
// (pro/ststatus.s:9547 F0x80017174 fills from the record; pro/stfgtrep.s builds the
// growth row from 0x8003EF5C + slot*0x58). A digivolution only changes a "current
// form" word; the form's numbers are added on top in battle. Every host-side path
// that seeds a missing stored block must therefore seed it from the starter.
//
// Rows here are invented on purpose — no game data in this repo.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { partyRosterView, CHARID_TO_DIGID } from "../web/party.js";
import { applyLevelUp, seedStoredStats } from "../web/battle.js";

// A manifest lead whose starter row is id 1, wearing form id 900.
const CHAR = "p003pken";
const STARTER_ID = CHARID_TO_DIGID[CHAR];
const FORM_ID = 900;

// Invented rows: clearly different numbers, so a wrong source is obvious.
const starter = {
  id: STARTER_ID, name: "TestStarter", is_starter: true,
  hp: 300, mp: 300,
  str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16,
  growth: { hp: 9, mp: 9, str: 2, def: 2, spt: 2, wis: 2, spd: 2, chr: 2 },
  growth_xp: 8,
  resistances: { fire: 40, water: 30, ice: 20, wind: 10, thunder: 5, machine: 3, dark: 1 },
  resistance_growth: { fire: 1, water: 1, ice: 1, wind: 1, thunder: 1, machine: 1, dark: 1 },
};
const form = {
  id: FORM_ID, name: "TestForm", is_starter: false,
  hp: 900, mp: 900,
  str: 71, def: 72, spt: 73, wis: 74, spd: 75, chr: 76,
  growth: { hp: 1, mp: 1, str: 1, def: 1, spt: 1, wis: 1, spd: 1, chr: 1 },
  growth_xp: 1,
  resistances: { fire: 400, water: 300, ice: 200, wind: 100, thunder: 50, machine: 30, dark: 10 },
  resistance_growth: { fire: 2, water: 2, ice: 2, wind: 2, thunder: 2, machine: 2, dark: 2 },
};
const db = { [STARTER_ID]: starter, [FORM_ID]: form };

const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const CORE = ["str", "def", "spt", "wis", "spd", "chr"];

// a. Lead wearing the form with trained element points: the stored block is the
// starter's numbers plus the trained points, not the form's plus the points.
test("partyRosterView: elements come from the starter row, not the worn form", () => {
  const trained = { fire: 5, water: 5, ice: 5, wind: 5, thunder: 5, machine: 5, dark: 5 };
  const ps = { level: 1, digimonId: FORM_ID, elemBonuses: trained };
  const [view] = partyRosterView([CHAR], ps, [], db, {});

  ELEMENTS.forEach((k) => {
    assert.equal(view.elements[ELEMENTS.indexOf(k)], starter.resistances[k] + trained[k],
      `elements.${k} must be the starter's base plus the trained point`);
  });
  assert.notEqual(view.elements[0], form.resistances.fire + trained.fire);

  // The picture and the form name still need the form.
  assert.equal(view.digimonId, FORM_ID);
  assert.equal(view.profile, form);
});

// b. No stored block yet: `core` falls back to the starter's own numbers.
test("partyRosterView: core falls back to the starter's numbers", () => {
  const [view] = partyRosterView([CHAR], { level: 1, digimonId: FORM_ID }, [], db, {});
  CORE.forEach((k, i) => assert.equal(view.core[i], starter[k], `core.${k} from the starter row`));
  assert.notEqual(view.core[0], form.str);
});

// c. A record with no stored block, given both profiles: seeded from the starter's
// growth row. The table below rolls zero for every core stat, so the stored block
// after the level-up IS the seed (taken at the new level).
test("applyLevelUp: seeds a missing stored block from the growth row", () => {
  const lu = {
    hpmp_cap: 9999, stat_cap: 999,
    hpmp_tier_adj: [0, 0, 0, 0],
    hpmp_rand9: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    core_tier_bounds: [5, 20, 40, 60, 80],
    core_table: Array.from({ length: 6 }, () => Array(9).fill(0)),
    elem_table: Array(8).fill(0),
    elem_level_limit: 41,
  };
  const ps = { level: 1, digimonId: FORM_ID };
  applyLevelUp(ps, form, 1, 2, lu, starter);
  const fromStarter = seedStoredStats(starter, 2);
  const fromForm = seedStoredStats(form, 2);
  CORE.forEach((k) => {
    assert.equal(ps.stats[k], fromStarter[k], `seed ${k} from the starter`);
    assert.notEqual(ps.stats[k], fromForm[k], `${k} must not come from the worn form`);
  });
});

// d. Source: the online win path and every seeding call read the starter.
test("applyWin uses the growth row's curve, not the form's", () => {
  const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.match(src, /growthProfile\.growth_xp \?\? 8, lu\)/);
  assert.match(src, /applyLevelUp\(ps, prof, oldLevel, newLevel, lu, growthProfile\)/);
  assert.doesNotMatch(src, /levelForExp\(oldLevel, newXp, prof\.growth_xp/);
});

test("no seeding call still hands the bare form to ensureStoredStats or elementValues", () => {
  const read = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
  const seeding = [
    ["battle.js", /ensureStoredStats\(ps, digimonDB\?\.\[CHARID_TO_DIGID\[state\?\.party\?\.\[0\]\]\] \?\? prof\)/],
    ["gym.js", /ensureStoredStats\(ps, driStarterAt\(state, g\.trainSlot, g\.digimonById\) \?\? prof\)/],
    ["gym-native.js", /ensureStoredStats\(ps, tables\?\.digimonById\?\.\[CHARID_TO_DIGID\[party\[i\]\]\] \?\? profile\)/],
    ["gym-translated.js", /ensureStoredStats\(ps, g\._data\.digimonById\[CHARID_TO_DIGID\[party\[i\]\]\] \?\? profile\)/],
    ["nameentry-native.js", /ensureStoredStats\(ps, tables\?\.digimonById\?\.\[CHARID_TO_DIGID\[party\[i\]\]\] \?\? profile\)/],
    ["shop-native.js", /ensureStoredStats\(rec, db\[v\.rookieId\] \?\? v\.profile\)/],
    ["shop-translated.js", /ensureStoredStats\(record, db\[member\.rookieId\] \?\? member\.profile\)/],
  ];
  for (const [file, pattern] of seeding) {
    // Strip the definition line: `export function ensureStoredStats(ps, profile)` is
    // the helper itself, not a seeding call.
    const src = read(file).split("\n").filter((l) => !/^\s*export function ensureStoredStats/.test(l)).join("\n");
    assert.match(src, pattern, `${file} must seed from the starter`);
    // The bare-form shape that was there before this change.
    assert.doesNotMatch(src, /ensureStoredStats\((ps|rec|record), (prof|profile|v\.profile|member\.profile)\)/,
      `${file} must not seed from the worn form`);
  }

  // The stored ELEMENT numbers come from the same starter row, not the worn
  // form: the translated gym's seed is the one call the trainer screen uses.
  const gym = read("gym-translated.js");
  assert.match(gym, /elements: elementValues\(g\._data\.digimonById\[CHARID_TO_DIGID\[party\[i\]\]\] \?\? profile, ps\.elemBonuses\)/,
    "gym-translated.js must build the stored element values from the starter row");
  assert.doesNotMatch(gym, /elementValues\(profile, ps\.elemBonuses\)/,
    "gym-translated.js must not build the stored element values from the worn form");
});
