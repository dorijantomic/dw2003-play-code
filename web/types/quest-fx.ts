// How web/quest-fx.ts names its sheets, effects and motions.

/** The three bands an effect sorts into: with the people, behind every person, or over them. */
export type QuestFxLayer = "entity" | "behind" | "front";

/** One clip of a sheet: the cells it plays, field blanks per cell, and whether it wraps. */
export interface QuestFxClip {
  frames?: number[] | undefined;
  hold?: number | undefined;
  loop?: boolean | undefined;
}

/** A sheet's json (web/extra_fx/<name>.json). */
export interface QuestFxSheetDef {
  anchor?: number[] | undefined;
  clips?: Record<string, QuestFxClip> | undefined;
  default?: string | undefined;
  frame?: number[] | undefined;
  prefer?: string | undefined;
}

/** A loaded sheet: its json, its picture (null in a test with no art) and the cell size. */
export interface QuestFxSheet {
  def: QuestFxSheetDef;
  fh: number;
  fw: number;
  img: CanvasImageSource | null;
}

/** A `fall` motion as a scene writes it. */
export interface QuestFxFallSpec {
  bounce?: boolean | undefined;
  floor: number;
  step?: number | undefined;
  v0?: number | undefined;
}

/** A `slide` motion as a scene writes it. */
export interface QuestFxSlideSpec {
  frames?: number | undefined;
  to: number[];
}

/** A `rise` motion as a scene writes it. */
export interface QuestFxRiseSpec {
  frames?: number | undefined;
  pixels: number;
}

/** A motion handed to setMotion(): the kind and its numbers. */
export type QuestFxMotionInput =
  | ({ kind: "fall" } & QuestFxFallSpec)
  | ({ kind: "slide" } & QuestFxSlideSpec)
  | ({ kind: "rise" } & QuestFxRiseSpec);

/** A running motion. */
export type QuestFxMotion =
  | { kind: "fall"; v: number; step: number; floor: number; bounce: boolean; bounces: number }
  | { kind: "slide"; from: [number, number]; to: number[]; frames: number; done: number }
  | { kind: "rise"; frames: number; done: number; per: number };

/** The `fx` step after compileScene has resolved it. */
export interface QuestFxSpec {
  /** the step's own kind ("fx", "fxmove"...), which the effect code does not read */
  kind?: string | undefined;
  clip?: string | undefined;
  fall?: QuestFxFallSpec | undefined;
  layer?: QuestFxLayer | undefined;
  name?: string | undefined;
  rise?: QuestFxRiseSpec | undefined;
  scale?: number | undefined;
  sheet?: string | undefined;
  slide?: QuestFxSlideSpec | undefined;
  x?: number | undefined;
  y?: number | undefined;
  ysort?: number | undefined;
}

/** The `fxplay` step: an effect's name, the clip to switch to, and whether it loops. */
export interface QuestFxPlaySpec extends QuestFxSpec {
  loop?: boolean | undefined;
}

/** The `fxremove` step: the effect's name and how many blanks to fade it out over. */
export interface QuestFxRemoveSpec {
  fade?: number | undefined;
  /** the step's own kind, which the effect code does not read */
  kind?: string | undefined;
  name?: string | undefined;
}

/** The `shake` step. */
export interface QuestFxShakeSpec {
  amp?: number | undefined;
  decay?: boolean | undefined;
  every?: number | undefined;
  frames?: number | undefined;
  /** the step's own kind, which the effect code does not read */
  kind?: string | undefined;
  times?: number | undefined;
}

/** One live effect. `layer` is always one of the three once makeFx has run. */
export interface QuestFx {
  alpha: number;
  clip: string | null | undefined;
  clipDef: QuestFxClip | null;
  fadeOut: { left: number; total: number } | null;
  frameIdx: number;
  frameTicks: number;
  layer: QuestFxLayer | undefined;
  motion: QuestFxMotion | null;
  name: string;
  scale: number;
  sheet: QuestFxSheet;
  sheetName: string;
  waiters: ((settled: boolean) => void)[];
  x: number;
  y: number;
  ysort: number;
}

/** The screen fade's state. */
export interface QuestFxFade {
  alpha: number;
  speed: number;
  target: number;
  waiters: ((alpha: number) => void)[];
}

/** The running drop/rise of the player. */
export interface QuestFxDrive {
  dir: number;
  left: number;
  moved: number;
  resolve: (moved: number) => void;
  step: number;
  v: number;
}

/** The running batch of thuds. */
export interface QuestFxShake {
  amp: number;
  decay: boolean;
  every: number;
  frames: number;
  t: number;
  times: number;
  waiters: ((done: number) => void)[];
}

/** One entry of the field's draw list. */
export interface QuestFxDrawable {
  draw: () => void;
  y: number;
}
