// The Effects-card helper chain of the item shop, translated from pro/stitshop
// F0x80088DB8 (stat adder), F0x80088E8C (one card number), F0x80088F4C (the
// arrow/trend code) and F0x800890B0 (the trailing stat rows).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/effects-card-helpers-oracle.test.js runs each original through
// engine/native with the widget method slots stubbed and compares the ordered
// call stream and the written record fields.
//
// DECODED: exe-decomp/stitshop_c/{F0x80088db8,F0x80088e8c,F0x80088f4c,
// F0x800890b0}.c and their raw bodies in _asm/, plus the accepted
// effects-card-fill answer U4 and the verified claim
// EQUIP-C016-shop-gear-stat-contributions. The stat block is 22 halfwords at the
// per-member record band+0x64+0x80*i: the "before" half at +0x00 and the
// "after" half at +0x2C. 0x8008CAE8 is the display-offset table (6..18).
//
//   F0x80088DB8(buf, code, amount): code 7 adds to the six halves at
//     buf+0x0C..+0x16; codes 1..6 to buf+0x0A+2*code; codes 8..14 to
//     buf+0x08+2*code; each saturating at 999 when the signed 16-bit result
//     reaches 1000.
//   F0x80088E8C(band, widget, state): render the state's stat half (after if
//     state+0x08, else before) via +0x118 and measure.
//   F0x80088F4C(band, widget, state): pick the trend code 0/1/5/6 and call
//     +0x138 with it.
//   F0x800890B0(band, widgets, state): walk display index 0..12, skip the two
//     state skips and equal halves, write record+0x68+4*row = idx+1 and the
//     card value/trend for up to four rows, then add the row count to
//     record+0x5C and hide the unused widgets.

import {
  CUR_STATS, ORIGINAL_EQUIP_BASE, ROSTER_STRIDE, persistentRosterSlot, rosterContextBase,
} from "../party-context.ts";

export interface EffectsCardMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface EffectsStatBlockHost extends EffectsCardHost {
    /** [0x80042B98](itemId) -> the item record pointer. */
    itemRecord(itemId: number): number;
}

export interface EffectsCardHost {
    /** Widget +0x118 (F0x800195B0): render a number on a line. */
    widgetSetLineNumber(widget: number, line: number, value: number): void;
    /** Widget +0x148 (F0x8001A25C): measure and store the width. */
    widgetMeasure(widget: number, value: number): void;
    /** Widget +0x138 (F0x8001A1F4): set the trend code. */
    widgetSetC0(widget: number, code: number): void;
    /** Widget +0x144 (F0x8001A23C): show/hide flag. */
    widgetSetFlagC1(widget: number, value: number): void;
}

/** The display-offset word table (0..12 -> stat halfword offset 6..18). */
export const STAT_DISPLAY_TABLE = 0x8008cae8;
/** Per-member stat record base offset and stride. */
export const MEMBER_RECORD = { base: 0x64, stride: 0x80, after: 0x2c, rows: 0x68, rowCount: 0x5c } as const;
const STAT_CAP = 0x3e7;

const s16 = (v: number): number => (v << 16) >> 16;

function saturatingAdd(mem: EffectsCardMemory, addr: number, amount: number): void {
    const value = (mem.read16(addr) + amount) & 0xffff;
    mem.write16(addr, value);
    if (s16(value) >= 0x3e8) mem.write16(addr, STAT_CAP);
}

/** F0x80088DB8(buf, code, amount): add `amount` to one stat group. */
export function effectsStatAdd(
    mem: EffectsCardMemory,
    buf: number,
    code: number,
    amount: number,
): void {
    if (code === 7) {
        for (let k = 0; k < 6; k++) saturatingAdd(mem, buf + 0x0c + 2 * k, amount);
        return;
    }
    if (((code - 1) >>> 0) < 6) {
        saturatingAdd(mem, buf + 0x0a + 2 * code, amount);
        return;
    }
    if (((code - 8) >>> 0) < 7) {
        saturatingAdd(mem, buf + 0x08 + 2 * code, amount);
    }
}

function statOffset(mem: EffectsCardMemory, index: number): number {
    return mem.read32(STAT_DISPLAY_TABLE + Math.imul(index, 4)) | 0;
}

/** F0x80088E8C(band, widget, state): render the state's stat half. */
export function effectsCardNumber(
    mem: EffectsCardMemory,
    band: number,
    widget: number,
    state: number,
    host: EffectsCardHost,
): void {
    const record = memberRecord(mem, band, state);
    const offset = statOffset(mem, mem.read32(state + 0x04) | 0);
    const after = (mem.read32(state + 0x08) | 0) !== 0;
    const value = mem.read16(record + (after ? MEMBER_RECORD.after : 0) + Math.imul(offset, 2));
    host.widgetSetLineNumber(widget, 0, s16(value));
    host.widgetMeasure(widget, 1);
}

/** The arrow field index the trend test reads: 0->0, 1->1, 4->2, else -1. */
function arrowField(key: number): number {
    if (key === 0) return 0;
    if (key === 1) return 1;
    if (key === 4) return 2;
    return -1;
}

/** F0x80088F4C(band, widget, state): the trend code 0/1/5/6. */
export function effectsCardArrow(
    mem: EffectsCardMemory,
    band: number,
    widget: number,
    state: number,
    host: EffectsCardHost,
): void {
    const record = memberRecord(mem, band, state);
    const key = mem.read32(state + 0x04) | 0;
    const field = arrowField(key);
    const offset = statOffset(mem, key);
    const before = s16(mem.read16(record + Math.imul(offset, 2)));
    const arrowed = field >= 0 && mem.read16(record + 0x26 + Math.imul(field, 2)) !== 0;
    if ((mem.read32(state + 0x08) | 0) === 0) {
        host.widgetSetC0(widget, arrowed ? 6 : 0);
        return;
    }
    const after = s16(mem.read16(record + MEMBER_RECORD.after + Math.imul(offset, 2)));
    if (before === after) {
        host.widgetSetC0(widget, arrowed ? 6 : 0);
    } else if (before < after) {
        host.widgetSetC0(widget, 1);
    } else {
        host.widgetSetC0(widget, 5);
    }
}

/** F0x800890B0(band, widgets, state): the trailing stat rows. */
export function effectsTrailingRows(
    mem: EffectsCardMemory,
    band: number,
    widgets: number,
    state: number,
    host: EffectsCardHost,
): void {
    const record = memberRecord(mem, band, state);
    const skipA = mem.read32(state + 0x0c) | 0;
    const skipB = mem.read32(state + 0x10) | 0;
    let rows = 0;
    for (let idx = 0; idx < 0xd; idx++) {
        if (idx === skipA) continue;
        if (skipB >= 0 && idx === skipB) continue;
        const offset = statOffset(mem, idx);
        const before = s16(mem.read16(record + Math.imul(offset, 2)));
        const after = s16(mem.read16(record + MEMBER_RECORD.after + Math.imul(offset, 2)));
        if (before === after) continue;
        mem.write32(record + MEMBER_RECORD.rows + Math.imul(4, rows), (idx + 1) >>> 0);
        const widget = mem.read32(widgets + Math.imul(4, rows)) >>> 0;
        host.widgetSetLineNumber(widget, 0, after);
        host.widgetMeasure(widget, 1);
        host.widgetSetC0(widget, before < after ? 1 : 5);
        rows += 1;
    }
    mem.write32(record + MEMBER_RECORD.rowCount, ((mem.read32(record + MEMBER_RECORD.rowCount) | 0) + rows) >>> 0);
    for (let k = rows; k < 4; k++) {
        host.widgetSetFlagC1(mem.read32(widgets + Math.imul(4, k)) >>> 0, 0);
    }
}

function memberRecord(mem: EffectsCardMemory, band: number, state: number): number {
    const member = mem.read32(state) | 0;
    return band + MEMBER_RECORD.base + Math.imul(member, MEMBER_RECORD.stride);
}

/**
 * The gear-slot array cell the stat-block builder walks: ctx + slot*0x3DC + 0x3C0.
 * That is `CUR_STATS`, the original's own record base (F0x80017B4C's return), so it
 * is now the ONE place's `CUR_STATS` rather than a second literal; the six offsets
 * themselves come from `party-context` with every other reader.
 */
export const GEAR_SLOT_BASE = CUR_STATS;
/** The per-member stat source offset in the party context. */
export const STAT_SOURCE_OFFSET = 0x784;
export { ROSTER_STRIDE };
/** Stat block size copied into the card: 0x2C bytes (22 halfwords). */
export const STAT_BLOCK_SIZE = 0x2c;

function addClamp999(mem: EffectsCardMemory, addr: number, amount: number): void {
    const value = (mem.read16(addr) + amount) & 0xffff;
    mem.write16(addr, value);
    if (s16(value) >= 0x3e8) mem.write16(addr, 0x3e7);
}

/** F0x80088A64(slot, dest): build one member's before/after stat block. */
export function effectsStatBlock(
    mem: EffectsCardMemory,
    slot: number,
    dest: number,
    host: EffectsStatBlockHost,
): void {
    const source = rosterContextBase(slot) + STAT_SOURCE_OFFSET;
    for (let i = 0; i < STAT_BLOCK_SIZE; i++) mem.write8(dest + i, mem.read8(source + i));

    const gear = persistentRosterSlot(slot) + ORIGINAL_EQUIP_BASE;
    for (let s5 = 0; s5 < 6; s5++) {
        const itemId = s16(mem.read16(gear + 2 * s5));
        if (itemId <= 0) continue;
        const item = host.itemRecord(itemId) >>> 0;
        const klass = mem.read8(item + 0x9) & 0xff;
        const stats = mem.read32(item + 0x0) >>> 0;
        if (((klass - 2) >>> 0) < 0xd) {
            addClamp999(mem, dest + 0x0c, mem.read16(stats + 0x0a));
            for (let j = 0; j < 2; j++) {
                const code = mem.read8(stats + 0x0c + j) & 0xff;
                if (code !== 0) effectsStatAdd(mem, dest, code, s16(mem.read16(stats + 0x06 + 2 * j)));
            }
            addClamp999(mem, dest + 0x16, mem.read16(stats + 0x00));
        } else if (((klass - 0x0f) & 0xff) < 6) {
            addClamp999(mem, dest + 0x0e, mem.read16(stats + 0x0c));
            for (let j = 0; j < 2; j++) {
                const code = mem.read8(stats + 0x0a + j) & 0xff;
                if (code !== 0) effectsStatAdd(mem, dest, code, s16(mem.read16(stats + 0x06 + 2 * j)));
            }
            addClamp999(mem, dest + 0x16, mem.read16(stats + 0x00));
        } else if (((klass - 0x15) & 0xff) < 4) {
            const code = mem.read8(stats + 0x08) & 0xff;
            if (code !== 0) effectsStatAdd(mem, dest, code, s16(mem.read16(stats + 0x06)));
            addClamp999(mem, dest + 0x16, mem.read16(stats + 0x00));
        }
    }

    subFloorZero(mem, dest + 0x0c, mem.read16(dest + 0x26));
    subFloorZero(mem, dest + 0x0e, mem.read16(dest + 0x28));
    subFloorZero(mem, dest + 0x14, mem.read16(dest + 0x2a));
}

function subFloorZero(mem: EffectsCardMemory, addr: number, sub: number): void {
    const value = (mem.read16(addr) - sub) & 0xffff;
    mem.write16(addr, value);
    if (value & 0x8000) mem.write16(addr, 0);
}
