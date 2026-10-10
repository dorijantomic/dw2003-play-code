// Oracle for the animator constructor wrapper FIGHTSTG_F0x800847c4
// (engine/dw3/battle-mesh.ts, createLayerFigureThunk).
//
// The wrapper forwards its a0-a3 and its fifth (stack) argument unchanged into the
// layer-figure builder F0x80084560, and zeroes the builder's sixth argument. The check runs
// the ORIGINAL wrapper words out of the committed fightstg overlay image
// (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0) through engine/native with
// F0x80084560 stubbed to record the argument block it receives, and compares that block to
// the port's `layerFigureThunkArgs`. A mutation control proves the comparison discriminates.
//
// The address is mis-attributed to cardgame.norm.s by the disassembler (shared load base);
// these words are the fight overlay's own, and the test reads them from the disc.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import { LAYER_FIGURE_THUNK, layerFigureThunkArgs, type LayerFigureThunkArgs } from "../../../engine/dw3/battle-mesh.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const available = existsSync(BIN);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const BUILDER = 0x80084560;
const STUB = 0x801f0000;

const overlay = available ? readFileSync(BIN) : Buffer.alloc(0);

interface Block { a0: number; a1: number; a2: number; a3: number; arg5: number; arg6: number }

/** Run the original wrapper with the builder stubbed; return the block the builder received. */
function runOriginal(a: LayerFigureThunkArgs, stackArg: number): Block {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
  );
  let block: Block | null = null;
  rt.cpu.setStub(BUILDER, () => {
    const sp = rt.cpu.reg(29) >>> 0;
    block = {
      a0: rt.cpu.reg(4) | 0, a1: rt.cpu.reg(5) | 0, a2: rt.cpu.reg(6) | 0, a3: rt.cpu.reg(7) | 0,
      arg5: rt.mem.read32(sp + 0x10) | 0, arg6: rt.mem.read32(sp + 0x14) | 0,
    };
    return 0x1234;
  });
  // The caller's stack argument (the wrapper reads it from its own 0x30(sp)).
  rt.mem.write32((rt.cpu.sp >>> 0) + 0x10, stackArg | 0);
  rt.cpu.call(LAYER_FIGURE_THUNK, [a.arg0, a.arg1, a.arg2, a.arg3], 100000);
  assert.ok(block, "the wrapper must reach the builder");
  return block as Block;
}

const ARGS: LayerFigureThunkArgs = { arg0: 0x8000aaaa, arg1: 0x1111, arg2: 0x2222, arg3: 0x3333, arg4: 0x4444 };

test("F0x800847c4 forwards a0-a3 and its stack arg, and zeroes the sixth", SKIP, () => {
  const got = runOriginal(ARGS, 0x4444);
  const want = layerFigureThunkArgs(ARGS);
  assert.equal(got.a0 >>> 0, want.arg0 >>> 0, "a0");
  assert.equal(got.a1 >>> 0, want.arg1 >>> 0, "a1");
  assert.equal(got.a2 >>> 0, want.arg2 >>> 0, "a2");
  assert.equal(got.a3 >>> 0, want.arg3 >>> 0, "a3");
  assert.equal(got.arg5 >>> 0, want.arg4 >>> 0, "the fifth arg is forwarded");
  assert.equal(got.arg6 | 0, want.arg5 | 0, "the sixth arg is zeroed");
  assert.equal(want.arg5, 0, "the port forces arg5 = 0");
});

test("mutation control: a port that forwarded the sixth arg or kept its own arg4 diverges", SKIP, () => {
  const got = runOriginal(ARGS, 0x9999);
  assert.equal(got.arg5 >>> 0, 0x9999, "the wrapper forwards its stack arg verbatim");
  // A port that passed the caller's stack arg into arg5 instead of arg4 would differ.
  const wrong = { ...layerFigureThunkArgs(ARGS), arg4: got.arg6 };
  assert.notDeepEqual(wrong, layerFigureThunkArgs(ARGS));
  assert.throws(() => assert.equal(wrong.arg4, got.arg5), "arg4 must come from the stack arg");
});
