// Resident font records and glyph metrics used by the translated shop widgets.
// The input is a data-only slice; no executable instructions are mounted.
import type { NativeMemory } from "../../native/memory.ts";

export const SHOP_FONT_BASE = 0x8004dd74;
export const SHOP_FONT_SIZE = 0x3492;

export function installShopFont(mem: NativeMemory, data: Uint8Array): void {
  if (data.length !== SHOP_FONT_SIZE) throw new Error("Invalid shop font data length");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0x8c, true) !== SHOP_FONT_BASE ||
      view.getUint32(0x90, true) !== 0x8004ddd4) {
    throw new Error("Invalid shop font pointer cells");
  }
  const basic = [0x8004e5a4, 0x8004f470, 0x8005033c];
  const extended = [0x8004ef88, 0x8004fe54, 0x80050d20];
  for (let kind = 1; kind <= 3; kind++) {
    const record = kind * 0x18;
    if (view.getUint32(record + 4, true) !== basic[kind - 1] ||
        view.getUint32(record + 8, true) !== extended[kind - 1] ||
        view.getInt16(record + 0x16, true) !== 114) {
      throw new Error(`Invalid shop font kind ${kind}`);
    }
  }
  mem.load(data, SHOP_FONT_BASE);
}
