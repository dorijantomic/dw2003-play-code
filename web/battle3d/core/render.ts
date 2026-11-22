import {
  MODEL_SCALE,
  ps1ToRender,
  renderToPs1,
  mat4Perspective,
  mat4LookAt,
  ps1ToRenderMatrix,
  mat4RotateY,
} from "../math.js";
import { stepFormChangeFrame } from "../../fight/digivolve-camera.js";
import {
  arenaSlot,
  attackLateralFraction,
  slowMoStep,
  LOSS_CAM,
  OP5_PRESETS,
  rotateShotYaw,
  lossCamYawUnits,
  modelKeyFromFolder,
} from "../camera-shots.js";
import {
  CAMERA_FRAME_DELTA,
  fovYFromH,
  applyScreenRoll,
  faceBoxSource,
  faceBoxDraws,
  faceBoxScene,
  faceBoxFovY,
  FACE_BOX_ASPECT,
} from "../../fight/battle-camera.js";
import { buildBoneWorldMatrices } from "../rotation.js";
import { _updateSkeletalVBOGL } from "../skeleton.js";
import { idleDirectorTick } from "../../fight/battle-idle-director.js";
import { stagingRecordsReady, BATTLE_WIDE_MODES, BATTLE_WIDE_DOLLY } from "../camera-fit.js";
import { mat4Mul, mat4Translate, mat4RotPSX, clipFrameAt, projLayerWorlds } from "../../fight/proj-layers.js";
import { CHANGE_STAGE_FULL, changeStageBg, changeStageMotionFrame } from "../../vendor/engine.js";
import {
  drawQuad,
  drawProjLayer,
  arenaCullLog,
  changeStageMat4,
  arenaCullIndices,
  drawProjLayerIndexed,
  drawSkeletalMesh,
  fighterTint,
  makeQuadBuffers,
} from "../gl.js";
import { effectLayer } from "../../fight/effect-player.js";
import { drawUnderEffects } from "../../fight/effect-under-gl.js";
import type { Battle3DContext, TexProgram } from "../../types/battle3d.js";
interface AdvanceClip {
  present?: boolean;
  start_frame: number;
  end_frame: number;
}


interface AdvanceModel {
  clips?: AdvanceClip[];
  total_frames?: number;
}


// moved by tools/rewrite/split-closure.mjs
export function makeRender(B$: Battle3DContext) {
// ETS item 9: createBattle3D sets the GL context, the texture program and the tuning constants before any of this runs, so the `!` on those B$ fields below are safe.
function render(dt: number) {
    B$.animTime! += dt;

    const W = B$.canvas!.width, H = B$.canvas!.height;
    B$.gl!.viewport(0, 0, W, H);
    if (B$.builtArena || (B$.isolatedMode && !B$.viewerStudio)) B$.gl!.clearColor(0, 0, 0, 0);
    else B$.gl!.clearColor(0.04, 0.04, 0.08, 1);   // #0a0a14 = the sky gradient's bottom stop
    B$.gl!.clear(B$.gl!.COLOR_BUFFER_BIT | B$.gl!.DEPTH_BUFFER_BIT);

    B$.gl!.enable(B$.gl!.DEPTH_TEST);
    B$.gl!.depthFunc(B$.gl!.LEQUAL);
    B$.gl!.enable(B$.gl!.BLEND);
    B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);

    // ── Digimon world placement ──
    // Like the real game: our digimon in the foreground, the enemy far down-field near the
    // horizon (small via perspective). Big depth separation so they never overlap.
    // REAL PS1 arena layout: each fighter's slot comes from its OWN smdldata record —
    // x=0, y=-hover, z=-+(0x1400+standoff), near side negative — so the two are symmetric
    // about z=0 and stand at a distance that differs per matchup. See arenaSlot() above.
    // The slot plus the action VM's movement delta are one PS1 coordinate, and ps1ToRender is
    // the ONE mapping into render world; the bob is the walker's own render-space hover.
    const ARENA = MODEL_SCALE;
    // The digivolution camera runs here, before the placement, because the change holds the
    // partner at the slot origin (pos.x = pos.z = 0, pos.y = homePos.y: startChange and
    // swapInNewDigimon) for exactly the span its shot-9 cut carries the -homePos.z offset.
    // ONE frame of the original's order: camera run, view snapshot, then the change's cuts / fades
    // (stepFormChangeFrame, shared with the tests). The frame is drawn with the snapshot.
    const dvView = B$.dvCam ? stepFormChangeFrame(B$.camRec!, B$.dvCam, B$.dvFrame).shot : null;
    const dvAtOrigin = !!B$.dvCam?.atOrigin();
    const pBob = Math.sin(B$.animTime! * 3) * 2;
    const eBob = Math.sin(B$.animTime! * 3 + Math.PI) * 2;
    // Slot position + the action VM's movement delta (op2 modes 3/7/8: dash to contact,
    // signature leap, return home). Delta is PS1 units, same frame as the slot.
    const pMove = B$.playerAnim8r && !dvAtOrigin ? B$.playerAnim8r.moveDelta() : [0, 0, 0];
    const eMove = B$.enemyAnim8r  ? B$.enemyAnim8r.moveDelta()  : [0, 0, 0];
    // The VM's op2 movement is a delta from the home slot on every axis, so the home slot
    // is added on every axis. (This retires the DNA-only Y compensation that used to sit
    // here: it existed solely because home Y was the one axis the placement did not re-add.)
    const pHomeSlot = B$.playerAnim8r?.homeSlot || arenaSlot(null, "player");
    const pHome = dvAtOrigin ? { ...pHomeSlot, x: 0, z: 0 } : pHomeSlot;
    const eHome = B$.enemyAnim8r?.homeSlot  || arenaSlot(null, "enemy");
    const playerPos = ps1ToRender([pHome.x + pMove[0], pHome.y + pMove[1], pHome.z + pMove[2]],
                                  ARENA);
    const enemyPos  = ps1ToRender([eHome.x + eMove[0], eHome.y + eMove[1], eHome.z + eMove[2]],
                                  ARENA);
    playerPos[1]! += pBob;
    enemyPos[1]!  += eBob;
    // Facing: the renderer bakes the D-flip (180° about Y) into every model. The game's player
    // root rot = that flip (faces +Z, toward the enemy) → yaw 0; the game's enemy root rot =
    // identity → +π so it faces back (−Z, toward the player). They square off.
    // The yaw is applied in RENDER space, and the mapping flips Z, so a PS1 yaw of θ comes
    // out as −θ: M·Ry(θ)·M⁻¹ = Ry(−θ) for M = diag(1,−1,−1). The enemy's ±π is its own
    // mirror image, so only the player's needs the sign.
    const playerYaw  = -(((B$.playerAnim8r?.rotation?.()[1] || 0) - (B$.playerAnim8r?.rotationBase || 0))
      * Math.PI * 2 / 4096);
    const enemyYaw   = Math.PI;

    // Advance frame counters (60 fps target) — constrained to named clip ranges
    const CLIP_NAMES: Record<string, number> = {idle:0, walk:1, run:2, attack:6, hit:10, win:16, lose:17};

    function advanceInRange(frame: number, dt: number, start: number, end: number) {
      const range = end - start;
      if (range <= 0) return start;
      let f = frame + dt * 60;
      if (f > end) f = start + ((f - start) % range);
      if (f < start) f = start;
      return f;
    }

    function advanceFrame(frame: number, dt: number, model: AdvanceModel | undefined, animName: string): number {
      if (!model || !model.clips) return (frame + dt * 60) % (model?.total_frames || 200);
      const clipIdx = CLIP_NAMES[animName] ?? 0;
      const clip = model.clips[clipIdx];
      if (!clip || !clip.present) {
        const c0 = model.clips[0];
        if (c0 && c0.present) return advanceInRange(frame, dt, c0.start_frame, c0.end_frame);
        return (frame + dt * 60) % (model.total_frames || 200);
      }
      return advanceInRange(frame, dt, clip.start_frame, clip.end_frame);
    }

    // ActorAnimator drives both idle (TimelinePlayer over the idle position table) and actions
    // (ActionVM over model.actions[clip]). It's "active" while a VM runs OR while idle has a
    // timeline; only models lacking a timeline (no VM) fall back to the legacy advanceFrame.
    const usePlayerA = !!(B$.playerAnim8r && B$.playerAnim8r.isActive);
    const useEnemyA  = !!(B$.enemyAnim8r  && B$.enemyAnim8r.isActive);

    // The coordinator owns per-tick stepping of both actors (it gates on isActive internally),
    // so attacker->defender reaction sequencing stays consistent with the live render tick.
    function tickSim(speed: number) {
      // The camera record runs on the RAW per-frame delta, never on `speed`. F0x80091df4's
      // tween multiplies its step by `[0x8004df9c]()` — the same word the op11 wait decrements
      // (F0x8008c220 .L0x8008c26c) and the same one the defeat orbit reads (.L0x8008cad4) — and
      // never by 0x800a4464, which is the word slow motion moves. `speed` IS that published
      // word scaled by the walker's tempo, so at slow-motion level 2 it drops to 0 on three
      // logic ticks in four. The camera's delta is ONE 60 Hz frame (CAMERA_FRAME_DELTA = 1):
      // with the authored 60-tick ramp (`(0x100000/60)>>8 = 68` per frame) that lands on
      // 0x1000 in ~61 ticks = ~1.0 s, the disc's own 60 frames at 60 Hz. It used to be handed
      // GLOBAL_SPEED (the walker's 2x animation tempo, a visual preference), which halved the
      // glide to ~0.5 s and read as a fast zoom rather than the original's slow one.
      // While a form change runs, its camera run is stepFormChangeFrame's (once per presentation frame).
      if (!B$.dvCam) B$.camRec!.tick(CAMERA_FRAME_DELTA);
      B$.coordinator!.tick(speed);
      B$._layoutExtras();
      for (const f of B$.extras!.values()) {   // (multiplayer) slide sideways into the target's lane for an attack, and back
        if (f.follow) {                                             // sideways in step with the clip's own run
          if (f.anim8r?.vm && !f.anim8r.vm.ended) {
            const k = attackLateralFraction(f.anim8r.moveDelta()[2], f.follow.reach);
            f.lat = f.follow.dx * k; f.latz = f.follow.dz * k;
          } else { f.follow = null; f.latT = 0; f.latzT = 0; }      // over: ease whatever is left back to its own place
        } else {
          f.lat += (f.latT - f.lat) * Math.min(1, 0.12 * speed);
          f.latz += (f.latzT - f.latz) * Math.min(1, 0.12 * speed);
        }
        f.dx += (f.dxT - f.dx) * Math.min(1, 0.12 * speed);         // to its measured place in the line-up
        if (f.latT !== 0 && !(f.anim8r?.vm && !f.anim8r.vm.ended)) { f.latT = 0; f.latzT = 0; }
      }
      // Eyes and looping body textures. `speed` is the same per-tick frame delta the
      // original's blink timer counts down by (D0x800a4464), so the blink keeps the
      // cadence the record was authored for.
      for (const patch of B$.playerPatches?.update(speed, B$.patchState("player")) || [])
        B$.blitTexturePatch(B$.playerTex!, B$.playerPage!, patch);
      for (const patch of B$.enemyPatches?.update(speed, B$.patchState("enemy")) || [])
        B$.blitTexturePatch(B$.enemyTex!, B$.enemyPage!, patch);
      for (const f of B$.extras!.values()) {   // (multiplayer) the extra fighters' eyes
        if (!f.patches || !f.page) continue;
        for (const patch of f.patches.update(speed, f.anim8r ? f.anim8r.animationId : 1)) B$.blitTexturePatch(f.tex, f.page, patch);
      }
      B$.effectPlayer?.step(speed);
      if (B$.dnaOrbs) {
        for (const o of Object.values(B$.dnaOrbs.orbs)) o.tick += speed;
        if (B$.dnaOrbs.orbiting) B$.dnaOrbs.u = Math.min(1, B$.dnaOrbs.u + speed / B$.dnaOrbs.dur);
      }
      if (B$.dnaPresentation) {
        B$.dnaPresentation.tick += speed;
        if (B$.dnaPresentation.fusionTick != null) B$.dnaPresentation.fusionTick += speed;
      }
      if (B$.screenOverlay) {
        B$.screenOverlay.t += speed;
        // op7 type 0 RAMPS UP and persists at full until a type-1 op frees it (fightstg
        // barrier decode 2026-07-14): the DNA script white-outs in one segment and fades
        // in the next. Type 1 (and legacy types) self-clear when the ramp completes.
        if (B$.screenOverlay.t >= B$.screenOverlay.duration && B$.screenOverlay.type !== 0) B$.screenOverlay = null;
      }
    }
    B$._acc! += dt;
    const stepDur = 1 / B$.STEP_HZ!;
    // DNA clip 12 plays at the same rate as every other action/tech animation (GLOBAL_SPEED);
    // speeding it up made the models animate comically fast.
    //
    // One slow-motion step per logic tick: F0x8009e428 runs once a frame off the RAW delta
    // `[0x8004df9c]()` and publishes to 0x800a4464, and everything on tickSim's `speed` reads
    // that word in the original (the model actor's frame counter at F0x80083d30, the second
    // actor clock at .L0x80089614, every op2 slot-motion blend at .L0x8009b1fc/.L0x8009b380).
    // At level 2 the published value is 1 on every fourth tick and 0 on the other three, so
    // the pose freezes for three frames and steps one on the fourth — the original's stutter
    // is preserved rather than smoothed into a constant quarter speed.
    while (B$._acc! >= stepDur) {
      B$._acc! -= stepDur;
      if (B$.slowMoLevel) {
        const step = slowMoStep(B$.slowMoLevel, LOSS_CAM.deltaPerFrame, B$.slowMoAcc);
        B$.slowMoAcc = step.acc;
        B$.slowMoDelta = step.delta;
        B$.slowMoTickSpeed = B$.GLOBAL_SPEED! * (step.delta / LOSS_CAM.deltaPerFrame);
        B$.slowMoTicks! += 1;
        B$.slowMoUnits += step.delta;
      } else {
        B$.slowMoDelta = LOSS_CAM.deltaPerFrame;
        B$.slowMoTickSpeed = B$.GLOBAL_SPEED!;
      }
      tickSim(B$.slowMoTickSpeed!);
    }

    // Key-off sustained battle voices when the attack finishes (the effect objects
    // are freed): a looping op10 sound plays for the attack, then stops. Edge-triggered.
    const coordActive = B$.coordinator!.active;
    if (B$._coordWasActive && !coordActive && B$.sfx) {
      B$.sfx.stopBattle!("player"); B$.sfx.stopBattle!("enemy");
      // A clip cut short before its op10 type 91 would otherwise leave the whirl ringing.
      B$.sfx.stopSustained?.(B$.SUSTAINED_LOOP_KEY!);
    }
    B$._coordWasActive = coordActive;

    // Render interpolation: the 60Hz logic tick stays the faithful fixed step, but draw the pose
    // between the previous and current tick by the leftover accumulator fraction. Without this the
    // pose snaps to the latest tick, and when the render rate isn't phase-locked to STEP_HZ the
    // 0-tick/2-tick beat shows as an occasional stutter/hitch. renderSample() suppresses the lerp
    // across phase cuts/loop-backs so only genuinely continuous motion is smoothed.
    const alpha = stepDur > 0 ? Math.min(1, B$._acc! / stepDur) : 0;
    const pSample = usePlayerA ? B$.playerAnim8r!.renderSample(alpha) : null;
    const eSample = useEnemyA  ? B$.enemyAnim8r!.renderSample(alpha)  : null;

    B$.playerFrame = pSample ? pSample.frame
      : advanceFrame(B$.playerFrame!, dt, B$.playerModel, B$.playerAnim!);
    B$.enemyFrame = eSample ? eSample.frame
      : advanceFrame(B$.enemyFrame!, dt, B$.enemyModel, B$.enemyAnim!);
    // Per-frame pose blend (timeline blend segments) — null when not transitioning.
    const playerBlend = pSample ? pSample.blend : null;
    const enemyBlend  = eSample ? eSample.blend : null;

    // ── Skin meshes FIRST (world space, camera-independent) so the camera can frame
    //    our digimon by its actual rendered size (scale-aware). ──
    B$.pAABB = null;
    let eAABB = null;
    if (B$.playerVisible && B$.playerModel && B$.playerSkelBufs) {
      const bwm = buildBoneWorldMatrices(B$.playerModel, B$.playerFrame!, playerBlend,
        usePlayerA ? B$.playerAnim8r?.currentHiddenParts?.() : null);
      B$.pBwm = bwm;
      const _pt = globalThis.__perfHook3d ? performance.now() : 0;   // dev-only timing hook
      B$.pAABB = _updateSkeletalVBOGL(B$.gl!, B$.playerModel, B$.playerSkelBufs, bwm, playerPos,
        MODEL_SCALE * B$.fighterScale.fighterScale("player"), false, playerYaw);
      if (_pt) globalThis.__perfHook3d?.("fighterVBO", performance.now() - _pt, B$.playerSkelBufs.totalVerts);
    }
    if (B$.enemyModel && B$.enemySkelBufs) {
      const bwm = buildBoneWorldMatrices(B$.enemyModel, B$.enemyFrame!, enemyBlend,
        useEnemyA ? B$.enemyAnim8r?.currentHiddenParts?.() : null);
      B$.eBwm = bwm;
      const _pt = globalThis.__perfHook3d ? performance.now() : 0;   // dev-only timing hook
      eAABB = _updateSkeletalVBOGL(B$.gl!, B$.enemyModel, B$.enemySkelBufs, bwm, enemyPos,
        MODEL_SCALE * B$.fighterScale.fighterScale("enemy"), false, enemyYaw);
      if (_pt) globalThis.__perfHook3d?.("fighterVBO", performance.now() - _pt, B$.enemySkelBufs.totalVerts);
      B$.eAABBLast = eAABB;
    }
    if (B$.extras!.size) B$._updateExtras(alpha, ARENA);

    // ── Cinematic camera: rotate-around-target look-at on our digimon ──
    const pCenter = B$.pAABB
      ? [(B$.pAABB.min[0]!+B$.pAABB.max[0]!)/2, (B$.pAABB.min[1]!+B$.pAABB.max[1]!)/2, (B$.pAABB.min[2]!+B$.pAABB.max[2]!)/2]
      : [playerPos[0], playerPos[1]! + B$.DIGI_H!/2, playerPos[2]];
    const pH = B$.pAABB ? Math.max(40, B$.pAABB.max[1]! - B$.pAABB.min[1]!) : B$.DIGI_H;
    // Battle axis from the stable placements (not the pose-dependent AABB centres).
    let fwd = [enemyPos[0]!-playerPos[0]!, 0, enemyPos[2]!-playerPos[2]!];
    const fl = Math.hypot(fwd[0]!, fwd[2]!) || 1; fwd = [fwd[0]!/fl, 0, fwd[2]!/fl];

    B$.orbitClock! += dt;
    const azTarget = B$.camMode === "orbit" ? Math.sin(B$.orbitClock! * 0.5) * 1.15 : 0; // ±66° sweep
    B$.camAz! += (azTarget - B$.camAz!) * Math.min(1, dt * 2.5);  // smooth toward target
    const behindDir = B$._rotY([-fwd[0]!, 0, -fwd[2]!], B$.camAz!);

    const groundY = B$.pAABB ? B$.pAABB.min[1] : 0;  // feet of our digimon

    let eye, look;
    let up = B$.UP;                 // world up, unless an op5 shot's +0x24 angles turn it
    let rollDeg = 0;             // the shot's +0x2c roll, in degrees (0 for every other camera)
    let fovRad = Math.PI/4;
    // The idle director's OWN record for this tick, when the battle's camera is the one
    // running. It is the 14 words FIGHTSTG_F0x8008718c re-cuts through [0xf8] every tick it
    // runs (fightstg.s:5115-5125) — including the yaw at +0x26, which is what turns the held
    // shot about the arena origin. Its dwell and its turn run on the RAW per-frame delta
    // `[0x8004df9c]()`, so the walker's seconds are converted the same way the loss orbit
    // does it: whole 60 Hz frames, never the slow-motion-published delta (LOSS_CAM's note).
    let directorFields = null;
    // The director's idle shot owns the frame in BOTH idle-camera modes, not only "director" (the
    // command-picking states). "behind" is everything else the battle flow hands this camera once
    // the walker's own modes are excluded — the acting phases, RESULT_MSG, the intro. While the
    // menu is up the director runs and re-cuts its record through [0xf8] every tick
    // (fightstg.s:5096-5105); on the confirm edge the command screen retires it (state 3, then
    // the object is freed), so for the whole attack the frame owner holds the shot the retire
    // cut — the plain arena shot — instead of the walker's computed over-the-shoulder shot.
    // `directorHeld` is only the fallback before the first menu. The tag/game/defeat/orbit modes
    // below keep their own cameras.
    if (B$.camMode === "director" || B$.camMode === "behind") {
      if (B$.camMode === "director") {
        // The director exists while the menu is up; a fresh one is built on the first menu and
        // after every retire. Its row-3 opening shot is only ticked once both fighters' staging
        // records exist — the fight's setup block creates it after them (fightstg.s:16136-16162,
        // see stagingRecordsReady) — so its dwell is not burnt on a page with nothing to show.
        if (!B$.idleDirector) B$.idleDirector = B$.makeIdleDirector();
        const f = idleDirectorTick(B$.idleDirector, B$.idleClock, dt,
          stagingRecordsReady(B$.placementTable, B$.playerFolder, B$.enemyFolder));
        if (f) B$.directorHeld = f;
        directorFields = f;
      } else {
        // "behind": the director is RETIRED (gone), so there is nothing to tick — the record
        // owner holds the shot the retire cut. That is what re-homes the camera for the next
        // turn, and why the camera does not restart its walk mid-attack.
        directorFields = B$.directorHeld;
      }
      if (B$.camMode === "behind") {
        // The walker's own over-the-shoulder shot. It is now only a FALLBACK: the record owner
        // cuts it while the director's held record has not resolved yet (before both staging
        // records land).
        const radius = Math.max(140, pH! * 1.7);
        eye  = [ pCenter[0]! + behindDir[0]!*radius, pCenter[1]! + pH!*0.75, pCenter[2]! + behindDir[2]!*radius ];
        look = [ pCenter[0]! + fwd[0]!*pH!*3.0,
                 groundY! + pH!*0.55,
                 pCenter[2]! + fwd[2]!*pH!*3.0 ];
      }
    } else if (B$.camMode === "tag") {
      // Sequence 0x38's captured arrival is a frontal full-body shot. Reuse
      // the game's decoded high-front canned camera (op5 preset 3).
      const p = OP5_PRESETS[3];
      eye  = ps1ToRender(p.eye, MODEL_SCALE);
      look = ps1ToRender(p.target, MODEL_SCALE);
      fovRad = fovYFromH(p.H) * Math.PI / 180;
    } else if (B$.camMode === "game") {
      // REAL PS1 battle camera (session-23 dump): absolute eye/target in PS1 world × MODEL_SCALE,
      // mapped by ps1ToRender. eye=(-3840,-2432,-4608), target=(0,-2048,768).
      const s = MODEL_SCALE;
      const look0 = ps1ToRender([0, -2048 * B$.gameCam!.height, 768], s);
      const eye0  = ps1ToRender([-3840 * B$.gameCam!.side, -2432 * B$.gameCam!.height, -4608], s);
      // zoom = slide the eye along (eye → look)
      eye  = [ look0[0]! + (eye0[0]!-look0[0]!)*B$.gameCam!.zoom,
               look0[1]! + (eye0[1]!-look0[1]!)*B$.gameCam!.zoom,
               look0[2]! + (eye0[2]!-look0[2]!)*B$.gameCam!.zoom ];
      look = look0;
      fovRad = B$.gameCam!.fovDeg * Math.PI / 180;
    } else if (B$.camMode === "defeat") {
      // F0x8008c93c: the cut to OUR digimon's canned near shot 11, then the shot frame's
      // Y angle gains `delta * 2` every frame. Phase 1 also adds the same delta to +0x10
      // and switches to phase 2 at >= 0xf0. The delta here is the RAW one from 0x8004df9c,
      // which the orbit reads directly — the slow-motion level 2 the effect sets applies
      // to the battle's animation clock, not to the camera. The anchor F0x800923b4 leaves
      // zeroed is the arena origin, so both the eye and the look-at swing around it.
      // One delta per 60 Hz frame, from the real elapsed time, so a faster display
      // does not turn the camera faster.
      B$.defeatClock! += dt;
      B$.defeatDelta = Math.floor(B$.defeatClock! * 60) * LOSS_CAM.deltaPerFrame;
      const p = B$.lossShot() || OP5_PRESETS[4];
      const turned = rotateShotYaw(p.eye, p.target, lossCamYawUnits(B$.defeatDelta));
      eye  = ps1ToRender(turned.eye, MODEL_SCALE);
      look = ps1ToRender(turned.target, MODEL_SCALE);
      fovRad = fovYFromH(p.H) * Math.PI / 180;
    } else if (B$.camMode === "orbit") {
      // Sweep around OUR digimon, framing its full body (scale-aware on pH).
      const radius = Math.max(180, pH! * 2.4);
      eye  = [ pCenter[0]! + behindDir[0]!*radius, pCenter[1]! + pH!*0.30, pCenter[2]! + behindDir[2]!*radius ];
      look = [ pCenter[0], pCenter[1], pCenter[2] ];
    } else if (B$.camMode === "opening") {
      // The battle-open camera flourish OWNS the camera for the whole opening. Tick the actor on
      // the RAW per-frame delta (its dwell is `[0x8004df9c]()`, 1 a frame) and install the record
      // it names — a cut ([0xf8]) or a glide ([0xfc]) — through the one record owner. It starts
      // only once both fighters' staging records exist, exactly as the disc creates it after the
      // fighters are placed, so its dwell is not burnt on a page with nothing to show.
      if (!B$.openCamera) B$.beginOpeningCamera();
      if (B$.openCamera && !B$.openCameraGone
          && stagingRecordsReady(B$.placementTable, B$.playerFolder, B$.enemyFolder)) {
        const out = B$.openCamera.update(B$.openClock!.tick(dt));
        B$.openCameraArm = out.arm;
        if (out.action) {
          B$.openCameraHeld = out.action.fields;
          if (out.action.kind === "move") B$.camRec!.move(out.action.fields, out.action.duration, { issuer: "battle" });
          else B$.camRec!.cut(out.action.fields, { issuer: "battle" });
        }
        if (out.gone) B$.openCameraGone = true;
      }
    }
    // No trailing catch-all: the director/behind arms above are the battle's idle camera and its
    // over-the-shoulder fallback, and `setCameraMode` only ever installs those six modes.

    // THE camera record, and who owns it. The original's camera object holds one live record
    // (F0x80092244 / F0x800922b4 / F0x80091df4) and NOTHING clears it, so the record drawn this
    // frame is the last one any writer installed. There is no third state to fall back from: if
    // there is no record yet, the shot this branch just computed is the record.
    //
    // `camScriptOwned` is the original's own arbitration and the ONLY thing that stops the
    // battle's camera from touching the record. It is true while an action's script owns the
    // record (a running VM, or a glide still in flight) AND while the director is RETIRED
    // (`directorRetired`) — the disc's confirm edge frees the director, so for the rest of the
    // attack nothing re-publishes over the record. So:
    //   * script owns the camera, or the director is gone -> the record stands (an op5 outlives
    //     its own script), and
    //   * the battle's camera owns it -> it CUTS its own shot into the record now, which is
    //     what retires a stale action shot, and what the loss beat and the idle director do.
    //
    // The retire cut itself is applied by `retireIdleDirector` on the confirm edge, not here.
    const modeH = 120 / Math.tan(fovRad / 2);
    // The defeat shot is the ONE exception to the script gate: F0x8008C93C's entry tick cuts
    // `camMgr->[0x104](0, 0xB)` and its phases re-apply that record through [0xf8] every
    // frame with no test of any script — and the loss branch fires while the enemy's own
    // action script is still running (the controller's step runs before its children's), so
    // gating this cut on `camScriptOwned` left the retire shot on screen for the whole loss
    // beat and the defeat shot was never seen. The loss camera takes the one live record,
    // exactly as `setCameraMode`'s own note says the victory / loss / tag cameras do.
    if (B$.camMode !== "free" && ((!B$.camScriptOwned && !B$.dvCam?.owns()) || B$.camMode === "defeat")) {
      // The opening flourish installed its own record in the "opening" arm above — a cut or a
      // glide — and once it self-destructs the record holds the plain arena re-cut it left. The
      // battle's generic behind/over-the-shoulder shot must not overwrite it.
      if (B$.camMode === "opening") {
        // nothing to do here: the actor owns the record
      } else if (directorFields) {
        // The record lives in the PS1 battle world (it is the original's cam struct), so the
        // cut hands it renderToPs1 and the read below hands it back ps1ToRender.
        //
        // The idle director brings its OWN 14 words — eye, target, anchor, the three frame
        // angles, roll and H, already in PS1 units — because in the original that record is
        // edited in place and re-cut, and the yaw at +0x26 is what the arm's turn writes. A
        // null director record means its canned shot has not resolved yet, and then the record
        // stands, exactly as it does while a script owns the camera.
        B$.camRec!.cut(directorFields, { issuer: "battle" });
      } else if (B$.camMode !== "director") {
        const s = MODEL_SCALE;
        B$.camRec!.cut([
          ...renderToPs1(eye, s), ...renderToPs1(look, s),
          0, 0, 0,                          // +0x18 anchor — an absolute shot has none
          0, 0, 0,                          // +0x24/+0x26/+0x28 frame angles
          rollDeg, modeH,                   // +0x2c roll, +0x30 projection distance
        ], { issuer: "battle" });
      }
    }
    const shot = dvView || B$.camRec!.sample();
    // The viewer's FREE camera wins over the record: its eye/look are already render space (the
    // page hands them in through setFreeCameraView), so no ps1ToRender and no record. This is the
    // whole isolation: op5 cuts still update the record (the info panel reports them), but the
    // frame is drawn through this view, so the script can never move the user's camera.
    const freeView = B$.camMode === "free" ? B$.freeCamView?.() : null;
    if (freeView) {
      eye = freeView.eye;
      look = freeView.look;
      up = freeView.up || B$.UP;
      rollDeg = 0;
      fovRad = freeView.fovDeg * Math.PI / 180;
    } else if (shot) {
      const s = MODEL_SCALE;
      eye  = ps1ToRender(shot.eye, s);
      look = ps1ToRender(shot.target, s);
      // The +0x24 angles turn the shot's frame, so its up vector is no longer world up.
      // PS1 -> render is the same one mapping the eye and target take.
      if (shot.up) up = ps1ToRender(shot.up, 1);
      rollDeg = shot.roll || 0;
      if (shot.H) fovRad = fovYFromH(shot.H) * Math.PI / 180;
    } else if (!(B$.multiCam && B$.extras!.size)) {
      // The frame is drawn THROUGH the record, or not at all. `sample()` is null in exactly one
      // situation — no writer has installed a record yet — and then there is no view matrix to
      // build: `eye`/`look` were never computed for this mode, because a camera mode that computes
      // its own shot has already cut one and a director that cannot resolve its arm has not.
      //
      // The original has no such frame to get wrong. Its camera object holds the record from the
      // moment it is built, and the fight's FIRST cut is the arena shot — taken in the setup
      // phase, after both fighters' records exist (fightstg.s:16136-16162), with the loaders
      // leaving the staging block untouched when a record is missing (F0x8009257c
      // .L0x800925ac/.L0x800925c8, F0x800923b4 .L0x800923f0). So on the console this is the frame
      // the fight has not started on yet, and the disc's answer is that the arena is not up.
      //
      // It used to reach mat4LookAt with `eye` undefined and throw out of render(), which killed
      // the page's own frame loop on frame one (the Battle Lab has no state that cuts a record
      // before the director's first arm resolves). The canvas is already cleared to the sky's
      // bottom stop above, so holding the frame here is that dark screen — and nothing invents a
      // camera to fill it.
      return;
    }

    if (B$.multiCam && B$.extras!.size) {   // (multiplayer) the wide shot of everybody owns the camera
      const c = window.__fx?.smartcam ? B$._smartCameraShot() : B$._multiCameraShot();
      if (c) { eye = c.eye; look = c.look; up = B$.UP; rollDeg = 0; fovRad = c.fov; } else if (!shot) return;
    }

    // DNA clip 12's verified explicit cameras sit ~9.1–9.6k render units from
    // their target (raw PS1 eye/target values reach 28,204).  The old generic
    // 8k far plane therefore clipped the entire authored Paildramon shot even
    // though its camera transform was correct.  Widen only explicit op5 shots;
    // normal battle/preset framing keeps the tighter arena depth range.
    const liveRec = B$.camRec!.get();
    const explicitShot = liveRec?.kind === "move"
      || (liveRec?.kind === "cut" && liveRec.issuer !== "battle");
    // A giant's fitted near shot is dollyed back 2-3× so its whole body fits (fitGiantNearCamera),
    // which puts the enemy — and the far edge of the arena floor — past the tight 8k far plane the
    // disc's close arena shots are tuned to. Widen it for those shots only, as the explicit op5
    // shots already do.
    // F2 -> Screen -> "Battle camera a little further out" (HD Remaster only, off by default): the idle /
    // command camera, the acting phases' held arena shot and the multiplayer wide shot step back along
    // their own view ray. A technique's own camera (an explicit op5 shot) is left exactly as the disc has it.
    const battleWide = !explicitShot && !freeView
      && (BATTLE_WIDE_MODES.has(B$.camMode!) || (B$.multiCam && B$.extras!.size > 0))
      && document.documentElement.dataset.assetMode === "hd" && !!window.__fx?.battlewide;
    if (battleWide) {
      eye = [ look[0] + (eye[0] - look[0]) * BATTLE_WIDE_DOLLY,
              look[1] + (eye[1] - look[1]) * BATTLE_WIDE_DOLLY,
              look[2] + (eye[2] - look[2]) * BATTLE_WIDE_DOLLY ];
    }
    const farPlane = explicitShot || B$.giantNearCam || B$.camMode === "free" || battleWide ? 60000 : 8000;
    const proj = mat4Perspective(fovRad, W/H, 1, farPlane);
    // The digivolve and revert cameras (fight/digivolve-camera.js) are camera RECORDS (cuts and fades), so
    // nothing here moves the eye: no dolly, no push-in.
    const camEye = eye, camLook = look;
    let camUp = up;
    // The +0x2c roll turns the finished SCREEN, so it is applied last, to the render-space up
    // vector, after the camera record has settled camEye/camLook. 7 shipped packs author it.
    if (rollDeg) camUp = applyScreenRoll(camUp, camEye, camLook, rollDeg);
    const view = mat4LookAt(camEye, camLook, camUp);
    const pv   = mat4Mul(proj, view);
    if (B$.extras!.size) B$._projectExtras(pv, W, H);
    B$.lastCamInfo = {
      eye, look, fovDeg: fovRad * 180 / Math.PI,
      // The camera the frame is really drawn with (after the wide-shot step, blast dolly and screen roll), render space.
      render: { eye: camEye.slice(), look: camLook.slice(), up: camUp!.slice(), fovRad, aspect: W / H,
                arenaScale: B$.multiCam ? B$.arenaScale : 1 },
      // PS1 convention, matching the record's own frame.
      up: renderToPs1(up, 1), roll: rollDeg,
      // fovRad is the VERTICAL fov (fovYFromH), so the projection distance comes back through
      // the screen's 240-line half-height. Reading it back through 160 reported an H a third
      // too large, and the record owner feeds this number to real camera paths.
      H: 120 / Math.tan(fovRad / 2),
      // The defeat effect's own numbers, so a check can read the orbit straight off the
      // camera instead of inferring it from the eye: 0x800a46d8+0x26 out of 4096, and the
      // raw game delta the orbit has consumed so far.
      defeatYaw: lossCamYawUnits(B$.defeatDelta), defeatDelta: B$.defeatDelta,
    };
    // Snapshot for getEffectDraw (battle.js composites the op3 sprites over this frame).
    B$._fxView = { pv, w: W, h: H, playerPos: playerPos.slice(), enemyPos: enemyPos.slice() };

    const dfActive = B$.dataFieldIsActive();
    B$.syncSpecialLoop(dfActive);   // the pack's own BT_LOOP voice lives exactly as long as the pack
    // The change presentation (digimon_change.c) drives the stage task: the battle stage fades out, the
    // change stage (0x1C manual digivolve = MEFT1028, 0x1F Blast = MEFT1031) fades in and holds, then
    // it fades out and the battle stage fades in again (engine changeStage: stage + model colour per
    // frame). The stage in `blastState.stage` is drawn as the arena, its model colour as the tint and
    // its background colour (FIGHTSTG_fadeStage) as the sky. The void is only the stand-in while the
    // stage's pack is still loading (or when the battle has no disc arena).
    const stageId = B$.blastState ? (B$.blastState.stage | 0) : 0;
    const stageLevel = B$.blastState && B$.blastState.stageLevel != null ? B$.blastState.stageLevel : CHANGE_STAGE_FULL;
    const stageName = (id: number | string) => `meft10${String(id).padStart(2, "0")}`;
    if (B$.blastState && B$.blastState.stageChange) {          // load the change stage's pack and textures ahead of its frame
      const ahead = B$.loadArenaPack(stageName(B$.blastState.stageChange));
      if (ahead!.groups) for (const g of ahead!.groups) if (g.count) B$.arenaTextureFor(ahead!, g);
    }
    const shownArena = stageId ? B$.loadArenaPack(stageName(stageId)) : B$.activeArena;
    const shownReady = !!(shownArena && shownArena.groups && shownArena.groups.length);
    const blastDark = !!B$.blastState && B$.blastState.voidAlpha >= 1;   // the battle stage is black: no shadows
    const blastVoid = blastDark && !shownReady;
    const dnaVoidActive = !!B$.dnaPresentation || blastVoid;
    // The ordinary battle's per-area arena (MEFT10<trigger param>), when one is loaded. It is
    // drawn the same way as the special backdrop — a scene of wall+floor meshes through this
    // frame's camera — but it is the environment for the WHOLE fight, not a cast window.
    const arenaActive = !dfActive && !dnaVoidActive && shownReady;

    // battle atmosphere (F2 -> Atmosphere, off by default): only over the ordinary per-area arena
    const atm = arenaActive && !B$.isolatedMode ? B$._atmosFrame(camEye, camLook) : null;
    B$.lastAtm = atm;
    B$._atmosUniforms(atm);

    // Sky background (draw first, no depth write). During a special the per-element backdrop
    // replaces the arena environment: black void + the MEFT10<sigEffect> wall+floor meshes drawn
    // ADDITIVELY (abr=1) through this frame's camera — the same 3D scene the real game renders.
    B$.gl!.depthMask(false);
    // The arena view's background colour, when the ported effect-tint feed has set one
    // (view+0x12C); otherwise each branch keeps its own default (black void / sky).
    const bgTint = B$.arenaTint;
    if (B$.isolatedMode) {
      // Viewer: a neutral studio background, no sky texture / arena / backdrop.
      if (B$.viewerStudio) drawQuad(B$.gl!, B$.texP!, B$.IDENT_MVP!, B$.skyBufs!, B$.whiteTex!, 1, [0.085, 0.095, 0.115, 1]);
    } else if (dnaVoidActive) {
      drawQuad(B$.gl!, B$.texP!, B$.IDENT_MVP!, B$.skyBufs!, B$.whiteTex!, 1, bgTint || [0, 0, 0, 1]);
    } else if (dfActive) {
      drawQuad(B$.gl!, B$.texP!, B$.IDENT_MVP!, B$.skyBufs!, B$.whiteTex!, 1, bgTint || [0, 0, 0, 1]);   // black void (full screen)
      // Backdrop shares the live battle camera, but with a FAR clip plane pushed way out: the mesh
      // spans ±20479×MODEL_SCALE (≈±7168 world) and its far edge exceeds the scene's 8000 far plane
      // at wide shots → far triangles clipped to black holes. A 60000 far plane keeps it all in.
      const bdPV = mat4Mul(mat4Perspective(fovRad, W / H, 1, 60000), view);
      const world = ps1ToRenderMatrix(MODEL_SCALE * (B$.multiCam ? B$.arenaScale : 1)!);   // fight-model → world (larger for many fighters)
      // Spin phase: each group lerps 0→spinDeg over BD_ROT_MS from when the backdrop appeared, then
      // holds (the real ctrl reaches its target at frame 121 then sentinel-holds).
      const spinT = Math.min(1, Math.max(0, (performance.now() - B$.dataFieldOnAt!) / B$.BD_ROT_MS!));
      B$.gl!.enable(B$.gl!.BLEND);
      B$.gl!.blendFunc(B$.gl!.ONE, B$.gl!.ONE);                                 // additive (abr=1)
      for (const g of B$.activeBackdrop!.groups!) {
        if (!g.count) continue;
        // Y-axis spin about the arena centre (X,Z scaled equally, so it commutes with `world`).
        const mvp = g.spinDeg
          ? mat4Mul(mat4Mul(bdPV, world), mat4RotateY(g.spinDeg * spinT * Math.PI / 180))
          : mat4Mul(bdPV, world);
        drawProjLayer(B$.gl!, B$.texP!, mvp, g, g.page === "floor" ? B$.activeBackdrop!.floorTex : B$.activeBackdrop!.wallTex, 1);
      }
      B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);           // restore normal alpha blend
    } else if (arenaActive) {
      // Ordinary battle: the per-area arena scene over the arena view's own background colour —
      // SFSTDATA[arenaId]+0x0c is the sky (record 1 = (59,115,233), matching the captured
      // grassland sky), the same view+0x12C the effect-tint feed writes; the fight's setup
      // default is black. Each group carries its own CLUT palette, so its texture is the one
      // resolved for that palette group (decoded live 2026-10-07).
      //
      // BLEND, DECODED LIVE 2026-10-07, NOW APPLIED — see
      // .dw3-research/playtest-arena-palette-rig-2026-10-07/results.md §5: the arena's textured
      // quads are cmd 0x2C (POLY_FT4, texpage semi bits 0), i.e. the GPU draws them OPAQUE
      // (no blending). Applied here only because the SAME display-list interpreter's back-face
      // cull is now run on the arena draw (`arenaCullIndices`): painting the UNCULLED set opaque
      // blackened the forest (14% black vs the rig frame's 4%) because the pack's back-facing
      // primitives — which the original drops before packing — covered the scene. With the cull
      // the surviving set is the original's own post-cull set, so opaque paints the scene the
      // original shows. `arenaLegacy` keeps the pre-decode alpha/one-palette render for captures.
      B$.gl!.enable(B$.gl!.BLEND);
      B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
      let skyColor = B$.arenaBg || bgTint || [0, 0, 0, 1];   // the arena view's sky colour
      let stageTint = null;
      if (B$.blastState && (stageId || stageLevel !== CHANGE_STAGE_FULL)) {
        // the stage task's own fade (FIGHTSTG_fadeStage): model colour = level / 0x80, background = bgColor * level >> 7
        const base = stageId
          ? (B$.arenaManifest?.byArena?.[String(stageId)]?.bg ?? [0, 0, 0])
          : (B$.arenaBg ? B$.arenaBg.slice(0, 3).map((v) => Math.round(v * 255)) : [0, 0, 0]);
        const c = changeStageBg(base, stageLevel);
        skyColor = [c[0]! / 255, c[1]! / 255, c[2]! / 255, 1];
        const k = stageLevel / CHANGE_STAGE_FULL;
        stageTint = [k, k, k, 1];
      }
      if (!B$.builtArena) drawQuad(B$.gl!, B$.texP!, B$.IDENT_MVP!, B$.skyBufs!, B$.whiteTex!, 1, skyColor);   // the arena view's sky colour
      const bdPV = mat4Mul(mat4Perspective(fovRad, W / H, 1, 60000), view);
      const world = ps1ToRenderMatrix(MODEL_SCALE * (B$.multiCam ? B$.arenaScale : 1)!);   // larger for many fighters (_layoutExtras)
      const mvp = mat4Mul(bdPV, world);
      B$._atmosArena(atm, world, camEye, camLook, fovRad, W / H, B$.multiCam ? B$.arenaScale : 1);
      const panoP = B$.isolatedMode ? null : B$._panoActive();
      B$.panoLog!.id = B$.pano?.id ?? null; B$.panoLog!.loaded = !!panoP; B$.panoLog!.missing = !!B$.pano?.missing;
      if (panoP) B$._drawPano(panoP, bdPV, camEye, atm);   // F2 painted place (HD Remaster): replaces the whole disc arena
      if (panoP) { const bx = [B$.pAABB, B$.eAABBLast, ...[...B$.extras!.values()].map((f) => f.aabb)].filter(Boolean);
        B$.panoLog!.eye = camEye.slice(); B$.panoLog!.feet = bx.map((b) => +b!.min[1]!.toFixed(1)); B$.panoLog!.heights = bx.map((b) => +(b!.max[1]! - b!.min[1]!).toFixed(1)); B$.panoLog!.xz = bx.map((b) => [Math.round((b!.min[0]! + b!.max[0]!) / 2), Math.round((b!.min[2]! + b!.max[2]!) / 2)]); }
      arenaCullLog.kept = 0; arenaCullLog.total = 0; arenaCullLog.groups = [];
      if (B$.arenaDebug!.opaque) B$.gl!.disable(B$.gl!.BLEND);         // OPAQUE: the decoded arena blend (cmd 0x2C)
      else { B$.gl!.enable(B$.gl!.BLEND); B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA); }
      // DEPTH-SORT THE ARENA — the original's ordering table, ported by the SAME display-list
      // interpreter. Each arena primitive carries an OT Z the walker already decodes
      // (`engine/dw3/battle-displaylist.ts#buildMeshFields`: `fields.otz = avsz(...)`, read off
      // node+0x7c) and the original inserts its quads into that table, so the GPU draws them
      // back-to-front by depth. Our arena draw instead emits one drawElements per (page, CLUT)
      // TEXTURE group, which reorders the primitives relative to the display list; with depth
      // writes off (the frame sets depthMask(false)), the last group drawn wins, so a far
      // sky/backdrop group painted over the near ground — the operator's "flat blue rectangular
      // patches / disconnected chunks". Writing depth restores the original's depth order: the
      // render becomes independent of the grouping, exactly as the OT makes it independent of
      // the emit order. Decoded + measured 2026-10-07,
      // .dw3-research/arena-construction-2026-10-07/worker-e.md.
      if (B$.arenaDebug!.depthWrite) B$.gl!.depthMask(true);
      if (panoP?.paint) B$._drawArenaPaint(panoP, mvp, world, atm);
      const _pf3 = globalThis.__perfHook3d, _pt3 = _pf3 ? performance.now() : 0;   // dev-only timing hook (web/perf-test.js); unset = no change
      let _ptri = 0;
      // The change stage's model plays its motion (frames 1..1500, looping): each mesh turns by its
      // rotation track at the motion frame. The battle stage is drawn at rest (its end pose).
      const motionU = stageId && B$.blastState ? changeStageMotionFrame(B$.blastState.frame) : 0;
      for (const g of panoP || B$.builtArena ? [] : shownArena.groups) {
        if (!g.count) continue;
        const tex = B$.arenaTextureFor(shownArena, g);
        let gm = mvp;
        if (stageId && g.rotKeys) gm = mat4Mul(mvp, changeStageMat4(g.rotKeys, motionU));
        const idx = B$.arenaDebug!.cull ? arenaCullIndices(gm, g) : null;
        if (idx) arenaCullLog.groups.push({ page: g.page, clut: g.clut, kept: idx.length / 3, total: (g.count / 3) | 0 });
        if (_pf3) _ptri += (g.count / 3) | 0;
        if (B$.arenaDebug!.cull) drawProjLayerIndexed(B$.gl!, B$.texP!, gm, g, tex, idx, stageTint!);
        else drawProjLayer(B$.gl!, B$.texP!, gm, g, tex, 1, stageTint!);
      }
      if (_pf3) _pf3("arenaGroups", performance.now() - _pt3, _ptri);
      B$.gl!.enable(B$.gl!.BLEND);
      B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
      if (atm) B$._atmosArena(null);
      // THE ARENA IS A BACKGROUND LAYER — its own pass must not reject the entities drawn after
      // it. The arena writes depth above so its (page,CLUT) groups depth-sort like the original's
      // ordering table (the flat-blue-patch fix), but the Digimon and the effects are drawn AFTER
      // this branch and depth-test with LEQUAL. The arena is drawn through a 60000-far projection
      // and the ordinary fighters through an 8000-far one, so at the same world point the
      // fighter's window depth is a hair LARGER (farther) than the arena's and LEQUAL throws the
      // fighter fragment away: a standing fighter lost its legs and a DOWNED fighter (flat at
      // floor level) vanished entirely — the operator's "monsters falling through the ground /
      // downed Minotarumon almost invisible". MEASURED 2026-10-07 on the live renderer: enemy
      // silhouette 5148 -> 20770 px with the arena write off, downed enemy 0 -> 10986 px.
      // .dw3-research/fighter-depth-regression-2026-10-07/worker-u.md.
      //
      // The original has no z-buffer here: it sorts whole primitives back-to-front in its ordering
      // table, so the arena background is painted and the entities are painted over it — no
      // fighter is ever depth-rejected by the background. Reproduce that: the arena's own order is
      // already resolved on the colour buffer, so CLEAR the depth it wrote and let the
      // fighters/effects start from a clean buffer. This is the treatment the sky (depthMask
      // false) and the face box (its own depth clear) already get, and it cannot regress the
      // flat-patch fix, which lives in the colour buffer now, not the depth buffer.
      if (B$.arenaDebug!.depthWrite && B$.arenaDebug!.depthClear) B$.gl!.clear(B$.gl!.DEPTH_BUFFER_BIT);
    } else {
      drawQuad(B$.gl!, B$.texP!, B$.IDENT_MVP!, B$.skyBufs!, B$.skyTexture, 1, bgTint || [1,1,1,1]);
    }
    B$.gl!.depthMask(true);

    // Arena floor (skipped during the special: the backdrop is a full-screen 2D scene; and skipped
    // when the disc's own per-area arena is loaded, which supplies its own ground — and skipped in
    // the viewer's isolated mode, where the neutral grid below is the ground).
    if (!dfActive && !dnaVoidActive && !arenaActive && !B$.isolatedMode)
      drawQuad(B$.gl!, B$.texP!, pv, B$.floorBufs!, B$.arenaTexture || B$.whiteTex!, 1, [0.8,0.8,0.85,1]);
    if (B$.isolatedMode && B$.viewerStudio) B$.drawViewerGrid(pv);

    // The change stage's fades (stage.c, engine digivolveStageBrightness): the battle stage dims to black
    // before the change and comes back from black after it. The stage is the sky / arena / floor drawn
    // above, so a black layer at voidAlpha darkens exactly that, under the fighters and the sprites.
    // (voidAlpha 1 is the black void branch above.)
    if (B$.blastState && B$.blastState.voidAlpha > 0 && B$.blastState.voidAlpha < 1) {
      const depthOn = B$.gl!.isEnabled(B$.gl!.DEPTH_TEST);
      B$.gl!.disable(B$.gl!.DEPTH_TEST);
      B$.gl!.depthMask(false);
      B$.gl!.enable(B$.gl!.BLEND);
      B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
      drawQuad(B$.gl!, B$.texP!, B$.IDENT_MVP!, B$.skyBufs!, B$.whiteTex!, B$.blastState.voidAlpha, [0, 0, 0, 1]);
      B$.gl!.depthMask(true);
      if (depthOn) B$.gl!.enable(B$.gl!.DEPTH_TEST);
    }

    // op3 sprites spawned at z == -1 (every effect but 1000-1002/1007) sit BEFORE the fighters in the
    // original ordering table: over the stage, under the Digimon (sprite_anim.c:13-45). Drawn here,
    // after the backdrop/arena/floor and before the fighters; getEffectDraw() leaves them out of the 2D pass.
    if (B$.effectPlayer && B$.effectAssets) {
      const underFx = [...B$.effectPlayer.renderList(), ...B$._dnaSampleSprites()].filter(s => effectLayer(s) === "under");
      if (underFx.length) drawUnderEffects(B$.gl!, underFx, B$.effectAssets.manifest, B$.effectAssets.images, { centerX: W / 2, centerY: H / 2, pxScale: H / 240, worldToScreen: () => null }, W, H);   // screen-space sprites only: same view maths as getEffectDraw
    }

    // ── Digimon rendering (skeletal if loaded, billboard fallback) ──
    // Blast and manual digivolve: the change task wipes the partner between its solid layer (rows above
    // the wipe row) and its green wireframe layer (rows below); the model is the old partner until the
    // swap (f278) and the new form after it (state.wipeRow, see the block below). The white flash is
    // painted by web/blast-presentation.js over this frame.
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
    if (B$.sceneLight) B$._sceneLightDraw(true);
// SCENE-LIGHT-END
// TOON-BEGIN (F2 "Toon outlines" / "Toon shading", off by default; strip these blocks = the code before toon)
    const toonSt = B$._toonState();
    if (toonSt) B$._toonBegin(toonSt, camEye, camLook);
// TOON-END
// SOFTA-BEGIN (F2 "Smooth cut-out edges", off by default; strip these blocks = the code before softa)
    const softA = !!window.__fx?.softalpha;
    if (softA) { B$.gl!.useProgram(B$.texP!.program); B$.gl!.uniform2f(B$.texP!.uSoftA, 1, 2 / 1024); }
// SOFTA-END
    if (B$.blastState && B$.blastState.wipeRow !== undefined && B$.playerModel && B$.playerSkelBufs) {
      // Blast and manual DV: the change task's wipe (digimon_change.c setChangeClips, engine
      // digivolveWipeRow). The solid layer is clipped to the top native rows [0, wipeRow), the wireframe
      // layer of the SAME model to the rows [wipeRow, 240). The model is the old partner until the swap
      // (f278), the new one after it; the main view spans the 240 native rows over the canvas height.
      const rowPx = Math.round(B$.blastState.wipeRow * H / 240);
      B$.gl!.enable(B$.gl!.SCISSOR_TEST);
      if (rowPx > 0) {
        B$.gl!.scissor(0, H - rowPx, W, rowPx);
        drawSkeletalMesh(B$.gl!, B$.texP!, pv, B$.playerSkelBufs, B$.playerTex || B$.whiteTex!, fighterTint("player"));
      }
      if (B$.blastState.wireOn && rowPx < H) {
        B$.gl!.scissor(0, 0, W, H - rowPx);
        B$.gl!.enable(B$.gl!.BLEND);
        B$.gl!.blendFunc(B$.gl!.ONE, B$.gl!.ONE);                    // additive: it glows
        drawSkeletalMesh(B$.gl!, B$.texP!, pv, B$.playerSkelBufs, B$.whiteTex!,
          [0.18, 1.0, 0.28, 1], 1, true);
        B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
      }
      B$.gl!.disable(B$.gl!.SCISSOR_TEST);
    } else if (B$.playerVisible && B$.playerModel && B$.playerSkelBufs) {
      // Also the entrance (entrance.c): no wipe, no wireframe, the ordinary model. The entering fighter's OLD model
      // stays until the cut (models->setId, f114), the new one is drawn from there; the other side's model is
      // hidden through playerVisible / enemyVisible.
      drawSkeletalMesh(B$.gl!, B$.texP!, pv, B$.playerSkelBufs, B$.playerTex || B$.whiteTex!, fighterTint("player"));
    } else if (B$.playerVisible) {
      // The billboard quad's normal is render +Z, which under the one mapping is the PS1
      // screen's own toward-the-viewer, so the page reads the same way the console draws it.
      // The player's old flipX=true was a compensation for the mirrored world and goes with it.
      drawDigimonBillboard(B$.gl!, B$.texP!, pv, playerPos, B$.DIGI_W!, B$.DIGI_H!,
        B$.playerTex || B$.whiteTex!, 1, fighterTint("player"), false);
    }
    if (B$.enemyVisible && B$.enemyModel && B$.enemySkelBufs) {
      drawSkeletalMesh(B$.gl!, B$.texP!, pv, B$.enemySkelBufs, B$.enemyTex || B$.whiteTex!, fighterTint("enemy"));
    } else if (B$.enemyVisible) {
      drawDigimonBillboard(B$.gl!, B$.texP!, pv, enemyPos, B$.DIGI_W!, B$.DIGI_H!,
        B$.enemyTex || B$.whiteTex!, 1, fighterTint("enemy"), false);
    }
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
    if (B$.sceneLight) B$._sceneLightDraw(false);
// SCENE-LIGHT-END

    if (B$.extras!.size) B$._drawExtras(pv);
// SOFTA-BEGIN (F2 "Smooth cut-out edges", off by default; strip these blocks = the code before softa)
    if (softA) { B$.gl!.useProgram(B$.texP!.program); B$.gl!.uniform2f(B$.texP!.uSoftA, 0, 0); }
// SOFTA-END
// TOON-BEGIN (F2 "Toon outlines" / "Toon shading", off by default; strip these blocks = the code before toon)
    if (toonSt) B$._toonEnd(toonSt, pv, proj, H);
// TOON-END

    // Floor shadow ellipses. The Blast vortex has no floor to cast onto — the
    // capture is a black void from f180 — so both shadows drop with it.
    const studioOff = B$.isolatedMode && !B$.viewerStudio;
    if (B$.playerVisible && !blastDark && !studioOff) drawShadow(B$.gl!, B$.texP!, pv, playerPos, 20, 8);
    if (B$.enemyVisible && !blastDark && !studioOff)  drawShadow(B$.gl!, B$.texP!, pv, enemyPos,  20, 8);
    if (atm) { B$._drawWeather(pv, atm, camEye, camLook); B$._atmosUniforms(null); }   // effects keep the game's own colours

    // ── op6 flight meshes: root at the muzzle, per-layer ctrl-track TRS animation ──
    // The original builds a layer array of count+1 blocks (FIGHTSTG_F0x80084560): index 0 is
    // an implicit ROOT with no mesh, and the program rows fill 1..count. Every frame
    // FIGHTSTG_F0x80083e0c runs, in this order:
    //   1. sample all three ctrl sub-tracks for every layer (F0x800835f4 → +0x10 T,
    //      +0x18 R, +0x20 S, lerped between bracketing keyframes);
    //   2. OVERWRITE the root layer's translation and rotation with op6's from/to
    //      (ctrl+0x1c → layer0+0x10, ctrl+0x22 → layer0+0x18, at 0x800840e0..0x80084154) —
    //      which is why the root's placement is op6 data and not authored keyframes;
    //   3. per layer: hide test, then matrix = R(F0x8002b45c, Rz·Ry·Rx) scaled by S
    //      (F0x8002b23c is M·diag(s), i.e. R·S) with T widened into the matrix's translation,
    //      then CONCATENATED WITH THE PARENT LAYER'S matrix (GTE MVMVA per column at
    //      0x8008422c/0x80084270/0x800842b4).
    // So a layer's world transform is the product down its parent chain, not root·local.
    // 184 of the 572 shipped layer rows name a non-root parent.
    //
    // Hide rule (0x8008416c..0x80084194): the three scale components are read with `lh`
    // (SIGNED) and bitwise-ORed, then compared `slti 0x31`. A negative component sets the
    // sign bit, so ANY negative scale hides the layer — this is not an absolute-value test.
    // That is how staged effects reveal the bullet late.
    if (B$.effectPlayer) {
      const flights = B$.effectPlayer.projectileList();
      for (const fl of flights) {
        B$.loadProjMesh(fl.id);
        const entry = B$.projCache!.get(fl.id);
        if (!entry || entry === "loading") continue;
        const s = MODEL_SCALE;
        // flight space -> render world as a matrix (the one mapping, ps1ToRenderMatrix —
        // and no per-side mirror: the packs are authored per side).
        const world = ps1ToRenderMatrix(s);
        const root = mat4Mul(mat4Translate(fl.pos.x, fl.pos.y, fl.pos.z),
                             mat4RotPSX(fl.rot?.x || 0, fl.rot?.y || 0, fl.rot?.z || 0));
        const base = mat4Mul(pv, mat4Mul(world, root));
        B$.gl!.depthMask(false);
        // Sample at the CLIP's frame for this tick, not at the raw tick: a clip can hold,
        // and packs 108/109 replay their beam segment four times, which a raw tick cannot
        // express.
        const frame = clipFrameAt(entry.clip, fl.t);
        const { world: layerWorld, shown } = projLayerWorlds(entry.layers, frame, base);
        for (let li = 0; li < entry.layers.length; li++) {
          const L = entry.layers[li];
          if (!L!.count || !shown[li + 1]) continue;
          for (const g of L!.groups) {
            // PS1 semi-transparency, already converted from the one-based `0xEn` state nibble
            // by meshAbrMode. `null` means the primitive carries no semi-transparent bit at
            // all and is drawn OPAQUE; otherwise the hardware mode is
            //   0 = 0.5·B + 0.5·F,  1 = B + F (additive glow),
            //   2 = B − F (subtractive),  3 = B + 0.25·F (faint additive).
            // After the conversion nothing in the shipped packs uses mode 2 — the subtract
            // path stays only because the hardware has it.
            if (g.abr === null) {
              // Opaque. The texel still drops out where its palette entry is 0x0000, which
              // the atlas bakes as alpha 0, so this is a straight cut-out draw.
              B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
            } else if (g.abr === 2) {
              B$.gl!.blendEquation(B$.gl!.FUNC_REVERSE_SUBTRACT);
              B$.gl!.blendFunc(B$.gl!.ONE, B$.gl!.ONE);
            } else if (g.abr === 0) {
              B$.gl!.blendColor(0, 0, 0, 0.5);
              B$.gl!.blendFunc(B$.gl!.CONSTANT_ALPHA, B$.gl!.ONE_MINUS_CONSTANT_ALPHA);
            } else if (g.abr === 3) {
              B$.gl!.blendColor(0, 0, 0, 0.25);
              B$.gl!.blendFunc(B$.gl!.CONSTANT_ALPHA, B$.gl!.ONE);
            } else {
              B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE);
            }
            drawProjLayer(B$.gl!, B$.texP!, layerWorld[li + 1], g, g.tex, 1.0);
            B$.gl!.blendEquation(B$.gl!.FUNC_ADD);
          }
        }
        B$.gl!.blendEquation(B$.gl!.FUNC_ADD);
        B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
        B$.gl!.depthMask(true);
      }
    }

    // ── Face-cam: OUR OWN Digimon's head in the box, whoever is speaking ──────────
    // Layer key 0x1009 shows a close-up of the player's partner (fighter slot 0 of the
    // battle manager). Speaker id 0 is the player side, 0x10 the enemy side
    // (terra-037-speaker16-enemy-side-20260906) and it chooses only WHICH of the record's
    // two framings is used (group 6 = player line, group 7 = enemy line).
    // WHETHER it is up at all is the box object's own rule (see faceBox below): up while
    // this side's command menu is up, down from the moment a battle message line is up,
    // back at the next menu. A presentation (Blast / digivolve / clip-12) covers it.
    B$.faceCamRect = null;
    // The Blast transformation suppresses the face-cam inset, the way clip-12
    // Jogress does. Gated on the renderer's own state rather than a one-shot
    // call from battle.js: the 3D context is built asynchronously, so a call
    // made at trigger time can land before this renderer exists.
    const enemySpeaks = B$.faceCamSpeaker === "enemy";
    // The box's camera is the PLAYER'S OWN stored framing, not a camera of ours, and the
    // record it comes out of is the player's fighter's — never the speaker's.
    // FIGHTSTG_F0x80094064 (fightstg.s:17805-17840) asks the battle manager for ONE fighter
    // record and hands the box both that record and its +0x14, so the speaker cannot move
    // either; F0x80091c1c (:15355-15409) then reads group 6 or 7 out of that record by the
    // speaker's side and F0x80091b8c (:15316-15352) builds the look-at from it. See
    // web/fight/battle-camera.js (faceBoxSource) for the full read, and
    // docs/research/battle/captures/face-box-camera-2026-10-03/ for the live capture that
    // shows the same record (383) for a player line and for an enemy line. Same PS1 ->
    // render mapping as every other shot here: ps1ToRender, the one mapping.
    const fb = faceBoxSource(B$.placementTable, modelKeyFromFolder(B$.playerFolder),
                             enemySpeaks ? "enemy" : "player");
    const faceShot = B$.fittedFaceShot(fb.side) ?? fb.shot;
    // Whether this record's own projection distance can put a picture in the box. It is the
    // console's arithmetic (see faceBoxDraws), not a judgement about the record: a record with
    // no projection distance shows the battle view's own picture through the window, because
    // every vertex it would submit lands on the same point.
    const boxDraws = faceBoxDraws(faceShot);
    B$.faceBoxSubject = {
      key: fb.key, side: fb.side, group: fb.group,
      // Both fighters' own model keys, so a headless check can prove the box's
      // record is the PLAYER's and not the enemy's (the capture that settles it
      // reads 383 for both a player line and an enemy line).
      playerKey: modelKeyFromFolder(B$.playerFolder),
      enemyKey: modelKeyFromFolder(B$.enemyFolder),
      framed: boxDraws,
      // What the console read for this record, projection distance included, so a headless
      // check can see a neighbour read rather than a filter's verdict. null only for the two
      // records whose read leaves the SMDLDATA block (model keys 70 and 177).
      shot: faceShot,
    };
    // The subject is drawn in the player's own arena slot, which is where the box's stored
    // eye and target already point, so this is the plain player placement (arenaSlot).
    const boxSlot = arenaSlot(fb.record, "player");
    const boxPos = ps1ToRender(boxSlot, ARENA);
    if (B$.faceBoxOnScreen && !B$.faceBoxSuppressed && !B$.blastState
        && B$.playerVisible && B$.playerSkelBufs && B$.pAABB) {
      // Inner face TIM/viewport: 100×60 at (208, 76). The 104×64 bezel around
      // it is PGFGTC00 cel 0xA, drawn in battle.js.
      const uiScale = Math.min(W / 320, H / 240);
      const uiX = (W - 320 * uiScale) * 0.5;
      const uiY = (H - 240 * uiScale) * 0.5;
      const fw = Math.round(100 * uiScale);
      const fh = Math.round(60 * uiScale);
      const fx = Math.round(uiX + 208 * uiScale);
      const fyTop = Math.round(uiY + 76 * uiScale);
      const glY = H - fyTop - fh;    // GL viewport origin is bottom-left

      // The box is a WINDOW ONTO THE SAME 3D SCENE, not a portrait on a blank card. In the
      // original it is a view in its own right: rectangle 208,76,100,60 registered as layer
      // key 0x1009, window centre 258,106 (+0x118 at fightstg.s:17795), and an ordering
      // table of 50 entries (+0x148 at :17800 — F0x8001e1e8 stores the count at view+0x78 and
      // allocates count*20, so 0x32 is the table's depth, NOT a half-width). The console's
      // render pass walks all 30 views and runs each enabled view's own table
      // (F0x8001d504 -> view->0x154 = F0x8001e38c), so the box is a second view of the same
      // scene, and the reference frame shows the stage in it — cloud sky across the top third,
      // the arena floor and the far cliff below the head
      // (docs/research/battle/captures/face-box-rounds-2026-10-03/1-round1-menu-box-up.png).
      //
      // So the box draws the SAME stage objects this frame already drew for the battle view —
      // the sky quad and the arena floor, no second load — but through the BOX camera. Only
      // the sky quad is screen-space (identity MVP, so it covers whatever viewport it is
      // drawn into); the floor and the head go through the record's own shot. faceBoxScene
      // is that list, in one place, with the battle view's own backdrop rule folded in.
      //
      // WHEN THE RECORD'S PROJECTION DISTANCE IS NOT ONE, the original draws nothing here.
      // F0x80091c1c reads H out of the record and hands it over with no test at all
      // (fightstg.s:153cc4 -> :153ce0 -> :153bf0), and H reaches the GTE through one
      // `ctc2` (exe/fns.s:29902). With H == 0 the PS1's RotTransPers scale
      // ((H*0x20000/SZ3)+1)/2 is zero, so every vertex of every polygon submitted into this
      // view lands on the same point — the drawing offset, which the vertex loop adds to a
      // point's own window centre (fightstg.s:838dc-83920) — and a triangle whose three
      // vertices coincide has no area, so the GPU fills nothing. Nothing skips the draw
      // either: the view is still enabled, its table still runs, and its depth sort still
      // orders the polygons. The list is therefore EMPTY, and because this view has no
      // background colour of its own (the box driver never calls +0x12C, the view
      // constructor never writes view+0x18, and F0x800266b4 skips the fill when that flag is
      // clear — exe/fns.s:24595-24601) the window is left showing the battle view's own
      // picture, un-zoomed, behind the bezel. Which is why nothing here clears the window
      // when the list is empty.
      const scene = faceBoxScene({
        backdropOnly: dfActive || dnaVoidActive, draws: boxDraws,
      });
      if (scene.length) {
        B$.gl!.enable(B$.gl!.SCISSOR_TEST);
        B$.gl!.viewport(fx, glY, fw, fh);
        B$.gl!.scissor(fx, glY, fw, fh);
        B$.gl!.clearColor(0.04, 0.05, 0.09, 1);
        B$.gl!.clear(B$.gl!.COLOR_BUFFER_BIT | B$.gl!.DEPTH_BUFFER_BIT);

        const boxBufs = B$._faceBoxBuffers(B$.gl!);
        const s = MODEL_SCALE;
        const boxWorld = (v: number[]) => ps1ToRender(v, s);
        _updateSkeletalVBOGL(B$.gl!, B$.playerModel, boxBufs, B$.pBwm, boxPos, MODEL_SCALE,
                             false, playerYaw);
        // The picture inside the box is the 320x240 projection taken about the box's OWN
        // centre (258,106) and clipped to the 100x60 window, at the record's own projection
        // distance H. So the visible half-angles are atan(30/H) up and atan(50/H) across —
        // the window's size in game pixels over the same focal length the battle camera uses,
        // which is what faceBoxFovY returns. The window's aspect is the window's (100:60),
        // not the screen's, or the horizontal angle would come out 4/3 too wide.
        const fEye = boxWorld(faceShot.eye);
        const fLook = boxWorld(faceShot.target);
        const fProj = mat4Perspective(faceBoxFovY(faceShot.H) * Math.PI / 180,
                                      FACE_BOX_ASPECT, 1, 8000);
        const boxPV = mat4Mul(fProj, mat4LookAt(fEye, fLook, B$.UP!));
        for (const item of scene) {
          const mvp = item.mvp === "identity" ? B$.IDENT_MVP! : boxPV;
          if (item.what === "sky") {
            // No depth write: the sky is behind everything and must not occlude the head.
            B$.gl!.depthMask(false);
            drawQuad(B$.gl!, B$.texP!, mvp, B$.skyBufs!,
                     item.tex === "void" ? B$.whiteTex! : B$.skyTexture, 1, item.tint);
            B$.gl!.depthMask(true);
          } else if (item.what === "floor") {
            drawQuad(B$.gl!, B$.texP!, mvp, B$.floorBufs!, B$.arenaTexture || B$.whiteTex!, 1, [0.8,0.8,0.85,1]);
          } else {
            drawSkeletalMesh(B$.gl!, B$.texP!, mvp, boxBufs, B$.playerTex || B$.whiteTex!, fighterTint("player"));
          }
        }
        B$.gl!.disable(B$.gl!.SCISSOR_TEST);
      }
      B$.gl!.viewport(0, 0, W, H);
      B$.faceCamRect = { x: fx, y: fyTop, w: fw, h: fh };
    }
  }
// ETS item 9: a world position is always an [x, y, z] triple.
function drawDigimonBillboard(gl: WebGLRenderingContext, prog: TexProgram, mvp: Float32Array, worldPos: number[], w: number, h: number, tex: WebGLTexture | null, alpha: number, tint: number[] | null, flipX: boolean) {
    const hw = w * 0.5;
    // billboard always faces camera — use camera right from view matrix
    // For simplicity use fixed right/up since camera is fixed
    const cx = worldPos[0]!, cy = worldPos[1]!, cz = worldPos[2]!;
    // slight angle toward center of arena
    const lean = worldPos[0]! < 0 ? -0.05 : 0.05;

    const tl = [cx - hw, cy + h, cz + lean * h];
    const tr = [cx + hw, cy + h, cz - lean * h];
    const br = [cx + hw, cy,     cz];
    const bl = [cx - hw, cy,     cz];

    const u0 = flipX ? 1 : 0;
    const u1 = flipX ? 0 : 1;
    const bufs = makeQuadBuffers(gl, [tl, tr, br, bl], [[u0,0],[u1,0],[u1,1],[u0,1]]);
    drawQuad(gl, prog, mvp, bufs, tex, alpha, tint);
    gl.deleteBuffer(bufs.vbo); gl.deleteBuffer(bufs.ubo); gl.deleteBuffer(bufs.ibo);
  }
function drawShadow(gl: WebGLRenderingContext, prog: TexProgram, mvp: Float32Array, pos: number[], rx: number, ry: number) {
    // Flat ellipse on floor (y=0) as a dark transparent quad
    const cx = pos[0]!, cz = pos[2]!;
    const verts = [
      [cx-rx, 0.2, cz-ry], [cx+rx, 0.2, cz-ry],
      [cx+rx, 0.2, cz+ry], [cx-rx, 0.2, cz+ry],
    ];
    const bufs = makeQuadBuffers(gl, verts, [[0,0],[1,0],[1,1],[0,1]]);
    drawQuad(gl, prog, mvp, bufs, B$.whiteTex!, 0.35, [0,0,0,1]);
    gl.deleteBuffer(bufs.vbo); gl.deleteBuffer(bufs.ubo); gl.deleteBuffer(bufs.ibo);
  }
function destroy() {
    B$.clearFighters();
    for (const pk of Object.values(B$.backdropPacks!)) {
      if (pk.floorTex) B$.gl!.deleteTexture(pk.floorTex);
      if (pk.wallTex) B$.gl!.deleteTexture(pk.wallTex);
      for (const g of pk.groups || [])
        if (g && g.vbo) { B$.gl!.deleteBuffer(g.vbo); B$.gl!.deleteBuffer(g.ubo); }
    }
    [B$.arenaTexture, B$.skyTexture, B$.playerTex, B$.enemyTex, B$.whiteTex!].forEach(t => {
      if (t) B$.gl!.deleteTexture(t);
    });
    B$.gl!.deleteBuffer(B$.floorBufs!.vbo); B$.gl!.deleteBuffer(B$.floorBufs!.ubo);
    B$.gl!.deleteBuffer(B$.floorBufs!.ibo);
    B$.gl!.deleteBuffer(B$.skyBufs!.vbo); B$.gl!.deleteBuffer(B$.skyBufs!.ubo);
    B$.gl!.deleteBuffer(B$.skyBufs!.ibo);
    B$.freeSkelBufs(B$.playerSkelBufs!);
    B$.freeSkelBufs(B$.enemySkelBufs!);
    B$.gl!.deleteProgram(B$.texProg!);
  }
  return { render, drawDigimonBillboard, drawShadow, destroy };
}
