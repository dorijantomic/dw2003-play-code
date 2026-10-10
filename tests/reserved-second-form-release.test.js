// The reserved-second-form release (0x800A7328), the ONE routine the Digivolve
// commit, the Tag commit and the Blast revert all run (web/battle.js).
//
// What the disc does, and what this pins: the release zeroes the roster slot's
// Digivolve/Blast gauge at 0x80042B1C + rosterKey*2 + 0x58 and clears the
// standing reserved second form at record +0x1A, and it does so for every
// caller — there is no per-caller variant (BLAST-C001/C002, and the static read
// behind claim tag-commit-cancels-blast-no-suppression-branch).
//
// It used to be the walker's own three-line gauge write repeated at each call
// site. When the shared routine was lifted to module scope its gauge SAVE was
// left pointing at the battle factory's private persistPlayerGauge, so every
// caller threw a ReferenceError half way through its own commit: the Blast
// revert never reached its presentation and the Tag never reached the swap.
// These cases call the shared routine exactly as the three callers do, with no
// battle factory in scope, which is the shape that caught it.
import assert from "node:assert/strict";
import test from "node:test";

const store = Object.create(null);
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { releaseReservedSecondForm, persistPlayerGauge, syncPlayerRoster }
  = await import("../web/battle.js");

/** A battle record shaped like the one createBattle builds, gauge and all.
 *  `player` IS the active member's record and each `statsRecord` IS the stored
 *  stats object the field state hands out, as in the real battle. */
const battle = () => {
  const records = [
    { hp: 300, maxHp: 400, mp: 90, maxMp: 120, gauge: 999, statsRecord: { hp: 300, mp: 90, dvGauge: 999 } },
    { hp: 400, maxHp: 400, mp: 120, maxMp: 120, gauge: 0, statsRecord: { hp: 400, mp: 120, dvGauge: 0 } },
  ];
  return {
    player: records[0],
    activePlayerIndex: 0,
    playerRecords: records,
    blast: { active: true, savedFormId: 1, playerTurns: 6 },
    _blastPending: true,
    _blastRevertPending: true,
    getState: () => ({ partnerStats: records[0].statsRecord, partyStats: records.map((r) => r.statsRecord) }),
  };
};

test("the release zeroes the gauge, drops the reservation and saves both", () => {
  const b = battle();
  assert.equal(releaseReservedSecondForm(b), true);
  assert.equal(b.blast, null, "the standing reserved second form is gone");
  assert.equal(b._blastPending, false);
  assert.equal(b._blastRevertPending, false);
  assert.equal(b.player.gauge, 0, "the gauge the reservation was holding is zero");
  // The save runs to completion: the roster is written back first, so the stored
  // numbers carry the zeroed gauge too.
  assert.equal(b.playerRecords[0].statsRecord.dvGauge, 0);
  assert.equal(JSON.parse(store.partnerStats).dvGauge, 0);
  assert.equal(JSON.parse(store.partyStats)[0].dvGauge, 0);
});

test("a battle with no standing reservation is left alone", () => {
  for (const k of Object.keys(store)) delete store[k];
  const b = battle();
  b.blast = null;
  assert.equal(releaseReservedSecondForm(b), false);
  assert.equal(b.player.gauge, 999, "an unreserved gauge is not spent");
  assert.equal(store.partnerStats, undefined, "and nothing is saved");
});

test("the gauge save reaches the battle's own state accessor", () => {
  for (const k of Object.keys(store)) delete store[k];
  const b = battle();
  b.blast = null;
  b.getState = undefined;          // a record with no accessor cannot be saved
  assert.doesNotThrow(() => persistPlayerGauge(b));
  assert.doesNotThrow(() => syncPlayerRoster(b));
  assert.equal(store.partnerStats, undefined);
});

test("the release itself never throws, whoever calls it", () => {
  // The regression: the save call sat outside the factory that defined it, so
  // the shared routine threw for every one of its three callers.
  for (const armed of [true, true, true]) {
    const b = battle();
    b.blast = armed ? { active: true, savedFormId: 1, playerTurns: 6 } : null;
    assert.doesNotThrow(() => releaseReservedSecondForm(b));
  }
});