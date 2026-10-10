// web/cardduel.js — the card duel screen (pro/cardgame overlay), walker
// recreation.
//
// The phase structure is the decoded one: the round driver F0x800a1b48 runs a
// fixed six-step loop and the inter-phase mode 0xa picks the banner and the next
// mode from the table at 0x800a5d5c, giving Start -> Draw -> Load -> Summon ->
// Compile -> Battle -> Start. The banner and prompt strings below are
// escardgm.toml verbatim. See docs/research/card/card-duel-engine-2026-08-04.md
// and engine/systems/card-battle.ts, which owns all the rules.
//
// The ART and the HUD GEOMETRY are decoded (2026-08-05, docs/research/card/
// cardduel-screen-decoded-2026-08-05.md): the duel's pack is CARDDATA.BIN
// (handle 0x25d), whose slot 2 is the card sheet and slot 3 the board sheet,
// and tools/extract_cardduel_ui.py reads the per-player HUD record table at
// 0x800A59D0 and the card-face composition straight out of the overlay.
// Everything drawn from `ui` below is that decode.
//
// The card MOTION is decoded too (2026-08-05, docs/research/card/
// cardduel-animation-decoded-2026-08-05.md): every card is one of 40 pooled
// 0x4C-byte sprites running a 12-state animation machine (F0x8009b890), and
// engine/systems/card-animation.ts owns that machine — the tweens, the flip,
// the two shakes, the summon arc, the effect runs and the 41px fan-out are all
// the original's own maths. This file only issues the commands and draws.
//
// The CHOREOGRAPHY is decoded as of 2026-08-06 (docs/research/card/
// cardduel-choreography-2026-08-06.md). The row-layout helper 0x8009CE94 still
// has no identified caller, so this did not come from the overlay — it came
// from reducing the 2026-08-05 rig captures, which log every pooled sprite's
// position, destination, scale, state and timer on every change. That is
// authority 1, controlled runtime comparison. The board rows, the deal's entry
// from off the right edge, its scale ramp and stagger, the flip wave, and the
// opponent hand's collapse all come from `DUEL_BOARD` and the DEAL_* constants
// in engine/systems/card-animation.ts and are cited at each site below.
//
// STILL NOT DECODED, and placed or chosen by the walker rather than the game —
// each site is marked `WALKER PLACEMENT` or `WALKER MAPPING`:
//   * what the centre-row fan-out represents, and which card identity each
//     pooled sprite carried — the trace logs slots and geometry only;
//   * the battle phase's reaction, and the summon. Only a won duel was
//     captured, and the capture cannot say which model event drove a sprite.
// Program-card effects, the opponent AI and the original's set-resolution path
// are not decoded either; engine/systems/card-battle.ts says so at each site.
import { asButton } from "./input.js";
import { drawText, textWidth } from "./uifont.js";
import { loadPack, drawClip, packReady, drawClipAtPaletteRow } from "./screenpack.js";
import {
  createDuel, tickDuel, duelBeatBusy, duelBeatAwaitsButton, dismissBeat,
  phase, discAgent, canSummon, canPlayProgram, checkEffectLegality,
  handCardSelectable,
  SETS_TO_WIN, DYNAMIC_STAT_MEGAS,
  browserRowLegal,
  indexEffects, fieldTargets, ENERGY_COLOURS, FIELD_LIMIT, energyIndex,
  startDealTally, dealTallyShown, DEAL_TALLY_STEPS, DUEL_MESSAGE,
  startHandReturn, handReturnShown,
  CALUMON_CARD_ID, IMPMON_CARD_ID,
  SCALE_ONE, CardAnimState, CardRenderKind,
  createCardSprite, despawnCard, moveCard, scaleCard, flipCard, shakeCard, SHAKE_DURATION,
  holdCard, playCardEffect, summonCard, stepCardSprite, cardEffectFrame,
  cardBusy, cardFanOut, cardRowSlot, revealCard, REVEAL_STAGGER, REVEAL_DURATION,
  PILE_REVEAL_STAGGER, tickStats,
  DUEL_BOARD, DEAL_START_X, DEAL_DURATION, DEAL_STAGGER, DEAL_FLIP_STAGGER,
  HAND_COLLAPSE_DURATION,
  pileAnimDuration,
  createBannerSlide, startBannerSlide, stepBannerSlide, BannerPhase, BANNER_SIDES,
  createCardView, stepCardView, resetPanels,
  openPlate, closePlate, viewPlateClip, VIEW_PLATE_ORIGINS,
  growTurnMarker, shrinkTurnMarker,
  slideBothPanelsIn, slideBothPanelsOut, slidePanelIn, slidePanelOut, PANEL_SHOWN,
  startReveal, revealNumbers, clearReveal,
  openPrompt, closePrompt, promptProgress, markerPulsePhase, PromptState, InfoBannerState, WIDGET_SCALE_FULL,
  openPromptB, closePromptB, confirmPromptB, setPromptCursorB, promptBProgress,
  INSPECT_ROWS, moveInspectCursor, INSPECT_HEADING,
  fieldSectionCards, firstFieldSection, stepFieldSection, clampBrowseCursor,
  surrenderDuel,
  openBanner, closeBanner,
  comboRuns, comboRunScore, comboSlotFlags, comboPickerDimmed, defaultComboCursor,
  awaitingCardChoice, duelChoice, resolveCardChoice,
  beginProgramTurns, programTurnSide, passProgramTurn, playProgramTurn,
  settleProgramTurn, runProgramTurns, tickProgramTurns,
  beginSummonTurns, summonTurnSide, takeSummonTurn, endSummonTurn,
  runSummonTurns, canSummonAny, toggleSummonMark, commitMarkedSummons,
  beatNeedsAnimation,
  FOLDER_CHOOSER_STATES, FOLDER_CHOOSER_OPEN_TICKS, FOLDER_CHOOSER_CLOSE_TICKS,
  FOLDER_FALLBACK_DECK,
  startDrain, drainDone, drainAttackerShown, drainDefenderShown,
  padRepeatFires,
} from "./vendor/engine.js";
import {
  loadCatalog, catalog, cardById, cards, loadCardIcons, drawCardIcon,
  loadOpponents, opponentById, opponentDeck, grantPackForOpponent,
} from "./cardstate.js";

// ---- the duel's message chrome, measured off the rig captures ---------------
// Authority 1 (controlled runtime comparison): the 2026-08-05 rig runs
// screenshot the framebuffer every third frame, and every banner/prompt screen
// of that duel — Card Battle Challenge, Choose a folder, Start/Draw/Load Phase,
// "You go first." — draws the SAME full-width chrome at the SAME rows. The
// reference frames are in web/assets/ref/cardduel/ (tools/build_cardduel_refs.py)
// and the lab shows them under the live canvas.
//
// Both bands are 320 wide and share one 3-row border: 0x000088, 0x080858,
// 0x282860 going in, mirrored coming out, over a 0x080838 fill.
const CHROME = {
  edge: ["rgb(0,0,136)", "rgb(8,8,88)", "rgb(40,40,96)"],
  fill: "rgb(8,8,56)",
};
/** Phase banner band: y 66..85, title centred, glyph top at y = band + 5. */
const BANNER_BAND = { y: 66, h: 20 };
/** Prompt window band: y 96..143, text left-aligned at x = 28, 14px line pitch. */
const PROMPT_BAND = { y: 96, h: 48, textX: 28, textY: 100, lineH: 14 };
/** The folder chooser's own title band sits higher, at y 38..57. */
/** The selected folder plate's CLUT row (F0x80095e58): looping
 *  (counter>>2) mod 16, or the one-shot min(counter>>1, 7) once confirmed.
 *  `markerAge` is ticks since the cursor marker appeared. */
export function chooserRow(markerAge, confirmed) {
  const counter = Math.max(0, markerAge);
  return confirmed ? Math.min(counter >> 1, 7) : ((counter >> 2) % CHOOSER.rowCycleRows);
}

const CHOOSER_BAND = { y: 38, h: 20 };

/** The challenge screen — the very first thing a duel shows, and the one band
 *  pair whose title is NOT white.
 *
 *  Authority 1, measured off web/assets/ref/cardduel/challenge.png, which is
 *  frame 510 of rig run 1: the banner band is the same y 66..85 as every phase
 *  title and the prompt window the same y 96..143, but the title glyphs are
 *  amber rgb(216,144,0) where start-phase.png, draw-phase.png, load-phase.png
 *  and folder-choose.png all draw rgb(232,232,232). The two prompt lines start
 *  at x = 28, tops at y 101 and 115 — PROMPT_BAND's own textX/textY and 14px
 *  pitch, so the challenge reuses the window rather than defining a new one.
 *
 *  What the two lines SAY is the decoded pair the name plate already uses:
 *  escardgm string 0x3e ("LV") with CARD_NPC byte +0xC8 beside it, and the
 *  escrddek folder name for record (id+1)/2 underneath.
 *  — CARDNPC-BYTE-C8-IS-THE-OPPONENT-LEVEL-2026-08-14,
 *    CARDGAME-ESCRDDEK-NAMES-ARE-OPPONENT-FOLDERS-2026-08-14.
 *  The capture reads "LV 10" / "Mother Nature Folder", which is that pair. */
const CHALLENGE_TITLE_COLOR = "rgb(216,144,0)";

/** The folder chooser: "Choose a folder", three rows, each carrying the
 *  folder's name and how many cards of each of the six colours it holds.
 *
 *  The ROW ART is the record's own: card clips 70 and 71 are 292-wide row
 *  plates, and clip 71 — the selected one — reaches 4px higher than clip 70
 *  for the arrow tab, which is why both rows are drawn at the same y and only
 *  the clip changes.
 *
 *  The ROW CONTENTS are the decoded six-across strip: F0x80096418 builds a
 *  title widget at (+5, +3) plus six numeric widgets from the 4-byte records at
 *  0x800A5940, x 36/71/106/141/176/211 and all y 20 — which is UI.labels. The
 *  numbers are right-aligned on those x, which is what puts a one-digit count
 *  and a two-digit count in the same column.
 *
 *  WALKER PLACEMENT, all measured off web/assets/ref/cardduel/folder-choose.png
 *  (authority 1) because no table gives them: the rows sit at x 23 and y 80,
 *  125, 170, a 45px pitch, and each colour's cube is 30px left of its number's
 *  right edge at y +15. Every one of the six cube colours in the capture is the
 *  clip that base predicts — white 29, blue 32, green 35, red 38, black 41 and
 *  brown 44, the same three-apart run 0x800A5A98 names for the five the HUD
 *  shows. Brown is the sixth because a folder holds brown cards even though
 *  brown has no S-ENERGY slot. */
/** The cursor marker's own shrink, five ticks. `marker_scale_out`
 *  (F0x80096160, card view slot +0x6C) writes mode 2, five frames, full size —
 *  §24.1. It is the marker's widget and not the chooser's, so it is a constant
 *  here rather than a row of the chooser's table. */
const CHOOSER_MARKER_FRAMES = 5;

const CHOOSER = {
  rowX: 23,
  rowY: [80, 125, 170],
  rowClip: { off: 70, on: 71 },
  /** The selected row is AMBER against the others' blue, and that is a CLUT
   *  row rather than a second clip — clip 71 differs from 70 only by the 4px
   *  arrow tab. The row is COMPUTED, not tabled (F0x80095e58 file
   *  0x130e0-0x1327c, claim cardgame-folder-row-clut-cycle-2026-09-13): while
   *  the cursor marker loops its +0x63 is clear and the row is
   *  (counter >> 2) mod 16 — a linear 16-row wraparound at four counter units
   *  per row; confirm sets +0x63 and the row becomes the one-shot
   *  min(counter >> 1, 7). counter is the marker object's own +0x50,
   *  incremented by the frame delta each tick, so it starts when the cursor
   *  appears (CHOOSER.cursorTick), not at screen open. The carddata2 CLUT
   *  really has 16 rows (k 8..15 mirror 7..0), all extracted. */
  rowCycleRows: 16,
  titleAt: [5, 3],
  numberY: 20,
  cubeDX: -30,
  cubeDY: 15,
  /** clip base per colour, the run 0x800A5A98 continues into brown */
  cubeBase: [29, 32, 35, 38, 41, 44],
  colours: ["white", "blue", "green", "red", "black", "brown"],
  /** The chooser's two clocks, both READ from `FOLDER_CHOOSER_STATES` — the
   *  22-row table of the original's own machine `F0x8009F110`, mode 2 of the
   *  card-battle screen. Nothing here is a hand number: `OPEN` and `CLOSE` are
   *  the machine's tick for each state, walked from the waits, so a state that
   *  blocks N ticks is left on the tick its counter REACHES N and the next arm
   *  runs N ticks later.
   *
   *  THE OLD NUMBERS WERE WRONG IN TWO PLACES, both because they read the waits
   *  as gaps instead of as the loop bound. The three plates were 11 ticks apart
   *  and are 12 (states 1/3/5 run on ticks 0, 12, 24); and the take-down began
   *  on the confirm frame with the rows closing 4 ticks apart, when the original
   *  holds for FIFTEEN ticks with nothing moving, then shrinks the cursor marker
   *  away, and only then takes the three plates down 5 ticks apart — 45 ticks
   *  from the confirm to the duel, not 12.
   *
   *  Read end to end 2026-10-05; ledger
   *  `cardgame-folder-chooser-every-state-anchored-2026-10-05`. */
  /** Tick each plate appears on: states 1, 3 and 5. */
  arriveTicks: [FOLDER_CHOOSER_OPEN_TICKS[1], FOLDER_CHOOSER_OPEN_TICKS[3], FOLDER_CHOOSER_OPEN_TICKS[5]],
  /** The cursor marker is created on state 7. */
  cursorTick: FOLDER_CHOOSER_OPEN_TICKS[7],
  /** The picker takes a button from state 9. */
  readyTick: FOLDER_CHOOSER_OPEN_TICKS[9],
  /** The title band goes up on state 1 and comes down on state 19 over six
   *  units. Its words are escardgm 0x41, which the open call hands in the
   *  THIRD argument and the y it wants (0x26 = 38) in the sixth; the open writes
   *  both counters to 12 (F0x8009BEAC, board-view slot +0xEAC) and the close
   *  writes mode 3 and both to 6 (F0x8009BF5C, slot +0xEB0). Both routines ring
   *  a sound themselves — 0x40019 opening, 0x4001A closing — which is why state
   *  19's row carries a sound although the chooser asks for nothing there. */
  bandText: "Choose a folder",
  bandString: 0x41,
  bandOutTick: FOLDER_CHOOSER_CLOSE_TICKS[0x13],
  bandOutFrames: 6,
  /** The row's own width animation (F0x80096418, +0x5C). ENTRY is a grow from 0
   *  to 0x1000 over 12 ticks (`0x1000 - (counter<<12)/0xC`); CLOSE is the shrink
   *  F0x80096808 requests, 0x1000 to 0 over 6 ticks (`(counter<<12)/6`, with
   *  +0x6A=6, +0x68=6, +0x66=2). 0x1000 is 1.0 in the card screen's 12-bit
   *  fixed point, and +0x5E (height) stays 0x1000 throughout. The previous
   *  reading called the 6-frame helper the entry; it is the tear-down
   *  (claim cardgame-folder-chooser-machine-2026-09-13; gap row A6,
   *  2026-09-14m). */
  arriveFrames: 12,
  closeFrames: 6,
  /** TAKE-DOWN, counted from the tick the confirm was accepted on.
   *
   *  State 10 holds for fifteen ticks with nothing at all moving — the screen
   *  used to start shrinking a row on the confirm frame itself. Then the cursor
   *  marker shrinks away (state 11, five ticks), and only then do the three
   *  plates go, IN FOLDER ORDER rather than in the order the player chose, one
   *  every five ticks (states 13/15/17), each with the 0x4001A dismiss sound.
   *  Then the title band comes down (state 19), and the deck is built (state
   *  21). */
  closeHold: FOLDER_CHOOSER_STATES[0x0a].wait,
  /** The marker shrinks away on state 11 and is gone five ticks later. */
  markerGoneTick: FOLDER_CHOOSER_CLOSE_TICKS[0x0b] + CHOOSER_MARKER_FRAMES,
  /** The first plate leaves on state 13 and the next on state 15. */
  closeStep: FOLDER_CHOOSER_CLOSE_TICKS[0x0f] - FOLDER_CHOOSER_CLOSE_TICKS[0x0d],
  /** The first plate leaves on state 13. */
  closeStart: FOLDER_CHOOSER_CLOSE_TICKS[0x0d],
  /** The duel is built — and the screen moves on — on state 21. */
  loadTick: FOLDER_CHOOSER_CLOSE_TICKS[0x15],
  /** The marker's own shrink is five ticks (`marker_scale_out`, §24.1). */
  markerOutFrames: CHOOSER_MARKER_FRAMES,
};

/** Screen origin for each per-player HUD record. This used to be an inference
 *  off the rig captures; it is now read out of the code. F0x80099440 is the
 *  strip's slide animator and runs on the same two structs immediately before
 *  F0x80098898 draws them. Its slide-in case comes to rest with x = 0 for both
 *  players and y = 0x8D (141) for the near player, 0 for the far one; the
 *  slide-out case parks them at 241 and -100. F0x80098898 then corrects for
 *  display height when the 50Hz flag at 0x8005CCB0 is set, +12 near and -12 far.
 *
 *  The rig captures are 50Hz, so the walker takes that pair, and the two halves
 *  now agree: the near cube row lands at 153 + 69 = 222 and the far one at
 *  -12 + 14 = 2, which is where web/assets/ref/cardduel/board-dealt.png puts
 *  them. The old near value of 152 was one pixel out because it was anchored on
 *  the wrong widget — what the capture shows at the top of the far strip is the
 *  chrome, which starts at the record origin, not the energy plate row.
 *  Source: UI.strip_origin in assets/data/cardduel_ui.json. */
const PLAYER_ORIGIN = [[0, 153], [0, -12]];

/** The 50Hz display correction F0x80098898 applies to (unkC, unkE) in its
 *  prologue: +12 for the near strip, -12 for the far one. The decoded RESTING
 *  panel y is 141 near and 0 far, so 141+12 = 153 and 0-12 = -12, which is
 *  exactly PLAYER_ORIGIN above. Binding the live panel model through this offset
 *  is therefore a NO-OP while the panels sit at rest, and only differs once
 *  something actually issues a slide. */
const PAL_HUD_OFFSET = [12, -12];

/** Where the HUD strip is drawn this frame: the decoded panel y from
 *  engine/systems/card-view.ts, plus the 50Hz correction. `view` is passed in
 *  rather than read off the controller because this lives at module scope, next
 *  to the constant it replaces, and the controller is a closure. Falls back to
 *  the resting constant when the view model has not been created yet. */
function hudOriginY(view, side) {
  const p = view?.panels?.[side];
  return p ? p.y + PAL_HUD_OFFSET[side] : PLAYER_ORIGIN[side][1];
}

/** Second origin for the three *alt* widgets of each HUD record — the trash
 *  plate on the right edge. They are added to the screen object's (unk20,
 *  unk22) instead of the (unkC, unkE) the rest of the record uses, and unlike
 *  (unkC, unkE) that pair is not touched by the 50Hz correction in
 *  F0x80098898's prologue. Both halves check out against the 50Hz reference
 *  capture web/assets/ref/cardduel/board-dealt.png, which puts the two plates
 *  at (281, 121) and (281, 74) — alt_ntsc plus the record's own alt_card
 *  offsets, with no PAL term either way.
 *  Source: UI.strip_origin.alt_ntsc in assets/data/cardduel_ui.json. */
const ALT_ORIGIN = [[288, 143], [288, 80]];

/** The trash-can drawn in the plate's larger recess, at the alt origin itself.
 *  Card clips 49, 50 and 51 are one three-frame run — full, half, small — the
 *  same shape as every other cycled icon on this screen, and clip 49 is the
 *  resting frame: it matches the reference capture with zero error over all
 *  150 of its opaque pixels at BOTH alt origins. */
const ALT_ICON_BASE = 49;

/** One full-width chrome band. */
function drawBand(ctx, y, h) {
  ctx.fillStyle = CHROME.fill;
  ctx.fillRect(0, y, 320, h);
  for (let i = 0; i < CHROME.edge.length; i++) {
    ctx.fillStyle = CHROME.edge[i];
    ctx.fillRect(0, y + i, 320, 1);
    ctx.fillRect(0, y + h - 1 - i, 320, 1);
  }
}

/** Horizontal wipe used by the prompt and the phase banner. Same walker-choice
 *  axis as drawPlayBox — the helper's argument order is not decoded. */
function withWipe(ctx, progress, draw) {
  const open = Math.max(0, Math.min(1, (progress ?? WIDGET_SCALE_FULL) / WIDGET_SCALE_FULL));
  if (open <= 0) return;
  if (open < 1) {
    ctx.save();
    ctx.translate(160, 0);
    ctx.scale(open, 1);
    ctx.translate(-160, 0);
    draw();
    ctx.restore();
    return;
  }
  draw();
}

/** A banner band with its title centred, the way every captured banner reads. */
function drawBanner(ctx, band, title, color = null, progress = WIDGET_SCALE_FULL) {
  withWipe(ctx, progress, () => {
    drawBand(ctx, band.y, band.h);
    if (title) {
      drawText(ctx, title, Math.round((320 - textWidth(title)) / 2), band.y + 5, { color });
    }
  });
}

/** The two-option box, MEASURED off the disc on 2026-08-24 — rig run 5, frame
 *  1001+22, `C:/dw3-rig/shots/duel_f01001+22_m5_lc2_s2_w2_c0_p0.raw`. Authority
 *  1, controlled runtime comparison.
 *
 *  It is the SAME full-width window every other prompt uses — 320 wide, the
 *  same three-row border over the same fill — sitting at y 138..185 rather than
 *  the announcement's y 96..143, so it clears the played row instead of burying
 *  it. Three lines at the prompt window's own x 28 on its own 14px pitch, first
 *  glyph top at band + 5, and the chosen answer carries a marker out at x 14.
 *
 *  The walker guessed a compact centred box here for one afternoon. It was
 *  wrong about the shape, the position and the number of lines. */
const PLAY_BOX = { y: 138, h: 48, textX: 28, textY: 143, lineH: 14, markX: 14 };

/** The "Put in Field?" summon confirm. Captured 2026-09-12: Square on a marked
 *  set raises it at the TOP of the board, above the hand row — the high box the
 *  message-box table (`EFFECT_TEXT_BOX`, box 2) puts at y 50. Same window shape
 *  and 14px line pitch as PLAY_BOX. */
const CONFIRM_BOX = { y: 50, h: 48, textX: 28, textY: 55, lineH: 14, markX: 14 };

/** THE MESSAGE BOX TABLE — `0x800A59B0`, read 2026-08-25.
 *
 *  Four 8-byte entries of two s32, `unk0` = x and `unk4` = y, indexed by the
 *  box selector `duel+0xDE4`. F0x80097ACC lays a box's contents out at
 *  `(x + 0x1B, y + 0x12)` for the main line and `(x + 0x20)` for the second.
 *
 *      box 0  (0, 138)   box 1  (0, 96)   box 2  (0, 50)   box 3  (0, 96)
 *
 *  Boxes 0 and 1 are the two the walker already draws — PLAY_BOX at y 138 and
 *  PROMPT_BAND at y 96 — which the table confirms outright. **Box 2 at y 50 is
 *  the one that was missing**: the high box that carries a played card's own
 *  effect text, as the reference sheets show over "White Power". */
const EFFECT_TEXT_BOX = { x: 0, y: 50, h: 34, textX: 27, textY: 68, lineH: 14 };

/** The duel's own string bank, `escardgm.toml`, by index. Every line here is
 *  verbatim; `tests/cardduel-ui.test.js` checks them against the real file.
 *
 *  Recovered in full 2026-08-25. Thirty of these were in the bank and rendered
 *  nowhere — the phase-open bands, the whole refusal family, the pile titles,
 *  the level names and the booster line. They are wired at their sites below. */
const ES = Object.freeze({
  putInField: "Put in Field?",                      // 15
  currentScore: "Current score",                    // 19
  noCardsField: "No Cards in the Field.",           // 23
  yourHand: "Your Hand",                            // 25
  yourDeck: "Your Deck",                            // 26
  yourTrash: "Your Trash",                          // 27
  oppHand: "Opponent Hand",                         // 28
  oppDeck: "Opponent Deck",                         // 29
  oppTrash: "Opponent Trash",                       // 30
  nextSet: "Next set.",                             // 20
  noCards: "No cards.",                             // 35, 42
  levels: ["In-Training", "Rookie", "Champion", "Ultimate", "Mega"], // 37..41
  noDigimonField: "No Digimon in the Field.",       // 46
  noDigimonAffected: "No Digimon affected",         // 47
  digimonNotHere: "That Digimon not here.",         // 48
  noGreen: "No Green Digimon.",                     // 49
  noBrown: "No Brown Digimon.",                     // 50
  noCardsHand: "No Cards in Hand.",                 // 51
  noCardsTrash: "No Cards in trash.",               // 52
  noCardsDeck: "No Cards in Deck.",                 // 53
  noDigimonDeck: "No Digimon Cards in Deck.",       // 54
  noProgramDeck: "No Program Cards in Deck.",       // 55
  noBrownHand: "No Brown Digimon in Hand.",         // 56
  noEffect: "The card has no effect",               // 58
  pickToTrash: "Pick a Card to Trash.",             // 57
  tooManyDigimon: "There are too many Digimon cards in\nfield. Select which to throw away.", // 59
  beginLoad: "Begin Load Phase",                    // 60
  beginCompile: "Begin Compile Phase",              // 61
  pass: "Pass",                                     // 63
  gotBooster: "Got a Booster Pack",                 // 66
  areYouSure: "Are you sure?",                      // 44
  yesNo: ["Yes", "No"],                             // 24
});

/** The disc's own "no effect" line for a Program card, by the byte the card's
 *  effect record carries at +0x02 (the extractor's `effectAsset`).
 *
 *  F0x800a2180, the Program-card play machine, reads that byte at its case 6
 *  and hands it straight to the board view's prompt opener `openPrompt`
 *  (`view+0xEE4`, F0x8009C054) as the prompt's message id (stored at
 *  view+0xDE8). So the line a card shows when its effect has nothing to act on
 *  is authored in the record, not derived from the targeting. Every id below is
 *  an escardgm index read from the shipped bank: 47 "No Digimon affected",
 *  51 "No Cards in Hand.", 53 "No Cards in Deck.", 54 "No Digimon Cards in
 *  Deck.", 55 "No Program Cards in Deck.", 56 "No Brown Digimon in Hand.",
 *  58 "The card has no effect". */
const EFFECT_NO_EFFECT_LINE = Object.freeze({
  47: ES.noDigimonAffected,
  51: ES.noCardsHand,
  53: ES.noCardsDeck,
  54: ES.noDigimonDeck,
  55: ES.noProgramDeck,
  56: ES.noBrownHand,
  58: ES.noEffect,
});

/** Why a Program card can take no effect, in the disc's own words — the line
 *  the effect record itself carries at +0x02. A record whose byte is 0 authors
 *  no line (escardgm[0] is the empty string), so this returns null and the
 *  browser draws nothing rather than inventing one.
 *
 *  Replaced a WALKER MAPPING 2026-10-07: the walker used to derive the line
 *  from `.targeting` alone. That showed "No Digimon in the Field." for field
 *  cards where the disc's own record says "No Digimon affected", and invented
 *  "No Green Digimon." / "No Brown Digimon." as Program refusals that no
 *  record's +0x02 ever selects. The field is the disc's now. */
export function refusalFor(eff) {
  return EFFECT_NO_EFFECT_LINE[eff?.effectAsset] ?? null;
}


/** The two-option box: a question with its two answers STACKED under it, the
 *  chosen one marked. See PLAY_BOX for where every number came from.
 *
 *  `progress` is the decoded prompt-window wipe, 0..0x1000, from
 *  engine/systems/card-view.ts: the original opens this box over 12 frames,
 *  closes it over 6 and pumps it for 10 on confirm (F0x8009C054 / C0DC / C124,
 *  driven by F0x80097ACC). The walker used to pop it up instantly.
 *
 *  WALKER CHOICE — which AXIS the wipe runs on. The original hands the animated
 *  0x1000 to a resident primitive helper as the first of three arguments, the
 *  other two being 0x1000 (`sp9C(value, 0x1000, 0x1000)`), which reads as a
 *  horizontal scale — but the helper's argument order was never decoded, so this
 *  is the strongest available reading and NOT established. A horizontal wipe
 *  about the band's centre is what is drawn here; if the helper is ever decoded
 *  and the axis is vertical, only this function changes. */
function drawPlayBox(ctx, question, answers, cursor, progress = WIDGET_SCALE_FULL, box = PLAY_BOX) {
  const open = Math.max(0, Math.min(1, progress / WIDGET_SCALE_FULL));
  if (open <= 0) return;
  const wiping = open < 1;
  if (wiping) {
    ctx.save();
    ctx.translate(160, 0);
    ctx.scale(open, 1);
    ctx.translate(-160, 0);
  }
  drawBand(ctx, box.y, box.h);
  drawText(ctx, question, box.textX, box.textY);
  answers.forEach((a, i) => {
    const y = box.textY + (i + 1) * box.lineH;
    drawText(ctx, a, box.textX, y);
    if (i !== cursor) return;
    // The marker on the chosen line. The capture puts a 3px-wide mark at x 14
    // spanning the glyph's height; its exact art is not decoded, so it is drawn
    // as a small solid triangle.
    ctx.fillStyle = "rgb(232,232,232)";
    for (let r = 0; r < 5; r++) {
      ctx.fillRect(box.markX, y + 1 + r, 3 - Math.abs(r - 2), 1);
    }
  });
  if (wiping) ctx.restore();
}

/** `stage` back to the disc's CARDPAK +0x06 level, which is what indexes
 *  ES.levels. The converted catalog stores the name, the disc stores 1..5, and
 *  the order here is the bank's own (escardgm 37..41). Only four of the five
 *  appear in the shipped catalog — nothing is In-Training — so the first entry
 *  is carried for the bank's sake rather than because a card uses it. */
const LEVEL_INDEX = {
  "in-training": 1, rookie: 2, champion: 3, ultimate: 4, mega: 5,
};

/** The CARD BROWSER, measured off the disc on 2026-08-24 — rig run 4, frames
 *  1104 and 1144 (`C:/dw3-rig/shots/duel_f01104_m5_lc4_s3_w2_c0_p1.raw` and
 *  `duel_f01144_m5_lc4_s3_w2_c2_p2.raw`). Authority 1, controlled runtime
 *  comparison. This is what state 4 of F0x8009FDD8 actually puts on screen, and
 *  it is not the board with a caption on it — the walker drew your hand along
 *  the bottom of the board with a full-width prompt window over the middle.
 *
 *  Every number below is measured, not chosen:
 *    * the title plate spans x 0..139 at y 66..85, the standard 20-tall band
 *      with the standard three-row border, its text at x 25 and glyph top y 71
 *      (band + 5, the same offset every banner uses);
 *    * the effect panel is x 136..319 at y 49..84, three-row border again, two
 *      text lines at x 139 with tops at y 54 and 68 — a 14px pitch, the prompt
 *      window's own;
 *    * the cards are the known 40x46, the first at x 24 and the rest on a 41px
 *      pitch — the SAME 41 the engine's fan-out already uses — all at y 92.
 *      Both frames agree on 24/65/106/147/188/229;
 *    * two bands sit under the row, x 132..319, at y 144 and y 165, each 20
 *      tall. They use a TWO-row border, not the three-row one: (0,0,136) then
 *      (40,40,96), with the middle (8,8,88) row absent. The lower one carries
 *      the card's name at x 135, glyph top y 170.
 *
 *  NOT ESTABLISHED: what the upper band holds. It is empty in both captured
 *  frames, and both had a Program card selected — so it may be the AP/HP strip
 *  a Digimon card would fill. No frame with a Digimon selected was captured, so
 *  the walker draws it empty rather than inventing contents. */
const BROWSER = {
  /** The title plate is NOT a rectangle: its bottom edge steps up two rows part
   *  way along. Measured on the disc frame — the three-row bottom border sits at
   *  y 83..85 for x up to 112 and at y 81..83 from x 115 out to 135 — so it is
   *  drawn as two overlapping windows, the wider one two rows shorter. */
  title:  { x: 0, y: 66, w: 131, h: 18, tabW: 112, tabH: 20, textX: 25, textY: 71 },
  text:   { x: 136, y: 49, w: 184, h: 36, textX: 139, textY: 54, lineH: 14 },
  row:    { x: 24, y: 92, pitch: 41 },
  detail: { x: 132, y: 144, w: 188, h: 20 },
  name:   { x: 132, y: 165, w: 188, h: 20, textX: 135, textY: 170 },
  /** The SUMMON PHASE opens the same browser with three differences, all
   *  measured off duel/play_f01843_m6_lc15_s3_w3_c0_v0.raw on 2026-08-24:
   *  the card row sits five pixels lower, on the board's own centre row; the
   *  top HUD strip is not drawn at all; and the phase's on-screen legend —
   *  escardgm 0x24, "[cross] Select [square] Summon" — is drawn at x 23, y 25,
   *  which is where the top strip would otherwise be. web/uifont.js already
   *  maps the two glyph characters onto those tokens. */
  summonRowY: 97,
  /** The legend has its own plate — x 0..136 at y 20..39, the standard 20-tall
   *  band — with the text at x 23 and glyph top y 25, which is band + 5 like
   *  every other one. It stands exactly where the far HUD strip would be. */
  legend:  { x: 0, y: 20, w: 137, h: 20, textX: 23, textY: 25,
             text: "✕ Select □ Summon" },
};

/** One window at an arbitrary rect. `edges` is the border colours from the
 *  outside in, mirrored on the far side — three rows for the ordinary window,
 *  two for the browser's detail bands, which drop the middle row. */
function drawWindow(ctx, x, y, w, h, edges) {
  ctx.fillStyle = CHROME.fill;
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < edges.length; i++) {
    ctx.fillStyle = edges[i];
    ctx.fillRect(x, y + i, w, 1);
    ctx.fillRect(x, y + h - 1 - i, w, 1);
  }
}
/** The browser's detail bands drop the middle border row. */
const BAND2 = [CHROME.edge[0], CHROME.edge[2]];

/** The prompt window with up to three left-aligned lines. */
function drawPrompt(ctx, lines, progress = WIDGET_SCALE_FULL) {
  withWipe(ctx, progress, () => {
    drawBand(ctx, PROMPT_BAND.y, PROMPT_BAND.h);
    lines.forEach((line, i) => {
      if (line) drawText(ctx, line, PROMPT_BAND.textX, PROMPT_BAND.textY + i * PROMPT_BAND.lineH);
    });
  });
}

let UI = null;
let uiPromise = null;
function loadDuelUI() {
  if (uiPromise) return uiPromise;
  uiPromise = fetch("assets/data/cardduel_ui.json")
    .then((r) => r.json())
    .then((j) => { UI = j; return j; })
    .catch(() => null);
  return uiPromise;
}

/** The decoded Program-card table (tools/extract_card_effects.py, the
 *  0x2c-stride records at 0x800a4df4 read by F0x80083e34). The rules engine
 *  needs it to know what each Program card may target. */
let EFFECTS = new Map();
let effectsPromise = null;
function loadEffects() {
  if (effectsPromise) return effectsPromise;
  effectsPromise = fetch("assets/data/card_effects.json")
    .then((r) => r.json())
    .then((j) => { EFFECTS = indexEffects(j); return EFFECTS; })
    .catch(() => EFFECTS);
  return effectsPromise;
}

// The duel's decoded sound ids. All thirteen call-site argument words resolve
// against the sound-test catalog; the four shared bleeps are SYSTEM03/04/06/07
// and the earlier reading that named SYSTEM01/SYSTEM02 is retracted — the card
// game never plays those two.
// — cardgame-all-thirteen-duel-sound-ids-resolved-and-system01-02-retracted,
//   cardgame-duel-sound-ids-resolved-against-the-sound-test
const DUEL_SOUND = {
  /** CBTLMAIN 0x609C0004, bank cbtl00 archive 39 — the duel's looping BGM. */
  bgm: "cbtl00",
  /** W_JINGLE 0x6004001E, played on the duel-won path. */
  win: "w_jingle",
  /** CARD_000 0x8004603C — the summon intro. */
  summon: "card_000",
  /** CARD_001 0x800460BD — a card landing. */
  land: "card_001",
  /** CARD_002 0x8004613E — a card flipping face up. */
  flip: "card_002",
  /** RECOVERY 0x00040014 — the hold command. */
  hold: "recovery",
  /** SYSTEM06 0x0004001B — the field cursor move (F0x80086F24). */
  cursor: "system06",
  /** SYSTEM07 0x0004001C — selection confirmed (F0x8008CFDC / F0x8008D594). */
  confirm: "system07",
  /** SYSTEM03 0x00040019 — the twenty-tick pass. The turn rules claim reads
   *  the packed argument at the pass branch as 0x00040019, which is SYSTEM03,
   *  the shared window-open sound: the pass has no sound of its own, that is
   *  its window opening.
   *  — cardduel-load-compile-turn-rules-2026-08-21 */
  pass: "system03",
  /** SYSTEM04 0x0004001A — cancel / dismiss. Settled 2026-08-08 off three
   *  symmetric call-site pairs in pro/cardgame.s: SYSTEM03 (0x00040019) is
   *  played at 0x8009c538/0x8009c59c/0x8009c600, each immediately opening a
   *  widget via `jal 0x80096828` with index 0/1/2 and the coordinate pair at
   *  0x800a5d48+0/+4/+8, storing the new object into s6+0x0C/+0x10/+0x14;
   *  SYSTEM04 is played at 0x8009c910/0x8009c974/0x8009c9d8, each of which then
   *  loads that same stored pointer and calls its +0x70 teardown. Open pairs
   *  with SYSTEM03, dismiss with SYSTEM04, so SYSTEM04 is cancel.
   *  — cardgame-system04-is-the-duel-cancel-sound */
  cancel: "system04",
};

/** The duel's own bank, whose samples are not in the common manifest. */
const DUEL_BANK = "cbtl00";
/** CARDSGNL 0x009C0002 — the set-counter roll. */
const CARDSGNL = "cardsgnl";
/** CARDTHND 0x009C0003 — both shake commands. Now actually extracted: the
 *  Sound Test's own category-38 array (docs/research/audio/soundtst-categories.json,
 *  `count: 5`) lists CARDTHND and CARDFIRE alongside the other three cbtl00 rows,
 *  and build_sfx.py's area_records() builds every bank by that structural walk.
 *  The earlier "the menu exposes only slots 0, 2 and 4" note came from the
 *  hand-kept soundtst-all-categories.json, which had drifted; it is retired
 *  2026-10-03. */
const CARDTHND = "cardthnd";

export function createCardDuel(sfx = null, bgm = null) {
  const c = {
    _open: false,
    duel: null,
    handCursor: 0,
    /** Summon Phase: the hand slots marked with Cross, or null when not summoning */
    summonMarks: null,
    /** { answer: 0|1 } while the "Put in Field?" confirm is up, else null */
    summonConfirm: null,
    ticks: 0,
    onClose: null,
  };
  /** the track that was playing before the duel took the BGM player over */
  let previousTrack = null;
  /** so the win jingle and the pack reward fire once per duel, not per keypress */
  let rewarded = false;
  const card = loadPack("carddata2");
  const board = loadPack("carddata3");

  c.isOpen = () => c._open;
  /** debug-only: the current phase key, for headless animation capture */
  c.phaseKey = () => (c.duel ? phase(c.duel).key : null);
  /** debug-only: re-derive the sprite set after a test has posed the model */
  c.resyncSprites = () => syncSprites();

  /** the CARD_NPC record this duel is against, or null when there is none */
  let record = null;

  /** `opponentId` selects a CARD_NPC.BIN record (170 of them, 0xD0 stride):
   *  the opponent then duels its own authored 40-entry deck, carrying each
   *  entry's AI play class into the hand sort, and a win earns a pack of its
   *  set. An explicit `opponentDeck` overrides it; with neither, the opponent
   *  falls back to mirroring the player's folder, which is a WALKER RULE. */
  c.open = (onClose = null, opponentName = "Opponent", opponentDeck_ = null, opponentId = null) => {
    c.onClose = onClose;
    // The view's widget model. createCardView() calls resetPanels(), which parks
    // both HUD panels OFF screen — that is what the disc does, and the slide-in
    // is a beat the duel issues. Until Phase 2 wires the opcodes that issue it,
    // park them at the decoded SHOWN endpoints instead, so the strips render
    // exactly where they render today and this binding changes nothing visible.
    c.view = createCardView();
    for (const side of [0, 1]) Object.assign(c.view.panels[side], PANEL_SHOWN[side]);
    loadCardIcons();
    loadDuelUI();
    loadEffects();
    Promise.all([loadCatalog(), loadOpponents()]).then(() => {
      const cat = catalog();
      if (!cat || !cards().folders?.length) { c.onClose?.(); return; }
      // The duel opens on the CHALLENGE screen — rig frame 510, a hundred
      // frames before the folder chooser — and the chooser follows it. Picking
      // a row is what starts the duel; the rest of open() is deferred into
      // begin(). The opponent record is resolved here rather than in begin()
      // because the challenge screen is what reads its level and folder name.
      pendingOpen = { opponentName, opponentDeck_, opponentId };
      record = opponentId == null ? null : opponentById(opponentId);
      c.challenge = true;
      c.chooser = null;
      c.inspect = null;
      c._open = true;
      c.ticks = 0;
      c.duel = null;
      c.sprites.clear();
      if (bgm) {
        previousTrack = bgm.current ?? null;
        bgm.play(DUEL_SOUND.bgm);
      }
      loadDuelUI();
    });
  };

  /** What open() parked while the challenge screen and folder chooser are up. */
  let pendingOpen = null;
  /** null when the chooser is not up, else { cursor }. */
  c.chooser = null;
  /** true while the challenge screen is up, before the chooser. */
  c.challenge = false;

  /** How many cards of each colour a folder holds — what the chooser's six
   *  numbers count. */
  function folderColours(folder) {
    const n = CHOOSER.colours.map(() => 0);
    for (const id of folder.cards ?? []) {
      const i = CHOOSER.colours.indexOf(cardById(id)?.colour);
      if (i >= 0) n[i] += 1;
    }
    return n;
  }

  // A7 — the full-screen colour wash. F0x800A3488 ticks it and F0x800A32D8
  // draws it as a SUBTRACTIVE quad: the live colour is subtracted from the
  // scene (the draw packet's semi-transparency field is set from the widget's
  // constructor mode, 2), so white blacks the screen out and black leaves it
  // alone. The duel enters from white and starts toward black over 100 ticks
  // (F0x800A2F00 state 0: set_colour 0xFF,0xFF,0xFF then start 0,0,0,0x64,0),
  // and leaves from black toward white over 100 (state 1) — the doc's "washes
  // white, then to black, and back". is_idle is state 0, close is state 2.
  /** 1 = the screen is fully blacked out, 0 = no wash. */
  function washValue() {
    return c.wash ? c.wash.value : 0;
  }
  function startWash(from, to, total) {
    c.wash = { from, to, total, t: total, value: from };
  }
  function stepWash() {
    const w = c.wash;
    if (!w) return;
    if (w.t > 0) {
      w.t -= 1;
      w.value = w.from + (w.to - w.from) * (1 - w.t / w.total);
    }
    if (w.t <= 0 && w.value <= 0) c.wash = null;
  }

  /** The duel's exit. In its close state (F0x800A2F00 state 1) the original
   *  sets the wash colour black and starts it toward white over countdown 100
   *  (cardgame.s:33043; hold 0), so the screen fades out. Claim
   *  `cardduel-start-end-wash-is-100-units-2026-09-13`. The screen is torn down
   *  only once the wash has run, so the fade is what the player sees rather
   *  than being cut off by `close()`. */
  let closing = false;
  function startCloseWash() {
    if (closing || c.wash) return;
    closing = true;
    startWash(0, 1, 100);
  }

  // I3 — the side plate. F0x80099F60 (the last call of the board's frame) draws
  // a plate for whichever side's turn is open: F0x80099BE4 runs the 12/6
  // grow/shrink tween on view+0xA8 (side 0) / view+0xFC (side 1) and
  // F0x800999A0 draws card clip 0x44 (player 0) / 0x43 (player 1) scaled by it.
  // The duel grows the marker when a side's turn opens (F0x8009C4A4) and shrinks
  // it when the turn ends (F0x8009C4D8). The two phases that own a turn are the
  // program negotiation and the summon pass.
  let markerSide = null;
  function driveTurnMarker() {
    if (!c.view) return;
    const d = c.duel;
    let active = null;
    if (d && !d.outcome) {
      const s = d.summonTurns && !d.summonTurns.done
        ? summonTurnSide(d)
        : (d.programTurns ? programTurnSide(d) : null);
      // The turn functions return the side OBJECT; panels[0] is the player.
      if (s) active = s === d.player ? 0 : 1;
    }
    if (active === markerSide) return;
    if (markerSide !== null) shrinkTurnMarker(c.view, markerSide);
    if (active !== null) growTurnMarker(c.view, active);
    markerSide = active;
  }

  /** The picked row starts the duel — state 21, the last step of the folder
   *  chooser's own machine.
   *
   *  An EMPTY folder is not an error here and never was. State 21 tests the
   *  folder's first saved card and, on zero, copies a built-in forty-card list
   *  out of the overlay instead (`0x800A5C74`, FOLDER_FALLBACK_DECK), so a
   *  player who confirms an empty folder duels on that deck rather than on
   *  nothing. The screen used to hand `createDuel` the empty list itself. */
  function beginDuel(folderIndex) {
    const { opponentName, opponentDeck_ } = pendingOpen;
    const cat = catalog();
    cards().activeFolder = folderIndex;
    const folder = cards().folders[folderIndex];
    const deck = folder.cards?.length ? [...folder.cards] : [...FOLDER_FALLBACK_DECK];
    c.chooser = null;
    pendingOpen = null;
    {
      // `record` was already resolved by open(), for the challenge screen.
      const authored = record ? opponentDeck(record) : null;
      const oppCards = opponentDeck_ ?? authored?.cards ?? deck;
      c.duel = createDuel(cat, deck, oppCards, "You", opponentName,
                          authored && !opponentDeck_
                            ? { opponent: authored.aiClass, opponentGroup: authored.setGroup }
                            : {});
      // This screen is driving side 0. The ceremony beats that would call the
      // player agent — the play negotiation 0x99 and the summon open 0x9A —
      // stop and wait for a button instead. See DuelState.human.
      c.duel.human = 0;
      c.handCursor = 0;
      c.summonMarks = null;
      c.summonConfirm = null;
      c.ticks = 0;
      // A7 — the duel opens on a white wash that fades to black over 100
      // ticks, so the board comes up out of black (F0x800A2F00 state 0).
      closing = false;
      startWash(1, 0, 100);
      markerSide = null;
      c.sprites.clear();
      retiring.clear();
      scheduled.length = 0;
      c.setEnd = null;
      c.namePlate = null;
      rewarded = false;
      announceT = 0;
      // Nothing is announced until the duel's own Start banner (0xA0) is issued
      // on the first frame. The screen no longer raises announcements itself.
      announced = false;
      lastBeat = null;
      coinPicked = false;
      combosShown = false;
      c._open = true;
      loadDuelUI().then(syncSprites);
    }
  }

  /** debug-only: the chooser's row, for headless capture */
  c.chooserCursor = () => (c.chooser ? c.chooser.cursor : null);
  /** debug-only: which opening screen is up, for headless capture */
  c.openingScreen = () => (c.challenge ? "challenge" : c.chooser ? "chooser" : null);
  /** debug-only: the pile fan's reveal scale for card i, for headless capture */
  c.pileFanScale = (i) => pileFanScale(i);
  /** debug-only: the folder chooser's arrival state, for headless capture */
  c.chooserArrival = () => {
    if (!c.chooser) return null;
    const age = c.ticks - (c.chooser.t0 ?? 0);
    const closing = c.chooser.closing ?? null;
    const closeAge = closing ? c.ticks - closing.t0 : -1;
    const present = (i) => {
      const s = chooserRowScale(i);
      return s != null && s > 0;
    };
    return {
      age,
      rowsShown: CHOOSER.arriveTicks.filter((_, i) => present(i)).length,
      rowScales: CHOOSER.arriveTicks.map((_, i) => chooserRowScale(i)),
      cursorUp: chooserMarkerUp(age, closeAge),
      ready: age >= CHOOSER.readyTick,
      closing: !!closing,
      closeAge,
      /** The title band's own width, from state 19's six-unit close. */
      bandScale: chooserBandScale(closeAge),
      /** the three arrival sounds (states 1/3/5) and the three take-down sounds
       *  (states 13/15/17), so a headless check can read what the player heard */
      heard: [...(c.chooser.heard ?? [])],
      cursor: c.chooser.cursor,
      // The selected plate's live CLUT row (F0x80095e58) so a headless check
      // can read the decoded cycle instead of scoring pixels. It is null once
      // the marker has shrunk away (state 11) — there is no cursor left to
      // recolour.
      selectedRow: chooserMarkerUp(age, closeAge)
        ? chooserRow(age - CHOOSER.cursorTick, !!closing)
        : null,
    };
  };
  /** debug-only: the set-end beat's step and its tick, for headless capture */
  c.setEndState = () => (c.setEnd ? { step: c.setEnd.step, t: c.setEnd.t } : null);
  /** debug-only: the full-screen wash's live value and countdown, for headless
   *  capture. `closing` is true once the duel-end wash has been started. */
  c.washState = () => ({
    value: washValue(),
    t: c.wash ? c.wash.t : 0,
    total: c.wash ? c.wash.total : 0,
    closing,
  });

  function close() {
    c._open = false;
    c.challenge = false;
    c.chooser = null;
    c.setEnd = null;
    c.inspect = null;
    if (bgm) bgm.play(previousTrack);
    c.onClose?.();
  }

  /** The player agent. Summoning starts at the hand cursor and takes the first
   *  Digimon from there that the side can actually pay for (the cost column is
   *  CARDPAK +0x05); Program cards are offered in hand order and only when
   *  F0x800a36e4's targeting test says the card has a legal target. */
  const playerAgent = {
    chooseStart: () => coinPick,
    chooseSummon(duel, s) {
      if (s.field.length >= FIELD_LIMIT) return -1;
      const hand = s.hand;
      for (let i = 0; i < hand.length; i++) {
        const idx = (c.handCursor + i) % Math.max(1, hand.length);
        if (canSummon(duel, s, hand[idx])) return idx;
      }
      return -1;
    },
    chooseProgram(duel, s) {
      for (let i = 0; i < s.hand.length; i++) {
        const rec = cardById(s.hand[i]);
        // Two separate gates, as the disc has them: may this card be picked in
        // this phase at all (F0x80085FD0), and does its effect have a legal
        // target (F0x800A36E4).
        if (!handCardSelectable(duel, rec)) continue;
        if (canPlayProgram(duel, s, EFFECTS.get(s.hand[i]))) return i;
      }
      return -1;
    },
    chooseTarget: () => 0,
  };
  const agents = { player: playerAgent, opponent: discAgent };

  // ---- the combo-target picker ------------------------------------------
  // F0x8008AD98 case 1. The picker runs over the side's own field slots: every
  // slot that is not part of a qualifying run is dimmed, and only a lit slot
  // can be confirmed. The cursor opens where F0x8008C8D8 puts it.
  //
  // The original opens this from its own mode machine; the walker has no such
  // mode, so it is opened on demand from the summon phase (and from the UI lab)
  // whenever the player's field actually holds a run. That entry point is a
  // WALKER RULE — the picker's behaviour once open is the decoded one.
  /** null when closed, else { cursor, dimmed, runs } */
  c.picker = null;

  c.comboPickerAvailable = () =>
    !!c.duel && !c.duel.outcome && comboRuns(c.duel, c.duel.player).length > 0;

  c.openComboPicker = () => {
    const d = c.duel;
    if (!d) return false;
    const runs = comboRuns(d, d.player);
    if (!runs.length) return false;
    const flags = comboSlotFlags(d, d.player);
    c.picker = {
      // The availability window is the live slot count: the flag array the
      // detector writes is exactly that long.
      cursor: defaultComboCursor(flags, 0, flags.length),
      dimmed: comboPickerDimmed(d, d.player),
      runs,
    };
    return true;
  };

  c.closeComboPicker = () => {
    squashWaypointExtra();
    c.picker = null;
  };

  /** The effect picker — where a card's program stops and asks you for a card.
   *
   *  A Program card's program is run by the interpreter in
   *  engine/systems/card-effect-vm.ts, and two of its opcodes are a question:
   *  0x5B, which acts on ONE board target, and the sort-and-select 0xAB..0xAD,
   *  which takes a card out of a pile. The duel parks on the question and this
   *  picker answers it. Nothing is chosen for you: until you pick, the phase
   *  cannot go on. */
  c.effectPicker = null;

  /** escardgm 57. An effect that parks on a hand discard says so. */
  function discardPrompt() {
    return c.duel?.pendingHandDiscard ? ES.pickToTrash : null;
  }

  function openEffectPickerIfPending() {
    const d = c.duel;
    if (!d || c.effectPicker) return;
    const choice = duelChoice(d);
    if (!choice) return;
    c.effectPicker = { cursor: 0, t0: c.ticks };
    // THE PICKER BLEEPS AS IT OPENS, decoded 2026-08-27.
    //
    // The board picker does not merely place its cursor on the first slot: it
    // calls the SAME cursor-step routine it uses for a press, with a step of
    // zero, so the starting slot lights up exactly the way a moved-to slot
    // does. That routine plays the cursor sound unconditionally, before it
    // looks at which direction it was given — so the sound comes out on the
    // step-zero call too, once, before the player has touched anything.
    //
    // The two call sites pass the group and then zero in the branch's delay
    // slot, which runs even though the branch is taken; reading the jump
    // target alone would have made this look like an ordinary move.
    //
    // Scoped to a BOARD question because that is the picker this was read
    // from. The pile picker is a different routine and has not been read, so
    // it is left silent rather than given a sound by analogy.
    if (choice.kind === "board") sfx?.play(DUEL_SOUND.cursor);
  }

  /** How many things the parked question offers. */
  function effectChoiceCount() {
    const choice = duelChoice(c.duel);
    if (!choice) return 0;
    return choice.kind === "board" ? choice.targets.length : choice.slots.length;
  }

  /** The card the picker's cursor is on, for the prompt line. */
  function effectChoiceCard() {
    const d = c.duel;
    const choice = duelChoice(d);
    if (!choice) return null;
    const i = c.effectPicker?.cursor ?? 0;
    if (choice.kind === "board") {
      const t = choice.targets[i];
      return t ? cardById(t.side.field[t.slot]?.id) : null;
    }
    const side = choice.side;
    const pile = choice.zone === "hand" ? side.hand : choice.zone === "deck" ? side.deck : side.trash;
    return cardById(pile[choice.slots[i]]);
  }

  function effectPickerKey(k) {
    const d = c.duel;
    const choice = duelChoice(d);
    const n = effectChoiceCount();
    if (!choice || !n) { c.effectPicker = null; return true; }
    const p = c.effectPicker;
    if (k === "left" || k === "right") {
      // IT DOES NOT WRAP: a left step happens only when the cursor is above
      // zero and a right step only when it is below the last item; every other
      // press is swallowed, sound included.
      // — cardduel-picker-cursor-does-not-wrap-2026-08-21 (verified)
      const to = p.cursor + (k === "left" ? -1 : 1);
      if (to < 0 || to >= n) return true;
      p.cursor = to;
      sfx?.play(DUEL_SOUND.cursor);
      return true;
    }
    if (k === "circle") {
      // A board answer is the field SLOT the cursor sits on; a pile answer is the
      // pile index. Both are what the engine indexes its arrays by.
      const answer = choice.kind === "board"
        ? choice.targets[p.cursor]?.slot
        : choice.slots[p.cursor];
      if (resolveCardChoice(d, answer)) {
        sfx?.play(DUEL_SOUND.confirm);
        dropExtraSlot(EXTRA_SLOT_F);
        c.effectPicker = null;
        settleProgramTurn(d, EFFECTS, Math.random, d.player);
        afterPlayerTurn();
        openEffectPickerIfPending();
        syncSprites();
      }
      return true;
    }
    // There is no cancel: the card is already on the table and the choice is
    // owed. Escape is swallowed.
    return true;
  }

  // ---- choosing which card to play ---------------------------------------
  // The disc's Load and Compile phases are one routine (F0x8009FDD8) whose
  // state machine asks THREE times, not once — claim
  // cardduel-playing-a-card-is-pick-confirm-commit-with-a-take-back-2026-08-21,
  // verified: states 2, 4 and 6, latching effect opcodes 0x98, 0x99 and then
  // committing. Declining at state 6 is a real undo — the card is read back out
  // of the play history and put into your hand again. The walker plays the card
  // only at the third step, so its take-back needs no history rewind: nothing
  // has left the hand yet.
  //
  // WHAT EACH STATE ACTUALLY IS was read 2026-08-24, and the walker had the
  // first one wrong in three separate ways. Traced through the opcode registry
  // into the two handlers:
  //
  //   state 2, opcode 0x98 -> F0x80086330 (enter) + F0x8008642C (update).
  //     The enter walks your whole hand (duel+0x600, count duel+0x5A6) through
  //     the summon-usability gate F0x80085FD0 and sets THREE things: the
  //     prompt's message id into view+0xDE8 — the constant 0xE, which is
  //     escardgm string 0xE, "Use a Program Card?" — the default cursor into
  //     view+0xDF4, and duel+0x438 to 2 when at least one card is usable or 3
  //     when none is.
  //     F0x8008642C is the duel's TWO-OPTION PROMPT
  //     (cardgame-f8008642c-is-the-two-option-prompt). It accumulates the
  //     resident frame delta into duel+0x424 and waits 0x24 units with no
  //     pending effect before it opens anything; left and right TOGGLE the
  //     cursor duel+0x440 with an exclusive-or against 1 — so there are exactly
  //     two answers — and the toggle is gated on duel+0x438 == 2, so with no
  //     usable card the answers are frozen. Cancel forces the cursor to 1.
  //     Its answer is 1 when the cursor rests on answer 0 and 2 otherwise,
  //     which is what opcode 0x98's update branches on.
  //
  //   state 4, opcode 0x99 -> F0x80086D78 (enter) + F0x80087EDC (update).
  //     THIS is the hand selector. The enter marks every one of up to 40 hand
  //     entries usable or not through the same gate, so the row is drawn with
  //     per-card legality rather than uniformly, and F0x80087EDC is the generic
  //     list picker; its result is written to duel+0x57A and -1 means cancelled.
  //
  // So the disc asks a YES/NO QUESTION FIRST and only then opens the hand. The
  // walker opened the hand immediately and drew the PHASE ANNOUNCEMENT's own
  // window — escardgm 0x6/0xA, "Select and use a Program Card." — across the
  // board for the whole of it, full width, on top of the centre row. That
  // string belongs to the announcement, which is over by the time you choose.
  //
  // STILL NOT DECODED: what the two-option box LOOKS like. Its message id and
  // its behaviour are read; its geometry is not, and no rig capture in the set
  // shows one. PLAY_BOX below is WALKER PLACEMENT and says so.
  /** null when the phase is not asking, else { stage, cursor, usable } */
  c.play = null;

  /** The question and its two answers, ALL THREE READ OFF THE DISC on
   *  2026-08-24 and all three escardgm verbatim: 0x0E, 0x45 and 0x46. The
   *  walker had guessed the answers were the "Yes\nNo" pair at 0x18; they are
   *  not, they are two full sentences. */
  const PLAY_ASK = {
    question: "Use a Program Card?",
    answers: ["Yes, I'll use a Program Card.", "No, I'll pass."],
  };

  /** Whether the card in hand slot `i` may be picked and has a legal target —
   *  the two gates the disc applies before offering it. */
  function playableSlot(i) {
    const d = c.duel;
    const id = d?.player.hand[i];
    if (id == null) return false;
    if (!handCardSelectable(d, cardById(id))) return false;
    return canPlayProgram(d, d.player, EFFECTS.get(id));
  }

  /** The bank's own line for why the card under the cursor cannot be played, or
   *  null when it can. escardgm 23/46..56 — a family of thirteen refusals that
   *  the walker carried none of.
   *
   *  The TRIGGER is `checkEffectLegality` (F0x800954f8, the record's +0x01),
   *  not `canPlayProgram`. F0x800a2180 case 6 shows the record's own +0x02 line
   *  exactly when checkEffectLegality returns non-zero, and it is asked once the
   *  card has been committed. `canPlayProgram` (F0x800a36e4, the record's +0x00)
   *  is the DISC'S SEPARATE SELECTION gate — the browser's grey-out and the AI's
   *  hand pick — and the disc asks it at a different point, so it is not the
   *  line's trigger.
   *
   *  Arms 9 and 11 are the two target re-checks (effectVisual 9 and 11): each
   *  compares the play's SETTLED target instance (`history+0x586`) against the
   *  board or the hand, and the disc settles that target only after the card is
   *  committed. While the card is still only browsed no target exists, so the
   *  gate does not refuse and those cards show no line here. Their rows are
   *  still greyed by `canPlayProgram` through `playableSlot`, which is the
   *  disc's selection gate and is unchanged. */
  function refusalLine(i) {
    const d = c.duel;
    const id = d?.player.hand[i];
    if (id == null) return ES.noCards;
    const card = cardById(id);
    if (!handCardSelectable(d, card)) return null;   // wrong phase: not a refusal
    const eff = EFFECTS.get(id);
    return checkEffectLegality(d, d.player, eff) ? null : refusalFor(eff);
  }
  c.refusalLine = (i) => refusalLine(i);

  /** debug-only: the same gate, for a headless test posing a hand */
  c.playableSlot = (i) => playableSlot(i);

  /** debug-only: the SUMMON gate, which is a different question from
   *  playableSlot -- that one asks whether a Program card may be loaded or
   *  compiled, and in the Summon Phase the question is whether a Digimon can
   *  be put on the field at all. A headless driver that judges the Summon
   *  Phase with playableSlot reads every slot as unusable and passes the whole
   *  phase without summoning, which is how a full-duel trace came back with an
   *  empty field. */
  c.summonableSlot = (i) => {
    const d = c.duel;
    const id = d?.player.hand[i];
    if (id == null) return false;
    return canSummon(d, d.player, id);
  };

  /** debug-only: the Summon Phase's own cursor, which lives outside c.play. */
  c.summonCursor = () => (c.duel?.summonTurns ? c.handCursor : null);

  /** debug-only: why the board is refusing input. The Summon Phase swallows
   *  every press while the board is busy, so a headless driver that hangs there
   *  needs to see which of the two reasons is true. */
  /** debug-only: is the board mid-animation, for headless capture */
  c.busyNow = () => boardBusy();
  c.boardBusyDebug = () => ({
    scheduled: scheduled.length,
    busySprites: [...c.sprites.entries()]
      .filter(([, rec]) => cardBusy(rec.sprite))
      .map(([k, rec]) => ({
        key: String(k),
        state: rec.sprite.state,
        timer: rec.sprite.timer,
        duration: rec.sprite.duration,
        effect: rec.sprite.effect,
        onArrive: !!rec.onArrive,
      }))
      .slice(0, 8),
  });

  /** debug-only: every live card sprite, in the RIG TRACE's own field order
   *  and units, so tools/diff_cardduel_sprites.mjs can compare the walker
   *  against tools/parse_cardduel_trace.py output without translating twice.
   *
   *  The trace line is
   *      <frame> sprite <slot> x,y,dx,dy,sx,sy,state45,kind46,clip47,anim42,timer28,dur2c
   *  and both sides carry x/y as 8.8 fixed point, so no conversion happens
   *  here. `clip` and `anim` have no walker counterpart yet and are omitted
   *  rather than faked; the comparator skips fields absent on either side. */
  c.spritePose = () => [...c.sprites.entries()]
    .map(([key, rec]) => {
      const s = rec.sprite;
      return {
        key: String(key), slot: s.slot,
        x: s.x, y: s.y, dx: s.destX, dy: s.destY,
        sx: s.scaleX, sy: s.scaleY,
        state: s.state, renderKind: s.renderKind,
        badge: s.badge, effect: s.effect,
        timer: s.timer, dur: s.duration,
        px: s.x >> 8, py: s.y >> 8, pdx: s.destX >> 8, pdy: s.destY >> 8,
      };
    })
    .sort((a, b) => a.slot - b.slot);

  /** debug-only: drive the decoded HUD panel slides, so a verifier can prove the
   *  renderer follows the model rather than a constant. Not used in play — the
   *  beats that issue these are Phase 2 of
   *  docs/todo/2026-08-26-cardduel-completeness-plan.md. */
  c.slidePanels = (dir) => {
    if (!c.view) return false;
    if (dir === "out") slideBothPanelsOut(c.view);
    else slideBothPanelsIn(c.view);
    return true;
  };

  /** debug-only: whether it is your summon turn right now. */
  c.summonIsMine = () => {
    const d = c.duel;
    return !!d?.summonTurns && summonTurnSide(d) === d.player;
  };

  /** Where the play cursor opens. WALKER CHOICE: the two gates that decide
   *  whether a hand card can be played at all are the decoded ones
   *  (F0x80085FD0 and F0x800A36E4, see playableSlot), but nothing establishes
   *  where the original parks this cursor — only the combo picker's opening
   *  slot is decoded, and that is a different widget (F0x8008C8D8). Opening on
   *  slot 0 meant that in a hand with one Program card among five Digimon the
   *  confirm was refused with a bleep and nothing on screen moved, which reads
   *  as a hang. It opens on the first card that can actually be played, and on
   *  slot 0 when none can. */
  function firstPlayableSlot() {
    const n = c.duel?.player.hand.length ?? 0;
    for (let i = 0; i < n; i++) if (playableSlot(i)) return i;
    return 0;
  }

  /** Start the phase as a sequence of turns, and let the opponent take any that
   *  come before yours. */
  function openProgramTurns() {
    const d = c.duel;
    if (!d) return;
    // Ceremony opcode 0x98 is what opens the negotiation, so by the time this
    // runs the turns usually exist already. It still opens them when something
    // else got here first (the UI lab drives the screen without the stream).
    if (!d.programTurns) beginProgramTurns(d);
    // escardgm 60/61. The bare announcement ("Load Phase" / "Select and use a
    // Program Card.") is a beat of its own; the board then comes BACK and this
    // band says the phase is starting. Both are in the reference sheets, in
    // that order. WALKER: the hold reuses the announcement's, which is the only
    // band hold that has been read.
    raiseNamePlate("you", phase(d).key === "load" ? ES.beginLoad : ES.beginCompile);
    runProgramTurns(d, agents, EFFECTS, d.player, Math.random, { hold: true });
    openEffectPickerIfPending();
    syncSprites();
  }

  /** After your turn: let the opponent answer, and reopen the picker if the
   *  phase has come back round to you. */
  function afterPlayerTurn() {
    const d = c.duel;
    if (!d || !d.programTurns) return;
    if (awaitingCardChoice(d)) return;       // the card is still asking
    runProgramTurns(d, agents, EFFECTS, d.player, Math.random, { hold: true });
    openEffectPickerIfPending();
    openPlaySelector(c.play?.cursor);
    syncSprites();
  }

  /** Give up the turn.
   *
   *  Only an EMPTY turn is a pass, and only an empty turn costs the twenty
   *  ticks and the sound: a side that declines after a play has been made goes
   *  straight to the resolve, which the engine decides — the screen just plays
   *  what the machine says happened.
   *  — cardduel-load-compile-turn-rules-2026-08-21 (verified) */
  function passTurn() {
    const d = c.duel;
    c.play = null;
    passProgramTurn(d, d.player);
    if (d.programTurns?.state === "pass") {
      sfx?.play(DUEL_SOUND.pass);
      raiseNamePlate("you", "Pass");
    }
    afterPlayerTurn();
  }

  /** State 0xB, a frame at a time: the pass delay holds the screen for twenty
   *  ticks before the turn moves on. */
  function stepProgramTurns() {
    const d = c.duel;
    const t = d?.programTurns;
    if (!t || t.state !== "pass") return;
    tickProgramTurns(d, 1);
    if (t.state === "pass") return;
    afterPlayerTurn();
  }

  /** Open the play selector on your turn — or take the turn as a pass when
   *  there is nothing in hand you are allowed to play.
   *
   *  WALKER CHOICE, and the reason for it: the two gates that decide whether a
   *  hand card can be played are the decoded ones (F0x80085FD0 and
   *  F0x800A36E4, see playableSlot), but nothing establishes what the disc does
   *  when NONE of them pass. The walker used to open the selector anyway, on
   *  slot 0, where confirm was refused with a bleep and nothing on screen
   *  moved — a hand of six Digimon cards in the Load Phase left the duel
   *  looking hung unless you knew to press Cross. A turn you are not allowed
   *  to take is a pass, so it is taken as one. */
  function openPlaySelector(preferred) {
    const d = c.duel;
    if (!d || !d.programTurns || programTurnSide(d) !== d.player) { c.play = null; return; }
    const cursor = preferred != null && playableSlot(preferred)
      ? preferred
      : firstPlayableSlot();
    // The QUESTION comes first, and the hand only opens if you say yes.
    //
    // IT IS ASKED EVEN WHEN YOU CANNOT PLAY. F0x80086330 sets duel+0x438 to 2
    // when at least one hand card passes the gate and 3 when none does, and
    // parks the cursor on answer 1 in that second case; F0x8008642C then
    // refuses to move the cursor at all, because its toggle is gated on
    // duel+0x438 being 2. So the box still opens, still says "Use a Program
    // Card?", and simply will not let you answer yes. OBSERVED on the rig,
    // 2026-08-24 run 5 frame 2086: the play machine sat in state 2 with
    // duel+0x438 = 3 and duel+0x440 = 1. The walker used to pass the turn
    // silently, skipping the beat.
    const frozen = !playableSlot(cursor);
    c.play = { stage: "ask", cursor: frozen ? 0 : cursor, ask: frozen ? 1 : 0, frozen };
    // Raise the box on the frame the question is asked. This runs out of input
    // handling, which happens after the frame's step and before its draw, so
    // leaving it to the driver gave the previous beat's window one more frame
    // on screen at whatever width it had reached.
    //
    // RESOLVED 2026-09-13: the "restart" was not a second open. openPrompt
    // reset the timer and state but left `progress` holding whatever the
    // previous owner of the single prompt record had reached (measured 3413 =
    // 0x1000*5/6, a closing layout-1 window), so the freshly opened layout-0
    // box painted that stale width for the one frame before its own step
    // recomputed 0. engine/systems/card-view.ts now seeds `progress` from the
    // full timer, and the wipe verifier is green run after run. What remains is
    // only the observer: the page's clock catches up in bursts
    // (`performance.now() / (1000/60)`), so a sample can miss ticks, but no
    // jump backward is drawn.
    openPlayWindow();
  }

  /** Put the play-negotiation window up, replacing whatever else is there.
   *
   *  WHOSE window is up decides this. There is one prompt record, and
   *  `layoutIndex` says who owns it -- openPrompt's FIFTH argument, read off
   *  the stack at F0x8009C054 `lw 0x38($sp)`. The negotiation opens layout 0;
   *  the phase prompt and 0xA8's window both use layout 1. So a non-zero layout
   *  still up when the question opens is somebody else's and is replaced, while
   *  a layout-0 window already open is ours and must not be re-opened every
   *  frame. openPrompt hard-sets timer and state, so replacing one restarts the
   *  wipe at 0 with no blending.
   *
   *  NOT WIRED, deliberately: the decoded open/close/confirm sound ids
   *  (0x00040019, 0x0004001A, 0x8004503C) are constants in card-view.ts, but
   *  this file's DUEL_SOUND map has no entry for them and inventing one would
   *  be a guess.
   *
   *  WALKER CHOICE, labelled: whether the original lets one window finish
   *  before another opens is NOT decoded -- F0x8009C054 and F0x8009C0DC both
   *  drive the single record, so the overlap cannot be read off the two
   *  routines alone. What is certain either way is that the box on screen must
   *  belong to the question being asked. */
  function openPlayWindow() {
    if (!c.view || !c.play || announcing()) return;
    const p = c.view.prompt;
    const mine = p.layoutIndex === 0;
    if (p.state === PromptState.idle || !mine) {
      openPrompt(c.view, 0, 0, c.play.ask ?? 0, 0);
    }
  }

  /** The sprite key the effect picker's cursor is on, or null. Deck and trash
   *  picks have no card on the board, so they light nothing. */
  function effectChoiceKey() {
    const d = c.duel;
    const choice = c.effectPicker ? duelChoice(d) : null;
    if (!choice) return null;
    const i = c.effectPicker.cursor;
    if (choice.kind === "board") {
      const t = choice.targets[i];
      if (!t) return null;
      const sideKey = t.side === d.player ? "you" : "opp";
      return keyOf(sideKey, "field", t.side.field[t.slot]?.id, t.slot);
    }
    if (choice.zone !== "hand") return null;
    const slot = choice.slots[i];
    const sideKey = choice.side === d.player ? "you" : "opp";
    return keyOf(sideKey, "hand", choice.side.hand[slot], slot);
  }

  /** The hand slot a sprite key names, or -1 when it is not your hand. */
  function handSlotOfKey(key) {
    const m = /^you:hand:\d+:(\d+)$/.exec(key);
    return m ? Number(m[1]) : -1;
  }

  /** The challenge screen. It carries no cursor: confirm opens the folder
   *  chooser, cancel walks away from the duel.
   *
   *  NOT DECODED: which buttons this screen accepts. The rig capture is a
   *  screenshot strip, not an input log, and the run pressed only X. Confirm
   *  and cancel are the walker's, matched to every other screen here. */
  function challengeKey(k) {
    if (k === "circle") {
      sfx?.play(DUEL_SOUND.confirm);
      c.challenge = false;
      c.chooser = { cursor: Math.min(cards().activeFolder, cards().folders.length - 1), t0: c.ticks };
      return true;
    }
    if (k === "triangle" || k === "cross") {
      sfx?.play(DUEL_SOUND.cancel);
      pendingOpen = null;
      close();
      return true;
    }
    return true;
  }

  /** The folder chooser's cursor. Up/down walk the three rows, Circle commits
   *  the choice and the machine takes the plates down itself; nothing else is
   *  read, so there is no way back off this list. */
  function chooserKey(k) {
    // Once the plates are taking themselves down, the choice is committed and
    // nothing else is accepted — otherwise a held confirm restarts the close.
    if (c.chooser.closing) return true;
    // The picker takes input only once state 9 has run, which is the machine's
    // own tick 48 after the plates started arriving. See CHOOSER.readyTick.
    if (c.ticks - (c.chooser.t0 ?? 0) < CHOOSER.readyTick) return true;
    const n = cards().folders.length;
    if (k === "up" || k === "down") {
      // IT DOES NOT WRAP. The choice lives in duel+0x2EA over 0..2; the Up arm
      // branches away when the choice is already 0 and the Down arm tests it
      // against 2 before moving, so an end press moves nothing — and, because
      // the sound is played inside the arm that moved, it is also silent.
      // — cardgame-folder-chooser-is-up-down-over-three-and-does-not-wrap-2026-08-24
      const to = c.chooser.cursor + (k === "up" ? -1 : 1);
      if (to < 0 || to >= n) return true;
      c.chooser.cursor = to;
      sfx?.play(DUEL_SOUND.cursor);
      return true;
    }
    if (k === "circle") {
      sfx?.play(DUEL_SOUND.confirm);
      // Native: nothing moves at all for fifteen ticks (state 10), the cursor
      // marker shrinks away (state 11), and only then do the three plates go in
      // FOLDER ORDER five ticks apart (states 13/15/17), the title band with
      // them (state 19) and the deck at state 21. beginDuel runs from the draw
      // on CHOOSER.loadTick, so the player watches the whole take-down first.
      c.chooser.closing = { t0: c.ticks, folder: c.chooser.cursor };
      return true;
    }
    // NO CANCEL. The original mode-2 machine reads only Up, Down and Circle
    // (cardgame F0x8009F110 state 9); Cross, Triangle and Square are never
    // read, so once the folder list is up the choice is committed. The walker
    // used to let Triangle/Cross back out — a convenience the original does
    // not have. Claim cardgame-folder-chooser-pad-arms-2026-09-13.
    return true;
  }

  // ---- the Start Phase ceremony: "Draw Calumon to go first." ------------
  // Decoded 2026-08-07 as card-effect opcode 0xA7 (docs/research/card/
  // card-battle-complete-model-2026-08-06.md G.5). Two cards are laid face
  // down; you pick one hoping for Calumon; both flip; drawing Calumon means you
  // act first. It is a genuine 50/50 — the immediate half F0x8008985C rolls the
  // answer into duel+0x434 before you touch the controller, and no deck
  // property affects it.
  //
  // The stateful half F0x80089974 is a six-step machine counted by duel+0x422,
  // and the walker runs the same six steps with the same frame counts:
  //
  //   1  15-frame intro tween per card, then the pair is presented
  //   2  the cursor moves between the two; confirm latches it into duel+0x440
  //   3  the chosen card flips (view+0xF28, which is flipCard / 0x8009C5D8)
  //   4  at t == 0x14 the OTHER card flips and the result is announced; the
  //      step holds to 0x5B and a confirm after 0x1F jumps it to 0x5A
  //   5  15-frame outro, drawn as the scale-to-nothing the original issues
  //      (`unkF24(view, side, 5, 0, 0x1000)`)
  //   6  the outcome is written and the ceremony ends
  //
  // The outcome table is the one the delay-slot trap decides: `bne` at
  // 0x80089cc4 carries `li $a3, 0x43` in its delay slot, so a pick that DIFFERS
  // from the rolled bit gets string 0x43, "You go first.", and a pick that
  // MATCHES gets 0x44, "Opponent goes first." The walker does not re-derive
  // that here — it asks the rules engine, which owns the same table.
  const COIN_INTRO = 0x0F;
  const COIN_FLIP_OTHER_AT = 0x14;
  const COIN_HOLD = 0x5B;
  const COIN_SKIPPABLE_AFTER = 0x1F;
  const COIN_SKIP_TO = 0x5A;
  const COIN_OUTRO = 0x0F;
  /** Where the two cards sit. WALKER PLACEMENT from the rig captures
   *  (web/assets/ref/cardduel/coin-choose.png, authority 1): the two 40x46
   *  cards measure exactly (116, 97) and (164, 97). The y is the decoded centre
   *  row, DUEL_BOARD.centreY; the 48px x pitch is the capture's, not a table.
   *  The selected card also sits 5px higher in the capture, which is the lift
   *  below — also the capture's, not decoded. */
  const coinPos = () => [[116, ROWS.centre], [164, ROWS.centre]];
  const COIN_LIFT = 5;

  /** null when the ceremony is not running, else its state. */
  c.coin = null;

  function openCoinCeremony() {
    if (c.coin) return;
    const sprites = coinPos().map(([x, y], i) => {
      const sp = createCardSprite(i, fx(x), fx(y - COIN_LIFT));
      sp.renderKind = CardRenderKind.reverse;
      // Step 1 is the intro tween: the pair scales up into place over 15
      // frames. `unkF24(view, side, 0xA, 0x1000, 0x1000)` is issued at frames
      // 0 and 4, which is the per-side stagger.
      sp.scaleX = 0;
      sp.scaleY = 0;
      scaleCard(sp, COIN_INTRO - i * 4, SCALE_ONE, SCALE_ONE);
      return sp;
    });
    c.coin = { step: 1, t: 0, cursor: 0, sprites, faces: [null, null], message: null,
               awaiting: false };
  }

  /** Step 2's confirm: latch the pick and stand aside. The Start Phase is NOT
   *  settled here any more — settling it is ceremony opcode 0xA7's job, and
   *  0xA7 is issued by the duel's own stream on the next frame, at which point
   *  `revealCoin` below plays what it decided. Answering the pad and running
   *  the toss are two beats, so they are two functions. */
  function coinConfirm() {
    const k = c.coin;
    coinPick = k.cursor;
    coinPicked = true;
    // `awaiting` is what lets the stream past this screen for exactly one beat.
    k.awaiting = true;
    sfx?.play(DUEL_SOUND.confirm);
  }

  /** 0xA7 has run: read its outcome back out and play the reveal. */
  function revealCoin() {
    const d = c.duel;
    const k = c.coin;
    if (!k) return;
    k.awaiting = false;
    // duel.firstPlayer is the engine's own reading of the same outcome table.
    const youFirst = d.firstPlayer === 0;
    // You go first exactly when the card you picked was Calumon.
    k.faces = k.cursor === 0
      ? [youFirst ? CALUMON_CARD_ID : IMPMON_CARD_ID, youFirst ? IMPMON_CARD_ID : CALUMON_CARD_ID]
      : [youFirst ? IMPMON_CARD_ID : CALUMON_CARD_ID, youFirst ? CALUMON_CARD_ID : IMPMON_CARD_ID];
    k.message = youFirst ? "You go first." : "Opponent goes first.";
    k.step = 3;
    k.t = 0;
    flipCard(k.sprites[k.cursor]);
  }

  /** The pick the player latched, handed to the rules engine's chooseStart. */
  let coinPick = 0;

  function stepCoin() {
    const k = c.coin;
    if (!k) return;
    for (const sp of k.sprites) stepCardSprite(sp);
    k.t++;
    switch (k.step) {
      case 1:
        if (k.t >= COIN_INTRO) { k.step = 2; k.t = 0; }
        break;
      case 2:
        break;                                  // waits on the pad
      case 3:
        if (!cardBusy(k.sprites[k.cursor])) { k.step = 4; k.t = 0; }
        break;
      case 4:
        if (k.t === COIN_FLIP_OTHER_AT) flipCard(k.sprites[k.cursor ^ 1]);
        if (k.t >= COIN_HOLD) {
          k.step = 5;
          k.t = 0;
          for (const sp of k.sprites) scaleCard(sp, COIN_OUTRO, 0, SCALE_ONE);
        }
        break;
      case 5:
        if (k.t >= COIN_OUTRO) { k.step = 6; }
        break;
      default:
        break;
    }
    if (k.step === 6) {
      c.coin = null;
      // The Draw Phase announces itself when ITS banner opcode (0xA1) is
      // issued, not when this ceremony ends — so nothing is raised here.
      syncSprites();
    }
  }

  /** Step 2 and step 4 are the only ones that take input, and step 4 only
   *  hurries the hold along. */
  function coinKey(kk) {
    const k = c.coin;
    if (k.step === 2) {
      if (kk === "left" || kk === "right") {
        k.cursor ^= 1;
        sfx?.play(DUEL_SOUND.cursor);
        return true;
      }
      if (kk === "circle") { coinConfirm(); return true; }
      return true;
    }
    if (k.step === 4 && k.t >= COIN_SKIPPABLE_AFTER
        && (kk === "circle" || kk === "triangle")) {
      k.t = COIN_SKIP_TO;
    }
    return true;
  }

  // ---- the set-end beat --------------------------------------------------
  // A set does not simply tick over. Battle-Phase state 0xB plays packed sound
  // 0x009C0002 (CARDSGNL, the duel's own cbtl00 bank), creates a mid-grey
  // overlay — all three colour arguments 0x80 — with a life of ten, and then
  // runs the WINNER's set counter for fifty-one ticks of the resident frame
  // delta before anything else happens. States 0xC..0x10 then hold a result
  // window open and wait for a button.
  // — cardbattle-set-counter-roll-is-51-ticks-with-a-grey-flash-2026-08-21
  //   (partially_verified; static reading, never watched on the rig)
  //
  // Ahead of that, mode 9's presentation half (0x80094B9C) sends every card in
  // the played row to the discard ONE AT A TIME and drains both sides' board
  // counts into their discard counts a step at a time. The walker did the whole
  // set change in a single frame with no banner and no wait, which is
  // divergence item 7 in docs/research/ui/cardgame-divergence-2026-08-21.md.
  //
  // NOT DECODED, and marked at each site: how the grey overlay is blended (only
  // its colour and its life were read); which of the three result windows
  // carries which escardgm line; and which buttons dismiss them.
  const SETEND_FLASH = 10;
  const SETEND_ROLL = 51;

  /** THE CARD EXIT, decoded 2026-08-27 from the two beats that perform it.
   *
   *  A card leaving the board does NOT travel to the trash pile. Both routines
   *  that send one there call the view's scale tween, and that tween pins the
   *  card's destination to the position it already holds -- so the card stays
   *  exactly where it is and squeezes to nothing edge-on. What moves is the
   *  NUMBER: each card that goes is appended to its owner's trash pile and the
   *  trash count beside that player ticks up by one, published through the same
   *  panel setter the AP and HP plaques use, as property 7.
   *
   *  Which owner is per CARD, not per side: the routine reads an owner byte off
   *  the leaving slot and files the card under that player. A card taken from
   *  the opponent goes home to the opponent's trash, not to the trash of the
   *  side whose row it was standing in.
   *
   *  Two beats do this, and they differ only in cadence:
   *    * the transfer (0x17 / 0x18) holds the card, squeezes it over five
   *      ticks, and starts the NEXT card only once that squeeze has finished --
   *      a handshake, not a clock -- walking the row from its last slot down;
   *    * the set award (0x1C / 0x1D) runs on a clock instead: one card every
   *      three ticks, squeezed over four, walking the row from slot 0 up.
   *
   *  This replaces the walker's slide-to-the-pile, which was explicitly marked
   *  as a guess at the site: the gap "was not read" and the deal's own six-tick
   *  stagger was standing in for it. Both numbers are now read. */
  const EXIT_SQUASH_TRANSFER = 5;
  const EXIT_SQUASH_SETEND = 4;
  const EXIT_STAGGER_SETEND = 3;
  /** The transfer's first step is a SHAKE -- the view slot it calls before the
   *  squeeze is the same routine the battle beats shake a struck card with. Its
   *  handshake costs one tick to enter and one to notice the finish, so a card
   *  occupies the row for the shake, the squeeze, and two ticks between. */
  const EXIT_STAGGER_TRANSFER = SHAKE_DURATION + EXIT_SQUASH_TRANSFER + 2;

  /** Which of the two exits the current beat is running. The set award's clock
   *  is the default because it is the one that runs without a per-card
   *  handshake, and it is what every other retirement in the duel uses. */
  let cardExit = { squash: EXIT_SQUASH_SETEND, stagger: EXIT_STAGGER_SETEND, shake: false };

  /** THE GAP-CLOSE, decoded 2026-08-27 from opcode 0x4C's update handler.
   *
   *  When cards leave the board the survivors slide up to close the holes, and
   *  the walker was already sliding them - on a guessed duration of 8, silently.
   *  Both are wrong. The handler issues EVERY survivor's move in one pass, so
   *  they all travel together rather than one after another, each over 10 ticks,
   *  and it uses the AUDIBLE move method rather than the silent one.
   *
   *  Destinations come from a table row plus the 41px column pitch this file
   *  already uses, which is why nothing here needs new geometry.
   *
   *  Scoped: the generic reflow below keeps its own numbers, because a row can
   *  re-flow for reasons other than this beat and those were not read. */
  const REFLOW_SILENT = { duration: 8, silent: true };
  const REFLOW_GAP_CLOSE = { duration: 10, silent: false };
  let rowReflow = REFLOW_SILENT;
  const setCardExit = (style) => { cardExit = style; };
  c.cardExitStyle = () => ({ ...cardExit });
  /** The walker retires cards from one place for every beat, so it needs one
   *  cadence. The set award's is the clocked one and so the one that can be
   *  used without a per-card handshake. */
  const SETEND_DRAIN_STAGGER = EXIT_STAGGER_SETEND;
  /** The set award's field pass runs a fixed 61 ticks before the hands go
   *  back, whether or not the row emptied sooner. */
  const SETEND_FIELD_PASS = 0x3d;

  /** The four numbers the hand return ramps, as they stood BEFORE the set
   *  changed. The disc's handler copies them at the end of its field pass and
   *  drains the copies; the model here has already made the move by then --
   *  `endSet` returns both hands to both decks, which is decoded and verified
   *  behaviour and not something to undo -- so the readout needs the counts
   *  from before it, and nothing else records them. Sampled every frame the
   *  set ceremony is not running, which is every frame up to the one that
   *  opens it. */
  let preSetCounts = { hand: [0, 0], deck: [0, 0] };
  function samplePreSetCounts() {
    const d = c.duel;
    if (!d || c.setEnd) return;
    preSetCounts = {
      hand: [d.player.hand.length, d.opponent.hand.length],
      deck: [d.player.deck.length, d.opponent.deck.length],
    };
  }

  /** null when no set is being awarded, else the ceremony's state. */
  c.setEnd = null;

  /** Open the beat when a phase step moved either set counter. `before` is the
   *  pair read immediately before the step. */
  function openSetEndIfScored(before) {
    const d = c.duel;
    if (!d) return;
    const now = [d.player.score, d.opponent.score];
    if (now[0] === before[0] && now[1] === before[1]) return;
    c.setEnd = {
      step: "drain",
      t: 0,
      // The set goes on total HP left on the field and a tie goes to the
      // opponent, so the winner is whichever counter moved.
      winner: now[0] !== before[0] ? 0 : 1,
      // An equal total is state 0xB's draw window, not its loss window.
      draw: !!d.setDraw,
      from: before,
    };
  }

  /** The counter the score plates show.
   *
   *  The disc does not leave the plate still while the counter rolls. State 0xB
   *  writes the winner's set counter into the view twice a tick, once with one
   *  added and once without, on the low bit of the roll accumulator
   *  (`cardgame.s:31131` and its two arms at `:31133-31149` and `:31150-31164`),
   *  so the plate the player reads alternates between the old and the new value
   *  for all fifty-one ticks. Only the awarded side is written, so the other
   *  plate sits still. `t` counts the roll's accumulator, one frame delta per
   *  frame, which is the same bit when that delta is one. */
  function shownScore(i) {
    const d = c.duel;
    const k = c.setEnd;
    if (k && (k.step === "drain" || k.step === "roll")) {
      return k.winner === i && k.step === "roll" && (k.t & 1) ? k.from[i] + 1 : k.from[i];
    }
    return i === 0 ? d.player.score : d.opponent.score;
  }

  /** The DUEL's result — escardgm 0x15 / 0x16, state 0x11's own window, and
   *  the line a losing duel leaves the screen on. Shown as its own step of the
   *  set-award chain while that chain is running, and here once it is not, so
   *  it is the same text either way. */
  function duelResultLine() {
    const d = c.duel;
    return d?.outcome === "win" ? "You won this battle!"
      : d?.outcome === "loss" ? "You lost this battle!"
      : "It's a draw so you, the challenger, lose.";
  }

  /** The SET's result. State 0xB opens window `0x10` when you took the set,
   *  `0x11` when the opponent took it on HP and `0x12` on a draw — and escardgm
   *  strings `0x10`, `0x11` and `0x12` are exactly "You win!", "You lose!" and
   *  "It's a draw so you, the challenger, lose." The three-way match is the
   *  evidence that these window ids ARE escardgm indices; it was recorded as a
   *  walker mapping until the indices were checked against the file on
   *  2026-08-24.
   *
   *  CORRECTED 2026-10-05 against the assembly: the draw IS reachable, because
   *  the comparison is `slt` and its false arm includes the equal case. State
   *  0xA awards an equal total to side 1 (`cardgame.s:31113-31122`) and state
   *  0xB then re-reads the same two totals and compares them with `beq`
   *  (`:31245-31261`), taking the 0x12 window instead of 0x11. The old comment
   *  here said a draw could not arise, which sent every tied set to "You
   *  lose!" — the right award, the wrong sentence.
   *
   *  Deliberately NOT the "battle" lines: in this game's own wording a "battle"
   *  is the whole duel — the mode is Card Battle (escardgm 13) and you are
   *  issued a Card Battle Challenge (31) — while a set is one round inside it.
   *  escardgm 21/22 belong to `d.outcome`, and the split is already decoded
   *  there. Reading the English the other way round and swapping them is wrong;
   *  this comment exists because that was tried. */
  function setEndLine() {
    const s = c.setEnd;
    if (!s) return "";
    if (s.draw) return "It's a draw so you, the challenger, lose.";
    return s.winner === 0 ? "You win!" : "You lose!";
  }

  /** escardgm 20, "Next set." — NOT drawn anywhere, and that is the game's own
   *  arrangement, not an omission here. Its index is 0x14, and `0x800A0F94`
   *  never opens a window of that id: the Battle-Phase machine's window ids are
   *  0x10, 0x11 and 0x12 (state 0xB), 0x13 (state 0xE) and 0x15 / 0x16 (state
   *  0x11), and the draw path uses `view+0xEE4`. Which routine raises it is NOT
   *  established. It used to be drawn under the set result, which is a line the
   *  disc does not put there. */

  /** One frame of the beat. Runs from stepSprites, with the sprite layer. */
  function stepSetEnd() {
    const k = c.setEnd;
    if (!k) return;
    k.t += 1;
    if (k.step === "drain") {
      // The played row is still on its way to the discard. Wait it out rather
      // than rolling the counter over a board that is still moving.
      if (boardBusy()) return;
      k.step = "roll";
      k.t = 0;
      sfx?.playBank?.(DUEL_BANK, CARDSGNL);
      return;
    }
    if (k.step === "roll" && k.t >= SETEND_ROLL) {
      k.step = "result";
      k.t = 0;
    }
  }

  /** Every window the set award puts up, in the order `0x800A0F94` puts them
   *  up. The `step` names are the machine's own state numbers, and each one's
   *  wait and its buttons are that state's, read from the assembly
   *  (`cardgame.s:31129` onward):
   *
   *    drain     state 0xA — the LOSER's Digimon are still leaving the field
   *    roll      state 0xB — the counter roll; 0x9C0002 and a mid-grey flash on
   *              its first tick, then the winner's set counter moves by one
   *    result    state 0xD — the SET's line. CIRCLE OR CROSS closes it
   *    second    state 0x10 — "Current score". CIRCLE OR CROSS closes it
   *    overTest  state 0x14 — the DUEL's line, and only a win goes on past it
   *    partner   state 0x17 — the opponent's own line for this duel, and BOTH
   *              buttons end the duel from here
   *
   *  Every one of these was folded into a single window with a single press
   *  before, which is why the disc's three result windows read as one line and
   *  why a loss left the screen instantly instead of after a button. */
  const SETEND_STEPS = ["drain", "roll", "result", "second", "overTest", "partner"];

  /** What each window above accepts. Every pad gate in `0x800A0F94` reads
   *  logical 0x0D (Circle) and then 0x0E (Cross) and waits while neither is
   *  down — including the last one, whose second gate returns without writing a
   *  state only when Cross was NOT pressed (`cardgame.s:31547` and `:31561`;
   *  the same pair at `:31066`/`:31080` for state 4, `:31296`/`:31310` for 0xD,
   *  `:31371`/`:31385` for 0x10 and `:31476`/`:31490` for 0x14). This used to
   *  list the last window as Circle-only, which left the screen unable to
   *  leave that window with Cross. */
  const SETEND_ACCEPTS = {
    result: ["circle", "cross"],
    second: ["circle", "cross"],
    overTest: ["circle", "cross"],
    partner: ["circle", "cross"],
  };

  /** The press. Each window hands over to the next state, and the last of them
   *  either queues state 0x12's sweep or lets the duel end. */
  function setEndKey(k) {
    const d = c.duel;
    const s = c.setEnd;
    if (!s) return true;
    if (!SETEND_ACCEPTS[s.step]?.includes(k)) return true;
    sfx?.play(DUEL_SOUND.confirm);

    // state 0xD -> 0xE: the set line goes down and "Current score" comes up.
    if (s.step === "result") { s.step = "second"; s.t = 0; return true; }
    // state 0x10 -> 0x11: the score window goes down and the DUEL-OVER TEST
    // runs. `cardgame.s:31402-31443`: two sets won is the duel, and a win also
    // plays W_JINGLE (0x6004001E) as the line comes up. A loss plays nothing.
    // — cardgame-there-is-no-end-of-duel-score-screen-2026-08-24
    if (s.step === "second") {
      const over = d.player.score >= SETS_TO_WIN || d.opponent.score >= SETS_TO_WIN;
      if (!over) {
        // state 0x12. The engine queues the sweep itself now the duel is known
        // to have survived the set; nothing is latched from here.
        c.setEnd = null;
        return true;
      }
      if (s.winner === 0 && !rewarded) {
        rewarded = true;
        sfx?.play(DUEL_SOUND.win);
        // Winning increments the pack counter for this opponent's set, capped
        // at 99 — the byte at save + setId + 0x7c.
        //
        // escardgm 66 IS "Got a Booster Pack", so the reward is the game's own,
        // not the walker's reading of an unidentified byte. The line is raised
        // here, where the grant happens.
        if (grantPackForOpponent(record)) raiseNamePlate("you", ES.gotBooster);
      }
      s.step = "overTest"; s.t = 0;
      return true;
    }
    // state 0x14: `duel+0x301 == 0` — YOU took the set — is the only way past
    // the duel line, and a loss leaves the duel here (`cardgame.s:31466-31478`).
    if (s.step === "overTest") {
      if (s.winner !== 0) { c.setEnd = null; return true; }
      s.step = "partner"; s.t = 0;
      return true;
    }
    c.setEnd = null;
    return true;
  }

  function playKey(k) {
    const d = c.duel;
    const p = c.play;
    const n = d.player.hand.length;
    if (!n) { passTurn(); return true; }
    p.cursor = Math.min(p.cursor, n - 1);

    // State 2: the two-option question, before the hand opens at all.
    if (p.stage === "ask") {
      if ((k === "up" || k === "down") && !p.frozen) {
        // UP AND DOWN, not left and right. The answers are stacked, which the
        // capture shows directly, and the two pad bits F0x8008642C tests — 4
        // and 6 — are UP and DOWN in the pad's own bit order, not left and
        // right. Claim cardgame-f8008642c-is-the-two-option-prompt calls them
        // "the left and right d-pad bits 4 and 6"; the bit numbers are right
        // and the names are wrong, and the screen agrees with the numbers.
        // The toggle is an exclusive-or against 1 — two answers, no more — and
        // it plays the duel's cursor-move sound (0x8004513E,
        // cardgame-cursor-move-sound-id).
        p.ask ^= 1;
        sfx?.play(DUEL_SOUND.cursor);
        return true;
      }
      if (k === "circle") {
        sfx?.play(DUEL_SOUND.confirm);
        if (p.ask === 0 && !p.frozen) {
          p.stage = "pick";
          armSelectorBanners();
          return true;
        }
        // Answer 1 is "No": the turn is passed.
        passTurn();
        return true;
      }
      if (k === "triangle" || k === "cross") {
        // Cancel FORCES the cursor to answer 1 and then answers with it, so
        // cancelling and choosing "No" are the same press.
        sfx?.play(DUEL_SOUND.cancel);
        p.ask = 1;
        passTurn();
        return true;
      }
      return true;
    }

    // State 4: the hand selector.
    if (p.stage === "pick") {
      if (k === "left" || k === "right") {
        // IT DOES NOT WRAP: a left step happens only when the cursor is above
        // zero and a right step only when it is below the last item; every other
        // press is swallowed, sound included.
        // — cardduel-picker-cursor-does-not-wrap-2026-08-21 (verified)
        const to = p.cursor + (k === "left" ? -1 : 1);
        if (to < 0 || to >= n) return true;
        p.cursor = to;
        sfx?.play(DUEL_SOUND.cursor);
        return true;
      }
      if (k === "circle") {
        // A card that cannot be picked in this phase, or whose effect has no
        // legal target, is refused rather than played.
        if (!playableSlot(p.cursor)) { sfx?.play(DUEL_SOUND.cancel); return true; }
        p.stage = "commit";
        sfx?.play(DUEL_SOUND.confirm);
        return true;
      }
      if (k === "triangle" || k === "cross") {
        // The picker returning -1 is a cancel, and it goes back to the
        // question rather than passing the turn outright.
        sfx?.play(DUEL_SOUND.cancel);
        p.stage = "ask";
        p.ask = 0;
        return true;
      }
      return true;
    }

    if (k === "triangle" || k === "cross") {
      // Declining at the commit is the take-back: back to the hand selector.
      sfx?.play(DUEL_SOUND.cancel);
      p.stage = "pick";
      armSelectorBanners();
      return true;
    }
    if (k === "circle") {
      // Commit, state 6. The card is played here and nowhere earlier, so
      // everything above it is undoable.
      sfx?.play(DUEL_SOUND.confirm);
      const slot = p.cursor;
      const playedId = d.player.hand[slot];
      c.play = null;
      // The card is committed here and its PROGRAM DOES NOT RUN YET: the turn's
      // plays resolve together when the turn ends, newest first.
      // — cardduel-effects-resolve-after-the-turn-2026-08-21
      raiseNamePlate("you", cardById(d.player.hand[slot])?.name,
                     cardById(d.player.hand[slot])?.effect ?? null);
      playProgramTurn(d, d.player, slot, EFFECTS, Math.random, { interactive: true });
      if (playedId != null) {
        notePlayed(playedId, (d.programTurns?.plays ?? 1) - 1);
      }
      dropHandSelectorChrome();
      selectorBannersUp = false;
      afterPlayerTurn();
      openEffectPickerIfPending();
      syncSprites();
      return true;
    }
    return true;
  }

  /** The run the cursor is sitting on, or null on a dimmed slot. */
  function pickedRun() {
    const d = c.duel;
    if (!c.picker || !d) return null;
    const slot = d.player.field[c.picker.cursor];
    if (!slot) return null;
    return c.picker.runs.find((r) => r.id === slot.id) ?? null;
  }

  function pickerKey(k) {
    const d = c.duel;
    const n = d.player.field.length;
    if (!n) { c.closeComboPicker(); return true; }
    if (k === "left" || k === "right") {
      // IT DOES NOT WRAP: a left step happens only when the cursor is above
      // zero and a right step only when it is below the last item; every other
      // press is swallowed, sound included.
      // — cardduel-picker-cursor-does-not-wrap-2026-08-21 (verified)
      const to = c.picker.cursor + (k === "left" ? -1 : 1);
      if (to < 0 || to >= n) return true;
      c.picker.cursor = to;
      sfx?.play(DUEL_SOUND.cursor);
      return true;
    }
    if (k === "circle") {
      // Selection is gated on the same flag the dimming uses: a dimmed slot
      // is not a legal target and the confirm is refused.
      if (c.picker.dimmed[c.picker.cursor]) return true;
      sfx?.play(DUEL_SOUND.confirm);
      c.closeComboPicker();
      return true;
    }
    if (k === "triangle" || k === "cross") {
      sfx?.play(DUEL_SOUND.cancel);
      c.closeComboPicker();
      return true;
    }
    return true;
  }

  // ---- the in-duel inspect menu ----------------------------------------
  //
  // Five rows over whatever picker is up: Hand, Field, Trash, Cancel,
  // Surrender. Three of them are read-only look-throughs, one puts the duel
  // back, one gives up. The model — the row order, which opcode each row
  // latches, the wrapping cursor, the field's three sections, the clamping
  // browse cursor and what surrender writes — is all in
  // engine/systems/card-inspect.ts with its citations. This is the surface.
  //
  // IT OPENS ON TRIANGLE, AND ONLY OVER A PICKER. That is the disc's own gate:
  // the pickers' pad arm polls logical 0xC and hands the duel to this machine
  // (cardgame.s:4741-4750, :32883). Triangle with nothing open still leaves the
  // card game, as it did before — the disc has no behaviour there to copy, so
  // the walker's own way out is left alone.
  //
  // WALKER GEOMETRY. The message-box table at 0x800A59B0 gives four full-width
  // bands at y 138 / 96 / 50 / 96, and window B's own box index is NOT decoded.
  // The menu is drawn as a band on box 1's origin, tall enough for five rows.
  // Nothing here claims that is where the disc puts it.
  // It is placed clear of window A rather than over it: the duel keeps BOTH
  // windows up at once, which is why the view installs two of them at all.
  // DECODED 2026-08-28, from the window's own painter (cardgame.s:22136-22141
  // for the text, :22123-22135 for the row list, :22113-22122 for the marker).
  // The five rows are ONE text object at (24,101) holding the bank entry's five
  // newline-separated words, and a separate marker sprite at (10, 101+14*row).
  // There is no frame and no band: the rows are drawn straight over the board.
  // Nothing collides with them because the picker's own window is CLOSED first
  // -- Triangle calls the view's close-prompt, waits for the window to finish
  // collapsing, and only then raises the menu (cardgame.s:3786-3790, then
  // exe-decomp/cardgame_c/F0x8008642c.c:112-131). Leaving the menu reopens that
  // window with the same message and cursor, which is why the machine saves
  // them on the way in and restores them on the way out.
  const INSPECT_BOX = { textX: 24, textY: 101, lineH: 14, markX: 10 };

  /** The five marker colours, rest first. Entries 2 and 4 are one palette on
   *  the disc, so they are one colour here too. WALKER COLOURS. */
  const MARKER_PULSE = [
    "rgb(168,168,184)", "rgb(200,200,216)", "rgb(232,232,248)",
    "rgb(255,255,255)", "rgb(232,232,248)",
  ];

  /** Which arm the menu was opened from, because the two put back different
   *  things when it closes. */
  let inspectFromAsk = false;

  /** True whenever the menu is up at all. The picker's own window is taken
   *  down before the five rows appear and put back when they go, so nothing of
   *  the picker is on screen while the menu owns it (see INSPECT_BOX). */
  function inspectOwnsScreen() {
    return !!c.inspect;
  }

  /** Whether Triangle would open the menu: a card picker has to be up. */
  function inspectAvailable() {
    const d = c.duel;
    if (!d || d.outcome || c.inspect) return false;
    if (c.coin || c.combo || c.setEnd || c.picker || c.effectPicker) return false;
    // The commit's Yes/No prompt is one of the walker's own steps; Triangle is
    // its No, not the inspect menu. (F0x800878B4 only raises the menu from the
    // browser itself, picker state 0xB.)
    if (c.summonConfirm) return false;
    // ONLY THE TWO ARMS THAT WERE DECODED. The Triangle poll was read on the
    // yes/no box (0x98) and the card browser (0x99/0x9A) — the walker's "ask"
    // and "pick" stages and the Summon Phase's browser. The later confirm and
    // commit steps are the walker's own three-step take-back and nothing says
    // the disc offers the menu there, so Triangle stays their cancel.
    if (c.play) return c.play.stage === "ask" || c.play.stage === "pick";
    return !!(d.summonTurns && !d.summonTurns.done);
  }

  function openInspect() {
    // The machine saves what the duel was doing and restores it on Cancel. Our
    // pickers keep their own state on `c`, so nothing has to be copied — the
    // menu simply sits on top and hands the pad back when it closes.
    c.inspect = { stage: "menu", row: 0, arm: null, cursor: 0, section: null, yes: 0 };
    // The disc takes the screen apart before the rows arrive, and THE TWO ARMS
    // TAKE DOWN DIFFERENT THINGS.
    //   From the yes/no question it closes that window and slides BOTH side
    //   panels off, then waits for them to stop (`F0x8008642c.c:112-131`).
    //   From a card picker it closes the six info banners and slides ONE panel
    //   off (`F0x80087edc.c:292-303`, its five `unkEB0` calls and `unkEBC`).
    // Neither hides the hand row itself — decoded 2026-08-28, so the rows are
    // drawn over the cards, which is why the text sits above them in z-order.
    inspectFromAsk = !!(c.play && c.play.stage === "ask");
    if (c.view) {
      if (inspectFromAsk) slideBothPanelsOut(c.view);
      else { for (let i = 0; i < 6; i++) closeBanner(c.view, i); slidePanelOut(c.view, 0); }
      openPromptB(c.view, 0, 0, 0, 0);
    }
    sfx?.play(DUEL_SOUND.confirm);
  }

  function closeInspect() {
    c.inspect = null;
    if (c.view) {
      closePromptB(c.view);
      closePrompt(c.view);
      if (inspectFromAsk) slideBothPanelsIn(c.view);
      else slidePanelIn(c.view, 0);
    }
    inspectFromAsk = false;
  }

  /** Back to the five rows, which is where every look-through ends. */
  function inspectBackToMenu() {
    const ins = c.inspect;
    ins.stage = "menu";
    ins.arm = null;
    ins.section = null;
    ins.cursor = 0;
    if (c.view) { closePrompt(c.view); openPromptB(c.view, 0, 0, ins.row, 0); }
  }

  /** The list a look-through is walking, as card ids. */
  function inspectList() {
    const d = c.duel, ins = c.inspect;
    if (!d || !ins) return [];
    if (ins.arm === 0x9b) return d.player.hand;
    if (ins.arm === 0x9c) return d.player.trash;
    if (ins.stage !== "field" || !ins.section) return [];
    // A field slot carries its card in `id`; the played stack is ids already.
    return fieldSectionCards(d, ins.section).map((e) => (typeof e === "number" ? e : e?.id));
  }

  const INSPECT_SECTION_TITLE = { you: "Your Field", opp: "Opponent Field", played: "Played" };

  function inspectConfirmRow(row) {
    const d = c.duel, ins = c.inspect;
    const key = INSPECT_ROWS[row]?.key;
    if (key === "hand" || key === "trash") {
      ins.arm = INSPECT_ROWS[row].op;
      ins.stage = "browse";
      ins.cursor = 0;
      return;
    }
    if (key === "field") {
      const first = firstFieldSection(d);
      if (!first) {
        // The ONLY empty guard in the whole menu: "No Cards in the Field."
        // Neither the hand nor the trash arm has one, so neither gets one here.
        ins.stage = "empty";
        if (c.view) openPrompt(c.view, 0, 0, 0, 1);
        return;
      }
      ins.stage = "field";
      ins.section = first;
      ins.cursor = 0;
      return;
    }
    if (key === "cancel") { closeInspect(); return; }
    // Surrender asks first.
    ins.stage = "surrender";
    ins.yes = 0;
    if (c.view) openPrompt(c.view, 0, 0, 0, 1);
  }

  function inspectKey(k) {
    const d = c.duel, ins = c.inspect;
    if (!d || !ins) return true;

    if (ins.stage === "menu") {
      if (k === "up" || k === "down") {
        ins.row = moveInspectCursor(ins.row, k === "up" ? -1 : 1);
        if (c.view) setPromptCursorB(c.view, ins.row);
        sfx?.play(DUEL_SOUND.cursor);
        return true;
      }
      if (k === "circle") {
        if (c.view) confirmPromptB(c.view);
        sfx?.play(DUEL_SOUND.confirm);
        inspectConfirmRow(ins.row);
        return true;
      }
      if (k === "cross") {
        // Cross forces the cursor onto Cancel and confirms it, which is the
        // same exit by a shorter road.
        ins.row = 3;
        sfx?.play(DUEL_SOUND.cancel);
        closeInspect();
        return true;
      }
      return true;
    }

    if (ins.stage === "browse" || ins.stage === "field") {
      const list = inspectList();
      if (k === "left" || k === "right") {
        // The browse cursor CLAMPS at both ends; a refused move is silent.
        const to = clampBrowseCursor(ins.cursor + (k === "left" ? -1 : 1), list.length);
        if (to === ins.cursor) return true;
        ins.cursor = to;
        sfx?.play(DUEL_SOUND.cursor);
        return true;
      }
      if (ins.stage === "field" && (k === "up" || k === "down")) {
        // Up and Down jump to another section, skipping any that is empty.
        const to = stepFieldSection(d, ins.section, k === "up" ? -1 : 1);
        if (to === ins.section) return true;
        ins.section = to;
        ins.cursor = 0;
        sfx?.play(DUEL_SOUND.cursor);
        return true;
      }
      if (k === "cross") {
        // Cross only. There is no confirm in a look-through: it is read-only.
        sfx?.play(DUEL_SOUND.cancel);
        inspectBackToMenu();
        return true;
      }
      return true;
    }

    if (ins.stage === "empty") {
      if (k === "circle" || k === "cross") {
        sfx?.play(DUEL_SOUND.cancel);
        inspectBackToMenu();
      }
      return true;
    }

    // ---- surrender ------------------------------------------------------
    if (k === "up" || k === "down") {
      ins.yes = ins.yes === 0 ? 1 : 0;
      sfx?.play(DUEL_SOUND.cursor);
      return true;
    }
    if (k === "cross") {
      // Cross forces No and confirms it, exactly as it forces Cancel above.
      ins.yes = 1;
      sfx?.play(DUEL_SOUND.cancel);
      inspectBackToMenu();
      return true;
    }
    if (k === "circle") {
      if (ins.yes !== 0) { sfx?.play(DUEL_SOUND.cancel); inspectBackToMenu(); return true; }
      sfx?.play(DUEL_SOUND.confirm);
      closeInspect();
      // The duel ends through its own teardown, not through the set machine:
      // the scores are left exactly as they stand.
      surrenderDuel(d, d.player);
      c.play = null;
      d.summonTurns = null;
      d.programTurns = null;
      return true;
    }
    return true;
  }

  /** The menu and whatever it opened, over everything else on the screen. */
  function drawInspect(ctx) {
    const d = c.duel, ins = c.inspect;
    if (!d || !ins) return;

    if (ins.stage === "browse" || ins.stage === "field") {
      const list = inspectList();
      const title = ins.stage === "field"
        ? INSPECT_SECTION_TITLE[ins.section]
        : (INSPECT_HEADING[ins.arm] === 25 ? ES.yourHand : ES.yourTrash);
      // The same browser the pickers use, with nothing selectable in it.
      drawHandBrowser(ctx, title, list.filter((id) => id != null),
                      clampBrowseCursor(ins.cursor, list.length));
      return;
    }

    if (ins.stage === "empty") {
      drawPrompt(ctx, [ES.noCardsField], c.view ? promptProgress(c.view) : undefined);
      return;
    }

    if (ins.stage === "surrender") {
      drawPlayBox(ctx, ES.areYouSure, ES.yesNo, ins.yes,
                  c.view ? promptProgress(c.view) : undefined);
      return;
    }

    // The five rows. The words are the game's own: its text bank entry 0x20 is
    // "Hand\nField\nTrash\nCancel\nSurrender", fetched by this window's own
    // painter (cardgame.s:22125, :22135) — decoded 2026-08-28, no longer a
    // guess. The marker blinks on the disc; the walker draws it steady, which
    // is a walker choice.
    withWipe(ctx, c.view ? promptBProgress(c.view) : WIDGET_SCALE_FULL, () => {
      INSPECT_ROWS.forEach((row, i) => {
        const y = INSPECT_BOX.textY + i * INSPECT_BOX.lineH;
        drawText(ctx, row.label, INSPECT_BOX.textX, y);
        if (i !== ins.row) return;
        // THE MARKER PULSES. It is the executable's colour-cycling class:
        // 32 frames at a rest colour, then four steps of 6 frames through a
        // five-entry palette list whose third and fifth entries are the same
        // one — so it brightens through three and comes back through one.
        // The shape and the frame counts are decoded; the colours are not,
        // because the palettes they name live in video memory.
        ctx.fillStyle = MARKER_PULSE[c.view ? markerPulsePhase(c.view) : 0];
        for (let r = 0; r < 5; r++) {
          ctx.fillRect(INSPECT_BOX.markX, y + 1 + r, 3 - Math.abs(r - 2), 1);
        }
      });
    });
  }

  /** The five-row menu, while it is up. See the block above. */
  c.inspect = null;

  c.handleKey = (rawKey) => {
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const k = asButton(rawKey);
    if (!c._open) return false;
    // The challenge screen and the folder chooser both run before there is a
    // duel at all, in that order.
    if (c.challenge) return challengeKey(k);
    if (c.chooser) return chooserKey(k);
    const d = c.duel;
    if (!d) return true;

    // A question a card's program has parked on takes priority over
    // everything: it is owed before the duel can go on.
    openEffectPickerIfPending();
    if (c.effectPicker) return effectPickerKey(k);
    if (c.picker) return pickerKey(k);
    // A PHASE BANNER OWNS THE PAD. Its update polls port 0 for Circle or Cross
    // and advances on either, with no timer of any kind — so while one is up
    // that press dismisses it and reaches nothing else, and every other press
    // is swallowed. `F0x80089580`; ledger
    // cardduel-phase-banners-are-one-routine-and-wait-for-a-button-2026-08-27.
    // A WAITING BEAT OWNS THE PAD. A phase banner's update polls port 0 for
    // Circle or Cross and advances on either with no timer of any kind, so
    // while one is up that press dismisses it and reaches nothing else and
    // every other press is swallowed (`F0x80089580`; ledger
    // cardduel-phase-banners-are-one-routine-and-wait-for-a-button-2026-08-27).
    //
    // IT IS NOT ONLY THE BANNERS. The card reveal 0x1B polls the same pad at
    // step 6 of its own machine and has no banner behind it, so the two cases
    // are one arm here. Only the banners have the step-1 precondition that
    // their windows must have finished opening; a reveal has no window to wait
    // for, and gating it on one deadlocked the duel -- found by
    // tools/verify_cardduel_reveal.mjs, 2026-08-28.
    const waiting = c.duel && duelBeatAwaitsButton(c.duel);
    const bannerWaiting = waiting && c.duel.beat.current >= 0xa0 && c.duel.beat.current <= 0xa6;
    if (announcing() || waiting) {
      if (k !== "circle" && k !== "cross") return true;
      // A banner has the step-1 precondition; anything else does not, and the
      // announcement flag can still be up behind it.
      if (announcing() && (bannerWaiting || !waiting)) {
        if (!announceSkippable()) return true;
        skipAnnouncement();
      } else {
        // The reveal's plate is ITS OWN, and the disc takes it down when the
        // beat ends. Leaving it up kept the screen owning the frame and the
        // duel never moved on -- the second half of the deadlock this verifier
        // found.
        const was = c.duel.beat.current;
        dismissBeat(c.duel);
        if (was === 0x1b) { dropExtraSlot(EXTRA_SLOT_BATTLE); if (c.view) clearReveal(c.view); }
      }
      sfx?.play(DUEL_SOUND.confirm);
      return true;
    }

    // THE INSPECT MENU OWNS THE PAD while it is up, and Triangle over a card
    // picker is what opens it. See the block above and card-inspect.ts.
    if (c.inspect) return inspectKey(k);
    if (k === "triangle" && inspectAvailable()) { openInspect(); return true; }

    // The Start Phase ceremony owns the pad from the moment it opens: the
    // original's mode 3 polls the pad service itself and nothing else runs.
    if (c.coin) return coinKey(k);
    // The fusion beat owns the pad while it runs: the plate takes a button
    // early and nothing else on the screen may act.
    if (c.combo) return comboKey(k);
    // A set being awarded owns the pad until its result window is dismissed —
    // including on the last set, so the duel's own result never appears while
    // the counter is still rolling.
    if (c.setEnd) return setEndKey(k);

    if (d.outcome) {
      if (k === "circle" || k === "triangle") {
        sfx?.play(DUEL_SOUND.cancel);
        // The result window is dismissed: fade the screen out on the duel's own
        // frames, then close. startCloseWash guards the once-per-duel-end.
        startCloseWash();
      }
      return true;
    }

    // The combo picker is on CROSS so Circle stays free to advance the duel.
    // NOT DECODED: the duel screen has no decoded button legend, and the
    // walker had this on the `c` key, which is now Cross — so the keystroke a
    // player already knows is unchanged.
    if (k === "cross" && !c.play && c.comboPickerAvailable()) {
      c.openComboPicker();
      sfx?.play(DUEL_SOUND.confirm);
      return true;
    }

    // The Load and Compile phases are played a turn at a time, so the card
    // that gets played is the one YOU choose. The announcement is dismissed
    // first, exactly as every other phase.
    const phaseKey = phase(d).key;
    if (phaseKey === "load" || phaseKey === "compile") {
      if (announcing()) {
        if (k !== "circle") return true;
        if (!announceSkippable()) return true;
        skipAnnouncement();
        sfx?.play(DUEL_SOUND.confirm);
        return true;
      }
      // The board refuses a PLAY while cards are still animating — the original
      // ORs 1 into the screen's `unk54` for every sprite mid-animation — but the
      // hand cursor still moves, because the selector is open the whole time.
      if (boardBusy() && k !== "left" && k !== "right") return true;
      if (!d.programTurns) {
        // Nothing to press yet. The negotiation is opened by ceremony opcode
        // 0x98, not by a button — and a press used to open it here, which was
        // wrong twice over once the duel ran its own frames: it started the
        // phase while the PREVIOUS phase's last beat still owned the screen
        // (phase(d) names the next phase as soon as that beat is issued), and
        // it left 0x98 arriving to turns it had not opened.
        return true;
      }
      if (c.play) return playKey(k);
      // The phase is over — or it is the opponent's turn and it has already
      // taken it. Circle moves the duel on.
      if (k === "circle") {
        // Nothing to confirm: the negotiation's own beats (0x99 and then 0x12)
        // close the phase as soon as both sides have finished their turns.
        return true;
      }
      // Either the back bit (0x4000) or the third face bit closes here; the
      // back bit is the one the rest of the game uses, so it is accepted first.
      if (k === "cross" || k === "triangle") { sfx?.play(DUEL_SOUND.cancel); close(); return true; }
      return true;
    }

    // ---- the SUMMON PHASE, played a turn at a time -----------------------
    // It used to resolve itself: one confirm and the AI filled your field. The
    // disc plays it — mode 6 latches effect opcode 0x9A, whose enter
    // F0x80086D78 marks every hand entry usable or not and opens the card
    // browser over your hand, and the phase carries its own on-screen legend,
    // escardgm 0x24:
    //
    //        "[cross] Select [square] Summon"
    //
    // so the selection moves on cross and SQUARE is what places a Digimon. You
    // keep the turn and summon as many as you can afford.
    //
    // HOW THE TURN ENDS - decoded 2026-09-14 from the original assembly.
    // Square (logical 0xF) sets picker state 6 unconditionally (F0x800878B4 at
    // cardgame.s 0x4c90-0x4cc8), whatever is marked. State 6 runs its 0x13-frame
    // commit animation and lands in state 7, the "Put in Field? Yes/No" prompt,
    // whose answer word +0x440 starts at 0 (Yes) because the browser opener
    // F0x80086D78 zeroes it. There (F0x80087EDC, cardgame.s 0x5bd8-0x5d74):
    //   * Up/Down (4/6) toggle the answer;
    //   * Circle (0xD) finishes: answer Yes -> state 8, which after 0x2E frames
    //     returns 1 (the picker's done value); answer No -> state 9, which after
    //     0x1F frames returns to the picker (state 3);
    //   * Cross (0xE) writes answer = No and also returns to the picker;
    //   * Triangle is not read at all here.
    // The picker itself never commits: the Summon Phase driver F0x800A0B80
    // calls the per-side commit method +0x818 (F0x800A0754) after the picker
    // returns, so the marked set is committed on the Yes answer only. Triangle
    // (0xC) in the picker body sets state 0xB, a short flash that loops back to
    // the picker (cardgame.s 0x609c-0x6134), so it does not end the turn either.
    if (phase(d).key === "summon" && !announcing()) {
      if (!d.summonTurns) {
        beginSummonTurns(d);
        runSummonTurns(d, agents, d.player);
        c.handCursor = 0;
        c.summonMarks = new Set();
        c.summonConfirm = null;
        syncSprites();
        return true;
      }
      if (summonTurnSide(d) === d.player) {
        const n = d.player.hand.length;
        if (boardBusy()) return true;

        // THE COMMIT CONFIRM. Square on a marked set raises "Put in Field?
        // Yes/No"; Yes runs the disc's commit (duel method +0x818) over the
        // marked entries. Observed live 2026-09-12 — see the capture.
        if (c.summonConfirm) {
          if (k === "up" || k === "down") {
            c.summonConfirm.answer ^= 1;
            sfx?.play(DUEL_SOUND.cursor);
            return true;
          }
          // CROSS IS "No" AT THIS PROMPT, not a second confirm. State 7 writes
          // the answer word +0x440 = 1 and goes to state 9, which returns to the
          // picker with the marks still set (cardgame.s 0x5d28-0x5d74).
          if (k === "cross") {
            c.summonConfirm.answer = 1;
            c.summonConfirm = null;
            sfx?.play(DUEL_SOUND.cancel);
            return true;
          }
          // Circle is the finish button: Yes (the default answer) commits the
          // marked set and ends the turn; No drops back to the picker. Triangle
          // is not read at this prompt, so it is swallowed below.
          if (k === "circle") {
            if (c.summonConfirm.answer === 0) {
              const placed = commitMarkedSummons(d, d.player);
              sfx?.play(placed ? DUEL_SOUND.summon : DUEL_SOUND.cancel);
              c.summonConfirm = null;
              c.summonMarks = new Set();
              c.handCursor = Math.min(c.handCursor, Math.max(0, d.player.hand.length - 1));
              // The disc's resolver calls the commit once per side
              // (F0x800A0754 from F0x800A0BE8/F0x800A0C38), so a commit ends
              // this side's summon turn; the phase then runs the opponent.
              endSummonTurn(d, d.player);
              runSummonTurns(d, agents, d.player);
            } else {
              sfx?.play(DUEL_SOUND.cancel);
              c.summonConfirm = null;
            }
            syncSprites();
            return true;
          }
          return true;
        }

        if (!c.summonMarks) c.summonMarks = new Set();
        c.handCursor = Math.min(c.handCursor, Math.max(0, n - 1));
        // It stops at both ends — cardduel-picker-cursor-does-not-wrap.
        if (k === "left" || k === "right") {
          const to = c.handCursor + (k === "left" ? -1 : 1);
          if (to < 0 || to >= n) return true;
          c.handCursor = to;
          sfx?.play(DUEL_SOUND.cursor);
          return true;
        }
        // CIRCLE MARKS, not Cross. F0x800878B4 toggles the mark on logical
        // button 0xD; the cursor moves on logical 4 and 6, which ARE hardware Up
        // and Down, so the logical index is the standard pad bit and 0xD is
        // Circle (ledger cardduel-phase-banners-are-one-routine-and-wait-for-a-
        // button-2026-08-27, notes; submarimon-buoyancy-decoded-2026-07-28.md:
        // 0x2000 Circle, 0x4000 Cross). The bank's own legend "[cross] Select
        // [square] Summon" is drawn verbatim elsewhere but disagrees with the
        // routine; the routine wins.
        if (k === "circle") {
          // F0x80087458 reserves/refunds through F0x8008735C at the mark,
          // not at confirmation. The engine owns both marks and energy so
          // affordability, the HUD and the eventual commit see one state.
          const result = toggleSummonMark(d, d.player, c.handCursor);
          c.summonMarks = d.summonTurns.marks ?? new Set();
          sfx?.play(result === 1 ? DUEL_SOUND.cursor : DUEL_SOUND.cancel);
          return true;
        }
        // SQUARE raises the commit prompt, whether or not anything is marked
        // (F0x800878B4 sets picker state 6 unconditionally). The turn is ended
        // by Circle-Yes at that prompt, not by Square itself.
        if (k === "square") {
          c.summonConfirm = { answer: 0 };
          sfx?.play(DUEL_SOUND.confirm);
          return true;
        }
        // Nothing else acts in the picker: the turn ends only through the
        // Square -> Circle-Yes chain decoded above. Triangle (0xC) flashes
        // state 0xB and loops back to the picker rather than ending anything.
        return true;
      }
      // Both sides are done: the ordinary confirm steps the phase on.
    }

    if (k === "circle") {
      // The original refuses input while the board is animating (it ORs 1 into
      // the screen's `unk54` for every sprite that is mid-animation); the walker
      // does the same rather than letting a phase step cut a summon in half.
      if (boardBusy()) return true;
      // The first confirm dismisses the phase announcement; the phase itself
      // runs on the next one, so the banner is never cut out from under a
      // phase that has already started acting.
      // The announcement is skippable, but not immediately: before 0x14 units
      // the press does nothing at all.
      if (announcing()) {
        if (!announceSkippable()) return true;
        skipAnnouncement();
        sfx?.play(DUEL_SOUND.confirm);
        return true;
      }
      // Never step past an outstanding choice.
      if (awaitingCardChoice(d)) { openEffectPickerIfPending(); return true; }
      // The Start Phase does not simply step: it plays the Calumon draw first,
      // and the pick the player makes there is what settles the phase.
      if (phase(d).key === "start") {
        sfx?.play(DUEL_SOUND.confirm);
        openCoinCeremony();
        return true;
      }
      sfx?.play(DUEL_SOUND.confirm);
      // THE COMBOS ARE SHOWN BEFORE THE ATTACK. The Battle-Phase machine's
      // states 1 and 2 scan side 0 and then side 1 and issue one fusion
      // sequence per run, and state 9 — the attack — is only reached once both
      // scans have returned -1. So the beat owns the pad first and the phase
      // resolves when it is done.
      // Nothing else is confirmed here. The duel advances on its own frames:
      // the fusion beat opens ahead of the attack, the attack's five beats take
      // their own frames, and the set-end ceremony follows the award.
      return true;
    }
    if (k === "cross" || k === "triangle") { sfx?.play(DUEL_SOUND.cancel); close(); return true; }
    return true;
  };

  // ---- the card sprite layer --------------------------------------------
  // Every card on the board is one of the decoded 0x4C-byte animation sprites
  // (engine/systems/card-animation.ts, decoded from F0x8009b890 and the command
  // entry points at 0x8009C510..0x8009CE94). The walker keeps one sprite per
  // card that is on the board, keyed by side and card id, and re-issues the
  // original's own animation commands when the duel model changes underneath.
  //
  // The deal, the flip wave, the opponent hand's collapse, the in-place reveal
  // and the three row positions are now the captured ones — see the module note
  // and the claims cited at each site. What is still the walker's: the summon,
  // the battle phase's reaction (a shake for the loser, an effect run for the
  // winner) and the retire-to-trash slide. The capture logs pool slots and
  // geometry, so it cannot say which model event drove a given sprite, and only
  // a won duel was recorded.

  /** live sprites, keyed `${side}:${zone}:${cardId}` */
  c.sprites = new Map();
  /** cards whose sprite should be dropped once its animation finishes */
  const retiring = new Set();

  const fx = (px) => px * 256;          // pixels -> the 8.8 the sprites use
  const toPx = (v) => v >> 8;           // and back, the way the original draws

  // The board's three rows, from the runtime capture
  // (cardduel-board-rows-38-97-156): the opponent's hand at y=38, ONE shared
  // centre row at y=97, the player's hand at y=156, both hands starting at
  // x=24 and stepping by the decoded 41px cardFanOut pitch. The decoded static
  // board-slot table 0x800A5978 lies on that same centre row.
  const ROWS = {
    oppHand: DUEL_BOARD.oppHandY,
    centre: DUEL_BOARD.centreY,
    hand: DUEL_BOARD.handY,
  };

  /** Where card `i` of a row of `count` sits, in 8.8. */
  function slotPos(row, count, i) {
    return cardRowSlot(ROWS[row], count, i);
  }

  /** The field sits on the centre row at the decoded board slots. Two sides
   *  share one row, so they split it: the player takes the slots from the left,
   *  the opponent from the right. WALKER PLACEMENT — the capture establishes
   *  the row and the slot table, not how two fields divide them. */
  function fieldPos(sideKey, count, i) {
    const slots = DUEL_BOARD.boardSlots;
    const n = slots.length;
    const slot = sideKey === "you"
      ? slots[Math.min(i, n - 1)]
      : slots[Math.max(n - 1 - i, 0)];
    return [fx(slot[0]), fx(slot[1])];
  }

  /** The trash pile, from the DECODED per-player HUD record. Note the deal does
   *  NOT come out of the deck pile -- nothing emerges from the pile coordinates
   *  at any point in either captured duel. */
  function pilePos(sideKey, which) {
    const rec = UI?.players[sideKey === "you" ? 0 : 1];
    if (!rec) return [fx(160), fx(120)];
    const p = which === "trash" ? rec.pile_b : rec.pile_a;
    return [fx(p[0]), fx(p[1])];
  }

  /** The two-sided name banner (F0x80099440).
   *
   *  The endpoints are decoded: side 0 travels 0x8D -> 0xF1 and side 1 travels
   *  0 -> -0x64, both covering 0x64 but in opposite senses — so the two players'
   *  banners enter from OPPOSITE edges rather than mirroring each other. The
   *  edge/extent pair moves with them, always 0x27 apart. All of that lives in
   *  engine/systems/card-animation.ts; it had been decoded and implemented but
   *  never driven by this screen, which drew a static band instead.
   *
   *  THE DURATIONS ARE THE ARM ROUTINES' OWN LITERALS (read 2026-09-14, gap K5):
   *  the both-panels-in arm F0x8009C2D0 writes 0x14 = 20 into the panel's +0x02
   *  divisor, and the both-panels-out arm F0x8009C350 writes 0xA = 10
   *  (cardgame.s 26001 and 26032); the interpolator F0x80099440 divides by that
   *  field, and its call sites pass only the side. The one-sided flat arms
   *  F0x8009C3C0/F0x8009C438 use 10 in / 5 out, but this screen slides BOTH
   *  banners, so it takes the both-sided pair. */
  const BANNER_SLIDE_IN_FRAMES = 20;
  const BANNER_SLIDE_OUT_FRAMES = 10;
  const banners = [createBannerSlide(0), createBannerSlide(1)];
  let bannerShownFor = null;

  /** The opponent's hand is hidden after the deal collapse and re-shown when
   *  it next acts. Raw run-2 dump `cardgame_s5_run2_modes6plus.txt`: slot 06
   *  goes to state 0 at frame 611, then at frame 2055 (the Summon Phase) it
   *  ramps sx 820 -> 4096 over `anim 2 dur 10` — the same in-place reveal the
   *  player's rows use. One reveal per set, staggered by REVEAL_STAGGER. */
  let oppHandRevealSet = null;
  function revealOppHandOnSummon() {
    const d = c.duel;
    if (!d || d.outcome || phase(d).key !== "summon") return;
    if (oppHandRevealSet === d.set) return;
    oppHandRevealSet = d.set;
    let i = 0;
    for (const [key, rec] of c.sprites) {
      if (!key.startsWith("opp:hand:")) continue;
      later(i * REVEAL_STAGGER, () => {
        if (!c.sprites.has(key)) return;
        rec.sprite.scaleX = 0;
        scaleCard(rec.sprite, REVEAL_DURATION, SCALE_ONE, SCALE_ONE);
      });
      i += 1;
    }
  }

  /** Slide both banners in when a phase announces itself, and out when the
   *  announcement is dismissed. */
  function updateBanners() {
    const d = c.duel;
    const key = !d || d.outcome ? null : (announcing() ? phase(d).key : null);
    if (key === bannerShownFor) return;
    const phaseId = key ? BannerPhase.slideIn : BannerPhase.slideOut;
    const frames = phaseId === BannerPhase.slideIn
      ? BANNER_SLIDE_IN_FRAMES : BANNER_SLIDE_OUT_FRAMES;
    banners.forEach((b) => startBannerSlide(b, phaseId, frames));
    bannerShownFor = key;
  }

  function stepBanners() {
    updateBanners();
    banners.forEach((b, i) => stepBannerSlide(b, i, 1));
  }

  /** How far along its travel a side's banner is, 0 hidden .. 1 shown. Used to
   *  slide the drawn plate; the decoded endpoints supply the geometry. */
  function bannerProgress(side) {
    const p = BANNER_SIDES[side];
    const span = p.shown - p.hidden;
    if (span === 0) return 1;
    return Math.max(0, Math.min(1, (banners[side].pos - p.hidden) / span));
  }

  /** Deferred work, in frames. The deal is a staggered wave and its flip wave
   *  waits for the last landing, so the choreography needs a clock rather than
   *  a chain of per-sprite callbacks. */
  const scheduled = [];
  function later(delay, fn) {
    scheduled.push({ at: c.ticks + delay, fn });
  }
  function runScheduled() {
    for (let i = scheduled.length - 1; i >= 0; i -= 1) {
      if (scheduled[i].at > c.ticks) continue;
      const { fn } = scheduled[i];
      scheduled.splice(i, 1);
      fn();
    }
  }

  const keyOf = (sideKey, zone, id, i) => `${sideKey}:${zone}:${id}:${i}`;

  function spawnAt(key, cardId, x, y, kind) {
    const s = createCardSprite(c.sprites.size, x, y);
    s.renderKind = kind;
    const rec = { sprite: s, cardId, effectT: 0 };
    c.sprites.set(key, rec);
    return rec;
  }

  /** Deal a whole hand as the original does it (cardduel-deal-enters-from-
   *  offscreen-right, cardduel-flip-wave-follows-last-landing).
   *
   *  Card `i` starts DEAL_STAGGER frames after card `i - 1` and crosses in
   *  DEAL_DURATION frames, growing from nothing on both axes. The flip wave
   *  begins only once the LAST card has landed, then runs one card at a time in
   *  the same stagger. The player's cards flip face up; the opponent's are
   *  never flipped, and instead squeeze edge-on and stay that way. */
  /** The rightmost hand column, x=229, on the centre row: the waypoint every
   *  drawn card passes through. Decoded 2026-08-26 by correlating sprite
   *  destinations in the rig trace against the latched opcode — see
   *  docs/research/card/cardduel-animation-atlas-2026-08-26.md. */
  const DRAW_WAYPOINT_X = 229;

  /** Opcodes 0x53 / 0x55 — a card DRAWN into a hand mid-duel.
   *
   *  This is NOT the deal. The deal enters face-down from off the right edge
   *  straight onto its hand slot. A draw is a TWO-LEG, FACE-UP move: the card
   *  goes first to (229, 97) — the rightmost column on the centre row, where the
   *  deck sits — and only then down into its own hand slot on y=156. Six such
   *  moves in the captured duel, always paired, always face-up, always mode 07,
   *  under 0x53 (four) and 0x55 (two):
   *
   *      slot 3  (229,97) -> (147,156)      slot 4  (229,97) -> (188,156)
   *      slot 5  (229,97) -> (229,156)
   *
   *  Each leg is DEAL_DURATION. The walker used to put the card straight into
   *  the slot face-down, which is what produced the whole `renderKind disc=1
   *  walker=2` divergence (337 samples) and the `pdy disc=97 walker=156` one
   *  (72 samples) in tools/diff_cardduel_sprites.mjs.
   *
   *  WALKER INFERENCE, and it is marked because it is one: the disc distinguishes
   *  the deal from a draw by the OPCODE it is running, and this file's sprite
   *  layer does not see the opcode. It distinguishes them by shape instead — a
   *  lone card arriving in a hand that already held cards is a draw; a batch is
   *  the deal. That matches every case in the capture but is not itself decoded. */
  function drawIntoHand(rec, x, y) {
    const s = rec.sprite;
    s.renderKind = CardRenderKind.digimon;
    moveCard(s, DEAL_DURATION, fx(DRAW_WAYPOINT_X), fx(ROWS.centre), { scaleFrom: 0 });
    rec.onArrive = () => {
      moveCard(s, DEAL_DURATION, x, y);
      sfx?.play(DUEL_SOUND.land);
    };
  }

  /** THE 0x53 / 0x55 CORRECTION, 2026-08-27.
   *
   *  The block above calls these two "a card DRAWN into a hand". They are not.
   *  Both reach the same pair of handlers and differ only in one number — the
   *  card each one brings — and that card is fixed: 0x53 summons Goburimon and
   *  0x55 summons Hagurumon. The handler reads the card's printed AP and HP and
   *  writes them into a BOARD slot, then counts that side's occupied slots up by
   *  one. Nothing about a hand is touched.
   *
   *  The two-leg move itself was read correctly: the card does come in at the
   *  deck's corner of the centre row and only then travel to where it lands.
   *  What was wrong was where it lands and what put it there. Now that the beat
   *  is actually issued (see the beat lane in engine/systems/card-battle.ts) the
   *  screen no longer has to guess from the shape of the move — the opcode says
   *  so — and `tokenEntry` below is that entrance, aimed at the board.
   *
   *  The hand heuristic under `dealt.length === 1` is left alone: it is a
   *  separate question, still undecided, and removing it here would silently
   *  change how an ordinary refill looks. */
  let tokenEntry = 0;

  /** One summoned token's entrance: in at the deck's corner, then out to its
   *  slot. Both legs are the deal's own length, which is what the capture
   *  measured for the pair. */
  function summonTokenEntry(rec, x, y) {
    const s = rec.sprite;
    s.renderKind = CardRenderKind.digimon;
    s.x = fx(DRAW_WAYPOINT_X);
    s.y = fx(ROWS.centre);
    s.scaleX = 0;
    s.scaleY = 0;
    scaleCard(s, EXTRA_GROW, SCALE_ONE, SCALE_ONE);
    rec.onArrive = () => {
      moveCard(s, DEAL_DURATION, x, y);
      sfx?.play(DUEL_SOUND.summon);
      rec.onArrive = () => { holdCard(s); sfx?.play(DUEL_SOUND.hold); };
    };
  }

  /** Opcodes 0x2F, 0x30 and 0x31 — CORRECTED 2026-08-27: they are SENTENCES.
   *
   *  Every prior gloss in this repository read these three as presentation — "a
   *  flourish, a hold, the summon flash" — and this file briefly played a card
   *  effect for 0x31. None of that is right. All three call one routine and
   *  differ only in the number they hand it, and that number is a MESSAGE ID,
   *  not an effect index. Against the duel's own string bank they are:
   *
   *      0x2F  "Pick a Card to Trash."
   *      0x30  "No Cards in Deck."
   *      0x31  "There are too many Digimon cards in field.
   *             Select which to throw away."
   *
   *  Each fits where its programs put it. The card that supposedly "plays a
   *  summon flash" before a board picker, a destroy and a gap-close is in fact
   *  asking which Digimon to throw away because the field is full. It is the
   *  make-room question, and it had been read as a sparkle.
   *
   *  Three independent things agree on the mechanism: the enter handlers forward
   *  the id to the method at view+0xEE4; that slot is named `openPrompt` in the
   *  animation atlas, decoded by a separate pass, as a 12-tick wipe with sound
   *  0x00040019; and PROMPT_OPEN_DURATION here is already 12.
   *
   *  The update then waits for the window to finish opening, waits for Circle or
   *  Cross with NO timeout, and waits for it to close again — so the beat really
   *  is input-gated, and on the disc a player who never presses never leaves it.
   *  The one way out without a button is the caller's: when the play-history
   *  side byte is set, both halves are skipped and the beat completes at once —
   *  which 0x2F and 0x31 do and 0x30 does not, so "No Cards in Deck." is shown
   *  to whoever is playing either way. */
  function raiseDuelMessage(op) {
    const msg = DUEL_MESSAGE[op];
    if (c.view && msg != null) openPrompt(c.view, msg, 0, 0, 1);
  }

  /** Pooled extra card, slot 0xF. Targeting 0x70..0x82, the 0x12/0x13 pair,
   *  0x83/0x84 and 0x8D all `placeSlot(0xF, 0xE500, 0x6100)` — (229, 97) in
   *  pixels — then `scaleSlot(..., 8, 0x1000, 0x1000)`. Battle opening 0x19
   *  uses slot 0x11 at (131, 97) instead. Keys are `extra:N` so syncSprites
   *  does not send them to a trash pile. */
  const EXTRA_SLOT_F = 0xF;
  const EXTRA_SLOT_BATTLE = 0x11;
  const BATTLE_EXTRA_X = 0x83;
  const EXTRA_GROW = 8;
  const BATTLE_EXTRA_GROW = 0xA;
  const EXTRA_SQUASH = 4;
  /** F0x80092638 moveCard duration on slot 0xF after the grow. */
  const EXTRA_SECOND_LEG = 0xA;
  /** Overlay table 0x800A5910, 8-byte rows of two s32 8.8 coords, indexed by
   *  plays-this-turn. Words dumped 2026-08-26: 0x5100/0x6100, 0x8300/0x6100,
   *  0xB500/0x6100 → (81, 97), (131, 97), (181, 97). Row 0 is the persistent
   *  centre card at DUEL_BOARD.centreX.
   *  CENTRE_X81_SKIP: 0x5A enter is setCounter-only; 0x98 is the play
   *  negotiation; 0x70 CA4C places slot 0xF at (229, 97). Those captured
   *  x=81 moves are not a second sprite those enters issue. 0x12's
   *  second-leg row 0 is (81, 97). */
  const PLAY_TABLE = [
    [DUEL_BOARD.centreX, DUEL_BOARD.centreY],
    [0x83, DUEL_BOARD.centreY],
    [0xB5, DUEL_BOARD.centreY],
  ];
  function playTableDest() {
    const i = lastPlaySnap
      ? Math.max(0, Math.min(PLAY_TABLE.length - 1, lastPlaySnap.index))
      : 0;
    return PLAY_TABLE[i];
  }
  const extraKey = (slot) => `extra:${slot}`;
  const isExtraKey = (key) => key.startsWith("extra:");

  /** Last committed play. tickDuel nulls programTurns on 0x12 before
   *  beatStarted, so extraCardId must not read the live turns. Index is the
   *  play slot at commit time (0, 1, 2) — not the post-increment count. */
  let lastPlaySnap = null;
  function snapshotPlaysIfLive() {
    const t = c.duel?.programTurns;
    if (!t?.history?.length) return;
    const play = t.history[t.history.length - 1];
    lastPlaySnap = {
      cardId: play.cardId,
      index: Math.max(0, Math.min(PLAY_TABLE.length - 1, t.plays - 1)),
      side: play.side,
    };
  }
  function notePlayed(cardId, index) {
    if (cardId == null) return;
    lastPlaySnap = {
      cardId,
      index: Math.max(0, Math.min(PLAY_TABLE.length - 1, index)),
      side: c.duel?.player,
    };
  }

  /** Card id the extra slot is showing. Snap only — live history is already
   *  gone when 0x12 starts, and playedThisPhase would respawn a Load extra
   *  on Compile's 0x12. */
  function extraCardId() {
    return lastPlaySnap ? lastPlaySnap.cardId : null;
  }

  function dropExtraSlot(slot, squashDur = 0) {
    const key = extraKey(slot);
    const rec = c.sprites.get(key);
    if (!rec) return;
    if (squashDur > 0) {
      scaleCard(rec.sprite, squashDur, 0, SCALE_ONE);
      rec.onArrive = () => {
        despawnCard(rec.sprite);
        c.sprites.delete(key);
      };
      return;
    }
    despawnCard(rec.sprite);
    c.sprites.delete(key);
  }

  function closeAllPlates() {
    if (!c.view) return;
    c.view.plates.forEach((p, i) => {
      if (p.state !== 0) closePlate(c.view, i);
    });
  }

  function dropExtras() {
    dropExtraSlot(EXTRA_SLOT_F);
    dropExtraSlot(EXTRA_SLOT_BATTLE);
    closeAllPlates();
  }

  function raiseExtraSlot(slot, px, py, cardId, growDur) {
    if (cardId == null) return;
    dropExtraSlot(slot, 0);
    const rec = spawnAt(extraKey(slot), cardId, fx(px), fx(py), CardRenderKind.digimon);
    rec.sprite.scaleX = 0;
    rec.sprite.scaleY = 0;
    scaleCard(rec.sprite, growDur, SCALE_ONE, SCALE_ONE);
    return rec;
  }

  /** 0x12 / 0x13: grow at the waypoint, then F0x80092638 moves slot 0xF over
   *  10 frames to PLAY_TABLE[plays] — (81, 97) for the first play.
   *  Consumes lastPlaySnap so a later 0x12 with no new play (Compile pass
   *  after a Load play) does not respawn the previous extra. */
  function raisePlayTableExtra() {
    const snap = lastPlaySnap;
    lastPlaySnap = null;
    if (!snap) {
      dropExtraSlot(EXTRA_SLOT_F, 0);
      return;
    }
    // The plate under the played slot wipes in as the card lands (F0x8009BE40
    // via view+0xEA4, called by the 0x12/0x13 move F0x80092638 with the play
    // count and the acting side; the drawer clip is payload + 6). Claim
    // centre-plate-modes-are-open-close-plates-on-the-played-slots-2026-09-14.
    if (c.view) {
      const side = snap.side === c.duel?.opponent ? 1 : 0;
      openPlate(c.view, snap.index, side);
    }
    const dest = PLAY_TABLE[snap.index] ?? PLAY_TABLE[0];
    const rec = raiseExtraSlot(EXTRA_SLOT_F, DRAW_WAYPOINT_X, ROWS.centre,
                               snap.cardId, EXTRA_GROW);
    if (!rec) return;
    rec.onArrive = () => {
      moveCard(rec.sprite, EXTRA_SECOND_LEG, fx(dest[0]), fx(dest[1]));
    };
  }

  /** CA4C / 92438 / 8CE0C / 8AD98 enter: reset HUD, slide both strips in,
   *  extra card grows at the draw waypoint. */
  function raiseWaypointExtra() {
    if (!c.view) return;
    resetPanels(c.view);
    slideBothPanelsIn(c.view);
    const id = extraCardId();
    if (id != null) {
      raiseExtraSlot(EXTRA_SLOT_F, DRAW_WAYPOINT_X, ROWS.centre, id, EXTRA_GROW);
    }
  }

  /** CB5C / 8CFDC cancel: both strips out, extra slot squashes on X over 4. */
  function squashWaypointExtra() {
    if (c.view) slideBothPanelsOut(c.view);
    dropExtraSlot(EXTRA_SLOT_F, EXTRA_SQUASH);
  }

  /** 0x19 / 0x1A enter F0x8009403c: placeSlot(0x11, 0x8300, 0x6100), default
   *  face Calumon, then the update grows it over 10 frames. */
  /** The four panel numbers while a card reveal's ramp is running, or a pair of
   *  nulls at every other moment. */
  function revealOverride(side) {
    const n = c.view ? revealNumbers(c.view) : null;
    if (!n || !c.duel) return { ap: null, hp: null };
    return side === c.duel.player
      ? { ap: n.playerAp, hp: n.playerHp }
      : { ap: n.opponentAp, hp: n.opponentHp };
  }

  function raiseBattleExtra() {
    raiseExtraSlot(EXTRA_SLOT_BATTLE, BATTLE_EXTRA_X, ROWS.centre,
                   CALUMON_CARD_ID, BATTLE_EXTRA_GROW);
  }

  /** 0x9E enter F0x80088f0c: resetPanels + slideBothPanelsIn. The update's
   *  per-slot flip sweep is not issued here — field cards are already face-up
   *  and flipping them would show their backs. */
  function raiseBoardSweep() {
    if (!c.view) return;
    resetPanels(c.view);
    slideBothPanelsIn(c.view);
  }

  /** 0x99 / 0x9A enter F0x80086d78: both strips snap off, then the player's
   *  strip slides back in. 87EDC then opens the six info banners at
   *  (0, 66), (130, 165), (134, 49), (130, 144), (253, 144), (0, 20). */
  function raiseHandSelector() {
    if (!c.view) return;
    resetPanels(c.view);
    slidePanelIn(c.view, 0);
    openBanner(c.view, 0, 0, 0, 0, 0x42);
    openBanner(c.view, 2, 1, 0, 0x82, 0xA5);
    openBanner(c.view, 4, 2, 0, 0x86, 0x31);
    openBanner(c.view, 3, 1, 0, 0x82, 0x90);
    openBanner(c.view, 1, 3, 0, 0xFD, 0x90);
    openBanner(c.view, 5, 4, 0x24, 0, 0x14);
  }

  let selectorBannersUp = false;
  function armSelectorBanners() {
    if (selectorBannersUp) return;
    raiseHandSelector();
    selectorBannersUp = true;
  }
  function selectorWantsBanners() {
    const d = c.duel;
    if (c.play?.stage === "pick") return true;
    if (!d) return false;
    return !c.play && !c.picker && !c.effectPicker && !c.setEnd
      && !d.outcome && !announcing() && phase(d).key === "summon"
      && !!d.summonTurns && summonTurnSide(d) === d.player;
  }

  function dropHandSelectorChrome() {
    selectorBannersUp = false;
    if (!c.view) return;
    for (let i = 0; i < 6; i++) closeBanner(c.view, i);
  }

  function dealHand(batch, mine) {
    batch.forEach(([rec, x, y], i) => {
      later(i * DEAL_STAGGER, () => {
        moveCard(rec.sprite, DEAL_DURATION, x, y, { scaleFrom: 0 });
      });
      // CARD_001 is the card-landing sound, so it goes with the arrival rather
      // than the launch.
      later(i * DEAL_STAGGER + DEAL_DURATION, () => sfx?.play(DUEL_SOUND.land));
    });
    const lastLanding =
      (batch.length - 1) * DEAL_STAGGER + DEAL_DURATION;
    batch.forEach(([rec], i) => {
      later(lastLanding + i * DEAL_FLIP_STAGGER, () => {
        if (mine) { flipCard(rec.sprite); sfx?.play(DUEL_SOUND.flip); }
        else scaleCard(rec.sprite, HAND_COLLAPSE_DURATION, 0, SCALE_ONE);
      });
    });
    // ...and it STAYS edge-on. The collapse is traced (slot 06 squeezes
    // 2457 -> 0 over frames 328-331) and the raw run-2 dump shows the slot then
    // going to state 0 at frame 611 and staying there: it is not re-shown until
    // frame 2055, when the opponent's Summon Phase reveals it with the in-place
    // ramp (see revealOppHandOnSummon). The walker used to reopen the hand
    // immediately after the collapse — a guess from a dealt-board capture — so
    // the board was visible during phases the original leaves it hidden.
  }

  /** Rebuild the sprite set from the duel model, issuing the decoded commands
   *  for whatever changed. Called after every phase step. */
  function syncSprites() {
    const d = c.duel;
    if (!d) return;
    const seen = new Set();

    for (const [sideKey, side] of [["you", d.player], ["opp", d.opponent]]) {
      const mine = sideKey === "you";
      // Both hands are drawn. The opponent's is dealt just as visibly as the
      // player's -- it is hidden by collapsing each card edge-on afterwards,
      // not by never drawing it (cardduel-opponent-hand-dealt-then-collapsed).
      const zones = [
        ["hand", side.hand, mine ? "hand" : "oppHand"],
        // The field holds decoded 0xE-byte slots now, not bare ids; the sprite
        // layer only ever wanted the card id.
        ["field", side.field.map((f) => f.id), "centre"],
      ];
      /** cards newly arriving in this side's hand, in row order */
      const dealt = [];
      /** Did this side's hand already have cards on screen before this sync?
       *  That is what separates a DRAW from the DEAL — see drawIntoHand. */
      const handWasPopulated =
        [...c.sprites.keys()].some((k) => k.startsWith(`${sideKey}:hand:`));
      for (const [zone, list, row] of zones) {
        const live = list.filter((id) => id != null);
        live.forEach((id, i) => {
          const key = keyOf(sideKey, zone, id, i);
          seen.add(key);
          const [x, y] = zone === "field"
            ? fieldPos(sideKey, live.length, i)
            : slotPos(row, live.length, i);
          const existing = c.sprites.get(key);
          if (existing) {
            // already here: if the row re-flowed, slide silently to the new slot
            const s = existing.sprite;
            if (!cardBusy(s) && (s.x !== x || s.y !== y)) {
              moveCard(s, rowReflow.duration, x, y, { silent: rowReflow.silent });
            }
            return;
          }
          // New in this zone. If the same card was in the hand a moment ago it
          // is being summoned; otherwise it is being dealt.
          const fromHand = [...c.sprites].find(
            ([k, r]) => r.cardId === id && k.startsWith(`${sideKey}:hand:`),
          );
          if (zone === "field" && fromHand) {
            const [oldKey, rec] = fromHand;
            c.sprites.delete(oldKey);
            c.sprites.set(key, rec);
            summonCard(rec.sprite, 18, x, y, { intro: 8 });
            sfx?.play(DUEL_SOUND.summon);        // CARD_000, the summon intro
            // WALKER MAPPING: the summon is still the walker's. The capture
            // logs no summon-state run it can attribute to a model event, so
            // only the destination row below it is decoded. Once the return leg
            // settles, run the hold; that chains into the decoded `settle`
            // state, the ONLY state in which the original draws the active
            // border (board clip 9).
            rec.onArrive = () => { holdCard(rec.sprite); sfx?.play(DUEL_SOUND.hold); };
          } else if (zone === "hand") {
            // The deal. Every card enters face down from off the right edge on
            // its destination row's y, growing from nothing as it crosses
            // (cardduel-deal-enters-from-offscreen-right). The wave is issued
            // below, once the whole batch is known.
            const rec = spawnAt(key, id, fx(DEAL_START_X), y,
                                CardRenderKind.reverse);
            rec.sprite.scaleX = 0;
            rec.sprite.scaleY = 0;
            dealt.push([rec, x, y]);
          } else {
            // A field card that did not come from a hand appears where it
            // stands, with the decoded in-place reveal
            // (cardduel-row-reveal-is-a-ten-frame-scale-ramp): a ten-frame
            // scale-x ramp, cards in the row about three frames apart.
            const rec = spawnAt(key, id, x, y, CardRenderKind.digimon);
            if (zone === "field" && tokenEntry > 0) {
              // 0x53 / 0x55 put this one here: it flies in rather than fading up.
              tokenEntry -= 1;
              summonTokenEntry(rec, x, y);
              return;
            }
            rec.sprite.scaleX = 0;
            later(i * REVEAL_STAGGER, () => revealCard(rec.sprite));
          }
        });
      }
      // One card into a hand that already had some is a DRAW (0x53 / 0x55), not
      // the deal — see drawIntoHand. A batch, or the first cards a hand ever
      // gets, is the deal.
      if (dealt.length === 1 && handWasPopulated) {
        const [rec, dx, dy] = dealt[0];
        // Spawn put it on the hand row, face-down, like the deal. A draw's
        // first leg is on the centre row, face-up, to (229, 97). The start x
        // is not separately traced; DEAL_START_X (off the right edge) is the
        // deal's, reused.
        rec.sprite.y = fx(ROWS.centre);
        rec.sprite.renderKind = CardRenderKind.digimon;
        drawIntoHand(rec, dx, dy);
      } else if (dealt.length) {
        dealHand(dealt, mine);
      }
    }

    // Anything no longer in the model is on its way to the trash pile — and it
    // leaves ONE AT A TIME. Mode 9's presentation half sends every card in the
    // played row to the discard individually rather than clearing the row in a
    // frame (divergence item 7), so the departures are staggered on the deal's
    // own per-card gap. A single card leaving mid-phase is index 0 and so is
    // unaffected. WALKER: the drain's own gap was not read; DEAL_STAGGER is the
    // deal's, reused.
    let leaving = 0;
    for (const [key, rec] of c.sprites) {
      if (seen.has(key) || retiring.has(key) || isExtraKey(key)) continue;
      retiring.add(key);
      const delay = leaving * cardExit.stagger;
      leaving += 1;
      // In place, edge-on, and then gone -- see THE CARD EXIT above. The pile
      // it belongs to is counted, not flown to.
      const squash = () => {
        scaleCard(rec.sprite, cardExit.squash, 0, SCALE_ONE);
        rec.onArrive = () => { despawnCard(rec.sprite); c.sprites.delete(key); };
      };
      const go = cardExit.shake
        ? () => { shakeCard(rec.sprite); later(SHAKE_DURATION + 1, squash); }
        : squash;
      if (delay === 0) go();
      else later(delay, go);
    }
  }

  /** WALKER MAPPING: the battle phase's reaction. The side with the lower field
   *  total takes the decoded hit shake, the other plays an effect run. */
  // ---- the combo fusion beat (Battle-Phase states 1 and 2) ----------------
  //
  // A combo is not a log line on the disc: it is a sequence, and it runs once
  // per RUN, side 0's runs first. Read out of the two halves of effect opcodes
  // 0x19 and 0x1A on 2026-08-25 — F0x8009403C builds the fusion and F0x800942DC
  // is its ten-step tick machine on duel+0x422:
  //
  //   step 1  wait 0x15 units of the frame delta, then the run's flagged cards
  //           are told to rise (view method +0xF1C, one call per flagged slot);
  //   step 2  when the last of them settles, the COMBINED card appears —
  //           view +0xF24(view, sprite 0x11, 0xA, 0x1000, 0x1000) — and the
  //           run's slots lose their mark;
  //   step 3  a name plate opens over that side's own row,
  //           view +0xEAC(view, 2, 1, duel+0x438, x, y), where duel+0x438 is
  //           the COMBINED CARD'S ID: the plate names the card the run makes;
  //   step 5  it is held 0x5A units, or until a button;
  //   step 6  the plate closes and the combined card rises again;
  //   step 8  over 0x14 units the side's two totals tween up by the fused pair
  //           (view +0xEA0 with readout indices 8 and 9, the AP and HP
  //           plaques), and at the end the real totals are committed and the
  //           combined card leaves.
  //
  // The fused pair is the run's own AP and HP summed and capped at 99, plus 20
  // at four or more copies — `comboRunScore`, the same arithmetic the battle
  // resolution scores the run with, so what the plaques climb to is what the
  // attack is fought with.
  //
  // WHAT IS THE WALKER'S, and why: the "rise" is drawn as the decoded hold
  // (0x8009C770, effect run 2) because view method +0xF1C has no identified
  // sprite command in the animation decode; and the fused card is drawn
  // directly rather than through a pooled sprite, because sprite slot 0x11 is
  // outside the board rows the sprite layer keys by side and card id.
  const COMBO_BEAT = {
    /** step 1's delay before the run rises */
    wait: 0x15,
    /** how long the name plate is held */
    plate: 0x5a,
    /** how long the totals take to climb */
    tally: 0x14,
    /** view +0xF14's placement of the combined card, 8.8 fixed: (131, 97) */
    cardAt: [0x8300 >> 8, 0x6100 >> 8],
    /** The name plate's position, read out of the halfword table at
     *  0x800A5928: four (x, y) pairs indexed by side, with the 50Hz set eight
     *  bytes on. The walker is 50Hz everywhere else on this screen, so it takes
     *  the second pair — side 0 low on the board, side 1 high, each over its
     *  own row. */
    plateAt: { you: [130, 203], opp: [130, 17] },
  };

  /** THE NAME PLATE — the band that names what just happened, low over your own
   *  row and high over the opponent's.
   *
   *  DECODED: its position is the halfword table at 0x800A5928, four (x, y)
   *  pairs indexed by side with the 50Hz set eight bytes on — `COMBO_BEAT
   *  .plateAt`, already used by the fusion beat. `messageBoxTick`
   *  (F0x80097ACC) is the disc's driver for it and lays out "a centred card
   *  name"; `showBanner` (F0x80094FDC) raises one with a given message.
   *
   *  OBSERVED (reference sheets, real hardware): the SAME plate names a played
   *  Program card ("White Power"), a pass ("Pass") and a summon
   *  ("Summon Angemon"). Those three uses are what this state serves.
   *
   *  NOT decoded, and marked as the walker's: the hold length. It reuses the
   *  fusion plate's 0x5A, which is the only plate hold that was read. */
  c.namePlate = null;
  c.namePlateState = () => (c.namePlate ? { ...c.namePlate } : null);
  function raiseNamePlate(sideKey, text, effectText = null) {
    if (!text) return;
    c.namePlate = { sideKey, text, effectText, t: 0 };
  }
  function stepNamePlate() {
    const n = c.namePlate;
    if (!n) return;
    n.t += 1;
    if (n.t >= COMBO_BEAT.plate) c.namePlate = null;
  }

  /** null unless the fusions are being shown. */
  c.combo = null;
  c.comboState = () => (c.combo
    ? { step: c.combo.step, t: c.combo.t, i: c.combo.i, runs: c.combo.queue.length }
    : null);

  /** Queue every run of both sides, side 0 first, and start the beat. Returns
   *  false when there is nothing to show, so the caller resolves as before. */
  function openComboBeat() {
    const d = c.duel;
    if (!d || c.combo) return false;
    const queue = [];
    for (const [sideKey, side] of [["you", d.player], ["opp", d.opponent]]) {
      for (const run of comboRuns(d, side)) queue.push({ sideKey, side, run });
    }
    if (!queue.length) return false;
    c.combo = {
      queue,
      i: 0,
      step: "wait",
      t: 0,
      // What the plaques have already climbed by, per side, so several runs
      // stack the way the disc's repeated `total += fused` does.
      added: { you: { ap: 0, hp: 0 }, opp: { ap: 0, hp: 0 } },
    };
    return true;
  }

  /** The run's field slots: a run is every copy of one card id on that side. */
  function comboRunSprites(entry) {
    const out = [];
    entry.side.field.forEach((slot, i) => {
      if (slot.id !== entry.run.id) return;
      const rec = c.sprites.get(keyOf(entry.sideKey, "field", slot.id, i));
      if (rec) out.push(rec);
    });
    return out;
  }

  /** How much of the fused pair the plaques are showing right now. */
  function comboShownBonus(sideKey) {
    const k = c.combo;
    if (!k) return { ap: 0, hp: 0 };
    const base = k.added[sideKey];
    const entry = k.queue[k.i];
    if (!entry || entry.sideKey !== sideKey || k.step !== "tally") return base;
    const score = comboRunScore(entry.run);
    const t = Math.min(1, k.t / COMBO_BEAT.tally);
    return { ap: base.ap + Math.round(score.ap * t), hp: base.hp + Math.round(score.hp * t) };
  }

  /** One frame of the beat, run with the sprite layer. */
  function stepComboBeat() {
    const k = c.combo;
    if (!k) return;
    const entry = k.queue[k.i];
    if (!entry) { finishComboBeat(); return; }
    k.t += 1;
    if (k.step === "wait") {
      if (k.t < COMBO_BEAT.wait) return;
      for (const rec of comboRunSprites(entry)) holdCard(rec.sprite);
      // NO SOUND: the ten steps of F0x800942DC were read end to end on
      // 2026-08-25 and none of them plays one. The only calls through the
      // resident table in that machine are the pad service's own two entries
      // (+0x3F4 and +0x408) at the step that takes a button. A sound is not
      // invented for it here.
      k.step = "rise";
      k.t = 0;
      return;
    }
    if (k.step === "rise") {
      // Step 2 waits on the last card it raised before the combined card shows.
      if (boardBusy()) return;
      k.step = "plate";
      k.t = 0;
      return;
    }
    if (k.step === "plate") {
      // Held for its own count, or until a button — see comboKey.
      if (k.t < COMBO_BEAT.plate) return;
      k.step = "tally";
      k.t = 0;
      return;
    }
    if (k.step === "tally") {
      if (k.t < COMBO_BEAT.tally) return;
      const score = comboRunScore(entry.run);
      k.added[entry.sideKey].ap += score.ap;
      k.added[entry.sideKey].hp += score.hp;
      k.i += 1;
      k.t = 0;
      k.step = "wait";
      if (k.i >= k.queue.length) finishComboBeat();
    }
  }

  /** The beat is over. The attack is NOT run from here any more: the fusions
   *  are shown ahead of ceremony opcode 0x19, and closing this releases the
   *  stream so 0x19 and the four beats behind it take their own frames. */
  function finishComboBeat() {
    c.combo = null;
  }

  /** The plate takes a button early, exactly as step 5 does. */
  function comboKey(k) {
    const beat = c.combo;
    if (beat.step !== "plate") return true;
    if (k !== "circle" && k !== "cross") return true;
    sfx?.play(DUEL_SOUND.confirm);
    beat.t = COMBO_BEAT.plate;
    return true;
  }

  // ---- the duel's own frame ----------------------------------------------
  //
  // The duel is no longer stepped a phase at a time by the confirm button. It
  // runs the disc's own ceremony-opcode stream — the twenty opcodes latched at
  // duel+0x421, decoded in engine/systems/card-ceremony.ts — one beat per
  // frame, and this screen plays each beat as it starts.
  //
  // THE TWO CLOCKS COMPOSE AS max, NOT sum. `duel.beat.hold` is the number of
  // frames the disc took between one latch of duel+0x421 and the next, and it
  // was measured WITH THE DISC'S OWN SCREEN RUNNING (rig capture 2026-08-26,
  // GUI save state 1) — a banner's hold already contains the banner. So the
  // hold keeps counting down while this screen plays its presentation over the
  // top, and only the START of the next beat waits for the screen to be free.
  // Adding the two would double every beat in the duel.
  //
  // ONE DUEL, ONE OPPONENT, ONE FOLDER. Every hold in BEAT_FRAMES comes from
  // that single capture, and the four input-gated opcodes (0x70, 0x98, 0x99,
  // 0x9A) carry no hold at all because their measured gaps were the trace
  // robot's sixty-frame input pulse rather than anything the game timed.

  /** The beat whose start has already been played, so each is played once. */
  let lastBeat = null;
  /** Cleared by the set banner; set when the coin ceremony's pick is latched. */
  let coinPicked = false;
  /** Whether this Battle Phase has already shown its fusions. The run stays on
   *  the field after the beat — the fusion is a bonus, not a replacement — so
   *  without this the beat would reopen on the same run every frame and the
   *  attack would never be reached. */
  let combosShown = false;

  /** True while something on THIS screen owns the frame: a phase announcement,
   *  a question a card has parked on, a picker, one of this screen's own beats,
   *  a turn machine it is driving, or a card still moving. The disc's own test
   *  is the last of those — it ORs 1 into the screen's `unk54` for every sprite
   *  mid-animation and refuses to advance — and the rest are the walker's, one
   *  per interactive beat the disc waits on. */
  function screenOwnsFrame() {
    const d = c.duel;
    if (!d) return true;
    if (announcing()) return true;
    // The coin ceremony holds the frame except for the single beat between its
    // confirm and its reveal, which is 0xA7 itself.
    if (c.coin && !c.coin.awaiting) return true;
    if (c.combo || c.setEnd || c.picker || c.effectPicker || c.play) return true;
    if (awaitingCardChoice(d)) return true;
    if (d.programTurns && !d.programTurns.done) return true;
    if (d.summonTurns && !d.summonTurns.done) return true;
    if (boardBusy()) return true;
    return false;
  }

  /** The turn machines the engine's beats open and then park on. 0x98 opens the
   *  play negotiation and 0x9A opens the summon turns; both then wait, and the
   *  side that is not yours has to be given its turns from here. */
  function serviceTurns() {
    const d = c.duel;
    if (!d || d.outcome || boardBusy()) return;
    if (c.coin || c.combo || c.setEnd || c.picker || c.effectPicker) return;
    if (awaitingCardChoice(d)) return;

    const su = d.summonTurns;
    if (su && !su.done && summonTurnSide(d) !== d.player) {
      runSummonTurns(d, agents, d.player);
      syncSprites();
      return;
    }

    const t = d.programTurns;
    if (!t || t.done || t.state === "pass" || c.play) return;
    // Neither side is being asked anything, and the negotiation cannot end
    // until both have taken their turn — so put the question back up, or give
    // the other side its turn. Without this, any path that closes the selector
    // without taking the turn would hang the phase, which is a hazard the old
    // model did not have because a button press stepped the phase outright.
    if (programTurnSide(d) === d.player) openPlaySelector(c.play?.cursor);
    else afterPlayerTurn();
  }

  /** debug-only: why the duel's stream is or is not moving, for headless
   *  capture. Named reasons, so a stalled duel says what is holding it. */
  c.driveDebug = () => {
    const d = c.duel;
    if (!d) return { duel: false };
    return {
      phase: phase(d).key,
      beat: { current: d.beat.current, hold: d.beat.hold, gated: d.beat.gated,
              pending: d.beat.pending.slice() },
      holds: {
        announcing: announcing(), announceT,
        coin: !!c.coin && !c.coin.awaiting, combo: !!c.combo, setEnd: !!c.setEnd,
        picker: !!c.picker, effectPicker: !!c.effectPicker, play: !!c.play,
        cardChoice: awaitingCardChoice(d),
        programTurns: !!(d.programTurns && !d.programTurns.done),
        summonTurns: !!(d.summonTurns && !d.summonTurns.done),
        board: boardBusy(),
      },
      combosShown,
      programTurns: d.programTurns && { ...d.programTurns },
      turnSide: d.programTurns
        ? (programTurnSide(d) === d.player ? "you" : programTurnSide(d) ? "opp" : null)
        : null,
      outcome: d.outcome,
    };
  };

  /** One frame of the duel. */
  function tickDuelFrame() {
    const d = c.duel;
    if (!d || d.outcome) return;
    const b = d.beat;
    // A beat that already owns the frame keeps its clock running whatever the
    // screen is doing — see the note above on max rather than sum.
    //
    // A BANNER OWNS THE FRAME WITH NO CLOCK AT ALL. `duelBeatBusy` counts a
    // gated beat as busy, which matters here: without it the screen ran ahead
    // and opened the NEXT beat's ceremony — the Calumon draw — over a Start
    // banner that was still waiting to be dismissed, and neither could finish.
    if (duelBeatBusy(d)) {
      tickDuel(d, agents, Math.random, EFFECTS);
      return;
    }
    // Two beats have a ceremony of this screen's own that runs AHEAD of them.
    const next = b.pending[0];
    if (next === 0xa7) {
      // Mode 3 IS the Calumon draw: it opens by itself rather than on a press.
      if (!c.coin) { openCoinCeremony(); return; }
      if (!c.coin.awaiting) return;
    } else if (next === 0x19) {
      // THE COMBOS ARE SHOWN BEFORE THE ATTACK. The Battle-Phase machine's
      // states 1 and 2 scan side 0 and then side 1 and issue one fusion
      // sequence per run, and state 9 — the attack — is only reached once both
      // scans have returned -1. Once, per Battle Phase: the scans are what stop
      // returning runs on the disc, and this screen's stand-in for that is the
      // flag the phase's own banner clears.
      if (!combosShown) {
        combosShown = true;
        if (openComboBeat()) return;
      }
      if (screenOwnsFrame()) return;
    } else if (screenOwnsFrame()) {
      return;
    }
    // Read the set counters and the phase BEFORE the beat, so the reactions and
    // the set-end ceremony below can tell what it did.
    const before = [d.player.score, d.opponent.score];
    const wasBattle = phase(d).key === "battle";
    snapshotPlaysIfLive();
    tickDuel(d, agents, Math.random, EFFECTS);
    // COMPARE THE BEAT, NOT THE OPCODE. Two beats with the same opcode run back
    // to back -- one fusion announcement per combo run, one reveal per queued
    // reveal -- and comparing `current` collapsed them into one.
    if (b.current !== null && b.serial !== lastBeat) {
      lastBeat = b.serial;
      beatStarted(b.current);
    } else if (b.current === null) {
      lastBeat = null;
    }
    if (d.player.score !== before[0] || d.opponent.score !== before[1]) {
      // Fire on the beat that AWARDS the set (0x1D), and tell the reactions who
      // won from the score delta rather than from the totals: 0x1D runs endSet
      // in the same beat, and endSet empties both fields, so by now the totals
      // the reaction would test have already been torn down. The score is the
      // only surviving record of who took it.
      if (wasBattle) playBattleReactions(d.player.score > before[0]);
      // The set change is a beat of its own: the drain, the grey flash, the
      // fifty-one-tick counter roll and the result window. It also owns the
      // duel-won jingle and the booster-pack grant, because the disc's
      // duel-over test runs after the roll, not with it.
      openSetEndIfScored(before);
    }
  }

  /** Play the beat that has just taken the frame. Everything the confirm button
   *  used to trigger hangs off one of these. */
  function beatStarted(op) {
    const d = c.duel;
    // A reveal's ramp belongs to its own beat. Take it down the moment another
    // beat owns the frame, so the panels go back to reading the model.
    if (op !== 0x1b && c.view) clearReveal(c.view);
    switch (op) {
      // The six phase announcements. F0x800894e4 opens prompt-window layout 1
      // and info-banner 5 at (0, 66) from the two-byte table at 0x800A58C4.
      case 0xa0:
        coinPicked = false;
        raisePhaseAnnounce(0xa0);
        return;
      case 0xa5:
        // A new Battle Phase: its fusions have not been shown yet.
        combosShown = false;
        raisePhaseAnnounce(0xa5);
        return;
      case 0xa1: case 0xa2: case 0xa3: case 0xa4:
        raisePhaseAnnounce(op);
        return;
      case 0xa7:
        revealCoin();
        return;
      case 0x98:
        // The negotiation is open: name the phase, let the opponent take any
        // turn that comes before yours, and put the hand selector up.
        // Drop the phase banner first: 0x98 can latch while that prompt is
        // still mid-wipe, and the play box must start at 0, not at 3413.
        dropPhaseAnnounce();
        openProgramTurns();
        openPlaySelector();
        // 0x98 IS the beat that raises the box on the disc (F0x80086330), so
        // it opens unconditionally here and its wipe is the authoritative one.
        // Leaving it to openPlayWindow's ownership test measured worse -- 3 of
        // 8 runs against 7 of 8 -- because a window raised earlier by the turn
        // machinery was then already "ours" and the beat could not restart it.
        if (c.view && c.play) openPrompt(c.view, 0, 0, c.play.ask ?? 0, 0);
        return;
      case 0x99: case 0x9a:
        // Enter is parked until programTurns/summonTurns.done, so the
        // selector banners are armed when pick/summon browsing actually
        // starts (armSelectorBanners), not on this latch.
        return;
      case 0x12:
        // F0x80092438 only resetPanels when the strips are already hidden.
        // The walker parks them SHOWN, so this beat is the extra card at
        // (229, 97) growing — not a HUD blink. Only 0x12 dismisses the
        // negotiation; 0x13 shares the extra card and must not clear c.play
        // or the prompt wipe restarts mid-open.
        c.play = null;
        dropHandSelectorChrome();
        raisePlayTableExtra();
        syncSprites();
        return;
      case 0x13:
        // The card you played rises into the centre of the board. Same extra
        // card as 0x12: it grows at the deck's corner and then glides over ten
        // ticks to its place in the three-wide played fan.
        raisePlayTableExtra();
        syncSprites();
        return;
      case 0x53: case 0x55:
        // A summoned token flies in from the deck's corner — see THE 0x53 /
        // 0x55 CORRECTION. The model has already put it on the board, so the
        // flag only tells this sync which entrance to give the new sprite.
        tokenEntry += 1;
        syncSprites();
        tokenEntry = 0;
        return;
      case 0x3f:
        // one card leaves the hand for the trash; the model already moved it,
        // so this is the sprite catching up on its own beat instead of at the
        // next unrelated sync.
        syncSprites();
        return;
      case 0x42:
        // and one comes the other way, out of the pile into the hand.
        syncSprites();
        return;
      case 0xaa: case 0xac:
        // A pile picker opens. The VM has already raised the choice, so the fan
        // is drawn by the effect-picker branch of the board draw; what was
        // missing is that the disc gives the opening its own beat — 0xAC is
        // latched at frame 1759 of the 2026-08-25 capture and the 34-sprite fan
        // appears at 1761. Without a beat the fan arrived at the next unrelated
        // sync. The pick itself is what ends the beat: the driver's input stage
        // has no timeout.
        syncSprites();
        return;
      case 0x2b: case 0x2d:
        // The resolution stack pushes a level: both HUD panels slide off, over
        // the ten frames F0x8009C350 carries. The VM already saved the played
        // history; this is the half the player sees.
        slideBothPanelsOut(c.view);
        syncSprites();
        return;
      case 0x2c: case 0x2e:
        // and the nested program unwinds: the panels slide back in over twenty
        // frames (F0x8009C2D0).
        slideBothPanelsIn(c.view);
        syncSprites();
        return;
      case 0x2f: case 0x30: case 0x31:
        raiseDuelMessage(op);
        syncSprites();
        return;
      case 0x4c:
        // The survivors close the gaps: all of them at once, over ten ticks, and
        // audibly. The splice that opened the gap happened in the step before,
        // so the row has already re-flowed in the model and this is the move.
        rowReflow = REFLOW_GAP_CLOSE;
        syncSprites();
        rowReflow = REFLOW_SILENT;
        return;
      case 0x4d:
        // CORRECTED 2026-08-27. This was shipped with the SET AWARD's exit - a
        // four-tick squeeze and no shake. It is the TRANSFER's.
        //
        // Each marked card runs a three-step machine of its own: shake, wait
        // for the shake to finish, squeeze to nothing over FIVE ticks, wait for
        // that to finish. Only when a card reports done does the beat look for
        // the next marked slot, so they leave strictly one after another rather
        // than on a fixed clock - which is what this style's stagger already
        // expresses, being the length of one card's whole exit.
        setCardExit({ squash: EXIT_SQUASH_TRANSFER, stagger: EXIT_STAGGER_TRANSFER, shake: true });
        syncSprites();
        return;
      case 0x5a:
        // The board's AP and HP are added back up. Nothing is drawn: the plaques
        // already read the totals live.
        syncSprites();
        return;
      case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: case 0x75:
      case 0x76: case 0x77: case 0x78: case 0x79: case 0x7a: case 0x7b:
      case 0x7c: case 0x7d: case 0x7e: case 0x7f: case 0x80: case 0x81:
      case 0x82: case 0x83: case 0x84: case 0x8d: case 0xae:
        // CA4C / 8CE0C / 8AD98: extra card at the waypoint, HUD slides in.
        // 0x8D and 0xAE reach the SAME handler pair and differ only in one
        // argument, so they take the same arm.
        raiseWaypointExtra();
        openEffectPickerIfPending();
        syncSprites();
        return;
      case 0x19: case 0x1a:
        raiseBattleExtra();
        syncSprites();
        return;
      // 0x1B, the card reveal. Its enter places the SAME sprite at the SAME
      // place as the two combo announcements -- placeSlot(0x11, 0x8300,
      // 0x6100) -- so it reuses their plate. What differs is the fifteen-frame
      // ramp behind it and the press it then waits for.
      //
      // The model has ALREADY exchanged the two sides' totals by the time this
      // runs, so the ramp starts from the values before that swap and arrives
      // at the ones the panels will keep.
      case 0x1b: {
        raiseBattleExtra();
        if (c.view && d) {
          const to = {
            playerAp: d.player.totalAp, playerHp: d.player.totalHp,
            opponentAp: d.opponent.totalAp, opponentHp: d.opponent.totalHp,
          };
          startReveal(c.view, {
            playerAp: to.opponentAp, playerHp: to.opponentHp,
            opponentAp: to.playerAp, opponentHp: to.playerHp,
          }, to);
        }
        syncSprites();
        return;
      }
      // The two attack drains -- 0x15 is side 0 attacking, 0x16 is side 1.
      // F0x80084320 sends both to the same enter with the side as its third
      // argument, so they are one animation played twice, not two steps.
      // The model publishes the pre-drain numbers on `d.drain` because the
      // subtraction clamps at zero and they cannot be recovered afterwards.
      case 0x15: case 0x16:
        if (c.view && d && d.drain) {
          startDrain(c.view, {
            side: d.drain.side,
            attackerAp: d.drain.ap,
            defenderHp: d.drain.hpBefore,
            attackerCards: d.drain.cards,
          });
        }
        syncSprites();
        return;
      // The transfer, and the set award. Both send a side's field cards to the
      // trash through the SAME routine -- see THE CARD EXIT above -- and they
      // differ only in how the row is walked:
      //
      //   0x17 / 0x18  each card shakes, then squeezes away over five ticks,
      //                and the next card starts only once that has finished.
      //                The row empties from its last slot down.
      //   0x1C / 0x1D  one card every three ticks, squeezed over four, from
      //                slot 0 up -- no shake, and no waiting on the last one.
      //
      // The set award then does something the transfer does not: once the row
      // is empty it DRAINS THE HANDS BACK INTO THE DECKS. Both sides' hand and
      // deck numbers move together, one card every three ticks, hand down and
      // deck up, with a sound on each step, until both hands read zero. Only
      // then does the banner go up and wait for a button.
      case 0x17: case 0x18:
        setCardExit({ squash: EXIT_SQUASH_TRANSFER, stagger: EXIT_STAGGER_TRANSFER, shake: true });
        syncSprites();
        return;
      case 0x1c: case 0x1d:
        setCardExit({ squash: EXIT_SQUASH_SETEND, stagger: EXIT_STAGGER_SETEND, shake: false });
        // The field clears for a fixed 61 ticks -- the handler runs its exit
        // pass against an elapsed threshold, not against the row emptying --
        // and only then are the hands put back.
        if (c.view) {
          const { hand, deck } = preSetCounts;
          later(SETEND_FIELD_PASS, () => {
            if (c.view) startHandReturn(c.view, { hand, deck });
          });
        }
        syncSprites();
        return;
      // The deal. Its handler F0x80092E60 is a twelve-state sub-machine, and
      // the walker already plays its first three passes: the twelve cards fly
      // in from off the right edge (state 2, and the disc's own start x is
      // `table x + 0x14800` = 24 + 328 = 352, which is DEAL_START_X exactly),
      // then the player's six turn face up while the opponent's stay down
      // (state 3, which touches slot 0..5 and never slot+6).
      //
      // Its FOURTH pass had no counterpart here. The disc walks both hands slot
      // by slot and counts each card's colour into that side's energy block,
      // pushing the running count to the HUD as it goes -- so the five numbers
      // under the energy cubes climb one card at a time instead of appearing
      // finished. The walker's model grants the same points from the same draw,
      // so this is purely the readout catching up.
      //
      // WALKER TIMING: the disc starts this pass 131 logic ticks in, after two
      // fixed-length passes of its own. The walker's fly-in and flip wave are
      // rig-captured and shorter, so the ramp is anchored to the END OF THE
      // WALKER'S OWN FLIP WAVE -- the same place in the order, measured on the
      // clock this deal actually runs on.
      case 0x14:
        if (c.view && d) {
          const colourRow = (side) => {
            const row = [];
            for (const id of side.hand.slice(0, DEAL_TALLY_STEPS)) {
              const card = d.byId.get(id);
              row.push(card ? energyIndex(card.colour) : -1);
            }
            return row;
          };
          startDealTally(c.view, {
            colours: [colourRow(d.player), colourRow(d.opponent)],
            // The last card lands at (6-1)*DEAL_STAGGER + DEAL_DURATION, and
            // the flip wave then runs one card every DEAL_FLIP_STAGGER.
            delay: (DEAL_TALLY_STEPS - 1) * DEAL_STAGGER + DEAL_DURATION
                 + (DEAL_TALLY_STEPS - 1) * DEAL_FLIP_STAGGER,
          });
        }
        syncSprites();
        return;
      // The auto-pick. Its handler F0x8008C5F0 walks the side's candidate
      // list and, for each card it accepts, pays the card's cost out of that
      // card's own energy colour and pushes the new colour total straight to
      // the HUD -- F0x8008735C reads the colour from the card record's first
      // byte and the cost from its sixth, subtracts one from the other in the
      // five-byte energy block, and calls the panel setter with that colour as
      // its property. `setCounter` property 0..4 writes panel +0x18..+0x1C,
      // which the layout record names `field_numbers`: the five two-digit
      // numbers under the energy cubes. The walker draws those five numbers
      // live from `side.energy`, the same block the payment comes out of, so
      // the readout is already correct on the frame the card is taken -- and
      // the accept rules agree too: the disc stops at six accepted cards
      // (FIELD_LIMIT) and refuses a card whose colour total is below its cost.
      // The handler returns done on its first tick, so there is no tween here
      // and nothing further to draw.
      case 0x9d:
        syncSprites();
        return;
      case 0x9e:
        raiseBoardSweep();
        syncSprites();
        return;
      case 0xa8:
        if (c.view) {
          resetPanels(c.view);
          slideBothPanelsIn(c.view);
          openPrompt(c.view, 0x17, 0, 0, 1);
        }
        syncSprites();
        return;
      default:
        // The deal, the summon sweep and the four beats of the attack all move
        // cards; the sprite layer follows the model.
        openEffectPickerIfPending();
        syncSprites();
        noteUnhandledBeat(op);
    }
  }

  /** Beats that reach here and SHOULD have drawn something, in the order the
   *  duel first issued them.
   *
   *  Falling to `default:` is the right answer for most of the opcode space —
   *  57 beats change the rules without touching the screen and 7 do nothing at
   *  all, and for those a plain sprite resync is exactly what the original does.
   *  It is the wrong answer for the 110 that reach an animation primitive: there
   *  the player is missing a picture, and until now that was indistinguishable
   *  from the correct case because both were silent.
   *
   *  So the classification decides. `beatNeedsAnimation` comes from the decoded
   *  atlas (see engine/systems/card-ceremony.ts), and only an animating beat
   *  with no case of its own is recorded. Reported, not thrown: an unwired beat
   *  is a gap in the walker, not a fault in the duel, and throwing here would
   *  take the screen down over a missing flourish. */
  const unhandledBeats = new Map();
  function noteUnhandledBeat(op) {
    if (!beatNeedsAnimation(op)) return;
    const seen = unhandledBeats.get(op) ?? 0;
    unhandledBeats.set(op, seen + 1);
    if (seen === 0 && typeof console !== "undefined") {
      console.warn(
        `cardduel: beat 0x${op.toString(16)} animates on the disc but the walker `
        + "has no case for it; the sprites were resynced instead.",
      );
    }
  }
  /** The measured gap list, for a verifier or the UI lab. Ascending by opcode. */
  c.unhandledBeats = () =>
    [...unhandledBeats.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([op, count]) => ({ op, count }));

  /** `youWin` is passed in, not derived here. The set is decided on total HP
   *  remaining with a tie going to the opponent (F0x800a0f94 cases 9/10) — but
   *  by the time this runs both totals are 0, because endSet has already
   *  emptied both fields inside the same stepPhase. Deriving the winner here
   *  read `0 < 0` on every battle of every duel, so the player-wins branch —
   *  states 7 and 9, effect run 3 — was unreachable no matter who actually won.
   *  A tie scores nobody, so it falls to the opponent branch, which is the same
   *  way the disc breaks it. */
  function playBattleReactions(youWin) {
    const d = c.duel;
    if (!d) return;
    for (const [key, rec] of c.sprites) {
      if (!key.includes(":field:")) continue;
      const mine = key.startsWith("you");
      // NOT gated on cardBusy. syncSprites() runs on the line that calls this
      // and issues the row reflow, so every field sprite is mid-move at this
      // instant — the guard skipped all of them, every time, which is why a
      // full duel reached the Battle Phase and never once played state 6, 7 or
      // 9. The disc shakes the defender's cards DURING the drain
      // (F0x80093710), so a card being in motion is not a reason to skip it.
      if (mine === youWin) playCardEffect(rec.sprite, { short: !mine });
      else {
        shakeCard(rec.sprite, { bothAxes: mine });
        // CARDTHND accompanies both shake commands.
        sfx?.playBank?.(DUEL_BANK, CARDTHND);
      }
    }
  }

  /** debug-only: run the battle reactions for a chosen winner, so a headless
   *  audit can observe BOTH branches. Winning a real duel is not a reliable way
   *  to reach the player-wins branch — a posed board is wiped by the battle
   *  resolution and endSet before the reaction runs — and without this the
   *  audit cannot tell "states 7 and 9 are broken" from "this run never won".
   *  It calls exactly what resolveCurrentPhase calls, with nothing stubbed. */
  c.__runBattleReactions = (youWin) => playBattleReactions(!!youWin);
  c.__notePlayed = notePlayed;
  c.__raisePlayTableExtra = raisePlayTableExtra;
  c.__closePlates = closeAllPlates;
  c.__stepBoard = () => { c.ticks += 1; stepBoardSprites(); };
  c.__armSelectorBanners = armSelectorBanners;
  c.__drawSelectorBanners = drawSelectorBanners;
  /** debug-only: pose the duel-end condition without playing a whole duel, for
   *  headless capture of the close wash. It sets the outcome and takes every
   *  screen beat down — the state the result window is dismissed from — but
   *  touches no board or score the player would have earned. */
  c.__endDuel = (outcome = "win") => {
    const d = c.duel;
    if (!d || d.outcome) return false;
    d.outcome = outcome;
    d.effectVm = null;
    d.beat.current = null;
    c.setEnd = null;
    c.picker = null;
    c.effectPicker = null;
    c.combo = null;
    c.coin = null;
    c.play = null;
    d.programTurns = null;
    d.summonTurns = null;
    announced = false;
    announceT = 0;
    return true;
  };

  /** Step every sprite one frame, exactly as F0x8009bac8 does before drawing,
   *  and retire the ones that finished their journey to the trash. */
  function stepSprites() {
    // The decoded view widgets — HUD panels, name plates, the two prompt
    // windows, the six info banners, the three plates and the marker pool —
    // all step here, on the duel's own frame, before anything reads their
    // positions. engine/systems/card-view.ts owns every one of their state
    // machines and durations; this file only ticks and draws them.
    if (selectorWantsBanners()) armSelectorBanners();
    if (c.view) {
      // Drive the decoded prompt window off the play negotiation's own lifetime:
      // the box opens when the negotiation opens and closes when it clears. The
      // 12/6 frame wipes and the three sound ids are the original's
      // (F0x8009C054 / F0x8009C0DC); this only decides WHEN they run.
      // The phase announcement (0xA0..0xA5) owns the prompt via raisePhaseAnnounce.
      // If this driver also ran, it would close that window the next frame
      // because c.play is null during the announcement.
      if (!announcing()) {
        const want = !!c.play;
        const st = c.view.prompt.state;
        // The window is normally raised by openPlaySelector, on the frame the
        // question is asked. This is the catch-up for a negotiation that
        // outlived an announcement, and the close for one that has ended.
        if (want) {
          openPlayWindow();
        } else if (st === PromptState.opening || st === PromptState.open) {
          closePrompt(c.view);
        }
      }
      stepCardView(c.view);
    }
    samplePreSetCounts();
    runScheduled();
    stepSetEnd();
    stepWash();
    // The duel end: once the close wash has run out, the screen goes. The wash
    // itself is kept until this point (its value ends at 1, so stepWash leaves
    // it in place), which is why the test is the countdown, not c.wash.
    if (closing && c.wash && c.wash.t <= 0) { close(); return; }
    driveTurnMarker();
    stepComboBeat();
    stepProgramTurns();
    serviceTurns();
    // ...and then the duel's own frame, AFTER this screen's beats have had
    // theirs, so a beat that finishes on this frame releases the stream on it
    // rather than a frame later.
    tickDuelFrame();
    // The stat ticker runs with the sprites: every per-slot stat moves by ±1
    // per frame toward its queued target and the displayed pair follows a frame
    // behind, so the ramp IS the animation rather than something over one.
    if (c.duel) { tickStats(c.duel.player); tickStats(c.duel.opponent); }
    revealOppHandOnSummon();
    stepBanners();
    // The announcement comes down when its own step has run AND the beat that
    // raised it has released the frame.
    //
    // TWO SOURCES, AND THEY DISAGREE ABOUT WHICH IS THE CLOCK. F0x800A1E60's
    // announcement step runs to 0x23 units, which is the minimum below. The
    // 2026-08-26 rig capture measured the gap from each banner opcode to the
    // next latch at 25, 49, 151, 71, 101 and 63 frames — longer than 0x23 for
    // five of the six, and SHORTER for the Start banner, which means the next
    // opcode is latched while the banner is still up. So neither number is the
    // whole answer: 0x23 is how long the step runs, the measured gap is how
    // long the phase takes to start acting, and the banner is up for whichever
    // is longer. The walker previously held every announcement until the player
    // pressed Circle, which is a third answer and matched neither.
    if (announced) {
      announceT += 1;
      if (announceT >= ANNOUNCE_DURATION && (!c.duel || !duelBeatBusy(c.duel))) {
        dropPhaseAnnounce();
      }
    }
    stepNamePlate();
    stepBoardSprites();
  }

  function stepBoardSprites() {
    for (const [key, rec] of [...c.sprites]) {
      const before = rec.sprite.state;
      const r = stepCardSprite(rec.sprite, 1, c.ticks);
      if (before !== CardAnimState.idle) rec.effectT += 1;
      if (rec.sprite.effect === 0) rec.effectT = 0;
      if (!r.finished) continue;
      if (retiring.has(key)) {
        despawnCard(rec.sprite);
        retiring.delete(key);
        c.sprites.delete(key);
      } else if (rec.onArrive) {
        // one-shot follow-up (the deal's flip, the summon's hold, extra-card
        // second leg)
        const next = rec.onArrive;
        rec.onArrive = null;
        next();
      }
    }
  }

  /** The HUD strips, the score plates and the board chrome are NOT on screen
   *  for the whole duel: every captured frame before the deal — the challenge
   *  prompt, the folder chooser, Start Phase and its Calumon draw, the Draw
   *  Phase announcement — is bare backdrop plus chrome, and the strips appear
   *  with the dealt hands. So the HUD follows the cards. */
  function hudVisible() {
    const d = c.duel;
    if (!d) return false;
    // ...and it stays up for the whole set-end beat. The set change empties
    // both hands and both fields, so without this the score plates would go
    // out at exactly the moment the counter is meant to roll on them.
    if (c.setEnd) return true;
    return d.player.hand.length + d.player.field.length
      + d.opponent.hand.length + d.opponent.field.length > 0;
  }

  /** A phase announces itself first — banner band plus prompt window over an
   *  otherwise untouched board — and then plays with both bands gone. The
   *  announcement holds until the player confirms: the rig runs pressed X on a
   *  90-frame pulse and each announcement stayed up until the next pulse, so
   *  their on-screen durations are the pulse, not a timer. */
  let announced = true;
  /** Frames the current announcement has been up, for the skip gate below. */
  let announceT = 0;
  const announcing = () => announced;
  /** F0x800A1E60's announcement step runs to 0x23 units and a confirm press
   *  only takes effect once the timer has passed 0x14 — and even then it does
   *  not cancel the step, it jumps the timer to the end so the teardown always
   *  runs. So there is a mandatory minimum display time before the player can
   *  hurry it along.
   *  — cardgame-played-card-announcement-is-skippable-after-a-delay
   *
   *  THAT IS A DIFFERENT ROUTINE. `ANNOUNCE_DURATION` belongs to the PLAYED
   *  CARD's announcement. A PHASE banner is `F0x80089580`, whose step 1 waits
   *  for the info banner and the prompt to finish opening and whose step 2 then
   *  polls the pad with no timer at all. So a phase banner's minimum is not a
   *  count — it is "the windows are open" — and it has no maximum.
   *  — cardduel-phase-banners-are-one-routine-and-wait-for-a-button-2026-08-27 */
  const ANNOUNCE_SKIPPABLE_AFTER = 0x14;
  const ANNOUNCE_DURATION = 0x23;
  const announceSkippable = () => {
    // A banner beat waiting on the pad is dismissable the moment its windows
    // have finished opening — the disc's step 1, not a borrowed timer.
    if (c.duel && duelBeatAwaitsButton(c.duel)) return windowsOpen();
    return announceT >= ANNOUNCE_SKIPPABLE_AFTER;
  };
  /** Step 1 of the banner machine: both windows have reached their open state. */
  function windowsOpen() {
    if (!c.view) return true;
    return c.view.banners[5].state === InfoBannerState.open
      && c.view.prompt.state === PromptState.open;
  }
  /** Two-byte rows at 0x800A58C4, indexed by F0x800894e4's a2 (opcode 0xA0 → 0).
   *  byte0 is openBanner's value, byte1 is openPrompt's message id. */
  const PHASE_ANNOUNCE = [
    [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12],
  ];
  function raisePhaseAnnounce(op) {
    announced = true;
    announceT = 0;
    dropExtras();
    dropHandSelectorChrome();
    if (!c.view) return;
    const i = op - 0xa0;
    if (i < 0 || i > 5) return;
    const [value, msg] = PHASE_ANNOUNCE[i];
    // layoutIndex 1 = box 1 at y 96 (PROMPT_BAND). Banner 5 at (0, 0x42).
    // Index 5 was the atlas's "not established" slot; this is it.
    openPrompt(c.view, msg, 0, 0, 1);
    openBanner(c.view, 5, 5, value, 0, 0x42);
  }
  function dropPhaseAnnounce() {
    announced = false;
    if (!c.view) return;
    closeBanner(c.view, 5);
    if (c.view.prompt.layoutIndex === 1) closePrompt(c.view);
  }
  /** Hurry the announcement along. It does not cancel the step — the timer is
   *  jumped to the end so the teardown still runs — and it releases the banner
   *  beat that raised it too, or the banner would come down and leave the
   *  screen sitting on the rest of that beat's hold with nothing on it. */
  function skipAnnouncement() {
    announceT = ANNOUNCE_DURATION;
    dropPhaseAnnounce();
    // ...and it is the press the banner beat itself is waiting for (step 2).
    if (c.duel) { dismissBeat(c.duel); c.duel.beat.hold = 0; }
  }

  /** True while any card is mid-animation -- the original's "board is busy"
   *  test, which is why input is refused during a deal or a summon. */
  function boardBusy() {
    // Work that has not started yet counts as busy: the deal's later cards and
    // the whole flip wave are still queued while the first card is in flight,
    // and letting a phase step land in that gap would cut the wave in half.
    if (scheduled.length) return true;
    for (const rec of c.sprites.values()) if (cardBusy(rec.sprite)) return true;
    return false;
  }

  // ---- decoded drawing primitives ---------------------------------------

  /** Chrome boxes for the six 87EDC info banners, index-aligned. Heights
   *  match the measured browser bands that occupy the same slots. */
  const SELECTOR_BANNER_BOX = [
    { w: 131, h: 20 },
    { w: 40, h: 20 },
    { w: 188, h: 20 },
    { w: 188, h: 20 },
    { w: 184, h: 36 },
    { w: 137, h: 20 },
  ];

  /** Draw the six hand-selector info banners at the live view coords
   *  (0, 66), (130, 165), (134, 49), (130, 144), (253, 144), (0, 20). */
  function drawSelectorBanners(ctx) {
    const banners = c.view?.banners;
    if (!banners) return;
    for (let i = 0; i < banners.length; i++) {
      const b = banners[i];
      if (!b || b.state === 0) continue;
      const box = SELECTOR_BANNER_BOX[i] ?? { w: 40, h: 20 };
      withWipe(ctx, b.animScale, () => {
        drawWindow(ctx, b.x, b.y, box.w, box.h, CHROME.edge);
      });
    }
  }

  /** A number, the way F0x80096a94 lays one out: `width` digit cells of 7px,
   *  filled from the low end so the value is right-aligned in the field, with
   *  leading zeros suppressed unless `pad`. Digit d is board clip 0x14 + d. */
  function drawNumber(ctx, value, x, y, width, pad = false) {
    if (!UI) return;
    const { base, advance } = UI.digits;
    let v = Math.max(0, Math.floor(value));
    for (let k = 0; k < width; k++) {
      const d = v % 10;
      if (k > 0 && !pad && d === 0 && Math.floor(v / 10) === 0) break;
      drawClip(ctx, board, base + d, x + (width - (k + 1)) * advance, y);
      v = Math.floor(v / 10);
    }
  }

  /** One card face, composed exactly as F0x8009b168 does: the colour frame
   *  from the card sheet with the record's own 32x32 TIM artwork showing
   *  through its 30x28 window, then the AP/HP readout in the frame's lower
   *  bar. `kind` follows the sprite's unk45: 1 = a Digimon card face, 2 = the
   *  reverse a flip turns it into (card clip 0x10), 3 = the standalone kind
   *  (card clip 0x0C).
   *
   *  UNRESOLVED, and flagged rather than smoothed over: the earlier screen
   *  decode also routes PROGRAM cards to card clip 0x10, because that is what
   *  the clip looked like on its own. The flip's `unk45 ^= 3` now shows clip
   *  0x10 is the reverse of a Digimon face, so the two uses collide — either
   *  the Program-card mapping is wrong or clip 0x10 is not a plain card back.
   *  Nothing decoded settles it, so both call sites are left as they are and
   *  the question is recorded. */
  /** The field slot a sprite key stands for, or null for a hand card. The
   *  numbers on a card on the field are the slot's live stats, not the
   *  catalog's printed ones — and specifically the DISPLAYED pair, which
   *  trails the true value by a frame while a ramp is running. */
  function slotFor(key) {
    const m = /^(you|opp):field:(\d+):(\d+)$/.exec(key);
    if (!m || !c.duel) return null;
    const side = m[1] === "you" ? c.duel.player : c.duel.opponent;
    return side.field[Number(m[3])] ?? null;
  }

  /** The card browser: title plate, the card row with the chosen one ringed,
   *  that card's effect text in the panel top-right, and its name on the band
   *  below. See BROWSER for where every number came from.
   *
   *  `ids` is the row, `cursor` the chosen index, `title` the plate's line —
   *  escardgm 0x19 "Your Hand" for the hand selector. The same browser serves
   *  the pile prompts on the disc, retitling itself, which is why the title is
   *  a parameter rather than a constant. */
  function drawHandBrowser(ctx, title, ids, cursor, { rowY = BROWSER.row.y, legend = null, legal = null, marked = null } = {}) {
    if (legend) {
      const g = BROWSER.legend;
      drawWindow(ctx, g.x, g.y, g.w, g.h, CHROME.edge);
      drawText(ctx, legend, g.textX, g.textY);
    }
    // The panel and the plate overlap by four pixels in the capture, with the
    // panel on top, so it is drawn second.
    const t = BROWSER.title;
    drawWindow(ctx, t.x, t.y, t.w, t.h, CHROME.edge);
    drawWindow(ctx, t.x, t.y, t.tabW, t.tabH, CHROME.edge);
    drawText(ctx, title, t.textX, t.textY);
    drawWindow(ctx, BROWSER.text.x, BROWSER.text.y, BROWSER.text.w,
               BROWSER.text.h, CHROME.edge);

    const chosen = ids[cursor] != null ? cardById(ids[cursor]) : null;
    // escardgm 37..41 name the five levels. The catalog's +0x06 is 1..5 over
    // exactly those, bounded in the original by `sltiu ..., 0x6` against the
    // 6-entry table at 0x80083294. The walker carried only "Mega".
    // The disc indexes ES.levels with CARDPAK +0x06, a 1..5 level bounded by
    // `sltiu ..., 0x6` against the 6-entry table at 0x80083294. Our converted
    // catalog does not carry that number — it carries the level as a NAME in
    // `stage`. This read `chosen.level`, which no catalog record has, so the
    // line drew NOTHING, ever: the trigger audit found all five of escardgm
    // 37..41 rendering nowhere in a full duel.
    const level = LEVEL_INDEX[String(chosen?.stage ?? "").toLowerCase()];
    if (level && ES.levels[level - 1]) {
      drawText(ctx, ES.levels[level - 1], BROWSER.text.textX,
               BROWSER.text.textY + 2 * BROWSER.text.lineH);
    }
    // The effect text carries its own line break, and the capture's two lines
    // are exactly the two halves of it.
    (chosen?.effect ?? "").split("\n").slice(0, 2).forEach((line, i) => {
      drawText(ctx, line, BROWSER.text.textX, BROWSER.text.textY + i * BROWSER.text.lineH);
    });

    ids.forEach((id, i) => {
      const x = BROWSER.row.x + i * BROWSER.row.pitch;
      // F0x80086D78 tests every row for legality as it opens and sets +0x49E on
      // the ones that fail — the grey-out flag. The trace's wording is "illegal
      // rows show greyed BEFORE you move", and the cursor does not exist yet at
      // that point (+0x440 = -1), so this is not a per-cursor state.
      drawCard(ctx, cardById(id), x, rowY, { dim: legal ? !legal(id, i) : false });
      const isCursor = i === cursor;
      const isMarked = !!marked && marked.has(i);
      if (!isCursor && !isMarked) return;
      // The cursor rides the decoded CLUT cycle; a MARKED card holds the first
      // row steady, so the cursor stays distinguishable from the marks.
      const row = isCursor
        ? UI.select_clut_cycle[Math.floor(c.ticks / 4) % UI.select_clut_cycle.length]
        : UI.select_clut_cycle[0];
      drawClip(ctx, board, row ? `8#${row}` : 8, x, rowY)
        || drawClip(ctx, board, 8, x, rowY);
    });

    // THE UPPER BAND IS THE AP/HP STRIP. Decoded 2026-08-25 from F0x80086A30,
    // the picker driver's per-cursor detail fill — it was already described in
    // cardgame-plain-descriptions.md and never carried across. Both captured
    // frames had a Program card selected, which is exactly when the strip is
    // suppressed, which is why it looked empty and got recorded as unknown.
    //
    //     if (row->unk144 != 0 && card is not in the table at 0x800A5C20) {
    //         view->unkE7C = 0x1F4;  view->unkE82 = 1;
    //         view->unkE80 = row->unk14B;   // AP
    //         view->unkE81 = row->unk14C;   // HP
    //     } else { view->unkE82 = 0; ... }
    //
    // +0x14B/+0x14C are the row's AP and HP — F0x8009E024 fills them from the
    // slot's +0x734/+0x736, the displayed pair. `unkE82` is the strip's own
    // visible flag, so a Program card gets no strip at all.
    //
    // The five-entry table at 0x800A5C20 reads 68, 111, 154, 197, 240 — which
    // is DYNAMIC_STAT_MEGAS exactly, decoded independently from D0x80083960.
    // Those five carry printed stats that mean nothing because their real ones
    // are computed from the board, and the browser declines to quote them.
    //
    // NOT ESTABLISHED, and left alone: escardgm 64 is "AP\nHP", two lines, but
    // this band measures 20 tall — one line. The label's placement is not
    // decoded, so the values are drawn without it rather than guessing a
    // second row the measurement does not support.
    drawWindow(ctx, BROWSER.detail.x, BROWSER.detail.y, BROWSER.detail.w,
               BROWSER.detail.h, BAND2);
    if (chosen && chosen.kind === "digimon" && !DYNAMIC_STAT_MEGAS.includes(chosen.id)) {
      drawText(ctx, `AP ${chosen.ap}  HP ${chosen.hp}`,
               BROWSER.detail.x + 3, BROWSER.detail.y + 5);
    }
    drawWindow(ctx, BROWSER.name.x, BROWSER.name.y, BROWSER.name.w,
               BROWSER.name.h, BAND2);
    drawText(ctx, chosen?.name ?? "", BROWSER.name.textX, BROWSER.name.textY);
  }

  /** The pile fan's per-card reveal scale, from the picker's open tick. Card i
   *  ramps sx 0 -> 1 over REVEAL_DURATION frames starting at
   *  `(i + 1) * PILE_REVEAL_STAGGER`: the setup zeroes the +0x4D0 cadence and
   *  F0x8009E668 only starts a card once that accumulator has reached 4, so the
   *  first card starts four ticks in and the LAST card's ramp ends exactly at
   *  pileAnimDuration(n) (4n+10). 1 once its ramp has finished. */
  function pileFanScale(i) {
    const age = c.ticks - (c.effectPicker?.t0 ?? c.ticks);
    return Math.max(0, Math.min(1,
      (age - (i + 1) * PILE_REVEAL_STAGGER) / REVEAL_DURATION));
  }

  function drawCard(ctx, cardData, x, y, { dim = false, back = false, stats = null } = {}) {
    if (!UI) return;
    const f = UI.face;
    if (back) {
      drawClip(ctx, card, f.reverse_clip.clip, x, y);
      return;
    }
    if (!cardData) {
      drawClip(ctx, card, f.alt_clip.clip, x, y);
      return;
    }
    // Artwork first, then the frame over it — the frame's border is what crops
    // the record's 32x32 icon to the 30x28 window.
    const [ax, ay, aw, ah] = f.art_window;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + ax, y + ay, aw, ah);
    ctx.clip();
    drawCardIcon(ctx, cardData.id, x + ax - 1, y + ay - 2);
    ctx.restore();
    // A PROGRAM CARD IS NOT A CARD BACK. This drew UI.face.reverse_clip until
    // 2026-08-24, so a face-up Program card rendered as the face-down green
    // swirl; the card browser captured off the disc that day shows them in hand
    // with the same coloured frame and artwork a Digimon gets, and a BLANK
    // strip where the AP/HP pair would be — which is what UI.face.stats.blank
    // is, board clip 30 at the AP position. Face-DOWN is handled by `back`
    // above, from the sprite's own render kind, so nothing here forces it.
    // (The alt clip was tried and is not this: clip 12 is the empty-slot X.)
    const idx = f.frame_by_colour[cardData.colour] ?? 0;
    drawClip(ctx, card, f.frame.base + idx + (dim ? f.frame.alt_add : 0), x, y);
    const st = f.stats;
    if (cardData.kind === "program") {
      drawClip(ctx, board, st.blank.clip, x + st.blank.pos[0], y + st.blank.pos[1]);
      return;
    }
    drawClip(ctx, board, st.sep.clip, x + st.sep.pos[0], y + st.sep.pos[1]);
    drawNumber(ctx, stats ? stats.shownAp : cardData.ap, x + st.ap[0], y + st.ap[1], 2);
    drawNumber(ctx, stats ? stats.shownHp : cardData.hp, x + st.hp[0], y + st.hp[1], 2);
  }

  /** One player's HUD strip, from the 0x4C-byte record at 0x800A59D0 +
   *  player*0x4C that F0x80098898 walks. `rec` is that record, already
   *  resolved to {name: [x, y]} by tools/extract_cardduel_ui.py. */
  /** What the drain is showing on this side's two plaques, or `{}` when no
   *  drain is running. The attacker sees its damage spend down; the defender
   *  sees its HP fall. Neither side's OTHER number moves -- the disc writes
   *  only property 8 on the attacker and property 9 on the defender. */
  function drainOverride(side) {
    const d = c.duel;
    if (!c.view || !d || !d.drain || drainDone(c.view)) return {};
    const attacker = d.drain.side === 0 ? d.player : d.opponent;
    if (side === attacker) return { ap: drainAttackerShown(c.view) };
    return { hp: drainDefenderShown(c.view) };
  }

  function drawPlayerHud(ctx, rec, side, ox, oy) {
    if (!UI) return;
    const aux = UI.aux;
    const k = Math.floor((c.ticks % 36) / 6);
    // The strip's CHROME — the swooshes, the five recessed cube plates, the
    // AP/HP plaques and the two counter plaques — is ONE multi-layer card-sheet
    // clip, named by the record's own byte +0x01 (14 near, 15 far). It is the
    // last draw of F0x80098898:
    //     sp1EC(cardPack, rec->unk1, screen->unkC, screen->unkE)
    // and it is drawn at the record origin with no offset of its own. This is
    // the "board chrome behind the HUD strips" the 2026-08-05 pass listed as
    // not identified; the walker used to draw the readouts bare against the
    // backdrop.
    drawClip(ctx, card, rec.chrome_clip, ox, oy);
    // ---- the side plate (F0x80099F60 -> F0x80099BE4 -> F0x800999A0) --------
    // Drawn just before the HUD strip, so it sits under it. Card clip 0x44 for
    // player 0 / 0x43 for player 1, at the plate position for this language,
    // scaled by the 12/6 turn-marker tween (markerScale 0..0x1000). The table at
    // 0x800A5AA8 lists player 1's plate first, then player 0's.
    {
      const playerIdx = rec === UI.players[0] ? 0 : 1;
      const panel = c.view?.panels?.[playerIdx];
      const plates = UI.score_plates?.[2];
      if (panel && plates && panel.markerState) {
        const [px, py] = plates.plate[playerIdx === 0 ? 1 : 0];
        const s = Math.max(0.0001, (panel.markerScale ?? 0) / WIDGET_SCALE_FULL);
        ctx.save();
        ctx.translate(ox + px, oy + py);
        ctx.scale(s, s);
        drawClip(ctx, card, plates.clip[playerIdx], 0, 0);
        ctx.restore();
      }
    }
    // The five stepped plates are the S-ENERGY readouts, one per energy
    // colour, not field slots: F0x8009edcc refreshes this strip with
    // `unkEA0(view, player, i, energy[i])` for i = 0..4 straight off the
    // five-byte energy block at +0x5A8, and then uses index 5 for the deck
    // count (+0x5A4) and 6 for the hand count (+0x5A6) — which is exactly the
    // counter_a / counter_b pair below. There are five because brown, colour
    // 6, has no energy slot.
    //
    // Each readout is THREE draws, not one. F0x80098898 puts a translucent
    // board-sheet glow (clip 0x0D, `semi`) over the chrome's recess, then the
    // S-ENERGY CUBE from the CARD sheet, then the two-digit count. The cube is
    // the last do-loop of the function:
    //     sp1EC(cardPack, 0x800A5A98[i] + 0x800A5AA0[k], x + rec->unk4, y + rec->unk6)
    // with the same 0x2A step. 0x800A5A98 = [29, 32, 35, 38, 41] is one base
    // per colour — white, blue, green, red, black — and each base has three
    // 16x16 frames that the ping-pong at 0x800A5AA0 walks. Both the cube's own
    // position (record +0x04) and the base table were extracted but never
    // drawn until now.
    //
    // WALKER MAPPING: `k` is taken from the animation index only when that
    // slot's `screen->unk30[i]` byte is set, and nothing yet establishes who
    // sets it — the value setter at 0x8009CAE0 writes the ten readout VALUES
    // and no flag. The walker draws the resting frame, which is what the
    // original draws whenever the flag is clear.
    const tallied = c.view
      ? dealTallyShown(c.view, side === c.duel?.player ? 0 : 1)
      : null;
    const cubeFrame = aux.slot_number_cycle[0];
    for (let i = 0; i < 5; i++) {
      drawClip(ctx, board, `13#${aux.board_clut_cycle[k]}`, ox + rec.field_slots[0] + i * 42, oy + rec.field_slots[1])
        || drawClip(ctx, board, 13, ox + rec.field_slots[0] + i * 42, oy + rec.field_slots[1]);
      drawClip(ctx, card, aux.field_slot_clip_bases[i] + cubeFrame,
               ox + rec.energy_cubes[0] + i * 42, oy + rec.energy_cubes[1]);
      // While the deal is counting, these five come from the ramp rather than
      // the model -- see `case 0x14`. `tallied` is null at every other moment.
      drawNumber(ctx, tallied ? (tallied[i] ?? 0) : (side.energy[ENERGY_COLOURS[i]] ?? 0),
                 ox + rec.field_numbers[0] + i * 42, oy + rec.field_numbers[1], 2);
    }
    // The two labelled totals. The label clips picked for English (index 2 of
    // 0x800A5A70 = board clips 79 and 88) render as literal "AP" and "HP"
    // plates, which is what identifies the pair of 3-digit totals beside them
    // as the player's total field AP and total field HP.
    const [la, lb] = aux.label_clips_by_lang[2];
    drawClip(ctx, board, la, ox + rec.label_a[0], oy + rec.label_a[1]);
    drawClip(ctx, board, lb, ox + rec.label_b[0], oy + rec.label_b[1]);
    // While a fusion is being shown these two plaques climb: the disc's own
    // step 8 tweens them up by the fused pair before committing it.
    const fused = comboShownBonus(side === c.duel?.player ? "you" : "opp");
    // While an attack is draining, these two plaques are driven by the beat
    // rather than by the model. The attacking side's AP counts down to zero as
    // the damage is spent; the defending side's HP falls to its new value. Both
    // are written by F0x80093710 through the panel setter, the AP number as
    // property 8 and the HP number as property 9 -- which is what identifies
    // them: property 8 starts at the attacker's own AP total and property 9 at
    // the defender's current HP, exactly the pair drawn here at rest.
    const drained = drainOverride(side);
    // And while a card is being revealed they travel: the reveal's own update
    // spends fifteen frames moving the four numbers to their exchanged values
    // before the swap is committed. `revealNumbers` is that ramp.
    const shown = revealOverride(side);
    drawNumber(ctx, drained.ap ?? shown.ap ?? (side.totalAp + fused.ap),
               ox + rec.total_a[0], oy + rec.total_a[1], 3);
    drawNumber(ctx, drained.hp ?? shown.hp ?? (side.totalHp + fused.hp),
               ox + rec.total_b[0], oy + rec.total_b[1], 3);
    // The AP and HP plaques carry a translucent board-sheet glow (clip 0x0C)
    // behind them, gated by screen->unk38 / unk39 — the SAME two flags that
    // brighten the AP and HP label clips above. That pairing is what identifies
    // them; the earlier reading, that these two were the deck and trash PILES,
    // is retracted. The real deck and trash sit at the other end of the strip
    // (icon_a / icon_b below), and (23, 48) / (71, 48) land directly under the
    // AP and HP labels at (30, 52) / (78, 52).
    drawClip(ctx, board, 12, ox + rec.pile_a[0], oy + rec.pile_a[1]);
    drawClip(ctx, board, 12, ox + rec.pile_b[0], oy + rec.pile_b[1]);

    // ---- the deck and trash corner -------------------------------------
    // The right-hand end of the strip is two icons with a two-digit count each,
    // and each one has a translucent board-sheet marker (clip 0x0E) behind it:
    //   record +0x28 icon_b  = card clip 0x800A5A88[k] + 6, gated by unk36
    //   record +0x2C icon_a  = card clip 0x800A5A80[k] + 9, gated by unk37
    //   record +0x38 marker_a / +0x3C marker_b = board clip 0x0E, same flags
    // The counts beside them are the ones F0x8009edcc pushes as index 5 and 6,
    // the deck size (+0x5A4) and the hand size (+0x5A6). All four positions
    // were extracted on 2026-08-05 and referenced nowhere until now.
    // WALKER MAPPING: as with the cubes, the animated frame index is gated by
    // an undecoded flag, so the walker draws the resting frame.
    drawClip(ctx, board, 14, ox + rec.marker_a[0], oy + rec.marker_a[1]);
    drawClip(ctx, board, 14, ox + rec.marker_b[0], oy + rec.marker_b[1]);
    drawClip(ctx, card, aux.icon_b_cycle[0] + 6, ox + rec.icon_b[0], oy + rec.icon_b[1]);
    drawClip(ctx, card, aux.icon_a_cycle[0] + 9, ox + rec.icon_a[0], oy + rec.icon_a[1]);
    // the two counters: deck and hand size
    // While the set award is putting the hands back, these two are driven by
    // the beat: the hand count falls and the deck count climbs, one card every
    // three ticks. `returning` is null at every other moment.
    const returning = c.view
      ? handReturnShown(c.view, side === c.duel?.player ? 0 : 1)
      : null;
    drawNumber(ctx, returning ? returning.deck : side.deck.length,
               ox + rec.counter_a[0], oy + rec.counter_a[1], 2);
    drawNumber(ctx, returning ? returning.hand : side.hand.length,
               ox + rec.counter_b[0], oy + rec.counter_b[1], 2);

    // ---- the TRASH PLATE, on the right edge of the board -----------------
    // Three of the record's widgets hang off a SECOND origin, screen->unk20 /
    // unk22, not off the strip origin the rest of the record uses. They are
    // the only part of F0x80098898's record that the walker never drew, and
    // they are the whole of the 2,447 board pixels the 2026-08-24 beat
    // comparison found missing on the right edge:
    //   record +0x03 (byte)  the plate itself, a card-sized panel carrying the
    //                        trash-can icon and the recess for its count.
    //                        Card clip 47 near, 48 far, at +0x30 from the alt
    //                        origin = (-7, -22) near, (-7, -6) far.
    //   record +0x40  alt    board clip 0x0F, at (-6, -20) / (-6, -5). Gated
    //                        by screen->unk35, and CLEAR in the reference
    //                        capture — it is a 28x41 highlight frame, not a
    //                        resting part of the plate, so the walker leaves
    //                        it off. Drawing it unconditionally, the way the
    //                        strip's 0x0C and 0x0E glows are drawn, put a
    //                        yellow border round both plates that the disc
    //                        does not have.
    //   record +0x14  alt    the two-digit count, at (1, -15) / (1, 21).
    // The trash-can engraved in the plate's larger recess is a fourth draw,
    // and the alt origin is its own position: card clip 49 at (0, 0), one of
    // the three-frame runs 49/50/51 that every cycled icon in this screen
    // uses. That is not read off a table — it is measured. Clip 49 matches
    // web/assets/ref/cardduel/board-dealt.png with ZERO error over all 150 of
    // its opaque pixels at (288, 80) AND at (288, 143), which are exactly the
    // two alt origins.
    // The count is screen->unk28, and 0x8009CAE0's ten-entry jump table pins
    // it: index 7 stores per-player block +0x5A2, the TRASH count — the same
    // field cardgame-discard-appends-to-trash-at-block-0x614 increments when a
    // card is discarded. So the plate is the discard pile, and the trash-can
    // engraved on it is the game naming itself.
    //
    // The alt origin takes NO 50Hz correction: F0x80098898's +/-0xC prologue
    // adjusts unkE, the strip origin, and these hang off unk22. That is what
    // the reference capture shows — the plates land at (281, 121) near and
    // (281, 74) far, which is exactly alt_ntsc + the record's own offsets with
    // no PAL term. Source: UI.strip_origin.alt_ntsc.
    const alt = rec.alt;
    const [ax, ay] = ALT_ORIGIN[rec === UI.players[0] ? 0 : 1];
    drawClip(ctx, card, rec.alt_card_clip, ax + alt.alt_card[0], ay + alt.alt_card[1]);
    drawClip(ctx, card, ALT_ICON_BASE + aux.alt_marker_cycle[0], ax, ay);
    drawNumber(ctx, side.trash.length, ax + alt.alt_number[0], ay + alt.alt_number[1], 2, true);
  }

  /** The board backdrop every duel screen sits on: board clip 0, the 30-tile
   *  field, drawn at (t, t) with t = (ticks >> 1) & 0x3F and faded in over its
   *  12 CLUT rows (F0x80096950). */
  function drawBackdrop(ctx, vw, vh) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, vw, vh);
    const t = (c.ticks >> 1) & 0x3F;
    const fade = Math.min(UI.backdrop.clut_rows - 1, c.ticks >> 2);
    drawClip(ctx, board, fade ? `0#${fade}` : 0, t, t) || drawClip(ctx, board, 0, t, t);
  }

  /** The challenge screen: an amber title over the opponent's level and the
   *  name of the folder they are playing. See CHALLENGE_TITLE_COLOR.
   *
   *  WALKER FALLBACK: a duel opened with no CARD_NPC record — the UI lab's
   *  own entry point, and any caller that passes only a name — has neither a
   *  level nor a folder name to draw, so the second line carries the opponent
   *  name instead. The disc always has a record here. */
  function drawChallenge(ctx, vw, vh) {
    drawBackdrop(ctx, vw, vh);
    drawBanner(ctx, BANNER_BAND, "Card Battle Challenge", CHALLENGE_TITLE_COLOR);
    drawPrompt(ctx, record
      ? [`LV ${record.level ?? 1}`, record.folderName ?? ""]
      : ["", pendingOpen?.opponentName ?? ""]);
  }

  /** The live horizontal scale of chooser row `i`, from F0x80096418's +0x5C.
   *  Returns null while the row is not on screen. See CHOOSER.arriveFrames /
   *  closeFrames for the decoded 12-tick grow and 6-tick shrink.
   *
   *  The take-down schedule is states 13/15/17 of F0x8009F110, so plate `i`
   *  leaves `closeStart + i*closeStep` ticks after the confirm — NOT on the
   *  confirm frame, and NOT in the order the player picked. */
  function chooserRowScale(i) {
    if (!c.chooser) return null;
    const closing = c.chooser.closing ?? null;
    if (closing) {
      const t = (c.ticks - closing.t0) - (CHOOSER.closeStart + i * CHOOSER.closeStep);
      // A plate that has not had its turn yet is still at FULL width: state 10
      // holds for fifteen ticks with nothing moving, and states 13/15/17 take
      // the plates down in folder order. Only a plate whose own turn has come
      // shrinks, over six drawn frames — the first of which is still full, then
      // 5/6, 4/6, 3/6, 2/6, 1/6 — and then it is gone.
      if (t < 0) return 1;
      if (t >= CHOOSER.closeFrames) return null;
      return 1 - t / CHOOSER.closeFrames;
    }
    const t = c.ticks - (c.chooser.t0 ?? 0) - (CHOOSER.arriveTicks[i] ?? 0);
    if (t < 0) return null;
    return Math.min(1, t / CHOOSER.arriveFrames);
  }

  /** The title band's own width. The band is up for the whole chooser and comes
   *  down over six units starting `bandOutTick` ticks after the confirm, because
   *  state 19 writes the record in mode 3 with both counters at 6 (F0x8009BF5C);
   *  before that it is full width. See CHOOSER.bandText for where the words come
   *  from and where the six comes from. */
  function chooserBandScale(closeAge) {
    if (closeAge < 0) return WIDGET_SCALE_FULL;
    const t = closeAge - CHOOSER.bandOutTick;
    if (t < 0) return WIDGET_SCALE_FULL;
    if (t >= CHOOSER.bandOutFrames) return 0;
    return WIDGET_SCALE_FULL * (1 - t / CHOOSER.bandOutFrames);
  }

  /** The cursor marker is created on state 7 and shrinks away on state 11, five
   *  ticks after the fifteen-tick hold — so between those two the screen carries
   *  no cursor at all, and the chosen row is a plain row again. */
  function chooserMarkerUp(age, closeAge) {
    if (age < CHOOSER.cursorTick) return false;
    return closeAge < 0 || closeAge < CHOOSER.markerGoneTick;
  }

  /** The three plate sounds (states 1, 3 and 5) and the three take-down sounds
   *  (states 13, 15 and 17) are one event each, fired from the frame that puts
   *  the plate on or off the screen. The draw is this screen's clock — it is
   *  already what calls `beginDuel` when the last plate is gone — so the sounds
   *  are raised here rather than from a second timer. */
  function chooserPlateSounds(age, closeAge) {
    const heard = c.chooser.heard ?? (c.chooser.heard = [0, 0, 0]);
    CHOOSER.arriveTicks.forEach((tick, i) => {
      if (closeAge >= 0 || age < tick) return;
      if (heard[i]) return;
      heard[i] = 1;
      sfx?.play(DUEL_SOUND.pass);
    });
    if (closeAge < 0) return;
    CHOOSER.arriveTicks.forEach((_, i) => {
      const at = CHOOSER.closeStart + i * CHOOSER.closeStep;
      if (closeAge < at) return;
      if (heard[i] === 2) return;
      heard[i] = 2;
      sfx?.play(DUEL_SOUND.cancel);
    });
  }

  /** The folder chooser. See CHOOSER for where every number comes from. */
  function drawChooser(ctx, vw, vh) {
    drawBackdrop(ctx, vw, vh);
    const folders = cards().folders;
    const age = c.ticks - (c.chooser.t0 ?? 0);
    const closing = c.chooser.closing ?? null;
    const closeAge = closing ? c.ticks - closing.t0 : -1;
    chooserPlateSounds(age, closeAge);
    // State 1 raises this band through `open_info_banner` in slot 5 of the six
    // info banners, with escardgm 0x41 as its text; state 19 takes it down.
    drawBanner(ctx, CHOOSER_BAND, CHOOSER.bandText, null, chooserBandScale(closeAge));
    const markerUp = chooserMarkerUp(age, closeAge);
    folders.forEach((folder, i) => {
      const y = CHOOSER.rowY[i];
      if (y == null) return;
      // The row grows/shrinks in WIDTH only, about its left edge. The pivot was
      // not read out of the primitive's own origin, so the left edge is the
      // walker's choice (the plates all start at CHOOSER.rowX).
      const sx = chooserRowScale(i);
      if (sx == null || sx <= 0) return;
      ctx.save();
      ctx.translate(CHOOSER.rowX, y);
      ctx.scale(sx, 1);
      ctx.translate(-CHOOSER.rowX, -y);
      // The marker keeps drawing through the confirm one-shot, then shrinks away
      // on state 11; only its CLUT row changes (looping vs min(counter>>1,7)).
      const on = markerUp && i === c.chooser.cursor;
      if (on) {
        const row = chooserRow(age - CHOOSER.cursorTick, !!closing);
        drawClipAtPaletteRow(ctx, card, CHOOSER.rowClip.on, row, CHOOSER.rowX, y);
      } else {
        drawClip(ctx, card, CHOOSER.rowClip.off, CHOOSER.rowX, y);
      }
      drawText(ctx, folder.name ?? `Folder ${i + 1}`,
               CHOOSER.rowX + CHOOSER.titleAt[0], y + CHOOSER.titleAt[1]);
      const counts = folderColours(folder);
      UI.labels.forEach(([lx], j) => {
        drawClip(ctx, card, CHOOSER.cubeBase[j],
                 CHOOSER.rowX + lx + CHOOSER.cubeDX, y + CHOOSER.cubeDY);
        const text = String(counts[j]);
        drawText(ctx, text, CHOOSER.rowX + lx - textWidth(text), y + CHOOSER.numberY);
      });
      ctx.restore();
    });
    // State 21 is where the duel is built and this routine returns 1.
    if (closing && closeAge >= CHOOSER.loadTick) beginDuel(closing.folder);
  }

  // ── held-direction repeat ──────────────────────────────────────────────
  // The disc's pickers read the pad service's REPEAT word as well as its
  // pressed word: the hand selector F0x800875AC and the summon selector
  // F0x800878B4 OR 0x8004B7D0->unk3FC with unk3F4 for direction bits 7/5, and
  // the folder chooser F0x8009F110 does the same for the up/down bits 4/6
  // (claims cardgame-folder-chooser-pad-arms-2026-09-13; CARD-Q006). So a held
  // direction walks those cursors on the shared edge/16/6/4 curve. The keydown
  // path fires the edge; this fires the repeats from the real frame loop.
  // Scoped to the screens whose both-words read is decoded: the two-option
  // toggles (the yes/no prompt, the summon confirm) and the walker's own
  // inspect menu are left on the edge press.
  c._held = { up: 0, down: 0, left: 0, right: 0 };
  function heldRepeatDirs() {
    if (!c._open) return [];
    if (c.challenge) return [];
    if (c.chooser) return ["up", "down"];
    const d = c.duel;
    if (!d) return [];
    if (c.effectPicker || c.picker) return ["left", "right"];
    if (c.play && c.play.stage === "pick") return ["left", "right"];
    if (phase(d).key === "summon" && !announcing() && summonTurnSide(d) === d.player
        && !c.summonConfirm && !boardBusy()) return ["left", "right"];
    return [];
  }
  /** Debug/verifier entry: one frame of held-key processing. */
  c.stepHeld = (heldKeys) => {
    if (!c._open || !heldKeys) return;
    const dirs = heldRepeatDirs();
    for (const dir of ["up", "down", "left", "right"]) {
      if (dirs.includes(dir) && heldKeys.has?.(dir)) {
        const n = (c._held[dir] ?? 0) + 1;
        c._held[dir] = n;
        if (n > 1 && padRepeatFires(n)) c.handleKey(dir);
      } else {
        c._held[dir] = 0;
      }
    }
  };

  c.draw = (ctx, w, h, state = null) => {
    if (!c._open) return;
    if (state?.keys) c.stepHeld(state.keys);
    if (!c.duel && !c.chooser && !c.challenge) return;
    const d = c.duel;
    const s = Math.max(1, Math.min(w / 320, h / 240));
    ctx.save();
    ctx.scale(s, s);
    const vw = w / s, vh = h / s;
    ctx.imageSmoothingEnabled = false;
    c.ticks++;

    const ready = UI && packReady(card) && packReady(board);
    if (ready && c.challenge) {
      drawChallenge(ctx, vw, vh);
      ctx.restore();
      return;
    }
    if (ready && c.chooser) {
      drawChooser(ctx, vw, vh);
      ctx.restore();
      return;
    }
    if (!ready) {
      ctx.fillStyle = "#0a0a20";
      ctx.fillRect(0, 0, vw, vh);
      drawText(ctx, "Loading...", 20, 22);
      ctx.restore();
      return;
    }

    drawBackdrop(ctx, vw, vh);

    // The per-player records are offsets from the strip origin F0x80099440
    // parks them at, corrected for 50Hz by F0x80098898's prologue. See
    // PLAYER_ORIGIN.
    // A PHASE ANNOUNCEMENT IS A BARE BOARD. Every announcement frame in the
    // capture set — draw-phase.png, load-phase.png, start-phase.png,
    // challenge.png, folder-choose.png — shows the banner and the prompt window
    // over the scrolling backdrop and NOTHING else: no cards, no HUD strips, no
    // score plates. The walker used to leave the whole board up underneath, so
    // the prompt window sat across the opponent's row and the announcement read
    // as a bug rather than a beat. The board comes back when you confirm.
    // The set-end beat is NOT a bare board: it plays over the emptying field
    // and the score plates it is rolling.
    const bare = announcing() && !c.play && !c.picker && !c.effectPicker
      && !d.outcome && !c.setEnd;
    // THE CARD BROWSER TAKES THE SCREEN. In the captures of state 4 the board's
    // rows are empty and the browser's own card row stands in their place; only
    // the two HUD strips stay. So the board's sprites are not drawn under it.
    const browsing = !!c.play && c.play.stage === "pick";
    // The Summon Phase opens the same browser, on your turn, once the phase has
    // announced itself. Its top HUD strip is not drawn — the legend stands
    // where it would be.
    const summonBrowsing = !c.play && !c.picker && !c.effectPicker && !c.setEnd
      && !d.outcome && !announcing() && phase(d).key === "summon"
      && !!d.summonTurns && summonTurnSide(d) === d.player;
    const hud = hudVisible() && !bare;
    if (hud) {
      // The FAR strip is absent for the whole of the Summon Phase browser: the
      // captured frame has bare backdrop above y 24 and the phase legend at
      // y 25, where that strip's own row would be.
      if (!summonBrowsing) {
        drawPlayerHud(ctx, UI.players[1], d.opponent, PLAYER_ORIGIN[1][0], hudOriginY(c.view, 1));
      }
      drawPlayerHud(ctx, UI.players[0], d.player, PLAYER_ORIGIN[0][0], hudOriginY(c.view, 0));

      // The score plates (card clips 0x44 / 0x43) at the decoded per-country
      // positions, country 0.
      const sp = UI.score_plates[0];
      drawClip(ctx, card, sp.clip[1], sp.plate[1][0], sp.plate[1][1]);
      drawClip(ctx, card, sp.clip[0], sp.plate[0][0], sp.plate[0][1]);
      // shownScore, not the model's own: the counter holds its pre-set value
      // until the fifty-one-tick roll has run.
      drawNumber(ctx, shownScore(1), sp.label[1][0], sp.label[1][1], 2);
      drawNumber(ctx, shownScore(0), sp.label[0][0], sp.label[0][1], 2);
    }

    // ---- the animated cards ---------------------------------------------
    // Step every sprite first and then draw them, which is the order
    // F0x8009bac8 uses, and draw in its two layer passes: sprites with a
    // non-zero `layer` (+0x26) go behind, zero in front. That is what keeps a
    // summoning card over the row it is landing in.
    stepSprites();
    stepCoin();
    // ---- the centre-plate wipes (view+0xDC0) ------------------------------
    // A small plate wipes in under the slot a card was played to and shrinks
    // away when the row clears. F0x80096C20 draws it at table 0x800A5978 with
    // clip payload+6 and the record's vertical animScale (+0x02); the mode
    // byte the reader F0x80096CF0 switches on is the one +0xEA4/+0xEA8 write.
    // Claim centre-plate-modes-are-open-close-plates-on-the-played-slots-2026-09-14.
    if (!bare && !browsing) {
      c.view.plates.forEach((p, i) => {
        if (p.state === 0) return;
        const o = VIEW_PLATE_ORIGINS[i];
        const sy = Math.max(0, p.animScale) / 0x1000;
        if (sy <= 0) return;
        ctx.save();
        ctx.translate(o.x + 4, o.y + 0x17);
        ctx.scale(1, sy);
        ctx.translate(-(o.x + 4), -(o.y + 0x17));
        drawClip(ctx, board, viewPlateClip(p.payload), o.x, o.y);
        ctx.restore();
      });
    }
    const inSummon = !d.outcome && phase(d).key === "summon";
    const handKeys = [...c.sprites.keys()].filter((k) => k.startsWith("you:hand:"));

    for (const pass of (bare || browsing || summonBrowsing) ? [] : [1, 0]) {
      for (const [key, rec] of c.sprites) {
        const s = rec.sprite;
        if (s.state === CardAnimState.hidden) continue;
        if ((s.layer !== 0 ? 1 : 0) !== pass) continue;

        const x = toPx(s.x), y = toPx(s.y);
        // While the picker is up it owns the cursor and the dimming, and the
        // hand's own selection highlight is suppressed.
        // keyOf is `side:zone:cardId:index`, so the slot index is the LAST
        // component, not the card id in front of it.
        const pickSlot = c.picker ? /^you:field:\d+:(\d+)$/.exec(key) : null;
        const pickIndex = pickSlot ? Number(pickSlot[1]) : -1;
        // While a card's program is asking, its own cursor owns the board: the
        // card it is on is lit and everything else is dimmed. While you are
        // choosing which card to PLAY, the cursor runs over your hand and the
        // cards that cannot be played are dimmed — the disc's two gates.
        const chosenKey = effectChoiceKey();
        const playIndex = c.play ? handSlotOfKey(key) : -1;
        const isCursor = chosenKey
          ? key === chosenKey
          : c.play
            ? playIndex === c.play.cursor
            : c.picker
              ? pickIndex === c.picker.cursor
              : inSummon && key === handKeys[c.handCursor];
        const dim = chosenKey
          ? key !== chosenKey
          : c.play
            ? (playIndex >= 0 ? !playableSlot(playIndex) : false)
            : c.picker
              ? (pickIndex >= 0 ? c.picker.dimmed[pickIndex] === true : true)
              : inSummon && key.startsWith("you:hand:") && !isCursor;

        // The pivot is the decoded (20, 23) — the card's own centre — so a
        // scale animation grows the card about its middle rather than its
        // corner, and a flip closes onto its spine.
        const [pvx, pvy] = UI.card.pivot;
        ctx.save();
        ctx.translate(x + pvx, y + pvy);
        ctx.scale(s.scaleX / SCALE_ONE, s.scaleY / SCALE_ONE);
        ctx.translate(-(x + pvx), -(y + pvy));

        drawCard(ctx, cardById(rec.cardId), x, y, {
          dim,
          back: s.renderKind === CardRenderKind.reverse,
          stats: slotFor(key),
        });

        // The select border rides with the card, so it follows the cursor even
        // while the row is re-flowing.
        if (isCursor) {
          const row = UI.select_clut_cycle[Math.floor(c.ticks / 4) % UI.select_clut_cycle.length];
          drawClip(ctx, board, row ? `8#${row}` : 8, x, y) || drawClip(ctx, board, 8, x, y);
        }

        // The active border (board clip 9) is drawn ONLY for the settle state,
        // cycling its CLUT row from the same counter the settle counts in.
        if (s.state === CardAnimState.settle) {
          const r = Math.floor(s.duration / 2) % 5;
          drawClip(ctx, board, r ? `9#${r}` : 9, x, y) || drawClip(ctx, board, 9, x, y);
        }
        ctx.restore();

        // The effect clip run plays over the card at the card's own position,
        // unscaled — F0x8009a998 builds its own context rather than inheriting
        // the sprite's.
        if (s.effect) {
          const run = UI.effects[String(s.effect)];
          if (run) {
            const f = cardEffectFrame(s.effect, rec.effectT, run.order);
            drawClip(ctx, board, run.base + f, x, y);
          }
        }
      }
    }

    // ---- the Start Phase ceremony's two cards ---------------------------
    // The pair is drawn on the board like any other card: the same 40x46 face,
    // the same decoded (20, 23) pivot so the flip closes onto the card's spine,
    // and the same select border (board clip 8) on whichever one the cursor is
    // over. The capture shows the selected card sitting 5px higher, which is
    // the lift.
    if (c.coin) {
      const k = c.coin;
      k.sprites.forEach((sp, i) => {
        if (sp.state === CardAnimState.hidden) return;
        const chosen = k.step >= 3 ? i === k.cursor : false;
        const lifted = k.step === 2 ? i === k.cursor : chosen;
        const x = toPx(sp.x);
        const y = toPx(sp.y) + (lifted ? 0 : COIN_LIFT);
        const [pvx, pvy] = UI.card.pivot;
        ctx.save();
        ctx.translate(x + pvx, y + pvy);
        ctx.scale(sp.scaleX / SCALE_ONE, sp.scaleY / SCALE_ONE);
        ctx.translate(-(x + pvx), -(y + pvy));
        const face = k.faces[i] != null ? cardById(k.faces[i]) : null;
        drawCard(ctx, face, x, y, {
          back: sp.renderKind === CardRenderKind.reverse,
          dim: k.step === 2 && i !== k.cursor,
        });
        if (k.step === 2 && i === k.cursor) {
          const row = UI.select_clut_cycle[Math.floor(c.ticks / 4) % UI.select_clut_cycle.length];
          drawClip(ctx, board, row ? `8#${row}` : 8, x, y) || drawClip(ctx, board, 8, x, y);
        }
        ctx.restore();
      });
      // No band at all while you are picking: the captures of the pick
      // (coin-choose.png, coin-reveal.png) show the two cards over a bare
      // board, and the prompt window would sit exactly on top of them. Only
      // the result gets a band, and it is the plain banner — first-player.png
      // shows "You go first." in the banner band with no prompt window under
      // it. Both strings are escardgm.toml verbatim.
      if (k.step >= 4 && k.message) drawBanner(ctx, BANNER_BAND, k.message);
      ctx.restore();
      return;
    }

    // Phase banner + prompt, escardgm.toml verbatim, in the captured chrome:
    // the banner band at y=66 with its title centred, and — while the phase is
    // still announcing itself — the prompt window at y=96. Once the phase is
    // being played the window goes away and the board is left uncovered, which
    // is what every captured play frame shows.
    if (c.picker) {
      // The picker names the run's resolved target. That id is the decoded
      // one: the run's CARDPAK +0x0a card when an instance of it is in the
      // duel, else the fixed substitute 0x13B — so a run whose target is not
      // present reads as the substitute here too, exactly as the screen shows.
      const run = pickedRun();
      const target = run ? cardById(run.displayId) : null;
      drawBanner(ctx, BANNER_BAND, run
        ? `${target?.name ?? "?"}${run.substituted ? " (substitute)" : ""}`
        : "Not part of a combo");
    } else if (c.setEnd) {
      // The set-end beat. Nothing is announced while the row drains or while
      // the counter rolls; the result window opens when the roll has run.
      if (c.setEnd.step === "result") {
        drawBanner(ctx, BANNER_BAND, setEndLine());
      } else if (c.setEnd.step === "second") {
        // escardgm 19, "Current score" — state 0xE's own window, and the last
        // line before the duel-over test. It is NOT the roll's caption: the
        // counter rolls under nothing, and the window comes up once the set
        // line has been taken down.
        drawBanner(ctx, BANNER_BAND, ES.currentScore);
      } else if (c.setEnd.step === "overTest") {
        drawBanner(ctx, BANNER_BAND, duelResultLine());
      }
      // States 0xA, 0xB and 0x12 put nothing on the band: the roll runs under
      // the board, and the two sweeps are the cards leaving it. Neither does the
      // "partner" step: state 0x15 calls the sub-screen F0x8009DEC4 and then
      // raises a window through view+0xEE4 with duel+0x2EC, and what that window
      // says is NOT read, so nothing is drawn for it here rather than guessed.
      // The press still ends the duel from it — state 0x17 is a pad gate like
      // the rest.
    } else if (d.outcome) {
      // The DUEL's own result, which is a different pair of lines from a set's:
      // escardgm 0x17/0x18, "You won this battle!" / "You lost this battle!".
      // A draw cannot reach here — two sets always decide it — but the third
      // line is kept for the case the rules engine ever reports one.
      //
      // escardgm 0x15/0x16 are those two strings, on the same indexing the set
      // windows 0x10..0x12 are checked against in tests/cardduel-ui.test.js.
      //
      // NOT DECODED, and deliberately not invented: whether this is the window
      // the disc opens here. State 0x15 opens a message whose id is read per
      // opponent from the halfword table at 0x800A5C2C, and that table was
      // located but never read, so whether beating someone names a prize card is
      // NOT established
      // (cardgame-there-is-no-end-of-duel-score-screen-2026-08-24, limitation 2).
      // The sub-screen F0x8009DEC4 raises underneath it is unread as well.
      drawBanner(ctx, BANNER_BAND, duelResultLine());
    } else if (c.effectPicker && duelChoice(d)) {
      // The owed choice takes the banner while it is outstanding. WALKER TEXT:
      // which line the disc raises here is chosen inside the opcode's own
      // handler and has not been read.
      // THE PILE PROMPTS ARE TITLED FROM THE BANK. escardgm 25..30 are exactly
      // the six pile names — Your Hand / Deck / Trash and the opponent's three
      // — and the disc's own picker is one browser that retitles itself, which
      // is why drawHandBrowser takes the title as a parameter. The walker used
      // to invent "Select a Card from the Folder" and friends; those are gone.
      const choice = duelChoice(d);
      const mine = choice.side === d.player;
      // CORRECTED 2026-08-30 against the header select itself. The title is not
      // chosen from the zone name: `tickPilePicker` (F0x8008C044, state 1)
      // indexes an eleven-entry jump table at 0x8008346C with `duel+0x438 - 5`
      // and stores the id it lands on into 0x800A5DA4. Its six live entries are
      //   5 -> 25   7 -> 26   9 -> 27   11 -> 28   13 -> 29   15 -> 28
      // and the last one is the point: the opponent's trash (15) reaches the
      // SAME word as the opponent's hand (11), so the disc titles an opponent
      // trash picker "Opponent Hand". escardgm 30, "Opponent Trash", exists and
      // this browser never asks for it. Reproduced rather than corrected.
      const title = choice.kind === "board" ? ES.noDigimonAffected
        : choice.zone === "hand"  ? (mine ? ES.yourHand  : ES.oppHand)
        : choice.zone === "deck"  ? (mine ? ES.yourDeck  : ES.oppDeck)
        :                           (mine ? ES.yourTrash : ES.oppHand);
      drawBanner(ctx, BANNER_BAND, choice.kind === "board" ? "Select a Digimon" : title);
      drawPrompt(ctx, [effectChoiceCard()?.name ?? ES.noCards]);

      // THE PILE IS FANNED OUT. A pile picker spreads the WHOLE pile across the
      // centre row so you can see every card in it, at the `cardFanOut` count>=7
      // pitch `0xF600 / count`.
      //
      // DECODED 2026-08-25 from run 1 of the rig captures joined to the opcode
      // latch `duel+0x421`:
      //
      //   frame 1759  +0x421 <- 0xAC   the pile picker opens
      //   frame 1761  a 34-sprite fan appears across y=97, x 24..262
      //   frame 2135  +0x440 <- 6      the selection commits
      //   frame 2136  +0x421 <- 0x42   take the chosen card into hand
      //   frame 2137  the hand count rises 5 -> 6
      //   frame 2138  the fan is dismissed, every sprite to state `off`
      //
      // 34 is a 40-card folder less the six drawn, and it is the ONLY count
      // that reproduces the captured x positions — 33 and 35 both diverge by
      // the fifth. All four cards carrying 0xAC have the same shape: sweep a
      // pile (0x32/0x34/0x35), 0xAC to pick from it, 0x42 to take it —
      // Deceive Cloak, Digimon Charge, Program Charge and Trade Charge.
      if (choice.kind === "pile") {
        const pile = choice.zone === "hand" ? choice.side.hand
                   : choice.zone === "deck" ? choice.side.deck : choice.side.trash;
        const n = pile.length;
        const cur = choice.slots[c.effectPicker?.cursor ?? 0];
        // THE PILE FANS OUT EDGE-ON, THEN REVEALS ONE CARD EVERY FOUR FRAMES.
        // The setup F0x8009DBE8 puts every card at its final fan x/y and sets
        // its sx to 0 (`sh $zr, 0x120($s4)`, cardgame.s 27729); the updater
        // F0x8009E668 starts card i's 10-frame linear sx 0 -> 1 once its +0x4D0
        // cadence reaches 4 (then subtracts 4), so card i starts at tick 4i and
        // the whole widget window is pileAnimDuration(n). Nothing moves in y and
        // there is no fade (claim pile-fan-reveals-one-card-every-four-frames-
        // 2026-09-14). The card face's pivot is (20,23), so the width scales
        // about the card's centre.
        pile.forEach((id, i) => {
          const x = DUEL_BOARD.rowX + (cardFanOut(n, i) >> 8);
          const sx = pileFanScale(i);
          if (sx <= 0) return;
          ctx.save();
          ctx.translate(x + 20, DUEL_BOARD.centreY);
          ctx.scale(sx, 1);
          ctx.translate(-(x + 20), -DUEL_BOARD.centreY);
          drawCard(ctx, cardById(id), x, DUEL_BOARD.centreY,
                   { dim: !choice.slots.includes(i) });
          ctx.restore();
        });
        // the committed card rides above the fan at full width
        if (cur != null && pile[cur] != null) {
          drawCard(ctx, cardById(pile[cur]),
                   DUEL_BOARD.rowX + (cardFanOut(n, cur) >> 8), DUEL_BOARD.centreY);
        }
      }
    } else if (c.play && !inspectOwnsScreen()) {
      // CHOOSING A CARD IS NOT AN ANNOUNCEMENT. The walker used to keep the
      // phase banner up and re-draw the announcement's own window — escardgm
      // 0x6/0xA, "Select and use a Program Card." — full width across the
      // board for the whole selection, which put a 320x48 window straight over
      // the centre row at y 97..143 and read as a stuck announcement. That
      // string belongs to the phase announcement, which is dismissed before any
      // of this runs.
      if (c.play.stage === "ask") {
        // State 2's two-option box: escardgm 0xE with two answers stacked, the
        // cursor moving between them. Measured off the disc — see PLAY_BOX.
        drawPlayBox(ctx, PLAY_ASK.question, PLAY_ASK.answers, c.play.ask,
                    c.view ? promptProgress(c.view) : undefined);
      } else if (c.play.stage === "pick") {
        // State 4 is the CARD BROWSER, measured off the disc — see BROWSER.
        // "Your Hand" is escardgm 0x19.
        // escardgm 57 retitles the browser while a discard is owed; 25 otherwise.
        drawSelectorBanners(ctx);
        drawHandBrowser(ctx, discardPrompt() ?? ES.yourHand, d.player.hand, c.play.cursor,
          { legal: (id) => browserRowLegal(d, d.player, id) });
        // escardgm 23/46..56 — why the card under the cursor cannot be played.
        // The bank carries thirteen of these refusals and the walker showed none.
        const why = refusalLine(c.play.cursor);
        if (why) {
          drawText(ctx, why, BROWSER.text.textX,
                   BROWSER.text.textY + 3 * BROWSER.text.lineH);
        }
      }
      // STATE 6, THE COMMIT, DRAWS NOTHING HERE. The walker raised an invented
      // "Are you sure?" box; the only disc frames captured at state 6
      // (duel_f01141, duel_f01143) are a bare backdrop with no window, no HUD
      // and no cards. The step itself is real and stays — it is the take-back
      // point, and cardduel-playing-a-card-is-pick-confirm-commit-with-a-take-
      // back-2026-08-21 is verified — but WHAT IT DRAWS IS NOT ESTABLISHED:
      // the rig run that produced those frames auto-confirmed straight through
      // state 6, so it may simply not have been on screen long enough to catch.
      // Capturing it needs a run that holds at lc == 6 rather than pressing
      // through it. Until then the walker draws nothing rather than a guess.
    } else if (summonBrowsing && !inspectOwnsScreen()) {
      // Same browser, the row five pixels lower, plus the phase's own legend.
      // escardgm 15 asks before a summon; 59 is the refusal when the field is
      // already full. Both were in the bank and rendered nowhere.
      drawSelectorBanners(ctx);
      drawHandBrowser(ctx,
        d.player.field.length >= FIELD_LIMIT ? ES.tooManyDigimon : ES.yourHand,
        d.player.hand, c.handCursor,
        { rowY: BROWSER.summonRowY, legend: BROWSER.legend.text,
          marked: c.summonMarks,
          // Deliberately browserRowLegal and NOT canSummon: F0x80085FD0 has no
          // field-limit gate. A full field greys nothing — it retitles the
          // browser, which the title above already does.
          legal: (id) => browserRowLegal(d, d.player, id) });
      // The "Put in Field?" confirm, raised by Square on the marked set.
      if (c.summonConfirm) {
        drawPlayBox(ctx, ES.putInField, ["Yes", "No"], c.summonConfirm.answer,
                    undefined, CONFIRM_BOX);
      }
    } else if (announcing()) {
      // THE ANNOUNCEMENT IS NOT GATED ON THE BOARD. It owns the screen — `bare`
      // above already suppresses the cards, the HUD and the score plates — so
      // whether a sprite is still moving underneath is irrelevant to whether the
      // banner draws.
      //
      // FIXED 2026-08-25. This used to sit inside the `!boardBusy()` arm below,
      // which meant the Load Phase announcement NEVER rendered: the phase is
      // entered while the deal's twelve sprites are still running their 20-frame
      // move and flip wave, so `boardBusy()` was true for the whole announce and
      // the banner was swallowed. Measured: the banner band carried 1851/1798/
      // 1832/2006 lit pixels at Start/Draw/Summon/Compile and **0** at Load.
      //
      // The disc clears the board between the deal and the Load announcement —
      // a completely bare frame — and only then raises the band, so the
      // announcement genuinely does not wait on the deal.
      const p = phase(d);
      const bannerScale = c.view?.banners[5]?.animScale ?? WIDGET_SCALE_FULL;
      const promptScale = c.view && c.view.prompt.layoutIndex === 1
        ? promptProgress(c.view) : WIDGET_SCALE_FULL;
      drawBanner(ctx, BANNER_BAND, p.banner, null, bannerScale);
      drawPrompt(ctx, [p.prompt], promptScale);
    } else if (!boardBusy()) {
      // NOT while the board is animating. The deal is a beat of its own: the
      // dealt-board capture web/assets/ref/cardduel/board-dealt.png carries no
      // banner and no prompt window at all, and the walker used to raise the
      // NEXT phase's announcement the instant the phase stepped — so the six
      // cards flew in underneath a full-width prompt window that covered the
      // opponent's whole row. The bands wait for the board to settle.
      // THE BANNER IS PART OF THE ANNOUNCEMENT, NOT OF THE PHASE. The walker
      // drew the phase title for the whole phase, so a "Load Phase" band sat
      // across the opponent's row from the deal until the phase ended. No disc
      // frame outside the announcement carries one: the post-deal board
      // (duel_f00797), the board mid-phase (duel_f00959), the card browser and
      // the played card all have bare chrome at y 66..85 where the walker had a
      // window. Measured 2026-08-24: at y 75 the disc reads the board's own
      // (184,136,144) and the walker read the band's (8,8,56).
    }

    // ---- the fusion beat --------------------------------------------------
    // The combined card at the decoded placement, and the name plate over the
    // fusing side's own row. Both are drawn after the sprite layer so the card
    // stands over the board, which is what sprite slot 0x11 does on the disc.
    if (c.combo) {
      const entry = c.combo.queue[c.combo.i];
      if (entry && c.combo.step !== "wait") {
        const face = cardById(entry.run.displayId);
        const score = comboRunScore(entry.run);
        const [cx, cy] = COMBO_BEAT.cardAt;
        // The fused card carries the RUN'S OWN numbers: the build writes the
        // summed pair into the announcement's two stat bytes (+0x657/+0x658)
        // before the sequence starts.
        drawCard(ctx, face, cx, cy, { stats: { shownAp: score.ap, shownHp: score.hp } });
        if (c.combo.step === "plate" && face) {
          const [px, py] = COMBO_BEAT.plateAt[entry.sideKey];
          const w = Math.max(48, textWidth(face.name) + 12);
          drawWindow(ctx, px, py, w, 20, CHROME.edge);
          drawText(ctx, face.name, px + 6, py + 5);
        }
      }
    }

    // THE NAME PLATE. Same decoded position as the fusion beat's, because the
    // reference sheets show the same band naming a played Program card, a pass
    // and a summon. Drawn after the sprites so the card it names cannot cover
    // it, and suppressed while the fusion beat owns the plate itself.
    if (c.namePlate && !c.combo) {
      // The played card's own effect text rides in message box 2, the high one
      // the table puts at (0, 50) with its first line at (27, 68).
      if (c.namePlate.effectText) {
        const E = EFFECT_TEXT_BOX;
        drawWindow(ctx, E.x, E.y, 320, E.h, CHROME.edge);
        c.namePlate.effectText.split("\n").slice(0, 2).forEach((line, i) => {
          drawText(ctx, line, E.textX, E.textY + i * E.lineH);
        });
      }
      const [px, py] = COMBO_BEAT.plateAt[c.namePlate.sideKey] ?? COMBO_BEAT.plateAt.you;
      const w = Math.max(48, textWidth(c.namePlate.text) + 12);
      drawWindow(ctx, px, py, w, 20, CHROME.edge);
      drawText(ctx, c.namePlate.text, px + 6, py + 5);
    }

    // The two-sided name banners ride in on the decoded endpoints. Side 0 comes
    // from the right and side 1 from the left, which is what the two opposite
    // travel senses mean. `hold` is each side's fixed cross-axis value — it has
    // identical endpoints in both coordinate sets, so it is a position, not an
    // animation; reading it as the plate's y is an INFERENCE, not decoded.
    // ...but not over an announcement. No capture in the set — challenge.png,
    // folder-choose.png, start-phase.png, draw-phase.png, load-phase.png —
    // carries a name plate, and drawing them there left "You" hanging off the
    // left edge and "Challenger" across the middle of every phase title.
    // ...and no name plate over the set-end beat either, for the same reason
    // no capture carries one over an announcement.
    for (const side of (bare || c.setEnd) ? [] : [0, 1]) {
      const t = bannerProgress(side);
      if (t <= 0) continue;
      // Side 0 is the opponent, and the disc names them by the FOLDER they are
      // playing, not by the NPC: the plate branch for message id 0x3e draws
      // escardgm string 0x3e ("LV") with CARD_NPC byte +0xC8 beside it, and the
      // escrddek folder name for record (id+1)/2 on the line below.
      // — CARDGAME-ESCRDDEK-NAMES-ARE-OPPONENT-FOLDERS-2026-08-14,
      //   CARDNPC-BYTE-C8-IS-THE-OPPONENT-LEVEL-2026-08-14.
      // `record.name` never existed on a CARD_NPC record, so this banner always
      // read "Challenger" before today.
      const label = side === 0
        ? (record?.folderName ?? "Challenger")
        : "You";
      const p = BANNER_SIDES[side];
      const x = Math.round(p.hidden + (p.shown - p.hidden) * t);
      drawText(ctx, label, x, p.hold);
      // The level rides above the name. The disc's own plate puts the number
      // 0x23 right of and 0xe above the name (F0x80097ACC's (+0x3e,+4) against
      // (+0x1b,+0x12)); this banner is a different surface with its own decoded
      // endpoints, so the OFFSET is carried over but its placement here is an
      // inference, not a decoded coordinate.
      if (side === 0 && record?.level != null) {
        drawText(ctx, `LV ${record.level}`, x + 0x23, p.hold - 0xE, { scale: 0.7 });
      }
    }

    // The grey flash goes over EVERYTHING, so it is the last thing drawn: state
    // 0xB creates the overlay with all three colour arguments 0x80 and a life
    // of ten, at the same moment it starts the roll.
    // — cardbattle-set-counter-roll-is-51-ticks-with-a-grey-flash-2026-08-21
    // WALKER: how it BLENDS was not read — the claim covers the colour and the
    // life and says so — so it is drawn as a flat half-opaque wash rather than
    // a guessed PS1 transparency mode.
    // The inspect menu sits over the picker it was opened from.
    drawInspect(ctx);

    if (c.setEnd?.step === "roll" && c.setEnd.t < SETEND_FLASH) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "rgb(128,128,128)";
      ctx.fillRect(0, 0, 320, 240);
      ctx.restore();
    }

    // A7 — the wash is the last thing drawn in the original, over everything.
    // Black with alpha = the subtractive live colour.
    const wv = washValue();
    if (wv > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, wv);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 320, 240);
      ctx.restore();
    }

    ctx.restore();
  };

  return c;
}
