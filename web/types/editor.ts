import type { CollisionGrid } from "../game/types.js";
export interface EditorState {
  download?: () => void;
  drawOverlay?: (ctx2d: CanvasRenderingContext2D) => void;
  enabled: boolean;
  painting: number;
  toggle?: () => void;
}

/** What the editor asks the game for on each event: the stage's collision grid and the field camera. */
export interface EditorContext {
  grid: CollisionGrid;
  mapId: string;
  camX: number;
  camY: number;
  zoom: number;
}
