// Complete SELL controller from pro/stitshop F0x80085F48. The object handles
// the category menu, held-item list, quantity, sale, empty-category message,
// and the return to the merchant root. Services are receiver-specific ports.

export interface ShopSellMachineMemory {
  read8(address: number): number;
  read16(address: number): number;
  read32(address: number): number;
  write8(address: number, value: number): void;
  write32(address: number, value: number): void;
}

export interface ShopSellMachineHost {
  foldStart(window: number, opening: number): void;
  foldTick(window: number): number;
  bankGet(bank: number): number;
  textSet(widget: number, bank: number, id: number): void;
  textNumber(widget: number, line: number, value: number): void;
  textFormat(widget: number, bank: number, id: number, count: number): void;
  textMeasure(widget: number, enabled: number): void;
  textShow(widget: number, visible: number): void;
  cursorPlace(widget: number, x: number, y: number): void;
  cursorShow(widget: number, visible: number): void;
  padPressed(): number;
  padRepeat(): number;
  padKey(code: number): number;
  playSound(id: number): void;
  /** Base task slot +0x2C; clears state fields +0x14 and +0x18. */
  transition(self: number, state: number): void;
  createList(self: number, category: number, mode: number): number;
  createBand(mode: number, itemId: number): number;
  listSelected(list: number): number;
  listCursor(list: number, visible: number): void;
  listStop(list: number): void;
  listHide(list: number): void;
  listRebuild(list: number): void;
  bandQuantity(band: number, itemId: number, quantity: number): void;
  bandLeave(band: number): void;
  itemRecord(itemId: number): number;
  rootRefresh(root: number, save: number): void;
}

const STATE = 0x10;
const FLAG = 0x14;
const CATEGORY = 0x60;
const ITEM = 0x64;
const QUANTITY = 0x68;
const HELD = 0x6c;
const CHOICE = 0x78;
const SAVE = 0x80048d34;
const MONEY = SAVE + 0x6c;
const HELD_BASE = SAVE + 0x7c;
const LANGUAGE = 0x8005cca8;
const CATEGORY_TABLE = 0x8008caa8;
const BIT_CAP = 0x98967f;
const SFX_MOVE = 0x8004513e;
const SFX_CONFIRM = 0x8004503c;
const SFX_CANCEL = 0x800450bd;
const SFX_QUANTITY = 0x4001b;
const SFX_APPLY = 0x4001c;

/** One complete SELL state-machine tick, with no instruction execution. */
export function shopSellMachine(
  mem: ShopSellMachineMemory,
  self: number,
  context: number,
  host: ShopSellMachineHost,
): void {
  const read = (offset: number): number => mem.read32(self + offset) | 0;
  const write = (offset: number, value: number): void => mem.write32(self + offset, value >>> 0);
  const child = (offset: number): number => mem.read32(context + offset) >>> 0;
  const advance = (): void => write(STATE, read(STATE) + 1);
  const start = (offset: number, on: number): void => host.foldStart(self + offset, on);
  const tick = (offset: number): number => host.foldTick(self + offset);
  const pressed = (code: number): boolean => ((host.padPressed() >> host.padKey(code)) & 1) !== 0;
  const repeating = (code: number): boolean => pressed(code) || ((host.padRepeat() >> host.padKey(code)) & 1) !== 0;
  const bank = (): number => host.bankGet((mem.read32(LANGUAGE) + 0x71) | 0);
  const text = (offset: number, id: number): void => host.textSet(child(offset), bank(), id);
  const list = (): number => child(0);
  const band = (): number => child(4);
  const cursor = (): number => child(8);

  switch (read(STATE)) {
    case 1:
      if (tick(0x7c)) {
        for (let i = 0; i < 4; i++) text(0x0c + i * 4, i + 0x1d);
        host.cursorPlace(cursor(), 0xb0, read(CATEGORY) * 0xe + 0x2f);
        host.cursorShow(cursor(), 1);
        advance();
      }
      return;
    case 2: {
      const old = read(CATEGORY);
      if (repeating(4)) write(CATEGORY, Math.max(0, old - 1));
      else if (repeating(6)) write(CATEGORY, Math.min(3, old + 1));
      if (old !== read(CATEGORY)) {
        host.playSound(SFX_MOVE);
        host.cursorPlace(cursor(), 0xb0, read(CATEGORY) * 0xe + 0x2f);
      }
      if (pressed(0x0d)) {
        host.playSound(SFX_CONFIRM);
        host.cursorShow(cursor(), 0);
        if (list()) mem.write32(list() + 0x0c, 3);
        advance();
      } else if (pressed(0x0e)) {
        host.playSound(SFX_CANCEL);
        host.transition(self, 0x32);
      }
      return;
    }
    case 3:
      if (!list()) {
        mem.write32(context, host.createList(self, mem.read32(CATEGORY_TABLE + read(CATEGORY) * 4) | 0, 1));
        advance();
      } else {
        mem.write32(list() + 0x0c, 3);
      }
      return;
    case 4:
      if ((mem.read32(list() + 0x10) | 0) === 0x64) {
        if ((mem.read32(list() + 0x6c0) | 0) > 0) {
          host.transition(self, 0x32);
          write(FLAG, 1);
        } else write(STATE, 0xc8);
      }
      return;
    case 0x64:
      mem.write32(list() + 0x10, 1);
      write(STATE, 0x65);
      return;
    case 0x65:
      if ((mem.read32(list() + 0x0c) | 0) === 2) {
        if (!band()) mem.write32(context + 4, host.createBand(1, host.listSelected(list())));
        write(STATE, 5);
      }
      return;
    case 5:
      if ((mem.read32(band() + 0x10) | 0) === 3) {
        host.listCursor(list(), 1);
        advance();
      }
      return;
    case 6:
      if (pressed(0x0d)) {
        host.playSound(SFX_CONFIRM);
        write(STATE, 0x14);
      } else if (pressed(0x0e)) {
        host.playSound(SFX_CANCEL);
        host.listStop(list());
        host.bandLeave(band());
        write(STATE, 0x28);
      }
      return;
    case 0x14:
      host.listStop(list());
      advance();
      return;
    case 0x15:
      if ((mem.read32(list() + 0x0c) | 0) === 2) {
        start(0x8c, 1);
        advance();
      }
      return;
    case 0x16:
      if (tick(0x8c)) {
        text(0x1c, 0x21);
        text(0x20, 8);
        host.textNumber(child(0x24), 0, read(QUANTITY));
        host.textMeasure(child(0x24), 1);
        const id = host.listSelected(list());
        write(ITEM, id);
        write(HELD, (mem.read8(HELD_BASE + id) << 24) >> 24);
        advance();
      }
      return;
    case 0x17: {
      const old = read(QUANTITY);
      let next = old;
      if (repeating(4)) next = Math.min(read(HELD), old + 1);
      else if (repeating(6)) next = Math.max(1, old - 1);
      else if (repeating(7)) next = old - 10 < 10 ? 1 : old - 10;
      else if (repeating(5)) next = Math.min(read(HELD), old + 10);
      write(QUANTITY, next);
      if (old !== read(QUANTITY)) {
        host.itemRecord(read(ITEM));
        host.textNumber(child(0x24), 0, read(QUANTITY));
        host.textMeasure(child(0x24), 1);
        host.bandQuantity(band(), read(ITEM), read(QUANTITY));
        host.playSound(SFX_QUANTITY);
      }
      if (pressed(0x0d)) {
        host.playSound(SFX_APPLY);
        write(FLAG, 0);
        advance();
      } else if (pressed(0x0e)) {
        host.playSound(SFX_CANCEL);
        write(QUANTITY, 1);
        host.bandQuantity(band(), read(ITEM), 1);
        write(FLAG, 1);
        advance();
      }
      return;
    }
    case 0x18:
      start(0x8c, 0);
      for (const offset of [0x1c, 0x20, 0x24]) host.textShow(child(offset), 0);
      if (read(FLAG)) {
        host.listHide(list());
        advance();
      } else host.transition(self, 0x1e);
      return;
    case 0x19:
      if ((mem.read32(list() + 0x10) | 0) === 0x64) mem.write32(list() + 0x10, 1);
      if (tick(0x8c)) advance();
      return;
    case 0x1a:
      if ((mem.read32(list() + 0x0c) | 0) === 2) {
        host.listCursor(list(), 1);
        write(STATE, 6);
      }
      return;
    case 0x1e:
      if (tick(0x8c)) {
        start(0x9c, 1);
        advance();
      }
      return;
    case 0x1f:
      if (tick(0x9c)) {
        text(0x28, 0x12);
        const price = mem.read16(host.itemRecord(read(ITEM)) + 6) & 0xffff;
        host.textNumber(child(0x28), 1, Math.imul(price, read(QUANTITY)) | 0);
        text(0x2c, 0x22);
        text(0x30, 0x14);
        write(CHOICE, 0);
        host.cursorPlace(cursor(), 0xb8, 0x49);
        host.cursorShow(cursor(), 1);
        advance();
      }
      return;
    case 0x20: {
      const old = read(CHOICE);
      if (pressed(4)) write(CHOICE, 0);
      else if (pressed(6)) write(CHOICE, 1);
      if (old !== read(CHOICE)) {
        host.playSound(SFX_MOVE);
        host.cursorPlace(cursor(), 0xb8, read(CHOICE) * 0x10 + 0x49);
        return;
      }
      if (pressed(0x0d)) {
        host.playSound(SFX_CONFIRM);
        if (read(CHOICE) === 0) {
          const price = mem.read16(host.itemRecord(read(ITEM)) + 6) & 0xffff;
          const total = (mem.read32(MONEY) + Math.imul(price, read(QUANTITY))) | 0;
          mem.write32(MONEY, total > BIT_CAP ? BIT_CAP : total);
          const held = (mem.read8(HELD_BASE + read(ITEM)) << 24) >> 24;
          mem.write8(HELD_BASE + read(ITEM), held - (read(QUANTITY) & 0xff));
          if (((mem.read8(HELD_BASE + read(ITEM)) << 24) >> 24) < 0)
            mem.write8(HELD_BASE + read(ITEM), 0);
          host.rootRefresh(read(0x54), SAVE);
        }
        host.listRebuild(list());
        advance();
      } else if (pressed(0x0e)) {
        host.playSound(SFX_CANCEL);
        advance();
      }
      return;
    }
    case 0x21:
      start(0x9c, 0);
      for (const offset of [0x28, 0x2c, 0x30]) host.textShow(child(offset), 0);
      host.cursorShow(cursor(), 0);
      if ((mem.read32(list() + 0x6c0) | 0) <= 0 && mem.read8(HELD_BASE + read(ITEM)) === 0) {
        write(QUANTITY, 1);
        mem.write32(list() + 0x0c, 3);
        host.bandLeave(band());
        write(STATE, 0x27);
      } else {
        host.listHide(list());
        advance();
      }
      return;
    case 0x22:
      if (!list()) {
        mem.write32(context, host.createList(self, mem.read32(CATEGORY_TABLE + read(CATEGORY) * 4) | 0, 1));
      } else if ((mem.read32(list() + 0x10) | 0) === 0x64) {
        mem.write32(list() + 0x10, 1);
        const page = mem.read32(list() + 0x6bc) | 0;
        if ((mem.read32(list() + 0x6c0) | 0) - 1 < page) mem.write32(list() + 0x6bc, page - 1);
        const row = mem.read32(list() + 0x6c4) | 0;
        if ((mem.read32(list() + 0x6c8) | 0) - 1 < row) mem.write32(list() + 0x6c4, row - 1);
        const id = host.listSelected(list());
        write(ITEM, id);
        write(QUANTITY, 1);
        host.bandQuantity(band(), id, 1);
      }
      if (tick(0x9c)) write(STATE, 0x1a);
      return;
    case 0x27:
      if (tick(0x9c)) write(STATE, 0x28);
      return;
    case 0x28:
      if (!band()) advance();
      return;
    case 0x29:
      write(STATE, 0);
      return;
    case 0xc8:
      start(0xbc, 1);
      advance();
      return;
    case 0xc9:
      if (tick(0xbc)) {
        text(0x34, 1);
        host.textFormat(child(0x34), bank(), read(CATEGORY) + 0x1d, 1);
        advance();
      }
      return;
    case 0xca:
      if (pressed(0x0d) || pressed(0x0e)) {
        host.playSound(SFX_APPLY);
        host.textShow(child(0x34), 0);
        start(0xbc, 0);
        advance();
      }
      return;
    case 0xcb:
      if (tick(0xbc)) {
        host.cursorShow(cursor(), 1);
        write(STATE, 2);
      }
      return;
    case 0x32:
      host.cursorShow(cursor(), 0);
      for (let i = 0; i < 4; i++) host.textShow(child(0x0c + i * 4), 0);
      start(0x7c, 0);
      advance();
      return;
    case 0x33:
      if (tick(0x7c)) {
        if (read(FLAG)) host.transition(self, 0x64);
        else write(0x0c, 3);
      }
      return;
    default:
      start(0x7c, 1);
      advance();
  }
}
