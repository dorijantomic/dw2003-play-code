// The Switch-confirm panel's fold choreography.
//
// Original: F0x8008b798 runs the five fold objects (F0x8008c060 sets their
// steps: 0xA for the cards and banner, 8 for the Details plate and the tube
// row) open in cases 1-3 BEFORE the reserve list reads the pad in case 4, and
// on confirm/cancel (cases 5-8) folds them shut BEFORE the party write in
// case 8. So the swap must not land while the panel is still up, and a cancel
// folds it away with no write.
import { test } from "node:test";
import assert from "node:assert/strict";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}
// Every roster slot's species, so a reserve can be built for any slot.
const catalogue = {
  digimon: [
    { id: 1, name: "Kotemon", stats: {}, techs: [] },
    { id: 2, name: "Kumamon", stats: {}, techs: [] },
    { id: 3, name: "Monmon", stats: {}, techs: [] },
    { id: 4, name: "Agumon", stats: {}, techs: [] },
    { id: 5, name: "Veemon", stats: {}, techs: [] },
    { id: 6, name: "Guilmon", stats: {}, techs: [] },
    { id: 7, name: "Renamon", stats: {}, techs: [] },
    { id: 8, name: "Patamon", stats: {}, techs: [] },
    { id: 9, name: "Dinohumon", stats: {}, techs: [] },
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

function labState() {
  const m = (id, lvl) => ({ digimonId: id, level: lvl, xp: 0, hp: 300, maxHp: 300, mp: 100, maxMp: 100, bonuses: {}, equippedForms: [], formLedger: [] });
  return {
    party: ["p003pken", "p009rena", "p010pata"],
    partyStats: [m(1, 10), m(7, 10), m(8, 10)],
    partnerStats: m(1, 10),
    equipment: [{}, {}, {}],
    manifest: { characters: [{ id: "player" }, { id: "p003pken" }, { id: "p009rena" }, { id: "p010pata" }] },
    charId: "p003pken",
    charIdx: 1,
    rosterOwned: 0xff,      // every slot obtained: reserves wait
    reserveStats: {},
    reserveEquipment: {},
  };
}

function openReserveList(dri, state) {
  dri.openAction(0, state);
  dri.screen = "switch_from";
  dri.cursor = 0;
  dri.handleKey("circle");        // pick the lead pedestal -> reserve list, folds open
  assert.equal(dri.screen, "switch_to");
}

test("the reserve list ignores input until its folds have opened", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  openReserveList(dri, state);
  dri.handleKey("down");
  assert.equal(dri.cursor, 0, "input must be gated while the panel folds open");
  for (let i = 0; i < 12; i++) dri.update(0.02);   // 0xA open steps (integer div needs one more)
  dri.handleKey("down");
  assert.equal(dri.cursor, 1, "input works once the folds landed");
});

test("the swap lands only after the panel folds shut", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  openReserveList(dri, state);
  for (let i = 0; i < 12; i++) dri.update(0.02);
  const waiting = dri.reserveRows();
  const incoming = waiting[0];
  const before = [...state.party];
  dri.handleKey("circle");                            // confirm -> queue the swap
  assert.deepEqual(state.party, before, "the party must not change while the panel is up");
  assert.equal(dri.screen, "switch_to");
  assert.equal(state.party[0], before[0]);
  for (let i = 0; i < 12 && dri.screen === "switch_to"; i++) dri.update(0.02);
  assert.equal(dri.screen, "switch_from", "the swap lands when the shut folds finish");
  assert.equal(state.party[0], incoming.charId);
  assert.equal(dri.feedback, `${incoming.name} joined the party.`);
});

test("cancel folds the panel away without swapping", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  openReserveList(dri, state);
  for (let i = 0; i < 12; i++) dri.update(0.02);
  const before = [...state.party];
  dri.handleKey("cross");
  assert.equal(dri.screen, "switch_to", "the panel folds away first");
  assert.deepEqual(state.party, before);
  for (let i = 0; i < 12 && dri.screen === "switch_to"; i++) dri.update(0.02);
  assert.equal(dri.screen, "switch_from");
  assert.deepEqual(state.party, before, "cancel must not swap");
});
