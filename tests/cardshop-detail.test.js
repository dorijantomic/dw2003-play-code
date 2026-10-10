import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The card detail popup's bottom line, decoded 2026-08-14 (ledger
// UI-CARDSHOP-DETAIL-BOTTOM-LINE-2026-08-14, stcrdshp.s
// L0x00001558-L0x000015f4). The overlay compares the selected slot's card id
// against five constants and swaps the line: a match draws escrdshp string
// 0x0b "R1" at x 74, anything else draws string 0x0c "{1} BIT" at x 199, both
// at y 146.
//
// These tests exist to keep the "they are five ordinary card ids, not a class
// code" reading honest against the shipped card data. If the catalogue is ever
// re-extracted and the ids stop lining up, that is a real signal, not noise.

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const ui = load("../web/assets/data/stcrdshp_ui.json");
const catalog = load("../web/assets/data/card_catalog.json").cards;
const byId = new Map(catalog.map((c) => [c.id, c]));

const BL = ui.card_detail_popup.bottomLine;

test("the bottom line carries the decoded strings and coordinates", () => {
  assert.equal(BL.y, 0x92);
  assert.equal(BL.priceX, 0xc7);
  assert.equal(BL.hintX, 0x4a);
  assert.equal(ui.strings[BL.priceString], "{1} BIT");
  assert.equal(ui.strings[BL.hintString], "R1");
});

test("the five constants are the exact ids the overlay compares", () => {
  assert.deepEqual(BL.hintCardIds, [0x45, 0x70, 0x9b, 0xc6, 0xf1]);
});

test("each of the five is a real card, and the names match the ids", () => {
  assert.equal(BL.hintCardIds.length, BL.hintCardNames.length);
  BL.hintCardIds.forEach((id, i) => {
    const card = byId.get(id);
    assert.ok(card, `card id ${id} is not in the catalogue`);
    assert.equal(card.name, BL.hintCardNames[i]);
  });
});

test("the five are one per card colour", () => {
  const colours = BL.hintCardIds.map((id) => byId.get(id).colour);
  assert.equal(new Set(colours).size, 5, `colours were ${colours}`);
  assert.deepEqual([...colours].sort(),
    ["black", "blue", "green", "red", "white"]);
});

test("the five are exactly the catalogue's five highest-ranked cards", () => {
  // Rank 0 is the unranked value two brown cards carry, so the real ranking
  // starts at 1.
  const ranked = catalog
    .filter((c) => c.strengthRank > 0)
    .sort((a, b) => a.strengthRank - b.strengthRank)
    .slice(0, 5);
  assert.deepEqual(ranked.map((c) => c.strengthRank), [1, 2, 3, 4, 5]);
  assert.deepEqual(
    ranked.map((c) => c.id).sort((a, b) => a - b),
    [...BL.hintCardIds].sort((a, b) => a - b));
});

test("no shop, booster or starter deck carries any of the five", () => {
  // This is why they have no price to put on that line. Every id in each file
  // is collected rather than spot-checked, so a single stocked copy would fail.
  const ids = new Set(BL.hintCardIds);
  const collect = (node, out) => {
    if (Array.isArray(node)) node.forEach((n) => collect(n, out));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (/^(card|cardId|id)$/i.test(k) && typeof v === "number") out.add(v);
        else collect(v, out);
      }
    }
    return out;
  };
  for (const file of ["card_shops.json", "card_boosters.json", "card_starter.json"]) {
    const found = collect(load(`../web/assets/data/${file}`), new Set());
    const clash = [...found].filter((id) => ids.has(id));
    assert.deepEqual(clash, [], `${file} stocks ${clash}`);
  }
});

test("the five DO appear in opponents' decks, so they are playable cards", () => {
  const opponents = load("../web/assets/data/card_opponents.json").opponents;
  const inDecks = new Set(opponents.flatMap((o) => o.deck.map((c) => c.cardId)));
  for (const id of BL.hintCardIds) {
    assert.ok(inDecks.has(id), `card ${id} is in no opponent deck`);
  }
});

test("the confirm pair and refusal lines are the disc's own strings, not Yes/No", () => {
  assert.equal(ui.strings.buy, "BUY");
  assert.equal(ui.strings.no, "NO");
  assert.equal(ui.strings.notEnoughBit, "Not enough BIT.");
  assert.equal(ui.strings.tooManyCards, "Too many cards");
  assert.equal(ui.strings.noBoosters, "No boosters");
  assert.equal(ui.strings.openWhichBooster, "Open which booster?");
  assert.equal(ui.strings.openedBooster, "Opened booster.");
  assert.equal(ui.strings.bit, "BIT");
  assert.equal(ui.strings.l1, "L1");
  assert.equal(ui.strings.r1, "R1");
  assert.equal(ui.strings.explainHint, "R1");
});

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}

const { createCardShop, __setLayout } = await import("../web/cardshop.js");
__setLayout(ui);

function stubCtx() {
  const texts = [];
  const fills = [];
  const noop = () => {};
  const ctx = {
    texts,
    fills,
    _fillStyle: "",
    save: noop, restore: noop, scale: noop, drawImage: noop,
    fillRect(x, y, w, h) { fills.push({ style: ctx._fillStyle, x, y, w, h }); },
    fillText(t, x, y) { texts.push({ t: String(t), x, y }); },
    measureText: () => ({ width: 0 }),
    set fillStyle(v) { ctx._fillStyle = v; },
    get fillStyle() { return ctx._fillStyle; },
    set font(_v) {}, set globalAlpha(_v) {},
    set globalCompositeOperation(_v) {}, set imageSmoothingEnabled(_v) {},
    set strokeStyle(_v) {}, set lineWidth(_v) {}, strokeRect: noop,
  };
  return ctx;
}

test("the root menu draws BIT at the decoded label, not a guessed corner", () => {
  const shop = createCardShop();
  shop.open({ bits: 12 });
  const ctx = stubCtx();
  shop.draw(ctx, 320, 240, { bits: 12 });
  const bit = ctx.texts.find((x) => x.t === "BIT");
  assert.ok(bit, "BIT is drawn");
  assert.equal(bit.x, ui.root_menu.bitLabel[0]);
  assert.equal(ctx.texts.some((x) => x.t === "Yes"), false);
});

test("the confirm prompt uses BUY/NO, not an invented Yes/No pair", () => {
  const shop = createCardShop();
  shop.open({ bits: 12 });
  shop.screen = "confirm";
  shop.confirmSel = 0;
  const ctx = stubCtx();
  shop.draw(ctx, 320, 240, { bits: 12 });
  const labels = ctx.texts.map((x) => x.t);
  assert.ok(labels.includes("BUY"), `drew ${labels.join("|")}`);
  assert.ok(labels.includes("NO"), `drew ${labels.join("|")}`);
  assert.equal(labels.includes("Yes"), false);
});

test("an empty booster list shows the disc's 'No boosters' line", () => {
  const shop = createCardShop();
  shop.open({ bits: 0 });
  shop.handleKey("down");
  shop.handleKey("circle");
  const ctx = stubCtx();
  shop.draw(ctx, 320, 240, { bits: 0 });
  assert.ok(ctx.texts.some((x) => x.t === "No boosters"));
  assert.equal(ctx.texts.some((x) => /win a duel/i.test(x.t)), false);
});

test("triangle on the root menu dims out over 30 frames instead of closing at once", () => {
  const shop = createCardShop();
  const t0 = 1_000_000;
  const orig = performance.now;
  performance.now = () => t0;
  try {
    shop.open({ bits: 0 });
    shop.handleKey("cross");
    assert.equal(shop.isOpen(), true);
    shop.draw(stubCtx(), 320, 240, { bits: 0 });
    assert.equal(shop.isOpen(), true);
    const mid = stubCtx();
    performance.now = () => t0 + 15 * 20;
    shop.draw(mid, 320, 240, { bits: 0 });
    assert.equal(shop.isOpen(), true);
    // The dim SUBTRACTS its level from the screen rather than laying black over
    // it (docs/research/ui/screen-rendering-model.md section 4), so the fill it
    // records is the grey level, not an alpha. Halfway through the thirty
    // frames the level is about half of 255.
    const dim = mid.fills.find((f) => f.w === 320 && f.h === 240 && /^rgb\(/.test(String(f.style)));
    assert.ok(dim, "no screen dim was painted");
    const level = Number(String(dim.style).match(/^rgb\((\d+),/)[1]);
    assert.ok(level > 100 && level < 160, `dim level ${level} is not halfway`);
    performance.now = () => t0 + 30 * 20;
    shop.draw(stubCtx(), 320, 240, { bits: 0 });
    assert.equal(shop.isOpen(), false);
  } finally {
    performance.now = orig;
  }
});

test("the Bits number is the shop's own readout, not whatever draw is passed", () => {
  const shop = createCardShop();
  shop.open({ bits: 12 });
  const ctx = stubCtx();
  shop.draw(ctx, 320, 240, { bits: 999 });
  const atLabel = ctx.texts.find((x) => x.t === "12");
  assert.ok(atLabel, `drew ${ctx.texts.map((x) => x.t).join("|")}`);
  assert.equal(atLabel.x, ui.root_menu.bitDigits[0]);
  assert.equal(ctx.texts.some((x) => x.t === "999"), false);
});

test("a pack reveal sits on the decoded six-card grid, not a name list", () => {
  const shop = createCardShop();
  shop.open({ bits: 0 });
  shop.screen = "reveal";
  shop.revealActive = false;
  shop.lastPull = [
    { id: 1, name: "Agumon", colour: "red" },
    { id: 2, name: "Gabumon", colour: "blue" },
    { id: 3, name: "Patamon", colour: "yellow" },
    { id: 4, name: "Gomamon", colour: "white" },
    { id: 5, name: "Biyomon", colour: "red" },
    { id: 6, name: "Palmon", colour: "green" },
  ];
  const ctx = stubCtx();
  shop.draw(ctx, 320, 240, { bits: 0 });
  assert.ok(ctx.texts.some((x) => x.t === "Opened booster."));
  assert.equal(ctx.texts.some((x) => x.t === "Agumon"), false);
  assert.equal(ctx.texts.some((x) => x.y === 106 || x.y === 120), false);
});
