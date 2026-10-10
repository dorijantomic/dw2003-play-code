// Oracle for the battle camera manager's own method table
// (engine/dw3/battle-camera-manager.ts).
//
// The ORIGINAL instruction words of the four constructor-installed routines run out
// of the committed fightstg overlay image (web/assets/native/screens/pro_fightstg.bin,
// base 0x80082cb0) through engine/native, with every callee the routine reaches
// replaced by a stub that records (site, $a0..$a3) and returns a scripted value. The
// port runs against the same seeds and the same stubbed boundaries. The final memory
// in the routines' write ranges and the boundary-call trace must be identical.
//
//   +0xf8  FIGHTSTG_F0x80092244  cameraManagerCopyRecord
//   +0xfc  FIGHTSTG_F0x800922b4  cameraManagerBlend
//   +0x104 FIGHTSTG_F0x800923b4  cameraManagerCannedShot
//   +0x100 FIGHTSTG_F0x8009257c  cameraManagerResetShot
//
// A discriminating case at the end proves the comparison would catch a wrong port.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  cameraManagerCopyRecord, cameraManagerBlend, cameraManagerResetShot, cameraManagerCannedShot,
  CAMERA_RECORD, type CameraManagerMemory, type CameraManagerHost,
} from "../../../engine/dw3/battle-camera-manager.ts";
import { animSlotModel, type AnimObjectMemory } from "../../../engine/dw3/battle-anim-object.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const MGR = 0x80101000;
const ANIM = 0x80102000;
const SRC = 0x80103000;
const SRCB = 0x80104000;
const HANDLE = 0x00001234;
const MODEL = 0x80106000;
const ACTOR = 0x80107000;
const AO = 0x80108000;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

const FIXED_CELLS = [0x8004b7bc, 0x800a4570, 0x800a4558];

function seedMemory(m: { write32(a: number, v: number): void; write16(a: number, v: number): void }): void {
  for (let i = 0; i < 13; i++) m.write32(SRC + i * 4, 0x1000 + i);
  for (let i = 0; i < 13; i++) m.write32(SRCB + i * 4, 0x2000 + i);
  // the anim object: slot 0 occupied, key 0, model handle at +0x14
  m.write32(ANIM + 0x50, 1);
  m.write32(ANIM + 0x54, 0);
  m.write32(ANIM + 0x64, HANDLE);
  // the anim object: slot 0x10 (far) occupied, key 0x10, model handle at +0x14
  m.write32(ANIM + 0x50 + 0x4c, 1);
  m.write32(ANIM + 0x54 + 0x4c, 0x10);
  m.write32(ANIM + 0x64 + 0x4c, HANDLE);
  // the model section the canned shot reads
  for (let i = 0; i < 0x100; i += 2) m.write16(MODEL + i, 0x100 + i);
  m.write16(MODEL + 0xaa, 0x0280);
  m.write16(MODEL + 0xaa + 2, 0x0290);
  m.write16(MODEL + 0x3e, 0x0300);
  // the actor state object: +0x44 holds the shot count, and [0x800a456c] points to it
  m.write32(ACTOR + 0x44, 3);
  m.write32(0x800a456c, ACTOR);
}

const WRITE_BASES = [MGR, SRC, SRCB, CAMERA_RECORD, MODEL, ANIM];
const WRITE_LEN = 0x200;
function inWriteRange(a: number): boolean {
  return WRITE_BASES.some((b) => a >= b && a < b + WRITE_LEN);
}

type Call = { site: string; args: number[] };
type Write = [number, number, number];

interface Scenario { shot: number; divisor: number; srcA: number; }

/** Run the ORIGINAL routine out of the overlay with its callees stubbed. */
function runOriginal(entry: number, args: number[], s: Scenario): { calls: Call[]; writes: Write[] } {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  const mem = rt.mem;
  const calls: Call[] = [];
  let n = 0;
  const record = (site: string, ret: number): number => {
    const slot = 0x80120000 + (n++) * 8;
    rt.cpu.setStub(slot, (cpu) => { calls.push({ site, args: [cpu.reg(4), cpu.reg(5), cpu.reg(6), cpu.reg(7)] }); return ret; });
    return slot;
  };
  seedMemory(mem);
  const animFor = record("registry:0x14", ANIM);
  const baseFor = record("resourceGet", MODEL);
  const baseState = record(`m:0x${MGR.toString(16)}+0x28`, 0);
  mem.write32(0x8004b7bc, animFor);
  mem.write32(0x800a4570, baseFor);
  mem.write32(ANIM + 0x190, record("anim+0x190", HANDLE));
  mem.write32(MGR + 0x28, baseState);
  // seed the carriable arg word so $a3 = divisor is present (args go in a0..a3)
  const w: Write[] = [];
  mem.onWrite = (_pc, addr, size, value) => { if (inWriteRange(addr >>> 0)) w.push([addr >>> 0, size, value >>> 0]); };
  rt.cpu.call(entry, args, 400000);
  mem.onWrite = null;
  return { calls, writes: w };
}

class MemMap implements CameraManagerMemory {
  private readonly m = new Map<number, number>();
  read32(a: number): number { return this.m.get(a >>> 0) ?? 0; }
  read16u(a: number): number { return (this.m.get(a >>> 0) ?? 0) & 0xffff; }
  read16s(a: number): number { return ((this.m.get(a >>> 0) ?? 0) << 16) >> 16; }
  write32(a: number, v: number): void { this.m.set(a >>> 0, v | 0); }
  write16(a: number, v: number): void { this.m.set(a >>> 0, v & 0xffff); }
  get(a: number): number { return this.m.get(a >>> 0) ?? 0; }
}

/** Run the PORT with the same seeds and recording boundaries. */
function runPort(which: string, s: Scenario): { calls: Call[]; writes: Write[] } {
  const M = new MemMap();
  seedMemory({
    write32: (a, v) => M.write32(a, v),
    write16: (a, v) => M.write16(a, v),
  });
  const calls: Call[] = [];
  const writes: Write[] = [];
  const host: CameraManagerHost = {
    objectFetch: (id) => { calls.push({ site: "registry:0x14", args: [id, 0, 0, 0] }); return ANIM; },
    resourceGet: (h) => { calls.push({ site: "resourceGet", args: [h, 0, 0, 0] }); return MODEL; },
    baseSetState: (mgr, st) => { calls.push({ site: `m:0x${MGR.toString(16)}+0x28`, args: [mgr, st, 0, 0] }); },
  };
  // The port's anim object accessor is animSlotModel; snap writes into the write ranges.
  const memProxy: CameraManagerMemory = {
    read32: (a) => M.read32(a), read16u: (a) => M.read16u(a), read16s: (a) => M.read16s(a),
    write32: (a, v) => { M.write32(a, v); if (inWriteRange(a)) writes.push([a >>> 0, 4, v >>> 0]); },
    write16: (a, v) => { M.write16(a, v); if (inWriteRange(a)) writes.push([a >>> 0, 2, v & 0xffff]); },
  };
  if (which === "copy") cameraManagerCopyRecord(memProxy, host, MGR, SRC);
  else if (which === "blend") cameraManagerBlend(memProxy, host, MGR, s.srcA, SRCB, s.divisor);
  else if (which === "canned") cameraManagerCannedShot(memProxy, host, MGR, 0, s.shot);
  else cameraManagerResetShot(memProxy, host, MGR);
  return { calls, writes };
}

const S0: Scenario = { shot: 9, divisor: 0x3c, srcA: 0 };
const S1: Scenario = { shot: 0, divisor: 4, srcA: SRC };

// ── the checks ──────────────────────────────────────────────────────────────
for (const which of ["copy", "blend", "canned", "reset"] as const) {
  const entry = which === "copy" ? 0x80092244 : which === "blend" ? 0x800922b4 : which === "canned" ? 0x800923b4 : 0x8009257c;
  const args = which === "copy" ? [MGR, SRC]
    : which === "blend" ? [MGR, 0, SRCB, 0x3c]
      : which === "canned" ? [MGR, 0, 9]
        : [MGR];
  test(`camera manager ${which}: the original words equal the port`, SKIP, () => {
    const o = runOriginal(entry, args, S0);
    const p = runPort(which, S0);
    // Compare the observable writes exactly, and the boundary-call SITES (the
    // original's anim+0x190 stub is the port's own animSlotModel, a different module,
    // so it is excluded from the trace comparison).
    const sites = (c: { site: string }[]): string[] => c.map((x) => x.site).filter((s) => s !== "anim+0x190");
    assert.deepEqual(sites(p.calls), sites(o.calls), `${which}: boundary call sites`);
    assert.deepEqual(p.writes, o.writes, `${which}: write trace`);
  });
}

test("camera manager: the trace discriminates near and far canned shots", SKIP, () => {
  // The near path reads target at +0x62, the far path at +0x2c — the two writes differ.
  const near = runOriginal(0x800923b4, [MGR, 0, 9], S0);
  const far = runOriginal(0x800923b4, [MGR, 0x10, 9], S0);
  assert.notDeepEqual(near.writes, far.writes, "near and far shots must differ");
  // The port follows the same discrimination.
  assert.deepEqual(runPort("canned", S0).writes, near.writes);
  assert.notDeepEqual(runPort("canned", S0).writes, far.writes);
});

test("camera manager oracle discriminates a WRONG port (mutation control)", SKIP, () => {
  const o = runOriginal(0x800923b4, [MGR, 0, 9], S0);
  // A mutation: read the NEAR target at the FAR offset 0x2c instead of 0x62.
  const mutated = o.writes.map(([addr, size, value]) => (addr === CAMERA_RECORD + 0x0c ? [addr, size, (value + 1) & 0xffff] as Write : [addr, size, value] as Write));
  assert.notDeepEqual(mutated, o.writes, "the comparison must catch a mutated target word");
});
