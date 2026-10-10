// The display view's rectangle colour setter, translated from the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/cache-service-oracle.test.js runs F0x8001E028 through
// engine/native and compares.
//
// DECODED: exe-decomp/c/F0x8001E028.c and fns.norm.s. The original stores the
// three channels first, in the order 0x19, 0x1B, 0x1A, then the validity byte
// at 0x18 from ((a3 | a1 | a2) & 0xFF), so a write-order-preserving port.

export interface DisplayViewMemory {
    write8(addr: number, value: number): void;
}

/** Object-relative offsets of the rect colour fields. */
export const RECT_COLOUR = { valid: 0x18, r: 0x19, g: 0x1a, b: 0x1b } as const;

/** F0x8001E028(self, r, g, b): store the colour and its validity flag. */
export function setRectColour(
    mem: DisplayViewMemory,
    self: number,
    r: number,
    g: number,
    b: number,
): void {
    mem.write8(self + RECT_COLOUR.r, r & 0xff);
    mem.write8(self + RECT_COLOUR.b, b & 0xff);
    mem.write8(self + RECT_COLOUR.g, g & 0xff);
    mem.write8(self + RECT_COLOUR.valid, ((b | r | g) & 0xff) !== 0 ? 1 : 0);
}
