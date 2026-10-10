// The op6 projectile flight family of the battle overlay (pro/fightstg), read from
// the disc:
//   FIGHTSTG_F0x800897f8   fightstg.s L6720   the registry lookup (id -> file id)
//   FIGHTSTG_F0x80089844   fightstg.s L6745   the flight-object constructor
//   FIGHTSTG_F0x8008970c   fightstg.s L6658   the flight object's per-tick update
//                          — ALREADY PORTED as web/fight/proj-layers.js (the team's
//                          own port of the layer builder / clip playback); reused,
//                          not re-derived here.
//
// WHY THIS IS A SHARED SYSTEM.  Every op6 spawn (FIGHTSTG_F0x8008bea8, the action
// VM's projectile opcode) resolves its id through one 12-byte registry at
// 0x800a2550 and builds one flight object through F0x80089844; the object's own
// per-tick update is FIGHTSTG_F0x8008970c. The walker's browser driver
// (web/fight/effect-player.js) used to read the resolved manifest entry directly
// and hand-write the "is this id known" test; this module is the port of the
// original's registry scan and constructor, and tests/engine/unit/battle-projectile-oracle.test.ts
// runs the ORIGINAL instruction words through engine/native and compares them to it.
//
// WHAT A PLAYER SEES.  A Digimon's attack fires a mesh projectile (a MEFT00xx pack)
// that travels from the muzzle toward the target. The flight object built here is
// what that projectile IS: its launch anchor and orientation (the two vectors op6
// passes), the pack the registry resolved for its id, and the VRAM texture slots it
// draws from. Between firing and landing the object is ticked by F0x8008970c, whose
// math (the layer transforms and the compiled-clip lifetime) is the port in
// web/fight/proj-layers.js.
//
// REGISTRY.  12 bytes per entry, zero id terminates the list:
//   +0x0  id
//   +0x4  (file << 16) | descBin      descBin = the MEFT program table
//   +0x8  (file << 16) | metaBin      metaBin = the playback clip
// The extractor reads it as {id, (file<<16)|descBin, (file<<16)|metaBin} of which the
// browser manifest keeps only the resolved pack name (see tools/extract_fight_effects.py
// L521, L783). F0x800897f8 returns the signed halfword at +0x6, i.e. `file` — the id
// of the MEFT pack the projectile loads — which is what op6's sub==1 readiness poll
// (fightstg.s L9355) tests for non-zero.
//
// This module is DOM-free; the host owns meshes, atlases and the projection (both
// already ported: engine/dw3/battle-mesh.ts and web/fight/proj-layers.js).

/** The op6 projectile registry (fightstg D0x800a2550): 12 bytes per entry. */
export const PROJECTILE_REGISTRY_BASE = 0x800a2550;
/** The flight object's fixed texture-slot words (F0x80089844 @0x800898d0/d4). */
export const PROJECTILE_VRAM_X = 0x280;
export const PROJECTILE_VRAM_Y = 0x100;
/** The flight object is 0xc0 bytes (F0x80089844 @0x80089868). */
export const PROJECTILE_OBJECT_SIZE = 0xc0;
/** The end-entry argument F0x80089844 passes (a1=3 @0x80089954) when the id is unregistered. */
export const PROJECTILE_END_UNREGISTERED = 3;
/** Bytes of each op6 vector the constructor copies into the object's two slots. */
export const PROJECTILE_VECTOR_BYTES = 8;

const s16 = (v: number): number => (v << 16) >> 16;

/** One 12-byte registry row: the id and its two packed words. */
export interface ProjectileRegistryEntry {
  id: number;
  /** +0x4: (file << 16) | descBin. */
  w1: number;
  /** +0x8: (file << 16) | metaBin. */
  w2: number;
}

/**
 * FIGHTSTG_F0x800897f8: scan the registry for the first entry whose id matches and
 * return the signed halfword at entry+0x6 (the packed `file` id). Returns 0 when the
 * list is empty or no entry matches. The list is terminated by a zero id, and a
 * property of the disc data — not the code — is that no entry has id 0.
 */
export function projectileFileForId(entries: readonly ProjectileRegistryEntry[], id: number): number {
  const first = entries[0];
  if (!first || (first.id | 0) === 0) return 0;
  for (const e of entries) {
    if ((e.id | 0) === 0) break;
    if ((e.id | 0) === (id | 0)) return s16((e.w1 | 0) >>> 16);
  }
  return 0;
}

/**
 * A live flight object (the 0xc0-byte allocation F0x80089844 builds, updated by
 * F0x8008970c). Field offsets are the original's.
 */
export interface ProjectileFlight {
  /** +0x50 registry key; 0 means the id was NOT registered. */
  key: number;
  /** +0x54 the registry's +0x4 word (file<<16 | descBin). */
  regW1: number;
  /** +0x58 the registry's +0x8 word (file<<16 | metaBin). */
  regW2: number;
  /** +0x5c..+0x63 the launch triple copied from op6's first vector (four halfwords). */
  vecA: number[];
  /** +0x64..+0x6b the orientation triple copied from op6's second vector (four halfwords). */
  vecB: number[];
  /** +0x6c the fixed VRAM x slot. */
  slotA: number;
  /** +0x70 the fixed VRAM y slot. */
  slotB: number;
  /** True when the registry held the id; false means the object was ended(3) at once. */
  registered: boolean;
}

/** Read `n` halfwords at `src[i]`, zero-filling past the end (the disc vector is 8 bytes). */
function halfwords(vec: readonly number[], n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((vec[i] ?? 0) & 0xffff);
  return out;
}

/**
 * FIGHTSTG_F0x80089844: build the op6 flight object. `entries` is the registry,
 * `id` the op6 id, and `vecA`/`vecB` are op6's two vectors (launch anchor and the
 * root-rotation triple). Returns the object; when `registered` is false the original
 * has already called the object's +0x28 end entry with 3, exactly as its unregistered
 * path does (@0x80089944-0x80089958) — the caller models that by checking the flag.
 */
export function newProjectileFlight(
  entries: readonly ProjectileRegistryEntry[],
  id: number,
  vecA: readonly number[],
  vecB: readonly number[],
): ProjectileFlight {
  // On the unregistered path the original never writes +0x5c..0x6b, so the two
  // vectors stay empty here rather than being optimistically copied.
  const obj: ProjectileFlight = {
    key: 0, regW1: 0, regW2: 0,
    vecA: [], vecB: [],
    slotA: 0, slotB: 0, registered: false,
  };
  const first = entries[0];
  // @0x80089890: an empty list skips the walk entirely (the key stays 0).
  if (!first || (first.id | 0) === 0) return obj;

  for (const e of entries) {
    if ((e.id | 0) === 0) break;              // the zero-id terminator (@0x8008982c/992c)
    if ((e.id | 0) !== (id | 0)) continue;
    obj.key = id | 0;                         // @0x800898b4
    obj.regW2 = e.w2 | 0;                     // @0x800898c0
    obj.regW1 = e.w1 | 0;                     // @0x800898cc
    obj.slotA = PROJECTILE_VRAM_X;            // @0x800898d0
    obj.slotB = PROJECTILE_VRAM_Y;            // @0x800898d4
    obj.vecA = halfwords(vecA, PROJECTILE_VECTOR_BYTES / 2); // @0x800898d8-0x800898f4
    obj.vecB = halfwords(vecB, PROJECTILE_VECTOR_BYTES / 2); // @0x800898f8-0x80089914
    obj.registered = true;
    break;
  }
  return obj;
}

/** Build registry entries from the browser manifest's `projectiles` map.
 *
 * The manifest keeps only the resolved pack name for each id (tools/extract_fight_effects.py
 * replaces the packed `file`/desc/meta words with the resolved pack), so the numeric
 * words are not recoverable there; the manifest tells us only that the id is
 * registered. The pack lookup the browser actually renders from is by id, so the
 * `w1`/`w2` words are carried as zero here and only `registered` is consumed. */
export function projectileRegistryFromIds(ids: readonly number[]): ProjectileRegistryEntry[] {
  return ids.map((id) => ({ id: id | 0, w1: 0, w2: 0 }));
}
