// Regression test for the gym pod-select multi-party plumbing added
// 2026-07-12 (docs/research/ui/stgtrain-pod-select-decoded-2026-07-12.md).
// web/gym.js previously operated on a single fixed state.partnerStats;
// this covers the new trainee-slot selection + persistence routing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// gym.js fetches its data tables with relative URLs (correct in the browser,
// where they resolve against the page's origin) — under plain `node --test`
// there's no origin, so fetch() would reject. Serve the same files straight
// off disk instead of skipping the coverage.
const WEB = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
global.fetch = async (url) => {
  const file = path.join(WEB, String(url));
  const body = readFileSync(file, "utf8");
  return { ok: true, json: async () => JSON.parse(body) };
};

const { createGym } = await import("../web/gym.js");

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

test("gym.open() opens the pod-select screen for a multi-member party", async () => {
  const g = createGym(null);
  const state = fakeState(3);
  await g.open(state);
  assert.equal(g.screen, "select");
  assert.equal(g.roster.length, 3);
  assert.equal(g.roster[0].name, "Renamon");
});

test("gym.open() skips pod-select for a single-member party (nothing to choose)", async () => {
  const g = createGym(null);
  const state = fakeState(1);
  await g.open(state);
  assert.equal(g.screen, "drill");
});

test("confirming a pod-select slot routes training onto that party member, not always the lead", async () => {
  const g = createGym(null);
  const state = fakeState(3);
  await g.open(state);
  // Lazily allocated non-lead stats block (mirrors ensureDriPartyStats).
  assert.ok(state.partyStats[1], "slot 1 (Agumon) should have a seeded stats block");
  g.selSlot = 1;
  g.handleKey("circle", state); // confirm pod-select -> trainSlot = 1, screen = "drill"
  assert.equal(g.trainSlot, 1);
  assert.equal(g.screen, "drill");
});
