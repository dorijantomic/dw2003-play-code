// The title screen's Start/Continue menu, translated from pro/stdwtitl
// F0x80085594 (its five jump-table interiors included).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/title-menu-oracle.test.js runs the original through
// engine/native with the controller service and the sound cell stubbed, and
// compares the ordered calls, the draw intents and every touched field.
//
// DECODED: authority-2 `exe-decomp/stdwtitl_c/_asm/F0x80085594.s` (the
// function body and `jtbl_D0x80082ce8` at 0x8008564c/694/730/7c4/8f4) plus the
// accepted title-screen executed-family answers. The machine:
//
//   state0 (+0x0C) != 1..3, +0x50 gate zero  -> advance0; result = 0
//   state0 != 1..3, +0x50 gate nonzero      -> setState0(2); result = 0
//   state0 == 1 -> dispatch on state1 (+0x10 - 1), 5 entries:
//       0 (and out of range): blink the prompt; every 6th frame select = 2,
//           flag = 1 and advance1
//       1: wait for Start (bit from the pad service, shift 3), then zero the
//           timer, play 0x8004503C; regardless, the timer counts and at 0x258
//           result = 3
//       2: the Start/Continue split, 3 groups x 4 frames; on the last group
//           advance1, set +0x56, place both options at (0x4F,0xA6) and play
//           0x8004113E
//       3: the 15-frame option separation, lerping +0x5C/+0x60/+0x6C/+0x70
//           from the table at 0x80087D88 {79,154,79,174}; then advance1
//       4: 6-frame close-out, then setState0(2)
//   state0 == 2 -> dispatch on state1:
//       1: the pad-driven selection (Start bit 4, option bits 6 and 0xD)
//       2: the 3-group confirm blink; at the end result = 2 (selected) or 1
//       3: idle
//       else: reset to the option table origin and advance1
//
// Every interior falls through to the shared tail F0x800852F0, the menu draw.
// The controller service is the object at 0x8004B7D0: the menu reads the two
// button words through cells +0x3F4/+0x3FC and the per-button shift amount
// through +0x408, exactly as the original does; the host supplies that service.
// Those cell offsets are named in engine/systems/pad-block.ts.

import {
    PAD_BLOCK as TITLE_PAD_BASE,
    PAD_CELL_BUTTON_MAP as TITLE_PAD_SHIFT,
    PAD_CELL_PRESSED as TITLE_PAD_WORD,
    PAD_CELL_REPEAT as TITLE_PAD_REPEAT,
} from "../../systems/pad-block.ts";
import { titleMenuDraw, TITLE_MENU_OPTION_TABLE } from "./title-draw.ts";
import type { TitleDrawHost, TitleDrawMemory } from "./title-draw.ts";

export interface TitleMenuMemory extends TitleDrawMemory {
    read16(addr: number): number;
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The menu's own collaborators on top of the draw context. */
export interface TitleMenuHost extends TitleDrawHost {
    /** obj+0x28 (F0x80014274): set state0, zeroing +0x10/+0x14/+0x18. */
    setState0(obj: number, state: number): void;
    /** obj+0x38 (F0x800142AC): advance state0. */
    advance0(obj: number): void;
    /** obj+0x3C (F0x800142C8): advance state1, zeroing +0x14/+0x18. */
    advance1(obj: number): void;
    /** [0x80055C48] (F0x8002006C): play a packed sound id. */
    playSound(id: number): void;
    /**
     * Call the controller service object 0x8004B7D0's cell (a0 = 0, a1 = arg).
     * The menu reads TITLE_PAD_WORD / TITLE_PAD_REPEAT (the button words) and
     * TITLE_PAD_SHIFT (the per-button shift amount).
     */
    padCall(slot: number, arg: number): number;
}

export const TITLE_MENU = {
    state0: 0x0c,
    state1: 0x10,
    gate: 0x50,
    result: 0x52,
    timer: 0x54,
    marker: 0x56,
    flag: 0x58,
    counter: 0x59,
    select: 0x5a,
    x0: 0x5c,
    y0: 0x60,
    x1: 0x6c,
    y1: 0x70,
} as const;

export { TITLE_PAD_BASE, TITLE_PAD_WORD, TITLE_PAD_REPEAT, TITLE_PAD_SHIFT };

export const TITLE_MENU_START_BIT = 3;
export const TITLE_MENU_OPTION_A_BIT = 4;
export const TITLE_MENU_OPTION_B_BIT = 6;
export const TITLE_MENU_CONFIRM_BIT = 0xd;
export const TITLE_MENU_TIMEOUT = 0x258;
export const TITLE_MENU_PRESS_SOUND = 0x8004503c;
export const TITLE_MENU_MOVE_SOUND = 0x8004513e;
export const TITLE_MENU_SPLIT_SOUND = 0x8004113e;
export const TITLE_MENU_BOX = { x: 0x4f, y: 0xa6 } as const;

const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;

/**
 * MIPS `mult` high word, as engine/native/mips.ts computes it: the signed
 * 64-bit product's upper 32 bits. The lerp uses the compiler's signed
 * divide-by-15 magic (0x88888889), reproduced exactly.
 */
function multHi(a: number, b: number): number {
    const p = BigInt(a | 0) * BigInt(b | 0);
    return Number(BigInt.asIntN(32, p >> 32n));
}

function divBy15(x: number): number {
    const hi = multHi(x, -0x77777777);
    return (((hi + (x | 0)) | 0) >> 3) - ((x | 0) >> 31);
}

/** `(word >> shift) & 1` over one controller-service button. */
function padBit(host: TitleMenuHost, slot: number, arg: number): boolean {
    const word = host.padCall(slot, 0) | 0;
    const shift = host.padCall(TITLE_PAD_SHIFT, arg) | 0;
    return ((word >> (shift & 31)) & 1) !== 0;
}

/** F0x80085594(obj): one title-menu frame. */
export function titleMenuTick(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    const state0 = s32(mem.read32(obj + TITLE_MENU.state0));

    if (state0 === 1) {
        menuScript(mem, obj, host);
        return;
    }
    if (state0 === 2) {
        menuState2(mem, obj, host);
        return;
    }
    if (state0 === 3) return;

    // default / state0 outside 1..3
    if (s16(mem.read16s(obj + TITLE_MENU.gate)) === 0) {
        host.advance0(obj);
    } else {
        host.setState0(obj, 2);
    }
    mem.write16(obj + TITLE_MENU.result, 0);
}

/** state0 == 1: the five-entry jump table on state1 - 1. */
function menuScript(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    const state1 = s32(mem.read32(obj + TITLE_MENU.state1));
    if (state1 === 0) return; // 0x80085594 draws nothing here
    const index = (state1 - 1) >>> 0;
    if (index === 1) menuWaitStart(mem, obj, host);
    else if (index === 2) menuSplit(mem, obj, host);
    else if (index === 3) menuSeparate(mem, obj, host);
    else if (index === 4) menuClose(mem, obj, host);
    else menuIdle(mem, obj, host); // index 0 and anything out of range
}

/** menu[0]: blink the "Press Start" line, 6 frames per step. */
export function menuIdle(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    const t = mem.read16(obj + TITLE_MENU.timer);
    mem.write16(obj + TITLE_MENU.timer, u16(t + 1));
    if (s16(t) >= 6) {
        mem.write16(obj + TITLE_MENU.select, 2);
        mem.write16(obj + TITLE_MENU.timer, 0);
        mem.write8(obj + TITLE_MENU.flag, 1);
        host.advance1(obj);
    }
    titleMenuDraw(mem, obj, host);
}

/** menu[1]: wait for Start, with a 0x258-frame arrival timeout. */
export function menuWaitStart(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    if (padBit(host, TITLE_PAD_WORD, TITLE_MENU_START_BIT)) {
        host.advance1(obj);
        mem.write16(obj + TITLE_MENU.timer, 0);
        host.playSound(TITLE_MENU_PRESS_SOUND);
        mem.write8(obj + TITLE_MENU.counter, 0);
    }
    const t = mem.read16(obj + TITLE_MENU.timer);
    const next = u16(t + 1);
    mem.write16(obj + TITLE_MENU.timer, next);
    if (s16(next) >= TITLE_MENU_TIMEOUT) mem.write16(obj + TITLE_MENU.result, 3);
    titleMenuDraw(mem, obj, host);
}

/** menu[2]: split the prompt into Start / Continue over 3 groups of 4 frames. */
export function menuSplit(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    const t = mem.read16(obj + TITLE_MENU.timer);
    const next = u16(t + 1);
    mem.write16(obj + TITLE_MENU.timer, next);
    if ((next & 3) === 0) {
        mem.write16(obj + TITLE_MENU.timer, 0);
        const group = (mem.read8(obj + TITLE_MENU.counter) + 1) & 0xff;
        mem.write8(obj + TITLE_MENU.counter, group);
        if (group >= 3) {
            host.advance1(obj);
            mem.write16(obj + TITLE_MENU.marker, 1);
            mem.write32(obj + TITLE_MENU.x1, TITLE_MENU_BOX.x);
            mem.write32(obj + TITLE_MENU.x0, TITLE_MENU_BOX.x);
            mem.write32(obj + TITLE_MENU.y1, TITLE_MENU_BOX.y);
            mem.write32(obj + TITLE_MENU.y0, TITLE_MENU_BOX.y);
            mem.write8(obj + TITLE_MENU.counter, 0);
            mem.write8(obj + TITLE_MENU.flag, 0);
            host.playSound(TITLE_MENU_SPLIT_SOUND);
        }
    }
    titleMenuDraw(mem, obj, host);
}

/** menu[3]: the 15-frame option separation. */
export function menuSeparate(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    const table = TITLE_MENU_OPTION_TABLE;
    const t = s16(mem.read16s(obj + TITLE_MENU.timer));
    mem.write32(obj + TITLE_MENU.x0,
        (divBy15(s32(mem.read32(table) - TITLE_MENU_BOX.x) * t) + TITLE_MENU_BOX.x) >>> 0);
    mem.write32(obj + TITLE_MENU.y0,
        (divBy15(s32(mem.read32(table + 4) - TITLE_MENU_BOX.y) * t) + TITLE_MENU_BOX.y) >>> 0);
    mem.write32(obj + TITLE_MENU.x1,
        (divBy15(s32(mem.read32(table + 8) - TITLE_MENU_BOX.x) * t) + TITLE_MENU_BOX.x) >>> 0);
    const y1 = (divBy15(s32(mem.read32(table + 0x0c) - TITLE_MENU_BOX.y) * t) + TITLE_MENU_BOX.y) >>> 0;
    const next = u16(mem.read16(obj + TITLE_MENU.timer) + 1);
    mem.write16(obj + TITLE_MENU.timer, next);
    mem.write32(obj + TITLE_MENU.y1, y1);
    if (s16(next) >= 15) {
        mem.write16(obj + TITLE_MENU.timer, 0);
        host.advance1(obj);
    }
    titleMenuDraw(mem, obj, host);
}

/** menu[4]: 6-frame close-out, then state0 = 2. */
export function menuClose(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    const t = mem.read16(obj + TITLE_MENU.timer);
    const next = u16(t + 1);
    mem.write16(obj + TITLE_MENU.timer, next);
    if (s16(next) >= 6) host.setState0(obj, 2);
    titleMenuDraw(mem, obj, host);
}

/** state0 == 2: the selection machine on state1. */
function menuState2(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    const state1 = s32(mem.read32(obj + TITLE_MENU.state1));
    if (state1 === 1) {
        menuInput(mem, obj, host);
        return;
    }
    if (state1 === 2) {
        menuConfirm(mem, obj, host);
        return;
    }
    if (state1 === 3) {
        // state1 3 falls through to the shared draw tail with no field updates
        titleMenuDraw(mem, obj, host);
        return;
    }

    // default: reset both options to the table's start and advance
    mem.write16(obj + TITLE_MENU.marker, 1);
    mem.write16(obj + TITLE_MENU.select, 1);
    mem.write8(obj + TITLE_MENU.flag, 1);
    const table = TITLE_MENU_OPTION_TABLE;
    mem.write32(obj + TITLE_MENU.x0, mem.read32(table) >>> 0);
    mem.write32(obj + TITLE_MENU.y0, mem.read32(table + 4) >>> 0);
    mem.write32(obj + TITLE_MENU.x1, mem.read32(table + 8) >>> 0);
    mem.write32(obj + TITLE_MENU.y1, mem.read32(table + 0x0c) >>> 0);
    host.advance1(obj);
    titleMenuDraw(mem, obj, host);
}

/** state1 == 1: pad-driven option selection and confirm. */
export function menuInput(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    if (padBit(host, TITLE_PAD_WORD, TITLE_MENU_OPTION_A_BIT)
        || padBit(host, TITLE_PAD_REPEAT, TITLE_MENU_OPTION_A_BIT)) {
        if (s16(mem.read16s(obj + TITLE_MENU.select)) !== 0) host.playSound(TITLE_MENU_MOVE_SOUND);
        mem.write16(obj + TITLE_MENU.select, 0);
    }
    if (padBit(host, TITLE_PAD_WORD, TITLE_MENU_OPTION_B_BIT)
        || padBit(host, TITLE_PAD_REPEAT, TITLE_MENU_OPTION_B_BIT)) {
        if (s16(mem.read16s(obj + TITLE_MENU.select)) !== 1) host.playSound(TITLE_MENU_MOVE_SOUND);
        mem.write16(obj + TITLE_MENU.select, 1);
    }
    if (padBit(host, TITLE_PAD_WORD, TITLE_MENU_CONFIRM_BIT)) {
        mem.write16(obj + TITLE_MENU.timer, 0);
        host.playSound(TITLE_MENU_PRESS_SOUND);
        host.advance1(obj);
    }
    titleMenuDraw(mem, obj, host);
}

/** state1 == 2: the 3-group confirm blink; result 2 or 1 at the end. */
export function menuConfirm(mem: TitleMenuMemory, obj: number, host: TitleMenuHost): void {
    const t = mem.read16(obj + TITLE_MENU.timer);
    const next = u16(t + 1);
    mem.write16(obj + TITLE_MENU.timer, next);
    if ((next & 3) === 0) {
        mem.write16(obj + TITLE_MENU.timer, 0);
        const group = (mem.read8(obj + TITLE_MENU.counter) + 1) & 0xff;
        mem.write8(obj + TITLE_MENU.counter, group);
        if (group >= 3) {
            mem.write16(obj + TITLE_MENU.result,
                s16(mem.read16s(obj + TITLE_MENU.select)) !== 0 ? 2 : 1);
            host.advance1(obj);
            mem.write8(obj + TITLE_MENU.counter, 0);
        }
    }
    titleMenuDraw(mem, obj, host);
}
