// Types for web/cardshop-translated.ts: the browser adapter of the card shop.

import type { GameState } from "../game/types.js";

/** diagnostics().child: the child controller the shop has in front of it. */
export interface CardShopChild {
  cursor: number;
  kind: string;
  message: unknown;
  page: number;
  /** the reveal mode of a pack being opened, null when nothing is revealing */
  reveal: string | null;
  state: number;
  stock: unknown;
}

/** diagnostics(): what the focused browser checks read. */
export interface CardShopDiagnostics {
  child: CardShopChild | null;
  error: string | null;
  execution: string;
  open: boolean;
  pending: boolean;
  renderer: unknown;
  /** the root controller's state word */
  state: number | null;
  translated: true;
}

export interface CardShopScreen {
  /** vendor object: the ui.MenuDisplayClock the frames come from */
  _clock: any;
  _error: Error | null;
  _finish?: () => void;
  _onClose?: (() => void) | null;
  _onEditFolder?: (() => void) | null;
  _open: boolean;
  _request: number;
  /** the collection revision last persisted, so a purchase is saved the frame it happens */
  _savedRevision?: number;
  /** vendor object: the ui.CardShopSession running the disc's own screen */
  _session: any;
  _state: GameState | null;
  close?: () => void;
  diagnostics?: () => CardShopDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, width: number, viewH?: number, state?: unknown) => void;
  handleKey?: (_key: string, state: GameState) => void;
  isOpen?: () => boolean;
  open?: (state: GameState, onClose?: (() => void) | null, onEditFolder?: (() => void) | null, shopId?: number | null) => void;
  update?: (dt: number) => void;
}

/** What the card shop page is handed: the stage its host is in, for the shop's own layout. */
export interface CardShopOptions {
  stage?: (state: GameState) => number;
}
