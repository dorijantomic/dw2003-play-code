// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

export interface BiomeGalleryState {
  /** whether the biome is shown with its anime.js dressing */
  anime: boolean;
  busy: boolean;
  /** the category the grid is filtered to, "All" for everything */
  cat: string;
  /** the opened detail view: its item and the camera the grid had */
  detail?: BiomeGalleryDetail | null;
  /** "grid" (the asset grid) or "biome" (the built scene) */
  mode: string;
  page: number;
  PAGE: number;
  spin: boolean;
  /** the tab id the gallery is on ("forest", "beach", "lake", ...) */
  tab: string;
}

/** The open detail view of one grid item, with the camera the grid had so closing it can go back. */
export interface BiomeGalleryDetail {
  /** the grid item (web/biome/gallery.ts gridItems) */
  item: any;
  saved: { maxD: number; maxP: number; minD: number; near: number; pos: any; target: any; };
}

/** Instance counts of a lake scene's species, by LOD level, plus the cull pass and reflection cost. */
export interface BiomeLakeTerrain {
  /** what the cull pass counted */
  cull?: Record<string, number>;
  /** instances only the far LOD drew */
  far: number;
  /** level 0 and level 1 instance counts */
  lod0: number;
  lod1: number;
  /** the reflector's own frame time */
  reflMs?: number;
}

/** Instance counts of a mountain scene's species, by LOD level, plus the cull pass. */
export interface BiomeMountainTerrain {
  cull?: Record<string, number>;
  far: number;
  lod0: number;
  lod1: number;
}

// ------------------------------------------------------------------ toolkit: parts, LOD, toon options
/** one drawable piece of a loaded GLB: geometry + the toon material made for it */
export interface Part {
  /** THREE.BufferGeometry: the vendored three (web/lib3d) is outside the tsconfig, so it types as any */
  geo: any;
  /** THREE.Material */
  mat: any;
}

/** one LOD level of a species: the parts of that level, or the impostor mesh factory */
export interface LODLevel {
  parts?: Part[];
  /** a THREE.InstancedMesh factory (count/frustumCulled are set on it) */
  impostor?: (count: number) => any;
}

/** painted-albedo grade: saturation multiplier + posterise amount (see toolGLSL bGrade) */
export interface ToonGrade {
  sat: number;
  post: number;
}

/** toonify() options: wind bend, flutter, distance fade, grade, tint, backlit translucency, rim */
export interface ToonOpts {
  wind?: number;
  height?: number;
  flutter?: number;
  fade?: number[] | null;
  grade?: ToonGrade | null;
  tint?: number[] | null;
  trans?: number;
  shadeK?: number;
  emissive?: number[] | null;
  rim?: number;
  hang?: boolean | number;
  moss?: number;
}

/** loadToon() options: toon look + how the GLB is fitted (height or scale, sit on the ground) */
export interface ToonLoadOpts extends Omit<ToonOpts, "grade"> {
  grade?: ToonGrade | boolean | null;   // true = GRADE_PHOTO (the painted look of photoreal albedo)
  vertexColors?: boolean;
  h?: number;
  scale?: number;
  ground?: boolean;
  double?: boolean;
}

/** MeshLambertMaterial parameters used by toonMat() */
export interface ToonMatParams {
  alphaTest?: number;
  color?: number | string;
  /** THREE.Texture */
  map?: any;
  /** THREE.Side */
  side?: any;
  opacity?: number;
  transparent?: boolean;
}

/** scatter()/bscatter() options: instance size range, tilt, vertical offset/stretch */
export interface ScatterOpts {
  scale?: number[];
  seed?: number;
  tilt?: number;
  tiltFix?: number;
  y?: number;
  yOffset?: number;
  sy?: number;
  tries?: number;
  sink?: number;
}

/** what scatter()/bscatter() hands back: packed instance matrices + the positions it took */
export interface ScatterResult {
  mats: Float32Array;
  count: number;
  pos?: number[];
}

/** species() of a biome scene: instance size range and the LOD switch distances (d0 = level 0 out, d1 = level 1 out) */
export interface SpeciesLODOpts {
  scale?: number[];
  d0?: number;
  d1?: number;
}

/** add() of a biome scene: where to scatter a species, how big, and whether to tint each instance */
export interface SpeciesAddOpts extends ScatterOpts {
  area?: number[];
  cell?: number;   // cull-chunk size in metres
  /** per-instance tint colours, [r, g, b] in 0..1 */
  colors?: number[][];
}

/** groundMaterial() options: 4-layer splat */
export interface GroundOpts {
  grade?: ToonGrade;
  tile?: number;
  tints?: number[][];
  splat?: number[];
}

/** the per-biome ground shaders add a disc mode and (beach) shader ripples */
export interface GroundDetailOpts extends GroundOpts {
  disc?: boolean;
  ripples?: number;
}

/** skyMaterial() options: gradient colours, sun side, cloud deck */
export interface SkyOpts {
  zenith?: number;
  mid?: number;
  horizon?: number;
  side?: number;
  cloud?: number;
  clouds?: boolean;
  tone?: number;
  gradient?: boolean;
}

/** waterlineify() options: shore line in object or world space, algae tint */
export interface WaterlineOpts {
  mode?: string;
  level?: number;
  algae?: number[];
}

// ------------------------------------------------------------------ mountain / beach procedural option bags
/** weather() options: snow dust above snowAlt, lichen patches */
export interface WeatherOpts {
  snow?: number;
  snowAlt?: number;
  lichen?: number;
}

/** mountainGround() options: ground splat + the snow and tree lines of the massif */
export interface MountainGroundOpts extends GroundOpts {
  snowline?: number;
  treeline?: number;
}

/** cloudDeck() options: heights, size, near/far fade, coverage */
export interface CloudDeckOpts {
  y?: number[];
  size?: number;
  col?: number[];
  shade?: number[];
  near?: number;
  far?: number;
  cover?: number;
  scale?: number;
  fixed?: number[];
  name?: string;
}

/** snowPoints() options: count, box size, crest list, sprite scale and life */
export interface SnowPointsOpts {
  seed?: number;
  n?: number;
  crests?: number[][];
  centre?: number[];
  radius?: number;
  box?: number;
  scale?: number;
  life?: number;
  speed?: number;
}
