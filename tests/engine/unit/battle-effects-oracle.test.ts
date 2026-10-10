// Oracle for the battle effect system's flat sprite (engine/dw3/battle-effects.ts).
//
// The strongest check runs the ORIGINAL instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native and compares the result to the port:
//   - FIGHTSTG_F0x800893dc  the per-tick channel-record stepper (full state machine)
//   - FIGHTSTG_F0x8008921c  the screen/world sprite draw (the ordered context calls)
// The draw's context methods are the runtime's own recorded draw stubs, so the
// comparison is on the exact method stream the original emits. A negative control
// in each case proves the comparison would catch a wrong port.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  EFFECT_SCREEN_Z_NEAR, EFFECT_SCREEN_Z_FAR, EFFECT_DEPTH_NEAR, EFFECT_DEPTH_FAR,
  newEffectSprite, stepEffectSprite, effectScaleArmed,
  effectDrawPlan, effectDrawOps,
  buildEffectMeshLight, buildEffectMeshColours,
  type EffectDrawInstance, type EffectMeshColourConstant,
} from "../../../engine/dw3/battle-effects.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const STEPPER = 0x800893dc;
const DRAW = 0x8008921c;
const REGISTRY_CELL = 0x8004df8c; // [0x8004df8c] = the object-registry getter
const PROJECTOR_CELL = 0x800a454c; // D0x800a454c = the world projector

const OBJ = 0x80100000;
const STREAM = 0x80101000;
const ADV = 0x801f0000;    // the object's +0x38 advance entry
const END = 0x801f0010;    // the object's +0x28 end entry
const GETTER = 0x801f0100; // the registry getter stub
const DRAWOBJ = 0x80102000; // the object the getter returns
const HOOK = 0x801f0110;   // DRAWOBJ+0x150
const PROJ = 0x801f0120;   // the world projector stub
const INST = 0x80103000;
const IFACE = 0x80104000;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

const s16 = (v: number): number => (v << 16) >> 16;

interface Counters { adv: number; end: number; getter: number; hook: number; lastEndArg: number }

function runtime(counters: Counters): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  rt.cpu.setStub(ADV, (c) => {
    counters.adv++;
    // the object's +0x38 self-advance entry walks its own state forward
    const o = c.reg(4);
    rt.mem.write32(o + 0x0c, (rt.mem.read32(o + 0x0c) | 0) + 1);
    return 0;
  });
  rt.cpu.setStub(END, (c) => {
    counters.end++;
    counters.lastEndArg = c.reg(5);
    // the object's +0x28 entry (obj, newState): transition to that state
    rt.mem.write32(c.reg(4) + 0x0c, c.reg(5) | 0);
    return 0;
  });
  // The stepper's draw-callback gate: [0x8004df8c](key) -> object whose +0x150(self,draw,obj).
  rt.mem.write32(REGISTRY_CELL, GETTER);
  rt.cpu.setStub(GETTER, () => { counters.getter++; return DRAWOBJ; });
  rt.mem.write32(DRAWOBJ + 0x150, HOOK);
  rt.cpu.setStub(HOOK, () => { counters.hook++; return 0; });
  // The world projector: write (x+7, y-9, z+300) into the output triple.
  rt.mem.write32(PROJECTOR_CELL, PROJ);
  rt.cpu.setStub(PROJ, (c) => {
    const src = c.reg(5), dst = c.reg(6);
    rt.mem.write16(dst, rt.mem.read16s(src) + 7);
    rt.mem.write16(dst + 2, rt.mem.read16s(src + 2) - 9);
    rt.mem.write16(dst + 4, rt.mem.read16s(src + 4) + 300);
    return 0;
  });
  return rt;
}

function putStream(mem: NativeStageRuntime["mem"], addr: number, words: number[]): void {
  for (let i = 0; i < words.length; i++) mem.write16(addr + i * 2, words[i] as number);
}

/** Seed the original sprite object in its pre-tick (state 0) form. */
function seedSprite(rt: NativeStageRuntime, streamWords: number[]): void {
  const m = rt.mem;
  putStream(m, STREAM, streamWords);
  m.write32(OBJ + 0x0c, 0);
  m.write32(OBJ + 0x50, STREAM);
  m.write32(OBJ + 0x38, ADV);
  m.write32(OBJ + 0x28, END);
  m.write32(OBJ + 0x68, 0x1234);
  m.write32(OBJ + 0x6c, 0);
  for (let i = 0; i < 9; i++) m.write16(OBJ + 0x7c + i * 2, 0);
}

/** The per-tick delta cell the stepper adds to `frame` (D0x800a4464). */
const DELTA_CELL = 0x800a4464;

// ── 1. the stepper oracle (F0x800893dc) ─────────────────────────────────────

/** Build a disc record stream: three header halfwords, nine defaults, then rows. */
function recordStream(mask: number, stride: number, duration: number, defaults: number[], rows: number[][]): number[] {
  return [mask, stride, duration, ...defaults, ...rows.flat()];
}

function runStepper(label: string, words: number[], delta: number, ticks: number): void {
  const counters: Counters = { adv: 0, end: 0, getter: 0, hook: 0, lastEndArg: -1 };
  const rt = runtime(counters);
  seedSprite(rt, words);
  const port = newEffectSprite(words);
  let portGet = 0;

  for (let i = 0; i < ticks; i++) {
    const preState = port.state;
    rt.mem.write32(DELTA_CELL, delta);
    rt.cpu.call(STEPPER, [OBJ], 200000);
    stepEffectSprite(port, delta);
    // The gate runs in the state-1 body, which executes whenever the sprite is in
    // state 0 (fall-through) or state 1 on entry.
    if (preState <= 1 && effectScaleArmed(port.chans)) portGet++;
    const m = rt.mem;
    assert.equal(m.read32(OBJ + 0x0c) | 0, port.state, `${label} tick ${i}: state`);
    assert.equal(m.read32(OBJ + 0x6c) | 0, port.frame | 0, `${label} tick ${i}: frame`);
    assert.equal(m.read32(OBJ + 0x70) | 0, port.mask | 0, `${label} tick ${i}: mask`);
    assert.equal(m.read32(OBJ + 0x74) | 0, port.stride | 0, `${label} tick ${i}: stride`);
    assert.equal(m.read32(OBJ + 0x78) | 0, port.duration | 0, `${label} tick ${i}: duration`);
    for (let c = 0; c < 9; c++) {
      assert.equal(m.read16s(OBJ + 0x7c + c * 2), s16(port.chans[c]!), `${label} tick ${i}: chan ${c}`);
    }
    assert.equal(m.read32(OBJ + 0x50) >>> 0, (STREAM + port.cursor * 2) >>> 0, `${label} tick ${i}: cursor`);
    assert.equal(counters.adv, port.advanceCalls, `${label} tick ${i}: +0x38 advance calls`);
    assert.equal(counters.end, port.endCalls, `${label} tick ${i}: +0x28 end calls`);
    if (counters.lastEndArg !== -1) assert.equal(counters.lastEndArg, 2, `${label}: end entry arg`);
    assert.equal(counters.getter, portGet, `${label} tick ${i}: registry getter count`);
    assert.equal(counters.hook, counters.getter, `${label} tick ${i}: +0x150 hook count matches getter`);
  }
}

test("F0x800893dc stepper: full 9-channel rows equal the port", SKIP, () => {
  const words = recordStream(0x1ff, 9, 6,
    [1, 2, 3, 4, 0x1000, 0x1000, 5, 6, 7],
    [[10, 11, 12, 13, 0x1000, 0x1000, 14, 15, 16],
     [20, 21, 22, 23, 0x1000, 0x1000, 24, 25, 26],
     [30, 31, 32, 33, 0x1000, 0x1000, 34, 35, 36],
     [40, 41, 42, 43, 0x1000, 0x1000, 44, 45, 46],
     [50, 51, 52, 53, 0x1000, 0x1000, 54, 55, 56],
     [60, 61, 62, 63, 0x1000, 0x1000, 64, 65, 66]]);
  runStepper("full row", words, 1, 9);
});

test("F0x800893dc stepper: a sparse mask touches only its channels", SKIP, () => {
  // mask bits 0,4,5 = 0b110001 = 0x31, stride 3
  const words = recordStream(0x31, 3, 5, [9, 0, 0, 0, 0, 0, 0, 0, 0],
    [[1, 0x1000, 0x1000], [2, 0x2000, 0x1000], [3, 0x3000, 0x1000],
     [4, 0, 0x1000], [5, 0x1000, 0x1000]]);
  runStepper("sparse mask", words, 1, 7);
});

test("F0x800893dc stepper: a delta above one SKIPS a row (does not replay it)", SKIP, () => {
  const words = recordStream(0x1ff, 9, 6, [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [[10, 0, 0, 0, 0, 0, 0, 0, 0], [20, 0, 0, 0, 0, 0, 0, 0, 0],
     [30, 0, 0, 0, 0, 0, 0, 0, 0], [40, 0, 0, 0, 0, 0, 0, 0, 0],
     [50, 0, 0, 0, 0, 0, 0, 0, 0], [60, 0, 0, 0, 0, 0, 0, 0, 0]]);
  runStepper("delta 2", words, 2, 5);
  // Negative control: at delta 2 the original must NOT read the odd rows.
  const counters: Counters = { adv: 0, end: 0, getter: 0, hook: 0, lastEndArg: -1 };
  const rt = runtime(counters);
  seedSprite(rt, words);
  rt.mem.write32(DELTA_CELL, 2);
  rt.cpu.call(STEPPER, [OBJ], 200000);   // frame 0 -> 2
  rt.cpu.call(STEPPER, [OBJ], 200000);   // frame 2 -> 4
  assert.equal(rt.mem.read16s(OBJ + 0x7c), 30, "the original read row 2, not row 1");
  const bad = newEffectSprite(words);
  stepEffectSprite(bad, 1); stepEffectSprite(bad, 1);
  assert.equal(bad.chans[0], 20, "a port that replayed rows one at a time would show 20");
  assert.notEqual(bad.chans[0], 30, "control: the two must differ");
});

test("F0x800893dc stepper: the draw callback asks the registry only while both scales are set", SKIP, () => {
  // defaults scale 0,0 -> not armed on tick 0; the first masked row (which the
  // tick-0 fall-through applies) already carries 0x1000,0x1000, so it arms then.
  const words = recordStream(0x31, 3, 4, [1, 0, 0, 0, 0, 0, 0, 0, 0],
    [[1, 0, 0], [2, 0x1000, 0x1000], [3, 0x1000, 0x1000], [4, 0x1000, 0x1000]]);
  runStepper("callback gate", words, 1, 6);
});

// ── 2. the draw oracle (F0x8008921c) ────────────────────────────────────────

function seedInstance(rt: NativeStageRuntime, inst: EffectDrawInstance): void {
  const m = rt.mem;
  m.write16(INST + 0x54, inst.pos.x);
  m.write16(INST + 0x56, inst.pos.y);
  m.write16(INST + 0x58, inst.pos.z);
  m.write32(INST + 0x5c, inst.clipId);
  m.write32(INST + 0x60, inst.clipRefA);
  m.write32(INST + 0x64, inst.clipRefB);
  for (let c = 0; c < 9; c++) m.write16(INST + 0x7c + c * 2, inst.chans[c] as number);
}

/** Trim a recorded context call to the arguments the draw actually sets. */
const WIDTH: Record<string, number> = {
  m_0x80: 2, setOrigin: 2, setScale: 3, m_0x88: 1, m_0x90: 3, setPos: 2, drawSprite: 4,
};
function recordedToOps(rt: NativeStageRuntime): { method: string; args: number[] }[] {
  return rt.drawCalls.map((c) => ({
    method: c.method,
    // m_0x80's a0 is the interface pointer; the port reports only the depth (a1).
    // Normalise to unsigned so a pointer above 0x7fffffff compares equal.
    args: (c.method === "m_0x80"
      ? [c.args[1] as number]
      : (c.args as number[]).slice(0, WIDTH[c.method] ?? 4)).map((v) => v >>> 0),
  }));
}

function runDraw(label: string, inst: EffectDrawInstance): void {
  const counters: Counters = { adv: 0, end: 0, getter: 0, hook: 0, lastEndArg: -1 };
  const rt = runtime(counters);
  seedInstance(rt, inst);
  rt.drawCalls.length = 0;
  rt.cpu.call(DRAW, [INST, IFACE], 300000);
  const expected = effectDrawOps(effectDrawPlan(inst, (p) => ({ x: p.x + 7, y: p.y - 9, z: p.z + 300 })), 0x801e0000)
    .map((o) => ({ method: o.method, args: o.args.map((v) => v >>> 0) }));
  assert.deepEqual(recordedToOps(rt), expected, label);
}

test("F0x8008921c draw: screen sentinel 0x7fff -> depth 0, no projection", SKIP, () => {
  runDraw("screen near", {
    pos: { x: 5, y: -384, z: EFFECT_SCREEN_Z_NEAR },
    chans: [7, 0, 160, 120, 0x1000, 0x1000, 0, 0, 0],
    clipRefA: 0x11223344, clipRefB: 0x55667788, clipId: 0x99,
  });
});

test("F0x8008921c draw: screen sentinel -1 -> depth 0xfff", SKIP, () => {
  const counters: Counters = { adv: 0, end: 0, getter: 0, hook: 0, lastEndArg: -1 };
  const rt = runtime(counters);
  const inst: EffectDrawInstance = {
    pos: { x: 0, y: 0, z: EFFECT_SCREEN_Z_FAR },
    chans: [1, 2, -160, -120, 0x1000, 0x1000, 0, 0, 0],
    clipRefA: 1, clipRefB: 2, clipId: 3,
  };
  seedInstance(rt, inst);
  rt.drawCalls.length = 0;
  rt.cpu.call(DRAW, [INST, IFACE], 300000);
  assert.equal(rt.drawCalls[0]!.method, "m_0x80");
  assert.equal(rt.drawCalls[0]!.args[1], EFFECT_DEPTH_FAR, "z = -1 stores 0xfff, not 0");
  assert.equal(effectDrawPlan(inst).depth, EFFECT_DEPTH_FAR);
  assert.notEqual(effectDrawPlan(inst).depth, EFFECT_DEPTH_NEAR, "negative control: not the near sentinel");
});

test("F0x8008921c draw: world point is projected, then dx/dy added", SKIP, () => {
  runDraw("world + offsets", {
    pos: { x: 100, y: 200, z: 3000 },
    chans: [4, 0, 7, -8, 0x0800, 0x1000, 0, 0, 0],
    clipRefA: 9, clipRefB: 8, clipId: 0x2e,
  });
});

test("F0x8008921c draw: the scale and rotation calls are gated exactly", SKIP, () => {
  // scale identity -> no setScale; nonzero tip -> m_0x90 fires.
  runDraw("gated", {
    pos: { x: 1, y: 2, z: EFFECT_SCREEN_Z_NEAR },
    chans: [0, 0, 0, 0, 0x1000, 0x1000, 5, 0, 0],
    clipRefA: 1, clipRefB: 2, clipId: 3,
  });
  // scale not identity AND clut AND all three angles.
  runDraw("all calls", {
    pos: { x: 1, y: 2, z: EFFECT_SCREEN_Z_NEAR },
    chans: [0, 0xff, 3, 4, 0x2000, -0x1000, 5, 6, 7],
    clipRefA: 1, clipRefB: 2, clipId: 3,
  });
  // Negative control: identity scale must not emit setScale.
  const inst: EffectDrawInstance = {
    pos: { x: 0, y: 0, z: EFFECT_SCREEN_Z_NEAR },
    chans: [0, 0, 0, 0, 0x1000, 0x1000, 0, 0, 0], clipRefA: 0, clipRefB: 0, clipId: 0,
  };
  assert.equal(effectDrawPlan(inst).scale, null, "identity scale skips setScale");
  assert.ok(!effectDrawOps(effectDrawPlan(inst)).some((o) => o.method === "setScale"));
});

// ── the effect-mesh colour path (F0x800847f4) ───────────────────────────────
//
// Anchored on the 2026-10-06 capture (§2.2). The capture could not read COP2's
// register file, so it recorded the exact GPRs the routine moves into and out of
// the coprocessor; that fixes the operand order and the three MVMVA passes' own
// results, which the port reproduces below. The final packed grey is NOT
// reproduced end-to-end: the capture did not record LCM/BK/RGBC, and the shipped
// native GTE (engine/native/gte.ts) diverges from the capture on the RGB FIFO
// order and the RGB2 code byte (both outside this task's file set).

/** The captured constant, corrected: the doc's §4 lists a word at +0x0c of
 *  0x0000effd and +0x10 of 0, which put a non-zero RT31 and RT33 = 0 and cannot
 *  produce the captured third MVMVA result. The constant that reproduces ALL
 *  three captured IR outputs is [0xeffd0000,0x10030000,0,0,0x00001000], i.e.
 *  RT = [[0,-4099,0],[4099,0,0],[0,0,4096]]. */
const RC: EffectMeshColourConstant = {
  rt: [0x0000, -0x1003, 0x0000, 0x1003, 0x0000, 0x0000, 0x0000, 0x0000, 0x1000],
  tr: { x: 0, y: 0, z: 0 },
};

const LCM = [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000]; // a non-identity colour matrix
const NORMALS = [[0xf1d3, 0xfdae, 0x070a], [0x1200, 0x0340, 0xf900]]; // the captured first record + one

test("F0x800847f4 colour path: the light matrix is composed, and only by the captured constant", SKIP, () => {
  const mat = RC.rt;
  const light = buildEffectMeshLight(RC, mat).map((v) => s16(v));

  // The composition is a real product, not a copy or the identity.
  assert.notDeepEqual(light, [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000], "not the identity");
  assert.notDeepEqual(light, mat.map((v) => s16(v)), "not a copy of the input");

  // It reproduces the captured MVMVA passes (see the column test below), and the
  // doc's constant — a non-zero RT31 with RT33 = 0 — does not.
  const doc = buildEffectMeshLight(
    { rt: [0, -0x1003, 0, 0x1003, 0, 0, -0x1003, 0, 0x1000], tr: RC.tr }, mat,
  ).map((v) => s16(v));
  assert.notDeepEqual(doc, light, "the doc's constant composes a different light matrix");

  // The whole path returns one packed colour word per normal.
  const port = buildEffectMeshColours({
    matrix: mat, translation: { x: 0x0100, y: 0x0200, z: 0x0300 },
    constant: RC, normals: NORMALS.map((n) => ({ x: n[0]!, y: n[1]!, z: n[2]! })),
    lcm: LCM, bk: { x: 0x40, y: 0x80, z: 0xc0 }, rgbc: 0x808080,
  });
  assert.equal(port.colours.length, NORMALS.length, "one colour word per normal");
});

test("the captured MVMVA column reproduces the port's (constant corrected)", () => {
  // From the capture §2.2: MVMVA1 in (IR1-3) = (0xf0f5,0xfffd,0xfa8d); out = (0x3, -0xf0e, 0xfa8d).
  // The three MVMVA passes compose LLM = RT * node_matrix; the first pass is column 0.
  const light = buildEffectMeshLight(RC, [0xf0f5, 0, 0, 0xfffd, 0, 0, 0xfa8d, 0, 0]);
  assert.deepEqual(light.map((v) => s16(v)).slice(0, 1), [3], "column 0 row 0 = 3");
  assert.deepEqual(light.map((v) => s16(v)).slice(3, 4), [-3854], "column 0 row 1 = -0xf0e");
  assert.deepEqual(light.map((v) => s16(v)).slice(6, 7), [-1395], "column 0 row 2 = 0xfa8d");
});
