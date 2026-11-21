// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

import type { GameState } from "../game/types.js";

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
  _foldTr?: (key: string, px: number, py: number, axis: string) => any;
  _isOpen?: (k: string) => boolean;
  _openSheet?: (fresh: boolean) => void;
  _runSeq?: () => void;
  _screenSeen?: string | null;
  _seq?: MenuSeqStep[];
  _seqClear?: () => void;
  /** the fold keys whose sound was already played */
  _sfxPlayed?: Record<string, number>;
  _slide?: { t0: number; from: number; to: number; };
  _slideReady?: () => boolean;
  _slideSet?: (v: number) => void;
  _slideStart?: (from: number, to: number) => void;
  _slideTick?: () => void;
  _slideY?: number;
  applyTechnique?: (state: GameState, techId: number, target: number, failSound?: string) => void;
  backToHome: () => void;
  cardFolderCursor: number;
  cardFolderUnlocked?: () => boolean;
  demoCursor: number;
  detailFocus: number;
  detailIdx: number;
  detailSel: number;
  detailStep: string;
  /** the decoded digimon table, keyed by char id (parsed JSON) */
  digimonDB: { [k: string]: any; };
  draw?: (ctx: CanvasRenderingContext2D, viewW: number, viewH: number, state: GameState) => void;
  dvAction: number;
  /** the page the digivolve demo goes back to ("dvaction"...) */
  dvBackStep: string;
  dvHome: boolean;
  dvMessage: string;
  ensureData?: () => void;
  equipCursor: number;
  equipFocus: string;
  equipListCursor: number;
  equipScroll: number;
  fadeLeaving: boolean;
  fadePending: string;
  fadeT0: number;
  feedbackMsg: string | null;
  feedbackTimer: number;
  fieldHome: boolean;
  handleKey?: (rawKey: string, state: GameState, onSave: (state: GameState) => unknown) => void;
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
  mapHoverY?: number;
  mapInit?: boolean;
  /** whether a PS1 stage's seen flag is set: the map screen's gate (web/game/map-load.ts engineFlagSeen) */
  mapSeen: (id: number) => boolean | null;
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
  skillDB: { [k: string]: any; };
  sortPick: number;
  sortSwapping?: boolean;
  statusCursor: number;
  techCursor: number;
  techInfoSel: number;
  techMode: string;
  techRows?: (state: GameState, idx: number) => number[];
  techTarget: number;
  time?: number;
  update?: (dt: number) => void;
}

// One row of the decoded walker_map table: the PS1 stage it answers to and the walker's own
// server/location it stands for on the map screen.
export interface MapSeenRow {
  ps1?: number;
  /** the server the location is on ("asuka"/"amaterasu") */
  server?: string;
  /** the location marker's index */
  loc?: number;
}
