export interface QuestSceneFall {
  bounce?: boolean;
  floor: number;
  step: number;
  v0?: number;
}

/** A placed effect: a sheet's clip dropped at a point, on one of the three draw layers. */
export interface QuestScenePlace {
  /** the clip name inside the sheet */
  clip?: string;
  kind: string;
  layer?: "entity" | "behind" | "front";
  /** the effect's name (how later steps refer to it) */
  name: string;
  scale?: number;
  /** the sheet name; defaults to the effect's own name */
  sheet: string;
  x: number;
  y: number;
}

export interface QuestSceneClip {
  clip: string;
  kind: string;
  loop?: boolean;
  name: string;
}

export interface QuestSceneFade {
  fade?: number;
  kind: string;
  name: string;
}

export interface QuestSceneShake {
  amp: number;
  decay?: boolean;
  every?: number;
  frames: number;
  kind: string;
  times?: number;
}

export interface QuestSceneWeather {
  force?: boolean;
  frames: number;
  kind: string;
  strength: number;
  weather: string;
}

export interface QuestSceneTime {
  force?: boolean;
  frames: number;
  kind: string;
  time: string;
}

export interface QuestSceneLightning {
  count: number;
  force?: boolean;
  kind: string;
}

export interface QuestSceneChase {
  frames?: number;
  kind: string;
  lose: number;
  /** the path the target runs, as [x, y] points */
  path: number[][];
  speed: number;
  /** the character chased, or the fx instance's name */
  target: number | string;
}

export interface QuestSceneGhost {
  alpha?: number;
  kind: string;
  /** the ghosted character: a character id, or "player" */
  npc: number | "player";
  off?: boolean;
  /** the #rrggbb tint the ghost is drawn in */
  tint?: string;
}

export interface QuestSceneMove {
  at?: number[];
  dir?: number;
  kind: string;
  /** where the step goes: a world point for a move, a map or screen id for a warp */
  to?: number[] | number | string | null;
}

/** A placed effect's motion: one of fall (down to a floor), slide (to a point) or rise. */
export interface QuestSceneMotion {
  fall?: QuestSceneFall;
  kind: string;
  name: string;
  /** up by `pixels` over `frames` */
  rise?: { pixels: number; frames: number; };
  slide?: { frames: number; to: number[]; };
}

/** compileScene()'s options: what a scene needs from the host to compile. */
export interface QuestSceneCompileOpts {
  /** planTogether()'s free-ground test (true when the whole segment is walkable) */
  free?: (x: number, y: number) => boolean;
  /** the game's settings object (window.__fx): the F2 switches a gated step is let in by */
  fx?: any;
  /** name -> [[x, y], ...] (or { points }), or a function of the name: the routes a { walk, path } step plays */
  paths?: Record<string, number[][] | { points: number[][]; }> | ((name: string) => number[][] | { points: number[][]; } | null);
  /** the script id the player answers to (cutscene.playerActorId: 1 or 2) */
  playerId?: number;
  /** (actorId) -> where that character stands now, or null */
  pos?: (id: number) => { x: number; y: number; } | null;
  /** the wall router (web/quest-walk.js): legs from one point to another, or null when it cannot route */
  walk?: (x0: number, y0: number, x1: number, y1: number) => number[][] | null;
}
