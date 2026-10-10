// Oracle for the effect-object spawner FIGHTSTG_F0x80089be4
// (engine/dw3/battle-effect-spawn.ts).
//
// The check runs the ORIGINAL instruction words out of the committed fightstg
// overlay image (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0)
// through engine/native, with its two callees — the class allocator F0x80014504
// and the base-object abort entry at +0x28 — replaced by recording stubs. The
// ported spawnEffectObject runs against an EffectSpawnHost that records the same
// two calls, over the same seeded registry and table. The two call traces and the
// two 0x68-byte objects must be identical.
//
// The check DISCRIMINATES: a match, a non-match (the abort path) and two different
// ids each produce a different object, and a deliberately-wrong port (matching on
// `type + 1`) is shown to differ — so a port that loses the registry comparison or
// the abort branch fails rather than passing vacuously.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  spawnEffectObject, EFFECT_SPAWN_REGISTRY, EFFECT_OBJECT_SIZE,
  type EffectSpawnHost,
} from "../../../engine/dw3/battle-effect-spawn.ts";

const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const BASE = 0x80082cb0;
const SPAWN = 0x80089be4;
const ALLOC = 0x80014504;
const SET_STATE = 0x80014274;
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const OBJ = 0x80100000;
const TABLE = 0x80110000;

type Seed = readonly [number, number, number]; // addr, value, size

// Two registry entries then the -1 terminator; ids are s16, field1 s16, field2 word.
const REGISTRY: Seed[] = [
  [EFFECT_SPAWN_REGISTRY + 0x0, 0x3e8, 2],
  [EFFECT_SPAWN_REGISTRY + 0x2, 0x0011, 2],
  [EFFECT_SPAWN_REGISTRY + 0x4, 0x22223333, 4],
  [EFFECT_SPAWN_REGISTRY + 0x8, 0x3e9, 2],
  [EFFECT_SPAWN_REGISTRY + 0xa, 0x0022, 2],
  [EFFECT_SPAWN_REGISTRY + 0xc, 0x44445555, 4],
  [EFFECT_SPAWN_REGISTRY + 0x10, 0xffff, 2], // -1 terminator
];
const TABLE_BYTES = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];

function seeds(): Seed[] {
  const s: Seed[] = [...REGISTRY];
  for (let i = 0; i < TABLE_BYTES.length; i++) s.push([TABLE + i, TABLE_BYTES[i] as number, 1]);
  return s;
}

interface Call { site: string; args: number[]; }

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

// ── the original run ─────────────────────────────────────────────────────────

function runOriginal(type: number): { calls: Call[]; obj: number[] } {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  const mem = rt.mem;
  for (const [addr, value, size] of seeds()) {
    if (size === 1) mem.write8(addr, value);
    else if (size === 2) mem.write16(addr, value);
    else mem.write32(addr, value);
  }
  const calls: Call[] = [];
  // The allocator: record and return the scratch object with the base +0x28 slot installed.
  rt.cpu.setStub(ALLOC, () => {
    calls.push({ site: `alloc:0x${ALLOC.toString(16)}`, args: [] });
    return OBJ;
  });
  // The base-object abort entry (obj+0x28 -> F0x80014274): set state +0x0c = a1, clear +0x10/14/18.
  mem.write32(OBJ + 0x28, SET_STATE);
  rt.cpu.setStub(SET_STATE, (cpu) => {
    calls.push({ site: `setState:0x${SET_STATE.toString(16)}`, args: [cpu.reg(4), cpu.reg(5), cpu.reg(6), cpu.reg(7)] });
    const a0 = cpu.reg(4), a1 = cpu.reg(5);
    mem.write32(a0 + 0x0c, a1 | 0);
    mem.write32(a0 + 0x10, 0); mem.write32(a0 + 0x14, 0); mem.write32(a0 + 0x18, 0);
    return 0;
  });
  rt.cpu.call(SPAWN, [type, TABLE], 200000);
  const obj: number[] = [];
  for (let i = 0; i < EFFECT_OBJECT_SIZE; i += 4) obj.push(mem.read32(OBJ + i) >>> 0);
  return { calls, obj };
}

// ── the port run ─────────────────────────────────────────────────────────────

class MemMap {
  private readonly m = new Map<number, number>();
  read8(a: number): number { return this.m.get(a >>> 0) ?? 0; }
  read16s(a: number): number { return ((this.read8(a) | (this.read8(a + 1) << 8)) << 16) >> 16; }
  read32(a: number): number {
    return (this.read8(a) | (this.read8(a + 1) << 8) | (this.read8(a + 2) << 16) | (this.read8(a + 3) << 24)) >>> 0;
  }
  write8(a: number, v: number): void { this.m.set(a >>> 0, v & 0xff); }
  write16(a: number, v: number): void { this.write8(a, v); this.write8(a + 1, v >> 8); }
  write32(a: number, v: number): void { this.write8(a, v); this.write8(a + 1, v >> 8); this.write8(a + 2, v >> 16); this.write8(a + 3, v >> 24); }
}

function runPort(type: number): { calls: Call[]; obj: number[] } {
  const mem = new MemMap();
  for (const [addr, value, size] of seeds()) {
    if (size === 1) mem.write8(addr, value);
    else if (size === 2) mem.write16(addr, value);
    else mem.write32(addr, value);
  }
  const calls: Call[] = [];
  mem.write32(OBJ + 0x28, SET_STATE); // the allocator's vtable install, as in the original run
  const host: EffectSpawnHost = {
    allocEffectObject: () => { calls.push({ site: `alloc:0x${ALLOC.toString(16)}`, args: [] }); return OBJ; },
    setObjectState: (obj, state) => {
      calls.push({ site: `setState:0x${SET_STATE.toString(16)}`, args: [obj | 0, state | 0, 0, 0] });
      mem.write32(obj + 0x0c, state | 0);
      mem.write32(obj + 0x10, 0); mem.write32(obj + 0x14, 0); mem.write32(obj + 0x18, 0);
    },
  };
  const ptr = spawnEffectObject(mem, host, type, TABLE);
  assert.equal(ptr >>> 0, OBJ >>> 0, "spawn returns the object the allocator gave");
  const obj: number[] = [];
  for (let i = 0; i < EFFECT_OBJECT_SIZE; i += 4) obj.push(mem.read32(OBJ + i) >>> 0);
  return { calls, obj };
}

// ── the checks ───────────────────────────────────────────────────────────────

for (const [name, type] of [["match 0x3e8", 0x3e8], ["match 0x3e9", 0x3e9], ["no match 0x9999", 0x9999]] as const) {
  test(`F0x80089be4 ${name}: the call trace and the object match the original words`, SKIP, () => {
    const o = runOriginal(type);
    const p = runPort(type);
    // The abort call's $a2/$a3 are the allocator's leftover tag/arg registers, not
    // arguments the spawner sets; compare the site and the two meaningful args.
    const norm = (cs: Call[]): string => JSON.stringify(cs.map((c) => ({ site: c.site, args: c.args.slice(0, 2) })));
    assert.equal(norm(p.calls), norm(o.calls), `${name}: call trace`);
    assert.equal(JSON.stringify(p.obj), JSON.stringify(o.obj), `${name}: object bytes`);
  });
}

test("F0x80089be4 discriminates ids and the abort branch", SKIP, () => {
  const a = runOriginal(0x3e8);
  const b = runOriginal(0x3e9);
  const c = runOriginal(0x9999);
  assert.notDeepEqual(a.obj, b.obj, "two registry ids must build different objects");
  assert.notDeepEqual(a.obj, c.obj, "a non-matching id must take the abort branch");
  assert.equal(a.calls.length, 1, "a match makes only the allocator call");
  assert.equal(c.calls.length, 2, "a non-match makes the allocator call and the abort");
  // The port follows the same discrimination.
  assert.deepEqual(runPort(0x3e8).obj, a.obj);
  assert.deepEqual(runPort(0x3e9).obj, b.obj);
  assert.deepEqual(runPort(0x9999).obj, c.obj);
});

test("F0x80089be4 negative control: a port matching on type+1 differs from the original", SKIP, () => {
  // A deliberately-wrong port: compare the registry id against `type + 1`. It must
  // NOT reproduce the original for a matching type, proving the check is not vacuous.
  function wrongSpawn(fmem: MemMap, type: number): void {
    fmem.write32(OBJ + 0x50, -1);
    for (let p = EFFECT_SPAWN_REGISTRY; ; p += 8) {
      const id = fmem.read16s(p) | 0;
      if (id === -1) break;
      if (id === (type + 1)) {                       // <-- the mutation
        fmem.write32(OBJ + 0x50, type);
        fmem.write32(OBJ + 0x54, fmem.read16s(p + 2) | 0);
        fmem.write32(OBJ + 0x58, fmem.read32(p + 4) | 0);
      }
    }
  }
  const mem = new MemMap();
  for (const [addr, value, size] of seeds()) {
    if (size === 1) mem.write8(addr, value);
    else if (size === 2) mem.write16(addr, value);
    else mem.write32(addr, value);
  }
  wrongSpawn(mem, 0x3e8); // the correct port would have matched 0x3e8; this matches 0x3e9
  const wrongObj: number[] = [];
  for (let i = 0; i < EFFECT_OBJECT_SIZE; i += 4) wrongObj.push(mem.read32(OBJ + i) >>> 0);
  assert.notDeepEqual(wrongObj, runOriginal(0x3e8).obj, "the wrong-id port must differ from the original");
});
