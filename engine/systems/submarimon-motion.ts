// Submarimon motion — how the water traversal form swims, both axes.
//
// ONE BUTTON DOES BOTH. X is a single throttle: holding it drives the sub
// FORWARD along its facing and DOWNWARD at the same time; releasing it coasts
// the sub to a stop while buoyancy floats it back up. That is not an
// interpretation, it is the same action id driving both halves -- see § THROTTLE
// below. The sub turns with LEFT/RIGHT rather than being steered by a D-pad
// direction, i.e. tank steering, so Junior's 8-way walk does not apply to it.
//
// DECODE: docs/research/field/submarimon-buoyancy-decoded-2026-07-28.md
// Source: ~/ddw3/asm/dw2003/pro/fieldstg.s, PAL SLES-03936, overlay base
// 0x80082cb0. Handler F0x8008e45c = file 0xb7ac..0xbbf8 (the whole function,
// up to its `jr $ra` at 0xbbf4). Authority 2 (original assembly).
//
// The field-character constructor F0x8009116c installs this function at
// char+0x108 -- the per-tick update slot -- for sprite id 327 (0x147,
// p122sbmm) ONLY, in place of the default 0x8008e8ac, and seeds char+0x64 =
// 0x3000 with char+0x84 = 1 (file 0xe6b4-0xe6f8; see engine/systems/
// dive-form.ts § 6). So buoyancy is not a Seabed property, it is a
// Submarimon-character property: Junior (id 2) and Digmon (id 326) keep the
// default handler and never move vertically.
//
// Struct fields this models (all in the field-character record):
//   +0x64  height,   signed 8.8 fixed point, up is POSITIVE
//   +0xc4  vertical velocity, signed 8.8 fixed point per field tick
//   +0x10  action id: 0x4b while X is held (thrusting down), 0x4c otherwise
// The handler runs once per 50 Hz PAL field tick regardless of whether the
// player is moving horizontally -- it is the character's tick method, not a
// movement callback -- so height keeps integrating while standing still.
//
// RENDERING. The native field-actor renderer subtracts the height from the
// billboard's screen row and the shadow adds it straight back:
//   0x8008f5d0: `lw $v0,0x64($s1) / lw $v1,0x14($sp) / sra $v0,8 /
//                subu $v1,$v1,$v0 / sw $v1,0x14($sp)`
//     => actorScreenY = groundScreenY - (height >> 8)
//   0x8008f834: the shadow re-adds it (already modelled by
//     engine/systems/field-shadow.ts `fieldShadowRect.actorHeightFixed`).
// Height therefore never touches the collision or trigger position, which stay
// on char+0x50/+0x54 (the ground x/y the renderer projects before this
// subtraction).
//
// SOUND. The handler does drive packed sound 0xa0045f4a (SUB_MOVE) -- play on
// the tick the action id first becomes 0x4b with the handle at +0xc8 == -1,
// stop when X is released or on the surface path -- but that lifecycle is
// deliberately NOT wired here; see the decode doc § "Open" and the correction
// applied to docs/research/audio/sfx-triggers.md.
//
// THROTTLE (the horizontal axis; WORLD-Q004, resolved 2026-07-28)
//
// F0x8008e45c writes no position at all. It does not need to: the field-character
// tick driver calls the per-form handler and THEN runs the shared state
// dispatcher unconditionally (file 0xe3b4-0xe3d0):
//   `lw $v0,0x108($s0) / beqz $v0,0x80091080 / jalr $v0` then
//   `jal 0x8008fed0`   <- always
// So the handler's job is to pick the character's STATE, and F0x8008fed0 moves
// it. The two states F0x8008e45c selects are 0x4b and 0x4c, and they belong to
// nobody else: `code-search "a1, 0x4b"` over all 590078 lines of
// ~/ddw3/asm/dw2003 returns one field-character +0x2c setter call, fieldstg.s
// L11832 @0x8008e574, inside this handler. (The other hits are a card-deck
// overlay and unrelated `lui` immediates.)
//
//   state 0x4b THRUST (RAM 0x80090190, file 0xd4e0) -- action id set while X is
//     held. On entry `sw $zero,0x68($s0)` zeroes the speed, then per tick
//     `addiu $v1,$v1,8` with the cap below, then the direction helper
//     [0x8009b710](&char+0x58, speed, facing, &out), then
//     `+0x50 += out.x` / `+0x54 += out.y` (0xd590/0xd5a8), then
//     F0x8008fd74(char, 1, 1) -- so thrusting rolls for encounters.
//   state 0x4c COAST (RAM 0x800900e4, file 0xd434) -- X released.
//     `beqz +0x68 -> tail` (a stopped sub does not move), else
//     `addiu $v0,$v0,-8` clamped at 0 by `bgez`, same helper, same position
//     add. NO F0x8008fd74 call: gliding does not roll for encounters.
//
// Junior's default handler F0x8008e8ac (file 0xbbfc-0xbd90) is the contrast: it
// never writes +0x50/+0x54 either, but it feeds the D-pad nibble to F0x8008e13c,
// which maps nibble -> facing through table 0x80097c28 and selects the walk/run
// states. F0x8008e45c contains no `jal 0x8008e13c`, which is exactly why the sub
// is not D-pad steered.
//
// TURNING is in F0x8008e45c itself (0xb944-0xb994), gated on a free-running tick
// `& 7 == 0`, i.e. once every 8 field ticks: pad 0x20 rotates the facing
// +1 and pad 0x80 rotates it -1, both `& 7`, each also setting +0xc0 = 1.

/**
 * char+0x64 at construction (F0x8009116c file 0xe6e0: `li $v0,0x3000`).
 *
 * The seed is CONDITIONAL (file 0xe6cc-0xe6ec): `lw $v0,0x26d8($v1)` reads
 * [0x8004b40c] and only when it is zero does the constructor use 0x3000 --
 * otherwise it restores the height saved at [0x8004b428]. So re-entering a
 * seabed screen keeps the depth you left at rather than snapping you back to
 * mid-water. `createSubmarimonMotion` takes the carried height for that reason.
 */
export const SUBMARIMON_INITIAL_HEIGHT = 0x3000;

/** Native sprite-table id of the water form (0x147). Only this id buoys. */
export const SUBMARIMON_SPRITE_ID = 0x147;

/** Per-tick velocity step, both directions (`addiu $v0,$v1,-0x4` / `,0x4`). */
export const SUBMARIMON_VELOCITY_STEP = 4;

/** Descend cap: `slti $v0,$v1,-0xbf` -> `li $v0,-0xc0` (0xb9b0-0xb9b8). */
export const SUBMARIMON_VELOCITY_MIN = -0xc0;

/** Rise cap: `slti $v0,$v1,0x80` -> `li $v0,0x80` (0xb9cc-0xb9d8). */
export const SUBMARIMON_VELOCITY_MAX = 0x80;

/** Unconditional floor, applied last (0xbbcc-0xbbe0: `li $v0,0x1800`). */
export const SUBMARIMON_HEIGHT_MIN = 0x1800;

/** Unconditional ceiling, applied last (0xbbb4-0xbbc8: `li $v0,0x7000`). */
export const SUBMARIMON_HEIGHT_MAX = 0x7000;

/**
 * The talk/examine depth limit. On the CIRCLE path the handler loads the
 * character's own height and compares `slti $v0,0x2000` (file 0xb834-0xb83c);
 * at or above 0x2000 it branches past the F0x8008e2cc talk probe (0xb840), so
 * the sub can only talk to / open what it has sunk down to. Height is
 * positive-up, so the operable side is BELOW this value.
 */
export const SUBMARIMON_TALK_DEPTH_MAX = 0x2000;

/**
 * Which limit table a tick consults, chosen from the velocity AFTER the input
 * update: `move $v1,$a0 / slti $v1,0x5 / bnez $v1,.L0x0000bab4` (0xba28-0xba30).
 * velocity >= 5 (rising) reads the CEILING table, anything else the FLOOR one.
 */
export const SUBMARIMON_RISING_VELOCITY_THRESHOLD = 5;

/**
 * Ceiling table. Jump table at RAM 0x80083538 (fieldstg file 0x888), five
 * entries in ascending order, indexed by `(terrainCode & 0xff) - 0x12` with an
 * unsigned `sltiu ...,0x5` range check. Each case compares the height against
 * `limit + 1` via `slti` and converges at 0xbaa4, so the case fires when
 * height > limit.
 *
 *   0x12 -> 0x8008e718 (0xba68) slti 0x6001   0x15 -> 0x8008e73c (0xba8c) 0x3001
 *   0x13 -> 0x8008e724 (0xba74) slti 0x5001   0x16 -> 0x8008e748 (0xba98) 0x2001
 *   0x14 -> 0x8008e730 (0xba80) slti 0x4001
 *
 * A ceiling case sets the violation flag but leaves the snap value at 0, so a
 * rising Submarimon has its velocity zeroed and its height left where it is.
 */
export const SUBMARIMON_CEILING_BY_TERRAIN: Readonly<Record<number, number>> = Object.freeze({
  0x12: 0x6000,
  0x13: 0x5000,
  0x14: 0x4000,
  0x15: 0x3000,
  0x16: 0x2000,
});

/**
 * Floor table. Jump table at RAM 0x80083550 (fieldstg file 0x8a0), five entries
 * in ascending order, indexed by `(terrainCode & 0xff) - 0x02`, same unsigned
 * range check. Each case is `slti height, limit` + `beqz -> no violation`, so it
 * fires when height < limit, and each carries its own SNAP value `limit + 0xc`
 * loaded into $s2 (`li $s2,0x200c` .. `li $s2,0x600c`).
 *
 *   0x02 -> 0x8008e794 (0xbae4) 0x2000 / snap 0x200c
 *   0x03 -> 0x8008e7b4 (0xbb04) 0x3000 / snap 0x300c
 *   0x04 -> 0x8008e7d4 (0xbb24) 0x4000 / snap 0x400c
 *   0x05 -> 0x8008e7f4 (0xbb44) 0x5000 / snap 0x500c
 *   0x06 -> 0x8008e814 (0xbb64) 0x6000 / snap 0x600c
 *
 * The +0xc is the original's own constant, not a rounding artefact: the snap
 * lands the character 12/256 px ABOVE the limit it just broke.
 */
export const SUBMARIMON_FLOOR_BY_TERRAIN: Readonly<Record<number, number>> = Object.freeze({
  0x02: 0x2000,
  0x03: 0x3000,
  0x04: 0x4000,
  0x05: 0x5000,
  0x06: 0x6000,
});

/** `li $s2,<limit>+0xc` -- the height a broken floor snaps the character to. */
export const SUBMARIMON_FLOOR_SNAP_BIAS = 0xc;

/** Forward speed step per tick, both states (`addiu $v1,$v1,8` / `,-8`). */
export const SUBMARIMON_SPEED_STEP = 8;

/**
 * Forward speed cap, in the same 24.8 fixed point as FIELD_RUN_MAGNITUDE.
 *
 * The thrust state picks between two caps on [0x8005ccac] (file 0xd524-0xd554):
 * zero -> 0x266, non-zero -> 0x200. That global is **never written anywhere in
 * ~/ddw3/asm/dw2003** -- every one of its five reference sites is a `lw` (exe/
 * f12.s L15, exe/fns.s L14539/14679/17904/18328) -- and the pair is a VIDEO MODE
 * compensation, not a gameplay toggle: 0x266/0x200 = 1.1992 = 6/5, and
 * F0x8001d3f4 branches on the same global to choose 0x133 vs 0x100, the same
 * ratio. 50 Hz needs 6/5 the per-tick step to cover the same ground as 60 Hz.
 * We target PAL SLES-03936 at FIELD_TICK_RATE 50, so the PAL cap 0x266 is the
 * right one -- consistent with FIELD_RUN_MAGNITUDE already being the PAL 0x4cc
 * rather than 0x400.
 *
 * 0x266 / 0x100 = 2.4 px per tick = 119.5 px/s, about half Junior's run.
 */
export const SUBMARIMON_SPEED_MAX = 0x266;

/** The 60 Hz sibling cap, recorded for completeness; not used by this build. */
export const SUBMARIMON_SPEED_MAX_NTSC = 0x200;

/** Facing rotates once every 8 field ticks (`andi $v0,0x7 / bnez` at 0xb954). */
export const SUBMARIMON_TURN_INTERVAL_TICKS = 8;

/** The character fields Submarimon's two axes need. */
export interface SubmarimonMotion {
  /** char+0x64, signed 8.8 fixed point, positive = above the ground plane. */
  heightFixed: number;
  /** char+0xc4, signed 8.8 fixed point, added to the height each tick. */
  velocityFixed: number;
  /** char+0x68, unsigned 24.8 forward speed along the facing. */
  speedFixed: number;
  /** char+0x60, facing 0-7 in the shared field direction order. */
  facing: number;
  /** The free-running tick whose low 3 bits gate turning. */
  turnTick: number;
}

/**
 * The constructor's state for sprite id 327.
 *
 * `carriedHeight` reproduces the conditional seed: pass the height the player
 * left the water at to restore it ([0x8004b40c] non-zero -> [0x8004b428]), or
 * omit it for a first entry (-> 0x3000). `facing` defaults to 0 (down), the
 * field-character default the constructor leaves in +0x60.
 */
export function createSubmarimonMotion(
  carriedHeight?: number | null, facing = 0,
): SubmarimonMotion {
  const seed = carriedHeight == null ? SUBMARIMON_INITIAL_HEIGHT : carriedHeight;
  return {
    heightFixed: clampSubmarimonHeight(seed),
    velocityFixed: 0,
    speedFixed: 0,
    facing: facing & 7,
    turnTick: 0,
  };
}

/** The unconditional [0x1800, 0x7000] band (0xbbb4-0xbbe0), on its own. */
export function clampSubmarimonHeight(heightFixed: number): number {
  if (heightFixed > SUBMARIMON_HEIGHT_MAX) return SUBMARIMON_HEIGHT_MAX;
  if (heightFixed < SUBMARIMON_HEIGHT_MIN) return SUBMARIMON_HEIGHT_MIN;
  return heightFixed;
}

/**
 * One tick of the forward throttle, state 0x4b / 0x4c.
 *
 * Thrusting accelerates by 8 to the cap; coasting decelerates by 8 and stops at
 * zero (`bgez` clamp). The native zeroes the speed on the tick it ENTERS 0x4b
 * (`sw $zero,0x68($s0)` at 0xd518, reached only via the state's entry arm), so a
 * tap of X restarts the ramp from a standstill rather than resuming.
 */
export function stepSubmarimonSpeed(
  speedFixed: number, thrusting: boolean, entering = false,
): number {
  if (thrusting) {
    const base = entering ? 0 : speedFixed;
    return Math.min(SUBMARIMON_SPEED_MAX, base + SUBMARIMON_SPEED_STEP);
  }
  if (speedFixed === 0) return 0;
  return Math.max(0, speedFixed - SUBMARIMON_SPEED_STEP);
}

/**
 * One tick of tank steering (0xb944-0xb994): `turn` is -1 for LEFT (pad 0x80),
 * +1 for RIGHT (pad 0x20), 0 for neither, and the facing only moves on ticks
 * where the free-running counter's low 3 bits are clear.
 */
export function stepSubmarimonFacing(
  facing: number, turnTick: number, turn: -1 | 0 | 1,
): number {
  if (turn === 0) return facing & 7;
  if ((turnTick & (SUBMARIMON_TURN_INTERVAL_TICKS - 1)) !== 0) return facing & 7;
  return (facing + turn + 8) & 7;
}

/**
 * The motion state a field character of `spriteId` starts with: a Submarimon
 * record gets buoyancy, everything else gets none.
 *
 * `null` means "this actor has the default 0x8008e8ac handler", which is the
 * exact native distinction -- Junior and Digmon are not Submarimons with a
 * height of zero, they never run this code at all.
 */
export function submarimonMotionForSprite(
  spriteId: number | null | undefined,
): SubmarimonMotion | null {
  return spriteId === SUBMARIMON_SPRITE_ID ? createSubmarimonMotion() : null;
}

/** True when this sprite id is the one the constructor installs 0x8008e45c for. */
export function isSubmarimonSprite(spriteId: number | null | undefined): boolean {
  return spriteId === SUBMARIMON_SPRITE_ID;
}

/**
 * Whether this character may reach the ordinary talk/examine probe right now.
 *
 * `null`/`undefined` means the actor has NO height state at all (Junior, Digmon
 * keep the default handler 0x8008e8ac), which the native gate never touches —
 * so the surface forms always answer true. A Submarimon answers true only while
 * it is strictly below {@link SUBMARIMON_TALK_DEPTH_MAX}.
 */
export function submarimonCanInteract(
  motion: SubmarimonMotion | null | undefined,
): boolean {
  return !motion || motion.heightFixed < SUBMARIMON_TALK_DEPTH_MAX;
}

/**
 * One tick of the input half (0xb998-0xb9dc).
 *
 * The handler reads the action id at char+0x10, which the same tick set to 0x4b
 * when the raw pad carries 0x4000 (CROSS / X) and to 0x4c when it does not
 * (0xb8a8-0xb914), so `thrusting` is exactly "X held this tick".
 *
 * Descending (`0x4b`): `slti $v1,-0xbf` -> clamp to -0xc0, else `v1 - 4`.
 * Rising  (`0x4c`): `slti $v1,0x80` -> `v1 + 4`, else clamp to 0x80.
 * Note the asymmetry is real: the descend clamp tests `< -0xbf` (i.e. the
 * already-at-cap case) BEFORE stepping, the rise clamp tests `< 0x80`. On the
 * multiple-of-4 lattice the velocity actually walks, both settle exactly on
 * their cap.
 */
export function stepSubmarimonVelocity(velocityFixed: number, thrusting: boolean): number {
  if (thrusting) {
    if (velocityFixed < SUBMARIMON_VELOCITY_MIN + 1) return SUBMARIMON_VELOCITY_MIN;
    return velocityFixed - SUBMARIMON_VELOCITY_STEP;
  }
  if (velocityFixed < SUBMARIMON_VELOCITY_MAX) return velocityFixed + SUBMARIMON_VELOCITY_STEP;
  return SUBMARIMON_VELOCITY_MAX;
}

/**
 * The terrain-limit half (0xba28-0xbb7c), returning the native's two locals:
 * `$s0` (a limit was violated) and `$s2` (the height to snap to, 0 for none).
 *
 * Only ONE table is consulted per tick, and the tables are disjoint in code
 * space, so a cell coded 0x03 has a floor but no ceiling and a cell coded 0x13
 * has a ceiling but no floor. `terrainCode` is masked with 0xff exactly as the
 * original does (`andi $v0,0xff`) before the range check.
 */
export function submarimonTerrainLimit(
  heightFixed: number,
  velocityFixed: number,
  terrainCode: number,
): { violated: boolean; snapFixed: number } {
  const code = terrainCode & 0xff;

  if (velocityFixed >= SUBMARIMON_RISING_VELOCITY_THRESHOLD) {
    const ceiling = SUBMARIMON_CEILING_BY_TERRAIN[code];
    if (ceiling === undefined) return { violated: false, snapFixed: 0 };
    // `slti height, ceiling + 1` then `bnez -> no violation`.
    return { violated: heightFixed > ceiling, snapFixed: 0 };
  }

  const floor = SUBMARIMON_FLOOR_BY_TERRAIN[code];
  if (floor === undefined) return { violated: false, snapFixed: 0 };
  // `slti height, floor` then `beqz -> no violation`; the case's own snap value.
  if (heightFixed >= floor) return { violated: false, snapFixed: 0 };
  return { violated: true, snapFixed: floor + SUBMARIMON_FLOOR_SNAP_BIAS };
}

/**
 * One complete 50 Hz field tick of Submarimon: the handler's vertical half plus
 * the throttle and facing the state dispatcher acts on. Pure: returns fresh
 * state, never mutates the input.
 *
 * The vertical half runs in the original's order:
 *
 *   1. velocity <- stepSubmarimonVelocity (0xb998-0xb9dc)
 *   2. read the typed terrain code at the GROUND x/y (0xb9e4-0xba0c; the same
 *      query and the same `& 0xff` byte the movement-scale table consumes --
 *      both load a0 from [0x8004b414], cf. 0x80092cc4)
 *   3. height += velocity (0xba14-0xba24)
 *   4. terrain limit; then, if it was violated OR the height left the generic
 *      [0x1800, 0x7000] band (0xbb88-0xbb9c), snap the height when a snap value
 *      exists and zero the velocity (0xbba4-0xbbb0)
 *   5. hard-clamp the height to [0x1800, 0x7000] (0xbbb4-0xbbe0)
 *
 * Step 4's generic band test is only reached when step 4's table found nothing
 * (`bnez $s0`), which is why a terrain violation zeroes the velocity even for a
 * height still inside the band.
 *
 * NOT modelled here because it is the caller's gate, not the motion's: the
 * handler returns immediately, changing nothing, when any of scene_struct+0x50,
 * +0x58 or +0x5c is non-zero (0xb7fc-0xb828). Those are the field's freeze
 * words, so a paused, dialogue-blocked or mid-transition frame does not tick
 * buoyancy at all -- callers must skip this function on such frames rather than
 * pass `thrusting: false`, which would instead make the character rise.
 *
 * `turn` steers (-1 left, +1 right, 0 straight) and `entering` marks the tick
 * the sub enters the thrust state so the speed ramp restarts from zero.
 */
export function tickSubmarimonMotion(
  motion: SubmarimonMotion,
  input: {
    thrusting: boolean;
    terrainCode?: number;
    turn?: -1 | 0 | 1;
    entering?: boolean;
  },
): SubmarimonMotion {
  const velocity = stepSubmarimonVelocity(motion.velocityFixed, input.thrusting);
  let height = motion.heightFixed + velocity;
  let nextVelocity = velocity;

  const { violated, snapFixed } = submarimonTerrainLimit(
    height, velocity, input.terrainCode ?? 0,
  );
  const outsideGenericBand = height > SUBMARIMON_HEIGHT_MAX || height < SUBMARIMON_HEIGHT_MIN;
  if (violated || outsideGenericBand) {
    if (snapFixed !== 0) height = snapFixed;
    nextVelocity = 0;
  }

  const turnTick = motion.turnTick + 1;
  return {
    heightFixed: clampSubmarimonHeight(height),
    velocityFixed: nextVelocity,
    speedFixed: stepSubmarimonSpeed(
      motion.speedFixed, input.thrusting, input.entering ?? false,
    ),
    facing: stepSubmarimonFacing(motion.facing, motion.turnTick, input.turn ?? 0),
    turnTick,
  };
}

/**
 * Whether this tick advances the sub, i.e. whether the caller should apply a
 * displacement. Both states move only when the speed is non-zero: the coast
 * state's `beqz +0x68` skips its whole body, and the thrust state has already
 * added 8 before it moves.
 */
export function submarimonIsAdvancing(motion: SubmarimonMotion): boolean {
  return motion.speedFixed > 0;
}

/**
 * Whether this tick rolls for a random encounter.
 *
 * Only the THRUST state calls F0x8008fd74 (file 0xd5a4, a1=1 a2=1); the coast
 * state has no such call. So gliding to a halt with the engine off cannot start
 * a battle -- releasing X is a way to stop safely.
 */
export function submarimonRollsEncounter(motion: SubmarimonMotion, thrusting: boolean): boolean {
  return thrusting && motion.speedFixed > 0;
}

/**
 * Whole pixels of lift the renderer applies: `sra $v0,0x8` at 0x8008f5d8.
 * JS `>>` matches MIPS `sra` for the negative heights the clamps forbid but the
 * type does not.
 */
export function submarimonLiftPixels(motion: SubmarimonMotion | null | undefined): number {
  return motion ? motion.heightFixed >> 8 : 0;
}

/**
 * The billboard's screen row: `groundScreenY - (height >> 8)` (0x8008f5d0).
 * The shadow keeps `groundScreenY` by re-adding the same term -- pass
 * `motion.heightFixed` as `fieldShadowRect`'s `actorHeightFixed`.
 */
export function submarimonActorScreenY(
  groundScreenY: number, motion: SubmarimonMotion | null | undefined,
): number {
  return groundScreenY - submarimonLiftPixels(motion);
}
