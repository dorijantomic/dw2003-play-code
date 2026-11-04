// web/tech-record.js — the technique-record bytes the browser battle reads.
//
// `fight_tech_table.json` is the disc's 443-row technique table (16 fields a row,
// extracted from the record array at 0x80042bca). web/battle.js's skill merge already
// copied two raw bytes onto every skill: +0x0A the effect opcode (`dispatch`) and
// +0x0C its effect power (`crit`). This module is that merge, plus the third byte the
// hit leaf wants: +0x06, the technique's own base accuracy (`elemCtx`).
//
// The shipped table has only four accuracy values — 80 on 2 rows, 100 on 68, 110 on
// 304, 127 on 69 — so with the switch off every roll keeps the engine's `acc ?? 100`
// default (exactly today) and with it on the Fight you use all game rolls 110/128.
//
// F2 -> Extras -> "Disc-accurate hit & drop rolls" gates ONLY the accuracy byte and the
// drop draw; the off path is byte-for-byte the old merge. Pure: no DOM, no globals.
//
// The two drop helpers below are the browser's copy of engine/dw3/item-drop.ts (the page
// is served as plain ES modules and cannot load a .ts file). tests/disc-rolls.test.js
// pins the pair against the engine leaf so the two cannot drift.

/** The record's +0x06 accuracy byte; a missing record falls back to today's 100. */
export function techRecordAccuracy(rec) {
  return rec?.elemCtx ?? 100;
}

/**
 * Merge one technique row onto a digimon.json skill.
 * `useDiscAcc` off -> exactly today's `{...skill, effect_id, effect_power}` (no base_acc key).
 * `useDiscAcc` on  -> also carries `base_acc`, the record's own +0x06 byte.
 */
export function mergeTechRecord(skill, rec, { useDiscAcc = false } = {}) {
  if (!rec) return skill;
  const merged = { ...skill, effect_id: rec.dispatch, effect_power: rec.crit };
  if (useDiscAcc) merged.base_acc = techRecordAccuracy(rec);
  return merged;
}

/** True when one RAND_U16 word passes the disc's `rate % 1024` drop roll (wfightmn 0x1f84). */
export function dropRoll(rate, draw) {
  return (draw % 1024) < ((rate | 0) + 1);
}

/** Draw once from the shared stream and run the drop roll. */
export function dropPasses(rate, rng) {
  return dropRoll(rate, rng());
}
