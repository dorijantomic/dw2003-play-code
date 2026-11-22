// How web/scenery.ts and web/scenery2.ts read the one scene object web/ambience.ts hands them,
// and the particles each layer keeps.

/** A colour as red, green, blue. */
export type SceneryRgb = [number, number, number];

/** One keyframe of the day cycle: the phase and the multiply colour. */
export type SceneryTodKey = [number, SceneryRgb];

/** The effect switches the scenery layers read (a subset of the Effects settings). */
export interface SceneryFx {
  birds?: boolean | undefined;
  breath?: boolean | undefined;
  butterflies?: boolean | undefined;
  clouds?: boolean | undefined;
  critters?: boolean | undefined;
  devils?: boolean | undefined;
  dragonflies?: boolean | undefined;
  fish?: boolean | undefined;
  fog?: boolean | undefined;
  frost?: boolean | undefined;
  gusts?: boolean | undefined;
  heat?: boolean | undefined;
  indoor?: boolean | undefined;
  lamps?: boolean | undefined;
  lightning?: boolean | undefined;
  lightpool?: boolean | undefined;
  lightreveal?: boolean | undefined;
  pollen?: boolean | undefined;
  puddles?: boolean | undefined;
  rain?: boolean | undefined;
  rainwater?: boolean | undefined;
  shafts?: boolean | undefined;
  sparkle?: boolean | undefined;
  steps?: boolean | undefined;
  tod?: boolean | undefined;
  wildlife?: boolean | undefined;
}

/** What the scenery layers read of the map's profile. */
export interface SceneryProfile {
  birds?: boolean | undefined;
  butterflies?: boolean | undefined;
  clouds?: boolean | undefined;
  devils?: boolean | undefined;
  fog?: boolean | undefined;
  fogK?: number | undefined;
  heat?: boolean | undefined;
  indoorK?: number | undefined;
  indoorLit?: boolean | undefined;
  lamps?: boolean | undefined;
  night?: boolean | undefined;
  open?: boolean | undefined;
  pollen?: boolean | undefined;
  rainy?: boolean | undefined;
  sandy?: boolean | undefined;
  seed: number;
  shafts?: boolean | undefined;
  snowy?: boolean | undefined;
  tod?: boolean | undefined;
}

/** How strongly each weather is blowing, 0..1. */
export interface SceneryLevels {
  blizzard: number;
  rain: number;
  sand: number;
}

/** The map being shown. */
export interface SceneryMap {
  id: number | string;
  name: string;
}

/** The map picture's pixels, read once. */
export interface SceneryPixels {
  data: Uint8ClampedArray;
  h: number;
  w: number;
}

/** The map's collision grid: one cell is 0 when walkable. */
export interface SceneryGrid {
  cell: number;
  cells: number[];
  cols: number;
  rows: number;
}

/** One body on the map. */
export interface SceneryFoot {
  id: string;
  leader?: boolean | undefined;
  moving?: boolean | undefined;
  x: number;
  y: number;
}

/** The world's size, for resetScenery(). */
export interface SceneryDimensions {
  DH: number;
  DHB: number;
  DW: number;
  DWB: number;
}

/** The one reusable scene object web/ambience.ts fills each frame (its AmbienceScene). */
export interface SceneryScene extends SceneryDimensions {
  L: SceneryLevels;
  Q: number;
  camX: number;
  camY: number;
  dir: string;
  dt: number;
  fade: number;
  feet: SceneryFoot[];
  fx: SceneryFx;
  grid: () => SceneryGrid | null;
  isWater: (x: number, y: number) => boolean;
  map: SceneryMap;
  moving: boolean;
  now: number;
  onStep: (type: string, vol: number) => void;
  onThunder: (ms: number) => void;
  p: SceneryProfile;
  pix: () => SceneryPixels | null;
  pixMap: () => SceneryPixels | null;
  t: number;
  waterStage: () => boolean;
  waterTest: () => (r: number, g: number, b: number) => boolean;
  wind: number;
  wrapRange: (v: number, period: number, margin: number) => number;
  wrapX: (x: number, cam: number) => number;
  wrapXB: (x: number, cam: number) => number;
  wrapY: (y: number, cam: number) => number;
  wrapYB: (y: number, cam: number) => number;
}

/** The lights register here: they get the untinted frame to put true colours back around themselves. */
export interface SceneryReveal {
  draw(ctx: CanvasRenderingContext2D, snap: HTMLCanvasElement, S: SceneryScene): void;
  wants(S: SceneryScene): boolean;
}

/** A drifting fog blob. */
export interface SceneryFog { a: number; rad: number; vx: number; vy: number; x: number; y: number; }
/** A slanted light shaft. */
export interface SceneryShaft { a: number; ph: number; u: number; w: number; }
/** A pollen mote. */
export interface SceneryPollen { ph: number; s: number; vx: number; vy: number; x: number; y: number; }
/** A butterfly. */
export interface SceneryFly { ax: number; ay: number; col: string; fx: number; fy: number; ph: number; x: number; y: number; }
/** An ice glint. */
export interface SceneryGlint { ph: number; sp: number; x: number; y: number; }
/** A puddle (or frozen puddle: rot set). */
export interface SceneryPuddle { ph: number; rx: number; x: number; y: number; }
/** A frozen puddle. */
export interface SceneryIce extends SceneryPuddle { rot: number; }

/** The state of the map being shown. resetScenery() creates it with id and built, then fills fog, shafts, pollen and rand in. */
export interface SceneryMapState {
  built: boolean;
  fog?: SceneryFog[] | undefined;
  flies?: SceneryFly[] | undefined;
  ice?: SceneryIce[] | undefined;
  iceDone?: boolean | undefined;
  id: number | string;
  pollen?: SceneryPollen[] | undefined;
  puddles?: SceneryPuddle[] | undefined;
  puddlesDone?: boolean | undefined;
  rand?: (() => number) | undefined;
  shafts?: SceneryShaft[] | undefined;
  sparkles?: SceneryGlint[] | undefined;
}

/** One bird of a flock. */
export interface SceneryBird { ph: number; x: number; y: number; }
/** A flock crossing the map. */
export interface SceneryFlock { age: number; birds: SceneryBird[]; dir: number; sp: number; vy: number; }
/** A lightning flash, from the time it started. */
export interface SceneryBolt { t0: number; }
/** A footprint. */
export interface SceneryStep { a: number; born: number; c: string; life: number; x: number; y: number; }
/** A dust or snow puff. */
export interface SceneryPuff { born: number; c: string; life: number; vx: number; vy: number; x: number; y: number; }
/** A wading ripple. */
export interface SceneryRipple { born: number; life: number; x: number; y: number; }
/** A splash drop. */
export interface SceneryDrop { born: number; life: number; vx: number; vy: number; x: number; y: number; }
/** What the ground layer remembers of one body. */
export interface SceneryEnt { last: [number, number] | null; nextFoot: number; nextPuff: number; side: number; }
