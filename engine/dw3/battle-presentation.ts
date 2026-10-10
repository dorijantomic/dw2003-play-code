// The 3-D battle's presentation pipeline, translated from the original pro/fightstg
// routines that load a fighter's model data, place it in the arena, realise its
// canned camera shots and animate its texture patches.
//
// This is the "what a battle stage loads, and how the original drives it" layer
// beneath the renderer: the shared system, ported once, that every fight's look
// runs through. The walker's browser renderer used to call its own hand-written
// copies of these (web/battle3d.js arenaSlot, web/fight/texture-patch-animator.js);
// this module is the production port of the original, and the oracle
// tests/lane-b/battle-presentation.test.js runs the original routines through
// engine/native and compares them to it.
//
// ── What a battle model is ─────────────────────────────────────────────────
// A fighter's visible data is not one blob. The disc resource 0x1CC
// (`pro/smdldata.s`) is the per-Digimon *presentation table*: 385 KiB that the
// game preloads on every field→battle transition. It has a 4-word header and two
// index tables over two record sections:
//
//   word 0  header.base   0x80082CB0 — the base every interior self-pointer resolves
//                                      against (NOT that it loads there: smdldata's
//                                      own load address is a shared overlay slot)
//   word 1  indexOffset   0x10       — start of the index tables
//   word 2  section2      0x2458     — player-side records, stride 0xC4 (55 of them)
//   word 3  section3      0x4E74     — enemy-side  records, stride 0x48 (193 of them)
//
// Index entry, 4 bytes little-endian: `[u16 key][u8 selfIndex][u8 slot]`, key 0
// terminates. `slot < 0x3A (58)` selects section 2; `slot >= 58` selects section 3.
// The key is the Digimon's model number (the numeric prefix of its pack folder
// `~/ddw3/pack/dw2003/fight/model/m<NNN>…`). The records are `FIGHTSTG_F0x8009E994`'s
// business; the self-pointer at `+0x0C` into a shared pool is `FIGHTSTG_F0x8009EB94`'s.
//
// A `0xC4` (near) record reads:
//   +0x00/+0x04/+0x08  three packed `(resource << 16) | member` references into that
//                      Digimon's own model pack (the part directory and two members)
//   +0x02              the CD resource index all three share
//   +0x0C              absolute pointer (against header.base) into the shared pool
//   +0x10              arena stand-off (u16)    +0x18 hover height (u16)
//   +0x12/+0x14/+0x16  read by NO instruction in the game; carried, not interpreted
//   +0x1A + 6n         camera eye[n]  (y,z negated on read)    n = 0..11
//   +0x62 + 6n         camera look-at[n], near side
//   +0xAA + 2n         camera view size H[n], near side
//   +0xC2              padding
// A `0x48` (far) record is the same head, then three shots instead of twelve
// (eye at +0x1A+6n, look-at at +0x2C+6n, H at +0x3E+2n) and a 1-based intro shot
// number at `+0x44`.
//
// ── How the original transforms it ─────────────────────────────────────────
// `FIGHTSTG_F0x80087F38(manager, slotId)` places the fighter. It resolves the
// slot's actor block, fetches that fighter's smdldata record through the
// accessor cell D0x800A4570, and writes the live position/rotation and the home
// copy:
//   x = 0, y = -hover, z = -(0x1400 + stand-off) when slotId < 0x10 (near side)
//                            +(0x1400 + stand-off) otherwise (far side)
//   near side rotation.y = 0x800 (180°); far side rotations zeroed
//   live triple (actor +0x1C/+0x1E/+0x20, rotation +0x22/+0x24/+0x26) then copied
//   to the home triple (+0x28/+0x2A/+0x2C, +0x2E/+0x30/+0x32).
// The arena is symmetric about z = 0 and the stand-off/hover are per model, not
// arena constants. No mirror rule exists: the two sides carry separately authored
// data.
//
// ── The display-list packing of a texture patch ─────────────────────────────
// `FIGHTSTG_F0x8008B508(actor, key)` allocates a 0x1A8-byte patch object, carries
// the fighter's VRAM strip origin (actor +0x68/+0x6C) onto it, and walks the
// record's shared-pool slot as up to 16 ten-byte entries. `0xFF` in byte 0 ends
// the walk; a zero width in byte 2 skips the entry. A live entry is copied onto a
// block of stride 0x14 at object +0x60+0x14*slot (the 10 bytes land at +0x68,
// block-relative +0x08):
//   bytes 0,1  destination x,y          bytes 2,3  width,height
//   bytes 4,5  source x,y variant 0     bytes 6,7  variant 1     bytes 8,9  variant 2
// The block's +0x64 caches the last variant it uploaded.
//
// `FIGHTSTG_F0x8008B200` is the per-tick driver. It picks a variant for each live
// block and asks `FIGHTSTG_F0x8008B160` to pack it:
//   * a slot whose kind (object +0xC) is 1 is an *eye* patch: the variant is
//     overridden by the fighter's animation state (`FIGHTSTG_F0x8008B118`: state 2
//     -> 1 half-closed, states 4..11 -> 2 closed, otherwise -> 0 open), and when no
//     override is active a blink timer at object +0x1A0 runs, its high bits
//     selecting open/half/shut through the jump table D0x80082E1C and reloading on
//     the `(rand & 0x7F) + 0x3C` (60..187 tick) pause;
//   * a slot with kind 2 or 3 cycles
//   * any other kind deletes itself on the first frame (count at +0x5C still zero).
// `FIGHTSTG_F0x8008B160(object, dest, slot, variant)` reads the origin-corrected
// rectangle and builds a GP0(0x80) VRAM-to-VRAM copy through the resident
// `F0x8002918C`, which fills a six-halfword descriptor:
//   [srcX, srcY, w, h, dstX, dstY]  (src and dst x/y both offset by the strip origin)
//
// The effect-sprite system (op3/op6) sits on top of the same idea. It is NOT ported
// here; see the research notes named in the oracle test's header for its decode.
//
// ── Evidence ───────────────────────────────────────────────────────────────
// pro/fightstg.s:  FIGHTSTG_F0x8009E994 @28982, F0x8009EB94 @29116,
//                  F0x80087F38 @5417, F0x8008B118 @8382, F0x8008B160 @8404,
//                  F0x8008B200 @8447, F0x8008B508 @8643
// pro/smdldata.s:  header words and the two record sections
// docs/research/battle/smdldata-container-2026-08-05.md (container + every field)
// docs/research/battle/3d-battle-complete-model-2026-08-19.md §6
// docs/research/fight-3d/fight-mesh-geometry.md, original-fight-engine.md
//
// Oracle: tests/lane-b/battle-presentation.test.js runs F0x8009E994, F0x8009EB94,
// F0x80087F38 (with the slot resolver and record accessor stubbed), F0x8008B118 and
// F0x8008B160 (with the resident primitive builder stubbed) on the shipped
// pro_fightstg.bin / resident.bin fixtures, over the real smdldata image.

/** The CD resource index of the per-Digimon battle presentation table. */
export const SMDLDATA_RESOURCE = 0x1cc;
/** `F0x8009E994`: the index slot byte that separates section 3 from section 2. */
export const SMDLDATA_SECTION_SPLIT = 0x3a;
/** `F0x80087F38`: the constant the arena stand-off is added to. */
export const ARENA_BASE_Z = 0x1400;
/** `F0x80087F38`: rotation.y for a near-side fighter (0x800 of 0x1000 = 180°). */
export const ARENA_NEAR_ROT_Y = 0x800;
/** `F0x8008B508`: up to sixteen ten-byte patch entries; 0xFF ends the walk. */
export const PATCH_SLOTS = 16;
export const PATCH_STRIDE = 10;
export const PATCH_END = 0xff;
/** `F0x8008B508`: one slot block on the patch object. */
export const PATCH_BLOCK_STRIDE = 0x14;
export const PATCH_BLOCK_BASE = 0x60;
/** `F0x8008B200`: the eye blink pause reload is `(rand & 0x7f) + 0x3c`. */
export const BLINK_PAUSE_BASE = 0x3c;
export const BLINK_PAUSE_MASK = 0x7f;
/** The cycle body-patch variant is `(t mod 18) / 6`, six ticks each. */
export const CYCLE_PERIOD = 18;
export const CYCLE_HOLD = 6;

/**
 * `D0x80082E1C` — the blink jump table, indexed `timer >> 1`, entries 0..6.
 * Entry 0 is the reload arm (also variant 0); 1..6 read (in time order, as the
 * timer falls from index 6 to 0) 1,1,2,2,1,1 and then 0 — open, half, shut, half,
 * open, then a pause. Index >= 7 (any timer >= 14) is the far `b2ec` arm: variant 0.
 *
 * The table's targets, from pro/fightstg.s:81-87 and the code at :8499-8511:
 *   .L0x80082E1C -> 0x8008B2CC  reload timer, variant 0
 *   .L0x80082E20 -> 0x8008B2F4  variant 1
 *   .L0x80082E24 -> 0x8008B2F4  variant 1
 *   .L0x80082E28 -> 0x8008B2FC  variant 2
 *   .L0x80082E2C -> 0x8008B2FC  variant 2
 *   .L0x80082E30 -> 0x8008B2F4  variant 1
 *   .L0x80082E34 -> 0x8008B2F4  variant 1
 */
export const BLINK_TABLE = [0x8008b2cc, 0x8008b2f4, 0x8008b2f4, 0x8008b2fc, 0x8008b2fc, 0x8008b2f4, 0x8008b2f4] as const;
export const BLINK_TABLE_ADDR = 0x80082e1c;

/** The variant each blink-table target selects, by target pc. */
export const BLINK_TARGET_VARIANT: Readonly<Record<number, number>> = {
  0x8008b2cc: 0, // reload + variant 0 (blink "open", timer resets)
  0x8008b2f4: 1, // half closed
  0x8008b2fc: 2, // shut
};
/** The far arm of the dispatch (timer >= 14): variant 0, no reload. */
export const BLINK_FAR_VARIANT = 0;

export interface SmdldataHeader {
  /** Header word 0: the base interior self-pointers resolve against. */
  base: number;
  /** Header word 1: file offset of the index tables. */
  indexOffset: number;
  /** Header word 2: file offset of the section-2 (near, 0xC4) records. */
  section2: number;
  /** Header word 3: file offset of the section-3 (far, 0x48) records. */
  section3: number;
}

export interface SmdldataLookup {
  /** The u16 model key that matched. */
  key: number;
  /** True when the entry's slot byte is >= 0x3A (a section-3 record). */
  far: boolean;
  /** The entry's selfIndex byte: the record index within its section. */
  selfIndex: number;
  /** The entry's slot byte (1..250 across both tables). */
  slot: number;
  /** 2 or 3: which section the record lives in. */
  section: 2 | 3;
  /** Byte offset of the record inside the image. */
  recordOffset: number;
  /** Mirrors the original's cache: the near-side record pointer offset. */
  recordNear: number;
  /** Mirrors the original's cache: the far-side record pointer offset. */
  recordFar: number;
}

export interface ArenaPlacement {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

export interface CannedShots {
  /** eye[n], y and z negated, as `FIGHTSTG_F0x800923B4` reads them. */
  eye: [number, number, number][];
  /** look-at[n], negated. */
  look: [number, number, number][];
  /** view size H[n]. */
  view: number[];
  /** Section-3 records only: the 1-based intro shot number at +0x44. */
  shot?: number;
}

export interface TexturePatchEntry {
  slot: number;
  dst: [number, number];
  size: [number, number];
  src: [[number, number], [number, number], [number, number]];
}

/** A GP0(0x80) VRAM-to-VRAM copy rectangle, built by `F0x8008B160`. */
export interface PatchCopyRect {
  srcX: number;
  srcY: number;
  width: number;
  height: number;
  dstX: number;
  dstY: number;
}

const s16 = (v: DataView, o: number) => v.getInt16(o, true);
const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/**
 * `FIGHTSTG_F0x80087F38` — the arena placement arithmetic, free of the record image. Near
 * side (slotId < 0x10) faces +z-negated with rotation.y = 0x800; far side is symmetric with
 * zero rotation. A host that already carries a record's own stand-off and hover — the
 * browser's extracted model_placement.json — places a fighter from this one decoded rule
 * instead of a second hand-written copy. `SmdldataTable.placement` is this over a record
 * offset; the `FIGHTSTG_F0x80087F38` oracle in tests/lane-b covers both paths.
 */
export function arenaPlacement(hover: number, standoff: number, slotId: number): ArenaPlacement {
  const near = slotId < 0x10;
  return {
    x: 0,
    y: 0 - hover,
    z: near ? -(ARENA_BASE_Z + standoff) : ARENA_BASE_Z + standoff,
    rotX: 0,
    rotY: near ? ARENA_NEAR_ROT_Y : 0,
    rotZ: 0,
  };
}

/**
 * A parsed `pro/smdldata.s` image. Holds the flattened bytes and reproduces the
 * original's lookups on it. All offsets returned are byte offsets into `bytes`
 * (the game's absolute pointers are `header.base + offset`).
 */
export class SmdldataTable {
  readonly bytes: Uint8Array;
  private readonly v: DataView;

  constructor(bytes: Uint8Array) {
    if (bytes.length < 16) throw new Error("smdldata image is shorter than its header");
    this.bytes = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get header(): SmdldataHeader {
    return {
      base: u32(this.v, 0),
      indexOffset: u32(this.v, 4),
      section2: u32(this.v, 8),
      section3: u32(this.v, 12),
    };
  }

  /**
   * `FIGHTSTG_F0x8009E994` — resolve a model key to its record. Scans the index
   * table from `header.indexOffset` comparing the u16 key, stopping at a zero key.
   * The original caches the last (key -> record) in a global; the resolved result
   * is identical, so this is a pure scan. Returns null when the key is absent,
   * exactly like the routine returning 0.
   */
  lookup(key: number): SmdldataLookup | null {
    const h = this.header;
    const target = key << 16 >> 16; // the original compares a sign-extended halfword
    let off = h.indexOffset;
    for (let n = 0; n < 0x1000; n++) {
      const k = s16(this.v, off);
      if (k === 0) return null;
      if (k === target) {
        const selfIndex = this.bytes[off + 2] as number;
        const slot = this.bytes[off + 3] as number;
        const far = slot >= SMDLDATA_SECTION_SPLIT;
        const recordOffset = far
          ? h.section3 + selfIndex * 0x48
          : h.section2 + selfIndex * 0xc4;
        return {
          key: k, far, selfIndex, slot,
          section: far ? 3 : 2,
          recordOffset,
          // The original writes the same computed pointer into both cache slots.
          recordNear: recordOffset,
          recordFar: recordOffset,
        };
      }
      off += 4;
    }
    return null;
  }

  /** Read the record's first halfword: `key` (also the model number). */
  recordKey(recordOffset: number): number {
    return u16(this.v, recordOffset);
  }

  /**
   * `FIGHTSTG_F0x8009EB94` — the record's stored pool pointer, relocated by
   * subtracting header word 0. `+0x0C` is authored as an absolute pointer against
   * `header.base`; the routine returns `loadBase + (record[+0x0C] - header.base)`,
   * which as an image-relative offset is just `record[+0x0C] - header.base`.
   */
  poolOffset(recordOffset: number): number {
    return (u32(this.v, recordOffset + 0x0c) - this.header.base) >>> 0;
  }

  /** The three packed `(resource << 16) | member` references at the record head. */
  recordReferences(recordOffset: number): { resource: number[]; members: number[] } {
    const resource: number[] = [];
    const members: number[] = [];
    for (const at of [0x00, 0x04, 0x08]) {
      const w = u32(this.v, recordOffset + at);
      resource.push(w >>> 16);
      members.push(w & 0xffff);
    }
    return { resource, members };
  }

  /** `+0x10` arena stand-off, read unsigned like `lhu 0x10($v1)`. */
  standoff(recordOffset: number): number {
    return u16(this.v, recordOffset + 0x10);
  }

  /** `+0x18` hover height, read unsigned like `lhu 0x18($v1)`. */
  hover(recordOffset: number): number {
    return u16(this.v, recordOffset + 0x18);
  }

  /** The three halfwords no instruction reads: `+0x12`, `+0x14`, `+0x16`. */
  unread(recordOffset: number): [number, number, number] {
    return [
      u16(this.v, recordOffset + 0x12),
      u16(this.v, recordOffset + 0x14),
      u16(this.v, recordOffset + 0x16),
    ];
  }

  /**
   * `FIGHTSTG_F0x80087F38` — place a fighter from its own record. Near side
   * (slotId < 0x10) faces +z-negated with rotation.y = 0x800; far side is symmetric
   * with zero rotation. Returns the live position/rotation; the home copy is the
   * same numbers.
   */
  placement(recordOffset: number, slotId: number): ArenaPlacement {
    return arenaPlacement(this.hover(recordOffset), this.standoff(recordOffset), slotId);
  }

  private triple(recordOffset: number, at: number): [number, number, number] {
    // `FIGHTSTG_F0x800923B4` negates the second and third components.
    return [s16(this.v, recordOffset + at), -s16(this.v, recordOffset + at + 2), -s16(this.v, recordOffset + at + 4)];
  }

  /**
   * `FIGHTSTG_F0x800923B4` — the per-model canned camera shots. A near (0xC4)
   * record holds twelve at eye +0x1A, look-at +0x62, H +0xAA; a far (0x48) record
   * holds three at eye +0x1A, look-at +0x2C, H +0x3E, plus its intro shot at +0x44.
   */
  cameraShots(recordOffset: number, far: boolean): CannedShots {
    const shots = far ? 3 : 12;
    const lookAt = far ? 0x2c : 0x62;
    const viewAt = far ? 0x3e : 0xaa;
    const out: CannedShots = {
      eye: [], look: [], view: [],
    };
    for (let i = 0; i < shots; i++) {
      out.eye.push(this.triple(recordOffset, 0x1a + 6 * i));
      out.look.push(this.triple(recordOffset, lookAt + 6 * i));
      out.view.push(s16(this.v, recordOffset + viewAt + 2 * i));
    }
    if (far) out.shot = s16(this.v, recordOffset + 0x44);
    return out;
  }

  /**
   * `FIGHTSTG_F0x8008B508` — walk the record's shared-pool slot as up to sixteen
   * ten-byte entries. `0xFF` in byte 0 ends the walk; a zero width in byte 2 skips
   * the entry. Each live entry carries a destination, a size and three source
   * variants.
   */
  texturePatches(poolOffset: number): TexturePatchEntry[] {
    const out: TexturePatchEntry[] = [];
    for (let i = 0; i < PATCH_SLOTS; i++) {
      const at = poolOffset + i * PATCH_STRIDE;
      const b = this.bytes;
      if ((b[at] as number) === PATCH_END) break;
      if ((b[at + 2] as number) === 0) continue;
      out.push({
        slot: i,
        dst: [b[at] as number, b[at + 1] as number],
        size: [b[at + 2] as number, b[at + 3] as number],
        src: [
          [b[at + 4] as number, b[at + 5] as number],
          [b[at + 6] as number, b[at + 7] as number],
          [b[at + 8] as number, b[at + 9] as number],
        ],
      });
    }
    return out;
  }
}

/**
 * `FIGHTSTG_F0x8008B118` — the eye-patch override from the fighter's animation
 * state code at fighter +0x78. State 2 holds the eyes half-closed (1); states 4
 * through 11 hold them shut (2); state 1, 3 and 12+ let the blink timer run (0).
 */
export function eyePatchVariant(stateCode: number): 0 | 1 | 2 {
  if (stateCode === 2) return 1;
  if (stateCode < 2) return 0;
  if (stateCode < 0xc && stateCode >= 4) return 2;
  return 0;
}

/**
 * `FIGHTSTG_F0x8008B200` — the variant a blink timer selects. Returns the variant
 * and whether the timer reloads this tick (the `(rand & 0x7F) + 0x3C` pause).
 * `timer >= 14` (index >= 7) is the far arm: variant 0, no reload.
 */
export function blinkVariant(timer: number): { variant: 0 | 1 | 2; reload: boolean } {
  const index = timer >> 1;
  if (index < 0 || index >= BLINK_TABLE.length) return { variant: BLINK_FAR_VARIANT as 0, reload: false };
  const target = BLINK_TABLE[index] as number;
  const variant = BLINK_TARGET_VARIANT[target] as 0 | 1 | 2;
  return { variant, reload: target === 0x8008b2cc };
}

/** The blink pause a `rand16()` draws: `(rand & 0x7F) + 0x3C`, 60..187 ticks. */
export function blinkPause(rand16: number): number {
  return (rand16 & BLINK_PAUSE_MASK) + BLINK_PAUSE_BASE;
}

/** `FIGHTSTG_F0x8008B200` — a free-running body patch's variant `(t mod 18) / 6`. */
export function cycleVariant(t: number): 0 | 1 | 2 {
  const m = ((t % CYCLE_PERIOD) + CYCLE_PERIOD) % CYCLE_PERIOD;
  return Math.floor(m / CYCLE_HOLD) as 0 | 1 | 2;
}

/** One live block on the patch object, as `F0x8008B508` fills it. */
export interface PatchBlock {
  slot: number;
  /** The ten entry bytes, `+0x68` block-relative `+0x08`. */
  dst: [number, number];
  size: [number, number];
  src: [[number, number], [number, number], [number, number]];
}

/**
 * `FIGHTSTG_F0x8008B160` — build the GP0(0x80) copy rectangle for a live block and
 * a chosen variant, in coordinates relative to the fighter's VRAM strip origin.
 * The descriptor the resident `F0x8002918C` fills is `[srcX, srcY, w, h, dstX, dstY]`.
 */
export function patchCopyRect(
  block: PatchBlock,
  variant: 0 | 1 | 2,
  originX: number,
  originY: number,
): PatchCopyRect {
  const src = block.src[variant];
  return {
    srcX: src[0] + originX,
    srcY: src[1] + originY,
    width: block.size[0],
    height: block.size[1],
    dstX: block.dst[0] + originX,
    dstY: block.dst[1] + originY,
  };
}
