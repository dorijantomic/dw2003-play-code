// Card folder editor: the submenu cursor draws its glyph, and the grid emits one card picture per card.
// Runs the real FolderSession (not a source grep). Numbers: cursor glyph total, card pictures in the grid.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FolderSession } from "../engine/dw3/ui/folder-session.ts";

const DATA = new URL("../web/assets/data/", import.meta.url);
const CARDSHOP = new URL("../web/cardshop-data/", import.meta.url);
const BANKS = new URL("../web/assets/native/screens/banks/", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, DATA), "utf8"));
const bytes = (url) => new Uint8Array(readFileSync(url));
const COLOURS = { white: 1, blue: 2, green: 3, red: 4, black: 5, brown: 6 };

function resources(withGlyphs) {
  const catalog = json("card_catalog.json");
  const cards = catalog.cards.map((card) => ({
    colour: COLOURS[card.colour] ?? 0, ap: card.ap ?? 0, hp: card.hp ?? 0,
    kind: card.kind === "digimon" ? 0x10 : (card.programCategory ?? 0),
    programCost: card.programCost ?? card.cost ?? 0, summonCost: card.summonCost ?? 0,
    level: card.level ?? 0,
  }));
  const banks = new Map();
  for (const [dir, id] of [[CARDSHOP, 0x18], [CARDSHOP, 0x1f], [CARDSHOP, 0x34], [BANKS, 0x88]]) {
    try { banks.set(id, bytes(new URL(id + ".bin", dir))); } catch { /* absent */ }
  }
  const tables = json("stcrddek_tables.json").slabs.map((s) => ({ base: s.base, bytes: new Uint8Array(Buffer.from(s.bytes_base64, "base64")) }));
  const folders = [{ name: "Ted", cards: Array.from({ length: 40 }, (_, i) => i + 1) }, { name: "Amy", cards: [] }, { name: "", cards: [] }];
  const out = { banks, cards, font: bytes(new URL("shop_font.bin", DATA)), folders, tables };
  if (withGlyphs) out.cursorGlyphs = json("shop_catalog.json").cursorGlyphs;
  return out;
}
const rd = (s, o) => s.mem.read32(s.root + o) | 0;
const press = (s, k) => { s.tick([k]); s.tick([]); };

function openSubmenu(s) {
  for (let f = 0; f < 400 && rd(s, 0x10) !== 4; f++) s.tick([]);
  press(s, "circle");
  for (let f = 0; f < 30; f++) s.tick([]);
  assert.equal(rd(s, 0x10), 0xd, "submenu open");
}
// the submenu cursor: the visible text widget pen-placed at x 154
const cursorGlyphTotal = (s) => s.widgets.textWidgets().filter((w) => w.penX === 154 && w.visible).reduce((a, w) => a + w.total, 0);

test("the submenu cursor draws its glyph (total > 0 over 3 s)", () => {
  const s = new FolderSession(2, resources(true), { playSound() {} });
  openSubmenu(s);
  let best = 0;
  for (let f = 0; f < 180; f++) { s.tick([]); best = Math.max(best, cursorGlyphTotal(s)); }
  press(s, "down");
  for (let f = 0; f < 180; f++) { s.tick([]); best = Math.max(best, cursorGlyphTotal(s)); }
  console.log("cursor glyph total over 6 s:", best);
  assert.ok(best > 0);
});

test("the editor grid emits one card picture per card", () => {
  const s = new FolderSession(2, resources(true), { playSound() {} });
  openSubmenu(s);
  press(s, "circle");
  let most = 0;
  for (let f = 0; f < 700; f++) {
    s.tick([]);
    const n = s.draw.calls.filter((c) => c.method === "cardSprite").length;
    if (n > most) most = n;
  }
  console.log("card pictures in the grid:", most);
  assert.equal(most, 40);
});
