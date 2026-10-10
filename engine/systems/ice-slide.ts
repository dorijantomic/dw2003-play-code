// Ice Dungeon forced slide — the slippery floor in s735/s736.
//
// WHAT THE PLAYER SEES. Stepping onto a slide tile takes control away: Junior
// locks into his standing pose and glides at full running speed along a fixed
// diagonal, ignoring the D-pad entirely, until he reaches a stop tile. There he
// is held in place for about half a second before control comes back. The party
// does NOT slide -- the followers keep trailing him on their usual 9/18/27-tick
// delay, so the line concertinas up behind him and then unwinds.
//
// DECODE: docs/research/field/player-party-movement.md § "Ice Dungeon forced
// slide". Runtime capture: docs/research/field/captures/ice-slide-state1-2026-07-28.txt
// Source: ~/ddw3/asm/dw2003/pro/fieldstg.s, PAL SLES-03936, overlay base
// 0x80082cb0. Authority 2 (original assembly) + authority 1 (controlled capture).
//
// This is NOT actor mode 0x4c. That mode looks like ice in isolation -- it
// decays momentum while holding the idle pose -- but it is Submarimon's coast
// state and belongs to sprite id 327 alone (engine/systems/submarimon-motion.ts).
// The claim `ice-dungeon-mode4c-slide` is `contradicted`; the slide uses modes
// 0x4f and 0x50 and never decays anything.
//
// § 1. WHICH TILES ARE SLIPPERY
//
// The type-7 story-trigger grid supplies both the region and the direction. Each
// non-zero cell byte is split by the step VM at fieldstg 0x800882d0-0x800882e4:
//
//   srl  $v0, $v1, 5      ; high 3 bits -> controller+0x60
//   andi $v1, $v1, 0x1f   ; low 5 bits  -> controller+0x5c  (step-program index)
//   sw   $v0, 0x60($s0)
//   sw   $v1, 0x5c($s0)
//
// The low 5 bits index the stage's 24-byte step program, exactly as they do for
// doors (op 1) and dives (op 9/10). Step op 11 starts a slide and op 12 ends it.
// Those two opcodes occur in the ENTIRE game only in stages 735 and 736 -- 2
// records each, verified over web/assets/data/story_steps.json -- which is why
// the slide is an Ice Dungeon mechanic and nowhere else.
//
// The high 3 bits are the slide's facing, and only the four diagonals ever
// appear (values 1/3/5/7 = down-left, up-left, up-right, down-right; 35 start
// cells and 33 stop cells per stage). The controlled capture confirms the
// transfer end to end: the player entered at tile (29,7), whose cell byte has
// high bits 1, and the actor's facing became 1 (down-left) on that exact frame.
//
// § 2. THE TWO MODES
//
// op 11 dispatches at 0x8008849c through the actor's +0x150 method
// (F0x8008f0a4), passing controller+0x60 as the direction:
//
//   lw $a0, 0x58($s0)     ; the leader actor
//   lw $a1, 0x60($s0)     ; the cell's high-bit facing
//   lw $v0, 0x150($a0)
//
// F0x8008f0a4 sets mode 0x4f, clears actor+0x108 and stores the facing:
//
//   if (actor->mode != 0x4f) { actor->setMode(0x4f); actor->+0x108 = 0;
//                              actor->facing = dir; }
//
// Clearing +0x108 is what suspends the character's own per-tick handler for the
// duration -- the same slot Submarimon's buoyancy lives in -- and mode 0x50
// restores the default 0x8008e8ac when the slide ends.
//
// Mode 0x4f's body (0x8009036c) raises scene_struct+0x60 (the field control
// lock, which is why input is ignored), starts clip 1 and a looping sound,
// projects actor+0x68 through the stored facing and adds the result STRAIGHT to
// actor+0x50/+0x54. Note "straight": unlike ordinary walking (mode 3) it does
// not collision-resolve. The authored slide lanes are built so they never need
// to, and reproducing the native motion means not adding a resolve step here.
//
// op 12 dispatches at 0x800884b0 through +0x154 (F0x8008f0f0), which flips
// 0x4f -> 0x50 and nothing else. Mode 0x50's body (0x80090414) stops the sound,
// holds position, waits out its counter, clears scene_struct+0x60, requests idle
// mode 1 and calls F0x8008fd60 to restore the normal tick handler.
//
// § 3. SPEED AND DURATION
//
// The glide uses the actor's stock +0x68 = 0x4cc, i.e. the ordinary RUN
// magnitude -- the slide is not faster than running, it just cannot be steered
// or stopped. The capture bears this out: 115 px of x travel over 34 vsync
// frames = 3.382 px/frame against the 3.390625 px/frame the down-left row of the
// direction table predicts, i.e. one update per PAL vsync.
//
// The recovery hold is 25 field ticks (0.5 s at 50 Hz), measured from the
// capture: mode 0x50 at frames 51..75, idle mode 1 at frame 76. The native gate
// is `actor+0x14 == 0x1e` (30), but +0x14 is NOT the movement clock -- it
// advances ~1.2 units per vsync in the capture (values 0,1,3,4,5,6,7,9,a,...
// skipping one every fifth or sixth frame), so 30 of its units elapse in 25
// field ticks. We model the observed 25 ticks rather than the raw threshold
// because ticks are the clock this engine actually runs on. What drives +0x14 at
// that rate is still unidentified; if it is ever pinned down and the ratio turns
// out not to be exactly 6/5, this constant is the thing to revisit.

import {
  FIELD_RUN_MAGNITUDE,
  fieldDirectionDelta,
  fieldDirectionFromIndex,
  type FieldDirection,
} from "./field-movement.ts";

/** Step-program opcode that enters the forced glide. */
export const ICE_SLIDE_START_OP = 11;
/** Step-program opcode that ends it. */
export const ICE_SLIDE_STOP_OP = 12;

/** actor+0x68 during a slide: the stock run magnitude, unmodified. */
export const ICE_SLIDE_MAGNITUDE = FIELD_RUN_MAGNITUDE;

/**
 * Field ticks mode 0x50 holds the player before returning control, measured
 * from the s735 capture (frames 51..75 inclusive). See § 3.
 */
export const ICE_SLIDE_RECOVERY_TICKS = 25;

/** Native actor modes, kept for traceability against the capture log. */
export const ICE_SLIDE_MODE_GLIDE = 0x4f;
export const ICE_SLIDE_MODE_STOP = 0x50;

/** Low 5 bits of a story-trigger cell: the step-program record index. */
export function triggerCellStepIndex(cellByte: number): number {
  return cellByte & 0x1f;
}

/** High 3 bits of a story-trigger cell: the argument op 11 uses as its facing. */
export function triggerCellArgument(cellByte: number): number {
  return (cellByte >> 5) & 0x07;
}

export type IceSlidePhase = "glide" | "stop";

export type IceSlideState = {
  /** `glide` = mode 0x4f, `stop` = mode 0x50. */
  phase: IceSlidePhase;
  /** Facing copied from the entry cell; fixed for the whole slide. */
  dir: FieldDirection;
  /** Field ticks spent in the current phase. */
  ticks: number;
};

/**
 * Enter mode 0x4f with the entry cell's facing. `argument` is the cell byte's
 * high 3 bits, i.e. a native 0-7 facing index.
 */
export function beginIceSlide(argument: number): IceSlideState {
  return { phase: "glide", dir: fieldDirectionFromIndex(argument), ticks: 0 };
}

/** Mode 0x4f -> 0x50. Re-entering op 12 while already stopping is a no-op. */
export function stopIceSlide(state: IceSlideState): IceSlideState {
  if (state.phase !== "glide") return state;
  return { ...state, phase: "stop", ticks: 0 };
}

/** True while the field control lock (scene_struct+0x60) is raised. */
export function iceSlideLocksInput(state: IceSlideState | null): boolean {
  return state !== null;
}

export type IceSlideTick = {
  /** Next state, or null once mode 0x50 has restored idle mode 1. */
  state: IceSlideState | null;
  /** Displacement to add directly to the player position, without collision. */
  delta: { x: number; y: number };
};

/**
 * Advance one native field tick. Mode 0x4f displaces by the full run vector
 * along the stored facing; mode 0x50 holds position and counts down the
 * recovery. The caller applies `delta` WITHOUT collision resolution (§ 2).
 */
export function tickIceSlide(state: IceSlideState): IceSlideTick {
  if (state.phase === "glide") {
    return {
      state: { ...state, ticks: state.ticks + 1 },
      delta: fieldDirectionDelta(state.dir, ICE_SLIDE_MAGNITUDE, 0),
    };
  }
  const ticks = state.ticks + 1;
  if (ticks >= ICE_SLIDE_RECOVERY_TICKS) return { state: null, delta: { x: 0, y: 0 } };
  return { state: { ...state, ticks }, delta: { x: 0, y: 0 } };
}
