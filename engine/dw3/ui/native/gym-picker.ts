// The gym's drill picker, translated from the original pro/stgtrain objects: constructor
// F0x8008B838 with its three methods F0x8008B7F0 / F0x8008B800 / F0x8008B814, tick
// F0x8008B520 (the drill grid builder and the lifecycle dispatch), widget builder F0x8008A354,
// drill text F0x8008A3E0, picture draw F0x8008A524 and step machine F0x8008AAD4.
//
// Oracle: tests/lane-b/gym-picker.test.js runs each original through engine/native with the
// resident services and the widget methods as recording stubs, and compares the ordered calls,
// every field and the recorded picture intents.
//
// What a player sees. After choosing a partner the drill list opens: a grid of the drills this
// gym's rank offers, four columns by two rows on one page or two (with page tabs when the rank
// has six or more), each drill shown as a small picture that animates under the cursor. Left,
// right, up and down move over the drills that exist; L2 / R2 (bits 0xA / 0xB) switch page; the
// confirm button picks the drill under the cursor (a picture with a lock is refused silently),
// cancel leaves. The drill's name and description print on two lines beside the grid.
//
// Fields (picker object, 0x114 bytes, children [0x10]: 0 title, 4 page tab text, 8 drill name,
// 0xC description):
//   +0x0C lifecycle (3: closed)   +0x10 step   +0x14 cancelled   +0x50 screen   +0x54/+0x58 layer
//   +0x5C cursor shown   +0x60/+0x64 cursor frame and stamp   +0x68 column   +0x6C row   +0x70 page
//   +0x74 page tab shown   +0x78/+0x7C tab frame and stamp   +0x80/+0x84 selected picture frame and
//   stamp   +0x88..+0xA4 page 0's 8 cells and +0xA8..+0xC4 page 1's (a drill id; -1 a locked
//   picture; 0 no cell)   +0xC8 +0xD8 +0xE8 +0xF8 four window folds (values at +0xD0 +0xE0 +0xF0 +0x100)
//   +0x108 open, +0x10C close, +0x110 refresh methods.
// Data: the rank menus at 0x8008C4E4 (16 entries of 8 bytes per group: drill id, primary stat,
// secondary stat); the entry count of the group is word 0 of the pack block (0x8008CFCC).
import { gymRankMenu, GYM_PACKS, type GymPackMemory } from "./gym-packs.ts";
import {
  GYM_PACK_STTRNG0, GYM_PACK_STTRNG3, type GymDrawHost, type GymUiHost,
} from "./gym-host.ts";
import { GYM_DRILL_STRIDE, GYM_DRILL_TABLE_CELL } from "./gym-confirm.ts";

export const GYM_PICKER_HANDLER = 0x8008b520;
export const GYM_PICKER_SIZE = 0x114;
export const GYM_PICKER_EXTRA = 0x10;
export const GYM_PICKER_METHODS = [[0x108, 0x8008b7f0], [0x10c, 0x8008b800], [0x110, 0x8008b814]] as const;

export interface GymPickerMemory extends GymPackMemory {
  read16(addr: number): number;
}

/** F0x8008B838(screen): build the drill picker. */
export function gymPickerCreate(
  mem: GymPickerMemory, host: { alloc(handler: number, size: number, extra: number): number }, screen: number,
): number {
  const obj = host.alloc(GYM_PICKER_HANDLER, GYM_PICKER_SIZE, GYM_PICKER_EXTRA);
  for (const [slot, routine] of GYM_PICKER_METHODS) mem.write32(obj + slot, routine | 0);
  mem.write32(obj + 0x54, 0x1000);
  mem.write32(obj + 0x58, 6);
  mem.write32(obj + 0x50, screen >>> 0);
  return obj;
}

/** F0x8008B7F0(picker): open (the flow's request). */
export function gymPickerOpen(mem: GymPickerMemory, picker: number): void {
  mem.write32(picker + 0x0c, 1);
  mem.write32(picker + 0x10, 0);
}
/** F0x8008B800(picker): close (the flow's request). */
export function gymPickerClose(mem: GymPickerMemory, picker: number): void {
  mem.write32(picker + 0x0c, 1);
  mem.write32(picker + 0x10, 0x32);
}

/** F0x8008A354(picker, children): the four text widgets. */
export function gymPickerWidgets(mem: GymPickerMemory, picker: number, children: number, host: GymUiHost): void {
  const target = (mem.read16(picker + 0x54) << 16) >> 16;
  mem.write32(children, host.createText(target, 1, 0xae, 0x49) >>> 0);
  mem.write32(children + 4, host.createText(target, 1, 0xa3, 0xa0) >>> 0);
  mem.write32(children + 8, host.createText(target, 1, 0x74, 0xc0) >>> 0);
  mem.write32(children + 0xc, host.createText(target, 1, 0x74, 0xce) >>> 0);
}

/** The drill id in the cell at column, row of the current page. */
function cellAt(mem: GymPickerMemory, picker: number, col: number, row: number): number {
  return mem.read32(picker + ((col + row * 4) * 4) + (mem.read32(picker + 0x70) << 5) + 0x88) | 0;
}

/** F0x8008A3E0(picker, children, show): print the highlighted drill's two lines, or hide them. */
export function gymPickerDrillText(mem: GymPickerMemory, picker: number, children: number, show: number, host: GymUiHost): void {
  if (show !== 0) {
    const drill = cellAt(mem, picker, mem.read32(picker + 0x68), mem.read32(picker + 0x6c));
    if (drill > 0) {
      const table = mem.read32(GYM_DRILL_TABLE_CELL);
      host.textSet(mem.read32(children + 8) >>> 0, host.textSource(), mem.read32((table + drill * 0x18) >>> 0));
      host.textSet(mem.read32(children + 0xc) >>> 0, host.textSource(), mem.read32((table + drill * 0x18 + 4) >>> 0));
      return;
    }
  }
  host.textShow(mem.read32(children + 8) >>> 0, 0);
  host.textShow(mem.read32(children + 0xc) >>> 0, 0);
}

/** F0x8008A524(picker): the grid pictures, the cursor, the page tab and the window panels. */
export function gymPickerDraw(mem: GymPickerMemory, picker: number, host: GymDrawHost): void {
  host.initDrawContext();
  host.setLayer(mem.read32(picker + 0x54), mem.read32(picker + 0x58));
  host.setOrigin(0x240, 0x100);
  const sprite3 = (clip: number, x: number, y: number): void => host.drawSprite(host.packResolve(GYM_PACK_STTRNG3), clip, x, y);
  const tick = (stamp: number, frame: number, period: number): void => {
    if (((host.frameTick() - mem.read32(picker + stamp)) | 0) >= period) {
      mem.write32(picker + stamp, host.frameTick() >>> 0);
      const next = (mem.read32(picker + frame) + 1) | 0;
      mem.write32(picker + frame, next >>> 0);
      if (next >= 4) mem.write32(picker + frame, 0);
    }
  };
  let value = mem.read32(picker + 0xd0) | 0;
  if (value !== 0) {
    if (value !== 0x1000) { host.setScale(value, 0x1000, 0x1000); host.setPos(0x140, 0x4e); }
    sprite3(0x22, 0x92, 0x43);
  }
  if (mem.read32(picker + 0x5c) !== 0) {
    tick(0x64, 0x60, 0xb);
    host.paletteShift(mem.read32(picker + 0x60));
    sprite3(0x1e, (mem.read32(picker + 0x68) * 0x28 + 0x94) | 0, (mem.read32(picker + 0x6c) * 0x28 + 0x64) | 0);
    host.paletteShift(0);
  }
  if (mem.read32(picker + 0xf0) !== 0) {
    tick(0x84, 0x80, 0x10);
    value = mem.read32(picker + 0xf0) | 0;
    if (value !== 0x1000) host.setScale(value, value, 0x1000);
    const table = mem.read32(GYM_DRILL_TABLE_CELL);
    for (let cell = 0; cell < 8; cell++) {
      const drill = mem.read32(picker + cell * 4 + (mem.read32(picker + 0x70) << 5) + 0x88) | 0;
      if (drill === 0) continue;
      const row = cell >> 2;
      const px = (cell - row * 4) * 0x28;
      const py = row * 0x28;
      if ((mem.read32(picker + 0xf0) | 0) !== 0x1000) host.setPos(px + 0xa8, py + 0x76);
      if (drill === -1) {
        sprite3(0x5f, px + 0x94, py + 0x64);
        continue;
      }
      let clip: number;
      if (cell === ((mem.read32(picker + 0x68) + mem.read32(picker + 0x6c) * 4) | 0)) {
        host.paletteShift(0);
        clip = mem.read32((table + drill * GYM_DRILL_STRIDE + mem.read32(picker + 0x80) * 4 + 8) >>> 0);
      } else {
        host.paletteShift(1);
        clip = mem.read32((table + drill * GYM_DRILL_STRIDE + 8) >>> 0);
      }
      host.drawSprite(host.packResolve(GYM_PACK_STTRNG0), clip, px + 0x94, py + 0x64);
    }
  }
  if (mem.read32(picker + 0x74) !== 0) {
    tick(0x7c, 0x78, 0xb);
    host.paletteShift(mem.read32(picker + 0x78));
    if (mem.read32(picker + 0x70) === 0) sprite3(0x2c, 0xe4, 0xa0);
    else sprite3(0x2b, 0x94, 0xa0);
  }
  host.paletteShift(0);
  value = mem.read32(picker + 0xe0) | 0;
  if (value !== 0) {
    host.setScale(value, 0x1000, 0x1000);
    if (value !== 0x1000) host.setPos(0x140, 0x8a);
    sprite3(0x24, 0x8f, 0x5f);
  }
  value = mem.read32(picker + 0x100) | 0;
  if (value !== 0) {
    if (value !== 0x1000) { host.setScale(value, 0x1000, 0x1000); host.setPos(0x140, 0xcd); }
    sprite3(0x23, 0x46, 0xba);
  }
}

const SFX_MOVE = 0x4001b;
const SFX_CANCEL = 0x800450bd;

/** F0x8008AAD4(picker, children): the picker's step machine. */
export function gymPickerMachine(mem: GymPickerMemory, picker: number, children: number, host: GymUiHost): void {
  const child = (i: number): number => mem.read32(children + i * 4) >>> 0;
  const step = mem.read32(picker + 0x10) >>> 0;
  const bump = (): void => mem.write32(picker + 0x10, (mem.read32(picker + 0x10) + 1) >>> 0);
  const source = (): number => host.textSource();
  const screen = (): number => mem.read32(picker + 0x50) >>> 0;
  const bit = (word: () => number, logical: number): boolean => { const w = word(); return ((w >> host.padBit(logical)) & 1) !== 0; };
  const pressed = (logical: number): boolean => bit(() => host.padPressed(), logical);
  const held = (logical: number): boolean => bit(() => host.padHeld(), logical);
  const repeated = (logical: number): boolean => bit(() => host.padRepeat(), logical);
  const start = (fold: number, open: number): void => host.foldStart(picker + fold, open);
  const tick = (fold: number): number => host.foldTick(picker + fold);
  const cell = (col: number, row: number): number => cellAt(mem, picker, col, row);
  const tab = (): void => {
    if (mem.read32(picker + 0x70) === 0) { host.textSet(child(1), source(), 0x45); host.textOrigin(child(1), 0xe4, 0xa0); }
    else { host.textSet(child(1), source(), 0x44); host.textOrigin(child(1), 0xa3, 0xa0); }
  };

  switch (step < 0x35 ? step : -1) {
    case 1:
      if (tick(0xc8) !== 0) {
        host.textSet(child(0), source(), 7);
        start(0xd8, 1);
        bump();
      }
      return;
    case 2:
      if (tick(0xd8) !== 0) { start(0xe8, 1); bump(); }
      return;
    case 3:
      if (tick(0xe8) !== 0) {
        if ((mem.read32(GYM_PACKS) | 0) >= 6) {
          mem.write32(picker + 0x74, 1);
          tab();
        }
        start(0xf8, 1);
        bump();
      }
      return;
    case 4:
      if (tick(0xf8) !== 0) {
        gymPickerDrillText(mem, picker, children, 1, host);
        mem.write32(picker + 0x5c, 1);
        mem.write32(picker + 0x10, 0xa);
      }
      return;
    case 0xa: return choose();
    case 0x32:
      mem.write32(picker + 0x5c, 0);
      mem.write32(picker + 0x74, 0);
      host.textShow(child(1), 0);
      start(0xe8, 0);
      bump();
      return;
    case 0x33:
      if (tick(0xe8) !== 0) {
        gymPickerDrillText(mem, picker, children, 0, host);
        host.textShow(child(0), 0);
        start(0xc8, 0);
        start(0xd8, 0);
        start(0xf8, 0);
        bump();
      }
      return;
    case 0x34:
      tick(0xc8);
      tick(0xd8);
      if (tick(0xf8) !== 0) {
        if (mem.read32(picker + 0x14) !== 0) host.setState0(picker, 2);
        else mem.write32(picker + 0x0c, 3);
      }
      return;
    default:
      start(0xc8, 1);
      bump();
  }

  function choose(): void {
    const page = mem.read32(picker + 0x70) | 0;
    if ((mem.read32(GYM_PACKS) | 0) >= 6) {
      if (!held(0xb) && pressed(0xa)) mem.write32(picker + 0x70, 0);
      else if (!held(0xa) && pressed(0xb)) mem.write32(picker + 0x70, 1);
    }
    if (page !== (mem.read32(picker + 0x70) | 0)) {
      host.playSound(SFX_MOVE);
      tab();
      for (let k = 0; k < 8; k++) {
        if ((mem.read32(picker + (mem.read32(picker + 0x70) << 5) + k * 4 + 0x88) | 0) > 0) {
          mem.write32(picker + 0x68, (k & 3) >>> 0);
          mem.write32(picker + 0x6c, (k >> 2) >>> 0);
          break;
        }
      }
      gymPickerDrillText(mem, picker, children, 1, host);
      mem.write32(picker + 0x80, 0);
      return;
    }
    const col = mem.read32(picker + 0x68) | 0;
    const row = mem.read32(picker + 0x6c) | 0;
    if (pressed(7) || repeated(7)) {
      let v = ((mem.read32(picker + 0x68) | 0) - 1) | 0;
      for (;;) {
        mem.write32(picker + 0x68, v >>> 0);
        if (v < 0) { mem.write32(picker + 0x68, 0); break; }
        v = ((mem.read32(picker + 0x68) | 0) - 1) | 0;
        if (cell(mem.read32(picker + 0x68) | 0, mem.read32(picker + 0x6c) | 0) > 0) break;
      }
    } else if (pressed(5) || repeated(5)) {
      let v = ((mem.read32(picker + 0x68) | 0) + 1) | 0;
      for (;;) {
        mem.write32(picker + 0x68, v >>> 0);
        if (v >= 4) { mem.write32(picker + 0x68, 3); break; }
        v = ((mem.read32(picker + 0x68) | 0) + 1) | 0;
        if (cell(mem.read32(picker + 0x68) | 0, mem.read32(picker + 0x6c) | 0) > 0) break;
      }
    }
    if (pressed(4) || repeated(4)) {
      let v = ((mem.read32(picker + 0x6c) | 0) - 1) | 0;
      for (;;) {
        mem.write32(picker + 0x6c, v >>> 0);
        if (v < 0) { mem.write32(picker + 0x6c, 0); break; }
        v = ((mem.read32(picker + 0x6c) | 0) - 1) | 0;
        if (cell(mem.read32(picker + 0x68) | 0, mem.read32(picker + 0x6c) | 0) > 0) break;
      }
    } else if (pressed(6) || repeated(6)) {
      let v = ((mem.read32(picker + 0x6c) | 0) + 1) | 0;
      for (;;) {
        mem.write32(picker + 0x6c, v >>> 0);
        if (v >= 2) { mem.write32(picker + 0x6c, 1); break; }
        v = ((mem.read32(picker + 0x6c) | 0) + 1) | 0;
        if (cell(mem.read32(picker + 0x68) | 0, mem.read32(picker + 0x6c) | 0) > 0) break;
      }
    }
    if (col !== (mem.read32(picker + 0x68) | 0) || row !== (mem.read32(picker + 0x6c) | 0)) {
      if (cell(mem.read32(picker + 0x68) | 0, mem.read32(picker + 0x6c) | 0) > 0) {
        host.playSound(SFX_MOVE);
        gymPickerDrillText(mem, picker, children, 1, host);
        return;
      }
      mem.write32(picker + 0x68, col >>> 0);
      mem.write32(picker + 0x6c, row >>> 0);
      return;
    }
    if (pressed(0xd)) {
      host.playSound(SFX_MOVE);
      mem.write32(screen() + 0x78, cell(mem.read32(picker + 0x68) | 0, mem.read32(picker + 0x6c) | 0) >>> 0);
      if ((mem.read32(screen() + 0x78) | 0) > 0) mem.write32(picker + 0x10, 0x32);
    } else if (pressed(0xe)) {
      host.playSound(SFX_CANCEL);
      mem.write32(picker + 0x10, 0x32);
      mem.write32(picker + 0x14, 1);
    }
  }
}

/** F0x8008B520(picker, children): the picker's tick. */
export function gymPickerTick(
  mem: GymPickerMemory, picker: number, children: number,
  host: GymUiHost & GymDrawHost & { advance(self: number): void },
): void {
  const state = mem.read32(picker + 0x0c) | 0;
  if (state === 1) {
    gymPickerMachine(mem, picker, children, host);
    gymPickerDraw(mem, picker, host);
    return;
  }
  if (state >= 2 && state < 4) return;
  host.advance(picker);
  gymPickerWidgets(mem, picker, children, host);
  mem.write32(picker + 0xc8, 0xa);
  mem.write32(picker + 0xd8, 0xa);
  mem.write32(picker + 0xe8, 0xa);
  mem.write32(picker + 0xf8, 0xa);
  const menu = gymRankMenu(mem, host.rankGroup());
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      if (row === 1 && col === 2) continue;
      mem.write32(picker + (col + row * 4) * 4 + 0x88, 0xffffffff);
    }
  }
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      if (row === 1 && col === 0) continue;
      mem.write32(picker + (col + row * 4) * 4 + 0xa8, 0xffffffff);
    }
  }
  const FIELDS = [0x88, 0x8c, 0x90, 0x98, 0x9c, 0xa8, 0xac, 0xb0, 0xb4, 0xbc, 0xc0, 0xc4];
  for (let entry = menu; entry < menu + 0x80; entry += 8) {
    const id = (mem.read32(entry) - 1) >>> 0;
    if (id < 0x18) mem.write32(picker + FIELDS[id % 12]!, mem.read32(entry));
  }
  const drill = mem.read32(mem.read32(picker + 0x50) + 0x78) | 0;
  if (drill > 0) {
    for (let page = 0; page < 2; page++) {
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
          if ((mem.read32(picker + (col + row * 4) * 4 + (page << 5) + 0x88) | 0) === (mem.read32(mem.read32(picker + 0x50) + 0x78) | 0)) {
            mem.write32(picker + 0x70, page);
            mem.write32(picker + 0x68, col);
            mem.write32(picker + 0x6c, row);
            break;
          }
        }
      }
    }
  }
}
