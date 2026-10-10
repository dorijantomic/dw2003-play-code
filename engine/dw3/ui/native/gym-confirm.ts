// The gym's confirm panel, translated from the original pro/stgtrain objects: constructor
// F0x80089764 with its dismiss method F0x80089758, handler F0x80089698, widget builder
// F0x80088214, picture draw F0x80088348 and step machine F0x800888BC.
//
// Oracle: tests/lane-b/gym-confirm.test.js runs each original through engine/native with the
// resident services and the widget methods as recording stubs, and compares the ordered calls,
// every field and the recorded picture intents.
//
// What a player sees. After a drill is picked the drill's name, its picture and a "how much TP
// do you spend" list (TP 1, TP 5, TP 10; each costs as many TP) open beside the partner. Left and
// right choose, the confirm button takes it. Not enough TP shows a refusal line and goes back.
// Enough TP asks "Start training?" (Yes / No); Yes subtracts the cost from the partner's TP right
// then and hands over to the training session (native/gym-training.ts), No goes back to the
// list, cancel closes the panel.
//
// Fields (confirm object, 0xFC bytes, children [0x28]: 0 title, 4 drill name, 8 second line,
// 0xC/0x10/0x14 the three TP options, 0x18 refusal/ask line, 0x1C/0x20 Yes/No, 0x24 cursor):
//   +0x0C lifecycle (2: closed by the player, 3: finished)   +0x10 step   +0x14 cancelled
//   +0x50 screen (+0x68 pod, +0x78 drill, +0x7C TP choice)   +0x54/+0x58 layer and bucket
//   +0x5C the TP option under the cursor   +0x60/+0x64 arrow frame and stamp   +0x68 arrow on
//   +0x6C Yes (0) / No (1)   +0x70/+0x74 picture frame and stamp   +0xF8 dismiss method
//   +0x78 +0x88 +0x98 +0xA8 +0xB8 +0xC8 +0xD8 +0xE8 eight window folds (their values sit +8 on)
// Data: the TP costs are the words 1, 5, 10 at 0x8008C4D8; the drill record table at [0x8008D2A8]
// (0x18 bytes per drill: name text, description text, four picture clips at +8).
import {
  GYM_PACK_STTRNG0, GYM_PACK_STTRNG3, type GymDrawHost, type GymUiHost,
} from "./gym-host.ts";

export const GYM_CONFIRM_HANDLER = 0x80089698;
export const GYM_CONFIRM_SIZE = 0xfc;
export const GYM_CONFIRM_EXTRA = 0x28;
export const GYM_CONFIRM_DISMISS = 0x80089758;
export const GYM_TP_COSTS = 0x8008c4d8;
export const GYM_DRILL_TABLE_CELL = 0x8008d2a8;
export const GYM_DRILL_STRIDE = 0x18;

export interface GymConfirmMemory {
  read8(addr: number): number;
  read16(addr: number): number;
  read32(addr: number): number;
  write8(addr: number, value: number): void;
  write16(addr: number, value: number): void;
  write32(addr: number, value: number): void;
}

const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80089764(screen): build the confirm panel. */
export function gymConfirmCreate(
  mem: GymConfirmMemory, host: { alloc(handler: number, size: number, extra: number): number }, screen: number,
): number {
  const obj = host.alloc(GYM_CONFIRM_HANDLER, GYM_CONFIRM_SIZE, GYM_CONFIRM_EXTRA);
  mem.write32(obj + 0xf8, GYM_CONFIRM_DISMISS | 0);
  mem.write32(obj + 0x54, 0x1000);
  mem.write32(obj + 0x58, 6);
  mem.write32(obj + 0x50, screen >>> 0);
  return obj;
}

/** F0x80089758(confirm): the dismiss request. */
export function gymConfirmDismiss(mem: GymConfirmMemory, confirm: number): void {
  mem.write32(confirm + 0x10, 0x1e);
}

/** F0x80088214(confirm, children): nine text widgets and the cursor. */
export function gymConfirmWidgets(mem: GymConfirmMemory, confirm: number, children: number, host: GymUiHost): void {
  const target = mem.read32(confirm + 0x54);
  const sites: Array<[number, number]> = [[0xa2, 0x49], [0xbc, 0x14], [0xc0, 0x29], [0x98, 0x66], [0xc0, 0x66],
    [0xe6, 0x66], [0x94, 0x87], [0xa2, 0x64], [0xa2, 0x74]];
  sites.forEach(([x, y], i) => mem.write32(children + i * 4, host.createText(target, 1, x, y) >>> 0));
  const cursor = host.createCursor(target, (mem.read32(confirm + 0x58) - 1) | 0, 0, 0);
  mem.write32(children + 0x24, cursor >>> 0);
  host.cursorShow(cursor, 0);
}

/** F0x80088348(confirm): the panels, the drill picture and the cursor arrow. */
export function gymConfirmDraw(mem: GymConfirmMemory, confirm: number, host: GymDrawHost): void {
  host.initDrawContext();
  host.setLayer(mem.read32(confirm + 0x54), mem.read32(confirm + 0x58));
  host.setOrigin(0x240, 0x100);
  const sprite3 = (clip: number, x: number, y: number): void => host.drawSprite(host.packResolve(GYM_PACK_STTRNG3), clip, x, y);
  const tick = (stamp: number, frame: number, period: number, wrap: number): void => {
    if (((host.frameTick() - mem.read32(confirm + stamp)) | 0) >= period) {
      mem.write32(confirm + stamp, host.frameTick() >>> 0);
      const next = (mem.read32(confirm + frame) + 1) | 0;
      mem.write32(confirm + frame, next >>> 0);
      if (next >= wrap) mem.write32(confirm + frame, 0);
    }
  };
  const picture = mem.read32(confirm + 0xa0) | 0;
  if (picture !== 0) {
    if (picture !== 0x1000) {
      host.setScale(picture, picture, 0x1000);
      host.setPos(0xa6, 0x26);
    }
    tick(0x74, 0x70, 0x10, 4);
    const table = mem.read32(GYM_DRILL_TABLE_CELL);
    const drill = mem.read32(mem.read32(confirm + 0x50) + 0x78);
    const clip = mem.read32((table + drill * GYM_DRILL_STRIDE + mem.read32(confirm + 0x70) * 4 + 8) >>> 0);
    host.drawSprite(host.packResolve(GYM_PACK_STTRNG0), clip, 0x94, 0x14);
  }
  let value = mem.read32(confirm + 0xb0) | 0;
  if (value !== 0) {
    if (value !== 0x1000) { host.setScale(value, value, 0x1000); host.setPos(0xce, 0x2f); }
    sprite3(0x2a, 0xbc, 0x26);
  }
  value = mem.read32(confirm + 0x90) | 0;
  if (value !== 0) {
    host.setScale(value, 0x1000, 0x1000);
    if ((mem.read32(confirm + 0x90) | 0) !== 0x1000) host.setPos(0x140, 0x26);
    sprite3(0x25, 0x8f, 0xf);
  }
  value = mem.read32(confirm + 0x80) | 0;
  if (value !== 0) {
    if (value !== 0x1000) { host.setScale(value, 0x1000, 0x1000); host.setPos(0x140, 0x4e); }
    sprite3(0x26, 0x85, 0x43);
  }
  if (mem.read32(confirm + 0x68) !== 0) {
    tick(0x64, 0x60, 0xb, 4);
    host.paletteShift(mem.read32(confirm + 0x60));
    sprite3(0x29, (mem.read32(confirm + 0x5c) * 0x28 + 0x94) | 0, 0x63);
    host.paletteShift(0);
  }
  value = mem.read32(confirm + 0xe0) | 0;
  if (value !== 0) {
    if (value !== 0x1000) host.setScale(value, value, 0x1000);
    for (let i = 0; i < 3; i++) {
      if ((mem.read32(confirm + 0xe0) | 0) !== 0x1000) host.setPos(0xa6 + i * 0x28, 0x6c);
      sprite3(0x2a, 0x94 + i * 0x28, 0x63);
    }
  }
  for (const [fold, py, clip, x, y] of [[0xd0, 0x6c, 0x27, 0x82, 0x5e], [0xf0, 0x8d, 0x27, 0x82, 0x7f], [0xc0, 0x72, 0x1d, 0x82, 0x5e]] as const) {
    value = mem.read32(confirm + fold) | 0;
    if (value === 0) continue;
    host.setScale(value, 0x1000, 0x1000);
    host.setPos(0x140, py);
    sprite3(clip, x, y);
  }
}

const SFX_MOVE = 0x4001b;
const SFX_OK = 0x4001c;
const SFX_TOGGLE = 0x8004513e;
const SFX_SELECT = 0x8004503c;
const SFX_CANCEL = 0x800450bd;

/** F0x800888BC(confirm, children): the confirm panel's step machine. */
export function gymConfirmMachine(mem: GymConfirmMemory, confirm: number, children: number, host: GymUiHost): void {
  const child = (i: number): number => mem.read32(children + i * 4) >>> 0;
  const step = mem.read32(confirm + 0x10) >>> 0;
  const bump = (): void => mem.write32(confirm + 0x10, (mem.read32(confirm + 0x10) + 1) >>> 0);
  const source = (): number => host.textSource();
  const screen = (): number => mem.read32(confirm + 0x50) >>> 0;
  const isPressed = (logical: number): boolean => { const w = host.padPressed(); return ((w >> host.padBit(logical)) & 1) !== 0; };
  const isRepeated = (logical: number): boolean => { const w = host.padRepeat(); return ((w >> host.padBit(logical)) & 1) !== 0; };
  const start = (fold: number, open: number): void => host.foldStart(confirm + fold, open);
  const tick = (fold: number): number => host.foldTick(confirm + fold);
  const hide = (widget: number): void => host.textShow(widget, 0);
  const leave = (value: number): void => mem.write32(confirm + 0x10, value);
  const tpCost = (): number => mem.read32(GYM_TP_COSTS + mem.read32(confirm + 0x5c) * 4) | 0;

  switch (step < 0x34 ? step : -1) {
    case 1:
      if (tick(0x88) !== 0) {
        const drill = mem.read32(screen() + 0x78);
        host.textSet(child(1), source(), mem.read32(mem.read32(GYM_DRILL_TABLE_CELL) + drill * GYM_DRILL_STRIDE));
        start(0x98, 1);
        bump();
      }
      return;
    case 2:
      if (tick(0x98) !== 0) { start(0x78, 1); bump(); }
      return;
    case 3:
      if (tick(0x78) !== 0) { host.textSet(child(0), source(), 8); start(0xc8, 1); bump(); }
      return;
    case 4:
      if (tick(0xc8) !== 0) { start(0xd8, 1); bump(); }
      return;
    case 5:
      if (tick(0xd8) !== 0) {
        for (let k = 0; k < 3; k++) host.textSet(child(3 + k), source(), 0xe + k);
        mem.write32(confirm + 0x68, 1);
        bump();
      }
      return;
    case 6: {
      const before = mem.read32(confirm + 0x5c) | 0;
      if (isPressed(7) || isRepeated(7)) {
        const next = (mem.read32(confirm + 0x5c) - 1) | 0;
        mem.write32(confirm + 0x5c, next >>> 0);
        if (next < 0) mem.write32(confirm + 0x5c, 0);
      } else if (isPressed(5) || isRepeated(5)) {
        const next = (mem.read32(confirm + 0x5c) + 1) | 0;
        mem.write32(confirm + 0x5c, next >>> 0);
        if (next >= 3) mem.write32(confirm + 0x5c, 2);
      }
      if (before !== (mem.read32(confirm + 0x5c) | 0)) { host.playSound(SFX_MOVE); return; }
      if (isPressed(0xd)) {
        host.playSound(SFX_OK);
        const scratch = host.projectionScratch();
        host.copyProjection(host.rosterSlot(mem.read32(screen() + 0x68)), scratch);
        if (s16(mem.read16(scratch + 2)) < tpCost()) { leave(0xa); return; }
        leave(0xf);
        mem.write32(screen() + 0x7c, mem.read32(confirm + 0x5c));
        return;
      }
      if (isPressed(0xe)) {
        host.playSound(SFX_CANCEL);
        leave(0x32);
        mem.write32(confirm + 0x14, 1);
      }
      return;
    }
    case 0xa:
      mem.write32(confirm + 0x68, 0);
      start(0xe8, 1);
      bump();
      return;
    case 0xb:
      if (tick(0xe8) !== 0) { host.textSet(child(6), source(), 0x12); bump(); }
      return;
    case 0xc:
      if (isPressed(0xd)) {
        host.playSound(SFX_OK);
        hide(child(6));
        start(0xe8, 0);
        bump();
      }
      return;
    case 0xd:
      if (tick(0xe8) !== 0) { mem.write32(confirm + 0x68, 1); leave(6); }
      return;
    case 0xf:
      mem.write32(confirm + 0x68, 0);
      hide(child(0));
      for (let k = 0; k < 3; k++) hide(child(3 + k));
      mem.write32(confirm + 0xe0, 0);
      start(0xc8, 0);
      start(0x78, 0);
      bump();
      return;
    case 0x10:
      tick(0xc8);
      if (tick(0x78) !== 0) {
        start(0x78, 1);
        start(0xb8, 1);
        start(0xa8, 1);
        bump();
      }
      return;
    case 0x11:
      tick(0xa8);
      tick(0x78);
      if (tick(0xb8) !== 0) {
        host.textSet(child(2), source(), (mem.read32(confirm + 0x5c) + 0xe) | 0);
        host.textSet(child(0), source(), 9);
        host.textSet(child(7), source(), 0xa);
        host.textSet(child(8), source(), 0xb);
        mem.write32(confirm + 0x6c, 0);
        host.cursorPlace(child(9), 0x94, 0x64);
        host.cursorShow(child(9), 1);
        bump();
      }
      return;
    case 0x12: {
      const before = mem.read32(confirm + 0x6c) | 0;
      if (isPressed(4) || isRepeated(4)) mem.write32(confirm + 0x6c, 0);
      else if (isPressed(6) || isRepeated(6)) mem.write32(confirm + 0x6c, 1);
      if (before !== (mem.read32(confirm + 0x6c) | 0)) {
        host.playSound(SFX_TOGGLE);
        host.cursorPlace(child(9), 0x94, ((mem.read32(confirm + 0x6c) << 4) + 0x64) | 0);
        return;
      }
      if (isPressed(0xd)) {
        host.playSound(SFX_SELECT);
        if ((mem.read32(confirm + 0x6c) | 0) === 0) {
          leave(0x19);
          const block = host.recordBlock(host.rosterSlot(mem.read32(screen() + 0x68))) >>> 0;
          mem.write16(block + 0x1e, (mem.read16(block + 0x1e) - tpCost()) & 0xffff);
          return;
        }
        bump();
        return;
      }
      if (isPressed(0xe)) {
        host.playSound(SFX_CANCEL);
        bump();
      }
      return;
    }
    case 0x13:
      start(0x78, 0);
      start(0xb8, 0);
      start(0xa8, 0);
      hide(child(2));
      hide(child(0));
      hide(child(7));
      hide(child(8));
      host.cursorShow(child(9), 0);
      bump();
      return;
    case 0x14:
      tick(0xa8);
      tick(0x78);
      if (tick(0xb8) !== 0) { start(0x78, 1); leave(3); }
      return;
    case 0x19:
      start(0x78, 0);
      hide(child(0));
      start(0xb8, 0);
      hide(child(7));
      hide(child(8));
      host.cursorShow(child(9), 0);
      bump();
      return;
    case 0x1a:
      tick(0x78);
      if (tick(0xb8) !== 0) leave(0x23);
      return;
    case 0x1e:
      hide(child(1));
      hide(child(2));
      mem.write32(confirm + 0xa0, 0);
      mem.write32(confirm + 0xb0, 0);
      start(0x88, 0);
      bump();
      return;
    case 0x1f:
      if (tick(0x88) !== 0) mem.write32(confirm + 0x0c, 3);
      return;
    case 0x23: return;
    case 0x32:
      mem.write32(confirm + 0x68, 0);
      hide(child(0));
      for (let k = 0; k < 3; k++) hide(child(3 + k));
      hide(child(1));
      start(0x88, 0);
      start(0x98, 0);
      start(0x78, 0);
      start(0xd8, 0);
      start(0xc8, 0);
      bump();
      return;
    case 0x33:
      tick(0x88);
      tick(0x98);
      tick(0x78);
      tick(0xd8);
      if (tick(0xc8) !== 0 && mem.read32(confirm + 0x14) !== 0) mem.write32(confirm + 0x0c, 2);
      return;
    default:
      start(0x88, 1);
      bump();
  }
}

/** F0x80089698(confirm, children): the confirm panel's tick. */
export function gymConfirmTick(
  mem: GymConfirmMemory, confirm: number, children: number, host: GymUiHost & GymDrawHost & { advance(self: number): void },
): void {
  const state = mem.read32(confirm + 0x0c) | 0;
  if (state === 1) {
    gymConfirmMachine(mem, confirm, children, host);
    gymConfirmDraw(mem, confirm, host);
    return;
  }
  if (state === 2) {
    gymConfirmDraw(mem, confirm, host);
    return;
  }
  if (state === 3) return;
  host.advance(confirm);
  gymConfirmWidgets(mem, confirm, children, host);
  mem.write32(confirm + 0xd8, 8);
  mem.write32(confirm + 0xc8, 0xa);
  mem.write32(confirm + 0xb8, 0xa);
  mem.write32(confirm + 0x78, 0xa);
  mem.write32(confirm + 0x88, 0xa);
  mem.write32(confirm + 0xa8, 6);
  mem.write32(confirm + 0x98, 6);
  mem.write32(confirm + 0xe8, 0xa);
  mem.write32(confirm + 0x5c, mem.read32(mem.read32(confirm + 0x50) + 0x7c));
}
