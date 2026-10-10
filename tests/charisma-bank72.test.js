// Bank 0x72 — the derived party-Charisma threshold predicate (engine/dw3/dw3-config.ts).
//
// Decoded 2026-08-03 from original SLES-03936 assembly (ledger claim
// charisma-flag-bank-72-is-derived-party-charisma-threshold-predicate,
// partially_verified). get_flag dispatcher F0x800163b0 routes bank 0x72 to
// F0x80015fbc (~/ddw3/asm/dw2003/exe/fns.s L6941), which:
//   - loops the three deployed party positions,
//   - builds each one's battle-effective stat buffer via F0x80017174 (a verbatim
//     copy of roster record +0x1c..+0x48, plus each of the six equipped items'
//     leading u16 added into the charisma field, clamped 999),
//   - accumulates buffer+0x16 (== record +0x32 == cur_chr),
//   - returns TRUE iff the sum >= D0x80048cf8[index].
//
// So flag 0x7200+n means "equipment-buffed party total Charisma >= ladder[n]".
// The bank has NO write arm, so any extracted "set" of a 0x72xx id is inert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARISMA_THRESHOLDS, partyCharismaMeets } from "../engine/dw3/dw3-config.ts";

test("the threshold ladder is the 15 words read from D0x80048cf8", () => {
  assert.deepEqual([...CHARISMA_THRESHOLDS], [
    60, 150, 210, 285, 378, 492, 630, 795, 990, 1218, 1482, 1785, 2049, 2277, 2472,
  ]);
});

test("the predicate is >=, not >", () => {
  // Tamers accept a challenge at exactly 60 (index 0), the first rung.
  assert.equal(partyCharismaMeets(60, 0), true);
  assert.equal(partyCharismaMeets(59, 0), false);
  // El Dorado boarding pass is index 2 (>= 210).
  assert.equal(partyCharismaMeets(210, 2), true);
  assert.equal(partyCharismaMeets(209, 2), false);
});

test("higher rungs stay false until their own threshold", () => {
  // Charisma 400 clears rungs 0-3 (60/150/210/285) but not 378's successor 492.
  assert.equal(partyCharismaMeets(400, 3), true);   // >= 285
  assert.equal(partyCharismaMeets(400, 4), true);   // >= 378
  assert.equal(partyCharismaMeets(400, 5), false);  // >= 492
  assert.equal(partyCharismaMeets(2472, 14), true); // top rung exactly
  assert.equal(partyCharismaMeets(2471, 14), false);
});

test("an index off the end of the ladder is never satisfied", () => {
  // The native table is 15 words; nothing should read past it, but a malformed
  // id must not silently pass a gate.
  assert.equal(partyCharismaMeets(999999, 15), false);
  assert.equal(partyCharismaMeets(999999, -1), false);
});

// --- the sum side: partyCharismaTotal (engine/dw3/battle-stats.ts) -----------
const { partyCharismaTotal } = await import("../engine/dw3/battle-stats.ts");

const kotemon = { id: 1, chr: 1, growth: { chr: 3 }, is_starter: true };

test("party charisma sums scaled CHR over the deployed positions", () => {
  // scaledStat = base + growth*(level-1): Kotemon at level 1 = 1, at level 21 = 61.
  assert.equal(partyCharismaTotal([{ profile: kotemon, level: 1 }]), 1);
  assert.equal(partyCharismaTotal([{ profile: kotemon, level: 21 }]), 61);
  assert.equal(partyCharismaTotal([
    { profile: kotemon, level: 21 }, { profile: kotemon, level: 21 },
  ]), 122);
});

test("only the three deployed positions count, and the buff delta folds in", () => {
  const four = Array(4).fill({ profile: kotemon, level: 21 });
  assert.equal(partyCharismaTotal(four), 183); // 3 x 61, the fourth ignored
  assert.equal(partyCharismaTotal([
    { profile: kotemon, level: 21, buffCharisma: 10 },
  ]), 71);
});

test("each member's contribution clamps at 999 before summing", () => {
  assert.equal(partyCharismaTotal([
    { profile: kotemon, level: 21, buffCharisma: 5000 },
  ]), 999);
  assert.equal(partyCharismaTotal([{ profile: null }, { profile: undefined }]), 0);
});

test("the ladder and the sum compose around the first rung", () => {
  const total = partyCharismaTotal([{ profile: kotemon, level: 20 }]); // 58
  assert.equal(total, 58);
  assert.equal(partyCharismaMeets(total, 0), false);          // tamers still refuse
  assert.equal(partyCharismaMeets(total + 2, 0), true);       // 60 -> they accept
});

// --- the Charisma items: chips and the two accessories ----------------------
// The game ships three items whose only purpose is these gates: Charisma Chip (54,
// a consumable that permanently raises CHR), Charisma Gem (302, +20) and Charisma
// Ring (303, +30), both accessories. The chip lands in partnerStats.bonuses.chr and
// the accessories in state.equipment[i]; neither was reaching the sum, so levelling
// was the only way past a rung.
//
// The ACCESSORY amounts are the walker's own equipment model, a stated assumption:
// the native adds a per-item modifier from a table that is not decoded. The
// arithmetic around it — add, clamp each member at 999, sum three positions — is
// the decoded part (charisma-flag-bank-72-is-derived-party-charisma-threshold-predicate).
const { charismaMemberFor, partyCharismaFrom, memberCharisma } =
  await import("../web/charisma.js");

const entry = (over = {}) => ({ profile: kotemon, level: 21, stats: { chr: 61 }, ...over });

test("a Charisma Chip's permanent bonus counts toward the gate", () => {
  // Two chips on the lead: stored 61 + bonuses.chr 20.
  assert.equal(memberCharisma(entry({ bonuses: { chr: 20 } }), null), 81);
  // With no stored stats the profile scales and the chip still counts.
  assert.equal(memberCharisma({ profile: kotemon, level: 21, bonuses: { chr: 20 } }, null), 81);
});

test("an equipped Charisma Gem or Ring counts toward the gate", () => {
  assert.equal(memberCharisma(entry(), { acc0: 302 }), 81);        // Gem +20
  assert.equal(memberCharisma(entry(), { acc1: 303 }), 91);        // Ring +30
  assert.equal(memberCharisma(entry(), { acc0: 302, acc1: 303 }), 111); // both slots
  assert.equal(memberCharisma(entry({ bonuses: { chr: 5 } }), { acc0: 302 }), 86);
});

test("every deployed position's own accessories count, not just the lead's", () => {
  const view = [entry(), entry(), entry()];
  assert.equal(partyCharismaFrom(view, []), 183);
  // The menu only syncs equipBonuses for the lead, so the sum reads state.equipment
  // directly; a Gem on the third member has to count.
  assert.equal(partyCharismaFrom(view, [{}, {}, { acc0: 302 }]), 203);
  assert.equal(partyCharismaFrom(view, [{ acc0: 303 }, { acc0: 303 }, { acc0: 303 }]), 273);
});

test("items still cannot push one member past 999", () => {
  const maxed = { profile: kotemon, level: 21, stats: { chr: 990 }, bonuses: { chr: 50 } };
  assert.equal(memberCharisma(maxed, { acc0: 303 }), 999);
});

test("the items are what carries a low-level party over the first rungs", () => {
  // Three level-11 Kotemon sum to 93 — below rung 1 (150). A Ring each adds 90.
  const low = Array(3).fill({ profile: kotemon, level: 11, stats: { chr: 31 } });
  assert.equal(partyCharismaMeets(partyCharismaFrom(low, []), 1), false);
  const ringed = partyCharismaFrom(low, [{ acc0: 303 }, { acc0: 303 }, { acc0: 303 }]);
  assert.equal(ringed, 183);
  assert.equal(partyCharismaMeets(ringed, 1), true);
});

test("charismaMemberFor keeps the stored stat and the equipment figure apart", () => {
  // The clamp is on the sum, so where the chip rides cannot change the total, but the
  // decoded/assumed boundary stays visible: charisma is the walker's stored stat,
  // buffCharisma is the equipment figure it is assuming.
  const m = charismaMemberFor(entry({ bonuses: { chr: 5 } }), { acc0: 302 });
  assert.equal(m.charisma, 66);
  assert.equal(m.buffCharisma, 20);
});

// --- the gating side: web/flag-store.js's bank-0x72 arm ----------------------
// Wired 2026-08-14. Before this the bank returned null and every roaming card
// tamer's brush-off line won its dialogue ladder, so 286 of the game's 351 duel
// launchers could never fire (docs/research/ui/card-folder-editor-2026-08-14.md §10).
const { createFlagStore } = await import("../web/flag-store.js");
const { pickDialogueState } = await import("../engine/dw3/npc-manager.ts");

const noBits = { get: () => 0, set: () => {} };

test("bank 0x72 answers the ladder from the party's Charisma", () => {
  const store = createFlagStore(noBits, { partyCharisma: () => 60 });
  assert.equal(store.get(0x7200), 1, "60 clears rung 0");
  assert.equal(store.get(0x7201), 0, "but not rung 1 (150)");
  const rich = createFlagStore(noBits, { partyCharisma: () => 2472 });
  assert.equal(rich.get(0x720e), 1, "the top rung is exactly 2472");
});

test("an unknown Charisma total leaves the bank dormant, not false", () => {
  // null is not zero: asserting "below every threshold" would make tamers refuse
  // for the wrong reason before digimon.json has loaded.
  const store = createFlagStore(noBits, { partyCharisma: () => null });
  assert.equal(store.get(0x7200), null);
  const unwired = createFlagStore(noBits, {});
  assert.equal(unwired.get(0x7200), null);
});

test("a card tamer refuses below its Charisma rung and challenges at it", () => {
  // Tamer Mitch, s335 NPC 1 — the shipped ladder, verbatim. State #1 is the
  // brush-off, state #2 carries on_close 0x7606 = the duel launcher. His rung is
  // 0x7209 & 0x1ff = 9, i.e. party Charisma >= 1218.
  const mitch = { dialogue_states: [
    { gate: [{ id: 0x0, expected: 0 }], dialogue: { file: "estalk02", index: 108 },
      on_close: [{ id: 0x0, expected: 1 }] },
    { gate: [{ id: 0x0, expected: 1 }, { id: 0x7209, expected: 0 }],
      dialogue: { file: "estalk02", index: 112 } },
    { gate: [{ id: 0x0, expected: 1 }, { id: 0x7209, expected: 1 }],
      dialogue: { file: "estalk02", index: 113 }, on_close: [{ id: 0x7606, expected: 1 }] },
  ] };
  const talked = { get: (id) => (id === 0 ? 1 : 0), set: () => {} };
  const duelFlag = (st) => (st?.on_close ?? []).find((c) => ((c.id >> 8) & 0xfe) === 0x76);

  const shy = createFlagStore(talked, { partyCharisma: () => 1217 });
  assert.equal(duelFlag(pickDialogueState(mitch, shy.get)), undefined, "1217 gets the brush-off");

  const ready = createFlagStore(talked, { partyCharisma: () => 1218 });
  const st = pickDialogueState(mitch, ready.get);
  assert.equal(duelFlag(st)?.id, 0x7606, "1218 gets the challenge");
  // index*2 + mode + 1, mode 0 for bank 0x76 — Mitch's first deck, not his rematch.
  assert.equal((0x7606 & 0x1ff) * 2 + 0 + 1, 13);

  // And while the bank was unmodelled, the brush-off won at ANY Charisma.
  const unwired = createFlagStore(talked, {});
  assert.equal(duelFlag(pickDialogueState(mitch, unwired.get)), undefined);
});

test("a tamer with a Charisma BAND stops fighting once you outgrow them", () => {
  // 144 duel states carry two 0x72 conditions and 88 carry three. s200's is
  // (0x7200 expected 1, 0x7202 expected 0): at least 60, but NOT yet 210.
  const banded = { dialogue_states: [
    { gate: [{ id: 0x7200, expected: 1 }, { id: 0x7202, expected: 0 }],
      dialogue: { file: "estalk00", index: 1 },
      on_close: [{ id: 0x7600, expected: 1 }] },
  ] };
  const at = (chr) => pickDialogueState(banded, createFlagStore(noBits, { partyCharisma: () => chr }).get);
  assert.equal(at(59), null, "below the floor: no duel");
  assert.equal(at(60)?.on_close?.[0]?.id, 0x7600, "inside the band: the duel");
  assert.equal(at(209)?.on_close?.[0]?.id, 0x7600, "still inside at 209");
  assert.equal(at(210), null, "past the ceiling: they stop fighting you");
});
