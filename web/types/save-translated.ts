// Types for web/save-translated.ts: the browser adapter of the SAVE / LOAD memory-card screen.
import type { MemcardSession } from "../../engine/dw3/ui/memcard-session.js";
import type { MenuDisplayClock } from "./translated-screens.js";

/** The options the callers of the screen pass with `open` (web/game/ui-openers.ts openMemoryCard). */
export interface SaveScreenOptions {
  /** the map the save point is on, shown on the SUBMIT page */
  areaName?: string;
  /** the save point's own name (esshpnam), shown instead of the map title */
  placeName?: string;
  /** the save point's esshpnam index, stamped into the record */
  placeIndex?: number;
  /** the memory-card slot the save point maps to (0..2) */
  savePointSlot?: number;
  /** seconds the play clock had when the card was raised */
  playSeconds?: number;
  /** the party's roster slots, when the caller computed them (else from the char ids) */
  partySlots?: number[];
  /** the STATUS screen's view of a party member (the caller's own formatting) */
  roster?: (state: unknown) => unknown[];
  /** the STATUS screen's view of one reserve (id: the slot's char id, "p003pken"...) */
  reserveRoster?: (id: string, stats: unknown) => unknown;
}

/** One slot of the session card: the record the directory block shows, and the image behind it. */
export interface SaveCardSlot {
  /** the memcard directory record web/save.ts buildRecord() made */
  record: unknown;
  image: Uint8Array | null;
}

/** A save the session card took during the screen, committed to localStorage when it closes. */
export interface SaveCardWrite {
  image: Uint8Array;
  playSeconds: number;
  slot: number;
}

/** The session card the screen serves: a copy of the walker's three slots that takes writes in memory. */
export interface SaveCard {
  /** the walker's slot i, or null when it holds no file */
  slots: (SaveCardSlot | null)[];
  saved: SaveCardWrite[];
  present: () => boolean;
  directory: (file: number) => Uint8Array;
  image: (file: number) => Uint8Array | null;
  writeDirectory: () => void;
  writeImage: (file: number, bytes: Uint8Array) => void;
}

/** What the screen did, read after it closed: the slots it wrote and the one it loaded. */
export interface SaveResult {
  loadedSlot: number | null;
  /** the card verify's refusal, when the loaded file was not restored */
  refused?: { slot: number; code: number; why: string };
  saved: number[];
}

/** The session's last words, kept for the lab and the focused checks. */
export interface SaveScreenSummary {
  displayCalls: unknown[];
  finished: boolean;
  soundArchives: unknown[];
  sounds: unknown[];
  ticks: number;
  transfers: unknown[];
  transition: [number, number];
}

/** diagnostics(): what the lab and focused browser checks read. */
export interface SaveScreenDiagnostics {
  commit: SaveResult | null;
  error: string | null;
  execution: string;
  failed: boolean;
  host: null;
  lastDiagnostic: string | null;
  loadedSlot: number | null;
  mode: string;
  open: boolean;
  pending: boolean;
  renderer: unknown;
  savedSlot: number | null;
  sounds: unknown[];
  state: unknown;
  stores: { slot: number }[];
  summary: SaveScreenSummary | null;
  tasks: number;
  ticks: number;
  transfers: unknown[];
  traps: number;
}

export interface SaveScreen {
  /** the session card (SaveCard); null until the screen opens and clears on close */
  _card: SaveCard | null;
  /** the display clock the frames come from */
  _clock: MenuDisplayClock | null;
  _commit: SaveResult | null;
  /** the loaded memcard pack: its manifest, tables.bin, the banks and the profile records */
  _data: any;
  _error: Error | null;
  _failed: boolean;
  _finish?: () => boolean;
  _lastDiagnostic: string | null;
  _mode: "save" | "load";
  _noReload?: boolean;
  _onClose: (() => void) | null;
  _open: boolean;
  _opts: SaveScreenOptions;
  _pending: boolean;
  _request: number;
  /** the engine's MemcardSession running the disc's own screen */
  _session: MemcardSession | null;
  _setNoReload?: (v: boolean) => void;
  /** the walker's game state the card is written from (web/game/types.ts GameState) */
  _state: any;
  _summary: SaveScreenSummary | null;
  _ticks: number;
  close?: () => boolean;
  diagnostics?: () => SaveScreenDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number, state?: unknown) => void;
  handleKey?: (_k: string, state: unknown) => void;
  isOpen?: () => boolean;
  open?: (gameState: unknown, mode?: "save" | "load", onClose?: (() => void) | null, opts?: SaveScreenOptions) => void;
  textWidgets?: () => unknown[];
  update?: (dt: number) => void;
}
