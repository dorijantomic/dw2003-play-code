// Oracle for the action VM's timeline sampler (engine/dw3/battle-timeline-sampler.ts).
//
// The strongest check runs the ORIGINAL instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native and compares the sampler's own fields every
// tick: frame (+0x84), announced (+0x90), the loop-segment flag (+0x94), the
// blend fraction (+0x98), the frozen flag (+0x7c) and the playhead (+0x80).
// FIGHTSTG_F0x80083c30's three calls out to the actor graph (F0x800835f4 /
// F0x800839c0 / F0x80083a54) are recording stubs: they touch OTHER objects, never
// the six fields compared here.
// A negative control proves the comparison would catch a wrong port.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  frameTableFromEntries, newSamplerState, sampleTick,
  LOOP_MARKER, END_MARKER,
  type TimelineEntry, type SamplerState,
} from "../../../engine/dw3/battle-timeline-sampler.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const SAMPLER = 0x80083c30;
const F_SUBSLOT = 0x800835f4;
const F_ANNOUNCE2 = 0x800839c0;
const F_ADVANCE = 0x80083a54;
const DELTA_CELL = 0x800a4464;

const OBJ = 0x80100000;
const CTX64 = 0x80102000; // the object's +0x64 pointer target

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

interface Log {
  ann: boolean;
  adv: boolean;
}

function runtime(log: Log): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  rt.cpu.setStub(F_SUBSLOT, () => 0);
  rt.cpu.setStub(F_ANNOUNCE2, () => { log.ann = true; return 0; });
  rt.cpu.setStub(F_ADVANCE, () => { log.adv = true; return 0; });
  return rt;
}

/** Write the three parallel arrays + object fields the sampler reads. */
function seed(rt: NativeStageRuntime, entries: TimelineEntry[], delta: number, start: number): void {
  const m = rt.mem;
  m.write32(DELTA_CELL, delta);
  m.write32(OBJ + 0x64, CTX64);
  m.write32(CTX64 + 0x18, 0);
  m.write32(CTX64 + 0x8, 0);
  m.write32(OBJ + 0x50, 0); // no sub-slots → the announce loop is empty
  m.write32(OBJ + 0xa0, entries.length);
  for (let i = 0; i < entries.length; i++) {
    m.write16(OBJ + 0xa4 + i * 2, (entries[i]!.value ?? 0) & 0xffff);
    m.write16(OBJ + 0xd24 + i * 2, (entries[i]!.loop_target ?? 0) & 0xffff);
    m.write16(OBJ + 0x19a4 + i * 2, (entries[i]!.aux ?? 0) & 0xffff);
  }
  m.write32(OBJ + 0x80, start);
  m.write32(OBJ + 0x84, 0);
  m.write32(OBJ + 0x90, 0);
  m.write32(OBJ + 0x94, 0);
  m.write32(OBJ + 0x98, 0);
  m.write32(OBJ + 0x7c, 0);
  m.write32(OBJ + 0x60, 0);
  m.write32(OBJ + 0x9c, 0);
}

function readState(rt: NativeStageRuntime): SamplerState {
  const m = rt.mem;
  return {
    playhead: m.read32(OBJ + 0x80) | 0,
    frame: m.read32(OBJ + 0x84) | 0,
    announced: m.read32(OBJ + 0x90) | 0,
    loopSeg: (m.read32(OBJ + 0x94) | 0) !== 0,
    frac: m.read32(OBJ + 0x98) | 0,
    frozen: (m.read32(OBJ + 0x7c) | 0) !== 0,
    gate: m.read32(OBJ + 0x60) | 0,
    pending: m.read32(OBJ + 0x9c) | 0,
  };
}

const s = (v: number | undefined) => (v ?? 0) & 0xffff;
const ENTRIES = (pairs: [number, number][]): TimelineEntry[] =>
  pairs.map(([value, loop_target]) => ({ value, loop_target }));

/** Run both samplers for `ticks` and assert every field matches each tick. */
function compare(label: string, entries: TimelineEntry[], delta: number, ticks: number): void {
  const log: Log = { ann: false, adv: false };
  const rt = runtime(log);
  seed(rt, entries, delta, 1);
  const port = newSamplerState(1);
  const table = frameTableFromEntries(entries);
  for (let i = 0; i < ticks; i++) {
    log.ann = false; log.adv = false;
    rt.cpu.call(SAMPLER, [OBJ], 200000);
    const orig = readState(rt);
    const origAnn = log.ann;
    const origAdv = log.adv;
    let portAnn = false;
    let portAnnTarget = -1;
    const portAdv = sampleTick(port, table, delta, {
      announce: (lt) => { portAnn = true; portAnnTarget = lt; },
      advanceFrozen: () => {},
    });
    assert.equal(orig.playhead, port.playhead, `${label} tick ${i}: playhead`);
    assert.equal(orig.frame | 0, port.frame | 0, `${label} tick ${i}: frame`);
    assert.equal(orig.announced, port.announced, `${label} tick ${i}: announced`);
    assert.equal(orig.loopSeg, port.loopSeg, `${label} tick ${i}: loopSeg`);
    assert.equal(orig.frac, port.frac, `${label} tick ${i}: frac`);
    assert.equal(orig.frozen, port.frozen, `${label} tick ${i}: frozen`);
    assert.equal(origAnn, portAnn, `${label} tick ${i}: announce call`);
    if (portAnn) assert.equal(portAnnTarget, orig.announced, `${label} tick ${i}: announce target`);
    assert.equal(origAdv, portAdv, `${label} tick ${i}: advance call`);
  }
}

// ── 1. a plain frame table ──────────────────────────────────────────────────

test("F0x80083c30 plain frame table: the original fields equal the port", SKIP, () => {
  const entries = ENTRIES([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [END_MARKER, 0]]);
  compare("plain", entries, 1, 7);
});

// ── 2. an idle table that loops in place on 0x8000 ──────────────────────────

test("F0x80083c30 0x8000 loop marker: the playhead jumps to loop_target in place", SKIP, () => {
  const entries = ENTRIES([[10, 0], [11, 0], [12, 0], [13, 0], [LOOP_MARKER, 0]]);
  compare("loop", entries, 1, 12);
});

// ── 3. a blend segment (value & 0x8000, target a real frame) ────────────────

test("F0x80083c30 blend segment: frame = loop_target, flag 1, frac = value & 0x7fff", SKIP, () => {
  const entries = ENTRIES([[0, 0], [0x8100, 4], [4, 0], [5, 0], [END_MARKER, 0]]);
  compare("blend", entries, 1, 8);
});

// ── 4. the frozen path (a 0xffff end marker) ────────────────────────────────

test("F0x80083c30 0xffff end marker: the sampler freezes and holds the frame", SKIP, () => {
  const entries = ENTRIES([[0, 0], [1, 0], [END_MARKER, 0]]);
  compare("freeze", entries, 1, 8);
});

// ── 5. the frozen path with the advance gate open ───────────────────────────

test("F0x80083c30 frozen advance: gate and pending open the transition call", SKIP, () => {
  const entries = ENTRIES([[0, 0], [1, 0], [END_MARKER, 0]]);
  const log: Log = { ann: false, adv: false };
  const rt = runtime(log);
  seed(rt, entries, 1, 1);
  const port = newSamplerState(1);
  const table = frameTableFromEntries(entries);
  // drive both to the freeze
  for (let i = 0; i < 4; i++) { rt.cpu.call(SAMPLER, [OBJ], 200000); sampleTick(port, table, 1); }
  assert.equal(port.frozen, true, "the port froze");
  assert.equal((rt.mem.read32(OBJ + 0x7c) | 0) !== 0, true, "the original froze");
  // open the frozen-path gate on both
  rt.mem.write32(OBJ + 0x60, 1); rt.mem.write32(OBJ + 0x9c, 2);
  port.gate = 1; port.pending = 2;
  log.adv = false;
  rt.cpu.call(SAMPLER, [OBJ], 200000);
  const adv = sampleTick(port, table, 1, { advanceFrozen: () => { log.adv = true; } });
  assert.equal(adv, true, "the port reports the advance");
  assert.equal(log.adv, true, "the original called F0x80083a54");
});

// ── 6. negative control ─────────────────────────────────────────────────────

test("negative control: a wrong marker reading must diverge from the original", SKIP, () => {
  // A table whose marker loops onto the marker index itself makes the playhead
  // DWELL on a 0x8000 entry, which is exactly where the faithful reading (frame =
  // loop_target) and the old browser reading (ignore sentinel frames) part ways.
  const entries = ENTRIES([[9, 0], [LOOP_MARKER, 1]]);
  const log: Log = { ann: false, adv: false };
  const rt = runtime(log);
  seed(rt, entries, 1, 1);
  const buggy = newSamplerState(1);
  const table = frameTableFromEntries(entries);
  let diverged = false;
  for (let i = 0; i < 6; i++) {
    rt.cpu.call(SAMPLER, [OBJ], 200000);
    const orig = readState(rt);
    // hand-rolled "browser" step: frame only for non-sentinel values
    const v = table.values[buggy.playhead]! & 0xffff;
    if (v !== LOOP_MARKER && v !== END_MARKER) buggy.frame = v;
    buggy.playhead += 1;
    if (buggy.playhead >= table.length) buggy.playhead = table.length - 1;
    const nv = table.values[buggy.playhead]! & 0xffff;
    if (nv === LOOP_MARKER) buggy.playhead = table.loopTargets[buggy.playhead]!;
    if (orig.frame !== buggy.frame) diverged = true;
  }
  assert.equal(diverged, true, "the wrong reading must diverge somewhere");
});
