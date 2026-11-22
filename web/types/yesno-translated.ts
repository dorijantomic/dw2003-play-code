import type { MenuDisplayClock, MenuPadWords } from "../../engine/dw3/ui/pad-words.js";
import type { YesNoLauncher, YesNoSession } from "../../engine/dw3/ui/yesno-session.js";
import type { ThrownError } from "./translated-screens.js";

/** What a caller can pass to yesNoBox.open(). */
export interface YesNoOpenOpts {
  /** a start event the box raised (it waits for a child before it closes) */
  onStartEvent?: ((id: number) => void) | null;
  /** the continuation held while the box is up */
  onClose?: (() => void) | null;
}

/** diagnostics(): the dev overlay's dump of this screen's state. */
export interface YesNoDiagnostics {
  execution: string;
  open: boolean;
  pending: boolean;
  failed: boolean;
  error: string | null;
  launcher: { module: string; label: number } | null;
  ticks: number;
  closes: number;
  events: number[];
  painted: string[];
  [extra: string]: unknown;
}

export interface YesNoScreen {
  /** the display clock the box runs on */
  _clock: MenuDisplayClock | null;
  _closes: number;
  _error: ThrownError | null;
  /** the start events the session raised, in order */
  _events: number[];
  _failed: boolean;
  _key: string;
  _onClose?: (() => void) | null;
  _open: boolean;
  /** packed-sound id -> times played */
  _packed: Record<number, number>;
  /** the pad words the presses are read with */
  _pad: MenuPadWords | null;
  /** the text runs the last draw painted */
  _painted?: string[];
  _pending: boolean;
  _primed: boolean;
  _request: number;
  /** the launcher row the box was opened from */
  _row: YesNoLauncher | null;
  _session: YesNoSession | null;
  /** the packed sound ids played, in order */
  _sounds: number[];
  _ticks: number;
  childDone?: () => void;
  close?: () => void;
  diagnostics?: () => YesNoDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  isOpen?: () => boolean;
  open?: (launcherRow: YesNoLauncher, packBytes?: Uint8Array | null, opts?: YesNoOpenOpts) => Promise<void>;
  /** `keys` is the held-key set the field keeps ("up", "down", "ok", "cancel") */
  update?: (dt: number, keys?: Set<string> | null) => void;
}
