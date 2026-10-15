// The MEMORY CARD screen's blips, pinned to pro/stgmcard.s's own call sites.
//
// stgmcard.s has 17 play sites (`lw $v0,0x5c48($v0)` … `ori $a0,<id>`; RAM =
// file + 0x80082cb0, the overlay's own load base in
// recovered/ddw3/function-inventory.json). By id:
//   0x0004001b SYSTEM06 — the block view's changed left/right step, file
//     0x1a94 (F0x800843d8; the play is gated `beq $v0,$v1` on the slot index,
//     so a clamped press is silent)
//   0x8004513e SYSTEM02 — a two-row prompt's up/down move: files 0x275c
//     (slot picker), 0x3460 (overwrite prompt), 0x3fa8 (result prompt)
//   0x8004503c SYSTEM00 — a prompt's Circle: files 0x28bc, 0x3500, 0x4024
//   0x800450bd SYSTEM01 — a Cross back/cancel: files 0x2910, 0x3004, 0x35c4,
//     0x41dc
//   0x0004001c SYSTEM07 — the card/file list's Circle: file 0x2e70 (state
//     0x21), plus the result-window dismisses 0x3ab0 / 0x3bb4 / 0x4324
//     (states 0x1F5/0x1F6/0x65)
//   0x00040019 / 0x0004001a SYSTEM03/SYSTEM04 — the window fold open/shut,
//     files 0x5250 / 0x5280 (F0x80087edc)
//
// The walker's first wiring used the pre-2026-07-03i shifted cue names, so its
// confirms played "system01" (0x800450bd, the back cue) and its backs
// "system02" (0x8004513e, a cursor move). Fixed 2026-10-14 on
// audit/sfx-save-pause-vs-decode; the save-write states (0x32-0x35) carry no
// play site, so the adapters' write-time blips are gone too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { __setLayout, createSaveScreen, readSlot } from "../web/save.js";
import { __clearStore } from "../web/save.js";

const LAYOUT = JSON.parse(
  readFileSync(new URL("../web/assets/data/stgmcard_ui.json", import.meta.url), "utf8"),
);
__setLayout(LAYOUT);

const MANIFEST = JSON.parse(
  readFileSync(new URL("../web/assets/sfx/manifest.json", import.meta.url), "utf8"),
);

function mockSfx() {
  const plays = [];
  return { plays, play: (n) => plays.push(n) };
}

test("the names this screen plays resolve to the overlay's own packed ids", () => {
  // Names come from the disc's list (docs/research/audio/soundtst-common-ids.json);
  // the manifest is the walker's name -> id table.
  assert.equal(MANIFEST.system06.id, "0x0004001b");
  assert.equal(MANIFEST.system07.id, "0x0004001c");
  assert.equal(MANIFEST.system00.id, "0x8004503c");
  assert.equal(MANIFEST.system01.id, "0x800450bd");
  assert.equal(MANIFEST.system02.id, "0x8004513e");
  assert.equal(MANIFEST.system03.id, "0x00040019");
  assert.equal(MANIFEST.system04.id, "0x0004001a");
});

test("the slot list's left/right plays 0x0004001b only on a real change", () => {
  __clearStore();
  const sfx = mockSfx();
  const s = createSaveScreen(sfx);
  s.open({}, "save");
  // The chooser's entry animation runs first; left/right are read only once it
  // lands (F0x800843D8 substate 7 takes no pad — decoded 2026-10-14), so the
  // frames have to pass before the presses, exactly as they do in play.
  settleSlots(s);
  assert.equal(s.slot, 0);
  s.handleKey("left");                        // clamped at card 0 — silent
  assert.deepEqual(sfx.plays, [], `plays=${sfx.plays}`);
  s.handleKey("right");
  assert.deepEqual(sfx.plays, ["system06"]);
  settleSlots(s);
  s.handleKey("right");
  assert.deepEqual(sfx.plays, ["system06", "system06"]);
  settleSlots(s);
  s.handleKey("right");                       // clamped at card 2 — silent
  assert.deepEqual(sfx.plays, ["system06", "system06"], `plays=${sfx.plays}`);
  __clearStore();
});

test("slots -> file plays the card list's Circle (0x0004001c) and the fold open cue", () => {
  __clearStore();
  const sfx = mockSfx();
  const s = createSaveScreen(sfx);
  s.open({}, "save");
  s.handleKey("circle");
  assert.equal(s.screen, "file");
  assert.deepEqual(sfx.plays, ["system07", "system03"], `plays=${sfx.plays}`);
  __clearStore();
});

test("file -> confirm plays the confirm cue; backs play 0x800450bd", () => {
  __clearStore();
  const sfx = mockSfx();
  const s = createSaveScreen(sfx);
  s.open({}, "save");
  s.handleKey("circle");                      // slots -> file
  s.handleKey("circle");                      // file -> confirm
  assert.equal(s.screen, "confirm");
  assert.deepEqual(sfx.plays, ["system07", "system03", "system07"]);
  // A refused press on the prompt's two rows: both rows' Circle is 0x8004503c.
  s.handleKey("down");
  assert.equal(s.yesNo, 1);
  s.handleKey("circle");                      // NO -> back to the file card
  assert.equal(s.screen, "file");
  assert.deepEqual(sfx.plays.at(-1), "system00");
  // Back from the file card: the Cross cue and the fold shut, in that order.
  s.handleKey("cross");
  assert.deepEqual(sfx.plays.slice(-2), ["system01", "system04"]);
  // The fold-out lands (only then does the card fall back to the slot list),
  // and back from the slot list is the Cross cue again — with no fold.
  let frames = 0;
  while (s.screen === "file" && frames < 100) { s.draw(stubCtx(), 320, 240); frames += 1; }
  assert.equal(s.screen, "slots");
  s.handleKey("cross");
  assert.deepEqual(sfx.plays.at(-1), "system01");
  __clearStore();
});

function stubCtx() {
  const noop = () => {};
  return {
    save: noop, restore: noop, scale: noop, fillRect: noop, drawImage: noop,
    fillText: noop, measureText: () => ({ width: 0 }), set fillStyle(_v) {},
    set font(_v) {}, set globalAlpha(_v) {}, set globalCompositeOperation(_v) {},
    set imageSmoothingEnabled(_v) {},
  };
}

/** Run the slot chooser's entry animation out (left/right wait for it). */
function settleSlots(s) {
  const ctx = stubCtx();
  for (let i = 0; i < 60 && s.screen === "slots" && s.grid.phase !== "idle"; i++) {
    s.draw(ctx, 320, 240);
  }
}

test("YES commits with 0x8004503c and the result window dismisses with 0x0004001c", () => {
  __clearStore();
  const sfx = mockSfx();
  const s = createSaveScreen(sfx);
  s.open({ playerName: "Kai", bits: 1, party: [], partyStats: [], playSeconds: 0 }, "save");
  s.handleKey("circle");                      // slots -> file
  s.handleKey("circle");                      // file -> confirm
  s.handleKey("circle");                      // YES
  assert.equal(s.screen, "message");
  assert.equal(s.message, LAYOUT.strings.all[9]);   // "Saved."
  assert.deepEqual(sfx.plays.at(-1), "system00");
  assert.ok(readSlot(0), "the write still lands");
  s.handleKey("circle");                      // dismiss the result
  assert.deepEqual(sfx.plays.at(-1), "system07");
  __clearStore();
});

test("an empty load's Circle is the card list's cue, then the result dismiss", () => {
  __clearStore();
  const sfx = mockSfx();
  const s = createSaveScreen(sfx);
  s.open({}, "load");
  s.handleKey("circle");                      // slots -> file
  s.handleKey("circle");                      // no data -> message
  assert.equal(s.screen, "message");
  assert.equal(s.message, "No data here.");
  assert.deepEqual(sfx.plays, ["system07", "system03", "system07"], `plays=${sfx.plays}`);
  __clearStore();
});

test("the shipped adapters no longer play a blip at the save write", () => {
  // The overlay's write states carry no play site; the machine's own cues
  // (prompt Circle 0x8004503c, result dismiss 0x0004001c) are the sounds the
  // player hears around the write. The adapters used to play "system01"
  // (0x800450bd — a back) when the image landed.
  for (const file of ["web/save-translated.js", "web/save-native.js"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!/sfx\?\.play\("system01"\)/.test(src), `${file} still plays the back cue at the write`);
    assert.ok(!/sfx\?\.play\("savedemo"\)/.test(src), `${file} plays the save jingle`);
  }
});
