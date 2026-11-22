import { battleFaceBoxVisible } from "../../battle3d.js";
import {
  op5ShotSlot,
  OP5_PRESETS,
  modelKeyFromFolder,
  LOSS_CAM,
  arenaSlot,
  reactionCamFromActions,
} from "../camera-shots.js";
import {
  nearCameraFor,
  arenaShotFor,
  modelRestSize,
  closestCameraRef,
  modelFrameSize,
  fitNearCamera,
  usesGiantFit,
  scaledRest,
  fitGiantNearCamera,
} from "../camera-fit.js";
import { faceBoxSource, fieldsFromShot, applyOp5 } from "../../fight/battle-camera.js";
import { createIdleDirector } from "../../fight/battle-idle-director.js";
import { createBattleOpenCamera, setSlowMotion as engineSetSlowMotion } from "../../vendor/engine.js";
import { authoredSide, mirrorCameraWords, mirrorPresetShot } from "../../fight/side-mirror.js";
import type { BattleOpenCameraArgs, Battle3DContext, CameraModeOptions } from "../../types/battle3d.js";
import type { ActorAnimator } from "../../fight/actor-animator.js";

// moved by tools/rewrite/split-closure.mjs
export function makeCamera(B$: Battle3DContext) {
// An op5 canned shot, read from the record of the Digimon standing in the slot the
  // preset names. Falls back to the captured Renamon/Woodmon table if that record is not
  // loaded yet.
  function cannedShot(preset: string | number) {
    const sel = op5ShotSlot(preset);
    if (!sel) return null;
    const slot = cannedShotSlot(sel.side, sel.index);
    return slot || OP5_PRESETS[preset] || null;
  }
// F0x800923b4 (the camera object's +0x104) as the idle director's arms call it: `a1` is
  // the side — 0 the NEAR table, 0x10 the FAR one — and `a2` the 0-based shot out of the
  // twelve (near) or three (far) that side's own Digimon record stores. This is the same
  // read `cannedShot` already made, named by slot instead of by op5 preset, because the
  // director passes the two arguments directly (fightstg.s:4766-4778, :4804-4812).
  function cannedShotSlot(side: string, index: number) {
    const key = modelKeyFromFolder(side === "player" ? B$.playerFolder : B$.enemyFolder);
    const cam = !key ? null : side === "player" ? playerNearCamera() : B$.placementTable![key]?.camera;
    const eye = cam?.eye?.[index], look = cam?.look?.[index];
    if (eye && look) return { eye, target: look, H: cam.view?.[index] };
    return null;
  }
// getFighterView(side, index) of the fighter that is ABOUT to enter (FIGHTSTG_updateEntrance reads the new
  // fighter's record before models->setId): near shot 10 of the incoming partner form, far shot 2 of the incoming
  // enemy. Until the swap `folder` is not the live model, so the record is read by its key; once swapped it is
  // the live model and cannedShotSlot answers (the fitted near table for a model without its own).
  function entranceShot(side, folder: string | null | undefined, index: number) {
    const name = side ? "enemy" : "player";
    if (!folder || folder === (side ? B$.enemyFolder : B$.playerFolder)) return cannedShotSlot(name, index);
    const key = modelKeyFromFolder(folder);
    const cam = !key ? null : side ? B$.placementTable![key]?.camera : nearCameraFor(B$.placementTable!, key);
    const eye = cam?.eye?.[index], look = cam?.look?.[index];
    if (eye && look) return { eye, target: look, H: cam.view?.[index] };
    return null;
  }
// F0x8008c93c's opening cut: `camMgr->[0x104](0, 0xb)`. F0x800923b4 reads a1 for the
  // side (0 = the near table) and a2 for the shot, so this is NEAR shot 11 out of OUR
  // own record — the same entry op5 preset 4 reads, since it is near index p + 7.
  function lossShot() {
    const cam = playerNearCamera();
    const i = LOSS_CAM.shotIndex;
    const eye = cam?.eye?.[i], look = cam?.look?.[i];
    if (eye && look) return { eye, target: look, H: cam.view?.[i] };
    return null;
  }
// FIGHTSTG_F0x800880f0 opens the fight, in its sub-state 0, by calling the camera
  // object's +0x100 method and applying the result instantly (+0xf8). That method,
  // FIGHTSTG_F0x8009257c, reads the FAR-side fighter's record for a 1-based canned shot
  // number and frames the NEAR side with it — the enemy chooses which of our Digimon's
  // twelve stored shots the battle opens on (claim
  // smdldata-record-0x44-is-the-far-side-canned-shot-number-2026-08-18). One read, one
  // place: arenaShotFor owns it, and returns null when the enemy's record carries no such
  // word, which is the case for every 0xC4 (partner) record.
  function introShot() {
    return arenaShotFor(B$.placementTable, B$.playerFolder, B$.enemyFolder, playerNearCamera());
  }
function setGiantCameraFit(on: boolean) {
    B$.giantCamFit = !!on;
    B$.fittedNearCam = null;         // drop the cached decision so the next call re-runs with the flag
    B$.giantNearCam = false;
    return B$.giantCamFit;
  }
function playerNearCamera() {
    const key = modelKeyFromFolder(B$.playerFolder);
    const rec = key != null ? B$.placementTable![key] : null;
    if (!rec) return null;
    if ((rec.camera?.eye?.length! | 0) >= 12) { B$.giantNearCam = false; return rec.camera; }
    // Giant mode part 1: the fit's subject is the body as DRAWN, so the cached table is keyed
    // by the live scale as well as by the model folder.
    const playerScale = B$.fighterScale.fighterScale("player");
    if (B$.fittedNearCam?.folder === B$.playerFolder && B$.fittedNearCam.scale === playerScale) {
      B$.giantNearCam = B$.fittedNearCam.giant; return B$.fittedNearCam.cam;
    }
    if (!B$.camRefSizes && !B$.camRefLoading) {
      B$.camRefLoading = true;
      fetch("assets/battle/camera_ref_sizes.json").then((r) => (r.ok ? r.json() : null)).then((j) => { B$.camRefSizes = j?.sizes ?? null; }, () => {});
    }
    const ownRest = B$.playerModel ? modelRestSize(B$.playerModel) : null;
    const pick = closestCameraRef(B$.camRefSizes, ownRest, B$.placementTable!);
    const refKey = pick?.key;
    const refRec = refKey != null ? B$.placementTable![refKey] : null;
    const own = ownRest ? modelFrameSize(B$.playerModel) : null;
    const ref = pick ? Math.max(pick.h, 0.5 * pick.w) : null;
    if (!refRec?.camera || !own || !ref) return nearCameraFor(B$.placementTable!, key);
    const k = Math.min(3, Math.max(0.5, own / ref));
    const refSlot = arenaSlot(refRec, "player"), ownSlot = arenaSlot(rec, "player");
    let cam = fitNearCamera(refRec.camera, refSlot, ownSlot, k);
    // A GIANT on our side (ANIM_GIANTS — the enemy-authored bodies that plant their feet) is
    // framed by the reference partner's own close near shots, which crop a body this size to its
    // legs and torso; dolly each shot back until the whole body (and the target, when the shot
    // has it in front) is inside the frame. Small models are outside the band and keep today's
    // shots; a shot that already fits is kept exactly (fitGiantNearCamera's identity). Giant mode
    // part 1 widens that band: a normal body drawn at 1.6x or more needs the same refit, and a
    // giant shrunk below 0.7x goes back to the ordinary path. Both the body box and the opposing
    // fighter's centre are the SCALED ones, because that is what the frame holds.
    let giant = false;
    let giantShots = null;
    if (B$.giantCamFit && usesGiantFit(B$.playerFolder, playerScale)) {
      const eSlot = B$.enemyAnim8r?.homeSlot;
      const eRest = B$.enemyModel ? scaledRest(modelRestSize(B$.enemyModel), B$.fighterScale.fighterScale("enemy")) : null;
      const target = eSlot ? [eSlot.x, eSlot.y - 0.5 * (eRest?.h ?? 0), eSlot.z] : null;
      const f = fitGiantNearCamera(cam, ownSlot, scaledRest(ownRest, playerScale), target!);
      cam = f.cam; giant = f.changed; giantShots = f.shots;
    }
    // The face close-up the same way, but scaled by HEIGHT alone, so it lands on the head
    // the way the reference's lands on the reference's. A 0x48 record's own face-box read runs past the
    // record (see faceBoxShot) and frames nothing.
    const kh = Math.min(3, Math.max(0.3, ownRest.h / pick!.h));
    const face = {};
    for (const side of ["player", "enemy"]) {
      const s = faceBoxSource(B$.placementTable, refKey, side).shot;
      const fit = (p) => [ownSlot.x + (p[0] - refSlot.x) * kh, ownSlot.y + (p[1] - refSlot.y) * kh,
        ownSlot.z + (p[2] - refSlot.z) * kh];
      face[side] = s ? { ...s, eye: fit(s.eye), target: fit(s.target) } : null;
    }
    B$.fittedNearCam = { folder: B$.playerFolder, scale: playerScale, cam, face, giant, shots: giantShots };
    B$.giantNearCam = giant;
    return cam;
  }
// The face-box shot for an enemy-only model on our side, fitted from Agumon's (null for a
  // partner, which reads its own record).
  function fittedFaceShot(side: string | number) {
    playerNearCamera();
    return B$.fittedNearCam?.folder === B$.playerFolder ? B$.fittedNearCam.face?.[side] ?? null : null;
  }
function applyArenaShot() {
    const shot = introShot();
    B$.introCamPending = !shot;
    if (!shot) return null;
    B$.camRec!.cut(fieldsFromShot(shot), { issuer: "battle" });
    return shot;
  }
function setCameraMode(m: string, opts: CameraModeOptions = {}) {
    // Who owns the camera this frame. `scriptOwnsCamera` is the original's own arbitration: the
    // battle's camera director (F0x8008718c) re-publishes its own record through the cut [0xf8]
    // on every tick it runs (fightstg.s:5096-5105), so while a script's op5 owns the record the
    // battle's camera must not cut over it. The director's EXISTENCE is the other half: on the
    // confirm edge the command screen writes state 3 and the exe FREES the object
    // (`exe/fns.s:8883`, `:8900-8905`), so for the rest of the attack nothing re-publishes —
    // `directorRetired` is that, and it replaces the old state-list freeze gate
    // (`web/battle.js` SCRIPT_OWNED_CAMERA_STATES).
    //
    // A glide the script armed is itself a script-owned camera move still in flight: the disc's
    // camera object interpolates the record every frame (FIGHTSTG_F0x80091df4) with no regard
    // for the script that armed it, and nothing expires the record. So while `isGliding()` the
    // director must not re-cut over it — otherwise an authored run (the item use's clip-10 op5
    // pair, `[60,0,preset]` then its `[60,0,0]` restore) is truncated mid-glide when the action
    // VM ends first.
    const valid = (m === "behind" || m === "orbit" || m === "game" || m === "director"
        || m === "tag" || m === "defeat" || m === "opening" || m === "free");
    // The disc's own camera edges, so the walker needs no state-list freeze:
    //   * the command menu opens -> a FRESH director is built (the phase's row-children arm);
    //   * the confirm is pressed -> the director's state-3 tick cuts the plain arena shot and
    //     the object is freed;
    //   * the victory / loss / tag cameras own the record for the rest of the fight, so the
    //     director is not brought back.
    if (valid) {
      if (m === "opening") {
        // The battle-open flourish runs BEFORE the first command menu, so the idle director does
        // not exist yet; a stale one from a previous turn must not re-publish over the opening,
        // and the flourish is created once (its port is idempotent, so this is only a safety net
        // for a render frame that runs before the opening machine's phase-1 create).
        B$.idleDirector = null; B$.directorRetired = false;
        beginOpeningCamera();
      } else if (m === "director") {
        if (B$.camMode !== "director" || B$.directorRetired) { B$.idleDirector = null; B$.directorRetired = false; }
      } else if (m === "behind") {
        if (B$.camMode === "director") retireIdleDirector();
      } else {
        B$.idleDirector = null; B$.directorRetired = false;
      }
    }
    B$.camScriptOwned = !!opts.scriptOwnsCamera || B$.camRec!.isGliding() || B$.directorRetired || !!B$.dvCam?.owns();
    if (m === "defeat" && B$.camMode !== "defeat") {
      B$.defeatDelta = 0; B$.defeatClock = 0;
      // F0x8008c93c's FIRST tick takes the camera with an explicit cut:
      // `camMgr->[0x104](0, 0xb)` fills eye/target/view-size and zeroes the anchor, the
      // three frame angles and the roll (.L0x80092530-.L0x80092548), and phases 1 and 2 then
      // re-apply that same record EVERY frame through `[0xf8]` with the Y angle grown by
      // `delta * 2` (.L0x8008cad4). The camera object holds ONE live record, so whatever was
      // on screen before the cut stops owning it the moment this cut lands — including an
      // action's own op5 shot and the battle's opening shot. The walker's defeat branch
      // re-publishes the same record every frame below, so nothing else is needed here.
    }
    if (valid) B$.camMode = m;
  }
function getCameraMode() { return B$.camMode; }
// `[0x800a4548](level)` — the original's slow-motion setter, F0x8009e510(level):
  // store the level at 0x800a453c, zero the accumulator at 0x800a4540, and step once.
  // 0 = normal (raw delta), 1 = frozen, 2 = one animation unit per four accumulated,
  // 3 = double. Only the loss effect's phase 0 uses 2, and nothing on the loss path
  // lowers it again (F0x8008c93c's phase 3 would, but no writer of phase 3 was found).
  function setSlowMotion(level: number) {
    const lv = level | 0;
    B$.slowMoLevel = lv;
    B$.slowMoAcc = 0;
    // F0x8009e510's arm: store the level, zero the accumulator, and step once — the port.
    const step = engineSetSlowMotion(lv, LOSS_CAM.deltaPerFrame);
    B$.slowMoAcc = step.acc;
    B$.slowMoDelta = step.delta;
    B$.slowMoTickSpeed = B$.GLOBAL_SPEED! * (step.delta / LOSS_CAM.deltaPerFrame);
    return { level: B$.slowMoLevel, delta: B$.slowMoDelta, acc: B$.slowMoAcc, tickSpeed: B$.slowMoTickSpeed };
  }
// What the loss beat is actually doing to the animation, in the original's own numbers:
  // the armed level, the delta the stepper last published to 0x800a4464, the accumulator
  // remainder, and the walker's table-step speed the last logic tick ran at, plus the
  // running totals (ticks and published units) a check measures the long-run rate from.
  // Plus which clip each fighter is playing — the walker's motion id IS the timeline table
  // index and its `animId` is that plus one (F0x80083a54 plays directory member animId - 1).
  function getAnimationReadout() {
    const side = (a: ActorAnimator | null | undefined) => (a ? {
      clip: a._clip | 0,
      table: a.timelineTable,
      animId: a.animationId,
      frame: a.frame,
      motion: a.vm?.lastMotion ?? null,
      vmRunning: !!(a.vm && !a.vm.ended),
      heldPose: !!a._heldPose,
    } : null);
    return {
      slowMoLevel: B$.slowMoLevel, slowMoDelta: B$.slowMoDelta, slowMoAcc: B$.slowMoAcc, slowMoTickSpeed: B$.slowMoTickSpeed, globalSpeed: B$.GLOBAL_SPEED,
      deltaPerFrame: LOSS_CAM.deltaPerFrame,
      slowMoTicks: B$.slowMoTicks, slowMoUnits: B$.slowMoUnits,
      slowMoRate: B$.slowMoTicks ? B$.slowMoUnits! / B$.slowMoTicks : null,
      player: side(B$.playerAnim8r),
      enemy: side(B$.enemyAnim8r),
    };
  }
function setGameCamParam(k: string, v: string | number) { if (k in B$.gameCam!) { B$.gameCam![k] = +v; return true; } return false; }
function getCameraInfo() { return B$.lastCamInfo ? { ...B$.lastCamInfo, params: { ...B$.gameCam } } : null; }
function getFaceCamRect() { return B$.faceCamRect; }
/** A presentation owns the screen: suppress the inset until it says otherwise. The
   *  object rule still decides whether the box exists; this only covers it. */
  function setFaceCamVisible(visible: boolean) { B$.faceBoxSuppressed = !visible; }
/** Feed the object rule this frame's three HUD facts. Returns whether the box is up. */
  function syncFaceBox(events: unknown) {
    B$.faceBoxOnScreen = battleFaceBoxVisible(B$.faceBox, events);
    return B$.faceBoxOnScreen;
  }
// The battle's IDLE camera is the original's cut director, FIGHTSTG_F0x8008718c, ported in
  // web/fight/battle-idle-director.js: four fixed shot lists out of the table at 0x800a24b8,
  // one rand_u16 % 3 between them, and a dwell in RAW per-frame deltas. It asks this module
  // for the same two shots the original asks the camera object for — `[0x100]` the arena shot
  // and `[0x104](side, index)` a canned shot — and returns the 14-word record it cuts that
  // tick, which is published through the one record owner below.
  // The director OBJECT exists only while the command menu is up. The disc creates it on the
  // fightstg command-menu phase's "build a row's children" arm and FREES it on the command
  // screen's confirm edge (`.dw3-research/attack-camera-retire-2026-10-08/worker-bb.md`): the
  // confirm writes state 3, the exe runs one terminal tick that re-cuts the plain arena shot
  // and then destroys the object, and nothing re-publishes the record for the rest of the
  // attack. `makeIdleDirector` builds a FRESH one on the next turn, which opens on row 3's
  // plain arena shot again — the same shot the retire cut, because state 0 arms row 3 and the
  // state-3 recut takes the same `[0x100]` arena shot.
  function makeIdleDirector() {
    return createIdleDirector({
      arena: () => { const s = introShot(); return s ? fieldsFromShot(s) : null; },
      canned: (side: string, index: number) => {
        const s = cannedShotSlot(side, index);
        return s ? fieldsFromShot(s) : null;
      },
    });
  }
/** The confirm edge: run the director's terminal state-3 tick, cut its arena shot, free it. */
  function retireIdleDirector() {
    if (!B$.idleDirector) return;             // never created this turn — nothing to retire
    const r = B$.idleDirector.retire();
    B$.idleDirector = null;
    B$.directorRetired = true;
    if (r) { B$.directorHeld = r; B$.camRec!.cut(r, { issuer: "battle" }); }
  }
// ── The battle-open camera flourish ─────────────────────────────────────────
  // The disc opens a battle with a short random camera beat over the arena before the first
  // command menu: the object FIGHTSTG_F0x800a1fe0 (class 0x800a1fe0), the battle controller's
  // child slot 6, created ONCE per battle in the opening machine's phase-1 fighter-load body
  // (`wfightmn.s:1175-1178`). On its first tick it picks one of THREE rows with `rand_u16 & 3`
  // and plays it — row 0 a pan, rows 1/2 a cut to a far/near canned angle that glides back —
  // then re-cuts the plain arena shot and self-destructs. It is the SECOND camera-sequence
  // driver of the family whose first member is the idle director, and it OWNS the camera for
  // the whole opening until its row ends. Ported once in engine/dw3/battle-open-camera.ts; this
  // drives it through the one camera-record owner, exactly as the idle director drives its arms.
  function makeOpenCamera() {
    return createBattleOpenCamera({
      arena: () => { const s = introShot(); return s ? fieldsFromShot(s) : null; },
      canned: (side, index) => {
        const s = cannedShotSlot(side, index);
        return s ? fieldsFromShot(s) : null;
      },
    } as BattleOpenCameraArgs);
  }
/**
   * The opening machine's phase-1 slot-6 create, called through the machine's port. Idempotent,
   * so the render tick can also call it when it runs first; the actor is created ONCE, exactly
   * as the disc creates it once per battle.
   */
  function beginOpeningCamera() {
    if (!B$.openCamera) {
      B$.openCamera = makeOpenCamera();
      B$.openCameraGone = false;
      B$.openCameraHeld = null;
      B$.openClock!.reset();
    }
    return B$.openCamera;
  }
// The arena shot: `camMgr->[0x100]` (F0x8009257c), the far side's own record naming a 1-based
  // shot out of the NEAR side's twelve. op5 preset 0 and every preset the eight-entry table does
  // not name (>= 8) both land here — F0x8008c004's dispatch is `sltiu $v0,$a2,0x8` with the
  // table at 0x80082ea0 whose entry 0 is the [0x100] call and whose fallthrough (>= 8) is the
  // same call again (fightstg.s:9414-9427 and :9424-9429). So preset 0 is a CUT to the arena
  // shot, not a reset to "no camera": the record is replaced, never emptied.
  function _arenaFields() {
    const shot = introShot();
    return shot ? fieldsFromShot(shot) : null;
  }
// op5 camera hook for one side's VM. sub=1 explicit transforms are authored in the PLAYER
  // slot's world frame, so they are honored only for the player side (as before). sub=0 presets
  // are DECODED + CAPTURED (2026-07-06): preset 0 = the arena shot ([0x100]); presets 1-7 =
  // the real canned camera shots read live from the game's fight camera-preset tables
  // (OP5_PRESETS above). Reaction clips issue these presets — the real game's "cut to the
  // struck Digimon as the hit lands".
  function _camHookFor(side: string) {
    // An enemy-only species the player owns stands on the near side with scripts authored for a far-side attacker: its
    // camera operands name the OPPOSING fighter as "the near one", which from our side is itself (side-mirror.js).
    const standsNearEnemyAuthored = () => {
      const a = side === "enemy" ? B$.enemyAnim8r : B$.playerAnim8r;
      // a script built from a donor (a spell, Double Guard) already aims its camera for our side; only the model's own are turned
      return a?.homeSlot?.side === "player" && authoredSide(a.model) === "enemy" && !a._camFromDonor;
    };
    return (rawRec) => {
      const turned = standsNearEnemyAuthored();
      const rec = turned && rawRec?.words ? { ...rawRec, words: mirrorCameraWords(rawRec.words) } : rawRec;
      const cs = applyOp5({}, rec);
      if (!cs.op5) return;
      if (turned && cs.op5.preset != null && (cs.op5.preset | 0) >= 1 && (cs.op5.preset | 0) <= 7) {
        // a preset names a slot: take the shot of the OPPOSITE fighter, else keep the neutral arena shot, never our own
        // Digimon as the struck one
        const m = mirrorPresetShot(cs.op5.preset);
        const shot = m ? cannedShotSlot(m.side, m.index) : null;
        const fields = shot ? fieldsFromShot(shot) : _arenaFields();
        const duration = Math.max(0, cs.op5.mode | 0);
        if (fields) {
          const installer = (side === "enemy" ? B$.enemyAnim8r : B$.playerAnim8r)?.vm;
          if (duration > 0) B$.camRec!.move(fields, duration, { issuer: side, issuerVm: installer });
          else B$.camRec!.cut(fields, { issuer: side, issuerVm: installer });
        }
        return;
      }
      // WHICH ACTION installed this shot. `issuer` alone names a SIDE, and the one shared camera
      // record keeps that label after the action that set it ends — so a later action can read
      // another action's label. Tag every install with the live action VM, so "did MY current
      // action set the record?" is answerable (cameraOwnedByAction).
      const installerVm = () => (side === "enemy" ? B$.enemyAnim8r : B$.playerAnim8r)?.vm;
      if (cs.op5.eye) {
        // A sub=1 explicit transform is ABSOLUTE op5 data authored PER SIDE — the "far-side
        // mirror across the arena mid-line" is FALSIFIED (docs/research/fight-3d/
        // tech-effects-decode.md §2026-08-18): the op5 handler stores its operands with no side
        // test, and far-side packs author their own transforms (clips 9 and 11 carry 51 sub=1
        // records in clip 11 alone). Both sides are therefore honoured; dropping the far side's
        // lost the camera of every enemy signature.
        const duration = Math.max(0, cs.op5.mode | 0);
        // duration > 0 arms the move ([0xfc] F0x800922b4, whose start block is the LIVE
        // record); duration 0 is the cut ([0xf8] F0x80092244). Either way the record is
        // REPLACED and outlives the script that installed it.
        if (duration > 0) B$.camRec!.move(cs.op5.fields, duration, { issuer: side, issuerVm: installerVm() });
        else B$.camRec!.cut(cs.op5.fields, { issuer: side, issuerVm: installerVm() });
        return;
      }
      if (cs.op5.preset != null) {
        const p = cs.op5.preset | 0;
        // op5's operand 0 is a MOVE DURATION, not a mode: F0x8008c004 keeps it in $s3 and, after
        // the arm fills the staging block, applies it through [0xf8] (the cut) when it is 0 and
        // through [0xfc] (the move, F0x800922b4, `a3 = $s3`) otherwise — the PRESET arm exactly
        // as the explicit-transform arm (.L0x8008c1cc). So a preset with a duration glides from
        // the live record over that many frames; a preset with 0 cuts. Both arms honour it, the
        // arena shot included. Dropping it made every authored preset glide an instant cut.
        const duration = Math.max(0, cs.op5.mode | 0);
        if (p === 0 || p >= 8) {
          const f = _arenaFields();
          if (f) {
            if (duration > 0) B$.camRec!.move(f, duration, { issuer: side, issuerVm: installerVm() });
            else B$.camRec!.cut(f, { issuer: side, issuerVm: installerVm() });
          }
          return;
        }
        // A canned shot goes through F0x800923b4, which fills only eye/target/H and explicitly
        // zeroes +0x18, +0x24..+0x28 and +0x2c — the record the walker resolves late, since the
        // model's own shot table can land after the op5. `duration` carries the [0xfc] glide.
        B$.camRec!.preset(p, { issuer: side, duration, issuerVm: installerVm() });
      }
    };
  }
// The clip-10 op-5 pair for ONE model — the ITEM/USE close-up, NOT an attack's impact camera.
  //
  // The corrected reading (.dw3-research/attack-camera-rule-2026-10-08/worker-av.md;
  // attack-camera-timing-2026-10-08/worker-ax.md): clip 10 (`fightstg.s:11008-11011`,
  // `.L0x8008d8e0: li $v0,0xa; sw $v0,0x54`) is selected by the damage-reaction machine
  // FIGHTSTG_F0x8008d3b4's DEFAULT arm — its kind word at the command object's +0x70 outside
  // 0x4d..0x5a — and that machine's ONLY caller in the whole shipped corpus is the battle
  // item/command executor FIGHTSTG_F0x8008dac0 (`fightstg.s:11175`). An ordinary landed basic or
  // TECH hit selects the defender's reaction through the attacker's authored op-1 records
  // (FIGHTSTG_F0x8008b69c, `fightstg.s:8809-8813`) as clip 2 survive / 3 death / 4 evade, and
  // clips 2/3/4 author an op5 in 0 of the 249 shipped packs — so a landed attack installs NO
  // defender camera. Live confirmation (worker-ax): the op-5 handler ran 0 times across a landed
  // hit, a miss and a counter, while the same hook fired 5x on our TECH, which authors op5.
  //
  // A real item use plays this pair through the acting actor's OWN clip-10 script
  // (web/battle.js `playPlayerActionClip`), and that is where it still runs. Its per-model data:
  // 53 of 56 near-side packs author `op5 [60,0,3]` then the restore `op5 [60,0,0]`; the 16
  // far-side packs that author one use presets 7 / 6 / 1; the other 177 far-side packs author
  // none. The preset resolves against the SLOT it names, never against the model that authored
  // it (`op5ShotSlot`, `fightstg.s:9430-9445`): preset 3 is slot 0, the NEAR fighter, whatever
  // model wrote the word — which is exactly why grafting this pair onto an attacker-wards hit
  // framed the operator's OWN Digimon.
  //
  // This readout is what the probes and __dnaDebug report as each fighter's clip-10 camera; the
  // attack path no longer installs it.
  function _reactionCamFor(side: string) {
    const model = side === "enemy" ? B$.enemyModel : B$.playerModel;
    return reactionCamFromActions(model?.actions);
  }
// At the type-99 strike, sync the bullet impact with the cut. This is the whole of the walker's
  // impact behaviour: it installs NO camera. The disc's clip-10 op-5 pair belongs to the item/use
  // and command path (`_reactionCamFor` above), not to the op-1 attack reaction, so an ordinary
  // landed hit leaves the camera alone — to the idle director, which re-publishes its own shot on
  // every tick it runs (`fightstg.s:5096-5105`, see the render camera block below).
  function _impactContact(extra) {
    const e = extra || {};
    return {
      ...e,
      onHit: (rec: { type: number; }) => {
        e.onHit?.(rec);
        if (rec.type === 99) B$.effectPlayer?.landProjectiles();   // bullet impact syncs with the cut
      },
    };
  }
// Compose the internal camera hook with any caller hooks (coordinator passes onHit, etc.).
  function _playerHooks(extra) {
    const e = extra || {};
    const cam = _camHookFor("player");
    return { ...e, onCamera: (rec) => { cam(rec); e.onCamera?.(rec); } };
  }
function _enemyHooks(extra) {
    const e = extra || {};
    const cam = _camHookFor("enemy");
    return { ...e, onCamera: (rec) => { cam(rec); e.onCamera?.(rec); } };
  }
  return { cannedShot, cannedShotSlot, entranceShot, lossShot, introShot, setGiantCameraFit, playerNearCamera, fittedFaceShot, applyArenaShot, setCameraMode, getCameraMode, setSlowMotion, getAnimationReadout, setGameCamParam, getCameraInfo, getFaceCamRect, setFaceCamVisible, syncFaceBox, makeIdleDirector, retireIdleDirector, makeOpenCamera, beginOpeningCamera, _arenaFields, _camHookFor, _reactionCamFor, _impactContact, _playerHooks, _enemyHooks };
}
