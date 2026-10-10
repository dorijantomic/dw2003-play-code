// The four ported fight mechanisms are wired onto the ordinary route, not left
// exported-but-unconsumed.
//
// docs/research/battle/battle-browser-only-mechanisms-2026-10-06.md pinned the slow-motion
// stepper, the face-box cel draw, the enemy-id resolver and the steal roll to their original
// fightstg routines, but noted the browser kept its own copy of each. This file locks the
// WIRING: the ordinary battle path (web/battle3d.js and web/battle.js, and web/battle.js's
// web/battlehud-translated.js) imports the engine ports out of the production bundle, and the
// engine modules export them. Without this, a port can silently unconsume again.
//
// It also states the steal roll's direction — that wiring it CHANGES the odds — with the
// arithmetic, so the divergence is a recorded fact rather than a surprise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stealRatio, stealWeight, stealThreshold } from "../engine/dw3/battle-steal-roll.ts";
import { enemyStatsIndex, enemyStatsBlock } from "../engine/dw3/battle-enemy-id.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** Does `file` import `symbol` from the production bundle? */
function importsFromEngine(file, symbol) {
  const src = read(file);
  const re = /import\s*\{([^}]*)\}\s*from\s*["']\.\/vendor\/engine\.js["']/g;
  let m;
  while ((m = re.exec(src))) {
    for (let part of m[1].split(",")) {
      part = part.trim().replace(/\/\/.*$/s, "").replace(/^type\s+/, "");
      if (part.split(/\s+as\s+/)[0].trim() === symbol) return true;
    }
  }
  return false;
}

test("web/battle3d.js drives the slow-motion clock through the port", () => {
  for (const s of ["slowMotionStep", "setSlowMotion", "SLOW_MO_PUBLISH_AT", "SLOW_MO_ACCUM_COST"]) {
    assert.ok(importsFromEngine("web/battle3d.js", s), `battle3d.js does not import ${s}`);
  }
  // The published word is the port's, not a hand-written loop.
  assert.match(read("web/battle3d.js"), /return slowMotionStep\(level, delta, acc\);/,
    "slowMoStep must delegate to the port");
});

test("web/battle.js and web/battlehud-translated.js consume the cel draw, resolver and steal roll", () => {
  assert.ok(importsFromEngine("web/battle.js", "faceBezelCelDraw"), "battle.js not on the cel-draw port");
  assert.ok(importsFromEngine("web/battle.js", "enemyStatsIndex"), "battle.js not on the resolver port");
  assert.ok(importsFromEngine("web/battle.js", "stealProc"), "battle.js not on the steal-roll port");
  assert.ok(importsFromEngine("web/battlehud-translated.js", "enemyStatsBlock"),
    "battlehud-translated.js not on the resolver port");
  // The literals the ports replace must be gone.
  assert.doesNotMatch(read("web/battle.js"), /hudClip\(0x0a, 246, 74\)/,
    "the cel-draw literal is still hard-coded");
  assert.doesNotMatch(read("web/battle.js"), /statusRoll\(\(skill\.effect_p1 \?\? 0\) \+ stealBonus/,
    "the old status-roll steal formula is still there");
});

test("the resolver port scans by numeric id and returns base + index*stride", () => {
  // A three-record table laid out at stride 0x46, ids 32 / 206 / 197 then the zero terminator.
  const ids = [32, 206, 197, 0];
  const readId = (i) => ids[i] ?? 0;
  assert.equal(enemyStatsIndex(readId, 206), 1);
  assert.equal(enemyStatsIndex(readId, 197), 2);
  assert.equal(enemyStatsIndex(readId, 999), -1, "an id the scan never meets is -1");
  assert.equal(enemyStatsBlock(0x80050000, readId, 197), (0x80050000 + 2 * 0x46) | 0);
  assert.equal(enemyStatsBlock(0x80050000, readId, 999), 0, "the resolver's not-found answer is 0");
});

// ── The steal roll's arithmetic: the wiring changes the odds ────────────────────────────

// The formula the walker USED: statusRoll(effect_p1 + stealBonus, enemy.wis), a chance on the
// 0..127 scale (chance = clamp(atk - floor(def/8), 1, 127)).
const oldChance = (effectP1, bonus, wis) => {
  let c = (effectP1 + bonus) - Math.floor(wis / 8);
  if (c < 1) c = 1;
  if (c > 127) c = 127;
  return c / 128;
};
// The formula the original uses, which the walker NOW runs: (rng & 0x3ff) < threshold, so
// the chance is min(threshold, 1024) / 1024.
const newChance = (field04, thiefSpd, foeSpd, f8, bonus) =>
  Math.min(stealThreshold(field04, stealRatio(thiefSpd, foeSpd), f8, bonus), 1024) / 1024;

test("the steal roll: the original's weight is (100*(f8+bonus))>>6 and the ratio clamps at 200", () => {
  assert.equal(stealWeight(64, 0), 100, "Picking Claw f8=64");
  assert.equal(stealWeight(96, 0), 150, "Snapping Claw f8=96");
  assert.equal(stealWeight(64, 32), 150, "a +32 Hack Sticker");
  assert.equal(stealRatio(200, 100), 200);
  assert.equal(stealRatio(400, 100), 200, "clamped");
  assert.equal(stealThreshold(128, 200, 64, 0), 256);
});

test("the steal roll: wiring it makes an ordinary steal RARER, and impossible at factor 0", () => {
  // No Hack Sticker, equal speed (ratio 100), Picking Claw, an enemy with wis 80: the walker
  // used to succeed ~42% of the time.
  const old = oldChance(64, 0, 80);
  assert.ok(Math.abs(old - 54 / 128) < 1e-9, "old chance = (64 - 10)/128 = 54/128");
  // The original, at a mid enemy factor (16) and equal speed, succeeds ~1.6%.
  const mid = newChance(16, 100, 100, 64, 0);
  assert.ok(mid < old, `the new chance ${mid} must be below the old ${old}`);
  // The 100 of 193 enemies whose +0x04 is zero can never be stolen from.
  assert.equal(newChance(0, 200, 100, 96, 64), 0, "factor 0 is an impossible steal");
  // A big steal bonus over a high-factor enemy CAN out-do the old cap: the new roll is not
  // bounded by the old 127/128 ceiling.
  assert.ok(newChance(256, 200, 100, 96, 64) === 1, "high factor + bonus + ratio guarantees the steal");
});
