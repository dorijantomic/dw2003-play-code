// engine/systems/blast-presentation.ts — the Blast digivolution transformation.
//
// Sequence 0x61 on the shared presentation manager (BLAST-C006: the same manager
// runs Tag 0x38, Blast-revert 0x62 and manual DV 0x37). This module owns only the
// TIMELINE; web/blast-presentation.js draws it and web/battle3d.js supplies the
// camera, the model swap and the void background.
//
// GROUND TRUTH — authority 1, runtime capture, `BLAST-C010`:
//   docs/research/battle/captures/blast-presentation-2026-07-14/README.md
//   Windows Redux rig build 314, Renamon (form 0x175) -> blast form 0x10b,
//   shots every 8 frames from f24 to f880, press at f20. A second independent
//   run (2026-07-14b, 44 shots every 20f) reproduced every phase boundary.
//
// The PHASE BOUNDARIES below are those captured frames and nothing else. What is
// NOT decoded is the interpolation *shape* inside each phase — the capture is a
// contact sheet every 8 frames, so it fixes when each element appears and
// disappears, never its easing curve. Every curve here is therefore a marked
// WALKER VISUAL: linear or smoothstep, chosen to hit the captured endpoints. Do
// not present any curve shape as decoded.
//
// The three one-to-eight-frame gaps between captured phases (310->312, 648->656,
// 792->800) are sampling artifacts of the 8-frame shot interval, not pauses in
// the animation. Phases are treated as contiguous.

import { createTransformationSchedule } from "../dw3/battle-effect-driver-host.ts";

/** Frame the presentation becomes visible (X-press at f20 clears the message). */
export const BLAST_FIRST_FRAME = 24;
/** Last captured frame; the camera is back at the battle view. */
export const BLAST_LAST_FRAME = 880;
/** Total run length, ~14 s at 60 Hz. The claim rounds this to "~860 frames". */
export const BLAST_TOTAL_FRAMES = BLAST_LAST_FRAME - BLAST_FIRST_FRAME;

/**
 * The frame the original model hides and the new form takes over ("the model-
 * hide / swap point", captured at f312 with the whiteout).
 */
export const BLAST_SWAP_FRAME = 312;

/**
 * The frame the full heal lands. The capture: "The full heal (2589->3000) lands
 * during the solid-model resolve (~f600)". BLAST-C007 independently establishes
 * the heal is unconditional; this fixes only WHEN it becomes visible.
 */
export const BLAST_HEAL_FRAME = 600;

export const BlastPhase = {
  PUSH_IN: "push_in",
  VORTEX: "vortex",
  IGNITE: "ignite",
  WIREFRAME: "wireframe",
  DATA_BURST: "data_burst",
  RESOLVE: "resolve",
  REVEAL: "reveal",
  WIND_DOWN: "wind_down",
} as const;

export type BlastPhaseValue = typeof BlastPhase[keyof typeof BlastPhase];

/** The captured phase table, verbatim from the contact sheets. */
export const BLAST_PHASES: ReadonlyArray<{
  id: BlastPhaseValue; from: number; to: number; caption: string;
}> = Object.freeze([
  { id: BlastPhase.PUSH_IN, from: 24, to: 180,
    caption: "message clears; the Digimon idles; the camera pushes in on the battle backdrop" },
  { id: BlastPhase.VORTEX, from: 180, to: 312,
    caption: "background goes black; a golden EVOLUTION ribbon vortex spins up around the original model" },
  { id: BlastPhase.IGNITE, from: 312, to: 360,
    caption: "the original model whites out and flames ignite from below (model hide / swap point)" },
  { id: BlastPhase.WIREFRAME, from: 360, to: 430,
    caption: "a green wireframe of the new form materializes standing in the fire" },
  { id: BlastPhase.DATA_BURST, from: 430, to: 560,
    caption: "data-burst hexagram, yellow circuit-pattern fill and a white flash" },
  { id: BlastPhase.RESOLVE, from: 560, to: 656,
    caption: "the flash peaks and the wireframe resolves into the solid new form; the heal lands" },
  { id: BlastPhase.REVEAL, from: 656, to: 800,
    caption: "the new form is fully revealed, then a second fire burst erupts around it" },
  { id: BlastPhase.WIND_DOWN, from: 800, to: 880,
    caption: "flames subside, the ribbons wind down and the camera returns to the battle view" },
]);

/** Clamp helper. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Normalised progress across [from,to), clamped outside. */
function span(frame: number, from: number, to: number): number {
  if (to <= from) return frame >= to ? 1 : 0;
  return clamp01((frame - from) / (to - from));
}

/** WALKER VISUAL easing. The capture fixes endpoints, never the curve. */
function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

export function blastPhaseAt(frame: number): BlastPhaseValue {
  if (frame < BLAST_FIRST_FRAME) return BlastPhase.PUSH_IN;
  for (const p of BLAST_PHASES) if (frame < p.to) return p.id;
  return BlastPhase.WIND_DOWN;
}

export interface BlastPresentationState {
  frame: number;
  phase: BlastPhaseValue;
  /** Progress within the current phase, 0..1. */
  phaseProgress: number;
  /** Whole-presentation progress, 0..1. */
  progress: number;
  done: boolean;

  /** Camera dolly toward the fighter, 0 = battle view, 1 = fully pushed in. */
  cameraPush: number;
  /** Backdrop fade to the black void, 0..1. */
  voidAlpha: number;
  /** EVOLUTION ribbon vortex opacity and accumulated spin in turns. */
  ribbonAlpha: number;
  ribbonTurns: number;
  /** Original model: visible until the swap, whiting out as it goes. */
  showOldModel: boolean;
  oldModelWhiteout: number;
  /** Fire wall rising from the bottom of the screen, 0..1. */
  fireIntensity: number;
  /** Green wireframe of the new form, 0..1. */
  wireframeAlpha: number;
  /** Data-burst hexagram: two overlapping triangles inside a ring. */
  hexagramAlpha: number;
  hexagramScale: number;
  /** Yellow circuit-pattern fill sweeping the hexagram, 0..1. */
  circuitFill: number;
  /** Full-screen white flash, 0..1. */
  flashAlpha: number;
  /** Solid textured new model, 0..1. */
  solidAlpha: number;
  showNewModel: boolean;
  /** True once the unconditional full heal has landed (BLAST-C007 / f600). */
  healed: boolean;
}

/**
 * The whole presentation as a pure function of its frame. Every boundary is a
 * captured frame; every curve between boundaries is a WALKER VISUAL.
 */
export function blastPresentationState(frame: number): BlastPresentationState {
  const f = Math.max(0, frame);
  const phase = blastPhaseAt(f);
  const cur = BLAST_PHASES.find((p) => p.id === phase)!;

  // Phase 1: the camera dollies in across the whole 24..180 window.
  const cameraPush = f < 800
    ? smooth(span(f, 24, 180))
    // Phase 8 returns it. The capture shows the model shrinking again by f872.
    : 1 - smooth(span(f, 800, 880));

  // Phase 2 opens by replacing the arena with black.
  const voidAlpha = smooth(span(f, 180, 240));

  // Ribbons spin up at 180 and are still turning at 872; they wind down last.
  const ribbonAlpha = smooth(span(f, 180, 232)) * (1 - smooth(span(f, 824, 880)));
  // 12 turns over the ~700 frames they are up. WALKER VISUAL: the contact sheet
  // cannot resolve revolution count between 8-frame samples.
  const ribbonTurns = ribbonAlpha > 0 ? (f - 180) / 58 : 0;

  // The original model whites out over 312..360 and is gone at the swap point.
  const oldModelWhiteout = smooth(span(f, 300, 344));
  const showOldModel = f < BLAST_SWAP_FRAME + 48;

  // Fire burns TWICE, and the gap between the two is the point. The contact
  // sheets show flames from f312 to about f520, then nothing behind the flash
  // and the hexagram (f584-f648 are black with the wireframe resolving), then a
  // far bigger SECOND burst with a white core from about f696 to f792, subsiding
  // through the wind-down. An earlier draft of this module held the first fire
  // at full for the whole run; that made the "second fire burst" invisible,
  // which the capture flatly contradicts.
  const fireFirst = smooth(span(f, 312, 360)) * (1 - smooth(span(f, 520, 572)));
  const fireSecond = smooth(span(f, 656, 704)) * (1 - smooth(span(f, 792, 872)));
  const fireIntensity = clamp01(Math.max(fireFirst, fireSecond));

  // Green wireframe materializes 360..430, holds through the data burst, and
  // dissolves as the solid model takes over across the resolve.
  const wireframeAlpha = smooth(span(f, 360, 430)) * (1 - smooth(span(f, 600, 672)));

  // Hexagram grows in at 430 and is gone once the model is solid.
  const hexagramAlpha = smooth(span(f, 430, 468)) * (1 - smooth(span(f, 608, 656)));
  const hexagramScale = 0.35 + 0.65 * smooth(span(f, 430, 500));
  const circuitFill = smooth(span(f, 468, 560));

  // The white flash is a PLATEAU, not a spike: the capture is at or near full
  // white across f552, f560, f568 and f576 — four consecutive 8-frame shots —
  // so it rises into f552, holds to f576, and clears by f616.
  const flashAlpha = smooth(span(f, 520, 552)) * (1 - smooth(span(f, 576, 616)));

  // The solid model resolves in over the back half of the resolve phase.
  const solidAlpha = smooth(span(f, 592, 664));
  const showNewModel = f >= BLAST_SWAP_FRAME;

  return {
    frame: f,
    phase,
    phaseProgress: span(f, cur.from, cur.to),
    progress: clamp01((f - BLAST_FIRST_FRAME) / BLAST_TOTAL_FRAMES),
    done: f >= BLAST_LAST_FRAME,
    cameraPush,
    voidAlpha,
    ribbonAlpha,
    ribbonTurns,
    showOldModel,
    oldModelWhiteout,
    fireIntensity,
    wireframeAlpha,
    hexagramAlpha,
    hexagramScale,
    circuitFill,
    flashAlpha,
    solidAlpha,
    showNewModel,
    healed: f >= BLAST_HEAL_FRAME,
  };
}

/** Seconds of wall clock for the whole presentation at the 60 Hz reference. */
export const BLAST_PRESENTATION_SECONDS = BLAST_LAST_FRAME / 60;

// ───────────────────────────────────────────────────────────────────────────────
// The other two sequences on the same shared manager
// ───────────────────────────────────────────────────────────────────────────────
//
// BLAST-C006 establishes that Blast-on, Blast-revert, Tag and manual DV all run
// through ONE presentation manager (FIGHTSTG_F0x8009a298 / F0x80099588, director
// objects pkg 0x1005 res 0xc2 and 0xd0) with different sequence programs:
//
//   Blast on      selector 2   sequence 0x61
//   Blast revert  selector 2   sequence 0x62   (its own de-digivolution program)
//   Tag commit    selector 2   sequence 0x38
//   manual DV     selector 0xc sequence 0x37, then a PER-DIGIMON sequence
//                              [objB+0x120](objB, getObj(0x4e), profile[+0x55], 1)
//
// **The visual content of 0x62 and 0x37 is NOT DECODED.** The canonical document
// says so in as many words: "Exact effect visuals, sound ids, camera, and
// model-hide frames live inside the pkg 0x1005 res 0xc2/0xd0 actor scripts
// (undecoded) — runtime capture required for those." There is no contact sheet
// for either, unlike 0x61.
//
// So what is implemented here splits cleanly in two, and the split must be kept
// visible:
//
//   DECODED (runtime capture, authority 1, blast_run4.txt / dv_manual.txt):
//     the DURATIONS, the ORDER of commit versus presentation, which sound fires
//     when, whether the gauge is zeroed, and whether a heal lands.
//   WALKER VISUAL (invented):
//     the choreography inside each window. It reuses the effect vocabulary the
//     decoded 0x61 sheet establishes — ribbons, fire, wireframe, hexagram,
//     flash — because these sequences drive the SAME two director objects, but
//     no capture says how 0x62 or 0x37 arrange them. Do not promote any of it.
//
// Calibration. In blast_run4.txt the Blast-ON sequence message is logged at
// f1932 and the battle BGM returns at f2724 — 792 frames — which agrees with the
// separately captured f24..f880 contact sheet for the same sequence. The same
// two markers therefore date the other two programs.

export const FormChangeProgram = {
  /** Blast on, sequence 0x61 — the fully captured one. */
  BLAST_ON: "blast_on",
  /** Blast revert, sequence 0x62. */
  BLAST_REVERT: "blast_revert",
  /** Manual DV, sequence 0x37 plus the per-Digimon sequence on object 0x4e. */
  MANUAL_DV: "manual_dv",
} as const;

export type FormChangeProgramValue =
  typeof FormChangeProgram[keyof typeof FormChangeProgram];

// ── Blast revert (sequence 0x62) ───────────────────────────────────────────────
// blast_run4.txt, natural revert:
//   f5938  EV13 state=0, CLEANUP (blast flag 01->00, gauge 1000->0)
//   f5939  STATE form 0x177 -> 0x175          <- the model is ALREADY restored
//   f5941  EV13 state=1                       <- presentation begins
//   f5991  SOUND a0045ec9 = PLAYER11          <- +50
//   f6205  PRESMSG sel=02 payload 0x62        <- +264
//   f6267  PRESMSG sel=02 payload 0x08        <- +326, normal messaging resumes
/** Length of the revert window, f5941..f6267. */
export const REVERT_LAST_FRAME = 326;
/** PLAYER11 fires here, 50 frames in. */
export const REVERT_SOUND_FRAME = 50;
/**
 * The 0x62 sequence message is logged here. NOTE the ambiguity, which the
 * capture cannot settle: for Blast-on the sequence message precedes its sound by
 * 88 frames, but here PLAYER11 precedes the message by 214. Either the hook logs
 * this selector at a different point in the manager's state machine, or the
 * revert's audio leads its visual. This module treats the window as one
 * continuous effect rather than pretending to know which.
 */
export const REVERT_SEQUENCE_MSG_FRAME = 264;
/** The revert restores the form BEFORE the presentation, and never heals. */
export const REVERT_SWAP_FRAME = 0;

// ── Manual DV (sequence 0x37 + per-Digimon) ────────────────────────────────────
// dv_manual.txt, DV to Kyubimon:
//   f6002  EVSUBMIT code=02 sched=727          <- next turn queued as a NORMAL turn
//   f6005  CLEANUP; MLOAD form=0176 a1=0       <- commit; note a1=0, not Blast's 1
//   f6039  SOUND 41140000 = EVOLUTIO           <- +34
//   f6744  SOUND 60080000 = BATL0000           <- +739, battle BGM returns
//   f6801  PRESMSG sel=0c payload {0, 0x0f}    <- 0x0f = Kyubimon's profile row
/** Length of the manual-DV window, commit to BGM return. */
export const MANUAL_DV_LAST_FRAME = 739;
/** EVOLUTIO fires here, 34 frames in. */
export const MANUAL_DV_SOUND_FRAME = 34;
/** Manual DV loads its model at commit (a1=0), so the swap is frame 0. */
export const MANUAL_DV_SWAP_FRAME = 0;

/** Total frames for one program. */
export function formChangeLength(program: FormChangeProgramValue): number {
  if (program === FormChangeProgram.BLAST_REVERT) return REVERT_LAST_FRAME;
  if (program === FormChangeProgram.MANUAL_DV) return MANUAL_DV_LAST_FRAME;
  return BLAST_LAST_FRAME;
}

/** The frame each program's jingle fires, or null when it has none. */
export function formChangeSoundFrame(program: FormChangeProgramValue): number | null {
  if (program === FormChangeProgram.BLAST_REVERT) return REVERT_SOUND_FRAME;
  if (program === FormChangeProgram.MANUAL_DV) return MANUAL_DV_SOUND_FRAME;
  return 0;   // Blast-on's EVOLUTIO is played at trigger by the caller.
}

/**
 * The revert, sequence 0x62. Captured: 326 frames, PLAYER11 at f50, the form
 * already restored before frame 0, no heal, gauge already zeroed. Everything
 * else below is WALKER VISUAL — a de-digivolution read backwards through the
 * same effect vocabulary: the blast form breaks down into the green wireframe,
 * the wireframe collapses through a brief flash, and the original form settles
 * out of it as the ribbons fall away.
 */
function revertState(f: number): BlastPresentationState {
  const T = REVERT_LAST_FRAME;
  return {
    frame: f,
    phase: f < 160 ? BlastPhase.WIREFRAME
      : f < 230 ? BlastPhase.DATA_BURST
        : f < 264 ? BlastPhase.RESOLVE : BlastPhase.WIND_DOWN,
    phaseProgress: span(f, 0, T),
    progress: clamp01(f / T),
    done: f >= T,
    // A much smaller push than Blast-on: this is a short beat, not a set piece.
    cameraPush: smooth(span(f, 0, 60)) * (1 - smooth(span(f, 250, T))),
    voidAlpha: smooth(span(f, 20, 70)) * (1 - smooth(span(f, 270, T))),
    ribbonAlpha: smooth(span(f, 30, 80)) * (1 - smooth(span(f, 240, 310))),
    ribbonTurns: f > 30 ? (f - 30) / 42 : 0,
    // The outgoing (blast) form is gone from the start — the capture restores it
    // one frame before the presentation opens.
    showOldModel: false,
    oldModelWhiteout: 0,
    fireIntensity: 0,                       // no flames in a de-digivolution
    wireframeAlpha: smooth(span(f, 40, 110)) * (1 - smooth(span(f, 190, 250))),
    hexagramAlpha: 0,                       // no data-burst on the way down
    hexagramScale: 1,
    circuitFill: 0,
    flashAlpha: smooth(span(f, 170, 205)) * (1 - smooth(span(f, 215, 255))),
    solidAlpha: smooth(span(f, 215, 268)),
    showNewModel: true,                     // the restored form IS the model
    healed: false,                          // captured: no heal at revert
  };
}

/**
 * Manual DV, sequence 0x37 plus the per-Digimon sequence keyed by the target's
 * profile row. Captured: 739 frames, EVOLUTIO at f34, the model loaded at commit
 * (a1=0), the next turn queued as an ordinary turn, no heal, and — unlike the
 * revert — the DV gauge is NOT zeroed. Everything else is WALKER VISUAL: it is
 * the Blast vocabulary compressed into the shorter captured window, with no
 * second fire burst, since nothing establishes one here.
 */
function manualDvState(f: number): BlastPresentationState {
  const T = MANUAL_DV_LAST_FRAME;
  return {
    frame: f,
    phase: f < 150 ? BlastPhase.PUSH_IN
      : f < 260 ? BlastPhase.VORTEX
        : f < 330 ? BlastPhase.IGNITE
          : f < 430 ? BlastPhase.WIREFRAME
            : f < 560 ? BlastPhase.DATA_BURST
              : f < 660 ? BlastPhase.RESOLVE : BlastPhase.WIND_DOWN,
    phaseProgress: span(f, 0, T),
    progress: clamp01(f / T),
    done: f >= T,
    cameraPush: f < 660 ? smooth(span(f, 0, 150)) : 1 - smooth(span(f, 660, T)),
    voidAlpha: smooth(span(f, 150, 205)) * (1 - smooth(span(f, 690, T))),
    ribbonAlpha: smooth(span(f, 150, 200)) * (1 - smooth(span(f, 670, 730))),
    ribbonTurns: f > 150 ? (f - 150) / 50 : 0,
    showOldModel: false,      // the model is swapped at commit (captured a1=0)
    oldModelWhiteout: 0,
    fireIntensity: smooth(span(f, 260, 320)) * (1 - smooth(span(f, 560, 640))),
    wireframeAlpha: smooth(span(f, 330, 420)) * (1 - smooth(span(f, 570, 645))),
    hexagramAlpha: smooth(span(f, 430, 470)) * (1 - smooth(span(f, 600, 655))),
    hexagramScale: 0.35 + 0.65 * smooth(span(f, 430, 500)),
    circuitFill: smooth(span(f, 470, 560)),
    flashAlpha: smooth(span(f, 520, 560)) * (1 - smooth(span(f, 585, 630))),
    solidAlpha: smooth(span(f, 595, 665)),
    showNewModel: true,
    healed: false,            // captured: manual DV does not heal
  };
}

// ── The REAL effect art ────────────────────────────────────────────────────────
//
// `FIGHTSTG_F0x80089cd8` spawns these by id through `F0x80089be4`
// (claim blast-dv-visuals-are-e000evol-effects-2026-08-13). Read from its cases:
//
//   case 2  flag==0 (manual DV): 0x3E8 AND 0x3E9      flag!=0 (Blast): 0x3EF
//   case 3  BOTH paths:          0x3EA
//   case 8  flag==0:             0x3EB                flag!=0:         0x3F0
//
// Note the middle row: **0x3EA is spawned unconditionally**, so it belongs to the
// Blast program too. An earlier reading of this listed Blast as 0x3EF then 0x3F0
// and missed it.
//
// All six are effect types 1000-1003, 1007 and 1008 in
// web/assets/battle/effects/manifest.json, every one file E000EVOL archive 6.
//
// The REVERT runs none of these: it never calls F0x8008a7f4 at all — the capture
// has it use 0x800aa9f0 + 0x80087000, the same pair Tag uses — which is why its
// window carries no fire and no data-burst.
// The spawn POSITIONS are decoded too. `F0x80089be4(id, table)` scans the effect
// registry at 0x800a2ea4 (stride 8, terminated by -1) for the id, then copies the
// table's eight bytes verbatim into the effect object at +0x5C with an unaligned
// lwl/lwr + swl/swr pair. Those eight bytes are {s16 x, s16 y, s16 z, s16 w},
// read out of fightstg.s L60-L64:
//
//   0x80082DC8  0x00000000 0x00007fff  -> (   0,    0, 32767)
//   0x80082DD0  0x007800a0 0x00007fff  -> ( 160,  120, 32767)
//   0x80082DD8  0xff88ff60 0x0000ffff  -> (-160, -120,    -1)
//
// 32767 and -1 are exactly the two screen-space z markers the shipped effect
// player already recognises. A blanket "spawn everything at the frame centre"
// was right for only the middle one.
export const EVOL_POS = {
  ORIGIN: Object.freeze({ x: 0, y: 0, z: 32767 }),          // 0x80082DC8
  CENTRE: Object.freeze({ x: 160, y: 120, z: 32767 }),      // 0x80082DD0
  NEG_CENTRE: Object.freeze({ x: -160, y: -120, z: -1 }),   // 0x80082DD8
} as const;

export interface EvolSpawn {
  frame: number;
  type: number;
  pos: { readonly x: number; readonly y: number; readonly z: number };
}

export const EVOL_EFFECT = {
  DV_A: 0x3e8, DV_B: 0x3e9, SHARED: 0x3ea, DV_END: 0x3eb,
  BLAST_START: 0x3ef, BLAST_END: 0x3f0,
} as const;

/**
 * When each effect is spawned, in this program's own frames.
 *
 * DECODED 2026-10-06 (authority 2, the disc's own fields; see
 * docs/research/battle/blast-driver-spawn-timing-2026-10-06.md). The controller
 * FIGHTSTG_F0x80089cd8 runs ONE substate per frame; the spawns are the gate
 * closes of substates 2, 3 and 8, not captured frames:
 *
 *   substate 1's `0xb4` timer gate closes  -> substate 2 spawns the start effect
 *   substate 3's 0xf0/(2*delta) counter    -> spawns the shared effect
 *   substate 8's 0xf0/(2*delta) counter    -> spawns the end effect
 *
 * At delta = 1 the START effect and the SHARED effect are STATIC and land at
 * frames 180 and 299 (proven over the ORIGINAL words by
 * tests/engine/unit/battle-effect-driver-timing.test.ts). The END effect is NOT
 * static: substates 5 and 7 spawn a slot overlay (FIGHTSTG_F0x800930c0, class
 * FIGHTSTG_F0x80092f7c) and wait on THAT object's runtime progress — its own 37-
 * frame readiness gate then its managed teardown — so it lands in a band, ~580-
 * 616 under the disc's own overlay gate. The sequence START is likewise gated by
 * the E000EVOL resource load in the construct stages.
 *
 * The frames below are the PRE-2026-10-06 WALKER VISUAL alignment to the capture
 * sheet (180/312/656 for Blast, 150/260/560 for manual DV). They differ from the
 * decoded disc frames by 0 / -13 / ~-40 and +30 / +39 / ~+56 respectively, and
 * the capture's phase boundaries are the spawned effects' OWN visual timelines,
 * not the driver's spawn frames. SUPERSEDED 2026-10-06: the ordinary path now spawns
 * at the PORTED DRIVER's own frames (driverEvolSchedule below), so this frozen table
 * is kept only for reference and for tests to compare against. Do not treat the
 * values below as decoded.
 */
export const EVOL_EFFECT_SCHEDULE: Readonly<Record<string, ReadonlyArray<EvolSpawn>>> = Object.freeze({
  [FormChangeProgram.BLAST_ON]: Object.freeze([
    { frame: 180, type: EVOL_EFFECT.BLAST_START, pos: EVOL_POS.ORIGIN },
    { frame: 312, type: EVOL_EFFECT.SHARED, pos: EVOL_POS.CENTRE },
    { frame: 656, type: EVOL_EFFECT.BLAST_END, pos: EVOL_POS.NEG_CENTRE },
  ]),
  [FormChangeProgram.MANUAL_DV]: Object.freeze([
    { frame: 150, type: EVOL_EFFECT.DV_A, pos: EVOL_POS.ORIGIN },
    { frame: 150, type: EVOL_EFFECT.DV_B, pos: EVOL_POS.ORIGIN },
    { frame: 260, type: EVOL_EFFECT.SHARED, pos: EVOL_POS.CENTRE },
    { frame: 560, type: EVOL_EFFECT.DV_END, pos: EVOL_POS.NEG_CENTRE },
  ]),
  [FormChangeProgram.BLAST_REVERT]: Object.freeze([]),
});

/** The spawn positions the driver's spawn calls pass (EFFECT_DRIVER_SPAWN_POS_*). */
const DRIVER_POS_ORIGIN = 0x80082dc8;
const DRIVER_POS_CENTRE = 0x80082dd0;
const DRIVER_POS_NEG = 0x80082dd8;

/** Which driver flag (obj+0x8) each program runs at; the revert runs no E000EVOL effects. */
const DRIVER_FLAG: Readonly<Record<string, number | null>> = Object.freeze({
  [FormChangeProgram.BLAST_ON]: 1,
  [FormChangeProgram.MANUAL_DV]: 0,
  [FormChangeProgram.BLAST_REVERT]: null,
});

function driverPos(table: number): { readonly x: number; readonly y: number; readonly z: number } {
  if (table === DRIVER_POS_CENTRE) return EVOL_POS.CENTRE;
  if (table === DRIVER_POS_NEG) return EVOL_POS.NEG_CENTRE;
  return EVOL_POS.ORIGIN;
}

const driverScheduleCache = new Map<string, ReadonlyArray<EvolSpawn>>();

/**
 * The Evolve effects the PORTED transformation driver spawns for `program`, in frames
 * — the driver's OWN observable output, computed by running its ported bodies
 * (engine/dw3/battle-effect-driver-host.ts#createTransformationSchedule) rather than
 * read off the captured contact sheet. The revert (sequence 0x62) spawns none, which
 * is a decoded fact (it never calls the effect controller).
 *
 * The first two spawns are static disc timers; the third sits behind the slot-overlay
 * child's runtime gate (a named boundary — see createTransformationSchedule).
 */
export function driverEvolSchedule(program: FormChangeProgramValue): ReadonlyArray<EvolSpawn> {
  const cached = driverScheduleCache.get(program);
  if (cached) return cached;
  const flag = DRIVER_FLAG[program];
  const out: EvolSpawn[] = flag == null ? [] : createTransformationSchedule({ flag }).map((s) => ({
    frame: s.frame, type: s.type, pos: driverPos(s.table),
  }));
  const frozen = Object.freeze(out);
  driverScheduleCache.set(program, frozen);
  return frozen;
}

/**
 * The spawns due on `frame` for `program`, given the last frame already fired. The
 * schedule is the PORTED DRIVER's (driverEvolSchedule), so the ordinary transformation
 * path runs the driver's own spawn times and positions.
 */
export function evolEffectsDue(
  program: FormChangeProgramValue, prevFrame: number, frame: number,
): EvolSpawn[] {
  const sched = driverEvolSchedule(program);
  return sched.filter((s) => s.frame > prevFrame && s.frame <= frame).map((s) => ({ ...s }));
}

/** One frame of any of the three form-change programs. */
export function formChangeState(
  program: FormChangeProgramValue, frame: number,
): BlastPresentationState {
  const f = Math.max(0, frame);
  if (program === FormChangeProgram.BLAST_REVERT) return revertState(f);
  if (program === FormChangeProgram.MANUAL_DV) return manualDvState(f);
  return blastPresentationState(f);
}
