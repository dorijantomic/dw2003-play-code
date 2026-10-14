// The Card Album's page turn must move the GRID's card window, not a cursor.
//
// Audit 2026-10-14 (audit/card-album-vs-decode): the screen tick's page change
// calls the grid's +0x84 method with the page's first card id
// (pro/stcrdabm F0x80084C38 0x80084FA8-0x80084FC8 and 0x80084FD4-0x80084FF4:
// a0 = [ctx+0x44] the grid object, a1 = page*12|1, `lw v0, 0x84(a0); jalr v0`).
// +0x84 is the grid's begin-page F0x80083114: it stores a1 in the grid's +0x5C,
// keeps the old +0x5C in +0x60, clears +0x68/+0x70 and calls the grid's
// +0x28(2). The session had mapped that call to the cursor position setter,
// which wrote +0x58/+0x5C/+0x68 instead: after every page turn the grid window
// (+0x5C) was 0, so page two drew page one's records while the screen's
// silhouettes and headings said page two.
//
// The lane-b oracle tests/lane-b/album-tick.test.js already pins the CALL
// (widget84 receives the grid object and page*12|1); this file pins what the
// session then does with it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AlbumSession } from "../engine/dw3/ui/album-session.ts";

const DATA = new URL("../web/assets/data/", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, DATA), "utf8"));

const COLOURS = { white: 1, blue: 2, green: 3, red: 4, black: 5, brown: 6 };
const STAGES = { "in-training": 1, rookie: 2, champion: 3, ultimate: 4, mega: 5 };

function resources(language = 2) {
  const catalog = json("card_catalog.json");
  const cards = catalog.cards.map((card) => ({
    colour: COLOURS[card.colour] ?? 0, ap: card.ap ?? 0, hp: card.hp ?? 0,
    kind: card.kind === "digimon" ? 0x10 : (card.programCategory ?? 0),
    programCost: card.programCost ?? card.cost ?? 0, summonCost: card.summonCost ?? 0,
    level: card.level ?? STAGES[card.stage] ?? 0,
  }));
  const banks = new Map();
  for (const offset of [0x16, 0x1d, 0x24]) {
    const id = offset + language;
    banks.set(id, new Uint8Array(readFileSync(new URL(`album/banks/${id}.bin`, DATA))));
  }
  const font = new Uint8Array(readFileSync(new URL("shop_font.bin", DATA)));
  return { banks, cards, font };
}

function openAlbum() {
  const session = new AlbumSession(2, resources(), { playSound() {} });
  const seen = []; const owned = new Map();
  for (let id = 1; id < 0x13b; id += 3) { seen.push(id); owned.set(id, (id % 9) + 1); }
  session.seedCollection(seen, owned);
  for (let frame = 0; frame < 300 && (session.mem.read32(session.root + 0x10) | 0) !== 4; frame++) {
    session.tick([]);
  }
  assert.equal(session.mem.read32(session.root + 0x10) | 0, 4, "the album settles on its cursor state");
  return session;
}

const rd = (session, offset) => session.mem.read32(session.root + offset) | 0;
const gridOf = (session) => session.mem.read32(session.context + 0x44) >>> 0;
const gridRd = (session, offset) => session.mem.read32(gridOf(session) + offset) | 0;

test("R1 begins the grid's page: the grid window, previous window and reveal reset", () => {
  const session = openAlbum();
  assert.equal(rd(session, 0x60), 0, "page one");
  assert.equal(gridRd(session, 0x5c), 1, "the grid starts on the page-one window (first card id 1)");
  assert.equal(gridRd(session, 0x58), 6, "the grid's own scale word is untouched");

  // R1 turns the page forward. F0x80083114 begin-page(grid, page*12|1).
  session.tick(["r1"]);
  assert.equal(rd(session, 0x60), 1, "the screen moved to page two");
  assert.equal(gridRd(session, 0x5c), 13, "the grid window moved to card 13 (page*12+1)");
  assert.equal(gridRd(session, 0x60), 1, "the grid keeps the old window in +0x60");
  assert.equal(gridRd(session, 0xc), 2, "the grid begins its reveal state (+0x28(2))");
  assert.equal(gridRd(session, 0x58), 6, "begin-page never writes the scale word");

  // The restarted reveal runs to its end (the count lands on 12 and the state
  // returns to 1), which only happens if begin-page actually restarted it.
  for (let frame = 0; frame < 80; frame++) session.tick([]);
  assert.equal(gridRd(session, 0x68), 12, "the reveal count ran to twelve");
  assert.equal(gridRd(session, 0xc), 1, "the grid returned to its settled state");

  // L1 turns back: the window returns to page one and remembers page two.
  session.tick(["l1"]);
  for (let frame = 0; frame < 30; frame++) session.tick([]);
  assert.equal(rd(session, 0x60), 0, "the screen returned to page one");
  assert.equal(gridRd(session, 0x5c), 1, "the grid window is card 1 again");
  assert.equal(gridRd(session, 0x60), 13, "the grid remembers the page-two window");
});
