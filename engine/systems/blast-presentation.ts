// engine/systems/blast-presentation.ts — the Blast digivolution transformation.
//
// Sequence 0x61 on the shared presentation manager (BLAST-C006: the same manager
// runs Tag 0x38, Blast-revert 0x62 and manual DV 0x37). This module owns only the
// TIMELINE; web/blast-presentation.js draws it and web/battle3d.js supplies the
// camera, the model swap, the stage fade and the wipe.
//
// GROUND TRUTH for Blast and manual digivolve: the ORIGINAL change task,
// FIGHTSTG_updateDigimonChange (dw3_decomp src/battle/battle_mode/digimon_change.c, 0x80089CD8),
// run frame by frame through the walker MIPS interpreter (ddw3-walker
// tests/helpers/digivolve-change-oracle.js) and confirmed on the real game
// (BizHawk, ~/dv-camera/RIG-digivolve.md). Manual (key2 = 0) and Blast (key2 = 1) run the
// SAME timeline; they differ only in the motions and the sprite effects.
//
// UNITS. Every frame here is a 60 Hz GAME TICK (the original's task counters, getFrameTime). The
// presentation frame n is the change task's call count (n = 0 is its first run, no disc wait); the
// START CUT (substate 2, startChange) is n = 214. The comments below write f = n - 214 (f0 = the start cut). The old constants of this file (swap 312, return 800, manual return 660,
// last frame 739, flash f521..614) were frame numbers of a Redux capture counted in PAL vsyncs
// (50 Hz), named as if they were presentation ticks; they are gone.
//
//   f-214      task start: SOUND.loadBank(0x45)
//   f-213      setStage(0x1C manual / 0x1F Blast, 32, 32): the battle stage fades to black f-211..f-180
//   f-180      EVOLUTIO (0x41140000), the new Digimon is added as model 1 (hidden), 180-tick hold
//   f0         startChange: cut to near shot 9, wipe of the old model into its wireframe (2 rows/tick),
//              old model motion 14 (Blast) / 13 (manual), the enemy hidden, effects 1007 / 1000+1001
//   f119       wipe done (old model layer off), effect 1002
//   f240       startWhiteFlash(32): +7 per tick, 255 on f276-f277
//   f278       swap: new model takes slot 0, cut to its shot 9, endWhiteFlash (level -7 per tick, 0 from f314)
//   f316..436  wipe of the new model in over its wireframe (2 rows/tick, from f317); f436 effects 1003 / 1008
//   f437       new model motion 13   (Blast: the full heal lands when the menu sees it, f438)
//   f618..649  stage back to the battle stage (32 ticks out of the change stage, then 32 in)
//   f649       cut to plain shot 9;  f651 camera fade to the enemy view (60), enemy shown, battle music,
//              final motion;  f711 task state 3: the presentation ends
//
// What is NOT decoded: the look of the change stages 0x1C / 0x1F (FILE_FIGHT_STAGES data, not in the C
// source; the renderer keeps the black void for them), the wireframe's own colour, and the length of the
// "Blasted!" message before the task starts (menu.c WFIGHTMN_blast shows it, then starts the task).

import { createTransformationSchedule } from "../dw3/battle-effect-driver-host.ts";
import { rotMatrixZYX, type Mat3 } from "../dw3/gte-math.ts";

/** The change task's first run (state 0: SOUND.loadBank(0x45)). */
export const DV_TASK_START_FRAME = 0;
/** The stage task's first fade-out run (setStage(0x1C / 0x1F, 32, 32) was called on f-213). */
export const DV_STAGE_OUT_FIRST_FRAME = 3;
/** EVOLUTIO plays and the new Digimon is added as model 1; the stage fade-out is over. */
export const DV_EVOLUTIO_FRAME = 34;
/** startChange: the start cut, the wipe begins (clip0.h 238 on this frame). */
export const DV_CUT_FRAME = 214;
/** wipeToWireframe's last run: clip0.h 0, the old model's layer off, effect 1002. */
export const DV_WIPE_END_FRAME = 333;
/** startWhiteFlash(32). */
export const DV_FLASH_START_FRAME = 454;
/** swapInNewDigimon: setId(1, 0), the cut to the new model's shot 9, endWhiteFlash. */
export const DV_SWAP_FRAME = 492;
/** The first wipeFromWireframe run (clip0.h 2). */
export const DV_WIPE_BACK_FIRST_FRAME = 531;
/** wipeFromWireframe's last run: clip0.h 240, the wireframe layer off, effect 1003 / 1008. */
export const DV_WIPE_BACK_END_FRAME = 650;
/** The new model's motion 13. */
export const DV_NEW_MOTION_FRAME = 651;
/** The stage task is in its fade back to the battle stage from here (setStage was called on f617). */
export const DV_STAGE_BACK_FRAME = 832;
/** The change stage (0x1C manual digivolve / 0x1F Blast): its model is created on stage run 35 (black), the old stage is gone. */
export const CHANGE_STAGE_MODEL_FRAME = 35;
/** The battle stage's model is created again on stage run DV_CUT_FRAME + 650 (black); its fade-in runs DV_CUT_FRAME + 651..DV_CUT_FRAME + 682. */
export const CHANGE_STAGE_BACK_MODEL_FRAME = DV_CUT_FRAME + 650;
/** digimon_change.c:253: setStage(task->key2 != 0 ? 0x1F : 0x1C, 32, 32): the manual digivolve's stage. */
export const CHANGE_STAGE_MANUAL = 0x1C;
/** The Blast change stage. */
export const CHANGE_STAGE_BLAST = 0x1F;
/** BlastPresentationState.stage 0: the battle's own stage (BATTLE_SETUP.stage), which the change task fades out and back in. */
export const CHANGE_STAGE_BATTLE = 0;
/** stage.c: the stage model's colour is 0..0x80 (0x80 = the model as is); the fade is 0..0x1000 in steps of 0x1000 / 32 = 128 a run. */
export const CHANGE_STAGE_FULL = 0x80;
/** substate 12: the plain shot-9 cut. */
export const DV_PLAIN_CUT_FRAME = 863;
/** returnToBattle: camera fade to the enemy view, enemy shown, battle music, final motion. */
export const DV_RETURN_FRAME = 865;
/** The task's state 3 (first run): the change task is over. */
export const DV_TASK_END_FRAME = 925;
/** The presentation ends when the camera fade has snapped (shown f712 = 926). */
export const DV_END_FRAME = 926;

/**
 * Frame the "... Blasted!" line is cleared. The original shows it BEFORE the task starts (the menu
 * waits for its end, menu.c WFIGHTMN_blast step 1); its length is the message task's and is not in
 * the harness, so the walker keeps the 24 ticks it already showed it for, counted from the task start.
 */
export const BLAST_FIRST_FRAME = DV_TASK_START_FRAME + 24;
/** Blast and manual DV end on the same frame. */
export const BLAST_LAST_FRAME = DV_END_FRAME;
/** Run length in ticks, from the task start. */
export const BLAST_TOTAL_FRAMES = BLAST_LAST_FRAME - DV_TASK_START_FRAME;

/** The swap frame (both programs). */
export const BLAST_SWAP_FRAME = DV_SWAP_FRAME;

/**
 * The frame the full heal lands (Blast only). menu.c WFIGHTMN_blast step 2 polls
 * `models->get(models, 0)->motion == 13` and then sets hp = maxHp; the new model's motion becomes 13 on
 * f437 (substate 9; the change task is a CHILD of the menu task and registry.c executeTask runs the
 * parent first), so the menu sees it on f438. The old model's motion is 14 (Blast), never 13. This
 * frame is derived from those two sources, not run (the menu task is not in the harness).
 */
export const BLAST_HEAL_FRAME = DV_NEW_MOTION_FRAME + 1;

export const BlastPhase = {
  PUSH_IN: "push_in",
  VORTEX: "vortex",
  IGNITE: "ignite",
  WIREFRAME: "wireframe",
  DATA_BURST: "data_burst",
  RESOLVE: "resolve",
  REVEAL: "reveal",
  WIND_DOWN: "wind_down",
  /** The original change task's own stretches (Blast and manual DV), by substate. */
  STAGE_OUT: "stage_out",
  EVOLUTIO_HOLD: "evolutio_hold",
  WIPE_TO_WIREFRAME: "wipe_to_wireframe",
  WIREFRAME_HOLD: "wireframe_hold",
  FLASH_RISE: "flash_rise",
  FLASH_FALL: "flash_fall",
  WIPE_FROM_WIREFRAME: "wipe_from_wireframe",
  NEW_FORM_HOLD: "new_form_hold",
  STAGE_BACK: "stage_back",
  RETURN: "return",
} as const;

export type BlastPhaseValue = typeof BlastPhase[keyof typeof BlastPhase];

/** The change task's stretches (Blast and manual DV), from the substate changes of the run. */
export const BLAST_PHASES: ReadonlyArray<{
  id: BlastPhaseValue; from: number; to: number; caption: string;
}> = Object.freeze([
  { id: BlastPhase.STAGE_OUT, from: DV_TASK_START_FRAME, to: DV_EVOLUTIO_FRAME,
    caption: "state 0 loads the sound bank, the model and the change file; substate 0 sets the change stage (the battle stage fades out)" },
  { id: BlastPhase.EVOLUTIO_HOLD, from: DV_EVOLUTIO_FRAME, to: DV_CUT_FRAME,
    caption: "EVOLUTIO, the new Digimon added hidden as model 1, 180 ticks" },
  { id: BlastPhase.WIPE_TO_WIREFRAME, from: DV_CUT_FRAME, to: DV_WIPE_END_FRAME,
    caption: "start cut on shot 9, the old model wiped into its wireframe, 2 rows per tick" },
  { id: BlastPhase.WIREFRAME_HOLD, from: DV_WIPE_END_FRAME, to: DV_FLASH_START_FRAME,
    caption: "the old Digimon is all wireframe, 120 ticks" },
  { id: BlastPhase.FLASH_RISE, from: DV_FLASH_START_FRAME, to: DV_SWAP_FRAME,
    caption: "white flash, +7 per tick, until the flash task's substate is set" },
  { id: BlastPhase.FLASH_FALL, from: DV_SWAP_FRAME, to: DV_WIPE_BACK_FIRST_FRAME - 1,
    caption: "swap to the new model, the flash falls 7 per tick and is gone on f315" },
  { id: BlastPhase.WIPE_FROM_WIREFRAME, from: DV_WIPE_BACK_FIRST_FRAME - 1, to: DV_NEW_MOTION_FRAME,
    caption: "the new model wiped in over its wireframe, 2 rows per tick" },
  { id: BlastPhase.NEW_FORM_HOLD, from: DV_NEW_MOTION_FRAME, to: DV_STAGE_BACK_FRAME - 1,
    caption: "new model motion 13, 180 ticks" },
  { id: BlastPhase.STAGE_BACK, from: DV_STAGE_BACK_FRAME - 1, to: DV_PLAIN_CUT_FRAME,
    caption: "the battle stage fades back in" },
  { id: BlastPhase.RETURN, from: DV_PLAIN_CUT_FRAME, to: DV_END_FRAME,
    caption: "plain shot-9 cut, camera fade to the enemy view, battle music" },
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

export function blastPhaseAt(frame: number): BlastPhaseValue {
  if (frame < DV_TASK_START_FRAME) return BlastPhase.STAGE_OUT;
  for (const p of BLAST_PHASES) if (frame < p.to) return p.id;
  return BlastPhase.RETURN;
}

// ── The change task's frame functions (checked against the interpreter, frame by frame) ────────────

/**
 * The wipe row: native screen row (0..240) where the solid model layer ends and the wireframe layer
 * begins. digimon_change.c: BATTLE_LAYER_MODELS is clipped to clip0 = {0, 0, 320, h} and
 * BATTLE_LAYER_WIREFRAME to clip1 = {0, y, 320, 240 - y}, and h == y on every frame, so the solid model
 * shows rows [0, row) and the wireframe rows [row, 240).
 *   f < 0        240 (clip0 = the whole screen)
 *   f0..f119     240 - 2 * (f + 1)    (wipeToWireframe, 2 rows per tick, 0 on f119)
 *   f120..f316   0                    (the wireframe fills the screen; swapInNewDigimon sets clip0.h = 0)
 *   f317..f436   2 * (f - 316)        (wipeFromWireframe, 240 on f436)
 *   f > 436      240
 */
export function digivolveWipeRow(frame: number): number {
  const f = Math.floor(frame);
  if (f < DV_CUT_FRAME) return 240;
  if (f <= DV_WIPE_END_FRAME) return 240 - 2 * (f - DV_CUT_FRAME + 1);
  if (f < DV_WIPE_BACK_FIRST_FRAME) return 0;
  if (f <= DV_WIPE_BACK_END_FRAME) return 2 * (f - (DV_WIPE_BACK_FIRST_FRAME - 1));
  return 240;
}

/** The wireframe layer is on from startChange (layers[1].enabled) until wipeFromWireframe ends. */
export function digivolveWireOn(frame: number): boolean {
  const f = Math.floor(frame);
  return f >= DV_CUT_FRAME && f < DV_WIPE_BACK_END_FRAME;
}

/**
 * The white flash level (0..255): startWhiteFlash(32) on f240, speed = 0xFF / 32 = 7, +7 per tick from
 * f240 (7) to 252 on f275, 255 on f276 and f277; swapInNewDigimon's endWhiteFlash on f278 makes it fall
 * 7 per tick (248 on f278 ... 3 on f313), 0 from f314 (the task is gone on f315).
 */
export function digivolveFlashLevel(frame: number): number {
  const f = Math.floor(frame);
  if (f < DV_FLASH_START_FRAME || f >= DV_SWAP_FRAME + 36) return 0;
  if (f < DV_SWAP_FRAME) return Math.min(0xFF, 7 * (f - (DV_FLASH_START_FRAME - 1)));
  return 0xFF - 7 * (f - (DV_SWAP_FRAME - 1));
}

/**
 * How much of the battle stage is showing, 0..1 (stage.c: the stage task fades the stage model colour
 * and the screen background by `fade`, 128 of 4096 per tick, 32 ticks):
 *   f < -211     1
 *   f-211..f-180 1 - (f + 212) / 32  (setStage(change stage): the battle stage fades out)
 *   f-180..f650  0                   (the change stage: a black void here, its own look is data, not decoded;
 *                                     f618..f648 it fades out, f649..f650 the battle stage waits at black)
 *   f651..f681   (f - 650) / 32      (the battle stage fades in)
 *   f >= 682     1
 */
export function digivolveStageBrightness(frame: number): number {
  const f = Math.floor(frame);
  if (f <= DV_STAGE_OUT_FIRST_FRAME - 1) return 1;
  if (f < DV_EVOLUTIO_FRAME) return 1 - (f - (DV_STAGE_OUT_FIRST_FRAME - 1)) / 32;
  if (f <= DV_RETURN_FRAME - 1) return 0;
  if (f < DV_RETURN_FRAME + 31) return (f - (DV_RETURN_FRAME - 1)) / 32;
  return 1;
}

/** FIGHTSTG_lerpVector on one channel: from + (((to - from) * t) >> 12), t = the stage fade 0..0x1000. */
function stageLerp(from: number, to: number, fade: number): number {
  return from + (((to - from) * fade) >> 12);
}

/**
 * The stage on screen and its model colour on presentation frame F (stage.c FIGHTSTG_updateStage
 * through digimon_change.c's two setStage calls), read off the real stage task:
 *  - runs 3..34: the battle stage fades out, colour lerp(0x80, 0, 128 (F - 2));
 *  - run 35: the change stage's model is created, colour 0 (prepareStageModel);
 *  - runs 36..67: it fades in, colour lerp(0, 0x80, 128 (F - 35)); it is full until run 831;
 *  - runs 832..863: it fades out (setStage(BATTLE_SETUP.stage, 32, 32) was called at the end of run 831);
 *  - run 864: the battle stage's model is created again, colour 0; runs 865..896 it fades in.
 * The model killed at the end of a fade-out is black, so those black frames name the stage that faded.
 * The interpreter's frame time is 1 a run (a real run can take more).
 */
export function changeStage(blast: boolean, frame: number): { stage: number; level: number } {
  const F = Math.max(0, frame);
  const change = blast ? CHANGE_STAGE_BLAST : CHANGE_STAGE_MANUAL;
  const step = 0x1000 / 32;
  if (F < DV_STAGE_OUT_FIRST_FRAME) return { stage: CHANGE_STAGE_BATTLE, level: CHANGE_STAGE_FULL };
  if (F <= DV_EVOLUTIO_FRAME) {
    const fade = step * (F - (DV_STAGE_OUT_FIRST_FRAME - 1));
    return { stage: CHANGE_STAGE_BATTLE, level: stageLerp(CHANGE_STAGE_FULL, 0, fade) };
  }
  if (F <= DV_STAGE_BACK_FRAME - 1) {
    const fade = Math.min(0x1000, step * (F - CHANGE_STAGE_MODEL_FRAME));
    return { stage: change, level: stageLerp(0, CHANGE_STAGE_FULL, fade) };
  }
  if (F < CHANGE_STAGE_BACK_MODEL_FRAME) {
    const fade = Math.min(0x1000, step * (F - (DV_STAGE_BACK_FRAME - 1)));
    return { stage: change, level: stageLerp(CHANGE_STAGE_FULL, 0, fade) };
  }
  const fade = Math.min(0x1000, step * (F - CHANGE_STAGE_BACK_MODEL_FRAME));
  return { stage: CHANGE_STAGE_BATTLE, level: stageLerp(0, CHANGE_STAGE_FULL, fade) };
}

/** The change stage's motion (the stage's motions file, entry 0: one step of frames 1..1500, then the 0x8000 key loops it). */
export const CHANGE_STAGE_MOTION_FRAMES = 1500;

/**
 * The motion frame (1..1500) the change stage's model shows on presentation frame F: it advances one
 * frame a run (FIGHTSTG_stepMotion, keyframe += FIGHTSTG_battle.frames) from the run its model is
 * created on and loops. The model task's first run can be one or two runs after the creation (not
 * measured), so this is within a couple of frames.
 */
export function changeStageMotionFrame(frame: number): number {
  const t = Math.max(0, frame - CHANGE_STAGE_MODEL_FRAME);
  return (t % CHANGE_STAGE_MOTION_FRAMES) + 1;
}

/** A change-stage mesh bone's rotation track: [frame, x, y, z] keys, 4096 angle units a turn. */
export type ChangeStageRotKeys = ReadonlyArray<ReadonlyArray<number>>;

const s16c = (v: number): number => (v << 16) >> 16;

/**
 * The bone rotation at motion frame `frame` (model_mesh.c FIGHTSTG_poseBone, the rotation track): a key whose frame is
 * exactly `frame` is taken as it is; otherwise the first key at or after the frame (cur) and the key before it (prev) give
 * t = ((frame - prev.frame) << 12) / (cur.frame - prev.frame) (C integer division), step = (t * (cur - prev)) >> 12 per
 * axis (gte_gpf12: IR0 * IR >> 12, arithmetic shift, IR saturated to 16 bits), out = prev + step as a 16-bit value.
 * Past the last key the last key holds (the shipped loop never reaches that: frames are 1..1500, the last key is 1501).
 */
export function changeStageRotAt(keys: ChangeStageRotKeys, frame: number): [number, number, number] {
  if (!keys.length) return [0, 0, 0];
  const f = Math.trunc(frame);
  let i = 0;
  for (; i < keys.length; i++) {
    if (keys[i]![0] === f) return [keys[i]![1]!, keys[i]![2]!, keys[i]![3]!];
    if (keys[i]![0]! >= f) break;
  }
  if (i === 0 || i >= keys.length) {
    const k = keys[Math.min(i, keys.length - 1)]!;
    return [k[1]!, k[2]!, k[3]!];
  }
  const prev = keys[i - 1]!, cur = keys[i]!;
  const t = Math.trunc(((f - prev[0]!) << 12) / (cur[0]! - prev[0]!));
  const ax = (a: number, b: number): number => {
    const d = s16c(b - a);
    const m = (t * d) >> 12;
    return s16c(a + (m > 0x7fff ? 0x7fff : m < -0x8000 ? -0x8000 : m));
  };
  return [ax(prev[1]!, cur[1]!), ax(prev[2]!, cur[2]!), ax(prev[3]!, cur[3]!)];
}

/**
 * The change-stage mesh's rotation matrix at motion frame `frame` (model_mesh.c FIGHTSTG_updateModel: RotMatrixZYX_gte
 * (&bone->rot, &bone->local), F0x8002b45c, R = Rz * Ry * Rx, row-major 3x3, 1.0 = 0x1000), then ScaleMatrix with the
 * bone's scale: MEFT1028 and MEFT1031 carry scale 0x1000 and translation 0 on every mesh (their ctrl bins), so the local
 * matrix is the rotation alone.
 */
export function changeStageMeshMatrix(keys: ChangeStageRotKeys, frame: number): Mat3 {
  const r = changeStageRotAt(keys, frame);
  return rotMatrixZYX(r[0], r[1], r[2]);
}

/**
 * The screen background the stage task sets on a frame (FIGHTSTG_fadeStage): the stage's bgColor
 * (FightStageInfo.bgColor) lerped with the same fade as the model colour, which on both the fade-out
 * (bgColor -> 0, level = 0x80 - fade / 32) and the fade-in (0 -> bgColor, level = fade / 32) comes to
 * (channel * level) >> 7. A black result is set as (1, 1, 1): black is drawn as 1, 1, 1.
 */
export function changeStageBg(bg: ReadonlyArray<number>, level: number): [number, number, number] {
  const r = ((bg[0] ?? 0) * level) >> 7, g = ((bg[1] ?? 0) * level) >> 7, b = ((bg[2] ?? 0) * level) >> 7;
  return r !== 0 || g !== 0 || b !== 0 ? [r, g, b] : [1, 1, 1];
}

export interface BlastPresentationState {
  frame: number;
  phase: BlastPhaseValue;
  /** Progress within the current phase, 0..1. */
  phaseProgress: number;
  /** Whole-presentation progress, 0..1. */
  progress: number;
  done: boolean;

  /**
   * Camera dolly toward the fighter. Only the REVERT still uses it (its camera is the entrance
   * machine, entrance.c, a separate task). Blast and manual DV are 0: their camera is the
   * original's cut and fade (formChangeCameraSchedule).
   */
  cameraPush: number;
  /** Black over the battle stage, 0..1 (1 - digivolveStageBrightness). */
  voidAlpha: number;
  /**
   * The fight stage the stage task has on screen: CHANGE_STAGE_BATTLE (the battle's own), or
   * CHANGE_STAGE_MANUAL / CHANGE_STAGE_BLAST (the change stage, see changeStage). Programs that do not
   * drive the stage task (the revert) keep CHANGE_STAGE_BATTLE at CHANGE_STAGE_FULL.
   */
  stage: number;
  /** That stage model's colour, 0..CHANGE_STAGE_FULL (the last setColor value of stage.c FIGHTSTG_fadeStage). */
  stageLevel: number;
  /** The change stage this program sets (CHANGE_STAGE_MANUAL / CHANGE_STAGE_BLAST), 0 when it sets none: the renderer loads it ahead. */
  stageChange: number;
  /** Blast and manual DV: no original source for any of these walker visuals, so they are 0. */
  ribbonAlpha: number;
  ribbonTurns: number;
  /** Original model: shown until the swap. */
  showOldModel: boolean;
  oldModelWhiteout: number;
  fireIntensity: number;
  /** The wireframe layer is on (1) or off (0): the original draws it at full strength, no fade. */
  wireframeAlpha: number;
  hexagramAlpha: number;
  hexagramScale: number;
  circuitFill: number;
  /** Full-screen white flash, 0..1. */
  flashAlpha: number;
  /** The original flash level 0..255, ADDED to the screen (digivolveFlashLevel / revertFlashLevel). */
  flashLevel?: number;
  /** 1 while the solid model layer shows any rows (Blast, manual DV), or the revert's model is on. */
  solidAlpha: number;
  showNewModel: boolean;
  /** True once the unconditional full heal has landed (BLAST-C007, WFIGHTMN_blast step 2). */
  healed: boolean;
  /**
   * Blast and manual DV only (digivolveWipeRow): the solid layer shows native rows [0, wipeRow), the
   * wireframe layer (when wireOn) rows [wipeRow, 240). Undefined for the revert.
   */
  wipeRow?: number;
  wireOn?: boolean;
  /** The enemy model's layer is off, startChange .. returnToBattle (f0..f650) for Blast and manual DV; f19..f298 for the player entrance. */
  enemyHidden?: boolean | undefined;
  /** The entrance only: 0 = player side (key2 0), 1 = enemy side (key2 0x10). Undefined for Blast and manual DV. */
  entranceSide?: 0 | 1;
  /** The enemy entrance hides the PLAYER partner from f19 until f298 (shown again on f299). */
  playerHidden?: boolean | undefined;
}

/**
 * One frame of the change task (Blast and manual DV share it). `blast` picks the change stage (0x1F / 0x1C);
 * `healFrame` is the frame the heal lands, or null for the manual digivolve.
 */
function changeState(blast: boolean, frame: number, healFrame: number | null): BlastPresentationState {
  const f = Math.floor(frame);
  const phase = blastPhaseAt(f);
  const cur = BLAST_PHASES.find((p) => p.id === phase)!;
  const row = digivolveWipeRow(f);
  const wireOn = digivolveWireOn(f);
  const level = digivolveFlashLevel(f);
  return {
    frame: f,
    phase,
    phaseProgress: span(f, cur.from, cur.to),
    progress: clamp01((f - DV_TASK_START_FRAME) / BLAST_TOTAL_FRAMES),
    done: f >= DV_END_FRAME,
    // The camera is the original's cut and fade (formChangeCameraSchedule), not a curve here.
    cameraPush: 0,
    voidAlpha: 1 - digivolveStageBrightness(f),
    stage: changeStage(blast, f).stage,
    stageLevel: changeStage(blast, f).level,
    stageChange: blast ? CHANGE_STAGE_BLAST : CHANGE_STAGE_MANUAL,
    ribbonAlpha: 0,
    ribbonTurns: 0,
    showOldModel: f < DV_SWAP_FRAME,
    oldModelWhiteout: 0,
    fireIntensity: 0,
    wireframeAlpha: wireOn ? 1 : 0,
    hexagramAlpha: 0,
    hexagramScale: 1,
    circuitFill: 0,
    flashAlpha: level / 0xFF,
    flashLevel: level,
    solidAlpha: row > 0 ? 1 : 0,
    showNewModel: f >= DV_SWAP_FRAME,
    healed: healFrame !== null && f >= healFrame,
    wipeRow: row,
    wireOn,
    enemyHidden: f >= DV_CUT_FRAME && f < DV_RETURN_FRAME,
  };
}

/** Blast (key2 = 1) on presentation frame `frame` (the original's change task, ticks from the start cut). */
export function blastPresentationState(frame: number): BlastPresentationState {
  return changeState(true, frame, BLAST_HEAL_FRAME);
}

/** Seconds of wall clock for the whole presentation at the 60 Hz reference. */
export const BLAST_PRESENTATION_SECONDS = BLAST_TOTAL_FRAMES / 60;

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
  /**
   * The PLAYER-side entrance, FIGHTSTG_startEntrance(id, 0, weak) (entrance.c): Blast ending (sequence 0x62),
   * a player tag and a player KO replacement. The name is the first caller; the program is the entrance.
   */
  BLAST_REVERT: "blast_revert",
  /** The ENEMY-side entrance, FIGHTSTG_startEntrance(id, 1, weak) (key2 = 0x10): the next enemy, the boss bodies. */
  ENTRANCE_ENEMY: "entrance_enemy",
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
/** The captured window, f5941..f6267: the walker visual (void, ribbons, wireframe) runs on it. */
export const REVERT_VISUAL_END_FRAME = 326;
/**
 * Length of the revert presentation. The camera is the entrance machine's (entrance.c,
 * FIGHTSTG_updateEntrance key2 = 0) and its last frame is REVERT_CAMERA_FADE_END_FRAME (360, the
 * snap onto the enemy view), so the window is 361 frames, longer than the captured 326.
 */
export const REVERT_LAST_FRAME = 361;
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
/**
 * The entrance swaps the model at the cut (showEnteringModel: models->setId, f114) and never heals. The
 * ROSTER record (form, gauge) is restored at the commit; the 3D model is not.
 */
export const REVERT_SWAP_FRAME = 114;
/**
 * Enemy-side entrance: the final fade (returnToBattle, f299) is 1 frame, not 60 (entrance.c state 7,
 * `key2 != 0 ? 1 : 60`; interpreter: fade time 1048576 = 0x100000 / 1). The camera snaps on f300 and the
 * window ends on f301, the same "snap frame + 1" the player's 361 is (299 + 61 + 1).
 */
export const ENTRANCE_ENEMY_CAMERA_FADE_END_FRAME = 300;
export const ENTRANCE_ENEMY_LAST_FRAME = 301;

// ── Manual DV (key2 = 0): the same change task as Blast ───────────────────────────────────────────
// WFIGHTMN_digivolve (menu.c) starts FIGHTSTG_startDigimonChange(id, 0): the timeline above, with the old model's
// motion 13 (Blast: 14), effects 1000 + 1001 / 1003 (Blast: 1007 / 1008), no heal, and a final motion of 2 when
// the partner's idleMotion is not 0 (Blast: 1). The old capture's numbers (EVOLUTIO +34, BGM +739, model load at
// commit) were PAL vsyncs counted from the commit: +34 PAL frames is n = 34 here (EVOLUTIO) and the BGM is n = 865.
/** Length of the manual-DV window: the task's state 3. */
export const MANUAL_DV_LAST_FRAME = DV_END_FRAME;
/** EVOLUTIO fires here (substate 1 step 0, once the stage fade-out is over). */
export const MANUAL_DV_SOUND_FRAME = DV_EVOLUTIO_FRAME;
/** The swap frame: swapInNewDigimon (the model is added hidden as model 1 on f-180, it takes slot 0 here). */
export const MANUAL_DV_SWAP_FRAME = DV_SWAP_FRAME;

/** Total frames for one program. */
export function formChangeLength(program: FormChangeProgramValue): number {
  if (program === FormChangeProgram.BLAST_REVERT) return REVERT_LAST_FRAME;
  if (program === FormChangeProgram.ENTRANCE_ENEMY) return ENTRANCE_ENEMY_LAST_FRAME;
  if (program === FormChangeProgram.MANUAL_DV) return MANUAL_DV_LAST_FRAME;
  return BLAST_LAST_FRAME;
}

/**
 * The digivolution camera, WHEN, and the change task's other per-frame events. The maths is the original's
 * (FIGHTSTG_updateDigimonChange, digimon_change.c): startChange cuts to the partner's near shot 9 offset by
 * -homePos.z, swapInNewDigimon cuts to the same again for the new model, substate 12 cuts to plain shot 9, and
 * returnToBattle fades to the enemy view (the arena shot) over 60 frames. Manual digivolve and Blast run the same
 * camera. Nothing moves in between. The frames are the interpreter's (see the header), both programs:
 *   taskStartFrame   0   (n; f-214) the camera task runs from the task's first run (the stepper counts from here)
 *   startFrame        0   start cut, old model motion startMotion, enemy hidden
 *   swapFrame       278   swap cut (and the new model's own shot 9)
 *   newMotionFrame  437   the new model's motion newMotion (13)
 *   returnFrame     649   plain shot-9 cut (substate 12)
 *   fadeFrame       651   returnToBattle: fade to the enemy view, enemy shown, final motion, battle music
 * Motions: old model 14 (Blast) / 13 (manual) on f0; the final motion is `returnMotion` (1), or
 * `weakReturnMotion` when the partner's idleMotion is not 0 (manual 2, Blast 1: `key2 != 0 || idleMotion == 0 ? 1 : 2`).
 * The revert runs the entrance machine instead (entrance.c) and has no schedule here.
 */
export interface FormChangeCameraSchedule {
  taskStartFrame: number;
  startFrame: number;
  swapFrame: number;
  newMotionFrame: number;
  returnFrame: number;
  fadeFrame: number;
  startMotion: number;
  newMotion: number;
  returnMotion: number;
  weakReturnMotion: number;
}

export function formChangeCameraSchedule(
  program: FormChangeProgramValue,
): FormChangeCameraSchedule | null {
  if (program === FormChangeProgram.BLAST_REVERT || program === FormChangeProgram.ENTRANCE_ENEMY) return null;
  const manual = program === FormChangeProgram.MANUAL_DV;
  return {
    taskStartFrame: DV_TASK_START_FRAME,
    startFrame: DV_CUT_FRAME,
    swapFrame: manual ? MANUAL_DV_SWAP_FRAME : BLAST_SWAP_FRAME,
    newMotionFrame: DV_NEW_MOTION_FRAME,
    returnFrame: DV_PLAIN_CUT_FRAME,
    fadeFrame: DV_RETURN_FRAME,
    startMotion: manual ? 13 : 14,
    newMotion: 13,
    returnMotion: 1,
    weakReturnMotion: manual ? 2 : 1,
  };
}

/**
 * The revert's camera, WHEN: FIGHTSTG_updateEntrance (entrance.c), state 1, key2 = 0. Frame f is
 * the entrance's frame e minus 11: the capture puts PLAYER11 (played at the flash start, e61) at
 * presentation f50, so e1 (fade armed, counter already 1) is f-10 and presentation f0 = e11.
 *   s0           e1    camera.fade(current -> near shot 10, 60)                 f-10
 *   s1           e30   counter >= 30: the ENEMY model (0x10) is hidden            f19
 *   s1           e60   counter >= 60: next substate (nextSubstate zeroes counter + step)
 *   s2           e61   startWhiteFlash(60): speed 0xFF/60 = 4, the flash task is a child and runs
 *                      after its parent in the same frame, level 4 on e61
 *   (flash)      e124  level 4*64 = 256 >= 0xFF: substate != 0                    f113
 *   s3           e125  sees it: showEnteringModel = camera.set(near shot 10), a CUT   f114
 *   s4/s5        e126  endWhiteFlash(60); the flash fades 4 per frame, below 0 on its 64th frame
 *                      (e189, state KILL), is destroyed on e190, the parent sees NULL on e191
 *   s6           e191  step = 1 on e191 (nextSubstate zeroed it), step >= 120 on e310
 *   s7           e310  camera.fade(current -> enemy view, 60), enemy shown again     f299
 * The fade is 60 frames: frame k = 1 at f300, the snap (frame 61) at f360.
 */
export interface RevertCameraSchedule {
  fadeFrame: number;      // fade to near shot 10
  hideFrame: number;      // enemy hidden from this frame
  cutFrame: number;       // cut to near shot 10 (flash full)
  returnFrame: number;    // enemy shown + fade to the enemy view
}
export const REVERT_CAMERA_FADE_END_FRAME = 360;
export function revertCameraSchedule(): RevertCameraSchedule {
  return { fadeFrame: -10, hideFrame: 19, cutFrame: 114, returnFrame: 299 };
}

/**
 * The entrance machine of either side (FIGHTSTG_startEntrance(id, side, weak), key2 = 0 / 0x10). Every event frame
 * is the same for both sides (interpreter run, key2 0 and 0x10: fade armed n0, other model hidden n29, PLAYER11 +
 * flash start n60, cut + done + motion 13 n124, final fade + other model shown + motion 1 (2 weak) n309; f = n - 10).
 * What differs is WHICH models: the player side hides the ENEMY and shows the new fighter in near shot 10; the enemy
 * side hides the PLAYER partner and shows the new enemy in its far shot 2. And the length of the final fade: 60 frames
 * for the player, 1 for the enemy (entrance.c state 7). `swapFrame` is the cut: models->setId puts the new fighter
 * in the slot there, and the caller commits its record there (`done = 1`).
 */
export interface EntranceCameraSchedule extends RevertCameraSchedule {
  side: 0 | 1;
  swapFrame: number;        // models->setId + motion 13 + done = 1, the same call as the cut
  returnFadeFrames: number; // the final fade: 60 (player) / 1 (enemy)
  shotIndex: number;        // getFighterView(side, shotIndex): near 10 (player) / far 2 (enemy)
  hiddenSide: 0 | 1;        // whose model is off from hideFrame to returnFrame: the OTHER side's
  lastFrame: number;        // the window: the final fade's snap frame + 1
}
export function entranceCameraSchedule(side: 0 | 1): EntranceCameraSchedule {
  return {
    ...revertCameraSchedule(),
    side,
    swapFrame: 114,
    returnFadeFrames: side === 0 ? 60 : 1,
    shotIndex: side === 0 ? 10 : 2,
    hiddenSide: side === 0 ? 1 : 0,
    lastFrame: side === 0 ? REVERT_LAST_FRAME : ENTRANCE_ENEMY_LAST_FRAME,
  };
}

/**
 * The white flash of the revert, per presentation frame, in the original's 0..255 level
 * (white_flash.c FIGHTSTG_updateWhiteFlash / entrance.c). f = entrance frame e - 11.
 *   startWhiteFlash(60): speed = 0xFF / 60 = 4 (integer); level starts 0, +4 each frame from e61 (f50):
 *   level = 4 * (f - 49) up to f112 (252); 4 * 64 = 256 >= 0xFF on e124 (f113): level 255, substate != 0.
 *   Held 255 on f114 (the entrance sees it, cuts). endWhiteFlash(60) on e126 (f115): speed 4, DONE:
 *   level -= 4 per frame (251 on f115 ... 3 on f177); < 0 on f178: level 0, KILL.
 * Drawn as a full-screen 320x240 quad r=g=b=level, code 0x2A, tpage 0xA0 (additive B+F), front layer.
 * Same function in web/fight/digivolve-camera.js (a test compares them).
 */
export const REVERT_FLASH_START_FRAME = 50;
export const REVERT_FLASH_FULL_FRAME = 113;
export const REVERT_FLASH_END_FRAME = 115;
export const REVERT_FLASH_KILL_FRAME = 178;
export function revertFlashLevel(frame: number): number {
  const f = Math.floor(frame);
  if (f < REVERT_FLASH_START_FRAME || f >= REVERT_FLASH_KILL_FRAME) return 0;
  if (f < REVERT_FLASH_FULL_FRAME) return 4 * (f - (REVERT_FLASH_START_FRAME - 1));
  if (f < REVERT_FLASH_END_FRAME) return 0xFF;
  return 0xFF - 4 * (f - (REVERT_FLASH_END_FRAME - 1));
}

/**
 * The frame each program's jingle fires, or null when it has none: EVOLUTIO on f-180 for Blast and manual
 * digivolve (substate 1 step 0), PLAYER11 +50 for the revert.
 */
export function formChangeSoundFrame(program: FormChangeProgramValue): number | null {
  if (program === FormChangeProgram.BLAST_REVERT || program === FormChangeProgram.ENTRANCE_ENEMY) return REVERT_SOUND_FRAME;
  return DV_EVOLUTIO_FRAME;
}

/**
 * The frame the battle music is started again (returnToBattle: SOUND.playSound(BATTLE_SETUP.music), the same
 * run that arms the camera fade, f651); null for the revert (PLAYER11 is a one-shot, nothing to restore).
 */
export function formChangeMusicFrame(program: FormChangeProgramValue): number | null {
  return program === FormChangeProgram.BLAST_REVERT || program === FormChangeProgram.ENTRANCE_ENEMY ? null : DV_RETURN_FRAME;
}

/**
 * The revert, sequence 0x62. Captured: 326 frames, PLAYER11 at f50, the form
 * already restored before frame 0, no heal, gauge already zeroed. Everything
 * else is entrance.c (FIGHTSTG_updateEntrance, key2 = 0): a white flash and the
 * model switched on at the cut. No void, ribbons, wireframe or solid fade-in.
 */
function entranceState(f: number, side: 0 | 1): BlastPresentationState {
  const T = REVERT_VISUAL_END_FRAME;
  const sch = entranceCameraSchedule(side);
  const hidden = f >= sch.hideFrame && f < sch.returnFrame;
  return {
    frame: f,
    phase: f < 160 ? BlastPhase.WIREFRAME
      : f < 230 ? BlastPhase.DATA_BURST
        : f < 264 ? BlastPhase.RESOLVE : BlastPhase.WIND_DOWN,
    phaseProgress: span(f, 0, T),
    progress: clamp01(f / T),
    done: f >= sch.lastFrame,
    // The camera is the entrance machine's (revertCameraSchedule), not a dolly.
    cameraPush: 0,
    voidAlpha: 0,                           // entrance.c draws no void
    stage: CHANGE_STAGE_BATTLE,             // the revert never drives the stage task
    stageLevel: CHANGE_STAGE_FULL,
    stageChange: 0,
    ribbonAlpha: 0,                         // entrance.c draws no ribbons
    ribbonTurns: 0,
    // The entering fighter's OLD model stays on screen until the cut (entrance.c: models->setId at
    // showEnteringModel, f114); the new one is on from there.
    showOldModel: f < sch.swapFrame,
    oldModelWhiteout: 0,
    fireIntensity: 0,                       // no flames in a de-digivolution
    wireframeAlpha: 0,                      // entrance.c sets layers[0].wireframe = 0 and draws none
    hexagramAlpha: 0,                       // no data-burst on the way down
    hexagramScale: 1,
    circuitFill: 0,
    flashAlpha: revertFlashLevel(f) / 0xFF,
    flashLevel: revertFlashLevel(f),
    solidAlpha: f >= sch.cutFrame ? 1 : 0,   // showEnteringModel (cut, f114) enables the model; no fade-in
    showNewModel: f >= sch.swapFrame,       // models->setId at the cut
    healed: false,                          // captured: no heal at revert
    entranceSide: side,
    // The OTHER side's model: the enemy for the player entrance, the player partner for the enemy one.
    enemyHidden: side === 0 ? hidden : undefined,
    playerHidden: side === 1 ? hidden : undefined,
  };
}

/**
 * Manual DV (key2 = 0): the same change task as Blast (changeState), no heal. The DV gauge is NOT zeroed and
 * the next turn is queued as an ordinary turn (dv_manual.txt, decoded commit order).
 */
function manualDvState(f: number): BlastPresentationState {
  return changeState(false, f, null);
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
 * When each effect is spawned, in presentation frames (f0 = the start cut). The ORIGINAL's own calls
 * (digimon_change.c, run through the interpreter, FIGHTSTG_startSpriteEffect recorded):
 *   f0    startChange        manual 1000 + 1001, Blast 1007     at (0, 0, 0x7FFF)
 *   f119  wipeToWireframe    1002 (both)                        at (160, 120, 0x7FFF), the wipe is done
 *   f436  wipeFromWireframe  manual 1003, Blast 1008            at (-160, -120, -1), behind (z -1)
 * The ported transformation driver (driverEvolSchedule below) spawns the same effects on frames 180 / 299 /
 * ~616: those count from the 180-tick hold's start (n = 34), so the presentation frame is the driver's + 34 (214 / 333 / 650).
 */
export const EVOL_EFFECT_SCHEDULE: Readonly<Record<string, ReadonlyArray<EvolSpawn>>> = Object.freeze({
  [FormChangeProgram.BLAST_ON]: Object.freeze([
    { frame: DV_CUT_FRAME, type: EVOL_EFFECT.BLAST_START, pos: EVOL_POS.ORIGIN },
    { frame: DV_WIPE_END_FRAME, type: EVOL_EFFECT.SHARED, pos: EVOL_POS.CENTRE },
    { frame: DV_WIPE_BACK_END_FRAME, type: EVOL_EFFECT.BLAST_END, pos: EVOL_POS.NEG_CENTRE },
  ]),
  [FormChangeProgram.MANUAL_DV]: Object.freeze([
    { frame: DV_CUT_FRAME, type: EVOL_EFFECT.DV_A, pos: EVOL_POS.ORIGIN },
    { frame: DV_CUT_FRAME, type: EVOL_EFFECT.DV_B, pos: EVOL_POS.ORIGIN },
    { frame: DV_WIPE_END_FRAME, type: EVOL_EFFECT.SHARED, pos: EVOL_POS.CENTRE },
    { frame: DV_WIPE_BACK_END_FRAME, type: EVOL_EFFECT.DV_END, pos: EVOL_POS.NEG_CENTRE },
  ]),
  [FormChangeProgram.BLAST_REVERT]: Object.freeze([]),
  [FormChangeProgram.ENTRANCE_ENEMY]: Object.freeze([]),
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
  [FormChangeProgram.ENTRANCE_ENEMY]: null,
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
 * child's runtime gate (a named boundary — see createTransformationSchedule). Its frames count from the
 * start of the 180-tick hold (n = 34): the presentation frame is the driver's plus 34.
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
 * The spawns due on `frame` for `program`, given the last frame already fired: the ORIGINAL's schedule
 * (EVOL_EFFECT_SCHEDULE: f0, f119, f436), the same effects the change task spawns.
 */
export function evolEffectsDue(
  program: FormChangeProgramValue, prevFrame: number, frame: number,
): EvolSpawn[] {
  const sched = EVOL_EFFECT_SCHEDULE[program] ?? [];
  return sched.filter((s) => s.frame > prevFrame && s.frame <= frame).map((s) => ({ ...s }));
}

/** One frame of any of the three form-change programs. */
export function formChangeState(
  program: FormChangeProgramValue, frame: number,
): BlastPresentationState {
  // Blast and manual DV count from the task start (n = 0); the start cut is n = 214.
  if (program === FormChangeProgram.BLAST_REVERT) return entranceState(Math.max(0, frame), 0);
  if (program === FormChangeProgram.ENTRANCE_ENEMY) return entranceState(Math.max(0, frame), 1);
  if (program === FormChangeProgram.MANUAL_DV) return manualDvState(frame);
  return blastPresentationState(frame);
}
