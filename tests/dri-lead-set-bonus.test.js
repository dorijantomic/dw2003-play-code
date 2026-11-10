// The lead's cached gear bonus after a DRI Form/Switch.
//
// The cache `state.partnerStats.equipBonuses` is refreshed by ONE function,
// engine/dw3/equipment.ts `syncLeadEquipBonuses`, which hands `equipmentBonuses`
// the lead's ROSTER slot (`rosterSlotOfCharId`) so the four-piece signature set
// (equipment.ts:1034 `signatureSetBonus`) is folded in. The DRI's switch used to
// rebuild the block by hand with no slot, so the set bonus was silently absent
// from the cache until another refresh route ran.
import { test } from "node:test";
import assert from "node:assert/strict";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}

// A recording storage shim: persistDriState must still write the whole state,
// and "partnerStats" is the key the cached block lands in.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

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
const {
  equipmentBonuses,
  rosterSlotOfCharId,
  SIGNATURE_SETS,
} = await import("../web/vendor/engine.js");

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
    rosterOwned: 0xff,
    reserveStats: {},
    reserveEquipment: {},
  };
}

async function switchInWearingTheSignatureSet() {
  const dri = createDriMenu();
  await dri.dataReady;
  const state = labState();
  dri.openAction(0, state);
  dri.screen = "switch_from";
  dri.cursor = 0;
  dri.handleKey("circle");                       // lead pedestal -> reserve list
  assert.equal(dri.screen, "switch_to");
  for (let i = 0; i < 12; i++) dri.update(0.02); // the open folds land
  const incoming = dri.reserveRows()[0];
  const slot = rosterSlotOfCharId(incoming.charId);
  assert.notEqual(slot, null, "the incoming reserve must be a roster partner");
  const [head, body, right, left] = SIGNATURE_SETS[slot];
  state.reserveEquipment[incoming.charId] = { head, body, right, left };
  dri.handleKey("circle");                       // confirm -> queue the swap
  for (let i = 0; i < 12 && dri.screen === "switch_to"; i++) dri.update(0.02);
  assert.equal(dri.screen, "switch_from", "the swap lands when the shut folds finish");
  assert.equal(state.party[0], incoming.charId);
  return { state, slot, gear: state.equipment[0] };
}

test("the set bonus reaches the lead's cached block after a DRI switch", async () => {
  const { state, slot, gear } = await switchInWearingTheSignatureSet();
  const withSlot = equipmentBonuses(gear, slot);
  const withoutSlot = equipmentBonuses(gear);
  // Guard: this gear only earns the set bonus through the slot.
  assert.equal(withSlot.chr - (withoutSlot.chr ?? 0), 20, "the four-piece set is +20 CHR");

  assert.deepEqual(state.partnerStats.equipBonuses, withSlot,
    "the cache must equal the one implementation's output, slot included");
  assert.notDeepEqual(state.partnerStats.equipBonuses, withoutSlot,
    "the slot-less rebuild is what loses the set bonus");
});

test("that same block is what persistDriState writes", async () => {
  const { state, slot, gear } = await switchInWearingTheSignatureSet();
  const written = JSON.parse(store.get("partnerStats"));
  assert.deepEqual(written.equipBonuses, equipmentBonuses(gear, slot));
  assert.deepEqual(written.equipBonuses, state.partnerStats.equipBonuses);
  // persistDriState still writes the rest of the state, not only the cache.
  assert.deepEqual(JSON.parse(store.get("party")), state.party);
  assert.deepEqual(JSON.parse(store.get("equipment")), state.equipment);
});
