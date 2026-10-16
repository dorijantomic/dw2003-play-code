// The lab's form grid ("change type"): the partner's acquired forms in a two-column grid, and a
// pick of which equipped slot becomes the current form. Translated from the original
// pro/stgdglab bodies.
//
// Oracle: tests/lane-b/lab-grid.test.js runs each original through engine/native and compares the
// ordered boundary calls, the return values and the object memory.
//
//   F0x80087018 labGridCreate    (slot, row) factory(handler F0x80085DD0, 0x100, extra 0xA0); +0x50 =
//                                0x1000, +0x54 = 6, +0x58 = the roster slot, +0x5C = the equipped row.
//   F0x80085470 labGridTexts     the grid's 10 cell widgets, the detail widgets, the cursors and the
//                                four slot labels.
//   F0x80085730 labGridFill      (flag) fill the cells and the highlighted form's details, or hide.
//   F0x80085C50 labGridSlotFill  (flag) fill (or hide) the three equipped-form labels and the headings.
//   F0x80085DD0 labGridTick      the state machine (phase +0x10) and the pictures.
//
// Object (0x100 bytes, children block 0xA0): +0x50 layer, +0x54 bucket, +0x58 roster slot, +0x5C the
// equipped row being replaced, +0x60 column (0/1), +0x64 row on screen (0..4), +0x68 first row,
// +0x6C / +0x70 arrow blink, +0x74 the three equipped forms (halfwords), +0x7A the acquired forms
// (halfwords), +0xD8 their count, +0xDC / +0xEC folds (value at +8: +0xE4 / +0xF4), +0xFC the slot cursor.
// Children: +0x00.. ten cells, +0x28 name, +0x2C heading, +0x30.. six technique names, +0x48.. the
// 13 numbers, +0x7C the level, +0x80 prompt, +0x84.. four slot labels, +0x90 heading, +0x94 / +0x98
// the two cursors.
import { rosterRecordAddress } from "../../party-context.ts";
import { padBitOf, type LabPadHost } from "./lab-pad.ts";
import { LAB_TECHNIQUE_TABLE, type LabRosterHost, type LabRosterMemory } from "./lab-roster.ts";

export const LAB_GRID_HANDLER = 0x80085dd0;
export const LAB_GRID_SIZE = 0x100;
export const LAB_GRID_EXTRA = 0xa0;
const LANGUAGE = 0x8005cca8;
const PACK = 0x02c50000;
const FONT_PACK = 0x02860000;
const RECORDS_MINUS_4 = 0x80049490;
const RECORD_STRIDE = 0x3dc;

export type LabGridHost = LabRosterHost & {
  /** ctx+0x273C(slot, in): store the three equipped forms. */
  setEquipped(slot: number, input: number): void;
};

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const half = (mem: LabRosterMemory, addr: number): number => mem.read16s(addr);

export function labGridCreate(mem: LabRosterMemory, host: Pick<LabRosterHost, "alloc">, slot: number, row: number): number {
  const obj = host.alloc(LAB_GRID_HANDLER, LAB_GRID_SIZE, LAB_GRID_EXTRA) >>> 0;
  mem.write32(obj + 0x50, 0x1000);
  mem.write32(obj + 0x54, 6);
  mem.write32(obj + 0x58, u32(slot));
  mem.write32(obj + 0x5c, u32(row));
  return obj;
}

/** F0x80085470(self, aux): create the widgets and cursors. */
export function labGridTexts(mem: LabRosterMemory, self: number, aux: number, host: LabGridHost): void {
  const layer = (): number => s32(mem.read32(self + 0x50));
  const bucket = (): number => s32(mem.read32(self + 0x54));
  const text = (word: number, x: number, y: number): void => mem.write32(aux + word, host.createText(layer(), 1, x, y));
  for (let i = 0; i < 10; i++) text(4 * i, (i % 2) * 0x85 + 0x27, Math.floor(i / 2) * 0xe + 0x16);
  text(0x28, 0x5b, 0x6a);
  text(0x2c, 0xf5, 0x6a);
  text(0x7c, 0x12d, 0x6a);
  for (let k = 0; k < 6; k++) text(0x30 + 4 * k, 0xc2, 0x8b + 0xe * k);
  for (let k = 0; k < 6; k++) text(0x48 + 4 * k, 0x7d, 0x7f + 0xe * k);
  for (let k = 0; k < 7; k++) text(0x60 + 4 * k, 0xa7, 0x7f + 0xe * k);
  const children = u32(mem.read32(self + 0x24));
  const count = s32(mem.read32(self + 0x20)) - 3;
  for (let i = 0; i < count; i++) {
    const widget = u32(mem.read32(children + i * 4));
    if (widget !== 0) host.callMethod(widget, 0x15c, [bucket() - 1]);
  }
  const first = host.createCursor(layer(), bucket() - 1, 0x1a, 0x16) >>> 0;
  mem.write32(aux + 0x98, first);
  host.callMethod(first, 0x80, [0]);
  const second = host.createCursor(layer(), bucket() - 3, 0x9a, 0x83) >>> 0;
  mem.write32(aux + 0x94, second);
  host.callMethod(second, 0x80, [0]);
  for (let k = 0; k < 4; k++) text(0x84 + 4 * k, 0xa7, 0x83 + 0xe * k);
  text(0x80, 0x14, 0xc3);
}

/** The technique-name labels and the icon rows both fills share (six halfwords at +8 of the entry). */
function techniqueLabels(
  mem: LabRosterMemory, entry: number, base: number, aux: number, host: LabGridHost,
  bank: (offset: number) => number,
): void {
  for (let i = 0; i < 6; i++) {
    const technique = mem.read16(entry + 8 + 2 * i);
    const label = u32(mem.read32(aux + base + 4 * i));
    if (mem.read16s(entry + 8 + 2 * i) !== 0) {
      host.callMethod(label, 0x114, [bank(0xa2), technique & 0x1fff]);
      host.callMethod(label, 0x138, [(technique & 0x8000) !== 0 ? 3 : (technique & 0x4000) !== 0 ? 4 : 0]);
    } else {
      host.callMethod(label, 0x144, [0]);
    }
  }
}

/** F0x80085730(self, aux, flag): fill the cells and the highlighted form's details, or hide them. */
export function labGridFill(mem: LabRosterMemory, self: number, aux: number, flag: number, host: LabGridHost): void {
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const word = (offset: number): number => u32(mem.read32(aux + offset));
  const r = (off: number): number => s32(mem.read32(self + off));
  if (flag === 0) {
    const children = u32(mem.read32(self + 0x24));
    const count = r(0x20) - 3;
    for (let i = 0; i < count; i++) {
      const widget = u32(mem.read32(children + i * 4));
      if (widget !== 0) m(widget, 0x144, [0]);
    }
    m(word(0x98), 0x80, [0]);
    return;
  }
  for (let k = 0; k < 10; k++) {
    const form = half(mem, self + (r(0x68) * 2 + k) * 2 + 0x7a);
    const cell = word(4 * k);
    if (form >= 3) {
      m(cell, 0x138, [0]);
      for (let e = 0; e < 3; e++) {
        if (half(mem, self + 0x74 + 2 * e) === form) { m(cell, 0x138, [7]); break; }
      }
      const names = bank(0x4e);
      m(cell, 0x114, [names, mem.read8(u32(host.profileRecord(form)) + 0x55)]);
    } else {
      m(cell, 0x144, [0]);
    }
  }
  const form = half(mem, self + ((r(0x68) + r(0x64)) * 2 + r(0x60)) * 2 + 0x7a);
  if (form !== 0) {
    const entry = host.scratch(0);
    const stats = host.scratch(1);
    host.formEntryCopy(r(0x58), form, entry);
    host.effectiveStats(r(0x58), stats);
    const profile = u32(host.profileRecord(form));
    m(word(0x28), 0x114, [bank(0x4e), mem.read8(profile + 0x55)]);
    m(word(0x2c), 0x114, [bank(0x39), 0x13]);
    m(word(0x7c), 0x118, [0, (mem.read8(entry + 2) << 24) >> 24]);
    for (let i = 0; i < 6; i++) {
      let value = mem.read16s(stats + 0xc + 2 * i) + mem.read16(profile + 2 + 2 * i);
      if (value >= 0x3e8) value = 0x3e7;
      m(word(0x48 + 4 * i), 0x118, [0, value]);
    }
    if (mem.read16s(stats + 0x26) !== 0) m(word(0x48), 0x138, [6]);
    if (mem.read16s(stats + 0x28) !== 0) m(word(0x4c), 0x138, [6]);
    if (mem.read16s(stats + 0x2a) !== 0) m(word(0x58), 0x138, [6]);
    for (let i = 0; i < 7; i++) {
      let value = mem.read16s(stats + 0x18 + 2 * i) + mem.read16(profile + 0xe + 2 * i);
      if (value >= 0x3e8) value = 0x3e7;
      m(word(0x60 + 4 * i), 0x118, [0, value]);
    }
    techniqueLabels(mem, entry, 0x30, aux, host, bank);
    for (let k = 0; k < 14; k++) m(word(0x48 + 4 * k), 0x148, [1]);
  }
  m(word(0x98), 0x80, [1]);
}

/** F0x80085C50(self, aux, flag): fill (or hide) the three equipped-form labels and the headings. */
export function labGridSlotFill(mem: LabRosterMemory, self: number, aux: number, flag: number, host: LabGridHost): void {
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  if (flag !== 0) {
    for (let k = 0; k < 3; k++) {
      const form = half(mem, self + 0x74 + 2 * k);
      const names = bank(0x4e);
      const profile = u32(host.profileRecord(form));
      m(u32(mem.read32(aux + 0x84 + 4 * k)), 0x114, [names, mem.read8(profile + 0x55)]);
    }
    m(u32(mem.read32(aux + 0x90)), 0x114, [bank(0x39), 0x2c]);
    m(u32(mem.read32(aux + 0x80)), 0x114, [bank(0x39), 0x2b]);
    return;
  }
  for (let k = 0; k < 4; k++) m(u32(mem.read32(aux + 0x84 + 4 * k)), 0x144, [0]);
  m(u32(mem.read32(aux + 0x80)), 0x144, [0]);
}

const repeating = (host: LabPadHost, bit: number): boolean =>
  padBitOf(host, "padPressed", bit) || padBitOf(host, "padRepeat", bit);

function gatedKey(host: LabPadHost, heldBit: number, bit: number): boolean {
  if (!padBitOf(host, "padHeld", heldBit) && padBitOf(host, "padPressed", bit)) return true;
  return !padBitOf(host, "padHeld", heldBit) && padBitOf(host, "padRepeat", bit);
}

/** F0x80085DD0(self, aux): the state machine and the pictures. */
export function labGridTick(mem: LabRosterMemory, self: number, aux: number, host: LabGridHost): void {
  const r = (off: number): number => s32(mem.read32(self + off));
  const w = (off: number, value: number): void => mem.write32(self + off, u32(value));
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const advance = (): void => w(0x10, r(0x10) + 1);
  const fold = (offset: number): number => (self + offset) >>> 0;
  const cursorB = (): number => u32(mem.read32(aux + 0x98));
  const cursorA = (): number => u32(mem.read32(aux + 0x94));
  const selected = (): number => half(mem, self + ((r(0x68) + r(0x64)) * 2 + r(0x60)) * 2 + 0x7a);
  const rows = (): number => { const n = r(0xd8); return n - Math.trunc(n / 2); };
  const record = (): number => (rosterRecordAddress(r(0x58)) - 4) >>> 0;
  const pack = (handle: number): number => u32(host.packResolve(handle));

  const state = r(0x0c);
  if (state !== 1) {
    if (state < 2 || state >= 4) {
      host.callMethod(self, 0x38, []);
      w(0xdc, 0xa);
      host.foldStart(fold(0xdc), 1);
      host.equippedForms(r(0x58), fold(0x74));
      w(0xd8, host.acquiredForms(r(0x58), fold(0x7a)));
      labGridTexts(mem, self, aux, host);
      w(0xec, 0xa);
    }
    return;
  }

  const phase = u32(r(0x10));
  switch (phase) {
    case 1: {
      const rowBefore = r(0x68);
      let moved = false;
      if (r(0xd8) >= 0xb) {
        if (gatedKey(host, 0xb, 0xa)) {
          w(0x68, r(0x68) - 5);
          if (r(0x68) < 0) w(0x68, 0);
        } else if (gatedKey(host, 0xa, 0xb)) {
          const limit = rows();
          for (let i = 0; i < 5;) {
            const before = r(0x68);
            w(0x68, before + 1);
            if (limit - 1 >= before + 5) {
              i += 1;
              continue;
            }
            w(0x68, limit - 5);
            break;
          }
        }
        if (rowBefore !== r(0x68)) { moved = true; w(0x64, 0); }
      }
      if (!moved) {
        const cursorBefore = r(0x64);
        if (repeating(host, 4)) {
          w(0x64, r(0x64) - 1);
          if (r(0x64) < 0) {
            w(0x64, 0);
            w(0x68, r(0x68) - 1);
            if (r(0x68) < 0) w(0x68, 0);
          }
          if (cursorBefore !== r(0x64) || rowBefore !== r(0x68)) moved = true;
        } else if (repeating(host, 6)) {
          if (r(0xd8) >= 0xa) {
            w(0x64, r(0x64) + 1);
            if (r(0x64) >= 5) {
              w(0x64, 4);
              const next = r(0x68) + 1;
              const last = rows() - 1;
              w(0x68, next);
              if (last < next) w(0x68, last);
            }
          } else {
            const next = r(0x64) + 1;
            const last = rows() - 1;
            w(0x64, next);
            if (last < next) w(0x64, last);
          }
          if (rowBefore !== r(0x68) || cursorBefore !== r(0x64)) {
            const column = r(0x60);
            if (column !== 0) {
              const at = r(0x68) + r(0x64);
              if (half(mem, self + (at * 2 + column) * 2 + 0x7a) < 3) {
                if (half(mem, self + at * 4 + 0x7a) >= 3) { w(0x60, 0); moved = true; }
              } else moved = true;
            } else if (half(mem, self + (r(0x68) + r(0x64)) * 4 + 0x7a) >= 3) moved = true;
            if (!moved) { w(0x64, cursorBefore); w(0x68, rowBefore); }
          }
        }
        if (repeating(host, 7)) {
          if (r(0x60) !== 0) { w(0x60, 0); moved = true; }
        } else if (repeating(host, 5) && r(0x60) === 0 && half(mem, self + (((r(0x68) + r(0x64)) * 4) | 2) + 0x7a) >= 3) {
          w(0x60, 1);
          moved = true;
        }
        if (!moved) {
          if (padBitOf(host, "padPressed", 0xd)) {
            let form = selected();
            let equipped = false;
            for (let e = 0; e < 3; e++) {
              if (half(mem, self + 0x74 + 2 * e) === form) { equipped = true; break; }
            }
            if (equipped) form = 0;
            if (form === 0) {
              host.playSound(0x800450bd);
            } else {
              host.playSound(0x8004503c);
              if (half(mem, self + r(0x5c) * 2 + 0x74) === s32(mem.read32(record() + 8))) {
                w(0x10, 2);
              } else {
                labGridFill(mem, self, aux, 0, host);
                host.foldStart(fold(0xdc), 0);
                w(0x10, 0);
                w(0x14, 1);
              }
              mem.write16(self + r(0x5c) * 2 + 0x74, form & 0xffff);
              host.setEquipped(r(0x58), fold(0x74));
            }
          } else if (padBitOf(host, "padPressed", 0xe)) {
            host.playSound(0x800450bd);
            labGridFill(mem, self, aux, 0, host);
            host.foldStart(fold(0xdc), 0);
            w(0x10, 0);
            w(0x14, 1);
          }
          break;
        }
      }
      host.playSound(0x8004513e);
      m(cursorB(), 0x84, [r(0x60) * 0x85 + 0x1a, r(0x64) * 0xe + 0x16]);
      labGridFill(mem, self, aux, 1, host);
      break;
    }
    case 2:
      w(0xec, 0xa);
      host.foldStart(fold(0xec), 1);
      m(cursorB(), 0x88, [7]);
      m(cursorB(), 0x94, [1]);
      advance();
      break;
    case 3:
      if (host.foldTick(fold(0xec)) !== 0) {
        labGridSlotFill(mem, self, aux, 1, host);
        w(0xfc, 0);
        m(cursorA(), 0x84, [0x9a, 0x83]);
        m(cursorA(), 0x80, [1]);
        advance();
      }
      break;
    case 4: {
      const before = r(0xfc);
      if (repeating(host, 4)) {
        w(0xfc, r(0xfc) - 1);
        if (r(0xfc) < 0) w(0xfc, 0);
      } else if (repeating(host, 6)) {
        w(0xfc, r(0xfc) + 1);
        if (r(0xfc) >= 4) w(0xfc, 3);
      }
      if (before !== r(0xfc)) {
        host.playSound(0x8004513e);
        m(cursorA(), 0x84, [0x9a, r(0xfc) * 0xe + 0x83]);
      }
      const rec = record();
      if (padBitOf(host, "padPressed", 0xd)) {
        host.playSound(0x8004503c);
        if (r(0xfc) < 3) mem.write32(rec + 8, u32(half(mem, self + r(0xfc) * 2 + 0x74)));
        else mem.write32(rec + 8, 0);
        advance();
      } else if (padBitOf(host, "padPressed", 0xe)) {
        host.playSound(0x800450bd);
        mem.write32(rec + 8, 0);
        advance();
      }
      break;
    }
    case 5:
      host.foldStart(fold(0xec), 0);
      labGridSlotFill(mem, self, aux, 0, host);
      m(cursorA(), 0x80, [0]);
      advance();
      break;
    case 6:
      if (host.foldTick(fold(0xec)) !== 0) {
        w(0x10, 0);
        w(0x14, 1);
      }
      break;
    default:
      if (host.foldTick(fold(0xdc)) !== 0) {
        if (r(0x14) !== 0) {
          m(self, 0x28, [3]);
        } else {
          labGridFill(mem, self, aux, 1, host);
          advance();
        }
      }
      break;
  }

  // The pictures (reached after every phase).
  host.initDrawContext();
  host.setLayer(r(0x50), r(0x54));
  host.setOrigin(0x280, 0x100);
  if (r(0xe4) !== 0x1000) {
    host.setScale(u32(r(0xe4)), 0x1000, 0x1000);
    host.setPos(0x140, 0x37);
  } else {
    let k = 0;
    do {
      if (half(mem, self + (r(0x68) * 2 + k) * 2 + 0x7a) >= 3) {
        host.drawSprite(pack(PACK), 0x3e, (k % 2) * 0x85 + 0x18, Math.floor(k / 2) * 0xe + 0x16);
      }
      k += 1;
    } while (k < 10);
  }
  if (s32(host.frameTick()) - r(0x6c) >= 8) {
    w(0x6c, host.frameTick());
    w(0x70, 1 - r(0x70));
  }
  if (r(0xe4) === 0x1000 && r(0x70) !== 0) {
    if (r(0x68) > 0) host.drawSprite(pack(PACK), 0x34, 0x123, 0x13);
    const n = r(0xd8);
    if (n >= 0xa && r(0x68) < n - Math.trunc(n / 2) - 5) host.drawSprite(pack(PACK), 0x35, 0x123, 0x55);
  }
  host.drawSprite(pack(PACK), 0x29, 0x12, 0xf);
  host.drawSprite(pack(PACK), 0x2a, 0x54, 0x64);
  host.setOrigin(0x140, 0);
  host.setLayer(r(0x50), r(0x54) - 1);
  host.drawSprite(pack(FONT_PACK), 0x14, 0x5b, 0x7f);
  const entry = host.scratch(2);
  host.formEntryCopy(r(0x58), selected(), entry);
  for (let i = 0; i < 6; i++) {
    if (mem.read16s(entry + 8 + 2 * i) !== 0) {
      const technique = mem.read16(entry + 8 + 2 * i) & 0x1fff;
      host.drawSprite(pack(FONT_PACK), mem.read8(LAB_TECHNIQUE_TABLE + (technique - 1) * 0x12 + 4) + 0x37, 0xb4, 0x8b + 0xe * i);
    }
  }
  if (r(0xf4) !== 0) {
    host.initDrawContext();
    host.setLayer(r(0x50), r(0x54) - 2);
    host.setOrigin(0x280, 0x100);
    if (r(0xf4) !== 0x1000) {
      host.setScale(u32(r(0xf4)), 0x1000, 0x1000);
      host.setPos(0x140, 0x9d);
    }
    host.drawSprite(pack(PACK), 0x2c, 0x95, 0x7c);
    if (r(0xf4) !== 0x1000) host.setPos(0, 0xd0);
    host.drawSprite(pack(PACK), 0x2b, 0, 0xbf);
  }
}
