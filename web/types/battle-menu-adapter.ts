import type { NativeScreenRenderStats } from "./native-screen-render.js";

/** What a battle menu adapter's diagnostics report to the debug overlay. */
export interface BattleMenuDiagnostics {
  execution: "translated";
  open: boolean;
  /** open but the session has not started yet (the pack is still loading) */
  pending: boolean;
  /** keys waiting to become one-tick presses */
  queued: number;
  failed: boolean;
  error: string | null;
  /** the screen's answer word; only for the adapters that report one */
  chosen?: unknown;
  seed: unknown;
  /** where the marker strip came from: "loader-vram" or "data" */
  stripSource: string | null;
  renderer: NativeScreenRenderStats;
  lastDiagnostic: string | null;
  /** the screen's own diagnostic fields */
  [field: string]: unknown;
}

/** The shared state one battle menu adapter keeps (web/battle-menu-adapter.ts). The screen's own
 *  fields live in the same object: each adapter spreads its spec.state in at construction. */
export interface BattleMenuAdapterState {
  /** the screen's answer word (attack id, item id, tag...), null before the player answers */
  _chosen: unknown;
  /** vendor object: the ui.MenuDisplayClock the session is ticked on */
  _clock: any;
  /** the packed data the adapter loaded (manifest, strip, tables) */
  _data: any;
  _error: Error | null;
  _failed: boolean;
  _lastDiagnostic: string | null;
  _loading: boolean;
  _open: boolean;
  /** how many key presses the screen has taken (the adapters that count them) */
  _presses?: number;
  /** the button the current display tick holds down, between two queued presses */
  _pulse: string | null;
  /** queued button names, oldest first; the display reads one per tick */
  _queue: string[];
  /** ticks left before the next queued press may start */
  _releaseTicks: number;
  /** the word open() was given, clamped by the screen's seed() */
  _seed: unknown;
  /** vendor object: the engine's ui.*Session the screen runs */
  _session: any;
  /** the 16bpp marker strip blitted over the finished frame */
  _strip: HTMLCanvasElement | null;
  /** where the strip came from: "loader-vram" or "data" */
  _stripSource: string | null;
  _ticks: number;
  active?: () => boolean;
  chosen?: () => unknown;
  close?: () => void;
  diagnostics?: () => BattleMenuDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number) => void;
  failed?: () => boolean;
  isOpen?: () => boolean;
  isPending?: () => boolean;
  /** the arguments are the screen's own (the command list takes a row, the item menu a bag page) */
  open?: (...args: any[]) => void;
  preload?: () => void;
  press?: (button: string) => void;
  /** one battle update; returns the screen's answer on the update it is handed back */
  update?: (keys?: Iterable<string> | null, dt?: number) => unknown;
}
