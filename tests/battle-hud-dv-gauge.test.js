// The browser adapter for the in-battle DV/Blast gauge
// (web/battlehud-translated.js) must hand the painter the original's own four pieces:
// the two frame cels at (260, 61), the black trough from 265 + gauge/25 to 305 and the
// fill at (265, 62) — and no trough at all once the gauge is full.
//
// The arithmetic itself is pinned against the original in tests/lane-b/battle-hud.test.js;
// this file covers the adapter's translation of the walker's state into the port's
// memory and the pixels it derives.
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  battleHudDvFrame, battleHudDvGeometry,
} = await import("../web/battlehud-translated.js");

test("the adapter draws the original's four gauge pieces at the original's places", () => {
  const frame = battleHudDvFrame({ gauge: 500, tick: 8, slot: 0 });
  assert.equal(frame.gauge, 500);
  assert.equal(frame.phase, 2, "(8 >> 2) & 3");
  assert.equal(frame.fillCel, 0x33 + 2);
  assert.deepEqual(frame.outer, { cel: 0x1e, x: 260, y: 61 });
  assert.deepEqual(frame.inner, { cel: 0x0b, x: 260, y: 61 });
  assert.equal(frame.backing, true);
  assert.deepEqual(frame.trough, {
    x: 285, y: 62, w: 20, h: 8,
    rgb: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  });
  assert.deepEqual(frame.fill, { x: 265, y: 62, width: 20 });
});

test("the trough grows left as the gauge fills and vanishes at full", () => {
  const leftOf = (gauge) => battleHudDvFrame({ gauge }).trough.x;
  assert.deepEqual([0, 250, 500, 750, 999].map(leftOf), [265, 275, 285, 295, 304]);
  assert.deepEqual([0, 250, 500, 750, 999].map((g) => battleHudDvFrame({ gauge: g }).fill.width),
    [0, 10, 20, 30, 39]);
  const full = battleHudDvFrame({ gauge: 1000, tick: 0 });
  assert.equal(full.backing, false, "at the full gauge the black trough is not submitted");
  assert.equal(full.fillCel, 0x37);
  assert.deepEqual(full.fill, { x: 265, y: 62, width: 40 });
  const over = battleHudDvFrame({ gauge: 1001, tick: 1 });
  assert.equal(over.backing, false);
  assert.equal(over.fillCel, 0x37);
});

test("the fill cycles once every four frames and never with the gauge's value", () => {
  const celAt = (gauge, tick) => battleHudDvFrame({ gauge, tick }).fillCel;
  assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 15, 16].map((t) => celAt(500, t)),
    [0x33, 0x33, 0x33, 0x33, 0x34, 0x34, 0x35, 0x36, 0x33]);
  // The same tick gives the same phase whatever the gauge reads, so the bar does not
  // blink, pulse or flash at any value. Only the base moves, once, at full.
  for (const tick of [0, 4, 8, 12]) {
    assert.deepEqual([0, 100, 500, 999, 1000].map((g) => battleHudDvFrame({ gauge: g, tick }).phase),
      [0, 0, 0, 0, 0].map(() => battleHudDvFrame({ gauge: 500, tick }).phase));
  }
  assert.deepEqual([0, 4, 8, 12].map((t) => battleHudDvFrame({ gauge: 500, tick: t }).phase), [0, 1, 2, 3]);
  assert.deepEqual([0, 100, 500, 999, 1000].map((g) => celAt(g, 8)), [0x35, 0x35, 0x35, 0x35, 0x39]);
});

test("each party member's gauge is the halfword the original reads for that member", () => {
  // .L0x80093880/.L0x80093884 scale the member index by two over 0x80042b1c and read
  // +0x58, so the port must answer the same member the walker's active slot names.
  for (const slot of [0, 1, 2]) {
    assert.equal(battleHudDvFrame({ gauge: 250 + slot * 100, slot }).trough.x, 275 + slot * 4);
  }
});

test("the decoded placement is the original's literals", () => {
  assert.deepEqual(battleHudDvGeometry(), {
    frame: {
      outer: { cel: 0x1e, x: 260, y: 61 },
      inner: { cel: 0x0b, x: 260, y: 61 },
    },
    fill: { x: 265, y: 62, widthPx: 40, baseCels: [0x33, 0x37] },
  });
});