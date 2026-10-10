// The battle overlay's task spawners — the small wrappers every fightstg screen
// object is built through. They are the shared allocator call, not per-object code.
//
// This is a port of two original pro/fightstg routines, read from the disc:
//   FIGHTSTG_F0x80090c44   fightstg.norm.s L14352-L14369  the fight task spawner
//   FIGHTSTG_F0x80093cc8   fightstg.norm.s L17535-L17545  the plate-HUD spawner
//
// WHY THIS IS A SHARED SYSTEM. Both bodies are the same call to the resident
// allocator F0x80014504(method, size, flags), then (for the fight task) two stores.
// F0x80014504 forwards (method,size,flags) to the resident object allocator
// (docs/research/scripting/event-machine-synthesis-2026-08-03.md) and installs the
// method as the new object's tick. So each address is one call site of the one
// mechanism, differing only in its constants — they are data variants, and this
// single port covers both (the registry's multi-address-single-port pattern).
//
// WHAT THE ORIGINAL DOES.
//   F0x80090c44(a0, a1): spawn F0x80014504(0x8008f714, 0x84, 4); store the byte a0
//     at +0x50 and the word a1 at +0x54 of the new object; return it. This is the
//     spawner the battle command phase uses, and it is also the routine a DNA
//     digivolution confirm calls (the wfightmn controller's DNA step enters it at
//     wfightmn.s:1884-1888; see engine/dw3/battle-action-sequencer.ts WA_OFF_TABLE_ROUTES).
//   F0x80093cc8():     spawn F0x80014504(0x80093a74, 0x88, 0x14); return it. This is
//     the plate HUD (method 0x80093a74 is battleHudBuildSeparator, the plate tick).
//
// The oracle tests/engine/unit/battle-task-spawn-oracle.test.ts runs the original
// words out of the committed fightstg overlay through engine/native, stubbing the
// resident allocator, and checks the (method,size,flags) each address passes and
// the two stores, with negative controls.

/** F0x80090c44's method argument (asm `lui $a0,0x8009 / addiu $a0,-0x8ec`). */
export const FIGHT_TASK_METHOD = 0x8008f714;
/** F0x80090c44's object size (asm `li $a1, 0x84`). */
export const FIGHT_TASK_SIZE = 0x84;
/** F0x80090c44's allocator flags (asm `li $a2, 0x4`). */
export const FIGHT_TASK_FLAGS = 4;
/** Where F0x80090c44 stores its byte argument (asm `sb $s0, 0x50($v0)`). */
export const FIGHT_TASK_ARG_BYTE_OFF = 0x50;
/** Where F0x80090c44 stores its word argument (asm `sw $s1, 0x54($v0)`). */
export const FIGHT_TASK_ARG_WORD_OFF = 0x54;

/** F0x80093cc8's method argument (asm `lui $a0,0x8009 / addiu $a0,0x3a74`). */
export const PLATE_HUD_METHOD = 0x80093a74;
/** F0x80093cc8's object size (asm `li $a1, 0x88`). */
export const PLATE_HUD_SIZE = 0x88;
/** F0x80093cc8's allocator flags (asm `li $a2, 0x14`). */
export const PLATE_HUD_FLAGS = 0x14;

/** The new object the spawner hands back: the byte and word fields it fills. */
export interface SpawnedObject {
  write8(off: number, v: number): void;
  write32(off: number, v: number): void;
}

/** The resident allocator F0x80014504, reduced to the three arguments it forwards. */
export type TaskSpawn = (method: number, size: number, flags: number) => SpawnedObject;

/**
 * FIGHTSTG_F0x80090c44: spawn the fight task through F0x80014504(0x8008f714,
 * 0x84, 4), then store the byte argument at +0x50 and the word argument at +0x54.
 */
export function spawnFightTask(spawn: TaskSpawn, argByte: number, argWord: number): SpawnedObject {
  const obj = spawn(FIGHT_TASK_METHOD, FIGHT_TASK_SIZE, FIGHT_TASK_FLAGS);
  obj.write8(FIGHT_TASK_ARG_BYTE_OFF, argByte & 0xff);
  obj.write32(FIGHT_TASK_ARG_WORD_OFF, argWord | 0);
  return obj;
}

/**
 * FIGHTSTG_F0x80093cc8: spawn the plate HUD through F0x80014504(0x80093a74,
 * 0x88, 0x14). The body does nothing else.
 */
export function spawnPlateHud(spawn: TaskSpawn): SpawnedObject {
  return spawn(PLATE_HUD_METHOD, PLATE_HUD_SIZE, PLATE_HUD_FLAGS);
}
