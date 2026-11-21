export interface EditorState {
  download?: () => void;
  drawOverlay?: (ctx2d: CanvasRenderingContext2D) => void;
  enabled: boolean;
  painting: number;
  toggle?: () => void;
}
