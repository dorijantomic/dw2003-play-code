// The digivolve list's three-row window, its scrollbar and its clamps.
// Original: F0x8008e018 case 2 (cursor then offset, both clamped, no wrap) and
// F0x8008a6ac with the call site F0x8008e018:51-57 (the white thumb).
import { test } from "node:test";
import assert from "node:assert/strict";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}
const catalogue = {
  digimon: [
    { id: 1, name: "Patamon", stats: {}, techs: [] },
    { id: 20, name: "Angemon", stats: {}, techs: [] },
    { id: 21, name: "MagnaAngemon", stats: {}, techs: [] },
    { id: 22, name: "Seraphimon", stats: {}, techs: [] },
  ],
  skills: [],
  starters: {},
};
const tables = {
  chart_root_ids: [1],
  portrait_clip_by_digimon_id: { 1: 0 },
  chart_layout_by_starter_id: {
    1: [
      [
        [{ node_id: 10, digimon_id: 22, portrait_clip: 2 }],
        [{ node_id: 11, digimon_id: 21, portrait_clip: 3 }],
        [],
        [],
      ],
      [], [], [],
    ],
  },
};
globalThis.fetch = async (url) => {
  const name = String(url);
  if (name.includes("digimon.json")) return { json: async () => catalogue };
  if (name.includes("dri_tables.json")) return { json: async () => tables };
  return { json: async () => ({ starters: {} }) };
};

const { createDriMenu } = await import("../web/dri.js");

function labState() {
  return {
    party: ["p003pken", "p009rena", "p010pata"],
    partyStats: [null, null, null],
    partnerStats: {
      digimonId: 1, level: 10, hp: 500, maxHp: 500, mp: 300, maxMp: 300,
      bonuses: {}, equippedForms: [20, 21, 22], formLedger: [],
    },
    equipment: [{}, {}, {}],
    manifest: { characters: [{ id: "player" }, { id: "p003pken" }] },
    charId: "p003pken",
    charIdx: 1,
  };
}

test("the digivolve list walks its three rows before the window moves", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  dri.openAction(1, labState());
  dri.screen = "digivolve";
  dri.cursor = 0;
  dri.scroll = 0;
  // Three equipped forms plus "Do nothing." is four rows in a three-row window.
  dri.handleKey("down");
  assert.deepEqual([dri.cursor, dri.scroll], [1, 0]);
  dri.handleKey("down");
  assert.deepEqual([dri.cursor, dri.scroll], [2, 0]);
  dri.handleKey("down");
  assert.deepEqual([dri.cursor, dri.scroll], [3, 1], "the fourth row scrolls, it does not jump");
  dri.handleKey("down");
  assert.deepEqual([dri.cursor, dri.scroll], [3, 1], "the bottom clamps, it does not wrap");
});

test("going back up drags the window only from the top row", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  dri.openAction(1, labState());
  dri.screen = "digivolve";
  dri.cursor = 3;
  dri.scroll = 1;
  dri.handleKey("up");
  assert.deepEqual([dri.cursor, dri.scroll], [2, 1], "still inside the window, so it stays put");
  dri.handleKey("up");
  assert.deepEqual([dri.cursor, dri.scroll], [1, 1]);
  dri.handleKey("up");
  assert.deepEqual([dri.cursor, dri.scroll], [0, 0], "only the top row pulls the window back");
  dri.handleKey("up");
  assert.deepEqual([dri.cursor, dri.scroll], [0, 0], "the top clamps too");
});

test("a chart row whose first form is still locked drops out and the rest pack up", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  state.partnerStats.formLedger = [{ id: 21, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }];
  dri.openAction(2, state);
  dri.screen = "chart";
  dri.page = 0;
  const grid = dri.chartGrid();
  // Layout row 0 leads with a form this partner has not reached, so it is not
  // drawn as a blank line: row 1 takes its place at the top of the page.
  assert.equal(grid[0][0]?.digimon_id, 21);
  assert.equal(grid[1].some(Boolean), false);
});
