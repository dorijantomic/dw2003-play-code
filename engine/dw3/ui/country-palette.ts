// The language-select screen's palette sprite, translated from pro/cnty_sel:
//   F0x800833DC palette_sprite_draw — draw the palette sprite's current frame
//   F0x8008347C palette_cycle_tick — advance the frame counter or run the script
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/country-palette-oracle.test.js runs both originals through
// engine/native on the shipped pro_cnty_sel.bin + resident.bin.
//
// DECODED: authority-2 closures `_asm/F0x800833dc.s` and `_asm/F0x8008347c.s`.
// The object carries: +0x0C state0, +0x10 a one-shot seed flag, +0x28 setState0,
// +0x38 advance0, +0x50 a 32-bit frame counter, +0x54 the sprite frame,
// +0x56 the published frame, +0x58 a script cursor {u16 index, u16 value}.
// State 1 wraps the counter at 32 and publishes counter/4 (eight frames, four
// ticks each); state 2 runs the palette script through F0x80083304 and latches
// to state 3 when the script returns 0xFF; state 3 does nothing; every other
// state advances state0.

export interface CountryPaletteMemory {
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface CountryPaletteHost {
    /** ctx+0x74 (F0x8001ECBC): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x7C (F0x8001ED34): set the draw layer target and bucket. */
    setLayer(target: number, bucket: number): void;
    /** ctx+0x88 (F0x8001ECEC): set the sprite frame index. */
    setFrame(n: number): void;
    /** ctx+0x84 (F0x8001ED6C): draw a sprite from the resolved pack. */
    drawSprite(handle: number, clip: number, x: number, y: number): void;
    /** `[0x80044F5C]` = F0x800140D8: resolve a pack handle to its image. */
    packResolve(handle: number): number;
    /** obj+0x38 (F0x800142AC): advance state0. */
    advance0(obj: number): void;
    /** obj+0x28 (F0x80014274): set state0. */
    setState0(obj: number, state: number): void;
    /** F0x80083304(cursor, table, arg): the palette script stepper. */
    stepPaletteScript(cursor: number, table: number, arg: number): number;
}

export const COUNTRY_PALETTE = {
    state0: 0x0c,
    seed: 0x10,
    setState0: 0x28,
    advance0: 0x38,
    counter: 0x50,
    frame: 0x54,
    published: 0x56,
    cursor: 0x58,
} as const;
export const COUNTRY_PALETTE_SHEET = 0x08a30000;
export const COUNTRY_PALETTE_LAYER = 0x100;
export const COUNTRY_PALETTE_ORIGIN = { x: 0x280, y: 0 } as const;
export const COUNTRY_PALETTE_COUNTER_WRAP = 32;
export const COUNTRY_PALETTE_TICKS_PER_FRAME = 4;
export const COUNTRY_PALETTE_SCRIPT_TABLE = 0x800843d8;
export const COUNTRY_PALETTE_SCRIPT_SEED = 0x800843da;
export const COUNTRY_PALETTE_SCRIPT_END = 0xff;
export const COUNTRY_PALETTE_FINAL_STATE = 3;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** F0x800833DC(obj): draw the palette sprite at its published frame. */
export function paletteSpriteDraw(mem: CountryPaletteMemory, obj: number, host: CountryPaletteHost): void {
    host.setLayer(COUNTRY_PALETTE_LAYER, 1);
    host.setOrigin(COUNTRY_PALETTE_ORIGIN.x, COUNTRY_PALETTE_ORIGIN.y);
    host.setFrame(s16(mem.read16s(obj + COUNTRY_PALETTE.published)));
    const handle = host.packResolve(COUNTRY_PALETTE_SHEET) >>> 0;
    host.drawSprite(handle, s16(mem.read16s(obj + COUNTRY_PALETTE.frame)) + 4, 0, 0);
}

/** F0x8008347C(obj): one tick of the palette cycle. */
export function paletteCycleTick(mem: CountryPaletteMemory, obj: number, host: CountryPaletteHost): void {
    const state = s32(mem.read32(obj + COUNTRY_PALETTE.state0));
    if (state === 1) {
        const old = s32(mem.read32(obj + COUNTRY_PALETTE.counter));
        const next = (old + 1) | 0;
        mem.write32(obj + COUNTRY_PALETTE.counter, next >>> 0);
        // C-style modulo 32, then divide by four, both truncating toward zero.
        let v = next < 0 ? old + 0x20 : next;
        v = (v >> 5) << 5;
        let mod = (next - v) | 0;
        mem.write32(obj + COUNTRY_PALETTE.counter, mod >>> 0);
        if (mod < 0) mod += 3;
        mem.write16(obj + COUNTRY_PALETTE.published, (mod >> 2) & 0xffff);
        paletteSpriteDraw(mem, obj, host);
        return;
    }
    if (state === 2) {
        if (s32(mem.read32(obj + COUNTRY_PALETTE.seed)) === 0) {
            mem.write16(obj + COUNTRY_PALETTE.cursor, 0);
            mem.write16(obj + COUNTRY_PALETTE.cursor + 2, mem.read16(COUNTRY_PALETTE_SCRIPT_SEED));
            mem.write32(obj + COUNTRY_PALETTE.seed, 1);
        }
        const frame = host.stepPaletteScript((obj + COUNTRY_PALETTE.cursor) >>> 0,
            COUNTRY_PALETTE_SCRIPT_TABLE, 0) | 0;
        mem.write16(obj + COUNTRY_PALETTE.published, frame & 0xffff);
        if (s16(frame) === COUNTRY_PALETTE_SCRIPT_END) {
            host.setState0(obj, COUNTRY_PALETTE_FINAL_STATE);
            return;
        }
        paletteSpriteDraw(mem, obj, host);
        return;
    }
    if (state === COUNTRY_PALETTE_FINAL_STATE) return;
    host.advance0(obj);
}

/**
 * F0x80083474(element, frame): store the highlighted row's sprite/frame id in
 * the animated palette element's +0x54. The original is a two-instruction leaf
 * (`jr $ra` with the store in its delay slot).
 */
export function paletteElementSetFrame(
    mem: CountryPaletteMemory, element: number, frame: number,
): void {
    mem.write16(element + 0x54, frame & 0xffff);
}

/** The animated palette element's constructor and its frame slot. */
export const COUNTRY_PALETTE_ELEMENT_SIZE = 0x60;
export const COUNTRY_PALETTE_ELEMENT_HANDLER = 0x8008347c;
export const COUNTRY_PALETTE_ELEMENT_FRAME_FN = 0x80083474;
export const COUNTRY_PALETTE_ELEMENT_FRAME_SLOT = 0x5c;

export interface CountryPaletteCreateHost {
    /** F0x80014504(handler, size, slot): build and return the task object. */
    allocate(handler: number, size: number, slot: number): number;
}

/**
 * F0x80083594(): build the language screen's animated palette element — a
 * 0x60-byte task object whose handler is paletteCycleTick F0x8008347C — and give
 * it its frame setter at +0x5C. Returns the new object ($v0 survives the
 * epilogue).
 */
export function createPaletteElement(
    mem: CountryPaletteMemory, host: CountryPaletteCreateHost,
): number {
    const element = host.allocate(
        COUNTRY_PALETTE_ELEMENT_HANDLER, COUNTRY_PALETTE_ELEMENT_SIZE, 0,
    ) >>> 0;
    mem.write32(element + COUNTRY_PALETTE_ELEMENT_FRAME_SLOT, COUNTRY_PALETTE_ELEMENT_FRAME_FN);
    return element;
}
