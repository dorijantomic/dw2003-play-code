import {
  JOKE_GAG_KIND,
  jokeFlavorMessageId,
  DNA_PROFILE_ROWS,
  DNA_COMBATANT_STRIDE,
  DAMAGE_TERM_NO_EFFECT_WORD,
  ailmentMarkerCel as engineAilmentMarkerCel,
  ailmentInflictMessageId as engineAilmentInflictMessageId,
  ailmentInflictWord as engineAilmentInflictWord,
  AILMENT_MARKER_Y,
} from "../vendor/engine.js";

import type { DigimonRecord } from "../types/battle.js";

/** assets/data/jogress_scripts.json: the ten DNA actions' decoded director scripts */
interface JogressScripts {
  actions?: Record<string, { fusedModel: number; partnerModels: number[]; clip: number; }>;
}
// ---------------------------------------------------------------------------
// The battle message line's own words.
//
// The panel is pro/fightstg's FIGHTSTG_F0x80099588: a 22-arm jump table
// (`.L0x8008318c`) that gives each of the two text lines an index into text
// family 0x7f (esmfight) and fills the numbered slots, and the shared tail
// FIGHTSTG_F0x80098d14 that puts the acting Digimon's name into slot 1 of the
// first line. Almost every arm reads as "<the name>" on line one and "<what
// happened>" on line two, so the walker's own sentences give way to the game's.
//
// Every index below is read out of that overlay's own call sites; the kind is
// the `li $a1` in front of the `jalr` through the object's +0xac, and the index
// is the first payload word the site writes. `.bunny-scratch/battlewords-report.md`
// has the full table with every citation.
export const MSG = Object.freeze({
  AMBUSH: 0x07,          // kind 1, wfightmn.s .L0x000012f8
  ATTACK: 0x08,          // kind 2, fightstg.s .L0x80090fe8
  EVADE: 0x1d,           // kind 2, fightstg.s .L0x8008ed70 / .L0x800911b0 / .L0x8009149c
  GO_FOR_IT: 0x39,       // kind 2, wfightmn.s .L0x00001ce0
  NO_MP: 0x8d,           // kind 2, fightstg.s .L0x800889c0 / .L0x8008ccb8
  SWITCH_FAILED: 0x8e,   // kind 2, fightstg.s .L0x80088aa8
  TRYING_TO_FLEE: 0x5e,  // kind 2, fightstg.s .L0x80088a20
  DID_NOT_FLEE: 0x60,    // kind 2, fightstg.s .L0x80088734
  FLEEING: 0x5f,         // kind 2, fightstg.s .L0x80088644
  RUN: 0x41,             // kind 2, wfightmn.s .L0x000018a8 (the Run command's own page)
  RUN_AWAY: 0x43,        // kind 2, wfightmn.s:2222 (the runAway arm, actor 0)
  DEFEATED: 0x51,        // kind 2, wfightmn.s:3265 -- "Defeated!", the fallen enemy's page
  BLASTED: 0x61,         // kind 2, wfightmn.s:2977 (and kind 1 at fightstg.s:14077)
  BACK_TO_NORMAL: 0x62,  // kind 2, wfightmn.s .L0x0000316c
  DIGIDEVOLVED: 0x47,    // kind 2, menu.c:1192 WFIGHTMN_digidevolve: "Digidevolved!" after tech 0x187 (391)
  DNA_DV: 0x3a,          // kind 2, fightstg.s .L0x8008f810
  FROZEN_BLOCK: 0x56,     // kind 2, wfightmn.s .L0x000017a4 (command-menu step 1)
});

/** The VM arms this file asks for, named after what the player reads. */
export const MSG_KIND = Object.freeze({
  /** Line 1 is the name, line 2 the caller's outcome index. */
  OUTCOME: 2,
  /** Line 1 is the caller's index, line 2 stays blank: "Ambush!". */
  ONE_LINE: 1,
  /** Line 1 the name, line 2 "<technique>!" out of the technique-name bank. */
  TECHNIQUE: 3,
  /** Line 1 the name, line 2 "<n> damage!". */
  DAMAGE: 4,
  /** Line 1 the name, line 2 "<item>!" out of the item-name bank. */
  ITEM: 14,
  /** "Next Digimon out!" / "<name>!". */
  NEXT_OUT: 13,
  /** Line 1 the name, line 2 "Digivolved! <name>!". */
  DIGIVOLVED: 12,
  /**
   * Line 1 the name, line 2 a joke gag's phrase. FIGHTSTG_F0x8009a734 builds this picture
   * by hand for the confused-Digimon gag (fightstg.s:24505-24595): esmfight 0x16 — the
   * bare `{1}` the shared tail fills with the acting Digimon's name — on the element at
   * native (20,194), and the phrase off the table at 0x800a35e4 on the element at (20,208).
   * That is exactly arm 7's shape (`.L0x80099908`, fightstg.s:23587-23611), so the gag
   * reuses the shared message line instead of a second widget. **The original never prints
   * "<name> is confused!" here**: "Confused!" (esmfight 32) is what the game says when the
   * ailment is applied, a different message.
   */
  JOKE_GAG: JOKE_GAG_KIND,
});

/**
 * The battle line a confused Digimon's joke gag shows.
 *
 * F0x8009a734's two lines, expressed as the shared VM arm that has the same shape: the
 * acting Digimon's name on the first and `jokeFlavorMessageId(jokeIndex, bit)` — the phrase
 * F0x8009a734 reads off its own table at 0x800a35e4 — on the second.
 */
export function jokeGagMessageSpec(playerName: string, jokeIndex: number, bit: number) {
  return {
    kind: MSG_KIND.JOKE_GAG,
    payload: [jokeFlavorMessageId(jokeIndex | 0, bit | 0)],
    name: playerName,
  };
}

// Battle states
export const ST = {
  NONE:         0,
  INTRO:        1,   // brief "Ambush!" display
  PLAYER_MENU:  2,   // player picks action
  PLAYER_TECH:  3,   // player picks tech
  PLAYER_ITEM:  4,   // player picks item
  PLAYER_ACT:   5,   // player action animating
  ENEMY_ACT:    6,   // enemy action animating
  RESULT_MSG:   7,   // damage/status message
  WIN:          8,
  LOSE:         9,
  FLEE_FAIL:    10,
  PLAYER_TAG:   11,
  PLAYER_DV:    13,
  TAG_PRESENT:  14,
  PLAYER_DNA_CHOICE: 15,
  DNA_PRESENT: 16,
};

export const DNA_PARENT_CLIP = 12;

export const DNA_RESULT_TABLE = 30;

// The item-use action clip (10) now lives with the item-use table in web/fight/fight-tables.js
// (ITEM_USE_CLIP) — the original's item machine FIGHTSTG_F0x8008d3b4 allocates a fresh action
// actor and writes its clip slot +0x54 = 10, so an item runs the SAME action-VM script an
// attack does (tables 44/45 in every pack; user visual ground truth). The renderer's
// playPlayerItemUse plays it with the used item's effect/sound from the 0x800a336c table.

// The three HUD facts the close-up face box's object rule reads each frame. All three are
// states of the battle HUD rather than of one screen: the box is one of the HUD's own
// objects (engine/dw3/ui/native/battle-face-box.ts), built by the same arm that builds the
// command window and freed by the actor's tear-down arm.
/** States in which the battle HUD — and with it the close-up box — exists. The original
 *  frees the box when the HUD goes away (fightstg.s:16094-16098 sends every child of the
 *  command-flow actor to state 3), so a finished battle takes the box with it. */
const FACE_BOX_HUD_STATES = new Set([
  ST.INTRO, ST.PLAYER_MENU, ST.PLAYER_TECH, ST.PLAYER_ITEM, ST.PLAYER_ACT, ST.ENEMY_ACT,
  ST.RESULT_MSG, ST.FLEE_FAIL, ST.PLAYER_TAG, ST.PLAYER_DV,
  ST.TAG_PRESENT, ST.PLAYER_DNA_CHOICE, ST.DNA_PRESENT,
]);

/** States in which this side's command window is up. The original builds the box in the very
 *  arm that builds that window (fightstg.s:16141-16153), so "up" tracks the window and not
 *  one particular row list: the technique / item / partner / form / DNA lists are that same
 *  window with other rows in it. */
const FACE_BOX_MENU_STATES = new Set([
  ST.PLAYER_MENU, ST.PLAYER_TECH, ST.PLAYER_ITEM, ST.PLAYER_TAG,
  ST.PLAYER_DV, ST.PLAYER_DNA_CHOICE,
]);

/**
 * The HUD facts the face box's object rule reads this frame. `lineUp` is the caller's own
 * "a battle line is showing" predicate — the battle loop passes msgHoldsTurn, so the box and
 * the turn are held by the same fact.
 */
export function faceBoxHudEvents(b: { state: number; }, lineUp: boolean) {
  return {
    hudUp: FACE_BOX_HUD_STATES.has(b.state),
    menuUp: FACE_BOX_MENU_STATES.has(b.state),
    lineUp: !!lineUp,
  };
}

const PROFILE_NAME_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  BKWarGreymon: "BK WarGreymon",
  ImperialdramonFM: "Imperialdramon-F",
  ImperialdramonPM: "Imperialdramon-P",
});

export function canonicalProfileName(name: string | number) { return PROFILE_NAME_ALIASES[name] ?? name; }

// ── The DNA fusion's form, from the disc's own Jogress director scripts ──
// Module-level and pure so tests/lane-b/jogress-scripts.test.js can run it over
// all ten actions without a canvas; dnaChoiceFor below is its only caller in the
// game. Everything it reads is disc data:
//
//   * `scripts`   — assets/data/jogress_scripts.json, decoded by
//                   tools/extract_jogress_scripts.py out of each fighter's own
//                   0x48-magic action bin (the profile table and the technique
//                   records come out of the resident EXE image).
//   * `profiles` — the 55 profile rows the DNA pane already loads (the one shared
//                   cut, assets/data/digimon_profiles.bin). Row r's first halfword is
//                   that row's MODEL number, which is what the script's spawn names, so
//                   the roster row that carries the fused model is found by reading the
//                   same table the pairing rule uses.
//
// FIGHTSTG_F0x8008f714 (fightstg.s:12957-12992, 0x8008f7cc-0x8008f7f4): the
// technique record's clip byte at +0x10 is 12 for all ten DNA actions, and 12 is
// presentation command 0x3A. That 12 is a SCRIPT INDEX into the acting fighter's
// own action bin, not a species — and each clip-12 script spawns the partner's
// model and then the fused form's model as slot actors (`op2` sub-op 6,
// `.L0x8008bac0`, `[+0x184](manager, slot, model, 0)`). The anchor is action 374:
// Stingmon's copy decodes op-for-op onto the 94 operations captured from RAM
// (docs/research/battle/captures/dna-2026-07-14/clip12-full-script.md).
export function dnaFusedForm(scripts: JogressScripts | null | undefined, profiles: ArrayLike<number> | null | undefined, actionId: number, digimon: { [k: string]: DigimonRecord; }) {
  const row = scripts?.actions?.[String(actionId)];
  if (!row) return null;
  let profile = null;
  for (let i = 0; i < DNA_PROFILE_ROWS; i++) {
    const at = DNA_COMBATANT_STRIDE * i;
    if (at + 2 > (profiles?.length ?? 0)) break;
    if (((profiles[at] | (profiles[at + 1] << 8)) & 0xffff) !== row.fusedModel) continue;
    profile = digimon?.[i + 1] ?? null;
    break;
  }
  return {
    actionId,
    fusedModel: row.fusedModel,
    partnerModels: row.partnerModels,
    clip: row.clip,
    profile,
    fusedName: profile?.name ?? null,
  };
}

/**
 * The sentence `peek()` still reads for a category-5 technique.
 *
 * It is never what the original's box draws — `plan.page` is, from the record machine's
 * own arms — and it states no number the game never shows. What the arm changed is on
 * `plan` for the tests to read.
 */
export function scriptedWalkerSentence(plan, skill: { name?: string | number } | null | undefined, who: string) {
  const name = skill?.name ? `${who} uses ${skill.name}!` : `${who} acts!`;
  const statName = ["attack", "defense", "speed"][
    (plan?.stats?.[0]?.stat ?? 0) | 0] ?? "stat";
  switch (plan?.effect) {
    case "statOne":
    case "statParty": {
      const howMany = plan.refused ? 0 : (plan.stats?.length ?? 0);
      if (plan.refused) return `${name} No effect!`;
      if (!howMany) return `${name} No effect!`;
      return plan.effect === "statParty"
        ? `${name} The whole party's ${statName} went up!`
        : `${name} Its ${statName} changed!`;
    }
    case "affinity":
      return chargeWalkerSentence(plan, skill, who);
    case "lockFlee":
      return `${name} ${plan.rollLanded ? "Running away is blocked!" : "No effect!"}`;
    case "lockDigivolve":
      return `${name} ${plan.rollLanded ? "Digivolving is blocked!" : "No effect!"}`;
    case "statusOnly":
      return plan.rollLanded ? `${name} ...` : `${name} No effect!`;
    case "mpDrain": {
      const moved = plan.mpMoved | 0;
      return moved > 0 ? `${name} ${moved} MP absorbed!` : `${name} No effect!`;
    }
    case "healCharge":
      return `${name} ${plan.changed?.heal | 0} HP restored!`;
    default:
      return `${name} No effect!`;
  }
}

/**
 * The charge arms' half of the sentence above, kept as its own function because it is the
 * 2026-10-04 reading: it states no number the game never shows, and the byte and the
 * multiplier it buys are on the plan for the tests to read.
 */
export function chargeWalkerSentence(charge: { charged?: boolean } | null | undefined, skill: { name?: string | number } | null | undefined, who: string) {
  const name = skill?.name ? `${who} uses ${skill.name}!` : `${who} acts!`;
  if (!charge?.charged) return `${name} No effect!`;
  return `${name} The next attack hits harder!`;
}

/**
 * The sentence `peek()` still reads for a category-4 technique.
 *
 * It is NEVER what the original's own panel draws — `restore.page` is — and it exists so
 * the legacy flag has something honest to say. It FOLLOWS THE PAGE: when the original's
 * arm answers "No effect!" the walker says so too, because that is what a player of the
 * disc reads. The only two passes that answer it are the heal arms with NOTHING missing
 * (pro/fightstg.s:13576 `beqz $a2, .L0x800900d4` and :13547 `beqz $a2, .L0x800900d4`),
 * where `$s0` keeps the -1 its own delay slot loaded at :13519 and the shared tail asks
 * kind 2 with `esmfight[0x2f]` (:13654 / :13658). A heal too big for the wound does NOT
 * read that way: `li $s0, 0x8` (:13579) and `li $s0, 0x9` (:13553) are branch DELAY slots,
 * which run whether or not the branch is taken.
 */
export function restoreWalkerSentence(plan: { heal?: number[]; cure?: number[]; regen?: boolean; page?: { payload?: readonly number[] } | null | undefined; }, skill: { name?: string | number } | null | undefined, who: string) {
  const name = skill?.name ? `${who} uses ${skill.name}!` : `${who} acts!`;
  const parts: string[] = [];
  const noEffect = (plan?.page?.payload?.[0] | 0) === DAMAGE_TERM_NO_EFFECT_WORD;
  if (!noEffect) {
    const healed = (plan.heal || []).reduce((a: number, v: number) => a + (v | 0), 0);
    if (healed > 0) parts.push(`${healed} HP restored`);
    const cured = (plan.cure || []).reduce((a: number, v: number) => a + ((v & 0x07) ? 1 : 0), 0);
    if (cured > 0) parts.push(cured > 1 ? "ailments cured" : "ailment cured");
    if (plan.regen) parts.push("HP will recover gradually");
  }
  return parts.length ? `${name} ${parts.join(", ")}.` : `${name} No effect!`;
}

/**
 * The `[PSN]/[FRZ]/[CNF]/[SLP]` HUD tag this file used to build is gone.
 *
 * It stood in for the original's ailment overlay, and the decode
 * (engine/dw3/battle-ailment-display.ts) shows a 3D battle has no such overlay:
 * fightstg loads only PGFGTC00 and CMFONT, and the single draw that reads a
 * combatant's ailment byte is the plate's party marker — one cel for all four
 * ailments, at the member's own fixed slot. `ailmentMarkerCel` below is that
 * picture; the ailment's name comes from the shared battle message box.
 */
export const ailmentMarker = engineAilmentMarkerCel;

export const ailmentMessageId = engineAilmentInflictMessageId;

export const ailmentWord = engineAilmentInflictWord;

export const AILMENT_MARKER_ROW_Y = AILMENT_MARKER_Y;
