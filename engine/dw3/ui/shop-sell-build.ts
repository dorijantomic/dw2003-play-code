// The item shop's SELL-list builder, translated from pro/stitshop F0x800888E4.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-sell-build-oracle.test.js runs the original through
// engine/native with the 0x80042B98 table calls stubbed and compares the whole
// object to the port.
//
// DECODED: exe-decomp/stitshop_c/F0x800888e4.c and _asm/F0x800888e4.s, which
// agree; accepted shop-stock-source answer UNIT 3 (the player's held items,
// filtered by a nonzero sell price).
//
//   F0x800888E4(obj):
//     obj+0x6C0 = 0
//     count = (*(0x80042B98+0xC))(obj+0x60, obj+0x38C)   // category, buffer
//     for i = 0 .. count-1 (only when count > 0):
//       id = (s16) obj+0x38C + 2*i
//       if ((u16) (*(0x80042B98+0x0))(id))->+0x6 != 0:   // sell price nonzero
//         n = obj+0x6C0
//         (u16) obj+0x64 + 2*n = id
//         obj+0x6C0 = n + 1
//
// The buffer id is read signed (`lh`) for the record lookup and stored unsigned
// (`lhu`); the sell price at record+0x6 is unsigned (`lhu`). The 0x80042B98
// table's two functions (inventory enumeration and the item-record getter) are
// resident and are explicit host boundaries.

export interface ShopSellMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ShopSellHost {
    /** 0x80042B98+0xC(category, buffer): fill `buffer` with inventory ids; return the count. */
    enumerateInventory(category: number, buffer: number): number;
    /** 0x80042B98+0x0(id): the item record; +0x6 is the sell price as u16. */
    itemRecord(id: number): number;
}

/** Object fields the SELL builder touches. */
export const SHOP_SELL_FIELDS = {
    category: 0x60,
    count: 0x6c0,
    inlineIds: 0x64,
    buffer: 0x38c,
} as const;
/** Offset of the sell price inside an item record. */
export const ITEM_RECORD_SELL_PRICE = 0x6;

/** F0x800888E4(obj): rebuild the SELL list's inline id array. */
export function shopSellBuild(
    mem: ShopSellMemory,
    host: ShopSellHost,
    obj: number,
): void {
    mem.write32(obj + SHOP_SELL_FIELDS.count, 0);
    const buffer = (obj + SHOP_SELL_FIELDS.buffer) >>> 0;
    const count = host.enumerateInventory(mem.read32(obj + SHOP_SELL_FIELDS.category) | 0, buffer) | 0;
    if (count <= 0) return;

    for (let i = 0; i < count; i++) {
        // `lh`: the record lookup sees a signed id.
        const id = (mem.read16(buffer + Math.imul(i, 2)) << 16) >> 16;
        const record = host.itemRecord(id) >>> 0;
        if ((mem.read16(record + ITEM_RECORD_SELL_PRICE) & 0xffff) !== 0) {
            const n = mem.read32(obj + SHOP_SELL_FIELDS.count) | 0;
            // `lhu`: the stored id is unsigned.
            mem.write16(obj + SHOP_SELL_FIELDS.inlineIds + Math.imul(n, 2), id & 0xffff);
            mem.write32(obj + SHOP_SELL_FIELDS.count, n + 1);
        }
    }
}
