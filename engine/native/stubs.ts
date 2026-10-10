// PC-hooked stub boundary for the wstag native interpreter (P0 of
// docs/specs/2026-07-04-wstag-native-interpreter-design.md).
//
// These stubs exist for the PRODUCTION path, where only the overlay bytes are
// mapped and the EXE helpers are not present in memory. (The parity tests boot
// from a full RAM dump and run the real EXE helpers natively — no stubs.)
//
// Everything here mirrors decoded EXE behavior, not invention:
//  - allocator F0x800143dc/F0x80014504 (fns.s): malloc + inline state-machine
//    methods at +0x28..+0x44, tick callback at +0x48, destroy at +0x4c,
//    optional extra buffer (+0x20 word count, +0x24 ptr), optional id register;
//  - default methods F0x80014274..F0x80014308 (fns.s, decoded 2026-07-04 s6);
//  - rand_u16 F0x8001933c: RAND_TABLE[(++idx) & 0xfff] table walk;
//  - set_flag/get_flag targets of [0x80048ac8]/[0x80048acc] → engine flag store;
//  - frame delta F0x8001d704 = return [0x8004de28].
// See docs/research/field/s780-street-life-native-system.md §allocator.

import type { NativeMemory } from "./memory.ts";
import type { R3000 } from "./mips.ts";

// ── EXE addresses (all decoded, see module header) ──
export const A = {
  ALLOC: 0x80014504, // (cb, size, extraSize) — a3 forced to 0
  ALLOC_ID: 0x800143dc, // (cb, size, extraSize, id)
  SET_STATE: 0x80014274,
  SET_SUB1: 0x80014288,
  SET_SUB2: 0x80014298,
  SET_SUB3: 0x800142a4,
  ADV_STATE: 0x800142ac,
  ADV_SUB1: 0x800142c8,
  ADV_SUB2: 0x800142e0,
  ADV_SUB3: 0x800142f4,
  DESTROY: 0x80014308,
  SET_FLAG: 0x800165ac, // runtime target of [0x80048ac8]
  GET_FLAG: 0x800163b0, // runtime target of [0x80048acc]
  RAND_U16: 0x8001933c, // runtime target of [0x8004dc0c]
  FRAME_DELTA: 0x8001d704, // runtime target of [0x8004df9c]
  GLOBAL_SET_FLAG_PTR: 0x80048ac8,
  GLOBAL_GET_FLAG_PTR: 0x80048acc,
  GLOBAL_RAND_PTR: 0x8004dc0c,
  GLOBAL_FRAME_DELTA_PTR: 0x8004df9c,
  GLOBAL_FRAME_DELTA_VALUE: 0x8004de28,
} as const;

/** Scratch heap for stub-allocated objects (observed runtime objects live here). */
export const HEAP_BASE = 0x800b0000;

/**
 * Draw-context method table installed by F0x8001f648 (decoded from fns.s):
 * ctx+0x70..+0x9c. These are the GPU/GTE prim builders — the interpreter's
 * draw boundary. ctx+0x84 = F0x8001ed6c is the sprite draw whose semantics are
 * already byte-decoded (point-sprite doc): (subPtr, spriteId, x, y).
 */
export const DRAW_CTX_METHODS = {
  0x8001ecb0: "reset", // ctx+0x70 (also jal'd by the fill itself)
  0x8001ecbc: "setOrigin", // ctx+0x74 (0x140,0x100 = screen center)
  0x8001ecd8: "setDepth", // ctx+0x78
  0x8001ecec: "m_0x88",
  0x8001ecf8: "m_0x80",
  0x8001ed34: "setLayer", // ctx+0x7c (0x1002, 2)
  0x8001ed6c: "drawSprite", // ctx+0x84 (subPtr, spriteId, x, y) — decoded
  0x8001f5d0: "setScale", // ctx+0x8c (sx, sy, sz) — (-0x1000,...) = x-flip
  0x8001f5ec: "m_0x90",
  0x8001f608: "setPos", // ctx+0x94 (x, y)
  0x8001f61c: "m_0x98",
  0x8001f628: "m_0x9c",
} as const;

export interface DrawCall {
  method: string;
  args: [number, number, number, number];
}

/**
 * Hook the 12 draw-context methods. The ctx-fill fn (F0x8001f648) itself runs
 * natively — it only writes the (real) method pointers + default fields into
 * the caller's stack struct; execution then traps here instead of entering the
 * GTE-using prim builders. `sink` receives every call in order.
 */
export function installDrawStubs(cpu: R3000, sink?: (c: DrawCall) => void): void {
  for (const [addr, method] of Object.entries(DRAW_CTX_METHODS)) {
    cpu.setStub(Number(addr), (c) => {
      sink?.({ method, args: [c.reg(4), c.reg(5), c.reg(6), c.reg(7)] });
      return 0;
    });
  }
}

export interface NativeHost {
  setFlag(id: number, value: number): void;
  getFlag(id: number): number;
  /** Faithful rand: RAND_TABLE[(++idx) & 0xfff]. Runtime wires the extracted table. */
  rand16(): number;
  /** Native code fired start_event(id) (fieldstg 0x800853f8) — bridge to the engine. */
  startEvent?(id: number): void;
  /** Native code fired the packed-sound entry point [0x80055c48]. */
  playPackedSound?(id: number): void;
  /** Master progress ordinal ([0x8004b370]) — stage-root ticks branch on it
   *  directly (e.g., wstag780 spawns the live street only at ordinal 0x1b). */
  ordinal?(): number;
  /** Screen bank transfer: fill `dest` with `bytes` of bank `id` (the same
   *  LBA_OFFSETS / LBA_LEN_SECTORS units the resident table uses). Absent =
   *  zero-filled buffer; the native state machine still completes. */
  readBank?(id: number, dest: number, bytes: number): void;
  /** The browser's stand-in memory card. The screen's card manager drives the
   *  PS1 card BIOS, which has no host, so the manager's method table is served
   *  from this. Absent (or a card with no files) keeps the retail no-card path:
   *  the services answer the terminal "MEMORY CARD is not inserted." status.
   *  Contract: research answer save-screen-service-values (accepted 2026-09-22)
   *  and engine/dw3/ui/memcard-machine.ts (the translated manager). */
  memcard?: NativeMemcardHost;
  log?(msg: string): void;
}

/** A virtual memory card. */
export interface NativeMemcardHost {
  /** The card's save-file count (0 = no card in the slot). */
  fileCount(): number;
  /** The 0xD4-byte directory block for card file `file`, or null when the card
   *  is absent. The screen's driver asks for file `selectedSlot + 2` and the
   *  block carries all three slots' summaries. Layout (measured 2026-09-22,
   *  `web/memcard.js` is the browser implementation): +0x00 XOR-8 checksum over
   *  +4..+0xD4, +0x01 file slot, +0x02 u16 format (4), +0x04 u32 tag
   *  (0x33574d44), then three 0x44-byte summary records at +0x08 + slot*0x44.
   *  Record fields: +0x00 name (screen text codec; 0 = empty slot),
   *  +0x18 area index, +0x1C place index, +0x20 BIT, +0x28/+0x2A/+0x2C play
   *  h/m/s, +0x30+4i starter type, +0x3C+2i level. */
  record(file: number): Uint8Array | null;
  /** The 0x26C4-byte save image for card file `file`, or null when empty. */
  block?(file: number): Uint8Array | null;
  /** The screen's write service handed back a block for card file `file`. */
  store?(file: number, bytes: Uint8Array): void;
}

export interface NativeObject {
  addr: number;
  cb: number;
  extra: number; // extra buffer address or 0
  id: number; // effect-registry id or 0
  alive: boolean;
}

/** A screen object's lifecycle word (+0xC). F0x80018140 treats 3 as "destroy me
 *  at the top of my next tick" and writes NULL into the parent's child-array
 *  slot; F0x80014308 releases the object and its children. */
export const OBJECT_LIFECYCLE_DEAD = 3;
/** The largest child-array count the original walker honours (+0x20). The
 *  original has no fixed cap — the array is sized by the allocator's extra
 *  bytes (the pause page's is 68) — so the bound only has to keep a garbage
 *  count from walking the whole address space, and the array end must stay in
 *  RAM. 64 was too small: the pause page's 68-slot array sat just above it, so
 *  a destroyed sub-window's slot was never NULLed and the page waited on a
 *  stale pointer forever (STATUS -> Digimon -> See Equipment -> Back wedged). */
export const CHILD_ARRAY_MAX = 0x1000;
const RAM_LO = 0x80010000;
const RAM_HI = 0x80200000;

/** True when a +0x20 count / +0x24 array pair names a plausible in-RAM child
 *  array whose whole extent fits. */
export function isChildArray(count: number, array: number): boolean {
  return count > 0 && count <= CHILD_ARRAY_MAX
    && array >= RAM_LO && array < RAM_HI && array + count * 4 <= RAM_HI;
}

/**
 * The original object manager's destroy arm (F0x80018140 + F0x80014308): mark
 * the object dead, destroy the tracked children its +0x24 array names, and null
 * every tracked object's child-array slot that still points at it. The last step
 * is what makes a parent observe its child as gone (e.g. the item shop's root
 * sees `+0x1C == 0` and returns to the BUY/SELL menu once the BUY sub-object
 * finishes). Returns false when the address is not a tracked object.
 */
export function destroyTrackedObject(
  mem: NativeMemory,
  world: StubWorld,
  addr: number,
): boolean {
  const target = addr >>> 0;
  const obj = world.objects.find((o) => o.addr >>> 0 === target);
  if (!obj) return false;
  if (!obj.alive) return true;
  obj.alive = false;
  // F0x80014308 walks +0x20/+0x24 and releases each child, then frees itself.
  const count = mem.read32(target + 0x20) | 0;
  const array = mem.read32(target + 0x24) >>> 0;
  if (isChildArray(count, array)) {
    for (let i = 0; i < count; i++) {
      const child = mem.read32(array + i * 4) >>> 0;
      if (child !== 0) destroyTrackedObject(mem, world, child);
    }
  }
  // F0x80018230 stores F0x80018140's NULL return back into the slot it walked.
  for (const p of world.objects) {
    if (!p.alive) continue;
    const n = mem.read32(p.addr + 0x20) | 0;
    const a = mem.read32(p.addr + 0x24) >>> 0;
    if (!isChildArray(n, a)) continue;
    for (let i = 0; i < n; i++) {
      if ((mem.read32(a + i * 4) >>> 0) === target) mem.write32(a + i * 4, 0);
    }
  }
  return true;
}

/** Object registry + bump allocator backing the alloc stubs. */
export class StubWorld {
  readonly objects: NativeObject[] = [];
  readonly mem: NativeMemory;
  private heapNext = HEAP_BASE;

  constructor(mem: NativeMemory) {
    this.mem = mem;
  }

  carve(size: number): number {
    // JS bitwise operators return signed int32 values. Keep emulated pointers
    // unsigned so object lookup can compare an allocator result with the same
    // address after it has round-tripped through a MIPS register.
    //
    // A zero-size request must still advance the heap. The console's allocator
    // hands back a fresh block and its callers then write the object's fields
    // past it (pro/stagslct's creator, F0x80085EA4, asks for size 0 and the tick
    // writes +0x50 and beyond); with a non-advancing bump allocator the next
    // object lands on the same address and the two destroy each other. Measured
    // 2026-09-15: the stagslct task and its first text widget both sat at
    // 0x80101000, the task's state field reading back 0 forever.
    const requested = size | 0;
    const actual = requested === 0 ? 0x100 : requested;
    const addr = this.heapNext >>> 0;
    this.heapNext = ((this.heapNext + actual + 7) & ~7) >>> 0;
    for (let i = 0; i < actual; i++) this.mem.write8(addr + i, 0);
    return addr;
  }

  alloc(cb: number, size: number, extraSize: number, id: number): number {
    const obj = this.carve(size);
    const m = this.mem;
    if (extraSize !== 0) {
      m.write32(obj + 0x24, this.carve(extraSize));
      m.write32(obj + 0x20, extraSize >> 2);
    }
    m.write32(obj + 0x28, A.SET_STATE);
    m.write32(obj + 0x2c, A.SET_SUB1);
    m.write32(obj + 0x30, A.SET_SUB2);
    m.write32(obj + 0x34, A.SET_SUB3);
    m.write32(obj + 0x38, A.ADV_STATE);
    m.write32(obj + 0x3c, A.ADV_SUB1);
    m.write32(obj + 0x40, A.ADV_SUB2);
    m.write32(obj + 0x44, A.ADV_SUB3);
    m.write32(obj + 0x48, cb);
    m.write32(obj + 0x4c, A.DESTROY);
    if (id !== 0) m.write32(obj + 0x0, id);
    this.objects.push({ addr: obj, cb, extra: m.read32(obj + 0x24), id, alive: true });
    return obj;
  }
}

/**
 * Install the production stub set. Also seeds the global fn-pointer words the
 * overlay code jalr's through, so `lw vN,[global]; jalr vN` resolves to the
 * stubbed addresses.
 */
export function installCoreStubs(cpu: R3000, host: NativeHost): StubWorld {
  const mem = cpu.mem;
  const world = new StubWorld(mem);

  // global fn pointers → their real runtime targets (which we hook)
  mem.write32(A.GLOBAL_SET_FLAG_PTR, A.SET_FLAG);
  mem.write32(A.GLOBAL_GET_FLAG_PTR, A.GET_FLAG);
  mem.write32(A.GLOBAL_RAND_PTR, A.RAND_U16);
  mem.write32(A.GLOBAL_FRAME_DELTA_PTR, A.FRAME_DELTA);

  cpu.setStub(A.ALLOC, (c) => world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0));
  cpu.setStub(A.ALLOC_ID, (c) => world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), c.reg(7)));

  // default state-machine methods (byte-exact ports of F0x80014274..F0x800142f4)
  cpu.setStub(A.SET_STATE, (c) => {
    const o = c.reg(4);
    mem.write32(o + 0xc, c.reg(5));
    mem.write32(o + 0x10, 0);
    mem.write32(o + 0x14, 0);
    mem.write32(o + 0x18, 0);
  });
  cpu.setStub(A.SET_SUB1, (c) => {
    const o = c.reg(4);
    mem.write32(o + 0x10, c.reg(5));
    mem.write32(o + 0x14, 0);
    mem.write32(o + 0x18, 0);
  });
  cpu.setStub(A.SET_SUB2, (c) => {
    const o = c.reg(4);
    mem.write32(o + 0x14, c.reg(5));
    mem.write32(o + 0x18, 0);
  });
  cpu.setStub(A.SET_SUB3, (c) => mem.write32(c.reg(4) + 0x18, c.reg(5)));
  const advance = (off: number) => (c: R3000): number => {
    const o = c.reg(4);
    const v = mem.read32(o + off) + 1;
    for (let z = off + 4; z <= 0x18; z += 4) mem.write32(o + z, 0);
    mem.write32(o + off, v);
    return v; // v0 holds the incremented value in the real code
  };
  cpu.setStub(A.ADV_STATE, advance(0xc));
  cpu.setStub(A.ADV_SUB1, advance(0x10));
  cpu.setStub(A.ADV_SUB2, advance(0x14));
  cpu.setStub(A.ADV_SUB3, advance(0x18));

  cpu.setStub(A.DESTROY, (c) => {
    const addr = c.reg(4) >>> 0;
    const obj = world.objects.find((o) => o.addr === addr);
    if (obj) obj.alive = false;
    else host.log?.(`destroy of unknown object 0x${addr.toString(16)}`);
  });

  cpu.setStub(A.SET_FLAG, (c) => host.setFlag(c.reg(4), c.reg(5)));
  cpu.setStub(A.GET_FLAG, (c) => host.getFlag(c.reg(4)));
  cpu.setStub(A.RAND_U16, () => host.rand16() & 0xffff);
  cpu.setStub(A.FRAME_DELTA, () => mem.read32(A.GLOBAL_FRAME_DELTA_VALUE));

  return world;
}
