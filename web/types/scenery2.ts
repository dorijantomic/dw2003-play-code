// The particles, lamps and state web/scenery2.ts keeps. The scene object it draws from is SceneryScene (web/types/scenery.ts).

/** One layer of a game light's glow: source x, y, w, h on the sheet, then where it sits (dx, dy) from the light. */
export type LampLayer = [number, number, number, number, number, number];

/** A light as the game's own records (assets/data/lights.json) place it. */
export interface StageLightPoint {
  /** the sprite number in `sprites` */
  s: number;
  p: number;
  x: number;
  y: number;
  z: number;
}

/** One stage's light record. */
export interface StageLightRecord {
  lights: StageLightPoint[];
  /** per sprite: its frames, each a list of layers */
  sprites: LampLayer[][][];
}

/** A lit window or doorway found in the picture. */
export interface LampWindow { h: number; ph: number; w: number; x: number; y: number; }

/** A lamp found in the picture scan: a warm blob with a size. */
export interface PlainLamp {
  ph: number;
  rec?: false | undefined;
  size: number;
  x: number;
  y: number;
}

/** A lamp the game's own record places: its glow frames and where they hang. */
export interface GameLamp {
  /** cache key of the bloom, set on first draw */
  key?: string | undefined;
  ox: number;
  oy: number;
  per: number;
  ph: number;
  rec: true;
  size: number;
  sz: number;
  v: LampLayer[][];
  wall: boolean;
  x: number;
  y: number;
}

export type SceneryLamp = PlainLamp | GameLamp;

/** The lamps of the map, with the lit windows riding along. */
export type SceneryLampList = SceneryLamp[] & { windows?: LampWindow[] | undefined };

/** The blurred glow canvas of one light, with the numbers bloomFor() writes onto it. */
export type SceneryBloom = HTMLCanvasElement & {
  K?: number | undefined;
  col?: [number, number, number] | undefined;
  ox?: number | undefined;
  oy?: number | undefined;
};

/** A cloud shadow: a drifting group of soft patches. */
export interface SceneryCloud {
  a: number;
  parts: { dx: number; dy: number; rad: number }[];
  vx: number;
  vy: number;
  x: number;
  y: number;
}

/** A dragonfly hovering over the water. */
export interface SceneryDragonfly { col: string; hx: number; hy: number; ph: number; tx: number; ty: number; until: number; x: number; y: number; }
/** A jumping fish. */
export interface SceneryFish { born: number; dir: number; x: number; y: number; }
/** A splash ring. */
export interface SceneryRing2 { born: number; life: number; x: number; y: number; }
/** A critter darting through the grass. */
export interface SceneryCritter { born: number; col: string; hops: number; vx: number; vy: number; x: number; y: number; }
/** A puff of cold breath. */
export interface SceneryBreath { big: boolean; born: number; life: number; vx: number; x: number; y: number; }
/** A wind gust crossing the map; `front` and `s` are set once it has been advanced. */
export interface SceneryGust { born: number; front?: number | undefined; s?: number | undefined; speed: number; streaks: { l: number; o: number; y: number }[]; x0: number; }
/** A dust devil. */
export interface SceneryDevil { born: number; life: number; vx: number; vy: number; x: number; y: number; }
/** A tumbleweed. */
export interface SceneryWeed { born: number; ph: number; vx: number; x: number; y: number; }

/** The state of the map being shown. resetScenery2() creates it with id, rand and built; build() fills the rest in. */
export interface Scenery2MapState {
  built: boolean;
  clouds?: SceneryCloud[] | undefined;
  dragonflies?: SceneryDragonfly[] | undefined;
  id: number | string;
  lamps?: SceneryLampList | undefined;
  meadow?: [number, number][] | undefined;
  rand: () => number;
  sheetP?: HTMLImageElement | undefined;
  sheetS?: HTMLImageElement | undefined;
  waterPts?: [number, number][] | undefined;
  windows?: LampWindow[] | undefined;
}

/** What gustLevel() reads. */
export interface GustScene {
  camX: number;
  fx: { gusts?: boolean | undefined };
  map: { id: number | string };
  now: number;
  p: { open?: boolean | undefined };
}
