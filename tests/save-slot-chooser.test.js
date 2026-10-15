// tests/save-slot-chooser.test.js — the slot chooser's entry animation and its
// two card-slot rows (web/save.js, the pro/stgmcard recreation).
//
// DECODED 2026-10-14 from pro/stgmcard.s: F0x800843D8 (tick + draw tail),
// F0x80084328 (reset), F0x80084240 (place cursor), F0x80084194 (set column) and
// F0x80084DCC's state 1/2 (the slot chooser), re-checked against the ported
// reference engine/dw3/ui/memcard-block-grid.ts + engine/dw3/ui/memcard-machine.ts.
// Those ports are proven against the original's own execution by
// tests/memcard-block-grid-oracle.test.js, which runs F0x800843D8 through
// engine/native and compares every ordered draw call and field — so the
// constants below are the original's own values, not a reading:
//
//   +0x5C/+0x64  cardsX    0xDE -> 0, 10 steps      the three cards + nameplates
//   +0x78/+0x80  stripY    -0x55 -> 0, 10 steps     the bar, console and header
//   +0x94/+0x9C  consoleX  0 -> 0x2F, 8 steps       the console's own slide-in
//   +0xB0/+0xB8  cursorX   previous*0x44 -> slot*0x44, 5 steps
//   console draw x = consoleX + cursorX + 0x30 (NOT the nameplate x slotX — the
//   2026-08-05 reading put slotX there and the walker inherited the 14px error)
//
// The entry runs the four tweens one at a time in that order, and left/right
// wait for the last one (substate 7 takes no pad). The two rows (F0x80084DCC
// state 1) are the YES/NO widgets set to esmemcrd 3 "{1}" and then numbered 1
// and 2; the cursor sits at (0xC2, 0xBD + 0x0E*row), and up picks row 1 / down
// picks row 2, a repeat of the same direction being silent.
//
// FAIL-BEFORE: on the previous revision every test here fails — s.grid does not
// exist (the console jumped straight to slotX[slot] with no slide, the entry
// was instant) and up/down were silent no-ops.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { __setLayout, createSaveScreen } from "../web/save.js";

const here = dirname(fileURLToPath(import.meta.url));
const LAYOUT = JSON.parse(
  readFileSync(join(here, "../web/assets/data/stgmcard_ui.json"), "utf8"),
);
__setLayout(LAYOUT);

function stubCtx() {
  const noop = () => {};
  return {
    save: noop, restore: noop, scale: noop, fillRect: noop, drawImage: noop,
    fillText: noop, measureText: () => ({ width: 0 }), set fillStyle(_v) {},
    set font(_v) {}, set globalAlpha(_v) {}, set globalCompositeOperation(_v) {},
    set imageSmoothingEnabled(_v) {},
  };
}

/** Run `n` frames of the screen at one draw per frame. */
function frames(s, n, dt = 1 / 60) {
  const ctx = stubCtx();
  for (let i = 0; i < n; i++) s.draw(ctx, 320, 240, {}, dt);
}

/** A screen plus a recorder for the packed-sound names it plays. */
function kit() {
  const played = [];
  return { s: createSaveScreen({ play: (n) => played.push(n) }), played };
}

test("the slot chooser starts its four tweens at the decoded entry poses", () => {
  const { s } = kit();
  s.open({}, "save");
  assert.equal(s.screen, "slots");
  // F0x80084328: reset writes every tween's start pose before anything ticks.
  assert.equal(s.grid.cardsX.value, 0xde);
  assert.equal(s.grid.stripY.value, -0x55);
  assert.equal(s.grid.consoleX.value, 0);
  assert.equal(s.grid.phase, "in-strip");
});

test("the entry runs the four tweens one at a time, in the decoded order", () => {
  const { s } = kit();
  s.open({}, "save");

  frames(s, 1);
  assert.ok(s.grid.stripY.value > -0x55 && s.grid.stripY.value < 0,
    "stripY advances first");
  assert.equal(s.grid.cardsX.value, 0xde, "and the cards hold their pose");

  frames(s, 9);                       // stripY: 10 steps
  assert.equal(s.grid.stripY.value, 0, "the bar/console/header land");
  assert.equal(s.grid.phase, "in-cards");
  assert.equal(s.grid.cardsX.value, 0xde);

  frames(s, 10);                      // cardsX: 10 steps
  assert.equal(s.grid.cardsX.value, 0, "the card grid has slid in");
  assert.equal(s.grid.phase, "in-console");

  frames(s, 8);                       // consoleX: 8 steps
  assert.equal(s.grid.consoleX.value, 0x2f, "the console's own slide lands");
  assert.equal(s.grid.phase, "in-cursor", "which is what arms the cursor");

  frames(s, 5);                       // cursorX: 5 steps
  assert.equal(s.grid.phase, "idle");
  assert.equal(s.grid.cursorX.value, 0, "slot 0: the cursor never moved");
  assert.equal(s.grid.cardsX.value + s.grid.stripY.value
    + s.grid.consoleX.value + s.grid.cursorX.value, 0x2f);
});

test("the console rests at consoleX + cursorX + 0x30, not at the nameplate x", () => {
  const { s } = kit();
  s.open({}, "save");
  frames(s, 40);
  // The decoded draw tail. At rest: 0x2F + slot*0x44 + 0x30. The old code drew
  // the console at slotX[slot] (= 0x6D + slot*0x44), which is 14px right.
  const rest = s.grid.consoleX.value + s.grid.cursorX.value + 0x30;
  assert.equal(rest, 0x2f + 0x30, "slot 0: 0x5F = 95");
  assert.notEqual(rest, LAYOUT.slot_select.slotX[0],
    "slotX is the nameplate x, and the console is not drawn there");
});

test("a slot move tweens the console over 5 frames instead of jumping", () => {
  const { s, played } = kit();
  s.open({}, "save");
  frames(s, 40);                      // entry lands
  assert.equal(s.grid.phase, "idle");

  s.handleKey("right");
  assert.equal(s.slot, 1);
  assert.equal(s.grid.phase, "move", "the cursor is still sliding");
  assert.deepEqual(played, ["system06"], "a real move plays the 0x4001B step");

  played.length = 0;
  s.handleKey("right");               // swallowed: substate 7 takes no pad
  assert.equal(s.slot, 1);
  assert.deepEqual(played, []);

  frames(s, 5);
  // 5 steps of the original's integer 8.8 arithmetic: delta = trunc(0x44<<8/5),
  // so the value reaches 0x43 after five ticks and clamps on the sixth.
  assert.equal(s.grid.phase, "move");
  assert.equal(s.grid.cursorX.value, 0x43);
  frames(s, 1);
  assert.equal(s.grid.phase, "idle");
  assert.equal(s.grid.cursorX.value, 0x44, "one column of 0x44 pixels");
  assert.deepEqual(played, []);

  // A second move runs from the landed column, not from zero.
  s.handleKey("right");
  assert.equal(s.slot, 2);
  frames(s, 6);
  assert.equal(s.grid.cursorX.value, 0x88);
  // And a move that cannot go anywhere is silent.
  s.handleKey("right");
  assert.equal(s.slot, 2);
  assert.equal(s.grid.phase, "idle");
});

test("the two rows are the console's card slots: up picks 1, down picks 2", () => {
  const { s, played } = kit();
  s.open({}, "save");
  assert.equal(s.grid.slotRow, 0, "the screen opens on row 1");

  s.handleKey("down");
  assert.equal(s.grid.slotRow, 1);
  assert.deepEqual(played, ["system02"], "the prompt's own up/down move sound");

  s.handleKey("down");                // the same row again: silent
  assert.deepEqual(played, ["system02"]);

  s.handleKey("up");
  assert.equal(s.grid.slotRow, 0);
  assert.deepEqual(played, ["system02", "system02"]);
});

test("the rows read the numbers the overlay binds: esmemcrd 3 filled 1 and 2", () => {
  // F0x80084DCC state 1: both widgets get string 3 ("{1}"), then the number
  // pass pushes 1 into the YES row and 2 into the NO row, at their own
  // positions. The walker draws exactly that pair.
  assert.equal(LAYOUT.strings.all[3], "{1}");
  const b = LAYOUT.message_window.binding;
  assert.deepEqual(b.yes.strings, [0x16, 3]);
  assert.deepEqual(b.no.strings, [0x17, 3]);
  const mw = LAYOUT.message_window;
  assert.deepEqual(mw.yes.xy, [207, 189]);
  assert.deepEqual(mw.no.xy, [207, 203]);
  // The cursor column: 0xC2, one 0x0E row apart (state 1's cursorPos call).
  assert.equal(mw.no.xy[1] - mw.yes.xy[1], 0x0e);
});

test("the console's CLUT ping-pong is 0..0xB and never reaches 0xC", () => {
  const { s } = kit();
  s.open({}, "save");
  const ctx = stubCtx();
  const seq = [];
  for (let i = 0; i < 200; i++) { s.draw(ctx, 320, 240, {}, 0.02); seq.push(s.grid.clutFrame); }
  // One sample per vsync: dedupe to the value run.
  const run = seq.filter((v, i) => i === 0 || v !== seq[i - 1]);
  assert.equal(Math.max(...seq), 0xb, "the 0xC threshold row is never drawn");
  assert.equal(seq.includes(0xc), false);
  assert.equal(seq.includes(0), true);
  // The first sample is already 1 (the counter's gate passes on the first
  // frame, as the original's does), so anchor on the first 0 — the bottom of
  // the first fall — and read the full climb-then-fall from there.
  const firstZero = run.indexOf(0);
  assert.ok(firstZero > 0, "the ramp climbs before it falls");
  assert.equal(run[firstZero + 1], 1, "the bottom turns around at 0");
  const up = Array.from({ length: 12 }, (_, i) => i);       // 0..0xB
  const down = Array.from({ length: 11 }, (_, i) => 10 - i); // 0xA..0
  assert.deepEqual(run.slice(firstZero, firstZero + 12), up, "0..0xB climbing");
  assert.deepEqual(run.slice(firstZero + 12, firstZero + 23), down, "then 0xA..0");
});

test("returning from the file card replays the entry, not a bare jump", () => {
  const { s } = kit();
  s.open({}, "save");
  frames(s, 40);
  s.handleKey("circle");              // slots -> file
  assert.equal(s.screen, "file");
  s.handleKey("escape");              // fold the card out
  frames(s, 20);                      // fold-out lands -> slots
  assert.equal(s.screen, "slots");
  assert.equal(s.grid.phase, "in-strip", "the grid reset for the return");
  assert.equal(s.grid.cardsX.value, 0xde, "and the cards are off to the right");
});
