// The training gym's blips, pinned to pro/stgtrain.s's own call sites.
//
// The gym's cues live in four ported children of stgtrain (each lane-b oracled
// against the original):
//   F0x8008517C (gym-flow.ts)     pod select: move 0x0004001B (file 0x285c),
//                                 Circle 0x0004001C (0x28e8), Cross 0x800450BD (0x2954)
//   F0x8008AAD4 (gym-picker.ts)   drill picker: moves 0x0004001B (0x815c/0x85e0),
//                                 Circle 0x0004001B (0x8654), Cross 0x800450BD (0x86f4)
//   F0x800888BC (gym-confirm.ts)  TP slider move 0x0004001B (0x5f68), Circle
//                                 0x0004001C (0x5fc4), Cross 0x800450BD (0x6090);
//                                 refusal dismiss 0x0004001C (0x6164); Yes/No move
//                                 0x8004513E (0x64d8), Circle 0x8004503C (0x6554),
//                                 Cross 0x800450BD (0x660c)
//   F0x8008706C (gym-training.ts) Challenge/As-is move 0x8004513E (0x4e90),
//                                 Circle 0x8004503C (0x4f0c), Cross 0x800450BD (0x4f80);
//                                 summary continue 0x0004001C (0x46c8/0x4afc/0x4b90)
// RAM = file + 0x80082cb0 (recovered/ddw3/function-inventory.json, pro/stgtrain).
//
// web/gym.js is the ?legacyGym=1 rollback; it used the pre-2026-07-03i shifted
// cue names, so its backs played "system02" (0x8004513E), its Yes/No confirm
// played the stepper words, and the drill picker's Circle played 0x0004001C.
// Fixed 2026-10-14 on audit/sfx-save-pause-vs-decode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
global.fetch = async (url) => {
  const file = path.join(WEB, String(url));
  const body = readFileSync(file, "utf8");
  return { ok: true, json: async () => JSON.parse(body) };
};

const { createGym } = await import("../web/gym.js");

const MANIFEST = JSON.parse(readFileSync(path.join(WEB, "assets/sfx/manifest.json"), "utf8"));

function mockSfx() {
  const plays = [];
  return { plays, play: (n) => plays.push(n) };
}

/** Press and assert the FIRST cue of the press (screen transitions add folds after it). */
function pressFirst(sfx, g, key, state, expected) {
  const at = sfx.plays.length;
  g.handleKey(key, state);
  assert.equal(sfx.plays[at], expected, `plays=${sfx.plays}`);
}

function fakeState(partySize) {
  const party = ["p009rena", "p006agum", "p007vmon"].slice(0, partySize);
  return {
    party,
    partnerStats: { digimonId: 7, level: 15, xp: 0, tp: 70, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999, stats: {}, elemBonuses: {} },
    partyStats: party.map(() => null),
    digimonNames: {},
    inventory: [],
    equipment: [],
  };
}

test("the gym's names resolve to stgtrain's own packed ids", () => {
  assert.equal(MANIFEST.system06.id, "0x0004001b");
  assert.equal(MANIFEST.system07.id, "0x0004001c");
  assert.equal(MANIFEST.system00.id, "0x8004503c");
  assert.equal(MANIFEST.system01.id, "0x800450bd");
  assert.equal(MANIFEST.system02.id, "0x8004513e");
});

test("pod select: moves, Circle and Cross carry the flow's own cues", async () => {
  const sfx = mockSfx();
  const g = createGym(sfx);
  const state = fakeState(3);
  await g.open(state);
  assert.equal(g.screen, "select");
  g.selSlot = 0;
  pressFirst(sfx, g, "right", state, "system06");
  pressFirst(sfx, g, "circle", state, "system07");
  assert.equal(g.screen, "drill");
  pressFirst(sfx, g, "cross", state, "system01");
});

test("drill picker: the Circle confirm is the picker's own 0x0004001b, not 0x0004001c", async () => {
  const sfx = mockSfx();
  const g = createGym(sfx);
  const state = fakeState(1);
  await g.open(state);
  assert.equal(g.screen, "drill");
  pressFirst(sfx, g, "circle", state, "system06");   // pick the highlighted drill
  assert.equal(g.screen, "tp");
  pressFirst(sfx, g, "cross", state, "system01");    // back from the TP panel
});

test("TP panel: slider move, confirm, refusal and cancel", async () => {
  const sfx = mockSfx();
  const g = createGym(sfx);
  const state = fakeState(1);
  await g.open(state);
  g.screen = "tp";
  g.tpSel = 0;
  pressFirst(sfx, g, "right", state, "system06");
  pressFirst(sfx, g, "circle", state, "system07");   // enough TP -> the Yes/No prompt
  assert.equal(g.screen, "confirm");
  g.screen = "tp";
  state.partnerStats.tp = 0;                         // the refusal
  pressFirst(sfx, g, "circle", state, "system07");
  assert.equal(g.tpWarn, true);
  pressFirst(sfx, g, "cross", state, "system01");
});

test("the Yes/No prompt: 0x8004513e moves, 0x8004503c on either row, 0x800450bd back", async () => {
  const sfx = mockSfx();
  const g = createGym(sfx);
  const state = fakeState(1);
  await g.open(state);
  g.screen = "confirm";
  g.confirmSel = 0;
  pressFirst(sfx, g, "down", state, "system02");
  assert.equal(g.confirmSel, 1);
  pressFirst(sfx, g, "circle", state, "system00");   // No -> back to the TP panel
  assert.equal(g.screen, "tp");
  g.screen = "confirm";
  g.confirmSel = 0;
  pressFirst(sfx, g, "circle", state, "system00");   // Yes -> the session starts
  assert.equal(g.screen, "reps");
  g.screen = "confirm";
  pressFirst(sfx, g, "cross", state, "system01");
});

test("the Challenge / As-is menu: 0x8004513e moves and 0x8004503c confirm", async () => {
  const sfx = mockSfx();
  const g = createGym(sfx);
  const state = fakeState(1);
  await g.open(state);
  g.screen = "ultra";
  g.ultraSel = 0;
  pressFirst(sfx, g, "down", state, "system02");
  g.ultraSel = 1;                                    // As is — no drill entry needed
  pressFirst(sfx, g, "circle", state, "system00");
});

test("no back on this screen plays a cursor-move word", async () => {
  const src = readFileSync(new URL("../web/gym.js", import.meta.url), "utf8");
  assert.ok(!/cross"\) \{ sfx\?\.play\("system02"\)/.test(src),
    "a Cross handler still plays the move cue");
});
