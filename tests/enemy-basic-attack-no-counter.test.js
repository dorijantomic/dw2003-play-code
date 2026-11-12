// Disc fightstg.s:28425-28461: record f7 == 10 never builds a counter stance. A players use of it does nothing
// (F0x8009e0cc -> F0x8009d72c); an enemys own attack (302/303/335 "Fight") is an ordinary attack. The only counter
// the disc has is the enemy rows +0x42 action (see tests/battle-tech-round3-disc.test.js), so the invented 3-use
// stance API is gone.
import test from "node:test";
import assert from "node:assert/strict";
import * as battle from "../web/battle.js";

test("the invented counter-stance API no longer exists", () => {
  assert.equal(battle.setCounterStance, undefined);
  assert.equal(battle.setEnemyCounterStance, undefined);
  assert.equal(battle.triggerCounter, undefined);
});
