// The pause screen item grid's state machine, translated bit-exactly from the
// original pro/ststatus F0x80090264 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/pause-items-tick.test.js runs the original through
// engine/native and compares the ordered calls and fields.
//
// F0x80090264(obj, arg1) is a ~0x70-state jump-table machine (table 0x80083238
// on obj+0x10): it opens/closes the item rows, walks the party members, plays
// the open/use/cancel paths, drives the selected item's ability through
// [0x80042BA4], and hands to the item scene F0x80093678.
//
// The row fill (0x8008ED04), the animation helpers (0x8008F4E8 / 0x8008F584 /
// 0x8008F55C), the item scene (0x80093678), the ability service ([0x80042BA4]),
// the widget activate/ready services ([0x8009B5D8] / [0x8009B5DC]), the pad, the
// sound, the resource base and every widget/object method are host boundaries.
// The bit-box and footer-label fills are the already-translated local functions.
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

import {
    pauseItemsBitBoxFill,
    pauseItemsFooterLabelsFill,
    type PauseItemsTextHost,
} from "../pause-items-text.ts";

/** The string-bank global the tick resolves names from. */
export const PAUSE_ITEMS_TICK_STRING_BASE = 0x8005cca8;
/** The per-item ability table and the 0x0451xx sound ids. */
export const PAUSE_ITEMS_TICK_ABILITY_TABLE = 0x8009a890;
export const PAUSE_ITEMS_TICK_MOVE_SOUND = 0x8004513e;
export const PAUSE_ITEMS_TICK_USE_SOUND = 0x8004503c;
export const PAUSE_ITEMS_TICK_CANCEL_SOUND = 0x800450bd;
export const PAUSE_ITEMS_TICK_CONFIRM_SOUND = 0x4001c;
export const PAUSE_ITEMS_TICK_LIST_SOUND = 0x4001b;
/** The five item rows' base offset and stride. */
export const PAUSE_ITEMS_TICK_ROWS = 0x3cc;
export const PAUSE_ITEMS_TICK_ROW_STRIDE = 0x10;

export interface PauseItemsTickMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PauseItemsTickHost {
    /** F0x8008ED04(obj, arg1, index, flag): fill one item row. */
    rowFill(obj: number, arg1: number, index: number, flag: number): void;
    /** F0x8008F4E8(obj, flag): start the item animation. */
    animStart(obj: number, flag: number): void;
    /** F0x8008F584(obj, arg1): finish the item animation. */
    animFinish(obj: number, arg1: number): void;
    /** F0x8008F55C(obj): nonzero while the item animation runs. */
    animActive(obj: number): number;
    /** F0x80093678(obj, index, sub): open the item's scene. */
    openItem(obj: number, index: number, sub: number): number;
    /** [0x80042BA4](record, obj+0x84): the item's ability test. */
    ability(record: number, arg: number): number;
    /** [0x8009B5D8](ptr, flag): set a widget/row active flag. */
    widgetAct(ptr: number, flag: number): void;
    /** [0x8009B5DC](ptr): read a widget/row active flag. */
    widgetReady(ptr: number): number;
    /** [0x80044B38+0x414](id): the resource/string base. */
    resourceBase(id: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8004B7D0+0x3F4](port): the primary pad word. */
    padReadA(port: number): number;
    /** [0x8004B7D0+0x3FC](port): the alternate pad word. */
    padReadB(port: number): number;
    /** [0x8004B7D0+0x408](port, code): the shifted button bit. */
    padButton(port: number, code: number): number;
    /** target+slot(a1, a2): a widget or screen object method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** F0x80090264(obj, arg1): the pause item grid state machine. */
export function pauseItemsTick(
    mem: PauseItemsTickMemory,
    obj: number,
    arg1: number,
    host: PauseItemsTickHost,
): void {
    const count = () => mem.read32(obj + 0x5c) | 0;
    const act = (ptr: number, flag: number) => host.widgetAct(ptr, flag);
    const ready = (ptr: number) => host.widgetReady(ptr) | 0;
    const rowFill = (index: number, flag: number) => host.rowFill(obj, arg1, index, flag);
    const lang = () => mem.read32(PAUSE_ITEMS_TICK_STRING_BASE) | 0;
    const text = (offset: number) => host.resourceBase((lang() + offset) | 0);
    const advance = () => mem.write32(obj + 0x10, (mem.read32(obj + 0x10) + 1) | 0);
    const pressed = (code: number) => {
        const a = host.padReadA(0) | 0;
        const b = host.padButton(0, code) | 0;
        if ((((a >> b) & 1) | 0) !== 0) return true;
        const c = host.padReadB(0) | 0;
        const d = host.padButton(0, code) | 0;
        return ((((c >> d) & 1) | 0) !== 0);
    };
    const pressedOnly = (code: number) => {
        const a = host.padReadA(0) | 0;
        const b = host.padButton(0, code) | 0;
        return ((((a >> b) & 1) | 0) !== 0);
    };
    const textHost: PauseItemsTextHost = {
        resolveText: (offset) => text(offset),
        widgetSetLine0: (widget, source, index) => host.callMethod(widget, 0x114, [source, index]),
        widgetSetLineNumber: (widget, line, value) => host.callMethod(widget, 0x118, [line, value]),
        widgetSetFlagC1: (widget, value) => host.callMethod(widget, 0x144, [value]),
        widgetMeasure: (widget, value) => host.callMethod(widget, 0x148, [value]),
    };
    const bitBox = (flag: number) => pauseItemsBitBoxFill(mem, arg1, flag, textHost);
    const footer = (flag: number) => pauseItemsFooterLabelsFill(mem, arg1, flag, textHost);

    switch (mem.read32(obj + 0x10) | 0) {
        case 0x01:
            ready(obj + 0x3cc);
            ready(obj + 0x3fc);
            if ((mem.read32(obj + 0x14) | 0) === 0) ready(obj + 0x40c);
            ready(obj + 0x42c);
            if (ready(obj + 0x41c) !== 0) {
                host.callMethod(mem.read32(arg1) | 0, 0x114, [text(0xb0), 0x14]);
                host.rowFill(obj, arg1, 0, 1);
                host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x114, [text(0xb0), ((mem.read32(obj + 0x70) | 0) + 0x1b) | 0]);
                host.callMethod(mem.read32(arg1 + 0x8c) | 0, 0x114, [text(0xb0), 0x15]);
                bitBox(1);
                footer(1);
                host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x80, [1]);
                mem.write32(obj + 0x10, 0x0a);
                return;
            }
            return;
        case 0x02:
            ready(obj + 0x3cc);
            if (ready(obj + 0x3fc) !== 0) {
                act(obj + 0x3dc, 1);
                if ((mem.read32(obj + 0x14) | 0) === 0) act(obj + 0x40c, 1);
                act(obj + 0x42c, 1);
                act(obj + 0x41c, 1);
                host.callMethod(mem.read32(arg1) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), 0x14]);
                host.rowFill(obj, arg1, 0, 1);
                mem.write32(obj + 0x10, 4);
                return;
            }
            return;
        case 0x03:
            ready(obj + 0x3cc);
            if (ready(obj + 0x3fc) !== 0) {
                act(obj + 0x3dc, 1);
                act(obj + 0x41c, 1);
                host.callMethod(mem.read32(arg1) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), 0x14]);
                host.rowFill(obj, arg1, 0, 1);
                mem.write32(obj + 0x10, 5);
                return;
            }
            return;
        case 0x04:
            ready(obj + 0x3dc);
            if ((mem.read32(obj + 0x14) | 0) === 0) ready(obj + 0x40c);
            ready(obj + 0x42c);
            if (ready(obj + 0x41c) !== 0) {
                host.rowFill(obj, arg1, 1, 1);
                footer(1);
                host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), ((mem.read32(obj + 0x70) | 0) + 0x1b) | 0]);
                host.callMethod(mem.read32(arg1 + 0x8c) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), 0x15]);
                bitBox(1);
                host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x80, [1]);
                mem.write32(obj + 0x10, 0x0a);
                return;
            }
            return;
        case 0x05:
            ready(obj + 0x3dc);
            if (ready(obj + 0x41c) !== 0) {
                act(obj + 0x3ec, 1);
                if ((mem.read32(obj + 0x14) | 0) === 0) act(obj + 0x40c, 1);
                act(obj + 0x42c, 1);
                host.rowFill(obj, arg1, 1, 1);
                footer(1);
                advance();
                return;
            }
            return;
        case 0x06:
            ready(obj + 0x3ec);
            if ((mem.read32(obj + 0x14) | 0) === 0) ready(obj + 0x40c);
            if (ready(obj + 0x42c) !== 0) {
                host.rowFill(obj, arg1, 2, 1);
                host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), ((mem.read32(obj + 0x70) | 0) + 0x1b) | 0]);
                host.callMethod(mem.read32(arg1 + 0x8c) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), 0x15]);
                host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x80, [1]);
                bitBox(1);
                mem.write32(obj + 0x10, 0x0a);
                return;
            }
            return;
        case 0x0a: {
            const prev = mem.read32(obj + 0x70) | 0;
            if (pressed(4)) {
                const next = (mem.read32(obj + 0x70) - 1) | 0;
                mem.write32(obj + 0x70, next);
                if (next < 0) mem.write32(obj + 0x70, 0);
            } else if (pressed(6)) {
                const next = (mem.read32(obj + 0x70) + 1) | 0;
                mem.write32(obj + 0x70, next);
                if (next >= 5) mem.write32(obj + 0x70, 4);
            }
            if (prev !== (mem.read32(obj + 0x70) | 0)) {
                host.playSound(PAUSE_ITEMS_TICK_MOVE_SOUND);
                host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), ((mem.read32(obj + 0x70) | 0) + 0x1b) | 0]);
                host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x84, [0xb0, ((mem.read32(obj + 0x70) * 0x0e) + 0x31) | 0]);
                return;
            }
            if (pressedOnly(0x0d)) {
                host.playSound(PAUSE_ITEMS_TICK_USE_SOUND);
                const record = mem.read32(PAUSE_ITEMS_TICK_ABILITY_TABLE + (mem.read32(obj + 0x70) | 0) * 4) | 0;
                const result = host.ability(record, obj + 0x84) | 0;
                mem.write32(obj + 0x3ac, result);
                if (result <= 0) {
                    host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), ((mem.read32(obj + 0x70) | 0) + 0x64) | 0]);
                    return;
                }
                mem.write32(obj + 0x10, 0x0b);
                return;
            }
            if (pressedOnly(0x0e)) {
                host.playSound(PAUSE_ITEMS_TICK_CANCEL_SOUND);
                mem.write32(obj + 0x10, 0x32);
                return;
            }
            return;
        }
        case 0x0b: {
            for (let i = 0; i < count(); i++) {
                act(obj + PAUSE_ITEMS_TICK_ROWS + i * PAUSE_ITEMS_TICK_ROW_STRIDE, 0);
                host.rowFill(obj, arg1, i, 0);
            }
            act(obj + 0x3fc, 0);
            host.callMethod(mem.read32(arg1) | 0, 0x144, [0]);
            host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x144, [0]);
            host.callMethod(mem.read32(arg1 + 0x8c) | 0, 0x144, [0]);
            act(obj + 0x42c, 0);
            host.callMethod(mem.read32(arg1 + 0xa0) | 0, 0x144, [0]);
            host.callMethod(mem.read32(arg1 + 0x9c) | 0, 0x144, [0]);
            act(obj + 0x41c, 0);
            for (let i = 0; i < 5; i++) host.callMethod(mem.read32(arg1 + 0xa4 + i * 4) | 0, 0x144, [0]);
            host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x80, [0]);
            advance();
            return;
        }
        case 0x0c: {
            for (let i = 0; i < count(); i++) ready(obj + PAUSE_ITEMS_TICK_ROWS + i * PAUSE_ITEMS_TICK_ROW_STRIDE);
            ready(obj + 0x3fc);
            ready(obj + 0x42c);
            if (ready(obj + 0x41c) !== 0) {
                mem.write32(arg1 + 0xd0, host.openItem(obj, mem.read32(obj + 0x70) | 0, 0));
                host.animStart(obj, 1);
                mem.write32(obj + 0x10, 0x0f);
                return;
            }
            return;
        }
        case 0x0f:
            if (host.animActive(obj) !== 0) {
                advance();
                return;
            }
            return;
        case 0x10:
            if ((mem.read32(arg1 + 0xd0) | 0) === 0) {
                const result = mem.read32(obj + 0x7c) | 0;
                if (result === -1) {
                    mem.write32(obj + 0x10, 0);
                    mem.write32(obj + 0x14, 1);
                    return;
                }
                if (result === -2) {
                    mem.write32(obj + 0x10, 0x28);
                    return;
                }
                host.callMethod(obj, 0x2c, [0x14]);
                return;
            }
            return;
        case 0x14:
            act(obj + 0x3cc, 1);
            act(obj + 0x3fc, 1);
            advance();
            return;
        case 0x15:
            ready(obj + 0x3cc);
            if (ready(obj + 0x3fc) !== 0) {
                host.callMethod(mem.read32(arg1) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), 0x27]);
                host.rowFill(obj, arg1, 0, 1);
                if (count() !== 1) {
                    act(obj + 0x3dc, 1);
                    advance();
                    return;
                }
                mem.write32(obj + 0x10, 0x18);
                return;
            }
            return;
        case 0x16:
            if (ready(obj + 0x3dc) !== 0) {
                host.rowFill(obj, arg1, 1, 1);
                if (count() === 2) {
                    mem.write32(obj + 0x10, 0x18);
                    return;
                }
                act(obj + 0x3ec, 1);
                advance();
                return;
            }
            return;
        case 0x17:
            if (ready(obj + 0x3ec) !== 0) {
                host.rowFill(obj, arg1, 2, 1);
                advance();
                return;
            }
            return;
        case 0x18:
            mem.write32(obj + 0x3b4, 1);
            advance();
            return;
        case 0x19: {
            const prev = mem.read32(obj + 0x3b0) | 0;
            if (pressed(4)) {
                const next = (mem.read32(obj + 0x3b0) - 1) | 0;
                mem.write32(obj + 0x3b0, next);
                if (next < 0) mem.write32(obj + 0x3b0, 0);
            } else if (pressed(6)) {
                const next = (mem.read32(obj + 0x3b0) + 1) | 0;
                const max = (mem.read32(obj + 0x5c) - 1) | 0;
                mem.write32(obj + 0x3b0, next);
                if (max < next) mem.write32(obj + 0x3b0, max);
            }
            if (prev !== (mem.read32(obj + 0x3b0) | 0)) {
                host.playSound(PAUSE_ITEMS_TICK_LIST_SOUND);
                return;
            }
            if (pressedOnly(0x0d)) {
                host.animStart(obj, 0);
                act(obj + 0x3fc, 0);
                host.callMethod(mem.read32(arg1) | 0, 0x144, [0]);
                host.animFinish(obj, arg1);
                mem.write32(obj + 0x10, 0x64);
                mem.write32(obj + 0x14, 0);
                mem.write32(obj + 0x3c0, 1);
                return;
            }
            if (pressedOnly(0x0e)) {
                host.playSound(PAUSE_ITEMS_TICK_CANCEL_SOUND);
                mem.write32(obj + 0x14, 1);
                advance();
                act(obj + 0x3fc, 0);
                host.callMethod(mem.read32(arg1) | 0, 0x144, [0]);
                return;
            }
            return;
        }
        case 0x1a:
            mem.write32(obj + 0x3b4, 0);
            {
                const r = ready(obj + 0x3fc);
                if (host.animActive(obj) !== 0 && r !== 0) {
                    advance();
                    return;
                }
            }
            return;
        case 0x1b:
            switch (count()) {
                case 2:
                    act(obj + 0x3dc, 0);
                    host.rowFill(obj, arg1, 1, 0);
                    mem.write32(obj + 0x10, 0x1d);
                    return;
                case 3:
                    act(obj + 0x3ec, 0);
                    host.rowFill(obj, arg1, 2, 0);
                    mem.write32(obj + 0x10, 0x1c);
                    return;
                default:
                    act(obj + 0x3cc, 0);
                    host.rowFill(obj, arg1, 0, 0);
                    host.callMethod(mem.read32(arg1) | 0, 0x144, [0]);
                    mem.write32(obj + 0x10, 0x1e);
                    return;
            }
        case 0x1c:
            if (ready(obj + 0x3ec) !== 0) {
                act(obj + 0x3dc, 0);
                host.rowFill(obj, arg1, 1, 0);
                advance();
                return;
            }
            return;
        case 0x1d:
            if (ready(obj + 0x3dc) !== 0) {
                act(obj + 0x3cc, 0);
                host.rowFill(obj, arg1, 0, 0);
                host.callMethod(mem.read32(arg1) | 0, 0x144, [0]);
                advance();
                return;
            }
            return;
        case 0x1e:
            if (ready(obj + 0x3cc) !== 0) {
                if ((mem.read32(obj + 0x14) | 0) === 0) host.animStart(obj, 1);
                mem.write32(arg1 + 0xd0, host.openItem(obj, mem.read32(obj + 0x70) | 0, mem.read32(obj + 0x78) | 0));
                mem.write32(obj + 0x10, 0x0f);
                return;
            }
            return;
        case 0x28:
            mem.write32(obj + 0x0c, 3);
            return;
        case 0x32:
            switch (count()) {
                case 2:
                    act(obj + 0x3dc, 0);
                    act(obj + 0x40c, 0);
                    act(obj + 0x42c, 0);
                    act(obj + 0x41c, 0);
                    host.rowFill(obj, arg1, 1, 0);
                    break;
                case 3:
                    act(obj + 0x3ec, 0);
                    act(obj + 0x40c, 0);
                    act(obj + 0x42c, 0);
                    host.rowFill(obj, arg1, 2, 0);
                    break;
                default:
                    act(obj + 0x3cc, 0);
                    act(obj + 0x3fc, 0);
                    act(obj + 0x40c, 0);
                    act(obj + 0x42c, 0);
                    act(obj + 0x41c, 0);
                    host.rowFill(obj, arg1, 0, 0);
                    host.callMethod(mem.read32(arg1) | 0, 0x144, [0]);
                    break;
            }
            host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x144, [0]);
            host.callMethod(mem.read32(arg1 + 0x8c) | 0, 0x144, [0]);
            host.callMethod(mem.read32(arg1 + 0xa0) | 0, 0x144, [0]);
            host.callMethod(mem.read32(arg1 + 0x9c) | 0, 0x144, [0]);
            if (count() !== 3) footer(0);
            host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x80, [0]);
            mem.write32(obj + 0x10, (count() + 0x32) | 0);
            return;
        case 0x33:
            ready(obj + 0x3cc);
            ready(obj + 0x3fc);
            ready(obj + 0x40c);
            ready(obj + 0x42c);
            if (ready(obj + 0x41c) !== 0) mem.write32(obj + 0x0c, 3);
            return;
        case 0x34:
            ready(obj + 0x3dc);
            ready(obj + 0x40c);
            ready(obj + 0x42c);
            if (ready(obj + 0x41c) !== 0) {
                act(obj + 0x3cc, 0);
                act(obj + 0x3fc, 0);
                host.callMethod(mem.read32(arg1) | 0, 0x144, [0]);
                host.rowFill(obj, arg1, 0, 0);
                mem.write32(obj + 0x10, 0x36);
                return;
            }
            return;
        case 0x35:
            ready(obj + 0x3ec);
            ready(obj + 0x40c);
            if (ready(obj + 0x42c) !== 0) {
                act(obj + 0x3dc, 0);
                act(obj + 0x41c, 0);
                host.rowFill(obj, arg1, 1, 0);
                footer(0);
                mem.write32(obj + 0x10, 0x37);
                return;
            }
            return;
        case 0x36:
            ready(obj + 0x3dc);
            if (ready(obj + 0x40c) !== 0) mem.write32(obj + 0x0c, 3);
            return;
        case 0x37:
            ready(obj + 0x3dc);
            if (ready(obj + 0x41c) !== 0) {
                act(obj + 0x3cc, 0);
                act(obj + 0x3fc, 0);
                host.callMethod(mem.read32(arg1) | 0, 0x144, [0]);
                host.rowFill(obj, arg1, 0, 0);
                advance();
                return;
            }
            return;
        case 0x38:
            ready(obj + 0x3cc);
            if (ready(obj + 0x3fc) !== 0) mem.write32(obj + 0x0c, 3);
            return;
        case 0x64:
            mem.write32(obj + 0x3b4, 0);
            host.widgetReady(obj + 0x3fc);
            if (host.animActive(obj) !== 0) {
                advance();
                return;
            }
            return;
        case 0x65:
            if (pressedOnly(0x0d)) {
                host.playSound(PAUSE_ITEMS_TICK_CONFIRM_SOUND);
                const record = mem.read32(PAUSE_ITEMS_TICK_ABILITY_TABLE + (mem.read32(obj + 0x70) | 0) * 4) | 0;
                const result = host.ability(record, obj + 0x84) | 0;
                mem.write32(obj + 0x3ac, result);
                if (result <= 0) {
                    host.callMethod(obj, 0x3c, []);
                    act(obj + 0x3fc, 1);
                    act(obj + 0x42c, 1);
                    act(obj + 0x41c, 1);
                    mem.write32(obj + 0x3c0, 0);
                    return;
                }
                mem.write32(obj + 0x10, 0x1b);
                mem.write32(obj + 0x3c0, 0);
                return;
            }
            return;
        case 0x66:
            ready(obj + 0x3fc);
            ready(obj + 0x42c);
            if (ready(obj + 0x41c) !== 0) {
                host.callMethod(mem.read32(arg1) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), 0x14]);
                footer(1);
                bitBox(1);
                host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), ((mem.read32(obj + 0x70) | 0) + 0x1b) | 0]);
                host.callMethod(mem.read32(arg1 + 0x8c) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), 0x15]);
                host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x80, [1]);
                mem.write32(obj + 0x10, 0x0a);
                return;
            }
            return;
        case 0x6e:
            host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x94, [1]);
            host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x88, [7]);
            host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), ((mem.read32(obj + 0x70) | 0) + 0x64) | 0]);
            advance();
            return;
        case 0x6f:
            if (pressedOnly(0x0e)) {
                host.playSound(PAUSE_ITEMS_TICK_CANCEL_SOUND);
                host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x94, [0]);
                host.callMethod(mem.read32(arg1 + 0xb8) | 0, 0x88, [0]);
                host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x114, [host.resourceBase((lang() + 0xb0) | 0), ((mem.read32(obj + 0x70) | 0) + 0x1b) | 0]);
                mem.write32(obj + 0x10, 0x0a);
                return;
            }
            return;
        default: {
            const cnt = count();
            if (cnt !== 1 && cnt > 0) {
                if (cnt >= 4) {
                    act(obj + 0x3cc, 1);
                    act(obj + 0x3fc, 1);
                    if ((mem.read32(obj + 0x14) | 0) === 0) act(obj + 0x40c, 1);
                    act(obj + 0x42c, 1);
                    act(obj + 0x41c, 1);
                } else {
                    act(obj + 0x3cc, 1);
                    act(obj + 0x3fc, 1);
                }
            } else {
                act(obj + 0x3cc, 1);
                act(obj + 0x3fc, 1);
                if ((mem.read32(obj + 0x14) | 0) === 0) act(obj + 0x40c, 1);
                act(obj + 0x42c, 1);
                act(obj + 0x41c, 1);
            }
            mem.write32(obj + 0x10, cnt);
            return;
        }
    }
}
