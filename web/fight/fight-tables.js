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

// The attack actor's CURRENT-EFFECT field (actor+0x6c) — the word the op3 9999 sentinel
// spawns — as FIGHTSTG_F0x8008ee84 state 1 fills it (fightstg.s .L0x8008f2ec-.L0x8008f320):
//   lbu $v0, 0xe($s0)                 the tech record's +0x0e byte
//   beqz $v0, .L0x8008f308            zero -> the fallback
//   sw $v0, 0x6c($v1)                 nonzero: it IS the effect the attack plays
//   .L0x8008f308: lbu $v1, 0x10($s0)  the record's action clip
//   li $v0, 0x5 / bne ...             clip 5 only (the plain basic)
//   li $v0, 0x2e / sw $v0, 0x6c($v1)  then the field becomes 0x2e (46)
// A zero +0x0e on any other clip leaves the field as the actor was constructed (0), and an
// absent record leaves the browser's field unset (null = op3 9999 skips, the faithful no-op).
export const TECH_BASIC_FALLBACK_EFFECT = 0x2e;
export function techEffectType(rec) {
  if (!rec) return null;
  const effect = rec.effect | 0;
  if (effect !== 0) return effect;
  return (rec.clip | 0) === 5 ? TECH_BASIC_FALLBACK_EFFECT : 0;
}

// Item -> use-effect table: the item machine FIGHTSTG_F0x8008d3b4's default arm (the clip-10
// item-use motion) scans the 6-byte table @fightstg 0x800a336c {item, effect, sound} and writes
// the first matching record's effect to actor+0x6c and its sound to actor+0x70
// (pro/fightstg.s .L0x8008d8fc-.L0x8008d934 scan, apply arm .L0x8008d8c0; 15 records, item
// 43-46/66-76, terminated by -1). op3's 9999 sentinel reads +0x6c (clip 10's own spawn) and
// op10's 98/99 strike reads +0x70 (F0x8009b774 plays op10 sound table[value]).
// Extracted by tools/extract_item_use_effects.py; loaded async by the host (battle3d) via
// setItemUseEffects. Until it loads, itemUseEffect() returns null -> the item action runs with
// no effect write, the faithful behaviour for a context with no matching record.
export const ITEM_USE_CLIP = 10; // the clip the default arm writes to actor+0x54
let ITEM_USE_EFFECTS = null;     // Map item id -> { effect, sound }
export function setItemUseEffects(json) {
  const recs = json?.records;
  ITEM_USE_EFFECTS = Array.isArray(recs)
    ? new Map(recs.map((r) => [r.item | 0, { effect: r.effect | 0, sound: r.sound | 0 }]))
    : null;
}
export function itemUseEffect(itemId) { return ITEM_USE_EFFECTS?.get(itemId | 0) ?? null; }

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

// The item machine's THROW band (FIGHTSTG_F0x8008d3b4 state 0): its dispatch reads the used
// item id from ctx+0x70 and sends ids 77..90 through the 14-word jump table at 0x80082ee4
// (pro/fightstg.s .L0x8008d408-.L0x8008d430, table at :131-144) — eight TYPED arms. Every
// other id reaches the default arm (clip 10 + the 0x800a336c table; see itemUseEffect).
// Each typed arm writes the fresh action actor's clip +0x54, motion +0x68, effect +0x6c and
// sound +0x70: ids 77-84 -> clip 15 (motion 34,37,..,52 = the element pack for the item's
// field; 84 rolls rand_u16()%7), 85 and 90 -> clip 14, 86-89 -> clip 17. The clip is what the
// acting Digimon plays; the motion is read by the clip's op4 0x38 sentinel, the effect by
// op3's 9999 sentinel, the sound by op10's 99 strike. Item 88 (CursedPuppet) picks its
// effect/sound from the STR/DEF branch its own producer sets (ctx+0x7c). Extracted by
// tools/extract_throw_item_effects.py; loaded async by the host (battle3d) via
// setThrowItemEffects. Until it loads, throwItemEffect() returns null -> the caller keeps the
// default-arm clip-10 entry, the faithful behaviour for a context with no table.
export const THROW_ITEM_BAND = [77, 90];   // the jump table's id range (id - 77 = table index)
let THROW_ITEM_EFFECTS = null;             // Map item id -> { clip, motion, effect, sound, ... }
export function setThrowItemEffects(json) {
  const recs = json?.records;
  THROW_ITEM_EFFECTS = Array.isArray(recs)
    ? new Map(recs.map((r) => [r.item | 0, r]))
    : null;
}
export function throwItemEffect(itemId) { return THROW_ITEM_EFFECTS?.get(itemId | 0) ?? null; }
export function isThrowItem(itemId) {
  const id = itemId | 0;
  return id >= THROW_ITEM_BAND[0] && id <= THROW_ITEM_BAND[1];
}

// ── WHO A TECHNIQUE IS AIMED AT (A9) ────────────────────────────────────────────
// The disc's own skill table says what a technique does: digimon.json "skills".type is
// "attack", "heal" or "support" for every one of its 426 records, and it agrees with the
// technique record's category byte on every row (type heal/support ⇔ category 4/5; the 404
// attack records are category 2/3). The 22 heal/support records are the SELF/ALLY casts:
// 184..210 and 400 (clip 10) plus 100 (clip 11). Every other record — including the three
// "attack" records that happen to share clip 10 with the item path (211, 392, 400 aside) —
// is aimed at the OPPONENT. Nothing here is per-species: the class is a column of the
// skills table, and the builder/checker both read it from there.
//
// The item machine's DEFAULT arm (every item id but the throw band) plays clip 10 with the
// used item's record effect written to actor+0x6c (fightstg.s .L0x8008d8c0): an item heals,
// cures or charges its USER, so the default arm is a SELF presentation. The throw band
// 77..90 is a typed attack arm (clips 14/15/17, motion/effect of the thrown item) and stays
// aimed at the opponent.
let SKILL_TYPES = null;                    // Map skill id -> "attack" | "heal" | "support"
let SKILL_ROWS = null;                     // Map skill id -> the whole skills row (hits, name, clip)
export function setSkillTable(json) {
  const rows = Array.isArray(json) ? json : (json?.skills ?? null);
  SKILL_TYPES = Array.isArray(rows)
    ? new Map(rows.map((s) => [s.id | 0, String(s.type || "attack")]))
    : null;
  SKILL_ROWS = Array.isArray(rows) ? new Map(rows.map((s) => [s.id | 0, s])) : null;
}
export function skillType(techId) { return SKILL_TYPES?.get(techId | 0) ?? null; }
/** The technique's own skills row (digimon.json "skills"), or null before the table loads. */
export function skillRow(techId) { return SKILL_ROWS?.get(techId | 0) ?? null; }
/**
 * The technique's in-game NAME ("Triple Fire"), which is the key the anatomy's per-technique tables use
 * (shots rules, firing limb). K13: a built script needs the name to know how many projectiles leave and
 * from which emitter, so the animator passes it down from the same skills row it already reads for hits.
 */
export function techName(techId) { return skillRow(techId)?.name ?? null; }
/** "self" when the technique is a heal/support cast (or an unknown record is absent -> "enemy"). */
export function techTargetClass(techId) {
  const t = skillType(techId);
  return (t === "heal" || t === "support") ? "self" : "enemy";
}
/** The item machine's target: the default clip-10 arm is self-use, the throw band is an attack. */
export function itemTargetClass(itemId) { return isThrowItem(itemId) ? "enemy" : "self"; }
