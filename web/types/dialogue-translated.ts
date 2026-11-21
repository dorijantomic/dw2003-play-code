import type { NativeScreenRenderStats } from "./native-screen-render.js";

/**
 * A raw disc bank the box can read its text from: a file ("estalk00"), an esdmg entry, or a pack
 * the caller already loaded. Callers build these as plain objects, so every field is optional.
 */
export interface DialogueSource {
  /** a dialogue file stem ("estalk00") */
  file?: string;
  /** an esdmg bank ("esdmg400") */
  esdmg?: string;
  entry?: number;
  index: number;
  /** a pack the caller already loaded; wins over file/esdmg */
  pack?: Uint8Array;
}

/** How the box talks: an NPC's own box (kind "talk"), or a plain scene line with an optional balloon actor. */
export interface DialogueMode {
  kind: string;
  /** the NPC the box sits over (kind "talk") */
  npc?: { x: number; y: number; facing: number; actorId: number } | null;
  /** draw the line as plain text with no window chrome (kind "say") */
  plain?: boolean;
  balloonMode?: number;
  /** the character the balloon follows (kind "say") */
  actor?: { x: number; y: number; actorId: number } | null;
}

/** What open() is handed on top of its arguments: what to call on failure, and the player's name. */
export interface DialogueOpenOptions {
  onFail?: (...args: unknown[]) => void;
  /** the NUL-terminated player name the original keeps at 0x80048d88 (control operand 8) */
  playerNameBytes?: ArrayLike<number> | null;
}

/** What diagnostics() reports for the debug overlay. */
export interface DialogueDiagnostics {
  execution: string;
  open: boolean;
  pending: boolean;
  failed: boolean;
  error: string | null;
  ticks: number;
  closes: number;
  /** the text the last draw revealed */
  painted: unknown[];
  packed: Record<string, number>;
  /** the last 256 sound keys (packed ids) the box asked the resident sound layer to play */
  sounds: number[];
  /** vendor object: the session's own state */
  state: any;
  renderer: NativeScreenRenderStats;
}

export interface DialogueScreen {
  /** vendor object: the ui.MenuDisplayClock the text reveals on */
  _clock: any;
  _closes: number;
  _error: Error | null;
  _failed: boolean;
  /** the ui-c scope key ("dialogue1", "dialogue2", ...) */
  _key: string;
  /** a confirm press seen between display frames, applied on the next tick */
  _latched: boolean;
  _onClose: (() => void) | null;
  _onFail: ((...args: unknown[]) => void) | null;
  _open: boolean;
  /** how often each font / pack was opened */
  _packed: Record<string, number>;
  /** the text widgets the last draw painted */
  _painted?: unknown[];
  _pending: boolean;
  /** the confirm state last tick, so a held button is not a press */
  _prevHeld: boolean;
  _primed: boolean;
  _request: number;
  /** vendor object: the engine's DialogueSession */
  _session: any;
  /** the sound keys (packed ids) the box asked for (the last 256) */
  _sounds: number[];
  _ticks: number;
  close?: () => void;
  diagnostics?: () => DialogueDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  handleKey?: () => void;
  isOpen?: () => boolean;
  open?: (
    source: DialogueSource,
    mode: DialogueMode,
    onClose?: ((...args: unknown[]) => void) | null,
    project?: (x: number, y: number) => { sx: number; sy: number },
    opts?: DialogueOpenOptions,
  ) => Promise<void>;
  pressConfirm?: () => void;
  update?: (dt: number, keys?: Set<unknown> | null) => void;
}
