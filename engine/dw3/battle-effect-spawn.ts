// The effect-object spawner FIGHTSTG_F0x80089be4 — the routine the transformation
// driver (engine/dw3/battle-effect-driver.ts) and the action VM's op3 handler call
// to build one child effect object. It is the driver's OBSERVABLE OUTPUT: the
// Evolve screen's 0x3E8/0x3E9/0x3EA/0x3EB/0x3EF/0x3F0 effects are the objects this
// returns.
//
// Read from the raw words of web/assets/native/screens/pro_fightstg.bin
// (base 0x80082cb0) as printed in ~/ddw3/asm/dw2003/pro/fightstg.s L6989-L7051.
//
// WHAT IT DOES.
//
//   obj = alloc(class 0x80089a24, size 0x68, tag 0x78)     (F0x80014504)
//   obj+0x50 = -1
//   scan the registry at 0x800a2ea4, stride 8, while the entry's s16 id != -1:
//     if entry.id == type:
//       obj+0x50 = type
//       obj+0x54 = entry.field1 (s16 at +0x2)
//       obj+0x58 = entry.field2 (word at +0x4)
//       copy the caller's 8 table bytes verbatim to obj+0x5c..+0x63  (lwl/lwr pair)
//   if nothing matched (obj+0x50 is still -1): obj+0x28(3)  (F0x80014274, abort)
//   return obj
//
// The registry scan walks EVERY entry to the -1 terminator even after a match; a
// duplicate id would overwrite the fields. The 8-byte copy is a plain little-
// endian copy: the original's `lwl/lwr`+`swl/swr` pair at 0x5c/0x60 moves the same
// bytes a word copy would.
//
// The allocator and the base-object abort entry (obj+0x28, F0x80014274) are the
// only callees; both are named on `EffectSpawnHost` so the oracle can run the
// ORIGINAL words with recording stubs in their place and compare the object this
// builds to the port's.

/** The effect registry the spawner scans (stride 8, a -1 id terminates it). */
export const EFFECT_SPAWN_REGISTRY = 0x800a2ea4;
export const EFFECT_SPAWN_REGISTRY_STRIDE = 8;
export const EFFECT_SPAWN_REGISTRY_END = -1;
/** The allocated effect object: size, tag and class descriptor (F0x80089be4 L6998-L699c). */
export const EFFECT_OBJECT_SIZE = 0x68;
export const EFFECT_OBJECT_TAG = 0x78;
export const EFFECT_OBJECT_CLASS = 0x80089a24;
/** The object fields the spawner writes. */
export const EFFECT_OBJECT_TYPE = 0x50;
export const EFFECT_OBJECT_FIELD1 = 0x54;
export const EFFECT_OBJECT_FIELD2 = 0x58;
export const EFFECT_OBJECT_POS = 0x5c; // the 8 copied table bytes
export const EFFECT_OBJECT_STATE = 0x0c;
export const EFFECT_OBJECT_ABORT = 0x28;

export interface EffectSpawnMemory {
  read16s(addr: number): number;
  read32(addr: number): number;
  read8(addr: number): number;
  write32(addr: number, value: number): void;
  write8(addr: number, value: number): void;
}

export interface EffectSpawnHost {
  /** F0x80014504(classDescriptor, size, tag): the class-object allocator, returns the 0x68 object. */
  allocEffectObject(): number;
  /** obj+0x28 (F0x80014274): set the object's state word (+0x0c), clear +0x10/+0x14/+0x18. */
  setObjectState(obj: number, state: number): void;
}

/**
 * FIGHTSTG_F0x80089be4(type, tablePtr): build the effect object for `type`, copying
 * the caller's 8 table bytes to its +0x5c. Returns the object (never null).
 */
export function spawnEffectObject(
  mem: EffectSpawnMemory,
  host: EffectSpawnHost,
  type: number,
  tablePtr: number,
): number {
  const want = type | 0;
  const obj = host.allocEffectObject() | 0;
  mem.write32(obj + EFFECT_OBJECT_TYPE, -1);

  for (let p = EFFECT_SPAWN_REGISTRY; ; p += EFFECT_SPAWN_REGISTRY_STRIDE) {
    const id = mem.read16s(p) | 0;
    if (id === EFFECT_SPAWN_REGISTRY_END) break;
    if (id === want) {
      mem.write32(obj + EFFECT_OBJECT_TYPE, want);
      mem.write32(obj + EFFECT_OBJECT_FIELD1, mem.read16s(p + 2) | 0);
      mem.write32(obj + EFFECT_OBJECT_FIELD2, mem.read32(p + 4) | 0);
      // the lwl/lwr + swl/swr pair: 8 bytes, little-endian, verbatim.
      for (let i = 0; i < 8; i++) {
        mem.write8(obj + EFFECT_OBJECT_POS + i, mem.read8(tablePtr + i) & 0xff);
      }
    }
  }

  if ((mem.read32(obj + EFFECT_OBJECT_TYPE) | 0) === EFFECT_SPAWN_REGISTRY_END) {
    host.setObjectState(obj, 3);
  }
  return obj;
}
