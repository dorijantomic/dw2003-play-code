// The fight report's per-row fill, translated from pro/stfgtrep F0x80083404.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/fight-report-row-oracle.test.js runs the original through
// engine/native with the save-context cells, the stat table and every widget
// method stubbed and compares the ordered calls.
//
// DECODED: exe-decomp/stfgtrep_c/F0x80083404.c and _asm/F0x80083404.s plus the
// accepted fight-report-hud answer (family C). The row object (arg0) holds the
// party position at +0x5C, the shown stat value at +0x138, three s16 stat ids at
// +0x74/+0x76/+0x78, and a signed byte at +0xD6; the widget block (arg1) holds
// the name +0x00, level digits +0x04, LV label +0x08, stat digits +0x0C, stat
// label +0x10, then three bar/value pairs at +0x14/+0x18, +0x1C/+0x20,
// +0x24/+0x28. The save context supplies the member record ([ctx+0x2718] /
// [ctx+0x2750]), the row stat-id copy ([ctx+0x2738]) and the per-stat value copy
// ([ctx+0x2748]); the stat-name table is [0x8005CCA0] and the message bank is
// resolveText(lang + 0x55 / 0x4E).

export interface FightRowMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
}

export interface FightRowHost {
    /** [0x80048D34+0x2718](position): party position -> roster slot. */
    rosterSlot(position: number): number;
    /** [0x80048D34+0x2750](slot): the member record base. */
    rosterHandle(slot: number): number;
    /** [0x80048D34+0x2738](slot, dest): copy the row's stat-id block. */
    copyRowStats(slot: number, dest: number): void;
    /** [0x80048D34+0x2748](slot, statId, dest): copy one stat value. */
    copyStatValue(slot: number, statId: number, dest: number): void;
    /** [0x80044B38+0x414] = F0x80013E5C(languageIndex + offset). */
    resolveText(offset: number): number;
    /** [0x8005CCA0](statId) -> the stat-name record. */
    statTable(statId: number): number;
    /** Widget +0x114 (F0x800194E8). */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** Widget +0x118 (F0x800195B0). */
    widgetSetLineNumber(widget: number, line: number, value: number): void;
    /** Widget +0x140 (F0x8001A204). */
    widgetSetGlyphCell(widget: number, a1: number, a2: number): void;
    /** Widget +0x144 (F0x8001A23C). */
    widgetSetFlagC1(widget: number, value: number): void;
    /** Widget +0x148 (F0x8001A25C). */
    widgetMeasure(widget: number, value: number): void;
}

/** Row-object fields read by the fill. */
export const FIGHT_ROW_FIELDS = {
    member: 0x5c,
    value: 0x138,
    statIds: 0x74,
    statByte: 0xd6,
} as const;
/** The three bar/value widget pairs, relative to the block. */
export const FIGHT_ROW_PAIRS: ReadonlyArray<readonly [number, number]> = [
    [0x14, 0x18],
    [0x1c, 0x20],
    [0x24, 0x28],
];
const BANK_LABELS = 0x55;
const BANK_STATS = 0x4e;

const s16 = (v: number): number => (v << 16) >> 16;
const s8 = (v: number): number => (v << 24) >> 24;

/** F0x80083404(row, block, show): fill or clear one report row. */
export function reportRowFill(
    mem: FightRowMemory,
    row: number,
    block: number,
    show: number,
    host: FightRowHost,
): void {
    const w = (off: number): number => mem.read32(block + off) >>> 0;
    if (show !== 0) {
        const slot = host.rosterSlot(mem.read32(row + FIGHT_ROW_FIELDS.member) | 0) | 0;
        const handle = host.rosterHandle(slot) >>> 0;
        host.widgetSetLine0(w(0x00), handle, -1);
        host.widgetSetLineNumber(w(0x04), 0, s16(mem.read16(handle + 0x1c)));
        host.widgetMeasure(w(0x04), 1);
        host.widgetSetLine0(w(0x08), host.resolveText(BANK_LABELS), 3);
        host.widgetSetLineNumber(w(0x0c), 0, mem.read32(row + FIGHT_ROW_FIELDS.value) | 0);
        host.widgetMeasure(w(0x0c), 1);
        host.widgetSetGlyphCell(w(0x0c), 7, 0);
        host.widgetSetLine0(w(0x10), host.resolveText(BANK_LABELS), 1);
        host.copyRowStats(slot, row + FIGHT_ROW_FIELDS.statIds);
        for (let i = 0; i < 3; i++) {
            const statId = s16(mem.read16(row + FIGHT_ROW_FIELDS.statIds + 2 * i));
            const [barOff, valueOff] = FIGHT_ROW_PAIRS[i]!;
            const bar = w(barOff);
            const value = w(valueOff);
            if (statId >= 4) {
                host.copyStatValue(slot, statId, row + 0xd4);
                const bank = host.resolveText(BANK_STATS);
                const stat = host.statTable(statId) >>> 0;
                host.widgetSetLine0(bar, bank, mem.read8(stat + 0x55) & 0xff);
                host.widgetSetLineNumber(value, 0, s8(mem.read8(row + FIGHT_ROW_FIELDS.statByte)));
                host.widgetMeasure(value, 1);
            } else {
                host.widgetSetFlagC1(bar, 0);
                host.widgetSetFlagC1(value, 0);
            }
        }
        return;
    }
    host.widgetSetFlagC1(w(0x00), 0);
    host.widgetSetFlagC1(w(0x04), 0);
    host.widgetSetFlagC1(w(0x08), 0);
    host.widgetSetFlagC1(w(0x0c), 0);
    host.widgetSetFlagC1(w(0x10), 0);
    for (const [bar, value] of FIGHT_ROW_PAIRS) {
        host.widgetSetFlagC1(w(bar), 0);
        host.widgetSetFlagC1(w(value), 0);
    }
}
