// engine/systems/animation-controller.ts
//
// Shared frame-timing logic for field sprites (player/partner/followers/NPCs), replacing the
// three duplicated idle/walk frame-index calculations that used to live inline in web/game.js's
// render(). Uses each sprite's REAL per-frame durations (decoded from the original .bin files by
// tools/decode_sprite_anims.py, propagated into the manifest by build_assets.py's build_sheet)
// instead of a single fixed FPS constant shared by every sprite in the game.
//
// The same module resolves the decoded per-sprite clip directories used by SETANIM and native
// locomotion (clip 1 idle, 4 walk, 5 run), including authored directions and runtime mirroring.

import { FIELD_TICK_RATE } from "./field-movement.ts";

export type Dir8 =
  | "down" | "down-left" | "left" | "up-left"
  | "up" | "up-right" | "right" | "down-right";

/** Per-direction frame durations in native PAL field ticks (array length = frame count).
 * durations[0] is
 * the stand pose's duration (unused while walking); durations[1..] are the walk-cycle frame
 * durations, in original frame order. Matches the manifest's `frameDurations` field shape
 * exactly (build_assets.py's build_sheet). */
export type SpriteTimings = Partial<Record<Dir8, number[]>>;

/** b>=5 facings are runtime-mirrored from their left-side counterpart in the original engine
 * (docs/research/field/field-actor-anim-engine.md); NPC/character sheets only bake left-side
 * source frames, mirroring right-side rows at build time (build_assets.py's build_sheet). */
const DIR8_MIRROR_SOURCE: Partial<Record<Dir8, Dir8>> = {
  right: "left",
  "down-right": "down-left",
  "up-right": "up-left",
};

export function timingForDir(sprite: SpriteTimings, dir: Dir8): number[] | null {
  const direct = sprite[dir];
  if (direct) return direct;
  const mirrorSource = DIR8_MIRROR_SOURCE[dir];
  if (mirrorSource && sprite[mirrorSource]) return sprite[mirrorSource]!;
  return sprite.down ?? null;
}

/**
 * Walk-cycle frame index for `elapsedSeconds` of continuous walking, honoring each frame's real
 * duration instead of a fixed FPS. Frame 0 is the reserved stand pose (per sprites.md's walk-
 * frame-reorder convention) — walking cycles frames 1..durations.length-1 only. Sprites with
 * only one frame (or no timing data) have no walk animation and always return 0.
 */
export function walkFrameIndex(durations: number[] | null, elapsedSeconds: number): number {
  if (!durations || durations.length <= 1) return 0;
  const cycleDurations = durations.slice(1);
  const totalTicks = cycleDurations.reduce((a, b) => a + b, 0);
  if (totalTicks <= 0) return 1;
  let remaining = (elapsedSeconds * FIELD_TICK_RATE) % totalTicks;
  for (let i = 0; i < cycleDurations.length; i++) {
    if (remaining < cycleDurations[i]!) return i + 1;
    remaining -= cycleDurations[i]!;
  }
  return 1;
}

/** One direction's frames within a sprite's clip strip (build_assets.py's `_build_clip_strip`):
 * `cols` index into the flat, deduped `clipSheet` image; native PAL-tick `durations` match 1:1.
 * Per-frame billboard X offsets (frame-list record word 3, entity+0xDC — claims
 * world-q007-*-001, verified 2026-09-05) are BAKED into the strip by the build (content
 * left = cellW/2 + DC), so the renderer needs nothing beyond cols/durations for X.
 * `bottoms` is the one thing it does need per frame: the frame's registered Y offset
 * (record word 4, entity+0xE0) plus the frame's own height — where the quad's bottom row
 * sits relative to the actor's ground screen row, which is what the strip's bottom-aligned
 * bake has to be shifted by. See engine/systems/field-billboard-anchor.ts. */
export type ClipFrameEntry = { cols: number[]; durations: number[]; bottoms?: number[] };

/** `clip_id (as string, matching the manifest's JSON object keys) -> direction -> frames`.
 * Real per-clip SETANIM data decoded in docs/research/field/field-actor-anim-engine.md —
 * covers gesture/talk/sleep/sit clips, not just idle/walk/run. */
export type SpriteClips = Record<string, Partial<Record<Dir8, ClipFrameEntry>>>;

/** `clipFrame`'s result: `col` indexes the clip strip image as-baked (always a left-side or
 * non-directional frame — the build never bakes right-side clip frames, see
 * build_assets.py's `_build_clip_strip`); `mirror` tells the renderer whether it must flip
 * that frame horizontally to actually face `dir` (true for right/down-right/up-right, since
 * those always resolve via a left-side mirror source, never an authored entry); `bottom` is
 * the frame's vertical registration shift, which the renderer adds to the strip's own
 * bottom-aligned row (mirroring never changes it — the original's Y math has no mirror
 * branch). */
export type ClipFrameResult = { col: number; mirror: boolean; bottom: number };

function clipBottom(entry: ClipFrameEntry, index: number): number {
  // The build emits `bottoms` for every decoded frame; a hand-built clip entry without it
  // (tests, the lab) registers nothing and keeps the strip's own bottom row.
  return entry.bottoms?.[index] ?? 0;
}

/**
 * Resolves `elapsedSeconds` of continuous play of `clipId` facing `dir` to a strip column
 * (+ whether the renderer must mirror it, + the frame's vertical registration), honoring
 * each frame's real duration. Returns
 * `null` when the sprite has no directory entry for this clip (unknown/unmapped clip id) or
 * no clips at all — the caller should fall back to the idle/walk rendering (`timingForDir`/
 * `walkFrameIndex`) in that case, same as the original engine's directory-miss behavior (no
 * match = no clip override).
 */
export function clipFrame(
  clips: SpriteClips | undefined,
  clipId: number | string | undefined | null,
  dir: Dir8,
  elapsedSeconds: number,
): ClipFrameResult | null {
  if (!clips || clipId == null) return null;
  const entry = clips[String(clipId)];
  if (!entry) return null;
  const mirrorSource = DIR8_MIRROR_SOURCE[dir];
  const mirror = !entry[dir] && !!mirrorSource && !!entry[mirrorSource];
  const perDir = entry[dir] ?? (mirrorSource && entry[mirrorSource]) ?? entry.down;
  if (!perDir || perDir.cols.length === 0) return null;
  if (perDir.cols.length === 1) return { col: perDir.cols[0]!, mirror, bottom: clipBottom(perDir, 0) };

  const totalTicks = perDir.durations.reduce((a, b) => a + b, 0);
  if (totalTicks <= 0) return { col: perDir.cols[0]!, mirror, bottom: clipBottom(perDir, 0) };
  let remaining = (elapsedSeconds * FIELD_TICK_RATE) % totalTicks;
  for (let i = 0; i < perDir.cols.length; i++) {
    if (remaining < perDir.durations[i]!) {
      return { col: perDir.cols[i]!, mirror, bottom: clipBottom(perDir, i) };
    }
    remaining -= perDir.durations[i]!;
  }
  return { col: perDir.cols[0]!, mirror, bottom: clipBottom(perDir, 0) };
}

/** Authored one-shot duration for a directional clip, in PAL seconds. */
export function clipDurationSeconds(
  clips: SpriteClips | undefined,
  clipId: number | string | undefined | null,
  dir: Dir8,
): number | null {
  if (!clips || clipId == null) return null;
  const entry = clips[String(clipId)];
  if (!entry) return null;
  const mirrorSource = DIR8_MIRROR_SOURCE[dir];
  const perDir = entry[dir] ?? (mirrorSource && entry[mirrorSource]) ?? entry.down;
  if (!perDir || perDir.cols.length === 0) return null;
  return perDir.durations.reduce((sum, ticks) => sum + ticks, 0) / FIELD_TICK_RATE;
}
