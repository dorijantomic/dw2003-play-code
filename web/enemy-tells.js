// web/enemy-tells.js — the every-Nth countdown and the pattern breaker.
//
// 27 shipped enemy AI rows (web/assets/data/enemies.json) sit on condition 18:
// engine/dw3/battle-formulas.ts::enemyMoveCondition reads
// `self.turnCounter % value === 0` (pro/fightstg/check_move_cond.s .L28). The
// enemy turn handler bumps that counter at the START of the turn
// (wfightmn.s:4144-4148), so a `value 3` row fires on turns 3, 6, 9.
//
// F2 -> Battle -> "Enemy tells" prints one line under the enemy plate counting
// down to the enemy's nearest such row. F2 -> Battle -> "Pattern breaker" hands
// the AI selection one turn further on, so every comparator-18 row fires a turn
// early.
//
// Pure: no DOM, no game state, nothing written. web/battle.js is the only caller.

export const EVERY_NTH = 18;   // engine/dw3/battle-formulas.ts case 18

/** The rows that fire on an every-Nth turn: comparator 18, each with its index. */
export function everyNthRows(rows) {
  const out = [];
  (rows ?? []).forEach((row, rowIndex) => {
    if (!row || row.comparator !== EVERY_NTH) return;
    out.push({ rowIndex, value: row.value, action: row.action });
  });
  return out;
}

/**
 * How many turns until a `value` row fires again, counting the coming turn as 0:
 * `(value - (nextTurnNumber % value)) % value`. `value 0` divides by zero on the
 * disc (the port says never), so it promises no turn at all: null.
 */
export function turnsUntil(nextTurnNumber, value) {
  const v = Math.trunc(value);
  if (!v) return null;
  return (v - (Math.trunc(nextTurnNumber) % v)) % v;
}

/** The turn number the enemy's next action tests: the live +0x04 counter plus this turn's bump. */
export function nextTurnNumber(turnCounter) {
  return (turnCounter ?? 0) + 1;
}

/**
 * The nearest every-Nth row for an enemy that has started `turnCounter` actions.
 * The AI tests rows 0..2 in order and takes the first that passes, so the soonest
 * firing row is the nearest; a tie goes to the earlier row, the one tested first.
 * Row 3 is taken unconditionally as the fallback and its condition byte is never
 * evaluated (pickEnemyAiMove), so a cond-18 row there is not a promise the game
 * can keep and is skipped.
 */
export function nearestTell(rows, turnCounter) {
  const next = nextTurnNumber(turnCounter);
  let best = null;
  for (const row of everyNthRows(rows)) {
    if (row.rowIndex >= 3) continue;
    const turns = turnsUntil(next, row.value);
    if (turns == null) continue;
    if (!best || turns < best.turns || (turns === best.turns && row.rowIndex < best.rowIndex)) {
      best = { rowIndex: row.rowIndex, value: row.value, action: row.action, turns };
    }
  }
  return best;
}

/**
 * The countdown line's words, e.g. "special on turn 3 - in 2", or "now" when the
 * coming turn is the firing turn. The game's own uifont has 344 glyphs and the
 * plain hyphen is one of them; an em dash is not, so the line uses "-".
 */
export function tellText(tell) {
  if (!tell) return "";
  return tell.turns === 0
    ? `special on turn ${tell.value} - now`
    : `special on turn ${tell.value} - in ${tell.turns}`;
}
