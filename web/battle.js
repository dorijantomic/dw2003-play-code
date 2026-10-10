// battle.js — Turn-based battle engine for DW2003 Walkabout.
//
// Architecture:
//   createBattle(canvas, ctx, getState) → { start, isActive, update, draw, handleKey }
//
// Trigger:
//   battle.start({ enemyId, enemyLevel, onWin, onFlee, onLose })
// screenId, when given, is the battle id: it keys progression.battle_rewards, the only
// source of a won battle's EXP and BIT. Without one the battle pays 0 EXP / 0 BIT and
// battleRewardFor warns — every shipped route (startRandom / startParty / startScreen)
// passes it.
//
// Player side: driven by state.partnerStats + digimon.json profile for the chosen partner.
// Enemy  side: digimon.json profile scaled to enemyLevel.
//
// Damage formula: decoded from disasm — see web/battle-formulas.js + docs/research/
//   battle-formula-leaves.md. Physical begins with STR·power/DEF; player-side magical
//   damage uses its verified SPT-ratio base, elemental curve and target-family bonus,
//   then proceeds through crit (+50..148%), equipment armor and the caps.
//   Accuracy = rand%128 < base_acc·(1 + SPD_diff/128); a miss renders as "evaded".
//
// Turn order: SPD comparison — higher SPD acts first within a round.
// Flee chance (decoded wfightmn 0x1320): rand%128 < 8·SPD_self/SPD_enemy.
//
// HP for non-starter Digimon (id 9-55): game stores hp=1, growth=1 (level-derived).
//   We use: hp = 80 + str * level  (approximation; real formula in Unknown4 init code)

import { asButton } from "./input.js";
import { createBattle3D, resolveModelFolder } from "./battle3d.js";
import { createBattleCommandNative } from "./battlecmd-native.js";
import { createBattleCommandTranslated, battleAilmentByte } from "./battlecmd-translated.js";
import { createBattleTechTranslated } from "./battletech-translated.js";
import { createBattleItemTranslated } from "./battleitem-translated.js";
import { createBattleTagTranslated } from "./battletag-translated.js";
import { createBattleFormTranslated } from "./battleform-translated.js";
import { createBattleDnaTranslated } from "./battledna-translated.js";
import {
  battleHudBarColors, battleHudDvFrame, battleHudDvPaint, battleHudEnemyRecords,
  battleHudPartyPips, battleHudPlateLabels, battleHudPlayerRecords, translatedBattleHudEnabled,
} from "./battlehud-translated.js";
import { battleMsgBank, battleMsgBankSync, battleMsgPaint, battleMsgText, translatedBattleMsgEnabled } from "./battlemsg-translated.js";
import { createWfightNative } from "./wfightmn-native.js";
import { createWfightTranslated } from "./wfight-translated.js";
import { drawEffects } from "./fight/effect-player.js";
import { drawBlastCurtain, drawBlastFlash, digivolveDemoOn } from "./blast-presentation.js";
import { assignAssetImage } from "./assets.js";
import {
  physicalBase, magicalBase, resolveDamage, rollHit, rollMagicHit, fleeChance, drainHeal, RAND_U16,
  hitGaugeGain, levelTier, blastTargetId, counterCrestProc, enemyFleeProc,
  blastPresentationState, BLAST_FIRST_FRAME,
  FormChangeProgram, formChangeState, formChangeSoundFrame, evolEffectsDue,
  statusRoll, counterDamage,
  enemyMoveCondition,
  elementId,
  enemyActionSkillId,
  basicAttackHitCount, techniqueMpCost,
  multiHitReset, DAMAGE_TERM_REPEAT_WORD,
  pickEncounter, specialBattleMode, specialModeDamage, specialModeLowHpEscape, useBattleItem, isBattleEffectItem, itemUsableInBattle, battleFormIds, tagCandidateIndices,
  chargeHealPage, chargeNoEffectPage, itemAnnouncementPage,
  storeAddItem, storeRemoveItem, heldCount, listItemIds,
  zoneAt, zoneRateLevel, stageZoneBlocks, scriptedScreenId,
  activeKoResolution,
  canPayDnaCost, dnaRejection,
  dnaActionRecord, dnaPairing,
  dnaAnswerAction, dnaAnswerForm, dnaTagBranchKind,
  firstUnlockedTreeRecord, unlockedTreeRecords,
  DNA_COMBATANT_STRIDE, DNA_PRICE_STRIDE, DNA_PRICES, DNA_PROFILE_ROWS, DNA_SPECIES_TABLE,
  walkerProfileRow,
  partyPositionRosterSlot,
  shuffleJokeMenu, jokeFlavorPick, jokeFlavorMessageId,
  JOKE_GAG_KIND, JOKE_GAG_NAME_ID, confusionGagRoll,
  foldElemBonuses as engineFoldElemBonuses, effStats as engineEffStats,
  commitManualDigivolve as engineCommitManualDigivolve,
  resolveAttack as engineResolveAttack,
  resolveMultiHit as engineResolveMultiHit,
  weaponSecondaryProc as engineWeaponSecondaryProc,
  addStatPenalty, statPenaltyOf,
  battleMessagePage,
  category4RestorePlan,
  damageTermCategory4Arm,
  DAMAGE_TERM_NO_EFFECT_WORD,
  damageTermHealAmount,
  damageTermPage,
  damageTermAffinityArm,
  damageTermAffinityByte,
  damageTermAffinityMultiplier,
  category5Plan,
  damageTermCategory5Arm,
  damageTermCategory5Side,
  damageTermRoll,
  damageTermStatusRollBlocked,
  DAMAGE_TERM_STAT_ROWS,
  damageTermMpMoved, RESULT_QUEUE,
  damageTermPenaltyMode,
  applyDamageTermPenalty,
  damageTermPenaltyByStat,
  consumeAffinity,
  emptyStatusEventPool, advanceStatusEvents, stageStatusEventStat,
  stageStatusEventLock, statusEventLockHeld, statusEventActionDelay,
  STATUS_EVENT_POOL_SIZE,
  weaponDrainHeal as engineWeaponDrainHeal, equipmentBonuses,
  weaponCritByte, crestSuppressedByWeapon, wornFamilyBytes,
  elementValue, battleCoreStat,
  poisonTimelineDamage as enginePoisonTimelineDamage,
  applyAilment as engineApplyAilment, tryInflict as engineTryInflict,
  tryInstantDeath as engineTryInstantDeath,
  chooseResultPage as engineChooseResultPage,
  partyIconIndex as enginePartyIconIndex, partyIconCel as enginePartyIconCel,
  AILMENT_INFLICT, ailmentInflictMessageId as engineAilmentInflictMessageId,
  ailmentInflictWord as engineAilmentInflictWord,
  ailmentInflictMessageSpec as engineAilmentInflictMessageSpec,
  ailmentTurnStartMessageSpec as engineAilmentTurnStartMessageSpec,
  poisonTickMessageSpec as enginePoisonTickMessageSpec,
  regenTickMessageSpec as engineRegenTickMessageSpec,
  ailmentMarkerCel as engineAilmentMarkerCel, AILMENT_MARKER_Y,
  processTurnStart as engineProcessTurnStart, frozenGateBlocksTurn,
  initialActorTimeline, scheduleNextActor, advanceAilmentTimeline,
  cardmonBooster,
  MONEY_CAP,
  rosterSlotOfCharId,
  faceBezelCelDraw,
  enemyStatsIndex,
  stealProc,
  spawnFightTask, spawnPlateHud,
  FIGHT_TASK_ARG_BYTE_OFF, FIGHT_TASK_ARG_WORD_OFF,
  BATTLE_MESSAGE_CLOSE_BIT, BattleMessageSession,
  advanceFrameClock, frameDelta,
  newOpeningState, stepOpeningPhase, openingLineRoll, introVariantFor,
  OPENING_PHASES, OPENING_PHASE_COUNT, openingPhaseFor,
  FINALE_MSG_BODY, FINALE_MSG_LEARNED, FINALE_HEAD_ATTACK_ID,
  BATTLE_WIN_RESULT_SCREEN, FINALE_WIN_ENDING_MOVIE,
  battleWinLaunchCode, battleWinJinglePlays,
  FINALE_TAIL_DEFEAT_BEATS, finaleBattleKind, finaleRecordsTechnique, finaleCopiedAttackSkill,
} from "./vendor/engine.js";
// Three fight mechanisms wired onto the ordinary route above, each an engine port of the
// original fightstg routine: the face-box cel draw (FIGHTSTG_F0x80093fec), the enemy-id
// resolver (FIGHTSTG_F0x8009b864/F0x8009b8d0) and the steal roll (FIGHTSTG_F0x800a1114).
// The two fight-task spawners (engine/dw3/battle-task-spawn.ts) are wired too: the fight
// task F0x80090c44 (the acting fighter's action object, its tick the technique record
// machine) and its data variant the plate-HUD spawner F0x80093cc8.
import { ui } from "./vendor/engine.js";
import { applyFormTechGates } from "./form-tech-slots.js";
import { CHARID_TO_DIGID, baseStatsFor } from "./party.js";
import { loadPack, drawClip, drawClipWidth, clipSize, packReady, drawClipAtPaletteRow } from "./screenpack.js";
import { drawText as uiDrawText, drawIconGlyph, fontReady as uiFontReady } from "./uifont.js";
import { drawItemIcon, itemFamily } from "./itemicons.js";

// Native post-battle fight-report chrome (stfgtrep overlay). See
// docs/research/ui/stfgtrep-decoded-2026-07-12.md — the census row asking
// "is stfgtrep the post-battle EXP screen?" is CONFIRMED yes; this replaces
// the previously hand-guessed win/lose panel text with real stfrpt screen-
// pack art + real label coordinates (tools/extract_stfgtrep_ui.py).
const stfrptChrome = loadPack("stfrpt");
const pgfgc00 = loadPack("pgfgc00");
// CMFONT, the pack pro/fightstg's message panel uses for its blinking "press Circle"
// glyph (handle 0x02860000 -- web/dialogue-translated.js:15 carries the same mapping).
const cmfont = loadPack("cmfont");
let REPORT_LAYOUT = null;
fetch("assets/data/stfgtrep_ui.json").then((r) => r.json()).then((j) => { REPORT_LAYOUT = j; }).catch(() => {});

// Original 4bpp fight UI texture page decoded from the true GPU VRAM in
// visible Redux slot 7: tpage (512,0), CLUT (512,250). Every frame below is a
// source rectangle from this raw PS1 atlas; none are framebuffer screenshots.
let fightUiAtlas = null;
if (typeof Image !== "undefined") {
  const im = new Image();
  im.onload = () => { fightUiAtlas = im; };
  assignAssetImage(im, "assets/ui/fight_ui.png?v=tpage512-clut512x250");
}

// Atlas source rects = PGFGTC00.BIN frame u,v,w,h (LBA 1109/1110). Cel 0xA is
// the 104×64 face bezel (frame 4); cel 0x22 is the command row (frames 1+2).
const FIGHT_UI_CLIPS = Object.freeze({
  hpFrame: [104, 0, 96, 16],
  hpFrameAlt: [104, 16, 96, 16],
  angledFrame: [104, 32, 82, 16],
  square: [80, 128, 13, 13],
  portraitFrame: [0, 0, 104, 64],
  commandIcon: [24, 164, 16, 16],
  commandPlate: [104, 32, 84, 19],
});

export const BATTLE_COMMANDS = Object.freeze(["Fight", "Tech", "DV", "Tag", "Item", "Run"]);
const MENU_ITEMS = BATTLE_COMMANDS;
/** The shipped pro/fightstg command list's row count (config table 0x800A34CC). */
const COMMAND_COUNT = 6;
const COLS = 1;

// The battle tech list (FIGHTSTG 0x80094f0c, TL-008/TL-009). A digivolution
// contributes the current form's six learned halfwords with all flags intact;
// every OTHER equipped form then lends the halfwords carrying 0x4000, deduped by
// the 13-bit id. The flag bit survives into the command list because the price
// rule (TL-010) charges the loaded premium from it. Rookie mode is the
// signature halfword alone, marked 0x8000.
export function battleTechWords({
  ledger, currentId = 0, equippedForms, signatureTech = 0,
} = {}) {
  const records = ledger ?? [];
  const current = records.find((record) => Number(record?.id) === Number(currentId));
  const words = current
    ? [...(current.techSlots ?? [])].map((w) => Number(w) & 0xffff)
    : [(Number(signatureTech) & 0x1fff) | 0x8000];
  const equipped = equippedForms ?? (current ? [currentId] : []);
  for (const formId of equipped) {
    if (Number(formId) === Number(currentId)) continue;
    const source = records.find((record) => Number(record?.id) === Number(formId));
    for (const raw of source?.techSlots ?? []) {
      const word = Number(raw) & 0xffff;
      if ((word & 0x4000) && !words.some((v) => (v & 0x1fff) === (word & 0x1fff)))
        words.push(word);
    }
  }
  return words.filter((word) => word !== 0); // an empty ledger slot is not a menu row
}

// STATUS-C004: when the active Digimon is confused, the command menu is replaced
// by the shuffled joke commands (built once per decision, cached on b.confusedMenu
// and cleared when the pick is committed). The pick affects gag flavor only;
// F0x800a1910 independently rolls whether confirmation becomes Attack or gag.
// The rows themselves are drawn by the shared pro/fightstg list (the joke owner
// F0x8009A898 on the joke config 0x800A3634), so this only decides WHAT the rows
// say and hands the shuffle to it; `?legacyJokeMenu=1` keeps the walker's own
// hand-drawn list for that case.
const JOKE_LEGACY = typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("legacyJokeMenu");

/** The six shuffled joke rows for this decision, built once, or null. */
export function jokeMenuRows(b) {
  if (!b?.player?.ailments?.confuse) { b.confusedMenu = null; return null; }
  if (b.confusedMenu?.length !== 6) b.confusedMenu = shuffleJokeMenu(RAND_U16);
  return b.confusedMenu;
}

/** True when the walker's own list must draw the confused rows. */
function useLegacyJokeList(b) { return JOKE_LEGACY && !!jokeMenuRows(b); }

export function currentMenuItems(b) {
  const joke = jokeMenuRows(b);
  if (joke) return joke.map((j) => j.label);
  return MENU_ITEMS;
}
export const DV_GAUGE_MAX = 1000;
export const TAG_PRESENTATION = Object.freeze({
  sequence: 0x38,
  outgoingSeconds: 0.6,
  arrivalFrames: 131,
  arrivalSeconds: 131 / 60,
  arrivalClip: "idle",
});
export function tagArrivalComplete(elapsedSeconds) {
  return elapsedSeconds * 60 >= TAG_PRESENTATION.arrivalFrames;
}

// Split the decoded clip-12 fullScript into single-actor stage chunks. The script never
// shows two of its actors at once (slot 1 = parent A, slot 2 = parent B, slot 3 = result),
// so one model swap per boundary reproduces it. Segment 2 splits at the op2 [2,2] that
// hides parent B: orb flight on the partner model, camera hold / white-out / motion-30
// reveal on the result model (this second half is exactly the previously shipped tail).
//
// A chunk boundary is a segment boundary, NOT the end of the presentation: chunk 4 is segment 3,
// the whole result reveal pose and Desperado volley, and it plays the SAME actor the chunk
// before it staged at the world origin with `op2 [3,3,0,0,0,0]`. So the slot's staged position
// has to survive the boundary — see ActorAnimator._move.
export function dnaClip12Chunks(segs, dna) {
  if (!Array.isArray(segs) || segs.length !== 5) return null;
  const s2 = segs[2];
  const cut = s2.findIndex((r) => r.op === 2 && (r.words?.[0] | 0) === 2 && (r.words?.[1] | 0) === 2);
  if (cut < 0) return null;
  // Runtime replay (2026-07-15, state-9, orbtrace/orb4 frames): each flight segment OPENS
  // with its parent model in close-up (op2 [1,slot] show + mode-3 teleport near the staging
  // camera), which then glides off as the 1005/1006 orb starburst takes over. The earlier
  // "parents stay outside the frustum / noShow" reading is FALSIFIED by those frames.
  return [
    { ops: segs[0],            model: dna.originalProfile.name, slot: 1 },
    { ops: segs[1],            model: dna.originalProfile.name, slot: 1 },
    { ops: s2.slice(0, cut + 1), model: dna.partnerName,        slot: 2 },
    { ops: s2.slice(cut + 1),  model: dna.resultProfile.name,   slot: 3, result: true },
    { ops: segs[3],            model: dna.resultProfile.name,   slot: 3, result: true },
    { ops: segs[4],            model: dna.originalProfile.name, slot: 1, show: true },
  ];
}

// Materialize the persistent three-row fight report. The native screen shows
// the whole pack (not only Digimon that were tagged into the fight), while EXP
// is added only to the participants selected by the reward resolver.
export function buildFightReportRows(roster, records, profiles, rewardXpByIndex = {}) {
  return (roster ?? []).slice(0, 3).map((member, index) => {
    const stats = member?.stats ?? records?.[index]?.statsRecord ?? {};
    const rookieId = Number(member?.rookieId ?? records?.[index]?.rookieId ?? 0);
    const rewardXp = Number(rewardXpByIndex[index] ?? 0);
    const ledger = stats.formLedger ?? [];
    // The three bars are the partner's DIGIVOLUTIONS. Its own base form owns
    // the plate, the picture and the name strip above them, and it also holds
    // a form-ledger record of its own (the rookie banks DV exp against itself),
    // so it has to be dropped here or it takes a bar as well.
    const formIds = (stats.equippedForms?.length
      ? stats.equippedForms
      : ledger.map((entry) => entry.id))
      .filter((id) => Number(id) !== rookieId)
      .slice(0, 3);
    return {
      index,
      rookieId,
      name: member?.name ?? records?.[index]?.profile?.name ?? "",
      level: Number(stats.level ?? records?.[index]?.level ?? 1),
      xp: Math.min(999999, Number(stats.xp ?? 0) + rewardXp),
      forms: formIds.map((id) => {
        const record = ledger.find((entry) => Number(entry.id) === Number(id));
        return {
          id: Number(id),
          name: profiles?.[Number(id)]?.name ?? "",
          level: Number(record?.formLevel ?? 1),
        };
      }),
    };
  });
}

// One vsync of the EXP odometer (F0x80083d9c). After 10 vsyncs the original
// snaps to the target instead of crawling.
export function expCountStep(displayed, target) {
  let digits = 0;
  let rest = target;
  let place = 10;
  if (rest !== 0) {
    do {
      digits += 1;
      rest -= rest % place;
      place *= 10;
    } while (rest !== 0);
  }
  let ones = 1;
  for (let n = digits - 1; n > 0; n--) ones = ones * 10 + 1;
  let next = displayed + ones;
  if (ones * 9 < next) next = next - 1 - ones * 9;
  return next;
}

export function expCountDisplayed(start, target, frames) {
  const from = Number(start) || 0;
  const to = Number(target) || 0;
  if (frames >= 10 || from === to) return to;
  let shown = from;
  for (let i = 0; i < frames; i++) shown = expCountStep(shown, to);
  return shown;
}

// Per-partner nested sequence from F0x80084ec4 + F0x80083e74, then Bits / Item.
// "Level gained!" is a form-level jingle; "{name}\nLevel {n}!" is the partner.
export function buildFightReportPages({
  xp = 0,
  bits = 0,
  droppedItem = null,
  events = [],
} = {}) {
  const pages = [];
  for (const ev of events) {
    const share = Number(ev.xp) || 0;
    if (share > 0) {
      const oldXp = Number(ev.oldXp) || 0;
      pages.push({
        kind: "exp",
        index: ev.index,
        value: share,
        startXp: oldXp,
        targetXp: oldXp + share,
        message: `EXP gained:\n${share} EXP`,
      });
    }
    for (const fl of ev.formLevels ?? [])
      pages.push({
        kind: "form-level", index: ev.index, value: fl.level, form: fl.name,
        message: "Level gained!", jingle: "jingle03",
      });
    for (const tech of ev.learnedTechs ?? [])
      pages.push({ kind: "tech", index: ev.index, value: tech, message: `Learned Tech:\n${tech}` });
    for (const tech of ev.loadableTechs ?? [])
      pages.push({ kind: "load", index: ev.index, value: tech, message: `Can load Tech:\n${tech}` });
    if ((ev.newLevel ?? 0) > (ev.oldLevel ?? 0))
      pages.push({
        kind: "partner-level", index: ev.index, value: ev.newLevel,
        message: `${ev.name}\nLevel ${ev.newLevel}!`, jingle: "jingle02",
      });
    for (const u of ev.unlocked ?? []) {
      if (u.slotFull) {
        pages.push({
          kind: "slot-full", index: ev.index, value: u.name, form: u.name,
          message: "Digivolve Slot full.\nStoring to Digimon Lab.",
        });
      } else {
        pages.push({
          kind: "digivolve", index: ev.index, value: u.name, form: u.name,
          message: `Digivolve learned:\n${u.name}`,
        });
      }
    }
  }
  if (bits > 0)
    pages.push({ kind: "bit", value: bits, message: `BIT gained:\n${bits} BIT` });
  if (droppedItem)
    pages.push({ kind: "item", value: droppedItem, message: `Item gained:\n${droppedItem}` });
  if (!pages.length) {
    pages.push({ kind: "exp", value: xp, startXp: 0, targetXp: xp, message: `EXP gained:\n${xp} EXP` });
  }
  return pages;
}

// F0x80083260: base = pageIndex * header.rowStepY (50), then 3 party rows at
// party_row.stepY (15). Walker shows one page at a time, so draw with pageIndex 0.
// One partner's group on the fight report. F0x80083260 and F0x80083744 both
// key off arg0->unk5C, the PARTY SLOT: the group sits at slot * 50 down the
// page, and F0x80083744 hands the same field to the portrait chooser. The three
// rows inside a group are that Digimon's digivolve bars, not the three
// partners. Until 2026-09-04 this returned one group and the walker drew the
// three partners into its bars.
export function fightReportGroupGeom(layout, groupIndex = 0) {
  const g = layout?.group;
  const f = layout?.form_slot;
  if (!g || !f) return null;
  const base = groupIndex * g.stepY;
  const at = (e) => ({ x: e.x, y: base + e.yOff });
  const slots = [];
  for (let j = 0; j < f.count; j++) {
    const dy = base + f.stepY * j;
    slots.push({
      barClip: f.bar.clip,
      barX: f.bar.x,
      barY: dy + f.bar.yOff,
      highlightClip: f.highlight?.clip ?? null,
      highlightX: f.highlight?.x ?? null,
      highlightY: f.highlight == null ? null : dy + f.highlight.yOff,
      markerClip: f.marker?.clip ?? null,
      markerX: f.marker?.x ?? null,
      markerY: f.marker == null ? null : dy + f.marker.yOff,
      markerRamp: f.marker
        ? { rampSteps: f.marker.rampSteps, stepVsync: f.marker.stepVsync }
        : null,
      nameX: f.name.x,
      nameY: dy + f.name.yOff,
      valueX: f.value.x,
      valueY: dy + f.value.yOff,
    });
  }
  return {
    base,
    plate: { clip: g.plate.clip, ...at(g.plate) },
    portrait: { ...at(g.portrait), frames: g.portrait.frames,
                stepVsync: g.portrait.stepVsync },
    name: at(g.name),
    levelLabel: { str: g.level_label.str, ...at(g.level_label) },
    levelValue: at(g.level_value),
    xpValue: at(g.xp_value),
    xpLabel: { str: g.xp_label.str, ...at(g.xp_label) },
    highlight: g.highlight
      ? { clip: g.highlight.clip, frames: g.highlight.frames,
          stepVsync: g.highlight.stepVsync, ...at(g.highlight) }
      : null,
    levelArrow: g.level_arrow
      ? { clip: g.level_arrow.clip, pages: g.level_arrow.pages,
          rampSteps: g.level_arrow.rampSteps, stepVsync: g.level_arrow.stepVsync,
          ...at(g.level_arrow) }
      : null,
    slots,
    message: {
      x: layout.message.x,
      y: layout.message.y,
      kind: layout.message.kind,
    },
  };
}

// The portrait's frame. One step every 13 vsyncs, then back to the start --
// the table's own -1 marks where each rookie's loop ends, and the sequences are
// already trimmed to it. PAL runs at 50 Hz.
export function fightReportPortraitClip(portrait, rookieId, seconds) {
  const seq = portrait?.frames?.[String(rookieId)];
  if (!seq?.length) return null;
  const step = (portrait.stepVsync ?? 13) / 50;
  return seq[Math.floor(Math.max(0, seconds) / step) % seq.length];
}

// The mark over the partner the page is about: four colours, one step every
// five vsyncs, looping. PAL runs at 50 Hz.
export function fightReportCycleRow(entry, seconds) {
  const n = entry?.frames ?? 4;
  const step = (entry?.stepVsync ?? 5) / 50;
  return Math.floor(Math.max(0, seconds) / step) % n;
}

// The level arrow, and the plate under it: the colour RAMPS and then STOPS.
// It does not loop back to the start.
export function fightReportRampRow(entry, seconds) {
  const n = entry?.rampSteps ?? 11;
  const step = (entry?.stepVsync ?? 3) / 50;
  return Math.min(n - 1, Math.floor(Math.max(0, seconds) / step));
}

// The pages that are about one digivolution bar rather than the partner.
export const FORM_PAGE_KINDS = new Set(["form-level", "digivolve", "slot-full"]);

// Which of a partner's three bars a page is about, or null when the page is
// about the partner itself.
export function fightReportMarkedSlot(page, row) {
  if (!page || !row || !FORM_PAGE_KINDS.has(page.kind)) return null;
  const want = page.form ?? page.value;
  const j = (row.forms ?? []).findIndex((f) => f?.name && f.name === want);
  return j >= 0 ? j : null;
}

// How many groups the page holds -- three party slots.
export function fightReportGroupCount(layout) {
  return layout?.group?.count ?? 0;
}

// The "L1" / "R1" page hints under an in-battle list window.
//
// `kind` and `clut` are the shared part, and they come off the original's own
// text-element factory. Every one of these hints is built by
// F0x8001AE38(layer 0x1005, 3, x, y) -- kind 3, the number face -- and then has
// its colour row set to 2 through method +0x138 = F0x8001a1f4,
// `sb $a1, 0xc0($a0)` (exe/fns.s:11132-11134, installed by the factory at
// exe/fns.s:12069-12070). The drawer's CLUT word is
// ((+0xC0 + +0xAE + glyph[+4]) << 6) | (((+0xAC + glyph[+3]) >> 4) & 0x3f)
// (exe/fns.s:10605-10621); the factory zeroes +0xAE (exe/fns.s:12119) and the
// kind-3 glyphs these two words use carry clut_y 0 in their record, so the row
// is exactly 2 -- the flat white of `uifont.json` cluts["3"].rows["2"], not the
// amber of row 0 the walker used to paint.
//
// Only the anchor is per list, because F0x8001AE38 takes x and y as arguments
// and each list's own widget builder passes its own:
//
//   TECH   L1 (26,159) R1 (128,159)  FIGHTSTG_F0x80096048  fightstg.s:19881,
//         :19892 and :19899, :19910  (the two +0x138 stores are the `li $a1,2`
//         in each jalr's delay slot)
//   ITEM   L1 (26,169) R1 (128,169)  FIGHTSTG_F0x8009563C  fightstg.s:19216,
//         :19227 and :19234, :19245
//   form   L1 (34,171) R1 (56,171)   FIGHTSTG_F0x8009492C  fightstg.s:18354,
//         :18365 and :18372, :18383
//
// The hints themselves are never hidden -- no list calls +0x144 on them -- so
// they print on a single page as well as on several. Only the arrow cels
// (0x1F / 0x20) are page-gated, and then only behind bit 4 of [0x8004DF98](),
// the same display counter the arrows blink on (FIGHTSTG_F0x80095E40,
// fightstg.s:19786-19810; FIGHTSTG_F0x8009543C, :19136-19150).
export function listPageHint(l1, r1) {
  return Object.freeze({ kind: 3, clut: 2, l1: Object.freeze(l1), r1: Object.freeze(r1) });
}

export const TECH_PAGE_HINT = listPageHint({ x: 26, y: 159 }, { x: 128, y: 159 });
export const ITEM_PAGE_HINT = listPageHint({ x: 26, y: 169 }, { x: 128, y: 169 });
export const FORM_PAGE_HINT = listPageHint({ x: 34, y: 171 }, { x: 56, y: 171 });

// Native 320x240 battle HUD geometry. Command rows, the face bezel, and the
// HP name plates are PGFGTC00 constructors (F0x800934f0 cels 0/1 at (8,15) /
// (161,15); cel 0xA bezel; cel 0x22 command row). Slot-7 clips remain only as
// a pack-not-ready fallback.
export const BATTLE_UI_LAYOUT = Object.freeze({
  nativeW: 320,
  nativeH: 240,
  enemyPlate: { x: 8, y: 15, w: 149, h: 44, nameX: 17, nameY: 21, barX: 13, barY: 36, barW: 135, barH: 10 },
  playerPlate: { x: 161, y: 15, w: 150, h: 44, nameX: 174, nameY: 21, hpRight: 302, barX: 167, barY: 36, barW: 135, barH: 10 },
  // F0x800934f0 vertex tables 0x800a3470 (partner) / 0x800a3480 (enemy):
  // 128-wide fill, y=0x25..0x2b, draining toward the centre.
  hpBar: { y: 37, h: 6, enemyRight: 143, playerLeft: 175 },
  // Party status markers: F0x800934f0 draws them at the halfword table 0x800a34c0
  // (271, 282, 293 for the party; 37, 26, 15 for the enemy) and at the literal y
  // 0x30. The hand-drawn path below keeps its own anchors behind ?legacyBattleHud=1.
  enemyPips: { x: 37, y: 48, count: 1, step: 14 },
  playerPips: { x: 271, y: 48, count: 3, step: 11 },
  // The two HP numbers the original builds with F0x8001AE38(0x1005,3,...) at
  // (0x10b, 0x1a) and (0x12e, 0x1a) — the shown HP and the maximum, side by side.
  hpNumbers: { shownX: 0x10b, shownY: 0x1a, maxX: 0x12e, maxY: 0x1a },
  dv: { x: 261, y: 62, w: 49, h: 9 },
  // Cel 0xA dest is (246, 74) plus layer dx -40 → (206, 74). Inner 100×60 at
  // (208, 76) is the 3D face (F0x80094064 halfwords 0xD0/0x4C/0x64/0x3C).
  portrait: { x: 206, y: 74, w: 104, h: 64 },
  portraitView: { x: 208, y: 76, w: 100, h: 60 },
  // Cel 0x22: icon 16×16 at (16, y) + plate 84×19 at (32, y-3). Labels at x=36.
  commands: { iconX: 16, plateX: 32, plateYOff: -3, boxX: 36, y: 109, rowH: 19, iconSize: 16, boxW: 84, boxH: 19 },
  list: {
    x: 9, y: 64, w: 153, h: 109, iconX: 14, glyphX: 29, labelX: 41, rowY: 69, rowH: 16,
    // The "L1"/"R1" page hints this list prints under its window; the shared
    // kind and colour row live in listPageHint() above. The walker's list box is
    // the TECH list's, so the TECH anchors are the default.
    pageHint: TECH_PAGE_HINT,
  },
  listMp: { x: 164, y: 53, w: 93, h: 18 },
  itemQty: { x: 166, y: 160, w: 41, h: 23 },
  description: { x: 11, y: 188, w: 295, h: 37 },
  tag: { nameX: 32, nameW: 68, statsX: 101, statsW: 97, y: 75, rowH: 32 },
  message: { x: 20, y: 194, w: 288, h: 32 },
});

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
  RUN_AWAY: 0x43,        // kind 2, wfightmn.s:2222 (the Run command's own page)
  DEFEATED: 0x51,        // kind 2, wfightmn.s:3265 -- "Defeated!", the fallen enemy's page
  BLASTED: 0x61,         // kind 2, wfightmn.s:2977 (and kind 1 at fightstg.s:14077)
  BACK_TO_NORMAL: 0x62,  // kind 2, wfightmn.s .L0x0000316c
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
export function jokeGagMessageSpec(playerName, jokeIndex, bit) {
  return {
    kind: MSG_KIND.JOKE_GAG,
    payload: [jokeFlavorMessageId(jokeIndex | 0, bit | 0)],
    name: playerName,
  };
}

/**
 * Command-row label origin for row `index`: FIGHTSTG_F0x80093cf4 places the six
 * text widgets at (0x24, 0x6d + 19*index) on layer 0x1005 (claim
 * battle-command-window-labels-2026-08-19); the layer's +0x11c origin is (0,0),
 * so those are final screen coordinates. The row art's cel components already
 * sit at (16, 109+19i) and (32, 106+19i).
 */
export function commandLabelPos(index, C = BATTLE_UI_LAYOUT.commands) {
  return { x: C.boxX, y: C.y + (index | 0) * C.rowH };
}

export function normalizeDvGauge(value) {
  return Math.min(DV_GAUGE_MAX, Math.max(0, Math.trunc(Number(value) || 0)));
}

// Battle states
const ST = {
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

const DNA_PARENT_CLIP = 12;
const DNA_RESULT_TABLE = 30;
// The item-use action clip. The original's item machine FIGHTSTG_F0x8008d3b4 allocates a
// fresh action actor (FIGHTSTG_F0x8008c910) and writes its clip slot +0x54 = 10
// (pro/fightstg.s:11099-11105), so an item runs the SAME action-VM script an attack does,
// clip 10 = the item-use motion (tables 44/45 in every pack; user visual ground truth).
const ITEM_USE_CLIP = 10;

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
export function faceBoxHudEvents(b, lineUp) {
  return {
    hudUp: FACE_BOX_HUD_STATES.has(b.state),
    menuUp: FACE_BOX_MENU_STATES.has(b.state),
    lineUp: !!lineUp,
  };
}
const PROFILE_NAME_ALIASES = Object.freeze({
  BKWarGreymon: "BK WarGreymon",
  ImperialdramonFM: "Imperialdramon-F",
  ImperialdramonPM: "Imperialdramon-P",
});
export function canonicalProfileName(name) { return PROFILE_NAME_ALIASES[name] ?? name; }

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
export function dnaFusedForm(scripts, profiles, actionId, digimon) {
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

// ── Pure stat scaling + evolution logic (module-level so it is unit-testable) ──
// Stat scaling: starters use real growth rates; champions use growth=1 (low but real).
export function scaledStat(profile, statKey, level) {
  const base   = profile[statKey]   ?? 0;
  const growth = profile.growth?.[statKey] ?? 1;
  return Math.round(base + growth * (level - 1));
}
export function scaledHp(profile, level) {
  if (profile.is_starter) return scaledStat(profile, "hp", level);
  // Champions store hp=1, growth_hp=1 — approximate from combat stats.
  return Math.round(80 + scaledStat(profile, "str", level) * level);
}
export function scaledMp(profile, level) {
  if (profile.is_starter) return scaledStat(profile, "mp", level);
  return Math.round(20 + scaledStat(profile, "spt", level) * Math.floor(level / 2 + 1));
}

// Sequential boss party: after the member at `index` is defeated, decide whether the next
// member steps in (gauntlet) or the whole party is down. Pure.
export function gauntletNext(party, index) {
  const next = index + 1;
  if (!party || next >= party.length) return { done: true };
  return { done: false, index: next, entry: party[next] };
}

/**
 * The battle's LIVE kind word (0x800a4536): the finale's phase once it has advanced,
 * else setup's own value (`specialMode`). Stamped onto both combatant records so the
 * accuracy leaves read it; the phase writer is runFinaleBeat.
 */
function battleKindOf(b) {
  return finaleBattleKind(b?.specialMode ?? 0, b?._finaleKind);
}

/**
 * The final boss's mid-battle track switch, gated exactly as the original arms it.
 *
 * WFIGHTMN zeroes the transition counters only for battle 0x144, the Galacticmon
 * sequence (.L0x00001090-.L0x0000109c: mode 4, then `sb 0, +0xdb` / `sb 0, +0xda`),
 * and the damage-apply wrapper fires on the third counted application
 * (.L0x00004d90: `slti $v0, 0x3` / `bnez`) — BUT the wrapper's own gates come
 * first (.L0x00004d48-.L0x00004d70): the kind word must be 6 (the head phase; the
 * counter `+0xda` runs only while it is), the acting side must be the player's,
 * `+0xdb` must still be clear, and the applied delta must be nonzero. Pure so the
 * cue test can walk the boundary; the battle closure counts and calls it (see
 * noteFinalBossPhaseDamage).
 */
export function finalBossPhaseSwitchesTrack(specialMode, battleKind, landedCount) {
  return specialMode === 4 && battleKind === 6 && landedCount >= 3;
}

// Pick an enemy's vitals: prefer the REAL per-encounter hp/mp (extracted from ROM into
// field_encounters, e.g. boss screens carry boss-specific hp / 9999 mp) over the walker's
// computed fallback. A non-positive/absent real value (0 or undefined) means "not in the
// data" → use the fallback. Pure.
export function enemyVitals(real, fallback) {
  return {
    hp: real?.hp > 0 ? real.hp : fallback.hp,
    mp: real?.mp > 0 ? real.mp : fallback.mp,
  };
}

/** Native Manual-DV/Tag form commit: identity changes; the live stat body does not. */
export function setLiveBattleForm(record, profile) {
  record.profile = profile;
  return record;
}

/**
 * The one form change, shared by every path that changes a battle form
 * (engine/dw3/battle-form-change.ts, the port of pro/wfightmn's 0x800A69F0,
 * 0x800A7328 and the commit at wfightmn.s:1680-1692).
 *
 * What the original writes, and nothing else: the live form id in the combatant
 * record, the equipped-form flag bytes at 0x80042B84, and — only while a
 * reserved second form is standing — the release of that reservation. No HP, MP,
 * stat, technique or ailment value is written, so the walker's record keeps the
 * numbers it had; `savedSpeciesId` is what makes effStats add the new form's own
 * base stats on the next read, exactly as F0x8009EC94 does.
 *
 * @param b the live battle
 * @param profile the profile the Digimon takes (its id is what the record carries)
 * @param position the party position that changes (the acting one for a Digivolve)
 */
export function commitBattleFormChange(b, profile, position = b?.activePlayerIndex ?? 0) {
  const record = b?.playerRecords?.[position];
  if (!record) return null;
  const view = {
    activeSlot: () => b.activePlayerIndex,
    liveFormId: (slot) => Number(b.playerRecords[slot]?.profile?.id ?? -1),
    // record +0x00: the form id, which the caller has already resolved to the
    // profile object the Digimon is taking.
    writeLiveFormId: (slot, id) => {
      const target = b.playerRecords[slot];
      if (!target || Number(id) !== Number(profile?.id)) return;
      setLiveBattleForm(target, profile);
    },
    // record +0x1A: the reserved second form is Blast's own writer (ledger
    // BLAST-9767), and the walker keeps Blast's state where the flag lives.
    reservedSecondForm: (slot) => (Number(slot) === b.activePlayerIndex && b.blast?.active ? 1 : 0),
    reservedFormId: (slot) => Number(b.playerRecords[slot]?.rosterSpeciesId ?? 0),
    clearReservedSecondForm: () => releaseReservedSecondForm(b),
    // 0x80042B84 + slot*4 + k. The original sets byte 6 on every form change and
    // byte 7 + the equipped row for the form just taken; no reader of those bytes
    // has been located in this port, so they are stored and left there.
    setFormFlag: (slot, k, value) => {
      b.formFlags ??= [];
      const flags = b.formFlags[slot] ?? (b.formFlags[slot] = new Array(10).fill(0));
      flags[k] = value & 0xff;
    },
    // [0x80042B1C + rosterKey*2 + 0x58] is the roster slot's DV gauge; the
    // walker's per-record gauge is the same value.
    clearFormGauge: (rosterKey) => {
      const target = b.playerRecords[rosterKey] ?? b.player;
      if (!target) return;
      target.gauge = 0;
      persistPlayerGauge(b);
    },
    // [0x800A4374] is the resident timeline index the release clears counters
    // through; the walker models no timeline records, so it answers "none".
    findTimelineIndex: () => -1,
    clearTimelineCounter: () => {},
    rosterKey: (slot) => Number(b.playerRecords[slot]?.rosterIndex ?? slot),
    equippedForms: (slot) => {
      const forms = b.playerRecords[slot]?.statsRecord?.equippedForms ?? [];
      return Array.from({ length: 3 }, (_, i) => (Number(forms[i]) > 0 ? Number(forms[i]) : -1));
    },
    rosterSpecies: (slot) => Number(b.playerRecords[slot]?.savedSpeciesId ?? -1),
  };
  engineCommitManualDigivolve(view, Number(profile?.id));
  return record;
}

/**
 * Battle-end F0x800a7c00 writes every resident record back, not merely the
 * Digimon left on screen. A KO is returned to the field at 1 HP; its MP is
 * not overwritten on that branch. Module scope, because the gauge save below
 * and the release above are called from here as well as from inside the battle.
 */
export function syncPlayerRoster(b) {
  for (const player of b?.playerRecords ?? []) writeBackBattleVitals(player);
}

/**
 * Write the party's stored stats back to disk, so a gauge spent (or earned)
 * mid-battle is still spent when the fight is over.
 *
 * `b.getState` is the field state accessor the running battle was built with;
 * it lives on the record because every caller of this is shared code, not the
 * factory: the reserved-second-form release is the original's own routine and
 * is reached from the Digivolve commit, the Tag commit and the Blast revert.
 */
export function persistPlayerGauge(b) {
  if (!b?.player) return;
  syncPlayerRoster(b);
  const state = b.getState?.();
  if (!state) return;
  localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
  localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
}

/**
 * The reserved-second-form release (0x800A7328): the DV/Blast gauge goes to zero
 * and the standing reservation goes with it. Shared by the Digivolve commit, the
 * Tag commit, the Blast revert and the battle-outcome path (wfightmn .L0x00002174),
 * which is why none of them repeats the gauge write.
 *
 * `persist` is off only on the loss exit: the disc runs this release there too, but
 * the loss arm writes nothing to the card, so the walker must leave its stored
 * party untouched while still clearing the live gauge.
 */
export function releaseReservedSecondForm(b, persist = true) {
  if (!b?.blast?.active) return false;
  b.blast = null;
  b._blastPending = false;
  b._blastRevertPending = false;
  b.player.gauge = 0;
  if (persist) persistPlayerGauge(b);
  return true;
}

/**
 * The battle-outcome arm of the shared release (wfightmn .L0x00002174, file
 * 0x2174). The disc runs `0x800A7328` on EVERY exit arm — win, loss, enemy fled —
 * BEFORE the result byte is read: while the acting combatant's `+0x1A` reservation
 * is standing it clears it and zeroes the DV/Blast gauge at
 * `0x80042B1C + rosterKey*2 + 0x58` (wfightmn.s:1393-1421). A Blast that ends
 * because the FIGHT ended therefore resets the gauge exactly as a normal revert
 * does — confirmed live in `captures/blast-presentation-2026-07-14/README.md`
 * (blast_run3: "Woodmon died while Blast active -> b0 01->00, gauge->0").
 *
 * The SAVED exits (win, enemy-fled) persist the zeroed gauge through the same
 * write-back the report uses. The loss arm writes nothing to the card at all, so
 * its zero is left in RAM only (`persist` off) and the stored party is untouched.
 *
 * Exported so a headless check can pin the rule with the very call `endBattle`
 * makes. Returns true when the release ran.
 */
export function battleOutcomeRelease(b, result) {
  if (!b?.blast?.active) return false;
  return releaseReservedSecondForm(b, result !== "lose");
}

/** Native battle-outcome write-back for one resident player record. */
export function writeBackBattleVitals(player) {
  if (!player?.statsRecord) return;
  if (player.hp <= 0) player.statsRecord.hp = 1;
  else {
    player.statsRecord.hp = player.hp;
    player.statsRecord.mp = player.mp;
  }
  player.statsRecord.dvGauge = normalizeDvGauge(player.gauge);
  // The three persistent penalty halfwords (roster +0x42/+0x44/+0x46) the post-hit arms
  // write: they live on the roster member, so a penalty landed this battle survives to the
  // field and only the inn's rest clears it (F0x8001104c). `statPenaltyOf` normalizes a
  // record that never took one to three zeros.
  player.statsRecord.statPenalty = statPenaltyOf(player);
}

/**
 * The Digimon a won battle PAYS — the set the reward is split between. One
 * rule, resolved from the marked set at the outcome, read by the share divisor,
 * the per-member payout, the DVEXP ladder, the level-up pass and the report
 * row's own participant flag.
 *
 * `b.participantIndices` is the marked set the battle accumulated: the lead at
 * setup, plus anybody tagged in or fused (`F0x800a69f0` / `F0x800a6b18`, the two
 * writers of the original's per-position flag byte). The original prunes it
 * before the report is built. The battle-outcome routine `F0x800a7c00` walks the
 * three live records and, for any whose CURRENT HP is not positive, writes 1 HP
 * to the roster and clears that position's flag byte and its three column bytes
 * in one block — pro/wfightmn.s .L0x00002044 `lh $v0, 0x8($s1)` /
 * .L0x0000204c `bgtz $v0, .L0x00002084` (so `<= 0` is the KO arm) /
 * .L0x0000206c `sh $v1, 0x788($v0)` / .L0x00002070-.L0x00002080
 * `sb $zr` at `0x6`/`0x7`/`0x8`/`0x9` of that row.
 *
 * The report then divides the reward by the number of rows whose flag is STILL
 * set, not by the number deployed — pro/stfgtrep.s .L0x00002c58
 * `lbu $v0, 0x6($a0)` / .L0x00002c60 `beqz` (skip) / .L0x00002c68
 * `addiu $a2, 0x1`, and `$a2` is the share divisor at .L0x00002cbc-.L0x00002d54.
 * So a member knocked out mid-fight is paid NOTHING **and** stops shrinking
 * everyone else's share: a solo survivor of a two-Digimon fight is paid the full
 * 100%, not 60%.
 *
 * Live HP is the right input, not the roster's. `writeBackBattleVitals` (the
 * `.L0x0000206c` 1-HP floor above) writes `statsRecord.hp` and never touches the
 * live `hp`, so this predicate reads the same value the original reads at
 * `.L0x00002044` no matter which of the two runs first.
 *
 * A marked position with no resident record cannot have been knocked out by the
 * fight, so it stays in rather than silently vanishing from the payout.
 */
export function paidParticipants(b) {
  const marked = b?.participantIndices;
  if (!marked?.size) return [];
  const out = [];
  for (const index of marked) {
    const record = b?.playerRecords?.[index];
    const hp = Number(record?.hp);
    if (record && Number.isFinite(hp) && hp <= 0) continue;  // knocked out at the outcome
    out.push(index);
  }
  return out;
}

// ── The shared loss exit ────────────────────────────────────────────────────
// One rule for every battle kind, because the original has one: wfightmn's mode-2
// tick (`F0x800a7c00`, mode word at object+0x14 == 2) is entered on the loss, not on
// a battle kind. It waits for the defeat effect's phase 2, builds the fade object
// `F0x8008aaac` (tick 0x8008aa08) and calls `F0x8008a83c(obj, 0, 10)`; the quad's
// grey level rises 0 -> 0xFF00 over 10 ticks and then holds, so the screen is black
// and STAYS black. Nothing else happens here. `F0x800a7328` (called at
// pro/wfightmn.s .L0x00002174, before the result byte is even read) takes two
// records from `[0x800a4374]` and clears three things, read at pro/wfightmn.s
// .L0x00001548-.L0x00001630: the byte at `0x800a4470 + group*0x20` + 0x1A (the
// group's reserved form), the halfword at `0x80042b1c + group*0x40` + 0x58, and the
// halfword at `0x800a3868 + i*0x1C` on each of the two records. Every store in that
// routine is one of those three; it writes no memory-card record, no money and no
// story flag. Then result byte 2 alone asks the launcher for 0xE00, the title screen.
// See docs/research/battle/battle-loss-decoded-2026-10-02.md, whose step 4 left this
// routine unread; the reads above are from the assembly.
export const LOSE_EFFECT_FRAMES = 0xf0; // F0x8008c93c phase 2 at >= 0xF0 delta units
export const LOSE_FADE_TICKS = 10;      // F0x8008a83c(obj, 0, 10)

/**
 * The loss exit at `frames` delta units (1 per frame) after the defeat beat began:
 * how black the screen is, and whether the battle is over. The fade reaches full
 * black two ticks before the exit, so the launch happens out of black rather than
 * out of a half-faded picture.
 */
export function lossExitFrame(frames) {
  const f = Math.max(0, Number(frames) || 0);
  const fade = f < LOSE_EFFECT_FRAMES ? 0
    : Math.min(1, (Math.floor(f - LOSE_EFFECT_FRAMES) + 1) / LOSE_FADE_TICKS);
  return { fade, finished: f >= LOSE_EFFECT_FRAMES + LOSE_FADE_TICKS + 2 };
}

/**
 * The Blast-on landing heal, decoded from wfightmn F0x800a8bf4 (state 2):
 *
 *   temp_s0->unk8 = temp_s0->unk6;            // hp = maxHP, unconditional
 *   if (temp_s0->unk1C & 4) { ...; temp_s0->unk1C &= 0xFB; }   // clear CONFUSE only
 *
 * The full heal is unconditional; the pending confusion recovery event is
 * cancelled and ONLY the 0x04 bit is cleared. Poison (0x01), Frozen (0x02) and
 * Sleep (0x08) survive a Blast.
 */
export function blastLandingHeal(player) {
  if (!player) return { healed: false, curedConfuse: false };
  const wasHp = player.hp;
  player.hp = player.maxHp;
  let curedConfuse = false;
  if (player.ailments?.confuse) {
    delete player.ailments.confuse;
    curedConfuse = true;
  }
  return { healed: player.hp !== wasHp, curedConfuse };
}

// Max HP/MP for a digimon profile at a level (used both on level-up and on evolution),
// plus the permanent stat-item bonuses. Pure.
export function evolvedMaxStats(profile, level, bonuses) {
  return {
    maxHp: scaledHp(profile, level) + (bonuses?.hp ?? 0),
    maxMp: scaledMp(profile, level) + (bonuses?.mp ?? 0),
  };
}

// Which digivolutions this line can take right now. The disc has EIGHT trees, one
// per roster slot, and its unlock routine picks the tree by slot (0x8008903C) and
// scans that tree's 44 records in table order — never a table keyed by the form the
// member happens to be in. Both the battle report and the Digivolve menus ask the
// one rule in ./evo-trees.js, which is that routine. Nothing here re-indexes them.
//
// `evolutionTrees` and `digimonDB` are the battle's loaded data (both live inside
// createBattle, so they are passed in).
// `member` is { slot, stats }: the roster slot chooses the tree, and the member's
// own ledger, level and stats are the gates. Returns [{ record, index, toName }]
// in table order; a record already in the member's form ledger is left out, exactly
// as the routine's `bgez` skip does.
function treeCandidatesFor(evolutionTrees, digimonDB, member) {
  if (!member?.stats || !evolutionTrees) return [];
  const stats = member.stats;
  const formLevels = Object.fromEntries((stats.formLedger ?? [])
    .map((record) => [Number(record.id), Number(record.formLevel ?? 1)]));
  return unlockedTreeRecords(evolutionTrees, member.slot, {
    formLevels, level: stats.level ?? 1, stats,
  }).map(({ record, index }) => ({
    ...record,
    index,
    toId: record.to,
    toName: digimonDB?.[record.to]?.name ?? null,
  }));
}

// The one form this line learns after this battle: the routine's FIRST passing
// record, and nothing else. Returns the record's target or null.
export function nextUnlockedEvolution(trees, slot, stats) {
  if (!stats) return null;
  const formLevels = Object.fromEntries((stats.formLedger ?? [])
    .map((record) => [Number(record.id), Number(record.formLevel ?? 1)]));
  const hit = firstUnlockedTreeRecord(trees, slot, {
    formLevels, level: stats.level ?? 1, stats,
  });
  return hit ? { ...hit.record, toId: hit.record.to, index: hit.index } : null;
}

// The equipped triple of one roster line, and the auto-equip that fills it.
// Ported from the digivolution unlock routine, pro/stfgtrep.s file 0x369C-0x390C
// (RAM 0x8008634C, overlay base 0x80082CB0):
//
//   0x3888  lw $v0, 0x2738($s5)   ctx+0x2738 = [0x8004B46C] = F0x800176AC
//                                 get_equipped(slot, out) — the valid entries
//                                 (id >= 3) in order, then -1 padding
//   0x3898  move_ $a0, $zr        i = 0
//   0x38A0  lh $v0, ($v1)         out[i]
//   0x38A8  slti $v0, $v0, 0x3    free slot := out[i] < 3
//   0x38AC  bnez $v0, 0x3824      -> write here
//   0x38B0  addiu $a0, 0x1        (delay slot) i + 1
//   0x38B4  slti $v0, $a0, 0x3    else keep going while i + 1 < 3
//   0x3824  move_ $a0, $s4
//   0x3828  sh $s1, ($v1)         out[i] = the new form's value0
//   0x382C  lw $v0, 0x273c($s5)   ctx+0x273c = [0x8004B470] = F0x800177d0
//   0x3834  jalr $v0              set_equipped(slot, out) — writes all three
//
// So the rule is: write into the FIRST slot holding a value < 3, and write the
// whole triple back through set_equipped. A line whose three slots already hold
// forms has no such slot — the loop falls out at 0x38BC/0x38C0, nothing is
// written and nothing is discarded; the routine still returns the new form's
// value0 ($s1 in the delay slot at 0x383C and 0x38C4), so the report line is the
// same either way. The freshly learned form stays in the acquired-form ledger
// (acquire_form at ctx+0x2744 runs before the scan), and the Digimon Lab's
// "Change digivolve type." (enumerate_acquired, F0x80017898 at [0x8004B474],
// gated at four acquired forms) is how the player puts it in a slot afterwards.
export const EQUIP_SLOTS = 3;

export function autoEquipForm(equipped, formId) {
  const current = Array.isArray(equipped) ? equipped : [];
  // get_equipped's view of the line: the entries its ids resolve to (id >= 3),
  // in slot order, then -1 padding.
  const held = current.filter((id) => Number(id) >= 3);
  if (held.length >= EQUIP_SLOTS) {
    // A full triple is left exactly as the player set it.
    return { equipped: current, equippedNow: false };
  }
  held.push(Number(formId));
  return { equipped: held, equippedNow: true };
}

// ── Progression: EXP thresholds, level-up rolls, battle rewards, gym drills ──
// Decoded from stfgtrep.s (exp fn 0x80086184, stat rolls 0x80085e3c, DVEXP 0x80086924/
// 0x800865c0) and stgtrain.s (appliers 0x800861bc/0x800862d0/0x800863d4/0x800865a0).
// Tables come from assets/data/progression.json (tools/extract_progression_tables.py).
// See docs/research/battle/exp-levelup-rewards-decoded-2026-07-10.md.

export const EXPADAPTER_ID = 321; // accessory: +20% EXP  (stfgtrep 0x1dd0 check)
export const BITADAPTER_ID = 322; // accessory: +20% Bits (stfgtrep 0x26c0 check)

// Total EXP that must be EXCEEDED (strict >) to reach `nextLevel`.
export function levelUpThreshold(growthXp, nextLevel, lu) {
  if (nextLevel >= 100) return Infinity;
  const bounds = lu.exp_tier_bounds; // [5, 20, 40, 100]
  let tier = bounds.length - 1;
  for (let i = 0; i < bounds.length; i++) if (nextLevel < bounds[i]) { tier = i; break; }
  const cubic = Math.floor(growthXp * (nextLevel ** 3 + 5 * nextLevel - 6) / 10);
  return cubic + lu.exp_tier_const[tier];
}

// Level after banking `exp` total EXP (may gain several levels; cap 99).
export function levelForExp(currentLevel, exp, growthXp, lu) {
  let lv = currentLevel;
  while (lv < (lu.level_cap ?? 99) && exp > levelUpThreshold(growthXp, lv + 1, lu)) lv++;
  return lv;
}

// Reward share per recipient: solo 100%, pair 60% each, 3+ splits evenly.
export function expShare(base, participants) {
  if (participants <= 1) return base;
  if (participants === 2) return Math.floor(base * 6 / 10);
  return Math.floor(base / participants);
}

// battle_rewards[screen_id] = [dvexp_base, exp_base, bits_base]; all-zero record = none.
// A battle with no id pays nothing (the disc's own record 0 is all-zero), so a missing id
// is a bug in the route that started the fight — say so rather than paying a guess.
export function battleRewardFor(screenId, rewards) {
  if (screenId == null) {
    console.warn("[battle] battle started without a screenId: no EXP/BIT record, so it pays 0");
    return null;
  }
  const r = rewards?.[screenId] ?? null;
  if (!r || (r[0] === 0 && r[1] === 0 && r[2] === 0)) return null;
  return { dvexp: r[0], exp: r[1], bits: r[2] };
}

// What one participant of a won battle is paid, from that record and nothing else: the
// share is 100% solo / 60% each for two / one third each for three (stfgtrep 0x2ce0-0x2d54)
// and the EXP/BIT Adapter accessories add x/5 (0x1dd0 / 0x26c0). No record means 0 EXP and
// 0 BIT — the original awards per BATTLE, never per enemy.
export function winBattleRewards({ screenId, participants = 1, equipment = {}, rewards }) {
  const rw = battleRewardFor(screenId, rewards);
  const share = Math.max(1, participants);
  const boost = (v, id) => (equipment.acc0 === id || equipment.acc1 === id) ? v + Math.floor(v / 5) : v;
  return {
    xp:    boost(expShare(rw?.exp ?? 0, share), EXPADAPTER_ID),
    bits:  boost(rw?.bits ?? 0, BITADAPTER_ID),
    dvexp: rw?.dvexp ?? 0,
  };
}

// Per-form DVEXP gain: level-scaled from the battle's dvexp base, then the party share,
// min 1, capped 10 below the form's DV-level cap (profile byte +0x3c) and 50 at/past it.
export function dvexpGain(base, partnerLevel, participants, formLevel, formCap) {
  const div = Math.min(Math.max(partnerLevel, 1), 50);
  let amt = expShare(Math.floor(base * 10 / div), participants);
  if (amt <= 0) amt = 1;
  return Math.min(amt, formLevel < formCap ? 10 : 50);
}

// One level-up's random stat gains (rolled at the NEW level). The shipped game applies
// these to stored current stats, and so does the walker's stored-stat model below
// (applyLevelUpGains) — joined to stfgtrep 0x80085e3c in STAT-Q002-LEVELUP-STATROLL-JOIN-001.
export function rollLevelUpGains(profile, newLevel, lu, rng = RAND_U16) {
  const g = profile.growth ?? {};
  const tier4 = newLevel < 5 ? 0 : newLevel < 20 ? 1 : newLevel < 40 ? 2 : 3;
  const hpmp = (growth) => growth - lu.hpmp_tier_adj[tier4] + lu.hpmp_rand9[rng() % 9];
  const bounds = lu.core_tier_bounds; // [5, 20, 40, 60, 80]
  let tier6 = bounds.length;
  for (let i = 0; i < bounds.length; i++) if (newLevel < bounds[i]) { tier6 = i; break; }
  const core = {};
  for (const k of ["str", "def", "spt", "wis", "spd", "chr"])
    core[k] = lu.core_table[tier6][(g[k] ?? 0) + rng() % 5] ?? 0;
  const elems = {};
  if (newLevel < (lu.elem_level_limit ?? 41)) {
    for (const k of ["fire", "water", "ice", "wind", "thunder", "machine", "dark"]) {
      // growth 5 + rand 3 indexes one word past the 8-entry table in the original;
      // clamping repeats the tail value instead of reading undefined memory.
      const idx = (profile.resistance_growth?.[k] ?? 0) + rng() % 4;
      elems[k] = lu.elem_table[Math.min(idx, lu.elem_table.length - 1)] ?? 0;
    }
  }
  return { hp: hpmp(g.hp ?? 0), mp: hpmp(g.mp ?? 0), core, elems };
}

// ── Stored-stat model ──
// The shipped game keeps CURRENT stats on the roster record (+0x22 maxHP, +0x26 maxMP,
// +0x28.. core, +0x34.. elems) and mutates them by rollLevelUpGains on level-up and by gym
// drills; nothing re-derives them from the profile. The walker mirrors that with
// ps.stats (core), ps.maxHp/maxMp, and ps.elemBonuses (trained elemental points on top of
// profile.resistances). Old derived-stat saves are migrated by seeding the profile×level
// baseline once (identical totals at seed time).

const CORE_STATS = ["str", "def", "spt", "wis", "spd", "chr"];

// Profile-derived baseline for the core block — used to migrate old saves and to reseed
// on evolution (form change swaps the whole stat body in the walker's model).
export function seedStoredStats(profile, level) {
  const s = {};
  for (const k of CORE_STATS) s[k] = scaledStat(profile, k, level);
  return s;
}

// Seed ps.stats if missing (old save / fresh partner); returns the live block.
export function ensureStoredStats(ps, profile) {
  if (!ps.stats) ps.stats = seedStoredStats(profile, ps.level ?? 1);
  return ps.stats;
}

// Apply one level-up's rolled gains in place (fn 0x80085e3c store semantics: plain adds,
// clamp maxHP/maxMP at 9999 and core/elems at 999; there is NO lower clamp).
export function applyLevelUpGains(ps, gains, lu) {
  const hpmpCap = lu?.hpmp_cap ?? 9999;
  const statCap = lu?.stat_cap ?? 999;
  ps.maxHp = Math.min((ps.maxHp ?? 0) + gains.hp, hpmpCap);
  ps.maxMp = Math.min((ps.maxMp ?? 0) + gains.mp, hpmpCap);
  ps.stats ??= {};
  for (const k of CORE_STATS)
    ps.stats[k] = Math.min((ps.stats[k] ?? 0) + (gains.core[k] ?? 0), statCap);
  const elems = gains.elems ?? {};
  if (Object.keys(elems).length) {
    ps.elemBonuses ??= {};
    for (const k of Object.keys(elems))
      ps.elemBonuses[k] = Math.min((ps.elemBonuses[k] ?? 0) + elems[k], statCap);
  }
  return ps;
}

// DV form level from banked DVEXP (fn 0x800865c0): while L<99 and dvexp >= thr(L), L+=1;
// thr(L) = 10·L below the profile's DV cap, then 10·(cap−1) + 50·(L−cap+1) past it.
export function dvLevelForExp(dvexp, dvCap, levelCap = 99) {
  let lv = 0;
  const thr = (L) => L < dvCap ? 10 * L : 10 * (dvCap - 1) + 50 * (L - dvCap + 1);
  while (lv < levelCap && dvexp >= thr(lv)) lv++;
  return lv;
}

// Gym drill catalog for a gym rank (1..14): [{ drill, primary, secondary }].
export function gymDrillsForRank(rank, gym) {
  return gym.rank_menus[Math.min(Math.max(rank, 1), gym.rank_menus.length) - 1] ?? [];
}

const GYM_CORE_STATS = [null, "str", "def", "spt", "wis", "spd"];
const GYM_ELEM_STATS = [null, null, null, null, null, null, null, null,
                        "fire", "water", "ice", "wind", "thunder", "machine", "dark"];

// A drill's `primary`/`secondary` are the game's own stat ids, and the gym
// screen needs the same mapping to pick which of its result messages to say
// (each message index is a base plus the id). One table, exported, rather than
// a second copy in web/gym.js.
export function gymStatForId(id) {
  if (id >= 1 && id <= 5) return GYM_CORE_STATS[id];
  if (id >= 8 && id <= 14) return GYM_ELEM_STATS[id];
  if (id === 15) return "maxHp";
  if (id === 16) return "maxMp";
  return null;
}

// Resolve one training run into stat deltas. Pure: caller applies them + spends TP.
//   drillEntry = { drill, primary, secondary } (from gymDrillsForRank)
//   tpChoice   = 0/1/2 (TP 1 / TP 5 / TP10), ultra = "Ultra Training Chance" challenge won
//   dig        = { elemGrowth: {fire:1..5,...}, elemCur: {fire:0..999,...} } for brackets
// Returns { tpCost, effects: [{ stat, delta }] } (negative delta = loss; "maxHp"/"maxMp").
export function gymTrainingResult(drillEntry, tpChoice, ultra, dig, gym, rng = RAND_U16) {
  const roll = ([base, range]) => base + (range ? rng() % range : 0);
  const superDrill = drillEntry.drill >= 13;
  const variant = !ultra ? 0 : superDrill ? 2 : 1; // elem/hpmp row variant
  const effects = [];
  const applyEffect = (id, isPrimary) => {
    if (!id) return;
    if (id >= 1 && id <= 5) {
      if (isPrimary) { // core gain (0x8008c304): (super?6:0) + ultra*3 + tpChoice
        const row = gym.core_rows[(superDrill ? 6 : 0) + (ultra ? 3 : 0) + tpChoice];
        effects.push({ stat: GYM_CORE_STATS[id], delta: roll(row) });
      } else if ((rng() & 1) === 0) {
        // core loss (0x8008c364), applier 0x800862d0: only rolled in when rand()&1 == 0
        // (50% of trainings); the store floor-clamps the stat at 0.
        effects.push({ stat: GYM_CORE_STATS[id], delta: -roll(gym.loss_rows[tpChoice]) });
      }
    } else if (id >= 8 && id <= 14) { // elemental gain: bracket by current stat + growth
      const elem = GYM_ELEM_STATS[id];
      const cur = dig?.elemCur?.[elem] ?? 0;
      const bracket = cur < gym.elem_brackets[0] ? 0 : cur < gym.elem_brackets[1] ? 1 : 2;
      const growth = Math.min(Math.max(dig?.elemGrowth?.[elem] ?? 1, 1), gym.elem_ptr.length);
      const table = gym.elem_tables[gym.elem_ptr[growth - 1][bracket]];
      effects.push({ stat: elem, delta: roll(table[variant + tpChoice * 3]) });
    } else if (id === 15 || id === 16) { // maxHP/maxMP gain (0x8008c490)
      const row = gym.hpmp_rows[variant + tpChoice * 3];
      effects.push({ stat: id === 15 ? "maxHp" : "maxMp", delta: roll(row) });
    }
  };
  applyEffect(drillEntry.primary, true);
  applyEffect(drillEntry.secondary, false);
  return { tpCost: gym.tp_costs[tpChoice], effects };
}

// Rep-success percent for the mid-training widget polls (stgtrain helper 0x80086abc,
// call site 0x44d4: percent = v0 + 0x4b): base 75, +3 when TrainingBook (337) sits in
// either accessory slot (native roster +0x3c8/+0x3ca) — checked FIRST, so the book wins
// over the brace — else +6 when PowerBrace (338) does. The bonuses do NOT stack.
export function gymRepPercent(equip) {
  const a = equip?.acc0, b = equip?.acc1;
  if (a === 337 || b === 337) return 78;
  if (a === 338 || b === 338) return 81;
  return 75;
}

// The mid-training rep widget polls (stgtrain rep task F0x800871ac + widget F0x800897b8).
// Each rep = rand%100 <= percent (widget case 4: (unk9C < rand%100) ^ 1). The task starts
// with a 3-rep round (unk18 = 2, set in state 54 F0x80087110); a clean sweep of all three
// triggers the "Ultra Training Chance!" offer (@0x71f0: unk64 && unk68 && unk6c → state 0xA),
// while a SUPER drill (id >= 13, unk60 >= 0xD) that did NOT sweep extends to a 5-rep round
// (unk18 2→4 at 0x71fc). Basic drills always stop at three. Returns the per-rep results for
// the rep-marker row (F0x80086c0c: hit → ring clip 0x45, miss → X clip 0x46).
export function gymRepResults(percent, superDrill = false, rng = RAND_U16) {
  const reps = [0, 1, 2].map(() => rng() % 100 <= percent);
  if (superDrill && !reps.every(Boolean)) {
    reps.push(rng() % 100 <= percent, rng() % 100 <= percent);
  }
  return reps;
}

// "Ultra Training Chance" challenge roll (stgtrain widget 0x7074): rand%100 <= percent,
// percent = 50 (set at 0x513c) — forced to 0 (0x5110) when the drill equals the one the
// LAST won challenge trained (remembered in roster byte +0x3cc), so the same drill can
// never win twice in a row. Win ⇒ ultra tables + remember drill; lose ⇒ "Failed..." +
// normal tables.
export function ultraChanceRoll(drill, lastUltraDrill, rng = RAND_U16) {
  const percent = drill === lastUltraDrill ? 0 : 50;
  return rng() % 100 <= percent;
}

// Total session stat change. DECODED 2026-07-13 (F0x800866cc + F0x80087334): the native
// applies a fresh gain roll PER REP but ONLY on a hit (F0x800866cc computes `slot->unk78`
// / `unk8C` inside `if (result != 0)`), then SUMS every rep slot (F0x80087334 loops all
// five `+0x78`/`+0x8C` into the primary/secondary totals). So the stat change = one
// `gymTrainingResult` roll PER O — an X contributes nothing, and more O's (4th/5th
// attempts) mean a proportionally bigger gain. The bonus/challenge rep, when WON, adds one
// more roll rolled with the ultra tables (F0x80087e18 sets `+0xd8` then applies rep 3);
// a lost challenge (its X) adds nothing. If every rep missed (zero total) the native shows
// "Failed..." (estraini 71, F0x80087334 `arg4==0 && arg5==0` branch).
//   repResults   = the ordinary reps (3, or 5 for a super/starred drill or an "As is" pick)
//   challengeWon = null (no bonus rep) | true (won → +1 ultra roll) | false (lost → nothing)
export function gymSessionResult(drillEntry, tpChoice, repResults, challengeWon, dig, gym, rng = RAND_U16) {
  const totals = new Map();
  const add = (fx) => { for (const { stat, delta } of fx) totals.set(stat, (totals.get(stat) ?? 0) + delta); };
  for (const ok of repResults) if (ok) add(gymTrainingResult(drillEntry, tpChoice, false, dig, gym, rng).effects);
  if (challengeWon === true) add(gymTrainingResult(drillEntry, tpChoice, true, dig, gym, rng).effects);
  return { tpCost: gym.tp_costs[tpChoice], effects: [...totals].map(([stat, delta]) => ({ stat, delta })) };
}

// Apply gymTrainingResult effects to the stored-stat block (store semantics as the
// level-up rolls: maxHp/maxMp cap 9999, core/elems cap 999, core loss floors at 0).
export function applyGymEffects(ps, effects, lu) {
  const hpmpCap = lu?.hpmp_cap ?? 9999;
  const statCap = lu?.stat_cap ?? 999;
  ps.stats ??= {};
  for (const { stat, delta } of effects) {
    if (stat === "maxHp" || stat === "maxMp") {
      ps[stat] = Math.min((ps[stat] ?? 0) + delta, hpmpCap);
    } else if (stat in ps.stats || CORE_STATS.includes(stat)) {
      ps.stats[stat] = Math.min(Math.max((ps.stats[stat] ?? 0) + delta, 0), statCap);
    } else { // elemental gains accumulate on the trained-elemental block
      ps.elemBonuses ??= {};
      ps.elemBonuses[stat] = Math.min((ps.elemBonuses[stat] ?? 0) + delta, statCap);
    }
  }
  return ps;
}

// ── Combat resolvers (module-level so they are headless-portable + unit-testable).
// Closure-independent combat helpers. Ailment application and turn-start lifecycle delegate
// to engine/dw3/battle-combat.ts so the browser does not carry a second implementation.

export const foldElemBonuses = engineFoldElemBonuses;
export const effStats = engineEffStats;
export const resolveAttack = engineResolveAttack;
export const resolveMultiHit = engineResolveMultiHit;
export const weaponSecondaryProc = engineWeaponSecondaryProc;

export const applyAilment = engineApplyAilment;

/**
 * Roll one attack's ailment and instant death against `defender`.
 *
 * Returns `{ text, ail }`. `ail` is the ailment key that landed, which the caller puts up
 * as the battle message box's OWN second page (`ailmentBoxPage`): in the original the
 * damage line and the ailment word are two pages with a Circle press between them, not
 * one sentence (fightstg.s:14624-14626 waits on the damage line's slot, `:14705` then
 * builds the "apply what landed" object, `:15277-15279` waits again before its next page).
 * `text` is only the walker's own fragment for instant death, which is not one of the
 * four ailments and has no ailment page.
 */
export function tryInflict(skill, defender, defenderName, attacker) {
  const ail = engineTryInflict(skill, defender, defenderName, attacker);
  return { text: engineTryInstantDeath(skill, defender, defenderName, attacker), ail };
}

/**
 * THE RESULT-PAGE CHOOSER, on the walker's side of it.
 *
 * `FIGHTSTG_F0x8008cb70` (`~/ddw3/asm/dw2003/pro/fightstg.s:10141-:10656`) is the one
 * routine that decides which line the battle box shows for a blow that has just landed,
 * and it is a port of it that runs here — `engine/dw3/battle-result-page.ts` holds the
 * machine and this is where the walker's own facts are handed to it. The five arms, in the
 * order the original tests them:
 *
 *   multi-hit (queue slot 9) -> kind 16, the "3 X 2 = 45 damage!" page
 *   instant death (queue slot 6) -> NO PAGE. The original zeroes the beaten member's HP,
 *     puts the page object it already allocated into its state 3 — which resets the line
 *     panel — and never asks for a kind (`:10374`-`:10379`). This arm is tested BEFORE
 *     the landed/evaded arms, so it takes the damage line down with it.
 *   Cross Slash (queue slot 35, and that slot belongs to Cross Slash alone) -> kind 4
 *   landed (header +0x30) -> kind 4, the amount the blow did
 *   missed (header +0x30 clear) -> kind 2, `esmfight[0x1d]` "Evade!"
 *
 * `record` is the acting technique's own disc record (or null for a plain attack that has
 * none), `multiHit` is the multi-hit applier having run, `instantDeath` is the
 * instant-death roll having landed (a technique or a signature weapon — both write the same
 * byte), and `landed` is whether a blow connected.
 *
 * The result is `{ choice, page }`: `page` is the message spec for the arm, and is null
 * exactly when the original prints nothing. `?legacyBattleMsg=1` never reaches this — it
 * keeps the walker's own hand-drawn sentence for every case it had before.
 */
export function chooseResultLine({ record = null, multiHit = false, instantDeath = false,
  landed = true, name = null, damage = 0 }) {
  const choice = engineChooseResultPage({
    dispatch: record?.dispatch ?? null,
    multiHit: !!multiHit,
    instantDeath: !!instantDeath,
    landed: !!landed,
  });
  if (choice.silent) return { choice, page: null };
  if (choice.arm === "evade") {
    return { choice, page: evadePageSpec(name) };
  }
  return { choice, page: battleMessagePage(choice.kind, { name, numbers: [damage | 0] }) };
}

/** The evasion page: the defender's name on line one, `esmfight[0x1d]` "Evade!" on line two. */
export function evadePageSpec(name) {
  return battleMessagePage(MSG_KIND.OUTCOME, { index: MSG.EVADE, name });
}

/**
 * The attack-announcement plate: the acting fighter's name on line one and
 * `esmfight[0x08]` "Attack!" on line two (kind 2, payload `[0x08]`).
 *
 * It is the SHARED plate both sides announce through. `FIGHTSTG_F0x80090e84`, the
 * attack-resolution sequencer, builds it for whichever fighter swings
 * (`pro/fightstg.s:14548`-`:14556` writes payload word 0 = 0x08 and asks for kind 2);
 * the walker reached it only from the player's own command confirm, so an enemy's
 * ordinary attack had no plate. Naming is the caller's: the player's confirm passes
 * the player's name, the enemy's action passes the enemy's.
 */
export function attackPageSpec(name) {
  return battleMessagePage(MSG_KIND.OUTCOME, { index: MSG.ATTACK, name });
}

/**
 * The page a landed ailment is put up as, or null when nothing landed.
 *
 * `text` is the walker's own flat sentence for `?legacyBattleMsg=1` and `peek()`;
 * `spec` is the original's own `unkAC(line, 2, payload)` call — line 1 the afflicted
 * Digimon's name, line 2 the game's one word ("Poisoned!" / "Frozen!" / "Confused!" /
 * "Sleep!", `esmfight` 0x1e..0x21, written by FIGHTSTG_F0x80091534's applier arms).
 */
export function ailmentBoxPage(name, ail) {
  if (!ail) return null;
  const spec = engineAilmentInflictMessageSpec(name, ail);
  return spec ? { text: `${name} ${engineAilmentInflictWord(ail)}`, spec } : null;
}

/**
 * Apply a signature weapon's on-hit secondary (decoded 2026-09-13). Runs once
 * per plain attack, after the damage, the way the equipment appliers in
 * F0x8009e0cc run. Returns `{ text, ail }`: `text` is the walker's own flat fragment
 * for the legacy box, and `ail` is the ailment key that landed, which the caller puts up
 * as its own page the way a skill's ailment is (`ailmentBoxPage`).
 */
export function applyWeaponSecondary(attacker, defender, defenderName, damage = 0, attackerName = "") {
  const sec = engineWeaponSecondaryProc(attacker, defender, attacker.rightWeapon, RAND_U16);
  const drain = sec ? 0 : engineWeaponDrainHeal(attacker, attacker.rightWeapon, damage, RAND_U16);
  if (drain > 0) {
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + drain);
    const recovered = attacker.hp - before;
    // The original prints the weapon's HP drain as its own page: FIGHTSTG_F0x80091534's
    // opcode 12 arm caps the amount at the defender's own remaining pool
    // (fightstg.s:15008-15026) and asks for **kind 18** (`:15055`), whose arm
    // `.L0x80099f00` is line one `esmfight[0x16]` the name, line two `esmfight[0x22]`
    // `{1}HP healed!` (`:23988 li $a2, 0x22`) and the amount in slot 1. `payload[2]` is
    // zero on this arm, so the alternate `esmfight[0x8f]` `{1} MP absorbed!`
    // (`:23997 li $a2, 0x8f`) is NOT taken — that is the opcode-32 MP drain, which the
    // walker has no event for.
    return {
      text: recovered > 0 ? ` Drained ${recovered} HP!` : "",
      ail: null,
      ko: false,
      page: recovered > 0
        ? battleMessagePage(18, { name: attackerName, numbers: [recovered] })
        : null,
    };
  }
  if (!sec) return { text: "", ail: null, ko: false, page: null };
  if (sec.kind === "ko") {
    defender.hp = 0;
    // The walker's own words. The original's box prints NOTHING for an instant-death
    // KO — the result-page chooser's second arm — and `ko: true` is how the caller
    // learns that so it can ask the chooser instead of reading these words.
    return { text: ` ${defenderName} was struck down!`, ail: null, ko: true, page: null };
  }
  engineApplyAilment(defender, sec.kind, { effect_p2: sec.magnitude }, attacker, RAND_U16);
  // The original names the ailment with the game's own word (esmfight 0x1e/0x1f/0x20,
  // FIGHTSTG_F0x80091534's applier arms), as a page of its own.
  return { text: ` ${engineAilmentInflictWord(sec.kind)}`, ail: sec.kind, ko: false, page: null };
}

export const processTurnStart = engineProcessTurnStart;

// ---------------------------------------------------------------------------
// The category-4 arm of the technique record machine, on both sides of a battle.
//
// THE SHARED SYSTEM. `FIGHTSTG_F0x8008f714`'s category-4 handler is one routine,
// `0x8008fbec` (~/ddw3/asm/dw2003/pro/fightstg.s:13269-:13664), with six arms picked by
// its own five id comparisons (:13272-:13290). It is NOT a converted copy with hand
// rows: `engine/dw3/battle-damage-terms.ts` holds the port, and everything below calls it.
//
// THE PARTY SLOTS. The original keeps three 0x20-stride combatant records per side. The
// player's base is `0x800a4470` and the enemy's is `0x800a44d0`: `FIGHTSTG_F0x8008f5d4`
// builds the player base outright (`addiu $s6, $v0, 0x4470` at pro/fightstg.s:12883), the
// cure window builds it into `$s3` (:13340) and then walks `side * 0x60` off it (:13336-:
//13338, :13630), technique 100 hard-codes it (`addiu $a0, $v0, 0x4470` :13443), and the
// heal arm's ENEMY base is built on the spot (`addiu $s1, $v0, 0x4470` :13505 / `addiu $s1,
// 0x60` :13506). Inside one record: `+0x00` "this slot holds a Digimon" (`lh $v0, ($a0)`
// :13528), `+0x06` maximum HP (`lhu $v0, 0x6($a0)` :13536), `+0x08` current HP
// (`lh $v1, 0x8($a0)` :13532) and `+0x1c` the ailment bitmask (`lbu $v1, 0x1c($a2)` :13385
// on the cure window). The walker maps the player's three to `b.playerRecords[0..2]` — the
// same order `partyPipCels` reads for the plate's three party pips — and the enemy's side
// to its single active fighter, which is record 0. THE ENEMY SIDE IS A KNOWN LIMIT: the
// walker has no two more enemy records to fill slots 1 and 2, so a party-wide enemy-side
// heal touches the one fighter it models, and 100 / 375 restore the PLAYER's party
// because that arm hard-codes side 0.
//
// A CAVEAT I DID NOT RESOLVE: on the heal arm the enemy base is rebuilt for side 1 but
// NOT for side 0 — `beqz $v1, .L0x8008ffa4` :13504 skips :13505-:13506, so the side-0 walk
// uses whatever `$s1` the caller left (this routine's own prologue at :12958-:12968 only
// SAVES `$s1`, it never sets it). Every other arm in the handler walks `0x800a4470`
// explicitly, so the port uses the player base for side 0; that is an inference from the
// other arms, not something the instruction stream states for this one.
//
// NO ACCURACY ROLL. The applier `FIGHTSTG_F0x8009e0cc` reads the record's category byte
// at :28463 `lbu $v1, 0x4($s4)` and branches to the accuracy getters for categories 2 and 3
// only (:28465 / :28467), sending EVERY other category — category 4 included — to
// `.L0x8009e3c8` (:28468-:28470), which makes no roll. So a heal or a cure cannot miss and
// nothing here calls `resolveAttack`.

/** One side's three original combatant records, as the walker's own party members. */
export function battleRestoreParty(b, side) {
  if ((side | 0) < 1) {
    const records = b?.playerRecords ?? [];
    return [0, 1, 2].map((i) => {
      const rec = records[i];
      return rec
        ? { present: true, hp: rec.hp | 0, maxHp: rec.maxHp | 0, ailments: battleAilmentByte(rec) }
        : { present: false, hp: 0, maxHp: 0, ailments: 0 };
    });
  }
  const en = b?.enemy;
  return [0, 1, 2].map((i) => (i === 0 && en
    ? { present: true, hp: en.hp | 0, maxHp: en.maxHp | 0, ailments: battleAilmentByte(en) }
    : { present: false, hp: 0, maxHp: 0, ailments: 0 }));
}

/** The walker's own records for one side, in the original's slot order. */
export function battleRestoreTargets(b, side) {
  if ((side | 0) < 1) {
    const records = b?.playerRecords ?? [];
    return [0, 1, 2].map((i) => records[i] ?? null);
  }
  return [b?.enemy ?? null, null, null];
}

/**
 * Clear the ailment bits `mask` names off one of the walker's own records.
 *
 * `FIGHTSTG_F0x8009c330` clears them in place with `nor $v0, $zr, $v0` / `and $v1, $v0` /
 * `sb $v1, 0x1c($a2)` (pro/fightstg.s:26421 / :26422 / :26425), and the all-ailments cure
 * `FIGHTSTG_F0x8008f5d4` zeroes the whole byte with `sb $zr, 0x1c($s0)` (:12933). The
 * walker keeps ailments by name AND, when a record carries them, the raw `+0x1c` byte in
 * `statusBits` — so both are cleared here, or the two representations would drift apart.
 */
function clearRestoreAilments(rec, mask) {
  if (!rec || !mask) return;
  const a = rec.ailments;
  if (a) {
    if (mask & 0x01) delete a.poison;
    if (mask & 0x02) delete a.frozen;
    if (mask & 0x04) delete a.confuse;
    if (mask & 0x08) delete a.sleep;
  }
  if (Number.isInteger(rec.statusBits)) rec.statusBits &= ~mask & 0xff;
}

/**
 * Run one category-4 restore plan on the walker's own records and report what moved.
 *
 * The plan is the port's, so this only translates the port's per-slot numbers back into
 * the walker's records. Returns the slot indices whose HP actually rose.
 */
export function applyBattleRestorePlan(b, side, plan) {
  const targets = battleRestoreTargets(b, side);
  const healed = [];
  for (let i = 0; i < targets.length; i++) {
    const rec = targets[i];
    if (!rec) continue;
    const before = rec.hp | 0;
    if (plan?.fullRestore?.[i]) {
      rec.hp = rec.maxHp | 0;
    } else if ((plan?.heal?.[i] | 0) > 0) {
      rec.hp = Math.min(rec.maxHp | 0, before + (plan.heal[i] | 0));
    }
    clearRestoreAilments(rec, plan?.cure?.[i] | 0);
    if (plan?.regen && i === ((b?.activePlayerIndex ?? 0) | 0) && (side | 0) < 1) {
      rec.regeneration = true;
    }
    if ((rec.hp | 0) > before) healed.push(i);
  }
  return healed;
}

/**
 * The record machine's per-action clear of the charge byte, on the acting side.
 *
 * ONE shared rule, ported from the assembly rather than per technique, and it is the
 * reason a Digimon can throw its own charge away. `FIGHTSTG_F0x8008f714` runs for all
 * five attack categories; its **state 1, sub-state 0** (`pro/fightstg.s:193
 * .L0x80082fdc: .word 0x8008f8b4`, the first row of its own sub-state table) puts up the
 * announcement page and then stores `sh $zr, 0xe($v0)` at `:13092` — in the `j`'s delay
 * slot, so it always runs once the battle message box is free (`:13063 lw $v0, ($s6)` /
 * `:13065 bnez $v0, .L0x80090c1c`). It has **no category test**, so a technique that deals
 * no damage at all still clears the byte, and it runs *before* sub-state 1, the category
 * handler that the charge arms write from (`:13875`, `:14016`).
 *
 * So the walker clears on the two no-damage gates — the category-5 charge arms and the
 * category-4 heal/cure family — and the damaging categories keep the engine's
 * `consumeAffinity` inside `resolveAttackSequence`, which is the original's order (state 0
 * reads the byte into the effective block, state 1 sub-state 0 clears it). Calling this
 * before the resolver instead would break the multiplier, which is why it is not called
 * from the top of the action.
 *
 * `0x800a4436` (`ctx+0x42`) is the only flag that can skip that clear
 * (`pro/fightstg.s:13067` / `:13069`) and nothing in the disc ever sets it, so the walker
 * does not model a path that never runs.
 *
 * Returns the byte that was cleared, exactly as `consumeAffinity` does.
 */
export function clearActionAffinity(b, side) {
  const s = (side | 0) < 1 ? 0 : 1;
  const activeSlot = s < 1 ? ((b?.activePlayerIndex ?? 0) | 0) : 0;
  const rec = battleRestoreTargets(b, s)[activeSlot];
  return consumeAffinity(rec);
}

/**
 * What one category-4 technique does, with the record machine's own arms, on one side.
 *
 * Returns null when the technique is not a category-4 member, so a caller can use it as
 * the gate: that null IS the "this technique is an ordinary attack" answer.
 */
export function battleRestorePlanFor(b, side, record, techniqueId, options = {}) {
  if ((record?.category | 0) !== 4) return null;
  // The record machine's state-1 sub-state-0 clear runs BEFORE this category handler and
  // has no category test (`pro/fightstg.s:13092 sh $zr, 0xe($v0)`), so a heal throws the
  // acting fighter's own charge away even though a heal never reads it.
  clearActionAffinity(b, side);
  const sides = {
    0: battleRestoreParty(b, 0),
    1: battleRestoreParty(b, 1),
  };
  const activeSlot = (side | 0) < 1 ? ((b?.activePlayerIndex ?? 0) | 0) : 0;
  const actor = battleRestoreTargets(b, side)[activeSlot];
  const plan = category4RestorePlan(record, techniqueId | 0, {
    side: side | 0,
    wisdom: Number(options.wisdom ?? actor?.wis ?? 0),
    activeSlot,
    name: options.name ?? null,
  }, sides);
  if (!plan) return null;
  // `arm.side` is where the ORIGINAL acts, which for 100 and 375 is the player's party
  // whichever side cast them (`sw $zr, 0x64($s4)` and `addiu $a0, $v0, 0x4470`).
  plan.healed = applyBattleRestorePlan(b, plan.side, plan);
  return plan;
}

/**
 * THE WHOLE CATEGORY-5 FAMILY — one call per technique, both sides of a battle.
 *
 * THE SHARED SYSTEM. `FIGHTSTG_F0x8008f714`'s category-5 handler `0x8009021c`
 * (`~/ddw3/asm/dw2003/pro/fightstg.s:13665`-`:14028`) is ONE routine with EIGHT arms, and
 * its whole classifier is nine comparisons on the technique id (`:13670`-`:13712`). Every
 * category-5 record in the shipped 443-row table lands on exactly one of them: 198..208
 * through the two eight-byte stat tables at `.L0x800a33cc` and `.L0x800a3414`, 209/210,
 * 211, 212, 391, 392 and 400 through the six compares below them. It is NOT a converted
 * copy with hand rows: `engine/dw3/battle-damage-terms.ts` holds the port
 * (`DAMAGE_TERM_ARMS_CATEGORY5`, `category5Plan`, `damageTermStatModifier`,
 * `damageTermMpMoved`) and every line is quoted there, so there is no per-technique
 * branch in this file — the arm is decided by the table and the plan by
 * `category5Plan`.
 *
 * WHAT EACH ARM DOES, in the words a player meets:
 *
 *   * `.L0x800902dc` — **198, 200, 202, 204..208** (Double Power, Double Guard, Speed
 *     Up, Lovely Charm, Armor Break, Armor Off, Slow Down, Mega Break): one stat on one
 *     fighter. The row's `+0x2` is the direction, `+0x4` the stat (0 attack / 1 defense /
 *     2 speed) and the magnitude is `direction * record[+0x0C]` (`:13759 mult` /
 *     `:13770 mflo`), so 198 adds 48/128 of the target's attack, 205 takes 24/128 of its
 *     defense and 208 takes 32/128 of its speed. The write is the target's own record
 *     halfword at `+0x10 + 2*stat` through `FIGHTSTG_F0x800a1aa8`
 *     (`:13768 lw $v0, 0x4664($v0)` / `:13771 jalr $v0`), and `damageTermStatModifier`
 *     is that routine's own arithmetic. A `[arrow-down]` row XORs the side with 1
 *     (`:13738 xor $s2, $a0`) so it lands on the FAR side, and reads the per-encounter
 *     gate byte `0x80042b1c + stat + 0x46` (`:13743`): a nonzero byte answers
 *     `esmfight[0x2f]` "No effect!" through kind 1 and touches nothing.
 *   * `.L0x800903f4` — **199, 201, 203** (Mega Strength, Mega Protection, Mega Boost):
 *     the same stat on every living slot of the acting side, through the same routine,
 *     and a kind-9 page.
 *   * `.L0x80090528` — **209, 210** (Soul Charge, Misshukikou): the charge byte in the
 *     target's record `+0x0E`, which the damage tail's stage 3 multiplies by
 *     (`engine/dw3/battle-damage-terms.ts::consumeAffinity` spends it), and
 *     `esmfight[0x36]` "Saving Chi!".
 *   * `.L0x80090584` — **211** (Capture Beam) and `.L0x800905c8` — **212** (Hold Beam):
 *     a `(rand & 0x7f) < 80` roll, then the no-flee / no-digivolve lock and
 *     `esmfight[0x44]` / `esmfight[0x45]`. A lost roll says **"No effect!"** on line one:
 *     `li $v0, 0x2f` is in the delay slot of the roll's `beqz` (pro/fightstg.s:13889 and
 *     :13907), and the branch's own target stores it (:13896 / :13914) before asking
 *     kind 1.
 *   * `.L0x80090610` — **391** (Helter Skelter): the same roll at 96/128, and a landed
 *     roll puts up NO page at all (`:13930` writes 3 into the panel's own `+0xc`). Its
 *     getter is NOT the other two's: `FIGHTSTG_F0x800a13c0` first walks eight
 *     `DIGIMON_PROFILES` rows against the player's active record `+0x10` and answers zero
 *     on a match without drawing (:31761-:31774), so a blocked cast draws nothing.
 *   * `.L0x80090654` — **392** (Vampire Jewel): MP moved OFF the player's active fighter
 *     ONTO the enemy's — the two sides are hard-coded (`:13938` reads the enemy's active
 *     index, `:13939` the player's), so this arm does not walk the party. A source with no
 *     MP answers "No effect!" through **kind 2** with 0x10 in word 1 (`:13946` jumps to
 *     `:13989`, whose delay slot loads 0x2f and whose tail asks kind 2 at `:14022`).
 *   * `.L0x80090734` — **400** (Gilead Plant): HP restored on the enemy's active fighter
 *     (`:14006 sh $v0, 0x8($s0)`, capped at `+0x06` at `:14010`-`:14014`) and its charge
 *     byte set to the literal 32 (`:14015`-`:14016`). The heal's amount comes from
 *     **record 400's own power**: the branch that reaches this arm leaves `$a1` at 400
 *     (`:13710 li $a1, 0x190`, the `beq`'s delay slot) and the getter indexes the record
 *     by `$a1`, so the amount is `400's power * 64 + wisdom` — the shipped table's 8 and
 *     not some other record's.
 *
 * WHEN THE CHARGE IS SPENT — read out of the assembly, not out of the technique's wording.
 * `FIGHTSTG_F0x8008f714` computes an action's damage in its **state 0** (`:13000 jalr
 * $v0`, the resolver `F0x8009e0cc` through the pointer at `0x800a445c`, which is what reads
 * the byte into the effective block) and clears the byte in its **state 1, sub-state 0**
 * (`:13092 sh $zr, 0xe($v0)`), which also runs *before* sub-state 1 — the category handler
 * these arms live in. So the action that sets the byte never spends it, the acting
 * fighter's NEXT action spends it (a technique or a plain attack alike — categories 2 and
 * 3 share state 0), and an action that computes no damage still clears it. The engine's
 * `consumeAffinity` is that one clear: `resolveAttackSequence` calls it on the damaging
 * categories, and `clearActionAffinity` calls it on the two no-damage gates.
 *
 * The clear runs HERE, ahead of every arm, which is what the original does and what makes
 * Gilead Plant interesting: its write lands on the ENEMY record, so the charge the acting
 * fighter threw away is the enemy's, not its own.
 *
 * `null` means "this technique is not a category-5 member", so a caller can use it as the
 * gate the way `battleRestorePlanFor` is used for category 4.
 */
export function battleScriptedPlanFor(b, side, record, techniqueId, options = {}) {
  const id = techniqueId | 0;
  if ((record?.category | 0) !== 5) return null;
  const arm = damageTermCategory5Arm(id);
  if (!arm) return null;
  // State 1, sub-state 0, ahead of this category handler and with no category test
  // (`pro/fightstg.s:13092`). It matters for Gilead Plant: that arm hard-codes the ENEMY
  // record, so the clear on the ACTING side is not overwritten by the write below.
  clearActionAffinity(b, side);
  const acting = (side | 0) < 1 ? 0 : 1;
  const targetSide = damageTermCategory5Side(arm, acting, category5Row(arm, id));
  const activeSlot = acting < 1 ? ((b?.activePlayerIndex ?? 0) | 0) : 0;
  const targetRec = battleRestoreTargets(b, targetSide)[activeSlot] ?? null;
  const targets = category5Targets(b, targetSide, arm);
  // The three arms that roll: `(rand & 0x7f) < record[+0x0B]`, the threshold being the
  // technique record's own `f8` byte (the extractor's name for `+0x0B`).
  // The three arms that roll draw INSIDE the arm, exactly as `jalr rand` does at
  // fightstg.s:31861 — so a technique of any other arm never spends a draw, and the
  // walker's own random order is the original's. A caller may hand the draw in instead.
  const rolls = arm.effect === "lockFlee" || arm.effect === "lockDigivolve" ||
    arm.effect === "statusOnly";
  // The status-only arm's getter is FIGHTSTG_F0x800a13c0, and it walks eight
  // DIGIMON_PROFILES rows against the PLAYER's active record `+0x10` BEFORE it draws
  // (pro/fightstg.s:31761-:31774; a match answers `move_ $v0, $zr` in the `bne`'s delay
  // slot at :31771). A match spends no random number at all, so a blocked cast must not
  // take a draw either.
  const rollBlocked = arm.effect === "statusOnly"
    && damageTermStatusRollBlocked(playerActiveAttackModifier(b));
  const roll7 = options.roll7 ?? (rolls && !rollBlocked ? (RAND_U16() & 0x7f) : 0);
  const rollLanded = options.rollLanded ?? (rolls && damageTermRoll(record.f8 ?? 0, roll7));
  const rollStatusLanded = rollBlocked ? false
    : (options.rollStatusLanded ?? rollLanded);
  const playerRec = b?.player ?? null;
  const enemyRec = b?.enemy ?? null;
  const plan = category5Plan(record, id, {
    side: acting,
    name: options.name ?? null,
    roll7,
    rollLanded,
    rollStatusLanded,
    targets,
    // The raw 0x80042b58..0x80042b65 encounter bytes the factory stores on `b`. The
    // stat-down gate reads 0x80042b62..0x80042b64, i.e. indexes 10..12 of that run.
    gateBytes: encounterGateBytes(b),
    sourceMp: playerRec?.mp ?? 0,
    sourceMaxMp: playerRec?.maxMp ?? 0,
    destMp: enemyRec?.mp ?? 0,
    destMaxMp: enemyRec?.maxMp ?? 0,
    targetHp: enemyRec?.hp ?? 0,
    targetMaxHp: enemyRec?.maxHp ?? 0,
    healWisdom: actingFighterWisdom(b, acting),
    playerActiveAttackModifier: playerActiveAttackModifier(b),
    affinityBefore: targetRec?.affinity ?? 0,
  });
  if (!plan) return null;
  applyCategory5Plan(b, plan, {
    activeSlot, playerRec, enemyRec, targetRec, targets: battleRestoreTargets(b, targetSide),
    recordMagnitude: record.crit | 0,
  });
  return {
    ...plan,
    slot: activeSlot,
    /** The charge byte this arm wrote, for the tests and the legacy sentence. */
    byte: plan.affinity ?? 0,
    charged: plan.affinity !== null && !!targetRec,
    /** Kept for the charge arms' callers: the byte the target already held. */
    replaced: plan.affinityBefore,
    /** What actually changed, in the walker's own records. */
    changed: {
      stats: plan.stats.length,
      affinity: plan.affinity,
      mpMoved: plan.mpMoved | 0,
      heal: plan.healAmount | 0,
      locked: plan.effect === "lockFlee" ? "flee"
        : plan.effect === "lockDigivolve" ? "digivolve" : null,
    },
    page: plan.page,
  };
}

/**
 * The charge arms only — the 2026-10-04 entry point, kept as a VIEW over the whole
 * family so its proof (`tests/battle-affinity-stage.test.js`) still measures what it
 * measured. It returns null for every other category-5 arm, which is exactly the
 * question it was written to answer: "does this technique charge anybody?"
 */
export function battleAffinityPlanFor(b, side, record, techniqueId, options = {}) {
  const plan = battleScriptedPlanFor(b, side, record, techniqueId, options);
  if (!plan) return null;
  return plan.effect === "affinity" || plan.effect === "healCharge" ? plan : null;
}

/**
 * The per-encounter gate bytes the category-5 debuffs read, in the original's order.
 *
 * `lbu $v0, 0x46($v1)` at `pro/fightstg.s:13743` reads `0x80042b1c + stat + 0x46`, and
 * `0x80042b62..0x80042b64` are three of the fourteen bytes the battle setup copies out of
 * the selected screen's own record (`0x80042b58..0x80042b65`, `battleConfig.raw_2b58_2b65`,
 * which `web/battle.js` already keeps on the battle object). Index 0 here is `0x80042b62`.
 */
function encounterGateBytes(b) {
  const raw = b?.encounterGateBytes;
  if (!Array.isArray(raw)) return [];
  return [0, 1, 2].map((i) => (Number(raw[10 + i]) | 0) & 0xff);
}

/**
 * The slots one category-5 arm may touch, as the original's own gate reads them.
 *
 * `FIGHTSTG_F0x800a1aa8` skips an empty record (`lh $v0, ($v1)` / `beqz` at `:32250` /
 * `:32252`) and a fallen one (`lh $v0, 0x8($v1)` / `beqz` at `:32254` / `:32256`), and the
 * party arm reads those same two fields 0x10 below its own base (`:13825` / `:13829`). The
 * effective value each row needs is the target's own `effStats()` for that stat, which is
 * the block the arm reads at `+0x02 + 2 * .L0x800a4694[stat]`.
 */
function category5Targets(b, targetSide, arm) {
  const stat = damageTermStatRowId(arm);
  if (stat === null) return [];
  const slots = arm.effect === "statParty" ? [0, 1, 2] : [activeSlotOf(b, targetSide)];
  const out = [];
  for (const slot of slots) {
    const rec = battleRestoreTargets(b, targetSide)[slot] ?? null;
    if (!rec) continue;
    const modifier = statModifier(rec, stat);
    out.push({
      slot,
      species: rec.profile?.id ?? 1,
      hp: rec.hp | 0,
      // The CLEAN value, which is what the original measures the delta from: the
      // effective block already carries the modifier (F0x8009ec94 adds record
      // `+0x10 + 2*stat`), and FIGHTSTG_F0x800a1aa8 takes it back OFF first when it is
      // nonzero (`lh $v0, 0x10($a1)` / `beqz` :32259-:32261, then `subu $v0, $a0` /
      // `sh $v0, 0x2($v1)` :32271-:32272) — so a second cast of the same technique adds
      // the same number again instead of compounding on itself.
      effective: statValue(rec, stat) - modifier,
      modifier,
    });
  }
  return out;
}

function activeSlotOf(b, side) {
  return (side | 0) < 1 ? ((b?.activePlayerIndex ?? 0) | 0) : 0;
}

/**
 * The PLAYER's active fighter's record `+0x10`, the ATTACK MODIFIER — the halfword
 * `FIGHTSTG_F0x800a13c0` (391's own roll getter) compares against the first eight
 * `DIGIMON_PROFILES` rows: `lw $v0, 0x8($v1)` at pro/fightstg.s:31761 reads the player's
 * active index, `sll $v0, 0x5` / `addu $v0, $v1` at :31763-:31764 make the record, and
 * `lh $v1, 0x10($v0)` at :31765 reads `+0x10`. Whichever side casts, it is the PLAYER's
 * record the getter walks.
 */
function playerActiveAttackModifier(b) {
  const rec = battleRestoreTargets(b, 0)[activeSlotOf(b, 0)];
  return statModifier(rec, 0);
}

/** The acting side's active fighter's WIS, the getter's own second operand. */
function actingFighterWisdom(b, actingSide) {
  const slot = activeSlotOf(b, actingSide);
  const rec = battleRestoreTargets(b, actingSide)[slot];
  return rec ? engineEffStats(rec).wis : 0;
}

/** The stat index the arm's row addresses, or null when the arm has no row. */
function damageTermStatRowId(arm) {
  const row = DAMAGE_TERM_STAT_ROWS.find((r) => arm.ids.includes(r.id));
  return row ? row.stat : null;
}

/** The row this arm's technique id addresses, or null when it has none. */
function category5Row(arm, techniqueId) {
  return DAMAGE_TERM_STAT_ROWS.find((r) => r.id === (techniqueId | 0)) ?? null;
}

/** The stat the arm changes, 0 attack / 1 defense / 2 speed, for one record. */
function statValue(rec, stat) {
  const values = engineEffStats(rec);
  return [values.str, values.def, values.spd][stat] | 0;
}

/** One record's own modifier for that stat — the walker's `statMods`, absent is 0. */
function statModifier(rec, stat) {
  return [rec?.statMods?.str ?? 0, rec?.statMods?.def ?? 0, rec?.statMods?.spd ?? 0][stat] | 0;
}

function setStatModifier(rec, stat, value) {
  if (!rec) return;
  const key = ["str", "def", "spd"][stat];
  const mods = rec.statMods ?? { str: 0, def: 0, spd: 0 };
  mods[key] = value | 0;
  rec.statMods = mods;
}

/**
 * Advance the battle's status-event pool by one action and apply every expiry.
 *
 * The original has no frame tick for this system: `FIGHTSTG_F0x8009ba4c`
 * (`pro/fightstg.s:25779`) picks the queued entry with the smallest `+0x2`, subtracts
 * that time from every other entry, and hands the fired code back. Each action
 * resolution re-enqueues the turn event with `[0x800a437c](side, 0)`
 * (`pro/wfightmn.s:4090`-`:4098`), so the distance one action covers IS the opcode-0
 * delay -- `trunc(1000 * opp.SPD / isqrt(own.SPD * opp.SPD))`, clamped to `[707, 1414]`
 * (`pro/fightstg.s:26168`-`:26294` and the triple at `:34855`). The expiry itself is the
 * original's: a stat code puts the record's modifier halfword back to zero
 * (`sh $zr, 0x10($v1)` `pro/wfightmn.s:2816`) and a lock code clears its `+0x1c` bit
 * (`lbu $v1, 0x1c($a1)` / `addiu $v0, 0x4` / `sllv $v0, $a2, $v0` / `nor $v0, $zr, $v0`
 * / `and $v1, $v0` / `sb $v1, 0x1c($a1)` `pro/wfightmn.s:2743`-`:2773`).
 *
 * Exported so the category-5 tests can drive one action without the whole battle loop.
 */
export function battleStatusEventAdvance(b) {
  const pool = b?.statusEvents;
  if (!pool || pool.length !== STATUS_EVENT_POOL_SIZE) return [];
  // The original asks for the delay with the PLAYER side's byte whatever acted
  // (`move_ $a0, $zr` in the `jalr` delay slot, `pro/wfightmn.s:1210`), and the routine's
  // numerator is that side's own effective SPD (`lh $v0, 0xa($a3)` `:26284`), with the
  // other side only feeding the `isqrt` seed (`:26238`). So this is not per-acted-side.
  const expiries = advanceStatusEvents(
    pool, statusEventActionDelay(b.player?.spd | 0, b.enemy?.spd | 0));
  for (const expiry of expiries) {
    if (expiry.kind === "stat" || expiry.kind === "lock") {
      const records = battleRestoreTargets(b, (expiry.side | 0) < 1 ? 0 : 1);
      const rec = records[expiry.slot | 0];
      if (!rec) continue;
      if (expiry.kind === "stat") {
        const key = ["str", "def", "spd"][expiry.stat ?? 0];
        const mods = rec.statMods ?? { str: 0, def: 0, spd: 0 };
        mods[key] = 0;
        rec.statMods = mods;
      }
      if (expiry.lock === 0) rec.cantFlee = false;
      if (expiry.lock === 1) rec.cantDigivolve = false;
      continue;
    }
    // The record an entry names is the side byte it was queued with and its slot. The
    // walker's two sides are one fighter each, so the slot is the walker's own side slot.
    const target = battleAilmentTarget(b, expiry.side | 0, expiry.slot | 0);
    if (expiry.kind === "poison") {
      // `FIGHTSTG_F0x8009c7d4`'s entry KEEPS its slot: `0x800a3800`'s word for code 0x09 is
      // `-1`, so `FIGHTSTG_F0x8009ba4c` fires it and leaves it queued with its time spent,
      // and the consumer machine re-arms it — `li $v0, 0x3e8` in the `j`'s delay slot
      // `sh $v0, 0x2($s1)` (`pro/wfightmn.s:2607`-`:2609`). That is the poison's period.
      if (!target || target.hp <= 0) continue;
      const fields = poisonDefenceFieldsOf(target);
      const amount = enginePoisonTimelineDamage(
        target.maxHp, target.ailments.poison?.power ?? 0, fields.water, fields.poisonResistance);
      target.hp = Math.max(0, target.hp - amount);
      const entry = pool.find((e) => e.code === 0x09
        && (e.side | 0) === (expiry.side | 0) && (e.slot | 0) === (expiry.slot | 0));
      if (entry) entry.time = 1000;
      b._poisonTick = { combatant: target, amount };
      continue;
    }
    if (expiry.kind !== "ailment") continue;
    // The recovery came due, so the ailment is over. That is the disc's rule in the other
    // direction too: `FIGHTSTG_F0x8009c330` frees the entry and clears the record's `+0x1c`
    // bit together (`pro/fightstg.s:26421`-`:26443`).
    if (!target || !target.ailments?.[expiry.ailment]) continue;
    delete target.ailments[expiry.ailment];
    b._ailmentCures = (b._ailmentCures ?? []).concat([
      { combatant: target, ailment: expiry.ailment },
    ]);
  }
  return expiries;
}

/** The combatant a pool entry names, or null when the walker's one-per-side model has none. */
function battleAilmentTarget(b, side, slot) {
  void slot;
  if ((side | 0) < 1) return b?.player ?? null;
  return b?.enemy ?? null;
}

/** The poison formula's two inputs, the same pair `advanceAilmentTimeline` used to read. */
function poisonDefenceFieldsOf(c) {
  const eStats = c.eStats;
  const water = c.statusResists?.water ?? eStats?.status_resist?.water ?? 0;
  const poisonResistance = c.statusResists?.poison
    ?? eStats?.status_resist?.poison ?? 0;
  return { water: water | 0, poisonResistance: poisonResistance | 0 };
}

/**
 * Write one decided category-5 plan onto the walker's own records.
 *
 * Every line here is the record offset the arm's instruction stream writes; which arm
 * writes what is `category5Plan`'s decision, not this function's.
 */
function applyCategory5Plan(b, plan, ctx) {
  const { playerRec, enemyRec, targetRec, targets } = ctx;
  // Each change names ITS OWN slot: the party arm writes every living record of the side
  // (`.L0x800903f4`'s walk, `:13857 addiu $s1, 0x1` / `:13858 slti $v0, $s1, 0x3`), so a
  // single-slot target would put the partner's number on the leader.
  for (const change of plan.stats) {
    setStatModifier(targets?.[change.slot] ?? targetRec, change.stat, change.modifier);
  }
  if (plan.effect === "affinity" || plan.effect === "healCharge") {
    if (targetRec && plan.affinity !== null) targetRec.affinity = plan.affinity;
  }
  if (plan.effect === "mpDrain" && playerRec && enemyRec) {
    const moved = plan.mpMoved | 0;
    if (moved > 0) {
      playerRec.mp = Math.max(0, (playerRec.mp | 0) - moved);
      enemyRec.mp = Math.min(enemyRec.maxMp | 0, (enemyRec.mp | 0) + moved);
    }
  }
  if (plan.effect === "healCharge" && enemyRec) {
    // `sh $v0, 0x8($s0)` :14033 adds the getter's amount to the enemy's record `+0x08`,
    // and the `beqz`'s DELAY slot :14045 puts `+0x06` (the maximum) back when the sum
    // overshot it — so the cap is the enemy's own maximum HP.
    const before = enemyRec.hp | 0;
    enemyRec.hp = Math.min(enemyRec.maxHp | 0, before + (plan.healAmount | 0));
  }
  // THE TWO LOCKS ARE TIMED EVENTS, not flags. `FIGHTSTG_F0x8009cd1c`
  // (`pro/fightstg.s:27049`) enqueues code 0x10 / 0x11 on the PLAYER's active slot and
  // sets the record's `+0x1c` bit `0x10` / `0x20` (`:27134` / `:27141`); the POOL is what
  // releases it (`pro/wfightmn.s:2758`-`:2775`: `lbu $v1, 0x1c($a1)` /
  // `addiu $v0, 0x4` / `sllv $v0, $a2, $v0` / `nor $v0, $zr, $v0` / `and $v1, $v0` /
  // `sb $v1, 0x1c($a1)`). `b.statusEvents` IS that pool -- 99 slots of 28 bytes -- so
  // the escape gate below reads the queue rather than a boolean the walker invented.
  if (plan.rollLanded && playerRec
      && (plan.effect === "lockFlee" || plan.effect === "lockDigivolve")) {
    stageStatusEventLock(
      b.statusEvents ?? (b.statusEvents = emptyStatusEventPool()),
      plan.effect === "lockFlee" ? 0 : 1,
      activeSlotOf(b, 0),
      // `lbu $v1, 0xc($s4)` :27092 -- the technique record's own `+0x0c`, through the
      // record pointer `sll $v0, $a0, 0x3` / `addu $v0, $a0` / `sll $v0, 0x1` +
      // `lui $v1, 0x8004` / `addiu $v1, 0x2bca` at :27024-:27040. That byte is the
      // record's `crit` field (`category5Plan`'s own `row.direction * record.crit`).
      ctx.recordMagnitude | 0,
      RAND_U16,
    );
  }
  // The stat arms stage their own expiry: `jal FIGHTSTG_F0x8009cc20` :13776 with the code
  // from `.L0x800a43e0[stat]` (`:26986`) and the delay of OPCODE 12 -- `2000 + rand % 2001
  // + 10 * own[+0x06]` (`pro/fightstg.s:26087`-`:26110`, the arm `0x8009c130`). A stat
  // change therefore wears off instead of lasting the whole battle.
  if (plan.stats.length) {
    const pool = b.statusEvents ?? (b.statusEvents = emptyStatusEventPool());
    const sideDir = (plan.side | 0) < 1 ? 0 : 0x10;
    // `FIGHTSTG_F0x8009cc20` passes the TARGET's side to the delay routine (`move_ $a0,
    // $s1` :13778, where `$s1` is the side the arm chose), so the target's own spirit
    // sets how long the change lasts -- `lh $v1, 0x6($s0)` :26204 is `0x800a4580`'s
    // `+0x06`, the effective SPT.
    const spt = targetRec ? (engineEffStats(targetRec).spt | 0) : 0;
    for (const change of plan.stats) {
      stageStatusEventStat(pool, sideDir, change.slot | 0, change.stat, spt, RAND_U16);
    }
  }
}

/**
 * FIGHTSTG_F0x8009df78 — the post-hit secondary-effect dispatcher, run once per LANDED
 * action from the move resolver FIGHTSTG_F0x8009e0cc.
 *
 * THE CALL SITE. The resolver's tail is where the original invokes it: after the accuracy
 * leaves write the hit flag (`sb $v0, 0x30($s1)` at `pro/fightstg.s:28484` for category 2
 * and `:28566` for category 3) and after the damage and the five status/drain appliers, it
 * reads that flag back and calls the dispatcher on a hit —
 * `pro/fightstg.s:28579 .L0x8009e3ac: lbu $v0, 0x30($s1)` / `:28582 beqz $v0, .L0x8009e3c8`
 * / `:28588 .L0x8009e3bc: jal FIGHTSTG_F0x8009df78`. The dispatcher indexes the technique's
 * record by the action's technique id (`lw $v1, 0x4418($v0)`, `:28102`) and switches on
 * record `+0x0a` through the 33-word table `0x80083234`.
 *
 * The walker reaches those same two moments for an ordinary attack — a hit landed and the
 * damage dealt — on all three paths: the technique path and the basic-attack path (side 0)
 * and the enemy path (side 1). This function IS that call. It is the one place the walker
 * runs a hit's SECONDARY effect off the record's dispatch byte, as distinct from the
 * technique's own `effect` string that `tryInflict` reads.
 *
 * WHICH ARMS. This port implements the three that write the PERSISTENT stat penalty
 * (dispatch 32/33/34 -> F0x8009daac/db94/dc8c, engine/dw3/battle-damage-terms.ts). Every
 * other dispatch is a no-op here, and deliberately: dispatch 2..8's appliers are the
 * status/drain family the walker already runs through `tryInflict` and the engine's damage
 * leaves, and every remaining word in the table is the dispatcher's own bare return
 * (`DAMAGE_TERM_POST_HIT_RETURN`, nothing runs). So this is the penalty arm, not a second
 * copy of the status machine — `damageTermPenaltyMode` is the gate.
 *
 * WHICH FIGHTER, AND HOW MUCH. The arms write the PLAYER's active member whichever side
 * acted: they read `lw $a0, 0x4468($v0)` (0x800a4468 = the active party-member index;
 * `docs/research/battle/fightstg-command-dispatch.md`) and resolve it through F0x80017b4c
 * to `&DIGIMON_CUR_STATS + slot*0x3dc`, then `lhu` the slot, add the record's `+0x0c` and
 * store it back. The landing chance is F0x800a1458 (`:31793`): it rebuilds BOTH sides'
 * effective blocks and tests `record[+0x0b] + trunc((playerWIS - enemyWIS)/8)` against
 * `rand & 0x7f`, ignoring the side byte it is handed. The shipped family is the Cardmon
 * enemy attacks (techniques 421..428, all category 2), so the target really is the player.
 *
 * Returns null when the record carries no penalty dispatch (the dispatcher's own no-op),
 * else `{ dispatch, landed, queueWord, penalty }`. `penalty` is the record's three
 * halfwords after the arm ran.
 */
export function applyPostHitDispatch(b, record, options = {}) {
  const dispatch = Number(record?.dispatch) | 0;
  if (damageTermPenaltyMode(dispatch) === null) return null;
  // The member the arms resolve: 0x800a4468, the player's active record.
  const target = battleRestoreTargets(b, 0)[activeSlotOf(b, 0)] ?? null;
  if (!target) return null;
  const before = statPenaltyOf(target);
  const slots = [before.str, before.def, before.spd];
  const result = applyDamageTermPenalty(slots, {
    effectP1: record.f8 | 0,
    wisHigh: engineEffStats(b.player).wis | 0,
    wisLow: (b.enemy ? engineEffStats(b.enemy).wis : 0) | 0,
    magnitude: record.crit | 0,
    dispatch,
    rng: options.rng ?? RAND_U16,
  });
  const landed = result.queueWord !== 0;
  if (landed) {
    // The appliers store the slot back on the persistent member (`sh $v0, 0x42($s0)`).
    // The walker keeps those three halfwords on the record, and `writeBackBattleVitals`
    // carries them to the roster member at the battle's end, where the inn rests them away.
    target.statPenalty = damageTermPenaltyByStat(result);
    if (target.statsRecord) target.statsRecord.statPenalty = { ...target.statPenalty };
  }
  return { dispatch, landed, queueWord: result.queueWord, penalty: statPenaltyOf(target) };
}

export { damageTermCategory4Arm as category4ArmFor };

/**
 * The sentence `?legacyBattleMsg=1` and `peek()` still read for a category-5 technique.
 *
 * It is never what the original's box draws — `plan.page` is, from the record machine's
 * own arms — and it states no number the game never shows. What the arm changed is on
 * `plan` for the tests to read.
 */
export function scriptedWalkerSentence(plan, skill, who) {
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
export function chargeWalkerSentence(charge, skill, who) {
  const name = skill?.name ? `${who} uses ${skill.name}!` : `${who} acts!`;
  if (!charge?.charged) return `${name} No effect!`;
  return `${name} The next attack hits harder!`;
}

/**
 * The sentence `?legacyBattleMsg=1` and `peek()` still read for a category-4 technique.
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
export function restoreWalkerSentence(plan, skill, who) {
  const name = skill?.name ? `${who} uses ${skill.name}!` : `${who} acts!`;
  const parts = [];
  const noEffect = (plan?.page?.payload?.[0] | 0) === DAMAGE_TERM_NO_EFFECT_WORD;
  if (!noEffect) {
    const healed = (plan.heal || []).reduce((a, v) => a + (v | 0), 0);
    if (healed > 0) parts.push(`${healed} HP restored`);
    const cured = (plan.cure || []).reduce((a, v) => a + ((v & 0x07) ? 1 : 0), 0);
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
export { AILMENT_INFLICT };
export const ailmentMessageId = engineAilmentInflictMessageId;
export const ailmentWord = engineAilmentInflictWord;
export const AILMENT_MARKER_ROW_Y = AILMENT_MARKER_Y;

/**
 * The pgfgc00 cel each party pip must draw, straight from the decoded HUD rule
 * (FIGHTSTG_F0x800934f0): the pip picture IS the member's state — cel 0xC+state
 * for the side's active slot, 0x3C+state otherwise. `null` = no member there.
 */
export function partyPipCels(b) {
  const records = b?.playerRecords ?? [];
  const active = b?.activePlayerIndex ?? 0;
  const player = [];
  for (let i = 0; i < 3; i++) {
    const rec = records[i];
    player.push(rec ? enginePartyIconCel(enginePartyIconIndex(rec), i === active) : null);
  }
  const enemy = b?.enemy
    ? enginePartyIconCel(enginePartyIconIndex({ hp: b.enemy.hp, maxHp: b.enemy.maxHp, ailments: b.enemy.ailments }), true)
    : null;
  return { enemy, player };
}

/**
 * The plate's two names and the slash between the HP numbers, through the ported
 * block (FIGHTSTG_F0x80093a74's build arm and F0x80093364).
 *
 * The original builds once per plate and rebuilds a name only when that side's active
 * fighter moves, so this is keyed the same way and the ported build does not run on a
 * frame where nothing changed.
 *
 * `playerName` is the roster member's own stored name — the walker keeps the nickname
 * in `playerRoster[i].name` and falls back to the rookie's species name, which is what
 * the roster record holds. `enemyNameId` is bank 0x4e's line for the enemy, the
 * `+0x06` halfword of that enemy's record in resource `0x1cf`
 * (`web/assets/data/battlecmd/enemy_stats.json`). When the enemy is not in that table
 * the id stays null and the port takes the original's null-record path: the element is
 * still created, the text is left empty, and the walker draws its own species name.
 */
let hudLabelsCache = null;
// Resource 0x1cf, the enemy stat records in scan order — the 70-byte-stride table
// FIGHTSTG_F0x8009b864 linear-scans. `enemyStatIdByName` maps an enemies.json
// `enemy_id` (a name) to the runtime u16 id the original's battle descriptor carries
// (the authoritative `enemy_id.rs` values, taken from the decoded field encounters);
// FIGHTSTG_F0x8009b8d0's scan then turns that id into the record. Both are filled by
// the battle data loader. The walker carries no numeric id of its own, so the name is
// how a battle names its enemy and the id comes from decoded data — see
// enemyStatRecordFor. `record.nameId` (`+0x06`) is the line of bank 0x4e the original's
// plate reads and `record.id` (`+0x00`) is the numeric id the scan looks for.
let enemyStatRecords = null;
let enemyStatIdByName = null;

/** The leading `u16` of record `index` — the word F0x8009b864's scan matches. */
function enemyStatReadId(index) {
  const r = enemyStatRecords?.[index];
  return r ? (r.id & 0xffff) : 0;
}
/** The original's id→record scan over the decoded table. Returns the index, or -1. */
function enemyStatIndexForName(name) {
  if (!enemyStatRecords || !enemyStatIdByName) return -1;
  const id = enemyStatIdByName[String(name ?? "")];
  if (id == null) return -1;
  return enemyStatsIndex(enemyStatReadId, id);
}
/**
 * The enemy stat record for an enemies.json name, resolved through the original's scan
 * (FIGHTSTG_F0x8009b864/F0x8009b8d0) rather than a name-keyed object map. Returns null
 * when the name has no runtime id or the scan misses, exactly as the resolver returns 0.
 */
function enemyStatRecordFor(name) {
  const i = enemyStatIndexForName(name);
  return i >= 0 ? enemyStatRecords[i] : null;
}
function battleHudPlateLabelsFor(b) {
  const activePlayerIndex = b.activePlayerIndex ?? 0;
  const activeEnemyIndex = b.enemySlot ?? 0;
  const playerName = String(b.playerRoster?.[activePlayerIndex]?.name ?? b.player?.profile?.name ?? "");
  const enemyKey = String(b.enemy?.eStats?.enemy_id ?? b.enemy?.profile?.name ?? "");
  const enemyName = String(b.enemy?.eStats?.digimon_id ?? b.enemy?.profile?.name ?? "");
  // The original's numeric enemy id is the word at 0x80042b1c + slot*0xc + 0x18, which
  // FIGHTSTG_F0x8009b8d0 scans the record table for; the record it finds carries the
  // name line at +0x06, so the plate's enemy name comes out of the original's own table
  // rather than the walker's species string.
  const enemyRow = enemyStatRecordFor(enemyKey);
  const enemyNameId = enemyRow?.nameId ?? null;
  const enemyId = enemyRow?.id ?? 0;
  const key = `${activePlayerIndex}|${activeEnemyIndex}|${playerName}|${enemyName}|${enemyNameId}`;
  if (hudLabelsCache?.key !== key) {
    hudLabelsCache = {
      key,
      labels: battleHudPlateLabels({
        activePlayerIndex, activeEnemyIndex, playerName, enemyName, enemyNameId, enemyId,
      }),
    };
  }
  return hudLabelsCache.labels;
}

export function setCounterStance(skill, user) {
  if (skill?.effect === "counter") { user.counterStance = { uses: 3 }; return true; }
  return false;
}

export function triggerCounter(attacker, defender, dmgTaken, attackerName) {
  const cs = defender.counterStance;
  if (!cs || cs.uses <= 0 || dmgTaken <= 0 || defender.hp <= 0) return "";
  const back = counterDamage(dmgTaken);
  if (back <= 0) return "";
  attacker.hp = Math.max(0, attacker.hp - back);
  if (--cs.uses <= 0) delete defender.counterStance;
  return ` ${attackerName} took ${back} counter damage!`;
}

/**
 * Whether the battle's command phase is still waiting for a message line to be read.
 *
 * This is the original's battle controller (`wfightmn`), which runs a table of three-step
 * script instructions keyed on the record's own `+0x14`. "Wait for the line, then open the
 * command menu" is ONE instruction (0x800A7418, file 0x1638), and its very first act is to
 * read the owner's message-line slot and return while it is occupied:
 *
 * ```
 * wfightmn.s:1494  .L0x0000173c: lw    $v0, 0x1c($s2)     # the owner's line slot
 * wfightmn.s:1496  .L0x00001744: bnez  $v0, .L0x000019b4  # -> this routine's epilogue: return
 * ```
 *
 * `0x19B4` is the epilogue (`wfightmn.s:1652` `lw $ra, 0x24($sp)`), so while the line is up
 * the instruction arms nothing and does not step on. Only once the slot reads 0 does it fall
 * through to the arming, `jal 0x80092d80` with the literal 2 in the delay slot
 * (`wfightmn.s:1552-1556`), which sets the command sequencer's `+0x10` = 2; the menu actor
 * itself is built one object step later, in the sequencer's own step routine
 * (`fightstg.s:16118-16130`, the creation `jal F0x80093f9c` at `:16144`). The same wait sits
 * in the other battle script's dispatch entry, `wfightmn.s:1303-1305`.
 *
 * So in the original the command menu is never built beside a waiting line: the phase is not
 * armed and there is nothing to read the pad. `line` is the walker message line ({active,
 * finished} -- the translated `FIGHTSTG_F0x80098a84` panel, which draws only while it is up
 * and waits for Circle with no timeout); `state` the battle phase. The two phases that can
 * hold an unread line in front of the command menu are the intro (the opening "Ambush!", put
 * up by the instruction at `wfightmn.s:1472-1493`) and the command phase itself (the walker's
 * own "No techs!"/"No items!" lines, `web/battle.js` confirmCommand). The timed action phases
 * are held by `msgHoldsTurn` instead.
 */
export function commandPhaseWaitsForLine(line, state) {
  if (!line?.active || line.finished) return false;
  return state === ST.INTRO || state === ST.PLAYER_MENU;
}

// A fighter stands in the low-HP stance while its HP is at or below a quarter of its maximum.
// Decoded from the battle menu overlay: it divides max HP by four (truncating) and compares the HP
// the fighter will have after the pending change, then tells the fight stage to latch that
// fighter's resting pose to the hurt one (1) or the normal one (0). Applies to both sides.
// See docs/research/fight-3d/original-fight-engine.md.
export function lowHpStance(c) {
  const max = Number(c?.maxHp ?? 0), hp = Number(c?.hp ?? 0);
  return max > 0 && hp > 0 && hp <= Math.trunc(max / 4);
}

// The in-fight HP bar, decoded from the 3D battle's HUD draw (FIGHTSTG_F0x800934f0).
// Length is HP*128/maxHP in 128ths of the full bar, and a Digimon that is still standing never
// shows less than 3/128 however little HP is left. The colour is chosen with the SAME quarter-HP
// test as the resting pose: green above a quarter of maximum HP, red at or below it. Each state is
// a two-colour gradient read from a table in the fight stage's own data at 0x800a3490.
export const HP_BAR_COLORS = Object.freeze({
  healthy: Object.freeze(["#007128", "#00c83e"]),
  low: Object.freeze(["#b33716", "#ff370d"]),
});

/**
 * The rate the walker's own `_hudClock` is read at for the parts of the plate that
 * count a free-running tick rather than a drain: the Blast gauge's four-phase cel
 * and the command cursor's blink. It stands in for `[0x8004df98]()`
 * (F0x8001D6F4, the tick), which the engine's `frameTick()` publishes for a whole
 * displayed frame — this HUD draws inside the battle's own 2D pass, which the
 * translated message line drives per displayed frame. The HP bar's drain does NOT
 * use it: that is the plate's own poll, in engine/dw3/ui/native/battle-hp-plate.ts.
 */
export const HUD_CLOCK_HZ = 30;

// The plate's drain rule (FIGHTSTG_F0x80093108's 8-frame poll and
// FIGHTSTG_F0x8009328c's 30-frame sine tween) lives in the engine next to the rest of
// the battle HUD's ports; web/battle.js only supplies the live members and the
// displayed frame's delta.
const { createHpPlateState, hpPlateShown, hpPlateTick } = ui;

/** Bar length in 128ths of the full bar. @returns {number} */
export function hpBarLength(cur, max) {
  const hp = Number(cur ?? 0), maxHp = Number(max ?? 0);
  if (maxHp <= 0) return 0;
  if (hp <= 0) return 0;
  const len = Math.trunc(Math.min(hp, maxHp) * 128 / maxHp);
  return len < 4 ? 3 : len;
}

/**
 * F0x800934f0 HP-fill quad. Partner grows right from 0xAF; enemy shrinks left
 * from 0x8F. @returns {{x:number,y:number,w:number,h:number}}
 */
export function hpBarFillRect(side, cur, max) {
  const len = hpBarLength(cur, max);
  const B = BATTLE_UI_LAYOUT.hpBar;
  if (side === "enemy") return { x: B.enemyRight - len, y: B.y, w: len, h: B.h };
  return { x: B.playerLeft, y: B.y, w: len, h: B.h };
}

/** The two gradient stops the bar is drawn with. @returns {readonly string[]} */
export function hpBarColors(cur, max) {
  return lowHpStance({ hp: cur, maxHp: max }) || Number(cur ?? 0) <= 0
    ? HP_BAR_COLORS.low : HP_BAR_COLORS.healthy;
}

/**
 * FIGHTSTG_F0x800934f0 DV fill: gauge/100 levels while below 1000, a separate
 * full state at 1000. Returns 0..10 tenths of the bar.
 */
export function dvGaugeLength(gauge) {
  const g = normalizeDvGauge(gauge);
  return g >= DV_GAUGE_MAX ? 10 : Math.trunc(g / 100);
}

// The gauge fill's authored sprite (FIGHTSTG_F0x800934F0, decoded): while the
// gauge is below 1000 the four-tick cycle selects sprites 0x33..0x36; at full it
// selects 0x37..0x3A. The frames are 40x8 in the pgfgc00 pack (cels 51-58). The
// draw lands at (0x109, 0x3E) and its width is gauge/25 pixels, i.e. 0..40.
export const DV_GAUGE_ANCHOR = Object.freeze({ x: 0x109, y: 0x3e, w: 40, h: 8 });
export function dvGaugeCel(gauge, phase) {
  const g = normalizeDvGauge(gauge);
  const p = ((Math.trunc(phase) || 0) % 4 + 4) % 4;
  return (g >= DV_GAUGE_MAX ? 0x37 : 0x33) + p;
}
export function dvGaugeWidth(gauge) {
  return Math.trunc(normalizeDvGauge(gauge) / 25);
}

export function createBattle(canvas, ctx, getState, sfx = null, bgm = null) {
  let battle = null; // active battle data
  // Step F: the six-row command list runs the translated pro/fightstg list
  // (web/battlecmd-translated.js, engine FightCommandSession). The walker keeps
  // the 3D scene and the HP plates; the list owns its highlight, marker and
  // confirm. `?nativeBattleCmd=1` runs the original-code reference instead
  // (web/battlecmd-native.js); `?legacyBattleCmd=1` is the walker's hand-made
  // list (also the route under `node --test`, where there is no location).
  const USE_NATIVE_COMMAND = (() => {
    if (typeof location === "undefined") return false;
    return !new URLSearchParams(location.search).has("legacyBattleCmd");
  })();
  // Step F: the HP plate's party markers, bar fill and number row run the
  // translated pro/fightstg routine (engine/dw3/ui/native/battle-hud.ts, painted by
  // web/battlehud-translated.js). `?legacyBattleHud=1` keeps the hand-drawn plate.
  const USE_TRANSLATED_HUD = typeof location !== "undefined" &&
    translatedBattleHudEnabled(location.search);
  const USE_REFERENCE_COMMAND = (() => {
    if (typeof location === "undefined") return false;
    return new URLSearchParams(location.search).get("nativeBattleCmd") === "1";
  })();
  // The in-battle message line runs the translated pro/fightstg panel
  // (engine/dw3/ui/native/battle-message-line.ts, painted by
  // web/battlemsg-translated.js): the chrome pack's own window picture at native
  // (11, 188), the two lines at (20, 194) and (20, 208), the second three display
  // ticks after the first, and the blinking prompt at (291, 208) until Circle.
  // `?legacyBattleMsg=1` keeps the hand-drawn rectangle below.
  const USE_TRANSLATED_MSG = typeof location !== "undefined" &&
    translatedBattleMsgEnabled(location.search);
  const msgSession = USE_TRANSLATED_MSG
    ? new BattleMessageSession({ textOf: battleMsgText, paint: () => {} })
    : null;
  // The battle's OPENING PHASE MACHINE (engine/dw3/battle-opening-machine.ts), the
  // port of pro/wfightmn's #2 arm (F0x800a6c44): the seven phases whose exit hands
  // the fight to the turn machinery. `?legacyIntroTimer=1` rolls back to the walker's
  // old flat 1.2 s INTRO timer for a side-by-side; `?introNoLine=1` forces the
  // phase-1 opening-line gate to "no line" so the phase-5 EXIT can be observed.
  const USE_LEGACY_INTRO_TIMER = typeof location !== "undefined"
    && new URLSearchParams(location.search).has("legacyIntroTimer");
  const FORCE_INTRO_NO_LINE = typeof location !== "undefined"
    && new URLSearchParams(location.search).has("introNoLine");
  // The pad word the session's close rule reads: only bit 0x2000 (Circle) matters.
  let msgPadWords = 0;
  // The original counts the display ticks `[0x8005df98]()` returns. The repo's decoded
  // display tick chain (engine/dw3/ui/pad-words.ts MenuDisplayClock,
  // UI-DISPLAY-TICK-CHAIN-2026-08-21) advances 0x133 of a tick per 50 Hz PAL field tick,
  // i.e. 256/307 of it = 60.4 Hz, which is the rate the message line's rules are stated
  // in: the second line after 3 ticks, the glyph one frame every 4.
  const msgClock = new ui.MenuDisplayClock();
  const commandNative = USE_REFERENCE_COMMAND
    ? createBattleCommandNative(sfx)
    : createBattleCommandTranslated(sfx, { getState });
  // Step F, TECH screen: the six-row technique list runs the translated
  // pro/fightstg screen (web/battletech-translated.js, engine
  // FightTechSession) with its own paging, greyed unaffordable rows, page
  // arrows, description pane and marker highlight.
  // `?legacyTechList=1` keeps the walker's hand-drawn list.
  const USE_TRANSLATED_TECH = typeof location === "undefined"
    ? false
    : !new URLSearchParams(location.search).has("legacyTechList");
  const techNative = createBattleTechTranslated(sfx, { getState });
  // The ITEM screen: the translated pro/fightstg list owns the surface from the
  // frame the ITEM command is chosen, with the original's seven rows a page,
  // clamped pages, the quantity the player is carrying, page arrows, the
  // description pane and the marker highlight.
  // `?legacyItemList=1` keeps the walker's hand-drawn list.
  const USE_TRANSLATED_ITEM = typeof location === "undefined"
    ? false
    : !new URLSearchParams(location.search).has("legacyItemList");
  const itemNative = createBattleItemTranslated(sfx, { getState });
  // The TAG partner list: the translated pro/fightstg screen (F0x80097498, built
  // by F0x80097984) owns the surface from the frame the Tag command is chosen.
  // It lists the two partners that are not the acting member, keeps a knocked-out
  // partner listed with a grey plate the cursor cannot confirm, clamps the cursor,
  // answers Cross as a cancel only when the battle may cancel, and returns the
  // chosen party slot. `?legacyTagList=1` keeps the walker's hand-drawn list.
  const USE_TRANSLATED_TAG = typeof location === "undefined"
    ? false
    : !new URLSearchParams(location.search).has("legacyTagList");
  const tagNative = createBattleTagTranslated(sfx, { getState });
  // The Digivolve panel's seven elemental values, in the order the game's own
  // stat ids run (record +0x34.. fire, water, ice, wind, thunder, machine, dark).
  const FORM_ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
  // Step H, Digivolve form list: pro/fightstg's own 0x80094478 screen (one row per
  // form the acting Digimon can take, its current form greyed out, the cursor
  // clamped at the ends, L1/R1 paging the paged stat panel and Circle refusing the
  // form the Digimon is already in). It answers with the species id the original
  // writes into the command screen's parked word, and the battle then runs the
  // walker's own DV commit, so the two routes cannot drift.
  // `?legacyFormList=1` keeps the walker's hand-drawn list.
  const USE_TRANSLATED_FORM = typeof location === "undefined"
    ? false
    : !new URLSearchParams(location.search).has("legacyFormList");
  const formNative = createBattleFormTranslated(sfx, { getState });
  // What follows a confirmed partner. The original does not swap straight away:
  // both Tag callers allocate the SAME follow-up object -- F0x800988fc at
  // fightstg.s:16343, whose only extra work is to hand F0x80098884 the caller's
  // second word at :22515 -- so both spawn tick 0x800980E4 (F0x80014504 at
  // :22481, `lui 0x800a` + `addiu -0x7f1c` = 0x800980E4, size 0x84, flag 0x44).
  // That object shows the partner's species strip and then a row list whose row
  // count is 2 when a DNA pairing exists and 1 ("Switch" alone) when it does not
  // (:22168 li 1, :22170 lw 0x7C($s1), :22172/:22174 pick 1 or 2, :22177 stores
  // it). Cross on EITHER sub-state writes -2 into its out word (:22192 :22200
  // :22201, reached from the row list too at :22375-:22376) and the coordinator
  // then closes the Tag and hands the turn back (:16327 reads it, :16335 calls
  // self+0x2C(self, 2)), so the command list comes back rather than the partner
  // list. There is no separate form screen before the pane: a confirmed position
  // seats the pane directly. `?legacyTagSwap=1` keeps the walker's own DNA-DV
  // row pane (drawDnaChoice) instead of the translated one, on the partner's
  // live form; Cross there reopens the partner list.
  const USE_ORIGINAL_TAG_SWAP = typeof location === "undefined"
    ? true
    : !new URLSearchParams(location.search).has("legacyTagSwap");
  // The follow-up both Tag and DNA commands land on: the translated pane from
  // F0x800980E4 (web/battledna-translated.js, engine FightDnaSession). It is
  // the original's ONE object, so this single adapter serves the DNA command and
  // the Tag follow-up alike: with a DNA pairing it shows the result-species
  // strip plus "Switch" and "DNA DV" with the Jogress price, and without one the
  // "Switch" row on its own.
  // `?legacyDnaList=1` keeps the walker's own Switch / DNA DV pane for the DNA
  // command; `?legacyTagSwap=1` keeps the walker's chain for the Tag follow-up.
  const USE_TRANSLATED_DNA = typeof location === "undefined"
    ? false
    : !new URLSearchParams(location.search).has("legacyDnaList");
  const dnaNative = createBattleDnaTranslated(sfx, { getState });
  // Step G: pro/wfightmn's boot loader (it asks the cache for the scene packs,
  // uploads them to VRAM and retires) runs as the translated loader task
  // (web/wfight-translated.js, engine WfightLoaderSession). The walker keeps the
  // turn loop, the 3D scene and the HUD. `?nativeWfight=1` runs the original-code
  // loader instead (web/wfightmn-native.js), a research reference;
  // `?legacyWfight=1` skips the boot loader.
  const USE_NATIVE_WFIGHT = (() => {
    if (typeof location === "undefined") return false;
    return !new URLSearchParams(location.search).has("legacyWfight");
  })();
  const USE_REFERENCE_WFIGHT = (() => {
    if (typeof location === "undefined") return false;
    return new URLSearchParams(location.search).get("nativeWfight") === "1";
  })();
  const wfightNative = USE_REFERENCE_WFIGHT
    ? createWfightNative()
    : createWfightTranslated({ getState });
  // Production hand-off for the post-fight results screen (Phase 6.3). When a
  // host sets it, the victory "report" phase opens the native pro/stfgtrep
  // screen instead of drawing the inline report; the screen pays the BIT and
  // the dropped item, and its close calls finishNativeReport(). Left null, the
  // hand-authored inline report runs exactly as before.
  let reportHandoff = null;
  // The finale's win exit (wfightmn.s:2165-2174): when the win's launch cue is
  // the ending movie (0xE0B, kind 6), the host registers how to play it — movie
  // row 10 (MOVIEE01_STR), its return selector 0xE0C (row 11, MOVIEE02_STR),
  // then 0x2d7 (screen 727 = stage 780) — and calls finishEnding() when the
  // chain is done. The ordinary win's cue (0x1400, STFRPT) still goes through
  // reportHandoff; the two exits never both run.
  let endingHandoff = null;
  // The field's battle handoff (F0x8008B798): the host registers what has to run
  // BEFORE a field battle starts. At story ordinal 43 that is the title overlay's
  // movie MOVIED08_STR (selector 0xE0A, whose own return selector is 0x600, the
  // battle); the host's handler resolves when the movie is over, and every other
  // ordinal resolves immediately. It hangs here, on startParty — the one funnel
  // all three field entry points (startScreen/startRandom/startParty) pass
  // through — because the original hangs it on the one battle setup every field
  // battle calls. See engine/dw3/screen-routing.ts `battleHandoff`.
  let fieldMovieHandoff = null;

  // Loaded data (set by loadData())
  let digimonDB  = null; // array of digimon profiles by index (id-1)
  let skillDB    = null; // map of skill id → skill
  // Authentic field-encounter tables (see docs/research/battle-invocation.md):
  let stageEncDB = null; // per-stage zone pools (stage_encounters.json)
  let fieldEncDB = null; // global screen_id → enemy party (field_encounters.json)
  let cardmonBoostersDB = null; // screen → Cardmon booster pack (cardmon_boosters.json)
  let battleMusicDB = null; // stage → battle-trigger records incl. music tag (battle_music.json)
  let progressionDB = null; // battle rewards + level-up + gym tables (progression.json)
  let zoneGridDB = null; // per-stage zonecheck lookup grids (zone_grids.json)
  let fightTechDB = null;
  let dnaResultScript = null;
  let jogressDB = null; // action id → fused species, from the disc's own director scripts

  let enemiesDB = null; // map of enemy_id string → sdigiedt entry

  // 3D battle renderer (WebGL into OffscreenCanvas, blitted during draw())
  let renderer3d = null;
  let offscreen3d = null;

  // ── Fullscreen battle ──
  // The field game and 2D UI lay out against the VIEW_W/VIEW_H *constants* in game.js
  // (640×480), never canvas.width — so we can grow the shared canvas to the display
  // resolution for a crisp fullscreen battle and restore it when the battle ends.
  const BATTLE_REF_W = 640, BATTLE_REF_H = 480; // logical UI layout space
  let _savedCanvas = null;

  function _battleTargetSize() {
    const stage = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(640, Math.round((stage?.clientWidth  || 640)));
    const ch = Math.max(480, Math.round((stage?.clientHeight || 480)));
    const cap = 1600;                                   // keep fill-rate sane
    const k = Math.min(1, cap / Math.max(cw * dpr, ch * dpr));
    return { w: Math.round(cw * dpr * k), h: Math.round(ch * dpr * k) };
  }

  function enterBattleFullscreen() {
    _savedCanvas = { w: canvas.width, h: canvas.height };
    canvas.classList.add("battle-fs");
    const { w, h } = _battleTargetSize();
    canvas.width = w; canvas.height = h;
  }

  function exitBattleFullscreen() {
    canvas.classList.remove("battle-fs");
    if (_savedCanvas) { canvas.width = _savedCanvas.w; canvas.height = _savedCanvas.h; _savedCanvas = null; }
  }

  function onBattleResize() {
    if (!battle) return;
    const { w, h } = _battleTargetSize();
    canvas.width = w; canvas.height = h;
    if (offscreen3d) { offscreen3d.width = w; offscreen3d.height = h; }
  }
  window.addEventListener("resize", onBattleResize);

  // Battle state → camera shot. The decoded authentic idle camera (a director that cuts
  // between 5 canned shots) plays while picking a command — the states we captured live.
  // Actions are framed over-the-shoulder ("behind") with op5 script cuts overriding them;
  // intro uses "behind". WIN keeps the older orbit sweep. LOSE plays the original's own
  // defeat camera (FIGHTSTG_F0x8008c93c) — ?legacyLossCam=1 keeps the older sweep.
  const DIRECTOR_STATES = new Set([
    ST.PLAYER_MENU, ST.PLAYER_TECH, ST.PLAYER_ITEM,
    ST.PLAYER_TAG, ST.PLAYER_DV, ST.PLAYER_DNA_CHOICE,
  ]);
  const ORBIT_STATES = new Set([ST.WIN]);
  // Who owns the camera record, in the original's own terms. The battle's camera director
  // (FIGHTSTG_F0x8008718c) re-publishes its own record through the cut [0xf8] on every tick it
  // runs (fightstg.s:5096-5105), and on the confirm edge the command screen retires it — state
  // 3, then the object is FREED — so for the whole attack nothing re-publishes and the record
  // holds the retire cut. The walker no longer needs a state list for that: the renderer's
  // `directorRetired` (web/battle3d.js) is the director's own absence, and the coordinator
  // answers the script's ownership directly. Nothing here clears the record; the owner replaces
  // it. The `SCRIPT_OWNED_CAMERA_STATES` freeze list was removed 2026-10-08 (worker-bc) because
  // the retire makes it unnecessary; see `.dw3-research/camera-retire-implement-2026-10-08/`.
  const LEGACY_LOSS_CAM = new URLSearchParams(location.search).get("legacyLossCam") === "1";
  // ?legacyLossPose=1 drops the loss beat's slow motion (and leaves the animation clock at
  // the normal speed), so a reviewer can see the old picture beside the original's. The
  // original arms `[0x800a4548](2)` in the defeat effect's FIRST tick (F0x8008c93c
  // .L0x8008ca48), which is the same frame the camera cuts.
  const LEGACY_LOSS_POSE = new URLSearchParams(location.search).get("legacyLossPose") === "1";
  // ?legacyLoss=1 keeps the whole hand-written loss beat below (LOSE_EFFECT_FRAMES /
  // lossExitFrame and the slow-motion arm in update()). The port replaces all of it with
  // the original's own objects, so the two smaller flags above only mean anything on this
  // path.
  const USE_LEGACY_LOSS = new URLSearchParams(location.search).get("legacyLoss") === "1";
  /** The camera the loss beat shows: the original's close shot, or the older sweep. */
  const lossCameraMode = () => (LEGACY_LOSS_CAM ? "orbit" : "defeat");
  /**
   * The walker's own wording for a battle-message bank index, used only as the panel's
   * identity key and when the bank has not loaded yet; the panel's words come from the
   * bank itself (web/battlemsg-translated.js).
   */
  const LOSS_MESSAGE_WORDS = { 0x53: "Annihilated..." };

  async function _init3DRenderer(b) {
    try {
      if (typeof OffscreenCanvas === "undefined") return;
      offscreen3d = new OffscreenCanvas(canvas.width, canvas.height);
      renderer3d  = createBattle3D(offscreen3d, sfx);
      if (!renderer3d) { offscreen3d = null; return; }
      // The disc's own per-AREA battle arena: the field screen the fight started on and the
      // encounter id it rolled resolve to the battle descriptor's arena id (the trigger record's
      // `param`, copied to 0x80042b28 by fieldstg fn 0x800925a8), which selects the SFSTDATA
      // MEFT10<id> stage pack. See web/battle3d.js `setArenaStage`.
      renderer3d.setArenaStage?.(b.mapId, b.screenId);
      window.__battle3d = renderer3d;  // debug handle (matches window.__ITEM_BY_ID pattern)
      window.__battleB = () => battle; // debug handle: live battle state (labs/headless diagnostics)
      // Phase 6.3 group 4: the shipped pro/fightstg command list's adapter, so a
      // focused check can read its boot/traps and the row it handed back.
      window.__battleCmdNative = commandNative;
      window.__battleTechNative = techNative;
      window.__battleItemNative = itemNative;
      window.__battleTagNative = tagNative;
      window.__battleFormNative = formNative;
      window.__battleDnaNative = dnaNative;
      window.__battleWfightmn = wfightNative;
      // Debug handle: start the Blast transformation on demand. In play it only
      // fires when the DV gauge saturates, which a headless capture cannot reach
      // reliably; this runs the SAME triggerBlast the gauge path calls, so the
      // lab exercises the real cinematic and not a copy of it.
      window.__battleBlast = () => triggerBlast(battle);
      // The other two sequences on the same manager, for the same reason: both
      // run the REAL commit path, so the lab exercises the shipped code.
      window.__battleDv = (formId) => {
        const cur = battle.player.profile?.id;
        const opts = formOptionsFor(battle.activePlayerIndex) || [];
        // Fall back to any other profile. The lab's level-5 starter usually has
        // NO eligible evolution, so requiring one made this entry point unusable
        // for a capture. The eligibility gate still lives on the real DV menu
        // path; this only picks a destination for applyDvAction, which is the
        // shipped commit either way.
        const pick = formId
          ?? opts.find((f) => f.id !== cur)?.id
          ?? Object.keys(digimonDB || {}).map(Number).find((id) => id !== cur);
        if (pick == null) return false;
        applyDvAction({ type: "dv", formId: pick });
        return true;
      };
      window.__battleRevert = () => {
        // Arm a Blast if one is not active, so revertBlast has a form to
        // restore; reverting is what is under test, not the arming.
        if (!battle.blast) {
          battle.blast = {
            active: true,
            savedFormId: battle.player.profile?.id ?? battle.player.rookieId,
            playerTurns: 1,
          };
        }
        revertBlast(battle);
        return true;
      };

      const playerName = b.player.profile.name;
      const enemyName  = b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "";

      const [pFolder, eFolder] = await Promise.all([
        resolveModelFolder(playerName),
        resolveModelFolder(enemyName),
      ]);
      if (renderer3d) {
        if (pFolder) renderer3d.setPlayerDigimon(pFolder);
        if (eFolder) renderer3d.setEnemyDigimon(eFolder);
        // The disc opens a fight on a canned shot the ENEMY's record names, framing our
        // Digimon (FIGHTSTG_F0x800880f0 sub-state 0 -> F0x8009257c). It yields as soon as
        // an action's own camera runs.
        renderer3d.applyIntroCamera?.();
        // The same fight-opening actor cues COMCD103 here: in its state-1 sub-state 0 it
        // applies that shot ([+0x100]/[+0xf8], .L0x80088244-.L0x80088264), creates the
        // effect-0x33 owner (.L0x80088268) and plays 0x800429bf through [0x80055c48]
        // (.L0x8008828c-.L0x80088290). One cue per battle open, every battle.
        sfx?.play("comcd103");
      }
    } catch (err) {
      renderer3d = null; offscreen3d = null;
    }
  }

  async function loadData() {
    if (digimonDB) return;
    const [dj, sej, fej, zgj, emj, evj, bmj, prj, ftj, dcj, cbj, esj, jgj] = await Promise.all([
      fetch("assets/data/digimon.json").then(r => r.json()),
      fetch("assets/data/stage_encounters.json").then(r => r.json()),
      fetch("assets/data/field_encounters.json").then(r => r.json()),
      fetch("assets/data/zone_grids.json").then(r => r.json()),
      fetch("assets/data/enemies.json").then(r => r.json()),
      fetch("assets/data/evolutions.json").then(r => r.json()),
      fetch("assets/data/battle_music.json").then(r => r.json()).catch(() => ({})),
      fetch("assets/data/progression.json").then(r => r.json()).catch(() => null),
      fetch("assets/data/fight_tech_table.json").then(r => r.json()),
      fetch("assets/data/dna_clip12.json").then(r => r.json()),
      fetch("assets/data/cardmon_boosters.json").then(r => r.json()).catch(() => null),
      // Resource 0x1cf, the enemy stat records. The same disc file enemies.json was
      // decoded from, in the same order; if the two ever disagree in length the map
      // stays empty and the plate falls back to the species name.
      fetch("assets/data/battlecmd/enemy_stats.json").then(r => r.json()).catch(() => null),
      // The ten Jogress director scripts, decoded out of the fight model action bins
      // by tools/extract_jogress_scripts.py. This is where the DNA action's fused
      // form comes from: the script spawns it as a model.
      fetch("assets/data/jogress_scripts.json").then(r => r.json()).catch(() => null),
    ]);
    battleMusicDB = bmj;
    progressionDB = prj;
    fightTechDB = ftj;
    dnaResultScript = dcj;
    jogressDB = jgj;
    digimonDB   = Object.fromEntries(dj.digimon.map(d => [d.id, d]));
    // The record's own raw bytes the formula leaves test: +0x0A the TECH_EFFECT_*
    // opcode (`dispatch` in the extracted table) and +0x0C its effect power (`crit`).
    // `effect`/`effect_p2` name only the subset with a decoded effect name; the raw
    // bytes cover all 443 rows, so a technique the name table misses still gets its
    // true crit/accuracy branch.
    skillDB     = Object.fromEntries(dj.skills.map(s => {
      const rec = ftj?.[String(s.id)];
      return [s.id, rec ? { ...s, effect_id: rec.dispatch, effect_power: rec.crit } : s];
    }));
    stageEncDB  = sej;
    fieldEncDB  = fej;
    cardmonBoostersDB = cbj;
    zoneGridDB  = zgj;
    enemiesDB   = Object.fromEntries(emj.enemies.map(e => [e.enemy_id, e]));
    // enemies.json rows 0..recordCount-1 are the records in scan order; any row past
    // that (the walker's all-zero "Null" placeholder) has no record in the original's
    // table, gets no name line, and keeps the species-name fallback.
    const enemyRows = esj?.records ?? [];
    enemyStatRecords = enemyRows.length > 0 ? enemyRows : null;
    // The runtime u16 id behind each species name: FIGHTSTG_F0x8009b8d0 scans with the
    // numeric id, which enemies.json does not carry. The decoded field-encounter table
    // holds the authoritative `enemy_id.rs` id per name (one id per name across all its
    // pools); where a name is not in a pool the id falls back to the record at the same
    // enemies.json index, so no name loses its id and the resolver never regresses.
    const nameToId = {};
    for (const party of Object.values(fej?.screens ?? {})) {
      for (const e of party ?? []) if (e?.name != null && e.id != null) nameToId[e.name] = e.id | 0;
    }
    emj.enemies.forEach((e, i) => {
      if (nameToId[e.enemy_id] == null && enemyRows[i]) nameToId[e.enemy_id] = enemyRows[i].id | 0;
    });
    enemyStatIdByName = nameToId;
    // The disc's EIGHT digivolution trees, one per roster slot, generated from the
    // overlay image itself by tools/extract_evolutions.py. There is deliberately no
    // index over them keyed by source form: the unlock routine reads the tree for a
    // roster slot and scans its 44 records in table order, and ./evo-trees.js ports
    // that. Which two Digimon may DNA, what it costs, which attack lands and which
    // form appears are four reads of disc data (dnaPairing + dnaActionRecord over the
    // profile and technique tables, and the model's own clip-12 director script).
    evolutionTrees = evj;
  }

  // Roll a random encounter for (mapId, player x,y) against the authentic field tables.
  // Faithful to the engine selector (fieldstg fn 0x800925a8): geographic zone → rand()&7
  // slot → screen_id → enemy party. Returns the party array (1–3 members) or null when the
  // roll lands on an empty slot / the stage has no pool ("no encounter this roll").
  // See docs/research/battle-invocation.md and web/encounters.js.
  function pickEnemy(mapId, x = 0, y = 0) {
    if (!stageEncDB) return null;
    return pickEncounter({
      stageDB: stageEncDB, fieldDB: fieldEncDB, gridDB: zoneGridDB,
      mapId, x, y, rng: () => RAND_U16(), progressOrdinal: storyOrdinal(),
      entryKey: entryKey(),
    });
  }

  // The entry warp's own parameter, latched into game state when the warp ran
  // (web/game.js, the fade.pending map change). This is the walker's stand-in
  // for the u16 at [0x80048d78] that the fieldstg warp executor writes from the
  // step record's params[5]. runtime_key stages (Seabed/Circuit/endgame) select
  // which of their zone-block groups is live by matching it.
  function entryKey() {
    const k = Number(getState()?.entryKey ?? 0);
    return Number.isFinite(k) && k > 0 ? k : undefined;
  }

  // The master story-progress ordinal [0x8004b370] — the walker's single source of
  // truth is the engine's `$story.ordinal`, proxied by game state.progressOrdinal.
  // Multi-group stages (scene_struct+0x20, see engine/dw3/encounters.ts) pick which
  // record's four zone blocks are live from it.
  function storyOrdinal() {
    return Number(getState()?.progressOrdinal ?? 0) || 0;
  }

  // The guaranteed Booster pack a defeated Cardmon leaves (fieldstg battle setup
  // F0x8008B798; the pure selection is engine/dw3/cardmon-booster.ts). The fight's
  // field screen keys the odd/even table and the enemy id parity picks which; the
  // draw is RAND_U16 masked to 0x1f/0xf. Returns the item id or null for any other
  // enemy. Computed once per battle and remembered, because the native flag is set
  // at setup.
  function cardmonBoosterForBattle(b) {
    if (b._cardmonBoosterId !== undefined) return b._cardmonBoosterId;
    b._cardmonBoosterId = null;
    const entries = fieldEncDB?.screens?.[String(b.screenId)];
    const card = entries?.find((e) => String(e.name ?? "").startsWith("Cardmon"));
    if (card && cardmonBoostersDB) {
      const screen = Number(String(b.mapId ?? "").replace(/^s/, ""));
      b._cardmonBoosterId = cardmonBooster(cardmonBoostersDB, {
        screen, enemyId: card.id, rand: RAND_U16(), progressOrdinal: storyOrdinal(),
      });
    }
    return b._cardmonBoosterId;
  }

  // The encounter-rate level of the zone the player is standing in, for the field's
  // step counter (fieldstg driver fn 0x80092664 reads `*zoneArray[zone-1]`).
  // Returns 0 when the stage has no pool — the caller then rolls nothing.
  function encounterRateLevel(mapId, x = 0, y = 0) {
    if (!stageEncDB) return 0;
    const key = String(mapId).match(/(\d+)/)?.[1];
    const stage = key ? stageEncDB.stages?.[key] : null;
    if (!stage?.zones) return 0;
    return zoneRateLevel(stage.zones, zoneAt(zoneGridDB?.stages?.[key], x, y),
                         stageZoneBlocks(stage, storyOrdinal(), entryKey()));
  }

  // Build a fake profile-like object from a sdigiedt enemy entry so elementFactor works.
  function enemyToProfile(eStats) {
    return {
      name: eStats.digimon_id,
      resistances: eStats.resistances ?? {},
    };
  }

  // HP formula for wild enemies: calibrated so Apemon (str=128) at level 10 ≈ 360 HP.
  function enemyHp(eStats, level) {
    return Math.max(30, Math.round(eStats.str * 2.5 + level * 5));
  }

  function enemyMp(eStats, level) {
    return Math.max(10, Math.round(eStats.spt * 1.5 + level * 3));
  }

  // Map charId → digimon id (matches packs.js charId values)
  function getPlayerProfile(state) {
    const chars = state.manifest?.characters;
    if (!chars || state.charIdx <= 0) return null;
    const char   = chars[state.charIdx];
    // A character may carry an explicit digimonId (e.g. an evolved form chosen by the
    // battle-test harness); otherwise fall back to the starter charId map.
    const digId  = state.partnerStats?.digimonId ?? char?.digimonId ?? CHARID_TO_DIGID[char?.id];
    return digId ? digimonDB[digId] : null;
  }

  // (scaledStat / scaledHp / scaledMp are module-level pure functions above.)

  // Steal (f7=12): the player's steal moves roll effect_p1 vs the enemy's WIS; on success
  // they grab the enemy's drop item into the inventory. Returns `{ text, page }`: the
  // walker's own flat suffix for the legacy box, and the original's own PAGE when there
  // is one.
  //
  // A landed steal is FIGHTSTG_F0x80091534's opcode 5 arm: `FIGHTSTG_F0x80091534`
  // writes the stolen ItemId into the payload word the message reads
  // (fightstg.s:15000 `lh $v0, 0x18($s0)` / `:15002 sw $v0, 0x54($s3)` then
  // `:15004 li $a1, 0x11`) and asks
  // for **kind 17**, whose arm `.L0x80099e8c` is line one `esmfight[0x26]` "Stole"
  // (`:23945 li $a2, 0x26`), line two `esmfight[0x09]` `{1}!` (`:23956 li $a2, 0x9`)
  // and the item's own name out of bank 0x6a in slot 1 (`:23960 addiu $a0, 0x6a`,
  // `:24147 lw $a2, ($s2)`). So the player reads two lines, not a sentence appended to
  // the damage one. The two refusals keep the walker's own words: the original's opcode-5
  // arm has no refusal page of its own — it tests `andi $v0, 0x8` at `:14990` and, when
  // it fails, stores the item id and prints kind 17 anyway.
  function trySteal(skill, enemy, state, thiefName = "") {
    if (skill?.effect !== "steal" || enemy.hp <= 0) return { text: "", page: null };
    const stealBonus = battle?.player?.stealBonus ?? 0;  // HackSticker/System (+32/+64)
    // FIGHTSTG_F0x800a1114's own roll, through the port `stealProc`: a ratio of the
    // ACTING side's effective SPD (eff+0xa) to the other side's (eff+0x4a) clamped to 200,
    // times the technique record's +0x0B weight byte (fight_tech_table `f8`) plus the
    // steal_up bonus, scaled by the resolved enemy stat record's +0x04, compared against
    // the low ten bits of the RNG. This REPLACES the walker's old secondary-status formula
    // `statusRoll(effect_p1 + bonus, enemy.wis)` and changes the odds — the direction is
    // laid out in docs/research/battle/battle-steal-roll-wired-2026-10-06.md.
    const record = enemyStatRecordFor(enemy.eStats?.enemy_id ?? enemy.profile?.name ?? "");
    const techWeight = fightTechDB?.[String(skill.id)]?.f8 ?? 0;
    const thiefSpd = battle?.player ? effStats(battle.player).spd | 0 : 0;
    const foeSpd = effStats(enemy).spd | 0;
    const enemyFactor = record?.field04 ?? 0;
    if (!stealProc(enemyFactor, thiefSpd, foeSpd, techWeight, stealBonus, RAND_U16())) return { text: "", page: null };
    const dropName = enemy.eStats?.drop_item;
    if (!dropName || dropName === "Null") return { text: " ...but there was nothing to steal!", page: null };
    const item = window.__ITEM_BY_NAME?.[dropName];
    if (!item) return { text: " ...but the item slipped away!", page: null };
    // The shared store, so a stolen item at the original's 99 cap stays at 99
    // (F0x800161D8) instead of running to 100.
    storeAddItem(state, item.id, 1);
    localStorage.setItem("inventory", JSON.stringify(state.inventory));
    const name = battleMsgText(0x6a, item.id) || item.name;
    return {
      text: ` Stole ${item.name}!`,
      page: battleMessagePage(17, { name: thiefName, index: item.id, slot: name }),
    };
  }

  // The battle's EXP/Bits/DVEXP payout: the disc's per-battle reward record for this
  // battle's own screenId, shared between the participants. Nothing else — the original
  // has no per-enemy EXP rule, so a battle with no record pays 0 (winBattleRewards).
  // The divisor is the number of participants STILL STANDING at the outcome, which is
  // what stfgtrep's flagged-row count divides by (.L0x00002c68).
  function winRewards(b, rosterIndex = b.activePlayerIndex ?? 0) {
    return winBattleRewards({
      screenId: b.screenId,
      participants: Math.max(1, paidParticipants(b).length),
      equipment: getState().equipment?.[rosterIndex] ?? {},
      rewards: progressionDB?.battle_rewards,
    });
  }

  // ── Public API ──

  function isActive() { return battle !== null; }

  // ── Automatic Blast digivolution (event 0x12/0x13) ─────────────────────────
  // Decoded + runtime-verified 2026-07-13/14 (BLAST-C001..C010). The DV gauge
  // fills from taking hits (gaugeGain); saturating at DV_GAUGE_MAX enqueues the
  // automatic Blast. Blast picks a target from the partner's ROOKIE-profile
  // blasts[] by battle-level tier, heals to full unconditionally, and reverts on
  // a turn-queue schedule of 6 player + 3 enemy turns. While active, techniques
  // are MP-free and the gauge takes no further gain (a Tag would forfeit it).

  /** Resolve this player's Blast target profile, or null if none applies. */
  function blastTargetProfile(b = battle) {
    const p = b?.player;
    if (!p) return null;
    const rookie = digimonDB?.[p.rookieId];
    const targetId = blastTargetId(rookie?.blasts, p.level ?? 1);
    return targetId ? (digimonDB?.[targetId] ?? null) : null;
  }

  /** True when the gauge just saturated and an automatic Blast can fire. */
  function blastReady(b = battle) {
    return !b?.blast?.active
        && (b?.player?.gauge ?? 0) >= DV_GAUGE_MAX
        && !!blastTargetProfile(b);
  }

  /**
   * Begin Blast-on. The form swap and the full heal no longer land on this
   * call: the runtime capture (BLAST-C010) shows a ~14 s transformation in which
   * the model changes at frame 312 and the heal lands at frame 600, so both are
   * applied by advanceBlastPresentation() on their captured frames. The state
   * flags and the jingle still land here.
   */
  function triggerBlast(b = battle) {
    const p = b.player;
    const target = blastTargetProfile(b);
    if (!target) return false;
    b.blast = { active: true, savedFormId: p.profile?.id ?? p.rookieId, playerTurns: 6 };
    sfx?.playBank?.("evo_00", "evolutio"); // shared digivolution jingle EVOLUTIO [BLAST-C009]
    // EVOLUTIO (0x41140000) is a bit-30 music-start id: its start takes the one
    // exclusive-track register D0x80055c34 and the register stops the held battle
    // track through it — no explicit stop call is needed (fns.s:17704-17717). The
    // track is re-triggered when the transformation ends (see the replay in
    // advanceBlastPresentation), and that start stops EVOLUTIO in turn.
    // esmfight 0x61 = "Blasted!", shown under the name banner (obj A carries
    // string 0x16 = "{1}", the bare name slot).
    sayOriginal(b,
      { kind: MSG_KIND.OUTCOME, payload: [MSG.BLASTED], name: p.profile?.name ?? "Your partner" },
      `${p.profile?.name ?? "Your partner"} Blasted!`);
    // The presentation itself. `frame` counts the capture's own frames.
    b.blastShow = {
      program: FormChangeProgram.BLAST_ON,
      frame: 0, target, swapped: false, healed: false, state: null, sounded: true,
      endMessage: "",   // the "Blasted!" line already showed; nothing follows it
    };
    // No face-cam inset during the transformation: the capture is a clean scene
    // with only the two HP plates over it.
    renderer3d?.setFaceCamVisible?.(false);
    return true;
  }

  // The capture is a 60 Hz recording, so its frame numbers are the unit here.
  const BLAST_CAPTURE_HZ = 60;

  /**
   * Advance the Blast transformation by `dt` seconds and apply whatever its
   * decoded schedule says lands on this frame. The battle state machine is
   * frozen while this runs — the capture is 14 s of cinematic with no input and
   * no turn progress.
   */
  function advanceBlastPresentation(b, dt) {
    const show = b.blastShow;
    // "Digivolve Demo: OFF" (the pause-menu setting) skips the CINEMATIC only.
    // The program still runs; it is advanced far enough in one step to cross
    // every threshold it owns, so the model swap, the full heal and the end
    // state all still fire and the battle reaches an identical state. The
    // transformation effects are suppressed because they are the cinematic.
    const skip = !digivolveDemoOn();
    if (skip) show.frame = 1e6;
    else show.frame += dt * BLAST_CAPTURE_HZ;
    const prevFrame = show.lastFrame ?? -1;
    const frame = Math.round(show.frame);
    show.lastFrame = frame;
    const s = formChangeState(show.program, frame);
    // The REAL transformation art: E000EVOL effect types spawned through the
    // same EffectPlayer op3 uses (claim
    // blast-dv-visuals-are-e000evol-effects-2026-08-13).
    if (!skip) {
      for (const sp of evolEffectsDue(show.program, prevFrame, frame)) {
        renderer3d?.blastSpawnEffect?.(sp.type, sp.pos);
      }
    }
    show.state = s;
    renderer3d?.blastPresentationSet?.(s);

    // The "... Blasted!" line is dismissed before the animation proper starts.
    if (show.program === FormChangeProgram.BLAST_ON
      && show.frame >= BLAST_FIRST_FRAME && b.message) b.message = "";

    // Each program's jingle fires on its captured frame, not at commit:
    // Manual DV's EVOLUTIO at +34 (dv_manual.txt: commit f6005, SOUND
    // 0x41140000 f6039) and the revert's PLAYER11 at +50 (blast_run4.txt:
    // commit f5938, SOUND 0xa0045ec9 f5991). Blast-on's EVOLUTIO is played by
    // triggerBlast and marks itself sounded, so this never double-fires.
    const soundFrame = formChangeSoundFrame(show.program);
    if (!show.sounded && soundFrame != null && frame >= soundFrame) {
      show.sounded = true;
      if (show.program === FormChangeProgram.MANUAL_DV) {
        sfx?.playBank?.("evo_00", "evolutio");   // takes the register; the battle track stops
      }
      else if (show.program === FormChangeProgram.BLAST_REVERT) sfx?.play("player11");
    }

    // Model hide/swap point: from here the fighter IS the incoming form, drawn
    // as a wireframe first and solid later by the renderer. The revert and
    // manual DV have already swapped at commit (their captures put the model
    // load before the presentation), so `target` is null for them and this is
    // a no-op.
    if (!show.swapped && s.showNewModel && show.target) {
      show.swapped = true;
      setLiveBattleForm(b.player, show.target);   // temporary, not persisted (like manual DV)
      swapPlayerModel(show.target.name);
    }

    // Unconditional full heal [BLAST-C007], landing on its captured frame. Only
    // Blast-on heals: the capture records no heal at revert, and manual DV
    // leaves every live combat value in place.
    if (!show.healed && s.healed) {
      show.healed = true;
      // wfightmn F0x800a8bf4: the landing heal is unconditional, and the SAME
      // handler clears exactly the confusion bit (0x04) with its pending
      // recovery event. Poison/Frozen/Sleep are not touched.
      blastLandingHeal(b.player);
      if (b.confusedMenu) b.confusedMenu = null;
    }

    if (s.done) {
      b.blastShow = null;
      renderer3d?.blastPresentationStop?.();
      renderer3d?.setFaceCamVisible?.(true);
      if (show.endMessage) sayOriginal(b, show.endSpec ?? null, show.endMessage);
      else clearBattleLine(b);   // the original's box is empty when the cinematic ends
      b.timer = 0;
      // The digivolution path re-plays the saved battle track once the transformation
      // ends: fightstg F0x80089cd8 loads [0x80042b30] and hands it to the packed-sound
      // player (.L0x8008a764-.L0x8008a778). That start stops EVOLUTIO through the same
      // register — two exclusive starts, no stop call. Both EVOLUTIO programs run
      // through that path, so both restore the track; the revert's PLAYER11 is a
      // positional one-shot that never touches the register and has nothing to restore.
      if ((show.program === FormChangeProgram.MANUAL_DV
        || show.program === FormChangeProgram.BLAST_ON) && bgm && b._battleTrack) {
        bgm.play(b._battleTrack);
      }
    }
  }

  /**
   * Revert Blast, sequence 0x62 — its own de-digivolution program, not a replay
   * of 0x61. Order matters and is captured (blast_run4.txt): event 0x13 state 0
   * runs cleanup and restores the form FIRST (f5938-5939), and only then does
   * state 1 start the presentation (f5941). So the model is already back before
   * a single frame of the effect plays, and there is NO heal.
   */
  function revertBlast(b = battle) {
    const p = b.player;
    if (!b.blast) return;
    const saved = digimonDB?.[b.blast.savedFormId] ?? digimonDB?.[p.rookieId] ?? p.profile;
    setLiveBattleForm(p, saved);
    swapPlayerModel(saved.name);
    // The shared release (0x800A7328) is what drops the reservation: it zeroes the
    // roster gauge [BLAST-C001/C002] and clears the standing reserved second form.
    // The Digivolve commit and the Tag commit run the same routine, so all three
    // go through it instead of each repeating the gauge write.
    releaseReservedSecondForm(b);
    b.message = "";
    // The captured revert sound is PLAYER11 (0xa0045ec9), authority 1
    // (captures/blast-presentation-2026-07-14/README.md). It used to be left
    // silent because "the extracted set has no player11" — that was a defect in
    // the sample resolver, not a gap in the disc: the id addresses program slot
    // 11, tone 13, note 73, and the bank does contain it. It fires 50 frames
    // into the sequence, not at commit (blast_run4.txt: commit f5938, SOUND
    // f5991), so advanceBlastPresentation plays it on its captured frame.
    b.blastShow = {
      program: FormChangeProgram.BLAST_REVERT,
      frame: 0, target: null, swapped: true, healed: false, state: null, sounded: false,
      // esmfight 0x62 verbatim, on its own line under the name (wfightmn.s .L0x0000316c).
      endMessage: `${saved.name}\nBack to normal!`,
      endSpec: { kind: MSG_KIND.OUTCOME, payload: [MSG.BACK_TO_NORMAL], name: saved.name },
    };
    renderer3d?.setFaceCamVisible?.(false);
  }

  /** Count one elapsed player turn while Blast is active; flag the revert when the schedule expires. */
  function tickBlastTurn(b = battle) {
    if (!b?.blast?.active) return;
    if (--b.blast.playerTurns <= 0) b._blastRevertPending = true;
  }

  // Build one enemy combat record from an encounter entry (enemyId name/id, level, and the
  // REAL per-encounter hp/mp). Reused for every member of a sequential boss party. Returns
  // null when the species can't be resolved.
  function buildEnemyRecord({
    enemyId, enemyLevel, enemyHp: realHp, enemyMp: realMp, enemyStatScale = 16,
  }) {
    // Resolve enemy: prefer sdigiedt entry by name, fall back to profile by numeric id
    const eStats = typeof enemyId === "string" ? enemiesDB[enemyId] : null;
    const enemyProf = eStats ? enemyToProfile(eStats) : (digimonDB[enemyId] ?? null);
    if (!enemyProf) return null;

    // Prefer the REAL per-encounter hp/mp (field_encounters, ROM-extracted) over the formula;
    // boss screens carry boss-specific values (e.g. Genji's Kuwagamon hp 100 / mp 9999).
    const { hp: eHp, mp: eMp } = enemyVitals(
      { hp: realHp, mp: realMp },
      {
        hp: eStats ? enemyHp(eStats, enemyLevel) : scaledHp(enemyProf, enemyLevel),
        mp: eStats ? enemyMp(eStats, enemyLevel) : scaledMp(enemyProf, enemyLevel),
      },
    );

    // FIGHTSTG_F0x8009ec94 scales the resolved species primary stats by the
    // encounter enemy-struct +0x0a halfword / 16. A value of 16 is identity.
    const scaledEnemyStat = (name) => eStats
      ? Math.trunc((Number(eStats[name] ?? 1) * enemyStatScale) / 16)
      : scaledStat(enemyProf, name, enemyLevel);
    return {
      profile: enemyProf,
      eStats,                                 // raw sdigiedt entry (null for legacy numeric enemies)
      fightSkill: eStats ? skillDB[eStats.attack] : null,
      level: enemyLevel,
      hp: eHp, maxHp: eHp,
      mp: eMp, maxMp: eMp,
      str: scaledEnemyStat("str"),
      def: scaledEnemyStat("def"),
      spt: scaledEnemyStat("spt"),
      wis: scaledEnemyStat("wis"),
      spd: scaledEnemyStat("spd"),
      // F0x8009f97c / F0x8009fab4 scale the attacking enemy's move power by
      // the same +0x0a halfword / 16, on top of the scaled stats above.
      powerScale: enemyStatScale,
      chr: 0,                                 // sdigiedt has no chr field
      // The enemy branch of F0x8009EC94 writes no accessory or weapon ladder byte,
      // so +0x28..+0x2A stay at the memset's 0 and +0x26 copies the live record's +0x0E.
      weaponFamilies: [],
      affinity: 0,
      // The live record's `+0x10` / `+0x12` / `+0x14`: the three signed stat modifiers
      // the category-5 stat arms write (`FIGHTSTG_F0x800a1aa8`, pro/fightstg.s:32295).
      // `effStats` adds them on top of the base fold above.
      statMods: { str: 0, def: 0, spd: 0 },
      ailments: {},
    };
  }

  // Materialize the three persistent roster records for battle.  Slot 0 remains
  // state.partnerStats for compatibility with existing saves; reserve slots are
  // the index-aligned partyStats records used by DRI/status/formation screens.
  function buildPlayerRoster(state) {
    const leadChar = state.manifest?.characters?.[state.charIdx]?.id;
    const partyIds = Array.isArray(state.party) && state.party.length
      ? state.party : (leadChar ? [leadChar] : []);
    if (!Array.isArray(state.partyStats) || state.partyStats.length !== partyIds.length)
      state.partyStats = partyIds.map((_, i) => i === 0 ? state.partnerStats : null);
    state.partyStats[0] = state.partnerStats;
    return partyIds.map((charId, index) => {
      const rookieId = Number(CHARID_TO_DIGID[charId]);
      const rookie = digimonDB[rookieId];
      if (index > 0 && !state.partyStats[index])
        state.partyStats[index] = baseStatsFor(rookie);
      return {
        index, charId, rookieId,
        // Which of the eight digivolution trees this line learns from. The unlock
        // routine is handed a roster slot, so the slot travels with the member.
        slot: rosterSlotOfCharId(charId) ?? rookieId - 1,
        name: state.digimonNames?.[charId] ?? rookie?.name ?? charId,
        stats: index === 0 ? state.partnerStats : state.partyStats[index],
      };
    }).filter((member) => member.stats && digimonDB[member.rookieId]);
  }

  // Build the resident live 0x20-style combat record for one roster member.
  // wfightmn F0x800a66b0 copies the persistent HP/MP/stat body once at battle
  // setup. Manual DV and Tag subsequently replace only record+0x00 (form id)
  // before reloading the model; they do not rebuild the live stat body.
  function buildPlayerRecord(member, requestedFormId = null) {
    const state = getState();
    const ps = member.stats;
    const configuredId = Number(ps.digimonId ?? member.rookieId);
    const formId = Number(requestedFormId ?? configuredId);
    const configuredProfile = digimonDB[configuredId] ?? digimonDB[member.rookieId];
    const profile = digimonDB[formId] ?? configuredProfile;
    const level = ps.level ?? 1;
    const bn = ps.bonuses ?? {};
    // Combat initialization reads the equipped slots themselves, the same
    // engine interpretation the status sheet and shop preview use. The cached
    // partnerStats.equipBonuses is display/charisma only and can go stale on a
    // path that changes a slot without syncing it (the shop counter did).
    const equipment = state.equipment?.[member.index] ?? {};
    // `member.slot` is the ROSTER slot, which is what the original's signature-set
    // table is keyed by (F0x80017174 indexes 0x8004B53C by the slot the save context
    // handed it), not the party position.
    const eb = equipmentBonuses(equipment, member.slot);
    const st = ensureStoredStats(ps, configuredProfile);
    const maxHp = Number(ps.maxHp ?? scaledHp(configuredProfile, level));
    const maxMp = Number(ps.maxMp ?? scaledMp(configuredProfile, level));
    const accFx = {};
    for (const f of eb.effects ?? []) accFx[f.kind] = (accFx[f.kind] ?? 0) + (f.amount || 1);
    // The MP proxies are slot-assigned, not cumulative: FIGHTSTG_F0x800a1d3c keeps
    // the LAST matching accessory slot (acc1 overwrites acc0), so both equipped
    // means one −10, never −15.
    const mpProxies = (eb.effects ?? []).filter((f) => f.kind === "mp_cost_down");
    const mpCostDown = mpProxies.length ? (mpProxies[mpProxies.length - 1].amount || 1) : 0;
    const pElem = { ...(ps.elemBonuses ?? {}) };
    for (const [el, v] of Object.entries(eb.elemResists ?? {})) pElem[el] = (pElem[el] ?? 0) + v;
    const pStatusRes = {};
    for (const [stName, v] of Object.entries(eb.statusResists ?? {}))
      pStatusRes[stName === "paralyze" ? "frozen" : stName] = v;
    const elemAttack = (eb.effects ?? []).find(f => f.kind === "elem_attack");
    // The effective crit byte (+0x38) has ONE writer at a time: the signature-weapon
    // ladder fills it for SaberFang/Shuriken and sets its own found flag, which makes
    // the Multi/Search/Counter crest rungs skip (fightstg.s:29521 `bnez $s3`). The
    // ladder walks roster +0x3C0/+0x3C4/+0x3C6 and steps over +0x3C2, so a body piece
    // is never a signature weapon.
    // So a signature weapon in head, right or left cancels the three crest effects.
    // The ladder visits head, right, left in that order and each crit rung overwrites
    // the byte (`sb $v0, 0x38($s2)` at 0x8009f1f0), so the LAST crit weapon wins.
    const crestOff = crestSuppressedByWeapon(equipment);
    let critByte = 0;
    for (const slot of ["head", "right", "left"]) {
      const id = equipment[slot];
      if (id != null && weaponCritByte(id) !== 0) critByte = weaponCritByte(id);
    }
    return {
      profile, level, rosterIndex: member.index, rookieId: member.rookieId, statsRecord: ps,
      // The species the numbers below belong to (F0x8009EC94's profile-block
      // species: the form the roster itself is in). While the live form differs
      // from it the live form's own base stats are added on every read.
      savedSpeciesId: configuredId,
      // The roster's own species record, the row savedSpeciesId names. The live
      // `profile` above is swapped by every form change, and F0x8009EC94 keeps
      // building the seven element values and the five status resistances from
      // THIS row before adding the live form's own on top.
      savedProfile: configuredProfile ?? profile,
      rosterSpeciesId: ps.digimonId ?? configuredId,
      hp: Math.min(Number(ps.hp ?? maxHp), maxHp),
      maxHp,
      mp: Math.min(Number(ps.mp ?? maxMp), maxMp),
      maxMp,
      // The five core stats F0x8009EC94 copies into the block at +0x02..+0x0A:
      // the member's own stored halfword with every worn piece's fold added by
      // F0x80017174 — capped on the RUNNING total at 999 by that producer's own add
      // (exe/fns.s:7837-7847) and floored at 1 by the block's copy
      // (pro/fightstg.s:29320-29326). CHR is not in the block: the five-word loop stops
      // at scratch +0x14, and the charisma gate clamps its own sum.
      str: battleCoreStat(st.str + (bn.str ?? 0), eb.str ?? 0),
      def: battleCoreStat(st.def + (bn.def ?? 0), eb.def ?? 0),
      spt: battleCoreStat(st.spt + (bn.spt ?? 0), eb.spt ?? 0),
      wis: battleCoreStat(st.wis + (bn.wis ?? 0), eb.wis ?? 0),
      spd: battleCoreStat(st.spd + (bn.spd ?? 0), eb.spd ?? 0),
      chr: st.chr + (bn.chr ?? 0) + (eb.chr ?? 0),
      elemBonuses: pElem,
      ailments: {},
      regeneration: !!accFx.regen,
      crit: critByte || (crestOff ? 0 : (accFx.crit_up ?? 0)),
      armor: accFx.damage_down ?? 0,
      // Combatant +0x3a / +0x3b: the worn weapon's byte +0x0E and the worn armour's
      // byte +0x10 accumulate into these pools, and the Glasses / DanceFeather
      // accessory rungs feed the same two bytes (claims EQUIP-C009, EQUIP-C016).
      accBonus: (eb.accPool ?? 0) + (accFx.accuracy_up ?? 0),
      evadeBonus: (eb.evadePool ?? 0) + (accFx.evade_up ?? 0),
      escapeBonus: accFx.escape_up ?? 0,
      mpCostDown,
      stealBonus: accFx.steal_up ?? 0,
      statusResists: pStatusRes,
      elemAttack: elemAttack ?? null,
      multiAttack: !crestOff && !!accFx.multi_attack,
      // Effective block +0x28..: the stat-record byte +0x12 of the worn family
      // 2..14 pieces (Dramon Guard / Dramon Horn carry 11, the Paildramon line).
      // F0x8009f6dc stage 2 adds half again (x1.5) to a plain attack on a match.
      weaponFamilies: wornFamilyBytes(equipment),
      // Effective block +0x26, the affinity multiplier. F0x8009EC94 copies it from
      // the live record's +0x0E, whose writer is not located; the walker's own live
      // record carries none, which is what every captured battle shows.
      affinity: 0,
      // The live record's `+0x10` / `+0x12` / `+0x14`, as on the enemy record: the
      // category-5 stat arms' own writes, which `effStats` adds to the block.
      statMods: { str: 0, def: 0, spd: 0 },
      // The three PERSISTENT penalty halfwords the post-hit arms write (roster
      // `+0x42`/`+0x44`/`+0x46`), copied from the roster member at setup the way
      // `F0x800a66b0` copies the member's body into the live record. A penalty dealt in an
      // earlier battle is on `ps` and shows up here; `effStats` subtracts it.
      statPenalty: statPenaltyOf({ statPenalty: ps.statPenalty }),
      binderCrest: !!accFx.no_flee,
      counterCrest: !crestOff && !!accFx.counter,
      gaugeAccessories: [equipment.acc0, equipment.acc1].filter(Boolean),
      // Right-hand weapon id — its signature secondary (poison/frozen/confuse/
      // KO) is gated on a plain attack; see weaponSecondaryProc.
      rightWeapon: equipment.right ?? null,
      gauge: normalizeDvGauge(ps.dvGauge),
    };
  }

  async function swapPlayerModel(name) {
    if (!renderer3d) return false;
    const folder = await resolveModelFolder(name);
    if (!folder || !renderer3d) return false;
    return renderer3d.setPlayerDigimon(folder);
  }

  // Swap the on-screen 3D enemy model when the next boss-party member steps in.
  async function swapEnemyModel(name) {
    if (!renderer3d) return;
    const folder = await resolveModelFolder(name);
    if (folder && renderer3d) renderer3d.setEnemyDigimon(folder);
  }

  // enemyId: string name (enemies.json enemy_id) OR numeric digimon profile id (legacy).
  // `party`: optional array of encounter entries {enemyId,enemyLevel,enemyHp,enemyMp} fought
  // sequentially (boss gauntlet); when omitted, the scalar enemy* args form a 1-member party.
  // Battle music for a rolled screen_id: the battle-trigger record's tag field
  // (battle_music.json — fieldstg 0x80092780 copies record+0x8 → 0x80042b30,
  // wfightmn plays it; archive=(id>>18)&0x7f). Stage-local record first (4
  // screens collide across stages), then global; batl00 = the documented
  // default written by wfightts@0xebc for non-trigger battles.
  function musicForScreen(screenId, mapId) {
    if (screenId == null || !battleMusicDB) return "batl00";
    const sk = mapId ? "s" + String(mapId).replace(/^s/, "") : null;
    const local = sk ? (battleMusicDB[sk] || []).find(r => r.screen_id === screenId) : null;
    if (local) return local.bank;
    for (const recs of Object.values(battleMusicDB)) {
      const r = recs.find(r => r.screen_id === screenId);
      if (r) return r.bank;
    }
    return "batl00";
  }

  async function start({ enemyId, enemyLevel, enemyHp: realHp, enemyMp: realMp, party, screenId, mapId, onWin, onFlee, onLose }) {
    await loadData();
    // The decoded message banks, so the panel can put the game's own words on the line
    // from the very first message rather than the walker's English: bank 0x7f for the
    // lines themselves, and bank 0x6a for the item name kind 14's second slot holds.
    await battleMsgBank();
    await battleMsgBank(ui.BATTLE_MESSAGE_BANK_FIELD);
    // Phase 6.3 group 4: start fetching pro/fightstg now so the intro covers the
    // overlay's one-time load and the command list is up on the first frame the
    // player can act, and run the original battle boot pipeline (pro/wfightmn).
    if (USE_NATIVE_COMMAND) commandNative.preload();
    if (USE_TRANSLATED_TECH) techNative.preload();
    if (USE_TRANSLATED_TAG) tagNative.preload();
    if (USE_TRANSLATED_FORM) formNative.preload();
    if (USE_TRANSLATED_DNA) dnaNative.preload();
    if (USE_NATIVE_WFIGHT) wfightNative.open();
    const state      = getState();
    const playerProf = getPlayerProfile(state);
    if (!playerProf) return;

    const playerRoster = buildPlayerRoster(state);
    if (!playerRoster.length) return;
    const playerRecords = playerRoster.map((member, index) =>
      buildPlayerRecord(member, index === 0 ? playerProf.id : null));
    const initialPlayer = playerRecords[0];

    const partyEntries = (party && party.length)
      ? party
      : [{ enemyId, enemyLevel, enemyHp: realHp, enemyMp: realMp, enemyStatScale: 16 }];
    const enemyObj = buildEnemyRecord(partyEntries[0]);
    if (!enemyObj) return;
    const battleConfig = fieldEncDB?.battle_config?.[String(screenId)] ?? null;
    const effectGates = battleConfig?.effect_gates ?? {};
    const statusImmunities = Object.fromEntries(
      ["poison", "frozen", "confuse", "sleep", "ko"].map(k => [k, !!effectGates[k]]),
    );
    enemyObj.statusImmunities = statusImmunities;

    battle = {
      state: ST.INTRO,
      timer: 0,
      message: "",
      // The field state accessor, carried on the record so the SHARED routines
      // that save a gauge (persistPlayerGauge, and through it the original's
      // reserved-second-form release) can reach it without living inside this
      // factory. Nothing else reads it.
      getState,
      // The battle's OPENING PHASE MACHINE (engine/dw3/battle-opening-machine.ts):
      // the walker's flat INTRO timer is replaced by the original's seven phases,
      // run one per frame, exiting (top state 1) into the turn machinery. The line
      // is armed at phase 5, exactly where the original opens its window.
      _opening: newOpeningState(),
      _introLineArmed: false,
      // Phase 1's opening-line gate F0x800a684c is ported (openingLineRoll). Its three
      // encounter inputs ([0x80042B1C]+0x3C/+0x1C and the party record's +0x784) are not
      // extracted into the walker's data, so the default weight arms the opening line
      // exactly as the walker always did. `?introNoLine=1` forces the no-line branch.
      _introLineWeight: FORCE_INTRO_NO_LINE ? 0 : 1,

      player: initialPlayer,
      playerRoster,
      playerRecords,
      activePlayerIndex: 0,
      participantIndices: new Set([0]),
      enemy: enemyObj,
      party: partyEntries,                 // sequential boss gauntlet (1+ members)
      partyIndex: 0,
      screenId,                            // battle id — keys progression.battle_rewards
      mapId,                               // field screen the fight started on (Cardmon booster)
      effectGates,
      // The raw 0x80042b58..0x80042b65 encounter config bytes; check_move_cond 13
      // tests byte 1.
      encounterGateBytes: battleConfig?.raw_2b58_2b65 ?? null,
      statusImmunities,
      specialMode: specialBattleMode(mapId, Number(screenId)),
      // The finale's live phase state (claim wfightmn-finale-kinds-2026-10-10): the
      // kind word's 4 -> 5 -> 6 advance. `_finaleKind` is null until the tail falls
      // (the live kind is then `specialMode`, 4); `_finaleRecordedTechId` is the
      // technique latched while the tail stands (F0x800aa06c); `_finaleCopiedAttack`
      // is the head's rebuilt attack record (arm 22 state 2); `_finaleAfter` runs the
      // next scripted beat once the current result pages are read.
      _finaleKind: null,
      _finaleRecordedTechId: 0,
      _finaleCopiedAttack: null,
      _finaleAfter: null,
      _loot: { drops: [] },                 // drop list; endBattle banks every name here

      menuSel: 0,
      techSel: 0,
      itemSel: 0,
      tagSel: 0,
      // The TAG list's own row word: the original's caller-side row counter, the
      // cell the screen reads to open on (fightstg.s:21258-21260) and writes the
      // confirmed row back into (fightstg.s:21312). It belongs to the ported
      // screen, not to the walker's own list: `tagSel` indexes tagMembers(),
      // which is the hp>0 list, so the two are different row spaces and the
      // forced TAG after a knock-out (which DOES list a fallen partner) cannot
      // borrow it.
      tagRow: 0,
      formSel: 0,
      tagTargetIndex: null,
      pendingAction: null,
      playerFirst: true,
      // The command phase's Frozen gate (`frozenGateLosesTurn`) rolls once per turn and
      // latches against `_turnSeq`, the walker's turn identity.
      _turnSeq: 0,
      _frozenGateTurn: -1,
      _frozenGateLost: false,
      timeline: initialActorTimeline(initialPlayer.spd, enemyObj.spd),
      // The 99-slot, 28-byte-stride status-event pool at 0x800a3868. It holds EVERY timed
      // battle effect — the stat changes, the two locks, the poison tick and the three
      // ailment recoveries — and `statusEventQueueAdvance` is its clock. Both records are
      // linked to the SAME array and to the side byte / active slot their stagers are
      // handed, because in the original the pool is global and the stagers take
      // `andi $s2, $a0, 0xff` (0 or 0x10) plus `[0x800a4468 + 4 * (side != 0)]`.
      statusEvents: emptyStatusEventPool(),
      onWin,
      onFlee,
      onLose,
      // The plate object is built on its first tick (hpPlateOf), which is the
      // original's build arm: both bars start on the live HP with no tween.
      _hudClock: 0,
    };
    // ?legacyIntroTimer=1 keeps the walker's old behaviour verbatim: the "Ambush!" line
    // is armed at creation and a flat 1.2 s timer hands the menu the turn. The default
    // route runs the ported seven-phase machine instead.
    if (USE_LEGACY_INTRO_TIMER) {
      battle.message = "Ambush!";
      battle._msgSpec = { kind: MSG_KIND.ONE_LINE, payload: [MSG.AMBUSH] };
      battle._msgSpecFor = "Ambush!";
      battle._introLineArmed = true;
    }
    renderer3d?.setFaceCamVisible?.(true);
    // Both sides reach the SAME pool and name themselves in the original's own terms, so
    // `applyAilment` can queue a recovery without knowing which battle it is in. The side
    // bytes are 0 and 0x10 (the `andi $s2, $a0, 0xff` over the two side words every
    // stager does), and each side's active fighter slot is 0.
    for (const [side, rec] of [[0, battle.player], [0x10, battle.enemy]]) {
      if (!rec) continue;
      rec.statusEvents = battle.statusEvents;
      rec.sideByte = side;
      rec.slot = 0;
      // The accuracy leaf F0x800a06ac's kind word (0x800a4536). The walker's
      // `specialMode` IS that word for the scripted battles (WFIGHTMN's init writes
      // 1..4 by field-screen/battle-id pair); the finale's own 4 -> 5 -> 6 advance
      // (runFinaleBeat) restamps both records as the phases change, so the kind-6
      // fixed roll fires from the head phase on.
      rec.battleKind = battleKindOf(battle);
    }

    // The field's own handoff cues ENCOUNTS once, on the transition's first frame:
    // pro/fieldstg F0x80089F7C (the checkerboard handoff, chosen when the scene
    // descriptor's +0x5C is non-zero by the type-7 manager F0x8008AA10 case 2 and by
    // the stage-change router; the iris/tile wipe F0x8008A5E4 is the ==0 fallback)
    // plays 0x00040005 in its state-0 arm through the canonical play cell
    // [0x80055c48] (fieldstg.s .L0x00007448-.L0x00007458; s0 = 0x800519ec, +0x425c).
    // Every stop of the field into a battle is that handoff, so the cue belongs here.
    sfx?.play("encounts");

    // Battle music: per-battle packed id at battle-struct+0x2b30 = the
    // trigger record's tag (mined into battle_music.json — batl00/batl10 for
    // regular zones, bossNN for boss screens). batl00 default for battles
    // with no trigger record (wfightts@0xebc). Restored in endBattle.
    // `_battleTrack` is the walker's live value of that register: the final
    // boss's phase transition overwrites it (0x60980000 at fightstg 0x80086ea0)
    // and the digivolution path replays it (fightstg .L0x8008a768).
    if (bgm) {
      battle._fieldTrack = bgm.current;
      battle._battleTrack = musicForScreen(screenId, mapId);
      bgm.play(battle._battleTrack);
    }

    // Grow the canvas to fullscreen BEFORE creating the offscreen (it sizes to canvas).
    enterBattleFullscreen();
    // Kick off 3D renderer asynchronously (textures load in background)
    _init3DRenderer(battle);
  }

  // Start a random encounter for (mapId, player x,y). Returns true if a battle started,
  // false when the authentic roll lands on an empty slot (no encounter this step). Wild
  // walk-up encounters are always a SINGLE Digimon (user-confirmed in-game) — the multi-member
  // screens in the stage pool are scripted boss screens, so we fight only the lead here. The
  // sequential gauntlet (full party) is reserved for scripted battles via startParty.
  async function startRandom(mapId, x, y, onWin, onFlee, onLose) {
    await loadData();
    const roll = pickEnemy(mapId, x, y);
    if (!roll) return false;
    return startParty([roll.party[0]], onWin, onFlee, onLose, { screenId: roll.screen, mapId });
  }

  // The authentic party for a global screen_id (field_encounters.json), e.g. screen
  // 200 = Genji's Kuwagamon. Used by the story engine to fight a scripted battle.
  function partyForScreen(screenId) {
    return fieldEncDB?.screens?.[String(screenId)] ?? null;
  }

  // The trigger-table screens for a stage (stage_encounters.json, the scene_ctx+0x18
  // pools). The story engine validates a scripted battle's screen_id against these so
  // it never fires a fight the field engine wouldn't roll for that stage.
  function triggersForStage(mapId) {
    const key = String(mapId).replace(/^s/, "");
    const st = stageEncDB?.stages?.[key];
    if (!st) return [];
    const out = new Set();
    for (const z of st.zones || []) for (const s of z.slots || []) if (s) out.add(s);
    return [...out];
  }

  // Start a battle from a global screen_id, resolving the party HERE.
  //
  // `partyForScreen` is synchronous and reads a table this module loads lazily,
  // so it answers null until something has already fought. Any caller that
  // resolves the party itself and then starts the battle therefore silently
  // does nothing on the first fight of a session. This awaits the load first,
  // which is the only safe order for a caller holding just a screen id.
  async function startScreen(screenId, onWin, onFlee, onLose, { mapId, lead = true } = {}) {
    await loadData();
    const party = partyForScreen(screenId);
    if (!party || !party.length) {
      console.warn("[battle] no party for screen", screenId, "on", mapId);
      return false;
    }
    return startParty(lead ? [party[0]] : party, onWin, onFlee, onLose, { screenId, mapId });
  }

  // Start a battle from a resolved party array (1v1: take the lead, as startRandom).
  async function startParty(party, onWin, onFlee, onLose, { screenId, mapId } = {}) {
    await loadData();
    if (!party || !party.length) return false;
    // F0x8008B798: the field's handoff runs its pre-battle presentation first —
    // at ordinal 43, MOVIED08_STR, whose own return selector is this battle. The
    // handler resolves when the movie is over (or immediately when none is due).
    if (fieldMovieHandoff) await fieldMovieHandoff({ screenId, mapId });
    // Fight every member sequentially (boss gauntlet); random encounters are 1-member parties.
    const entries = party.map(e => ({
      enemyId: e.name, enemyLevel: e.level, enemyHp: e.hp, enemyMp: e.mp,
      enemyStatScale: e.stat_scale ?? 16,
    }));
    await start({ party: entries, screenId, mapId, onWin, onFlee, onLose });
    return true;
  }

  function playerTechs() {
    if (!battle) return [];
    const partner = battle.player.statsRecord;
    const currentId = battle.player.profile.id;
    partner.formLedger ??= Object.entries(partner.dvexpByForm ?? {}).map(([id, dvexp]) => ({
      id: Number(id), formLevel: dvLevelForExp(Number(dvexp) || 0, digimonDB?.[id]?.dv_cap ?? 100),
      dvexp: Number(dvexp) || 0, techSlots: [],
    }));
    // Rookie: signature only. A digivolution contributes its six learned slots,
    // then loaded ordinary slots from the other equipped forms are merged in.
    // Keep the flagged halfword with each entry: the price rule reads 0x4000, and
    // the id alone cannot distinguish a native use from a loaned one.
    const flagged = battleTechWords({
      ledger: partner?.formLedger,
      currentId,
      equippedForms: partner?.equippedForms,
      signatureTech: battle.player.profile.tech_signature ?? battle.player.profile.techs?.[1] ?? 0,
    });
    return flagged
      .map((word) => {
        const skill = skillDB[Number(word) & 0x1fff];
        return skill ? { ...skill, techWord: Number(word) & 0xffff } : null;
      })
      .filter(Boolean);
  }

  function usableItems() {
    const state = getState();
    // The original's in-battle ITEM list is F0x800135E8 over directory 1 (the
    // consumables / disks / booster band) in TABLE ORDER, so two players holding
    // the same items read the same rows top to bottom however they got them.
    return listItemIds(state, 1)
      .map(id => {
        // Import ITEM_BY_ID lazily via window.__itemById if wired
        const item = window.__ITEM_BY_ID?.[id];
        return item ? { ...item, qty: heldCount(state, id) } : null;
      })
      .filter(Boolean)
      // The same effect-record gate as the translated list, not effect labels.
      // F0x800135E8 supplies the carried directory members in table order.
      // FIGHTSTG then reads bit 1 from each member's effect record.
      // This shares admission with the route census over the shipped catalog.
      // Chips and booster packs therefore do not enter the battle list.
      .filter(i => itemUsableInBattle(i.id));
  }

  function tagMembers() {
    if (!battle) return [];
    const liveRoster = battle.playerRecords.map((record) => ({ stats: { hp: record.hp } }));
    return tagCandidateIndices(liveRoster, battle.activePlayerIndex)
      .map((index) => ({
        ...battle.playerRoster[index],
        stats: {
          ...battle.playerRoster[index].stats,
          hp: battle.playerRecords[index].hp,
          maxHp: battle.playerRecords[index].maxHp,
          mp: battle.playerRecords[index].mp,
          maxMp: battle.playerRecords[index].maxMp,
        },
        rosterIndex: index,
      }));
  }

  function formOptionsFor(rosterIndex) {
    const member = battle?.playerRoster?.[rosterIndex];
    if (!member) return [];
    // The list starts at the form the member is in NOW, not at its base form:
    // F0x80094478 reads the profile block's own first halfword for the row it
    // greys, and that halfword is the live record's species. The two are the same
    // number for most of a battle and different after a DV or a Tag.
    return battleFormIds(liveFormId(battle, rosterIndex), member.stats)
      .map((id) => digimonDB[id]).filter(Boolean);
  }

  function battleFormLevel(rosterIndex, formId) {
    const member = battle?.playerRoster?.[rosterIndex];
    const record = member?.stats?.formLedger?.find((r) => Number(r.id) === Number(formId));
    return Number(record?.formLevel ?? (Number(formId) === liveFormId(battle, rosterIndex)
      ? member?.stats?.level : 0)) || 0;
  }

  /**
   * The bytes the DNA command's rule reads, at their own addresses: the 55
   * profile records at 0x8003EF5C (the pane's species strip starts on the same
   * table) and the 18-byte technique records at 0x80042BDC. These are the two
   * tables web/battledna-translated.js loads for the pane, handed out by
   * `dnaNative.tables()`, so the pane and the command path read one copy of one
   * table rather than two copies of two. `techniques` is left out by the one
   * caller that only asks which profile row a form sits in.
   */
  function dnaTableReader(species, techniques) {
    const ranges = [
      [DNA_SPECIES_TABLE, species],
      ...(techniques ? [[DNA_PRICES, techniques]] : []),
    ];
    const byte = (addr) => {
      for (const [base, bytes] of ranges) {
        const at = addr - base;
        if (at >= 0 && at < bytes.length) return bytes[at];
      }
      return 0;
    };
    return {
      read8: (addr) => byte(addr) & 0xff,
      read16: (addr) => (byte(addr) | (byte(addr + 1) << 8)) & 0xffff,
    };
  }

  /**
   * The profile record for one of the walker's own Digimon.
   *
   * The game's profile table is 55 rows of 0x58 bytes and digimon.json's 55
   * profiles are those rows in the same order — read straight out of the two
   * files, every row's halfword at +0x2A equals that profile's `tech_dna_dv`
   * and every row's byte at +0x55 equals its own 1-based index
   * (tests/lane-b/dna-command.test.js checks all 55 both ways).
   *
   * The row is not worked out here. It is asked of the SAME mapping the DNA pane
   * uses on its seed (`ui.walkerProfileRow`, native/pause-status.ts): walker id ->
   * the row's own `value0` halfword -> the row the species getter [0x8005CCA0]
   * would answer for that form id. One rule for both id spaces.
   */
  function dnaProfileRecord(reader, profile) {
    const row = walkerProfileRow(reader, Number(profile?.id ?? 0));
    return row < 0 ? 0 : (DNA_SPECIES_TABLE + DNA_COMBATANT_STRIDE * row) >>> 0;
  }

  /**
   * The fused form for one DNA action, from the game's loaded tables.
   *
   * `dnaFusedForm` at module level does the work and carries the decode notes;
   * this hands it the scripts `loadData` fetched and the profile-table bytes the
   * DNA pane already has. The model number the script spawns is the profile
   * table's own row-0 halfword (383 for Kotemon, whose pack folder is m383pken;
   * 468, 469 and 470 for Agunimon, BladeGarurumon and AncientGreymon), so the
   * roster row carrying it is found by reading the same table the pairing rule
   * uses — no name table, no transcription.
   */
  function jogressFused(actionId, profiles) {
    return dnaFusedForm(jogressDB, profiles, actionId, digimonDB);
  }

  /**
   * The DNA command's answer, by the original's rule and nothing else.
   *
   * FIGHTSTG_F0x800980e4 :22132-22163 (0x8009832c-0x800983b8) reads the acting
   * member's profile byte +0x3D, the cursor species' own +0x55, and on a match
   * the acting record's halfword +0x2A; the confirm at :22296-22301 (0x800985b4)
   * charges the halfword at 0x80042BDC + 0x12*(that id - 1) off BOTH members.
   * F0x8008f714 (0x8008f760-0x8008f7d4) then runs that same id's own 18-byte
   * record as the action, and its clip byte at +0x10 is 12 for every DNA result
   * — the Jogress director, presentation command 0x3A.
   *
   * Nothing here consults the walker's own DNA evolution table. It used to, twice:
   * `findDnaEvolution` matched the two parents by NAME and LEVEL, and
   * `dnaFusedProfiles` renamed the result from the same transcription (a
   * hand-written Rust file, not the disc). Both are gone; the pair, the price, the
   * attack and the form that appears are four reads of disc data.
   *
   * The fused form is disc data all the way down: the director script names a
   * model id, that id is the profile table's own `+0x00` halfword, and the roster
   * row that carries it holds the name the DNA pane and the name bank use. All ten
   * of the game's fusions are roster Digimon — Paildramon, Phoenixmon,
   * MegaGargomon, Omnimon, Imperialdramon-P, Beelzemon, Diaboromon, Agunimon,
   * BladeGarurumon and AncientGreymon.
   *
   * What the walker still cannot do is DRAW the last three: Agunimon,
   * BladeGarurumon and AncientGreymon are models 468, 469 and 470, and those are
   * the three smdldata keys with no extracted pack folder
   * (docs/research/battle/smdldata-container-2026-08-05.md). The name is right, the
   * mesh is missing; the presentation falls back to the acting form for those three
   * and says nothing different about it.
   */
  function dnaChoiceFor(rosterIndex, partnerProfile) {
    const b = battle;
    const tables = dnaNative?.tables?.();
    if (!b || !partnerProfile || !tables) return null;
    const reader = dnaTableReader(tables.profiles, tables.techniques);
    const mine = dnaProfileRecord(reader, b.player.profile);
    const theirs = dnaProfileRecord(reader, partnerProfile);
    const pairing = dnaPairing(reader, mine, theirs);
    if (pairing === null) return null;
    const tech = dnaActionRecord(reader, pairing.resultId);
    // 0x8008f7cc: a record whose clip byte is not 12 is an ordinary action, and
    // then it is not this command's action to run.
    if (!tech || tech.clip !== DNA_PARENT_CLIP) return null;
    const jogress = jogressFused(pairing.resultId, tables.profiles);
    const fused = jogress?.profile ?? null;
    return {
      resultId: pairing.resultId,
      // Both members pay the full price: 0x8009864c and 0x80098680.
      cost: pairing.price,
      tech,
      // The director script's own fused model and the roster row that carries it.
      fusedModel: jogress?.fusedModel ?? null,
      fusedName: fused?.name ?? null,
      // The mesh to put in the result slot. Only a director script can name one;
      // without one the acting form holds the slot, as it always did.
      resultProfile: fused ?? b.player.profile,
      fused,
    };
  }

  // ── Update ──

  // True while an attack/reaction animation sequence is still playing (the action VM or the
  // defender's reaction VM is running). Used to gate turn transitions on the animation instead of
  // fixed timers, so the enemy doesn't start its own attack while the player's attack/recoil is
  // still on screen. Capped by the caller so a held motion can't stall the battle.
  function animBusy() {
    return !!(renderer3d && renderer3d.coordinator && renderer3d.coordinator.active);
  }

  /**
   * Arm a technique's result so it lands when the ACTION is over, not only on a contact.
   *
   * **A technique's result page is the record machine's, and the record machine never
   * reads the animation.** Its apply arm is entered from the technique-execution object's
   * own step and its only gate is the technique record's category byte
   * (`pro/fightstg.s:13114` `.L0x8008f980` sltiu $v0, $v1, 0x5` over
   * `lbu $v0, 0x4($s5)` at `:13111`); nothing on the way there looks at record `+0x10`,
   * the clip the animation plays. The action script's contact opcode is presentation:
   * `FIGHTSTG_F0x8008c454` (op10) only spawns an effect and reads the attacker's active
   * part. So a clip that fires no contact must still produce its page.
   *
   * The 443 records group by clip, and seven of them — the field techniques 213..219 —
   * sit on clip 15, whose script is `op4 / op4 / wait 90 / op4 / wait 60 / op255` in
   * every one of the 53 models that have it: no `op10` at all, so no contact. Before
   * this, those techniques put up no page of any kind and the walker's own HP arithmetic
   * never ran either. Rather than a rule per technique, every one of the three
   * `commitImpact` sites (the basic attack, the player's technique and the enemy's) arms
   * itself here, and `commitPendingImpact` runs it once the action is over. The contact
   * stays the EARLY commit, so every technique that has one still lands its page at the
   * strike.
   */
  function armPendingImpact(b, commit) {
    // Whichever way the result lands — the contact or the end of the action — the
    // armed slot is cleared, so an early contact cannot leave a second commit pending.
    const armed = () => {
      if (b._pendingImpact === armed) b._pendingImpact = null;
      commit();
    };
    b._pendingImpact = armed;
  }

  /** Run an armed result once no action is playing. The armed closure is one-shot. */
  function commitPendingImpact(b) {
    const commit = b._pendingImpact;
    if (!commit || animBusy()) return false;
    b._pendingImpact = null;
    commit();
    return true;
  }

  /**
   * The final boss's scripted phase transition — the ONE mid-battle boss-track play.
   *
   * WFIGHTMN zeroes the two transition counters only for battle 0x144, the Galacticmon
   * sequence (.L0x00001090-.L0x0000109c: mode 4, then `sb 0, +0xdb` / `sb 0, +0xda`).
   * Its damage-apply wrapper F0x800aab10 counts player-side applications whose delta is
   * nonzero (.L0x00004d30-.L0x00004da8) — but only while the kind word is 6, the head
   * phase (`.L0x00004d48-.L0x00004d50`: `lh $v1, 0xd6` / `li $v0, 6` / `bne` returns),
   * and only until `+0xdb` is set. On the third it calls fightstg F0x8009d06c, which
   * spawns battle effect 0x1d3 (.L0x8009d0a0), latches `+0xdb := 1` (:27300-:27303) and
   * enqueues kind 0x18. That effect's actor F0x80086a00 then plays 0x60980000 = archive
   * 38 boss04 (LASTB_02) through [0x80055c48] and saves it to [0x80042b30]
   * (.L0x80086e84-.L0x80086ea0) — the only battle-side boss-track play in the whole
   * game (sound-system.md 2026-07-03h).
   */
  function noteFinalBossPhaseDamage(b) {
    if (b._bossPhaseDone) return;
    // The wrapper's own kind gate: +0xda counts only while the head stands. The walker's
    // three call sites are the player's own landed damaging commits (basic, technique,
    // DNA) — the closest faithful condition for the wrapper's per-application count,
    // which is only reachable through a pointer in the original.
    if (battleKindOf(b) !== 6) return;
    b._bossPhaseCount = (b._bossPhaseCount ?? 0) + 1;
    if (!finalBossPhaseSwitchesTrack(b.specialMode, battleKindOf(b), b._bossPhaseCount)) return;
    b._bossPhaseDone = true;
    b._battleTrack = "boss04";   // the register update at .L0x00086ea0
    bgm?.play(b._battleTrack);
  }

  /**
   * The Frozen gate in front of the command menu — `F0x800a7418` step 1, the one place
   * in the battle where the menu is armed.
   *
   * The original's step 1 waits while a line is up (`wfightmn.s:1494-1496`, file
   * `0x173c-0x1744`, the read the walker already does in `commandPhaseWaitsForLine`), then
   * resolves the ACTING Digimon — `0x800a4470 + 32*[0x800a4468]` (`:1498-1502`) — and tests
   * its status byte `+0x1c` (`:1503-1506`, file `0x1760-0x176c`):
   *
   * * `& 0x2` (Frozen) -> the roll at `[0x800a4660](0)`, i.e. `F0x800a19d8` called with
   *   the argument `0` = the player side (`:1507-1512`, file `0x1770-0x1784`). A nonzero
   *   return BLOCKS the turn: message `0x56` "Frozen and can't move!" is put up through the
   *   line object's `+0xac` with kind 2 and the pair at `instr+0x50` (`:1514-1525`, file
   *   `0x178c-0x17b8`), so the panel reads the partner's name on line one and the game's
   *   sentence on line two. A zero return falls through to the confuse test.
   * * `& 0x4` (Confused) -> `instr+0x2C(0x11)`, state 17 = the joke handler (`:1541-1550`,
   *   file `0x17f8-0x181c`); the walker's own confused menu is that path, not this gate's.
   * * otherwise -> `jal 0x80092d80` with argument 2 arms the command list and the step
   *   counter moves to 2 (`:1552-1556`, file `0x1824-0x1834`).
   *
   * What the blocked turn does next is the tail at `:1526-1540` (file `0x17bc-0x17f4`):
   * the speed-relative
   * delay `[0x800a437c](0, 0)` (`F0x8009bda4` opcode 0 = `clamp(1000*sqrt(SPDopp/SPDown),
   * 707, 1414)`) is handed to `F0x8009c4bc`, which re-enqueues the player action event at
   * that cost, and only then `instr+0x2C(2)` returns control to the controller. So the turn
   * is lost at the ordinary turn cost and the enemy still gets its own turn — which is what
   * `queueAfterAction(b, "player")` is. No command is committed and no list ever opens.
   *
   * The roll is taken ONCE per turn, when the command phase arrives: `+0x14` is the
   * instruction's own step, and step 1 is passed for good the moment the list is armed,
   * so cancelling out of TECH and back does not roll again. `_turnSeq` is the walker's
   * turn identity for that purpose and moves whenever the shared scheduler advances the
   * timeline (`queueAfterAction`, `defeatCurrentEnemy`).
   *
   * Returns true when the turn is already lost, so no pad press reaches the list.
   */
  function frozenGateLosesTurn(b) {
    if (b._frozenGateTurn === b._turnSeq) return b._frozenGateLost === true;
    b._frozenGateTurn = b._turnSeq;
    if (!frozenGateBlocksTurn(b.player, RAND_U16)) {
      b._frozenGateLost = false;
      return false;
    }
    b._frozenGateLost = true;
    b.pendingAction = null;
    const pname = b.player.profile.name;
    sayOriginal(b, {
      kind: MSG_KIND.OUTCOME, payload: [MSG.FROZEN_BLOCK], name: pname,
    }, `${pname} is frozen and can't move!`);
    // The lost turn is a real turn on the shared timeline: the enemy still acts before
    // the partner's command phase comes round again.
    queueAfterAction(b, "player");
    return true;
  }

  /** The battle loop's call into the pool; the body is the exported advance below. */
  function statusEventQueueAdvance(b) {
    return battleStatusEventAdvance(b);
  }

  function queueAfterAction(b, acted) {
    // A new turn on the shared timeline, so the command phase's Frozen gate rolls again
    // (F0x800a7418 step 1 runs once per player turn, `wfightmn.s:1494-1540`).
    b._turnSeq = (b._turnSeq ?? 0) + 1;
    const step = scheduleNextActor(b.timeline, acted, b.player.spd, b.enemy.spd);
    // THE STATUS-EVENT QUEUE IS THE BATTLE CLOCK. `FIGHTSTG_F0x8009ba4c`
    // (`pro/fightstg.s:25779`) has no frame tick: every action-resolution epilogue asks
    // `[0x800a437c](side, 0)` for the next delay and re-enqueues the turn event with it
    // (`pro/wfightmn.s:4090`-`:4098`), and the pool's own `+0x2` fields are what comes
    // off. So the walker's advance is the original's `delay(side, 0)` -- `trunc(1000 *
    // opp.SPD / isqrt(own.SPD * opp.SPD))` clamped to `[707, 1414]` -- and the expiries it
    // produces are the ones a player sees: a buff that wears off, a lock that releases.
    // The poison tick and the three cures are POOL EXPIRIES, so their box pages come out
    // of the advance below rather than out of a per-ailment countdown. The two slots the
    // advance writes are cleared FIRST, or the previous turn's would be re-read.
    b._poisonTick = null;
    b._ailmentCures = [];
    statusEventQueueAdvance(b);
    const events = advanceAilmentTimeline([b.player, b.enemy], step.elapsed);
    // Each status moment is a battle message box PAGE of its own, in the original: the
    // poison tick is one line object and one `+0xac` call with kind 15, and the shared
    // tail fills line one with the name.
    const pages = [];
    const poisonTotals = new Map();
    if (b._poisonTick) poisonTotals.set(b._poisonTick.combatant, b._poisonTick.amount);
    for (const cure of (b._ailmentCures ?? [])) {
      const targetName = cure.combatant === b.player
        ? b.player.profile.name
        : (b.enemy.profile?.name ?? "Enemy");
      // The timed cure keeps the walker's own sentence: only Sleep's cure page is decoded
      // (FIGHTSTG_F0x80091534's twin at fightstg.s:14734, id 0x2b "Awake!", kind 7), and
      // the frozen/confuse/poison cure words have no writer anywhere in the two battle
      // overlays, so there is nothing to port here yet.
      pages.push({ text: `${targetName} recovered from ${cure.ailment}!`, spec: null });
    }
    for (const event of events) {
      const targetName = event.combatant === b.player
        ? b.player.profile.name
        : (b.enemy.profile?.name ?? "Enemy");
      if (event.kind === "regen") {
        // The gradual-HP-recovery source is an actor machine beside the poison tick
        // (pro/wfightmn.s `.L0x00002480`): one line object, one `+0xac` call with
        // **kind 10** (wfightmn.s:2428), whose arm (`.L0x80099a28`, fightstg.s:23651)
        // is the name plus `esmfight[0x27]` and writes NO numbered slot — so the box
        // says "HP gradually recovers." and the amount is left to the HP plate.
        pages.push({
          text: `${targetName} recovers ${event.amount} HP.`,
          spec: engineRegenTickMessageSpec(targetName, event.amount),
        });
      }
    }
    for (const [combatant, amount] of poisonTotals) {
      const targetName = combatant === b.player
        ? b.player.profile.name
        : (b.enemy.profile?.name ?? "Enemy");
      pages.unshift({
        text: `${targetName} is hurt by poison! ${amount} damage!`,
        spec: enginePoisonTickMessageSpec(targetName, amount),
      });
    }
    b._timelinePages = pages;
    b._timelineMessage = pages.map((page) => page.text).join("\n");
    b._nextState = step.next === "player" ? ST.PLAYER_MENU : ST.ENEMY_ACT;
  }

  /**
   * The battle message box's own page sequence: each entry is one line the player reads
   * and presses Circle on, in order, exactly as FIGHTSTG_F0x80091534's "apply what
   * landed" machine walks its effect slots (`fightstg.s:15262-15283` — one page per pass,
   * and a pass whose line slot is still occupied returns without building the next one).
   *
   * An entry is either the walker's own sentence, or `{ text, spec }` when the disc has
   * its own two lines for that page. `spec` (the third argument) is the shorthand for
   * "the first page's spec", for the callers that have one page and one arm.
   */
  function setResultPages(b, pages, spec) {
    const list = (pages || []).filter(Boolean).map((page) => (
      page && typeof page === "object"
        ? { text: String(page.text ?? ""), spec: page.spec ?? null }
        : { text: String(page), spec: null }
    ));
    b._resultPages = list.map((page) => page.text);
    b._resultPageSpecs = list.map((page) => page.spec);
    b._resultPageIndex = 0;
    b._resultReady = false;
    if (list.length) {
      const first = list[0].spec ?? spec ?? null;
      if (first) sayOriginal(b, first, list[0].text);
      else sayWalker(b, list[0].text);
    }
  }

  /**
   * Put up the page(s) an item's handler asked for.
   *
   * One page keeps the ordinary result line the item path has always used (it times out
   * on the walker's own 1 s beat, because the item's own line was never a Circle-gated
   * page). Two pages — the only handler in the band that makes two is ChaosWave's
   * rand&3 follow-up, where the second page names the player's own Digimon — go through
   * `setResultPages`, so the player presses Circle between them the way the original's
   * two line objects do (each handler returns while its line slot is occupied,
   * `lw $v0, ($s3); bnez $v0, ...` throughout 0x8008dcd8-0x8008ede8).
   *
   * `walker` is what `?legacyBattleMsg=1` and `peek()` still see; it is the old sentence
   * and it is never what the original's own panel draws.
   */
  function showItemPage(b, prefix, walker, pages) {
    const list = (pages || []).filter(Boolean).map((page) => ({
      text: page.name
        ? `${page.name} ${page.slots?.length ? `${page.slots[0]} ` : ""}`.trim()
        : "",
      spec: page.name
        ? { kind: page.kind, payload: page.payload, name: page.name, slots: page.slots ?? [] }
        : null,
    }));
    const text = prefix + walker;
    if (list.length <= 1) {
      const only = list[0];
      if (only?.spec) sayOriginal(b, only.spec, text);
      else sayWalker(b, text);
      return;
    }
    setResultPages(b, list.map((page) => ({ text: text, spec: page.spec })));
  }

/**
   * "<n> damage!" on the line, the way the original puts it up, decided by the RECORD
   * MACHINE rather than by the walker.
   *
   * The original's own chooser is `FIGHTSTG_F0x8008f714`, the machine that walks the
   * 18-byte technique records at `0x80042bca`. It dispatches on the record's category
   * byte (record +0x04) through the five-word table at `.L0x80083004` and, for the two
   * attack categories that cover 402 of the 443 techniques, it picks the page from the
   * action context: the hit flag `ctx+0x30` chooses `kind 4` `"{1} damage!"`, and its
   * clear chooses `kind 2` with `esmfight[0x1d]` "Evade!" (`pro/fightstg.s:13108`,
   * `:13121`, `:13172`). `engine/dw3/battle-damage-terms.ts` is the port of that chooser
   * and `damageTermPage()` is its entry point; this function only hands it the record
   * and the context.
   *
   * **The multi-attack tally is not one of the walker's reasons any more.** A technique
   * that hits `hits` times still produces ONE `kind 4` page carrying the total: the
   * original's arm writes no hit count anywhere, so there was never a " (3 hits)"
   * fragment for the walker to keep, and the `hits` term used to force this function to
   * return null and let a typed sentence into the box.
   *
   * Returns null only when the walker has words the original's line does not (a counter
   * reaction, a timeline prefix) — the original prints those as pages of their own, so
   * the box keeps the walker's own sentence rather than silently dropping them.
   *
   * A category-4 record is a HEAL or a CURE, not a hit, so its context is the heal the
   * walker actually applied: the amount and the target's missing HP (the pair the original
   * compares at `pro/fightstg.s:13572`-`:13577`, which caps the amount at the missing HP),
   * and the page names the healer, not the target.
   *
   * @param {string} name the Digimon that took the damage
   * @param {number} total the damage the box reports
   * @param {string} extra walker's own words that have no page in the original
   * @param {number} [techniqueId] the technique's id, for the record lookup
   * @param {number} [side] 0 the player's partner attacking, 1 the enemy
   * @param {{heal?: number, missingHp?: number, healer?: string}} [heal] the heal context,
   *   read only when the record's category is 4
   */
  function damageSpec(name, total, extra, techniqueId = 0, side = 1, heal = null) {
    if (extra) return null;
    const record = fightTechDB?.[String(techniqueId | 0)] ?? null;
    const isHeal = record?.category === 4;
    const page = damageTermPage(record, {
      techniqueId: techniqueId | 0,
      side,
      name: isHeal ? (heal?.healer ?? name) : name,
      damage: isHeal ? (heal?.heal ?? 0) : total,
      hitCount: 1,
      landed: isHeal ? (heal?.heal ?? 0) > 0 : true,
      applied: false,
      retaliated: false,
      suppressed: false,
    }, isHeal ? { missingHp: heal?.missingHp ?? 0 } : {});
    if (page) return { kind: page.kind, payload: page.payload, name: page.name, slots: page.slots };
    // No record on the disc for this id, or a category `sltiu $v0, $v1, 0x5` rejects:
    // the original's own fall-through (`:13115 beqz $v0, .L0x80090c1c`) builds no page,
    // so keep the walker's own `kind 4` line rather than inventing a category.
    return { kind: MSG_KIND.DAMAGE, payload: [0, total], name, slots: [String(total)] };
  }

  /**
   * The element NAME for a raw record byte +0x07. The raw technique table carries the
   * element id; the shipped skill bank carries the name. Build the id→name map from the
   * two shipped banks rather than hard-coding a table here.
   */
  let elem1NameCache = null;
  function elementNameForElem1(elem1) {
    if (!elem1NameCache) {
      elem1NameCache = {};
      for (const id of Object.keys(skillDB || {})) {
        const rec = fightTechDB?.[String(id)];
        const name = skillDB[id]?.element;
        if (rec && name) elem1NameCache[rec.elem1 | 0] = name;
      }
    }
    return elem1NameCache[elem1 | 0] ?? "normal";
  }

  /**
   * The magical damage leaf F0x8009fab4 (`[0x800a4580+0x88]`) for ONE hit slot's own
   * technique record: the browser's own port (`magicalBase` + `resolveDamage`) on the
   * disc's record for `slotTechId`.
   */
  function slotDamage(slotTechId, atk, def, rng, field) {
    const rec = fightTechDB?.[String(slotTechId | 0)];
    if (!rec) return 0;
    const sk = {
      id: slotTechId | 0,
      power: rec.power,
      element: elementNameForElem1(rec.elem1),
      attack_category: rec.category === 3 ? "magical" : "physical",
      // `resolveDamage` reads `magical` directly (buildAttack sets it from the category
      // before it reaches the leaves), and its accuracy default is the record's own 128.
      magical: rec.category === 3,
      base_acc: 128,
      target_family: rec.elem2,
      damage_scalar: rec.scalar,
      clip: rec.clip,
    };
    return Math.max(0, resolveDamage(magicalBase(atk, def, sk.power), atk, def, sk, rng, field) | 0);
  }

  /**
   * FIGHTSTG_F0x8009ddd8 — the move resolver FIGHTSTG_F0x8009e0cc's dispatch-byte-0x1f
   * arm, wired. The resolver writes the acting side to the action context +0x20 and the
   * technique id to +0x24 and, when the record's dispatch byte (`record +0x0a`) is 0x1f,
   * calls this reset INSTEAD of the path that carries one damage value. The reset seeds
   * two hit slots: for each it asks the magical ACCURACY leaf `[0x800a4580+0xa0]`
   * (F0x800a08c8) whether the slot lands, and for each landed slot calls the magical
   * DAMAGE leaf `[0x800a4580+0x88]` (F0x8009fab4) on the SLOT's own technique id
   * (0x1b9/0x1ba = 441/442, the last two of the 443 rows at 0x80042bca), storing the two
   * damages at ctx+0x60/ctx+0x64. The record machine applies their SUM
   * (`pro/fightstg.s:13154`-`:13158 lw $v0,0x60 / lw $v1,0x64 / addu / sw $v0,0x58`) and
   * prints ONE kind-4 damage page — there is no "\u00d7 hits" fragment on this arm.
   *
   * The two manager entries ARE the browser's own ports (the previous pass called +0x88 a
   * "message producer"; docs/research/battle/battle-formula-leaves.md settles it as the
   * magical damage leaf). The slot records come from the shipped `fight_tech_table.json`.
   */
  function resolveRepeatDispatch(attacker, defender, skill, sideByte, field) {
    const atk = effStats(attacker), def = effStats(defender);
    const damages = [0, 0];
    const slotViews = [0, 1].map((i) => ({
      setFlag: () => {},
      setCaption: (v) => { damages[i] = v | 0; },
    }));
    const manager = {
      // The manager's predicate is the MAGICAL accuracy leaf (+0xa0), read
      // unconditionally by F0x8009ddd8 (:28224 `lw $v0, 0xa0($s3)`) — not the
      // physical +0x9c entry.
      predicate: () => (rollMagicHit(atk, def, skill, RAND_U16) ? 1 : 0),
      produce: (_side, slotTechId) => slotDamage(slotTechId, atk, def, RAND_U16, field),
    };
    const state = { count: 0, total: 0, done: 0 };
    multiHitReset(slotViews, { side: () => sideByte, id: () => skill?.id ?? 0 }, manager, state);
    return { landed: state.count | 0, total: (damages[0] | 0) + (damages[1] | 0), damageBySlot: damages };
  }

  // Continue after the current action's result text has either timed out (ordinary results) or
  // been confirmed (the explicit impact/defeat sequence).
  function advanceAfterResult(b) {
    // The finale's scripted beats chain through here: once a beat's pages have been
    // read, the next beat runs (the kind advance, the body's cannon, the head swap).
    // Set only while the sequence is in flight, and cleared before it runs so a beat
    // that puts up no page cannot re-enter itself.
    if (b._finaleAfter) { const run = b._finaleAfter; b._finaleAfter = null; run(); b.timer = 0; return; }
    if (b._forcedFlee) { b._forcedFlee = false; b.state = ST.RESULT_MSG; b._nextState = ST.NONE; b.message = "Running away!"; b.timer = 0; const cb = b.onFlee; setTimeout(() => { if (battle === b) { persistPlayerGauge(b); if (bgm && b._fieldTrack !== undefined) bgm.play(b._fieldTrack); battle = null; cb?.(); } }, 1400); return; } if (b._enemyFled) { endBattle("enemy-fled"); return; } if (!b._mode1EscapeShown && specialModeLowHpEscape(b.specialMode ?? 0, b.enemy.hp, b.enemy.maxHp)) { b._mode1EscapeShown = true; b.state = ST.RESULT_MSG; b._nextState = ST.NONE; const escName = b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "Enemy"; sayOriginal(b, { kind: MSG_KIND.OUTCOME, payload: [MSG.FLEEING], name: escName }, "Fleeing!"); b.timer = 0; setTimeout(() => { if (battle === b) endBattle("enemy-fled"); }, 1400); return; } // ^ forced flee: Zanbamon's Cross Slash (result-queue slot 35, fightstg F0x80091a8c) puts up esmfight[0x48] "Running away!" and commits the result to 0 (flee) — the disc's only route that avoids the loss. The mode-1 low-HP escape (fightstg F0x80088564 `.L0x800885bc`, esmfight[0x5f] "Fleeing!") is the mode-1 boss ending: mode 1 + the enemy's HP below maxHP/10 (which the maxHP/11 floor guarantees) closes the fight back to the field with no rewards
    if (b._timelinePages?.length) {
      // The turn's status pages. One page the player reads, then the next, the way the
      // original's status-event machines each build one line object and wait for it
      // (pro/wfightmn.s `.L0x000028ac`-`:0000294c`, `fightstg.s` `.L0x80091b04`-`:80091b24`).
      const pages = b._timelinePages;
      b._timelinePages = null;
      b._timelineMessage = "";
      if (pages.length === 1) {
        const page = pages[0];
        if (page.spec) sayOriginal(b, page.spec, page.text);
        else sayWalker(b, page.text);
        b.timer = 0;
        return;
      }
      setResultPages(b, pages);
      b.timer = 0;
      return;
    }
    if (b._timelineMessage) {
      b.message = b._timelineMessage;
      b._timelineMessage = "";
      b.timer = 0;
      return;
    }
    if (b.enemy.hp <= 0) { defeatCurrentEnemy(); return; }
    if (b.player.hp <= 0) {
      const liveRoster = b.playerRecords.map((record) => ({ stats: { hp: record.hp } }));
      const replacement = activeKoResolution(liveRoster, b.activePlayerIndex);
      if (replacement.outcome === "defeat") {
        enterLossState(b);
      } else {
        // A fallen active Digimon does not end the battle while another resident
        // party record is alive. Reuse the normal Tag and form screens, but make
        // the replacement mandatory and preserve the already-scheduled next turn.
        // The row the list opens on is NOT reset: the original's list carries the
        // row it confirmed last into the next one it opens (fightstg.s:21312
        // writes it, :21258-21260 seeds from it), so a party knocked out one at a
        // time reopens on the row the player last took rather than on the first.
        b._forcedTag = true;
        b.tagTargetIndex = null;
        b.message = "Choose the next Digimon.";
        b.state = ST.PLAYER_TAG;
      }
      b.timer = 0;
      return;
    }
    if (b._blastPending) { b._blastPending = false; triggerBlast(b); b.timer = 0; return; }
    if (b._blastRevertPending) { b._blastRevertPending = false; revertBlast(b); b.timer = 0; return; }
    const nextState = b._nextState ?? ST.PLAYER_MENU;
    b.state = nextState;
    b.menuSel = 0;
    b.timer = 0;
  }

  /**
   * Feed the translated message line (engine/dw3/ui/battle-message-session.ts) the
   * display tick and the pad word, and open a new line whenever the battle's own
   * timeline puts one up. FIGHTSTG_F0x80098c9c + F0x80098a84 reveal one whole line per
   * BATTLE_MESSAGE_LINE_DELAY_TICKS and closes on Circle with no timeout.
   *
   * The panel goes when the line is read: the Circle press sets state 3
   * (`.L0x80098c00`-`.L0x80098c08`), F0x80098c9c draws nothing in states 2 and 3
   * (`.L0x80098ccc` -> `.L0x80098d00`), and the child runner F0x80018140 tears the
   * finished object and its two line elements down (`exe/fns.s` `.L0x800181c0` ->
   * `.L0x80018204`). The prompt is gated on `self+0x98` (`.L0x80098954`).
   */
  /**
   * One displayed frame is one vertical blank of the original
   * (engine/dw3/ui/pad-words.ts MenuDisplayClock), and the delta each blank published
   * is the word every translated screen reads. The battle's message line has always
   * driven that clock; the loss sequence reads the same published deltas
   * (F0x8008c93c counts `[0x8004DF9C]()`), so it is stepped once per displayed frame
   * here instead of once per browser frame -- at 60 Hz one browser frame in six is too
   * short to be a field, and a loss beat counted on browser frames would run at the
   * display's speed rather than the original's. With the panel rolled back
   * (?legacyBattleMsg=1) nothing else advances the clock, so this does it.
   */
  function advanceDisplayFrames(dt) {
    if (msgSession) return msgClock.advance(dt);
    advanceFrameClock();
    return [{ tick: 0, delta: frameDelta() }];
  }

  function tickBattleMessage(b, dt) {
    const frames = advanceDisplayFrames(dt);
    b._displayFrames = frames;
    if (!msgSession) return;
    // While the opening machine has not yet armed the line (its phases 0..4) there is no
    // battle line to show. Suppress the open here so no empty box appears before the
    // original's phase 5 makes its window; `?legacyIntroTimer=1` arms at creation.
    if (b.state === ST.INTRO && !b._introLineArmed) return;
    for (const frame of frames) {
      msgSession.tick(frame.tick, msgPadWords);
    }
    msgPadWords = 0;
    const text = b.state === ST.LOSE ? "Annihilated..." : String(b.message ?? "");
    // A line the walker read off the original's own call site draws the original's
    // two lines. `b._msgSpec` is set by sayOriginal() and cleared by any site that
    // puts up a line with no read counterpart, so the fallback below is the
    // walker's own wording and never a blank panel.
    const spec = b._msgSpec && b._msgSpecFor === text && battleMsgBankSync() ? b._msgSpec : null;
    const key = spec ? `${text}|${spec.kind}|${spec.payload ?? ""}|${spec.name ?? ""}|${spec.slots ?? ""}`
      : text;
    if (key !== (b._msgOpened ?? null)) {
      b._msgOpened = key;
      if (spec) msgSession.openOriginal(spec);
      else msgSession.open(text.length ? text.split("\n") : []);
    }
  }

  /**
   * Whether the message line is holding the turn.
   *
   * It does, because the original's battle does: every caller of the panel's message
   * object returns while that object is still up -- `lw $v0, ($s2); bnez -> return` in
   * the attack-resolution sequencer F0x80090e84 (`.L0x80091094`) and the same check in
   * the action object F0x80088564 (`.L0x80088680`, `.L0x8008876c`, `.L0x80088ac0`,
   * `.L0x80088afc`). The child runner F0x80018230 zeroes that slot only when the line
   * reaches state 3, which F0x80098a84 phase 3 sets on a Circle press alone
   * (`.L0x80098bb8` -> `.L0x80098c08`). The timed close (phase 4, F0x8009a254 at the
   * object's +0xb0) has no caller, so no line times out.
   *
   * The walker's own gated states are the timed action phases. The player's command
   * menu and the results/report screens are deliberately excluded: they are the ones
   * that own the pad, and the results pages (ST.RESULT_MSG with `_resultPages`) are the
   * walker's post-battle pages, which the original's fight report draws itself.
   *
   * The two phases that can hold an unread line in front of the command menu -- the
   * intro ("Ambush!") and the command phase itself -- are held by
   * `commandPhaseWaitsForLine` instead, because there the original's rule is stronger than
   * "hold the turn": the menu is never built (`wfightmn.s:1494-1496`).
   */
  /**
   * Put up a battle line the original's own call site would put up.
   *
   * `walker` stays in `b.message` so `?legacyBattleMsg=1` still draws the old
   * hand-drawn rectangle with the walker's own sentence, and so `peek()` still
   * reports what the battle is saying; `spec` is the original's `unkAC(task, kind,
   * payload)` call, which the translated panel turns into the game's two lines:
   * the acting Digimon's name and what the bank says happened.
   *
   * `payload[0]` is the esmfight index the original writes for arms that read it
   * (kinds 1, 2 and 7), and the side test the shared tail uses to choose between
   * the current actor and a party record (FIGHTSTG_F0x80098d14) — 0 for the enemy
   * or the digivolving Digimon, as the original's own sites write it.
   */
  function sayOriginal(b, spec, walker) {
    b.message = walker;
    b._msgSpec = spec;
    // The spec only belongs to this one sentence: any other site that overwrites
    // `b.message` (there are dozens, and they never clear the field) makes the
    // text disagree and the spec drop out in tickBattleMessage.
    b._msgSpecFor = walker;
  }

  /** Drop any original-words spec, for a line the original has no counterpart for. */
  function sayWalker(b, walker) {
    clearBattleLine(b);
    b.message = walker;
  }

  /**
   * Take the battle box down without putting anything up.
   *
   * Two beats need it and neither is a line the original prints: the Digivolution
   * cinematic opens with an empty box (the original builds its `kind 12` "Digivolved!
   * {1}!" page only when the transformation is over, `pro/wfightmn.s:1717`-`:1719`),
   * and the Blast cinematic ends with one (the `esmfight[0x61]` "Blasted!" page is
   * asked for at the moment the gauge saturates, `pro/wfightmn.s:2977`-`:2982` and
   * `pro/fightstg.s:14077`-`:14084`, both before the transformation plays).
   *
   * It is deliberately NOT `sayWalker(b, "")`: an empty walker sentence is a line with
   * no original counterpart, which is a different claim from "the original's box is
   * empty here", and the census in
   * docs/research/battle/battle-message-page-kinds-2026-10-04.md counts the two apart.
   */
  function clearBattleLine(b) {
    b.message = "";
    b._msgSpec = null;
    b._msgSpecFor = null;
  }

  /**
   * The loss, as the original runs it: `F0x8008CB44` builds the defeat effect, the
   * branch's own tail opens the battle's message window on arm 1 with the payload word
   * the branch wrote, and the exit `F0x800A7C00` later fades the screen out and asks
   * the launcher for 0xE00, the title screen. All of that is the translated session
   * (engine/dw3/ui/battle-loss-session.ts), checked frame by frame against the original
   * routines in tests/lane-b/battle-loss.test.js; this only hands it the four things the
   * session cannot own:
   *
   *   playSound          0x60040008, the GAMEOVER jingle, which the walker's music table
   *                      names gameover (build_music.py renders it gameover.ogg).
   *   armDefeatEffect    the entry tick's cut to the original's close shot — the same
   *                      shared switch update() drives every frame, so it is already in
   *                      this mode and the call is its statement of the beat. The
   *                      motion 0x17 and the class-0x14 object that go with it are the
   *                      renderer's, not built here.
   *   turnDefeatCamera   the per-frame re-apply of that shot through the camera's +0xF8
   *                      with the Y angle grown by delta * 2: web/battle3d.js owns the
   *                      picture in its "defeat" mode and turns it from its own clock.
   *   slowMotion         `[0x800A4548](level)`: F0x8009E510. Level 2 on the entry tick,
   *                      level 0 again when the exit puts the effect in phase 3.
   *
   * The message is NOT built here: the branch's own `window->+0xAC` call is read back out
   * of the session's memory and opened through the already-ported panel, so "Annihilated..."
   * arrives the way every other battle line does.
   */
  function startLossSession(b) {
    const session = new ui.BattleLossSession({
      playSound: (id) => { if ((id >>> 0) === 0x60040008) bgm?.play("gameover"); },
      armDefeatEffect: () => { renderer3d?.setCameraMode?.(lossCameraMode()); return 0; },
      turnDefeatCamera: () => {},
      // ?legacyLossPose=1 is the reviewer's switch for the loss beat's animation
      // speed, so it still answers here: the port owns the level's arming and
      // lowering, the renderer draws the quarter-speed result.
      slowMotion: LEGACY_LOSS_POSE ? () => {} : (level) => renderer3d?.setSlowMotion?.(level),
    }, { onLaunch: (code) => { b._lossLaunch = code >>> 0; } });
    session.begin();
    b._lossSession = session;
    const opened = session.messages[session.messages.length - 1];
    if (opened) {
      const [kind, payload] = opened;
      const id = session.mem.read32(payload) >>> 0;
      sayOriginal(b, { kind, payload: [id] }, LOSS_MESSAGE_WORDS[id] ?? "");
    }
    return session;
  }

  /** The one place the battle is lost: the shared loss sequence starts here. */
  function enterLossState(b) {
    b.state = ST.LOSE;
    b._lossSession = null;
    if (!USE_LEGACY_LOSS) startLossSession(b);
  }

  /**
   * "Fight" chosen: the partner's name on line one and the game's "Attack!" on line
   * two. `fightstg.s .L0x80090fe8` allocates the panel and calls
   * `unkAC(kind 2, {0x08, 0x10})`; `.L0x800996cc` reads the first payload word as
   * line 2's bank index and the shared tail F0x80098d14 fills the name.
   *
   * The SAME page is the enemy's ordinary-attack announcement: one builder
   * (`attackPageSpec`) serves both sides, so the name is an argument and the
   * caller supplies its own fighter.
   */
  function attackSpec(b, name = b.player?.profile?.name) {
    return attackPageSpec(name);
  }

  /**
   * An attack that missed: the defender's name and the game's "Evade!". `fightstg.s`
   * `.L0x8008ed70`, `.L0x800911b0` and `.L0x8009149c` all allocate the panel and call
   * `unkAC(kind 2, {0x1d, 0x10})` — three sites because three different attackers can
   * miss, and all three write the same two payload words.
   */
  function techniqueSpec(b, skill) {
    return {
      kind: MSG_KIND.TECHNIQUE, payload: [MSG.ATTACK], name: b.player.profile.name,
      slots: [skill.name],
    };
  }

  /**
   * The same page for the ENEMY's technique: line one is the enemy's name, line two is
   * `esmfight[0x09]` "{1}!" with the technique's own name in slot 1.
   *
   * `payload[0]` is the side test the shared tail reads (`pro/fightstg.s:14371`
   * `li $v0, 0x10` for the enemy arm, and `:14573` for the one in the attack-resolution
   * sequencer), so it is the word that says "name the fighter at `[0x800a4460 + 8]`"
   * rather than the acting Digimon -- the enemy is the other side of the fight from the
   * player's partner.
   */
  function enemyTechniqueSpec(enemyName, skill) {
    // `battleMessagePage(3, ...)` IS the original's call: payload[0] = 0x10 (the side
    // test) and the technique name in slot 1 out of bank 0xa2 by payload[1]
    // (`pro/fightstg.s:23476` / `:23479`).
    return battleMessagePage(MSG_KIND.TECHNIQUE, { name: enemyName, slot: skill.name });
  }

  /**
   * The item action's own first page: the announcement, `FIGHTSTG_F0x8008dac0` outer
   * step 0.
   *
   * That step allocates a line object, writes payload word 0 = 0 (`:11158`) and payload
   * word 1 = the ItemId (`:11157`/`:11159`), and calls the panel's `+0xac` with **kind
   * 14** (`:11161` `li $a1, 0xe`). The arm `.L0x80099ca0` (`:23809-23847`) is line 1
   * `esmfight[0x16]` (`:23822`) — the bare name placeholder — line 2 `esmfight[0x09]`
   * `{1}!` (`:23833`), and the second line's slot 1 is the item's name read out of **bank
   * 0x6a by ItemId** (`addiu $a0, 0x6a` at `:23838`, `lw $a2, 0x4($s2)` at `:23841`, then
   * `+0x120(line2, handle, payload[1], 1)` at `:23842`/`:23845`). payload[0] = 0 makes the
   * shared tail name the acting Digimon, not a party record (`:24035` `.L0x8009a028 lw
   * $a2, ($s2)`, then `FIGHTSTG_F0x80098d14 .L0x80098d28 bnez $a2` at `:22789`).
   *
   * So the player reads two lines and one press of Circle before anything happens: the
   * Digimon's name, then the item's own name and "!".
   *
   * @param {object} b the battle
   * @param {{id: number}} item the item the player chose
   * @returns {{kind: number, payload: number[], name: string, slots: string[]}}
   */
  function itemAnnouncementSpec(b, item) {
    return itemAnnouncementPage(
      b.player.profile.name, item.id, battleMsgText(ui.BATTLE_MESSAGE_BANK_FIELD, item.id));
  }

  function evadeSpec(b, enemyName) {
    return evadePageSpec(enemyName);
  }

  /**
   * A fallen enemy's page: the Digimon's name on line one and the bank's own
   * `esmfight[0x51]` "Defeated!" on line two.
   *
   * The original's controller asks for it in one place: `pro/wfightmn.s:3265`
   * (`li $v0, 0x51`) / `:3266` (`sw $v0, 0x50($s2)`) / `:3267` (`li $v0, 0x10` into
   * payload word 1) / `:3270` (`li $a1, 0x2`) / `:3271` (`lw $v0, 0xac($a0)`). The
   * branch at `:3253` (`bnez $a1, .L0x000032e8`) tests the fallen fighter's side
   * index (`lw $a1, 0x4($s0)` / `sra $a1, 0x4` at `:3241`/`:3243`): side 1, the enemy,
   * prints "Defeated!", and side 0 at `:3254`-`:3264` prints `esmfight[0x50]` "KO!"
   * through a different tail (`j 0x800a90d8`).
   */
  function defeatedSpec(enemyName) {
    return battleMessagePage(MSG_KIND.OUTCOME, { index: MSG.DEFEATED, name: enemyName });
  }

  function msgHoldsTurn(b) {
    if (!msgSession?.active || msgSession.finished) return false;
    if (b._resultPages?.length || b._victoryPhase || b.blastShow) return false;
    return b.state === ST.PLAYER_ACT || b.state === ST.ENEMY_ACT || b.state === ST.RESULT_MSG;
  }

  // ── The battle's opening phase machine (port of pro/wfightmn's #2 arm) ──────
  //
  // The seven phases run one per frame (engine/dw3/battle-opening-machine.ts). Every
  // phase's real work is an already-ported system or the walker's own build:
  //
  //   0 assembleBattleObjects      the walker built the scene, the HUD and both fighters
  //                                synchronously in start(), before this frame.
  //   1 loadEncounterAndFighters   the intro variant by the disc's own rule
  //                                (introVariantFor: battle id x map id pairs, map 0x144
  //                                the special-mode-4 arm) + the opening-line gate
  //                                F0x800a684c (openingLineRoll).
  //   2 queueBattleOverlay         the boot loader (web/wfight-translated.js, the
  //                                WfightLoaderSession) is the overlay F0x800a6414 queues.
  //   3 awaitOverlay               holds while the loader is still running, so a slow load
  //                                cannot let the player reach the menu early.
  //   4 sweepActionQueue           F0x800a69f0; the status-event pool is rebuilt per battle.
  //   5 frameCameraOrOpenLine      no line -> camera beat + EXIT; line -> arm the window.
  //   6 awaitLineThenHandOff       the window is up until the player reads the line, then
  //                                EXIT (top state 1) -> the walker's PLAYER_MENU.
  function armIntroLine(b) {
    // The original's own opener: phase 5 makes the window (F0x8009a298) and writes kind 1,
    // payload 7 (wfightmn.s .L0x000012f8) — one line, "Ambush!".
    sayOriginal(b, { kind: MSG_KIND.ONE_LINE, payload: [MSG.AMBUSH] }, "Ambush!");
    b._introLineArmed = true;
    return 1;
  }

  function openingPorts(b) {
    return {
      assembleBattleObjects() {},
      loadEncounterAndFighters(state) {
        const ans = introVariantFor(Number(b.screenId) || 0, Number(String(b.mapId ?? "").replace(/^s/, "")) || 0);
        state.introVariant = ans.variant;
        state.specialMode4 = ans.specialMode4;
        b._introVariant = ans.variant;
        b._specialMode4 = ans.specialMode4;
      },
      introLinePending: () => openingLineRoll({ lineWeight: b._introLineWeight, bias: 0, enemyField: 0, roll: 0 }),
      queueBattleOverlay: () => (wfightNative.isOpen() ? 1 : 0),
      overlayPending: (handle) => handle !== 0 && wfightNative.isOpen() && !wfightNative.diagnostics?.().failed,
      sweepActionQueue() {},
      frameCamera() {},
      frameCameraAndOpenLine: () => armIntroLine(b),
      // The disc's slot-6 create (wfightmn.s:1175-1178, `F0x800a246c`), which the machine runs
      // once per battle at the end of phase 1. The actor itself lives in the renderer, which owns
      // the one camera record and ticks it from the opening camera mode.
      createOpenCamera() { renderer3d?.beginOpeningCamera?.(); },
      // The window is up until the message panel that shows it reports the line read.
      lineUp: () => b._introLineArmed && !(msgSession && msgSession.finished),
    };
  }

  /**
   * The opening machine's per-frame step. Returns nothing; when the machine EXITs
   * (top state -> 1) the walker enters its command menu, which is the hand-off the
   * original makes to the already-ported secondary sequencer F0x800a9cb4.
   *
   * `?legacyIntroTimer=1` runs the walker's former flat timer instead.
   */
  function stepBattleOpening(b, dt) {
    if (USE_LEGACY_INTRO_TIMER) {
      b.timer += dt;
      if (commandPhaseWaitsForLine(msgSession, b.state)) return;
      if (b.timer > 1.2) { b.state = ST.PLAYER_MENU; b.menuSel = 0; }
      return;
    }
    stepOpeningPhase(b._opening, openingPorts(b));
    b.timer += dt;
    if (b._opening.exited) {
      // The machine exit is the hand-off: top state 1 is the turn machinery.
      b.state = ST.PLAYER_MENU;
      b.menuSel = 0;
    }
  }

  /**
   * The two live members the plate's poll reads, in the original's order: side 0 is
   * the player's active party member out of `0x800a4468`, side 1 the active enemy
   * out of `0x800a446c`, and each carries the record's own `+0x08` and `+0x06`.
   */
  function hpPlateMembers(b) {
    return [
      { index: b.activePlayerIndex ?? 0, hp: Number(b.player?.hp ?? 0), maxHp: Number(b.player?.maxHp ?? 0) },
      { index: b.enemySlot ?? 0, hp: Number(b.enemy?.hp ?? 0), maxHp: Number(b.enemy?.maxHp ?? 0) },
    ];
  }

  /** The plate object (FIGHTSTG_F0x80093a74), built on its first frame. */
  function hpPlateOf(b) {
    if (!b._hpPlate) {
      // FIGHTSTG_F0x80093cc8, the plate-HUD spawner, ported (engine/dw3/battle-task-spawn.ts):
      // the plate object is created through the shared resident allocator with the plate build
      // method 0x80093a74, size 0x88 and flags 0x14. The browser has no allocator — its
      // factory is createHpPlateState — so it supplies the allocator and the port owns the
      // call and its constants; nothing in the spawner's body is hand-written here.
      b._hpPlate = spawnPlateHud((method, size, flags) =>
        Object.assign(createHpPlateState(hpPlateMembers(b)), { method, size, flags }));
    }
    return b._hpPlate;
  }

  /**
   * FIGHTSTG_F0x80090c44, the fight task spawner, ported (engine/dw3/battle-task-spawn.ts).
   *
   * The battle command phase allocates the acting fighter's action object through the shared
   * resident allocator with method 0x8008f714 (the technique record machine, so the new
   * object's tick IS that machine), size 0x84 and flags 4, then writes the side byte at +0x50
   * and the technique id word at +0x54. The browser has no allocator and no resident object
   * with a tick pointer — it runs the technique record machine inline over a plain action
   * descriptor — so it supplies the allocator (`spawn`) and the port owns the call, its
   * constants and the two stores. The technique word the record machine runs is read back out
   * of the port's +0x54 store, so the id the machine sees is the one the original stored.
   */
  function spawnFightTaskFor(side, techniqueId) {
    const spawn = (method, size, flags) => {
      const cell = { method, size, flags, side: 0, technique: 0 };
      return {
        cell,
        write8: (off, v) => { if (off === FIGHT_TASK_ARG_BYTE_OFF) cell.side = v & 0xff; },
        write32: (off, v) => { if (off === FIGHT_TASK_ARG_WORD_OFF) cell.technique = v | 0; },
      };
    };
    return spawnFightTask(spawn, side & 0xff, techniqueId | 0).cell;
  }

  function tickHudEase(dt) {
    const b = battle;
    b._hudClock = (b._hudClock || 0) + dt;
    tickBattleMessage(b, dt);
    // The plate's mode-1 arm (FIGHTSTG_F0x80093a74 .L0x80093c6c), once per DISPLAYED
    // frame with that frame's published delta -- the same list the message line and
    // the loss sequence are stepped with, because a displayed frame is a vertical
    // blank of the original and the plate is one of that frame's own ticks. The poll
    // inside it (F0x80093108) is why a hit is noticed every eighth frame, not the
    // frame it lands.
    const plate = hpPlateOf(b);
    for (const frame of (b._displayFrames ?? [])) {
      hpPlateTick(plate, hpPlateMembers(b), frame.delta);
    }
  }

  function update(dt) {
    if (!battle) return;
    const b = battle;
    tickHudEase(dt);
    // A hurt Digimon rests in the low-HP stance; a healthy one rests in the normal idle. Every
    // action script's trailing "return to base" record plays whichever is current.
    renderer3d?.setFighterBaseIdle?.("player", lowHpStance(b.player));
    renderer3d?.setFighterBaseIdle?.("enemy", lowHpStance(b.enemy));
    // Cinematic camera shot follows the battle phase, then render the 3D scene.
    // The walker no longer carries a state list for camera ownership: the renderer retires the
    // idle director on the confirm edge (its own absence makes it stop republishing), and the
    // coordinator answers the live script's ownership directly. The old
    // SCRIPT_OWNED_CAMERA_STATES list was removed 2026-10-08 (worker-bc).
    renderer3d?.setCameraMode(
      b.state === ST.TAG_PRESENT ? "tag"
      : b.state === ST.INTRO ? "opening"
      : DIRECTOR_STATES.has(b.state) ? "director"
      : b.state === ST.LOSE ? lossCameraMode()
      : ORBIT_STATES.has(b.state) ? "orbit"
      : "behind",
      { scriptOwnsCamera: !!renderer3d?.coordinator?.cameraScriptOwned?.() });
    // The defeat effect F0x8008c93c's FIRST tick -- the same tick that cuts the camera --
    // calls `[0x800a4548](2)`: F0x8009e510(2) stores the level at 0x800a453c, zeroes the
    // accumulator at 0x800a4540 and starts F0x8009e428. That stepper publishes one animation
    // unit out of every four accumulated raw deltas to 0x800a4464, and 0x800a4464 is what the
    // BATTLE's animation clock reads: the model actor's frame counter `self+0x80 += delta`
    // (F0x80083d30, fightstg.s), the second actor clock (.L0x80089614) and every op2
    // slot-motion blend (F0x8009b1fc / .L0x8009b380 / .L0x8009b520 / .L0x8009b5d4). So the
    // fight's own clock runs at a quarter speed while the shot keeps turning at full speed:
    // the orbit reads `[0x8004df9c]()` directly (.L0x8008cad4) and nothing ever swaps that
    // pointer. Nothing on the loss path lowers the level again -- F0x8008c93c's phase 3
    // would, but no writer of phase 3 was found -- so it stays at 2 until the scene goes.
    // The ported loss arms the level from the defeat effect's own first tick (the
    // session's slowMotion port), so this arm belongs to the ?legacyLoss=1 beat only.
    if (USE_LEGACY_LOSS && b.state === ST.LOSE && !LEGACY_LOSS_POSE && !b._loseSlowMoArmed) {
      b._loseSlowMoArmed = true;
      renderer3d?.setSlowMotion?.(2);
    }
    // The close-up face box is one object of the HUD, not a flag: it is up while this
    // side's command menu is up and down from the moment a battle message line is up
    // (engine/dw3/ui/native/battle-face-box.ts; the rule and the five-frame capture in
    // docs/research/battle/captures/face-box-rounds-2026-10-03/). msgHoldsTurn is the
    // walker's own "a line is up and owns the pad" predicate, so the box is fed the same
    // fact the turn machine is held on.
    renderer3d?.syncFaceBox?.(faceBoxHudEvents(b, msgHoldsTurn(b)));
    renderer3d?.render(dt);

    // The battle boot pipeline (the pro/wfightmn SET_STATE bank loader) is the screen's own
    // boot, not a step of the battle's turn machine: in the original it belongs to the host
    // screen, and the message line is a separate fightstg object, so a line holding the turn
    // never starves it. It is ticked here, above every turn hold, because that is the
    // original's shape -- the banks are still arriving while the player reads "Ambush!".
    // It retires by itself, so nothing changes once it has finished.
    if (wfightNative.isOpen()) wfightNative.update(dt);

    // Blast digivolution (sequence 0x61). Freeze the battle for the whole
    // cinematic: the capture runs ~880 frames with no input and no turn
    // progress, and the form swap and heal land inside it.
    if (b.blastShow) { advanceBlastPresentation(b, dt); return; }

    // A line the message panel is showing holds the turn until the player presses
    // Circle, the way the original's own sequencer does (see msgHoldsTurn). The 3D
    // scene, the effects and the HP bar keep running above this line; only the battle's
    // own step machine waits, so nothing else can advance behind the player's back.
    if (msgHoldsTurn(b)) return;

    if (b.state === ST.INTRO) {
      // The battle's OPENING PHASE MACHINE (port of pro/wfightmn's #2 arm). It replaces
      // the walker's flat 1.2 s timer: the seven phases run one per frame and the exit
      // (top state 1) hands the fight to the command menu — the original's hand-off to
      // the secondary sequencer F0x800a9cb4. `?legacyIntroTimer=1` keeps the old timer.
      stepBattleOpening(b, dt);
      return;
    }

    // Phase 6.3 group 4: while the player picks a command, the shipped
    // pro/fightstg list owns the surface. It reports its chosen row on the frame
    // the player confirms; the battle then runs the very same confirm path a
    // Circle press takes, so the native and legacy routes cannot drift.
    // The original battle boot pipeline runs first and retires on its own; the
    // command menu waits for the driver slot. Its own tick sits above, with the
    // other screen work, so a line holding the turn cannot starve it.

    // The TECH screen: the translated pro/fightstg list owns the surface from
    // the frame the TECH command is chosen, and update() hands the chosen
    // technique id back on the frame the player confirms (-2 is a cancel).
    if (b.state === ST.PLAYER_TECH && USE_TRANSLATED_TECH && !techNative.failed()) {
      if (!techNative.isOpen()) techNative.open(techListSeed(b));
      const chosen = techNative.update(getState()?.keys, dt);
      if (chosen !== null && chosen !== undefined) {
        techNative.close();
        if (chosen === -2) {
          b.state = ST.PLAYER_MENU;
          return;
        }
        confirmTech(b, chosen);
      }
    } else if (techNative.isOpen()) {
      techNative.close();
    }

    // The ITEM screen: the same hand-off the TECH list uses. The chosen item id
    // comes back on the frame the player confirms (-2 is a cancel), and the
    // battle then runs the very same confirm path the Circle press takes, so the
    // native and legacy routes cannot drift.
    if (b.state === ST.PLAYER_ITEM && USE_TRANSLATED_ITEM && !itemNative.failed()) {
      if (!itemNative.isOpen()) itemNative.open(itemListSeed(b));
      const chosen = itemNative.update(getState()?.keys, dt);
      if (chosen !== null && chosen !== undefined) {
        itemNative.close();
        if (chosen === -2) {
          b.state = ST.PLAYER_MENU;
          return;
        }
        confirmItem(b, chosen);
      }
    } else if (itemNative.isOpen()) {
      itemNative.close();
    }

    // The TAG partner list: the translated pro/fightstg screen owns the surface
    // from the frame the Tag command is chosen, and update() hands the chosen
    // party slot back on the frame the player confirms (-2 is a cancel).
    if (b.state === ST.PLAYER_TAG && USE_TRANSLATED_TAG && !tagNative.failed()) {
      if (!tagNative.isOpen()) tagNative.open(tagListSeed(b));
      const chosen = tagNative.update(getState()?.keys, dt);
      if (chosen !== null && chosen !== undefined) {
        // fightstg.s:21312: the confirm stores the cursor row into the cell the
        // screen opened from, before the party slot, so the NEXT list this battle
        // opens starts on the row the player last took. A refused confirm (the
        // row's HP is 0, fightstg.s:21300-21308) answers nothing, so the word is
        // untouched and the cursor stays where it was.
        const row = tagNative.chosenRow?.();
        if (typeof row === "number") b.tagRow = row;
        tagNative.close();
        if (chosen === -2) {
          if (b._forcedTag) return;
          b.state = ST.PLAYER_MENU;
          return;
        }
        confirmTag(b, chosen);
      }
    } else if (tagNative.isOpen()) {
      tagNative.close();
    }

    // The Digivolve form list: the translated pro/fightstg screen owns the surface
    // from the frame the DV command is chosen. update() hands back the chosen
    // species id on the frame the player confirms, and -2 on a cancel.
    if (b.state === ST.PLAYER_DV && USE_TRANSLATED_FORM && !formNative.failed()) {
      if (!formNative.isOpen()) formNative.open(formListSeed(b));
      const species = formNative.update(getState()?.keys, dt);
      if (species !== null && species !== undefined) {
        formNative.close();
        if (species === -2) {
          b.state = ST.PLAYER_MENU;
          return;
        }
        confirmDvForm(b, species);
      }
    } else if (formNative.isOpen()) {
      formNative.close();
    }

    // The follow-up pane, the original's ONE object for both the DNA command and
    // the Tag follow-up (both walk into ST.PLAYER_DNA_CHOICE). It answers with
    // the row it took in the low nibble and the species under its cursor in the
    // high nibble. Cross on the names writes -2; both phase routes restart
    // their partner picker on that word (fightstg.s:16314-16316).
    if (USE_ORIGINAL_TAG_SWAP && b.state === ST.PLAYER_DNA_CHOICE
        && USE_TRANSLATED_DNA && !dnaNative.failed() && !b._dnaBranchBlocked) {
      if (!dnaNative.isOpen()) dnaNative.open(dnaPaneSeed(b));
      const answer = dnaNative.update(getState()?.keys, dt);
      if (answer !== null && answer !== undefined) {
        dnaNative.close();
        applyDnaAnswer(b, answer, dnaTagBranchKind(!!b._forcedTag));
      }
    } else if (dnaNative.isOpen()) {
      dnaNative.close();
    }

    if (b.state === ST.PLAYER_MENU) {
      // The command list is built here, so while a line is up and unread this branch does
      // not run at all: the original's controller instruction returns before it arms
      // anything while the line's slot is occupied (commandPhaseWaitsForLine,
      // `wfightmn.s:1494-1496`). No list is opened and nothing reads the pad until the
      // line has been read.
      if (commandPhaseWaitsForLine(msgSession, b.state)) return;
      // The Frozen gate sits between the line wait and the arming, where the original
      // puts it (F0x800a7418 step 1, `wfightmn.s:1503-1512`). A partner that loses the
      // roll never gets a list: its line goes up and the turn is handed straight to the
      // next actor. The line itself holds the turn through commandPhaseWaitsForLine above.
      if (frozenGateLosesTurn(b)) {
        if (b._timelineMessage) {
          // Poison or a timed recovery landed on the lost turn; the walker's own line for
          // it comes first, the way FLEE_FAIL shows the same pending timeline text.
          b.state = ST.RESULT_MSG;
        } else {
          b.state = b._nextState ?? ST.ENEMY_ACT;
          b.menuSel = 0;
        }
        b.timer = 0;
        return;
      }
      if (USE_NATIVE_COMMAND && !commandNative.failed() && !wfightNative.isOpen()
          && !useLegacyJokeList(b)) {
        // Null unless the acting Digimon is confused, and then the six joke rows
        // this decision is drawn from (shuffled once, as the original's owner does).
        const joke = jokeMenuRows(b);
        if (!commandNative.isOpen()) {
          commandNative.open(joke ? 0 : b.menuSel | 0, {
            activeIndex: b.activePlayerIndex | 0,
            ailmentBits: battleAilmentByte(b.player),
            // The joke owner (FIGHTSTG_F0x8009A898) builds the same six-row widget
            // from the joke config and the shuffle's own six entries.
            jokeIndices: joke ? joke.map((j) => j.jokeIndex) : null,
          });
        }
        const row = commandNative.update(getState()?.keys, dt);
        if (row !== null && row !== undefined && row < COMMAND_COUNT) {
          commandNative.close();
          if (joke) {
            // The joke owner answers with the chosen joke; the walker's own
            // remembered row belongs to the command list, not to the gag.
            confirmJokePick(b, row);
          } else {
            b.menuSel = row;
            confirmCommand(b);
          }
        }
      } else if (commandNative.isOpen()) {
        // The hand-drawn list takes over when the shared list cannot run.
        commandNative.close();
      }
    }

    if (b.state === ST.RESULT_MSG) {
      b.timer += dt;
      // A technique's result belongs to the technique, not to its animation: the
      // original's record machine runs after the action and never reads the clip. A
      // script that fires no contact — clip 15, the seven field techniques — must still
      // put its page up, so an armed result is committed as soon as the action is over.
      commitPendingImpact(b);
      // Hold the result message until the attack/recoil animation has finished (or a 5s safety cap),
      // so the next actor's turn starts AFTER the current action plays out — not mid-animation.
      if (b.timer > 1.0 && (!animBusy() || b.timer > 5.0)) {
        if (b._resultPages?.length) {
          b._resultReady = true;
          return;
        }
        advanceAfterResult(b);
      }
      return;
    }

    if (b.state === ST.PLAYER_ACT) {
      b.timer += dt;
      if (b.timer > TAG_PRESENTATION.outgoingSeconds) {
        const presentation = applyPlayerAction();
        queueAfterAction(b, "player");
        if (presentation === "dna") {
          b.state = ST.DNA_PRESENT;
          b.timer = 0;
          return;
        }
        if (presentation) {
          b.state = ST.TAG_PRESENT;
          b.timer = 0;
          return;
        }
        tickBlastTurn(b);   // this committed player turn counts against the Blast schedule
        b.state = ST.RESULT_MSG;
        // After player acts: if enemy was faster, they already went — go to menu; else enemy goes next
        if (b.enemy.hp <= 0) b._nextState = ST.WIN;
        b.timer = 0;
      }
      return;
    }

    if (b.state === ST.TAG_PRESENT) {
      if (b._tagPresentation?.phase === "arrival") {
        b.timer += dt;
        if (tagArrivalComplete(b.timer)) {
          renderer3d?.setPlayerAnim("idle");
          renderer3d?.setPlayerVisible(true);
          b.message = `${b._tagPresentation.memberName} switches to ${b._tagPresentation.profile.name}!`;
          b._tagPresentation = null;
          b.state = ST.RESULT_MSG;
          b.timer = 0;
        }
      }
      return;
    }

    if (b.state === ST.DNA_PRESENT) {
      const dna = b._dnaPresentation;
      if (!dna) return;
      b.timer += dt;
      if (dna.mode === "full") {
        // Segment sequencer: each segment plays as its own script; when its VM ends the owner
        // advances to the next chunk, swapping the single stage actor when the model changes
        // (no op0 barrier: the mode-4 skip word was misread as one; clip12-full-script.md).
        if (dna.swapping || renderer3d?.playerAnimator?.vm) return;
        const prev = dna.chunks[dna.chunk];
        dna.chunk += 1;
        const next = dna.chunks[dna.chunk];
        if (!next) {                       // op255 teardown done → back to the battle
          renderer3d?.setDataField(false);
          renderer3d?.dnaPresentationStop?.(); // the beach/arena returns with teardown
          renderer3d?.setFaceCamVisible?.(true);
          renderer3d?.setEnemyVisible?.(true);
          renderer3d?.setPlayerVisible(true);
          renderer3d?.setPlayerAnim("idle");
          // The cinematic (attack included) plays inside the void; the instant it ends and
          // cuts back to the arena, the enemy plays its hit-recoil and the damage line
          // appears in the bottom message panel (original shows "{1} damage!" via the
          // message-panel VM kind 4, not a floating number — BATTLE-Q004-DMGMSG-001).
          // Reaction lives here — in the normal battle view — not during the void sequence.
          if (dna.hit) renderer3d?.setEnemyAnim?.("hit");
          const enemyName = b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "Enemy";
          if (dna.hit) commitDnaImpact(b, dna);
          else b.message = `${dna.fusedName ?? dna.resultProfile.name}! ${enemyName} evaded!`;
          b._dnaPresentation = null;
          b.state = ST.RESULT_MSG;
          b.timer = 0;
          return;
        }
        if (next.model !== prev.model) {   // boundary swap happens while the actor is hidden
          dna.swapping = Promise.resolve(swapPlayerModel(next.model)).then((ok) => {
            if (battle !== b || b._dnaPresentation !== dna) return;
            // A result whose model has no pack to load holds the acting form in
            // the result slot — never the partner, which the previous chunk left
            // on screen. All ten fusions now have their pack (the three
            // Jogress-only results 468 Agunimon, 469 BladeGarurumon and 470
            // AncientGreymon were built from the disc on 2026-10-03), so this is
            // the guard for a model id the game never shipped a mesh for.
            if (ok === false && next.result) {
              return Promise.resolve(swapPlayerModel(dna.originalProfile.name)).then(() => {
                if (battle !== b || b._dnaPresentation !== dna) return;
                dna.swapping = null;
                startDnaChunk(b, dna);
              });
            }
            dna.swapping = null;
            startDnaChunk(b, dna);
          });
        } else {
          startDnaChunk(b, dna);
        }
        return;
      }
      if (dna.phase === "parents" && b.timer >= 3) {
        dna.phase = "loading-result";
        b.timer = 0;
        renderer3d?.setPlayerVisible(false);
        Promise.resolve(swapPlayerModel(dna.resultProfile.name)).then(() => {
          if (battle !== b || b._dnaPresentation !== dna) return;
          dna.phase = "result";
          b.timer = 0;
          renderer3d?.playPlayerScript(dnaResultScript, {
            motionTables: { 30: DNA_RESULT_TABLE },
            rotationBase: dnaResultScript.resultSlot.rotation[1],
            onOverlay: () => renderer3d?.setPlayerVisible(true),
          });
        });
      } else if (dna.phase === "result" && b.timer > 1 && !renderer3d?.playerAnimator?.vm) {
        dna.phase = "restoring";
        Promise.resolve(swapPlayerModel(dna.originalProfile.name)).then(() => {
          if (battle !== b || b._dnaPresentation !== dna) return;
          renderer3d?.setPlayerVisible(true);
          renderer3d?.setFaceCamVisible?.(true);
          renderer3d?.dnaPresentationStop?.();
          renderer3d?.setPlayerAnim("idle");
          const enemyName = b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "Enemy";
          if (dna.hit) commitDnaImpact(b, dna);
          else b.message = `${dna.fusedName ?? dna.resultProfile.name}! ${enemyName} evaded!`;
          b._dnaPresentation = null;
          b.state = ST.RESULT_MSG;
          b.timer = 0;
        });
      }
      return;
    }

    if (b.state === ST.ENEMY_ACT) {
      b.timer += dt;
      if (b.timer > 0.6) {
        applyEnemyAction();
        queueAfterAction(b, "enemy");
        b.state = ST.RESULT_MSG;
        b.timer = 0;
      }
      return;
    }

    if (b.state === ST.WIN) {
      if (b._winReward === undefined) {
        // EXP/BIT/DVEXP come from the battle's own reward record; only drops were
        // accumulated per defeated enemy in defeatCurrentEnemy. First drop shown on the
        // win screen; endBattle applies every drop to the inventory.
        const itemTable = window.__ITEM_BY_NAME;
        // A defeated Cardmon grants a guaranteed Booster in place of the ordinary
        // drop (its sprite records are drop_rate 0), so the report shows it AND
        // endBattle banks it from _loot.drops like any other drop.
        const boosterId = cardmonBoosterForBattle(b);
        const boosterName = boosterId != null
          ? (window.__ITEM_BY_ID?.[boosterId]?.name ?? null) : null;
        if (boosterName && !b._loot.drops.includes(boosterName)) b._loot.drops.push(boosterName);
        const firstDrop = b._loot.drops.find(Boolean) ?? null;
        const droppedItem = firstDrop ? (itemTable?.[firstDrop] ?? null) : null;
        const rewards = winRewards(b);
        // Only the participants still standing at the outcome are paid, and only
        // they divide the share (paidParticipants; pro/wfightmn.s
        // .L0x00002070 and pro/stfgtrep.s .L0x00002c68).
        const progress = paidParticipants(b)
          .map((index) => ({ index, ...applyParticipantProgress(b, index) }));
        const activeProgress = progress.find((entry) => entry.index === b.activePlayerIndex)
          ?? progress[0] ?? { xp: 0, newLevel: b.player.level, levelUp: false };
        b._winProgress = progress;
        b._winApplied = true;
        b._winReward = { xp: rewards.xp, bits: rewards.bits, dvexp: rewards.dvexp,
                         droppedItem, levelUp: activeProgress.levelUp };
        b._winNewLevel = activeProgress.newLevel;
        // XP is already on the roster; the report shows the banked totals.
        b._winReportRows = buildFightReportRows(
          b.playerRoster, b.playerRecords, digimonDB,
        );
        b._winPages = buildFightReportPages({
          xp: rewards.xp,
          bits: rewards.bits,
          droppedItem: droppedItem?.name ?? null,
          events: progress,
        });
        // ITEM_GET plays when the reward presenter shows an item drop
        // (wfightmn [s0+4]==0 branch, sfx-triggers.json)
        if (droppedItem) sfx?.play("item_get");
      }
      if (b._victoryPhase === "pose") {
        b.timer += dt;
        // Table 44 loops after its authored first cycle.  Only then may the player close the
        // "Battle Won!" message; the timer is a safety path for a missing/late 3D model.
        if (renderer3d?.playerVictoryComplete || b.timer > 3) {
          b._victoryReady = true;
          b.timer = 0;
          if (b._winLaunchCode === FINALE_WIN_ENDING_MOVIE) {
            // The finale's win goes straight into the ending movie
            // (wfightmn.s:2165-2174): STFRPT never opens, the launch cue 0xE0B
            // plays movie row 10 (MOVIEE01_STR) and its own return selector
            // chains to row 11 (MOVIEE02_STR) and then 0x2d7 (screen 727 =
            // stage 780). The host plays the chain and calls finishEnding when
            // it is done; with no host the battle finishes directly rather than
            // stranding the player in the ending phase.
            b._victoryPhase = "ending";
            b._endingHosted = endingHandoff?.play ? endingHandoff.play(b) === true : false;
            if (!b._endingHosted) endBattle("win");
          } else {
            b._victoryPhase = "report";
            b._winPageIndex = 0;
            // The native results screen takes over the whole framebuffer when a
            // host is registered; the inline report stays the fallback.
            if (reportHandoff?.open) b._reportNative = reportHandoff.open(b) === true;
          }
        }
      } else if (b._victoryPhase === "report") {
        b.timer += dt;
        const page = b._winPages?.[b._winPageIndex ?? 0];
        if (page && b._winJinglePage !== (b._winPageIndex ?? 0)) {
          b._winJinglePage = b._winPageIndex ?? 0;
          if (page.jingle) sfx?.play(page.jingle);
        }
      }
      return;
    }

    if (b.state === ST.LOSE) {
      if (USE_LEGACY_LOSS) {
        // GAMEOVER 0x60040008 = music-start: COMMON SEP sequence 8, a sequenced
        // jingle (build_music.py renders it as gameover.ogg) -- not a sample.
        if (b.timer === 0 && bgm) bgm.play("gameover"); // endBattle restores the field track
        b.timer += dt;
        // wfightmn loss branch (0x800a9230): the defeat effect F0x8008c93c runs for
        // 0xF0 delta units (1 per frame), then the mode-2 tick 0x800a7c00 starts the
        // fade object F0x8008aaac: a full-screen grey quad, subtractive (ABR 2), its
        // level rising 0 -> 0xFF00 in 10 ticks and then held. The 0xE00 (title)
        // request follows on the next state. No button is read on this path.
        const { fade, finished } = lossExitFrame(b.timer * 60);
        b._loseFade = fade;
        if (finished) endBattle("lose");
        return;
      }
      // The translated sequence, one tick per displayed frame: the exit F0x800a7c00,
      // the defeat effect F0x8008c93c and the fade F0x8008aa08 are the original's own
      // objects, in the session's memory, and the delta they count is the shared frame
      // clock's published word (engine/systems/frame-clock.ts). The screen goes black a
      // tenth of a second at a time and the exit asks for the title screen (0xE00) out
      // of that black; the launch itself is the walker's screen change, `onLose`.
      const session = b._lossSession;
      // One step per displayed frame, each counting that frame's published delta: the
      // defeat effect reaches its phase 2 after 0xF0 delta units, and the exit's turns
      // and the fade's ramp are the original's own objects inside the session.
      for (const frame of (b._displayFrames ?? [])) session.tick();
      b.timer += dt;
      // F0x8008a96c: the quad's grey is the fade level's high byte, so the first tenth
      // of the fade is 25 and not 26.
      b._loseFade = session.fadeLevel() === 0 ? 0 : session.fadeGrey() / 255;
      if (session.finished()) {
        if (session.launchCode() !== 0xe00) console.warn("[battle] loss exit asked for", session.launchCode());
        endBattle("lose");
      }
      return;
    }

    if (b.state === ST.FLEE_FAIL) {
      b.timer += dt;
      if (b.timer > 1.0) {
        if (b._timelineMessage) {
          b.message = b._timelineMessage;
          b._timelineMessage = "";
          b.state = ST.RESULT_MSG;
        } else {
          b.state = b._nextState ?? ST.ENEMY_ACT;
        }
        b.timer = 0;
      }
      return;
    }
  }

  // The current enemy reached 0 HP: bank its drop, then either bring in the next boss-party
  // member (sequential gauntlet) or finish the battle (WIN). EXP and BIT come from the
  // battle's own reward record once, at the win (winRewards) — never per enemy.
  function defeatCurrentEnemy() {
    const b = battle;
    const drop = rollDrop(b.enemy.eStats);
    if (drop) b._loot.drops.push(drop);

    // The Galacticmon finale's scripted sequence replaces the gauntlet swap for the
    // tail's fall (claim wfightmn-finale-kinds-2026-10-10): the disc's kind word walks
    // 4 -> 5 -> 6 through the body's cannon, and the body is never fought. What the
    // player meets: "After beating the tail, the body will fire off the Ragnarock
    // Cannon, reducing your current digimon to 1 HP. Fortunately, though, you should
    // get first attack on the head" (docs/research/story-progression/WALKTHROUGH_FULL.txt:5469-5471).
    // The extracted party's three members stand in for the disc's three spawned
    // phases: member 0 the tail, 1 the body, 2 the head.
    if (b.specialMode === 4 && b.partyIndex === 0 && b.party.length === 3) {
      runFinaleBeat(b, 0);
      return;
    }

    const step = gauntletNext(b.party, b.partyIndex);
    const nextEnemy = step.done ? null : buildEnemyRecord(step.entry);
    if (!nextEnemy) {
      b.state = ST.WIN;
      b.timer = 0;
      b.message = "Battle Won!";
      b._victoryPhase = "pose";
      b._victoryReady = false;
      renderer3d?.playPlayerVictory?.();
      // wfightmn's win arm: it writes result 1 (the stager F0x8009c534(1) stores
      // `1` into the result byte 0x800a435c, fightstg.s:26513-26524) and then
      // plays W_JINGLE 0x6004001e through [0x80055c48] (.L0x000034c0-.L0x000034c4)
      // ONLY when the battle-kind word is not 6 (.L0x000034a4-.L0x000034ac) — the
      // finale's win skips the jingle. The exit cue that result 1 then takes is
      // read at arm 4's phase 2 (wfightmn.s:2165-2174): 0xE0B at kind 6 — STTITL
      // mode 11 = movie row 10 = MOVIEE01_STR, the ending movie — vs 0x1400
      // (STFRPT, the battle-result screen) otherwise. The report phase below is
      // replaced by the ending chain when the cue is the movie. Same jingle id the
      // card duel's win already plays.
      const winKind = battleKindOf(b);
      b._winLaunchCode = battleWinLaunchCode(winKind);
      if (battleWinJinglePlays(winKind)) sfx?.play("w_jingle");
      return;
    }
    nextEnemy.statusImmunities = b.statusImmunities;

    b.partyIndex = step.index;
    b.enemy = nextEnemy;
    b.timeline = initialActorTimeline(b.player.spd, nextEnemy.spd);
    // A fresh timeline is a fresh turn for the command phase's Frozen gate.
    b._turnSeq = (b._turnSeq ?? 0) + 1;
    const nextName = nextEnemy.eStats?.digimon_id ?? nextEnemy.profile?.name ?? "Enemy";
    swapEnemyModel(nextName);
    sayOriginal(b, {
      kind: MSG_KIND.NEXT_OUT, payload: [0], slots: [nextName],
    }, `${nextName} steps forward!`);
    b.menuSel = 0;
    b._nextState = ST.PLAYER_MENU;
    b.state = ST.RESULT_MSG;
    b.timer = 0;
  }

  /**
   * Run one beat of the finale's scripted sequence (FINALE_TAIL_DEFEAT_BEATS).
   *
   * Beat 0 is arm 18's default sub-state (wfightmn.s:3219-3234): presentation 0x8B
   * "What! The body?!", kind 5, the body on the field (sub-state 5's spawn,
   * :3490-3494). Beat 1 is the kind-5 body object's cannon: the current Digimon is
   * set to 1 HP and the box shows the delta it took (fightstg.s:14416-14425). Beat 2
   * is arm 22 (:3781-3793, :3843-3966): kind 6, the head on the field, and its attack
   * record rebuilt from the technique latched while the tail stood. Each beat's pages
   * advance to the next through `_finaleAfter` (see advanceAfterResult); the last
   * beat hands the command menu to the player, who gets the first turn of the head
   * phase — the kind-6 fixed roll governs the player's attacks from there on.
   */
  function runFinaleBeat(b, index) {
    const beat = FINALE_TAIL_DEFEAT_BEATS[index];
    if (!beat) return;
    b._finaleKind = beat.kind;
    if (b.player) b.player.battleKind = beat.kind;
    if (b.partyIndex !== beat.member) {
      const entry = b.party[beat.member];
      const next = entry ? buildEnemyRecord(entry) : null;
      if (next) {
        next.statusImmunities = b.statusImmunities;
        next.battleKind = beat.kind;
        b.enemy = next;
        b.partyIndex = beat.member;
        b.timeline = initialActorTimeline(b.player.spd, next.spd);
        // A fresh timeline is a fresh turn for the command phase's Frozen gate.
        b._turnSeq = (b._turnSeq ?? 0) + 1;
        const nextName = next.eStats?.digimon_id ?? next.profile?.name ?? "Enemy";
        swapEnemyModel(nextName);
      }
    } else if (b.enemy) {
      b.enemy.battleKind = beat.kind;
    }
    if (beat.head) {
      // Arm 22 state 2: the head's own attack record (technique 440, the "?????"
      // skill) is rebuilt from the technique row latched at 0x800a4538. The record
      // fields the walker's skill model carries are copied; a zero latch (nothing
      // recorded) leaves the head's own attack untouched.
      const base = skillDB?.[String(FINALE_HEAD_ATTACK_ID)] ?? null;
      const recorded = b._finaleRecordedTechId
        ? (skillDB?.[String(b._finaleRecordedTechId)] ?? null) : null;
      b._finaleCopiedAttack = base && recorded ? finaleCopiedAttackSkill(base, recorded) : null;
    }
    const pages = [];
    if (beat.message === FINALE_MSG_BODY) {
      // The line arm 18's default sub-state plays: message kind 1, esmfight 0x8B.
      pages.push({
        text: "What! The body?!",
        spec: { kind: MSG_KIND.ONE_LINE, payload: [FINALE_MSG_BODY] },
      });
    }
    if (beat.cannon) {
      // The kind-5 object's state 1 (fightstg.s:14416-14425): the current Digimon's
      // HP is set to 1, after a damage page carrying the delta it took.
      const pname = b.player.profile.name;
      const dealt = Math.max(0, b.player.hp - 1);
      b.player.hp = 1;
      pages.push({ text: `${pname} took ${dealt} damage!`, spec: damageSpec(pname, dealt, "", 0, 1) });
    }
    if (beat.message === FINALE_MSG_LEARNED && b._finaleRecordedTechId) {
      // Arm 22's state-2 message: kind 22, line one the bank's 0x8C, line two the
      // copied technique's name. Arm 22 skips it (and the record build) when nothing
      // was latched (:3869 -> .L0x00003dd4 at :3964-3966).
      const techName = skillDB?.[String(b._finaleRecordedTechId)]?.name ?? "";
      pages.push({
        text: `Galacticmon learned a technique! ${techName}!`,
        spec: { kind: 22, payload: [0], slots: [techName] },
      });
    }
    if (pages.length) {
      setResultPages(b, pages);
      b.state = ST.RESULT_MSG;
      b.timer = 0;
      // The beat hook owns every non-final stage; only the head beat hands the turn
      // to the player.
      b._nextState = index === FINALE_TAIL_DEFEAT_BEATS.length - 1 ? ST.PLAYER_MENU : ST.NONE;
      b._finaleAfter = index + 1 < FINALE_TAIL_DEFEAT_BEATS.length
        ? () => runFinaleBeat(b, index + 1) : null;
    } else {
      b._finaleAfter = null;
      if (index + 1 < FINALE_TAIL_DEFEAT_BEATS.length) runFinaleBeat(b, index + 1);
      else {
        b.menuSel = 0;
        b.state = ST.PLAYER_MENU;
        b.timer = 0;
      }
    }
  }

  /**
   * The finale's technique latch (F0x800aa06c), where the disc runs it: the damage
   * applier for a category-2/3 action calls it right before the damage wrapper
   * (wfightmn.s:4830-4842). The walker's landed damaging commit is that call's
   * closest equivalent; the predicate (player side, kind 4, the row's own filter)
   * is the engine's port.
   */
  function recordFinaleTechnique(b, techniqueId) {
    const row = fightTechDB?.[String(techniqueId | 0)] ?? null;
    if (!finaleRecordsTechnique(battleKindOf(b), 0, row)) return;
    b._finaleRecordedTechId = techniqueId | 0;
  }

  function applyTagAction(action) {
    const b = battle;
    const member = b.playerRoster[action.rosterIndex];
    const incoming = b.playerRecords[action.rosterIndex];
    const profile = digimonDB[action.formId];
    if (!member || !incoming || !profile || incoming.hp <= 0 || action.rosterIndex === b.activePlayerIndex) {
      sayOriginal(b, {
        kind: MSG_KIND.OUTCOME, payload: [MSG.SWITCH_FAILED], name: member?.name,
      }, "Cannot tag.");
      return false;
    }
    // Tag while Blast is active forfeits the charge. The shared cleanup
    // F0x800a7328 tests the combatant's reserved second form at +0x1a, and when
    // it is set it ZEROES the DV/Blast gauge at +0x58 and clears the flag
    // (EV-tag-commit-cancels-blast-static-2026-08-04; claim
    // tag-commit-cancels-blast-no-suppression-branch). It is the same routine
    // the Digivolve commit runs, so both call it. Zeroing here also prevents
    // the outgoing partner's revert from firing on the incoming one.
    releaseReservedSecondForm(b);
    // The a2 = 0 forced list is the cancel gate only (fightstg.s:21294 reads
    // self+0x58 inside the pad-0x4000 branch), so the swap through the
    // follow-up screen releases it exactly as the immediate commit does.
    b._forcedTag = false;
    b.activePlayerIndex = action.rosterIndex;
    b.player = incoming;
    // Native Tag writes the selected form id into the already-resident incoming
    // record, then marks that roster position as a battle participant.
    setLiveBattleForm(b.player, profile);
    b.participantIndices.add(action.rosterIndex);
    // Native event 4 / shared presentation selector 2 runs sequence 0x38:
    // remove outgoing actor, show the input-gated "Go for it!" message, then
    // load the chosen model. The arrival pose runs after confirmation.
    renderer3d?.setPlayerVisible(false);
    b._tagPresentation = {
      phase: "prompt",
      sequence: TAG_PRESENTATION.sequence,
      memberName: member.name,
      profile,
    };
    sayOriginal(b, {
      kind: MSG_KIND.OUTCOME, payload: [MSG.GO_FOR_IT], name: member.name,
    }, `${member.name}\nGo for it!`);
    return true;
  }

  function applyDvAction(action) {
    const b = battle;
    const member = b.playerRoster[b.activePlayerIndex];
    const profile = digimonDB[action.formId];
    if (!member || !profile) { b.message = "Cannot digivolve."; return; }
    // Manual DV is temporary and does not spend the inactive Blast gauge.
    // The original's commit (wfightmn.s:1680-1692) writes the live form id, the
    // equipped-form flags and the reserved-second-form release, and NO stat, HP,
    // MP, technique or ailment value; the numbers a changed form fights with are
    // re-derived on every read by F0x8009EC94, which is what savedSpeciesId in
    // effStats reproduces. Captured order (dv_manual.txt): the model loads AT
    // commit with a1=0 — Blast uses a1=1 and loads before its presentation — and
    // the next turn is queued as an ordinary code-2 turn. The EVOLUTIO jingle is
    // 34 frames later, so it is fired by the presentation, not here.
    commitBattleFormChange(b, profile, b.activePlayerIndex);
    swapPlayerModel(profile.name);
    // The original's box is empty while the transformation plays: its "Digivolved!"
    // page is built only when the sequence ends (the `blastShow.endSpec` below).
    clearBattleLine(b);
    b.blastShow = {
      program: FormChangeProgram.MANUAL_DV,
      frame: 0, target: null, swapped: true, healed: false, state: null, sounded: false,
      // The original's own line: wfightmn.s .L0x00001abc calls unkAC(kind 12), whose
      // arm puts `esmfight[0x16]` = "{1}" on line one (the Digimon's name, filled by
      // F0x80098d14) and `esmfight[0x37]` = "Digivolved! {1}!" on line two, with the
      // name in slot 1 out of the Digimon-name bank.
      endMessage: `Digivolved! ${profile.name}!`,
      endSpec: {
        kind: MSG_KIND.DIGIVOLVED, payload: [0], name: profile.name,
        slots: [profile.name],
      },
    };
    renderer3d?.setFaceCamVisible?.(false);
  }

  /**
   * Gather the six combatant fields the native DNA eligibility tests read.
   *
   * `statusBits` is the raw record +0x1c word. The walker models ailments by
   * name rather than as native bits, and which ailment sets bit 0x20 or 0x08 is
   * NOT established — DNA-C009 records that no applier was identified for those
   * bits, which is why only low MP and a dead participant are player-reachable
   * rejections. So we forward real bits when a record carries them and 0
   * otherwise, rather than inventing a bit-to-ailment mapping the evidence does
   * not support.
   */
  function dnaParticipantsFor(b, rosterIndex) {
    const partner = b.playerRecords?.[rosterIndex];
    return {
      activeMp: Number(b.player?.mp ?? 0),
      partnerMp: Number(partner?.mp ?? 0),
      activeHp: Number(b.player?.hp ?? 0),
      partnerHp: Number(partner?.hp ?? 0),
      activeStatus: Number(b.player?.statusBits ?? battleAilmentByte(b.player)),
      partnerStatus: Number(partner?.statusBits ?? battleAilmentByte(partner)),
    };
  }

  function applyDnaAction(action) {
    const b = battle;
    const partner = b.playerRecords[action.rosterIndex];
    const partnerProfile = digimonDB[action.formId];
    const choice = dnaChoiceFor(action.rosterIndex, partnerProfile);
    // Silent rejection, matching the native's shared no-op convergence at
    // 0x80098790: no message, no state change [DNA-C006].
    if (!partner || !choice
        || dnaRejection(dnaParticipantsFor(b, action.rosterIndex), choice.cost)) {
      return false;
    }

    // Action type 6 charges the full result-tech MP cost to both resident
    // combat records. It does not change active roster index or either saved
    // form: the DNA result is a temporary attack actor.
    b.player.mp -= choice.cost;
    partner.mp -= choice.cost;
    b.participantIndices.add(action.rosterIndex);

    const dnaSkill = {
      power: Number(choice.tech.power),
      attack_category: Number(choice.tech.category) === 2 ? "physical" : "magical",
      element: Number(choice.tech.element) === 1 ? "normal" : "normal",
      base_acc: 128,
      crit_bonus: 0,
    };
    const hit = resolveAttack(b.player, b.enemy, dnaSkill, RAND_U16, b.field);

    const originalProfile = b.player.profile;
    b._dnaPresentation = {
      phase: "parents",
      originalProfile,
      resultProfile: choice.resultProfile,
      // The game's own name for the fusion, which the announcement line uses even
      // when the mesh for it is not in web/assets/battle/models.
      fusedName: choice.fusedName,
      partnerName: partnerProfile.name,
      damage: hit.hit ? hit.dmg : 0,
      hit: hit.hit,
      lethal: hit.hit && hit.dmg >= b.enemy.hp,
      committed: false,
    };
    // The authentic clip-12 frames keep the normal HUD but suppress the
    // separate slot-7 face viewport until the battle presentation returns.
    renderer3d?.setFaceCamVisible?.(false);
    // Full clip-12 director script (5 segments, decoded 2026-07-14): battle.js is the
    // "owner" each segment's end signals — it plays each segment as a script and swaps the
    // single on-screen actor at the boundaries. Falls back to the legacy 2-phase flow
    // (parent clip + segment-2 tail) when fullScript is absent from dna_clip12.json.
    // Warm every model the presentation will swap to, so the chunk boundaries
    // don't stall on network fetches mid-show.
    for (const name of [partnerProfile.name, choice.resultProfile.name]) {
      resolveModelFolder(name).then((f) => f && renderer3d?.preloadDigimon?.(f)).catch(() => {});
    }
    const chunks = dnaScriptChunks(b._dnaPresentation);
    if (chunks) {
      b._dnaPresentation.mode = "full";
      b._dnaPresentation.chunks = chunks;
      b._dnaPresentation.chunk = 0;
      startDnaChunk(b, b._dnaPresentation);
    } else {
      renderer3d?.playPlayerActionClip(DNA_PARENT_CLIP);
    }
    b.message = `${originalProfile.name} + ${partnerProfile.name}\nDNA Digivolve!`;
    return true;
  }

  function commitDnaImpact(b, dna) {
    if (!dna?.hit || dna.committed) return;
    dna.committed = true;   // then the disc's special-encounter finalizer, WFIGHTMN 0x800aabf0
    dna.damage = finalizePlayerDamage(b, dna.damage); dna.lethal = dna.damage > 0 && dna.damage >= b.enemy.hp; b.enemy.hp = Math.max(0, b.enemy.hp - dna.damage);
    if (dna.damage > 0) noteFinalBossPhaseDamage(b);
    const enemyName = b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "Enemy";
    setResultPages(b, [
      // The fusion attack runs through the shared damage stage, so its two lines are the
      // box's own `kind 4` page (`esmfight[0x0b]` "{1} damage!") and, when it takes the
      // enemy's last HP, the controller's `kind 2` "Defeated!" page.
      { text: `${enemyName} took ${dna.damage} damage!`,
        spec: damageSpec(enemyName, dna.damage, "") },
      dna.lethal ? { text: `${enemyName} has been defeated!`,
        spec: defeatedSpec(enemyName) } : null,
    ]);
  }

  function dnaScriptChunks(dna) {
    return dnaClip12Chunks(dnaResultScript?.fullScript?.segments, dna);
  }

  function startDnaChunk(b, dna) {
    const c = dna.chunks[dna.chunk];
    if (!c || !renderer3d) return;
    if (c.show) renderer3d.setPlayerVisible(true);   // seg 4: the original actor returns
    if (dna.chunk === 3) {
      // Seg-2 second half (camera hold → white-out): the ignited orbs leave their
      // parents and dance the captured orbit path until the op7 white-out. The u
      // span = the chunk's op11 waits up to the op7 (310+18+32+56 in the real bin).
      let ticks = 0;
      for (const r of c.ops) {
        if (r.op === 7) break;
        if (r.op === 11) ticks += r.words?.[0] | 0;
      }
      renderer3d.dnaOrbsPath?.(dnaResultScript.orbPath, ticks || 416);
    }
    renderer3d.playPlayerScript({ ops: c.ops }, {
      motionTables: { 29: 29, 30: DNA_RESULT_TABLE },
      rotationBase: c.result ? dnaResultScript.resultSlot.rotation[1] : 0,
      // No camera flag here: the record a segment's op5 cuts lives until the next cut, so the
      // segment boundaries carry the shot across on their own (the original's single live
      // camera record, fightstg.s F0x80092244 / F0x800922b4 — nothing clears it).
      // Effect 1004 = the full-screen fusion flash (runtime capture dnau_0300): it covers
      // the swap from the normal arena to the pinned digital void, which then hosts the
      // whole orb-merge / reveal / result-attack sequence (dnau_0400–0650).
      // 1005/1006 = the parent-orb ignition bursts: the persistent orb overlay takes
      // over from the 42-tick effect objects (runtime decode 2026-07-15).
      onEffect: (rec) => {
        if (rec.type === 1004) renderer3d?.dnaPresentationStart?.();
        else if (rec.type === 1005) renderer3d?.dnaOrbIgnite?.("A");
        else if (rec.type === 1006) renderer3d?.dnaOrbIgnite?.("B");
      },
      // op7 type 0 = the fusion white-out; the orbs end in its flare.
      onOverlay: (rec) => {
        if (rec.type === 0) {
          renderer3d?.dnaOrbsClear?.();
          renderer3d?.dnaFusionStart?.();
        }
      },
      // op2 modes 1/2: slot 4 is the ENEMY (hidden for the void sequence, shown again for
      // the result attack's impact); the chunk's own slot controls the on-screen actor.
      onVisibility: (rec) => {
        if (rec.slot === 4) renderer3d?.setEnemyVisible?.(rec.visible);
        else if (rec.slot === c.slot) renderer3d?.setPlayerVisible(rec.visible);
      },
    });
  }

  function applyPlayerAction() {
    const b = battle;
    const action = b.pendingAction;
    if (!action) return;
    // Layer key 0x1009 shows the speaking side; this line is the player's
    // (talk-system speaker id 0).
    renderer3d?.setFaceCamSpeaker?.(0);
    const pname     = b.player.profile.name;
    const enemyName = b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "Enemy";

    // Action resolve, not the turn gate: the original's guard here is F0x80098600, which
    // tests the sleep bit (0x08) and nothing else. The Frozen roll already happened in
    // front of the command menu (`frozenGateLosesTurn`, F0x800a7418 step 1) and the
    // confuse bit was the joke list, so neither is rolled a second time here.
    const ts = processTurnStart(b.player, pname, false, false);
    if (ts.skipped) {
      // The gate's own page: the name on line one, the disc's line on line two
      // ("Asleep!", one of the eight confuse one-liners, "Frozen and can't move!").
      // FIGHTSTG_F0x80088564's three arms share the tail at fightstg.s:6017-6025.
      //
      // `ts.spec` is always there for a skipped turn: `processTurnStart` skips only for
      // sleep, frozen or confusion (engine/dw3/battle-combat.ts:571-584) and
      // `ailmentTurnStartMessageSpec` has an arm for each of those three, so there is no
      // typed sentence left on this path. `ts.prefix` is the empty string for the same
      // reason (battle-combat.ts:565), which is why the walker no longer offers its own
      // wording here.
      sayOriginal(b, ts.spec, ts.prefix);
      b.pendingAction = null;
      return;
    }
    const prefix = ts.prefix ? ts.prefix.trim() + " " : "";

    if (action.type === "confused") {
      // The joke gag is the battle message box's own two lines (F0x8009a734,
      // fightstg.s:24505-24595): the Digimon's name, then the phrase off 0x800a35e4. The
      // walker's sentence stays in `b.message` only so `?legacyBattleMsg=1` and `peek()`
      // still have something to say.
      sayOriginal(b, jokeGagMessageSpec(pname, action.jokeIndex ?? 0, action.flavorBit ?? 0),
        prefix + `${pname} is confused! ${action.flavor}`);
    } else if (action.type === "tag") {
      if (applyTagAction(action)) {
        b.pendingAction = null;
        return true;
      }
    } else if (action.type === "dna") {
      if (applyDnaAction(action)) {
        b.pendingAction = null;
        return "dna";
      }
    } else if (action.type === "dv") {
      applyDvAction(action);
    } else if (action.type === "fight") {
      const basicSkill = skillDB[b.player.profile.tech_basic];
      let skill = basicSkill ? { ...basicSkill, attack_category: "physical" } : null;
      // The record the original's own page chooser reads: the technique id is
      // `self+0x54` (`pro/fightstg.s:13109` forms `0x80042bca + 18 * id` from it), and for
      // a basic attack that id is the form's own basic technique. The id runs through the
      // fight task spawner (FIGHTSTG_F0x80090c44), which stores the acting side at +0x50 and
      // the technique word at +0x54; the machine reads the id back off the spawned object.
      const basicTechId = spawnFightTaskFor(0, skill?.id ?? b.player.profile.tech_basic ?? 0).technique;
      // *Power accessories (opcode 16): basic attacks consume the effective
      // +0x2b element and +0x2c magnitude in the shared damage stage.
      if (skill) skill = { ...skill, basic_attack: true };
      // F0x8009e0cc .L0x8009e238-.L0x8009e26c: the three-hit diversion needs the
      // plain-attack shape (this path), the record's clip byte outside {0xb,0xc},
      // AND Multi Crest (effective +0x37). The resolver carries all three.
      const attempts = basicAttackHitCount(b.player.multiAttack, skill?.clip);
      let total = 0, landed = 0;
      if (attempts > 1) {
        // F0x8009d4b8: the damage value is computed once (accuracy #1 first, then
        // the leaf with its single critical roll) and each further attempt re-rolls
        // only accuracy on that same value. Re-rolling damage here was the
        // browser's divergence (BATTLE-Q004-ROLLTABLE-001).
        const r = resolveMultiHit(b.player, b.enemy, skill, attempts, RAND_U16, b.field);
        total = r.dmg; landed = r.landed;
      } else {
        const r = resolveAttack(b.player, b.enemy, skill, RAND_U16, b.field);
        if (r.hit) { total += r.dmg; landed++; }
      }
      const hit = landed > 0;
      if (hit) {
        total = finalizePlayerDamage(b, total); const lethal = total >= b.enemy.hp;
        let committed = false;
        const commitImpact = () => {
          if (committed) return;
          committed = true;
          b.enemy.hp = Math.max(0, b.enemy.hp - total);
          if (total > 0) recordFinaleTechnique(b, basicTechId);   // the finale's latch (F0x800aa06c), before the wrapper
          if (total > 0) noteFinalBossPhaseDamage(b);   // the final boss's 3rd landed blow switches boss04 on
          let message = `${enemyName} took ${total} damage!`;
          let extra = "";
          if (attempts > 1) message += ` (${landed}/${attempts} hits)`;
          // The landed ailment is NOT part of that sentence. It is the box's own next
          // page: the original shows the damage page (kind 4), waits for the player to
          // read it, and only then builds the "apply what landed" object that prints the
          // ailment word (kind 2) — fightstg.s:14624-14626, :14705, :15198-15260.
          const inflicted = tryInflict(skill, b.enemy, enemyName, b.player);
          const weapon = applyWeaponSecondary(b.player, b.enemy, enemyName, total, pname);
          const stolen = trySteal(skill, b.enemy, getState(), pname);
          // The record's own dispatch byte — a hit's SECONDARY effect off record +0x0a,
          // the shared dispatcher FIGHTSTG_F0x8009df78 the resolver calls on a landed hit
          // (pro/fightstg.s:28588). A different machine from the `tryInflict` line above
          // (which reads the technique's own `effect`); its stat-penalty arms write the
          // persistent halfwords the inn later rests away.
          applyPostHitDispatch(b, fightTechDB?.[String(basicTechId)] ?? null);
          message += inflicted.text;
          extra += weapon.text + stolen.text + triggerCounter(b.player, b.enemy, total, pname);
          message += extra;
          const ailPage = ailmentBoxPage(enemyName, inflicted.ail ?? weapon.ail);
          // The one machine that picks this line (FIGHTSTG_F0x8008cb70, ported by
          // engine/dw3/battle-result-page.ts). An instant-death KO lands on its second
          // arm, which prints NOTHING and takes the damage line with it — see
          // `chooseResultLine`. A signature weapon's KO writes the same queue slot a
          // technique's does, so it silences the line the same way.
          const { page: resultLine } = chooseResultLine({
            record: fightTechDB?.[String(basicTechId)] ?? null,
            multiHit: attempts > 1,
            instantDeath: b.enemy.hp <= 0 && (inflicted.text !== "" || weapon.ko),
            landed,
            name: enemyName,
            damage: total,
          });
          setResultPages(b, [
            resultLine
              ? { text: prefix + message,
                spec: damageSpec(enemyName, total, prefix || extra, basicTechId, 0) }
              : null,
            ailPage,
            // The weapon's drain and a landed steal are PAGES of the box in their own
            // right (kinds 18 and 17), not fragments of the damage sentence: the
            // original's weapon machine builds each line object and asks the panel
            // separately (FIGHTSTG_F0x80091534, fightstg.s:15005 / :15055). The walker
            // keeps the flat sentence above for ?legacyBattleMsg=1 and for peek().
            weapon.page ? { text: weapon.text, spec: weapon.page } : null,
            stolen.page ? { text: stolen.text, spec: stolen.page } : null,
            lethal || b.enemy.hp <= 0 ? { text: `${enemyName} has been defeated!`,
              spec: defeatedSpec(enemyName) } : null,
          ]);
          // No page at all is a real answer, not a missing one: the chooser's
          // instant-death arm leaves the box empty (see `chooseResultLine`).
          if (!b._resultPages.length) clearBattleLine(b);
        };
        armPendingImpact(b, commitImpact);
        const started = renderer3d?.playerAttack(b.player.profile.tech_basic, {
          lethal,
          onHit: (rec) => { if (rec.type === 99) commitImpact(); },
        });
        if (!started) commitImpact();
      } else {
        // A basic attack that missed. The original's attack-resolution sequencer
        // FIGHTSTG_F0x80090e84 prints the evasion page on its own --
        // `pro/fightstg.s:14670` (`li $v0, 0x1d` = "Evade!") / `:14671` (payload word 0)
        // / `:14673` (`li $a1, 0x2`) / `:14674` (`lw $v0, 0xac($a0)`) -- so this is the
        // disc's word under the defender's name and never the walker's sentence.
        sayOriginal(b, evadeSpec(b, enemyName), `${enemyName} evaded!`);
        renderer3d?.playerAttack(b.player.profile.tech_basic, { miss: true });
      }
    } else if (action.type === "tech") {
      const skill = action.skill;
      // FIGHTSTG_F0x800a1d3c (TL-010): the displayed price, the sufficiency test and
      // the debit are one result. Proxy reduction floors at 1 first; the loaded
      // +20% premium then adds max(1, floor(cost/5)).
      const cost = techniqueMpCost(skill.mp_cost ?? 20, skill.techWord ?? 0, {
        mpCostDown: b.player.mpCostDown ?? 0,
      });
      // While Blast is active, technique execution bypasses MP sufficiency and
      // debit — techniques are free (menu MP-gate skipped at 0x80096548) [BLAST-C004].
      if (!b.blast?.active) {
        if (b.player.mp < cost) {
          // The original's technique-MP gate asks for its own page here: the damage
          // machine compares the technique's cost against the actor's MP
          // (`lh $v0, 0xc($a1)` at `pro/fightstg.s:10210` and `slt $v0, $v1` at :10212)
          // and prints `esmfight[0x8d]` "No MP!" through **kind 2** at :10219-:10227
          // (`li $v0, 0x8d` / `sw $v0, 0x60($s0)` / `li $a1, 0x2` / `lw $v0, 0xac($a0)`).
          // The command-gate arm prints the same word at :6104-:6113.
          sayOriginal(b, {
            kind: MSG_KIND.OUTCOME, payload: [MSG.NO_MP], name: b.player.profile?.name,
          }, "Not enough MP!");
          b._nextState = ST.ENEMY_ACT;
          b.pendingAction = null;
          return;
        }
        b.player.mp -= cost;
      }
      const usedCounter = setCounterStance(skill, b.player);  // f7=10: gain a counter stance
      const hits = skill.hits ?? 1;
      // A CATEGORY-4 record is a heal or a cure, not a hit, so it never enters the
      // resolver at all: the record machine's category-4 handler `0x8008fbec`
      // (`pro/fightstg.s:13269`-`:13664`) is what runs, and the applier
      // `FIGHTSTG_F0x8009e0cc` makes NO accuracy roll for it (`:28463 lbu $v1, 0x4($s4)` /
      // `:28465` / `:28467` reach the accuracy getters for categories 2 and 3; `:28470
      // j .L0x8009e3c8` sends everything else, category 4 included, down a roll-free path).
      // One rule,
      // keyed on the record's own category byte, for the player's side and the enemy's.
      // The action the command phase starts is the fight task FIGHTSTG_F0x80090c44 spawns
      // (engine/dw3/battle-task-spawn.ts): the acting side byte at +0x50 and the technique
      // word at +0x54. The record machine runs the id read back off the spawned object, so the
      // shared spawner owns the hand-off rather than a bare local.
      const actionTechId = spawnFightTaskFor(0, skill.id | 0).technique;
      const restoreRecord = fightTechDB?.[String(actionTechId)] ?? null;
      // THE WHOLE CATEGORY-5 FAMILY is one call, both sides, before the category-4
      // gate below: the eight arms of `0x8009021c` (the stat table pair, the two Chi
      // arms, the two roll-gated locks, the no-page arm, the MP transfer and Gilead
      // Plant) all run in the original's state-1 sub-state 1 and all deal no damage, so
      // none of them reaches the resolver. `battleScriptedPlanFor` is null for every
      // other technique, which is what makes it the gate.
      const scripted = battleScriptedPlanFor(b, 0, restoreRecord, skill.id, { name: pname });
      if (scripted) {
        const spec = scripted.page
          ? { kind: scripted.page.kind, payload: scripted.page.payload,
              name: scripted.page.name, slots: scripted.page.slots }
          : null;
        setResultPages(b, [{
          text: scriptedWalkerSentence(scripted, skill, pname),
          spec,
        }]);
        renderer3d?.playerAttack(skill.id ?? b.player.profile.tech_basic, { miss: false });
        b.pendingAction = null;
        return false;
      }
      const restore = battleRestorePlanFor(b, 0, restoreRecord, skill.id, { name: pname });
      if (restore) {
        const spec = restore.page
          ? { kind: restore.page.kind, payload: restore.page.payload,
              name: restore.page.name, slots: restore.page.slots }
          : null;
        setResultPages(b, [{
          text: restoreWalkerSentence(restore, skill, pname),
          spec,
        }]);
        renderer3d?.playerAttack(skill.id ?? b.player.profile.tech_basic, { miss: false });
        // The turn itself is queued by the caller's `queueAfterAction(b, "player")`,
        // exactly as every other action path is.
        b.pendingAction = null;
        return false;
      }
      // Every remaining technique on this path is an ORDINARY attack, so the resolver
      // runs: the category-4 arm above is the only one that does not, because the
      // original's applier rolls for accuracy on categories 2 and 3 alone
      // (`pro/fightstg.s:28463 lbu $v1, 0x4($s4)` / `:28465` / `:28467`, falling to
      // `:28470 j .L0x8009e3c8` for every other category).
      // F0x8009d4b8: multi-hit applier re-rolls only accuracy on one computed
      // damage value. Miss only if all whiff.
      let total = 0, healTotal = 0, anyHit = false;
      if (restoreRecord?.dispatch === DAMAGE_TERM_REPEAT_WORD) {
        // FIGHTSTG_F0x8009ddd8: the dispatch-byte-0x1f arm. Two hit slots, each with its
        // own accuracy roll and its own damage leaf, summed by the record machine. The
        // one disc technique that reaches it is 406 Back Storm.
        const r = resolveRepeatDispatch(b.player, b.enemy, skill, 0, b.field);
        total = r.total; anyHit = r.landed > 0;
      } else if (hits > 1) {
        const r = resolveMultiHit(b.player, b.enemy, skill, hits, RAND_U16, b.field);
        total = r.dmg; healTotal = r.heal; anyHit = r.hit;
      } else {
        const r = resolveAttack(b.player, b.enemy, skill, RAND_U16, b.field);
        if (r.hit) { total += r.dmg; healTotal += r.heal; anyHit = true; }
      }
      const elemTag = (skill.element && skill.element !== "normal") ? ` [${skill.element}]` : "";
      if (anyHit) {
        total = finalizePlayerDamage(b, total); const lethal = total >= b.enemy.hp;
        let committed = false;
        const commitImpact = () => {
          if (committed) return;
          committed = true;
          b.enemy.hp = Math.max(0, b.enemy.hp - total);
          if (total > 0) recordFinaleTechnique(b, actionTechId);   // the finale's latch (F0x800aa06c), before the wrapper
          if (total > 0) noteFinalBossPhaseDamage(b);
          let message = `${enemyName} took ${total} damage!`;
          let extra = "";
          if (hits > 1) message += ` (${hits} hits)`;
          if (healTotal > 0) {
            const before = b.player.hp;
            b.player.hp = Math.min(b.player.maxHp, b.player.hp + healTotal);
            const recovered = b.player.hp - before;
            if (recovered > 0) { message += ` Drained ${recovered} HP!`; extra += "drain"; }
          }
          // The heal and cure arms never reach this block, so the only HP this path can
          // add to the player is a weapon drain.
          const missingForPage = Math.max(0, b.player.maxHp - b.player.hp);
          const after = tryInflict(skill, b.enemy, enemyName, b.player);
          const weapon = applyWeaponSecondary(b.player, b.enemy, enemyName, total, pname);
          const stolen = trySteal(skill, b.enemy, getState(), pname);
          // A hit's SECONDARY effect off the record's dispatch byte: FIGHTSTG_F0x8009df78,
          // the resolver's own post-hit call (pro/fightstg.s:28588). See
          // `applyPostHitDispatch`. No-op unless the record is a stat-penalty arm.
          applyPostHitDispatch(b, restoreRecord); if ((restoreRecord?.dispatch | 0) === RESULT_QUEUE.CROSS_SLASH) b._enemyFled = true; // Cross Slash (record +0x0a = 35): its result-queue slot 35 drains to "the target flees" (fightstg F0x80091a8c) — here the target is the enemy
          message += after.text;
          extra += after.text + weapon.text + stolen.text
                      + triggerCounter(b.player, b.enemy, total, pname);
          if (usedCounter) message += ` ${pname} braces to counter!`;
          const ailPage = ailmentBoxPage(enemyName, after.ail ?? weapon.ail);
          // The one machine that picks this line (FIGHTSTG_F0x8008cb70, ported by
          // engine/dw3/battle-result-page.ts). An instant-death KO lands on its second
          // arm, which prints NOTHING and takes the damage line with it.
          const { page: resultLine } = chooseResultLine({
            record: restoreRecord,
            multiHit: hits > 1,
            instantDeath: b.enemy.hp <= 0 && (after.text !== "" || weapon.ko),
            landed: anyHit,
            name: enemyName,
            damage: total,
          });
          setResultPages(b, [
            resultLine
              ? { text: prefix + message,
                spec: damageSpec(enemyName, total, prefix || extra, skill?.id ?? 0, 0, {
                  heal: healTotal, missingHp: missingForPage, healer: pname,
                }) }
              : null,
            ailPage,
            weapon.page ? { text: weapon.text, spec: weapon.page } : null,
            stolen.page ? { text: stolen.text, spec: stolen.page } : null,
            lethal || b.enemy.hp <= 0 ? { text: `${enemyName} has been defeated!`,
              spec: defeatedSpec(enemyName) } : null,
          ]);
          // No page at all is a real answer, not a missing one: the chooser's
          // instant-death arm leaves the box empty (see `chooseResultLine`).
          if (!b._resultPages.length) clearBattleLine(b);
        };
        armPendingImpact(b, commitImpact);
        const started = renderer3d?.playerAttack(skill.id ?? b.player.profile.tech_basic, {
          lethal,
          onHit: (rec) => { if (rec.type === 99) commitImpact(); },
        });
        if (!started) commitImpact();
      } else {
        // A technique that missed is TWO pages in the original, not one sentence: the
        // attack-resolution sequencer FIGHTSTG_F0x80090e84 asks for the technique
        // announcement (`kind 3`, `pro/fightstg.s:14582`/`:14583`) and then, when no
        // attempt landed, for the evasion page (`kind 2`, `:14673`/`:14674`) -- the same
        // two calls it makes for a technique that lands, where the second is the damage
        // page instead (`:14654`/`:14655`). The walker used to flatten both into
        // "<tech>! <enemy> evaded!".
        const text = prefix + `${skill.name}${elemTag}! ${enemyName} evaded!`;
        // The counter stance has no page of its own on this path in the two overlays:
        // the only `esmfight[0x0a]` "Counter! {1}!" page is `kind 5` inside the technique
        // machine FIGHTSTG_F0x8008ee84 (`pro/fightstg.s:12546`-`:12556`), which this miss
        // never reaches, so the note stays in the walker's own sentence.
        const countered = usedCounter ? ` ${pname} braces to counter!` : "";
        setResultPages(b, [
          { text: text + countered, spec: techniqueSpec(b, skill) },
          { text: text + countered, spec: evadeSpec(b, enemyName) },
        ]);
        renderer3d?.playerAttack(skill.id ?? b.player.profile.tech_basic, { miss: true });
      }
    } else if (action.type === "item") {
      const item  = action.item;
      const state = getState();
      const pname = b.player.profile.name;
      const enemyName = b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "Enemy";
      // Start the item-use motion through the SAME 3-D action entry the attack paths use
      // (`ActorAnimator.setAction`, reached here through the renderer's shared
      // `playPlayerActionClip`). The original's item machine allocates an action actor and
      // writes its clip +0x54 = 10 (fightstg.s:11099-11105), so the acting Digimon plays
      // action clip 10 — its op2 tables 44/45, its op5 camera and its op10 effect — exactly
      // as a technique plays its own clip. With no op1 in that script there is no defender
      // reaction, which is why the item does not go through `playerAttack`/the coordinator.
      renderer3d?.playPlayerActionClip(ITEM_USE_CLIP);
      if (item.effect === "full_hp" && !isBattleEffectItem(item.id)) {
        const healed = b.player.maxHp - b.player.hp;
        b.player.hp = b.player.maxHp;
        // The generic charge handler 0x8008dc00 (items 43-65): at full HP it asks for
        // kind 1 with `esmfight[0x2f]` "No effect!" (fightstg.s:11234), otherwise kind 8
        // with `esmfight[0x22]` `{1}HP healed!` and the amount in slot 1 (:11258).
        const page = healed > 0 ? chargeHealPage(pname, healed) : chargeNoEffectPage();
        showItemPage(b, prefix, `Used ${item.name}! ${healed} HP restored!`, [page]);
      } else if (item.effect === "hp" && !isBattleEffectItem(item.id)) {
        const healed = Math.min(item.value, b.player.maxHp - b.player.hp);
        b.player.hp += healed;
        const page = healed > 0 ? chargeHealPage(pname, healed) : chargeNoEffectPage();
        showItemPage(b, prefix, `Used ${item.name}! ${healed} HP restored!`, [page]);
      } else if (item.effect === "mp" && !isBattleEffectItem(item.id)) {
        const restored = Math.min(item.value, b.player.maxMp - b.player.mp);
        b.player.mp += restored;
        // The disc has no MP-restore page of its own for a charge: the same 0x8008dc00
        // handler only ever builds the `{1}HP healed!` page, so this one keeps the
        // walker's sentence rather than borrow the HP wording.
        b.message = prefix + `Used ${item.name}! ${restored} MP restored!`;
      } else if (isBattleEffectItem(item.id) || item.effect === "battle") {
        // Battle-class items (66–90): the decoded FIGHTSTG jump-table dispatch.
        // Field state feeds the shared damage stage; TNTBall resolves virtual
        // Flame Ball while CrimsonCable uses its exact maxHP/5 producer.
        const r = useBattleItem(item.id, b.player, b.enemy, {
          userName: pname,
          enemyName,
          party: b.playerRecords,
          userIndex: b.activePlayerIndex ?? 0,
          effectGates: b.effectGates,
          specialMode: b.specialMode,
          setField: (element, power) => { b.field = { element, power }; },
          magicalHit: (power, element) => {
            const atk = effStats(b.player), def = effStats(b.enemy);
            return Math.max(1, resolveDamage(magicalBase(atk, def, power), atk, def,
              { power, element, base_acc: 128, crit_bonus: 0, magical: true }, RAND_U16, b.field));
          },
        });
        // Every handler in the band ends by asking the shared battle message box for its
        // own page(s); `r.pages` is that call verbatim (message id + kind + payload), so
        // the words on screen are the disc's own and not this file's sentences.
        showItemPage(b, prefix, `Used ${item.name}!`, r.pages);
        if (item.id === 76) persistPlayerGauge(b);
        if (!r.ok) {
          // "No effect!" / "Evade!" — the original still consumes the item (state-2 bag
          // decrement runs unconditionally), so fall through to consumption.
        }
      }
      // NO cue here. This used to play RECOVERY (0x00040014) on the strength of
      // a doc line that named the fightstg site at 0x80086d64 "the recovery
      // effect" — but that site's delay slot is `ori $a0, 0x5ec9` after
      // `lui $a0, 0xa004`, i.e. PLAYER11, not RECOVERY. The name was 2026-07-27
      // name-shift residue. RECOVERY's only literal call sites in the whole
      // corpus are in cardgame and ststatus (the save ceremony), and although it
      // is op10 table entry 7, no shipped action script emits type 7 — 245 model
      // packs plus dna_clip12 use 54 distinct types and 7 is not among them. So
      // the battle overlay never plays it, and an item heal getting a cue here
      // was invented. What the original plays for an item heal, if anything, is
      // an open question; see docs/research/audio/sound-system.md.
      // Consume from inventory through the shared store (F0x800161D8's remove arm).
      storeRemoveItem(state, item.id, 1);
      localStorage.setItem("inventory", JSON.stringify(state.inventory));
      b._nextState = ST.ENEMY_ACT;
    }
    b.pendingAction = null;
    return false;
  }

  // Pick enemy action from ai_moves (sdigiedt Moves struct).
  // Conditions 0-7 are the self/target HP-MP predicates. 8, 10, 11, 12 and 13
  // are wired to the operands the walker owns; 9 and 14-18 still depend on
  // unread fight-workspace record fields and are skipped rather than guessed.
  function pickEnemyMove(en) {
    const moves = en.eStats?.ai_moves;
    if (!moves || !moves.length) return { action: 1 };
    // check_move_cond operands: the active party form (0x800a4468 record +0x00
    // -> DIGIMON_PROFILES row), the field element (0x800a4530), the battle id
    // (0x80042b2c) and encounter config byte 1 (0x80042b59). The walker fights
    // one enemy at a time, so the enemy-slot scan sees only this actor and
    // condition 10 is false -- a simultaneous multi-enemy model is a separate
    // divergence, not something to fake here.
    const context = {
      partyProfileId: battle.player?.profile?.id ?? null,
      fieldElementId: battle.field ? elementId(battle.field.element) : 0,
      battleId: battle.screenId ?? null,
      encounterGateByte: battle.encounterGateBytes?.[1] ?? null,
      enemySlots: [{ speciesId: Number(en.profile?.id) || 0, hp: en.hp }],
      activeEnemyIndex: 0,
    };
    for (const m of moves) {
      const pass = enemyMoveCondition(m.comparator, m.value, en, RAND_U16, battle.player, context);
      if (pass === true) return m;
    }
    // The original selection loop is not decoded far enough to justify forcing a failed or
    // unsupported final row. Basic attack is the walker's explicit safe fallback.
    return { action: 1 };
  }

  function applyEnemyAction() {
    const b  = battle;
    const en = b.enemy;
    const name = en.eStats?.digimon_id ?? en.profile?.name ?? "Enemy";
    // Layer key 0x1009 shows the speaking side; this line is the enemy's
    // (talk-system speaker id 0x10).
    renderer3d?.setFaceCamSpeaker?.(0x10);

    const pname = b.player.profile.name;

    // Start-of-turn ailments on the enemy: poison DoT, then frozen/sleep/confuse may skip.
    const ts = processTurnStart(en, name);
    if (ts.skipped) {
      // The gate's own page (FIGHTSTG_F0x80088564, shared tail at fightstg.s:6017-6025).
      // `ts.spec` is always present for a skipped turn and `ts.prefix` is always empty --
      // see the player-side arm above for why.
      sayOriginal(b, ts.spec, ts.prefix);
      // No attack animation on a skipped turn.
      return;
    }
    const prefix = ts.prefix ? ts.prefix.trim() + " " : "";

    const move = pickEnemyMove(en);

    // AI action 4 maps to the type-4 special task; its consumer is the enemy escape
    // roll F0x800a1608. Binder halves the base; Sleep refuses the flee, Frozen halves it.
    if (move.action === 4) {
      if (enemyFleeProc(b.player.spd, en.spd, b.player.binderCrest, RAND_U16, battleAilmentByte(en))) {
        // The original's flee beat is three pages of its own, one per outcome:
        // `esmfight[0x5e]` "Trying to flee." (:6129), `esmfight[0x5f]` "Fleeing!"
        // (:5882) and `esmfight[0x43]` "Run away!" -- the last one written by the Run
        // command itself in the battle controller, `pro/wfightmn.s:2222`-`:2231`.
        sayOriginal(b, {
          kind: MSG_KIND.OUTCOME, payload: [MSG.RUN_AWAY], name,
        }, `${name} ran away!`);
        b._enemyFled = true;
      } else {
        // `esmfight[0x60]` "Did not flee." -- the command-gate arm that rolls the escape
        // and prints the refusal, `pro/fightstg.s:5942`/`:5947`.
        sayOriginal(b, {
          kind: MSG_KIND.OUTCOME, payload: [MSG.DID_NOT_FLEE], name,
        }, `${name} couldn't escape!`);
      }
      return;
    }

    // FIGHTSTG_F0x80089148 maps action 1/2/3 to attack/move_1/move_2. The old
    // profile.techs lookup could never work because enemy profiles intentionally contain no
    // player-form tech list, so every enemy silently used Fight. Actions 4..8 are distinct
    // special task paths and deliberately fall back until those effects are decoded.
    const requestedSkillId = enemyActionSkillId(move.action || 1, en.eStats ?? {});
    const requestedSkill = requestedSkillId ? skillDB[requestedSkillId] : null;
    const usesTech = (move.action === 2 || move.action === 3) && !!requestedSkill;
    let skill = requestedSkill;
    if (!skill) skill = en.fightSkill ?? null;
    // The finale's head attacks with the technique it copied from the player: arm 22
    // state 2 rebuilt its own attack record (technique 440, the "?????" skill) from
    // the row latched while the tail stood, so that id serves the rebuilt record from
    // the head phase on (claim wfightmn-finale-kinds-2026-10-10).
    if (b._finaleCopiedAttack && (requestedSkillId | 0) === FINALE_HEAD_ATTACK_ID) skill = b._finaleCopiedAttack;
    if (!usesTech && skill) skill = { ...skill, attack_category: "physical" };
    if (!usesTech && skill) skill = { ...skill, basic_attack: true };
    if (usesTech) en.mp -= techniqueMpCost(skill.mp_cost ?? 0, 0, { enemySide: true }); // enemy side pays list price

    const usedCounter = setCounterStance(skill, en);  // f7=10: enemy gains a counter stance
    const hits = skill?.hits ?? 1;
    // The SAME rule the player's side runs, on the enemy's side: a category-4 record is a
    // heal or a cure and never enters the resolver, because the original's applier rolls
    // for accuracy only on categories 2 and 3 (`pro/fightstg.s:28463 lbu $v1, 0x4($s4)` /
    // `:28465` / `:28467`, falling to `:28470 j .L0x8009e3c8` for every other category).
    // The record machine's category-4 handler `0x8008fbec` is the
    // shared system; 100 and 375 restore the PLAYER's party because that arm hard-codes
    // side 0 (`sw $zr, 0x64($s4)` :13448 / `addiu $a0, $v0, 0x4470` :13443).
    const restoreRecord = skill?.id ? (fightTechDB?.[String(skill.id | 0)] ?? null) : null;
    // The SAME category-5 family the player's side runs, from the same one call. Knightmon's
    // `move_2` is Soul Charge (209) and Raidenmon's `move_1` is Gilead Plant (400) in
    // web/assets/data/enemies.json, so an ENEMY charges, locks, drains and heals too: the
    // same arms, the same record bytes, and every value read on whichever side acts next.
    const scripted = battleScriptedPlanFor(b, 1, restoreRecord, skill?.id ?? 0, { name });
    if (scripted) {
      const spec = scripted.page
        ? { kind: scripted.page.kind, payload: scripted.page.payload,
            name: scripted.page.name, slots: scripted.page.slots }
        : null;
      const text = scriptedWalkerSentence(scripted, skill, name);
      if (spec) sayOriginal(b, spec, text); else sayWalker(b, text);
      renderer3d?.enemyAttack(skill.id ?? en.profile?.tech_basic, { miss: false });
      return;
    }
    const restore = battleRestorePlanFor(b, 1, restoreRecord, skill?.id ?? 0, { name });
    if (restore) {
      const spec = restore.page
        ? { kind: restore.page.kind, payload: restore.page.payload,
            name: restore.page.name, slots: restore.page.slots }
        : null;
      const text = restoreWalkerSentence(restore, skill, name);
      if (spec) sayOriginal(b, spec, text); else sayWalker(b, text);
      renderer3d?.enemyAttack(skill.id ?? en.profile?.tech_basic, { miss: false });
      return;
    }
    // F0x8009d4b8: the multi-hit applier re-rolls only accuracy on one computed
    // damage value. Miss only if all whiff.
    let total = 0, healTotal = 0, anyHit = false;
    if (restoreRecord?.dispatch === DAMAGE_TERM_REPEAT_WORD) {
      // FIGHTSTG_F0x8009ddd8 on the enemy's side too: the one disc record with dispatch
      // byte 0x1f is 406 Back Storm, which is Raijinmon's `move_2` in enemies.json. Two
      // hit slots, each rolled and computed independently, summed by the record machine.
      const r = resolveRepeatDispatch(en, b.player, skill, 1, b.field);
      total = r.total; anyHit = r.landed > 0;
    } else if (hits > 1) {
      const r = resolveMultiHit(en, b.player, skill, hits, RAND_U16, b.field);
      total = r.dmg; healTotal = r.heal; anyHit = r.hit;
    } else {
      const r = resolveAttack(en, b.player, skill, RAND_U16, b.field);
      if (r.hit) { total += r.dmg; healTotal += r.heal; anyHit = true; }
    }
    const elemTag = (skill?.element && skill.element !== "normal") ? ` [${skill.element}]` : "";
    const skillName = skill?.name && skill.name !== "Fight" ? skill.name : null;
    // The ordinary attack's own announcement plate -- the SHARED one the player's
    // "Fight" choice already puts up (`confirmCommand` / `confirmJokePick`). The
    // original's attack-resolution sequencer builds kind 2 `esmfight[0x08]` "Attack!"
    // for whichever side swings (`pro/fightstg.s:14548`-`:14556`), so the enemy
    // announces through the same plate; until now the enemy action never reached it and
    // only the damage page followed. A named technique has its own page (kind 3,
    // `enemyTechniqueSpec`), which is why this is gated on the basic-attack word.
    if (!skillName) sayOriginal(b, attackSpec(b, name), `${name} attacks!`);
    if (anyHit) {
      const lethal = total >= b.player.hp;
      let committed = false;
      const commitImpact = () => {
        if (committed) return;
        committed = true;
        b.player.hp = Math.max(0, b.player.hp - total);
        // The disc's hit-gain gate (wfightmn 0x4330 = 0x800aa110): no gain on a lethal hit, nor while Blast is up.
        const hitGain = hitGaugeGain(total, b.player.maxHp, b.player.hp, { blastActive: !!b.blast?.active, accessories: b.player.gaugeAccessories });
        if (hitGain !== null) {   // the writer ran; `null` means it short-circuited on a KO or a Blast [BLAST-C002]
          b.player.gauge = normalizeDvGauge(b.player.gauge + hitGain);
          persistPlayerGauge(b);
          if (blastReady(b)) b._blastPending = true;
        }
        const enemyMissingBeforeHeal = Math.max(0, en.maxHp - en.hp);
        if (healTotal > 0) en.hp = Math.min(en.maxHp, en.hp + healTotal);
        b.message = (skillName
          ? `${name} uses ${skillName}${elemTag}! ${total} damage!`
          : `${name} attacks! ${total} damage!`);
        if (hits > 1) b.message += ` (${hits} hits)`;
        // As on the player's side: the ailment is the box's own next page, not a
        // fragment of the damage sentence (fightstg.s:14624-14626 and :15277-15279).
        const inflicted = tryInflict(skill, b.player, pname, en);
        // The resolver's post-hit dispatch (FIGHTSTG_F0x8009df78, pro/fightstg.s:28588):
        // a landed enemy hit also runs the record's +0x0a secondary effect, which is how a
        // Cardmon's attack lands the persistent stat penalty on the member it hit.
        applyPostHitDispatch(b, restoreRecord); if ((restoreRecord?.dispatch | 0) === RESULT_QUEUE.CROSS_SLASH) b._forcedFlee = true; // Cross Slash (record +0x0a = 35): its result-queue slot 35 drains to "the target flees" (fightstg F0x80091a8c)
        b.message += inflicted.text;
        if (usedCounter) b.message += ` ${name} braces to counter!`;
        b.message = prefix + b.message;
        // The line names the Digimon that took the damage, as on the player's side.
        // The enemy's technique announcement is the sequencer's OWN page before the
        // damage page (FIGHTSTG_F0x80090e84: `kind 3` at `pro/fightstg.s:14582`/`:14583`,
        // then `kind 4` at `:14654`/`:14655`), so a named technique no longer costs the
        // walker its damage page: it becomes the first page of the sequence.
        const counterText = triggerPlayerCounter(b, en, b.player, total, name, pname);
        const dmgSpec = damageSpec(pname, total,
          prefix || counterText || (usedCounter ? "counter" : ""), skill?.id ?? 0, 1,
          healTotal > 0
            ? { heal: healTotal, missingHp: enemyMissingBeforeHeal, healer: name }
            : null);
        const techPage = skillName ? {
          text: `${name} uses ${skillName}${elemTag}!`,
          spec: enemyTechniqueSpec(name, skill),
        } : null;
        const ailPage = ailmentBoxPage(pname, inflicted.ail);
        // The one machine that picks this line (FIGHTSTG_F0x8008cb70, ported by
        // engine/dw3/battle-result-page.ts), on the enemy's side too: an instant-death
        // KO lands on its second arm, which prints NOTHING and takes the damage line with
        // it. The technique announcement in front of it is the sequencer's OWN page
        // (FIGHTSTG_F0x80090e84), a different machine, so it stays.
        const { page: resultLine } = chooseResultLine({
          record: restoreRecord,
          multiHit: hits > 1,
          instantDeath: b.player.hp <= 0 && inflicted.text !== "",
          landed: anyHit,
          name: pname,
          damage: total,
        });
        const pages = [];
        if (techPage) pages.push(techPage);
        if (resultLine) pages.push({ text: b.message, spec: dmgSpec });
        if (ailPage) pages.push(ailPage);
        // No page at all is a real answer, not a missing one: the chooser's instant-death
        // arm leaves the box empty (see `chooseResultLine`), so nothing is put up.
        if (!pages.length) clearBattleLine(b);
        else if (pages.length > 1) setResultPages(b, pages);
        else if (pages[0].spec) sayOriginal(b, pages[0].spec, pages[0].text);
        else sayWalker(b, pages[0].text);
      };
      armPendingImpact(b, commitImpact);
      const started = renderer3d?.enemyAttack(skill?.id ?? en.profile?.tech_basic, {
        lethal,
        onHit: (rec) => { if (rec.type === 99) commitImpact(); },
      });
      if (!started) commitImpact();
    } else {
      // A miss prints the box's own evasion page, the same shared `evadeSpec` the
      // player's attack uses: the sequencer writes `esmfight[0x1d]` "Evade!" under the
      // defender's name when nothing landed, either side (`pro/fightstg.s:14673`/`:14674`).
      // The enemy path used to leave a typed sentence here, so the announcement plate
      // above was the only page; now the miss reads the disc's own words too.
      const countered = usedCounter ? ` ${name} braces to counter!` : "";
      sayOriginal(b, evadeSpec(b, pname), prefix + `${pname} evaded!` + countered);
      renderer3d?.enemyAttack(skill?.id ?? en.profile?.tech_basic, { miss: true });
    }
  }

  function triggerPlayerCounter(b, attacker, defender, damage, attackerName, defenderName) {
    const stance = triggerCounter(attacker, defender, damage, attackerName);
    if (stance) return stance;
    if (!defender.counterCrest || defender.hp <= 0 || damage <= 0 ||
        !counterCrestProc(damage, defender.maxHp, RAND_U16)) return "";
    const basic = skillDB[defender.profile?.tech_basic];
    const skill = basic ? { ...basic, attack_category: "physical" } : null;
    const counterSkill = skill ? { ...skill, basic_attack: true } : null;
    const r = resolveAttack(defender, attacker, counterSkill, RAND_U16, b.field);
    if (!r.hit) return ` ${defenderName} countered, but ${attackerName} evaded!`;
    attacker.hp = Math.max(0, attacker.hp - r.dmg);
    return ` ${defenderName} countered for ${r.dmg} damage!`;
  }

  // Roll enemy item drop. Returns item name string or null.
  function rollDrop(eStats) {
    if (!eStats || !eStats.drop_item || eStats.drop_item === "Null") return null;
    if (Math.random() * 255 < eStats.drop_rate) return eStats.drop_item;
    return null;
  }

  // Resolve a digimon profile by its DiscId. The evolution trees name their forms by
  // DigimonId (the 1-based species-table row), which is also what the form ledger keys,
  // so nothing in the unlock path has to go through a name and get it misspelled.
  function profileById(id) {
    return digimonDB?.[Number(id)] ?? null;
  }

  // Resolve a digimon profile by display name (evolutions.json `to` → digimon.json profile).
  // Built lazily from digimonDB; returns null if the evolved form has no profile in our data.
  let _profileByName = null;
  function profileByName(name) {
    if (!digimonDB) return null;
    if (!_profileByName) {
      _profileByName = {};
      for (const id of Object.keys(digimonDB)) _profileByName[digimonDB[id].name] = digimonDB[id];
    }
    return _profileByName[canonicalProfileName(name)] ?? null;
  }

  // From a list of available evos, keep only those whose target form has a usable profile
  // (so the menu never offers an evolution we can't actually apply). Dedupes by `to`.
  function evoTargets(evos) {
    const seen = new Set();
    const out = [];
    for (const e of evos ?? []) {
      if (seen.has(e.to)) continue;
      if (!profileByName(e.to)) continue; // no stat profile for this form → can't apply
      seen.add(e.to);
      out.push(e);
    }
    return out;
  }

  // Apply an evolution: switch the partner's digimon to `toName`, recompute max HP/MP at the
  // current level (+ stat-item bonuses), full-heal, and persist. The partner identity rides on
  // the character's `digimonId` (getPlayerProfile reads it); we also stash it in partnerStats so
  // it survives a reload. Returns { ok, from, name } or { ok:false }.
  function partyFormState(state, rosterIndex = 0) {
    const charId = state?.party?.[rosterIndex]
      ?? (rosterIndex === 0 ? state?.manifest?.characters?.[state?.charIdx]?.id : null);
    const rookieId = Number(CHARID_TO_DIGID[charId]);
    const rookie = digimonDB?.[rookieId];
    if (!rookie) return null;
    if (!Array.isArray(state.partyStats) || state.partyStats.length !== (state.party?.length ?? 1))
      state.partyStats = (state.party ?? [charId]).map((_, i) => i === 0 ? state.partnerStats : null);
    if (rosterIndex > 0 && !state.partyStats[rosterIndex])
      state.partyStats[rosterIndex] = baseStatsFor(rookie);
    const stats = rosterIndex === 0 ? state.partnerStats : state.partyStats[rosterIndex];
    const current = digimonDB?.[Number(stats?.digimonId ?? rookieId)] ?? rookie;
    // Which of the eight trees this member learns from. The unlock routine takes a
    // roster slot, so the slot is the member's identity here — not the form it is in.
    const slot = rosterSlotOfCharId(charId) ?? rookieId - 1;
    return { charId, rookieId, rookie, current, stats, slot };
  }

  function initializePartyStats(state) {
    if (!Array.isArray(state?.party) || !state.party.length) return false;
    state.partyStats = state.party.map((charId) =>
      baseStatsFor(digimonDB?.[Number(CHARID_TO_DIGID[charId])]),
    );
    state.partnerStats = state.partyStats[0];
    localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
    return !!state.partnerStats;
  }

  function applyEvolution(toName, state = getState(), rosterIndex = 0) {
    const prof = profileByName(toName);
    const member = partyFormState(state, rosterIndex);
    const ps = member?.stats;
    if (!prof || !member || !ps) return { ok: false };
    const from = member.current?.name ?? "Your partner";
    const level = ps.level ?? 1;
    const { maxHp, maxMp } = evolvedMaxStats(prof, level, ps.bonuses);
    ps.formLedger ??= [];
    if (prof.id > 8 && !ps.formLedger.some((record) => Number(record.id) === Number(prof.id)))
      ps.formLedger.push({ id: prof.id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] });
    ps.equippedForms ??= [];
    if (prof.id > 8 && !ps.equippedForms.includes(prof.id)) {
      // stfgtrep file 0x3898-0x38C0: first free slot, or nothing at all when
      // the three slots are full. The oldest form is never shifted out.
      const fitted = autoEquipForm(ps.equippedForms, prof.id);
      ps.equippedForms = fitted.equipped;
    }
    ps.digimonId = prof.id;          // persisted partner identity (restored on load)
    ps.maxHp = maxHp; ps.maxMp = maxMp;
    ps.hp = maxHp; ps.mp = maxMp;    // evolution restores HP/MP
    // Form change swaps the stat body: reseed the stored core block from the new
    // profile at the current level (trained deltas belong to the previous form).
    ps.stats = seedStoredStats(prof, level);
    if (rosterIndex === 0) {
      state.partnerStats = ps;
      const char = state.manifest?.characters?.[state.charIdx];
      if (char) char.digimonId = prof.id; // live session: future battles use the new form
      localStorage.setItem("partnerStats", JSON.stringify(ps));
    } else {
      state.partyStats[rosterIndex] = ps;
      localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
    }
    _profileByName = null; // (no-op; profiles don't change, kept for symmetry)
    return { ok: true, from, name: prof.name };
  }

  // The current partner's resolved profile + scaled combat stats at its level (+ bonuses) —
  // for the menu's Digimon/Status tabs. null when there's no partner yet.
  function partnerInfo(state) {
    const prof = getPlayerProfile(state);
    const ps = state?.partnerStats;
    if (!prof || !ps) return null;
    const level = ps.level ?? 1;
    const b = ps.bonuses ?? {};
    const st = ensureStoredStats(ps, prof);
    const stat = (k) => st[k] + (b[k] ?? 0);
    // DV (form) level: derived from the current form's DVEXP bank (fn 0x800865c0).
    const formCap = prof.dv_cap ?? 100;
    const dvexp = ps.dvexpByForm?.[prof.id] ?? ps.dvexp ?? 0;
    return {
      name: prof.name, level,
      hp: ps.hp, maxHp: ps.maxHp, mp: ps.mp, maxMp: ps.maxMp,
      str: stat("str"), def: stat("def"), spt: stat("spt"),
      wis: stat("wis"), spd: stat("spd"), chr: stat("chr"),
      dvLevel: dvLevelForExp(dvexp, formCap), dvexp,
    };
  }

  // The forms this partner can be in RIGHT NOW: the three it has already equipped,
  // then the forms its own line's tree says it has earned and not yet used. The
  // second list is one rule call over the disc's tree for THIS roster slot, so a
  // Kotemon line is never offered another line's route.
  function availableEvolutions(state, rosterIndex = 0) {
    const member = partyFormState(state, rosterIndex);
    if (!member?.stats) return [];
    const out = [];
    const seen = new Set();
    const add = (prof, entry) => {
      if (!prof || seen.has(prof.id) || out.length >= 3) return;
      seen.add(prof.id);
      out.push({ ...entry, to: prof.name, formId: prof.id });
    };
    for (const id of member.stats.equippedForms ?? []) {
      add(digimonDB?.[Number(id)], { to: null, equipped: true });
    }
    for (const entry of treeCandidatesFor(evolutionTrees, digimonDB, member)) add(profileById(entry.toId), entry);
    return out;
  }

  // evolutionTrees: the disc's eight per-roster-slot trees (assets/data/evolutions.json).
  let evolutionTrees = null;

  function applyParticipantProgress(b, rosterIndex) {
    const player = b.playerRecords[rosterIndex];
    const ps = player.statsRecord;
    const prof = player.profile;
    const reward = winRewards(b, rosterIndex);
    const lu = progressionDB?.level_up;
    // The partner as it stood BEFORE this battle's rewards: the results screen
    // replays the disc's own rules from this snapshot on a private record, so it
    // shows the same outcome this function applies (once) to the walker's state.
    const before = JSON.parse(JSON.stringify(ps));
    const oldXp = ps.xp ?? 0;
    const newXp = Math.min(oldXp + reward.xp, lu?.exp_cap ?? 999999);
    const oldLevel = ps.level ?? 1;
    const newLevel = lu ? levelForExp(oldLevel, newXp, prof.growth_xp ?? 8, lu)
                        : 1 + Math.floor(newXp / 100);
    let levelUp = false;
    let availableEvos = [];
    const learnedTechs = [];
    const loadableTechs = [];
    const formLevelsGained = [];
    const unlocked = [];
    const namedSkill = (id) => skillDB?.[Number(id) & 0x1fff]?.name ?? "";

    if (newLevel > oldLevel) {
      levelUp = true;
      ps.level = newLevel;
      if (lu) {
        ensureStoredStats(ps, prof);
        for (let lv = oldLevel + 1; lv <= newLevel; lv++)
          applyLevelUpGains(ps, rollLevelUpGains(prof, lv, lu), lu);
      } else {
        ps.maxHp = scaledStat(prof, "hp", newLevel) + (ps.bonuses?.hp ?? 0);
        ps.maxMp = scaledStat(prof, "mp", newLevel) + (ps.bonuses?.mp ?? 0);
      }
      ps.hp = ps.maxHp;
      ps.mp = ps.maxMp;
      const tpCap = lu?.tp_cap ?? 99;
      ps.tp = Math.min((ps.tp ?? 0) +
        (lu?.tp_per_level ?? 5) * (newLevel - oldLevel), tpCap);
      if (rosterIndex === 0)
        availableEvos = treeCandidatesFor(evolutionTrees, digimonDB, partyFormState(getState(), rosterIndex));
    }
    ps.xp = newXp;

    if (reward.dvexp > 0) {
      ps.dvexpByForm ??= {};
      if (ps.dvexp) {
        ps.dvexpByForm[prof.id] = (ps.dvexpByForm[prof.id] ?? 0) + ps.dvexp;
        delete ps.dvexp;
      }
      ps.formLedger ??= [];
      let record = ps.formLedger.find((r) => Number(r.id) === Number(prof.id));
      if (!record) {
        record = { id: prof.id, formLevel: 1, dvexp: ps.dvexpByForm[prof.id] ?? 0,
          techSlots: [0, 0, 0, 0, 0, 0] };
        ps.formLedger.push(record);
      }
      const oldFormLevel = record.formLevel ?? 1;
      const oldSlots = [...(record.techSlots ?? [0, 0, 0, 0, 0, 0])];
      const banked = Number(record.dvexp ?? ps.dvexpByForm[prof.id] ?? 0);
      const formCap = prof.dv_cap ?? 100;
      const participants = Math.max(1, paidParticipants(b).length);
      const gain = dvexpGain(reward.dvexp, ps.level ?? 1, participants,
                             record.formLevel ?? 1, formCap);
      record.dvexp = Math.min(banked + gain, lu?.dvexp_cap ?? 9999999);
      while (record.formLevel < 99 && record.dvexp >= (record.formLevel < formCap
        ? 10 * record.formLevel
        : 10 * (formCap - 1) + 50 * (record.formLevel + 1 - formCap))) {
        record.formLevel++;
        // The disc's learn/load pass, once per form-level step. The signature is
        // ledger slot 5 with its own learn gate (+0x36), never the slot after the
        // last ordinary technique — see web/form-tech-slots.js.
        applyFormTechGates(record, prof, record.formLevel);
      }
      ps.dvexpByForm[prof.id] = record.dvexp;
      if (record.formLevel > oldFormLevel)
        formLevelsGained.push({ name: prof.name, level: record.formLevel });
      for (let i = 0; i < 6; i++) {
        const now = record.techSlots[i] ?? 0;
        const was = oldSlots[i] ?? 0;
        if (!was && now) {
          const name = namedSkill(now);
          if (name) learnedTechs.push(name);
        }
        if (i < 5 && !(was & 0x2000) && (now & 0x2000)) {
          const name = namedSkill(now);
          if (name) loadableTechs.push(name);
        }
      }
    }

    // "Digivolve learned": the disc's unlock routine, once per battle. It takes the
    // member's ROSTER SLOT, picks that line's tree out of the eight pointers at
    // 0x8008903C and grants the FIRST record in table order whose gates pass, then
    // stops — one acquisition a battle, and a form already in the ledger is skipped.
    const acquired = nextUnlockedEvolution(evolutionTrees,
      b.playerRoster[rosterIndex]?.slot ?? 0, ps);
    const acquiredProf = acquired ? profileById(acquired.toId) : null;
    if (acquiredProf) {
      ps.formLedger ??= [];
      if (!ps.formLedger.some((r) => Number(r.id) === Number(acquiredProf.id)))
        ps.formLedger.push({ id: acquiredProf.id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] });
      ps.equippedForms ??= [];
      let slotFull = false;
      if (!ps.equippedForms.includes(acquiredProf.id)) {
        // stfgtrep file 0x3884-0x38C0: the new form goes into the first slot
        // holding a value < 3; a full triple is left alone and the report says so.
        const fitted = autoEquipForm(ps.equippedForms, acquiredProf.id);
        ps.equippedForms = fitted.equipped;
        slotFull = !fitted.equippedNow;
      }
      unlocked.push({ name: acquiredProf.name, slotFull });
    }

    return {
      xp: reward.xp, oldXp, oldLevel, newLevel, levelUp, availableEvos,
      before, formId: prof.id,
      name: b.playerRoster[rosterIndex]?.name ?? prof?.name ?? "",
      learnedTechs, loadableTechs, formLevels: formLevelsGained, unlocked,
    };
  }

  function endBattle(result) {
    const b = battle;
    const state = getState();
    battleOutcomeRelease(b, result);
    syncPlayerRoster(b);
    commandNative.close(); // the command list never outlives the battle
    techNative.close();     // neither does the TECH list
    formNative.close();     // nor the Digivolve form list
    wfightNative.close();  // nor does the boot pipeline

    // Restore the field track the battle music replaced.
    if (bgm && b._fieldTrack !== undefined) bgm.play(b._fieldTrack);

    // Teardown 3D renderer
    if (renderer3d) { renderer3d.setSlowMotion?.(0); renderer3d.destroy(); renderer3d = null; }
    offscreen3d = null;
    exitBattleFullscreen();

    if (result === "win") {
      const activeReward = b._winReward ?? winRewards(b);
      const bits = activeReward.bits ?? 0;

      // The native results screen (stfgtrep) already paid the BIT and the
      // dropped item when the route is on; do not pay them a second time.
      // Gauntlets can bank several drops, so only the one the screen paid is
      // excluded and the rest still land here.
      const itemTable = window.__ITEM_BY_NAME;
      const paidByReport = b._reportNative === true;
      const paidItemId = paidByReport ? (b._reportPaidItemId ?? 0) : 0;
      let drops = b._loot.drops;
      if (paidItemId > 0) {
        const firstIdx = drops.findIndex((name) => name && itemTable?.[name]);
        if (firstIdx >= 0) drops = drops.filter((_, i) => i !== firstIdx);
      }
      let applied = false;
      for (const name of drops) {
        const item = itemTable?.[name];
        if (!item) continue;
        // The store's add arm clamps at 99, as the original's does (F0x800161D8):
        // a loot stack already at the cap takes the drop and stays at 99.
        storeAddItem(state, item.id, 1);
        applied = true;
      }
      if (applied) localStorage.setItem("inventory", JSON.stringify(state.inventory));
      const droppedItem = b._winReward?.droppedItem ?? null;
      // F0x800a69f0 marks the lead at setup and every Digimon that Tags in.
      // stfgtrep pays each marked roster position: 100% solo, 60% each for
      // two participants, or one third each for three. Applied once when the
      // report pages are built so the numbers on screen match the write-back.
      // A position the outcome knocked out is not in that set (paidParticipants:
      // pro/wfightmn.s .L0x00002070 clears its flag before the report counts).
      const progress = b._winApplied
        ? (b._winProgress ?? [])
        : paidParticipants(b).map((index) => ({ index, ...applyParticipantProgress(b, index) }));
      const activeProgress = progress.find((entry) => entry.index === (b.activePlayerIndex ?? 0))
        ?? progress[0] ?? { xp: 0, newLevel: b.player.level, levelUp: false, availableEvos: [] };
      // The money ceiling is 9,999,999 and the original clamps on the way up
      // (SCREEN-OBJECT-NAME-AUDIT-001; docs/generated/bounds.md:69). The shop
      // path already clamped; the battle reward did not.
      if (!paidByReport) state.bits = Math.min((state.bits ?? 0) + bits, MONEY_CAP);
      localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
      localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
      localStorage.setItem("bits", String(state.bits));
      battle = null;
      b.onWin?.({ xp: activeProgress.xp, bits, levelUp: activeProgress.levelUp,
        newLevel: activeProgress.newLevel, droppedItem,
        availableEvos: activeProgress.availableEvos, participantProgress: progress });
    } else if (result === "enemy-fled") {
      localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
      localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
      battle = null;
      b.onWin?.({ xp: 0, bits: 0, levelUp: false, droppedItem: null, availableEvos: [], enemyFled: true });
    } else if (result === "lose") {
      // The loss exit writes nothing. `F0x800a7328` — the call at
      // pro/wfightmn.s .L0x00002174, on every exit arm before the result byte is
      // even read — clears three RAM words and nothing else: the group's reserved
      // form byte at `0x800a4470 + group*0x20` + 0x1A, the halfword at
      // `0x80042b1c + group*0x40` + 0x58, and the halfword at `0x800a3868 + i*0x1C`
      // on each of the two participating Digimon records. No memory-card record, no
      // money, no story flag, and no HP: the fade to black has already covered the
      // screen by the time this runs, and the only thing left is the launch the
      // caller does. (It also means the fainted member's writeBackBattleVitals
      // "1 HP" floor never reaches the card — the walker's stored party is what it
      // was, exactly as on the disc.)
      battle = null;
      b.onLose?.();
    }
  }

  // ── Input ──

  /**
   * The seed the translated TECH screen needs: the acting slot, its MP, and the
   * member's technique words with their decoded prices. party record +0x1A is
   * the Blast-active flag (3d-battle-complete-model §"Blast"), which is what
   * makes the original skip both the grey test and the MP debit.
   */
  function techListSeed(b) {
    const mpCostDown = b.player.mpCostDown ?? 0;
    return {
      activeIndex: b.activePlayerIndex | 0,
      mp: b.player.mp | 0,
      maxMp: b.player.maxMp | 0,
      noCharge: b.blast?.active ? 1 : 0,
      techniques: playerTechs().map((skill) => ({
        word: Number(skill.techWord ?? 0) & 0xffff,
        cost: techniqueMpCost(skill.mp_cost ?? 20, skill.techWord ?? 0, { mpCostDown }),
      })),
    };
  }

  /**
   * The seed the translated ITEM screen needs: the carried items, in the order
   * the original's own id table offers them. The walker's `usableItems()` is the
   * same set the original's inventory filter keeps (the four HP charges and the
   * 25 battle disks), so the rows and the page count are unchanged by the port.
   */
  function itemListSeed(b) {
    void b;
    return { items: usableItems().map((item) => ({
      id: Number(item.id) | 0,
      qty: Number(item.qty ?? 0) & 0xff,
      // The item RECORD's own byte +9, the icon class the resident F0x80013584
      // indexes the exe's cel table (0x80042BA8) with — read from the SAME module the
      // field ITEM menu and the shop resolve their row icons through (web/itemicons.js),
      // so all three lists share one resolution. This seed used to pass a literal 0, so
      // every battle row resolved through family 0 -> cel 74 and drew a weapon icon for
      // whatever was held (Power Charge's capsule showed as a sword).
      family: Number(itemFamily(item.id) ?? 0) & 0xff,
    })) };
  }

  /** The item id the screen answered with, resolved through the same list. */
  function confirmItem(b, id) {
    const item = usableItems().find((entry) => entry.id === id);
    if (!item) { b.state = ST.PLAYER_MENU; return; }
    b.itemSel = Math.max(0, usableItems().indexOf(item));
    b.pendingAction = { type: "item", item };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    // The item action's own first page is the announcement the disc shows (kind 14,
    // `FIGHTSTG_F0x8008dac0` outer step 0, `fightstg.s:11161`): the Digimon's name and
    // the item's own name out of bank 0x6a. The old sentence stays only as what
    // `?legacyBattleMsg=1` and `peek()` read.
    sayOriginal(b, itemAnnouncementSpec(b, item), `Used ${item.name}!`);
  }

  /**
   * The seed the translated Digivolve form list needs (web/battleform-translated.js,
   * engine FightFormSession).
   *
   * Rows: the acting Digimon's current form, then the three equipped forms with a
   * value of 3 or more (F0x80094478 state 0, fightstg.s:18056-1804c). Names and the
   * grey current-form row need nothing else.
   *
   * Page zero's block is the acting Digimon's own battle record: F0x80017174 copies
   * 0x2C bytes from DIGIMON_CUR_STATS+0x1C, whose 19 halfwords are level, tp,
   * cur/max HP, cur/max MP, the six core stats and the seven elemental values
   * (digimon-cur-stats-helpers.md; rust Unknown4Stats). The panel then ADDS the
   * cursor row's own base profile stats (species record +0x02.. six halfwords and
   * +0x0E.. seven) into the six core and seven elemental slots, and prints those
   * thirteen numbers.
   */
  function formListSeed(b) {
    const index = b.activePlayerIndex | 0;
    const rec = b.playerRecords?.[index] ?? b.player;
    const panel = formPanelMemberSeed(b, index, rec);
    return {
      activeIndex: index,
      // The screen's self+0x54 is the acting member's ROSTER SLOT, not the party
      // position and not a row of its live form: every table the screen reaches
      // is keyed by it — the profile record at 0x8003EF5C + 0x58*slot (F0x80094504
      // reads its first halfword as the list's first row), the roster record at
      // 0x80049494 + slot*0x3DC that F0x80017174 reads, the equipped triple
      // F0x800176AC resolves and the technique ledger F0x80017A1C searches — and
      // [0x8004B44C] (F0x80016D94) is what answers it for a party position, in
      // the delay slot of the allocator call (fightstg.s:22950-22954). So the
      // list leads with the STARTER species however far the Digimon has
      // digivolved, and the live form only greys its own row.
      slotIndex: partyRosterSlot(b, index),
      currentSpecies: liveFormId(b, index),
      liveSpecies: liveFormId(b, index),
      reservedForm: 0,
      rosterSlots: [0, 1, 2].map((slot) => partyRosterSlot(b, slot)),
      options: panel.options,
      equipped: panel.equipped,
      panelBlock: panel.panelBlock,
      preselected: panel.preselected,
    };
  }

  /**
   * THE shared helper both partner screens ask for a party position: the roster
   * slot that position holds, `F0x80016D94` on the walker side
   * (`partyPositionRosterSlot`, engine/dw3/roster.ts). The DNA pane stores it at
   * +0x60 and the Digivolve list at +0x54; the profile rows 0..7 of
   * `0x8003EF5C` are the eight starters, so both screens list the member's own
   * starter species first and its equipped forms after it.
   */
  function partyRosterSlot(b, position) {
    return partyPositionRosterSlot(b?.playerRoster ?? [], position | 0);
  }

  /**
   * One member's carry-over panel data, shared by the Digivolve form list and the
   * DNA pane: the forms it can be asked about, its three equipped ids and its own
   * 22 stat halfwords. F0x800953E4 opens the SAME panel in both screens, so the
   * data is built once here rather than per screen.
   */
  function formPanelMemberSeed(b, index, rec) {
    const forms = formOptionsFor(index);
    const elems = FORM_ELEMENTS;
    // The panel's own seven numbers are the F0x80017174 scratch's +0x18..+0x24:
    // the roster row's base plus every trained point plus the worn gear's
    // resist. `rec.elemBonuses` already holds the last two (buildPlayerRecord
    // folds the equipment's elemResists in), so the shared helper reads it as
    // the original does.
    const elemValue = (profile, points, key) => elementValue(profile, points, key);
    // F0x80017A1C copies the roster's own 0x14-byte technique block for a form:
    // its level byte at +0x02 and its six entry words at +0x08. The walker's form
    // ledger holds the same six words, and battleFormLevel the same level, so the
    // panel's pages one and two list the Digimon's real techniques.
    const ledger = rec?.statsRecord?.formLedger ?? [];
    const techsFor = (formId) => {
      const entry = ledger.find((row) => Number(row?.id) === Number(formId));
      return Array.from({ length: 6 }, (_, i) => (Number(entry?.techSlots?.[i] ?? 0) & 0xffff));
    };
    return {
      options: forms.map((form) => ({
        species: form.id & 0xffff,
        left: [form.str, form.def, form.spt, form.wis, form.spd, form.chr],
        right: elems.map((k) => form.resistances?.[k] ?? 0),
        techs: techsFor(form.id),
        level: battleFormLevel(index, form.id),
        dvexp: Number(ledger.find((row) => Number(row?.id) === Number(form.id))?.dvexp ?? 0) >>> 0,
      })),
      equipped: (rec?.statsRecord?.equippedForms ?? []).slice(0, 3).map((id) => Number(id)),
      panelBlock: [
        rec?.level | 0, 0, rec?.hp | 0, rec?.maxHp | 0, rec?.mp | 0, rec?.maxMp | 0,
        rec?.str | 0, rec?.def | 0, rec?.spt | 0, rec?.wis | 0, rec?.spd | 0, rec?.chr | 0,
        ...elems.map((k) => elemValue(rec?.profile, rec?.elemBonuses, k)),
        0, 0, 0,
      ],
      preselected: (rec?.profile?.tech_signature ?? 0) & 0xffff,
    };
  }

  /**
   * The Digivolve form the screen answered with, committed through the walker's own
   * DV path (web/battle.js applyDvAction): one turn, the form written, the
   * Digivolved scene. The screen itself only reports the choice.
   */
  function confirmDvForm(b, speciesId) {
    const forms = formOptionsFor(b.activePlayerIndex);
    const row = forms.findIndex((form) => (form.id & 0xffff) === (speciesId & 0xffff));
    if (row < 0) { b.state = ST.PLAYER_MENU; return; }
    b.formSel = row;
    b.pendingAction = { type: "dv", formId: forms[row].id };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    b.message = "";
  }

  /** The technique id the screen answered with, resolved through the same list. */
  function confirmTech(b, id) {
    const skill = playerTechs().find((entry) => (Number(entry.techWord ?? 0) & 0x1fff) === id);
    if (!skill) { b.state = ST.PLAYER_MENU; return; }
    b.techSel = Math.max(0, playerTechs().indexOf(skill));
    b.pendingAction = { type: "tech", skill };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    sayOriginal(b, techniqueSpec(b, skill), `${b.player.profile.name} uses ${skill.name}!`);
  }

  /**
   * The species a party member's LIVE combat record is in, in the walker's own
   * ids. Every translated battle screen is handed this, never the character's
   * `rookieId`: the original's party record at 0x800A4470 + 0x20*slot carries the
   * form the member is in RIGHT NOW (buildPlayerRecord writes record+0x00 from it,
   * and a DV or a Tag replaces only that halfword), and the screens read that
   * record's species — the TAG plate's name, the DNA pane's pairing test and the
   * Digivolve list's greyed "you are already this" row. `rookieId` is the base
   * form, which is the same number for most of a battle and wrong after either of
   * those two.
   */
  function liveFormId(b, slot) {
    const record = b.playerRecords?.[slot];
    const member = b.playerRoster?.[slot];
    const id = Number(record?.profile?.id ?? member?.id ?? member?.rookieId ?? record?.rookieId ?? 0);
    return Number.isFinite(id) ? id | 0 : 0;
  }

  /**
   * The seed the translated TAG screen needs: the acting slot, whether the battle
   * may cancel the list (self+0x58, 0 for the forced TAG after a knockout) and
   * the three party records it scans. A member with no Digimon has species 0 and
   * is skipped by the original's scan; a knocked-out member keeps its row with a
   * grey plate, so its HP is passed through unchanged.
   *
   * The row it opens on is the list's own row word, handed over as the original
   * hands it over: fightstg.s:21258-21260 seeds the shared model's cursor from
   * the cell behind self+0x54 without a clamp, and fightstg.s:21312 writes the
   * confirmed row back into that cell.
   */
  function tagListSeed(b) {
    const members = [0, 1, 2].map((slot) => {
      const member = b.playerRoster?.[slot];
      const record = b.playerRecords?.[slot];
      const stats = member?.stats ?? record?.statsRecord ?? {};
      const formId = liveFormId(b, slot);
      return {
        digimonId: formId,
        hp: Number(record?.hp ?? 0) & 0xffff,
        maxHp: Number(record?.maxHp ?? stats.maxHp ?? 0) & 0xffff,
        mp: Number(record?.mp ?? 0) & 0xffff,
        maxMp: Number(record?.maxMp ?? stats.maxMp ?? 0) & 0xffff,
        name: String(member?.name ?? record?.profile?.name ?? ""),
        blast: slot === b.activePlayerIndex && !!b.blast?.active,
        forms: { digimonId: formId, equippedForms: stats.equippedForms ?? [], formLedger: stats.formLedger ?? [] },
      };
    });
    return {
      activeIndex: b.activePlayerIndex | 0,
      interactive: b._forcedTag ? 0 : 1,
      cursorRow: b.tagRow | 0,
      members,
    };
  }

  /**
   * The seed the translated DNA pane needs: the acting party slot, the partner
   * the DNA command was raised for, and the three party records the pane's tests
   * read. The result species in the pane's column are NOT the walker's own DNA
   * evolution table: the original's [0x8004B46C] service (F0x800176AC) answers
   * them from the partner's roster record — its three equipped form ids that its
   * own acquired-form ledger holds — and engine/dw3/ui/fight-dna-session.ts runs
   * that port (form-tech-blocks.ts readEquippedForms) over the same records the
   * carry-over preview reads.
   *
   * The ids handed over here are the WALKER's own (digimon.json, 1..55) and the
   * pane reads the GAME's 55-row profile table (species getter [0x8005CCA0], the
   * strip's own species at 0x8003EF5C + 0x58*(self+0x60) and the pairing rule's
   * +0x3D/+0x55). The turn between the two is not made here: FightDnaPane's
   * constructor puts every id it is given through one mapping
   * (`gameFormId`, native/pause-status.ts — the `value0` halfword of the row the
   * walker's id numbers), so a caller cannot hand this pane an id in the wrong
   * space. Real play is checked by tools/verify_dna_realplay.mjs.
   */
  function dnaPaneSeed(b) {
    const choice = b._dnaChoice;
    const active = b.activePlayerIndex | 0;
    const partner = Number(choice?.rosterIndex ?? 0) | 0;
    const members = [0, 1, 2].map((slot) => {
      const member = b.playerRoster?.[slot];
      const record = b.playerRecords?.[slot];
      const stats = member?.stats ?? record?.statsRecord ?? {};
      // The stat carry-over preview F0x800953E4 opens is the same panel the
      // Digivolve form list shows, and it describes the member the player picked,
      // so every member carries its own panel data here.
      const panel = formPanelMemberSeed(b, slot, record);
      return {
        digimonId: liveFormId(b, slot),
        // F0x80016D94: the roster slot this party position holds, which the pane
        // stores at +0x60. The strip it builds starts on that row's own first
        // halfword — the STARTER species, rows 0..7 being the eight starters — so
        // a partner that has already digivolved still leads with its own line.
        rosterSlot: partyRosterSlot(b, slot),
        hp: Number(record?.hp ?? 0) & 0xffff,
        maxHp: Number(record?.maxHp ?? stats.maxHp ?? 0) & 0xffff,
        mp: Number(record?.mp ?? 0) & 0xffff,
        maxMp: Number(record?.maxMp ?? stats.maxMp ?? 0) & 0xffff,
        status: Number(record?.statusBits ?? battleAilmentByte(record)) & 0xff,
        blast: slot === active && !!b.blast?.active,
        panel: {
          slotIndex: partyRosterSlot(b, slot),
          options: panel.options,
          equipped: panel.equipped,
          panelBlock: panel.panelBlock,
        },
        forms: panel.options,
        preselected: panel.preselected,
      };
    });
    return {
      step: "pane",
      activeIndex: active,
      partnerIndex: partner,
      members,
    };
  }

  /** Both Tag routes consume the pane's return through the phase's shared decode.
   * fightstg.s:16314-16316 loads -2 in the branch delay slot, before the poll.
   * Cancel restarts the partner picker, without spending a turn or MP.
   */
  function applyDnaAnswer(b, answer, kind = "command") {
    const action = dnaAnswerAction(kind, answer);
    if (action === "wait") return false;
    if (action === "restart") {
      b._dnaChoice = null;
      b.state = ST.PLAYER_TAG;
      return true;
    }
    // The forced phase has no DNA commit arm (0x80092d08). Preserve its wait;
    // do not substitute a Switch or start another pane after its answer.
    if (action === "nothing") {
      b._dnaBranchBlocked = true;
      return true;
    }
    const choice = b._dnaChoice;
    if (!choice) return false;
    const profiles = dnaNative.tables()?.profiles;
    const formId = profiles ? dnaAnswerForm(dnaTableReader(profiles), answer) : choice.formId;
    b._dnaChoice = null;
    b.pendingAction = { type: action === "dna" ? "dna" : "tag",
      rosterIndex: choice.rosterIndex, formId };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    b.message = action === "dna" ? "DNA DV!" : "Switch!";
    return true;
  }

  /**
   * The party position the TAG partner list answered with.
   *
   * The disc has NO separate form screen here. Confirming a row answers the
   * chosen party POSITION, and the coordinator then spawns ONE follow-up object
   * -- `fightstg.s:16343` `F0x800988fc` delegates to `F0x80098884`, whose tick
   * `F0x800980E4` is allocated at `:22481` -- the DNA pane. The pane runs its
   * own two sub-states, the species strip (the header names the species under
   * the cursor, L1/R1 move the candidate row, and the shared stat panel is
   * shown) and then the "Switch" / "DNA DV" row list.
   *
   * The walker used to open a hand-drawn form screen (ST.PLAYER_TAG_FORM) between
   * the list and the pane. That screen duplicated the pane's own species
   * sub-state, which is why a screen labelled with one form name appeared before
   * the real pane (playtest bug 12b). It is gone: a confirmed position seats the
   * pane the translated path already draws (ST.PLAYER_DNA_CHOICE) and lets the
   * pane run its own sub-state progression. The seed carries the position;
   * `dnaPaneSeed` resolves the member's roster slot, so the species strip leads
   * with the member's STARTER species (rows 0..7) and lists its equipped forms
   * after it -- the form the player wants is chosen on that strip, not here.
   */
  function confirmTag(b, slot) {
    const position = Number(slot) | 0;
    const member = b.playerRoster?.[position];
    if (!member) { b.state = ST.PLAYER_MENU; return; }
    b.tagTargetIndex = position;
    b.formSel = 0;
    const form = formOptionsFor(position)[0] ?? null;
    // The forced KO replacement on the walker's LEGACY chain (?legacyTagSwap=1)
    // is not a voluntary command or turn: the old state-12 arm committed the Tag
    // presentation at once, and the pane is not driven on that chain, so keep
    // that commit here rather than collecting a phantom press on the pane.
    if (form && b._forcedTag && !USE_ORIGINAL_TAG_SWAP) {
      if (applyTagAction({ type: "tag", rosterIndex: position, formId: form.id })) {
        b._forcedTag = false;
        b.pendingAction = null;
        b.state = ST.TAG_PRESENT;
        b.timer = 0;
      }
      return;
    }
    // Seat the pane. Its species strip is what lets the player move to another
    // form, so this only needs the partner's live form as the fallback the
    // legacy row list and the non-loaded-pane case read.
    const choice = form ? dnaChoiceFor(position, form) : null;
    b._dnaChoice = form
      ? (choice
        ? { ...choice, rosterIndex: position, formId: form.id }
        : { rosterIndex: position, formId: form.id, cost: null, switchOnly: true })
      : null;
    b.dnaSel = 0;
    b.state = ST.PLAYER_DNA_CHOICE;
  }

  /**
   * Commit the joke the player picked on the confused list (STATUS-C004).
   *
   * The original's owner rolls F0x800A1910 on the Circle press and then writes the
   * result the sequencer maps: 0 is the ordinary Attack, anything else is the gag
   * and the turn is forfeited (fightstg.s:24680-24695, :24718-24773; the sequencer
   * at :16392-16410). The picked row only chooses which of that joke's two lines is
   * printed (:24738-24754). Shared by the ported list and the hand-drawn fallback.
   */
  function confirmJokePick(b, row) {
    const joke = b.confusedMenu?.[row] ?? b.confusedMenu?.[0];
    const magnitude = b.player.ailments.confuse?.power ?? 0;
    // The gag's wind term is the defender's own element value: the F0x80017174
    // scratch halfword, read through the one shared helper.
    const effectiveWind = elementValue(b.player.profile, b.player.elemBonuses, "wind");
    const equippedResistance = b.player.statusResists?.confuse;
    const confuseResistance = equippedResistance
      ?? b.player.profile?.status_resist?.confuse
      ?? 0;
    const gag = confusionGagRoll(
      magnitude, effectiveWind, confuseResistance, RAND_U16,
    );
    // F0x8009a734 picks one of the joke's two lines with a single fresh random bit
    // (fightstg.s:24738-24754), and that same bit chooses which esmfight index the
    // message box's second line is given.
    const pick = jokeFlavorPick(joke?.jokeIndex ?? 0, RAND_U16);
    b.confusedMenu = null;
    b.pendingAction = gag
      ? {
        type: "confused", jokeIndex: joke?.jokeIndex ?? 0,
        flavorBit: pick.bit, flavor: pick.text,
      }
      : { type: "fight" };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    if (!gag) sayOriginal(b, attackSpec(b), `${b.player.profile.name} attacks!`);
  }

  /**
   * Run the command the selection points at. This is the body of the Circle
   * press on the command list, shared by the legacy key path and the shipped
   * pro/fightstg menu (which hands back its chosen row): the native route must
   * not be able to drift from the walker's own confirm.
   */
  function confirmCommand(b) {
    const items = currentMenuItems(b);
    const sel = (items[b.menuSel] ?? "").toLowerCase();
    if (sel === "fight") {
      b.pendingAction = { type: "fight" };
      b.playerFirst = true;
      b.state = ST.PLAYER_ACT;
      b.timer = 0;
      sayOriginal(b, attackSpec(b), `${b.player.profile.name} attacks!`);
    } else if (sel === "tech") {
      // The TECH row is ALWAYS enterable, exactly as on the disc. The command-flow
      // phase routes row 1 to branch 3 (`0x800830F4[3] = 0x80092A28`,
      // `pro/fightstg.s:266` and `:16282`) whose first act is
      // `FIGHTSTG_F0x80096e88` (`:20777`): it allocates the 0xD8 TECH screen and
      // returns, with no test of the technique list. The screen's own build
      // `FIGHTSTG_F0x800967A0` (`:20332`) reads the acting form's technique words and,
      // when the count is ZERO, still builds the list widget at `:20577`-`:20591`
      // (config `0x800A3554` row count 1) and arms it — so the player enters, sees an
      // empty list, and cancels. The walker used to refuse here with its own "No
      // techs!" notice, which made the row read as unselectable whenever the acting
      // Digimon's current form carried no learned technique halfwords; a mid-battle
      // Tag or a knocked-out lead is exactly when the acting record becomes such a
      // Digimon (a freshly acquired digivolution has an empty list until its Skill-LV
      // learn gates are met), which is why it showed up after a swap or a death.
      b.state = ST.PLAYER_TECH;
      b.techSel = 0;
    } else if (sel === "dv") {
      const forms = formOptionsFor(b.activePlayerIndex);
      if (forms.length < 2) { b.menuNotice = "Cannot digivolve."; return; }
      b.state = ST.PLAYER_DV;
      b.formSel = Math.max(0, forms.findIndex((form) => form.id !== b.player.profile.id));
    } else if (sel === "tag") {
      // The original's list owns the empty case. F0x80097498 walks the three
      // party records at 0x800A4460 + 0x20*i (fightstg.s:21202-:21245) and keeps
      // one whose live form halfword at +0x00 is non-zero (:21211-:21213) and
      // which is not the acting member (:21215-:21217) -- current HP is NOT
      // tested, so a knocked-out partner is still a row -- and at zero candidates
      // (self+0x64, :21246-:21248) it builds one text element (kind 0x1005,
      // :21269-:21275) and later sets it to word 0x14 of bank 0x7F (:21477-:21486), goes to state 2 (:21280-:21284) and draws
      // the message pane cel 0x31 at (11,188) with the text at (20,194) and a
      // blinking hand at (291,208) (:21455-21485). Only Circle is read there and
      // it answers -2, so the walker's hp>0 list must not pre-empt the pane: two
      // dead partners must still show grey rows, and only a one-Digimon party
      // must reach the pane.
      if (!USE_ORIGINAL_TAG_SWAP || !(USE_TRANSLATED_TAG && !tagNative.failed())) {
        if (!tagMembers().length) { b.menuNotice = "No partner to tag."; return; }
      }
      b.state = ST.PLAYER_TAG;
      b.tagSel = 0;
    } else if (sel === "item") {
      const items2 = usableItems();
      if (!items2.length) { b.message = "No items!"; return; }
      b.state = ST.PLAYER_ITEM;
      b.itemSel = 0;
    } else if (sel === "run") {
      // The player's Run is F0x800a1608 side 0 (fightstg): a 0..127 roll under
      //   (base+1)*8 + level advantage + speed advantage (only when faster)
      //   + the Runner Sandal/Shoes bonus, from the fighters' real level and SPD.
      // The Runner item folds into that sum (`+0x3c`); Sleep/tech-abort refuse it
      // and Frozen halves the base. Capture Beam (211) stages status event 0x10 on
      // the player's active fighter, the game's own "can't run away" lock; that lock
      // LIVES in the status-event pool, so this gate asks the queue whether its entry
      // is still queued -- the original's own `find` (`pro/wfightmn.s:27062`).
      if (!statusEventLockHeld(b.statusEvents, 0, 0, activeSlotOf(b, 0)) &&
          fleeChance({ selfLevel: b.player.level | 0, otherLevel: b.enemy.level | 0,
            selfSpd: b.player.spd | 0, otherSpd: b.enemy.spd | 0,
            escapeBonus: b.player.escapeBonus | 0, selfAilment: battleAilmentByte(b.player) }, RAND_U16)) {
        b.state = ST.RESULT_MSG;
        b._nextState = ST.NONE;
        b.message = "Got away safely!";
        b.timer = 0;
        // End battle after message (flee bypasses endBattle -- restore music here)
        const cb = b.onFlee;
        setTimeout(() => {
          if (battle === b) {
            persistPlayerGauge(b);
            if (bgm && b._fieldTrack !== undefined) bgm.play(b._fieldTrack);
            battle = null; cb?.();
          }
        }, 1400);
      } else {
        b.message = "Can't escape!";
        queueAfterAction(b, "player");
        b.state = ST.FLEE_FAIL;
        b.timer = 0;
      }
    }
  }

  function handleKey(rawKey) {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const k = asButton(rawKey);
    if (!battle) return false;
    const b = battle;
    // The pad word FIGHTSTG_F0x80098a84 reads through [0x8004bbc4](0). Its only
    // meaning for the message line is bit 0x2000 (Circle,
    // docs/research/ui/exclamation-indicator-decoded-2026-07-02.md:131): the line
    // waits for the press and has no timeout. Latch it here, before any state branch
    // returns, so every Circle press reaches the line.
    if (k === "circle" && msgSession) msgPadWords |= BATTLE_MESSAGE_CLOSE_BIT;

    if (b.state === ST.RESULT_MSG && b._resultPages?.length) {
      if (!b._resultReady) return true;
      if (k === "circle") {
        sfx?.play("system07");
        const next = (b._resultPageIndex ?? 0) + 1;
        if (next < b._resultPages.length) {
          b._resultPageIndex = next;
          const pageSpec = (b._resultPageSpecs ?? [])[next] ?? null;
          // Each page carries its own `+0xac` arm, so a later page can be the original's
          // own two lines even when the first was the walker's own sentence.
          if (pageSpec) sayOriginal(b, pageSpec, b._resultPages[next]);
          else sayWalker(b, b._resultPages[next]);
        } else {
          b._resultPages = null;
          b._resultPageSpecs = null;
          b._resultPageIndex = 0;
          b._resultReady = false;
          advanceAfterResult(b);
        }
      }
      return true;
    }

    if (b.state === ST.WIN) {
      if (b._victoryPhase === "pose") {
        // Native flow is automatic here: the one confirm closed the preceding
        // "Defeated!" page, then the victory pose/message runs into STFGTREP.
        return true;
      }
      if (b._victoryPhase === "ending") {
        // The finale's ending chain owns the pad while it plays: the movie
        // object reads the raw pad's START itself (the host's movie adapter —
        // dispatchInput routes to the open movie before any battle key), and
        // the battle swallows anything else.
        return true;
      }
      if (b._victoryPhase !== "report") return true;
      // The native results screen owns the pad while it is up; it reads the
      // held-button word each frame, so key events must not advance pages here.
      if (b._reportNative) return true;
      if (k === "circle") {
        if (b.timer < 1.35) return true; // black cut + bottom-message type-in
        sfx?.play("system07");
        const lastPage = Math.max(0, (b._winPages?.length ?? 1) - 1);
        if ((b._winPageIndex ?? 0) < lastPage) {
          b._winPageIndex = (b._winPageIndex ?? 0) + 1;
          b.timer = 0;
        } else {
          // TELEPORT: confirmed final report page -> warp-out/return-to-field effect.
          sfx?.play("system10");
          endBattle("win");
        }
      }
      return true;
    }

    if (b.state === ST.TAG_PRESENT) {
      const tag = b._tagPresentation;
      if (tag?.phase === "prompt" && (k === "circle")) {
        sfx?.play("system07");
        tag.phase = "loading";
        b.message = "";
        Promise.resolve(swapPlayerModel(tag.profile.name)).catch(() => false).then(() => {
          if (battle !== b || b._tagPresentation !== tag) return;
          renderer3d?.setPlayerVisible(true);
          renderer3d?.setPlayerAnim(TAG_PRESENTATION.arrivalClip);
          tag.phase = "arrival";
          b.timer = 0;
        });
        return true;
      }
      return true;
    }

    if (b.state === ST.PLAYER_MENU) {
      // The command phase does not read the pad while a message line is up and unread:
      // the original's controller instruction returns before it arms anything while the
      // line's own slot is occupied, so there is no menu to press and the press belongs to
      // the line alone (commandPhaseWaitsForLine, `wfightmn.s:1494-1496`). This covers the
      // translated list and the walker's own (`?legacyBattleCmd=1`) equally.
      if (commandPhaseWaitsForLine(msgSession, b.state)) return true;
      // The Frozen gate owns the turn before the list exists, so a press on this frame
      // reaches nothing at all (F0x800a7418 step 1, `wfightmn.s:1503-1512`). The roll
      // is the same one update() takes and the latch keeps it to one per turn.
      if (frozenGateLosesTurn(b)) return true;
      // The shipped pro/fightstg list owns the selection and the confirm for the
      // whole command phase, even on the frame before the adapter has opened:
      // the key event is swallowed here and forwarded as a pad pulse (state.keys
      // also carries held directions), so the walker's own 2-column selection
      // never moves underneath it. update() turns the overlay's chosen row into
      // the same confirmCommand() call the Circle press below makes. If the
      // overlay never loads (10s), the walker's list takes over again.
      if (USE_NATIVE_COMMAND && !commandNative.failed() && !useLegacyJokeList(b)) {
        commandNative.press(k);
        return true;
      }
      // battle-menu blips per sfx-triggers.json fightstg cross-check:
      // system07 cursor, system08 confirm, system02 cancel
      if (k === "left" || k === "right") return true;
      const items = currentMenuItems(b);
      if (k === "up")    { sfx?.play("system06"); b.menuNotice = null; b.menuSel = (b.menuSel - COLS + items.length) % items.length; return true; }
      if (k === "down")  { sfx?.play("system06"); b.menuNotice = null; b.menuSel = (b.menuSel + COLS) % items.length; return true; }
      if (k === "circle") {
        sfx?.play("system07");
        b.menuNotice = null;
        // Confused player: F0x800a1910 rolls before reading the selected joke.
        // Failure maps to command 0 (normal Attack); success maps to command -1
        // and only then uses the joke index for flavor presentation.
        if (jokeMenuRows(b)) { confirmJokePick(b, b.menuSel); return true; }
        confirmCommand(b);
        return true;
      }
      if (k === "cross") return true;
    }
    if (b.state === ST.PLAYER_TECH) {
      const techs = playerTechs();
      // The translated list reads the pad itself (the same single-press edge
      // the command list uses), so the walker's own cursor never moves under it.
      if (USE_TRANSLATED_TECH && !techNative.failed()) { techNative.press(k); return true; }
      // An empty list (a form with no learned technique halfwords) is a real state the
      // disc opens and leaves the player to cancel: `FIGHTSTG_F0x800967A0` builds the
      // widget at `:20577`-`:20591` and arms it with nothing to pick, and only Cross
      // leaves. Guard the walker's own cursor so a modulo-by-zero or an undefined
      // technique cannot fire here.
      if (!techs.length) {
        if (k === "cross") { sfx?.play("system01"); b.state = ST.PLAYER_MENU; }
        return true;
      }
      if (k === "up")   { sfx?.play("system06"); b.techSel = (b.techSel - 1 + techs.length) % techs.length; return true; }
      if (k === "down") { sfx?.play("system06"); b.techSel = (b.techSel + 1) % techs.length; return true; }
      if (k === "circle") {
        const skill = techs[b.techSel];
        b.pendingAction = { type: "tech", skill };
        b.playerFirst = true;
        b.state = ST.PLAYER_ACT;
        b.timer = 0;
        // The original's own words for a technique: the name on line one and the
        // technique alone on line two, out of the technique-name bank (kind 3,
        // `li $a2, 0x9` = esmfight 0x09 "{1}!" with the name in slot 1).
        sayOriginal(b, techniqueSpec(b, skill), `${b.player.profile.name} uses ${skill.name}!`);
        return true;
      }
      if (k === "cross") { sfx?.play("system01"); b.state = ST.PLAYER_MENU; return true; }
    }

    if (b.state === ST.PLAYER_ITEM) {
      const items = usableItems();
      // The translated list reads the pad itself (the same single-press edge
      // the command and TECH lists use), so the walker's own cursor never moves
      // under it.
      if (USE_TRANSLATED_ITEM && !itemNative.failed()) { itemNative.press(k); return true; }
      if (k === "up")   { sfx?.play("system06"); b.itemSel = (b.itemSel - 1 + items.length) % items.length; return true; }
      if (k === "down") { sfx?.play("system06"); b.itemSel = (b.itemSel + 1) % items.length; return true; }
      if (k === "circle") {
        const item = items[b.itemSel];
        b.pendingAction = { type: "item", item };
        b.playerFirst = true;  // items always resolve before enemy (player choosing to heal)
        b.state = ST.PLAYER_ACT;
        b.timer = 0;
        // The item action's own first page is the announcement the disc shows (kind 14,
        // `FIGHTSTG_F0x8008dac0` outer step 0, `fightstg.s:11161`): the acting Digimon's
        // name on line one and the item's own name out of bank 0x6a on line two, so the
        // player presses Circle before the effect runs. The old typed sentence stays
        // only as what `?legacyBattleMsg=1` and `peek()` read.
        sayOriginal(b, itemAnnouncementSpec(b, item), `Used ${item.name}!`);
        return true;
      }
      if (k === "cross") { b.state = ST.PLAYER_MENU; return true; }
    }

    if (b.state === ST.PLAYER_TAG) {
      // The shipped pro/fightstg list owns the whole TAG phase, exactly as it
      // does the command phase: the key is swallowed here and forwarded as a pad
      // pulse, so the walker's own wrapping cursor never moves underneath it.
      if (USE_TRANSLATED_TAG && !tagNative.failed()) {
        tagNative.press(k);
        return true;
      }
      const members = tagMembers();
      if (k === "up")   { sfx?.play("system06"); b.tagSel = (b.tagSel - 1 + members.length) % members.length; return true; }
      if (k === "down") { sfx?.play("system06"); b.tagSel = (b.tagSel + 1) % members.length; return true; }
      if (k === "circle") {
        sfx?.play("system07");
        const member = members[b.tagSel];
        if (!member) return true;
        // Same route as the translated list: a confirmed position seats the
        // follow-up pane directly, with no hand-drawn form screen between them.
        confirmTag(b, member.rosterIndex);
        return true;
      }
      if (k === "cross") {
        if (b._forcedTag) return true;
        sfx?.play("system01"); b.state = ST.PLAYER_MENU; return true;
      }
    }

    // The Digivolve list reads the pad itself (the same single-press edge the TECH
    // list uses), so the walker's own cursor never moves under it. The post-Tag
    // form list is a different original screen and keeps the walker's drawing.
    if (b.state === ST.PLAYER_DV && USE_TRANSLATED_FORM && !formNative.failed()) {
      formNative.press(k);
      return true;
    }

    if (b.state === ST.PLAYER_DV) {
      const rosterIndex = b.activePlayerIndex;
      const forms = formOptionsFor(rosterIndex);
      if (k === "up")   { sfx?.play("system06"); b.formSel = (b.formSel - 1 + forms.length) % forms.length; return true; }
      if (k === "down") { sfx?.play("system06"); b.formSel = (b.formSel + 1) % forms.length; return true; }
      if (k === "circle") {
        const form = forms[b.formSel];
        if (!form) return true;
        if (form.id === b.player.profile.id) {
          b.menuNotice = "Already in that form.";
          b.state = ST.PLAYER_MENU;
          return true;
        }
        sfx?.play("system07");
        b.pendingAction = { type: "dv", formId: form.id };
        b.playerFirst = true;
        b.state = ST.PLAYER_ACT;
        b.timer = 0;
        b.message = "";
        return true;
      }
      if (k === "cross") {
        // The original's cancel on the Digivolve form list closes it and the
        // command list comes back.
        sfx?.play("system01");
        b.state = ST.PLAYER_MENU;
        return true;
      }
    }

    if (b.state === ST.PLAYER_DNA_CHOICE && USE_TRANSLATED_DNA && !dnaNative.failed()) {
      // The translated pane reads the pad itself (the same single-press edge the
      // command, TECH, ITEM and TAG lists use), so the walker's own row toggle
      // never moves under it.
      dnaNative.press(k);
      return true;
    }

    if (b.state === ST.PLAYER_DNA_CHOICE) {
      const choice = b._dnaChoice;
      // No choice seated means no pane can run (the partner had no form record).
      // The walker's hand-drawn form screen is gone, so the closest thing to the
      // disc's restart is the partner picker that opened the pane; from there
      // Cross returns to the command list.
      if (!choice) { b.state = ST.PLAYER_TAG; return true; }
      if (k === "up" || k === "down") {
        // One row when there is no DNA pairing: the original's row count is 1
        // (fightstg.s:22168), so there is nothing to move to.
        if (choice.switchOnly) { sfx?.play("system06"); return true; }
        sfx?.play("system06"); b.dnaSel = b.dnaSel ? 0 : 1; return true;
      }
      if (k === "circle") {
        // The native plays the confirm feedback BEFORE running any eligibility
        // test (0x80098530, ahead of the first branch at 0x800985e0), then every
        // failing test converges on 0x80098790, which only redraws the pane.
        // So an ineligible DNA DV confirm beeps normally and then does nothing:
        // no error line, no second sound, cursor left on DNA DV [DNA-C005/C006].
        sfx?.play("system07");
        if (b.dnaSel === 1 && dnaRejection(dnaParticipantsFor(b, choice.rosterIndex), choice.cost)) {
          return true;
        }
        b.pendingAction = b.dnaSel === 0
          ? { type: "tag", rosterIndex: choice.rosterIndex, formId: choice.formId }
          : { type: "dna", rosterIndex: choice.rosterIndex, formId: choice.formId };
        b._dnaChoice = null;
        b.playerFirst = true;
        b.state = ST.PLAYER_ACT;
        b.timer = 0;
        b.message = b.pendingAction.type === "dna" ? "DNA DV!" : "Switch!";
        return true;
      }
      if (k === "cross") {
        sfx?.play("system01");
        return applyDnaAnswer(b, -2, dnaTagBranchKind(!!b._forcedTag));
      }
    }

    return false;
  }

  // ── Draw ──

  function nativeText(text, x, y, opts = {}) {
    if (uiFontReady()) return uiDrawText(ctx, String(text), x, y, opts);
    ctx.fillStyle = opts.color ?? "#f2f2f2";
    ctx.font = `${opts.kind === 3 ? 8 : 10}px monospace`;
    ctx.textAlign = opts.alignRight ? "right" : "left";
    ctx.textBaseline = "top";
    ctx.fillText(String(text), x, y);
  }

  function nativePanelPath(x, y, w, h, notch = 5) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - notch, y);
    ctx.lineTo(x + w, y + notch);
    ctx.lineTo(x + w, y + h - notch);
    ctx.lineTo(x + w - notch, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }

  function drawNativePanel(x, y, w, h, fill = "rgba(3,5,62,0.92)") {
    nativePanelPath(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "#8af7ff";
    ctx.lineWidth = 1;
    ctx.stroke();
    nativePanelPath(x + 2, y + 2, w - 4, h - 4, 4);
    ctx.strokeStyle = "#2459d8";
    ctx.stroke();
  }

  function fillHpBar(x, y, w, h, cur, max) {
    const [top, bottom] = hpBarColors(cur, max);
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, Math.round(w * hpBarLength(cur, max) / 128), h);
  }

  function drawNativeBar(x, y, w, h, cur, max) {
    ctx.fillStyle = "#d8d8d8";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#060812";
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    fillHpBar(x + 3, y + 3, w - 6, Math.max(1, h - 6), cur, max);
  }

  function drawPips(def, active = 0) {
    for (let i = 0; i < def.count; i++) {
      const x = def.x + i * def.step;
      ctx.fillStyle = "#061139";
      ctx.fillRect(x, def.y, 12, 9);
      ctx.strokeStyle = "#9dfcff";
      ctx.strokeRect(x + 0.5, def.y + 0.5, 11, 8);
      ctx.fillStyle = i === active ? "#11e4d0" : "#f3f6f8";
      ctx.fillRect(x + 3, def.y + 3, 6, 3);
    }
  }

  function chromeReady() {
    return !!fightUiAtlas;
  }

  function drawChrome(name, x, y, w = null, h = null) {
    const clip = FIGHT_UI_CLIPS[name];
    if (!fightUiAtlas || !clip) return false;
    const [sx, sy, sw, sh] = clip;
    ctx.drawImage(fightUiAtlas, sx, sy, sw, sh, x, y, w ?? sw, h ?? sh);
    return true;
  }

  // The large battle panes are GPU polygons in the original overlay, not a
  // scalable bitmap window.  The atlas's 104x64 decoration was previously
  // nine-sliced here, which visibly stretched its diagonal ornament across
  // the list.  Draw the measured native polygons and reserve atlas sampling
  // for the actual textured widgets (buttons, selectors, HP and DV frames).
  function drawFightPane(x, y, w, h, angled = false) {
    const cut = angled ? 7 : 0;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - cut);
    if (cut) ctx.lineTo(x + w - cut, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = "#02063e";
    ctx.fill();
    ctx.strokeStyle = "#00d9ff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 3);
    ctx.lineTo(x + w - 3, y + 3);
    ctx.lineTo(x + w - 3, y + h - cut - 2);
    if (cut) ctx.lineTo(x + w - cut - 2, y + h - 3);
    ctx.lineTo(x + 3, y + h - 3);
    ctx.closePath();
    ctx.strokeStyle = "#10147a";
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The eased HP the player's plate is showing. The original reads ONE word for both
   * the bar and the HP number -- the plate object's +0x60 -- so the number counts down
   * with the bar on the same poll and the same tween
   * (fightstg.s:17068 for the number, :17112 for the bar).
   */
  function pDispShown(cur) {
    return cur._hpPlate ? hpPlateShown(cur._hpPlate, 0) : Number(cur.player?.hp ?? 0);
  }

  function paintHpBar(x, y, w, h, cur, max, side = 0) {
    if (w <= 0) return;
    // The original's bar is one untextured POLY_G4 whose four vertex colours ramp
    // ACROSS the bar (word 0 on vertices 0 and 2, word 1 on 1 and 3), so the
    // gradient runs left to right — the enemy's quad lists vertex 0 on the right,
    // which battleHudBarColors already accounts for.
    const [left, right] = USE_TRANSLATED_HUD ? battleHudBarColors(cur, max, side) : hpBarColors(cur, max);
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, left);
    grad.addColorStop(1, right);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  // ── What the battle's own 2D layer put up this frame ────────────────────────
  //
  // The original draws a 3D battle's ailment picture with ONE plate marker and no
  // icon over the fighter (engine/dw3/battle-ailment-display.ts). That is a claim
  // about pixels, so it is measurable: every cel this file draws out of the battle
  // chrome pack is recorded with its native size and its place, and a check can then
  // ask whether anything landed inside the 3D stage rectangle.
  //
  // `known` marks a cel the decoded HUD draw actually asks for. The census of those
  // is FIGHTSTG_F0x800934f0, F0x80093fec, F0x80094878, F0x80094a00, F0x80094c18,
  // F0x8009543c, F0x80095e40, F0x80096fe4, F0x80097498, F0x800979e4, F0x80098924,
  // F0x8009a3b4 and F0x8009add4 (the plate pictures 0/1, the face-box bezel 0x0a,
  // the gauge 0x0b/0x1e/0x33-0x3a, the markers 0x0c-0x0f and 0x3c-0x3f, the message
  // window 0x31, and the item/tech list plates 0x23/0x25/0x26/0x27/0x28/0x29/0x2a/
  // 0x2b/0x30/0x34-0x39).
  const HUD_CELS_DECODED = new Set([
    0, 1, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x1e, 0x23, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b,
    0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
    0x3c, 0x3d, 0x3e, 0x3f,
  ]);
  let hudCels = [];
  /** Draw a cel of the battle chrome pack and record it for the frame read-out. */
  function hudClip(cel, x, y) {
    hudCels.push({ cel: Number(cel), x, y, known: HUD_CELS_DECODED.has(Number(cel)),
                   size: clipSize(pgfgc00, String(cel)) });
    return drawClip(ctx, pgfgc00, String(cel), x, y);
  }

  function drawBattleHud(b) {
    hudCels = [];
    const L = BATTLE_UI_LAYOUT;
    const enemy = L.enemyPlate;
    const player = L.playerPlate;
    const plates = packReady(pgfgc00);
    const originalChrome = chromeReady();
    if (plates) {
      hudClip(0, enemy.x, enemy.y);
      hudClip(1, player.x, player.y);
    } else if (originalChrome) {
      for (const plate of [enemy, player]) {
        drawChrome("angledFrame", plate.x, plate.y, plate.w, 17);
        drawChrome("hpFrame", plate.x, plate.barY - 2, plate.w, 16);
      }
    } else {
      drawNativePanel(enemy.x, enemy.y, enemy.w, enemy.h, "rgba(2,9,45,0.90)");
      drawNativePanel(player.x, player.y, player.w, player.h, "rgba(2,9,45,0.90)");
    }
    // Party icons (FIGHTSTG_F0x800934f0): the pip picture IS the member's state
    // (full / damaged / KO / afflicted), not a fixed marker. The pgfgc00 pack
    // carries the four states as cels 0xC-0xF (active slot) and 0x3C-0x3F.
    const pips = partyPipCels(b);
    // The translated marker loop draws the members the original would draw, at the
    // original's own x table and y, and picks the cel from the member's own state.
    const translatedPips = USE_TRANSLATED_HUD ? battleHudPartyPips(
      battleHudPlayerRecords(b), battleHudEnemyRecords(b),
      { activePlayerIndex: b.activePlayerIndex ?? 0, activeEnemyIndex: b.enemySlot ?? 0 }) : null;
    const pipReady = packReady(pgfgc00);
    const drawPip = (cel, x, y) => {
      if (pipReady && cel != null) { hudClip(cel, x, y); return; }
      if (originalChrome) { drawChrome("square", x, y, 12, 9); return; }
      ctx.fillStyle = "#061139";
      ctx.fillRect(x, y, 12, 9);
      ctx.strokeStyle = "#9dfcff";
      ctx.strokeRect(x + 0.5, y + 0.5, 11, 8);
    };
    if (translatedPips) {
      for (const pip of translatedPips) drawPip(pip.cel, pip.x, pip.y);
    } else if (originalChrome || pipReady) {
      drawPip(pips.enemy, L.enemyPips.x, L.enemyPips.y);
      for (let i = 0; i < L.playerPips.count; i++)
        drawPip(pips.player[i], L.playerPips.x + i * L.playerPips.step, L.playerPips.y);
    }
    if (!pipReady && !translatedPips) {
      ctx.fillStyle = "#15e0d5";
      ctx.fillRect(L.enemyPips.x + 3, L.enemyPips.y + 3, 6, 3);
      for (let i = 0; i < L.playerPips.count; i++) {
        ctx.fillStyle = i === (b.activePlayerIndex ?? 0) ? "#15e0d5" : "#f1f4f2";
        ctx.fillRect(L.playerPips.x + i * L.playerPips.step + 3, L.playerPips.y + 3, 6, 3);
      }
    }
    // The gauge's own frames are the chrome pack's cels 0x1e and 0x0b, which the
    // translated gauge block draws itself (see the DV block below). Only the
    // hand-drawn plate behind ?legacyBattleHud=1 keeps the stand-in frame.
    if (originalChrome && !USE_TRANSLATED_HUD) {
      drawChrome("hpFrameAlt", L.dv.x, L.dv.y, L.dv.w, L.dv.h);
    }

    // FIGHTSTG_F0x80093364 (through the ported plate build) draws the enemy's name at
    // (17, 21) and the player's at (174, 21) as kind 1 elements, and the build arm's
    // third element is the slash between the two HP numbers. The player's name is the
    // active roster member's own stored name, so it follows a rename and survives the
    // digivolved form the 3D actor is showing.
    const plateLabels = USE_TRANSLATED_HUD ? battleHudPlateLabelsFor(b) : null;
    if (plateLabels) {
      nativeText(plateLabels.enemy.text, plateLabels.enemy.x, plateLabels.enemy.y,
        { kind: plateLabels.enemy.kind });
      nativeText(plateLabels.player.text, plateLabels.player.x, plateLabels.player.y,
        { kind: plateLabels.player.kind });
    } else {
      nativeText(b.enemy.eStats?.digimon_id ?? b.enemy.profile?.name ?? "Enemy",
        enemy.nameX, enemy.nameY, { kind: 1 });
      // The native HUD keeps the roster partner's name while its live battle
      // profile/model is temporarily digivolved.  State-8 Jogress shows
      // "Renamon" here while the presentation actor is Stingmon.
      nativeText(b.playerRoster?.[b.activePlayerIndex]?.name ?? b.player.profile?.name ?? "Partner",
        player.nameX, player.nameY, { kind: 1 });
    }
    if (USE_TRANSLATED_HUD) {
      // F0x800935cc / F0x80093628: two number elements at (0x10b, 0x1a) and
      // (0x12e, 0x1a), the eased HP the bar is showing and the roster maximum.
      // The elements are right-anchored on their own x: the shown HP ends at 0x10b
      // and the maximum at 0x12e, the bar's right edge.
      //
      // No `color`: these three are the original's kind-3 number elements and
      // the original never sets a colour on one (web/uifont.js has the decode).
      // Their amber is CLUT row 0 of the number face, baked into uifont.png.
      nativeText(String(pDispShown(b)), L.hpNumbers.shownX, L.hpNumbers.shownY,
        { kind: 3, alignRight: true });
      // The plate's third element, built once by the same build arm at (0x10c, 0x1a):
      // bank 0x7f line 0x10, the single glyph "/". It sits one pixel right of the
      // shown HP's anchor, so the number row reads current, slash, maximum.
      if (plateLabels?.separator.text) {
        nativeText(plateLabels.separator.text, plateLabels.separator.x, plateLabels.separator.y,
          { kind: plateLabels.separator.kind });
      }
      nativeText(String(b.player.maxHp), L.hpNumbers.maxX, L.hpNumbers.maxY,
        { kind: 3, alignRight: true });
    } else {
      nativeText(`${b.player.hp}/${b.player.maxHp}`, player.hpRight, player.nameY, {
        kind: 3, alignRight: true,
      });
    }
    const eDisp = b._hpPlate ? hpPlateShown(b._hpPlate, 1) : b.enemy.hp;
    const pDisp = pDispShown(b);
    if (plates) {
      const eBar = hpBarFillRect("enemy", eDisp, b.enemy.maxHp);
      const pBar = hpBarFillRect("player", pDisp, b.player.maxHp);
      paintHpBar(eBar.x, eBar.y, eBar.w, eBar.h, eDisp, b.enemy.maxHp, 1);
      paintHpBar(pBar.x, pBar.y, pBar.w, pBar.h, pDisp, b.player.maxHp, 0);
    } else if (originalChrome) {
      // Colour and length read the *displayed* HP (HUD +0x60), so a hit that
      // crosses the quarter slumps the fighter immediately while the bar is
      // still sliding through green.
      for (const [plate, cur, max] of [[enemy, eDisp, b.enemy.maxHp], [player, pDisp, b.player.maxHp]]) {
        ctx.fillStyle = "#05060a";
        ctx.fillRect(plate.barX + 3, plate.barY + 3, plate.barW - 6, plate.barH - 6);
        fillHpBar(plate.barX + 3, plate.barY + 3, plate.barW - 6, plate.barH - 6, cur, max);
      }
    } else {
      drawNativeBar(enemy.barX, enemy.barY, enemy.barW, enemy.barH, eDisp, b.enemy.maxHp);
      drawNativeBar(player.barX, player.barY, player.barW, player.barH, pDisp, b.player.maxHp);
      drawPips(L.enemyPips, 0);
      drawPips(L.playerPips, b.activePlayerIndex ?? 0);
    }

    // The DV/Blast gauge. The translated block (FIGHTSTG_F0x800934f0
    // .L0x80093820-.L0x8009392c) draws it as the original does: the outer frame cel
    // 0x1e at (260,61), a black trough over the unfilled remainder from
    // 265+gauge/25 to 305 while the gauge is below 1000, the fill cel 0x33+phase (or
    // 0x37+phase at full) at (265,62), then the inner frame cel 0x0b over the fill.
    // The phase is (tick >> 2) & 3, so it steps once every four frames.
    const dv = L.dv;
    const dvFrame = (Math.trunc((b._hudClock || 0) * HUD_CLOCK_HZ) >> 2) & 3;
    if (USE_TRANSLATED_HUD) {
      const frame = battleHudDvFrame({
        gauge: b.player.gauge, tick: Math.trunc((b._hudClock || 0) * HUD_CLOCK_HZ),
        slot: b.activePlayerIndex ?? 0,
      });
      if (battleHudDvPaint(ctx, frame, { pgfgc00 })) {
        // The chrome pack drew all four pieces.
      } else {
        ctx.fillStyle = "#05060a";
        ctx.fillRect(frame.trough.x, frame.trough.y, frame.trough.w, frame.trough.h);
        const level = dvGaugeLength(b.player.gauge);
        const dvFills = level >= 10
          ? ["#ffd56a", "#ffe08a", "#ffc83c", "#ffb52c"]
          : ["#ffb52c", "#ffa018", "#ffb52c", "#e09a20"];
        ctx.fillStyle = dvFills[frame.phase];
        ctx.fillRect(dv.x + 3, dv.y + 3, Math.round((dv.w - 6) * level / 10), Math.max(1, dv.h - 6));
      }
    } else {
      const dvLevel = dvGaugeLength(b.player.gauge);
      if (!originalChrome) {
        ctx.fillStyle = "#d5d5d5";
        ctx.fillRect(dv.x, dv.y, dv.w, dv.h);
        ctx.fillStyle = "#05060a";
        ctx.fillRect(dv.x + 2, dv.y + 2, dv.w - 4, dv.h - 4);
      } else {
        ctx.fillStyle = "#05060a";
        ctx.fillRect(dv.x + 3, dv.y + 3, dv.w - 6, Math.max(1, dv.h - 6));
      }
      // Filling uses sprite set 0x33+(t>>2)&3; full (1000) uses 0x37+(t>>2)&3.
      const gaugeCel = dvGaugeCel(b.player.gauge, dvFrame);
      hudCels.push({ cel: gaugeCel, x: DV_GAUGE_ANCHOR.x, y: DV_GAUGE_ANCHOR.y,
                     known: HUD_CELS_DECODED.has(gaugeCel),
                     size: clipSize(pgfgc00, String(gaugeCel)) });
      const gaugeDrawn = packReady(pgfgc00) && drawClipWidth(
        ctx, pgfgc00, String(dvGaugeCel(b.player.gauge, dvFrame)),
        DV_GAUGE_ANCHOR.x, DV_GAUGE_ANCHOR.y, dvGaugeWidth(b.player.gauge));
      if (!gaugeDrawn) {
        const dvFills = dvLevel >= 10
          ? ["#ffd56a", "#ffe08a", "#ffc83c", "#ffb52c"]
          : ["#ffb52c", "#ffa018", "#ffb52c", "#e09a20"];
        ctx.fillStyle = dvFills[dvFrame];
        ctx.fillRect(dv.x + 3, dv.y + 3, Math.round((dv.w - 6) * dvLevel / 10), Math.max(1, dv.h - 6));
      }
    }

    const pr = L.portrait;
    const pv = L.portraitView;
    // Clip-12 / Blast omit the 3D face and the PGFGTC00 bezel (cel 0xA).
    if (b.state === ST.DNA_PRESENT || b.blastShow) {
      return;
    }
    // Cel 0xA is a filled 104×64 plate; clip the inner 100×60 so the 3D face shows.
    ctx.save();
    ctx.beginPath();
    ctx.rect(pr.x, pr.y, pr.w, pr.h);
    ctx.rect(pv.x, pv.y, pv.w, pv.h);
    ctx.clip("evenodd");
    // The draw the original builds in FIGHTSTG_F0x80093fec: layer 0x1005, origin 0x200,
    // pack PGFGTC00, cel 0xA at (246, 74). `faceBezelCelDraw()` is the port of that
    // draw request — the cel and its place come from it, not from a literal here.
    const bezelDraw = faceBezelCelDraw();
    const bezel = packReady(pgfgc00)
      ? hudClip(bezelDraw.cel, bezelDraw.x, bezelDraw.y)
      : drawChrome("portraitFrame", pr.x, pr.y);
    ctx.restore();
    if (!bezel) {
      ctx.strokeStyle = "#20283d";
      ctx.lineWidth = 4;
      ctx.strokeRect(pr.x, pr.y, pr.w, pr.h);
      ctx.strokeStyle = "#aeb7c9";
      ctx.lineWidth = 1;
      ctx.strokeRect(pr.x + 1.5, pr.y + 1.5, pr.w - 3, pr.h - 3);
    }
  }

  /** The "No techs!" / "Cannot digivolve." notice over whichever list is up. */
  function drawMenuNotice(b) {
    if (!b.menuNotice) return;
    drawNativePanel(118, 194, 186, 25, "rgba(0,4,45,0.94)");
    nativeText(b.menuNotice, 125, 201, { kind: 1 });
  }

  function drawCommandMenu(b) {
    const C = BATTLE_UI_LAYOUT.commands;
    const items = currentMenuItems(b);
    for (let i = 0; i < items.length; i++) {
      const y = C.y + i * C.rowH;
      const selected = i === b.menuSel;
      if (packReady(pgfgc00)) {
        // Selected row's +0x80 vsync counter >> 2 cycles CLUT 0..4 (F0x8009add4).
        const k = selected ? ((Math.trunc((b._hudClock || 0) * 50) >> 2) % 5) : 0;
        const rowId = k === 0 ? "34" : `34#${k}`;
        drawClip(ctx, pgfgc00, rowId, C.iconX, y);
        nativeText(items[i], C.boxX, y, { kind: 1 });
      } else if (chromeReady()) {
        drawChrome("commandIcon", C.iconX, y);
        drawChrome("commandPlate", C.plateX, y + C.plateYOff);
        nativeText(items[i], C.boxX, y, { kind: 1 });
        if (selected) {
          ctx.strokeStyle = "#eaffff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(C.iconX + C.iconSize / 2, y + C.iconSize / 2, 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = "rgba(0,5,48,0.94)";
        ctx.fillRect(C.iconX, y + 1, C.iconSize, C.iconSize);
        ctx.strokeStyle = selected ? "#a8ffff" : "#00a8ff";
        ctx.lineWidth = 1;
        ctx.strokeRect(C.iconX + 0.5, y + 1.5, C.iconSize - 1, C.iconSize - 1);
        if (selected) {
          ctx.strokeStyle = "#ecffff";
          ctx.beginPath();
          ctx.arc(C.iconX + C.iconSize / 2, y + 1 + C.iconSize / 2, 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        drawNativePanel(C.boxX, y, C.boxW, C.boxH, "rgba(0,8,69,0.94)");
        nativeText(items[i], C.boxX, y, { kind: 1 });
      }
    }
    drawMenuNotice(b);
  }
  function drawListSelector(x, y, selected) {
    if (!drawChrome("square", x, y, 13, 13)) {
      ctx.fillStyle = "#050638";
      ctx.fillRect(x, y, 13, 13);
      ctx.strokeStyle = "#00c0f8";
      ctx.strokeRect(x + 0.5, y + 0.5, 12, 12);
    }
    if (selected) {
      ctx.strokeStyle = "#efffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + 6.5, y + 6.5, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // The one list chrome every in-battle list draws: the window plus its two
  // page hints. The hints' kind and colour row are the shared decoded pair (see
  // listPageHint); only their anchor comes from the caller, because the
  // original's F0x8001ae38 takes x and y per screen.
  function drawListChrome(hint = BATTLE_UI_LAYOUT.list.pageHint) {
    const L = BATTLE_UI_LAYOUT.list;
    drawFightPane(L.x, L.y, L.w, L.h, true);
    nativeText("L1", hint.l1.x, hint.l1.y, { kind: hint.kind, clut: hint.clut });
    nativeText("R1", hint.r1.x, hint.r1.y, { kind: hint.kind, clut: hint.clut });
  }

  function drawDescription(text, mp = null) {
    const D = BATTLE_UI_LAYOUT.description;
    drawFightPane(D.x, D.y, D.w, D.h);
    nativeText(text ?? "", D.x + 5, D.y + 7, { kind: 1 });
    if (mp != null) {
      nativeText("MP", 256, 211, { kind: 3 });
      nativeText(String(mp), 300, 211, { kind: 3, alignRight: true });
    }
  }

  function visibleList(rows, selected) {
    const visible = 6;
    const top = Math.max(0, Math.min(selected - visible + 1, rows.length - visible));
    return { visible, top };
  }

  function drawTechMenu(b) {
    const L = BATTLE_UI_LAYOUT.list;
    const techs = playerTechs();
    const { visible, top } = visibleList(techs, b.techSel);
    drawListChrome(TECH_PAGE_HINT);
    for (let i = 0; i < visible; i++) {
      const index = top + i;
      const y = L.rowY + i * L.rowH;
      const skill = techs[index];
      drawListSelector(L.iconX, y, index === b.techSel);
      if (!skill) continue;
      drawIconGlyph(ctx, skill.element ?? "thunder", L.glyphX, y, 1);
      nativeText(skill.name, L.labelX, y, { kind: 1 });
    }
    const selected = techs[b.techSel];
    const M = BATTLE_UI_LAYOUT.listMp;
    drawChrome("angledFrame", M.x, M.y, M.w, M.h);
    nativeText(`MP${b.player.mp}/${b.player.maxMp}`, M.x + M.w - 5, M.y + 4, {
      kind: 3, alignRight: true,
    });
    drawDescription(
      selected?.desc,
      selected
        ? techniqueMpCost(selected.mp_cost ?? 20, selected.techWord ?? 0, {
            mpCostDown: b.player.mpCostDown ?? 0,
          })
        : 0,
    );
  }

  function drawItemMenu(b) {
    const L = BATTLE_UI_LAYOUT.list;
    const items = usableItems();
    const { visible, top } = visibleList(items, b.itemSel);
    drawListChrome(ITEM_PAGE_HINT);
    for (let i = 0; i < visible; i++) {
      const index = top + i;
      const y = L.rowY + i * L.rowH;
      const item = items[index];
      drawListSelector(L.iconX, y, index === b.itemSel);
      if (!item) continue;
      drawItemIcon(ctx, item.id, L.glyphX, y, 1);
      nativeText(item.name, L.labelX, y, { kind: 1 });
    }
    const selected = items[b.itemSel];
    const Q = BATTLE_UI_LAYOUT.itemQty;
    drawFightPane(Q.x, Q.y, Q.w, Q.h, true);
    nativeText(`X ${selected?.qty ?? 0}`, Q.x + 5, Q.y + 5, { kind: 1 });
    drawDescription(selected?.desc ?? selected?.description ?? "");
  }

  function drawTagMenu(b) {
    const T = BATTLE_UI_LAYOUT.tag;
    const members = tagMembers();
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const y = T.y + i * T.rowH;
      drawListSelector(16, y + 2, i === b.tagSel);
      drawChrome("angledFrame", T.nameX, y, T.nameW, 16);
      nativeText(member.name, T.nameX + 3, y + 2, { kind: 1 });
      drawFightPane(T.statsX, y - 1, T.statsW, 29);
      nativeText(`HP${member.stats.hp}/${member.stats.maxHp}`, T.statsX + T.statsW - 4, y + 1, {
        kind: 3, alignRight: true,
      });
      nativeText(`MP${member.stats.mp}/${member.stats.maxMp}`, T.statsX + T.statsW - 4, y + 15, {
        kind: 3, alignRight: true,
      });
    }
  }

  function drawFormMenu(b, rosterIndex, title) {
    const forms = formOptionsFor(rosterIndex);
    const member = b.playerRoster[rosterIndex];
    const L = BATTLE_UI_LAYOUT.list;
    drawListChrome(FORM_PAGE_HINT);
    const { visible, top } = visibleList(forms, b.formSel);
    for (let i = 0; i < visible; i++) {
      const index = top + i;
      const y = L.rowY + i * L.rowH;
      const form = forms[index];
      drawListSelector(L.iconX, y, index === b.formSel);
      if (form) nativeText(form.name, L.labelX, y, { kind: 1 });
    }
    const selected = forms[b.formSel];
    if (!selected || !member) return;
    const projected = buildPlayerRecord(member, selected.id);
    drawFightPane(164, 73, 142, 100, true);
    nativeText(title, 170, 79, { kind: 1 });
    nativeText(`Lv ${projected.level}`, 298, 79, { kind: 3, alignRight: true });
    nativeText(`HP ${projected.hp}/${projected.maxHp}`, 170, 96, { kind: 3 });
    nativeText(`MP ${projected.mp}/${projected.maxMp}`, 170, 110, { kind: 3 });
    nativeText(`STR ${projected.str}`, 170, 126, { kind: 3 });
    nativeText(`DEF ${projected.def}`, 238, 126, { kind: 3 });
    nativeText(`SPT ${projected.spt}`, 170, 140, { kind: 3 });
    nativeText(`WIS ${projected.wis}`, 238, 140, { kind: 3 });
    nativeText(`SPD ${projected.spd}`, 170, 154, { kind: 3 });
  }

  function drawDnaChoice(b) {
    const choice = b._dnaChoice;
    if (!choice) return;
    // Savestate-8 native geometry: selected partner form above two authentic
    // fight-atlas command frames; DNA DV carries the result-tech MP pane.
    drawChrome("angledFrame", 164, 158, 142, 16);
    nativeText(digimonDB[choice.formId]?.name ?? "", 169, 160, { kind: 1 });
    drawListSelector(164, 182, b.dnaSel === 0);
    drawChrome("angledFrame", 182, 180, 92, 16);
    nativeText("Switch", 188, 182, { kind: 1 });
    // No DNA pairing: the original's list is one row long, so the "DNA DV"
    // row and its MP plate are not built at all (fightstg.s:22168-:22177).
    if (choice.switchOnly) { drawMenuNotice(b); return; }
    drawListSelector(164, 204, b.dnaSel === 1);
    drawChrome("angledFrame", 182, 202, 92, 16);
    nativeText("DNA DV", 188, 204, { kind: 1 });
    drawChrome("angledFrame", 266, 202, 42, 16);
    nativeText(`MP ${choice.cost}`, 304, 204, { kind: 3, alignRight: true });
  }

  // STFGTREP chrome from stfgtrep_ui.json. header.rowStepY (50) is page pitch
  // (F0x80083260 unk5C*0x32), not partner-card pitch. Walker draws one page
  // at base 0. victory_exact (2026-07-18) is not in this tree.
  // One partner's group: its plate, its name, its level, its EXP, and the
  // three digivolve bars beside it. A bar carries the form's name and its form
  // level once that Digimon has the form; an empty bar stays empty, which is
  // what the capture of the original shows at the start of the game.
  //
  // The portrait animates: one frame every 13 vsyncs, from the table read off
  // the running game (claim FIGHT-REPORT-PORTRAIT-FRAMES-001).
  function drawFightReportGroup(ctx, G, row, opts = {}) {
    if (!G || !row) return;
    const t = opts.seconds ?? 0;
    // The plate is drawn plain. The screen's own code hands it the arrow's
    // palette row, but our cut of that row paints it cream, and the capture
    // shows the levelled partner's plate the same blue as everyone else's --
    // only its picture box and its name strip change. Either our palette cut is
    // wrong or the row means something else here; not settled, so not shipped.
    drawClip(ctx, stfrptChrome, G.plate.clip, G.plate.x, G.plate.y);
    const face = fightReportPortraitClip(G.portrait, row.rookieId, t);
    if (face != null) drawClip(ctx, stfrptChrome, face, G.portrait.x, G.portrait.y);
    // The bracketed frame and the white name strip mark the page's partner.
    if (opts.marked && G.highlight) {
      drawClipAtPaletteRow(ctx, stfrptChrome, G.highlight.clip,
        fightReportCycleRow(G.highlight, t), G.highlight.x, G.highlight.y);
    }
    if (opts.levelling && G.levelArrow) {
      drawClipAtPaletteRow(ctx, stfrptChrome, G.levelArrow.clip,
        fightReportRampRow(G.levelArrow, t), G.levelArrow.x, G.levelArrow.y);
    }
    uiDrawText(ctx, row.name ?? "", G.name.x, G.name.y, { kind: 1 });
    uiDrawText(ctx, G.levelLabel.str, G.levelLabel.x, G.levelLabel.y, { kind: 3 });
    uiDrawText(ctx, String(row.level ?? 1), G.levelValue.x, G.levelValue.y,
      { kind: 3, alignRight: true });
    const xp = opts.countingXp ?? row.xp ?? 0;
    uiDrawText(ctx, String(xp), G.xpValue.x, G.xpValue.y, { kind: 3, alignRight: true });
    uiDrawText(ctx, G.xpLabel.str, G.xpLabel.x, G.xpLabel.y, { kind: 3 });
    G.slots.forEach((slot, j) => {
      const barMarked = opts.markedSlot === j;
      if (barMarked) {
        // The bar picture is drawn plain, for the same reason as the plate.
        drawClip(ctx, stfrptChrome, slot.barClip, slot.barX, slot.barY);
        if (slot.markerClip != null) {
          drawClipAtPaletteRow(ctx, stfrptChrome, slot.markerClip,
            fightReportRampRow(slot.markerRamp, t), slot.markerX, slot.markerY);
        }
      } else {
        drawClip(ctx, stfrptChrome, slot.barClip, slot.barX, slot.barY);
      }
      const form = row.forms?.[j];
      if (form?.name) {
        uiDrawText(ctx, form.name, slot.nameX, slot.nameY, { kind: 1 });
        uiDrawText(ctx, String(form.level ?? 1), slot.valueX, slot.valueY,
          { kind: 3, alignRight: true });
      }
      if (barMarked && slot.highlightClip != null) {
        drawClipAtPaletteRow(ctx, stfrptChrome, slot.highlightClip,
          fightReportCycleRow(G.highlight, t), slot.highlightX, slot.highlightY);
      }
    });
  }

  function drawFightReport(b) {
    const L = REPORT_LAYOUT;
    const groups = L
      ? Array.from({ length: fightReportGroupCount(L) },
          (_, i) => fightReportGroupGeom(L, i))
      : [];
    const G = groups[0] ?? null;
    const chromeReady = G && packReady(stfrptChrome);
    const pages = b._winPages?.length ? b._winPages
      : [{ label: "EXP gained", value: b._winReward?.xp ?? 0 }];
    const pageIdx = Math.min(pages.length - 1, b._winPageIndex ?? 0);
    const page = pages[pageIdx];

    if (!chromeReady || !L) {
      ctx.fillStyle = "#000018";
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px monospace";
      ctx.textAlign = "center";
      ctx.fillText(page.message ?? `${page.label}: ${page.value}`, 160, 210);
      return;
    }

    // Brief black cut before the first report page only.
    if (pageIdx === 0 && b.timer < 0.42) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 320, 240);
      return;
    }

    // F0x80084c20: ambient background diagonal wipe — draw-position k ramps
    // 0..95 (2 vsyncs/step, ~40ms PAL) then resets, per the decoded cadence.
    const ak = Math.floor(performance.now() / L.ambient_bg.animated.stepMs) % (L.ambient_bg.animated.max + 1);
    drawClip(ctx, stfrptChrome, L.ambient_bg.clip, ak, ak);
    // The corner badge carries the battle's EXP total. It is absent from the
    // BIT page in the capture, so picture and text come and go together.
    const badgeOn = (L.corner_badge.pages ?? []).includes(page.kind);
    if (badgeOn) {
      drawClip(ctx, stfrptChrome, L.corner_badge.clip, L.corner_badge.x, L.corner_badge.y);
    }
    drawClip(ctx, stfrptChrome, L.message_bar.clip, L.message_bar.x, L.message_bar.y);

    const MSG = G.message;
    const active = page.index ?? 0;
    const frames = Math.max(0, Math.floor((b.timer - 0.42) * 50));
    if (uiFontReady()) {
      if (badgeOn) {
        const CB = L.corner_badge;
        uiDrawText(ctx, String(b._winReward?.xp ?? 0), CB.value.x, CB.value.y,
          { kind: CB.value.kind, alignRight: true });
        uiDrawText(ctx, CB.label.str, CB.label.x, CB.label.y, { kind: CB.label.kind });
      }
      (b._winReportRows ?? []).slice(0, groups.length).forEach((row, i) => {
        const g = groups[i];
        drawFightReportGroup(ctx, g, row, {
          seconds: b.timer,
          // The page names one partner, and that partner is marked. A page
          // about the party's money names nobody and marks nobody.
          marked: page.index != null && i === active,
          levelling: i === active && (g.levelArrow?.pages ?? []).includes(page.kind),
          markedSlot: i === active ? fightReportMarkedSlot(page, row) : null,
          countingXp: page.kind === "exp" && i === active && page.startXp != null
            ? expCountDisplayed(page.startXp, page.targetXp ?? row.xp, frames)
            : null,
        });
      });
      const message = page.message ?? `${page.label}:\n${page.value ?? ""}`;
      const chars = Math.max(0, Math.floor((b.timer - 0.55) * 18));
      message.slice(0, chars).split("\n").forEach((line, i) =>
        uiDrawText(ctx, line, MSG.x, MSG.y + i * 13, { kind: MSG.kind }));
    } else {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "left";
      ctx.fillText(page.message ?? `${page.label}: ${page.value}`, 20, 44);
    }

    // Shared cmfont blink cursor (CLUT-cycled, 5 frames — same clip every
    // other decoded menu screen reuses).
    const cur = loadPack(L.blink_cursor.pack);
    if (packReady(cur)) {
      const k = Math.floor(performance.now() / 120) % 5;
      drawClipAtPaletteRow(ctx, cur, L.blink_cursor.clip, k, L.blink_cursor.x, L.blink_cursor.y);
    }

  }

  function draw() {
    if (!battle) return;
    const b  = battle;
    // The native results screen owns the whole framebuffer while it is up; the
    // battle must not paint over it (web/game.js draws the report afterwards).
    if (b._reportNative) return;
    // The finale's ending chain owns the whole framebuffer the same way: the
    // host's movie adapter draws it over the battle's last pose frame.
    if (b._endingHosted) return;
    const cw = canvas.width, ch = canvas.height;  // real device px (fullscreen)
    const W  = BATTLE_REF_W;   // 640 — logical UI layout space (scaled to fill below)
    const H  = BATTLE_REF_H;   // 480

    ctx.save();

    // STFGTREP replaces the battle framebuffer completely. Scale its native
    // 320x240 image uniformly so fullscreen keeps the original 4:3 framing.
    if (b.state === ST.WIN && b._victoryPhase === "report" && !b._reportNative) {
      // The 3D compositor and battle helpers may leave a device transform on
      // the shared context between frames; a takeover screen starts at the
      // framebuffer origin just like the PSX display environment switch.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);
      const scale = Math.min(cw / 320, ch / 240);
      ctx.translate((cw - 320 * scale) / 2, (ch - 240 * scale) / 2);
      ctx.scale(scale, scale);
      ctx.imageSmoothingEnabled = false;
      drawFightReport(b);
      ctx.restore();
      return;
    }

    // 3D scene fills the whole canvas (identity transform, full device resolution).
    if (renderer3d && offscreen3d) {
      ctx.drawImage(offscreen3d, 0, 0, cw, ch);
      // ORDER MATTERS during a form change: the transformation controller's
      // curtain blacks the arena out FIRST and the E000EVOL sprites play over
      // that black, so the curtain has to go UNDER the effect pass. Drawing it
      // after would hide the very art this is here to show.
      if (b.blastShow?.state) drawBlastCurtain(ctx, b.blastShow.state, cw, ch);
      // op3 tech visual effects (decoded eNNN sprites) composite over the 3D frame; the view
      // maps PSX screen/world coords to the offscreen's px which we scale to the canvas here.
      // The transformation's own effects (types 1000-1003/1007/1008, file
      // E000EVOL) come through this same pass.
      const fx = renderer3d.getEffectDraw?.();
      if (fx) {
        ctx.save();
        ctx.scale(cw / offscreen3d.width, ch / offscreen3d.height);
        drawEffects(ctx, fx.list, fx.manifest, fx.images, fx.view);
        ctx.restore();
      }
      // The flash washes those sprites, so it sits on top of them — and still
      // UNDER the battle chrome, which the capture keeps visible throughout.
      if (b.blastShow?.state) drawBlastFlash(ctx, b.blastShow.state, cw, ch);
      const overlay = renderer3d.getScreenOverlay?.();
      if (overlay) {
        ctx.save();
        ctx.globalAlpha = overlay.alpha;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = "rgba(0,0,8,0.92)";
      ctx.fillRect(0, 0, cw, ch);
    }

    // All player-facing battle chrome is laid out in the original 320x240
    // coordinate space, then scaled once to the fullscreen canvas.
    ctx.save();
    const nativeScale = Math.min(
      cw / BATTLE_UI_LAYOUT.nativeW,
      ch / BATTLE_UI_LAYOUT.nativeH,
    );
    const nativeX = (cw - BATTLE_UI_LAYOUT.nativeW * nativeScale) / 2;
    const nativeY = (ch - BATTLE_UI_LAYOUT.nativeH * nativeScale) / 2;
    ctx.translate(nativeX, nativeY);
    ctx.scale(nativeScale, nativeScale);
    ctx.imageSmoothingEnabled = false;
    // Jogress is staged behind the normal battle plates; the dense state-8
    // replay keeps both HP plates, party pips, and DV gauge visible through
    // the entire parent-orb flight and only the op7 white-out washes them out.
    drawBattleHud(b);

    // The Blast transformation keeps BOTH HP plates and drops every menu: the
    // capture shows the command list gone from the first frame of the effect
    // (the "... Blasted!" line is dismissed and no input is accepted for ~14 s).
    if (b.blastShow) { ctx.restore(); ctx.restore(); return; }

    if (b.state === ST.PLAYER_MENU) {
      // The shipped pro/fightstg overlay draws the six-row list with its own
      // chrome and sliding highlight; the walker's drawn list is the rollback
      // and the confused-gag case. The menu notice ("No techs!") rides on top.
      if (commandNative.active()) {
        commandNative.draw(ctx, BATTLE_UI_LAYOUT.nativeW, BATTLE_UI_LAYOUT.nativeH);
        drawMenuNotice(b);
      } else {
        drawCommandMenu(b);
      }
    } else if (b.state === ST.PLAYER_TECH) {
      if (techNative.active()) techNative.draw(ctx, BATTLE_UI_LAYOUT.nativeW, BATTLE_UI_LAYOUT.nativeH);
      else drawTechMenu(b);
    } else if (b.state === ST.PLAYER_ITEM) {
      if (itemNative.active()) itemNative.draw(ctx, BATTLE_UI_LAYOUT.nativeW, BATTLE_UI_LAYOUT.nativeH);
      else drawItemMenu(b);
    } else if (b.state === ST.PLAYER_TAG) {
      if (tagNative.active()) tagNative.draw(ctx, BATTLE_UI_LAYOUT.nativeW);
      else drawTagMenu(b);
    } else if (b.state === ST.PLAYER_DNA_CHOICE) {
      if (dnaNative.active()) dnaNative.draw(ctx, BATTLE_UI_LAYOUT.nativeW);
      else drawDnaChoice(b);
    } else if (b.state === ST.PLAYER_DV) {
      if (formNative.active()) formNative.draw(ctx, BATTLE_UI_LAYOUT.nativeW, BATTLE_UI_LAYOUT.nativeH);
      else drawFormMenu(b, b.activePlayerIndex, "Digivolve");
    } else if ((b.state !== ST.WIN || b._victoryPhase === "pose") &&
               b.state !== ST.DNA_PRESENT &&
               !(b.state === ST.TAG_PRESENT && b._tagPresentation?.phase !== "prompt")) {
      const msg = b.state === ST.LOSE ? "Annihilated..." : b.message; // esmfight 0x53, set at 0x800a924c
      if (msgSession) {
        // The original's own window picture, lines and blinking prompt. With no message
        // up there is no object and no panel (F0x80098924 is only reached while the
        // controller is in its state 1), so nothing is painted -- the legacy
        // rectangle below is the ?legacyBattleMsg=1 rollback only.
        if (msgSession.active && !msgSession.finished) {
          battleMsgPaint(ctx, msgSession.frame(), nativeText, { pgfgc00, cmfont });
        }
      } else {
        const M = BATTLE_UI_LAYOUT.message;
        drawNativePanel(M.x, M.y, M.w, M.h, "rgba(0,4,45,0.94)");
        String(msg).split("\n").slice(0, 2).forEach((line, i) =>
          nativeText(line, M.x + 8, M.y + 4 + i * 11, { kind: 1 }));
      }
    }
    ctx.restore();

    if (b.state === ST.LOSE && b._loseFade > 0) drawSubtractiveFade(ctx, cw, ch, b._loseFade);

    ctx.restore();
  }

  // PSX ABR 2 (B - F) with a grey F: each channel becomes max(0, c - level).
  // Canvas has no subtract mode, so: invert, add the level, invert again.
  function drawSubtractiveFade(ctx, cw, ch, amount) {
    const level = Math.round(amount * 255);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgb(${level},${level},${level})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  // Read-only live-battle peek for headless verification (the lab handles
  // expose state everywhere else; field battles had no reader at all).
  function peek() {
    if (!battle) return null;
    const b = battle;
    return {
      state: b.state,
      // The battle's OPENING PHASE MACHINE as the walker runs it: which of the original's
      // seven phases (engine/dw3/battle-opening-machine.ts), whether the opening line is
      // armed, and the intro variant the disc's own rule selected. A headless check reads
      // this to see the machine advance and to watch a slow load hold phase 3.
      opening: b._opening ? {
        top: b._opening.top, sub: b._opening.sub, phase: b._opening.phase,
        phaseName: openingPhaseFor(b._opening.phase).name, of: OPENING_PHASE_COUNT,
        linePending: b._opening.linePending, exited: b._opening.exited,
        introVariant: b._opening.introVariant, specialMode4: b._opening.specialMode4,
        openCameraArmed: b._opening.openCameraArmed,
        lineArmed: b._introLineArmed === true,
      } : null,
      message: String(b.message ?? "").slice(0, 160),
      // The translated message line, as the session currently has it: the window
      // picture's own box, where each line sits, and whether the "press Circle"
      // glyph is up. tools/verify_first_story_battle.mjs reads this to check the
      // line appears where pro/fightstg puts it.
      messageLine: msgSession ? {
        active: msgSession.active,
        finished: msgSession.finished,
        holdsTurn: msgHoldsTurn(b),
        frame: msgSession.frame(),
        promptVisible: msgSession.promptVisible,
        tick: msgSession.clock,
      } : null,
      menu: b.state === ST.PLAYER_MENU ? currentMenuItems(b).slice() : null,
      // Is the command phase still waiting for the line to be read? While this is true
      // the original has not armed the menu at all (`wfightmn.s:1494-1496`), so the list
      // must not be open and nothing may read the pad.
      waitsForLine: commandPhaseWaitsForLine(msgSession, b.state),
      // Is the shipped command list reading the pad yet? pro/wfightmn's boot loader
      // owns the input until it retires, and the list ignores presses until its first
      // tick has built it, so a check that wants the list to answer has to wait for
      // `active`. tools/verify_first_story_battle.mjs reads this.
      commandList: {
        open: commandNative.isOpen(),
        active: commandNative.active(),
        pending: commandNative.isPending(),
        failed: commandNative.failed(),
      },
      loaderOpen: wfightNative.isOpen(),
      // The command phase's Frozen gate (F0x800a7418 step 1): which turn it rolled on
      // and whether it lost that turn. A lost turn never opens the list.
      frozenGate: {
        seq: b._turnSeq ?? 0,
        rolledOn: b._frozenGateTurn ?? null,
        lost: b._frozenGateLost === true,
      },
      // The loss sequence as the original's own objects report it: the exit's mode
      // word (0 wait for phase 2, 1 wait for the ramp, 2 launch), the fade's level and
      // the grey its quad is drawn with, and the launch code the exit asked for.
      loss: b._lossSession ? {
        ...b._lossSession.state(),
        fade: b._loseFade ?? 0,
        launchCode: b._lossSession.launchCode(),
        messageId: b._lossSession.messageId,
      } : null,
      menuSel: b.menuSel ?? null,
      player: b.player ? { name: b.player.profile?.name, hp: b.player.hp, maxHp: b.player.maxHp } : null,
      enemy: b.enemy ? { name: b.enemy.profile?.name ?? b.enemy.name, hp: b.enemy.hp, maxHp: b.enemy.maxHp } : null,
    };
  }

  async function scriptedScreen(mapId, index) {
    await loadData();
    const stage = stageEncDB?.stages?.[String(mapId).replace(/^s/, "")];
    return scriptedScreenId(stage, index, storyOrdinal(), entryKey());
  }

  return { isActive, start, startRandom, startParty, startScreen, scriptedScreen, partyForScreen, triggersForStage,
    // Post-fight results hand-off (Phase 6.3): the host registers how to open
    // the native pro/stfgtrep screen, and calls finishNativeReport() when the
    // player leaves it, which returns to the field exactly like the inline
    // report's final confirm.
    setReportHandoff: (h) => { reportHandoff = h ?? null; },
    // The finale's win exit hand-off: the host registers how to play the ending
    // chain (movie row 10 MOVIEE01_STR, then its return selector 0xE0C = row 11
    // MOVIEE02_STR, then 0x2d7 = screen 727 = stage 780) and calls
    // finishEnding() when it is done — the kind-6 equivalent of the report
    // hand-off above (wfightmn.s:2165-2174).
    setEndingHandoff: (h) => { endingHandoff = h ?? null; },
    // The pre-battle presentation the field's handoff owes (F0x8008B798). The
    // host's handler returns a promise that resolves when it is over.
    setFieldMovieHandoff: (h) => { fieldMovieHandoff = h ?? null; },
    finishNativeReport: () => { if (battle) endBattle("win"); },
    finishEnding: () => { if (battle) endBattle("win"); },
    evoTargets, applyEvolution, initializePartyStats, partnerInfo, availableEvolutions,
    getPlayerProfile, update, draw, handleKey, pickEnemy, encounterRateLevel, loadData, peek,
    // The status-event pool itself, so a test can read the 99 x 28-byte queue the
    // original keeps at 0x800a3868 instead of a boolean the walker invented.
    debugStatusEvents: () => (battle?.statusEvents
      ?? []).map((e) => ({ ...e })),
    debugStatusEventQueueAdvance: (acted = "player") =>
      (battle ? statusEventQueueAdvance(battle) : []),
    // Headless read-out of the party pips' decoded cels (FIGHTSTG_F0x800934f0).
    debugPips: () => (battle ? partyPipCels(battle) : null),
    // Every cel the battle's own 2D layer drew since the last frame, with its place.
    debugHudCels: () => hudCels.map((c) => ({ ...c, ...(c.size || {}) })),
    // Headless read-out of the DV gauge's decoded sprite/width (FIGHTSTG_F0x800934F0).
    debugGauge: () => (battle ? {
      gauge: Math.round(battle.player.gauge ?? 0),
      cel: dvGaugeCel(battle.player.gauge, (Math.trunc((battle._hudClock || 0) * HUD_CLOCK_HZ) >> 2) & 3),
      width: dvGaugeWidth(battle.player.gauge),
      anchor: { ...DV_GAUGE_ANCHOR },
      // The ported block's own four calls: the two frame cels, the black trough and
      // the fill, in the original's order (web/battlehud-translated.js).
      frame: USE_TRANSLATED_HUD ? battleHudDvFrame({
        gauge: battle.player.gauge,
        tick: Math.trunc((battle._hudClock || 0) * HUD_CLOCK_HZ),
        slot: battle.activePlayerIndex ?? 0,
      }) : null,
    } : null),
    // Debug read-out for the 100x60 picture box (layer key 0x1009): which side's
    // close-up it currently shows, its viewport, and WHICH model record that
    // close-up was taken out of beside both fighters' own model keys — the box's
    // subject is the player's fighter whoever is speaking (§6.2 of
    // docs/research/battle/battle-hud-ownership-check-2026-10-03.md), and that is
    // what tools/verify_battle_face_speaker.mjs asserts.
    debugFaceCam: () => ({
      speaker: renderer3d?.getFaceCamSpeaker?.() ?? null,
      rect: renderer3d?.getFaceCamRect?.() ?? null,
      subject: renderer3d?.getFaceBoxSubject?.() ?? null,
    }),
    // Headless read-out of the plate's two names and the slash between the HP
    // numbers (FIGHTSTG_F0x80093364 and F0x80093a74's build arm).
    debugPlateLabels: () => (battle && USE_TRANSLATED_HUD ? battleHudPlateLabelsFor(battle) : null) };
}

/**
 * The disc's special-encounter finalizer for the PLAYER's own landed damage, run exactly
 * where WFIGHTMN runs it: `0x800aabf0` (`asm/dw2003/pro/wfightmn.s:5003-5072`, file
 * `.L0x00004e10`), reached from the sub-action attack runner's damage tail once the method
 * at `+0x90` has stored the hit value. It reads the battle-mode word `0x800a4536`
 * (`specialBattleMode`, chosen from the exact field-screen/battle-id pair):
 *
 *   modes 1/2, player→enemy: the enemy's HP is FLOORED at `max/11`, so a scripted boss the
 *       story needs alive CANNOT be killed (s415 Bulbmon, s480 Jungle Grave Zanbamon — the
 *       "there is no way to beat him here" first encounter, docs/research/story-progression/
 *       WALKTHROUGH_FULL.txt:2989);
 *   mode 3, player→enemy: the player's damage is nullified (s206 Amaterasu Knightmon);
 *   mode 0 and 4, and every enemy→player hit: unchanged.
 *
 * The rule was ported (`engine/dw3/battle-formulas.ts` `specialModeDamage`) but wired only
 * into the item path (`engine/dw3/battle-items.ts`), so an ordinary Fight / technique / DNA
 * hit never met it and every special encounter could be WON in our build. This is the one
 * shared point the three player→enemy damage sites now call — never a per-battle special
 * case. Its regression test is tests/battle-special-mode.test.js.
 */
function finalizePlayerDamage(b, total) {
  const mode = b.specialMode ?? 0;
  if (!mode) return total;
  return specialModeDamage(mode, true, b.enemy.hp, b.enemy.maxHp, total, 1);
}

