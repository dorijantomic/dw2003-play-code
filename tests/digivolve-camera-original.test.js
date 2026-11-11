// The digivolution camera and timeline are the original's (digimon_change.c FIGHTSTG_updateDigimonChange):
//   start / swap : CUT to the partner's near shot 9, eye z and look z += -homePos.z
//   in between   : the camera does not move (no dolly, no push-in, no fit)
//   substate 12  : CUT to plain shot 9 (no offset)
//   return       : camera.fade(current -> enemy view, 60): integer, ends on frame 61
// TIMELINE (60 Hz game ticks; the presentation frame n = the change task's call count, f = n - 214, f0 = the start cut; identical for manual key2 = 0 and Blast key2 = 1 after f0; the
// facts below are the walker interpreter's, ~/ddw3-walker/tests/helpers/digivolve-change-oracle.js, and the real
// game's, ~/dv-camera/RIG-digivolve.md; /home/dorij/dv-camera/check/timeline-play.mjs compares the play exports
// against that interpreter frame by frame):
//   f-214 task start, f-180 EVOLUTIO, f0 start cut (old partner), wipe 238 -> 0 over f0..f119, flash f240 (+7/tick,
//   255 on f276-277), f278 swap + cut (new partner) + flash falls (0 from f314), f317..f436 wipe back,
//   f437 new motion 13, f618..649 stage back, f649 plain cut, f651 fade 60 + battle music, f711 end, snap shown f712.
// FRAME ORDER (the original's, and battle3d.js's: both call stepFormChangeFrame): the camera task
// ticks and applies, the change task then cuts / arms, the frame draws the camera's view. A cut called
// on frame A is SHOWN on A+1; a fade armed on A shows tick k on A+k.
// The fade maths itself is web/fight/battle-camera.js (lerpFields / op5GlideRate / op5GlideT).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCameraRecord, fieldsFromShot, lerpFields, op5GlideRate, op5GlideT, CAMERA_FRAME_DELTA }
  from "../web/fight/battle-camera.js";
import { createDigivolveCamera, createRevertCamera, revertFlashLevel, REVERT_ENTER_MOTION, REVERT_IDLE_MOTION, REVERT_WEAK_MOTION, stepFormChangeFrame, skipFormChange, DV_FADE_FRAMES, DV_RETURN_FADE_DELAY, REVERT_SHOT_INDEX, shotNineWithHomeOffset }
  from "../web/fight/digivolve-camera.js";
import {
  FormChangeProgram, formChangeCameraSchedule, blastPresentationState, formChangeState, formChangeLength,
  formChangeSoundFrame, formChangeMusicFrame, evolEffectsDue,
  digivolveWipeRow, digivolveFlashLevel, digivolveStageBrightness,
  changeStage, changeStageBg, changeStageMotionFrame, CHANGE_STAGE_MODEL_FRAME, CHANGE_STAGE_BACK_MODEL_FRAME,
  CHANGE_STAGE_MANUAL, CHANGE_STAGE_BLAST, CHANGE_STAGE_BATTLE, CHANGE_STAGE_FULL, CHANGE_STAGE_MOTION_FRAMES,
  revertCameraSchedule, revertFlashLevel as engineFlashLevel, REVERT_LAST_FRAME, REVERT_VISUAL_END_FRAME, REVERT_CAMERA_FADE_END_FRAME,
  entranceCameraSchedule, ENTRANCE_ENEMY_LAST_FRAME, ENTRANCE_ENEMY_CAMERA_FADE_END_FRAME, REVERT_SWAP_FRAME, REVERT_SOUND_FRAME,
  BLAST_SWAP_FRAME, BLAST_HEAL_FRAME, BLAST_LAST_FRAME, MANUAL_DV_LAST_FRAME,
} from "../engine/systems/blast-presentation.ts";

// Synthetic shots (PS1 camera-record units, y and z already negated as the extractor stores them).
const SHOT9 = { eye: [300, -900, -4000], target: [50, -400, -4200], H: 520, roll: 0 };
const ARENA = { eye: [-120, -2500, -9000], target: [10, -600, 3000], H: 410, roll: 0 };
// The near home slot z: -(0x1400 + standoff), standoff 128.
const HOME_Z = -(0x1400 + 128);
const BATTLE0 = { eye: [-43, -1807, -7019], target: [37, -613, 2029], H: 457, roll: 0 };
// The new form: its own shot 9 and home slot.
const NEW_SHOT9 = { eye: [311, -912, -3013], target: [61, -415, -3217], H: 617, roll: 0 };
const NEW_HOME_Z = -(0x1400 + 254);

function rig(program = FormChangeProgram.BLAST_ON) {
  const camRec = createCameraRecord(() => null);
  camRec.cut(fieldsFromShot(BATTLE0), { issuer: "battle" });   // the battle camera live when the change starts
  const schedule = formChangeCameraSchedule(program);
  const cam = createDigivolveCamera({
    camRec, schedule, shotNine: () => SHOT9, arena: () => ARENA, homeZ: () => HOME_Z,
  });
  return { camRec, cam, schedule };
}

/** One presentation frame, exactly as the renderer runs it: stepFormChangeFrame (the shared helper). */
function runFrames(r, from, to, onFrame) {
  for (let f = from; f <= to; f++) {
    const { fields } = stepFormChangeFrame(r.camRec, r.cam, f);
    onFrame(f, fields);
  }
}

// ── The facts (independent of the engine: literal numbers from the interpreter) ──────────────────────
const S = 214;   // n = f + S
const factFlash = (f) => (f < 240 ? 0 : f <= 275 ? 7 * (f - 239) : f <= 277 ? 255 : f <= 313 ? 255 - 7 * (f - 277) : 0);
const factRow = (f) => (f < 0 ? 240 : f <= 119 ? 240 - 2 * (f + 1) : f <= 316 ? 0 : f <= 436 ? 2 * (f - 316) : 240);
const factBright = (f) => (f <= -212 ? 1 : f < -180 ? 1 - (f + 212) / 32 : f <= 650 ? 0 : f < 682 ? (f - 650) / 32 : 1);

test("schedule: Blast and manual DV have the same camera frames, the revert has none", () => {
  const common = { taskStartFrame: 0, startFrame: 214, swapFrame: 492, newMotionFrame: 651, returnFrame: 863,
    fadeFrame: 865, newMotion: 13, returnMotion: 1 };
  assert.deepEqual(formChangeCameraSchedule(FormChangeProgram.BLAST_ON),
    { ...common, startMotion: 14, weakReturnMotion: 1 });
  assert.deepEqual(formChangeCameraSchedule(FormChangeProgram.MANUAL_DV),
    { ...common, startMotion: 13, weakReturnMotion: 2 });
  assert.equal(formChangeCameraSchedule(FormChangeProgram.BLAST_REVERT), null);
  assert.equal(BLAST_SWAP_FRAME, 492);
  assert.equal(BLAST_HEAL_FRAME, 652);
  assert.equal(BLAST_LAST_FRAME, 926);
  assert.equal(MANUAL_DV_LAST_FRAME, 926);
  assert.equal(formChangeLength(FormChangeProgram.BLAST_ON), 926);
  assert.equal(formChangeLength(FormChangeProgram.MANUAL_DV), 926);
  // the fade armed on n865 (f651) snaps on n926 (f712), the last frame of the presentation
  assert.equal(863 + DV_RETURN_FADE_DELAY, 865);
  assert.equal(865 + 61, 926);
});

test("no program carries a camera dolly any more: the revert has its own camera object", () => {
  for (const f of [0, 100, 214, 400, 700, 800, 850]) {
    assert.equal(formChangeState(FormChangeProgram.BLAST_ON, f).cameraPush, 0, `blast f${f}`);
    assert.equal(blastPresentationState(f).cameraPush, 0);
  }
  for (const f of [0, 100, 214, 400, 700]) {
    assert.equal(formChangeState(FormChangeProgram.MANUAL_DV, f).cameraPush, 0, `manual f${f}`);
  }
  for (const f of [0, 60, 200, 300, 370]) {
    assert.equal(formChangeState(FormChangeProgram.BLAST_REVERT, f).cameraPush, 0, `revert f${f}`);
  }
});

test("start cut: shot 9 with -homePos.z added to eye z and look z, nothing else changed", () => {
  const f = shotNineWithHomeOffset(SHOT9, HOME_Z);
  const plain = fieldsFromShot(SHOT9);
  assert.equal(f[2], SHOT9.eye[2] + 5248);
  assert.equal(f[5], SHOT9.target[2] + 5248);
  assert.equal(5248, -HOME_Z);
  for (let i = 0; i < 14; i++) if (i !== 2 && i !== 5) assert.equal(f[i], plain[i], `field ${i}`);
  // fields: eye, look, anchor 0, angles 0, roll 0, H
  assert.deepEqual(f.slice(6, 12), [0, 0, 0, 0, 0, 0]);
  assert.equal(f[13], SHOT9.H);
});

/** The hand-computed fade: t = 68 per frame, 0x1000 snaps; integer floor maths on every field. */
const handFade = (from, to, k) => {
  const t = Math.min(0x1000, 68 * k);
  return from.map((v, i) => (t >= 0x1000 ? to[i] : v + Math.floor(t * (to[i] - v) / 0x1000)));
};

/**
 * The whole change, f-214 .. f715, driven as the renderer drives it (one stepFormChangeFrame per tick):
 * the old partner until f278, then the new one (battle.js swaps the model for frame 278 before the renderer's
 * next step).
 */
function runChange(program, weak = false) {
  const camRec = createCameraRecord(() => null);
  camRec.cut(fieldsFromShot(BATTLE0), { issuer: "battle" });
  const model = { key: "old", shot: SHOT9, homeZ: HOME_Z };
  const log = { views: new Map(), events: [], motions: [], enemy: [], kinds: new Map() };
  let frame = 0;
  const cam = createDigivolveCamera({
    camRec, schedule: formChangeCameraSchedule(program),
    shotNine: () => model.shot, arena: () => ARENA, homeZ: () => model.homeZ, modelKey: () => model.key,
    setEnemyVisible: (v) => log.enemy.push([frame, v]),
    setMotion: (m) => log.motions.push([frame, m]), weak,
  });
  let prev = camRec.get();
  for (frame = 0; frame <= 929; frame++) {
    if (frame === 492) Object.assign(model, { key: "new", shot: NEW_SHOT9, homeZ: NEW_HOME_Z });
    const { fields } = stepFormChangeFrame(camRec, cam, frame);
    log.views.set(frame, fields.slice());
    if (camRec.get() !== prev) { log.events.push([frame, camRec.get().kind]); prev = camRec.get(); }
  }
  return log;
}

for (const [name, program, startMotion, weakMotion] of [
  ["Blast", FormChangeProgram.BLAST_ON, 14, 1], ["manual DV", FormChangeProgram.MANUAL_DV, 13, 2]]) {
  test(`${name}: camera frame by frame n0..n929: cuts n214 / n492 / n863, fade armed n865, snap shown n926`, () => {
    const log = runChange(program);
    const battleF = fieldsFromShot(BATTLE0);
    const startFields = shotNineWithHomeOffset(SHOT9, HOME_Z);
    const newFields = shotNineWithHomeOffset(NEW_SHOT9, NEW_HOME_Z);
    const plainFields = fieldsFromShot(NEW_SHOT9);
    const arenaFields = fieldsFromShot(ARENA);
    assert.deepEqual(log.events, [[214, "cut"], [492, "cut"], [863, "cut"], [865, "move"]]);
    for (let n = 0; n <= 214; n++) assert.deepEqual(log.views.get(n), battleF, `n${n}: the battle camera`);
    for (let n = 215; n <= 492; n++) assert.deepEqual(log.views.get(n), startFields, `n${n}: old partner shot 9`);
    for (let n = 493; n <= 863; n++) assert.deepEqual(log.views.get(n), newFields, `n${n}: new partner shot 9`);
    assert.deepEqual(log.views.get(864), plainFields, "plain cut shown n864");
    assert.deepEqual(log.views.get(865), plainFields, "arming shows nothing yet");
    for (let k = 1; k <= 60; k++) {
      assert.deepEqual(log.views.get(865 + k), handFade(plainFields, arenaFields, k), `fade tick ${k} on n${865 + k}`);
      const t = Math.min(0x1000, 68 * k);
      if (t < 0x1000) assert.deepEqual(log.views.get(865 + k), lerpFields(plainFields, arenaFields, t / 0x1000), `lerpFields k=${k}`);
    }
    assert.notDeepEqual(log.views.get(925), arenaFields, "frame 60 of the fade is 16/4096 short");
    for (let n = 926; n <= 929; n++) assert.deepEqual(log.views.get(n), arenaFields, `snap n${n}`);
    assert.equal(op5GlideRate(60), 68);
    let t = 0;
    for (let k = 1; k <= 61; k++) t = op5GlideT(t, op5GlideRate(60), 1);
    assert.equal(t, 0x1000);
    assert.equal(DV_FADE_FRAMES, 60);
  });

  test(`${name}: motions, enemy layer, flash, wipe, swap, heal, stage, sounds and effects per frame`, () => {
    const log = runChange(program, true);
    assert.deepEqual(log.motions, [[214, startMotion], [651, 13], [865, weakMotion]], "motions (weak partner)");
    assert.deepEqual(runChange(program, false).motions, [[214, startMotion], [651, 13], [865, 1]], "motions (idleMotion 0)");
    assert.deepEqual(log.enemy, [[214, false], [865, true]], "enemy layer off n214, on n865");
    const blast = program === FormChangeProgram.BLAST_ON;
    for (let n = 0; n <= 929; n++) {
      const f = n - S;
      const s = formChangeState(program, n);
      assert.equal(s.frame, n);
      assert.equal(s.flashLevel, factFlash(f), `flash level n${n}`);
      assert.equal(s.flashAlpha, factFlash(f) / 255);
      assert.equal(s.wipeRow, factRow(f), `wipe row n${n}`);
      assert.equal(s.wireOn, f >= 0 && f < 436, `wire layer n${n}`);
      assert.equal(s.wireframeAlpha, f >= 0 && f < 436 ? 1 : 0);
      assert.equal(s.solidAlpha, factRow(f) > 0 ? 1 : 0);
      assert.equal(s.showNewModel, f >= 278, `swap n${n}`);
      assert.equal(s.showOldModel, f < 278);
      assert.equal(s.enemyHidden, f >= 0 && f <= 650, `enemy n${n}`);
      assert.ok(Math.abs(s.voidAlpha - (1 - factBright(f))) < 1e-12, `void n${n}`);
      assert.equal(s.healed, blast && f >= 438, `heal n${n}`);
      assert.equal(s.done, f >= 712, `done n${n}`);
      assert.equal(s.cameraPush, 0);
      assert.equal(s.ribbonAlpha + s.fireIntensity + s.hexagramAlpha + s.circuitFill, 0, "no invented visual");
      assert.equal(digivolveWipeRow(n), factRow(f));
      assert.equal(digivolveFlashLevel(n), factFlash(f));
      assert.ok(Math.abs(digivolveStageBrightness(n) - factBright(f)) < 1e-12);
    }
    // spot numbers from the clip log of the interpreter (clip0.h): f0 238, f1 236, f100 38, f119 0, f317 2, f436 240
    for (const [f, h] of [[0, 238], [1, 236], [100, 38], [118, 2], [119, 0], [120, 0], [316, 0], [317, 2], [435, 238], [436, 240]]) {
      assert.equal(digivolveWipeRow(f + S), h, `wipe row f${f}`);
    }
    // flash: 7 on f240, 252 on f275, 255 on f276 and f277, 248 on f278, 3 on f313, 0 from f314
    for (const [f, lv] of [[239, 0], [240, 7], [275, 252], [276, 255], [277, 255], [278, 248], [313, 3], [314, 0]]) {
      assert.equal(digivolveFlashLevel(f + S), lv, `flash f${f}`);
    }
    // stage: the battle stage dims n3..n34, the change stage is black to n864, the battle stage returns n865..n895
    assert.equal(digivolveStageBrightness(2), 1);
    assert.equal(digivolveStageBrightness(3), 31 / 32);
    assert.equal(digivolveStageBrightness(34), 0);
    assert.equal(digivolveStageBrightness(864), 0);
    assert.equal(digivolveStageBrightness(865), 1 / 32);
    assert.equal(digivolveStageBrightness(895), 31 / 32);
    assert.equal(digivolveStageBrightness(896), 1);
    // sounds: EVOLUTIO on n34 (f-180), the battle music on n865 (f651)
    assert.equal(formChangeSoundFrame(program), 34);
    assert.equal(formChangeMusicFrame(program), 865);
    // effects: first (1007 / 1000 + 1001) on n214, 1002 on n333, last (1008 / 1003) on n650; positions from the C source
    const due = [];
    for (let n = 0; n <= 929; n++) for (const sp of evolEffectsDue(program, n - 1, n)) due.push([n, sp.type, sp.pos.x, sp.pos.y, sp.pos.z]);
    const first = blast ? [[214, 1007, 0, 0, 32767]] : [[214, 1000, 0, 0, 32767], [214, 1001, 0, 0, 32767]];
    assert.deepEqual(due, [...first, [333, 1002, 160, 120, 32767], [650, blast ? 1008 : 1003, -160, -120, -1]]);
  });
}

// ── The change stage (digimon_change.c setStage(0x1C / 0x1F), stage.c FIGHTSTG_updateStage) ──────────
// The stage task's output per presentation frame n: the stage whose model is alive and that model's
// colour (0..0x80). The interpreter (tests/helpers/digivolve-change-oracle.js) records the stage model
// created on run 35 (the change stage, colour 0) and the battle's on run 864, and the colour the model
// was last given (stage.c FIGHTSTG_fadeStage). Fade = 0x1000 / 32 = 128 a run.
const factStageLevel = (n) => (n < 3 ? CHANGE_STAGE_FULL
  : n <= 34 ? CHANGE_STAGE_FULL - 4 * (n - 2)
  : n <= 35 ? 0
  : n <= 67 ? 4 * (n - 35)
  : n <= 831 ? CHANGE_STAGE_FULL
  : n <= 863 ? CHANGE_STAGE_FULL - 4 * (n - 831)
  : n <= 864 ? 0
  : n <= 896 ? 4 * (n - 864)
  : CHANGE_STAGE_FULL);

test("change stage: stage id (0x1C manual / 0x1F Blast) and model colour every frame n0..n929", () => {
  assert.equal(CHANGE_STAGE_MANUAL, 0x1C);
  assert.equal(CHANGE_STAGE_BLAST, 0x1F);
  assert.equal(CHANGE_STAGE_MODEL_FRAME, 35);
  assert.equal(CHANGE_STAGE_BACK_MODEL_FRAME, 864);
  assert.equal(CHANGE_STAGE_FULL, 0x80);
  for (const [name, blast, stage, program] of [
    ["manual DV", false, CHANGE_STAGE_MANUAL, FormChangeProgram.MANUAL_DV],
    ["Blast", true, CHANGE_STAGE_BLAST, FormChangeProgram.BLAST_ON]]) {
    for (let n = 0; n <= 929; n++) {
      const s = changeStage(blast, n);
      assert.equal(s.stage, (n < 35 || n >= 864) ? CHANGE_STAGE_BATTLE : stage, `${name} stage n${n}`);
      assert.equal(s.level, factStageLevel(n), `${name} level n${n}`);
      const st = formChangeState(program, n);
      assert.equal(st.stage, s.stage, `${name} state.stage n${n}`);
      assert.equal(st.stageLevel, s.level, `${name} state.stageLevel n${n}`);
      assert.equal(st.stageChange, stage, `${name} state.stageChange n${n}`);
    }
    // spot numbers: colour 128-4(F-2) out, 0 on the created models, 4(F-35) in, 4(F-864) back in
    assert.deepEqual([34, 35, 36, 67, 68, 831, 832, 863, 864, 865, 896].map((n) => changeStage(blast, n).level),
      [0, 0, 4, 128, 128, 128, 124, 0, 0, 4, 128], name);
    assert.equal(changeStage(blast, 2).stage, CHANGE_STAGE_BATTLE);
    assert.equal(changeStage(blast, 35).stage, stage);
    assert.equal(changeStage(blast, 863).stage, stage);
    assert.equal(changeStage(blast, 864).stage, CHANGE_STAGE_BATTLE);
  }
});

test("changeStageBg: (channel * level) >> 7, black set as (1, 1, 1)", () => {
  assert.deepEqual(changeStageBg([0, 0, 0], 0), [1, 1, 1], "black is drawn as 1,1,1");
  assert.deepEqual(changeStageBg([0, 0, 0], 128), [1, 1, 1]);
  assert.deepEqual(changeStageBg([10, 20, 30], 128), [10, 20, 30], "full level = bg colour");
  assert.deepEqual(changeStageBg([10, 20, 30], 64), [5, 10, 15]);
  assert.deepEqual(changeStageBg([100, 200, 255], 32), [25, 50, 63]);
  assert.deepEqual(changeStageBg([1, 2, 3], 0), [1, 1, 1], "any fade to black is 1,1,1");
});

test("change stage motion: loops 1..1500 from the run its model is created", () => {
  assert.equal(CHANGE_STAGE_MOTION_FRAMES, 1500);
  assert.equal(changeStageMotionFrame(CHANGE_STAGE_MODEL_FRAME), 1);
  assert.equal(changeStageMotionFrame(CHANGE_STAGE_MODEL_FRAME + 1499), 1500);
  assert.equal(changeStageMotionFrame(CHANGE_STAGE_MODEL_FRAME + 1500), 1);
});

test("the revert keeps its own length and sound frame, and has no music frame", () => {
  assert.equal(formChangeSoundFrame(FormChangeProgram.BLAST_REVERT), 50);
  assert.equal(formChangeMusicFrame(FormChangeProgram.BLAST_REVERT), null);
  assert.deepEqual(evolEffectsDue(FormChangeProgram.BLAST_REVERT, -Infinity, 1000), []);
  assert.equal(formChangeState(FormChangeProgram.BLAST_REVERT, -5).frame, 0, "the revert still starts at f0");
  assert.equal(formChangeState(FormChangeProgram.BLAST_ON, 0).frame, 0);
});

test("one camera tick per presentation tick from the task start: the stepper counts from f-214", () => {
  const r = rig();
  assert.equal(r.cam.elapsed(0), 1);
  assert.equal(r.cam.elapsed(1), 1);
  assert.equal(r.cam.elapsed(1), 0);
  assert.equal(r.cam.elapsed(4), 3, "skipped frames are counted");
});

test("play's presentation frame is one 60 Hz tick per 1/60 s: battle.js advances dt * 60", () => {
  const b = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.match(b, /const BLAST_CAPTURE_HZ = 60;/);
  assert.match(b, /else show\.frame \+= dt \* BLAST_CAPTURE_HZ;/);
  assert.match(b, /const frame = Math\.round\(show\.frame\);/);
  assert.equal((b.match(/frame: DV_TASK_START_FRAME,/g) || []).length, 2, "Blast and manual DV start on n0");
  assert.match(b, /swapName: profile\.name, swapped: false/, "manual DV swaps its model on f278, not at commit");
  assert.match(b, /formChangeMusicFrame\(show\.program\)/);
  assert.doesNotMatch(b, /sounded: true,\n\s+endMessage/, "Blast no longer plays EVOLUTIO at trigger");
});

test("ownership: the change owns the camera from the first cut, the partner leaves the origin at the return cut", () => {
  const r = rig();
  assert.equal(r.cam.owns(), false);
  r.cam.update(0);
  assert.equal(r.cam.owns(), false, "the task runs but has not cut yet");
  r.cam.update(214);
  assert.equal(r.cam.owns(), true);
  assert.equal(r.cam.atOrigin(), true);
  r.cam.update(862);
  assert.equal(r.cam.atOrigin(), true);
  r.cam.update(863);
  assert.equal(r.cam.atOrigin(), false);
  assert.equal(r.cam.owns(), true);
  r.cam.stop();
  assert.equal(r.cam.owns(), false);
});

test("stop() puts the enemy back when it stops while the enemy layer is off", () => {
  const camRec = createCameraRecord(() => null);
  const calls = [];
  const cam = createDigivolveCamera({
    camRec, schedule: formChangeCameraSchedule(FormChangeProgram.BLAST_ON),
    shotNine: () => SHOT9, arena: () => ARENA, homeZ: () => HOME_Z, setEnemyVisible: (v) => calls.push(v),
  });
  cam.update(214);
  cam.stop();
  assert.deepEqual(calls, [false, true]);
});

test("the model swap loads late: a changed model key re-cuts shot 9 + offset for the new model", () => {
  const camRec = createCameraRecord(() => null);
  let key = "old", shot = SHOT9, home = HOME_Z;
  const cam = createDigivolveCamera({
    camRec, schedule: formChangeCameraSchedule(FormChangeProgram.BLAST_ON),
    shotNine: () => shot, arena: () => ARENA, homeZ: () => home, modelKey: () => key,
  });
  cam.update(214);
  assert.deepEqual(camRec.live(), shotNineWithHomeOffset(SHOT9, HOME_Z));
  // frame n492: the swap frame arrives but the new model has not loaded yet: same cut, same record
  cam.update(492);
  assert.deepEqual(camRec.live(), shotNineWithHomeOffset(SHOT9, HOME_Z));
  // the new model lands: its own shot 9 and its own home slot
  key = "new"; shot = { eye: [10, -700, -3000], target: [0, -300, -3100], H: 600, roll: 0 }; home = -(0x1400 + 640);
  cam.update(520);
  assert.deepEqual(camRec.live(), shotNineWithHomeOffset(shot, home));
  assert.equal(camRec.live()[2], -3000 + 0x1400 + 640);
  // and it holds again until the return
  cam.update(700);
  assert.deepEqual(camRec.live(), shotNineWithHomeOffset(shot, home));
});

test("no shot 9 yet: nothing is cut and nothing throws", () => {
  const camRec = createCameraRecord(() => null);
  const cam = createDigivolveCamera({
    camRec, schedule: formChangeCameraSchedule(FormChangeProgram.BLAST_ON),
    shotNine: () => null, arena: () => ARENA, homeZ: () => HOME_Z,
  });
  cam.update(214); cam.update(900);
  assert.equal(cam.owns(), false);
  assert.equal(camRec.get(), null);
});

test("battle3d: the renderer drives the digivolve and revert cameras, the dolly is gone, the wipe is drawn", () => {
  const src = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
  assert.match(src, /createDigivolveCamera/);
  assert.match(src, /stepFormChangeFrame\(camRec, dvCam, dvFrame\)/);
  assert.match(src, /if \(!dvCam\) camRec\.tick/, "no second camera tick while a form change runs");
  assert.match(src, /blastPresentationSet\(state, program, skipped = false, weak = false, entrance = null\)/);
  const ts = readFileSync(new URL("../engine/systems/blast-presentation.ts", import.meta.url), "utf8");
  assert.equal((ts.match(/cameraPush: smooth/g) || []).length, 0, "no cameraPush curve is left");
  assert.match(src, /createRevertCamera/);
  assert.doesNotMatch(src, /blastState\.cameraPush/, "the dolly block is gone");
  assert.match(src, /setEnemyVisible: setEnemyVisible/, "enemy hide goes through the one setEnemyVisible");
  assert.match(src, /createDigivolveCamera\(\{[^}]*setEnemyVisible: setEnemyVisible,\s+setMotion: playPlayerMotion, weak/s);
  assert.match(src, /blastState\.wipeRow !== undefined/, "the wipe row drives the solid / wireframe clip");
  assert.match(src, /gl\.scissor\(0, H - rowPx, W, rowPx\)/);
  assert.match(src, /gl\.scissor\(0, 0, W, H - rowPx\)/);
  assert.match(src, /blastState\.voidAlpha > 0 && blastState\.voidAlpha < 1/, "the stage fade darkens the arena");
});

// ── The revert (de-digivolve): entrance.c FIGHTSTG_updateEntrance, key2 = 0 ──────────────────────
// frame f = entrance frame e - 11 (PLAYER11 at the flash start e61 = capture f50). fade to near shot 10
// armed at f-10 (lands f51), the ENEMY hidden at counter 30 (f19), the flash full at e124 (f113) and the
// entrance sees it on e125 (f114): CUT to shot 10. nextSubstate zeroes `step`, so substate 6 waits 120 frames (e191..e310), then at f299 the
// enemy is shown and the camera fades to the enemy view (introShot) over 60 frames (snap at f360).
const SHOT10 = { eye: [80, -1100, -2500], target: [10, -500, -2600], H: 700, roll: 0 };
const BATTLE = { eye: [-40, -1800, -7000], target: [30, -600, 2000], H: 450, roll: 0 };

function revertRig(weak = false) {
  const motions = [];
  const camRec = createCameraRecord(() => null);
  camRec.cut(fieldsFromShot(BATTLE), { issuer: "battle" });   // the battle camera that is live at f0
  const enemy = [];
  let frame = 0;
  const cam = createRevertCamera({
    camRec, schedule: revertCameraSchedule(), shotTen: () => SHOT10, arena: () => ARENA,
    setEnemyVisible: (v) => enemy.push([frame, v]),
    setMotion: (m) => motions.push([frame, m]), weak,
  });
  return { camRec, cam, enemy, motions, at: (f) => { frame = f; } };
}

function runRevert(r, last, onFrame) {
  for (let f = 0; f <= last; f++) {
    r.at(f);
    const { fields } = stepFormChangeFrame(r.camRec, r.cam, f);   // the renderer's own frame
    onFrame(f, fields);
  }
}

test("revert schedule: the event frames derived from the decomp counters", () => {
  assert.deepEqual(revertCameraSchedule(), { fadeFrame: -10, hideFrame: 19, cutFrame: 114, returnFrame: 299 });
  // independent re-derivation: e = f + 1; counter = e; the flash level is 4 * n, n = 1 on e61
  const hideE = 30, flashStartE = hideE + 30 + 1;            // counter >= 60 on e60, substate 2 on e61
  assert.equal(flashStartE, 61);
  const speed = Math.trunc(0xFF / 60);
  assert.equal(speed, 4);
  const nFull = Math.ceil(0xFF / speed);                     // level 4n >= 255
  assert.equal(nFull, 64);
  const fullE = flashStartE + nFull - 1;                     // flash task runs after its parent, same frame
  assert.equal(fullE, 124);
  const cutE = fullE + 1;                                    // the parent sees substate != 0 next frame
  assert.equal(cutE, 125);
  const endE = cutE + 1;                                     // substate 4: endWhiteFlash
  const killE = endE + Math.ceil(0xFF / speed) - 1;          // level < 0 on its 64th down frame: state KILL
  assert.equal(killE, 189);
  const goneE = killE + 2;                                   // destroyed e190; the parent sees NULL e191
  assert.equal(goneE, 191);
  const returnE = goneE + 120 - 1;                           // step 1 on e191 (nextSubstate zeroed it), 120 on e310
  assert.equal(returnE, 310);
  const s = revertCameraSchedule();
  // PLAYER11 plays at the flash start (e61); the capture has it at presentation f50: f = e - 11
  assert.equal(flashStartE - 11, 50);
  assert.equal(s.fadeFrame, 1 - 11);
  assert.equal(s.hideFrame, hideE - 11);
  assert.equal(s.cutFrame, cutE - 11);
  assert.equal(s.returnFrame, returnE - 11);
  // the presentation is long enough: the fade's snap frame is 61 after the return
  assert.equal(REVERT_CAMERA_FADE_END_FRAME, s.returnFrame + 61);
  assert.equal(REVERT_CAMERA_FADE_END_FRAME, 360);
  assert.equal(REVERT_LAST_FRAME, 361);
  assert.ok(REVERT_LAST_FRAME > REVERT_CAMERA_FADE_END_FRAME);
  assert.equal(formChangeLength(FormChangeProgram.BLAST_REVERT), REVERT_LAST_FRAME);
  assert.equal(formChangeState(FormChangeProgram.BLAST_REVERT, REVERT_CAMERA_FADE_END_FRAME).done, false);
  assert.equal(formChangeState(FormChangeProgram.BLAST_REVERT, REVERT_LAST_FRAME).done, true);
  // the walker visual keeps its captured timing
  assert.equal(REVERT_VISUAL_END_FRAME, 326);
});

test("revert camera: fade 60 frames to near shot 10, cut at flash-full, hold, fade 60 to the enemy view", () => {
  assert.equal(REVERT_SHOT_INDEX, 10);
  const r = revertRig();
  const from = fieldsFromShot(BATTLE), s10 = fieldsFromShot(SHOT10), arenaF = fieldsFromShot(ARENA);
  const seen = new Map();
  runRevert(r, REVERT_LAST_FRAME, (f, fields) => { seen.set(f, fields.slice()); });
  const hand = (a, b, k) => {
    const t = Math.min(0x1000, 68 * k);
    return a.map((v, i) => (t >= 0x1000 ? b[i] : v + Math.floor(t * (b[i] - v) / 0x1000)));
  };
  // first fade, armed at f-10: fade frame k is at f = k - 10, so f0 = frame 10
  for (const k of [10, 30, 60, 61]) {
    assert.deepEqual(seen.get(k - 10), hand(from, s10, k), `fade 1 frame ${k}`);
    if (k < 61) assert.deepEqual(seen.get(k - 10), lerpFields(from, s10, Math.min(0x1000, 68 * k) / 0x1000), `lerpFields ${k}`);
  }
  assert.notDeepEqual(seen.get(50), s10);     // frame 60 is still 16/4096 short
  assert.deepEqual(seen.get(51), s10);        // frame 61 snaps exactly
  // the cut to shot 10 is called on f114 and shown on f115: the same record the fade landed on, no visible change
  assert.deepEqual(seen.get(114), s10);
  assert.deepEqual(seen.get(115), s10);
  assert.equal(r.camRec.get().kind === "move" || r.camRec.get().kind === "cut", true);
  // held unchanged until the return frame
  for (let f = 51; f <= 299; f++) assert.deepEqual(seen.get(f), s10, `hold frame ${f}`);
  // the final fade: current (= shot 10) -> enemy view (introShot), 60 frames, frame 61 snaps
  for (const k of [1, 30, 60, 61]) {
    assert.deepEqual(seen.get(299 + k), hand(s10, arenaF, k), `fade 2 frame ${k}`);
  }
  assert.notDeepEqual(seen.get(359), arenaF);
  assert.deepEqual(seen.get(360), arenaF);
  for (let f = 360; f <= REVERT_LAST_FRAME; f++) assert.deepEqual(seen.get(f), arenaF, `end frame ${f}`);
  assert.equal(r.cam.owns(), true);
  assert.equal(r.cam.atOrigin(), false);
});

test("revert camera: the enemy is hidden from counter 30 (f19) until the final fade starts (f299)", () => {
  const r = revertRig();
  runRevert(r, REVERT_LAST_FRAME, () => {});
  assert.deepEqual(r.enemy, [[19, false], [299, true]]);
  // stop() always leaves the enemy shown (a skipped presentation)
  const r2 = revertRig();
  runRevert(r2, 100, () => {});
  r2.at(100);
  r2.cam.stop();
  assert.deepEqual(r2.enemy, [[19, false], [100, true]]);
  assert.equal(r2.cam.owns(), false);
});

test("revert camera: no shot 10 yet means no cut and no throw; no enemy view skips only the last fade", () => {
  const camRec = createCameraRecord(() => null);
  const cam = createRevertCamera({
    camRec, schedule: revertCameraSchedule(), shotTen: () => null, arena: () => null, setEnemyVisible: () => {},
  });
  cam.update(0); cam.update(400);
  assert.equal(cam.owns(), false);
  const r = revertRig();
  const cam2 = createRevertCamera({
    camRec: r.camRec, schedule: revertCameraSchedule(), shotTen: () => SHOT10, arena: () => null,
    setEnemyVisible: () => {},
  });
  for (let f = 0; f <= 400; f++) stepFormChangeFrame(r.camRec, cam2, f);
  assert.deepEqual(r.camRec.live(), fieldsFromShot(SHOT10));
});

// ── The skip (Digivolve Demo OFF): the end state of the original, in one step ────────────────────
// Camera = the enemy view (introShot) snapped, the enemy shown, the change no longer owns the camera.

function assertSkipEnd(camRec, cam, enemy) {
  const arenaFields = fieldsFromShot(ARENA);
  assert.deepEqual(camRec.live(), arenaFields, "live record is introShot exactly");
  assert.deepEqual(camRec.sample(), camRec.sample());
  assert.equal(camRec.get().kind, "cut");
  camRec.tick(CAMERA_FRAME_DELTA);
  assert.deepEqual(camRec.live(), arenaFields, "still introShot after the next camera run");
  assert.equal(cam.owns(), false, "released");
  assert.equal(enemy(), true, "enemy visible");
}

for (const [name, program] of [["Blast", FormChangeProgram.BLAST_ON], ["manual DV", FormChangeProgram.MANUAL_DV]]) {
  for (const from of [null, 100, 700]) {
    test(`skip (${name}) after ${from === null ? "no frame" : "frame " + from}: camera = introShot, enemy visible, not owned`, () => {
      const r = rig(program);
      if (from !== null) runFrames(r, 0, from, () => {});
      let enemyVisible = true;
      skipFormChange(r.camRec, r.cam, () => ARENA, (v) => { enemyVisible = v; });
      assertSkipEnd(r.camRec, r.cam, () => enemyVisible);
    });
  }
}

for (const from of [null, 30, 200]) {
  test(`skip (revert) after ${from === null ? "no frame" : "frame " + from}: camera = introShot, enemy shown, not owned`, () => {
    const r = revertRig();
    let enemyVisible = true;
    const cam = createRevertCamera({
      camRec: r.camRec, schedule: revertCameraSchedule(), shotTen: () => SHOT10, arena: () => ARENA,
      setEnemyVisible: (v) => { enemyVisible = v; },
    });
    if (from !== null) for (let f = 0; f <= from; f++) stepFormChangeFrame(r.camRec, cam, f);
    if (from === 200) assert.equal(enemyVisible, false, "hidden mid-revert before the skip");
    skipFormChange(r.camRec, cam, () => ARENA, (v) => { enemyVisible = v; });
    assertSkipEnd(r.camRec, cam, () => enemyVisible);
  });
}

test("skip without an enemy view still shows the enemy and releases", () => {
  const r = rig();
  r.cam.update(0);
  let vis = false;
  skipFormChange(r.camRec, r.cam, () => null, (v) => { vis = v; });
  assert.equal(vis, true);
  assert.equal(r.cam.owns(), false);
});

test("battle3d + battle.js: the skip frame goes through skipFormChange (introShot, setEnemyVisible)", () => {
  const src = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
  assert.match(src, /skipFormChange\(camRec, dvCam, \(\) => introShot\(\), setEnemyVisible\)/);
  const bj = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.match(bj, /blastPresentationSet\?\.\(s, show\.program, skip[,)]/);
});

// ── The revert's white flash (white_flash.c: startWhiteFlash(60) / endWhiteFlash(60)) and motions ──────
// speed = 0xFF / 60 = 4. Level 0 -> +4 per frame from e61 (f50); 4 * 64 = 256 >= 0xFF on e124 (f113) -> 255,
// substate != 0; the entrance sees it on e125 (f114) and cuts. endWhiteFlash on e126 (f115): -4 per frame,
// < 0 on f178 -> 0 (KILL). Additive full-screen quad (code 0x2A, tpage 0xA0).
test("revert flash: the original level per frame (start, mid, full, end-flash mid, end)", () => {
  assert.equal(revertFlashLevel(49), 0);
  assert.equal(revertFlashLevel(50), 4);          // start: first level on e61
  assert.equal(revertFlashLevel(51), 8);
  assert.equal(revertFlashLevel(80), 124);        // mid
  assert.equal(revertFlashLevel(112), 252);
  assert.equal(revertFlashLevel(113), 255);       // full (4*64 = 256 clamps to 0xFF)
  assert.equal(revertFlashLevel(114), 255);       // the entrance cuts here, still full
  assert.equal(revertFlashLevel(115), 251);       // endWhiteFlash: first -4
  assert.equal(revertFlashLevel(146), 127);       // end-flash mid
  assert.equal(revertFlashLevel(177), 3);         // last visible
  assert.equal(revertFlashLevel(178), 0);         // level < 0 -> 0, KILL
  assert.equal(revertFlashLevel(300), 0);
  for (let f = -20; f <= 400; f++) {
    assert.equal(engineFlashLevel(f), revertFlashLevel(f), `engine and play-code flash agree at f${f}`);
    if (f >= 0) assert.equal(formChangeState(FormChangeProgram.BLAST_REVERT, f).flashLevel, revertFlashLevel(f), `state flash f${f}`);
  }
});

test("revert motions: 13 requested on the cut frame (f114), 1 on f299 (2 when weak)", () => {
  assert.equal(REVERT_ENTER_MOTION, 13);
  assert.equal(REVERT_IDLE_MOTION, 1);
  assert.equal(REVERT_WEAK_MOTION, 2);
  for (const [weak, last] of [[false, 1], [true, 2]]) {
    const r = revertRig(weak);
    runRevert(r, REVERT_LAST_FRAME, () => {});
    assert.deepEqual(r.motions, [[114, 13], [299, last]], `weak=${weak}`);
  }
});

test("revert motions: weak may be a function read at f299, and skipped frames still fire", () => {
  for (const [hp, last] of [[false, 1], [true, 2]]) {
    const motions = [];
    const camRec = createCameraRecord(() => null);
    camRec.cut(fieldsFromShot(BATTLE), { issuer: "battle" });
    let weakNow = false;
    const cam = createRevertCamera({
      camRec, schedule: revertCameraSchedule(), shotTen: () => SHOT10, arena: () => ARENA,
      setEnemyVisible: () => {}, setMotion: (m) => motions.push(m), weak: () => weakNow,
    });
    // jump over the event frames: only frames -10, 100, 120, 300 are visited
    for (const f of [-10, 100, 120, 300]) { if (f === 300) weakNow = hp; stepFormChangeFrame(camRec, cam, f); }
    assert.deepEqual(motions, [13, last], `hp low=${hp}`);
  }
});

test("wiring: battle3d passes setMotion + weak to the revert camera, battle.js passes the low-HP stance", () => {
  const b3 = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.match(b3, /createRevertCamera\(\{[^}]*setMotion: \(m\) => entranceMotionSet\(eSide, entrance\?\.folder, m\), weak/s);
  assert.match(b3, /function playPlayerMotion\(motion\)/);
  assert.match(b3, /function playEnemyMotion\(motion\)/);
  assert.match(b, /blastPresentationSet\?\.\(s, show\.program, skip,\s+\(\) => lowHpStance\(show\.entranceSide === 1 \? b\.enemy : b\.player\), show\.entrance \?\? null\)/);
});

test("revert draws only the entrance machine: no void, ribbons or wireframe; model on at the cut, no fade-in", () => {
  // entrance.c FIGHTSTG_updateEntrance (key2 = 0): camera fade, enemy hide, white flash, showEnteringModel
  // (layers[0].enabled = 1, wireframe = 0). It draws nothing else.
  const cut = revertCameraSchedule().cutFrame;
  for (const f of [0, 20, 50, 113, cut - 1, cut, 150, 215, 250, 299, 326]) {
    const s = formChangeState(FormChangeProgram.BLAST_REVERT, f);
    assert.equal(s.voidAlpha, 0, `void f${f}`);
    assert.equal(s.ribbonAlpha, 0, `ribbons f${f}`);
    assert.equal(s.ribbonTurns, 0);
    assert.equal(s.wireframeAlpha, 0, `wireframe f${f}`);
    assert.equal(s.solidAlpha, f >= cut ? 1 : 0, `solid f${f}`);
    assert.equal(s.flashLevel, engineFlashLevel(f), `flash kept f${f}`);
    assert.equal(s.showNewModel, f >= 114, `the new model is swapped in at the cut f${f}`);
    assert.equal(s.showOldModel, f < 114, `the old model stays until the cut f${f}`);
    assert.equal(s.healed, false);
  }
});


// ── The entrance of BOTH sides: FIGHTSTG_startEntrance(id, side, weak), key2 = 0 / 0x10 ───────────────
// The interpreter run (/home/dorij/dv-camera/tag/entrance-run.log, n = run count, f = n - 10), both sides:
//   fade armed n0 (f-10) 60 frames | other side's model hidden n29 (f19) | PLAYER11 + flash start n60 (f50)
//   cut + done=1 + motion 13 n124 (f114) | endWhiteFlash n125 (f115) | flash gone n189 (f179 = level 0 from f178)
//   final fade armed + other model shown + motion 1 (2 weak) n309 (f299): fade 60 frames (player) / 1 frame (enemy)
//   the camera views differ from n310 (f300) for exactly 60 frames, player vs enemy.
const ENTRANCE_PROGRAMS = [[0, FormChangeProgram.BLAST_REVERT, 60], [1, FormChangeProgram.ENTRANCE_ENEMY, 1]];

function entranceRig(side, weak = false) {
  const camRec = createCameraRecord(() => null);
  camRec.cut(fieldsFromShot(BATTLE), { issuer: "battle" });
  let frame = 0;
  const log = { moves: [], cuts: [], other: [], motions: [] };
  const move = camRec.move.bind(camRec), cut = camRec.cut.bind(camRec);
  camRec.move = (f, d, m) => { log.moves.push([frame, d]); return move(f, d, m); };
  camRec.cut = (f, m) => { log.cuts.push(frame); return cut(f, m); };
  const schedule = entranceCameraSchedule(side);
  const cam = createRevertCamera({
    camRec, schedule, shotTen: () => SHOT10, arena: () => ARENA,
    setEnemyVisible: (v) => log.other.push([frame, v]),
    setMotion: (m) => log.motions.push([frame, m]), weak,
  });
  return { camRec, cam, log, schedule, at: (f) => { frame = f; } };
}

test("entrance schedule: the same event frames for both sides, only the models and the final fade differ", () => {
  const p = entranceCameraSchedule(0), e = entranceCameraSchedule(1);
  for (const s of [p, e]) {
    assert.equal(s.fadeFrame, -10);          // n0
    assert.equal(s.hideFrame, 19);           // n29
    assert.equal(s.cutFrame, 114);           // n124
    assert.equal(s.swapFrame, 114);          // models->setId is the cut's call
    assert.equal(s.returnFrame, 299);        // n309
  }
  assert.deepEqual({ ...p, side: 0 }, { ...entranceCameraSchedule(0) });
  assert.deepEqual(revertCameraSchedule(), { fadeFrame: -10, hideFrame: 19, cutFrame: 114, returnFrame: 299 });
  assert.equal(p.side, 0); assert.equal(e.side, 1);
  assert.equal(p.shotIndex, 10, "player: the new fighter's near camera 10");
  assert.equal(e.shotIndex, 2, "enemy: far camera 2 of the new enemy");
  assert.equal(p.hiddenSide, 1, "the player entrance hides the ENEMY");
  assert.equal(e.hiddenSide, 0, "the enemy entrance hides the player's PARTNER");
  assert.equal(p.returnFadeFrames, 60);
  assert.equal(e.returnFadeFrames, 1);
  assert.equal(REVERT_SWAP_FRAME, 114);
  // 299 + the fade's tick count + 1 (the player's 361 = 299 + 61 + 1): derived from the camera's own glide maths
  const glide = (d) => { let t = 0, n = 0; const r = op5GlideRate(d); while (t < 0x1000) { t = op5GlideT(t, r, CAMERA_FRAME_DELTA); n++; } return n; };
  assert.equal(REVERT_LAST_FRAME, 299 + glide(60) + 1);
  assert.equal(ENTRANCE_ENEMY_LAST_FRAME, 299 + glide(1) + 1);
  assert.equal(ENTRANCE_ENEMY_CAMERA_FADE_END_FRAME, 299 + glide(1));
  assert.equal(p.lastFrame, REVERT_LAST_FRAME);
  assert.equal(e.lastFrame, ENTRANCE_ENEMY_LAST_FRAME);
});

for (const [side, program, fadeLen] of ENTRANCE_PROGRAMS) {
  test(`entrance side ${side}: program length, sound, music, effects and per-frame state`, () => {
    const sch = entranceCameraSchedule(side);
    assert.equal(formChangeLength(program), sch.lastFrame);
    assert.equal(formChangeSoundFrame(program), 50, "PLAYER11 at f50 (n60)");
    assert.equal(REVERT_SOUND_FRAME, 50);
    assert.equal(formChangeMusicFrame(program), null);
    assert.equal(formChangeCameraSchedule(program), null, "the entrance has its own camera, not the digivolve one");
    assert.deepEqual(evolEffectsDue(program, -Infinity, 1000), []);
    for (let f = 0; f <= sch.lastFrame + 2; f++) {
      const s = formChangeState(program, f);
      assert.equal(s.entranceSide, side, `side f${f}`);
      assert.equal(s.flashLevel, engineFlashLevel(f), `flash f${f}`);
      assert.equal(s.done, f >= sch.lastFrame, `done f${f}`);
      assert.equal(s.showNewModel, f >= 114, `swap f${f}`);
      assert.equal(s.showOldModel, f < 114, `old model f${f}`);
      const hidden = f >= 19 && f < 299;
      assert.equal(side === 0 ? s.enemyHidden : s.playerHidden, hidden, `other side hidden f${f}`);
      assert.equal(side === 0 ? s.playerHidden : s.enemyHidden, undefined, `own side never hidden f${f}`);
      assert.equal(s.voidAlpha, 0); assert.equal(s.ribbonAlpha, 0); assert.equal(s.wireframeAlpha, 0);
      assert.equal(s.healed, false);
    }
    // the flash per frame: 0 before f50, 4*(f-49) to f112, 255 at f113-f114, 255-4*(f-114) f115-f177, 0 from f178 (n189 kill)
    assert.equal(formChangeState(program, 49).flashLevel, 0);
    assert.equal(formChangeState(program, 50).flashLevel, 4);
    assert.equal(formChangeState(program, 112).flashLevel, 252);
    assert.equal(formChangeState(program, 113).flashLevel, 255);
    assert.equal(formChangeState(program, 114).flashLevel, 255);
    assert.equal(formChangeState(program, 115).flashLevel, 251);
    assert.equal(formChangeState(program, 177).flashLevel, 3);
    assert.equal(formChangeState(program, 178).flashLevel, 0);
    assert.equal(formChangeState(program, sch.lastFrame - 1).done, false);
    assert.equal(formChangeState(program, sch.lastFrame).done, true);
  });

  test(`entrance side ${side}: camera arms, cut, other-model hide/show and motions on the interpreter's frames`, () => {
    for (const weak of [false, true]) {
      const r = entranceRig(side, weak);
      const sch = r.schedule;
      const seen = new Map();
      for (let f = 0; f <= sch.lastFrame; f++) {
        r.at(f);
        const { fields } = stepFormChangeFrame(r.camRec, r.cam, f);
        seen.set(f, fields.slice());
      }
      // fade to the entering fighter's shot armed at f-10 (the rig starts at f0: armed on its first step), 60 frames
      assert.deepEqual(r.log.moves[0], [0, 60], "first fade: 60 frames");
      assert.deepEqual(r.log.cuts.filter((f) => f > 0), [114], "ONE cut, at f114 (done = 1)");
      assert.deepEqual(r.log.moves[1], [299, fadeLen], `final fade armed at f299, ${fadeLen} frame(s)`);
      assert.equal(r.log.moves.length, 2);
      // the other side's model: hidden f19, shown f299
      assert.deepEqual(r.log.other, [[19, false], [299, true]], "other model off at f19, on at f299");
      // entering motions: 13 on the cut, 1 (2 weak) on f299
      assert.deepEqual(r.log.motions, [[114, 13], [299, weak ? 2 : 1]], `motions weak=${weak}`);
      // the view at the cut: shot 10/2 exactly (the cut shows from f115)
      assert.deepEqual(seen.get(115), fieldsFromShot(SHOT10), "cut view");
      assert.deepEqual(seen.get(299), fieldsFromShot(SHOT10), "held to f299");
      // the final fade's last frame lands on the enemy view
      const fadeEnd = 299 + (side === 0 ? 61 : 1);
      assert.deepEqual(seen.get(fadeEnd), fieldsFromShot(ARENA), `snap on the enemy view at f${fadeEnd}`);
      if (side === 1) assert.notDeepEqual(seen.get(299), fieldsFromShot(ARENA));
    }
  });
}

test("entrance: the camera views differ player vs enemy for exactly 60 frames, from f300 (interpreter n310)", () => {
  const views = [0, 1].map((side) => {
    const r = entranceRig(side);
    const out = [];
    for (let f = 0; f <= REVERT_LAST_FRAME; f++) { r.at(f); out.push(stepFormChangeFrame(r.camRec, r.cam, f).fields.slice()); }
    return out;
  });
  const diff = [];
  for (let f = 0; f <= REVERT_LAST_FRAME; f++) if (JSON.stringify(views[0][f]) !== JSON.stringify(views[1][f])) diff.push(f);
  assert.equal(diff.length, 60, "60 frames differ");
  assert.equal(diff[0], 300, "the first is f300 (n310)");
  assert.equal(diff[59], 359);
  // the flash is identical for both sides
  for (let f = 0; f <= 200; f++) {
    assert.equal(formChangeState(FormChangeProgram.BLAST_REVERT, f).flashLevel,
      formChangeState(FormChangeProgram.ENTRANCE_ENEMY, f).flashLevel, `flash f${f}`);
  }
});

test("entrance: stop() puts the hidden side back when the window is cut short (either side)", () => {
  for (const side of [0, 1]) {
    const r = entranceRig(side);
    for (let f = 0; f <= 200; f++) { r.at(f); stepFormChangeFrame(r.camRec, r.cam, f); }
    assert.deepEqual(r.log.other, [[19, false]]);
    r.cam.stop();
    assert.deepEqual(r.log.other, [[19, false], [200, true]], `side ${side}: shown again`);
  }
});

test("entrance wiring: renderer reads the INCOMING fighter's shot and hides the other side; battle.js commits at the cut", () => {
  const b3 = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.match(b3, /entranceCameraSchedule\(eSide\)/);
  assert.match(b3, /shotTen: \(\) => entranceShot\(eSide, entrance\?\.folder, schedule\.shotIndex\)/);
  assert.match(b3, /setEnemyVisible: eSide \? setPlayerVisible : setEnemyVisible/, "the enemy entrance hides the partner");
  assert.match(b3, /FormChangeProgram\.ENTRANCE_ENEMY/);
  // the entering model is drawn the ordinary way (old until the swap, new after); the revert-only draw branch is gone
  assert.doesNotMatch(b3, /The revert \(entrance\.c\): the restored model is on from the cut/);
  // battle.js: ONE starter, every caller commits through onSwap
  assert.match(b, /function startEntrance\(b, \{ side, name,/);
  assert.match(b, /program: side \? FormChangeProgram\.ENTRANCE_ENEMY : FormChangeProgram\.BLAST_REVERT/);
  assert.match(b, /show\.onSwap\?\.\(\);/, "the record commits in the swap step (the cut)");
  assert.match(b, /show\.onDone\?\.\(\);/);
  // player tag: 0x38 line first, entrance on Circle, commit at the cut, the 0x39-style line after the task
  const tagAt = b.indexOf("function applyTagAction");
  const tag = b.slice(tagAt, b.indexOf("function commitTag", tagAt));
  assert.ok(!tag.includes("setPlayerVisible(false)"), "the outgoing model is not hidden at once");
  assert.ok(!tag.includes("b.activePlayerIndex = action.rosterIndex"), "the active record is not committed in applyTagAction");
  assert.match(b, /onSwap: \(\) => commitTag\(b, tag\.action\)/);
  assert.match(b, /side: 0, name: tag\.profile\.name,/);
  const commit = b.slice(b.indexOf("function commitTag"), b.indexOf("function applyDvAction"));
  assert.ok(commit.includes("b.activePlayerIndex = action.rosterIndex;") && commit.includes('queueAfterAction(b, "player");'));
  assert.ok(!b.includes("tagArrivalComplete") && !b.includes("arrivalFrames"), "the invented arrival timer is gone");
  assert.ok(!/legacyTagSwap|USE_ORIGINAL_TAG_SWAP/.test(b), "no legacyTagSwap URL flag");
  // Blast ending: the model swap moved from the commit to the cut
  const rv = b.slice(b.indexOf("function revertBlast"), b.indexOf("function startEntrance"));
  assert.ok(!rv.includes("swapPlayerModel(saved.name)"), "revertBlast no longer swaps the model at commit");
  assert.match(rv, /startEntrance\(b, \{\s+side: 0, name: saved\.name,/);
  // enemy: next enemy after a KO and the finale bodies are the enemy entrance
  const de = b.slice(b.indexOf("function defeatCurrentEnemy"), b.indexOf("function fuseIntoBoss"));
  assert.match(de, /startEntrance\(b, \{\s+side: 1,/);
  assert.ok(!de.includes("swapEnemyModel("), "no immediate enemy swap in defeatCurrentEnemy");
  const fin = b.slice(b.indexOf("function runFinaleBeat"), b.indexOf("function recordFinaleTechnique"));
  assert.match(fin, /startEntrance\(b, \{\s+side: 1, name: nextName,/);
  assert.ok(!fin.includes("swapEnemyModel("), "no immediate enemy swap in the finale beats");
});
