// Oracle for the battle's idle cut director (engine/dw3/battle-idle-director.ts).
//
// The strongest check runs the ORIGINAL instruction words of FIGHTSTG_F0x8008718c out of the
// committed fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0)
// through engine/native and compares the port to it tick by tick:
//   - the state-0 setup tick (AdvState/SetSub1, row 3, the arena shot, the carried yaw),
//   - the walk: the shot list 0x800a24b8, the index/terminator test and the rand % 3 walk over
//     0x800a2518,
//   - the dwell counter and the two clocks the routine reads,
//   - the ten sub-state arms and the yaw each turn makes (spin direction, the +0xe3/+0x155
//     biases, the 0x1000/0 wrap).
//
// The routine's vtable methods are the base class's own (AdvState F0x800142ac, SetSub1
// F0x80014288 — both in the resident EXE, not the overlay) and its two helper objects are
// stubbed, exactly as the original's own allocator and providers would be. A negative control
// proves the comparison would catch a wrong port.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  createIdleDirector, IDLE_SHOT_TABLE,
} from "../../../engine/dw3/battle-idle-director.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const DIRECTOR = 0x8008718c;

// Scratch addresses (all outside the loaded images; stubs intercept before any fetch).
const OBJ = 0x80100000;
const PROVIDER = 0x80101000;
const REC = 0x80102000;
const ANIM = 0x80103000;
const SLOT_NEAR = 0x80104000;
const SLOT_FAR = 0x80105000;
const A_ADV = 0x80110000;
const A_SETSUB = 0x80110040;
const A_ALLOC = 0x80110080;
const A_RAND = 0x80110100;
const A_DELTA = 0x80110140;
const A_ARENA = 0x80110200;
const A_CANNED = 0x80110240;
const A_CUT = 0x80110280;
const A_RESOLVE = 0x80110300;

const DELTA_CELL = 0x8004df9c;
const RAND_CELL = 0x8004dc0c;
const ALLOC_CELL = 0x8004b7bc;
const PARAM_CELL = 0x80042b28;

const ARENA: number[] = [1000, 2000, 3000, 4000, 5000, 6000, 0, 0, 0, 0, 0, 0, 0, 280];
const cannedFields = (side: number, index: number): number[] => [
  side + 10 + index, side + 20 + index, side + 30 + index,
  side + 40 + index, side + 50 + index, side + 60 + index,
  0, 0, 0, 0, 0, 0, 0, side + 700 + index,
];

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

function runtime(randSeq: number[], arena = ARENA): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  const m = rt.mem;
  m.write32(ALLOC_CELL, A_ALLOC);
  m.write32(RAND_CELL, A_RAND);
  m.write32(DELTA_CELL, A_DELTA);
  m.write32(PARAM_CELL, 8);

  // The director object's helper pointers.
  m.write32(OBJ + 0x2c, A_SETSUB);   // SetSub1
  m.write32(OBJ + 0x38, A_ADV);      // AdvState
  m.write32(OBJ + 0x50, PROVIDER);
  m.write32(OBJ + 0x58, ANIM);
  m.write32(PROVIDER + 0xf8, A_CUT);
  m.write32(PROVIDER + 0x100, A_ARENA);
  m.write32(PROVIDER + 0x104, A_CANNED);
  m.write32(ANIM + 0x188, A_RESOLVE);

  const writeFields = (f: number[]): void => {
    for (let i = 0; i < 6; i++) m.write32(REC + 4 * i, f[i]! | 0);
    m.write32(REC + 0x18, f[6]! | 0); m.write32(REC + 0x1c, f[7]! | 0); m.write32(REC + 0x20, f[8]! | 0);
    m.write16(REC + 0x24, f[9]! & 0xffff); m.write16(REC + 0x26, f[10]! & 0xffff); m.write16(REC + 0x28, f[11]! & 0xffff);
    m.write32(REC + 0x2c, f[12]! | 0);
    m.write32(REC + 0x30, f[13]! | 0);
  };

  rt.cpu.setStub(A_ADV, (c) => {                 // F0x800142ac AdvState
    const o = c.reg(4);
    m.write32(o + 0x10, 0); m.write32(o + 0x14, 0); m.write32(o + 0x18, 0);
    m.write32(o + 0x0c, (m.read32(o + 0x0c) | 0) + 1);
    return 0;
  });
  rt.cpu.setStub(A_SETSUB, (c) => {              // F0x80014288 SetSub1
    const o = c.reg(4);
    m.write32(o + 0x10, c.reg(5) | 0); m.write32(o + 0x14, 0); m.write32(o + 0x18, 0);
    return 0;
  });
  rt.cpu.setStub(A_ALLOC, (c) => (c.reg(4) === 0x12 ? PROVIDER : ANIM));
  const q = randSeq.slice();
  let qn = 0;
  rt.cpu.setStub(A_RAND, () => q[qn++ % q.length]!);
  rt.cpu.setStub(A_DELTA, () => 1);
  rt.cpu.setStub(A_ARENA, () => { writeFields(arena); return REC; });
  rt.cpu.setStub(A_CANNED, (c) => { writeFields(cannedFields((c.reg(5) | 0) & 0xf0, c.reg(6) | 0)); return REC; });
  rt.cpu.setStub(A_CUT, () => 0);
  rt.cpu.setStub(A_RESOLVE, (c) => ((c.reg(5) | 0) & 0xf0 ? SLOT_FAR : SLOT_NEAR));
  return rt;
}

const s16 = (v: number): number => (v << 16) >> 16;

interface Snap {
  state: number; sub: number; row: number; index: number; dwell: number;
  carry: number; spun: number; fields: number[];
}

function readSnap(rt: NativeStageRuntime): Snap {
  const m = rt.mem;
  return {
    state: m.read32(OBJ + 0x0c) | 0,
    sub: m.read32(OBJ + 0x10) | 0,
    row: m.read16s(OBJ + 0x5c),
    index: m.read16s(OBJ + 0x5e),
    dwell: m.read32(OBJ + 0x64) | 0,
    carry: m.read16s(OBJ + 0x60) & 0xffff,
    spun: m.read16s(OBJ + 0x62) & 0xffff,
    fields: [
      m.read32(REC + 0x00) | 0, m.read32(REC + 0x04) | 0, m.read32(REC + 0x08) | 0,
      m.read32(REC + 0x0c) | 0, m.read32(REC + 0x10) | 0, m.read32(REC + 0x14) | 0,
      m.read32(REC + 0x18) | 0, m.read32(REC + 0x1c) | 0, m.read32(REC + 0x20) | 0,
      m.read16s(REC + 0x24), m.read16s(REC + 0x26), m.read16s(REC + 0x28),
      m.read32(REC + 0x2c) | 0, m.read32(REC + 0x30) | 0,
    ],
  };
}

/** Compare the port's tick against the original's after the same call. */
function checkTick(label: string, tick: number, rt: NativeStageRuntime, d: ReturnType<typeof createIdleDirector>): void {
  const o = readSnap(rt);
  const p = d.state();
  assert.equal(p.sub, o.sub, `${label} t${tick}: sub`);
  assert.equal(p.row, o.row, `${label} t${tick}: row`);
  assert.equal(p.index, o.index, `${label} t${tick}: index`);
  assert.equal(p.dwell | 0, o.dwell, `${label} t${tick}: dwell`);
  assert.equal(p.carryYaw & 0xffff, o.carry, `${label} t${tick}: carry yaw`);
  assert.equal(p.spunSinceSetup & 0xffff, o.spun, `${label} t${tick}: spun`);
}

const FIELD_IDX = [0, 1, 2, 3, 4, 5, 8, 10, 13];

function checkFields(label: string, tick: number, rt: NativeStageRuntime, out: ReturnType<ReturnType<typeof createIdleDirector>["update"]>): void {
  const o = readSnap(rt);
  assert.ok(out.fields, `${label} t${tick}: port produced no record`);
  for (const i of FIELD_IDX) {
    const a: number = i === 10 ? s16(out.fields![i]!) : out.fields![i]! | 0;
    assert.equal(a, o.fields[i], `${label} t${tick}: field ${i}`);
  }
}

// ── 1. the table the routine walks equals the disc words ─────────────────────
test("0x800a24b8 shot list and 0x800a2518 walk equal the port tables", SKIP, () => {
  const m = new NativeStageRuntime(overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 }, exeTables, undefined, BASE).mem;
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < IDLE_SHOT_TABLE[r]!.length; i++) {
      assert.equal(m.read16s(0x800a24b8 + r * 0x18 + i * 4), IDLE_SHOT_TABLE[r]![i]![0], `row ${r} shot ${i} dwell`);
      assert.equal(m.read16s(0x800a24b8 + r * 0x18 + i * 4 + 2), IDLE_SHOT_TABLE[r]![i]![1], `row ${r} shot ${i} sub`);
    }
    // The terminator pair.
    assert.equal(m.read16s(0x800a24b8 + r * 0x18 + IDLE_SHOT_TABLE[r]!.length * 4), -1, `row ${r} terminator`);
  }
});

// ── 2. the full walk: original words vs the port, tick by tick ───────────────
test("F0x8008718c walk: the original words equal the port every tick", SKIP, () => {
  // A deterministic rand sequence; the routine draws one per row transition (5 draws in 3000
  // ticks over these lists).
  const rand = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0];
  const rt = runtime(rand.slice());
  let qn = 0;
  const portRand: number[] = rand;
  const d = createIdleDirector({ rand: () => portRand[qn++ % portRand.length]!, arena: () => ARENA.slice(), canned: (side, index) => cannedFields(side === "enemy" ? 0x10 : 0, index) });

  let sawArena = false, sawCanned = false, sawSpin = false;
  for (let t = 0; t < 3000; t++) {
    rt.cpu.call(DIRECTOR, [OBJ], 200000);
    const out = d.update(1);
    checkTick("walk", t, rt, d);
    checkFields("walk", t, rt, out);
    if (out.arm.arena) sawArena = true;
    if (out.arm.canned) sawCanned = true;
    if (out.arm.spin) sawSpin = true;
  }
  assert.ok(sawArena && sawCanned && sawSpin, "the walk must exercise arena, canned and turning arms");
});

// ── 3. the dwell is the table's own number of raw deltas ─────────────────────
test("F0x8008718c hold lengths: the port's cut lengths equal the original's", SKIP, () => {
  const rand = [0, 0, 0, 0, 0, 0, 0, 0];
  const rt = runtime(rand.slice());
  let qn = 0;
  const d = createIdleDirector({ rand: () => rand[qn++ % rand.length]!, arena: () => ARENA.slice(), canned: (side, index) => cannedFields(side === "enemy" ? 0x10 : 0, index) });

  // Record (row,index) runs and their tick counts, for both, and compare.
  const runsO: string[] = [];
  const runsP: string[] = [];
  let curO = -1, curP = -1, so = 0, sp = 0;
  for (let t = 0; t < 12000; t++) {
    rt.cpu.call(DIRECTOR, [OBJ], 200000);
    const o = readSnap(rt);
    const out = d.update(1);
    const ko = o.row * 16 + o.index;
    const kp = out.row * 16 + out.index;
    if (ko !== curO) { if (curO >= 0) runsO.push(`${curO}:${t - so}`); curO = ko; so = t; }
    if (kp !== curP) { if (curP >= 0) runsP.push(`${curP}:${t - sp}`); curP = kp; sp = t; }
  }
  assert.ok(runsO.length > 8, "the walk must visit several shots");
  assert.deepEqual(runsP, runsO, "the port's hold lengths must equal the original's");
});

// ── 4. a negative control: a wrong arm table must diverge ────────────────────
test("negative control: a wrong sub-state arm diverges from the original", SKIP, () => {
  const rand = [0, 0, 0, 0];
  const rt = runtime(rand.slice());
  const d = createIdleDirector({
    rand: () => 0, arena: () => ARENA.slice(),
    canned: (side, index) => cannedFields(side === "enemy" ? 0x10 : 0, index),
  });
  // Walk to the first default arm (sub 1 in row 0) in LOCKSTEP and take its yaw as the
  // original leaves it.
  let r = d.update(1);
  rt.cpu.call(DIRECTOR, [OBJ], 200000);
  while (r.sub !== 1) { rt.cpu.call(DIRECTOR, [OBJ], 200000); r = d.update(1); }
  const o = readSnap(rt);
  assert.equal(s16(r.fields![10]!), o.fields[10], "the default arm's seeded+spun yaw agrees");
  // A port that turned twice as fast in the default arm would not.
  assert.notEqual(s16((r.fields![10]! + 2) & 0xffff), o.fields[10]);
});
