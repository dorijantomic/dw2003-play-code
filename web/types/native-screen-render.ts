import type { loadPack } from "../screenpack.js";
import type { DimQuadIntent, PolyG4Intent } from "../../engine/native/raw-prims.js";

/** One vertex colour. */
export type NativeRgb = [number, number, number];

/** The engine's POLY_G4 intent; its emit site writes the first two vertex colours and repeats them, so there are always two. */
export interface NativePolyG4Intent extends Omit<PolyG4Intent, "rgb"> {
  rgb: [NativeRgb, NativeRgb, ...NativeRgb[]];
}

/** A raw primitive the runtime captured (engine RawPrim), told apart by its kind: the intent of each kind has its own shape. */
export type NativeRawPrim =
  | { at: number; bucket?: number; kind: "dimQuad"; intent: DimQuadIntent }
  | { at: number; bucket?: number; kind: "polyG4"; intent: NativePolyG4Intent };

/** One picture the extracted screen-pack renderer paints from (web/screenpack.ts loadPack). */
export type NativePack = ReturnType<typeof loadPack>;

/** One recorded draw intent: the picture-service method and its numbers. */
export interface NativeScreenDrawIntent {
  method: string;
  args: number[];
}

/** What a screen's pack lookup is given: the pack it draws from, or the packs by requested LBA index. */
export interface NativeRenderEntry {
  pack?: string | undefined;
  packs?: Record<string, string> | undefined;
}

/** What a screen's renderer may override: its pack loader, the art hooks for VRAM and raw draws, and two draw rules. */
export interface NativeRendererOptions {
  loadPack?: ((name: string) => NativePack) | undefined;
  paintPrim?: ((ctx: CanvasRenderingContext2D, call: NativeScreenDrawIntent) => void) | undefined;
  /** `raw` is an engine RawPrim; each screen's painter narrows it to its own command shape */
  paintRaw?: ((ctx: CanvasRenderingContext2D, raw: unknown, getPack: (name: string) => NativePack | null | undefined) => boolean) | undefined;
  opaqueClips?: boolean | undefined;
  skipClip?: ((name: string, id: number) => boolean) | undefined;
}

/** One thing to paint, in a depth bucket: a pack clip, a VRAM primitive, a raw primitive or a Gouraud quad. */
export type NativeRenderDraw =
  | { kind?: "clip"; dir: number; id: number; x: number; y: number; sx: number; sy: number; px: number; py: number; palette: number; bucket: number }
  | { kind: "vram"; call: NativeScreenDrawIntent; bucket: number }
  | { kind: "raw"; raw: NativeRawPrim; bucket: number }
  | { kind: "quad"; args: number[]; bucket: number };

/** The corners and colours of a Gouraud quad: four x,y corners, then four r,g,b colours. */
export type NativeQuadArgs = [number, number, number, number, number, number, number, number, ...number[]];

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
  pack: string | null | undefined;
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
