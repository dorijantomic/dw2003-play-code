// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

import type { GameState } from "../game/types.js";
import type { DigimonRecord } from "../types/battle.js";

/** One entry of the fold animation table: when it started and which way it is going (web/menu/create.ts _anim). */
export interface MenuFoldAnim {
  /** 0 = closed, 1 = opening (negative t0 = already open) */
  dir: number;
  t0: number;
}

/** One queued step of the open/close sequence (web/menu/create.ts _after/_seq). */
export interface MenuSeqStep {
  /** the fold keys the step waits for */
  wait: string[];
  run: () => void;
}

/** What the engine's fold tween (engine/dw3/ui/fold-tween.ts foldTransformAtTime / foldCloseTransformAtTime) hands back. */
export interface FoldTransform {
  /** true once the fold has landed, in whichever direction it was going */
  ready: boolean;
  /** 0 = shut, 1 = fully open */
  progress: number;
  pivotX: number;
  pivotY: number;
  scaleX: number;
  scaleY: number;
}

/** Draws one folding window through its pivot and axis; hands back how far open it is, 0..1 (web/menu/create.ts _foldTr). */
export type FoldFn = (key: string, px: number, py: number, axis: string, fn: () => void) => number;

/** The few switches the card, sidebar and footer draw functions take. */
export interface MenuDrawOpts {
  /** First START draws the card without its glass pedestal */
  skipPortrait?: boolean;
  /** SORT / TECHNIQUES / STATUS-pick have no footer BIT */
  hideBit?: boolean;
}

/** One of the six core stats (the order of STAT_ROWS) */
export type CoreStatKey = "str" | "def" | "spt" | "wis" | "spd" | "chr";

/** One of the seven elements (the order of RES_ROWS) */
export type ElementKey = "fire" | "water" | "ice" | "wind" | "thunder" | "machine" | "dark";

/** One entry of the roster view the menu draws (web/party.ts partyRosterView). */
export interface RosterViewEntry {
  charId: string | null;
  rookieId: number | undefined;
  digimonId: number;
  profile: DigimonRecord | undefined;
  name: string;
  /** the form it is wearing */
  formName: string;
  level: number;
  xp: number;
  tp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** the stored core stats, null on a non-lead member / old save */
  stats: Record<string, number> | null;
  /** the permanent stat-item bonuses */
  bonuses: Record<string, number> | null;
  /** the six core halfwords of the roster record (stored + chips) */
  core: number[];
  /** the seven element halfwords of the roster record */
  elements: number[];
  /** a hand-built block's trained points (a roster entry carries none) */
  elemBonuses?: Record<string, number | undefined> | null;
}

/** A decoded fold pivot: where the window folds around */
export type PivotPair = [number, number];

/** A decoded window node (status_ui.json): where it folds around, when it has a pivot of its own. */
export interface FoldNode {
  pivot?: number[];
}

/** A decoded clip placement (status_ui.json). */
export interface ClipPlace {
  clip: string | number;
  x: number;
  y: number;
}

/** status_ui.json screens.map.cursor: the map cursor's limits and pan pivot. */
export interface MapCursorConfig {
  pan_x: number;
  pan_y: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  scroll_x_min: number;
  scroll_y_min: number;
  speed_initial: number;
  speed_max: number;
}

/** The panel slide table entry (web/menu/create.ts _slideStart). */
export interface MenuSlide {
  t0: number;
  from: number;
  to: number;
}

/** One row of the decoded technique table, as far as the menu reads it. */
export interface MenuSkillRow {
  id: number;
  name?: string;
  desc?: string;
  /** the technique record's +4 byte, which picks the badge clip */
  attack_cat?: number;
  mp_cost?: number;
  power?: number;
}

export interface MenuState {
  /** queue a step to run once the given fold keys have finished */
  _after?: (keys: string[], run: () => void) => void;
  /** the fold animation table, by fold key */
  _anim?: Record<string, MenuFoldAnim>;
  /** how far a fold key's animation has gone, 0..1 */
  _animP?: (key: string) => number;
  _animStart?: (delay: number, ...keys: string[]) => void;
  /** close a details sheet's rows, giving back the keys it released */
  _closeSheet?: (row: number, alsoCard: boolean) => string[];
  _drawNative?: (ctx: CanvasRenderingContext2D, viewW: number, viewH: number, state: GameState) => void;
  _foldClose?: (...keys: string[]) => void;
  _foldForget?: (...keys: string[]) => void;
  _foldOpen?: (...keys: string[]) => void;
  _foldReady?: (key: string) => boolean;
  _foldShut?: (...keys: string[]) => void;
  _foldTr?: (key: string, px: number, py: number, axis: string) => FoldTransform;
  _isOpen?: (k: string) => boolean;
  _openSheet?: (fresh: boolean) => void;
  _runSeq?: () => void;
  _screenSeen?: string | null;
  _seq?: MenuSeqStep[];
  _seqClear?: () => void;
  /** the fold keys whose sound was already played */
  _sfxPlayed?: Record<string, number>;
  _slide?: MenuSlide | null;
  _slideReady?: () => boolean;
  _slideSet?: (v: number) => void;
  _slideStart?: (from: number, to: number) => void;
  _slideTick?: () => void;
  _slideY?: number;
  /** target null = the whole party */
  applyTechnique?: (state: GameState, techId: number, target: number | null, failSound?: string) => void;
  backToHome: () => void;
  cardFolderCursor: number;
  cardFolderUnlocked?: () => boolean;
  demoCursor: number;
  detailFocus: number;
  detailIdx: number;
  detailSel: number;
  detailStep: string;
  /** the decoded digimon table, keyed by char id (parsed JSON) */
  digimonDB: Record<string, DigimonRecord> | null;
  draw?: (ctx: CanvasRenderingContext2D, viewW: number, viewH: number, state: GameState) => void;
  dvAction: number;
  /** the page the digivolve demo goes back to ("dvaction"...) */
  dvBackStep: string;
  dvHome: boolean;
  dvMessage: string | null;
  ensureData?: () => void;
  equipCursor: number;
  equipFocus: string;
  equipListCursor: number;
  equipScroll: number;
  fadeLeaving: boolean;
  fadePending: string | null;
  fadeT0: number;
  feedbackMsg: string | null;
  feedbackTimer: number;
  fieldHome: boolean;
  handleKey?: (rawKey: string, state: GameState, onSave: (state: GameState) => void) => void;
  itemCat: number;
  itemCursor: number;
  /** the bag rows the ITEMS page lists */
  itemList?: (state: GameState) => { id: number; qty: number; }[];
  itemMode: string;
  itemSortCursor?: number;
  itemTarget: number;
  /** how many frames the list button has been held */
  listHold?: number;
  listStepT?: number;
  mainCursor: number;
  mapCX?: number;
  mapCY?: number;
  mapHoldX?: number;
  mapHoldY?: number;
  /** the location marker the map cursor is over, 0 for none */
  mapHover?: number;
  mapHoverY?: number | undefined;
  mapInit?: boolean;
  /** whether a PS1 stage's seen flag is set: the map screen's gate (web/game/map-load.ts engineFlagSeen) */
  mapSeen: ((id: number) => boolean | null) | null;
  mapSpd?: number;
  mapStepT?: number;
  mapSX?: number;
  mapSY?: number;
  mapUnavailable?: boolean;
  nativeOpen?: () => boolean;
  onCardAlbum?: () => void;
  onCardDeck?: () => void;
  onNativePage?: (label: string) => boolean;
  onStatus?: () => boolean;
  openAt?: (screen: string) => void;
  reset?: () => void;
  screen: string;
  showFeedback?: (msg: string, duration?: number) => void;
  /** the decoded technique table, keyed by tech id (parsed JSON) */
  skillDB: Record<string, MenuSkillRow> | null;
  sortPick: number | null;
  sortSwapping?: boolean;
  statusCursor: number;
  techCursor: number;
  techInfoSel: number;
  techMode: string | null;
  techRows?: (state: GameState, idx: number) => number[];
  techTarget: number;
  time?: number;
  update?: (dt: number) => void;
}

// One row of the decoded walker_map table: the PS1 stage it answers to and the walker's own
// server/location it stands for on the map screen.
export interface MapSeenRow {
  ps1: number;
  /** the server the location is on: 0 Asuka (PS1 stage < 0x270), 1 Amaterasu */
  server: number;
  /** the place number (byte table 0x8009B5FC & 0x7F, 0..45); its marker is record loc + 1 (mapMarkerRecord) */
  loc: number;
}

/** One record of the MAP page marker table 0x8009AB60 (status_ui.json screens.map.markers keeps records 1..46). */
export interface MapMarkerRecord {
  /** the record number, 1..46; also the place name string id (esaskmap / esamtmap) */
  loc: number;
  clip: number;
  x: number;
  y: number;
}
