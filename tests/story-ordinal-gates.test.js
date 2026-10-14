// Story-progression / ordinal-gating audit — the clauses the master story ordinal
// [0x8004b370] feeds, checked against the decoded original:
//
//   1. bank 0x70 op 0x30 = the story RANGE test, `F0x80015b9c`:
//        lbu lo, (table+2n) / lbu hi, 1(table+2n) / slt (ordinal < lo) -> 0
//        / slt (hi < ordinal) -> inverted, so `lo <= ordinal <= hi`, both bounds
//        INCLUSIVE, hi the literal byte the disc stores (0x63 = 99 in 7 of the 33
//        records — the disc's own end-of-story bound, not a missing bound).
//        Claim bank70-open-range-upper-bound-99-2026-10-02.
//   2. bank 0x60 = the story EQUALITY test, `F0x80015ec8`:
//        get_flag(0x60NN, e) = (ordinal == NN) == e; e == 0 is the CLEAR polarity.
//   3. The opening's download-lobby sequence (the WS4.11 bug class): s225's entry
//        chain starts event 5 at step 1, its completion stores step 2, and at step 2
//        the s210 Main Lobby's 0x6002-gated cast is live — and only that cast.
//   4. The 0x6006/0x4006/0x4016 class: an ordinal-equality gate ANDed with a stored
//        flag — s205's Keith appears only at step 6, only until beaten (0x4016).
//   5. The stage-entry arrival chain's data (arrival_candidates.json) is the disc's
//        own branch order: s200's pair is the delay-slot pair — 0x400d CLEAR starts
//        event 50, 0x400d SET starts event 52, both only at step 3.
//
// Assembly authority: ~/ddw3/asm/dw2003/exe/fns.s F0x80015b9c / F0x80015ec8;
// pro/wstag200.s:24-44 (the s200 pair); pro/wstag225.s:290-343 (the login room).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chapterNpcs, GameEngine, ordinalInRange } from "../engine/index.ts";
import { createFlagStore } from "../web/flag-store.js";

const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));
const rosterRaw = JSON.parse(readFileSync("web/assets/data/roster_predicate_table.json", "utf8"));
const rosterTable = {};
for (const r of rosterRaw.records) rosterTable[r.key] = r;
const sceneOf = (stage) => JSON.parse(readFileSync(`web/assets/scenes/${stage}.json`, "utf8"));

/** The live spawn-gate adapter the browser uses, at one ordinal with stored bits. */
function storeAt(ordinal, stored = {}) {
  const bits = new Map(Object.entries(stored).map(([k, v]) => [Number(k), v]));
  return createFlagStore(
    { get: (id) => (bits.get(id) ? 1 : 0), set: (id, v) => bits.set(id, !!v) },
    {
      getOrdinal: () => ordinal,
      rosterTable,
      hasItem: () => false,
      hasCard: () => false,
      packIndex: () => null,
      ownedSlots: () => 0,
      routePair: () => [0, 0],
      partyCharisma: () => null,
    },
  );
}

const openRanges = rosterRaw.records.filter((r) => (r.op & 0xf0) === 0x30 && r.ordinal_hi == null);
const closedRanges = rosterRaw.records.filter((r) => (r.op & 0xf0) === 0x30 && r.ordinal_hi != null);

// ── 1. bank 0x70 op 0x30: the range test and its literal upper bound ─────────────────────────
test("bank 0x70 op 0x30: an open-ended range ends at the disc's own byte 99 (0x63)", () => {
  // The seven open-ended records really are the disc's 0x63 slots (extract_roster_predicate_table.py
  // writes null for hi >= 0x63; F0x80015b9c compares the byte with no special case).
  assert.equal(openRanges.length, 7, "the disc ships seven 0x63 upper bounds");
  // 0x7009 = [4, 99]: live from step 4 THROUGH step 99, dead from 100.
  assert.equal(storeAt(4).get(0x7009), 1, "step 4 is the lower bound (inclusive)");
  assert.equal(storeAt(45).get(0x7009), 1, "a normal playthrough step is inside");
  assert.equal(storeAt(99).get(0x7009), 1, "the disc's own bound is inclusive");
  assert.equal(storeAt(100).get(0x7009), 0, "step 100 is past the disc's 0x63 bound");
  // The free-roam sentinel stagslct stores (0x300) is past it too.
  assert.equal(storeAt(0x300).get(0x7009), 0, "the free-roam sentinel is past the bound");
  // 0x7094 = [30, 99] and 0x7008 = [24, 99] — the other two in live spawn gates.
  assert.equal(storeAt(100).get(0x7094), 0);
  assert.equal(storeAt(100).get(0x7008), 0);
  assert.equal(storeAt(29).get(0x7094), 0, "below the lower bound stays dead");
  assert.equal(storeAt(30).get(0x7094), 1);
});

test("bank 0x70 op 0x30: the adapter agrees with the engine port for every shipped record", () => {
  // Every op-0x30 record, over every boundary and a sweep of steps: the browser adapter
  // (web/flag-store.js) and the engine's FlagManager (engine/dw3/dw3-config.ts) must
  // resolve identically — one rule, two consumers.
  const engine = new GameEngine(content);
  const ordinals = [];
  for (let o = 0; o <= 46; o++) ordinals.push(o);
  ordinals.push(98, 99, 100, 101, 300);
  for (const r of [...openRanges, ...closedRanges]) ordinals.push(r.ordinal_lo, r.ordinal_hi, r.ordinal_lo - 1, r.ordinal_hi + 1);
  const seen = new Set();
  for (const ord of ordinals.sort((a, b) => a - b)) {
    if (seen.has(ord)) continue;
    seen.add(ord);
    const store = storeAt(ord);
    engine.state.vars.set("$story.ordinal", ord);
    for (const r of rosterRaw.records.filter((x) => (x.op & 0xf0) === 0x30)) {
      const id = 0x7000 | r.key;
      const want = ordinalInRange(r.ordinal_lo, r.ordinal_hi, ord);
      assert.equal(store.get(id), want ? 1 : 0,
        `0x${id.toString(16)} (lo=${r.ordinal_lo} hi=${r.ordinal_hi}) at step ${ord}`);
      assert.equal(engine.state.flags.get(id, 1), want,
        `engine 0x${id.toString(16)} at step ${ord}`);
    }
  }
});

// ── 2. bank 0x60: ordinal equality, both polarities ─────────────────────────────────────────
test("bank 0x60: equality against the master ordinal, with expected=0 the clear polarity", () => {
  const engine = new GameEngine(content);
  engine.state.vars.set("$story.ordinal", 6);
  assert.equal(engine.state.flags.get(0x6006, 1), true, "step 6 satisfies 0x6006==1");
  assert.equal(engine.state.flags.get(0x6006, 0), false, "…and fails its clear polarity");
  assert.equal(engine.state.flags.get(0x6007, 1), false, "another step does not");
  assert.equal(engine.state.flags.get(0x6007, 0), true, "…and satisfies the clear polarity");
  const store = storeAt(6);
  assert.equal(store.get(0x6006), 1);
  assert.equal(store.get(0x6007), 0);
});

test("bank 0x60: an unwritten ordinal reads as the boot value 0", () => {
  // The disc's ordinal is a RAM word, 0 before anything writes it (BSS); the s780
  // opening row's own gate is 0x6000==1, so a fresh engine must satisfy it.
  const engine = new GameEngine(content);
  assert.equal(engine.state.vars.get("$story.ordinal"), undefined, "premise: not yet written");
  assert.equal(engine.state.flags.get(0x6000, 1), true, "0x6000==1 holds at boot");
  assert.equal(engine.state.flags.get(0x6000, 0), false);
  assert.equal(engine.state.flags.get(0x6001, 1), false);
});

// ── 3. The s225 -> s210 download-lobby sequence ─────────────────────────────────────────────
const arrival = JSON.parse(readFileSync("web/assets/data/scene/arrival_candidates.json", "utf8")).stages;

test("s225 Login Room: the entry chain starts event 5 at step 1, and it stores step 2", () => {
  // pro/wstag225.s:290-308 — the entry object's reset band reads the ordinal, li $v0,1,
  // and only on equality calls start_event with `li $a0,0x5` in the delay slot.
  const chain = arrival.s225;
  assert.equal(chain.tick, "0x800a623c");
  assert.deepEqual(chain.candidates.map((c) => ({ event: c.event, ordinal: c.ordinal, conds: c.conds, paths: c.paths })), [{
    event: 5, ordinal: 1, conds: [[0x6001, 1]], paths: [[[0x6001, 1]]],
  }]);
  const engine = new GameEngine(content, { driven: true });
  engine.state.vars.set("$story.ordinal", 1);
  engine.loadStage("s225");
  const h = engine.raise("OnEnterMap");
  assert.ok(h, "the arrival row fires at step 1");
  engine.pump(h);
  assert.equal(engine.lastYield?.kind, "event");
  assert.equal(engine.lastYield.evId, 5);
  engine.completeEvent(5);                       // pro/wstag225.s:0x530 `li $v0,2 / sw …b370`
  assert.equal(engine.state.vars.get("$story.ordinal"), 2, "the login room's scene stores step 2");
});

test("s210 Main Lobby at step 2: exactly the 0x6002-gated cast is live (the WS4.11 beat)", () => {
  const scene = sceneOf("s210");
  const gated = scene.npcs.filter((n) => (n.spawn_flags ?? []).some((f) => f.id === 0x6002 && f.expected === 1));
  assert.equal(gated.length, 10, "the disc gates ten s210 records on step 2");
  const liveAt = (ord) => {
    const store = storeAt(ord);
    return chapterNpcs(scene.npcs, 1, store.get);
  };
  const at2 = liveAt(2);
  assert.equal(at2.length, 10, "step 2 populates the lobby");
  assert.deepEqual([...at2].map((n) => n.npc_id).sort((a, b) => a - b),
    [...gated].map((n) => n.npc_id).sort((a, b) => a - b),
    "and every live record is one of the 0x6002 ones");
  assert.equal(liveAt(1).length, 0, "step 1 (the login room) shows an empty lobby");
  assert.equal(liveAt(0).length, 0, "so does step 0");
});

// ── 4. The 0x6006/0x4006/0x4016 class: ordinal equality AND a stored flag ───────────────────
test("s205: Keith is on the bridge only at step 6, and only until he is beaten (0x4016)", () => {
  const scene = sceneOf("s205");
  const keith = scene.npcs.find((n) => n.npc_id === 102);   // sprite p152keit
  assert.deepEqual(keith.spawn_flags, [{ id: 0x6006, expected: 1 }, { id: 0x4016, expected: 0 }]);
  const present = (ord, beaten) =>
    chapterNpcs(scene.npcs, 1, storeAt(ord, { 0x4016: beaten ? 1 : 0 }).get).some((n) => n.npc_id === 102);
  assert.equal(present(5, false), false, "not yet at the bridge beat");
  assert.equal(present(6, false), true, "the bridge fight's step");
  assert.equal(present(6, true), false, "beaten: he is gone");
  assert.equal(present(7, false), false, "past the step, he does not come back");
});

// ── 5. The producer's own edge: s780's opening scene RESETS the ordinal to 0 ────────────────
test("s780 Kusanagi Street Corner: event 0's completion stores the ordinal as a reset to 0", () => {
  // wstag780.s .L0x182c: `lui $v0,0x8005 / jr $ra / sw $zr,-0x4c90($v0)` — a 3-word leaf
  // whose store is `$zr`: the opening street scene writes 0 (the story's start). Its own
  // entry gate is 0x6000==1, so it plays at boot and the write is the disc's own reset.
  // Event 885's routine (file 0x1838) sets 0x4066 and stores no ordinal.
  const engine = new GameEngine(content, { driven: true });
  engine.loadStage("s780");
  engine.completeEvent(885);
  assert.equal(engine.state.vars.get("$story.ordinal"), undefined, "885 writes no ordinal");
  engine.completeEvent(0);
  assert.equal(engine.state.vars.get("$story.ordinal"), 0, "event 0 stores 0");
  // The store is unconditional, exactly as `sw` is: a stale ordinal is reset by the routine.
  engine.state.vars.set("$story.ordinal", 0x2d);
  engine.completeEvent(0);
  assert.equal(engine.state.vars.get("$story.ordinal"), 0);
});

// ── 6. The arrival chain's data is the disc's own branch order ───────────────────────────────
test("s200 Asuka City: the delay-slot pair — 0x400d clear starts 50, set starts 52", () => {
  // pro/wstag200.s:24-44: bne(ordinal,3) then `li $a0,0x400d` in the DELAY SLOT, get_flag(0x400d,0),
  // `beqz` with `li $a0,0x34` (52) in ITS delay slot, `li $a0,0x32` (50) on the fall-through.
  const s200 = arrival.s200;
  assert.deepEqual(s200.candidates.map((c) => ({ event: c.event, ordinal: c.ordinal, conds: c.conds })), [
    { event: 52, ordinal: 3, conds: [[0x6003, 1], [0x400d, 1]] },
    { event: 50, ordinal: 3, conds: [[0x6003, 1], [0x400d, 0]] },
  ]);
  // …and the converted rows carry the same conjunctions, evaluated by the real engine.
  const rows = new Map(content.stages.find((s) => s.mapId === "s200").events.map((e) => [e.id, e]));
  assert.deepEqual(rows.get("s200.auto.52").if, { kind: "all", children: [
    { kind: "leaf", leaf: "flag", args: [0x6003, 1] },
    { kind: "leaf", leaf: "flag", args: [0x400d, 1] },
  ] });
  assert.deepEqual(rows.get("s200.auto.50").if, { kind: "all", children: [
    { kind: "leaf", leaf: "flag", args: [0x6003, 1] },
    { kind: "leaf", leaf: "flag", args: [0x400d, 0] },
  ] });
  for (const [clear400d, want] of [[true, 50], [false, 52]]) {
    const engine = new GameEngine(content, { driven: true });
    engine.state.vars.set("$story.ordinal", 3);
    engine.state.flags.set(0x400d, !clear400d);
    // The converted scripted-battle row (s200.sb.battle, priority 2) owns the ARMED state
    // [0x400d==1, 0x1200==0]; the win flag disarms it so the chain's own decision shows.
    engine.state.flags.set(0x1200, true);
    engine.loadStage("s200");
    const h = engine.raise("OnEnterMap");
    assert.ok(h);
    engine.pump(h);
    assert.equal(engine.lastYield?.kind === "event" ? engine.lastYield.evId : null, want,
      `0x400d ${clear400d ? "clear" : "set"} at step 3 starts event ${want}`);
  }
});
