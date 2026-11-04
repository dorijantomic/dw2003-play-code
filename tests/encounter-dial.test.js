// tests/encounter-dial.test.js — the F2 "Encounter dial": a volume knob on the game's
// own step counter (web/encounter-dial.js). Node only: pure numbers, no browser.
//
// The decoded routine is the one authority and stays untouched
// (engine/dw3/encounters.ts): the fieldstg driver runs once per
// ENCOUNTER_TICK_FRAMES (8) movement ticks, subtracts the standing zone's rate
// (ENCOUNTER_RATE_TABLE [2000, 3, 4, 6, 9, 18]), and on expiry rolls the slot and
// resets the counter to rand()%0x900 folded into 0..1279. The dial ONLY changes the
// reset value (rare = twice as long, lure = half as long) and whether a launch is
// allowed at all ("none"); the tick, the rate table and the slot roll are untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resetEncounterCounter, encounterStepTick, ENCOUNTER_RATE_TABLE, ENCOUNTER_TICK_FRAMES,
} from "../engine/index.ts";
import {
  DIAL_MODES, dialAllowsFight, dialReset, dialModeFromFx,
} from "../web/encounter-dial.js";

const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
const ambience = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
const dialSrc = readFileSync(new URL("../web/encounter-dial.js", import.meta.url), "utf8");

test("the decoded step counter is the one authority and the dial never re-implements it", () => {
  // resetEncounterCounter: r = rand % 0x900; r < 0x100 ? r : (r + 0x100) / 2
  assert.equal(resetEncounterCounter(() => 0x500), 768, "0x500 = 1280 -> (1280 + 256) / 2");
  assert.equal(resetEncounterCounter(() => 0x50), 0x50, "below 0x100 is kept as is");
  // one driver run at rate level 4 (rate 9): 20 - 9 = 11, not expired
  assert.deepEqual(encounterStepTick(20, 4), { counter: 11, expired: false });
  assert.equal(ENCOUNTER_TICK_FRAMES, 8);
  assert.deepEqual([...ENCOUNTER_RATE_TABLE], [2000, 3, 4, 6, 9, 18]);
  assert.equal(ENCOUNTER_RATE_TABLE[0], 2000, "the level-0 sentinel is not a rate tier");
});

test("the dial has exactly four settings, and only 'none' stops a fight", () => {
  assert.equal(DIAL_MODES.length, 4);
  assert.deepEqual([...DIAL_MODES].sort(), ["lure", "none", "normal", "rare"]);
  assert.equal(dialAllowsFight("none"), false);
  assert.equal(dialAllowsFight("rare"), true);
  assert.equal(dialAllowsFight("normal"), true);
  assert.equal(dialAllowsFight("lure"), true);
  assert.equal(dialAllowsFight(undefined), true);
});

test("rare doubles the decoded reset, lure halves it, none and normal leave it alone", () => {
  assert.equal(dialReset(768, "rare"), 1536);
  assert.equal(dialReset(768, "lure"), 384);
  assert.equal(dialReset(768, "none"), 768);
  assert.equal(dialReset(768, "normal"), 768);
  assert.equal(dialReset(1, "lure"), 0, "a one-step counter halves to zero (the next run fires)");
  assert.equal(dialReset(1279, "rare"), 2558);
  assert.equal(dialReset(768, undefined), 768, "no setting = the decoded value");
  assert.equal(dialReset(768, "bogus"), 768, "an unknown setting = the decoded value");
});

test("the F2 switch off wins over any stored mode", () => {
  assert.equal(dialModeFromFx({ encounterdial: false, encounterDialMode: "none" }), "normal");
  assert.equal(dialModeFromFx({ encounterdial: true, encounterDialMode: "none" }), "none");
  assert.equal(dialModeFromFx({ encounterdial: true, encounterDialMode: "rare" }), "rare");
  assert.equal(dialModeFromFx({ encounterdial: true, encounterDialMode: "normal" }), "normal");
  assert.equal(dialModeFromFx({ encounterdial: true, encounterDialMode: "lure" }), "lure");
  assert.equal(dialModeFromFx({ encounterdial: true, encounterDialMode: "bogus" }), "normal");
  assert.equal(dialModeFromFx({ encounterdial: true }), "normal");
  assert.equal(dialModeFromFx(undefined), "normal");
});

test("game.js applies the dial at the field-tick call site, never in the engine", () => {
  assert.match(game, /import \{[^}]*dialModeFromFx[^}]*\} from "\.\/encounter-dial\.js"/s,
    "the pure module is imported");
  const block = game.match(/if \(r\.expired\) \{([\s\S]*?)\n                    \}/);
  assert.ok(block, "the driver's expiry block is still there");
  assert.match(block[1], /const dial = dialModeFromFx\(window\.__fx\);/);
  assert.match(block[1], /!NO_ENCOUNTERS && dialAllowsFight\(dial\)/,
    "?noEncounters=1 keeps its short-circuit, and 'none' suppresses the launch");
  assert.match(block[1], /dialReset\(\s*resetEncounterCounter\(/,
    "the decoded reset is the input; the dial is applied on top of it");
  assert.match(block[1], /\), dial\);/s, "the mode reaches the reset");
  // The old verification walk is untouched.
  assert.match(game, /new URLSearchParams\(location\.search\)\.get\("noEncounters"\) === "1"/);
  // And the dial is never a URL flag.
  assert.doesNotMatch(game, /(get|has)\(\s*["'][^"']*dial[^"']*["']\s*\)/i);
});

test("ambience.js: the Extras switch, the select, the change handler and the refresh", () => {
  assert.match(ambience, /\["encounterdial", "Encounter dial \(repel \/ lure\)"\]/, "the F2 row");
  assert.match(ambience, /const EXPERIMENTAL = \[[^\]]*"encounterdial"/, "OFF until switched on");
  assert.match(ambience, /<select data-dial[\s>]/, "the select exists in the panel HTML");
  for (const v of ["none", "rare", "normal", "lure"]) {
    assert.match(ambience, new RegExp(`<option value="${v}"`), `${v} is offered`);
  }
  assert.match(ambience, /<option value="normal" selected>/, "normal is the default");
  assert.match(ambience, /setFx\("encounterDialMode", t\.value\)/, "the change handler stores the mode");
  assert.match(ambience, /encounterDialMode = "normal"/, "fx starts at normal");
  assert.match(ambience, /dl\.value = dialModeFromFx\(fx\)/, "refreshPanel shows the stored mode");
  assert.match(ambience, /dlRow\.hidden = !fx\.encounterdial/, "the select hides with the switch");
  assert.match(ambience, /id="fx-dial" hidden/, "the row ships hidden");
});

test("encounter-dial.js is pure: no DOM, no imports, no state", () => {
  assert.ok(!/^\s*import\s/m.test(dialSrc), "no imports");
  assert.ok(!/document\.|window\.|localStorage|requestAnimationFrame/.test(dialSrc), "no browser");
  assert.ok(!/\bfetch\(/.test(dialSrc), "no network");
  assert.ok(!/let |var /.test(dialSrc), "no mutable module state");
});
