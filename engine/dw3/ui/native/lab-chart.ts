// The Digimon lab's Digivolve Chart screen, translated from the original pro/stgdglab bodies:
// the constructor, the requirement helpers, the branch cursor, the panel draw and the state machine.
//
// Oracle: tests/lane-b/lab-chart.test.js runs each original through engine/native over the shipped
// overlay data (the per-species requirement tables at 0x8008FD68[slot]+8, the species table at
// 0x8008F628) and compares the ordered boundary calls, the return values and the object memory.
//
//   F0x80085408 labChartCreate        factory(handler F0x800842F4, 0x29C, extra 0x1C); +0x54 = 0x1000,
//                                     +0x58 = 2, +0x50 = the root; the root's +0x6C hides Select Action.
//   F0x80083334 labChartReload        copy one row's present requirement forms into page a, row c.
//   F0x80083484 labChartRowPresent    1 when the first positive requirement of a row is in the
//                                     partner's form list, else 0.
//   F0x80083550 labChartPageTotal     the number of present rows (sum of labChartRowPresent over 4).
//   F0x800835CC labChartSeekFirst     park the cursor on the first filled entry of the first row.
//   F0x800841E4 labChartMoveRow       step the row cursor by +-1, skipping rows with no entries.
//   F0x8008365C labChartDraw          the chart's pictures.
//   F0x800842F4 labChartTick          the screen's state machine (see the case comments).
//
// Object (0x29C bytes, children block 0x1C = seven words):
//   +0x50 root, +0x54 text layer (0x1000), +0x58 bucket (2), +0xB8 count of the partner's forms,
//   +0xBC the partner's roster slot, +0xC0 the page, +0xC4 page count (4), +0xC8 pending page,
//   +0xCC the rows on the page, +0xD0 + page*0x50 + row*0x14 + entry*4 the chart entries (a form id,
//   0 = absent, -1 on the first entry = the page has no entries), +0x210 + page*4 "page complete"
//   flag, +0x220 + page*4 the number of requirement forms the partner owns, +0x230 / 0x240 / 0x250 /
//   0x260 / 0x270 five window folds (value word at +8), +0x280 / +0x284 the page arrows, +0x288 the
//   arrow-cel timer, +0x28C the cel (0..3), +0x290 the column, +0x294 the row, +0x60 the partner's form
//   list (halfwords).
import { labSpeciesWord1 as labSpeciesWordOne } from "./lab-tables.ts";
import { padBitOf, type LabPadHost } from "./lab-pad.ts";
import type { SelectDrawHost } from "./select-action.ts";

export const LAB_CHART_HANDLER = 0x800842f4;
export const LAB_CHART_SIZE = 0x29c;
export const LAB_CHART_EXTRA = 0x1c;
/** The per-slot requirement block pointers (0x8008FD68[slot]; +8 of each is its row table). */
export const LAB_SLOT_BLOCKS = 0x8008fd68;
/** The overlay's roster-slot -> chart root form table (value0 ids). */
export const LAB_ROOT_FORMS = 0x8008f470;
export const LAB_PACK = 0x02c50000;
export const LAB_LANGUAGE_CELL = 0x8005cca8;

export interface LabMemory {
  read8(addr: number): number;
  read16s(addr: number): number;
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

export interface LabChartDrawHost extends SelectDrawHost {
  setDepth(x: number, y: number): void;
}

export interface LabChartHost extends LabPadHost, LabChartDrawHost {
  /** target+slot(target, args...): an object method through its own table; its return value. */
  callMethod(target: number, slot: number, args: number[]): number;
  createText(layer: number, kind: number, x: number, y: number): number;
  foldStart(target: number, direction: number): void;
  /** The fold tick cell (0x8008FD9C), also reached as 0x8008FD68+0x34. */
  foldTick(target: number): number;
  playSound(id: number): void;
  /** [0x80044F4C](language + offset): an indexed text bank. */
  textBank(id: number): number;
  /** ctx+0x2718(position): the roster slot of a party position. */
  partnerSlot(position: number): number;
  /** ctx+0x2740(slot, out): the partner's acquired form ids into out; returns the count. */
  acquiredForms(slot: number, out: number): number;
  /** [0x8004B484](slot): the roster slot's record pointer (its name is read from it). */
  recordPointer(slot: number): number;
  /** [0x8005CCA0](form): the species profile record. */
  profileRecord(form: number): number;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

const rowTable = (mem: LabMemory, chart: number): number =>
  u32(mem.read32(LAB_SLOT_BLOCKS + u32(mem.read32(chart + 0xbc)) * 4 + 8));

/** F0x80085408(root): build the chart. */
export function labChartCreate(
  mem: LabMemory, host: { alloc(h: number, s: number, e: number): number; callMethod(t: number, s: number, a: number[]): number },
  root: number,
): number {
  const chart = host.alloc(LAB_CHART_HANDLER, LAB_CHART_SIZE, LAB_CHART_EXTRA) >>> 0;
  mem.write32(chart + 0x54, 0x1000);
  mem.write32(chart + 0x58, 2);
  mem.write32(chart + 0x50, root >>> 0);
  host.callMethod(root, 0x6c, []);
  return chart;
}

/** F0x80083334(chart, page, group, row): fill one chart row from a requirement group; 5, or 0 for a bad group. */
export function labChartReload(mem: LabMemory & { write32(a: number, v: number): void }, chart: number, page: number, group: number, row: number): number {
  if (u32(group) >= 5) return 0;
  const slotBase = chart + page * 4;
  const entries = chart + page * 0x50 + 0xd0 + row * 0x14;
  const table = rowTable(mem, chart);
  const rowBase = table + (page * 4 + group) * 12;
  mem.write32(slotBase + 0x220, 0);
  for (let e = 0; e < 5; e++) {
    mem.write32(entries + e * 4, 0);
    const value = mem.read16s(rowBase + 2 + e * 2);
    if (value > 0) {
      const count = s32(mem.read32(chart + 0xb8));
      for (let i = 0; i < count; i++) {
        const owned = mem.read16s(chart + 0x60 + i * 2);
        if (owned === value) {
          mem.write32(entries + e * 4, owned >>> 0);
          mem.write32(slotBase + 0x220, u32(mem.read32(slotBase + 0x220) + 1));
          break;
        }
      }
    }
  }
  if (s32(mem.read32(slotBase + 0x220)) < mem.read16s(rowBase)) mem.write32(slotBase + 0x210, 0);
  return 5;
}

/** F0x80083484(chart, page, group): 1 when the group's first positive requirement is among the partner's forms. */
export function labChartRowPresent(mem: LabMemory, chart: number, page: number, group: number): number {
  if (u32(group) >= 5) return 0;
  const table = rowTable(mem, chart);
  const rowBase = table + (page * 4 + group) * 12;
  let first = 0;
  let k = 0;
  // The scan stops at the first positive halfword; it keeps the last value it saw otherwise.
  for (;;) {
    const v = mem.read16s(rowBase + 2 + k * 2);
    k += 1;
    if (v > 0) { first = v; break; }
    if (k >= 5) break;
  }
  if (first === 0) return 0;
  const count = s32(mem.read32(chart + 0xb8));
  for (let i = 0; i < count; i++) {
    if (mem.read16s(chart + 0x60 + i * 2) === first) return 1;
  }
  return 0;
}

/** F0x80083550(chart, page): how many of the page's four groups are present. */
export function labChartPageTotal(mem: LabMemory, chart: number, page: number): number {
  if (u32(page) >= 4) return 0;
  let sum = 0;
  for (let group = 0; group < 4; group++) sum += labChartRowPresent(mem, chart, page, group);
  return sum;
}

/** F0x800835CC(chart): row 0, first filled entry of it (entry 4 when none). */
export function labChartSeekFirst(mem: LabMemory, chart: number): void {
  mem.write32(chart + 0x294, 0);
  mem.write32(chart + 0x290, 0);
  const row = 0;
  const page = s32(mem.read32(chart + 0xc0)) * 0x50;
  if (s32(mem.read32(chart + row * 0x14 + page + 0xd0)) !== 0) return;
  for (;;) {
    const entry = s32(mem.read32(chart + 0x290)) + 1;
    mem.write32(chart + 0x290, u32(entry));
    if (entry >= 5) { mem.write32(chart + 0x290, 4); return; }
    if (s32(mem.read32(chart + entry * 4 + row * 0x14 + page + 0xd0)) !== 0) return;
  }
}

/** F0x800841E4(chart, step): move the row cursor by `step` (clamped), skipping rows with no entries; 1 when it moved. */
export function labChartMoveRow(mem: LabMemory, chart: number, step: number): number {
  const before = s32(mem.read32(chart + 0x294));
  let entry = 0;
  for (;;) {
    let row = s32(mem.read32(chart + 0x294)) + step;
    mem.write32(chart + 0x294, u32(row));
    if (row < 0) {
      mem.write32(chart + 0x294, 0);
    } else {
      const last = s32(mem.read32(chart + 0xcc)) - 1;
      if (last < row) mem.write32(chart + 0x294, u32(last));
    }
    const rowOffset = s32(mem.read32(chart + 0x294)) * 0x14;
    const pageOffset = s32(mem.read32(chart + 0xc0)) * 0x50;
    entry = 0;
    if (s32(mem.read32(chart + rowOffset + pageOffset + 0xd0)) === 0) {
      let at = rowOffset;
      entry = 1;
      for (;;) {
        at += 4;
        if (entry >= 5) break;
        entry += 1;
        if (s32(mem.read32(chart + at + pageOffset + 0xd0)) !== 0) { entry -= 1; break; }
      }
      const filled = chart + (s32(mem.read32(chart + 0x294)) * 5 + entry) * 4 + s32(mem.read32(chart + 0xc0)) * 0x50;
      if (s32(mem.read32(filled + 0xd0)) === 0) continue;
    }
    break;
  }
  if (before !== s32(mem.read32(chart + 0x294))) {
    mem.write32(chart + 0x290, u32(entry));
    return 1;
  }
  return 0;
}

const entryAt = (mem: LabMemory, chart: number, row: number, column: number): number =>
  s32(mem.read32(chart + (row * 5 + column) * 4 + s32(mem.read32(chart + 0xc0)) * 0x50 + 0xd0));

/** F0x8008365C(chart): the chart's pictures for one frame. */
export function labChartDraw(mem: LabMemory, chart: number, host: LabChartDrawHost): void {
  const r = (off: number): number => s32(mem.read32(chart + off));
  const pack = (handle: number): number => u32(host.packResolve(handle));
  const page = r(0xc0);
  let complete = 0;
  if (r(0x210) !== 0 && r(0x214) !== 0 && r(0x218) !== 0) complete = r(0x21c) !== 0 ? 1 : 0;
  const portrait = (form: number): number => labSpeciesWordOne(mem, form);
  const unitScale = (): void => host.setScale(0x1000, 0x1000, 0x1000);

  host.initDrawContext();
  host.setLayer(r(0x54), r(0x58) - 1);
  if (r(0x248) !== 0) {
    const current = entryAt(mem, chart, r(0x294), r(0x290));
    host.setOrigin(0x140, 0x100);
    host.setDepth(0x280, 0);
    host.setScale(r(0x248), 0x1000, 0x1000);
    const upper = r(0x294) < 2;
    host.setPos(0, upper ? 0xc2 : 0x4c);
    if (current !== 0) host.drawSprite(pack(LAB_PACK + 1), portrait(current), 0x14, upper ? 0xaf : 0x39);
    host.setOrigin(0x280, 0x100);
    host.drawSprite(pack(LAB_PACK), 0x42, 0, upper ? 0xa8 : 0x32);
  }
  host.initDrawContext();
  host.setOrigin(0x280, 0x100);
  host.setLayer(r(0x54), r(0x58));
  if (s32(host.frameTick()) - r(0x288) >= 8) {
    mem.write32(chart + 0x288, u32(host.frameTick()));
    const cel = r(0x28c) + 1;
    mem.write32(chart + 0x28c, u32(cel));
    if (cel >= 4) mem.write32(chart + 0x28c, 0);
  }
  host.paletteShift(r(0x28c));
  if (r(0x278) === 0x1000) host.drawSprite(pack(LAB_PACK), 0x47, r(0x290) * 0x28 + 0x4a, r(0x294) * 0x2e + 0x32);
  if (r(0x280) !== 0) host.drawSprite(pack(LAB_PACK), 0x45, 0x17, 0xc9);
  if (r(0x284) !== 0) host.drawSprite(pack(LAB_PACK), 0x46, 0x110, 0xc9);
  host.paletteShift(0);
  if (r(0x238) !== 0x1000) {
    host.setScale(u32(r(0x238)), 0x1000, 0x1000);
    host.setPos(0, 0x1f);
  }
  host.drawSprite(pack(LAB_PACK), 0x44, 0, 0x11);
  if (r(0x238) !== 0x1000) host.setPos(0x140, 0x1f);
  host.drawSprite(pack(LAB_PACK), 0x43, 0xf0, 0x11);
  if (r(0x278) !== 0x1000) {
    host.setScale(u32(r(0x278)), 0x1000, 0x1000);
    host.setPos(0x44, 0x42);
  } else unitScale();
  if (s32(mem.read32(chart + page * 0x50 + 0xd0)) !== -1) {
    if (complete !== 0) host.paletteShift(2);
    else if (r(page * 4 + 0x210) !== 0) host.paletteShift(1);
    for (let row = 0; row < 4; row++) {
      let seen = false;
      for (let entry = 4; entry >= 0; entry--) {
        const form = s32(mem.read32(chart + page * 0x50 + row * 0x14 + entry * 4 + 0xd0));
        const x = 0xea - (4 - entry) * 0x28;
        if (form !== 0) {
          if (portrait(form) !== -1) {
            seen = true;
            host.drawSprite(pack(LAB_PACK), 0x3f, x, row * 0x2e + 0x32);
          }
        } else if (seen) {
          host.drawSprite(pack(LAB_PACK), 0x40, x, row * 0x2e + 0x32);
        }
      }
    }
  } else {
    host.drawSprite(pack(LAB_PACK), 0x3f, 0x4a, 0x32);
  }
  host.paletteShift(complete !== 0 ? 2 : 0);
  if (r(0x268) !== 0x1000) {
    host.setScale(0x1000, u32(r(0x268)), 0x1000);
    host.setPos(0x40, 0x3f);
  } else unitScale();
  for (let n = r(0xcc) - 2; n >= 0; n--) host.drawSprite(pack(LAB_PACK), 0x3c, 0x3d, n * 0x2e + 0x3f);
  if (r(0x258) !== 0x1000) {
    host.setScale(0x1000, u32(r(0x258)), 0x1000);
    host.setPos(0x3d, 0x42);
  } else unitScale();
  host.drawSprite(pack(LAB_PACK), 0x3d, 0x14, 0x32);
  host.drawSprite(pack(LAB_PACK), 0x40, 0x24, 0x32);
  host.initDrawContext();
  host.setOrigin(0x140, 0x100);
  host.setDepth(0x280, 0);
  host.setLayer(r(0x54), r(0x58) - 1);
  if (r(0x258) !== 0x1000) {
    host.setScale(0x1000, u32(r(0x258)), 0x1000);
    host.setPos(0x3d, 0x42);
  } else unitScale();
  const rootForm = s32(mem.read32(LAB_ROOT_FORMS + r(0xbc) * 4));
  host.drawSprite(pack(LAB_PACK | 1), portrait(rootForm), 0x14, 0x32);
  if (r(0x278) !== 0x1000) {
    host.setScale(u32(r(0x278)), 0x1000, 0x1000);
    host.setPos(0x44, 0x42);
  } else unitScale();
  if (s32(mem.read32(chart + page * 0x50 + 0xd0)) !== -1) {
    for (let row = 0; row < 4; row++) {
      for (let entry = 4; entry >= 0; entry--) {
        const form = s32(mem.read32(chart + page * 0x50 + row * 0x14 + entry * 4 + 0xd0));
        if (form !== 0) {
          const clip = portrait(form);
          if (clip !== -1) host.drawSprite(pack(LAB_PACK | 1), clip, 0xea - (4 - entry) * 0x28, row * 0x2e + 0x32);
        }
      }
    }
    return;
  }
  host.setOrigin(0x280, 0x100);
  host.drawSprite(pack(LAB_PACK), 0x49, 0x4a, 0x32);
}

/** One chart-cursor key: (!held[heldBit] && pressed[bit]) || (!held[heldBit] && repeat[bit]). */
function gatedKey(host: LabPadHost, heldBit: number, bit: number): boolean {
  if (!padBitOf(host, "padHeld", heldBit) && padBitOf(host, "padPressed", bit)) return true;
  return !padBitOf(host, "padHeld", heldBit) && padBitOf(host, "padRepeat", bit);
}

/** pressed[bit] || repeat[bit]. */
function repeatingKey(host: LabPadHost, bit: number): boolean {
  return padBitOf(host, "padPressed", bit) || padBitOf(host, "padRepeat", bit);
}

/** F0x800842F4(chart, aux): one frame of the chart. */
export function labChartTick(mem: LabMemory, chart: number, aux: number, host: LabChartHost): void {
  const r = (off: number): number => s32(mem.read32(chart + off));
  const w = (off: number, value: number): void => mem.write32(chart + off, u32(value));
  const widget = (index: number): number => u32(mem.read32(aux + index * 4));
  const bank = (offset: number): number => host.textBank(u32(mem.read32(LAB_LANGUAGE_CELL)) + offset);
  const m = (target: number, slot: number, args: number[]): void => { host.callMethod(target, slot, args); };
  const advance = (): void => w(0x10, r(0x10) + 1);
  const entry = (row: number, column: number): number => entryAt(mem, chart, row, column);

  const state = r(0x0c);
  if (state === 3) return;
  if (state !== 1 && state !== 2) {
    // State 0 (and anything outside 1..3): build the screen once the root's pane is live.
    const root = u32(mem.read32(chart + 0x50));
    if (s32(host.callMethod(root, 0x70, [])) === 0) return;
    m(chart, 0x38, []);
    const slot = host.partnerSlot(s32(mem.read32(root + 0x64)));
    w(0xbc, slot);
    w(0xb8, host.acquiredForms(slot, (chart + 0x60) >>> 0));
    const layer = u32(mem.read32(chart + 0x54));
    mem.write32(aux + 0x00, host.createText(layer, 1, 0x14, 0x19));
    mem.write32(aux + 0x04, host.createText(layer, 1, 0xff, 0x19));
    mem.write32(aux + 0x08, host.createText(layer, 1, 0x101, 0x19));
    mem.write32(aux + 0x0c, host.createText(layer, 1, 0x27, 0xc4));
    m(widget(3), 0x15c, [2]);
    mem.write32(aux + 0x10, host.createText(layer, 1, 0x115, 0xc4));
    m(widget(4), 0x15c, [2]);
    mem.write32(aux + 0x14, host.createText(layer, 1, 0x14, 0x19));
    m(widget(5), 0x15c, [0]);
    mem.write32(aux + 0x18, host.createText(layer, 1, 0x14, 0x19));
    m(widget(6), 0x15c, [0]);
    const table = rowTable(mem, chart);
    for (let page = 0; page < 4; page++) {
      w(0x210 + page * 4, 1);
      let filled = 0;
      let total = 0;
      for (let group = 0; group < 4; group++) {
        const present = labChartRowPresent(mem, chart, page, group);
        total += present;
        if (present !== 0) {
          labChartReload(mem, chart, page, group, filled);
          filled += 1;
        } else if (mem.read16s(table + (page * 4 + group) * 12) !== 0) {
          w(0x210 + page * 4, 0);
        }
      }
      if (total === 0) w(page * 0x50 + 0xd0, -1);
    }
    w(0xc4, 4);
    w(0xcc, labChartPageTotal(mem, chart, r(0xc0)));
    labChartSeekFirst(mem, chart);
    for (const fold of [0x230, 0x240, 0x250, 0x270, 0x260]) w(fold, 8);
    w(0x280, 0);
    w(0x284, 1);
    for (const fold of [0x230, 0x250, 0x270, 0x260]) host.foldStart((chart + fold) >>> 0, 1);
    return;
  }

  if (state === 1) {
    const step = u32(r(0x10));
    switch (step > 8 ? 0 : step) {
      case 0: {
        host.foldTick((chart + 0x230) >>> 0);
        if (host.foldTick((chart + 0x250) >>> 0) !== 0) {
          const name = host.recordPointer(r(0xbc));
          m(widget(0), 0x114, [bank(0x39), 0x27]);
          m(widget(0), 0x120, [name, -1, 1]);
          m(widget(1), 0x118, [0, r(0xc0) + 1]);
          m(widget(1), 0x148, [1]);
          m(widget(2), 0x114, [bank(0x39), 0x28]);
          m(widget(3), 0x114, [bank(0x39), 0x29]);
          m(widget(3), 0x144, [0]);
          m(widget(4), 0x114, [bank(0x39), 0x2a]);
          host.foldStart((chart + 0x260) >>> 0, 1);
          advance();
        }
        break;
      }
      case 1:
        if (host.foldTick((chart + 0x260) >>> 0) !== 0) {
          host.foldStart((chart + 0x270) >>> 0, 1);
          advance();
        }
        break;
      case 2:
        if (host.foldTick((chart + 0x270) >>> 0) !== 0) advance();
        break;
      case 3: {
        w(0xc8, r(0xc0));
        if (gatedKey(host, 0xb, 0xa)) {
          w(0xc8, Math.max(r(0xc8) - 1, 0));
        } else if (gatedKey(host, 0xa, 0xb)) {
          const last = r(0xc4) - 1;
          w(0xc8, Math.min(r(0xc8) + 1, last));
        }
        if (r(0xc8) !== r(0xc0)) {
          host.playSound(0x4001b);
          m(widget(1), 0x118, [0, r(0xc8) + 1]);
          m(widget(1), 0x148, [1]);
          const page = r(0xc8);
          if (page === 0) {
            m(widget(3), 0x144, [0]);
            w(0x280, 0);
          } else if (page === r(0xc4) - 1) {
            m(widget(4), 0x144, [0]);
            w(0x284, 0);
          } else {
            m(widget(3), 0x144, [1]);
            m(widget(4), 0x144, [1]);
            w(0x280, 1);
            w(0x284, 1);
          }
          w(0x0c, 2);
          w(0x14, 0);
        } else if (padBitOf(host, "padPressed", 0xe)) {
          host.playSound(0x800450bd);
          w(0x0c, 2);
          w(0x10, 7);
          w(0x14, 0);
          w(0x18, 1);
          w(0x280, 0);
          w(0x284, 0);
          m(widget(3), 0x144, [0]);
          m(widget(4), 0x144, [0]);
        } else if (s32(mem.read32(chart + r(0xc0) * 0x50 + 0xd0)) !== -1) {
          const column = r(0x290);
          const row = r(0x294);
          if (r(0xcc) >= 2) {
            if (repeatingKey(host, 4)) labChartMoveRow(mem, chart, -1);
            else if (repeatingKey(host, 6)) labChartMoveRow(mem, chart, 1);
          }
          if (row === r(0x294)) {
            if (repeatingKey(host, 7)) {
              let v = r(0x290) - 1;
              for (;;) {
                w(0x290, v);
                if (v < 0) {
                  w(0x290, 0);
                  if (entry(r(0x294), r(0x290)) === 0) w(0x290, column);
                  break;
                }
                const at = r(0x290);
                v = at - 1;
                if (entry(r(0x294), at) !== 0) break;
              }
            } else if (repeatingKey(host, 5)) {
              let v = r(0x290) + 1;
              for (;;) {
                w(0x290, v);
                if (v >= 5) {
                  w(0x290, 4);
                  if (entry(r(0x294), r(0x290)) === 0) w(0x290, column);
                  break;
                }
                const at = r(0x290);
                v = at + 1;
                if (entry(r(0x294), at) !== 0) break;
              }
            }
          }
          if (column !== r(0x290) || row !== r(0x294)) {
            host.playSound(0x4001b);
          } else if (padBitOf(host, "padPressed", 0xd)) {
            host.playSound(0x4001c);
            host.foldStart((chart + 0x240) >>> 0, 1);
            advance();
          }
        }
        break;
      }
      case 4:
        if (host.foldTick((chart + 0x240) >>> 0) !== 0) {
          const form = entry(r(0x294), r(0x290));
          const column = host.profileRecord(form);
          const glyph = mem.read8(u32(column) + 0x55);
          if (form !== 0) {
            const upper = r(0x294) < 2;
            m(widget(5), 0x134, [0x3a, upper ? 0xad : 0x37]);
            m(widget(6), 0x134, [0x3a, upper ? 0xbc : 0x46]);
            m(widget(5), 0x114, [bank(0x4e), glyph]);
            m(widget(6), 0x114, [bank(0x47), glyph]);
          }
          advance();
        }
        break;
      case 5:
        if (padBitOf(host, "padPressed", 0xd)) {
          host.foldStart((chart + 0x240) >>> 0, 0);
          m(widget(5), 0x144, [0]);
          m(widget(6), 0x144, [0]);
          advance();
        }
        break;
      case 6:
        if (host.foldTick((chart + 0x240) >>> 0) !== 0) w(0x10, 3);
        break;
      case 7:
        host.foldStart((chart + 0x230) >>> 0, 0);
        host.foldStart((chart + 0x250) >>> 0, 0);
        m(widget(0), 0x144, [0]);
        m(widget(1), 0x144, [0]);
        m(widget(2), 0x144, [0]);
        advance();
        break;
      case 8:
        host.foldTick((chart + 0x230) >>> 0);
        if (host.foldTick((chart + 0x250) >>> 0) !== 0) m(chart, 0x28, [3]);
        break;
    }
    labChartDraw(mem, chart, host);
    return;
  }

  // State 2: change page (the panels fold shut, the page changes, they fold open).
  const sub = u32(r(0x14));
  switch (sub > 4 ? 0 : sub) {
    case 0:
      host.foldStart((chart + 0x270) >>> 0, 0);
      w(0x14, r(0x14) + 1);
      break;
    case 1:
      if (host.foldTick((chart + 0x270) >>> 0) !== 0) {
        host.foldStart((chart + 0x260) >>> 0, 0);
        w(0xc0, r(0xc8));
        w(0x14, r(0x14) + 1);
      }
      break;
    case 2:
      if (host.foldTick((chart + 0x260) >>> 0) !== 0) {
        if (r(0x18) === 0) {
          labChartSeekFirst(mem, chart);
          host.foldStart((chart + 0x260) >>> 0, 1);
          host.foldStart((chart + 0x270) >>> 0, 1);
          w(0xcc, labChartPageTotal(mem, chart, r(0xc0)));
          w(0x14, r(0x14) + 1);
        } else {
          w(0x0c, 1);
        }
      }
      break;
    case 3:
      if (host.foldTick((chart + 0x260) >>> 0) !== 0) w(0x14, r(0x14) + 1);
      break;
    case 4:
      if (host.foldTick((chart + 0x270) >>> 0) !== 0) w(0x0c, 1);
      break;
  }
  labChartDraw(mem, chart, host);
}
