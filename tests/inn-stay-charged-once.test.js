// tests/inn-stay-charged-once.test.js — a stay is charged ONCE, and a stay that
// was dismissed never charges at all.
//
// WHAT WENT WRONG (2026-10-04). Two walkers could be up over the same button: the
// memory card and the inn's rest screen. One Circle was then taken twice, and the
// wallet read 1000 -> 976 for the stay and 976 -> 952 again under the card
// (tools/verify_inn_rest.mjs, "the card did not charge the stay a second time").
// Two shared faults fed it:
//
//   1. THE ADAPTER CONTRACT. Every translated screen adapter sets `_open` BEFORE its
//      first await and bumps `_request` on the way out, so a close() that lands while
//      the bank is still loading discards the pending open
//      (web/shop-translated.js:93/141, web/dialogue-translated.js:94/174,
//      web/help-menu-translated.js:50/122). web/inn-translated.js set `_open` only
//      AFTER the await and never invalidated the request, so a close() during the load
//      was swallowed and the open went on to raise a rest screen its caller had
//      already dismissed — the screen that then sat under the card. THAT is the case
//      the second test below pins, and it fails on the pre-2026-10-04 adapter.
//   2. THE DISPATCH LADDER. The card is an overlay loaded over the field while the
//      rest screen is a screen object of the field, so the card owns the pad. Its
//      exclusive branch now sits above the field's screens in web/game.js's
//      dispatchInput; the route-level proof of that half is the verifier's deliberate
//      overlap, not a unit test, because the ladder lives in the browser host.
//
// THE ORIGINAL CHARGES ONCE. One `subu`/`sw` pair, in one state of one object:
// `F0x800110e0` (~/ddw3/asm/dw2003/exe/fns.s:1538) reads `obj+0x10` as the state and
// jumps through the 33-word table that ships at `fns.s:5-38`, index 21 ->
// `F0x800116f8`, whose tail charges `D0x80048d34+0x6c` (= 0x80048DA0, the same BIT cell
// the affordability test reads at exe/fns.s:1807) with `subu $v0, $a3` (fns.s:2021) and
// stores it in the delay slot of `jal F0x8001104c` (fns.s:2023). Inside that update the
// state is written in exactly two places — the prompt's Confirm arm (fns.s:1814, 10 or
// 20) and the shared `state+1` tail (fns.s:2024-2026, store at fns.s:2140) — so the walk
// 3 -> 20 -> 21 -> 22 rises and state 21, which reads no button at all, is entered once.
// (What is NOT established: whether a method of the class outside that update writes the
// state; its table is installed by the allocator and was not enumerated. See
// docs/research/ui/inn-rest-service-decoded-2026-08-13.md §6b.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The adapter fetches its font, its ranges and its bank out of assets/data; serve
// them from the worktree instead of a server so the adapter can be driven headless.
const DATA_ROOT = new URL("../web/assets/data/", import.meta.url);
const pending = new Map();
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^.*assets\/data\//, "");
  const gate = pending.get(rel);
  if (gate) await gate;
  const buf = await readFile(new URL(rel, DATA_ROOT));
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    json: async () => JSON.parse(buf.toString("utf8")),
  };
};

const { createInnTranslated } = await import("../web/inn-translated.js");

// s235 = Asuka Inn, 8 BIT a head (engine/dw3/inn.ts). Three deployed Digimon, so a
// stay costs 24. The lead's own block is partnerStats; the two members are
// partyStats[1] and [2] (web/inn.js partyOf).
const makeState = (bits = 1000) => ({
  bits,
  languageByte: 2,
  party: ["p003pken", "p009rena", "p010pata"],
  partnerStats: { digimonId: 1, level: 20, xp: 0, hp: 120, maxHp: 400, mp: 30, maxMp: 160 },
  partyStats: [
    { digimonId: 1, level: 20, xp: 0, hp: 120, maxHp: 400, mp: 30, maxMp: 160 },
    { digimonId: 7, level: 17, xp: 0, hp: 60, maxHp: 310, mp: 10, maxMp: 140 },
    { digimonId: 8, level: 15, xp: 0, hp: 5, maxHp: 290, mp: 0, maxMp: 130 },
  ],
});
const stepOf = (inn) => inn.diagnostics().state?.step ?? null;
/** Run the display clock until the screen reaches `step`, then return true. */
const tickTo = async (inn, step, frames = 600) => {
  for (let i = 0; i < frames; i++) {
    inn.tick(1 / 60);
    if (!inn.isOpen()) return false;
    if (stepOf(inn) === step) return true;
    await new Promise((r) => setImmediate(r));
  }
  return false;
};

test("one stay at the Asuka Inn charges 8 BIT per deployed Digimon, once", async () => {
  const state = makeState();
  const inn = createInnTranslated();
  const quote = await inn.open(state, { map: "s235" });
  assert.deepEqual(quote, { count: 3, total: 24, affordable: true });

  assert.ok(await tickTo(inn, 3), `the prompt never reached step 3 (stopped at ${stepOf(inn)})`);
  inn.confirm();
  // The stay runs its own fold-out, healing and charging on the way (state 21).
  for (let i = 0; i < 1200 && inn.isOpen(); i++) inn.tick(1 / 60);

  assert.equal(inn.diagnostics().rests, 1, "the stay ran exactly once");
  assert.equal(state.bits, 976, "1000 - 3 x 8, once");
  assert.deepEqual(
    [state.partnerStats, state.partyStats[1], state.partyStats[2]].map((m) => [m.hp, m.mp]),
    [[400, 160], [310, 140], [290, 130]],
    "F0x8001104c put every deployed member back to full",
  );
});

test("a stay dismissed while its bank is still loading never charges the wallet", async () => {
  const state = makeState();
  const inn = createInnTranslated();
  // Hold the eshtlnam bank so the close() lands inside the load, which is the window
  // the pre-2026-10-04 adapter lost: it had not raised `_open` yet, so finish() read a
  // closed screen and the open went on to build the rest screen anyway.
  let release = null;
  const gate = new Promise((r) => { release = r; });
  pending.set(`inn-banks/${2}.bin`, gate);
  try {
    const opening = inn.open(state, { map: "s235" });
    inn.close();
    release();
    await opening;
  } finally {
    pending.delete("inn-banks/2.bin");
  }

  // Whatever the load finished, no screen may be up and no frame may charge.
  for (let i = 0; i < 120; i++) inn.tick(1 / 60);
  assert.equal(inn.isOpen(), false, "the dismissed stay stayed dismissed");
  assert.equal(state.bits, 1000, "a stay that never reached its prompt is not charged");
  assert.equal(inn.diagnostics().rests, 0, "the rest effect never ran");
  assert.equal(state.partnerStats.hp, 120, "nobody was healed either");
});