// The digivolution camera, exactly the original's (FIGHTSTG_updateDigimonChange, digimon_change.c).
// Normal digivolve (key2 = 0) and Blast (key2 = 1) run the SAME camera:
//
//   startChange        getFighterView(near, shot 9); vpz += -homePos.z; vrz += -homePos.z; camera->set   (a CUT)
//   swapInNewDigimon   the same cut again, for the new model
//   (between them)     the camera does not move: no dolly, no push-in, no zoom, no fit
//   substate 12        camera->set(getFighterView(near, 9))                    (a CUT to plain shot 9)
//   returnToBattle     camera->fade(NULL, getEnemyView, 60)
//
// WHEN (60 Hz ticks, f0 = the start cut; the interpreter's frames, engine/systems/blast-presentation.ts
// formChangeCameraSchedule): start cut f0, swap cut f278, plain cut f649, fade armed f651; the change task
// starts on f-214 and the camera task runs from there. The same change task also: hides the enemy model at
// startChange (f0) and shows it at returnToBattle (f651), sets the old model's motion 14 (Blast) / 13 (manual)
// on f0, the new model's motion 13 on f437, and the final motion on f651 (this object only REQUESTS the
// numbers through deps.setMotion / deps.setEnemyVisible, like createRevertCamera).
//
// getEnemyView is getFighterView(near side, far record's +0x44 - 1), which is the ARENA shot the
// battle opens on (battle_camera.c:188-206), so the fade target is `arena()`, the same provider
// the opening cut uses.
//
// This file only DRIVES the one camera-record owner (createCameraRecord): the cut is `cut`, the
// fade is `move(..., 60)`, and the fade's own integer maths (lerpFields, op5GlideRate, op5GlideT,
// the snap at 0x1000) is the already-ported code in battle-camera.js. Nothing is re-derived here.

import { fieldsFromShot, CAMERA_FRAME_DELTA } from "./battle-camera.js";

// FRAME ORDER (normal_battle.h: camera child 0x08 runs before the change / entrance task 0x1C;
// registry.c runChildTasks in index order; battle_camera.c set/fade only STORE and the camera
// applies them on its NEXT run). The original frame is:
//   1) the camera task advances t and applies the view   2) the change/entrance task may set()/fade()
//   3) the frame is drawn with the view of step 1.
// So a cut called on frame A is first SHOWN on A+1, and a fade armed on A shows tick k on A+k.
// stepFormChangeFrame is that frame, and it is the ONE function both web/battle3d.js and the tests
// call, so they cannot run in different orders.

/**
 * One presentation frame of a form change. Returns the view to DRAW (a snapshot taken before the
 * schedule runs): {shot, fields}; shot is null when the change does not own the camera yet.
 * @param {object} camRec  the camera-record owner
 * @param {{preStep:Function, elapsed:Function, update:Function, owns:Function}} cam
 * @param {number} frame   the presentation frame
 */
export function stepFormChangeFrame(camRec, cam, frame) {
  cam.preStep(frame);                                 // work armed before the presentation's f0
  const n = cam.elapsed(frame);                       // presentation frames since the last step
  if (n > 0) camRec.tick(n * CAMERA_FRAME_DELTA);     // 1) the camera task
  const fields = camRec.live();                       //    the view of this frame (record fields)
  const shot = camRec.sample();                       //    and its composed shot
  cam.update(frame);                                  // 2) the change / entrance task: cut / arm / hide
  return { shot: cam.owns() ? shot : null, fields };  // 3) drawn with the step-1 view
}

/**
 * The skip ("Digivolve Demo: OFF"). The original has no skip, so the skip is the END STATE of the
 * original presentation reached in one step: the camera is the enemy view (introShot) fully
 * snapped (the fade's frame-0x1000 snap, as a cut), the enemy model is shown, the change no
 * longer owns the camera. Non-skip frames never call this.
 * @param {object} camRec
 * @param {{stop:Function}|null} cam      the digivolve / revert camera (may be null)
 * @param {() => ({eye:number[],target:number[],H:number,roll?:number}|null)} arena  the enemy view
 * @param {(visible:boolean) => void} setEnemyVisible
 */
export function skipFormChange(camRec, cam, arena, setEnemyVisible) {
  cam?.stop();
  const target = arena();
  if (target) camRec.cut(fieldsFromShot(target), { issuer: DV_ISSUER });
  setEnemyVisible(true);
}

/**
 * Counts the presentation frames between steps (1 on the first step, so the first frame = one camera run).
 * `first` is the frame before the first step (-1: the revert and tests that start on f0; the digivolve camera
 * passes taskStartFrame - 1, so the camera task runs every frame from the change task's first run).
 */
function makeStepper(first = -1) {
  let stepped = first;
  return (frame) => {
    const f = frame | 0;
    const n = Math.max(0, f - stepped);
    stepped = Math.max(stepped, f);
    return n;
  };
}
/** returnToBattle arms its fade this many frames after the plain shot-9 cut (substates 12, 13, 14). */
export const DV_RETURN_FADE_DELAY = 2;

/** The partner's near-side camera the change uses (getFighterView(camera, 0, 9)). */
export const DV_SHOT_INDEX = 9;
/** returnToBattle's fade length, in frames. */
export const DV_FADE_FRAMES = 60;
/** The record issuer tag: not "battle", so the renderer treats the shot as an explicit one. */
export const DV_ISSUER = "digivolve";

/**
 * Shot 9 as the change installs it at the start and at the swap: the shot's record with
 * `-homePos.z` added to the eye z and the look z. `homeZ` is the partner's home slot z in the
 * same PS1 units as the shot (near side: -(0x1400 + standoff)).
 */
export function shotNineWithHomeOffset(shot, homeZ) {
  const fields = fieldsFromShot(shot);
  const z = -(homeZ | 0);
  fields[2] += z;   // vpz
  fields[5] += z;   // vrz
  return fields;
}

/**
 * @param {object} deps
 * @param {object} deps.camRec        the camera-record owner (createCameraRecord)
 * @param {() => ({eye:number[],target:number[],H:number,roll?:number}|null)} deps.shotNine   near shot 9
 * @param {() => ({eye:number[],target:number[],H:number,roll?:number}|null)} deps.arena      the enemy view
 * @param {() => number} deps.homeZ   the partner's home z (PS1 units)
 * @param {{startFrame:number, swapFrame:number, returnFrame:number}} deps.schedule
 * @param {() => any} [deps.modelKey]  names the partner model on screen. The model swap loads
 *        asynchronously, so a change of key after the start is the swap too: the same cut is made
 *        again, for the new model's shot 9 and home slot (swapInNewDigimon).
 * @param {(visible:boolean) => void} [deps.setEnemyVisible]  the enemy model's layer (off f0, on f651)
 * @param {(motion:number) => any} [deps.setMotion]  the partner's motion numbers (schedule.startMotion on f0,
 *        newMotion on f437, returnMotion / weakReturnMotion on f651)
 * @param {boolean|(() => boolean)} [deps.weak]  the partner's idleMotion != 0 (the low-HP stance), read on f651
 */
export function createDigivolveCamera({ camRec, shotNine, arena, homeZ, schedule, modelKey = () => null,
  setEnemyVisible = null, setMotion = null, weak = false }) {
  let last = -1;
  let keyAtCut = null;   // the model the last shot-9 cut was made for
  let started = false;
  let returned = false;
  let faded = false;
  let enemyHidden = false;
  let newMotionDone = false;
  const elapsed = makeStepper((schedule.taskStartFrame ?? 0) - 1);
  const fadeFrame = schedule.fadeFrame ?? schedule.returnFrame + DV_RETURN_FADE_DELAY;

  const cutShotNine = (withOffset) => {
    const shot = shotNine();
    if (!shot) return false;
    const fields = withOffset ? shotNineWithHomeOffset(shot, homeZ()) : fieldsFromShot(shot);
    camRec.cut(fields, { issuer: DV_ISSUER });
    keyAtCut = modelKey();
    return true;
  };

  return {
    /**
     * Run every camera event whose frame lies in (previous call, frame]. Events run in the
     * original's order: start, swap, then the return cut followed by the fade.
     */
    update(frame) {
      const f = frame | 0;
      const due = (at) => last < at && at <= f;
      // The start cut fires on the first call that has a shot 9 to cut to.
      if (!started && f >= schedule.startFrame && cutShotNine(true)) {
        started = true;
        // startChange: the enemy model's layer off, the old model's change motion (14 Blast / 13 manual)
        if (setEnemyVisible) { enemyHidden = true; setEnemyVisible(false); }
        if (schedule.startMotion != null) setMotion?.(schedule.startMotion);
      }
      if (started && !returned) {
        const swapDue = due(schedule.swapFrame) && schedule.swapFrame > schedule.startFrame;
        if (swapDue || modelKey() !== keyAtCut) cutShotNine(true);
        // substate 9: the new model's motion 13
        if (!newMotionDone && schedule.newMotionFrame != null && f >= schedule.newMotionFrame) {
          newMotionDone = true;
          setMotion?.(schedule.newMotion);
        }
        if (f >= schedule.returnFrame) {
          returned = true;
          cutShotNine(false);       // substate 12: the plain shot-9 cut (shown on the next frame)
        }
      }
      // returnToBattle (substate 14) arms the fade two frames after that cut; the same run shows the enemy
      // model again and gives the new model its final motion (`key2 != 0 || idleMotion == 0 ? 1 : 2`)
      if (returned && !faded && f >= fadeFrame) {
        faded = true;
        const target = arena();
        if (target) camRec.move(fieldsFromShot(target), DV_FADE_FRAMES, { issuer: DV_ISSUER });
        if (enemyHidden) { enemyHidden = false; setEnemyVisible?.(true); }
        if (schedule.returnMotion != null) {
          const isWeak = typeof weak === "function" ? weak() : weak;
          setMotion?.(isWeak ? schedule.weakReturnMotion : schedule.returnMotion);
        }
      }
      last = f;
    },
    preStep() {},
    elapsed,
    /** True from the start cut until stop(): the camera is the change's, not the battle's. */
    owns() { return started; },
    /** True from the start cut until the return cut: the partner is held at the slot origin. */
    atOrigin() { return started && !returned; },
    stop() {
      if (enemyHidden) setEnemyVisible?.(true);
      last = -1; started = false; returned = false; faded = false; keyAtCut = null;
      enemyHidden = false; newMotionDone = false;
    },
  };
}

// ── The entrance: FIGHTSTG_updateEntrance (entrance.c), key2 = 0 (player) / 0x10 (enemy) ──────────
// Blast ending, a player tag / KO replacement (side 0) and the next enemy / boss bodies (side 1):
//   substate 0   camera.fade(current -> the entering fighter's shot (near 10 / far 2), 60)
//   substate 1   counter >= 30: the OTHER side's model is hidden (player side: the enemy 0x10; enemy side: the partner)
//   substate 3   the white flash is full: showEnteringModel = models->setId (the swap), motion 13, camera.set(shot)   (a CUT)
//   substate 7   camera.fade(current -> enemy view, 60 player / 1 enemy), the other model shown again, motion 1 (2 weak)
// The frames are engine/systems/blast-presentation.ts entranceCameraSchedule(side). The fades are the
// same `move` as the digivolve return (lerpFields / op5GlideRate / op5GlideT, frame 61 snaps).

/** The near shot the entrance frames the returning partner with (getFighterView(camera, 0, 10)). */
export const REVERT_SHOT_INDEX = 10;

/**
 * @param {object} deps
 * @param {object} deps.camRec
 * @param {{fadeFrame:number, hideFrame:number, cutFrame:number, returnFrame:number, returnFadeFrames?:number}} deps.schedule
 *        entranceCameraSchedule(side) (the player's revertCameraSchedule() has no returnFadeFrames: 60)
 * @param {() => ({eye:number[],target:number[],H:number,roll?:number}|null)} deps.shotTen   the entering fighter's shot (near 10 / far 2)
 * @param {() => ({eye:number[],target:number[],H:number,roll?:number}|null)} deps.arena     the enemy view
 * @param {(visible:boolean) => void} deps.setEnemyVisible   the OTHER side's model (the enemy; on the enemy entrance, the partner)
 * @param {(motion:number) => void} [deps.setMotion]         the ENTERING fighter's motion
 */
// The revert's model motions (entrance.c): showEnteringModel sets motion 13 on the cut call (e125 = f114);
// state 7 sets motion 2 when `weak` else 1 on f299. `weak` is the return of WFIGHTMN_setIdleMotion(0, 0)
// (wfightmn overlay, not in the decomp C source: not found). The renderer's clip for each motion number is
// not established either (weak: see techs.c:280, hp - damage <= maxHp/4; `weak` may be a function read at f299): createRevertCamera only REQUESTS the motion number through deps.setMotion.
export const REVERT_ENTER_MOTION = 13;
export const REVERT_IDLE_MOTION = 1;
export const REVERT_WEAK_MOTION = 2;

/**
 * The revert's white flash level (0..255) drawn on presentation frame f = entrance frame e - 11
 * (white_flash.c FIGHTSTG_updateWhiteFlash; entrance.c states 2-5). Additive full-screen quad.
 *   f < 50 : 0.   f50..112 : 4 * (f - 49)  (4 .. 252; speed 0xFF / 60 = 4, first level on e61).
 *   f113, f114 : 255 (4 * 64 = 256 >= 0xFF clamps; the entrance cuts on f114).
 *   f115..177 : 255 - 4 * (f - 114)  (endWhiteFlash(60) on e126; 251 .. 3).   f >= 178 : 0 (KILL).
 */
export function revertFlashLevel(frame) {
  const f = Math.floor(frame);
  if (f < 50 || f >= 178) return 0;
  if (f < 113) return 4 * (f - 49);
  if (f < 115) return 0xFF;
  return 0xFF - 4 * (f - 114);
}

export function createRevertCamera({ camRec, shotTen, arena, schedule, setEnemyVisible, setMotion, weak = false }) {
  let last = -1;
  let started = false;
  let hidden = false;
  let returned = false;
  const elapsed = makeStepper();

  return {
    /**
     * The first fade is armed on schedule.fadeFrame, BEFORE the presentation's f0, from the live
     * record. Arm it here (before the frame's camera run) and run the frames that already passed
     * (fadeFrame+1 .. -1); the frame's own camera run is the step after this.
     */
    preStep(frame) {
      const f = frame | 0;
      if (started || f < schedule.fadeFrame) return;
      const shot = shotTen();
      if (!shot) return;
      camRec.move(fieldsFromShot(shot), DV_FADE_FRAMES, { issuer: DV_ISSUER });
      if (f <= 0) camRec.tick((-schedule.fadeFrame - 1) * CAMERA_FRAME_DELTA);
      started = true;
    },
    elapsed,
    update(frame) {
      const f = frame | 0;
      const due = (at) => last < at && at <= f;
      if (started && !returned) {
        if (!hidden && f >= schedule.hideFrame) { hidden = true; setEnemyVisible(false); }
        if (due(schedule.cutFrame)) {
          const shot = shotTen();
          if (shot) camRec.cut(fieldsFromShot(shot), { issuer: DV_ISSUER });
          setMotion?.(REVERT_ENTER_MOTION);           // showEnteringModel: control->motion = 13
        }
        if (f >= schedule.returnFrame) {
          returned = true;
          setEnemyVisible(true);
          setMotion?.((typeof weak === "function" ? weak() : weak) ? REVERT_WEAK_MOTION : REVERT_IDLE_MOTION);   // state 7: motion = weak ? 2 : 1
          const target = arena();
          if (target) camRec.move(fieldsFromShot(target), schedule.returnFadeFrames ?? DV_FADE_FRAMES, { issuer: DV_ISSUER });
        }
      }
      last = f;
    },
    /** True from the first fade until stop(): the camera is the entrance machine's. */
    owns() { return started; },
    /** The revert never holds the partner at the slot origin. */
    atOrigin() { return false; },
    stop() {
      if (hidden && !returned) setEnemyVisible(true);
      last = -1; started = false; hidden = false; returned = false;
    },
  };
}
