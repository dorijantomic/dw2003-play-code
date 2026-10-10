// Translated ports of the battle 3-D core's geometry routines.
//
// The fight scene draws each Digimon by walking its mesh, running every vertex
// through the console's perspective transform, running each animated layer's
// matrix through the parent chain, then handing the result to the GPU. Those two
// routines were decoded in prose (docs/research/fight-3d/fight-mesh-geometry.md
// and docs/research/battle/3d-battle-complete-model-2026-08-19.md §6) but until
// now could not be ported or oracled because the interpreter did not model the
// coprocessor moves they run on. That model now exists (engine/native/gte.ts,
// arithmetic in engine/dw3/gte-math.ts); these are the routine ports.
//
//   FIGHTSTG_F0x80084a54  projectMeshNode   - the per-vertex projection loop
//   FIGHTSTG_F0x80083e0c  composeLayer      - the layer builder's parent-chain
//                                             composition (the three MVMVA
//                                             passes + the translation pass)
//
// What each port reproduces is stated per function; the oracle in
// tests/engine/unit/battle-mesh-oracle.test.ts runs the ORIGINAL instruction
// words through engine/native and compares, with a negative control.

import { mvmva, rotMatrixZYX, rtps, s16, type Mat3, type RtpsView, type Vec3 } from "./gte-math.ts";
import { runDisplayList } from "./battle-displaylist.ts";
import type { DisplayListState } from "./battle-displaylist.ts";

/** One bone-local mesh vertex, as the 6-byte records the mesh bins hold. */
export interface MeshVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ProjectionResult {
  /** node+0x78: one packed SXY2 word per vertex (SX in the low halfword). */
  readonly screenXY: Int32Array;
  /** node+0x7c: (SZ3 >> 2) >> depthShift per vertex. */
  readonly depth: Int32Array;
}

/**
 * Packed SXY word exactly as SWC2 stores SXY2 (reg 14): SX2 low, SY2 high.
 */
export function packSxy(sx2: number, sy2: number): number {
  return (((sy2 & 0xffff) << 16) | (sx2 & 0xffff)) | 0;
}

/**
 * FIGHTSTG_F0x80084a54 — the mesh interpreter's vertex projection.
 *
 * Reads `vertexCount` vertices (x,y,z signed 16-bit, 6-byte stride) from the
 * draw node's +0x60 list, runs each through RTPS with the active GTE matrix, and
 * writes the packed screen coordinate to +0x78 and the depth to +0x7c. The depth
 * is the routine's own scaling: SZ3 is taken as `mfc2 $19` shifted right 2, then
 * `>> (0xE - actor.method(+0x144))`.
 *
 * The original consumes the count-2 vertex's SZ before storing it, so the first
 * depth slot pairs with the first vertex; the port reproduces that ordering
 * (verified against the original in the oracle test).
 */
export function projectMeshNode(
  vertices: readonly MeshVertex[],
  view: RtpsView,
  depthShift: number,
): ProjectionResult {
  const count = vertices.length;
  const screenXY = new Int32Array(count);
  const depth = new Int32Array(count);
  if (count === 0) return { screenXY, depth };

  const first = rtps(view, vertices[0]!.x, vertices[0]!.y, vertices[0]!.z);
  let tmp = (first.sz3 >> 2) | 0;
  screenXY[0] = packSxy(first.sx2, first.sy2);
  for (let i = 1; i < count; i++) {
    const v = vertices[i]!;
    depth[i - 1] = tmp >> depthShift;
    const r = rtps(view, v.x, v.y, v.z);
    screenXY[i] = packSxy(r.sx2, r.sy2);
    tmp = (r.sz3 >> 2) | 0;
  }
  depth[count - 1] = tmp >> depthShift;
  return { screenXY, depth };
}

// ── the layer builder (F0x80083e0c) ────────────────────────────────────────

/** A layer's local pose: a rotation matrix at +0x28 and a vector at +0x3c. */
export interface LocalLayer {
  /** 9 signed-16 elements at +0x28, stored so [0]=x,[3]=y,[6]=z of column 0. */
  readonly rotation: Mat3;
  /** The local vector at +0x3c (+0x3c x, +0x40 y, +0x44 z), i16 per slot. */
  readonly translation: Vec3;
  /** The three signed-16 scale words at +0x60-0x40 (a layer is hidden if their
   *  signed OR is below 0x31). */
  readonly scale: Vec3;
}

/** The parent pose the layer hangs off (the block at layer+0x48). */
export interface ParentLayer {
  /** Parent rotation matrix (the 5 words at +0x48..+0x5c, 9 s16 row-major). */
  readonly rotation: Mat3;
  /** Parent translation (32-bit words at +0x5c/+0x60/+0x64). */
  readonly translation: Vec3;
}

export interface LayerWorld {
  /** Composed rotation, in the layout the three passes write at +0x4c. */
  readonly rotation: Mat3;
  /** Composed translation (MAC1..MAC3), written to +0x60 of the layer block. */
  readonly translation: Vec3;
}

/**
 * A layer is drawn only when the signed OR of its three scale components is at
 * least 0x31; a hidden layer keeps its last visible matrix.
 */
export function layerVisible(scale: Vec3): boolean {
  return ((s16(scale.x) | s16(scale.y) | s16(scale.z)) < 0x31) === false;
}

/**
 * FIGHTSTG_F0x80083e0c, the layer builder's parent-chain composition.
 *
 * The routine resolves the parent chain and runs four GTE passes over it:
 *
 *   pass A/B/C (c2 0x49e012, three times): MVMVA RT x IR, no translation, one
 *     per column of the layer's local matrix — this is R_world = R_parent x
 *     R_local, computed column by column into +0x4c.
 *   pass D (c2 0x480012): MVMVA RT x V0 with the translation vector — this is
 *     T_world = R_parent x T_local + T_parent, stored to the layer's +0x60.
 *
 * The surrounding routine (allocation, the RotMatrix RzRyRx and scale pre-pass
 * at +0x18) is not reproduced here; see the report.
 */
export function composeLayer(parent: ParentLayer, local: LocalLayer): LayerWorld {
  const out: number[] = new Array<number>(9).fill(0);
  for (let j = 0; j < 3; j++) {
    const col: Vec3 = {
      x: s16(local.rotation[j] as number),
      y: s16(local.rotation[j + 3] as number),
      z: s16(local.rotation[j + 6] as number),
    };
    const r = mvmva(parent.rotation, col, null, 1, 0);
    out[j] = s16(r.ir1);
    out[j + 3] = s16(r.ir2);
    out[j + 6] = s16(r.ir3);
  }
  const t = mvmva(parent.rotation, local.translation, parent.translation, 1, 0);
  return {
    rotation: out,
    translation: { x: t.mac1, y: t.mac2, z: t.mac3 },
  };
}

// ── the layer builder's surrounding steps (F0x80083e0c, outside the passes) ──
//
// The block the oracle above covers is only the four MVMVA passes at
// 0x800841e4..0x80084324. The routine wraps them in a per-layer walk
// (0x8008415c..0x80084340) that:
//
//   1. reads the layer's three signed-16 scale words at +0x20/+0x22/+0x24 and
//      hides the layer (writes 0 to +0x0c) when their signed OR is < 0x31;
//   2. for a visible layer, runs the local pose through RotMatrix Rz·Ry·Rx
//      (F0x8002b45c, angles at +0x18 → matrix at +0x28) and then ScaleMatrix
//      (F0x8002b23c, the three scale words);
//   3. copies the three local translation halfwords at +0x10/+0x12/+0x14 to
//      +0x3c/+0x40/+0x44 and reads the parent pointer at +0x48;
//   4. falls into the four MVMVA passes (composeLayer).
//
// Steps 1, 3 and 4 are ported here. Step 2 is now ported too: the RotMatrix
// Rz·Ry·Rx builder (F0x8002b45c) is `rotMatrixZYX` in engine/dw3/gte-math.ts,
// so the local pose is COMPUTED from the layer's angles rather than taken as
// input. The two-call sequence the builder runs — RotMatrix(angles → +0x28) then
// ScaleMatrix(+0x28, scale) — is what `layerLocalPose` now reproduces, and it is
// oracled against both original routines in battle-mesh-oracle.test.ts.

/** Skip a layer whose three signed-16 scale components OR below 0x31. */
export function layerLocalPose(layer: {
  /** The three local rotation angles at +0x18/+0x1a/+0x1c (4096 units/turn). */
  readonly angles: Vec3;
  /** The three scale words at +0x20/+0x22/+0x24 (signed 16). */
  readonly scale: Vec3;
  /** The three local translation halfwords at +0x10/+0x12/+0x14. */
  readonly translation: Vec3;
}): { visible: boolean; rotation: Mat3; translation: Vec3 } {
  const visible = layerVisible(layer.scale);
  if (!visible) {
    // The original jumps past the whole matrix build, leaving +0x28 stale.
    return { visible: false, rotation: rotMatrixZYX(layer.angles.x, layer.angles.y, layer.angles.z), translation: layer.translation };
  }
  // RotMatrix Rz·Ry·Rx (F0x8002b45c) then ScaleMatrix (F0x8002b23c), in place.
  const local = rotMatrixZYX(layer.angles.x, layer.angles.y, layer.angles.z);
  return {
    visible: true,
    rotation: scaleMatrix(local, layer.scale),
    translation: layer.translation,
  };
}

/**
 * ScaleMatrix — F0x8002b23c (resident libgte). Multiplies each of the nine
 * signed-16 matrix elements by the scale component of its *column*
 * (element k uses scale k % 3), SAR 12, kept as a signed 16-bit word.
 *
 * Read from the disassembly: element e (a0 + 2e) = (s16(a0+2e) * m[k]) >> 12,
 * where the low half of a matrix word uses the first scale word and the high
 * half the second, and the three-element column stride cycles m0,m1,m2
 * (`multu` low product then `sra 0xc`). The voice is symmetric within each
 * matrix word; the oracle in battle-mesh-oracle.test.ts runs the original
 * words and compares.
 */
export function scaleMatrix(m: Mat3, scale: Vec3): Mat3 {
  // The three scale components are 32-bit words (the layer builder does `lh`
  // then `sw`, i.e. sign-extended). The hardware multiplies each element by the
  // word with `multu`, keeps the low 32 bits of the product, then SAR 12 and
  // masks to 16 bits — so the high bits of a negative word matter.
  const v = [s16(scale.x) | 0, s16(scale.y) | 0, s16(scale.z) | 0];
  const out: number[] = new Array<number>(9).fill(0);
  for (let k = 0; k < 9; k++) {
    out[k] = (Math.imul(s16(m[k] as number), v[k % 3] as number) >> 12) & 0xffff;
  }
  return out;
}

// ── the display-list interpreter's vertex packet builders ───────────────────
//
// F0x80084bc0/F0x80084e0c (with their tails F0x80084d74/F0x80084f68) pack one
// primitive into the interpreter's output buffer and advance its cursor at
// header+0x54. They are reached from the bytecode loop at 0x80085878 and
// 0x800858ac. The packet is a PS1 linked-list primitive: the first word holds
// [link | command], the second word's top byte holds the packet length; the
// builder also writes the destination address back into the word at
// *(header+0x68) so successive packets chain.
//
// Ported read from the disassembly (the lifted C for these routines is empty of
// COP2 only insofar as they contain none: they are pure word writes). The
// oracle runs the original words and compares every byte of the packet, the
// chained link word and the advanced cursor.

export interface LayerPacketFields {
  /** header+0x0c: nonzero selects the two-sided form (A) / long form (B). */
  readonly twoSided: boolean;
  /** header+0x18: sets bit 1 of the packet's length byte. */
  readonly flag18: boolean;
  /** header+0x74/+0x78/+0x7c: three vertex words. */
  readonly vertex: readonly [number, number, number];
  /** header+0x80: the fourth vertex word (form A two-sided only). */
  readonly vertex3: number;
  /** header+0x58/+0x5c/+0x60: three matrix words. */
  readonly matrix: readonly [number, number, number];
  /** header+0x6c/+0x6e/+0x70: three texcoord halfwords. */
  readonly texCoord: readonly [number, number, number];
  /** header+0x42 and header+0x40: two shade halfwords. */
  readonly shade: readonly [number, number];
  /** header+0x64: the colour word (long forms). */
  readonly colour: number;
  /** header+0x72: an extra halfword (long forms). */
  readonly extra: number;
}

function u16(v: number): number {
  return v & 0xffff;
}

/**
 * The merge both packers end with: word0 := (word0 & 0xff00) | (link & 0xffff),
 * then link := (link & 0xff00) | (cursorAddress & 0xffff). `dstWord` is the
 * word0 the packer just wrote the command byte into.
 */
function linkMerge(
  dstWord: number,
  link: number,
  cursorAddr: number,
): { dstWord: number; link: number } {
  // The two masks are `lui $a2,0xff00` (= 0xff000000) and `lui $a1,0xff` +
  // `ori 0xffff` (= 0x00ffffff): the command byte stays in word0, the low 24
  // bits of the destination address chain into the word at *(header+0x68).
  const outDst = (((dstWord & 0xff000000) | (link & 0x00ffffff)) | 0) | 0;
  const outLink = (((link & 0xff000000) | (cursorAddr & 0x00ffffff)) | 0) | 0;
  return { dstWord: outDst, link: outLink };
}

/**
 * F0x80085110's mesh arm selects its packet builder by the state register s44
 * (set by 0xDn): nonzero -> packer A (F0x80084bc0, the two-sided/long form),
 * zero -> packer B (F0x80084e0c). This is the wiring between the ported dispatch
 * loop (engine/dw3/battle-displaylist.ts) and the builders above: the loop
 * decides which one runs, and both run this one ported implementation rather
 * than a second copy.
 */
export function displayListMeshPacker(state: DisplayListState): "A" | "B" {
  return state.s44 !== 0 ? "A" : "B";
}

/** Emit one mesh primitive through the builder the loop selected. */
export function emitDisplayListMesh(
  packer: "A" | "B",
  out: Uint8Array,
  cursorAddr: number,
  fields: LayerPacketFields,
  link: number,
): { cursor: number; link: number; size: number; dstWord: number } {
  return packer === "A"
    ? packLayerPacketA(out, cursorAddr, fields, link)
    : packLayerPacketB(out, cursorAddr, fields, link);
}

/**
 * F0x80084bc0 — pack a two-sided triangle/quad packet (form A). Writes into
 * `out` (index 0 = the packet address `cursorAddr`), uses `link` = the current
 * word at *(header+0x68), and returns the advanced cursor, the updated link
 * word and the packet size in bytes.
 */
export function packLayerPacketA(
  out: Uint8Array,
  cursorAddr: number,
  f: LayerPacketFields,
  link: number,
): { cursor: number; link: number; size: number; dstWord: number } {
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint32(4, f.vertex[0], true);
  dv.setUint32(0x10, f.vertex[1], true);
  dv.setUint32(0x1c, f.vertex[2], true);
  if (f.twoSided) dv.setUint32(0x28, f.vertex3, true);
  dv.setUint32(8, f.matrix[0], true);
  dv.setUint32(0x14, f.matrix[1], true);
  dv.setUint32(0x20, f.matrix[2], true);
  dv.setUint16(0xc, u16(f.texCoord[0]), true);
  dv.setUint16(0x18, u16(f.texCoord[1]), true);
  dv.setUint16(0x24, u16(f.texCoord[2]), true);
  dv.setUint16(0xe, u16(f.shade[0]), true);
  dv.setUint16(0x1a, u16(f.shade[1]), true);

  const size = f.twoSided ? 0x34 : 0x28;
  dv.setUint8(3, f.twoSided ? 0x0c : 0x09);
  dv.setUint8(7, (f.twoSided ? 0x3c : 0x34) | (f.flag18 ? 2 : 0));
  if (f.twoSided) {
    dv.setUint32(0x2c, f.colour, true);
    dv.setUint16(0x30, u16(f.extra), true);
  }
  // The merge reads word0 as the packer has just written it (command byte in).
  const dstWordIn = dv.getUint32(0, true);
  const merged = linkMerge(dstWordIn, link, cursorAddr);
  dv.setUint32(0, merged.dstWord, true);
  return { cursor: cursorAddr + size, link: merged.link, size, dstWord: merged.dstWord };
}

/**
 * F0x80084e0c — pack the single-vertex form B. Same linked-list treatment;
 * writes one vertex word and three matrix/texcoord/shade columns and uses the
 * 0x28/0x20-byte sizes.
 */
export function packLayerPacketB(
  out: Uint8Array,
  cursorAddr: number,
  f: LayerPacketFields,
  link: number,
): { cursor: number; link: number; size: number; dstWord: number } {
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint32(4, f.vertex[0], true);
  dv.setUint32(8, f.matrix[0], true);
  dv.setUint32(0x10, f.matrix[1], true);
  dv.setUint32(0x18, f.matrix[2], true);
  dv.setUint16(0xc, u16(f.texCoord[0]), true);
  dv.setUint16(0x14, u16(f.texCoord[1]), true);
  dv.setUint16(0x1c, u16(f.texCoord[2]), true);
  dv.setUint16(0xe, u16(f.shade[0]), true);
  dv.setUint16(0x16, u16(f.shade[1]), true);

  const size = f.twoSided ? 0x28 : 0x20;
  dv.setUint8(3, f.twoSided ? 0x09 : 0x07);
  dv.setUint8(7, (f.twoSided ? 0x2c : 0x24) | (f.flag18 ? 2 : 0));
  if (f.twoSided) {
    dv.setUint32(0x20, f.colour, true);
    dv.setUint16(0x24, u16(f.extra), true);
  }
  const dstWordIn = dv.getUint32(0, true);
  const merged = linkMerge(dstWordIn, link, cursorAddr);
  dv.setUint32(0, merged.dstWord, true);
  return { cursor: cursorAddr + size, link: merged.link, size, dstWord: merged.dstWord };
}

// ── the on-screen test (F0x80085000) ────────────────────────────────────────
//
// Before the node's mesh is projected and drawn, F0x80085110 calls this test to
// decide whether the node is on screen at all: it runs RTPS on the node's
// vertex list (node+0x6c) with whatever matrix the caller loaded, and returns 1
// as soon as one projected vertex falls inside the screen rectangle carried in
// its second argument. A nonzero flag at node+0x50 short-circuits to true.
//
// The four edges are computed once from the bounds struct: the rectangle is
// grown by 0x80 on the far side and shrunk by 0x40 on the near side, then inset
// by the two s16 values at +0x6c/+0x6e. At most 9 vertices are tested (the
// `slti $a2, 9` loop cap); if none is inside, the test returns 0.

/** The screen-bounds struct F0x80085000's second argument points at (s16 fields). */
export interface ScreenBounds {
  /** +0x00: rectangle x (s16). */
  readonly x: number;
  /** +0x02: rectangle y (s16). */
  readonly y: number;
  /** +0x04: rectangle width (s16). */
  readonly w: number;
  /** +0x06: rectangle height (s16). */
  readonly h: number;
  /** +0x6c: x inset (s16). */
  readonly insetX: number;
  /** +0x6e: y inset (s16). */
  readonly insetY: number;
}

/** The `slti $a2, 9` cap: at most nine vertices are projected and tested. */
export const ON_SCREEN_VERTEX_LIMIT = 9;

/**
 * FIGHTSTG_F0x80085000 — the on-screen test. `forceFlag` is node+0x50; `vertices`
 * is the list at node+0x6c; `bounds` is the struct at the routine's second
 * argument; `view` is the GTE matrix the caller loaded.
 */
export function onScreenTest(
  forceFlag: number,
  vertices: readonly MeshVertex[],
  bounds: ScreenBounds,
  view: RtpsView,
): boolean {
  if (forceFlag !== 0) return true;
  const x = s16(bounds.x);
  const y = s16(bounds.y);
  const w = s16(bounds.w);
  const h = s16(bounds.h);
  const ix = s16(bounds.insetX);
  const iy = s16(bounds.insetY);
  const loX = x - 0x40 - ix;
  const hiX = x - 0x40 + w + 0x80 - ix;
  const loY = y - 0x40 - iy;
  const hiY = y - 0x40 + h + 0x80 - iy;
  for (let n = 1; n <= ON_SCREEN_VERTEX_LIMIT; n++) {
    const v = vertices[n - 1];
    if (!v) return false;
    const r = rtps(view, v.x, v.y, v.z);
    const sx = s16(r.sx2);
    const sy = s16(r.sy2);
    if (sx < loX || hiX < sx || sy < loY || hiY < sy) {
      if (n >= ON_SCREEN_VERTEX_LIMIT) return false;
      continue;
    }
    return true;
  }
  return false;
}

// ── the layer builder's frame-type dispatch (F0x80083e0c, entry) ─────────────
//
// F0x80083e0c's very first act is a four-way switch on the layer's frame type
// at +0x0c (`lw $s0, 0xc($s3)` at 0x80084188). Type 1 takes the alternate build
// path at 0x8008394; type 2 returns at once through the epilogue; type 3 calls
// the release pointer at [0x8004b5ec] with the layer array; type 0, a negative
// type and any type ≥ 4 all fall through into the main walk at 0x800841b4.

/** Which arm of F0x80083e0c's frame-type switch a layer type takes. */
export type LayerFrameKind = "walk" | "rebuild" | "idle" | "release";

export function layerFrameKind(type: number): LayerFrameKind {
  if (type === 1) return "rebuild";
  if (type === 2) return "idle";
  if (type === 3) return "release";
  return "walk"; // 0, negative, and >= 4 fall through to the main walk
}

// ── the layer-figure allocation (F0x80084560) ───────────────────────────────
//
// FIGHTSTG_F0x80084560 builds one animated figure: a context supplies a count
// and a run of per-layer words, the resident object factory F0x800143dc creates
// the figure object, and one array of `(count+1) * 0x84`-byte layer records is
// allocated behind it. Layer 0 is reset to identity (scale 0x1000); layers 1..n
// each take three words from the context (the second and third OR'd with the
// caller's high half). The routine ends by installing the figure's four method
// pointers and its tick.
//
// The object factory and the two allocations are the console's own resident
// services, so they are injected; everything F0x80084560 itself computes and
// writes is reproduced here and oracled field by field.

export const LAYER_STRIDE = 0x84;
/** Resident pointers the figure object and its layer records carry. */
export const LAYER_FIGURE_BUILDER = 0x80083e0c; // the tick F0x800143dc installs
export const LAYER_FIGURE_SIZE = 0x2634;
export const LAYER_METHOD_POINTERS = [0x80083a54, 0x80084554, 0x80084464, 0x800844f8] as const;
export const LAYER0_ORDERING_HEAD = 0x8004dc20;

/** The services F0x80084560 borrows from the console. */
export interface LayerFigureHost {
  /** `[0x80044f5c]()`: the count at +0x4 and the flags word at +0x0. */
  context(): { flags: number; count: number; words: readonly number[] };
  /** F0x800143dc(tick, a1, sizeExtra, kind): create the figure object. */
  createBuilder(a0: number, a1: number, a2: number, a3: number): number;
  /** `[0x8004b5f4](size, align)`: allocate the layer record array. */
  allocate(size: number, align: number): number;
}

/** A minimal 32/16-bit writer over the figure object and its layer records. */
export interface LayerFigureMemory {
  write32(addr: number, value: number): void;
  write16(addr: number, value: number): void;
}

export interface LayerFigureArgs {
  /** $a0 — the caller's high half, OR'd into the figure's flags and stored words. */
  readonly arg0: number;
  readonly arg1: number;
  readonly arg2: number;
  readonly arg3: number;
  /** The two stack arguments: arg4 → object+0x64, arg5 → object+0x60. */
  readonly arg4: number;
  readonly arg5: number;
}

/** F0x80084560 — create one animated layer figure. Returns the object pointer. */
export function createLayerFigure(
  host: LayerFigureHost,
  mem: LayerFigureMemory,
  args: LayerFigureArgs,
): number {
  const mask = args.arg0 & 0xffff0000;
  const ctx = host.context();
  const count = ctx.count;
  const layers = count + 1;
  const obj = host.createBuilder(LAYER_FIGURE_BUILDER, LAYER_FIGURE_SIZE, (count + 2) * 4, 0x11);
  const records = host.allocate(layers * LAYER_STRIDE, 2);

  mem.write32(obj + 0x54, records);
  mem.write32(obj + 0x64, args.arg4);
  mem.write32(obj + 0x60, args.arg5);
  mem.write32(obj + 0x68, args.arg2);
  mem.write32(obj + 0x6c, args.arg3);
  // The original stores the bare flags at obj+0x70 in the branch delay slot of its
  // `beqz` (so the store happens whether or not the flags are zero), then — only when
  // the flags are nonzero — overwrites that same word with flags|mask. Reproduced as
  // the same two stores, not coalesced, so the write shape matches the original
  // (battle-mesh-oracle compares final values; battle-anim-instance-oracle compares
  // the trace).
  mem.write32(obj + 0x70, ctx.flags);
  if (ctx.flags !== 0) mem.write32(obj + 0x70, (ctx.flags | mask) | 0);
  mem.write32(obj + 0x50, layers);

  // Layer 0: reset to the identity pose and the ordering head.
  mem.write32(records + 0x00, 0);
  mem.write32(records + 0x04, 0);
  mem.write32(records + 0x08, 0);
  mem.write32(records + 0x48, LAYER0_ORDERING_HEAD);
  // The original zeroes the halfwords at 0x10/0x12/0x14 then 0x18/0x1a/0x1c: it does
  // NOT write 0x16 (`sh $zr,0x14` is followed by `sh $zr,0x18`, fightstg.s L1677/L1680).
  // The port reproduces that gap rather than writing 0x16.
  for (const o of [0x10, 0x12, 0x14, 0x18, 0x1a, 0x1c]) mem.write16(records + o, 0);
  mem.write16(records + 0x20, 0x1000);
  mem.write16(records + 0x22, 0x1000);
  mem.write16(records + 0x24, 0x1000);

  // Layers 1..count, one record each from three context words.
  for (let i = 1; i < layers; i++) {
    const base = records + i * LAYER_STRIDE;
    const w = (i - 1) * 3;
    mem.write32(base + 0x0, ctx.words[w] as number);
    mem.write32(base + 0x4, ((ctx.words[w + 1] as number) | mask) | 0);
    mem.write32(base + 0x8, ((ctx.words[w + 2] as number) | mask) | 0);
  }

  mem.write32(obj + 0x2624, LAYER_METHOD_POINTERS[0]);
  mem.write32(obj + 0x2628, LAYER_METHOD_POINTERS[1]);
  mem.write32(obj + 0x262c, LAYER_METHOD_POINTERS[2]);
  mem.write32(obj + 0x74, args.arg1);
  mem.write32(obj + 0x2630, LAYER_METHOD_POINTERS[3]);
  return obj;
}

// ── the animator constructor wrapper (F0x800847c4) ──────────────────────────
//
// FIGHTSTG_F0x800847c4 is the op6 flight update's entry to the layer-figure builder
// above: `addiu sp,-0x20; lw v0,0x30(sp); sw ra,0x18(sp); sw a2,0x28(sp); sw a3,0x2c(sp);
// sw zero,0x14(sp); jal 0x80084560; sw v0,0x10(sp); lw ra; jr ra; addiu sp,0x20`
// (pro_fightstg.bin at 0x800847c4). It forwards its a0-a3 unchanged, forwards its fifth
// argument (the caller's stack word at 0x10) into the builder's fifth argument, and zeroes
// the builder's sixth argument. So it is createLayerFigure with arg5 = 0 — the port reuses
// the ported builder rather than re-deriving it. NOTE the disassembler attributes this
// address to `cardgame.norm.s` with *different* bytes (the shared 0x80082cb0 load base);
// the bytes above are this overlay's, read from the committed image.

/** F0x800847c4 — the layer-figure builder wrapper. */
export const LAYER_FIGURE_THUNK = 0x800847c4;

/** The wrapper's five forwarded arguments (a0-a3 and the caller's stack arg). */
export interface LayerFigureThunkArgs {
  readonly arg0: number;
  readonly arg1: number;
  readonly arg2: number;
  readonly arg3: number;
  /** The wrapper's fifth argument — the builder's arg4 (object+0x64). */
  readonly arg4: number;
}

/** The builder argument block the wrapper builds: arg5 is forced to 0. */
export function layerFigureThunkArgs(a: LayerFigureThunkArgs): LayerFigureArgs {
  return { arg0: a.arg0, arg1: a.arg1, arg2: a.arg2, arg3: a.arg3, arg4: a.arg4, arg5: 0 };
}

/** F0x800847c4 — build one layer figure through the wrapper's argument mapping. */
export function createLayerFigureThunk(
  host: LayerFigureHost,
  mem: LayerFigureMemory,
  a: LayerFigureThunkArgs,
): number {
  return createLayerFigure(host, mem, layerFigureThunkArgs(a));
}

// ── the interpreter's node-view prologue (F0x80085110, 0x80085124..0x800852bc) ─

/**
 * FIGHTSTG_F0x80085110's prologue composes the node's view matrix before the
 * bytecode loop: it loads the resident rotation constant at 0x80081358 into
 * GTE RT (ctrl 0-4), runs the node's local matrix at +0x84 through the same
 * three MVMVA column passes and the translation pass composeLayer runs, writes
 * the result to the stack (sp+0x10 matrix, sp+0x24 translation), then copies it
 * back into GTE RT (ctrl 0-4) and TR (ctrl 5-7). It then calls the on-screen
 * test F0x80085000; only when that returns nonzero does it call the vertex
 * projection and the effect-mesh colour path.
 *
 * The constant (5 rotation words + 3 translation words, read from the pinned
 * RAM dump at 0x80081358) is supplied by the caller; the arithmetic is
 * composeLayer's, so the port cannot drift from the layer builder.
 */
export function composeNodeView(
  parent: ParentLayer,
  local: LocalLayer,
): LayerWorld {
  return composeLayer(parent, local);
}

// ── the mesh blob → primitive decode, through the ported loop ────────────────
//
// The op6 projectile meshes (and the effect meshes) are `0x18` MEFT bodies: a u32
// section table, then a vertex block (sec0: i16 count, 2 pad, count × SVECTOR),
// a normals block (sec1) and the GTE display list (sec2). The display list is the
// byte stream FIGHTSTG_F0x80085110 walks. This function runs the PORTED loop over
// that stream and returns the per-primitive draw fields the browser draws from —
// the same fields the extractor's hand-written `decode_mesh` used to produce, but
// computed by the port so the two cannot drift.

/** One decoded primitive, in the shape the shipped `proj/*.json` layers carry. */
export interface DecodedMeshPrimitive {
  /** The vertex indices (3, or 4 for a quad). */
  readonly idx: number[];
  /** Absolute (u,v) per vertex, or null when the mesh has no UV run. */
  readonly uv: [number, number][] | null;
  /** The raw one-based ABR selector (s48). */
  readonly abr: number;
  /** The tex-op CLUT bytes of the governing 0x01 descriptor. */
  readonly clut: [number, number];
  /** True when the primitive samples a texture (a UV run, or the s44 selector). */
  readonly textured: boolean;
  /** The colour-packet RGB in force. */
  readonly color: [number, number, number];
}

/** The vertex list, normal records and raw display list of one `0x18` mesh body. */
export interface MeshBlob {
  readonly verts: number[][];
  /** sec2 onward — the raw bytes the ported loop walks (terminator included). */
  readonly dl: Uint8Array;
  /**
   * sec1 — the node's normal records, one SVECTOR {x,y,z: i16} per entry. This is
   * the block FIGHTSTG_F0x800847f4 shades (it reads `node+0x64`, `lh` the count at
   * +0 then 6-byte records from +6) and the table the display list's lit run
   * (s40) indexes by normal index. The disc ships it inside the mesh body: 23 of
   * the 572 shipped op6 meshes carry a non-empty list. Empty when the body ships
   * none (the count halfword is 0). The 4-byte tail after the records is padding.
   */
  readonly normals: number[][];
}

/** Split a `0x18` mesh body into its vertex block, normal records and raw display list. */
export function readMeshBlob(blob: Uint8Array): MeshBlob {
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const n = (dv.getUint32(0, true) >>> 2) >>> 0;
  const secs: number[] = [];
  for (let i = 0; i < n; i++) secs.push(dv.getUint32(i * 4, true) >>> 0);
  const vbase = secs[0] ?? 0;
  const vcnt = dv.getInt16(vbase, true);
  const verts: number[][] = [];
  for (let i = 0; i < vcnt; i++) {
    const o = vbase + 6 + i * 6;
    verts.push([dv.getInt16(o, true), dv.getInt16(o + 2, true), dv.getInt16(o + 4, true)]);
  }
  const dlStart = secs[2] ?? 0;
  // sec1 — the node's normal records: `lh` count at +0, then count 6-byte SVECTORs
  // from +6 (FIGHTSTG_F0x800847f4, fightstg.s L1785-1787 / L1897-1901). The 4-byte
  // tail after the records is section padding.
  const nbase = secs[1] ?? 0;
  const ncnt = nbase > 0 && secs.length > 1 ? dv.getInt16(nbase, true) : 0;
  const normals: number[][] = [];
  for (let i = 0; i < ncnt; i++) {
    const o = nbase + 6 + i * 6;
    if (o + 6 > blob.byteLength) break;
    normals.push([dv.getInt16(o, true), dv.getInt16(o + 2, true), dv.getInt16(o + 4, true)]);
  }
  return { verts, dl: blob.subarray(dlStart), normals };
}

/**
 * Walk a mesh's raw display list with the ported loop and return its primitives.
 * When the caller supplies the node's projected tables the projected-sign cull
 * runs and culled primitives are dropped; without them (the offline extractor has
 * no projection) every primitive is returned, exactly as the extractor's
 * hand-written decode did.
 */
export function decodeMeshPrims(dl: Uint8Array, opts: {
  cull?: boolean;
  tables?: { table78?: readonly number[] };
  node?: { colorOverride: number; colorBytes: [number, number, number]; texBase0: number; texBase1: number };
} = {}): DecodedMeshPrimitive[] {
  const res = runDisplayList(
    dl,
    opts.cull && opts.tables
      ? opts.node
        ? { node: opts.node, tables: opts.tables }
        : { tables: opts.tables }
      : opts.node
        ? { node: opts.node }
        : {},
  );
  const prims: DecodedMeshPrimitive[] = [];
  for (const s of res.steps) {
    if (s.kind !== "mesh" || !s.mesh) continue;
    if (s.mesh.fields.culled) continue;
    const m = s.mesh;
    const uv = m.fields.uvBytes
      ? m.indices.map((_, k) => [m.fields.uvBytes![2 * k]!, m.fields.uvBytes![2 * k + 1]!] as [number, number])
      : null;
    prims.push({
      idx: m.indices,
      uv,
      abr: m.abr,
      clut: m.fields.clut,
      textured: m.uv || m.packer === "A",
      color: m.fields.color,
    });
  }
  return prims;
}
