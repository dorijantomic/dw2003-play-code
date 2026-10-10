// The card shop screen's root tick, translated bit-exactly from the original
// pro/stcrdshp F0x8008838C body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/card-shop-tick.test.js runs the original through
// engine/native and compares the ordered boundary calls, the field writes and
// the fold sub-object calls.
//
// The tick is the shop's selection state machine (state = obj+0x10):
//   default     start the +0x398 fold (open) and advance.
//   1           when the +0x398 fold finishes, fill the widgets, start the
//               +0x3A8 fold (open) and advance.
//   2           when the +0x3A8 fold finishes, clear the widgets, set the level
//               widget's text/position and show it, then advance.
//   3           left/right (key 4/6, with auto-repeat) move obj+0x6C in 0..2 and
//               play 0x8004513E on a change; confirm (0xD) plays 0x8004503C and
//               goes to 0xA; cancel (0xE) plays 0x800450BD and calls +0x2C(obj,0x32).
//   0xA         obj+0x14 = 1; cursor 0 -> selectDefault; 1 -> walk the +0x70 list
//               for 0x62 and selectCard; 2 -> go to 0x64 and set obj+0x68.
//   0xB         when ctx+0x24 is clear, return to state 1.
//   0x14        hide then show the level widget at layer 7, start the +0x3B8
//               fold (open) and advance.
//   0x15        when the +0x3B8 fold finishes, set the shop-name widget line.
//   0x16        confirm plays 0x4001C, clears the shop-name widget and starts
//               the +0x3B8 fold (close).
//   0x17        when the +0x3B8 fold finishes, hide the level widget and go to 3.
//   0x32        build the popup when obj+0x14 is clear, clear the widgets, start
//               the +0x3A8 fold (close) and advance.
//   0x33        when the +0x3A8 fold finishes, either fill/close or go to 0xB.
//   0x34        when the +0x398 fold finishes, go to 0x65.
//   0x64        build the popup for the closing animation.
//   0x65        when the popup's +0x0C is 2, set the screen's +0x0C to 3.
//
// The fold pair (F0x80088FB4/F0x80089048) is already translated in
// engine/dw3/ui/window-fold.ts; here it is a host boundary so this tick's oracle
// covers the state machine alone. The input service, the [0x80042B98] list
// service, the widget constructors/selectors, the widget methods, the base
// +0x2C and the SFX are host boundaries; the port preserves the exact call
// sequence, including the short-circuit pad reads. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts
// barrel and data/translated_functions.json.

import { SHOP_SAVE_PTR_CELL } from "./card-shop-screen.ts";

/** Screen fields the tick reads/writes. */
export const SHOP_TICK_FIELDS = {
    mode: 0x0c,
    state: 0x10,
    flag14: 0x14,
    method2C: 0x2c,
    menuValue: 0x60,
    flag68: 0x68,
    cursor: 0x6c,
    list: 0x70,
    foldA: 0x398,
    foldB: 0x3a8,
    foldC: 0x3b8,
} as const;

export interface ShopTickMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ShopTickHost {
    /** obj+0x2C(obj, value) — the base set-sub-state method. */
    baseMethod2C(obj: number, value: number): void;
    /** F0x80087E8C(obj, ctx, flag): fill the screen's widgets. */
    fillWidgets(obj: number, ctx: number, flag: number): void;
    /** F0x80087FAC(obj, ctx, flag): clear the screen's widgets. */
    clearWidgets(obj: number, ctx: number, flag: number): void;
    /** F0x80087B84(obj, value): select the default entry, returns the choice. */
    selectDefault(obj: number, value: number): number;
    /** F0x8008536C(obj): select the matched card, returns the choice. */
    selectCard(obj: number): number;
    /** F0x80085634(): build a popup widget, returns it. */
    makePopup(): number;
    /** [0x80044F4C](id): the resident resource handle getter. */
    resourceGet(id: number): number;
    /** [0x80042B98]+0x0C(tag, ptr): the list length. */
    listCount(tag: number, ptr: number): number;
    /** [0x80042B98]+0x04(value): test one list entry. */
    listItem(value: number): number;
    /** [0x8004B7D0]+0x3F4(port): the pad word pressed this frame. */
    padPressed(port: number): number;
    /** [0x8004B7D0]+0x3FC(port): the pad word auto-repeat pulses. */
    padRepeat(port: number): number;
    /** [0x8004B7D0]+0x408(port, code): the keymap bit for a button. */
    padKey(port: number, code: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8008CB88](sub, direction): start the window-fold tween. */
    foldStart(sub: number, direction: number): void;
    /** [0x8008CB8C](sub): advance the tween, nonzero while still running. */
    foldTick(sub: number): number;
    /** level widget +0x84(w, x, y). */
    widget84(widget: number, x: number, y: number): void;
    /** level widget +0x80(widget, value). */
    widget80(widget: number, value: number): void;
    /** level widget +0x94(widget, value). */
    widget94(widget: number, value: number): void;
    /** level widget +0x88(widget, value). */
    widget88(widget: number, value: number): void;
    /** shop-name widget +0x114(widget, source, index). */
    widget114(widget: number, source: number, index: number): void;
    /** shop-name widget +0x144(widget, value). */
    widget144(widget: number, value: number): void;
    /** popup widget +0x64(widget, a, b). */
    widget64(widget: number, a: number, b: number): void;
}

function advance(mem: ShopTickMemory, obj: number): void {
    mem.write32(obj + SHOP_TICK_FIELDS.state, ((mem.read32(obj + SHOP_TICK_FIELDS.state) | 0) + 1) | 0);
}

function s16(v: number): number {
    return (v << 16) >> 16;
}

/** (pressed >> key(code)) & 1, with the original's short-circuit and call order. */
function padBitRepeat(host: ShopTickHost, code: number): boolean {
    const pressed = host.padPressed(0) | 0;
    if (((pressed >> host.padKey(0, code)) & 1) !== 0) return true;
    const repeat = host.padRepeat(0) | 0;
    return ((repeat >> host.padKey(0, code)) & 1) !== 0;
}

/** (pressed >> key(code)) & 1 for the confirm/cancel reads. */
function padBit(host: ShopTickHost, code: number): boolean {
    const pressed = host.padPressed(0) | 0;
    return ((pressed >> host.padKey(0, code)) & 1) !== 0;
}

/** F0x8008838C(obj, ctx): the card shop screen's root tick. */
export function shopRootTick(
    mem: ShopTickMemory,
    obj: number,
    ctx: number,
    host: ShopTickHost,
): void {
    const state = mem.read32(obj + SHOP_TICK_FIELDS.state) | 0;

    switch (state) {
        case 0x1:
            if ((host.foldTick(obj + SHOP_TICK_FIELDS.foldA) | 0) !== 0) {
                host.fillWidgets(obj, ctx, 1);
                host.foldStart(obj + SHOP_TICK_FIELDS.foldB, 1);
                advance(mem, obj);
            }
            return;

        case 0x2:
            if ((host.foldTick(obj + SHOP_TICK_FIELDS.foldB) | 0) !== 0) {
                host.clearWidgets(obj, ctx, 1);
                const widget = mem.read32(ctx + 0x20) >>> 0;
                host.widget84(widget, 0x9a, Math.imul(mem.read32(obj + SHOP_TICK_FIELDS.cursor) | 0, 0xe) + 0x35);
                host.widget80(widget, 1);
                advance(mem, obj);
            }
            return;

        case 0x3: {
            const before = mem.read32(obj + SHOP_TICK_FIELDS.cursor) | 0;
            if (padBitRepeat(host, 4)) {
                const next = before - 1;
                mem.write32(obj + SHOP_TICK_FIELDS.cursor, next < 0 ? 0 : next);
            } else if (padBitRepeat(host, 6)) {
                const next = before + 1;
                mem.write32(obj + SHOP_TICK_FIELDS.cursor, next >= 3 ? 2 : next);
            }
            if (before !== (mem.read32(obj + SHOP_TICK_FIELDS.cursor) | 0)) {
                host.playSound(0x8004513e);
                host.widget84(
                    mem.read32(ctx + 0x20) >>> 0,
                    0x9a,
                    Math.imul(mem.read32(obj + SHOP_TICK_FIELDS.cursor) | 0, 0xe) + 0x35,
                );
            }
            if (padBit(host, 0xd)) {
                host.playSound(0x8004503c);
                mem.write32(obj + SHOP_TICK_FIELDS.state, 0xa);
                return;
            }
            if (padBit(host, 0xe)) {
                host.playSound(0x800450bd);
                host.baseMethod2C(obj, 0x32);
                return;
            }
            return;
        }

        case 0xa: {
            mem.write32(obj + SHOP_TICK_FIELDS.flag14, 1);
            const cursor = mem.read32(obj + SHOP_TICK_FIELDS.cursor) | 0;
            if (cursor === 1) {
                const count = host.listCount(1, obj + SHOP_TICK_FIELDS.list) | 0;
                if (count > 0) {
                    for (let n = 1; n <= count; n++) {
                        const value = s16(mem.read16(obj + SHOP_TICK_FIELDS.list + (n - 1) * 2));
                        if ((host.listItem(value) | 0) === 0x62) {
                            mem.write32(ctx + 0x24, host.selectCard(obj));
                            mem.write32(obj + SHOP_TICK_FIELDS.state, 0x32);
                            break;
                        }
                    }
                }
                if ((mem.read32(ctx + 0x24) | 0) === 0) {
                    host.baseMethod2C(obj, 0x14);
                    return;
                }
                return;
            }
            if (cursor === 2) {
                mem.write32(obj + SHOP_TICK_FIELDS.state, 0x64);
                mem.write32(obj + SHOP_TICK_FIELDS.flag68, 1);
                return;
            }
            mem.write32(ctx + 0x24, host.selectDefault(obj, mem.read32(obj + SHOP_TICK_FIELDS.menuValue) | 0));
            mem.write32(obj + SHOP_TICK_FIELDS.state, 0x32);
            return;
        }

        case 0xb:
            if ((mem.read32(ctx + 0x24) | 0) === 0) {
                mem.write32(obj + SHOP_TICK_FIELDS.state, 1);
            }
            return;

        case 0x14: {
            const widget = mem.read32(ctx + 0x20) >>> 0;
            host.widget94(widget, 1);
            host.widget88(widget, 7);
            host.foldStart(obj + SHOP_TICK_FIELDS.foldC, 1);
            advance(mem, obj);
            return;
        }

        case 0x15:
            if ((host.foldTick(obj + SHOP_TICK_FIELDS.foldC) | 0) !== 0) {
                const handle = host.resourceGet((mem.read32(SHOP_SAVE_PTR_CELL) | 0) + 0x32);
                host.widget114(mem.read32(ctx + 0x8) >>> 0, handle, 0x15);
                advance(mem, obj);
            }
            return;

        case 0x16:
            if (padBit(host, 0xd)) {
                host.playSound(0x4001c);
                host.widget144(mem.read32(ctx + 0x8) >>> 0, 0);
                host.foldStart(obj + SHOP_TICK_FIELDS.foldC, 0);
                advance(mem, obj);
            }
            return;

        case 0x17:
            if ((host.foldTick(obj + SHOP_TICK_FIELDS.foldC) | 0) !== 0) {
                const widget = mem.read32(ctx + 0x20) >>> 0;
                host.widget94(widget, 0);
                host.widget88(widget, 0);
                mem.write32(obj + SHOP_TICK_FIELDS.state, 3);
            }
            return;

        case 0x32:
            if ((mem.read32(obj + SHOP_TICK_FIELDS.flag14) | 0) === 0) {
                const popup = host.makePopup() >>> 0;
                mem.write32(ctx + 0x28, popup);
                host.widget64(popup, 0, 0x1e);
                mem.write32(popup + 0x54, 6);
            }
            host.clearWidgets(obj, ctx, 0);
            host.widget80(mem.read32(ctx + 0x20) >>> 0, 0);
            host.foldStart(obj + SHOP_TICK_FIELDS.foldB, 0);
            advance(mem, obj);
            return;

        case 0x33:
            if ((host.foldTick(obj + SHOP_TICK_FIELDS.foldB) | 0) !== 0) {
                if ((mem.read32(obj + SHOP_TICK_FIELDS.flag14) | 0) === 0) {
                    host.fillWidgets(obj, ctx, 0);
                    host.foldStart(obj + SHOP_TICK_FIELDS.foldA, 0);
                    advance(mem, obj);
                } else {
                    mem.write32(obj + SHOP_TICK_FIELDS.state, 0xb);
                }
            }
            return;

        case 0x34:
            if ((host.foldTick(obj + SHOP_TICK_FIELDS.foldA) | 0) !== 0) {
                mem.write32(obj + SHOP_TICK_FIELDS.state, 0x65);
            }
            return;

        case 0x64: {
            const popup = host.makePopup() >>> 0;
            mem.write32(ctx + 0x28, popup);
            host.widget64(popup, 0, 0xa);
            advance(mem, obj);
            return;
        }

        case 0x65:
            if ((mem.read32(mem.read32(ctx + 0x28) + 0xc) | 0) === 2) {
                mem.write32(obj + SHOP_TICK_FIELDS.mode, 3);
            }
            return;

        default:
            host.foldStart(obj + SHOP_TICK_FIELDS.foldA, 1);
            advance(mem, obj);
            return;
    }
}
