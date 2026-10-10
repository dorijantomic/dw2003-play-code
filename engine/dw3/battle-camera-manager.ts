// The battle CAMERA MANAGER's own methods — the routines the fightstg object of
// class 0x12 (constructor FIGHTSTG_F0x80092618) installs into its method table.
// The manager is the object the transformation driver fetches as its +0x54 field
// and calls +0xf8/+0xfc/+0x100/+0x104 on; the canned-shot loader +0x104 is the same
// routine docs/research/fight-3d/battle-camera.md §"2026-08-18" names.
//
// They are constructor-installed, so the disassembler's entry list misses them.
// Each was read from ~/ddw3/asm/dw2003/pro/fightstg.s against the committed words
// of web/assets/native/screens/pro_fightstg.bin (base 0x80082cb0):
//
//   +0xf8   FIGHTSTG_F0x80092244  stage the 0x34-byte camera record      → cameraManagerCopyRecord
//   +0xfc   FIGHTSTG_F0x800922b4  blend two records into the manager     → cameraManagerBlend
//   +0x100  FIGHTSTG_F0x8009257c  re-take the NF_00 slot's shot          → cameraManagerResetShot
//   +0x104  FIGHTSTG_F0x800923b4  load a canned shot out of a model rec  → cameraManagerCannedShot
//
// The manager object is 0x108 bytes (F0x80092618 allocates class 0x80091df4). The
// two staging records sit at +0x54 and +0x88/+0xbc; +0xf0 is the 0x1000/0 marker and
// +0xf4 the 0x10000/divisor blend step. The camera record every shot is written to is
// D0x800a46d8 — the same address the driver calls `EFFECT_DRIVER_SFX_OFFSET_TABLE`.
//
// Boundaries kept on the host (they belong to other systems): objectFetch (class
// 0x12/0x14 lookup, [0x8004b7bc]), the model-record getter [0x800a4570], the actor
// state object [0x800a4558] (+0x18 tick and the +0x44 shot count), and the
// base-object state entry mgr+0x28 (F0x80014274).

import { animSlotModel, type AnimObjectMemory } from "./battle-anim-object.ts";

/** The camera record every manager shot writes (`D0x800a46d8`). */
export const CAMERA_RECORD = 0x800a46d8;
/** The manager's allocated size (F0x80092618's factory argument). */
export const CAMERA_MANAGER_SIZE = 0x108;
/** The class descriptor F0x80092618 allocates (0x80091df4) and its tag (0x12). */
export const CAMERA_MANAGER_CLASS = 0x80091df4;
export const CAMERA_MANAGER_TAG = 0x12;
/** The animation object fetched for a canned shot's model (class 0x14). */
export const CAMERA_ANIM_CLASS = 0x14;
/** The manager's method table, exactly the addresses F0x80092618 stores. */
export const CAMERA_MANAGER_METHODS: readonly (readonly [number, number])[] = [
  [0xf8, 0x80092244], [0xfc, 0x800922b4], [0x100, 0x8009257c], [0x104, 0x800923b4],
];
/** The staged-record byte count every copy moves (the original's 0x30 loop + 1 word). */
export const CAMERA_STAGE_BYTES = 0x34;
/** The marker the +0xf8/+0xfc staging writes at manager+0xf0. */
export const CAMERA_STAGE_MARKER = 0x1000;

export interface CameraManagerMemory extends AnimObjectMemory {
  write16(addr: number, value: number): void;
}

export interface CameraManagerHost {
  /** `[0x8004b7bc](id)` — the object registry lookup (class 0x14 = the animation object). */
  objectFetch(id: number): number;
  /** `[0x800a4570](handle)` — the model-record getter (environment boundary). */
  resourceGet(handle: number): number;
  /** mgr+0x28(state) — the base-object state entry (F0x80014274). */
  baseSetState(mgr: number, state: number): void;
}

/** `[0x800a4558 + 0x14]` — the actor state object the +0x100 path counts shots on. */
export const ACTOR_STATE_PTR = 0x800a456c;

/** The 0x34-byte record copy the two staging methods share (word-aligned, 13 words). */
function copyRecord(M: CameraManagerMemory, dest: number, src: number): void {
  for (let off = 0; off < CAMERA_STAGE_BYTES; off += 4) {
    M.write32((dest + off) >>> 0, M.read32((src + off) >>> 0) | 0);
  }
}

/**
 * FIGHTSTG_F0x80092244 (the +0xf8 method): copy `src`'s 0x34-byte record into the
 * manager's +0x54 stage, set the 0x1000 marker at +0xf0, and re-run the base object's
 * state entry with 2. Read at fightstg.s L15761-L15789. The driver calls it with
 * `src` = the camera record D0x800a46d8.
 */
export function cameraManagerCopyRecord(M: CameraManagerMemory, host: CameraManagerHost, mgr: number, src: number): void {
  copyRecord(M, (mgr + 0x54) >>> 0, src | 0);
  M.write32((mgr + 0xf0) >>> 0, CAMERA_STAGE_MARKER);
  host.baseSetState(mgr | 0, 2);
}

/**
 * FIGHTSTG_F0x800922b4 (the +0xfc method): stage a 0x34-byte record at +0xbc (from
 * `srcA`, or from the +0x54 stage when `srcA` is null), stage `srcB` at +0x88, set the
 * blend step `+0xf4 = 0x10000 / divisor`, re-run the base state entry with 2 and clear
 * +0xf0. Read at fightstg.s L15792-L15856.
 */
export function cameraManagerBlend(
  M: CameraManagerMemory, host: CameraManagerHost,
  mgr: number, srcA: number, srcB: number, divisor: number,
): void {
  copyRecord(M, (mgr + 0xbc) >>> 0, (srcA | 0) !== 0 ? srcA : ((mgr + 0x54) >>> 0));
  copyRecord(M, (mgr + 0x88) >>> 0, srcB | 0);
  M.write32((mgr + 0xf4) >>> 0, Math.trunc(0x100000 / (divisor | 0)) | 0);
  host.baseSetState(mgr | 0, 2);
  M.write32((mgr + 0xf0) >>> 0, 0);
}

/**
 * FIGHTSTG_F0x800923b4 (the +0x104 method): load the canned shot `shot` of `slotId`
 * into the camera record D0x800a46d8 and re-run the manager's state entry with 2.
 *
 * Read at fightstg.s L15859-L15973. It fetches the animation object (class 0x14),
 * resolves `slotId`'s model handle through the object's +0x190 (animSlotModel),
 * resolves THAT through `[0x800a4570]` to the model's section base, and reads the
 * shot's six halfword vectors and its H. The NEAR side (slotId & 0xf0 == 0) reads eye
 * at +0x1a, target at +0x62 and H at +0xaa + 2*shot; the FAR side reads eye at +0x1a,
 * target at +0x2c and H at +0x3e + 2*shot. Eye and target have Y and Z negated. The
 * shot's anchor and angles are then zeroed (+0x18/+0x1c/+0x20/+0x24/+0x26/+0x28/+0x2c).
 * Returns the camera record pointer, exactly as the original returns D0x800a46d8.
 */
export function cameraManagerCannedShot(
  M: CameraManagerMemory, host: CameraManagerHost,
  mgr: number, slotId: number, shot: number,
): number {
  const anim = host.objectFetch(CAMERA_ANIM_CLASS) | 0;
  if (anim === 0) return CAMERA_RECORD >>> 0;
  const handle = animSlotModel(M, anim, slotId | 0);
  if (handle === 0) return CAMERA_RECORD >>> 0;
  const base = host.resourceGet(handle) | 0;
  const rec = (base + (shot | 0) * 6) >>> 0;
  const far = ((slotId | 0) & 0xf0) !== 0;
  const neg = (v: number): number => (-(v | 0)) | 0;
  M.write32(CAMERA_RECORD + 0x00, M.read16s(rec + 0x1a) | 0);
  M.write32(CAMERA_RECORD + 0x04, neg(M.read16s(rec + 0x1c)));
  M.write32(CAMERA_RECORD + 0x08, neg(M.read16s(rec + 0x1e)));
  const tgt = far ? 0x2c : 0x62;
  M.write32(CAMERA_RECORD + 0x0c, M.read16s(rec + tgt) | 0);
  M.write32(CAMERA_RECORD + 0x10, neg(M.read16s(rec + tgt + 2)));
  M.write32(CAMERA_RECORD + 0x14, neg(M.read16s(rec + tgt + 4)));
  const hOff = (far ? 0x3e : 0xaa) + (shot | 0) * 2;
  M.write32(CAMERA_RECORD + 0x30, M.read16s((base + hOff) >>> 0) | 0);
  // The canned shot carries no anchor and no angles.
  M.write16(CAMERA_RECORD + 0x24, 0);
  M.write16(CAMERA_RECORD + 0x26, 0);
  M.write16(CAMERA_RECORD + 0x28, 0);
  M.write32(CAMERA_RECORD + 0x18, 0);
  M.write32(CAMERA_RECORD + 0x1c, 0);
  M.write32(CAMERA_RECORD + 0x20, 0);
  M.write32(CAMERA_RECORD + 0x2c, 0);
  host.baseSetState(mgr | 0, 2);
  return CAMERA_RECORD >>> 0;
}

/**
 * FIGHTSTG_F0x8009257c (the +0x100 method): re-take the far (key 0x10) slot's shot.
 *
 * Read at fightstg.s L15976-L16015. It fetches the animation object, resolves the
 * key-0x10 slot's model handle (0 returns), re-resolves that handle through
 * `[0x800a4570]` (the same getter cell the manager's +0x104 uses), reads the actor
 * state's shot count at `[[0x800a4558+0x14]+0x44]` and loads shot `count - 1` of slot
 * 0. Returns the camera record pointer.
 */
export function cameraManagerResetShot(M: CameraManagerMemory, host: CameraManagerHost, mgr: number): number {
  const anim = host.objectFetch(CAMERA_ANIM_CLASS) | 0;
  if (anim === 0) return CAMERA_RECORD >>> 0;
  const handle = animSlotModel(M, anim, 0x10);
  if (handle === 0) return CAMERA_RECORD >>> 0;
  host.resourceGet(handle);
  const actor = M.read32(ACTOR_STATE_PTR) >>> 0;
  const count = M.read16s((actor + 0x44) >>> 0) | 0;
  return cameraManagerCannedShot(M, host, mgr, 0, count - 1);
}
