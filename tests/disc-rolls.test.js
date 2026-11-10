// tests/disc-rolls.test.js — Disc-accurate hit & drop rolls (ALWAYS ON, no F2 switch: the
// fix makes the normal game behave like the original disc).
//
// TWO fidelity fixes:
//   1. every technique's hit roll uses the record's own +0x06 accuracy byte
//      (`fight_tech_table.json` `elemCtx`) instead of the engine's `acc ?? 100`. The shipped
//      443-row table carries only four values: 80 x2, 100 x68, 110 x304, 127 x69 — so the
//      Fight everyone uses all game rolls 110/128 instead of 100/128.
//   2. the enemy item drop uses the disc's own roll `RAND_U16() % 1024 < drop_rate + 1`
//      (wfightmn 0x1f84; docs/research/battle/exp-levelup-rewards-decoded-2026-07-10.md:44)
//      on the shared stream, instead of `Math.random() * 255 < drop_rate`.
//
// The pure helper keeps its `useDiscAcc: false` option (no `base_acc`, engine default 100) for
// the unit tests below; the game itself always passes true. Pure numbers only: no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeTechRecord, techRecordAccuracy, dropRoll as webDropRoll, dropPasses as webDropPasses } from "../web/tech-record.js";
import { dropRoll, dropPasses } from "../engine/dw3/item-drop.ts";
import { rollHit } from "../engine/dw3/battle-formulas.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "web/assets/data");
const TABLE = JSON.parse(readFileSync(join(DATA, "fight_tech_table.json"), "utf8"));
const SKILLS = JSON.parse(readFileSync(join(DATA, "digimon.json"), "utf8")).skills;
const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
const recOf = (id) => TABLE[String(id)] ?? null;

const at = (v) => () => v;

/** Count how many of the 128 accuracy counter values land, with SPD and level equal. */
function hitCount(skill) {
  const atk = { spd: 100, level: 10, crit: 0, sideByte: 0 };
  const def = { spd: 100, level: 10 };
  let n = 0;
  for (let d = 0; d < 128; d++) if (rollHit(atk, def, skill, at(d))) n++;
  return n;
}

test("the shipped table carries exactly the four +0x06 accuracy values and 443 rows", () => {
  const rows = Object.keys(TABLE);
  assert.equal(rows.length, 443);
  const hist = {};
  for (const k of rows) hist[TABLE[k].elemCtx] = (hist[TABLE[k].elemCtx] ?? 0) + 1;
  assert.deepEqual(hist, { 80: 2, 100: 68, 110: 304, 127: 69 });
});

test("mergeTechRecord OFF keeps today's two bytes and adds no base_acc key", () => {
  const skill = SKILL_BY_ID.get(1);
  const rec = recOf(1);
  const off = mergeTechRecord(skill, rec, { useDiscAcc: false });
  assert.equal(Object.hasOwn(off, "base_acc"), false, "off path must not carry base_acc");
  assert.equal(off.effect_id, rec.dispatch);
  assert.equal(off.effect_power, rec.crit);
  // Every skill with a record keeps exactly today's merge on the off path.
  for (const s of SKILLS) {
    const r = recOf(s.id);
    if (!r) continue;
    const m = mergeTechRecord(s, r, { useDiscAcc: false });
    assert.deepEqual(m, { ...s, effect_id: r.dispatch, effect_power: r.crit }, `skill ${s.id}`);
    assert.equal(Object.hasOwn(m, "base_acc"), false, `skill ${s.id}`);
    assert.equal(m.effect_id, r.dispatch);
    assert.equal(m.effect_power, r.crit);
  }
  // A skill with no record is returned as the very same object, as today.
  const noRec = { id: 99999, name: "no record" };
  assert.equal(mergeTechRecord(noRec, null, { useDiscAcc: false }), noRec);
  assert.equal(mergeTechRecord(noRec, null, { useDiscAcc: true }), noRec);
});

test("mergeTechRecord ON reads the record's own accuracy byte (110 / 100 / 127 / 80)", () => {
  const on = (id) => mergeTechRecord(SKILL_BY_ID.get(id), recOf(id), { useDiscAcc: true });
  assert.equal(on(1).base_acc, 110, "skill 1 Fight is 110, not 100");
  assert.equal(on(213).base_acc, 100);
  assert.equal(on(441).base_acc, 127);
  // The two 80-accuracy rows, computed from the table itself rather than hard-coded.
  const low = Object.keys(TABLE).filter((k) => TABLE[k].elemCtx === 80).map(Number);
  assert.equal(low.length, 2);
  for (const id of low) {
    if (SKILL_BY_ID.has(id)) assert.equal(on(id).base_acc, 80, `skill ${id}`);
    assert.equal(techRecordAccuracy(recOf(id)), 80, `record ${id}`);
  }
  assert.equal(techRecordAccuracy(recOf(1)), 110);
  // For every skill the table knows, the merged byte IS the record byte.
  for (const s of SKILLS) {
    const r = recOf(s.id);
    if (!r) continue;
    assert.equal(mergeTechRecord(s, r, { useDiscAcc: true }).base_acc, r.elemCtx, `skill ${s.id}`);
  }
});

test("rollHit passes exactly base_acc of the 128 counter values (SPD and level equal)", () => {
  assert.equal(hitCount({ base_acc: 110 }), 110);
  assert.equal(hitCount({ base_acc: 100 }), 100);
  assert.equal(hitCount({ base_acc: 80 }), 80);
  assert.equal(hitCount({ base_acc: 127 }), 127);
  // No base_acc: today's engine default, untouched by this card.
  assert.equal(hitCount({}), 100);
  // The off path and an explicit 100 are the same roll.
  assert.equal(hitCount({ base_acc: 100 }), hitCount({}));
});

test("dropRoll(rate, draw) is (draw % 1024) < rate + 1", () => {
  for (let d = 0; d < 1024; d++) {
    assert.equal(dropRoll(2, d), d <= 2, `rate 2, draw ${d}`);
    assert.equal(dropRoll(0, d), d === 0, `rate 0, draw ${d}`);
    assert.equal(dropRoll(256, d), d <= 256, `rate 256, draw ${d}`);
  }
  // The modulo makes a 16-bit draw wrap into the 1024-window.
  assert.equal(dropRoll(2, 1024), true);
  assert.equal(dropRoll(2, 1025), true);
  assert.equal(dropRoll(2, 1026), true);
  assert.equal(dropRoll(2, 1027), false);
});

test("dropPasses draws once from the injected stream", () => {
  let calls = 0;
  assert.equal(dropPasses(2, () => { calls++; return 2; }), true);
  assert.equal(calls, 1);
  assert.equal(dropPasses(2, () => 3), false);
  assert.equal(dropPasses(0, () => 0), true);
  assert.equal(dropPasses(0, () => 1), false);
});

test("over one full 4096-word stream cycle the pass counts are 68 / 4 / 516", () => {
  const count = (rate) => {
    let n = 0;
    for (let d = 0; d < 4096; d++) if (dropRoll(rate, d)) n++;
    return n;
  };
  assert.equal(count(16), 68, "4 windows x (16 + 1)");
  assert.equal(count(0), 4, "4 windows x 1 (only draw 0)");
  assert.equal(count(128), 516, "4 windows x (128 + 1)");
});

test("the browser mirror of the drop leaf is the engine leaf's arithmetic", () => {
  const rates = [0, 2, 16, 32, 64, 128, 192, 256];
  const draws = [0, 1, 2, 3, 255, 256, 257, 1023, 1024, 1025, 1026, 4095];
  for (const rate of rates) {
    for (const d of draws) {
      assert.equal(webDropRoll(rate, d), dropRoll(rate, d), `rate ${rate}, draw ${d}`);
      assert.equal(webDropPasses(rate, at(d)), dropPasses(rate, at(d)), `rate ${rate}, stream ${d}`);
    }
  }
});

test("tools/hit_table.mjs --json is all 443 techniques, skill 1 first at 110/128", () => {
  const out = execFileSync(process.execPath, [join(ROOT, "tools/hit_table.mjs"), "--json"], {
    encoding: "utf8",
  });
  const rows = JSON.parse(out);
  assert.equal(rows.length, 443);
  assert.deepEqual(rows[0], { skill: 1, name: "Fight", elemCtx: 110, hits: 110, of: 128, percent: 85.94 });
  for (const row of rows) {
    assert.equal(row.of, 128);
    assert.equal(row.hits, Math.min(row.elemCtx, 128), `skill ${row.skill}`);
    assert.equal(row.percent, Math.round((row.hits / 128) * 10000) / 100);
  }
});

test("source gates: battle.js always uses the disc's merge and drop roll (no F2 key)", () => {
  const battle = readFileSync(join(ROOT, "web/battle.js"), "utf8");
  assert.match(battle, /mergeTechRecord\(s, rec, \{ useDiscAcc: true \}\)/, "the skill merge always carries the record's accuracy byte");
  assert.match(battle, /rollBattleDrop\(b\._loot\.candidates, RAND_U16\)/, "the drop draw is the disc's one roll per battle");
  assert.doesNotMatch(battle, /function rollDrop\(/, "the per-enemy roll is gone");
  assert.doesNotMatch(battle, /Math\.random\(\) \* 255 < /, "the old Math.random drop line is gone");
  assert.match(battle, /rollFusionDrops\([^\n]*RAND_U16, true\)/, "fusion halves' loot rolls the same disc way");
  assert.doesNotMatch(battle, /discrolls/, "the key is gone from battle.js");
});

test("the F2 row for discrolls is gone from ambience.js", () => {
  const amb = readFileSync(join(ROOT, "web/ambience.js"), "utf8");
  assert.doesNotMatch(amb, /discrolls/);
  assert.doesNotMatch(amb, /Disc-accurate hit & drop rolls/);
});

// One item drop per won battle (wfightmn .L0x00001e84-.L0x00001fdc): pick draw, then rate draw.
import { rollBattleDrop } from "../web/tech-record.js";
const seq = (words) => { const calls = []; let i = 0; const f = () => { calls.push(i); return words[i++]; }; f.calls = calls; return f; };

test("rollBattleDrop: one enemy with an item = one pick draw + one rate draw", () => {
  const rng = seq([7, 2]);
  assert.equal(rollBattleDrop([{ drop_item: "A", drop_rate: 2 }], rng), "A"); // 2 < 3
  assert.equal(rng.calls.length, 2);
  const miss = seq([0, 3]);
  assert.equal(rollBattleDrop([{ drop_item: "A", drop_rate: 1 }], miss), null); // 3 < 2 false
  assert.equal(miss.calls.length, 2);
});

test("rollBattleDrop: three enemies with items = exactly two draws, at most one item", () => {
  const list = [{ drop_item: "A", drop_rate: 0 }, { drop_item: "B", drop_rate: 255 }, { drop_item: "C", drop_rate: 0 }];
  const rng = seq([4, 100]); // 4 % 3 = 1 -> B, 100 < 256
  assert.equal(rollBattleDrop(list, rng), "B");
  assert.equal(rng.calls.length, 2);
  const rng2 = seq([3, 100]); // 3 % 3 = 0 -> A, rate 0: 100 < 1 false
  assert.equal(rollBattleDrop(list, rng2), null);
  assert.equal(rng2.calls.length, 2);
});

test("rollBattleDrop: no enemy with an item = no draw at all", () => {
  const rng = seq([1, 1]);
  assert.equal(rollBattleDrop([{ drop_item: "Null", drop_rate: 255 }, { drop_item: "", drop_rate: 255 }, null], rng), null);
  assert.equal(rollBattleDrop([], rng), null);
  assert.equal(rng.calls.length, 0);
});
