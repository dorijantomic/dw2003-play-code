// WHERE a technique's projectiles leave the body, and which limbs a contact move strikes with.
//
// A projectile op6 record carries the point the shot is drawn from. The disc's own packs write the
// WEAPON/HAND bone's point there (A6/A10 measured Gallantmon's raw op6 x = his lance bone's x), but the
// older build approximated that point from the model's geometry roles and always fired ONE shot. K13
// replaces the guess with the anatomy:
//
//   emitters (K14)   which BODY SITES fire - a mouth, each arm-head, a chest hatch, two eyes, ...
//   bone map (K12)   which BONE each of those sites is on this model's skeleton
//   shots rule (K14) how many projectiles a given technique fires and from which of those sites
//
// So a three-mouthed body (Deltamon) fires one fireball from each of its three mouth bones, a left-arm
// cannon (Minotarumon) fires from the left arm's tip and never from the right, a two-barrel body fires
// from both barrels, and a single-shot move fires once from the primary site. A contact move (per-limb
// contact) launches nothing: its beats are struck with the listed limbs in turn.
//
// The module is pure arithmetic over the model + the authored anatomy tables (no DOM, no fetch), so the
// builder, a node test and the contract all compute the same points from the same function.

import { shotsFor, emitters, armEquip } from "./digimon-anatomy.js";
import { BONEMAP, armChains, sideConfidence } from "./digimon-bonemap.js";
import { restPose } from "./anim-retarget.js";
import { authoredSide } from "./side-mirror.js";

/** The furthest a shot's spawn point may sit from its emitter's bone tip, as a share of body height. */
export const LAUNCH_SPREAD = 0.03;

/** The arena's fighter lines: a fighter stands at ±ARENA_HALF on z and the centre line on x. */
export const ARENA_HALF = 5120;

/**
 * The caster's own home line in its pack's authored frame: a player-authored pack stands at -z and aims
 * +z (its victim line is +ARENA_HALF); an enemy-authored one the other way round. (clip-fallback's
 * victimAnchor is the mirror of this.)
 */
export function homeLine(model) {
  return authoredSide(model) === "enemy" ? ARENA_HALF : -ARENA_HALF;
}

/**
 * The launch point as the action VM reports it. op6 words are [sub, sprite, x, y, z, ...] and the decoder
 * negates y and z, so a plan point p reaches setLunge in the model's authored frame as [-p.x, p.y, home
 * - p.z]. A script played by a fighter standing on the OTHER side goes through mirrorHooks, which flips x
 * and z again — so the same physical point arrives as [p.x, p.y, p.z - home]. C11 compares on either side
 * with this function, which is why the invariant holds for near and far alike.
 */
export function launchFrom(model, point, { mirrored = false } = {}) {
  const home = homeLine(model);
  return mirrored ? [point.x, point.y, point.z - home] : [-point.x, point.y, home - point.z];
}

const EMPTY = Object.freeze({ mode: "none", shots: 0, points: [], limbs: [], basis: "no-model" });

/** The model's own CENTRE emitters, in the order a shot should leave from one: a mouth fires, a head/chest
 *  hatch next, then the body itself. Used when a side-specific bone would be a guess. */
function centreBone(m) {
  return m.f?.mouth ?? m.f?.head ?? m.f?.chest ?? m.f?.eyes ?? m.f?.["whole-body"] ?? m.t ?? m.r ?? null;
}

/** The body's own launch site: the whole-body emitter, else the torso/root bone. */
function bodyBone(m) {
  return m.f?.["whole-body"] ?? m.t ?? m.r ?? null;
}

/** The bone a side-blind shot leaves from, and the bone a rig with no arms fires from (see emitterBone). */
export function centreEmitterBone(folder) { return BONEMAP[folder] ? centreBone(BONEMAP[folder]) : null; }
export function bodyEmitterBone(folder) { return BONEMAP[folder] ? bodyBone(BONEMAP[folder]) : null; }

/**
 * The bone that carries one emitter site. Emitter ids are bone-map `f` keys, with a site index when a
 * design has more than one of the same part: `left-arm-2` / `left-arm-3` are the 2nd/3rd arm of that
 * side (K12 stores those chains in `aLe`/`aRe`), their tip being the hand on that arm.
 *
 * Two K12 facts decide whether a SIDE-specific site may be used at all:
 *   * side confidence LOW - the model's left/right read was not established by the side audit, so naming
 *     that arm would be a guess: the shot leaves from the body's centre emitter instead.
 *   * no arm chain - 23 rigs have no arm chain to fire from: the body emitter is the honest site.
 */
export function emitterBone(folder, id) {
  const m = BONEMAP[folder];
  if (!m || !id) return null;
  const part = String(id).replace(/-\d+$/, "");
  const sided = part === "left-arm" || part === "right-arm" || part === "both-arms";
  if (sided && sideConfidence(folder) === "low") return centreBone(m);
  const site = /^(left-arm|right-arm)-(\d+)$/.exec(String(id));
  if (site) {
    const side = site[1] === "left-arm" ? "left" : "right";
    const chains = armChains(folder, side);
    const chain = chains[(site[2] | 0) - 1];
    if (chain && chain.length) return chain[chain.length - 1];
    // the rig has no such extra arm: the first arm of that side is the honest place for the shot, and a rig
    // with NO arm at all launches from its body emitter (never from a bone it does not have)
    const first = chains[0];
    if (first && first.length) return first[first.length - 1];
    return m.f?.[site[1]] ?? bodyBone(m);
  }
  if (sided && !(m.f && m.f[part] != null) && !armChains(folder, part === "left-arm" ? "left" : "right").length) {
    return bodyBone(m);
  }
  if (m.f && m.f[part] != null) return m.f[part];
  // A site the rig has no bone for (a second head on a one-headed rig, a tail on a legless blob): the rig's
  // own nearest site still points the shot at the right part of the body. Same chain launchBone() uses.
  if (part === "mouth" || part === "head") return m.f?.mouth ?? m.f?.head ?? m.h ?? null;
  if (part === "eyes") return m.f?.eyes ?? m.f?.head ?? m.h ?? null;
  return m.f?.["whole-body"] ?? m.t ?? m.r ?? null;
}

/** Every bone the model fires from, from its emitter list (not from the technique). */
export function emitterBones(folder) {
  const out = [];
  for (const e of emitters(folder)) {
    if (e.kind === "melee") continue;
    const bone = emitterBone(folder, e.id);
    if (bone != null) out.push({ id: e.id, part: e.part, bone, count: e.count, kind: e.kind });
  }
  return out;
}

/** The frame window a timeline table plays (frames it names), or null. */
export function tableWindow(model, table) {
  const tab = table != null ? model?.timeline?.[table]?.table : null;
  if (!Array.isArray(tab) || !tab.length) return null;
  let lo = Infinity, hi = -1;
  for (const e of tab) {
    const v = e?.value | 0;
    if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  return hi < 0 ? null : { lo, hi };
}

/**
 * The frame window of a BODY - one table or the whole sequence the script binds (a basic attack is
 * tables 14..18, one swing spread over five playlists that index the SAME keyframe sequence). The
 * launch point is taken over the whole body, so it does not depend on which of those tables happens to
 * be playing at the launch tick.
 */
export function bodyWindow(model, tables) {
  const list = (Array.isArray(tables) ? tables : [tables]).filter((t) => t != null);
  let lo = Infinity, hi = -1;
  for (const t of list) {
    const w = tableWindow(model, t);
    if (!w) continue;
    if (w.lo < lo) lo = w.lo;
    if (w.hi > hi) hi = w.hi;
  }
  return hi < 0 ? null : { lo, hi };
}

/**
 * The model's own poses over a body's frame window: `samples` evenly spaced frames, each with every
 * bone's world position (the renderer's own rest-pose arithmetic, anim-retarget.restPose).
 */
export function poseWindow(model, tables, samples = 16) {
  const w = bodyWindow(model, tables);
  const frames = [];
  if (w) for (let k = 0; k < samples; k++) frames.push(Math.round(w.lo + ((w.hi - w.lo) * k) / Math.max(1, samples - 1)));
  else frames.push(0);
  return frames.map((frame) => {
    const rp = restPose(model, frame);
    return { frame, pos: rp.pos, rot: rp.rot };
  });
}

/**
 * A bone's TIP in model space: the bone's own point extended one bone-length along the limb, i.e. the
 * END of the segment it starts. A skeleton records the HEAD of every bone, so the hand bone's point is
 * the WRIST, not the muzzle of the gun it holds: a shot written at the wrist is drawn inside the body
 * and (from a camera behind the caster) is hidden by its own back - the operator's "no projectile"
 * report. The length comes from the rig itself, in this order:
 *   1. the bone BEFORE it in the anatomy's own limb chain (K12's arm chains) - the limb's own direction;
 *   2. the skeleton's parent slot, when the rig states one that is not the bone itself (most PS1 rigs
 *      this pack ships carry a self-referential slot, so this rarely fires);
 *   3. none - the bone's own point (a root/torso emitter has no limb to extend along).
 */
export function tipOf(pos, model, bone, prevBone = null) {
  const p = pos?.[bone];
  if (!p) return null;
  let q = prevBone != null ? pos?.[prevBone] : null;
  if (!q) {
    const par = model?.bones?.[bone]?.parent_slot;
    if (par != null && par >= 0 && par !== bone) q = pos?.[par];
  }
  if (!q) return [p[0], p[1], p[2]];
  return [2 * p[0] - q[0], 2 * p[1] - q[1], 2 * p[2] - q[2]];
}

/** The bone before `bone` in the anatomy's own limb chain for emitter `id`, or null. */
export function chainPrevBone(folder, id, bone) {
  const part = String(id ?? "").replace(/-\d+$/, "");
  const side = part === "left-arm" ? "left" : part === "right-arm" ? "right"
    : part === "both-arms" ? "left" : null;
  if (!side) return null;
  for (const ch of armChains(folder, side)) {
    const i = ch.indexOf(bone);
    if (i > 0) return ch[i - 1];
  }
  return null;
}

/**
 * The point a bone's TIP occupies in the pose the limb FIRES from: the pose where the tip reaches
 * furthest along the caster's own aim (+z in the authored frame - a raised weapon still points at the
 * enemy), with the highest point (smallest y; the arena's +Y is down) as the tie-break. Returns
 * { frame, x, y, z }.
 *
 * A14: the old rule took the HIGHEST point only, and for a rig whose cast swings the arm up and BACK
 * that is the wind-up pose - measured on Deltamon, whose muzzles then sat 3456 units BEHIND its own
 * root, so the shot started nearly a third of an arena-length short and could never reach the victim
 * (C12 measured the closest approach at 6493 units). Reaching forward first, high second, picks the
 * extended pose the flight is authored for.
 */
export function boneTip(model, bone, { table = null, window = null, prev = null } = {}) {
  if (!model || bone == null) return null;
  const poses = window ?? poseWindow(model, table);
  let best = null;
  for (const p of poses) {
    const v = tipOf(p.pos, model, bone, prev);
    if (!v) continue;
    if (!best || v[2] > best.z || (v[2] === best.z && v[1] < best.y)) best = { frame: p.frame, x: v[0], y: v[1], z: v[2] };
  }
  return best;
}

/**
 * The side an emitter id names, or null for a site that is not an arm ("mouth", "chest", ...).
 */
export function emitterSide(id) {
  const part = String(id ?? "").replace(/-\d+$/, "");
  if (part === "left-arm" || part === "both-arms") return "left";
  if (part === "right-arm") return "right";
  return null;
}

/**
 * A15 (C15): THE WEAPON'S TIP, when the arm ends in a PROP.
 *
 * The bone an arm chain ends at records the WRIST's head, and the hand bone's mesh carries both the
 * hand and whatever it holds - an axe blade, a gun barrel, a staff. Firing from the bone's own tip
 * therefore fires from the FIST: the operator's "the spell is fired from his left fist although the left
 * hand carries a big axe" (Boltmon, A15). The prop's tip is a property of the MODEL DATA (K17's
 * `armEquip`: which arm ends in a prop, on which bone, attached how), so:
 *   * class elongated / flat / bulky and attached to the ARM chain -> the farthest mesh vertex of that
 *     bone from the bone's own point, in the same pose window the bone tip is taken over (the pose where
 *     the tip reaches furthest along the caster's aim, exactly like boneTip);
 *   * bare hand, no data, or a prop worn on the torso/back -> null, and the caller keeps the bone tip.
 * No species names, no per-model pins: the verdict is K17's data and the vertices are the model's own.
 */
export function propTipPoint(model, folder, side, { window = null } = {}) {
  if (!model || !folder || !side) return null;
  const equip = armEquip(folder, side);
  if (!equip || equip.class === "none" || equip.class === "bare") return null;
  if (equip.attachment && equip.attachment !== "arm") return null;
  const bone = equip.bone;
  const b = model?.bones?.[bone];
  const verts = b?.verts ?? [];
  if (!verts.length) return null;
  const poses = window ?? poseWindow(model, null);
  let best = null;
  for (const p of poses) {
    const R = p.rot?.[bone], t = p.pos?.[bone];
    if (!R || !t) continue;
    let far = null, fd = -1;
    for (const v of verts) {
      const wx = -(R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) + t[0];
      const wy =  (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1];
      const wz = -(R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) + t[2];
      const d = Math.hypot(wx - t[0], wy - t[1], wz - t[2]);
      if (d > fd) { fd = d; far = [wx, wy, wz]; }
    }
    if (!far) continue;
    if (!best || far[2] > best.z || (far[2] === best.z && far[1] < best.y)) {
      best = { frame: p.frame, x: far[0], y: far[1], z: far[2], reach: fd };
    }
  }
  if (!best) return null;
  // A prop the pack keeps SCALED OFF at that frame is not there to fire from: propTipPoint reads the
  // rest pose (no ch3), so a plan built on it would aim at a point where the mesh is collapsed to the
  // bone (m443sgr2's arm blades are ch3-0 until frame 1136 - a shot "from the blade" would leave an
  // empty hand). Fall back to the limb's own tip, which is what the player actually sees.
  const scale = scaleAt(model?.bones?.[bone]?.anim?.ch3, best.frame);
  if (scale < 0.05) return null;
  return { ...best, bone, equip: equip.class, source: equip.source, confidence: equip.confidence };
}

/** Linear read of a ch3 scale channel ([x,y,z,frame] keys, 4096 = 1.0) at `frame`. */
function scaleAt(ch3, frame) {
  if (!Array.isArray(ch3) || !ch3.length) return 1;
  let prev = null;
  for (const k of ch3) {
    const f = k[3] | 0;
    if (f === 30000) break;
    if (f <= frame) { prev = k; continue; }
    if (!prev) return Math.max(Math.abs(k[0]), Math.abs(k[1]), Math.abs(k[2])) / 4096;
    const span = (f - (prev[3] | 0)) || 1;
    const t = (frame - (prev[3] | 0)) / span;
    const v = [prev[0] + (k[0] - prev[0]) * t, prev[1] + (k[1] - prev[1]) * t, prev[2] + (k[2] - prev[2]) * t];
    return Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) / 4096;
  }
  return prev ? Math.max(Math.abs(prev[0]), Math.abs(prev[1]), Math.abs(prev[2])) / 4096 : 1;
}

/**
 * The point an emitter's shot leaves from: the WEAPON's tip when the arm carries a prop (C15), else the
 * limb's own tip as before.
 */
export function emitterTip(model, folder, id, bone, { window = null, prev = null } = {}) {
  const side = emitterSide(id);
  const prop = side ? propTipPoint(model, folder, side, { window }) : null;
  if (prop) return { frame: prop.frame, x: prop.x, y: prop.y, z: prop.z, source: "prop", propBone: prop.bone, equip: prop.equip };
  const tip = boneTip(model, bone, { window, prev });
  return tip ? { ...tip, source: "tip" } : null;
}

/** The point a plan point was taken from, recomputed for a frame: the C11/C15 cross-check. */
export function tipPointFor(model, point, frame = null) {
  if (!model || !point) return null;
  const { folder } = model;
  const window = frame == null ? null : [{ frame, pos: restPose(model, frame).pos, rot: restPose(model, frame).rot }];
  if (point.source === "prop") {
    const side = emitterSide(point.id);
    const prop = side ? propTipPoint(model, folder, side, { window: window ?? poseWindow(model, null) }) : null;
    return prop ? [prop.x, prop.y, prop.z] : null;
  }
  const p = frame == null ? poseWindow(model, null) : window;
  const poses = p;
  let best = null;
  for (const pose of poses) {
    const v = tipOf(pose.pos, model, point.bone, chainPrevBone(folder, point.id, point.bone));
    if (!v) continue;
    if (!best || v[2] > best[2] || (v[2] === best[2] && v[1] < best[1])) best = v;
  }
  return best;
}

/**
 * The launch plan for one technique on one model.
 *   { mode, shots, basis, points: [{ id, part, count, index, bone, frame, x, y, z, spread, source }], limbs }
 * `mode` is the shots rule the anatomy gives this technique (single | per-emitter | per-limb-contact |
 * none); `points` is one entry per PROJECTILE (so an emitter with count 3 yields three), each with the
 * bone it leaves from and the point that bone's tip occupies at the cast's extension; `limbs` is the
 * striking limbs of a contact move, in the order the beats use them.
 *
 * opts.volley forces the one-per-emitter reading for a move the disc presents with its volley clip.
 */
export function launchPointsFor(model, { folder = model?.folder, tech = null, volley = false, table = null, tables = null, frame = null } = {}) {
  if (!model || !folder) return { ...EMPTY };
  const rule = shotsFor(folder, tech, { volley: !!volley });
  const mode = rule.mode;
  if (mode === "none") return { mode, shots: 0, points: [], limbs: [], basis: rule.basis };
  if (mode === "per-limb-contact") {
    const limbs = (rule.emitters || []).map((id) => ({ id, bone: emitterBone(folder, id) })).filter((l) => l.bone != null);
    return { mode, shots: 0, points: [], limbs, basis: rule.basis };
  }
  const sites = emitters(folder);
  // a SOLVED cast fires from where its own pose holds the emitter AT THE RELEASE FRAME (K19f): the window
  // scan below picks the most extended pose of an authored table, which for a generated table is the
  // neutral one whenever the emitter only ever reaches its release later in the cast.
  const win = frame != null ? [{ frame, pose: restPose(model, frame) }].map((s) => ({ frame: s.frame, pos: s.pose.pos, rot: s.pose.rot })) : null;
  const window = win ?? poseWindow(model, tables ?? (table != null ? [table] : []));
  const H = modelHeight(model, window);
  const points = [];
  for (const id of rule.emitters || []) {
    const site = sites.find((e) => e.id === id) || { id, part: String(id).replace(/-\d+$/, ""), count: 1, kind: "projectile" };
    const bone = emitterBone(folder, id);
    if (bone == null) continue;
    // the WEAPON's tip when this arm carries a prop (C15), else the limb's own tip
    const tip = emitterTip(model, folder, id, bone, { window, prev: chainPrevBone(folder, id, bone) });
    if (!tip) continue;
    // `single` fires ONE shot from the named site whatever the site holds; `per-emitter` fires the site's
    // own count (two chest tubes, six eyes, four snout lasers) from that one bone.
    const n = mode === "per-emitter" ? Math.max(1, site.count | 0) : 1;
    for (let k = 0; k < n; k++) {
      // `count` shots from ONE site sit on a small ring around its tip: they leave together, and two
      // shots drawn from exactly the same point would overlap into one sprite on screen.
      const spread = n > 1 ? (LAUNCH_SPREAD * H) / Math.max(2, n) : 0;
      const ang = (Math.PI * 2 * k) / n;
      points.push({
        id, part: site.part, count: n, index: k, bone, frame: tip.frame,
        x: Math.round(tip.x + spread * Math.cos(ang)),
        y: Math.round(tip.y + spread * Math.sin(ang)),
        z: Math.round(tip.z),
        spread: Math.round(spread),
        source: tip.source,
        propBone: tip.propBone ?? null,
      });
    }
  }
  return { mode, shots: points.length, points, limbs: [], basis: rule.basis };
}

function modelHeight(model, window) {
  let lo = Infinity, hi = -Infinity;
  for (const p of window) for (const v of p.pos) { if (!v) continue; if (v[1] < lo) lo = v[1]; if (v[1] > hi) hi = v[1]; }
  return isFinite(lo) && hi > lo ? hi - lo : 1;
}

/**
 * The op6 launch records for a plan, in the disc's own word format:
 *   [0, sprite, x, y, z, rotX, rotY, rotZ]
 * The decoder negates y and z (action-vm op6), and the near-side fighter is drawn with a 180° yaw, so a
 * model-local point p is written as -x, -y, and `-homeZ + p.z` (the authored packs' own form: the home
 * line plus the bone's forward offset).
 *
 * The ROOT YAW (word 6) is NOT the donor's business. Every shipped pack's layer tracks ramp their own
 * local z toward -10240, and the disc turns that into "toward the enemy" with one per-side constant:
 * 2048 (half a turn) in 223 of the 224 PLAYER-authored op6 records and 0 in all 121 ENEMY-authored ones
 * (the same split side-mirror.authoredSide() reads). A built cast that copied the donor's word therefore
 * flew BACKWARDS whenever the donor was authored for the other side - measured: Deltamon's Triple Fire
 * left its mouths flying away from the defender, at the camera. Writing the caster's own side word makes
 * the shot leave toward the victim for every side, and mirrorHooks still adds its half turn when the
 * script is played from the far side. `flight` may still supply the pack's tilt words (5 and 7).
 *
 * A14 measured the alternative - choose the yaw per pack from the sign of its own travel track
 * (97 of the 129 meshes ramp local -Z, 3 +Z, 29 sideways) - and REJECTED it: the packs' z reaches the
 * battle frame through the decoder's negation, so the per-side word is the correct one there, and the
 * per-pack rule moved Minotarumon's shot from 1 unit off the victim line to 459 (C12 visClose). The
 * script's frame, not the pack's, is what these words are written in.
 */
export function launchOps(plan, { sprite, homeZ = 0, flight = null, lane = 0, side = "player" } = {}) {
  const yaw = side === "enemy" ? 0 : 2048;
  const out = [];
  for (const p of plan.points) {
    const words = [0, sprite, lane - Math.round(p.x), -Math.round(p.y), Math.round(-homeZ + p.z),
      flight?.[5] ?? 0, yaw, flight?.[7] ?? 0];
    out.push({ op: 6, words, launch: { id: p.id, bone: p.bone, index: p.index } });
  }
  return out;
}
