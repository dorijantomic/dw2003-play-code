/** What a caller can pass to yesNoBox.open(). */
export interface YesNoOpenOpts {
  /** a start event the box raised (it waits for a child before it closes) */
  onStartEvent?: (id: number) => void;
  /** the continuation held while the box is up */
  onClose?: (() => void) | null;
}

export interface YesNoScreen {
  /** vendor object: the ui.MenuDisplayClock the box runs on */
  _clock: any;
  _closes: number;
  _error: any;
  /** the start events the session raised, in order */
  _events: number[];
  _failed: boolean;
  _key: string;
  _onClose?: (() => void) | null;
  _open: boolean;
  /** packed-sound id -> times played */
  _packed: Record<number, number>;
  /** vendor object: the ui.MenuPadWords the presses are read with */
  _pad: any;
  _painted?: any[];
  _pending: boolean;
  _primed: boolean;
  _request: number;
  /** the launcher row the box was opened from */
  _row: any;
  /** vendor object: the engine's YesNo session */
  _session: any;
  /** the packed sound ids played, in order */
  _sounds: number[];
  _ticks: number;
  childDone?: () => void;
  close?: () => void;
  diagnostics?: any;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  isOpen?: () => boolean;
  open?: (row: any, state?: any, opts?: YesNoOpenOpts) => void;
  update?: (dt: number, keys?: any) => void;
}
