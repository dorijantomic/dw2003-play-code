// Three board-view slot writers, translated from pro/cardgame:
//   F0x8009BEAC openBannerSlot — [view+0xEAC]: open one info-panel banner
//   F0x8009C054 openPromptSlot — [view+0xEE4]: wipe prompt window A open
//   F0x8009C264 resetViewPanels — [view+0xECC]: both HUD panels to their hidden values
//                                    (engine/systems/card-view.ts models the same routine at
//                                     the CardView level; this is the raw-memory port)
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/view-openers-oracle.test.js runs each original through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the packed
// sound cell stubbed, and compares the whole record the routine writes.
//
// Source (assembly, authority 2): exe-decomp/cardgame_c/_asm/ has no closure for
// these three; the bodies were read from the shipped overlay image at their
// addresses and the store widths come from the instructions (sh/sb/sw), not from
// the m2c listing, which prints every field as an unknown-width `unkNN`.
//
// Existing decoded explanations reused (navigation only; the instructions above
// decide): docs/research/card/cardduel-animation-atlas-2026-08-26.md names the
// three slots — `+0xEAC` 0x8009BEAC "opens one of six info-panel banners at a
// given position, 12 units, sfx 0x40019", `+0xEE4` 0x8009C054 `openPrompt`
// "prompt window A wipes open, 12 frames, sfx 0x00040019" (its fifth argument,
// the layout index, is the stack word stored at +0xDE4), and `+0xECC` 0x8009C264
// `resetPanels` "both panels to hidden, instant".
//
// Nothing here reads the view's method table: the routines are the method bodies
// the duel reaches through the slots, and each is called directly by its port.

export interface ViewOpenersMemory {
    read16(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ViewOpenersHost {
    /** [0x80055C48](id) = F0x8002006C: play a packed sound id. */
    playPackedSound(id: number): void;
}

/** The sound service cell both openers fire before they write. */
export const VIEW_OPENER_SOUND_CELL = 0x80055c48;
/** The sound both openers play. */
export const VIEW_OPENER_SOUND_ID = 0x40019;
/** The two prompt teardown bodies' sound ids (close 0x4001A, confirm a resident descriptor pointer). */
export const PROMPT_CLOSE_SOUND_ID = 0x4001a;
export const PROMPT_CONFIRM_SOUND_ID = 0x8004503c;
/** close_prompt's two 6-unit countdowns and its dismiss state. */
export const PROMPT_CLOSE_UNITS = 6;
export const PROMPT_CLOSE_STATE = 5;
/** confirm_prompt's two 10-unit countdowns and its slide-out state. */
export const PROMPT_CONFIRM_UNITS = 0xa;
export const PROMPT_CONFIRM_STATE = 4;

/**
 * The six banner records: `F0x8009BEAC` scales the view by `index * 0x18` and
 * the fields below are record-relative, so record `i` starts at
 * `view + 0xE0C + 0x18 * i`.
 */
export const BANNER_RECORD = {
    base: 0xe0c,
    stride: 0x18,
    count: 6,
    /** The two position halfwords (the caller's fifth and sixth arguments). */
    argA: 0x00,
    argB: 0x02,
    /** A halfword the opener clears. */
    zero: 0x04,
    /** Full scale, written as 0x1000. */
    scale: 0x06,
    /** The two 12-unit countdowns. */
    timerA: 0x08,
    timerB: 0x0a,
    /** The caller's third argument (halfword). */
    argC: 0x0c,
    /** The caller's fourth argument (word). */
    argD: 0x10,
    /** The active flag, set to 1. */
    active: 0x17,
} as const;

/** The banner's two 12-unit countdowns. */
export const BANNER_FULL_SCALE = 0x1000;
export const BANNER_UNITS = 0xc;

/** Prompt window A's record: `F0x8009C054` writes these view-absolute fields. */
export const PROMPT_RECORD = {
    /** The caller's fifth argument: the layout index, read off the stack. */
    layout: 0xde4,
    /** The caller's second argument (word). */
    argWord: 0xde8,
    /** The two 12-unit countdowns. */
    timerA: 0xdf0,
    timerB: 0xdf2,
    /** The caller's fourth argument (halfword). */
    argHalf: 0xdf4,
    /** The active flag, set to 1. */
    active: 0xdfa,
    /** The caller's third argument (byte). */
    argByte: 0xdfb,
} as const;

/**
 * The panel fields `F0x8009C264` resets. Both HUD panels are 0x54 bytes apart
 * (side 0 at view+0x60, side 1 at view+0xB4 — see the animation atlas' panel
 * table); this routine writes the hidden halfwords (0xF1 / -0x64 panel Y, the
 * 0x147 endpoints) and clears the rest.
 */
export const PANEL_RESET: readonly (readonly [number, number])[] = [
    [0x6e, 0xf1],
    [0x82, 0x8f],
    [0x9e, 0xbd],
    [0xc2, -0x64],
    [0xd6, 0x50],
    [0x64, 0],
    [0x62, 0],
    [0x60, 0],
    [0x6c, 0],
    [0x80, 0x147],
    [0x9c, 0x140],
    [0xb8, 0],
    [0xb6, 0],
    [0xb4, 0],
    [0xc0, 0],
    [0xd4, 0x147],
    [0xf0, 0x140],
    [0xf2, 0x26],
];

/**
 * F0x8009BEAC(view, index, arg2, arg3, arg4, arg5): play sfx 0x40019, then fill
 * banner record `index`'s fields — the caller's halfwords, the scale, the two
 * 12-unit countdowns and the active flag.
 */
export function openBannerSlot(
    mem: ViewOpenersMemory,
    host: ViewOpenersHost,
    view: number,
    index: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
): void {
    host.playPackedSound(VIEW_OPENER_SOUND_ID);
    const rec = (view + index * BANNER_RECORD.stride) | 0;
    const at = (field: number): number => (rec + BANNER_RECORD.base + field) | 0;
    mem.write16(at(BANNER_RECORD.argA), arg4 & 0xffff);
    mem.write16(at(BANNER_RECORD.argB), arg5 & 0xffff);
    mem.write16(at(BANNER_RECORD.zero), 0);
    mem.write16(at(BANNER_RECORD.scale), BANNER_FULL_SCALE);
    mem.write16(at(BANNER_RECORD.timerA), BANNER_UNITS);
    mem.write16(at(BANNER_RECORD.timerB), BANNER_UNITS);
    mem.write16(at(BANNER_RECORD.argC), arg2 & 0xffff);
    mem.write32(at(BANNER_RECORD.argD), arg3);
    mem.write8(at(BANNER_RECORD.active), 1);
}

/**
 * F0x8009C054(view, arg1, arg2, arg3, arg4): play sfx 0x40019, then set up
 * prompt window A — its layout index, the caller's word, the two 12-unit
 * countdowns, the caller's halfword and byte, and the active flag.
 */
export function openPromptSlot(
    mem: ViewOpenersMemory,
    host: ViewOpenersHost,
    view: number,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
): void {
    host.playPackedSound(VIEW_OPENER_SOUND_ID);
    mem.write32(view + PROMPT_RECORD.layout, arg4);
    mem.write32(view + PROMPT_RECORD.argWord, arg1);
    mem.write16(view + PROMPT_RECORD.timerA, BANNER_UNITS);
    mem.write16(view + PROMPT_RECORD.timerB, BANNER_UNITS);
    mem.write16(view + PROMPT_RECORD.argHalf, arg3 & 0xffff);
    mem.write8(view + PROMPT_RECORD.active, 1);
    mem.write8(view + PROMPT_RECORD.argByte, arg2 & 0xff);
}

/** F0x8009C264(view): put both HUD panels back to their hidden values. */
export function resetViewPanels(mem: ViewOpenersMemory, view: number): void {
    for (const [offset, value] of PANEL_RESET) {
        mem.write16(view + offset, value & 0xffff);
    }
}

/**
 * F0x8009C0DC close_prompt [view+0xEE8](view): play sfx 0x4001A, arm the prompt
 * window's two 6-unit countdowns and move it to state 5 (the dismiss ramp).
 * Read from exe-decomp/cardgame.norm.s .L0x0001942c (the m2c listing merges it
 * into the F0x8009BBA8 blob and prints every field as an unknown-width `unkNN`).
 */
export function closePromptSlot(mem: ViewOpenersMemory, host: ViewOpenersHost, view: number): void {
    host.playPackedSound(PROMPT_CLOSE_SOUND_ID);
    mem.write16(view + PROMPT_RECORD.timerB, PROMPT_CLOSE_UNITS);
    mem.write16(view + PROMPT_RECORD.timerA, PROMPT_CLOSE_UNITS);
    mem.write8(view + PROMPT_RECORD.active, PROMPT_CLOSE_STATE);
}

/**
 * F0x8009C124 confirm_prompt [view+0xEEC](view): play the resident
 * 0x8004503C descriptor, arm the prompt window's two 10-unit countdowns and
 * move it to state 4 (the slide-out ramp, which then calls the close method
 * itself). Read from exe-decomp/cardgame.norm.s .L0x00019474.
 */
export function confirmPromptSlot(mem: ViewOpenersMemory, host: ViewOpenersHost, view: number): void {
    host.playPackedSound(PROMPT_CONFIRM_SOUND_ID);
    mem.write16(view + PROMPT_RECORD.timerB, PROMPT_CONFIRM_UNITS);
    mem.write16(view + PROMPT_RECORD.timerA, PROMPT_CONFIRM_UNITS);
    mem.write8(view + PROMPT_RECORD.active, PROMPT_CONFIRM_STATE);
}
