export { scriptedScreenId } from './dw3/encounters.ts';
import type { Condition } from './core/types.ts';
export { STORY_COMMAND_BANKS, isStoryCommandBank, storyCommand, flagConditionPasses, type StoryCommand } from './systems/story-command-banks.ts';
import { type StoryCommand } from './systems/story-command-banks.ts';
import { GameState } from "./core/state/game-state.ts";
import { VariableManager } from "./core/state/variable-manager.ts";
import { ConditionEngine } from "./core/condition/condition-engine.ts";
import { ScriptVM, type RunHandle } from "./core/script/vm.ts";
import { EventManager, type RaiseOptions } from "./core/event/event-manager.ts";
import { ContentDB } from "./core/content/content-db.ts";
import {
  DW3_BANK_SCHEME,
  registerDw3Flags,
  registerDw3Conditions,
  registerDw3Commands,
  type RosterPredTable,
} from "./dw3/dw3-config.ts";
import type { ConvertedStage } from "../tools/engine-convert/lib.ts";
import type { FlagId, Instruction } from "./core/types.ts";
import { createBattleManager, type BattleManager, type TurnActor } from "./systems/battle-manager.ts";
import * as combat from "./dw3/battle-combat.ts";

// Re-export the ported gameplay systems so the browser bundle (web/vendor/engine.js) is the
// single source of truth. Host-bound managers (cutscene/trigger/shop) are constructed in the
// browser with real renderers/data; the pure BattleManager is owned by GameEngine below.
export { createTriggerSystem } from "./systems/trigger-system.ts";
// The native-event family census: which shared translated handler runs each of the 69
// stage events that carry no bytecode of their own. See engine/systems/native-event-families.ts.
export {
  NATIVE_EVENT_FAMILIES, nativeEventFamily, nativeEventInfo,
  nativeEventMembers, nativeEventDispositions,
  type NativeEventFamily, type NativeEventDisposition, type NativeEventFamilyInfo,
} from "./systems/native-event-families.ts";
// The Bug-Maze switch commands (s745/s746) — the "darkSwitch" family's translated handler.
export {
  DUNGEON_SWITCH_OBJECT_TYPE, DUNGEON_SWITCH_LATCH, DUNGEON_SWITCH_SOUND,
  DUNGEON_SWITCH_COMMANDS, dungeonSwitchCommand,
  newPadSwitchObject, applyDungeonSwitchCommand, padSwitchObjectTick,
  type DungeonSwitchCommand, type PadSwitchObject, type DungeonSwitchResult,
} from "./systems/dungeon-switch.ts";
export {
  INDICATOR_KIND, SETUP_OPS, PLAYBACK_OPS, PLAYBACK_ACTIVE_OPS,
  indicatorKindForOp, arrowKind, execStepOp, execStepRecord,
  execPlaybackOp, execPlaybackRecord,
  isLadderPlayback, ladderMountFacing, isStageChangePlayback, isDivePlayback, handoffHold,
  launcherRouteWords,
  ladderClimbPlan, ladderClimbPosition, ladderDismountEnd,
  type LadderEnd, type LadderClimbPlan,
  OP6_PARTY_SLOT, OP6_CLEARED_OFFSET,
  type StepOpRecord, type StepOpEffect, type DecodedSetupOp, type DecodedPlaybackOp,
  type PlaybackEffect, type PlaybackActorCall, type PlaybackHandoff,
} from "./systems/scene-step-ops.ts";
export type {
  Step, StepGrid, ZoneRuns, StepEnableTable, StoryEvent, StoryProgram, StepSample,
  StepIndicator, StepPlayback, TriggerDeps, TriggerSystem,
} from "./systems/trigger-system.ts";
export {
  ROUTE_KEY_OFFSET, ROUTE_COMPANION_OFFSET, ROUTE_PAIR_BANK, ROUTE_PAIR_INDEX_MASK,
  ROUTE_PAIR_KEY_BAND, ROUTE_PAIR_KEY_BIAS, ROUTE_PAIR_COMPANION_BIAS,
  ROUTE_PAIR_PARAM_FIELDS, ROUTE_PAIR_PUBLISH_OPS,
  publishesRoutePair, routePairFromParams, routePairTarget,
  routePairPredicate, routePairTest, routePairFlagId, routePairCommit,
  type RoutePair, type RoutePairExit,
} from "./systems/route-pair.ts";
// The places system: a stage's exits re-aim per the place you entered from
// (copyPlacePoints, 34 stage overlays). Ledger: places-copy-place-points-family-2026-10-10.
export {
  copyPlacePoints, placePointPair, aimPlacePoints,
  type PlacePoint, type PlacePointEntry, type StagePlacePoints, type PlaceAimRow,
} from "./systems/place-points.ts";
export {
  FIELD_TICK_RATE, FIELD_TICK_SECONDS,
  FIELD_WALK_MAGNITUDE, FIELD_RUN_MAGNITUDE,
  FIELD_WALK_STEP, FIELD_WALK_SPEED, FIELD_RUN_STEP, FIELD_RUN_SPEED,
  FIELD_IDLE_CLIP, FIELD_WALK_CLIP, FIELD_RUN_CLIP, FIELD_STOP_CLIP,
  FIELD_DIRECTION_SCALE, fieldDirectionDelta, fieldPureDirectionDelta, fieldDirectionFromIndex, fieldDirectionIndex, oppositeDirection,
  FOLLOWER_HISTORY_LENGTH, FOLLOWER_LAG_TICKS,
  seedFollowerHistory, pushFollowerHistory, followerHistorySample, followerGatherSample, consumeFieldTicks,
  FIELD_FOOTPRINT_OFFSETS, actorFootprintBlocked,
  FIELD_PROBE_OFFSETS, FIELD_PROBE_INDEX, FIELD_PROBE_FLAGS,
  fieldProbeOffsets, fieldProbePushback, applyObstaclePush,
  type FieldDirection, type FieldTrailPoint,
} from "./systems/field-movement.ts";
// THE live field character: the resident object the field overlay registers as
// name 5, whose +0x50/+0x54 are its world X and Y in 16.8 fixed point. Three
// stage objects drive that one word (s926's `rise` row, s680's lane drive and
// s261's two-slot clip machine), so it is ported once here rather than three
// times over. See engine/systems/field-character.ts.
export {
  FIELD_CHAR_ONE_PIXEL, FIELD_CHAR_SHIFT,
  fieldCharY, fieldCharAddY, fieldCharSetY, fieldCharPendingPixels,
  resetFieldChar, fieldCharState,
} from "./systems/field-character.ts";
export {
  PLAYER_PACK_PLAY, PLAYER_PACK_KICK, PLAYER_PACK_FISHING,
  PLAYER_PACK_SLOPE, PLAYER_PACK_LADDER,
  PLAYER_CLIP_PACK_ARMS, PLAYER_CLIP_PACKS,
  playerPackForClip, playerPackArmForClip, playerPackHandleForClip,
  type PlayerClipPackArm,
} from "./systems/player-clip-packs.ts";
export {
  DISPLAY_TABLE, TICK_CELL, DELTA_CELL, TICK_ACCUMULATOR, DELTA_ACCUMULATOR,
  AUX_ACCUMULATOR, AUX_CELL, VIDEO_MODE_WORD, STEP_NTSC, STEP_PAL,
  PUBLISH_SHIFT, REMAINDER_MASK,
  FrameClock, frameClock, advanceFrameClock, feedFrameClock, frameDelta, frameTick, resetFrameClock,
} from "./systems/frame-clock.ts";
export {
  PAL_BLANK_SECONDS, MAX_CATCH_UP_BLANKS, NativeVblankClock,
} from "./systems/native-vblank-clock.ts";
// The field-reachable movie: the title overlay's movie object, ported once
// (F0x8008B798's selector 0xE0A at story ordinal 43 -> movie row 9 = MOVIED08).
export {
  FieldMoviePlayer, MOVIE_STREAM_FPS, MOVIE_PICTURE_WIDTH, MOVIE_PICTURE_HEIGHT,
  MOVIE_INTERLACED_DISPLAY, MOVIE_DISPLAY_RECT,
  type MovieEndReason, type FieldMovieDiagnostics,
} from "./systems/field-movie-player.ts";
export {
  DIVE_FORMS, SURFACE_PLAYER_SPRITE_ID, isDiveStepOp, diveFormForStepOp,
  diveMoveMagnitude, computeDiveNetwork, diveFormOnScreen, diveFormFromSpriteId,
  type DiveForm, type DiveStepOp,
} from "./systems/dive-form.ts";
// The scene descriptor's +0x4C cast list: the ONE reader every actor spawn
// goes through (the player build and the general actor build). Ported once for
// all stages; the data is web/assets/data/stage_cast_lists.json, decoded by
// tools/extract_cast_lists.py.
export {
  CAST_PLAYER_IDS, CAST_DEFAULT_PLAYER_ID,
  isPlayerCastId, castGatePasses, castPlayerRecord, castPlayerId, castActorRecords,
  type CastRecord, type CastListTable, type CastGateCondition, type CastFlagMatch,
} from "./systems/cast-list.ts";
// The three special block actors (npc 328/351/352) and the interaction they
// carry: the engage branch and both mode bodies, ported once from fieldstg.
export {
  BLOCK_ACTOR_IDS, BLOCK_ENGAGER_STATE, BLOCK_TARGET_STATE,
  BLOCK_ENGAGER_CLIP, BLOCK_TARGET_CLIP, BLOCK_TARGET_WAIT, BLOCK_CUE,
  BLOCK_GONE_STATE, BLOCK_DURATIONS,
  blockCompletionBit, isBlockActorId, blockActorRecords,
  engageBlock, tickBlockEngagement,
  type BlockDurations, type BlockEngagement, type BlockTickEvents,
} from "./systems/block-actor.ts";
// The item boxes (p126itmb, npc ids 33/77-87/340-344/347): the talk body's
// family test and its close arm, which removes the box as the textbox closes.
export {
  BOX_ACTOR_IDS, BOX_TALK_CLIP, BOX_TALK_CUE, BOX_GONE_STATE, isBoxActorId,
} from "./systems/box-actor.ts";
export {
  PAD_BUTTONS, PAD_BIT, KEYBOARD_BINDINGS, GAMEPAD_BUTTON_MAP, GAMEPAD_AXIS,
  STICK_PRESS, STICK_RELEASE, TRIGGER_PRESS, PAD_REPEAT, padRepeatFires, REPEATING,
  buttonsFromMask, maskFromButtons, buttonForKey, isPadButton, repeats, buttonsFromGamepad,
  PAD_FACE_WORD_SWAP, PAD_LANGUAGE_DEFAULT, padWordBit, padWordButton, padLanguage, setPadLanguage,
  type PadButton,
} from "./systems/input-map.ts";
export {
  SUBMARIMON_SPRITE_ID, SUBMARIMON_INITIAL_HEIGHT,
  SUBMARIMON_VELOCITY_STEP, SUBMARIMON_VELOCITY_MIN, SUBMARIMON_VELOCITY_MAX,
  SUBMARIMON_HEIGHT_MIN, SUBMARIMON_HEIGHT_MAX, SUBMARIMON_TALK_DEPTH_MAX,
  SUBMARIMON_RISING_VELOCITY_THRESHOLD, SUBMARIMON_FLOOR_SNAP_BIAS,
  SUBMARIMON_CEILING_BY_TERRAIN, SUBMARIMON_FLOOR_BY_TERRAIN,
  SUBMARIMON_SPEED_STEP, SUBMARIMON_SPEED_MAX, SUBMARIMON_SPEED_MAX_NTSC,
  SUBMARIMON_TURN_INTERVAL_TICKS,
  createSubmarimonMotion, submarimonMotionForSprite, isSubmarimonSprite,
  submarimonCanInteract,
  stepSubmarimonVelocity, submarimonTerrainLimit, tickSubmarimonMotion,
  stepSubmarimonSpeed, stepSubmarimonFacing, clampSubmarimonHeight,
  submarimonIsAdvancing, submarimonRollsEncounter,
  submarimonLiftPixels, submarimonActorScreenY,
  type SubmarimonMotion,
} from "./systems/submarimon-motion.ts";
export {
  ICE_SLIDE_START_OP, ICE_SLIDE_STOP_OP, ICE_SLIDE_MAGNITUDE,
  ICE_SLIDE_RECOVERY_TICKS, ICE_SLIDE_MODE_GLIDE, ICE_SLIDE_MODE_STOP,
  triggerCellStepIndex, triggerCellArgument,
  beginIceSlide, stopIceSlide, iceSlideLocksInput, tickIceSlide,
  type IceSlidePhase, type IceSlideState, type IceSlideTick,
} from "./systems/ice-slide.ts";
export {
  PAD_CENTER_OFFSET, PAD_ANIM_FRAMES, FLIGHT_FRAMES, RESTORE_FRAMES,
  PHASE_START, PHASE_END, APPROACH_SPEED,
  SPIN_TICKS_PER_STEP,
  spinFacing,
  nearestPad,
  LAUNCH_PAD_SOUND,
  LAUNCH_PAD_SOUND_ID, SPIN_START_FACING,
  PAD_CLIP_SCRIPT, PAD_CLIP_SCRIPT_END, PAD_CLIP_SCRIPT_BLANK,
  PAD_IDLE_SCRIPT, PAD_IDLE_CYCLE_TICKS,
  newPadCursor, advancePadScript, padIdlePalette,
  type PadCursor, type PadScriptEntry,
  DEFAULT_PAD_CLIP_BASE, PAD_WINDUP_FRAMES, PAD_LOOP_REPEATS, padAnimationClip,
  isLaunchExit, launchEase, launchPhase, padCenter, startLaunch, stepLaunch,
  type LaunchExit, type LaunchPhase, type LaunchState,
} from "./systems/launch-pad.ts";
export {
  ACTOR_ACTION_SLOT, ACTOR_MODE, MODE_BLOCK_FILE, MODE_DEFAULT_FILE,
  SLOPE_STEP_UNITS, SLOPE_STEP_CELLS, SLOPE_SLIDE_UNITS, SLOPE_SLIDE_CELLS,
  SLOPE_NEAR_TOP_UNITS, SLOPE_CLIP, SLOPE_SPRITE, SLOPE_LAND_SOUND, SLOPE_LAND_SFX,
  SLOPE_STEP_HOLD_TICKS, CAST_LOCK_ADDR, FLOAT_TICK,
  PAD_WALK_HANDLER, PAD_WALK_TICK, PAD_WALK_MODE, PAD_WALK_FACING, PAD_WALK_LOCK_ADDR,
  actorActionPlan, startSlope, stepSlope,
  type ActorActionKind, type ActorActionPlan, type SlopePhase, type SlopeState,
} from "./systems/step-actor-actions.ts";
export { ambushTileAt, type AmbushTile } from "./systems/ambush-tile.ts";
export {
  BALLOON_SET_0, BALLOON_SET_1, BALLOON_SETS, BALLOON_ANCHOR_LIFT,
  BALLOON_UNIT_FRAMES, GLYPH_ROW_STRIDE, RESULT_BUBBLE_SUBTYPE,
  balloonFace, balloonAnchorY, glyphRowForSubtype,
  type BalloonCheckpoints,
} from "./systems/field-balloon.ts";
export { partyOrbVisible, PARTY_ORB_SCREEN_CUT } from "./systems/party-orb.ts";
export {
  EMOTE_SOUND_MIN, EMOTE_SOUND_MAX, EMOTE_SOUND_PLAY, EMOTE_SOUND_STOPS,
  emoteSound, emoteSoundId, type EmoteSoundCue,
} from "./systems/emote-sounds.ts";
export {
  FISHING_POLE_FLAG, FISHING_BUDGET, CAST_SETTLE_TICKS,
  METER_MAX, METER_SPEED, METER_BAND, BRAKE_FAST, BRAKE_SLOW,
  RESOLVE_TICKS, EMPTY_PATTERN, BAND_SLOT, TRACK_BANDS,
  STRIKE_BUTTON, STRIKE_SOUND, BITE_SOUND,
  startFishing, tickFishing, trackBandAt, fishingSpotAt,
  POSE_CAST_CLIP, POSE_THROW_CLIP, POSE_WAIT_CLIP, POSE_RESULT_CLIP,
  POSE_RECOVER_CLIP, POSE_IDLE_CLIP, POSE_CAST_SOUND, POSE_THROW_SOUND,
  POSE_RESULT_TICKS, POSE_SPRITE,
  RESULT_BUBBLE_ROW, RESULT_BUBBLE_HOLD_TICKS,
  startFishingPose, tickFishingPose,
  startFishingBubble, tickFishingBubble, closeFishingBubble, resultBubbleFrames,
  type FishingSpot, type FishingStage, type FishingState,
  type FishingPhase, type FishingCue,
  type FishingPose, type FishingPoseCue,
  type FishingBubble,
} from "./systems/fishing.ts";
export {
  DUEL_PHASES, DRAW_COUNT, FOLDER_SIZE, SETS_TO_WIN, COLLECTION_CAP,
  HAND_LIMIT, TRASH_LIMIT, FIELD_LIMIT, STAT_CAP,
  COMBO_MIN, COMBO_FOUR_BONUS, ENERGY_COLOURS,
  CALUMON_CARD_ID, IMPMON_CARD_ID, COMBO_SUBSTITUTE_CARD_ID,
  indexCatalog, cardsOfColour, summonCost, comboInto, strengthRank, energyIndex,
  CARDS_PER_PACK, PACK_POOL_ENTRIES, PACK_STOCK_CAP,
  packCount, grantPack, openPack,
  createCollection, serializeCollection, deserializeCollection, grantCard, grantStarterDeck, renameFolder, ownedCount, spareCount, copiesInFolder,
  seeCard, hasSeenCard, loseCard,
  CARD_TYPE_PLAY_CLASS, DIGIMON_CARD_TYPE, cardPlayClass, handCardSelectable,
  browserRowLegal,
  addToFolder, removeFromFolder, folderIsLegal,
  FOLDER_COUNT, FOLDER_NAME_LEN, MAX_COPIES_PER_FOLDER, FOLDER_COLOURS,
  swapIntoFolder, sortFolder, folderColourCounts, type FolderSwap,
  createDuel, shuffle, phase, stepPhase, tickDuel, duelBeatBusy, duelBeatAwaitsButton, dismissBeat, greedyChoice, simpleAgent, discAgent,
  shuffleDeck, shuffleDuelPiles, SHUFFLED_PILES, SHUFFLE_PASSES,
  aiHandOrder, sortHandArray, sortDuelHands, SORTED_HAND_ARRAYS,
  handClass, AI_CLASS_NEVER_SUMMON, opposing,
  recomputeTotals, canSummon, summonFromHand, putOnField, fieldSlot,
  comboRuns, comboBonus, comboRunScore, cardIsInDuel, resolveBattle, endSet,
  battleDrainSide, battleAward, battleSettleSet, commitSetCounter, battleSweepWinner,
  applyDynamicStatMegas, DYNAMIC_STAT_MEGAS,
  retireOpenedTier, firstUnavailableSlot, firstRetiredSlot, GROUP_RETIRED,
  evaluateBoard, AI_CLASS_LOAD, AI_CLASS_COMPILE, AI_CLASS_RESPONSE, AI_ANSWERABLE_KINDS,
  aiWorthPlaying, AI_WORTH_HAND_RANK,
  setWindowThreshold, openDeckForSet,
  applyBattleDamage, queueSlotStats, tickStats, statsSettled, settleStats,
  indexEffects, fieldTargets, canPlayProgram, checkEffectLegality, applyProgramEffect, playProgram,
  fieldInstanceAt, handInstanceAt,
  handTargets, resolveHandDiscard, awaitingHandDiscard, aiPickBySelectionRank,
  awaitingCardChoice, duelChoice, resolveCardChoice,
  beginProgramTurns, programTurnSide, passProgramTurn, playProgramTurn,
  settleProgramTurn, runProgramTurns, type ProgramTurns,
  pumpProgramTurns, tickProgramTurns, programTurnResolving, PASS_DELAY_TICKS,
  type TurnPlay,
  beginSummonTurns, summonTurnSide, takeSummonTurn, endSummonTurn,
  runSummonTurns, canSummonAny, commitSummons, toggleSummonMark, commitMarkedSummons, type SummonTurns,
  SUMMON_OPCODE_CARDS, SUMMON_TABLE_HALFWORDS,
  PROGRAM_EFFECTS,
  comboSlotFlags, comboPickerDimmed, defaultComboCursor, COMBO_CURSOR_LAST,
  type CardColour, type CardStage, type CardRecord, type CardCatalog,
  type CardCollection, type DuelSide, type DuelState, type DuelPhaseKey,
  type DuelDeckMeta, type DuelDeckClasses,
  type FieldSlot, type EnergyColour, type EnergyPool, type ComboRun,
  type BattleResult, type EffectRecord, type EffectTable, type EffectTargeting,
  type EffectOp, type FieldTarget, type DuelAgent, type DuelAgents, type NamedTarget,
} from "./systems/card-battle.ts";
export {
  startProgram, stepVm, resolveVmChoice, runProgram, awaitingChoice,
  chosenTargets, actingSide,
  awaitingPerformance, tickPerformance, completePerformance,
  type EffectVm, type VmChoice, type PileZone, type VmOptions, type Eligible,
  type VmPerformance,
} from "./systems/card-effect-vm.ts";
export { OPCODE_FAMILY } from "./systems/card-opcode-families.ts";
export {
  OPCODE_CLASS, beatNeedsAnimation, DUEL_OPCODE_COUNT,
  PROGRAM_BEATS, PROGRAM_BEAT_TICKS, PLAYED_FAN, PLAY_ENTRY, PLAY_ENTRY_TICKS,
  DUEL_MESSAGE,
  latchProgramBeat, beatFrames, beatIsInputGated, beatWaitsForButton, BEAT_WAITS_FOR_BUTTON, ceremonyGloss,
  BATTLE_PHASE_STATES, BATTLE_CEREMONY, type BattlePhaseState,
  FOLDER_CHOOSER_STATES, FOLDER_CHOOSER_OPEN_TICKS, FOLDER_CHOOSER_CLOSE_TICKS,
  FOLDER_FALLBACK_DECK, type FolderChooserState,
  type DuelOpcodeClass,
} from "./systems/card-ceremony.ts";
export {
  INSPECT_ROWS, INSPECT_ROW_COUNT, INSPECT_HEADING, moveInspectCursor,
  FIELD_SECTIONS, FIELD_SECTION_TRY_ORDER, FIELD_SECTION_SLOTS, NO_CARDS_IN_FIELD, ARE_YOU_SURE,
  fieldSectionCards, firstFieldSection, stepFieldSection, clampBrowseCursor,
  surrenderDuel,
  type FieldSection, type InspectRowKey,
} from "./systems/card-inspect.ts";
export {
  SCALE_ONE, CardAnimState, CardRenderKind, CARD_SFX,
  SHAKE_X_TABLE, SHAKE_XY_TABLE,
  rsin, cardFanOut, cardRowSlot,
  DUEL_BOARD, SHAKE_DURATION, DEAL_START_X, DEAL_DURATION, DEAL_STAGGER, DEAL_FLIP_STAGGER,
  HAND_COLLAPSE_DURATION, REVEAL_DURATION, REVEAL_STAGGER, PILE_REVEAL_STAGGER, revealCard,
  createCardSprite, despawnCard, moveCard, scaleCard, flipCard, shakeCard,
  holdCard, playCardEffect, settleCard, summonCard,
  stepCardSprite, cardEffectRun, cardEffectFrame, cardBusy,
  PILE_OVERHEAD, PILE_PER_CARD, pileAnimDuration,
  BANNER_SIDES, BANNER_EDGE_SHOWN, BANNER_EDGE_HIDDEN,
  BANNER_EXTENT_SHOWN, BANNER_EXTENT_HIDDEN, BannerPhase,
  createBannerSlide, startBannerSlide, stepBannerSlide,
  type CardSprite, type CardStepResult, type CardAnimStateValue,
  type BannerSlide,
} from "./systems/card-animation.ts";
export {
  widgetLerp, stepWidget,
  HudPanelState,
  PANEL_SLIDE_BOTH_IN_DURATION, PANEL_SLIDE_BOTH_OUT_DURATION,
  PANEL_SLIDE_ONE_IN_DURATION, PANEL_SLIDE_ONE_OUT_DURATION,
  PANEL_RESET_BANNER_X, PANEL_SLIDE_BOTH_IN_SIDE1_SUB_X,
  PANEL_SHOWN, PANEL_HIDDEN,
  WIDGET_SCALE_FULL, TurnMarkerState,
  TURN_MARKER_GROW_DURATION, TURN_MARKER_SHRINK_DURATION,
  PromptState,
  PROMPT_OPEN_DURATION, PROMPT_CLOSE_DURATION, PROMPT_CONFIRM_DURATION,
  PROMPT_OPEN_SFX, PROMPT_CLOSE_SFX, PROMPT_CONFIRM_SFX,
  PROMPT_LAYOUT, PROMPT_LAYOUT_WIDE,
  PROMPT_CURSOR_X, PROMPT_CURSOR_ROW_STRIDE, PROMPT_CURSOR_Y_BIAS,
  createCardView, resetPanels,
  slideBothPanelsIn, slideBothPanelsOut, slidePanelIn, slidePanelOut,
  growTurnMarker, shrinkTurnMarker, turnMarkerShowsIcon,
  openPrompt, closePrompt, confirmPrompt, setPromptCursor,
  openPromptB, closePromptB, confirmPromptB, setPromptCursorB,
  promptProgress, promptBProgress, promptCursorY,
  markerPulsePhase, MARKER_PULSE_REST_FRAMES, MARKER_PULSE_STEP_FRAMES, MARKER_PULSE_PHASES, MARKER_PULSE_CYCLE,
  startReveal, stepReveal, revealNumbers, clearReveal, REVEAL_RAMP_FRAMES,
  type RevealTotals, type RevealRamp,
  INFO_BANNER_COUNT, INFO_BANNER_OPEN_DURATION, INFO_BANNER_CLOSE_DURATION,
  INFO_BANNER_OPEN_SFX, INFO_BANNER_CLOSE_SFX, INFO_BANNER_BLANK,
  InfoBannerSlot, InfoBannerState,
  VIEW_PLATE_COUNT, VIEW_PLATE_OPEN_DURATION, VIEW_PLATE_CLOSE_DURATION,
  VIEW_PLATE_ORIGINS, VIEW_PLATE_CLIP_BIAS, ViewPlateState,
  MARKER_COUNT, MARKER_SHEET, MarkerState,
  openBanner, closeBanner, viewPlateClip, openPlate, closePlate,
  placeMarker, slideMarker,
  stepPanels, stepPrompt, stepBanners, stepPlates, stepMarkers, stepCardView,
  type HudSide, type HudPanelStateValue, type HudPanel, type CardView,
  type TurnMarkerStateValue, type PromptStateValue, type PromptWindow,
  type InfoBanner, type InfoBannerStateValue,
  type ViewPlate, type ViewPlateStateValue,
  type ViewMarker, type MarkerStateValue,
  startDrain, drainDone, drainAttackerShown, drainDefenderShown,
  DRAIN_LEAD_IN, DRAIN_TICKS_PER_CARD, DRAIN_TAIL, DRAIN_SPAWN_PERIOD,
  type DrainState, type DrainOpen,
  startDealTally, dealTallyShown, dealTallyDone,
  DEAL_TALLY_PERIOD, DEAL_TALLY_CAP, DEAL_TALLY_STEPS,
  type DealTallyState, type DealTallyOpen,
  startHandReturn, handReturnShown, handReturnDone, HAND_RETURN_PERIOD,
  type HandReturnState, type HandReturnOpen,
} from "./systems/card-view.ts";
export {
  BLAST_FIRST_FRAME, BLAST_LAST_FRAME, BLAST_TOTAL_FRAMES,
  BLAST_SWAP_FRAME, BLAST_HEAL_FRAME, BLAST_PRESENTATION_SECONDS,
  BlastPhase, BLAST_PHASES, blastPhaseAt, blastPresentationState,
  FormChangeProgram, formChangeState, formChangeLength, formChangeSoundFrame,
  EVOL_EFFECT, EVOL_POS, EVOL_EFFECT_SCHEDULE, evolEffectsDue, driverEvolSchedule, type EvolSpawn,
  REVERT_LAST_FRAME, REVERT_SOUND_FRAME, REVERT_SEQUENCE_MSG_FRAME, REVERT_SWAP_FRAME,
  MANUAL_DV_LAST_FRAME, MANUAL_DV_SOUND_FRAME, MANUAL_DV_SWAP_FRAME,
  type BlastPhaseValue, type BlastPresentationState, type FormChangeProgramValue,
} from "./systems/blast-presentation.ts";
export {
  TREE_BOOTS_FLAG, TREE_SPRITE_IDLE, TREE_HIT_RADIUS, KICK_SOUND,
  ACTION_POINT_OFFSETS, TREE_SHAKE_SCRIPT, KICK_SCRIPTS, KICK_YSORT_BIAS,
  DECIDE_PHASE, PHASE_STEP, PHASE_RESOLVED,
  NEAR_ENCOUNTER_SLOT, FAR_ENCOUNTER_SLOT, NEAR_ROLL_MAX,
  RADAR_LIFE, RADAR_NEAR, RADAR_MID, RADAR_FRAME,
  RADAR_ICON_FAR, RADAR_ICON_MID, RADAR_ICON_NEAR,
  RADAR_X, RADAR_Y, RADAR_CLUT_ROWS,
  treeActionPoint, treeIndexAt, rollTreeEncounter, relocateActiveTree,
  treeRadarReading, radarClutRow, tickTreeRadar,
  startTreeKick, tickTreeKick, treeKickHoldsInput,
  KICK_POSE_SPRITE, KICK_POSE_CLIP, KICK_POSE_IDLE_CLIP,
  KICK_POSE_FRAME_TICKS, KICK_POSE_TICKS, KICK_POSE_CONTACT_FRAME,
  KICK_POSE_AUTHORED_FRAMES, kickPoseFrameAt, startKickPose, tickKickPose,
  type KickableTree, type TreeKickStage, type TreeKickState,
  type TreeKickCue, type TreeRadar, type ScriptStep, type ScriptCursor,
  type KickPose,
} from "./systems/tree-kick.ts";
export {
  WATER_TIMELINE, WATER_TIMELINE_FRAMES, HOLE_LAYER_A, HOLE_LAYER_B,
  HOLE_LAYER_A_LOOP_TO, HOLE_LAYER_B_LOOP_TO, HOLE_DEMO_FRAMES,
  BACKDROP_CELL, DEMO_PACK, CHANNELS, CHANNEL_0, PARTICLE_FRAMES,
  FADE_OUT_AT, FADE_OUT_FRAMES, FADE_IN_FRAMES, DEMO_START, DEMO_LOAD_FRAMES,
  DEMO_CUE_FRAME,
  demoFrames, diveDemoTotalFrames, diveDemoFrame,
  stepCellAt, loopCellAt, channelCellAt,
  type DiveMode, type DemoStep, type ParticleChannel, type DiveDemoFrame,
} from "./systems/dive-demo.ts";
export {
  AREA_LABEL_POS, PLACE_LABEL_POS, REVEAL_DELAY, HOLD_FRAMES,
  WIPE_RECT, WIPE_TOP_STEP, WIPE_HEIGHT_STEP, BAR_GROUPS, BAR_WAITS,
  createLocationCard, stepLocationCard, releaseLocationCard,
  locationCardFrame, locationCardActive,
  type LocationBarTemplate, type LocationBarRect, type LocationLabel,
  type LocationCardFrame, type LocationCardState,
} from "./systems/location-card.ts";
export {
  startFireTrap, fireTrapRegionAt, fireTrapDurationTicks,
  type FireTrapConfig, type FireTrapRegion, type FireTrapLayer,
  type FireTrapBurst, type FireTrapCue, type FireTrapRun,
} from "./systems/fire-trap.ts";
export {
  FIELD_SHADOW_WIDTH, FIELD_SHADOW_HEIGHT,
  fieldShadowEnabledAtSpawn, fieldShadowSuppressedByClip, fieldShadowVisible,
  fieldShadowRect,
  type FieldShadowRect, type FieldShadowRectInput,
} from "./systems/field-shadow.ts";
export {
  BILLBOARD_MIRROR_FACING_FROM, fieldBillboardQuad, billboardBottomShift,
  type FieldBillboardQuad, type FieldBillboardInput,
} from "./systems/field-billboard-anchor.ts";
// The ordinary field camera's follow rule — centre the leader at (160,140) and
// clamp inside the map. One definition for every free-roam stage.
export {
  CAMERA_VIEW_W, CAMERA_VIEW_H, CAMERA_CENTRE_X, CAMERA_CENTRE_Y,
  fieldCameraCentreOf, fieldCameraFollow,
  type FieldCamera,
} from "./systems/field-camera.ts";
// The field's sixteen-ordinal scene variant — the story beats at which the
// overworld boots its background a second way (a different BGM track).
export {
  SCENE_VARIANT_TABLE_FIRST, SCENE_VARIANT_TABLE_LEN, SCENE_VARIANT_ORDINALS,
  SCENE_VARIANT_MUSIC_ID, SCENE_BGM_DEFAULT_PLAY_ID, SCENE_BGM_VARIANT_PLAY_ID,
  SCENE_BGM_DEFAULT_TRACK, SCENE_BGM_VARIANT_TRACK,
  SCENE_VARIANT_SLOT_FLAG, SCENE_DEFAULT_SLOT_FLAG, SCENE_VARIANT_SLOT_TAG,
  sceneVariantActive, sceneBgmPlayId, sceneBgmTrack,
  sceneVariantSlotIndex, sceneVariantSlotActive,
} from "./systems/ordinal-scene-variant.ts";
// The s260 Cargo Tower auction — the lot cycle (gate, question, answer, writes)
// ported once; the lot table is data (web/assets/data/auction_lots.json).
export {
  selectAuctionLot, auctionAnswerWrites, runAuctionLot,
  type AuctionLot, type AuctionAnswer, type AuctionWrite, type AuctionHost, type AuctionHandoff,
} from "./systems/auction.ts";
export {
  timingForDir, walkFrameIndex, clipFrame, clipDurationSeconds,
  type Dir8, type SpriteTimings, type SpriteClips, type ClipFrameEntry, type ClipFrameResult,
} from "./systems/animation-controller.ts";
export { createCutscene } from "./systems/cutscene-manager.ts";
// The field scene system's arrival dispatcher (which event a place starts when you
// walk in), ported once; each place's candidate chain is data.
export {
  chooseArrivalEvent, arrivalEventForPhase, arrivalRunsOnPhase, earlierCandidates,
  flagTest, setArrivalChains, arrivalChain, arrivalChains,
  type ArrivalChain, type ArrivalCandidate, type ArrivalLeaf, type ArrivalTest,
} from "./systems/scene-arrival.ts";
// The field street vehicles: the cars that drive across a city street while the
// corner screens carry a broadcast. Ported once; each stage's path starts and
// sprite ids are its own data (engine/dw3/street-vehicle-tables.ts).
export {
  fireStreetBroadcast, hasStreetVehicles, tickStreetVehicles, streetVehicleDraws,
  streetPropDraws, streetPropRow, streetBroadcastState, clearStreetVehicles,
  BROADCAST_EFFECT_IDS, BROADCAST_SUB_ONE, BROADCAST_SUB_ZERO,
  VEHICLE_STEP_X, VEHICLE_STEP_Y, VEHICLE_ANIM_MOD, VEHICLE_CULL_X,
  BROADCAST_PHASE_FRAMES, PARKED_SPRITE,
  STREET_PROP_GROUPS, STREET_PROP_LAYER,
  type StreetVehicle, type StreetBroadcast, type RandBit, type StreetPropGroup,
} from "./systems/street-vehicles.ts";
export { STREET_VEHICLE_TABLES } from "./dw3/street-vehicle-tables.ts";
export type { StreetVehicleTables } from "./dw3/street-vehicle-tables.ts";
// The field street screens: the wall/column screens a stage overlay builds for
// itself, and the news tiles the A.O.A announcement switches them to. Ported
// once; each stage's screen table is its own data
// (engine/dw3/street-screen-tables.ts).
export {
  fireStreetScreens, hasStreetScreens, streetScreenStages, tickStreetScreens,
  streetScreenDraws, streetScreenState, clearStreetScreens,
  SCREEN_QUAD_STRIDE, SCREEN_QUAD_MARKER, SCREEN_QUAD_RGB,
  SCREEN_CMD_OPAQUE, SCREEN_CMD_ABR, SCREEN_TYPE_ABR_FROM,
  SCREEN_PATCH_NARROW, SCREEN_PATCH_FULL,
  type StreetScreenQuad, type StreetScreenCursor, type StreetScreenDriver,
} from "./systems/street-screens.ts";
export { STREET_SCREEN_TABLES } from "./dw3/street-screen-tables.ts";
export type {
  StreetScreenTables, StreetScreenTexture, StreetScreenRecord,
} from "./dw3/street-screen-tables.ts";
// The field street lights: the traffic-light corner an overlay builds for
// itself at one story beat. Ported once; each stage's glow table and lamp
// sequences are its own data (engine/dw3/street-light-tables.ts).
export {
  fireStreetLights, hasStreetLights, streetLightStages, claimPoleRecords,
  tickStreetLights, streetLightWrites, streetGlowDraws, streetLightState,
  clearStreetLights,
  advanceSequence, STREET_LIGHT_ORDINAL, STREET_LIGHT_EVENT,
  POLE_RECORD_TYPES, SEQUENCE_MAX_CHARGE, SEQUENCE_LOOP_MARKER,
  type LampCursor, type StreetGlow, type PoleWrite, type PoleRecord,
  type StreetLights,
} from "./systems/street-lights.ts";
export { STREET_LIGHT_TABLES } from "./dw3/street-light-tables.ts";
export type { StreetLightTables, StreetLightLamp } from "./dw3/street-light-tables.ts";
// The corner stinger: the one-shot sprite the announcement pops on the street
// corner, effect-registry id 0x322.
export {
  fireStingerPopup, hasStingerPopup, stingerPopupStages, stingerSoundFor,
  tickStingerPopup, stingerPopupDraws, stingerPopupState, clearStingerPopup,
  STINGER_EFFECT_ID, STINGER_SUB_ID, STINGER_X, STINGER_Y, STINGER_LAYER,
  STINGER_RISE_LIMIT, STINGER_HOLD_LIMIT, STINGER_FALL_LIMIT, STINGER_FALL_VALUE,
  STINGER_RISE_START, STINGER_CLIP_SHIFT, STINGER_SOUND_ORDINAL_27,
  STINGER_SOUND_DEFAULT, STINGER_SOUND_ORDINAL, STINGER_EVENT_IDS,
  type StingerPopup, type StingerDraw,
} from "./systems/stinger-popup.ts";
// The field scene system's TALK launcher (bank 0x90): the conversation whose on_close
// starts a scene, ported once. Each place's start sites are data.
export {
  setTalkLaunchBindings, talkLaunchSites, talkLaunchEventForBit,
  talkLaunchSitesForEvent, talkLaunchedEvents, resolveTalkLaunchRecord,
  clearTalkLaunchBindings,
  type TalkLaunchSite, type TalkLaunchBindings, type TalkLaunchEventRecord,
  type TalkLaunchTables,
} from "./systems/talk-launch.ts";
import { setTalkLaunchBindings, type TalkLaunchBindings } from "./systems/talk-launch.ts";
// The one packed-sound call every screen plays through (resident F0x8002006C,
// reached through the cell [0x80055C48]): unpack the word, and one shared queue
// of what every screen asked for. Each screen still lists only its own sounds.
export {
  unpackSound, PackedSoundService, PackedSoundCursor, packedSounds,
  playPackedSound, PACKED_SOUND_CELL, PACKED_SOUND_ROUTINE,
  type PackedSound,
} from "./systems/packed-sound.ts";
// The SPU voice pool the packed-sound call hands every sound to (F0x80034b9c,
// taken by the positional call F0x8003432c and the 2D phrase sequencer
// F0x8003581c alike): 24 voices, priority then sample-left then age, and a
// refusal when nothing qualifies.
export {
  createSpuVoicePool, SPU_VOICE_ALLOCATOR, SPU_VOICE_COUNT, SPU_VOICE_COUNT_LIMIT,
  SPU_VOICE_COUNT_SYMBOL, SPU_VOICE_MASK, SPU_VOICE_TABLE, SPU_VOICE_STRIDE,
  SPU_VOICE_AGE, SPU_VOICE_SAMPLE_LEFT, SPU_VOICE_PRIORITY, SPU_VOICE_KEYED,
  SPU_VOICE_SAMPLE_LEFT_LOOP, SPU_VOICE_AGE_AT_BOOT, SPU_PRIORITY_REQUEST,
  SPU_NO_VOICE,
  type SpuVoicePool, type SpuVoiceRecord, type SpuAllocation, type SpuOccupant,
  type SpuVoicePoolOptions,
} from "./systems/spu-voice-pool.ts";
// One SPU voice per note-on of a 2D phrase: the note renderer the walker plays
// each phrase with (F0x8003581c takes a voice from the pool once per note
// event, fns.s:41033, and the note-off frees that slot at once).
export {
  renderPhraseNote, SAMPLE_RATE as PHRASE_SAMPLE_RATE,
  PHRASE_NOTE_FLOOR, PHRASE_NOTE_EXP_TAU,
  type PhraseNote, type PhraseSample,
} from "./systems/phrase-notes.ts";
// The field scene system's scene-completion routine (what a finished scene writes to the
// story), ported once; each event's write list is data.
export {
  runSceneCompletion, applySetFlag, shapeOf, isCollectionBank, collectionWrite,
  cardDuelCloseWrites, CARD_DUEL_SCREEN_CODE,
  setSceneCompletions, setStageCompletions, sceneCompletion, sceneCompletions,
  type SceneCompletion, type SceneWrite, type CompletionSink, type SetFlagPolicy,
  type CollectionStore,
} from "./systems/scene-completion.ts";
import { runSceneCompletion, applySetFlag, sceneCompletion, setStageCompletions, collectionWrite, type SetFlagPolicy } from "./systems/scene-completion.ts";
import { screenIdForStage, type FieldScreenTable } from "./dw3/screen-routing.ts";
export { createShopManager, MONEY_CAP } from "./systems/shop-manager.ts";
export { shopBuyRefusal, shopBuyQuantityCeiling, shopBuyCommit, shopBuyAfterEquip } from "./dw3/ui/shop-buy-branches.ts";
export { listScrollbarThumb, type ListScrollbarGeom, type ListScrollbarThumb } from "./systems/list-scrollbar.ts";
export { createBattleManager } from "./systems/battle-manager.ts";
export * as combat from "./dw3/battle-combat.ts";
export * as formulas from "./dw3/battle-formulas.ts";
// The battle's OPENING PHASE MACHINE (engine/dw3/battle-opening-machine.ts): the
// port of the #2 jump-table arm of pro/wfightmn's controller F0x800a6c44 — the
// seven phases assembleBattleObjects / loadEncounterAndFighters / queueBattleOverlay
// / awaitOverlay / sweepActionQueue / frameCameraOrOpenLine / awaitLineThenHandOff,
// the intro-variant rule and the opening-line roll. Consumed by web/battle.js and
// pinned by tests/lane-b/battle-opening-machine.test.js against the same disc
// overlay the phase-machine oracle runs.
export {
  OPENING_MACHINE_BASE, OPENING_PHASE_TABLE_FILE, OPENING_CONTROLLER_ADDRESS,
  OPENING_DEFAULT_PHASE, OPENING_PHASE_COUNT,
  OPENING_ADVANCE_PHASE_METHOD, OPENING_ADVANCE_SUBSTATE_METHOD, OPENING_EXIT_METHOD,
  OPENING_PHASES, OPENING_INTRO_VARIANT_PAIRS, OPENING_SPECIAL_MODE4_MAP,
  openingPhaseIndex, openingPhaseFor, introVariantFor, openingLineRoll, ambushRoll,
  newOpeningState, openingAdvancePhase, openingExit, stepOpeningPhase,
  type OpeningPhase, type OpeningIntroVariant, type OpeningIntroAnswer,
  type OpeningLineRollInput, type AmbushRollInput, type OpeningState, type OpeningPorts, type OpeningStep,
} from "./dw3/battle-opening-machine.ts";
// The slow-motion stepper (engine/dw3/battle-slow-motion.ts): F0x8009e428 / F0x8009e510.
// Oracle tests/engine/unit/battle-slow-motion-oracle.test.ts.
export {
  slowMotionStep, setSlowMotion,
  SLOW_MO_LEVEL, SLOW_MO_ACCUM, SLOW_MO_PUBLISH, FRAME_DELTA_CELL,
  SLOW_MO_PUBLISH_AT, SLOW_MO_ACCUM_COST,
} from "./dw3/battle-slow-motion.ts";
// The HUD cel draw (engine/dw3/battle-cel-draw.ts): FIGHTSTG_F0x80093fec.
// Oracle tests/engine/unit/battle-cel-draw-oracle.test.ts.
export {
  faceBezelCelDraw, CEL_DRAW_LAYER, CEL_DRAW_ORIGIN,
  FACE_BEZEL_PACK, FACE_BEZEL_CEL, FACE_BEZEL_X, FACE_BEZEL_Y,
} from "./dw3/battle-cel-draw.ts";
// The enemy-id resolver (engine/dw3/battle-enemy-id.ts): FIGHTSTG_F0x8009b8d0 + F0x8009b864.
// Oracle tests/engine/unit/battle-enemy-id-oracle.test.ts.
export {
  enemyStatsIndex, enemyStatsBlock,
  ENEMY_STATS_PACK, ENEMY_STATS_STRIDE,
} from "./dw3/battle-enemy-id.ts";
// The steal roll (engine/dw3/battle-steal-roll.ts): FIGHTSTG_F0x800a1114.
// Oracle tests/engine/unit/battle-steal-roll-oracle.test.ts.
export {
  stealProc, stealRatio, stealWeight, stealThreshold,
  STEAL_TECH_TABLE, STEAL_TECH_STRIDE, STEAL_TECH_WEIGHT_OFFSET, STEAL_BONUS_OFFSET,
  STEAL_EFF_NUM_OFFSET, STEAL_EFF_DEN_OFFSET, STEAL_RATIO_MAX, STEAL_WEIGHT_SHIFT,
  STEAL_THRESHOLD_DIVISOR, STEAL_ROLL_MASK,
} from "./dw3/battle-steal-roll.ts";
export {
  commitManualDigivolve, markEquippedFormFlags, releaseReservedSecondForm,
  formChangeCoreStats, formChangeValues, formChangeRamView,
  FORM_ELEMENT_KEYS, FORM_STATUS_RESIST_KEYS,
  PARTY_RECORD_BASE, PARTY_ACTIVE_SLOT, PARTY_RECORD_STRIDE,
  COMBATANT_FORM, COMBATANT_RESERVED_FORM, COMBATANT_RESERVED_FLAG,
  FORM_FLAG_BASE, FORM_FLAG_STRIDE, FORM_FLAG_CHANGED, FORM_FLAG_EQUIPPED,
  FORM_GAUGE_BASE, FORM_GAUGE_STRIDE, FORM_GAUGE_OFFSET,
  FORM_RELEASE_KINDS, EQUIPPED_SLOTS, TIMELINE_BASE, TIMELINE_STRIDE,
  ROSTER_PROFILE_BASE, ROSTER_PROFILE_STRIDE,
  type FormChangeView, type FormChangeServices, type FormChangeMemory,
  type FormChangeCoreStats, type FormChangeValues, type FormChangeSpeciesFields,
} from "./dw3/battle-form-change.ts";
export * as battleStats from "./dw3/battle-stats.ts";
export { partyCharismaTotal, scaledStat } from "./dw3/battle-stats.ts";
// The 3-D battle's presentation pipeline (engine/dw3/battle-presentation.ts): the smdldata
// record table, arena placement, canned camera shots, and the texture-patch variant selectors
// and copy-rectangle builder. Exported so the browser renderer consumes the ported system
// instead of hand-written copies (web/fight/texture-patch-animator.js, web/battle3d.js).
export {
  SMDLDATA_RESOURCE, SMDLDATA_SECTION_SPLIT, ARENA_BASE_Z, ARENA_NEAR_ROT_Y,
  PATCH_SLOTS, PATCH_STRIDE, PATCH_END, PATCH_BLOCK_STRIDE, PATCH_BLOCK_BASE,
  BLINK_PAUSE_BASE, BLINK_PAUSE_MASK, CYCLE_PERIOD, CYCLE_HOLD,
  BLINK_TABLE, BLINK_TABLE_ADDR, BLINK_TARGET_VARIANT, BLINK_FAR_VARIANT,
  SmdldataTable, arenaPlacement, eyePatchVariant, blinkVariant, blinkPause, cycleVariant,
  patchCopyRect,
} from "./dw3/battle-presentation.ts";
export type {
  SmdldataHeader, SmdldataLookup, ArenaPlacement, CannedShots, TexturePatchEntry,
  PatchCopyRect, PatchBlock,
} from "./dw3/battle-presentation.ts";
// The action VM's per-tick slot-motion controller (engine/dw3/battle-slot-motion.ts):
// the factory F0x8009b460, the updater F0x8009b13c, the curve F0x800a1f74 and the
// per-kind table 0x800a365c. Exported so the browser renderer (web/fight/action-vm.js)
// consumes the ported motion arithmetic instead of its hand-written copy.
export {
  RAMP_TARGET, CONTACT_Z, SLOT_MOTION_KINDS, slotMotionKind,
  rampCurve, armSlotMotion, stepSlotMotion,
  slotMotionDistance, slotMotionPose, slotMotionLanding,
  type MotionSlot, type SlotMotion, type SlotMotionKind,
} from "./dw3/battle-slot-motion.ts";
// The battle actor lifecycle and registry ports (new modules, one per family):
//   engine/dw3/battle-actor-lifecycle.ts — the actor teardown F0x8008606c and the
//     multi-hit applier's reset F0x8009ddd8.
//   engine/dw3/battle-actor-pool.ts      — the four-fighter slot scan F0x80087bf8
//     and the counter-pool arm F0x8009d0ec.
//   engine/dw3/battle-task-spawn.ts      — the fight task spawner F0x80090c44 and
//     its data variant, the plate-HUD spawner F0x80093cc8.
//   engine/dw3/battle-effect-tint.ts     — the effect-tint feed F0x800861f4 that
//     sets the arena view's clear colour during a signature.
export {
  ACTOR_STATE_OFF, ACTOR_RES_OFFSETS, ACTOR_TEARDOWN_STATE,
  MULTI_HIT_MSG_IDS, MULTI_HIT_SLOTS, actorTeardown, multiHitReset,
  type ActorTeardownView, type MultiHitSlot, type MultiHitManager, type MultiHitState,
} from "./dw3/battle-actor-lifecycle.ts";
export {
  FIGHTER_SLOT_COUNT, FIGHTER_SLOT_STRIDE, FIGHTER_SLOT_FLAG_OFF, FIGHTER_SLOT_KEY_OFF,
  COUNTER_POOL_STRIDE, COUNTER_POOL_FLAG_OFF, COUNTER_POOL_REQUEST,
  findFighterSlot, armCounterPoolSlot,
  type FighterSlotPool, type CounterPool,
} from "./dw3/battle-actor-pool.ts";
export {
  FIGHT_TASK_METHOD, FIGHT_TASK_SIZE, FIGHT_TASK_FLAGS, FIGHT_TASK_ARG_BYTE_OFF, FIGHT_TASK_ARG_WORD_OFF,
  PLATE_HUD_METHOD, PLATE_HUD_SIZE, PLATE_HUD_FLAGS,
  spawnFightTask, spawnPlateHud, type SpawnedObject, type TaskSpawn,
} from "./dw3/battle-task-spawn.ts";
export {
  EFFECT_TINT_DEFAULT, ARENA_VIEW_ID, effectTintColour, effectTintFeed,
  type EffectFeedObject, type EffectTintFeedSink,
} from "./dw3/battle-effect-tint.ts";
// The battle's idle cut director (engine/dw3/battle-idle-director.ts): the port of
// FIGHTSTG_F0x8008718c — the four shot lists at 0x800a24b8, the three-byte walk at
// 0x800a2518, the raw-delta dwell and the ten sub-state arms. web/fight/battle-idle-director.js
// consumes it. Oracle: tests/engine/unit/battle-idle-director-oracle.test.ts.
export {
  IDLE_TURN_UNITS, IDLE_SPIN_PER_DELTA, IDLE_HALF_TURN_UNITS, IDLE_ROW_END,
  IDLE_SHOT_TABLE, IDLE_ROW_WALK, IDLE_SUB_STATES,
  idleSubState, idleNextRow, idleShotEntry, idleRowLength, idleSpinYaw,
  createIdleClock, createIdleDirector, idleDirectorTick,
  type IdleArm, type IdleShotEntry, type IdleFields, type IdleDirector, type IdleDirectorTick,
} from "./dw3/battle-idle-director.ts";
// The battle-open camera flourish (engine/dw3/battle-open-camera.ts): the port of
// FIGHTSTG_F0x800a1fe0 — the three-row script table 0x800A46A8, the `rand_u16 & 3` row pick
// (3 -> 0), the six sub-state arms (canned cuts, the arena cut, the glides and the pan) and the
// state-3 arena re-cut that frees the object. Created once per battle in the opening machine's
// phase 1; web/battle3d.js drives it as the opening camera. Oracle:
// tests/engine/unit/battle-open-camera-oracle.test.ts.
export {
  OPEN_CAMERA_CLASS, OPEN_CAMERA_TABLE, OPEN_CAMERA_ARM_TABLE, OPEN_CAMERA_ROW_END,
  OPEN_CAMERA_ROWS, openCameraRow, openCameraShot, createBattleOpenCamera,
  type OpenCamShot, type OpenCamFields, type OpenCamAction, type BattleOpenCamera,
  type BattleOpenCameraState, type BattleOpenCameraTick, type BattleOpenCameraOptions,
} from "./dw3/battle-open-camera.ts";
// The battle actor's animation-slot system (engine/dw3/battle-actor-animation.ts): the
// slot resolver F0x80087bf8/F0x80087e28, the table bind F0x80088024, the home placement
// F0x80087f38 (on the shared arenaPlacement) and the op2 movement arms of F0x8008b7f4.
// web/fight/actor-animator.js consumes it. Oracle: tests/engine/unit/battle-actor-animation-oracle.test.ts.
export {
  ANIM_SLOT_COUNT, ANIM_SLOT_STRIDE, ANIM_SLOT_BASE, CONTACT_HALF, ANIM_SLOT_VISIBLE,
  findAnimSlotIndex, resolveAnimSlot, setAnimSlotTable,
  animSlotHome, placeAnimSlot, resetAnimSlotLiveToHome, op2SlotTarget, animSlotMoveDelta,
  transformationAnimSchedule,
  type AnimSlotEntry, type AnimSlotPlacement, type Op2MoveRecord,
} from "./dw3/battle-actor-animation.ts";
// The action VM's TIMELINE SAMPLER (engine/dw3/battle-timeline-sampler.ts): the
// playhead over one frame table (FIGHTSTG_F0x80083c30) that loops in place on the
// 0x8000 marker and freezes on 0xffff. The browser's timeline-player.js consumes it.
export {
  SAMPLE_BIT, LOOP_MARKER, END_MARKER, BLEND_TARGET,
  frameTableFromEntries, newSamplerState, sampleTick, readPhase, advancePlayhead,
  type TimelineFrameTable, type TimelineEntry, type SamplerState, type SamplerHost,
} from "./dw3/battle-timeline-sampler.ts";
// The action VM's DISPATCHER (engine/dw3/battle-action-dispatcher.ts): the opcode
// table, the yield set, the terminator's hold/transition rule and the per-tick loop
// FIGHTSTG_F0x8008c590. web/fight/action-vm.js consumes it for its dispatch.
export {
  OP_HANDLERS, handlerForOpcode, opcodeConsumesHandlerReturn, terminatorHolds, runDispatch,
  type HandlerId, type TerminatorContext, type DispatchStep, type DispatchHost,
  type DispatchActor, type DispatchOptions,
} from "./dw3/battle-action-dispatcher.ts";
// The action VM's OPCODE HANDLERS (engine/dw3/battle-action-handlers.ts): the
// operand count per opcode and the ported handler bodies (op11 WAIT in full; the
// child-index / motion-id arithmetic for op1/op4). FIGHTSTG_F0x8008b69c etc.
export {
  HANDLER_PORTS, operandWords, op11Wait, op1ChildActionIndex, op4MotionId,
  MOTION_SENTINEL_CURRENT, MOTION_SKIP,
  type HandlerPort, type WaitActor, type AuxParent,
} from "./dw3/battle-action-handlers.ts";
// The action VM's OPCODE HANDLER BODIES (engine/dw3/battle-action-opcodes.ts): the
// control flow and target calls each handler makes, REUSING the ported subsystems as
// its targets. web/fight/action-vm.js supplies its data through an ActionOpcodeHost
// and drives these instead of hand-writing each opcode. Oracle:
// tests/engine/unit/battle-action-opcodes-oracle.test.ts.
export {
  op1Handler, op2Handler, op3Handler, op4Handler, op5Handler, op6Handler, op7Handler, op10Handler,
  CAMERA_PRESET_ARMS, CAMERA_PRESET_METHODS, CAMERA_STRUCT,
  ACTOR_IP, ACTOR_SIDE, ACTOR_OUTCOME, ACTOR_CURRENT_MOTION, ACTOR_CURRENT_EFFECT,
  ACTOR_CONTACT_SOUND,
  ACTOR_ANIM_OBJECT, ACTOR_CONTACT_COUNTER, ACTOR_STRIKE_COUNTER,
  ACTOR_PRELOAD_STATE, ACTOR_PRELOAD_A, ACTOR_PRELOAD_B, ACTOR_PRELOAD_C,
  ACTOR_STRIKE_TABLE, ACTOR_CONTACT_MODE, EFFECT_CURRENT_SENTINEL, MOTION_CURRENT_SENTINEL,
  type ActionOpcodeHost, type ActionOpcodeMemory, type ActionOpcodeRegistry, type OpcodeResult,
} from "./dw3/battle-action-opcodes.ts";
// The battle effect system's flat sprite (engine/dw3/battle-effects.ts): the
// per-tick channel-record stepper F0x800893dc and the screen/world sprite draw
// F0x8008921c. Exported so the browser renderer (web/fight/effect-player.js)
// consumes the ported playback and draw resolution instead of its hand-written copy.
export {
  EFFECT_CHANNEL_COUNT, EFFECT_CH_FRAME, EFFECT_CH_CLUT, EFFECT_CH_DX, EFFECT_CH_DY,
  EFFECT_CH_SCALE_X, EFFECT_CH_SCALE_Y, EFFECT_CH_ROT_X, EFFECT_CH_ROT_Y, EFFECT_CH_ROT_Z,
  EFFECT_SCALE_ONE, EFFECT_SCREEN_Z_NEAR, EFFECT_SCREEN_Z_FAR, EFFECT_DEPTH_NEAR, EFFECT_DEPTH_FAR,
  readEffectRecord, effectStreamFromRecord,
  newEffectSprite, stepEffectSprite, effectScaleArmed,
  effectDrawPlan, effectDrawOps,
  buildEffectMeshLight, buildEffectMeshColours, EFFECT_MESH_RGB_CODE,
  type EffectRecordStream, type EffectSprite, type EffectDrawInstance, type EffectDrawPlan, type EffectDrawOp,
  type EffectMeshColourConstant, type EffectMeshColourInput, type EffectMeshColourResult,
} from "./dw3/battle-effects.ts";
// The op6 projectile flight family (engine/dw3/battle-projectile.ts): the registry
// lookup F0x800897f8 (id -> packed MEFT `file`) and the flight-object constructor
// F0x80089844. Exported so the browser projectile driver (web/fight/effect-player.js)
// and the action VM's op6 handler consume the ported registry scan and object build
// instead of reading the resolved manifest entry directly.
export {
  PROJECTILE_REGISTRY_BASE, PROJECTILE_VRAM_X, PROJECTILE_VRAM_Y, PROJECTILE_OBJECT_SIZE,
  PROJECTILE_END_UNREGISTERED, projectileFileForId, newProjectileFlight,
  projectileRegistryFromIds,
  type ProjectileRegistryEntry, type ProjectileFlight,
} from "./dw3/battle-projectile.ts";
// The effect object family driver's shared dispatch and step bodies
// (engine/dw3/battle-effect-driver.ts): the entry state dispatch, the state-0
// construct-stage dispatch, the state-1 fifteen-entry substate jump table, the
// fifteen step bodies and four construct-stage bodies, and the host interface
// they run against.
export {
  EFFECT_DRIVER_STATE_CONSTRUCT, EFFECT_DRIVER_STATE_PROGRAM,
  EFFECT_DRIVER_STATE_LANDED, EFFECT_DRIVER_STATE_FINISHED,
  EFFECT_DRIVER_ENTRY_CONSTRUCT, EFFECT_DRIVER_ENTRY_PROGRAM, EFFECT_DRIVER_ENTRY_RETURN,
  EFFECT_DRIVER_STAGE_DEFAULT, EFFECT_DRIVER_STAGE_SETUP, EFFECT_DRIVER_STAGE_MODE2, EFFECT_DRIVER_STAGE_MODE3,
  EFFECT_DRIVER_SUBSTATE_HANDLERS, EFFECT_DRIVER_TIMER_GATES,
  EFFECT_DRIVER_STEP_FALLTHROUGH,
  EFFECT_DRIVER_CELL_OBJ_GET, EFFECT_DRIVER_CELL_55C54, EFFECT_DRIVER_CELL_55C60,
  EFFECT_DRIVER_CELL_DF9C, EFFECT_DRIVER_CELL_55C48, EFFECT_DRIVER_CELL_4570, EFFECT_DRIVER_CELL_44F44,
  EFFECT_DRIVER_LAYER_REGISTRY, EFFECT_DRIVER_RESOURCE_SERVICE,
  EFFECT_DRIVER_SPAWN_POS_ORIGIN, EFFECT_DRIVER_SPAWN_POS_CENTRE, EFFECT_DRIVER_SPAWN_POS_NEG,
  EFFECT_DRIVER_SFX_SOURCE, EFFECT_DRIVER_SFX_SOURCE2, EFFECT_DRIVER_SFX_OFFSET_TABLE,
  effectDriverEntryTarget, effectDriverStageTarget, effectDriverProgramTarget,
  effectDriverProgramBody, effectDriverConstructStageBody, effectDriverRegs,
  type EffectDriverEntry, type EffectDriverStage, type EffectDriverHost, type EffectDriverRegs,
} from "./dw3/battle-effect-driver.ts";
// The transformation driver's effect spawner FIGHTSTG_F0x80089be4
// (engine/dw3/battle-effect-spawn.ts): it builds one child effect object from the
// registry at 0x800a2ea4 and copies the caller's 8 table bytes to its +0x5c. The
// driver's step bodies and the action VM's op3 handler both call it.
export {
  spawnEffectObject,
  EFFECT_SPAWN_REGISTRY, EFFECT_SPAWN_REGISTRY_STRIDE, EFFECT_SPAWN_REGISTRY_END,
  EFFECT_OBJECT_SIZE, EFFECT_OBJECT_TAG, EFFECT_OBJECT_CLASS,
  EFFECT_OBJECT_TYPE, EFFECT_OBJECT_FIELD1, EFFECT_OBJECT_FIELD2, EFFECT_OBJECT_POS,
  EFFECT_OBJECT_STATE, EFFECT_OBJECT_ABORT,
  type EffectSpawnMemory, type EffectSpawnHost,
} from "./dw3/battle-effect-spawn.ts";
// The production host for that driver (engine/dw3/battle-effect-driver-host.ts):
// binds the driver's callees to real ports — the shared base-object state methods,
// the layer +0x110/+0x114 writes, the F0x8001ffa8 sound/render context and the
// ported spawn — and routes the rest (the anim/camera/resource/registry services)
// through an EffectDriverServices object.
export {
  ProductionEffectDriverHost,
  baseObjectSetState, baseObjectNextState, baseObjectNextSubstate, baseObjectNextStage,
  layerSetX, layerSetY,
  slotOverlaySpawn, mipsDiv,
  objectWalkReapSlot, OBJECT_LIFECYCLE_DEAD,
  SLOT_OVERLAY_CLASS, SLOT_OVERLAY_SIZE, SLOT_OVERLAY_FIELD,
  createTransformationSchedule, TRANSFORM_SCHEDULE_DELTA,
  type TransformationSpawn, type TransformationScheduleOptions,
  type ObjectWalkMemory,
  // The ported effect-tint feed's single entry point (FIGHTSTG_F0x800861f4 →
  // engine/dw3/battle-effect-tint.ts): routes the arena view's (0x1000) background
  // colour to a sink. Shared by the production host and the ordinary transformation
  // route so the feed is not re-implemented; the renderer supplies the sink.
  feedArenaTint, type TintFeedMemory,
  BASE_OBJ_SET_STATE, BASE_OBJ_NEXT_STATE, BASE_OBJ_NEXT_SUBSTATE, BASE_OBJ_NEXT_STAGE,
  CONTEXT_SET_GLOBAL, CONTEXT_SET_DIMS, CONTEXT_SET_SIZE, CONTEXT_EMIT, CONTEXT_FLAG,
  EFFECT_DRIVER_HOST_LAYER_REGISTRY, EFFECT_DRIVER_HOST_RESOURCE_SERVICE,
  type EffectDriverMem, type EffectDriverServices, type SlotOverlayHost,
} from "./dw3/battle-effect-driver-host.ts";
// The slot-overlay object class FIGHTSTG_F0x80092f7c (engine/dw3/battle-slot-overlay.ts):
// the child the transformation driver's substates 5 and 7 spawn (through
// slotOverlaySpawn) and then WAIT ON. It is the class's own per-frame state machine —
// the counter that flips +0x10 (driver step 5's gate) at the disc's 0xff and runs back
// down to state 3 (driver step 7's teardown). Oracled against the original words by
// tests/engine/unit/battle-slot-overlay-step-oracle.test.ts.
export {
  slotOverlayStep,
  SLOT_OVERLAY_STATE, SLOT_OVERLAY_SUBSTATE, SLOT_OVERLAY_RATE,
  SLOT_OVERLAY_COUNTER, SLOT_OVERLAY_GATE, SLOT_OVERLAY_DONE_STATE,
  type SlotOverlayStepMemory, type SlotOverlayStepHost,
} from "./dw3/battle-slot-overlay.ts";
// The animation object's own method table (engine/dw3/battle-anim-object.ts): the
// +0x180 remove, +0x184 bind, +0x18c rename and +0x190 model-handle routines the
// transformation driver and the camera manager call on the object they fetch for
// class 0x14. The +0x188/+0x194 arms stay in battle-actor-animation.ts.
export {
  animRemoveSlot, animFreeSlotIndex, animBindSlot, animRenameSlotKey, animSlotModel,
  animSlotBaseOf, readAnimSlots,
  ANIM_CHILD_ARRAY, ANIM_INSTANCE_TABLE,
  ANIM_SLOT_BYTES, ANIM_BIND_STATE, ANIM_SLOT_LAYER_KEY,
  type AnimObjectMemory, type AnimObjectHost,
} from "./dw3/battle-anim-object.ts";
// The battle animation manager's own +0xe8 motion selector
// (engine/dw3/battle-animation-manager.ts): the class-0x15 method the transformation
// driver calls from its substates 0 and 11. It parks the previous motion, stores the
// new one and the two selector arguments, and restarts the manager through its own
// +0x28 base-object set-state entry only when the motion actually changes.
export {
  animManagerSelectMotion, ANIM_MGR_MOTION, ANIM_MGR_PREV_MOTION, ANIM_MGR_ARG2,
  ANIM_MGR_ARG3, ANIM_MGR_SET_STATE, ANIM_MGR_RESTART_STATE,
  type AnimManagerMemory, type AnimManagerHost,
} from "./dw3/battle-animation-manager.ts";
// The animation-instance allocator (engine/dw3/battle-anim-instance.ts): the
// FIGHTSTG_F0x80084790 wrapper the anim object's +0x184 binder calls, mapping its
// arguments onto the ported layer-figure builder F0x80084560
// (engine/dw3/battle-mesh.ts#createLayerFigure) and resolving the caller's pack
// handle through the resource service's real port.
export {
  createAnimInstance, animInstanceArgs, ANIM_INSTANCE_WRAPPER, ANIM_INSTANCE_BUILDER,
  ANIM_INSTANCE_PACK_CELL, ANIM_INSTANCE_ARG5, ANIM_INSTANCE_FACTORY, ANIM_INSTANCE_ALLOC_CELL,
  type AnimInstanceMemory, type AnimInstanceHost, type AnimInstanceArgs,
} from "./dw3/battle-anim-instance.ts";
// The battle camera manager's own method table (engine/dw3/battle-camera-manager.ts):
// the +0xf8/+0xfc record staging, the +0x100 far-shot reset and the +0x104 canned-shot
// loader the transformation driver calls on the object it fetches for class 0x12.
export {
  cameraManagerCopyRecord, cameraManagerBlend, cameraManagerResetShot, cameraManagerCannedShot,
  CAMERA_RECORD, CAMERA_MANAGER_SIZE, CAMERA_MANAGER_CLASS, CAMERA_MANAGER_TAG,
  CAMERA_MANAGER_METHODS, CAMERA_STAGE_BYTES, CAMERA_STAGE_MARKER, CAMERA_ANIM_CLASS,
  type CameraManagerMemory, type CameraManagerHost,
} from "./dw3/battle-camera-manager.ts";
// The battle 3-D core's geometry ports (engine/dw3/battle-mesh.ts): the vertex
// projection, the layer builder's parent-chain composition and its now-computed
// local pose (RotMatrix Rz·Ry·Rx + ScaleMatrix), the frame-type dispatch, the
// layer-figure allocation, the display-list packet builders and the on-screen
// test, plus the libgte rotation builder itself (engine/dw3/gte-math.ts).
export {
  projectMeshNode, packSxy, composeLayer, composeNodeView, layerVisible, layerLocalPose,
  layerFrameKind, createLayerFigure, packLayerPacketA, packLayerPacketB, scaleMatrix, onScreenTest,
  displayListMeshPacker, emitDisplayListMesh,
  readMeshBlob, decodeMeshPrims,
  LAYER_STRIDE, LAYER_FIGURE_BUILDER, LAYER_FIGURE_SIZE, LAYER_METHOD_POINTERS, LAYER0_ORDERING_HEAD,
  LAYER_FIGURE_THUNK, createLayerFigureThunk, layerFigureThunkArgs,
  ON_SCREEN_VERTEX_LIMIT,
  type MeshVertex, type ProjectionResult, type LocalLayer, type ParentLayer, type LayerWorld,
  type LayerPacketFields, type ScreenBounds, type LayerFrameKind,
  type LayerFigureHost, type LayerFigureMemory, type LayerFigureArgs, type LayerFigureThunkArgs,
  type MeshBlob, type DecodedMeshPrimitive,
} from "./dw3/battle-mesh.ts";
export {
  runDisplayList, buildPrimPacket, buildMeshFields, meshRunAdvance, initialDisplayListState,
  DL_TERMINATOR, DL_STATE_SLOT,
  type DisplayListState, type DisplayListStep, type DisplayListKind, type DisplayListNode,
  type DisplayListTables, type DisplayListOptions, type DisplayListResult,
  type DisplayListMutations, type MeshLookups, type MeshPacketFields, type PrimPacket,
} from "./dw3/battle-displaylist.ts";
export { rotMatrixZYX, cosSin, RCOSSIN } from "./dw3/gte-math.ts";
// The battle camera's look-at (engine/dw3/battle-camera.ts): the original's
// view builder F0x8002a1ac and the close-up face box's camera worker family
// (FIGHTSTG_F0x80091b8c / F0x80091c1c / F0x80091cf4 / F0x80091dac). The browser
// adapter web/fight/battle-camera.js consumes these.
export {
  lookAtView, viewToColumnMajor,
  gteSqrt, cosInt, sinInt, rotAxisMatrix, mulMatrix, rotVecMul, transposeRot,
  affineCompose, normalize6, applyRollZ, SQRT_TABLE, SIN_TABLE,
  FACE_BOX_LAYER_KEY, FACE_BOX_GROUPS, FACE_BOX_TICK, FACE_BOX_WORKER_SIZE, FACE_BOX_ANGLE_TRIPLE,
  faceBoxShotRead, faceBoxShotFromRows, faceBoxLookAt, faceBoxTick, faceBoxSpawn,
  type Ps1Matrix, type ViewBuild, type LookAtShot, type FaceBoxShot, type FaceBoxViewBuild,
  type FaceBoxRow, type FaceBoxWorker, type FaceBoxWorkerHost, type FaceBoxTickResult,
} from "./dw3/battle-camera.ts";
export {
  EVO_TREE_COMBAT_STATS, EVO_TREE_ELEMENTS, EVO_TREE_GROUP_BYTES, EVO_TREE_GROUP_TABLE,
  EVO_TREE_LINE_COUNT, EVO_TREE_LOAD_BASE, EVO_TREE_RECORD_COUNT, EVO_TREE_RECORD_SIZE,
  evoTreeKindName, evoTreeRecords, firstUnlockedTreeRecord, readEvoTreeLines,
  unlockedTreeRecords,
} from "./dw3/evo-trees.ts";
export type {
  EvoTreeHit, EvoTreeLine, EvoTreeRecord, EvoTrees, EvoTreeState, EvoTreeStats,
} from "./dw3/evo-trees.ts";
export {
  PARTY_CHARISMA_VAR, CHARISMA_THRESHOLDS, partyCharismaMeets,
  // The bank-0x70 op-0x30 story-range test and its literal open upper bound —
  // shared so the browser adapter (web/flag-store.js) resolves the range exactly
  // as the engine's FlagManager does, F0x80015b9c.
  ORDINAL_RANGE_OPEN_HI, ordinalInRange,
} from "./dw3/dw3-config.ts";
export * as items from "./dw3/items.ts";
// The shared item store: the one owner of the bag. Every screen's add / remove /
// count / list goes through here (engine/dw3/item-store.ts, the port of
// F0x800161D8 + F0x80015F04 + F0x800135E8).
export * as itemStore from "./dw3/item-store.ts";
export {
  ITEM_DIRECTORIES, ITEM_DIRECTORY_COUNT, ITEM_ID_MAX, itemDirectory,
} from "./dw3/item-directories.ts";
export {
  createScreenRouter,
  movieReturnScreen,
  movieRow,
  battleHandoff,
  screenIdForStage,
  MOVIE_TITLE_SCREEN,
  BATTLE_HANDOFF_SELECTOR,
  BATTLE_HANDOFF_SELECTOR_POST_FIGHT,
  type BattleHandoff,
} from "./dw3/screen-routing.ts";
export { parseEntry } from "./dw3/dialogue-parse.ts";
export {
  pickEncounter, selectScreenId, zoneAt, specialBattleMode,
  ENCOUNTER_RATE_TABLE, ENCOUNTER_TICK_FRAMES, resetEncounterCounter,
  encounterStepTick, zoneRateLevel, encounterGroupIndex, stageZoneBlocks,
} from "./dw3/encounters.ts";
export {
  FINALE_KIND_TAIL, FINALE_KIND_BODY, FINALE_KIND_HEAD,
  FINALE_MSG_BODY, FINALE_MSG_LEARNED, FINALE_HEAD_ATTACK_ID,
  BATTLE_WIN_RESULT_SCREEN, FINALE_WIN_ENDING_MOVIE,
  battleWinLaunchCode, battleWinJinglePlays,
  FINALE_TAIL_DEFEAT_BEATS, finaleBattleKind, finaleRecordsTechnique, finaleCopiedAttackSkill,
  type FinaleBeat, type FinaleTechniqueRow, type FinaleCopiedRow,
} from "./dw3/battle-finale.ts";
export {
  isCardmonEnemyId, cardmonBooster, CARDMON_ENEMY_IDS,
  type CardmonBoosterTable, type BoosterChoice,
} from "./dw3/cardmon-booster.ts";
// Flat re-exports so the browser imports these by name from the bundle (the `items`/`formulas`
// namespace exports above stay for engine-internal grouping). The browser is now the single
// consumer of these — the former web/items.js & web/battle-formulas.js duplicates were deleted.
export { ITEMS, ITEM_BY_ID, ITEM_BY_NAME, addItem, removeItem, useItem, itemUsableInField, itemUsableInBattle } from "./dw3/items.ts";
export {
  addItem as storeAddItem, removeItem as storeRemoveItem, heldCount, wornCount, ownsItem,
  carriesFolderBag,
  listItemIds, setHeldCount, reconcileHeldCounts, clearBag, inventoryDirectoryAdmits,
  wearOne, unwearOne, setEquippedItem, commitEquipSlot, commitEquipEvent,
  syncWornFromEquipment, WORN_MAX, wornItemIds,
  HELD_MAX, type ItemBagSlot, type ItemStoreState,
} from "./dw3/item-store.ts";
// The two count arrays as they sit inside the 0x26C4-byte save block: every save,
// load and post-battle payout addresses them there (the original copies the whole
// block, so all 402 ids are real bytes).
export {
  SAVE_BLOCK_BASE, SAVE_BLOCK_SIZE, HELD_ARRAY_OFFSET, WORN_ARRAY_OFFSET,
  heldArrayAddress, wornArrayAddress, itemCountEntries, writeItemArrays, readItemArrays,
  readHeldByte, readWornByte, bagFromItemArrays, applyItemArrays,
  type ItemCountEntry, type SaveBlockBytes,
} from "./dw3/item-store.ts";
export {
  EQUIPMENT, EQUIPMENT_BY_ID, EQUIP_SLOTS, equipItem, unequipItem, equipmentBonuses,
  gearAccessibleForLine, gearStatContributions, gearCodedStat, gearPrimaryStat,
  wieldSlotsFor, isTwoHanded,
  PAUSE_EQUIP_ROW_TABS, pauseEquipAdmitsRecord, pauseEquipRowAdmits,
  pauseEquipRowCollects, pauseEquipRowOffers, pauseEquipCandidateIds, pauseEquipListIds,
  weaponSecondary, weaponCritByte, crestSuppressedByWeapon, syncLeadEquipBonuses,
  WEAPON_LADDER, WEAPON_LADDER_BY_ID, ACCESSORY_LADDER, ACCESSORY_EFFECT_DECISIONS,
  EFFECTIVE_STAT_BLOCK_FIELDS, signatureSetBonus, wornFamilyBytes,
  SIGNATURE_SETS, SIGNATURE_SET_BONUSES, SIGNATURE_SET_SLOTS, SIGNATURE_SET_SLOT_COUNT,
  GEAR_CORE_STATS, GEAR_ELEMENTS,
  type EquipmentItem, type EquipSlot, type EquipmentSlots,
  type GearStatContribution, type WeaponSecondary, type WeaponSecondaryKind,
  type WeaponLadderRung, type AccessoryLadderRung, type AccessoryEffectDecision,
  type EffectiveStatField,
} from "./dw3/equipment.ts";
export { shopEquipSlot, shopEquipSwap, equipApplyRecord } from "./dw3/equipment.ts";
// The one commit order for closing the translated merchant (web/shop-translated.js):
// replay the hand swaps it made through the store, then take the bag from the
// count arrays the screen's own block holds. Decode: stitshop F0x8008C800,
// file 0x9B50 (RAM 0x8008C800).
export { commitMerchantClose, type MerchantCloseState } from "./dw3/ui/shop-close-commit.ts";
// The ONE commit for closing a pause page, shared by the translated route
// (web/status-translated.js) and the original-code reference route
// (web/status-native.js): the record's writes and the wear changes first, the bag
// the page's own count arrays hold last. Decode: pro/ststatus F0x8009A3E8
// (file 0x17738) moves one count between the worn and held bytes in the page's own
// arrays, so the held array handed back already carries the move.
export {
  commitPauseClose, PAUSE_MONEY_CAP,
  type PauseCloseInput, type PauseCloseRecord, type PauseCloseResult,
  type PauseCloseState, type PauseCloseStorage, type PauseCloseCards,
} from "./dw3/ui/pause-close-commit.ts";
// The ONE element value every screen and every battle leaf reads: the
// F0x80017174 scratch's +0x18..+0x24 halfword (species base + every trained
// point + the worn gear's resist, 999-capped). Oracle:
// tests/lane-b/effective-stats-element.test.js.
export {
  elementValue, elementValues, battleElementValue,
  addFoldedStat, battleCoreStat,
  ELEMENT_KEYS, ELEMENT_FLOOR, STAT_CLAMP,
  type ElementSources,
} from "./dw3/effective-stats.ts";
export { computeEquipPreview, type EquipPreview, type EquipPreviewRow } from "./systems/equip-preview.ts";
export {
  quoteInnStay, restAtInn, innBankIndex, innForStage, innStages,
  isInnLauncherIndex, INN_NAMES, INN_BANK, INN_RECORDS, INN_ALIAS_STAGES,
  type InnMember, type InnQuote, type InnRecord, type InnRestResult,
} from "./dw3/inn.ts";
// The 25 decoded save points and the memory-card slot each one selects.
export {
  SAVE_POINTS, SAVE_POINT_PLACE_BASE, savePointForStage, savePointBySlot,
  savePointLaunchCode, savePointPlaceIndex, type SavePoint,
  type SavePointAlias,
} from "./dw3/save-points.ts";
// The partner roster (the disc's eight slots, then the new partners) and the Digimon Lab's
// obtained-minus-deployed rule.
export {
  ROSTER_SLOT_COUNT, DISC_ROSTER_SLOT_COUNT, MAX_ROSTER_SLOTS, DEPLOYED_PARTY_CAP, ROSTER_SLOT_CHARIDS,
  rosterSlotDigimonId, rosterSlotOfCharId, partyPositionRosterSlot, withRosterSlot, rosterSlotOwned,
  ownedRosterSlots, reserveRosterSlots, rosterMaskForParty,
  registerNewPartners, newPartnerOfSlot, newPartnerList, isDiscRosterSlot, rosterSlotOfDigimonId,
  isStarterDigimonId, isFormDigimonId, rosterGearSlot, type NewPartner,
} from "./dw3/roster.ts";
export { rosterRecordAddress, rosterContextBase, EXTRA_ROSTER_RECORDS } from "./dw3/roster-records.ts";
// Shared UI object layer — the classes the original builds every screen from.
export * as ui from "./dw3/ui/index.ts";
// The in-battle DNA command's own rule, promoted for web/battle.js so the DNA
// command and the DNA pane (native/battle-dna-menu.ts, which calls these two
// itself) answer from one place over one copy of the two extracted tables.
// Decode: .bunny-scratch/dnacommand-report.md (2026-10-03).
export {
  dnaActionRecord, dnaActionPrice, dnaPairing,
  DNA_COMBATANT_STRIDE, DNA_PRICE_STRIDE, DNA_PRICES, DNA_PROFILE_ROWS, DNA_SPECIES_TABLE,
  type DnaActionRecord, type DnaPairingAnswer, type DnaPairingMemory,
} from "./dw3/ui/native/battle-dna-menu.ts";
// Every branch on the DNA path from the TAG command to the fused Digimon, as one
// table, and the phase's answer decode over it — promoted for web/battle.js so
// the battle, the forced replacement and the two panes cannot answer differently.
// Decode: docs/research/battle/dna-path-branches-2026-10-04.md.
export {
  DNA_PATH_BRANCHES, DNA_PATH_BRANCH_IDS,
  DNA_PHASE_CODE, dnaAnswerAction, dnaAnswerForm, dnaTagBranchKind,
  type DnaAnswerAction, type DnaPathBranch, type DnaPathBranchKind,
} from "./dw3/battle-dna-branches.ts";
// The ONE mapping between the walker's Digimon ids and the game's form ids, and
// the row it lands in — promoted for web/battle.js so the DNA command's pairing
// rule and the DNA pane's own seed cannot answer about different Digimon. This is
// the species getter's own table (native/pause-status.ts `gameFormId` =
// F0x800134E8's value0 halfword, read the other way round), not a second list.
// Decode: .bunny-scratch/dnaseed-report.md (2026-10-03).
export {
  gameFormId, PROFILE_ROWS, walkerIdOf, walkerProfileRow,
  registerExtraProfiles, extraProfileCount, extraRowFormId, EXTRA_FIRST_ID, EXTRA_PROFILE_BASE,
  type ProfileTableMemory,
} from "./dw3/ui/native/pause-status.ts";
// The extra species' unlock records, tried by the results screen's unlock routine after the disc's own 44 per line
// (web/extra-roster.js registers them; web/fightreport-translated.js says what each partner already owns).
export { registerExtraEvolutionRows, setReportOwnedForms } from "./dw3/ui/native/fight-report-rewards.ts";
// The in-battle message line: the pro/fightstg panel's ports, promoted for the browser
// adapter web/battlemsg-translated.js and its consumer web/battle.js.
// Decode: .bunny-scratch/battlemsg-report.md (2026-10-02).
export {
  BattleMessageSession, battleMessageCompose, battleMessageBANKs,
} from "./dw3/ui/battle-message-session.ts";
export {
  BATTLE_MESSAGE_AUTO_CLOSE, BATTLE_MESSAGE_AUTO_CLOSE_TICKS,
  BATTLE_MESSAGE_CLOSE_BIT, BATTLE_MESSAGE_ARMS, BATTLE_MESSAGE_BANK,
  BATTLE_MESSAGE_BANK_FIELD, BATTLE_MESSAGE_DRAW,
  BATTLE_MESSAGE_EL_SET_NUMBER, BATTLE_MESSAGE_EL_SET_SLOT,
  BATTLE_MESSAGE_EL_SET_STRING, BATTLE_MESSAGE_EL_VISIBLE, BATTLE_MESSAGE_FONT_KIND,
  BATTLE_MESSAGE_HOLD_TICKS, BATTLE_MESSAGE_KIND_MAX, BATTLE_MESSAGE_KIND_TABLE,
  BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_LINE1, BATTLE_MESSAGE_LINE2,
  BATTLE_MESSAGE_LINE_DELAY_TICKS, BATTLE_MESSAGE_LINE_MAX_WIDTH, BATTLE_MESSAGE_NAME,
  BATTLE_MESSAGE_PANEL_BOX, BATTLE_MESSAGE_PANEL_CEL, BATTLE_MESSAGE_PANEL_H,
  BATTLE_MESSAGE_PANEL_PACK, BATTLE_MESSAGE_PANEL_W, BATTLE_MESSAGE_PANEL_X,
  BATTLE_MESSAGE_PANEL_Y, BATTLE_MESSAGE_PHASE_AUTO, BATTLE_MESSAGE_PHASE_GAP,
  BATTLE_MESSAGE_PHASE_READY, BATTLE_MESSAGE_PHASE_SHOW, BATTLE_MESSAGE_PHASE_TABLE,
  BATTLE_MESSAGE_PHASE_WAIT, BATTLE_MESSAGE_PRESS_SOUND, BATTLE_MESSAGE_PROMPT_CEL,
  BATTLE_MESSAGE_PROMPT_CLIP,
  BATTLE_MESSAGE_PROMPT_FRAMES, BATTLE_MESSAGE_PROMPT_GATE, BATTLE_MESSAGE_PROMPT_PACK,
  BATTLE_MESSAGE_PROMPT_SIZE, BATTLE_MESSAGE_PROMPT_TICKS, BATTLE_MESSAGE_PROMPT_X,
  BATTLE_MESSAGE_PROMPT_Y, BATTLE_MESSAGE_REVEAL, BATTLE_MESSAGE_SET_VISIBLE,
  BATTLE_MESSAGE_STATE_DONE, BATTLE_MESSAGE_STATE_FRESH, BATTLE_MESSAGE_STATE_OPEN,
  BATTLE_MESSAGE_TICK, BATTLE_MESSAGE_TEXT_SCALE, BATTLE_MESSAGE_CURSE_INDEX,
  battleMessageArm, battleMessageDraw, battleMessageKindFor,
  battleMessageLineIndex, battleMessageNamesLineOne, battleMessagePromptClipId,
  battleMessagePromptFrame, battleMessageShow,
} from "./dw3/ui/native/battle-message-line.ts";
export {
  BATTLE_MESSAGE_CURSE_WORDS, BATTLE_MESSAGE_PAGE_ARMS, BATTLE_MESSAGE_PAGE_KINDS,
  battleMessagePage, battleMessagePageArm,
} from "./dw3/ui/native/battle-message-pages.ts";
export type {
  BattleMessagePage, BattleMessagePageArgs,
} from "./dw3/ui/native/battle-message-pages.ts";
// The record machine FIGHTSTG_F0x8008f714: the 18-byte technique records at
// 0x80042bca and the five category handlers behind the table at .L0x80083004.
export {
  DAMAGE_TERM_AFFINITY_ARMS, DAMAGE_TERM_AFFINITY_DIVISOR,
  DAMAGE_TERM_AFFINITY_RECORD_OFFSET, DAMAGE_TERM_AFFINITY_TECH_OFFSET,
  DAMAGE_TERM_ARMS_CATEGORY4, DAMAGE_TERM_ARMS_CATEGORY5, DAMAGE_TERM_BLAST_WORD_BASE,
  DAMAGE_TERM_CANNOT_DIGIVOLVE_WORD, DAMAGE_TERM_CANNOT_RUN_WORD, DAMAGE_TERM_CATEGORIES,
  DAMAGE_TERM_CATEGORY_MAX, DAMAGE_TERM_CATEGORY_MIN, DAMAGE_TERM_CHI_WORD,
  DAMAGE_TERM_CLEARED_EVENT_CODES, DAMAGE_TERM_CURE_BITS, DAMAGE_TERM_CURE_MASKS,
  DAMAGE_TERM_CURE_QUIET_WORDS, DAMAGE_TERM_CURE_WORDS,
  DAMAGE_TERM_DAMAGE_CAP, DAMAGE_TERM_EVADE_WORD,
  DAMAGE_TERM_FIRST_ID,
  DAMAGE_TERM_GENERATE_WORD, DAMAGE_TERM_HANDLERS, DAMAGE_TERM_HANDLER_TABLE,
  DAMAGE_TERM_HEAL_POWER_ID,
  DAMAGE_TERM_HEAL_POWER_SHIFT, DAMAGE_TERM_HEAL_WISDOM_SHIFT,
  DAMAGE_TERM_KIND9_EFFECT_WORDS, DAMAGE_TERM_KIND9_SCAN_TESTS,
  DAMAGE_TERM_NO_EFFECT_WORD, DAMAGE_TERM_REGEN_WORD, DAMAGE_TERM_REPEAT_WORD,
  DAMAGE_TERM_ROLLED_CATEGORIES, DAMAGE_TERM_ROLL_DIGIVOLVE, DAMAGE_TERM_ROLL_FLEE,
  DAMAGE_TERM_ROLL_STATUS, DAMAGE_TERM_ROW_COUNT, DAMAGE_TERM_STATUS_ROLL_PROFILES,
  DAMAGE_TERM_STAT_BLOCK_BASE, DAMAGE_TERM_STAT_NAMES, DAMAGE_TERM_STAT_RECORD_OFFSETS,
  DAMAGE_TERM_STAT_ROWS, DAMAGE_TERM_STAT_TABLE_ONE, DAMAGE_TERM_STAT_TABLE_PARTY,
  DAMAGE_TERM_STAT_WORDS,
  DAMAGE_TERM_STRIDE,
  DAMAGE_TERM_TABLE_BASE, category4RestorePlan, category5Plan, consumeAffinity,
  damageTermAffinityArm,
  damageTermAffinityByte, damageTermAffinityIds, damageTermAffinityMultiplier,
  damageTermCategoriesIn,
  damageTermCategory4Arm, damageTermCategory5Arm, damageTermCategory5Side,
  damageTermCategoryRolls, damageTermClamp,
  damageTermHandler, damageTermHealAmount, damageTermMpMoved, damageTermPartyWord,
  damageTermRoll, damageTermStatApplies, damageTermStatModifier, damageTermStatRow,
  damageTermStatusRollBlocked,
  damageTermPostHitArm, damageTermPostHitArmRuns, damageTermPenaltyMode,
  damageTermPenaltyRoll, applyDamageTermPenalty,
  applyDamageTermPoison, applyDamageTermSleep, damageTermPostHitApplier,
  damageTermPenaltySlotStat, damageTermPenaltyByStat,
  DAMAGE_TERM_POST_HIT_ARMS, DAMAGE_TERM_POST_HIT_COUNT, DAMAGE_TERM_POST_HIT_FIRST,
  DAMAGE_TERM_POST_HIT_RETURN, DAMAGE_TERM_POST_HIT_TABLE,
  DAMAGE_TERM_PENALTY_BASE_OFFSET, DAMAGE_TERM_PENALTY_DISPATCHES,
  DAMAGE_TERM_PENALTY_ROLL, DAMAGE_TERM_PENALTY_SLOT_COUNT,
  DAMAGE_TERM_PENALTY_SLOT_STATS,
  damageTermNameSelector, damageTermPage, damageTermStatWord, damageTermTechniqueIds,
  techniqueResultPath, techniqueResultPaths,
} from "./dw3/battle-damage-terms.ts";
export type {
  Category4Restore, Category4Slot, Category5Options, Category5Plan, Category5StatChange,
  Category5StatTarget, DamageTermAffinityArm, DamageTermArm,
  DamageTermCategory4Arm, DamageTermCategory5Arm,
  DamageTermCategory4ArmName, DamageTermCategory5Effect, DamageTermCategory5Target,
  DamageTermContext, DamageTermOptions, DamageTermRecord, DamageTermStatRow,
  DamageTermPostHitArm, DamageTermPenaltyInput, DamageTermPenaltyMode,
  DamageTermPenaltyResult, DamageTermPenaltyStat,
  DamageTermApplierInput, DamageTermApplierResult,
  TechniqueResultPath,
} from "./dw3/battle-damage-terms.ts";
export {
  emptyStatusEventPool, advanceStatusEvents, cureStatusEvent, cureAllStatusEvents,
  enqueueStatusEvent,
  findStatusEvent, pickNextStatusEvent, preemptStatusEvent, removeStatusEvent,
  stageStatusEventAilment, stageStatusEventLock, stageStatusEventSideTick,
  stageStatusEventStat, statusEventActionDelay, statusEventActionHandler,
  statusEventActionType, statusEventAilmentBit, statusEventAilmentCode,
  statusEventAilmentDelay, statusEventClamp, statusEventConfusionDelay,
  statusEventDelay, statusEventDelayArm,
  statusEventDivide2710, statusEventDraw, statusEventFreesSlot, statusEventIsqrt,
  statusEventLockBit, statusEventLockDelay, statusEventLockHeld, statusEventLockIndex,
  statusEventRecoveryDelay, statusEventStatDelay, statusEventStatDelayUnrefreshing,
  statusEventStatIndex, statusEventTickDelay,
  STATUS_EVENT_ACTION_HANDLERS, STATUS_EVENT_AILMENTS, STATUS_EVENT_ALL_CURE_CODES,
  STATUS_EVENT_CODES,
  STATUS_EVENT_CONSUMER_ACTION_TYPES, STATUS_EVENT_DELAY_ARMS,
  STATUS_EVENT_KEEP_QUEUED_CODES,
  STATUS_EVENT_LOCK_CODES, STATUS_EVENT_OPCODE_PARAMS, STATUS_EVENT_POOL_SIZE,
  STATUS_EVENT_STAT_CODES, STATUS_EVENT_STRIDE,
} from "./dw3/battle-status-events.ts";
export type {
  StatusEventAilmentStage, StatusEventCodeRow, StatusEventEntry, StatusEventExpiry,
  StatusEventOwnDelayInput, StatusEventPick,
  StatusEventPool, StatusEventPortState, StatusEventSpeed,
} from "./dw3/battle-status-events.ts";
export { itemRecord, itemIconClip, itemClassEquals } from "./dw3/item-record.ts";
export { loadAudioArchive, ensureSoundArchiveLoaded, releaseVabSlot } from "./dw3/audio-archive.ts";

// Phase 4 translations (docs/plans/2026-09-14-native-screen-port-plan.md): each is
// proven against the interpreter by an oracle test that runs the original address.
export {
  PARTY_CONTEXT, PARTY_MAP, ROSTER_RECORDS, ROSTER_STRIDE, CUR_STATS, RECORD_FIELDS,
  CHARACTER_RECORDS, CHARACTER_STRIDE, CURRENT_SHOP_ID,
  SCREEN_TRANSITION_A, SCREEN_TRANSITION_B,
  RECORD_CORE_STATS, RECORD_BOOST_GROUPS, foldRecordCoreIntoBonuses,
  foldRecordElementsIntoBonuses, foldRecordStatsIntoBonuses,
  partyPositionToRosterSlot, persistentRosterSlot, getPadButtons4A,
  getCurrentShopId, requestScreenTransition, getFollowerRosterSlot,
} from "./dw3/party-context.ts";
export type { MemoryReader, HalfwordReader, StatCarrier, RecordStatFold } from "./dw3/party-context.ts";
export { zeroFill } from "./dw3/zero-fill.ts";
export { LBA_LEN_SECTORS, getLbaSectorLength } from "./dw3/disc-tables.ts";
export { memcpyBytes, strlenBytes, strcpyBytes } from "./dw3/byte-ops.ts";
export {
  RESOURCE_SERVICE_ACTIVE, CACHE_SLOTS, CACHE_SLOT_COUNT, CACHE_SLOT_STRIDE,
  isResourceServiceReady, findFreeCacheSlot, findCacheSlotById, freeCacheSlotBlock,
} from "./dw3/resource-service.ts";
export type { CacheSlotMemory, CacheFreeHost, WordReader } from "./dw3/resource-service.ts";
export { RECT_COLOUR, setRectColour } from "./dw3/display-view.ts";
export { putchar, flushStdout } from "./dw3/psx-stdio.ts";
export type { PsxStdioHost } from "./dw3/psx-stdio.ts";
export { printfFormat, printfWrap, PRINTF_NULL_STRING, PRINTF_GPU_TIMEOUT_FMT, PRINTF_DISPATCH } from "./dw3/psx-stdio.ts";
export {
  I_MASK_PTR_ADDR, DRAW_AREA_WIDTH, DRAW_AREA_HEIGHT,
  setDrawTPage, setIntrMask,
  drawTexPageCommand, drawAreaStartCommand, drawAreaEndCommand,
  drawOffsetCommand, texWindowCommand,
  setDrawEnvPacket, buildDrawEnvPacket,
} from "./dw3/psx-env.ts";
export {
  VBLANK_DEADLINE, VBLANK_ITERATION, VIEW_ANCHOR, BUFFER_X_OFFSETS, BUFFER_Y_OFFSETS,
  VIEW_DRAW_ENV, VIEW_DRAW_OFFSETS, VIEW_OFFSET_STORE, BUFFER_INDEX, DOUBLE_BUFFER_FLAG,
  GS_3D_VIEW_WIDTH, GS_3D_VIEW_HEIGHT, GS_3D_MODE, GS_3D_FLAG, GS_3D_MAX, GS_3D_MAX_VALUE,
  GPU_QUEUE_TAIL, CLEAR_OTAG_HEAD, GPU_DEBUG_LEVEL, GPU_DEBUG_DISPATCH,
  GPU_FUNCTION_TABLE, GPU_DEBUG_ARG0,
  setAlarm, updateViewAnchor, gsInit3D, clearOtagR, putDrawEnv, positionDrawEnv,
} from "./dw3/psyq-video.ts";
export type { PsyqVideoMemory, PsyqVideoHost, ClearOtagHost } from "./dw3/psyq-video.ts";
export {
  HEAP_DESC, HEAP_HEAD, HEAP_LAST, HEAP_EVICT_CELL,
  heapAllocForward, heapAllocReverse, heapAllocRetry, heapAllocRetryHigh, heapAllocZeroed,
} from "./dw3/heap-alloc.ts";
export type { HeapAllocMemory, HeapAllocHost } from "./dw3/heap-alloc.ts";
export { fetchTableEntry } from "./dw3/ui/fetch-table.ts";
export {
  FADE_WASH, FADE_WASH_HANDLER, FADE_WASH_CREATE, FADE_WASH_TICK, FADE_WASH_DRAW, FADE_WASH_RECT,
  createFadeWash, fadeWashHandler, fadeWashTick, fadeWashDraw,
  fadeWashSetColours, fadeWashStart, fadeWashIsIdle, fadeWashStop,
} from "./dw3/ui/fade-wash.ts";
export type { FadeWashMemory, FadeWashHost } from "./dw3/ui/fade-wash.ts";
export {
  PHASE_BANNER_STEP, INTER_PHASE_TABLE, PAD_RECORD_TABLE, padWord, padBitShift,
  queueInterPhaseBanner, showPhaseBanner, tickPhaseBanner,
} from "./dw3/ui/phase-banner.ts";
export type { PhaseBannerMemory, PhaseBannerHost } from "./dw3/ui/phase-banner.ts";
export {
  DUEL_MODE, DUEL_ENTER_TABLE, DUEL_UPDATE_TABLE, DUEL_RUN_MODE_MACHINE, DUEL_INIT_MODE_STATE,
  initDuelModeState, runModeMachine, enterModeClearBoth, enterModeClearSub, enterModeFive,
  enterModeEight, enterModeNine, updateModeOne, updateModeTwo, updateModeThree, updateModeFour,
  updateModeFiveSeven, updateModeSix, updateModeEight, updateModeNine, updateModeTen,
} from "./dw3/ui/duel-mode-machine.ts";
export type { DuelModeMemory, DuelModeHost } from "./dw3/ui/duel-mode-machine.ts";
export { DUEL_TICK_ARM, DUEL_TICK, cardDuelTick } from "./dw3/ui/duel-tick.ts";
export type { DuelTickMemory, DuelTickHost } from "./dw3/ui/duel-tick.ts";
export {
  DUEL_SCENE_HANDLER, DUEL_OBJECT_SIZE, DUEL_OBJECT_EXTRA, DUEL_METHOD_SLOTS,
  DUEL_SELECTOR, DUEL_START_ARCHIVE, createCardDuel,
} from "./dw3/ui/duel-create.ts";
export type { DuelCreateMemory, DuelCreateHost } from "./dw3/ui/duel-create.ts";
export {
  QUEUE_GREY_FLAGS, QUEUE_ANNOUNCE, QUEUE_ANNOUNCE_TABLE,
  applyQueuedGreyFlags, runQueuedAnnounce,
} from "./dw3/ui/duel-queue.ts";
export type { DuelQueueMemory, DuelQueueHost } from "./dw3/ui/duel-queue.ts";
export {
  DUEL_VIEW_QUEUE, DUEL_SCENE_VIEW, DUEL_BROWSE_TABLE, DUEL_SLOT_TWEEN_SCALE,
  DUEL_VIEW_QUEUE_CADENCE, DUEL_SLOT_SPAN_LONG, DUEL_SLOT_SPAN_SHORT, DUEL_CENTRE_ROW_SLOT,
  DUEL_OPPONENT_ROW_OFFSET, DUEL_VIEW_NEXT_AFTER_17, DUEL_VIEW_NEXT_AFTER_18,
  PENDING_VIEW_ARMS, CURRENT_VIEW_ARMS, dispatchDuelViewQueue,
} from "./dw3/ui/duel-view-queue.ts";
export type { DuelViewQueueMemory, DuelViewQueueHost } from "./dw3/ui/duel-view-queue.ts";
export {
  VIEW_OPENER_SOUND_CELL, VIEW_OPENER_SOUND_ID, BANNER_RECORD, BANNER_FULL_SCALE,
  BANNER_UNITS, PROMPT_RECORD, PANEL_RESET, openBannerSlot, openPromptSlot, resetViewPanels,
} from "./dw3/ui/view-openers.ts";
export type { ViewOpenersMemory, ViewOpenersHost } from "./dw3/ui/view-openers.ts";
export {
  CARD_BATTLE_SCENE_ENTRY, CARD_BATTLE_SCENE_CTOR, CARD_BATTLE_SCENE_SIZE, CARD_BATTLE_SCENE_EXTRA,
  CARD_BATTLE_SCENE_STATE, CARD_BATTLE_SCENE_SUB, CARD_BATTLE_SCENE_HANDOVER, CARD_BATTLE_SCENE_DONE,
  CARD_BATTLE_PACKET_SIZE, CARD_BATTLE_REGION_X, CARD_BATTLE_REGION_Y, CARD_BATTLE_RECT,
  CARD_BATTLE_POOL, CARD_BATTLE_HANDLE, CARD_BATTLE_COLOUR, CARD_BATTLE_PACK_A, CARD_BATTLE_PACK_B,
  CARD_BATTLE_PAIR_A, CARD_BATTLE_PAIR_B, CARD_BATTLE_EXIT_VALUE, CARD_BATTLE_PARTY,
  cardBattleSceneTick, createCardBattleScene,
} from "./dw3/ui/card-battle-scene.ts";
export type { CardBattleSceneMemory, CardBattleSceneHost } from "./dw3/ui/card-battle-scene.ts";
export {
  DUEL_SCENE_HANDLER_ENTRY, DUEL_SCENE_STATE, DUEL_PACK_ID, DUEL_PACK_HANDLE,
  DUEL_FADE_MODE, DUEL_FADE_FRAMES, DUEL_OUTCOME_STATE, DUEL_OUTCOME_FLAG,
  DUEL_SCENE_DONE, DUEL_NO_DRAW_FLAG, DUEL_SOUND_OUTRO, DUEL_SOUND_REMATCH,
  cardDuelSceneHandler,
} from "./dw3/ui/duel-scene-handler.ts";
export type { DuelSceneMemory, DuelSceneHost } from "./dw3/ui/duel-scene-handler.ts";
export {
  INTRO_CUE_HANDLER, INTRO_CUE_SIZE, INTRO_CUE_TABLE, INTRO_CUE_FIELDS,
  createIntroVoice, introVoiceCueTick,
} from "./dw3/ui/intro-cue.ts";
export type { IntroCueMemory, IntroCueHost } from "./dw3/ui/intro-cue.ts";
export {
  OPPONENT_DECK_FIELDS, OPPONENT_DECK_PACK_ID, OPPONENT_DECK_STRIDE, OPPONENT_DECK_RECORD,
  OPPONENT_DECK_TYPE_OFFSET, OPPONENT_DECK_SLOT_TABLE, loadOpponentDeck,
} from "./dw3/ui/opponent-deck.ts";
export type { OpponentDeckMemory, OpponentDeckHost } from "./dw3/ui/opponent-deck.ts";
export {
  physicalBase, magicalBase, resolveDamage, rollHit, rollMagicHit, fleeChance, escapeThreshold, runAwayLine,
  ESCAPE_BASE_DEFAULT, drainHeal, drainProcRoll, RAND_U16,
  gaugeGain, boostedGaugeGain, hitGaugeGain, levelTier, blastTargetId, counterCrestProc, enemyFleeProc,
  statusRoll, statusInflictionRoll, ailmentOfEffect, poisonTimelineDamage, regenTick, frozenBlockRoll,
  actionTimelineDelay, initialActorTimeline, scheduleNextActor,
  counterDamage,
  enemyMoveCondition,
  pickEnemyAiMove,
  hpFractionThreshold,
  signedDiv100,
  enemyActionSkillId,
  statusPowerAfterResistance,
  elementalFieldAdjustment,
  elementId,
  basicAttackHitCount,
  techniqueMpCost,
  specialModeDamage,
  specialModeLowHpEscape,
  type TimedAilment, type ElementalField,
  type EscapeRoll,
} from "./dw3/battle-formulas.ts";
export type { ActorTimeline } from "./dw3/battle-formulas.ts";
// The game's ONE random stream: the disc's own table walk at [0x8004dc0c], which
// every battle roll, the idle camera's shot walk and the stage-object heading now
// share. `RAND_U16` above is this module's `randU16`.
export {
  DISC_RAND_TABLE, RAND_STREAM, randU16, randU16SetSeed, randU16Index,
} from "./dw3/random-stream.ts";
export {
  foldElemBonuses, combatantElements, combatantStatusResist,
  effStats, resolveAttack, resolveMultiHit, resolveAttackSequence,
  weaponSecondaryProc, weaponDrainHeal, type WeaponSecondaryResult,
  applyAilment, tryInflict, tryInstantDeath, processTurnStart, frozenGateBlocksTurn,
  advanceAilmentTimeline, advanceAilmentTimers,
  partyIconIndex, partyIconCel,
  statPenaltyOf, addStatPenalty, clearStatPenalty,
} from "./dw3/battle-combat.ts";
// What the original shows for an ailment in a 3D battle (decoded 2026-10-04):
// the plate's party marker, plus the game's own one-word line. No status icon exists.
export {
  AILMENT_INFLICT, AILMENT_CURE, AILMENT_MESSAGE_BANK, AILMENT_MESSAGE_KIND,
  AILMENT_NAME_MESSAGE_ID, AILMENT_RECORD_BYTE, AILMENT_MARKER_STATE,
  AILMENT_MARKER_CEL_ACTIVE, AILMENT_MARKER_CEL_INACTIVE, AILMENT_MARKER_Y,
  AILMENT_MARKER_X_TABLE, AILMENT_MARKER_XS,
  ailmentInflictMessageId, ailmentInflictWord, ailmentMarkerCel, ailmentMarkerCount,
  // The four box pages an ailment's life produces (decoded 2026-10-04): the landed
  // word as its own page, the turn-start gate's line, the poison tick and the
  // gradual-HP-recovery tick (kind 10, added 2026-10-04).
  ailmentInflictMessageSpec, ailmentTurnStartMessageSpec, poisonTickMessageSpec,
  regenTickMessageSpec,
  AILMENT_TURN_START_ASLEEP, AILMENT_TURN_START_FROZEN,
  AILMENT_TURN_START_CONFUSE_BASE, AILMENT_TURN_START_CONFUSE_COUNT,
  POISON_TICK_MESSAGE_ID, POISON_TICK_MESSAGE_KIND,
  REGEN_TICK_MESSAGE_ID, REGEN_TICK_MESSAGE_KIND,
} from "./dw3/battle-ailment-display.ts";
export type { TurnStart, TurnStartSpec } from "./dw3/battle-combat.ts";
export type { AilmentKey } from "./dw3/battle-ailment-display.ts";
// The one machine that decides which line a landed blow shows: FIGHTSTG_F0x8008cb70's
// five arms over the header's 37-slot result-event queue.
export {
  chooseResultPage, resultQueueSlot, RESULT_QUEUE, RESULT_PAGE_ARMS,
  RESULT_PAGE_ARM_KIND, RESULT_PAGE_ARM_HEADER_OFFSET, RESULT_HEADER_LANDED_OFFSET,
  RESULT_PAGE_EVADE_WORD,
} from "./dw3/battle-result-page.ts";
export type {
  ResultPageArm, ResultPageChoice, ResultPageFacts,
} from "./dw3/battle-result-page.ts";
export {
  useBattleItem, isBattleEffectItem, FIELD_ELEMENTS, FIELD_MESSAGE_IDS, fieldMessageId,
  chargeHealPage, chargeNoEffectPage, itemAnnouncementPage,
  ITEM_PAGE_KIND_ONE_LINE, ITEM_PAGE_KIND_OUTCOME, ITEM_PAGE_KIND_DAMAGE,
  ITEM_PAGE_KIND_NAME_LINE, ITEM_PAGE_KIND_HEALED, ITEM_PAGE_KIND_SILENT,
  ITEM_PAGE_KIND_ANNOUNCE, ITEM_NAME_BANK,
  ITEM_NO_EFFECT_ID, ITEM_CONFUSED_ID, ITEM_EVADED_ID, ITEM_NAME_ENEMY,
} from "./dw3/battle-items.ts";
export type { BattleItemTarget, BattleItemResult, BattleItemPage } from "./dw3/battle-items.ts";
// Pause-menu TECHNIQUES screen. Ledger: UI-PAUSEMENU-TECHNIQUES-ARE-HEALS-2026-08-14.
export {
  FIELD_TECH_FIRST_ID, FIELD_TECH_COUNT, FIELD_TECH_MAX_ROWS, HEAL_SCALE_STAT,
  isFieldTechnique, isPartyWide, fieldTechniqueRows, healAmount, useFieldTechnique,
} from "./dw3/field-techniques.ts";
export type {
  FieldHealTarget, FieldHealCaster, FieldHealResult,
} from "./dw3/field-techniques.ts";
export {
  JOKE_COMMANDS, JOKE_FLAVOR, ENEMY_GAG_LINES,
  JOKE_GAG_BANK, JOKE_GAG_KIND, JOKE_GAG_NAME_ID, JOKE_FLAVOR_FIRST_ID,
  shuffleJokeMenu, jokeFlavorLine, jokeFlavorPick, jokeFlavorMessageId, enemyGagLine,
  confusionGagRoll,
} from "./dw3/battle-confusion.ts";
export type { JokeMenuEntry } from "./dw3/battle-confusion.ts";
export {
  battleFormIds, tagCandidateIndices, activeKoResolution, findDnaEvolution, canPayDnaCost,
  dnaRejection,
} from "./dw3/battle-party.ts";
export type {
  BattleFormLedgerRecord, BattlePartyStats, BattlePartyMember, ActiveKoResolution,
  DnaEvolution, DnaMatch, DnaParticipants, DnaRejection,
} from "./dw3/battle-party.ts";
export { chapterNpcs, stageCast, removeSceneActor, deriveChapter, pickDialogue, pickDialogueState, selectNpcDialogue, applyNpcPrograms, confirmProbeTarget, confirmProbeContains, talkCandidates, resolveConfirmTarget, confirmRefusesTarget, CONFIRM_REFUSED_IDS } from "./dw3/npc-manager.ts";
export { npcHalfWidth } from "./dw3/npc-sizes.ts";
export { confirmRedirectId, confirmRedirectPairs, NPC_CONFIRM_REDIRECT_TABLE_RAM } from "./dw3/npc-confirm-redirects.ts";
// Wrap-maze exit graph (Mobius Desert / Seabed / Circuit Board). Ledger: maze-exit-record-table.
export { resolveMazeExit, currentSection, isHole } from "./dw3/maze.ts";
export type { MazeExit, MazeSection } from "./dw3/maze.ts";
export { exitGatePasses } from "./dw3/exit-gates.ts";
export type { ExitGate, GatedExit, FlagConditionReader } from "./dw3/exit-gates.ts";
export { nearestNpc, nearestFacingNpc, hitRect, faceToward, boxTarget } from "./systems/map-manager.ts";
export * as collision from "./core/util/collision.ts";
export {
  CELL, createGrid, fromJSON, isBlocked, moveWithCollision, rectBlocked,
  setBlocked, terrainCodeAt, toJSON,
  terrainHeightGate, terrainGateBlocks,
} from "./core/util/collision.ts";
// Falling objects: the stage overlay's own rockfall actor (a resident state
// machine over a per-stage 16-byte record table), ported once so the boulders
// draw without the MIPS interpreter. See engine/systems/falling-object.ts.
export {
  FALLING_SEQUENCE_END, FALLING_DESPAWN_Y, FALLING_BOUNCE_SOUND,
  stepFallingSequence, fallingObjectSlot, createFallingObject,
  tickFallingObject, fallingObjectDraws,
  type FallingObjectRecord, type FallingObjectBuilder, type FallingObjectConfig,
  type FallingObject, type FallingDraw, type SequenceCursor,
} from "./systems/falling-object.ts";
// THE point-record actor system: every field stage object that claims its own
// stage's dormant point-sprite records by their atlas tag and animates them --
// all seventeen members in ONE module (the Asuka City download halos, the login
// flash, the Kusanagi City / Undersea Base decor, the s805/s810/s820 picture
// drivers, the Bios Swamp shrine sprite and the rising cave row), plus the
// CHILD-POOL PARENT (s545's 848), which is the same machine with an array of
// child objects. Ported once so none of them needs the MIPS interpreter; see
// engine/systems/point-record-actor.ts.
export {
  POINT_RECORD_SCRIPT_END, POINT_RECORD_BLINK_OFF, POINT_RECORD_DELTA_CLAMP,
  claimRecord, claimedSameTagTwice, padSlotEnded,
  stepPointRecordCursor,
  pointRecordLive, pointRecordInView, tickPointSpriteRecords,
  applyPointModeGates, pointModeGatesFor,
  loadPointRecordActors, pointRecordActorStages, pointRecordActorIds,
  loadChildPoolParents, fireChildPoolParent,
  hasPointRecordActor, createPointActor,
  firePointRecordActor, constructPointRecordActors, setPointRecordActorSound,
  setPointRecordActorMusic,
  tickPointRecordActors, clearPointRecordActors, pointRecordActorState,
  pointRecordPadRun, firePictureSteps, pictureStepDraws,
  fireRideWalker, spawnRideWalker,
  loadScrollLayers, setScrollLayerFlag, fireScrollLayer, scrollLayerDraws,
  type PointRecord, type PointScriptEntry, type PointCursor,
  type PointStepperVariant, type PointEndArm, type PointStepOptions,
  type PointSpriteRecord, type PointSpriteRuntime, type PointSpriteFrame,
  type PointModeGate,
  type RecipeByte, type PointRecipe, type PointPanel, type PointMember,
  type PointActorTable, type PointPatch, type PointLive, type PointHost,
  type PointActor, type PointParentChild, type PointParentChildSpec,
  type PointParentClip, type PointPictureSteps,
  type PointRideWalker, type PointRideSub,
  type PointScrollLayer, type ScrollLayerSheet, type ScrollLayerState,
  type ScrollLayerDraw,
} from "./systems/point-record-actor.ts";
// Fixed still sprites: the stage overlays' own two-layer decoration player
// (s310 id 852 and s311 id 838), ported once for the whole family.
// See engine/systems/stage-fixed-sprite.ts.
// Display-slot channel players: the stage overlays' own writers into the
// field's 18-byte record chain (s305 id 850 and s306 id 851), ported once for
// the whole family. See engine/systems/stage-slot-player.ts.
export {
  SLOT_ACTIVE, SLOT_TAG, SLOT_SIZE, SLOT_CLIP, SLOT_STRIDE, SLOT_END_CLIP,
  claimSlot, slotPlayerFor, createSlotPlayer, configureSlotPlayer,
  slotPlayerBand, tickSlotPlayer,
  type SlotClip, type SlotBand, type SlotPlayerMember, type SlotPlayer,
} from "./systems/stage-slot-player.ts";
// Display-slot ensembles: the stage overlays' own writers of a RUN of six
// display slots (s310 ids 831 and 832, the A.o.A. Headquarters wall pictures),
// ported once for the whole family. See engine/systems/stage-slot-ensemble.ts.
export {
  ENSEMBLE_STEADY_MODE, ENSEMBLE_FLASH_MODE, ENSEMBLE_DARK_MODE,
  ENSEMBLE_END_CLIP, ENSEMBLE_CONFIGURE_SUB,
  ensembleFor, claimEnsembleSlots, createEnsemble, configureEnsemble,
  tickEnsemble,
  type EnsembleClip, type EnsemblePhase, type EnsembleCursor,
  type EnsembleReseed, type EnsembleMember, type EnsembleWrite, type Ensemble,
} from "./systems/stage-slot-ensemble.ts";
export {
  FIXED_SPRITE_END, FIXED_SPRITE_BURST_HIDE,
  FIXED_SPRITE_FRONT_LAYER, FIXED_SPRITE_BACK_LAYER,
  FIXED_SPRITE_BACK_Y, FIXED_SPRITE_BACK_SORT,
  FIXED_SPRITE_CANVAS_W, FIXED_SPRITE_CANVAS_H,
  stepFixedSpriteRun, fixedSpriteVisible, fixedSpriteFor, createFixedSprite,
  tickFixedSprite, setFixedSpriteBuildSound, playFixedSpriteBuildSound,
  type FixedSpriteStep, type FixedSpriteMember, type FixedSprite,
  type FixedSpriteDraw, type FixedSpriteCursor,
} from "./systems/stage-fixed-sprite.ts";
// The resident 2D draw-context service: registry object 0x1002, the twenty
// field overlays and fieldstg that reach it, and the two stage-owned
// annotators that draw through it. Ported once; see
// docs/research/field/draw-context-service-2026-10-04.md.
export {
  DRAW_CONTEXT_ID, DRAW_CONTEXT_SIZE, DRAW_CONTEXT_METHODS, DRAW_CONTEXT_TABLE,
  REGISTRY_TABLE, REGISTRY_SLOTS, REGISTRY_POINTERS, REGISTRY_IDS, FLUSH_SLOT,
  HEAD_SENTINEL, GP0, LAYER_PRIMITIVE_ORDER, SCREEN_BOX,
  effectiveRect, visibleInLayer, layerPrimitives, shapeCommand, DrawQueue,
  type DrawContextMethod, type DrawContextLayer, type DrawRect,
  type DrawRecord, type LayerClipRect,
} from "./systems/draw-context.ts";
export {
  ANNOTATOR_STAGE_USERS, ANNOTATOR_FAMILY_OVERLAYS, ANNOTATOR_PORTED_MEMBERS,
  DISC_TEST, COLUMN_TEST, COLUMN_KEY_OFFSET, S805_TEST, MARKER_SIZE,
  S805_ANNOTATOR_COLUMN,
  createS805Annotator, createS820Annotator, tickS805Annotator, tickS820Annotator,
  annotatorDraws, layerForField, annotatorCullRect, annotatorLayerBounds,
  stepWalk, ANNOTATOR_SHAPE_SETS, annotatorShapeQuads, annotatorShapeSetFor,
  type AnnotatorStageUser, type AnnotatorConfig, type AnnotatorChildState,
  type AnnotatorDraw, type StepCursor,
} from "./systems/shape-annotator.ts";
export {
  S805_ANNOTATOR_CHILDREN, S805_ANNOTATOR_DELAY, S805_ANNOTATOR_TABLES,
  S820_ANNOTATOR_RECORDS, S820_ANNOTATOR_DEFAULT, S820_ANNOTATOR_TABLES,
  type AnnotatorStep, type AnnotatorChild, type AnnotatorRecord,
} from "./dw3/annotator-tables.ts";
export { ANNOTATOR_SHAPE_SETS as ANNOTATOR_SHAPE_SET_TABLE } from "./dw3/annotator-tables.ts";
export {
  ANNOTATOR_SHAPE_SETS as ANNOTATOR_DIRECTORIES,
  type AnnotatorClip,
  type AnnotatorLayer,
  type AnnotatorShapeSet,
} from "./dw3/annotator-shapes.ts";
export * as saveManager from "./persistence/save-manager.ts";
// The native wstag MIPS interpreter and the mixed-mode bridge are deliberately
// NOT exported from this barrel. They live in engine/native-entry.ts, built to
// the research-only bundle web/vendor/engine-native.js, so the ordinary page
// (web/vendor/engine.js) carries no interpreter and no hidden machine-code
// fallback. See the standing requirement in AGENTS.md and the header of
// engine/native-entry.ts. Do not re-export engine/native/** from here.

/**
 * Linear story-ordinal step — the canonical home of the browser's former
 * `web/scene.js` helper of the same name. Advances `current` to the next beat defined
 * for this stage, but only when no other ladder ordinal lies strictly between (no skipping
 * ahead); returns `current` unchanged when there is no in-sequence step. Thin wrapper over
 * VariableManager.nextOrdinal (which returns null on a no-op) to preserve the JS contract.
 */
export function nextProgressOrdinal(
  current: number, stageOrdinals: number[], allOrdinals: number[],
): number {
  return VariableManager.nextOrdinal(current, stageOrdinals, allOrdinals) ?? current;
}

export interface EngineContent {
  stages: ConvertedStage[];
  ordinal: {
    allOrdinals: number[];
    byStage: Record<string, number[]>;
    // Per stage, the decoded OWNER of the master story ordinal: { eventId -> the ordinal its
    // on_complete routine stores into 0x8004b370 } (tools/extract_ordinal_owner.py). When a
    // stage appears here, the ordinal is written by that event and no other — see
    // completeEvent. Absent for a stage the extractor could not resolve: that stage keeps the
    // older ladder behaviour.
    byStageOwner?: Record<string, Record<string, number>>;
  };
  roster: RosterPredTable;
  // per-stage { eventId -> flag_key }, so the host can resolve StartEvent(evId) → cutscene
  // bytecode (keyed by flag_key in wstag_events). Optional for minimal/test content.
  flagKeys?: Record<string, Record<number, string>>;
}

export class GameEngine {
  readonly state = new GameState(DW3_BANK_SCHEME);
  readonly conditions = new ConditionEngine();
  readonly vm = new ScriptVM();
  readonly db = new ContentDB();
  readonly events: EventManager;
  // The pure turn engine is headless-constructible (resolvers have no host deps), so the
  // engine owns it directly. Cutscene/trigger/shop are host-bound → constructed in the browser.
  readonly battle: BattleManager<TurnActor & combat.Combatant, combat.Skill> =
    createBattleManager<TurnActor & combat.Combatant, combat.Skill>({
      resolveAttack: combat.resolveAttack,
      processTurnStart: combat.processTurnStart,
    });
  presentationLog: { op: string; args: number[] }[] = [];
  battleLog: { screenId: number; wonFlag: number }[] = [];
  // The reason the VM last yielded — the browser bridge inspects this to dispatch the
  // cutscene/battle, then resumes. Headless mode completes inline and still records it.
  lastYield: { kind: "event"; evId: number } | { kind: "battle"; screenId: number; wonFlag: number } | { kind: "native"; handler: string; args: number[] } | { kind: "other"; op: string; args: number[] } | null = null;
  currentStage = "";
  private content!: EngineContent;
  private programs = new Map<string, Instruction[]>();
  private readonly driven: boolean;
  private readonly screenTable: FieldScreenTable | undefined;

  // `driven: true` defers on_complete + battle to the host (the browser bridge plays the
  // cutscene/battle first, then calls completeEvent / sets the won flag). Default (headless)
  // completes synchronously so unit tests and the authenticity oracle stay self-contained.
  //
  // `onceStore` is the durable home of an event row's `once` bit. The original stores it in
  // the save context, so a once-only stage-entry/talk cutscene must not replay after Continue
  // or a reload: a host that wants that passes a store backed by its save, and two engine
  // instances sharing the store see the same fired set. Omitted = the old in-memory Set, which
  // is what the headless tests use.
  constructor(content: EngineContent, opts: {
    driven?: boolean;
    screenTable?: FieldScreenTable;
    healParty?: () => void;
    storyCommand?: (command: StoryCommand) => void;
    onceStore?: { get: (id: string) => boolean; set: (id: string) => void };
    // The bank-0x90 launcher's per-stage start sites (web/assets/data/talk_launch_
    // bindings.json). Installed here so `talkLaunchEventForBit` / `playLaunchedEvent`
    // answer from the same data the converter and the browser read.
    talkLaunch?: TalkLaunchBindings;
  } = {}) {
    this.content = content;
    this.driven = opts.driven ?? false;
    this.screenTable = opts.screenTable;
    if (opts.talkLaunch) setTalkLaunchBindings(opts.talkLaunch);
    registerDw3Flags(this.state.flags, content.roster);
    registerDw3Conditions(this.conditions);
    // set_flag's bank dispatch, built from the shipped tables: the roster ACTION records
    // (content.roster, `semantics.effect === "write"`) and the stored-bank list. Bank 0x74's
    // arm starts this stage's rate-0 encounter record, which the converter already wires as the
    // stage's PRE row, so there is nothing to call here — the write is consumed, as on the disc.
    const rosterWrites = (content.roster?.records ?? [])
      .filter((r) => r.semantics?.effect === "write")
      .map((r) => [r.flag_id, r.semantics!.kind] as const);
    this.setFlagPolicy = {
      stored: (bank) => DW3_BANK_SCHEME.storedBanks.has(bank),
      command: (command) => {
        if (command.kind === 'battle') {
          // Converted PRE/battle/POST rows use a host-owned pending-launch marker.
          // It is deliberately separate from get_flag, whose command read succeeds.
          this.state.vars.set(`$battle.launch.${command.index}`, true);
        }
        this.presentationLog.push({ op: 'StoryCommand', args: [command.index, command.screen ?? 0, command.parameter ?? 0] });
        opts.storyCommand?.(command);
      },
      rosterAction: (id) => {
        // The op-0x20 CURRENCY records (F0x80015aac over the BIT total, the same
        // $party.bit the AddMoney command writes): arm 1 ADD gains MONEY_GAINS[param2]
        // capped at 0x98967F; arm 2 SUBTRACT takes MONEY_LOSSES[param2] floored at 0
        // — the auction's bid write (claims fieldstg-endchoice-code-consequences-
        // 2026-10-09, fieldstg-auction-bid-questions-2026-10-09). Arm 0 is a read and
        // is answered by the flag bank (dw3-config.ts), never here. The amounts come
        // from the static EXE tables via bank70_rewards.json (converter-attached).
        const rec = (content.roster?.records ?? []).find((r) => r.flag_id === id);
        if (rec && (rec.op & 0xf0) === 0x20) {
          const arm = rec.op & 0xf;
          const amounts = content.roster?.amounts;
          const cur = Number(this.state.vars.get("$party.bit") ?? 0);
          if (arm === 1) {
            const gain = amounts?.add?.[rec.param2];
            if (gain !== undefined) {
              this.state.vars.set("$party.bit", Math.min(cur + gain, 0x98967f));
              return true;
            }
          } else if (arm === 2) {
            const loss = amounts?.subtract?.[rec.param2];
            if (loss !== undefined) {
              this.state.vars.set("$party.bit", Math.max(0, cur - loss));
              return true;
            }
          }
        }
        const kind = rosterWrites.find(([fid]) => fid === id)?.[1];
        if (kind === "heal_active_party") { opts.healParty?.(); return true; }
        return false;
      },
      // Banks 0x80–0x8E are the disc's per-id collection bytes, not a bit array: one
      // copy of that id joins (or leaves) the bag. It lands in `state.inventory`, the
      // one store `get_flag(0x80NN)`'s possession handler already reads
      // (dw3-config.ts), so a finished scene's grant is visible to the gates that ask
      // "do you have it yet?" — the disc's A[id] || B[id].
      collection: (index, value) => {
        collectionWrite(index, value, this.state.inventory);
        return true;
      },
    };

    const fired = new Set<string>();
    const onceStore = opts.onceStore
      ?? { get: (id: string) => fired.has(id), set: (id: string) => { fired.add(id); } };

    registerDw3Commands(this.vm, this.state, {
      startEvent: (evId) => {
        this.lastYield = { kind: "event", evId };
        if (!this.driven) this.completeEvent(evId);
      },
      presentation: (op, args) => {
        this.presentationLog.push({ op, args });
        this.lastYield = { kind: "other", op, args };
      },
      startBattle: (screenId, wonFlag) => {
        this.lastYield = { kind: "battle", screenId, wonFlag };
        // Headless default records intent; the bridge runs the real battle and, on victory,
        // sets wonFlag + re-raises the talk so the POST row fires.
        if (!this.driven) this.battleLog.push({ screenId, wonFlag });
      },
      native: (handler, args) => {
        this.lastYield = { kind: "native", handler, args };
        // Headless records intent; the driven bridge dispatches to the host native registry.
        if (!this.driven) this.presentationLog.push({ op: `native:${handler}`, args });
      },
      setFlag: (id, value) => this.writeStoryFlag(id, value),
      healParty: () => {
        // Bank-0x70 op-0x18 case 8: the host owns party HP/MP, so forward the decoded
        // full-heal there. Headless records it so tests can assert the dispatch.
        this.presentationLog.push({ op: "HealParty", args: [] });
        opts.healParty?.();
      },
    });

    for (const st of content.stages) {
      for (const s of st.scripts) {
        this.programs.set(s.id, s.program);
      }
    }

    this.events = new EventManager({
      conditions: this.conditions,
      ctx: () => this.state.evalContext(),
      programOf: (id) => this.programs.get(id) ?? [],
      onceFlag: { get: (id) => onceStore.get(id), set: (id) => onceStore.set(id) },
      vm: this.vm,
    });
  }

  /** Shared public door for dialogue and converted scripts. */
  writeStoryFlag(id: number, value: number): void {
    applySetFlag(id, value, { setFlag: (flag, val) => this.state.flags.set(flag as FlagId, val !== 0) }, this.setFlagPolicy);
  }

  /** Legacy converted fight rows own synthetic victory markers. Original bank
   * reads and writes never use those markers. Return only an unambiguous binding. */
  battleResultFlag(screenId: number): FlagId | null {
    const flags = new Set<number>();
    const stage = this.content.stages.find(s => s.mapId === this.currentStage);
    for (const script of stage?.scripts ?? []) for (const op of script.program) {
      if (op.op === 'StartBattle' && Number(op.args[0]?.v) === screenId) flags.add(Number(op.args[1]?.v));
    }
    if (flags.size > 1) throw new Error(`ambiguous converted victory marker for ${this.currentStage} screen ${screenId}`);
    return flags.size ? [...flags][0]! as FlagId : null;
  }

  loadStage(mapId: string): void {
    this.currentStage = mapId;
    // Every field entry: pro/fieldstg.s .L0x00008008-.L0x00008028
    // calls the screen id getter (D0x8004B438), then set_flag(0x1E00 + id, 1).
    // Use the decoded screen table, including aliases, through the existing
    // set_flag dispatch; never substitute the stage number for the screen id.
    const screenId = screenIdForStage(this.screenTable, mapId);
    if (screenId != null) applySetFlag(0x1e00 + screenId, 1, {
      setFlag: (id, value) => this.state.flags.set(id as FlagId, value !== 0),
    }, this.setFlagPolicy);
    this.events.clearTable();
    const st = this.content.stages.find(s => s.mapId === mapId);
    if (st) this.events.addTable(st.events.map(event => event.id.includes(".sb.") && event.if
      ? { ...event, if: launcherCondition(event.if) } : event));
    // This stage's completion routines travel with the stage (ConvertedStage.completions),
    // so a host cannot load a stage and quietly lose its story writes.
    if (st?.completions) setStageCompletions(mapId, st.completions);
  }

  raise(type: string, params?: Record<string, number | string>, opts?: RaiseOptions): RunHandle | null {
    return this.events.raise(params ? { type, params } : { type }, opts);
  }

  /** The flag_key for a stage's event id (resolves StartEvent(evId) → cutscene bytecode). */
  eventFlagKey(stage: string, evId: number): string | undefined {
    return this.content.flagKeys?.[stage]?.[evId];
  }

  /** Run an event's completion routine — what the finished scene writes — and then the
   *  converter's own on_complete program (item grants, NPC flag sets, scripted-battle rows).
   *  In driven mode the bridge calls this AFTER the cutscene has played (faithful: flags are
   *  set on event END).
   *
   *  Which event moves the story on: the original writes the master ordinal [0x8004b370] from
   *  ONE event's on_complete routine per beat — the beat's CLOSING event, not its opening one.
   *  s200: event 52's routine (wstag200.s .L0x144 `li $v0,4 / jr $ra / sw $v0,-0x4c90($v1)`)
   *  is the overlay's only ordinal store; event 50's routine (.L0xf8) writes only 0x400d/0x7401.
   *  The port carries that decode per event, so the store happens on that event alone and
   *  writes the value read out of the assembly — an unconditional store, exactly as `sw` is. */
  completeEvent(evId: number): void {
    // What a finished scene WRITES is the shared system, ported once:
    // engine/systems/scene-completion.ts runs this event's own completion routine — the
    // ordered list of `set_flag` calls and the master-story-ordinal store lifted from the
    // overlay's `on_complete_fn` (web/assets/data/scene/scene_completion.json). It writes
    // through the same flag bank and the same [0x8004b370] the arrival dispatcher reads
    // (engine/systems/scene-arrival.ts), so a beat's close and the next beat's gate are one
    // mechanism. Before the port this was two converted copies: a SetFlag program emitted per
    // event by tools/engine-convert/lib.ts, and `ordinal.byStageOwner` below.
    const routine = sceneCompletion(this.currentStage, evId);
    if (routine) {
      runSceneCompletion(routine, {
        setFlag: (id, value) => this.state.flags.set(id as FlagId, value !== 0),
        setOrdinal: (step) => this.state.vars.set("$story.ordinal", step),
      }, this.setFlagPolicy);
    }
    const prog = this.programs.get(`${this.currentStage}.event.${evId}.oncomplete`);
    if (prog) this.pump(this.vm.start(prog));
  }

  /** Start one event of the CURRENT stage by its id and run its script — the engine half
   *  of every start site that hands `start_event` an id rather than naming a row: the bank-0x90
   *  talk launcher (engine/systems/talk-launch.ts) and the position step's op-8.
   *
   *  It is deliberately NOT completeEvent: in driven mode the host plays the cutscene first
   *  and then calls completeEvent, exactly as the bridge does for a raised row. Headless it
   *  completes inline, as `startEvent` already does. Returns false when this stage's converted
   *  program table has no script for the id — the same "start_event finds nothing" case the
   *  resolver screens out, checked again here so a caller cannot start a scene the content
   *  does not carry. */
  playEventById(evId: number): boolean {
    const prog = this.programs.get(`${this.currentStage}.event.${evId}.script`);
    if (!prog) return false;
    this.pump(this.vm.start(prog));
    return true;
  }

  /** Shared flag API: stored bits, collection operations, roster actions and
   * command banks. Built once and used by completion and script writers. */
  private readonly setFlagPolicy: SetFlagPolicy;

  /** Ticks `h` to completion, auto-resuming after StartEvent and presentation stubs. */
  pump(h: RunHandle | null): void {
    if (!h) return;
    for (let i = 0; i < 1000 && !h.done; i++) {
      this.vm.tick(h);
      if (!h.done) this.vm.resume(h);
    }
  }
}

/** Compatibility for shipped converted battle rows. Original script gates keep
 * their get_flag semantics; only the converter's battle queue reads this marker. */
function launcherCondition(c: Condition): Condition {
  if (c.kind === 'leaf') {
    if (c.leaf === 'flag' && ((Number(c.args[0]) >>> 8) & 0xfe) === 0x74)
      return { ...c, leaf: 'battleLauncher' };
    return c;
  }
  if (c.kind === 'not') return { ...c, child: launcherCondition(c.child) };
  return { ...c, children: c.children.map(launcherCondition) };
}
export * from "./dw3/save-block.ts";
export * from "./persistence/memcard-state.ts";
export { BOOSTER_ITEM_IDS } from "./dw3/booster-items.ts";
export { bindBoosterStock, seedBoosterStock, commitBoosterStock } from "./dw3/booster-stock.ts";
// The attack script's defender-reaction dispatch (engine/dw3/battle-reaction-dispatch.ts):
// the op1 handler F0x8008b69c that replaces the owner's subordinate action actor and selects
// its action index, the damage-reaction machine's kind → clip selection table, and the
// machine's fourteen case bodies F0x8008d3b4 (clips, motion slots, the knockback/push
// arithmetic and the guard bytes).
export {
  DISPATCH_IP_OFF, DISPATCH_SIDE_OFF, DISPATCH_OUTCOME_OFF, DISPATCH_CONTACT_COUNTER_OFF,
  DISPATCH_BASE_OFFS, DISPATCH_CHILD_OFF, SUBORDINATE_MODE_SINGLE, SUBORDINATE_MODE_MULTI_HIT,
  dispatchSubordinateActor, REACTION_KIND_BASE, REACTION_KIND_CASE_ADDRESSES,
  REACTION_KIND_CASE_CLIPS, REACTION_DEFAULT_CLIP, reactionKindClip,
  REACTION_STATE_OFF, REACTION_CASE_OUTCOME_OFF, REACTION_ACTOR_TABLE, REACTION_ACTIVE_INDEX,
  REACTION_MOTION_RECORD, REACTION_GUARD_HIT, REACTION_GUARD_PUSH_A, REACTION_GUARD_PUSH_B,
  REACTION_DEFAULT_LIST, REACTION_DEFAULT_LIST_STRIDE, REACTION_RNG_PTR,
  REACTION_SERVICE_PUSH, REACTION_SERVICE_ROLL, REACTION_SERVICE_MOTION, REACTION_TURN_STATE,
  runReactionMachine,
  type ReactionMemory, type ReactionHost, type ReactionDispatchResult,
  type ReactionCaseHost, type ReactionCaseMemory, type ReactionMachineResult,
} from "./dw3/battle-reaction-dispatch.ts";
