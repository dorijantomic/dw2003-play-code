// The BUY actor's cards/Effects window state machine, translated from
// pro/stitshop F0x8008A758.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-window-buy-oracle.test.js runs the original through
// engine/native (the real fold steppers via their table cells plus recording
// stubs for the four callees) and the port through the same recorders, comparing
// the ordered call stream and every touched band/child field.
//
// DECODED: exe-decomp/stitshop_c/F0x8008a758.c read as a goto graph and
// cross-checked against exe-decomp/stitshop_c/_asm/F0x8008a758.s and the
// accepted buysell-window-family answer U1 (state table). The four child records
// at band+0x1F4/+0x204/+0x214/+0x224 are window-fold states {duration, delta,
// value, active}, driven by the already-translated windowFoldStart/windowFoldTick.
//
//   state = band+0x10; hasEffects = band+0x1EC; toggle = band+0x5C
//   states 4..0x31 and 0x34.. are the default arm unless named below.
//   state 3 and 7 do nothing. The machine hands back with band+0xC = 3 in
//   states 0x33 (all folds settled) and via 0x3E8/0xC/0x10 (3, +0x1F0 = 1).
//
// The four fills (F0x80089E2C/F0x8008A0D0/F0x8008A1FC), the prompt widget line
// (slot +0x114) and its show/hide flag (+0x144) are host boundaries; the string
// source is the [0x80044F4C] resolver.

import { windowFoldStart, windowFoldTick } from "./window-fold.ts";

export interface ShopWindowMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopWindowBuyHost {
    /** F0x80089E2C(band, block, flag): name/price row fill/clear. */
    call89e2c(band: number, block: number, flag: number): void;
    /** F0x8008A0D0(band, block, flag): description row fill/clear. */
    call8a0d0(band: number, block: number, flag: number): void;
    /** F0x8008A1FC(band, block, flag): per-member Effects cards fill/clear. */
    call8a1fc(band: number, block: number, flag: number): void;
    /** [0x80044F4C](*(0x8005CCA8) + 0x71): the prompt string-bank base. */
    textSource(): number;
    /** The prompt widget's +0x114 (F0x800194E8): set line 0 from a bank index. */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** The prompt widget's +0x144 (F0x8001A23C): show/hide flag. */
    widgetSetFlagC1(widget: number, flag: number): void;
}

export const SHOP_WINDOW_FIELDS = {
    subState: 0x10,
    handlerState: 0x0c,
    toggle: 0x5c,
    childMain: 0x1f4,
    childA: 0x204,
    childB: 0x214,
    childC: 0x224,
    hasEffects: 0x1ec,
    enable: 0x1f0,
    promptWidget: 0xa8,
} as const;

const HANDLER_READY = 3;
const PROMPT_STRING_BASE = 0x0a;

/** F0x8008A758(band, block): advance the BUY cards/Effects window machine. */
export function shopWindowBuyTick(
    mem: ShopWindowMemory,
    band: number,
    block: number,
    host: ShopWindowBuyHost,
): void {
    const state = mem.read32(band + SHOP_WINDOW_FIELDS.subState) | 0;
    const hasEffects = () => (mem.read32(band + SHOP_WINDOW_FIELDS.hasEffects) | 0) !== 0;
    const toggle = () => mem.read32(band + SHOP_WINDOW_FIELDS.toggle) | 0;
    const prompt = () => mem.read32(block + SHOP_WINDOW_FIELDS.promptWidget) >>> 0;
    const setLine = () => host.widgetSetLine0(prompt(), host.textSource(), toggle() + PROMPT_STRING_BASE);
    const setFlag = (v: number) => host.widgetSetFlagC1(prompt(), v);
    const step = (child: number) => windowFoldTick(mem, child) | 0;
    const start = (child: number, dir: number) => windowFoldStart(mem, child, dir);
    const bump = () =>
        mem.write32(band + SHOP_WINDOW_FIELDS.subState, ((mem.read32(band + SHOP_WINDOW_FIELDS.subState) | 0) + 1) >>> 0);

    switch (state) {
        case 1:
            if (hasEffects()) step(band + SHOP_WINDOW_FIELDS.childA);
            if (step(band + SHOP_WINDOW_FIELDS.childMain) !== 0) {
                host.call89e2c(band, block, 1);
                if (hasEffects()) setLine();
                start(band + SHOP_WINDOW_FIELDS.childB, 1);
                bump();
            }
            return;
        case 2:
            if (step(band + SHOP_WINDOW_FIELDS.childB) !== 0) {
                host.call8a0d0(band, block, 1);
                bump();
            }
            return;
        case 3:
            return;
        case 4:
            mem.write32(band + SHOP_WINDOW_FIELDS.enable, 0);
            setFlag(0);
            start(band + SHOP_WINDOW_FIELDS.childA, 0);
            if (toggle() === 0) {
                start(band + SHOP_WINDOW_FIELDS.childB, 0);
                host.call8a0d0(band, block, 0);
            }
            bump();
            return;
        case 5:
            step(band + SHOP_WINDOW_FIELDS.childB);
            if (step(band + SHOP_WINDOW_FIELDS.childA) !== 0) {
                if (toggle() === 0) start(band + SHOP_WINDOW_FIELDS.childC, 1);
                bump();
            }
            return;
        case 6:
            if (step(band + SHOP_WINDOW_FIELDS.childC) !== 0) {
                host.call8a1fc(band, block, 1);
                bump();
            }
            return;
        case 7:
            return;
        case 8:
            if (toggle() === 0) {
                host.call8a1fc(band, block, 0);
                start(band + SHOP_WINDOW_FIELDS.childC, 0);
            }
            start(band + SHOP_WINDOW_FIELDS.childA, 1);
            bump();
            return;
        case 9:
            step(band + SHOP_WINDOW_FIELDS.childC);
            if (step(band + SHOP_WINDOW_FIELDS.childA) !== 0) {
                setFlag(1);
                if (toggle() === 0) start(band + SHOP_WINDOW_FIELDS.childB, 1);
                mem.write32(band + SHOP_WINDOW_FIELDS.subState, 0x3e8);
            }
            return;
        case 0x0a:
            setLine();
            if (toggle() === 0) {
                start(band + SHOP_WINDOW_FIELDS.childC, 0);
                host.call8a1fc(band, block, 0);
                mem.write32(band + SHOP_WINDOW_FIELDS.subState, 0x0f);
            } else {
                start(band + SHOP_WINDOW_FIELDS.childB, 0);
                host.call8a0d0(band, block, 0);
                mem.write32(band + SHOP_WINDOW_FIELDS.subState, 0x0b);
            }
            return;
        case 0x0b:
            if (step(band + SHOP_WINDOW_FIELDS.childB) !== 0) {
                start(band + SHOP_WINDOW_FIELDS.childC, 1);
                bump();
            }
            return;
        case 0x0c:
            if (step(band + SHOP_WINDOW_FIELDS.childC) !== 0) {
                host.call8a1fc(band, block, 1);
                mem.write32(band + SHOP_WINDOW_FIELDS.subState, HANDLER_READY);
                mem.write32(band + SHOP_WINDOW_FIELDS.enable, 1);
            }
            return;
        case 0x0f:
            if (step(band + SHOP_WINDOW_FIELDS.childC) !== 0) {
                start(band + SHOP_WINDOW_FIELDS.childB, 1);
                bump();
            }
            return;
        case 0x10:
            if (step(band + SHOP_WINDOW_FIELDS.childB) !== 0) {
                host.call8a0d0(band, block, 1);
                mem.write32(band + SHOP_WINDOW_FIELDS.subState, HANDLER_READY);
                mem.write32(band + SHOP_WINDOW_FIELDS.enable, 1);
            }
            return;
        case 0x32:
            host.call89e2c(band, block, 0);
            setFlag(0);
            start(band + SHOP_WINDOW_FIELDS.childMain, 0);
            if (hasEffects()) start(band + SHOP_WINDOW_FIELDS.childA, 0);
            if (toggle() === 0) {
                host.call8a0d0(band, block, 0);
                start(band + SHOP_WINDOW_FIELDS.childB, 0);
            } else {
                host.call8a1fc(band, block, 0);
                start(band + SHOP_WINDOW_FIELDS.childC, 0);
            }
            bump();
            return;
        case 0x33:
            step(toggle() === 0 ? band + SHOP_WINDOW_FIELDS.childB : band + SHOP_WINDOW_FIELDS.childC);
            if (hasEffects()) step(band + SHOP_WINDOW_FIELDS.childA);
            if (step(band + SHOP_WINDOW_FIELDS.childMain) !== 0) {
                mem.write32(band + SHOP_WINDOW_FIELDS.handlerState, HANDLER_READY);
            }
            return;
        case 0x3e8:
            if (step(band + SHOP_WINDOW_FIELDS.childB) !== 0) {
                if (toggle() !== 0) {
                    mem.write32(band + SHOP_WINDOW_FIELDS.subState, HANDLER_READY);
                    mem.write32(band + SHOP_WINDOW_FIELDS.enable, 1);
                } else {
                    host.call8a0d0(band, block, 1);
                    mem.write32(band + SHOP_WINDOW_FIELDS.subState, HANDLER_READY);
                    mem.write32(band + SHOP_WINDOW_FIELDS.enable, 1);
                }
            }
            return;
        default:
            // States 0, 4..0x31 except the named ones, and >= 0x34 except 0x3E8.
            start(band + SHOP_WINDOW_FIELDS.childMain, 1);
            if (hasEffects()) start(band + SHOP_WINDOW_FIELDS.childA, 1);
            bump();
            return;
    }
}
