// Submarimon terrain-height gate (fieldstg F0x8008DE0C).
//
// While wearing the water form, a raised or lowered terrain tier refuses the
// step until the sub is at the right depth. Only the water form carries a height
// (+0x64), so a walking Digimon is never gated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { terrainHeightGate } from "../engine/core/util/collision.ts";

const SEED = 0x3000; // Submarimon's constructor height (fieldstg 0x8009116c)

test("a form with no height, or terrain code 1, is never gated", () => {
  for (const code of [1, 2, 5, 18, 22, 0, 255])
    assert.equal(terrainHeightGate(code, 0), false, `height 0, code ${code}`);
  assert.equal(terrainHeightGate(1, SEED), false);
});

test("raised tiers 2..6 pass only when at or over the tier", () => {
  const tiers = { 2: 0x2000, 3: 0x3000, 4: 0x4000, 5: 0x5000, 6: 0x6000 };
  for (const [code, tier] of Object.entries(tiers)) {
    const c = Number(code);
    assert.equal(terrainHeightGate(c, tier - 1), true, `code ${c} under tier`);
    assert.equal(terrainHeightGate(c, tier), false, `code ${c} at tier`);
    assert.equal(terrainHeightGate(c, tier + 1), false, `code ${c} over tier`);
  }
});

test("mirror tiers 18..22 pass only when underneath", () => {
  const tiers = { 18: 0x6001, 19: 0x5001, 20: 0x4001, 21: 0x3001, 22: 0x2001 };
  for (const [code, tier] of Object.entries(tiers)) {
    const c = Number(code);
    assert.equal(terrainHeightGate(c, tier - 2), false, `code ${c} under tier`);
    assert.equal(terrainHeightGate(c, tier), true, `code ${c} at tier`);
    assert.equal(terrainHeightGate(c, tier + 1), true, `code ${c} over tier`);
  }
});

test("at the seed height the shipped tiers read as the code says", () => {
  // 0x3000 is at the code-3 tier: passes 2/3, is gated by 4/5/6 and by 22/21? no,
  // 0x3000 < 0x3001 so code 21 passes, and >= 0x2001 so code 22 gates.
  assert.equal(terrainHeightGate(2, SEED), false);
  assert.equal(terrainHeightGate(3, SEED), false);
  assert.equal(terrainHeightGate(4, SEED), true);
  assert.equal(terrainHeightGate(5, SEED), true);
  assert.equal(terrainHeightGate(6, SEED), true);
  assert.equal(terrainHeightGate(18, SEED), false);
  assert.equal(terrainHeightGate(21, SEED), false);
  assert.equal(terrainHeightGate(22, SEED), true);
});

test("codes outside both tiers are never gated", () => {
  for (const code of [0, 1, 7, 17, 23, 30, 255])
    assert.equal(terrainHeightGate(code, SEED), false, `code ${code}`);
});
