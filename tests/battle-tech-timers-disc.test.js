// Disc fixes: (1) Auto Recover 189 = rand%9+8 tick, ends after max(1001, rand%2001+10*SPT), either side;
// (2) field techs 213..219 always set the field, power 64+SPT/10 cap 127, timer 1000+12*SPT (cap 32767);
// (3) damage + debuff techs 81 351 355 388 434 lower the opposing stat with the stat techs' setter + duration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  battleRestorePlanFor, battleStatusEventAdvance, castFieldTechnique, applyStatDebuffDispatch,
} from "../web/battle.js";
import { advanceAilmentTimeline, advanceStatusEvents } from "../web/vendor/engine.js";
import { elementalFieldAdjustment } from "../engine/dw3/battle-formulas.ts";

const T = JSON.parse(readFileSync(new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const mk = (hp, spt = 100) => ({ profile: { name: "x", id: 100, family: 1 }, level: 10, hp, maxHp: 300, mp: 60, maxMp: 60,
  str: 150, def: 100, spt, wis: 40, spd: 80, affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {} });
function battle(spt = 100) {
  const player = mk(100, spt), enemy = mk(100, spt);
  return { player, enemy, playerRecords: [player, null, null], activePlayerIndex: 0, encounterGateBytes: new Array(14).fill(0) };
}
const pool5 = (b) => b.statusEvents.find((e) => e.code === 5);

// One advance of exactly 1000 timeline units: SPD 80 vs 80 gives statusEventActionDelay = 1000.
const regenEv = (b) => b.statusEvents.find((e) => e.code === 6);

// Drive the real battle clock in 1000-unit actions until Auto Recover ends; return the heal of each tick.
function runRegen(b, who) {
  const ticks = [];
  for (let n = 0; n < 12 && who.autoRecover; n++) {
    who.hp = 1;
    b._regenEvents = [];
    battleStatusEventAdvance(b);
    for (const e of b._regenEvents) if (e.combatant === who) ticks.push(e.amount);
  }
  return ticks;
}

test("Auto Recover: ticks every 1000 timeline units, strong heal, ends, either side", () => {
  const all = [], times = [], counts = [];
  for (let i = 0; i < 400; i++) {
    const b = battle(100);
    battleRestorePlanFor(b, 0, T[189], 189, { name: "x" });
    assert.equal(b.player.autoRecover, true);
    assert.equal(regenEv(b).payload, 189);
    assert.equal(regenEv(b).time, 1000);
    const end = pool5(b).time;
    times.push(end);
    const t = runRegen(b, b.player);
    counts.push(t.length); all.push(...t);
    assert.equal(b.player.autoRecover, false, "Auto Recover ended");
    assert.equal(regenEv(b), undefined, "regen event freed");
    // ticks at 1000, 2000, ... that fall strictly before the end event (the end was queued first and wins a tie)
    assert.equal(t.length, Math.ceil(end / 1000) - 1, `end ${end}`);
  }
  const lo = Math.min(...all), hi = Math.max(...all);
  const tlo = Math.min(...times), thi = Math.max(...times);
  console.log(`AFTER  tick heal (maxHP 300) ${lo}..${hi}; end timer ${tlo}..${thi}; ticks per cast ${Math.min(...counts)}..${Math.max(...counts)}`);
  assert.equal(lo, Math.floor(300 * 8 / 128));
  assert.equal(hi, Math.floor(300 * 16 / 128));
  assert.ok(tlo >= 1001 && thi <= 3000);
  // enemy caster
  const b = battle(100);
  battleRestorePlanFor(b, 1, T[189], 189, { name: "y" });
  assert.equal(b.enemy.autoRecover, true);
  assert.equal(pool5(b).side, 0x10);
  assert.equal(regenEv(b).side, 0x10);
  runRegen(b, b.enemy);
  assert.equal(b.enemy.autoRecover, false);
});

test("Auto Recover: 3500 timeline units give exactly 3 ticks (not one per action)", () => {
  const b = battle(100);
  battleRestorePlanFor(b, 0, T[189], 189, { name: "x" });
  pool5(b).time = 60000;                        // keep the end event out of the span
  b.player.hp = 1;
  // one single advance of 3500 units through the real pool advance + the battle's own consumer
  const ex = advanceStatusEvents(b.statusEvents, 3500).filter((e) => e.kind === "regen");
  assert.equal(ex.length, 3, "ticks at 1000, 2000, 3000");
  assert.ok(ex.every((e) => e.payload === 189));
  assert.equal(regenEv(b).time, 500, "500 units left to the next tick");
  // the same span in 1000-unit actions through battleStatusEventAdvance: heal total over 3 actions = 3 ticks
  const c = battle(100);
  battleRestorePlanFor(c, 0, T[189], 189, { name: "x" });
  pool5(c).time = 60000;
  let n = 0;
  for (let k = 0; k < 3; k++) { c.player.hp = 1; c._regenEvents = []; battleStatusEventAdvance(c); n += c._regenEvents.length; }
  assert.equal(n, 3);
  // two 1414-unit actions (the longest delay) keep the leftover between them
  const d = battle(100);
  battleRestorePlanFor(d, 0, T[189], 189, { name: "x" });
  pool5(d).time = 60000;
  const e1 = advanceStatusEvents(d.statusEvents, 1414).filter((e) => e.kind === "regen").length;
  const e2 = advanceStatusEvents(d.statusEvents, 1414).filter((e) => e.kind === "regen").length;
  assert.equal(e1 + e2, 2, "2828 units = 2 ticks");
  console.log("AFTER  3500 units -> 3 ticks (BEFORE: 1 per action step, ~3.5 ticks only by action count, 0 by units)");
});

test("Auto Recover on a Recover Crest wearer keeps the crest tick afterwards", () => {
  const b = battle(100);
  b.player.regeneration = true;
  battleRestorePlanFor(b, 0, T[189], 189, { name: "x" });
  for (let n = 0; n < 6; n++) battleStatusEventAdvance(b);
  assert.equal(b.player.regeneration, true);
  assert.equal(b.player.autoRecover, false);
  // while Auto Recover runs the per-action crest tick is paused
  const c = battle(100);
  c.player.regeneration = true; c.player.autoRecover = true; c.player.hp = 1;
  assert.equal(advanceAilmentTimeline([c.player, c.enemy], 1000).length, 0);
});

test("field techs set the field with disc power and timer, then it ends", () => {
  const rows = [[100, 74, 2200], [300, 94, 4600], [1500, 127, 19000], [3000, 127, 32767]];
  for (const [spt, power, time] of rows) {
    for (const side of [0, 1]) {
      const b = battle(spt);
      castFieldTechnique(b, side, T[213], "fire");
      assert.deepEqual(b.field, { element: "thunder", power });   // record byte +0x04 = 6, not the tech element
      assert.equal(b.statusEvents.find((e) => e.code === 7).time, time);
    }
  }
  console.log(`AFTER  field 213 spt100 -> {thunder(6),74}, timer 2200; fire attack 1000 -> +${elementalFieldAdjustment(1000, "thunder", { element: "thunder", power: 74 })}; water attack -> ${elementalFieldAdjustment(1000, "water", { element: "thunder", power: 74 })}`);
  console.log("BEFORE field 213 -> no field (b.field unchanged) unless F2 'fieldwar' on");
  const b = battle(100);
  castFieldTechnique(b, 0, T[213], "fire");
  let acts = 0;
  while (b.field && acts < 12) { battleStatusEventAdvance(b); acts++; }
  console.log(`field lasted ${acts} actions at spt 100 (2200 units)`);
  assert.equal(b.field, null);
  assert.ok(acts >= 2 && acts <= 4);
  // a new field tech replaces field and timer
  castFieldTechnique(b, 0, T[214], "water");
  castFieldTechnique(b, 0, T[215], "ice");
  assert.equal(b.field.element, "thunder");
  assert.equal(b.statusEvents.filter((e) => e.code === 7).length, 1);
});

test("damage + debuff techs lower the opposing stat and wear off", () => {
  const want = { 81: [0, -37], 351: [1, -12], 355: [1, -12], 388: [0, -28], 434: [0, -75] };
  const out = {};
  for (const [id, [stat, mod]] of Object.entries(want)) {
    const b = battle(100);
    const r = applyStatDebuffDispatch(b, 0, T[id]);
    const key = ["str", "def", "spd"][stat];
    assert.equal(r.stat, stat, id);
    assert.equal(b.enemy.statMods[key], mod, id);
    assert.equal(b.player.statMods[key], 0);
    const ev = b.statusEvents.find((e) => e.code === 0x0d + stat);
    assert.equal(ev.side, 0x10);
    assert.ok(ev.time >= 3000 && ev.time <= 5000, `duration ${ev.time}`);
    out[id] = `${key} ${mod} for ${ev.time}`;
    for (let n = 0; n < 8 && b.enemy.statMods[key]; n++) battleStatusEventAdvance(b);
    assert.equal(b.enemy.statMods[key], 0, "expired");
  }
  console.log("AFTER ", JSON.stringify(out), "| BEFORE: all 0, nothing staged");
  // enemy hits the player (Cardmon style)
  const b = battle(100);
  assert.equal(applyStatDebuffDispatch(b, 1, T[351]).side, 0);
  assert.equal(b.player.statMods.def, -12);
  // attack-down skipped when the player acts and gate byte 0x80042b62 is set
  const g = battle(100);
  g.encounterGateBytes[10] = 1;
  assert.equal(applyStatDebuffDispatch(g, 0, T[81]), null);
});
