// The item shop's two actor objects, translated from pro/stitshop F0x8008596C
// (BUY) and F0x800873D4 (SELL).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-actor-oracle.test.js runs both originals through
// engine/native and compares the whole object to the ports.
//
// DECODED: exe-decomp/stitshop_c/F0x8008596c.c / F0x800873d4.c and their raw
// bodies; accepted band-highlight answer §2 (the actor holds +0x50 = the band
// forwarder, +0x58 = 0x1000, +0x5C = 4, +0x54 = the ctor argument).
//
//   F0x8008596C(arg): factory(F0x80085890, 0xC8, 0x24); +0x50 = 0x80085934
//   F0x800873D4(arg): factory(F0x800872F4, 0xCC, 0x38); +0x50 = 0x8008739C
//   both: +0x58 = 0x1000; +0x5C = 4; +0x54 = arg (raw word)
//
// The factory F0x80014504 allocates the object plus an extra block, stores the
// block at +0x24 with +0x20 = extraSize>>2 (9 for BUY, 0xE for SELL), and
// installs the base table +0x28..+0x4C with +0x48 = the actor handler.

export interface ShopActorMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopActorHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
}

/** The actor handler installed at +0x48. */
export const SHOP_ACTOR_BUY_HANDLER = 0x80085890;
export const SHOP_ACTOR_SELL_HANDLER = 0x800872f4;
/** The band-highlight forwarder installed at +0x50. */
export const SHOP_ACTOR_BUY_FORWARDER = 0x80085934;
export const SHOP_ACTOR_SELL_FORWARDER = 0x8008739c;
/** Object and extra-block sizes (BUY / SELL). */
export const SHOP_ACTOR_BUY_SIZE = 0xc8;
export const SHOP_ACTOR_SELL_SIZE = 0xcc;
export const SHOP_ACTOR_BUY_EXTRA = 0x24;
export const SHOP_ACTOR_SELL_EXTRA = 0x38;

/** The factory's base object table, +0x28..+0x4C (the handler replaces +0x48). */
export function shopActorBaseTable(handler: number): ReadonlyArray<readonly [number, number]> {
    return [
        [0x28, 0x80014274],
        [0x2c, 0x80014288],
        [0x30, 0x80014298],
        [0x34, 0x800142a4],
        [0x38, 0x800142ac],
        [0x3c, 0x800142c8],
        [0x40, 0x800142e0],
        [0x44, 0x800142f4],
        [0x48, handler],
        [0x4c, 0x80014308],
    ];
}

function shopActorCreate(
    mem: ShopActorMemory,
    host: ShopActorHost,
    handler: number,
    size: number,
    extraSize: number,
    forwarder: number,
    arg: number,
): number {
    const obj = host.alloc(size) >>> 0;
    const extra = host.alloc(extraSize) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, extraSize >> 2);
    for (const [off, value] of shopActorBaseTable(handler)) mem.write32(obj + off, value >>> 0);
    mem.write32(obj + 0x50, forwarder);
    mem.write32(obj + 0x58, 0x1000);
    mem.write32(obj + 0x5c, 4);
    mem.write32(obj + 0x54, arg | 0);
    return obj;
}

/** F0x8008596C(arg): build the BUY actor. */
export function shopActorBuy(mem: ShopActorMemory, host: ShopActorHost, arg: number): number {
    return shopActorCreate(
        mem,
        host,
        SHOP_ACTOR_BUY_HANDLER,
        SHOP_ACTOR_BUY_SIZE,
        SHOP_ACTOR_BUY_EXTRA,
        SHOP_ACTOR_BUY_FORWARDER,
        arg,
    );
}

/** F0x800873D4(arg): build the SELL actor. */
export function shopActorSell(mem: ShopActorMemory, host: ShopActorHost, arg: number): number {
    return shopActorCreate(
        mem,
        host,
        SHOP_ACTOR_SELL_HANDLER,
        SHOP_ACTOR_SELL_SIZE,
        SHOP_ACTOR_SELL_EXTRA,
        SHOP_ACTOR_SELL_FORWARDER,
        arg,
    );
}

/** The actor handlers' per-frame callees (still native) and the base advance. */
export interface ShopActorTickHost {
    /** self+0x38: the host-served base advance method (F0x800142AC). */
    advanceState(self: number): void;
}

export interface ShopActorBuyTickHost extends ShopActorTickHost {
    /** F0x8008360C(self, ctx): BUY init callee. */
    call8360c(self: number, ctx: number): void;
    /** F0x80083EB0(self, ctx): BUY state-1 callee. */
    call83eb0(self: number, ctx: number): void;
    /** F0x80083970(self, ctx): BUY state-1 draw. */
    call83970(self: number, ctx: number): void;
}

export interface ShopActorSellTickHost extends ShopActorTickHost {
    /** F0x800859C0(self, ctx): SELL init callee. */
    call859c0(self: number, ctx: number): void;
    /** F0x80085F48(self, ctx): SELL state-1 machine. */
    call85f48(self: number, ctx: number): void;
    /** F0x80085B18(self, ctx): SELL state-1 draw. */
    call85b18(self: number, ctx: number): void;
}

/** Fold timers the BUY handler arms and the visible flag it sets. */
export const SHOP_ACTOR_BUY_TICK = { start0: 0x88, start1: 0x98, start2: 0xa8, start3: 0xb8, visible: 0x64 } as const;
/** Fold timers the SELL handler arms and the visible flag it sets. */
export const SHOP_ACTOR_SELL_TICK = { start0: 0x7c, start1: 0x8c, start2: 0x9c, start3: 0xac, fold5: 0xbc, visible: 0x68 } as const;

/**
 * F0x80085890(self, ctx): the BUY actor's per-frame handler. state 1 runs
 * F0x80083EB0 then F0x80083970; states 2/3 do nothing; anything else advances
 * the state, runs F0x8008360C, arms the four 0xA fold timers and sets +0x64.
 */
export function shopActorBuyTick(
    mem: ShopActorMemory,
    host: ShopActorBuyTickHost,
    self: number,
    ctx: number,
): void {
    const state = mem.read32(self + 0xc) | 0;
    if (state === 1) {
        host.call83eb0(self, ctx);
        host.call83970(self, ctx);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.advanceState(self);
    host.call8360c(self, ctx);
    mem.write32(self + SHOP_ACTOR_BUY_TICK.start0, 0xa);
    mem.write32(self + SHOP_ACTOR_BUY_TICK.start1, 0xa);
    mem.write32(self + SHOP_ACTOR_BUY_TICK.start2, 0xa);
    mem.write32(self + SHOP_ACTOR_BUY_TICK.start3, 0xa);
    mem.write32(self + SHOP_ACTOR_BUY_TICK.visible, 1);
}

/**
 * F0x800872F4(self, ctx): the SELL actor's per-frame handler. state 1 runs
 * F0x80085F48 then F0x80085B18; states 2/3 do nothing; anything else advances
 * the state, runs F0x800859C0, arms five 0xA fold timers and sets +0x68.
 */
export function shopActorSellTick(
    mem: ShopActorMemory,
    host: ShopActorSellTickHost,
    self: number,
    ctx: number,
): void {
    const state = mem.read32(self + 0xc) | 0;
    if (state === 1) {
        host.call85f48(self, ctx);
        host.call85b18(self, ctx);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.advanceState(self);
    host.call859c0(self, ctx);
    mem.write32(self + SHOP_ACTOR_SELL_TICK.start0, 0xa);
    mem.write32(self + SHOP_ACTOR_SELL_TICK.start1, 0xa);
    mem.write32(self + SHOP_ACTOR_SELL_TICK.start2, 0xa);
    mem.write32(self + SHOP_ACTOR_SELL_TICK.start3, 0xa);
    mem.write32(self + SHOP_ACTOR_SELL_TICK.fold5, 0xa);
    mem.write32(self + SHOP_ACTOR_SELL_TICK.visible, 1);
}
