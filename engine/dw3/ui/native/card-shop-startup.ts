// The card shop screen's startup services: the text-bank request/pending pair
// and the label builder, translated bit-exactly from the original pro/stcrdshp
// overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/card-shop-startup.test.js runs the original through
// engine/native and compares the ordered service calls, the created label list
// and the pending result.
//
//   F0x80088E24  request the shop's text banks: build the resident sound object
//                (F0x8001FFA8), set its +0x24 to (0x280, 0) and its +0x2C to the
//                0x06420000 pack, then request the save-block-derived ids
//                +0x32 / +0x16 / +0x1D / +0x94 / +0x6A through [0x80044B38]+0x40C.
//   F0x80088EF4  report whether those banks are still pending: poll +0x32, +0x16,
//                +0x1D, +0x94 and +0x6A through [0x80044B38]+0x404, returning 1
//                as soon as one is busy and otherwise 1 only while +0x6A is busy.
//   F0x80087D00  build the shop's eleven label widgets into the caller's array
//                (arg1): four headers, three level labels, the level widget and
//                the shop-name label, then set the selected level widget's
//                +0x80 and each listed widget's +0x15C.
//
// The two bank slots (0x80044F44 / 0x80044F3C), the sound object, the pack
// resolver, the text/level widget constructors and the widget methods are host
// boundaries; the port preserves the exact call order and arguments. This is
// lane B (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts
// barrel and data/translated_functions.json.

import { SHOP_SAVE_PTR_CELL } from "./card-shop-screen.ts";

/** [0x80044B38]+0x40C: the text-bank request slot (0x80044F44). */
export const SHOP_BANK_REQUEST_SLOT = 0x80044f44;
/** [0x80044B38]+0x404: the text-bank pending slot (0x80044F3C). */
export const SHOP_BANK_PENDING_SLOT = 0x80044f3c;
/** The pack the shop's sound object binds. */
export const SHOP_BANK_PACK = 0x06420000;

export interface ShopStartupMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopBankHost {
    /** soundObject+slot(a, b) — the resident sound object's method. */
    soundCall(slot: number, a: number, b: number): void;
    /** [0x80044B38]+0x424(handle) — the pack resolver. */
    packResolve(handle: number): number;
    /** [0x80044B38]+0x40C(id) — request a text bank. */
    bankRequest(id: number): void;
    /** [0x80044B38]+0x404(id) — nonzero while that bank is still pending. */
    bankPending(id: number): number;
}

/** F0x80088E24(): request the shop's text banks. */
export function shopRequestTextBanks(mem: ShopStartupMemory, host: ShopBankHost): void {
    host.soundCall(0x24, 0x280, 0);
    host.soundCall(0x2c, host.packResolve(SHOP_BANK_PACK), 0);
    const save = mem.read32(SHOP_SAVE_PTR_CELL) | 0;
    host.bankRequest(save + 0x32);
    host.bankRequest(save + 0x16);
    host.bankRequest(save + 0x1d);
    host.bankRequest(save + 0x94);
    host.bankRequest(save + 0x6a);
}

/**
 * F0x80088EF4(): report whether the shop's text banks are still pending. Returns
 * 1 as soon as one of +0x32 / +0x16 / +0x1D / +0x94 is busy, and otherwise 1 only
 * while +0x6A is busy (0 when all five are idle).
 */
export function shopTextBanksPending(mem: ShopStartupMemory, host: ShopBankHost): number {
    const save = mem.read32(SHOP_SAVE_PTR_CELL) | 0;
    if ((host.bankPending(save + 0x32) | 0) !== 0) return 1;
    if ((host.bankPending(save + 0x16) | 0) !== 0) return 1;
    if ((host.bankPending(save + 0x1d) | 0) !== 0) return 1;
    if ((host.bankPending(save + 0x94) | 0) !== 0) return 1;
    return (host.bankPending(save + 0x6a) | 0) !== 0 ? 1 : 0;
}

export interface ShopLabelHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(target, kind, x, y) -> card-level widget pointer. */
    createLevelWidget(target: number, kind: number, x: number, y: number): number;
    /** widget+0x80(widget, value). */
    setWidget80(widget: number, value: number): void;
    /** widget+0x15C(widget, value). */
    setWidget15C(widget: number, value: number): void;
}

/** The label-array slots the builder writes, in creation order. */
export const SHOP_LABEL_SLOTS: ReadonlyArray<number> = [0x00, 0x04, 0x10, 0x0c, 0x14, 0x18, 0x1c, 0x20, 0x08];

function s16(v: number): number {
    return (v << 16) >> 16;
}

/** F0x80087D00(obj, labels): build the shop's label widgets. */
export function shopRootCreateLabels(
    mem: ShopStartupMemory,
    obj: number,
    labels: number,
    host: ShopLabelHost,
): void {
    const target = s16(mem.read16(obj + 0x50));
    mem.write32(labels + 0x00, host.createTextElement(target, 1, 0x1d, 0x16));
    mem.write32(labels + 0x04, host.createTextElement(target, 1, 0xd3, 0xcc));
    mem.write32(labels + 0x10, host.createTextElement(target, 3, 0x117, 0x1c));
    mem.write32(labels + 0x0c, host.createTextElement(target, 3, 0x11a, 0x1c));

    let y = 0x350000;
    for (let i = 0; i < 3; i++) {
        mem.write32(labels + 0x14 + i * 4, host.createTextElement(target, 1, 0xa7, y >> 16));
        y += 0xe0000;
    }

    const level = host.createLevelWidget(
        target,
        (mem.read32(obj + 0x54) | 0) - 2,
        0xa7,
        s16(Math.imul(mem.read32(obj + 0x6c) | 0, 0xe) + 0x35),
    );
    mem.write32(labels + 0x20, level);
    host.setWidget80(level, 0);

    mem.write32(labels + 0x08, host.createTextElement(target, 1, 0x9a, 0x71));

    const count = (mem.read32(obj + 0x20) | 0) - 3;
    const list = mem.read32(obj + 0x24) >>> 0;
    for (let i = 0; i < count; i++) {
        const widget = mem.read32(list + i * 4) >>> 0;
        host.setWidget15C(widget, (mem.read32(obj + 0x54) | 0) - 2);
    }
}
