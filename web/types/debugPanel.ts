import type { GameState } from "../game/types.js";

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
