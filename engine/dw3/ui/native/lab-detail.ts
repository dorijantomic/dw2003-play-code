// The lab's Digivolve screen (the partner detail): the partner's numbers and its three equipped
// forms, with a two-row menu that opens the form grid or the technique chooser. Translated from the
// original pro/stgdglab bodies.
//
// Oracle: tests/lane-b/lab-detail.test.js runs each original through engine/native and compares the
// ordered boundary calls, the return values and the object memory.
//
//   F0x80088694 labDetailCreate    (root) factory(handler F0x800885EC, 0x130, extra 0x60); +0xB4 =
//                                  0x1000, +0xB8 = 6, +0x50 = the root.
//   F0x800885EC labDetailLifecycle state 1 runs the tick then the draw; any state but 1..3 builds
//                                  (advance, fold values, the texts); states 2 and 3 idle.
//   F0x80087070 labDetailTexts     the 15 text widgets and the cursor.
//   F0x80087248 labDetailFill      (flag) fill the numbers and the three form names, or hide them.
//   F0x80087600 labDetailTick      the state machine (phase = +0x10; cases listed in the body).
//   F0x8008820C labDetailDraw      the screen's pictures.
//
// Object (0x130 bytes, children block 0x60): +0x10 phase, +0x14 outcome, +0x50 root, +0x54/+0x64/
// +0x74/+0x84/+0x94/+0xA4 six window folds (value at +8: +0x5C, +0x6C, +0x7C, +0x8C, +0x9C, +0xAC),
// +0xB4 layer, +0xB8 bucket, +0xBC the menu row (0/1), +0xC8 the form row carried between screens,
// +0xCC three equipped forms (halfwords), +0xD2 the acquired forms (halfwords), +0x12C their count.
// Children: +0x00 title, +0x04.. thirteen numbers (six statistics then seven elements), +0x38..
// three form names, +0x44.. two menu rows, +0x4C message, +0x50 cursor, +0x54 the roster picker,
// +0x58 the form grid, +0x5C the technique chooser.
import { labRosterCreate, type LabRosterHost, type LabRosterMemory } from "./lab-roster.ts";
import { fillStatPanel } from "../stat-panel.ts";
import { padBitOf, type LabPadHost } from "./lab-pad.ts";

export const LAB_DETAIL_HANDLER = 0x800885ec;
export const LAB_DETAIL_SIZE = 0x130;
export const LAB_DETAIL_EXTRA = 0x60;
const LANGUAGE = 0x8005cca8;
const PACK = 0x02c50000;
const FONT_PACK = 0x02860000;
const RECORDS_MINUS_4 = 0x80048d34 + 0x75c;
const RECORD_STRIDE = 0x3dc;

export interface LabDetailChildHosts {
  /** F0x80087018(slot, row): create the form grid; returns its object. */
  createGrid(slot: number, row: number): number;
  /** F0x8008D774(slot, row): create the technique chooser; returns its object. */
  createChooser(slot: number, row: number): number;
}

export type LabDetailHost = LabRosterHost & LabDetailChildHosts & {
  partnerSlot(position: number): number;
};

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

export function labDetailCreate(mem: LabRosterMemory, host: Pick<LabRosterHost, "alloc">, root: number): number {
  const obj = host.alloc(LAB_DETAIL_HANDLER, LAB_DETAIL_SIZE, LAB_DETAIL_EXTRA) >>> 0;
  mem.write32(obj + 0xb4, 0x1000);
  mem.write32(obj + 0xb8, 6);
  mem.write32(obj + 0x50, u32(root));
  return obj;
}

/** F0x80087070(self, aux): create the text widgets and the cursor. */
export function labDetailTexts(mem: LabRosterMemory, self: number, aux: number, host: LabDetailHost): void {
  const layer = (): number => (mem.read32(self + 0xb4) << 16) >> 16;
  const text = (word: number, x: number, y: number): void => mem.write32(aux + word, host.createText(layer(), 1, x, y));
  text(0x00, 0xae, 0x57);
  for (let k = 0; k < 3; k++) text(0x38 + 4 * k, 0xa7, 0x16 + 0xe * k);
  for (let k = 0; k < 2; k++) text(0x44 + 4 * k, 0xa7, 0x73 + 0xe * k);
  for (let k = 0; k < 6; k++) text(0x04 + 4 * k, 0x32, 0x4f + 0xe * k);
  for (let k = 0; k < 7; k++) text(0x1c + 4 * k, 0x5b, 0x4f + 0xe * k);
  const children = u32(mem.read32(self + 0x24));
  const count = s32(mem.read32(self + 0x20)) - 4;
  for (let i = 0; i < count; i++) {
    const widget = u32(mem.read32(children + i * 4));
    if (widget !== 0) host.callMethod(widget, 0x15c, [s32(mem.read32(self + 0xb8)) - 1]);
  }
  const cursor = host.createCursor(layer(), s32(mem.read32(self + 0xb8)) - 1, 0x9a, 0x73) >>> 0;
  mem.write32(aux + 0x50, cursor);
  host.callMethod(cursor, 0x80, [0]);
}

/** F0x80087248(self, aux, flag): fill the numbers and form names (flag set) or hide them. */
export function labDetailFill(mem: LabRosterMemory, self: number, aux: number, flag: number, host: LabDetailHost): void {
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const word = (offset: number): number => u32(mem.read32(aux + offset));
  if (flag === 0) {
    const children = u32(mem.read32(self + 0x24));
    const count = s32(mem.read32(self + 0x20)) - 4;
    for (let i = 0; i < count; i++) {
      const widget = u32(mem.read32(children + i * 4));
      if (widget !== 0) m(widget, 0x144, [0]);
    }
    m(word(0x50), 0x80, [0]);
    return;
  }
  const root = u32(mem.read32(self + 0x50));
  const slot = s32(host.partnerSlot(s32(mem.read32(root + 0x64))));
  const stats = host.scratch(0);
  host.effectiveStats(slot, stats);
  m(word(0x00), 0x114, [bank(0x39), 1]);
  for (let k = 0; k < 3; k++) {
    const form = mem.read16s(self + 0xcc + 2 * k);
    const label = word(0x38 + 4 * k);
    if (form < 2) {
      if (k === 0) m(label, 0x114, [bank(0x39), 0x1b]);
      else m(label, 0x144, [0]);
    } else {
      const names = bank(0x4e);
      m(label, 0x114, [names, mem.read8(u32(host.profileRecord(form)) + 0x55)]);
      m(label, 0x138, [s32(mem.read32(RECORDS_MINUS_4 + slot * RECORD_STRIDE + 8)) === form ? 1 : 0]);
    }
  }
  for (let k = 0; k < 2; k++) m(word(0x44 + 4 * k), 0x114, [bank(0x39), 0x21 + k]);
  // The thirteen numbers are the shared walk (ui/stat-panel.ts): this screen
  // greys its three marks before its enable pass and never clears them.
  fillStatPanel(mem, {
    widget: (index: number): number => word(0x04 + 4 * index),
    setNumber: (target: number, value: number): void => { m(target, 0x118, [0, value]); },
    setEnabled: (target: number): void => { m(target, 0x148, [1]); },
    setMark: (target: number, code: number): void => { m(target, 0x138, [code]); },
  }, stats, { cap: true, marks: "before-pass", pass: "after" });
  m(word(0x50), 0x80, [1]);
}

const repeating = (host: LabPadHost, bit: number): boolean =>
  padBitOf(host, "padPressed", bit) || padBitOf(host, "padRepeat", bit);

/** F0x80087600(self, aux): the state machine. */
export function labDetailTick(mem: LabRosterMemory, self: number, aux: number, host: LabDetailHost): void {
  const r = (off: number): number => s32(mem.read32(self + off));
  const w = (off: number, value: number): void => mem.write32(self + off, u32(value));
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const advance = (): void => w(0x10, r(0x10) + 1);
  const root = u32(mem.read32(self + 0x50));
  const fold = (offset: number): number => (self + offset) >>> 0;
  const slotOf = (): number => s32(host.partnerSlot(s32(mem.read32(root + 0x64))));
  const roster = (): number => u32(mem.read32(aux + 0x54));
  const prompt = (): void => {
    if (mem.read32(aux + 0x4c) === 0) mem.write32(aux + 0x4c, host.createText(s32(mem.read32(self + 0xb4)), 1, 0xa4, 0xb8));
  };

  const phase = u32(r(0x10));
  switch (phase) {
    case 1:
      host.foldTick(fold(0x54)); host.foldTick(fold(0x64)); host.foldTick(fold(0x74));
      if (host.foldTick(fold(0x84)) !== 0) {
        labDetailFill(mem, self, aux, 1, host);
        advance();
      }
      return;
    case 2: {
      const before = r(0xbc);
      if (repeating(host, 4)) {
        w(0xbc, r(0xbc) - 1);
        if (r(0xbc) < 0) w(0xbc, 0);
      } else if (repeating(host, 6)) {
        w(0xbc, r(0xbc) + 1);
        if (r(0xbc) >= 2) w(0xbc, 1);
      }
      if (before !== r(0xbc)) {
        host.playSound(0x8004513e);
        m(u32(mem.read32(aux + 0x50)), 0x84, [0x9a, r(0xbc) * 0xe + 0x72]);
      }
      if (padBitOf(host, "padPressed", 0xd)) {
        host.playSound(0x8004503c);
        const row = r(0xbc);
        if ((row === 0 && r(0x12c) < 4) || (row === 1 && r(0x12c) === 0)) {
          m(self, 0x2c, [0x1e]);
          host.foldStart(fold(0x94), 1);
          m(u32(mem.read32(aux + 0x50)), 0x80, [0]);
          return;
        }
        w(0x14, 0);
        advance();
        return;
      }
      if (padBitOf(host, "padPressed", 0xe)) {
        host.playSound(0x800450bd);
        w(0x14, 1);
        advance();
        return;
      }
      return;
    }
    case 3:
      for (const offset of [0x54, 0x64, 0x74, 0x84]) host.foldStart(fold(offset), 0);
      labDetailFill(mem, self, aux, 0, host);
      advance();
      return;
    case 4:
      host.foldTick(fold(0x54)); host.foldTick(fold(0x64)); host.foldTick(fold(0x74));
      if (host.foldTick(fold(0x84)) !== 0) {
        if (r(0x14) === 0) {
          w(0xc8, 0);
          m(self, 0x2c, [0x28]);
          const row = r(0xbc);
          if (row !== 1) {
            if (row >= 2 && row === 2) { m(self, 0x28, [3]); return; }
            w(0x14, 0xa);
            return;
          }
          w(0x14, 0x14);
          return;
        }
        m(self, 0x28, [3]);
      }
      return;
    case 0x28:
      if (roster() === 0) mem.write32(aux + 0x54, labRosterCreate(mem, host, slotOf(), 0, 0));
      mem.write32(roster() + 0x160, u32(r(0xc8)));
      advance();
      return;
    case 0x29: {
      const picker = roster();
      if (picker === 0 || s32(mem.read32(picker + 0x10)) >= 2) {
        if (padBitOf(host, "padPressed", 0xd)) {
          host.playSound(0x8004503c);
          let proceed = true;
          if (r(0x14) === 0x14) {
            const slot = s32(host.partnerSlot(s32(mem.read32(root + 0x64))));
            const equipped = host.scratch(0);
            const entry = host.scratch(1);
            host.equippedForms(slot, equipped);
            host.formEntryCopy(slot, mem.read16s(equipped + 2 * s32(mem.read32(roster() + 0x160))), entry);
            let found = false;
            for (let i = 0; i < 6; i++) if (mem.read16s(entry + 8 + 2 * i) !== 0) { found = true; break; }
            if (!found) {
              m(self, 0x2c, [0x32]);
              host.foldStart(fold(0xa4), 1);
              m(u32(mem.read32(aux + 0x50)), 0x80, [0]);
              mem.write32(roster() + 0x10, 4);
              proceed = false;
            }
          }
          if (proceed) {
            const row = s32(mem.read32(roster() + 0x160));
            w(0x10, r(0x14));
            w(0xc8, row);
            m(self, 0x30, [0]);
            return;
          }
        } else if (padBitOf(host, "padPressed", 0xe)) {
          host.playSound(0x800450bd);
          m(roster(), 0x170, []);
          advance();
        }
      }
      return;
    }
    case 0x2a:
      if (roster() === 0) m(self, 0x2c, [0]);
      return;
    case 0xa:
      m(root, 0x6c, []);
      m(roster(), 0x170, []);
      advance();
      return;
    case 0xb:
      if (s32(host.callMethod(root, 0x70, [])) !== 0 && roster() === 0) {
        if (mem.read32(aux + 0x58) === 0) mem.write32(aux + 0x58, host.createGrid(slotOf(), r(0xc8)));
        advance();
      }
      return;
    case 0xc:
      if (mem.read32(aux + 0x58) === 0) {
        m(root, 0x68, []);
        m(self, 0x2c, [0x28]);
        w(0x14, 0xa);
      }
      return;
    case 0x14:
      m(roster(), 0x170, []);
      advance();
      return;
    case 0x15:
      if (roster() === 0) {
        if (mem.read32(aux + 0x5c) === 0) mem.write32(aux + 0x5c, host.createChooser(slotOf(), r(0xc8)));
        advance();
      }
      return;
    case 0x16:
      if (mem.read32(aux + 0x5c) === 0) {
        m(self, 0x2c, [0x28]);
        w(0x14, 0x14);
      }
      return;
    case 0x1e:
      if (host.foldTick(fold(0x94)) !== 0) {
        prompt();
        m(u32(mem.read32(aux + 0x4c)), 0x15c, [s32(mem.read32(self + 0xb8)) - 1]);
        m(u32(mem.read32(aux + 0x4c)), 0x114, [bank(0x39), r(0xbc) + 0x24]);
        advance();
      }
      return;
    case 0x1f:
      if (padBitOf(host, "padPressed", 0xd)) {
        host.playSound(0x4001c);
        host.foldStart(fold(0x94), 0);
        m(u32(mem.read32(aux + 0x4c)), 0x144, [0]);
        advance();
      }
      return;
    case 0x20:
      if (host.foldTick(fold(0x94)) !== 0) {
        m(u32(mem.read32(aux + 0x50)), 0x80, [1]);
        m(self, 0x2c, [2]);
      }
      return;
    case 0x32:
      if (host.foldTick(fold(0xa4)) !== 0) {
        prompt();
        m(u32(mem.read32(aux + 0x4c)), 0x15c, [0]);
        m(u32(mem.read32(aux + 0x4c)), 0x114, [bank(0x39), 0x25]);
        advance();
      }
      return;
    case 0x33:
      if (padBitOf(host, "padPressed", 0xd)) {
        host.playSound(0x4001c);
        host.foldStart(fold(0xa4), 0);
        m(u32(mem.read32(aux + 0x4c)), 0x144, [0]);
        advance();
      }
      return;
    case 0x34:
      if (host.foldTick(fold(0xa4)) !== 0) {
        m(self, 0x2c, [0x29]);
        w(0x14, 0x14);
        mem.write32(roster() + 0x10, 5);
      }
      return;
    default: {
      const slot = slotOf();
      host.equippedForms(slot, (self + 0xcc) >>> 0);
      w(0x12c, host.acquiredForms(slot, (self + 0xd2) >>> 0));
      for (const offset of [0x54, 0x64, 0x74, 0x84]) host.foldStart(fold(offset), 1);
      advance();
    }
  }
}

/** F0x8008820C(self): the screen's pictures. */
export function labDetailDraw(mem: LabRosterMemory, self: number, host: LabDetailHost): void {
  const r = (off: number): number => s32(mem.read32(self + off));
  const pack = (handle: number): number => u32(host.packResolve(handle));
  const unit = (): void => host.setScale(0x1000, 0x1000, 0x1000);
  host.initDrawContext();
  host.setLayer(r(0xb4), r(0xb8));
  if (r(0xac) !== 0) {
    host.setLayer(r(0xb4), 1);
    if (r(0xac) !== 0x1000) {
      host.setScale(u32(r(0xac)), 0x1000, 0x1000);
      host.setPos(0x140, 0xbe);
    }
    host.setOrigin(0x280, 0x100);
    host.drawSprite(pack(PACK), 0x25, 0x92, 0xb0);
  }
  if (r(0x5c) !== 0x1000) {
    host.setScale(u32(r(0x5c)), 0x1000, 0x1000);
    host.setPos(0, 0x7f);
  } else unit();
  host.setOrigin(0x140, 0);
  host.drawSprite(pack(FONT_PACK), 0xf, 0, 0x4b);
  host.setOrigin(0x280, 0x100);
  host.drawSprite(pack(PACK), 0x1f, 0, 0x4b);
  if (r(0x6c) !== 0x1000) {
    host.setScale(u32(r(0x6c)), 0x1000, 0x1000);
    host.setPos(0x140, 0x2a);
  } else unit();
  host.drawSprite(pack(PACK), 0x22, 0x92, 0xf);
  if (r(0x7c) !== 0x1000) {
    host.setScale(u32(r(0x8c)), 0x1000, 0x1000);
    host.setPos(0x140, 0x5c);
  } else unit();
  host.drawSprite(pack(PACK), 0x20, 0x92, 0x51);
  if (r(0x8c) !== 0x1000) {
    host.setScale(u32(r(0x8c)), 0x1000, 0x1000);
    host.setPos(0x140, 0x87);
  } else unit();
  host.drawSprite(pack(PACK), 0x23, 0x92, 0x6c);
  if (r(0x9c) !== 0) {
    if (r(0x9c) !== 0x1000) {
      host.setScale(u32(r(0x9c)), 0x1000, 0x1000);
      host.setPos(0x140, 0xbe);
    } else unit();
    host.drawSprite(pack(PACK), 0x25, 0x92, 0xb0);
  }
}

/** F0x800885EC(self, aux): the screen's lifecycle. */
export function labDetailLifecycle(mem: LabRosterMemory, self: number, aux: number, host: LabDetailHost): void {
  const state = s32(mem.read32(self + 0x0c));
  if (state === 1) {
    labDetailTick(mem, self, aux, host);
    labDetailDraw(mem, self, host);
    return;
  }
  if (state >= 2 && state < 4) return;
  host.callMethod(self, 0x38, []);
  mem.write32(self + 0x54, 8);
  mem.write32(self + 0x64, 0xa);
  mem.write32(self + 0x74, 0xa);
  mem.write32(self + 0x84, 0xa);
  mem.write32(self + 0x94, 0xa);
  mem.write32(self + 0xa4, 8);
  labDetailTexts(mem, self, aux, host);
}
