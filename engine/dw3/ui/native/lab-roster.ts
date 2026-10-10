// The lab's roster picker: the list of forms a partner can take, with that form's numbers and
// technique icons beside it. Translated from the original pro/stgdglab bodies.
//
// Oracle: tests/lane-b/lab-roster.test.js runs each original through engine/native and compares the
// ordered boundary calls, the return values and the object memory.
//
//   F0x8008EABC labRosterCreate    (slot, withAcquired, backable) factory(handler F0x8008E8D0, 0x174,
//                                  extra 0x70); +0x170 = F0x8008DFA0; +0x58 = 0x1000, +0x5C = 2,
//                                  +0x50 = withAcquired, +0x54 = slot, +0x16C = backable.
//   F0x8008E8D0 labRosterLifecycle state 1 runs the tick and the draw; states 2 and 3 idle; any other
//                                  state builds the screen: the form list (the partner's three equipped
//                                  forms, stopping at the first empty one, then - when +0x50 is set -
//                                  every acquired form not already listed), the text widgets, the
//                                  cursor, and the fold values.
//   F0x8008D7CC labRosterTexts     the 28 text widgets (positions below) and their alignment.
//   F0x8008D9BC labRosterFill      (flag) fill the widgets for the highlighted form, or (flag 0) hide them.
//   F0x8008DFA0 labRosterHide      close the pane: fold shut, hide the widgets and the cursor, next state.
//   F0x8008E018 labRosterTick      the pane's state machine.
//   F0x8008E4CC labRosterDraw      the pane's pictures.
//
// Object (0x174 bytes, children block 0x70 = 28 words): +0x10 phase, +0x24 children, +0x50 acquired
// flag, +0x54 roster slot, +0x58 layer, +0x5C bucket, +0x68 / +0x78 / +0x88 fold values, +0x80 the
// pane fold, +0x90.. the form list (words), +0x158 first listed row, +0x15C the form count,
// +0x160 the cursor row (0..2), +0x164 / +0x168 the arrow blink, +0x16C backable.
// Children block words: +0x00 title, +0x04.. three form labels, +0x10 / +0x14 headings, +0x18..
// six technique names, +0x30.. six statistic numbers, +0x48.. seven element numbers, +0x64 the
// level number, +0x68 the cursor, +0x6C the scroll bar.
import { labCapsuleCreate, type LabCapsuleHost } from "./lab-capsule.ts";
import { fillStatPanel } from "../stat-panel.ts";
import { padBitOf, type LabPadHost } from "./lab-pad.ts";
import type { SelectDrawHost } from "./select-action.ts";

export const LAB_ROSTER_HANDLER = 0x8008e8d0;
export const LAB_ROSTER_SIZE = 0x174;
export const LAB_ROSTER_EXTRA = 0x70;
export const LAB_ROSTER_HIDE = 0x8008dfa0;
export const LAB_PACK_STDGLABO = 0x02c50000;
export const LAB_PACK_CMFONT = 0x02860000;
/** The resident technique records (0x12 bytes each); byte +4 is the icon cel base. */
export const LAB_TECHNIQUE_TABLE = 0x80042bdc;
export const LAB_RECORDS = 0x80049490;
const LANGUAGE = 0x8005cca8;

export interface LabRosterMemory {
  read8(addr: number): number;
  read16(addr: number): number;
  read16s(addr: number): number;
  read32(addr: number): number;
  write16(addr: number, value: number): void;
  write32(addr: number, value: number): void;
}

export interface LabRosterHost extends LabPadHost, SelectDrawHost, LabCapsuleHost {
  callMethod(target: number, slot: number, args: number[]): number;
  createText(layer: number, kind: number, x: number, y: number): number;
  createCursor(layer: number, order: number, x: number, y: number): number;
  foldStart(target: number, direction: number): void;
  foldTick(target: number): number;
  playSound(id: number): void;
  textBank(id: number): number;
  /** ctx+0x2734(slot, out): the slot's effective statistics block (0x2C bytes). */
  effectiveStats(slot: number, out: number): void;
  /** ctx+0x2738(slot, out): the three equipped forms (halfwords). */
  equippedForms(slot: number, out: number): void;
  /** ctx+0x2740(slot, out): every acquired form (halfwords). */
  acquiredForms(slot: number, out: number): number;
  /** ctx+0x2748(slot, form, out): the form's ledger entry (0x14 bytes). */
  formEntryCopy(slot: number, form: number, out: number): void;
  /** [0x8005CCA0](form): the species profile record pointer. */
  profileRecord(form: number): number;
  /** Platform scratch the port uses for the original's stack buffers. */
  scratch(index: number): number;
  setDepth(x: number, y: number): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

export function labRosterCreate(
  mem: LabRosterMemory & { write32(a: number, v: number): void },
  host: Pick<LabRosterHost, "alloc">, slot: number, withAcquired: number, backable: number,
): number {
  const obj = host.alloc(LAB_ROSTER_HANDLER, LAB_ROSTER_SIZE, LAB_ROSTER_EXTRA) >>> 0;
  mem.write32(obj + 0x170, LAB_ROSTER_HIDE);
  mem.write32(obj + 0x58, 0x1000);
  mem.write32(obj + 0x5c, 2);
  mem.write32(obj + 0x50, u32(withAcquired));
  mem.write32(obj + 0x54, u32(slot));
  mem.write32(obj + 0x16c, u32(backable));
  return obj;
}

/** F0x8008D7CC(self, aux): create the pane's 28 text widgets and align the children left. */
export function labRosterTexts(mem: LabRosterMemory, self: number, aux: number, host: LabRosterHost): void {
  const layer = s32(mem.read32(self + 0x58));
  const text = (word: number, x: number, y: number): void => mem.write32(aux + word, host.createText(layer, 1, x, y));
  text(0x00, 0xae, 0x15);
  for (let k = 0; k < 3; k++) text(0x04 + 4 * k, 0xa7, 0x31 + 0xe * k);
  text(0x10, 0x5b, 0x6a);
  for (let k = 0; k < 6; k++) text(0x30 + 4 * k, 0x7d, 0x7f + 0xe * k);
  for (let k = 0; k < 7; k++) text(0x48 + 4 * k, 0xa7, 0x7f + 0xe * k);
  text(0x14, 0xeb, 0x6a);
  text(0x64, 0x12d, 0x6a);
  for (let k = 0; k < 6; k++) text(0x18 + 4 * k, 0xc2, 0x8b + 0xe * k);
  const children = u32(mem.read32(self + 0x24));
  const count = s32(mem.read32(self + 0x20)) - 2;
  for (let i = 0; i < count; i++) {
    const widget = u32(mem.read32(children + i * 4));
    if (widget !== 0) host.callMethod(widget, 0x15c, [s32(mem.read32(self + 0x5c)) - 1]);
  }
}

/** F0x8008D9BC(self, aux, flag): fill the pane for the highlighted form (flag set) or hide it. */
export function labRosterFill(mem: LabRosterMemory, self: number, aux: number, flag: number, host: LabRosterHost): void {
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const word = (offset: number): number => u32(mem.read32(aux + offset));
  const first = s32(mem.read32(self + 0x158));
  const row = s32(mem.read32(self + 0x160));

  if (flag === 0) {
    const children = u32(mem.read32(self + 0x24));
    const count = s32(mem.read32(self + 0x20)) - 2;
    for (let i = 0; i < count; i++) {
      const widget = u32(mem.read32(children + i * 4));
      if (widget !== 0) m(widget, 0x144, [0]);
    }
    return;
  }

  const slot = s32(mem.read32(self + 0x54));
  m(word(0x00), 0x114, [bank(0x39), s32(mem.read32(self + 0x15c)) === 0 ? 0x1e : 0x1f]);
  const record = (slot * 0x3dc + LAB_RECORDS) >>> 0;
  for (let k = 0; k < 3; k++) {
    const form = s32(mem.read32(self + (first + k) * 4 + 0x90));
    const label = word(0x04 + 4 * k);
    if (form < 3) {
      if (k === 0) m(label, 0x114, [bank(0x39), 0x1b]);
      else m(label, 0x144, [0]);
    } else {
      const names = bank(0x4e);
      m(label, 0x114, [names, mem.read8(u32(host.profileRecord(form)) + 0x55)]);
      m(label, 0x138, [s32(mem.read32(record + 8)) === form ? 1 : 0]);
    }
  }

  const form = s32(mem.read32(self + (first + row) * 4 + 0x90));
  if (form === 0) {
    m(word(0x10), 0x144, [0]);
    m(word(0x14), 0x144, [0]);
    for (let k = 0; k < 14; k++) m(word(0x30 + 4 * k), 0x144, [0]);
    return;
  }
  const entry = host.scratch(0);
  const stats = host.scratch(1);
  host.formEntryCopy(slot, form, entry);
  host.effectiveStats(slot, stats);
  const profile = u32(host.profileRecord(form));
  m(word(0x10), 0x114, [bank(0x4e), mem.read8(profile + 0x55)]);
  m(word(0x14), 0x114, [bank(0x39), 0x13]);
  m(word(0x64), 0x118, [0, (mem.read8(entry + 2) << 24) >> 24]);
  // The shared walk (ui/stat-panel.ts), with this screen's own difference: it adds
  // the species record's base values (profile+0x02..+0x1A, read `lhu`) to the
  // block's, tests each core number's mark as it writes it, and leaves the enable
  // pass to the fourteen-widget loop below.
  const addend: number[] = [];
  for (let i = 0; i < 13; i++) addend.push(mem.read16(profile + 2 + 2 * i));
  fillStatPanel(mem, {
    widget: (index: number): number => word(0x30 + 4 * index),
    setNumber: (target: number, value: number): void => { m(target, 0x118, [0, value]); },
    setEnabled: (target: number): void => { m(target, 0x148, [1]); },
    setMark: (target: number, code: number): void => { m(target, 0x138, [code]); },
  }, stats, { cap: true, marks: "inline-core", pass: "none", addend });
  for (let i = 0; i < 6; i++) {
    const technique = mem.read16(entry + 8 + 2 * i);
    const label = word(0x18 + 4 * i);
    if (mem.read16s(entry + 8 + 2 * i) !== 0) {
      m(label, 0x114, [bank(0xa2), technique & 0x1fff]);
      m(label, 0x138, [(technique & 0x8000) !== 0 ? 3 : (technique & 0x4000) !== 0 ? 4 : 0]);
    } else {
      m(label, 0x144, [0]);
    }
  }
  for (let k = 0; k < 14; k++) m(word(0x30 + 4 * k), 0x148, [1]);
}

/** F0x8008DFA0(self): fold the pane shut, hide its widgets and cursor, take the next phase. */
export function labRosterHide(mem: LabRosterMemory, self: number, host: LabRosterHost): void {
  const aux = u32(mem.read32(self + 0x24));
  host.foldStart((self + 0x80) >>> 0, 0);
  labRosterFill(mem, self, aux, 0, host);
  host.callMethod(u32(mem.read32(aux + 0x68)), 0x80, [0]);
  mem.write32(self + 0x10, u32(mem.read32(self + 0x10) + 1));
}

const repeating = (host: LabPadHost, bit: number): boolean =>
  padBitOf(host, "padPressed", bit) || padBitOf(host, "padRepeat", bit);

/** F0x8008E018(self, aux): the pane's state machine. */
export function labRosterTick(mem: LabRosterMemory, self: number, aux: number, host: LabRosterHost): void {
  const r = (off: number): number => s32(mem.read32(self + off));
  const w = (off: number, value: number): void => mem.write32(self + off, u32(value));
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const cursor = (): number => u32(mem.read32(aux + 0x68));
  const phase = u32(r(0x10));
  switch (phase > 5 ? 0 : phase) {
    case 0:
      host.foldStart((self + 0x80) >>> 0, 1);
      w(0x10, r(0x10) + 1);
      break;
    case 1:
      if (host.foldTick((self + 0x80) >>> 0) !== 0) {
        labRosterFill(mem, self, aux, 1, host);
        m(cursor(), 0x80, [1]);
        if (r(0x15c) >= 4) {
          const bar = labCapsuleCreate(mem, host);
          mem.write32(aux + 0x6c, bar);
          m(bar, 0x8c, [0x122, 0xc]);
          m(u32(mem.read32(aux + 0x6c)), 0x90, [0x35, 0x55]);
          m(u32(mem.read32(aux + 0x6c)), 0x94, [3, r(0x15c)]);
          m(u32(mem.read32(aux + 0x6c)), 0x98, [r(0x160)]);
        }
        w(0x10, r(0x10) + 1);
      }
      break;
    case 2: {
      if (r(0x15c) > 0) {
        const cursorBefore = r(0x160);
        const firstBefore = r(0x158);
        if (repeating(host, 4)) {
          w(0x160, r(0x160) - 1);
          if (r(0x160) < 0) {
            w(0x160, 0);
            w(0x158, r(0x158) - 1);
            if (r(0x158) < 0) w(0x158, 0);
          }
        } else if (repeating(host, 6)) {
          if (r(0x15c) >= 3) {
            w(0x160, r(0x160) + 1);
            if (r(0x160) >= 3) {
              w(0x160, 2);
              w(0x158, r(0x158) + 1);
              const last = r(0x15c) - 3;
              if (last < r(0x158)) w(0x158, last);
            }
          } else {
            const last = r(0x15c) - 1;
            w(0x160, r(0x160) + 1);
            if (last < r(0x160)) w(0x160, last);
          }
        }
        const bar = u32(mem.read32(aux + 0x6c));
        if (bar !== 0 && firstBefore !== r(0x158)) m(bar, 0x98, [r(0x158)]);
        if (cursorBefore !== r(0x160) || firstBefore !== r(0x158)) {
          host.playSound(0x8004513e);
          labRosterFill(mem, self, aux, 1, host);
          m(cursor(), 0x84, [0x9a, r(0x160) * 0xe + 0x31]);
        }
      }
      if (r(0x16c) !== 0 && padBitOf(host, "padPressed", 0xe)) {
        host.playSound(0x800450bd);
        labRosterHide(mem, self, host);
        const bar = u32(mem.read32(aux + 0x6c));
        if (bar !== 0) mem.write32(bar + 0x0c, 3);
      }
      break;
    }
    case 3:
      if (host.foldTick((self + 0x80) >>> 0) !== 0) m(self, 0x28, [3]);
      break;
    case 4:
      m(cursor(), 0x80, [0]);
      break;
    case 5:
      m(cursor(), 0x80, [1]);
      w(0x10, 2);
      break;
  }
  w(0x78, r(0x88));
  w(0x68, r(0x88));
}

/** F0x8008E8D0(self, aux): the pane's lifecycle. */
export function labRosterLifecycle(mem: LabRosterMemory, self: number, aux: number, host: LabRosterHost): void {
  const state = s32(mem.read32(self + 0x0c));
  if (state === 1) {
    labRosterTick(mem, self, aux, host);
    labRosterDraw(mem, self, host);
    return;
  }
  if (state >= 2 && state < 4) return;
  host.callMethod(self, 0x38, []);
  const slot = s32(mem.read32(self + 0x54));
  const equipped = host.scratch(2);
  host.equippedForms(slot, equipped);
  for (let i = 0; i < 3; i++) {
    const form = mem.read16s(equipped + i * 2);
    if (form < 3) break;
    const count = s32(mem.read32(self + 0x15c));
    mem.write32(self + count * 4 + 0x90, u32(form));
    mem.write32(self + 0x15c, u32(count + 1));
  }
  if (s32(mem.read32(self + 0x50)) !== 0) {
    const acquired = host.scratch(3);
    host.acquiredForms(slot, acquired);
    for (let i = 0; i < 0x2c; i++) {
      const form = mem.read16s(acquired + i * 2);
      if (form >= 3 && s32(mem.read32(self + 0x90)) !== form && s32(mem.read32(self + 0x94)) !== form &&
          s32(mem.read32(self + 0x98)) !== form) {
        const count = s32(mem.read32(self + 0x15c));
        mem.write32(self + count * 4 + 0x90, u32(form));
        mem.write32(self + 0x15c, u32(count + 1));
      }
    }
  }
  labRosterTexts(mem, self, aux, host);
  const cursor = host.createCursor(s32(mem.read32(self + 0x58)), s32(mem.read32(self + 0x5c)) - 1, 0x9a,
    s32(mem.read32(self + 0x160)) * 0xe + 0x31) >>> 0;
  mem.write32(aux + 0x68, cursor);
  host.callMethod(cursor, 0x80, [0]);
  mem.write32(self + 0x60, 0xa);
  mem.write32(self + 0x70, 0xa);
  mem.write32(self + 0x80, 0xa);
}

/** F0x8008E4CC(self): the pane's pictures. */
export function labRosterDraw(mem: LabRosterMemory, self: number, host: LabRosterHost): void {
  const r = (off: number): number => s32(mem.read32(self + off));
  const pack = (handle: number): number => u32(host.packResolve(handle));
  host.initDrawContext();
  host.setOrigin(0x280, 0x100);
  host.setLayer(r(0x58), r(0x5c));
  if (r(0x68) !== 0x1000) {
    host.setScale(u32(r(0x68)), 0x1000, 0x1000);
    host.setPos(0x140, 0x15);
  }
  host.drawSprite(pack(LAB_PACK_STDGLABO), 0x20, 0x92, 0xf);
  if (r(0x78) !== 0x1000) {
    host.setScale(u32(r(0x78)), 0x1000, 0x1000);
    host.setPos(0x140, 0x45);
  } else host.setScale(0x1000, 0x1000, 0x1000);
  if (r(0x78) === 0x1000) {
    if (s32(host.frameTick()) - r(0x164) >= 8) {
      mem.write32(self + 0x164, u32(host.frameTick()));
      mem.write32(self + 0x168, u32(1 - r(0x168)));
    }
    if (r(0x168) !== 0) {
      if (r(0x158) !== 0) host.drawSprite(pack(LAB_PACK_STDGLABO), 0x34, 0x123, 0x2d);
      if (r(0x158) < r(0x15c) - 3) host.drawSprite(pack(LAB_PACK_STDGLABO), 0x35, 0x123, 0x55);
    }
  }
  host.drawSprite(pack(LAB_PACK_STDGLABO), 0x22, 0x92, 0x2a);
  if (r(0x15c) > 0) {
    if (r(0x88) !== 0x1000) {
      host.setScale(u32(r(0x78)), 0x1000, 0x1000);
      host.setPos(0x140, 0xa4);
    } else host.setScale(0x1000, 0x1000, 0x1000);
    host.drawSprite(pack(LAB_PACK_STDGLABO), 0x2a, 0x54, 0x64);
    host.setOrigin(0x140, 0);
    host.setLayer(r(0x58), r(0x5c) - 1);
    host.drawSprite(pack(LAB_PACK_CMFONT), 0x14, 0x5b, 0x7f);
    const entry = host.scratch(4);
    host.formEntryCopy(r(0x54), s32(mem.read32(self + (r(0x158) + r(0x160)) * 4 + 0x90)), entry);
    for (let i = 0; i < 6; i++) {
      if (mem.read16s(entry + 8 + 2 * i) !== 0) {
        const technique = mem.read16(entry + 8 + 2 * i) & 0x1fff;
        const clip = mem.read8(LAB_TECHNIQUE_TABLE + (technique - 1) * 0x12 + 4) + 0x37;
        host.drawSprite(pack(LAB_PACK_CMFONT), clip, 0xb4, 0x8b + 0xe * i);
      }
    }
  }
}
