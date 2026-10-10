// The battle ANIMATION OBJECT's own methods — the routines the fightstg animation
// object (class 0x14, constructor FIGHTSTG_F0x80088054) installs into its method
// table. They are constructor-installed, so the disassembler's entry list misses
// them; every one below was read from ~/ddw3/asm/dw2003/pro/fightstg.s against
// the committed words of web/assets/native/screens/pro_fightstg.bin (base
// 0x80082cb0):
//
//   +0x180  FIGHTSTG_F0x80087c70  remove the slot carrying a key      → animRemoveSlot
//   (helper) FIGHTSTG_F0x80087c3c the first FREE slot index, or -1    → animFreeSlotIndex
//   +0x184  FIGHTSTG_F0x80087d00  bind a slot for a key               → animBindSlot
//   +0x188  FIGHTSTG_F0x80087e28  resolve a key to its slot base      (battle-actor-animation.ts)
//   +0x18c  FIGHTSTG_F0x80087e7c  move a slot's key                   → animRenameSlotKey
//   +0x190  FIGHTSTG_F0x80087ee4  a slot's model handle               → animSlotModel
//   +0x194  FIGHTSTG_F0x80087f38  place the slot on its arena home    (battle-actor-animation.ts)
//
// The driver calls +0x184/+0x188/+0x18c/+0x194 on the object it fetches for class
// 0x14; this module is the SINGLE home for those four routines, and the slot
// resolver F0x80087bf8 is REUSED from battle-actor-pool.ts (findFighterSlot) via
// battle-actor-animation.ts's findAnimSlotIndex, not re-written.
//
// The object layout (F0x80088054): 0x19c bytes, four slots at +0x50 on a 0x4c
// stride, a parallel child-pointer array whose base is the word at +0x24, and the
// method table at +0x180..+0x194.
//
// Two callees are genuine boundaries and stay on the host:
//   • [0x800a4570](handle) — the model-record getter the environment supplies;
//   • FIGHTSTG_F0x80084790 — the animation-instance allocator (F0x80084560), which
//     builds the actor's model instance from the record's first two words and the
//     per-slot table entry at 0x800a2530;
//   • [0x8004b600](ptr, 0x4c) — the 0x4c-byte slot clear (the shared zero-fill aid).

import {
  findAnimSlotIndex, ANIM_SLOT_COUNT, ANIM_SLOT_STRIDE, ANIM_SLOT_BASE, type AnimSlotEntry,
} from "./battle-actor-animation.ts";

/** The parallel child-pointer array's base field (FIGHTSTG_F0x80087c70's `lw s2,0x24`). */
export const ANIM_CHILD_ARRAY = 0x24;
/** The per-slot animation-instance table FIGHTSTG_F0x80087d00 indexes (`0x800a2530`). */
export const ANIM_INSTANCE_TABLE = 0x800a2530;
/** The slot clear aid `[0x8004b600]` is handed this byte count (one slot, 0x4c). */
export const ANIM_SLOT_BYTES = 0x4c;
/** The slot's bind-state value the binder sets at slot+0x08. */
export const ANIM_BIND_STATE = 1;
/** The slot's layer key word the binder sets at slot+0x38 (0x1004). */
export const ANIM_SLOT_LAYER_KEY = 0x1004;

export interface AnimObjectMemory {
  read32(addr: number): number;
  read16u(addr: number): number;
  read16s(addr: number): number;
  write32(addr: number, value: number): void;
  write16(addr: number, value: number): void;
}

export interface AnimObjectHost {
  /** `[0x800a4570](handle)` — the model-record getter (environment boundary). */
  resourceGet(handle: number): number;
  /** FIGHTSTG_F0x80084790(recWord0, recWord1, tableWord0, tableWord1, slotBase) → the instance. */
  allocAnimInstance(w0: number, w1: number, t0: number, t1: number, slotBase: number): number;
  /** `[0x8004b600](ptr, 0x4c)` — clear one slot's bytes (shared zero-fill aid). */
  clearSlot(ptr: number, bytes: number): void;
  /** child+0x28(state) — the base-object state entry (F0x80014274) on a removed child. */
  childSetState(child: number, state: number): void;
}

/** slot base = anim + 0x50 + i*0x4c, for slot index `i`. */
export function animSlotBaseOf(anim: number, index: number): number {
  return (anim + ANIM_SLOT_BASE + index * ANIM_SLOT_STRIDE) >>> 0;
}

/** The four slots of `anim` as the shared resolver reads them (occupancy +0x00, key +0x04). */
export function readAnimSlots(M: AnimObjectMemory, anim: number): AnimSlotEntry[] {
  const slots: AnimSlotEntry[] = [];
  for (let i = 0; i < ANIM_SLOT_COUNT; i++) {
    const base = (anim + ANIM_SLOT_BASE + i * ANIM_SLOT_STRIDE) >>> 0;
    slots.push({ occupied: (M.read32(base) | 0) !== 0, key: M.read32(base + 0x04) | 0, table: 0 });
  }
  return slots;
}

/**
 * FIGHTSTG_F0x80087c3c: the first slot whose occupancy word is zero, else -1. It is
 * the binder's free-slot scan (the original returns the index in $v0, or -1).
 */
export function animFreeSlotIndex(M: AnimObjectMemory, anim: number): number {
  for (let i = 0; i < ANIM_SLOT_COUNT; i++) {
    if ((M.read32((anim + ANIM_SLOT_BASE + i * ANIM_SLOT_STRIDE) >>> 0) | 0) === 0) return i;
  }
  return -1;
}

/**
 * FIGHTSTG_F0x80087c70 (the +0x180 method): drop the slot whose key equals `key`.
 *
 * Read at fightstg.s L5224-L5260. It resolves the slot, takes the child pointer out
 * of the parallel array at `[anim+0x24] + idx*4`, clears that entry, moves the old
 * pointer to `+0x10` in the same entry, calls the child's `+0x28(3)`, and zeroes the
 * slot's occupancy word. A key nobody carries does nothing.
 */
export function animRemoveSlot(M: AnimObjectMemory, host: AnimObjectHost, anim: number, key: number): void {
  const idx = findAnimSlotIndex(readAnimSlots(M, anim), key | 0);
  if (idx < 0) return;
  const children = M.read32((anim + ANIM_CHILD_ARRAY) >>> 0) >>> 0;
  const entry = (children + idx * 4) >>> 0;
  const child = M.read32(entry) | 0;
  M.write32(entry, 0);
  M.write32((entry + 0x10) >>> 0, child | 0);
  if (child !== 0) host.childSetState(child, 3);
  M.write32((anim + idx * ANIM_SLOT_STRIDE + ANIM_SLOT_BASE) >>> 0, 0);
}

/**
 * FIGHTSTG_F0x80087e7c (the +0x18c method): move a slot's key.
 *
 * Read at fightstg.s L5364-L5390. It first REMOVES any slot already carrying
 * `newKey` (F0x80087c70), then finds the slot carrying `oldKey` and stores `newKey`
 * at its key word. The original writes through `anim + idx*0x4c + 0x54` with NO
 * -1 guard, so an `oldKey` nobody carries writes anim+0x08 — reproduced exactly.
 */
export function animRenameSlotKey(M: AnimObjectMemory, host: AnimObjectHost, anim: number, oldKey: number, newKey: number): void {
  animRemoveSlot(M, host, anim, newKey | 0);
  const idx = findAnimSlotIndex(readAnimSlots(M, anim), oldKey | 0);
  M.write32((anim + idx * ANIM_SLOT_STRIDE + 0x54) >>> 0, newKey | 0);
}

/**
 * FIGHTSTG_F0x80087ee4 (the +0x190 method): the model handle of the slot carrying
 * `key`, or 0. Read at fightstg.s L5393-L5414 (`lw v0, 0x64(anim + idx*0x4c)` =
 * slot+0x14).
 */
export function animSlotModel(M: AnimObjectMemory, anim: number, key: number): number {
  const idx = findAnimSlotIndex(readAnimSlots(M, anim), key | 0);
  if (idx < 0) return 0;
  return M.read32((anim + idx * ANIM_SLOT_STRIDE + 0x64) >>> 0) | 0;
}

/**
 * FIGHTSTG_F0x80087d00 (the +0x184 method): allocate and bind a slot for `key`.
 *
 * Read at fightstg.s L5263-L5337. It removes any existing slot for `key`, takes the
 * first free slot, resolves `modelHandle` to a record through `[0x800a4570]`, asks
 * FIGHTSTG_F0x80084790 for an instance built from the record's first two words and
 * the slot's `0x800a2530` entry, stores it in the parallel array, clears the slot's
 * 0x4c bytes, and writes occupancy 1, bind state 1, the model handle at +0x14, the
 * key at +0x04, `flag` at +0x34, zero at +0x3c and 0x1004 at +0x38.
 *
 * A full slot table (free index -1) returns without writing, as the original does.
 */
export function animBindSlot(
  M: AnimObjectMemory, host: AnimObjectHost,
  anim: number, key: number, modelHandle: number, flag: number,
): void {
  animRemoveSlot(M, host, anim, key | 0);
  const idx = animFreeSlotIndex(M, anim);
  if (idx < 0) return;
  const rec = host.resourceGet(modelHandle | 0) | 0;
  const slotBase = animSlotBaseOf(anim, idx);
  const t0 = M.read32((ANIM_INSTANCE_TABLE + idx * 8) >>> 0) | 0;
  const t1 = M.read32((ANIM_INSTANCE_TABLE + idx * 8 + 4) >>> 0) | 0;
  const instance = host.allocAnimInstance(M.read32(rec) | 0, M.read32((rec + 4) >>> 0) | 0, t0, t1, slotBase) | 0;
  const children = M.read32((anim + ANIM_CHILD_ARRAY) >>> 0) >>> 0;
  M.write32((children + idx * 4) >>> 0, instance | 0);
  host.clearSlot(slotBase, ANIM_SLOT_BYTES);
  M.write32(slotBase, ANIM_BIND_STATE);
  M.write32((slotBase + 0x08) >>> 0, ANIM_BIND_STATE);
  M.write32((slotBase + 0x14) >>> 0, modelHandle | 0);
  M.write32((slotBase + 0x04) >>> 0, key | 0);
  M.write32((slotBase + 0x34) >>> 0, flag | 0);
  M.write32((slotBase + 0x3c) >>> 0, 0);
  M.write32((slotBase + 0x38) >>> 0, ANIM_SLOT_LAYER_KEY);
}
