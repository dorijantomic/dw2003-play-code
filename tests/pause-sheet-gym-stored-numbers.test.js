// Card 09: the last three screens that rebuilt a partner's numbers themselves.
// The pause STATUS sheet, the gym HUD's six core rows and the gym-translated
// seed must all print the record's STORED numbers — storedNumbers() in
// web/party.js, which rebuilds stored + chips off the STARTER's species row —
// with the worn gear folded on top by elementValueWithGear. None of them may
// read the WORN form's row (partyRosterView's `profile`) for a stored number.
//
// menu.js fetches its geometry JSON at import time, so serve the real files and
// import the module dynamically afterwards (same shape as menu-map-refusal).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

globalThis.fetch = async (url) => ({
  json: async () => JSON.parse(readFileSync(`web/${String(url)}`, "utf8")),
});
if (typeof globalThis.localStorage === "undefined") {
  const mem = Object.create(null);
  globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

const { seeDigivolvePanelStat, seeDigivolvePanelRes } = await import("../web/menu.js");
const { CHARID_TO_DIGID, partyRosterView, storedNumbers } = await import("../web/party.js");
const { elementValues, equipmentBonuses } = await import("../web/vendor/engine.js");
await new Promise((r) => setTimeout(r, 50)); // let the layout fetches land

const CHAR = "p006agum"; // any manifest id: the starter mapping is the code's own
const STARTER_ID = CHARID_TO_DIGID[CHAR];
const FORM_ID = 9001; // invented: the digivolution this member is wearing

// Invented species rows. The worn form is deliberately much higher, so a screen
// that reads it instead of the record is impossible to miss.
const starterRow = {
  id: STARTER_ID, name: "Starter",
  str: 20, def: 21, spt: 22, wis: 23, spd: 24, chr: 25, hp: 40, mp: 20,
  resistances: { fire: 40, water: 41, ice: 42, wind: 43, thunder: 44, machine: 45, dark: 46 },
};
const wornRow = {
  id: FORM_ID, name: "Worn",
  str: 90, def: 91, spt: 92, wis: 93, spd: 94, chr: 95, hp: 400, mp: 200,
  resistances: { fire: 100, water: 101, ice: 102, wind: 103, thunder: 104, machine: 105, dark: 106 },
};
const digimonDB = { [STARTER_ID]: starterRow, [FORM_ID]: wornRow };

// Trained points (7 on every core stat, on the starter's 20..25), one permanent
// chip (+3 str), five trained fire points, and worn accessories that carry their
// own core rise and their own fire resist. `stats` holds the STORED (absolute)
// values, as the disc record does.
const liveStats = {
  digimonId: FORM_ID,
  stats: { str: 27, def: 28, spt: 29, wis: 30, spd: 31, chr: 32, hp: 52, mp: 26, tp: 0 },
  bonuses: { str: 3 },
  elemBonuses: { fire: 5 },
};
const GEAR = { acc0: 292, acc1: 304 };
const gear = equipmentBonuses(GEAR);
const gearStr = Number(gear.str ?? 0);
const gearFire = Number(gear.elemResists?.fire ?? 0);

const p = partyRosterView([CHAR], liveStats, [], digimonDB, {})[0];

test("the record's own halfwords already carry chips and sit on the starter row", () => {
  const stored = storedNumbers(CHAR, liveStats, digimonDB);
  assert.deepEqual(p.core, stored.core, "the roster view exposes storedNumbers' core");
  assert.deepEqual(p.elements, stored.elements, "and its seven element halfwords");
  assert.equal(p.profile, wornRow, "the view's profile really is the WORN form");
  assert.deepEqual(p.core, [30, 28, 29, 30, 31, 32], "stored 27 + chip 3 on str");
  assert.equal(p.elements[0], 40 + 5, "fire: starter 40 + trained 5 (no gear yet)");
});

test("the pause sheet prints stored + chips + gear, never the worn row", () => {
  assert.equal(seeDigivolvePanelStat(p, GEAR, "str", null), Math.min(999, p.core[0] + gearStr));
  assert.notEqual(seeDigivolvePanelStat(p, GEAR, "str", null), Math.min(999, wornRow.str + 7 + gearStr));
  assert.equal(seeDigivolvePanelRes(p, GEAR, "fire", null), Math.min(999, p.elements[0] + gearFire));
  assert.notEqual(seeDigivolvePanelRes(p, GEAR, "fire", null), Math.min(999, wornRow.resistances.fire + 5));
  // See Digivolve still ADDS the candidate form on top of those numbers.
  const candidate = { str: 6, resistances: { fire: 10 } };
  assert.equal(seeDigivolvePanelStat(p, GEAR, "str", null, candidate),
    Math.min(999, p.core[0] + gearStr + 6));
  assert.equal(seeDigivolvePanelRes(p, GEAR, "fire", candidate),
    Math.min(999, p.elements[0] + gearFire + 10));
});

test("a member with no stored block falls back to the STARTER, not the worn form", () => {
  const bare = partyRosterView([CHAR], { digimonId: FORM_ID }, [], digimonDB, {})[0];
  assert.equal(bare.profile, wornRow, "it is wearing the form");
  assert.equal(bare.stats?.stats, undefined, "and its record carries no stored stats");
  assert.deepEqual(storedNumbers(CHAR, bare.stats, digimonDB).core, [20, 21, 22, 23, 24, 25]);
  assert.deepEqual(storedNumbers(CHAR, bare.stats, digimonDB).elements, [40, 41, 42, 43, 44, 45, 46]);
  assert.equal(seeDigivolvePanelStat(bare, {}, "str", null), 20);
  assert.equal(seeDigivolvePanelRes(bare, {}, "fire", null), 40);
});

test("the gym HUD's core rows and the sheet print the same numbers", () => {
  const hud = storedNumbers(CHAR, liveStats, digimonDB, wornRow); // the HUD's own input
  assert.deepEqual(hud.core, p.core.slice(), "HUD input -> same six stored halfwords");
  assert.equal(hud.core[0] + gearStr, seeDigivolvePanelStat(p, GEAR, "str", null),
    "the HUD's value plus the same gear is the sheet's value");
  const gym = readFileSync("web/gym.js", "utf8");
  assert.match(gym, /drawText\(ctx, String\(stored\.core\[i\] \?\? 0\),/,
    "the six core rows print storedNumbers' core");
  assert.doesNotMatch(gym, /String\(st\?\.stats\?\.\[stat\] \?\? prof\?\.\[stat\] \?\? 0\)/,
    "and no longer rebuild them from stats/profile");
});

test("the gym-translated seed's own element line is the same numbers (left as card 01 pinned it)", () => {
  const seeded = storedNumbers(CHAR, liveStats, digimonDB);
  assert.deepEqual(seeded.elements, elementValues(starterRow, liveStats.elemBonuses),
    "storedNumbers' elements are the same numbers the seed builds by hand");
  // The seed still builds them itself: tests/worn-form-starter-row.test.js:128
  // (card 01) pins that exact expression, so it was left alone (see the note).
  const src = readFileSync("web/gym-translated.js", "utf8");
  assert.match(src, /elements: elementValues\(g\._data\.digimonById\[CHARID_TO_DIGID\[party\[i\]\]\] \?\? profile, ps\.elemBonuses\)/);
});
