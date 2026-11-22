// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

/** A point or a direction in the model's pose frame. */
export type FightVec3 = [number, number, number];

/** The clearance bars one model's sampled poses gave: per collider pair ("i:j"), the tightest
 *  separation over the clip, and the floor the whole body may dip to. */
export interface FightCollisionOut {
  /** "i:j" -> the tightest clearance sampled for that pair, null when no pose separated it */
  byPair: Map<string, number | null>;
  /** the tightest bar of all the pairs */
  floor: number;
  /** poses sampled */
  frames: number;
  /** how far colliders i and j may come, null when the pair was never separated */
  pairFloor?: (i: number, j: number) => number | null;
  /** the sample count that was asked for (frames only grow past it on a longer clip) */
  samples: number;
  /** which authored window the samples came from */
  source: string;
}

/** One move cue of the action stream (action-vm.ts): a slide to a spot, or back home, or to the contact point. */
export type FightMoveRec = { kind: "to"; x: number; y: number; z: number; tween: number; } | { kind: "home" | "contact"; tween: number; };

/** The hooks an action run reports back: a bone moved or turned this tick, the script switched table, a hit landed, the camera cue (setAction/setScript take them). */
export interface FightActionHooks {
  onMove?: (rec: FightMoveRec) => void;
  onRotate?: (rec: { x: number; y: number; z: number; }) => void;
  onMotion?: (motion: number) => void;
  onHit?: (hit: { type: number; words: number[]; }) => void;
  onAuxAction?: (aux: { mode: number; }) => void;
  onCamera?: (cue: { words: number[]; }) => void;
  setLunge?: (lunged: boolean) => void;
}

/** The knobs the motion-swap judge takes: the numbers of the target's own idle (precomputed), the bars to judge against, the slots to measure. */
export interface SwapJudgeOpts {
  own?: any;
  bars?: any;
  ownIdle?: { pen?: number; ankle?: number; step?: number; } | null;
  slots?: number[] | null;
  samples?: number;
  penFrames?: number;
}

/** The numbers a swap bake is judged on (measureSwap), plus the fill-only figures judgeFill adds afterwards. */
export interface SwapNumbers {
  covered?: number;
  step?: number;
  ankle?: number;
  groundBelow?: number;
  groundAbove?: number;
  pen?: number;
  speed?: number;
  motion?: number;
  hand?: number;
  energy?: number;
  frames?: number;
  range?: any[];
  table?: number | null;
  startRest?: number | null;
  endRest?: number | null;
  restIdle?: number | null;
  idleRange?: { pen: number | null; ankle: number | null; step: number | null; };
}

/** One DW2 motion as the generated motion file writes it: per-bone rotation keys (ch2), optional root translation (ch1), the playlist the keys play on. The swap gate adds `used` to the motions it passed. */
export interface Dw2Motion {
  /** bone index -> that bone's rotation keys: [frame, x, y, z, terminator] rows */
  keys?: Record<string, number[][]>;
  /** the root translation keys: one array for a v1 file, per-bone arrays for a v2 bake */
  ch1?: number[][] | Record<string | number, number[][]>;
  /** the motion's playlist entries (the table the keys hang on) */
  playlist?: any[];
  table?: number;
  kind?: string;
  lo?: number;
  hi?: number;
  /** v1 files: the bone the single ch1 array belongs to */
  rootBone?: number;
  /** the playlist entry of the strike pose */
  hit?: number | null;
  letter?: string;
  /** the swap gate judged this motion worth offering (web/anim-viewer-dw2motion.ts) */
  used?: boolean;
}

/** One node of the face-box scene: what to draw, the matrix it is drawn with, and the texture/tint (the box nodes take neither). */
export interface ShotNode {
  what: string;
  mvp: string;
  tex?: string;
  tint?: number[];
}

/** What the LOADOUT tab is asked for: the body's folder, its names, its species, its anim.json and the tables the caller loaded. */
export interface LoadoutQuery {
  folder?: any;
  names?: any[];
  species?: any[];
  anim?: any;
  techTable?: any;
  skills?: any;
  sounds?: any;
}

/** One action's contact payment: the damage total, how it splits into hits, and how a hit is paid. */
export interface ContactDamageSpec {
  total?: number;
  perHit?: number;
  hits?: number;
  hp?: number | null;
  pay?: any;
}

/** What a built cast tells the launch planner: the technique it serves, whether it is a volley, the tables to read, and the release frame. */
export interface LaunchSpec {
  tech?: any;
  volley?: boolean;
  tables?: number[] | null;
  frame?: number | null;
  forceSolver?: boolean;
}

/** What launchOps is given: this model's own spell sprite, its home line, the pack's flight words and the side it was authored on. */
export interface LaunchOpsSpec {
  sprite?: any;
  homeZ?: number;
  flight?: any;
  lane?: number;
  side?: string;
}

/** A body's own clip inventory: one record per owned action slot, plus its height and its throw verdict. */
export interface OwnClipInventory {
  slots?: Record<string, OwnClipRec>;
  height?: number;
  throws?: boolean;
  throwsWhy?: string[];
}

/** What one of a body's own action clips turned out to be: its slot, the tables it plays, what it launches and hits, how it travels. */
export interface OwnClipRec {
  slot?: number;
  tables?: any[];
  launches?: any[];
  contacts?: any[];
  ramp4?: number;
  leap3?: number;
  dash8?: number;
  rootTravel?: number;
}

/** One tick's aim: the arms' wrist points, or the body bone the shot leaves from (a head/chest cast). */
export interface FightAimOffsets {
  aim: { bone: number; point: number[] } | null;
  arms: { left: number[] | null; right: number[] | null };
  head?: number;
  lean?: number;
  root?: number[];
}

export interface FightPlan {
  aimStart: number;
  apex: any;
  apexBack: number;
  apexUp: number;
  baseFrame: number;
  cls: any;
  drive: number;
  flight: number;
  floorY: any;
  follow: number;
  frames: any[];
  H: any;
  /** the hand point the class's casts measured: every member is optional (a class with no hand point falls back to rel) */
  hand: { height?: number; forward?: number; lateral?: number; source?: string | null | undefined; quantile?: string; unit?: string; };
  head: any;
  headScale?: number;
  headSites: any;
  isArm: any;
  mode: any;
  muzzleTargets: any;
  aimPoint?: any[];
  aimPoints?: any[];
  ok: true;
  origins: any;
  overshoot: any;
  rel: { height: number; forward: number; lateral: number; source: any; quantile: string; unit: string; };
  release: number;
  restTip: any;
  return: number;
  rootCap: number | null;
  setSwing?: any;
  shared: any;
  sites: any;
  size: any;
  swing: { base: number; cap: number; scale: number; };
  targets: any;
  ticks: number;
  torso: any[];
  windup: number;
  wu: any;
}

export interface FightMetrics {
  aimAfter?: any[];
  axisAim: number;
  bones: number;
  footPlant?: number;
  headHub?: boolean;
  ikClamped: number;
  jointsClamped: number;
  reachPull?: any[];
  unreachable: number;
}

export interface FightSkeleton {
  bones: any;
  timeline?: any;
}

/** A bone's baked channels: ch1 translation rows and ch2 rotation rows, [frame, x/y/z, terminator]. */
export interface FightChannels {
  ch1?: number[][];
  ch2?: number[][];
}

export interface FightGate {
  aim: boolean;
  body?: boolean;
  clearance: boolean;
  gap: boolean;
  ground: boolean;
  headPitch?: boolean;
  idle?: boolean;
  /** how far the target is above the head bar (a head cast jumps); compare with HEAD_CAST_JUMP.p90 */
  jump?: boolean;
  motion: boolean;
  reachable: boolean;
}

export interface Dw2FightCh2 {
  ch2?: number[][];
}

export interface Dw2FightCh1 {
  ch1?: number[][];
}

export interface MotionTreeContext {
  arms: any[];
  cap?: (b: any, floor: any, ceil: any) => number;
  cloud: any;
  D: number;
  ep: any;
  fN: number;
  H: number;
  head: any;
  hips: any;
  kids: any[][];
  legs: any[];
  mainRoot: any;
  model: any;
  n: unknown;
  notes: unknown[];
  order: unknown[];
  own: Map<any, any>;
  par: unknown;
  plan: unknown;
  Pr: unknown[];
  quad: boolean;
  rig: unknown;
  spine: unknown[];
  tail: unknown[];
  torso: unknown;
  upper: unknown[];
  W: number;
  wings: unknown[];
  Wr: unknown[];
}

export interface MotionBonesOut {
  bones: any;
  timeline?: any;
}
