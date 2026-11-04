/**
 * The disc's enemy item-drop roll — wfightmn 0x1f84.
 *
 * The original does not decide a drop with a float at all: it draws the shared RAND_U16
 * stream and compares the low 10 bits against `drop_rate + 1` —
 *
 *     rand % 1024 < drop_rate + 1
 *
 * (docs/research/battle/exp-levelup-rewards-decoded-2026-07-10.md:44, ledger token
 * `exp-levelup-rewards-decoded`). The browser's old `Math.random() * 255 < drop_rate`
 * borrowed a second RNG and an invented scale; this leaf is the disc's own draw, kept
 * pure so both the engine and the tests can call it with an injected stream.
 *
 * `drop_rate` comes from `enemies.json` (0 on 101 rows, 2 on 1, 16 on 19, 32 on 17,
 * 64 on 15, 128 on 34, 192 on 2, 256 on 5). Rate 0 is not "never": draw 0 lands, which
 * is why the shipped table's 101 zero rows still pass 1 time in 1024 — the original's
 * own arithmetic, not a floor.
 */

/** True when `draw` (one RAND_U16 word) passes the disc's `rate % 1024` drop roll. */
export function dropRoll(rate: number, draw: number): boolean {
  return (draw % 1024) < ((rate | 0) + 1);
}

/** Draw once from `rng` (the shared stream — RAND_U16) and run the drop roll. */
export function dropPasses(rate: number, rng: () => number): boolean {
  return dropRoll(rate, rng());
}
