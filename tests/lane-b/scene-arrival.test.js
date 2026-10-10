// Oracle: engine/systems/scene-arrival.ts must make the SAME choice as every one of
// the original per-place arrival dispatchers.
//
// The original side runs the disc's OWN dispatcher — the word each overlay hands
// F0x80014504 as its entry object's tick — out of that overlay's own image through
// engine/native, with the two things the dispatcher reaches through a pointer
// replaced by recording stubs: get_flag (the cell at 0x80048ACC, which the
// dispatcher reads as a function pointer and jalr's) and start_event (0x800853f8,
// which records the id it was handed). The port side runs the same chain from
// web/assets/data/scene/arrival_candidates.json over the same seeded (ordinal, flag)
// state and must return the same id — including "started nothing".
//
// The ladder per place: every story ordinal the chain compares against, plus 0 and
// plus a value the chain never names, crossed with EVERY combination of the flags
// the chain tests. That covers each candidate's positive case, its negative case and
// every overlap between two candidates of the same beat — which is exactly what the
// chain ORDER decides (s305 890 vs 893, the pair the converter's hand row
// DISPATCHER_CHAIN_CONDS used to patch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import * as S from "../../engine/systems/scene-arrival.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native");
const RESIDENT = new Uint8Array(readFileSync(join(dir, "screens/resident.bin")));
const ORDINAL = 0x8004b370;         // the master story ordinal
const GETFLAG_CELL = 0x80048acc;    // the get_flag function-pointer cell
const START_EVENT = 0x800853f8;     // fieldstg start_event(event_id)
const SELF = 0x80160000;            // the fake entry object (phase word at +0xc)
const VT = 0x80160400;              // its vtable
const OUTP = 0x80160800;            // the caller's out-pointer ($a1)
const FLAGS = 0x80161000;           // the seeded flag words, one per tested id
const DESC = 0x80099d80;            // the shared scene descriptor

const raw = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/scene/arrival_candidates.json"), "utf8"));

// The whole gate-object family, counted out of the overlays (tools/measure_gate_objects.py):
// the band every routine belongs to, and for a phase-1 object the address of its own
// ambient updater. Nothing here is a hand list.
const census = JSON.parse(execFileSync(
  process.env.PY ?? ".venv/bin/python3",
  ["tools/measure_gate_objects.py"],
  { encoding: "utf8" }));
const censusByTick = new Map(census.rows.map((r) => [r.tick, r]));

S.setArrivalChains(raw);

// ── the flag store both sides read ───────────────────────────────────────────────────────────
// One word per flag id the chain names. `get_flag(id, expected)` returns nonzero iff
// the flag READS as expected, which is the banked-predicate semantics the original's
// branches test (pro/wstag200.s:33-37).
const words = new Map();
const ids = [];
const flagWord = (id) => {
  let w = words.get(id);
  if (w === undefined) { w = ids.length; ids.push(id); words.set(id, w); }
  return w;
};

function bitsFor(pattern) {
  const on = new Set();
  ids.forEach((id, i) => { if (pattern & (1 << i)) on.add(id); });
  return on;
}

function makeKit(image, ambientUpdater) {
  const ENTRY = { size: image.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
  // A stage overlay maps at 0x800A5DE0 (the default); fieldstg is NOT loaded, so the
  // dispatcher's `jal start_event` lands on the recording stub below.
  const rt = new NativeStageRuntime(image, ENTRY, { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 },
    undefined, undefined, undefined, { image: RESIDENT, base: 0x80010000 });
  rt.cpu.gp = 0x8005cb50;
  let started = null;
  const startedIds = [];
  rt.cpu.setStub(START_EVENT, (c) => { started = c.reg(4) | 0; startedIds.push(started); return 0x800a0000; });
  // The dispatcher does not CALL 0x80048ACC: it reads the function pointer out of
  // that cell (`lw $v0,-0x7534($v0)` after `lui $v0,0x8005`, or `0x80048ABC+0x10`) and
  // jalr's it. So the cell has to hold the recording stub.
  const GETFLAG = 0x80163000;
  rt.cpu.setStub(GETFLAG, (c) => {
    const id = c.reg(4) | 0, exp = c.reg(5) | 0;
    const v = rt.mem.read32(FLAGS + flagWord(id) * 4);
    return (v & 1) === (exp & 1) ? 1 : 0;
  });
  rt.mem.write32(GETFLAG_CELL, GETFLAG);
  const VT38 = 0x80162000;
  rt.cpu.setStub(VT38, () => 0);
  rt.mem.write32(SELF + 0x38, VT38);
  rt.mem.write32(VT + 0x38, VT38);
  // A phase-1 gate object calls its overlay's OWN ambient updater and then tests that the
  // scene descriptor is IDLE before it starts anything (pro/wstag795.s:0x600-0x654 reads
  // +0x50/+0x54/+0x58/+0x5c/+0x60 and returns on any of them). The updater belongs to a
  // different shared system, so it is stubbed — and only for the ONE overlay that owns it,
  // because that address is an instruction of some other place's dispatcher (s212's tick is
  // 0x800a622c, so 0x800a6234 is inside s212). The descriptor is seeded idle, which is the
  // state a freshly loaded field is in.
  if (ambientUpdater) rt.cpu.setStub(ambientUpdater, () => 0);
  for (const off of [0x50, 0x54, 0x58, 0x5c, 0x60]) rt.mem.write32(DESC + off, 0);
  return {
    rt,
    run(tick, phase, on) {
      rt.mem.write32(SELF + 0xc, phase >>> 0);
      rt.mem.write32(ORDINAL, on.ordinal >>> 0);
      for (const id of on.flags) rt.mem.write32(FLAGS + flagWord(id) * 4, 1);
      for (const id of ids) if (!on.flags.has(id)) rt.mem.write32(FLAGS + flagWord(id) * 4, 0);
      rt.mem.write32(OUTP, 0);
      started = null;
      startedIds.length = 0;
      rt.cpu.call(tick >>> 0, [SELF, OUTP, 0], 200000);
      return started;
    },
  };
}

/** A predicate over one ladder state. An ordinal leaf 0x6000|n asserts the master
 *  story step IS n (its `exp` is always 1); a flag leaf asserts the flag reads as
 *  `exp`, which is what get_flag returns nonzero for. */
function testFor(st) {
  return (id, exp) => ((id & 0xff00) === 0x6000)
    ? st.ordinal === (id & 0xff)
    : st.flags.has(id) === (exp === 1);
}

/** Every (ordinal, flag-set) state the ladder covers for one chain. */
function ladder(chain) {
  const ords = new Set([0]);
  const flags = [];
  const seen = new Set();
  for (const c of chain.candidates) {
    for (const p of c.paths) for (const [id, exp] of p) {
      if (((id & 0xff00) === 0x6000) && exp === 1) ords.add(id & 0xff);
      else if (((id & 0xff00) !== 0x6000) && !seen.has(id)) { seen.add(id); flags.push(id); }
    }
  }
  ords.add(0x7f);   // a story step the chain never names
  const ordList = [...ords].sort((a, b) => a - b);
  const combos = 1 << flags.length;
  const out = [];
  for (const o of ordList) for (let m = 0; m < combos; m++) out.push({ ordinal: o, flags: bitsFor(m) });
  return { states: out, flagIds: flags };
}

const stages = Object.entries(raw.stages).sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));

/** One place's gate objects: 76 places install the stage's ENTRY object (reset band) and
 *  s795/s800 install a SECOND whose band is `phase1` (pro/wstag795.s:0x5b4-0x5d0 `beq phase,1`
 *  where the entry object's is `beqz phase`). */
const gateObjects = (mapId, v) => (Array.isArray(v) ? v : [v]).filter(Boolean);

/** Run one original gate object and report the id it handed start_event, or null.
 *
 *  The phase-1 object decides on its SECOND turn: a freshly allocated object's phase
 *  word is 0, its phase-0 arm returns through the object's own `vt+0x38`
 *  (exe/fns.s:8955-8963 F0x800142ac, `phase = phase + 1`), and the turn after that is
 *  the one that runs the chain. So the oracle advances the phase word the way the base
 *  object's `vt+0x38` does and compares the pass that actually ran the band. */
function runOriginal(kit, tick, band, on, maxTurns = 4) {
  for (let phase = 0; phase < maxTurns; phase++) {
    const ran = S.arrivalRunsOnPhase(phase, band);
    const got = kit.run(parseInt(tick, 16), phase, on);
    if (ran) return got;
  }
  return null;
}

test("every stage's arrival chain runs its own overlay's dispatcher identically", () => {
  let states = 0, started = 0;
  const diffs = [];
  for (const [mapId, v] of stages) {
    const image = new Uint8Array(readFileSync(join(dir, `${mapId}.bin`)));
    for (const row of gateObjects(mapId, v)) {
      const amb = censusByTick.get(row.tick);
      const kit = makeKit(image, amb?.ambient_updater ? parseInt(amb.ambient_updater, 16) : null);
      assert.ok(row, `${mapId}: no dispatcher row`);
      assert.ok(row.phase_gate, `${mapId}: dispatcher has no phase gate`);
      const band = row.phase_gate.band ?? "reset";
      const chain = { mapId, tick: row.tick, band, candidates: row.candidates };
      S.setArrivalChains({ stages: { [mapId]: chain } });
      const { states: ladderStates, flagIds } = ladder(chain);
      for (const st of ladderStates) {
        states++;
        const test = testFor(st);
        const want = S.chooseArrivalEvent(chain, test);
        const got = runOriginal(kit, row.tick, band, st);
        if (want !== null) started++;
        if (want !== got) {
          diffs.push(`${mapId}/${row.tick} ord=${st.ordinal} flags=[${[...st.flags].map((f) => "0x" + f.toString(16))}]` +
            ` port=${want} original=${got}`);
        }
      }
      if (diffs.length) break;
    }
    if (diffs.length) break;
  }
  assert.deepEqual(diffs, [], `${diffs.length} state(s) differ`);
  assert.ok(states > 2000, `ladder too small: ${states} states`);
  assert.ok(started > 200, `no candidate ever matched: ${started}`);
});

test("both band shapes ship, and the census of gate objects is the whole family", () => {
  // Every routine any wstag overlay hands the shared allocator whose body calls the shared
  // starter is one of these: 76 stage-entry gate objects on the reset band, 2 second gate
  // objects on the phase-1 band, and 8 interactive UI controllers (the help menu / yes-no
  // families) which take their event id from a register and are a different shared system
  // (engine/dw3/ui/native/*). Counted from the overlays, not from a hand list.
  const bands = { reset: 0, phase1: 0 };
  for (const v of Object.values(raw.stages)) for (const r of gateObjects("", v)) {
    const b = r.phase_gate.band ?? "reset";
    bands[b] = (bands[b] ?? 0) + 1;
  }
  assert.equal(bands.reset, census.reset_band, "reset-band gate objects");
  assert.equal(bands.phase1, census.phase1_band, "phase1-band gate objects");
  assert.equal(bands.reset + bands.phase1 + census.controllers, census.total,
    "every gate object that calls start_event is a band, or an interactive controller");
  assert.ok(census.stages_with_two >= 2, "s795 and s800 each install a second gate object");
});

test("the phase-1 object's own second turn is what starts its scene", () => {
  // pro/wstag795.s:0x5b4-0x5d0 reads the phase word, returns on 0 / 2 / 3 / >=4, and runs the
  // chain only on 1 — which the object reaches because its phase-0 arm advances through its own
  // vt+0x38. s795 then starts event 1505 and s800 event 1506, both behind flag 0x4043, which
  // s795's event 830 completion sets (pro/wstag795.s:0x8d0-0x8e8, scene_completion.json).
  S.setArrivalChains(raw);
  for (const [mapId, event] of [["s795", 1505], ["s800", 1506]]) {
    const objs = raw.stages[mapId];
    assert.ok(Array.isArray(objs) && objs.length === 2, `${mapId} must have two gate objects`);
    const second = objs.find((r) => r.phase_gate.band === "phase1");
    assert.ok(second, `${mapId}: no phase-1 gate object`);
    const chain = S.arrivalGateObjects(mapId).find((c) => c.band === "phase1");
    assert.ok(chain, `${mapId}: phase-1 chain not installed`);
    const ev = (flags) => S.chooseArrivalEvent(chain, testFor({ ordinal: 0, flags }));
    assert.equal(ev(new Set([0x4043])), event, `${mapId}: flag 0x4043 set starts ${event}`);
    assert.equal(ev(new Set()), null, `${mapId}: flag 0x4043 clear starts nothing`);
    // and the band itself: only phase 1 runs the chain.
    assert.equal(S.arrivalRunsOnPhase(1, "phase1"), true);
    for (const p of [0, 2, 3, 4, -1]) assert.equal(S.arrivalRunsOnPhase(p, "phase1"), false);
    assert.equal(S.arrivalEventForPhase(chain, 1, testFor({ ordinal: 0, flags: new Set([0x4043]) })), event);
    assert.equal(S.arrivalEventForPhase(chain, 0, testFor({ ordinal: 0, flags: new Set([0x4043]) })), null);
    // The ORIGINAL, turn by turn: nothing on the fresh object's phase 0, the scene on the turn
    // the phase advance reaches 1, nothing again once it has advanced past it.
    const image = new Uint8Array(readFileSync(join(dir, `${mapId}.bin`)));
    const kit = makeKit(image, parseInt(censusByTick.get(second.tick).ambient_updater, 16));
    const set = { ordinal: 0, flags: new Set([0x4043]) };
    assert.equal(kit.run(parseInt(second.tick, 16), 0, set), null, `${mapId}: turn 1 must start nothing`);
    assert.equal(kit.run(parseInt(second.tick, 16), 1, set), event, `${mapId}: turn 2 must start ${event}`);
    assert.equal(kit.run(parseInt(second.tick, 16), 2, set), null, `${mapId}: turn 3 must start nothing`);
    // and the other band: flag 0x4043 clear is the gate, on the ORIGINAL too.
    assert.equal(kit.run(parseInt(second.tick, 16), 1, { ordinal: 0, flags: new Set() }), null,
      `${mapId}: flag 0x4043 clear must start nothing on the original`);
  }
});

test("the chain order, not the gates, keeps two candidates of one beat apart", () => {
  // s305 starts 890 or 893 at story step 33, both needing flag 0x1c39 clear; only the
  // chain order (and the 0x4057 leaf the extract keeps) tells them apart.
  S.setArrivalChains(raw);
  const chain = S.arrivalChain("s305");
  assert.ok(chain, "s305 chain missing");
  const ev = (flags, ordinal = 33) =>
    S.chooseArrivalEvent(chain, testFor({ ordinal, flags }));
  assert.equal(ev(new Set()), 890);                              // flag 0x4057 clear
  assert.equal(ev(new Set([0x4059, 0x1a34])), 890);              // still 890: it is EARLIER
  assert.equal(ev(new Set([0x4057, 0x4059, 0x1a34])), 893);
  assert.equal(ev(new Set([0x4057, 0x4059])), 894);
  assert.equal(ev(new Set(), 0), null);                          // a fresh game: nothing
});

test("a fresh game in one place really does call start_event with id 0", () => {
  // pro/wstag780.s:1496-1500 — `bnez $v1` sends a non-zero story step into the chain and
  // an ordinal of 0 into `j start_event` with $a0 = 0. start_event(0) binds no record
  // (fieldstg.s:2536-2540), so nothing plays; the chain still has to say so.
  S.setArrivalChains(raw);
  const chain = S.arrivalChain("s780");
  assert.equal(S.chooseArrivalEvent(chain, testFor({ ordinal: 0, flags: new Set() })), 0);
  assert.equal(S.chooseArrivalEvent(chain, testFor({ ordinal: 23, flags: new Set() })), 684);
});

test("the entry object only tests the chain on its reset band", () => {
  assert.equal(S.arrivalRunsOnPhase(0), true);
  assert.equal(S.arrivalRunsOnPhase(-1), true);
  assert.equal(S.arrivalRunsOnPhase(4), true);
  for (const p of [1, 2, 3]) assert.equal(S.arrivalRunsOnPhase(p), false);
  S.setArrivalChains(raw);
  const chain = S.arrivalChain("s440");
  const at = (ordinal) => testFor({ ordinal, flags: new Set() });
  assert.equal(S.arrivalEventForPhase(chain, 0, at(6)), 152);  // s440: ord==6 -> 152
  assert.equal(S.arrivalEventForPhase(chain, 2, at(6)), null); // phase 1..3 returns untested
  assert.equal(S.arrivalEventForPhase(chain, 4, at(6)), 152);  // the reset band again
  assert.equal(S.arrivalEventForPhase(chain, 0, at(7)), null); // and any other story step
});

test("a place with no arrival dispatcher starts nothing", () => {
  S.setArrivalChains(raw);
  assert.equal(S.chooseArrivalEvent(S.arrivalChain("s999"), () => true), null);
  assert.equal(S.chooseArrivalEvent(null, () => true), null);
});