// engine/dw3/encounters.ts
// Pure, testable field random-encounter selection, faithful to the decoded PS1 disasm.
// No DOM/fetch. Randomness injected via `rng` (RAND_U16; only the low 3 bits are used, &7).
// Ported from web/encounters.js.
//
// Authority: docs/research/battle-invocation.md — "Encounter selection" + "the zone map".
//   zone   = zonecheck(player.x, player.y) & 0xff   ; 1-based, 0 = none
//   block  = stage.zones[group*4 + (zone - 1)]       ; the zone's 8-slot pool
//                                                    ; group = the live scene+0x20 record
//   slot   = rand() & 7                              ; uniform over EIGHT slots
//   screen = block.slots[slot]                       ; 0 = no encounter this roll
//   party  = field_encounters.screens[screen]        ; 1–3 enemies

export type ZoneLook =
  | undefined
  | { uniform: number }
  | { cell: number; w: number; h: number; grid: number[] };

export interface ZoneBlock {
  slots: number[];
  /** Index into ENCOUNTER_RATE_TABLE — the zone block's leading word. */
  rate_level?: number;
}

// ---------------------------------------------------------------------------
// Zone GROUPS — scene_struct+0x20 is ONE selector record, not a flat array
// (decoded 2026-07-27 from the wstag overlays' own init code).
//
// The selector reads `block = *(scene_ctx[0x80099da0] + (zone-1)*4 + 0xc)`, and
// 0x80099da0 is `scene_struct + 0x20`: a pointer to one record
//     struct SelectorRecord { u32 tag; u32 key; u32 zero; ZoneBlock *zone[4]; }
// Each record owns exactly FOUR zone blocks, so `stage.zones[]` (overlay file
// order) is group-major / zone-minor:  flat index = group*4 + (zone - 1).
// Structural cross-check across all 203 stages with zone blocks: every stage has
// `4 * records` blocks and every record's pointers are the contiguous run
// [4g, 4g+1, 4g+2, 4g+3] — 0 exceptions.
//
// 164 stages carry a single record and are therefore unaffected: they ship no
// `groups`/`selector` key and every code path below degrades to `zones[zone-1]`.
//
// Which record the stage's init stores comes in two families:
//   * "progress_ordinal" (12 stages) — an `slti` chain on the master story
//     ordinal [0x8004b370]. Thresholds are the literal `slti` constants,
//     re-derived per stage by interpreting the overlay's init MIPS
//     (tools/extract_stage_encounters.py, `progress_selector`).
//   * "runtime_key" (27 stages — Seabed/Circuit s825-s895 + the s96x endgame
//     maps) — the init hands the record table to the fieldstg helper at
//     `scene_struct + 0x7c`, which matches a record by its `key` word against
//     the u16 at [0x80048d78]. **That key is the ENTRY WARP'S OWN PARAMETER**
//     (decoded 2026-07-27): the warp executor F0x800885d4's active case stores
//     `cmd+0x14 -> 0x80048d78` and `cmd+0x16 -> 0x80048d7a` unconditionally at
//     RAM 0x800886b8-0x800886dc; a second writer is F0x8008aa10. The step record
//     holds `op` at +0x8 and `params[i]` at 0xa+2i, so **params[5] IS the +0x14
//     field**. All 26 `op=10` warps in the shipped step data target a
//     multi-group stage and none targets a stage without one; every entrance to
//     a given stage carries a DISTINCT key, and every key is one of the
//     destination's own group keys (5/5 stages). So which door you enter by
//     selects the live record. Callers pass it as `entryKey`; when it is absent
//     or unmatched this module still falls back to group 0.
//     Ledger: encounter-zone-group-key-written-on-map-transition.
// ---------------------------------------------------------------------------

export interface EncounterGroup {
  /** The record's leading word (a global zone-set id). */
  tag?: number;
  /** The record's second word — what the `runtime_key` helper matches on. */
  key?: number;
  /** Indices into `stage.zones[]`, one per 1-based zone (length 4). */
  blocks: number[];
}

export interface EncounterSelector {
  family: "progress_ordinal" | "runtime_key" | string;
  /** RAM address of the scalar the init reads (progress_ordinal only). */
  var?: string;
  /** Overlay file offset of the load that drives the choice. */
  site?: string;
  /** Literal `slti` constants, in code order (progress_ordinal only). */
  thresholds?: number[];
  /** Group index chosen per band; length = thresholds.length + 1. */
  groups?: number[];
  /** True when the family is decoded but the selecting value is not. */
  unresolved?: boolean;
}

export interface StageEncounters {
  zones: ZoneBlock[];
  /** Absent on single-record stages. */
  groups?: EncounterGroup[];
  selector?: EncounterSelector;
}

/**
 * The group (selector record) the stage init has live.
 *
 * `progress_ordinal` stages pick from the master story ordinal; `runtime_key`
 * stages pick by matching a record's `key` against `entryKey`, the parameter
 * carried by the warp the player entered through (step record `params[5]`).
 *
 * Returns 0 for a single-group stage, for a stage whose selector is missing, and
 * for a `runtime_key` stage whose key is absent or matches no record — all of
 * which reproduce the flat `zones[zone-1]` behaviour exactly.
 */
export function encounterGroupIndex(
  stage: StageEncounters | undefined, progressOrdinal: number, entryKey?: number,
): number {
  const groups = stage?.groups;
  if (!groups || groups.length < 2) return 0;
  const sel = stage!.selector;
  if (!sel) return 0;
  if (sel.family === "runtime_key") {
    if (!Number.isFinite(entryKey as number)) return 0;
    const i = groups.findIndex((g) => g.key === entryKey);
    return i >= 0 ? i : 0;
  }
  if (sel.family !== "progress_ordinal") return 0;
  const thresholds = sel.thresholds ?? [];
  const bands = sel.groups ?? [];
  if (bands.length !== thresholds.length + 1) return 0;
  const ord = Number.isFinite(progressOrdinal) ? Math.trunc(progressOrdinal) : 0;
  for (let i = 0; i < thresholds.length; i++)
    if (ord < thresholds[i]!) return bands[i]!;
  const last = bands[bands.length - 1]!;
  return last < groups.length ? last : 0;
}

/**
 * The live record's four zone blocks as indices into `stage.zones[]`, or undefined
 * for a single-group stage (where the caller indexes `zones` positionally).
 */
export function stageZoneBlocks(
  stage: StageEncounters | undefined, progressOrdinal: number, entryKey?: number,
): number[] | undefined {
  const groups = stage?.groups;
  if (!groups || groups.length < 2) return undefined;
  return groups[encounterGroupIndex(stage, progressOrdinal, entryKey)]?.blocks;
}

// ---------------------------------------------------------------------------
// Step counter — how OFTEN a roll happens (ENCOUNTER-Q001, decoded 2026-07-25).
//
// Authority: original SLES-03936 assembly, ~/ddw3/asm/dw2003/pro/fieldstg.s
// (overlay RAM base 0x80082cb0) + the linked fieldstg data object.
//
//   F0x8008fd74 (file 0xd0c4) — the player-actor move handler. Three call sites
//   (0xd3f4 a2=1, 0xd5a4 a2=a1, 0xd6ac a2=0), all immediately after the actor's
//   x/y (+0x50/+0x54) are updated:
//       if (actor->+0x8 != 0) return;              // busy: tick does NOT advance
//       if (moving && (actor->+0x18 & 7) == 0) {   // every 8th tick, footstep beat
//           ...footstep sfx by anim state (146/147)...
//           if (encountersEnabled) F0x80092664();  // the encounter driver
//       }
//       actor->+0x18 += 1;                          // 0xd194
//   => the driver runs ONCE PER 8 FIELD TICKS OF MOVEMENT, not per frame.
//
//   F0x80092664 (file 0xf9b4) — the driver:
//       gates on [0x8009b6c4+0x10] and scene 0x80099d80 fields +0x20 (zone data
//       present) and +0x54/+0x58/+0x5c/+0x60 (all 0 = free roam);
//       zone  = zoneAt(player.x, player.y) & 0xff;  if (zone == 0) return;
//       block = [0x80099da0][zone-1] (array at +0xc);
//       counter (= [0x80048d64]) -= RATE[block[0]];
//       if (counter > 0) return;
//       if ([0x80042b1c]) F0x800925a8();            // the slot selector
//       F0x8009252c();                              // reset the counter
//
//   F0x8009252c (file 0xf87c) — the reset:
//       r = rand() % 0x900;                          // 0..2303
//       counter = (r < 0x100) ? r : (r + 0x100) / 2; // => 0..1279
// ---------------------------------------------------------------------------

/**
 * Per-tick counter decrement by zone rate level. Literal words at fieldstg RAM
 * 0x8009b6ac (file offset 0x189fc), read as `RATE[block[0]]` by F0x80092664.
 *
 * Level 0's 2000 exceeds the counter's 1279 maximum, so it would expire on the
 * first step. It is a **sentinel for "not a walkable encounter zone"**: of the
 * 605 active zone blocks in the 294 wstag overlays, the 164 level-0 blocks are
 * never selected by any cell of any extracted zone grid (151 grid-reachable
 * blocks are all level 1-5), i.e. only the scripted-trigger path (F0x800927a0,
 * which indexes the same blocks directly and never touches this counter) uses
 * them. Levels 1-5 are the real rate tiers.
 *
 * `zones[]` lists every block in overlay order, including blocks whose eight
 * slots are all 0 (1792 blocks total, 605 of them active), because the engine
 * indexes `zoneArray[zone-1]` positionally — dropping an empty block would
 * renumber every block after it. Confirmed against live RAM: s330 Central Park
 * has four blocks, levels [3,1,0,0], with the third all-empty.
 */
export const ENCOUNTER_RATE_TABLE = [2000, 3, 4, 6, 9, 18] as const;

/** Field ticks of movement between driver runs — `actor->+0x18 & 7`. */
export const ENCOUNTER_TICK_FRAMES = 8;

/** Counter reset, F0x8009252c. `rand` must return a non-negative integer. */
export function resetEncounterCounter(rand: () => number): number {
  const r = Math.floor(Math.abs(rand())) % 0x900;
  return r < 0x100 ? r : Math.floor((r + 0x100) / 2);
}

/**
 * One driver run: subtract the zone's rate and report expiry.
 * `expired` true = roll the selector, then reset the counter.
 */
export function encounterStepTick(
  counter: number, rateLevel: number,
): { counter: number; expired: boolean } {
  const rate = ENCOUNTER_RATE_TABLE[rateLevel] ?? ENCOUNTER_RATE_TABLE[0]!;
  const next = counter - rate;
  return { counter: next, expired: !(next > 0) };
}

/**
 * The rate level of the block a 1-based `zone` selects.
 *
 * Zone 0 means "no encounter zone here" and yields 0, which the caller must read
 * as "do not roll" — the driver (fieldstg `F0x80092664`) returns outright on both
 * `zonemgr[4] == 0` and `zone == 0`, so there is no fallback block. See
 * `zoneAt` for where the zeroes come from.
 *
 * `blocks` is the live selector record's zone->flat-index map (see
 * `stageZoneBlocks`); omit it for a single-group stage, where `zone - 1` is the
 * flat index.
 */
export function zoneRateLevel(
  zones: ZoneBlock[] | undefined, zone: number, blocks?: number[],
): number {
  const i = zoneBlockIndex(zones, zone, blocks);
  return i == null ? 0 : (zones![i]?.rate_level ?? 0);
}

/**
 * Flat index into `zones[]` for a 1-based `zone` under the live group's `blocks`
 * map, or null when there is no block (zone 0 / out of range / no zones).
 */
function zoneBlockIndex(
  zones: ZoneBlock[] | undefined, zone: number, blocks?: number[],
): number | null {
  if (!zones || !zones.length) return null;
  const span = blocks ?? null;
  if (zone < 1 || zone > (span ? span.length : zones.length)) return null;
  const i = span ? span[zone - 1]! : zone - 1;
  return i >= 0 && i < zones.length ? i : null;
}

export interface EnemyParty {
  name: string;
  id: number;
  level: number;
  hp: number;
  mp: number;
  stat_scale?: number;
}

/** Exact WFIGHTMN 0x800a6dd0 battle-mode selectors. */
export function specialBattleMode(mapId: string | undefined, battleId: number): number {
  if (mapId === "s415" && battleId === 0x143) return 1; // Deeper Crevice / Bulbmon
  if (mapId === "s480" && battleId === 0x00b) return 2; // Jungle Grave / Zanbamon
  if (mapId === "s206" && battleId === 0x01e) return 3; // Amaterasu Bridge / Knightmon
  if (battleId === 0x144) return 4;                      // Galacticmon sequence
  return 0;
}

/** Strip the "s" map-id prefix to the numeric stage key used by the JSON tables. */
function stageKey(mapId: string): string | null {
  const m = String(mapId).match(/(\d+)/);
  return m?.[1] ?? null;
}

/**
 * 1-based zone at world (x,y) from a per-stage lookup entry; 0 = no zone.
 *
 * A missing entry means the stage's `wstagNNN` init never calls
 * `set_resource(4, …)`, so its `zonemgr[4]` handle is 0 — and the field screen
 * zeroes that handle on every entry (fieldstg file `0x7f8c`, phase-0 sub-state-0
 * of `F0x8008aa10`, which runs before sub-state 1 loads the incoming map's
 * overlay). The driver's module gate then returns and the stage rolls nothing,
 * so 0 here is the faithful answer, not a fallback. Out-of-grid cells are 0 for
 * the same reason the pyramid's leaf is: they are not encounter ground.
 */
export function zoneAt(look: ZoneLook, x: number, y: number): number {
  if (!look) return 0;
  if ("uniform" in look) return look.uniform;
  const cx = Math.floor(x / look.cell), cy = Math.floor(y / look.cell);
  if (cx < 0 || cy < 0 || cx >= look.w || cy >= look.h) return 0;
  return look.grid[cy * look.w + cx]!;
}

/**
 * Select a screen_id from a stage's zone blocks: block = zones[zone-1],
 * slot = rng()&7 (fieldstg `F0x800925a8`).
 *
 * Returns screen_id (0 = no encounter this roll), or null when there are no
 * zones or `zone` is 0/out-of-range. The selector is only ever reached with a
 * live zone because the driver returns first, so an absent zone has no block —
 * it is not steered onto zones[0].
 */
export function selectScreenId(
  zones: ZoneBlock[] | undefined, zone: number, rng: () => number, blocks?: number[],
): number | null {
  const i = zoneBlockIndex(zones, zone, blocks);
  if (i == null) return null;
  const slot = rng() & 7;
  return zones![i]!.slots[slot] ?? 0;
}

/**
 * Full faithful selection for a step that rolled an encounter on `mapId` at (x,y).
 * Returns { party, screen }, or null = no encounter (empty slot, or stage/screen
 * has no data). `screen` is the rolled global screen_id — the battle-trigger
 * record keyed by it also carries the battle MUSIC play id (battle_music.json;
 * fieldstg 0x80092780 copies record+0x8 into 0x80042b30, played by wfightmn).
 */
export function pickEncounter({
  stageDB, fieldDB, gridDB, mapId, x, y, rng, progressOrdinal = 0, entryKey,
}: {
  stageDB: any; fieldDB: any; gridDB: any; mapId: string; x: number; y: number;
  rng: () => number;
  /** Master story ordinal [0x8004b370] — picks the live zone group on multi-group stages. */
  progressOrdinal?: number;
  /**
   * The entry warp's own parameter — step record `params[5]`, stored to
   * [0x80048d78] by the warp executor. Picks the live group on `runtime_key`
   * stages (Seabed/Circuit/endgame). Undefined falls back to group 0.
   */
  entryKey?: number;
}): { party: EnemyParty[]; screen: number } | null {
  const key = stageKey(mapId);
  if (!key) return null;
  const stage: StageEncounters | undefined = stageDB?.stages?.[key];
  if (!stage) return null;
  const zone = zoneAt(gridDB?.stages?.[key], x, y);
  const screen = selectScreenId(stage.zones, zone, rng,
                                stageZoneBlocks(stage, progressOrdinal, entryKey));
  if (!screen) return null;
  const party = fieldDB?.screens?.[String(screen)];
  return party && party.length ? { party, screen } : null;
}

/** Script launcher F0x800927a0: the live selector's fourth block, indexed
 * directly (no random slot). pro/fieldstg.s:16067-16082. */
export function scriptedScreenId(stage: StageEncounters | undefined, index: number,
  progressOrdinal: number, entryKey?: number): number | null {
  const block = stageZoneBlocks(stage, progressOrdinal, entryKey)?.[3] ?? 3;
  return stage?.zones[block]?.slots[index] ?? null;
}
