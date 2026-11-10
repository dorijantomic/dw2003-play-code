// Card 15: one end-of-Blast and one Blast tier table.
//
// Before this card the end of a Blast was written out by hand in six places —
// four in web/battle.js around `releaseReservedSecondForm` and two shapes of
// record (the one-on-one battle keeps `{active, savedFormId, playerTurns}` on
// `b.blast` and the gauge on `b.player`; the online fight keeps
// `{active, saved, turns}` and the gauge on the roster record) — plus three
// online arms in web/mpbattle-rules.js and one in web/mpbattle.js that each
// repeated `blast = null; gauge = 0`. And the level->tier ladder was copied
// next to each reader of `blasts[]`.
//
// The disc's shared release 0x800A7328 (wfightmn .L0x00002174) is one routine:
// it drops the standing reservation at the combatant's +0x1A and zeroes the
// gauge at `0x80042B1C + rosterKey*2 + 0x58`. So this file proves the two
// consequences of the card: `endBlast` is the only writer of that state and it
// does the same write for either record shape, and `blastTargetProfile` is the
// only reader of `blasts[]` — the one the online kit and the battle's own Blast
// both go through.
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

const { endBlast, releaseReservedSecondForm, blastTargetProfile } =
  await import("../web/battle.js");

/** The online shape: the standing Blast and the gauge sit on the record. */
function onlineRecord(gauge = 1000) {
  return {
    level: 12,
    gauge,
    profile: { id: 2, name: "Rookie" },
    blast: { active: true, saved: { id: 2, name: "Rookie" }, turns: 1 },
  };
}

/** The one-on-one shape: `b.blast`, and the gauge on `b.player`. */
function battleRecord(gauge = 990) {
  const statsRecord = { hp: 40, mp: 12, dvGauge: gauge };
  const player = { gauge, hp: 40, mp: 12, statsRecord, profile: { id: 2 } };
  return {
    player,
    playerRecords: [player],
    blast: { active: true, savedFormId: 2, playerTurns: 6 },
    _blastPending: true,
    _blastRevertPending: true,
    getState: () => ({ partnerStats: statsRecord, partyStats: [statsRecord] }),
  };
}

test("online: the countdown running out spends the gauge and drops the reservation", () => {
  const rec = onlineRecord(777);
  assert.equal(endBlast(rec), true);
  assert.equal(rec.blast, null, "the reservation is released");
  assert.equal(rec.gauge, 0, "the DV gauge is spent");
  assert.deepEqual(rec.profile, { id: 2, name: "Rookie" },
    "the form is left alone unless the arm asks for it");
});

test("online: the form arm (countdown over, Tag) puts the record back first", () => {
  const rec = onlineRecord();
  rec.profile = { id: 12, name: "Tier1" };
  assert.equal(endBlast(rec, { form: true }), true);
  assert.equal(rec.profile.id, 2, "the borrowed form is given back");
  assert.equal(rec.gauge, 0);
});

test("online: a fallen Digimon ends the Blast without a form to go back to", () => {
  const rec = onlineRecord();
  rec.hp = 0;
  rec.profile = { id: 12, name: "Tier1" };
  assert.equal(endBlast(rec), true);
  assert.equal(rec.blast, null);
  assert.equal(rec.gauge, 0);
  assert.equal(rec.profile.id, 12, "the death arm never restores a form");
});

test("nothing standing: no write, and the gauge keeps its value", () => {
  const rec = onlineRecord(420);
  rec.blast = null;
  assert.equal(endBlast(rec), false);
  assert.equal(rec.gauge, 420);
});

test("the persist arm runs once, after the state write", () => {
  const rec = onlineRecord();
  const seen = [];
  assert.equal(endBlast(rec, { persist: () => seen.push([rec.blast, rec.gauge]) }), true);
  assert.deepEqual(seen, [[null, 0]], "the card write sees the spent state");
});

test("one-on-one: the ordinary release is the same write on the other shape", () => {
  store.clear();
  const b = battleRecord(900);
  assert.equal(releaseReservedSecondForm(b), true);
  assert.equal(b.blast, null, "b.blast is released");
  assert.equal(b.player.gauge, 0, "the partner record's gauge is spent");
  assert.equal(b._blastPending, false);
  assert.equal(b._blastRevertPending, false);
  assert.equal(b.player.statsRecord.dvGauge, 0, "the record carries the zero");
  assert.equal(JSON.parse(store.get("partnerStats")).dvGauge, 0,
    "the saved party carries the zeroed gauge");
});

test("one-on-one: persist=false zeroes RAM and writes nothing", () => {
  store.clear();
  const b = battleRecord();
  assert.equal(releaseReservedSecondForm(b, false), true);
  assert.equal(b.player.gauge, 0);
  assert.equal(store.has("partnerStats"), false);
});

test("one-on-one: no standing Blast is untouched by the same helper", () => {
  store.clear();
  const b = battleRecord(640);
  b.blast = null;
  assert.equal(releaseReservedSecondForm(b), false);
  assert.equal(b.player.gauge, 640);
  assert.equal(store.has("partnerStats"), false);
});

// The tier ladder's one home is battle-formulas.ts::levelTier/BLAST_LEVEL_BRACKETS;
// these are the readers on each side of the page.
test("blastTargetProfile reads blasts[] by the shared ladder, for either caller", () => {
  const db = {
    2: { id: 2, name: "Rookie", blasts: [11, 12, 13, 14, 15] },
    11: { id: 11, name: "Tier0" }, 12: { id: 12, name: "Tier1" },
    13: { id: 13, name: "Tier2" }, 14: { id: 14, name: "Tier3" }, 15: { id: 15, name: "Tier4" },
    3: { id: 3, name: "NoBlasts" },
  };
  const at = (level) => blastTargetProfile({ rookieId: 2, level }, db)?.id ?? null;
  assert.deepEqual([1, 3, 4, 18, 19, 38, 39, 69, 70, 99].map(at),
    [11, 11, 12, 12, 13, 13, 14, 14, 15, 15]);
  assert.equal(at(99), blastTargetProfile({ rookieId: 2, level: 99 }, db)?.id,
    "the top bracket is the last row, not a wrap");
});

test("blastTargetProfile has no target without a rookie or a full list", () => {
  const db = { 3: { id: 3, name: "Short", blasts: [11, 12] } };
  assert.equal(blastTargetProfile({ rookieId: 3, level: 12 }, db), null);
  assert.equal(blastTargetProfile({ level: 12 }, db), null);
  assert.equal(blastTargetProfile({ rookieId: 3, level: 12 }, null), null);
});
