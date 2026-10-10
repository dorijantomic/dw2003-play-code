// The battle actor lifecycle's teardown and the multi-hit applier's reset arm —
// the two routines the battle system runs when an actor is destroyed and when a
// landed attack's hit slots are (re)seeded.
//
// This is a port of two original pro/fightstg routines, read from the disc:
//   FIGHTSTG_F0x8008606c   fightstg.norm.s L3377-L3418  the actor teardown
//   FIGHTSTG_F0x8009ddd8   fightstg.norm.s L28005-L28061 the multi-hit reset
//
// WHY THIS IS A SHARED SYSTEM, NOT ONE ACTOR'S DATA. Every fightstg actor body
// has the same actor shape (see docs/research/battle/fightstg-actors-2026-08-04.md):
// `switch (obj->state)` with 1 = per-frame tick, 3 = teardown. F0x8008606c is the
// teardown arm of the actor whose method table is installed by the allocator at
// F0x8008610c (0x8008606c is passed to F0x80014504 as the 0xac-byte object's
// method). It frees the three resource pointers an actor holds at +0x78/+0x7c/+0x80.
//
// WHAT THE ORIGINAL DOES.
//   F0x8008606c(obj):  state = w[obj+0xc]; only when state == 3 (not <0, not <3,
//     not !=3) does it free the three pointers at +0x78, +0x7c, +0x80, each only
//     when non-zero, through the shared free at [0x8004b5ec].
//   F0x8009ddd8():     the dispatch-byte-0x1f arm of the move resolver
//     F0x8009e0cc. For each of the two hit slots (i = 0,1): if the manager
//     predicate at [0x800a4580+0xa0] answers non-zero for the record's side byte
//     (+0x20) and id word (+0x24), it marks the slot flag at base+0x30+i = 1, asks
//     the manager producer at [0x800a4580+0x88] for the slot's value on the SLOT's
//     OWN technique id (0x1b9 = 441 for slot 0, 0x1ba = 442 for slot 1), stores the
//     result at base+0x60+4*i, and bumps the shared counter at base+0x34.
//     Finally it sets the workspace flag [0x800a4435] = 1. base = 0x800a43f4.
//
//     The two manager entries are NOT a message producer: +0xa0 is the magical
//     ACCURACY leaf F0x800a08c8 (ported as `rollMagicHit`) and +0x88 is the magical
//     DAMAGE leaf F0x8009fab4 (ported as `magicalBase` + `resolveDamage`) — see
//     docs/research/battle/battle-formula-leaves.md, "the real damage leaves are
//     +0x84 (0x8009f97c, physical) and +0x88 (0x8009fab4, magical), and the real
//     accuracy entries are +0x9c (0x800a06ac) / +0xa0 (0x800a08c8)". So the reset
//     computes TWO damage values, one per slot, each gated by its own accuracy
//     roll; the record machine then applies their SUM as the action's damage
//     (`pro/fightstg.s:13154`-`:13158`: `lw $v0,0x60` / `lw $v1,0x64` / `addu` /
//     `sw $v0,0x58`).
//
// The oracle tests/engine/unit/battle-actor-lifecycle-oracle.test.ts runs the
// original words out of the committed fightstg overlay through engine/native and
// compares them to this port, with negative controls.

/** The actor object's state word offset (asm obj+0xc). */
export const ACTOR_STATE_OFF = 0x0c;
/** The three resource pointers the teardown frees, in the original's order. */
export const ACTOR_RES_OFFSETS: readonly number[] = [0x78, 0x7c, 0x80];
/** The state that runs the teardown (asm: only state == 3 passes the guards). */
export const ACTOR_TEARDOWN_STATE = 3;

/** The two SLOT technique ids the reset's producer is asked about: the last two
 *  rows (441 = 0x1b9, 442 = 0x1ba) of the 443-record technique table at
 *  0x80042bca. NOT message ids — the prior name is a misnomer kept for the
 *  exported API (engine/index.ts). */
export const MULTI_HIT_MSG_IDS: readonly number[] = [0x1b9, 0x1ba];
/** The multi-hit reset arms exactly two hit slots. */
export const MULTI_HIT_SLOTS = 2;

/** A view over a battle actor for the teardown: state at +0xc and the resource
 *  words at +0x78/+0x7c/+0x80. */
export interface ActorTeardownView {
  /** obj+0xc: the actor's state. */
  getState(): number;
  /** The resource pointer at `off` (one of ACTOR_RES_OFFSETS). */
  getResource(off: number): number;
}

/**
 * FIGHTSTG_F0x8008606c: the actor teardown. Frees the three resource pointers
 * only when the actor's state is exactly 3; each is freed only when non-zero.
 * Returns the number of pointers freed (the original leaves no meaningful return
 * value; the oracle compares the freed set, not this count).
 */
export function actorTeardown(actor: ActorTeardownView, free: (ptr: number) => void): number {
  const state = actor.getState() | 0;
  // asm: bltz state → end; slti state,3 → end; state != 3 → end. Net: state === 3.
  if (state !== ACTOR_TEARDOWN_STATE) return 0;
  let freed = 0;
  for (const off of ACTOR_RES_OFFSETS) {
    const ptr = actor.getResource(off) | 0;
    if (ptr !== 0) {
      free(ptr);
      freed++;
    }
  }
  return freed;
}

/** One hit slot the multi-hit reset arms. */
export interface MultiHitSlot {
  /** base+0x30+i: the slot's flag; the reset writes 1 when the predicate holds. */
  setFlag(v: number): void;
  /** base+0x60+4*i: the value the producer returned for the slot (the slot's own
   *  damage leaf's result, summed with the sibling's by the record machine). */
  setCaption(v: number): void;
}

/**
 * The two manager entries F0x8009ddd8 reads through. The predicate is the magical
 * accuracy leaf F0x800a08c8 (side byte +0x20, id word +0x24); the producer is the
 * magical damage leaf F0x8009fab4, asked with the SLOT's own technique id.
 */
export interface MultiHitManager {
  predicate(side: number, id: number): number;
  produce(side: number, slotTechniqueId: number): number;
}

/** The accumulator the reset writes: the shared hit counter at base+0x34 and the
 *  workspace flag at 0x800a4435. */
export interface MultiHitState {
  /** base+0x34: the live-hit counter the reset zeroes then bumps per live slot. */
  count: number;
  /** base+0x36: the slot capacity the reset seeds to 2 (asm `li v0,2`). */
  total: number;
  /** 0x800a4435: the workspace flag the reset finally sets to 1. */
  done: number;
}

/**
 * FIGHTSTG_F0x8009ddd8: the resolver's dispatch-byte-0x1f arm. Seeds up to two hit
 * slots from the record's side/id through the manager's predicate, records each
 * live slot's produced value, bumps the shared counter once per live slot, and
 * finally sets the workspace flag. `read.side()/read.id()` supply the record bytes
 * the original reads at +0x20/+0x24 (the acting side and technique id).
 */
export function multiHitReset(
  slots: readonly MultiHitSlot[],
  read: { side(): number; id(): number },
  manager: MultiHitManager,
  state: MultiHitState,
): void {
  state.count = 0; // asm `sh $zero, 0x34(s0)`
  state.total = MULTI_HIT_SLOTS; // asm `li $v0,2` / `sh $v0, 0x36(s0)`
  state.done = 0;
  const side = read.side() | 0;
  const id = read.id() | 0;
  for (let i = 0; i < MULTI_HIT_SLOTS; i++) {
    if ((manager.predicate(side, id) | 0) === 0) continue;
    slots[i]!.setFlag(1);
    slots[i]!.setCaption(manager.produce(side, MULTI_HIT_MSG_IDS[i]!) | 0);
    state.count = (state.count + 1) & 0xffff; // lhu/addiu 1/sh
  }
  state.done = 1; // `sb 1, 0x4435`
}
