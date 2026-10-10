// The country-select screen's object creators, translated bit-exactly from the
// original pro/cnty_sel thunks.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/cnty-creators.test.js runs each original through
// engine/native and compares the allocator request and the returned pointer.
//
// Each body is the same shape: F0x80014504(callback, size, extra) and return
// the new object. The callbacks are the screen tick (F0x80083D18), its fade
// (F0x80083184) and the three decor breathe ticks.
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

/** The five creator entry points. */
export const CNTY_CREATOR_ADDRESSES = {
    root: 0x80084394,
    fade: 0x800832d8,
    left: 0x80083804,
    right: 0x80083a68,
    bottom: 0x80083cec,
} as const;

/** The callbacks each creator registers (all already translated). */
export const CNTY_ROOT_TICK = 0x80083d18;
export const CNTY_FADE_TICK = 0x80083184;
export const CNTY_LEFT_BREATHE_TICK = 0x800836dc;
export const CNTY_RIGHT_BREATHE_TICK = 0x80083940;
export const CNTY_BOTTOM_BREATHE_TICK = 0x80083bc0;

export interface CntyCreatorHost {
    /** F0x80014504(callback, size, extra): the shared object allocator. */
    alloc(callback: number, size: number, extra: number): number;
}

/** F0x80084394(): the country-select root (callback 0x80083D18, 0x54+0x14). */
export function countrySelectRootCreate(host: CntyCreatorHost): number {
    return host.alloc(CNTY_ROOT_TICK, 0x54, 0x14);
}

/** F0x800832D8(): the fade object (callback 0x80083184, 0x54). */
export function countrySelectFadeCreate(host: CntyCreatorHost): number {
    return host.alloc(CNTY_FADE_TICK, 0x54, 0);
}

/** F0x80083804(): the left decor breather (callback 0x800836DC, 0x58). */
export function countrySelectLeftCreate(host: CntyCreatorHost): number {
    return host.alloc(CNTY_LEFT_BREATHE_TICK, 0x58, 0);
}

/** F0x80083A68(): the right decor breather (callback 0x80083940, 0x58). */
export function countrySelectRightCreate(host: CntyCreatorHost): number {
    return host.alloc(CNTY_RIGHT_BREATHE_TICK, 0x58, 0);
}

/** F0x80083CEC(): the bottom decor breather (callback 0x80083BC0, 0x58). */
export function countrySelectBottomCreate(host: CntyCreatorHost): number {
    return host.alloc(CNTY_BOTTOM_BREATHE_TICK, 0x58, 0);
}
