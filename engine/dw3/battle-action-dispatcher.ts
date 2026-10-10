// The action VM's DISPATCHER — the per-actor bytecode loop that reads an opcode,
// advances the instruction pointer, calls the opcode's handler and yields when a
// handler asks it to.
//
// Port of the original pro/fightstg routine read from the disc:
//   FIGHTSTG_F0x8008c590   fightstg.s L9752-9977   the dispatcher
//   dispatch loop at .L0x8008c714 (L9851-9971)
// Actor fields ($s1):  +0x0c run-state (1 = run the loop)
//                      +0x8c IP (pointer into the script bytecode)
// Context ($s2):       +0x04, +0x3c and eight slots +0x10..+0x2c feed the
//                      terminator's hold/transition decision.
//
// THE LOOP (asm .L0x8008c714): read the signed halfword at IP, IP += 2, seed the
// continue flag $s0 = 1, branch to the opcode's handler; handlers for op2/op3/op4/
// op6/op11 return the flag via the branch-delay `move $s0,$v0`, every other
// opcode leaves it at 1. `bnez $s0` loops; otherwise the routine returns (yield).
// op0 and op255 share the terminator .L0x8008c870: it always yields, and either
// rewinds IP by 2 (HOLD, so the terminator re-runs) or calls the actor's +0x28
// transition method (a1=3), chosen from the context fields. ops 8/9 have no
// handler and ops 12..254 are no-ops — all continue.
//
// The oracle (tests/engine/unit/battle-action-dispatcher-oracle.test.ts) runs the
// ORIGINAL instruction words out of the committed pro_fightstg.bin overlay with a
// recording stub at every handler address and compares the handler called per
// opcode, the IP advance and the yield/rewind to this port.

/** The opcode handlers, named after their original addresses (fightstg.s). */
export type HandlerId =
  | "op1"   // F0x8008b69c subordinate action actor
  | "op2"   // F0x8008b7f4 slot motion controller
  | "op3"   // F0x8008bc80 visual effect
  | "op4"   // F0x8008c2cc play-motion envelope
  | "op5"   // F0x8008c004 camera
  | "op6"   // F0x8008bea8 projectile spawn
  | "op7"   // F0x8008c514 spawn/free
  | "op10"  // F0x8008c454 effect / contact strike
  | "op11"  // F0x8008c220 wait
  | "terminate"; // op0 / op255, the shared path .L0x8008c870

/** Opcode → handler, exactly the dispatcher's branch tree (L9856-9895). */
export const OP_HANDLERS: Readonly<Record<number, HandlerId>> = {
  0: "terminate",
  1: "op1",
  2: "op2",
  3: "op3",
  4: "op4",
  5: "op5",
  6: "op6",
  7: "op7",
  10: "op10",
  11: "op11",
  255: "terminate",
};

/** The handler for an opcode, or null for the no-op range (8/9, 12..254). */
export function handlerForOpcode(op: number): HandlerId | null {
  return OP_HANDLERS[op & 0xffff] ?? null;
}

/** Which opcodes take the handler's return value as the continue flag ($s0=$v0). */
const TAKES_RETURN: ReadonlySet<number> = new Set([2, 3, 4, 6, 11]);

/**
 * True when the dispatcher takes the handler's return as the continue flag.
 * Handlers for all other opcodes leave $s0 = 1 (the delay slot is absent).
 */
export function opcodeConsumesHandlerReturn(op: number): boolean {
  return TAKES_RETURN.has(op);
}

/** The context fields the terminator's hold/transition decision reads. */
export interface TerminatorContext {
  /** value at context +0x04, or 0 (asm 9938-9944). */
  slot4: number;
  /** value at [slot4 + 0x0c], read only when slot4 != 0 (asm 9942-9944). */
  slot4State: number;
  /** value at context +0x3c (asm 9945-9949). */
  slot3c: number;
  /** the eight words at context +0x10..+0x2c (asm 9950-9957). */
  slots: readonly number[];
}

/**
 * The terminator's HOLD flag (asm 9938-9957): true → IP -= 2 and re-run the
 * terminator next tick; false → call the actor's +0x28 transition (a1=3).
 */
export function terminatorHolds(ctx: TerminatorContext): boolean {
  let a1 = 0;
  if ((ctx.slot4 | 0) !== 0) a1 = (ctx.slot4State | 0) < 2 ? 1 : 0;
  if ((ctx.slot3c | 0) !== 0) a1 = 1;
  if (a1 === 0) {
    for (let i = 0; i < 8; i++) {
      if ((ctx.slots[i] ?? 0) !== 0) { a1 = 1; break; }
    }
  }
  return a1 !== 0;
}

/** One dispatched opcode, as recorded for the oracle / the browser's trace. */
export interface DispatchStep {
  /** The signed opcode word (original) or opcode value (browser). */
  op: number;
  handler: HandlerId | null;
  /** IP before the opcode was consumed (host units). */
  ipBefore: number;
  /** IP after the handler ran (host units). */
  ipAfter: number;
  /** Whether the loop continues to the next opcode. */
  continued: boolean;
  /** Whether the terminator rewound IP (hold). */
  rewound: boolean;
}

/** What the dispatcher needs from its host to run the loop. */
export interface DispatchHost {
  /** The opcode at `ip` (signed 16-bit in the original). */
  readOpcode(ip: number): number;
  /** Run the handler for `id`, which advances `actor.ip` past its own operands. */
  callHandler(id: HandlerId, actor: DispatchActor, ctx: unknown, op: number): number;
  /** The terminator's transition (actor vtable +0x28, a1 = 3). */
  transition?(actor: DispatchActor, ctx: unknown): void;
}

/** The mutable actor slice the dispatcher loop drives. */
export interface DispatchActor {
  /** +0x8c — the instruction pointer, in host units. */
  ip: number;
  /** +0x0c — run-state; only 1 enters the loop. */
  runState: number;
}

/** Options for the loop. `opcodeStep` is 2 for the original's byte IP. */
export interface DispatchOptions {
  opcodeStep?: number;
  maxOps?: number;
}

/**
 * Run the dispatch loop for one tick: execute opcodes until a handler yields
 * ($s0 = 0) or the no-yield opcode budget is exhausted. Returns the per-opcode
 * trace. The original enters the loop only when run-state == 1 (asm L9762); a
 * different run-state is the object's own init path and returns immediately.
 */
export function runDispatch(
  actor: DispatchActor,
  ctx: unknown,
  host: DispatchHost,
  opts: DispatchOptions = {},
): DispatchStep[] {
  const step = opts.opcodeStep ?? 2;
  const max = opts.maxOps ?? 256;
  const trace: DispatchStep[] = [];
  if ((actor.runState | 0) !== 1) return trace;

  for (let i = 0; i < max; i++) {
    const ipBefore = actor.ip >>> 0;
    const op = host.readOpcode(ipBefore) | 0;
    actor.ip = (ipBefore + step) >>> 0;            // consume the opcode word
    const handler = handlerForOpcode(op);
    let s0 = 1;
    let rewound = false;

    if (handler === null) {
      // ops 8/9 and 12..254: no handler, $s0 stays 1 (asm L9882/L9894).
    } else if (handler === "terminate") {
      if (terminatorHolds(ctx as TerminatorContext)) {
        actor.ip = (actor.ip - step) >>> 0;        // HOLD: rewind, re-run next tick
        rewound = true;
      } else {
        host.transition?.(actor, ctx);             // terminate / transition
      }
      s0 = 0;                                      // the terminator always yields
    } else {
      const r = host.callHandler(handler, actor, ctx, op) | 0;
      if (opcodeConsumesHandlerReturn(op)) s0 = r; // else the delay slot is absent
    }

    const continued = s0 !== 0;
    trace.push({ op, handler, ipBefore, ipAfter: actor.ip >>> 0, continued, rewound });
    if (!continued) break;
  }
  return trace;
}
