// applyAspect (web/extra-roster.js): a once-only, capped starting bonus to one element.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAspect, ASPECT_SEED, withoutNewPartners, NEW_PARTNERS_ENABLED } from "../web/extra-roster.js";

test("an aspect adds its seed to that element once, and nothing else", () => {
  const ps = { elemBonuses: { dark: 7 } };
  assert.equal(applyAspect(ps, "dark"), true);
  assert.equal(ps.elemBonuses.dark, 7 + ASPECT_SEED);
  assert.equal(ps.aspect, "dark");
  assert.deepEqual(Object.keys(ps.elemBonuses), ["dark"]);
});

test("it can be chosen only once per partner", () => {
  const ps = {};
  assert.equal(applyAspect(ps, "fire"), true);
  assert.equal(applyAspect(ps, "water"), false);
  assert.equal(ps.elemBonuses.fire, ASPECT_SEED);
  assert.equal(ps.elemBonuses.water, undefined);
});

test("the seed is capped, the stat cap holds, and bad input is refused", () => {
  const ps = { elemBonuses: { ice: 990 } };
  assert.equal(applyAspect(ps, "ice", 500), true);
  assert.equal(ps.elemBonuses.ice, 999);
  assert.equal(applyAspect({}, "ice", 500) && true, true);
  const big = {}; applyAspect(big, "wind", 500);
  assert.equal(big.elemBonuses.wind, ASPECT_SEED, "a bigger seed is clipped to the cap");
  assert.equal(applyAspect({}, "holy"), false);
  assert.equal(applyAspect(null, "dark"), false);
});

test("the partner switch is off and strips the partners from the extra data", () => {
  assert.equal(NEW_PARTNERS_ENABLED, false);
  const extra = { starters: [{ id: 191, slot: 8 }], digimon: [{ id: 56 }, { id: 191 }], tree: { 0: [], 8: [{ to: 56 }] } };
  const out = withoutNewPartners(extra);
  assert.deepEqual(out.starters, []);
  assert.deepEqual(out.digimon.map((d) => d.id), [56]);
  assert.deepEqual(Object.keys(out.tree), ["0"]);
});
