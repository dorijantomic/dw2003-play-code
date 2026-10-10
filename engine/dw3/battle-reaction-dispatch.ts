// The attack script's DEFENDER-REACTION dispatch — the shared system that turns an
// attacker's authored opcode-1 records into the reaction the opponent plays, plus the
// reaction-kind selection table the damage state machine reads.
//
// This is a port of the original pro/fightstg routines, read from the disc. The
// browser used to hand-write the reaction choice inline in web/fight/fight-coordinator.js
// (`rec.mode === 5 ? clip 1 : clip 3/4/5 from miss/lethal`); that is the shared system, so
// it is ported here once and the coordinator supplies only its own data.
//
//   FIGHTSTG_F0x8008b69c   fightstg.norm.s:8722 (.L0x000089ec)  the op1 handler — replace
//     the owner's subordinate action actor. One signed mode word is read at the parent
//     actor's instruction pointer (`+0x8c`) and the pointer advances one word (the
//     dispatcher reads the opcode itself). Modes other than 0 and 5 do nothing but consume
//     the word. Both live modes destroy the owner's existing `+0x3c` child through its
//     `+0x4c` method, allocate a replacement through FIGHTSTG_F0x8008c910, give the child
//     the INVERSE of the parent's `+0x50` side flag (`sltiu $v1,0x1` — 1 when the parent's
//     flag is 0, else 0) and write the child's action index at `+0x54`:
//       mode 0  child+0x54 = parent+0x64 + 1        (asm .L0x80008a88-.L0x80008a98)
//       mode 5  child+0x54 = select(parent) + 1, then parent+0x90++  (asm .L0x80008ad8-.L0x80008b2c)
//     where select(parent) is `+0x5c` when `+0x90 == 1`, `+0x60` when `+0x90 == 2`, and
//     `+0x58` for every other counter value (0 and the counter is raised each call).
//
//     The standard attack setup FIGHTSTG_F0x8008ee84 writes the outcome into the attacker's
//     `+0x64` (1 survive / 2 lethal / 3 miss) and leaves the fresh `+0x58/+0x5c/+0x60` slots
//     zero, so mode 0 selects the defender's clips 2/3/4 and a mode-5 contact selects clip 1
//     — the three reaction clips the browser's fight-tables.js already names. See
//     docs/research/fight-3d/action-vm-dispatch.md §"op1 subordinate action actor".
//
// The routine is deliberately memory-shaped: the oracle runs the ORIGINAL words over
// engine/native with the two runtime services stubbed and compares every field this port
// writes, so the addresses below are the original's, not an abstraction.
//
// The DAMAGE-REACTION state machine FIGHTSTG_F0x8008d3b4 (fightstg.norm.s:10640,
// .L0x0000a704) is a second, larger system: it allocates its own child and reads the attack's
// reaction-kind code at `unit+0x70`, indexing the 14-case table D0x80082ee4 (norm.s:152) by
// `kind - 0x4d`. Its selection IS legible and is ported below (`reactionKindClip`), but the
// case bodies run the damage calculation (0x800aa9f0/0x800aabf0) against runtime globals and
// guard bytes, and which attack authors which kind is NOT established — see the report.

/** The parent actor's `+0x8c` instruction pointer to the current script word. */
export const DISPATCH_IP_OFF = 0x8c;
/** Parent `+0x50`: the side flag the child inverts. */
export const DISPATCH_SIDE_OFF = 0x50;
/** Parent `+0x64`: the attack outcome (mode 0's index base). */
export const DISPATCH_OUTCOME_OFF = 0x64;
/** Parent `+0x90`: the mode-5 contact counter. */
export const DISPATCH_CONTACT_COUNTER_OFF = 0x90;
/** Parent `+0x58/+0x5c/+0x60`: the three mode-5 index bases, selected by the counter. */
export const DISPATCH_BASE_OFFS = [0x58, 0x5c, 0x60] as const;
/** The owner context's `+0x3c`: the live subordinate child pointer. */
export const DISPATCH_CHILD_OFF = 0x3c;

/** op1's two live modes; every other mode is a consume-and-return. */
export const SUBORDINATE_MODE_SINGLE = 0;
export const SUBORDINATE_MODE_MULTI_HIT = 5;

/** The word reader/writer the port drives — the original's own memory. */
export interface ReactionMemory {
  read32(addr: number): number;
  /** `lh`: a signed 16-bit read (the mode word). */
  read16s(addr: number): number;
  write32(addr: number, value: number): void;
}

/** The two console services F0x8008b69c borrows. */
export interface ReactionHost {
  /** FIGHTSTG_F0x8008c910 — allocate a fresh action actor; returns its pointer. */
  allocateActionActor(): number;
  /** The child's `+0x4c` destructor, invoked as `jalr` with the child as its argument. */
  destroyActionActor(method: number, child: number): void;
}

/** What one op1 word did. `fired` is false for a consume-and-return. */
export interface ReactionDispatchResult {
  readonly fired: boolean;
  /** The owner's new `+0x3c` child (0 when no branch fired). */
  readonly child: number;
  /** The action index written to the child's `+0x54` (0 when no branch fired). */
  readonly actionIndex: number;
}

/**
 * FIGHTSTG_F0x8008b69c — consume one op1 mode word from `parent+0x8c` and, for modes 0
 * and 5, replace the owner's subordinate action actor and select its action index.
 */
export function dispatchSubordinateActor(
  parent: number,
  ctx: number,
  host: ReactionHost,
  mem: ReactionMemory,
): ReactionDispatchResult {
  // Read the signed mode word at the parent's IP and advance the IP by one word, exactly
  // as the handler does before it branches (asm .L0x80008a00-.L0x80008a10).
  const ip = mem.read32(parent + DISPATCH_IP_OFF) | 0;
  const mode = mem.read16s(ip) | 0;
  mem.write32(parent + DISPATCH_IP_OFF, (ip + 2) | 0);

  if (mode !== SUBORDINATE_MODE_SINGLE && mode !== SUBORDINATE_MODE_MULTI_HIT) {
    return { fired: false, child: 0, actionIndex: 0 };
  }

  // Destroy the owner's existing child through its `+0x4c` method (.L0x80008a4c-.L0x80008a68).
  const existing = mem.read32(ctx + DISPATCH_CHILD_OFF) | 0;
  if (existing !== 0) host.destroyActionActor(mem.read32(existing + 0x4c) | 0, existing);

  // Allocate the replacement and store it (.L0x80008a6c-.L0x80008a74).
  const child = host.allocateActionActor();
  mem.write32(ctx + DISPATCH_CHILD_OFF, child);

  // The child runs for the OTHER side: `sltiu $v1,0x1` sets 1 iff the parent flag is 0.
  const parentSide = mem.read32(parent + DISPATCH_SIDE_OFF) | 0;
  mem.write32(child + DISPATCH_SIDE_OFF, parentSide === 0 ? 1 : 0);

  // Select the child's action index.
  let actionIndex: number;
  if (mode === SUBORDINATE_MODE_SINGLE) {
    actionIndex = (mem.read32(parent + DISPATCH_OUTCOME_OFF) | 0) + 1;
  } else {
    const counter = mem.read32(parent + DISPATCH_CONTACT_COUNTER_OFF) | 0;
    const baseOff = counter === 1 ? DISPATCH_BASE_OFFS[1]
      : counter === 2 ? DISPATCH_BASE_OFFS[2]
      : DISPATCH_BASE_OFFS[0];
    actionIndex = (mem.read32(parent + baseOff) | 0) + 1;
    mem.write32(parent + DISPATCH_CONTACT_COUNTER_OFF, (counter + 1) | 0);
  }
  mem.write32(child + 0x54, actionIndex);
  return { fired: true, child, actionIndex };
}

// ── the damage-reaction machine's kind → clip selection (D0x80082ee4) ───────────────
//
// FIGHTSTG_F0x8008d3b4 reads the attack's reaction-kind code at `unit+0x70`, computes
// `idx = kind - 0x4d` (77), and when `idx < 14` jumps through the 14-word table at
// D0x80082ee4 (asm .L0x0000a758-.L0x0000a77c); otherwise it takes the default case
// (.L0x0000ac30 → and .L0x0000ad58 → clip 10). Each case's FIRST act is to write the
// reaction clip into the fresh child's `+0x54`:
//
//   F0x8008d434  (idx 0..6)   clip 15   .L0x0000a78c  `li $v0,0xf ; sw $v0,0x54`
//   F0x8008d44c  (idx 7)      clip 15   .L0x0000a7ec  `li $v0,0xf ; sw $v0,0x54`
//   F0x8008d714  (idx 8)      clip 14   .L0x0000aa6c  `li $v0,0xe ; sw $v0,0x54`
//   F0x8008d4dc  (idx 9)      clip 17   .L0x0000a834  `li $v0,0x11; sw $v0,0x54`
//   F0x8008d510  (idx 10)     clip 17   .L0x0000a868  `li $v0,0x11; sw $v0,0x54`
//   F0x8008d550  (idx 11)     clip 17   .L0x0000a9f8  `li $v0,0x11; sw $v0,0x54`
//   F0x8008d52c  (idx 12)     clip 17   .L0x0000a884  `li $v0,0x11; sw $v0,0x54`
//   F0x8008d7e8  (idx 13)     clip 14   .L0x0000ab40  `li $v0,0xe ; sw $v0,0x54`
//   default                    clip 10   .L0x0000adb4  `li $v0,0xa ; sw $v0,0x54`
//
// The clip only is ported: the cases also run the damage calculation against runtime globals
// and the guard byte 0x80042b5f, and the kind's authoring site is undecoded, so nothing below
// claims the machine's full behaviour.

/** The reaction-kind code's zero point: `idx = kind - 0x4d` (asm .L0x0000a758). */
export const REACTION_KIND_BASE = 0x4d;
/** The 14 case addresses, in table order — the disc words at D0x80082ee4. */
export const REACTION_KIND_CASE_ADDRESSES: readonly number[] = [
  0x8008d434, 0x8008d434, 0x8008d434, 0x8008d434, 0x8008d434, 0x8008d434, 0x8008d434,
  0x8008d44c, 0x8008d714, 0x8008d4dc, 0x8008d510, 0x8008d550, 0x8008d52c, 0x8008d7e8,
];
/** The reaction clip each case selects, aligned with REACTION_KIND_CASE_ADDRESSES. */
export const REACTION_KIND_CASE_CLIPS: readonly number[] = [
  15, 15, 15, 15, 15, 15, 15,
  15, 14, 17, 17, 17, 17, 14,
];
/** The default case's reaction clip (asm .L0x0000adb4). */
export const REACTION_DEFAULT_CLIP = 10;

/**
 * The reaction clip a damage reaction selects for the attack's kind code. Out-of-range
 * kinds (and the negative side of the range) take the default clip 10.
 */
export function reactionKindClip(kind: number): number {
  const idx = (kind | 0) - REACTION_KIND_BASE;
  if (idx < 0 || idx >= REACTION_KIND_CASE_CLIPS.length) return REACTION_DEFAULT_CLIP;
  return REACTION_KIND_CASE_CLIPS[idx] as number;
}

// ── the damage-reaction machine's CASE BODIES (F0x8008d3b4) ─────────────────────────
//
// FIGHTSTG_F0x8008d3b4 does more than pick a clip: each case writes the fresh child
// action actor's motion slots and (for three of them) runs the damage arithmetic against
// the struck fighter's combatant record. This is the rest of the machine, read from the
// overlay's words (fightstg.norm.s .L0x0000a704-.L0x0000ae0c), memory-shaped like the op1
// dispatch above so the oracle can run the ORIGINAL words and diff every field.
//
// The machine is entered in one of three states (parent+0x14): 0/other run the case
// dispatch, 1 is the lone-kind re-entry, 2 the completion probe. The externals are the
// console's own services, so they are injected:
//   F0x8008c910  allocate a fresh action actor          host.allocateActionActor
//   [0x8004dc0c] the signed random word                 host.rng
//   [0x800a4600] the combatant push service (2-sided)   host.callService
//   [0x800a4608] the kind-0x5a motion/roll service      host.callService
//   [0x80042b98] the kind 0x2b..0x2e motion record svc  host.callService
//   0x800aa9f0 / 0x800aabf0 / 0x800aab10 / 0x800aaba0   host.applyDamage / host.roll

/** parent+0x14 — the machine's own state. */
export const REACTION_STATE_OFF = 0x14;
/** parent+0x64 — the outcome the case writes (1 survive / 2 lethal / 3 miss). */
export const REACTION_CASE_OUTCOME_OFF = 0x64;
/** The struck fighter's combatant record array (0x800a4460 + 0x70), stride 0x20. */
export const REACTION_ACTOR_TABLE = 0x800a44d0;
/** The active combatant index, `[0x800a4460 + 0xc]`. */
export const REACTION_ACTIVE_INDEX = 0x800a446c;
/** The kind-0x5a case's fixed motion record (its bytes +0xd/+0xe/+0xf are the slots). */
export const REACTION_MOTION_RECORD = 0x8004356c;
/** The guard byte that short-circuits the clip-14 knockback frame (case 0x55). */
export const REACTION_GUARD_HIT = 0x80042b5f;
/** The two guard bytes that gate the two-sided push (case 0x58). */
export const REACTION_GUARD_PUSH_A = 0x80042b62;
export const REACTION_GUARD_PUSH_B = 0x80042b63;
/** The default case's per-kind motion list at 0x800a336c (stride 6, terminated by -1). */
export const REACTION_DEFAULT_LIST = 0x800a336c;
export const REACTION_DEFAULT_LIST_STRIDE = 6;

/** The resident pointer words the machine calls through. */
export const REACTION_RNG_PTR = 0x8004dc0c;
export const REACTION_SERVICE_PUSH = 0x800a4600;
export const REACTION_SERVICE_ROLL = 0x800a4608;
export const REACTION_SERVICE_MOTION = 0x80042b98;
/** The turn-state word read by the tail (0x800a4536). */
export const REACTION_TURN_STATE = 0x800a4536;

/** The console services the case bodies borrow. */
export interface ReactionCaseHost {
  /** FIGHTSTG_F0x8008c910 — allocate a fresh action actor; returns its pointer. */
  allocateActionActor(): number;
  /** `[0x8004dc0c]()` — the signed random word (case 0x54). */
  rng(): number;
  /** An indirect service: read its pointer at `ptrAddr` and call it with `args`. */
  callService(ptrAddr: number, args: number[]): number;
  /** `0x800aa9f0(slot, amount)`: apply a signed amount to a damage slot. */
  applyDamage(slot: number, amount: number): void;
  /** `0x800aabf0(a0, a1, a2)`: the kind-0x5a damage roll; returns the amount. */
  rollDamage(a0: number, a1: number, a2: number): number;
  /** `0x800aab10` / `0x800aaba0`: the tail effect for kind 0x5a / other. */
  tailEffect(fnAddr: number, a0: number, a1: number): void;
}

/** The word memory the machine reads its records and guards from. */
export interface ReactionCaseMemory extends ReactionMemory {
  /** `lbu` */
  read8u(addr: number): number;
  /** `lhu` */
  read16u(addr: number): number;
  /** `sh` */
  write16(addr: number, value: number): void;
}

const s16 = (v: number): number => (v << 16) >> 16;
/** The signed magic division by 5 the clip-14 knockback uses (`mult 0x66666667; …>>1`). */
const div5 = (v: number): number => Math.trunc(s16(v) / 5);
/** The signed magic division by 7 the case-0x54 motion uses (`mult 0x92492493; …>>2`). */
const div7 = (v: number): number => Math.trunc(v / 7);

/** What one run of the machine produced. */
export interface ReactionMachineResult {
  /** The owner's live `+0x3c`-sibling child, or 0. */
  readonly child: number;
  /** The routine's return value (1 only on the state-2 completion probe). */
  readonly value: number;
}

/**
 * FIGHTSTG_F0x8008d3b4 — run the damage-reaction machine for the acting object's kind
 * (`+0x70`), writing the fresh child actor's motion slots and outcome, the parent's
 * scratch words and (for the push cases) the combatant record. `out` is the owner's
 * child-pointer slot (the original's `$a1`).
 */
export function runReactionMachine(
  parent: number,
  out: number,
  mem: ReactionCaseMemory,
  host: ReactionCaseHost,
): ReactionMachineResult {
  const state = mem.read32(parent + REACTION_STATE_OFF) | 0;
  if (state === 1) return stateReentry(parent, out, mem, host);
  if (state === 2) return stateProbe(out, mem);
  return stateDispatch(parent, out, mem, host);
}

/** State 0 and every value other than 1 or 2: allocate the child and run the case. */
function stateDispatch(
  parent: number,
  out: number,
  mem: ReactionCaseMemory,
  host: ReactionCaseHost,
): ReactionMachineResult {
  const child = host.allocateActionActor();
  mem.write32(out, child | 0);
  mem.write32(child + DISPATCH_SIDE_OFF, 0);
  const kind = mem.read32(parent + 0x70) | 0;
  const idx = kind - REACTION_KIND_BASE;
  if (idx < 0 || idx >= 14) defaultCase(parent, child, mem, host);
  else caseBody(idx, kind, parent, child, mem, host);
  tail(parent, mem, host);
  return { child, value: 0 };
}

/** The whole state-1 arm: a lone kind-0x55 re-entry when no child exists. */
function stateReentry(
  parent: number,
  out: number,
  mem: ReactionCaseMemory,
  host: ReactionCaseHost,
): ReactionMachineResult {
  if ((mem.read32(out) | 0) !== 0) return { child: 0, value: 0 };
  if ((mem.read32(parent + 0x70) | 0) !== 0x55) return { child: 0, value: 0 };
  if ((mem.read32(parent + 0x18) | 0) !== 0) return { child: 0, value: 0 };
  if (mem.read8u(REACTION_GUARD_HIT) !== 0) return { child: 0, value: 0 };
  const child = host.allocateActionActor();
  mem.write32(out, child | 0);
  mem.write32(child + DISPATCH_SIDE_OFF, 0);
  mem.write32(child + 0x54, 0xa);
  mem.write32(child + 0x6c, 0x21);
  mem.write32(child + 0x70, 0x1f);
  mem.write32(parent + REACTION_STATE_OFF, (mem.read32(parent + REACTION_STATE_OFF) | 0) + 1);
  return { child, value: 0 };
}

/** The state-2 completion probe. */
function stateProbe(out: number, mem: ReactionCaseMemory): ReactionMachineResult {
  return { child: mem.read32(out) | 0, value: (mem.read32(out) | 0) === 0 ? 1 : 0 };
}

/** Every live case ends here: bump the turn counter and run the kind-0x5a tail hook. */
function tail(parent: number, mem: ReactionCaseMemory, host: ReactionCaseHost): void {
  mem.write32(parent + REACTION_STATE_OFF, (mem.read32(parent + REACTION_STATE_OFF) | 0) + 1);
  if ((mem.read16s(REACTION_TURN_STATE) | 0) !== 6) return;
  if ((mem.read32(parent + 0x70) | 0) === 0x5a) {
    host.tailEffect(0x800aab10, 0, mem.read32(parent + 0x78) | 0);
  } else {
    host.tailEffect(0x800aaba0, 0, 0);
  }
}

/** Write a child motion slot and the outcome word (the shared shape every case uses). */
const clip = (child: number, mem: ReactionCaseMemory, v: number): void => mem.write32(child + 0x54, v);
const slot68 = (child: number, mem: ReactionCaseMemory, v: number): void => mem.write32(child + 0x68, v);
const slot6c = (child: number, mem: ReactionCaseMemory, v: number): void => mem.write32(child + 0x6c, v);
const slot70 = (child: number, mem: ReactionCaseMemory, v: number): void => mem.write32(child + 0x70, v);
const outcome = (child: number, mem: ReactionCaseMemory, v: number): void => mem.write32(child + 0x64, v);

/** One of the fourteen typed cases. */
function caseBody(
  idx: number, kind: number, parent: number, child: number,
  mem: ReactionCaseMemory, host: ReactionCaseHost,
): void {
  switch (idx) {
    case 0: case 1: case 2: case 3: case 4: case 5: case 6: {
      // 0x4d..0x53 — pure motion 15; the motion slot counts the kind off 0x4d.
      clip(child, mem, 0xf);
      slot68(child, mem, 3 * (kind - REACTION_KIND_BASE) + 0x22);
      slot6c(child, mem, 2);
      slot70(child, mem, 0x39);
      return;
    }
    case 7: {
      // 0x54 — motion 15 with a random three-frame offset (the /7 magic).
      const r = host.rng() | 0;
      mem.write32(parent + 0x74, (r - div7(r) * 7) + 2);
      clip(child, mem, 0xf);
      slot68(child, mem, 3 * (r - div7(r) * 7) + 0x22);
      slot6c(child, mem, 2);
      slot70(child, mem, 0x39);
      return;
    }
    case 8: {
      // 0x55 — clip 14, the knockback frame. The guard byte gates the whole arm; the
      // push is a fifth of the fighter's max HP, compared against its current HP.
      clip(child, mem, 0xe);
      slot68(child, mem, -1);
      slot6c(child, mem, 0x1c);
      slot70(child, mem, 0x27);
      if (mem.read8u(REACTION_GUARD_HIT) !== 0) { outcome(child, mem, 3); return; }
      const rec = REACTION_ACTOR_TABLE + ((mem.read32(REACTION_ACTIVE_INDEX) | 0) << 5);
      const push = div5(mem.read16u(rec + 6));
      mem.write32(parent + 0x78, push);
      if ((s16(mem.read16u(rec + 8)) - push) > 0) {
        outcome(child, mem, 1);
        host.applyDamage(0x10, push);
        host.applyDamage(0, -push);
      } else {
        outcome(child, mem, 2);
        mem.write32(parent + 0x18, 1);
      }
      return;
    }
    case 9: {
      // 0x56 — knockback/launch clip 17.
      clip(child, mem, 0x11);
      slot68(child, mem, -1);
      slot6c(child, mem, 0x15);
      slot70(child, mem, 0x1b);
      return;
    }
    case 10: {
      // 0x57 — clip 17.
      clip(child, mem, 0x11);
      slot68(child, mem, -1);
      slot6c(child, mem, 0x27);
      slot70(child, mem, 0x31);
      return;
    }
    case 11: {
      // 0x58 — the two-sided stagger push. A service returns the fighter's pair of
      // halfword positions; whichever side is shorter is stretched toward the record's
      // own +0x10/+0x12 field, clamped at half the current separation. The outcome
      // word picks the stagger motion.
      const active = mem.read32(REACTION_ACTIVE_INDEX) | 0;
      const r = host.callService(REACTION_SERVICE_PUSH, [0x10, 0, active, active << 5]);
      pushStagger(parent, child, mem, r | 0);
      return;
    }
    case 12: {
      // 0x59 — clip 17.
      clip(child, mem, 0x11);
      slot68(child, mem, -1);
      slot6c(child, mem, 0x29);
      slot70(child, mem, 0x31);
      return;
    }
    case 13: {
      // 0x5a — clip 14; the three motion slots come from the fixed record, and the
      // outcome is a damage roll compared against the fighter's current HP.
      clip(child, mem, 0xe);
      slot68(child, mem, mem.read8u(REACTION_MOTION_RECORD + 0xd));
      slot6c(child, mem, mem.read8u(REACTION_MOTION_RECORD + 0xe));
      slot70(child, mem, mem.read8u(REACTION_MOTION_RECORD + 0xf));
      const r = host.callService(REACTION_SERVICE_ROLL, [0, 0x89]);
      const amount = host.rollDamage(0, r | 0, 0) | 0;
      if (amount <= 0) { outcome(child, mem, 3); return; }
      mem.write32(parent + 0x78, amount);
      const rec = REACTION_ACTOR_TABLE + ((mem.read32(REACTION_ACTIVE_INDEX) | 0) << 5);
      if ((s16(mem.read16u(rec + 8)) - amount) > 0) {
        outcome(child, mem, 1);
        host.applyDamage(0x10, amount);
      } else {
        outcome(child, mem, 2);
      }
      return;
    }
  }
}

/** The two-sided stagger push (case 0x58). */
function pushStagger(
  parent: number, child: number, mem: ReactionCaseMemory, r: number,
): void {
  const rec = REACTION_ACTOR_TABLE + ((mem.read32(REACTION_ACTIVE_INDEX) | 0) << 5);
  const a1 = s16(mem.read16u(r + 2));
  const a2 = s16(mem.read16u(r + 4));
  if (a2 < a1) {
    if (mem.read8u(REACTION_GUARD_PUSH_A) !== 0) { staggerTail(child, mem, parent); return; }
    mem.write32(parent + 0x7c, 1);
    if (s16(mem.read16u(rec + 0x10)) !== 0) {
      mem.write16(r + 2, (mem.read16u(r + 2) - mem.read16u(rec + 0x10)) & 0xffff);
    }
    const cur = s16(mem.read16u(r + 2));
    const thr = -((cur + (cur >>> 31)) >> 1);
    const next = ((mem.read16u(rec + 0x10) - (a1 - a2)) & 0xffff);
    mem.write16(rec + 0x10, next);
    if (s16(next) < thr) mem.write16(rec + 0x10, thr);
  } else if (a1 < a2) {
    if (mem.read8u(REACTION_GUARD_PUSH_B) !== 0) { staggerTail(child, mem, parent); return; }
    mem.write32(parent + 0x7c, 2);
    if (s16(mem.read16u(rec + 0x12)) !== 0) {
      mem.write16(r + 4, (mem.read16u(r + 4) - mem.read16u(rec + 0x12)) & 0xffff);
    }
    const cur = s16(mem.read16u(r + 4));
    const thr = -((cur + (cur >>> 31)) >> 1);
    const next = ((mem.read16u(rec + 0x12) - (a2 - a1)) & 0xffff);
    mem.write16(rec + 0x12, next);
    if (s16(next) < thr) mem.write16(rec + 0x12, thr);
  }
  staggerTail(child, mem, parent);
}

function staggerTail(child: number, mem: ReactionCaseMemory, parent: number): void {
  clip(child, mem, 0x11);
  slot68(child, mem, -1);
  const p7c = mem.read32(parent + 0x7c) | 0;
  if (p7c === 1) { slot6c(child, mem, 0x25); slot70(child, mem, 0x31); return; }
  if (p7c === 2) { slot6c(child, mem, 0x27); slot70(child, mem, 0x31); return; }
  slot6c(child, mem, 0x2e);
  slot70(child, mem, 0x1e);
}

/** The default (out-of-range) case: clip 10, a per-kind motion list walk, the head hook. */
function defaultCase(
  parent: number, child: number, mem: ReactionCaseMemory, host: ReactionCaseHost,
): void {
  clip(child, mem, 0xa);
  mem.write32(child + 0x68, -1);
  const kind = mem.read32(parent + 0x70) | 0;
  let a0 = REACTION_DEFAULT_LIST;
  if (s16(mem.read16u(a0)) !== -1) {
    while (s16(mem.read16u(a0)) !== -1) {
      if (s16(mem.read16u(a0)) === kind) {
        mem.write32(child + 0x6c, s16(mem.read16u(a0 + 2)));
        mem.write32(child + 0x70, s16(mem.read16u(a0 + 4)));
        break;
      }
      a0 += REACTION_DEFAULT_LIST_STRIDE;
    }
  }
  const rel = kind - 0x2b;
  if (rel >= 0 && rel < 4) {
    const p = host.callService(REACTION_SERVICE_MOTION, [rel]);
    const a1 = s16(mem.read16u((mem.read32(p) | 0) + 2));
    host.applyDamage(0, -a1);
    return;
  }
  if (kind !== 0x47) return;
  const rec = REACTION_ACTOR_TABLE + ((mem.read32(REACTION_ACTIVE_INDEX) | 0) << 5);
  host.applyDamage(0, -(s16(mem.read16u(rec + 0x16)) >> 1));
}
