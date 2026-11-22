// Types only: the field effects (web/effects/*) and the 3D battle renderer (web/battle3d/*).
// Nothing here is emitted, so this file must never hold runtime code.

import type { ArenaGroupBuf } from "./battle3d.js";
import type { Battle3dFighter } from "../battle3d/core/types.js";

/** One rectangle of a point sprite (assets/data/point_sprites.json `sprites[id]`). */
export interface PointSpriteLayer {
  dx: number;
  dy: number;
  /** the blend mode of its STP texels, -1 for none */
  semi: number;
  w: number;
  h: number;
  x: number;
  y: number;
}

/** One record of a stage's point table (point_sprites.json `records[i]`). */
export interface PointRecordRow {
  active: number;
  atlasFlag: number;
  size: number;
  layer: number;
  spriteId: number;
  mode: number;
  min: number;
  max: number;
  period: number;
  x: number;
  y: number;
  ysort: number;
  atlas: string;
}

/** One stage of point_sprites.json. */
export interface PointStageData {
  records: PointRecordRow[];
  sprites: Record<string, PointSpriteLayer[]>;
  hasSemi: boolean;
}

/** The live state of one point record (web/effects/point-records.ts stageRuntime). */
export interface PointRuntimeRow {
  sprite: number;
  ctr: number;
  dir: number;
  timer: number;
  /** undefined until a stage actor writes it */
  active: number | undefined;
  x: number | undefined;
  y: number | undefined;
  ysort: number | undefined;
  mode: number | undefined;
}

/** A position patch a point-record actor writes (pad flash). */
export interface ActorPositionPatch {
  x?: number | undefined;
  y?: number | undefined;
  ysort?: number | undefined;
}

/** A translated display-slot write (setPointSlot). */
export interface PointSlotWrite {
  active?: number;
  sprite?: number;
  ctr?: number;
}

/** What the character anchor finds: a live actor with a world position. */
export interface PointRecordAnchorActor {
  x: number;
  y: number;
}

/** A stage's overlay shape table (stage_overlay_shapes.json). */
export interface OverlayShapeInfo {
  resource: number;
  bucket: number;
  shift: number;
  baseX: number;
  baseY: number;
  shapes: { id: number; x: number; y: number }[];
}

/** One launch pad record (launch_pads.json `pads[i]`). */
export interface LaunchPadRecord {
  clip: number;
  enabled: boolean;
  guard: number;
  slot: number;
  x: number;
  y: number;
}

/** One stage of launch_pads.json (the parts the walker reads). */
export interface LaunchPadStageData {
  pads: LaunchPadRecord[];
  idleScript?: { entries: [number, number][] };
}

/** One wall-screen palette combo of a baked screen page ({stage}_screens.json). */
export interface ScreenCombo {
  abr: number;
  x: number;
  y: number;
}

/** One captured GPU quad (engine native runtime screenQuads). */
export interface ScreenQuad {
  texpage: number;
  clut: number;
  cmd: number;
  x: [number, number, number, number];
  y: [number, number, number, number];
  u: [number, number, number, number];
  v: [number, number, number, number];
}

/** A stage's baked screen pages. */
export interface ScreenAtlas {
  data: { sheet: string; combos: Record<string, ScreenCombo> };
  img: HTMLImageElement;
}

/** The camera rect the point-record cull tests against (map pixels). */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A record position read out of interpreter memory. */
export interface NativeRecordPos {
  x: number;
  y: number;
  ysort: number;
}

/** One frame of resolved point records (web/effects/draw.ts prepareEffects). */
export interface PreparedFrame {
  stageId: string;
  s: PointStageData;
  rt: PointRuntimeRow[];
  activeOverride: (number | null)[];
  nativePos: (NativeRecordPos | null)[];
  actorPos: (ActorPositionPatch | null)[];
  liveMode: (number | null)[];
  view: ViewRect | null;
  sheet: HTMLImageElement | "loading" | null | undefined;
  semiSheet: HTMLImageElement | "loading" | null | undefined;
}

/** One {clip, x, y} entry the stage-object draw pass resolves against the stage atlas. */
export interface StageSpriteEntry {
  clip: number | string;
  x: number;
  y: number;
  /** the palette byte submitted beside the sprite */
  ctr?: number | undefined;
}

/** One live fire-trap burst (engine startFireTrap). */
export interface FireTrapBurst {
  x: number;
  y: number;
  sprites: (number | null | undefined)[];
}

/** The live fire-trap (state.fireTrap): what the draw pass reads. */
export interface FireTrapState {
  run: { bursts: FireTrapBurst[] };
  cfg: { layers: { ysortDy?: number | undefined }[] };
}

/** The pad launch the controller is running (engine stepLaunch state): what the pad draw reads. */
export interface LaunchPadState {
  padIdleReset: boolean;
  padOriginX: number;
  padOriginY: number;
  padClip: number;
}

/** One shape request of the resident 2D draw-context service. */
export interface AnnotatorRequest {
  shape: number | string;
  clutRow?: number | undefined;
  x: number;
  y: number;
}

/** One frame of the battle atmosphere numbers (web/battle3d/core/atmos.ts _atmosFrame). */
export interface AtmFrame {
  rain: number;
  snow: number;
  sand: number;
  night: number;
  dt: number;
  camDist: number;
  gradeSub: number[];
  fogCol: number[];
  fogP: number[];
}

/** A texture page decoded to pixels, as loadTexturePixels hands it back. */
export interface PixelPage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  scale: number;
}

/** A point or direction in render space. */
export type Vec3 = [number, number, number];

/** A battle camera shot (render space). */
export interface CamShot {
  eye: Vec3;
  look: Vec3;
  fov: number;
}

/** One smart-camera candidate spot: yaw in degrees, height and distance as multiples. */
export interface SmartPick {
  yaw: number;
  h: number;
  d: number;
}

/** How a candidate spot scored (all 0..1). */
export interface SmartScore {
  cover: number;
  onFighters: number;
  offscreen: number;
}

/** A scored candidate. */
export interface SmartCand {
  p: SmartPick;
  m: SmartScore;
  s: number;
}

/** The smart camera's multi-frame pick (smartcam.ts _smartJob). */
export interface SmartJob {
  base: CamShot;
  fs: Battle3dFighter[];
  groups: ArenaGroupBuf[];
  scale: number | undefined;
  aspect: number;
  name: string;
  i: number;
  ms: number;
  def: SmartCand | null;
  best: SmartCand | null;
}

/** The part of a skeletal model the toon pass reads: each bone's triangle corners. */
export interface ToonModel {
  bones: { faces?: number[][] }[];
}

/** Which toon passes are on (web/battle3d/core/toon.ts _toonState). */
export interface ToonState {
  outline: boolean;
  shade: boolean;
}

/** One group of an arena or backdrop pack's geometry.json (pre-GL: plain number arrays). */
export interface ArenaGeometryGroup {
  page: number | string;
  spinDeg?: number;
  pos: number[];
  uv: number[];
  clut?: number[] | null;
  degenerate?: boolean;
  cullRef?: number[] | null;
  rotKeys?: number[] | null;
}

/** One draw group of a projectile mesh layer (model.ts loadProjMesh). */
export interface ProjDrawGroup {
  vbo: WebGLBuffer | null;
  ubo: WebGLBuffer | null;
  count: number;
  abr: number | null;
  /** true once the atlas is loaded (loadTexture hands back a placeholder at first) */
  texReady: boolean;
  tex: WebGLTexture | null;
}

/** An op6 projectile record the action VM hands to setLunge. */
export interface LungeRecord {
  id?: number;
  words?: number[];
  sub: number;
  from?: number[];
  to?: number[];
}
