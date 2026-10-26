// The quest scenes' atmosphere steps: `shake`, `weather`, `time`, `lightning` (web/quest-scenes.js compiles them into host
// events; web/quest-fx.js runs the shake; web/ambience.js runs the weather/time/lightning override, which needs a browser --
// that half is played live in tools/verify_quest_sky.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { compileScene, castOf, validateScene } from "../web/quest-scenes.js";
import { questFxShake, questFxShakeOffset, questFxShakeState, questFxShaking, questFxClear, questFxTick } from "../web/quest-fx.js";

const pos = () => ({ x: 0, y: 0 });
const tickFrames = (n) => { for (let i = 0; i < n; i++) questFxTick(1 / 60); };
const evOf = (steps) => compileScene(steps, { playerId: 2, pos });

test("shake compiles to one event: amplitude, length, and the thuds' spacing", () => {
  const { events, opcodes, errors } = evOf([{ shake: 6, frames: 20 }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(events, [{ kind: "shake", amp: 6, frames: 20 }]);
  assert.deepEqual(opcodes, ["FN6A 1 2", "SCENEEVENT 0", "END"]);

  const thuds = evOf([{ shake: 5, every: 24, times: 4, decay: false }]).events[0];
  assert.deepEqual(thuds, { kind: "shake", amp: 5, frames: 20, decay: false, every: 24, times: 4 });
  assert.deepEqual(evOf([{ shake: 3, times: 2 }]).events[0], { kind: "shake", amp: 3, frames: 20, every: 20, times: 2 });
});

test("a malformed shake is reported, never guessed", () => {
  assert.ok(validateScene([{ shake: 0 }]).length, "an amplitude of zero is not a shake");
  assert.ok(validateScene([{ shake: 90 }]).length, "40 px is the ceiling");
  assert.ok(validateScene([{ shake: "lots" }]).length);
  assert.ok(validateScene([{ shake: 4, times: 40 }]).length, "more than 12 thuds is a typo");
});

test("weather compiles to one event, with its strength, its fade and force", () => {
  const { events, errors } = evOf([{ weather: "fog", strength: 0.9, frames: 60 }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(events, [{ kind: "weather", weather: "fog", strength: 0.9, frames: 60 }]);
  assert.equal(evOf([{ weather: "clear" }]).events[0].strength, 0.75, "the default strength");
  assert.equal(evOf([{ weather: "storm", force: true }]).events[0].force, true);
  for (const w of ["rain", "storm", "snow", "blizzard", "sand", "leaves", "fireflies", "clear", "fog"]) {
    assert.deepEqual(validateScene([{ weather: w }]), [], w);
  }
  assert.ok(validateScene([{ weather: "hail" }]).length);
  assert.ok(validateScene([{ weather: "rain", strength: "lots" }]).length);
});

test("time compiles to one event and only takes the four times of day", () => {
  const { events, errors } = evOf([{ time: "night", frames: 90 }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(events, [{ kind: "time", time: "night", frames: 90 }]);
  assert.deepEqual(evOf([{ time: "day" }]).events[0], { kind: "time", time: "day", frames: 60 });
  assert.equal(evOf([{ time: "dusk", force: true }]).events[0].force, true);
  assert.ok(validateScene([{ time: "midnight" }]).length);
});

test("lightning compiles to a flash count and refuses silly counts", () => {
  assert.deepEqual(evOf([{ lightning: 1 }]).events, [{ kind: "lightning", count: 1 }]);
  assert.deepEqual(evOf([{ lightning: true }]).events, [{ kind: "lightning", count: 1 }]);
  assert.deepEqual(evOf([{ lightning: 2 }]).events, [{ kind: "lightning", count: 2 }]);
  assert.ok(validateScene([{ lightning: 0 }]).length);
  assert.ok(validateScene([{ lightning: 12 }]).length);
});

test("the four steps keep their place in a mixed scene and block nothing else", () => {
  const { opcodes, events, speech, errors } = evOf([
    { say: 1005, name: "Cipher", text: "Query: watch." },
    { shake: 4, every: 20, times: 3 },
    { weather: "fog", strength: 0.8 },
    { time: "night" },
    { lightning: 1 },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(events.map((e) => e.kind), ["shake", "weather", "time", "lightning"]);
  assert.deepEqual(opcodes, [
    "FN6A 1 2", "SAY 0 1 1005 0", "WAITCTX",
    "SCENEEVENT 0", "SCENEEVENT 1", "SCENEEVENT 2", "SCENEEVENT 3", "END",
  ]);
  assert.ok(speech["1"]);
});

test("a shake moves the field, dies out, and leaves nothing behind", () => {
  const offsets = [];
  const done = questFxShake({ amp: 8, frames: 12 });
  assert.equal(questFxShaking(), true);
  assert.ok(questFxShakeState());
  for (let i = 0; i < 6; i++) { questFxTick(1 / 60); offsets.push(questFxShakeOffset()); }
  assert.ok(offsets.some((o) => o.x !== 0 || o.y !== 0), "the offset moves the field while the shake runs");
  assert.ok(offsets.every((o) => Math.abs(o.x) <= 8 && Math.abs(o.y) <= 8), "never past its amplitude");
  tickFrames(10);
  assert.deepEqual(questFxShakeOffset(), { x: 0, y: 0 }, "nothing is left after the last frame");
  assert.equal(questFxShaking(), false);
  assert.equal(questFxShakeState(), null);
  return done;
});

test("thuds come every `every` frames, with quiet between them, and the wait covers them all", async () => {
  const total = 2 * 20 + 8;
  const done = questFxShake({ amp: 6, frames: 8, every: 20, times: 3 });
  assert.equal(questFxShakeState().total, total);
  questFxTick(2 / 60);                       // frame 2: the first thud is running
  assert.ok(Math.abs(questFxShakeOffset().x) + Math.abs(questFxShakeOffset().y) > 0);
  tickFrames(11);                            // frame 14: between thud 1 (0..7) and thud 2 (20..27)
  assert.deepEqual(questFxShakeOffset(), { x: 0, y: 0 }, "the gap between footsteps is still");
  tickFrames(8);                             // frame 22: the second foot is down
  assert.ok(Math.abs(questFxShakeOffset().x) + Math.abs(questFxShakeOffset().y) > 0);
  tickFrames(total);                         // let the last thud finish
  await done;
  assert.equal(questFxShaking(), false);
});

test("clear() ends a shake at once, and a scene never waits on one that was replaced", async () => {
  const first = questFxShake({ amp: 6, frames: 30 });
  const second = questFxShake({ amp: 3, frames: 10 });
  await first;                               // superseded: resolves at once
  assert.equal(questFxShakeState().total, 10, "the newer batch is the one running");
  questFxClear();
  await second;
  assert.deepEqual(questFxShakeOffset(), { x: 0, y: 0 });
  assert.equal(questFxShaking(), false);
});

test("castOf is unchanged by the atmosphere steps (they name nobody)", () => {
  assert.deepEqual(castOf([{ shake: 4 }, { weather: "fog" }, { time: "night" }, { lightning: 1 }]), []);
});
