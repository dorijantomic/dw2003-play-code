// One number per limit, and the wallet's write is clamped.
//
// The wallet cell (save ctx + 0x6C) is the u32 the original stops at 9,999,999
// and floors at 0. The browser screens used to spell that ceiling out (or keep
// their own copy of it), and web/shop-native.js wrote `state.bits` raw into the
// cell: a seed above the ceiling landed in RAM while the next read handed the
// capped value back, so the screen's copy and the cell disagreed.
//
// One home: engine/systems/shop-manager.ts MONEY_CAP (the bundle exports it as
// MONEY_CAP; the save-block adapter's SHOP_BIT_CAP is that same number).
// The item catalogue bound has one home in the browser layer, web/item-log.js.
//
// Invented numbers only: the ceilings here are the engine's own constants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SHOP_BIT_CAP, SHOP_ITEM_MAX_ID } from "../engine/dw3/ui/shop-save-state.ts";
import { MONEY_CAP } from "../engine/systems/shop-manager.ts";
import { PAUSE_MONEY_CAP } from "../engine/dw3/ui/pause-close-commit.ts";
import { REPORT_MONEY_CAP } from "../engine/dw3/ui/fight-report-session.ts";
import { PAUSE_ITEM_MAX_ID } from "../engine/dw3/ui/pause-root-session.ts";
import { LANGUAGE_CELL, PARTY_CONTEXT } from "../engine/dw3/party-context.ts";
import { SAVE_CONTEXT } from "../engine/dw3/form-ledger.ts";
import { ITEM_ID_MAX } from "../engine/dw3/item-directories.ts";
import { ITEM_MAX_ID } from "../web/item-log.js";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("the money ceiling is one number, and the cap names are that number", () => {
  assert.equal(MONEY_CAP, 9999999);
  assert.equal(SHOP_BIT_CAP, MONEY_CAP, "the save block's cap is the economy layer's");
  assert.equal(PAUSE_MONEY_CAP, MONEY_CAP);
  assert.equal(REPORT_MONEY_CAP, MONEY_CAP);
});

test("the item catalogue bound is one number", () => {
  assert.equal(ITEM_ID_MAX, 402);
  assert.equal(SHOP_ITEM_MAX_ID, ITEM_ID_MAX);
  assert.equal(PAUSE_ITEM_MAX_ID, SHOP_ITEM_MAX_ID);
  assert.equal(ITEM_MAX_ID, ITEM_ID_MAX, "the glossary's export is that number");
});

test("the save context and the language cell agree with their one declaration", () => {
  assert.equal(PARTY_CONTEXT, 0x80048d34);
  assert.equal(LANGUAGE_CELL, 0x8005cca8);
  // form-ledger keeps its own copy: it sits under effective-stats, which
  // party-context imports, so importing PARTY_CONTEXT there would close a cycle.
  assert.equal(SAVE_CONTEXT, PARTY_CONTEXT, "the two declarations still name the same cell");
});

test("the shop seed writes the wallet through the ceiling, never raw", () => {
  const src = read("web/shop-native.js");
  assert.match(src, /write\(MONEY, Math\.max\(0, Math\.min\(MONEY_CAP, Math\.trunc\(Number\(state\.bits\) \|\| 0\)\)\), 4\)/,
    "the seed clamps money to 0..MONEY_CAP");
  assert.doesNotMatch(src, /write\(MONEY, Number\(state\.bits\) \|\| 0, 4\)/, "the old unclamped write is gone");
});

test("the screens that print the wallet share the engine's constant", () => {
  for (const file of [
    "web/shop-native.js", "web/status-native.js",
    "web/shop.js", "web/cardshop-native.js", "web/fightreport-native.js",
    "web/fightreport-translated.js",
  ]) {
    const src = read(file);
    assert.doesNotMatch(src, /const\s+BIT_CAP\s*=/, `${file} must not declare its own money cap`);
    assert.doesNotMatch(src, /9_999_999|0x98967f/, `${file} must not spell the cap out`);
    assert.match(src, /MONEY_CAP/, `${file} uses the engine's cap`);
  }
});

test("the item screens share the catalogue bound", () => {
  for (const file of ["web/shop-native.js", "web/status-native.js", "web/status-translated.js"]) {
    const src = read(file);
    assert.doesNotMatch(src, /const\s+ITEM_MAX_ID\s*=\s*402/, `${file} must not declare its own item bound`);
    assert.match(src, /ITEM_ID_MAX/, `${file} takes the bound from the engine`);
  }
});
