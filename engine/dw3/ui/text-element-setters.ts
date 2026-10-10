// The text-element setter family, translated from the resident EXE methods of
// the F0x8001AE38 text widget.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/text-element-setters-oracle.test.js runs each original address
// through engine/native and compares every touched byte.
//
// DECODED: ledger UI-WIDGETCLASS-AE38-SETTERS-001 and the widget-setter family
// claim. These are the small field setters the widget table installs; each is
// read instruction by instruction in exe-decomp/c/_asm/F0x8001A*.s, and the
// store WIDTH and ORDER below are those of the assembly (sh / sb / sw), not the
// m2c field guesses. Field offsets are on the widget allocation.
//
//   F0x8001A1B8 setTextScroll(self, a1:s16)
//     a1 > 0  : [a4]=0, [a8]=0, [aa]=(s16)a1, [a6]=0
//     a1 <= 0 : [a8]=0, [aa]=0, [a4]= (u16)[62]      (read of [62] first)
//   F0x8001A1E8 setTextWidgetOrigin(self, x, y): [b0]=(s16)x, [b2]=(s16)y
//   F0x8001A1F4 set_unk_0xc0(self, v:s8): [c0]=v
//   F0x8001A204 setVectorAndActiveFlag(self, x, y):
//     (x<<16)!=0 || (y<<16)!=0 : [c2]=1, [b4]=(s16)x, [b6]=(s16)y
//     else                     : [c2]=0, [b4]=0, [b6]=0
//   F0x8001A23C setTextElementFlagC1(self, v:s8):
//     (s16)[62] != 0 : [c1]=v   else [c1]=0
//   F0x8001A418 set_unk_0xc8(self, v:s32): [c8]=v
//   F0x8001A448 set_unk_0x58(self, v:s32): [58]=v
//   F0x8001A450 set_unk_0xbf(self, v:s8): [bf]=v
//
// All offsets are the ORIGINAL object's, so the port is a memory translation
// like the fold one, not a named-struct rewrite.

export interface TextElementMemory {
    read16(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** Object-relative offsets written or read by this family. */
export const TEXT_ELEMENT = {
    unk58: 0x58,
    unk62: 0x62,
    unkA4: 0xa4,
    unkA6: 0xa6,
    unkA8: 0xa8,
    unkAA: 0xaa,
    unkB0: 0xb0,
    unkB2: 0xb2,
    unkB4: 0xb4,
    unkB6: 0xb6,
    unkBF: 0xbf,
    unkC0: 0xc0,
    unkC1: 0xc1,
    unkC2: 0xc2,
    unkC8: 0xc8,
} as const;

/** F0x8001A1B8. */
export function setTextScroll(mem: TextElementMemory, self: number, a1: number): void {
    // The original branches on bgtz of the full register and stores the low
    // halfword; callers pass an s16, but the port keeps that distinction.
    const v = a1 | 0;
    if (v > 0) {
        mem.write16(self + TEXT_ELEMENT.unkA4, 0);
        mem.write16(self + TEXT_ELEMENT.unkA8, 0);
        mem.write16(self + TEXT_ELEMENT.unkAA, v & 0xffff);
        mem.write16(self + TEXT_ELEMENT.unkA6, 0);
        return;
    }
    const unk62 = mem.read16(self + TEXT_ELEMENT.unk62);
    mem.write16(self + TEXT_ELEMENT.unkA8, 0);
    mem.write16(self + TEXT_ELEMENT.unkAA, 0);
    mem.write16(self + TEXT_ELEMENT.unkA4, unk62 & 0xffff);
}

/** F0x8001A1E8. */
export function setTextWidgetOrigin(mem: TextElementMemory, self: number, x: number, y: number): void {
    mem.write16(self + TEXT_ELEMENT.unkB0, x & 0xffff);
    mem.write16(self + TEXT_ELEMENT.unkB2, y & 0xffff);
}

/** F0x8001A1F4. */
export function set_unk_0xc0_fns_8001a1f4(mem: TextElementMemory, self: number, v: number): void {
    mem.write8(self + TEXT_ELEMENT.unkC0, v & 0xff);
}

/** F0x8001A204. */
export function setVectorAndActiveFlag(mem: TextElementMemory, self: number, x: number, y: number): void {
    const x32 = x | 0;
    const y32 = y | 0;
    if (((x32 << 16) !== 0) || ((y32 << 16) !== 0)) {
        mem.write8(self + TEXT_ELEMENT.unkC2, 1);
        mem.write16(self + TEXT_ELEMENT.unkB4, x32 & 0xffff);
        mem.write16(self + TEXT_ELEMENT.unkB6, y32 & 0xffff);
        return;
    }
    mem.write8(self + TEXT_ELEMENT.unkC2, 0);
    mem.write16(self + TEXT_ELEMENT.unkB4, 0);
    mem.write16(self + TEXT_ELEMENT.unkB6, 0);
}

/** F0x8001A23C. */
export function setTextElementFlagC1(mem: TextElementMemory, self: number, v: number): void {
    const unk62 = (mem.read16(self + TEXT_ELEMENT.unk62) << 16) >> 16; // signed lh
    if (unk62 !== 0) {
        mem.write8(self + TEXT_ELEMENT.unkC1, v & 0xff);
        return;
    }
    mem.write8(self + TEXT_ELEMENT.unkC1, 0);
}

/** F0x8001A418. */
export function set_unk_0xc8_fns_8001a418(mem: TextElementMemory, self: number, v: number): void {
    mem.write32(self + TEXT_ELEMENT.unkC8, v | 0);
}

/** F0x8001A448. */
export function set_unk_0x58_fns_8001a448(mem: TextElementMemory, self: number, v: number): void {
    mem.write32(self + TEXT_ELEMENT.unk58, v | 0);
}

/** F0x8001A450. */
export function set_unk_0xbf_fns_8001a450(mem: TextElementMemory, self: number, v: number): void {
    mem.write8(self + TEXT_ELEMENT.unkBF, v & 0xff);
}

// ── the widget's getter/state leaves + the fetcher-table store ─────────────
//
// F0x8001A460 `lbu v0,0xc3(a0)`, F0x8001A46C `lbu v0,0xc1(a0)` and
// F0x8001A478 `lw v0,0x10(a0); xori v0,1; sltiu v0,1` are three-instruction
// leaves; F0x8001F738 is `sw a0,0x1c8(gp)`. The gp store's global is the boot
// gp the interpreter/probe runs with (tools/native_screen_probe.ts:492).

/** The boot `$gp` the original EXE's gp-relative code runs with. */
export const BOOT_GP = 0x8005cb50;
/** `[gp+0x1C8]`: the pointer F0x8001F738 stores. */
export const CURRENT_FETCHER_TABLE = (BOOT_GP + 0x1c8) >>> 0;

/** The widget word the state predicate reads. */
export const TEXT_ELEMENT_STATE = 0x10;

export interface TextElementReader {
    read8(addr: number): number;
    read32(addr: number): number;
}

export interface WordWriter {
    write32(addr: number, value: number): void;
}

/** F0x8001A460: the +0xC3 pause flag, zero-extended (`lbu`). */
export function getUnkC3(mem: TextElementReader, self: number): number {
    return mem.read8(self + 0xc3) & 0xff;
}

/** F0x8001A46C: the +0xC1 visibility flag, zero-extended (`lbu`). */
export function getUnkC1(mem: TextElementReader, self: number): number {
    return mem.read8(self + 0xc1) & 0xff;
}

/**
 * F0x8001A478: 1 when the word at +0x10 is exactly 1, else 0. The original
 * is `lw; xori 1; sltiu 1`, i.e. an unsigned `(value ^ 1) < 1`.
 */
export function isState1(mem: TextElementReader, self: number): number {
    return ((mem.read32(self + TEXT_ELEMENT_STATE) ^ 1) >>> 0) < 1 ? 1 : 0;
}

/** F0x8001F738: store the current fetcher table pointer into `[gp+0x1C8]`. */
export function setCurrentFetcherTable(mem: WordWriter, table: number): void {
    mem.write32(CURRENT_FETCHER_TABLE, table | 0);
}
