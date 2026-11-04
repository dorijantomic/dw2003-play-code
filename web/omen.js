// web/omen.js — "A feeling before a fight": read the decoded encounter counter and say
// how close the next wild Digimon is. Pure: no DOM, no imports, and it never writes.
//
// The counter is web/game.js's `state._encCounter` (engine [0x80048d64]), reset to
// rand()%0x900 folded into 0..1279. Every ENCOUNTER_TICK_FRAMES (8) movement ticks the
// fieldstg driver (F0x8008fd74 -> F0x80092664) subtracts the standing zone's rate and
// rolls when the countdown reaches zero. The rates are the decoded tiers of
// engine/dw3/encounters.ts ENCOUNTER_RATE_TABLE; index 0 is the 2000 sentinel the
// scripted trigger path uses, and level 0 means "never roll here" — web/game.js does
// not even call the driver then, so this module reads it as endless.
//
// Nothing here decides a fight: the rate, the counter, the guards, the species and the
// roll all stay exactly where they are. The field only gets a feeling.

/** Driver runs from "no feeling at all" to "the full feeling" — 12 runs = 96 movement ticks. */
export const WINDOW_RUNS = 12;

/** The decoded rate tiers, a read-only copy of engine/dw3/encounters.ts ENCOUNTER_RATE_TABLE. */
export const OMEN_RATE_TABLE = [2000, 3, 4, 6, 9, 18];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Driver runs until the counter expires, or Infinity when no roll can happen here.
 *
 * `counter` is the live countdown; `rateLevel` is the standing zone's rate tier
 * (0 = never roll). A counter already at 0 is 0 runs: the very next run fires.
 */
export function runsLeft(counter, rateLevel) {
    const level = Number(rateLevel);
    if (!(level >= 1 && level <= 5)) return Infinity;      // 0 = never roll; the table's 2000 is not a tier
    const c = Number(counter);
    if (!Number.isFinite(c)) return Infinity;              // nothing known, no feeling
    if (c <= 0) return 0;
    return Math.ceil(c / OMEN_RATE_TABLE[level]);
}

/**
 * How strong the feeling is, 0..1: 0 past the window, then a straight ramp so the last
 * run reads exactly 1. `enabled` is the F2 switch (off by default); `quiet` is true
 * while the player stands still, when the counter no longer drains.
 */
export function omenLevel(counter, rateLevel, { enabled = false, quiet = false } = {}) {
    if (!enabled || quiet) return 0;
    const runs = runsLeft(counter, rateLevel);
    if (!Number.isFinite(runs) || runs > WINDOW_RUNS) return 0;
    return clamp01(1 - (runs - 1) / (WINDOW_RUNS - 1));
}

// A small integer hash -> 0..1. Same seed, same number, every run and every machine.
function hash01(seed, salt) {
    let h = ((Number(seed) >>> 0) ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * What the field shows for `level`, 0..1 each:
 *   rustle — how many dust specks lift off the ground
 *   shadow — how dark the edge shadow gets
 *   pulse  — the slow breathing of both (a rate/phase, not an amount)
 * Deterministic per seed: the same map always feels the same.
 */
export function omenCues(level, seed = 0) {
    const k = clamp01(Number(level) || 0);
    if (k <= 0) return { rustle: 0, shadow: 0, pulse: 0 };
    const s = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 0;
    return {
        rustle: k * (0.55 + 0.45 * hash01(s, 0x1f)),
        shadow: k * (0.60 + 0.40 * hash01(s, 0x2e)),
        pulse: k * (0.50 + 0.50 * hash01(s, 0x3d)),
    };
}
