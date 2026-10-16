// The lab's Switch Digimon screen: pick which stored partner stands in the party, or look one over
// before swapping. Translated from the original pro/stgdglab bodies.
//
// Oracle: tests/lane-b/lab-switch.test.js runs each original through engine/native and compares the
// ordered boundary calls, the return values and the object memory.
//
//   F0x8008C230 labSwitchCreate    (root) factory(handler F0x8008C060, 0x108, extra 0x38); +0x54 =
//                                  0x1000, +0x58 = 2, +0x50 = the root.
//   F0x8008C060 labSwitchLifecycle state 1 runs the tick then the draw; states 2 and 3 idle; any
//                                  other state builds the candidate list: every owned roster slot not
//                                  standing in the party (+0xE4.. one word each, -1 = none, count in
//                                  +0x104), one more when the highlighted party member can be swapped out.
//   F0x8008A92C labSwitchTexts     create on first use and fill the five option labels, the five
//                                  statistic numbers (or their placeholders), the name plate and its colour.
//   F0x8008AD18 labSwitchHide      hide every child widget but the last.
//   F0x8008AD98 labSwitchDraw      the screen's pictures and its two idle animations.
//   F0x8008B798 labSwitchTick      the state machine: fold the panes open, browse the candidates
//                                  (+0x60 the cursor, +0x14 the outcome: 0 back, 1 swap, 2 look), swap
//                                  by writing the party map word of the root's highlighted position,
//                                  open the roster picker for a look, fold shut.
//
// Object (0x108 bytes, children block 0x38): +0x10 phase, +0x14 outcome, +0x50 root, +0x54 layer,
// +0x58 bucket, +0x5C pane shift (1 = low, 0 = high, 0x7A pixels), +0x60 cursor, +0x64/+0x74/+0x84/+0x94/
// +0xA4 five window folds (value at +8: +0x6C, +0x7C, +0x8C, +0x9C, +0xAC), +0xC4/+0xC8 animation timers,
// +0xCC.. per party position idle frame, +0xD8 candidate idle frame, +0xDC/+0xE0 colour cycles,
// +0xE4.. candidates, +0x104 candidate count. Children: +0x00 title, +0x04.. five labels, +0x18..
// five numbers, +0x2C name plate, +0x30 colour or prompt, +0x34 the roster picker (while open).
import { labRosterCreate } from "./lab-roster.ts";
import { padBitOf, type LabPadHost } from "./lab-pad.ts";
import { LAB_LABEL_TABLE_CELL } from "./lab-select-labels.ts";
import { advanceDigimonPictures, digimonPictureAt, DIGIMON_PICTURE_ROW_WORDS } from "../digimon-picture.ts";
import type { LabRosterHost, LabRosterMemory } from "./lab-roster.ts";
import { DISC_ROSTER_SLOT_COUNT, ROSTER_SLOT_COUNT } from "../../roster.ts";
import { rosterRecordAddress } from "../../roster-records.ts";

export const LAB_SWITCH_HANDLER = 0x8008c060;
export const LAB_SWITCH_SIZE = 0x108;
/**
 * EXTRA: the candidate list holds one word per roster slot, +0xE4.. for the disc's eight
 * (the count follows them at +0x104). With new partners (engine/dw3/roster.ts) the list
 * continues past the original object, which then gets this many more bytes; with only the
 * disc's eight the object is exactly the original's.
 */
const extraCandidateBytes = (): number =>
  ROSTER_SLOT_COUNT > DISC_ROSTER_SLOT_COUNT ? (ROSTER_SLOT_COUNT + 1 - DISC_ROSTER_SLOT_COUNT) * 4 : 0;
/**
 * The candidate word `i`: +0xE4 + 4i, the original's own arithmetic whatever `i` is, while only the
 * disc's eight slots exist; with new partners, the words after the eighth move past the original object.
 */
const candidateAt = (self: number, i: number): number =>
  (ROSTER_SLOT_COUNT <= DISC_ROSTER_SLOT_COUNT || i < DISC_ROSTER_SLOT_COUNT
    ? self + 0xe4 + i * 4 : self + LAB_SWITCH_SIZE + (i - DISC_ROSTER_SLOT_COUNT) * 4) >>> 0;
export const LAB_SWITCH_EXTRA = 0x38;
export const LAB_ANIMATION_CELL = 0x8008fd68;
export const LAB_STAT_INDEX_TABLE_B = 0x8008f4a4;
export const LAB_PARTY_MAP = 0x80048d34 + 0x70;
const LANGUAGE = 0x8005cca8;
const PACK = 0x02c50000;
const FONT_PACK = 0x02860000;

export type LabSwitchHost = LabRosterHost & {
  /** ctx+0x2728(position): the roster slot standing at a party position, negative when none. */
  followerSlot(position: number): number;
  /** ctx+0x2718(position). */
  partnerSlot(position: number): number;
  recordPointer(slot: number): number;
};

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

export function labSwitchCreate(
  mem: LabRosterMemory, host: Pick<LabSwitchHost, "alloc">, root: number,
): number {
  const obj = host.alloc(LAB_SWITCH_HANDLER, LAB_SWITCH_SIZE + extraCandidateBytes(), LAB_SWITCH_EXTRA) >>> 0;
  mem.write32(obj + 0x54, 0x1000);
  mem.write32(obj + 0x58, 2);
  mem.write32(obj + 0x50, u32(root));
  return obj;
}

/** F0x8008AD18(self): hide every child widget but the last. */
export function labSwitchHide(mem: LabRosterMemory, self: number, host: Pick<LabSwitchHost, "callMethod">): void {
  const children = u32(mem.read32(self + 0x24));
  const count = s32(mem.read32(self + 0x20)) - 1;
  for (let i = 0; i < count; i++) {
    const widget = u32(mem.read32(children + i * 4));
    if (widget !== 0) host.callMethod(widget, 0x144, [0]);
  }
}

/** F0x8008A92C(self, aux): create and fill the labels, numbers and name plate. */
export function labSwitchTexts(mem: LabRosterMemory, self: number, aux: number, host: LabSwitchHost): void {
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const table = u32(mem.read32(LAB_LABEL_TABLE_CELL));
  const shift = (): number => s32(mem.read32(self + 0x5c)) * 0x7a;
  const ensure = (word: number, kind: number, record: number): void => {
    if (mem.read32(aux + word) === 0) {
      const widget = host.createText(s16(mem.read32(self + 0x54)), kind, s16(mem.read16s(record + 4)), s16(mem.read16s(record + 8))) >>> 0;
      mem.write32(aux + word, widget);
      m(widget, 0x15c, [s32(mem.read32(self + 0x58)) - 1]);
    }
  };
  const place = (word: number, record: number): void =>
    m(u32(mem.read32(aux + word)), 0x134, [mem.read16s(record + 4), s16(mem.read16s(record + 8) + shift())]);

  for (let i = 0; i < 5; i++) {
    const record = (table + i * 0xc) >>> 0;
    ensure(4 + 4 * i, 3, record);
    m(u32(mem.read32(aux + 4 + 4 * i)), 0x114, [bank(0x39), s32(mem.read32(record))]);
    place(4 + 4 * i, record);
  }
  const slot = s32(mem.read32(candidateAt(self, s32(mem.read32(self + 0x60)))));
  const stats = host.scratch(0);
  if (slot >= 0) host.effectiveStats(slot, stats);
  for (let i = 0; i < 5; i++) {
    const record = (table + 0x3c + i * 0xc) >>> 0;
    ensure(0x18 + 4 * i, 3, record);
    place(0x18 + 4 * i, record);
    const widget = u32(mem.read32(aux + 0x18 + 4 * i));
    if (slot < 0) m(widget, 0x114, [bank(0x39), i === 0 ? 0x1c : 0x12]);
    else m(widget, 0x118, [0, mem.read16s(stats + 2 * s32(mem.read32(LAB_STAT_INDEX_TABLE_B + 4 * i)))]);
    m(u32(mem.read32(aux + 0x18 + 4 * i)), 0x148, [1]);
  }
  const plate = (table + 0x78) >>> 0;
  ensure(0x2c, 1, plate);
  if (slot < 0) {
    m(u32(mem.read32(aux + 0x2c)), 0x114, [bank(0x39), 0x1b]);
    m(u32(mem.read32(aux + 0x30)), 0x138, [7]);
  } else {
    m(u32(mem.read32(aux + 0x2c)), 0x114, [host.recordPointer(slot), -1]);
    m(u32(mem.read32(aux + 0x30)), 0x138, [0]);
  }
  place(0x2c, plate);
  mem.write32(self + 0xd8, 0);
}

/** The picture the highlighted candidate and the party figures are showing now. */
const animationClip = (mem: LabRosterMemory, slot: number, counter: number): number =>
  digimonPictureAt(mem, LAB_ANIMATION_CELL, slot, counter);

/** F0x8008AD98(self): the screen's pictures and its two idle animations. */
export function labSwitchDraw(mem: LabRosterMemory, self: number, host: LabSwitchHost): void {
  const r = (off: number): number => s32(mem.read32(self + off));
  const w = (off: number, value: number): void => mem.write32(self + off, u32(value));
  const pack = (handle: number): number => u32(host.packResolve(handle));
  const root = u32(mem.read32(self + 0x50));
  const rows = (): number => s32(mem.read32(root + 0x5c));
  const slot = s32(mem.read32(candidateAt(self, r(0x60))));
  const shift = r(0x5c) * 0x7a;
  const unit = (): void => host.setScale(0x1000, 0x1000, 0x1000);
  // The candidate (0xD8) caps the row at seven words; the party figures (0xCC,
  // stride 4) restart only at the -1 marker, as F0x8008AD98 does. Both run under
  // the one timer at 0xC4.
  advanceDigimonPictures({
    mem,
    tableCell: LAB_ANIMATION_CELL,
    timer: self + 0xc4,
    cadence: 0xc,
    frame: () => s32(host.frameTick()),
    groups: [
      { counterBase: self + 0xd8, count: 1, rowAt: () => slot, skipNegativeRow: true, wrapAt: DIGIMON_PICTURE_ROW_WORDS },
      {
        counterBase: self + 0xcc,
        count: rows(),
        rowAt: (i) => s32(host.followerSlot(i)),
        skipNegativeRow: true,
      },
    ],
  });
  if (s32(host.frameTick()) - r(0xc8) >= 0xa) {
    w(0xc8, host.frameTick());
    const colour = r(0xdc) + 1;
    w(0xdc, colour);
    if (colour >= 4) w(0xdc, 0);
    const cel = r(0xe0) + 1;
    w(0xe0, cel);
    if (cel >= 6) w(0xe0, 0);
  }
  host.initDrawContext();
  host.setOrigin(0x280, 0x100);
  host.setLayer(r(0x54), r(0x58));
  if (r(0x6c) !== 0) {
    if (r(0x6c) !== 0x1000) {
      host.setScale(u32(r(0x6c)), 0x1000, 0x1000);
      host.setPos(0, shift + 0x2f);
    } else unit();
    if (slot >= 0) host.drawSprite(pack(PACK), animationClip(mem, slot, r(0xd8)), 0x10, shift + 0x16);
    host.setOrigin(0x140, 0);
    host.drawSprite(pack(FONT_PACK), 0xe, 0, shift + 0x13);
    host.setOrigin(0x280, 0x100);
    host.drawSprite(pack(PACK), 0x1e, 0, shift + 0x13);
  }
  if (r(0x7c) !== 0) {
    if (r(0x7c) !== 0x1000) {
      host.setScale(u32(r(0x7c)), 0x1000, 0x1000);
      host.setPos(0, 0xd1);
    } else unit();
    host.drawSprite(pack(PACK), 0x26, 0, 0xc4);
  }
  if (r(0x8c) !== 0) {
    if (r(0x8c) !== 0x1000) {
      host.setScale(u32(r(0x8c)), 0x1000, 0x1000);
      host.setPos(0x140, 0x15);
    } else unit();
    host.drawSprite(pack(PACK), 0x20, 0x92, 0xf);
  }
  if (r(0xac) !== 0) {
    if (r(0xac) !== 0x1000) {
      host.setScale(u32(r(0xac)), 0x1000, 0x1000);
    } else {
      unit();
      if (r(0x104) >= 2) {
        host.setLayer(r(0x54), r(0x58) - 1);
        host.paletteShift(r(0xdc));
        host.drawSprite(pack(PACK), 0x31, 0xb8, 0xb6);
        host.drawSprite(pack(PACK), 0x32, 0x100, 0xb6);
        host.setLayer(r(0x54), r(0x58));
        host.paletteShift(0);
      }
    }
    let party = 0;
    if (rows() > 0) {
      do {
        const follower = s32(host.followerSlot(party));
        if (follower >= 0) {
          if (r(0xac) !== 0x1000) host.setPos(0xb4 + 0x30 * party, 0x4e);
          host.drawSprite(pack(PACK), animationClip(mem, follower, r(0xcc + 4 * party)), 0xa5 + 0x30 * party, 0x47);
        }
        party += 1;
      } while (party < rows());
    }
    if (slot >= 0) {
      if (r(0xac) !== 0x1000) host.setPos(0xe4, 0xb5);
      host.drawSprite(pack(PACK), animationClip(mem, slot, r(0xd8)), 0xd5, 0xae);
    }
  }
  if (r(0x9c) !== 0) {
    if (r(0x9c) !== 0x1000) {
      host.setScale(u32(r(0x9c)), 0x1000, 0x1000);
      host.setPos(0x140, 0x85);
    } else unit();
    host.setOrigin(0x280, 0x100);
    host.setLayer(r(0x54), r(0x58) - 1);
    host.drawSprite(pack(PACK), 0x33, 0xad, 0x66);
    host.paletteShift(r(0xdc));
    host.drawSprite(pack(PACK), s32(mem.read32(root + 0x64)) + 0x38, 0xa5, 0x41);
    host.paletteShift(0);
    host.setOrigin(0x140, 0);
    host.drawSprite(pack(FONT_PACK), 0x10, 0x90, 0x25);
    host.drawSprite(pack(FONT_PACK), 0xb, 0xd5, 0x92);
    host.setLayer(r(0x54), r(0x58));
    host.drawSprite(pack(FONT_PACK), 0x11, 0x90, 0x25);
    host.drawSprite(pack(FONT_PACK), 0xc, 0xd5, 0x92);
    host.setOrigin(0x280, 0x100);
    host.drawSprite(pack(PACK), 0x2d, 0x90, 0x2a);
    if (r(0x9c) !== 0x1000) host.setPos(0x48, 0x69);
    host.paletteShift(r(0xe0));
    host.drawSprite(pack(PACK), 0x3b, 0x33, 0x4a);
  }
}

const repeating = (host: LabPadHost, bit: number): boolean =>
  padBitOf(host, "padPressed", bit) || padBitOf(host, "padRepeat", bit);

/** F0x8008B798(self, aux): the screen's state machine. */
export function labSwitchTick(mem: LabRosterMemory, self: number, aux: number, host: LabSwitchHost): void {
  const r = (off: number): number => s32(mem.read32(self + off));
  const w = (off: number, value: number): void => mem.write32(self + off, u32(value));
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LANGUAGE)) + offset);
  const advance = (): void => w(0x10, r(0x10) + 1);
  const root = u32(mem.read32(self + 0x50));
  const fold = (offset: number): number => (self + offset) >>> 0;
  const candidate = (): number => s32(mem.read32(candidateAt(self, r(0x60))));

  const phase = u32(r(0x10));
  switch (phase > 11 ? 0 : phase) {
    case 0:
      host.foldStart(fold(0x74), 1);
      host.foldStart(fold(0x84), 1);
      advance();
      return;
    case 1:
      host.foldTick(fold(0x74));
      if (host.foldTick(fold(0x84)) !== 0) {
        host.foldStart(fold(0x64), 1);
        host.foldStart(fold(0x94), 1);
        if (mem.read32(aux) === 0) mem.write32(aux, host.createText(s32(mem.read32(self + 0x54)), 1, 0xae, 0x15));
        m(u32(mem.read32(aux)), 0x114, [bank(0x39), 0x1d]);
        if (mem.read32(aux + 0x30) === 0) mem.write32(aux + 0x30, host.createText(s32(mem.read32(self + 0x54)), 1, 0xf, 0xcc));
        m(u32(mem.read32(aux + 0x30)), 0x114, [bank(0x39), 0x14]);
        m(u32(mem.read32(aux + 0x30)), 0x138, [r(0x104) === 0 ? 7 : 0]);
        advance();
      }
      return;
    case 2:
      host.foldTick(fold(0x64));
      if (host.foldTick(fold(0x94)) !== 0) {
        host.foldStart(fold(0xa4), 1);
        labSwitchTexts(mem, self, aux, host);
        advance();
      }
      return;
    case 3:
      if (host.foldTick(fold(0xa4)) !== 0) advance();
      return;
    case 4: {
      const before = r(0x60);
      if (r(0x104) >= 2) {
        if (repeating(host, 7)) {
          w(0x60, r(0x60) - 1);
          if (r(0x60) < 0) w(0x60, r(0x104) - 1);
        } else if (repeating(host, 5)) {
          w(0x60, r(0x60) + 1);
          if (r(0x104) - 1 < r(0x60)) w(0x60, 0);
        }
      }
      if (before !== r(0x60)) {
        host.playSound(0x4001b);
        labSwitchTexts(mem, self, aux, host);
        return;
      }
      if (padBitOf(host, "padPressed", 0xc)) {
        if (candidate() >= 0) {
          w(0x14, 2);
          advance();
          host.playSound(0x4001c);
          return;
        }
      } else {
        if (padBitOf(host, "padPressed", 0xd)) {
          if (s32(host.partnerSlot(s32(mem.read32(root + 0x64)))) >= 0 || candidate() >= 0) {
            w(0x14, 1);
            advance();
            host.playSound(0x4001c);
            return;
          }
          host.playSound(0x800450bd);
          return;
        }
        if (padBitOf(host, "padPressed", 0xe)) {
          host.playSound(0x800450bd);
          w(0x14, 0);
          advance();
          return;
        }
      }
      return;
    }
    case 5:
      host.foldStart(fold(0xa4), 0);
      advance();
      return;
    case 6:
      if (host.foldTick(fold(0xa4)) !== 0) {
        labSwitchHide(mem, self, host);
        for (const offset of [0x64, 0x74, 0x84, 0x94]) host.foldStart(fold(offset), 0);
        if (r(0x14) !== 0) m(root, 0x6c, []);
        advance();
      }
      return;
    case 7:
      host.foldTick(fold(0x64));
      host.foldTick(fold(0x74));
      host.foldTick(fold(0x84));
      if (host.foldTick(fold(0x94)) !== 0) {
        if (s32(host.callMethod(root, 0x70, [])) !== 0) advance();
      }
      return;
    case 8:
      if (r(0x14) === 1) {
        mem.write32(LAB_PARTY_MAP + s32(mem.read32(root + 0x64)) * 4, u32(candidate()));
        m(root, 0x74, []);
      }
      if (r(0x14) === 2) {
        w(0x5c, 0);
        host.foldStart(fold(0x64), 1);
        if (mem.read32(aux + 0x34) === 0) {
          mem.write32(aux + 0x34, labRosterCreate(mem, host, s32(mem.read32(candidateAt(self, r(0x60)))), 1, 1));
        }
        advance();
        return;
      }
      m(self, 0x28, [3]);
      return;
    case 9:
      if (host.foldTick(fold(0x64)) !== 0) {
        labSwitchTexts(mem, self, aux, host);
        advance();
      }
      return;
    case 10:
      if (s32(mem.read32(u32(mem.read32(aux + 0x34)) + 0x10)) >= 2) {
        if (padBitOf(host, "padPressed", 0xe)) {
          host.foldStart(fold(0x64), 0);
          labSwitchHide(mem, self, host);
          advance();
        }
      }
      return;
    case 11:
      if (host.foldTick(fold(0x64)) !== 0 && mem.read32(aux + 0x34) === 0) {
        if (s32(host.callMethod(root, 0x70, [])) !== 0) {
          m(root, 0x68, []);
          advance();
        }
        w(0x5c, 1);
        m(self, 0x2c, [0]);
      }
      return;
  }
}

/** F0x8008C060(self, aux): the screen's lifecycle. */
export function labSwitchLifecycle(mem: LabRosterMemory, self: number, aux: number, host: LabSwitchHost): void {
  const state = s32(mem.read32(self + 0x0c));
  if (state === 1) {
    labSwitchTick(mem, self, aux, host);
    labSwitchDraw(mem, self, host);
    return;
  }
  if (state >= 2 && state < 4) return;
  host.callMethod(self, 0x38, []);
  mem.write32(self + 0x64, 0xa);
  mem.write32(self + 0x74, 8);
  mem.write32(self + 0x84, 0xa);
  mem.write32(self + 0x94, 0xa);
  mem.write32(self + 0xa4, 8);
  mem.write32(self + 0x5c, 1);
  const standing = host.scratch(0);
  for (let i = 0; i < 3; i++) mem.write32(standing + i * 4, u32(host.followerSlot(i)));
  // every roster slot: the disc's eight, then the new partners' (their records are in their own window)
  const slots = Math.max(DISC_ROSTER_SLOT_COUNT, ROSTER_SLOT_COUNT);
  for (let i = 0; i < slots; i++) {
    const slot = s32(mem.read32(rosterRecordAddress(i))) - 3;
    mem.write32(candidateAt(self, i), 0xffffffff);
    let free = false;
    if (slot >= 0) {
      free = true;
      for (let k = 0; k < 3; k++) {
        const at = s32(mem.read32(standing + k * 4));
        if (at >= 0 && slot === at) free = false;
      }
    }
    if (free) {
      const count = s32(mem.read32(self + 0x104));
      mem.write32(candidateAt(self, count), u32(slot));
      mem.write32(self + 0x104, u32(count + 1));
    }
  }
  const root = u32(mem.read32(self + 0x50));
  if (s32(mem.read32(root + 0x60)) >= 2 && s32(mem.read32(standing + s32(mem.read32(root + 0x64)) * 4)) >= 0) {
    const count = s32(mem.read32(self + 0x104));
    // the extra entry is the "put nobody here" row: with the disc's eight the loop has already left it -1
    if (ROSTER_SLOT_COUNT > DISC_ROSTER_SLOT_COUNT && count >= slots) mem.write32(candidateAt(self, count), 0xffffffff);
    mem.write32(self + 0x104, u32(count + 1));
  }
}
