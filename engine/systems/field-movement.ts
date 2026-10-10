// Native SLES-03936 field locomotion constants and follower history.
//
// fieldstg actor construction stores 0x4cc at actor+0x68 for the PAL build.
// Normal player movement (mode 3) feeds that 24.8 fixed-point magnitude to the
// direction-vector helper once per 50 Hz PAL field frame: 0x4cc / 0x100 px per
// tick. Party actors use a 64-record {x,y,dir} ring and start their read cursors
// at 55, 46 and 37 while the write cursor starts at 0, i.e. 9/18/27 ticks back.

export const FIELD_TICK_RATE = 50;
export const FIELD_TICK_SECONDS = 1 / FIELD_TICK_RATE;
export const FIELD_RUN_MAGNITUDE = 0x4cc;
export const FIELD_WALK_MAGNITUDE = FIELD_RUN_MAGNITUDE >> 2;
export const FIELD_RUN_STEP = FIELD_RUN_MAGNITUDE / 0x100;
export const FIELD_WALK_STEP = FIELD_WALK_MAGNITUDE / 0x100;
export const FIELD_WALK_SPEED = FIELD_WALK_STEP * FIELD_TICK_RATE;
export const FIELD_RUN_SPEED = FIELD_RUN_STEP * FIELD_TICK_RATE;
export const FIELD_IDLE_CLIP = 1;
export const FIELD_WALK_CLIP = 4;
export const FIELD_RUN_CLIP = 5;
export const FIELD_STOP_CLIP = 6;

export const FOLLOWER_HISTORY_LENGTH = 64;
export const FOLLOWER_LAG_TICKS = [9, 18, 27] as const;

const FIELD_DIRECTIONS = [
  "down", "down-left", "left", "up-left",
  "up", "up-right", "right", "down-right",
] as const;
export type FieldDirection = typeof FIELD_DIRECTIONS[number];

/**
 * The facing name for a native 0-7 facing index (char+0x60), in the same order
 * the direction-scale table is indexed. Used by anything that steers by rotating
 * the stored facing rather than by a D-pad nibble — Submarimon's tank steering.
 */
export function fieldDirectionFromIndex(index: number): FieldDirection {
  return FIELD_DIRECTIONS[((index % 8) + 8) % 8]!;
}

/** The native 0-7 facing index for a direction name — the inverse of the above. */
export function fieldDirectionIndex(dir: FieldDirection | string): number {
  const i = FIELD_DIRECTIONS.indexOf(dir as FieldDirection);
  return i < 0 ? 0 : i;
}

// Runtime table at 0x8009b724 in SLES-03936, captured from a field savestate.
// Seven terrain classes × eight directions × {x,y}, in signed 20.12 scale.
export const FIELD_DIRECTION_SCALE = [
  [[0, 2048], [-2896, 1448], [-4096, 0], [-2896, -1448], [0, -2048], [2896, -1448], [4096, 0], [2896, 1448]],
  [[599, 3405], [-2048, 3368], [-3496, 1358], [-2896, -1448], [-600, -3405], [2048, -3368], [3495, -1358], [2896, 1448]],
  [[155, 2865], [-2676, 2606], [-3940, 818], [-2896, -1448], [-156, -2866], [2676, -2606], [3939, -819], [2896, 1448]],
  [[68, 2616], [-2799, 2254], [-4027, 569], [-2896, -1448], [-69, -2618], [2797, -2254], [4026, -571], [2896, 1448]],
  [[273, 3081], [-2509, 2911], [-3822, 1034], [-2896, -1448], [-274, -3082], [2509, -2911], [3821, -1035], [2896, 1448]],
  [[344, 3178], [-2409, 3047], [-3751, 1130], [-2896, -1448], [-345, -3179], [2409, -3047], [3750, -1132], [2896, 1448]],
  [[9, 2271], [-2882, 1764], [-4086, 224], [-2896, -1448], [-10, -2272], [2882, -1764], [4085, -225], [2896, 1448]],
] as const;

const FLIPPED_DIRECTION = [0, 7, 6, 5, 4, 3, 2, 1] as const;

/** Native signed fixed-point displacement for one field tick. */
export function fieldDirectionDelta(
  dir: FieldDirection,
  magnitudeFixed: number = FIELD_RUN_MAGNITUDE,
  terrainCode: number = 0,
): { x: number; y: number } {
  let directionIndex = FIELD_DIRECTIONS.indexOf(dir);
  if (directionIndex < 0) directionIndex = 0;
  const flipped = (terrainCode & 0x10) !== 0;
  if (flipped) directionIndex = FLIPPED_DIRECTION[directionIndex]!;
  const classIndex = Math.min(
    FIELD_DIRECTION_SCALE.length - 1,
    Math.max(0, (terrainCode & 0x0f) - 1),
  );
  const [scaleX, scaleY] = FIELD_DIRECTION_SCALE[classIndex]![directionIndex]!;
  const signX = flipped ? -1 : 1;
  return {
    x: Math.trunc((scaleX * magnitudeFixed * signX) / 0x1000) / 0x100,
    y: Math.trunc((scaleY * magnitudeFixed) / 0x1000) / 0x100,
  };
}

export type FieldTrailPoint<D = string> = { x: number; y: number; dir: D };

/** Seed the native-sized ring at a stage handoff so followers begin at the player. */
export function seedFollowerHistory<D>(point: FieldTrailPoint<D>): FieldTrailPoint<D>[] {
  return Array.from({ length: FOLLOWER_HISTORY_LENGTH }, () => ({ ...point }));
}

/** Append one native field tick, preserving the original 64-record ring capacity. */
export function pushFollowerHistory<D>(
  history: FieldTrailPoint<D>[], point: FieldTrailPoint<D>,
): void {
  if (history.length >= FOLLOWER_HISTORY_LENGTH) history.shift();
  history.push({ ...point });
}

/** Exact player-history sample copied by a field-party actor on this tick. */
export function followerHistorySample<D>(
  history: readonly FieldTrailPoint<D>[], followerIndex: number,
): FieldTrailPoint<D> | null {
  if (history.length === 0) return null;
  const lag = FOLLOWER_LAG_TICKS[followerIndex];
  if (lag == null) return null;
  return history[Math.max(0, history.length - 1 - lag)] ?? null;
}

/**
 * Party gather (story command `SETANIM 813 823`, fieldstg 0x800837ec -> 0x80090e70 installs
 * hook 0x8008ed2c on party indices 2/4/8). Each gather tick the hook runs twice: the write
 * cursor zeroes the slot past the newest record, and the read cursor copies the next record
 * into the actor. So a follower that sat `lag` records behind the newest point walks the rest of
 * the trail at two records per tick and, on reaching the zeroed slot, is parked (x == 0 clears
 * the hook, 0x8008eeb4..0x8008eed8). Run length is floor(lag / 2) + 1 ticks (5/10/14).
 * `tick` counts gather ticks from 1. Returns the record the follower stands on after that tick,
 * or null once it is parked.
 */
export function followerGatherSample<D>(
  history: readonly FieldTrailPoint<D>[], followerIndex: number, tick: number,
): FieldTrailPoint<D> | null {
  const lag = FOLLOWER_LAG_TICKS[followerIndex];
  if (lag == null || history.length === 0) return null;
  const start = Math.max(0, history.length - 1 - lag);
  const idx = start + 2 * Math.max(0, tick);
  return idx <= history.length - 1 ? history[idx]! : null;
}

/** Consume a real-time delta as original PAL field/vsync ticks, retaining the phase remainder. */
export function consumeFieldTicks(accumulator: number, dt: number): {
  ticks: number;
  accumulator: number;
} {
  const total = accumulator + Math.max(0, dt);
  const ticks = Math.floor((total + Number.EPSILON) / FIELD_TICK_SECONDS);
  return { ticks, accumulator: total - ticks * FIELD_TICK_SECONDS };
}

// ── the standing-actor / tree obstacle of the walk predicate ────────────────
//
// The original refuses a field step when the ground under the actor's foot
// perimeter is void OR when any perimeter point lies inside another field
// actor's footprint, OR within 10 px of a tree. The step advances the position
// and then runs `F0x8008dfec` (file 0xb33c), which probes the foot perimeter
// and REVERTS the whole step on any occupied point. `F0x8008dfec` passes each
// probe to `F0x8008de0c` (file 0xb15c), which asks the zone manager's
// `+0x58` method `F0x80092a90` (file 0xfde0) — the occupancy query — before the
// typed-terrain read. See docs/research/field/collision.md and
// `.dw3-research/field-npc-collision-2026-10-08/worker-ca.md`.

/**
 * The foot-perimeter probe offsets `F0x8008dfec` reads out of table RAM
 * `0x80097B88` (file `0x14ED8`): the perimeter of the actor's foot box.
 * FIELDSTG.PRO selects five of these per 0-7 facing through the index table at
 * `0x80097B60`; every offset here is one of a facing's five, and none is
 * `(0,0)`, which is why an actor is never stopped by its own footprint.
 */
export const FIELD_FOOTPRINT_OFFSETS: readonly (readonly [number, number])[] = [
  [-6, -8], [6, -8], [8, -6], [8, 6], [6, 8], [-6, 8], [-8, 6], [-8, -6],
];

/**
 * The occupancy half of the walk predicate (`F0x80092a90`): a probe point is
 * occupied when it lies inside a standing field actor's footprint diamond
 * `|px - actor.x| + 2·|py - actor.y| <= halfWidth`, where `halfWidth` is
 * `actor+0x80 = size(npc_id) >> 1` (engine/dw3/npc-sizes.ts). Actors whose kind
 * has no size are skipped, the way the native's table read would be undefined.
 */
export function actorFootprintBlocked<T extends { x: number; y: number }>(
  actors: readonly T[],
  halfWidthOf: (actor: T) => number | null | undefined,
  px: number, py: number,
): boolean {
  for (const a of actors) {
    const hw = halfWidthOf(a);
    if (hw == null || hw <= 0) continue;
    if (Math.abs(px - a.x) + 2 * Math.abs(py - a.y) <= hw) return true;
  }
  return false;
}
