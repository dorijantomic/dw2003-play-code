import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Lab chart draws a row only when the row's first form is in the partner's
// LEARNED list: F0x80083484 (stgdglab) searches self+0x60, which the screen
// fills from ctx+0x2740 = F0x80017898 (enumerate_acquired, every ledger entry
// with an id >= 3; stgdglab 0x16FC-0x1720). A form the unlock rule would grant
// after the next battle is not in that list, so it is not drawn.
globalThis.Image ??= class { set src(_v) {} };
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(`web/${String(url).replace(/^\.?\//, "")}`, "utf8")),
});
const { createDriMenu } = await import("../web/dri.js");

function kotemonAt(level, formLedger) {
  return {
    party: ["p003pken", "p009rena", "p010pata"],
    partyStats: [null, null, null],
    partnerStats: {
      digimonId: 1, level, hp: 500, maxHp: 500, mp: 300, maxMp: 300,
      bonuses: {}, elemBonuses: {}, equippedForms: [], formLedger,
    },
    equipment: [{}, {}, {}],
    manifest: { characters: [{ id: "player" }, { id: "p003pken" }] },
    charId: "p003pken",
    charIdx: 1,
  };
}

function shownOnPageOne(dri, state) {
  dri.openAction(2, state);
  dri.screen = "chart";
  dri.page = 0;
  return dri.chartGrid().flat().filter(Boolean).map((node) => node.digimon_id);
}

test("the Lab chart shows a learned form and not one the partner could learn next", async () => {
  const dri = createDriMenu();
  await dri.dataReady;
  // Level 99 passes the Kotemon tree's Dinohumon record (kind 7, threshold 5),
  // but nothing is learned yet: Dinohumon (9) is not drawn.
  assert.ok(!shownOnPageOne(dri, kotemonAt(99, [])).includes(9),
    "an unlearned Dinohumon is not on the chart");
  // Once Dinohumon is in the ledger, its row is drawn.
  const learned = [{ id: 9, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }];
  assert.ok(shownOnPageOne(dri, kotemonAt(99, learned)).includes(9),
    "a learned Dinohumon is on the chart");
});
