// DNA Digivolve rejection / cancellation branches (engine/dw3/battle-party.ts).
//
// Decoded 2026-08-03 from original SLES-03936 assembly, ~/ddw3/asm/dw2003/pro/fightstg.s,
// FIGHTSTG_F0x800980e4 page ctx+0x10==1 / substate ctx+0x14==1, block 0x800984dc..0x800986f4
// (ledger claims DNA-C005 branch enumeration, DNA-C006 silent rejection, DNA-C009 reachability).
//
// The seven tests run in this exact order on the DNA DV row, each jumping to the
// shared no-op convergence point 0x80098790:
//   1 acting cur_mp  < cost        0x800985e0
//   2 partner cur_mp < cost        0x800985f4
//   3 acting  +0x1c & 0x20         0x80098608
//   4 partner +0x1c & 0x20         0x8009861c
//   5 acting  +0x1c & 0x08         0x80098624   (partner is deliberately NOT tested for 0x08)
//   6 acting  cur_hp <= 0          0x80098638
//   7 partner cur_hp <= 0          0x80098648
// Accept falls through to the MP debit store at 0x80098650.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dnaRejection, canPayDnaCost } from "../engine/dw3/battle-party.ts";

const ok = { activeMp: 20, partnerMp: 20, activeHp: 100, partnerHp: 100, activeStatus: 0, partnerStatus: 0 };

test("an eligible pair is accepted", () => {
  assert.equal(dnaRejection({ ...ok }, 20), null);
});

test("cur_mp exactly equal to the cost is ACCEPTED, not rejected", () => {
  // `blez`/`bltz`-style compare: the native rejects only on strictly-less-than.
  assert.equal(dnaRejection({ ...ok, activeMp: 20, partnerMp: 20 }, 20), null);
  assert.equal(dnaRejection({ ...ok, activeMp: 19 }, 20), "active-mp");
  assert.equal(dnaRejection({ ...ok, partnerMp: 19 }, 20), "partner-mp");
});

test("a dead participant on either side rejects", () => {
  assert.equal(dnaRejection({ ...ok, activeHp: 0 }, 20), "active-hp");
  assert.equal(dnaRejection({ ...ok, partnerHp: 0 }, 20), "partner-hp");
  assert.equal(dnaRejection({ ...ok, partnerHp: -1 }, 20), "partner-hp");
});

test("status bit 0x20 rejects on either side; bit 0x08 only on the acting side", () => {
  assert.equal(dnaRejection({ ...ok, activeStatus: 0x20 }, 20), "active-status-20");
  assert.equal(dnaRejection({ ...ok, partnerStatus: 0x20 }, 20), "partner-status-20");
  assert.equal(dnaRejection({ ...ok, activeStatus: 0x08 }, 20), "active-status-08");
  // The native does NOT test the partner for 0x08 -- a partner carrying only that
  // bit is eligible. This asymmetry is load-bearing, not an oversight in the port.
  assert.equal(dnaRejection({ ...ok, partnerStatus: 0x08 }, 20), null);
  // Neither side is tested for 0x10 on this row.
  assert.equal(dnaRejection({ ...ok, activeStatus: 0x10, partnerStatus: 0x10 }, 20), null);
});

test("tests run in the decoded order: the FIRST failing test wins", () => {
  // Everything wrong at once must report the acting-MP test, which runs first.
  assert.equal(dnaRejection(
    { activeMp: 0, partnerMp: 0, activeHp: 0, partnerHp: 0, activeStatus: 0x28, partnerStatus: 0x28 }, 20,
  ), "active-mp");
  // Partner MP outranks the status and HP tests.
  assert.equal(dnaRejection(
    { ...ok, partnerMp: 0, activeStatus: 0x20, activeHp: 0 }, 20,
  ), "partner-mp");
  // Acting 0x20 outranks partner 0x20.
  assert.equal(dnaRejection(
    { ...ok, activeStatus: 0x20, partnerStatus: 0x20 }, 20,
  ), "active-status-20");
});

test("canPayDnaCost stays consistent with the two MP branches", () => {
  assert.equal(canPayDnaCost(20, 20, 20), true);
  assert.equal(canPayDnaCost(19, 20, 20), false);
  assert.equal(canPayDnaCost(20, 19, 20), false);
});
