// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.
//
// The `any` that remains is the three.js objects: the project's THREE is
// web/lib3d/three.module.js, which ships no .d.ts, so its classes have no type to name here.

export interface BuiltBoulderOut {
  ao?: number[];
  buildMs: number;
  drawCalls: number;
  lumpTris?: number;
  meshes: number;
  /** the three.js meshes the boulder was built from */
  pieces: any[];
  piles: any[];
  tint?: number[];
  tris: number;
  /** the vertex count of the merged geometry */
  vertices?: number;
}

/** One placed gull: which card it draws, how many copies of it, and the numbers its flight is built on. */
export interface BuiltGull {
  card: number;
  copy: number;
  copies: number;
  cw: number;
  R: number;
  yc: number;
  y: number[];
  hs: number;
  bob: number;
  w: number;
}

export interface BuiltGullInfo {
  /** the band the flock keeps to, in metres */
  band: any;
  cardCopies: number;
  cards: number;
  count: number;
  /** how many exact keep-out tests the pass ran */
  exactTests?: number;
  gulls: BuiltGull[];
  hiddenWhy?: any;
  reach: number;
  shown: number;
  trisPerGull: number;
  /** the tunables the flock was built with (GULL, web/built/gulls.ts) */
  values: any;
}

export interface BuiltMirrorOut {
  bank?: { tris: number; r: number; h: number; colour: any; rowAbove: number; from: string; };
  boulders?: any;
  buildMs?: number;
  colour?: { lakeNear: number[]; lakeFar: number[]; bg: any; };
  group?: any;
  keepOutFightR?: number;
  keepOutTouching?: number;
  lake?: any;
  meshes?: number;
  mode?: string;
  ring?: { meshes: number; tris: number; instances: number; species: Record<string, number>; };
  treeline?: any;
  triangles?: number;
}

export interface BuiltMirrorUniforms {
  uAlpha: { value: number; };
  uAlphaK: { value: number; };
  uBandH?: { value: number; };
  uDeep: { value: number; };
  uFadeK: { value: number; };
  uFadeMax: { value: number; };
  uLakeMid: { value: any; };
  uRipple: { value: number; };
  uSkyline: { value: any; };
  uTint: { value: unknown; };
  uTintHi: { value: unknown; };
  uTintLo: { value: unknown; };
}

export interface BuiltLeafCache {
  /** the shared leaf-clump THREE.CanvasTexture */
  leafTex?: unknown;
}

export interface BuiltCoverCache {
  fcUniforms?: unknown;
}

export interface BuiltSkyState {
  cloudInst?: unknown;
  clouds: unknown;
  data: unknown;
  dispose?: () => void;
  info: unknown;
  material: unknown;
  mesh: unknown;
  noise: unknown;
  opts: unknown;
  pal?: unknown;
  rec?: unknown;
  scene: unknown;
  worldScale: unknown;
}

export interface BuiltSlotItem {
  moved?: boolean;   // stats.rebuilt: did the keep-out move this item
  stats?: unknown;       // the keep-out numbers of the pass that made the items
  attrs?: unknown;
  col?: Float32Array<ArrayBuffer>;
  grp?: Int32Array<ArrayBuffer>;
  /** one height per chosen point */
  h: Float64Array<ArrayBuffer>;
  /** the point list, one entry per placed item */
  list: any;
  m?: Float32Array<ArrayBuffer>;
  n: number;
  p: Float64Array<ArrayBuffer>;
  rad: Float64Array<ArrayBuffer>;
  yaw: Float64Array<ArrayBuffer>;
}

export interface BuiltSlotInstances {
  meshes: unknown[];
  objects: unknown[];
  update?: (cam: unknown, ms: number) => unknown;
}

export interface BuiltGeminiStats {
  anchors?: unknown[][];
  backInstances?: number;
  buildMs?: number;
  drawCalls?: number;
  frontInstances?: number;
  layoutMs: number;
  layouts: number;
  leaves: number;
  pillars: number;
  spireTris?: { front: number; back: number; verts: number; };
  textureMs?: number;
  tris?: number;
}

export interface BuiltSpiresInfo {
  buildMs?: number;
  bushes: any;
  cards: number;
  gemini?: unknown;
  geometry?: { verts: number; tris: number; };
  groups: unknown;
  islands: any;
  islandsShown?: unknown;
  keepOut?: BuiltSpiresCounts;
  measured: unknown;
  meshes: number;
  ms: number;
  nan?: number;
  problems?: string[];
  shown?: number;
  skipped: unknown;
  triangles: number;
  values: unknown;
  walls: any;
  wallsShown?: number;
}

export interface BuiltSpiresCounts {
  accepted?: number;
  ms?: number;
}

export interface BuiltWaterAssets {
  /** the two normal maps, as the uniforms read them (THREE.DataTexture) */
  a: any;
  b: any;
  /** the files that would not load */
  failed: string[];
  files: string[];
  /** files still to load */
  left: number;
  ready?: () => boolean;
}

export interface BuiltWaterReflection {
  enabled: boolean;
  lastMs: number;
  /** the wash under the lake, as a THREE.Matrix4 */
  matrix: any;
  passes: number;
  render?: (renderer: any, scene: any, camera: any, mesh: any) => void;
  /** the share of the viewport the reflection target is drawn at */
  scale: number;
  /** the target's size the last time it was rebuilt */
  size: number[];
  skipped: number;
  target: any;
  uniforms: any;
}

/** the day light written into the toon uniforms: sun direction plus the 3-stop colours */
export interface BuiltDayLight {
  dir: any;
  colour: [number, number, number];
  ambient: [number, number, number];
  bounce: [number, number, number];
  rim: [number, number, number];
  unlit: [number, number, number];
}

/** buildSand()'s info out-param: the numbers measured for the sand field */
export interface BuiltSandInfo {
  sand?: unknown;
}

/** soilMaterial()'s info out-param: the tone it fitted and the colour measurements behind it */
export interface BuiltSoilInfo {
  /** the texture's attribution line */
  credit?: string;
  measured?: unknown;
  /** what the tone fit found: the tint, the contrast, the photo mean it was fitted to */
  tone?: Record<string, unknown>;
}

/** createPost() options: the canvas to draw into and the bloom/grade settings to override */
export interface BuiltPostOpts {
  canvas?: HTMLCanvasElement;
  /** the bloom fit and the colour grade to start from */
  settings?: {
    bloom?: { threshold: number; smoothWidth: number; strength: number; levels: number; weights: number[] };
    grade?: { shadow: number[]; highlight: number[]; amount: number };
  };
}

/** the info bag the lake builder fills: what the water slot measured for the report */
export interface BuiltLakeInfo {
  water?: any;
}

/** createSlots() options: where to build, the colour fit, the saved choices and the change hook */
export interface BuiltSlotsOptions {
  /** the world the slots were chosen for */
  world: any;
  /** the THREE.Scene the slot meshes are added to */
  scene: any;
  env: any;
  colourFit?: any;
  pack?: string;
  /** the slots file: its bindings (slot id -> asset id) and when each was last set */
  file?: { bind?: Record<string, string>; at?: Record<string, number> } | null;
  choices?: any;
  fileResetAt?: number;
  onChange?: (choices?: any) => void;
}
