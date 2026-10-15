// Oracle for the action VM's OPCODE HANDLER BODIES (engine/dw3/battle-action-opcodes.ts).
//
// For each handler it runs the ORIGINAL instruction words out of the committed
// fightstg overlay through engine/native with a RECORDING stub at every target the
// handler calls, then drives the port over a fresh copy of the same memory with a
// recording host, and compares:
//   * which target each impl calls, in order (a logical name per original address);
//   * the meaningful arguments (the scalar operand id/type/mode, and op6's two
//     3-vectors decoded from the original's stack pointers);
//   * the actor's instruction-pointer advance, in words.
// A negative control mutates an operand and shows the comparison FAILS, so the
// oracle discriminates.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  op1Handler, op2Handler, op3Handler, op4Handler, op5Handler, op6Handler, op7Handler, op10Handler,
  CAMERA_STRUCT,
  type ActionOpcodeHost, type ActionOpcodeMemory, type ActionOpcodeRegistry,
} from "../../../engine/dw3/battle-action-opcodes.ts";
import type { ReactionHost } from "../../../engine/dw3/battle-reaction-dispatch.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const H = {
  op1: 0x8008b69c, op2: 0x8008b7f4, op3: 0x8008bc80, op4: 0x8008c2cc,
  op5: 0x8008c004, op6: 0x8008bea8, op7: 0x8008c514, op10: 0x8008c454,
};
const ACTOR = 0x80100000;
const CTX = 0x80101000;
const P = 0x80102000;
const MEW = 0x80105000;
const ANIM = 0x8010c000;
const CHILD = 0x80107000;
const FETCH = 0x80106004;
// distinct stub addresses so the recorder can tell the targets apart
const S = {
  alloc: 0x80106100, destroy: 0x80106104,
  slotKey: 0x80106108, anim188: 0x8010610c,
  fxPreload: 0x80106110, fxSpawn: 0x80106114, fxStrike: 0x80106118,
  projFile: 0x8010611c, projBuild: 0x80106120, ready: 0x80106124,
  camF8: 0x80106128, camFC: 0x8010612c, cam100: 0x80106130, cam104: 0x80106134,
  animE8: 0x80106138, motionProbe: 0x8010613c, motionReady: 0x80106140,
  overlaySpawn: 0x80106144, overlayFree: 0x80106148,
};
// original target addresses
const A = {
  alloc: 0x8008c910, slotKey: 0x8008b630, fxPreload: 0x80089978, fxSpawn: 0x80089be4,
  fxStrike: 0x8009b774, projFile: 0x800897f8, projBuild: 0x80089844,
  overlaySpawn: 0x800930c0, overlayFree: 0x80093088, ready: 0x80044f3c,
  motionProbe: 0x8008695c,
};
const MANAGER_CELL = 0x8004b7bc;     // lu[i 0x8005]-0x4844: the manager-fetch cell
const READY_CELL = 0x80044f3c;       // lu[i 0x8004]+0x4f3c: the object-is-ready test cell

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

function runtime(): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  rt.cpu.setStub(FETCH, () => MEW);
  rt.mem.write32(MANAGER_CELL, FETCH);
  rt.mem.write32(READY_CELL, S.ready);
  for (const [off, addr] of [[0x100, S.cam100], [0x104, S.cam104], [0xf8, S.camF8], [0xfc, S.camFC], [0xe8, S.animE8]] as const) {
    rt.mem.write32(MEW + off, addr);
  }
  rt.mem.write32(ANIM + 0x188, S.anim188);
  rt.mem.write32(CHILD + 0x4c, S.destroy);
  rt.mem.write32(ACTOR + 0x88, ANIM);
  return rt;
}

function clearActor(rt: NativeStageRuntime): void {
  for (let i = 0; i < 0xc0; i += 4) rt.mem.write32(ACTOR + i, 0);
  rt.mem.write32(ACTOR + 0x88, ANIM);
}

/** Run the ORIGINAL handler with recording stubs; returns [calls, ipWords, ip, v0]. */
function runOriginal(
  name: keyof typeof H, words: number[], setup: (rt: NativeStageRuntime) => void,
): [string[], number, number, number] {
  const rt = runtime();
  const calls: string[] = [];
  const rec = (label: string) => (c: { reg(i: number): number }) => {
    calls.push(`${label}(a0=${c.reg(4) | 0})`);
    return 0x80109000;
  };
  for (const [addr, label] of [
    [A.alloc, "alloc"], [A.slotKey, "slotKey"], [A.fxPreload, "fxPreload"], [A.fxSpawn, "fxSpawn"],
    [A.fxStrike, "fxStrike"], [A.projFile, "projFile"], [A.projBuild, "projBuild"],
    [A.overlaySpawn, "overlaySpawn"], [A.overlayFree, "overlayFree"],
    [S.destroy, "destroy"], [S.anim188, "anim188"],
    [S.camF8, "camF8"], [S.camFC, "camFC"], [S.cam100, "cam100"], [S.cam104, "cam104"],
    [S.animE8, "animE8"], [S.ready, "ready"], [A.motionProbe, "motionProbe"],
  ] as const) rt.cpu.setStub(addr, rec(label));
  rt.cpu.setStub(A.projFile, (c) => { calls.push(`projFile(a0=${c.reg(4) | 0})`); return 7; });
  rt.cpu.setStub(A.projBuild, (c) => {
    const rv = (p: number) => [0, 1, 2].map((k) => rt.mem.read16s(p + k * 2) | 0);
    calls.push(`projBuild(a0=${c.reg(4) | 0},vecA=${rv(c.reg(5)).join(":")},vecB=${rv(c.reg(6)).join(":")})`);
    return 0x80109000;
  });
  rt.cpu.setStub(A.ready, () => 1);
  rt.cpu.setStub(S.ready, () => 1);
  for (let i = 0; i < words.length; i++) rt.mem.write16(P + i * 2, words[i]! & 0xffff);
  for (let i = 0; i < 0x40; i += 4) rt.mem.write32(CTX + i, 0);
  clearActor(rt);
  rt.mem.write32(ACTOR + 0x8c, P);
  setup(rt);
  const v0 = rt.cpu.call(H[name], [ACTOR, CTX], 300000) | 0;
  const ip = rt.mem.read32(ACTOR + 0x8c) >>> 0;
  return [calls, (ip - P) >> 1, ip, v0];
}

/** A recording host over the port's interface. `slotState` is what slotMotionState returns. */
function recordingHost(calls: string[], slotState = 0): ActionOpcodeHost & ReactionHost {
  const r = (label: string) => (...args: number[]) => {
    calls.push(`${label}(${args.map((a, i) => `a${i}=${a | 0}`).join(",")})`);
    return 0x80109000;
  };
  return {
    allocateActionActor: () => { calls.push("alloc()"); return CHILD; },
    destroyActionActor: (method: number, child: number) => calls.push(`destroy(a0=${method | 0},a1=${child | 0})`),
    managerFetch: () => MEW,
    slotKeyResolve: (actor, key) => { calls.push(`slotKey(a0=${actor | 0},a1=${key | 0})`); return ANIM; },
    animSlotResolve: (anim, key) => { calls.push(`anim188(a0=${anim | 0},a1=${key | 0})`); return 0x80109000; },
    animSlotPlace: () => {},
    slotMotionState: (obj) => { calls.push(`slotMotion(obj=${obj | 0})`); return slotState; },
    frameDelta: () => 1,
    effectPreload: (a, b, c, d) => { calls.push(`fxPreload(a0=${a | 0},a1=${b | 0},a2=${c | 0})`); return 1; },
    effectSpawn: (type, vecPtr) => { calls.push(`fxSpawn(a0=${type | 0})`); return 0x80109000; },
    effectStrike: (type) => { calls.push(`fxStrike(a0=${type | 0})`); return 0x80109000; },
    projectileFile: (id) => { calls.push(`projFile(a0=${id | 0})`); return 7; },
    projectileReady: () => 1,
    projectileBuild: (_entries, id, vecA, vecB) => {
      calls.push(`projBuild(a0=${id | 0},vecA=${vecA.join(":")},vecB=${vecB.join(":")})`);
      return 0x80109000;
    },
    cameraView: (_m, _cam, sub) => { calls.push(sub === 0 ? "camF8()" : "camFC()"); },
    cameraArm: (_m, method, _a1, a2) => {
      calls.push(method === 0x100 ? "cam100()" : `cam104(a2=${a2 | 0})`);
    },
    motionSelect: (_m, motion, a2, a3) => { calls.push(`animE8(a1=${motion | 0},a2=${a2 | 0},a3=${a3 | 0})`); },
    motionProbe: (motion) => { calls.push(`motionProbe(a0=${motion | 0})`); return 0x80109000; },
    motionReady: (obj) => { calls.push(`ready(a0=${obj | 0})`); return 1; },
    overlaySpawn: (arg) => { calls.push(`overlaySpawn(a0=${arg | 0})`); return 0x80109000; },
    overlayFree: (obj) => { calls.push(`overlayFree(a0=${obj | 0})`); },
  } as ActionOpcodeHost & ReactionHost;
}

function memOf(rt: NativeStageRuntime): ActionOpcodeMemory {
  return {
    read32: (a) => rt.mem.read32(a) | 0,
    read16s: (a) => rt.mem.read16s(a) | 0,
    write32: (a, v) => rt.mem.write32(a, v | 0),
  };
}

/** Run the PORT over a fresh copy of the same memory; returns [calls, ipWords, cont]. */
function runPort(
  op: keyof typeof H, words: number[], setup: (rt: NativeStageRuntime) => void,
  registry: ActionOpcodeRegistry, slotState = 0,
): [string[], number, number] {
  const rt = runtime();
  for (let i = 0; i < words.length; i++) rt.mem.write16(P + i * 2, words[i]! & 0xffff);
  for (let i = 0; i < 0x40; i += 4) rt.mem.write32(CTX + i, 0);
  clearActor(rt);
  rt.mem.write32(ACTOR + 0x8c, P);
  setup(rt);
  const calls: string[] = [];
  const host = recordingHost(calls, slotState);
  const mem = memOf(rt);
  let cont = 1;
  switch (op) {
    case "op1": cont = op1Handler(ACTOR, CTX, host, mem).cont; break;
    case "op2": cont = op2Handler(ACTOR, CTX, host, mem).cont; break;
    case "op3": cont = op3Handler(ACTOR, CTX, host, mem).cont; break;
    case "op4": cont = op4Handler(ACTOR, CTX, host, mem).cont; break;
    case "op5": cont = op5Handler(ACTOR, CTX, host, mem).cont; break;
    case "op6": cont = op6Handler(ACTOR, CTX, host, mem, registry).cont; break;
    case "op7": cont = op7Handler(ACTOR, CTX, host, mem).cont; break;
    case "op10": cont = op10Handler(ACTOR, CTX, host, mem).cont; break;
  }
  const ip = rt.mem.read32(ACTOR + 0x8c) >>> 0;
  return [calls, (ip - P) >> 1, cont];
}

const NO_REG: ActionOpcodeRegistry = { projectiles: [] };

// ── op1: subordinate action actor (reuses dispatchSubordinateActor) ─────────

test("op1 F0x8008b69c: mode 0 allocates a child and selects outcome+1", SKIP, () => {
  const setup = (rt: NativeStageRuntime) => { rt.mem.write32(ACTOR + 0x64, 2); };
  const [orig, oip] = runOriginal("op1", [0], setup);
  const [port, pip] = runPort("op1", [0], setup, NO_REG);
  assert.equal(pip, oip, "IP advance");
  assert.equal(port.length, orig.length, `calls: ${port} vs ${orig}`);
});

// ── op4: motion envelope (reuses op4MotionId) ────────────────────────────────

test("op4 F0x8008c2cc: sub 1 with a direct id probes the motion and yields", SKIP, () => {
  const setup = () => {};
  const [orig, oip] = runOriginal("op4", [1, 55], setup);
  const [port, pip] = runPort("op4", [1, 55], setup, NO_REG);
  assert.equal(pip, oip, "IP advance (both rewind and yield)");
  assert.ok(orig.some((c) => c.startsWith("motionProbe")), `original probed the motion: ${orig}`);
  assert.ok(port.some((c) => c.startsWith("motionProbe")), `port probed the motion: ${port}`);
});

// ── op6: projectile (reuses newProjectileFlight / projectileFileForId) ───────

test("op6 F0x8008bea8: sub 0 spawns a flight object with the two vectors", SKIP, () => {
  const setup = () => {};
  const words = [0, 2, 10, 20, 30, 40, 50, 60];
  const [orig, oip] = runOriginal("op6", words, setup);
  const [port, pip] = runPort("op6", words, setup, NO_REG);
  assert.equal(pip, oip, "IP advance");
  const ob = orig.find((c) => c.startsWith("projBuild"));
  const pb = port.find((c) => c.startsWith("projBuild"));
  assert.ok(ob, `original called projBuild: ${orig}`);
  assert.equal(pb, ob, `the port's flight build equals the original's (port ${pb})`);
});

test("op6 sub 1 polls the registry file id (yields while unready)", SKIP, () => {
  const ready = (rt: NativeStageRuntime) => { rt.mem.write32(READY_CELL, 0); clearActor(rt); rt.mem.write32(ACTOR + 0x8c, P); rt.cpu.setStub(0x80106124, () => 0); };
  const [orig] = runOriginal("op6", [1, 3], () => {});
  const [port] = runPort("op6", [1, 3], () => {}, NO_REG);
  assert.ok(orig.some((c) => c.startsWith("projFile")), `original polled projFile: ${orig}`);
  assert.ok(port.some((c) => c.startsWith("projFile")), `port polled projFile: ${port}`);
});

// ── op7: slot overlay spawn/free ─────────────────────────────────────────────

test("op7 F0x8008c514: type 0 spawns an overlay into ctx+0", SKIP, () => {
  const [orig, oip] = runOriginal("op7", [0, 7], () => {});
  const [port, pip] = runPort("op7", [0, 7], () => {}, NO_REG);
  assert.equal(pip, oip, "IP advance");
  assert.deepEqual(port, orig, `the port's target calls equal the original's`);
});

// ── op10: strike effect ──────────────────────────────────────────────────────

test("op10 F0x8008c454: spawns the strike effect once", SKIP, () => {
  const [orig, oip] = runOriginal("op10", [99, 0], () => {});
  const [port, pip] = runPort("op10", [99, 0], () => {}, NO_REG);
  assert.equal(pip, oip, "IP advance");
  assert.deepEqual(port, orig, `the port's strike calls equal the original's`);
});

// ── op5: camera preset + view ────────────────────────────────────────────────

test("op5 F0x8008c004: mode 0 preset selects the view method", SKIP, () => {
  const [orig, oip] = runOriginal("op5", [0, 0, 3], () => {});
  const [port, pip] = runPort("op5", [0, 0, 3], () => {}, NO_REG);
  assert.equal(pip, oip, "IP advance");
  assert.ok(orig.some((c) => c.startsWith("cam104")) && port.some((c) => c.startsWith("cam104")),
    `calls: ${port} vs ${orig}`);
  assert.ok(orig.some((c) => c.startsWith("camF8")) && port.some((c) => c.startsWith("camF8")),
    `view: ${port} vs ${orig}`);
});

// ── op2: slot motion controller ──────────────────────────────────────────────

test("op2 F0x8008b7f4: mode 1 resolves the slot and returns", SKIP, () => {
  const [orig, oip] = runOriginal("op2", [1, 0], () => {});
  const [port, pip] = runPort("op2", [1, 0], () => {}, NO_REG);
  assert.equal(pip, oip, "IP advance");
  assert.equal(port.length, orig.length, `calls: ${port} vs ${orig}`);
});

// ── op2: the mode-5 sub-0 record BLOCK (the cursor protocol) ─────────────────
// The block decision and its rewind live in the handler (asm .L0x8008b958 →
// .L0x8008bb04): with a slot-motion object at ctx+0x4 whose state +0xc is < 2 the
// handler returns v0 = 0 and rewinds IP to the record's opcode word.

test("op2 F0x8008b7f4: mode 5 sub 0 BLOCKS (cont 0, IP rewinds to the opcode word) while the slot motion state is < 2", SKIP, () => {
  const armed = (rt: NativeStageRuntime) => {
    rt.mem.write32(CTX + 0x4, 0x8010e000);
    rt.mem.write32(0x8010e000 + 0xc, 1);         // the slot-motion object's state < 2
  };
  const [orig, oip, , ov0] = runOriginal("op2", [5, 0, 0], armed);
  const [port, pip, pv0] = runPort("op2", [5, 0, 0], armed, NO_REG, 1);
  assert.equal(ov0, 0, "the original yields (v0 = 0)");
  assert.equal(pv0, 0, "the port yields (cont = 0)");
  assert.equal(oip, -1, "the original rewound to the record's opcode word");
  assert.equal(pip, oip, `the port's IP advance/rewind equals the original's (${port})`);
  assert.ok(port.some((c) => c.startsWith("slotMotion")), `the port read the object's state: ${port}`);
});

test("op2 F0x8008b7f4: mode 5 sub 0 CONTINUES when the slot motion state is >= 2 or ctx+0x4 is null", SKIP, () => {
  const released = (rt: NativeStageRuntime) => {
    rt.mem.write32(CTX + 0x4, 0x8010e000);
    rt.mem.write32(0x8010e000 + 0xc, 2);
  };
  const [orig, oip, , ov0] = runOriginal("op2", [5, 0, 0], released);
  const [port, pip, pv0] = runPort("op2", [5, 0, 0], released, NO_REG, 2);
  assert.equal(ov0, 1, "state >= 2 releases in the original");
  assert.equal(pv0, 1, "and in the port");
  assert.equal(pip, oip, "IP advance");
  assert.equal(oip, 3, "the record's forward advance is its 3 operand words");

  const none = () => {};
  const [orig2, oip2, , ov2] = runOriginal("op2", [5, 0, 0], none);
  const [port2, pip2, pv2] = runPort("op2", [5, 0, 0], none, NO_REG, 0);
  assert.equal(ov2, 1, "a null slot-motion object releases at once (asm .L0x8008b960)");
  assert.equal(pv2, 1);
  assert.equal(pip2, oip2, `IP advance (${port2})`);
});

// ── op2: the mode-0 sub-0 record BLOCK (the bound-table wait) ────────────────
// Mode 0 with a zero third word is the bound-table wait (asm .L0x8008c44): the
// handler reads the anim slot's own done-flag +0x10; while it is zero it returns
// v0 = 0 and rewinds IP 8 bytes to the record's opcode word (asm .L0x8008e54).

test("op2 F0x8008b7f4: mode 0 sub 0 BLOCKS (cont 0, IP rewinds to the opcode word) while the slot done-flag is clear", SKIP, () => {
  const notDone = (rt: NativeStageRuntime) => {
    // the anim object's +0x188 stub returns 0x80109000 (see the anim188 recording stub)
    rt.mem.write32(0x80109000 + 0x10, 0);
  };
  const [orig, oip, , ov0] = runOriginal("op2", [0, 0, 0], notDone);
  const [port, pip, pv0] = runPort("op2", [0, 0, 0], notDone, NO_REG);
  assert.equal(ov0, 0, "the original yields (v0 = 0)");
  assert.equal(pv0, 0, "the port yields (cont = 0)");
  assert.equal(oip, -1, "the original rewound to the record's opcode word");
  assert.equal(pip, oip, `the port's IP advance/rewind equals the original's (${port})`);
});

test("op2 F0x8008b7f4: mode 0 sub 0 CONTINUES once the slot done-flag is set", SKIP, () => {
  const done = (rt: NativeStageRuntime) => { rt.mem.write32(0x80109000 + 0x10, 1); };
  const [orig, oip, , ov0] = runOriginal("op2", [0, 0, 0], done);
  const [port, pip, pv0] = runPort("op2", [0, 0, 0], done, NO_REG);
  assert.equal(ov0, 1, "the original continues (v0 = 1)");
  assert.equal(pv0, 1, "the port continues (cont = 1)");
  assert.equal(oip, 3, "the record's forward advance is its 3 operand words");
  assert.equal(pip, oip, `the port's IP advance equals the original's (${port})`);
});

test("op2 F0x8008b7f4: mode 0 sub 0 with a nonzero third word rebinds (no wait)", SKIP, () => {
  // op3 > 0 rebinds the table and clears the done-flag: the wait is not taken even with
  // the flag clear. The browser performs the bind itself, so the port reports continue.
  const notDone = (rt: NativeStageRuntime) => { rt.mem.write32(0x80109000 + 0x10, 0); };
  const [orig, oip, , ov0] = runOriginal("op2", [0, 0, 7], notDone);
  const [port, pip, pv0] = runPort("op2", [0, 0, 7], notDone, NO_REG);
  assert.equal(ov0, 1, "a nonzero third word continues in the original");
  assert.equal(pv0, 1, "and in the port");
  assert.equal(pip, oip, `IP advance (${port})`);
});

test("negative control: clearing vs setting the slot done-flag flips op2 mode 0's decision", SKIP, () => {
  const clear = (rt: NativeStageRuntime) => { rt.mem.write32(0x80109000 + 0x10, 0); };
  const set = (rt: NativeStageRuntime) => { rt.mem.write32(0x80109000 + 0x10, 1); };
  const blocked = runPort("op2", [0, 0, 0], clear, NO_REG);
  const released = runPort("op2", [0, 0, 0], set, NO_REG);
  assert.equal(blocked[2], 0, "a clear done-flag blocks");
  assert.equal(released[2], 1, "a set done-flag releases");
  assert.notEqual(blocked[1], released[1], "the cursor rewind must differ too");
  assert.notDeepEqual(blocked, released, "the two flag values must produce different results");
});

// ── op3: visual effect ───────────────────────────────────────────────────────

test("op3 F0x8008bc80: sub 0 spawns an effect of the resolved type", SKIP, () => {
  const [orig, oip] = runOriginal("op3", [0, 5, 1, 2, 3], () => {});
  const [port, pip] = runPort("op3", [0, 5, 1, 2, 3], () => {}, NO_REG);
  assert.equal(pip, oip, "IP advance");
  assert.deepEqual(port, orig, `the port's effect calls equal the original's`);
});

// The 9999 (0x270f) sentinel reads the actor's CURRENT-EFFECT field at +0x6c — the field
// F0x8008ee84 state 1 fills from the tech record's +0x0e byte (fightstg.s .L0x8008f2ec-:
// .L0x8008f320). The contact-sound field the op10 strike reads is a DIFFERENT word, +0x70
// (F0x8008c454 @.L0x8008c4b0/.L0x8008c4d4: `lw $a0, 0x70($a2)`). The port used one constant
// (0x70) for both; the browser masked that by writing the same value to both fields, so this
// seeds ONLY +0x6c and lets the original and the port disagree if the field is wrong.
test("op3 F0x8008bc80: the 9999 sentinel reads the CURRENT-EFFECT field +0x6c, not +0x70", SKIP, () => {
  const seed = (rt: NativeStageRuntime) => {
    rt.mem.write32(ACTOR + 0x6c, 42);   // the current-effect field
    rt.mem.write32(ACTOR + 0x70, 77);   // the contact-sound field must NOT be read
  };
  const [orig, oip] = runOriginal("op3", [0, 9999, 1, 2, 3], seed);
  const [port, pip] = runPort("op3", [0, 9999, 1, 2, 3], seed, NO_REG);
  assert.equal(pip, oip, "IP advance");
  assert.ok(orig.includes("fxSpawn(a0=42)"), `the original spawns the +0x6c type: ${orig}`);
  assert.ok(!orig.includes("fxSpawn(a0=77)"), `the original never reads +0x70 here: ${orig}`);
  assert.deepEqual(port, orig, `the port's effect calls equal the original's`);
});

// ── negative control: the oracle discriminates ───────────────────────────────

test("negative control: a mutated op6 id changes the port's recorded argument", SKIP, () => {
  // The original id is read from word 1; flipping it must change what the port
  // passes to newProjectileFlight, so a stale/constant port would be caught.
  const good = runPort("op6", [0, 2, 10, 20, 30, 40, 50, 60], () => {}, NO_REG);
  const bad = runPort("op6", [0, 9, 10, 20, 30, 40, 50, 60], () => {}, NO_REG);
  assert.ok(good[0].some((c) => c === "projBuild(a0=2,vecA=10:-20:-30,vecB=40:-50:-60)"), `good: ${good[0]}`);
  assert.ok(bad[0].some((c) => c.startsWith("projBuild(a0=9,")), `bad: ${bad[0]}`);
  assert.notDeepEqual(good[0], bad[0], "a mutated id must produce different calls");
});
