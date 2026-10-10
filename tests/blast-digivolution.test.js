// Automatic Blast digivolution formulas (engine/dw3/battle-formulas.ts).
// Decoded + runtime-verified 2026-07-13/14 (BLAST-C001..C010, DIGI ledger):
//   - gaugeGain: F0x800a1c18 base = (100·dmg/stat)² / 20, cap 1000.
//   - boostedGaugeGain: OverClocked(329) +20%, OverLoad(330) +40%, each slot stacks.
//   - levelTier: event-0x12 ladder <4/<19/<39/<70 -> 0..3 else 4.
//   - blastTargetId: rookie profile blasts[tier]; values are digimon.json ids.
// The Renamon->Taomon case is the live capture (lvl15 -> tier1 -> blasts[1]=27 = Taomon).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gaugeGain, boostedGaugeGain, levelTier, blastTargetId,
} from "../engine/dw3/battle-formulas.ts";

test("gaugeGain uses ratio² / 20 with a 1000 cap", () => {
  // ratio = floor(100·dmg/stat); gain = floor(ratio²/20)
  assert.equal(gaugeGain(0, 400), 0);
  assert.equal(gaugeGain(100, 400), Math.floor(Math.pow(Math.floor(100 * 100 / 400), 2) / 20)); // ratio 25 -> 31
  assert.equal(gaugeGain(100, 400), 31);
  assert.equal(gaugeGain(400, 400), 500);   // ratio 100 -> 10000/20
  assert.equal(gaugeGain(1000, 400), 1000); // saturates at the cap
  assert.equal(gaugeGain(50, 0), 0);        // guard: no divide by zero
});

test("boostedGaugeGain stacks OverClocked/OverLoad per accessory slot", () => {
  assert.equal(boostedGaugeGain(100, []), 100);
  assert.equal(boostedGaugeGain(100, [329]), 120);           // +20%
  assert.equal(boostedGaugeGain(100, [330]), 140);           // +40%
  assert.equal(boostedGaugeGain(100, [329, 330]), 168);      // 100 -> 120 -> +40% of 120
  assert.equal(boostedGaugeGain(900, [330, 330]), 1000);     // clamps to 1000
});

test("levelTier follows the event-0x12 boundary ladder", () => {
  assert.equal(levelTier(1), 0);
  assert.equal(levelTier(3), 0);
  assert.equal(levelTier(4), 1);
  assert.equal(levelTier(18), 1);
  assert.equal(levelTier(19), 2);
  assert.equal(levelTier(38), 2);
  assert.equal(levelTier(39), 3);
  assert.equal(levelTier(69), 3);
  assert.equal(levelTier(70), 4);
  assert.equal(levelTier(99), 4);
});

test("blastTargetId reads rookie blasts[] by tier (Renamon -> Taomon runtime case)", () => {
  const renamon = [15, 27, 39, 45, 43]; // digimon.json id7 blasts
  assert.equal(blastTargetId(renamon, 15), 27); // lvl15 -> tier1 -> Taomon (0x177), live-captured
  assert.equal(blastTargetId(renamon, 1), 15);  // tier0 -> Kyubimon
  assert.equal(blastTargetId(renamon, 40), 45); // tier3
  assert.equal(blastTargetId(renamon, 80), 43); // tier4
  assert.equal(blastTargetId([0, 0, 0, 0, 0], 15), null); // actor/no-blast profile
  assert.equal(blastTargetId(undefined, 15), null);
  assert.equal(blastTargetId([1, 2], 15), null);          // malformed
});
