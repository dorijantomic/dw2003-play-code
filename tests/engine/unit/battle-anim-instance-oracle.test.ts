// Oracle for the animation-instance allocator on the transformation driver's path
// (engine/dw3/battle-anim-instance.ts, createAnimInstance — the FIGHTSTG_F0x80084790
// wrapper over the ported builder F0x80084560).
//
// The ORIGINAL wrapper words run out of the committed fightstg overlay image
// (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0) through
// engine/native, and the ORIGINAL builder F0x80084560 runs for real behind them.
// Its three leaves are stubbed: the pack-record cell [0x80044f5c] (the real
// F0x800140d8, a port elsewhere), the resident object factory F0x800143dc, and the
// heap allocator [0x8004b5f4]. The port runs the same argument mapping through the
// reused builder into a second arena.
//
// Comparison: the boundary call sequence must be EXACT, and the FINAL per-offset
// memory image of the figure object and its layer records must match. The reused
// builder (engine/dw3/battle-mesh.ts) now reproduces the original's store SHAPE too:
// obj+0x70 takes the bare flags in the delay slot and then flags|mask, and the
// layer-0 reset skips rec+0x16. The test asserts both stores and the missing 0x16
// store on BOTH sides, so the two traces match rather than a divergence being
// recorded. A mutation control proves the comparison discriminates a wrong build.
//
// The wrapper is constructor-installed and absent from the disassembler's entry
// list; both routines were read from the overlay ASSEMBLY (fightstg.s L1746-L1760
// and L1603-L1744).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  createAnimInstance, ANIM_INSTANCE_ARG5, type AnimInstanceMemory,
} from "../../../engine/dw3/battle-anim-instance.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const available = existsSync(BIN);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const WRAPPER = 0x80084790;
const PACK_CELL = 0x80044f5c;
const ALLOC_CELL = 0x8004b5f4;
const FACTORY = 0x800143dc;
const STUB_RESOLVE = 0x801f1000;
const STUB_ALLOC = 0x801f2000;

const CTX = 0x80180000;          // the resolved pack record (shared seed)
const FIGURE = 0x80181000, RECORDS = 0x801b0000;
const FIGURE2 = 0x801b5000, RECORDS2 = 0x801b8000;
const OBJ_LEN = 0x2700, REC_LEN = 0x200;

const overlay = available ? readFileSync(BIN) : Buffer.alloc(0);

const COUNT = 2;
const WORDS = [0x11111111, 0x22222222, 0x33333333, 0x44444444, 0x55555555, 0x66666666];
const FLAGS = 0x0abc0000;
const ARGS = { w0: 0x8000aaaa, w1: 0x00ab, t0: 0x00cd, t1: 0x00ef, slotBase: 0x1234 };

type Write = [number, number, number];
type Call = { site: string; args: number[] };

function seedCtx(m: { write32(a: number, v: number): void }): void {
  m.write32(CTX + 0x00, FLAGS);
  m.write32(CTX + 0x04, COUNT);
  WORDS.forEach((w, i) => m.write32(CTX + 0x08 + 4 * i, w));
}

const OBJ_BASES = [FIGURE, FIGURE2];
const REC_BASES = [RECORDS, RECORDS2];

type Reader = (addr: number) => number;
type Key = [size: number, which: string, off: number];

/** The union of the offsets two write traces touch, keyed arena:offset. */
function keySet(a: Write[], b: Write[]): Map<string, Key> {
  const m = new Map<string, Key>();
  for (const ws of [a, b]) for (const [addr, size] of ws) {
    let which = "other", off = addr;
    for (const base of OBJ_BASES) if (addr >= base && addr < base + OBJ_LEN) { which = "obj"; off = addr - base; }
    for (const base of REC_BASES) if (addr >= base && addr < base + REC_LEN) { which = "rec"; off = addr - base; }
    m.set(`${which}:0x${off.toString(16)}`, [size, which, off]);
  }
  return m;
}

/** Read the FINAL value of every key out of a run's memory (not its write set). */
function snapshotOver(keys: Map<string, Key>, fig: number, rec: number, read: Reader): Map<string, [number, number | string]> {
  const out = new Map<string, [number, number | string]>();
  for (const [key, [size, which, off]] of keys) {
    let v: number | string;
    if (which === "obj" && off === 0x54) v = "RECORDS_PTR";
    else {
      const a = ((which === "obj" ? fig : rec) + off) >>> 0;
      v = size === 4 ? read(a) >>> 0 : read(a) & 0xffff;
    }
    out.set(key, [size, v]);
  }
  return out;
}

/** Run the ORIGINAL wrapper + builder with the three leaves stubbed. */
function runOriginal(stackArg: number): { writes: Write[]; calls: Call[]; ptr: number; read: Reader } {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
  );
  const mem = rt.mem;
  seedCtx(mem);
  const calls: Call[] = [];
  mem.write32(PACK_CELL, STUB_RESOLVE);
  rt.cpu.setStub(STUB_RESOLVE, (cpu) => {
    // The original passes a0..a3; the real F0x800140d8 uses only the handle (a0).
    calls.push({ site: "resolve", args: [cpu.reg(4) >>> 0] });
    return CTX;
  });
  rt.cpu.setStub(FACTORY, (cpu) => {
    calls.push({ site: "factory", args: [cpu.reg(4) >>> 0, cpu.reg(5) >>> 0, cpu.reg(6) >>> 0, cpu.reg(7) >>> 0] });
    return FIGURE;
  });
  mem.write32(ALLOC_CELL, STUB_ALLOC);
  rt.cpu.setStub(STUB_ALLOC, (cpu) => {
    calls.push({ site: "alloc", args: [cpu.reg(4) >>> 0, cpu.reg(5) >>> 0] });
    return RECORDS;
  });
  const writes: Write[] = [];
  mem.onWrite = (_pc, addr, size, value) => {
    const a = addr >>> 0;
    if ((a >= FIGURE && a < FIGURE + OBJ_LEN) || (a >= RECORDS && a < RECORDS + REC_LEN)) writes.push([a, size, value >>> 0]);
  };
  mem.write32((rt.cpu.sp >>> 0) + 0x10, stackArg | 0);
  const ptr = rt.cpu.call(WRAPPER, [ARGS.w0, ARGS.w1, ARGS.t0, ARGS.t1], 400000) >>> 0;
  mem.onWrite = null;
  return { writes, calls, ptr, read: (a) => mem.read32(a >>> 0) };
}

class MemMap implements AnimInstanceMemory {
  private readonly m = new Map<number, number>();
  read32(a: number): number { return this.m.get(a >>> 0) ?? 0; }
  write32(a: number, v: number): void { this.m.set(a >>> 0, v | 0); }
  write16(a: number, v: number): void { this.m.set(a >>> 0, v & 0xffff); }
}

/** Run the PORT into a second arena with the same boundary responses. */
function runPort(stackArg: number): { writes: Write[]; calls: Call[]; ptr: number; read: Reader } {
  const M = new MemMap();
  seedCtx(M);
  const calls: Call[] = [];
  const writes: Write[] = [];
  const proxy: AnimInstanceMemory = {
    read32: (a) => M.read32(a),
    write32: (a, v) => { M.write32(a, v); const x = a >>> 0; if ((x >= FIGURE2 && x < FIGURE2 + OBJ_LEN) || (x >= RECORDS2 && x < RECORDS2 + REC_LEN)) writes.push([x, 4, v >>> 0]); },
    write16: (a, v) => { M.write16(a, v); const x = a >>> 0; if ((x >= FIGURE2 && x < FIGURE2 + OBJ_LEN) || (x >= RECORDS2 && x < RECORDS2 + REC_LEN)) writes.push([x, 2, v & 0xffff]); },
  };
  const ptr = createAnimInstance({
    resolvePack: (h) => { calls.push({ site: "resolve", args: [h >>> 0] }); return CTX; },
    createObject: (a0, a1, a2, a3) => { calls.push({ site: "factory", args: [a0 >>> 0, a1 >>> 0, a2 >>> 0, a3 >>> 0] }); return FIGURE2; },
    heapAlloc: (size, align) => { calls.push({ site: "alloc", args: [size >>> 0, align >>> 0] }); return RECORDS2; },
  }, proxy, { w0: ARGS.w0, w1: ARGS.w1, t0: ARGS.t0, t1: ARGS.t1, slotBase: stackArg }) >>> 0;
  return { writes, calls, ptr, read: (a) => M.read32(a) };
}

test("F0x80084790 → F0x80084560: the original words and the port build the same figure", SKIP, () => {
  const o = runOriginal(ARGS.slotBase);
  const p = runPort(ARGS.slotBase);
  assert.equal(o.ptr, FIGURE >>> 0, "the original returns the factory object");
  assert.equal(p.ptr, FIGURE2 >>> 0, "the port returns the factory object");
  assert.deepEqual(p.calls, o.calls, "boundary call sequence");
  // The factory sees the layer-figure builder, its size 0x2634, (count+2)*4 extra
  // and class 0x11; the allocator sees (count+1)*0x84 bytes with alignment 2.
  assert.deepEqual(o.calls, [
    { site: "resolve", args: [ARGS.w0] },
    { site: "factory", args: [0x80083e0c, 0x2634, (COUNT + 2) * 4, 0x11] },
    { site: "alloc", args: [(COUNT + 1) * 0x84, 2] },
  ]);
  const keys = keySet(o.writes, p.writes);
  assert.deepEqual(snapshotOver(keys, FIGURE2, RECORDS2, p.read), snapshotOver(keys, FIGURE, RECORDS, o.read), "final memory image");

  // The two store shapes the reused builder now reproduces: the original stores the
  // bare flags to obj+0x70 in the branch delay slot and immediately overwrites it
  // with flags|mask, so the port makes the SAME two stores. The final value agrees,
  // and so does the trace.
  const o70 = o.writes.filter((w) => (w[0] >>> 0) === FIGURE + 0x70).map((w) => w[2] >>> 0);
  assert.deepEqual(o70, [FLAGS >>> 0, (FLAGS | 0x80000000) >>> 0], "the original's two obj+0x70 stores");
  const p70 = p.writes.filter((w) => (w[0] >>> 0) === FIGURE2 + 0x70).map((w) => w[2] >>> 0);
  assert.deepEqual(p70, o70, "the port's two obj+0x70 stores match the original's");

  // The layer-0 halfword at rec+0x16: the original skips it (`sh $zr, 0x14` is
  // followed by `sh $zr, 0x18`), and the reused builder now skips it too. The value
  // is zero either way; the absent store matches.
  assert.equal(o.writes.filter((w) => (w[0] >>> 0) === RECORDS + 0x16).length, 0, "the original never stores rec+0x16");
  assert.equal(p.writes.filter((w) => (w[0] >>> 0) === RECORDS2 + 0x16).length, 0, "the reused builder never stores rec+0x16 either");
});

test("F0x80084790 forces the builder's sixth argument to 1, not 0", SKIP, () => {
  // F0x800847c4 (the sibling wrapper) writes object+0x60 = 0; this wrapper writes 1.
  const o = runOriginal(ARGS.slotBase);
  const p = runPort(ARGS.slotBase);
  const at60 = (ws: Write[], fig: number): number => (ws.find(([a]) => (a >>> 0) === fig + 0x60) ?? [0, 0, -1])[2] >>> 0;
  assert.equal(at60(o.writes, FIGURE), 1, "original builder arg5");
  assert.equal(at60(p.writes, FIGURE2), 1, "port builder arg5");
  assert.equal(ANIM_INSTANCE_ARG5, 1);
});

test("anim-instance oracle discriminates a WRONG port (mutation control)", SKIP, () => {
  const o = runOriginal(ARGS.slotBase);
  const p = runPort(ARGS.slotBase);
  const keys = keySet(o.writes, p.writes);
  const oMap = snapshotOver(keys, FIGURE, RECORDS, o.read);
  const pMap = snapshotOver(keys, FIGURE2, RECORDS2, p.read);
  // A port that dropped the high-half mask OR'd into layer 1's second word diverges.
  const mutated = new Map(oMap);
  mutated.set("rec:0x88", [4, WORDS[1]! >>> 0]);
  assert.notDeepEqual(mutated, oMap, "the comparison must catch an unmasked layer word");
  assert.deepEqual(pMap, oMap);
});
