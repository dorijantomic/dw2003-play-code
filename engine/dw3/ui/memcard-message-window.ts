// The memory-card screen's message/confirm window, translated from
// pro/stgmcard F0x80087798 (create), F0x80087534 (tick + widget construction)
// and F0x80087368 (draw).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/memcard-message-window-oracle.test.js runs the original
// through engine/native with the object factory, the tween start, the widget
// factory and method slots, the icon factory, the state machine and every
// draw-context method stubbed and compares the ordered calls and the fields.
//
// DECODED: exe-decomp/stgmcard_c/_asm/F0x80087798.s / F0x80087534.s /
// F0x80087368.s (authority 2) and the accepted memory-card-hud answer Family D.
// The window is built by F0x80014504 (handler 0x80087534, size 0x285C, extra
// 0x28); +0x2854 = 0x80084C70 (refresh card) and +0x2858 = 0x80084CA8
// (dismiss chrome) are installed for the state machine, +0x50 = the parent
// screen and +0x54 = 0x1000 (the draw target). The child block passed as a1
// holds +0x00/+0x14/+0x04/+0x08/+0x0C/+0x10 text widgets, +0x18 the icon and
// +0x20 the block grid.
//
// Tick order (from the raw asm):
//   state 0 or >= 4 (build): advancePhase(screen); +0x58 = 5, +0x5C = 0x59;
//     tweenStart(screen+0x2824, 0x97, 0, 0xA); create the six text widgets at
//     (kind 1):
//       [0]  (s16(+0x54), s16(u16(+0x58)+0xC8), s16(u16(+0x5C)+u16(+0x282C)+9))
//       [14] (…, s16(u16(+0x58)+0x0F), s16(u16(+0x5C)+0x18))
//       [4]  (…, s16(u16(+0x58)+0x0F), s16(u16(+0x5C)+0x28)) then +0x160(5),
//            +0x15C(1)
//       [8]  (…, s16(u16(+0x58)+0x0F), s16(u16(+0x5C)+0x67)) then +0x160(2)
//       [0C] (…, 0xCF, 0xBD)
//       [10] (…, 0xCF, 0xCB)
//     then child+0x18 = F0x8001B364(target, 0, 0xCF, 0xBD) with +0x80(0), and
//     child+0x20 = F0x800849F0(screen) (the translated block grid)
//   state 1: F0x80084DCC(screen, childBlock); then the draw
//   state 2: if +0x10 is 0 or != 1 -> child[0]+0x144(0) and +0x10 += 1; then
//     the draw
//   state 3: nothing
//
//   draw: init ctx; setLayer(+0x54, 2); setOrigin(0x140, 0); if +0x2840:
//     advance +0x2848 (0..4) when |tick - +0x2844| / 3 != 0, paletteShift,
//     cmfont clip 0x0A at (0x126,0xD0); setOrigin(0x280,0); paletteShift(0);
//     STMCRDCS clip 0x21 at (+0x58 + +0x2810, +0x5C + +0x282C); if +0x284C:
//     setLayer(+0x54, 1) and clip 0x1D at (0xBC,0xB9)

import { memcardBlockGridCreate, type MemcardBlockGridHost } from "./memcard-block-grid.ts";

export interface MemcardMessageWindowMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface MemcardMessageWindowHost {
    /** F0x80014504(handler, size, extra) -> the new child object. */
    allocMessageWindow(handler: number, size: number, extra: number): number;
}

/** The tick's boundary services. */
export interface MemcardMessageWindowTickHost extends MemcardMessageWindowHost, MemcardBlockGridHost {
    /** screen->0x38 (F0x800142AC): advance the object phase. */
    advancePhase(screen: number): void;
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** widget+0x160 (F0x8001A450): set the widget's slot state. */
    widgetSet160(widget: number, value: number): void;
    /** widget+0x15C (F0x8001A448): set the widget's line state. */
    widgetSet15C(widget: number, value: number): void;
    /** widget+0x144 (F0x8001A23C): clear/hide the widget. */
    widgetClear(widget: number, value: number): void;
    /** F0x8001B364(target, a1, x, y) -> the icon/cursor object. */
    spawnUiIcon(target: number, a1: number, x: number, y: number): number;
    /** icon+0x80 (F0x8001B04C): show/hide the cursor. */
    iconShow(icon: number, value: number): void;
    /** F0x80084DCC(screen, childBlock): the save-driver state machine. */
    stateMachine(screen: number, childBlock: number): void;
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    paletteShift(value: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8: pack handle -> directory pointer. */
    packResolve(handle: number): number;
    /** [0x8004DF98] = F0x8001D6F4: free-running frame tick. */
    frameTick(): number;
}

export const MEMCARD_WINDOW_HANDLER = 0x80087534;
export const MEMCARD_WINDOW_SIZE = 0x285c;
export const MEMCARD_WINDOW_EXTRA = 0x28;
export const MEMCARD_WINDOW_REFRESH = 0x80084c70;
export const MEMCARD_WINDOW_DISMISS = 0x80084ca8;
/** Packs: CMFONTCS and STMCRDCS. */
export const MEMCARD_WINDOW_CMFONT = 0x02860000;
export const MEMCARD_WINDOW_PACK = 0x029d0000;

/** Window fields. */
export const MEMCARD_WINDOW = {
    state: 0x0c,
    substep: 0x10,
    methodRefresh: 0x2854,
    methodDismiss: 0x2858,
    advance: 0x38,
    parent: 0x50,
    target: 0x54,
    boxX: 0x58,
    boxY: 0x5c,
    foldX: 0x2810,
    tween: 0x2824,
    foldY: 0x282c,
    blinkOn: 0x2840,
    blinkStamp: 0x2844,
    blinkFrame: 0x2848,
    drain: 0x284c,
} as const;

/** Child-block slots. */
export const MEMCARD_CHILD = {
    text0: 0x00,
    text4: 0x04,
    text8: 0x08,
    textA: 0x0c,
    text10: 0x10,
    text14: 0x14,
    icon: 0x18,
    grid: 0x20,
} as const;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;
const u16 = (v: number): number => v & 0xffff;

/** F0x80087798(parent): build the message/confirm window object. */
export function memcardMessageWindowCreate(
    mem: MemcardMessageWindowMemory,
    parent: number,
    host: MemcardMessageWindowHost,
): number {
    const win = host.allocMessageWindow(MEMCARD_WINDOW_HANDLER, MEMCARD_WINDOW_SIZE, MEMCARD_WINDOW_EXTRA) >>> 0;
    mem.write32(win + MEMCARD_WINDOW.methodRefresh, MEMCARD_WINDOW_REFRESH);
    mem.write32(win + MEMCARD_WINDOW.methodDismiss, MEMCARD_WINDOW_DISMISS);
    mem.write32(win + MEMCARD_WINDOW.parent, parent >>> 0);
    mem.write32(win + MEMCARD_WINDOW.target, 0x1000);
    return win;
}

/** F0x80087534(screen, childBlock): one message-window frame. */
export function memcardMessageWindowTick(
    mem: MemcardMessageWindowMemory,
    screen: number,
    child: number,
    host: MemcardMessageWindowTickHost,
): void {
    const state = s32(mem.read32(screen + MEMCARD_WINDOW.state));

    if (state === 1) {
        host.stateMachine(screen, child);
        memcardMessageWindowDraw(mem, screen, host);
        return;
    }
    if (state === 2) {
        const step = s32(mem.read32(screen + MEMCARD_WINDOW.substep));
        if (step === 0 || step !== 1) {
            const widget = mem.read32(child + MEMCARD_CHILD.text0) >>> 0;
            host.widgetClear(widget, 0);
            mem.write32(screen + MEMCARD_WINDOW.substep, (step + 1) >>> 0);
        }
        memcardMessageWindowDraw(mem, screen, host);
        return;
    }
    if (state !== 0 && state < 4) return;

    // build band: state 0 or >= 4
    host.advancePhase(screen);
    mem.write32(screen + MEMCARD_WINDOW.boxX, 5);
    mem.write32(screen + MEMCARD_WINDOW.boxY, 0x59);
    host.tweenStart(screen + MEMCARD_WINDOW.tween, 0x97, 0, 0x0a);

    const target = s16(mem.read16(screen + MEMCARD_WINDOW.target));
    const x = u16(mem.read16(screen + MEMCARD_WINDOW.boxX));
    const y = u16(mem.read16(screen + MEMCARD_WINDOW.boxY));
    const foldY = u16(mem.read16(screen + MEMCARD_WINDOW.foldY));

    let w = host.createTextElement(target, 1, s16(x + 0xc8), s16(y + foldY + 9)) >>> 0;
    mem.write32(child + MEMCARD_CHILD.text0, w);
    w = host.createTextElement(target, 1, s16(x + 0x0f), s16(y + 0x18)) >>> 0;
    mem.write32(child + MEMCARD_CHILD.text14, w);
    w = host.createTextElement(target, 1, s16(x + 0x0f), s16(y + 0x28)) >>> 0;
    mem.write32(child + MEMCARD_CHILD.text4, w);
    host.widgetSet160(w, 5);
    host.widgetSet15C(w, 1);
    w = host.createTextElement(target, 1, s16(x + 0x0f), s16(y + 0x67)) >>> 0;
    mem.write32(child + MEMCARD_CHILD.text8, w);
    host.widgetSet160(w, 2);
    w = host.createTextElement(target, 1, 0xcf, 0xbd) >>> 0;
    mem.write32(child + MEMCARD_CHILD.textA, w);
    w = host.createTextElement(target, 1, 0xcf, 0xcb) >>> 0;
    mem.write32(child + MEMCARD_CHILD.text10, w);

    const icon = host.spawnUiIcon(target, 0, 0xcf, 0xbd) >>> 0;
    mem.write32(child + MEMCARD_CHILD.icon, icon);
    host.iconShow(icon, 0);

    mem.write32(child + MEMCARD_CHILD.grid, memcardBlockGridCreate(mem, screen, host));
}

/** F0x80087368(screen): draw the message window. */
export function memcardMessageWindowDraw(
    mem: MemcardMessageWindowMemory,
    screen: number,
    host: MemcardMessageWindowTickHost,
): void {
    host.initDrawContext();
    host.setLayer(mem.read32(screen + MEMCARD_WINDOW.target), 2);
    host.setOrigin(0x140, 0);

    if (s32(mem.read32(screen + MEMCARD_WINDOW.blinkOn)) !== 0) {
        const first = host.frameTick();
        const delta = s32(first - s32(mem.read32(screen + MEMCARD_WINDOW.blinkStamp)));
        if (Math.trunc(delta / 3) !== 0) {
            const now = host.frameTick();
            mem.write32(screen + MEMCARD_WINDOW.blinkStamp, now >>> 0);
            let frame = (mem.read32(screen + MEMCARD_WINDOW.blinkFrame) | 0) + 1;
            mem.write32(screen + MEMCARD_WINDOW.blinkFrame, frame >>> 0);
            if (frame >= 5) mem.write32(screen + MEMCARD_WINDOW.blinkFrame, 0);
        }
        host.paletteShift(mem.read32(screen + MEMCARD_WINDOW.blinkFrame));
        host.drawSprite(host.packResolve(MEMCARD_WINDOW_CMFONT) >>> 0, 0x0a, 0x126, 0xd0);
    }

    host.setOrigin(0x280, 0);
    host.paletteShift(0);
    host.drawSprite(
        host.packResolve(MEMCARD_WINDOW_PACK) >>> 0,
        0x21,
        ((mem.read32(screen + MEMCARD_WINDOW.boxX) | 0) + (mem.read32(screen + MEMCARD_WINDOW.foldX) | 0)) >>> 0,
        ((mem.read32(screen + MEMCARD_WINDOW.boxY) | 0) + (mem.read32(screen + MEMCARD_WINDOW.foldY) | 0)) >>> 0,
    );
    if (s32(mem.read32(screen + MEMCARD_WINDOW.drain)) !== 0) {
        host.setLayer(mem.read32(screen + MEMCARD_WINDOW.target), 1);
        host.drawSprite(host.packResolve(MEMCARD_WINDOW_PACK) >>> 0, 0x1d, 0xbc, 0xb9);
    }
}
