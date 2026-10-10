// The ordinary card duel, composed from the already-oracled pro/cardgame
// controllers. This module is the "composition" the card-battle screen lacked:
// the screen board, the duel object, its board view and the tick's queue
// services, driven over one flat data memory with no instruction decoder and no
// executable image reachable (proved by tests/card-battle-execution-forbidden.test.js).
//
// WHAT IT COMPOSES (all already translated, each with its own interpreter
// oracle):
//   card-battle-scene   F0x80095BFC / F0x80095E2C  the 0x50-byte screen object
//   duel-create         F0x800A3240                the 0x824-byte duel object
//   duel-scene-handler  F0x800A2F00                the duel object's callback
//   duel-mode-machine   F0x800A1B2C / F0x800A1B48  the mode arm/rotate
//   duel-tick           F0x800A2DF8                the per-frame arm switch
//   duel-queue          F0x8009E62C / F0x8009E560  grey flags + announce
//   duel-view-queue     F0x8009E668                the board-view request queue
//   duel-view           F0x8009BBA8 / F0x80099F60  the board view handler/draw
//   card-battle-context F0x8009D310                the 0xF48-byte board view
//   cardgame-draw       F0x80096950 / F0x80096A94  the spinner + digit sprites
//   opponent-deck       F0x8009D6E0                the AI deck loader
//   intro-cue           F0x8009D6B4                the intro voice object
//   view-openers        F0x8009C264                the view reset
//
// WHAT IT CANNOT DO YET, AND SAYS SO. The duel's own routines are still only
// partly ported, so this session cannot play a match to its end and the ordinary
// route is NOT switched onto it (the shipped overlay stays the ordinary route
// through web/cardduel-native.js; this module is the cutover's first half):
//
//   * the board view's own method bodies and its three browse passes ARE now
//     ported (engine/dw3/ui/duel-board-view.ts, tests/duel-board-view-oracle):
//     scaleSlot 0x8009C938 (with its core 0x8009C898), openPlate 0x8009BE40,
//     closePlate 0x8009BE78, primeAiPileBrowseCounts 0x8009DF68 and
//     startAiPileBrowse 0x8009DBE8. startAiPileBrowse dispatches through four
//     MORE view method slots — F0x8009C510 position, F0x8009CDFC hide,
//     F0x8009CFBC value, F0x80098864 reveal offset — which are now ALSO ported
//     bodies (tests/duel-view-slots-oracle), so the browse walk is complete.
//   * refreshFieldCardViews 0x8009E024 and the nine mode updates the mode
//     machine calls — F0x8009F110 (mode 2), F0x8009F8C0 (mode 3), F0x8009F910
//     (mode 4), F0x8009FDD8 (mode 5/7), F0x800A0B80 (mode 6), F0x800A0F94
//     (mode 8), and the enters F0x800A0548 / F0x800A0F4C / F0x800A1A5C — remain
//     un-ported. TWO OF THEM ARE NOW PORTED: mode 3 (0x8009F8C0) and mode 4
//     (0x8009F910) are SELF-CONTAINED — neither dispatches through a jump table
//     and neither calls anything — so each is a real body in
//     engine/dw3/ui/duel-mode-updates.ts with its own oracle. The other seven
//     ARE the match: the draw, load, battle and set-end phases. They are not
//     self-contained, though — each dispatches through its own jump table into
//     routines that a further layer below provides, so porting the update bodies
//     alone would only move the gap one layer down. The duel stalls after the
//     opening spinner and banner until that whole layer is ported. FOUR FAMILIES
//     OF THAT LAYER ARE NOW PORTED: the pile/hand bookkeeping
//     (engine/dw3/ui/duel-pile-service.ts, tests/duel-pile-service-oracle) —
//     scanDeckAvailability 0x8009D9E4, sortAiHandByPriority 0x8009D8FC,
//     returnHandToDeck 0x800A19F8 and recycleOpponentHandIntoDeck 0x8009DA68,
//     exposed here as `pileHost`; the view-window / card-slot presentation
//     (engine/dw3/ui/duel-view-window.ts, tests/duel-view-slots-oracle) —
//     waitViewWindowOpen 0x800A1DB8 and presentResolvingCard 0x800A1E60, exposed
//     here as `windowHost`; the effect/commit boundaries
//     (engine/dw3/ui/duel-effect-commit.ts, tests/duel-effect-commit-oracle) —
//     commitSelectedHandCard 0x8009F998 and markLegalFieldTargets 0x8009FB18;
//     and the counter/stat presentation services
//     (engine/dw3/ui/duel-counter-service.ts, tests/duel-counter-service-oracle)
//     — refreshAllCounters 0x8009EDCC, recomputeSideTotals 0x800A0ACC,
//     applyDynamicStatMegas 0x800A09FC and applyDynamicStatMega 0x800A0844. The
//     opponent AI is now ported too (engine/dw3/ui/duel-ai.ts): the decision
//     layer, the worth-it test 0x800A44F0, the response simulator 0x800A45F8 and
//     the pick 0x800A4978, exposed here as chooseOpponentCard. What still blocks
//     a whole match is the nine mode updates (0x8009F110 / 0x8009F8C0 /
//     0x8009F910 / 0x8009FDD8 / 0x800A0B80 / 0x800A0F94 and their enters
//     0x800A0548 / 0x800A0F4C / 0x800A1A5C).
//   * THE TICK'S EFFECT-VM LAYER IS NOW PORTED: F0x80084320 (effect-vm.ts) and
//     its two steps F0x800A2180 / F0x800A2608 (duel-effect-step.ts) run through
//     hosts (duel-effect-host.ts). The few edges that run real are the phase
//     banner, the view window, the counter service and the dynamic-stat megas;
//     the effect VM's 96 opcode helpers and the effect-step view/input edges are
//     named gaps that throw TranslatedGapError, so a match still cannot finish.
//
// Every one of those edges is an explicit translated gap: calling it throws a
// TranslatedGapError naming the original routine, so the session can never fetch
// an instruction or substitute a silent success. What runs is real: the screen
// board builds, the duel object is constructed with its five method pointers,
// the scene handler's setup arm runs (opponent deck, intro voice, board view,
// view reset, the outro fade wash), the tick runs its three ported queue
// services and the mode machine's opening (mode 1 arms the waiting spinner),
// and the board's plate writers, slot tween and two browse passes run their real
// bodies once the duel reaches them.
import { NativeMemory } from "../../native/memory.ts";
import {
  cardBattleSceneTick, createCardBattleScene, CARD_BATTLE_SCENE_ENTRY, CARD_BATTLE_SCENE_SIZE,
  CARD_BATTLE_SCENE_EXTRA, CARD_BATTLE_PACK_A, CARD_BATTLE_PACK_B,
  type CardBattleSceneHost,
} from "./card-battle-scene.ts";
import {
  cardDuelSceneHandler, DUEL_SCENE_HANDLER_ENTRY, DUEL_SCENE_STATE,
  DUEL_PACK_HANDLE, DUEL_CTX_VIEW, DUEL_CTX_INTRO, DUEL_CTX_FADE,
  type DuelSceneHost,
} from "./duel-scene-handler.ts";
import { cardDuelTick, DUEL_TICK_ARM, type DuelTickHost } from "./duel-tick.ts";
import {
  enterModeFive, enterModeEight, enterModeNine, updateModeTwo, updateModeThree,
  updateModeFour, updateModeFiveSeven, updateModeSix, updateModeEight,
  initDuelModeState, runModeMachine, DUEL_MODE, type DuelModeHost,
} from "./duel-mode-machine.ts";
import { applyQueuedGreyFlags, runQueuedAnnounce, type DuelQueueHost } from "./duel-queue.ts";
import { dispatchDuelViewQueue, type DuelViewQueueHost } from "./duel-view-queue.ts";
import {
  createCardDuel, DUEL_OBJECT_SIZE, DUEL_OBJECT_EXTRA, DUEL_SELECTOR,
} from "./duel-create.ts";
import {
  createCardBattleContext, CARD_BATTLE_VIEW_HANDLER, CARD_BATTLE_VIEW_SIZE, CARD_BATTLE_VIEW_SLOT,
} from "./card-battle-context.ts";
import {
  createFadeWash, fadeWashSetColours, fadeWashStart, fadeWashIsIdle, fadeWashStop,
  FADE_WASH_HANDLER, FADE_WASH_SIZE, type FadeWashCreateHost,
} from "./fade-wash.ts";
import { resetViewPanels, VIEW_OPENER_SOUND_ID } from "./view-openers.ts";
import { loadOpponentDeck, OPPONENT_DECK_PACK_ID } from "./opponent-deck.ts";
import { createIntroVoice, INTRO_CUE_HANDLER, INTRO_CUE_SIZE, INTRO_CUE_EXTRA } from "./intro-cue.ts";
import {
  openPlate, closePlate, scaleSlot, primeAiPileBrowseCounts, startAiPileBrowse,
  cardFanOut, placeCardResetVisual, hideCardSprite, bindSlotToCard,
  cardStartMoveSilent, cardStartFlip, cardStartMoveWithSfx, setCardScaleEndpoints,
  cardStartSettle,
  type DuelBoardHost,
} from "./duel-board-view.ts";
import {
  slideBothPanelsIn, slideBothPanelsOut, setHudHighlights, settleRowCard,
  growTurnMarker, shrinkTurnMarker,
  type SettleRowHost,
} from "./duel-view-methods.ts";
import {
  refreshFieldCardViews, fieldSlotColour, type FieldRefreshHost,
} from "./duel-field-refresh.ts";
import {
  effectOp98OpenOwnFieldPicker, handUsableCheck, type OwnFieldPickerHost,
} from "./duel-effect-pickers.ts";
import {
  scanDeckAvailability, sortAiHandByPriority, returnHandToDeck, recycleOpponentHandIntoDeck,
} from "./duel-pile-service.ts";
import {
  aiChooseCardToPlay, aiWorthPlaying, aiSimulateCounter, scanComboRuns,
  waitAiThinkWindow, type AiHost,
} from "./duel-ai.ts";
import {
  commitSelectedHandCard, markLegalFieldTargets, type DuelEffectHost,
} from "./duel-effect-commit.ts";
import {
  updateDuelModeFiveSeven, updateDuelModeSix, updateDuelModeEight,
  type DuelBattleModeHost,
} from "./duel-mode-battle.ts";
import { updateDuelModeThree, updateDuelModeFour } from "./duel-mode-updates.ts";
import { updateDuelModeTwo, type DrawPhaseHost, MODE_TWO_UPDATE } from "./duel-draw-phase.ts";
import { cardDuelViewTick, DUEL_RENDER_BANK } from "./duel-view.ts";
import { createHeadlessDuelViewHost } from "./duel-view-host.ts";
import { buildDuelCardTable, shufflePile, type CardTableHost } from "./duel-card-table.ts";
import { openInfoBanner, writeBannerRecord } from "./duel-info-banner.ts";
import {
  openBannerSlot, openPromptSlot, closePromptSlot, confirmPromptSlot,
} from "./view-openers.ts";
import { enterPendingNine, enterPendingFiveSeven, enterPendingEight, handSelectionSort, type PhaseEnterHost } from "./duel-phase-enters.ts";
import {
  refreshAllCounters, applyDynamicStatMegas, recomputeSideTotals, type DuelCounterHost,
} from "./duel-counter-service.ts";
import { setHudCounter } from "./duel-board-view.ts";
import {
  waitViewWindowOpen, presentResolvingCard, type DuelViewWindowHost,
} from "./duel-view-window.ts";
import { runEffectOpcode } from "./effect-vm.ts";
import { fetchNextEffectOpcode, saveRestoreEffectStepBlock } from "./duel-effect-step.ts";
import {
  createEffectVmHost, createEffectStepHost, EFFECT_LAYER_GAP_COUNT, type DuelEffectHostServices,
} from "./duel-effect-host.ts";
import { effectOpA7StartCoinToss, tickCoinToss as coinTossTick, type CoinTossHost,
  effectOp14ClearBothBoards, tickDealTurnStart, type DealTurnStartHost } from "./duel-effect-ops.ts";
import {
  showPhaseBanner as phaseBannerShow, tickPhaseBanner as phaseBannerTick, type PhaseBannerHost,
} from "./phase-banner.ts";
import {
  CARD_VIEW_SIZE, constructCardView, resolveCardRecord, type CardViewHost,
} from "./card-view.ts";
import {
  setDisplayPacketIndex, setDisplayRegion, registerDisplayView, resetDisplayService,
} from "../display-service.ts";
import { setRectColour } from "../display-view.ts";
import {
  cardViewHelperInit, cardViewHelperSetPairA, cardViewHelperUploadPack, CARD_HELPER_SIZE,
} from "./card-view.ts";
import { ensureSoundArchiveLoaded, AUDIO_CHANNEL_IDS } from "../audio-archive.ts";
import { frameDelta, advanceFrameClock } from "../../systems/frame-clock.ts";
import {
  INTER_PHASE_BYTES, PHASE_BANNER_BYTES, INTRO_CUE_BYTES, INTER_PHASE_TABLE, PHASE_BANNER_TABLE,
  INTRO_CUE_SECTORS, LBA_LEN_SECTORS,
} from "./duel-overlay-tables.ts";
import { INTRO_CUE_TABLE, introVoiceCueTick } from "./intro-cue.ts";
import {
  cacheAcquire, cachePoll, cacheServicePending, FRAME_CLOCK_CELL, RESOURCE_SERVICE_ACTIVE,
  type CacheServiceHost,
} from "../resource-service.ts";

/** The arena the session allocates its objects from (RAM above the task heap). */
export const DUEL_ARENA_BASE = 0x80100000;
export const DUEL_ARENA_END = 0x801e0000;
/** The caller-owned screen context that carries the board view (+0x18), the
 *  intro object (+0x0) and the outro fade (+0x4). */
export const DUEL_CTX_SIZE = 0x20;
/** The card-view upload helper's 0x34-byte context. */
export const DUEL_HELPER_SCRATCH = 0x8000;
/** The two artwork packs the screen board uploads are data here: each resolves
 *  to an empty record table, so the uploader walks zero records. */
export const DUEL_EMPTY_PACK_BYTES = 0x10;

/**
 * The resident disc device's read rate, as the cache's transfer model uses it:
 * sectors consumed per displayed frame. The PS1 CD reads at 2× (≈150 sectors/s
 * of 2048-byte Mode-1 sectors); on the 60 Hz logic clock that is ≈2.4
 * sectors/frame, rounded down to 2 here. The rate is a PLATFORM constant, not a
 * decoded one: it is the hardware latency the original's async loader
 * (F0x80013914) waits on, and it is what makes the intro-voice cue walk span
 * frames instead of finishing instantly. The Draw Phase's first arm's decision
 * does not depend on its exact value — only on the walk outlasting the mode
 * transition it overlaps — so the gate is exposed here to be varied by a test.
 */
export const DUEL_CD_SECTORS_PER_FRAME = 2;

/** The original routines this composition cannot yet reach, by address. */
export const DUEL_UNPORTED_ROUTINES: readonly (readonly [number, string])[] = [
  // The last tick-level named gap, the board view's browse refresh
  // (F0x8009E024), is now a real body (duel-field-refresh.ts). The aim-off is
  // empty: every tick-level routine the mode machine reaches is ported.
];

/**
 * The effect layer's OWN named gaps: the effect-VM opcode helpers and the
 * effect-step view/input edges that engine/dw3/ui/duel-effect-host.ts still
 * throws on. They are reached only once the tick's effect-VM arm runs, so each
 * is thrown as a TranslatedGapError naming its original routine (see
 * `EffectVmHost` in effect-vm.ts and `DuelEffectStepHost` in
 * duel-effect-step.ts). The count is exposed so the whole-match verifier can
 * report the effect layer's remaining frontier honestly.
 */
export const DUEL_EFFECT_HOST_GAPS = EFFECT_LAYER_GAP_COUNT;

/**
 * The two self-contained mode updates ported as real bodies
 * (engine/dw3/ui/duel-mode-updates.ts) — mode 3 (Load Phase) and mode 4
 * (Compile/Battle Phase). Neither dispatches through a jump table and neither
 * calls anything, so each ports exactly with no layer below it.
 */
export const DUEL_PORTED_MODE_UPDATE_ROUTINES: readonly number[] = [
  MODE_TWO_UPDATE, 0x8009f8c0, 0x8009f910, 0x8009fdd8, 0x800a0b80, 0x800a0f94,
];

/** How many of the seventeen originally named pieces this session now runs. */
export const DUEL_PORTED_BOARD_ROUTINES: readonly number[] = [
  0x8009c938, 0x8009be40, 0x8009be78, 0x8009dbe8, 0x8009df68,
  // the four view method slots the browse reveal walk dispatches through
  0x80098864, 0x8009c510, 0x8009cdfc, 0x8009cfbc,
];

/** The view-window / card-slot presentation family ported as shared services
 *  (engine/dw3/ui/duel-view-window.ts) — the layer the mode updates call. */
export const DUEL_PORTED_VIEW_WINDOW_ROUTINES: readonly number[] = [
  0x800a1db8, 0x800a1e60,
];

/**
 * The pile/hand bookkeeping family ported as shared services
 * (engine/dw3/ui/duel-pile-service.ts) — the layer the mode updates call.
 */
export const DUEL_PORTED_LAYER_ROUTINES: readonly number[] = [
  0x8009d8fc, 0x8009d9e4, 0x8009da68, 0x800a19f8,
];

/**
 * The effect/commit boundaries ported as shared services
 * (engine/dw3/ui/duel-effect-commit.ts) — commit a marked hand card onto the
 * played stack, and light the slots the pending effect may legally hit.
 */
export const DUEL_PORTED_EFFECT_COMMIT_ROUTINES: readonly number[] = [
  0x8009f998, 0x8009fb18,
];

/**
 * The counter/stat presentation services ported as shared services
 * (engine/dw3/ui/duel-counter-service.ts) — repaint both HUD strips, rebuild a
 * side's totals, and recompute the five dynamic-stat Megas.
 */
export const DUEL_PORTED_COUNTER_ROUTINES: readonly number[] = [
  0x8009edcc, 0x800a0acc, 0x800a09fc, 0x800a0844,
];

/** The Draw Phase's own families, ported as real bodies: the info-banner pair
 *  (S3), the marker sprite (S11), the element panel (S12) and the duel-object
 *  card-table/shuffle pair (S14). */
export const DUEL_PORTED_DRAW_PHASE_FAMILIES: readonly number[] = [
  0x8009beac, 0x8009bf5c,
  0x80096180, 0x80096144, 0x80096160, 0x80096150,
  0x80096828, 0x800967f8, 0x80096808,
  0x8009d15c, 0x8009f04c,
];

/** A named, non-silent gap: an edge whose original routine is not yet ported. */
export class TranslatedGapError extends Error {
  readonly routine: number;
  readonly role: string;
  constructor(routine: number, role: string) {
    super(`card duel: ${role} (F0x${routine.toString(16).toUpperCase().padStart(8, "0")}) is not translated`);
    this.name = "TranslatedGapError";
    this.routine = routine >>> 0;
    this.role = role;
  }
}

export interface DuelSessionOptions {
  /** The opponent record index the launcher leaves in the shop id cell. */
  shopId?: number;
  /** [0x80044F5C]-style pack resolver: handle -> base. Defaults to a data stub. */
  resolvePack?: (handle: number) => number;
  /** Play a packed sound id ([0x80055C48]). */
  playPackedSound?: (id: number) => void;
  /** The AI host edges the choice walks read (F0x8001E7EC / F0x80085F38 /
   *  F0x80083E34 and the two collection probes). Defaults are inert stubs. */
  aiHost?: Partial<AiHost>;
  /** The pad readers the Draw Phase's input arm (mode 2, sub-step 9) walks.
   *  Defaults read nothing, so the marker walk sits until a host supplies input. */
  padWord?: (port: number) => number;
  padRepeatWord?: (port: number) => number;
  padKeyBit?: (port: number, code: number) => number;
  /** `(*0x8004DC0C)()`: the resident random word the pile shuffle draws.
   *  Defaults to a fixed word, so a headless shuffle is deterministic. */
  randU16?: () => number;
  /**
   * The platform disc read rate, in sectors per displayed frame, the intro
   * cue loader's cache transfer model uses (default `DUEL_CD_SECTORS_PER_FRAME`).
   * Exposed so a test can vary it and prove the Draw Phase's first arm's wait is
   * gated by the transfer, not by a stub.
   */
  cdSectorsPerFrame?: number;
}

/**
 * The opponent-AI family ported as a translated service (engine/dw3/ui/duel-ai.ts)
 * — the decision layer, the worth-it test and the response simulator. Exposed on
 * the session so a future port of the mode updates can drive it; on its own it is
 * not a match (the nine mode updates and the effect VM still block one).
 */
export const DUEL_PORTED_AI_ROUTINES: readonly number[] = [
  0x800a4978, 0x800a44f0, 0x800a45f8, 0x800a4924, 0x800a0cd4, 0x800a36e4, 0x800a3934, 0x800a3d90,
];

/**
 * One composed card-duel session over the translated controllers. Every host
 * edge is either a translated body (called directly), a data write, or a
 * TranslatedGapError naming the un-ported routine.
 */
export class DuelSession {
  readonly mem = new NativeMemory();
  /** The 0x50-byte screen board object. */
  readonly screen: number;
  /** The caller-owned context carrying the view/intro/fade. */
  readonly ctx: number;
  /** The caller's slot the screen stores the created duel through. */
  readonly duelSlot: number;
  readonly helper: number;
  readonly envScratch: number;
  /** The 0x38-byte render bank the board view's setup arm builds (1 plate + 13
   *  text widgets). The original allocates its own; the session keeps a
   *  dedicated buffer so it never overlaps the 0x20-byte caller context. */
  readonly renderCtx: number;
  /** The 0x54-byte scratch the slot binder builds the card-view class on. */
  readonly slotScratch: number;
  /** The 0x54-byte scratch the deal ceremony's per-row counter step builds its
   *  card-record cursor on (the original uses its own stack frame). */
  readonly settleScratch: number;
  private arena = DUEL_ARENA_BASE;
  private readonly options: DuelSessionOptions;
  private readonly soundIds: number[] = [];
  private frame = 0;
  /** The platform disc read rate (sectors/frame), overridable for tests. */
  private readonly cdSectorsPerFrame: number;
  /** The display tick at which the in-flight disc transfer completes. */
  private cdFreeTick = 0;
  /** The session's own display-frame counter for the disc device model. */
  private cdFrame = 0;

  constructor(options: DuelSessionOptions = {}) {
    this.options = options;
    this.cdSectorsPerFrame = Math.max(1, Math.floor(options.cdSectorsPerFrame ?? DUEL_CD_SECTORS_PER_FRAME));
    // The duel's start archive is treated as resident in this data-only session,
    // so the constructor's F0x80020574 request is a no-op the way the reference
    // host's acquire stub is.
    this.mem.write32(AUDIO_CHANNEL_IDS[0], 0x27);
    this.helper = this.alloc(CARD_HELPER_SIZE, 4);
    this.envScratch = this.alloc(0x5c, 4);
    this.slotScratch = this.alloc(CARD_VIEW_SIZE, 4);
    this.settleScratch = this.alloc(CARD_VIEW_SIZE, 4);
    this.ctx = this.alloc(DUEL_CTX_SIZE, 4);
    this.renderCtx = this.alloc(DUEL_RENDER_BANK.size, 4);
    this.screen = createCardBattleScene(this.screenHost());
    this.duelSlot = this.alloc(4, 4);
    // the overlay data tables the mode machine and the phase banner read
    for (let i = 0; i < INTER_PHASE_BYTES.length; i++) this.mem.write8(INTER_PHASE_TABLE + i, INTER_PHASE_BYTES[i] ?? 0);
    for (let i = 0; i < PHASE_BANNER_BYTES.length; i++) this.mem.write8(PHASE_BANNER_TABLE + i, PHASE_BANNER_BYTES[i] ?? 0);
    for (let i = 0; i < INTRO_CUE_BYTES.length; i++) this.mem.write8(INTRO_CUE_TABLE + i, INTRO_CUE_BYTES[i] ?? 0);
    // The resident disc sector counts the cue loader's cache sizes from, at the
    // cue ids the records name (per language; each language's voice archive has
    // its own length). The transfer latency below is derived from these.
    for (const [baseId, perLanguage] of INTRO_CUE_SECTORS) {
      for (let language = 0; language < perLanguage.length; language++) {
        this.mem.write16(LBA_LEN_SECTORS + (baseId + language) * 2, perLanguage[language] ?? 0);
      }
    }
  }

  /** A zeroed bump allocation, the session's only allocator. */
  private alloc(size: number, align = 16): number {
    const base = (this.arena + (align - 1)) & ~(align - 1);
    const next = base + size;
    if (next > DUEL_ARENA_END) throw new Error("card duel: session arena exhausted");
    this.mem.bytes.fill(0, base & 0x1fffff, next & 0x1fffff);
    this.arena = next;
    return base;
  }

  /** F0x80014504-style allocation for the screen, duel, view, intro and fade. */
  private allocate(handler: number, size: number, extra: number): number {
    const size_ = size | 0;
    const extra_ = extra | 0;
    if (handler === CARD_BATTLE_SCENE_ENTRY) return this.alloc(CARD_BATTLE_SCENE_SIZE, 16);
    if (handler === DUEL_SCENE_HANDLER_ENTRY) return this.alloc(DUEL_OBJECT_SIZE, 16);
    if (handler === CARD_BATTLE_VIEW_HANDLER) return this.alloc(CARD_BATTLE_VIEW_SIZE, 16);
    if (handler === INTRO_CUE_HANDLER) return this.alloc(INTRO_CUE_SIZE, 16);
    if (handler === FADE_WASH_HANDLER) return this.alloc(FADE_WASH_SIZE, 16);
    return this.alloc(size_ + Math.max(0, extra_), 16);
  }

  private gap(routine: number, role: string): never { throw new TranslatedGapError(routine, role); }

  // ── the screen board (card-battle-scene F0x80095BFC state 0) ──────────────
  /** Build the screen board and the duel object. Returns the duel address. */
  buildScreenBoard(): number {
    cardBattleSceneTick(this.mem, this.screenHost(), this.screen, this.duelSlot);
    return this.mem.read32(this.duelSlot) >>> 0;
  }

  private screenHost(): CardBattleSceneHost {
    return {
      releaseView: () => {},
      alloc: (size, tag) => this.alloc(size, 4),
      allocZeroed: (size, tag) => this.alloc(size, 4),
      clearOTag: () => {},
      gsInit3D: () => {},
      setGeomOffset: () => {},
      allocScratch: (size, tag) => this.alloc(size, 4),
      free: () => {},
      drawSync: () => {},
      allocate: (h, size, extra) => this.allocate(h, size, extra),
      resourceGetBase: (id) => this.opponentPackBase(id),
      loadImage: () => {},
      findRegisteredHandleByKey: () => 0,
      callViewMethod: () => 0,
      releaseVoice: () => {},
      closeProgram: () => {},
      releaseVabSlot: () => {},
      acquire: () => {},
      resolvePack: (handle) => this.resolvePack(handle),
      getCurrentShopId: () => this.options.shopId ?? 1,
      helperBuffer: () => this.helper,
      drawEnvScratch: () => this.envScratch,
      setState: (obj, state) => { this.mem.write32(obj + DUEL_SCENE_STATE, state | 0); },
      advancePhase: (obj) => {
        // obj+0x38 = F0x800142AC advances the task state (+0xC).
        this.mem.write32(obj + DUEL_SCENE_STATE, (this.mem.read32(obj + DUEL_SCENE_STATE) | 0) + 1);
      },
      advanceSub: (obj) => {
        this.mem.write32(obj + 0x10, (this.mem.read32(obj + 0x10) | 0) + 1);
      },
      ordinalQuery: () => 0,
      requestTransition: () => {},
    };
  }

  /** The duel object's callback: the scene handler (F0x800A2F00). */
  private sceneHost(): DuelSceneHost {
    return {
      ...this.tickHost(),
      allocate: (h, size, extra) => this.allocate(h, size, extra),
      allocateView: (handler, size, slot) => this.allocate(handler, size, slot),
      // the CardViewHost/DisplayServiceHost edges the scene handler inherits
      resourceGetBase: (id) => this.opponentPackBase(id),
      loadImage: () => {},
      findRegisteredHandleByKey: () => 0,
      callViewMethod: () => 0,
      allocScratch: (size, tag) => this.alloc(size, 4),
      free: () => {},
      drawSync: () => {},
      loaderBusy: () => 0,
      resolvePack: (handle) => this.resolvePack(handle),
      loadOpponentDeck: (duel, _ctx) => loadOpponentDeck(this.mem, this.deckHost(), duel),
      createIntroVoice: () => createIntroVoice(this.mem, this.introHost()),
      setupView: (view) => resetViewPanels(this.mem, view),
      helperBuffer: () => this.helper,
      playPackedSound: (id) => { this.soundIds.push(id | 0); this.options.playPackedSound?.(id | 0); },
      voiceCommand: (id) => { this.soundIds.push(id | 0); },
      setState: (obj, state) => { this.mem.write32(obj + DUEL_SCENE_STATE, state | 0); },
    };
  }

  private deckHost() {
    return { resourceGetBase: (id: number) => this.opponentPackBase(id) };
  }
  private introHost() {
    return {
      allocate: (h: number, size: number, extra: number) => this.allocate(h, size, extra),
      acquire: (cue: number) => cacheAcquire(this.mem, cue & 0xffff, this.cacheServiceHost()),
      poll: (cue: number) => cachePoll(this.mem, cue & 0xffff, this.cacheServiceHost()),
      setState: (obj: number, state: number) => { this.mem.write32(obj + 0x0c, state | 0); },
    };
  }

  /**
   * The resident resource cache the intro-voice cue loader dispatches through:
   * `[0x80044F44]` = F0x80013C30 (acquire) and `[0x80044F3C]` = F0x80013A6C
   * (poll), read out of the resident image and already ported in
   * engine/dw3/resource-service.ts (the same two the battle loader and the
   * transformation driver reach — wfight-loader-session.ts, gym-session.ts).
   * The disc transfer itself ([0x80044B34]) is the device boundary: the session
   * has no disc, so the buffer starts empty and the cue bytes are never read
   * back (the intro object only polls the slot's state). The frame clock the
   * service stamps its LRU ticks from is the shared display tick, advanced once
   * per full frame by runFrame.
   */
  private cacheServiceHost(): CacheServiceHost & { clock(): number; busyGate(): number } {
    return {
      alloc: (size: number) => this.alloc(size >>> 0, 4),
      // The disc device boundary ([0x80044B34] = the async loader F0x80013914):
      // it sets the resource service busy word and frees it once the read has
      // had time to finish. The read time is the transfer's sector count over
      // the platform's rate (DUEL_CD_SECTORS_PER_FRAME). The cue bytes are never
      // read back (the intro object only polls the slot's state).
      startTransfer: (id: number) => {
        const sectors = this.mem.read16(LBA_LEN_SECTORS + (id & 0xffff) * 2) & 0xffff;
        const frames = Math.max(1, Math.ceil(sectors / this.cdSectorsPerFrame));
        this.cdFreeTick = this.cdFrame + frames;
        this.mem.write32(RESOURCE_SERVICE_ACTIVE, 1);
      },
      clock: () => this.mem.read32(FRAME_CLOCK_CELL) | 0,
      busyGate: () => 0,
    };
  }
  private fadeHost(): FadeWashCreateHost {
    return { allocate: (h, size, extra) => this.allocate(h, size, extra) };
  }

  /** The tick host: every edge is a port, a data write, or a named gap. */
  private tickHost(): DuelTickHost {
    return {
      // the three ported queue services are called directly
      applyQueuedGreyFlags: (duel, _scene) => applyQueuedGreyFlags(this.mem, duel),
      dispatchDuelViewQueue: (duel, scene) => dispatchDuelViewQueue(this.mem, this.viewQueueHost(), duel, scene),
      runQueuedAnnounce: (duel, scene) => runQueuedAnnounce(this.mem, this.fadeHost(), duel, scene),
      runEffectOpcode: (duel, view) => runEffectOpcode(this.mem, this.effectVmHost(), duel, view),
      fetchNextEffectOpcode: (duel, scene) => fetchNextEffectOpcode(this.mem, this.effectStepHost(), duel, scene),
      saveRestoreEffectStepBlock: (duel, scene) => saveRestoreEffectStepBlock(this.mem, this.effectStepHost(), duel, scene),
      // the mode machine's own enters/updates are the match; they are the gaps
      enterFive: (duel, scene) => enterPendingFiveSeven(this.mem, this.phaseEnterHost(), duel, scene),
      enterEight: (duel, scene) => enterPendingEight(this.mem, this.phaseEnterHost(), duel, scene),
      enterNine: (duel, scene) => enterPendingNine(this.mem, this.phaseEnterHost(), duel, scene),
      updateTwo: (duel, scene) => updateDuelModeTwo(this.mem, this.drawPhaseHost(), duel, scene),
      updateThree: (duel, _scene) => updateDuelModeThree(this.mem, duel),
      updateFour: (duel, _scene) => updateDuelModeFour(this.mem, duel),
      updateFive: (duel, scene) => updateDuelModeFiveSeven(this.mem, this.battleModeHost(), duel, scene),
      updateSix: (duel, scene) => updateDuelModeSix(this.mem, this.battleModeHost(), duel, scene),
      updateEight: (duel, scene) => updateDuelModeEight(this.mem, this.battleModeHost(), duel, scene),
    };
  }

  /**
   * The board view's four method slots the browse reveal walk dispatches
   * through — now real bodies (engine/dw3/ui/duel-board-view.ts), not gaps. The
   * slot binder builds the resident card-view class on the session's scratch.
   */
  private boardHost(): DuelBoardHost {
    return {
      positionSlot: (view, index, x, y) => placeCardResetVisual(this.mem, view, index, x, y),
      writeSlotValue: (view, index, value) =>
        bindSlotToCard(this.mem, this.cardViewHost(), this.slotScratch, view, index, value),
      hideSlot: (view, index) => hideCardSprite(this.mem, view, index),
      slotRevealOffset: (count, index) => cardFanOut(count, index),
    };
  }

  /** The resident card-view class's host the slot binder needs. */
  private cardViewHost(): CardViewHost {
    return {
      resourceGetBase: (id) => this.opponentPackBase(id),
      loadImage: () => {},
      findRegisteredHandleByKey: () => 0,
      callViewMethod: () => 0,
    };
  }

  /**
   * The view-window / resolving-card presentation the mode updates call
   * (engine/dw3/ui/duel-view-window.ts): now real service bodies. The view's
   * own window/banner/settle methods and the resident random-bit service are
   * still separate routines, so they remain named gaps.
   */
  private viewWindowHost(): DuelViewWindowHost {
    return {
      openViewWindow: () => this.gap(0x8009c2d0, "view open window"),
      openInfoBanner: (view, kind, a2, a3, w, h) =>
        openInfoBanner(this.mem, this.bannerHost(), view, kind, a2, a3, w, h),
      writeBannerRecord: (view, kind) => writeBannerRecord(this.mem, this.bannerHost(), view, kind),
      scaleSlot: (view, index, span, from, to) => scaleSlot(this.mem, view, index, span, from, to),
      closePlate: (view, index) => closePlate(this.mem, view, index),
      settleSlot: () => this.gap(0x8009ce28, "view settle slot"),
      frameDelta,
      randomValue: () => this.gap(0x8005bbf8, "random value service"),
      randomShift: () => this.gap(0x8005bbd8, "random shift service"),
      playSound: (id) => { this.soundIds.push(id | 0); this.options.playPackedSound?.(id | 0); },
    };
  }

  /**
   * The view-window / card-slot presentation family ported as shared services
   * (engine/dw3/ui/duel-view-window.ts) — a future port of the mode updates
   * drives these through this object.
   */
  readonly windowHost = {
    /** F0x800A1DB8(duel, scene). */
    waitViewWindowOpen: (duel: number, scene: number) =>
      waitViewWindowOpen(this.mem, this.viewWindowHost(), duel, scene),
    /** F0x800A1E60(duel, scene). */
    presentResolvingCard: (duel: number, scene: number) =>
      presentResolvingCard(this.mem, this.viewWindowHost(), duel, scene),
  };

  /**
   * The pile/hand bookkeeping the mode updates call, now real service bodies
   * (engine/dw3/ui/duel-pile-service.ts) rather than gaps. A future port of the
   * mode updates drives these through this object.
   */
  readonly pileHost = {
    /** F0x8009D9E4(duel). */
    scanDeckAvailability: (duel: number) => scanDeckAvailability(this.mem, duel),
    /** F0x8009D8FC(duel). */
    sortAiHandByPriority: (duel: number) => sortAiHandByPriority(this.mem, duel),
    /** F0x800A19F8(block). */
    returnHandToDeck: (block: number) => returnHandToDeck(this.mem, block),
    /** F0x8009DA68(duel). */
    recycleOpponentHandIntoDeck: (duel: number) => recycleOpponentHandIntoDeck(this.mem, duel),
  };

  /** The opponent AI's host edges. Inert by default; the session carries no
   *  card catalog, so a real pick needs `options.aiHost` supplied. */
  private aiHost(): AiHost {
    const o = this.options.aiHost ?? {};
    return {
      resolveCardRecord: (id) => o.resolveCardRecord?.(id) ?? 0,
      cardField: (instance, field) => o.cardField?.(instance, field) ?? 0,
      isSummonableCard: (duel, index) => o.isSummonableCard?.(duel, index) ?? true,
      fieldProbe: (duel, side, sel, extra, arg) => o.fieldProbe?.(duel, side, sel, extra, arg) ?? 0,
      fieldProbeKind: (duel, side, sel, extra) => o.fieldProbeKind?.(duel, side, sel, extra) ?? 0,
      armThinkWindow: () => {},
    };
  }

  /**
   * F0x800A4978(duel, arg1): the opponent's card choice, over the session's own
   * duel object. The mode updates that would call it are still gaps, so this is
   * the translated pick, available to a future match driver — not a match.
   */
  chooseOpponentCard(arg1: number): number {
    return aiChooseCardToPlay(this.mem, this.aiHost(), this.duel(), arg1);
  }

  private viewQueueHost(): DuelViewQueueHost {
    return {
      frameDelta,
      startAiPileBrowse: (duel, scene, row, kind) =>
        startAiPileBrowse(this.mem, this.boardHost(), duel, scene, row, kind),
      primeAiPileBrowseCounts: (duel, scene, row, kind) => primeAiPileBrowseCounts(this.mem, duel, row, kind),
      refreshFieldCardViews: (duel, scene) =>
        refreshFieldCardViews(this.mem, this.fieldRefreshHost(), duel, scene),
      scaleSlot: (view, index, span, from, to) => scaleSlot(this.mem, view, index, span, from, to),
      openPlate: (view, index, value) => openPlate(this.mem, view, index, value),
      closePlate: (view, index) => closePlate(this.mem, view, index),
    };
  }

  // ── the draw pass (F0x8009BBA8) ───────────────────────────────────────────
  /**
   * The board view's per-frame handler (cardDuelViewTick, F0x8009BBA8), which
   * the screen's DRAW PASS calls every frame. It is the only layer that runs the
   * waiting spinner F0x80096950 — the sole writer of view+0xE9E = 2, the value
   * the mode-1 update blocks on. A driver that does not run it (tick-only)
   * stalls forever in mode 1, ours and the original's alike.
   */
  drawFrame(): void {
    const view = this.view();
    if (view === 0) return;
    cardDuelViewTick(this.mem, view, this.renderCtx, this.headlessViewHost());
  }

  /**
   * One full frame as the original's screen runs it: advance the shared frame
   * clock one displayed frame, run the tick (the mode machine and the queue
   * services), then the board view's draw pass. This is the first driver that
   * can leave mode 1.
   */
  runFrame(): number {
    advanceFrameClock();
    this.cdFrame += 1;
    // The disc device frees the resource service once the in-flight read's
    // latency has elapsed (the original's CD interrupt clears 0x80044B04).
    if ((this.mem.read32(RESOURCE_SERVICE_ACTIVE) | 0) !== 0 &&
        this.cdFrame >= this.cdFreeTick) {
      this.mem.write32(RESOURCE_SERVICE_ACTIVE, 0);
    }
    // The resident cache service runs once per display tick ([0x80013CDC],
    // cacheServicePending): it starts one in-flight transfer and retires the
    // ones already dispatched, which is what lets the intro-voice cue loader's
    // poll ever answer "resident".
    cacheServicePending(this.mem, this.cacheServiceHost());
    // The screen's intro-voice task object (handler F0x8009D540, intro-cue.ts)
    // runs once per frame; the mode-2 Draw Phase's first arm waits on the state
    // it publishes, and the original reaches it through the screen's task list.
    const intro = this.intro();
    if (intro !== 0) introVoiceCueTick(this.mem, this.introHost(), intro);
    const result = this.tickFrame();
    this.drawFrame();
    return result | 0;
  }

  private headlessView: ReturnType<typeof createHeadlessDuelViewHost> | null = null;
  private headlessViewHost(): ReturnType<typeof createHeadlessDuelViewHost> {
    if (this.headlessView === null) {
      this.headlessView = createHeadlessDuelViewHost(this.mem, {
        frameDelta,
        alloc: (bytes) => this.alloc(bytes, 4),
      });
    }
    return this.headlessView;
  }

  /**
   * The Draw Phase's (mode 2) own edges: the resident card cursor (a session has
   * no disc catalog), the two pad readers (no controller), the frame clock, the
   * packed-sound dispatcher, and the four already-ported services the last arm
   * calls. `pileShuffle` (duel+0x810, F0x8009F04C) is not yet a body, so it
   * stays a named gap.
   */
  private drawPhaseHost(): DrawPhaseHost {
    return {
      allocate: (h, size, slot) => this.allocate(h, size, slot),
      frameDelta,
      playSound: (id) => { this.soundIds.push(id | 0); this.options.playPackedSound?.(id | 0); },
      padWord: (port) => this.options.padWord?.(port) ?? 0,
      padRepeatWord: (port) => this.options.padRepeatWord?.(port) ?? 0,
      padKeyBit: (port, code) => this.options.padKeyBit?.(port, code) ?? 0,
      openElementCursor: () => this.alloc(0x40, 4),
      resolveCardInto: () => {},
      cardKind: () => 0,
      buildCardTable: (out, playerList, opponentList) =>
        buildDuelCardTable(this.mem, this.cardTableHost(), out, playerList, opponentList),
      scanDeckAvailability: (duel) => scanDeckAvailability(this.mem, duel),
      refreshAllCounters: (duel, scene) => refreshAllCounters(this.mem, this.counterHost(), duel, scene),
      pileShuffle: (duel, a1, a2) => shufflePile(this.mem, this.cardTableHost(), duel, a1, a2),
    };
  }

  /** The resident card cursor the card-table family walks (host edges). */
  private cardTableHost(): CardTableHost {
    return {
      openCardTableCursor: () => this.alloc(0x40, 4),
      openCardList: () => this.alloc(0x40, 4),
      resolveCardInto: () => {},
      cardTableRecord: () => {},
      cardIdByIndex: () => 0,
      randU16: () => this.options.randU16?.() ?? 0x777,
    };
  }

  /** The view slot the counter service pushes every HUD number through. */
  private counterHost(): DuelCounterHost {
    return {
      setHudCounter: (view, side, index, value) => setHudCounter(this.mem, view, side, index, value),
    };
  }

  /** The packed-sound edge the banner family plays through. */
  private bannerHost(): { playSound(id: number): void } {
    return {
      playSound: (id) => { this.soundIds.push(id | 0); this.options.playPackedSound?.(id | 0); },
    };
  }

  /**
   * The edges the effect layer runs for real: the dynamic-stat megas (the
   * effect-step card probe), the view window, the HUD repaint, and the phase
   * banner. Every other effect-VM / effect-step edge is a named gap.
   */
  private effectHostServices(): DuelEffectHostServices {
    return {
      applyDynamicStatMegas: (duel) => applyDynamicStatMegas(this.mem, duel),
      waitViewWindowOpen: (duel, scene) => waitViewWindowOpen(this.mem, this.viewWindowHost(), duel, scene),
      presentResolvingCard: (duel, scene) => presentResolvingCard(this.mem, this.viewWindowHost(), duel, scene),
      repaintHudStrips: (duel, scene) => refreshAllCounters(this.mem, this.counterHost(), duel, scene),
      showPhaseBanner: (duel, view, banner) => phaseBannerShow(this.mem, this.phaseBannerHost(), duel, view, banner),
      tickPhaseBanner: (duel, view) => phaseBannerTick(this.mem, this.phaseBannerHost(), duel, view),
      openPromptView: (view, a1, a2, a3, a4) => openPromptSlot(this.mem, this.viewOpenersHost(), view, a1, a2, a3, a4),
      closePromptView: (view) => closePromptSlot(this.mem, this.viewOpenersHost(), view),
      confirmPromptView: (view) => confirmPromptSlot(this.mem, this.viewOpenersHost(), view),
      inputPressed: (port) => this.options.padWord?.(port) ?? 0,
      inputButtonBit: (port, code) => this.options.padKeyBit?.(port, code) ?? code,
      inputRepeat: (port) => this.options.padRepeatWord?.(port) ?? 0,
    };
  }

  /**
   * The inter-phase banner's four view-method edges. The original showPhaseBanner
   * (F0x800894E4) and its step machine reach the board view's
   * constructor-installed method table at view+0xEE4 (openPrompt, F0x8009C054),
   * view+0xEAC (open_info_banner, F0x8009BEAC), view+0xEB0 (write_banner_record,
   * F0x8009BF5C) and view+0xEE8 (close_prompt, F0x8009C0DC) — slots §23 records.
   * The body of close_prompt was read from the overlay assembly at
   * .L0x0001942c; the m2c blob drops it. Every other edge of the phase banner
   * now dispatches to a real body rather than a TranslatedGapError.
   */
  private phaseBannerHost(): PhaseBannerHost {
    return {
      showBannerWidget: (view, bannerId) =>
        openPromptSlot(this.mem, this.viewOpenersHost(), view, bannerId, 0, 0, 1),
      setBannerFrame: (view, record) =>
        openBannerSlot(this.mem, this.viewOpenersHost(), view, 5, 5, record, 0, 0x42),
      advanceBanner: (view, value) => writeBannerRecord(this.mem, this.bannerHost(), view, value),
      finishBanner: (view) => closePromptSlot(this.mem, this.viewOpenersHost(), view),
    };
  }

  /** The view-openers family's sound edge (close_prompt / openPrompt / banners). */
  private viewOpenersHost(): { playPackedSound(id: number): void } {
    return {
      playPackedSound: (id) => { this.soundIds.push(id | 0); this.options.playPackedSound?.(id | 0); },
    };
  }

  /** The phase-enter arms' edges, all already-ported services. */
  private phaseEnterHost(): PhaseEnterHost {
    return {
      returnHandToDeck: (block) => returnHandToDeck(this.mem, block),
      recycleOpponentHandIntoDeck: (duel, _scene) => recycleOpponentHandIntoDeck(this.mem, duel),
      shufflePile: (duel, offset, count) => shufflePile(this.mem, this.cardTableHost(), duel, offset, count),
      refreshCounters: (duel, scene) => refreshAllCounters(this.mem, this.counterHost(), duel, scene),
      scanDeck: (duel, _scene) => scanDeckAvailability(this.mem, duel),
      sortHand: (a, b, packed, flags) => handSelectionSort(this.mem, a, b, packed, flags),
      slidePanelsIn: (view) => slideBothPanelsIn(this.mem, view),
    };
  }

  /**
   * The effect-commit records' host (duel-effect-commit.ts). The two record
   * helpers it dispatches through are not yet ported bodies: F0x80083E34 (the
   * card-table field getter) and view+0xF40 (the board view's slot classifier).
   * They stay named gaps so the commit and the mark walk name them if reached.
   */
  private duelEffectCommitHost(): DuelEffectHost {
    return {
      cardField: () => this.gap(0x80083e34, "card-table field getter"),
      queryTarget: (view, cardId) =>
        fieldSlotColour(this.mem, this.cardViewHost(), this.slotScratch, view, cardId),
    };
  }

  /**
   * The board view's browse refresh (F0x8009E024) and its slot-colour query
   * (view+0xF40 / F0x8009CF60) — both real bodies now. The refresh dispatches
   * through the same three board-view method slots the browse walk uses
   * (view+0xF14 place, view+0xF3C bind) plus the colour query.
   */
  private fieldRefreshHost(): FieldRefreshHost {
    return {
      positionSlot: (view, index, x, y) => placeCardResetVisual(this.mem, view, index, x, y),
      writeSlotValue: (view, index, value) =>
        bindSlotToCard(this.mem, this.cardViewHost(), this.slotScratch, view, index, value),
      slotColour: (view, cardId) =>
        fieldSlotColour(this.mem, this.cardViewHost(), this.slotScratch, view, cardId),
    };
  }

  /**
   * The three ported mode updates' edges (engine/dw3/ui/duel-mode-battle.ts):
   * the Battle Phase (F0x8009FDD8), mode 6 (F0x800A0B80) and the Set-End Phase
   * (F0x800A0F94). Every board-view method and service runs its real ported
   * body; the sub-layer routines the mode updates still reach are named gaps —
   * the duel's +0x818 method (F0x800A0754), the score widget constructor
   * (F0x800A367C) with its two method slots, and the effect-commit record
   * helpers above.
   */
  private battleModeHost(): DuelBattleModeHost {
    const commitHost = this.duelEffectCommitHost();
    return {
      slidePanelsIn: (view) => slideBothPanelsIn(this.mem, view),
      openInfoBanner: (view, kind, a2, a3, w, h) =>
        openBannerSlot(this.mem, this.viewOpenersHost(), view, kind, a2, a3, w, h),
      writeBannerRecord: (view, kind) => writeBannerRecord(this.mem, this.bannerHost(), view, kind),
      openPrompt: (view, a1, a2, a3, a4) =>
        openPromptSlot(this.mem, this.viewOpenersHost(), view, a1, a2, a3, a4),
      closePrompt: (view) => closePromptSlot(this.mem, this.viewOpenersHost(), view),
      setHudCounter: (view, side, index, value) => setHudCounter(this.mem, view, side, index, value),
      growTurnMarker: (view, side) => growTurnMarker(this.mem, view, side),
      shrinkTurnMarker: (view, side) => shrinkTurnMarker(this.mem, view, side),
      playPackedSound: (id) => { this.soundIds.push(id | 0); this.options.playPackedSound?.(id | 0); },
      frameDelta,
      inputPortReset: () => this.options.padWord?.(0) ?? 0,
      inputPortWord: (port, code) => this.options.padKeyBit?.(port, code) ?? code,
      sortAiHand: (duel) => sortAiHandByPriority(this.mem, duel),
      aiChooseCard: (duel, view) => aiChooseCardToPlay(this.mem, this.aiHost(), duel, view),
      commitSelectedHandCard: (duel, _scene) => commitSelectedHandCard(this.mem, commitHost, duel),
      markLegalFieldTargets: (duel, view) => markLegalFieldTargets(this.mem, commitHost, duel, view),
      waitAiThinkWindow: (duel, scene) => waitAiThinkWindow(this.mem, this.aiHost(), duel, scene),
      handSelectionSort: (a, b, packed, flags) => handSelectionSort(this.mem, a, b, packed, flags),
      duelMethod818: () => this.gap(0x800a0754, "duel +0x818 method"),
      applyDynamicStatMegas: (duel) => applyDynamicStatMegas(this.mem, duel),
      recomputeSideTotals: (duel, side) => recomputeSideTotals(this.mem, duel, side),
      scanComboRuns: (duel, side, cell) => scanComboRuns(this.mem, this.aiHost(), duel, side, cell),
      createScoreWidget: () => this.gap(0x800a367c, "score widget constructor"),
      scoreWidgetConfigure: () => this.gap(0x800a367c, "score widget configure"),
      scoreWidgetRun: () => this.gap(0x800a367c, "score widget run"),
    };
  }

  /**
   * The effect-VM opcode runner's host: real banner and ported helpers, every
   * other edge a gap.
   */
  private effectVmHost() {
    return createEffectVmHost(
      (addr, role) => this.gap(addr, role),
      this.effectHostServices(),
      {
        // Opcode 0xA7's enter arm: the coin toss. The two face slots go through
        // the board-view bodies the browse walk already uses; the bit comes from
        // the resident random word's low bit ([0x8004DC0C]).
        effectOpA7StartCoinToss: (duel, view) => effectOpA7StartCoinToss(
          this.mem,
          {
            randomBit: () => (this.options.randU16?.() ?? 0x777) & 1,
            positionSlot: (v, i, x, y) => placeCardResetVisual(this.mem, v, i, x, y),
            writeSlotValue: (v, i, value) =>
              bindSlotToCard(this.mem, this.cardViewHost(), this.slotScratch, v, i, value),
          },
          duel,
          view,
        ),
        // Opcode 0xA7's tick: the coin toss's six-state machine. Its view-method
        // edges (view+0xF0C move, view+0xF24 scale, view+0xF28 flip, view+0xEAC
        // banner open, view+0xEB0 banner record) are all ported bodies; the pad
        // reads are the session's controller options.
        tickCoinToss: (duel, view) => coinTossTick(this.mem, this.coinTossHost(), duel, view),
        // Opcode 0x14's enter arm: clear both boards and deal a fresh turn. The
        // four HUD readouts go through the ported counter body; the field writes
        // arm the ceremony's tick state.
        effectOp14ClearBothBoards: (duel, view) => effectOp14ClearBothBoards(
          this.mem, this.dealTurnStartHost(), duel, view,
        ),
        // Opcode 0x14's tick: the two-level clear/deal ceremony. Its view-method
        // edges are ported bodies where they exist (prompt open/close, scale,
        // flip) and named gaps otherwise.
        tickDealTurnStart: (duel, view) => tickDealTurnStart(this.mem, this.dealTurnStartHost(), duel, view),
        // Opcode 0x98's enter arm: open the player's own-field picker. The panel
        // slide and the hand-usability predicate (F0x80085FD0) are ported bodies.
        effectOp98OpenOwnFieldPicker: (duel, view, mode) =>
          effectOp98OpenOwnFieldPicker(this.mem, this.ownFieldPickerHost(), duel, view, mode),
      },
    );
  }

  /**
   * The deal-turn-start ceremony's (F0x80092E60) edges. The prompt open/close,
   * scale, flip, slot placement/binding and HUD counter run their real ported
   * bodies; the view's panel/highlight/card-motion methods, the per-row counter
   * step and the shared input port are named gaps until their families are
   * ported.
   */
  private dealTurnStartHost(): DealTurnStartHost {
    return {
      playPackedSound: (id) => { this.soundIds.push(id | 0); this.options.playPackedSound?.(id | 0); },
      frameDelta,
      setHudCounter: (view, side, index, value) => setHudCounter(this.mem, view, side, index, value),
      scaleSlot: (view, index, span, from, to) => scaleSlot(this.mem, view, index, span, from, to),
      cardStartFlip: (view, index) => cardStartFlip(this.mem, this.viewOpenersHost(), view, index),
      openPrompt: (view, a1, a2, a3, a4) => openPromptSlot(this.mem, this.viewOpenersHost(), view, a1, a2, a3, a4),
      closePrompt: (view) => closePromptSlot(this.mem, this.viewOpenersHost(), view),
      placeSlot: (view, index, x, y) => placeCardResetVisual(this.mem, view, index, x, y),
      bindSlot: (view, index, value) =>
        bindSlotToCard(this.mem, this.cardViewHost(), this.slotScratch, view, index, value),
      slidePanelsIn: (view) => slideBothPanelsIn(this.mem, view),
      slidePanelsOut: (view) => slideBothPanelsOut(this.mem, view),
      setHudHighlights: (view, mask) => setHudHighlights(this.mem, view, mask),
      cardStartMoveWithSfx: (view, index, span, x, y) =>
        cardStartMoveWithSfx(this.mem, this.viewOpenersHost(), view, index, span, x, y),
      setCardScaleEndpoints: (view, index, a2, a3) => setCardScaleEndpoints(this.mem, view, index, a2, a3),
      cardStartSettle: (view, index) => cardStartSettle(this.mem, this.viewOpenersHost(), view, index),
      settleRowCard: (duel, view, side, value) =>
        settleRowCard(this.mem, this.settleRowHost(), duel, view, side, value),
      inputPortReset: () => this.options.padWord?.(0) ?? 0,
      inputPortWord: (port, code) => this.options.padKeyBit?.(port, code) ?? code,
    };
  }

  /** The edges the deal ceremony's per-row counter step (F0x8008D854) drives:
   *  the resident card-record cursor and the view's HUD counter. */
  private settleRowHost(): SettleRowHost {
    return {
      cardCursorScratch: () => this.settleScratch,
      cardCursorCreate: (scratch) => constructCardView(this.mem, scratch),
      cardRecordSelect: (_scratch, id) => resolveCardRecord(this.mem, this.cardViewHost(), id),
      setHudCounter: (view, side, index, value) => setHudCounter(this.mem, view, side, index, value),
    };
  }

  /**
   * The opcode-0x98 own-field picker's edges (duel-effect-pickers.ts): the
   * panel slide (view+0xEC8, ported) and the hand-usability predicate
   * (F0x80085FD0, ported) — both real bodies now.
   */
  private ownFieldPickerHost(): OwnFieldPickerHost {
    return {
      slidePanelsIn: (view) => slideBothPanelsIn(this.mem, view),
      handUsable: (duel, param, cardId) =>
        handUsableCheck(this.mem, this.cardViewHost(), this.slotScratch, duel, param, cardId),
    };
  }

  /** The coin toss tick's (F0x80089974) edges, all ported bodies or options. */
  private coinTossHost(): CoinTossHost {
    return {
      playPackedSound: (id) => { this.soundIds.push(id | 0); this.options.playPackedSound?.(id | 0); },
      frameDelta,
      padPressed: (port) => this.options.padWord?.(port) ?? 0,
      padRepeat: (port) => this.options.padRepeatWord?.(port) ?? 0,
      padKeyBit: (port, code) => this.options.padKeyBit?.(port, code) ?? 0,
      scaleSlot: (view, index, span, from, to) => scaleSlot(this.mem, view, index, span, from, to),
      cardStartMoveSilent: (view, index, span, destX, destY) =>
        cardStartMoveSilent(this.mem, view, index, span, destX, destY),
      cardStartFlip: (view, index) => cardStartFlip(this.mem, this.viewOpenersHost(), view, index),
      openInfoBanner: (view, index, a2, a3, a4, a5) =>
        openBannerSlot(this.mem, this.viewOpenersHost(), view, index, a2, a3, a4, a5),
      writeBannerRecord: (view, index) => writeBannerRecord(this.mem, this.bannerHost(), view, index),
    };
  }

  /** The effect-step machines' host: real probe/window/HUD, the rest gaps. */
  private effectStepHost() {
    return createEffectStepHost((addr, role) => this.gap(addr, role), this.effectHostServices());
  }

  /** A pack handle -> its base. Both artwork packs resolve to an empty table. */
  private resolvePack(handle: number): number {
    const h = handle >>> 0;
    if (h === CARD_BATTLE_PACK_A || h === CARD_BATTLE_PACK_B || h === DUEL_PACK_HANDLE) {
      const base = this.alloc(DUEL_EMPTY_PACK_BYTES, 16);
      return base;
    }
    return this.options.resolvePack?.(h) ?? 0;
  }

  private opponentPackBase(id: number): number {
    // The AI deck record the scene handler copies from: a zeroed CARD_NPC page,
    // so the deck load copies an empty record (the real page is disc data).
    if ((id | 0) === OPPONENT_DECK_PACK_ID) return this.alloc(0xd0 * 2, 16);
    return this.alloc(0x10, 16);
  }

  // ── the driven frame ──────────────────────────────────────────────────────
  /** Run the scene handler once. State 0 builds the duel and arms mode 1. */
  setupDuel(): void {
    const duel = this.mem.read32(this.duelSlot) >>> 0;
    cardDuelSceneHandler(this.mem, this.sceneHost(), duel, this.ctx);
  }

  /** One frame of the duel tick (F0x800A2DF8) over the composed objects. */
  tickFrame(): number {
    const duel = this.mem.read32(this.duelSlot) >>> 0;
    const result = cardDuelTick(this.mem, this.tickHost(), duel, this.ctx);
    this.frame += 1;
    return result | 0;
  }

  // ── observation ───────────────────────────────────────────────────────────
  duel(): number { return this.mem.read32(this.duelSlot) >>> 0; }
  view(): number { return this.mem.read32(this.ctx + DUEL_CTX_VIEW) >>> 0; }
  intro(): number { return this.mem.read32(this.ctx + DUEL_CTX_INTRO) >>> 0; }
  fade(): number { return this.mem.read32(this.ctx + DUEL_CTX_FADE) >>> 0; }
  sounds(): readonly number[] { return this.soundIds; }
  /** The duel's mode word [duel+0x2F8] and its tick arm [duel+0x2F4]. */
  mode(): number {
    const duel = this.duel();
    if (!duel) return 0;
    return this.mem.read8(duel + DUEL_MODE.current) & 0xff;
  }
  arm(): number {
    const duel = this.duel();
    if (!duel) return 0;
    return this.mem.read8(duel + DUEL_TICK_ARM) & 0xff;
  }
  /** The board view's waiting-spinner state [view+0xE9E] the mode-1 update waits on. */
  viewWidget(): number {
    const view = this.view();
    if (!view) return 0;
    return this.mem.read8(view + 0xe9e) & 0xff;
  }
  /** The mode the duel has queued for its next rotate [duel+0x2F7]. */
  pending(): number {
    const duel = this.duel();
    if (!duel) return 0;
    return this.mem.read8(duel + DUEL_MODE.pending) & 0xff;
  }

  diagnostics(): Record<string, unknown> {
    const duel = this.duel();
    return {
      execution: "translated",
      composed: true,
      frame: this.frame,
      screen: this.screen,
      duel,
      view: this.view(),
      intro: this.intro(),
      fade: this.fade(),
      mode: this.mode(),
      arm: this.arm(),
      selector: duel ? (this.mem.read8(duel + DUEL_SELECTOR) & 0xff) : 0,
      sounds: [...this.soundIds],
      unported: DUEL_UNPORTED_ROUTINES.map(([address]) => `0x${address.toString(16)}`),
    };
  }
}
