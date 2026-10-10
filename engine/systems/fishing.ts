// engine/systems/fishing.ts
//
// Fishing — the bobber minigame you get once you own the FishingPole.
//
// WHAT THE PLAYER DOES. Stand on a fishing spot at the water's edge and press
// the action button. The float goes out, sits for about a second and a half,
// and then a marker starts sweeping back and forth along a bar. Press CIRCLE to
// strike. The marker does not stop dead — it decelerates and glides to a halt,
// and where it comes to rest is what decides the cast. Land it on a live band of
// this cast's pattern and something takes the line; land it anywhere else and
// you get nothing.
//
// THE PATTERN IS ON SCREEN. The bar is not blank: the original draws the strip
// for THIS cast's pattern inside the bar frame (FIELDCOM sub-entry 1, id
// 0x3e + pattern, a 48x8 cell inset at dx 8, dy 8 — one strip per pattern, 48
// pixels for the meter's 48 bands, so it is one pixel per band). Reading that
// strip and timing the marker against it is the skill. The bands are laid out
// below exactly as the strips draw them.
//
// WHAT YOU CATCH IS A FIGHT, NOT AN ITEM. There is no fish, no drop table and no
// inventory write anywhere in the fishing code. A successful strike starts a
// BATTLE, and which battle depends on which of the two live band values the
// marker stopped on: band 1 is a Cardmon, band 2 is that area's big water
// Digimon (Seadramon at Phoenix Bay, Divermon at Divermon's Lake, Coelamon on
// the Central Sector coast, ...). Slot 4 is a Cardmon on all forty-six fishing
// stages — see tools/extract_fishing_spots.py, which reads both parties out of
// each stage's own scripted encounter block.
//
// SIXTEEN CASTS PER VISIT. Entering a map sets a fishing budget of 16. Every
// cast spends one. While there is budget left the cast rolls one of eight
// patterns; once it is gone every cast uses pattern 8, whose track is all zeros
// — the marker still sweeps and you can still strike, but nothing can ever be
// on the line. Re-entering the map sets the budget back to 16.
//
// DECODE. Bobber tick F0x8008d27c (original assembly ~/ddw3/asm/dw2003/pro/
// fieldstg.s, overlay base 0x80082cb0, file 0xa5cc-0xaa90); constructor
// F0x8008d744 (file 0xaa94); spawned by the op-7 scene controller's +0x120 slot
// F0x8008f304 (file 0xc654). Vtable slots +0x28/+0x2c/+0x30/+0x34 are the
// generic set-mode/phase/sub/idle stubs and +0x38..+0x44 their advance
// counterparts, installed by F0x800143dc (~/ddw3/asm/dw2003/exe/fns.s L4866) —
// that is what the calls through the object's own table below resolve to.
// Object fields: +0xc mode, +0x10 phase, +0x14 sub-state, +0x18 idle timer,
// +0x50/+0x54 world x/y, +0x58 pattern, +0x5c meter, +0x60 speed, +0x64 sweep
// direction. Write-up: docs/research/field/fishing-system-decoded-2026-07-11.md.

import { FIELD_TICK_RATE } from "./field-movement.ts";
import { playerPackForClip } from "./player-clip-packs.ts";

/** Bank-0x80 flag for FishingPole possession (item id 5). Gates every spot. */
export const FISHING_POLE_FLAG = 0x8005;

/** Catches per map visit. `li $v0, 0x10` / `sw $v0, 0x26f8($s0)`, file 0x488c. */
export const FISHING_BUDGET = 16;

/** Ticks the float sits before the sweep starts (`slti $v1, 0x5b`, file 0xa6a0). */
export const CAST_SETTLE_TICKS = 0x5b;

/** Meter travel, end to end (`slti $v0, 0x3000`, file 0xa8f4). */
export const METER_MAX = 0x3000;

/** Meter speed at the moment the sweep starts (file 0xa658). */
export const METER_SPEED = 0x100;

/** Meter units per track band — 48 bands span the bar (`sra $a2, 8`, file 0xaa34). */
export const METER_BAND = 0x100;

/** Fast brake: 3 strikes in 4 take it (`addiu $v0, -0x10`, file 0xa774). */
export const BRAKE_FAST = 0x10;

/** Slow brake: 1 strike in 4 takes it, gliding four times as far (file 0xa798). */
export const BRAKE_SLOW = 4;

/** Ticks the bobber holds on the stopped marker before resolving (file 0xa7f0). */
export const RESOLVE_TICKS = 0x3c;

/** Pattern forced once the map's budget is spent (file 0xa648). Track is all zeros. */
export const EMPTY_PATTERN = 8;

/** Scripted-encounter-block slot each live band starts a battle from (file 0xfaf0). */
export const BAND_SLOT: Readonly<Record<number, number>> = { 1: 4, 2: 7 };

/** Pad bit the strike is read from — CIRCLE (file 0xa700). */
export const STRIKE_BUTTON = 0x2000;

/** Packed sound played on the strike (file 0xa74c-0xa760). */
export const STRIKE_SOUND = 0x0004001b;

/** SYSTEM06 — the blip when the marker settles on a Cardmon band (file 0xa824). */
export const BITE_SOUND = 0x80045341;

/**
 * The float's four 16x16 cells in FIELDCOM sub-entry 0, ids 0x60..0x63.
 *
 * The original re-picks one EVERY tick (files 0xa958-0xa9c4): `rand() % 48`,
 * divided by 12, added to 0x60 — four equally likely frames. It is not an
 * animation with an order, it is a flicker, which is what makes the float look
 * like it is riding disturbed water.
 */
export const FLOAT_CELL_BASE = 0x60;
export const FLOAT_CELL_COUNT = 4;

/** The float cell for one tick. */
export function floatCell(rand: () => number): number {
  return FLOAT_CELL_BASE + Math.floor((Math.abs(rand()) % 48) / 12);
}

// The eight live patterns plus the spent-budget one, 12 bytes each: 48 two-bit
// bands, low band first within a byte. Band 0 = dead water, 1 = Cardmon,
// 2 = the area's water Digimon.
//
// The table at 0x80097b14 is past fieldstg.s's disassembled end, so these bytes
// were read out of the 2026-07-11 `fishing_active_s485` RAM capture: nine
// pointers 12 bytes apart at 0x80097aa8 with a null tenth, which is exactly
// 9 x 48 bands and exactly the meter's 0x3000/0x100 length.
//
// THEY ARE CONFIRMED BY THE ART. The nine 48x8 strips the game draws on the bar
// (FIELDCOM sub-entry 1, ids 0x3e..0x46) are one pixel per band, and every one
// of those 432 pixels agrees with the table: blue (136,144,248) wherever this
// says 0, yellow (240,240,112) wherever it says 1, green (88,200,0) wherever it
// says 2, with no exceptions and no fourth colour. Two independently shipped
// copies of the same data, so this is not a single unverified RAM read.
// tests/fishing.test.js re-checks that pixel-for-pixel.
const TRACKS: readonly number[] = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xaa, 0xaa, 0x95, 0xaa, 0x0a, 0x00, // 0
  0xaa, 0x15, 0x00, 0x95, 0xaa, 0x15, 0x00, 0x15, 0x00, 0x54, 0xaa, 0x56, // 1
  0xaa, 0x56, 0xaa, 0xaa, 0xaa, 0x02, 0x00, 0x00, 0x00, 0x00, 0xa8, 0xaa, // 2
  0x80, 0xaa, 0x2a, 0x00, 0xa8, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0x00, 0x54, // 3
  0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0x5a, 0xa9, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, // 4
  0xaa, 0x0a, 0x00, 0x00, 0x00, 0x00, 0xa8, 0xaa, 0xaa, 0xaa, 0xaa, 0x56, // 5
  0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0x2a, 0x00, 0xa8, 0xaa, // 6
  0x00, 0x00, 0x00, 0x00, 0x55, 0xa5, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, // 7
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 8
];

/** Bands in one pattern. */
export const TRACK_BANDS = 48;

/**
 * The band value under a meter position, 0-2.
 *
 * Indexing is deliberately FLAT, because the original's is: it computes the byte
 * as `meter >> 10` off the pattern's own pointer with no bound, so a meter parked
 * at the very top (band 48, one past the pattern) reads the NEXT pattern's first
 * band. Pattern 8 runs off the end of the table entirely; there the original
 * reads the pointer table's own first byte, whose low two bits are 0, so this
 * returns the same 0 by falling off the array.
 */
export function trackBandAt(pattern: number, meter: number): number {
  const band = Math.floor(meter / METER_BAND);
  const byte = TRACKS[pattern * 12 + (band >> 2)];
  if (byte == null) return 0;
  return (byte >> ((band & 3) * 2)) & 3;
}

/** A fishing spot: one op-7 step record. `dx/dy` place the float, spot-relative. */
export interface FishingSpot {
  stepIndex: number;
  dx: number;
  dy: number;
}

/** A stage's fishing data, as extracted into web/assets/data/fishing_spots.json. */
export interface FishingStage {
  gateFlag: number;
  spots: readonly FishingSpot[];
  /** Scripted-encounter-block slot -> the party a strike on that band fights. */
  catch: Readonly<Record<string, { screenId: number; param: number; music: string }>>;
}

/** Phase of one cast. `settle` has no meter yet; `over` is waiting on the host. */
export type FishingPhase = "settle" | "sweep" | "brake" | "hold" | "over";

export interface FishingState {
  phase: FishingPhase;
  /** Which of the nine patterns this cast rolled. 8 = the map's budget is spent. */
  pattern: number;
  /** Meter position, 0..METER_MAX. */
  meter: number;
  /** Meter units per tick. Constant until the strike, then braked to 0. */
  speed: number;
  /**
   * Meter units the brake takes off the speed each tick once you have struck.
   * The original keeps this implicit in WHICH sub-state the strike put the
   * machine into — sub 1 subtracts BRAKE_FAST, sub 2 subtracts BRAKE_SLOW.
   */
  brakeStep: number;
  /** false = sweeping up, true = sweeping back. */
  reversing: boolean;
  /** Counts the settle wait, then the post-stop hold. */
  timer: number;
  /** Band the marker stopped on; null until it has stopped. */
  band: number | null;
  /**
   * FIELDCOM sub-entry 0 cell for the float this tick, re-picked every tick.
   * Only meaningful once the float has settled — the original draws nothing at
   * all during the settle, because its draw block sits after the meter update
   * and the settle phase returns before reaching it.
   */
  cell: number;
}

/** What the host has to do this tick. The bobber itself changes nothing else. */
export type FishingCue =
  | { kind: "sound"; id: number }
  | { kind: "catch"; band: number; slot: number }
  | { kind: "nothing" };

/**
 * Begin a cast, spending one of the map's sixteen catches.
 *
 * Returns the new budget alongside the state — the budget is a per-map global the
 * host owns, and re-entering the map is what puts it back to FISHING_BUDGET.
 * `rand` supplies the original's raw 16-bit values; only the low 3 bits are used.
 */
export function startFishing(
  budget: number, rand: () => number,
): { state: FishingState; budget: number } {
  // `blez` on the budget: while it is positive, roll a pattern and spend one.
  // Otherwise force the empty pattern and leave the budget alone.
  const spent = budget > 0;
  return {
    state: {
      phase: "settle",
      pattern: spent ? rand() & 7 : EMPTY_PATTERN,
      meter: 0,
      speed: METER_SPEED,
      brakeStep: BRAKE_FAST,
      reversing: false,
      timer: 0,
      band: null,
      cell: FLOAT_CELL_BASE,
    },
    budget: spent ? budget - 1 : budget,
  };
}

/**
 * Advance one field tick.
 *
 * `strike` is the CIRCLE press — it only counts while the marker is still
 * sweeping at full speed, exactly as the original only reads the pad in that
 * sub-state. Mutates `s` and returns what the host should do.
 */
export function tickFishing(
  s: FishingState, strike: boolean, rand: () => number,
): FishingCue {
  if (s.phase === "over") return { kind: "nothing" };

  let cue: FishingCue = { kind: "nothing" };

  if (s.phase === "settle") {
    // The float sits still — no meter this whole phase, which is why the bar
    // does not appear until it has landed.
    s.timer += 1;
    if (s.timer >= CAST_SETTLE_TICKS) {
      s.phase = "sweep";
      s.timer = 0;
    }
    return cue;
  }

  if (s.phase === "sweep") {
    if (strike) {
      // The roll is on the STRIKE, not on where the marker is: three times in
      // four it brakes hard and stops close to where you pressed, one time in
      // four it coasts four times as far. So the same press can land on a
      // different band from one cast to the next.
      s.phase = "brake";
      s.brakeStep = (rand() & 3) !== 0 ? BRAKE_FAST : BRAKE_SLOW;
      cue = { kind: "sound", id: STRIKE_SOUND };
    }
  } else if (s.phase === "brake") {
    s.speed -= s.brakeStep;
    if (s.speed <= 0) {
      s.speed = 0;
      s.phase = "hold";
      s.timer = 0;
    }
  } else if (s.phase === "hold") {
    // The band is re-read every tick of the hold, but the marker is parked by
    // now so it never changes; the blip fires on the first of those ticks.
    s.band = trackBandAt(s.pattern, s.meter);
    if (s.timer === 0 && s.band === 1) cue = { kind: "sound", id: BITE_SOUND };
    if (s.timer >= RESOLVE_TICKS) {
      s.phase = "over";
      const slot = BAND_SLOT[s.band];
      return slot == null
        ? { kind: "nothing" }
        : { kind: "catch", band: s.band, slot };
    }
    s.timer += 1;
  }

  // Everything below is what the original reaches only after the settle: the
  // sweep, then the draw block. The float's cell is re-rolled here for the same
  // reason it is there — once per drawn tick.
  s.cell = floatCell(rand);

  // The sweep itself runs on every tick from `sweep` onward, braking included —
  // that is what makes the marker glide to a stop rather than snap.
  if (s.reversing) {
    s.meter -= s.speed;
    if (s.meter <= 0) {
      s.meter = 0;
      s.reversing = false;
    }
  } else {
    s.meter += s.speed;
    if (s.meter >= METER_MAX) {
      s.meter = METER_MAX;
      s.reversing = true;
    }
  }
  return cue;
}

/** The fishing spot the player is standing on, or null. */
export function fishingSpotAt(
  stage: FishingStage | null | undefined,
  cellValue: number | null,
): FishingSpot | null {
  if (!stage || cellValue == null) return null;
  // Low 5 bits are the step index; the top 3 are the approach-facing group the
  // OnStep trigger VM masks off. Same read as the ambush tiles.
  const idx = cellValue & 0x1f;
  return stage.spots.find((s) => s.stepIndex === idx) ?? null;
}

// ---------------------------------------------------------------------------
// The angler — what JUNIOR does while the cast runs (player mode 0x48).
//
// The bobber above is only half the mechanic. The other half is the player
// himself: casting puts him in leader mode 0x48 and swaps his sprite to a
// dedicated fishing pack, P002PLYF, which is the ONLY pack in the game that
// defines clips 0x11/0x12/0x13/0x14/0x15 — the exact five this mode plays. The
// rod, the line and the float's flight are drawn INTO those frames, which is
// why the separate bobber object is not on screen during the cast wind-up.
//
// DECODE. Original assembly ~/ddw3/asm/dw2003/pro/fieldstg.s, overlay base
// 0x80082cb0. The shared leader-mode dispatcher F0x8008fed0 (file 0xd220)
// indexes a 0x51-entry jump table at RAM 0x80083590 (file 0x8e0) with the
// entity's mode field +0x10; entry 0x48 is 0x8009092c (file 0xdc7c). That block
// re-dispatches on the entity's sub-state +0x14 through a SIX-entry table at
// RAM 0x800836d8 (file 0xa28) -> 0x8009095c, 0x80090978, 0x800909b8,
// 0x800909f8, 0x80090a34, 0x80090a98. Mode 0x48 is entered by the op-7 cast
// controller F0x8008f304 (file 0xc668: `li $a1, 0x48` into the entity's
// set-mode slot +0x2c), which also raises the scene lock at 0x800a9dd8.
//
// The blocks fall THROUGH into each other, so advancing runs the next block in
// the same tick — harmless, because SETANIM (F0x8008f4b4, file 0xc804) clears
// the animation-complete flag +0xe8 it is about to be tested on, and the
// advance stub F0x800142e0 (~/ddw3/asm/dw2003/exe/fns.s) zeroes the +0x18 timer
// as it bumps +0x14. Both are reproduced below.
//
// | sub | block  | does |
// | --- | ------ | ---- |
// | 0   | 0xdcac | SETANIM 0x11 (wind up and cast), advance |
// | 1   | 0xdcc8 | on anim end: PLAYER09, SETANIM 0x13, advance |
// | 2   | 0xdd08 | on anim end: PLAYER10, SETANIM 0x14, advance |
// | 3   | 0xdd48 | when the cast controller clears ([s5+8]==0): open the result balloon, SETANIM 0x12, advance |
// | 4   | 0xdd84 | hold 0x3c ticks, then close the balloon, SETANIM 0x15, advance |
// | 5   | 0xdde8 | on anim end: mode back to 1, SETANIM 1 (stand), drop the scene lock |

/** Wind up and cast. Eight frames; the float's flight is drawn into them. */
export const POSE_CAST_CLIP = 0x11;
/** The follow-through, entered when the cast animation ends. */
export const POSE_THROW_CLIP = 0x13;
/** The waiting pose. One frame, held for the whole bobber minigame. */
export const POSE_WAIT_CLIP = 0x14;
/** The reaction, latched the moment the cast resolves. One frame. */
export const POSE_RESULT_CLIP = 0x12;
/** Standing back up. Seven frames, the wind-up run backwards. */
export const POSE_RECOVER_CLIP = 0x15;
/** Ordinary standing clip, restored with leader mode 1 at the very end. */
export const POSE_IDLE_CLIP = 1;

/** PLAYER09 — fires on the cast animation's last frame (file 0xdcf0). */
export const POSE_CAST_SOUND = 0x80045cc5;
/** PLAYER10 — fires one clip later, on the follow-through's end (file 0xdd30). */
export const POSE_THROW_SOUND = 0x80045d46;

/** Ticks the result pose is held before Junior stands up (`slti $v1, 0x3c`, file 0xdda8). */
export const POSE_RESULT_TICKS = 0x3c;

/**
 * Sprite pack the player is drawn from for the whole of mode 0x48 — READ from
 * the clip-range rule (`playerPackForClip(0x11)`), not chosen here. The original
 * resolves the pack from the clip id in its per-frame clip resolver
 * (F0x8008F9C0, fieldstg.s:13153-13176); this constant only names what that rule
 * already answers, so a change to the table moves this too.
 */
export const POSE_SPRITE = playerPackForClip(POSE_CAST_CLIP);

// ── The end-of-cast result balloon ──────────────────────────────────────────
// The balloon Junior gets when the line comes back is NOT a fishing effect: it
// is the same actor class the story bubbles and the proximity indicators use,
// opened with the same factory `F0x80088144(0, 1, 6)` (file 0xdd54) and closed
// by sub-state 4 calling its `+0x28` with 2 (file 0xddc4). Its own tick
// (F0x80087F84, file 0x52d4) has no timer: it pops, holds in phase 2 forever
// until something closes it, then deflates and stops drawing at stage 3.
//
// What this model owns is only the lifetime the host has to supply — when it
// opened and when the close was commanded — because those two events are the
// pose machine's `openResult`/`closeResult` cues. The cel sequence itself lives
// with the drawing code (web/fieldcom.js `storyBubbleFrame`), because it is a
// property of the sprite, not of the fishing machine. One model of the actor,
// two owners of its two halves.

/**
 * Glyph row the result balloon shows: the actor's subtype `+0x8`, which indexes
 * `glyph_table[subtype*9 + cursor]` (RAM 0x800975c0, file 0x5130). The fishing
 * spawn passes subtype 1, so row 1 — ids 1 and 2. (`F0x80087DB0`, file 0x5100.)
 */
export const RESULT_BUBBLE_ROW = 1;

/**
 * Ticks the balloon holds its full face before the close command. Sub-state 4
 * adds the frame delta to its own `+0x18` and waits for `0x3c`
 * (`slti $v1, 0x3c`, file 0xdda8).
 */
export const RESULT_BUBBLE_HOLD_TICKS = POSE_RESULT_TICKS;

/** The result balloon's lifetime, in the actor's own terms. */
export interface FishingBubble {
  /** Field ticks since the balloon opened. */
  age: number;
  /** Tick count at which the close was commanded; null while it is still open. */
  closedAt: number | null;
}

/** The field runs at 50 Hz on PAL; the cel model is written in 60 Hz frames. */
const RENDERED_FRAMES_PER_FIELD_TICK = 60 / FIELD_TICK_RATE;

/** A balloon that has just been opened: the original's phase-0 cel `0x32`. */
export function startFishingBubble(): FishingBubble {
  return { age: 0, closedAt: null };
}

/** Advance the balloon by one field tick. */
export function tickFishingBubble(b: FishingBubble): void {
  b.age += 1;
}

/**
 * Tell the balloon to close, which is what the pose's `closeResult` cue does
 * (`+0x28` with 2). The balloon is not gone afterwards — it plays its close out
 * and only then stops drawing — so this records the tick instead of clearing.
 */
export function closeFishingBubble(b: FishingBubble): void {
  if (b.closedAt == null) b.closedAt = b.age;
}

/**
 * The balloon's age in rendered frames since the open, and since the close
 * command (null while it is still open) — the two numbers the cel model takes.
 *
 * The balloon counts the original's own field ticks (50 Hz on PAL,
 * `FIELD_TICK_RATE`); the cel model is written in rendered frames, the same
 * units the story-bubble clock hands it, so the conversion happens here rather
 * than in each caller.
 */
export function resultBubbleFrames(b: FishingBubble): {
  openFrames: number; closeFrames: number | null;
} {
  const frames = b.age * RENDERED_FRAMES_PER_FIELD_TICK;
  const closed = b.closedAt == null ? null : (b.age - b.closedAt) * RENDERED_FRAMES_PER_FIELD_TICK;
  return { openFrames: frames, closeFrames: closed };
}

export interface FishingPose {
  /** Sub-state +0x14, 0..5. 6 means the mode has handed control back. */
  sub: number;
  /** Clip currently latched by SETANIM. */
  clip: number;
  /** Timer +0x18, used by sub 4 only. Zeroed by every advance. */
  timer: number;
}

/** What the pose wants the host to do this tick. */
export interface FishingPoseCue {
  /** Packed sound to play, if any. */
  sound?: number;
  /** The result balloon opened this tick (F0x80088144(0, 1, 6), file 0xdd5c). */
  openResult?: boolean;
  /** The result balloon was told to close this tick (its +0x28 with 2, file 0xddc4). */
  closeResult?: boolean;
  /** Leader mode went back to 1 and the scene lock dropped. */
  finished?: boolean;
}

/** Enter mode 0x48. The clip is not latched until the first tick, as in sub 0. */
export function startFishingPose(): FishingPose {
  return { sub: 0, clip: POSE_IDLE_CLIP, timer: 0 };
}

/**
 * Advance the angler one field tick.
 *
 * `animDone` is the entity's +0xe8 — whether the currently latched clip has
 * played out. `castOver` is the cast controller's mode reaching 0, i.e. the
 * bobber has finished with the line. Both come from the host, because both live
 * outside this state machine in the original too.
 *
 * Returns everything that happened, because a single tick can run several
 * blocks: they fall through, and a fresh SETANIM clears `animDone` on the way.
 */
export function tickFishingPose(
  p: FishingPose, animDone: boolean, castOver: boolean,
): FishingPoseCue {
  const cue: FishingPoseCue = {};
  // Latching a clip clears +0xe8, so no later block in this tick can see the
  // completion that got us here.
  let done = animDone;
  const setAnim = (clip: number) => { p.clip = clip; done = false; };
  // The advance stub bumps the sub-state AND zeroes the timer.
  const advance = () => { p.sub += 1; p.timer = 0; };

  for (;;) {
    if (p.sub === 0) {
      setAnim(POSE_CAST_CLIP);
      advance();
    } else if (p.sub === 1) {
      if (!done) return cue;
      cue.sound = POSE_CAST_SOUND;
      setAnim(POSE_THROW_CLIP);
      advance();
    } else if (p.sub === 2) {
      if (!done) return cue;
      cue.sound = POSE_THROW_SOUND;
      setAnim(POSE_WAIT_CLIP);
      advance();
    } else if (p.sub === 3) {
      if (!castOver) return cue;
      cue.openResult = true;
      setAnim(POSE_RESULT_CLIP);
      advance();
    } else if (p.sub === 4) {
      p.timer += 1;
      if (p.timer < POSE_RESULT_TICKS) return cue;
      cue.closeResult = true;
      setAnim(POSE_RECOVER_CLIP);
      advance();
    } else if (p.sub === 5) {
      if (!done) return cue;
      setAnim(POSE_IDLE_CLIP);
      advance();
      cue.finished = true;
      return cue;
    } else {
      return cue;
    }
  }
}
