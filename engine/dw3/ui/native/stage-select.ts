// The stage-select menu's root tick, translated bit-exactly from the original
// pro/stagslct F0x80084D9C body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/stage-select.test.js runs the original through
// engine/native and compares the ordered calls and memory.
//
// State 0 / >=4 builds the screen: resets the display service, counts the
// entries in the 0x80085EEC table (shown capped at 14), creates the title and
// the two-column entry widgets (one row per entry, up to 14) and the fixed
// footer/level/stat widgets. State 1 sub 0 recolours the two title widgets and
// calls the object's +0x3C; sub 1 reads the pad (page scroll with the shoulder
// buttons, column move with up/down, level/stat edit on the second pad) and
// repaints the rows, then settles the confirm/cancel into the shared counters.
// State 2 returns; state 3 releases the selected category entry through the card
// service.
//
// The display service (0x8004DE10 + 0x150/0x154/0x174/0x16C), the shared card
// service (0x80048D34 + 0x2718/0x2750/0x270C and its +0x28/+0x2C/+0x263C
// cells), the three overlay helpers (F0x80084A5C / F0x80084B2C / F0x80084B70),
// the pad service (0x8004B7D0 + 0x3F4/0x3FC/0x3F8 and its +0x408 bit shifter),
// the frame-button cell (0x8004BBC4), the sound cell (0x80048A7C), the widget
// factory (F0x8001AE38) and every widget method are host boundaries. The
// selection/frame/counter cells (0x80042B1C.., 0x8004B370, 0x8005CCA8) and the
// two overlay tables are read and written through memory exactly as the
// original does. This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

export const STAGE_SELECT_TICK = 0x80084d9c;
export const STAGE_SELECT_TABLE = 0x80085eec;
export const STAGE_SELECT_COLOURS = 0x80085ed0;
export const BIOS_DATE_CAPTION = 0x80084b70;
export const BIOS_ROM_DATE = 0x1fc0012c;
export const BIOS_DATE_BUFFER = 0x80087194;
export const STAGE_SELECT_ROW_HANDLER = 0x80084d9c;
export const STAGE_SELECT_ROWS_MAX = 0xe;
export const STAGE_SELECT_SHOWN = 0x58;
export const STAGE_SELECT_ENTRIES = 0x5c;
export const STAGE_SELECT_ROW_INDEX = 0x54;
export const STAGE_SELECT_COLUMN_INDEX = 0x50;
export const STAGE_SELECT_RELEASE = 0x8004b440;
export const STAGE_SELECT_CARD = 0x80048d34;
export const STAGE_SELECT_CARD_INDEX_SLOT = 0x2718;
export const STAGE_SELECT_CARD_RECORD_SLOT = 0x2750;
export const STAGE_SELECT_RELEASE_SLOT = 0x270c;
export const STAGE_SELECT_INDEX_A = 0x28;
export const STAGE_SELECT_INDEX_B = 0x2c;
export const STAGE_SELECT_COUNTER = 0x263c;
export const STAGE_SELECT_FRAME_BUTTONS = 0x8004bbc4;
export const STAGE_SELECT_SOUND = 0x80048a7c;
export const STAGE_SELECT_FRAME_CELL = 0x8005cca8;
export const STAGE_SELECT_CURSOR = 0x8004b370;
export const STAGE_SELECT_MENU_STATE = 0x80042b1c;
export const STAGE_SELECT_VALUE = 0x80042b20;
export const STAGE_SELECT_FIELD = 0x80042b24;

export interface StageSelectMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
    /** Unsigned 8-bit read. */
    read8(addr: number): number;
    /** Unsigned 16-bit read. */
    read16(addr: number): number;
    /** 16-bit write. */
    write16(addr: number, value: number): void;
}

export interface StageSelectHost {
    /** [0x8004DE10+0x150](arg) */
    displayReset(arg: number): void;
    /** [0x8004DE10+0x154](value) */
    displayMode(value: number): void;
    /** [0x8004DE10+0x174](a, b, c, d) */
    displayRegion(a: number, b: number, c: number, d: number): void;
    /** [0x8004DE10+0x16C](pack, arg1, arg2) -> display object */
    displayEnv(pack: number, arg1: number, arg2: number): number;
    /** [0x8004B440] = [0x80048D34+0x270C](handle, arg) */
    releaseEntry(handle: number, arg: number): void;
    /** [0x80048D34+0x2718](index) */
    cardIndexOf(index: number): number;
    /** [0x80048D34+0x2750](index) */
    cardRecord(index: number): number;
    /** F0x80084A5C(obj, delta) */
    moveColumn(obj: number, delta: number): void;
    /** F0x80084B2C(obj, delta) */
    scrollColumn(obj: number, delta: number): void;
    /** F0x80084B70(obj, arg1) */
    drawRows(obj: number, arg1: number): void;
    /** [0x8004B7D0+cell](port) with cell in {0x3F4, 0x3FC, 0x3F8} */
    padButtons(cell: number, port: number): number;
    /** [0x8004B7D0+0x408](port, bit) */
    padShift(port: number, bit: number): number;
    /** [0x8004BBC4](0) */
    frameButtons(): number;
    /** [0x80048A7C](0x80060000) */
    playSound(a0: number): void;
    /** F0x8001AE38(0x1000, 1, y, x) */
    createWidget(y: number, x: number): number;
    /** target+slot(args) */
    callMethod(target: number, slot: number, args: number[]): void;
}

function s16(value: number): number {
    return (value << 16) >> 16;
}

function bit(
    host: StageSelectHost,
    cell: number,
    port: number,
    bitIndex: number,
): number {
    return (host.padButtons(cell, port) >> host.padShift(port, bitIndex)) & 1;
}

/** F0x80084D9C(obj, arg1): the stage-select menu root tick. */
export function stageSelectTick(
    mem: StageSelectMemory,
    obj: number,
    arg1: number,
    host: StageSelectHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        const sub = mem.read32(obj + 0x10) | 0;
        if (sub === 0) {
            host.callMethod(mem.read32(arg1) | 0, 0x110, [0x800849a4]);
            host.callMethod(mem.read32(arg1 + 4) | 0, 0x110, [0x800849c8]);
            host.callMethod(obj, 0x3c, []);
            return;
        }
        if (sub !== state) return;
        stageSelectInput(mem, obj, arg1, host);
        return;
    }
    if (state === 2) return;
    if (state === 3) {
        const entry = STAGE_SELECT_TABLE
            + ((mem.read32(obj + STAGE_SELECT_ROW_INDEX) | 0) + (mem.read32(obj + STAGE_SELECT_COLUMN_INDEX) | 0)) * 0x10;
        const value = mem.read32(entry + 0x0c) | 0;
        if (value & 0x8000) {
            host.releaseEntry(mem.read32(entry + 0x08) | 0, 0);
            mem.write32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER, value & 0xff);
        } else {
            host.releaseEntry(mem.read32(entry + 0x08) | 0, value);
        }
        mem.write32(STAGE_SELECT_CARD + STAGE_SELECT_INDEX_A, mem.read32(obj + STAGE_SELECT_ROW_INDEX) | 0);
        mem.write32(STAGE_SELECT_CARD + STAGE_SELECT_INDEX_B, mem.read32(obj + STAGE_SELECT_COLUMN_INDEX) | 0);
        return;
    }
    stageSelectInit(mem, obj, arg1, state < 2 ? obj : 0x80080000, host);
}

function stageSelectInit(
    mem: StageSelectMemory,
    obj: number,
    arg1: number,
    resetArg: number,
    host: StageSelectHost,
): void {
    host.displayReset(resetArg);
    host.displayMode(0x5000);
    host.displayRegion(0x140, 0xf0, 0, 0);
    const env = host.displayEnv(0x8008718c, 1, 0x1000);
    host.callMethod(env, 0x12c, [0x1f, 0x1f, 0x1f]);

    let count = 0;
    if ((mem.read32(STAGE_SELECT_TABLE + 0x08) | 0) !== -1) {
        let p = STAGE_SELECT_TABLE;
        do {
            p += 0x10;
            count += 1;
        } while ((mem.read32(p + 0x08) | 0) !== -1);
    }
    mem.write32(obj + STAGE_SELECT_SHOWN, count < STAGE_SELECT_ROWS_MAX ? count : STAGE_SELECT_ROWS_MAX);
    mem.write32(obj + STAGE_SELECT_ENTRIES, count);
    mem.write32(obj + STAGE_SELECT_ROW_INDEX, mem.read32(STAGE_SELECT_CARD + STAGE_SELECT_INDEX_A) | 0);
    mem.write32(obj + STAGE_SELECT_COLUMN_INDEX, mem.read32(STAGE_SELECT_CARD + STAGE_SELECT_INDEX_B) | 0);

    mem.write32(arg1 + 0x00, host.createWidget(0x10, 0x20));
    const titleValue = host.createWidget(0x10, 0x2c);
    mem.write32(arg1 + 0x04, titleValue);
    host.callMethod(titleValue, 0x134, [0xe, s16((mem.read32(obj + 0x50) | 0) * 0xc + 0x2d)]);

    let x = 0x2d0000;
    const shown = mem.read32(obj + STAGE_SELECT_SHOWN) | 0;
    for (let i = 0; i < shown; i++) {
        const y = x >> 16;
        mem.write32(arg1 + i * 4 + 0x08, host.createWidget(0x18, y));
        mem.write32(arg1 + i * 4 + 0x40, host.createWidget(0x98, y));
        const entry = STAGE_SELECT_TABLE + ((mem.read32(obj + STAGE_SELECT_ROW_INDEX) | 0) + i) * 0x10;
        host.callMethod(mem.read32(arg1 + i * 4 + 0x08) | 0, 0x110, [mem.read32(entry) | 0]);
        host.callMethod(mem.read32(arg1 + i * 4 + 0x40) | 0, 0x110, [mem.read32(entry + 0x04) | 0]);
        x += 0xc0000;
    }

    mem.write32(arg1 + 0x80, host.createWidget(0x90, 0x20));
    mem.write32(arg1 + 0x84, host.createWidget(0xc0, 0x20));
    mem.write32(arg1 + 0x8c, host.createWidget(0xd0, 0xdc));
    mem.write32(arg1 + 0x90, host.createWidget(0x100, 0xdc));
    const valueWidget = host.createWidget(0x10, 0xdc);
    mem.write32(arg1 + 0x88, valueWidget);
    host.callMethod(valueWidget, 0x118, [0, mem.read32(STAGE_SELECT_MENU_STATE) | 0]);
    mem.write32(arg1 + 0x94, host.createWidget(0x30, 0xdc));
    mem.write32(arg1 + 0x98, host.createWidget(0x50, 0xdc));
    host.callMethod(obj, 0x38, []);
}

function stageSelectInput(
    mem: StageSelectMemory,
    obj: number,
    arg1: number,
    host: StageSelectHost,
): void {
    const previous = mem.read32(obj + STAGE_SELECT_ROW_INDEX) | 0;

    if (bit(host, 0x3f4, 0, 4) || bit(host, 0x3fc, 0, 4)) {
        host.moveColumn(obj, -1);
    } else if (bit(host, 0x3f4, 0, 6) || bit(host, 0x3fc, 0, 6)) {
        host.moveColumn(obj, 1);
    } else {
        stageSelectScroll(obj, host);
    }

    host.callMethod(mem.read32(arg1 + 0x04) | 0, 0x134, [0xe, s16((mem.read32(obj + 0x50) | 0) * 0xc + 0x2d)]);

    if (previous !== (mem.read32(obj + STAGE_SELECT_ROW_INDEX) | 0)) {
        const shown = mem.read32(obj + STAGE_SELECT_SHOWN) | 0;
        for (let i = 0; i < shown; i++) {
            const entry = STAGE_SELECT_TABLE + ((mem.read32(obj + STAGE_SELECT_ROW_INDEX) | 0) + i) * 0x10;
            host.callMethod(mem.read32(arg1 + i * 4 + 0x08) | 0, 0x110, [mem.read32(entry) | 0]);
            host.callMethod(mem.read32(arg1 + i * 4 + 0x40) | 0, 0x110, [mem.read32(entry + 0x04) | 0]);
        }
    }

    host.drawRows(obj, arg1);

    if (bit(host, 0x3f4, 0, 0)) {
        const value = (mem.read32(STAGE_SELECT_MENU_STATE) | 0) === 0 ? 1 : 0;
        mem.write32(STAGE_SELECT_MENU_STATE, value);
        host.callMethod(mem.read32(arg1 + 0x88) | 0, 0x118, [0, value]);
    }

    if (bit(host, 0x3f4, 0, 0xd)) {
        const entry = STAGE_SELECT_TABLE
            + ((mem.read32(obj + STAGE_SELECT_ROW_INDEX) | 0) + (mem.read32(obj + STAGE_SELECT_COLUMN_INDEX) | 0)) * 0x10;
        const target = mem.read32(entry + 0x08) | 0;
        if (target !== 0) {
            if (target === 0x300) {
                mem.write32(STAGE_SELECT_CURSOR, mem.read32(entry + 0x0c) | 0);
            } else {
                host.callMethod(obj, 0x28, [3]);
            }
        }
    }

    if ((host.frameButtons() | 0) & 8) {
        let frame = (mem.read32(STAGE_SELECT_FRAME_CELL) + 1) | 0;
        mem.write32(STAGE_SELECT_FRAME_CELL, frame);
        if (frame === 7) {
            mem.write32(STAGE_SELECT_FRAME_CELL, 0);
            frame = 0;
        }
        host.playSound(0x80060000);
    }

    host.callMethod(mem.read32(arg1 + 0x80) | 0, 0x110, [
        mem.read32(STAGE_SELECT_COLOURS + (mem.read32(STAGE_SELECT_FRAME_CELL) | 0) * 4) | 0,
    ]);

    if (((host.padButtons(0x3f4, 0) | 0) & 0x200) || ((host.padButtons(0x3fc, 0) | 0) & 0x200)) {
        if ((mem.read32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER) | 0) === 0x8000) {
            mem.write32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER, 0);
        }
        const counter = mem.read32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER) | 0;
        if (counter !== 0) mem.write32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER, (counter - 1) | 0);
    }

    if (((host.padButtons(0x3f4, 0) | 0) & 0x100) || ((host.padButtons(0x3fc, 0) | 0) & 0x100)) {
        if ((mem.read32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER) | 0) === 0x8000) {
            mem.write32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER, 0);
        }
        mem.write32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER, (mem.read32(STAGE_SELECT_CARD + STAGE_SELECT_COUNTER) | 0) + 1);
    }

    host.callMethod(mem.read32(arg1 + 0x84) | 0, 0x118, [0, mem.read32(STAGE_SELECT_CURSOR) | 0]);

    const statDelta = stageSelectStatDelta(host);
    const levelDelta = stageSelectLevelDelta(host);

    let level = 0;
    let stat = 0;
    for (let i = 0; i < 3; i++) {
        const index = host.cardIndexOf(i) | 0;
        if (index >= 0) {
            const record = host.cardRecord(index) | 0;
            const levelValue = (mem.read16(record + 0x32) + levelDelta) & 0xffff;
            mem.write16(record + 0x32, levelValue);
            if (s16(levelValue) >= 0x3e8) mem.write16(record + 0x32, 0x3e7);
            if (s16(mem.read16(record + 0x32)) < 0) mem.write16(record + 0x32, 0);
            const statValue = (mem.read16(record + 0x1c) + statDelta) & 0xffff;
            mem.write16(record + 0x1c, statValue);
            if (s16(statValue) >= 0x64) mem.write16(record + 0x1c, 0x63);
            if (s16(mem.read16(record + 0x1c)) <= 0) mem.write16(record + 0x1c, 1);
            if (i === 0) {
                level = s16(mem.read16(record + 0x32));
                stat = s16(mem.read16(record + 0x1c));
            }
        }
    }

    host.callMethod(mem.read32(arg1 + 0x8c) | 0, 0x118, [0, level]);
    host.callMethod(mem.read32(arg1 + 0x90) | 0, 0x118, [0, stat]);

    if (host.padButtons(0x3f4, 1) & 0x10) {
        const value = mem.read32(STAGE_SELECT_MENU_STATE + 0x04) | 0;
        if (value !== 3) mem.write32(STAGE_SELECT_MENU_STATE + 0x04, (value + 1) | 0);
    } else if (host.padButtons(0x3f4, 1) & 0x40) {
        const value = mem.read32(STAGE_SELECT_MENU_STATE + 0x04) | 0;
        if (value !== -1) mem.write32(STAGE_SELECT_MENU_STATE + 0x04, (value - 1) | 0);
    } else if (host.padButtons(0x3f4, 1) & 0x20) {
        const value = mem.read32(STAGE_SELECT_MENU_STATE + 0x08) | 0;
        if (value !== 7) mem.write32(STAGE_SELECT_MENU_STATE + 0x08, (value + 1) | 0);
    } else if (host.padButtons(0x3f4, 1) & 0x80) {
        const value = mem.read32(STAGE_SELECT_MENU_STATE + 0x08) | 0;
        if (value !== -1) mem.write32(STAGE_SELECT_MENU_STATE + 0x08, (value - 1) | 0);
    }

    stageSelectFooter(mem, arg1, host);
    stageSelectField(mem, arg1, host);
}

function stageSelectScroll(obj: number, host: StageSelectHost): void {
    const t1 = bit(host, 0x3f8, 0, 0xb);
    if (!t1) {
        if (bit(host, 0x3f4, 0, 0xa)) {
            host.scrollColumn(obj, -0xe);
            return;
        }
    }
    if (!t1) {
        if (!bit(host, 0x3f8, 0, 0xb)) {
            if (bit(host, 0x3fc, 0, 0xa)) {
                host.scrollColumn(obj, -0xe);
                return;
            }
        }
    }
    const t5 = bit(host, 0x3f8, 0, 0xa);
    if (!t5) {
        if (bit(host, 0x3f4, 0, 0xb)) {
            host.scrollColumn(obj, 0xe);
            return;
        }
    }
    if (!bit(host, 0x3f8, 0, 0xa)) {
        if (bit(host, 0x3fc, 0, 0xb)) host.scrollColumn(obj, 0xe);
    }
}

/** The stat-edit delta from the first pad on port 1. */
function stageSelectStatDelta(host: StageSelectHost): number {
    if (!bit(host, 0x3f8, 1, 0xa) && bit(host, 0x3f4, 1, 0xb)) return 1;
    if (!bit(host, 0x3f8, 1, 0xb) && bit(host, 0x3f4, 1, 0xa)) return -1;
    if (!bit(host, 0x3f8, 1, 0xa) && bit(host, 0x3fc, 1, 0xb)) return 0xa;
    if (!bit(host, 0x3f8, 1, 0xb) && bit(host, 0x3fc, 1, 0xa)) return -0xa;
    return 0;
}

/** The level-edit delta from the first pad on port 1. */
function stageSelectLevelDelta(host: StageSelectHost): number {
    if (!bit(host, 0x3f8, 1, 8) && bit(host, 0x3f4, 1, 9)) return 1;
    if (!bit(host, 0x3f8, 1, 9) && bit(host, 0x3f4, 1, 8)) return -1;
    if (!bit(host, 0x3f8, 1, 8) && bit(host, 0x3fc, 1, 9)) return 0xa;
    if (!bit(host, 0x3f8, 1, 9) && bit(host, 0x3fc, 1, 8)) return -0xa;
    return 0;
}

function stageSelectFooter(mem: StageSelectMemory, arg1: number, host: StageSelectHost): void {
    const value = mem.read32(STAGE_SELECT_VALUE) | 0;
    if (value !== -1) {
        host.callMethod(mem.read32(arg1 + 0x94) | 0, 0x118, [0, (value + 1) | 0]);
        host.callMethod(mem.read32(arg1 + 0x94) | 0, 0x144, [1]);
    } else {
        host.callMethod(mem.read32(arg1 + 0x94) | 0, 0x144, [0]);
    }
}

function stageSelectField(mem: StageSelectMemory, arg1: number, host: StageSelectHost): void {
    const value = mem.read32(STAGE_SELECT_FIELD) | 0;
    if (value !== -1) {
        host.callMethod(mem.read32(arg1 + 0x98) | 0, 0x118, [0, (value + 1) | 0]);
        host.callMethod(mem.read32(arg1 + 0x98) | 0, 0x144, [1]);
        return;
    }
    host.callMethod(mem.read32(arg1 + 0x98) | 0, 0x144, [0]);
}

// ── BIOS date caption (F0x80084B70) ──
// Reads 10 bytes from the PS1 boot ROM at 0x1FC0012C, converts each ASCII
// byte to fullwidth Shift-JIS (digits/uppercase via -0x7DE1, dash → 0x815C,
// else 0x8140), byte-swaps into big-endian, stores in overlay buffer
// 0x80087194 with NUL at 0x800871A8.  On the first call it creates a text
// widget via the host factory (F0x8001AE38); on every call it positions the
// widget at (220, 20) and sets its string to the buffer.
//
// This function cannot be bridged because it calls through MIPS method
// pointers (widget +0x134 and +0x110); see BRIDGE_BLOCKERS.
// Oracle: tests/bios-date-caption-oracle.test.js

/** Convert one BIOS ROM byte to fullwidth Shift-JIS. */
export function biosByteToShiftJis(b: number): number {
    if (b >= 0x30 && b <= 0x39) return (b & 0xff) - 0x7de1;
    if (b >= 0x41 && b <= 0x5a) return (b & 0xff) - 0x7de1;
    if ((b & 0xff) === 0x2d) return 0x815c;
    return 0x8140;
}

/** Byte-swap a u16 (MIPS: lhu → srl 8 + sll 8 + addu → sh). */
export function swapU16(v: number): number {
    const u16 = v & 0xffff;
    return (((u16 >>> 8) & 0xff) + ((u16 & 0xff) << 8)) & 0xffff;
}

/**
 * F0x80084B70 bios_date_caption(obj, arg1).
 *
 * Bridge-blocked (calls through widget method pointers +0x134, +0x110).
 * The tick delegates to `host.drawRows(obj, arg1)` which, when bridged,
 * would call this function — but the bridge cannot reach the MIPS method
 * pointers, so the function stays native and is tested through the oracle.
 */
export function biosDateCaption(
    mem: StageSelectMemory,
    obj: number,
    arg1: number,
    host: StageSelectHost,
): void {
    if ((mem.read32(obj + 0x60) | 0) === 0) {
        const widget = host.createWidget(0x10, 0x20);
        mem.write32(arg1 + 0x78, widget);
        // Convert 10 BIOS ROM bytes to fullwidth Shift-JIS in the overlay buffer.
        for (let i = 0; i < 10; i++) {
            const raw = biosByteToShiftJis(mem.read8(BIOS_ROM_DATE + i));
            mem.write16(BIOS_DATE_BUFFER + i * 2, swapU16(raw));
        }
        mem.write16(BIOS_DATE_BUFFER + 20, 0); // NUL terminator
        mem.write32(obj + 0x60, 1);
    }
    const widget = mem.read32(arg1 + 0x78) | 0;
    host.callMethod(widget, 0x134, [0xdc, 0x14]);
    host.callMethod(widget, 0x110, [BIOS_DATE_BUFFER]);
}
