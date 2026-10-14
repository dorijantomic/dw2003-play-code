// The pause menu's heal cue, pinned to the appliers' own call sites.
//
// The item applier F0x8008F584 (pro/ststatus.s, file 0xC8D4) plays two words:
//   0x00040014 RECOVERY on the applied path  — file 0xcbc8, `ori $a0,0x14`
//     in the delay slot of `j 0x8008f8c4` (after the consume at :13039)
//   0x0004001c SYSTEM07 with "No effect."     — file 0xcc10, `ori $a0,0x1c`
// The technique applier F0x80093A58 (its port is
// engine/dw3/ui/native/pause-techniques.ts) plays 0x00040014 when the heal
// landed and otherwise replays the confirm cue its caller just played — the
// "Use it on who?" confirm is 0x4001C (:19550) and the party-wide list's is
// 0x8004503C (:19292).
//
// The hand-written copy (web/menu.js, the ?legacyStatus=1 rollback) used to
// play "savedemo" (0x00040015 — a different sample) on a landed heal and
// "system01" (0x800450BD — the back cue) on a refusal; both are the divergence
// row in docs/research/ui/pause-home-button-table-2026-10-04.md §13. Fixed
// 2026-10-14 on audit/sfx-save-pause-vs-decode. The translated pause pages
// already carried the right ids (pause-bag.ts itemsApplyEffect).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MANIFEST = JSON.parse(
  readFileSync(new URL("../web/assets/sfx/manifest.json", import.meta.url), "utf8"),
);

if (typeof globalThis.localStorage === "undefined") {
  const mem = Object.create(null);
  globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

// The pause menu asks for its Digimon/skill table at construction; answer with
// the one technique this file drives.
globalThis.fetch = async () => ({
  json: async () => ({
    digimon: [{ id: 4, name: "Agumon", stats: {}, techs: [] }],
    skills: [{ id: 501, name: "Heal", mp_cost: 2, power: 40 }],
    starters: {},
  }),
});
const { createMenu } = await import("../web/menu.js");

const TECH = 501;
const POWER_CHARGE = 43; // "Heal HP by 500"

function mockSfx() {
  const plays = [];
  return { plays, play: (n) => plays.push(n) };
}

function menuWithSfx() {
  const sfx = mockSfx();
  const m = createMenu(sfx);
  m.reset();
  return { m, sfx };
}

function healState({ hp = 5, maxHp = 100, mp = 50 } = {}) {
  return {
    party: ["p006agum"],
    partnerStats: { digimonId: 4, level: 10, hp, maxHp, mp, maxMp: 50 },
    partyStats: [null],
    digimonNames: {},
    inventory: [],
  };
}

test("the heal names resolve to the appliers' own packed ids", () => {
  assert.equal(MANIFEST.recovery.id, "0x00040014");
  assert.equal(MANIFEST.system07.id, "0x0004001c");
  assert.equal(MANIFEST.system00.id, "0x8004503c");
});

test("a technique that lands plays RECOVERY (0x00040014)", async () => {
  const { m, sfx } = menuWithSfx();
  await m.ensureData();
  const state = healState({ hp: 5 });
  m.statusCursor = 0;
  m.applyTechnique(state, TECH, 0);
  assert.deepEqual(sfx.plays, ["recovery"], `plays=${sfx.plays}`);
  assert.ok(state.partnerStats.hp > 5, "the heal landed");
});

test("a technique with no effect replays the confirm cue (0x0004001c)", async () => {
  const { m, sfx } = menuWithSfx();
  await m.ensureData();
  const state = healState({ hp: 100, maxHp: 100 });   // already full
  m.statusCursor = 0;
  m.applyTechnique(state, TECH, 0);
  assert.deepEqual(sfx.plays, ["system07"], `plays=${sfx.plays}`);
  assert.equal(m.feedbackMsg, "No effect.");
});

test("not enough MP replays the confirm cue too, never the back cue", async () => {
  const { m, sfx } = menuWithSfx();
  await m.ensureData();
  const state = healState({ hp: 5, mp: 0 });
  m.statusCursor = 0;
  m.applyTechnique(state, TECH, 0);
  assert.deepEqual(sfx.plays, ["system07"], `plays=${sfx.plays}`);
  assert.ok(!sfx.plays.includes("system01"), "the refusal is not a back");
});

test("the party-wide list's refusal replays that list's own cue (0x8004503c)", async () => {
  const { m, sfx } = menuWithSfx();
  await m.ensureData();
  const state = healState({ hp: 100, maxHp: 100 });
  m.statusCursor = 0;
  m.applyTechnique(state, TECH, null, "system00");
  assert.deepEqual(sfx.plays, ["system00"], `plays=${sfx.plays}`);
});

test("a field item that lands plays RECOVERY for every effect that applied", () => {
  const { m, sfx } = menuWithSfx();
  const state = healState({ hp: 5 });
  state.inventory = [{ id: POWER_CHARGE, qty: 1 }];
  m.itemMode = "use_target";
  m.itemTarget = 0;
  m.itemCursor = 0;
  m.itemCat = 0;      // Items
  m.handleKey("circle", state);
  // The leading "system00" is the copy's own picker click at the press — a
  // separate divergence row (the disc's Choose Digimon confirm has no click of
  // its own, §4.3); the apply's cue is the one this file pins.
  assert.deepEqual(sfx.plays.at(-1), "recovery", `plays=${sfx.plays}`);
  assert.equal(state.inventory.find((s) => s.id === POWER_CHARGE)?.qty ?? 0, 0,
    "the copy is spent on the applied path");
});

test("a field item with no effect plays the refusal cue (0x0004001c)", () => {
  const { m, sfx } = menuWithSfx();
  const state = healState({ hp: 100, maxHp: 100 });
  state.inventory = [{ id: POWER_CHARGE, qty: 1 }];
  m.itemMode = "use_target";
  m.itemTarget = 0;
  m.itemCursor = 0;
  m.itemCat = 0;
  m.handleKey("circle", state);
  assert.deepEqual(sfx.plays.at(-1), "system07", `plays=${sfx.plays}`);
  assert.equal(state.inventory.find((s) => s.id === POWER_CHARGE)?.qty, 1,
    "a refusal leaves the copy in the bag");
});

test("the copy no longer plays the save jingle on a heal", () => {
  const src = readFileSync(new URL("../web/menu.js", import.meta.url), "utf8");
  assert.ok(!src.includes('sfx?.play("savedemo")'), "savedemo (0x00040015) is not this screen's cue");
});
