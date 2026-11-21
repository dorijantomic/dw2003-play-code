// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.
//
// `any` in this file is almost always a THREE object (Group, Mesh, BufferGeometry, Material,
// Color): web/lib3d is a vendored plain-ES build and web/types/three.d.ts declares it as any.

import type { BuiltSlotItem } from "../types.js";

/** a colour the recipe measured: an [r, g, b] triple read off the arena's picture */
export type BuiltRgb = number[];

/** one slot a place module offers the arena: what it holds, how its meshes are named, and what a rebind returns */
export interface BuiltSlotRef {
  id: string;
  label: string;
  kind: string;
  layer: string;
  /** THREE.Object3D the slot's meshes hang under */
  parent: any;
  /** the slot's default recipe id ("mod.plant") */
  default: string;
  items: BuiltSlotItem;
  /** the parts the slot resolver bound for this slot (`parts[]` = { geo, mat }, `native` = the raw file) */
  asset?: any;
  /** the items the slot holds now */
  cur?: BuiltSlotItem;
  /** the slot's plan data (what a rebind reads) */
  data?: any;
  /** THREE.Object3D of a native (file-backed) slot */
  native?: any;
  wantsShape?: boolean;
  windShare?: number;
  placeOrder?: number;
  /** THREE.Mesh the slot's surface stands things on */
  surface?: any;
  /** THREE userData handed to the mesh */
  userData?: any;
  lodM?: number;
  lodData?: (g: number, idx: number[]) => any;
  meshName?: (...args: any[]) => string;
  meshData?: (...args: any[]) => any;
  sig?: string;
  place?: (st?: any, shape?: any) => any;
}

/** the arena ground's painted palette: the measured stops, linear, plus the sky's haze/horizon after plan() */
export interface BuiltGroundPalette {
  /** THREE.Color */
  dirt: any;
  /** THREE.Color */
  grassHi: any;
  /** THREE.Color */
  grassLo: any;
  /** THREE.Color */
  moss: any;
  /** THREE.Color */
  path: any;
  /** THREE.Color */
  rockHi: any;
  /** THREE.Color */
  rockLo: any;
  /** the recipe's own measured stops, before sRGB -> linear */
  src: { grassLo: BuiltRgb; grassHi: BuiltRgb; dirt: BuiltRgb; path: BuiltRgb; rockLo: BuiltRgb; rockHi: BuiltRgb; };
  /** THREE.Color: the sky's haze and horizon, lerped into the ground's far stops */
  haze?: any;
  /** THREE.Color */
  skyHorizon?: any;
}

export interface BuiltFloorcoverApi {
  built: boolean;
  /** the radius the cover is cleared inside */
  clearR: number;
  ferns?: { get: () => { items: any[]; mats: any[]; cols: any[]; }; };
  /** THREE.Group */
  group: any;
  sig: string;
  visible: boolean;
}

export interface BuiltFloorcoverInfo {
  buildMs: number;
  builds: number;
  clearM: number;
  drawCallsMax: number;
  /** the fern LOD's near/far fade distances */
  fernFar?: number;
  fernNear?: number;
  instances: number;
  /** the shader uniform names the cover shares with the ground */
  shared: string[];
  tris: number;
  /** per species: the recipe spec and the bound material/geometry */
  types: Record<string, { spec: unknown; mat: any; geo: any; }>;
}

export interface BuiltFoliageStats {
  accepted?: number;
  byReason?: { fight: number; cone: number; };
  candidates?: number;
  dropped?: number;
  /** one row per candidate: [species, piece, radius, status, why, seq] */
  list?: Array<[string, unknown, number, number | string, string, string]>;
  moved?: number;
  noGround?: number;
  rejectedAtRecipeSpot?: number;
  round: number;
}

export interface BuiltGroundStats {
  accepted: number;
  byReason: { fight: number; cone: number; steep: number; offGround: number; };
  candidates: number;
  dropped: number;
  fightR: number;
  /** one row per candidate boulder: [x, z, scale, "ok" | why it was dropped, how far it was pushed] */
  list: Array<[number, number, number, string, number | null]>;
  ms?: number;
  pushed: number;
  rejectedAtSpot: number;
}

/** what bakeArenaMask() reports about the bytes it baked */
export interface BuiltGroundMaskInfo {
  /** the mask's grid size and the world extent it covers */
  res: number;
  extent: number;
  texel: number;
  /** "R dirt, G rock, B path, A ao" */
  channels: string;
  groundTexels: number;
  heightMax: number;
  ms: number;
}

/** the triangle counts of the ground's four bands */
export interface BuiltGroundParts {
  ground: { tris: number; meshes: number; };
  bank: { tris: number; meshes: number; };
  rocks: { count: number; trisPerRock?: number; tris: number; };
  hills: { ribbons: number; tris: number; skipped?: string; };
}

export interface BuiltGroundInfo {
  cliff: { slopeLo: number; slopeHi: number; stepPx: number; };
  mask: BuiltGroundMaskInfo;
  ms: number;
  palette: { measured: BuiltGroundPalette["src"]; };
  parts: BuiltGroundParts;
  /** THREE.Mesh of the ground's single boulder mesh (null before the boulders are placed) */
  rocks: any;
  /** THREE.Mesh of the soil apron, when the arena has one */
  soil?: any;
  triangles: number;
}

export interface BuiltSandOut {
  blade?: { p10: BuiltRgb; p90: BuiltRgb; };
  /** the recipe's measured colours by stop name (p10 / p90 / mean) */
  colours: Record<string, BuiltRgb>;
  green?: Float32Array<ArrayBuffer>;
  kind: string;
  name: string;
  pos: Float32Array;
  row: Float32Array<ArrayBuffer>;
  /** the shore band's per-row colours, one rgb triple per picture row */
  rows?: BuiltRgb[];
  tris: number;
}

export interface BuiltSpiresStats {
  /** why a spire was dropped, and how often */
  byReason: Record<string, number>;
  dropped: number;
  farSurf: number;
  fightR: number;
  nearMin: number;
  proved: number;
  pushed: number;
  /** how many spires were re-placed after the first pass */
  rebuilt?: number;
  ringMax: number;
}
