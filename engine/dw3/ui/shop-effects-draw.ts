// The BUY actor's Effects card row draw, translated from pro/stitshop F0x8008A450.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-effects-draw-oracle.test.js runs the original through
// engine/native's draw-intent recorder and the port through an equivalent
// recorder, comparing the ordered intents and the roster/can-equip calls.
//
// DECODED: exe-decomp/stitshop_c/_asm/F0x8008a450.s (authority 2) and the
// accepted buysell-window-family answer U2; cross-checked against
// docs/research/ui/shop-system-decompiled.md 3d. The can't-equip predicate is
// the verified EQUIP-C015-shop-gear-access-bitmask path F0x8008C4CC; the roster
// accessor is [0x8004B44C]. Both are host boundaries here.
//
// Ordered intents:
//   initDrawContext; setLayer(band+0x50, band+0x54)   [no -1, unlike bandTick]
//   setOrigin(0x280, 0x100)
//   if band+0x20C != 0:
//     != 0x1000: setScale(band+0x20C, 1, 1); setPos(0, 0x8C)
//     drawSprite(STSHOP, 9, 0, 0x81)                  [prompt plate]
//   if band+0x22C != 0:
//     setScale(1, band+0x22C, 1)
//     for m in 0 .. band+0x60-1:
//       band+0x22C != 0x1000: setPos(0x3C+0x64*m, 0xC0)
//       else if canEquip(roster(m), band+0x1E4):
//         setOrigin(0x140, 0); for i < record+0xC0: icon > 0 ->
//           drawSprite(CMFONT, icon+0x24, table[0x8008CAB8+8i].x + 0x63*m, .y)
//       else: setOrigin(0x280,0x100); drawSprite(STSHOP, 0x16, 0x19+0x63*m, 0xAD)
//       setOrigin(0x280,0x100); drawSprite(STSHOP, 8, 0xB+0x63*m, 0x9C)
//
// Member records are 0x80 bytes at band+0xC0+0x80*m: count at +0x0, icon ids at
// +0x4+4*i. The icon placement table is overlay rodata at 0x8008CAB8 (x,y pairs).

import { PACK_CMFONT, PACK_STSHOP } from "./item-list-draw.ts";

export interface ShopEffectsMemory {
    read32(addr: number): number;
}

export interface ShopEffectsDrawHost {
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** packGetEntry handle -> directory pointer. */
    packResolve(handle: number): number;
    /** (*[0x8004B44C])(position) — party position -> roster slot. */
    rosterSlot(position: number): number;
    /** (*[0x8008D1CC])(slot, itemId) — F0x8008C4CC can-equip predicate. */
    canEquip(slot: number, itemId: number): number;
}

/** Band object fields read by this draw. */
export const SHOP_EFFECTS_FIELDS = {
    layer: 0x50,
    bucket: 0x54,
    memberCount: 0x60,
    recordBase: 0xc0,
    recordStride: 0x80,
    foldLeft: 0x20c,
    foldCards: 0x22c,
    itemId: 0x1e4,
} as const;
/** Overlay rodata table of (x, y) icon positions, 8 bytes each. */
export const ICON_POS_TABLE = 0x8008cab8;

/** F0x8008A450(band): draw the BUY Effects card row. */
export function shopEffectsCardDraw(
    mem: ShopEffectsMemory,
    band: number,
    host: ShopEffectsDrawHost,
): void {
    host.initDrawContext();
    host.setLayer(
        mem.read32(band + SHOP_EFFECTS_FIELDS.layer) | 0,
        mem.read32(band + SHOP_EFFECTS_FIELDS.bucket) | 0,
    );
    host.setOrigin(0x280, 0x100);

    const foldLeft = mem.read32(band + SHOP_EFFECTS_FIELDS.foldLeft) | 0;
    if (foldLeft !== 0) {
        if (foldLeft !== 0x1000) {
            host.setScale(foldLeft, 0x1000, 0x1000);
            host.setPos(0, 0x8c);
        }
        host.drawSprite(host.packResolve(PACK_STSHOP), 9, 0, 0x81);
    }

    const foldCards = mem.read32(band + SHOP_EFFECTS_FIELDS.foldCards) | 0;
    if (foldCards === 0) return;
    host.setScale(0x1000, foldCards, 0x1000);

    const members = mem.read32(band + SHOP_EFFECTS_FIELDS.memberCount) | 0;
    if (members <= 0) return;
    const itemId = mem.read32(band + SHOP_EFFECTS_FIELDS.itemId) | 0;
    let m = 0;
    do {
        const record = band + SHOP_EFFECTS_FIELDS.recordBase + Math.imul(m, SHOP_EFFECTS_FIELDS.recordStride);
        if ((mem.read32(band + SHOP_EFFECTS_FIELDS.foldCards) | 0) !== 0x1000) {
            host.setPos(0x3c + Math.imul(0x64, m), 0xc0);
        } else {
            const slot = host.rosterSlot(m) | 0;
            if ((host.canEquip(slot, itemId) | 0) !== 0) {
                host.setOrigin(0x140, 0);
                if ((mem.read32(record) | 0) > 0) {
                    let i = 0;
                    do {
                        const icon = mem.read32(record + 4 + Math.imul(4, i)) | 0;
                        if (icon > 0) {
                            host.drawSprite(
                                host.packResolve(PACK_CMFONT),
                                icon + 0x24,
                                (mem.read32(ICON_POS_TABLE + Math.imul(8, i)) | 0) + Math.imul(0x63, m),
                                mem.read32(ICON_POS_TABLE + Math.imul(8, i) + 4) | 0,
                            );
                        }
                        i += 1;
                        // The original re-reads the record count at the loop bottom.
                    } while (i < (mem.read32(record) | 0));
                }
            } else {
                host.setOrigin(0x280, 0x100);
                host.drawSprite(host.packResolve(PACK_STSHOP), 0x16, 0x19 + Math.imul(0x63, m), 0xad);
            }
        }
        host.setOrigin(0x280, 0x100);
        host.drawSprite(host.packResolve(PACK_STSHOP), 8, 0xb + Math.imul(0x63, m), 0x9c);
        m += 1;
    } while (m < (mem.read32(band + SHOP_EFFECTS_FIELDS.memberCount) | 0));
}
