// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

import type { ActorAnimator } from "../../fight/actor-animator.js";
import type { TexturePatchAnimator } from "../../fight/texture-patch-animator.js";

/** The world box a posed fighter covers (web/battle3d/skeleton.ts _updateSkeletalVBOGL). */
export interface Battle3dAABB {
  max: number[];
  min: number[];
}

/** A texture page decoded to pixels (web/battle3d/gl.ts loadTexturePixels). */
export interface Battle3dTexturePage {
  data: Uint8ClampedArray;
  height: number;
  scale: number;
  width: number;
}

/** The GL buffers of one skeletal model (web/battle3d/skeleton.ts buildSkeletalGLBuffers). */
export interface Battle3dBuffers {
  /** the first vertex of each bone in the posed buffer */
  boneOffsets: number[];
  ibo: WebGLBuffer | null;
  indexCount: number;
  totalVerts: number;
  ubo: WebGLBuffer | null;
  vbo: WebGLBuffer | null;
}

export interface Battle3dFighter {
  /** the world box last posed into, null until the first frame was drawn */
  aabb: Battle3dAABB | null;
  anim8r: ActorAnimator | null;
  /** the animTime the fighter appeared at, for the fade-in */
  born: number | null;
  bufs: Battle3dBuffers | null;
  /** the lateral placement as drawn */
  dx: number;
  /** the lane the fighter was put in */
  dx0: number;
  /** the lane it is easing to */
  dxT: number;
  dz: number;
  /** the model folder ("2001agnm"...) the fighter is drawn from */
  folder: string;
  /** the lane it slides along to reach the fighter it is attacking, null when it stays put */
  follow: { dx: number; dz: number; reach: number } | null;
  /** the clip frame last sampled */
  frame: number;
  /** "p3", "e1"...: the key the extras map and the screen table use */
  id: string;
  lat: number;
  latT: number;
  latz: number;
  latzT: number;
  /** the walker's skeletal model (web/battle3d/skeleton.ts loadSkeletalModel: untyped object) */
  model: any;
  /** the page the patched textures are read from */
  page?: Battle3dTexturePage | null;
  patches?: TexturePatchAnimator | null;
  /** the idle phase, so two fighters do not breathe in step */
  phase: number;
  pos: number[];
  restH?: number;
  restW: number;
  side: "player" | "enemy";
  tex: WebGLTexture | null;
  visible: boolean;
}
