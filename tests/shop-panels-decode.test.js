// The legacy merchant screen (web/shop.js) against the verified stitshop decode:
//   - showQuantity (F0x800836F8, claim stitshop-panels-and-loader-2026-10-10):
//     the quantity panel's two labels are text ids 0x11 ("How many?") and 8
//     ("X"), and the value; the widget pens are the decoded ones from
//     F0x8008360C (engine/dw3/ui/shop-actor-build.ts): "How many?" (0xB9,0x3A),
//     "X" (0x103,0x54), value (0x11E,0x54) right-aligned by its +0x148 measure.
//   - the info band's price plate (F0x80089E2C, widget +0x18) is
//     price x quantity: the running total recomputed on every quantity change
//     (the overlay doc's "one arithmetic fact"; the BUY machine calls the band
//     refill on each dial, state 8). Unit x quantity at qty 1 equals the unit
//     price, so the list screen is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createShop } from "../web/shop.js";
import { ITEM_BY_ID } from "../web/vendor/engine.js";

function firstPricedId() {
  for (const it of Object.values(ITEM_BY_ID)) {
    if (it?.price > 0 && (it.sell ?? 1) > 0) return it.id;
  }
  return 1;
}

// A recording canvas: every method absorbs, fillText captures (text, x, y).
// drawText's fallback path (no font image in node) calls ctx.fillText(text, x, y + 11).
function recordingCtx() {
  const texts = [];
  const target = {
    measureText: () => ({ width: 10 }),
    createPattern: () => ({}),
    fillText: (t, x, y) => { texts.push({ t: String(t), x, y }); },
  };
  const ctx = new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === "string") return () => {};
      return undefined;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  return { ctx, texts };
}

function openQtyScreen(qty = 1) {
  const id = firstPricedId();
  const item = ITEM_BY_ID[id];
  const sh = createShop(null);
  const state = { bits: 999999, inventory: [], equipment: [] };
  sh.open([id], null, { name: "Suzaku Item Shop" });
  sh.handleKey("circle", state); // BUY
  sh.handleKey("circle", state); // open the quantity box
  assert.equal(sh.screen, "qty");
  sh.qty = qty;
  sh.update(0.5); // settle the fold animations so the plates draw
  return { sh, state, item, id };
}

test("the quantity panel draws the decoded widgets: How many? (0xB9,0x3A), X (0x103,0x54), value right of 0x11E", () => {
  const { sh, state } = openQtyScreen(1);
  const { ctx, texts } = recordingCtx();
  sh.draw(ctx, 320, 240, state);
  const at = (t, x) => texts.find((c) => c.t === t && c.x === x);
  assert.ok(at("How many?", 0xb9), `"How many?" at the decoded pen (0xB9,0x3A); drew ${JSON.stringify(texts)}`);
  assert.equal(at("How many?", 0xb9).y, 0x3a + 11);
  assert.ok(at("X", 0x103), "the quantity marker (text id 8) at its decoded pen (0x103,0x54)");
  assert.equal(at("X", 0x103).y, 0x54 + 11);
  assert.ok(texts.some((c) => c.t === "1" && c.x === 0x11e - 7 && c.y === 0x54 + 11),
    "the value right-aligned ending at 0x11E on the decoded pen line");
});

test("the info band price plate shows unit x quantity, recomputed on every dial", () => {
  const { sh, state, item } = openQtyScreen(3);
  const { ctx, texts } = recordingCtx();
  sh.draw(ctx, 320, 240, state);
  const band = (value) => texts.some((c) => c.t === String(value) && c.y === 0x8b + 11);
  assert.ok(band(item.price * 3), `band shows ${item.price} x 3; drew ${JSON.stringify(texts)}`);
  assert.ok(!band(item.price), "the band does not still show the unit price at qty 3");
});

test("cancelling the quantity box restores the band to the unit price (quantity resets to 1)", () => {
  const { sh, state, item } = openQtyScreen(4);
  sh.handleKey("cross", state); // Triangle: back to the list, amount reset to 1
  assert.equal(sh.screen, "list");
  assert.equal(sh.qty, 1, "the original resets the dialled amount on cancel");
  const { ctx, texts } = recordingCtx();
  sh.update(0.5);
  sh.draw(ctx, 320, 240, state);
  const band = (value) => texts.some((c) => c.t === String(value) && c.y === 0x8b + 11);
  assert.ok(band(item.price), `band back to the unit price ${item.price}; drew ${JSON.stringify(texts)}`);
  assert.ok(!band(item.price * 4), "the stale total is gone");
});
