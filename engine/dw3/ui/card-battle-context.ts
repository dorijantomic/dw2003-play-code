// The card duel's view constructor, translated from pro/cardgame F0x8009D310.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/card-battle-context-oracle.test.js runs the original through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the
// task-object allocator stubbed and the whole 0xF48-byte view compared.
//
// DECODED: authority-2 closure `_asm/F0x8009d310.s` (283 instructions) and the
// m2c body `exe-decomp/cardgame_c/F0x8009d310.c`, plus the accepted
// `cardgame-duel-view-contract` and `cardgame-context-dispatch-table-42-slots`.
//
// Player-visible result: nothing on its own. It builds the duel's board view —
// a 0xF48-byte task object whose handler is cardDuelViewTick F0x8009BBA8 — and
// installs the forty-two methods that make the rest of the duel work: the
// ten-readout setter, the three centre-plate writers, the highlight set/clear
// pair, the integer formatter, the four HUD ticks, the two float-number
// writers, the card-state bodies, the four sprite passes and the two mode
// entry points. It also stores the parent pointer it was given at view+0x50.
//
// The allocator (resident F0x80014504) is a host boundary; the port only states
// the handler, the size and the handler slot it asks for.

export interface CardBattleMemory {
    write32(addr: number, value: number): void;
}

export interface CardBattleHost {
    /** F0x80014504(handler, size, slot): build and return the task object. */
    allocateView(handler: number, size: number, slot: number): number;
}

/** The view the constructor builds and where it puts its parts. */
export const CARD_BATTLE_VIEW_SIZE = 0x0f48;
export const CARD_BATTLE_VIEW_SLOT = 0x38;
export const CARD_BATTLE_VIEW_HANDLER = 0x8009bba8;
export const CARD_BATTLE_PARENT = 0x50;

/** One store, in the original's order: a method pointer or the parent. */
export interface CardBattleStore {
    /** The view offset the store writes. */
    at: number;
    /** The method address stored (absent for the parent store). */
    fn?: number;
    /** True for the one store that writes the parent pointer. */
    parent?: boolean;
}

/** The forty-two methods and the parent, in the original's store order. */
export const CARD_BATTLE_STORES: readonly CardBattleStore[] = [
    { at: 0x0ea0, fn: 0x8009cae0 },
    { at: 0x0ea4, fn: 0x8009be40 },
    { at: 0x0ea8, fn: 0x8009be78 },
    { at: 0x0eac, fn: 0x8009beac },
    { at: 0x0eb0, fn: 0x8009bf5c },
    { at: 0x0eb8, fn: 0x8009cc4c },
    { at: 0x0eb4, fn: 0x8009cda4 },
    { at: 0x0ee4, fn: 0x8009c054 },
    { at: 0x0ee8, fn: 0x8009c0dc },
    { at: 0x0ef0, fn: 0x8009c16c },
    { at: 0x0eec, fn: 0x8009c124 },
    { at: 0x0ef4, fn: 0x8009c174 },
    { at: 0x0ef8, fn: 0x8009c1cc },
    { at: 0x0efc, fn: 0x8009c214 },
    { at: 0x0f00, fn: 0x8009c25c },
    { at: 0x0ed8, fn: 0x80098864 },
    { at: 0x0edc, fn: 0x8009bfcc },
    { at: 0x0ee0, fn: 0x8009c010 },
    { at: 0x0f08, fn: 0x8009c9a0 },
    { at: 0x0f0c, fn: 0x8009ca3c },
    { at: 0x0f10, fn: 0x8009ca80 },
    { at: 0x0f2c, fn: 0x8009c654 },
    { at: 0x0f30, fn: 0x8009c6e8 },
    { at: 0x0f34, fn: 0x8009c770 },
    { at: 0x0f38, fn: 0x8009c7f8 },
    { at: 0x0f28, fn: 0x8009c5d8 },
    { at: 0x0f14, fn: 0x8009c510 },
    { at: 0x0f18, fn: 0x8009cdfc },
    { at: 0x0f1c, fn: 0x8009ce28 },
    { at: 0x0f20, fn: 0x8009c904 },
    { at: 0x0f24, fn: 0x8009c938 },
    { at: 0x0f04, fn: 0x8009ce94 },
    { at: CARD_BATTLE_PARENT, parent: true },
    { at: 0x0ec4, fn: 0x8009c350 },
    { at: 0x0ec8, fn: 0x8009c2d0 },
    { at: 0x0ebc, fn: 0x8009c438 },
    { at: 0x0ed0, fn: 0x8009c4a4 },
    { at: 0x0ed4, fn: 0x8009c4d8 },
    { at: 0x0ec0, fn: 0x8009c3c0 },
    { at: 0x0ecc, fn: 0x8009c264 },
    { at: 0x0f3c, fn: 0x8009cfbc },
    { at: 0x0f40, fn: 0x8009cf60 },
    { at: 0x0f44, fn: 0x8009d15c },
] as const;

/**
 * F0x8009D310(parent): build the board view. Returns the new view.
 */
export function createCardBattleContext(
    mem: CardBattleMemory, parent: number, host: CardBattleHost,
): number {
    const view = host.allocateView(
        CARD_BATTLE_VIEW_HANDLER, CARD_BATTLE_VIEW_SIZE, CARD_BATTLE_VIEW_SLOT,
    ) >>> 0;
    for (const store of CARD_BATTLE_STORES) {
        mem.write32(view + store.at, store.parent ? parent >>> 0 : (store.fn as number));
    }
    return view;
}
