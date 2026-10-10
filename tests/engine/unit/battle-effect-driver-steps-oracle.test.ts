// Oracle for the transformation driver's FIFTEEN STEP BODIES and FOUR
// CONSTRUCT-STAGE BODIES (engine/dw3/battle-effect-driver.ts).
//
// The check runs the ORIGINAL instruction words out of the committed fightstg
// overlay image (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0)
// through engine/native, with every callee the driver reaches replaced by a host
// stub that records (site, $a0..$a3) and returns a scripted handle. The ported
// body runs against an EffectDriverHost that records the same (site, args) at the
// same points, over the same scripted memory. The two traces — and the two
// sequences of writes to the driver's objects — must be identical.
//
// This is the pattern of tests/engine/unit/battle-effect-driver-oracle.test.ts,
// extended from "which entry is entered" to "every call each body makes".
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  effectDriverProgramBody, effectDriverConstructStageBody,
  type EffectDriverHost, type EffectDriverStage,
  EFFECT_DRIVER_CELL_OBJ_GET, EFFECT_DRIVER_CELL_55C54, EFFECT_DRIVER_CELL_55C60,
  EFFECT_DRIVER_CELL_DF9C, EFFECT_DRIVER_CELL_55C48, EFFECT_DRIVER_CELL_4570,
  EFFECT_DRIVER_CELL_44F44, EFFECT_DRIVER_LAYER_REGISTRY, EFFECT_DRIVER_RESOURCE_SERVICE,
  EFFECT_DRIVER_SFX_SOURCE, EFFECT_DRIVER_SFX_SOURCE2, EFFECT_DRIVER_SFX_OFFSET_TABLE,
} from "../../../engine/dw3/battle-effect-driver.ts";

const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const BASE = 0x80082cb0;
const DRIVER = 0x80089cd8;
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const OBJ = 0x80100000, OUT = 0x80120000;
const M1 = 0x80110000, M2 = 0x80111000, M3 = 0x80112000;
const H1 = 0x80141000, R = 0x80140000, LA = 0x80130000, LB = 0x80131000, VA = 0x80150000;
const OUTOBJ = 0x80170000, SPAWN0 = 0x80160000;
// F0x8001ffa8 is handed sp+0x10 AFTER the driver's `addiu sp, -0x60`, so the
// context object lives at 0x801ffcf0 - 0x60 + 0x10.
const CTX = 0x801ffca0;

interface Scenario {
  flag: number; latch: number; m3c: number; obj5c: number;
  delta: number; out0: number; out10: number;
}
// S0: the "flag 0 / not latched" reading of every branch, timer below every gate.
// S1: the "flag set / latched / m3+0xc==2" reading, timer above every gate.
const S0: Scenario = { flag: 0, latch: 0, m3c: 0, obj5c: 0, delta: 0x10, out0: OUTOBJ, out10: 1 };
const S1: Scenario = { flag: 1, latch: 1, m3c: 2, obj5c: 1, delta: 0x200, out0: 0, out10: 0 };

type Seed = readonly [number, number, number]; // addr, value, size

function seeds(s: Scenario): Seed[] {
  return [
    [OBJ + 0x4, 0x11, 4], [OBJ + 0x8, s.flag, 4], [OBJ + 0x14, s.latch, 4],
    [OBJ + 0x18, 0, 4], [OBJ + 0x5c, s.obj5c, 4],
    [OBJ + 0x50, M1, 4], [OBJ + 0x54, M2, 4], [OBJ + 0x58, M3, 4],
    [M3 + 0xc, s.m3c, 4],
    [R + 0x2a, 0x1111, 2], [R + 0x2c, 0x0004, 2],
    [H1 + 0x2a, 0x2222, 2], [H1 + 0x2c, 0x0008, 2],
    [VA + 0x2, 0x1234, 2],
    [OUT + 0x0, s.out0, 4], [OUT + 0x10, s.out10, 4],
    [EFFECT_DRIVER_SFX_OFFSET_TABLE + 0x8, 0x100, 4],
    [EFFECT_DRIVER_SFX_OFFSET_TABLE + 0x14, 0x200, 4],
    [EFFECT_DRIVER_SFX_SOURCE, 0x11, 4], [EFFECT_DRIVER_SFX_SOURCE2, 0x22, 4],
  ];
}

interface Call { site: string; args: number[]; }
type Write = [number, number, number]; // addr, size, value

const msite = (h: number, o: number): string => `m:0x${(h >>> 0).toString(16)}+0x${(o >>> 0).toString(16)}`;
const csite = (a: number): string => `c:0x${(a >>> 0).toString(16)}`;
const dsite = (a: number): string => `d:0x${(a >>> 0).toString(16)}`;

interface Counters { layer: number; spawn: number; }

function methodRet(h: number, o: number, st: Counters): number {
  const b = h >>> 0;
  if (b === M1 && o === 0x188) return H1;
  if (b === M2 && o === 0x104) return R;
  if (b === EFFECT_DRIVER_LAYER_REGISTRY && o === 0x17c) return (st.layer++ & 1) === 0 ? LA : LB;
  return 0;
}
function cellRet(a: number, s: Scenario): number {
  const b = a >>> 0;
  if (b === EFFECT_DRIVER_CELL_DF9C) return s.delta;
  if (b === EFFECT_DRIVER_CELL_4570) return VA;
  return 0;
}
function objGetRet(id: number): number {
  const i = id >>> 0;
  if (i === 0x14) return M1;
  if (i === 0x12) return M2;
  if (i === 0x15) return M3;
  return 0;
}

// The method slots the driver can call through, per handle the bodies use.
const METHOD_SLOTS: ReadonlyArray<readonly [number, number]> = [
  [OBJ, 0x28], [OBJ, 0x38], [OBJ, 0x3c], [OBJ, 0x40],
  [M1, 0x184], [M1, 0x188], [M1, 0x18c], [M1, 0x194],
  [M2, 0x104], [M2, 0xf8], [M2, 0x100], [M2, 0xfc],
  [M3, 0xe8],
  [LA, 0x110], [LA, 0x114], [LB, 0x110], [LB, 0x114],
  [OUTOBJ, 0x28],
  [EFFECT_DRIVER_LAYER_REGISTRY, 0x17c],
  [EFFECT_DRIVER_RESOURCE_SERVICE, 0x404], [EFFECT_DRIVER_RESOURCE_SERVICE, 0x40c],
  [EFFECT_DRIVER_RESOURCE_SERVICE, 0x424],
  [0, 0x28],
];

const WRITE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [OBJ, 0x80], [M1, 0x200], [M2, 0x200], [M3, 0x200], [H1, 0x100], [R, 0x100],
  [LA, 0x200], [LB, 0x200], [OUT, 0x20], [OUTOBJ, 0x100], [SPAWN0, 0x200],
  [EFFECT_DRIVER_SFX_OFFSET_TABLE, 0x18], [VA, 0x10],
];
function inWriteRange(a: number): boolean {
  return WRITE_RANGES.some(([b, l]) => a >= b && a < b + l);
}

type Mode = { kind: "step"; substate: number } | { kind: "stage"; stage: EffectDriverStage };

// ── the original run ─────────────────────────────────────────────────────────

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

function runOriginal(mode: Mode, s: Scenario): { calls: Call[]; writes: Write[] } {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  const mem = rt.mem;
  for (const [addr, value, size] of seeds(s)) {
    if (size === 2) mem.write16(addr, value); else mem.write32(addr, value);
  }
  const calls: Call[] = [];
  const st: Counters = { layer: 0, spawn: 0 };
  let scratch = 0x80180000;
  const alloc = (): number => { const a = scratch; scratch += 8; return a; };
  const install = (site: string, ret: number | ((cpu: { reg(i: number): number }) => number)): number => {
    const a = alloc();
    rt.cpu.setStub(a, (cpu) => {
      calls.push({ site, args: [cpu.reg(4), cpu.reg(5), cpu.reg(6), cpu.reg(7)] });
      return ((typeof ret === "function" ? ret(cpu) : ret) | 0);
    });
    return a;
  };
  // register-indirect method slots
  for (const [h, o] of METHOD_SLOTS) {
    mem.write32(h + o, install(msite(h, o), () => methodRet(h, o, st)));
  }
  // global function-pointer cells
  mem.write32(EFFECT_DRIVER_CELL_OBJ_GET, install(csite(EFFECT_DRIVER_CELL_OBJ_GET), (cpu) => objGetRet(cpu.reg(4))));
  mem.write32(EFFECT_DRIVER_CELL_55C54, install(csite(EFFECT_DRIVER_CELL_55C54), 0));
  mem.write32(EFFECT_DRIVER_CELL_55C60, install(csite(EFFECT_DRIVER_CELL_55C60), 0));
  mem.write32(EFFECT_DRIVER_CELL_DF9C, install(csite(EFFECT_DRIVER_CELL_DF9C), () => cellRet(EFFECT_DRIVER_CELL_DF9C, s)));
  mem.write32(EFFECT_DRIVER_CELL_55C48, install(csite(EFFECT_DRIVER_CELL_55C48), 0));
  mem.write32(EFFECT_DRIVER_CELL_4570, install(csite(EFFECT_DRIVER_CELL_4570), VA));
  mem.write32(EFFECT_DRIVER_CELL_44F44, install(csite(EFFECT_DRIVER_CELL_44F44), 0));
  // fixed-address calls
  rt.cpu.setStub(0x800930c0, () => { calls.push({ site: dsite(0x800930c0), args: [rt.cpu.reg(4), rt.cpu.reg(5), rt.cpu.reg(6), rt.cpu.reg(7)] }); return OUTOBJ; });
  rt.cpu.setStub(0x8001ffa8, () => {
    const a0 = rt.cpu.reg(4);
    calls.push({ site: dsite(0x8001ffa8), args: [a0, rt.cpu.reg(5), rt.cpu.reg(6), rt.cpu.reg(7)] });
    mem.write32(a0 + 0x24, install(msite(CTX, 0x24), 0));
    mem.write32(a0 + 0x2c, install(msite(CTX, 0x2c), 0));
    return 0;
  });
  // the effect spawner
  rt.cpu.setStub(0x80089be4, () => {
    calls.push({ site: "spawn", args: [rt.cpu.reg(4), rt.cpu.reg(5)] });
    return SPAWN0 + 0x10 * (st.spawn++);
  });
  // run, capturing writes to the driver's objects only
  if (mode.kind === "step") mem.write32(OBJ + 0x0c, 1); else mem.write32(OBJ + 0x0c, 0);
  mem.write32(OBJ + 0x10, mode.kind === "step" ? mode.substate : stageSubstate(mode.stage));
  const writes: Write[] = [];
  mem.onWrite = (_pc, addr, size, value) => { if (inWriteRange(addr >>> 0)) writes.push([addr >>> 0, size, value >>> 0]); };
  rt.cpu.call(DRIVER, [OBJ, OUT], 500000);
  mem.onWrite = null;
  return { calls, writes };
}

function stageSubstate(stage: EffectDriverStage): number {
  return stage === "default" ? 0 : stage === "setup" ? 1 : stage === "mode2" ? 2 : 3;
}

// ── the port run ─────────────────────────────────────────────────────────────

class MemMap {
  private readonly m = new Map<number, number>();
  read32(a: number): number { return this.m.get(a >>> 0) ?? 0; }
  read16u(a: number): number { return (this.m.get(a >>> 0) ?? 0) & 0xffff; }
  read16s(a: number): number { return ((this.m.get(a >>> 0) ?? 0) << 16) >> 16; }
  write32(a: number, v: number): void { this.m.set(a >>> 0, v | 0); }
  write16(a: number, v: number): void { this.m.set(a >>> 0, v & 0xffff); }
}

function runPort(mode: Mode, s: Scenario): { calls: Call[]; writes: Write[] } {
  const mem = new MemMap();
  for (const [addr, value, size] of seeds(s)) { if (size === 2) mem.write16(addr, value); else mem.write32(addr, value); }
  const calls: Call[] = [];
  const writes: Write[] = [];
  const st: Counters = { layer: 0, spawn: 0 };
  const H: EffectDriverHost = {
    read: (h, o) => mem.read32(h + o),
    read16u: (h, o) => mem.read16u(h + o),
    read16s: (h, o) => mem.read16s(h + o),
    write: (h, o, v) => { const a = (h + o) >>> 0; mem.write32(a, v); writes.push([a, 4, v >>> 0]); },
    write16: (h, o, v) => { const a = (h + o) >>> 0; mem.write16(a, v); writes.push([a, 2, v & 0xffff]); },
    call: (h, o, args) => { calls.push({ site: msite(h, o), args: args.map((v) => v | 0) }); return methodRet(h, o, st); },
    callCell: (a, args) => {
      calls.push({ site: csite(a), args: args.map((v) => v | 0) });
      if ((a >>> 0) === EFFECT_DRIVER_CELL_OBJ_GET) return objGetRet(args[0] ?? 0);
      return cellRet(a, s);
    },
    callDirect: (a, args) => { calls.push({ site: dsite(a), args: args.map((v) => v | 0) }); return (a >>> 0) === 0x800930c0 ? OUTOBJ : 0; },
    spawn: (id, t) => { calls.push({ site: "spawn", args: [id | 0, t | 0] }); return SPAWN0 + 0x10 * (st.spawn++); },
    contextFill: (args) => {
      calls.push({ site: dsite(0x8001ffa8), args: [CTX | 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0] });
      return CTX;
    },
  };
  if (mode.kind === "step") effectDriverProgramBody(mode.substate, H, OBJ, OUT);
  else effectDriverConstructStageBody(mode.stage, H, OBJ, OUT);
  return { calls, writes };
}

// ── the checks ───────────────────────────────────────────────────────────────

const MODES: Mode[] = [
  ...Array.from({ length: 15 }, (_v, i) => ({ kind: "step" as const, substate: i })),
  { kind: "stage", stage: "default" }, { kind: "stage", stage: "setup" },
  { kind: "stage", stage: "mode2" }, { kind: "stage", stage: "mode3" },
];
const SCENARIOS: ReadonlyArray<readonly [string, Scenario]> = [["S0", S0], ["S1", S1]];

function label(m: Mode): string {
  return m.kind === "step" ? `substate ${m.substate}` : `stage ${m.stage}`;
}

for (const mode of MODES) {
  test(`F0x80089cd8 ${label(mode)}: every call matches the original words`, SKIP, () => {
    for (const [name, s] of SCENARIOS) {
      const o = runOriginal(mode, s);
      const p = runPort(mode, s);
      assert.ok(name !== "S0" || o.calls.length > 0, `${label(mode)} ${name}: original made no calls`);
      assert.equal(JSON.stringify(p.calls), JSON.stringify(o.calls), `${label(mode)} ${name}: call trace`);
      assert.equal(JSON.stringify(p.writes), JSON.stringify(o.writes), `${label(mode)} ${name}: write trace`);
    }
  });
}

test("F0x80089cd8 step bodies: the trace discriminates substates and scenarios", SKIP, () => {
  const a = runOriginal({ kind: "step", substate: 0 }, S0);
  const b = runOriginal({ kind: "step", substate: 2 }, S0);
  const c = runOriginal({ kind: "step", substate: 2 }, S1);
  assert.notDeepEqual(a.calls, b.calls, "substate 0 vs 2 must differ");
  assert.notDeepEqual(b.calls, c.calls, "substate 2 S0 vs S1 must differ (negative control)");
  // The port must follow the same discrimination.
  assert.deepEqual(runPort({ kind: "step", substate: 2 }, S0).calls, b.calls);
  assert.notDeepEqual(runPort({ kind: "step", substate: 2 }, S0).calls, runPort({ kind: "step", substate: 2 }, S1).calls);
});
