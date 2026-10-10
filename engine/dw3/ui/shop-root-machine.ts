// The merchant scene's root controller, translated from pro/stitshop
// F0x8008B908. This object owns the BUY/SELL choice and the return to the field.
// Values used for text and fold timing come from that routine and its data table.

export interface ShopRootMachineMemory {
  read32(address: number): number;
  write32(address: number, value: number): void;
}

export interface ShopRootMachineHost {
  foldStart(window: number, opening: number): void;
  foldTick(window: number): number;
  bankGet(bank: number): number;
  textSet(widget: number, bank: number, id: number): void;
  textNumber(widget: number, line: number, value: number): void;
  textMeasure(widget: number, enabled: number): void;
  textShow(widget: number, visible: number): void;
  cursorShow(widget: number, visible: number): void;
  cursorPlace(widget: number, x: number, y: number): void;
  padPressed(): number;
  padKey(code: number): number;
  playSound(id: number): void;
  /** Base task slot +0x2C; clears the lower two state fields. */
  transition(root: number, state: number): void;
  createBuy(root: number): number;
  createSell(root: number): number;
  createFade(window: number): number;
  fadeStart(fade: number, direction: number, frames: number): void;
}

const STATE = 0x10;
const RETURN_TO_MENU = 0x14;
const SHOP_ID = 0x60;
const CURSOR = 0x64;
const SHOP_NAMES = 0x8008cb40;
const LANGUAGE = 0x8005cca8;
const MONEY = 0x80048da0;
const MOVE_SOUND = 0x8004513e;
const CONFIRM_SOUND = 0x8004503c;
const CANCEL_SOUND = 0x800450bd;

/** One tick of the merchant scene's root menu and its child transition. */
export function shopRootMachine(
  mem: ShopRootMachineMemory,
  root: number,
  context: number,
  host: ShopRootMachineHost,
): void {
  const read = (offset: number): number => mem.read32(root + offset) | 0;
  const write = (offset: number, value: number): void => mem.write32(root + offset, value >>> 0);
  const child = (offset: number): number => mem.read32(context + offset) >>> 0;
  const advance = (): void => write(STATE, read(STATE) + 1);
  const start = (offset: number, opening: number): void => host.foldStart(root + offset, opening);
  const tick = (offset: number): number => host.foldTick(root + offset);
  const pressed = (code: number): boolean => ((host.padPressed() >> host.padKey(code)) & 1) !== 0;
  const message = (offset: number, bank: number, id: number): void =>
    host.textSet(child(offset), host.bankGet((mem.read32(LANGUAGE) + bank) | 0), id);

  switch (read(STATE)) {
    case 1:
      tick(0x68);
      if (tick(0x78)) {
        start(0x88, 1);
        start(0x98, 1);
        message(0x00, 0x94, mem.read32(SHOP_NAMES + read(SHOP_ID) * 4) | 0);
        message(0x0c, 0x71, 2);
        host.textNumber(child(0x08), 0, mem.read32(MONEY) | 0);
        host.textMeasure(child(0x08), 1);
        advance();
      }
      return;
    case 2:
      tick(0x88);
      if (tick(0x98)) {
        message(0x10, 0x71, 3);
        message(0x14, 0x71, 4);
        host.cursorShow(child(0x18), 1);
        message(0x04, 0x71, 5);
        advance();
      }
      return;
    case 3: {
      const old = read(CURSOR);
      if (pressed(4)) write(CURSOR, 0);
      else if (pressed(6)) write(CURSOR, 1);
      if (old !== read(CURSOR)) {
        host.playSound(MOVE_SOUND);
        host.cursorPlace(child(0x18), 0xb0, read(CURSOR) * 0xe + 0x2f);
      }
      if (pressed(0x0d)) {
        host.playSound(CONFIRM_SOUND);
        write(STATE, 0x14);
        write(RETURN_TO_MENU, 1);
      } else if (pressed(0x0e)) {
        host.playSound(CANCEL_SOUND);
        host.transition(root, 0x14);
      }
      return;
    }
    case 10:
      mem.write32(context + 0x1c, read(CURSOR) === 0 ? host.createBuy(root) : host.createSell(root));
      advance();
      return;
    case 11:
      if (child(0x1c) === 0) {
        start(0x88, 1);
        start(0x98, 1);
        write(STATE, 2);
      }
      return;
    case 20: {
      if (read(RETURN_TO_MENU) === 0) {
        const fade = host.createFade(root + 0x88);
        mem.write32(context + 0x20, fade);
        host.fadeStart(fade, 0, 0x1e);
      }
      start(0x88, 0);
      start(0x98, 0);
      for (const offset of [0x04, 0x10, 0x14]) host.textShow(child(offset), 0);
      host.cursorShow(child(0x18), 0);
      advance();
      return;
    }
    case 21:
      tick(0x88);
      if (tick(0x98)) {
        if (read(RETURN_TO_MENU) !== 0) {
          host.transition(root, 10);
        } else {
          start(0x68, 0);
          start(0x78, 0);
          for (const offset of [0x00, 0x0c, 0x08]) host.textShow(child(offset), 0);
          advance();
        }
      }
      return;
    case 22:
      tick(0x68);
      if (tick(0x78)) advance();
      return;
    case 23:
      if ((mem.read32(child(0x20) + 0x0c) | 0) === 2) write(0x0c, 3);
      return;
    default:
      start(0x68, 1);
      start(0x78, 1);
      advance();
  }
}
