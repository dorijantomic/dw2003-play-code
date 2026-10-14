// The Card Shop's blips, pinned to pro/stcrdshp.s's own call sites.
//
// The overlay's play sites (RAM = file + 0x80082cb0) fall in four functions:
//   F0x8008838C (the root selection machine, native/card-shop-tick.ts):
//     move 0x8004513E (file 0x5948), Circle 0x8004503C (0x59c4), Cross
//     0x800450BD (0x5a1c); the popup that follows a refused root pick is
//     silent (no site in states 0x64/0x65).
//   F0x80086DC4 (the buy controller, card-shop-session.ts tickBuy):
//     card-grid moves 0x0004001B (0x43a4/0x4510), card Circle 0x0004001C
//     (0x4724), Cross 0x800450BD (0x47d8), prompt move 0x8004513E (0x49c0),
//     prompt Circle 0x8004503C (0x4a34), prompt Cross 0x800450BD (0x4adc),
//     refusal-window cue 0x0004001C (0x4c5c).
//   F0x800844B8 (the booster controller, tickBooster): list moves 0x8004513E
//     (0x1ad0/0x1dd0), Circle 0x8004503C (0x1eac), Cross 0x800450BD (0x1f04),
//     reveal-list move 0x0004001B (0x22e4), reveal cancel 0x800450BD (0x2350).
//   F0x80088FB4: the fold pair 0x00040019 / 0x0004001A.
//
// web/cardshop.js is the development rollback (?legacySave-style: the live
// route is cardshop-translated.js). It used the pre-2026-07-03i shifted cue
// names: the root and booster moves played 0x0004001B, every back played
// "system02" (0x8004513E), and the root/booster confirms played "system07".
// Fixed 2026-10-14 on audit/sfx-save-pause-vs-decode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
global.fetch = async (url) => {
  const file = path.join(WEB, String(url));
  const body = readFileSync(file, "utf8");
  return { ok: true, json: async () => JSON.parse(body) };
};
if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}

const shopUi = JSON.parse(readFileSync(path.join(WEB, "assets/data/stcrdshp_ui.json"), "utf8"));
const { createCardShop, __setLayout } = await import("../web/cardshop.js");
__setLayout(shopUi);

const MANIFEST = JSON.parse(readFileSync(path.join(WEB, "assets/sfx/manifest.json"), "utf8"));

function mockSfx() {
  const plays = [];
  return { plays, play: (n) => plays.push(n) };
}

/** Press and assert the FIRST cue of the press (screen transitions add folds after it). */
function pressFirst(sfx, c, key, expected) {
  const at = sfx.plays.length;
  c.handleKey(key);
  assert.equal(sfx.plays[at], expected, `plays=${sfx.plays}`);
}

test("the card shop's names resolve to stcrdshp's own packed ids", () => {
  assert.equal(MANIFEST.system00.id, "0x8004503c");
  assert.equal(MANIFEST.system01.id, "0x800450bd");
  assert.equal(MANIFEST.system02.id, "0x8004513e");
  assert.equal(MANIFEST.system06.id, "0x0004001b");
  assert.equal(MANIFEST.system07.id, "0x0004001c");
});

test("the root menu: 0x8004513e moves, 0x8004503c confirm, 0x800450bd back", () => {
  const sfx = mockSfx();
  const c = createCardShop(sfx);
  c.open({ bits: 0 });
  pressFirst(sfx, c, "down", "system02");
  assert.equal(c.rootSel, 1);
  pressFirst(sfx, c, "up", "system02");
  c.rootSel = 2;                                  // Edit Folder leaves without a message
  pressFirst(sfx, c, "circle", "system00");
  pressFirst(sfx, c, "cross", "system01");
});

test("the root refusal (no boosters) plays no second cue", () => {
  const sfx = mockSfx();
  const c = createCardShop(sfx);
  c.open({ bits: 0 });
  c.rootSel = 1;
  pressFirst(sfx, c, "circle", "system00");
  // The confirm's cue is the only one; the popup itself is silent.
  assert.deepEqual(sfx.plays, ["system00"], `plays=${sfx.plays}`);
  assert.ok(c.message, "the refusal message is shown");
});

test("the buy grid: 0x0004001b moves, 0x0004001c confirm, 0x800450bd back", () => {
  const sfx = mockSfx();
  const c = createCardShop(sfx);
  c.open({ bits: 100 });
  c.screen = "buy";
  c.buyCursor = 0;
  pressFirst(sfx, c, "right", "system06");
  pressFirst(sfx, c, "circle", "system07");
  assert.equal(c.screen, "confirm");
  pressFirst(sfx, c, "cross", "system01");
  assert.equal(c.screen, "buy");
});

test("the buy prompt: 0x8004513e moves, 0x8004503c on either row, 0x800450bd back", () => {
  const sfx = mockSfx();
  const c = createCardShop(sfx);
  c.open({ bits: 100 });
  c.screen = "confirm";
  c.confirmSel = 0;
  pressFirst(sfx, c, "down", "system02");
  assert.equal(c.confirmSel, 1);
  pressFirst(sfx, c, "circle", "system00");       // No -> back to the grid
  assert.equal(c.screen, "buy");
  c.screen = "confirm";
  c.confirmSel = 0;
  pressFirst(sfx, c, "cross", "system01");
});

test("the booster list: 0x8004513e moves, 0x8004503c confirm, 0x800450bd back", async () => {
  const sfx = mockSfx();
  const c = createCardShop(sfx);
  c.open({ bits: 100 });
  const { cards, loadBoosters } = await import("../web/cardstate.js");
  await loadBoosters();
  const sets = JSON.parse(readFileSync(path.join(WEB, "assets/data/card_boosters.json"), "utf8")).sets;
  cards().packs.set(sets[0].setId, 1);           // hold one booster so the list is non-empty
  c.screen = "booster";
  c.packSel = 0;
  pressFirst(sfx, c, "down", "system02");
  pressFirst(sfx, c, "up", "system02");
  pressFirst(sfx, c, "cross", "system01");
  assert.equal(c.screen, "root");
});

test("the reveal dismiss is the reveal list's cancel (0x800450bd)", () => {
  const sfx = mockSfx();
  const c = createCardShop(sfx);
  c.open({ bits: 100 });
  c.screen = "reveal";
  pressFirst(sfx, c, "cross", "system01");
  assert.equal(c.screen, "booster");
});

test("no back on this screen plays a cursor-move word", () => {
  const src = readFileSync(new URL("../web/cardshop.js", import.meta.url), "utf8");
  assert.ok(!/if \(back\) \{ sfx\?\.play\("system02"\)/.test(src),
    "a back handler still plays the move cue");
});
