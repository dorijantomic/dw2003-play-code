import type { InnSession } from "../../engine/dw3/ui/inn-session.js";
import type { MenuDisplayClock } from "./translated-screens.js";
import type { NativeScreenRenderStats } from "./native-screen-render.js";

/** What quoteInnStay() prices a stay at. */
export interface InnQuote {
  count: number;
  total: number;
  affordable: boolean;
}

/** What the inn screen's diagnostics report (the debug overlay and the focused checks read it). */
export interface InnScreenDiagnostics {
  execution: "translated";
  open: boolean;
  failed: boolean;
  error: string | null;
  /** the inn the stay is quoted at, null before the screen found one */
  inn: { stage: number; name: string; price: number } | null;
  ticks: number;
  closes: number;
  /** the packed sound ids played, in order */
  sounds: number[];
  /** the SEQ ids the session asked for, with the kind the screen played them as */
  music: Array<[number, string]>;
  /** the text the last frame painted */
  painted: string[];
  /** the session's menu state, read off the live session */
  state: unknown;
  /** the session's fade intent (level and blend), read off the live session */
  fade: unknown;
  rests: number;
  renderer: NativeScreenRenderStats;
}

export interface InnScreen {
  /** vendor object: the bgm player (web/audio/bgm.js) the caller handed in */
  _bgm: any;
  /** the display clock the session is ticked on */
  _clock: MenuDisplayClock | null;
  _closes: number;
  _error: Error | null;
  _failed: boolean;
  /** SEQ ids the session asked for: [id, kind] */
  _music: Array<[number, string]>;
  _onClose: (() => void) | null;
  _open: boolean;
  /** the text the last draw painted */
  _painted?: string[];
  /** the party the stay is quoted (and healed) for; one stats block per deployed digimon */
  _party: any[];
  /** the pad word the button calls have queued for the next display tick */
  _queued: number;
  /** the inn record the screen was opened at: { stage, name, pricePerDigimon } */
  _record: any;
  _request: number;
  _session: InnSession | null;
  _sounds: number[];
  /** the walker state (bits, party, partnerStats/partyStats, languageByte) */
  _state: any;
  _ticks: number;
  cancel?: () => void;
  close?: () => void;
  confirm?: () => void;
  diagnostics?: () => InnScreenDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  isOpen?: () => boolean;
  load?: () => Promise<unknown>;
  moveDown?: () => void;
  moveUp?: () => void;
  /** map: the scene the player stands on ("s235" or 235); returns the stay's quote, null when there is no inn */
  open?: (state: any, opts?: { map?: string | number; party?: any[]; onClose?: (() => void) | null; }) => Promise<InnQuote | null>;
  /** 0 = Stay in Inn, 1 = Do not stay in Inn */
  selection?: () => number;
  tick?: (dt: number) => void;
  /** seconds the screen has been up */
  time: number;
}
