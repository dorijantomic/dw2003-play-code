// Types only: the canvas backing store web/canvas-resolution.ts keeps and hands back. Nothing here
// is emitted (node's strip mode erases it), so this file must never hold runtime code.

/**
 * The field canvas's backing store after the last resize: its size in device pixels, the transform
 * that maps 640x480 logical coordinates into it, and the wide-view letterbox pad on the left.
 */
export interface CanvasBacking {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  padX?: number;
  hd: boolean;
}
