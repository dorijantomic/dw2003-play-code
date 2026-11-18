// The shared window-fold family: every start plays packed cue 0x40019
// (system03) when opening and 0x4001A (system04) when closing
// (docs/research/ui/window-fold-tween-homolog-family-2026-08-04.md,
// ledger UI-C001). This pins the consumers that bind the cue themselves so a
// screen cannot fold its windows in silence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// These screens fetch their UI tables with page-relative URLs; under plain
// `node --test` there is no origin, so serve the files off disk.
const WEB = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "web");
global.fetch = async (url) => {
  const file = path.join(WEB, String(url));
  const body = readFileSync(file, "utf8");
  return { ok: true, json: async () => JSON.parse(body) };
};

const { FOLD_OPEN_SFX, FOLD_CLOSE_SFX } = await import("../engine/dw3/ui/fold-tween.ts");

function mockSfx() {
  const plays = [];
  return { plays, play: (n) => plays.push(n) };
}
const countOf = (sfx, name) => sfx.plays.filter((n) => n === name).length;

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

test("the fold-family constants are the packed open/close cues", () => {
  assert.equal(FOLD_OPEN_SFX, 0x40019);
  assert.equal(FOLD_CLOSE_SFX, 0x4001a);
});
