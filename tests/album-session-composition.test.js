// The Card Album's composed session: the already-oracled pro/stcrdabm
// controllers driven together as registered tasks, over the shared shop
// services. This file proves the composition actually runs our code end to end
// -- open, page turn, cursor move, cancel and exit -- and that the page mask
// runs on the SCREEN object (the object-identity question settled from the
// overlay: both call sites of F0x80084C38 pass the screen's own a0 to
// F0x80084BC8, so the mask reads the screen's +0x60 page and writes its +0x80
// slot flags, never the grid object's +0x60 prevPage).
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

function seeded(session, step = 3) {
  const seen = []; const owned = new Map();
  for (let id = 1; id < 0x13b; id += step) { seen.push(id); owned.set(id, (id % 9) + 1); }
  session.seedCollection(seen, owned);
}

const rd = (session, offset) => session.mem.read32(session.root + offset) | 0;

test("the album opens, turns pages, moves the cursor and exits", () => {
  const session = new AlbumSession(2, resources(), { playSound() {} });
  seeded(session);
  for (let frame = 0; frame < 300 && rd(session, 0x10) !== 4; frame++) session.tick([]);
  assert.equal(rd(session, 0x10), 4, "the album settles on its cursor state");
  assert.equal(rd(session, 0x64), 27, "the page count is 0x1B for the 315-card catalog");
  assert.equal(rd(session, 0x7c), 1, "page one has a collected card");

  // R1 (word bit 0x800) turns the page forward; L1 (0x400) back. The screen
  // locks input while the grid plays its page reveal (state 0xF waits for the
  // grid's +0x0C to settle at 1), so wait for the cursor state between turns.
  const settle = () => {
    for (let frame = 0; frame < 400 && rd(session, 0x10) !== 4; frame++) session.tick([]);
    assert.equal(rd(session, 0x10), 4, "the album returns to its cursor state");
  };
  session.tick(["r1"]); settle();
  assert.equal(rd(session, 0x60), 1, "R1 turns to page two");
  session.tick(["r1"]); settle();
  assert.equal(rd(session, 0x60), 2, "R1 turns to page three");
  session.tick(["l1"]); settle();
  assert.equal(rd(session, 0x60), 1, "L1 turns back to page two");

  // The d-pad moves the cursor within the page (right = word bit 0x20).
  const before = rd(session, 0x74);
  session.tick(["right"]); session.tick([]);
  assert.notEqual(rd(session, 0x74), before, "the cursor moved");
  assert.equal(rd(session, 0x10), 4, "still on the cursor state");

  // Back (word bit 0x4000) opens the popup; its fade finishes and the screen ends.
  session.tick(["cross"]); session.tick([]);
  assert.equal(rd(session, 0x10), 0x32, "cancel opens the closing popup");
  let sawFade = false;
  for (let frame = 0; frame < 120 && !session.finished(); frame++) {
    session.tick([]);
    if (session.fadeLevel() > 0) sawFade = true;
  }
  assert.ok(session.finished(), "the album finishes after the popup fades");
  assert.ok(sawFade, "the closing popup drove a visible fade");
});

test("the album detail reads the disc CARDPAK record, not a colour-only table", () => {
  const res = resources();
  const session = new AlbumSession(2, res, { playSound() {} });
  const catalog = json("card_catalog.json").cards;
  for (const id of [1, 2, 3, 61, 100, 314]) {
    const card = catalog[id - 1];
    const detail = session.cardDetail(id);
    assert.equal(detail.colour, COLOURS[card.colour] ?? 0, `card ${id} colour`);
    assert.equal(detail.ap, card.ap ?? 0, `card ${id} AP`);
    assert.equal(detail.hp, card.hp ?? 0, `card ${id} HP`);
    if (card.kind === "digimon") assert.equal(detail.kindWord, 0, `Digimon ${id} shows AP/HP`);
  }
  assert.equal(session.cardDetail(61).ap, 62, "Imperialdramon-P reads AP 62");
  const program = catalog.find((card) => card.kind === "program");
  assert.notEqual(session.cardDetail(program.id).kindWord, 0, "a Program card shows its plate");
  // Beyond the 315-card catalog the selector still resolves file 0's base,
  // exactly as F0x8001E7EC does for an id out of range.
  assert.ok(session.cardDetail(0).colour >= 0);
});

test("the page mask runs on the screen object, not the grid", () => {
  const session = new AlbumSession(2, resources(), { playSound() {} });
  // Cards 1..12 are page one (page 0), each on its own slot.
  session.seedCollection([1, 3, 5], new Map([[1, 1], [3, 1], [5, 1]]));
  for (let frame = 0; frame < 300 && rd(session, 0x10) !== 4; frame++) session.tick([]);
  // The mask's slot flags live at the SCREEN's +0x80, one word per page cell.
  const flags = Array.from({ length: 12 }, (_, i) => session.mem.read32(session.root + 0x80 + i * 4) | 0);
  assert.deepEqual(flags.slice(0, 6), [1, 0, 1, 0, 1, 0], "the screen's slot flags are the collected cards");
  assert.equal(rd(session, 0x7c), 1, "the screen's any-collected flag is set");
  // The grid object carries its own +0x60/+0x80 but the mask never ran on it:
  // its page field is its begin-page value, not the mask's page.
  const grid = session.mem.read32(session.context + 0x44) >>> 0;
  assert.ok(grid, "the grid object was built");
  assert.equal(session.mem.read32(grid + 0x7c) | 0, 0, "the grid's any-flag was not written by the mask");
});

test("the panel headings are filled from the album's own text bank", () => {
  const session = new AlbumSession(2, resources(), { playSound() {} });
  seeded(session);
  for (let frame = 0; frame < 300 && rd(session, 0x10) !== 4; frame++) session.tick([]);
  const widgets = session.widgets.textWidgets();
  assert.equal(widgets.length, 17, "the album panel built its seventeen labels");
  // Widget 0 is the "Card Album" header, filled from bank 0x24 + language at
  // index 1 through the shared text-widget service.
  const header = widgets.find((w) => w.addr === (session.mem.read32(session.context) >>> 0));
  assert.ok(header, "the header widget is in the panel's slot list");
  assert.ok(header.lines[0].len > 0, "the header's first line was filled from the bank");
});
