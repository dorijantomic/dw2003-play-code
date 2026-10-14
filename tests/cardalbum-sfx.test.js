// The Card Album's sound triggers, pinned to the shipped translated session's
// own cues and the overlay's call sites.
//
// pro/stcrdabm.s sites (RAM = file + 0x80082c70) and their ported homes in
// engine/dw3/ui/native:
//   album-tick (F0x80084d2c) — the grid: a changed cursor plays 0x0004001B
//     (file 0x229c/0x2630; album-tick.ts:246/310) and Cross plays the resident
//     cancel blip 0x800450BD (file 0x2684; album-tick.ts:316) then starts the
//     silent dim ramper (F0x80083008, no play call);
//   album-grid-object (F0x80083848) — the cursor object's settle tick plays
//     0x0004001C when the landed cell is a seen card (file 0x0d0c;
//     album-grid-object.ts:153).
// True Sound Test names (soundtst-common-ids.json): 0x0004001B = SYSTEM06,
// 0x0004001C = SYSTEM07, 0x800450BD = SYSTEM01. Corrected 2026-10-14
// (audit/sfx-triggers-vs-decode): the hand-authored screen played the
// pre-2026-07-03i shifted names, so the cancel was a list-move blip, opening
// the detail played the cancel blip, and leaving added a window-close cue the
// silent dim does not have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seeCard } from "../web/vendor/engine.js";
import { cards } from "../web/cardstate.js";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}

const albumUi = JSON.parse(readFileSync(new URL("../web/assets/data/stcrdabm_ui.json", import.meta.url)));
const { createCardAlbum, __setLayout } = await import("../web/cardalbum.js");
__setLayout(albumUi);

const man = JSON.parse(readFileSync("web/assets/sfx/manifest.json", "utf8"));

function withAlbum() {
  seeCard(cards(), 1);
  seeCard(cards(), 2);
  seeCard(cards(), 3);
  const played = [];
  const album = createCardAlbum({ play: (n) => played.push(n) });
  album.open();
  album.fadeEntering = false;
  played.length = 0;
  return { album, played };
}

test("the cue names resolve to the ids the sites carry", () => {
  assert.equal(man.system06.id, "0x0004001b");   // grid move
  assert.equal(man.system07.id, "0x0004001c");   // settle / detail
  assert.equal(man.system01.id, "0x800450bd");   // cancel
});

test("the grid moves play 0x4001b (SYSTEM06); a refused move is silent", () => {
  const { album, played } = withAlbum();
  album.cursor = 0;
  album.handleKey("right");
  assert.deepEqual(played, ["system06"], "landed on cell 1 (seen)");
  played.length = 0;
  album.cursor = 11;               // cell 11 holds card 12, unseen
  album.handleKey("right");
  assert.equal(album.cursor, 11, "no owned cell to land on: the walk restores");
  assert.deepEqual(played, [], "a refused move is silent");
});

test("Cross cancels with 0x450bd (SYSTEM01) and starts the silent dim", () => {
  const { album, played } = withAlbum();
  album.handleKey("cross");
  assert.deepEqual(played, ["system01"], "no fold-close cue: the dim is silent");
  assert.equal(album.fadeLeaving, true);
});

test("the detail popup opens and closes on the album's select tick 0x4001c", () => {
  const { album, played } = withAlbum();
  album.cursor = 0;                 // cell 0 holds card id 1, seen
  album.handleKey("circle");
  assert.equal(album.detailOpen, true);
  assert.deepEqual(played, ["system07"], "detail open");
  played.length = 0;
  album.handleKey("cross");
  assert.equal(album.detailOpen, false);
  assert.deepEqual(played, ["system07"], "detail close");
});
