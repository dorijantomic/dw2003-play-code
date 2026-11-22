import { arenaSlotFor } from "../camera-shots.js";
import {
  skipFormChange,
  createRevertCamera,
  createDigivolveCamera,
  DV_SHOT_INDEX,
} from "../../fight/digivolve-camera.js";
import { FormChangeProgram, entranceCameraSchedule, formChangeCameraSchedule } from "../../vendor/engine.js";
import type { Battle3DContext } from "../../types/battle3d.js";
interface BlastState {
  done: boolean;
  frame: number;
}


// moved by tools/rewrite/split-closure.mjs
export function makeBlast(B$: Battle3DContext) {
function dnaPresentationStart() { B$.dnaPresentation = { tick: 0, fusionTick: null }; }
function dnaFusionStart() {
    if (!B$.dnaPresentation) dnaPresentationStart();
    B$.dnaPresentation!.fusionTick = 0;
  }
function dnaPresentationStop() { B$.dnaPresentation = null; B$.dnaOrbs = null; }
/** The renderer's arenaTint sink: r,g,b are PS1 view-colour bytes (0..255). */
  function setArenaTint(r: number | null, g: number, b: number) {
    if (r == null) { B$.arenaTint = null; return null; }
    const c = (v: number) => Math.max(0, Math.min(1, (v | 0) / 255));
    B$.arenaTint = [c(r), c(g), c(b), 1];
    return B$.arenaTint.slice();
  }
function dvHome() {
    return B$.playerAnim8r?.homeSlot || arenaSlotFor(B$.playerFolder, "player", B$.placementTable);
  }
// `entrance` = { folder }: the model folder of the fighter that enters (entrance.c key1), for the programs
  // BLAST_REVERT (player side, key2 0) and ENTRANCE_ENEMY (enemy side, key2 0x10).
  function blastPresentationSet(state: BlastState | null, program: string | null, skipped: boolean = false, weak: boolean | (() => boolean) = false, entrance = null) {
    B$.blastState = state || null;
    B$.entranceMotionTry();
    // "Digivolve Demo: OFF": the end state of the original presentation in one step.
    if (skipped) { skipFormChange(B$.camRec, B$.dvCam, () => B$.introShot(), B$.setEnemyVisible); B$.dvCam = null; return; }
    const isRevert = program === FormChangeProgram.BLAST_REVERT || program === FormChangeProgram.ENTRANCE_ENEMY;
    const eSide = program === FormChangeProgram.ENTRANCE_ENEMY ? 1 : 0;
    const schedule: { swapFrame: number; returnFrame: number; shotIndex?: number } | null = state && !state.done && program != null
      ? (isRevert ? entranceCameraSchedule(eSide) : formChangeCameraSchedule(program)) : null;
    if (!schedule) { B$.dvCam?.stop(); B$.dvCam = null; return; }
    B$.dvFrame = state.frame;
    if (!B$.dvCam && isRevert) {
      // The OTHER side's model is hidden f19..f298: the enemy on the player entrance, the partner on the enemy one.
      B$.dvCam = createRevertCamera({
        camRec: B$.camRec, schedule,
        shotTen: () => B$.entranceShot(eSide, entrance?.folder, schedule.shotIndex),
        arena: () => B$.introShot(),
        setEnemyVisible: eSide ? B$.setPlayerVisible : B$.setEnemyVisible,
        setMotion: (m) => B$.entranceMotionSet(eSide, entrance?.folder, m), weak,
      });
    } else if (!B$.dvCam) {
      B$.dvCam = createDigivolveCamera({
        camRec: B$.camRec, schedule,
        shotNine: () => B$.cannedShotSlot("player", DV_SHOT_INDEX),
        arena: () => B$.introShot(),
        homeZ: () => dvHome().z,
        modelKey: () => B$.playerFolder,
        // startChange hides the enemy model (f0), returnToBattle shows it (f651) and gives the partner its
        // final motion; motions 14/13 on f0, 13 on f437 (digimon_change.c); weak = the partner's idleMotion != 0.
        setEnemyVisible: B$.setEnemyVisible,
        setMotion: B$.playPlayerMotion, weak,
      });
    }
  }
function blastPresentationStop() { B$.dvCam?.stop(); B$.dvCam = null; B$.blastState = null; B$.entranceMotion = null; B$.effectPlayer?.clear(); }
/**
   * Spawn one of the transformation's REAL effect types on the fighter.
   *
   * `FIGHTSTG_F0x80089cd8` spawns these by id through `F0x80089be4`: 0x3E8,
   * 0x3E9, 0x3EA and 0x3EB for manual DV, 0x3EF and 0x3F0 for Blast — decimal
   * 1000-1003, 1007, 1008, every one of them file E000EVOL archive 6 in the
   * extracted manifest (claim blast-dv-visuals-are-e000evol-effects-2026-08-13).
   * This is the same EffectPlayer the action VM's op3 uses, so the art, the
   * channel defaults and the draw path are the shipped ones.
   */
  function blastSpawnEffect(type: number, pos?: { x: number; y: number; z: number; } | null) {
    if (!B$.effectPlayer?.hasType(type)) return 0;
    // The position is DECODED: F0x80089be4 copies the 8-byte {x,y,z,w} record it
    // is handed straight into the effect object, and the three records fightstg
    // uses are (0,0,32767), (160,120,32767) and (-160,-120,-1). z 32767 and -1
    // are the effect player's own screen-space markers.
    if (pos) return B$.effectPlayer.spawn(type, { x: pos.x, y: pos.y, z: pos.z }, "player");
    // Fallback only; every shipped caller passes the decoded record above.
    return B$.effectPlayer.spawn(type, { x: 160, y: 120, z: 32767 }, "player");
  }
function dnaOrbIgnite(key: string | number) {
    // Register a parent orb (1005/1006 ignitions during the parent phase). The converging
    // orbit itself starts when dnaOrbsPath() is called at the fusion segment.
    if (!B$.dnaOrbs) B$.dnaOrbs = { orbs: {}, u: 0, dur: B$.DNA_ORB_TICKS, orbiting: false };
    B$.dnaOrbs!.orbs[key] = { tick: 0 };
  }
// Begin the clockwise inward spiral that ends in the central collision. (Kept named
  // dnaOrbsPath for the battle.js call site; the old captured screen-path was replaced by
  // this procedural orbit — the capture never engaged and did not match the real motion.)
  function dnaOrbsPath(_path, _durTicks: number) {
    if (!B$.dnaOrbs) B$.dnaOrbs = { orbs: {}, u: 0, dur: B$.DNA_ORB_TICKS, orbiting: false };
    B$.dnaOrbs!.orbs.A ||= { tick: 0 };   // ensure both cores exist even if an ignite was missed
    B$.dnaOrbs!.orbs.B ||= { tick: 0 };
    B$.dnaOrbs!.orbiting = true;
    B$.dnaOrbs!.u = 0;
    B$.dnaOrbs!.dur = B$.DNA_ORB_TICKS;
  }
function dnaOrbsClear() { B$.dnaOrbs = null; }
// Sample an authored program record without creating an op3 object. The DNA
  // presentation owner uses this to restart its looping backdrop and to place
  // its fusion pair at the native screen sentinel.
  function _sampleEffectRecord(type: number, recordIndex: number, tick: number, pos: { x: number; y: number; z: number; }, loop: boolean = false) {
    const typeRec = B$.effectAssets?.manifest?.types?.[String(type)];
    const rec = typeRec?.records?.[recordIndex];
    if (!rec || rec.duration <= 0) return null;
    let t = Math.max(0, Math.floor(tick));
    if (loop) t %= Math.max(1, rec.duration - 1);
    else if (t >= rec.duration) return null;
    const chans = rec.defaults.slice();
    const last = Math.min(t, rec.frames.length - 1);
    for (let f = 0; f <= last; f++) {
      const row = rec.frames[f];
      let k = 0;
      for (let c = 0; c < 9; c++) if (rec.mask & (1 << c)) chans[c] = row[k++];
    }
    const [frame, clutShift, dx, dy, sx, sy, c6, c7, angle] = chans;
    if (!sx || !sy || frame === 255) return null;
    return {
      type: Number(type),   // the real effect type, so effectLayer() classes it like the original (FRONT 1000-1002/1007, else MODELS = under at z -1)
      arch: typeRec.arch, frame: frame | 0, clutShift: clutShift | 0,
      side: "player", screen: true, pos,
      dx: dx | 0, dy: dy | 0, sx: sx / 0x1000, sy: sy / 0x1000,
      rot: (angle | 0) * Math.PI * 2 / 4096, c6: c6 | 0, c7: c7 | 0,
    };
  }
// The DNA presentation's authored-record sprites (1000 intro, 1001 glyph layers, 1003 fusion burst), typed.
  function _dnaSampleSprites() {
    const list = [];
      // Registry owner 0x33 creates 1000 + 1001 at (0,0,32767). Program
      // 1000 is its 42-tick lead-in; 1001 is the looping DIGIMON/glyph field.
      if (B$.dnaPresentation) {
        const centre = { x: 0, y: 0, z: 32767 };
        const intro = _sampleEffectRecord(1000, 0, B$.dnaPresentation.tick, centre);
        if (intro) list.push(intro);
        // Program 1001 is a framebuffer-building sequence: clips 10..28 add one
        // four-tick digital layer apiece. State-8 proves the completed layers
        // remain together behind the actor, rather than replacing one another.
        const builtThrough = Math.min(72, Math.floor(B$.dnaPresentation.tick / 4) * 4);
        for (let phase = 0; phase <= builtThrough; phase += 4) {
          const glyphLayer = _sampleEffectRecord(1001, 0, phase, centre);
          if (glyphLayer) list.push(glyphLayer);
        }
        if (B$.dnaPresentation.fusionTick != null) {
          // The owner spawns 1003 at (-160,-120,-1). Its (+160,+120)
          // defaults center both counter-rotating records exactly.
          const corner = { x: -160, y: -120, z: -1 };
          for (let i = 0; i < 2; i++) {
            const burst = _sampleEffectRecord(1003, i, B$.dnaPresentation.fusionTick, corner);
            if (burst) list.push(burst);
          }
        }
      }
    return list;
  }
  return { dnaPresentationStart, dnaFusionStart, dnaPresentationStop, setArenaTint, dvHome, blastPresentationSet, blastPresentationStop, blastSpawnEffect, dnaOrbIgnite, dnaOrbsPath, dnaOrbsClear, _sampleEffectRecord, _dnaSampleSprites };
}
