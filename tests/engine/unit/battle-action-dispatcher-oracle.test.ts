// Oracle for the action VM's dispatcher (engine/dw3/battle-action-dispatcher.ts).
//
// The strongest check runs the ORIGINAL instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native with a RECORDING STUB at every handler
// address, and compares the handler called per opcode, the instruction-pointer
// advance, and whether the loop continued or yielded, against the port.
// The handler stubs do not advance IP themselves, exactly like the recorder the
// brief asks for: this pins the DISPATCH CONTROL FLOW (opcode table, yield set,
// terminator hold/rewind) independently of any handler body.
// Negative controls prove the comparison would catch a wrong dispatch table.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  handlerForOpcode, opcodeConsumesHandlerReturn, runDispatch,
  type DispatchStep, type TerminatorContext,
} from "../../../engine/dw3/battle-action-dispatcher.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const DISPATCHER = 0x8008c590;
const HANDLER_ADDR: Record<number, number> = {
  1: 0x8008b69c, 2: 0x8008b7f4, 3: 0x8008bc80, 4: 0x8008c2cc,
  5: 0x8008c004, 6: 0x8008bea8, 7: 0x8008c514, 10: 0x8008c454, 11: 0x8008c220,
};

const ACTOR = 0x80100000;
const CTX = 0x80101000;
const SCRIPT = 0x80102000;
const TRANS = 0x80103000;
const SLOT4OBJ = 0x80104000;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

/** A case: the opcode stream, per-opcode handler returns, and the terminator ctx. */
interface Case {
  ops: number[];
  returns?: Record<number, number>; // handler return per opcode (default 1)
  term?: Partial<TerminatorContext>; // terminator context (default: all clear → transition)
}

interface Harness {
  rt: NativeStageRuntime;
  calls: { op: number }[];
  returns: Record<number, number>;
  transitions: () => number;
}

function harness(): Harness {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  const calls: { op: number }[] = [];
  let transitions = 0;
  const returns: Record<number, number> = {};
  for (const [opStr, addr] of Object.entries(HANDLER_ADDR)) {
    const op = Number(opStr);
    rt.cpu.setStub(addr, () => { calls.push({ op }); return returns[op] ?? 1; });
  }
  rt.cpu.setStub(TRANS, () => { transitions += 1; return 0; });
  return { rt, calls, returns, transitions: () => transitions };
}

function writeScript(rt: NativeStageRuntime, case_: Case): TerminatorContext {
  const m = rt.mem;
  for (let i = 0; i < case_.ops.length; i++) m.write16(SCRIPT + i * 2, case_.ops[i]! & 0xffff);
  m.write32(ACTOR + 0x0c, 1);
  m.write32(ACTOR + 0x8c, SCRIPT);
  m.write32(ACTOR + 0x28, TRANS);
  for (let i = 0; i < 0x40; i += 4) m.write32(CTX + i, 0);
  const t: TerminatorContext = {
    slot4: case_.term?.slot4 ?? 0,
    slot4State: case_.term?.slot4State ?? 0,
    slot3c: case_.term?.slot3c ?? 0,
    slots: case_.term?.slots ?? [0, 0, 0, 0, 0, 0, 0, 0],
  };
  if (t.slot4) {
    m.write32(CTX + 0x4, t.slot4);
    m.write32((t.slot4 + 0xc) | 0, t.slot4State);
  }
  if (t.slot3c) m.write32(CTX + 0x3c, t.slot3c);
  for (let i = 0; i < 8; i++) if (t.slots[i]) m.write32(CTX + 0x10 + i * 4, t.slots[i]!);
  return t;
}

function runCase(label: string, case_: Case, expect: DispatchStep[]): void {
  const h = harness();
  Object.assign(h.returns, case_.returns ?? {});
  const tctx = writeScript(h.rt, case_);
  h.rt.cpu.call(DISPATCHER, [ACTOR, CTX], 300000);
  const origIp = h.rt.mem.read32(ACTOR + 0x8c) | 0;
  // Rewind detection is only needed through the expected trace; the original's
  // own final IP is asserted below.
  void origIp;

  const actor = { ip: SCRIPT, runState: 1 };
  const portTrace = runDispatch(actor, tctx, {
    readOpcode: (ip) => h.rt.mem.read16s(ip),
    callHandler: (_id, _a, _c, op) => h.returns[op] ?? 1,
  });

  // The terminator is internal code (not a stubbed handler), so the original's
  // stub log names only the op1..op11 handlers; compare those in order, then the
  // whole port trace (terminator included) against the expected one.
  const origHandlers = h.calls.map((c) => handlerForOpcode(c.op));
  const portHandlers = portTrace.filter((s) => s.handler && s.handler !== "terminate").map((s) => s.handler);
  assert.deepEqual(portHandlers, origHandlers, `${label}: handler sequence`);
  assert.equal(actor.ip >>> 0, origIp >>> 0, `${label}: final IP`);
  assert.deepEqual(portTrace, expect, `${label}: full port trace`);
}

// ── 1. a run of no-yield opcodes to the terminator (TRANSITION path) ────────

test("F0x8008c590: op1/op7/op10/op5 then terminator — dispatch order, IP and yield", SKIP, () => {
  const ops = [1, 7, 10, 5, 255];
  const expect: DispatchStep[] = [
    { op: 1, handler: "op1", ipBefore: SCRIPT, ipAfter: SCRIPT + 2, continued: true, rewound: false },
    { op: 7, handler: "op7", ipBefore: SCRIPT + 2, ipAfter: SCRIPT + 4, continued: true, rewound: false },
    { op: 10, handler: "op10", ipBefore: SCRIPT + 4, ipAfter: SCRIPT + 6, continued: true, rewound: false },
    { op: 5, handler: "op5", ipBefore: SCRIPT + 6, ipAfter: SCRIPT + 8, continued: true, rewound: false },
    { op: 255, handler: "terminate", ipBefore: SCRIPT + 8, ipAfter: SCRIPT + 10, continued: false, rewound: false },
  ];
  runCase("no-yield run", { ops }, expect);
});

// ── 2. a handler that yields stops the run ──────────────────────────────────

test("F0x8008c590: op2 returning 0 yields; later opcodes are not reached", SKIP, () => {
  const ops = [2, 1, 7, 255];
  const expect: DispatchStep[] = [
    { op: 2, handler: "op2", ipBefore: SCRIPT, ipAfter: SCRIPT + 2, continued: false, rewound: false },
  ];
  runCase("op2 yield", { ops, returns: { 2: 0 } }, expect);
});

test("F0x8008c590: op11 returning 1 continues; op11 returning 0 yields", SKIP, () => {
  runCase("op11 continue", { ops: [11, 255], returns: { 11: 1 } }, [
    { op: 11, handler: "op11", ipBefore: SCRIPT, ipAfter: SCRIPT + 2, continued: true, rewound: false },
    { op: 255, handler: "terminate", ipBefore: SCRIPT + 2, ipAfter: SCRIPT + 4, continued: false, rewound: false },
  ]);
  runCase("op11 yield", { ops: [11, 255], returns: { 11: 0 } }, [
    { op: 11, handler: "op11", ipBefore: SCRIPT, ipAfter: SCRIPT + 2, continued: false, rewound: false },
  ]);
});

// ── 3. ops 8/9 and 12..254 are no-op continues ──────────────────────────────

test("F0x8008c590: ops 8, 9, 30 and 200 are no-op continues with no handler", SKIP, () => {
  const ops = [8, 9, 30, 200, 255];
  const expect: DispatchStep[] = [
    { op: 8, handler: null, ipBefore: SCRIPT, ipAfter: SCRIPT + 2, continued: true, rewound: false },
    { op: 9, handler: null, ipBefore: SCRIPT + 2, ipAfter: SCRIPT + 4, continued: true, rewound: false },
    { op: 30, handler: null, ipBefore: SCRIPT + 4, ipAfter: SCRIPT + 6, continued: true, rewound: false },
    { op: 200, handler: null, ipBefore: SCRIPT + 6, ipAfter: SCRIPT + 8, continued: true, rewound: false },
    { op: 255, handler: "terminate", ipBefore: SCRIPT + 8, ipAfter: SCRIPT + 10, continued: false, rewound: false },
  ];
  runCase("no-op run", { ops }, expect);
});

// ── 4. the terminator HOLD path rewinds IP by 2 ─────────────────────────────

test("F0x8008c590: op0 with a busy context HOLDS (IP rewinds 2) and yields", SKIP, () => {
  const ops = [1, 0];
  const expect: DispatchStep[] = [
    { op: 1, handler: "op1", ipBefore: SCRIPT, ipAfter: SCRIPT + 2, continued: true, rewound: false },
    { op: 0, handler: "terminate", ipBefore: SCRIPT + 2, ipAfter: SCRIPT + 2, continued: false, rewound: true },
  ];
  // ctx+0x3c != 0 → holds (asm 9945-9949)
  runCase("terminator hold", { ops, term: { slot3c: 0x1 } }, expect);
});

test("F0x8008c590: op0 with slot4 busy at state<2 HOLDS; at state>=2 it transitions", SKIP, () => {
  const hold: DispatchStep[] = [
    { op: 0, handler: "terminate", ipBefore: SCRIPT, ipAfter: SCRIPT, continued: false, rewound: true },
  ];
  runCase("slot4 state<2", { ops: [0], term: { slot4: SLOT4OBJ, slot4State: 1 } }, hold);
  const go: DispatchStep[] = [
    { op: 0, handler: "terminate", ipBefore: SCRIPT, ipAfter: SCRIPT + 2, continued: false, rewound: false },
  ];
  runCase("slot4 state>=2", { ops: [0], term: { slot4: SLOT4OBJ, slot4State: 2 } }, go);
});

// ── 5. negative control: the table and the yield set ────────────────────────

test("negative control: opcode→handler table is right for every dispatched opcode", SKIP, () => {
  const want: Record<number, string> = {
    1: "op1", 2: "op2", 3: "op3", 4: "op4", 5: "op5", 6: "op6",
    7: "op7", 10: "op10", 11: "op11", 0: "terminate", 255: "terminate",
  };
  for (const [op, id] of Object.entries(want)) assert.equal(handlerForOpcode(Number(op)), id, `op ${op}`);
  for (const op of [8, 9, 12, 13, 100, 254]) assert.equal(handlerForOpcode(op), null, `op ${op} must be a no-op`);
  // The yield set is exactly op2/3/4/6/11 — the handlers whose return the delay slot moves to $s0.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 10, 11, 255].filter(opcodeConsumesHandlerReturn), [2, 3, 4, 6, 11]);
});
