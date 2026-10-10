// engine/systems/ambush-tile.ts
//
// Ambush tiles — the scripted forced encounter fourteen stages start from a
// marked patch of floor. Walk onto it and you are dropped straight into a fight
// with one of that area's own monsters: Kuwagamon in West Wire Forest, Crabmon
// at Divermon's Lake, the red Numemon in the Fire Dungeon. No cutscene, no NPC.
//
// DECODE: the step record's event is handled by the RESIDENT fieldstg routine
// F0x8008bf38 rather than by the stage overlay, which is why these tiles were
// invisible until the event-table scan learned to follow resident handlers.
// The routine carries no enemy id — it reads slot 5 of the stage's own
// scripted (rate-0) encounter block and hands that screen id to the ordinary
// battle-setup path, so the party comes from the same authentic table every
// random encounter uses. Layout, addresses and the flag argument are in
// tools/extract_forced_encounters.py and
// docs/research/field/ambush-tile-forced-encounter-2026-07-28.md.
//
// THE SHARED LATCH. All fourteen gate on ONE flag (0x0f) being clear, and the
// routine sets that same flag when it fires, so they share a single latch rather
// than owning one each the way the Fire Dungeon's traps do.
//
// It is a PER-VISIT latch: it exists to stop the step VM relaunching the fight
// every tick while you stand on the patch, and entering the area clears it, so
// the ambush is armed again on every visit. That clear is the one part taken
// from play rather than the disassembly (Minotarumon meets you every time you
// drop into Protocol Ruins); no clearing site has been found in the corpus, and
// the queries that came up empty cannot see a clear through a computed
// register, so it is an open question rather than a proven absence. The host
// owns the flag: this module only reports which flag to read and write.

export interface AmbushTile {
  /** Story-step indexes whose trigger-grid cells are the patch. */
  stepIndexes: readonly number[];
  eventId: number;
  /** Flag that must be CLEAR for the tile to fire, and that firing sets. */
  gateFlag: number;
  /** Global screen id — indexes the same table random encounters use. */
  screenId: number;
  /** The record's middle word. A battle type/param, not an enemy id. */
  param: number;
  music: string;
}

/**
 * The ambush tile the player is standing on, or null.
 *
 * `cellValue` is the raw type-7 trigger byte under them; only its low 5 bits
 * are the step index (the top 3 are the required approach-facing group), the
 * same mask the OnStep trigger VM applies.
 *
 * This answers "is there a tile here", NOT "should it fire" — the caller still
 * has to check `gateFlag` against the live flag store, because that flag is
 * shared across every stage that has one of these.
 */
export function ambushTileAt(
  tile: AmbushTile | null | undefined,
  cellValue: number | null,
): AmbushTile | null {
  if (!tile || cellValue == null) return null;
  return tile.stepIndexes.includes(cellValue & 0x1f) ? tile : null;
}
