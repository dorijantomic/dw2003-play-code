// F1 — ONE hit-count rule for the player's Fight and the enemy's action.
//
// F0x8009e0cc `.L0x8009e238`-`.L0x8009e3a4` dispatches on the record's own effect
// opcode (+0x0A): below 2 it takes the Multi Crest plain-attack diversion (3 hits at
// 0.4x), 9 the multi-hit applier F0x8009d4b8 on the record's +0x11 byte (f14), and
// anything else one hit. `basicAttackHitCount` used to know only the Multi Crest arm,
// so the player's Fight never read its own record's hit count while the enemy's side
// read `skill.hits` unconditionally.
//
// The cases below run the REAL shipped rows through the same objects web/battle.js
// builds its skill bank from (digimon.json's skills + fight_tech_table.json's raw
// dispatch/crit bytes).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  basicAttackHitCount, multiCrestPlainAttack, resolveDamage,
} from "../engine/dw3/battle-formulas.ts";

const TECH = JSON.parse(readFileSync(new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const SKILLS = JSON.parse(readFileSync(new URL("../web/assets/data/digimon.json", import.meta.url), "utf8")).skills;

/** The skill object web/battle.js's skillDB installs: the bank row plus the raw
 *  record bytes the formulas test (`effect_id` = +0x0A, `effect_power` = +0x0C). */
const skillOf = (id) => {
  const s = SKILLS.find((x) => x.id === id);
  const rec = TECH[String(id)];
  assert.ok(s && rec, `technique ${id} is in the shipped tables`);
  return { ...s, effect_id: rec.dispatch, effect_power: rec.crit };
};

test("the record's +0x0A dispatch picks the hits: 9 -> +0x11, below 2 -> one, else one", () => {
  // The five player rows whose own basic Fight is a multi-hit record.
  for (const id of [407, 390, 389]) {          // Suijinmon, Persiamon, Datamon
    assert.equal(TECH[String(id)].dispatch, 9, `${id} is a multi-hit record`);
    assert.equal(TECH[String(id)].f14, 4, `${id} carries 4 hits`);
    assert.equal(basicAttackHitCount(false, skillOf(id)), 4);
  }
  for (const id of [325, 289]) {               // Machinedramon, MarineDevimon
    assert.equal(TECH[String(id)].dispatch, 9, `${id} is a multi-hit record`);
    assert.equal(TECH[String(id)].f14, 2, `${id} carries 2 hits`);
    assert.equal(basicAttackHitCount(false, skillOf(id)), 2);
  }
  // An ordinary basic Fight is one hit, and a technique record outside the two arms
  // keeps one even when its own table row carries a stray f14.
  assert.equal(basicAttackHitCount(false, skillOf(1)), 1);
  assert.equal(basicAttackHitCount(false, { effect_id: 7, hits: 3 }), 1);
});

test("Multi Crest diverts only a plain record: +0x0A < 2, clip outside {0x0b,0x0c}", () => {
  assert.equal(multiCrestPlainAttack(true, skillOf(1)), true);
  assert.equal(basicAttackHitCount(true, skillOf(1)), 3);
  // Suijinmon's own 4-hit basic is dispatch 9 — the crest does not cut it to 3.
  assert.equal(multiCrestPlainAttack(true, skillOf(407)), false);
  assert.equal(basicAttackHitCount(true, skillOf(407)), 4);
  // The clip byte's own exclusion, on a plain record.
  assert.equal(basicAttackHitCount(true, { effect_id: 1, clip: 0x0b }), 1);
  assert.equal(basicAttackHitCount(true, { effect_id: 1, clip: 0x0c }), 1);
  assert.equal(basicAttackHitCount(false, skillOf(1)), 1);
});

test("the 0.4x scale rides the same gate: plain record + Multi Crest only", () => {
  const atk = { str: 0, def: 0, spt: 0, wis: 0, spd: 0, multiAttack: true };
  const def = { str: 0, def: 0, spt: 0, wis: 0, spd: 0 };
  const rng = () => 0xffff;                    // (rng & 0x7f) = 127: no critical
  assert.equal(resolveDamage(1000, atk, def, { ...skillOf(1), basic_attack: true }, rng, null), 400);
  assert.equal(resolveDamage(1000, atk, def, { ...skillOf(407), basic_attack: true }, rng, null), 1000);
});

test("both story paths call the shared function, never a bare skill.hits", () => {
  const SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.match(SRC, /const attempts = basicAttackHitCount\(b\.player\.multiAttack, skill\);/,
    "the player's Fight dispatches on its own record");
  assert.match(SRC, /const hits = basicAttackHitCount\(!!en\.multiAttack, skill\);/,
    "the enemy's action uses the same function");
  assert.ok(!/basicAttackHitCount\(b\.player\.multiAttack, skill\?\.clip\)/.test(SRC),
    "the player's side no longer passes only the clip byte");
  assert.ok(!/const hits = skill\?\.hits \?\? 1;/.test(SRC),
    "the enemy's side no longer reads skill.hits without the dispatch test");
});
