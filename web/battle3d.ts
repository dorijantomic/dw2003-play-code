/**
 * battle3d.js — WebGL 3D skeletal renderer for DW2003 fight models.
 *
 * Implements PS1 GTE FK chain (Algorithm B, confirmed at disassembly level
 * from FIGHTSTG_F0x80085110 2026-06-18): ch1=translation, ch2=rotation,
 * ch3=scale (4096=1.0, default identity). Per-bone vertex pools with
 * LERP bridge zones at joint boundaries.
 */

"use strict";

import { ActorAnimator } from "./fight/actor-animator.js";
import { smoothAnimEnabled, setSmoothAnim, smoothFlagFromUrl } from "./fight/smooth-anim.js";
export { setSmoothAnim, smoothAnimEnabled, smoothFlagFromUrl };
import { applyOp5, fovYFromH, createCameraRecord, fieldsFromShot, applyScreenRoll, faceBoxSource, faceBoxDraws, faceBoxFovY, faceBoxScene, FACE_BOX_ASPECT, CAMERA_FRAME_DELTA } from "./fight/battle-camera.js";
import { createIdleDirector, createIdleClock, idleDirectorTick } from "./fight/battle-idle-director.js";
import { FightCoordinator } from "./fight/fight-coordinator.js";
import { setMoveSpeed } from "./fight/action-vm.js";
import { EffectPlayer, loadEffectAssets, effectLayer } from "./fight/effect-player.js";
import { drawUnderEffects } from "./fight/effect-under-gl.js";
import { setTechTable, techRecord, REACTION_HIT_CLIP, REACTION_DEATH_CLIP, REACTION_EVADE_CLIP, setItemUseEffects, itemUseEffect,
         setThrowItemEffects, throwItemEffect, setSkillTable } from "./fight/fight-tables.js";
import { setFallbackDonor } from "./fight/clip-fallback.js";
import { authoredSide, mirrorCameraWords, mirrorPresetShot } from "./fight/side-mirror.js";
import { TexturePatchAnimator } from "./fight/texture-patch-animator.js";
import { mat4Identity, mat4Mul, mat4Translate, mat4Scale, mat4RotPSX,
         projLayerWorlds, clipFrameAt, meshAbrMode } from "./fight/proj-layers.js";
import { meshPrimitiveStates } from "./fight/display-list.js";
import { loadAssetImage, assetMode } from "./assets.js";
// The slow-motion clock (engine/dw3/battle-slow-motion.ts, F0x8009e428 / F0x8009e510):
// the ordinary route now steps through the PORT, not a hand-written copy of it.
// The actor teardown (engine/dw3/battle-actor-lifecycle.ts, FIGHTSTG_F0x8008606c): the
// per-actor resource release below runs through the PORT, so the state guard and the
// per-resource zero test are the original's, not a hand-written `if (tex) delete`.
import { ui, ARENA_BASE_Z, setSlowMotion as engineSetSlowMotion, actorTeardown, ACTOR_RES_OFFSETS, ACTOR_TEARDOWN_STATE, RAND_U16, createBattleOpenCamera, formChangeCameraSchedule, entranceCameraSchedule, FormChangeProgram, changeStageBg, changeStageMotionFrame, CHANGE_STAGE_FULL } from "./vendor/engine.js";
import { createDigivolveCamera, createRevertCamera, stepFormChangeFrame, skipFormChange, DV_SHOT_INDEX, REVERT_SHOT_INDEX } from "./fight/digivolve-camera.js";
import { S } from "./battle3d/state.js";
import {
  SCENE_LIGHT_WINDING,
  arenaCullIndices,
  arenaCullLog,
  changeStageMat4,
  compileShader,
  createProgram,
  drawProjLayer,
  drawProjLayerIndexed,
  drawQuad,
  drawSkeletalMesh,
  fighterTint,
  loadTexture,
  loadTexturePixels,
  makeQuadBuffers,
  setArenaCullSign,
  setFighterTint,
} from "./battle3d/gl.js";
import {
  FRAG_COL_SRC,
  FRAG_SRC,
  TOON_HULL_FRAG_SRC,
  TOON_HULL_VERT_SRC,
  VERT_COL_SRC,
  VERT_SRC,
} from "./battle3d/shaders.js";
import {
  BATTLE_WIDE_DOLLY,
  BATTLE_WIDE_MODES,
  arenaShotFor,
  closestCameraRef,
  createFighterScaleState,
  fitGiantNearCamera,
  fitNearCamera,
  modelFrameSize,
  modelRestSize,
  nearCameraFor,
  scaledRest,
  stagingRecordsReady,
  usesGiantFit,
} from "./battle3d/camera-fit.js";
import {
  MODEL_SCALE,
  TEXTURE_PAGE_TEXELS,
  centroid3,
  cross3,
  dot3,
  mat4LookAt,
  mat4Perspective,
  mat4RotateY,
  normalize,
  ps1AnglesToMat3,
  ps1ToRender,
  ps1ToRenderMatrix,
  renderToPs1,
  sub3,
  texturePatchRect,
} from "./battle3d/math.js";
import {
  LOSS_CAM,
  OP5_PRESETS,
  PLACEMENT_URL,
  arenaSlot,
  arenaSlotFor,
  attackLateralFraction,
  attackReachZ,
  faceCamSideFor,
  lossCamYawUnits,
  modelKeyFromFolder,
  op5ShotSlot,
  reactionCamFromActions,
  rotateShotYaw,
  slowMoStep,
} from "./battle3d/camera-shots.js";
import {
  _updateSkeletalVBOGL,
  buildSkeletalGLBuffers,
  loadSkeletalModel,
  updateSkeletalVBO,
} from "./battle3d/skeleton.js";
import { buildBoneWorldMatrices, interpChannel } from "./battle3d/rotation.js";
import { makeBackdrop } from "./battle3d/core/backdrop.js";
import { makeCamera } from "./battle3d/core/camera.js";
import { makeSmartcam } from "./battle3d/core/smartcam.js";
import { makeModel } from "./battle3d/core/model.js";
import { makeToon } from "./battle3d/core/toon.js";
import { makeAnim } from "./battle3d/core/anim.js";
import { makeBlast } from "./battle3d/core/blast.js";
import { makeFighters } from "./battle3d/core/fighters.js";
import { makeAtmos } from "./battle3d/core/atmos.js";
import { makePano } from "./battle3d/core/pano.js";
import { makeRender } from "./battle3d/core/render.js";
// moved by tools/rewrite/split.mjs: still exported from here
export {
  LOSS_CAM,
  OP5_PRESETS,
  PLACEMENT_URL,
  arenaSlot,
  arenaSlotFor,
  attackLateralFraction,
  attackReachZ,
  faceCamSideFor,
  lossCamYawUnits,
  modelKeyFromFolder,
  op5ShotSlot,
  reactionCamFromActions,
  rotateShotYaw,
  slowMoStep,
} from "./battle3d/camera-shots.js";
export {
  ch2AuthoredTurnDeg,
  ch2QuatAlongSpan,
  ch2ToQuat,
  localRotationAt,
  quatSlerp,
  quatToMat3,
  smoothTimeWarp,
} from "./battle3d/rotation.js";
export { FIGHTER_TINT, fighterTint, setFighterTint } from "./battle3d/gl.js";
export {
  MODEL_SCALE,
  PS1_RENDER_SIGN,
  TEXELS_PER_PATCH_UNIT,
  TEXTURE_PAGE_TEXELS,
  ps1ToRender,
  ps1ToRenderMatrix,
  renderToPs1,
  texturePatchRect,
} from "./battle3d/math.js";
export {
  BATTLE_WIDE_DOLLY,
  FIGHTER_SCALE_MAX,
  FIGHTER_SCALE_MIN,
  GIANT_FIT_ASPECT,
  GIANT_FIT_K,
  GIANT_FIT_MIN_K,
  GIANT_FRAME_FILL,
  GIANT_H_MIN,
  GIANT_LIFT_STEPS,
  GIANT_PULL_MAX,
  arenaShotFor,
  bodyBoxCorners,
  clampFighterScale,
  closestCameraRef,
  createFighterScaleState,
  fitGiantNearCamera,
  fitNearCamera,
  giantShotFor,
  modelFrameSize,
  modelRestSize,
  nearCameraFor,
  scaledRest,
  shotBodyBounds,
  shotPointNdc,
  stagingRecordsReady,
  usesGiantFit,
} from "./battle3d/camera-fit.js";
const { createBattleFaceBox, battleFaceBoxVisible } = ui;
export { battleFaceBoxVisible };

export function setSlerpRotation(v) { S._slerpRot = !!v; }
export function slerpRotationEnabled() { return S._slerpRot; }
/** Read the scope out of a query string: `?slerp=1` turns it on. */
export function slerpFlagFromUrl(search = "") {
  try {
    const v = new URLSearchParams(search || "").get("slerp");
    return v === "1" || v === "true" || v === "on";
  } catch { return false; }
}
if (typeof window !== "undefined" && window?.location?.search) {
  if (!window.__dwInstalled && slerpFlagFromUrl(window.location.search)) S._slerpRot = true;   // the installed copy ignores the URL flag
}
if (typeof process !== "undefined" && process?.env?.ANIM_SLERP === "1") S._slerpRot = true;

// The arena base distance is the original routine's own constant, carried by the port
// (engine/dw3/battle-presentation.ts `ARENA_BASE_Z`); re-exported here for the renderer and
// its tests so the value cannot drift from the port.
export { ARENA_BASE_Z };

/**
 * The contact-marker sound substitution, read out of fightstg F0x8008c454 (the op10
 * handler, .L0x8008c4a0 / .L0x8008c4d4):
 *
 *   op10 98 (0x62) checks the per-contact record at ctx+0x58+4*[ctx+0x94];
 *   op10 99 (0x63) checks the contact's final result at ctx+0x64. When the check
 *   reads 3 — the evade result — both arms load $a0 = 0x38 (56) instead of the
 *   attack context's sound type (ctx+0x70) before falling into F0x8009b774, the
 *   packed-sound player. 0x38 is COMEX102 (0x8004413e): the cue a contact that
 *   EVADED makes, in place of the weapon's own contact sound.
 *
 * Pure and exported so the cue test can walk the resolution; the renderer's op10
 * hook calls it with the live contact state.
 */
export const CONTACT_EVADE_TYPE = 56;   // 0x38, COMEX102 0x8004413e
export function resolveContactSoundType(type, contactType, evaded) {
  if (type !== 98 && type !== 99) return type;
  return evaded ? CONTACT_EVADE_TYPE : contactType;
}

export function createBattle3D(canvas, sfx = null, opts = {}) {
  // opts.alpha (Arena Viewer "built" look only): a see-through canvas, so a three.js world drawn on another canvas
  // shows under the fighters. Every other caller keeps the opaque canvas.
  const B$ = {};
  B$.canvas = canvas;
  B$.sfx = sfx;
  B$.opts = opts;
  Object.assign(B$, makeBackdrop(B$), makeCamera(B$), makeSmartcam(B$), makeModel(B$), makeToon(B$), makeAnim(B$), makeBlast(B$), makeFighters(B$), makeAtmos(B$), makePano(B$), makeRender(B$));
  const { _dnaSampleSprites, _reactionCamFor, _setupExtraPatches, _toonState, addFighter, applyArenaShot, arenaIdFor, beginOpeningCamera, blastPresentationSet, blastPresentationStop, blastSpawnEffect, blitTexturePatch, cannedShot, captureArenaFace, clearFighters, dataFieldIsActive, destroy, dnaFusionStart, dnaOrbIgnite, dnaOrbsClear, dnaOrbsPath, dnaPresentationStart, dnaPresentationStop, enemyAttack, fighterAction, fighterAttack, fighterReact, fighterTech, fighterVictory, fightersBusy, fightersReady, getAnimationReadout, getAtmosphere, getCameraInfo, getCameraMode, getFaceCamRect, getFighterScreen, getMultiLayout, getPanorama, loadBackdropPack, loadProjMesh, patchState, playEnemyMotion, playPlayerActionClip, playPlayerItemUse, playPlayerMotion, playPlayerScript, playPlayerThrowItem, playPlayerVictory, playerAttack, preloadDigimon, probeArenaScale, probePanoGround, probeSmartCam, removeFighter, render, resolveArenaStage, setArenaDebug, setArenaLegacy, setArenaStage, setArenaTint, setCameraMode, setEnemyAnim, setEnemyAnimByTech, setEnemyDigimon, setEnemyVisible, setFaceCamVisible, setFighterBaseIdle, setFighterHurt, setFighterLane, setFighterVisible, setGameCamParam, setGiantCameraFit, setMultiCamera, setPlayerAnim, setPlayerAnimByTech, setPlayerDigimon, setPlayerVisible, setSlowMotion, setupTexturePatches, syncFaceBox, triggerDataField, whiteOut } = B$;
  B$.gl = canvas.getContext("webgl", opts.alpha
    ? { alpha: true, premultipliedAlpha: false, antialias: true } : { alpha: false, antialias: true });
  if (!B$.gl) return null;

  // Programs
  B$.texProg = createProgram(B$.gl, VERT_SRC, FRAG_SRC);
  B$.texP = {
    program: B$.texProg,
    aPos:  B$.gl.getAttribLocation(B$.texProg, "aPos"),
    aUV:   B$.gl.getAttribLocation(B$.texProg, "aUV"),
    uMVP:  B$.gl.getUniformLocation(B$.texProg, "uMVP"),
    uTex:  B$.gl.getUniformLocation(B$.texProg, "uTex"),
    uAlpha:B$.gl.getUniformLocation(B$.texProg, "uAlpha"),
    uTint: B$.gl.getUniformLocation(B$.texProg, "uTint"),
    uGradeSub: B$.gl.getUniformLocation(B$.texProg, "uGradeSub"),
    uFogCol: B$.gl.getUniformLocation(B$.texProg, "uFogCol"),
    uFogP: B$.gl.getUniformLocation(B$.texProg, "uFogP"),
    uSkyM: B$.gl.getUniformLocation(B$.texProg, "uSkyM"),
    uSky: B$.gl.getUniformLocation(B$.texProg, "uSky"),
    uEye: B$.gl.getUniformLocation(B$.texProg, "uEye"),
    uMoonDir: B$.gl.getUniformLocation(B$.texProg, "uMoonDir"),
    uWater: B$.gl.getUniformLocation(B$.texProg, "uWater"),
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
    aNormal: B$.gl.getAttribLocation(B$.texProg, "aNormal"),
    uSLOn: B$.gl.getUniformLocation(B$.texProg, "uSLOn"), uSLDir: B$.gl.getUniformLocation(B$.texProg, "uSLDir"),
    uSLCol: B$.gl.getUniformLocation(B$.texProg, "uSLCol"), uSLAmb: B$.gl.getUniformLocation(B$.texProg, "uSLAmb"),
// SCENE-LIGHT-END
// TOON-BEGIN (F2 "Toon outlines" / "Toon shading", off by default; strip these blocks = the code before toon)
    uToon: B$.gl.getUniformLocation(B$.texProg, "uToon"), uToonDir: B$.gl.getUniformLocation(B$.texProg, "uToonDir"),
// TOON-END
    uSoftA: B$.gl.getUniformLocation(B$.texProg, "uSoftA"),
  };

  // World up axis. Eye/look are computed per-frame by the cinematic camera (see render()).
  B$.UP = [0, 1, 0];
  // Giant mode part 1: per-side body scale (1 = MODEL_SCALE, as shipped). Only the battle's
  // F2-gated entry path ever sets it; until then both sides draw exactly as before.
  B$.fighterScale = createFighterScaleState();

  // Arena dimensions (world units). Large enough to read as a ground plane across the
  // deep player→enemy axis (player ~z+220, enemy ~z-360).
  // Floor extent in world units. The fighters stand at PS1 slots z=-5248/+5888
  // (× MODEL_SCALE 0.35 → z≈-1837/+2061), so the old 1400×1600 quad ended ~1200
  // units SHORT of the enemy: it stood on the void, and every camera pull-back
  // showed a horizontal black band where the floor stopped. Size the floor to
  // the real arena with generous margin (±12000 PS1 ≈ ±4200 world).
  B$.ARENA_W = 8400;
  B$.ARENA_D = 8400;

  // Digimon billboard dimensions (world units)
  // 64px wide × 256px tall at model scale. Real models are ~100-200 units tall.
  // We display at 120 units tall × 30 units wide to preserve 1:4 aspect of texture page.
  B$.DIGI_H = 140;
  B$.DIGI_W = B$.DIGI_H * (64 / 256);  // 35 — preserve page aspect ratio

  // Textures
  B$.arenaTexture = null;
  B$.skyTexture = null;
  B$.playerTex = null;
  B$.enemyTex = null;
  B$.whiteTex = null;

  // White 1×1 texture
  B$.whiteTex = B$.gl.createTexture();
  B$.gl.bindTexture(B$.gl.TEXTURE_2D, B$.whiteTex);
  B$.gl.texImage2D(B$.gl.TEXTURE_2D, 0, B$.gl.RGBA, 1, 1, 0, B$.gl.RGBA, B$.gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));

  // Arena floor static geometry
  B$.floorVerts = [
    [-B$.ARENA_W/2, 0, -B$.ARENA_D/2],
    [ B$.ARENA_W/2, 0, -B$.ARENA_D/2],
    [ B$.ARENA_W/2, 0,  B$.ARENA_D/2],
    [-B$.ARENA_W/2, 0,  B$.ARENA_D/2],
  ];
  B$.floorUVs = [[0,0],[1,0],[1,1],[0,1]];
  B$.floorBufs = makeQuadBuffers(B$.gl, B$.floorVerts, B$.floorUVs);

  // Sky background: a SCREEN-SPACE quad (clip coords, drawn with an identity MVP)
  // so the gradient covers the whole viewport from EVERY camera. The old version
  // was a world quad parked at z=-ARENA_D behind the player — the default battle
  // camera looks the other way, so the entire background rendered as the black
  // clear color ("black wall" bug). z=0.9999 keeps it behind all scene depth.
  B$.skyBufs = makeQuadBuffers(B$.gl, [
    [-1, -1, 0.9999], [1, -1, 0.9999], [1, 1, 0.9999], [-1, 1, 0.9999],
  ], [[0,0],[1,0],[1,1],[0,1]]);
  B$.IDENT_MVP = mat4Identity();

  // Arena floor texture. The old asset (assets/battle/arena/f000com1.png) was WRONG on two
  // counts: F000COM1..4 are the common EFFECT texture atlases (bursts/rings/flames — see
  // tech-effects-decode.md), not a ground texture, and it was decoded as raw 16bpp when the
  // format is 4bpp+CLUT, so it rendered as rainbow noise. So we build a clean procedural
  // ground: a soft radial gradient in the sky palette with a faint grid.
  //
  // NOT ours, and NOT a permanent truth: the disc DOES have authentic per-area arena art. The
  // developers' battle scene test (pro/wfightts.s) labels a 55-pack range MFSTG001-029 then
  // MEFT0030-0055, and against SFSTDATA i -> MEFT10<i> that reads
  //   MEFT1001-1029 = battle STAGE packs  (the per-AREA arenas: grass/snow/desert/forest/tech)
  //   MEFT1030-1055 = battle EFFECT packs (the per-ELEMENT special-attack backdrops below)
  // The 17 packs under assets/battle/backdrops/ are the EFFECTS (meft1033-1055). The STAGE
  // packs were never extracted, and the disc's per-area SELECTION rule is not yet settled, so
  // the generated floor above stands in for them. Evidence:
  // .dw3-research/playtest-battle-backdrops-2026-10-07/results.md.
  {
    const N = 128;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x / (N - 1) - 0.5) * 2, dy = (y / (N - 1) - 0.5) * 2;
        const r = Math.min(1, Math.hypot(dx, dy));
        const k = 1 - r * r;                              // bright centre, dark edges
        const grid = ((x % 4 === 0) || (y % 4 === 0)) ? 6 : 0;   // ~260 world units/cell on the 8400 floor
        const i = (y * N + x) * 4;
        data[i]   = Math.round(0x14 + (0x2e - 0x14) * k) + grid;
        data[i+1] = Math.round(0x14 + (0x30 - 0x14) * k) + grid;
        data[i+2] = Math.round(0x20 + (0x46 - 0x20) * k) + grid;
        data[i+3] = 255;
      }
    }
    B$.arenaTexture = B$.gl.createTexture();
    B$.gl.bindTexture(B$.gl.TEXTURE_2D, B$.arenaTexture);
    B$.gl.texImage2D(B$.gl.TEXTURE_2D, 0, B$.gl.RGBA, N, N, 0, B$.gl.RGBA, B$.gl.UNSIGNED_BYTE, data);
    B$.gl.texParameteri(B$.gl.TEXTURE_2D, B$.gl.TEXTURE_MIN_FILTER, B$.gl.LINEAR);
    B$.gl.texParameteri(B$.gl.TEXTURE_2D, B$.gl.TEXTURE_MAG_FILTER, B$.gl.LINEAR);
    B$.gl.texParameteri(B$.gl.TEXTURE_2D, B$.gl.TEXTURE_WRAP_S, B$.gl.CLAMP_TO_EDGE);
    B$.gl.texParameteri(B$.gl.TEXTURE_2D, B$.gl.TEXTURE_WRAP_T, B$.gl.CLAMP_TO_EDGE);
  }

  // Build a gradient sky texture (dark blue-grey → lighter) using raw pixel data
  // so it works on both regular and OffscreenCanvas WebGL contexts.
  {
    const H64 = 64;
    const skyData = new Uint8Array(H64 * 4);
    for (let i = 0; i < H64; i++) {
      const t = i / (H64 - 1);
      // #0a0a14 → #1a1a2e → #2a2a44
      skyData[i*4+0] = Math.round(t < 0.5 ? (0x0a + (0x1a - 0x0a) * t * 2) : (0x1a + (0x2a - 0x1a) * (t - 0.5) * 2));
      skyData[i*4+1] = skyData[i*4+0]; // same as R for the grey-blue tones
      skyData[i*4+2] = Math.round(t < 0.5 ? (0x14 + (0x2e - 0x14) * t * 2) : (0x2e + (0x44 - 0x2e) * (t - 0.5) * 2));
      skyData[i*4+3] = 255;
    }
    B$.skyTexture = B$.gl.createTexture();
    B$.gl.bindTexture(B$.gl.TEXTURE_2D, B$.skyTexture);
    B$.gl.texImage2D(B$.gl.TEXTURE_2D, 0, B$.gl.RGBA, 1, H64, 0, B$.gl.RGBA, B$.gl.UNSIGNED_BYTE, skyData);
    B$.gl.texParameteri(B$.gl.TEXTURE_2D, B$.gl.TEXTURE_MIN_FILTER, B$.gl.LINEAR);
    B$.gl.texParameteri(B$.gl.TEXTURE_2D, B$.gl.TEXTURE_MAG_FILTER, B$.gl.LINEAR);
    B$.gl.texParameteri(B$.gl.TEXTURE_2D, B$.gl.TEXTURE_WRAP_S, B$.gl.CLAMP_TO_EDGE);
    B$.gl.texParameteri(B$.gl.TEXTURE_2D, B$.gl.TEXTURE_WRAP_T, B$.gl.CLAMP_TO_EDGE);
  }

  // ── Special-attack per-element BACKDROP (MEFT1033-1055) ──
  // When a tech fires a special, the environment is replaced by a full-screen backdrop =
  // MEFT10<tech.sigEffect> (fallback meft1055 "data-field" when sigEffect==0). Per-element,
  // sigEffect-driven — CONFIRMED live 2026-07-07 (Inferno→meft1034 fire, Thunder Bolt→meft1045).
  // The backdrop is a 3D scene: each pack's own MESHES (wall ring + floor) drawn ADDITIVELY (abr=1)
  // through the SAME battle camera as the fighters (proven: the captured screen quads = these meshes
  // projected through the default camera). So we render each element's meshes live — no baked image,
  // no per-element capture; the geometry+textures come from tools/extract_backdrops.py. Verts are in
  // fight-model space (× MODEL_SCALE through ps1ToRenderMatrix, like op6/effect meshes). See §11-13.
  B$.BD_DELAY_MS = 850;      // windup before the backdrop replaces the arena
  B$.BD_HOLD_MS = 3800;     // sustained backdrop duration — lingers past the impact + spin
                                // (spin completes ~2 s in; hold keeps the scene a beat after the hit)
  B$.BD_FALLBACK = "meft1055";
  B$.backdropManifest = null;                 // { byTech, bySig, fallbackSig }
  B$.backdropPacks = {};                   // packName -> { floorTex, wallTex, floor:{vbo,ubo,count}, wall:{...} }
  B$.activeBackdrop = null;                  // the pack shown during the current window
  B$.dataFieldOnAt = 0;                     // performance.now() window during which it shows
  B$.dataFieldOffAt = 0;

  fetch("assets/battle/backdrops/manifest.json")
    .then(r => r.json()).then(m => { B$.backdropManifest = m; loadBackdropPack(B$.BD_FALLBACK); })
    .catch(() => { B$.backdropManifest = { byTech: {}, bySig: {} }; });

  // 121 ctrl frames @ ~60fps ≈ 2.0 s to reach the target spin, then hold (matches the cast window).
  B$.BD_ROT_MS = 121 / 60 * 1000;

          // The element loop the current backdrop owns, and whether it is running. The original
  // keeps one voice handle per effect object (+0xe4) and stops it by (id, handle) when the
  // pack tears down — so the loop is tied to the backdrop's own lifetime, not to a side.
  B$.specialLoopKey = null;
  B$.specialLoopOn = false;

  // ── When the special backdrop appears: the clip's OWN play-motion op ──
  //
  // The original does NOT put the backdrop up on a timer. It is the technique's action script
  // that selects it: the play-motion op `FIGHTSTG_F0x8008c2cc` (op4, `fightstg.s:9566`) fetches
  // the class-0x15 scene object and calls its `+0xe8` selector `FIGHTSTG_F0x800868c0`
  // (`fightstg.s:3921`) with the op's motion id; the selector rebuilds the scene from
  // `SFSTDATA[motion]` (`FIGHTSTG_F0x80086304`, `fightstg.s:3552`), i.e. `MEFT10<motion>`.
  // `fightstg.s:0x8008c364 lw $v0, 0xe8($a0)` / `:0x8008c36c jalr $v0` / `:0x8008c370 move_ $a1, $s0`.
  // A later op4 naming motion 0 (the return-to-base every attack clip ends with) re-selects the
  // area arena, so the backdrop comes back down at the clip's own final op.
  //
  // The field technique (clip 15) is `op4[1,56] / op4[0,56,15,15] / wait 90 / op4[0,0,30,30] /
  // wait 60` in every model that ships it, so its backdrop switches in at the clip's SECOND op —
  // the cast's first frame. A wall-clock windup is therefore not the original's rule and put the
  // flame backdrop at the cast's end; `armDataField`/`dataFieldMotion` below wire the op instead.
  B$.dataFieldOn = false;   // true while a clip's op4 has the element pack selected
  B$.dataFieldArmed = false;   // true while the cast in flight has an element pack at all
              // Pinned = held open past the auto-expiry window (the DNA presentation runs the
  // digital void for its whole ~25s script; runtime capture 2026-07-14 dnau_0400+).
  B$.dataFieldPinned = false;
    // ── Per-AREA battle STAGE arena (MEFT1001-1029) ──
  // The ordinary battle's environment is the disc's own per-area arena, a 3D scene of wall+floor
  // meshes drawn through the battle camera — the SAME object and pack format as the per-element
  // special backdrop, selected by the battle descriptor's arena id instead of a tech's sigEffect.
  //
  // Id source, decoded 2026-10-07: the field's battle-trigger record carries the arena id in its
  // `param` (u16 @record+0x4); fieldstg fn 0x800925a8 (random) and fn 0x800927a0 (scripted) copy
  // it to 0x80042b28, and wfightmn (:1010) builds the backdrop object from it; fightstg
  // F0x80086304 indexes SFSTDATA with it, and SFSTDATA record i -> MEFT10<i>. So the arena pack =
  // `MEFT10<param>`, 1..29. The extractor `tools/extract_arenas.py` ships the packs AND the
  // stage/screen -> arena-id table (read from each wstag overlay's own trigger records), so the
  // page only has to say which area and which encounter it is. Evidence:
  // .dw3-research/playtest-battle-arena-selector-2026-10-07/results.md.
  B$.ARENA_FALLBACK_ID = 1;
  B$.arenaManifest = null;   // { byArena: {id: {pack}}, byStage: {stage: {screen: id, _default}} }
  B$.arenaStageReq = null;   // { mapId, screenId } the page asked for
  B$.activeArena = null;   // the loaded arena pack drawn in an ordinary battle
  B$.arenaBg = null;   // the arena view's background colour (SFSTDATA +0x0c), 0..255
  B$.arenaPacks = {};     // packName -> { name, tex, groups, blend }
  B$.arenaLegacy = false;  // debug/before-after only: one palette per page + alpha blend
  // Debug switches for before/after captures. Defaults are the shipped decode: per-prim
  // palette, the ported back-face cull, the decoded OPAQUE blend, and the arena self-sorted
  // by depth (the original's ordering table — see `depthWrite` below). `cull:false` drops
  // the cull; `opaque:false` composites with alpha (the pre-decode look); `legacy:true`
  // uses the one-palette-per-page textures; `depthWrite:false` reproduces the fixed fault
  // (the arena drawn in texture-group order with no depth writes); `depthClear:false` reproduces
  // the fighter-depth regression (the arena writes depth but does NOT release it, so the fighters
  // drawn after it are depth-rejected). `depthClear` ships true — the fix — see the arena branch.
  B$.arenaDebug = { legacy: false, cull: true, opaque: true, voidRaw: false, depthWrite: true, depthClear: true };

      fetch("assets/battle/arenas/manifest.json")
    .then(r => r.json()).then(m => { B$.arenaManifest = m; resolveArenaStage(); })
    .catch(() => { B$.arenaManifest = { byArena: {}, byStage: {} }; });

              // State
  B$.playerFolder = null;
  B$.enemyFolder = null;
  B$.animTime = 0;
  B$.playerAnim = "idle";
  B$.enemyAnim = "idle";

  // Skeletal model state
  B$.playerModel = null;   // resolved anim.json or null
  B$.enemyModel = null;
  B$.playerSkelBufs = null;   // GL buffers for skeletal mesh
  B$.enemySkelBufs = null;
  // The close-up box's own position buffer (the same indices/UVs as the battle view's, its
  // own placement) plus the bone world matrices from this frame's skin pass, kept so the box
  // can reuse them. The box's subject is the player's fighter (faceBoxSource), so there is
  // one of these, not one per side.
  B$.playerBoxBufs = null;
  B$.pBwm = null;
  B$.eBwm = null;

      B$.playerFrame = 0;
  B$.enemyFrame = 0;
  B$.playerAnim8r = null;   // ActorAnimator: idle TimelinePlayer <-> action ActionVM
  B$.enemyAnim8r = null;
  B$.playerVisible = true;   // sequence 0x38 hides the outgoing actor before its prompt
  // Sequences attacker action -> defender reaction (flinch on each type-98 contact, fall/death on
  // the final type-99 strike). Owns per-tick stepping of both actors; its player/enemy refs are
  // re-synced whenever an animator is (re)created.
  B$.coordinator = new FightCoordinator(null, null);
  B$._coordWasActive = false;   // edge-detect attack end to key-off sustained battle voices

  // ── Visual effect system (op3) ─────────────────────────────────────────────
  // Decoded 2026-07-05 (docs/research/fight-3d/tech-effects-decode.md): op3 spawns registry
  // effects (eNNN pack programs over F000COM/per-model RLEN sprite sheets). The EffectPlayer
  // steps instances on the same fixed tick as the actors; battle.js composites the sprites
  // over the GL frame via getEffectDraw() (the sheets are 2D — the original draws them as
  // screen-space GPU sprites through F0x8008921c). The tech table load also feeds
  // fight-tables.techRecord (real clip + effect type per tech, replacing the range rule).
  B$.effectPlayer = null;
  B$.effectAssets = null;
  B$.screenOverlay = null; // op7 full-screen monochrome primitive (DNA result clip 12)
  fetch("assets/data/fight_tech_table.json")
    .then(r => (r.ok ? r.json() : null)).then(setTechTable).catch(() => {});
  // WHO a technique is aimed at (A9): the skills table's `type` column — heal/support are
  // self/ally casts (22 of 426 records), everything else is aimed at the opponent. Loaded here
  // because the renderer builds the presentation and must know which shape to play.
  fetch("assets/data/digimon.json")
    .then(r => (r.ok ? r.json() : null)).then(setSkillTable).catch(() => {});
  // The donor for clips a model lacks (enemy-only species): a player species with the whole set. Greymon's pack.
  fetch("assets/battle/models/m005grey/anim.json")
    .then(r => (r.ok ? r.json() : null)).then(j => setFallbackDonor(j?.actions)).catch(() => {});
  // The item machine's use-effect table (fightstg 0x800a336c, tools/extract_item_use_effects.py):
  // the used item's op3 effect type and its op10 contact sound. Feeds playPlayerItemUse below.
  fetch("assets/data/item_use_effects.json")
    .then(r => (r.ok ? r.json() : null)).then(setItemUseEffects).catch(() => {});
  // The item machine's THROW-band table (fightstg 0x80082ee4's typed arms,
  // tools/extract_throw_item_effects.py): per item 77-90 the clip, motion, effect and sound its
  // arm writes. Feeds playPlayerThrowItem below.
  fetch("assets/data/throw_item_effects.json")
    .then(r => (r.ok ? r.json() : null)).then(setThrowItemEffects).catch(() => {});
  loadEffectAssets().then(a => {
    B$.effectAssets = a;
    B$.effectPlayer = new EffectPlayer(a.manifest);
  }).catch(() => {});

  // op10 battle-sound map (type -> sfx key), built by build_sfx.py from the
  // decoded 0x800a368c table. Played on every op10 via _fxHooks (both sides).
  B$.op10Map = {};
  fetch("assets/sfx/op10_map.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { B$.op10Map = m || {}; })
    .catch(() => { B$.op10Map = {}; });

  // Per-Digimon arena placement (pro/smdldata.s, resource 0x1cc), extracted by
  // tools/extract_smdldata.py. Both fighters' slot positions come from their OWN
  // record: neither the distance nor the height is an arena constant.
  B$.placementTable = {};
  // Animated texture patches: the CPU-side page and the variant selector, per fighter.
  B$.playerPatches = null;
  B$.playerPage = null;
  B$.enemyPatches = null;
  B$.enemyPage = null;
  // What F0x8008b118 reads to decide whether to hold a fighter's eyes: the model
  // actor's +0x78, which FIGHTSTG_F0x80083a54 keeps as the playing timeline table
  // plus one. Table 0 is the idle, so an idling Digimon sits at 1 and blinks — the
  // same value F0x80083f90 writes when it creates the object. `null` = follow the
  // animator; a number is the debug hold.
  B$.playerPatchHold = null;
  B$.enemyPatchHold = null;
      fetch(`${PLACEMENT_URL}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      B$.placementTable = m?.models || {};
      // A model can finish loading before this table does; re-seat whatever is already up.
      if (B$.playerAnim8r) B$.playerAnim8r.homeSlot = arenaSlotFor(B$.playerFolder, "player", B$.placementTable);
      if (B$.enemyAnim8r)  B$.enemyAnim8r.homeSlot  = arenaSlotFor(B$.enemyFolder,  "enemy",  B$.placementTable);
      for (const f of B$.extras.values()) {   // (multiplayer fighters that loaded first)
        if (f.anim8r) f.anim8r.homeSlot = arenaSlotFor(f.folder, f.side, B$.placementTable);
        if (f.model && !f.patches) _setupExtraPatches(f);
      }
      if (B$.playerFolder && !B$.playerPatches) setupTexturePatches("player", B$.playerFolder);
      if (B$.enemyFolder && !B$.enemyPatches) setupTexturePatches("enemy", B$.enemyFolder);
      if (B$.introCamPending) applyArenaShot();
    })
    .catch(() => { B$.placementTable = {}; });

              // Our Digimon's twelve near shots. A partner has its own; an enemy-only model (no near table,
  // see nearCameraFor) gets Agumon's, fitted to its size around its own slot (fitNearCamera), so
  // it is framed the way the disc frames a partner instead of through a bigger or smaller
  // Digimon's lens. Until both models have loaded, the plain closest-stand-off table stands in.
  // The reference is the partner closest to the model in size and shape (closestCameraRef, from the measured
  // rest-pose sizes in assets/battle/camera_ref_sizes.json), so a big model borrows a big partner's framing and a
  // small one a small partner's, and the fit scale stays near 1.
  B$.camRefSizes = null;
  B$.camRefLoading = false;
  B$.fittedNearCam = null;   // { folder, cam, face, giant }
  // True while our near shots were dollyed back for a giant (fitGiantNearCamera changed one).
  // The renderer's far plane follows it: the disc's arena shots sit close and hold the enemy
  // just inside the 8k render far plane, while a giant's fitted shot is 2-3× further back (the
  // whole arena, enemy included, is further away), so the shot would otherwise be clipped.
  B$.giantNearCam = false;
  // Dev/test switch for before/after captures: OFF reproduces the page's pre-A5 framing exactly
  // (the refit is simply not run), ON is the shipped behaviour.
  B$.giantCamFit = true;
        // The opening shot is the arena shot, installed as the record: FIGHTSTG_F0x800880f0 cuts it
  // with `[0xf8]` and the camera director then holds that same record, re-publishing it every
  // frame until its dwell runs out. So it goes through the one record owner like any other cut,
  // and the idle director takes the SAME `[0x100]` provider this does, so the shot it opens
  // on and the shot its arms re-take are the one the original would read.
  B$.introCamPending = false;
    // op10 type 89 = EX_AT_LP (0x20040006), the sustained signature-attack whirl, and
  // type 91 = its stop. Held open by the explicit marker, not by a duration.
  B$.SUSTAINED_LOOP_TYPE = 89;
  B$.SUSTAINED_LOOP_KEY = "ex_at_lp";

  // Per-element special-attack loop (SFSTDATA rec[+0x08] -> fightstg 0x800a2498).
  // sound index -> sfx key (bt_loop0..7), built by build_sfx.py.
  B$.specialLoopMap = {};
  fetch("assets/sfx/special_loop_map.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { B$.specialLoopMap = m || {}; })
    .catch(() => { B$.specialLoopMap = {}; });

  // Contact op10 types 98/99 are not table entries themselves. The real game
  // rewrites them through the action context's +0x70 field:
  //   F0x8008f1a8: context+0x70 = tech+0x0f; plain clip-5 basic -> 0x1e.
  //   F0x8008c454: op10 98/99 pass context+0x70 into F0x8009b774 —
  //   unless the contact evaded, in which case the substitute is COMEX102
  //   (type 0x38 = 56; see resolveContactSoundType at the top of this file).
  B$.contactSoundType = { player: null, enemy: null };
  // The live attack's evade state, so the contact markers know which sound this
  // contact makes. Set with contactSoundType by the attack entries below; the
  // original decides per contact result, our battle knows the whole-attack miss.
  B$.contactEvade = { player: false, enemy: false };
    // ── op6 3D mesh effects (Pepper Breath fireball, Positron Laser, etc.) ─────
  // Decoded 2026-07-05/06: the MEFT 0x18 mesh body = SVECTOR verts + a GTE display list of
  // textured quads; atlas = 4bpp indexed 256×256 + embedded CLUT. Each layer additionally
  // carries a ctrl bin (fightstg F0x800835f4): keyframed translation/rotation/scale tracks
  // {frame,x,y,z} — the projectile's TRAVEL is the translation track (local z ramping across
  // the arena), oriented by the op6 root rotation (`to` angles; 180° yaw toward the enemy).
  // Extractor emits proj/{id}.json (+tracks) + per-CLUT atlas PNGs; we lazy-load per id,
  // build one static VBO per layer, and animate each layer's TRS from its tracks per frame.
  B$.projCache = new Map();   // id -> { tex, layers:[{vbo,ubo,count}] } | "loading" | null
  B$.PROJ_BASE = "assets/battle/effects/proj";
          // Projection snapshot for getEffectDraw (written each render()).
  B$._fxView = null;

  // Fixed PS1 logic tick: accumulate real dt, step the sim at STEP_HZ.
  // D0x800a4464 (the sampler's per-tick playhead step, read in FIGHTSTG_F0x80083c30) is NOT a fixed
  // animation speed: RAM dumps read it as 3 and 4 across battles (~/vm-spike/dumps; see
  // action-vm-dispatch.md §g.3), so it is a per-tick VSYNC/FRAME DELTA (frames elapsed this logic
  // update) — write-site is a vsync IRQ outside ddw3's asm. The earlier savestate "= 2" was one sample
  // of that dynamic value, NOT a constant.
  //
  // ⇒ At a steady frame rate the delta is ~1 frame/vsync, so the evidence-backed step is 1 at
  // STEP_HZ=60 ("fix A", user decision 2026-06-21): advance ONE table entry per 60 Hz tick → every
  // authored frame is drawn, no skipping. (The old GLOBAL_SPEED=2 @ STEP_HZ=30 skipped every other
  // entry — the visible frame-skip.) Sync-ramp release is delta-invariant (≈ 0x1000/speed real
  // frames), so this cadence is also correct for the op2 mode-5 waits. `let` so the Fight Action Lab
  // speed slider (debugSetSpeed) can A/B live.  The live walker uses 2 as a user-requested visual
  // preference (2026-07-17); this is deliberately not an original-game timing claim.
  B$.STEP_HZ = 60;
  // `let` (not const) so the Fight Action Lab's speed slider (debugSetSpeed) can A/B timing live.
  B$.GLOBAL_SPEED = 2;
  B$._acc = 0;

  // ── Slow motion: `[0x800a4548](level)` (F0x8009e510 / F0x8009e428) ────────────
  // The level is a global in the original, read once a frame by the stepper and published
  // to 0x800a4464 — the per-frame delta the BATTLE's animation and motion timers consume.
  // Only the loss effect's phase 0 (F0x8008c93c .L0x8008ca48-.L0x8008ca58) ever sets 2 on the
  // loss path, so this is the whole of slow motion in a battle. The camera is NOT on this
  // clock: the orbit reads `[0x8004df9c]()` directly (.L0x8008cad4), and the pointer at
  // 0x8004df9c is never swapped.
  //
  // Arming mirrors F0x8009e510: it stores the level at 0x800a453c, ZEROES the accumulator
  // (0x800a4540) and calls the stepper once, so the first frame after arming already
  // publishes (level 2 with an empty accumulator publishes 0).
  B$.slowMoLevel = 0;   // 0 = the raw frame delta, 1 = frozen, 2 = quarter, 3 = double
  B$.slowMoAcc = 0;   // the stepper's remainder, 0x800a4540
  B$.slowMoDelta = 1;   // the last value the stepper published to 0x800a4464
  B$.slowMoTickSpeed = B$.GLOBAL_SPEED;  // the GLOBAL_SPEED the last logic tick actually ran at
  B$.slowMoTicks = 0;   // logic ticks the stepper has run, and the units it has published
  B$.slowMoUnits = 0;

  // Model scale: one global units-per-PS1-unit factor applied to every model, so relative
  // sizes are preserved (bigger Digimon render bigger — "scale-aware"). The camera frames
  // each model by its actual rendered height (see render()), so big models stay in frame.
  // The constant lives at module scope so a test can project through the real mapping.

  // ── Cinematic battle camera ────────────────────────────────────────────────
  // Mirrors the PS1 battle camera (D0x80081358, built by F0x8002a1ac): a look-at that
  // rotates around the target by an angle. It always frames OUR digimon.
  //   "behind" = over-the-shoulder, looking past our digimon toward the enemy (intro/attack)
  //   "orbit"  = slow sweep around our digimon while we idle / pick a command
  //   "defeat" = the loss effect's own shot: our Digimon's canned near shot 11, orbiting
  B$.camMode = "director"; // "director" | "behind" | "orbit" | "game" | "tag" | "defeat" | "free"
  // ── FREE CAMERA (web/anim-viewer.html) ────────────────────────────────────────────────────────
  // The animation viewer draws the SAME scene through a camera it owns: an eye/look it computes
  // from its own orbit state (web/anim-viewer-camera.js). While this is set, `camMode` is "free"
  // and render() takes the view from here AFTER the camera record is resolved — so an action's
  // op5 cut, the idle director and the battle fit can never move the user's view. Null in every
  // battle page. See `setFreeCameraView` in the returned object.
  B$.freeCamView = null;
  // ISOLATED MODE: no arena, no sky, no backdrop, no battle UI (the page draws its own HUD) — a
  // neutral background plus a ground grid under the focused fighter. Off everywhere but the viewer.
  B$.isolatedMode = false;
  // Arena Viewer "built" look: the disc arena and its sky are not drawn and the frame clears see-through, so only the
  // fighters land on this canvas (web/arena-built.js draws the arena under it, with this frame's camera).
  B$.builtArena = false;
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
  // Sun / moon light on the Digimon, set only by the Arena Viewer's built look (web/built/shared.js modelLight()):
  // { dir: [x,y,z] render space toward the light, colour: lit multiplier, ambient: shade multiplier } (sRGB).
  // null (the default) = the uniform stays 0 and the shader does exactly what it always did. Normals: per corner,
  // the area-weighted face normals of every corner made from the same bone vertex, from this frame's skinned positions.
  B$.sceneLight = null;
    // SCENE-LIGHT-END
// TOON-BEGIN (F2 "Toon outlines" / "Toon shading", off by default; strip these blocks = the code before toon)
  // On when the game's F2 setting is on (window.__fx.toonoutline / .toonshade) or the Arena Viewer ticked it (setToon).
  B$.toonSet = { outline: false, shade: false };
  B$.TOON_COL = [20 / 255, 20 / 255, 20 / 255];   // #141414
  B$.TOON_PX_1080 = 2.0;                          // outline width in px at a 1080 px tall frame (scaled with the frame)
  B$.toonProg = null;
  B$.toonLog = { frames: 0, hulls: 0, welds: 0, err: null };
            // TOON-END
  B$.isolatedSide = "player";
  B$.viewerGridTex = null;
  B$.viewerGridBufs = null;
  B$.viewerStudio = true;   // false (glossary): isolated mode with no neutral background, no grid/axis lines, no floor shadow, see-through clear

  B$.camAz = 0;          // current azimuth offset from straight-behind (rad)
  B$.orbitClock = 0;          // drives the idle sweep
  // The defeat effect's own clock. F0x8008c93c adds the raw `[0x8004df9c]()` delta,
  // 1 a frame, times 2 to the shot frame's Y angle; slow motion never touches this path.
  B$.defeatDelta = 0;          // raw game delta consumed since the shot was cut
  B$.defeatClock = 0;          // seconds since the shot was cut
  // The idle director's clock, on the same footing: its dwell counter and its turn both run on
  // `[0x8004df9c]()` (fightstg.s:5149-5152 for the dwell, :5060-5072 for the turn), so the
  // seconds a render frame took are turned into the frames since the last tick here and
  // nowhere else — see createIdleClock for why that is the difference between the running total
  // and the per-frame delta.
  B$.idleClock = createIdleClock(LOSS_CAM.deltaPerFrame);
  // The 14 words the director last published while it was running (its held shot). While a script
  // owns the camera the director is NOT called, so its dwell is not spent and this record does not
  // move; the frame owner still cuts it, so the camera returns to the idle shot the moment the
  // script releases it. See the render camera block.
  B$.directorHeld = null;
  B$.pAABB = null;       // player mesh world AABB this frame (scale-aware framing)
  B$.eAABBLast = null;       // enemy mesh world AABB this frame (debug read-out only)
  B$.faceCamRect = null;       // {x,y,w,h} in offscreen px — native battle portrait viewport
  // The close-up face box is NOT a flag: it is one object of the original's battle HUD
  // (engine/dw3/ui/native/battle-face-box.ts). The HUD's build arm allocates it, a battle
  // message line's owner sends it to its terminal state, the exe's child walk frees it and
  // empties the parent's child slot, and the next build arm allocates a fresh one — which
  // is why it is up at each round's command menu and gone while a line is up. battle.js
  // hands the rule the HUD's three facts each frame through syncFaceBox.
  B$.faceBox = createBattleFaceBox();
  B$.faceBoxOnScreen = false;   // the object's own answer, from the rule above
  // A presentation owns the whole screen (Blast, digivolve, the clip-12 Jogress), so the
  // inset is suppressed on top of the rule. That is the walker's own presentation gate,
  // not the original's on/off rule.
  B$.faceBoxSuppressed = false;
  // The 100x60 picture box (layer key 0x1009) shows the SPEAKING side's active
  // combatant. Speaker id 0 is the player side and 0x10 the enemy side (the id
  // byte's high nibble selects the side); battle.js sets this per actor beat.
  B$.faceCamSpeaker = "player";
  // Which model record the box took its close-up out of this frame, and both
  // fighters' own model keys beside it. The subject is the PLAYER's fighter
  // whatever the speaker is (F0x80094064 hands the box one fighter record and
  // its +0x14; docs/research/battle/battle-hud-ownership-check-2026-10-03.md
  // §6.2), so this is the read-out tools/verify_battle_face_speaker.mjs asserts
  // the rule on. Null until the renderer has drawn a frame.
  B$.faceBoxSubject = null;
  // "game" camera = the REAL PS1 battle camera (session-23 dump): absolute eye/target in PS1
  // world (through ps1ToRender). eye≈(-3840,-2432,-4608), target≈(0,-2048,768), FOV~60°.
  // Knobs: side=±1 mirror across the battle line, zoom=distance mult, height=eye/look Y mult.
  // fovDeg is a VERTICAL fov, like every other camera here: 2*atan(120/280) for the reset
  // shot's H=280. It read 60 - that shot's HORIZONTAL fov - which framed the debug camera
  // 0.75x off the screen scale the 2D effect layer draws in.
  B$.gameCam = { side: 1, zoom: 1.0, height: 1.0, fovDeg: 46.4 };
    // The live director, or null while it does not exist (before the first menu, and for the
  // whole attack after the confirm edge retires it).
  B$.idleDirector = null;
  // True while the director is GONE: the record holds whatever was last cut (the retire's arena
  // shot, or an action's own op5) and the battle's camera must not republish over it — which is
  // the disc's "nothing re-publishes while the object does not exist".
  B$.directorRetired = false;
      B$.openCamera = null;      // the actor, or null before its phase-1 create
  B$.openCameraGone = false; // true once its state-3 tick has run (the exe has freed it)
  B$.openCameraHeld = null;  // the record it last installed (the arena shot once gone)
  B$.openCameraArm = null;   // the sub-state arm the last tick dispatched on (for the debug readout)
  B$.openClock = createIdleClock();
    // THE battle camera record: one owner, one live record, no expiry. See the decode block on
  // createCameraRecord (web/fight/battle-camera.js) — the original's camera object holds a
  // single 14-word record at +0x54 and NOTHING clears it: the op5 cut/move, the canned-shot
  // loader, the arena shot and the camera director's own per-frame re-cut all REPLACE it.
  // `camScriptOwned` is the original's one piece of camera arbitration, read off
  // F0x8008718c: the battle's camera director is not run while an action's script owns the
  // camera, so during the two action phases and the DNA presentation the battle's camera does
  // not touch the record and the last record installed stays on screen until the next cut.
  B$.camScriptOwned = false;
  B$.camRec = createCameraRecord((preset) => cannedShot(preset));
              B$.lastCamInfo = null;        // {eye,look,fovDeg} readout for the debug page
                    B$._rotY = (v, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  };
  B$._lerp = (a, b, t) => a + (b - a) * t;

                // The entrance asks for motion 13 on the cut frame, the same call that swaps the model (models->setId). Here the
  // swap is the new model loading, so the request waits until the live model IS the entering folder and its animator
  // exists, then plays; a later request (motion 1 / 2 at f299) replaces it.
  B$.entranceMotion = null;
        // DNA clip 12 hides the enemy for the void sequence (op2 [2,4] / [1,4]; slot 4 = enemy).
  B$.enemyVisible = true;
        // Named anim -> action-clip index. CONFIRMED (anim_loop_and_action_vm): basic attack = clip 5
  // (corrects the old wrong CLIP_NAMES attack:6), signature = clip 11. The others are tentative
  // indices for the debug viewer only; setAction falls back to idle if that clip has no script.
  B$.NAMED_CLIP = { attack: 5, signature: 11, walk: 1, run: 2, hit: 10, win: 16, lose: 17 };
      // ── DNA orb overlay ──────────────────────────────────────────────────────────
  // The clip-12 "parent orb" starbursts. Runtime ground truth (2026-07-15, state-9
  // replay): the op3 1005/1006 effect objects are only 42-tick IGNITION bursts that
  // die (state 3) right after growing to clip 6 @ 2.5x — the long-lived orbs that fly
  // for the rest of the presentation are drawn by presentation code, not the effect
  // system, and during the seg-2 camera hold they ORBIT each other ~2 revolutions,
  // spiralling in to the fusion flare (orbpath_0690..0980 centroid captures). We
  // reproduce its motion with the captured screen-space orbit path (authored data
  // in dna_clip12.json), while retaining the native ignition/core pixels.
  B$.DNA_ORB_ARCH = 5;
  B$.DNA_ORB_CLIPS = { A: 11, B: 10 };          // needle-star cores: yellow A, blue B
  B$.DNA_ORB_CLUT = { A: 4, B: 5 };             // yellow / blue native palette phases
  B$.DNA_ORB_SCALE = { A: 0.42, B: 0.38 };      // base core size (centre-origin px sprite)
  // Real-game choreography (user description 2026-07-15): the two parent orbs start on
  // opposite sides of a static wider shot and orbit an invisible centre CLOCKWISE, spiralling
  // inward over ~2.5 fast turns (~2s) until they collide dead-centre and fuse. Yellow orb
  // (Imperialdramon family) starts right, blue orb (Diaboromon family) starts left.
  B$.DNA_ORB_START_ANGLE = { A: 0, B: Math.PI };
  B$.DNA_ORB_RADIUS = 72;                        // start half-separation, centre-relative px
  B$.DNA_ORB_TURNS = 2.5;                        // clockwise revolutions before collision
  B$.DNA_ORB_TICKS = 132;                        // ~2.2s @ 60Hz to complete the spiral
  B$.dnaOrbs = null;   // { orbs:{A:{},B:{}}, u, dur, orbiting }
  B$.dnaPresentation = null; // {tick,fusionTick}: registry-owner 0x33 state
        // ── Blast digivolution presentation (sequence 0x61) ─────────────────────────
  // Same shape as the DNA presentation above: battle.js owns the frame counter
  // and the decoded timeline (engine/systems/blast-presentation.ts); the
  // renderer is told the current state and only reacts to it. What the renderer
  // contributes that 2D cannot: the black void, the camera dolly, hiding the
  // original model at the captured swap frame, and drawing the incoming form as
  // a green WIREFRAME built from that model's own geometry.
  B$.blastState = null;
  // The arena view's (0x1000) background colour (view+0x12C). In the original this colour
  // is written by the effect-tint feed FIGHTSTG_F0x800861f4 from the effect object's own
  // element colour, and the resident display-environment builder (F0x800266b4) composes it
  // into the view's background fill. The port is engine/dw3/battle-effect-tint.ts, run by
  // engine/dw3/battle-effect-driver-host.ts#createTransformationSchedule's `arenaTint` sink
  // on the ordinary transformation route. The renderer paints it as the arena background
  // quad (the sky when the arena is up, the void when a signature/transformation replaces
  // it). `null` = no colour set, so each background keeps its own default.
  B$.arenaTint = null;
    // The digivolution camera (normal digivolve and Blast, FIGHTSTG_updateDigimonChange): cuts to
  // the partner's near shot 9 + the -homePos.z offset at the start (f0) and at the model swap (f278), holds,
  // cuts to plain shot 9 (f649) and fades to the arena shot over 60 frames (f651). See fight/digivolve-camera.js.
  // The revert (de-digivolve) runs the entrance machine's camera instead (FIGHTSTG_updateEntrance,
  // key2 = 0): fade to near shot 10, enemy hidden, cut, fade back to the enemy view (createRevertCamera).
  B$.dvCam = null;
  B$.dvFrame = 0;
                                          // ── EXTRA FIGHTERS (multiplayer many-vs-many, web/mpbattle.js) ───────────────────────────────────────
  // A normal fight has two models, "player" and "enemy". Multiplayer needs more of them in the SAME arena, so this adds any
  // number of extra fighters, each with its own model, texture, skeleton buffers and ActorAnimator, standing in a lane beside
  // the others (`dx`, PS1 units sideways). They are drawn, animated, framed and sequenced by the same code as the two main
  // fighters: attacks run through the SAME FightCoordinator (it already takes any two animators), the effects and projectiles
  // are the same op3 / op6 records, shifted into the right lane. Nothing here runs unless addFighter() is called.
  B$.extras = new Map();          // id -> fighter
  B$.multiCam = false;
  B$.fighterScreen = new Map();   // id -> { x, topY, footY } in 0..1 of the canvas, written every render
  B$.coordinator.extraActors = () => { const out = []; for (const f of B$.extras.values()) if (f.anim8r) out.push(f.anim8r); return out; };
  B$.laneOf = (f) => f.dx + f.lat;

  // Many-vs-many line-up (multiCam only). The caller's dx only gives the ORDER along a side; the spacing comes from each
  // model's own measured width (widest x extent over its first 1.5 s of idle, PS1 units) plus a gap, so two big
  // Digimon never overlap. Each side stands in a slant (echelon): the lanes step back away from the opponent, so the
  // line reads as a diagonal instead of a flat row. The arena (and a special's backdrop) is drawn larger by the
  // same rule that keeps each fighter's share of the arena what it is in the original one-on-one fight:
  // scale = widest side's line-up width / one fighter's slot (its width + the gap), between 1 and MULTI_ARENA_MAX.
  B$.MULTI_LANE_MIN = 1900;
  B$.MULTI_GAP_MIN = 300;
  B$.MULTI_GAP_FRAC = 0.35;
  B$.MULTI_ECHELON = 0.45;
  B$.MULTI_ARENA_MAX = 4;
  B$.MULTI_MEASURE_S = 1.5;
  B$.arenaScale = 1;
    // A larger arena must not bring its rock or walls between the camera and the fighters: measured over every arena
  // pack (tools/measure_mp_arena_cover.mjs, 2026-10-27), two of 29 did at the line-up's scale (meft1017: 0% -> 62% of
  // the screen, meft1029: 0% -> 35%). So the scale is lowered, in steps toward 1, until the screen share covered by
  // arena geometry that rises above the fighters' feet and is nearer than the nearest fighter is no more than at
  // the original size (+1%). Worked out once per arena and wanted scale, from the multi shot's own camera.
  B$.rockCoverCache = new Map();
                                                  // F2 -> Screen -> "Smart 2 vs 2 camera" (off by default; the many-vs-many fight only). The wide shot above is a fixed
  // rule that does not know the arena, so a rock face can fill the screen between it and the Digimon. The Digimon are
  // always painted OVER the arena (it is a background layer, its depth is cleared), so rock never hides them: what goes
  // wrong is rock that stands in front of them painted across the shot and behind their bodies. This tries camera spots
  // around the same look point (turned left/right, higher, nearer/further) and scores each by what the arena draw would
  // paint, measured from the arena's own triangles on a 100 x 36 screen grid: only the faces the arena draw keeps
  // (front-facing by the same NCLIP rule as arenaCullIndices, a quad by its first triangle), only faces that rise above
  // the fighters' feet and are nearer than the nearest fighter. Numbers: the share of the screen that near rock covers,
  // the share of the fighters' screen boxes it covers, and the fighters' box corners off screen. A small cost for
  // moving away from the original shot keeps it when nothing is in the way. Chosen while nobody is acting (no jumps
  // mid-attack), at most once a second, and eased toward the pick.
  B$.SMART_YAW = [0, -15, 15, -30, 30, -45, 45, -60, 60, -75, 75, -90, 90];
  B$.SMART_H = [1, 1.35, 1.75, 0.8];
  B$.SMART_D = [1, 1.2, 0.85, 1.45];
  B$.smartPick = null;
  B$.smartAt = -1e9;
  B$.smartKey = "";
  B$.smartLastClock = 0;
  B$.smartInfo = null;
  B$.smartCur = { yaw: 0, h: 1, d: 1 };
        // all candidate spots in order; the original shot first
  B$.SMART_CANDS = []; for (const yaw of B$.SMART_YAW) for (const h of B$.SMART_H) for (const d of B$.SMART_D) B$.SMART_CANDS.push({ yaw, h, d });
  B$.smartJob = null;
      B$._smartResult = (job) => ({ arena: job.name, arenaScale: job.scale, ms: job.ms, original: job.def, pick: job.best });
      // F2 -> Atmosphere -> "Battle sky & weather" (off by default). The fight follows the place it started from: the
  // overworld's time of day (its own multiply colour, scenery.js todColor) or the game's own night map, and that map's
  // weather (rain, snow / blizzard, sand, foggy places) as the ambience layer last measured it (window.__battleAtmos,
  // set by ambience.js; absent in the labs, so they never change). Night and storms grade the arena and the Digimon in
  // the shader (uGradeSub), distance fog by view depth (uFogCol/uFogP); snow, rain and sand fall as 3D particles in a box
  // in front of the camera, behind the Digimon where they are further away. Storms flash. Technique effects are drawn
  // after the uniforms are reset, so they keep the game's own colours.
  B$.ATM_HAZE_DAY = [0.72, 0.80, 0.92];
  B$.ATM_HAZE_NIGHT = [0.07, 0.09, 0.18];
  B$.ATM_SNOW = [0.86, 0.89, 0.95];
  B$.ATM_RAIN = [0.40, 0.45, 0.52];
  B$.ATM_SAND = [0.78, 0.62, 0.42];
  B$.atmFlash = 0;
  B$.atmNextBolt = 0;
  B$.atmThunderAt = 0;
  B$.atmLastT = 0;
  B$.atmParts = null;
  B$.atmColBuf = null;
  B$.atmColProg = null;
    // Arenas whose floor water gets waves: measured (tools/measure_arena_sky_water.py, water-coloured share of the floor)
  // AND named so by the maps that use them (manifest byStage). meft1027 Suzaku / Zhu Que UG Lake 97%, meft1002 Shell
  // Beach / the capes 6% (the sea strip). Left out: meft1011 Seabed 78% (a sea floor under water, no surface),
  // meft1009 / 1012 / 1020 (blue-grey stone and metal, 14-28%), meft1023 / 1029 (no map known to use them yet).
  B$.ARENA_WATER = new Set(["meft1027", "meft1002"]);
  B$.ATM_HORIZON = 600;
  B$.ATM_GROUND = 300;      // pack units, as the measuring tool
  B$.atmMoon = null;                              // { arena, dir }: set once per fight, so the moon stays put in the world
              B$.lastAtm = null;

  // F2 -> Screen -> "Painted 360 battle backdrops" (off by default; HD Remaster only). The fight's whole place is
  // painted: the disc arena is not drawn at all.
  //  * far: an equirectangular picture of the map the fight started from (assets-hd/battle/panoramas/s<map>.png,
  //    git-ignored, painted by hand, 4x by tools/upscale_assets.py) on a sphere that moves with the camera, so the
  //    picture is never bent (a picture has no depth: laying its lower half on the floor smeared every cliff and wave
  //    into streaks). u = 0.5 looks along -Z (toward the enemy side), horizon at v = 0.5.
  //  * near: a real flat ground at the Digimon's feet (y = 0, +-4 measured) with its own tiling texture
  //    (s<map>_ground.png, 512 px, PANO_TILE units a tile), fading out between PANO_FADE[0] and [1] from the arena centre
  //    so the picture shows beyond it. Measured in the s340 fights: fighters ~2000 out, the camera up to 4260 out.
  B$.PANO_IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  B$.PANO_R = 50000;
  B$.PANO_GR = 9000;
  B$.PANO_FADE = [4500, 9000];
  B$.PANO_TILE = 800;
  B$.pano = null;                                 // { id, tex, px, ground, missing }
  B$.panoDome = null;
  B$.panoDisk = null;
  B$.panoGroundProg = null;
  B$.panoLog = { id: null, loaded: false, missing: false, ground: false, drawn: 0 };
      // The painted ARENA (<id>_paint.json + <id>_floor.png, tools/capture_arena_360.mjs + capture_arena_floor.mjs, each
  // repainted by Gemini): the game's own arena triangles, same cull, same size, but coloured from the paintings. Floor
  // triangles (level, below meta.floorCap, inside the floor square) take the straight-down floor picture by (x, z): top
  // = -Z, right = +X. Every other triangle takes the 360 by its direction from the capture eye meta.eye (render units),
  // u 0.5 = -Z, horizon at v 0.5. Why: one 360 from the middle gave the floor near the camera (10 m out) only 12 px per
  // 100 units before Gemini cut it 4x; the user saw it smeared.
  B$.panoPaintProg = null;
                // The painted place in 3D: s<map>_depth.bin / .json (tools/pano_depth.py + pano_depth_export.py: an AI depth model on 13
  // ordinary views of the picture) gives every corner of a 256 x 128 grid its distance from the painted viewpoint, NaN
  // for sky. Size: PANO_UNIT_M render units per depth metre, so the Digimon (465-660 units tall, measured) are about
  // person-sized in the place (the first try sized the place by the 1v1 camera height, 90 units a metre: the user saw it
  // "way too small", Digimon as 7 m giants). The viewpoint sits cameraHeightM (the depth tool's measure) above the arena
  // centre. The ground where the Digimon fight is made exactly level: a point lower than PANO_FLAT_M metres goes to y 0
  // inside PANO_FLAT_R[0], blending out by [1] (measured on s340: the depth ground is within +-0.5 m of level 4-20 m out,
  // +0.6 m right under the viewpoint). A quad is torn
  // out (the far dome shows through) where it is a "rubber sheet" across a depth jump: corners differ > 1.3x in distance,
  // it is not level ground (normal.y < 0.8) and it faces the viewpoint edge-on (|cos| < 0.15).
  // Far wall: everything further than PANO_FAR_M (and the sky, which has no depth) lies on one smooth wall at that
  // distance, as in the picture, so the whole place is ONE fixed 3D object (the camera-following dome is not drawn with
  // it: both at once showed the picture twice). Why: the mesh is a 1.4-degree grid, and a cell on a tree's edge had one
  // corner on the tree and one on the sky, so leaves were stretched into jagged streaks; the depth model also blurs thin
  // fronds. Measured on s340: trees against the sky 62-98 m (far trees >= 55 m); the beach half within 7 m, 90% within
  // 35 m; fighters within 5.4 m of the centre, the camera within 10.7 m. 40 m keeps the beach and near cliffs in 3D.
  B$.PANO_UNIT_M = 400;
  B$.PANO_FLAT_M = 1.0;
  B$.PANO_FLAT_R = [5000, 7000];
  B$.PANO_FAR_M = 40;
        /** (checks) the panorama's state: map id, loaded / missing, ground on, frames drawn, and its numbers. */
  // Tool only (tools/capture_arena_360.mjs): the disc arena alone, no fighters, seen from `eye` toward `look`, through a
  // square 90-degree view into an offscreen buffer; returns the RGBA rows bottom-up as base64. Six of these make a 360.
  B$._capFbo = null;
                  return {
    setPlayerDigimon,
    preloadDigimon,
    setPlayerVisible,
    setEnemyVisible,
    // NEW content (F2 -> Extras -> "Fusion bosses"): the fusion's white-out and its
    // per-side tint (web/fusion.js's boss record). Both are inert until battle.js calls
    // them, which it only does with the switch on.
    whiteOut,
    setFighterTint,
    setFighterBaseIdle, playPlayerMotion, playEnemyMotion,
    dnaOrbIgnite, dnaOrbsPath, dnaOrbsClear,
    dnaPresentationStart, dnaFusionStart, dnaPresentationStop,
    blastPresentationSet, blastPresentationStop, blastSpawnEffect,
    // The arena view's background colour (view+0x12C), the sink for the ported effect-tint
    // feed FIGHTSTG_F0x800861f4. Pass (r,g,b) in PS1 view-colour bytes (0..255), or no
    // argument to clear it back to the renderer's own defaults.
    setArenaTint,
    // The per-area ordinary-battle arena (MEFT10<trigger param>). Call with the field screen the
    // fight started on and the encounter id it rolled; the arena table (from the stage's own
    // battle-trigger records) resolves the id. Returns the loaded arena pack or null.
    setArenaStage,
    getMultiLayout, probeArenaScale, probeSmartCam, getAtmosphere, getPanorama, probePanoGround, captureArenaFace,
    // Debug/before-after only: fall back to the pre-decode arena render — one palette per atlas
    // page (floor.png/wall.png) composited with alpha — so a capture can show the palette+blend
    // change side by side. Production always uses the decoded per-CLUT palette + opaque blend.
    setArenaLegacy,
    // Debug/before-after only: select the arena draw. Default is the shipped decode (per-prim
    // palette + the ported back-face cull + the OPAQUE blend). `{cull:false, opaque:true}` shows
    // the opaque blend without the cull (the 14%-black regression); `{cull:true, opaque:false}`
    // shows the cull composited with alpha; `{legacy:true}` is the pre-decode render.
    setArenaDebug,
    // Debug only: flip the back-face cull sign (default +1 = decoded). Returns the sign.
    setArenaCullSign,
    // Debug/diagnostics: the arena pack currently selected for the ordinary battle (pack, id).
    get arenaStage() {
      const id = arenaIdFor(B$.arenaStageReq?.mapId, B$.arenaStageReq?.screenId);
      return { mapId: B$.arenaStageReq?.mapId ?? null, screenId: B$.arenaStageReq?.screenId ?? null,
               arenaId: id, pack: id == null ? null : `meft10${String(id).padStart(2, "0")}`,
               bg: B$.arenaBg ? B$.arenaBg.slice(0, 3).map((v) => Math.round(v * 255)) : null,
               loadedGroups: B$.activeArena?.groups?.length ?? 0,
               cull: { keptTri: arenaCullLog.kept, totalTri: arenaCullLog.total, sign: S.arenaCullSign, groups: arenaCullLog.groups } };
    },
    setEnemyDigimon,
    // (multiplayer many-vs-many, web/mpbattle.js)
    addFighter, removeFighter, clearFighters, setFighterLane, setFighterVisible, setFighterHurt, setMultiCamera,
    fighterAttack, fighterReact, fighterVictory, fighterTech, fighterAction, fightersReady, fightersBusy, getFighterScreen,
    setPlayerAnim,
    setEnemyAnim,
    playPlayerVictory,
    playPlayerActionClip,
    playPlayerItemUse,
    playPlayerThrowItem,
    playPlayerScript,
    setPlayerAnimByTech,
    setEnemyAnimByTech,
    playerAttack,
    enemyAttack,
    coordinator: B$.coordinator,
    get playerAnimator() { return B$.playerAnim8r; },
    get enemyAnimator()  { return B$.enemyAnim8r; },
    get playerVictoryComplete() { return !!B$.playerAnim8r?.timelineCycleComplete; },
    // Debug (motion browser): play raw timeline table `idx` on the player; list non-empty tables.
    debugPlayPlayerTable(idx) {
      const t = B$.playerModel?.timeline?.[idx]?.table;
      if (!B$.playerAnim8r || !t || !t.length) return false;
      B$.playerAnim8r.debugPlayTable(t);
      return true;
    },
    debugTimelineTables() {
      return (B$.playerModel?.timeline || []).map((p, i) => ({ idx: i, len: p.table?.length || 0 }))
        .filter(x => x.len > 0);
    },
    // Debug (fight-action-lab): play an ORDERED SEQUENCE of timeline tables back-to-back on the
    // player (the assembled action the user composes), looping by default so it can be studied.
    debugPlayPlaylist(tableIndices, opts) {
      if (!B$.playerAnim8r || !B$.playerModel) return false;
      const tables = (tableIndices || [])
        .map(i => B$.playerModel.timeline?.[i]?.table)
        .filter(t => t && t.length);
      if (!tables.length) return false;
      B$.playerAnim8r.debugPlayPlaylist(tables, opts || {});
      return true;
    },
    // Debug (fight-action-lab): set the global per-tick table step (GLOBAL_SPEED) to judge timing.
    debugSetSpeed(n) { B$.GLOBAL_SPEED = Math.max(1, n | 0); return B$.GLOBAL_SPEED; },
    // Debug (tools/verify_texture_patches.mjs): hold a fighter's eyes at one state and
    // blit immediately. The blink itself is six ticks long at GLOBAL_SPEED 2, so a
    // wall-clock screenshot can never be relied on to catch it; F0x8008b118's state
    // override is the deterministic way in. State 1 = the blink runs (open), 2 = half,
    // 4..11 = shut. Returns how many patches were re-blitted.
    debugHoldPatchState(side, state) {
      const patches = side === "enemy" ? B$.enemyPatches : B$.playerPatches;
      const tex = side === "enemy" ? B$.enemyTex : B$.playerTex;
      const page = side === "enemy" ? B$.enemyPage : B$.playerPage;
      if (!patches) return 0;
      // Latch it, or the next sim tick puts the eye straight back. Pass null to hand
      // the fighter back to its own animation.
      const held = state === null ? null : state | 0;
      if (side === "enemy") B$.enemyPatchHold = held; else B$.playerPatchHold = held;
      if (held === null) return 0;
      let blitted = 0;
      for (const patch of patches.update(0, held))
        if (blitTexturePatch(tex, page, patch)) blitted++;
      return blitted;
    },
    // Debug (tools/verify_texture_patches.mjs): read one patch's DESTINATION rectangle
    // back off the live GPU texture and compare it with the source rectangle the current
    // variant should have put there. This is the end-to-end proof that the blit happened:
    // a screenshot cannot show it, because the eye is a handful of pixels on screen and
    // the idle animation moves every frame regardless.
    debugReadPatchPixels(side, index = 0) {
      const patches = side === "enemy" ? B$.enemyPatches : B$.playerPatches;
      const tex = side === "enemy" ? B$.enemyTex : B$.playerTex;
      const page = side === "enemy" ? B$.enemyPage : B$.playerPage;
      const entry = patches?.entries[index];
      if (!entry || !tex || !page) return null;
      const r = texturePatchRect(entry, page.scale);
      const w = r.w, h = r.h;
      const fb = B$.gl.createFramebuffer();
      B$.gl.bindFramebuffer(B$.gl.FRAMEBUFFER, fb);
      B$.gl.framebufferTexture2D(B$.gl.FRAMEBUFFER, B$.gl.COLOR_ATTACHMENT0, B$.gl.TEXTURE_2D, tex, 0);
      const got = new Uint8Array(w * h * 4);
      const complete = B$.gl.checkFramebufferStatus(B$.gl.FRAMEBUFFER) === B$.gl.FRAMEBUFFER_COMPLETE;
      if (complete) {
        B$.gl.readPixels(r.dx, r.dy, w, h,
                      B$.gl.RGBA, B$.gl.UNSIGNED_BYTE, got);
      }
      B$.gl.bindFramebuffer(B$.gl.FRAMEBUFFER, null);
      B$.gl.deleteFramebuffer(fb);
      if (!complete) return null;

      let mismatched = 0;
      for (let row = 0; row < h; row++) {
        const from = ((r.y0 + row) * page.width + r.x0) * 4;
        for (let i = 0; i < w * 4; i++)
          if (page.data[from + i] !== got[row * w * 4 + i]) mismatched++;
      }
      // Hand the pixels back as an image so a capture can show the actual eye.
      const canvas = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement("canvas"), { width: w, height: h });
      const ctx = canvas.getContext("2d");
      ctx.putImageData(new ImageData(new Uint8ClampedArray(got), w, h), 0, 0);
      return {
        width: w, height: h, variant: entry.variant, mismatched,
        canvas: typeof canvas.convertToBlob === "function" ? null : canvas.toDataURL(),
        rgba: Array.from(got),
      };
    },
    // Debug: is a fighter's patch animation actually up (table row + page pixels)?
    debugPatchState(side) {
      const patches = side === "enemy" ? B$.enemyPatches : B$.playerPatches;
      const page = side === "enemy" ? B$.enemyPage : B$.playerPage;
      const a = side === "enemy" ? B$.enemyAnim8r : B$.playerAnim8r;
      return {
        entries: patches ? patches.entries.length : 0,
        variants: patches ? patches.entries.map((e) => e.variant) : [],
        page: page ? { width: page.width, height: page.height, scale: page.scale } : null,
        timelineTable: a ? a.timelineTable : null,
        animationId: patchState(side),
      };
    },
    // Debug (tools/verify_proj_layers.mjs): put ONE op6 flight mesh on screen at an EXACT
    // tick and render a single frame of it. The lab's animation is wall-clock driven, so
    // two ordinary runs never land on the same frame and their screenshots cannot be
    // compared; this pins the tick so a before/after capture is the same moment of the same
    // effect. It spawns through the real EffectPlayer and renders through the real
    // render(), so it exercises the shipped path rather than a stand-in.
    // `from`/`to` default to Armormon's basic-attack record `[0,39, 0,0,5120, 0,2048,0]`
    // AFTER the op6 handler's Y/Z negation (ActionVM._lunge) — the same vectors the live
    // attack passes, i.e. the muzzle at our own slot, not the raw words.
    debugRenderProjectileAt(id, tick, { side = "player", from = [0, 0, -5120],
                                        to = [0, -2048, 0] } = {}) {
      if (!B$.effectPlayer) return false;
      B$.effectPlayer.projectiles.length = 0;
      if (!B$.effectPlayer.spawnProjectile(id, from, to, side)) return false;
      B$.effectPlayer.projectiles[0].t = tick;
      render(0);
      return true;
    },
    // Debug (tools/verify_proj_layers.mjs): the frame that render() just produced, as a PNG
    // data URL. Captures read this instead of screenshotting the page, because the host page
    // blits the offscreen canvas on its own animation frame and would otherwise overwrite a
    // pinned frame before it could be photographed.
    async debugCaptureFrame() {
      if (canvas.convertToBlob) {
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(blob);
        });
      }
      return canvas.toDataURL("image/png");
    },
    // Debug: is the pack's geometry loaded and ready to draw? The mesh cache is lazy and
    // async, so a capture taken before it resolves is a blank frame, not a result.
    debugProjectileReady(id) {
      loadProjMesh(id);
      const e = B$.projCache.get(id);
      return !!(e && e !== "loading" && e.layers.length &&
                e.layers.every((L) => !L.count || L.groups.every((g) => g.texReady)));
    },
    // Debug: set the move-back sync-ramp rate (MOVE_SPEED). Lower = longer move-back. Takes effect on
    // the NEXT attack (the VM reads it at construction). Tune to match the real game, then we lock it.
    debugSetMoveSpeed(n) { return setMoveSpeed(n); },
    // Debug (headless verification): each fighter's live arena offset from its home slot, in PS1
    // units. The op2 mode-5 motion object writes z here as an attacker steps toward its target, so
    // a capture script can measure the approach instead of eyeballing a screenshot.
    debugMoveDelta() {
      return {
        player: B$.playerAnim8r ? B$.playerAnim8r.moveDelta().slice() : null,
        enemy: B$.enemyAnim8r ? B$.enemyAnim8r.moveDelta().slice() : null,
      };
    },
    // Both fighters' home slots in PS1 arena units, for on-screen verification: they come
    // from each Digimon's own smdldata record, so they differ per matchup.
    debugArenaSlots() {
      return {
        player: B$.playerAnim8r?.homeSlot || arenaSlotFor(B$.playerFolder, "player", B$.placementTable),
        enemy: B$.enemyAnim8r?.homeSlot || arenaSlotFor(B$.enemyFolder, "enemy", B$.placementTable),
      };
    },
    // Special-attack per-element backdrop. Auto-fires on setPlayer/EnemyAnimByTech; exposed for the
    // battle lab / manual control. on=true shows it now (optional techId picks the element pack,
    // default = data-field fallback); on=false hides it.
    // Open the battle on the shot the enemy's record names. Returns the shot, or null
    // when either record is not loaded yet — in which case it is applied as soon as the
    // placement table lands.
    applyIntroCamera() { return applyArenaShot(); },
    /** The opening machine's phase-1 slot-6 create: build the battle-open camera actor once. */
    beginOpeningCamera,
    setDataField(on, techId) {
      B$.dataFieldPinned = !!on;                            // hold until explicitly turned off
      if (on) triggerDataField(techId, performance.now() - B$.BD_DELAY_MS);   // show immediately
      else B$.dataFieldOffAt = 0;
    },
    get dataFieldActive() { return dataFieldIsActive(); },
    setCameraMode,
    getCameraMode,
    // ── the animation viewer's own camera / staging (web/anim-viewer.html) ──────────────────────
    // `fn` returns {eye, look, up?, fovDeg, ortho?} in RENDER space, or null. Pass null to hand the
    // camera back to the battle record (the viewer's "use the battle's camera" toggle).
    setFreeCameraView(fn) { B$.freeCamView = typeof fn === "function" ? fn : null; return !!B$.freeCamView; },
    /** The fighter's last rendered bounding box in render space: {min,max,center,size} or null. */
    getFighterBounds(side) {
      const b = side === "enemy" ? B$.eAABBLast : B$.pAABB;
      if (!b) return null;
      const center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      return {
        min: b.min.slice(), max: b.max.slice(), center,
        size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
      };
    },
    /** Arena Viewer "built" look: no disc arena or sky, see-through clear (needs createBattle3D(.., {alpha: true})). */
    setBuiltArena(on) { B$.builtArena = !!on; return B$.builtArena; },
// TOON-BEGIN (F2 "Toon outlines" / "Toon shading", off by default; strip these blocks = the code before toon)
    /** Arena Viewer: { outline, shade } booleans (the game uses F2 window.__fx.toonoutline / .toonshade instead). */
    setToon(o) { B$.toonSet.outline = !!o?.outline; B$.toonSet.shade = !!o?.shade; return { ...B$.toonSet }; },
    /** For checks: what is on now, and counters (frames drawn with toon, hull draws, weld builds, last error). */
    getToon() { return { set: { ...B$.toonSet }, on: _toonState(), ...B$.toonLog }; },
// TOON-END
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
    /** Arena Viewer built look only: light the Digimon like the built world ({dir, colour, ambient}, see
     *  _sceneLightDraw); null turns it off again. Never called by the game or the model viewer. */
    setSceneLight(L) {
      B$.sceneLight = L && L.dir && L.colour && L.ambient
        ? { dir: Array.from(L.dir).slice(0, 3), colour: Array.from(L.colour).slice(0, 3), ambient: Array.from(L.ambient).slice(0, 3) } : null;
      return B$.sceneLight;
    },
    /** For checks: the light now, and per side the share of faces whose normal points away from the mesh centre. */
    getSceneLight() {
      const out = { light: B$.sceneLight, winding: SCENE_LIGHT_WINDING };
      for (const [side, bufs] of [["player", B$.playerSkelBufs], ["enemy", B$.enemySkelBufs]]) {
        const p = bufs?.lastPos; if (!p) continue;
        // signed volume (divergence theorem): > 0 when the normals point out of the closed surface, whatever its shape;
        // per bone piece too (each piece about its own centre), so a mixed winding would show
        const model = bufs === B$.playerSkelBufs ? B$.playerModel : B$.enemyModel;
        const vol = (a0, a1) => {
          let qx = 0, qy = 0, qz = 0; const nv = (a1 - a0) / 3; if (nv < 3) return 0;
          for (let i = a0; i < a1; i += 3) { qx += p[i]; qy += p[i + 1]; qz += p[i + 2]; }
          qx /= nv; qy /= nv; qz /= nv;
          let v = 0;
          for (let a = a0; a + 8 < a1; a += 9) {
            const x0 = p[a] - qx, y0 = p[a + 1] - qy, z0 = p[a + 2] - qz, x1 = p[a + 3] - qx, y1 = p[a + 4] - qy, z1 = p[a + 5] - qz, x2 = p[a + 6] - qx, y2 = p[a + 7] - qy, z2 = p[a + 8] - qz;
            v += (x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) + z0 * (x1 * y2 - y1 * x2)) / 6;
          }
          return v * SCENE_LIGHT_WINDING;
        };
        let pos = 0, neg = 0, nPos = 0, nNeg = 0;
        for (let b = 0; b < (model?.bones.length || 0); b++) {
          const a0 = bufs.boneOffsets[b] * 3, a1 = a0 + (model.bones[b].faces || []).length * 9, v = vol(a0, a1);
          if (v > 0) { pos += v; nPos++; } else if (v < 0) { neg -= v; nNeg++; }
        }
        out[side] = { faces: p.length / 9, volume: vol(0, p.length), bonesOut: nPos, bonesIn: nNeg, outShare: pos + neg > 0 ? pos / (pos + neg) : 0,
                      lit: !!bufs.litOn, normals: !!bufs.nbo, weldBuilds: bufs.weldBuilds || 0 };
      }
      return out;
    },
// SCENE-LIGHT-END
    /** This frame's fighter view-projection (column-major 4x4, render space), for checks. */
    getViewProjection() { return B$._fxView ? Array.from(B$._fxView.pv) : null; },
    /** Isolated mode only: false = no neutral background, no grid or axis lines, no floor quad shadow, see-through clear
     *  (needs createBattle3D(.., {alpha: true})). Default true = the animation viewer as before. Used by the glossary. */
    setViewerStudio(on) { B$.viewerStudio = !!on; return B$.viewerStudio; },
    /** Isolated studio mode: neutral background + ground grid, no arena/sky/backdrop. */
    setIsolated(on, side = null) {
      B$.isolatedMode = !!on;
      if (side) B$.isolatedSide = side;
      return B$.isolatedMode;
    },
    /** The scene's ground height (feet of the focused fighter), render space. */
    getGroundY(side) {
      const b = side === "enemy" ? B$.eAABBLast : B$.pAABB;
      return b ? b.min[1] : 0;
    },
    /** Read-only (look C): true while the close-up window is really drawn this frame with a picture in it. */
    getFaceBoxShown() { return !!B$.faceCamRect && !!B$.faceBoxSubject?.framed; },
    /** Read-only (for the look-C damage pop): the enemy's head and feet on this frame's screen, 0..1 of the canvas, or null. */
    getEnemyScreen() {
      if (!B$._fxView || !B$.eAABBLast) return null;
      const { pv, enemyPos } = B$._fxView, b = B$.eAABBLast;
      const pr = (y) => { const cx = pv[0]*enemyPos[0] + pv[4]*y + pv[8]*enemyPos[2] + pv[12], cy = pv[1]*enemyPos[0] + pv[5]*y + pv[9]*enemyPos[2] + pv[13], cw = pv[3]*enemyPos[0] + pv[7]*y + pv[11]*enemyPos[2] + pv[15];
        return cw > 0 ? { x: cx / cw * 0.5 + 0.5, y: 1 - (cy / cw * 0.5 + 0.5) } : null; };
      const top = pr(b.max[1]), foot = pr(b.min[1]);
      return top && foot ? { x: top.x, topY: top.y, footY: foot.y } : null;
    },
    setGiantCameraFit,
    /** Giant mode part 1: draw one side ("player" | "enemy") at k x its shipped size, clamped
     *  0.1..16; k = 1 draws exactly as shipped. Returns the stored scale. */
    setFighterScale: (side, k) => B$.fighterScale.setFighterScale(side, k),
    /** The scale that side is drawn at now (1 = MODEL_SCALE). */
    getFighterScale: (side) => B$.fighterScale.fighterScale(side),
    setSlowMotion,
    getAnimationReadout,
    setGameCamParam,
    getCameraInfo,
    getFaceCamRect,
    setFaceCamVisible,
    syncFaceBox,
    /** Whether the close-up box object is on screen right now (the rule's own answer). */
    getFaceBoxOnScreen() { return B$.faceBoxOnScreen && !B$.faceBoxSuppressed; },
    getFaceCamSpeaker() { return B$.faceCamSpeaker; },
    setFaceCamSpeaker(speaker) { B$.faceCamSpeaker = faceCamSideFor(speaker); },
    /** Which model record the box drew this frame, and both fighters' own keys. */
    getFaceBoxSubject() { return B$.faceBoxSubject ? { ...B$.faceBoxSubject } : null; },
    __dnaDebug() {
      return {
        playerVisible: B$.playerVisible, hasModel: !!B$.playerModel, hasSkel: !!B$.playerSkelBufs,
        playerPos: B$._fxView ? B$._fxView.playerPos.slice() : null,
        pAABB: B$.pAABB ? JSON.parse(JSON.stringify(B$.pAABB)) : null,
        eAABB: B$.eAABBLast ? JSON.parse(JSON.stringify(B$.eAABBLast)) : null,
        cam: B$.lastCamInfo ? { eye: B$.lastCamInfo.eye.map(Math.round), look: B$.lastCamInfo.look.map(Math.round), H: B$.lastCamInfo.H } : null,
        camScriptOwned: B$.camScriptOwned,
        camMode: B$.camMode,
        // The battle-open camera flourish's existence and walk, so a probe can see the row it
        // picked, the arm it ran and the frame it self-destructed (the object gone, the record
        // held on the plain arena shot).
        openCamera: {
          exists: !!B$.openCamera, gone: B$.openCameraGone,
          row: B$.openCamera?.state().row ?? null,
          index: B$.openCamera?.state().index ?? null,
          sub: B$.openCamera?.state().sub ?? null,
          arm: B$.openCameraArm,
          dwell: B$.openCamera?.state().dwell ?? null,
          held: B$.openCameraHeld ? B$.openCameraHeld.slice() : null,
        },
        // The idle director's existence and walk, so a probe can see the retire edge (the object
        // gone, the record held on the retire shot) and the next-turn create (a fresh walk).
        director: {
          exists: !!B$.idleDirector, retired: B$.directorRetired,
          row: B$.idleDirector?.state().row ?? null,
          index: B$.idleDirector?.state().index ?? null,
          sub: B$.idleDirector?.state().sub ?? null,
          dwell: B$.idleDirector?.state().dwell ?? null,
          held: B$.directorHeld ? B$.directorHeld.slice() : null,
        },
        // The disc's own reaction camera for each fighter — its clip-10 op5 (see `_reactionCamFor`).
        // Null when the model authors none, which is the original's "no impact camera" case.
        playerFolder: B$.playerFolder, enemyFolder: B$.enemyFolder,
        // Our near camera's giant fit (fitGiantNearCamera): whether it changed anything and the
        // per-shot dolly-back it applied — the number a probe reads to prove the framing moved.
        nearCamera: { giant: B$.giantNearCam,
          fit: B$.fittedNearCam?.folder === B$.playerFolder
            ? { giant: B$.fittedNearCam.giant,
                shots: (B$.fittedNearCam.shots ?? []).map((s) => s
                  ? { changed: s.changed, lift: +s.lift.toFixed(3), pull: +s.pull.toFixed(2), H: s.H }
                  : null) }
            : null },
        playerReactionCam: _reactionCamFor("player"),
        enemyReactionCam: _reactionCamFor("enemy"),
        camRecord: B$.camRec.get() ? { kind: B$.camRec.get().kind, issuer: B$.camRec.get().issuer ?? null,
          preset: B$.camRec.get().preset ?? null, fields: B$.camRec.live(),
          progress: B$.camRec.get().progress ?? null, duration: B$.camRec.get().duration ?? null,
          gliding: B$.camRec.isGliding() } : null,
        moveDelta: B$.playerAnim8r?.moveDelta ? B$.playerAnim8r.moveDelta().map(Math.round) : null,
        dnaPresentation: !!B$.dnaPresentation,
        enemyVisible: B$.enemyVisible, enemyAnim: B$.enemyAnim,
        orbs: B$.dnaOrbs ? { keys: Object.keys(B$.dnaOrbs.orbs), orbiting: B$.dnaOrbs.orbiting, u: B$.dnaOrbs.u } : null,
      };
    },
    getScreenOverlay() {
      if (!B$.screenOverlay) return null;
      // FIGHTSTG_F0x80092e18/F0x800930c0: monochrome 320x240 primitive;
      // argument 20 sets a 255/20 alpha ramp. DNA capture confirms white-out.
      // Type 0 ramps up (and holds at full — see tickSim); type 1 ramps back down.
      const a = B$.screenOverlay.t / B$.screenOverlay.duration;
      return { alpha: B$.screenOverlay.type === 1 ? Math.max(0, 1 - a) : Math.min(1, a) };
    },
    // op3 visual effects: everything battle.js needs to composite this tick's sprites over
    // the GL frame (see fight/effect-player.js drawEffects). null when nothing is active.
    getEffectDraw() {
      if (!B$.effectPlayer || !B$.effectAssets || !B$._fxView) return null;
      const list = B$.effectPlayer.renderList().filter(s => effectLayer(s) !== "under");   // the under sprites are drawn in the GL pass
      const { pv, w, h, playerPos, enemyPos } = B$._fxView;
      list.push(..._dnaSampleSprites().filter(x => effectLayer(x) !== "under"));   // typed samples: 1003 (z -1) is drawn in the GL pass
      // DNA orb overlay sprites (see dnaOrbIgnite/dnaOrbsPath above). Emitted as
      // screen-space descriptors in PSX centre-origin px, same as op3 z=32767 sprites.
      if (B$.dnaOrbs?.orbiting) {
        // Clockwise inward spiral (screen y-down ⇒ increasing angle = clockwise). Radius
        // shrinks from DNA_ORB_RADIUS to 0 as u→1, so both cores collide dead-centre; the
        // cores swell as they close in, and the op7 fusion white-out takes over at u≈1.
        const u = B$.dnaOrbs.u;
        const radius = B$.DNA_ORB_RADIUS * (1 - u);
        const swell = 1 + u * 0.35;
        for (const key of Object.keys(B$.dnaOrbs.orbs)) {
          const angle = B$.DNA_ORB_START_ANGLE[key] + u * B$.DNA_ORB_TURNS * 2 * Math.PI;
          const sc = B$.DNA_ORB_SCALE[key] * swell;
          list.push({
            arch: B$.DNA_ORB_ARCH, frame: B$.DNA_ORB_CLIPS[key],
            clutShift: B$.DNA_ORB_CLUT[key],
            side: "player",
            screen: true,
            pos: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: -1 },
            dx: 0, dy: 0, sx: sc, sy: sc, rot: 0, c6: 0, c7: 0,
          });
        }
      }
      if (!list.length) return null;
      const view = {
        centerX: w / 2, centerY: h / 2,
        pxScale: h / 240,                       // PSX 240-line screen -> canvas px
        worldToScreen(pos, side) {
          // op3 world coords are ABSOLUTE PS1 arena coordinates (Y down), and they are NOT
          // mirrored for the far-side fighter: claim
          // fight-world-effect-coordinates-are-not-mirrored-per-side-2026-08-18 reads the
          // operands from F0x8008bc80 to the projector F0x8009e53c without a single side
          // test, and the shipped data is authored per side instead (player-side packs put
          // 677 attack spawns at +z against 1 at -z; enemy packs 153 at -z against 65 at +z).
          // The old x'=-x, z'=640-z mirror was inferred from two slot positions in one
          // capture, and those are per-Digimon stand-offs, not arena constants.
          const [wx, wy, wz] = ps1ToRender(pos, MODEL_SCALE);
          const cx = pv[0]*wx + pv[4]*wy + pv[8]*wz  + pv[12];
          const cy = pv[1]*wx + pv[5]*wy + pv[9]*wz  + pv[13];
          const cw = pv[3]*wx + pv[7]*wy + pv[11]*wz + pv[15];
          if (cw <= 0) return null;
          return { x: (cx / cw * 0.5 + 0.5) * w, y: (1 - (cy / cw * 0.5 + 0.5)) * h };
        },
      };
      return { list, manifest: B$.effectAssets.manifest, images: B$.effectAssets.images, view };
    },
    get effectPlayer() { return B$.effectPlayer; },
    render,
    destroy,
    setPlayerFrame: f => { B$.playerFrame = f; },
    setEnemyFrame:  f => { B$.enemyFrame  = f; },
    get gl() { return B$.gl; },
  };
}

// ─── Name → folder resolution ─────────────────────────────────────────────────

let _modelMap = null;
export function canonicalModelName(name) {
  return ({
    "BK WarGreymon": "BKWarGreymon",
    "Imperialdramon-F": "ImperialdramonFM",
    "Imperialdramon-P": "ImperialdramonPM",
  })[name] ?? name;
}

// ─── Pure function exports (used by tests and model-viewer) ─────────────────
export {
  ps1AnglesToMat3, buildBoneWorldMatrices, interpChannel,
  mat4Identity, mat4Mul, mat4Perspective, mat4LookAt, mat4Translate, mat4Scale,
  normalize, sub3, cross3, dot3, centroid3,
  compileShader, createProgram, loadTexture,
  loadSkeletalModel, buildSkeletalGLBuffers, updateSkeletalVBO, drawSkeletalMesh,
  VERT_SRC, FRAG_SRC,
};

export async function resolveModelFolder(digimonName) {
  if (!_modelMap) {
    try {
      const r = await fetch("assets/battle/model_map.json");
      _modelMap = await r.json();
    } catch (e) {
      _modelMap = {};
    }
  }
  return _modelMap[canonicalModelName(digimonName)] || null;
}
