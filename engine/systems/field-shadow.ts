// Field character drop shadow — the one shared definition of the shadow's
// geometry and visibility gate.
//
// Decode: docs/research/field/character-drop-shadow-decoded-2026-07-27.md.
// The native field-actor renderer F0x8008f52c emits, immediately after each
// actor's own POLY_FT4 billboard and one OT bucket further back (entity+0x78 +
// 1, i.e. BEHIND the actor), a fixed 32x16 4-bpp textured SPRT with ABE = 0
// (fully opaque, no alpha blending) and colour 0x808080 (neutral blend, no
// tint). The texture is FIELDCOM sub-entry 2 at u=112 v=166, extracted by
// tools/extract_fieldcom.py to web/assets/ui/field_shadow.png.

/** SPRT w/h immediates at 0x8008f920 — fixed, and never scaled by the actor. */
export const FIELD_SHADOW_WIDTH = 32;
export const FIELD_SHADOW_HEIGHT = 16;

/**
 * Constructor F0x8009116c (file 0xe834-0xe8c4) stores `entity+0x74 = 1`
 * unconditionally for every entity it builds — the player (kind 2), the three
 * party followers (kind = speciesId + 3) and every NPC spawned from a stage's
 * record list (kind = record+0x8 = npc_id) — then clears it back to 0 for
 * exactly these six kind values. So the shadow is OPT-OUT, not opt-in.
 *
 * Which NPCs these six ids name is not established, and whether any partner
 * species can make `speciesId + 3` land on one of them was not looked up
 * (decode doc §11.1) — both are open, so nothing here special-cases followers.
 */
export const FIELD_SHADOW_DENIED_KINDS: readonly number[] = [
  0x82, 0x83, 0xd5, 0x11f, 0x13c, 0x13f,
];

/**
 * Move/animation dispatcher F0x8008fed0 clears `entity+0x74` when it selects
 * these clips (decode doc §11.2: clip 0x16 at file 0xdb5c, 0x1d at 0xda90,
 * 0x1e at 0xd974).
 */
export const FIELD_SHADOW_SUPPRESSING_CLIPS: readonly number[] = [0x16, 0x1d, 0x1e];

/** Spawn-time value of `entity+0x74` for a constructor `kind` argument. */
export function fieldShadowEnabledAtSpawn(kind: number | null | undefined): boolean {
  if (kind == null) return true; // constructor default; unknown id is not a denial
  return !FIELD_SHADOW_DENIED_KINDS.includes(kind);
}

/** True when this clip is one the native dispatcher uses to clear the gate. */
export function fieldShadowSuppressedByClip(clipId: number | string | null | undefined): boolean {
  if (clipId == null) return false;
  const id = typeof clipId === "string" ? Number(clipId) : clipId;
  return Number.isFinite(id) && FIELD_SHADOW_SUPPRESSING_CLIPS.includes(id);
}

/**
 * Whether an actor draws a shadow this frame.
 *
 * The native gate is a stateful per-entity flag: the constructor seeds it and
 * the move dispatcher rewrites it on every clip change, so a denied entity that
 * later walks would have its shadow restored by the dispatcher's idle/walk/run
 * writes. The walker has no equivalent mode/sub-phase state machine, and
 * mapping walker clip ids onto the dispatcher's would be speculation, so this
 * takes the conservative intersection of what is proven: the spawn gate is
 * authoritative and the three decoded suppression clips can only subtract.
 *
 * Divergence from native, stated rather than hidden: an actor with a denied
 * kind stays shadowless here even while moving.
 */
export function fieldShadowVisible(
  kind: number | null | undefined,
  clipId: number | string | null | undefined = null,
): boolean {
  return fieldShadowEnabledAtSpawn(kind) && !fieldShadowSuppressedByClip(clipId);
}

export interface FieldShadowRectInput {
  /** Actor's world X projected to screen (the billboard's own centre column). */
  screenX: number;
  /**
   * The actor's screen row AFTER its height has been applied — i.e. the row the
   * billboard's feet are drawn at, which for a lifted actor is above the ground.
   */
  actorScreenY: number;
  /**
   * The 8.8 fixed-point height (`entity+0x64`) that was subtracted to obtain
   * `actorScreenY`. Re-added here, exactly as the native does at 0x8008f834,
   * so the shadow is GROUND-pinned and not feet-pinned.
   */
  actorHeightFixed?: number;
  /**
   * `entity+0x90`, an extra signed 8.8 downward ground offset. SHDW-Q003 is
   * open — whether anything outside the scripted move methods and the clip-0x17
   * ramp writes it (e.g. per-frame terrain height) is unresolved — so callers
   * with no modelled equivalent pass 0, which reproduces the resting case.
   */
  groundOffsetFixed?: number;
}

export interface FieldShadowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The shadow's screen rect. Native (0x8008f834, 0x8008f874-0x8008f92c):
 *   groundScreenY = actorScreenY + (actorHeightFixed >> 8)
 *   x0 = screenX - 16
 *   y0 = groundScreenY + (groundOffsetFixed >> 8) - 8
 * `>>` is JS's arithmetic shift, matching MIPS `sra` for negative offsets.
 * Screen coordinates are integers on the PS1; the fractional world positions the
 * walker carries are rounded here so the rect lands on whole pixels like every
 * other sprite draw.
 */
export function fieldShadowRect(input: FieldShadowRectInput): FieldShadowRect {
  const { screenX, actorScreenY, actorHeightFixed = 0, groundOffsetFixed = 0 } = input;
  const groundScreenY = Math.round(actorScreenY) + (actorHeightFixed >> 8);
  return {
    x: Math.round(screenX) - FIELD_SHADOW_WIDTH / 2,
    y: groundScreenY + (groundOffsetFixed >> 8) - FIELD_SHADOW_HEIGHT / 2,
    w: FIELD_SHADOW_WIDTH,
    h: FIELD_SHADOW_HEIGHT,
  };
}
