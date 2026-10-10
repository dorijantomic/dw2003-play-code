// engine/systems/card-view.ts — the card duel's HUD panels, name plates,
// prompt window A, info banners, wipe plates, and marker pool.
//
// Decoded 2026-08-26 from pro/cardgame.s; see
// docs/research/card/cardduel-animation-atlas-2026-08-26.md.
//
// The view holds two 0x54-byte HUD panels: side 0 (player, bottom of screen)
// at view+0x60 and side 1 (opponent, top) at view+0xB4. Commands:
//
//   F0x8009C264  resetPanels
//   F0x8009C2D0  slideBothPanelsIn    duration 20
//   F0x8009C350  slideBothPanelsOut   duration 10
//   F0x8009C3C0  slidePanelIn(side)   duration 10
//   F0x8009C438  slidePanelOut(side)  duration 5
//   F0x8009C4A4  growTurnMarker(side)  duration 12
//   F0x8009C4D8  shrinkTurnMarker(side) duration 6
//   F0x8009C054  openPrompt           duration 12, sfx 0x00040019
//   F0x8009C0DC  closePrompt          duration 6,  sfx 0x0004001A
//   F0x8009C124  confirmPrompt        duration 10, sfx 0x8004503C
//   F0x8009C16C  setPromptCursor
//   F0x8009BEAC  openBanner            duration 12, sfx 0x00040019
//   F0x8009BF5C  closeBanner           duration 6,  sfx 0x0004001A
//                (cardduel.h names this refreshGroup — wrong; it is the
//                 teardown half of openBanner)
//   F0x8009BE40  openPlate             duration 10
//   F0x8009BE78  closePlate            duration 5
//   F0x8009BFCC  placeMarker
//   F0x8009C010  slideMarker
//
// Panel tick: F0x80099440. Name-plate tick: F0x80099BE4. Both run from
// F0x80099f60 (name plates first). Prompt tick: F0x80097ACC.
// Banner tick: F0x80097508. Plate tick: F0x80096CF0. Marker tween:
// F0x80099D18, only while state==2 (F0x80099ED4).
// Positions are integer pixels. The lerp is C truncation-toward-zero.
//
// NOTHING in the cardgame overlay calls placeMarker or slideMarker. Slots
// +0xEDC and +0xEE0 are installed by F0x8009D310 and never loaded. The
// pool is decoded and implemented here but currently unreachable, and
// what the 12 markers depict is NOT established.
//
// The original draws each panel unconditionally (F0x80098898). There is no
// visibility flag anywhere. A panel is on- or off-screen only because its y
// is: 0xF1 sits below the 240px screen, -0x64 sits above it.
//
// Tick folding: stepPanels also steps the name plates (same parent as the
// overlay). Banners, plates, markers, and the prompt each have a sibling
// tick. stepCardView runs all of them.

/** Linear countdown lerp used by every HUD widget: dest - (dest-start)*timer/duration.
 *  C integer division truncates toward zero, so this uses Math.trunc, not Math.floor. */
export function widgetLerp(
  dest: number, start: number, timer: number, duration: number,
): number {
  if (duration === 0) return dest;
  return dest - Math.trunc(((dest - start) * timer) / duration);
}

/** Shared widget tick: count `timer` down by `delta`. Expired timers store 0. */
export function stepWidget(
  timer: number, delta: number,
): { timer: number; expired: boolean } {
  const next = timer - delta;
  if (next > 0) return { timer: next, expired: false };
  return { timer: 0, expired: true };
}

export type HudSide = 0 | 1;

/** Animation states of panel+0x04. 0 and 2 are idle; 1/3 move both widgets;
 *  4/5 move the panel y only and park the deck/pile and banner at hidden. */
export const HudPanelState = {
  idleHidden: 0,
  slideBothIn: 1,
  idleShown: 2,
  slideBothOut: 3,
  slideOneIn: 4,
  slideOneOut: 5,
} as const;
export type HudPanelStateValue =
  (typeof HudPanelState)[keyof typeof HudPanelState];

export const PANEL_SLIDE_BOTH_IN_DURATION = 20;
export const PANEL_SLIDE_BOTH_OUT_DURATION = 10;
export const PANEL_SLIDE_ONE_IN_DURATION = 10;
export const PANEL_SLIDE_ONE_OUT_DURATION = 5;

/** resetPanels parks bannerX here, not at the hidden endpoint 0x13A.
 *  Deliberate and decoded from F0x8009C264 (`li $v1, 0x140`); do not "fix". */
export const PANEL_RESET_BANNER_X = 0x140;

/** slideBothPanelsIn writes this to side 1's subX instead of hidden 0x147.
 *  Deliberate and decoded from F0x8009C2D0 (`li $v0, 0xf9`); the first tick
 *  of state 1 overwrites it with the lerp, which starts at 0x147. */
export const PANEL_SLIDE_BOTH_IN_SIDE1_SUB_X = 0xf9;

export const PANEL_SHOWN = [
  { y: 0x8d, subX: 0x120, subY: 0x8f, bannerX: 0x113, bannerY: 0xbd },
  { y: 0x00, subX: 0x120, subY: 0x50, bannerX: 0x113, bannerY: 0x26 },
] as const;

export const PANEL_HIDDEN = [
  { y: 0xf1, subX: 0x147, subY: 0x8f, bannerX: 0x13a, bannerY: 0x13a },
  { y: -0x64, subX: 0x147, subY: 0x50, bannerX: 0x13a, bannerY: 0x13a },
] as const;

/** Full size for the turn-marker scale and the prompt wipe. The original's << 12
 *  against this 0x1000 is the same arithmetic as widgetLerp(0x1000, 0, ...). */
export const WIDGET_SCALE_FULL = 0x1000;

export const TurnMarkerState = {
  closed: 0,
  opening: 1,
  open: 2,
  closing: 3,
} as const;
export type TurnMarkerStateValue =
  (typeof TurnMarkerState)[keyof typeof TurnMarkerState];

export const TURN_MARKER_GROW_DURATION = 12;
export const TURN_MARKER_SHRINK_DURATION = 6;

export const PromptState = {
  idle: 0,
  opening: 1,
  open: 2,
  confirming: 4,
  closing: 5,
} as const;
export type PromptStateValue =
  (typeof PromptState)[keyof typeof PromptState];

export const PROMPT_OPEN_DURATION = 12;
export const PROMPT_CLOSE_DURATION = 6;
export const PROMPT_CONFIRM_DURATION = 10;

/** openPrompt. Do not play from this module. */
export const PROMPT_OPEN_SFX = 0x00040019;
/** closePrompt. Do not play from this module. */
export const PROMPT_CLOSE_SFX = 0x0004001a;
/** confirmPrompt. Do not play from this module. */
export const PROMPT_CONFIRM_SFX = 0x8004503c;

/** Table at 0x800A59B0, {s32 x; s32 y} × 4. Index 3 is the wide layout:
 *  same origin as index 1; the width is a draw-path special, not a table row. */
export const PROMPT_LAYOUT = [
  { x: 0, y: 0x8a },
  { x: 0, y: 0x60 },
  { x: 0, y: 0x32 },
  { x: 0, y: 0x60 },
] as const;
export const PROMPT_LAYOUT_WIDE = 3;

export const PROMPT_CURSOR_X = 0x14;
export const PROMPT_CURSOR_ROW_STRIDE = 0x0e;
export const PROMPT_CURSOR_Y_BIAS = 0x11;

/** One HUD panel: the original's 0x54-byte object, named rather than offset-addressed. */
export interface HudPanel {
  timer: number;     // +0x00  counts DOWN by the frame delta
  duration: number;  // +0x02  the lerp divisor
  state: number;     // +0x04
  doneFlag: number;  // +0x06  one-shot; the tick clears 1 or 2 when it reads them
  phase: number;     // +0x08  free-running; panel commands never touch it
  x: number;         // +0x0C  stays 0; y is the axis that actually moves
  y: number;         // +0x0E
  subX: number;      // +0x20  the deck/pile widget
  subY: number;      // +0x22
  bannerX: number;   // +0x3C  the wide banner
  bannerY: number;   // +0x3E
  // Name plate, panel+0x48. Which axis markerScale drives is NOT ESTABLISHED:
  // F0x800999a0 passes it to a resident helper as (scale, 0x1000, 0x1000).
  markerScale: number;     // +0x48  s16; 0x1000 = full size
  markerTimer: number;     // +0x4C  s16, counts down
  markerDuration: number;  // +0x4E  s16
  markerState: number;     // +0x50  u8
}

/** Prompt window A at view+0xDE4. */
export interface PromptWindow {
  layoutIndex: number; // +0xDE4  s32
  messageId: number;   // +0xDE8  s32
  timer: number;       // +0xDF0  s16, counts down
  duration: number;    // +0xDF2  s16
  cursorRow: number;   // +0xDF4  s16
  state: number;       // +0xDFA  u8
  style: number;       // +0xDFB  u8
  /** Wipe progress 0..0x1000, the original's $s8 for the draw. */
  progress: number;
}

export const INFO_BANNER_COUNT = 6;
export const INFO_BANNER_OPEN_DURATION = 12;
export const INFO_BANNER_CLOSE_DURATION = 6;
export const INFO_BANNER_OPEN_SFX = 0x00040019;
export const INFO_BANNER_CLOSE_SFX = 0x0004001a;
/** value 0x1F4: a blank sentinel (F0x80097508 state 2, kind-4 path). */
export const INFO_BANNER_BLANK = 0x1f4;

/** Index meanings from F0x80086A30. Index 5's content is NOT established. */
export const InfoBannerSlot = {
  name: 0,
  costPip: 1,
  categoryIcon: 2,
  apHpBox: 3,
  messageLine: 4,
} as const;

export const InfoBannerState = {
  idle: 0,
  opening: 1,
  open: 2,
  closing: 3,
} as const;
export type InfoBannerStateValue =
  (typeof InfoBannerState)[keyof typeof InfoBannerState];

/** One of six info banners at view+0xE0C, stride 0x18. */
export interface InfoBanner {
  x: number;          // +0x00 s16
  y: number;          // +0x02 s16
  animScale: number;  // +0x04 s16
  fixedScale: number; // +0x06 s16
  timer: number;      // +0x08 s16
  duration: number;   // +0x0A s16
  kind: number;       // +0x0C s16
  value: number;      // +0x10 s32
  state: number;      // +0x17 u8
}

export const VIEW_PLATE_COUNT = 3;
export const VIEW_PLATE_OPEN_DURATION = 10;
export const VIEW_PLATE_CLOSE_DURATION = 5;
/** Table 0x800A5978: three packed {s16 x, s16 y}. */
export const VIEW_PLATE_ORIGINS = [
  { x: 73, y: 97 },
  { x: 123, y: 97 },
  { x: 173, y: 97 },
] as const;
/** Drawer clip = payload + 6 (F0x80096c20). */
export const VIEW_PLATE_CLIP_BIAS = 6;

export const ViewPlateState = {
  idle: 0,
  opening: 1,
  open: 2,
  closing: 3,
} as const;
export type ViewPlateStateValue =
  (typeof ViewPlateState)[keyof typeof ViewPlateState];

/** One of three wipe plates at view+0xDC0, stride 0x0C.
 *  What they depict is NOT established — no call site names them. */
export interface ViewPlate {
  fixedScale: number; // +0x00 s16
  animScale: number;  // +0x02 s16
  timer: number;      // +0x04 s16
  duration: number;   // +0x06 s16
  state: number;      // +0x08 s16
  payload: number;    // +0x0A s16  clip id; drawer uses payload+6
}

export const MARKER_COUNT = 12;
export const MARKER_SHEET = 0x025d0003;
export const MarkerState = {
  unused: 0,
  parked: 1,
  tweening: 2,
} as const;
export type MarkerStateValue =
  (typeof MarkerState)[keyof typeof MarkerState];

/** One of twelve markers at view+0xCE8, stride 0x12.
 *  What they depict is NOT established. */
export interface ViewMarker {
  x: number;        // +0x00 s16
  y: number;        // +0x02 s16
  startX: number;   // +0x04
  startY: number;   // +0x06
  destX: number;    // +0x08
  destY: number;    // +0x0A
  phase: number;    // +0x0C u16
  timer: number;    // +0x0E u8
  duration: number; // +0x0F u8
  state: number;    // +0x10 u8
}

export interface CardView {
  panels: [HudPanel, HudPanel];
  prompt: PromptWindow;
  /** The SECOND prompt window. The view installs a complete parallel set of
   *  four methods for it — `openPromptB` +0xEF4, `closePromptB` +0xEF8,
   *  `confirmPromptB` +0xEFC and `setPromptCursorB` +0xF00 — with the same
   *  12/6/10-frame timings as window A. It is what the in-duel inspect menu
   *  opens its five rows in, which is why it is here.
   *  — cardduel-inspect-menu-opens-on-triangle-from-a-picker-2026-08-27 */
  promptB: PromptWindow;
  banners: InfoBanner[];
  plates: ViewPlate[];
  markers: ViewMarker[];
  drain: DrainState;
  dealTally: DealTallyState;
  handReturn: HandReturnState;
  /** The menu marker's pulse clock. See MARKER_PULSE_CYCLE. */
  blink: number;
  /** The card reveal's counter ramp. See REVEAL_RAMP_FRAMES. */
  reveal: RevealRamp;
}

/** The card reveal's counter ramp — ceremony beat 0x1B, step 3.
 *
 *  The reveal does not simply swap the two sides' totals and move on. Its update
 *  machine spends a bounded tween on the swap: step 3 accumulates a per-frame
 *  delta and branches at FIFTEEN, so the four numbers on the two panels travel
 *  toward each other over fifteen frames before the stored totals change hands
 *  (model doc G.12, and the assignment block quoted in card-battle.ts). The
 *  plate is up over it the whole time and the machine then waits for a press.
 *
 *  The walker used to apply the swap with nothing moving; this is the movement.
 *  Which curve the disc's accumulator traces was not decoded — only that it is
 *  bounded at fifteen — so the walker walks it straight, and says so. */
export const REVEAL_RAMP_FRAMES = 15;

export interface RevealTotals {
  playerAp: number; playerHp: number; opponentAp: number; opponentHp: number;
}

export interface RevealRamp {
  running: boolean;
  tick: number;
  from: RevealTotals;
  to: RevealTotals;
}

function blankReveal(): RevealRamp {
  const zero = { playerAp: 0, playerHp: 0, opponentAp: 0, opponentHp: 0 };
  return { running: false, tick: 0, from: { ...zero }, to: { ...zero } };
}

/** Begin the ramp. `from` is what the panels read now, `to` what they will read
 *  once the sides have exchanged. */
export function startReveal(view: CardView, from: RevealTotals, to: RevealTotals): void {
  view.reveal.running = true;
  view.reveal.tick = 0;
  view.reveal.from = { ...from };
  view.reveal.to = { ...to };
}

export function stepReveal(view: CardView, delta = 1): void {
  const r = view.reveal;
  if (!r.running) return;
  r.tick += delta;
  if (r.tick >= REVEAL_RAMP_FRAMES) { r.tick = REVEAL_RAMP_FRAMES; r.running = false; }
}

/** What the four panel numbers read this frame, or null when no ramp is up.
 *  Straight-line, and rounded the way a counter reads rather than a float. */
export function revealNumbers(view: CardView): RevealTotals | null {
  const r = view.reveal;
  if (!r.running && r.tick === 0) return null;
  const t = Math.min(1, r.tick / REVEAL_RAMP_FRAMES);
  const at = (a: number, b: number) => Math.round(a + (b - a) * t);
  return {
    playerAp: at(r.from.playerAp, r.to.playerAp),
    playerHp: at(r.from.playerHp, r.to.playerHp),
    opponentAp: at(r.from.opponentAp, r.to.opponentAp),
    opponentHp: at(r.from.opponentHp, r.to.opponentHp),
  };
}

/** Take the ramp down, so the panels go back to reading the model. */
export function clearReveal(view: CardView): void {
  view.reveal.running = false;
  view.reveal.tick = 0;
}

/** The inspect menu's marker PULSES; it does not simply blink.
 *
 *  It is an instance of the executable's colour-cycling display class, built by
 *  `F0x8001B364` and ticked by `F0x8001B0A4`. That class holds a rest colour for
 *  its LONG period (field 0x74), then steps through a colour list at its SHORT
 *  period (field 0x78) and drops back to rest. The marker is constructed with
 *  0x74 = 0x20 and 0x78 = 6 (`exe-decomp/c/F0x8001b364.c:15-16`), so:
 *
 *      rest 32 frames, then four steps of 6 frames, then rest again
 *
 *  — a 56-frame cycle. The list has five entries and the fifth wraps back to
 *  rest (`F0x8001b0a4.c:62-72`, its `>= 5` bound). The five entries are palette
 *  ids and the third and fifth are the SAME one, so the pulse brightens through
 *  three and comes back through one. The walker keeps the shape and picks its
 *  own colours: what those palettes hold is in video memory, not in the data. */
export const MARKER_PULSE_REST_FRAMES = 0x20;
export const MARKER_PULSE_STEP_FRAMES = 6;
export const MARKER_PULSE_PHASES = 5;
export const MARKER_PULSE_CYCLE =
  MARKER_PULSE_REST_FRAMES + (MARKER_PULSE_PHASES - 1) * MARKER_PULSE_STEP_FRAMES;

/** Which of the five colours the marker is showing, 0 being the rest colour.
 *  Phases 1..4 are the pulse and each lasts 6 frames. */
export function markerPulsePhase(view: CardView): number {
  const t = view.blink % MARKER_PULSE_CYCLE;
  if (t < MARKER_PULSE_REST_FRAMES) return 0;
  return 1 + Math.floor((t - MARKER_PULSE_REST_FRAMES) / MARKER_PULSE_STEP_FRAMES);
}

function blankPanel(): HudPanel {
  return {
    timer: 0, duration: 0, state: 0, doneFlag: 0, phase: 0,
    x: 0, y: 0, subX: 0, subY: 0, bannerX: 0, bannerY: 0,
    markerScale: 0, markerTimer: 0, markerDuration: 0, markerState: 0,
  };
}

function blankPrompt(): PromptWindow {
  return {
    layoutIndex: 0, messageId: 0, timer: 0, duration: 0,
    cursorRow: 0, state: 0, style: 0, progress: 0,
  };
}

function blankBanner(): InfoBanner {
  return {
    x: 0, y: 0, animScale: 0, fixedScale: 0,
    timer: 0, duration: 0, kind: 0, value: 0, state: 0,
  };
}

function blankPlate(): ViewPlate {
  return {
    fixedScale: 0, animScale: 0, timer: 0, duration: 0, state: 0, payload: 0,
  };
}

function blankMarker(): ViewMarker {
  return {
    x: 0, y: 0, startX: 0, startY: 0, destX: 0, destY: 0,
    phase: 0, timer: 0, duration: 0, state: 0,
  };
}

export function createCardView(): CardView {
  const view: CardView = {
    panels: [blankPanel(), blankPanel()],
    prompt: blankPrompt(),
    promptB: blankPrompt(),
    banners: Array.from({ length: INFO_BANNER_COUNT }, blankBanner),
    plates: Array.from({ length: VIEW_PLATE_COUNT }, blankPlate),
    markers: Array.from({ length: MARKER_COUNT }, blankMarker),
    drain: blankDrain(),
    dealTally: blankDealTally(),
    handReturn: blankHandReturn(),
    blink: 0,
    reveal: blankReveal(),
  };
  resetPanels(view);
  return view;
}

function otherSide(side: HudSide): HudSide {
  return (side ^ 1) as HudSide;
}

/** Instant. Both panels to the hidden endpoints, state 0, timer 0, duration 0, x 0.
 *  bannerX is 0x140, not hidden 0x13A (decoded quirk). bannerY is the SHOWN
 *  value, not hidden 0x13A — also decoded, also not a transcription error. */
export function resetPanels(view: CardView): void {
  for (const side of [0, 1] as const) {
    const p = view.panels[side];
    const hidden = PANEL_HIDDEN[side];
    const shown = PANEL_SHOWN[side];
    p.timer = 0;
    p.duration = 0;
    p.state = HudPanelState.idleHidden;
    p.x = 0;
    p.y = hidden.y;
    p.subX = hidden.subX;
    p.subY = hidden.subY;
    p.bannerX = PANEL_RESET_BANNER_X;
    p.bannerY = shown.bannerY;
  }
}

/** Duration 20, state 1 on both, doneFlag 2 on side 0 only. */
export function slideBothPanelsIn(view: CardView): void {
  for (const side of [0, 1] as const) {
    const p = view.panels[side];
    const hidden = PANEL_HIDDEN[side];
    const shown = PANEL_SHOWN[side];
    p.state = HudPanelState.slideBothIn;
    p.timer = PANEL_SLIDE_BOTH_IN_DURATION;
    p.duration = PANEL_SLIDE_BOTH_IN_DURATION;
    p.x = 0;
    p.y = hidden.y;
    p.subX = side === 1 ? PANEL_SLIDE_BOTH_IN_SIDE1_SUB_X : hidden.subX;
    p.subY = hidden.subY;
    p.bannerX = PANEL_RESET_BANNER_X;
    p.bannerY = shown.bannerY;
  }
  view.panels[0].doneFlag = 2;
}

/** Duration 10, state 3 on both, both pre-set to their shown endpoints. */
export function slideBothPanelsOut(view: CardView): void {
  for (const side of [0, 1] as const) {
    const p = view.panels[side];
    const shown = PANEL_SHOWN[side];
    p.state = HudPanelState.slideBothOut;
    p.timer = PANEL_SLIDE_BOTH_OUT_DURATION;
    p.duration = PANEL_SLIDE_BOTH_OUT_DURATION;
    p.x = 0;
    p.y = shown.y;
    p.subX = shown.subX;
    p.subY = shown.subY;
    p.bannerX = shown.bannerX;
    p.bannerY = shown.bannerY;
  }
}

/** Duration 10, state 4 on `side`, doneFlag 2 on it, hidden y. Freezes the other side. */
export function slidePanelIn(view: CardView, side: HudSide): void {
  const p = view.panels[side];
  p.state = HudPanelState.slideOneIn;
  p.doneFlag = 2;
  p.timer = PANEL_SLIDE_ONE_IN_DURATION;
  p.duration = PANEL_SLIDE_ONE_IN_DURATION;
  p.x = 0;
  p.y = PANEL_HIDDEN[side].y;
  view.panels[otherSide(side)].state = HudPanelState.idleHidden;
}

/** Duration 5, state 5 on `side`, shown y. Freezes the other side. No doneFlag write. */
export function slidePanelOut(view: CardView, side: HudSide): void {
  const p = view.panels[side];
  p.state = HudPanelState.slideOneOut;
  p.timer = PANEL_SLIDE_ONE_OUT_DURATION;
  p.duration = PANEL_SLIDE_ONE_OUT_DURATION;
  p.x = 0;
  p.y = PANEL_SHOWN[side].y;
  view.panels[otherSide(side)].state = HudPanelState.idleHidden;
}

/** Slot +0xED0; the board view grows a side's turn marker over 12 frames.
 *  The duel drives it at a turn's open — cardgame.fns.s .L0x0001d4ec calls
 *  `+0xED0(view, 1)` and .L0x0001d5c8 `+0xED0(view, 0)` as each side's turn
 *  starts. Duration 12, markerState 1, markerScale 0. */
export function growTurnMarker(view: CardView, side: HudSide): void {
  const p = view.panels[side];
  p.markerState = TurnMarkerState.opening;
  p.markerDuration = TURN_MARKER_GROW_DURATION;
  p.markerTimer = TURN_MARKER_GROW_DURATION;
  p.markerScale = 0;
}

/** Slot +0xED4; the board view shrinks a side's turn marker away over 6 frames.
 *  cardgame.fns.s .L0x0001d474 calls `+0xED4(view, 0)` when the turn ends.
 *  Duration 6, markerState 3, markerScale 0x1000. */
export function shrinkTurnMarker(view: CardView, side: HudSide): void {
  const p = view.panels[side];
  p.markerState = TurnMarkerState.closing;
  p.markerDuration = TURN_MARKER_SHRINK_DURATION;
  p.markerTimer = TURN_MARKER_SHRINK_DURATION;
  p.markerScale = WIDGET_SCALE_FULL;
}

/** The marker's Digimon icon is drawn ONLY while markerState == 2 (F0x800999A0). */
export function turnMarkerShowsIcon(view: CardView, side: HudSide): boolean {
  return view.panels[side].markerState === TurnMarkerState.open;
}

/**
 * openPrompt takes FIVE arguments — the fifth, layoutIndex, is read off the
 * stack (F0x8009C054 `lw 0x38($sp)`). A four-argument declaration is wrong.
 */
export function openPrompt(
  view: CardView,
  messageId: number,
  style: number,
  cursorRow: number,
  layoutIndex: number,
): void {
  const p = view.prompt;
  p.duration = PROMPT_OPEN_DURATION;
  p.timer = PROMPT_OPEN_DURATION;
  p.cursorRow = cursorRow;
  p.messageId = messageId;
  p.style = style;
  p.layoutIndex = layoutIndex;
  p.state = PromptState.opening;
  // A full timer means the wipe is at its start. The original derives the
  // drawn scale from the timer each frame; this model stores it, so it must be
  // set here or the freshly opened window paints the PREVIOUS owner's scale
  // for one frame (measured: a layout-0 negotiation inheriting 0x1000*5/6 from
  // a closing layout-1 banner). That stale frame reads as the box jumping
  // backwards and is the residual flakes of verify_cardduel_prompt_wipe.
  p.progress = scaleFromTimer(p.timer, p.duration, true);
}

export function closePrompt(view: CardView): void {
  const p = view.prompt;
  p.duration = PROMPT_CLOSE_DURATION;
  p.timer = PROMPT_CLOSE_DURATION;
  p.state = PromptState.closing;
}

export function confirmPrompt(view: CardView): void {
  const p = view.prompt;
  p.duration = PROMPT_CONFIRM_DURATION;
  p.timer = PROMPT_CONFIRM_DURATION;
  p.state = PromptState.confirming;
}

/** Writes cursorRow only. */
export function setPromptCursor(view: CardView, row: number): void {
  view.prompt.cursorRow = row;
}

/** Window B's opener, `+0xEF4` / `0x8009C174`. Same shape and the same 12
 *  frames as window A; the duel keeps both up at once, which is the whole
 *  reason there are two. */
export function openPromptB(
  view: CardView,
  messageId: number,
  style: number,
  cursorRow: number,
  layoutIndex: number,
): void {
  const p = view.promptB;
  p.duration = PROMPT_OPEN_DURATION;
  p.timer = PROMPT_OPEN_DURATION;
  p.cursorRow = cursorRow;
  p.messageId = messageId;
  p.style = style;
  p.layoutIndex = layoutIndex;
  p.state = PromptState.opening;
  p.progress = scaleFromTimer(p.timer, p.duration, true);
}

/** Window B's teardown, `+0xEF8` / `0x8009C1CC`. Six frames. */
export function closePromptB(view: CardView): void {
  const p = view.promptB;
  p.duration = PROMPT_CLOSE_DURATION;
  p.timer = PROMPT_CLOSE_DURATION;
  p.state = PromptState.closing;
}

/** Window B's confirm, `+0xEFC` / `0x8009C214`. Ten frames, then it closes
 *  itself — the same auto-close window A does. */
export function confirmPromptB(view: CardView): void {
  const p = view.promptB;
  p.duration = PROMPT_CONFIRM_DURATION;
  p.timer = PROMPT_CONFIRM_DURATION;
  p.state = PromptState.confirming;
}

/** Window B's cursor, `+0xF00` / `0x8009C25C`. Writes cursorRow only. */
export function setPromptCursorB(view: CardView, row: number): void {
  view.promptB.cursorRow = row;
}

function requireIndex(index: number, count: number, label: string): void {
  if (index < 0 || index >= count) {
    throw new RangeError(`${label} index ${index} is outside 0..${count - 1}`);
  }
}

/**
 * openBanner. sfx 0x00040019 — do not play from this module.
 * Index 0 = name, 1 = cost pip, 2 = category icon, 3 = AP/HP box,
 * 4 = message line. Index 5's content is NOT established.
 */
export function openBanner(
  view: CardView, index: number, kind: number, value: number, x: number, y: number,
): void {
  requireIndex(index, INFO_BANNER_COUNT, "openBanner");
  const b = view.banners[index]!;
  b.x = x;
  b.y = y;
  b.animScale = 0;
  b.fixedScale = WIDGET_SCALE_FULL;
  b.timer = INFO_BANNER_OPEN_DURATION;
  b.duration = INFO_BANNER_OPEN_DURATION;
  b.kind = kind;
  b.value = value;
  b.state = InfoBannerState.opening;
}

/**
 * closeBanner. cardduel.h calls this `refreshGroup` — that name is WRONG;
 * it is the teardown half of openBanner (F0x8009BF5C / +0xEB0).
 * Does NOT touch x, y, kind, or value: the banner keeps its contents
 * while it closes. sfx 0x0004001A — do not play from this module.
 */
export function closeBanner(view: CardView, index: number): void {
  requireIndex(index, INFO_BANNER_COUNT, "closeBanner");
  const b = view.banners[index]!;
  b.animScale = WIDGET_SCALE_FULL;
  b.fixedScale = WIDGET_SCALE_FULL;
  b.state = InfoBannerState.closing;
  b.timer = INFO_BANNER_CLOSE_DURATION;
  b.duration = INFO_BANNER_CLOSE_DURATION;
}

export function viewPlateClip(payload: number): number {
  return payload + VIEW_PLATE_CLIP_BIAS;
}

/**
 * openPlate. Index is `duel+0x575 - 1`. plays-made-this-turn is 0..3, so
 * the index is 0..2 and fits the three entries exactly.
 */
export function openPlate(view: CardView, index: number, clip: number): void {
  requireIndex(index, VIEW_PLATE_COUNT, "openPlate");
  const p = view.plates[index]!;
  p.fixedScale = WIDGET_SCALE_FULL;
  p.animScale = 0;
  p.timer = VIEW_PLATE_OPEN_DURATION;
  p.duration = VIEW_PLATE_OPEN_DURATION;
  p.state = ViewPlateState.opening;
  p.payload = clip;
}

/** closePlate. Payload UNTOUCHED — it keeps its graphic while it shrinks. */
export function closePlate(view: CardView, index: number): void {
  requireIndex(index, VIEW_PLATE_COUNT, "closePlate");
  const p = view.plates[index]!;
  p.fixedScale = WIDGET_SCALE_FULL;
  p.animScale = WIDGET_SCALE_FULL;
  p.state = ViewPlateState.closing;
  p.timer = VIEW_PLATE_CLOSE_DURATION;
  p.duration = VIEW_PLATE_CLOSE_DURATION;
}

export function placeMarker(view: CardView, index: number, x: number, y: number): void {
  requireIndex(index, MARKER_COUNT, "placeMarker");
  const m = view.markers[index]!;
  m.state = MarkerState.parked;
  m.x = x;
  m.y = y;
  m.destX = 0;
  m.destY = 0;
  m.startX = 0;
  m.startY = 0;
  m.duration = 0;
  m.timer = 0;
  m.phase = 0;
}

/**
 * slideMarker. Deliberately does NOT clear phase — the icon's draw cycle
 * keeps running through the move (F0x8009C010).
 */
export function slideMarker(
  view: CardView, index: number, duration: number, destX: number, destY: number,
): void {
  requireIndex(index, MARKER_COUNT, "slideMarker");
  const m = view.markers[index]!;
  m.startX = m.x;
  m.startY = m.y;
  m.state = MarkerState.tweening;
  m.destX = destX;
  m.destY = destY;
  m.duration = duration;
  m.timer = duration;
}

export function promptProgress(view: CardView): number {
  return view.prompt.progress;
}

export function promptBProgress(view: CardView): number {
  return view.promptB.progress;
}

/** Cursor y = originY + cursorRow*0x0E + 0x11. originY is the layout table y. */
export function promptCursorY(view: CardView): number {
  const layout = PROMPT_LAYOUT[view.prompt.layoutIndex] ?? PROMPT_LAYOUT[0];
  return layout.y + view.prompt.cursorRow * PROMPT_CURSOR_ROW_STRIDE + PROMPT_CURSOR_Y_BIAS;
}

/** (timer << 12) / duration, opening subtracts from 0x1000. 0x1000 is 1<<12. */
function scaleFromTimer(timer: number, duration: number, opening: boolean): number {
  return opening
    ? widgetLerp(WIDGET_SCALE_FULL, 0, timer, duration)
    : widgetLerp(0, WIDGET_SCALE_FULL, timer, duration);
}

function parkHidden(p: HudPanel, side: HudSide): void {
  const hidden = PANEL_HIDDEN[side];
  p.subX = hidden.subX;
  p.subY = hidden.subY;
  p.bannerX = hidden.bannerX;
  p.bannerY = hidden.bannerY;
}

function snapShown(p: HudPanel, side: HudSide): void {
  const shown = PANEL_SHOWN[side];
  p.x = 0;
  p.y = shown.y;
  p.subX = shown.subX;
  p.subY = shown.subY;
  p.bannerX = shown.bannerX;
  p.bannerY = shown.bannerY;
}

function snapHidden(p: HudPanel, side: HudSide): void {
  const hidden = PANEL_HIDDEN[side];
  p.x = 0;
  p.y = hidden.y;
  p.subX = hidden.subX;
  p.subY = hidden.subY;
  p.bannerX = hidden.bannerX;
  p.bannerY = hidden.bannerY;
}

function lerpBoth(p: HudPanel, side: HudSide, goingIn: boolean): void {
  const shown = PANEL_SHOWN[side];
  const hidden = PANEL_HIDDEN[side];
  const start = goingIn ? hidden : shown;
  const dest = goingIn ? shown : hidden;
  p.x = widgetLerp(0, 0, p.timer, p.duration);
  p.y = widgetLerp(dest.y, start.y, p.timer, p.duration);
  p.subX = widgetLerp(dest.subX, start.subX, p.timer, p.duration);
  p.subY = widgetLerp(dest.subY, start.subY, p.timer, p.duration);
  p.bannerX = widgetLerp(dest.bannerX, start.bannerX, p.timer, p.duration);
  // bannerY start and dest are both the shown value during states 1 and 3,
  // so it holds still for the whole slide and only snaps on state-3 expiry.
  p.bannerY = widgetLerp(shown.bannerY, shown.bannerY, p.timer, p.duration);
}

function lerpYOnly(p: HudPanel, side: HudSide, goingIn: boolean): void {
  const shown = PANEL_SHOWN[side];
  const hidden = PANEL_HIDDEN[side];
  const startY = goingIn ? hidden.y : shown.y;
  const destY = goingIn ? shown.y : hidden.y;
  p.x = widgetLerp(0, 0, p.timer, p.duration);
  p.y = widgetLerp(destY, startY, p.timer, p.duration);
}

function stepOnePanel(p: HudPanel, side: HudSide, delta: number): void {
  if (p.doneFlag === 1 || p.doneFlag === 2) p.doneFlag = 0;

  const state = p.state;
  if (
    state !== HudPanelState.slideBothIn &&
    state !== HudPanelState.slideBothOut &&
    state !== HudPanelState.slideOneIn &&
    state !== HudPanelState.slideOneOut
  ) {
    return;
  }

  const goingIn = state === HudPanelState.slideBothIn || state === HudPanelState.slideOneIn;
  const oneOnly = state === HudPanelState.slideOneIn || state === HudPanelState.slideOneOut;
  if (oneOnly) parkHidden(p, side);

  const tick = stepWidget(p.timer, delta);
  p.timer = tick.timer;
  if (!tick.expired) {
    if (oneOnly) lerpYOnly(p, side, goingIn);
    else lerpBoth(p, side, goingIn);
    return;
  }

  p.duration = 0;
  if (goingIn) {
    p.state = HudPanelState.idleShown;
    if (oneOnly) {
      p.x = 0;
      p.y = PANEL_SHOWN[side].y;
    } else {
      snapShown(p, side);
    }
  } else {
    p.state = HudPanelState.idleHidden;
    p.doneFlag = 1;
    if (oneOnly) {
      p.x = 0;
      p.y = PANEL_HIDDEN[side].y;
    } else {
      snapHidden(p, side);
    }
  }
}

function stepTurnMarker(p: HudPanel, delta: number): void {
  if (p.markerState === TurnMarkerState.opening) {
    // Lerp from the current timer, THEN decrement. The overlay does not snap
    // scale to 0x1000 on expiry — state becomes 2 with the last lerp value.
    p.markerScale = scaleFromTimer(p.markerTimer, p.markerDuration, true);
    const tick = stepWidget(p.markerTimer, delta);
    p.markerTimer = tick.timer;
    if (tick.expired) p.markerState = TurnMarkerState.open;
  } else if (p.markerState === TurnMarkerState.closing) {
    p.markerScale = scaleFromTimer(p.markerTimer, p.markerDuration, false);
    const tick = stepWidget(p.markerTimer, delta);
    p.markerTimer = tick.timer;
    if (tick.expired) p.markerState = TurnMarkerState.closed;
  }
}

export function stepPrompt(view: CardView, delta = 1): void {
  stepOnePrompt(view.prompt, delta, () => closePrompt(view));
}

/** Window B runs the identical machine on its own state. */
export function stepPromptB(view: CardView, delta = 1): void {
  stepOnePrompt(view.promptB, delta, () => closePromptB(view));
}

function stepOnePrompt(p: PromptWindow, delta: number, close: () => void): void {
  switch (p.state) {
    case PromptState.opening: {
      p.progress = scaleFromTimer(p.timer, p.duration, true);
      const tick = stepWidget(p.timer, delta);
      p.timer = tick.timer;
      if (tick.expired) p.state = PromptState.open;
      return;
    }
    case PromptState.open:
      p.progress = WIDGET_SCALE_FULL;
      return;
    case PromptState.confirming: {
      p.progress = WIDGET_SCALE_FULL;
      const tick = stepWidget(p.timer, delta);
      p.timer = tick.timer;
      if (tick.expired) close();
      return;
    }
    case PromptState.closing: {
      const tick = stepWidget(p.timer, delta);
      p.timer = tick.timer;
      if (tick.expired) p.state = PromptState.idle;
      p.progress = scaleFromTimer(p.timer, p.duration, false);
      return;
    }
    default:
      return;
  }
}

/** Advance both panels by `delta` timer units (the resident frame delta).
 *  Name plates are stepped first, then the slides, matching F0x80099f60. */
export function stepPanels(view: CardView, delta = 1): void {
  stepTurnMarker(view.panels[0], delta);
  stepTurnMarker(view.panels[1], delta);
  stepOnePanel(view.panels[0], 0, delta);
  stepOnePanel(view.panels[1], 1, delta);
}

/** Shared 0/1/2/3 scale ramp used by info banners and the three wipe plates.
 *  Opening lerps then decrements (no snap). State 2 holds animScale at 0x1000.
 *  Closing decrements then lerps, so it does land on 0. */
function stepScaleRamp(
  w: { timer: number; duration: number; state: number; animScale: number },
  delta: number,
): void {
  if (w.state === 1) {
    w.animScale = scaleFromTimer(w.timer, w.duration, true);
    const tick = stepWidget(w.timer, delta);
    w.timer = tick.timer;
    if (tick.expired) w.state = 2;
  } else if (w.state === 2) {
    w.animScale = WIDGET_SCALE_FULL;
  } else if (w.state === 3) {
    const tick = stepWidget(w.timer, delta);
    w.timer = tick.timer;
    if (tick.expired) w.state = 0;
    w.animScale = scaleFromTimer(w.timer, w.duration, false);
  }
}

export function stepBanners(view: CardView, delta = 1): void {
  for (const b of view.banners) stepScaleRamp(b, delta);
}

export function stepPlates(view: CardView, delta = 1): void {
  for (const p of view.plates) stepScaleRamp(p, delta);
}

export function stepMarkers(view: CardView, delta = 1): void {
  for (const m of view.markers) {
    if (m.state !== MarkerState.tweening) continue;
    const tick = stepWidget(m.timer, delta);
    m.timer = tick.timer;
    if (!tick.expired) {
      m.x = widgetLerp(m.destX, m.startX, m.timer, m.duration);
      m.y = widgetLerp(m.destY, m.startY, m.timer, m.duration);
      continue;
    }
    m.state = MarkerState.parked;
    m.duration = 0;
    m.timer = 0;
    m.x = m.destX;
    m.y = m.destY;
  }
}

/** Per-frame view step: name plates + HUD panels, then prompt, banners,
 *  wipe plates, and markers. */
export function stepCardView(view: CardView, delta = 1): void {
  stepPanels(view, delta);
  stepPrompt(view, delta);
  stepPromptB(view, delta);
  stepBanners(view, delta);
  stepPlates(view, delta);
  stepMarkers(view, delta);
  stepDrain(view, delta);
  stepDealTally(view, delta);
  stepHandReturn(view, delta);
  view.blink = (view.blink + delta) % MARKER_PULSE_CYCLE;
  stepReveal(view, delta);
}

// ---------------------------------------------------------------------------
// The attack drain — beats 0x15 and 0x16.
//
// DECODED 2026-08-27 from the two callees the opcode atlas gives for 0x15/0x16:
// enter `F0x80093624`, update `F0x80093710` (exe-decomp/cardgame_c/). The rule
// underneath was already right in card-battle.ts — the attacker's AP total is
// subtracted from the defender's HP total and clamped at zero, which is what
// the enter does to +0x59E with its `if (temp_v0 & 0x8000)` sign test. What the
// walker did not have is that BOTH numbers ramp, over a window whose length is
// set by how many cards attacked.
//
// The shape, from the update's own state machine on +0x422:
//
//   * nothing is written for the first 0x10 ticks — the update gates every
//     setter call behind `if (temp_a1_2 >= 0x10)`, so the panel holds the
//     pre-battle pair through the lead-in;
//   * the defender's HP is carried in 8.8 fixed point in +0x430 and stepped
//     down by a precomputed per-tick delta +0x434, clamped at the true result
//     every tick (`if (temp_v1_4 < temp_v0)`);
//   * the attacker's damage number is NOT carried — it is recomputed from the
//     tick each frame as `ap - ((ap / (cards * 0x38 + 1) + 1) * tick)`, floored
//     at zero, which is why it accelerates away from the HP ramp;
//   * one attacker effect spawns into a 12-slot pool every 27 ticks;
//   * the beat ends when the tick passes `cards * 0x1C + 0x19`.
//
// NOT ESTABLISHED, and deliberately not modelled here: what the spawned effect
// at each 27-tick mark DRAWS. The update hands `unkF10` a clip value from table
// 0x800A5958, indexed by the resident global at 0x8005CCB0 with stride 0x10,
// plus `(defenderCards - 1) * 0x1480`. Neither the table nor that global has
// been read, so the pool spawn is counted here and drawn by nobody. Wiring a
// guessed clip would be inventing artwork.
// ---------------------------------------------------------------------------

/** Ticks before either number moves. `if (temp_a1_2 >= 0x10)` in F0x80093710. */
export const DRAIN_LEAD_IN = 0x10;
/** Window stride per attacking card: every `unk72C * 0x1C` in the same routine. */
export const DRAIN_TICKS_PER_CARD = 0x1C;
/** Ticks after the window before the beat reports done: `+ 0x19 < unk424`. */
export const DRAIN_TAIL = 0x19;
/** One attacker effect every 27 ticks — `unk424 == (unk424 / 27) * 0x1B`.
 *  NOTE this is 27, while the ramp window strides by 28. The two genuinely
 *  disagree by one tick; it is not a transcription slip. */
export const DRAIN_SPAWN_PERIOD = 27;
/** The pool the per-attacker effects spawn into: 6 slots a side, side 1 offset
 *  by 6 (`var_s0 = unk428; if (arg2 != 0) var_s0 += 6;`). */
export const DRAIN_POOL_PER_SIDE = 6;

export interface DrainState {
  running: boolean;
  side: HudSide;       // which side is ATTACKING
  tick: number;        // +0x424
  cards: number;       // +0x72C of the attacking side
  attackerAp: number;  // +0x42C, the damage being dealt
  hpFixed: number;     // +0x430, the defender's shown HP in 8.8
  hpStep: number;      // +0x434, the per-tick decrement in 8.8
  hpEnd: number;       // the clamped result, in whole points
  spawned: number;     // +0x428, how many attacker effects have gone out
  /** The last value WRITTEN to the attacker's panel (property 8). The disc
   *  pushes this through the setter each tick from the lead-in onwards, so the
   *  panel holds it afterwards rather than recomputing anything. */
  shownAp: number;
}

export interface DrainOpen {
  /** The ATTACKING side. */
  side: HudSide;
  /** The attacker's total AP — the damage about to be dealt. */
  attackerAp: number;
  /** The defender's total HP BEFORE the subtraction. */
  defenderHp: number;
  /** How many cards the attacker has on the field. Sets the window length. */
  attackerCards: number;
}

function blankDrain(): DrainState {
  return {
    running: false, side: 0, tick: 0, cards: 0,
    attackerAp: 0, hpFixed: 0, hpStep: 0, hpEnd: 0, spawned: 0, shownAp: 0,
  };
}

/** F0x80093624. Computes the clamped result and the per-tick delta, then arms
 *  the update phase. */
export function startDrain(view: CardView, open: DrainOpen): void {
  const d = view.drain;
  const cards = Math.max(0, open.attackerCards | 0);
  const ap = Math.max(0, open.attackerAp | 0);
  const before = Math.max(0, open.defenderHp | 0);
  // The enter's own subtraction and sign clamp, on the STORED total.
  const after = Math.max(0, before - ap);

  d.running = true;
  d.side = open.side;
  d.tick = 0;
  d.spawned = 0;
  d.cards = cards;
  d.attackerAp = ap;
  d.shownAp = ap;
  d.hpEnd = after;
  d.hpFixed = before << 8;
  // `(unk430 - (unk59E << 8)) / ((unk72C * 0x1C) - 0x10)`, and the enter's
  // own guard: a zero card count, or a delta that truncates to zero, becomes 1.
  // C division truncates toward zero, which for these non-negative values is
  // Math.trunc, not Math.floor.
  const span = cards * DRAIN_TICKS_PER_CARD - DRAIN_LEAD_IN;
  const step = cards !== 0 && span !== 0
    ? Math.trunc((d.hpFixed - (after << 8)) / span)
    : 0;
  d.hpStep = step === 0 ? 1 : step;
}

/** The number on the ATTACKER's panel — its remaining damage to deal. */
export const drainAttackerShown = (view: CardView): number => view.drain.shownAp;

/** The number on the DEFENDER's panel — its HP total, in whole points. */
export const drainDefenderShown = (view: CardView): number => view.drain.hpFixed >> 8;

/** True once the beat has run its course, and before it ever starts. */
export function drainDone(view: CardView): boolean {
  return !view.drain.running;
}

/** One tick of F0x80093710's case 1. */
function stepDrain(view: CardView, delta: number): void {
  const d = view.drain;
  for (let i = 0; i < delta && d.running; i++) {
    const window = d.cards * DRAIN_TICKS_PER_CARD;

    // The per-attacker spawn, on its own 27-tick period.
    if (d.tick % DRAIN_SPAWN_PERIOD === 0 && d.spawned < d.cards) d.spawned += 1;

    if (d.tick >= DRAIN_LEAD_IN) {
      // Property 8, the attacker's remaining damage. Recomputed from the tick
      // each time the setter is called, not carried:
      // `dmg - ((dmg / (cards * 0x38 + 1) + 1) * tick)`, floored at zero, and
      // forced to zero once the tick passes the window.
      d.shownAp = d.tick < window
        ? Math.max(0, d.attackerAp - (Math.trunc(d.attackerAp / (d.cards * 0x38 + 1)) + 1) * d.tick)
        : 0;
      // Property 9, the defender's HP total, carried in 8.8.
      const end = d.hpEnd << 8;
      if (d.tick < window) {
        d.hpFixed = Math.max(d.hpFixed - d.hpStep, end);
      } else {
        d.hpFixed = end;
      }
    }

    d.tick += 1;
    if (d.tick > window + DRAIN_TAIL) d.running = false;
  }
}

// ---------------------------------------------------------------------------
// The deal's colour tally -- beat 0x14, state 4 of F0x80092E60
// ---------------------------------------------------------------------------
//
// The deal is a twelve-state sub-machine, and its fourth pass is a tally. Once
// the twelve cards have flown in and the player's six have turned face up, the
// disc walks the two hands SLOT BY SLOT: for each slot it looks the card up,
// takes its colour byte, and -- when that byte is 1..5 -- adds one to that
// colour's count in the side's five-byte energy block at +0x5A8, saturating at
// 0x63. It then pushes the new count to the HUD through the panel setter as
// property `colour - 1`, which writes panel +0x18..+0x1C: the five two-digit
// numbers under the energy cubes.
//
// So the numbers do not appear at their final value. They COUNT UP, one hand
// slot at a time, both sides together, on a fixed period -- and the walker's
// model already grants exactly the same points (drawOne bumps the same block,
// with the same 99 ceiling), so this is the readout catching up with a total
// that is already correct, not a second source of truth.
//
// NOT MODELLED: the pass runs against a fixed elapsed threshold as well as the
// slot cursor, so on the disc it lingers after the sixth slot before handing
// on. The walker ends the ramp when the last slot is counted; the numbers are
// identical either way, only the handover is earlier.

/** The tally advances one slot of BOTH hands every seventh logic tick --
 *  `slti $v0, $v1, 0x7` guarding the pass, then `-= 7` on each step. */
export const DEAL_TALLY_PERIOD = 7;

/** `sltiu` against 0x63 before the bump: a colour already at 99 stops there. */
export const DEAL_TALLY_CAP = 0x63;

/** Hand slots per side, and so tally steps. */
export const DEAL_TALLY_STEPS = 6;

export interface DealTallyOpen {
  /** Per side, the energy-colour index (0..4) of each dealt hand slot in slot
   *  order. A card with no energy colour -- a brown Digimon, colour 6 -- has no
   *  slot to count into and is passed as -1, exactly as the disc's `sltiu`
   *  bound drops it. */
  colours: readonly [readonly number[], readonly number[]];
  /** Ticks to wait before the first slot is counted: the fly-in and the flip
   *  wave run first, and the caller knows their length. */
  delay: number;
}

export interface DealTallyState {
  running: boolean;
  tick: number;
  step: number;
  delay: number;
  colours: [number[], number[]];
  shown: [number[], number[]];
}

function blankDealTally(): DealTallyState {
  return {
    running: false,
    tick: 0,
    step: 0,
    delay: 0,
    colours: [[], []],
    shown: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  };
}

/** Start the tally from zero. The disc reaches this pass with the block already
 *  zeroed by the deal's own entry, so the ramp always begins at nothing. */
export function startDealTally(view: CardView, open: DealTallyOpen): void {
  const t = view.dealTally;
  t.running = true;
  t.tick = 0;
  t.step = 0;
  t.delay = Math.max(0, open.delay | 0);
  t.colours = [[...open.colours[0]], [...open.colours[1]]];
  t.shown = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
}

function stepDealTally(view: CardView, delta: number): void {
  const t = view.dealTally;
  if (!t.running) return;
  for (let n = 0; n < delta; n += 1) {
    if (t.tick >= t.delay && (t.tick - t.delay) % DEAL_TALLY_PERIOD === 0
        && t.step < DEAL_TALLY_STEPS) {
      for (const side of [0, 1] as const) {
        const colour = t.colours[side][t.step];
        if (colour == null || colour < 0 || colour > 4) continue;
        const cur = t.shown[side][colour]!;
        if (cur < DEAL_TALLY_CAP) t.shown[side][colour] = cur + 1;
      }
      t.step += 1;
      if (t.step >= DEAL_TALLY_STEPS) { t.running = false; return; }
    }
    t.tick += 1;
  }
}

/** The five numbers to draw under one side's energy cubes while the deal is
 *  counting, or null when nothing is counting and the model's own totals are
 *  the right thing to draw. */
export function dealTallyShown(view: CardView, side: 0 | 1): readonly number[] | null {
  const t = view.dealTally;
  return t.running ? t.shown[side] : null;
}

export const dealTallyDone = (view: CardView): boolean => !view.dealTally.running;

// ---------------------------------------------------------------------------
// The set award's hand return -- beat 0x1C / 0x1D, step 2 of F0x80094B9C
// ---------------------------------------------------------------------------
//
// Once the field has emptied, the set award does something the transfer does
// not: it puts both hands back into both decks, and it shows the work. The
// handler takes a copy of the four numbers -- each side's hand count and deck
// count -- and then, every third tick, moves ONE card on each side that still
// has one: hand down by one, deck up by one, with a sound on the step. It
// pushes all four to the HUD each time, as panel properties 6 (hand) and 5
// (deck). When neither side has a card left in hand the banner goes up.
//
// The counts it drains are copies. The model's own hand and deck are not
// touched by this pass, which is why the walker overrides the readout rather
// than stepping the model: the model is already at its post-set values.

/** One card each side, every third tick -- `slti 3` on the cadence counter,
 *  then `-= 3`. The same three ticks the field exit runs on. */
export const HAND_RETURN_PERIOD = 3;

export interface HandReturnOpen {
  /** Cards in hand, per side, when the return begins. */
  hand: readonly [number, number];
  /** Cards in deck, per side, when the return begins. */
  deck: readonly [number, number];
}

export interface HandReturnState {
  running: boolean;
  tick: number;
  hand: [number, number];
  deck: [number, number];
  /** Set on the tick a card moves, so the caller can play the step sound. */
  stepped: boolean;
}

function blankHandReturn(): HandReturnState {
  return { running: false, tick: 0, hand: [0, 0], deck: [0, 0], stepped: false };
}

export function startHandReturn(view: CardView, open: HandReturnOpen): void {
  const h = view.handReturn;
  h.running = true;
  h.tick = 0;
  h.stepped = false;
  h.hand = [Math.max(0, open.hand[0] | 0), Math.max(0, open.hand[1] | 0)];
  h.deck = [Math.max(0, open.deck[0] | 0), Math.max(0, open.deck[1] | 0)];
  // Nothing to return is not a beat: the disc's own test is "neither side has
  // a card in hand", and it is made before the first step, not after.
  if (h.hand[0] <= 0 && h.hand[1] <= 0) h.running = false;
}

function stepHandReturn(view: CardView, delta: number): void {
  const h = view.handReturn;
  if (!h.running) return;
  h.stepped = false;
  for (let n = 0; n < delta; n += 1) {
    if (h.tick % HAND_RETURN_PERIOD === 0) {
      let moved = false;
      for (const side of [0, 1] as const) {
        if (h.hand[side] > 0) { h.hand[side] -= 1; h.deck[side] += 1; moved = true; }
      }
      // The disc tests BOTH counts and, when neither could move, ends the pass
      // and raises the banner instead of playing the step sound.
      if (!moved) { h.running = false; return; }
      h.stepped = true;
    }
    h.tick += 1;
  }
}

/** The hand and deck numbers to draw for one side while the set award is
 *  returning the hands, or null at every other moment. */
export function handReturnShown(
  view: CardView, side: 0 | 1,
): { hand: number; deck: number } | null {
  const h = view.handReturn;
  return h.running ? { hand: h.hand[side], deck: h.deck[side] } : null;
}

export const handReturnDone = (view: CardView): boolean => !view.handReturn.running;
