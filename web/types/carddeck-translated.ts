import type { GameState } from "../game/types.js";
import type { NativeScreenRenderStats } from "./native-screen-render.js";

/** What diagnostics() reports for the debug overlay. */
export interface CardDeckDiagnostics {
  execution: string;
  open: boolean;
  pending: boolean;
  error: string | null;
  /** the session's live tasks */
  tasks: number;
  /** the session's own state word, the picker and the cursor (read from its RAM) */
  state: number | null;
  picker: number | null;
  cursor: number | null;
  renderer: NativeScreenRenderStats;
}

export interface CardDeckScreen {
  /** vendor object: the ui.MenuDisplayClock the deck runs on */
  _clock: any;
  _error: Error | null;
  _finish?: () => void;
  _onClose: (() => void) | null;
  _open: boolean;
  /** the native screen renderer object createNativeScreenRenderer() returns */
  _renderer: unknown;
  _request: number;
  /** vendor object: the engine's FolderSession */
  _session: any;
  _state: GameState | null;
  close?: () => void;
  diagnostics?: () => CardDeckDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number, state?: GameState) => void;
  handleKey?: (_key: string, state: GameState) => void;
  isOpen?: () => boolean;
  /** open the deck: the game state (or, from the pause list, the close handler) and what to call on the way out */
  open?: (stateOrClose?: GameState | (() => void) | null, onClose?: (() => void) | null) => void;
  update?: (dt: number) => void;
}
