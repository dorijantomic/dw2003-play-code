// Types only: the shapes the converted battle-3D code creates empty and fills in (see
// tools/rewrite/add-types.mjs). Nothing here is emitted.

import type { ActorAnimator } from "../fight/actor-animator.js";
import type { createCameraRecord } from "../fight/battle-camera.js";
import type { EffectPlayer } from "../fight/effect-player.js";
import type { FightCoordinator } from "../fight/fight-coordinator.js";
import type {
  Battle3dAABB,
  Battle3dBuffers,
  Battle3dFighter,
  Battle3dTexturePage,
} from "../battle3d/core/types.js";
import type { BattleSide, SfxPlayerContext } from "./audio.js";

// The two per-model GL buffer sets (web/battle3d/core/model.ts builds them, toon.ts and the
// renderer decorate them as they go).
export interface SkelBufs extends Battle3dBuffers {
  /** the same vertices' normals, rebuilt by toon.ts */
  nbo?: WebGLBuffer | null;
  litOn?: boolean;
  weldBuilds?: number;
  /** the posed vertex positions of the last frame (toon.ts weld / lit normals) */
  lastPos?: Float32Array;
}

// One arena/backdrop layer's GL buffers (`_arenaGroupBuf` / `_bdGroupBuf`), with the per-layer
// extras the cull and the atmosphere moon pick keep on it.
export interface ArenaGroupBuf {
  /** the layer's texture page (or its name, e.g. "floor") */
  page?: number | string;
  spinDeg: number;
  vbo: WebGLBuffer | null;
  ubo: WebGLBuffer | null;
  count: number;
  /** the layer's palette group (col, row), when its page names one */
  clut?: number[] | null;
  /** blank CLUT slot: the original only culls these away */
  degenerate?: boolean;
  /** the layer's own triangles, kept for the per-frame back-face cull */
  pos?: number[];
  /** the layer's UVs, kept for the battle atmosphere moon pick */
  uv?: number[];
  /** triangle -> the triangle whose projected sign governs it */
  cullRef?: number[] | null;
  /** the change stages' mesh rotation track (tools/extract_arenas.py ROT_KEY_PACKS) */
  rotKeys?: number[] | null;
  /** triangle -> 1 when the floor paint covers it (pano.ts _paintFloorMask) */
  paintFloor?: Uint8Array;
  /** the layer's floor/other triangle split, uploaded by the paint pass */
  paintIbo?: WebGLBuffer | null;
}

// The DNA orbs of the fusion presentation, one per core key ("A", "B").
export interface DnaOrbs {
  orbs: Record<string, { tick: number }>;
  u: number;
  dur: number;
  orbiting: boolean;
}

// The HD panorama in use (web/battle3d/core/pano.ts), with the painted floor it may gain.
export interface PanoState {
  key: string;
  id: string;
  tex: WebGLTexture | null;
  px: Battle3dTexturePage;
  /** the straight-down floor picture, tiled under the dome */
  ground: WebGLTexture | null;
  /** the painted place in 3D (depth mesh) */
  mesh: PanoMesh | null;
  missing: boolean;
  paint?: { meta: any; floor: WebGLTexture | null; } | null;
}

// One indexed mesh on the GPU (`_panoBufs`, panoDisk, panoDome).
export interface GlMesh {
  vbo: WebGLBuffer | null;
  ubo: WebGLBuffer | null;
  ibo: WebGLBuffer | null;
  indexCount: number;
}

// The painted place's depth mesh (`_panoMeshBuild`): the dome pass draws it, probePanoGround reads it.
export interface PanoMesh extends GlMesh {
  /** the mesh's own vertex positions, render space */
  pos: Float32Array;
  /** the mesh's triangle indices */
  idx: number[];
  /** quads dropped as tears across a depth jump */
  torn: number;
  /** render units per depth metre */
  scale: number;
}

// The four `makeQuadBuffers` sets (floor, sky, viewer grid, a projectile layer).
export interface QuadBuffers {
  vbo: WebGLBuffer | null;
  ubo: WebGLBuffer | null;
  ibo: WebGLBuffer | null;
  count: number;
}

// The full-screen texture pipeline (texProg + every uniform texP names).
export interface TexProgram {
  program: WebGLProgram | null;
  aPos: number;
  aUV: number;
  aNormal: number;
  uMVP: WebGLUniformLocation | null;
  uTex: WebGLUniformLocation | null;
  uAlpha: WebGLUniformLocation | null;
  uTint: WebGLUniformLocation | null;
  uGradeSub: WebGLUniformLocation | null;
  uFogCol: WebGLUniformLocation | null;
  uFogP: WebGLUniformLocation | null;
  uSkyM: WebGLUniformLocation | null;
  uSky: WebGLUniformLocation | null;
  uEye: WebGLUniformLocation | null;
  uMoonDir: WebGLUniformLocation | null;
  uWater: WebGLUniformLocation | null;
  uSoftA: WebGLUniformLocation | null;
  // SCENE-LIGHT-BEGIN (Arena Viewer built look only)
  uSLOn: WebGLUniformLocation | null;
  uSLDir: WebGLUniformLocation | null;
  uSLCol: WebGLUniformLocation | null;
  uSLAmb: WebGLUniformLocation | null;
  // TOON-BEGIN
  uToon: WebGLUniformLocation | null;
  uToonDir: WebGLUniformLocation | null;
  // TOON-END
}

// The flat-colour pass the battle atmosphere's weather and bolts draw with.
export interface AtmColProgram {
  program: WebGLProgram | null;
  aPos: number;
  aColor: number;
  uMVP: WebGLUniformLocation | null;
}

// The panorama dome/disk pass (pano.ts `_panoGround`).
export interface PanoGroundProgram {
  program: WebGLProgram | null;
  aPos: number;
  uMVP: WebGLUniformLocation | null;
  uTex: WebGLUniformLocation | null;
  uP: WebGLUniformLocation | null;
  uGradeSub: WebGLUniformLocation | null;
  uFogCol: WebGLUniformLocation | null;
  uFogP: WebGLUniformLocation | null;
}

// The painted-arena pass (pano.ts `_drawArenaPaint`).
export interface PanoPaintProgram {
  program: WebGLProgram | null;
  aPos: number;
  uMVP: WebGLUniformLocation | null;
  uWorld: WebGLUniformLocation | null;
  uPano: WebGLUniformLocation | null;
  uFloor: WebGLUniformLocation | null;
  uEye: WebGLUniformLocation | null;
  uHalf: WebGLUniformLocation | null;
  uMode: WebGLUniformLocation | null;
  uGradeSub: WebGLUniformLocation | null;
}

// The toon outline pass (toon.ts).
export interface ToonProgram {
  program: WebGLProgram | null;
  aPos: number;
  aUV: number;
  aNormal: number;
  uMVP: WebGLUniformLocation | null;
  uPush: WebGLUniformLocation | null;
  uTex: WebGLUniformLocation | null;
  uCol: WebGLUniformLocation | null;
}

// One loaded arena pack (`B$.arenaPacks[name]`, `loadArenaPack`).
export interface ArenaPack {
  name: string;
  /** page+CLUT key -> the PNG that group is drawn with */
  tex: Record<string, WebGLTexture | null>;
  groups: ArenaGroupBuf[] | null;
  /** "opaque", "add"...: how the pack's layers blend */
  blend: string;
}

// One loaded backdrop pack (`B$.backdropPacks[name]`).
export interface BackdropPack {
  name?: string;
  tex?: Record<string, WebGLTexture | null> | null;
  floorTex?: WebGLTexture | null;
  wallTex?: WebGLTexture | null;
  groups?: ArenaGroupBuf[] | null;
}

// One projectile's model (`B$.projCache`): one quad layer per texture page.
export interface ProjectileMesh {
  layers: { count: number; groups: any[]; }[];
  /** the pack's playback clip, null when it did not decode */
  clip: any;
}

// A storm/ash/leaves particle of the battle atmosphere (atmos.ts).
export interface AtmParticle {
  kind: number;
  p: number[];
  ph: number;
  s: number;
}

// A camera mode: the director's own sweep, the two game cameras, the tag/idle/free debug views.
export type CameraMode = "opening" | "director" | "behind" | "orbit" | "game" | "tag" | "defeat" | "free";


// A canvas that may be an OffscreenCanvas: the capture path reads it back either way.
export interface CaptureCanvas extends HTMLCanvasElement {
  convertToBlob?: (opts?: any) => Promise<any>;
}

// What createBattle3D is created with (web/battle3d.ts).
export interface Battle3DInitOptions {
  alpha?: boolean;
}

// The per-frame panorama readout (window.__panoLog).
export interface PanoLog {
  id: any;
  loaded: boolean;
  missing: boolean;
  ground: boolean;
  drawn: number;
  paint?: any;
  mesh?: any;
  eye?: any;
  feet?: any;
  heights?: any;
  xz?: any;
}


// The asset hooks the animation port calls back into (op6 effect, op10 sound, per-frame motion,
// the op5 overlay camera). A bag: every hook is optional and callers may pass their own.
export interface AnimHooks {
  onMotion?: (motion: any) => void;
  onOverlay?: (rec: any) => void;
  onCamera?: (rec: any) => void;
  onEffect?: (rec: any) => void;
  onHit?: (rec: any) => void;
  [hook: string]: any;
}

// A presentation script's own arguments plus its hooks (playPlayerScript).
export interface PlayScriptOptions extends AnimHooks {
  /** the clip table the script starts from */
  initialTable?: any;
  motionTables?: any;
  rotationBase?: number;
}

// A clip-15 item throw: which branch of the effect/sound pair, and the element the engine rolled.
export interface ThrowItemOptions {
  branch?: any;
  elementIndex?: any;
  hooks?: AnimHooks;
}

// An attack clip: `lethal` plays the death reaction (clip 3), `miss` drops the defender's recoil.
export interface AttackOptions extends AnimHooks {
  lethal?: boolean;
  miss?: boolean;
}

// setCameraMode's arbitration flag: the script's op5 owns the camera record this frame.
export interface CameraModeOptions {
  scriptOwnsCamera?: boolean;
}

// The battle-open camera actor's inputs (engine/dw3/battle-open-camera.ts `[0x100]`/`[0x104]`).
export interface BattleOpenCameraArgs {
  rand?: () => number;
  arena?: () => any;
  canned?: (side: BattleSide, index: number) => any;
}

// The panorama face capture: `ortho` = half-size of a square straight view, `far` = how deep.
export interface PanoProjectOptions {
  ortho?: number;
  far?: number;
}

// One entry of the extractor's camera placement table (assets/battle/camera_ref*.json).
export interface PlacementRecord {
  camera?: { eye?: number[]; };
  standoff?: number;
  hover?: number;
  /** the record's texture animation, when it names one */
  texture_anim?: any;
}

export type PlacementTable = Record<string, PlacementRecord>;

// giantShotFor's fit knobs.
export interface GiantShotOptions {
  fill?: number;
  hMin?: number;
  pullMax?: number;
  liftSteps?: number;
  aspect?: number;
}

// The camera record createCameraRecord keeps (cut / move / glide), read by the debug page.
export type CameraRecord = ReturnType<typeof createCameraRecord>;

export interface Battle3DContext {
  /** the slow-motion accumulator, in seconds */
  _acc?: number;
  _applyNamed?: (anim8r: ActorAnimator | null, name: string, hooks: AnimHooks) => void;
  _arenaFields?: () => number[];
  _arenaGroupBuf?: (g: any) => ArenaGroupBuf;
  _arenaScaleClear?: (want: number, pk?: ArenaPack | null) => number;
  _atmosArena?: (atm: any, world?: Float32Array, eye?: number[], look?: number[], fov?: number, aspect?: number, scale?: number) => void;
  _atmosFrame?: any;
  _atmosMoonPick?: (pk: ArenaPack | null, eye: number[], look: number[], fov: number, aspect: number, scale: number, pan?: PanoState | null) => void;
  _atmosUniforms?: (atm: any) => void;
  _atmosWaterU?: (atm: any, scale: number) => number[];
  _bdGroupBuf?: (g: any) => ArenaGroupBuf;
  _camHookFor?: (side: BattleSide) => (rawRec: any) => void;
  _capFbo?: { fb: WebGLFramebuffer | null; size: number; } | null;
  _coordWasActive?: boolean;
  _dnaSampleSprites?: () => any[];
  _drawArenaPaint?: (p: PanoState, mvp: Float32Array, world: Float32Array, atm: any) => void;
  _drawExtras?: (pv: Float32Array) => void;
  _drawPano?: (p: PanoState, bdPV: Float32Array, eye: number[], atm: any) => void;
  _drawWeather?: (pv: Float32Array, atm: any, eye: number[], look: number[]) => void;
  _enemyHooks?: (extra: any) => AnimHooks;
  _faceBoxBuffers?: (gl: WebGLRenderingContext) => any;
  _freeFaceBoxBuffers?: (gl: WebGLRenderingContext) => void;
  _fxHooks?: (side: BattleSide, extra?: any) => AnimHooks;
  _fxView?: { pv: Float32Array; w: number; h: number; playerPos: number[]; enemyPos: number[]; } | null;
  _impactContact?: (extra: any) => any;
  _layoutExtras?: () => void;
  _lerp?: (a: any, b: any, t: number) => any;
  _litNormals?: (model: any, bufs: SkelBufs) => void;
  _multiCameraShot?: () => { eye: number[]; look: number[]; fov: number; };
  _paintFloorMask?: (g: ArenaGroupBuf) => Uint8Array;
  _panoActive?: () => PanoState | null;
  _panoBufs?: (pos: Float32Array, uv: Float32Array, idx: Uint16Array) => GlMesh;
  _panoDiskBufs?: () => GlMesh;
  _panoDomeBufs?: () => GlMesh;
  _panoGround?: (bdPV: Float32Array, tex: WebGLTexture | null, atm: any) => void;
  _panoMeshBuild?: (meta: any, vals: Float32Array) => GlMesh;
  _panoTex?: (px: Battle3dTexturePage, repeat: boolean) => WebGLTexture | null;
  _panoTexel?: (p: PanoState, eye: number[], d: number) => { px: any; u: number; v: number; };
  _playerHooks?: (extra: any) => AnimHooks;
  _projectExtras?: (pv: Float32Array, W: number, H: number) => number;
  _reactionCamFor?: (side: BattleSide) => any[];
  _rockCover?: (groups: ArenaGroupBuf[], s: number, cam: any, fs: number, aspect: number) => number;
  _rotY?: (v: number[], a: number) => number[];
  _sampleEffectRecord?: (type: number, recordIndex: number, tick: number, pos: number[], loop?: boolean) => any;
  _sceneLightDraw?: (on: boolean) => void;
  _setupExtraPatches?: (f: Battle3dFighter) => void;
  _smartApply?: (base: any, p: any) => { eye: number[]; look: number[]; fov: number; };
  _smartCameraShot?: () => { eye: number[]; look: number[]; fov: number; };
  _smartJob?: any;
  _smartResult?: (job: any) => { arena: ArenaPack | null; arenaScale: number; ms: number; original: any; pick: any; };
  _smartScore?: (groups: ArenaGroupBuf[], scale: number, cam: any, fs: number, aspect: number) => number;
  _smartStep?: (job: any, n: number) => boolean;
  _smartTotal?: (m: any, p: any) => number;
  _toonBegin?: (st: any, eye: number[], look: number[]) => void;
  _toonBodies?: () => any[];
  _toonEnd?: (st: any, pv: Float32Array, proj: Float32Array, H: number) => void;
  _toonNormals?: (model: any, bufs: SkelBufs) => boolean;
  _toonState?: () => { outline: boolean; shade: boolean; };
  _toonWeld?: (model: any, bufs: SkelBufs) => void;
  _updateExtras?: (alpha: number, ARENA: number) => void;
  activeArena?: ArenaPack | null;
  activeBackdrop?: BackdropPack | null;
  addFighter?: (id: string, side: BattleSide, folder: string, dx?: number) => Promise<boolean>;
  /** the seconds of animation the models are posed at */
  animTime?: number;
  applyArenaShot?: () => any;
  ARENA_D?: number;
  ARENA_FALLBACK_ID?: number;
  ARENA_W?: number;
  ARENA_WATER?: Set<string>;
  arenaBg?: number[];
  arenaDebug?: any;
  arenaIdFor?: (mapId: number, screenId: number) => number;
  arenaLegacy?: boolean;
  arenaManifest?: any;
  arenaPacks?: Record<string, ArenaPack>;
  /** the arena's units-per-model-scale, from its geometry */
  arenaScale?: number;
  arenaStageReq?: { mapId: number; screenId: number; } | null;
  arenaTexture?: WebGLTexture | null;
  arenaTextureFor?: (pk: ArenaPack, g: ArenaGroupBuf) => WebGLTexture | null;
  arenaTint?: number[] | null;
  armDataField?: (techId: number) => void;
  armThrowBackdrop?: (sig: any) => void;
  ATM_GROUND?: number;
  ATM_HAZE_DAY?: number[];
  ATM_HAZE_NIGHT?: number[];
  ATM_HORIZON?: number;
  ATM_RAIN?: number[];
  ATM_SAND?: number[];
  ATM_SNOW?: number[];
  atmColBuf?: WebGLBuffer | null;
  atmColProg?: AtmColProgram | null;
  atmFlash?: number;
  atmLastT?: number;
  atmMoon?: { arena: string; dir: number[]; since: number; pending: boolean; pick?: any; } | null;
  atmNextBolt?: number;
  atmParts?: AtmParticle[] | null;
  atmThunderAt?: number;
  backdropEntryForSig?: (sig: any) => { pack: string | null; sound: number; };
  backdropEntryForTech?: (techId: number) => { pack: string | null; sound: number; };
  backdropManifest?: any;
  backdropPackForTech?: (techId: number) => BackdropPack | null;
  backdropPacks?: Record<string, BackdropPack>;
  BD_DELAY_MS?: number;
  BD_FALLBACK?: string;
  BD_HOLD_MS?: number;
  BD_ROT_MS?: number;
  beginOpeningCamera?: () => void;
  blastPresentationSet?: (state: any, program: any, skipped?: boolean, weak?: boolean, entrance?: any) => void;
  blastPresentationStop?: () => void;
  blastSpawnEffect?: (type: number, pos: number[]) => void;
  blastState?: any;
  blitTexturePatch?: (tex: WebGLTexture | null, page: Battle3dTexturePage | null, entry: any) => boolean;
  builtArena?: boolean;
  camAz?: number;
  camMode?: CameraMode;
  camRec?: CameraRecord | null;
  camRefLoading?: boolean;
  camRefSizes?: any;
  camScriptOwned?: boolean;
  cannedShot?: (preset: string) => any;
  cannedShotSlot?: (side: BattleSide, index: number) => any;
  canvas?: CaptureCanvas;
  captureArenaFace?: (eye: number[], look: number[], up: number[], size?: number, opts?: PanoProjectOptions) => any;
  clearFighters?: (side?: BattleSide | null) => void;
  contactEvade?: { player: boolean; enemy: boolean; };
  contactSoundType?: { player: number | null; enemy: number | null; };
  contactSoundTypeFor?: (techId: number) => number | null;
  coordinator?: FightCoordinator;
  dataFieldArmed?: boolean;
  dataFieldIsActive?: (now?: number) => boolean;
  dataFieldMotion?: (motion: any) => void;
  dataFieldOffAt?: number | null;
  dataFieldOn?: boolean;
  dataFieldOnAt?: number | null;
  dataFieldPinned?: boolean;
  defeatClock?: number;
  defeatDelta?: number;
  destroy?: () => void;
  DIGI_H?: number;
  DIGI_W?: number;
  directorHeld?: number[] | null;
  directorRetired?: boolean;
  DNA_ORB_ARCH?: number;
  DNA_ORB_CLIPS?: Record<"A" | "B", number>;
  DNA_ORB_CLUT?: Record<"A" | "B", number>;
  DNA_ORB_RADIUS?: number;
  DNA_ORB_SCALE?: Record<"A" | "B", number>;
  DNA_ORB_START_ANGLE?: Record<"A" | "B", number>;
  DNA_ORB_TICKS?: number;
  DNA_ORB_TURNS?: number;
  dnaFusionStart?: () => void;
  dnaOrbIgnite?: (key: string) => void;
  dnaOrbs?: DnaOrbs;
  dnaOrbsClear?: () => void;
  dnaOrbsPath?: (path: any, durTicks: number) => void;
  dnaPresentation?: { tick: number; fusionTick: number | null; };
  dnaPresentationStart?: () => void;
  dnaPresentationStop?: () => void;
  drawDigimonBillboard?: (gl: WebGLRenderingContext, prog: TexProgram, mvp: Float32Array, worldPos: number[], w: number, h: number, tex: WebGLTexture | null, alpha: number, tint: number[] | null, flipX: boolean) => void;
  drawShadow?: (gl: WebGLRenderingContext, prog: TexProgram, mvp: Float32Array, pos: number[], rx: number, ry: number) => void;
  drawViewerGrid?: (pv: Float32Array) => void;
  dvCam?: any;
  dvFrame?: number;
  dvHome?: () => any;
  eAABBLast?: Battle3dAABB | null;
  eBwm?: { mats: any[]; worldTrans: any[]; } | null;
  effectAssets?: { manifest: any; images: Record<string, any>; };
  effectPlayer?: EffectPlayer | null;
  enemyAnim?: string;
  enemyAnim8r?: ActorAnimator | null;
  enemyAttack?: (techId: number, opts?: AttackOptions) => any;
  enemyFolder?: string | null;
  enemyFrame?: number;
  enemyModel?: any;
  enemyPage?: Battle3dTexturePage | null;
  enemyPatches?: any;
  enemyPatchHold?: number;
  enemySkelBufs?: SkelBufs | null;
  enemyTex?: WebGLTexture | null;
  enemyVisible?: boolean;
  ensureViewerGrid?: () => void;
  entranceMotion?: { side: number; folder: string; motion: any; } | null;
  entranceMotionSet?: (side: number, folder: string, motion: any) => void;
  entranceMotionTry?: () => void;
  entranceShot?: any;
  extras?: Map<string, Battle3dFighter>;
  faceBox?: any;
  faceBoxOnScreen?: boolean;
  faceBoxSubject?: any;
  faceBoxSuppressed?: boolean;
  faceCamRect?: { x: number; y: number; w: number; h: number; };
  faceCamSpeaker?: string | null;
  fighterAction?: (id: string, clip: number) => any;
  fighterAttack?: (attId: string, defId: string, techId: number, opts?: AttackOptions) => any;
  fighterReact?: (id: string, { lethal, miss }?: { lethal?: boolean; miss?: boolean; }) => any;
  fightersBusy?: () => boolean;
  fighterScale?: any;
  fighterScreen?: Map<string, any>;
  fightersReady?: () => boolean;
  fighterTech?: (id: string, techId: number) => any;
  fighterVictory?: (id: string) => boolean;
  fittedFaceShot?: (side: string) => any;
  fittedNearCam?: any;
  floorBufs?: QuadBuffers | null;
  floorUVs?: number[][];
  floorVerts?: number[][];
  freeCamView?: any;
  freeSkelBufs?: (bufs: SkelBufs) => void;
  gameCam?: { side: number; zoom: number; height: number; fovDeg: number; };
  getAnimationReadout?: () => any;
  getAtmosphere?: () => any;
  getCameraInfo?: () => any;
  getCameraMode?: () => CameraMode;
  getFaceCamRect?: () => { x: number; y: number; w: number; h: number; };
  getFighterScreen?: (id: string) => any;
  getMultiLayout?: () => any;
  getPanorama?: () => any;
  giantCamFit?: boolean;
  giantNearCam?: boolean;
  gl?: WebGLRenderingContext | null;
  GLOBAL_SPEED?: number;
  IDENT_MVP?: Float32Array;
  idleClock?: { tick(dt: number): number; readonly frames: number; reset(): void; };
  idleDirector?: any;
  introCamPending?: boolean;
  introShot?: any;
  isolatedMode?: boolean;
  isolatedSide?: BattleSide | null;
  laneOf?: (f: Battle3dFighter) => number;
  lastAtm?: any;
  /** the frame's camera, render space (the defeat orbit's numbers too, so a check can read them) */
  lastCamInfo?: {
    eye: number[];
    look: number[];
    up?: number[];
    fovDeg?: number;
    H?: number;
    roll?: number;
    defeatYaw?: number;
    defeatDelta?: number;
    render?: any;
  } | null;
  loadArenaPack?: (packName: string) => ArenaPack | null;
  loadBackdropPack?: (packName: string) => BackdropPack | null;
  loadProjMesh?: (id: number) => void;
  lossShot?: any;
  makeIdleDirector?: () => any;
  makeOpenCamera?: () => any;
  MULTI_ARENA_MAX?: number;
  MULTI_ECHELON?: number;
  MULTI_GAP_FRAC?: number;
  MULTI_GAP_MIN?: number;
  MULTI_LANE_MIN?: number;
  MULTI_MEASURE_S?: number;
  multiCam?: boolean;
  NAMED_CLIP?: any;
  op10Map?: any;
  openCamera?: any;
  /** the sub-state the open camera's last tick dispatched on (debug readout) */
  openCameraArm?: number | null;
  openCameraGone?: boolean;
  openCameraHeld?: number[] | null;
  openClock?: { tick(dt: number): number; readonly frames: number; reset(): void; };
  opts?: Battle3DInitOptions;
  orbitClock?: number;
  pAABB?: Battle3dAABB;
  pano?: PanoState | null;
  PANO_FADE?: number[];
  PANO_FAR_M?: number;
  PANO_FLAT_M?: number;
  PANO_FLAT_R?: number[];
  PANO_GR?: number;
  PANO_IDENT?: Float32Array;
  PANO_R?: number;
  PANO_TILE?: number;
  PANO_UNIT_M?: number;
  panoDisk?: GlMesh | null;
  panoDome?: GlMesh | null;
  panoGroundProg?: PanoGroundProgram | null;
  panoLog?: PanoLog;
  panoPaintProg?: PanoPaintProgram | null;
  patchState?: (side: BattleSide) => any;
  pBwm?: { mats: any[]; worldTrans: any[]; } | null;
  placementTable?: PlacementTable | null;
  playEnemyMotion?: (motion: any) => boolean;
  playerAnim?: string;
  playerAnim8r?: ActorAnimator | null;
  playerAttack?: (techId: number, opts?: AttackOptions) => unknown;
  playerBoxBufs?: any;
  playerFolder?: string | null;
  playerFrame?: number;
  playerModel?: any;
  playerNearCamera?: () => unknown;
  playerPage?: Battle3dTexturePage | null;
  playerPatches?: any;
  playerPatchHold?: number;
  playerSkelBufs?: SkelBufs | null;
  playerTex?: WebGLTexture | null;
  playerVisible?: boolean;
  playPlayerActionClip?: (clip: number, hooks?: AnimHooks) => unknown;
  playPlayerItemUse?: (itemId: number, hooks?: AnimHooks) => unknown;
  playPlayerMotion?: (motion: unknown) => boolean;
  playPlayerScript?: (script: number, opts?: PlayScriptOptions) => unknown;
  playPlayerThrowItem?: (itemId: number, opts?: ThrowItemOptions) => unknown;
  playPlayerVictory?: () => boolean;
  preloadDigimon?: (folder: string) => Promise<boolean>;
  preloadModelProjectiles?: (actions: unknown) => void;
  probeArenaScale?: (name: string, want: number) => number | null;
  probePanoGround?: (x: number, z: number) => number | null;
  probeSmartCam?: (name: string, want?: number, scale?: number | null) => unknown;
  PROJ_BASE?: string;
  projCache?: Map<number, ProjectileMesh | "loading" | null>;
  projWorld?: (pos: number[], side: BattleSide) => number[];
  releaseActorResources?: (resources: unknown) => void;
  removeFighter?: (id: string) => void;
  render?: (dt: number) => void;
  resolveArenaStage?: () => void;
  retireIdleDirector?: () => void;
  rockCoverCache?: Map<string, number>;
  sceneLight?: { dir: any[]; colour: any[]; ambient: any[]; };
  screenOverlay?: { type: number; duration: number; t: number; } | null;
  setArenaDebug?: (d: unknown) => unknown;
  setArenaLegacy?: (on: boolean) => boolean;
  setArenaStage?: (mapId: number, screenId: number) => unknown;
  setArenaTint?: (r: number, g: number, b: number) => unknown;
  setCameraMode?: (m: CameraMode, opts?: CameraModeOptions) => void;
  setEnemyAnim?: (anim: string) => void;
  setEnemyAnimByTech?: (techId: number, hooks: AnimHooks) => unknown;
  setEnemyDigimon?: (folder: string) => void;
  setEnemyVisible?: (visible: boolean) => void;
  setFaceCamVisible?: (visible: boolean) => void;
  setFighterBaseIdle?: (side: BattleSide, low: boolean) => void;
  setFighterHurt?: (id: string, low: boolean) => void;
  setFighterLane?: (id: string, dx: number) => void;
  setFighterVisible?: (id: string, v: boolean) => void;
  setGameCamParam?: (k: string, v: number) => boolean;
  setGiantCameraFit?: (on: boolean) => unknown;
  setMultiCamera?: (on: boolean) => void;
  setPlayerAnim?: (anim: string) => void;
  setPlayerAnimByTech?: (techId: number, hooks: AnimHooks) => unknown;
  setPlayerDigimon?: (folder: string) => Promise<boolean>;
  setPlayerVisible?: (visible: boolean) => void;
  setSlowMotion?: (level: number) => { level: number; delta: number; acc: number; tickSpeed: number; };
  setupTexturePatches?: (side: BattleSide, folder: string) => void;
  sfx?: SfxPlayerContext | null;
  skyBufs?: QuadBuffers | null;
  skyTexture?: WebGLTexture | null;
  slowMoAcc?: number;
  slowMoDelta?: number;
  slowMoLevel?: number;
  slowMoTicks?: number;
  slowMoTickSpeed?: number;
  slowMoUnits?: number;
  SMART_CANDS?: unknown[];
  SMART_D?: number[];
  SMART_H?: number[];
  SMART_YAW?: number[];
  smartAt?: number;
  smartCur?: { yaw: number; h: number; d: number; };
  smartInfo?: unknown;
  smartJob?: any;
  smartKey?: string;
  smartLastClock?: number;
  smartPick?: any;
  specialLoopKey?: string | null;
  specialLoopMap?: Record<string, string>;
  specialLoopOn?: boolean;
  STEP_HZ?: number;
  SUSTAINED_LOOP_KEY?: string;
  SUSTAINED_LOOP_TYPE?: number;
  syncFaceBox?: (events: unknown) => unknown;
  syncSpecialLoop?: (active: boolean) => void;
  texP?: TexProgram | null;
  texProg?: WebGLProgram | null;
  TOON_COL?: number[];
  TOON_PX_1080?: number;
  toonLog?: { frames: number; hulls: number; welds: number; err: unknown; };
  toonProg?: ToonProgram | null;
  toonSet?: { outline: boolean; shade: boolean; };
  triggerDataField?: (techId: number, now?: number) => void;
  UP?: number[];
  victoryTable?: (model: any) => any;
  viewerGridBufs?: QuadBuffers | null;
  viewerGridTex?: WebGLTexture | null;
  viewerStudio?: boolean;
  whiteOut?: (frames?: number) => void;
  whiteTex?: WebGLTexture | null;
}
