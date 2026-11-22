import type { GymSession } from "../../engine/dw3/ui/gym-session.js";
import type { GameState } from "../game/types.js";
import type { MenuDisplayClock } from "./translated-screens.js";
import type { NativeScreenRenderStats } from "./native-screen-render.js";

/** What the gym commits when the session ends: the training results, read off the live session. */
export interface GymSummary {
  finished: boolean;
  ticks: number;
  transition: [number, number];
  /** one record per pedestal, in roster order */
  records: unknown[];
  sounds: number[];
  displayCalls: unknown[];
  uploads: number;
}

/** What diagnostics() reports for the debug overlay: the screen's state and the last launched tasks. */
export interface GymScreenDiagnostics {
  execution: "translated";
  open: boolean;
  /** open but no session yet (the pack is still loading) */
  pending: boolean;
  failed: boolean;
  error: string | null;
  ticks: number;
  traps: number;
  host: null;
  /** the 0-based rank menu the session was opened on */
  group: number;
  /** the session's current menu state words */
  state: ReturnType<GymSession["state"]>;
  /** the session's training page state */
  training: unknown;
  tasks: number;
  sounds: number[];
  displayCalls: unknown[];
  uploads: number;
  records: unknown[];
  summary: GymSummary | null;
  renderer: NativeScreenRenderStats;
  /** the prim painter's counters, when a session has one */
  primitives: Record<string, number> | null;
  lastDiagnostic: string | null;
}

export interface GymScreen {
  /** the decoded bank the session's resources come from */
  _bank?: Uint8Array | null;
  /** the display clock the frames come from */
  _clock: MenuDisplayClock | null;
  _committed: number;
  /** the loaded pack (manifest, tables, profiles, catalog); read by key */
  _data: any;
  _error: Error | null;
  _failed: boolean;
  _finish?: () => void;
  /** the 0-based rank menu (rank_menus index) */
  _group: number;
  _lastDiagnostic: string | null;
  _onClose: (() => void) | null;
  _open: boolean;
  _pending: boolean;
  _request: number;
  /** one entry per pedestal: { ps, member, bonus } */
  _seeded: any[];
  _session: GymSession | null;
  /** the stage the gym was opened from (previousScreen in the seed) */
  _stage: number | null;
  /** the walker state, read only through `state.party` / `state.equipment` / `state.keys`; the
   *  interface is loosened here because the seed builder treats a missing state as `{}` */
  _state: any;
  _summary: GymSummary | null;
  _ticks: number;
  close?: () => boolean;
  diagnostics?: () => GymScreenDiagnostics;
  /** the walker passes the state as a fourth argument; the gym reads only the canvas */
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number, state?: GameState) => void;
  /** the screen reads the held pad words itself, so the key is only used to learn the state */
  handleKey?: (_k: string, state: GameState) => void;
  isOpen?: () => boolean;
  /** group: the rank menu row, stage: the map id the gym was entered from, drills: the extra-quest
   *  drills the gym hall asks for (this screen runs the rank session, so it drops them) */
  open?: (state: GameState, onClose?: (() => void) | null, group?: number | null, stage?: number | null, drills?: unknown[] | null) => Promise<void>;
  textWidgets?: () => unknown[];
  update?: (dt: number) => void;
}

/** What the gym needs from the game to build its seed and to open (web/game.ts passes none of it). */
export interface GymTranslatedOpts {
  /** play a sound name ("confirm", "cancel", ...) through the shared player */
  playSound?: (name: string) => void;
  /** the random source the session's draws come from */
  rand?: (bound: number) => number;
}
