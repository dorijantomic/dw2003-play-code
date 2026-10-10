// Digi-Egg dive TRANSITION DEMO — the full-screen presentation the game plays
// when Junior drops into a hole (Digmon) or enters water (Submarimon).
//
// This is the presentation layer only. The form swap itself — which character
// the cast is rebuilt with, and how each form moves afterwards — is
// engine/systems/dive-form.ts and is unrelated to this file.
//
// DECODE: docs/research/field/dive-demo-transition-decoded-2026-07-29.md
// (fieldstg.s, PAL SLES-03936, overlay base 0x80082cb0). Runtime anchors:
// ledger EV-seabed9entry, a frame-by-frame capture of a real Seabed entry.
//
// Two objects run at once and they are NOT the same thing:
//
//   1. The PARTICLE object (callback F0x80085bd4), spawned at the player's own
//      position on the frame the DIGIMENT cue fires, while the field is still
//      fully visible. Four independent channels of FIELDCOM directory-1 cells,
//      each with its own hidden lead-in. It keeps drawing straight through the
//      blackout and OVER the demo that follows.
//
//   2. The DEMO object (callback F0x80085590), created only after the field has
//      faded out and the cast has been torn down. It loads SSUBDEMO or SDIGDEMO
//      and plays a full-screen 640x240 animation from the tables below.
//
// The whole thing then hands off to the ordinary stage-change wipe.

/** Which entrance this is. `water` = Submarimon, `hole` = Digmon. */
export type DiveMode = "water" | "hole";

/** One {cell, frames} step of a demo timeline. */
export interface DemoStep { cell: number; frames: number }

// ── the demo timelines ─────────────────────────────────────────────────────
//
// Record format (proved in the decode, § 6.1): one u32 per step, low s16 =
// cell id, high s16 = duration in frames. Index 0 is never played — the cursor
// is PRE-incremented, so the machine starts at index 1. A cell of -1 is the
// terminator, and it means different things in the two code paths: END in the
// water block, LOOP in the hole block (its duration field carries the cursor to
// jump back to).

/**
 * WATER, `0x80096cc8`. Two identical slow cycles over cells 0-3 (the pulse the
 * capture sees at f120-216), one fast cycle over 0-2, then a six-cell finish.
 * Reaching the terminator ends the demo, so this table's own length — 158
 * frames — is the water demo's length.
 */
export const WATER_TIMELINE: readonly DemoStep[] = [
  { cell: 0, frames: 13 }, { cell: 1, frames: 14 }, { cell: 2, frames: 15 }, { cell: 3, frames: 14 },
  { cell: 0, frames: 13 }, { cell: 1, frames: 14 }, { cell: 2, frames: 15 }, { cell: 3, frames: 14 },
  { cell: 0, frames: 6 }, { cell: 1, frames: 6 }, { cell: 2, frames: 6 },
  { cell: 4, frames: 7 }, { cell: 5, frames: 5 }, { cell: 6, frames: 4 },
  { cell: 7, frames: 4 }, { cell: 8, frames: 4 }, { cell: 9, frames: 4 },
];

export const WATER_TIMELINE_FRAMES = WATER_TIMELINE.reduce((s, r) => s + r.frames, 0); // 158

/**
 * HOLE layer A, `0x80096d14` — Digmon sinking into the hole. 44 frames of
 * intro, then an 8-frame loop alternating cells 4 and 3 forever.
 */
export const HOLE_LAYER_A: readonly DemoStep[] = [
  { cell: 1, frames: 8 }, { cell: 2, frames: 6 }, { cell: 3, frames: 4 }, { cell: 4, frames: 4 },
  { cell: 3, frames: 4 }, { cell: 4, frames: 4 }, { cell: 3, frames: 6 }, { cell: 4, frames: 4 },
  { cell: 3, frames: 4 },
];
/** Terminator `0x0007ffff`: rewind the cursor to 7, so play resumes at index 8. */
export const HOLE_LAYER_A_LOOP_TO = 7;

/**
 * HOLE layer B, `0x80096d40` — the dirt clods thrown out of the hole. 47 frames
 * of intro, then a 12-frame loop over cells 6,7,8 forever.
 */
export const HOLE_LAYER_B: readonly DemoStep[] = [
  { cell: 9, frames: 18 }, { cell: 5, frames: 4 }, { cell: 6, frames: 5 }, { cell: 7, frames: 4 },
  { cell: 8, frames: 4 }, { cell: 6, frames: 4 }, { cell: 7, frames: 4 }, { cell: 8, frames: 4 },
];
/** Terminator `0x0005ffff`: rewind to 5, so play resumes at index 6. */
export const HOLE_LAYER_B_LOOP_TO = 5;

/**
 * Both hole layers loop forever, so the hole demo cannot end by running out of
 * table. It ends on an elapsed-frame cap instead (`+0x18 >= 0xa1`).
 */
export const HOLE_DEMO_FRAMES = 161;

/**
 * The static backdrop cell, drawn every frame of the demo underneath the
 * animated cells: SSUBDEMO cell 0xa is the oval pool with its stone slab,
 * SDIGDEMO cell 0 is the sandy ground with the hole in it.
 *
 * DRAW ORDER: the native code issues the animated cell FIRST and this backdrop
 * LAST, but those calls push into a priority-ordered display list rather than
 * painting immediately, and the runtime capture is unambiguous that the diving
 * Digimon is visible ON TOP of the pool at f108. We therefore paint the
 * backdrop first. The display-list slot semantics are undecoded (DIVE-Q005), so
 * this ordering rests on the capture, not on the draw sequence.
 */
export const BACKDROP_CELL: Record<DiveMode, number> = { water: 0xa, hole: 0 };

/** Which extracted pack a mode draws from. */
export const DEMO_PACK: Record<DiveMode, string> = { water: "ssubdemo", hole: "sdigdemo" };

// ── the particle channels ──────────────────────────────────────────────────
//
// Four channels of FIELDCOM directory-1 cells (`0x80096e84`, § 6.4). Each
// channel opens with a HIDDEN lead-in — encoded natively as cell 0x12c, which
// is not a real sprite id — so the four passes stagger themselves without any
// scheduler. Channel 0 and channel 3 are shared by both forms; channels 1 and 2
// carry the per-form cells (blue water tokens vs the dig plume).
//
// These cell ranges line up exactly with the FIELDCOM directory-1 artwork:
// 0x00-0x1f is the glow that swells from a pinprick into a ball and then
// scatters into twinkles, 0x20-0x22 / 0x23-0x25 are the small per-form tokens,
// 0x26-0x2b / 0x2c-0x31 the white flare shapes, and 0x32-0x3b the drifting
// star-fields. Every one of them is flagged for additive blending in FIELDCOM,
// which is why this effect needs the per-texel STP split in web/fieldcom.js —
// drawn opaquely they would be flat blobs instead of light.

export interface ParticleChannel {
  /** Frames to stay invisible before the first cell appears. */
  hidden: number;
  /** {cell, frames} steps, played once. */
  steps: readonly DemoStep[];
}

const seq = (first: number, count: number, frames: number): DemoStep[] =>
  Array.from({ length: count }, (_, i) => ({ cell: first + i, frames }));

/** Channel 0, both forms: 32 cells at 4 frames each, starting immediately. */
export const CHANNEL_0: ParticleChannel = { hidden: 0, steps: seq(0x00, 32, 4) };

export const CHANNELS: Record<DiveMode, readonly ParticleChannel[]> = {
  water: [
    CHANNEL_0,
    { hidden: 28, steps: [{ cell: 0x20, frames: 4 }, { cell: 0x21, frames: 24 }, { cell: 0x22, frames: 4 }] },
    { hidden: 104, steps: seq(0x26, 6, 4) },
    { hidden: 128, steps: seq(0x32, 10, 4) },
  ],
  hole: [
    CHANNEL_0,
    { hidden: 28, steps: [{ cell: 0x23, frames: 4 }, { cell: 0x24, frames: 24 }, { cell: 0x25, frames: 4 }] },
    { hidden: 104, steps: seq(0x2c, 6, 4) },
    { hidden: 128, steps: seq(0x32, 10, 4) },
  ],
};

/** The longest channel (channel 3: hidden 128 + 40) sets the particle lifetime. */
export const PARTICLE_FRAMES = 168;

// ── the sequence ───────────────────────────────────────────────────────────
//
// Frame 0 is the frame the DIGIMENT cue fires. Everything below is measured
// from there, and every boundary is anchored to EV-seabed9entry (whose frame
// numbers are 10 higher, since the cue landed on its frame 10).

/** Field still visible, particles playing over it, before the fade begins. */
export const FADE_OUT_AT = 60;
/** Fade to black takes 20 frames; at 80 the cast is destroyed. */
export const FADE_OUT_FRAMES = 20;
export const DEMO_START = FADE_OUT_AT + FADE_OUT_FRAMES; // 80

/**
 * The demo's phase 0 is a CD load, so its length is hardware latency, not a
 * constant in the code. The capture puts the first SSUBDEMO frame on screen at
 * its f108 = dive frame 98, giving 18 frames. We reproduce that observed
 * latency rather than starting the demo instantly, because the black gap it
 * creates is part of what the transition looks like.
 */
export const DEMO_LOAD_FRAMES = 18;

/** The fade back IN runs on top of the demo's opening frames. */
export const FADE_IN_FRAMES = 20;

/**
 * The frame the demo's OWN sound cue fires — `DIG_DEMO` (packed 0x00040003) for
 * the hole, `SUB_DEMO` (0x00040018) for water. The native code plays it the
 * moment the demo archive finishes loading, immediately before the first
 * animated frame is drawn.
 *
 * This is NOT the Digi-Egg cue. `DIGIMENT` (0x00040004) fires ~80 frames
 * earlier, when the dive is triggered and the field is still visible; these two
 * are the demo's own, and they are what you hear as Digmon starts drilling in.
 *
 * Ledger note: EV-seabed9entry reports no packed sound after DIGIMENT through
 * f360, which contradicts this unconditional call (DIVE-Q001). That capture's
 * own limitations note records the rig going unresponsive, and the negative is
 * treated as suspect rather than as proof — the assembly is authority 2 and
 * unambiguous. See docs/research/audio/sfx-triggers.json rows DIG_DEMO/SUB_DEMO.
 *
 * The sound NAMES stay browser-side, as literal `sfx.play("...")` call sites —
 * that is what tests/sfx-manifest.test.js checks a decoded trigger against.
 */

/** The frame `DEMO_CUE_SOUND` fires on: the demo's first drawn frame. */
export const DEMO_CUE_FRAME = DEMO_START + DEMO_LOAD_FRAMES;

export const demoFrames = (mode: DiveMode): number =>
  mode === "water" ? WATER_TIMELINE_FRAMES : HOLE_DEMO_FRAMES;

/** Total frames this presentation owns, before the ordinary stage wipe. */
export const diveDemoTotalFrames = (mode: DiveMode): number =>
  DEMO_START + DEMO_LOAD_FRAMES + demoFrames(mode);

// ── playback ───────────────────────────────────────────────────────────────

/**
 * The cell a once-through step list shows at `frame`, or null once it has run
 * out. Shared by the water timeline and by every particle channel.
 */
export function stepCellAt(steps: readonly DemoStep[], frame: number): number | null {
  if (frame < 0) return null;
  let t = frame;
  for (const s of steps) {
    if (t < s.frames) return s.cell;
    t -= s.frames;
  }
  return null;
}

/**
 * The cell a LOOPING hole layer shows at `frame`.
 *
 * The layer plays its whole table once, and only then does the terminator
 * rewind the cursor to `loopTo` — so the repeated span is the TAIL of the
 * table, not a prefix of it, and the intro is the table's full length.
 *
 * `loopTo` is the native cursor value, which counts the never-played index 0
 * these arrays drop. Rewinding to native `loopTo` means the next cell played is
 * native `loopTo + 1`, i.e. array index `loopTo`.
 */
export function loopCellAt(steps: readonly DemoStep[], loopTo: number, frame: number): number {
  const introFrames = steps.reduce((s, r) => s + r.frames, 0);
  if (frame < introFrames) return stepCellAt(steps, frame)!;
  const tail = steps.slice(loopTo);
  const tailFrames = tail.reduce((s, r) => s + r.frames, 0);
  return stepCellAt(tail, (frame - introFrames) % tailFrames)!;
}

/** One particle channel's cell at `frame`, or null while hidden or finished. */
export function channelCellAt(chan: ParticleChannel, frame: number): number | null {
  if (frame < chan.hidden) return null;
  return stepCellAt(chan.steps, frame - chan.hidden);
}

/** What the renderer should draw this frame. */
export interface DiveDemoFrame {
  /** 0..1 black overlay: 0 = field visible, 1 = fully black. */
  blackout: number;
  /** True once the field cast is gone and the demo owns the screen. */
  demoActive: boolean;
  /** Demo cells to paint, back to front, or null before the demo starts. */
  demoCells: number[] | null;
  /** FIELDCOM directory-1 cells for the particle burst, drawn at the player. */
  particleCells: number[];
  /** True on the frame the whole presentation is over and the stage may change. */
  done: boolean;
}

/**
 * Advance the whole presentation to `frame` (0 = the DIGIMENT cue).
 *
 * The particle burst runs on its own clock from frame 0 and is deliberately NOT
 * gated on the demo: it is still drawing over the blackout, and over the demo
 * afterwards, exactly as the capture shows.
 */
export function diveDemoFrame(mode: DiveMode, frame: number): DiveDemoFrame {
  const fadeT = (frame - FADE_OUT_AT) / FADE_OUT_FRAMES;
  const demoFrame = frame - DEMO_START - DEMO_LOAD_FRAMES;
  const demoLen = demoFrames(mode);
  const demoActive = demoFrame >= 0 && demoFrame < demoLen;

  // Black is full from the moment the cast dies until the demo has faded in.
  let blackout = 0;
  if (frame >= FADE_OUT_AT) blackout = Math.min(1, Math.max(0, fadeT));
  if (demoActive) blackout = Math.max(0, 1 - demoFrame / FADE_IN_FRAMES);

  let demoCells: number[] | null = null;
  if (demoActive) {
    // Backdrop first — see BACKDROP_CELL on why this contradicts the raw call
    // order and follows the capture instead.
    demoCells = [BACKDROP_CELL[mode]];
    if (mode === "water") {
      const c = stepCellAt(WATER_TIMELINE, demoFrame);
      if (c != null) demoCells.push(c);
    } else {
      demoCells.push(loopCellAt(HOLE_LAYER_A, HOLE_LAYER_A_LOOP_TO, demoFrame));
      demoCells.push(loopCellAt(HOLE_LAYER_B, HOLE_LAYER_B_LOOP_TO, demoFrame));
    }
  }

  const particleCells: number[] = [];
  for (const chan of CHANNELS[mode]) {
    const c = channelCellAt(chan, frame);
    if (c != null) particleCells.push(c);
  }

  return {
    blackout,
    demoActive,
    demoCells,
    particleCells,
    done: frame >= diveDemoTotalFrames(mode),
  };
}
