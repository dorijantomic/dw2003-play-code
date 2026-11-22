import type { GameState, PartnerStats } from "../game/types.js";

export interface DebugPanelState {
  drawOverlay?: (ctx: CanvasRenderingContext2D, W: number, H: number, state: GameState) => void;
  enabled: boolean;
  evoIdx: number;
  /** `k` is the raw key ("arrowup", "a"...) the input dispatcher already normalised. */
  handleKey?: (k: string, state: GameState) => boolean;
  itemIdx: number;
  /** last action's line for the panel footer, null until something runs */
  msg: string | null;
  sel: number;
  toggle?: () => void;
}

/** One editable number row of the debug panel: how to read it, write it and step it. */
export interface DebugField {
  label: string;
  step: number;
  min: number;
  get: (ps: PartnerStats) => number;
  /** `state` is only read by the rows that recompute other numbers (Level). */
  set: (ps: PartnerStats, v: number, state: GameState) => void;
}
