// engine/systems/ordinal-scene-variant.ts
//
// The field's story-ordinal scene variant — the one hard-coded set of story
// beats at which the overworld boots its scene a second way.
//
// WHAT A PLAYER MEETS: walk into the Cargo Tower (the field screen whose own
// background track is `env204` track 2) while the story stands on one of these
// sixteen beats and the room plays a DIFFERENT background track — `env204`
// track 0 — instead of the default. Every other visit, and every other screen,
// is unchanged. The set was mis-described in the field docs as "sixteen ids
// getting a special background treatment"; the sixteen numbers are story
// ordinals, not asset ids, and the treatment is a background-track variant.
//
// DECODE — ~/ddw3/asm/dw2003/pro/fieldstg.s (overlay base 0x80082CB0)
// and exe-decomp/fieldstg_c:
//
//   * The scene object's init `F0x80091E60` (file 0x0F1B0) first writes the
//     descriptor 0x80099D80 its defaults — map pack 0x1AC, the point-sprite
//     table 0x800996C4, the WS4 program 0x800997C0, collision 0x32C, the cast
//     list 0x800994F4, and the two sound fields: +0x3C (music id) = 0x42 = 66
//     and +0x40 (BGM play id) = 0x61080002. It then boots the zone manager.
//     The archive id 66 is the `env204` bank and play id 0x61080002 is its
//     track 2 (map_sound_archives.json: s261/s934 = archive 66, bank env204,
//     play_id 0x61080002; the walker ships that screen's music as "env204_2").
//   * At the END of the same init (file 0x0F2CC) it reads the master story
//     ordinal `[0x8004B370]`, computes `ordinal - 5`, bounds it with
//     `sltiu $v0, $v1, 0x23` (ordinal in [5, 40)), and dispatches through a
//     35-entry table at RAM 0x800836F8. The 16 table slots that point at
//     `.L_F0x80091FB4` fall through to a store of 0x61080000 into the
//     descriptor's BGM play id (+0x40); every other slot (and every ordinal
//     outside the range) points at `.L_F0x80091FCC`, which returns without a
//     store. So those sixteen ordinals pick `env204` track 0 (0x61080000) as
//     the default (file 0x0F304-0x0F318: `li $v1,0x6108` / `sw $v1,0x40($v0)`).
//   * The SAME 35-entry jump-table shape sits in the map/point-slot setup
//     `F0x80084B40` (file 0x1E90), table at RAM 0x80082D74 (file 0x00C4),
//     same bound `sltiu $v0, $v1, 0x23`. Its variant arm
//     (`.L_F0x80084C14`) stores 1 into the first byte of a resident
//     point-sprite/display record and its default arm
//     (`.L_F0x80084C20`) stores 0 — the display-slot state flag, not a draw.
//     The two tables name exactly the same sixteen ordinals.
//
// Both jump tables were read programmatically from their closures:
// exe-decomp/fieldstg_c/_asm/F0x80091e60.s (.rodata below the label) and
// F0x80084b40.s. The variant ordinals are:
//   5, 8, 12, 14, 16, 22, 24, 26, 28, 30, 31, 34, 36, 37, 38, 39
//
// This is a shared rule in the sense the original keeps it one: the same
// sixteen-slot condition gates both the boot and the map setup, so the walker
// can answer "is the field's background variant on for this beat" once.

/** First ordinal the jump table covers (`ordinal - 5`, the `addiu $v1,$v0,-5`). */
export const SCENE_VARIANT_TABLE_FIRST = 5;
/** Table length (`sltiu $v0,$v1,0x23`); ordinals 5..39 inclusive. */
export const SCENE_VARIANT_TABLE_LEN = 0x23;

/**
 * The sixteen story ordinals whose jump-table slot selects the scene variant —
 * the `.L_F0x80091FB4` / `.L_F0x80084C14` arms of the tables at RAM 0x800836F8
 * and 0x80082D74. The other 19 slots in [5,40) take the default arm.
 */
export const SCENE_VARIANT_ORDINALS: readonly number[] = [
  5, 8, 12, 14, 16, 22, 24, 26, 28, 30, 31, 34, 36, 37, 38, 39,
];

/** Descriptor +0x3C (music id) the init writes in both arms: 0x42 = 66 = env204. */
export const SCENE_VARIANT_MUSIC_ID = 0x42;
/** Descriptor +0x40 (BGM play id) written before the switch — env204 track 2. */
export const SCENE_BGM_DEFAULT_PLAY_ID = 0x61080002;
/** Descriptor +0x40 on a variant ordinal — env204 track 0. */
export const SCENE_BGM_VARIANT_PLAY_ID = 0x61080000;
/** The walker's track name for play id 0x61080002 (manifest.json, s261). */
export const SCENE_BGM_DEFAULT_TRACK = "env204_2";
/** The walker's track name for play id 0x61080000 (play-id low bits = track). */
export const SCENE_BGM_VARIANT_TRACK = "env204";

/** The display-slot state byte the map setup writes: 1 on a variant ordinal. */
export const SCENE_VARIANT_SLOT_FLAG = 1;
/** Its default: 0. */
export const SCENE_DEFAULT_SLOT_FLAG = 0;

/**
 * The record tag the map setup's walk matches — `li $a1, 0x1` before its chain
 * walk (F0x80084B40.s `.L0x00001f08`), the record byte at +1 the walk compares.
 * It is the same byte `tools/extract_point_sprites.py` carries as `atlasFlag`
 * and the same tag `engine/systems/stage-slot-player.ts` claims by.
 */
export const SCENE_VARIANT_SLOT_TAG = 1;

/** True when `ordinal` is one of the sixteen variant beats. */
export function sceneVariantActive(ordinal: number): boolean {
  return SCENE_VARIANT_ORDINALS.includes(ordinal);
}

/**
 * WHICH display-slot record the map setup's variant flag lands on, a port of the
 * chain walk at the head of F0x80084B40 (`.L0x00001ef0`–`.L0x00001f28`).
 *
 * The field's ambient chain head is `[0x80099D90]` (the scene descriptor
 * 0x80099D80's +0x10). The walk steps records in 0x12-byte strides and stops on
 * the FIRST record whose byte+1 equals {@link SCENE_VARIANT_SLOT_TAG}, or on the
 * terminator (byte+2 == 0) when none matches; the store at `.L_F0x80084c14` /
 * `.L_F0x80084c20` then writes that record's byte+0 (the live/active byte).
 *
 * The FIRST match wins — read from the raw words, not the lifted C. m2c folds
 * the `beq` delay slot (`addiu $v1, 0x12` at `.L0x00001f18`) to the front of the
 * loop, so its rendering starts testing at record 1 and silently drops record 0's
 * tag; the assembly compares record 0 first (`lbu $v0, 0x2($a0)` size probe, then
 * `lbu $v0, -0x1($v1)` tag with `$v1 = $a0 + 2`).
 *
 * Returns the record's index, or -1 when the walk lands on the terminator (a
 * size==0 record the extracted chain does not carry, so there is nothing the
 * walker can light up). `records` is the stage's `point_sprites.json` record
 * array in memory order.
 */
export function sceneVariantSlotIndex(
  records: readonly { atlasFlag: number; size: number }[],
): number {
  if (records.length === 0) return -1;
  // The head is already the terminator: the walk ends where it started.
  if (!records[0]!.size) return 0;
  for (let i = 0; i < records.length; i++) {
    if (records[i]!.atlasFlag === SCENE_VARIANT_SLOT_TAG) return i;
    const next = records[i + 1];
    if (!next || !next.size) return -1; // the terminator ends the walk
  }
  return -1;
}

/**
 * The byte the map setup writes into the slot {@link sceneVariantSlotIndex}
 * names: 1 on a variant beat, 0 otherwise (F0x80084B40's two arms).
 */
export function sceneVariantSlotActive(ordinal: number): number {
  return sceneVariantActive(ordinal) ? SCENE_VARIANT_SLOT_FLAG : SCENE_DEFAULT_SLOT_FLAG;
}

/**
 * The descriptor BGM play id for a story ordinal: the variant 0x61080000 on the
 * sixteen beats, the default 0x61080002 otherwise — F0x80091E60's post-switch
 * `+0x40` value (`li $v1,0x6108; sw $v1,0x40($v0)` at file 0x0F304).
 */
export function sceneBgmPlayId(ordinal: number): number {
  return sceneVariantActive(ordinal) ? SCENE_BGM_VARIANT_PLAY_ID : SCENE_BGM_DEFAULT_PLAY_ID;
}

/**
 * The background track the field should play for a screen whose own track is
 * `defaultTrack`, at this story ordinal. Only the env204 default is variant-
 * bearing in the corpus (the scene init writes exactly this pair), so any other
 * track is returned unchanged. Keys on the track name because that is what the
 * walker's manifest carries; the play-id pair above is the disc's own form.
 */
export function sceneBgmTrack(defaultTrack: string, ordinal: number): string {
  if (defaultTrack === SCENE_BGM_DEFAULT_TRACK && sceneVariantActive(ordinal)) {
    return SCENE_BGM_VARIANT_TRACK;
  }
  return defaultTrack;
}
