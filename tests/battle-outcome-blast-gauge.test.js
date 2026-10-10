// Playtest 2026-10-07 item 11(b): the DV/Blast gauge must reset when the FIGHT
// ends while a Blast is still standing.
//
// Disc authority: the battle-outcome path runs the shared release 0x800A7328 on
// EVERY exit arm before the result byte is read (wfightmn .L0x00002174, file
// 0x2174). While the acting combatant's +0x1A reservation is set the release
// clears it and zeroes the gauge at `0x80042B1C + rosterKey*2 + 0x58`
// (wfightmn.s:1393-1421) — captured live in
// captures/blast-presentation-2026-07-14/README.md (blast_run3: "Woodmon died
// while Blast active -> b0 01->00, gauge->0"). The saved arms (win, enemy-fled)
// then carry the zeroed gauge into the report write-back; the loss arm writes
// nothing to the card, so its zero stays in RAM.
import test from "node:test";
import assert from "node:assert/strict";

// web/battle.js's persistPlayerGauge reads/writes localStorage.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { battleOutcomeRelease, releaseReservedSecondForm, DV_GAUGE_MAX } =
  await import("../web/battle.js");

/** A battle mid-Blast: the acting record's gauge sits at `gauge`. */
function blastBattle(gauge = DV_GAUGE_MAX) {
  const statsRecord = { hp: 40, mp: 12, dvGauge: gauge };
  const player = { gauge, hp: 40, mp: 12, statsRecord };
  return {
    player,
    playerRecords: [player],
    blast: { active: true, savedFormId: 1, playerTurns: 6 },
    _blastPending: false,
    _blastRevertPending: false,
    getState: () => ({ partnerStats: statsRecord, partyStats: [statsRecord] }),
  };
}

test("a win that ends a standing Blast zeroes the gauge and saves it", () => {
  store.clear();
  const b = blastBattle();
  assert.equal(battleOutcomeRelease(b, "win"), true, "the outcome release runs");
  assert.equal(b.player.gauge, 0, "the live gauge is zeroed");
  assert.equal(b.blast, null, "the reservation is released");
  assert.equal(b.player.statsRecord.dvGauge, 0, "the record carries the zero");
  assert.equal(JSON.parse(store.get("partnerStats")).dvGauge, 0,
    "the saved party carries the zeroed gauge");
});

test("a loss that ends a standing Blast zeroes the gauge but writes nothing", () => {
  store.clear();
  const b = blastBattle();
  assert.equal(battleOutcomeRelease(b, "lose"), true);
  assert.equal(b.player.gauge, 0, "the RAM gauge is zeroed, as the disc's arm does");
  assert.equal(b.blast, null);
  // The loss arm writes nothing at all, so no card/localStorage write happened.
  assert.equal(store.has("partnerStats"), false, "the loss exit saves nothing");
});

test("an enemy-fled exit saves the zeroed gauge like a win", () => {
  store.clear();
  const b = blastBattle();
  assert.equal(battleOutcomeRelease(b, "enemy-fled"), true);
  assert.equal(b.player.gauge, 0);
  assert.equal(JSON.parse(store.get("partnerStats")).dvGauge, 0);
});

test("a fight with no standing Blast is untouched", () => {
  store.clear();
  const b = blastBattle(600);
  b.blast = null;
  assert.equal(battleOutcomeRelease(b, "win"), false, "nothing to release");
  assert.equal(b.player.gauge, 600, "a plain fight never moves the gauge at outcome");
  assert.equal(store.has("partnerStats"), false);
});

test("the ordinary release still persists (Tag / Digivolve / revert)", () => {
  store.clear();
  const b = blastBattle(900);
  assert.equal(releaseReservedSecondForm(b), true);
  assert.equal(b.player.gauge, 0);
  assert.equal(JSON.parse(store.get("partnerStats")).dvGauge, 0);
});
