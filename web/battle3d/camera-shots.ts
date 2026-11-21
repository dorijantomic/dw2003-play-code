import { SLOW_MO_PUBLISH_AT, SLOW_MO_ACCUM_COST, slowMotionStep, arenaPlacement } from "../vendor/engine.js";
import { rotMatrixYXZ, rotApply } from "../fight/battle-camera.js";
import type { PlacementRecord } from "../types/battle3d.js";
import type { PlacementTable } from "../types/battle3d.js";

// op5 sub=0 camera presets — CAPTURED LIVE from the game (2026-07-06, Renamon-vs-Woodmon
// savestate, RAM read of the fight camera-preset tables via the op5 handler F0x8008c004 →
// m104 F0x800923b4). Values are the final camera-struct fields (eye/target in PS1 world,
// Y-down; H = GTE projection distance / zoom). Dispatch: preset 0 = reset to default (null
// here — render falls back to the default battle cam); presets 1-4 = mode-0 table idx 8-11;
// presets 5-7 = mode-0x10 table idx 0-2. preset 5 validated against a Diamond Storm live
// capture.
//
// These seven shots are NOT global: they are Renamon's near-side shots 8-11 and Woodmon's
// far-side shots 0-2, because that is the fight they were captured from. Every Digimon
// carries its own table in smdldata (claim
// fight-camera-canned-shots-are-per-model-smdldata-arrays-2026-08-18), extracted to
// model_placement.json and used by cannedShot() below; all 21 numbers here are reproduced
// byte-for-byte by that extraction, which is what validates it. This table remains only as
// the fallback for a model whose record has not loaded.
// Full decode: docs/research/fight-3d/battle-camera.md.
export const OP5_PRESETS = {
  1: { eye: [-1216, -1152, -1408], target: [128, -1280, -5696], H: 280 },
  2: { eye: [0, -1408, -2048],     target: [0, -1088, -5696],   H: 280 },
  3: { eye: [0, -384, -1856],      target: [0, -1408, -6208],   H: 280 },
  4: { eye: [0, -4096, -3072],     target: [0, -512, -5056],    H: 280 },
  5: { eye: [-3840, -2432, 512],   target: [0, -2048, 5888],    H: 280 },
  6: { eye: [0, -2432, -384],      target: [0, -2048, 5888],    H: 280 },
  7: { eye: [0, -1280, -384],      target: [0, -2048, 5888],    H: 280 },
};

// ─── Main factory ─────────────────────────────────────────────────────────────

/**
 * Create a 3D battle renderer.
 * @param {HTMLCanvasElement} canvas
 * @param {{playBattle: (name: string, side: string, durationFrames?: number) => void}|null} [sfx]
 * @returns {object} renderer API
 */
// ─── Arena placement (pro/smdldata.s, resource 0x1cc) ────────────────────────
// FIGHTSTG_F0x80087f38 places a fighter from its OWN record and the side nibble of
// its slot id (claim fight-arena-slot-is-per-model-standoff-and-hover-2026-08-18):
//   x = 0
//   y = -hover                       (record +0x18; 0 stands on the arena floor)
//   z = -+(0x1400 + standoff)        (record +0x10; near side negative, far positive)
// So the arena is symmetric about z = 0 and the two fighters stand at a distance that
// differs per matchup. The old fixed -5248 / +5888 were simply Renamon's stand-off of
// 128 and its opponent's of 768, read out of one capture.
export const PLACEMENT_URL = "assets/battle/model_placement.json";

/** (many-vs-many) How far a clip carries its attacker toward the target, in PS1 z: the largest of its op2 moves (mode 3
 *  arena-absolute target, mode 8 contact dash, mode 5 kind 4 leap). 0 = the clip never leaves its place (a cast, a hop). */
export function attackReachZ(ops, homeZ = 0, mirrored = false) {
  let reach = 0;
  for (const o of ops || []) {
    if (o.op !== 2) continue;
    const w = o.words || [], mode = w[0] | 0;
    if (mode === 3) reach = Math.max(reach, Math.abs((mirrored ? (w[4] | 0) : -(w[4] | 0)) - homeZ));
    else if (mode === 8) reach = Math.max(reach, 0x2800);
    else if (mode === 5 && (w[2] | 0) === 4) reach = Math.max(reach, Math.abs(((w[3] | 0) << 16 >> 16) + 0x2800));
  }
  return reach;
}

/** 0..1: the share of its run an attacker has made, from its forward travel (moveDelta z) over the clip's reach. */
export function attackLateralFraction(moveZ: number | undefined, reach: number) {
  return reach > 0 ? Math.min(1, Math.abs(moveZ!) / reach) : 0;
}

/**
 * The battle picture box (layer key 0x1009) shows the speaking Digimon. The
 * talk-system speaker id is 0 for the player side and 0x10 for the enemy side;
 * its high nibble selects the side (claim terra-037-speaker16-enemy-side-20260906).
 * Accepts the numeric id or the "player"/"enemy" side name.
 */
export function faceCamSideFor(speaker: string) {
  const id = typeof speaker === "number" ? speaker : (speaker === "enemy" ? 0x10 : 0);
  return (id & 0x10) ? "enemy" : "player";
}

export function modelKeyFromFolder(folder) {
  const m = /^m(\d{3})/.exec(String(folder || ""));
  return m ? String(Number(m[1])) : null;
}

/**
 * Which Digimon's camera table an op5 preset reads, and which shot of it.
 * The op5 handler passes a CONSTANT slot argument - 0 for presets 1-4 and 0x10 for
 * presets 5-7 - so the preset itself picks the side, not whoever issued it, and the
 * shot comes from the fighter standing in that slot.
 */
export function op5ShotSlot(preset) {
  const p = preset | 0;
  if (p >= 1 && p <= 4) return { side: "player", index: p + 7 };
  if (p >= 5 && p <= 7) return { side: "enemy", index: p - 5 };
  return null;   // preset 0 = reset to the default camera
}

/**
 * A model's own authored REACTION camera SCRIPT — every preset op5 in its clip-10 action script,
 * IN AUTHORED ORDER.
 *
 * The original installs no camera of its own when a clip authors no op5 (the handler
 * FIGHTSTG_F0x8008c004 runs only on an authored op5), and the reaction clip that carries the
 * impact camera is the damage-reaction default arm's clip 10 (`pro/fightstg.s:11008-11011`,
 * `.L0x8008d8e0: li $v0,0xa; sw $v0,0x54`). It is PER-MODEL data, enumerated over all 249
 * shipped packs by smdldata section (2 = near/player-side, 3 = far/enemy-side):
 *   • 53 of 56 near-side packs author `op5 [60, 0, 3]`;
 *   • the 16 far-side packs that author one use presets 7 / 6 / 1 (their own far-side shots);
 *   • the other 177 far-side packs author NONE, and the original then installs NO camera at all.
 *
 * The near-side clip-10 camera is not ONE op5 but a PAIR: `op5[60,0,3]` early and the restore
 * `op5[60,0,0]` late in the same clip (m003agum ops[1] and ops[12]; m383pken the same). Both run,
 * in order — the earlier worker picked only the first and so the camera glided out and never came
 * back. This returns the whole authored list, each entry `{ preset, duration }`; the record's
 * `sequence` runs them in order.
 *
 * The preset names a SLOT, not the model that authored it (`op5ShotSlot`, fightstg.s:9430-9445):
 * presets 1-4 are the NEAR fighter (slot 0), presets 5-7 the FAR one (slot 0x10). So a near-side
 * pack whose authored value is 3 aims at slot 0 whichever side it stands on — which is why this
 * pair is only ever a camera for the acting model itself (the item-use case, where the user IS the
 * slot the preset names), and why grafting it onto the OTHER fighter's hit framed the player's own
 * Digimon. Preset 0 (and >= 8) is the reset/default battle cam: it resolves to the arena shot
 * rather than a canned slot (the disc's m100), and its `preset` is left 0 here for the caller to
 * resolve.
 */
export function reactionCamFromActions(actions) {
  const ops = Array.isArray(actions) ? actions[10]?.ops : null;
  if (!Array.isArray(ops)) return [];
  const out = [];
  for (const o of ops) {
    if (!o || o.op !== 5) continue;
    const w = o.words || [];
    if (w[1] !== 0 || w[2] == null) continue;   // sub=1 is an explicit transform, not a preset
    out.push({ preset: w[2] | 0, duration: Math.max(0, w[0] | 0) });
  }
  return out;
}

// ─── The defeat camera (FIGHTSTG_F0x8008c93c, the loss-only effect) ────────────
// When the player loses, wfightmn's loss branch (0x800a9230) builds F0x8008cb44 ->
// object tick F0x8008c93c (the descriptor passed to the allocator F0x80014504 is
// `lui 0x8009 / addiu -0x36c4` = 0x8008c93c, which the allocator stores at object+0x48,
// the tick slot — so this is that object, not a shared method).
//
// Its first tick (phase 0, .L0x8008c988) does, in order:
//   1. `camMgr->[0x104](0, 0xb)` — the canned-shot selector F0x800923b4 with a1 = 0 and
//      a2 = 0xb, so the NEAR table of the acting fighter (a1 & 0xf0 == 0) at index 11.
//      It then zeroes the anchor (+0x18/+0x1c/+0x20) and the three frame angles
//      (+0x24/+0x26/+0x28), so the shot is absolute with the anchor at the arena origin.
//   2. `animMgr->[0xe8](0x17, 0x1e, 0x1e)` — motion 0x17 (SFSTDATA record 23) on a
//      manager built for this effect alone, not on either fighter. Not modelled here.
//   3. `[0x800a4548](2)` — slow motion. 0x800a4548 = F0x8009e510 (fightstg.s:34974),
//      which stores the level at 0x800a453c and calls F0x8009e428, the per-frame stepper.
//      It writes the delta the battle's animation clock reads from 0x800a4464; the orbit
//      below does not go through it, because the pointer at 0x8004df9c is never swapped.
//   4. `camMgr->[0x38](self)` — advance to phase 1.
// Every later tick (.L0x8008cad4, shared by phases 1 and 2) adds `delta * 2` to
// 0x800a46d8+0x26 — the shot frame's Y angle, 4096 to a turn — and re-applies the shot.
// Phase 1 also accumulates the delta at +0x10 and switches to phase 2 at >= 0xf0 (240
// frames at the real delta of 1, four seconds).
export const LOSS_CAM = {
  /** a2 of `camMgr->[0x104](0, 0xb)`: near-table shot 11 of the acting fighter. */
  shotIndex: 0xb,
  /** 0x800a46fe += delta * 2, and 0x1000 = one turn. */
  yawUnitsPerDelta: 2,
  turnUnits: 0x1000,
  /** The engine's per-frame delta, `[0x8004df9c]()`, and it is 1. The word it returns
   *  (0x8004de28) has exactly one writer, F0x8001d504 at .L0x8001d668, and it is
   *  `lw 0x1c($s0) sra 8` — the integer half of the 8.8 accumulator at 0x8004de2c. That
   *  accumulator's only other writer is the vblank handler F0x8001d3f4, which adds
   *  exactly 0x100 a call (.L0x8001d430; 0x133 on the 50 Hz branch, .L0x8001d460), so
   *  the published value rises by 1 per frame. Two independent checks agree: the 60-frame
   *  blend F0x800922b4 arms with a3 = 0x3c steps 68 a frame (0x100000/60 >> 8) and lands
   *  on 0x1000 in 60 frames only at delta 1, and a3 = 1 at .L0x80086f54 is a one-frame cut. */
  deltaPerFrame: 1,
  /** `[0x800a4548](2)`. The orbit does NOT run through it — F0x8008cad4 reads the raw
   *  delta from 0x8004df9c, and nothing in the game ever swaps that pointer (the table
   *  at 0x8004df98 is written nowhere), so slow motion slows the battle's animation
   *  clock at 0x800a4464 and leaves the camera at full speed. */
  slowMoLevel: 2,
  /** F0x8009e428 level 2, the slow-motion stepper `.L0x8009e428` runs every frame and the
   *  level `[0x800a4548]` arms: `published = 0; accumulator += delta;` then
   *  `while (accumulator >= 5) { published += 1; accumulator -= 4 }`
   *  (.L0x8009e4a8-.L0x8009e4d8). It writes `published` to 0x800a4464, which the BATTLE's
   *  animation clock reads: the model actor's frame counter `self+0x80 += 0x800a4464` at
   *  F0x80083d30, the second actor clock at .L0x80089614, and every op2 slot-motion blend
   *  and countdown (F0x8009b1fc / .L0x8009b380 / .L0x8009b520 / .L0x8009b5d4 / .L0x8009b720).
   *  So at the real rawDelta of 1 the battle animation advances ONE unit every FOUR frames
   *  for as long as the level stays at 2 — the fight's own clock, not the camera's, because
   *  the orbit reads `[0x8004df9c]()` directly (.L0x8008cad4). */
  // The step and its accumulator constants now come from the port
  // (engine/dw3/battle-slow-motion.ts): 5 publishes, 4 costs, so the average is exact.
  slowMoPublishAt: SLOW_MO_PUBLISH_AT,
  slowMoAccumCost: SLOW_MO_ACCUM_COST,
  /** Phase 2 at >= 0xf0 accumulated delta (F0x8008cac8) = 240 frames at delta 1. */
  phase2Delta: 0xf0,
};

/**
 * One frame of F0x8009e428, the slow-motion stepper that [0x800a4548] points at, writing
 * the delta the battle's animation and motion timers read from 0x800a4464. Level 0 passes
 * the frame's delta through, 1 freezes, 3 doubles, and 2 emits one unit per four
 * accumulated — a quarter of normal speed — keeping the 1..4 remainder so the average
 * stays exact. At the real delta of 1 that is one unit every fourth frame.
 *
 * This delegates to the port `slowMotionStep` (engine/dw3/battle-slow-motion.ts), whose
 * oracle drives the original words of F0x8009e428 per frame. The one behavioural
 * difference from the hand-written copy it replaces: the port CARRIES the accumulator
 * through levels 0/1/3 exactly as the original does (only level 2 ever advances it, and
 * the setter zeroes it), where the old copy reset it to 0 on those levels.
 */
export function slowMoStep(level: number, delta: number, acc = 0) {
  return slowMotionStep(level, delta, acc);
}

/**
 * The defeat camera's orbit in the game's own units: F0x8008cafc adds `delta * 2` to
 * the shot frame's Y angle, out of 4096 to a turn, and the delta there is the raw one
 * from `[0x8004df9c]()` — 1 a frame, 2 units, 0.176 degrees. `gameDelta` is the delta
 * the orbit has been given, so at full speed a frame's worth is one.
 */
export function lossCamYawUnits(gameDelta: number | undefined) {
  const n = (gameDelta! | 0) * LOSS_CAM.yawUnitsPerDelta;
  return ((n % LOSS_CAM.turnUnits) + LOSS_CAM.turnUnits) % LOSS_CAM.turnUnits;
}

/** Rotate a shot about the arena origin (the anchor F0x800923b4 leaves zeroed) by the
 *  frame's Y angle, in PS1 units. eye and target are both relative to that frame, and the
 *  matrix is the game's own RotMatrixYXZ (F0x8002b65c) with the other two angles at zero,
 *  so the sign of the swing is the one the original uses and not a mirrored guess. */
export function rotateShotYaw(eye, target, yawUnits: number) {
  const R = rotMatrixYXZ(0, yawUnits, 0);
  return { eye: rotApply(R, eye), target: rotApply(R, target) };
}

/** One fighter's home slot in PS1 arena units, Y down. The arithmetic — x, -hover and the
 *  ±(0x1400+standoff) z with the near side negated — is the ported FIGHTSTG_F0x80087F38
 *  placement (engine/dw3/battle-presentation.ts `arenaPlacement`), not a second copy: the
 *  near slot id 0 and the far slot id 0x10 select the two sides. */
export function arenaSlot(record: PlacementRecord | null, side: string) {
  const standoff = record?.standoff! | 0;
  const hover = record?.hover! | 0;
  const far = side === "enemy";
  const p = arenaPlacement(hover, standoff, far ? 0x10 : 0);
  return { x: p.x, y: p.y, z: p.z, side: far ? "enemy" : "player" };
}

/** Same, looked up by pack folder. An absent record falls back to a bare stand-off of 0. */
export function arenaSlotFor(folder: string | null | undefined, side: string, table: PlacementTable | null | undefined) {
  const key = modelKeyFromFolder(folder);
  return arenaSlot((key && table) ? table[key] : null, side);
}
