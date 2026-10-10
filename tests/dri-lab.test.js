// Lab desk behaviours added 2026-09-02: fold, standing form, load prompt, chart clamp.
import { test } from "node:test";
import assert from "node:assert/strict";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}
globalThis.fetch = async () => ({ json: async () => ({ digimon: [], skills: [], starters: {} }) });

const { createDriMenu } = await import("../web/dri.js");
function partyState() {
  return {
    party: ["p003pken", "p009rena", "p010pata"],
    partyStats: [null, null, null],
    partnerStats: {
      digimonId: 1, level: 10, hp: 500, maxHp: 500, mp: 300, maxMp: 300,
      bonuses: {}, equippedForms: [], formLedger: [],
    },
    equipment: [{}, {}, {}],
    manifest: { characters: [{ id: "player" }, { id: "p003pken" }] },
    charId: "p003pken",
    charIdx: 1,
  };
}

test("Select Action still dims out over 30 frames after the fold starts", async () => {
  const dri = createDriMenu();
  dri.open();
  dri.handleKey("cross");
  assert.equal(dri.isOpen(), true);
  dri.update(0.3);
  assert.equal(dri.isOpen(), true);
  dri.update(0.3);
  assert.equal(dri.isOpen(), false);
});

test("chart L1/R1 clamp instead of wrapping", async () => {
  const dri = createDriMenu();
  dri.openAction(2, partyState());
  dri.screen = "chart";
  dri.page = 0;
  dri.handleKey("l1");
  assert.equal(dri.page, 0);
  dri.page = 3;
  dri.handleKey("r1");
  assert.equal(dri.page, 3);
});

test("Load? is a Yes/No prompt, not an instant toggle", async () => {
  const dri = createDriMenu();
  const state = partyState();
  state.partnerStats.formLedger = [{
    id: 1, formLevel: 99, dvexp: 0,
    techSlots: [0x2069, 0, 0, 0, 0, 0],
  }];
  dri.openAction(1, state);
  dri.digimonById = { 1: { id: 1, name: "Kotemon" } };
  dri.screen = "load_tech";
  dri.selectedPartner = 0;
  dri.cursor = 0;
  dri.handleKey("circle");
  assert.equal(dri.prompt?.message, "Load?");
  assert.equal(state.partnerStats.formLedger[0].techSlots[0] & 0x4000, 0);
  dri.handleKey("circle");
  assert.equal(state.partnerStats.formLedger[0].techSlots[0] & 0x4000, 0x4000);
  assert.equal(dri.prompt, null);
});

test("a loaded row offers Turn load off? first, even without the 0x2000 bit", async () => {
  // The decoded classification order (technique-loading-decoded.md): a 0x4000
  // row is "Turn load off?" before the signature / not-yet-learned / cap checks.
  const dri = createDriMenu();
  const state = partyState();
  state.partnerStats.formLedger = [{
    id: 1, formLevel: 99, dvexp: 0,
    techSlots: [0x4069, 0, 0, 0, 0, 0],   // loaded, but no 0x2000
  }];
  dri.openAction(1, state);
  dri.digimonById = { 1: { id: 1, name: "Kotemon" } };
  dri.screen = "load_tech";
  dri.selectedPartner = 0;
  dri.cursor = 0;
  dri.handleKey("circle");
  assert.equal(dri.prompt?.message, "Turn load off?");
  dri.handleKey("circle");
  assert.equal(state.partnerStats.formLedger[0].techSlots[0] & 0x4000, 0);
  assert.equal(dri.prompt, null);
});

test("logical 0x0C opens the Switch details view and the back bit closes it first", async () => {
  // The decoded Details view is the F0x8008E8D0 object (render F0x8008e4cc).
  // Its toggle is logical 0x0C (docs/research/ui/dri-gap-2026-09-02.md C3), which
  // is word bit 0x1000 and the walker's name "triangle"; it owns the screen while
  // it is up, so the back bit (0x4000, "cross") closes it instead of cancelling.
  const dri = createDriMenu();
  await dri.dataReady;
  const state = partyState();
  dri.openAction(0, state);
  assert.equal(dri.screen, "switch_from");
  dri.handleKey("triangle");
  assert.equal(dri.details, true, "the Details toggle must open the detail view");
  dri.handleKey("cross");
  assert.equal(dri.details, false, "the back bit must close the detail view");
  assert.equal(dri.screen, "switch_from", "closing details must not cancel the switch");
});
