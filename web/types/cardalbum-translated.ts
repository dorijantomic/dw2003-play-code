import type { NativeScreenRenderStats } from "./native-screen-render.js";

/** What the card album's diagnostics report (the debug overlay reads it). */
export interface CardAlbumDiagnostics {
  execution: "translated";
  open: boolean;
  /** open but no session yet (the pack is still loading) */
  pending: boolean;
  error: string | null;
  translated: true;
  /** the live session's own report, read off the vendor object */
  session: unknown;
  renderer: NativeScreenRenderStats;
}

/** What the album reads off the state the lab hands it. */
export interface AlbumScreenState {
  languageByte?: number;
  /** the held pad buttons, as the pad service keeps them */
  keys?: Set<string>;
}

export interface CardAlbumScreen {
  /** vendor object: the ui.MenuDisplayClock the session is ticked on */
  _clock: any;
  _error: Error | null;
  _finish?: () => void;
  _onClose: (() => void) | null;
  _open: boolean;
  _request: number;
  /** vendor object: the engine's ui.AlbumSession */
  _session: any;
  /** the walker state, read only for languageByte and the held keys */
  _state: any;
  close?: () => void;
  diagnostics?: () => CardAlbumDiagnostics;
  /** the walker passes the state as a fourth argument; the album reads only the canvas */
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number, state?: unknown) => void;
  handleKey?: (_key: string, state: unknown) => void;
  isOpen?: () => boolean;
  /** the walker's call site passes only onClose, the lab passes the state */
  open?: (stateOrClose?: (() => void) | AlbumScreenState | null, onClose?: (() => void) | null) => void;
  update?: (dt: number) => void;
}
