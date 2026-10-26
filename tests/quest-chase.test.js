// The chase step's machine (web/quest-chase.js): the target runs its path, the player is judged against `lose`, and the
// answer is 0 (kept up) or 1 (lost it). No browser: the clock is stepped by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { createQuestChase, chaseFacing } from "../web/quest-chase.js";

/**
 * Step the machine with the player at `at`, for up to `ticks` ticks (60 = one second). `at` may be a point or a function
 * of the chase (read once per tick, before it moves) for a player who follows the target.
 */
const run = (chase, ticks, at = { x: 0, y: 0 }, dt = 1 / 60) => {
  for (let i = 0; i < ticks && !chase.state.over; i++) {
    const p = typeof at === "function" ? at(chase) : at;
    chase.tick(p.x, p.y, dt);
  }
  return chase.state;
};
/** Follow the target with a fixed lead, so a test never loses by accident. */
const near = (chase, dx = 10, dy = 0) => ({ x: chase.state.x + dx, y: chase.state.y + dy });

test("the target walks the path at its speed and faces the way it goes", () => {
  const c = createQuestChase({ path: [[200, 0]], speed: 100 }, { x: 0, y: 0 });
  assert.equal(c.state.x, 0);
  run(c, 60, near);
  assert.ok(Math.abs(c.state.x - 100) < 2, `moved about 100 px in a second (${c.state.x})`);
  assert.equal(c.state.dir, "right");
  assert.equal(c.state.moving, true);
  assert.equal(c.state.over, false, "the path is not done");
});

test("reaching the end within `lose` is a kept-up answer (0)", () => {
  const c = createQuestChase({ path: [[100, 0]], speed: 200, lose: 60 }, { x: 0, y: 0 });
  run(c, 60, near);
  assert.equal(c.state.over, true);
  assert.equal(c.state.result, 0);
});

test("a gap over `lose` for a full second loses it (1), and a stumble inside clears the count", () => {
  const c = createQuestChase({ path: [[900, 0]], speed: 100, lose: 60 }, { x: 0, y: 0 });
  run(c, 40, { x: 400, y: 0 });                       // 40 ticks far behind: not a second yet
  assert.equal(c.state.over, false, "out of reach for 2/3 s is survivable");
  assert.equal(c.state.outFor, 40);
  c.tick(c.state.x, c.state.y, 1 / 60);                // standing on the target for one tick
  assert.equal(c.state.outFor, 0, "one tick back in range resets the count");
  run(c, 61, { x: 400, y: 0 });
  assert.equal(c.state.over, true);
  assert.equal(c.state.result, 1, "a whole second out of reach is lost");
});

test("`warn` turns on before the gap reaches `lose`, so the target can blink", () => {
  const c = createQuestChase({ path: [[400, 0]], speed: 100, lose: 100 }, { x: 0, y: 0 });
  c.tick(0, 0, 1 / 60);                                // distance 0: no warning
  assert.equal(c.state.warn, false);
  run(c, 45, { x: 0, y: 0 });                          // the target ran ~75 px away: still under 80% of lose
  assert.equal(c.state.warn, false, `75 px of 100 is not a warning yet (${c.state.distance})`);
  run(c, 8, { x: 0, y: 0 });                           // ~88 px away: over 80%
  assert.ok(c.state.distance > 80 && c.state.distance < 100, `about 88 px (${c.state.distance})`);
  assert.equal(c.state.warn, true);
  assert.equal(c.state.over, false);
});

test("the time limit ends the chase: kept up if still close, lost if not", () => {
  const close = createQuestChase({ path: [[10000, 0]], speed: 10, lose: 60, frames: 60 }, { x: 0, y: 0 });
  run(close, 120, near);
  assert.equal(close.state.over, true);
  assert.equal(close.state.result, 0, "time called while in reach");

  const far = createQuestChase({ path: [[10000, 0]], speed: 10, lose: 60, frames: 30, grace: 1000 }, { x: 0, y: 0 });
  run(far, 120, { x: 900, y: 0 });
  assert.equal(far.state.over, true);
  assert.equal(far.state.result, 1, "time called while out of reach (the grace still pending)");
});

test("a big delta cannot overshoot a point: it turns the corner and carries the rest of the step", () => {
  const c = createQuestChase({ path: [[10, 0], [10, 40]], speed: 100 }, { x: 0, y: 0 });
  c.tick(0, 0, 1 / 60);
  assert.equal(c.state.dir, "right", "the first leg is walked rightwards");
  const leftToCorner = 10 - c.state.x;
  c.tick(0, 0, 1);                                     // dt is clamped to 0.25 s = 25 px
  assert.equal(c.state.x, 10, "it turns on the corner instead of running past it");
  assert.ok(Math.abs(c.state.y - (25 - leftToCorner)) < 1e-6, `the rest of the step carries on down the next leg (${c.state.y})`);
  assert.equal(c.state.dir, "down");
  c.tick(c.state.x, c.state.y, 1 / 60);
  assert.ok(Math.abs(c.state.y - (25 - leftToCorner + 100 / 60)) < 1e-6, `the next tick carries on down (${c.state.y})`);
});

test("an empty path is over at once with 0 (the step is skipped, never blocks)", () => {
  const c = createQuestChase({ path: [] }, { x: 5, y: 6 });
  assert.equal(c.state.over, true);
  assert.equal(c.state.result, 0);
  c.tick(0, 0, 1 / 60);
  assert.equal(c.state.result, 0, "ticking a finished chase changes nothing");
});

test("bad data falls back to the documented defaults", () => {
  const c = createQuestChase({ path: [[50, 0]], speed: "fast", lose: -3 }, null);
  assert.equal(c.speed, 130);
  assert.equal(c.lose, 90);
  assert.deepEqual([c.state.x, c.state.y], [50, 0], "without a start it stands on the first point");
});

test("chaseFacing names all eight directions the field draws", () => {
  assert.equal(chaseFacing(1, 0), "right");
  assert.equal(chaseFacing(-1, 0), "left");
  assert.equal(chaseFacing(0, 1), "down");
  assert.equal(chaseFacing(0, -1), "up");
  assert.equal(chaseFacing(1, 1), "down-right");
  assert.equal(chaseFacing(-1, 1), "down-left");
  assert.equal(chaseFacing(1, -1), "up-right");
  assert.equal(chaseFacing(-1, -1), "up-left");
  assert.equal(chaseFacing(0, 0), "right", "no motion keeps a facing that draws");
});
