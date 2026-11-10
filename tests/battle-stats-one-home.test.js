// tests/battle-stats-one-home.test.js
// Card 16-level-stat-formulas: scaledStat/scaledHp/scaledMp/evolvedMaxStats have ONE
// home, engine/dw3/battle-stats.ts. web/battle.js re-exports the engine bindings
// (through the vendored bundle) for the modules and tests that import them from there,
// and no longer carries its own bodies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as engine from "../engine/dw3/battle-stats.ts";
import { battleStats, scaledStat as vendorScaledStat } from "../web/vendor/engine.js";
import * as play from "../web/battle.js";

// Invented profiles: a starter with real hp/mp rows, and a digivolved form that stores
// the hp/mp placeholders (1) and has to be scaled from its combat stats.
const starter = { is_starter: true, hp: 41, mp: 13, str: 9, spt: 7,
  growth: { hp: 6, mp: 2, str: 1, spt: 3 } };
const form = { is_starter: false, hp: 1, mp: 1, str: 10, spt: 5,
  growth: { str: 2, spt: 3 } };

test("web/battle.js carries the engine's own bindings, not a copy", () => {
  // The bundle is the built copy of engine/dw3/battle-stats.ts that the page loads;
  // identity against it proves battle.js re-exports rather than defining again.
  assert.equal(play.scaledStat, vendorScaledStat);
  assert.equal(play.scaledHp, battleStats.scaledHp);
  assert.equal(play.scaledMp, battleStats.scaledMp);
  assert.equal(play.evolvedMaxStats, battleStats.evolvedMaxStats);
});

test("the source copy and the shipped copy still agree", () => {
  for (const [prof, lvl] of [[starter, 1], [starter, 3], [starter, 24], [form, 5], [form, 40]]) {
    assert.equal(engine.scaledHp(prof, lvl), play.scaledHp(prof, lvl));
    assert.equal(engine.scaledMp(prof, lvl), play.scaledMp(prof, lvl));
    assert.equal(engine.scaledStat(prof, "str", lvl), play.scaledStat(prof, "str", lvl));
  }
  assert.deepEqual(engine.evolvedMaxStats(form, 5, { hp: 7, mp: 3 }),
    play.evolvedMaxStats(form, 5, { hp: 7, mp: 3 }));
});

test("web/battle.js defines no second body of the four functions", () => {
  const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.doesNotMatch(src,
    /function\s+(scaledStat|scaledHp|scaledMp|evolvedMaxStats)\s*\(/,
    "the formulas must stay in engine/dw3/battle-stats.ts");
});

test("the two rules, on invented numbers", () => {
  // Starter: hp/mp grow off the profile's own rows.
  assert.equal(play.scaledStat(starter, "hp", 3), 53);   // 41 + 6*(3-1)
  assert.equal(play.scaledHp(starter, 3), 53);
  assert.equal(play.scaledMp(starter, 3), 17);           // 13 + 2*(3-1)
  // Form: 80 + str*level, 20 + spt*floor(level/2+1).
  assert.equal(play.scaledStat(form, "str", 5), 18);     // 10 + 2*4
  assert.equal(play.scaledHp(form, 5), 170);             // 80 + 18*5
  assert.equal(play.scaledMp(form, 5), 71);              // 20 + 17*3
  assert.deepEqual(play.evolvedMaxStats(starter, 3, { hp: 5, mp: 1 }),
    { maxHp: 58, maxMp: 18 });
  assert.deepEqual(play.evolvedMaxStats(form, 5, { hp: 7, mp: 3 }),
    { maxHp: 177, maxMp: 74 });
  assert.deepEqual(play.evolvedMaxStats(form, 5), { maxHp: 170, maxMp: 71 });
});

// applyLevelUp's no-progression-table branch (lu == null) is reachable only when
// loadData's `progression.json` fetch falls into `.catch(() => null)`. It used to apply
// scaledStat(prof,"hp") — the `hp` placeholder 1 for a digivolved form — instead of the
// evolution rule. It now asks evolvedMaxStats, so both sides of the branch agree.
test("a level-up with no progression table uses the evolution max-HP rule", () => {
  const ps = { level: 1, hp: 3, mp: 3, tp: 0, bonuses: { hp: 7, mp: 3 } };
  play.applyLevelUp(ps, form, 1, 5, null);
  assert.equal(ps.level, 5);
  assert.equal(ps.maxHp, 177);
  assert.equal(ps.maxMp, 74);
  // The disc's level-up writes level/TP/max only: current HP/MP are not refilled.
  assert.equal(ps.hp, 3);
  assert.equal(ps.mp, 3);
  assert.equal(ps.tp, 20);                               // 5/turn * 4 levels
});
