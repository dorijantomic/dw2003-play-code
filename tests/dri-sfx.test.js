// The DRI desk's sound triggers, pinned to the overlay's own call sites.
//
// stgdglab.s, RAM = file + 0x80082c70. The desk's root cursor plays the list
// blip 0x8004513E (F0x80088b5c; dri-gap-2026-09-02.md B7), but the SWITCH
// lists are a different handler: F0x8008b798 case 4 plays 0x0004001B on a
// changed cursor (`if (temp_s4 != arg0->unk60) { 0x80055C48(0x4001B); }`,
// F0x8008b798.c:98-101), the Details toggle (logical 0xC) plays 0x0004001C
// when the highlighted entry is valid (F0x8008b798.c:112-116), and the
// confirm (logical 0xD) plays 0x0004001C with 0x800450BD on the gate's else
// arm (F0x8008b798.c:117-121). True Sound Test names (soundtst-common-ids.json):
// 0x8004513E = SYSTEM02, 0x0004001B = SYSTEM06, 0x0004001C = SYSTEM07,
// 0x800450BD = SYSTEM01. Corrected 2026-10-14 (audit/sfx-triggers-vs-decode):
// the switch lists played the root desk's blips because the wiring used the
// pre-2026-07-03i shifted cue names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}
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
const man = JSON.parse(readFileSync("web/assets/sfx/manifest.json", "utf8"));

function spy() {
  const played = [];
  return { played, play: (n) => played.push(n) };
}

function labState(owned = 0) {
  const m = (id, lvl) => ({ digimonId: id, level: lvl, xp: 0, hp: 300, maxHp: 300, mp: 100, maxMp: 100, bonuses: {}, equippedForms: [], formLedger: [] });
  return {
    party: ["p003pken", "p009rena", "p010pata"],
    partyStats: [m(1, 10), m(7, 10), m(8, 10)],
    partnerStats: m(1, 10),
    equipment: [{}, {}, {}],
    manifest: { characters: [{ id: "player" }, { id: "p003pken" }, { id: "p009rena" }, { id: "p010pata" }] },
    charId: "p003pken",
    charIdx: 1,
    rosterOwned: owned,       // 0: nobody waits; 0xff: reserves wait
    reserveStats: {},
    reserveEquipment: {},
  };
}

test("the cue names resolve to the ids the sites carry", () => {
  assert.equal(man.system06.id, "0x0004001b");   // switch-list move
  assert.equal(man.system07.id, "0x0004001c");   // details / confirm
  assert.equal(man.system02.id, "0x8004513e");   // root desk move
  assert.equal(man.system01.id, "0x800450bd");   // cancel / refusal
});

test("the switch lists' cursor blip is 0x4001b (SYSTEM06)", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const sfx = spy();
  dri.openAction(0, labState(0xff));
  assert.equal(dri.screen, "switch_from");
  dri.handleKey("down", sfx);
  assert.deepEqual(sfx.played, ["system06"], "Switch who? cursor");
  // And the reserve list is the same handler's site.
  dri.cursor = 0;
  dri.handleKey("circle", sfx);
  assert.equal(dri.screen, "switch_to");
  for (let i = 0; i < 12; i++) dri.update(0.02);
  sfx.played.length = 0;
  dri.handleKey("down", sfx);
  assert.deepEqual(sfx.played, ["system06"], "Switch with who? cursor");
});

test("the Details toggle plays 0x4001c (SYSTEM07)", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const sfx = spy();
  dri.openAction(0, labState(0xff));
  dri.handleKey("triangle", sfx);
  assert.equal(dri.details, true);
  assert.deepEqual(sfx.played, ["system07"]);
});

test("the switch confirm plays 0x4001c; an empty reserve plays the cancel blip 0x800450bd", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const sfx = spy();
  dri.openAction(0, labState(0xff));
  dri.handleKey("circle", sfx);
  // The confirm blip, then the reserve panel's fold-open blip (0x40019,
  // SYSTEM03) as the panel comes up.
  assert.equal(sfx.played[0], "system07", "confirm with a waiting partner");
  assert.deepEqual(sfx.played.slice(1), ["system03"]);

  const dri2 = createDriMenu();
  await dri2.dataReady;
  const sfx2 = spy();
  dri2.openAction(0, labState(0));     // nobody waits
  dri2.handleKey("circle", sfx2);
  assert.deepEqual(sfx2.played, ["system01"], "refused confirm: the gate's else arm");
  assert.equal(dri2.feedback, "No Digimon is waiting.");
  assert.equal(dri2.screen, "switch_from");
});

test("the root desk's cursor keeps the list blip 0x4513e (SYSTEM02)", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  const sfx = spy();
  dri.openAction(0, labState(0xff));
  dri.screen = "root";
  dri.cursor = 0;
  dri.handleKey("down", sfx);
  assert.deepEqual(sfx.played, ["system02"]);
});
