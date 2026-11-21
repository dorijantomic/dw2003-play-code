import type { NativeScreenRenderStats } from "./native-screen-render.js";

/** The END card's layout table (stdwtitl_ui.json `end_screen`): the eng pack, the clip per language, the labels. */
export interface EndCardData {
  /** language index -> the clip number that language's card is */
  clipByLanguage: Record<string, number>;
  /** clip number -> the word the card shows ("END") */
  clipLabels: Record<string, string>;
  pack: string;
}

/** What the card's state() reports: the CLUT level the draw is passing (15 invisible, 0 the settled card). */
export interface EndCardView {
  level?: number;
}

/** What diagnostics() reports for the debug overlay. */
export interface EndCardDiagnostics {
  execution: string;
  host: string;
  open: boolean;
  active: boolean;
  failed: boolean;
  error: string | null;
  ticks: number;
  language: number;
  state: EndCardView | null;
  /** the clip the language and level choose */
  clip: number;
  label: string;
  clipId: string | null;
  /** the resident launch codes the card asked for */
  launches: number[];
  stoppedSound: number;
  /** the colour the card asked its display view for */
  viewColour: number | null;
  background: string;
  painted: NativeScreenRenderStats | null;
}

export interface EndscreenScreen {
  /** vendor object: the ui.MenuDisplayClock the card's ticks come from */
  _clock: any;
  _data: EndCardData | null;
  _error: Error | null;
  _failed: boolean;
  _finish?: () => void;
  /** the buttons held last frame */
  _held: unknown[];
  /** index into the card's language table (2 = the eng pack the walker ships) */
  _language: number;
  _lastState: EndCardView | null;
  /** the resident launch codes the card asked for */
  _launches: number[];
  _onDone: (() => void) | null;
  _open: boolean;
  /** the native screen renderer object createNativeScreenRenderer() returns */
  _renderer: any;
  /** vendor object: the engine's EndCardSession */
  _session: any;
  _stopSound: (() => void) | null;
  _ticks: number;
  cancel?: () => void;
  clip?: () => number;
  clipId?: () => string | null;
  diagnostics?: () => EndCardDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  isDone?: () => boolean;
  /** the word the card shows ("END") */
  label?: () => string;
  launches?: () => number[];
  level?: () => number | null;
  open?: (onDone?: () => void) => boolean;
  setHeld?: (keys: unknown[]) => void;
  state?: () => EndCardView | null;
  step?: (dt: number) => void;
}
