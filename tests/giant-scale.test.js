// Giant mode part 1 — the battle renderer can draw either fighter at any scale.
//
// The renderer keeps a scale per side (1 = MODEL_SCALE, the shipped size) and the battle's
// party entries may carry `size`; the F2 Extras -> Giant mode toggle is the only thing that
// lets that field be read. These tests pin the small pure pieces:
//   1. the giant near-camera fit opens only for a big body (a giant shrunk below 0.7x goes
//      back to the ordinary path, a small body scaled past 1.6x gets the fit);
//   2. the fit's subject grows with the fighter (scaledRest);
//   3. the per-side scale is stored and clamped 0.1..16;
//   4. with the toggle OFF not one entry carries a `size` key and the renderer is never called
//      (the game draws exactly as before); ON, the size reaches both sides.
import test from "node:test";
import assert from "node:assert/strict";

const {
  usesGiantFit, scaledRest, createFighterScaleState, FIGHTER_SCALE_MIN, FIGHTER_SCALE_MAX,
} = await import("../web/battle3d.js");
const { partyEntriesWithSize, applyGiantScales } = await import("../web/battle.js");

test("the giant near-camera fit opens only for a big body", () => {
  assert.equal(usesGiantFit("m032kune", 1), false);     // Kunemon at the shipped size
  assert.equal(usesGiantFit("m032kune", 2.5), true);    // a 2.5x small partner
  assert.equal(usesGiantFit("m441raiz", 1), true);      // Raijinmon, a giant as it ships
  assert.equal(usesGiantFit("m441raiz", 0.5), false);   // the same giant shrunk: ordinary path
  // The two gates: a small body opens the fit at 1.6x; a giant leaves it below 0.7x.
  assert.equal(usesGiantFit("m032kune", 1.59), false);
  assert.equal(usesGiantFit("m032kune", 1.6), true);
  assert.equal(usesGiantFit("m115muge", 0.69), false);  // Machinedramon
  assert.equal(usesGiantFit("m115muge", 0.7), true);
});

test("scaledRest grows the body box with the fighter", () => {
  assert.deepEqual(scaledRest({ h: 1000, w: 500 }, 2), { h: 2000, w: 1000 });
  assert.deepEqual(scaledRest({ h: 2500, w: 1200 }, 0.5), { h: 1250, w: 600 });
  assert.equal(scaledRest(null, 2), null);
});

test("a fighter's scale is stored per side and clamped to 0.1..16", () => {
  const r = createFighterScaleState();
  assert.equal(r.fighterScale("player"), 1);
  assert.equal(r.fighterScale("enemy"), 1);
  assert.equal(r.setFighterScale("player", 20), 16);
  assert.equal(r.setFighterScale("enemy", 0.01), 0.1);
  assert.equal(r.fighterScale("player"), 16);
  assert.equal(r.fighterScale("enemy"), 0.1);
  assert.equal(FIGHTER_SCALE_MIN, 0.1);
  assert.equal(FIGHTER_SCALE_MAX, 16);
});

// A boss-party entry as startParty receives it: the first carries an authored size.
const PARTY = [
  { enemyId: "Kunemon", enemyLevel: 5, enemyHp: 100, enemyMp: 20, enemyStatScale: 16, size: 2.5 },
  { enemyId: "Agumon", enemyLevel: 3, enemyHp: 80, enemyMp: 10, enemyStatScale: 16 },
];

test("with the F2 toggle off no entry carries a size field", () => {
  const out = partyEntriesWithSize(PARTY, false, 4);
  assert.deepEqual(out, PARTY.map(({ size, ...rest }) => rest));
  for (const e of out) assert.equal("size" in e, false);
});

test("with the toggle on each entry carries size x the part-2 multiplier", () => {
  const out = partyEntriesWithSize(PARTY, true, 1);
  assert.equal(out[0].size, 2.5);
  assert.equal(out[1].size, 1);
  const big = partyEntriesWithSize(PARTY, true, 2);
  assert.equal(big[0].size, 5);
  assert.equal(big[1].size, 2);
});

test("the scale reaches the renderer only when the toggle is on", () => {
  const calls = [];
  const renderer = { setFighterScale: (side, k) => calls.push([side, k]) };
  assert.equal(applyGiantScales(renderer, PARTY[0], false), false);
  assert.deepEqual(calls, []);                       // off: the renderer keeps MODEL_SCALE
  assert.equal(applyGiantScales(renderer, PARTY[0], true), true);
  assert.deepEqual(calls, [["player", 1], ["enemy", 2.5]]);
});
