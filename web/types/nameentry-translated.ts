// Types for web/nameentry-translated.ts: the browser adapter of the partner-naming screen.

/** One partner the screen can name: its char id, roster slot and current name. */
export interface NameEntryMember {
  /** the manifest char id ("p003pken"...) */
  charId: string;
  /** the roster slot the char id maps to, 0..2 */
  rosterSlot: number;
  name: string;
}

/** A confirmed name, in the shape the walker's callers read. */
export interface NameEntryResult {
  accepted: boolean;
  /** the char id of the partner named, null when nothing was confirmed */
  memberId: string | null;
  value: string;
}

/** diagnostics(): what the focused browser checks read. */
export interface NameEntryDiagnostics {
  chooserReadingPad: boolean;
  chooserSub: number | null;
  commits: number;
  error: string | null;
  open: boolean;
  pending: boolean;
  renderer: unknown;
  results: number;
  selected: number | null;
  tasks: number;
}

export interface NameEntryScreen {
  /** vendor object: the ui.MenuDisplayClock the frames come from */
  _clock: any;
  _error: Error | null;
  _finish?: (commit?: boolean) => void;
  /** the name the partner already had, shown as the starting text */
  _initial: string;
  _lastValue: string;
  _members: NameEntryMember[];
  _open: boolean;
  _request: number;
  _results: NameEntryResult[];
  /** vendor object: the ui.NameRootSession running the disc's own screen */
  _session: any;
  /** the walker's game state the party names come from */
  _state: any;
  close?: () => void;
  diagnostics?: () => NameEntryDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number) => void;
  handleKey?: (_key: string, state: any) => void;
  isDone?: () => boolean;
  isOpen?: () => boolean;
  open?: (opts?: { initial?: string; state?: any }) => void;
  result?: () => NameEntryResult;
  results?: () => NameEntryResult[];
  update?: (dt: number, state?: any) => void;
  value?: () => string;
}
