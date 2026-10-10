// The naming screen's keyboard object, translated from the original
// pro/stdgname bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/name-keyboard.test.js runs each original body through
// engine/native on the shipped pro_stdgname.bin + resident.bin, with every
// service the body calls stubbed, and compares the ordered calls and fields.
//
//   F0x80085364 nameEntryCreate      build the 0xF8+0x34 keyboard object.
//   F0x800851B8 nameEntrySetOrigin   store the two placement values.
//   F0x800851C4 nameEntrySeedAndPad  copy the starting name, pad with blanks.
//   F0x80085258 nameEntryReseed      export the typed name (method 0xF0).
//   F0x80085358 nameEntryCommit      request the accepted state (method 0xF4).
//   F0x80085078 nameEntryTick        first-frame setup, then type and draw.
//   F0x80083478 nameEntryWidgetsBuild  the chrome widgets.
//   F0x80083668 nameEntryWidgetsBind   fill or hide the chrome text.
//   F0x80084318 nameKeyboardTick     the typing state machine.
//   F0x80083994 nameKeyboardDraw     the keyboard, cursor and hint sprites.
//
// The allocator, widget factory and widget methods, string services, fold
// tweens, pad, sound, pack-handle and frame-counter services, and the two
// draw/GPU call tables are host boundaries. The port keeps their exact call
// order and guards. Role names of the draw-table slots are NOT established;
// they carry their table offset.
//
// Grid data (all read from the shipped overlay, never authored here):
//   0x80088E34 word    page count (3 for language 0, else 1)
//   0x80088E38 pointer per-page label ids, 12 bytes a page
//   0x80088E3C pointer per-page cell grid, 0xD2 bytes a page, seven rows of
//                      fifteen (type byte, glyph byte) pairs; type 1 starts a
//                      key, a negative type points back to its start, 0 is
//                      empty
//   0x80087A78 the glyph table object: +0xC the code table, +0x10 the blank
//                      glyph entry

export interface NameKeyboardMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface NameKeyboardHost {
    /** F0x80014504(handler, size, extra): allocate a screen object. */
    alloc(handler: number, size: number, extra: number): number;
    /** F0x8001AE38(layer, 1, x, y): build a widget. */
    createWidget(layer: number, x: number, y: number): number;
    /** target+slot(args...): a widget or screen object method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** F0x8001FCC0 then table+8(dst, src, mode): copy a string. */
    copyString(dst: number, src: number, mode: number): void;
    /** F0x8002525C(ptr): string length in bytes. */
    stringLength(ptr: number): number;
    /** F0x80083378(fold, direction): start a panel fold. */
    foldStart(fold: number, direction: number): void;
    /** F0x8008340C(fold): nonzero when the fold has landed. */
    foldTick(fold: number): number;
    /** [0x8004B7D0+0x3F4](n): pad bits pressed this frame. */
    padPressed(n: number): number;
    /** [0x8004B7D0+0x3F8](n): pad bits held this frame. */
    padHeld(n: number): number;
    /** [0x8004B7D0+0x3FC](n): pad auto-repeat pulses this frame. */
    padRepeat(n: number): number;
    /** [0x8004B7D0+0x408](pad, code): the shift for a button code. */
    padBit(pad: number, code: number): number;
    /** [0x80055C48](id): play a packed sound id. */
    playSound(id: number): void;
    /** [0x80044F5C](id): resolve a pack handle. */
    packHandle(id: number): number;
    /** [0x80044F4C](id): resolve a language bank. */
    languageBank(id: number): number;
    /** [0x8004DE10+0x188](): the frame counter. */
    frameCount(): number;
    /** F0x8001F648: fill the draw call table. */
    drawInit(): void;
    /** draw table +0x74(x, y) */
    draw74(x: number, y: number): void;
    /** draw table +0x7C(a, b) */
    draw7C(a: number, b: number): void;
    /** draw table +0x84(handle, clip, x, y): a sprite. */
    drawSprite(handle: number, clip: number, x: number, y: number): void;
    /** draw table +0x88(n) */
    draw88(n: number): void;
    /** draw table +0x8C(a, b, c) */
    draw8C(a: number, b: number, c: number): void;
    /** draw table +0x94(a, b) */
    draw94(a: number, b: number): void;
    /** F0x8001FFA8: fill the GPU call table. */
    gpuInit(): void;
    /** gpu table +0x24(x, y) */
    gpu24(x: number, y: number): void;
    /** gpu table +0x2C(handle) */
    gpu2C(handle: number): void;
}

export const NAME_ENTRY_HANDLER = 0x80085078;
export const NAME_ENTRY_SIZE = 0xf8;
export const NAME_ENTRY_EXTRA = 0x34;
export const NAME_ENTRY_RESEED = 0x80085258;
export const NAME_ENTRY_COMMIT = 0x80085358;
export const NAME_LANGUAGE_CELL = 0x8005cca8;
export const NAME_PAGE_STRUCT = 0x80088e34;
export const NAME_PAGE_LABELS = 0x80088e38;
export const NAME_GRID_CELL = 0x80088e3c;
export const NAME_GLYPH_TABLE = 0x80087a78;
export const NAME_HINT_TABLE = 0x80087a90;
export const NAME_WIDE_KEYS = 0x80087b70;
export const NAME_ARROW_FRAMES = 0x80087bac;
export const NAME_BLANK = 0x4081;

/**
 * The keyboard's object fields and data tables. The wizard's registration screen
 * carries a byte-for-byte copy of these routines whose object fields sit four
 * bytes lower from the cursor column on and whose tables live elsewhere; the
 * only differences between the two bodies are the values below.
 */
export interface NameKeyboardLayout {
    f: {
        col: number; row: number; blinkFrame: number; blinkTime: number;
        cursorOn: number; page: number; arrowFrame: number; arrowTime: number;
        scale: number; overlay: number;
        /** The three fold objects: keyboard opening, message, and the first-frame duration cell. */
        foldOpen: number; foldMsg: number; foldInit: number;
    };
    t: {
        pageStruct: number; glyph: number; hint: number; wideKeys: number; arrowFrames: number;
        lang0: { labels: number; grid: number };
        other: { labels: number; grid: number };
    };
}

export const NAME_SCREEN_LAYOUT: NameKeyboardLayout = {
    f: {
        col: 0x9c, row: 0xa0, blinkFrame: 0xa4, blinkTime: 0xa8, cursorOn: 0xac, page: 0xb0,
        arrowFrame: 0xb4, arrowTime: 0xb8, scale: 0xd8, overlay: 0xe8,
        foldOpen: 0xd0, foldMsg: 0xe0, foldInit: 0xc0,
    },
    t: {
        pageStruct: 0x80088e34, glyph: 0x80087a78, hint: 0x80087a90, wideKeys: 0x80087b70,
        arrowFrames: 0x80087bac,
        lang0: { labels: 0x800876fc, grid: 0x80087720 },
        other: { labels: 0x80087998, grid: 0x800879a4 },
    },
};

/** The registration wizard's copy (pro/stplnmet F0x80083e70..F0x80085a70). */
export const WIZARD_KEYBOARD_LAYOUT: NameKeyboardLayout = {
    f: {
        col: 0x98, row: 0x9c, blinkFrame: 0xa0, blinkTime: 0xa4, cursorOn: 0xa8, page: 0xac,
        arrowFrame: 0xb0, arrowTime: 0xb4, scale: 0xd4, overlay: 0xe4,
        foldOpen: 0xcc, foldMsg: 0xdc, foldInit: 0xbc,
    },
    t: {
        pageStruct: 0x80089bb0, glyph: 0x8008991c, hint: 0x80089934, wideKeys: 0x80089a14,
        arrowFrames: 0x80089a50,
        lang0: { labels: 0x800895a0, grid: 0x800895c4 },
        other: { labels: 0x8008983c, grid: 0x80089848 },
    },
};

const BLANK = NAME_BLANK;
const SLOTS = 0x78;

const swap16 = (v: number): number => (((v & 0xffff) >> 8) | ((v & 0xff) << 8)) & 0xffff;
const s8 = (v: number): number => (v << 24) >> 24;

/** F0x800851B8(obj, x, y): store the two placement values. */
export function nameEntrySetOrigin(mem: NameKeyboardMemory, obj: number, x: number, y: number): void {
    mem.write32(obj + 0x5c, x | 0);
    mem.write32(obj + 0x60, y | 0);
}

/** F0x800851C4(obj, src): copy the starting name and pad with blanks. */
export function nameEntrySeedAndPad(
    mem: NameKeyboardMemory,
    obj: number,
    src: number,
    host: NameKeyboardHost,
): void {
    host.copyString(obj + SLOTS, src, 0);
    let i = host.stringLength(obj + SLOTS) >> 1;
    while (i < (mem.read32(obj + 0x94) | 0)) {
        mem.write16(obj + i * 2 + SLOTS, BLANK);
        i += 1;
    }
}

/** F0x80085364(src, index): build the keyboard object. */
export function nameEntryCreate(
    mem: NameKeyboardMemory,
    src: number,
    index: number,
    host: NameKeyboardHost,
): number {
    const obj = host.alloc(NAME_ENTRY_HANDLER, NAME_ENTRY_SIZE, NAME_ENTRY_EXTRA);
    mem.write32(obj + 0xf0, NAME_ENTRY_RESEED | 0);
    mem.write32(obj + 0xf4, NAME_ENTRY_COMMIT | 0);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 3);
    mem.write32(obj + 0x50, 1);
    mem.write32(obj + 0x64, index | 0);
    mem.write32(obj + 0x94, (mem.read32(NAME_LANGUAGE_CELL) | 0) === 0 ? 5 : 8);
    nameEntrySeedAndPad(mem, obj, src, host);
    nameEntrySetOrigin(mem, obj, 0x280, 0x100);
    return obj;
}

/** F0x80085258(obj, dst): export the typed name, skipping leading blanks. */
export function nameEntryReseed(
    mem: NameKeyboardMemory,
    obj: number,
    dst: number,
    host: NameKeyboardHost,
): void {
    const limit = mem.read32(obj + 0x94) | 0;
    for (let i = 0; i < limit * 2; i++) mem.write8(dst + i, 0);
    let k = limit - 1;
    while (k >= 0) {
        if (mem.read16(obj + k * 2 + SLOTS) !== BLANK) break;
        mem.write16(obj + k * 2 + SLOTS, 0);
        k -= 1;
    }
    let lead = 0;
    if (limit > 0) {
        while (mem.read16(obj + lead * 2 + SLOTS) === BLANK) {
            lead += 1;
            if (lead >= limit) break;
        }
    }
    host.copyString(dst, obj + lead * 2 + SLOTS, 1);
}

/** F0x80085358(obj): ask the keyboard to run its accepted state. */
export function nameEntryCommit(mem: NameKeyboardMemory, obj: number): void {
    mem.write32(obj + 0x10, 0xa);
}

/** F0x80083478(obj, ui): build the chrome widgets into the ui block. */
export function nameEntryWidgetsBuild(
    mem: NameKeyboardMemory,
    obj: number,
    ui: number,
    host: NameKeyboardHost,
    L: NameKeyboardLayout = NAME_SCREEN_LAYOUT,
): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    const pages = () => (mem.read32(obj + 0x58) | 0) - 1;
    let w = host.createWidget(layer(), 0x20, 0x1a);
    mem.write32(ui + 0x0, w);
    host.callMethod(w, 0x138, [4]);
    w = host.createWidget(layer(), 0x4b, 0x40);
    mem.write32(ui + 0x4, w);
    host.callMethod(w, 0x140, [0x13, 0]);
    mem.write32((mem.read32(ui + 0x4) | 0) + 0x50, L.t.glyph | 0);
    for (let i = 0; i < 3; i++) {
        w = host.createWidget(layer(), 0x2f + i * 0x4e, 0x5b);
        mem.write32(ui + 0x8 + i * 4, w);
        host.callMethod(w, 0x15c, [pages()]);
        host.callMethod(mem.read32(ui + 0x8 + i * 4) | 0, 0x160, [7]);
        host.callMethod(mem.read32(ui + 0x8 + i * 4) | 0, 0x140, [0xe, 0x12]);
        mem.write32((mem.read32(ui + 0x8 + i * 4) | 0) + 0x50, L.t.glyph | 0);
    }
    mem.write32(ui + 0x20, host.createWidget(layer(), 0xce, 0xc6));
    mem.write32(ui + 0x24, host.createWidget(layer(), 0xe1, 0xc6));
    w = host.createWidget(layer(), 0x13, 0x62);
    mem.write32(ui + 0x28, w);
    host.callMethod(w, 0x15c, [pages()]);
    w = host.createWidget(layer(), 0x123, 0x62);
    mem.write32(ui + 0x2c, w);
    host.callMethod(w, 0x15c, [pages()]);
    mem.write32(ui + 0x30, host.createWidget(layer(), 0x3e, 0x72));
}

/** F0x80083668(obj, ui, show): fill the chrome text, or hide it. */
export function nameEntryWidgetsBind(
    mem: NameKeyboardMemory,
    obj: number,
    ui: number,
    show: number,
    host: NameKeyboardHost,
    L: NameKeyboardLayout = NAME_SCREEN_LAYOUT,
): void {
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = () => host.languageBank((mem.read32(NAME_LANGUAGE_CELL) | 0) + 0x86);
    if (show !== 0) {
        host.callMethod(at(0), 0x114, [bank(), 1]);
        host.callMethod(at(4), 0x110, [obj + SLOTS]);
        host.callMethod(at(4), 0x138, [1]);
        for (let i = 0; i < 3; i++) {
            const label = mem.read32(
                (mem.read32(L.t.pageStruct + 4) | 0) + (mem.read32(obj + L.f.page) | 0) * 0xc + i * 4,
            ) | 0;
            host.callMethod(at(8 + i * 4), 0x114, [bank(), label]);
            host.callMethod(at(8 + i * 4), 0x138, [1]);
        }
        host.callMethod(at(0x20), 0x114, [bank(), 0xd]);
        host.callMethod(at(0x20), 0x138, [1]);
        host.callMethod(at(0x24), 0x114, [bank(), 0xe]);
        host.callMethod(at(0x24), 0x138, [1]);
        if ((mem.read32(L.t.pageStruct) | 0) >= 2) {
            host.callMethod(at(0x28), 0x114, [bank(), 0x10]);
            host.callMethod(at(0x28), 0x138, [1]);
            host.callMethod(at(0x2c), 0x114, [bank(), 0x11]);
            host.callMethod(at(0x2c), 0x138, [1]);
        }
        return;
    }
    host.callMethod(at(0), 0x144, [0]);
    host.callMethod(at(4), 0x144, [0]);
    for (let i = 0; i < 3; i++) host.callMethod(at(8 + i * 4), 0x144, [0]);
    host.callMethod(at(0x20), 0x144, [0]);
    host.callMethod(at(0x24), 0x144, [0]);
    host.callMethod(at(0x28), 0x144, [0]);
    host.callMethod(at(0x2c), 0x144, [0]);
}

/** F0x80085078(obj, ui): first-frame setup, then type and draw each frame. */
export function nameEntryTick(
    mem: NameKeyboardMemory,
    obj: number,
    ui: number,
    host: NameKeyboardHost,
    L: NameKeyboardLayout = NAME_SCREEN_LAYOUT,
): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        nameKeyboardTick(mem, obj, ui, host, L);
        nameKeyboardDraw(mem, obj, host, L);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    host.gpuInit();
    host.gpu24(mem.read32(obj + 0x5c) | 0, mem.read32(obj + 0x60) | 0);
    host.gpu2C(host.packHandle(0x07710000));
    if ((mem.read32(NAME_LANGUAGE_CELL) | 0) === 0) {
        mem.write32(L.t.pageStruct, 3);
        mem.write32(L.t.pageStruct + 4, L.t.lang0.labels | 0);
        mem.write32(L.t.pageStruct + 8, L.t.lang0.grid | 0);
    } else {
        mem.write32(L.t.pageStruct, 1);
        mem.write32(L.t.pageStruct + 4, L.t.other.labels | 0);
        mem.write32(L.t.pageStruct + 8, L.t.other.grid | 0);
    }
    mem.write32(obj + L.f.foldInit, 0xa);
    mem.write32(obj + L.f.foldMsg, 0xa);
    mem.write32(obj + L.f.foldOpen, 0xa);
    nameEntryWidgetsBuild(mem, obj, ui, host, L);
}

const BTN_START = 3;
const BTN_RIGHT = 5;
const BTN_LEFT = 7;
const BTN_UP = 4;
const BTN_DOWN = 6;
const BTN_PAGE_PREV = 0xa;
const BTN_PAGE_NEXT = 0xb;
const BTN_OK = 0xd;
const BTN_BACK = 0xe;
const SFX_MOVE = 0x4001b;
const SFX_OK = 0x4001c;
const SFX_BACK = 0x800450bd;

const KEY_LEFT_ARROW = 0x64;
const KEY_RIGHT_ARROW = 0x65;
const KEY_DEL = 0x46;
const KEY_SPC = 0x55;
const KEY_OK = 0x67;

/** F0x80084318(obj, ui): the typing state machine. */
export function nameKeyboardTick(
    mem: NameKeyboardMemory,
    obj: number,
    ui: number,
    host: NameKeyboardHost,
    L: NameKeyboardLayout = NAME_SCREEN_LAYOUT,
): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    const pressed = (code: number) => bit(host.padPressed(0), code) !== 0;
    const pressedOrRepeat = (code: number) => pressed(code) || bit(host.padRepeat(0), code) !== 0;
    const grid = () => mem.read32(L.t.pageStruct + 8) | 0;
    const cell = (page: number, index: number, part = 0) => grid() + page * 0xd2 + index * 2 + part;
    const advance = () => w(0x10, r(0x10) + 1);
    const ui4 = () => mem.read32(ui + 4) | 0;
    const glyphTable = () => mem.read32(ui4() + 0x50) | 0;
    const blankGlyph = () =>
        mem.read16((mem.read32(glyphTable() + 0x10) | 0) + 4);

    switch (r(0x10)) {
        default:
            host.foldStart(obj + L.f.foldOpen, 1);
            advance();
            return;
        case 1:
            if (host.foldTick(obj + L.f.foldOpen) !== 0) {
                nameEntryWidgetsBind(mem, obj, ui, 1, host, L);
                w(L.f.cursorOn, 1);
                advance();
            }
            return;
        case 0xa:
            nameEntryWidgetsBind(mem, obj, ui, 0, host, L);
            host.foldStart(obj + L.f.foldOpen, 0);
            w(L.f.cursorOn, 0);
            advance();
            return;
        case 0xb:
            if (host.foldTick(obj + L.f.foldOpen) !== 0) w(0xc, 2);
            return;
        case 0x14:
            w(L.f.cursorOn, 0);
            host.foldStart(obj + L.f.foldMsg, 1);
            advance();
            return;
        case 0x15:
            if (host.foldTick(obj + L.f.foldMsg) !== 0) {
                host.callMethod(mem.read32(ui + 0x30) | 0, 0x114, [
                    host.languageBank((mem.read32(NAME_LANGUAGE_CELL) | 0) + 0x86),
                    0x12,
                ]);
                advance();
            }
            return;
        case 0x16:
            if (pressed(BTN_OK)) {
                host.callMethod(mem.read32(ui + 0x30) | 0, 0x144, [0]);
                host.foldStart(obj + L.f.foldMsg, 0);
                advance();
            }
            return;
        case 0x17:
            if (host.foldTick(obj + L.f.foldMsg) !== 0) {
                w(L.f.cursorOn, 1);
                w(0x10, 2);
            }
            return;
        case 2:
            break;
    }

    // State 2: typing.
    if (pressed(BTN_START)) {
        host.playSound(SFX_MOVE);
        w(L.f.col, 0xd);
        w(L.f.row, 6);
        return;
    }
    if ((mem.read32(L.t.pageStruct) | 0) >= 2) {
        const before = r(L.f.page);
        const heldNext = bit(host.padHeld(0), BTN_PAGE_NEXT) !== 0;
        let prev = false;
        if (!heldNext) prev = pressed(BTN_PAGE_PREV);
        if (!heldNext && prev) {
            w(L.f.page, r(L.f.page) - 1);
            if (r(L.f.page) < 0) w(L.f.page, (mem.read32(L.t.pageStruct) | 0) - 1);
        } else {
            const heldPrev = bit(host.padHeld(0), BTN_PAGE_PREV) !== 0;
            if (!heldPrev && pressed(BTN_PAGE_NEXT)) {
                w(L.f.page, r(L.f.page) + 1);
                if (((mem.read32(L.t.pageStruct) | 0) - 1) < r(L.f.page)) w(L.f.page, 0);
            }
        }
        if (before !== r(L.f.page)) {
            host.playSound(SFX_MOVE);
            nameEntryWidgetsBind(mem, obj, ui, 1, host, L);
            if ((mem.read32(NAME_LANGUAGE_CELL) | 0) === 0) {
                const page = r(L.f.page);
                if (page >>> 0 < 2) {
                    const rowBase = r(L.f.row) * 0x1e;
                    let col = r(L.f.col);
                    if (s8(mem.read8(grid() + page * 0xd2 + col * 2 + rowBase)) !== 1) {
                        let v = col - 1;
                        do {
                            w(L.f.col, v);
                            if (v < 0) w(L.f.col, 0xe);
                            col = r(L.f.col);
                            v = col - 1;
                        } while (s8(mem.read8(grid() + page * 0xd2 + col * 2 + rowBase)) !== 1);
                    }
                } else {
                    const colBytes = r(L.f.col) * 2;
                    let row = r(L.f.row);
                    if (s8(mem.read8(grid() + page * 0xd2 + colBytes + row * 0x1e)) === 0) {
                        let v = row - 1;
                        do {
                            w(L.f.row, v);
                            if (v < 0) w(L.f.row, 6);
                            row = r(L.f.row);
                            v = row - 1;
                        } while (s8(mem.read8(grid() + page * 0xd2 + colBytes + row * 0x1e)) === 0);
                    }
                }
            }
        }
    }

    const cellType = () => s8(mem.read8(cell(r(L.f.page), r(L.f.row) * 0xf + r(L.f.col))));
    if (pressedOrRepeat(BTN_LEFT)) {
        const t = cellType();
        if (t < 0) w(L.f.col, r(L.f.col) + t);
        do {
            w(L.f.col, r(L.f.col) - 1);
            if (r(L.f.col) < 0) w(L.f.col, 0xe);
        } while (cellType() !== 1);
        host.playSound(SFX_MOVE);
    } else if (pressedOrRepeat(BTN_RIGHT)) {
        const t = cellType();
        if (t < 0) w(L.f.col, r(L.f.col) + t);
        do {
            w(L.f.col, r(L.f.col) + 1);
            if (r(L.f.col) >= 0xf) w(L.f.col, 0);
        } while (cellType() !== 1);
        host.playSound(SFX_MOVE);
    }
    if (pressedOrRepeat(BTN_UP)) {
        do {
            w(L.f.row, r(L.f.row) - 1);
            if (r(L.f.row) < 0) w(L.f.row, 6);
        } while (cellType() === 0);
        host.playSound(SFX_MOVE);
    } else if (pressedOrRepeat(BTN_DOWN)) {
        do {
            w(L.f.row, r(L.f.row) + 1);
            if (r(L.f.row) >= 7) w(L.f.row, 0);
        } while (cellType() === 0);
        host.playSound(SFX_MOVE);
    }

    const putGlyph = (glyph: number): void => {
        mem.write16(obj + r(0x90) * 2 + SLOTS, swap16(glyph));
    };
    const refreshText = (): void => host.callMethod(ui4(), 0x110, [obj + SLOTS]);
    const step = (): number => {
        const next = r(0x90) + 1;
        const lim = r(0x94) - 1;
        w(0x90, next);
        return lim - next; // negative when past the last slot
    };
    const del = (): void => {
        const at = r(0x90);
        if (r(0x94) - 1 >= at) {
            if (mem.read16(obj + at * 2 + SLOTS) === BLANK) {
                w(0x90, at - 1);
                if (r(0x90) < 0) w(0x90, 0);
            }
        }
        putGlyph(blankGlyph());
        refreshText();
    };

    if (pressed(BTN_OK)) {
        const col = r(L.f.col);
        const page = r(L.f.page);
        const base = page * 0xd2 + grid();
        // The origin search: walk left from the cursor until a key-start cell.
        let step0 = 0;
        {
            let a1 = 0;
            let idx = col * 2;
            for (;;) {
                a1 -= 1;
                if (s8(mem.read8(base + idx + r(L.f.row) * 0x1e)) !== 1) {
                    idx = (col + a1) * 2;
                    continue;
                }
                break;
            }
            step0 = a1 + 1;
        }
        const key = r(L.f.row) * 0xf + r(L.f.col) + step0;
        host.playSound(SFX_OK);
        switch (key) {
            case KEY_LEFT_ARROW:
                w(0x90, r(0x90) - 1);
                if (r(0x90) < 0) w(0x90, 0);
                return;
            case KEY_RIGHT_ARROW:
                w(0x90, r(0x90) + 1);
                if (r(0x94) - 1 < r(0x90)) w(0x90, r(0x94) - 1);
                return;
            case KEY_SPC: {
                putGlyph(blankGlyph());
                if (step() < 0) w(0x90, r(0x94) - 1);
                refreshText();
                return;
            }
            case KEY_OK: {
                let found = false;
                for (let i = 0; i < r(0x94); i++) {
                    const c = mem.read16(obj + i * 2 + SLOTS);
                    if (c !== BLANK && c !== 0) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    w(0x10, 0x14);
                    return;
                }
                for (let j = 19; j >= 0; j--) {
                    if (mem.read16(obj + j * 2 + SLOTS) !== BLANK) break;
                    mem.write16(obj + j * 2 + SLOTS, 0);
                }
                w(0x10, 0x64);
                return;
            }
            case KEY_DEL:
                del();
                return;
            default: {
                const glyphIndex = mem.read8(cell(r(L.f.page), r(L.f.row) * 0xf + r(L.f.col), 1));
                const code = mem.read16((mem.read32(glyphTable() + 0xc) | 0) + glyphIndex * 4);
                putGlyph(code);
                refreshText();
                if (step() < 0) {
                    w(L.f.col, 0xd);
                    w(0x90, r(0x94) - 1);
                    w(L.f.row, 6);
                }
                return;
            }
        }
    }
    if (bit(host.padPressed(0), BTN_BACK) !== 0) {
        host.playSound(SFX_BACK);
        del();
    }
}

/** F0x80083994(obj): draw the keyboard, cursor and hint sprites. */
export function nameKeyboardDraw(
    mem: NameKeyboardMemory,
    obj: number,
    host: NameKeyboardHost,
    L: NameKeyboardLayout = NAME_SCREEN_LAYOUT,
): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const lang = () => mem.read32(NAME_LANGUAGE_CELL) | 0;
    const pack = () => host.packHandle(0x07700000);
    host.drawInit();
    host.draw74(r(0x5c), r(0x60));
    host.draw7C(r(0x54), r(0x58));
    if (r(L.f.scale) !== 0) {
        if (r(L.f.cursorOn) !== 0) {
            if (host.frameCount() - r(L.f.blinkTime) >= 5) {
                w(L.f.blinkTime, host.frameCount());
                w(L.f.blinkFrame, r(L.f.blinkFrame) + 1);
                if (r(L.f.blinkFrame) >= 4) w(L.f.blinkFrame, 0);
            }
            host.draw88(r(L.f.blinkFrame));
            const col = r(L.f.col);
            let handle: number;
            let clip: number;
            let x: number;
            let y: number;
            const row = r(L.f.row);
            if (col >= 0xa && row >= 3) {
                const page = r(L.f.page);
                let a1 = 0;
                let idx = col * 2;
                for (;;) {
                    a1 -= 1;
                    if (s8(mem.read8(page * 0xd2 + (mem.read32(L.t.pageStruct + 8) | 0) + idx + row * 0x1e)) !== 1) {
                        idx = (col + a1) * 2;
                        continue;
                    }
                    break;
                }
                const start = a1 + 1;
                const key = r(L.f.col) + start + r(L.f.row) * 0xf;
                let entry = 0;
                switch (key) {
                    case 0x65:
                        entry = 1;
                        break;
                    case 0x46:
                        entry = 2;
                        mem.write32(L.t.wideKeys + 0x18, lang() + 0x3c);
                        break;
                    case 0x55:
                        entry = 3;
                        mem.write32(L.t.wideKeys + 0x24, lang() + 0x44);
                        break;
                    case 0x67:
                        entry = 4;
                        mem.write32(L.t.wideKeys + 0x30, lang() + 0x4c);
                        break;
                    default:
                        entry = 0;
                }
                const e = L.t.wideKeys + entry * 0xc;
                clip = mem.read32(e) | 0;
                x = mem.read32(e + 4) | 0;
                y = mem.read32(e + 8) | 0;
                handle = pack();
            } else {
                handle = pack();
                clip = 0x27;
                y = row * 0x12 + 0x5a;
                x = col * 0xe + (Math.trunc(col / 5) * 8 + 0x2f);
            }
            host.drawSprite(handle, clip, x, y);
            host.drawSprite(pack(), 0x28, r(0x90) * 0x13 + 0x4b, 0x40);
            host.draw88(0);
        }
        if (r(L.f.scale) !== 0x1000) {
            host.draw8C(r(L.f.scale), 0x1000, 0x1000);
            if (r(L.f.scale) !== 0x1000) host.draw94(0x18, 0x20);
        }
        host.drawSprite(pack(), 0x1d, 0x18, 0x15);
        if (r(0x50) !== 2) {
            if (r(L.f.scale) !== 0x1000) host.draw94(0x20, 0x3f);
            let handle: number;
            let clip: number;
            let x: number;
            let y: number;
            if (r(0x64) !== -1) {
                if (host.frameCount() - r(0x6c) >= 0xd) {
                    w(0x6c, host.frameCount());
                    const n = r(0x68) + 1;
                    w(0x68, n);
                    if (n >= 7 || (mem.read32(L.t.hint + (r(0x64) * 7 + n) * 4) | 0) === -1) w(0x68, 0);
                }
                handle = pack();
                x = 0x22;
                clip = mem.read32(L.t.hint + (r(0x64) * 7 + r(0x68)) * 4) | 0;
                y = 0x30;
            } else {
                handle = pack();
                clip = 0x36;
                x = 0x20;
                y = 0x2e;
            }
            host.drawSprite(handle, clip, x, y);
            if (host.frameCount() - r(0x74) >= 5) {
                w(0x74, host.frameCount());
                w(0x70, r(0x70) + 1);
                if (r(0x70) >= 0xe) w(0x70, 0);
            }
            host.draw7C(r(0x54), r(0x58) - 1);
            host.draw88(r(0x70));
            host.drawSprite(pack(), 0x1f, 0x20, 0x2e);
            host.draw88(0);
            host.draw7C(r(0x54), r(0x58));
            host.drawSprite(pack(), 0x1e, 0x20, 0x2e);
        }
        if (r(L.f.scale) !== 0x1000) host.draw94(0x20, 0x49);
        let a1: number;
        if (r(0x50) !== 2) a1 = lang() === 0 ? 0x34 : 0x37;
        else a1 = 0x35;
        host.drawSprite(pack(), a1, 0x4b, 0x40);
        if (r(L.f.scale) !== 0x1000) host.draw8C(0x1000, r(L.f.scale), 0x1000);
        if ((mem.read32(L.t.pageStruct) | 0) >= 2) {
            if (host.frameCount() - r(L.f.arrowTime) >= 7) {
                w(L.f.arrowTime, host.frameCount());
                w(L.f.arrowFrame, r(L.f.arrowFrame) + 1);
                if (r(L.f.arrowFrame) >= 6) w(L.f.arrowFrame, 0);
            }
            host.draw88(mem.read32(L.t.arrowFrames + r(L.f.arrowFrame) * 4) | 0);
            host.drawSprite(pack(), 0x32, 0xa, 0x5e);
            host.drawSprite(pack(), 0x33, 0x119, 0x5e);
            host.draw88(0);
        }
        host.draw88(4);
        host.drawSprite(pack(), 0x2c, 0xcb, 0xc3);
        host.drawSprite(pack(), 0x2d, 0xde, 0xc3);
        host.drawSprite(pack(), lang() + 0x3c, 0xcb, 0x99);
        host.drawSprite(pack(), lang() + 0x44, 0xcb, 0xae);
        host.drawSprite(pack(), lang() + 0x4c, 0xf6, 0xc3);
        host.draw88(0);
        host.drawSprite(pack(), 0x25, 0x1d, 0x54);
    }
    host.draw7C(r(0x54), r(0x58) - 1);
    const e8 = r(L.f.overlay);
    if (e8 !== 0) {
        if (e8 !== 0x1000) {
            host.draw8C(0x1000, e8, 0x1000);
            host.draw94(0, 0x78);
        }
        host.drawSprite(pack(), 0x26, 0, 0x64);
    }
}
