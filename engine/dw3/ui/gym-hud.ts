// The training gym's left HUD, translated from pro/stgtrain F0x80083AEC
// (construct), F0x80083D10 (name/level/HP/MP/footer fill), F0x80084064 (stat
// readouts) and F0x80084270 (partner summary).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/gym-hud-oracle.test.js runs each original through engine/native
// with the text factory, the service cells and every widget method stubbed and
// compares the ordered calls and the written hud pointers.
//
// DECODED: the accepted gym-hud-text answer (authority-2 anchors in
// exe-decomp/stgtrain_c/_asm/) and the decomp files. screen+0x50 is the widget
// target halfword; screen+0x68 is the selected pod (party position); the hud
// block is the same object as screen+0x24. The 0x2734 cell (F0x80017174) copies
// a 0x2C-byte projection to the caller's stack, which the fills read at fixed
// offsets: 0 level, 2 tp, 4 cur_hp, 6 max_hp, 8 cur_mp, 0x0A max_mp,
// 0x0C..0x16 the six core stats, 0x18..0x24 the seven elements, 0x26/0x28/0x2A
// the three conditional-stat flags.
//
// The thirteen numbers themselves are the shared walk in ui/stat-panel.ts, one
// port of the three original populate routines; only the widget list, the missing
// 999 cap and the call order are this screen's.
//
// The text factory (F0x8001AE38), the service cells and the widget methods
// (+0x114/+0x118/+0x138/+0x144/+0x148) are host boundaries; the setters are
// already ported in engine/dw3/ui/text-*.ts.

import { fillStatPanel, STAT_CORE_COUNT } from "./stat-panel.ts";

export interface GymHudMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface GymHudHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** [0x80044B38+0x414] = F0x80013E5C(languageIndex + offset). */
    resolveText(offset: number): number;
    /** [0x80048D34+0x2718](position) = F0x80016D94 -> roster slot. */
    rosterSlot(position: number): number;
    /** [0x80048D34+0x2750](slot) = F0x80017B4C -> the member's record base. */
    rosterHandle(slot: number): number;
    /** [0x80048D34+0x2734](slot, dest) = F0x80017174: copy the 0x2C-byte projection. */
    copyProjection(slot: number, dest: number): void;
    /** Widget +0x114 (F0x800194E8): install line 0 from a source/index. */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** Widget +0x118 (F0x800195B0): render a number on a line. */
    widgetSetLineNumber(widget: number, line: number, value: number): void;
    /** Widget +0x138 (F0x8001A1F4): set_unk_0xc0. */
    widgetSetC0(widget: number, code: number): void;
    /** Widget +0x144 (F0x8001A23C): show/hide flag. */
    widgetSetFlagC1(widget: number, value: number): void;
    /** Widget +0x148 (F0x8001A25C): measure and store the width. */
    widgetMeasure(widget: number, value: number): void;
}

/** Screen/hud fields the HUD family reads. */
export const GYM_HUD_FIELDS = { target: 0x50, pod: 0x68 } as const;
/** The 11 single-widget sites of the constructor, in machine order. */
export const GYM_HUD_SINGLES: ReadonlyArray<readonly [number, number, number, number]> = [
    [0x00, 1, 0x33, 0x13],
    [0x04, 3, 0x33, 0x22],
    [0x08, 3, 0x50, 0x22],
    [0x0c, 3, 0x33, 0x2c],
    [0x10, 3, 0x5d, 0x2c],
    [0x14, 3, 0x80, 0x2c],
    [0x18, 3, 0x33, 0x35],
    [0x1c, 3, 0x5d, 0x35],
    [0x20, 3, 0x80, 0x35],
    [0x24, 3, 0x5f, 0x2c],
    [0x28, 3, 0x5f, 0x35],
];
const STAT_ROWS = 6;
const ELEMENT_ROWS = 7;

const s16 = (v: number): number => (v << 16) >> 16;

function proj16(mem: GymHudMemory, proj: number, off: number): number {
    return s16(mem.read16(proj + off));
}

/** F0x80083AEC(screen, hud): build the 28 HUD widgets. */
export function gymHudConstruct(
    mem: GymHudMemory,
    screen: number,
    hud: number,
    host: GymHudHost,
): void {
    const target = s16(mem.read16(screen + GYM_HUD_FIELDS.target));
    for (const [off, kind, x, y] of GYM_HUD_SINGLES) {
        mem.write32(hud + off, host.createTextElement(target, kind, x, y) >>> 0);
    }
    for (let i = 0; i < 6; i++) {
        mem.write32(hud + 0x2c + 4 * i, host.createTextElement(target, 1, 0x33, 79 + 14 * i) >>> 0);
    }
    for (let j = 0; j < 7; j++) {
        mem.write32(hud + 0x44 + 4 * j, host.createTextElement(target, 1, 0x5d, 79 + 14 * j) >>> 0);
    }
    mem.write32(hud + 0x60, host.createTextElement(target, 1, 0x10, 0xbb) >>> 0);
    mem.write32(hud + 0x64, host.createTextElement(target, 1, 0x2c, 0xbb) >>> 0);
    mem.write32(hud + 0x68, host.createTextElement(target, 1, 0xa1, 0x17) >>> 0);
    mem.write32(hud + 0x6c, host.createTextElement(target, 1, 0xae, 0x49) >>> 0);
}

/** F0x80083D10(screen, hud, show, proj): name, level, HP/MP and the footer. */
export function gymHudTextFill(
    mem: GymHudMemory,
    screen: number,
    hud: number,
    show: number,
    host: GymHudHost,
    proj: number,
): void {
    const w = (off: number): number => mem.read32(hud + off) >>> 0;
    if (show !== 0) {
        const slot = host.rosterSlot(mem.read32(screen + GYM_HUD_FIELDS.pod) | 0) | 0;
        const name = host.rosterHandle(slot) >>> 0;
        host.copyProjection(slot, proj);
        host.widgetSetLine0(w(0x00), name, -1);
        host.widgetSetLine0(w(0x04), host.resolveText(0x10b), 1);
        host.widgetSetLineNumber(w(0x08), 0, proj16(mem, proj, 0x00));
        host.widgetMeasure(w(0x08), 1);
        host.widgetSetLine0(w(0x0c), host.resolveText(0x10b), 2);
        host.widgetSetLineNumber(w(0x10), 0, proj16(mem, proj, 0x04));
        host.widgetSetLineNumber(w(0x14), 0, proj16(mem, proj, 0x06));
        for (const off of [0x10, 0x14]) {
            host.widgetSetC0(w(off), 0);
            host.widgetMeasure(w(off), 1);
        }
        host.widgetSetLine0(w(0x18), host.resolveText(0x10b), 3);
        host.widgetSetLineNumber(w(0x1c), 0, proj16(mem, proj, 0x08));
        host.widgetSetLineNumber(w(0x20), 0, proj16(mem, proj, 0x0a));
        for (const off of [0x1c, 0x20]) {
            host.widgetSetC0(w(off), 0);
            host.widgetMeasure(w(off), 1);
        }
        for (const off of [0x24, 0x28]) host.widgetSetLine0(w(off), host.resolveText(0x10b), 0x43);
        return;
    }
    host.widgetSetFlagC1(w(0x00), 0);
    host.widgetSetFlagC1(w(0x04), 0);
    host.widgetSetFlagC1(w(0x24), 0);
    host.widgetSetFlagC1(w(0x08), 0);
    host.widgetSetFlagC1(w(0x28), 0);
    for (const off of [0x0c, 0x10, 0x14]) host.widgetSetFlagC1(w(off), 0);
    for (const off of [0x18, 0x1c, 0x20]) host.widgetSetFlagC1(w(off), 0);
}

/** F0x80084064(screen, hud, show, proj): the six core and seven element stats. */
export function gymStatReadoutsFill(
    mem: GymHudMemory,
    screen: number,
    hud: number,
    show: number,
    host: GymHudHost,
    proj: number,
): void {
    const w = (off: number): number => mem.read32(hud + off) >>> 0;
    if (show !== 0) {
        host.copyProjection(host.rosterSlot(mem.read32(screen + GYM_HUD_FIELDS.pod) | 0) | 0, proj);
        // The gym is the one screen that does not cap at 999 (F0x80084064 never
        // compares) and the one that greys between its two runs of numbers.
        fillStatPanel(mem, {
            widget: (index: number): number => w(index < STAT_CORE_COUNT ? 0x2c + 4 * index : 0x44 + 4 * (index - STAT_CORE_COUNT)),
            setNumber: (widget: number, value: number): void => host.widgetSetLineNumber(widget, 0, value),
            setEnabled: (widget: number): void => host.widgetMeasure(widget, 1),
            setMark: (widget: number, code: number): void => host.widgetSetC0(widget, code),
        }, proj, { cap: false, marks: "between", pass: "inline-clear" });
        return;
    }
    for (let i = 0; i < STAT_ROWS; i++) host.widgetSetFlagC1(w(0x2c + 4 * i), 0);
    for (let j = 0; j < ELEMENT_ROWS; j++) host.widgetSetFlagC1(w(0x44 + 4 * j), 0);
}

/** F0x80084270(screen, hud, show, proj): the partner TP summary. */
export function gymPartnerSummaryFill(
    mem: GymHudMemory,
    screen: number,
    hud: number,
    show: number,
    host: GymHudHost,
    proj: number,
): void {
    const w = (off: number): number => mem.read32(hud + off) >>> 0;
    if (show !== 0) {
        host.copyProjection(host.rosterSlot(mem.read32(screen + GYM_HUD_FIELDS.pod) | 0) | 0, proj);
        host.widgetSetLine0(w(0x60), host.resolveText(0x10b), 4);
        host.widgetSetLineNumber(w(0x64), 0, proj16(mem, proj, 0x02));
        host.widgetMeasure(w(0x64), 1);
        return;
    }
    host.widgetSetFlagC1(w(0x60), 0);
    host.widgetSetFlagC1(w(0x64), 0);
}
