import type { GameState } from "../game/types.js";
import type { NativeScreenRenderStats } from "./native-screen-render.js";

/** What diagnostics() reports for the debug overlay. */
export interface PackSelectDiagnostics {
  open: boolean;
  /** open but the pack is still loading */
  pending: boolean;
  done: boolean;
  error: string | null;
  sel: number;
  /** the partners the pack offers on the second page */
  partners: string[];
  tasks: number;
  renderer: NativeScreenRenderStats;
}

export interface PackSelectScreen {
  /** the name the pack's second page shows */
  _accountName: string;
  /** vendor object: the ui.MenuDisplayClock the presses come from */
  _clock: any;
  _done: boolean;
  _error: Error | null;
  _finish?: () => void;
  /** frames left to ignore the confirm for */
  _hold: number;
  _open: boolean;
  _partners: string[];
  /** the queued button word a display frame is about to apply */
  _press: string | null;
  /** the buttons pressed while the last frame was not due ("up", "down", "cross", "circle") */
  _queue: string[];
  _request: number;
  _sel: number;
  /** vendor object: the engine's PackSelectSession */
  _session: any;
  _state: GameState | null;
  accountName?: () => string;
  advance?: (dt: number, state?: GameState) => void;
  cancel?: () => boolean;
  close?: () => void;
  confirm?: () => boolean;
  diagnostics?: () => PackSelectDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number) => boolean;
  isDone?: () => boolean;
  isOpen?: () => boolean;
  moveDown?: () => boolean;
  moveUp?: () => boolean;
  /** open the pack (the walker passes the game state in) */
  open?: (opts?: { state?: GameState }) => void;
  pack?: () => number;
  partners?: () => string[];
  sel?: () => number;
  update?: (dt: number, state?: GameState) => void;
}
