// The SELL actor's window state machine, translated from pro/stitshop
// F0x8008ADEC.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-window-sell-oracle.test.js runs the original through
// engine/native (the real fold steppers in their table cells plus recording
// stubs for the two fills) and the port through the same recorders.
//
// DECODED: exe-decomp/stitshop_c/_asm/F0x8008adec.s and its jump table
// jtbl_D0x800830c8 (52 entries, confirmed from the shipped overlay: state 3
// returns, 1/2/0x32/0x33 are named, every other in-range state is the default
// arm). The SELL machine drives only the cards window (+0x1F4) and the
// description window (+0x214); there are no Effects cards and no draw-ctx call.
//
//   state 1: fold ready(+0x1F4) -> F0x80089E2C(1), open(+0x214,1), ++
//   state 2: fold ready(+0x214) -> F0x8008A0D0(1), ++
//   state 3: nothing
//   state 0x32: F0x80089E2C(0), F0x8008A0D0(0), close(+0x1F4,0),
//               close(+0x214,0), ++
//   state 0x33: step(+0x1F4), then ready(+0x214) -> band+0xC = 3
//   default (0, 4..0x31, >=0x34): open(+0x1F4,1), ++

import { windowFoldStart, windowFoldTick } from "./window-fold.ts";

export interface ShopWindowSellMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopWindowSellHost {
    /** F0x80089E2C(band, block, flag): name/price row fill/clear. */
    call89e2c(band: number, block: number, flag: number): void;
    /** F0x8008A0D0(band, block, flag): description row fill/clear. */
    call8a0d0(band: number, block: number, flag: number): void;
}

const SUB_STATE = 0x10;
const HANDLER_STATE = 0x0c;
const CHILD_MAIN = 0x1f4;
const CHILD_DESC = 0x214;
const HANDLER_READY = 3;

/** F0x8008ADEC(band, block): advance the SELL window machine. */
export function shopWindowSellTick(
    mem: ShopWindowSellMemory,
    band: number,
    block: number,
    host: ShopWindowSellHost,
): void {
    const state = mem.read32(band + SUB_STATE) | 0;
    const step = (child: number) => windowFoldTick(mem, child) | 0;
    const start = (child: number, dir: number) => windowFoldStart(mem, child, dir);
    const bump = () => mem.write32(band + SUB_STATE, ((mem.read32(band + SUB_STATE) | 0) + 1) >>> 0);

    switch (state) {
        case 1:
            if (step(band + CHILD_MAIN) !== 0) {
                host.call89e2c(band, block, 1);
                start(band + CHILD_DESC, 1);
                bump();
            }
            return;
        case 2:
            if (step(band + CHILD_DESC) !== 0) {
                host.call8a0d0(band, block, 1);
                bump();
            }
            return;
        case 3:
            return;
        case 0x32:
            host.call89e2c(band, block, 0);
            host.call8a0d0(band, block, 0);
            start(band + CHILD_MAIN, 0);
            start(band + CHILD_DESC, 0);
            bump();
            return;
        case 0x33:
            step(band + CHILD_MAIN);
            if (step(band + CHILD_DESC) !== 0) {
                mem.write32(band + HANDLER_STATE, HANDLER_READY);
            }
            return;
        default:
            start(band + CHILD_MAIN, 1);
            bump();
            return;
    }
}
