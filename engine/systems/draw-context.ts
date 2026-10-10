// The resident 2D draw-context service: registry object 0x1002.
//
// DECODE. docs/research/field/draw-context-service-2026-10-04.md. Every claim
// below carries the assembly line it was read from; the summary:
//
// WHAT IT IS. A heap object of 0x16C bytes held in the display table's
// thirty-slot resident registry under the id 0x1002. It is NOT a heap
// allocator: `D0x8004DF8C` slot 0 is `F0x8001DA84` (exe/fns.s:15001-15028),
// which walks thirty 16-byte records from 0x8004DE10 and returns the pointer
// whose id word equals its argument, so the overlays' `li $a0, 0x1002` is a
// LOOKUP, not a malloc. Slot 1, `F0x8001DD04` (exe/fns.s:15183-15227), is the
// register/deregister pair; slot 2, `F0x8001D6E4`, returns the used count.
//
// WHO BUILDS IT. `F0x8001DBE0` (exe/fns.s:15103) takes a free slot and calls
// `F0x8001E5BC` (exe/fns.s:15844-15955), which allocates 0x16C bytes through
// `D0x8004B5FC` (`li $a0, 0x16c` at :15869), copies the 0x54-byte descriptor it
// was handed, sizes two draw buffers from the halfword table at 0x8004DFA0, and
// installs the 23-slot method table reproduced by DRAW_CONTEXT_METHODS below.
//
// THE TWO SLOTS THE STAGES USE.
//   +0x128 `F0x8001E0C8` (exe/fns.s:15483) writes the layer's EFFECTIVE screen
//     rect: x = +0x00 - +0x6C + (+0x70 >> 8), y = +0x02 - +0x6E + (+0x74 >> 8),
//     w = +0x04, h = +0x06. +0x70/+0x74 are 16.16 scroll accumulators and
//     +0x6C/+0x6E the origin, so this is "where on screen does this layer sit
//     right now". The overlays pair it with their own rectangle test, which is
//     `visibleInLayer` below.
//   +0x14C `F0x8001E240` (exe/fns.s:15593-15650) does NOT emit anything. It
//     inserts a 20-byte record into the layer's own list, keyed on the caller's
//     y and kept in DESCENDING key order: the walk at :15615-15630 stops at the
//     first existing record whose key is >= the new one and splices there, so
//     equal keys keep insertion order (first in wins). When the list is full
//     (`count < capacity` at :15594) the insert is DROPPED, not deferred.
//   +0x154 `F0x8001E38C` (exe/fns.s:15684-15705) is the flush: walk the list
//     from the head and call each record's callback with (payload, layer, tag),
//     then `F0x8001E19C` (exe/fns.s:15544) resets the head key to 0x7FFFFFFF and
//     the count to 1 -- the sentinel, not zero.
//
// THE ORDER THE GPU SEES. `F0x800266B4` (exe/fns.s:24554-24700), reached
// through +0x130, writes, in this order: GP0(E3h) set texture window, GP0(E4h)
// set drawing area top-left, GP0(E5h) set drawing area bottom-right, GP0(E1h)
// set draw mode, GP0(E2h) set draw mode 2 (texpage/CLUT), GP0(E6h) set drawing
// offset back to 0,0 -- and then, only when the descriptor's byte +0x18 is
// nonzero, a four-word GP0(60h) monochrome variable rectangle. The two
// rectangles above are the PS1 scissor pair: the layer's own picture is drawn
// clipped to its texture window, and the GP0(60h) pass paints the clipped
// region. The primitives a QUEUED record produces are a separate emitter,
// `F0x8001ED6C` (exe/fns.s:16377), reached through the transient context's
// +0x84, and it is the one the stage shapes go through: it emits GP0(64h) --
// variable-size monochrome rectangle, untextured -- or GP0(66h), the same with
// the texture bit, chosen by whether the shape's third halfword is -1
// (`sb $v0, -0x7($s1)` at :16618 with `li $v0, 0x66` at :16624 when it is).
//
// A THIRD CONTEXT, not to be confused with either. `F0x8001F648`
// (exe/fns.s:16968) builds a 0xA0-byte STACK block with a twelve-slot table at
// +0x70 whose setters all write through the two-word global at gp+0x1C0
// (current layer pointer, current packet cursor). `+0x80` is `F0x8001ECF8`
// (exe/fns.s:16340), which publishes the layer and stores
// `layer->+0x138(arg)` -- the layer's packet-buffer address -- into that
// global. The stage shape routines call that stack block, never the layer's own
// setters, which is why their `$a2` of 4/6 (s820) or 10 (s805) picks a packet
// slot: `F0x8001DFA8` returns `buffer + arg * 4` (exe/fns.s:15367-15375).
//
// WHAT IS NOT PORTED HERE: the vertex/texpage walk that turns a shape index
// into a texture rectangle lives in the stage's own shape-set blob, reached
// through `*(0x80044F5C)` on `*(0x8009FD8C)` (wstag820.s:355-360). That blob
// is per-stage art this repository does not extract, so `queueDrawable` carries
// the shape index and the geometry and the draw adapter supplies the pixels.
// See the "What this does not reproduce" section of the document.

/** The registry id every stage passes: `li $a0, 0x1002`. */
export const DRAW_CONTEXT_ID = 0x1002;

/** `F0x8001E5BC` allocates this much (`li $a0, 0x16c`, exe/fns.s:15869). */
export const DRAW_CONTEXT_SIZE = 0x16c;

/** The resident registry: thirty 16-byte records from this address. */
export const DRAW_CONTEXT_TABLE = 0x8004de10;
/** `D0x8004DF8C` -- the three registry entry points, in slot order. */
export const REGISTRY_TABLE = 0x8004df8c;
/** Thirty slots is the registry's own bound (`slti $v0, $a2, 0x1e`, :15017). */
export const REGISTRY_SLOTS = 30;
/** The two parallel thirty-word arrays the getter indexes (0x60 and 0xD8). */
export const REGISTRY_POINTERS = DRAW_CONTEXT_TABLE + 0x60; // 0x8004DE70
export const REGISTRY_IDS = DRAW_CONTEXT_TABLE + 0xd8; // 0x8004DEE8

/** One row of the layer's method table, as `F0x8001E5BC` installs it. */
export interface DrawContextMethod {
  /** Byte offset of the slot in the 0x16C-byte object. */
  readonly offset: number;
  /** The routine the constructor stores there. */
  readonly routine: string;
  /** exe/fns.s line of the `la_` that loads it. */
  readonly line: number;
  /** What the slot is, as read out of that routine. */
  readonly role: string;
}

/**
 * All twenty-three slots, in the order `F0x8001E5BC` installs them
 * (exe/fns.s:15905-15951). Nothing is inferred: each row names the routine the
 * constructor stores and the line it does it on.
 */
export const DRAW_CONTEXT_METHODS: readonly DrawContextMethod[] = [
  { offset: 0x12c, routine: "F0x8001E028", line: 15905, role: "set the RGB tint at +0x19/+0x1A/+0x1B; sets +0x18 when any of them is nonzero" },
  { offset: 0x130, routine: "F0x8001DE68", line: 15907, role: "emit this layer's own packet and splice it onto the display list" },
  { offset: 0x134, routine: "F0x8001DDA0", line: 15909, role: "sync the layer's packet buffer" },
  { offset: 0x138, routine: "F0x8001DFA8", line: 15911, role: "packet-buffer address, `buffer + arg * 4`" },
  { offset: 0x13c, routine: "F0x8001DFCC", line: 15913, role: "packet-buffer address shifted by `arg >> (16 - +0x68)`" },
  { offset: 0x168, routine: "F0x8001E118", line: 15915, role: "release all three buffers (F0x80025868(0) then three frees)" },
  { offset: 0x110, routine: "F0x8001E0B0", line: 15917, role: "set position (+0x00, +0x02)" },
  { offset: 0x114, routine: "F0x8001E0BC", line: 15919, role: "set size (+0x04, +0x06)" },
  { offset: 0x118, routine: "F0x8001E058", line: 15921, role: "set origin (+0x6C, +0x6E)" },
  { offset: 0x120, routine: "F0x8001E088", line: 15923, role: "set scroll (+0x70, +0x74) outright" },
  { offset: 0x124, routine: "F0x8001E094", line: 15925, role: "add to scroll (+0x70, +0x74)" },
  { offset: 0x11c, routine: "F0x8001E064", line: 15927, role: "read scroll as pixels (`+0x70 >> 8`, `+0x74 >> 8`)" },
  { offset: 0x128, routine: "F0x8001E0C8", line: 15929, role: "write the EFFECTIVE screen rect: the cull source" },
  { offset: 0x140, routine: "F0x8001DFFC", line: 15931, role: "packet-buffer base address" },
  { offset: 0x144, routine: "F0x8001E01C", line: 15933, role: "read the packet shift at +0x68" },
  { offset: 0x148, routine: "F0x8001E1E8", line: 15935, role: "allocate the ordering list for `arg` records" },
  { offset: 0x14c, routine: "F0x8001E240", line: 15937, role: "QUEUE one drawable, descending by y; dropped when full" },
  { offset: 0x150, routine: "F0x8001E324", line: 15939, role: "append one drawable at the TAIL with key 0" },
  { offset: 0x154, routine: "F0x8001E38C", line: 15941, role: "FLUSH: walk the list in order and call each callback" },
  { offset: 0x15c, routine: "F0x8001E404", line: 15943, role: "save the eight-word draw environment A when +0x84 is set" },
  { offset: 0x158, routine: "F0x8001E470", line: 15945, role: "begin environment A: load the eight saved words" },
  { offset: 0x164, routine: "F0x8001E4F4", line: 15947, role: "save the eight-word draw environment B when +0xCC is set" },
  { offset: 0x160, routine: "F0x8001E55C", line: 15949, role: "restore the eight saved words of environment B" },
];

/** The one slot `F0x8001D504` calls on every registered object each frame. */
export const FLUSH_SLOT = 0x154;

/** The key the reset puts in the head record (`li $v1, 0x7fff`, exe/fns.s:15544). */
export const HEAD_SENTINEL = 0x7fffffff;

/** A screen rectangle, the four halfwords `+0x128` writes. */
export interface DrawRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The layer fields the cull and the scroll read. */
export interface DrawContextLayer {
  x: number;
  y: number;
  w: number;
  h: number;
  /** +0x6C / +0x6E: the layer's origin. */
  originX: number;
  originY: number;
  /** +0x70 / +0x74: the scroll, 16.16. Only the top byte is pixels. */
  scrollX: number;
  scrollY: number;
  /** +0x78: how many ordering records the list holds. */
  capacity: number;
}

/** `+0x128` (`F0x8001E0C8`, exe/fns.s:15483-15492): the effective rect. */
export function effectiveRect(layer: DrawContextLayer): DrawRect {
  return {
    x: (layer.x - layer.originX + (layer.scrollX >> 8)) & 0xffff,
    y: (layer.y - layer.originY + (layer.scrollY >> 8)) & 0xffff,
    w: layer.w & 0xffff,
    h: layer.h & 0xffff,
  };
}

/**
 * The rectangle test every stage pairs with `+0x128`. This is the overlay's own
 * routine, not the layer's: `wstag820.s:392-420` (`F0x800A63C4`) reads the
 * effective rect into four stack halfwords and then returns 1 when the caller's
 * rect is not entirely outside it on either axis. `slt $rd, $rs` is the short
 * form `slt $rd, $rd, $rs`, so each arm is one signed compare.
 */
export function visibleInLayer(layerRect: DrawRect, objX: number, objY: number, objW: number, objH: number): boolean {
  if (objX + objW < layerRect.x) return false;
  if (layerRect.x + layerRect.w < objX) return false;
  if (objY + objH < layerRect.y) return false;
  return !(layerRect.y + layerRect.h < objY);
}

/** One ordering record: the layer's 20-byte list entry. */
export interface DrawRecord<T> {
  /** +0x00: the caller's y. The list is sorted descending on this. */
  key: number;
  /** +0x04: the caller's fifth argument. */
  tag: number;
  /** +0x08: the callback the flush calls. */
  callback: ((payload: T, layer: DrawContextLayer, tag: number) => void) | null;
  /** +0x0C: what the callback is handed. */
  payload: T;
  /** +0x10: the next record, or null at the head. */
  next: DrawRecord<T> | null;
}

/** The layer's ordering list and the flush that walks it. */
export class DrawQueue<T> {
  private head!: DrawRecord<T>;
  private count = 1;
  private readonly pool: DrawRecord<T>[] = [];

  constructor(capacity: number) {
    for (let i = 0; i < Math.max(1, capacity); i += 1) {
      this.pool.push({ key: HEAD_SENTINEL, tag: 0, callback: null, payload: null as unknown as T, next: null });
    }
    this.head = this.pool[0]!;
  }

  /** How many real records the list holds, excluding the sentinel. */
  get length(): number {
    return this.count - 1;
  }

  /**
   * `+0x14C` (`F0x8001E240`, exe/fns.s:15593-15650). The insert walks from the
   * head and stops at the first record whose key is >= the new key, so the list
   * ends up descending and equal keys keep their arrival order. A full list
   * drops the insert -- the caller sees no queue and no error.
   */
  queue(key: number, callback: ((payload: T, layer: DrawContextLayer, tag: number) => void) | null, payload: T, tag = 0): boolean {
    if (this.count >= this.pool.length) return false;
    const slot = this.pool[this.count]!;
    slot.key = key;
    slot.callback = callback;
    slot.payload = payload;
    slot.tag = tag;
    slot.next = null;
    let prev: DrawRecord<T> | null = null;
    let cur: DrawRecord<T> | null = this.head;
    while (cur && cur.key >= key) {
      prev = cur;
      cur = cur.next;
    }
    slot.next = cur;
    if (prev) prev.next = slot;
    this.count += 1;
    return true;
  }

  /**
   * `+0x154` (`F0x8001E38C`, exe/fns.s:15684-15705). Walks head to tail, calls
   * each non-null callback, then resets: head key 0x7FFFFFFF, count 1. The
   * returned array is the order the GPU was handed, which is what the tests and
   * the draw adapter both read.
   */
  flush(layer: DrawContextLayer): DrawRecord<T>[] {
    const order: DrawRecord<T>[] = [];
    let cur: DrawRecord<T> | null = this.head;
    while (cur) {
      if (cur.callback) cur.callback(cur.payload, layer, cur.tag);
      order.push({ key: cur.key, tag: cur.tag, callback: null, payload: cur.payload, next: null });
      cur = cur.next;
    }
    this.head.key = HEAD_SENTINEL;
    this.head.callback = null;
    this.head.next = null;
    this.head.tag = 0;
    this.count = 1;
    return order;
  }
}

/** The GP0 command bytes the emitter writes, named as the PS1 command set. */
export const GP0 = {
  /** The arm the shape emitter writes by default. */
  RECT_PLAIN: 0x64,
  /** The arm it overwrites to when the shape's third halfword is not -1. */
  RECT_ALT: 0x66,
  /** Rectangle, variable size, textured, opaque -- the scissor pass. */
  RECT_MONO_SCALED: 0x60,
  /** Set draw mode (texturing, semi-transparency, texpage). */
  DRAW_MODE: 0xe1,
  /** Set draw mode 2 (texpage and CLUT). */
  DRAW_MODE_2: 0xe2,
  /** Set texture window. */
  TEXTURE_WINDOW: 0xe3,
  /** Set drawing area, top-left. */
  DRAW_AREA_TL: 0xe4,
  /** Set drawing area, bottom-right. */
  DRAW_AREA_BR: 0xe5,
  /** Set drawing offset. */
  DRAW_OFFSET: 0xe6,
} as const;

/**
 * The six state commands `F0x800266B4` writes for the layer's own picture, in
 * the order it writes them (exe/fns.s:24575-24597). Each builder is the routine
 * the original calls, so the field packing is the original's:
 *
 *   E3  texture window    `F0x80026B3C`  u | v << 10, both clamped to 10 bits
 *   E4  area top-left     `F0x80026BD4`  same layout, `(u + w - 1, v + h - 1)`
 *   E5  area bottom-right `F0x80026C6C`  x | y << 11, both clamped to 11 bits
 *   E1  draw mode         `F0x80026B1C`  +0x200 semi-transparent, +0x400 untextured
 *   E2  draw mode 2       `F0x80026C88`  texpage x/y and CLUT u/v, each >> 3
 *   E6  drawing offset    literal         0xE6000000, i.e. offset 0,0
 *
 * The layer's own descriptor supplies x/y (the area top-left), w/h (its size)
 * and the texture window's u/v, which is why E3 gets x/y and E5 gets u/v.
 */
export const LAYER_PRIMITIVE_ORDER: readonly number[] = [
  GP0.TEXTURE_WINDOW,
  GP0.DRAW_AREA_TL,
  GP0.DRAW_AREA_BR,
  GP0.DRAW_MODE,
  GP0.DRAW_MODE_2,
  GP0.DRAW_OFFSET,
];

/** The rectangle the optional seventh command paints. */
export interface LayerClipRect {
  /** +0x08 of the descriptor: subtracted from x and y. */
  offX: number;
  /** +0x0A of the descriptor: subtracted from y. */
  offY: number;
  /** +0x04 of the descriptor: the layer's own width. */
  w: number;
  /** +0x06 of the descriptor: the layer's own height. */
  h: number;
}

/** Screen box the emitter clamps against (`D0x80055EFC` / `D0x80055EFE`). */
export const SCREEN_BOX = { w: 320, h: 240 } as const;

function clamp(v: number, hi: number): number {
  return v < 0 ? 0 : v > hi ? hi : v;
}

/** The packet the layer's own flush writes, in order (see LAYER_PRIMITIVE_ORDER). */
export function layerPrimitives(desc: LayerClipRect, tint: { r: number; g: number; b: number }): number[] {
  const words: number[] = [];
  words.push(((GP0.TEXTURE_WINDOW << 24) | (0 & 0x3ff) | ((0 & 0x3ff) << 10)) >>> 0);
  words.push(((GP0.DRAW_AREA_TL << 24) | ((desc.w - 1) & 0x3ff) | (((desc.h - 1) & 0x3ff) << 10)) >>> 0);
  words.push(((GP0.DRAW_AREA_BR << 24) | (desc.offX & 0x7ff) | ((desc.offY & 0x7ff) << 11)) >>> 0);
  words.push(
    ((GP0.DRAW_MODE << 24) | (tint.r & 0xff) | ((tint.g & 0xff) << 8) | ((tint.b & 0xff) << 16)) >>> 0,
  );
  words.push((GP0.DRAW_MODE_2 << 24) >>> 0);
  words.push((GP0.DRAW_OFFSET << 24) >>> 0);
  words.push(
    ((GP0.RECT_MONO_SCALED << 24) | (tint.r & 0xff) | ((tint.g & 0xff) << 8) | ((tint.b & 0xff) << 16)) >>> 0,
  );
  words.push(((desc.offX & 0xffff) | ((desc.offY & 0xffff) << 16)) >>> 0);
  words.push((clamp(desc.w, SCREEN_BOX.w - 1) | (clamp(desc.h, SCREEN_BOX.h - 1) << 16)) >>> 0);
  return words;
}

/**
 * The command byte one queued shape emits. `F0x8001ED6C` writes `0x64` and
 * overwrites it with `0x66` when the shape's third halfword is not -1
 * (exe/fns.s:16610-16628), so the texture bit is per-shape data.
 *
 * The two arms differ by exactly bit 1. Both are GP0(60h..7Fh) rectangle
 * commands; which flag bit 1 selects is not settled here, because the two PS1
 * command tables disagree about the bit layout of that range and this port does
 * not depend on which it is. What is settled is the selection: the shape's third
 * halfword.
 */
export function shapeCommand(alternate: boolean): number {
  return alternate ? GP0.RECT_ALT : GP0.RECT_PLAIN;
}