// The lab's scroll bar actor ("capsule"): the thin white bar beside a scrolling list, translated
// from the original pro/stgdglab bodies.
//
// Oracle: tests/lane-b/lab-roster.test.js runs each original through engine/native; the picture
// primitive the original builds (an opaque flat white quad, code 0x28) is recorded by both sides
// through `fillQuad` (the ordering-table links and the primitive buffer are the platform GPU).
//
//   F0x8008A8C4 labCapsuleCreate     factory(handler F0x8008A6AC, 0x9C, extra 0); method slots +0x8C /
//                                    +0x90 / +0x94 / +0x98 = the four setters; layer +0x50 = 0x1000,
//                                    bucket +0x54 = 0.
//   F0x8008A670 labCapsuleSetBar     (x, width): +0x58 = x, +0x60 = width.
//   F0x8008A67C labCapsuleSetTrack   (top, bottom): +0x7C, +0x80; armed (+0x78 = 1).
//   F0x8008A690 labCapsuleSetCounts  (rows, total): +0x6C, +0x70; armed (+0x68 = 1).
//   F0x8008A6A4 labCapsuleSetTop     (row): +0x74 the first visible row.
//   F0x8008A6AC labCapsuleTick       state 0 (once both setters ran) computes the 8.8 step per row
//                                    (+0x88 = ((bottom - top) << 8) / total) and the bar length
//                                    (+0x64 = step * rows) then advances; state 1 places the bar:
//                                    +0x5C = top + (row * step >> 8) (clamped so the bar stays on the
//                                    track) and paints it; states 2 and 3 idle.
export const LAB_CAPSULE_HANDLER = 0x8008a6ac;
export const LAB_CAPSULE_SIZE = 0x9c;
export const LAB_CAPSULE_SETTERS = [
  [0x8c, 0x8008a670], [0x90, 0x8008a67c], [0x94, 0x8008a690], [0x98, 0x8008a6a4],
] as const;

export interface LabCapsuleMemory {
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

export interface LabCapsuleHost {
  alloc(handler: number, size: number, extra: number): number;
  callMethod(target: number, slot: number, args: number[]): number;
  /**
   * The opaque white flat quad (primitive code 0x28) the bar paints in ordering-table layer
   * `layer`, bucket `bucket`: corners (x0, y0)-(x1, y1) as halfwords.
   */
  fillQuad(layer: number, bucket: number, x0: number, y0: number, x1: number, y1: number): void;
}

const s32 = (v: number): number => v | 0;
const u32 = (v: number): number => v >>> 0;
const u16 = (v: number): number => v & 0xffff;
/** MIPS signed `div` quotient, including the hardware's divide-by-zero answer. */
const divLo = (a: number, b: number): number => {
  if (b === 0) return a >= 0 ? -1 : 1;
  if (a === -0x80000000 && b === -1) return -0x80000000;
  return (a / b) | 0;
};

export function labCapsuleCreate(mem: LabCapsuleMemory, host: Pick<LabCapsuleHost, "alloc">): number {
  const obj = host.alloc(LAB_CAPSULE_HANDLER, LAB_CAPSULE_SIZE, 0) >>> 0;
  for (const [slot, routine] of LAB_CAPSULE_SETTERS) mem.write32(obj + slot, routine);
  mem.write32(obj + 0x50, 0x1000);
  mem.write32(obj + 0x54, 0);
  return obj;
}

export function labCapsuleSetBar(mem: LabCapsuleMemory, obj: number, x: number, width: number): void {
  mem.write32(obj + 0x58, u32(x));
  mem.write32(obj + 0x60, u32(width));
}

export function labCapsuleSetTrack(mem: LabCapsuleMemory, obj: number, top: number, bottom: number): void {
  mem.write32(obj + 0x7c, u32(top));
  mem.write32(obj + 0x80, u32(bottom));
  mem.write32(obj + 0x78, 1);
}

export function labCapsuleSetCounts(mem: LabCapsuleMemory, obj: number, rows: number, total: number): void {
  mem.write32(obj + 0x6c, u32(rows));
  mem.write32(obj + 0x70, u32(total));
  mem.write32(obj + 0x68, 1);
}

export function labCapsuleSetTop(mem: LabCapsuleMemory, obj: number, row: number): void {
  mem.write32(obj + 0x74, u32(row));
}

export function labCapsuleTick(mem: LabCapsuleMemory, obj: number, host: LabCapsuleHost): void {
  const r = (off: number): number => s32(mem.read32(obj + off));
  const state = r(0x0c);
  if (state !== 1) {
    if ((state < 2 || state >= 4) && r(0x78) !== 0 && r(0x68) !== 0) {
      const span = (r(0x80) - r(0x7c)) << 8;
      const step = divLo(span, r(0x70));
      mem.write32(obj + 0x88, u32(step));
      mem.write32(obj + 0x64, u32(Math.imul(divLo(span, r(0x70)), r(0x6c))));
      host.callMethod(obj, 0x38, []);
    }
    return;
  }
  const first = r(0x74);
  if (first < r(0x70) - 1) {
    const top = s32(r(0x7c) + (Math.imul(first, r(0x88)) >> 8));
    mem.write32(obj + 0x5c, u32(top));
    const limit = r(0x80) - (r(0x64) >> 8);
    if (limit < top) mem.write32(obj + 0x5c, u32(limit));
  } else {
    mem.write32(obj + 0x5c, u32(r(0x80) - (r(0x64) >> 8)));
  }
  const x0 = u16(r(0x58));
  const x1 = u16(r(0x58) + r(0x60));
  const y0 = u16(r(0x5c));
  const y1 = u16(u16(r(0x5c)) + (r(0x64) >> 8));
  host.fillQuad(u32(r(0x50)), u32(r(0x54)), x0, y0, x1, y1);
}
