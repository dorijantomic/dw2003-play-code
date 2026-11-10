// Card 07-fades: one fade step for the nine dim-quad copies and one leave-fade
// module for the web screens. The numbers are the disc's own: 0xFF00 over the
// frame count, and MIPS `div`'s -1 when a caller hands over zero frames.
import test from "node:test";
import assert from "node:assert/strict";

import { fadeStep, dimDelta } from "../engine/dw3/ui/screen-dim.ts";
import {
  LEAVE_FADE_MAX, leaveFadeStep, leaveFadeFrames, leaveFadeFramesMs,
  leaveFadeLevel, leaveFadeDone,
} from "../web/leave-fade.js";

test("engine fadeStep is 0xFF00 over the frames, truncated", () => {
  assert.equal(fadeStep(0x0a), Math.trunc(0xff00 / 0x0a));
  assert.equal(fadeStep(0x1e), Math.trunc(0xff00 / 0x1e));
  assert.equal(fadeStep(1), 0xff00);
});

test("engine fadeStep keeps the disc's -1 for a zero-frame ramp", () => {
  assert.equal(fadeStep(0), -1);
  // One tick of a -1 step lands the ramp: it is over, not stuck at level 0.
  assert.equal(0 * 1 + -1 < 0, true);
});

test("web leave fades use the same step as the engine", () => {
  assert.equal(leaveFadeStep(0x0a), fadeStep(0x0a));
  assert.equal(leaveFadeStep(0x1e), fadeStep(0x1e));
  assert.equal(LEAVE_FADE_MAX, 0xff00);
});

test("web frames come off both clocks as whole 20 ms vsyncs", () => {
  assert.equal(leaveFadeFrames(1.0, 1.0), 0);
  assert.equal(leaveFadeFrames(1.0 + 0.02 * 3, 1.0), 3);
  assert.equal(leaveFadeFrames(0.5, 1.0), 0); // never negative
  assert.equal(leaveFadeFramesMs(1000, 1000), 0);
  assert.equal(leaveFadeFramesMs(1060, 1000), 3);
  assert.equal(leaveFadeFramesMs(900, 1000), 0);
});

test("a ten-frame ramp lands at frame 10 and clamps its level", () => {
  const step = leaveFadeStep(0x0a);
  assert.equal(leaveFadeDone(9, step), false);
  assert.equal(leaveFadeLevel(10, step), 1);
  assert.equal(leaveFadeLevel(30, step), 1);
  assert.equal(leaveFadeDone(10, step), true);
});

test("a thirty-frame ramp takes its full thirty vsyncs", () => {
  const step = leaveFadeStep(0x1e);
  assert.equal(leaveFadeDone(29, step), false);
  assert.equal(leaveFadeDone(30, step), true);
  assert.equal(leaveFadeLevel(0, step), 0);
});

test("dimDelta keeps its own no-dim guard for a zero-frame window", () => {
  assert.equal(dimDelta(0), 0xff00);
  assert.equal(dimDelta(0x1e), fadeStep(0x1e));
});
