// The item shop's BUY state machine, translated from pro/stitshop F0x80083EB0.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-buy-machine-oracle.test.js runs the original through
// engine/native on the shipped pro_stitshop.bin + resident.bin with the list,
// band, message, fold, pad, sound and item-table services recorded, state by
// state.
//
// DECODED: authority-2 closure `_asm/F0x80083eb0.s` (3410 instructions), the
// m2c body `exe-decomp/stitshop_c/F0x80083eb0.c` (729 lines) and the accepted
// `stitshop-remaining-contract`. The dispatcher reads `self+0x10` and jumps
// through the overlay's own 51-word table at 0x80082CB0 (the overlay's first
// 0xCC bytes); states 0, 13, 14, 19, 22, 23, 24, 41..44 and 49 share the
// default arm. The six addresses the coverage report lists as separate rows
// (0x80083F04, 0x80083F30, 0x80083F7C, 0x80083FA8, 0x8008574C, 0x8008585C) are
// this function's own switch arms, not functions.
//
// Player-visible result: the shop's BUY tab. State 3 is the list with its
// cursor (Cross picks, Triangle folds the list away and leaves, Circle swaps to
// the Effects cards); Cross on an unaffordable item or a full stack shows the
// reject plate and enters state 0x2D; states 5..8 are the "How many?" spinner
// with the money/ceiling clamp and the hundred-step moves; state 17 is the
// Buy/No plate committing the purchase (held count, money, band refresh); 18..21
// fold the list away; 25..40 the Equip flow; 45..47 the reject plate's apply
// tick; 50 tears the screen down.

/** The machine's own fields and the context's. */
export const BUY_FIELDS = {
    state: 0x10,
    lifecycle: 0x0c,
    flag14: 0x14,
    itemId: 0x60,
    quantity: 0x64,
    ceiling: 0x68,
    cursor: 0x74,
    member: 0x78,
    flag7C: 0x7c,
    fold0: 0x88,
    fold1: 0x98,
    fold2: 0xa8,
    fold3: 0xb8,
    root: 0x54,
    transition: 0x2c,
    baseAdvance: 0x3c,
} as const;

export const BUY_CTX = {
    list: 0x00,
    band: 0x04,
    message: 0x14,
    message2: 0x18,
    message3: 0x1c,
    plate: 0x20,
} as const;

/** The resident service cells the machine drives. */
export const BUY_ITEM_TABLE = 0x80042b98;
export const BUY_SAVE = 0x80048d34;
export const BUY_MONEY = 0x80048d34 + 0x6c;
export const BUY_HELD_BASE = 0x80048d34 + 0x7c;
export const BUY_LANGUAGE_PTR = 0x8005cca8;
export const BUY_BANK_GETTER = 0x80044f4c;
/** The fold helpers the machine reads through. */
export const BUY_FOLD_START_CELL = 0x8008d1b8;
export const BUY_FOLD_TICK_CELL = 0x8008d1bc;
export const BUY_PARTY_CELL = 0x8004b44c;
export const BUY_MEMBER_HELPER_CELL = 0x8008d1ac;
export const BUY_SOUND_CELL = 0x80055c48;

/** The sound ids the machine plays. */
export const BUY_SFX_CONFIRM = 0x8004503c;
export const BUY_SFX_CANCEL = 0x800450bd;
export const BUY_SFX_MOVE = 0x8004513e;
export const BUY_SFX_QTY = 0x40000 | 0x1b;
export const BUY_SFX_APPLY = 0x4001c;
/** The message-bank offset every message id is fetched through. */
export const BUY_BANK_MESSAGE = 0x71;
/** The reject/commit quantities. */
export const BUY_HELD_MAX = 0x63;
export const BUY_QTY_MAX = 0x63;

const s8 = (v: number): number => (v << 24) >> 24;
const s32 = (v: number): number => v | 0;

export interface ShopBuyMemory {
    read8(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ShopBuyHost {
    /** F0x800889A8(self, itemId, 0): build the list object. */
    createList(self: number, itemId: number): number;
    /** F0x8008B484(0, itemId): build the item's info band. */
    createBand(kind: number, itemId: number): number;
    /** F0x800836F8(self, ctx, flag): refresh the qty plate. */
    refreshQuantityPlate(self: number, ctx: number, flag: number): void;
    /** F0x80083810(self, ctx, flag): refresh the buy band. */
    refreshBand(self: number, ctx: number, flag: number): void;
    /** self+0x2C(self, state): the machine's transition setter. */
    selfTransition(self: number, state: number): void;
    /** self+0x3C(self): the machine's base advance. */
    selfBaseAdvance(self: number): void;
    /** band+0x3C(band): the band's own reset the equip flow calls. */
    bandReset(band: number): void;
    /** list+0x6E8(list): hide the list. */
    listHide(list: number): void;
    /** list+0x6EC(list): tear the list controller down. */
    listTeardown(list: number): void;
    /** list+0x6F0(list): the highlighted item id. */
    listItemId(list: number): number;
    /** list+0x6F4(list, show): place/show or hide the cursor. */
    listCursor(list: number, show: number): void;
    /** list+0x6F8(list, on): toggle the list's effects-card mode. */
    listCards(list: number, on: number): void;
    /** band+0x234(band, itemId, quantity): the price plate. */
    bandQuantity(band: number, itemId: number, quantity: number): void;
    /** band+0x238(band): begin the band's fold. */
    bandFold(band: number): void;
    /** band+0x240(band): reverse the band. */
    bandReverse(band: number): void;
    /** band+0x244(band, index): highlight one band entry. */
    bandHighlight(band: number, index: number): void;
    /** the root's +0xA8(root): commit the inventory change. */
    rootCommit(root: number): void;
    /** widget+0x114(widget, source, id): set a message line. */
    messageSet(widget: number, source: number, id: number): void;
    /** widget+0x144(widget, value): show or hide a message. */
    messageShow(widget: number, value: number): void;
    /** widget+0x80(widget, value): the plate's mode. */
    plateMode(widget: number, value: number): void;
    /** widget+0x84(widget, x, y): the plate's position. */
    platePos(widget: number, x: number, y: number): void;
    /** [0x8008D1B8](window, on): start a fold. */
    foldStart(window: number, on: number): void;
    /** [0x8008D1BC](window): nonzero once the fold has landed. */
    foldTick(window: number): number;
    /** [0x8008D1AC]+0x20(member, itemId): does this member have the item? */
    memberHas(member: number, itemId: number): number;
    /** [0x8008D1AC]+0x24(member, itemId): the member's item entry. */
    memberEntry(member: number, itemId: number): number;
    /** [0x8008D1AC]+0x28(entry, slot, itemId, flag): move the item across. */
    memberMove(entry: number, slot: number, itemId: number, flag: number): void;
    /** [0x8004B44C](index): the party slot's context. */
    partySlot(index: number): number;
    /** [0x80042B98](itemId): the item record. */
    itemRecord(itemId: number): number;
    /** [0x80042B98]+8(itemId, slot): the item's equip mask test. */
    itemHasSlot(itemId: number, slot: number): number;
    /** [0x80044F4C](language + offset): the text-bank handle. */
    bankGet(id: number): number;
    /** [0x8004B7D0]+0x3F4(0): the pad word pressed this frame. */
    padPressed(port: number): number;
    /** [0x8004B7D0]+0x3FC(0): the pad word auto-repeating. */
    padRepeat(port: number): number;
    /** [0x8004B7D0]+0x408(0, code): the keymap shift for a button. */
    padKey(port: number, code: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
}

/** (pressed >> key(code)) & 1, with the repeat word ORed in. */
function padBitRepeat(host: ShopBuyHost, code: number): boolean {
    const pressed = host.padPressed(0) | 0;
    if (((pressed >> host.padKey(0, code)) & 1) !== 0) return true;
    const repeat = host.padRepeat(0) | 0;
    return ((repeat >> host.padKey(0, code)) & 1) !== 0;
}

/** (pressed >> key(code)) & 1. */
function padBit(host: ShopBuyHost, code: number): boolean {
    return (((host.padPressed(0) | 0) >> host.padKey(0, code)) & 1) !== 0;
}

/**
 * F0x80083EB0(self, ctx): one tick of the shop's BUY tab. States are dispatched
 * through the overlay's own 51-word table; every arm either returns without a
 * state change, advances one state, or jumps to a later state explicitly.
 */
export function shopBuyMachine(
    mem: ShopBuyMemory, self: number, ctx: number, host: ShopBuyHost,
): void {
    const state = mem.read32(self + BUY_FIELDS.state) | 0;
    const advance = (): void => {
        mem.write32(self + BUY_FIELDS.state, ((mem.read32(self + BUY_FIELDS.state) | 0) + 1) | 0);
    };
    const list = (): number => mem.read32(ctx + BUY_CTX.list) >>> 0;
    const band = (): number => mem.read32(ctx + BUY_CTX.band) >>> 0;
    const listField = (off: number): number => mem.read32(list() + off) | 0;
    const bandField = (off: number): number => mem.read32(band() + off) | 0;
    const advanceAfter = (call: () => void): void => { call(); advance(); };
    const messageId = (id: number): number => host.bankGet((mem.read32(BUY_LANGUAGE_PTR) | 0) + BUY_BANK_MESSAGE);
    const playSound = (id: number): void => host.playSound(id);
    const itemPrice = (itemId: number): number => mem.read16s(host.itemRecord(itemId) + 0x04) & 0xffff;
    const held = (itemId: number): number => s8(mem.read8(BUY_HELD_BASE + itemId));
    const money = (): number => mem.read32(BUY_MONEY) | 0;

    switch (state) {
        default: {
            if ((mem.read32(ctx + BUY_CTX.list) >>> 0) === 0) {
                const root = mem.read32(self + BUY_FIELDS.root) >>> 0;
                mem.write32(ctx + BUY_CTX.list, host.createList(self, mem.read32(root + 0x60) | 0) >>> 0);
            }
            advance();
            return;
        }
        case 1:
            if (listField(0x0c) === 2) {
                if ((mem.read32(ctx + BUY_CTX.band) >>> 0) === 0) {
                    const item = host.listItemId(list()) | 0;
                    mem.write32(ctx + BUY_CTX.band, host.createBand(0, item) >>> 0);
                }
                advance();
            }
            return;

        case 2:
            if (bandField(0x10) === 3) {
                advanceAfter(() => host.listCursor(list(), 1));
            }
            return;

        case 3: {
            if (padBit(host, 0xd)) {
                playSound(BUY_SFX_CONFIRM);
                const item = host.listItemId(list()) | 0;
                mem.write32(self + BUY_FIELDS.itemId, item >>> 0);
                if (held(item) === BUY_HELD_MAX) {
                    host.messageSet(mem.read32(ctx + BUY_CTX.message) >>> 0, messageId(0), 0x1c);
                    host.messageShow(mem.read32(ctx + BUY_CTX.message) >>> 0, 0);
                    mem.write32(self + BUY_FIELDS.state, 0x2d);
                    return;
                }
                if (money() < itemPrice(item)) {
                    host.messageSet(mem.read32(ctx + BUY_CTX.message) >>> 0, messageId(0), 0x1b);
                    host.messageShow(mem.read32(ctx + BUY_CTX.message) >>> 0, 0);
                    mem.write32(self + BUY_FIELDS.state, 0x2d);
                    return;
                }
                host.listCursor(list(), 0);
                mem.write32(self + BUY_FIELDS.state, 5);
                return;
            }
            if (padBit(host, 0xe)) {
                playSound(BUY_SFX_CANCEL);
                host.listTeardown(list());
                host.bandFold(band());
                mem.write32(self + BUY_FIELDS.state, 0x32);
                return;
            }
            if (padBit(host, 0xc)) {
                if (bandField(0x10) === 3) {
                    host.bandReverse(band());
                    host.listCards(list(), 1);
                    mem.write32(self + BUY_FIELDS.state, 4);
                }
            }
            return;
        }

        case 4: {
            const b = bandField(0x10);
            if (b === 3) {
                host.listCards(list(), 0);
                mem.write32(self + BUY_FIELDS.state, b);
            }
            return;
        }

        case 5: {
            host.listTeardown(list());
            let unit = itemPrice(mem.read32(self + BUY_FIELDS.itemId) | 0);
            if (unit === 0) unit = 1;
            let ceiling = Math.trunc(money() / unit);
            mem.write32(self + BUY_FIELDS.ceiling, ceiling | 0);
            const already = held(mem.read32(self + BUY_FIELDS.itemId) | 0);
            if (ceiling + already >= 0x64) {
                ceiling = BUY_HELD_MAX - already;
                mem.write32(self + BUY_FIELDS.ceiling, ceiling | 0);
            }
            advance();
            return;
        }

        case 6: {
            if (listField(0x0c) === 2) {
                advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold0, 1));
            }
            return;
        }

        case 7:
            if ((host.foldTick(self + BUY_FIELDS.fold0) | 0) !== 0) {
                host.refreshQuantityPlate(self, ctx, 1);
                advance();
            }
            return;

        case 8: {
            const before = mem.read32(self + BUY_FIELDS.quantity) | 0;
            if (padBitRepeat(host, 4)) {
                const next = before + 1;
                mem.write32(self + BUY_FIELDS.quantity, next | 0);
                if ((mem.read32(self + BUY_FIELDS.ceiling) | 0) < next) {
                    mem.write32(self + BUY_FIELDS.quantity, mem.read32(self + BUY_FIELDS.ceiling) | 0);
                }
            } else if (padBitRepeat(host, 6)) {
                const next = before - 1;
                mem.write32(self + BUY_FIELDS.quantity, next | 0);
                if (next <= 0) mem.write32(self + BUY_FIELDS.quantity, 1);
            } else if (padBitRepeat(host, 7)) {
                const next = before - 0xa;
                mem.write32(self + BUY_FIELDS.quantity, next | 0);
                if (next < 0xa) mem.write32(self + BUY_FIELDS.quantity, 1);
            } else if (padBitRepeat(host, 5)) {
                const next = before + 0xa;
                mem.write32(self + BUY_FIELDS.quantity, next | 0);
                if ((mem.read32(self + BUY_FIELDS.ceiling) | 0) < next) {
                    mem.write32(self + BUY_FIELDS.quantity, mem.read32(self + BUY_FIELDS.ceiling) | 0);
                }
            }
            if (before !== (mem.read32(self + BUY_FIELDS.quantity) | 0)) {
                const unit = itemPrice(mem.read32(self + BUY_FIELDS.itemId) | 0);
                const qty = mem.read32(self + BUY_FIELDS.quantity) | 0;
                if (money() < unit * qty) {
                    const clamped = Math.trunc(money() / unit);
                    mem.write32(self + BUY_FIELDS.quantity, clamped | 0);
                }
                host.refreshQuantityPlate(self, ctx, 1);
                host.bandQuantity(band(), mem.read32(self + BUY_FIELDS.itemId) | 0, mem.read32(self + BUY_FIELDS.quantity) | 0);
                playSound(BUY_SFX_QTY);
                return;
            }
            if (padBit(host, 0xd)) {
                playSound(BUY_SFX_APPLY);
                host.selfBaseAdvance(self);
                return;
            }
            if (padBit(host, 0xe)) {
                playSound(BUY_SFX_CANCEL);
                host.selfBaseAdvance(self);
                mem.write32(self + BUY_FIELDS.flag14, 1);
                mem.write32(self + BUY_FIELDS.quantity, 1);
                host.bandQuantity(band(), mem.read32(self + BUY_FIELDS.itemId) | 0, 1);
                return;
            }
            if (padBit(host, 0xc)) {
                if (bandField(0x10) === 3) {
                    host.bandReverse(band());
                    mem.write32(self + BUY_FIELDS.state, 0x0c);
                }
            }
            return;
        }

        case 9:
            host.refreshQuantityPlate(self, ctx, 0);
            advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold0, 0));
            return;

        case 10:
            if ((host.foldTick(self + BUY_FIELDS.fold0) | 0) !== 0) {
                if ((mem.read32(self + BUY_FIELDS.flag14) | 0) !== 0) {
                    host.listHide(list());
                    host.selfBaseAdvance(self);
                    return;
                }
                mem.write32(self + BUY_FIELDS.state, 0x0f);
            }
            return;

        case 11: {
            const listState = listField(0x0c);
            if (listState === 2) {
                host.listCursor(list(), 1);
                mem.write32(self + BUY_FIELDS.state, listState);
            }
            return;
        }

        case 12:
            if (bandField(0x10) === 3) mem.write32(self + BUY_FIELDS.state, 8);
            return;

        case 15:
            advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold1, 1));
            return;

        case 16:
            if ((host.foldTick(self + BUY_FIELDS.fold1) | 0) !== 0) {
                host.refreshBand(self, ctx, 1);
                mem.write32(self + BUY_FIELDS.cursor, 0);
                host.platePos(mem.read32(ctx + BUY_CTX.plate) >>> 0, 0xb8, 0x49);
                advanceAfter(() => host.plateMode(mem.read32(ctx + BUY_CTX.plate) >>> 0, 1));
            }
            return;

        case 17: {
            const before = mem.read32(self + BUY_FIELDS.cursor) | 0;
            if (padBit(host, 4)) {
                mem.write32(self + BUY_FIELDS.cursor, 0);
            } else if (padBit(host, 6)) {
                mem.write32(self + BUY_FIELDS.cursor, 1);
            }
            if (before !== (mem.read32(self + BUY_FIELDS.cursor) | 0)) {
                playSound(BUY_SFX_MOVE);
                host.platePos(mem.read32(ctx + BUY_CTX.plate) >>> 0, 0xb8,
                    ((mem.read32(self + BUY_FIELDS.cursor) | 0) * 0x10) + 0x49);
                return;
            }
            if (bandField(0x1f0) !== 0 && padBit(host, 0xd)) {
                playSound(BUY_SFX_CONFIRM);
                host.selfTransition(self, 0x14);
                if ((mem.read32(self + BUY_FIELDS.cursor) | 0) === 0) {
                    const item = mem.read32(self + BUY_FIELDS.itemId) | 0;
                    if (host.itemHasSlot(item, 3) !== 0 || host.itemHasSlot(item, 4) !== 0
                        || host.itemHasSlot(item, 5) !== 0) {
                        mem.write32(self + BUY_FIELDS.flag14, 1);
                    }
                    const qty = mem.read32(self + BUY_FIELDS.quantity) | 0;
                    let next = BUY_HELD_MAX;
                    if (held(item) + qty < 0x64) next = (held(item) + qty) & 0xff;
                    mem.write8(BUY_HELD_BASE + item, next);
                    host.bandQuantity(band(), item, qty);
                    mem.write32(BUY_MONEY, (money() - (itemPrice(item) * qty)) | 0);
                    const root = mem.read32(self + BUY_FIELDS.root) >>> 0;
                    host.rootCommit(root);
                    return;
                }
            } else {
                if (padBit(host, 0xe)) {
                    playSound(BUY_SFX_CANCEL);
                    host.selfTransition(self, 0x14);
                    return;
                }
                if (padBit(host, 0xc)) {
                    if (bandField(0x10) === 3) {
                        host.bandReverse(band());
                        mem.write32(self + BUY_FIELDS.state, 0x12);
                        return;
                    }
                }
            }
            return;
        }

        case 18:
            if (bandField(0x10) === 3) mem.write32(self + BUY_FIELDS.state, 0x11);
            return;

        case 20:
            mem.write32(self + BUY_FIELDS.quantity, 1);
            host.bandQuantity(band(), mem.read32(self + BUY_FIELDS.itemId) | 0, 1);
            host.refreshBand(self, ctx, 0);
            host.plateMode(mem.read32(ctx + BUY_CTX.plate) >>> 0, 0);
            advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold1, 0));
            return;

        case 21:
            if ((host.foldTick(self + BUY_FIELDS.fold1) | 0) !== 0) {
                if ((mem.read32(self + BUY_FIELDS.flag14) | 0) !== 0) {
                    let count = 0;
                    for (let i = 0; i < 3; i++) {
                        if (host.memberHas(host.partySlot(i), mem.read32(self + BUY_FIELDS.itemId) | 0) !== 0) count += 1;
                    }
                    if (count !== 0) {
                        host.selfTransition(self, 0x19);
                        return;
                    }
                    mem.write32(self + BUY_FIELDS.state, 0x0a);
                    mem.write32(self + BUY_FIELDS.flag14, 1);
                    return;
                }
                mem.write32(self + BUY_FIELDS.state, 0x0a);
                mem.write32(self + BUY_FIELDS.flag14, 1);
            }
            return;

        case 25:
            if (bandField(0x1f0) !== 0) {
                host.bandReset(band());
                host.foldStart(self + BUY_FIELDS.fold1, 1);
                advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold2, 1));
            }
            return;

        case 26:
            host.foldTick(self + BUY_FIELDS.fold1);
            if ((host.foldTick(self + BUY_FIELDS.fold2) | 0) !== 0) {
                host.messageSet(mem.read32(ctx + BUY_CTX.message) >>> 0, messageId(0), 0x15);
                host.messageSet(mem.read32(ctx + BUY_CTX.message2) >>> 0, messageId(0), 0x16);
                host.messageSet(mem.read32(ctx + BUY_CTX.message3) >>> 0, messageId(0), 0x17);
                mem.write32(self + BUY_FIELDS.cursor, 0);
                host.platePos(mem.read32(ctx + BUY_CTX.plate) >>> 0, 0xb8, 0x49);
                advanceAfter(() => host.plateMode(mem.read32(ctx + BUY_CTX.plate) >>> 0, 1));
            }
            return;

        case 27: {
            const beforeChoice = mem.read32(self + BUY_FIELDS.cursor) | 0;
            if (padBit(host, 4)) {
                mem.write32(self + BUY_FIELDS.cursor, 0);
            } else if (padBit(host, 6)) {
                mem.write32(self + BUY_FIELDS.cursor, 1);
            }
            if (beforeChoice !== (mem.read32(self + BUY_FIELDS.cursor) | 0)) {
                playSound(BUY_SFX_MOVE);
                host.platePos(mem.read32(ctx + BUY_CTX.plate) >>> 0, 0xb8,
                    ((mem.read32(self + BUY_FIELDS.cursor) | 0) * 0x10) + 0x49);
            }
            if (padBit(host, 0xd)) {
                playSound(BUY_SFX_CONFIRM);
                host.selfBaseAdvance(self);
                if ((mem.read32(self + BUY_FIELDS.cursor) | 0) === 0) {
                    mem.write32(self + BUY_FIELDS.flag14, 1);
                    return;
                }
            } else if (padBit(host, 0xe)) {
                playSound(BUY_SFX_CANCEL);
                host.selfBaseAdvance(self);
                return;
            }
            return;
        }

        case 28:
            host.messageShow(mem.read32(ctx + BUY_CTX.message) >>> 0, 0);
            host.messageShow(mem.read32(ctx + BUY_CTX.message2) >>> 0, 0);
            host.messageShow(mem.read32(ctx + BUY_CTX.message3) >>> 0, 0);
            host.plateMode(mem.read32(ctx + BUY_CTX.plate) >>> 0, 0);
            host.foldStart(self + BUY_FIELDS.fold1, 0);
            if ((mem.read32(self + BUY_FIELDS.flag14) | 0) === 0) {
                advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold2, 0));
                return;
            }
            advance();
            return;

        case 29:
            if ((mem.read32(self + BUY_FIELDS.flag14) | 0) === 0) host.foldTick(self + BUY_FIELDS.fold2);
            if ((host.foldTick(self + BUY_FIELDS.fold1) | 0) !== 0) {
                if ((mem.read32(self + BUY_FIELDS.flag14) | 0) !== 0) {
                    host.selfTransition(self, 0x1e);
                    return;
                }
                mem.write32(self + BUY_FIELDS.state, 0x0a);
                mem.write32(self + BUY_FIELDS.flag14, 1);
                host.bandReset(band());
            }
            return;

        case 30:
            advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold2, 1));
            return;

        case 31:
            if ((host.foldTick(self + BUY_FIELDS.fold2) | 0) !== 0) {
                if ((mem.read32(self + BUY_FIELDS.flag14) | 0) === 0) {
                    mem.write32(self + BUY_FIELDS.member, 0);
                    while ((host.memberHas(host.partySlot(mem.read32(self + BUY_FIELDS.member) | 0),
                        mem.read32(self + BUY_FIELDS.itemId) | 0) | 0) === 0) {
                        const next = (mem.read32(self + BUY_FIELDS.member) | 0) + 1;
                        mem.write32(self + BUY_FIELDS.member, next | 0);
                        if (next >= 3) break;
                    }
                }
                mem.write32(self + BUY_FIELDS.flag7C, 1);
                host.messageSet(mem.read32(ctx + BUY_CTX.message) >>> 0, messageId(0), 0x10);
                advance();
            }
            return;

        case 32: {
            const before = mem.read32(self + BUY_FIELDS.member) | 0;
            if (!padBitRepeat(host, 7)) {
                if (padBitRepeat(host, 5)) {
                    for (;;) {
                        const next = (mem.read32(self + BUY_FIELDS.member) | 0) + 1;
                        mem.write32(self + BUY_FIELDS.member, next | 0);
                        const last = bandField(0x60) - 1;
                        if (last < next) {
                            mem.write32(self + BUY_FIELDS.member, last | 0);
                            break;
                        }
                        if (host.memberHas(host.partySlot(mem.read32(self + BUY_FIELDS.member) | 0),
                            mem.read32(self + BUY_FIELDS.itemId) | 0) !== 0) break;
                    }
                }
            } else {
                for (;;) {
                    const next = (mem.read32(self + BUY_FIELDS.member) | 0) - 1;
                    mem.write32(self + BUY_FIELDS.member, next | 0);
                    if (next < 0) {
                        mem.write32(self + BUY_FIELDS.member, 0);
                        break;
                    }
                    if (host.memberHas(host.partySlot(next), mem.read32(self + BUY_FIELDS.itemId) | 0) !== 0) break;
                }
            }
            if (before !== (mem.read32(self + BUY_FIELDS.member) | 0)) {
                if (host.memberHas(host.partySlot(mem.read32(self + BUY_FIELDS.member) | 0),
                    mem.read32(self + BUY_FIELDS.itemId) | 0) !== 0) {
                    playSound(BUY_SFX_QTY);
                    return;
                }
                mem.write32(self + BUY_FIELDS.member, before);
                return;
            }
            if (padBit(host, 0xd)) {
                playSound(BUY_SFX_APPLY);
                const member = host.partySlot(mem.read32(self + BUY_FIELDS.member) | 0) >>> 0;
                const item = mem.read32(self + BUY_FIELDS.itemId) | 0;
                host.memberMove(member, host.memberEntry(member, item), item, 1);
                host.bandHighlight(band(), mem.read32(self + BUY_FIELDS.member) | 0);
                mem.write32(self + BUY_FIELDS.state, 0x24);
                return;
            }
            if (padBit(host, 0xe)) {
                playSound(BUY_SFX_CANCEL);
                advance();
            }
            return;
        }

        case 33:
            host.foldStart(self + BUY_FIELDS.fold2, 0);
            advanceAfter(() => host.messageShow(mem.read32(ctx + BUY_CTX.message) >>> 0, 0));
            return;

        case 34:
            if ((host.foldTick(self + BUY_FIELDS.fold2) | 0) !== 0) advance();
            return;

        case 35:
            mem.write32(self + BUY_FIELDS.state, 0x0a);
            mem.write32(self + BUY_FIELDS.flag14, 1);
            host.bandReset(band());
            mem.write32(self + BUY_FIELDS.flag7C, 0);
            return;

        case 36:
            mem.write32(self + BUY_FIELDS.flag7C, 0);
            host.foldStart(self + BUY_FIELDS.fold2, 0);
            advanceAfter(() => host.messageShow(mem.read32(ctx + BUY_CTX.message) >>> 0, 0));
            return;

        case 37:
            if ((host.foldTick(self + BUY_FIELDS.fold2) | 0) !== 0) {
                advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold3, 1));
            }
            return;

        case 38:
            if ((host.foldTick(self + BUY_FIELDS.fold3) | 0) !== 0) {
                host.messageSet(mem.read32(ctx + BUY_CTX.message) >>> 0, messageId(0), 9);
                advance();
            }
            return;

        case 39:
            if (padBit(host, 0xd)) {
                playSound(BUY_SFX_APPLY);
                host.foldStart(self + BUY_FIELDS.fold3, 0);
                advanceAfter(() => host.messageShow(mem.read32(ctx + BUY_CTX.message) >>> 0, 0));
            }
            return;

        case 40:
            if ((host.foldTick(self + BUY_FIELDS.fold3) | 0) !== 0) {
                if (held(mem.read32(self + BUY_FIELDS.itemId) | 0) <= 0) {
                    mem.write32(self + BUY_FIELDS.state, 0x23);
                    return;
                }
                mem.write32(self + BUY_FIELDS.state, 0x1e);
                mem.write32(self + BUY_FIELDS.flag14, 1);
            }
            return;

        case 45:
            host.foldStart(self + BUY_FIELDS.fold2, 1);
            advanceAfter(() => host.listCards(list(), 1));
            return;

        case 46:
            if ((host.foldTick(self + BUY_FIELDS.fold2) | 0) !== 0) {
                advanceAfter(() => host.messageShow(mem.read32(ctx + BUY_CTX.message) >>> 0, 1));
            }
            return;

        case 47:
            if (padBit(host, 0xd) || padBit(host, 0xe)) {
                playSound(BUY_SFX_APPLY);
                host.messageShow(mem.read32(ctx + BUY_CTX.message) >>> 0, 0);
                advanceAfter(() => host.foldStart(self + BUY_FIELDS.fold2, 0));
            }
            return;

        case 48:
            if ((host.foldTick(self + BUY_FIELDS.fold2) | 0) !== 0) {
                host.listCards(list(), 0);
                mem.write32(self + BUY_FIELDS.state, 3);
            }
            return;

        case 50:
            if ((mem.read32(ctx + BUY_CTX.band) >>> 0) === 0) {
                mem.write32(self + BUY_FIELDS.lifecycle, 3);
            }
            return;
    }
}
