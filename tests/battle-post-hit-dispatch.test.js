// The post-hit secondary-effect dispatcher FIGHTSTG_F0x8009df78 (table 0x80083234) and
// the three persistent-stat-penalty arms it routes to.
//
// This is the machine that runs a technique's secondary effect on the fighter it hit, as
// against F0x8008f714 (tests/battle-damage-terms.test.js) which picks the *page* the
// technique prints. Its three arms at dispatch 32/33/34 write the persistent stat penalty
// at roster +0x42/+0x44/+0x46 -- the same halfwords the inn rests away and the status
// sheet subtracts. Before this port the engine modelled the penalty as a *consumer* only
// (engine/dw3/equipment.ts, engine/dw3/ui/native/inn-screen.ts); nothing produced it.
//
// Every test below fails on the code before this change: the module had no post-hit
// dispatcher and no penalty producer at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DAMAGE_TERM_POST_HIT_ARMS, DAMAGE_TERM_POST_HIT_COUNT, DAMAGE_TERM_POST_HIT_FIRST,
  DAMAGE_TERM_POST_HIT_RETURN, DAMAGE_TERM_POST_HIT_TABLE,
  DAMAGE_TERM_PENALTY_DISPATCHES, DAMAGE_TERM_PENALTY_ROLL,
  DAMAGE_TERM_PENALTY_SLOT_COUNT,
  applyDamageTermPenalty, damageTermPenaltyMode, damageTermPenaltyRoll,
  damageTermPostHitArm, damageTermPostHitArmRuns,
} from "../web/vendor/engine.js";

const TECH_TABLE = JSON.parse(readFileSync(
  new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const MODULE_SRC = readFileSync(
  new URL("../engine/dw3/battle-damage-terms.ts", import.meta.url), "utf8");

const dispatchesInData = () =>
  new Set(Object.values(TECH_TABLE).map((r) => Number(r.dispatch)).filter((d) => Number.isFinite(d)));

test("CENSUS: the dispatcher table is 33 contiguous arms for dispatch 2..34", () => {
  assert.equal(DAMAGE_TERM_POST_HIT_FIRST, 2);
  assert.equal(DAMAGE_TERM_POST_HIT_COUNT, 33);
  assert.equal(DAMAGE_TERM_POST_HIT_TABLE, 0x80083234);
  assert.equal(DAMAGE_TERM_POST_HIT_ARMS.length, 33);
  DAMAGE_TERM_POST_HIT_ARMS.forEach((arm, i) => {
    assert.equal(arm.dispatch, DAMAGE_TERM_POST_HIT_FIRST + i,
      "the arm list must be in table order, index = dispatch - 2");
  });
  // Outside the window the table does not answer at all.
  assert.equal(damageTermPostHitArm(1), null);
  assert.equal(damageTermPostHitArm(35), null);
  assert.equal(damageTermPostHitArm(0), null);
});

test("CENSUS: the running arms carry the disc's own addresses, the rest are the bare return", () => {
  // The 15 `jal` targets in the dispatcher body (fightstg.s:28130-28199), by dispatch.
  const expected = {
    2: 0x8009d140, 3: 0x8009d1dc, 4: 0x8009d2c4, 5: 0x8009d3ac,
    6: 0x8009d470, 8: 0x8009d61c, 11: 0x8009d768, 12: 0x8009d7a4,
    26: 0x8009d858, 27: 0x8009d944, 29: 0x8009da0c,
    32: 0x8009daac, 33: 0x8009db94, 34: 0x8009dc8c,
  };
  for (const [dispatch, addr] of Object.entries(expected)) {
    assert.equal(damageTermPostHitArm(Number(dispatch))?.arm, addr,
      `dispatch ${dispatch} must route to 0x${addr.toString(16)}`);
    assert.equal(damageTermPostHitArmRuns(Number(dispatch)), true);
  }
  // Every other dispatch falls to the dispatcher's own epilogue -> nothing runs.
  for (const arm of DAMAGE_TERM_POST_HIT_ARMS) {
    if (arm.dispatch in expected) continue;
    assert.equal(arm.arm, DAMAGE_TERM_POST_HIT_RETURN,
      `dispatch ${arm.dispatch} is not one of the 15 arms, so its word must be the epilogue`);
    assert.equal(damageTermPostHitArmRuns(arm.dispatch), false);
  }
  // A word equal to the epilogue can never be mistaken for a running arm.
  assert.equal(DAMAGE_TERM_POST_HIT_RETURN, 0x8009e0bc);
});

test("CENSUS: every dispatch the disc ships inside 2..34 is answered by the table", () => {
  // The population is the disc's own technique table (443 rows, record +0x0a is the
  // `dispatch` column). If a record carried a dispatch the table cannot answer, this port
  // would silently drop its secondary effect.
  const shipped = dispatchesInData();
  const inWindow = [...shipped].filter((d) => d >= 2 && d <= 34).sort((a, b) => a - b);
  const unanswered = inWindow.filter((d) => damageTermPostHitArm(d) === null);
  assert.deepEqual(unanswered, [],
    `the disc ships dispatch values the table does not answer: ${unanswered.join(",")}`);
  // And the three penalty dispatches really do occur in shipped data -- this is not a
  // producer for a byte no technique carries.
  for (const d of DAMAGE_TERM_PENALTY_DISPATCHES) {
    assert.ok(shipped.has(d), `no shipped technique carries dispatch ${d}`);
    assert.equal(damageTermPostHitArm(d)?.role, "stat-penalty");
  }
  // 8 shipped records carry them (ids 421..428, all category 2): 2 + 4 + 2.
  const rows = Object.values(TECH_TABLE).filter((r) => DAMAGE_TERM_PENALTY_DISPATCHES.includes(Number(r.dispatch)));
  assert.equal(rows.length, 8, "the penalty dispatch family is 8 shipped records");
});

test("CENSUS: the penalty family has the slot geometry and shared roll the assembly shows", () => {
  assert.deepEqual([...DAMAGE_TERM_PENALTY_DISPATCHES], [32, 33, 34]);
  assert.equal(DAMAGE_TERM_PENALTY_SLOT_COUNT, 3);
  assert.equal(DAMAGE_TERM_PENALTY_ROLL, 0x800a1458);
  assert.equal(damageTermPenaltyMode(32), "one");
  assert.equal(damageTermPenaltyMode(33), "per-slot");
  assert.equal(damageTermPenaltyMode(34), "all");
  assert.equal(damageTermPenaltyMode(31), null);
  assert.equal(damageTermPenaltyMode(35), null);
  // The port is anchored to the machine it came from.
  assert.match(MODULE_SRC, /F0x8009df78/);
  assert.match(MODULE_SRC, /0x80083234/);
  assert.match(MODULE_SRC, /F0x800a1458/);
});

test("the landing roll is effect_p1 + trunc((wisHigh - wisLow)/8) against rand&0x7f", () => {
  // chance = 80 + 0 = 80.
  assert.equal(damageTermPenaltyRoll(80, 0, 0, () => 79), true);
  assert.equal(damageTermPenaltyRoll(80, 0, 0, () => 80), false);
  assert.equal(damageTermPenaltyRoll(80, 0, 0, () => 127), false);
  // A WIS edge of +80 adds trunc(80/8) = 10 -> chance 90.
  assert.equal(damageTermPenaltyRoll(80, 80, 0, () => 89), true);
  assert.equal(damageTermPenaltyRoll(80, 80, 0, () => 90), false);
  // A negative edge subtracts (trunc toward zero, the assembly's sign fix).
  assert.equal(damageTermPenaltyRoll(80, 0, 80, () => 69), true);
  assert.equal(damageTermPenaltyRoll(80, 0, 80, () => 70), false);
});

test("dispatch 34 (all): one roll, then all three slots", () => {
  // A landing draw of 0 < 100 -> every slot takes the magnitude and the queue word is 7.
  const hit = applyDamageTermPenalty([0, 5, -3], {
    effectP1: 100, wisHigh: 0, wisLow: 0, magnitude: 12, dispatch: 34, rng: () => 0,
  });
  assert.deepEqual(hit.slots, [12, 17, 9]);
  assert.equal(hit.queueWord, 0x7);
  // A missed draw leaves every slot alone.
  const miss = applyDamageTermPenalty([0, 5, -3], {
    effectP1: 100, wisHigh: 0, wisLow: 0, magnitude: 12, dispatch: 34, rng: () => 127,
  });
  assert.deepEqual(miss.slots, [0, 5, -3]);
  assert.equal(miss.queueWord, 0);
});

test("dispatch 33 (per-slot): one roll inside the three-slot loop", () => {
  // draws: slot 0 lands, slot 1 misses, slot 2 lands -> queue word 1 | 4 = 5.
  const seq = [0, 127, 0];
  let i = 0;
  const res = applyDamageTermPenalty([10, 10, 10], {
    effectP1: 100, wisHigh: 0, wisLow: 0, magnitude: 7, dispatch: 33, rng: () => seq[i++],
  });
  assert.deepEqual(res.slots, [17, 10, 17]);
  assert.equal(res.queueWord, 0x5);
});

test("dispatch 32 (one): the slot bit is drawn before the roll", () => {
  // First draw picks slot 1 (odd); second draw lands (0 < 100).
  const seq = [1, 0];
  let i = 0;
  const res = applyDamageTermPenalty([0, 0, 0], {
    effectP1: 100, wisHigh: 0, wisLow: 0, magnitude: 9, dispatch: 32, rng: () => seq[i++],
  });
  assert.deepEqual(res.slots, [0, 9, 0]);
  assert.equal(res.queueWord, 1 << 1);
  // First draw picks slot 0; second draw misses -> nothing changes.
  const seq2 = [0, 127];
  let j = 0;
  const miss = applyDamageTermPenalty([4, 4, 4], {
    effectP1: 100, wisHigh: 0, wisLow: 0, magnitude: 9, dispatch: 32, rng: () => seq2[j++],
  });
  assert.deepEqual(miss.slots, [4, 4, 4]);
  assert.equal(miss.queueWord, 0);
});

test("a non-penalty dispatch never writes a slot", () => {
  const res = applyDamageTermPenalty([1, 2, 3], {
    effectP1: 127, wisHigh: 0, wisLow: 0, magnitude: 99, dispatch: 2, rng: () => 0,
  });
  assert.deepEqual(res.slots, [1, 2, 3]);
  assert.equal(res.queueWord, 0);
});
