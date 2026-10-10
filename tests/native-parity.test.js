// RAM-diff parity oracle for the wstag native interpreter (P0 acceptance test,
// docs/specs/2026-07-04-wstag-native-interpreter-design.md §Verification).
//
// Boots interpreter memory from consecutive per-vsync PCSX-Redux RAM dumps of
// s780 (the Kusanagi street corner, savestate slot 1), ticks each live car
// object's real native callback (wstag780 cb 0x800a5ec0) exactly once, and
// byte-compares the resulting object structs + the ambient point table against
// the next real frame. Everything runs natively from the dump — EXE helpers
// included — so a pass means the R3000 core reproduces the console bit-for-bit
// on real game code.
//
// The dumps are machine-local (~66MB, not committed); the test skips when absent.
// Recapture recipe: docs/research/infra/rig-reference.md + scratchpad cap.lua
// (arm a GPU::Vsync listener that ffi.string-dumps 2MB per frame).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NativeMemory } from "../engine/native/memory.ts";
import { R3000 } from "../engine/native/mips.ts";
import { installDrawStubs } from "../engine/native/stubs.ts";

const DUMP_DIR = process.env.NATIVE_PARITY_DUMPS ?? join(homedir(), "vm-spike/dumps/par");

const CAR_CB = 0x800a5ec0;
const DESTROY = 0x80014308;
const FRAME_DELTA_GLOBAL = 0x8004de28;
const POINT_TABLE = 0x800a9188; // s780: 6 records × 18 bytes
const POINT_TABLE_LEN = 6 * 18;
const OBJ_SIZE = 0x70;
const GP = 0x8005cb50; // live register value from the rig (constant for the EXE)

const available = existsSync(join(DUMP_DIR, "f00.bin"));

function rd32(d, addr) {
  const off = addr & 0x1fffff;
  return (d[off] | (d[off + 1] << 8) | (d[off + 2] << 16) | (d[off + 3] << 24)) >>> 0;
}

/** Find live car objects: cb 0x800a5ec0 at obj+0x48 with destroy at +0x4c. */
function findCars(d) {
  const objs = [];
  for (let off = 0; off < d.length - 4; off += 4) {
    if (rd32(d, off) === CAR_CB && rd32(d, off + 4) === DESTROY) objs.push((0x80000000 + off - 0x48) >>> 0);
  }
  return objs;
}

test("interpreter reproduces real car-object ticks byte-for-byte across the dump series", { skip: !available && "parity dumps not present on this machine" }, () => {
  const frames = readdirSync(DUMP_DIR).filter((f) => /^f\d+\.bin$/.test(f)).sort();
  assert.ok(frames.length >= 2, "need at least two frames");
  const dumps = frames.map((f) => new Uint8Array(readFileSync(join(DUMP_DIR, f))));

  let comparedPairs = 0;
  let comparedObjects = 0;
  let externalRespawns = 0;

  for (let i = 0; i + 1 < dumps.length; i++) {
    const cur = dumps[i];
    const next = dumps[i + 1];
    const cars = findCars(cur);
    assert.ok(cars.length > 0, `frame ${i}: no car objects found`);

    // interpreter memory = an exact copy of the current console frame
    const mem = NativeMemory.fromDump(cur.slice());
    const cpu = new R3000(mem);
    cpu.gp = GP;
    // draw boundary: prim builders use the GTE; everything else runs natively
    installDrawStubs(cpu);
    // the one per-frame input the game loop provides: the vsync delta the real
    // tick consumed (stored in the *next* dump; the loop updates it pre-tick)
    mem.write32(FRAME_DELTA_GLOBAL, rd32(next, FRAME_DELTA_GLOBAL));

    for (const obj of cars) {
      cpu.call(rd32(cur, obj + 0x48), [obj | 0, rd32(cur, obj + 0x24) | 0]);
    }

    for (const obj of cars) {
      const stateBefore = rd32(cur, obj + 0xc);
      const stateAfter = rd32(next, obj + 0xc);
      if (stateBefore >= 2 && stateAfter === 1) {
        // external spawner recycled this slot (path-table reposition) —
        // that write comes from another object, not the car cb; P2 scope.
        externalRespawns++;
        continue;
      }
      for (let b = 0; b < OBJ_SIZE; b++) {
        const got = mem.read8(obj + b);
        const want = next[(obj + b) & 0x1fffff];
        assert.equal(
          got,
          want,
          `frame ${i}→${i + 1} obj 0x${obj.toString(16)} +0x${b.toString(16)}: interpreter 0x${got.toString(16)} vs console 0x${want.toString(16)}`,
        );
      }
      comparedObjects++;
    }

    // the ambient point table must match too — catches spurious interpreter writes
    for (let b = 0; b < POINT_TABLE_LEN; b++) {
      assert.equal(
        mem.read8(POINT_TABLE + b),
        next[(POINT_TABLE + b) & 0x1fffff],
        `frame ${i}→${i + 1} point table +${b} diverged`,
      );
    }
    comparedPairs++;
  }

  assert.ok(comparedPairs >= 30, `expected a full series, compared ${comparedPairs}`);
  assert.ok(comparedObjects >= 55, `expected ~2 cars × ~32 pairs, compared ${comparedObjects}`);
  // eslint-disable-next-line no-console
  console.log(`parity: ${comparedPairs} frame pairs, ${comparedObjects} object ticks byte-equal, ${externalRespawns} external respawns skipped`);
});

// ── traffic-light object (cb 0x800a67a4) ──
// It does not exist during the broadcast (no console oracle in these dumps —
// it spawns in normal street state, unreachable by warp: s780 is handoff-only).
// Instead we run it end-to-end on real code only: the real constructor
// 0x800a6914 (which executes the game's own allocator + malloc natively from
// dump memory), then tick through state 0 (point-table discovery) and state 1
// (lamp animation), asserting the point-record writes against the sequence
// tables read independently from the same memory (the decoded semantics of
// helper 0x800a66b0 — s780-street-life doc §traffic-light).

const TRAFFIC_CTOR = 0x800a6914;
const TRAFFIC_CB = 0x800a67a4;
const SEQ_TABLE_PTRS = 0x800a8518; // [i] → sequence table for slot i (2 slots)

test("traffic-light object: real ctor + ticks drive the point records per the sequence tables", { skip: !available && "parity dumps not present on this machine" }, () => {
  const dump = new Uint8Array(readFileSync(join(DUMP_DIR, "f00.bin")));
  const mem = NativeMemory.fromDump(dump.slice());
  const cpu = new R3000(mem);
  cpu.gp = GP;
  installDrawStubs(cpu);

  const obj = cpu.call(TRAFFIC_CTOR, []) >>> 0;
  assert.ok(obj >= 0x80000000 && obj < 0x80200000, `ctor returned a heap object (got 0x${obj.toString(16)})`);
  assert.equal(mem.read32(obj + 0x48) >>> 0, TRAFFIC_CB, "tick cb installed by the real allocator");

  const tick = () => cpu.call(TRAFFIC_CB, [obj | 0, mem.read32(obj + 0x24)]);
  mem.write32(FRAME_DELTA_GLOBAL, 1);

  // state 0: discover the two lamp point-records (type bytes 1 and 2)
  assert.equal(mem.read32(obj + 0xc), 0);
  tick();
  assert.equal(mem.read32(obj + 0xc), 1, "advanced to steady state");
  const rec1 = mem.read32(obj + 0x50) >>> 0;
  const rec2 = mem.read32(obj + 0x58) >>> 0;
  assert.equal(mem.read8(rec1 + 1), 1, "slot 0 latched the type-1 record");
  assert.equal(mem.read8(rec2 + 1), 2, "slot 1 latched the type-2 record");
  assert.equal((rec1 - POINT_TABLE) % 18, 0, "record 1 lies on the 18-byte grid");
  assert.equal((rec2 - POINT_TABLE) % 18, 0, "record 2 lies on the 18-byte grid");

  // steady state: replay 600 frames, checking every write against a shadow
  // port of helper 0x800a66b0's exact decoded algorithm (independent oracle;
  // the CPU itself is already proven by the car byte-parity above)
  const slots = [rec1, rec2].map((rec, i) => {
    const table = mem.read32(SEQ_TABLE_PTRS + 4 * i) >>> 0;
    return {
      rec,
      table,
      idx: 0, // state 0 zeroed obj+0x54/+0x5c
      timer: mem.read16(table + 2), // state 0 latches entry-0's duration (lhu 2(tablePtr))
      sprite: -1,
    };
  });
  // one recursion level of the helper: advance at most one entry per level,
  // the OUTERMOST advanced entry decides the sprite written back
  const advance = (s) => {
    if (s.timer > 0) {
      s.sprite = mem.read16s(s.table + 4 * s.idx);
      return;
    }
    s.idx += 1;
    let entry = s.table + 4 * s.idx;
    s.timer += mem.read16(entry + 2);
    if (mem.read16s(entry) === 0xff) {
      s.idx = 0;
      entry = s.table;
      s.timer += mem.read16(entry + 2);
    }
    advance(s);
    s.sprite = mem.read16s(entry);
  };
  for (let frame = 0; frame < 600; frame++) {
    tick();
    for (const s of slots) {
      s.timer -= 1; // delta=1 (clamped ≤4 in the real code)
      advance(s);
      assert.equal(mem.read8(s.rec + 0), 1, `frame ${frame}: active byte`);
      assert.equal(mem.read8(s.rec + 9), 0, `frame ${frame}: ctr byte`);
      assert.equal(mem.read8(s.rec + 4), s.sprite & 0xff, `frame ${frame}: spriteId follows the sequence table`);
    }
  }
});
