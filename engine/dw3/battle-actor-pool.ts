// The battle actor pool's two fixed-pool routines — the four-fighter slot lookup
// and the counter-effect pool arm.
//
// This is a port of two original pro/fightstg routines, read from the disc:
//   FIGHTSTG_F0x80087bf8   fightstg.norm.s L5198-L5214  the four-slot scan
//   FIGHTSTG_F0x8009d0ec   fightstg.norm.s L27178-L27198 the counter-pool arm
//
// WHY THIS IS A SHARED SYSTEM. The battle manager embeds a fixed array of four
// 0x4C-byte sub-objects at manager+0x50; they are the four fighters of a battle
// (docs/research/battle/battle-hud-ownership-check-2026-10-03.md §"the four are
// the four fighters"). The lookup F0x80087bf8 is the shared resolver every slot
// access runs through; the constructor that builds the four slots is described in
// docs/research/fight-3d/action-vm-dispatch.md (slot = anim_obj + 0x50 + 0x4c*idx).
//
// WHAT THE ORIGINAL DOES.
//   F0x80087bf8(pool, key): scan i = 0..3 at stride 0x4C. If the slot's word at
//     +0x50 (its live flag) is zero, skip it. Otherwise if the slot's word at
//     +0x54 equals `key`, return i. If no slot matches, return -1.
//   F0x8009d0ec(): ask the pool allocator at [0x800a3868+0xb04] for a slot
//     (request size 0x18), and if it answers a non-negative index, write the
//     halfword 1 to that entry's +0x02 flag. Entries stride 0x1C off 0x800a3868.
//     The counter machinery (battle-formula-leaves.md) fires this when a counter
//     proc lands.
//
// The oracle tests/engine/unit/battle-actor-pool-oracle.test.ts runs the original
// words out of the committed fightstg overlay through engine/native and compares
// them to this port, with negative controls.

/** The battle manager carries exactly four fighter slots (asm `slti $v0,$v1,0x4`). */
export const FIGHTER_SLOT_COUNT = 4;
/** Each fighter slot is 0x4C bytes (asm `addiu $a0, 0x4c`). */
export const FIGHTER_SLOT_STRIDE = 0x4c;
/** A slot's live flag word (asm `lw $v0, 0x50($a0)`). */
export const FIGHTER_SLOT_FLAG_OFF = 0x50;
/** A slot's selector key word (asm `lw $v0, 0x54($a0)`). */
export const FIGHTER_SLOT_KEY_OFF = 0x54;

/** A view over the battle manager's four embedded fighter slots. */
export interface FighterSlotPool {
  /** The live flag word at slot i (+0x50). */
  active(i: number): number;
  /** The selector key word at slot i (+0x54). */
  key(i: number): number;
}

/**
 * FIGHTSTG_F0x80087bf8: the four-slot scan. Returns the index of the first live
 * slot whose key equals `key`, or -1 when none matches. The original tests the
 * live flag before the key, so a match with a clear flag is skipped.
 */
export function findFighterSlot(pool: FighterSlotPool, key: number): number {
  const k = key | 0;
  for (let i = 0; i < FIGHTER_SLOT_COUNT; i++) {
    if ((pool.active(i) | 0) === 0) continue; // asm beqz on +0x50
    if ((pool.key(i) | 0) === k) return i; // asm beq on +0x54
  }
  return -1; // asm `li $v0, -0x1`
}

/** The counter-effect pool stride (asm `sll 0x3 / subu / sll 0x2` = x*0x1c). */
export const COUNTER_POOL_STRIDE = 0x1c;
/** The counter-effect pool's entry flag halfword (asm `sh $v1, 0x2($v0)`). */
export const COUNTER_POOL_FLAG_OFF = 0x02;
/** The request size handed to the pool allocator (asm `li $a0, 0x18`). */
export const COUNTER_POOL_REQUEST = 0x18;

/** A view over the counter-effect pool the arm writes its entry flag into. */
export interface CounterPool {
  /** Write the halfword flag at entry `idx`'s +0x02. */
  setFlag(idx: number, v: number): void;
}

/**
 * FIGHTSTG_F0x8009d0ec: the counter-pool arm. Asks the pool allocator (taking the
 * request size 0x18) for a slot; on a non-negative answer it sets the entry's
 * +0x02 flag halfword to 1 and returns the index. A negative answer arms nothing
 * and returns -1 (the oracle pins that the original makes no write in that case).
 */
export function armCounterPoolSlot(alloc: (request: number) => number, pool: CounterPool): number {
  const idx = alloc(COUNTER_POOL_REQUEST) | 0;
  if (idx < 0) return -1; // asm `bltz $v1, .L0x0001a480`
  pool.setFlag(idx, 1);
  return idx;
}
