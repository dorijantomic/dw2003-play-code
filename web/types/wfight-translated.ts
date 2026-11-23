import type { WfightLoaderSession } from "../../engine/dw3/ui/wfight-loader-session.js";
import type { GameState } from "../game/types.js";
import type { MenuDisplayClock } from "./translated-screens.js";

/** What the loader left behind when it retired: the banks it asked for and the VRAM it uploaded. */
export interface WfightLoaderSummary {
  /** bank ids the loader requested, in order */
  requested: number[];
  released: number[];
  /** one record per VRAM upload */
  uploads: Array<Record<string, unknown>>;
  /** the loader retired by itself (its uploads stay in VRAM for the battle) */
  retired: boolean;
}

/** What the loader's diagnostics report to the debug overlay. */
export interface WfightDiagnostics {
  execution: "translated";
  open: boolean;
  pending: boolean;
  done: boolean;
  failed: boolean;
  error: string | null;
  /** browser frames the loader has been up */
  framesAlive: number;
  ticks: number;
  traps: number;
  /** the loader session's own state word */
  state: unknown;
  bankIds: number[];
  released: number[];
  uploads: Array<Record<string, unknown>>;
  retired: boolean;
  /** the translated loader never boots a native host */
  host: null;
  lastDiagnostic: string | null;
}

export interface WorldFightScreen {
  /** the display clock the loader session is ticked on */
  _clock: MenuDisplayClock | null;
  /** the packed data the loader reads (bank tables) */
  _data: any;
  _done: boolean;
  _error: Error | null;
  _failed: boolean;
  _finish?: () => void;
  _lastDiagnostic: string | null;
  _open: boolean;
  _pending: boolean;
  /** the engine's loader session (its tick() takes no argument: the session counts its own frames) */
  _session: WfightLoaderSession | null;
  /** what the last finished loader did, null until one has run */
  _summary: WfightLoaderSummary | null;
  _ticks: number;
  active?: () => boolean;
  close?: () => void;
  diagnostics?: () => WfightDiagnostics;
  isDone?: () => boolean;
  isOpen?: () => boolean;
  isPending?: () => boolean;
  open?: () => void;
  update?: (dt?: number) => void;
}

/** What createWfightTranslated() is told by the game (web/wfight-translated.ts). */
export interface WfightLoaderOptions {
  /** the live game state; its languageByte picks the font the loader draws with */
  getState?: () => GameState | null;
}
