// Types for web/canvas-bench.ts: the canvas 2D benchmark page and the report it writes.

/** The gl report of the page (web/canvas-bench.ts glInfo). */
export interface CanvasBenchOutput {
  error?: string;
  renderer: string | null;
  renderString?: string;
  unmaskedRenderer: string | null;
  unmaskedVendor: string | null;
}

/** One benchmark case: the canvas pattern it drew and what it measured. */
export interface CanvasBenchCase {
  /** "512x512"...: the canvas size the case ran on */
  canvas: string;
  canvasH: number;
  canvasW: number;
  /** the case's own line of what it draws */
  description: string;
  /** rAF frames per second after the warm-up */
  fps: number;
  frames: number;
  /** whether the case got a fresh canvas, else it reused the big one */
  fresh: boolean;
  gapMedian: number;
  gapP95: number;
  gapWorst: number;
  id: string;
  /** mean JS time of the draw calls per frame, no GPU time in it */
  jsMs: number;
}

export interface CanvasBenchGroup {
  cases: CanvasBenchCase[];
  id: string;
  name: string;
}

export interface CanvasBenchResults {
  error?: string;
  groups: CanvasBenchGroup[];
  meta: CanvasBenchResultsMeta;
  notes: string[];
}

export interface CanvasBenchResultsMeta {
  browser: string;
  devicePixelRatio: number;
  finishedAt?: string;
  gl: CanvasBenchOutput;
  /** the backing store of the page's own canvas */
  nativeCanvas: { w: number; h: number; };
  page: string;
  platform: string;
  startedAt: string;
  timing: { warmMs: number; measureMs: number; };
  userAgent: string;
  visibilityAtStart: DocumentVisibilityState;
  window: { innerW: number; innerH: number; };
}
