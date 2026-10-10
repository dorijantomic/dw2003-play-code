// Oracle for the animation object's own method table (engine/dw3/battle-anim-object.ts).
//
// The ORIGINAL instruction words of the constructor-installed routines run out of the
// committed fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native. Their leaves the port replaces with a boundary
// are stubbed and recorded; the shared key scan F0x80087bf8 runs for real. The final
// memory in the anim object's write ranges and the boundary trace must equal the port's.
//
//   +0x180 FIGHTSTG_F0x80087c70  animRemoveSlot
//   helper FIGHTSTG_F0x80087c3c  animFreeSlotIndex
//   +0x184 FIGHTSTG_F0x80087d00  animBindSlot
//   +0x18c FIGHTSTG_F0x80087e7c  animRenameSlotKey
//   +0x190 FIGHTSTG_F0x80087ee4  animSlotModel
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  animRemoveSlot, animFreeSlotIndex, animBindSlot, animRenameSlotKey, animSlotModel,
  type AnimObjectMemory, type AnimObjectHost,
} from "../../../engine/dw3/battle-anim-object.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const ANIM = 0x80110000;
const CHILDREN = 0x80113000;
const CH0 = 0x80114000, CH2 = 0x80114200;
const MODEL = 0x80106000;
const INSTANCE = 0x80118000;
const SLOT0 = ANIM + 0x50, SLOT2 = ANIM + 0x50 + 2 * 0x4c;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

/** Slot table: slot 0 key 7, slot 1 empty, slot 2 key 0x10, slot 3 empty. */
function seedMemory(m: { write32(a: number, v: number): void }): void {
  m.write32(ANIM + 0x24, CHILDREN);
  m.write32(SLOT0 + 0x00, 1); m.write32(SLOT0 + 0x04, 7); m.write32(SLOT0 + 0x14, 0x1111);
  m.write32(SLOT0 + 0x4c + 0x00, 0);
  m.write32(SLOT2 + 0x00, 1); m.write32(SLOT2 + 0x04, 0x10); m.write32(SLOT2 + 0x14, 0x2222);
  m.write32(SLOT2 + 0x4c, 0);
  m.write32(CHILDREN + 0, CH0);
  m.write32(CHILDREN + 2 * 4, CH2);
  m.write32(MODEL + 0x00, 0xabc); m.write32(MODEL + 0x04, 0xdef);
  m.write32(0x800a2530, 0x11110000); m.write32(0x800a2530 + 4, 0x22220000);
  m.write32(0x800a2530 + 8, 0x33330000); m.write32(0x800a2530 + 12, 0x44440000);
}

const WRITE_BASES = [ANIM, CHILDREN, CH0, CH2, MODEL];
const WRITE_LEN = 0x240;
const inWrite = (a: number): boolean => WRITE_BASES.some((b) => a >= b && a < b + WRITE_LEN);

type Call = { site: string; args: number[] };
type Write = [number, number, number];

/** Run one ORIGINAL routine with its replaced leaves stubbed. */
function runOriginal(entry: number, args: number[]): { calls: Call[]; writes: Write[] } {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  const mem = rt.mem;
  const calls: Call[] = [];
  let n = 0;
  const record = (site: string, ret: number, fifth = false): number => {
    const slot = 0x80130000 + (n++) * 8;
    rt.cpu.setStub(slot, (cpu) => {
      const a = [cpu.reg(4), cpu.reg(5), cpu.reg(6), cpu.reg(7)];
      if (fifth) a.push(mem.read32((cpu.reg(29) + 0x10) >>> 0) | 0);
      calls.push({ site, args: a });
      return ret;
    });
    return slot;
  };
  seedMemory(mem);
  mem.write32(0x800a4570, record("resourceGet", MODEL));
  mem.write32(0x8004b600, record("clearSlot", 0));
  const childState = record("child+0x28", 0);
  mem.write32(CH0 + 0x28, childState);
  mem.write32(CH2 + 0x28, childState);
  // FIGHTSTG_F0x80084790 is a DIRECT jal target (a resident routine), not a cell.
  rt.cpu.setStub(0x80084790, (cpu) => {
    calls.push({ site: "allocInstance", args: [cpu.reg(4), cpu.reg(5), cpu.reg(6), cpu.reg(7), mem.read32((cpu.reg(29) + 0x10) >>> 0) | 0] });
    return INSTANCE;
  });
  const w: Write[] = [];
  mem.onWrite = (_pc, addr, size, value) => { if (inWrite(addr >>> 0)) w.push([addr >>> 0, size, value >>> 0]); };
  rt.cpu.call(entry, args, 400000);
  mem.onWrite = null;
  return { calls, writes: w };
}

class MemMap implements AnimObjectMemory {
  private readonly m = new Map<number, number>();
  read32(a: number): number { return this.m.get(a >>> 0) ?? 0; }
  read16u(a: number): number { return (this.m.get(a >>> 0) ?? 0) & 0xffff; }
  read16s(a: number): number { return ((this.m.get(a >>> 0) ?? 0) << 16) >> 16; }
  write32(a: number, v: number): void { this.m.set(a >>> 0, v | 0); }
  write16(a: number, v: number): void { this.m.set(a >>> 0, v & 0xffff); }
}

/** Run the PORT with the same seeds and recording boundaries. */
function runPort(which: string, args: number[]): { calls: Call[]; writes: Write[] } {
  const M = new MemMap();
  seedMemory({ write32: (a, v) => M.write32(a, v) });
  M.write32(0x800a2530, 0x11110000); M.write32(0x800a2530 + 4, 0x22220000);
  M.write32(0x800a2530 + 8, 0x33330000); M.write32(0x800a2530 + 12, 0x44440000);
  const calls: Call[] = [];
  const writes: Write[] = [];
  const host: AnimObjectHost = {
    resourceGet: (h) => { calls.push({ site: "resourceGet", args: [h] }); return MODEL; },
    allocAnimInstance: (w0, w1, t0, t1, slot) => { calls.push({ site: "allocInstance", args: [w0, w1, t0, t1, slot] }); return INSTANCE; },
    clearSlot: (p, bytes) => { calls.push({ site: "clearSlot", args: [p, bytes] }); },
    childSetState: (child, st) => { calls.push({ site: "child+0x28", args: [child, st] }); },
  };
  const proxy: AnimObjectMemory = {
    read32: (a) => M.read32(a), read16u: (a) => M.read16u(a), read16s: (a) => M.read16s(a),
    write32: (a, v) => { M.write32(a, v); if (inWrite(a)) writes.push([a >>> 0, 4, v >>> 0]); },
    write16: (a, v) => { M.write16(a, v); if (inWrite(a)) writes.push([a >>> 0, 2, v & 0xffff]); },
  };
  if (which === "remove") animRemoveSlot(proxy, host, ANIM, args[1] ?? 0);
  else if (which === "rename") animRenameSlotKey(proxy, host, ANIM, args[1] ?? 0, args[2] ?? 0);
  else if (which === "model") { const v = animSlotModel(proxy, ANIM, args[1] ?? 0); calls.push({ site: "return", args: [v] }); }
  else if (which === "free") { const v = animFreeSlotIndex(proxy, ANIM); calls.push({ site: "return", args: [v] }); }
  else animBindSlot(proxy, host, ANIM, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0);
  return { calls, writes };
}

const sites = (c: { site: string }[]): string[] => c.map((x) => x.site);

for (const which of ["remove", "rename", "bind"] as const) {
  const entry = which === "remove" ? 0x80087c70 : which === "rename" ? 0x80087e7c : 0x80087d00;
  const args = which === "remove" ? [ANIM, 7]
    : which === "rename" ? [ANIM, 7, 0x10]
      : [ANIM, 5, 0x1234, 1];
  test(`anim object ${which}: the original words equal the port`, SKIP, () => {
    const o = runOriginal(entry, args);
    const p = runPort(which, args);
    assert.deepEqual(sites(p.calls), sites(o.calls), `${which}: boundary call sites`);
    assert.deepEqual(p.writes, o.writes, `${which}: write trace`);
  });
}

function callOriginalV0(entry: number, args: number[]): number {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  seedMemory(rt.mem);
  return rt.cpu.call(entry, args, 400000) >>> 0;
}

test("anim object model + free index: the original words equal the port", SKIP, () => {
  for (const [key, want] of [[7, 0x1111], [0x10, 0x2222], [0x99, 0]] as const) {
    assert.equal(callOriginalV0(0x80087ee4, [ANIM, key]), want, `model key ${key}`);
    assert.equal(animSlotModel(portMem(), ANIM, key), want, `port model key ${key}`);
  }
  assert.equal(callOriginalV0(0x80087c3c, [ANIM]), 1, "the free slot index is 1");
  assert.equal(animFreeSlotIndex(portMem(), ANIM), 1);
});

function portMem(): AnimObjectMemory {
  const M = new MemMap();
  seedMemory({ write32: (a, v) => M.write32(a, v) });
  return M;
}

test("anim object oracle discriminates a WRONG port (mutation control)", SKIP, () => {
  // A mutation: the resolver must reject the empty slot 1, so a wrong port that matches
  // only occupancy would differ. Compare the real rename write trace to a mutated one.
  const o = runOriginal(0x80087e7c, [ANIM, 7, 0x10]);
  const mutated = o.writes.map(([a, s, v]) => (a === SLOT0 + 0x04 ? [a, s, v ^ 1] as Write : [a, s, v] as Write));
  assert.notDeepEqual(mutated, o.writes, "the comparison must catch a mutated slot-key write");
  assert.deepEqual(runPort("rename", [ANIM, 7, 0x10]).writes, o.writes);
});
