// An enemy-authored model standing on the near side: its shots, hit sparks and leaps are turned around.
import test from "node:test";
import assert from "node:assert/strict";
import { authoredSide, mirrorOps, mirrorHooks } from "../web/fight/side-mirror.js";

const op3 = (x, y, z) => ({ op: 3, words: [0, 2, x, y, z] });
const op6 = (x, z, yaw) => ({ op: 6, words: [0, 210, x, 5, z, 0, yaw, 0] });

test("which way a model's scripts aim comes from its own coordinates", () => {
  assert.equal(authoredSide({ actions: [{ ops: [op3(0, 0, 900)] }] }), "player");
  assert.equal(authoredSide({ actions: [{ ops: [op3(0, 0, -900), op6(10, -500, 0)] }] }), "enemy");
  // a shot with yaw 0 is enemy-authored even when its hit sparks sit at +z (Numemon)
  assert.equal(authoredSide({ actions: [{ ops: [op3(0, 0, 3840), op6(0, -4160, 0)] }] }), "enemy");
  assert.equal(authoredSide({ actions: [{ ops: [op3(0, 0, 3840), op6(0, 3968, 2048)] }] }), "player");
  assert.equal(authoredSide({ actions: [{ ops: [] }] }), "enemy");          // nothing to go on, few clips: an enemy
  assert.equal(authoredSide({ actions: [{ ops: [op3(0, 0, 32767)] }] }), "enemy");   // screen-space effects do not count
});

test("mirrorOps turns positions and a projectile's yaw, and leaves the original alone", () => {
  const src = [op3(30, 7, -900), op6(10, -500, 0), { op: 2, words: [3, 0, 40, 9, -600, 25] }, { op: 11, words: [5] }];
  const out = mirrorOps(src);
  assert.deepEqual(out[0].words, [0, 2, -30, 7, 900]);
  assert.deepEqual(out[1].words.slice(2, 5), [-10, 5, 500]);
  assert.equal(out[1].words[6], -2048);
  assert.deepEqual(out[2].words, [3, 0, -40, 9, 600, 25]);
  assert.deepEqual(out[3], src[3]);
  assert.equal(src[0].words[4], -900);
});

test("mirrorHooks turns effects, flights and leaps; screen effects and contact moves stay", () => {
  const got = {};
  const h = mirrorHooks({
    onEffect: (r) => (got.fx = r), onMove: (r) => (got.mv = r), setLunge: (l) => (got.lg = l),
  });
  h.onEffect({ type: 2, x: 5, y: 1, z: -800 });
  assert.deepEqual(got.fx, { type: 2, x: -5, y: 1, z: 800 });
  h.onEffect({ type: 2, x: 5, y: 1, z: 32767 });
  assert.equal(got.fx.x, 5);
  h.onMove({ kind: "to", x: 20, y: 0, z: 300, tween: 4 });
  assert.deepEqual(got.mv, { kind: "to", x: -20, y: 0, z: -300, tween: 4 });
  h.onMove({ kind: "contact", tween: 4 });
  assert.deepEqual(got.mv, { kind: "contact", tween: 4 });
  h.setLunge({ sub: 0, id: 210, from: [10, 5, -500], to: [0, 0, 0] });
  assert.deepEqual(got.lg.from, [-10, 5, 500]);
  assert.equal(got.lg.to[1], 2048);
  h.setLunge({ sub: 1, words: [1, 210] });
  assert.equal(got.lg.sub, 1);
});
