/** One accessor's decoded numbers, in whichever component type the glTF entry asked for. */
export type Dw2Accessor = Float32Array | Uint32Array | Uint16Array | Int16Array | Uint8Array | Int8Array;

/** One primitive's vertex streams (TRIANGLES, non-indexed, as DW2 writes them) and its GPU buffers. */
export interface Dw2Primitive {
  pos: Dw2Accessor;
  nrm: Dw2Accessor | null;
  uv: Dw2Accessor | null;
  posIdx: number;
  count: number;
  /** index into the model's materials; -1 when the primitive names none */
  material: number;
  gpu?: {
    pos: WebGLBuffer | null;
    nrm: WebGLBuffer | null;
    uv: WebGLBuffer | null;
  };
}

/** One glTF mesh: its primitives and the bind-pose box of the first one. */
export interface Dw2Mesh {
  prims: Dw2Primitive[];
  min?: number[];
  max?: number[];
}

/** One parsed material row: the alpha mode (OPAQUE/MASK/BLEND), its cutoff, the image it samples. */
export interface Dw2Material {
  name: string | null;
  alphaMode: string;
  alphaCutoff: number;
  /** the disc's own BLEND_MODE extra */
  blendMode: number | null;
  /** index into the file's textures */
  tex: number | null;
  /** index into the model's images */
  image: number | null;
  baseColor: number[] | null;
}

export interface Dw2Image {
  name: string | null;
  uri: string | null;
  width?: number;
  height?: number;
}

/** One animated node channel: its keys and the values they drive. */
export interface Dw2Channel {
  node: number;
  path: string;
  comps: number;
  interp: string;
  times: Float32Array;
  values: Dw2Accessor;
}

/** One clip: the disc's channel layout with the names and masks kept alongside. */
export interface Dw2Clip {
  index: number;
  name: string;
  loopMask: number | null;
  termMask: number | null;
  channels: Dw2Channel[];
  /** the clip's length in seconds, summed from the last key of every channel */
  dur?: number;
}

/** One draw the renderer issues: a node with one primitive, its blend mode and its texture. */
export interface Dw2Draw {
  node: number;
  prim: Dw2Primitive;
  blend: boolean;
  alphaCut: number;
  tex: WebGLTexture | null;
}

/** What modelStats() reports about a parsed model. */
export interface Dw2ModelStats {
  gen: string;
  nodes: number;
  meshes: number;
  prims: number;
  tris: number;
  verts: number;
  materials: number;
  textured: number;
  images: number;
  clips: number;
  /** how many draws loadModel uploaded */
  draws?: number;
  /** the uploaded textures' sizes, space separated */
  textureSizes?: string;
}

export interface Dw2Pose {
  model: Dw2LoadedModel;
  /** node count */
  n: number;
  r: Float32Array<ArrayBuffer>;
  s: Float32Array<ArrayBuffer>;
  t: Float32Array<ArrayBuffer>;
  world?: Float32Array<ArrayBuffer>;
}

/** The world-space box of a posed model, as poseBounds writes it into the object it was handed. */
export interface PoseBounds {
  min?: number[];
  max?: number[];
  center?: number[];
  size?: number[];
}

/** A parsed model after loadModel attached what the renderer uploads (url, stats, textures, draws). */
export interface Dw2LoadedModel {
  /** the glTF's own JSON; the file format is the vendor's, so it stays loose here */
  json: any;
  /** one decoded buffer per glTF buffer, in file order */
  buffers: Uint8Array[];
  gen: string;
  /** node -> parent, -1 at a root (the glTF itself stores children only) */
  parent: Int32Array;
  roots: number[];
  accessors: Map<number, Dw2Accessor>;
  meshes: Dw2Mesh[];
  /** parsed Dw2Material rows; the upload site reads them with a `|| {}` fallback, so the array stays loose */
  materials: any[];
  images: Dw2Image[];
  anims: Dw2Clip[];
  /** how many textures the file names */
  texts: number;
  url?: string;
  stats?: Dw2ModelStats;
  textures?: (WebGLTexture | null)[];
  draws?: Dw2Draw[];
}
