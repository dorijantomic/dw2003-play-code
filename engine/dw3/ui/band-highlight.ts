// The item-shop info band's highlight method and its two forwarders, translated
// from pro/stitshop F0x8008B29C (band +0x234), F0x80085934 (BUY) and
// F0x8008739C (SELL).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/band-highlight-oracle.test.js runs the original through
// engine/native with the three callees stubbed and compares the band field
// writes and the ordered call stream for both +0x5C values.
//
// DECODED: the accepted band-highlight answer (2026-09-14), verified against
// exe-decomp/stitshop_c/_asm/F0x8008b29c.s. The m2c output mis-prints the first
// callee as 2-argument; the assembly sets a0 = band, a1 = band+0x24, a2 = 1, so
// F0x80089E2C is a 3-argument call and is ported that way.
//
//   F0x8008B29C(band, itemId, quantity):
//     children = band+0x24
//     band+0x1E4 = itemId; band+0x1E8 = quantity   (both unconditional)
//     if band+0x1F0 == 0: return
//     F0x80089E2C(band, children, 1)
//     if band+0x5C == 0: F0x8008A0D0(band, children, 1); return
//     F0x8008A0D0(band, children, 0); F0x8008A1FC(band, children, 1)
//
//   F0x80085934 / F0x8008739C(actor, itemId, quantity):
//     ctx = actor+0x24; band = ctx+0x4; band+0x234(band, itemId, quantity)
//
// The three band callees (name/price/description fill and the Effects
// party-card fill) are still native and are explicit host boundaries. The
// forwarder passes itemId/quantity through untouched in a1/a2.

export interface BandHighlightMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface BandHighlightHost {
    /** F0x80089E2C(band, children, flag): still native. */
    call89e2c(band: number, children: number, flag: number): void;
    /** F0x8008A0D0(band, children, flag): still native. */
    call8a0d0(band: number, children: number, flag: number): void;
    /** F0x8008A1FC(band, children, flag): still native. */
    call8a1fc(band: number, children: number, flag: number): void;
}

/** Band object fields touched by this family. */
export const BAND_FIELDS = {
    children: 0x24,
    cards: 0x5c,
    itemId: 0x1e4,
    quantity: 0x1e8,
    enabled: 0x1f0,
} as const;
/** The band pointer lives in the actor context at +0x4. */
export const ACTOR_CTX_BAND = 0x4;

/** The band object's factory handler and sizes (F0x8008B484). */
export const BAND_HANDLER = 0x8008af68;
export const BAND_SIZE = 0x248;
export const BAND_EXTRA = 0xac;
/** The band's five method slots, +0x234..+0x244. */
export const BAND_METHODS: ReadonlyArray<readonly [number, number]> = [
    [0x234, 0x8008b29c],
    [0x238, 0x8008b324],
    [0x23c, 0x8008b340],
    [0x240, 0x8008b378],
    [0x244, 0x8008b430],
];

export interface BandObjectHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
}

/**
 * F0x8008B484(mode, itemId): build the band object. The factory allocates the
 * object plus its 0xAC extra block (+0x24, +0x20 = 0x2B) and installs the base
 * table +0x28..+0x4C with +0x48 = the band handler.
 */
export function bandCreate(
    mem: BandHighlightMemory & { write32(addr: number, value: number): void },
    host: BandObjectHost,
    mode: number,
    itemId: number,
): number {
    const obj = host.alloc(BAND_SIZE) >>> 0;
    const extra = host.alloc(BAND_EXTRA) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, BAND_EXTRA >> 2);
    for (const [off, value] of BAND_BASE_TABLE) mem.write32(obj + off, value >>> 0);
    for (const [off, value] of BAND_METHODS) mem.write32(obj + off, value >>> 0);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 6);
    mem.write32(obj + 0x58, mode | 0);
    mem.write32(obj + 0x1e4, itemId | 0);
    mem.write32(obj + 0x1e8, 1);
    mem.write32(obj + 0x1f0, 1);
    return obj;
}

/** The factory's base object table, +0x28..+0x4C with the band handler at +0x48. */
export const BAND_BASE_TABLE: ReadonlyArray<readonly [number, number]> = [
    [0x28, 0x80014274],
    [0x2c, 0x80014288],
    [0x30, 0x80014298],
    [0x34, 0x800142a4],
    [0x38, 0x800142ac],
    [0x3c, 0x800142c8],
    [0x40, 0x800142e0],
    [0x44, 0x800142f4],
    [0x48, BAND_HANDLER],
    [0x4c, 0x80014308],
];

/** F0x8008B29C(band, itemId, quantity): record the highlight and refill. */
export function bandHighlight(
    mem: BandHighlightMemory,
    host: BandHighlightHost,
    band: number,
    itemId: number,
    quantity: number,
): void {
    const children = mem.read32(band + BAND_FIELDS.children) >>> 0;
    mem.write32(band + BAND_FIELDS.itemId, itemId | 0);
    mem.write32(band + BAND_FIELDS.quantity, quantity | 0);
    if ((mem.read32(band + BAND_FIELDS.enabled) | 0) === 0) return;

    host.call89e2c(band, children, 1);
    if ((mem.read32(band + BAND_FIELDS.cards) | 0) === 0) {
        host.call8a0d0(band, children, 1);
        return;
    }
    host.call8a0d0(band, children, 0);
    host.call8a1fc(band, children, 1);
}

/** F0x80085934 / F0x8008739C(actor, itemId, quantity): the band's +0x50 forwarder. */
export function bandHighlightForward(
    mem: BandHighlightMemory,
    host: BandHighlightHost,
    actor: number,
    itemId: number,
    quantity: number,
): void {
    const ctx = mem.read32(actor + BAND_FIELDS.children) >>> 0;
    const band = mem.read32(ctx + ACTOR_CTX_BAND) >>> 0;
    bandHighlight(mem, host, band, itemId, quantity);
}

/** F0x8008B324: begin leaving once the detail panel is ready. */
export function bandLeaveReady(mem: BandHighlightMemory, band: number): void {
    if ((mem.read32(band + 0x10) | 0) === 3) mem.write32(band + 0x10, 0x32);
}

export interface BandExtraHost {
    itemHasSlot(itemId: number, slot: number): number;
    playSound(soundId: number): void;
}

/** F0x8008B378: toggle the extra card when the item has a matching member. */
export function bandToggleExtra(
    mem: BandHighlightMemory, host: BandExtraHost, band: number,
): void {
    const item = mem.read32(band + BAND_FIELDS.itemId) | 0;
    if (host.itemHasSlot(item, 3) === 0 && host.itemHasSlot(item, 4) === 0 &&
        host.itemHasSlot(item, 5) === 0) return;
    host.playSound(0x4001b);
    mem.write32(band + 0x10, 0x0a);
    mem.write32(band + BAND_FIELDS.enabled, 0);
    mem.write32(band + BAND_FIELDS.cards, (1 - (mem.read32(band + BAND_FIELDS.cards) | 0)) | 0);
}

export interface BandMemberHost {
    refillItem(band: number, children: number, visible: number): void;
    refillMember(band: number, children: number, member: number): void;
}

/** F0x8008B430: redraw the item line and one partner's effect card. */
export function bandRedrawMember(
    mem: BandHighlightMemory, host: BandMemberHost, band: number, member: number,
): void {
    const children = mem.read32(band + BAND_FIELDS.children) >>> 0;
    host.refillItem(band, children, 1);
    host.refillMember(band, children, member | 0);
}
