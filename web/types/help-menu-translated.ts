import type { HelpMenu, HelpMenuSession } from "../../engine/dw3/ui/help-menu-session.js";
import type { MenuDisplayClock, MenuPadWords } from "../../engine/dw3/ui/pad-words.js";

/** diagnostics(): the dev overlay's dump of this screen's state. */
export interface HelpMenuDiagnostics {
  execution: string;
  open: boolean;
  pending: boolean;
  failed: boolean;
  error: string | null;
  /** the HELP_MENUS row it was opened with */
  menu: { module: string; label: number; textHandle: number } | null;
  ticks: number;
  closes: number;
  [extra: string]: unknown;
}

/** The translated help menu (web/help-menu-translated.ts). */
export interface HelpMenuScreen {
  /** MenuDisplayClock the session is ticked on */
  _clock: MenuDisplayClock | null;
  _closes: number;
  /** the load/run failure, printed by diagnostics() as `error.message` */
  _error: Error | null;
  _failed: boolean;
  _open: boolean;
  /** packed sound id -> how many times it was played this open */
  _packed: Record<number, number>;
  _pad: MenuPadWords | null;
  /** the text runs the last draw painted */
  _painted?: string[] | null;
  _pending: boolean;
  _primed: boolean;
  _request: number;
  /** the HELP_MENUS row it was opened with */
  _row: HelpMenu | null;
  _session: HelpMenuSession | null;
  /** the packed sound ids played this open, oldest first (capped at 256) */
  _sounds: number[];
  _ticks: number;
  close?: () => void;
  diagnostics?: () => HelpMenuDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  isOpen?: () => boolean;
  open?: (menuRow: HelpMenu, packBytes?: Uint8Array | null, opts?: { onClose?: (() => void) | null }) => Promise<void>;
  /** `keys` is the held-key set the field keeps ("up", "down", "ok", "cancel") */
  update?: (dt: number, keys?: Set<string> | null) => void;
}
