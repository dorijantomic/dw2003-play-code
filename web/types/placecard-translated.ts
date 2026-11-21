import type { LocationCardState } from "../../engine/systems/location-card.js";

/** One of the card's two names (the area, the place) as it has revealed so far. */
export interface PlaceCardName {
  revealed: number;
  total: number;
  ended: boolean;
}

/** What state() reports: the live card, for tests and the UI lab. */
export interface PlaceCardView {
  /** the session's own phase */
  phase: number;
  step: number;
  hold: number;
  released: number;
  busy: boolean;
  area: PlaceCardName;
  place: PlaceCardName;
  /** the sliding bars (the frame's quads) */
  bars: unknown[];
  /** the slit the bars are drawn through */
  clip: number;
}

/** What diagnostics() reports for the debug overlay. */
export interface PlaceCardDiagnostics {
  execution: string;
  active: boolean;
  failed: boolean;
  error: string | null;
  ticks: number;
  held: boolean;
  language: number;
  painted: unknown[];
  state: PlaceCardView | LocationCardState | null;
}

export interface PlaceCardScreen {
  /** vendor object: the ui.MenuDisplayClock the reveal runs on */
  _clock: any;
  _error: Error | null;
  _failed: boolean;
  _held: boolean;
  /** the ui-c scope key */
  _key?: string;
  /** index into the card's language table (2 = the eng pack the walker ships) */
  _language: number;
  /** the text widgets the last draw painted */
  _painted: unknown[];
  /** vendor object: the engine's PlaceCardSession */
  _session: any;
  _ticks: number;
  /** start the card for an arrival (a place scene id, "s780"); false when its data is not there */
  begin?: (mapId: string) => boolean;
  /** a scene's own two names (web/quest-scenes.ts) */
  beginText?: (area: string, place: string) => boolean;
  cancel?: () => void;
  diagnostics?: () => PlaceCardDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  /** hold the card on screen (the field's busy flag) */
  hold?: (on: boolean) => void;
  isActive?: () => boolean;
  isBusy?: () => boolean;
  setLanguage?: (language: number) => void;
  /** the card's own view, or the scene text card's while it plays (beginText) */
  state?: () => PlaceCardView | LocationCardState | null;
  step?: (dt: number) => void;
}
