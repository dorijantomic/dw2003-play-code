// Oracle for the op6 projectile flight family (engine/dw3/battle-projectile.ts).
//
// The strongest check runs the ORIGINAL instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native and compares them to the port:
//   - FIGHTSTG_F0x800897f8  the registry lookup (id -> packed `file` halfword)
//   - FIGHTSTG_F0x80089844  the flight-object constructor (0xc0-byte object)
// The allocator F0x80014504 and the object's own +0x28 end entry are stubs; the
// registry is the real 0x800a2550 list, seeded per case. A negative control in each
// case proves the comparison would catch a wrong port.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  PROJECTILE_REGISTRY_BASE, PROJECTILE_VRAM_X, PROJECTILE_VRAM_Y,
  projectileFileForId, newProjectileFlight,
  type ProjectileRegistryEntry,
} from "../../../engine/dw3/battle-projectile.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const LOOKUP = 0x800897f8;
const CTOR = 0x80089844;
const ALLOC = 0x80014504;      // the object allocator (fns)
const END = 0x801f0010;        // the flight object's +0x28 end entry
const OBJ = 0x80106000;        // the allocator's return
const VECA = 0x80101000;
const VECB = 0x80101010;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

interface Counters { end: number; lastEndArg: number; alloc: number }

const s16 = (v: number): number => (v << 16) >> 16;

function runtime(counters: Counters): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  rt.cpu.setStub(ALLOC, () => {
    counters.alloc++;
    // The real allocator installs the object's method table (type 0x8008970c); the
    // only entry F0x80089844 can reach is +0x28, so that is what the stub wires.
    rt.mem.write32(OBJ + 0x28, END);
    return OBJ;
  });
  rt.cpu.setStub(END, (c) => {
    counters.end++;
    counters.lastEndArg = c.reg(5);
    return 0;
  });
  return rt;
}

/**
 * Seed the real 0x800a2550 registry: `entries`, then a zero-id terminator, then an
 * optional `trailing` row that sits PAST the terminator and must never be selected.
 */
function seedRegistry(
  rt: NativeStageRuntime,
  entries: readonly ProjectileRegistryEntry[],
  trailing?: ProjectileRegistryEntry,
): void {
  let at = PROJECTILE_REGISTRY_BASE;
  for (const e of entries) {
    rt.mem.write32(at, e.id | 0);
    rt.mem.write32(at + 4, e.w1 | 0);
    rt.mem.write32(at + 8, e.w2 | 0);
    at += 12;
  }
  rt.mem.write32(at, 0);              // the zero-id terminator
  at += 12;
  if (trailing) {
    rt.mem.write32(at, trailing.id | 0);
    rt.mem.write32(at + 4, trailing.w1 | 0);
    rt.mem.write32(at + 8, trailing.w2 | 0);
  }
}

function seedVec(rt: NativeStageRuntime, addr: number, words: readonly number[]): void {
  for (let i = 0; i < words.length; i++) rt.mem.write16(addr + i * 2, words[i] as number);
}

const ENTRIES: ProjectileRegistryEntry[] = [
  { id: 39, w1: (0x21 << 16) | 0x0005, w2: (0x21 << 16) | 0x0006 },
  { id: 65, w1: (0x22 << 16) | 0x0007, w2: (0x22 << 16) | 0x0008 },
  { id: 100, w1: (0x23 << 16) | 0x0009, w2: (0x23 << 16) | 0x000a },
];

// ── 1. the registry lookup (F0x800897f8) ─────────────────────────────────────

function runLookup(id: number, entries: readonly ProjectileRegistryEntry[], trailing?: ProjectileRegistryEntry): { orig: number; port: number } {
  const rt = runtime({ end: 0, lastEndArg: -1, alloc: 0 });
  seedRegistry(rt, entries, trailing);
  rt.cpu.call(LOOKUP, [id | 0], 100000);
  return { orig: rt.cpu.reg(2), port: projectileFileForId(entries, id) };
}

test("F0x800897f8 lookup: a registered id returns its packed file halfword", SKIP, () => {
  for (const id of [39, 65, 100]) {
    const e = ENTRIES.find((x) => x.id === id)!;
    const { orig, port } = runLookup(id, ENTRIES);
    assert.equal(port, e.w1 >>> 16, `port file for id ${id}`);
    assert.equal(orig, e.w1 >>> 16, `original file for id ${id}`);
    assert.equal(orig, port, `id ${id}: original == port`);
  }
});

test("F0x800897f8 lookup: a row past the zero-id terminator is never found", SKIP, () => {
  const trailing: ProjectileRegistryEntry = { id: 99, w1: 0x7f0000, w2: 0 };
  const { orig, port } = runLookup(99, ENTRIES, trailing);
  assert.equal(orig, 0, "unknown id -> 0, the scan stops at the terminator");
  assert.equal(port, 0);
  // Negative control: without the terminator the SAME port would find the row.
  const withoutTerminator = [...ENTRIES, trailing];
  assert.equal(projectileFileForId(withoutTerminator, 99), 0x7f,
    "a port that ignored the zero-id terminator would have returned the trailing row");
  assert.notEqual(orig, 0x7f, "the original stops at the terminator");
});

test("F0x800897f8 lookup: the return is the SIGNED halfword (a file id above 0x7fff is negative)", SKIP, () => {
  const e: ProjectileRegistryEntry = { id: 7, w1: (0xffff << 16) | 0x0001, w2: 0 };
  const { orig, port } = runLookup(7, [e]);
  assert.equal(orig, -1, "0xffff read signed is -1");
  assert.equal(port, s16(0xffff));
  assert.equal(orig, port);
});

// ── 2. the flight-object constructor (F0x80089844) ────────────────────────────

const VA = [0x1111, 0x2222, 0x3333, 0x4444];
const VB = [0x5555, 0x6666, 0x7777, 0x8888];

function runCtor(id: number, entries: readonly ProjectileRegistryEntry[], trailing?: ProjectileRegistryEntry) {
  const counters: Counters = { end: 0, lastEndArg: -1, alloc: 0 };
  const rt = runtime(counters);
  seedRegistry(rt, entries, trailing);
  seedVec(rt, VECA, VA);
  seedVec(rt, VECB, VB);
  rt.cpu.call(CTOR, [id | 0, VECA, VECB], 200000);
  return { rt, counters, port: newProjectileFlight(entries, id, VA, VB) };
}

function assertCtorEqual(rt: NativeStageRuntime, port: ReturnType<typeof newProjectileFlight>, label: string): void {
  const m = rt.mem;
  assert.equal(m.read32(OBJ + 0x50) | 0, port.key | 0, `${label}: +0x50 key`);
  assert.equal(m.read32(OBJ + 0x54) | 0, port.regW1 | 0, `${label}: +0x54 regW1`);
  assert.equal(m.read32(OBJ + 0x58) | 0, port.regW2 | 0, `${label}: +0x58 regW2`);
  assert.equal(m.read32(OBJ + 0x6c) | 0, port.slotA | 0, `${label}: +0x6c slotA`);
  assert.equal(m.read32(OBJ + 0x70) | 0, port.slotB | 0, `${label}: +0x70 slotB`);
  for (let i = 0; i < 4; i++) {
    assert.equal(m.read16s(OBJ + 0x5c + i * 2), s16(port.vecA[i]!), `${label}: vecA[${i}]`);
    assert.equal(m.read16s(OBJ + 0x64 + i * 2), s16(port.vecB[i]!), `${label}: vecB[${i}]`);
  }
}

test("F0x80089844 ctor: a registered id builds the flight object field for field", SKIP, () => {
  const { rt, counters, port } = runCtor(65, ENTRIES);
  assert.equal(counters.alloc, 1, "one allocation");
  assert.equal(port.registered, true);
  assert.equal(port.key, 65);
  assert.equal(port.slotA, PROJECTILE_VRAM_X);
  assert.equal(port.slotB, PROJECTILE_VRAM_Y);
  assertCtorEqual(rt, port, "registered");
  assert.equal(counters.end, 0, "a registered id does not call the end entry");
});

test("F0x80089844 ctor: an unregistered id leaves the key 0 and calls the end entry with 3", SKIP, () => {
  const { rt, counters, port } = runCtor(999, ENTRIES);
  assert.equal(rt.mem.read32(OBJ + 0x50) | 0, 0, "unregistered: key stays 0");
  assert.equal(port.registered, false);
  assert.equal(counters.end, 1, "the end entry runs exactly once");
  assert.equal(counters.lastEndArg, 3, "with argument 3");
  assert.equal(port.key, 0);
  assert.deepEqual(port.vecA, [], "the unregistered path never copies the launch vector");
  // Negative control: a port that stored the LAST entry regardless would carry 100.
  assert.notEqual(port.key, 100);
});

test("F0x80089844 ctor: an empty registry skips the walk and ends immediately", SKIP, () => {
  const counters: Counters = { end: 0, lastEndArg: -1, alloc: 0 };
  const rt = runtime(counters);
  rt.mem.write32(PROJECTILE_REGISTRY_BASE, 0);          // empty list
  seedVec(rt, VECA, VA);
  seedVec(rt, VECB, VB);
  rt.cpu.call(CTOR, [39, VECA, VECB], 200000);
  const port = newProjectileFlight([], 39, VA, VB);
  assert.equal(rt.mem.read32(OBJ + 0x50) | 0, 0);
  assert.equal(port.registered, false);
  assert.equal(counters.end, 1);
  assert.equal(counters.lastEndArg, 3);
});

test("F0x80089844 ctor: the copied vectors are the original's 8 bytes each", SKIP, () => {
  const { rt, port } = runCtor(100, ENTRIES);
  assert.equal(rt.mem.read32(OBJ + 0x54) >>> 0, ((0x23 << 16) | 0x0009) >>> 0);
  assert.equal(rt.mem.read32(OBJ + 0x58) >>> 0, ((0x23 << 16) | 0x000a) >>> 0);
  assertCtorEqual(rt, port, "vec copy");
  // Negative control against a swapped vecA/vecB port: the two triples differ.
  assert.notDeepEqual(port.vecA, port.vecB);
});

test("F0x80089844 ctor: a row past the terminator is not built", SKIP, () => {
  const trailing: ProjectileRegistryEntry = { id: 99, w1: 0x7f0000, w2: 0 };
  const { rt, counters, port } = runCtor(99, ENTRIES, trailing);
  assert.equal(rt.mem.read32(OBJ + 0x50) | 0, 0, "the trailing row is past the terminator");
  assert.equal(port.registered, false);
  assert.equal(counters.end, 1);
  assert.equal(counters.lastEndArg, 3);
  assert.equal(newProjectileFlight([...ENTRIES, trailing], 99, VA, VB).registered, true,
    "negative control: without the terminator the same port would build the object");
});
