// The BUY controller's quantity and confirmation widget updates from stitshop
// F0x800836F8 and F0x80083810. Widget methods themselves are shared ports.

export interface ShopBuyLinesMemory {
  read16(address: number): number;
  read32(address: number): number;
}

export interface ShopBuyLinesHost {
  bankGet(bank: number): number;
  itemRecord(itemId: number): number;
  textSet(widget: number, source: number, id: number): void;
  textNumber(widget: number, line: number, value: number): void;
  textShow(widget: number, visible: number): void;
  textMeasure(widget: number, enabled: number): void;
}

const LANGUAGE = 0x8005cca8;
const SHOP_BANK_OFFSET = 0x71;

/** F0x800836F8: fill or hide "How many?", its marker, and the quantity. */
export function shopBuyQuantityLine(
  mem: ShopBuyLinesMemory, host: ShopBuyLinesHost,
  actor: number, context: number, show: number,
): void {
  const widget = (off: number) => mem.read32(context + off) >>> 0;
  if (show !== 0) {
    host.textSet(widget(0x08), host.bankGet((mem.read32(LANGUAGE) + SHOP_BANK_OFFSET) | 0), 17);
    host.textSet(widget(0x0c), host.bankGet((mem.read32(LANGUAGE) + SHOP_BANK_OFFSET) | 0), 8);
    host.textNumber(widget(0x10), 0, mem.read32(actor + 0x64) | 0);
    host.textMeasure(widget(0x10), 1);
  } else {
    for (const off of [0x08, 0x0c, 0x10]) host.textShow(widget(off), 0);
  }
}

/** F0x80083810: fill or hide the total, Buy and No lines. */
export function shopBuyConfirmLine(
  mem: ShopBuyLinesMemory, host: ShopBuyLinesHost,
  actor: number, context: number, show: number,
): void {
  const widget = (off: number) => mem.read32(context + off) >>> 0;
  if (show !== 0) {
    host.textSet(widget(0x14), host.bankGet((mem.read32(LANGUAGE) + SHOP_BANK_OFFSET) | 0), 18);
    const item = mem.read32(actor + 0x60) | 0;
    const price = mem.read16(host.itemRecord(item) + 4) & 0xffff;
    const quantity = mem.read32(actor + 0x64) | 0;
    host.textNumber(widget(0x14), 1, Math.imul(price, quantity));
    host.textSet(widget(0x18), host.bankGet((mem.read32(LANGUAGE) + SHOP_BANK_OFFSET) | 0), 19);
    host.textSet(widget(0x1c), host.bankGet((mem.read32(LANGUAGE) + SHOP_BANK_OFFSET) | 0), 20);
  } else {
    for (const off of [0x14, 0x18, 0x1c]) host.textShow(widget(off), 0);
  }
}
