// Every screen the pause menu reaches, checked against the positions the
// original overlays state. Each number is quoted with the routine that states
// it, so a drift in web/assets/data/*_ui.json fails here rather than on screen.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const load = async (name) => JSON.parse(await readFile(
  new URL(`../web/assets/data/${name}_ui.json`, import.meta.url), "utf8"));

const album = await load("stcrdabm");
const deck = await load("stcrddek");
const name = await load("stdgname");

test("the Card Album's detail popup states all ten of its text places", () => {
  // ctor F0x80083bfc widgets +0x1C..+0x40, filled by F0x800840ac.
  const t = album.page_popups.cardDetailPopup.text;
  assert.deepEqual([t.name.x, t.name.y], [136, 161]);
  assert.deepEqual([t.costLabel.x, t.costLabel.y], [277, 161]);
  assert.deepEqual([t.cost.x, t.cost.y], [294, 161]);
  assert.deepEqual([t.heldLabel.x, t.heldLabel.y], [277, 199]);
  assert.deepEqual([t.held.x, t.held.y], [300, 199]);
  assert.deepEqual([t.effect.x, t.effect.y], [80, 184]);
  assert.deepEqual([t.apLabel.x, t.apLabel.y], [206, 184]);
  assert.deepEqual([t.ap.x, t.ap.y], [240, 184]);
  assert.deepEqual([t.hpLabel.x, t.hpLabel.y], [206, 197]);
  assert.deepEqual([t.hp.x, t.hp.y], [240, 197]);
  // escrdabm 6 "AP", 7 "HP", 8 "X".
  assert.deepEqual([t.apLabel.str, t.hpLabel.str, t.costLabel.str], [6, 7, 8]);
});

test("the album's cost pair and the editor's stand at the same fields", () => {
  // Both read CARDPAK +0x05 behind escrdabm/escrdshp string 8.
  assert.equal(album.page_popups.cardDetailPopup.text.costLabel.str, 8);
  assert.deepEqual(deck.editor.statTop.pairA, [277, 38]);
  assert.deepEqual(deck.editor.statTop.pairB, [294, 38]);
});

test("Edit Folder names the card under the cursor and carries one footer", () => {
  // F0x8008397c builds them at (0x96,0xBD) and (0x96,0xCC); F0x80083d28 fills
  // the footer from escrdshp 31, or 0x1C + the explain flag for 0x3C frames.
  assert.deepEqual(deck.editor.cardName, [150, 189]);
  assert.deepEqual(deck.editor.footerLine, [150, 204]);
  assert.equal(deck.editor.footerSteadyStr, 31);
  assert.equal(deck.editor.footerMessageStrBase, 28);
  assert.equal(deck.editor.footerMessageVsync, 0x3C);
});

test("Edit Folder's window and refusal plate carry their own hinges", () => {
  // F0x80084890: clip 0x40 at (16,21) about (160,116); clip 0x36 at (0,100)
  // about (0,120), one depth bucket in front.
  assert.deepEqual(
    [deck.editor.window.clip, deck.editor.window.x, deck.editor.window.y],
    [0x40, 16, 21]);
  assert.deepEqual(deck.editor.window.pivot, [160, 116]);
  assert.deepEqual(
    [deck.editor.messageBar.clip, deck.editor.messageBar.x, deck.editor.messageBar.y],
    [0x36, 0, 100]);
  assert.deepEqual(deck.editor.messageBar.pivot, [0, 120]);
});

test("the keyboard has a ten-box plate, a cell grid and a message bar", () => {
  // F0x80086e04: clip 0x35 when the mode word is 2, clip 0x25 at (0x1D,0x54),
  // clip 0x26 at (0,0x64).
  const n = name.chrome.namedt_overlay;
  assert.deepEqual([n.name_boxes_ten.clip, n.name_boxes_ten.count], [53, 10]);
  assert.deepEqual([n.name_boxes_ten.x, n.name_boxes_ten.y], [75, 64]);
  assert.deepEqual([n.grid_frame.clip, n.grid_frame.x, n.grid_frame.y], [37, 29, 84]);
  assert.deepEqual([n.message_bar.clip, n.message_bar.x, n.message_bar.y], [38, 0, 100]);
  assert.deepEqual(n.message_bar.pivot, [0, 120]);
});

test("the keyboard's page arrows need a second page, which English has not", () => {
  // F0x800884e8 writes [0x8008B848]: 3 for the Japanese language index, 1
  // otherwise. F0x80086e04 gates the arrows on that word being 2 or more.
  const a = name.chrome.namedt_overlay.page_arrows;
  assert.deepEqual([a.clip_left, a.left_x, a.left_y], [50, 10, 94]);
  assert.deepEqual([a.clip_right, a.right_x, a.right_y], [51, 281, 94]);
  assert.equal(a.shown_when_pages_at_least, 2);
  assert.equal(a.clut_entries, 6);
  assert.equal(a.clut_step_vsync, 7);
});

test("the folder name is ten characters, which picks the ten-box plate", () => {
  assert.equal(deck.rules.nameLength, 10);
  assert.equal(name.chrome.namedt_overlay.name_boxes_ten.count, deck.rules.nameLength);
});
