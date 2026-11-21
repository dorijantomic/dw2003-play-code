/** A clip the renderer could not paint: the frame, why it was dropped, and the intent it came from. */
export interface NativeScreenRenderSkip {
  frame: number;
  reason: string;
  id: number | null;
  dir: number | null;
  pack: string | null;
  bucket: number | null;
  x: number | null;
  y: number | null;
  palette: number;
}

export interface NativeScreenRenderStats {
  awaiting: number;
  byPack: Record<string, number>;
  cards: number;
  clips: number;
  frames: number;
  last: { id: number; x: number; y: number; pack: string; } | null;
  pack: string | null;
  packs: string[];
  paintedFrames: number;
  /** the clips painted last frame, back to front */
  paintOrder: Array<{ id: number; bucket: number }>;
  quads?: number;
  raw: number;
  rawKinds: Record<string, number>;
  seen: number[];
  skipped: number;
  skippedList: NativeScreenRenderSkip[];
}
