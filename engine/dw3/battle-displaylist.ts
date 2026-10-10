// Ported dispatch loop of the battle display-list interpreter
// FIGHTSTG_F0x80085110 — the last unported block of the battle 3-D chain.
//
// The fight scene draws every model and effect mesh by walking a byte stream the
// node carries at +0x68. This module is that walk: the opcode reader, the state
// registers, the per-opcode advance and the choice of primitive packet builder.
// It is the shared system behind every mesh in a battle, so it is ported once
// here and the cases (models, effect meshes) supply only their own bytes and
// their own node tables.
//
// Read from the overlay ASSEMBLY, ~/ddw3/asm/dw2003/pro/fightstg.s L2527-2912
// (the loop body 0x80085350..0x80085924), never from the lifted C.
//
//   loop top 0x80085350: lbu v0,(a3)          a3 = cursor
//                         srl v1,v0,4          hi nibble
//                         beqz v1,0x800853d8   hi==0 -> low-nibble dispatch
//                         andi a0,v0,0xf       lo nibble
//                         addiu v1,-8 ; sltiu v0,v1,7 ; beqz v0,0x800853c4
//                         lw v0,(D0x80082cb0+v1*4) ; jr v0
//   jump table D0x80082cb0 nibbles 8..14 -> 0x80085390..0x800853c0
//   loop test 0x80085914: lbu v1,(a3) ; li v0,0xff ; bne v1,v0,0x80085350
//
// Opcode classes (the effect on the cursor is measured from the assembly, not
// assumed; see tests/engine/unit/battle-displaylist-oracle.test.ts, which runs
// the original words over the LIVE captured stream):
//
//   0x00        mesh emission; reads 3 (+1 for a quad) index bytes at
//               cursor[1..], looks them up in the node's tables, transforms
//               with COP2 and packs a primitive through F0x80084bc0 (packer A)
//               when s44 != 0, else F0x80084e0c (packer B). The handler
//               pre-increments past the opcode, so the operand run is
//               1 + (s3c+3)*(1 + [s40] + 2*[s30]) bytes.
//   0x01        texpage/primitive descriptor packet; operand bytes cursor[1..6]
//               plus the node's +0x70/+0x74 bases and s48; advance 7.
//   0x02..0x05  colour packet into slot (lo-2); from node+0x58..0x5a when
//               node+0x54 != 0, else from cursor[1..3]; advance 4.
//   0x8n..0xEn  set one state register to the low nibble n: 8=s3c, 9=s30,
//               A=s38, B=s34, C=s40, D=s44, E=s48; advance 1.
//   0x1n..0x7n,
//   0xFn        not covered by the original — the `sltiu (hi-8),7` guard sends
//               them to 0x800853c4, which advances one byte with no effect.
//   0x06..0x0f  hi==0 but lo>5: the low-nibble dispatch's `slti (lo),6` sends
//               them to 0x80085914 with NO advance, re-reading the same byte —
//               the original hangs on any of these. No shipped stream uses one.
//   0xff        terminator (the loop test at 0x80085914).

import { avsz, nclip, s16 } from "./gte-math.ts";

export const DL_TERMINATOR = 0xff;

/** The seven stack cells the 0x8n..0xEn handlers write (sp+0x30..sp+0x48), as
 *  the assembly stores the low nibble into each: 8=s3c, 9=s30, A=s38, B=s34,
 *  C=s40, D=s44, E=s48 (jump table D0x80082cb0, fightstg.s L2543-2555). */
export interface DisplayListState {
  /** 0x9n — the UV-run flag the mesh advance reads. */
  s30: number;
  /** 0xBn — unread by the loop; a state the mesh colour path consumes. */
  s34: number;
  /** 0xAn — unread by the loop. */
  s38: number;
  /** 0x8n — the quad flag: (s3c+3) is the vertex count. */
  s3c: number;
  /** 0xCn — the lit flag (an extra normal run per vertex). */
  s40: number;
  /** 0xDn — nonzero selects packer A (F0x80084bc0); zero selects packer B. */
  s44: number;
  /** 0xEn — the one-based semi-transparency selector (meshAbrMode). */
  s48: number;
}

export function initialDisplayListState(): DisplayListState {
  return { s30: 0, s34: 0, s38: 0, s3c: 0, s40: 0, s44: 0, s48: 0 };
}

/** high nibble 8..14 -> the state slot the jump table's arm writes. */
export const DL_STATE_SLOT: Readonly<Record<number, keyof DisplayListState>> = {
  8: "s3c", 9: "s30", 10: "s38", 11: "s34", 12: "s40", 13: "s44", 14: "s48",
};

export type DisplayListKind =
  | "state" | "mesh" | "prim" | "colour" | "skip" | "terminator" | "hang";

/** The mesh-emission bookkeeping this loop can recover without the colour path:
 *  the index bytes it consumes and the node-table words it looks up. */
export interface MeshLookups {
  /** cursor[1..m] — the vertex indices (m = s3c+3). */
  readonly indices: number[];
  /** node+0x78 lookups (0x80085590/0x800855a0/0x800855b0), one per index. */
  readonly table78: number[];
}

/**
 * The mesh arm's per-primitive packet fields (F0x80085110, 0x8008555c-0x800858b4),
 * read from the overlay assembly. These are what the two packers write into the
 * primitive; the values the machine computes rather than the extractor's
 * hand-written decode. Projection-dependent parts are present only when the
 * caller supplies the node's projected tables.
 */
export interface MeshPacketFields {
  /** The NCLIP MAC0 of the projected triangle (the sp+0xb8 word the `blez` tests
   *  at 0x80085640). Undefined when no node+0x78 table was supplied. */
  readonly cullMac0?: number;
  /** True when the arm drops the primitive: MAC0 <= 0, or two of its SXY words
   *  are equal (L2696-2710), or for a quad the fourth equals one of them. */
  readonly culled?: boolean;
  /** Absolute UV bytes (u,v pairs, one per vertex), after adding the last 0x01
   *  descriptor's base bytes; present only when s30 (the UV run flag) is set. */
  readonly uvBytes?: number[];
  /** The two texpage/shade halfwords the last 0x01 packet left at header+0x42,
   *  +0x40 ([word>>>16, word&0xffff]); the mesh arm does not rewrite them. */
  readonly shade?: [number, number];
  /** s40 lit: node+0x80[normal-index] per vertex (the colour path's output);
   *  s40 clear: the stale stack word the arm copies (undefined — not derived). */
  readonly vertexWords?: number[];
  /** AVSZ3/AVSZ4 ordering value from node+0x7c 0x7c depths; undefined without it. */
  readonly otz?: number;
  /** The colour-packet RGB in force at emission (the last 0x02-0x05), or the
   *  node+0x58 triple. The extractor's per-primitive `color`. */
  readonly color: [number, number, number];
  /** The tex-op CLUT bytes of the last 0x01 descriptor (the extractor's `clut`). */
  readonly clut: [number, number];
}

export interface PrimPacket {
  /** The cursor[1]|cursor[2]<<8 word stored to sp+0x68 (the U base the mesh UV
   *  bytes add; only its low byte is read, `lbu $a2,0x68($sp)`). */
  readonly aux68: number;
  /** cursor[3], stored to sp+0x6c (the V base the mesh UV bytes add). */
  readonly aux6c: number;
  /** The 32-bit word written at sp+0x70 (low half sp+0x70, high half sp+0x72).
   *  The packers read its halves as the packet's two texpage `shade` halfwords. */
  readonly word: number;
  /** cursor[4] and cursor[5] verbatim — the tex-op's CLUT selector bytes the
   *  extractor uses to pick a palette (`decode_mesh`'s `clut`). */
  readonly clut: [number, number];
}

export interface DisplayListStep {
  /** Byte offset in the stream where the opcode was read. */
  readonly offset: number;
  readonly opcode: number;
  readonly kind: DisplayListKind;
  /** Bytes consumed by the handler, including the opcode. */
  readonly advance: number;
  /** Cursor offset after the handler. */
  readonly cursor: number;
  /** Every cursor value the handler writes, in the order the assembly writes
   *  them (the mesh handler pre-increments then adds its run sizes). */
  readonly cursorWrites: number[];
  /** Present for "state": which register and the nibble written. */
  readonly state?: { slot: keyof DisplayListState; value: number };
  /** Present for "mesh": the selected builder, the operand lookups and the
   *  state registers in force at emission. */
  readonly mesh?: {
    packer: "A" | "B";
    advance: number;
    /** s3c — 0 selects a triangle, nonzero a quad (verts = s3c+3). */
    quad: boolean;
    /** s30 — the UV-run flag. */
    uv: boolean;
    /** s40 — the lit/normal-run flag. */
    lit: boolean;
    /** s48 — the one-based semi-transparency selector (meshAbrMode's input). */
    abr: number;
    /** The mesh arm's computed packet fields (UV/shade/colour/cull). */
    fields: MeshPacketFields;
  } & MeshLookups;
  /** Present for "prim": the 0x01 descriptor packet. */
  readonly prim?: PrimPacket;
  /** Present for "colour": the slot (0..3, from lo-2) and the RGB written. */
  readonly colour?: { slot: number; rgb: [number, number, number] };
}

/** Node fields the loop reads: +0x54 gates the colour operand source, +0x58..0x5a
 *  are its replacement triple, +0x70/+0x74 are the 0x01 descriptor bases. */
export interface DisplayListNode {
  readonly colorOverride: number; // node+0x54
  readonly colorBytes: [number, number, number]; // node+0x58..0x5a
  readonly texBase0: number; // node+0x70
  readonly texBase1: number; // node+0x74
}

/** Node lookup tables the mesh arm indexes. The interpreter stores node+0x78 at
 *  sp+0x50 (the packed projected SXY per vertex — what `projectMeshNode` writes),
 *  node+0x7c at sp+0x54 (the per-vertex depth, read for the ordering value) and
 *  node+0x80 at sp+0x5c (the per-normal colour words the effect-mesh colour path
 *  `buildEffectMeshColours` writes). All are runtime arrays; absent offline. */
export interface DisplayListTables {
  /** node+0x78 — packed SXY words; feeds the NCLIP sign cull and the packet's
   *  three matrix words. Without it the cull cannot run (no projection). */
  readonly table78?: readonly number[];
  /** node+0x7c — per-vertex depth (SZ>>2 >> shift); feeds AVSZ3/AVSZ4. */
  readonly table7c?: readonly number[];
  /** node+0x80 — per-normal colour words (the colour path's NCS output). */
  readonly table80?: readonly number[];
}

export interface DisplayListResult {
  readonly steps: DisplayListStep[];
  /** The packer each mesh step selected, in order — the calls the loop makes. */
  readonly packets: ("A" | "B")[];
  readonly state: DisplayListState;
  /** The offset the loop stopped at (the terminator, or a hang). */
  readonly stopped: number;
  readonly hang: boolean;
}

/**
 * Test-only negative-control hook. Each entry shifts one step's advance so a
 * test can prove the oracle comparison actually discriminates a wrong advance.
 * Production callers never pass it.
 */
export interface DisplayListMutations {
  /** Apply `extraAdvance` to the step whose opcode offset equals `at`. */
  readonly at?: number;
  readonly extraAdvance?: number;
}

export interface DisplayListOptions {
  readonly node?: DisplayListNode;
  readonly tables?: DisplayListTables;
  readonly mutations?: DisplayListMutations;
}

function u32(x: number): number {
  return x >>> 0;
}

/**
 * The mesh operand-run advance: `(s3c+3) * (1 + [s40] + 2*[s30])`, with the
 * handler's own pre-increment past the opcode added by the caller as the `1 +`.
 */
export function meshRunAdvance(state: DisplayListState): number {
  const verts = state.s3c + 3;
  return verts * (1 + (state.s40 ? 1 : 0) + 2 * (state.s30 ? 1 : 0));
}

/**
 * FIGHTSTG_F0x80085110's 0x01 handler: build the texpage/primitive descriptor
 * word at sp+0x70 (fightstg.s 0x8008540c..0x800854c8). Ported instruction by
 * instruction; the oracle compares the word against the original's own store.
 */
export function buildPrimPacket(
  bytes: Uint8Array,
  cursor: number,
  node: DisplayListNode,
  s48: number,
): PrimPacket {
  const c = (i: number): number => bytes[cursor + i] ?? 0;
  const aux68 = ((c(2) << 8) | c(1)) >>> 0;
  const aux6c = c(3) >>> 0;

  let v1 = (c(4) + node.texBase0) | 0;
  let v0 = (c(5) + node.texBase1) | 0;
  v0 = (v0 << 6) >>> 0;
  v1 = (v1 >> 4) & 0x3f; // 0x8008544c `sra v1,0x4` then `andi v1,0x3f`
  v0 = (v0 | v1) >>> 0;

  const a0 = ((c(6) & 3) << 7) >>> 0;
  const v1b = ((node.texBase1 & 0x100) >>> 4) >>> 0;
  const a2 = ((node.texBase1 & 0x200) << 2) >>> 0;
  // The assembly stores this first value to sp+0x72 and the second to sp+0x70
  // (0x8008546c then 0x800854bc), so the word at sp+0x70 is second|first<<16.
  const half72 = v0 & 0xffff;

  let a1 = ((node.texBase0 + ((c(2) << 6) >>> 0)) & 0x3ff) >>> 0;
  a1 = a1 >>> 6;

  let m = (a0 | v1b) >>> 0;
  if (s48 !== 0) m = (m | ((((s48 - 1) & 3) << 5) >>> 0)) >>> 0;
  m = (m | a1) >>> 0;
  const half70 = (m | a2) & 0xffff;

  return { aux68, aux6c, word: ((((half72 & 0xffff) << 16) | half70) | 0), clut: [c(4), c(5)] };
}

/**
 * FIGHTSTG_F0x80085110's mesh arm (0x8008555c-0x800858b4), the packet-field build
 * and the projected-sign cull. Reads the operand bytes at `cursor`, the state
 * registers, the node's projected tables and the last 0x01 descriptor, and
 * returns the fields the two packers then write. `lastPrim` is the descriptor
 * word the mesh arm reads its UV bases and texpage halves from; `color` is the
 * RGB the last colour packet left in force.
 */
export function buildMeshFields(
  bytes: Uint8Array,
  cursor: number,
  state: DisplayListState,
  tables: DisplayListTables | undefined,
  lastPrim: PrimPacket | undefined,
  color: [number, number, number],
): MeshPacketFields {
  const verts = state.s3c + 3;
  const at = (i: number): number => bytes[cursor + i] ?? 0;
  const indices: number[] = [];
  for (let i = 0; i < verts; i++) indices.push(at(1 + i));
  const t78 = tables?.table78;

  const fields: {
    cullMac0?: number; culled?: boolean; uvBytes?: number[]; shade?: [number, number];
    vertexWords?: number[]; otz?: number; color: [number, number, number]; clut: [number, number];
  } = { color, clut: lastPrim ? lastPrim.clut : [0, 0] };

  if (lastPrim) fields.shade = [lastPrim.word >>> 16, lastPrim.word & 0xffff];

  // The cull (0x8008555c-0x80085640): load node+0x78[index] for the three (four)
  // vertices into SXY0..3, run NCLIP, and drop the primitive when MAC0 <= 0 or two
  // of the SXY words are equal. Needs the projected table; no table, no cull.
  if (t78) {
    const sxy = indices.map((idx) => (t78[idx] ?? 0) | 0);
    const sx = (k: number): number => s16(sxy[k]! & 0xffff);
    const sy = (k: number): number => s16((sxy[k]! >> 16) & 0xffff);
    const mac0 = nclip([sx(0), sx(1), sx(2), sy(0), sy(1), sy(2)]);
    fields.cullMac0 = mac0;
    let culled = mac0 <= 0 || sxy[0] === sxy[1] || sxy[0] === sxy[2] || sxy[1] === sxy[2];
    if (state.s3c !== 0) culled = culled || sxy[3] === sxy[0] || sxy[3] === sxy[1] || sxy[3] === sxy[2];
    fields.culled = culled;
  }

  // The lit/normal-index run (0x80085648-0x80085708): only when s40, read the
  // normal indices after the vertex run and look each up in node+0x80.
  if (state.s40 && tables?.table80) {
    const t80 = tables.table80;
    fields.vertexWords = indices.map((_, k) => (t80[at(1 + verts + k)] ?? 0) | 0);
  }

  // The UV run (0x80085708-0x800857c8): only when s30, read (u,v) byte pairs after
  // the vertex and (s40) normal runs, adding the descriptor's low base bytes.
  if (state.s30) {
    const baseU = lastPrim ? lastPrim.aux68 & 0xff : 0;
    const baseV = lastPrim ? lastPrim.aux6c & 0xff : 0;
    const uvStart = 1 + verts * (1 + (state.s40 ? 1 : 0));
    const uv: number[] = [];
    for (let k = 0; k < verts; k++) {
      uv.push((at(uvStart + 2 * k) + baseU) & 0xff);
      uv.push((at(uvStart + 2 * k + 1) + baseV) & 0xff);
    }
    fields.uvBytes = uv;
  }

  // The ordering value (0x800857cc-0x8008585c): read node+0x7c[index] depths and
  // run AVSZ4 for a quad, AVSZ3 for a triangle, saturating MAC0 >> 12 to OTZ.
  if (tables?.table7c) {
    const t7c = tables.table7c;
    const depths = indices.map((idx) => (t7c[idx] ?? 0) & 0xffff);
    fields.otz = avsz(state.s3c !== 0 ? 0x400 : 0x555, depths).otz;
  }

  return fields;
}

/**
 * Walk one display-list byte stream exactly as F0x80085110's dispatch loop does.
 * Pure and side-effect free: it returns the step trace, including every cursor
 * value the original stores and the packer each mesh emission selects.
 */
export function runDisplayList(
  bytes: Uint8Array,
  options: DisplayListOptions = {},
): DisplayListResult {
  const node: DisplayListNode = options.node ?? {
    colorOverride: 0, colorBytes: [0, 0, 0], texBase0: 0, texBase1: 0,
  };
  const tables = options.tables;
  const t78 = tables?.table78;
  const state = initialDisplayListState();
  const steps: DisplayListStep[] = [];
  const packets: ("A" | "B")[] = [];
  let lastPrim: PrimPacket | undefined;
  let color: [number, number, number] = [128, 128, 128];
  let cursor = 0;
  let hang = false;
  let guard = 0;

  while (guard++ < 1_000_000) {
    const opcode = bytes[cursor] ?? 0;
    const start = cursor;
    // A negative-control bias shifts this step's whole advance (and every
    // cursor cell it writes). Production never passes `mutations`.
    const bias =
      options.mutations && options.mutations.at === start
        ? options.mutations.extraAdvance ?? 0
        : 0;
    const finish = (step: Omit<DisplayListStep, "advance" | "cursor" | "cursorWrites">,
                    baseAdvance: number, baseWrites: number[]): void => {
      const advance = baseAdvance + bias;
      const cursorWrites = bias === 0 ? baseWrites : baseWrites.map((w) => w + bias);
      const end = start + advance;
      steps.push({ ...step, advance, cursor: end, cursorWrites });
      cursor = end;
    };

    if (opcode === DL_TERMINATOR) {
      steps.push({
        offset: cursor, opcode, kind: "terminator", advance: 0, cursor,
        cursorWrites: [],
      });
      break;
    }
    const hi = opcode >> 4;
    const lo = opcode & 0xf;

    if (hi !== 0) {
      if (hi >= 8 && hi <= 14) {
        const slot = DL_STATE_SLOT[hi]!;
        state[slot] = lo;
        finish({ offset: start, opcode, kind: "state", state: { slot, value: lo } },
          1, [start + 1]);
      } else {
        finish({ offset: start, opcode, kind: "skip" }, 1, [start + 1]);
      }
      continue;
    }

    switch (lo) {
      case 0: {
        const verts = state.s3c + 3;
        const indices: number[] = [];
        for (let i = 0; i < verts; i++) indices.push(bytes[start + 1 + i] ?? 0);
        const table78 = indices.map((idx) => (t78 ? (t78[idx] ?? 0) | 0 : 0));
        const packer: "A" | "B" = state.s44 !== 0 ? "A" : "B";
        const fields = buildMeshFields(bytes, start, state, tables, lastPrim, color);
        // The assembly pre-increments past the opcode (0x80085568), then adds
        // the run in three places: +verts (0x800858d0), +verts more when s40
        // (0x800858d8), +2*verts when s30 (0x800858f8) — each its own `sw`.
        const writes: number[] = [start + 1];
        let c = start + 1 + verts;
        writes.push(c);
        if (state.s40) { c += verts; writes.push(c); }
        if (state.s30) { c += 2 * verts; writes.push(c); }
        const run = verts * (1 + (state.s40 ? 1 : 0) + 2 * (state.s30 ? 1 : 0));
        packets.push(packer);
        finish(
          { offset: start, opcode, kind: "mesh",
            mesh: { packer, advance: run, indices, table78,
                    quad: state.s3c !== 0, uv: state.s30 !== 0, lit: state.s40 !== 0,
                    abr: state.s48, fields } },
          1 + run,
          writes,
        );
        break;
      }
      case 1: {
        const prim = buildPrimPacket(bytes, start, node, state.s48);
        lastPrim = prim;
        finish({ offset: start, opcode, kind: "prim", prim }, 7, [start + 7]);
        break;
      }
      case 2: case 3: case 4: case 5: {
        const slot = lo - 2;
        const rgb: [number, number, number] = node.colorOverride !== 0
          ? [node.colorBytes[0], node.colorBytes[1], node.colorBytes[2]]
          : [bytes[start + 1] ?? 0, bytes[start + 2] ?? 0, bytes[start + 3] ?? 0];
        color = rgb;
        finish({ offset: start, opcode, kind: "colour", colour: { slot, rgb } },
          4, [start + 4]);
        break;
      }
      default: {
        // lo 6..15 with hi 0: the original re-reads the same byte forever.
        hang = true;
        cursor = start;
        steps.push({
          offset: start, opcode, kind: "hang", advance: 0, cursor: start,
          cursorWrites: [],
        });
        break;
      }
    }
    if (hang) break;
  }

  return { steps, packets, state, stopped: cursor, hang };
}
