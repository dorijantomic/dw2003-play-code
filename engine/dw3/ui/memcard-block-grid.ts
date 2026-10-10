// The memory-card screen's block grid / slot chooser, translated from
// pro/stgmcard F0x800849F0 (create), F0x80084328 (reset), F0x80084240
// (place cursor) and F0x800843D8 (tick + draw).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/memcard-block-grid-oracle.test.js runs the original through
// engine/native with the object factory, the 8.8 tween pair, the pad service,
// the message-window refresh, the widget factory and every draw-context
// method stubbed and compares the ordered calls and the object fields.
//
// DECODED: exe-decomp/stgmcard_c/_asm/F0x800849f0.s / F0x80084328.s /
// F0x80084240.s / F0x800843d8.s (authority 2) and the accepted
// memory-card-hud answer Family C. The grid object is built by F0x80014504
// (handler 0x800843D8, size 0xF4, extra 4). Its six method slots are
// +0xDC reset 0x80084328, +0xE0 0x8008410C, +0xE4 0x80084194,
// +0xE8 0x800841FC, +0xEC 0x800842A0, +0xF0 0x800842E4; +0x54 = 0x1000,
// +0x58 = 2, +0x50 = the parent screen. The shared module block 0x80088768
// holds the selected index at +0x04, the previous index at +0x08 and the
// 8.8 tween start at +0x30.
//
// Tick order:
//   state 0 or >= 4: advance the phase, reset the grid, then (once) create the
//     label widget at *a1 with kind 1, x 0x15 and y s16(u16(screen+0x80)+0x18),
//     set its line from resourceGetBase(lang+0x78) index 3, its number to
//     (parent+0x64 + 1) and clear it; no draw
//   state 2 or 3: nothing
//   state 1: an 8-way sub-state switch; every arm ends in the draw tail:
//     0 -> draw only
//     1 -> if tweenTick(screen+0x78): substate 0, +0xCC = 1
//     2 -> if tweenTick(screen+0x5C): substate 0, +0xCC = 2
//     3 -> if tweenTick(screen+0x5C): substate 0, +0xCC = 3
//     4 -> if tweenTick(screen+0x78): reset(screen)
//     5 -> if tweenTick(screen+0x94): placeCursor(screen)
//     6 -> the pad: left = pressed|repeat bit 7, right = bit 5; move the shared
//          index clamped to 0..2; on an index change refreshCard(parent),
//          placeCursor(screen) and play 0x4001B
//     7 -> if tweenTick(screen+0xB0): substate 6
//   draw tail: init ctx, setLayer(+0x54,+0x58), setOrigin(0x280,0); every >=3
//     ticks ping-pong +0xD4 0..0xA with +0xD8 as direction; paletteShift(+0xD4);
//     clip 0x23 at (+0x9C + +0xB8 + 0x30, +0x80 + 0x12); paletteShift(0);
//     clip 0x20 at (0, +0x80 + 0x10); widget +0x134(0x15, s16(+0x80+0x18));
//     per slot i<3 with parent[i*0x44+0x74] != 0 the nameplate table
//     0x800882E4[parent[i*0x44+0xA4]-3] at (0x80088304[i] + +0x64, 0x23);
//     clip 0x22 at (+0x64 + 0x62, 0x20)

export interface MemcardBlockGridMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface MemcardBlockGridHost {
    /** F0x80014504(handler, size, extra) -> the new child object. */
    allocGrid(handler: number, size: number, extra: number): number;
    /** block+0x30 (F0x80087FDC): start the 4-word 8.8 tween. */
    tweenStart(obj: number, from: number, to: number, steps: number): void;
}

export interface MemcardBlockGridTickHost extends MemcardBlockGridHost {
    /** screen->0x38 (F0x800142AC): advance the object phase. */
    advancePhase(screen: number): void;
    /** block+0x34 (F0x8008801C): step the 8.8 tween; nonzero when landed. */
    tweenTick(obj: number): number;
    /** [0x80044F4C] = F0x80013E5C: text bank id -> RAM base. */
    resourceGetBase(id: number): number;
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** widget+0x114 (F0x800194E8): set the line from a source. */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** widget+0x118 (F0x800195B0): set a numeric line. */
    widgetSetNumber(widget: number, a1: number, value: number): void;
    /** widget+0x144 (F0x8001A23C): clear/hide. */
    widgetClear(widget: number, value: number): void;
    /** widget+0x134 (F0x8001A1E8): set position. */
    widgetSetPosition(widget: number, x: number, y: number): void;
    /** parent->0x2854 (F0x80084C70): refresh the highlighted block's card. */
    refreshCard(parent: number): void;
    /** [0x80055C48] = F0x8002006C: play a packed sound. */
    playSound(id: number): void;
    /** [0x8004B7D0+0x3F4] = F0x80018854: pressed this frame. */
    padPressed(port: number): number;
    /** [0x8004B7D0+0x3FC] = F0x8001889C: auto-repeat pulses. */
    padRepeat(port: number): number;
    /** [0x8004B7D0+0x408] = F0x80018980: logical -> physical bit map. */
    padBit(port: number, logical: number): number;
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    paletteShift(value: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8: pack handle -> directory pointer. */
    packResolve(handle: number): number;
    /** [0x8004DF98] = F0x8001D6F4: free-running frame tick. */
    frameTick(): number;
    /** [0x8005CCA8]: the language index. */
    languageIndex(): number;
}

export const MEMCARD_GRID_HANDLER = 0x800843d8;
export const MEMCARD_GRID_SIZE = 0xf4;
export const MEMCARD_GRID_EXTRA = 4;
export const MEMCARD_GRID_RESET = 0x80084328;
export const MEMCARD_GRID_STEP = 0x8008410c;
export const MEMCARD_GRID_SETDIR = 0x80084194;
export const MEMCARD_GRID_AWAIT = 0x800841fc;
export const MEMCARD_GRID_APPLY = 0x800842a0;
export const MEMCARD_GRID_CANCEL = 0x800842e4;
export const MEMCARD_GRID_PLACE = 0x80084240;

/** The module block shared with the state machine. */
export const MEMCARD_SHARED = 0x80088768;
/** Shared block: selected index, previous index, 8.8 tween start. */
export const MEMCARD_SHARED_INDEX = 0x4;
export const MEMCARD_SHARED_PREVIOUS = 0x8;
export const MEMCARD_SHARED_TWEEN_START = 0x30;

/** The card pack (STMCRDCS) and the slot-name label pack resource. */
export const MEMCARD_GRID_PACK = 0x029d0000;
/** Text resource the label widget's line comes from: resourceGetBase(lang+0x78). */
export const MEMCARD_LABEL_RESOURCE = 0x78;
/** The nameplate clip table and the per-slot x positions. */
export const MEMCARD_NAMEPLATE_TABLE = 0x800882e4;
export const MEMCARD_XPOS_TABLE = 0x80088304;
/** The move sound and the CLUT ping-pong bounds. */
export const MEMCARD_MOVE_SOUND = 0x4001b;
export const MEMCARD_CLUT_MAX = 0x0a;
export const MEMCARD_CLUT_PERIOD = 3;

/** Grid object fields. */
export const MEMCARD_GRID = {
    state: 0x0c,
    substate: 0x10,
    methodReset: 0xdc,
    methodStep: 0xe0,
    methodSetDir: 0xe4,
    methodAwait: 0xe8,
    methodApply: 0xec,
    methodCancel: 0xf0,
    advance: 0x38,
    parent: 0x50,
    target: 0x54,
    bucket: 0x58,
    scrollY: 0x80,
    scrollX: 0x9c,
    cursorX: 0xb8,
    result: 0xcc,
    stamp: 0xd0,
    clutFrame: 0xd4,
    clutDir: 0xd8,
} as const;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;
const u16 = (v: number): number => v & 0xffff;

/** F0x800849F0(parent): build the block-grid child object. */
export function memcardBlockGridCreate(
    mem: MemcardBlockGridMemory,
    parent: number,
    host: MemcardBlockGridHost,
): number {
    const grid = host.allocGrid(MEMCARD_GRID_HANDLER, MEMCARD_GRID_SIZE, MEMCARD_GRID_EXTRA) >>> 0;
    mem.write32(grid + MEMCARD_GRID.methodReset, MEMCARD_GRID_RESET);
    mem.write32(grid + MEMCARD_GRID.methodStep, MEMCARD_GRID_STEP);
    mem.write32(grid + MEMCARD_GRID.methodSetDir, MEMCARD_GRID_SETDIR);
    mem.write32(grid + MEMCARD_GRID.methodAwait, MEMCARD_GRID_AWAIT);
    mem.write32(grid + MEMCARD_GRID.methodApply, MEMCARD_GRID_APPLY);
    mem.write32(grid + MEMCARD_GRID.methodCancel, MEMCARD_GRID_CANCEL);
    mem.write32(grid + MEMCARD_GRID.target, 0x1000);
    mem.write32(grid + MEMCARD_GRID.bucket, 2);
    mem.write32(grid + MEMCARD_GRID.parent, parent >>> 0);
    return grid;
}

/** F0x80084328(screen): reset the grid and start its four fold tweens. */
export function memcardBlockGridReset(
    mem: MemcardBlockGridMemory,
    screen: number,
    host: MemcardBlockGridHost,
): void {
    mem.write32(screen + MEMCARD_GRID.substate, 0);
    mem.write32(screen + MEMCARD_GRID.result, 0);
    mem.write32(MEMCARD_SHARED + MEMCARD_SHARED_INDEX, 0);
    mem.write32(MEMCARD_SHARED + MEMCARD_SHARED_PREVIOUS, 0);
    host.tweenStart(screen + 0x5c, 0xde, 0, 0x0a);
    host.tweenStart(screen + 0x78, -0x55, 0, 0x0a);
    host.tweenStart(screen + 0x94, 0, 0x2f, 8);
    host.tweenStart(screen + 0xb0, -1, 0, 1);
    mem.write32(screen + 0xb8, 0);
}

/** F0x80084240(screen): slide the cursor to the selected block. */
export function memcardBlockGridPlaceCursor(
    mem: MemcardBlockGridMemory,
    screen: number,
    host: MemcardBlockGridHost,
): void {
    const previous = s32(mem.read32(MEMCARD_SHARED + MEMCARD_SHARED_PREVIOUS));
    const index = s32(mem.read32(MEMCARD_SHARED + MEMCARD_SHARED_INDEX));
    host.tweenStart(screen + 0xb0, (previous * 0x44) >>> 0, (index * 0x44) >>> 0, 5);
    mem.write32(screen + MEMCARD_GRID.substate, 7);
}

/** F0x800843D8(screen, &widgetPtr): one block-grid frame. */
export function memcardBlockGridTick(
    mem: MemcardBlockGridMemory,
    screen: number,
    widgetPtrAddr: number,
    host: MemcardBlockGridTickHost,
): void {
    const state = s32(mem.read32(screen + MEMCARD_GRID.state));

    if (state !== 1) {
        if (state < 2 || state >= 4) {
            host.advancePhase(screen);
            memcardBlockGridReset(mem, screen, host);
            let widget = mem.read32(widgetPtrAddr) >>> 0;
            if (widget === 0) {
                const y = s16(u16(mem.read16(screen + MEMCARD_GRID.scrollY)) + 0x18);
                widget = host.createTextElement(s16(mem.read16(screen + MEMCARD_GRID.target)), 1, 0x15, y) >>> 0;
                mem.write32(widgetPtrAddr, widget);
            }
            const source = host.resourceGetBase((host.languageIndex() + MEMCARD_LABEL_RESOURCE) >>> 0) >>> 0;
            host.widgetSetLine0(widget, source, 3);
            const parent = mem.read32(screen + MEMCARD_GRID.parent) >>> 0;
            host.widgetSetNumber(widget, 1, (mem.read32(parent + 0x64) + 1) >>> 0);
            host.widgetClear(widget, 0);
        }
        return;
    }

    // state 1: the eight-way sub-state switch
    const substate = s32(mem.read32(screen + MEMCARD_GRID.substate));
    if (substate === 1) {
        if (host.tweenTick(screen + 0x78) !== 0) {
            mem.write32(screen + MEMCARD_GRID.substate, 0);
            mem.write32(screen + MEMCARD_GRID.result, 1);
        }
    } else if (substate === 2) {
        if (host.tweenTick(screen + 0x5c) !== 0) {
            mem.write32(screen + MEMCARD_GRID.substate, 0);
            mem.write32(screen + MEMCARD_GRID.result, 2);
        }
    } else if (substate === 3) {
        if (host.tweenTick(screen + 0x5c) !== 0) {
            mem.write32(screen + MEMCARD_GRID.substate, 0);
            mem.write32(screen + MEMCARD_GRID.result, 3);
        }
    } else if (substate === 4) {
        if (host.tweenTick(screen + 0x78) !== 0) memcardBlockGridReset(mem, screen, host);
    } else if (substate === 5) {
        if (host.tweenTick(screen + 0x94) !== 0) memcardBlockGridPlaceCursor(mem, screen, host);
    } else if (substate === 6) {
        let moved = false;
        let changed = false;
        const bit = (pressed: number, logical: number): boolean =>
            ((pressed >> (host.padBit(0, logical) & 31)) & 1) !== 0;
        if (bit(host.padPressed(0), 7) || bit(host.padRepeat(0), 7)) {
            const old = s32(mem.read32(MEMCARD_SHARED + MEMCARD_SHARED_INDEX));
            mem.write32(MEMCARD_SHARED + MEMCARD_SHARED_PREVIOUS, old >>> 0);
            const next = old - 1 < 0 ? 0 : old - 1;
            mem.write32(MEMCARD_SHARED + MEMCARD_SHARED_INDEX, next >>> 0);
            moved = true;
            changed = next !== old;
        } else if (bit(host.padPressed(0), 5) || bit(host.padRepeat(0), 5)) {
            const old = s32(mem.read32(MEMCARD_SHARED + MEMCARD_SHARED_INDEX));
            const next = old + 1 >= 3 ? 2 : old + 1;
            mem.write32(MEMCARD_SHARED + MEMCARD_SHARED_PREVIOUS, old >>> 0);
            mem.write32(MEMCARD_SHARED + MEMCARD_SHARED_INDEX, next >>> 0);
            moved = true;
            changed = next !== old;
        }
        if (moved && changed) {
            host.refreshCard(mem.read32(screen + MEMCARD_GRID.parent) >>> 0);
            memcardBlockGridPlaceCursor(mem, screen, host);
            host.playSound(MEMCARD_MOVE_SOUND);
        }
    } else if (substate === 7) {
        if (host.tweenTick(screen + 0xb0) !== 0) mem.write32(screen + MEMCARD_GRID.substate, 6);
    }

    // the draw tail
    host.initDrawContext();
    host.setLayer(mem.read32(screen + MEMCARD_GRID.target), mem.read32(screen + MEMCARD_GRID.bucket));
    host.setOrigin(0x280, 0);
    const first = host.frameTick();
    if (s32(first - s32(mem.read32(screen + MEMCARD_GRID.stamp))) >= MEMCARD_CLUT_PERIOD) {
        // the second tick sample is stored to the stamp in the branch's delay
        // slot, so it happens on both the decay and the advance arm
        const now = host.frameTick();
        const direction = s32(mem.read32(screen + MEMCARD_GRID.clutDir));
        mem.write32(screen + MEMCARD_GRID.stamp, now >>> 0);
        if (direction !== 0) {
            const frame = s32(mem.read32(screen + MEMCARD_GRID.clutFrame)) - 1;
            mem.write32(screen + MEMCARD_GRID.clutFrame, frame >>> 0);
            if (frame <= 0) {
                mem.write32(screen + MEMCARD_GRID.clutFrame, 0);
                mem.write32(screen + MEMCARD_GRID.clutDir, 0);
            }
        } else {
            const frame = s32(mem.read32(screen + MEMCARD_GRID.clutFrame)) + 1;
            mem.write32(screen + MEMCARD_GRID.clutFrame, frame >>> 0);
            if (frame >= 0x0c) {
                mem.write32(screen + MEMCARD_GRID.clutFrame, MEMCARD_CLUT_MAX);
                mem.write32(screen + MEMCARD_GRID.clutDir, 1);
            }
        }
    }
    host.paletteShift(mem.read32(screen + MEMCARD_GRID.clutFrame));
    host.drawSprite(
        host.packResolve(MEMCARD_GRID_PACK) >>> 0,
        0x23,
        ((mem.read32(screen + MEMCARD_GRID.scrollX) | 0) + (mem.read32(screen + MEMCARD_GRID.cursorX) | 0) + 0x30) >>> 0,
        ((mem.read32(screen + MEMCARD_GRID.scrollY) | 0) + 0x12) >>> 0,
    );
    host.paletteShift(0);
    host.drawSprite(
        host.packResolve(MEMCARD_GRID_PACK) >>> 0,
        0x20,
        0,
        ((mem.read32(screen + MEMCARD_GRID.scrollY) | 0) + 0x10) >>> 0,
    );
    const widget = mem.read32(widgetPtrAddr) >>> 0;
    host.widgetSetPosition(widget, 0x15, s16(u16(mem.read16(screen + MEMCARD_GRID.scrollY)) + 0x18));

    const parent = mem.read32(screen + MEMCARD_GRID.parent) >>> 0;
    for (let i = 0; i < 3; i++) {
        const record = parent + i * 0x44;
        if (mem.read8(record + 0x74) === 0) continue;
        const byte = s32(mem.read32(record + 0xa4));
        host.drawSprite(
            host.packResolve(MEMCARD_GRID_PACK) >>> 0,
            mem.read32(MEMCARD_NAMEPLATE_TABLE + (byte - 3) * 4) >>> 0,
            ((mem.read32(MEMCARD_XPOS_TABLE + i * 4) | 0) + (mem.read32(screen + 0x64) | 0)) >>> 0,
            0x23,
        );
    }
    host.drawSprite(
        host.packResolve(MEMCARD_GRID_PACK) >>> 0,
        0x22,
        ((mem.read32(screen + 0x64) | 0) + 0x62) >>> 0,
        0x20,
    );
}
