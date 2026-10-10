// The Select Action pane's labels and its two pane methods, translated from the original
// pro/stgdglab bodies.
//
// Oracle: tests/lane-b/lab-select-labels.test.js runs each original through engine/native and compares
// the ordered boundary calls and the object memory.
//
//   F0x80088808 labSelectLabels  (pane, children) create on first use and fill the five option
//                                labels (records 0..4 of the table at *0x8008FD6C, 12 bytes each:
//                                word text id, halfword x at +4, halfword y at +8; children
//                                +0x14..), the five partner statistic numbers (records 5..9, children
//                                +0x28.., statistic index from the table at 0x8008F490) or their
//                                placeholders when no partner stands there, and the partner name plate
//                                (record 10, children +0x3C, colour on +0x40); clears the pane's
//                                +0x108.
//   F0x800886DC labSelectShow    pane method +0x114: state 2, +0x18 = 0, the pane fold (+0x94) opens.
//   F0x80088718 labSelectHide    pane method +0x118: state 2, +0x18 = 1, the pane fold closes, every
//                                label and number is hidden and the five cursor words (+0xFC..+0x10C)
//                                are cleared.
import type { LabPadHost } from "./lab-pad.ts";

export const LAB_LABEL_TABLE_CELL = 0x8008fd6c;
export const LAB_STAT_INDEX_TABLE = 0x8008f490;
const LANGUAGE = 0x8005cca8;

export interface LabSelectMemory {
  read16s(addr: number): number;
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

export interface LabSelectLabelsHost {
  callMethod(target: number, slot: number, args: number[]): number;
  createText(layer: number, kind: number, x: number, y: number): number;
  textBank(id: number): number;
  /** ctx+0x2718(position): the roster slot of a party position (negative when empty). */
  partnerSlot(position: number): number;
  /** ctx+0x2734(slot, out): the slot's effective statistics block. */
  effectiveStats(slot: number, out: number): void;
  /** [0x8004B484](slot): the roster record pointer (its name plate). */
  recordPointer(slot: number): number;
  scratch(index: number): number;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

export function labSelectLabels(mem: LabSelectMemory, pane: number, aux: number, host: LabSelectLabelsHost): void {
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const layer = (): number => (mem.read32(pane + 0x58) << 16) >> 16;
  const table = u32(mem.read32(LAB_LABEL_TABLE_CELL));
  const ensure = (word: number, kind: number, record: number): void => {
    if (mem.read32(aux + word) === 0) {
      const widget = host.createText(layer(), kind, mem.read16s(record + 4), mem.read16s(record + 8)) >>> 0;
      mem.write32(aux + word, widget);
      m(widget, 0x15c, [s32(mem.read32(pane + 0x5c)) - 1]);
    }
  };

  for (let i = 0; i < 5; i++) {
    const record = (table + i * 0xc) >>> 0;
    ensure(0x14 + 4 * i, 3, record);
    m(u32(mem.read32(aux + 0x14 + 4 * i)), 0x114, [bank(0x39), s32(mem.read32(record))]);
  }

  const root = u32(mem.read32(pane + 0x50));
  const slot = s32(host.partnerSlot(s32(mem.read32(root + 0x64))));
  const stats = host.scratch(0);
  if (slot >= 0) host.effectiveStats(slot, stats);
  for (let i = 0; i < 5; i++) {
    const record = (table + 0x3c + i * 0xc) >>> 0;
    ensure(0x28 + 4 * i, 3, record);
    const widget = u32(mem.read32(aux + 0x28 + 4 * i));
    if (slot < 0) m(widget, 0x114, [bank(0x39), i === 0 ? 0x1c : 0x12]);
    else m(widget, 0x118, [0, mem.read16s(stats + 2 * s32(mem.read32(LAB_STAT_INDEX_TABLE + 4 * i)))]);
    m(u32(mem.read32(aux + 0x28 + 4 * i)), 0x148, [1]);
  }

  const plate = (table + 0x78) >>> 0;
  ensure(0x3c, 1, plate);
  if (slot < 0) {
    m(u32(mem.read32(aux + 0x3c)), 0x114, [bank(0x39), 0x1b]);
    const colour = u32(mem.read32(aux + 0x40));
    if (colour !== 0) m(colour, 0x138, [7]);
  } else {
    m(u32(mem.read32(aux + 0x3c)), 0x114, [host.recordPointer(slot), -1]);
    const colour = u32(mem.read32(aux + 0x40));
    if (colour !== 0) m(colour, 0x138, [0]);
  }
  mem.write32(pane + 0x108, 0);
}

export function labSelectShow(
  mem: LabSelectMemory, pane: number, host: { foldStart(target: number, direction: number): void },
): void {
  mem.write32(pane + 0x0c, 2);
  mem.write32(pane + 0x18, 0);
  host.foldStart((pane + 0x94) >>> 0, 1);
}

export function labSelectHide(
  mem: LabSelectMemory, pane: number,
  host: { foldStart(target: number, direction: number): void; callMethod(t: number, s: number, a: number[]): number },
): void {
  mem.write32(pane + 0x0c, 2);
  mem.write32(pane + 0x18, 1);
  const aux = u32(mem.read32(pane + 0x24));
  host.foldStart((pane + 0x94) >>> 0, 0);
  for (let i = 0; i < 5; i++) {
    const label = u32(mem.read32(aux + 0x14 + 4 * i));
    if (label !== 0) host.callMethod(label, 0x144, [0]);
    const number = u32(mem.read32(aux + 0x28 + 4 * i));
    if (number !== 0) host.callMethod(number, 0x144, [0]);
  }
  const plate = u32(mem.read32(aux + 0x3c));
  if (plate !== 0) host.callMethod(plate, 0x144, [0]);
  for (let i = 4; i >= 0; i--) mem.write32(pane + 0xfc + 4 * i, 0);
}

export type { LabPadHost };
