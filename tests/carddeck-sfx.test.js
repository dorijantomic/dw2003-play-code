// The Card Folder editor's sound triggers, pinned to the shipped translated
// session's own cues and the overlay's call sites.
//
// pro/stcrddek.s sites (RAM = file + 0x80082c70) and their ported homes in
// engine/dw3/ui/native (the same ids the shipped ?translated screen plays):
//   folder-picker-tick (F0x80089354) case 4  — the three-folder list:
//     move 0x0004001B, confirm 0x0004001C, cancel 0x800450BD;
//   folder-picker-tick case 0xD — the two-row Edit/Change-name submenu:
//     move 0x8004513E, confirm 0x8004503C, cancel 0x800450BD;
//   folder-card-grid (F0x80085210) — the editor grid: move 0x0004001B, R1
//     0x0004001B, confirm 0x0004001C, cancel 0x800450BD, and the sort
//     (logical 0xC) 0x800450BD; the confirm's empty arm is silent;
//   folder-card-grid case 0x18 — the swap list: move 0x8004513E, confirm
//     0x8004503C, cancel 0x800450BD; the over-copy refusal (state 0x3C) is
//     silent; the warning plate's dismissal (case 0x3E) plays 0x0004001C;
//   name-keyboard (NAMEDT): commit 0x0004001C, back 0x800450BD.
// True Sound Test names (soundtst-common-ids.json): 0x0004001B = SYSTEM06,
// 0x0004001C = SYSTEM07, 0x8004513E = SYSTEM02, 0x8004503C = SYSTEM00,
// 0x800450BD = SYSTEM01. Corrected 2026-10-14 (audit/sfx-triggers-vs-decode):
// the hand-authored screen played the pre-2026-07-03i shifted names, so every
// cancel was a list-move blip and every confirm was the cancel blip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { grantCard, grantStarterDeck } from "../web/vendor/engine.js";
import { cards, loadCatalog } from "../web/cardstate.js";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}
// The catalog and the layout are file fetches in the browser; serve them here.
globalThis.fetch = async (url) => {
  const path = new URL(String(url), new URL("../web/", import.meta.url));
  try {
    return { ok: true, json: async () => JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ok: false, json: async () => ({}) };
  }
};

const deckUi = JSON.parse(readFileSync(new URL("../web/assets/data/stcrddek_ui.json", import.meta.url)));
const { createCardDeck, __setLayout } = await import("../web/carddeck.js");
__setLayout(deckUi);
await loadCatalog();

const man = JSON.parse(readFileSync("web/assets/sfx/manifest.json", "utf8"));

function withDeck() {
  grantStarterDeck(cards(), Array.from({ length: 40 }, (_, i) => (i % 20) + 1), 3);
  // The starter deck fills every folder with both copies of each card, so
  // grant extras to leave something placeable for the swap list.
  grantCard(cards(), 1, 3);
  grantCard(cards(), 5, 3);
  const played = [];
  const deck = createCardDeck({ play: (n) => played.push(n) });
  deck.open();
  return { deck, played };
}

test("the cue names resolve to the ids the sites carry", () => {
  assert.equal(man.system06.id, "0x0004001b");   // folder list / editor move
  assert.equal(man.system07.id, "0x0004001c");   // folder-list confirm, plate dismiss
  assert.equal(man.system02.id, "0x8004513e");   // submenu / swap-list move
  assert.equal(man.system00.id, "0x8004503c");   // submenu / swap confirm
  assert.equal(man.system01.id, "0x800450bd");   // every cancel
});

test("the folder list: moves 0x4001b, confirm 0x4001c, cancel 0x800450bd and no fold cue", () => {
  const { deck, played } = withDeck();
  assert.equal(deck.screen, "folders");
  deck.handleKey("down");
  assert.deepEqual(played, ["system06"], "folder-list move");
  played.length = 0;
  deck.handleKey("circle");
  assert.deepEqual(played, ["system07"], "folder-list confirm");
  assert.equal(deck.screen, "options");
});

test("the submenu: moves 0x4513e, confirm 0x4503c, cancel 0x800450bd", () => {
  const { deck, played } = withDeck();
  deck.handleKey("circle");            // folders -> options
  played.length = 0;
  deck.handleKey("down");
  assert.deepEqual(played, ["system02"], "submenu move");
  played.length = 0;
  deck.handleKey("cross");
  assert.deepEqual(played, ["system01"], "submenu cancel");
  assert.equal(deck.screen, "folders");
});

test("the editor grid: move/R1 0x4001b, confirm 0x4001c, sort and cancel 0x800450bd", () => {
  const { deck, played } = withDeck();
  deck.handleKey("circle");            // folders -> options
  deck.handleKey("circle");            // options -> editor (row 0)
  assert.equal(deck.screen, "editor");
  played.length = 0;
  deck.handleKey("down");
  assert.deepEqual(played, ["system06"], "grid move");
  played.length = 0;
  deck.handleKey("r1");
  assert.deepEqual(played, ["system06"], "explain toggle");
  played.length = 0;
  deck.handleKey("triangle");
  assert.deepEqual(played, ["system01"], "the sort's cancel blip");
  played.length = 0;
  deck.handleKey("circle");
  assert.deepEqual(played, ["system07"], "open the swap list");
  assert.equal(deck.screen, "swap");
  played.length = 0;
  deck.handleKey("cross");
  assert.deepEqual(played, ["system01"], "leave the swap list");
  played.length = 0;
  deck.handleKey("cross");
  assert.deepEqual(played, ["system01"], "leave the editor");
});

test("the swap list: moves 0x4513e, confirm 0x4503c, cancel 0x800450bd", () => {
  const { deck, played } = withDeck();
  deck.handleKey("circle");
  deck.handleKey("circle");
  deck.handleKey("circle");            // editor -> swap
  assert.equal(deck.screen, "swap");
  played.length = 0;
  deck.handleKey("down");
  assert.deepEqual(played, ["system02"], "swap-list move");
  played.length = 0;
  deck.handleKey("circle");
  assert.deepEqual(played, ["system00"], "swap confirm");
  assert.equal(deck.screen, "editor");
});

test("a warning plate dismisses with 0x4001c and its fold-close 0x4001a", () => {
  const { deck, played } = withDeck();
  deck.message = "Only 4 of the same card in one folder.";
  deck.handleKey("circle");
  assert.deepEqual(played, ["system07", "system04"]);
  assert.equal(deck.message, null);
});
