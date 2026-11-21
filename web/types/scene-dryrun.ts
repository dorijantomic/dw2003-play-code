// What web/scene-dryrun.ts produces and what it is told.

/**
 * One event the scene fired: the compiled spec's own fields (kind, to, x, y, ...) ride along with the
 * three the dry run adds, so a warp's destination point is kept as x/y and `at` stays the clock.
 */
export interface SceneDryrunRecord {
  /** clock time the event fired, in seconds */
  at: number;
  /** where the event sits in the compiled stream */
  index: number;
  /** the step of the scene it belongs to (1-based) */
  step: number;
  /** what the event came to: a chase's answer, a battle's result */
  result?: number | string;
  /** a warp's destination point (the spec's own `at`) */
  x?: number;
  y?: number;
  [key: string]: any;
}

/** dryRun()'s options: the clock's steps, the cast, the ground, and how questions get answered. */
export interface SceneDryRunOpts {
  /** the step length in seconds (default 1/60 per frame budget) */
  stepSeconds?: number;
  /** a hard cap on the run */
  maxSeconds?: number;
  /** frames with nothing happening before the run is called stalled */
  stallFrames?: number;
  /** the script id the player answers to (1 or 2) */
  playerId?: number;
  /** where the player stands */
  playerAt?: { id?: number; x: number; y: number; dir?: string };
  /** the other characters the scene may move (npc_id + x, y, dir) */
  cast?: Array<{ id?: number; npc_id?: number | string; x: number; y: number; dir?: string }>;
  /** the map to take walkable ground from */
  grid?: any;
  /** route name -> [[x, y], ...] for { walk, path } steps */
  paths?: Record<string, Array<[number, number]>>;
  /** say number(s) to hold instead of answering */
  holdSay?: number | number[];
  /** event number(s) to hold instead of letting them run */
  holdEvent?: number | string | Array<number | string>;
  /** a question's answer: one number, one per say, or a function of the say number */
  answer?: number | number[] | ((n: number) => number);
  /** the answer to a chase (1 = the chase is lost) */
  chaseAnswer?: number;
}
