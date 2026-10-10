// The shop stock loader, translated from pro/stitshop F0x8008C488.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-stock-oracle.test.js runs the original through
// engine/native and compares the return value and the written stock cell.
//
// DECODED: exe-decomp/stitshop_c/F0x8008c488.c and the accepted
// shop-stock-source answer UNIT 2 (the BUY list's stock source). F0x8008C488 is
// the function the list init reaches through [0x8008D1AC]+0x1C:
//
//   record = 0x8008D0B4 + shopId*8
//   stock  = record+0x4
//   if shopId < 0 or stock == 0: return 0
//   0x8008D1AC = record+0x0        (the entry count the init copies to +0x6C0)
//   return stock
//
// No calls: the only host interaction is message memory.

export interface ShopStockMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The per-shop stock record table base. */
export const SHOP_STOCK_RECORDS = 0x8008d0b4;
/** The cell holding the last loaded shop's entry count. */
export const SHOP_STOCK_CELL = 0x8008d1ac;

/** F0x8008C488(shopId): load the shop's stock table, return 0 when absent. */
export function shopLoad(mem: ShopStockMemory, shopId: number): number {
    const id = shopId | 0;
    if (id < 0) return 0;
    const record = (SHOP_STOCK_RECORDS + Math.imul(id, 8)) >>> 0;
    const stock = mem.read32(record + 4) >>> 0;
    if (stock === 0) return 0;
    mem.write32(SHOP_STOCK_CELL, mem.read32(record) >>> 0);
    return stock;
}
