// Oracle for the effect object family driver's shared dispatch
// (engine/dw3/battle-effect-driver.ts).
//
// The check runs the ORIGINAL instruction words out of the committed fightstg
// overlay image (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0)
// through engine/native and observes WHICH entry the driver jumps to for a given
// state/substate, comparing it to the port. Each candidate entry is a stub that
// records its own address; the body it would run is out of scope (see the module
// header). A negative control in each case proves the comparison catches a wrong port.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  EFFECT_DRIVER_ENTRY_CONSTRUCT, EFFECT_DRIVER_ENTRY_PROGRAM, EFFECT_DRIVER_ENTRY_RETURN,
  EFFECT_DRIVER_STAGE_DEFAULT, EFFECT_DRIVER_STAGE_SETUP, EFFECT_DRIVER_STAGE_MODE2, EFFECT_DRIVER_STAGE_MODE3,
  EFFECT_DRIVER_SUBSTATE_HANDLERS,
  effectDriverEntryTarget, effectDriverStageTarget, effectDriverProgramTarget,
} from "../../../engine/dw3/battle-effect-driver.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const DRIVER = 0x80089cd8;
const OBJ = 0x80100000;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

/** Build a runtime with the given entries stubbed; each records its own address. */
function runtime(stubAddrs: readonly number[], entered: { at: number | null }): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  for (const addr of stubAddrs) {
    rt.cpu.setStub(addr, () => { entered.at = addr; return 0; });
  }
  return rt;
}

/** Seed the driver object: state at +0x0c, substate at +0x10. */
function seedDriver(rt: NativeStageRuntime, state: number, substate: number): void {
  rt.mem.write32(OBJ + 0x0c, state | 0);
  rt.mem.write32(OBJ + 0x10, substate | 0);
}

// ── 1. the +0x0c entry dispatch (L7068-L7074) ────────────────────────────────

const ENTRY_ADDR: Record<string, number> = {
  construct: EFFECT_DRIVER_ENTRY_CONSTRUCT,
  program: EFFECT_DRIVER_ENTRY_PROGRAM,
  return: EFFECT_DRIVER_ENTRY_RETURN,
};

test("F0x80089cd8 entry dispatch: state 0/1/2/3/>=4 select the ported entry", SKIP, () => {
  for (const state of [0, 1, 2, 3, 4, 5, -1]) {
    const entered = { at: null as number | null };
    const rt = runtime([EFFECT_DRIVER_ENTRY_CONSTRUCT, EFFECT_DRIVER_ENTRY_PROGRAM, EFFECT_DRIVER_ENTRY_RETURN], entered);
    seedDriver(rt, state, 0);
    rt.cpu.call(DRIVER, [OBJ, 0], 200000);
    const port = ENTRY_ADDR[effectDriverEntryTarget(state)]!;
    assert.equal(entered.at, port, `state ${state}: original entry == port entry`);
  }
});

test("F0x80089cd8 entry dispatch: state 1 is the jump-table block, not the eval block", SKIP, () => {
  const entered = { at: null as number | null };
  const rt = runtime([EFFECT_DRIVER_ENTRY_CONSTRUCT, EFFECT_DRIVER_ENTRY_PROGRAM, EFFECT_DRIVER_ENTRY_RETURN], entered);
  seedDriver(rt, 1, 0);
  rt.cpu.call(DRIVER, [OBJ, 0], 200000);
  assert.equal(entered.at, EFFECT_DRIVER_ENTRY_PROGRAM);
  // Negative control: state 0 goes to the OTHER block.
  const entered0 = { at: null as number | null };
  const rt0 = runtime([EFFECT_DRIVER_ENTRY_CONSTRUCT, EFFECT_DRIVER_ENTRY_PROGRAM, EFFECT_DRIVER_ENTRY_RETURN], entered0);
  seedDriver(rt0, 0, 0);
  rt0.cpu.call(DRIVER, [OBJ, 0], 200000);
  assert.notEqual(entered0.at, entered.at);
});

// ── 2. the state-0 construct-stage dispatch (L7075-L7084) ─────────────────────

const STAGE_ADDR: Record<string, number> = {
  default: EFFECT_DRIVER_STAGE_DEFAULT,
  setup: EFFECT_DRIVER_STAGE_SETUP,
  mode2: EFFECT_DRIVER_STAGE_MODE2,
  mode3: EFFECT_DRIVER_STAGE_MODE3,
};

test("F0x80089cd8 construct dispatch: substate 0/1/2/3/>=4 select the ported stage", SKIP, () => {
  // d28 itself is NOT stubbed, so the original runs it and jumps to the stage.
  for (const substate of [0, 1, 2, 3, 4, 5, -1]) {
    const entered = { at: null as number | null };
    const rt = runtime([EFFECT_DRIVER_STAGE_DEFAULT, EFFECT_DRIVER_STAGE_SETUP, EFFECT_DRIVER_STAGE_MODE2, EFFECT_DRIVER_STAGE_MODE3], entered);
    seedDriver(rt, 0, substate);
    rt.cpu.call(DRIVER, [OBJ, 0], 200000);
    const port = STAGE_ADDR[effectDriverStageTarget(substate)]!;
    assert.equal(entered.at, port, `substate ${substate}: original stage == port stage`);
  }
});

test("F0x80089cd8 construct dispatch: a substate of 4 falls to the default stage", SKIP, () => {
  const entered = { at: null as number | null };
  const rt = runtime([EFFECT_DRIVER_STAGE_DEFAULT, EFFECT_DRIVER_STAGE_SETUP, EFFECT_DRIVER_STAGE_MODE2, EFFECT_DRIVER_STAGE_MODE3], entered);
  seedDriver(rt, 0, 4);
  rt.cpu.call(DRIVER, [OBJ, 0], 200000);
  assert.equal(entered.at, EFFECT_DRIVER_STAGE_DEFAULT);
  // Negative control: substate 3 does NOT go to the default.
  assert.notEqual(effectDriverStageTarget(3), "default");
});

// ── 3. the state-1 fifteen-entry jump table (L7201-L7212) ────────────────────

test("F0x80089cd8 program dispatch: every substate 0..14 runs its own handler", SKIP, () => {
  for (let substate = 0; substate < 15; substate++) {
    const entered = { at: null as number | null };
    const rt = runtime(EFFECT_DRIVER_SUBSTATE_HANDLERS, entered);
    seedDriver(rt, 1, substate);
    rt.cpu.call(DRIVER, [OBJ, 0], 200000);
    assert.equal(entered.at, effectDriverProgramTarget(substate), `substate ${substate}`);
    assert.equal(entered.at, EFFECT_DRIVER_SUBSTATE_HANDLERS[substate], `substate ${substate} == table entry`);
  }
});

test("F0x80089cd8 program dispatch: substate 15 and above runs the handler-0 default", SKIP, () => {
  for (const substate of [15, 16, 100, -1]) {
    const entered = { at: null as number | null };
    const rt = runtime(EFFECT_DRIVER_SUBSTATE_HANDLERS, entered);
    seedDriver(rt, 1, substate);
    rt.cpu.call(DRIVER, [OBJ, 0], 200000);
    // The unsigned sltiu sends these to f50, which is handler 0.
    assert.equal(entered.at, EFFECT_DRIVER_SUBSTATE_HANDLERS[0]!, `substate ${substate} -> default`);
    assert.equal(effectDriverProgramTarget(substate), EFFECT_DRIVER_SUBSTATE_HANDLERS[0]!);
  }
  // Negative control: substate 14 is NOT the default.
  assert.notEqual(effectDriverProgramTarget(14), EFFECT_DRIVER_SUBSTATE_HANDLERS[0]);
  assert.equal(effectDriverProgramTarget(14), 0x8008a6c8);
});
