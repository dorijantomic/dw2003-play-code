// The lab's technique chooser: the six technique slots of an equipped form, each of which can be
// loaded or unloaded. Translated from the original pro/stgdglab bodies.
//
// Oracle: tests/lane-b/lab-chooser.test.js runs each original through engine/native and compares the
// ordered boundary calls, the return values and the object memory.
//
//   F0x8008D774 labChooserCreate  (slot, row) factory(handler F0x8008C960, 0xAC, extra 0x5C); +0x70 =
//                                 0x1000, +0x74 = 2, +0x78 = the roster slot, +0x7C = the equipped row.
//   F0x8008C278 labChooserTexts   the chooser's widgets and its two cursors.
//   F0x8008C4EC labChooserFill    (flag) fill the six technique rows and the highlighted one's cost, or hide.
//   F0x8008C960 labChooserTick    the state machine (phase +0x10) and the pictures. Leaving (phase 0x28
//                                 then 0x28's fold) writes the edited ledger entry back through ctx+0x274C.
//
// Object (0xAC bytes, children block 0x5C): +0x10 phase, +0x14 the phase to return to, +0x50 / +0x60 two
// folds (value at +8: +0x58 / +0x68), +0x70 layer, +0x74 bucket, +0x78 roster slot, +0x7C equipped row,
// +0x80 the three equipped forms (halfwords), +0x88 the form's ledger entry (0x14 bytes; six technique
// halfwords at +0x90: bit 0x4000 loaded, 0x8000 locked, 0x2000 usable, low 13 bits the technique),
// +0x9C how many are loaded, +0xA0 the yes/no cursor, +0xA4 the technique cursor, +0xA8 = 6.
// Children: +0x00 form name, +0x04 heading, +0x08 loaded count, +0x0C.. six technique names, +0x24..
// six state labels, +0x3C message, +0x40 / +0x44 yes / no, +0x48 technique text, +0x4C / +0x50 cost
// heading and number, +0x54 yes/no cursor, +0x58 row cursor.
import { padBitOf, type LabPadHost } from "./lab-pad.ts";
import { LAB_TECHNIQUE_TABLE, type LabRosterHost, type LabRosterMemory } from "./lab-roster.ts";

export const LAB_CHOOSER_HANDLER = 0x8008c960;
export const LAB_CHOOSER_SIZE = 0xac;
export const LAB_CHOOSER_EXTRA = 0x5c;
const LANGUAGE = 0x8005cca8;
const PACK = 0x02c50000;
const FONT_PACK = 0x02860000;

export type LabChooserHost = LabRosterHost & {
  /** ctx+0x274C(slot, form, in): copy the buffer over the form's ledger entry. */
  writeFormEntry(slot: number, form: number, input: number): number;
};

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

export function labChooserCreate(mem: LabRosterMemory, host: Pick<LabRosterHost, "alloc">, slot: number, row: number): number {
  const obj = host.alloc(LAB_CHOOSER_HANDLER, LAB_CHOOSER_SIZE, LAB_CHOOSER_EXTRA) >>> 0;
  mem.write32(obj + 0x70, 0x1000);
  mem.write32(obj + 0x74, 2);
  mem.write32(obj + 0x78, u32(slot));
  mem.write32(obj + 0x7c, u32(row));
  return obj;
}

/** F0x8008C278(self, aux): create the widgets and cursors. */
export function labChooserTexts(mem: LabRosterMemory, self: number, aux: number, host: LabChooserHost): void {
  const layer = (): number => s32(mem.read32(self + 0x70));
  const text = (word: number, x: number, y: number): void => mem.write32(aux + word, host.createText(layer(), 1, x, y));
  text(0x00, 0x9a, 0x46);
  text(0x04, 0x122, 0x46);
  text(0x08, 0x121, 0x46);
  for (let k = 0; k < 6; k++) {
    text(0x0c + 4 * k, 0x6b, 0x58 + 0x11 * k);
    text(0x24 + 4 * k, 0xf1, 0x58 + 0x11 * k);
  }
  text(0x3c, 0x9a, 0x1a);
  text(0x40, 0xc3, 0x38);
  text(0x44, 0xc3, 0x48);
  text(0x48, 0x14, 0xc3);
  host.callMethod(u32(mem.read32(aux + 0x48)), 0x160, [2]);
  text(0x4c, 0x109, 0xd1);
  text(0x50, 0x12c, 0xd1);
  const children = u32(mem.read32(self + 0x24));
  const count = s32(mem.read32(self + 0x20)) - 2;
  for (let i = 0; i < count; i++) {
    const widget = u32(mem.read32(children + i * 4));
    if (widget !== 0) host.callMethod(widget, 0x15c, [s32(mem.read32(self + 0x74)) - 1]);
  }
  host.callMethod(u32(mem.read32(aux + 0x40)), 0x15c, [0]);
  host.callMethod(u32(mem.read32(aux + 0x44)), 0x15c, [0]);
  const yesNo = host.createCursor(layer(), 0, 0xb8, 0x38) >>> 0;
  mem.write32(aux + 0x54, yesNo);
  host.callMethod(yesNo, 0x80, [0]);
  const rows = host.createCursor(layer(), s32(mem.read32(self + 0x74)) - 1, 0x4c, 0x58) >>> 0;
  mem.write32(aux + 0x58, rows);
  host.callMethod(rows, 0x80, [0]);
}

/** F0x8008C4EC(self, aux, flag): fill the six technique rows (flag set) or hide the widgets. */
export function labChooserFill(mem: LabRosterMemory, self: number, aux: number, flag: number, host: LabChooserHost): void {
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const word = (offset: number): number => u32(mem.read32(aux + offset));
  const r = (off: number): number => s32(mem.read32(self + off));
  if (flag === 0) {
    const children = u32(mem.read32(self + 0x24));
    const count = r(0x20) - 2;
    for (let i = 0; i < count; i++) {
      const widget = u32(mem.read32(children + i * 4));
      if (widget !== 0) m(widget, 0x144, [0]);
    }
    return;
  }
  if (mem.read16s(self + 0x88) < 3) return;
  const names = bank(0x4e);
  m(word(0x00), 0x114, [names, mem.read8(u32(host.profileRecord(mem.read16s(self + 0x88))) + 0x55)]);
  mem.write32(self + 0x9c, 0);
  if (r(0xa8) > 0) {
    let i = 0;
    do {
      const technique = mem.read16(self + 0x90 + 2 * i);
      const name = word(0x0c + 4 * i);
      const state = word(0x24 + 4 * i);
      if (mem.read16s(self + 0x90 + 2 * i) !== 0) {
        m(name, 0x114, [bank(0xa2), technique & 0x1fff]);
        if ((technique & 0x4000) !== 0) {
          m(state, 0x114, [bank(0x39), 0x11]);
          mem.write32(self + 0x9c, u32(r(0x9c) + 1));
        } else {
          m(state, 0x114, [bank(0x39), 0x12]);
        }
        const colour = (technique & 0x4000) !== 0 ? 4 : (technique & 0x8000) !== 0 ? 3 : (technique & 0x2000) === 0 ? 7 : 0;
        m(name, 0x138, [colour]);
        m(state, 0x138, [colour]);
      } else {
        m(name, 0x144, [0]);
        m(state, 0x144, [0]);
      }
      i += 1;
    } while (i < r(0xa8));
  }
  m(word(0x04), 0x114, [bank(0x39), 0x10]);
  m(word(0x08), 0x118, [0, r(0x9c)]);
  m(word(0x08), 0x148, [1]);
  const technique = mem.read16(self + r(0xa4) * 2 + 0x90) & 0x1fff;
  if (technique !== 0) {
    m(word(0x48), 0x114, [bank(0x9b), technique]);
    m(word(0x4c), 0x114, [bank(0x39), 0xe]);
    m(word(0x50), 0x118, [0, mem.read16(LAB_TECHNIQUE_TABLE + (technique - 1) * 0x12)]);
    m(word(0x50), 0x148, [1]);
    return;
  }
  m(word(0x48), 0x144, [0]);
  m(word(0x4c), 0x144, [0]);
  m(word(0x50), 0x144, [0]);
}

const repeating = (host: LabPadHost, bit: number): boolean =>
  padBitOf(host, "padPressed", bit) || padBitOf(host, "padRepeat", bit);

/** F0x8008C960(self, aux): the state machine and the pictures. */
export function labChooserTick(mem: LabRosterMemory, self: number, aux: number, host: LabChooserHost): void {
  const r = (off: number): number => s32(mem.read32(self + off));
  const w = (off: number, value: number): void => mem.write32(self + off, u32(value));
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const advance = (): void => w(0x10, r(0x10) + 1);
  const fold = (offset: number): number => (self + offset) >>> 0;
  const word = (offset: number): number => u32(mem.read32(aux + offset));
  const pack = (handle: number): number => u32(host.packResolve(handle));

  const state = r(0x0c);
  if (state !== 1) {
    if (state < 2 || state >= 4) {
      host.callMethod(self, 0x38, []);
      w(0x50, 0xa);
      w(0x60, 0xa);
      host.foldStart(fold(0x50), 1);
      host.equippedForms(r(0x78), fold(0x80));
      host.formEntryCopy(r(0x78), mem.read16s(self + r(0x7c) * 2 + 0x80), fold(0x88));
      w(0xa8, 6);
      labChooserTexts(mem, self, aux, host);
    }
    return;
  }

  const confirmPrompt = (id: number): void => {
    m(word(0x3c), 0x114, [bank(0x39), id]);
    m(word(0x40), 0x114, [bank(0x39), 0xc]);
    m(word(0x44), 0x114, [bank(0x39), 0xd]);
    w(0xa0, 0);
    m(word(0x54), 0x80, [1]);
    m(word(0x54), 0x84, [0xb8, r(0xa0) * 0x10 + 0x38]);
    advance();
  };
  const choiceKeys = (): void => {
    const before = r(0xa0);
    if (padBitOf(host, "padPressed", 4)) w(0xa0, 0);
    else if (padBitOf(host, "padPressed", 6)) w(0xa0, 1);
    if (before !== r(0xa0)) {
      host.playSound(0x8004513e);
      m(word(0x54), 0x84, [0xb8, r(0xa0) * 0x10 + 0x38]);
    }
  };
  const closeChoice = (): void => {
    m(word(0x40), 0x144, [0]);
    m(word(0x44), 0x144, [0]);
    m(word(0x58), 0x94, [0]);
    m(self, 0x2c, [7]);
    w(0x14, 0);
  };
  const choiceConfirm = (flagBits: (v: number) => number): void => {
    if (padBitOf(host, "padPressed", 0xd)) {
      host.playSound(0x8004503c);
      if (r(0xa0) === 0) {
        const at = self + r(0xa4) * 2 + 0x90;
        mem.write16(at, flagBits(mem.read16(at)));
      }
      closeChoice();
    } else if (padBitOf(host, "padPressed", 0xe)) {
      host.playSound(0x800450bd);
      closeChoice();
    }
  };

  const phase = u32(r(0x10));
  const known = [0, 1, 5, 6, 7, 10, 11, 20, 21, 30, 40];
  let selector = phase;
  if (!known.includes(phase)) {
    m(self, 0x28, [3]);
    selector = 0;
  }
  switch (selector) {
    case 0:
      if (host.foldTick(fold(0x50)) !== 0) {
        labChooserFill(mem, self, aux, 1, host);
        m(word(0x3c), 0x114, [bank(0x39), 0x26]);
        m(word(0x58), 0x84, [0x4c, r(0xa4) * 0x11 + 0x58]);
        m(word(0x58), 0x80, [1]);
        m(word(0x58), 0x88, [0]);
        m(word(0x54), 0x80, [0]);
        advance();
      }
      break;
    case 1: {
      const before = r(0xa4);
      if (repeating(host, 4)) {
        w(0xa4, r(0xa4) - 1);
        if (r(0xa4) < 0) w(0xa4, 0);
      } else if (repeating(host, 6)) {
        const next = r(0xa4) + 1;
        const last = r(0xa8) - 1;
        w(0xa4, next);
        if (last < next) w(0xa4, last);
      }
      if (before !== r(0xa4)) {
        host.playSound(0x8004513e);
        labChooserFill(mem, self, aux, 1, host);
        m(word(0x58), 0x84, [0x4c, r(0xa4) * 0x11 + 0x58]);
      } else {
        const technique = mem.read16s(self + before * 2 + 0x90);
        if (padBitOf(host, "padPressed", 0xd)) {
          host.playSound(0x8004503c);
          if (technique !== 0) {
            if ((technique & 0x4000) !== 0) {
              w(0x10, 5);
              w(0x14, 0xa);
            } else if ((technique & 0x8000) !== 0) {
              m(word(0x3c), 0x114, [bank(0x39), 0xb]);
              w(0x10, 0x1e);
            } else if ((technique & 0x2000) === 0) {
              m(word(0x3c), 0x114, [bank(0x39), 0xa]);
              w(0x10, 0x1e);
            } else if (r(0x9c) >= 3) {
              m(word(0x3c), 0x114, [bank(0x39), 9]);
              w(0x10, 0x1e);
            } else {
              w(0x10, 5);
              w(0x14, 0x14);
            }
            m(word(0x58), 0x88, [7]);
            m(word(0x58), 0x94, [1]);
          }
        } else if (padBitOf(host, "padPressed", 0xe)) {
          host.playSound(0x800450bd);
          m(self, 0x2c, [0x28]);
          host.foldStart(fold(0x50), 0);
          m(word(0x54), 0x80, [0]);
          m(word(0x58), 0x80, [0]);
          labChooserFill(mem, self, aux, 0, host);
        }
      }
      break;
    }
    case 5:
      host.foldStart(fold(0x60), 1);
      advance();
      break;
    case 6:
      if (host.foldTick(fold(0x60)) !== 0) {
        w(0x10, r(0x14));
        m(self, 0x30, [0]);
      }
      break;
    case 7:
      m(word(0x54), 0x80, [0]);
      host.foldStart(fold(0x60), 0);
      w(0x10, 6);
      break;
    case 10:
      confirmPrompt(7);
      break;
    case 11:
      choiceKeys();
      choiceConfirm((v) => (v & 0xbfff) & 0xffff);
      break;
    case 20:
      confirmPrompt(8);
      break;
    case 21:
      choiceKeys();
      choiceConfirm((v) => (v | 0x4000) & 0xffff);
      break;
    case 30:
      if (padBitOf(host, "padPressed", 0xd)) {
        host.playSound(0x8004503c);
        m(word(0x58), 0x94, [0]);
        m(self, 0x2c, [0]);
      }
      break;
    case 40:
      if (host.foldTick(fold(0x50)) !== 0) {
        host.writeFormEntry(r(0x78), mem.read16s(self + r(0x7c) * 2 + 0x80), fold(0x88));
        m(self, 0x28, [3]);
      }
      break;
  }

  host.initDrawContext();
  host.setLayer(r(0x70), r(0x74));
  if (r(0x58) !== 0x1000) {
    host.setScale(u32(r(0x58)), 0x1000, 0x1000);
    host.setPos(0x140, 0x7d);
  } else {
    host.setOrigin(0x140, 0);
    for (let i = 0; i < 6; i++) {
      if (mem.read16s(self + 0x90 + 2 * i) !== 0) {
        const technique = mem.read16(self + 0x90 + 2 * i) & 0x1fff;
        host.drawSprite(pack(FONT_PACK), mem.read8(LAB_TECHNIQUE_TABLE + (technique - 1) * 0x12 + 4) + 0x37, 0x5d, 0x58 + 0x11 * i);
      }
    }
  }
  host.setOrigin(0x280, 0x100);
  host.drawSprite(pack(PACK), 0x28, 0x46, 0x41);
  if (r(0x58) !== 0x1000) host.setPos(0, 0xd0);
  host.drawSprite(pack(PACK), 0x2b, 0, 0xbf);
  if (r(0x58) !== 0x1000) host.setPos(0x140, 0x1f);
  host.drawSprite(pack(PACK), 0x24, 0x92, 0x13);
  if (r(0x68) !== 0) {
    if (r(0x68) !== 0x1000) {
      host.setScale(u32(r(0x68)), 0x1000, 0x1000);
      host.setPos(0x140, 0x46);
    } else host.setScale(0x1000, 0x1000, 0x1000);
    host.setLayer(r(0x70), 1);
    host.drawSprite(pack(PACK), 0x23, 0xae, 0x32);
  }
}
