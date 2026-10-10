// Resident inventory-directory collector used by the translated SELL list.
// Port of exe/f3 at 0x800135e8; its directory contents are installed as data.
// The admission rule itself is the shared one (engine/dw3/item-store.ts
// inventoryDirectoryAdmits), so this memory-side list and the walker's own store
// can never disagree about which ids a category contains.
import { inventoryDirectoryAdmits } from "../item-store.ts";
import { SHOP_INVENTORY_DIRECTORY_TABLE } from "./shop-catalog.ts";

export const SHOP_INVENTORY_SAVE = 0x80048d34;

export interface ShopInventoryMemory {
  read8(address: number): number;
  read16(address: number): number;
  read32(address: number): number;
  write16(address: number, value: number): void;
}

/** Copy held item IDs in directory order; a negative category also admits worn copies. */
export function enumerateShopInventory(
  mem: ShopInventoryMemory, category: number, destination: number,
): number {
  const requested = category | 0;
  const index = requested & 0x7fffffff;
  if (index >= 5) return 0;
  const directory = mem.read32(SHOP_INVENTORY_DIRECTORY_TABLE + index * 4) >>> 0;
  let count = 0;
  for (let cursor = directory, seen = 0; seen < 512; cursor += 2, seen++) {
    const item = mem.read16(cursor) & 0xffff;
    if (item === 0) return count;
    const held = mem.read8(SHOP_INVENTORY_SAVE + 0x7c + item);
    const worn = requested < 0 ? mem.read8(SHOP_INVENTORY_SAVE + 0x20f + item) : 0;
    if (inventoryDirectoryAdmits(held, worn, requested < 0)) {
      mem.write16(destination + count * 2, item);
      count++;
    }
  }
  throw new Error(`Inventory directory ${index} lacks a terminator`);
}
