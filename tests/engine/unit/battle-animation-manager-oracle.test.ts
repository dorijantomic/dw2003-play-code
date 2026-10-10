// Oracle for the animation manager's own method +0xe8
// (engine/dw3/battle-animation-manager.ts, animManagerSelectMotion).
//
// The ORIGINAL instruction words of FIGHTSTG_F0x800868c0 run out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native. Its single callee — the manager's own +0x28
// base-object set-state entry (FIGHTSTG_F0x80014274) — is reached through a stub
// that RUNS the ported baseObjectSetState, so both the select's four stores and
// the set-state's four stores land in the compared write trace. The port runs the
// same way against a fresh arena. A mutation control proves the comparison
// discriminates.
//
// Constructor-installed methods are absent from the disassembler's function-start
// list; this routine was read from the overlay ASSEMBLY, and its address bytes are
// the fight overlay's own (the shared 0x80082cb0 base also names cardgame).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  animManagerSelectMotion, ANIM_MGR_MOTION, ANIM_MGR_PREV_MOTION,
  ANIM_MGR_ARG2, ANIM_MGR_ARG3, ANIM_MGR_RESTART_STATE, type AnimManagerMemory,
} from "../../../engine/dw3/battle-animation-manager.ts";
import { baseObjectSetState, type EffectDriverMem } from "../../../engine/dw3/battle-effect-driver-host.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const available = existsSync(BIN);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const SELECT = 0x800868c0;
const MGR = 0x80100000;
const STUB = 0x801f0000;
const WRITE_LEN = 0x100;

const overlay = available ? readFileSync(BIN) : Buffer.alloc(0);

type Write = [number, number, number];
type Call = { site: string; args: number[] };

/** Seed the manager: current motion, plus sentinels everywhere the select writes. */
function seed(m: { write32(a: number, v: number): void }, cur: number, methodPtr: number): void {
  m.write32(MGR + 0x0c, 0x0aa);
  m.write32(MGR + 0x10, 0x0bb); m.write32(MGR + 0x14, 0x0cc); m.write32(MGR + 0x18, 0x0dd);
  m.write32(MGR + ANIM_MGR_MOTION, cur);
  m.write32(MGR + ANIM_MGR_PREV_MOTION, 0x999);
  m.write32(MGR + ANIM_MGR_ARG2, 0x888);
  m.write32(MGR + ANIM_MGR_ARG3, 0x777);
  m.write32(MGR + 0x28, methodPtr);
}

/** Run the ORIGINAL select with its +0x28 entry stubbed to the ported set-state. */
function runOriginal(motion: number, a2: number, a3: number, cur: number): { writes: Write[]; calls: Call[] } {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
  );
  const mem = rt.mem;
  const calls: Call[] = [];
  rt.cpu.setStub(STUB, (cpu) => {
    const a0 = cpu.reg(4) >>> 0, a1 = cpu.reg(5) >>> 0;
    calls.push({ site: "mgr+0x28", args: [a0, a1] });
    baseObjectSetState(mem as unknown as EffectDriverMem, a0 | 0, a1 | 0);
    return 0;
  });
  seed(mem, cur, STUB);
  const writes: Write[] = [];
  mem.onWrite = (_pc, addr, size, value) => {
    if (addr >>> 0 >= MGR && (addr >>> 0) < MGR + WRITE_LEN) writes.push([addr >>> 0, size, value >>> 0]);
  };
  rt.cpu.call(SELECT, [MGR, motion, a2, a3], 200000);
  mem.onWrite = null;
  return { writes, calls };
}

class MemMap implements AnimManagerMemory {
  private readonly m = new Map<number, number>();
  read32(a: number): number { return this.m.get(a >>> 0) ?? 0; }
  write32(a: number, v: number): void { this.m.set(a >>> 0, v | 0); }
}

/** Run the PORT with the same seeds and the same set-state implementation. */
function runPort(motion: number, a2: number, a3: number, cur: number): { writes: Write[]; calls: Call[] } {
  const M = new MemMap();
  seed(M, cur, 0); // the port does not read +0x28; the set-state is injected
  const calls: Call[] = [];
  const writes: Write[] = [];
  const proxy: AnimManagerMemory = {
    read32: (a) => M.read32(a),
    write32: (a, v) => {
      M.write32(a, v);
      if ((a >>> 0) >= MGR && (a >>> 0) < MGR + WRITE_LEN) writes.push([a >>> 0, 4, v >>> 0]);
    },
  };
  animManagerSelectMotion(proxy, {
    setState: (mgr, st) => {
      calls.push({ site: "mgr+0x28", args: [mgr >>> 0, st >>> 0] });
      // The ported +0x28 is the shared base-object set-state; drive it through a
      // recording proxy so its four stores join the trace in order.
      const p = {
        write32: (a: number, v: number) => { proxy.write32(a, v); },
      };
      baseObjectSetState(p as unknown as EffectDriverMem, mgr, st);
    },
  }, MGR, motion, a2, a3);
  return { writes, calls };
}

test("anim manager +0xe8: a changed motion drives the original words and the port identically", SKIP, () => {
  const o = runOriginal(0x1c, 0x20, 0x20, 0x5);
  const p = runPort(0x1c, 0x20, 0x20, 0x5);
  assert.deepEqual(p.writes, o.writes, "write trace");
  assert.deepEqual(p.calls, o.calls, "the +0x28 set-state call");
  assert.deepEqual(o.calls, [{ site: "mgr+0x28", args: [MGR >>> 0, ANIM_MGR_RESTART_STATE] }]);
  // The four select stores plus the four set-state stores, in order.
  assert.deepEqual(o.writes.map((w) => w[0] - MGR), [0x54, 0x50, 0xb0, 0xac, 0x0c, 0x10, 0x14, 0x18]);
});

test("anim manager +0xe8: a request for the current motion does nothing", SKIP, () => {
  const o = runOriginal(0x20, 0x20, 0x20, 0x20);
  const p = runPort(0x20, 0x20, 0x20, 0x20);
  assert.deepEqual(o.writes, [], "the original writes nothing");
  assert.deepEqual(o.calls, [], "the original calls nothing");
  assert.deepEqual(p.writes, o.writes);
  assert.deepEqual(p.calls, o.calls);
});

test("anim manager +0xe8 oracle discriminates a WRONG port (mutation control)", SKIP, () => {
  const o = runOriginal(0x1c, 0x20, 0x20, 0x5);
  // A port that stored the OLD motion at +0x50 (or forgot the park at +0x54) diverges.
  const mutated = o.writes.map(([a, s, v]) => (a === MGR + 0x54 ? [a, s, 0] as Write : [a, s, v] as Write));
  assert.notDeepEqual(mutated, o.writes, "the comparison must catch a wrong +0x54 store");
  assert.deepEqual(runPort(0x1c, 0x20, 0x20, 0x5).writes, o.writes);
});
