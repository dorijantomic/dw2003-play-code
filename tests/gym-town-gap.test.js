// Gym behaviours measured in docs/research/ui/town-gap-2026-09-02.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WEB = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
global.fetch = async (url) => {
  const body = readFileSync(path.join(WEB, String(url)), "utf8");
  return { ok: true, json: async () => JSON.parse(body) };
};

const { createGym } = await import("../web/gym.js");

function fakeState(partySize = 1, tp = 70) {
  const party = ["p009rena", "p006agum", "p007vmon"].slice(0, partySize);
  return {
    party,
    partnerStats: {
      digimonId: 7, level: 15, xp: 0, tp, hp: 99, maxHp: 99, mp: 99, maxMp: 99,
      stats: {}, elemBonuses: {},
    },
    partyStats: party.map(() => null),
    digimonNames: {},
    inventory: [],
    equipment: [{}, {}, {}],
  };
}

test("gym drill cursor clamps at the left edge instead of wrapping", async () => {
  const g = createGym(null);
  await g.open(fakeState(1));
  assert.equal(g.screen, "drill");
  g.drillSel = 0;
  g.handleKey("left", fakeState(1));
  assert.equal(g.drillSel, 0);
});

test("not enough TP stays on the TP picker", async () => {
  const g = createGym(null);
  const state = fakeState(1, 0);
  await g.open(state);
  g.handleKey("circle", state); // drill -> tp
  assert.equal(g.screen, "tp");
  g.handleKey("circle", state); // confirm TP 1 with 0 TP
  assert.equal(g.screen, "tp");
  assert.equal(g.tpWarn, true);
});

test("triangle on the result screen does not confirm", async () => {
  const g = createGym(null);
  const state = fakeState(1);
  await g.open(state);
  g.screen = "result";
  g.handleKey("cross", state);
  assert.equal(g.screen, "result");
});

test("pod-select confirm is the confirm bit", async () => {
  const g = createGym(null);
  const state = fakeState(3);
  await g.open(state);
  assert.equal(g.screen, "select");
  g.handleKey("circle", state);        // the confirm bit opens the drill picker
  assert.equal(g.screen, "drill");
});
