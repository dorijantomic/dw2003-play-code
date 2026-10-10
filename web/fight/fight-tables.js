// Shared fight tables baked from the overlay disasm (no RAM dependency -> generalizes to 245).
//
// tech -> animation clip: the overlay table @ PS1 0x80042bca (stride 0x12, +0x10 byte = clip
// index), DATA-VERIFIED across 4 RAM dumps via skeletal-lab tools/decode_tech_table.py
// (anim_loop_and_action_vm ledger): a perfect 52/52 partition —
//   basics     (technique id  1..52)  -> clip 5  (physical attack, PLAY-MOTION 56)
//   signatures (technique id 53..104) -> clip 11 (finisher,        PLAY-MOTION 55)
// Anchors: Renamon basic 7 -> 5, Agumon basic 4 -> 5, Diamond Storm 59 -> 11, Pepper Breath 56 -> 11.
// The FULL extracted table (all 443 techs, every field: mp/power/category/elem1/elem2/
// dispatch/effect/motion/clip — tools/extract_fight_tech_table.py from the decomp's static
// Unknown3 data; field map in docs/research/fight-3d/tech-effects-decode.md). Loaded async by
// the host (battle3d) via setTechTable; until then techToClip falls back to the verified
// 52/52 partition rule (which the extracted table reproduces exactly for techs 1..104).
let TECH_TABLE = null;
export function setTechTable(json) { TECH_TABLE = json || null; }
export function techRecord(techId) { return TECH_TABLE?.[String(techId)] ?? null; }

export function techToClip(techId) {
  const rec = techRecord(techId);
  if (rec && rec.clip != null) return rec.clip;
  if (techId >= 1 && techId <= 52) return 5;
  if (techId >= 53 && techId <= 104) return 11;
  return null; // unknown technique -> caller falls back to idle/default
}

// Defender damage-reaction clips — USER VISUAL GROUND TRUTH (Renamon + Agumon, N=2, 2026-06-21,
// authored blind in fight-action-lab and matched byte-for-byte against the scripts):
//   clip 1 = INTERMEDIATE multi-hit reaction selected by op1 mode 5
//   clip 2 = SURVIVES  -> tables [4,5,6,11] (hit -> floor -> get up)
//   clip 3 = KILLED     -> tables [4,5,6,10] (hit -> floor -> dead)
//   clip 4 = EVADE/MISS -> table [2]
// Original setup F0x8008ee84 writes the op1 mode-0 source field to 1/2/3 for
// survive/lethal/miss; F0x8008b69c adds one, selecting clips 2/3/4. The fresh
// mode-5 source slots are zero, so mode 5 selects clip 1 at intermediate hits.
// This SUPERSEDES the old HIT_REACTION_CLIP=10 reading: clip 10 = tables [44,45] is the ITEM-USE
// motion (the user labeled table 44 "item"), NOT the hit reaction — driving the defender with
// clip 10 made it play the item animation when struck.
export const REACTION_MULTI_HIT_CLIP = 1; // op1 mode 5, intermediate combo contact
export const REACTION_HIT_CLIP   = 2;   // defender survives the hit
export const REACTION_DEATH_CLIP = 3;   // the hit is lethal
export const REACTION_EVADE_CLIP = 4;   // decoded accuracy roll missed
