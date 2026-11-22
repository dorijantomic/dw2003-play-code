/** A map-space point (the editor converts every mouse event to one). */
export interface SceneEditorPoint {
  x: number;
  y: number;
}

/**
 * What a click is armed with: "npc" to place one, "exit" to drag one, null when idle.
 * The map editor in web/game.ts shares the same global and keeps a plain boolean there.
 */
export type SceneEditorArm = boolean | "npc" | "exit" | null;

export interface SceneEditorState {
  arm?: (mode: SceneEditorArm) => void;
  /** "npc" | "exit" in the scene editor, a plain boolean in the map editor that shares the global */
  armed: any;
  /** save the map the editor is working on */
  download?: () => void;
  /** where an exit drag started; null between drags */
  dragStart: SceneEditorPoint | null;
  drawOverlay?: (ctx2d: CanvasRenderingContext2D) => void;
  /** where the mouse last was, so removeNearest() has something to remove */
  lastMouse: SceneEditorPoint | null;
  removeNearest?: () => void;
}

/** One thing the editor places: an NPC (a point) or an exit / zone (a rectangle, w and h set), in map pixels. */
export interface SceneEditorItem {
  x: number;
  y: number;
  w?: number;
  h?: number;
  [field: string]: unknown;
}

/** The scene being edited: its NPCs, its exit rectangles and its zones. */
export interface SceneEditorScene {
  npcs: SceneEditorItem[];
  exits: SceneEditorItem[];
  zones: SceneEditorItem[];
}

/** What the editor asks the game for on each event. */
export interface SceneEditorContext {
  scene: SceneEditorScene;
  mapId: string;
  camX: number;
  camY: number;
  zoom: number;
}
