// The battle HUD's small plate above the message box — what it is, pinned.
//
// Frontier BATTLE-Q001 asked which routine draws the plate observers see only
// while the battle ITEM list is open. The answer, read from pro/fightstg and
// now carried by the already-translated list, is: it is the ITEM list's count
// tag. F0x8009543C (itemListDraw) draws the PGFGTC00 quantity pane cel 0x28 at
// (166,160); F0x8009563C (itemListCreateWidgets) builds the "X" figure text
// widget at (172,165) carrying battle-command bank word 0x0C, and the caption
// widget at (198,165); F0x800957B4 (itemListUpdateRows) fills the caption with
// the count of the highlighted item, or the "--" word 0x1A when nothing is
// held. The player therefore reads "X ーー" on an empty bag and "X <n>" with a
// count, which is exactly what the 2026-10-05 live pass saw.
//
// This pins the DATA identity of the two words (lane-b's fight-item-menu oracle
// already pins the routine call sequences), so the plate cannot be re-opened as
// an unnamed rectangle without contradicting the shipped bank.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    ITEM_CEL_QUANTITY, ITEM_WORD_FIGURE, ITEM_WORD_QUANTITY, ITEM_WORD_EMPTY,
    ITEM_CHROME_PACK, ITEM_LAYER,
} from "../engine/dw3/ui/native/battle-item-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data/battlecmd");
const bank = JSON.parse(readFileSync(join(dir, "esmfight.json"), "utf8"));

test("the plate's figure word is the Cross glyph and its empty word is the two dashes", () => {
    // The figure widget (172,165) is given bank-0x7F word 0x0C (fightstg.s:19260).
    assert.equal(ITEM_WORD_FIGURE, 0x0c);
    assert.equal(bank.strings[ITEM_WORD_FIGURE], "X");
    // The caption widget (198,165) is given word 0x1A when nothing is held
    // (fightstg.s:19385-19401); when a count is present the number replaces it.
    assert.equal(ITEM_WORD_QUANTITY, 0x1a);
    assert.equal(bank.strings[ITEM_WORD_QUANTITY], "\u30fc\u30fc"); // "ーー"
});

test("the plate is the ITEM list's quantity pane, not a HUD rectangle of its own", () => {
    // F0x8009543C draws the PGFGTC00 quantity pane (fightstg.s:19174-19180).
    assert.equal(ITEM_CEL_QUANTITY, 0x28);
    assert.equal(ITEM_CHROME_PACK, 0x04550000);
    assert.equal(ITEM_LAYER, 0x1005);
    // The empty-list description bar word is a different string (bank 0x7F 0x15
    // = "No items."), which the live pass saw in the message box beside the
    // plate — the plate itself stays the "X" figure + caption.
    assert.equal(ITEM_WORD_EMPTY, 0x15);
    assert.equal(bank.strings[ITEM_WORD_EMPTY], "No items.");
});
