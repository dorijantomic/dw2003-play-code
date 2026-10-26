// The quest scenes' own effects (web/quest-fx.js): our sprite sheets placed on the map, their motions, the screen fade
// and the player's Y drive. No browser needed: the sheet is registered directly and the clock is stepped by hand.
import test from "node:test";
import assert from "node:assert/strict";
import {
  defineQuestFxSheet, questFxSpawn, questFxPlay, questFxMove, questFxRemove, questFxWait, questFxClear,
  questFxTick, questFxDrawables, questFxState, questFxDrivePlayer, questFxDriveState, installQuestFxPlayerDrive,
  questFxFade, questFxFadeAlpha, questFxSheetInfo,
} from "../web/quest-fx.js";

const SHEET = {
  name: "test",
  frame: [16, 16],
  anchor: [0.5, 1],
  clips: {
    fall: { frames: [0, 1], hold: 2, loop: true },
    land: { frames: [2, 3], hold: 4 },
    still: { frames: [4], hold: 30 },
  },
  default: "still",
};
const fakeImage = { naturalWidth: 16, naturalHeight: 16 };

/** 30 blanks at 60 Hz = half a second. */
const tickFrames = (n) => { for (let i = 0; i < n; i++) questFxTick(1 / 60); };

test.beforeEach(() => {
  questFxClear();
  defineQuestFxSheet("test", SHEET, fakeImage);
});

test("a sheet registers and a step places its first cell", () => {
  assert.deepEqual(questFxSheetInfo("test").frame, [16, 16]);
  const fx = questFxSpawn({ kind: "fx", name: "crate", sheet: "test", x: 100, y: 200 });
  assert.ok(fx);
  const [state] = questFxState();
  assert.equal(state.name, "crate");
  assert.deepEqual([state.x, state.y], [100, 200]);
  assert.equal(state.clip, "still", "the sheet's default clip plays");
});

test("a fall adds a step to the velocity each blank, bounces as -v/3 and settles on the floor", () => {
  questFxSpawn({ name: "crate", sheet: "test", x: 40, y: 0, clip: "fall", fall: { floor: 120, step: 4 } });
  const ys = [];
  for (let i = 0; i < 60; i++) { questFxTick(1 / 60); ys.push(questFxState()[0].y); }
  const settled = questFxState()[0];
  assert.equal(settled.moving, null, "the motion is over");
  assert.equal(settled.y, 120, "it rests exactly on the floor");
  const first = ys.slice(0, 6);
  assert.ok(first[5] > first[0], "it accelerates downward");
  assert.ok(Math.max(...ys) >= 120, "it reached the floor");
  assert.ok(ys.some((y, i) => i > 0 && y < ys[i - 1]), "and rebounded at least once (a bounce)");
});

test("fxwait resolves when the motion is over and at once for an effect that cannot be placed", async () => {
  questFxSpawn({ name: "crate", sheet: "test", x: 0, y: 0, fall: { floor: 30, step: 3 } });
  let done = false;
  const waited = questFxWait("crate").then(() => { done = true; });
  tickFrames(4);
  assert.equal(done, false, "still falling");
  tickFrames(40);
  await waited;
  assert.equal(done, true);
  // a scene must never hang on art it does not have
  await questFxWait("nothing-here");
  questFxSpawn({ name: "ghost", sheet: "missing-sheet", x: 0, y: 0 });
  assert.equal(questFxSpawn({ name: "ghost2", sheet: "missing-sheet", x: 0, y: 0 }), null, "a missing sheet places nothing");
  await questFxWait("ghost2");
  assert.equal(questFxState().length, 1, "only the real effect is on the map");
});

test("clips walk their frames on the hold and a clip without loop holds its last frame", () => {
  questFxSpawn({ name: "crate", sheet: "test", x: 0, y: 0, clip: "land" });
  const frames = [];
  for (let i = 0; i < 14; i++) { questFxTick(1 / 60); frames.push(questFxState()[0].frame); }
  assert.deepEqual([...new Set(frames)], [2, 3], "it played both cells of the clip");
  assert.equal(frames.at(-1), 3, "and stopped on the last one (no loop)");
  questFxPlay({ name: "crate", clip: "fall", loop: false });
  questFxTick(4 / 60);
  assert.notEqual(questFxState()[0].clip, "land", "fxplay switched the clip");
});

test("slide arrives on its point, rise lifts, and both finish their own motion", () => {
  questFxSpawn({ name: "s", sheet: "test", x: 0, y: 100, slide: { to: [40, 160], frames: 10 } });
  tickFrames(12);
  assert.deepEqual([questFxState()[0].x, questFxState()[0].y], [40, 160]);
  assert.equal(questFxState()[0].moving, null);
  questFxMove({ name: "s", rise: { pixels: 50, frames: 5 } });
  tickFrames(6);
  assert.equal(questFxState()[0].y, 110);
});

test("a fade-out takes the effect off the map when it ends", async () => {
  questFxSpawn({ name: "shard", sheet: "test", x: 0, y: 0, slide: { to: [10, 0], frames: 2 } });
  tickFrames(4);
  let gone = false;
  const waited = questFxWait("shard").then(() => { gone = true; });
  await waited;                                        // settled: nothing to wait for
  questFxRemove({ name: "shard", fade: 6 });
  tickFrames(2);
  assert.ok(questFxState().length === 0 || questFxState()[0].alpha < 1, "it is fading");
  tickFrames(8);
  assert.deepEqual(questFxState(), [], "and is gone, with nothing left behind");
  assert.equal(gone, true);
});

test("questFxClear leaves no art and no fade: the cleanup every scene exit runs", () => {
  questFxSpawn({ name: "a", sheet: "test", x: 1, y: 2 });
  questFxSpawn({ name: "b", sheet: "test", x: 3, y: 4 });
  questFxFade("black");
  assert.equal(questFxDrawables(0, 0).length, 2);
  questFxClear();
  assert.deepEqual(questFxState(), []);
  assert.deepEqual(questFxDrawables(0, 0), [], "the draw list is empty, so nothing can be drawn on the next map");
  assert.equal(questFxFadeAlpha(), 0, "and the screen fade is gone too");
});

test("the drop drives the field character's own Y, blank by blank, and resolves when it has gone the distance", async () => {
  const added = [];
  installQuestFxPlayerDrive((fixed) => added.push(fixed));
  let done = false;
  const drive = questFxDrivePlayer(100, 1).then(() => { done = true; });
  assert.equal(done, false);
  assert.ok(questFxDriveState(), "a drive is running");
  tickFrames(40);
  await drive;
  assert.equal(done, true);
  const totalPx = added.reduce((sum, fixed) => sum + fixed / 256, 0);
  assert.ok(Math.abs(totalPx - 100) < 1.5, `the character descended ~100 px (${totalPx.toFixed(2)})`);
  assert.equal(questFxDriveState(), null, "and no drive is left running");
  installQuestFxPlayerDrive(null);
  await questFxDrivePlayer(50);                        // no host drive: skipped at once, never waited on
});

test("the screen fade reaches its target and resolves", async () => {
  const out = questFxFade("out", 12);
  assert.equal(questFxFadeAlpha(), 0);
  for (let i = 0; i < 20; i++) questFxTick(1 / 60);
  await out;
  assert.equal(questFxFadeAlpha(), 1);
  const back = questFxFade("in", 12);
  for (let i = 0; i < 20; i++) questFxTick(1 / 60);
  await back;
  assert.equal(questFxFadeAlpha(), 0);
});
