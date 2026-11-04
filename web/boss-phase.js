// web/boss-phase.js — an authored fusion boss's second wind: which phase its HP has
// reached, the four AI rows that phase fights with, and what it does to the battlefield.
//
// The module is pure (no DOM, no battle state) so the thresholds, rows and effects can be
// read without running a fight. Nothing here is on unless F2 -> Extras -> "Boss phases"
// (key `bossphases`, off by default; web/ambience.js owns the switch) and unless the boss
// record carries `phases` — data/authored/fusion_bosses.json, built into
// web/fusion_bosses.json by tools/build_fusion_bosses.py.
//
// Where the numbers come from:
//   * a phase's four rows are the disc's own enemy-move record shape (action +0x32,
//     comparator +0x33, value +0x34 — engine/dw3/battle-formulas.ts `EnemyMoveRow`,
//     picked by `pickEnemyAiMove`): rows 0..2 are condition-tested and row 3 is the
//     unconditional fallback (fightstg.s:6038-6061). The fetched data never ships
//     fewer than four rows, so the fallback always exists.
//   * comparator 1 is the disc's random gate, true iff `rand()%128 < value`
//     (docs/research/battle/enemy-ai-move-conditions.md); 64 is half the rolls, the
//     same gate the shipped `enemies.json` rows use 105 times.
//   * action 1/2/3 are attack/move_1/move_2 (`enemyActionSkillId`); 4 is flee and
//     5..8 switch enemy slots, so a phase row never names them. A phase's move is one
//     of the boss's own `moves` (the builder refuses anything else), and the boss's
//     three moves are exactly actions 1..3 in order.
//   * a field phase writes the same `{ element, power 64 }` the seven field items and
//     the seven field techniques write (web/field-war.js FIELD_POWER; fightstg
//     item handler 0x8008e4e0 stores elem and 0x40).
import { FIELD_POWER } from "./field-war.js";

/**
 * The index of the last authored phase whose HP line the boss has reached, else -1.
 *
 * `boss.phases` is authored strictly descending (0.6 then 0.25; the builder enforces
 * it), so "the last phase whose `floor(maxHp * at)` is `>= hp`" is the newest phase the
 * current HP has uncovered. A single hit that crosses two lines therefore lands on the
 * second one only — the first phase's page never stacks behind it.
 *
 * `maxHp <= 0` (no record), `hp < 0` (no HP read) and a missing phase list all mean
 * "no phase" — the caller then behaves exactly as today.
 */
export function phaseFor(maxHp, hp, phases) {
  const max = Number(maxHp);
  const cur = Number(hp);
  if (!Array.isArray(phases) || !(max > 0) || !(cur >= 0)) return -1;
  let found = -1;
  for (let i = 0; i < phases.length; i++) {
    const at = Number(phases[i]?.at);
    if (!Number.isFinite(at)) continue;
    if (Math.floor(max * at) >= cur) found = i;
  }
  return found;
}

/**
 * The four AI rows a phase fights with.
 *
 * Rows 0..2 carry the phase's moves in order (wrapping when the phase names fewer than
 * three), each behind the disc's own random gate: comparator 1, value 64. Row 3 repeats
 * the phase's LAST move with comparator 0 — the row the disc never condition-tests, so
 * the phase's last technique always fires when no earlier row passes. That is what lets
 * a last phase "name one technique and use it every turn".
 *
 * Every action is `bossMoves.indexOf(move) + 1` and must be 1..3. A move the boss does
 * not own (or an empty phase) returns [] — the builder refuses such a phase first, so
 * the battle never has to guess a row.
 */
export function phaseRows(phase, bossMoves) {
  const moves = Array.isArray(phase?.moves) ? phase.moves : [];
  const known = Array.isArray(bossMoves) ? bossMoves : [];
  if (!moves.length) return [];
  const actions = [];
  for (const move of moves) {
    const at = known.indexOf(move);
    if (at < 0 || at > 2) return [];
    actions.push(at + 1);
  }
  const rows = [];
  for (let i = 0; i < 3; i++) {
    rows.push({ action: actions[i % actions.length], comparator: 1, value: 64 });
  }
  rows.push({ action: actions[actions.length - 1], comparator: 0, value: 64 });
  return rows;
}

/**
 * What a phase does to the battlefield itself: the field it names (or null), the field
 * power the seven field items write (64), the fighter tint (or null) and the one page it
 * puts up (or null).
 *
 * The battle applies only what is named: no field means no field write, no tint means
 * the fused fighter keeps the boss's own tint, no page means no box page.
 */
export function phaseEffects(phase) {
  return {
    element: phase?.field ?? null,
    power: FIELD_POWER,
    tint: phase?.tint ?? null,
    page: phase?.page ?? null,
  };
}
