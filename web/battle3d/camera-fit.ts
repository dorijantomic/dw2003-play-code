import { isGiant } from "../fight/anim-donor-map.js";
import { modelKeyFromFolder } from "./camera-shots.js";
import { buildBoneWorldMatrices } from "./rotation.js";
import { posedVertex } from "./skeleton.js";
import { cross3, dot3, normalize, sub3 } from "./math.js";
import type { GiantShotOptions, PlacementTable } from "../types/battle3d.js";
interface GiantNearCameraInput {
  eye: [number, number, number][];
  look: number[][];
  view: number[];
}

interface GiantNearCameraOutput {
  eye: number[][];
  look: number[][];
  view: number[];
}

interface GiantNearCameraFitResult {
  cam: GiantNearCameraOutput | null;
  shots: (GiantShotFit | null)[];
  changed: boolean;
}

interface GiantShotRef {
  eye: [number, number, number];
  target: number[];
  H: number;
}

interface GiantShotFit {
  eye: number[];
  target: number[];
  H: number;
  lift: number;
  pull: number;
  changed: boolean;
}


/**
 * May the fight scene run its camera at all — i.e. are BOTH fighters' staging records in?
 *
 * This is the original's ORDER, and it is why a battle never opens on a camera that has no
 * shot. The fight's setup phase (phase 1, sub-state 2, `.L0x800927d0`) creates four objects in
 * one block, each only if its slot is still zero — the zero tests at :16134, :16141, :16149 and
 * :16156, the four creations at :16136-16160:
 *
 *   slot +0x00  F0x80093cc8              the fight object itself
 *   slot +0x04  F0x80093f9c(self+0x50, self+0x58)   the NEAR fighter's model object
 *   slot +0x08  F0x8009426c                          the FAR fighter's model object
 *   slot +0x18  F0x80087b84              THE IDLE CAMERA DIRECTOR  (its tick is F0x8008718c)
 *
 * So the director is created last, after the two records whose canned shots it reads — there is
 * no state in which it runs before they exist. Neither of its two shot loaders invents a shot
 * when a record is missing: `[0x100]` (F0x8009257c) returns the staging block's address untouched
 * on either of its two null checks (.L0x800925ac, .L0x800925c8) and `[0x104]` (F0x800923b4) does
 * the same on its one (.L0x800923f0), and no writer ever clears the record. So before this
 * predicate is true there is no record to draw through and nothing to fall back to.
 */
export function stagingRecordsReady(placementTable: PlacementTable | null | undefined, playerFolder: string | null | undefined, enemyFolder: string | null | undefined) {
  const has = (folder: string) => {
    const key = modelKeyFromFolder(folder);
    return !!(key != null && placementTable && placementTable[key]);
  };
  return !!(playerFolder && enemyFolder && has(playerFolder) && has(enemyFolder));
}

/**
 * The arena shot `[0x100]` (F0x8009257c) as the walker reads it: the FAR fighter's own record
 * names a 1-based canned shot, and the shot is cut from the NEAR side's twelve.
 *
 * `F0x800925ec` reads the word at `farRecord+0x44` and passes `value - 1` to `[0x104]` with
 * `a1 = 0` (the near table). That word is a FIELD only in a 0x48 record — it sits immediately
 * after that layout's three far-side projection distances — and a 0xC4 record is full at +0xC4
 * with its twelve near-side shots, so `+0x44` lands inside `eye[7].x` there. tools/extract_smdldata.py
 * emits `shot` for the 0x48 records only, which is why the 193 wild Digimon (the ones the disc
 * puts on the far side) carry it and the 55 partners do not. A far-side 0xC4 record therefore has
 * no opening shot here: the console would read six halfwords before the record's own camera array
 * out of whatever the staging block's neighbours happen to hold, which is not a behaviour to
 * reproduce, so this returns null and the caller keeps the last record instead of cutting one.
 */
export function arenaShotFor(placementTable, playerFolder: string | null | undefined, enemyFolder, nearCamOverride = null) {
  const nearCam = nearCamOverride ?? nearCameraFor(placementTable, modelKeyFromFolder(playerFolder));
  const far = placementTable?.[modelKeyFromFolder(enemyFolder)] ?? null;
  const index = (far?.shot | 0) - 1;
  if (index < 0 || !nearCam) return null;
  const eye = nearCam.eye?.[index], look = nearCam.look?.[index];
  if (!eye || !look) return null;
  return { eye, target: look, H: nearCam.view?.[index] };
}

/**
 * The twelve NEAR-side canned shots for the Digimon standing on our side.
 *
 * A partner's 0xC4 record carries them. A 0x48 record (the 193 Digimon the disc only ever puts
 * on the far side) carries just its three far-side shots, so when one of those is OUR Digimon —
 * an extra species, or a form of a new partner — there is no near table, nothing ever cuts a
 * camera record and the arena never draws. (Not a disc case: the console never stages them on
 * the near side.) This is the plain fallback — the near table of the partner whose stand-off is
 * closest; the battle renderer fits a reference partner's table to the model's size instead
 * (`fitNearCamera`) once both models are loaded.
 */
const _nearCamCache = new WeakMap();

export function nearCameraFor(placementTable: PlacementTable, key: string | null) {
  const rec = key != null ? placementTable?.[key] : null;
  if (!rec) return null;
  if ((rec.camera?.eye?.length! | 0) >= 12) return rec.camera;
  let cache = _nearCamCache.get(placementTable);
  if (!cache) { cache = new Map(); _nearCamCache.set(placementTable, cache); }
  if (cache.has(key)) return cache.get(key);
  let best = null, bestD = Infinity;
  for (const r of Object.values(placementTable)) {
    if ((r?.camera?.eye?.length! | 0) < 12) continue;
    const d = Math.abs((r.standoff! | 0) - (rec.standoff! | 0)) * 4 + Math.abs((r.hover! | 0) - (rec.hover! | 0));
    if (d < bestD) { best = r; bestD = d; }
  }
  const cam = best ? best.camera : null;
  cache.set(key, cam);
  return cam;
}

/**
 * The partner whose own near camera suits a model best: the closest in camera-framing size (height or half the width)
 * and, at half the weight, in shape (height over width). `sizes` is { modelKey: [height, width] } of every partner that
 * carries its twelve shots (assets/battle/camera_ref_sizes.json); `rest` is the model's { h, w }. Null until both are known.
 */
export function closestCameraRef(sizes: Record<string, [number, number]>, rest: { h: number; w: number; }, placementTable: PlacementTable) {
  if (!sizes || !rest || !(rest.h > 0) || !(rest.w > 0)) return null;
  const frame = Math.max(rest.h, 0.5 * rest.w), shape = Math.log(rest.h / rest.w);
  let best = null, bestD = Infinity;
  for (const [key, [h, w]] of Object.entries(sizes)) {
    if ((placementTable?.[key]?.camera?.eye?.length! | 0) < 12 || !(h > 0) || !(w > 0)) continue;
    const d = Math.abs(Math.log(Math.max(h, 0.5 * w) / frame)) + 0.5 * Math.abs(Math.log(h / w) - shape);
    if (d < bestD) { best = { key, h, w }; bestD = d; }
  }
  return best;
}

/**
 * A reference partner's near table refitted to another Digimon: every eye and look point is
 * taken relative to the reference fighter's home slot, scaled by `k` (our size over the
 * reference's) and put back relative to our own slot. Every shot keeps its direction and lens,
 * so the framing is the reference partner's — Agumon's close-up of Agumon becomes the same
 * close-up of Kunemon, however big or small Kunemon is.
 */
export function fitNearCamera(refCam, refSlot, ownSlot, k: number) {
  if (!refCam) return null;
  const fit = (p: number[]) => p && [
    ownSlot.x + (p[0]! - refSlot.x) * k,
    ownSlot.y + (p[1]! - refSlot.y) * k,
    ownSlot.z + (p[2]! - refSlot.z) * k,
  ];
  return { eye: refCam.eye.map(fit), look: refCam.look.map(fit), view: refCam.view.slice() };
}

/** The camera-framing size of a model: its rest pose (clip 0's first frame) in PS1 units,
 *  the height or half the width, whichever is larger: the shots are about as wide as they
 *  are tall and a partner fills roughly half the height, so only a very wide wingspan needs
 *  the camera further back than its height asks for. */
export function modelFrameSize(model) {
  const r = modelRestSize(model);
  return r ? Math.max(r.h, 0.5 * r.w) : null;
}

/** A model's rest pose (clip 0's first frame) height and width, PS1 units. */
export function modelRestSize(model) {
  if (!model?.bones) return null;
  if (model._restSize !== undefined) return model._restSize;
  const { mats } = buildBoneWorldMatrices(model, model.clips?.[0]?.start_frame ?? 0, null);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let b = 0; b < model.bones.length; b++) {
    const bone = model.bones[b];
    for (const face of bone.faces || []) for (const vi of face) {
      const [x, y] = posedVertex(bone, vi, b, mats);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  model._restSize = isFinite(x0) ? { h: y1 - y0, w: x1 - x0 } : null;
  return model._restSize;
}

// ── The GIANT near-camera fit (A5) ────────────────────────────────────────────
// A giant the disc never stages on the NEAR side — an enemy-only species (0x48 record) or a new
// partner's form played by us — has no near camera of its own, so playerNearCamera lends it the
// twelve shots of the partner closest to it in size (fitNearCamera). Those shots are the
// original's framing of ITS OWN fighter: their attack shots sit ~8k units behind the near slot
// and 3k up, which frames the 11-12k body of the biggest partner (and every giant that borrows
// one) as legs and torso — the player cannot see the attack the model performs (anim-a4.md
// "Camera", anim-sheets/a4-m441raiz-sheet.png). This refits a cropping shot so the WHOLE body,
// with the opposing fighter still in frame, is inside the 4:3 view:
//
//   • AIM at the body's own centre instead of the reference's aim point, which is what puts the
//     head back in frame — the old shot aims up past the body and cuts the body in half;
//   • LIFT the eye toward the body's top (a camera level with a 12k body sees far less of its
//     vertical span than one at its knee, and it does not leave the arena art);
//   • PULL BACK along the reference's own azimuth about our slot (≤ 1.5×, the last resort:
//     the disc's stage mesh is authored for the shots it ships, and a camera further out sees
//     the edge of the arena — the A5 first pass showed its ledge);
//   • WIDEN the lens (H down to GIANT_H_MIN) only when the closer framing cannot hold the body.
// A shot that already frames the body is returned EXACTLY as it was (this is a no-op for a small
// model — the fit is the identity — and the caller only runs it for the giant band, so Kunemon
// and every other small partner keep today's shots byte for byte). A model with its own twelve
// near shots (a partner authored for the near side, e.g. Gallantmon) returns its own record
// before reaching any of this, so the disc's own cameras are never touched.
export const GIANT_FRAME_FILL = 0.86;   // the share of the half-frame the body may reach

export const GIANT_H_MIN = 150;         // projection distance floor: fovY 2 atan(120/150) = 77.3°

export const GIANT_PULL_MAX = 4;        // pull-back cap along the reference azimuth (arena-sized)

export const GIANT_LIFT_STEPS = 8;      // eye-height steps tried between the reference and the top

export const GIANT_FIT_ASPECT = 4 / 3;  // the game's own 320x240 frame (a wider canvas sees more)

// F2 -> Screen -> "Battle camera a little further out" (HD Remaster only): how far the eye steps back
// along its view ray, and the camera modes it applies to (see the projection in render()).
export const BATTLE_WIDE_DOLLY = 1.25;

export const BATTLE_WIDE_MODES = new Set(["director", "behind"]);

const PS1_UP = [0, -1, 0];              // PS1 Y is DOWN

/** One Digimon's rest-pose body as a box standing in `slot`, PS1 units: the fit's subject. The
 *  extractor only measures height and width from the front, so the depth is half the width —
 *  the near face is what a camera beside the fighter sees first. */
export function bodyBoxCorners(rest: { h: number; w: number; }, slot: { x: number; y: number; z: number; }) {
  const h = rest?.h > 0 ? rest.h : 0, w = rest?.w > 0 ? rest.w : 0;
  const out = [];
  for (const x of [-0.5 * w, 0.5 * w])
    for (const y of [-h, 0])
      for (const z of [-0.25 * w, 0.25 * w]) out.push([slot.x + x, slot.y + y, slot.z + z]);
  return out;
}

/** Project one PS1 point through one PS1 shot into normalized device coordinates (|x|,|y| <= 1 is
 *  on screen), or null when the point is behind the eye. The projection is the one render()
 *  builds: fovY = 2 atan(120/H) (fovYFromH) and the horizontal from the frame aspect. */
export function shotPointNdc(shot, p: number[], aspect = GIANT_FIT_ASPECT) {
  if (!shot?.eye || !shot?.target || !(shot.H > 0)) return null;
  const fwd = normalize(sub3(shot.target, shot.eye));
  const back = [-fwd[0]!, -fwd[1]!, -fwd[2]!];           // camera space looks down −z
  const right = normalize(cross3(PS1_UP, back));
  const up = cross3(back, right);
  const d = sub3(p, shot.eye);
  const depth = -dot3(d, back);
  if (!(depth > 1)) return null;
  const tanY = 120 / shot.H;
  const tanX = tanY * aspect;
  return { x: dot3(d, right) / (depth * tanX), y: dot3(d, up) / (depth * tanY), depth };
}

/** The NDC bounds of a body box (plus the opposing fighter's centre, when that shot has it in
 *  front of the eye) through ONE shot. `behind` counts body corners the eye cannot see. */
export function shotBodyBounds(shot, slot, rest, target = null, aspect = GIANT_FIT_ASPECT) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  let behind = 0, maxDepth = 0;
  for (const p of bodyBoxCorners(rest, slot)) {
    const n = shotPointNdc(shot, p, aspect);
    if (!n) { behind++; continue; }
    if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x;
    if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y;
    if (n.depth > maxDepth) maxDepth = n.depth;
  }
  if (target) {
    const n = shotPointNdc(shot, target, aspect);
    if (n) {
      if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x;
      if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y;
      if (n.depth > maxDepth) maxDepth = n.depth;
    }
  }
  return { x0, x1, y0, y1, behind, maxDepth,
    fill: Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1)) };
}

/**
 * One near shot refitted so a giant's whole body fits: the reference's eye height is lifted toward
 * the body's top, its azimuth is kept (pulled back along that azimuth only when the lens floor is
 * reached), and the lens is widened as little as will fit. Returns the reference shot UNCHANGED
 * (`changed: false`) when it already frames the body, which is the identity every small model
 * takes. `target` is a CONSTRAINT (the opposing fighter must stay on screen), never the aim.
 */
export function giantShotFor(refShot: GiantShotRef, slot: { x: number; y: number; z: number; }, rest: { h: number; }, target = null, opts: GiantShotOptions = {}): GiantShotFit {
  const fill = opts.fill ?? GIANT_FRAME_FILL;
  const hMin = opts.hMin ?? GIANT_H_MIN;
  const pullMax = opts.pullMax ?? GIANT_PULL_MAX;
  const steps = opts.liftSteps ?? GIANT_LIFT_STEPS;
  const aspect = opts.aspect ?? GIANT_FIT_ASPECT;
  const h = rest?.h > 0 ? rest.h : 0;
  const bodyC = [slot.x, slot.y - 0.5 * h, slot.z];
  // The opposing fighter constrains a shot that already HAS it on screen (some near shots look
  // back at us from the enemy's side, and a shot that deliberately leaves it out must stay a shot
  // of our fighter); it is never the aim.
  const tn = target ? shotPointNdc(refShot, target, aspect) : null;
  const keep = tn && Math.abs(tn.x) <= 2 && Math.abs(tn.y) <= 2 ? target : null;
  // Already framed by the reference shot exactly as it stands? Then it is the identity.
  const asIs = shotBodyBounds(refShot, slot, rest, keep, aspect);
  if (!asIs.behind && asIs.fill <= fill) {
    return { eye: refShot.eye, target: refShot.target, H: refShot.H, lift: 0, pull: 1, changed: false };
  }
  const fits = (eye: number[], H: number) => {
    const b = shotBodyBounds({ eye, target: bodyC, H }, slot, rest, keep, aspect);
    return !b.behind && b.fill <= fill;
  };
  const dx = refShot.eye[0] - slot.x, dz = refShot.eye[2] - slot.z;
  const topY = slot.y - h;
  const hFloor = Math.min(hMin, refShot.H);
  for (let step = 0; step <= steps; step++) {
    const lift = step / steps;
    const eyeY = refShot.eye[1] + (topY - refShot.eye[1]) * lift;
    for (let pull = 1; pull <= pullMax + 1e-9; pull += 0.1) {
      const eye = [slot.x + dx * pull, eyeY, slot.z + dz * pull];
      for (let H = refShot.H; H >= hFloor; H -= 4) {
        if (fits(eye, H)) {
          // Reaching the search at all means the reference shot did not frame the body as it
          // stood, so the aim (the body's centre) is a change even when pull and lens are not.
          return { eye, target: bodyC, H, lift, pull, changed: true };
        }
      }
    }
  }
  // Nothing fits inside the caps: the widest, highest, furthest-back framing this rule allows.
  return {
    eye: [slot.x + dx * pullMax, topY, slot.z + dz * pullMax],
    target: bodyC, H: hMin, lift: 1, pull: pullMax, changed: true,
  };
}

/** A fitted near-shot table (fitNearCamera) refitted for a giant: per shot, `giantShotFor`. Returns
 *  the same `cam` object and `changed: false` when every shot already framed the body, so a model
 *  the reference framing holds is untouched. */
export function fitGiantNearCamera(cam: GiantNearCameraInput | null, slot: { x: number; y: number; z: number }, rest: { h: number; w: number; } | null, target = null, opts = {}): GiantNearCameraFitResult {
  if (!cam?.eye?.length) return { cam, shots: [], changed: false };
  const shots = [];
  let changed = false;
  for (let i = 0; i < cam.eye.length; i++) {
    const eye = cam.eye[i], look = cam.look?.[i], H = cam.view?.[i];
    if (!eye || !look || !(H > 0)) { shots.push(null); continue; }
    const fit = giantShotFor({ eye, target: look, H }, slot, rest!, target, opts);
    shots.push(fit);
    if (fit.changed) changed = true;
  }
  if (!changed) return { cam, shots, changed: false };
  return {
    cam: {
      eye: cam.eye.map((e, i: string | number) => shots[i]?.changed ? shots[i].eye : e),
      look: cam.look.map((p, i: string | number) => shots[i]?.changed ? shots[i].target : p),
      view: cam.view.map((v, i: string | number) => shots[i]?.changed ? shots[i].H : v),
    },
    shots, changed: true,
  };
}

// ── Giant mode part 1: any fighter can be scaled ──────────────────────────────
// The battle renderer draws each side at MODEL_SCALE × that side's own scale (1 = the shipped
// size, the default), and the body plus its hit/camera box grow about its feet because the
// scale is applied about the fighter's slot in _updateSkeletalVBOGL. F2 -> Extras -> "Giant
// mode" gates the whole feature: with it off the battle never sets a scale, so both sides stay
// at 1 and every frame is the one the game drew before.
export const FIGHTER_SCALE_MIN = 0.1;   // 1/10 of the shipped body

export const FIGHTER_SCALE_MAX = 16;    // 16x the shipped body

export const GIANT_FIT_K = 1.6;         // a normal body this many times its size opens the giant fit

export const GIANT_FIT_MIN_K = 0.7;     // a giant shrunk below this loses the fit (ordinary path)

/** A fighter's size multiplier, clamped to the band the renderer can draw. */
export function clampFighterScale(k: number) {
  const n = Number(k);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(FIGHTER_SCALE_MAX, Math.max(FIGHTER_SCALE_MIN, n));
}

/** The per-side scale store, pure so node tests can pin it without a WebGL context. */
export function createFighterScaleState() {
  const scales = { player: 1, enemy: 1 };
  const sideOf = (side: string) => (side === "enemy" ? "enemy" : "player");
  return {
    scales,
    setFighterScale(side: string, k: number) {
      const s = sideOf(side);
      scales[s] = clampFighterScale(k);
      return scales[s];
    },
    fighterScale(side: string) { return scales[sideOf(side)]; },
  };
}

/** One Digimon's rest-pose body, grown by its own scale, for the camera fit's body box. */
export function scaledRest(rest, k: number) {
  if (!rest) return null;
  const m = clampFighterScale(k);
  return { h: (rest.h ?? 0) * m, w: (rest.w ?? 0) * m };
}

/** Whether our near camera needs the giant refit for this body: a giant at its own size (or
 *  nearly — below 0.7x it is ordinary), or a normal body drawn at 1.6x or more. */
export function usesGiantFit(folder: string | null | undefined, k = 1) {
  const m = clampFighterScale(k);
  return isGiant(folder!) ? m >= GIANT_FIT_MIN_K : m >= GIANT_FIT_K;
}
