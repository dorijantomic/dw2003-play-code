// The action VM's OPCODE HANDLERS — the operand arithmetic and per-handler ports
// of the routines the dispatcher calls (docs/research/fight-3d/action-vm-dispatch.md).
//
// A handler owns how many words it consumes after the opcode word; that is what
// moves the dispatcher's instruction pointer (engine/dw3/battle-action-dispatcher.ts).
// This module ports, from pro/fightstg:
//   F0x8008b69c  op1  subordinate action actor (child-index arithmetic)
//   F0x8008b7f4  op2  slot motion controller (mode classification; motion is already
//                     engine/dw3/battle-slot-motion.ts)
//   F0x8008c2cc  op4  play-motion envelope (motion-id resolution)
//   F0x8008c220  op11 WAIT — ported IN FULL (pure; the delta comes from the caller)
// plus `operandWords()`, the exact word count each handler reads, which the
// decoder tools/decode_action_scripts.py and the oracle both verify.
//
// The handler BODIES live in engine/dw3/battle-action-opcodes.ts, which REUSES the
// ported subsystems as each handler's targets (op1 → battle-reaction-dispatch,
// op2 → battle-actor-animation, op6 → battle-projectile, op4 → op4MotionId here,
// op5 → battle-camera); op3/op7/op10 call the console services named on that
// module's `ActionOpcodeHost`. The oracle
// (tests/engine/unit/battle-action-opcodes-oracle.test.ts) runs each ORIGINAL
// handler out of the committed overlay with its targets recording and compares the
// target calls, their arguments and the IP advance to the port.

/** How the port of each handler stands, and what it still needs. */
export interface HandlerPort {
  /** original routine address (fightstg.s). */
  readonly address: string;
  /** what this handler does, in one line. */
  readonly role: string;
  /**
   * "full"  — the handler body is ported in engine/dw3/battle-action-opcodes.ts.
   * "arity" — only the operand count/classification is ported; the body needs `needs`.
   */
  readonly status: "full" | "arity";
  /** the system the handler's body reuses, or (for "arity") needs from another worker. */
  readonly needs?: string;
}

export const HANDLER_PORTS: Readonly<Record<string, HandlerPort>> = {
  op1: {
    address: "F0x8008b69c",
    role: "replace the owner's subordinate action actor; modes 0/5 select its action index",
    status: "full",
    needs: "reuses dispatchSubordinateActor (engine/dw3/battle-reaction-dispatch.ts)",
  },
  op2: {
    address: "F0x8008b7f4",
    role: "bind one timeline table into a slot, arm the slot-motion object, or block until one finishes",
    status: "full",
    needs: "reuses resolveAnimSlot / op2SlotTarget (engine/dw3/battle-actor-animation.ts) and battle-slot-motion.ts; the slot resolver and anim-object method are host services",
  },
  op3: {
    address: "F0x8008bc80",
    role: "preload (sub 1) or spawn (sub 0) a visual effect at an actor-relative point",
    status: "full",
    needs: "the effect spawn/preload are host services (F0x80089978/F0x80089be4); the object they build is the ported effect sprite (engine/dw3/battle-effects.ts)",
  },
  op4: {
    address: "F0x8008c2cc",
    role: "play-motion envelope: motion id 0x38 = the actor's current motion, -1 = skip, 0 = return to base",
    status: "full",
    needs: "reuses op4MotionId (this module); the anim manager +0xe8 is a host service",
  },
  op5: {
    address: "F0x8008c004",
    role: "camera: a preset (sub 0) or an explicit 3x3 transform (sub 1) written into the camera struct",
    status: "full",
    needs: "the camera struct D0x800a46d8 and preset table D0x80082ea0 are ported here; the view methods +0xf8/+0xfc are the lookAtView port (engine/dw3/battle-camera.ts) behind a host service",
  },
  op6: {
    address: "F0x8008bea8",
    role: "spawn a 3-D mesh projectile; the two 3-vectors are launch point and root rotation",
    status: "full",
    needs: "reuses newProjectileFlight / projectileFileForId (engine/dw3/battle-projectile.ts)",
  },
  op7: {
    address: "F0x8008c514",
    role: "spawn (type 0) or free (type 1) a slot overlay via F0x800930c0 / F0x80093088",
    status: "full",
    needs: "the slot-overlay routines F0x800930c0 / F0x80093088 are host services",
  },
  op10: {
    address: "F0x8008c454",
    role: "spawn an effect; types 0x62/0x63 read the attacker's active hitbox part first",
    status: "full",
    needs: "the effect spawn F0x8009b774 is a host service",
  },
  op11: {
    address: "F0x8008c220",
    role: "wait N frame-ticks, then continue in the tick the countdown reaches zero",
    status: "full",
  },
};

// ── the operand count each handler consumes (the decoder's table, verified) ──

/**
 * Words consumed AFTER the opcode word, from the handlers' own reads.
 * `words` = the operands in stream order (words[0] is the first operand).
 * Mirrors tools/decode_action_scripts.py `_operand_count` (both are checked
 * against the original handlers by the oracle).
 */
export function operandWords(op: number, words: readonly number[]): number {
  const w = (i: number): number => (words[i] ?? 0) | 0;
  switch (op) {
    case 0:
    case 255:
      return 0;
    case 1:
    case 8:
    case 9:
    case 11:
      return 1;
    case 7:
    case 10:
      return 2;
    case 3: // sub 1 = [sub,type] (2); sub 0 = [sub,type,x,y,z] (5)
      return w(0) === 1 ? 2 : 5;
    case 4: // sub 1 = [sub,motion] (2); sub 0 = [sub,motion,?,?] (4)
      return w(0) === 1 ? 2 : 4;
    case 5: // sub 0 = [s3,sub,preset] (3); sub 1 = the 16-word transform
      return w(1) === 1 ? 16 : 3;
    case 6: // sub 1 = [sub,id] (2); sub 0 = [sub,id, v0(3), v1(3)] (8)
      return w(0) === 1 ? 2 : 8;
    case 2: {
      const mode = w(0);
      const threeWord = mode <= 0 || mode === 5 || mode === 6 || mode >= 10;
      let n = threeWord ? 3 : 2;
      // the per-mode handlers read further operands (asm .L0x8008b8dc-.L0x8008bc28)
      switch (mode) {
        case 3: n += 4; break;                 // .L0x8008ba18 absolute move [x,y,z,flag]
        case 4: n += 4; break;                 // .L0x8008ba78 secondary transform vector (reads 3,
                                               //   advances IP by 4: the disassembly truth; the
                                               //   decoder tools/decode_action_scripts.py frames
                                               //   this record as 6 too, since 2026-10-06)
        case 7: n += 1; break;                 // .L0x8008bb54 return-home [flag]
        case 8: n += 1; break;                 // .L0x8008bb94 contact move [flag]
        case 5: n += w(2) === 4 ? 1 : 0; break; // .L0x8008b9b4 sub 4 reads the distance trim
        default: break;
      }
      return n;
    }
    default:
      return 1; // unknown opcode — the decoder consumes one word and continues
  }
}

// ── op11 WAIT — F0x8008c220, ported in full ─────────────────────────────────

/** The actor fields op11 drives ($s1). */
export interface WaitActor {
  /** +0x8c — IP, in host units; the handler rewinds/advances it itself. */
  ip: number;
  /** +0x98 — 0 = not counting, 1 = counting. */
  waitFlag: number;
  /** +0x9c — remaining frame-ticks. */
  waitCount: number;
}

/**
 * FIGHTSTG_F0x8008c220 one call. Returns true when the wait has RELEASED (the
 * dispatcher continues this tick), false while it yields.
 *
 * First entry (flag 0): latch the count, set the flag, REWIND IP by one opcode
 * so the op11 re-runs next tick, yield (asm L9532-9540). Counting (flag 1):
 * count -= delta; while count > 0 rewind and yield; when it reaches 0 clear
 * flag/count, ADVANCE IP past the operand and continue (asm L9541-9559).
 */
export function op11Wait(a: WaitActor, count: number, delta: number, opcodeStep = 2): boolean {
  if ((a.waitFlag | 0) === 0) {
    a.waitFlag = 1;
    a.waitCount = count | 0;
    a.ip = (a.ip - opcodeStep) | 0;
    return false;
  }
  a.waitCount = (a.waitCount | 0) - (delta | 0);
  if (a.waitCount > 0) {
    a.ip = (a.ip - opcodeStep) | 0;
    return false;
  }
  a.waitFlag = 0;
  a.waitCount = 0;
  a.ip = (a.ip + opcodeStep) | 0;
  return true;
}

// ── op1 child-action index — F0x8008b69c modes 0/5 ──────────────────────────

/** The parent fields op1's two implemented modes read ($s0). */
export interface AuxParent {
  flag50: number;  // +0x50
  s58: number;     // +0x58
  s5c: number;     // +0x5c
  s60: number;     // +0x60
  s64: number;     // +0x64
  s90: number;     // +0x90 — the mode-5 cycle counter
}

/**
 * The child action index op1 selects, and the mode-5 counter bump. Mode 0 uses
 * parent+0x64 + 1; mode 5 uses +0x58/+0x5c/+0x60 by the +0x90 counter, adds 1,
 * then increments the counter. Returns null for a mode with no behaviour.
 * (asm F0x8008b69c L8794-8850)
 */
export function op1ChildActionIndex(parent: AuxParent, mode: number): number | null {
  if (mode === 0) return (parent.s64 | 0) + 1;
  if (mode === 5) {
    const sel = parent.s90 === 0 ? parent.s58 : parent.s90 === 1 ? parent.s5c : parent.s60;
    const idx = (sel | 0) + 1;
    parent.s90 = (parent.s90 | 0) + 1;
    return idx;
  }
  return null;
}

// ── op4 motion-id resolution — F0x8008c2cc ──────────────────────────────────

/** The play-motion sentinel meaning "use the actor's own current motion" (+0x68). */
export const MOTION_SENTINEL_CURRENT = 0x38;
/** The skip sentinel: motion -1 leaves the actor's motion untouched. */
export const MOTION_SKIP = -1;

/**
 * FIGHTSTG_F0x8008c2cc operand 1 resolved: 0x38 → the actor's current motion
 * (+0x68), -1 → null (skip), else the id itself.
 */
export function op4MotionId(rawMotion: number, actorCurrentMotion: number): number | null {
  const m = rawMotion | 0;
  if (m === MOTION_SENTINEL_CURRENT) return actorCurrentMotion | 0;
  if (m === MOTION_SKIP) return null;
  return m;
}
