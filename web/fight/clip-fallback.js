// A technique the model has no action clip for.
//
// The disc's player species carry all 18 action clips in their model pack. The enemy-only species (made
// player forms by tools/build_extra_species.py) carry only the ones the enemy used: idle, reactions and the
// basic attack (clip 5), and for some one spell (clip 9). A technique they own with another clip (a spell,
// a support move, a combo) would find no script, so the fighter stood still: no motion, no effect, no
// projectile, no contact marker.
//
// Those clips are not unique to a species. Support (10), field (15) and debuff (16) are the same script in
// every model that has them; spell (9), multi-shot (13) and combo (6, 8) are one pattern per model whose only
// species-bound parts are the timeline tables it binds and the projectile sprite it fires. So a missing clip
// is built from a donor model's clip of the same number (a player species that has it), with
//   - every timeline table the target model lacks replaced by the model's own attack tables, in order
//     (or by "return to base idle", op2 table 1, when it has none), and
//   - the projectile sprite replaced by the model's own spell projectile, else one by element.
// The donor's waits, camera, sounds, contact marker, hit sparks and the technique's own effect (op3 9999,
// which the animator resolves from the technique record) are kept as authored.
//
// Physical clips (6 and 8, the combos, and 11, the signature strike) are built the other way round: the donor's
// combo waits on table 20-36 finishing, and a table that is not the model's own may loop forever, so the model's
// OWN basic attack (clip 5, which always finishes) is the body and the donor's only contribution is the
// technique's effect: preloaded at the start and spawned with the hit spark at the target, as the donor's does.
//
// The donor is player-authored (its coordinates aim down +z), so for an enemy-authored model its coordinates are
// turned around (side-mirror.js); the animator then turns the whole script around if the fighter stands on the near side.
//
// Models that do have the clip are never touched.

// the projectile sprite most player spells of each element fire (tools: counted over the disc's clip-9 scripts)
const PROJECTILE_BY_ELEMENT = { 1: 220, 2: 221, 3: 205, 4: 210, 5: 218, 6: 210, 7: 206, 8: 217 };

let donorActions = null;
/** The donor model's `actions` (a player species with every clip), or null to turn the fallback off. */
export function setFallbackDonor(actions) {
  donorActions = Array.isArray(actions) ? actions : null;
}
export function fallbackDonorReady() {
  return !!donorActions;
}

// clips that are the basic attack plus the technique's own effect
const PHYSICAL = new Set([6, 8, 11]);
const EFFECT_CURRENT = 9999;       // op3 type: the technique's own effect, resolved by the animator

import { authoredSide, mirrorOps } from "./side-mirror.js";

const hasOps = (script) => !!script && Array.isArray(script.ops) && script.ops.length > 0;
const hasTable = (model, t) => !!model?.timeline?.[t]?.table?.length;

/** The timeline tables a script binds, in order (op2 mode 0 with a table above 1). */
export function scriptTableSeq(script) {
  const seq = [];
  for (const o of script?.ops ?? []) {
    if (o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1) seq.push(o.words[2] | 0);
  }
  return seq;
}

function ownProjectile(model) {
  for (const o of model?.actions?.[9]?.ops ?? []) {
    if (o.op === 6 && o.words?.[0] === 1) return o.words[1] | 0;
  }
  return null;
}

/** The model's basic attack with the technique's own effect added where its hit spark lands. */
function physicalFromBasic(basic, donor) {
  const ops = [{ op: 3, words: [1, EFFECT_CURRENT] }];
  for (const o of basic.ops) {
    ops.push({ ...o, words: o.words ? o.words.slice() : [] });
    // op3 spawn (word 0 = 0) of the plain hit spark: the technique's effect goes at the same place
    if (o.op === 3 && o.words?.[0] === 0 && (o.words[1] | 0) === 2 && o.words.length >= 5) {
      ops.push({ op: 3, words: [0, EFFECT_CURRENT, ...o.words.slice(2)] });
    }
  }
  return { ...donor, ops, synthesized: true };
}

/**
 * The action script this model should play for `clip`: its own when it has one, else one built from the donor.
 * Returns null when there is nothing to play (the caller then idles, as before).
 */
export function resolveClipScript(model, clip, { element = 1 } = {}) {
  const own = model?.actions?.[clip];
  if (hasOps(own)) return own;
  const donor = donorActions?.[clip];
  if (clip == null || !hasOps(donor) || !model) return null;
  if (PHYSICAL.has(clip) && hasOps(model.actions?.[5])) return physicalFromBasic(model.actions[5], donor);
  const attackTables = scriptTableSeq(model.actions?.[5]).filter((t) => hasTable(model, t));
  const mapped = new Map();
  const projectile = ownProjectile(model) ?? PROJECTILE_BY_ELEMENT[element] ?? null;
  const turn = authoredSide(model) === "enemy";
  const ops = (turn ? mirrorOps(donor.ops) : donor.ops).map((o) => {
    const words = o.words ? o.words.slice() : [];
    // a model with no attack tables of its own (a larva) has nothing finite to wait on: the donor's
    // "wait for the bound table" becomes a short fixed pause
    if (!attackTables.length && o.op === 2 && words[0] === 0 && (words[2] | 0) === 0) return { op: 11, words: [20] };
    if (o.op === 2 && words[0] === 0 && (words[2] | 0) > 1 && !hasTable(model, words[2] | 0)) {
      const t = words[2] | 0;
      if (!mapped.has(t)) mapped.set(t, attackTables.length ? attackTables[mapped.size % attackTables.length] : 1);
      words[2] = mapped.get(t);
    } else if (o.op === 6 && projectile != null && words.length > 1) {
      words[1] = projectile;
    }
    return { ...o, words };
  });
  return { ...donor, ops, synthesized: true };
}
