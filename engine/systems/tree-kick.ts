// engine/systems/tree-kick.ts
//
// TreeBoots tree-kicking — the "which tree is it in?" hunt.
//
// WHAT THE PLAYER DOES. Once you own the TreeBoots, walk up to any tree on the
// map and press the action button. Junior kicks it and the tree shakes. Exactly
// ONE tree on the stage is live at a time:
//
//   - Kick a dead tree and a radar card flashes up in the bottom-right corner.
//     Its ring colour is the distance to the live tree — red = very close,
//     green = nearby, blue = far — and the rings pulse faster the closer it is.
//     That card is the entire hunt: you kick, read the colour, walk, kick again.
//   - Kick the live tree and something drops out of it: four times in five the
//     stage's Cardmon, one time in five its big insect/plant Digimon. The live
//     marker then jumps to a random tree and the hunt restarts.
//
// The trees themselves are the stage's FIELDCOM point-sprite decorations — the
// manager takes every point record whose atlas byte is 0xFF, which is why the
// kickable set and the palms you see are the same set (tools/extract_tree_kick.py,
// web/assets/data/tree_kick.json). The live tree is re-rolled when you ARRIVE at
// a different map and kept when you come back to the same one, so walking back
// in from a battle does not shuffle it.
//
// DECODE. Manager tick F0x8008c98c (original assembly ~/ddw3/asm/dw2003/pro/
// fieldstg.s, overlay base 0x80082cb0, file 0x9cdc-0xa014); constructor
// F0x8008ccc8 (file 0xa018); hit test F0x8008ce40 (file 0xa190); relocation
// F0x8008c910 (file 0x9c60); radar card F0x8008c6b8 (file 0x9a08) built by
// F0x8008c8b4 (file 0x9c04); Junior's kick actor F0x8008d068 (file 0xa3b8)
// built by F0x8008d244 (file 0xa594); default field handler F0x8008e8ac (file
// 0xbbfc) and its action-point helper F0x80090f70 (file 0xe2c0). Manager
// fields: +0xc mode, +0x10 phase, +0x14 script cursor, +0x18 script timer,
// +0x50 tree count, +0x54 record array (0x14 each: +0 sprite, +4 point-record
// index, +8 x, +0xc y, +0x10 live marker), +0x58 selected index, +0x60/+0x64
// the live tree's coordinates. Write-up:
// docs/research/field/tree-boots-kicking-decoded-2026-07-29.md.

import { playerPackForClip } from "./player-clip-packs.ts";

/** Bank-0x80 flag for TreeBoots possession (item id 4). Gates every kick. */
export const TREE_BOOTS_FLAG = 0x8004;

/** The point-sprite id a tree rests on (`li $t0, 0x38`, file 0xa08c). */
export const TREE_SPRITE_IDLE = 0x38;

/** Half-width of a tree's hit box in both axes (`addiu $v0, ±0xa`, file 0xa1f0). */
export const TREE_HIT_RADIUS = 10;

/** PLAYER08 — the kick itself (file 0xa4a4). */
export const KICK_SOUND = 0x80045c44;

/**
 * Where the action button reaches, per 0-7 facing (table 0x80097ccc, read
 * through F0x80090f70). Sixteen pixels straight ahead; eleven on a diagonal,
 * which is the same length rounded. Index order is the engine's own facing
 * order (0 = down, 2 = left, 4 = up, 6 = right).
 */
export const ACTION_POINT_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 16], [-11, 11], [-16, 0], [-11, -11],
  [0, -16], [11, -11], [16, 0], [11, 11],
];

/** The point the action button tests, for a character at (x,y) facing `facing`. */
export function treeActionPoint(
  x: number, y: number, facing: number,
): { x: number; y: number } {
  const [dx, dy] = ACTION_POINT_OFFSETS[((facing % 8) + 8) % 8]!;
  return { x: x + dx, y: y + dy };
}

/** One tree, as the manager holds it. Array order IS the manager's index. */
export interface KickableTree {
  /** Index of the backing 18-byte point record — where the sprite id is written. */
  rec: number;
  x: number;
  y: number;
}

/** A stage's tree data, as extracted into web/assets/data/tree_kick.json. */
export interface TreeKickStage {
  gateFlag: number;
  trees: readonly KickableTree[];
  /** Scripted-encounter-block slot -> the party that tree drops. Null if unread. */
  encounters: Readonly<Record<string, { screenId: number; param: number; music: string }>> | null;
}

/**
 * The tree under `point`, or null.
 *
 * The original scans the record array in order and takes the FIRST record whose
 * x and y are both within ±10 — overlapping trees resolve by table order, not by
 * distance.
 */
export function treeIndexAt(
  trees: readonly KickableTree[] | null | undefined,
  point: { x: number; y: number },
): number | null {
  if (!trees) return null;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i]!;
    if (Math.abs(point.x - t.x) <= TREE_HIT_RADIUS
      && Math.abs(point.y - t.y) <= TREE_HIT_RADIUS) return i;
  }
  return null;
}

// ── scripts ────────────────────────────────────────────────────────────────
// {spriteId, duration} pairs, 0xff-terminated, advanced by the engine frame
// delta ([0x8004df9c], 1 per frame). Both tables live past fieldstg.s's
// disassembled end and were read out of the 2026-07-11 `fishing_active_s485`
// RAM capture at the addresses the code indexes.

export interface ScriptStep { id: number; d: number }

/**
 * The kicked tree's own shake, RAM 0x800979d0. Sixty-four frames end to end,
 * which is exactly the 2026-07-29 capture's kick-to-idle window (frame 12 to
 * frame 75).
 */
export const TREE_SHAKE_SCRIPT: readonly ScriptStep[] = [
  { id: 0x00, d: 0 }, { id: 0x39, d: 6 }, { id: 0x3a, d: 4 }, { id: 0x3b, d: 4 },
  { id: 0x3c, d: 8 }, { id: 0x3d, d: 8 }, { id: 0x3e, d: 8 }, { id: 0x3f, d: 10 },
  { id: 0x40, d: 8 }, { id: TREE_SPRITE_IDLE, d: 8 }, { id: 0xff, d: 0 },
];

/**
 * Junior's kick, one script per 0-7 facing: eight blank frames while he winds
 * up, then five FIELDCOM dir-0 cells four frames each. Twenty-eight frames,
 * which is when the capture handed control back (frame 12 to frame 39).
 * Table of pointers at RAM 0x80097a68, scripts packed 16 bytes apart at
 * 0x800979e8.
 */
export const KICK_SCRIPTS: readonly (readonly ScriptStep[])[] =
  [0x5b, 0x56, 0x51, 0x4c, 0x47, 0x14, 0x19, 0x1e].map((base) => [
    { id: 0, d: 8 },
    ...[0, 1, 2, 3, 4].map((k) => ({ id: base + k, d: 4 })),
    { id: 0xff, d: 0 },
  ]);

/**
 * Per-facing y-sort bias for the kick cells (table 0x80097a88): the three
 * up-facing directions push the effect one pixel BEHIND Junior, everything else
 * one pixel in front, so the kick never draws through him.
 */
export const KICK_YSORT_BIAS: readonly number[] = [1, 1, 1, -1, -1, -1, 1, 1];

// ── Junior's own body: leader mode 0x49 ────────────────────────────────────
//
// WHAT THE PLAYER SEES. Junior does not stand still while the tree shakes — he
// plants, swings his leg through, holds the moment of contact, and settles back
// into his ordinary standing pose.
//
// Mode 0x49 is an ANIMATION mode, exactly parallel to fishing's 0x48 (see
// engine/systems/fishing.ts, "The angler"): its handler runs SETANIM(entity, 8),
// waits for the entity's anim-complete flag +0xe8, then puts the leader back in
// field mode 1 and runs SETANIM(1). It is not merely an input lock.
//
// Junior's clip 8 resolves uniquely to LBA 971 = pack P002PLYK, clip-directory
// bin 30, which defines ONLY clip 8, in five authored directions of five frames
// each. Facings 5-7 mirror off the authored ones through the ordinary
// five-authored-direction mechanism every other pack uses — there is no special
// path here. Durations are identical in every direction: 4, 3, 4, 15, 5, i.e.
// thirty-one ticks with a fifteen-tick CONTACT HOLD on the fourth frame.
// Write-up: docs/research/field/tree-boots-kicking-decoded-2026-07-29.md,
// addendum 2026-07-29 (b); ledger claim `treeboots-kick-player-animation`
// (partially_verified).
//
// UNRESOLVED — do not paper this over. Three numbers that ought to agree do not,
// and why is NOT known:
//   * Junior's authored clip 8 is 31 ticks;
//   * the burst-effect script (KICK_SCRIPTS above) is 28 frames;
//   * a runtime capture held leader mode 0x49 for 27 frames.
// The authored clip data is the strongest evidence of the three, so the body
// runs its full 31 ticks here and the input hold follows the body. That means
// the phase alignment between the body and the burst — which burst frame the
// contact hold lands on — is an ASSUMPTION, not a decoded fact. No fudge factor
// has been applied to make the three reconcile; closing the gap needs a frame
// -stepped capture of mode 0x49 against the burst actor.

/** The clip mode 0x49 latches with SETANIM(entity, 8). */
export const KICK_POSE_CLIP = 8;

/**
 * Sprite pack the player is drawn from for the whole of mode 0x49 — READ from
 * the clip-range rule (`playerPackForClip(8)`), not chosen here. The original
 * resolves the pack from the clip id in its per-frame clip resolver
 * (F0x8008F9C0, fieldstg.s:13153-13176); this only names what that rule already
 * answers, so a change to the table moves this too.
 */
export const KICK_POSE_SPRITE = playerPackForClip(KICK_POSE_CLIP);
/** Ordinary standing clip, restored with leader mode 1 when the clip ends. */
export const KICK_POSE_IDLE_CLIP = 1;

/** Ticks per frame of clip 8, the same in every authored direction. */
export const KICK_POSE_FRAME_TICKS: readonly number[] = [4, 3, 4, 15, 5];
/** Total length of clip 8 — the whole of mode 0x49. */
export const KICK_POSE_TICKS = KICK_POSE_FRAME_TICKS.reduce((a, b) => a + b, 0);
/** The fourth frame: the moment of contact, held fifteen ticks. */
export const KICK_POSE_CONTACT_FRAME = 3;

/**
 * The pack's own frame numbers for clip 8, per authored direction (bins 25-29
 * of p002plyk/30.bin). Kept as decoded record; the renderer reads the built
 * manifest, which carries the same five lists.
 */
export const KICK_POSE_AUTHORED_FRAMES: Readonly<Record<string, readonly number[]>> = {
  down: [20, 21, 22, 23, 24],
  "down-left": [15, 16, 17, 18, 19],
  left: [10, 11, 12, 13, 14],
  "up-left": [5, 6, 7, 8, 9],
  up: [0, 1, 2, 3, 4],
};

/**
 * Which frame of clip 8 is on screen `tick` ticks in (0-based), or null once
 * the clip has played out and the entity's anim-complete flag would be set.
 */
export function kickPoseFrameAt(tick: number): number | null {
  if (tick < 0) return null;
  let t = tick;
  for (let i = 0; i < KICK_POSE_FRAME_TICKS.length; i++) {
    t -= KICK_POSE_FRAME_TICKS[i]!;
    if (t < 0) return i;
  }
  return null;
}

/** Junior's body during mode 0x49. */
export interface KickPose {
  /** Clip latched by SETANIM. 8 for the kick, 1 once mode 1 is restored. */
  clip: number;
  /** Ticks the latched clip has been running. */
  ticks: number;
  /** True once the leader is back in field mode 1 with the standing clip. */
  finished: boolean;
}

/** Enter mode 0x49: SETANIM(entity, 8) on the entry tick. */
export function startKickPose(): KickPose {
  return { clip: KICK_POSE_CLIP, ticks: 0, finished: false };
}

/**
 * Advance the body one field tick.
 *
 * The original waits on the entity's anim-complete flag; for this clip that flag
 * is raised after exactly KICK_POSE_TICKS in every authored direction, so the
 * wait is counted here rather than handed back to the host. Returns true on the
 * tick the leader goes back to field mode 1.
 */
export function tickKickPose(p: KickPose): boolean {
  if (p.finished) return false;
  p.ticks += 1;
  if (p.ticks < KICK_POSE_TICKS) return false;
  p.clip = KICK_POSE_IDLE_CLIP;
  p.ticks = 0;
  p.finished = true;
  return true;
}

// ── the manager's phase machine ────────────────────────────────────────────

/** Phase at which the kick resolves. Reached two per frame, so ten frames. */
export const DECIDE_PHASE = 0x14;
/** Phase step per frame: `phase += delta + 1` with the engine delta of 1. */
export const PHASE_STEP = 2;
/** Phase parked on after the kick has resolved; only the shake still runs. */
export const PHASE_RESOLVED = 0x80;

/** Encounter index the live tree drops when the roll comes up short. */
export const NEAR_ENCOUNTER_SLOT = 3;
/** ...and when it does not. */
export const FAR_ENCOUNTER_SLOT = 6;
/** `rand() & 0x7f`, below this takes the near slot: 102/128 against 26/128. */
export const NEAR_ROLL_MAX = 0x66;

/** Which scripted-encounter slot this kick on the live tree drops. */
export function rollTreeEncounter(rand: () => number): number {
  return (Math.abs(rand()) & 0x7f) < NEAR_ROLL_MAX
    ? NEAR_ENCOUNTER_SLOT : FAR_ENCOUNTER_SLOT;
}

/** Where the live marker jumps after a drop — a flat `rand() % count`. */
export function relocateActiveTree(count: number, rand: () => number): number {
  return count > 0 ? Math.abs(rand()) % count : 0;
}

// ── the radar card ─────────────────────────────────────────────────────────

/** Frames the card stays up (`slti $v1, 0x78`, file 0x9bd4). */
export const RADAR_LIFE = 0x78;
/** Both axes inside this: the closest reading. */
export const RADAR_NEAR = 0x80;
/** Both axes inside this: the middle reading. */
export const RADAR_MID = 0x100;
/** FIELDCOM sub-entry 1 ids: the card, then far/mid/near rings. */
export const RADAR_FRAME = 0x4f;
export const RADAR_ICON_FAR = 0x50;
export const RADAR_ICON_MID = 0x51;
export const RADAR_ICON_NEAR = 0x52;
/** Screen anchor both layers draw at (file 0x9b7c/0x9b98). */
export const RADAR_X = 0xf8;
export const RADAR_Y = 0xa8;
/** Palette rows the rings cycle through — the pulse (`% 10`, file 0x9b40). */
export const RADAR_CLUT_ROWS = 10;

export interface TreeRadar {
  /** Ring sprite id. */
  icon: number;
  /** Frames per palette row: 3 near, 6 mid, 12 far — the pulse rate. */
  divisor: number;
  /** Frames the card has been up. */
  timer: number;
}

/**
 * The reading for a live tree `dx`,`dy` away.
 *
 * The test is per-axis and rectangular, not a real distance: the original
 * compares |dx| and |dy| separately against 0x80 and then 0x100, so a tree
 * dead ahead at 200px reads the same band as one 200px diagonally away.
 */
export function treeRadarReading(dx: number, dy: number): { icon: number; divisor: number } {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < RADAR_NEAR && ay < RADAR_NEAR) return { icon: RADAR_ICON_NEAR, divisor: 3 };
  if (ax < RADAR_MID && ay < RADAR_MID) return { icon: RADAR_ICON_MID, divisor: 6 };
  return { icon: RADAR_ICON_FAR, divisor: 0xc };
}

/** Palette row the rings are on this frame. */
export function radarClutRow(r: TreeRadar): number {
  return Math.floor(r.timer / r.divisor) % RADAR_CLUT_ROWS;
}

/** Advance the card one frame; false once it has expired. */
export function tickTreeRadar(r: TreeRadar): boolean {
  r.timer += 1;
  return r.timer < RADAR_LIFE;
}

// ── the kick ───────────────────────────────────────────────────────────────

export interface ScriptCursor { cursor: number; timer: number; sprite: number }

export interface TreeKickState {
  /** Manager index of the tree being kicked. */
  index: number;
  /** Facing Junior kicked from, 0-7. */
  facing: number;
  /** Manager phase (+0x10). */
  phase: number;
  /** The tree's shake script. */
  shake: ScriptCursor;
  /** Junior's kick cells; null once his 28 frames are up. */
  kick: ScriptCursor | null;
  /** Junior's own body — leader mode 0x49, clip 8 off P002PLYK. */
  pose: KickPose;
  /** True once the shake script has run out — the manager is idle again. */
  done: boolean;
}

/**
 * Whether the D-pad is still taken away. Leader mode 0x49 owns the input, and
 * the mode ends when Junior's clip 8 does — so the hold follows the BODY, not
 * the burst effect (which is 28 frames; see the unresolved note above).
 */
export function treeKickHoldsInput(s: TreeKickState | null | undefined): boolean {
  return !!s && !s.pose.finished;
}

/** What the kick asks the host to do this frame. */
export type TreeKickCue =
  | { kind: "nothing" }
  /** The live tree dropped something: fight `slot`, live marker moves to `relocateTo`. */
  | { kind: "encounter"; slot: number; relocateTo: number }
  /** A dead tree: put the radar card up (replacing any card already there). */
  | { kind: "radar"; radar: TreeRadar };

export function startTreeKick(index: number, facing: number): TreeKickState {
  return {
    index,
    facing: ((facing % 8) + 8) % 8,
    phase: 0,
    shake: { cursor: 0, timer: 0, sprite: TREE_SPRITE_IDLE },
    kick: { cursor: 0, timer: 0, sprite: 0 },
    pose: startKickPose(),
    done: false,
  };
}

/**
 * Advance one {spriteId, duration} script by one frame.
 *
 * The original compares `duration < timer` and steps ONE entry per frame, so a
 * zero-duration entry costs a frame rather than chaining. Returns false when the
 * 0xff terminator is reached.
 */
function advanceScript(c: ScriptCursor, script: readonly ScriptStep[]): boolean {
  c.timer += 1;
  const step = script[c.cursor];
  if (!step || c.timer <= step.d) return true;
  c.timer -= step.d;
  c.cursor += 1;
  const next = script[c.cursor];
  if (!next || next.id === 0xff) return false;
  c.sprite = next.id;
  return true;
}

/**
 * Advance the kick one frame.
 *
 * `ctx.liveIndex` is the stage's live tree; `ctx.liveX/liveY` its coordinates
 * (the manager keeps its own copy at +0x60/+0x64 and the radar reads THAT, not
 * the record, which is why the card measures to the live tree and not to the one
 * you kicked).
 */
export function tickTreeKick(
  s: TreeKickState,
  ctx: { count: number; liveIndex: number; liveX: number; liveY: number; kickedX: number; kickedY: number },
  rand: () => number,
): TreeKickCue {
  if (s.done) return { kind: "nothing" };
  let cue: TreeKickCue = { kind: "nothing" };

  // Junior's body (mode 0x49) and the burst cells run on separate clocks; both
  // end well before the shake does. Their phase alignment is the unresolved
  // 31/28/27 question documented above.
  tickKickPose(s.pose);
  if (s.kick && !advanceScript(s.kick, KICK_SCRIPTS[s.facing]!)) s.kick = null;

  if (s.phase === 0) {
    s.phase = 1;
  } else if (s.phase !== PHASE_RESOLVED) {
    if (s.phase < DECIDE_PHASE) {
      s.phase += PHASE_STEP;
    } else {
      if (s.index === ctx.liveIndex) {
        cue = {
          kind: "encounter",
          slot: rollTreeEncounter(rand),
          relocateTo: relocateActiveTree(ctx.count, rand),
        };
      } else {
        const r = treeRadarReading(ctx.liveX - ctx.kickedX, ctx.liveY - ctx.kickedY);
        cue = { kind: "radar", radar: { ...r, timer: 0 } };
      }
      s.phase = PHASE_RESOLVED;
    }
  }

  if (!advanceScript(s.shake, TREE_SHAKE_SCRIPT)) {
    s.shake.sprite = TREE_SPRITE_IDLE;
    s.done = true;
  }
  return cue;
}
