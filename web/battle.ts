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
// Flee (Run) chance: F0x800a1608 side 0 — a 0..127 roll under
//   (base+1)*8 + level advantage + speed advantage (only when faster) + Runner bonus,
//   refused outright by the encounter byte 0x80042b65, Sleep/tech-abort; Frozen halves
//   the base. (The 8·SPD_self/SPD_enemy at wfightmn 0x1320 is a routine the Run never
//   executes — claim wfightmn-0x1320-ratio-block-is-not-the-player-run-path-2026-10-09.)
//
// HP for non-starter Digimon (id 9-55): game stores hp=1, growth=1 (level-derived).
//   We use: hp = 80 + str * level  (approximation; real formula in Unknown4 init code)

import { asButton } from "./input.js";
import { emit as emitGameEvent } from "./gameEvents.js";
import { createBattle3D, resolveModelFolder, setFighterTint, clampFighterScale } from "./battle3d.js";
import { createBattleCommandTranslated, battleAilmentByte } from "./battlecmd-translated.js";
import { createBattleTechTranslated } from "./battletech-translated.js";
import { createBattleItemTranslated } from "./battleitem-translated.js";
import { createBattleTagTranslated } from "./battletag-translated.js";
import { createBattleFormTranslated } from "./battleform-translated.js";
import { createBattleDnaTranslated } from "./battledna-translated.js";
import { battleHudBarColors, battleHudDvFrame, battleHudDvPaint, battleHudEnemyRecords, battleHudPartyPips, battleHudPlayerRecords } from "./battlehud-translated.js";
import { battleMsgBank, battleMsgBankSync, battleMsgPaint, battleMsgText } from "./battlemsg-translated.js";
import { createWfightTranslated } from "./wfight-translated.js";
// NEW content (F2 -> Extras -> "Fusion bosses", off by default): two real species blending
// into one fighter. Pure rules in web/fusion.js; the authored boss + its new technique are
// built into web/fusion_bosses.json by tools/build_fusion_bosses.py.
import { fusedRecord, fusionEnabled, fusionOnDefeat, mergeFusionSkills, mergeLabBosses, partyEntriesFor } from "./fusion.js";
// Both halves' loot (same F2 key, off by default): the fused body rolls the OTHER
// halves' real drops — never the body's own row a second time. Pure rules in
// web/fusion-loot.js.
import { rollFusionDrops } from "./fusion-loot.js";
// enemies.json drop names are compact ("ArmorChip"); the item table is keyed by display name.
import { itemForDropName } from "./drop-item.js";
import { drawEffects, effectsBlendBackdrop } from "./fight/effect-player.js";
import {
  createBattleLayer, showBattleLayer, releaseBattleLayer, takeBackdropBlends, noteBackdropBlend, layerFrameOk,
} from "./battle-layer.js";
import { isThrowItem } from "./fight/fight-tables.js";
import { contactDamager } from "./fight/contact-damage.js";
// NEW content (F2 -> Extras -> "Boss phases", off by default): an authored fusion boss
// breathes twice. Pure rules in web/boss-phase.js; the phases themselves are authored in
// data/authored/fusion_bosses.json and built into web/fusion_bosses.json.
import { phaseFor, phaseRows, phaseEffects } from "./boss-phase.js";
// Disc-accurate hit & drop rolls (always on, no F2 switch): the technique record's own
// +0x06 accuracy byte (`elemCtx`) on the skill merge, and the disc's own enemy drop draw
// (`RAND_U16() % 1024 < drop_rate + 1`, wfightmn 0x1f84). Pure rules in web/tech-record.js.
import { mergeTechRecord, rollBattleDrop } from "./tech-record.js";
import { battleDelta, battleSpeedOn } from "./battle-speed.js";
import { drawBlastCurtain, drawBlastFlash, digivolveDemoOn } from "./blast-presentation.js";
import { assignAssetImage } from "./assets.js";
// F2 -> Battle -> "Enemy tells" (the every-Nth countdown) and "Pattern breaker" (those
// rows one turn early), both off by default: pure rules in web/enemy-tells.js.
import { nearestTell, tellText } from "./enemy-tells.js";
import { physicalBase, magicalBase, resolveDamage, rollHit, rollMagicHit, fleeChance, drainHeal, RAND_U16, hitGaugeGain, levelTier, counterCrestProc, enemyFleeProc, runAwayLine, blastPresentationState, BLAST_FIRST_FRAME, DV_TASK_START_FRAME, FormChangeProgram, formChangeState, formChangeSoundFrame, formChangeMusicFrame, evolEffectsDue, statusRoll, enemyMoveCondition, pickEnemyAiMove, elementId, enemyActionSkillId, basicAttackHitCount, techniqueMpCost, multiHitReset, DAMAGE_TERM_REPEAT_WORD, pickEncounter, specialBattleMode, specialModeDamage, specialModeLowHpEscape, useBattleItem, isBattleEffectItem, itemUsableInBattle, battleFormIds, tagCandidateIndices, chargeHealPage, chargeNoEffectPage, itemAnnouncementPage, storeAddItem, storeRemoveItem, heldCount, listItemIds, zoneAt, zoneRateLevel, stageZoneBlocks, scriptedScreenId, activeKoResolution, canPayDnaCost, dnaRejection, dnaActionRecord, dnaPairing, dnaAnswerAction, dnaAnswerForm, dnaTagBranchKind, DNA_COMBATANT_STRIDE, DNA_PRICE_STRIDE, DNA_PRICES, DNA_SPECIES_TABLE, walkerProfileRow, partyPositionRosterSlot, jokeFlavorPick, JOKE_GAG_NAME_ID, confusionGagRoll, resolveCounterBlow as engineResolveCounterBlow, addStatPenalty, statPenaltyOf, battleMessagePage, damageTermCategory4Arm, damageTermHealAmount, damageTermPage, damageTermAffinityArm, damageTermAffinityByte, damageTermAffinityMultiplier, damageTermMpMoved, RESULT_QUEUE, DAMAGE_TERM_FLEE_LOCK_RECORD, emptyStatusEventPool, statusEventLockHeld, equipmentBonuses, weaponCritByte, crestSuppressedByWeapon, wornFamilyBytes, elementValue, battleCoreStat, combatantElements, AILMENT_INFLICT, ailmentTurnStartMessageSpec as engineAilmentTurnStartMessageSpec, poisonTickMessageSpec as enginePoisonTickMessageSpec, regenTickMessageSpec as engineRegenTickMessageSpec, frozenGateBlocksTurn, initialActorTimeline, scheduleNextActor, advanceAilmentTimeline, cardmonBooster, MONEY_CAP, rosterSlotOfCharId, faceBezelCelDraw, stealProc, spawnFightTask, spawnPlateHud, FIGHT_TASK_ARG_BYTE_OFF, FIGHT_TASK_ARG_WORD_OFF, BATTLE_MESSAGE_CLOSE_BIT, BATTLE_MESSAGE_PRESS_SOUND, BattleMessageSession, newOpeningState, stepOpeningPhase, openingLineRoll, ambushRoll, introVariantFor, OPENING_PHASES, OPENING_PHASE_COUNT, openingPhaseFor, FINALE_MSG_BODY, FINALE_MSG_LEARNED, FINALE_HEAD_ATTACK_ID, BATTLE_WIN_RESULT_SCREEN, FINALE_WIN_ENDING_MOVIE, battleWinLaunchCode, battleWinJinglePlays, FINALE_TAIL_DEFEAT_BEATS, finaleRecordsTechnique, finaleCopiedAttackSkill, isFormDigimonId, rosterSlotOfDigimonId } from "./vendor/engine.js";
// Three fight mechanisms wired onto the ordinary route above, each an engine port of the
// original fightstg routine: the face-box cel draw (FIGHTSTG_F0x80093fec), the enemy-id
// resolver (FIGHTSTG_F0x8009b864/F0x8009b8d0) and the steal roll (FIGHTSTG_F0x800a1114).
// The two fight-task spawners (engine/dw3/battle-task-spawn.ts) are wired too: the fight
// task F0x80090c44 (the acting fighter's action object, its tick the technique record
// machine) and its data variant the plate-HUD spawner F0x80093cc8.
import { ui, scaledStat, battleStats } from "./vendor/engine.js";
import { CHARID_TO_DIGID, baseStatsFor, elementPointsWithGear } from "./party.js";
import { loadPack, drawClip, clipSize, packReady, drawClipAtPaletteRow } from "./screenpack.js";
import { drawText as uiDrawText, drawIconGlyph, fontReady as uiFontReady } from "./uifont.js";
import * as uiC from "./ui-c/index.js";
import { partHook as uiCPart } from "./ui-c/capture.js";
import { composeBattle } from "./ui-c/battlehud.js";
import { drawItemIcon, itemFamily } from "./itemicons.js";
import { scaleEnemyStat } from "./enemy-stats.js";
import {
  enemySwitchTarget, enemySelfTagPick, enemyTeamSlots, firstAliveEnemySlot,
  ENEMY_SWITCH_MSG_TAKING_OUT, ENTRANCE_TASK_END_FRAME,
} from "./enemy-switch.js";
import {
  COLS,
  COMMAND_COUNT,
  DV_GAUGE_MAX,
  FIGHT_UI_CLIPS,
  TAG_PRESENTATION,
  battleTechWords,
  currentMenuItems,
  dnaClip12Chunks,
  jokeMenuRows,
  listPageHint,
  normalizeDvGauge,
} from "./battle/layout.js";
import {
  DNA_PARENT_CLIP,
  DNA_RESULT_TABLE,
  MSG,
  MSG_KIND,
  ST,
  canonicalProfileName,
  dnaFusedForm,
  faceBoxHudEvents,
  jokeGagMessageSpec,
  restoreWalkerSentence,
  scriptedWalkerSentence,
} from "./battle/messages.js";
import {
  applyFormLearnPass,
  applyGiantScales,
  battleKindOf,
  battleOutcomeRelease,
  blastLandingHeal,
  blastTargetProfile,
  commitBattleFormChange,
  enemyVitals,
  equippedTriple,
  finalBossPhaseSwitchesTrack,
  gauntletNext,
  giantModeOn,
  markFormTaken,
  markedEquippedForms,
  partyEntriesWithSize,
  persistPlayerGauge,
  releaseReservedSecondForm,
  setLiveBattleForm,
  syncPlayerRoster,
  writeBackBattleVitals,
} from "./battle/form-blast.js";
import { S } from "./battle/state.js";
import {
  DV_GAUGE_ANCHOR,
  HUD_CLOCK_HZ,
  battleHudPlateLabelsFor,
  commandPhaseWaitsForLine,
  createHpPlateState,
  dvGaugeCel,
  dvGaugeLength,
  dvGaugeWidth,
  enemyMsgName,
  enemyStatRecordFor,
  fighterBaseStance,
  hpBarColors,
  hpBarFillRect,
  hpBarLength,
  hpPlateShown,
  hpPlateTick,
  lowHpStance,
  partyPipCels,
} from "./battle/hud.js";
import {
  ailmentBoxPage,
  applyWeaponSecondary,
  attackPageSpec,
  chooseResultLine,
  dnaResultAttack,
  effStats,
  evadePageSpec,
  noteHit,
  processTurnStart,
  resolveAttack,
  resolveMultiHit,
  tryInflict,
} from "./battle/hit-results.js";
import {
  applyLevelUp,
  autoEquipForm,
  bankFormDvexp,
  dvLevelForExp,
  dvexpGain,
  dvexpShareCount,
  ensureStoredStats,
  levelForExp,
  levelUpGrowthProfile,
  levelUpThreshold,
  nextUnlockedEvolution,
  paidParticipants,
  treeCandidatesFor,
  winBattleRewards,
} from "./battle/progress.js";
import {
  applyStatDebuffDispatch,
  battleRestorePlanFor,
  castFieldTechnique,
  clearActionAffinity,
} from "./battle/restore.js";
import {
  activeSlotOf,
  battleScriptedPlanFor,
  effectiveSpd,
  forcedDedigivolveLanded,
} from "./battle/plans.js";
import { applyPostHitDispatch, battleStatusEventAdvance } from "./battle/status.js";
import {
  buildFightReportPages,
  buildFightReportRows,
  expCountDisplayed,
  fightReportCycleRow,
  fightReportGroupCount,
  fightReportGroupGeom,
  fightReportMarkedSlot,
  fightReportPortraitClip,
  fightReportRampRow,
} from "./battle/report.js";
import { makeOpening } from "./battle/core/opening.js";
import { makeLoad } from "./battle/core/load.js";
import { makeRecords } from "./battle/core/records.js";
import { makeStart } from "./battle/core/start.js";
import { makeDna } from "./battle/core/dna.js";
import { makeFusion } from "./battle/core/fusion.js";
import { makeCounter } from "./battle/core/counter.js";
import { makeFlow } from "./battle/core/flow.js";
import { makeMessage } from "./battle/core/message.js";
import { makeUpdate } from "./battle/core/update.js";
import { makePlayerAction } from "./battle/core/player-action.js";
import { makeEnemyAction } from "./battle/core/enemy-action.js";
import { makeFinale } from "./battle/core/finale.js";
import { makeEnd } from "./battle/core/end.js";
import { makeMenus } from "./battle/core/menus.js";
import { makeForms } from "./battle/core/forms.js";
import { makeInput } from "./battle/core/input.js";
import { makeNative } from "./battle/core/native.js";
import { makeHud } from "./battle/core/hud.js";
import { makeReport } from "./battle/core/report.js";
import { makeDraw } from "./battle/core/draw.js";
// moved by tools/rewrite/split.mjs: still exported from here
export {
  BATTLE_COMMANDS,
  DV_GAUGE_MAX,
  TAG_PRESENTATION,
  battleTechWords,
  commandLabelPos,
  currentMenuItems,
  dnaClip12Chunks,
  jokeMenuRows,
  listPageHint,
  normalizeDvGauge,
} from "./battle/layout.js";
export {
  applyFormLearnPass,
  applyGiantScales,
  battleOutcomeRelease,
  blastLandingHeal,
  blastTargetProfile,
  commitBattleFormChange,
  endBlast,
  enemyVitals,
  finalBossPhaseSwitchesTrack,
  gauntletNext,
  markFormTaken,
  markedEquippedForms,
  partyEntriesWithSize,
  persistPlayerGauge,
  releaseReservedSecondForm,
  setLiveBattleForm,
  syncPlayerRoster,
  writeBackBattleVitals,
} from "./battle/form-blast.js";
export {
  FORM_PAGE_KINDS,
  buildFightReportPages,
  buildFightReportRows,
  expCountDisplayed,
  expCountStep,
  fightReportCycleRow,
  fightReportGroupCount,
  fightReportGroupGeom,
  fightReportMarkedSlot,
  fightReportPortraitClip,
  fightReportRampRow,
} from "./battle/report.js";
export {
  AILMENT_MARKER_ROW_Y,
  MSG,
  MSG_KIND,
  ailmentMarker,
  ailmentMessageId,
  ailmentWord,
  canonicalProfileName,
  chargeWalkerSentence,
  dnaFusedForm,
  faceBoxHudEvents,
  jokeGagMessageSpec,
  restoreWalkerSentence,
  scriptedWalkerSentence,
} from "./battle/messages.js";
export {
  BITADAPTER_ID,
  EQUIP_SLOTS,
  EXPADAPTER_ID,
  applyLevelUp,
  applyLevelUpGains,
  autoEquipForm,
  bankFormDvexp,
  battleRewardFor,
  dvLevelForExp,
  dvexpGain,
  dvexpShareCount,
  ensureStoredStats,
  expShare,
  levelForExp,
  levelUpGrowthProfile,
  levelUpThreshold,
  nextUnlockedEvolution,
  paidParticipants,
  rollLevelUpGains,
  seedStoredStats,
  winBattleRewards,
} from "./battle/progress.js";
export {
  applyGymEffects,
  gymDrillsForRank,
  gymRepPercent,
  gymRepResults,
  gymSessionResult,
  gymStatForId,
  gymTrainingResult,
  ultraChanceRoll,
} from "./battle/gym.js";
export {
  ailmentBoxPage,
  applyAilment,
  applyWeaponSecondary,
  attackPageSpec,
  chooseResultLine,
  dnaResultAttack,
  effStats,
  evadePageSpec,
  foldElemBonuses,
  lastHitNote,
  processTurnStart,
  resolveAttack,
  resolveMultiHit,
  tryInflict,
  weaponSecondaryProc,
} from "./battle/hit-results.js";
export {
  applyBattleRestorePlan,
  applyStatDebuffDispatch,
  battleRestoreParty,
  battleRestorePlanFor,
  battleRestoreTargets,
  castFieldTechnique,
  clearActionAffinity,
} from "./battle/restore.js";
export { battleAffinityPlanFor, battleScriptedPlanFor, forcedDedigivolveLanded } from "./battle/plans.js";
export { applyPostHitDispatch, battleStatusEventAdvance } from "./battle/status.js";
export {
  DV_GAUGE_ANCHOR,
  HP_BAR_COLORS,
  HUD_CLOCK_HZ,
  battleHudPlateLabelsFor,
  commandPhaseWaitsForLine,
  dvGaugeCel,
  dvGaugeLength,
  dvGaugeWidth,
  fighterBaseStance,
  hpBarColors,
  hpBarFillRect,
  hpBarLength,
  lowHpStance,
  partyPipCels,
} from "./battle/hud.js";

// Native post-battle fight-report chrome (stfgtrep overlay). See
// docs/research/ui/stfgtrep-decoded-2026-07-12.md — the census row asking
// "is stfgtrep the post-battle EXP screen?" is CONFIRMED yes; this replaces
// the previously hand-guessed win/lose panel text with real stfrpt screen-
// pack art + real label coordinates (tools/extract_stfgtrep_ui.py).
export const stfrptChrome = loadPack("stfrpt");
export const pgfgc00 = loadPack("pgfgc00");
// CMFONT, the pack pro/fightstg's message panel uses for its blinking "press Circle"
// glyph (handle 0x02860000 -- web/dialogue-translated.js:15 carries the same mapping).
export const cmfont = loadPack("cmfont");
export let REPORT_LAYOUT = null;
fetch("assets/data/stfgtrep_ui.json").then((r) => r.json()).then((j) => { REPORT_LAYOUT = j; }).catch(() => {});

// Original 4bpp fight UI texture page decoded from the true GPU VRAM in
// visible Redux slot 7: tpage (512,0), CLUT (512,250). Every frame below is a
// source rectangle from this raw PS1 atlas; none are framebuffer screenshots.
export let fightUiAtlas = null;
if (typeof Image !== "undefined") {
  const im = new Image();
  im.onload = () => { fightUiAtlas = im; };
  assignAssetImage(im, "assets/ui/fight_ui.png?v=tpage512-clut512x250");
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
  // 0x30. The hand-drawn fallback path below keeps its own anchors.
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

// ── Pure stat scaling + evolution logic (module-level so it is unit-testable) ──
// One home: engine/dw3/battle-stats.ts. Its formulas are pulled in through the vendored
// bundle — `scaledStat` is a top-level export there, the other three ride the
// `battleStats` namespace (engine/index.ts:629 `export * as battleStats`; only
// scaledStat/partyCharismaTotal are also named at engine/index.ts:630). Re-exported
// here because web/glossary-digimon.js, web/debugPanel.js and the tests import them
// from this module; do not define a second copy.
const { scaledHp, scaledMp, evolvedMaxStats } = battleStats;
export { scaledStat, scaledHp, scaledMp, evolvedMaxStats };

export { damageTermCategory4Arm as category4ArmFor };

export { AILMENT_INFLICT };
export function createBattle(canvas, ctx, getState, sfx = null, bgm = null) {
  const B = {};
  B.canvas = canvas;
  B.ctx = ctx;
  B.getState = getState;
  B.sfx = sfx;
  B.bgm = bgm;
  Object.assign(B, makeOpening(B), makeLoad(B), makeRecords(B), makeStart(B), makeDna(B), makeFusion(B), makeCounter(B), makeFlow(B), makeMessage(B), makeUpdate(B), makePlayerAction(B), makeEnemyAction(B), makeFinale(B), makeEnd(B), makeMenus(B), makeForms(B), makeInput(B), makeNative(B), makeHud(B), makeReport(B), makeDraw(B));
  Object.assign(B, { loadData });
  const { applyEvolution, availableEvolutions, coopSetEnemyHp, coversField, draw, encounterRateLevel, endBattle, evoTargets, getPlayerProfile, handleKey, initializePartyStats, isActive, loadFusionData, mpKit, onBattleResize, partnerInfo, partyForScreen, peek, pickEnemy, rollEncounter, scriptedScreen, start, startParty, startRandom, startScreen, statusEventQueueAdvance, triggersForStage, update } = B;
  B.battle = null; // active battle data
  // Step F: the six-row command list runs the translated pro/fightstg list
  // (web/battlecmd-translated.js, engine FightCommandSession). The walker keeps
  // the 3D scene and the HP plates; the list owns its highlight, marker and
  // confirm.
  // Step F: the HP plate's party markers, bar fill and number row run the
  // translated pro/fightstg routine (engine/dw3/ui/native/battle-hud.ts, painted by
  // web/battlehud-translated.js).
  // The in-battle message line runs the translated pro/fightstg panel
  // (engine/dw3/ui/native/battle-message-line.ts, painted by
  // web/battlemsg-translated.js): the chrome pack's own window picture at native
  // (11, 188), the two lines at (20, 194) and (20, 208), the second three display
  // ticks after the first, and the blinking prompt at (291, 208) until Circle.
  B.msgSession = new BattleMessageSession({
    textOf: battleMsgText, paint: () => {},
    // The reveal machine's phase-3 press blip: `lui $a0, 0x4` with `ori $a0, 0x1c`
    // in the `jalr` delay slot (pro/fightstg.s .L0x80098bd4) — SYSTEM07 0x4001C
    // through [0x80055C48], the same confirm blip the menus play. Every battle
    // line sounds it on the Circle press that reads it, "Annihilated..." included.
    playSound: (id) => { if ((id >>> 0) === BATTLE_MESSAGE_PRESS_SOUND) sfx?.play("system07"); },
  });
  // The battle's OPENING PHASE MACHINE (engine/dw3/battle-opening-machine.ts), the
  // port of pro/wfightmn's #2 arm (F0x800a6c44): the seven phases whose exit hands
  // the fight to the turn machinery. `?introNoLine=1` forces the
  // phase-1 opening-line gate to "no line" so the phase-5 EXIT can be observed.
  B.FORCE_INTRO_NO_LINE = typeof location !== "undefined"
    && new URLSearchParams(location.search).has("introNoLine");
  // The pad word the session's close rule reads: only bit 0x2000 (Circle) matters.
  B.msgPadWords = 0;
  // The original counts the display ticks `[0x8005df98]()` returns. The repo's decoded
  // display tick chain (engine/dw3/ui/pad-words.ts MenuDisplayClock,
  // UI-DISPLAY-TICK-CHAIN-2026-08-21) advances 0x133 of a tick per 50 Hz PAL field tick,
  // i.e. 256/307 of it = 60.4 Hz, which is the rate the message line's rules are stated
  // in: the second line after 3 ticks, the glyph one frame every 4.
  B.msgClock = new ui.MenuDisplayClock();
  B.commandNative = createBattleCommandTranslated(sfx, { getState });
  // Step F, TECH screen: the six-row technique list runs the translated
  // pro/fightstg screen (web/battletech-translated.js, engine
  // FightTechSession) with its own paging, greyed unaffordable rows, page
  // arrows, description pane and marker highlight.
  B.techNative = createBattleTechTranslated(sfx, { getState });
  // The ITEM screen: the translated pro/fightstg list owns the surface from the
  // frame the ITEM command is chosen, with the original's seven rows a page,
  // clamped pages, the quantity the player is carrying, page arrows, the
  // description pane and the marker highlight.
  B.itemNative = createBattleItemTranslated(sfx, { getState });
  // The TAG partner list: the translated pro/fightstg screen (F0x80097498, built
  // by F0x80097984) owns the surface from the frame the Tag command is chosen.
  // It lists the two partners that are not the acting member, keeps a knocked-out
  // partner listed with a grey plate the cursor cannot confirm, clamps the cursor,
  // answers Cross as a cancel only when the battle may cancel, and returns the
  // chosen party slot.
  B.tagNative = createBattleTagTranslated(sfx, { getState });
  // The Digivolve panel's seven elemental values, in the order the game's own
  // stat ids run (record +0x34.. fire, water, ice, wind, thunder, machine, dark).
  B.FORM_ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
  // Step H, Digivolve form list: pro/fightstg's own 0x80094478 screen (one row per
  // form the acting Digimon can take, its current form greyed out, the cursor
  // clamped at the ends, L1/R1 paging the paged stat panel and Circle refusing the
  // form the Digimon is already in). It answers with the species id the original
  // writes into the command screen's parked word, and the battle then runs the
  // walker's own DV commit, so the two routes cannot drift.
  B.formNative = createBattleFormTranslated(sfx, { getState });
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
  // seats the pane directly.
  // The follow-up both Tag and DNA commands land on: the translated pane from
  // F0x800980E4 (web/battledna-translated.js, engine FightDnaSession). It is
  // the original's ONE object, so this single adapter serves the DNA command and
  // the Tag follow-up alike: with a DNA pairing it shows the result-species
  // strip plus "Switch" and "DNA DV" with the Jogress price, and without one the
  // "Switch" row on its own.
  B.dnaNative = createBattleDnaTranslated(sfx, { getState });
  // Step G: pro/wfightmn's boot loader (it asks the cache for the scene packs,
  // uploads them to VRAM and retires) runs as the translated loader task
  // (web/wfight-translated.js, engine WfightLoaderSession). The walker keeps the
  // turn loop, the 3D scene and the HUD.
  B.wfightNative = createWfightTranslated({ getState });
  // Production hand-off for the post-fight results screen (Phase 6.3). When a
  // host sets it, the victory "report" phase opens the native pro/stfgtrep
  // screen instead of drawing the inline report; the screen pays the BIT and
  // the dropped item, and its close calls finishNativeReport(). Left null, the
  // hand-authored inline report runs exactly as before.
  B.reportHandoff = null;
  // The finale's win exit (wfightmn.s:2165-2174): when the win's launch cue is
  // the ending movie (0xE0B, kind 6), the host registers how to play it — movie
  // row 10 (MOVIEE01_STR), its return selector 0xE0C (row 11, MOVIEE02_STR),
  // then 0x2d7 (screen 727 = stage 780) — and calls finishEnding() when the
  // chain is done. The ordinary win's cue (0x1400, STFRPT) still goes through
  // reportHandoff; the two exits never both run.
  B.endingHandoff = null;
  // The field's battle handoff (F0x8008B798): the host registers what has to run
  // BEFORE a field battle starts. At story ordinal 43 that is the title overlay's
  // movie MOVIED08_STR (selector 0xE0A, whose own return selector is 0x600, the
  // battle); the host's handler resolves when the movie is over, and every other
  // ordinal resolves immediately. It hangs here, on startParty — the one funnel
  // all three field entry points (startScreen/startRandom/startParty) pass
  // through — because the original hangs it on the one battle setup every field
  // battle calls. See engine/dw3/screen-routing.ts `battleHandoff`.
  B.fieldMovieHandoff = null;

  // Loaded data (set by loadData())
  B.digimonDB = null; // array of digimon profiles by index (id-1)
  B.skillDB = null; // map of skill id → skill
  // Authentic field-encounter tables (see docs/research/battle-invocation.md):
  B.stageEncDB = null; // per-stage zone pools (stage_encounters.json)
  B.fieldEncDB = null; // global screen_id → enemy party (field_encounters.json)
  B.cardmonBoostersDB = null; // screen → Cardmon booster pack (cardmon_boosters.json)
  B.battleMusicDB = null; // stage → battle-trigger records incl. music tag (battle_music.json)
  B.progressionDB = null; // battle rewards + level-up + gym tables (progression.json)
  B.zoneGridDB = null; // per-stage zonecheck lookup grids (zone_grids.json)
  B.fightTechDB = null;
  B.dnaResultScript = null;
  B.jogressDB = null; // action id → fused species, from the disc's own director scripts

  B.enemiesDB = null; // map of enemy_id string → sdigiedt entry

  // 3D battle renderer: WebGL into its own <canvas> stacked under the game canvas (web/battle-layer.js).
  // An OffscreenCanvas, copied into the game canvas in draw(), is only the fallback for a page with no parent.
  B.renderer3d = null;
  B.offscreen3d = null;

  // ── Fullscreen battle ──
  // The field game and 2D UI lay out against the VIEW_W/VIEW_H *constants* in game.js
  // (640×480), never canvas.width — so we can grow the shared canvas to the display
  // resolution for a crisp fullscreen battle and restore it when the battle ends.
  B.BATTLE_REF_W = 640;
  B.BATTLE_REF_H = 480; // logical UI layout space
  B._savedCanvas = null;

          window.addEventListener("resize", onBattleResize);

  // Battle state → camera shot. The decoded authentic idle camera (a director that cuts
  // between 5 canned shots) plays while picking a command — the states we captured live.
  // Actions are framed over-the-shoulder ("behind") with op5 script cuts overriding them;
  // intro uses "behind". WIN keeps the older orbit sweep. LOSE plays the original's own
  // defeat camera (FIGHTSTG_F0x8008c93c).
  B.DIRECTOR_STATES = new Set([
    ST.PLAYER_MENU, ST.PLAYER_TECH, ST.PLAYER_ITEM,
    ST.PLAYER_TAG, ST.PLAYER_DV, ST.PLAYER_DNA_CHOICE,
  ]);
  B.ORBIT_STATES = new Set([ST.WIN]);
  // Who owns the camera record, in the original's own terms. The battle's camera director
  // (FIGHTSTG_F0x8008718c) re-publishes its own record through the cut [0xf8] on every tick it
  // runs (fightstg.s:5096-5105), and on the confirm edge the command screen retires it — state
  // 3, then the object is FREED — so for the whole attack nothing re-publishes and the record
  // holds the retire cut. The walker no longer needs a state list for that: the renderer's
  // `directorRetired` (web/battle3d.js) is the director's own absence, and the coordinator
  // answers the script's ownership directly. Nothing here clears the record; the owner replaces
  // it. The `SCRIPT_OWNED_CAMERA_STATES` freeze list was removed 2026-10-08 (worker-bc) because
  // the retire makes it unnecessary; see `.dw3-research/camera-retire-implement-2026-10-08/`.
  /** The camera the loss beat shows: the original's close shot. */
  B.lossCameraMode = () => "defeat";
  /**
   * The walker's own wording for a battle-message bank index, used only as the panel's
   * identity key and when the bank has not loaded yet; the panel's words come from the
   * bank itself (web/battlemsg-translated.js).
   */
  B.LOSS_MESSAGE_WORDS = { 0x53: "Annihilated..." };

    async function loadData() {
    if (B.digimonDB) { await loadFusionData(); return; }
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
    B.battleMusicDB = bmj;
    B.progressionDB = prj;
    B.fightTechDB = ftj;
    B.dnaResultScript = dcj;
    B.jogressDB = jgj;
    B.digimonDB   = Object.fromEntries(dj.digimon.map(d => [d.id, d]));
    // The record's own raw bytes the formula leaves test: +0x0A the TECH_EFFECT_*
    // opcode (`dispatch` in the extracted table) and +0x0C its effect power (`crit`).
    // `effect`/`effect_p2` name only the subset with a decoded effect name; the raw
    // bytes cover all 443 rows, so a technique the name table misses still gets its
    // true crit/accuracy branch. The merge also carries +0x06 (`elemCtx`) as `base_acc`
    // (the disc's own accuracy byte; always on, pinned by tests/disc-rolls.test.js).
    B.skillDB     = Object.fromEntries(dj.skills.map(s => {
      const rec = ftj?.[String(s.id)];
      return [s.id, mergeTechRecord(s, rec, { useDiscAcc: true })];
    }));
    B.stageEncDB  = sej;
    B.fieldEncDB  = fej;
    B.cardmonBoostersDB = cbj;
    B.zoneGridDB  = zgj;
    B.enemiesDB   = Object.fromEntries(emj.enemies.map(e => [e.enemy_id, e]));
    // enemies.json rows 0..recordCount-1 are the records in scan order; any row past
    // that (the walker's all-zero "Null" placeholder) has no record in the original's
    // table, gets no name line, and keeps the species-name fallback.
    const enemyRows = esj?.records ?? [];
    S.enemyStatRecords = enemyRows.length > 0 ? enemyRows : null;
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
    S.enemyStatIdByName = nameToId;
    // The disc's EIGHT digivolution trees, one per roster slot, generated from the
    // overlay image itself by tools/extract_evolutions.py. There is deliberately no
    // index over them keyed by source form: the unlock routine reads the tree for a
    // roster slot and scans its 44 records in table order, and ./evo-trees.js ports
    // that. Which two Digimon may DNA, what it costs, which attack lands and which
    // form appears are four reads of disc data (dnaPairing + dnaActionRecord over the
    // profile and technique tables, and the model's own clip-12 director script).
    B.evolutionTrees = evj;
    await loadFusionData();
  }

  // NEW content (F2 -> Extras -> "Fusion bosses", off by default): the authored fusion
  // bosses and their new technique, built into web/fusion_bosses.json by
  // tools/build_fusion_bosses.py. With the switch off nothing is fetched, so the skill map
  // and every party entry are exactly today's. The switch is read when data loads, so
  // ticking it takes effect on the next battle that loads data.
  B.fusionDataTried = false;
  B.fusionBossesDB = null;
                                // The change task counts 60 Hz game ticks: the presentation frame advances 60 per second.
  B.BLAST_CAPTURE_HZ = 60;

                                                              /** Wire a damager to a renderer's contact callback: intermediate contacts pay a hit, the strike commits. */
  B.contactOnHit = (contact, commit) => (rec) => { if (contact.onHit(rec)) commit(); };

                        /**
   * The element NAME for a raw record byte +0x07. The raw technique table carries the
   * element id; the shipped skill bank carries the name. Build the id→name map from the
   * two shipped banks rather than hard-coding a table here.
   */
  B.elem1NameCache = null;
                                                                                                        // Resolve a digimon profile by display name (evolutions.json `to` → digimon.json profile).
  // Built lazily from digimonDB; returns null if the evolved form has no profile in our data.
  B._profileByName = null;
                // evolutionTrees: the disc's eight per-roster-slot trees (assets/data/evolutions.json).
  B.evolutionTrees = null;

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
  B.HUD_CELS_DECODED = new Set([
    0, 1, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x1e, 0x23, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b,
    0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
    0x3c, 0x3d, 0x3e, 0x3f,
  ]);
  B.hudCels = [];
                                                B.coopState = () => (B.battle?.enemy ? { index: B.battle.partyIndex | 0, hp: B.battle.enemy.hp, maxHp: B.battle.enemy.maxHp, count: B.battle.party?.length ?? 1,
    me: B.battle.player ? { name: B.battle.player.profile?.name ?? "", hp: B.battle.player.hp | 0, maxHp: B.battle.player.maxHp | 0 } : null } : null);
    return { isActive, coversField, start, startRandom, startParty, startScreen, scriptedScreen, partyForScreen, triggersForStage,
    rollEncounter, coopState: B.coopState, coopSetEnemyHp, mpKit,
    // Post-fight results hand-off (Phase 6.3): the host registers how to open
    // the native pro/stfgtrep screen, and calls finishNativeReport() when the
    // player leaves it, which returns to the field exactly like the inline
    // report's final confirm.
    setReportHandoff: (h) => { B.reportHandoff = h ?? null; },
    // The finale's win exit hand-off: the host registers how to play the ending
    // chain (movie row 10 MOVIEE01_STR, then its return selector 0xE0C = row 11
    // MOVIEE02_STR, then 0x2d7 = screen 727 = stage 780) and calls
    // finishEnding() when it is done — the kind-6 equivalent of the report
    // hand-off above (wfightmn.s:2165-2174).
    setEndingHandoff: (h) => { B.endingHandoff = h ?? null; },
    // The pre-battle presentation the field's handoff owes (F0x8008B798). The
    // host's handler returns a promise that resolves when it is over.
    setFieldMovieHandoff: (h) => { B.fieldMovieHandoff = h ?? null; },
    finishNativeReport: () => { if (B.battle) endBattle("win"); },
    finishEnding: () => { if (B.battle) endBattle("win"); },
    evoTargets, applyEvolution, initializePartyStats, partnerInfo, availableEvolutions,
    getPlayerProfile, update, draw, handleKey, pickEnemy, encounterRateLevel, loadData, peek,
    // The status-event pool itself, so a test can read the 99 x 28-byte queue the
    // original keeps at 0x800a3868 instead of a boolean the walker invented.
    debugStatusEvents: () => (B.battle?.statusEvents
      ?? []).map((e) => ({ ...e })),
    debugStatusEventQueueAdvance: (acted = "player") =>
      (B.battle ? statusEventQueueAdvance(B.battle) : []),
    // Headless read-out of the party pips' decoded cels (FIGHTSTG_F0x800934f0).
    debugPips: () => (B.battle ? partyPipCels(B.battle) : null),
    // Every cel the battle's own 2D layer drew since the last frame, with its place.
    debugHudCels: () => B.hudCels.map((c) => ({ ...c, ...(c.size || {}) })),
    // Headless read-out of the DV gauge's decoded sprite/width (FIGHTSTG_F0x800934F0).
    debugGauge: () => (B.battle ? {
      gauge: Math.round(B.battle.player.gauge ?? 0),
      cel: dvGaugeCel(B.battle.player.gauge, (Math.trunc((B.battle._hudClock || 0) * HUD_CLOCK_HZ) >> 2) & 3),
      width: dvGaugeWidth(B.battle.player.gauge),
      anchor: { ...DV_GAUGE_ANCHOR },
      // The ported block's own four calls: the two frame cels, the black trough and
      // the fill, in the original's order (web/battlehud-translated.js).
      frame: battleHudDvFrame({
        gauge: B.battle.player.gauge,
        tick: Math.trunc((B.battle._hudClock || 0) * HUD_CLOCK_HZ),
        slot: B.battle.activePlayerIndex ?? 0,
      }),
    } : null),
    // Debug read-out for the 100x60 picture box (layer key 0x1009): which side's
    // close-up it currently shows, its viewport, and WHICH model record that
    // close-up was taken out of beside both fighters' own model keys — the box's
    // subject is the player's fighter whoever is speaking (§6.2 of
    // docs/research/battle/battle-hud-ownership-check-2026-10-03.md), and that is
    // what tools/verify_battle_face_speaker.mjs asserts.
    debugFaceCam: () => ({
      speaker: B.renderer3d?.getFaceCamSpeaker?.() ?? null,
      rect: B.renderer3d?.getFaceCamRect?.() ?? null,
      subject: B.renderer3d?.getFaceBoxSubject?.() ?? null,
    }),
    // Headless read-out of the plate's two names and the slash between the HP
    // numbers (FIGHTSTG_F0x80093364 and F0x80093a74's build arm).
    debugPlateLabels: () => (B.battle ? battleHudPlateLabelsFor(B.battle) : null) };
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
export function finalizePlayerDamage(b, total) {
  const mode = b.specialMode ?? 0;
  if (!mode) return total;
  return specialModeDamage(mode, true, b.enemy.hp, b.enemy.maxHp, total, 1);
}

