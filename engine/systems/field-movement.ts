// Native SLES-03936 field locomotion constants and follower history.
//
// fieldstg actor construction stores 0x4cc at actor+0x68 for the PAL build.
// Normal player movement (mode 3) feeds that 24.8 fixed-point magnitude to the
// direction-vector helper once per 50 Hz PAL field frame: 0x4cc / 0x100 px per
// tick. Party actors use a 64-record {x,y,dir} ring and start their read cursors
// at 55, 46 and 37 while the write cursor starts at 0, i.e. 9/18/27 ticks back.

import { moveWithCollision, type Grid } from "../core/util/collision.ts";

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

/**
 * The direction exactly opposite (180°): `(index + 4) & 7` in the native 0-7
 * facing order. This is the talk handler's turn-to-face — when a conversation
 * starts, `npc+0x60 = (player+0x60 + 4) & 7` (F0x80090afc, pro/fieldstg.s file
 * 0xdf00-0xdf18), so the NPC ends up facing the player it was spoken to from.
 * (The disc gates the write on `npc+0x100 == 0` — a per-npc_id constructor flag
 * the walker does not carry — and skips it for the special ids whose speaker is
 * the player; the walker applies the rule to every talk target.)
 */
export function oppositeDirection(dir: FieldDirection | string): FieldDirection {
  return fieldDirectionFromIndex(fieldDirectionIndex(dir) + 4);
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

/**
 * The pure unit facing vector — zonemgr+0x4c, `F0x80092da0` (file 0x100f0):
 * row 0 of the same table with no terrain query, no scale row, no remap and no
 * sign flip (`0x8009b724 + facing*8` read once per axis). Submarimon's swim
 * states (0x4b thrust / 0x4c coast) call this cell — the `lw $v0,-0x48f0($v0)`
 * loads at fieldstg.s:13614 (coast, file 0xd49c) and :13666 (thrust, file
 * 0xd56c) — so the sub's speed is NOT scaled by terrain. The split against
 * the walk states' terrain-scaled cell (zonemgr+0x48 = `F0x80092ca0`) is
 * structural: two statically-initialized cells, never repointed. Claims
 * WQ004-ZONE-4C-PURE, WQ004-ZONE-48-TERRAIN, ZONE-Q001-CELL-710-FACING-MOVE-STEP.
 */
export function fieldPureDirectionDelta(
  dir: FieldDirection,
  magnitudeFixed: number = FIELD_RUN_MAGNITUDE,
): { x: number; y: number } {
  return fieldDirectionDelta(dir, magnitudeFixed, 0);
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

// ── the standing-actor / tree obstacle: the disc's own five-point probe ─────
//
// The original's obstacle response is NOT a step revert. Each movement mode that
// walks advances the position and then calls `F0x8008dfec` (file 0xb33c,
// fieldstg.s:11478), whose return value BOTH call sites discard — the response is
// the side effect inside it:
//
//   * FIVE probes per step, not eight: the loop body at fieldstg.s:11495 reads
//     `table[0x80097B60 + facing*5 + i]` and the tail at :11549-11551 runs it for
//     i = 0..4. Each entry indexes a 16-record table of {s32 x, s32 y} foot-ring
//     offsets at `0x80097B88` (:11539-11543); the five records of a facing span a
//     135° cone centred on it (e.g. facing 0 probes (0,8), (-6,8), (6,8), (-8,6),
//     (8,6) — the front five). Nothing behind the actor is ever probed, which is
//     why walking away from an obstacle is never refused.
//   * Each occupied point pushes the actor back by that point's OWN vector, from
//     the two flag bytes at `0x80097C08 + record*2` (:11504-11538): x by
//     `(flag0 & 1) * ±magnitude/2`, y by `(flag1 & 1) * ±magnitude/4` (bit 7 of
//     each byte negates). `F0x8008de0c` applies them as `actor.x -= arg3;
//     actor.y -= arg4` (file 0xb15c, :11461-11471) — a push of at most ±2.4 px in
//     x and ±1.2 px in y per point, never the step.
//   * The probe point itself is the actor's pixel position plus the record:
//     `(actor+0x50 >> 8) + rec.x`, `(actor+0x54 >> 8) + rec.y`
//     (:11366-11378), tested by the occupancy query `F0x80092a90` (zonemgr+0x58)
//     and the tree query `F0x8008ce40`.
//   * Both `jal 0x8008dfec` sites (:13627 and :13682) jump straight to the
//     shared epilogue, so nothing upstream can turn the push into a refusal.
//
// See docs/research/field/collision.md and the 2026-10-11 re-read of
// `F0x8008dfec`/`F0x8008de0c` in this task's report.

/**
 * The disc's foot-ring offset table, RAM `0x80097B88` (file `0x14ED8`): sixteen
 * {s32 x, s32 y} records. Records 0-7 are the octagon `FIELD_FOOTPRINT_OFFSETS`
 * below; 8-11 are the edge midpoints and 12-15 the corners.
 */
export const FIELD_PROBE_OFFSETS: readonly (readonly [number, number])[] = [
  [-6, -8], [6, -8], [8, -6], [8, 6], [6, 8], [-6, 8], [-8, 6], [-8, -6],
  [0, -8], [8, 0], [0, 8], [-8, 0], [8, -8], [8, 8], [-8, 8], [-8, -8],
];

/**
 * The per-facing selector, RAM `0x80097B60` (file `0x14EB0`): five record
 * indices per 0-7 facing, read by `F0x8008dfec` as `table[facing*5 + i]`.
 */
export const FIELD_PROBE_INDEX: readonly (readonly number[])[] = [
  [10, 5, 4, 6, 3],
  [14, 6, 5, 7, 4],
  [11, 7, 6, 0, 5],
  [15, 7, 0, 6, 1],
  [8, 0, 1, 7, 2],
  [12, 2, 1, 3, 0],
  [9, 2, 3, 1, 4],
  [13, 3, 4, 2, 5],
];

/**
 * The push flags, RAM `0x80097C08` (file `0x14F58`): two bytes per record.
 * byte0 drives the X push (bit0 = pushes, bit7 = negate), byte1 the Y push.
 */
export const FIELD_PROBE_FLAGS: readonly (readonly [number, number])[] = [
  [0x00, 0x81], [0x00, 0x81], [0x01, 0x00], [0x01, 0x00],
  [0x00, 0x01], [0x00, 0x01], [0x81, 0x00], [0x81, 0x00],
  [0x00, 0x81], [0x01, 0x00], [0x00, 0x01], [0x81, 0x00],
  [0x01, 0x81], [0x01, 0x01], [0x81, 0x01], [0x81, 0x81],
];

/** The five probe points `F0x8008dfec` tests for a 0-7 facing. */
export function fieldProbeOffsets(facing: number): readonly (readonly [number, number])[] {
  const row = FIELD_PROBE_INDEX[((facing % 8) + 8) % 8]!;
  return row.map((rec) => FIELD_PROBE_OFFSETS[rec]!);
}

/**
 * The disc's response to a blocked probe point: `F0x8008de0c` subtracts the
 * record's own (±magnitude/2, ±magnitude/4) from the actor. This returns the
 * TOTAL (x, y) to subtract for the five probes of `facing` — the caller applies
 * `actor.x -= push.x; actor.y -= push.y`. `isBlocked(px, py)` is the whole
 * F0x8008de0c predicate at one absolute probe point: the occupancy query
 * (F0x80092a90: inside a standing actor's footprint diamond, or F0x8008ce40's
 * ±10 box around a class-0xB object) OR the terrain half (the typed-terrain byte
 * under the form's height band — engine/core/util/collision.ts
 * terrainGateBlocks).
 *
 * The probe base is the actor's PIXEL position: F0x8008dfec reads
 * `(actor+0x50 >> 8) + rec.x` (fieldstg.s:11366-11370), an arithmetic shift of
 * the 24.8 fixed coordinate — the floor — and only then adds the record offset.
 */
export function fieldProbePushback(
  facing: number,
  magnitudeFixed: number,
  x: number,
  y: number,
  isBlocked: (px: number, py: number) => boolean,
): { x: number; y: number } {
  const row = FIELD_PROBE_INDEX[((facing % 8) + 8) % 8]!;
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  let pushX = 0;
  let pushY = 0;
  for (const rec of row) {
    const [ox, oy] = FIELD_PROBE_OFFSETS[rec]!;
    if (!isBlocked(baseX + ox, baseY + oy)) continue;
    const [f0, f1] = FIELD_PROBE_FLAGS[rec]!;
    if (f0 & 1) pushX += (f0 & 0x80 ? -1 : 1) * Math.trunc(magnitudeFixed / 2);
    if (f1 & 1) pushY += (f1 & 0x80 ? -1 : 1) * Math.trunc(magnitudeFixed / 4);
  }
  return { x: pushX / 0x100, y: pushY / 0x100 };
}

/**
 * Apply a probe push to the walker's grid, clamped by the same foot box the walk
 * uses.
 *
 * The disc applies the push unchecked (`actor.x -= arg3; actor.y -= arg4`) — it
 * has no walkmesh, because its walls ARE the probe refusal: a push toward void
 * is answered by the void's own probes on the following tick. The walker's wall
 * model is the 8 px collision grid, which has no probes, so an unchecked push
 * can shove the foot box INTO a blocked cell; the destination check then refuses
 * every direction and the player is trapped (seen live on s210's counter, walking
 * north beside the counter NPC: the three blocked up-probes push the box down by
 * 3*mag/4 while the step only rises 1/2*mag, and the box sinks into the counter's
 * blocked row). Clamping the push through the walk's own box keeps the mesh
 * unenterable; in open space the push applies whole, and against a wall it
 * degrades to the axis-separated slide the walk itself uses.
 */
export function applyObstaclePush(
  grid: Grid,
  x: number,
  y: number,
  push: { x: number; y: number },
  box: { w: number; h: number },
): { x: number; y: number } {
  return moveWithCollision(grid, x, y, -push.x, -push.y, box);
}

/**
 * The octagon half of the foot ring — records 0-7 of `FIELD_PROBE_OFFSETS`.
 * Kept as its own export for callers that reason about the ring's eight points.
 */
export const FIELD_FOOTPRINT_OFFSETS: readonly (readonly [number, number])[] =
  FIELD_PROBE_OFFSETS.slice(0, 8);

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
