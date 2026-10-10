// The Card Folder editor's composed session: the already-oracled pro/stcrddek
// folder-list controllers (folder-screen, folder-lifecycle, folder-picker-tick,
// folder-banks, folder-list-create, folder-list-row, folder-list-colours), the
// picker's hand-off builders and closing popup (folder-selection), the editor
// card grid (folder-card-grid) and the rename keyboard
// (folder-name-keyboard), driven together as registered tasks over the shared
// shop services. This proves the composition runs our code end to end: open,
// build the labels, count the colour spread, move the cursor, open the
// Edit/Change-name submenu, run the card grid and the name keyboard, and leave
// through the ported popup fade.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FolderSession } from "../engine/dw3/ui/folder-session.ts";

const DATA = new URL("../web/assets/data/", import.meta.url);
const CARDSHOP = new URL("../web/cardshop-data/", import.meta.url);
const BANKS = new URL("../web/assets/native/screens/banks/", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, DATA), "utf8"));
const bank = (url) => new Uint8Array(readFileSync(url));
const COLOURS = { white: 1, blue: 2, green: 3, red: 4, black: 5, brown: 6 };
const STAGES = { "in-training": 1, rookie: 2, champion: 3, ultimate: 4, mega: 5 };

/** The editor's static tables (see tools/extract_stcrddek_tables.py). */
function tables() {
  return json("stcrddek_tables.json").slabs.map((slab) => ({
    base: slab.base, bytes: new Uint8Array(Buffer.from(slab.bytes_base64, "base64")),
  }));
}

/** The four text banks, named by their decimal id in the two directories. */
function loadBanks(language) {
  const banks = new Map();
  const put = (dir, id) => { try { banks.set(id, bank(new URL(`${id}.bin`, dir))); } catch { /* absent */ } };
  put(CARDSHOP, 0x16 + language); // CARDNM
  put(CARDSHOP, 0x1d + language); // CARDST
  put(CARDSHOP, 0x32 + language); // CRDSHP
  put(BANKS, 0x86 + language);    // NAMEDT
  return banks;
}

function resources(language = 2) {
  const catalog = json("card_catalog.json");
  const cards = catalog.cards.map((card) => ({
    colour: COLOURS[card.colour] ?? 0,
    ap: card.ap ?? 0, hp: card.hp ?? 0,
    kind: card.kind === "digimon" ? 0x10 : (card.programCategory ?? 0),
    programCost: card.programCost ?? card.cost ?? 0, summonCost: card.summonCost ?? 0,
    level: card.level ?? STAGES[card.stage] ?? 0,
  }));
  const font = bank(new URL("shop_font.bin", DATA));
  const red = Array.from({ length: 40 }, (_, i) => i + 1);
  const white = Array.from({ length: 40 }, (_, i) => i + 41);
  const folders = [
    { name: "Ted", cards: red },
    { name: "Amy", cards: white },
    { name: "", cards: [] },
  ];
  return { banks: loadBanks(language), cards, font, folders, tables: tables() };
}

const rd = (session, offset) => session.mem.read32(session.root + offset) | 0;

test("the folder chooser opens, counts colours, moves the cursor and leaves", () => {
  const res = resources();
  const session = new FolderSession(2, res, { playSound() {} });
  for (let frame = 0; frame < 400 && rd(session, 0x10) !== 4; frame++) session.tick([]);
  assert.equal(rd(session, 0x10), 4, "the chooser settles on the three-folder menu");

  // 24 labels: 1 prompt + 3 rows x (1 name + 6 counters) + 2 submenu.
  assert.equal(session.widgets.textWidgets().length, 25, "the chooser built its twenty-four labels and the cursor partner");

  // Folder 0's six colour counters: the colour spread of its forty cards.
  const catalog = json("card_catalog.json").cards;
  const expected = [0, 0, 0, 0, 0, 0];
  for (const id of res.folders[0].cards) expected[(COLOURS[catalog[id - 1].colour] ?? 0) - 1] += 1;
  const counters = Array.from({ length: 6 }, (_, k) => session.mem.read32(session.root + 0x74 + k * 4) | 0);
  assert.deepEqual(counters, expected, "folder 0's counters are the colour spread of its forty cards");
  assert.equal(counters.reduce((a, b) => a + b, 0), 40, "every one of the forty cards counted once");

  // The cursor moves with up/down (word bits 4 and 6, the picker's own reads).
  session.tick(["down"]); session.tick([]);
  assert.equal(rd(session, 0x60), 1, "down moves the cursor to folder two");
  session.tick(["up"]); session.tick([]);
  assert.equal(rd(session, 0x60), 0, "up moves it back");

  // Circle (word bit 0x2000 = the picker's 0xD) opens the Edit/Change submenu.
  session.tick(["circle"]); session.tick([]);
  for (let f = 0; f < 30; f++) session.tick([]);
  assert.equal(rd(session, 0x10), 0xd, "circle opens the two-row submenu");

  // The submenu's own cursor toggles with the picker's 0x58 flag.
  session.tick(["down"]); session.tick([]);
  assert.equal(rd(session, 0x70), 1, "down selects the second submenu row (Change name)");

  // Cross (word bit 0x4000 = the picker's 0xE) cancels the submenu back to the menu.
  session.tick(["cross"]); session.tick([]);
  for (let f = 0; f < 60; f++) session.tick([]);
  assert.equal(rd(session, 0x10), 4, "cancel returns to the three-folder menu");

  // Cross on the menu leaves through the ported popup fade and ends the screen.
  session.tick(["cross"]); session.tick([]);
  let sawFade = false;
  for (let frame = 0; frame < 200 && !session.finished(); frame++) {
    session.tick([]);
    if (session.fadeLevel() > 0) sawFade = true;
  }
  assert.ok(session.finished(), "the chooser finishes after the leave popup fades");
  assert.ok(sawFade, "the leave popup drove a visible fade");
});

test("the folder detail reads the disc CARDPAK record, not a colour-only table", () => {
  const res = resources();
  const session = new FolderSession(2, res, { playSound() {} });
  const catalog = json("card_catalog.json").cards;
  for (const id of [1, 2, 3, 61, 100, 315]) {
    const card = catalog[id - 1];
    const detail = session.cardDetail(id);
    assert.equal(detail.colour, COLOURS[card.colour] ?? 0, `card ${id} colour`);
    assert.equal(detail.ap, card.ap ?? 0, `card ${id} AP`);
    assert.equal(detail.hp, card.hp ?? 0, `card ${id} HP`);
    assert.equal(detail.summonCost, card.summonCost ?? 0, `card ${id} summon cost`);
    if (card.kind === "digimon") assert.equal(detail.kindWord, 0, `Digimon ${id} shows AP/HP`);
  }
  // A Digimon shows its real AP; a Program takes the class plate (nonzero word).
  assert.equal(session.cardDetail(61).ap, 62, "Imperialdramon-P reads AP 62");
  const program = catalog.find((card) => card.kind === "program");
  assert.notEqual(session.cardDetail(program.id).kindWord, 0, "a Program card shows its plate");
});

test("the folder records read back exactly as they were seeded", () => {
  const res = resources();
  const session = new FolderSession(2, res, { playSound() {} });
  const result = session.result();
  assert.equal(result.length, 3);
  assert.deepEqual(result[1].cards, res.folders[1].cards, "folder two's forty card ids round-trip");
  // "Ted" in the walker's folder-name glyph encoding (T = 14 + 'T' - 'A').
  assert.deepEqual(result[0].nameBytes, [33, 44, 43], "folder one's name round-trips");
});

function openSubmenu(session) {
  for (let frame = 0; frame < 400 && rd(session, 0x10) !== 4; frame++) session.tick([]);
  session.tick(["circle"]); session.tick([]);
  for (let f = 0; f < 30; f++) session.tick([]);
  assert.equal(rd(session, 0x10), 0xd, "the submenu is open");
}

test("choosing Edit Folder runs the card grid, no part throws", () => {
  const session = new FolderSession(2, resources(), { playSound() {} });
  openSubmenu(session);
  // Circle on row 0 (cursor 0 = Edit Folder, the picker's 0xD) hands off the grid.
  session.tick(["circle"]); session.tick([]);
  let gridSeen = false;
  for (let f = 0; f < 400; f++) {
    session.tick([]);
    const child = session.diagnostics().child;
    if (child && session.tree.tasks.has(child) && session.tree.tasks.get(child).classId === 0x80086574) gridSeen = true;
  }
  assert.ok(gridSeen, "the edit-folder hand-off built the card grid task");
});

test("choosing Change name runs the rename keyboard, no part throws", () => {
  const session = new FolderSession(2, resources(), { playSound() {} });
  openSubmenu(session);
  // Down moves the submenu cursor to row 1 (Change name), then the picker's 0xD.
  session.tick(["down"]); session.tick([]);
  assert.equal(rd(session, 0x70), 1, "row 1 (Change name) is selected");
  session.tick(["circle"]); session.tick([]);
  let keyboardSeen = false;
  for (let f = 0; f < 400; f++) {
    session.tick([]);
    const child = session.diagnostics().child;
    if (child && session.tree.tasks.has(child) && session.tree.tasks.get(child).classId === 0x800884e8) keyboardSeen = true;
  }
  assert.ok(keyboardSeen, "the change-name hand-off built the rename keyboard task");
});
