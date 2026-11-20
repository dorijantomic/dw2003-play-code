// web/ordinal-scene-variant.js
//
// Browser mirror of engine/systems/ordinal-scene-variant.ts — the field's
// sixteen-ordinal scene variant. The engine module is canonical; this plain-JS
// copy exists because web/game.js loads the prebuilt bundle and the bundle must
// not be regenerated for a consumer-only change (the same reason web/packed-sound.js
// mirrors engine/systems/packed-sound.ts). The engine test re-derives the ordinal
// set from the disc's two jump tables AND asserts this mirror's set equals it, so
// the two cannot drift.
//
// Decode: fieldstg F0x80091E60 (scene init) and F0x80084B40 (map/point-slot
// setup) each read the master story ordinal 0x8004B370, subtract 5, bound it with
// `sltiu $v0,$v1,0x23`, and dispatch through a 35-entry jump table (RAM 0x800836F8
// and 0x80082D74). Sixteen slots take the variant arm:
//   5, 8, 12, 14, 16, 22, 24, 26, 28, 30, 31, 34, 36, 37, 38, 39
// The scene init's variant arm sets the descriptor BGM play id (+0x40) to
// 0x61080000 (env204 track 0) where the default is 0x61080002 (env204 track 2).

export const SCENE_VARIANT_TABLE_FIRST = 5;
export const SCENE_VARIANT_TABLE_LEN = 0x23;
export const SCENE_VARIANT_ORDINALS = [
  5, 8, 12, 14, 16, 22, 24, 26, 28, 30, 31, 34, 36, 37, 38, 39,
];
export const SCENE_VARIANT_MUSIC_ID = 0x42;
export const SCENE_BGM_DEFAULT_PLAY_ID = 0x61080002;
export const SCENE_BGM_VARIANT_PLAY_ID = 0x61080000;
export const SCENE_BGM_DEFAULT_TRACK = "env204_2";
export const SCENE_BGM_VARIANT_TRACK = "env204";

// The record tag the map setup's chain walk matches (`li $a1, 0x1`,
// F0x80084B40.s .L0x00001f08) — the record byte at +1 the extractor carries as
// `atlasFlag`. Same tag stage-slot-player / stage-slot writers claim by.
export const SCENE_VARIANT_SLOT_TAG = 1;
export const SCENE_VARIANT_SLOT_FLAG = 1;
export const SCENE_DEFAULT_SLOT_FLAG = 0;

export function sceneVariantActive(ordinal) {
  return SCENE_VARIANT_ORDINALS.includes(ordinal);
}

/**
 * WHICH display-slot record the map setup's variant flag lands on, a port of the
 * chain walk at the head of F0x80084B40. The FIRST record whose byte+1 equals
 * SCENE_VARIANT_SLOT_TAG wins; the walk otherwise ends on the size==0 terminator
 * (returns -1). Read from the raw words: m2c's lifted C drops record 0's tag by
 * folding the `beq` delay slot. `records` is point_sprites.json in memory order.
 */
export function sceneVariantSlotIndex(records) {
  if (!records || records.length === 0) return -1;
  if (!records[0].size) return 0;
  for (let i = 0; i < records.length; i++) {
    if (records[i].atlasFlag === SCENE_VARIANT_SLOT_TAG) return i;
    const next = records[i + 1];
    if (!next || !next.size) return -1;
  }
  return -1;
}

/** The byte the map setup writes into that slot: 1 on a variant beat, else 0. */
export function sceneVariantSlotActive(ordinal) {
  return sceneVariantActive(ordinal) ? SCENE_VARIANT_SLOT_FLAG : SCENE_DEFAULT_SLOT_FLAG;
}

export function sceneBgmPlayId(ordinal) {
  return sceneVariantActive(ordinal) ? SCENE_BGM_VARIANT_PLAY_ID : SCENE_BGM_DEFAULT_PLAY_ID;
}

/** The background track for a screen whose own track is `defaultTrack`. */
export function sceneBgmTrack(defaultTrack, ordinal) {
  if (defaultTrack === SCENE_BGM_DEFAULT_TRACK && sceneVariantActive(ordinal)) {
    return SCENE_BGM_VARIANT_TRACK;
  }
  return defaultTrack;
}
