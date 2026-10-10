// Raw GPU primitives the screen overlays write into the packet arena.
//
// The recorded draw-intent stream only carries the picture-service calls
// (engine/native/stubs.ts DRAW_CTX_METHODS). Some screens draw parts of their
// picture as raw GPU primitives instead: they take the display service's packet
// cursor (GET_DE30 = [0x8004DF68]), write primitives into the arena, and publish
// the new cursor through the setter at [0x8004DF6C] (SET_DE30). The runtime's
// SET_DE30 stub sees every such block; this module decodes the two layouts that
// the original's own emit sites produce:
//
//  0x2A, word count 5 — the full-screen subtractive dim, followed by its
//  draw-mode word 0xE1000245 (ABR 2 = screen behind MINUS the quad:
//  docs/research/ui/screen-rendering-model.md §4). Emit site: pro/stgmcard
//  F0x80082e7c L0x00000228-L0x000002f8 and its byte-identical battle copy
//  pro/fightstg FIGHTSTG_F0x8008a8c4 L0x8008a928-L0x8008a9b0. Corners are the
//  immediates 0/0x140/0/0x100 written at +8/+A, +C/+E, +10/+12, +14/+16; the
//  colour is one byte triple from the object's running level >> 8 at +4..+6.
//
//  0x38, word count 8 — a POLY_G4 (gouraud-shaded, untextured quad). Emit site:
//  pro/stgmcard F0x80083c50 L0x00001138-L0x0000131c, the memory-card screen's
//  rotating transition bar. Colours at +4..+6, +C..+E, +14..+16, +1C..+1E;
//  corners at +8/+A, +10/+12, +18/+1A, +20/+22 (tag word count 8 at +3, GP0
//  command 0x38 at +7). The emit site writes vertices 0 and 2 from one colour
//  triple and 1 and 3 from another (ledger claim
//  UI-STGMCARD-TRANSITION-QUAD-2026-08-14).
//
// Decoding is strict and conservative: a block is captured only when it parses
// exactly from its start to its published end into these layouts. Unknown
// writers (the text service's 0x64/0x2C glyphs, the card class's 0x1C-byte
// sprite) have their own capture paths and are left alone; a 0x2A without its
// draw-mode word is not captured because its blend would depend on GPU state
// this block does not carry, and an ABR mode other than 2 is not painted by the
// renderer and is therefore not claimed.

/** The read surface of the emulated memory (engine/native/memory.ts). */
export interface RawPrimReader {
  read8(addr: number): number;
  read16s(addr: number): number;
}

/** The dim's full-screen quad. [x], [y] are the four corners in vertex order. */
export interface DimQuadIntent {
  cmd: 0x2a;
  x: [number, number, number, number];
  y: [number, number, number, number];
  /** The one level triple written to all four colour slots (r = g = b). */
  rgb: [number, number, number];
  /** Semi-transparency mode from the block's trailing draw-mode word. */
  abr: number;
}

/** A gouraud-shaded four-point polygon. */
export interface PolyG4Intent {
  cmd: 0x38;
  x: [number, number, number, number];
  y: [number, number, number, number];
  /** Per-vertex colour triples, in vertex order (the emit site writes two and repeats them). */
  rgb: [number, number, number][];
}

export type RawPrimKind = "dimQuad" | "polyG4";

export interface RawPrim {
  /** Index into the tick's drawCalls where the block was published; the renderer
   *  merges raw primitives into the recorded order at this point. */
  at: number;
  /** The ordering-table bucket the original selected for the block through the
   *  layer's +0x138 (engine/native/runtime.ts LAYER_OT_BUCKET), when it made that
   *  call right before publishing. Absent when no selection preceded the submit. */
  bucket?: number;
  kind: RawPrimKind;
  intent: DimQuadIntent | PolyG4Intent;
}

const POLY_G4_BYTES = 0x24; // tag + 8 command words
const DIM_QUAD_BYTES = 0x18; // tag + 5 command words
const DRAW_MODE_BYTES = 8; // the trailing E1 word, tag + 1 command word
const DRAW_MODE_ABR_2 = 0xe1000245; // GP0(0xE1) with the ABR field set to 2

/**
 * Decode one published block [start, end) into raw primitives, or null when the
 * block is not one of the decoded layouts (some other writer owns it).
 */
export function decodeRawPrims(
  mem: RawPrimReader,
  start: number,
  end: number,
): Array<{ kind: RawPrimKind; intent: DimQuadIntent | PolyG4Intent }> | null {
  const out: Array<{ kind: RawPrimKind; intent: DimQuadIntent | PolyG4Intent }> = [];
  let a = start >>> 0;
  const stop = end >>> 0;
  while (a < stop) {
    const words = mem.read8(a + 3);
    const code = mem.read8(a + 7);
    if (code === 0x38 && words === 8) {
      if (a + POLY_G4_BYTES > stop) return null;
      const rgb: [number, number, number][] = [];
      for (const off of [4, 0xc, 0x14, 0x1c]) {
        rgb.push([mem.read8(a + off), mem.read8(a + off + 1), mem.read8(a + off + 2)]);
      }
      out.push({
        kind: "polyG4",
        intent: {
          cmd: 0x38,
          x: [mem.read16s(a + 8), mem.read16s(a + 0x10), mem.read16s(a + 0x18), mem.read16s(a + 0x20)],
          y: [mem.read16s(a + 0xa), mem.read16s(a + 0x12), mem.read16s(a + 0x1a), mem.read16s(a + 0x22)],
          rgb,
        },
      });
      a += POLY_G4_BYTES;
      continue;
    }
    if (code === 0x2a && words === 5) {
      if (a + DIM_QUAD_BYTES + DRAW_MODE_BYTES > stop) return null;
      // The dim is always published with its draw-mode word in the same block;
      // without it the blend mode would depend on GPU state we do not carry.
      const mode = mem.read8(a + DIM_QUAD_BYTES + 3);
      const abr = ((readWord(mem, a + DIM_QUAD_BYTES + 4) >>> 5) & 3);
      if (mode !== 1 || readWord(mem, a + DIM_QUAD_BYTES + 4) !== DRAW_MODE_ABR_2) return null;
      out.push({
        kind: "dimQuad",
        intent: {
          cmd: 0x2a,
          x: [mem.read16s(a + 8), mem.read16s(a + 0xc), mem.read16s(a + 0x10), mem.read16s(a + 0x14)],
          y: [mem.read16s(a + 0xa), mem.read16s(a + 0xe), mem.read16s(a + 0x12), mem.read16s(a + 0x16)],
          rgb: [mem.read8(a + 4), mem.read8(a + 5), mem.read8(a + 6)],
          abr,
        },
      });
      a += DIM_QUAD_BYTES + DRAW_MODE_BYTES;
      continue;
    }
    return null; // another writer owns this block
  }
  return a === stop ? out : null;
}

/** Little-endian halfword read (the draw-mode word's first two bytes are its tag). */
function readWord(mem: RawPrimReader, addr: number): number {
  return ((mem.read8(addr) | (mem.read8(addr + 1) << 8) | (mem.read8(addr + 2) << 16) | (mem.read8(addr + 3) << 24)) >>> 0);
}
