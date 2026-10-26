// A technique the model has no action clip for.
//
// The disc's player species carry all 18 action clips in their model pack. The enemy-only species (made
// player forms by tools/build_extra_species.py) carry only the ones the enemy used: idle, reactions and the
// basic attack (clip 5), and for some one spell (clip 9). A technique they own with another clip (a spell,
// a support move, a combo) would find no script, so the fighter stood still: no motion, no effect, no
// projectile, no contact marker.
//
// A missing clip is built from a DONOR model's clip of the same number, chosen per gap by the A2 donor plan
// (anim-donor-map.js, /home/dorij/scratch-research/anim-donor-plan.md). The one fact that decides how:
//
//   A timeline table is a FRAME PLAYLIST, not bone data (timeline-player.js:10-15). The renderer samples the
//   PLAYING model's own baked channels at those frame numbers (battle3d.js:225-311), so binding another
//   model's table does NOT carry that model's motion. Only pose-identical TWINS (same channels, same
//   total_frames) can borrow tables exactly; for every other model the donor supplies the SCRIPT SHAPE and
//   the model binds its OWN tables.
//
// Three builds, by method:
//
//   borrow-tables    the donor is an exact twin: play its clip unchanged, with its tables copied into this
//                    model's timeline in memory at load (prepareModelDonors - never into git: disc data).
//   own-table-body   the model's own motion is the body. A model with a basic attack plays it (its own
//                    tables, its own waits) for clips 9/10, with the donor's projectile, strike effect and
//                    asset preloads placed at the model's own strike. A model with NO basic attack (clip-5
//                    gap) plays its best authored table as a compact planted attack: bind, wind up, strike,
//                    follow through, return to base. Giants (ANIM_GIANTS) plant their feet: the donor
//                    script's dash/leap arms are dropped before the body is laid out.
//   spell-table-body the model's only authored body is its spell table - played the same compact way.
//
// The Greymon donor (setFallbackDonor) stays as the LAST RESORT for clips the map does not cover (the
// combos 6/8, the signature strike 11, support 13/15/16) and for a model whose map donor is not loaded.
//
// Every built script carries the two things that make a landed blow readable ON THE DEFENDER, exactly as an
// authored basic does:
//   * the contact pairing the op1 dispatch reads — `op10 98` + `op1 5` (defender flinches, clip 1) and
//     `op10 99` + `op1 0` (defender's clip 2 survive / 3 death / 4 evade) — see withReactions();
//   * its strike effects in WORLD space on the victim's home line (m005grey's authored basic:
//     `op3 [0,2,0,-896,5120]`, mirrored for an enemy-authored pack), never the screen-space spark that
//     draws at the arena shot's centre, i.e. over the attacker (see victimAnchor()).
//
// The donor is normally a PLAYER-authored species (its coordinates aim down +z); the map's donors are
// whatever side authored them. When the donor's authored side differs from the target's, its ops are turned
// around here (side-mirror.js) so they aim down the target's side; the animator then turns the whole script
// around if the fighter stands on the near side.

// the projectile sprite most player spells of each element fire (tools: counted over the disc's clip-9 scripts)
const PROJECTILE_BY_ELEMENT = { 1: 220, 2: 221, 3: 205, 4: 210, 5: 218, 6: 210, 7: 206, 8: 217 };

let donorActions = null;
/** The Greymon donor's `actions` (a player species with every clip), or null to turn the last resort off. */
export function setFallbackDonor(actions) {
  donorActions = Array.isArray(actions) ? actions : null;
}
export function fallbackDonorReady() {
  return !!donorActions;
}

// ── the donor plan's model data (A2) ────────────────────────────────────────────
import { ANIM_DONOR_GAPS, donorRow, isGiant } from "./anim-donor-map.js";
import { applyCastBake } from "./anim-retarget.js";
import { launchPointsFor, launchOps, homeLine } from "./launch-plan.js";
import { solveCast, solverEnabledFor } from "./anim-solver.js";
// K22c: a generated DW2 motion on this body (web/fight/dw2-motion.js). OFF by default; every call
// below is a no-op until a scope turns it on, so the build is byte-identical without it.
import { prepareDw2Motion, dw2MotionFor, dw2MotionEnabled } from "./dw2-motion.js";
import { skillRow } from "./fight-tables.js";

const donorAnims = new Map();   // folder -> anim.json | null (a miss is cached too)

/** Prime a donor model synchronously (Node tools/tests read the files; the browser fetches). */
export function registerDonorAnim(folder, anim) {
  if (folder) donorAnims.set(folder, anim || null);
}

/** Where an unregistered donor's anim.json comes from. Default: the same pack path the battle loads. */
export function setDonorLoader(fn) {
  donorLoader = typeof fn === "function" ? fn : null;
}
let donorLoader = (folder) => (typeof fetch === "function" && typeof window !== "undefined")
  ? fetch(`assets/battle/models/${folder}/anim.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  : Promise.resolve(null);

async function ensureDonorAnim(folder) {
  if (donorAnims.has(folder)) return donorAnims.get(folder);
  const anim = await Promise.resolve(donorLoader ? donorLoader(folder) : null).catch(() => null);
  donorAnims.set(folder, anim || null);
  return anim || null;
}

/**
 * Attach the donor clips a model's gaps need (called once per model load, battle3d.js loadSkeletalModel).
 * A twin's playlist is copied into this model's timeline in memory - the channels are byte-identical, so the
 * borrowed table reproduces the twin's motion exactly; nothing is written back to disk. Never throws: a donor
 * that cannot be fetched simply leaves that clip to the Greymon last resort.
 */
export async function prepareModelDonors(model) {
  const folder = model?.folder;
  // K22c: merge this body's generated DW2 motion (a no-op unless a scope turned the swap on; a model
  // with no generated file keeps exactly what it had). BEFORE the gap check: the swap applies to a
  // model that owns every clip, too — that is the whole point of "use DW2 motion wherever a twin exists".
  if (folder && model && dw2MotionEnabled()) {
    try { await prepareDw2Motion(model); } catch { /* a missing file leaves the model untouched */ }
  }
  const gaps = folder ? ANIM_DONOR_GAPS[folder] : null;
  if (!gaps || !model) return model;
  for (const clip of Object.keys(gaps)) {
    if (hasOps(model.actions?.[clip])) continue;
    const row = gaps[clip];
    const anim = await ensureDonorAnim(row.d);
    if (!anim) continue;
    const script = anim.actions?.[clip];
    if (!hasOps(script)) continue;
    if (!model.donorClips) model.donorClips = {};
    model.donorClips[clip] = { script, side: authoredSide(anim) };
    if (row.m === "borrow-tables") {
      for (const t of scriptTableSeq(script)) {
        if (t > 1 && !hasTable(model, t) && hasTable(anim, t)) {
          if (!model.timeline) model.timeline = [];
          model.timeline[t] = anim.timeline[t];
        }
      }
      continue;
    }
    // A10: a RANGED gap (a spell/volley the model has no clip for) takes the donor's CAST body when the
    // automatic gate says the pair's retarget is sound; the body is baked into this model in memory now so
    // resolveClipScript stays synchronous. A pair that fails the gate bakes nothing and the builder keeps
    // the planted own-body cast (buildGapScript). No species is named anywhere in this path.
    // Clip 5 is the BASIC ATTACK: a donor script of it that happens to carry a projectile sprite is still
    // a melee presentation, so it is never replaced by a cast body (K16; the ranged families 9/13 are).
    if (Number(clip) !== 5 && isRangedClip(Number(clip), script)) {
      const bake = applyCastBake(model, anim, Number(clip));
      if (bake) {
        if (!model.castBakes) model.castBakes = {};
        model.castBakes[Number(clip)] = bake;
      }
    }
  }
  return model;
}

// clips that are the basic attack plus the technique's own effect
const PHYSICAL = new Set([6, 8, 11]);
const EFFECT_CURRENT = 9999;       // op3 type: the technique's own effect, resolved by the animator
const STRIKE_TYPE = 99;            // op10 type: the damage strike
const CONTACT_TYPE = 98;           // op10 type: an intermediate combo contact
const SPARK_TYPE = 2;              // op3 type: the plain hit spark an authored basic attack spawns
const VICTIM_LINE = 5120;          // the arena z line authored basics anchor their world-space strike effects on

// ── the disc's authored CONTACT variants per clip (A12) ───────────────────────────────────────────
// Measured over all 249 packs (anim-a9.md section 4, tools/check_tech_targets.mjs `signatures()`):
// every count of op10 contact records — (intermediate 98s) + the final 99 — that ANY authored script of
// that clip carries. This is a property of the CLIP, not of the technique record: a technique whose clip
// the model has no script for must present the clip's own shape. The disc's clip 8 is always a 3-beat
// combo (2x98 + 1x99) whatever the technique row's hit byte says (its own clip-8 rows say hits=2), clip
// 13 is always a 3-shot volley, clip 7 a two-beat pair, clip 15 — the field moves — authors NO contact at
// all, and clips 9/10/11/12/16 author an effect-only variant beside their contact one.
// Where the disc authors several shapes for one clip the technique's hit count picks the narrowest shape
// that covers its hits (never one that hides a hit): clip 5 = {1,2,4} for a 1/2/4-hit basic, clip 11 =
// {0..4} for its multi rows. A hit count above the widest authored shape plays the widest, exactly as
// every authored script of that clip does (a 7-hit row on clip 11 plays its 4-beat shape).
const CLIP_CONTACT_VARIANTS = {
  0: [0], 1: [0], 2: [0], 3: [0], 4: [0],
  5: [1, 2, 4], 6: [1], 7: [2], 8: [3], 9: [0, 1], 10: [0, 1], 11: [0, 1, 2, 3, 4], 12: [0, 1],
  13: [3], 14: [1], 15: [0], 16: [0, 1], 17: [1],
};
/**
 * The number of contacts a built script presents for `clip`: an authored variant of that clip (never a
 * count the disc itself never wrote), picked by the technique's own hit count — the narrowest authored
 * shape that covers the hits, or the widest when the hits exceed every authored shape. 0 for a clip the
 * disc presents with no contact (15).
 */
export function clipContacts(clip, hits = null) {
  const variants = (CLIP_CONTACT_VARIANTS[clip] ?? [1]).filter((n) => n > 0);
  if (!variants.length) return 0;
  const h = hits != null ? hits | 0 : 0;
  if (h <= 0) return variants.includes(1) ? 1 : variants[0];
  return variants.find((n) => n >= h) ?? variants[variants.length - 1];
}

import { authoredSide, mirrorOps } from "./side-mirror.js";

const hasOps = (script) => !!script && Array.isArray(script.ops) && script.ops.length > 0;
const hasTable = (model, t) => !!model?.timeline?.[t]?.table?.length;
const cloneOp = (o) => ({ ...o, words: o.words ? o.words.slice() : [] });
const turnedOps = (ops, turn) => (turn ? mirrorOps(ops) : ops).map(cloneOp);

/**
 * The two WORLD-space anchor points of an action, in the actor's OWN arena frame. The arena is symmetric about
 * the origin, so the point on the opposite fighter's home line and the point on the caster's own are exact
 * mirrors: same |z|, opposite sign. Both are written in the convention the model's own ops use (a
 * player-authored pack aims +z, an enemy-authored one -z — side-mirror.js), so mirrorOps/mirrorHooks turn them
 * with the rest of the script when the fighter stands on the other side, and each keeps landing on the same
 * fighter relative to the caster.
 *
 * Which one a build uses is a property of the TECHNIQUE, not of the model: an enemy-targeted technique anchors
 * its effect on the fighter opposite (victimAnchor), a heal/support/self cast anchors it on the caster
 * (selfAnchor). 5120 is the home line; the A7a harness measures the opposite anchor 1408 units from the
 * defender's slot and >10k from the attacker's.
 *
 * The old compact build spawned the screen-space spark (`op3 [..,32767]`) and installed no camera preset, so
 * the sprite was drawn at the arena shot's centre — over the ATTACKER whatever the technique was aimed at. That
 * is the operator's "the being-hit effect plays on Raijinmon's own body" (BRIEF4 Phase 4c, measured by
 * tools/verify_attack_reaction.mjs).
 */
export function victimAnchor(model) {
  return { x: 0, y: -896, z: authoredSide(model) === "enemy" ? -VICTIM_LINE : VICTIM_LINE };
}
/** The caster's own point: the mirror of victimAnchor, on the fighter that plays the script. */
export function selfAnchor(model) {
  const v = victimAnchor(model);
  return { x: v.x, y: v.y, z: -v.z };
}

/** One op3 spawn of `type` at `anchor` (the victim's point by default, the caster's for a self cast). */
function strikeFx(model, type, anchor = victimAnchor(model)) {
  const a = anchor;
  return { op: 3, words: [0, type, a.x, a.y, a.z] };
}

/**
 * The disc's reaction pairing, which the op1 dispatch reads (fight-coordinator.js:97-107,
 * battle-reaction-dispatch.ts:113-125): EVERY intermediate contact (op10 98) is paired with its own
 * `op1 [5]` — the defender plays its clip 1 flinch for that contact — and the LAST damage strike
 * (op10 99) with `op1 [0]`, which selects the defender's outcome clip: 2 survive / 3 death / 4 evade.
 * A script that fires a contact WITHOUT its op1 leaves the defender standing through the blow: with
 * Raijinmon as our partner the enemy never fell down and died. Pairing only the FIRST of several 98s
 * is the second half of the same defect (A12): a 3-beat combo then flinched once and the defender
 * stood through beats 2 and 3, because the coordinator dispatches one clip-1 per mode-5 request.
 *
 * Authored packs write the op1 either just AFTER its contact (m386dino clip 11: `10[98] 1[5]`) or just
 * BEFORE it (m254pldr: `1[5] … 10[98]`), and the VM runs both in the same tick; every authored op1 is
 * a REQUEST consumed by the one contact in its span. This walks the contacts in order, lets each
 * authored op1 claim the contact in whose span it sits (after first, then before), and inserts the
 * missing ones — one per 98, one [0] for the final 99, and nothing else touched.
 */
function withReactions(ops) {
  const contacts = [];
  ops.forEach((o, i) => {
    if (o.op === 10 && [CONTACT_TYPE, STRIKE_TYPE].includes(o.words?.[0] | 0)) contacts.push(i);
  });
  if (!contacts.length) return ops;
  const last99 = contacts.filter((i) => (ops[i].words?.[0] | 0) === STRIKE_TYPE).pop() ?? -1;
  const used = new Set();
  const want = new Map();   // contact index -> the mode to insert before it
  contacts.forEach((i, k) => {
    const mode = (ops[i].words?.[0] | 0) === CONTACT_TYPE ? 5 : (i === last99 ? 0 : null);
    if (mode == null) return;
    const prev = k > 0 ? contacts[k - 1] : -1;
    const next = k + 1 < contacts.length ? contacts[k + 1] : ops.length;
    // an authored op1 belongs to this contact: first one written after it (up to the next contact),
    // then one written before it (back to the previous one)
    for (const [a, b] of [[i + 1, next], [prev + 1, i]]) {
      for (let j = a; j < b; j++) {
        if (!used.has(j) && ops[j].op === 1 && (ops[j].words?.[0] | 0) === mode) { used.add(j); return; }
      }
    }
    want.set(i, mode);
  });
  if (!want.size) return ops;
  const out = [];
  ops.forEach((o, i) => {
    if (want.has(i)) out.push({ op: 1, words: [want.get(i)] });
    out.push(o);
  });
  return out;
}

/** The timeline tables a script binds, in order (op2 mode 0 with a table above 1). */
export function scriptTableSeq(script) {
  const seq = [];
  for (const o of script?.ops ?? []) {
    if (o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1) seq.push(o.words[2] | 0);
  }
  return seq;
}

/** The frame range a timeline table plays (op11 waits are authored in the same frame units, delta-scaled). */
function tableFrames(model, t) {
  const tab = model?.timeline?.[t]?.table;
  if (!Array.isArray(tab) || !tab.length) return 0;
  let lo = Infinity, hi = -1;
  for (const e of tab) {
    const v = e?.value | 0;
    if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  return hi < 0 ? 0 : Math.max(2, hi - lo + 1);
}

/**
 * How much MOTION a table's frame range holds: the number of distinct frames its entries name
 * (a table is a window into the model's own keyframe sequence — anim.json `timeline[i].table`
 * entries carry the frame, so a one-frame window is a frozen pose whatever its index).
 *
 * A built script's body has to be a table that actually travels: the disc's own attack tables run
 * 20..150 frames. The retired builders took `row.t[0]`/`tables[0]` blindly, and on packs whose first
 * table is a one-frame hold (Kurisarimon's table 2 = 11 frames of near-static pose, Gizamon's table
 * 14 = ONE frame) the built body stood still while its effect played — A11's C7 measured 0.005 of the
 * model's own basic-attack motion. Choosing by motion is a property of the data, not of a species.
 */
function tableMotion(model, t) {
  const tab = model?.timeline?.[t]?.table;
  if (!Array.isArray(tab) || !tab.length) return 0;
  const seen = new Set();
  for (const e of tab) { const v = e?.value | 0; if (v >= 0 && v < 0x8000) seen.add(v); }
  return seen.size;
}

/** The model's base tables: 0 is the idle loop, 1 the return-to-base every authored script binds. */
const isBaseTable = (t) => (t | 0) <= 1;

/** The indices of a model's timeline tables (an array on a loaded pack, a map in a synthetic test). */
function tableIndices(model) {
  const tl = model?.timeline;
  return tl && typeof tl === "object" ? Object.keys(tl).map(Number).filter((n) => Number.isFinite(n)) : [];
}

/** `list` ordered by how much motion the table holds (widest first), tables that cannot move dropped. */
function byMotion(model, list) {
  return (list || [])
    .filter((t) => tableMotion(model, t) >= 2)
    .sort((a, b) => tableMotion(model, b) - tableMotion(model, a));
}

function ownProjectile(model) {
  for (const o of model?.actions?.[9]?.ops ?? []) {
    if (o.op === 6 && o.words?.[0] === 1) return o.words[1] | 0;
  }
  return null;
}

// ── A10: a SPELL is a CAST ─────────────────────────────────────────────────────
// The technique table splits its records by clip: 9 (spell) and 13 (volley) are the ranged families, and
// EVERY authored clip-9/13 script in the 249 packs launches a projectile (op6 mode 0) - a clip that does
// not is melee-like and keeps the attack build. That is the whole rule: no species, no ids.
const RANGED_CLIPS = new Set([9, 13]);
function isRangedClip(clip, script = null) {
  if (RANGED_CLIPS.has(clip)) return true;
  return (script?.ops ?? []).some((o) => o.op === 6 && (o.words?.[0] | 0) === 0);
}
// The actor's own home line in the pack's authored frame: the mirror of victimAnchor(). A player-authored
// pack stands at -z and aims +z (its victim line is +5120); an enemy-authored one the other way round.
const homeZ = (model) => homeLine(model);

/**
 * The projectile launch records, anchored on the model's ANATOMY (K13): the technique's shots rule picks
 * the emitter sites (K14), each site is a bone of this model's own skeleton (K12), and every projectile
 * leaves from that bone's tip at the raised pose of the cast.
 *
 *   * one op6 per projectile: a three-mouthed body fires three fireballs, a two-barrel body two shells,
 *     a single-shot move one from the primary site, and a contact move none at all;
 *   * x / y / z come from the emitter bone's own world position (launch-plan.js), written in the disc's
 *     own form (`-homeZ + bone.z`, e.g. Gallantmon's raw 5248 for a home line of 5120), so the shot
 *     leaves the firing limb instead of a fixed offset beside the body;
 *   * the flight direction words (5..7) stay the donor's, and the sprite is this model's own spell sprite
 *     when its own clip 9 names one.
 * The op-word signs are the disc's: the decoder negates y and z (battle-action-opcodes.ts op6Handler).
 */
function projectileOps(model, donorOps, table, element, launch = {}) {
  const src = (donorOps ?? []).find((o) => o.op === 6 && (o.words?.[0] | 0) === 0 && (o.words?.length ?? 0) >= 8);
  const sprite = ownProjectile(model) ?? PROJECTILE_BY_ELEMENT[element] ?? (src ? (src.words[1] | 0) : null);
  if (sprite == null) return src ? [cloneOp(src)] : [];
  const launchPlan = launchPointsFor(model, { tech: launch.tech ?? null, volley: !!launch.volley, table, tables: launch.tables ?? null, frame: launch.frame ?? null });
  if (!launchPlan.points.length) {
    // The anatomy is the authority for a TECHNIQUE: `none` (a self/support move or an effect with no muzzle)
    // and `per-limb-contact` (a melee combo) launch nothing, and a launching rule whose sites this skeleton
    // cannot place fires nothing rather than a fixed point beside the body - C11 counts launches per rule.
    if (launch.tech) return [];
    // an item / an unnamed clip is not a technique: keep the donor's own record (or one shot from the centre)
    return src ? [cloneOp(src)] : [{ op: 6, words: [0, sprite, 0, 0, 0, 0, 2048, 0] }];
  }
  return launchOps(launchPlan, { sprite, homeZ: homeZ(model), flight: src?.words, side: authoredSide(model) });
}

/**
 * Rebuild a script's launch records from the anatomy plan, in place: every authored op6 sub-0 the body carried
 * (a donor's fixed point beside its body) is replaced by the plan's records at the same beat, and a body that
 * carried none gets them where its strike lands. Used by the borrowed-twin path, whose script is the donor's
 * own and therefore launches from the DONOR's weapon, not this model's emitter bones.
 */
function reprojectLaunch(model, ops, element, launch = {}) {
  const src = ops.find((o) => o.op === 6 && (o.words?.[0] | 0) === 0 && (o.words?.length ?? 0) >= 8);
  const sprite = ownProjectile(model) ?? PROJECTILE_BY_ELEMENT[element] ?? (src ? (src.words[1] | 0) : null);
  const launchPlan = launchPointsFor(model, { tech: launch.tech ?? null, volley: !!launch.volley, tables: launch.tables ?? null });
  const recs = launchPlan.points.length && sprite != null
    ? launchOps(launchPlan, { sprite, homeZ: homeZ(model), flight: src?.words, side: authoredSide(model) })
    : [];
  const out = [];
  let placed = false;
  for (const o of ops) {
    if (o.op === 6 && (o.words?.[0] | 0) === 0) {
      if (!placed) { out.push(...recs); placed = true; }
      continue;
    }
    out.push(o);
  }
  if (!placed && recs.length) {
    const strike = out.findIndex((o) => o.op === 10 && (o.words?.[0] | 0) === STRIKE_TYPE);
    const term = out.findIndex((o) => o.op === 0 || o.op === 255);
    const at = strike >= 0 ? strike : (term >= 0 ? term : out.length);
    out.splice(at, 0, ...recs);
  }
  return out;
}


/**
 * The technique's own contact sequence, from the disc's hit count (basicAttackHitCount in the engine: the
 * dispatch byte picks 1 / the record's hits / 3): hits-1 intermediate contacts (op10 98 + flinch spark +
 * op1 [5]) and one damage strike (op10 99 + spark + the technique's own effect op3 9999 on the victim +
 * op1 [0] for the outcome clip). The effect is placed in WORLD space on the victim line, never as the
 * screen-centre spark (A7b), so it lands on the defender whatever the camera does.
 */
function contactProgram(model, hits) {
  const out = [];
  for (let i = 1; i < Math.max(1, hits | 0); i++) {
    out.push({ op: 10, words: [CONTACT_TYPE, 0] }, strikeFx(model, SPARK_TYPE), { op: 1, words: [5] }, { op: 11, words: [8] });
  }
  out.push({ op: 10, words: [STRIKE_TYPE, 0] }, strikeFx(model, SPARK_TYPE), strikeFx(model, EFFECT_CURRENT), { op: 1, words: [0] });
  return out;
}

/**
 * Replace a script's contact records with the CLIP's own count (clipContacts — the disc's authored shape
 * for that clip, widened by the technique's hit count where the disc authors a wider one; 0 for a clip
 * the disc presents with no contact, e.g. clip 15's field moves). Drop every op10/op1 the body
 * authored, then put the contact program where its damage strike was (measured as a share of the ticks
 * before it), so the body's own timing survives. Used by every build whose body comes from another
 * script (a donor cast, or the model's own basic attack): the count is a property of the CLIP, never of
 * the body it borrows.
 */
function withHits(ops, model, contactCount) {
  const n = Math.max(0, contactCount | 0);
  const strikeIdx = ops.findIndex((o) => o.op === 10 && (o.words?.[0] | 0) === STRIKE_TYPE);
  const cut = ops.filter((o) => o.op !== 10 && o.op !== 1);
  if (!cut.length) return ops;
  // ticks (op11 waits, the authored unit) before each remaining op
  const ticks = [];
  let t = 0;
  for (const o of cut) { if (o.op === 11) t += (o.words?.[0] | 0); ticks.push(t); }
  const total = t || 1;
  // the strike's position in `cut`
  let before = 0, seen = 0;
  for (let i = 0; i < ops.length; i++) {
    if (i === strikeIdx) break;
    if (ops[i].op !== 10 && ops[i].op !== 1) before++;
  }
  const atTick = strikeIdx >= 0 ? (ticks[Math.max(0, before - 1)] ?? total) : total;
  // a body with no damage strike of its own: the contact program goes where its last beat ends — before the
  // terminator, never after it (a contact appended past op255 never runs: the VM ends first)
  if (strikeIdx < 0) {
    const term = cut.findIndex((o) => o.op === 0 || o.op === 255);
    before = term < 0 ? cut.length : term;
  }
  if (n === 0) {
    // No contact at all: the technique's own effect still lands on the victim in WORLD space (clip 15's
    // authored scripts are op4-only, but the move's effect must not vanish), and nobody is asked to react.
    const out = [];
    let placed = false;
    for (let i = 0; i < cut.length; i++) {
      if (i === before && strikeIdx >= 0) { out.push(strikeFx(model, EFFECT_CURRENT)); placed = true; }
      out.push(cut[i]);
    }
    if (!placed) out.push(strikeFx(model, EFFECT_CURRENT));
    return out;
  }
  const out = [];
  const finalOps = contactProgram(model, n).slice(-4);   // 99 strike + spark + effect + reaction
  // Each intermediate beat is `98 + hit spark + op1 [5]` — no wait of its own, because the gap between
  // contacts is computed here. The disc's authored combos spread their contacts over their own motion
  // (clip 8's three beats sit 32..82 frames apart — median 55 over the 53 packs that author it; clip 13's
  // 20), so the defender's flinch (clip 1) gets to play before the next blow lands. A 3-beat combo whose
  // contacts fire 8 frames apart reads as one stutter, not a combo (A12).
  const BEAT_TICKS = 10;                                 // 20 frames: the disc's narrowest authored gap
  const beatOps = () => [{ op: 10, words: [CONTACT_TYPE, 0] }, strikeFx(model, SPARK_TYPE), { op: 1, words: [5] }];
  // enough authored stream before the strike to space the beats there, or the beats must bring their own room
  const room = atTick >= n * BEAT_TICKS;
  const beatAt = (k) => (room ? Math.round(((atTick - BEAT_TICKS) * k) / Math.max(1, n - 1)) : 0);
  let placed = 1;
  let finalPlaced = false;
  for (let i = 0; i < cut.length; i++) {
    if (i === before) {
      while (placed < n) {
        // inside the body's own timing the authored waits carry the spacing; when the strike came first,
        // each beat is given its own room so consecutive contacts are BEAT_TICKS apart
        if (!room) out.push({ op: 11, words: [BEAT_TICKS * 2] });   // op11 counts FRAMES, a tick is 2
        out.push(...beatOps());
        placed++;
      }
      if (!room && n > 1) out.push({ op: 11, words: [BEAT_TICKS * 2] });   // ...and the strike waits its turn too
      out.push(...finalOps);
      finalPlaced = true;
      out.push(cut[i]);
      continue;
    }
    while (room && placed < n && ticks[i] != null && ticks[i] >= beatAt(placed)) {
      out.push(...beatOps());
      placed++;
    }
    out.push(cut[i]);
  }
  if (!finalPlaced) {
    while (placed < n) { out.push(...beatOps()); placed++; }
    out.push(...finalOps);
  }
  return withReactions(out);
}

/** The model's basic attack with the technique's own effect added where its hit spark lands. */
function physicalFromBasic(model, basic, donor, { clip = 5, hits = null, planted = false } = {}) {
  const ops = [{ op: 3, words: [1, EFFECT_CURRENT] }];
  for (const o of stripMovement(basic.ops, planted)) {
    ops.push({ ...o, words: o.words ? o.words.slice() : [] });
    // op3 spawn (word 0 = 0) of the plain hit spark: the technique's effect goes at the same place
    if (o.op === 3 && o.words?.[0] === 0 && (o.words[1] | 0) === 2 && o.words.length >= 5) {
      ops.push({ op: 3, words: [0, EFFECT_CURRENT, ...o.words.slice(2)] });
    }
  }
  // the ops are the model's OWN basic attack, so its camera operands are authored for the model's own side;
  // the contact sequence is the clip's own authored shape (a combo's 3 beats, a signature's 1), never the
  // basic attack's single one
  const final = withHits(ops, model, clipContacts(clip, hits));
  return { ...donor, ops: final, synthesized: true, camAuthored: "own", buildKind: "attack" };
}

/**
 * A giant plants its feet: drop the slot dash (op2 mode 8), the hop/leap arms (op2 mode 5 with a kind) and
 * the absolute leap (mode 3). A mode-5 release that loses its arm becomes a short fixed beat, otherwise it
 * would wait on a motion that was never armed.
 */
function stripMovement(ops, giant) {
  if (!giant) return ops.map(cloneOp);
  const out = [];
  for (const o of ops) {
    if (o.op === 2) {
      const w = o.words || [];
      const mode = w[0] | 0;
      if (mode === 8 || mode === 3) continue;
      if (mode === 5 && (w[2] | 0) !== 0) continue;
      if (mode === 5) { out.push({ op: 11, words: [6] }); continue; }
    }
    out.push(cloneOp(o));
  }
  return out;
}

/** Does an authored script move the slot at all (op2 modes 3 the leap, 5 a ramp arm, 8 the dash)? */
function hasLocomotion(script) {
  return (script?.ops ?? []).some((o) => o.op === 2 && [3, 5, 8].includes(o.words?.[0] | 0));
}

/** The donor's cast, aimed with this model's own spell sprite: its op6 spawn record, or null. */
function donorShot(donorOps, model, element) {
  const o = donorOps.find((x) => x.op === 6 && x.words?.[0] === 0 && x.words.length >= 8);
  if (!o) return null;
  const shot = cloneOp(o);
  const projectile = ownProjectile(model) ?? PROJECTILE_BY_ELEMENT[element] ?? null;
  if (projectile != null) shot.words[1] = projectile;
  return shot;
}

/**
 * The technique's own effect (op3 9999) on the VICTIM, where the strike spark lands. Only the effect TYPE is
 * inherited from the donor: its own record is written for the donor's camera (m440sijn's spell spark is
 * screen-space inside its own victim preset) while a built body keeps the point the model's own strike is at.
 */
function donorStrikeFx(donorOps, model) {
  const o = (donorOps ?? []).find((x) => x.op === 3 && x.words?.[0] === 0 && (x.words[1] | 0) === EFFECT_CURRENT);
  return strikeFx(model, o ? (o.words[1] | 0) : EFFECT_CURRENT);
}

/**
 * Clips 9 (spell) and 10 (item use) for a model that has a basic attack: the model's OWN basic attack is the
 * motion program - its tables, its waits, its timing, the motion a player already sees from it - and the
 * donor contributes the parts the basic does not carry: the spell projectile (aimed with this model's own
 * spell sprite, launched from its weapon), the technique's strike effect, and the donor's asset preloads.
 *
 * A10: when the clip is RANGED (a spell) the body is PLANTED - the dash/jump/leap arms are dropped for every
 * model, not only the giants - and the contact sequence is the technique's own hit count (withHits). A spell
 * that hops into melee is exactly the operator's report; a 3-hit volley that plays one contact is C1.
 */
function spellFromBasic(model, basic, donorScript, { clip = 9, turn, giant, element, hits = 1, ranged = false, launch = {} }) {
  const donorOps = turnedOps(donorScript.ops, turn);
  const ops = [];
  for (const o of donorOps) {
    if ((o.op === 3 && o.words?.[0] === 1) || (o.op === 6 && o.words?.[0] === 1)) ops.push(cloneOp(o));
  }
  // a clip whose authored presentation plants (the field/throw clips 14/15/17 carry no op2 locomotion
  // at all, and a ranged cast never lunges) strips the body's dash/hop; a melee combo keeps it
  const plantBody = giant || ranged || !hasLocomotion(donorScript);
  const body = stripMovement(basic.ops, plantBody);
  const bodyTable = scriptTableSeq({ ops: body })[0] ?? null;
  const bodyHasProj = body.some((o) => o.op === 6 && o.words?.[0] === 0 && o.words.length >= 8);
  const launchTables = scriptTableSeq({ ops: body });
  const proj = bodyHasProj || !ranged ? null : projectileOps(model, donorScript.ops, bodyTable, element, { ...launch, tables: launchTables });
  const fx = donorStrikeFx(donorOps, model);
  const projectile = ownProjectile(model) ?? PROJECTILE_BY_ELEMENT[element] ?? null;
  let placedProj = false;
  for (const o of body) {
    const strike = o.op === 10 && (o.words?.[0] | 0) === STRIKE_TYPE;
    if (strike && proj && !placedProj) { ops.push(...proj); placedProj = true; }
    // a ranged body's OWN projectile fires the spell's sprite from the firing limb as well (C6/C11): the
    // spawn point is the emitter bone, never the body's own fixed offset
    if (o.op === 6 && o.words?.[0] === 0 && o.words.length >= 8 && ranged) {
      if (!placedProj) { ops.push(...projectileOps(model, donorScript.ops, bodyTable, element, { ...launch, tables: launchTables })); placedProj = true; }
      continue;
    }
    if (o.op === 6 && o.words?.[0] === 0 && o.words.length >= 8 && projectile != null) o.words[1] = projectile;
    ops.push(o);
  }
  // a body with no strike record: the projectiles and the effect still have to fire before the end
  if (!placedProj && ranged) ops.push(...projectileOps(model, donorScript.ops, null, element, { ...launch, tables: launchTables }));
  const final = withHits(ops, model, clipContacts(clip, hits));
  if (!final.some((o) => o.op === 3 && (o.words?.[0] | 0) === 0 && (o.words[1] | 0) === EFFECT_CURRENT)) {
    const at = final.findIndex((o) => o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) === 1);
    final.splice(at < 0 ? final.length : at, 0, cloneOp(fx));
  }
  return { ...donorScript, ops: final, synthesized: true, camAuthored: "own", buildKind: ranged ? "cast" : "attack" };
}

/**
 * A10: a RANGED gap built from the donor's own CAST body. The donor's clip-9/13 script IS the presentation
 * the operator wants (Gallantmon raises the lance, fires from it, planted); when the automatic gate
 * (anim-retarget.js castGate) accepted this pair's retarget, the body table was baked onto this model's
 * skeleton at load and this function rewrites the donor's script around it:
 *   * the body table bind points at the baked table; every other op2 the donor authored (idle returns, mode
 *     2/1 releases) is kept so the shot's staging survives;
 *   * movement ops are dropped (the caster stays planted) and the camera stays the donor's;
 *   * the projectile is re-anchored on this model's weapon (projectileOp);
 *   * the contacts are the technique's own (withHits), so a 1-hit spell fires one strike and a volley fires
 *     its count.
 */
function castFromDonor(model, clip, gap, { turn, element, hits, launch = {} }) {
  const bake = model.castBakes?.[Number(clip)];
  const table = bake?.table ?? null;
  const donorOps = turnedOps(gap.script.ops, turn);
  const ops = [];
  let bodyBound = false;
  let shotPlaced = false;
  for (const o of donorOps) {
    const w = o.words || [];
    if (o.op === 2 && (w[0] | 0) === 0 && (w[2] | 0) > 1) {
      if (table == null || bodyBound) continue;          // one body bind; the rest belong to the donor's skeleton
      ops.push({ op: 2, words: [0, 0, table] });
      bodyBound = true;
      continue;
    }
    // the donor's own op6 becomes THIS model's launch plan - every emitter it fires from, once. A donor
    // volley script carries several op6 records; the first one is replaced by the whole plan.
    if (o.op === 6 && (w[0] | 0) === 0) {
      if (!shotPlaced) { ops.push(...projectileOps(model, donorOps, table, element, { ...launch, tables: table != null ? [table] : [] })); shotPlaced = true; }
      continue;
    }
    if ((o.op === 6 || o.op === 3) && (w[0] | 0) === 1) continue;   // preloads: re-emitted once, at the front
    if (o.op === 3 && (w[0] | 0) === 0) continue;         // the donor's own effect placements: ours go at the strike
    ops.push(cloneOp(o));
  }
  if (!bodyBound && table != null) ops.unshift({ op: 2, words: [0, 0, table] });
  // a donor cast that authors NO projectile record (some packs' clip 9/13 are body+effect only) would
  // otherwise lose the shot entirely: the anatomy's plan is the authority for what a technique launches
  // (C11 counts the launches against it), so it is placed at the strike.
  if (!shotPlaced) {
    const recs = projectileOps(model, donorOps, table, element, { ...launch, tables: table != null ? [table] : [] });
    if (recs.length) {
      const at = ops.findIndex((o) => o.op === 10 && (o.words?.[0] | 0) === STRIKE_TYPE);
      const term = ops.findIndex((o) => o.op === 0 || o.op === 255);
      const where = at >= 0 ? at : (term >= 0 ? term : ops.length);
      ops.splice(where, 0, ...recs);
    }
  }
  const preloads = donorOps.filter((o) => (o.op === 3 || o.op === 6) && (o.words?.[0] | 0) === 1);
  if (preloads.length) ops.unshift(...preloads.map(cloneOp));
  const final = withHits(stripMovement(ops, true), model, clipContacts(clip, hits));
  return { ...gap.script, ops: final, synthesized: true, camAuthored: turn ? "donor" : "own", buildKind: "cast",
           retargeted: true, gate: bake?.gate ?? null };
}

/**
 * A model with no basic attack (or a spell-table body): its best authored table IS the attack, played planted.
 * Bind it, wind up, strike, follow through, return to base. Waits are sized to the table's own frame range (an
 * authored attack table runs ~70 frames), so the pose actually travels instead of holding one frame.
 *
 * The contact sequence copies an authored basic with the same hit count: m005grey's clip 5 for one strike
 * (`op10 99` + the world-space spark on the victim + `op1 0`), m440sijn's for four (three intermediate
 * `op10 98` + `op1 5` beats, then the strike). The donor script decides how many intermediate contacts the
 * build has; its camera preset is NOT copied (it frames a normal-sized attacker, and a giant fills the frame
 * with one leg — anim-sheets/m441raiz-c5-near.png), because the effects are placed in world space on the
 * victim and need no cut. Both the spark and the reaction are what make the blow readable on the defender:
 * without the op1 records the enemy took damage and never played its death clip (BRIEF4 Phase 4c).
 */
function bodyFromTable(model, table, donorScript, { turn, element, clip, hits = null, launch = {} }) {
  const frames = tableFrames(model, table);
  // op11 counts FRAMES and the action tick advances 2 of them (op11Wait, engine.js:20520): a wind-up of
  // ~half the table and a follow-through of one full table length play the body once, at an authored pace.
  const windup = Math.min(80, Math.max(12, Math.round(frames * 0.55)));
  const tail = Math.min(100, Math.max(16, Math.round(frames * 0.9)));
  const ranged = isRangedClip(clip, donorScript);
  const dOps = clip !== 5 ? turnedOps(donorScript?.ops ?? [], turn) : null;
  // the clip's own authored contact count (A12), widened by the technique's hit count
  const n = clipContacts(clip, hits);
  // one beat per intermediate contact inside the wind-up, so the body is still travelling as the combo lands
  const beat = Math.max(8, Math.min(30, Math.round(windup / Math.max(1, n))));
  const ops = [{ op: 2, words: [0, 0, table] }, { op: 11, words: [windup] }];
  if (dOps) {
    const shots = ranged ? projectileOps(model, donorScript.ops, table, element, { ...launch, tables: [table] }) : (() => {
      const s = donorShot(dOps, model, element); return s ? [s] : [];
    })();
    ops.push(...shots);  // the spell leaves the firing limb at the strike
  }
  for (let i = 1; i < n; i++) {
    // an intermediate contact: the defender flinches (clip 1) and the spark lands on ITS body
    ops.push({ op: 10, words: [CONTACT_TYPE, 0] }, strikeFx(model, SPARK_TYPE), { op: 1, words: [5] });
    ops.push({ op: 11, words: [beat] });
  }
  if (n > 0) {
    // the damage strike: spark + the technique's own effect on the victim, then the reaction the op1
    // dispatch turns into the defender's clip 2 (survive) / 3 (death) / 4 (evade)
    ops.push({ op: 10, words: [STRIKE_TYPE, 0] }, strikeFx(model, SPARK_TYPE));
    if (dOps) ops.push(donorStrikeFx(dOps, model));
    ops.push({ op: 1, words: [0] });
  } else if (dOps) {
    // a clip the disc presents with no contact (15): the effect still lands on the victim, nobody reacts
    ops.push(donorStrikeFx(dOps, model));
  }
  ops.push({ op: 11, words: [tail] });
  ops.push({ op: 2, words: [0, 0, 1] });
  ops.push({ op: 255, words: [] });
  return { ...(donorScript || {}), ops: withReactions(ops), synthesized: true, camAuthored: "own", buildKind: "body" };
}

// ── SELF/ALLY CASTS (A9) ────────────────────────────────────────────────────────
// A technique whose class is heal/support (fight-tables.js techTargetClass, from the disc's
// skills table: 22 of 426 records) is aimed at the USER or an ally, and an item's default
// clip-10 arm heals/charges its user. Its presentation must therefore be a CALM cast: the
// caster stays planted, no projectile, no strike contact, no defender reaction, and the
// effect lands on the CASTER. The attack builds above are the wrong shape for it — on an
// enemy-only pack the basic-attack body is an axe throw, and the technique's own effect then
// spawned at the victim (the operator's Boltmon report).
//
// What identifies a script that is ALREADY a self cast (so it is played as authored, e.g. a
// player pack's clip 10, the item/victory gesture)? The absence of every defender-facing cue,
// read off the ops: an op1 subordinate request, an op6 projectile launch, a hit-spark op3 type
// 2, or an op5 [.., 0, 1] cut to the victim. Every clean player clip 10 passes; an
// enemy-authored "second attack" written into clip 10 fails on at least one.
const SELF_CAST_CAM = { op: 5, words: [60, 0, 3] };    // op5 preset 3 = the NEAR slot (the user)
const SELF_CAST_CAM_OFF = { op: 5, words: [60, 0, 0] }; // the authored restore pair (battle3d.reactionCamFromActions)

export function scriptIsSelfCast(script) {
  if (!hasOps(script)) return false;
  for (const o of script.ops) {
    const w = o.words || [];
    if (o.op === 1) return false;                                     // asks for a defender reaction
    if (o.op === 6 && (w[0] | 0) === 0) return false;                 // launches a projectile
    if (o.op === 3 && (w[0] | 0) === 0 && (w[1] | 0) === SPARK_TYPE) return false;   // hit spark
    if (o.op === 5 && (w[0] | 0) === 0 && (w[2] | 0) === 1) return false;            // cut to the victim
  }
  return true;
}

/**
 * The model's calmest authored body for a self cast, from ITS OWN timeline:
 *   44 — every pack that carries this table uses it for the item / victory gesture (the disc's
 *        clip 10 binds 44 then 45; battle3d.playPlayerVictory plays 44), so it is the authored
 *        self-directed pose whenever it exists;
 *   the donor row's own body table — played as its EARLY WIND-UP only (the first ~30% of the
 *        table, never the swing), which is what an enemy-only pack has to offer;
 *   table 0 — the idle, for a pack with neither (the pose still breathes).
 * `hold` is null for 44 (play the gesture through) and a frame count for a wind-up.
 */
function calmBodyTable(model, row) {
  const tail = hasTable(model, 45) ? 45 : null;
  if (hasTable(model, 44)) return { table: 44, tail, hold: null };
  // the row's own body table, the calmest of them: play its EARLY WIND-UP only, never the swing.
  // "Calmest" is the table holding the most motion (a one-frame hold breathes nothing at all).
  const own = byMotion(model, row?.t ?? [])[0];
  if (own != null) return { table: own, tail, hold: Math.min(36, Math.max(12, Math.round(tableFrames(model, own) * 0.3))) };
  // no row: the model's own widest non-base table is still a motion range the pose can travel
  const any = byMotion(model, tableIndices(model).filter((i) => !isBaseTable(i)))[0];
  if (any != null) return { table: any, tail, hold: Math.min(36, Math.max(12, Math.round(tableFrames(model, any) * 0.3))) };
  if (hasTable(model, 0)) return { table: 0, tail, hold: 30 };
  return null;
}

/**
 * The self/ally cast script: the disc's clip-10 presentation shape (effect preload, the camera
 * pair on the near slot, the calm body, the effect on the caster, the camera restore) with none
 * of the attack records. op3 9999 is resolved by the animator to the technique's own effect —
 * or, on the item path, to the used item's record effect (actor+0x6c).
 */
function buildSelfScript(model, row) {
  const body = calmBodyTable(model, row);
  if (!body) return null;
  const hold = body.hold == null ? Math.min(120, Math.max(45, Math.round(tableFrames(model, body.table) * 0.85))) : body.hold;
  const ops = [
    { op: 3, words: [1, EFFECT_CURRENT] },         // preload the technique's / item's effect
    SELF_CAST_CAM,
    { op: 11, words: [30] },
    { op: 11, words: [30] },
    { op: 2, words: [0, 0, body.table] },          // bind the calm body
    { op: 11, words: [hold] },
    { op: 3, words: [0, EFFECT_CURRENT, 0, 0, 32767] },   // the effect ON THE CASTER (screen-space, item camera)
    { op: 11, words: [60] },
  ];
  if (body.tail) {
    ops.push({ op: 2, words: [0, 0, body.tail] });
    ops.push({ op: 11, words: [30] });
  }
  ops.push(SELF_CAST_CAM_OFF, { op: 2, words: [0, 0, 1] }, { op: 11, words: [30] }, { op: 11, words: [30] }, { op: 255, words: [] });
  // camAuthored "donor": the camera is written in the PLAYER convention (preset 3 = the near
  // slot = the user) and must not be turned around for an enemy-authored model standing near
  // (battle3d._camHookFor does not mirror a donor-built script's shot).
  return { ops, synthesized: true, camAuthored: "donor", buildKind: "self", selfCast: true };
}

function buildGapScript(model, clip, row, gap, element, target, hits = null, planted = false, tech = null) {
  const targetSide = authoredSide(model);
  const turn = !!gap.side && !!targetSide && gap.side !== targetSide;
  if (target === "self") return buildSelfScript(model, row);   // heal/support/item: never an attack body
  // K13: the technique's own shots rule decides how many projectiles leave and from which emitter bones.
  // A move the disc presents with its volley clip (13) reads as a volley even when its research text was
  // silent (the K14 rule), so the clip index is passed as the volley flag.
  const launch = { tech: tech ?? null, volley: (clip | 0) === 13 };
  return builtPresentation(model, buildEnemyScript(model, clip, row, gap, element, hits, planted, turn, launch));
}

/**
 * The presentation rules every BUILT enemy-targeted script obeys, whatever body it borrowed:
 *
 *  * no camera CUT — the cuts a model's own basic attack or a donor's cast carries are authored for the
 *    model that wrote them and frame the ATTACKER; a preset names a SLOT, so once the script is mirrored
 *    onto the other side the same cut frames the wrong fighter (A11's C8 asks a cut to show the intended
 *    fighter). With no cut the arena shot frames BOTH fighters by construction — exactly what the disc's
 *    own basic attacks author (no op5 in any of the 242 packs that carry clip 5).
 *  * no SCREEN-SPACE spawn — a `z = 32767` spawn is drawn at the shot's centre by construction, which was
 *    the A7b fault ("the being-hit effect plays on Raijinmon's own body"); it is only correct under a cut
 *    this build no longer installs.
 *  * the technique's own effect (op3 9999) lands on the VICTIM in world space (victimAnchor), after the
 *    final strike — the one thing the player must see. C4 in the contract.
 */
function builtPresentation(model, script) {
  if (!script || !Array.isArray(script.ops)) return script;
  const screenZ = (z) => z === 32767 || z === -1 || Math.abs(z | 0) > 20000;
  // our own strike spawns sit exactly on the fighter lines (victimAnchor / selfAnchor, y = -896); a body's
  // wind-up puff sits at an odd offset on its OWN side and has no place in a script whose cut we removed
  const onLine = (o) => Math.abs(o.words?.[4] | 0) === VICTIM_LINE && (o.words?.[3] | 0) === -896;
  const ops = script.ops.filter((o) => o.op !== 5).filter((o) => {
    if (o.op !== 3 || (o.words?.[0] | 0) !== 0) return true;      // preloads/motions stay
    return !screenZ(o.words?.[4]) && onLine(o);
  });
  const hasVictimFx = ops.some((o) => o.op === 3 && (o.words?.[0] | 0) === 0 && (o.words[1] | 0) === EFFECT_CURRENT);
  if (!hasVictimFx) {
    let at = -1;
    ops.forEach((o, i) => { if (o.op === 10 && (o.words?.[0] | 0) === STRIKE_TYPE) at = i; });
    const fx = strikeFx(model, EFFECT_CURRENT);
    if (at < 0) {
      const term = ops.findIndex((o) => o.op === 0 || o.op === 255);
      if (term < 0) ops.push(fx); else ops.splice(term, 0, fx);
    } else ops.splice(at + 1, 0, fx);
  }
  return { ...script, ops, camAuthored: "own" };
}

/**
 * K19 O3 — the SYNTHESIZED cast. The solver (anim-solver.js) has already written its own pose table into
 * `model` (appended keys + a playlist table) and returned the tick layout: it solved the motion from the
 * goal (the emitter aims at the target at release, the wind-up comes from the measured constants, the
 * emitters converge or spread per the shots rule). This builds the SCRIPT around that table with the
 * clip's own contact shape and the technique's own emitter launches, so the rest of the pipeline (effects,
 * reactions, camera) is exactly the A10 build's.
 *
 * Tick arithmetic: a playlist entry is one action tick, and op11 waits count ticks, so the release lands on
 * the tick the plan says and the strike on launch+flight (A16's rule, from the disc's own gap).
 */
function solvedCastScript(model, clip, solved, { turn, element, hits, launch = {} }) {
  const table = solved.table;
  // K19f: the shot leaves from where the SOLVED pose holds the emitter at the release frame, not from
  // whichever frame of the table reaches furthest forward (which for a generated table is its first).
  const frame = solved.offset != null ? solved.offset + solved.release : null;
  const projectiles = projectileOps(model, null, table, element, { ...launch, tables: [table], frame });
  const launchPlan = frame != null
    ? launchPointsFor(model, { tech: launch.tech ?? null, volley: !!launch.volley, tables: [table], frame })
    : null;
  const ops = [
    { op: 2, words: [0, 0, table] },
    { op: 11, words: [Math.max(1, solved.release)] },
    ...projectiles,
    { op: 11, words: [Math.max(1, solved.flight)] },
  ];
  const withC = withHits(ops, model, clipContacts(clip, hits));
  withC.push({ op: 11, words: [Math.max(6, solved.follow)] }, { op: 2, words: [0, 0, 1] }, { op: 255, words: [] });
  return {
    ops: withReactions(builtPresentation(model, { ops: withC }).ops),
    synthesized: true, camAuthored: "own", buildKind: "solved", solved: true,
    solver: {
      table, release: solved.release, flight: solved.flight, cls: solved.cls, mode: solved.mode, report: solved.report,
      launch: (launchPlan?.points ?? solved.launch ?? []).map((p) => ({ id: p.id, bone: p.bone, frame: p.frame, x: p.x, y: p.y, z: p.z })),
    },
  };
}

function buildEnemyScript(model, clip, row, gap, element, hits, planted, turn, launch = {}) {
  // the model's own body tables for this row, the ones that actually MOVE first (tableMotion)
  const body = byMotion(model, (row.t || []).filter((t) => hasTable(model, t)));
  // A12: an ENEMY-targeted technique may never be presented with a SELF-shaped script. The disc writes the
  // item pose into clip 10 and some enemy packs put their second attack there; when the donor's script for
  // that clip asks for no defender reaction, launches nothing and spawns its effect in screen space over the
  // caster (scriptIsSelfCast), playing it as an attack would draw the blow on the attacker. Such a clip is
  // rebuilt from the model's own body instead — the donors' contact effects are re-anchored on the victim.
  const selfShaped = scriptIsSelfCast(gap.script);
  // K19 O3: a SET cast solved from the goal (anim-solver.js) beats a borrowed retarget (O4) and the planted
  // own-body build (O5). Only for the pairs the engine has been enabled for — the K19 slice — so every
  // other model's script is byte-identical. A failed gate falls through to the existing builds untouched.
  // The attempt comes FIRST, before the borrow-tables branch: that branch returns a donor retarget, and a
  // prop-class body whose gap row borrows tables (the only prop gaps the gate accepts, K19f item 9) would
  // never be offered the solved cast — the hook sat below it and O3 never ran for those pairs.
  const rangedGap = isRangedClip(clip, gap.script) || planted;   // a magical technique is a cast (C5/C6)
  if (rangedGap && solverEnabledFor(model, { tech: launch.tech ?? null })) {
    const solved = solveCast(model, { tech: launch.tech ?? null, force: !!launch.forceSolver });
    if (solved?.ok) return solvedCastScript(model, clip, solved, { turn, element, hits, launch });
  }
  if (row.m === "borrow-tables" && !selfShaped) {
    const binds = scriptTableSeq(gap.script).filter((t) => t > 1);
    if (!binds.length || !binds.every((t) => hasTable(model, t))) return null;   // twin tables not merged: last resort
    // a borrowed clip that carries no contact at all while the clip authors one (5 of the 107 authored
    // clip-9 scripts) would present the technique with nobody reacting on the defender: give it the clip's
    // own contact sequence, keeping the borrowed tables and timing
    const turned = turnedOps(gap.script.ops, turn);
    const have = turned.filter((o) => o.op === 10 && [CONTACT_TYPE, STRIKE_TYPE].includes(o.words?.[0] | 0)).length;
    const want = clipContacts(clip, hits);
    const ops = have === want ? turned : withHits(turned, model, want);
    // K13: the donor's shot leaves from the donor's weapon - re-anchor it on THIS model's emitter bones
    const launched = reprojectLaunch(model, ops, element, { ...launch, tables: binds });
    return { ...gap.script, ops: launched, synthesized: true, camAuthored: turn ? "donor" : "own", buildKind: "borrow" };
  }
  if (!body.length && !model.castBakes?.[clip]?.table) return null;
  const giant = isGiant(model.folder);
  const basic = model.actions?.[5];
  const ranged = rangedGap;   // a magical technique is a cast (C5/C6); the O3 attempt above already used it
  // A10: a spell/volley takes the donor's own CAST body when the gate accepted this pair's retarget;
  // otherwise the model's own body, planted, with the clip's contact count and a weapon-anchored shot
  if (ranged && model.castBakes?.[clip]?.table && !selfShaped) return castFromDonor(model, clip, gap, { turn, element, hits, launch });
  if (clip !== 5 && hasOps(basic)) return spellFromBasic(model, basic, gap.script, { clip, turn, giant: giant || planted, element, hits, ranged, launch });
  if (!body.length) return null;
  return bodyFromTable(model, body[0], gap.script, { turn, element, clip, hits, launch });
}

function donorPayload(model, clip, row) {
  const prepared = model.donorClips?.[clip];
  if (prepared) return prepared;
  const anim = donorAnims.get(row.d);
  if (!anim) return null;
  const script = anim.actions?.[clip];
  return hasOps(script) ? { script, side: authoredSide(anim) } : null;
}

/**
 * The action script this model should play for `clip`: its own when it has one, else one built from the
 * donor the A2 plan names, else the Greymon last resort. Returns null when there is nothing to play (the
 * caller then idles, as before).
 *
 * `target` is the technique's / item's class from the disc's own tables (fight-tables.js
 * techTargetClass / itemTargetClass): "enemy" (the default, and every existing caller) keeps the
 * attack builds exactly as they were; "self" is a heal/support cast or an item use and gets the calm
 * self-cast script — its own authored script only when that script carries no defender-facing cue,
 * never an attack body and never the Greymon last resort.
 */
export function resolveClipScript(model, clip, opts = {}) {
  const base = resolveClipScriptBase(model, clip, opts);
  if (!base || !dw2MotionEnabled()) return base;
  return withDw2Body(model, base, clip, opts);
}

/**
 * K22c — take ONLY the body motion from DW2.
 *
 * `base` is exactly the script the build plays today (the model's own authored clip, or the donor
 * build it falls back to). Its ops are kept — the clip's contact sequence, its reactions, its
 * projectile records (already anchored on this model's emitter bones by launch-plan), the camera,
 * the return-to-base and the terminator — and every op2 body bind (mode 0, table > 1) is collapsed
 * onto the ONE baked DW2 table. So the number of hits, what the defender does, where a shot leaves
 * from and how long the shot takes are unchanged; what moves is the body.
 *
 * Timing: an ATTACK/CAST body keeps the base's waits exactly (the disc's strike timing must not
 * move), while a REACTION body (flinch, survive, death, evade, idle, self) gets its tail extended so
 * the whole DW2 motion plays: a reaction has no strike to be late for, and a death that stops
 * three frames in reads as a freeze. Nothing else is touched.
 */
export function withDw2Body(model, base, clip, { tech = null, element = 1 } = {}) {
  // THE USER RULE: DW2 motion only FILLS a slot the DW3 model does not own. A slot with an own action
  // script is authored data and is returned untouched — no DW2 body ever replaces a clip the model
  // already plays (its own attack, death, idle, reactions all stay exactly as the disc wrote them).
  if (hasOps(model?.actions?.[clip])) return base;
  const magical = skillRow(tech)?.attack_category === "magical";
  const dw2 = dw2MotionFor(model, clip, { tech, magical });
  if (!dw2 || !base?.ops?.length) return base;
  // Only a script that PLAYS a body table can take another body. A clip whose own presentation is an
  // op4 motion envelope with no op2 body bind (the item/throw clips 14/15/17 do this on several packs)
  // has no place to put the DW2 motion: binding one in front of an envelope that immediately returns to
  // base would declare a table the actor never gets a frame to play (C7 measures exactly that).
  const hasBodyBind = base.ops.some((o) => o.op === 2 && (o.words?.[0] | 0) === 0 && (o.words?.[2] | 0) > 1);
  if (!hasBodyBind) return base;
  const bodyTable = dw2.table;
  const ops = [];
  let placed = false;
  let sawReturn = false;
  for (const o of base.ops) {
    const w = o.words || [];
    if (o.op === 2 && (w[0] | 0) === 0 && (w[2] | 0) > 1) {
      if (!placed) { ops.push({ op: 2, words: [0, 0, bodyTable] }); placed = true; }
      continue;                                   // every other body bind belonged to the base's skeleton
    }
    if (o.op === 2 && (w[0] | 0) === 0 && (w[2] | 0) === 1) sawReturn = true;
    if (!sawReturn && (o.op === 0 || o.op === 255) && !placed) {
      ops.push({ op: 2, words: [0, 0, bodyTable] });
      placed = true;
    }
    ops.push({ ...o, words: w.slice() });
  }
  if (!placed) ops.unshift({ op: 2, words: [0, 0, bodyTable] });
  const strikeKinds = new Set(["attack", "cast", "signature", "throw"]);
  // STRIKE ON THE POSE (2026-10-26): the base's first shot/strike came on the base's own beat, not when this body reaches its strike
  // pose (Andromon's shot at 19% of the motion, pose at 70%). When the motion file names its strike entry (`hit`, one entry per
  // tick), the op11 waits between the body bind and the first op6 launch / op10 98-99 strike are made to add up to it: a wait is
  // added in front of the strike, or the waits before it are shortened. Every later op keeps its distance to the first strike.
  if (strikeKinds.has(dw2.kind) && Number.isInteger(dw2.hit)) {
    const bind = ops.findIndex((o) => o.op === 2 && (o.words?.[2] | 0) === bodyTable);
    const isStrike = (o) => (o.op === 6 && (o.words?.[0] | 0) === 0) || (o.op === 10 && [98, 99].includes(o.words?.[0] | 0));
    const first = ops.findIndex((o, i) => i > bind && isStrike(o));
    if (bind >= 0 && first > bind) {
      // the strike waits for the BODY: drop the fixed waits and the whole-table waits ([0,s,0], [5,s,0] with no ramp armed)
      // between the bind and the first strike, and put one "until the playhead reaches the strike pose" wait in front of it
      // (action-vm.js op11 untilEntry). A lunge armed in between ([5,s,k]) and its own wait stay. Melee scripts waited for the
      // whole table before the lunge, so the hit came after the motion ended (Frigimon slot 6, 2026-10-26).
      let ramp = false;
      const keep = [];
      for (let i = bind + 1; i < first; i++) {
        const o = ops[i], w0 = o.words?.[0] | 0, w2 = o.words?.[2] | 0;
        if (o.op === 2 && w0 === 5 && w2 !== 0) ramp = true;
        if (o.op === 11) continue;
        if (o.op === 2 && w0 === 0 && w2 === 0) continue;
        if (o.op === 2 && w0 === 5 && w2 === 0 && !ramp) continue;
        keep.push(o);
      }
      ops.splice(bind + 1, first - bind - 1, ...keep, { op: 11, words: [0], untilEntry: dw2.hit });
    }
  }
  if (!strikeKinds.has(dw2.kind)) {
    // play the whole motion before the base returns: count the frames the script waits for after
    // the body bind and add the difference in one wait, just before the return / terminator
    // A done-wait ([0,s,0]) after the bind already holds the script until the table ends: no pad then (it added 393 still
    // ticks after Tyrannomon's victory body, 2026-10-26). The length is the bound table's ENTRIES (the export speeds the playlist up).
    let waited = 0;
    let seen = false;
    let doneWait = false;
    for (const o of ops) {
      if (o.op === 2 && (o.words?.[2] | 0) === bodyTable) { seen = true; continue; }
      if (!seen) continue;
      if (o.op === 11) waited += (o.words?.[0] | 0);
      if (o.op === 2 && (o.words?.[0] | 0) === 0 && (o.words?.[2] | 0) === 0) { doneWait = true; break; }
      if (o.op === 2 && (o.words?.[2] | 0) === 1) break;
    }
    const entries = model?.timeline?.[bodyTable]?.table?.length;
    const frames = Number.isInteger(entries) ? entries : Math.max(0, dw2.hi - dw2.lo + 1);
    const pad = doneWait ? 0 : frames - waited;
    if (pad > 2) {
      const at = ops.findIndex((o) => seen && o.op === 2 && (o.words?.[2] | 0) === 1);
      const term = ops.findIndex((o) => o.op === 0 || o.op === 255);
      const where = at >= 0 ? at : (term >= 0 ? term : ops.length);
      ops.splice(where, 0, { op: 11, words: [pad] });
    }
  }
  // the shot: the base's op6 records were aimed at the BASE body's emitter pose. On the swapped body
  // they are re-projected onto this model's own emitter bones at the new table (K13's plan is the
  // authority for where a technique launches from, and C11 measures the record against the bone tip).
  // Their BEAT is untouched: only the coordinates are re-measured, so launch timing stays today's.
  const hadShot = base.ops.some((o) => o.op === 6 && (o.words?.[0] | 0) === 0);
  let finalOps = ops;
  if (hadShot && tech != null) {
    const reproj = reprojectLaunch(model, ops, element, { tech, volley: (clip | 0) === 13, tables: [bodyTable] });
    // never lose the shot: a plan that places nothing on this body keeps the base's own record
    if (reproj.some((o) => o.op === 6 && (o.words?.[0] | 0) === 0)) finalOps = reproj;
  }
  return { ...base, ops: finalOps, dw2Motion: { letter: dw2.letter, table: bodyTable, kind: dw2.kind, slot: dw2.slot } };
}

function resolveClipScriptBase(model, clip, { element = 1, target = "enemy", hits = null, planted = false, tech = null } = {}) {
  const own = model?.actions?.[clip];
  if (hasOps(own) && (target !== "self" || scriptIsSelfCast(own))) return own;
  if (clip == null || !model) return null;

  const row = donorRow(model.folder, clip);
  if (target === "self") return buildSelfScript(model, row);

  const gap = row ? donorPayload(model, clip, row) : null;
  // K19 O3, second entry point: a spell whose clip the donor map does not cover has no `gap` and is built by
  // the Greymon LAST RESORT further down — a cast solved from the body itself is strictly better than
  // borrowing a donor's shape, so a slice pair is solved here as well. The scope is the gate (off by
  // default), solveCast refuses anything that is not a cast, and every other model resolves as before.
  if (!gap && target === "enemy" && solverEnabledFor(model, { tech })) {
    const solved = solveCast(model, { tech });
    if (solved?.ok) return solvedCastScript(model, clip, solved, { turn: authoredSide(model) === "enemy", element, hits, launch: { tech } });
  }
  if (gap) {
    const built = buildGapScript(model, clip, row, gap, element, "enemy", hits, planted, tech);
    if (built) return built;
  }

  // last resort: the Greymon donor, routed through the SAME builders as any map donor (A10): a gap row that
  // names no donor is still a gap, so it takes the same planted-cast / own-body path with the technique's
  // own hit count instead of a second, differently-behaved build.
  const donor = donorActions?.[clip];
  if (!hasOps(donor)) return null;
  // a MELEE combo/signature keeps the model's own basic attack as its body plus the technique's effect: that
  // build is the right shape for a contact clip, and it is what the census test pins
  if (PHYSICAL.has(clip) && !planted && hasOps(model.actions?.[5])) return builtPresentation(model, physicalFromBasic(model, model.actions[5], donor, { clip, hits, planted }));
  const attackTables = scriptTableSeq(model.actions?.[5]).filter((t) => hasTable(model, t));
  // a model with no basic attack still owns timeline tables: the generic builder plays its widest
  // MOVING table (never the idle/return base tables, and never a one-frame hold — tableMotion)
  const anyTables = byMotion(model, tableIndices(model).filter((i) => !isBaseTable(i)));
  const synthRow = { m: "own-table-body", d: "m005grey", t: attackTables.length ? attackTables : anyTables };
  const synthGap = { script: donor, side: authoredSide(donorActions) || "player" };
  const built = buildGapScript(model, clip, synthRow, synthGap, element, "enemy", hits, planted, tech);
  if (built) return built;
  // a pack with no body table at all (a stub, or a dataless model): play the donor's shape on the idle table
  // so the fighter still has a script to run; a "wait for the bound table" that can never finish (the idle
  // loops) becomes a short fixed beat, exactly as the old last resort did
  const turn = authoredSide(model) === "enemy";
  const ops = (turn ? mirrorOps(donor.ops) : donor.ops).map((o) => ({ ...o, words: (o.words ?? []).slice() }));
  for (const o of ops) {
    if (o.op === 2 && (o.words[0] | 0) === 0 && (o.words[2] | 0) > 1) o.words[2] = 1;
    else if (o.op === 2 && (o.words[0] | 0) === 0 && (o.words[2] | 0) === 0) { o.op = 11; o.words = [20]; }
  }
  return builtPresentation(model, { ...donor, ops, synthesized: true, camAuthored: "donor", buildKind: "lastresort" });
}
