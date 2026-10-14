// The BIT Adapter's party position: which member's accessory the +20% Bits is
// read from. Pins the shipped behaviour against a wrong "fix" (the 2026-10-14
// stat-growth audit's named gap) with the original assembly as the authority.
//
// THE FINDING (2026-10-14, this branch). The report workspace's +0x04 holds the
// battle's active slot AT THE OUTCOME, which a Tag updates. The workspace block
// (0x80042b84, 0x12 bytes) is zeroed at battle setup — the start routine
// 0x800a9ff0 calls HEAP.zero(0x80042b84, 0x12) through 0x8004b5dc+0x24 (file
// 0x4210) — but no member index is stored there at setup: the +0x04 member
// value comes only from the battle's END arm, and that store is guarded:
//
//   * The write: pro/wfightmn.s file 0x1EC8 (`sh $v1, 0x4($0x80042B84)`) sits in
//     F0x800a7c00 (file 0x1e20) — the endBattle arm of the 24-entry action table
//     (WFIGHTMN_states 0x800aadf0 index 4, phase 7; the event->phase map sends
//     END_BATTLE (event 1) to phase 7). The store sits inside the block guarded
//     by the result byte 0x800a435c != 0, so a zero result byte (a flee) skips
//     it, and that byte plus the END_BATTLE event are produced together by
//     FIGHTSTG F0x8009c534 — called from the win branch (wfightmn.s
//     .L0x00003498, a0=1), the loss branch (.L0x00003450, a0=2) and the flee
//     arm (.L0x00002300, a0=0). wfightmn calls it from exactly those three
//     sites; fightstg itself calls it twice more (fightstg.s:5891 in
//     FIGHTSTG_F0x80088564, :15249 in FIGHTSTG_F0x80091534), both with a0=0 —
//     a result 0 that cannot produce a win/loss byte. No jal to F0x800a7c00
//     exists (the arm is reached through the table only). So the member value
//     is written when the battle concludes, never at setup.
//   * The value: `lhu $v1, 0x8($v1)` (file 0x1EC0) reads 0x800a4468 — the battle
//     active slot (docs/research/battle/battle-ram-layout.md: "the active party
//     member's index is the word at 0x800a4468"). The Tag commit F0x800a78d8
//     state 2 writes that slot (file 0x1C80 = RAM 0x800a7a60, the instruction the
//     digivolution doc §9f calls "the commit") and does NOT restore it; state 1
//     sets it only around the spawn call (0x80087000) and restores it — that
//     restore is the one the sequencer note records, and it is not the commit.
//   * Proof by execution: both arms were driven through the committed original
//     code with engine/native (the same runtime tests/lane-b uses).
//     Tag arm F0x800a78d8: state 1 alone leaves the slot restored (0); the full
//     state-1-then-state-2 sequence leaves it on the tagged-in position (1) and
//     the marker runs with slot=1. End arm F0x800a7c00: slot 0/1/2 -> workspace
//     +4 = 0/1/2; with the result byte 0 the write is skipped.
//
// So the +20% Bits is read from the member IN FRONT WHEN THE BATTLE ENDED (the
// last Tagged-in member), and the walker's winRewards(b) — equipment of
// b.activePlayerIndex at the outcome — is CORRECT. The audit's proposed change
// (record a setup-time active position and check THAT member) would pay the +20%
// off the wrong member in both directions: it would grant it when the setup
// leader wore the adapter and a partner without one finished the fight, and
// withhold it when the finishing partner wore it. This test fails against that
// change and passes against the shipped rule; see the branch's progress file
// (~/.hermes/cache/scratch/bitfix/progress.md) for the probe output.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  winBattleRewards, paidParticipants, BITADAPTER_ID, EXPADAPTER_ID,
} from "../web/battle.js";

const prog = JSON.parse(readFileSync(new URL("../web/assets/data/progression.json", import.meta.url), "utf8"));
const BATTLE_262 = 262; // reward record [dvexp 94, exp 2365, bits 5475]

// The source under test: web/battle.js, or a mutated copy for the fail-before run.
const source = readFileSync(process.env.BITADAPTER_BATTLE_SOURCE || "web/battle.js", "utf8");

/** Slice `function name(...) {...}` out of the source by brace balance. */
function sliceFunction(name) {
  const begin = source.indexOf(`function ${name}(`);
  assert.ok(begin > 0, `${name} is defined in the battle module`);
  let i = source.indexOf("{", begin);
  assert.ok(i > begin, `${name} has a body`);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(begin, i + 1);
}

/**
 * The real winRewards, wired to the real reward maths. The battle object is the
 * minimal shape it reads: screenId, the marked set + live records for the share
 * divisor, and the active position (updated on a Tag, never restored).
 */
function makeWinRewards(state) {
  return new Function(
    "winBattleRewards", "paidParticipants", "getState", "progressionDB",
    sliceFunction("winRewards") + "\nreturn winRewards;",
  )(winBattleRewards, paidParticipants, () => state, { battle_rewards: prog.battle_rewards });
}

/** A two-Digimon battle of screen 262: the lead (position 0) KO'd, position 1
 *  tagged in and standing — exactly the audit's mid-fight-KO + Tag case. */
const koLeadTaggedIn = () => ({
  screenId: BATTLE_262,
  participantIndices: new Set([0, 1]),
  playerRecords: [{ hp: 0, maxHp: 500 }, { hp: 312, maxHp: 500 }],
  activePlayerIndex: 1,
});

test("the +20% Bits follows the member in front at the outcome, not the setup leader", () => {
  // The setup leader wore the BIT Adapter; the partner that finished the fight
  // wore none. The original's workspace +4 holds the OUTCOME slot (position 1),
  // so no adapter is read and the record pays its base 5475 — never 6570.
  const b = koLeadTaggedIn();
  const state = { equipment: { 0: { acc0: BITADAPTER_ID }, 1: {} } };
  const winRewards = makeWinRewards(state);
  const reward = winRewards(b);
  assert.equal(reward.bits, 5475,
    "the KO'd setup leader's adapter is NOT the one the BIT payout reads");
  assert.notEqual(reward.bits, 5475 + Math.floor(5475 / 5),
    "a setup-position check would wrongly grant +20% here");
});

test("the Tagged-in member's own BIT Adapter pays the +20%", () => {
  // The reverse: the finishing partner wore it. The outcome slot is position 1,
  // so its adapter is read and the base gets the +1/5 bonus.
  const b = koLeadTaggedIn();
  const state = { equipment: { 0: {}, 1: { acc0: BITADAPTER_ID } } };
  const winRewards = makeWinRewards(state);
  const reward = winRewards(b);
  assert.equal(reward.bits, 5475 + Math.floor(5475 / 5),
    "the member at the outcome position is the one the BIT payout reads");
});

test("no Tag: the standing lead's adapter still pays", () => {
  const b = { ...koLeadTaggedIn(), activePlayerIndex: 0,
    playerRecords: [{ hp: 312, maxHp: 500 }, { hp: 312, maxHp: 500 }] };
  const winRewards = makeWinRewards({ equipment: { 0: { acc1: BITADAPTER_ID }, 1: {} } });
  assert.equal(winRewards(b).bits, 6570);
});

test("the EXP adapter keeps its own member per participant (a KO'd member's row is not paid)", () => {
  // The EXP arm of the original reads each report row's own position (+0x5c);
  // the walker pays it per participant. The KO'd lead is out of the payout set,
  // so its adapter boosts nobody's EXP here.
  const b = koLeadTaggedIn();
  const state = { equipment: { 0: { acc0: EXPADAPTER_ID }, 1: {} } };
  const winRewards = makeWinRewards(state);
  assert.deepEqual(paidParticipants(b), [1]);
  assert.equal(winRewards(b, 1).xp, 2365, "the standing member has no EXP adapter");
  assert.equal(winRewards(b, 1).bits, 5475);
});

test("the report seeding uses the outcome member too (web/game.js)", () => {
  // The native/translated report writes this value into the workspace +4 itself,
  // so its seed must be the same member the endBattle arm would have written:
  // the active position at the outcome, never a setup-time index.
  const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  // the report is opened by openNativeReport (shared with the multiplayer fight); the hand-off just calls it
  const at = game.indexOf("function openNativeReport(");
  assert.ok(at > 0, "the battle report opener is present");
  assert.ok(game.includes("battle.setReportHandoff({ open: (b) => openNativeReport(b,"), "the single-player hand-off opens it");
  const handoff = game.slice(at, game.indexOf("battle.setReportHandoff", at));
  assert.ok(handoff.includes("activePos: b.activePlayerIndex"),
    "the report's workspace +4 is seeded from the active position (the Tag-aware slot)");
  assert.ok(!/setupPlayerIndex|setupActiveIndex|setupPos/.test(handoff),
    "no setup-time index is seeded — the original writes the outcome slot");
});
