// The gym's animated sprite actor, translated from the original pro/stgtrain class built by
// F0x80083880: handler F0x80083150 and the eleven methods F0x80083058..F0x80083120 (the
// routines the disassembler's list folds into the preceding function; disassembled
// 2026-09-30).
//
// Oracle: tests/lane-b/gym-actor.test.js runs the originals through engine/native. The GPU
// packets the tick writes are decoded back into sprite, quad and draw-mode primitives and
// compared with the ones the port records; the libgte helpers are the same TypeScript
// functions on both sides.
//
// What it is. The session window builds two of these (the trainee and the shared props). An
// actor plays one TRANIN animation script over one sub-directory's clip directory:
//   +0x58 view id   +0x5C ordering bucket   +0x60/+0x64 scene origin (x, y)
//   +0x68/+0x6C the trainee's VRAM page origin (x, y)   +0x70/+0x74 the CLUT origin (x, y)
//   +0x78 done flag (bit 31 holds the script)   +0x80 clip directory   +0x88 data offset
//   +0x8C animation script   +0x90 step   +0x94 step count   +0x98 frame stamp of the step
//   +0x9C scale flag   +0xA0/+0xA4 scale pivot   +0xA8/+0xAC/+0xB0 scale (0x1000 = 1.0)
//   +0xB8.. rotation angles   +0xC0 the 5-word matrix
// The class table written by the constructor: +0xE0 setData, +0xE4 setScript, +0xE8 setOrigin,
// +0xEC setPage, +0xF0 setLayer, +0xF4 setClut, +0xF8 setScale, +0xFC setPivot, +0x100
// setRotation, +0x104 isDone, +0x108 hold.
//
// Tick (handler). In state 1, with a clip directory and a script, it steps the script: the
// current row {clip, hold, dx, dy} ends once more than `hold` (the low byte) display frames
// have passed since +0x98; the next row is taken and, when it would be the last, the step
// clamps to the last row and +0x78 becomes 1. Then it draws the row's clip: the layers in
// record order as 4-bit textured rectangles (sprites) at the row's scene offset plus the
// layer's own offset, each layer naming its texture page and CLUT through its two words:
//   tpage = page x (+0x68 + (d & 0x1F) * 64 & 0x3FF) >> 6, y bits from +0x6C, mode bits d & 0x1E0
//   clut  = (+0x74 + ((c & 0x7FC0) >> 6)) << 6 | ((+0x70 + (d & 0x1F) * 16) >> 4 & 0x3F)
// Bit 15 of c makes the sprite semi-transparent. Layers go to the ordering table last layer
// first, so the picture shows layer 0 at the bottom. A draw-mode packet is inserted whenever
// the page changes and one more after the last layer. With the scale flag set, each layer is a
// textured quad whose four corners go through the matrix about the pivot (the grow-in of the
// whole scene); a scale that is 1.0 in both axes clears the flag, and a zero scale draws
// nothing. Other states: 0 and 4+ advance the task and stamp +0x98 with the frame counter; 2
// and 3 idle.
export const GYM_ACTOR_HANDLER = 0x80083150;
export const GYM_ACTOR_SIZE = 0x10c;
export const GYM_ACTOR_METHODS = {
  setData: 0xe0, setScript: 0xe4, setOrigin: 0xe8, setPage: 0xec, setLayer: 0xf0, setClut: 0xf4,
  setScale: 0xf8, setPivot: 0xfc, setRotation: 0x100, isDone: 0x104, hold: 0x108,
} as const;
/** The routine address each class slot holds (the translated methods are bound by slot). */
export const GYM_ACTOR_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0xe0, 0x80083058], [0xe4, 0x80083078], [0xe8, 0x800830ac], [0xec, 0x800830b8], [0xf0, 0x800830a0],
  [0xf4, 0x800830c4], [0xf8, 0x800830d0], [0xfc, 0x800830e8], [0x100, 0x800830f4], [0x104, 0x8008310c],
  [0x108, 0x80083120],
];

export interface GymActorMemory {
  read8(addr: number): number;
  read16(addr: number): number;
  read32(addr: number): number;
  write16(addr: number, value: number): void;
  write32(addr: number, value: number): void;
}

/** One textured rectangle (GPU code 0x64, 0x66 when semi-transparent). */
export interface GymSpritePrim {
  x: number; y: number; u: number; v: number; w: number; h: number; clut: number; code: number;
}
/** One textured quad (GPU code 0x2C, 0x2E when semi-transparent). */
export interface GymQuadPrim {
  x: [number, number, number, number]; y: [number, number, number, number];
  u: [number, number, number, number]; v: [number, number, number, number];
  clut: number; tpage: number; code: number;
}

export interface GymActorHost {
  /** [0x8004DE10 + 0x188] = F0x8001D6F4: the free-running frame counter. */
  frameTick(): number;
  /** self+0x38(self): advance the task state. */
  advance(actor: number): void;
  /** [0x8004DE10+0x17C](target) then view+0x138(view, bucket): the view and the ordering-table slot. */
  orderingSlot(target: number, bucket: number): { view: number; slot: number };
  /** F0x8002915C(packet, 0, 1, tpage): a draw-mode packet. */
  drawMode(tpage: number): void;
  sprite(prim: GymSpritePrim): void;
  quad(prim: GymQuadPrim): void;
  /** [0x8004DF6C](cursor): close the primitive run. */
  flush(): void;
  /** F0x8002B65C(angles, matrix): libgte RotMatrix. */
  rotMatrix(angles: number, matrix: number): void;
  /** F0x8002B23C(matrix, scale): libgte ScaleMatrix. */
  scaleMatrix(matrix: number, scale: number): void;
  /** F0x8002B1DC(matrix, vector): libgte ApplyMatrixSV on one (x, y, 0) corner. */
  applyMatrix(matrix: number, x: number, y: number): [number, number];
}

const s16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;

/** F0x80083058(actor, data, offset): bind the clip directory. Returns the directory's third halfword. */
export function gymActorSetData(mem: GymActorMemory, actor: number, data: number, offset: number): number {
  mem.write32(actor + 0x80, data >>> 0);
  mem.write32(actor + 0x88, offset >>> 0);
  mem.write16(actor + 0x84, mem.read16(data + 2));
  mem.write16(actor + 0x86, mem.read16(data + 4));
  return mem.read16(data + 4);
}

/** F0x80083078(actor, script): start a script (a null script is ignored). */
export function gymActorSetScript(mem: GymActorMemory, actor: number, script: number): void {
  if ((script | 0) === 0) return;
  mem.write32(actor + 0x8c, script >>> 0);
  mem.write32(actor + 0x90, 0);
  mem.write32(actor + 0x98, 0);
  mem.write32(actor + 0x94, s16(mem.read16(script + 2)) >>> 0);
  mem.write32(actor + 0x78, 0);
}

/** F0x800830A0(actor, view, bucket). */
export function gymActorSetLayer(mem: GymActorMemory, actor: number, view: number, bucket: number): void {
  mem.write32(actor + 0x58, view >>> 0);
  mem.write32(actor + 0x5c, bucket >>> 0);
}
/** F0x800830AC(actor, x, y): the scene origin. */
export function gymActorSetOrigin(mem: GymActorMemory, actor: number, x: number, y: number): void {
  mem.write32(actor + 0x60, x >>> 0);
  mem.write32(actor + 0x64, y >>> 0);
}
/** F0x800830B8(actor, x, y): the VRAM page origin. */
export function gymActorSetPage(mem: GymActorMemory, actor: number, x: number, y: number): void {
  mem.write32(actor + 0x68, x >>> 0);
  mem.write32(actor + 0x6c, y >>> 0);
}
/** F0x800830C4(actor, x, y): the CLUT origin. */
export function gymActorSetClut(mem: GymActorMemory, actor: number, x: number, y: number): void {
  mem.write32(actor + 0x70, x >>> 0);
  mem.write32(actor + 0x74, y >>> 0);
}
/** F0x800830D0(actor, sx, sy, sz): scale the whole picture. */
export function gymActorSetScale(mem: GymActorMemory, actor: number, sx: number, sy: number, sz: number): void {
  mem.write32(actor + 0xa8, sx >>> 0);
  mem.write32(actor + 0xac, sy >>> 0);
  mem.write32(actor + 0xb0, sz >>> 0);
  mem.write32(actor + 0x9c, 1);
}
/** F0x800830E8(actor, x, y): the scale pivot. */
export function gymActorSetPivot(mem: GymActorMemory, actor: number, x: number, y: number): void {
  mem.write32(actor + 0xa0, x >>> 0);
  mem.write32(actor + 0xa4, y >>> 0);
}
/** F0x800830F4(actor, ax, ay, az): the rotation angles. */
export function gymActorSetRotation(mem: GymActorMemory, actor: number, ax: number, ay: number, az: number): void {
  mem.write16(actor + 0xb8, ax);
  mem.write16(actor + 0xba, ay);
  mem.write16(actor + 0xbc, az);
  mem.write32(actor + 0x9c, 1);
}
/** F0x8008310C(actor): 1 once the script reached its last row. */
export function gymActorIsDone(mem: GymActorMemory, actor: number): number {
  return (mem.read32(actor + 0x78) & 0x7fffffff) >>> 0;
}
/** F0x80083120(actor, hold): hold (set) or release (clear) the script. */
export function gymActorHold(mem: GymActorMemory, actor: number, hold: number): number {
  const value = (hold | 0) !== 0 ? (mem.read32(actor + 0x78) | 0x80000000) >>> 0 : (mem.read32(actor + 0x78) & 0x7fffffff) >>> 0;
  mem.write32(actor + 0x78, value);
  return value;
}

/** F0x80083150(actor): one frame of the actor. */
export function gymActorTick(mem: GymActorMemory, actor: number, host: GymActorHost): void {
  const state = mem.read32(actor + 0x0c) | 0;
  if (state !== 1) {
    if (state >= 2 && state < 4) return;
    host.advance(actor);
    mem.write32(actor + 0x98, host.frameTick() >>> 0);
    return;
  }
  if (mem.read32(actor + 0x80) === 0) return;
  const script = mem.read32(actor + 0x8c);
  if (script === 0) return;
  let row = (script + 4 + (mem.read32(actor + 0x90) << 3)) >>> 0;
  if ((mem.read32(actor + 0x78) | 0) >= 0) {
    const now = host.frameTick() | 0;
    if ((mem.read8(row + 2) | 0) < ((now - (mem.read32(actor + 0x98) | 0)) | 0)) {
      mem.write32(actor + 0x98, host.frameTick() >>> 0);
      const step = (mem.read32(actor + 0x90) + 1) | 0;
      const last = ((mem.read32(actor + 0x94) | 0) - 1) | 0;
      mem.write32(actor + 0x90, step >>> 0);
      if (!(step < last)) {
        mem.write32(actor + 0x90, last >>> 0);
        mem.write32(actor + 0x78, state >>> 0);
      }
      row = (mem.read32(actor + 0x8c) + 4 + (mem.read32(actor + 0x90) << 3)) >>> 0;
    }
  }
  // Skip to the row's clip: each clip is {count, count * 0x14 bytes of layers}.
  let cursor = (mem.read32(actor + 0x80) + mem.read32(actor + 0x88)) >>> 0;
  const clip = s16(mem.read16(row));
  for (let k = 0; k < clip; k++) {
    const count = mem.read32(cursor) | 0;
    cursor = (cursor + 4) >>> 0;
    if (count > 0) cursor = (cursor + 0x14 * count) >>> 0;
  }
  let scaled = false;
  if (mem.read32(actor + 0x9c) !== 0) {
    const sx = mem.read32(actor + 0xa8) | 0;
    const sy = mem.read32(actor + 0xac) | 0;
    if (sx === 0 && sy === 0) return;
    if (sx === 0x1000 && sy === sx) {
      mem.write32(actor + 0x9c, 0);
    } else {
      scaled = true;
      host.rotMatrix(actor + 0xb8, actor + 0xc0);
      host.scaleMatrix(actor + 0xc0, actor + 0xa8);
    }
  }
  const slot = host.orderingSlot(mem.read32(actor + 0x58), mem.read32(actor + 0x5c));
  mem.write32(actor + 0x50, slot.view >>> 0);
  mem.write32(actor + 0x54, slot.slot >>> 0);
  const count = mem.read32(cursor) | 0;
  const first = (cursor + 4) >>> 0;
  let tpage = 0;
  let previous = 0;
  for (let i = 0; i < count; i++) {
    // Layers go out last first; the picture's bottom layer is layer 0.
    const layer = (first + (count - 1 - i) * 0x14) >>> 0;
    const u = mem.read8(layer);
    const v = mem.read8(layer + 1);
    const dx = mem.read8(layer + 2);
    const dy = mem.read8(layer + 3);
    const c = mem.read16(layer + 4);
    const d = mem.read16(layer + 6);
    const w = mem.read16(layer + 8);
    const h = mem.read16(layer + 10);
    const page = d & 0x1f;
    tpage = ((d & 0x1e0) | ((mem.read32(actor + 0x6c) & 0x100) >> 4) |
      ((((mem.read32(actor + 0x68) + (page << 6)) & 0x3ff) >> 6)) |
      ((mem.read16(actor + 0x6c) & 0x200) << 2)) & 0xffff;
    const clut = (((mem.read16(actor + 0x74) + ((c & 0x7fc0) >> 6)) << 6) |
      (((mem.read32(actor + 0x70) + (page << 4)) >> 4) & 0x3f)) & 0xffff;
    const semi = (s16(c) & 0x8000) !== 0;
    if (!scaled) {
      if (i === 0) previous = tpage;
      if (previous !== tpage) {
        host.drawMode(previous);
        previous = tpage;
      }
      host.sprite({
        x: u16(mem.read16(actor + 0x60) + mem.read16(row + 4) + dx),
        y: u16(mem.read16(row + 6) + mem.read16(actor + 0x64) + dy),
        u, v, w, h, clut, code: semi ? 0x66 : 0x64,
      });
    } else {
      const pivotX = mem.read16(actor + 0xa0);
      const pivotY = mem.read16(actor + 0xa4);
      const x0 = s16(u16(mem.read16(actor + 0x60) + mem.read16(row + 4) + dx - pivotX));
      const y0 = s16(u16(mem.read16(row + 6) + mem.read16(actor + 0x64) + dy - mem.read16(actor + 0xa4)));
      const corners: Array<[number, number]> = [[x0, y0], [s16(u16(x0 + w)), y0], [x0, s16(u16(y0 + h))],
        [s16(u16(x0 + w)), s16(u16(y0 + h))]];
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [cx, cy] of corners) {
        const [ox, oy] = host.applyMatrix(actor + 0xc0, cx, cy);
        xs.push(u16(ox + pivotX));
        ys.push(u16(oy + mem.read16(actor + 0xa4)));
      }
      host.quad({
        x: xs as GymQuadPrim["x"], y: ys as GymQuadPrim["y"],
        u: [u, u + w - 1, u, u + w - 1].map((n) => n & 0xff) as GymQuadPrim["u"],
        v: [v, v, v + h - 1, v + h - 1].map((n) => n & 0xff) as GymQuadPrim["v"],
        clut, tpage, code: semi ? 0x2e : 0x2c,
      });
    }
  }
  if (!scaled) host.drawMode(tpage);
  host.flush();
}

/** F0x80083880(): build an actor and install the class table. */
export function gymActorCreate(
  mem: GymActorMemory, host: { alloc(handler: number, size: number, extra: number): number },
): number {
  const actor = host.alloc(GYM_ACTOR_HANDLER, GYM_ACTOR_SIZE, 0);
  for (const [slot, routine] of GYM_ACTOR_TABLE) mem.write32(actor + slot, routine | 0);
  return actor;
}
