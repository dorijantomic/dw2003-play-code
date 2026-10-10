// The Digimon Lab desk's held-direction repeat.
//
// The original screens read BOTH the pad service's pressed word and its
// auto-repeat word when moving a cursor (F0x8008b798 case 4 reads the pressed
// bit and the repeat bit for the reserve list), so a held direction walks the
// list. The shared repeat curve is decoded as edge + 16 + 6 then every 4 ticks
// (PAD_REPEAT / padRepeatFires, claim SHARED-INPUT-PAD-REPEAT). The walker's
// keydown path fires the edge and web/dri.js's update fires the repeats.
import { test } from "node:test";
import assert from "node:assert/strict";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}
const catalogue = {
  digimon: [
    { id: 1, name: "Kotemon", stats: {}, techs: [] },
    { id: 7, name: "Renamon", stats: {}, techs: [] },
    { id: 8, name: "Patamon", stats: {}, techs: [] },
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
  return {
    party: ["p003pken", "p009rena", "p010pata"],
    partyStats: [null, null, null],
    partnerStats: { digimonId: 1, level: 10, hp: 500, maxHp: 500, mp: 300, maxMp: 300, bonuses: {}, equippedForms: [], formLedger: [] },
    equipment: [{}, {}, {}],
    manifest: { characters: [{ id: "player" }, { id: "p003pken" }, { id: "p009rena" }, { id: "p010pata" }] },
    charId: "p003pken",
    charIdx: 1,
    rosterOwned: 0xff,        // every slot obtained: plenty waiting
    reserveStats: {},
    reserveEquipment: {},
  };
}

test("a held direction repeats on the pad service's 16/6/4 curve", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  dri.openAction(0, labState());
  dri.screen = "switch_from";
  dri.cursor = 0;
  const held = new Set(["down"]);
  // The keydown fired the edge; the held ladder starts at the next tick.
  for (let n = 1; n <= 16; n++) dri.update(0.02, held);
  assert.equal(dri.cursor, 0, "no repeat before the first 16-tick beat");
  dri.update(0.02, held);                                  // n = 17
  assert.equal(dri.cursor, 1, "the first repeat lands on the 17th held tick");
  for (let n = 18; n <= 22; n++) dri.update(0.02, held);
  assert.equal(dri.cursor, 1, "still inside the 6-tick gap");
  dri.update(0.02, held);                                  // n = 23
  assert.equal(dri.cursor, 2, "the second repeat lands 6 ticks later");
  // Releasing resets the ladder; a fresh hold waits the full 16 again.
  dri.update(0.02, new Set());
  for (let n = 1; n <= 16; n++) dri.update(0.02, held);
  assert.equal(dri.cursor, 2, "a fresh hold waits the full 16 ticks");
  dri.update(0.02, held);                                  // n = 17
  assert.equal(dri.cursor, 0, "the third pedestal wraps to the first");
});

test("no held key means no cursor movement", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  dri.openAction(0, labState());
  dri.screen = "switch_from";
  dri.cursor = 1;
  for (let n = 0; n < 40; n++) dri.update(0.02, new Set());
  assert.equal(dri.cursor, 1);
  dri.update(0.02);                                        // no held set at all
  assert.equal(dri.cursor, 1);
});

test("the reserve list repeats as well", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  dri.openAction(0, labState());
  dri.screen = "switch_to";
  dri.switchFrom = 0;
  dri.cursor = 0;
  const waiting = dri.reserveRows();
  assert.ok(waiting.length >= 2, "fixture must have two waiting partners");
  const held = new Set(["right"]);
  for (let n = 1; n <= 16; n++) dri.update(0.02, held);
  assert.equal(dri.cursor, 0);
  dri.update(0.02, held);                                  // n = 17
  assert.equal(dri.cursor, 1, "the reserve row advances on the first repeat");
});
