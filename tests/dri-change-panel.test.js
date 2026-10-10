// The Change-digivolve-type grid's message panel.
//
// Original: F0x80085dd0 state 2 opens the panel when the confirmed cell is the
// form the partner already stands as (roster record +0x764, claim
// roster-record-764-is-current-form-id-2026-09-14); F0x80085c50 fills four rows
// with the three equipped forms and "Don't set." (esdglabo 0x2C) plus the
// Battle Digivolve hint (0x2B); state 4 walks a cursor at +0xFC over the four
// rows and confirm writes record+0x764 = the chosen equipped form, or 0 for
// "Don't set."; the cancel arm writes 0 too. Widgets in F0x80085470: rows at
// (0xA7, 0x83+0xE*i), cursor at (0x9A, 0x83+0xE*i), hint at (0x14,0xC3).
import { test } from "node:test";
import assert from "node:assert/strict";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}
const catalogue = {
  digimon: [
    { id: 1, name: "Kotemon", stats: {}, techs: [] },
    { id: 9, name: "Dinohumon", stats: {}, techs: [] },
    { id: 27, name: "Taomon", stats: {}, techs: [] },
    { id: 39, name: "Sakuyamon", stats: {}, techs: [] },
    { id: 41, name: "MetalGarurumon", stats: {}, techs: [] },
  ],
  skills: [],
  starters: {},
};
globalThis.fetch = async (url) => {
  if (String(url).includes("digimon.json")) return { json: async () => catalogue };
  if (String(url).includes("dri_tables.json")) return { json: async () => ({ chart_root_ids: [], chart_layout_by_starter_id: {}, portrait_clip_by_digimon_id: {} }) };
  return { json: async () => ({ starters: {} }) };
};

const { createDriMenu } = await import("../web/dri.js");

// The panel folds open (0xA steps) before it takes input and folds shut before
// it clears; tick the menu until the fold lands.
function settle(dri, wantPanel = null) {
  for (let i = 0; i < 20; i++) {
    if (wantPanel === null && dri.panel === null) return;
    dri.update(0.02);
  }
}

// The digivolve "Select Action" submenu folds its own windows open on entry and
// shuts them before a child runs (F0x8008820c / F0x80087600 cases 2-4).
function settleFolds(dri) {
  for (let i = 0; i < 20; i++) {
    if (!dri.folds || Object.values(dri.folds).every((f) => !f.active)) return;
    dri.update(0.02);
  }
}

// The partner stands as Dinohumon (15 is the ledger id that maps to a form;
// use 9 here — the fixture's form ids are 9/27/39) with Taomon/Sakuyamon
// equipped, so the grid's first cell is the form it already stands as.
function labState() {
  const lead = {
    digimonId: 9, level: 20, xp: 0, hp: 400, maxHp: 400, mp: 160, maxMp: 160,
    bonuses: {}, elemBonuses: {},
    equippedForms: [27, 39, 0],
    formLedger: [
      { id: 9, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 27, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 39, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 41, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
    ],
  };
  const other = { digimonId: 27, level: 10, hp: 300, maxHp: 300, mp: 100, maxMp: 100, bonuses: {}, equippedForms: [], formLedger: [] };
  return {
    party: ["p003pken", "p009rena"],
    partyStats: [lead, other],
    partnerStats: lead,
    equipment: [{}, {}],
    manifest: { characters: [{ id: "player" }, { id: "p003pken" }, { id: "p009rena" }] },
    charId: "p003pken",
    charIdx: 1,
    rosterOwned: 0xff,
    reserveStats: {},
    reserveEquipment: {},
  };
}

function openGrid(dri, state) {
  dri.openAction(1, state);
  dri.screen = "change_type";
  dri.selectedPartner = 0;
  dri.cursor = 0;
  dri.page = 0;
}

test("picking the form the partner already stands as opens the panel", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  openGrid(dri, state);
  dri.handleKey("circle");
  assert.deepEqual(dri.panel, { cursor: 0 }, "the message panel must open");
  assert.equal(state.partnerStats.digimonId, 9, "opening the panel must not change the form");
  settle(dri, "open");
});

test("the cursor walks the four rows and clamps", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  openGrid(dri, state);
  dri.handleKey("circle");
  settle(dri, "open");
  dri.handleKey("up");
  assert.equal(dri.panel.cursor, 0, "the top row clamps");
  for (let i = 0; i < 6; i++) dri.handleKey("down");
  assert.equal(dri.panel.cursor, 3, "the fourth row is the bottom and clamps");
});

test("confirm stands as the chosen equipped form", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  openGrid(dri, state);
  dri.handleKey("circle");     // open the panel (cell 0 = the current form)
  settle(dri, "open");
  dri.handleKey("down");      // row 1 = the second equipped form (39)
  dri.handleKey("circle");
  settle(dri);
  assert.equal(dri.panel, null, "the panel closes on confirm");
  assert.equal(state.partnerStats.digimonId, 39, "the chosen equipped form becomes the standing form");
});

test("\"Don't set.\" returns the partner to its rookie form", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  openGrid(dri, state);
  dri.handleKey("circle");
  settle(dri, "open");
  dri.handleKey("down"); dri.handleKey("down"); dri.handleKey("down");   // row 3
  dri.handleKey("circle");
  settle(dri);
  assert.equal(dri.panel, null);
  assert.equal(state.partnerStats.digimonId, 1, "row 4 writes 0 -> the rookie form");
});

test("cancel clears the standing form to the rookie and closes", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  openGrid(dri, state);
  dri.handleKey("circle");
  settle(dri, "open");
  dri.handleKey("cross");
  settle(dri);
  assert.equal(dri.panel, null);
  assert.equal(state.partnerStats.digimonId, 1, "the cancel arm writes 0 as well");
});

test("the grid folds in on entry before it takes input", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  // Real transition: Digivolve picker -> Select Action -> Change digivolve type.
  dri.openAction(1, state);
  dri.handleKey("circle");
  assert.equal(dri.screen, "digivolve_menu");
  settleFolds(dri);                             // the submenu windows fold open
  dri.handleKey("circle");                       // confirm -> the child waits for the shut
  settleFolds(dri);
  assert.equal(dri.screen, "change_type");
  assert.ok(dri.gridFold && dri.gridFold.active, "the entry fold must start");
  dri.handleKey("circle");                       // ignored while the grid folds in
  assert.equal(dri.panel, null, "input must be gated until the fold lands");
  for (let i = 0; i < 12; i++) dri.update(0.02);
  dri.handleKey("circle");                       // cell 0 = the current form
  assert.ok(dri.panel, "the grid takes input once the fold lands");
});

test("under four acquired forms the Change-type row is refused", async () => {
  // F0x80087600 case 2: cursor 0 (Change digivolve type.) needs enumerate_acquired
  // >= 4; with fewer it takes the 0x1E arm and writes esdglabo 0x24 at (0xA4,0xB8).
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  state.partnerStats.formLedger = state.partnerStats.formLedger.slice(0, 3);
  dri.openAction(1, state);
  dri.handleKey("circle");                 // picker -> Select Action submenu
  assert.equal(dri.screen, "digivolve_menu");
  settleFolds(dri);                       // the submenu windows fold open
  dri.handleKey("circle");                 // Change digivolve type.
  assert.equal(dri.screen, "digivolve_menu", "the grid must not open");
  assert.equal(dri.feedback, "Can't change digivolve.");
  assert.equal(dri._menuLeave, null, "a refusal must not queue the shut-and-child path");
});

test("four acquired forms open the Change-type grid", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  dri.openAction(1, state);
  dri.handleKey("circle");
  settleFolds(dri);
  dri.handleKey("circle");
  settleFolds(dri);
  assert.equal(dri.screen, "change_type");
  assert.ok(dri.gridFold && dri.gridFold.active, "the entry fold must start");
});
