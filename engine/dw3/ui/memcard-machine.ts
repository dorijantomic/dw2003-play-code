// The memory-card save/load screen's state machine, translated from
// pro/stgmcard F0x80084DCC (9624 bytes, 38 states).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/memcard-machine-oracle.test.js runs the original through
// engine/native on the shipped pro_stgmcard.bin + resident.bin with every
// widget, card, board, sound and pad service stubbed, state by state, and
// compares the ordered calls and the touched memory.
//
// DECODED: authority-2 `exe-decomp/stgmcard_c/_asm/F0x80084dcc.s` and the
// accepted `stgmcard-machine-contract`. See also
// docs/research/ui/symbols/stgmcard.md for the helper names.
//
// Player-visible result: a window slides open over the memory-card screen; its
// header says SAVE or LOAD, the strip SAVING or LOADING. The player picks card
// slot 1 or 2 with Up/Down, Cross opens the slot transition and the block grid,
// the save path writes the summary block and asks "Save here?", the load path
// checks the card ("No data here." / "LOADING."), and the outcome strip reports
// "Saved." / "LOADED." / "Formatting..." / "Saving file..." before the screen
// closes. The dispatch is an if/else chain over screen+0x10 (no jump table); the
// default opens the window and falls through into state 1.
//
// Argument roles: $a0 = the screen object, $a1 = the widget block, $a2 = the
// caller's default widget-line count (only the default handler's +0x15C call
// reads it). Advance is always a re-read of screen+0x10 plus one, so the default
// handler's increment and state 1's own increment compose (0 -> 2 in one tick
// when the opening tween has already finished).

import { strcpyBytes } from "../byte-ops.ts";

export interface MemcardMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface MemcardHost {
    /** `[0x8008879C]`(obj): the fold tween tick, nonzero while still running. */
    tweenTick(obj: number): number;
    /** `[0x80044F4C](language + offset): the text-bank handle. */
    bankGet(id: number): number;
    /** `[0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** `[0x8004B7D0]+0x3F4`(port): the buttons held this frame. */
    padPressed(port: number): number;
    /** `[0x8004B7D0]+0x3FC`(port): the buttons auto-repeating. */
    padRepeat(port: number): number;
    /** `[0x8004B7D0]+0x408`(port, code): the keymap shift for a button. */
    padKey(port: number, code: number): number;
    /** Any sub-object method: `object+slot(object, ...args)`. */
    widgetCall(widget: number, slot: number, args: number[]): number;
    /** The screen's own method: `screen+slot(screen, ...args)`. */
    screenCall(screen: number, slot: number, args: number[]): number;
    /** F0x80083B6C(screen): build the save-file card panel. */
    createSaveCard(screen: number): number;
    /** F0x80084058(a, b, c, d): build the slot-transition object. */
    createSlotTransition(a: number, b: number, c: number, d: number): number;
    /** F0x80084A80(screen, widgets, flag): the slot caption / hide helper. */
    messageSlotCaption(screen: number, widgets: number, flag: number): void;
    /** F0x80084B20(screen, widgets): the full teardown. */
    memcardTeardown(screen: number, widgets: number): void;
    /** F0x80084BF8(screen, widgets): the between-steps hide. */
    memcardHideStep(screen: number, widgets: number): void;
    /** `[0x8004B600](dst, bytes): zero fill. */
    memZero(dst: number, bytes: number): void;
    /** `[[0x80048750]+0x334]` = `0x80048A84`(handle): the list/selection status. */
    cardStatusList(handle: number): number;
    /** `[0x80048A88]`(handle): the first card status service. */
    cardStatusA(handle: number): number;
    /** `[0x80048A94]`(handle): the second card status service. */
    cardStatusB(handle: number): number;
    /** `[0x80048A9C]`(handle): the third card status service. */
    cardStatusC(handle: number): number;
    /** `[0x80048A98]`(handle): the fourth card status service. */
    cardStatusD(handle: number): number;
    /**
     * `[0x80048A8C]` = `[[0x80048750]+0x33C]`(handle, buf, len, arg): the card
     * transfer slot state 0x15 reads the 0xD4-byte header through and state 0x47
     * writes the 0x26C4-byte block through (one service; the direction is the
     * card's own state).
     */
    cardService33c(handle: number, buf: number, len: number, arg: number): number;
    /**
     * `[0x80048A90]` = `[[0x80048750]+0x340]`(handle, buf, len, arg): the card
     * transfer slot states 0x34/0x35/0x7c read a block through and 0x7A/0x7B
     * read one file through.
     */
    cardService340(handle: number, buf: number, len: number, arg: number): number;
    /** `[0x80048AA8]`(buf, len): the block checksum. */
    checksum(buf: number, len: number): number;
    /** `[0x80048750]+0x314`: the card's file count. */
    cardFileCount(): number;
    /** `[0x80048750]+0x318`: the file table base. */
    cardFileTable(): number;
    /** `[0x80048750]+0x324`: the current file index. */
    cardFileIndex(): number;
    /** `[0x80048750]+0x324 = value`. */
    setCardFileIndex(value: number): void;
    /** `[0x80048750]+0xA4`(buf, recordLen): enumerate the card's files. */
    cardEnumerate(buf: number, recordLen: number): number;
    /** `[0x80048750]+0xC0`: the card's free-block word. */
    cardFreeBlocks(): number;
    /** `[0x80048D34]+0x2718`(index): party position -> roster slot. */
    rosterSlot(index: number): number;
}

/** The screen's own fields. */
export const MEMCARD = {
    state: 0x10,
    queued: 0x14,
    scratch: 0x18,
    handler30: 0x30,
    handler3c: 0x3c,
    sub: 0x50,
    originX: 0x58,
    originY: 0x5c,
    handle: 0x64,
    result: 0x68,
    box: 0x6c,
    fold: 0x74,
    row: 0x2804,
    foldX: 0x2810,
    tween: 0x2824,
    foldY: 0x282c,
    confirmLatch: 0x2840,
    cursorVisible: 0x284c,
    afterLoad: 0x2850,
    acceptSlot: 0x2854,
    refreshCard: 0x2858,
} as const;

/** The widget block's slots. */
export const MEMCARD_W = {
    header: 0x00,
    body: 0x04,
    strip: 0x08,
    yes: 0x0c,
    no: 0x10,
    line: 0x14,
    cursor: 0x18,
    transition: 0x1c,
    blockView: 0x20,
    saveCard: 0x24,
} as const;

/** The methods the machine drives on those sub-objects. */
export const MEMCARD_M = {
    cursorEnabled: 0x80,
    cursorPos: 0x84,
    panelRefresh: 0x8c,
    panelMode: 0x88,
    setLine: 0x114,
    setNumber: 0x118,
    setPos: 0x134,
    setVisible: 0x144,
    setMax: 0x15c,
    slotReset: 0xc4,
    slotPlay: 0xc8,
    slotRectA: 0xcc,
    slotRectB: 0xd0,
    blockReset: 0xdc,
    blockStep: 0xe0,
    blockDir: 0xe4,
    blockAwait: 0xe8,
    blockApply: 0xec,
    blockCancel: 0xf0,
} as const;

/** The shared staging block and the other globals. */
export const MEMCARD_STAGE = 0x80088768;
export const MEMCARD_HEADER_PTR = 0x80088774;
export const MEMCARD_STAGING_PTR = 0x80088778;
export const MEMCARD_LANGUAGE = 0x8005cca8;
export const MEMCARD_BLOCK_SIZE = 0x26c4;
export const MEMCARD_CHECKSUM_LEN = 0x26c0;
export const MEMCARD_RECORD_SIZE = 0xd0;
/** The header/record transfer length ($a2 = 0xD4). */
export const MEMCARD_HEADER_SIZE = 0xd4;
export const MEMCARD_TAG = 0x33574d44;
export const MEMCARD_FORMAT = 4;
export const MEMCARD_SLOT_STRIDE = 0x44;
export const MEMCARD_RESULT_TABLE = 0x80088310;
export const MEMCARD_CARD_STRUCT = 0x80048750;
export const MEMCARD_CARD_BASE = 0x80048d34;
/** The card-service struct's slots (0x80048750 + off). */
export const MEMCARD_SVC = {
    statusList: 0x334,
    statusA: 0x338,
    transfer33c: 0x33c,
    transfer340: 0x340,
    statusB: 0x344,
    statusD: 0x348,
    statusC: 0x34c,
    checksum: 0x358,
} as const;
export const MEMCARD_FILE_TABLE = 0x80048760;
export const MEMCARD_MEMBER_STRIDE = 0x3dc;
/** The sounds the machine plays. */
export const MEMCARD_SOUND_SELECT = 0x8004513e;
export const MEMCARD_SOUND_CONFIRM = 0x8004503c;
export const MEMCARD_SOUND_BACK = 0x800450bd;
export const MEMCARD_SOUND_STEP = 0x4001c;
/** The button codes the machine tests. */
export const MEMCARD_BUTTON_UP = 4;
export const MEMCARD_BUTTON_DOWN = 6;
export const MEMCARD_BUTTON_CONFIRM = 0xd;
export const MEMCARD_BUTTON_CANCEL = 0xe;

const s16 = (v: number): number => (v << 16) >> 16;

/**
 * F0x80084DCC(screen, widgets, arg2): one tick of the memory-card screen.
 */
export function memcardStateMachine(
    mem: MemcardMemory,
    screen: number,
    widgets: number,
    arg2: number,
    host: MemcardHost,
): void {
    const w = (slot: number): number => mem.read32(widgets + slot) >>> 0;
    const sub = (): number => mem.read32(screen + MEMCARD.sub) >>> 0;
    const subField = (off: number): number => mem.read32(sub() + off) | 0;
    // The 0xD0-byte record copy target is the screen object's own +0x6C block,
    // not the pointer stored there (0x16/0x1F4/0x7B all copy into it).
    const box = (): number => (screen + MEMCARD.box) | 0;
    const header = (): number => mem.read32(MEMCARD_HEADER_PTR) >>> 0;
    const staging = (): number => mem.read32(MEMCARD_STAGING_PTR) >>> 0;
    const trans = (): number => w(MEMCARD_W.transition);
    const view = (): number => w(MEMCARD_W.blockView);
    const cursor = (): number => w(MEMCARD_W.cursor);
    const stageRec = (index: number): number =>
        (mem.read32(MEMCARD_STAGE + 0x0c) + Math.imul(index, MEMCARD_SLOT_STRIDE)) >>> 0;
    const bank = (offset: number): number => host.bankGet((mem.read32(MEMCARD_LANGUAGE) | 0) + offset);
    const wcall = (obj: number, slot: number, ...args: number[]): void => { host.widgetCall(obj, slot, args); };
    const setLine = (slot: number, id: number): void => {
        host.widgetCall(w(slot), MEMCARD_M.setLine, [bank(0x78), id | 0]);
    };
    const setVisible = (slot: number, value: number): void => {
        host.widgetCall(w(slot), MEMCARD_M.setVisible, [value | 0]);
    };
    const advance = (by = 1): void => {
        mem.write32(screen + MEMCARD.state, ((mem.read32(screen + MEMCARD.state) | 0) + by) | 0);
    };
    const padHeld = (code: number): boolean =>
        (((host.padPressed(0) | 0) >> host.padKey(0, code)) & 1) !== 0;
    const padEdge = (code: number): boolean => {
        if (padHeld(code)) return true;
        return (((host.padRepeat(0) | 0) >> host.padKey(0, code)) & 1) !== 0;
    };
    const mode = (): number => subField(0x50);
    const hideStrip = (): void => {
        setLine(MEMCARD_W.strip, 0x19);
    };
    const showRowCursor = (row: number): void => {
        host.widgetCall(cursor(), MEMCARD_M.cursorEnabled, [1]);
        mem.write32(screen + MEMCARD.cursorVisible, 1);
        host.widgetCall(cursor(), MEMCARD_M.cursorPos, [0xc2, (Math.imul(row, 0x0e) + 0xbd) | 0]);
    };
    const cardStatus = (): number => host.cardStatusA(mem.read32(screen + MEMCARD.handle) | 0) | 0;
    const failTail = (): void => {
        mem.write32(screen + MEMCARD.confirmLatch, 0);
        mem.write32(screen + MEMCARD.result, 1);
        host.memcardHideStep(screen, widgets);
    };
    /** The 0x438C swap: state = queued, queued = scratch, scratch = 0. */
    const swapState = (): void => {
        const next = mem.read32(screen + MEMCARD.queued) | 0;
        const scratch = mem.read32(screen + MEMCARD.scratch) | 0;
        mem.write32(screen + MEMCARD.scratch, 0);
        mem.write32(screen + MEMCARD.state, next);
        mem.write32(screen + MEMCARD.queued, scratch);
    };

    /** States 0x14 (always) and 0x15 (on entry) share this body. */
    const state15Body = (): void => {
        const r = host.cardService33c(mem.read32(screen + MEMCARD.handle) | 0,
            header(), MEMCARD_HEADER_SIZE, 1) | 0;
        mem.write32(screen + MEMCARD.result, r | 0);
        if (r === 0) return;
        host.widgetCall(trans(), MEMCARD_M.slotPlay, [2, 0x14]);
        advance();
    };

    /** States 0x5a and 0x258 share the block-view settle. */
    const blockSettle = (swapOnSettle: boolean): void => {
        if ((mem.read32(view() + MEMCARD.state) | 0) !== 0) return;
        const m = mem.read32(view() + MEMCARD_M.slotRectA) | 0;
        if (m === 2) {
            // 0x3068/0x30B0 mode 2: the save-card panel's +0x88 then the block
            // view's cancel.
            wcall(w(MEMCARD_W.saveCard), MEMCARD_M.panelMode);
            wcall(view(), MEMCARD_M.blockCancel);
            return;
        }
        if (m === 3) {
            wcall(view(), MEMCARD_M.blockAwait);
            if (swapOnSettle) swapState();
            else advance();
        }
    };

    const state = mem.read32(screen + MEMCARD.state) | 0;

    /** The opening: the default handler and state 1 share this body. */
    const openBody = (): void => {
        const placeHeader = (): void => {
            host.widgetCall(w(MEMCARD_W.header), MEMCARD_M.setPos, [
                (s16(mem.read16s(screen + MEMCARD.originX)) + (mem.read32(screen + MEMCARD.foldX) | 0) + 0xc8) | 0,
                (s16(mem.read16s(screen + MEMCARD.originY)) + (mem.read32(screen + MEMCARD.foldY) | 0) + 9) | 0,
            ]);
        };
        // 0x241C: the tween is ticked first; while it is still running the body
        // jumps straight to the header placement at 0x25EC.
        if ((host.tweenTick((screen + MEMCARD.tween) | 0) | 0) === 0) {
            placeHeader();
            return;
        }
        setVisible(MEMCARD_W.body, 0);
        setLine(MEMCARD_W.line, mode() === 0 ? 2 : 0x0f);
        host.widgetCall(w(MEMCARD_W.strip), MEMCARD_M.setMax, [1]);
        setLine(MEMCARD_W.strip, 0x1d);
        setLine(MEMCARD_W.yes, 3);
        host.widgetCall(w(MEMCARD_W.yes), MEMCARD_M.setNumber, [1, 1]);
        setLine(MEMCARD_W.no, 3);
        host.widgetCall(w(MEMCARD_W.no), MEMCARD_M.setNumber, [1, 2]);
        host.widgetCall(cursor(), MEMCARD_M.cursorEnabled, [1]);
        host.widgetCall(cursor(), MEMCARD_M.cursorPos,
            [0xc2, (Math.imul(mem.read32(screen + MEMCARD.handle) | 0, 0x0e) + 0xbd) | 0]);
        mem.write32(screen + MEMCARD.cursorVisible, 1);
        advance();
        placeHeader();
    };
    const openWindow = (): void => {
        host.widgetCall(w(MEMCARD_W.header), MEMCARD_M.setMax, [1]);
        setLine(MEMCARD_W.header, mode() === 0 ? 1 : 0x0e);
        if ((w(MEMCARD_W.saveCard) | 0) === 0) {
            mem.write32(widgets + MEMCARD_W.saveCard, host.createSaveCard(screen) >>> 0);
        }
        advance();
    };

    switch (state) {
        default:
            openWindow();
            openBody();
            return;

        case 1:
            openBody();
            return;

        case 2: {
            // The card-slot cursor lives in S+0x64, which is also the handle the
            // card services receive.
            let row = mem.read32(screen + MEMCARD.handle) | 0;
            if (padEdge(MEMCARD_BUTTON_UP)) row = 0;
            else if (padEdge(MEMCARD_BUTTON_DOWN)) row = 1;
            if (row !== (mem.read32(screen + MEMCARD.handle) | 0)) {
                mem.write32(screen + MEMCARD.handle, row | 0);
                host.widgetCall(cursor(), MEMCARD_M.cursorPos, [0xc2, (Math.imul(row, 0x0e) + 0xbd) | 0]);
                host.playSound(MEMCARD_SOUND_SELECT);
            }
            if (padHeld(MEMCARD_BUTTON_CONFIRM)) {
                setLine(MEMCARD_W.body, 4);
                host.messageSlotCaption(screen, widgets, 1);
                setVisible(MEMCARD_W.strip, 0);
                setVisible(MEMCARD_W.yes, 0);
                setVisible(MEMCARD_W.no, 0);
                host.widgetCall(cursor(), MEMCARD_M.cursorEnabled, [0]);
                if ((trans() | 0) === 0) {
                    mem.write32(widgets + MEMCARD_W.transition,
                        host.createSlotTransition(0xcd, 0xc1, 0x62, 0x0a) >>> 0);
                }
                host.widgetCall(trans(), MEMCARD_M.slotRectA, [0x7f, 0x32, 0xf2]);
                host.widgetCall(trans(), MEMCARD_M.slotRectB, [0xd1, 0x2f, 0xde]);
                mem.write32(screen + MEMCARD.state, 0x0a);
                host.playSound(MEMCARD_SOUND_CONFIRM);
                mem.write32(screen + MEMCARD.cursorVisible, 0);
                return;
            }
            if (padHeld(MEMCARD_BUTTON_CANCEL)) {
                host.playSound(MEMCARD_SOUND_BACK);
                host.screenCall(screen, MEMCARD.refreshCard, []);
                mem.write32(screen + MEMCARD.cursorVisible, 0);
                mem.write32(sub() + MEMCARD.queued, 1);
                return;
            }
            return;
        }

        case 0x0a: {
            if ((mem.read32(trans() + MEMCARD.state) | 0) === 0) {
                host.widgetCall(trans(), MEMCARD_M.slotPlay, [1, 0x4c]);
            }
            const r = cardStatus();
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            if (r === 1 || r === 4) { advance(); return; }
            host.widgetCall(trans(), MEMCARD_M.slotPlay, [2, 0x14]);
            advance(2);
            return;
        }

        case 0x0b: {
            const r = host.cardStatusB(mem.read32(screen + MEMCARD.handle) | 0) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            host.widgetCall(trans(), MEMCARD_M.slotPlay, [2, 0x14]);
            advance();
            return;
        }

        case 0x0c:
            // 0x29F4: no transfer object means return; a bad result tears down.
            if ((mem.read32(trans() + 0x68) | 0) === 0) return;
            if ((mem.read32(screen + MEMCARD.result) | 0) !== 1) {
                host.memcardTeardown(screen, widgets);
                return;
            }
            mem.write32(screen + MEMCARD.state, 0x14);
            return;

        case 0x14:
            if ((mem.read32(trans() + 0x68) | 0) !== 0) {
                setLine(MEMCARD_W.body, 5);
                host.messageSlotCaption(screen, widgets, 1);
                wcall(trans(), MEMCARD_M.slotReset);
                host.widgetCall(trans(), MEMCARD_M.slotPlay, [1, 0x4c]);
                advance();
            }
            // State 0x14 falls through into state 0x15's body either way.
            state15Body();
            return;

        case 0x15:
            state15Body();
            return;

        case 0x16: {
            if ((mem.read32(trans() + 0x68) | 0) === 0) return;
            if ((mem.read32(screen + MEMCARD.result) | 0) !== 1) {
                host.memcardTeardown(screen, widgets);
                return;
            }
            const record = header();
            const finish = (): void => {
                setVisible(MEMCARD_W.body, 0);
                setVisible(MEMCARD_W.line, 0);
                wcall(trans(), MEMCARD_M.slotReset);
                mem.write32(screen + MEMCARD.state, 0x1e);
            };
            if ((mem.read32(record + 4) | 0) !== MEMCARD_TAG) {
                // 0x2B34-0x2B48: initialise the record and jump straight to the
                // hide path; no copy and no stage byte are written.
                host.memZero(record, MEMCARD_SLOT_STRIDE);
                mem.write32(record + 4, MEMCARD_TAG >>> 0);
                mem.write16(record + 2, MEMCARD_FORMAT);
                finish();
                return;
            }
            const sum = host.checksum(record + 4, MEMCARD_RECORD_SIZE) | 0;
            // 0x2B70-0x2B8C: the bitwise test.
            if (((sum & ~(mem.read8(record) & 0xff)) & 0xff) !== 0) {
                mem.write32(screen + MEMCARD.result, 9);
                host.memcardTeardown(screen, widgets);
                return;
            }
            for (let i = 0; i < MEMCARD_RECORD_SIZE; i += 1) {
                mem.write8((box() + i) >>> 0, mem.read8(record + i));
            }
            mem.write32(MEMCARD_STAGE, mem.read8(record + 1) | 0);
            finish();
            return;
        }

        case 0x1e:
            setVisible(MEMCARD_W.body, 0);
            setVisible(MEMCARD_W.line, 0);
            if ((mem.read32(view() + MEMCARD_M.slotRectA) | 0) !== 5) wcall(view(), MEMCARD_M.blockReset);
            if ((w(MEMCARD_W.saveCard) | 0) !== 0) {
                host.widgetCall(w(MEMCARD_W.saveCard), MEMCARD_M.cursorPos, [0, arg2]);
            }
            advance();
            return;

        case 0x1f:
            if ((mem.read32(view() + MEMCARD.state) | 0) !== 0) return;
            // 0x2CC0: only mode 2 advances; modes 0/1 and the default return.
            switch (mem.read32(view() + MEMCARD_M.slotRectA) | 0) {
                case 0: wcall(view(), MEMCARD_M.blockStep); return;
                case 1: wcall(view(), MEMCARD_M.blockApply); return;
                case 2:
                    wcall(view(), MEMCARD_M.blockDir, mem.read32(MEMCARD_STAGE) | 0);
                    advance();
                    return;
                default: return;
            }

        case 0x20:
            if ((mem.read32(view() + MEMCARD.state) | 0) !== 6) return;
            setLine(MEMCARD_W.strip, mode() === 0 ? 6 : 0x10);
            mem.write32(w(MEMCARD_W.saveCard) + 0x5c, 1);
            mem.write32(w(MEMCARD_W.saveCard) + 0x60, 1);
            wcall(w(MEMCARD_W.saveCard), MEMCARD_M.panelRefresh);
            host.screenCall(screen, MEMCARD.handler3c, []);
            mem.write32(view() + MEMCARD.state, 6);
            return;

        case 0x21: {
            if ((mem.read32(view() + MEMCARD.state) | 0) !== 6) return;
            if (padHeld(MEMCARD_BUTTON_CONFIRM)) {
                host.playSound(MEMCARD_SOUND_STEP);
                mem.write32(screen + MEMCARD.state, 0x190);
                mem.write32(view() + MEMCARD.state, 0);
                if (mode() !== 0) {
                    mem.write32(screen + MEMCARD.queued, 0x46);
                    return;
                }
                const record = (header() + Math.imul(mem.read32(MEMCARD_STAGE + 0x04) | 0, 0x44)) >>> 0;
                if ((mem.read32(record + 8) | 0) === 0) {
                    mem.write32(screen + MEMCARD.queued, 0x32);
                    mem.write32(screen + MEMCARD.state, 0x32);
                    return;
                }
                setLine(MEMCARD_W.strip, 7);
                setLine(MEMCARD_W.yes, 0x16);
                setLine(MEMCARD_W.no, 0x17);
                showRowCursor(mem.read32(screen + MEMCARD.row) | 0);
                // The dispatch sets $s4 = 0x28 for the state-0x28 comparison
                // before this target is reached, so the queued state is 0x28.
                mem.write32(screen + MEMCARD.queued, 0x28);
                mem.write32(screen + MEMCARD.row, 0);
                mem.write32(screen + MEMCARD.cursorVisible, 1);
                return;
            }
            if (padHeld(MEMCARD_BUTTON_CANCEL)) {
                host.playSound(MEMCARD_SOUND_BACK);
                mem.write32(view() + MEMCARD.state, 0);
                mem.write32(screen + MEMCARD.state, 0x5a);
                mem.write32(screen + MEMCARD.queued, 1);
                return;
            }
            const r = host.cardStatusList(mem.read32(screen + MEMCARD.handle) | 0) | 0;
            if (r === 0 || r === 1) return;
            host.memcardHideStep(screen, widgets);
            return;
        }

        case 0x28: {
            let row = mem.read32(screen + MEMCARD.row) | 0;
            if (padEdge(MEMCARD_BUTTON_UP)) row = 0;
            else if (padEdge(MEMCARD_BUTTON_DOWN)) row = 1;
            if (row !== (mem.read32(screen + MEMCARD.row) | 0)) {
                mem.write32(screen + MEMCARD.row, row | 0);
                host.widgetCall(cursor(), MEMCARD_M.cursorPos, [0xc2, (Math.imul(row, 0x0e) + 0xbd) | 0]);
                host.playSound(MEMCARD_SOUND_SELECT);
            }
            const answer = (): void => {
                setVisible(MEMCARD_W.yes, 0);
                setVisible(MEMCARD_W.no, 0);
                host.widgetCall(cursor(), MEMCARD_M.cursorEnabled, [0]);
            };
            if (padHeld(MEMCARD_BUTTON_CONFIRM)) {
                answer();
                host.playSound(MEMCARD_SOUND_CONFIRM);
                mem.write32(screen + MEMCARD.state, 0x190);
                mem.write32(screen + MEMCARD.cursorVisible, 0);
                if (row === 0) {
                    mem.write32(screen + MEMCARD.queued, 0x32);
                } else {
                    mem.write32(screen + MEMCARD.queued, 0x20);
                    mem.write32(view() + MEMCARD.state, 6);
                }
                return;
            }
            if (padHeld(MEMCARD_BUTTON_CANCEL)) {
                answer();
                host.playSound(MEMCARD_SOUND_BACK);
                mem.write32(screen + MEMCARD.state, 0x190);
                mem.write32(screen + MEMCARD.queued, 0x20);
                mem.write32(view() + MEMCARD.state, 6);
                return;
            }
            const r = cardStatus();
            if (r !== 0 && r !== 1) {
                answer();
                host.memcardHideStep(screen, widgets);
            }
            return;
        }

        case 0x32:
            setLine(MEMCARD_W.strip, 8);
            host.widgetCall(trans(), MEMCARD_M.slotPlay, [1, 0x4f3]);
            advance();
            return;

        case 0x33: {
            // 0x80086370: stage the live 0x26C4 block, checksum it, then write
            // the chosen slot's 0x44-byte record at recordBase + slot*0x44 + 8.
            const slot = mem.read32(MEMCARD_STAGE + 0x04) | 0;
            const buf = staging();
            for (let i = 0; i < MEMCARD_BLOCK_SIZE; i += 4) {
                mem.write32((buf + i) >>> 0, mem.read32(MEMCARD_CARD_BASE + i) >>> 0);
            }
            mem.write8(buf, host.checksum(buf + 4, MEMCARD_CHECKSUM_LEN) & 0xff);
            mem.write8(buf + 2, MEMCARD_FORMAT);
            const rec = (mem.read32(MEMCARD_STAGE + 0x0c) + Math.imul(slot, MEMCARD_SLOT_STRIDE) + 8) >>> 0;
            strcpyBytes(mem, rec, buf + 0x54);
            mem.write32(rec + 0x18, mem.read32(sub() + 0x68) >>> 0);
            mem.write32(rec + 0x1c, mem.read32(sub() + 0x6c) >>> 0);
            mem.write32(rec + 0x20, mem.read32(buf + 0x6c) >>> 0);
            mem.write32(rec + 0x24, mem.read32(buf + 0x48) >>> 0);
            mem.write32(rec + 0x28, mem.read32(buf + 0x4c) >>> 0);
            mem.write32(rec + 0x2c, mem.read32(buf + 0x50) >>> 0);
            for (let i = 0; i < 3; i++) {
                const member = Math.imul(host.rosterSlot(i) | 0, MEMCARD_MEMBER_STRIDE);
                const src = (buf + member) >>> 0;
                mem.write16(rec + 0x3c + Math.imul(i, 2), mem.read16(src + 0x784));
                mem.write32(rec + 0x30 + Math.imul(i, 4), mem.read32(src + 0x760) >>> 0);
            }
            const record = mem.read32(MEMCARD_STAGE + 0x0c) >>> 0;
            mem.write8(record + 1, slot & 0xff);
            mem.write8(record, host.checksum(record + 4, MEMCARD_RECORD_SIZE) & 0xff);
            advance();
            return;
        }

        case 0x34: {
            const r = host.cardService340(mem.read32(screen + MEMCARD.handle) | 0,
                header(), MEMCARD_HEADER_SIZE, 1) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            if (r === 1) { advance(); return; }
            mem.write32(screen + MEMCARD.result, (r - 1) | 0);
            host.memcardHideStep(screen, widgets);
            return;
        }

        case 0x35: {
            const r = host.cardService340(mem.read32(screen + MEMCARD.handle) | 0,
                staging(), MEMCARD_BLOCK_SIZE,
                (mem.read32(MEMCARD_STAGE + 0x04) | 0) + 2) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            if (r === 1) {
                host.widgetCall(trans(), MEMCARD_M.slotPlay, [2, 0x14]);
                mem.write32(screen + MEMCARD.state, 0x1f4);
                return;
            }
            mem.write32(screen + MEMCARD.result, (r - 1) | 0);
            host.memcardHideStep(screen, widgets);
            return;
        }

        case 0x46: {
            const record = stageRec(mem.read32(MEMCARD_STAGE + 0x04) | 0);
            if ((mem.read32(record + 8) | 0) === 0) {
                setLine(MEMCARD_W.strip, 0x18);
                mem.write32(screen + MEMCARD.state, 0x1f5);
                mem.write32(screen + MEMCARD.confirmLatch, 1);
                mem.write32(screen + MEMCARD.queued, 0x20);
                mem.write32(screen + MEMCARD.afterLoad, 1);
                return;
            }
            setLine(MEMCARD_W.strip, 0x11);
            host.widgetCall(trans(), MEMCARD_M.slotPlay, [1, 0x4d8]);
            // The 0x4624 tail is followed by the 0x462C advance.
            advance();
            return;
        }

        case 0x47: {
            const buf = staging();
            const r = host.cardService33c(mem.read32(screen + MEMCARD.handle) | 0,
                buf, MEMCARD_BLOCK_SIZE, (mem.read32(MEMCARD_STAGE + 0x04) | 0) + 2) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            if (r !== 1) {
                mem.write32(screen + MEMCARD.result, (r - 1) | 0);
                host.memcardHideStep(screen, widgets);
                return;
            }
            const sum = host.checksum(buf + 4, MEMCARD_CHECKSUM_LEN) | 0;
            // The same bitwise test as state 0x16 (0x3270-0x3284); both this and
            // the format test jump to 0x3918 with $v0 = 8. The format test reads
            // ONE BYTE (0x3288 `lbu $v1, 0x2($a0)`); byte +3 is retained data the
            // save path copies from the live block and never rewrites, so it is
            // not part of the gate.
            if (((sum & ~(mem.read8(buf) & 0xff)) & 0xff) !== 0
                || (mem.read8(buf + 2) !== MEMCARD_FORMAT && mode() !== 0)) {
                mem.write32(screen + MEMCARD.result, 8);
                host.memcardHideStep(screen, widgets);
                return;
            }
            for (let i = 0; i < MEMCARD_BLOCK_SIZE; i += 4) {
                mem.write32(MEMCARD_CARD_BASE + i, mem.read32(buf + i) >>> 0);
            }
            host.widgetCall(trans(), MEMCARD_M.slotPlay, [2, 0x14]);
            mem.write32(screen + MEMCARD.state, 0x1f4);
            mem.write32(view() + MEMCARD.state, 0);
            mem.write32(screen + MEMCARD.afterLoad, 0);
            return;
        }

        case 0x64: {
            setLine(MEMCARD_W.body,
                mem.read32(MEMCARD_RESULT_TABLE + Math.imul(mem.read32(screen + MEMCARD.result) | 0, 4)) | 0);
            host.messageSlotCaption(screen, widgets, 1);
            if (mode() !== 0) {
                // 0x3E6C: the mode value is stored into the confirm latch in the
                // jump delay slot, then the state advances.
                mem.write32(screen + MEMCARD.confirmLatch, mode());
                advance();
                return;
            }
            const r = mem.read32(screen + MEMCARD.result) | 0;
            // $s0 selects the row-cursor tail: 1 for the two prompt rows, 0 for
            // the plain advance (0x3D28 leaves it as the entry value).
            let s0 = 0;
            if (r === 4) {
                mem.write32(screen + MEMCARD.row, 1);
                s0 = 1;
            } else if (r === 5) {
                let total = 0;
                const count = mem.read32(MEMCARD_CARD_STRUCT + 0xa4) | 0;
                for (let i = 0; i < count; i++) {
                    const v = mem.read32(MEMCARD_CARD_STRUCT + Math.imul(i, 0x28) + 0xc0) | 0;
                    total += (v < 0 ? v + 0x1fff : v) >> 13;
                }
                if (total + 4 >= 0x10) {
                    // 0x3D04: the message body is hidden before the state holds.
                    setVisible(MEMCARD_W.body, 0);
                    mem.write32(screen + MEMCARD.result, 7);
                    mem.write32(screen + MEMCARD.state, 0x64);
                    return;
                }
                // Not enough blocks: the message is shown with the cursor row,
                // and the latch is not raised.
                s0 = 1;
            } else {
                mem.write32(screen + MEMCARD.confirmLatch, 1);
                if (r === 7) {
                    host.widgetCall(w(MEMCARD_W.body), MEMCARD_M.setNumber, [1, 4]);
                    s0 = 0;
                }
            }
            if (s0 === 0) {
                advance();
                return;
            }
            setLine(MEMCARD_W.strip, r === 4 ? 0x19 : 0x1a);
            setLine(MEMCARD_W.yes, 0x16);
            setLine(MEMCARD_W.no, 0x17);
            showRowCursor(mem.read32(screen + MEMCARD.row) | 0);
            advance();
            return;
        }

        case 0x65: {
            const r = mem.read32(screen + MEMCARD.result) | 0;
            const hideAll = (): void => {
                setVisible(MEMCARD_W.body, 0);
                setVisible(MEMCARD_W.line, 0);
                setVisible(MEMCARD_W.strip, 0);
                setVisible(MEMCARD_W.yes, 0);
                setVisible(MEMCARD_W.no, 0);
                host.widgetCall(cursor(), MEMCARD_M.cursorEnabled, [0]);
            };
            if (mode() === 0 && ((r - 4) >>> 0) < 2) {
                let row = mem.read32(screen + MEMCARD.row) | 0;
                if (padEdge(MEMCARD_BUTTON_UP)) row = 0;
                else if (padEdge(MEMCARD_BUTTON_DOWN)) row = 1;
                if (row !== (mem.read32(screen + MEMCARD.row) | 0)) {
                    mem.write32(screen + MEMCARD.row, row | 0);
                    host.widgetCall(cursor(), MEMCARD_M.cursorPos, [0xc2, (Math.imul(row, 0x0e) + 0xbd) | 0]);
                    host.playSound(MEMCARD_SOUND_SELECT);
                }
                if (padHeld(MEMCARD_BUTTON_CONFIRM)) {
                    host.playSound(MEMCARD_SOUND_CONFIRM);
                    hideAll();
                    mem.write32(screen + MEMCARD.state, 0x190);
                    mem.write32(screen + MEMCARD.cursorVisible, 0);
                    // Row 0 asks for the format/save message and plays the slot
                    // transition; row 1 (the "no" row) just queues state 1 and
                    // resets the slot (0x4124 -> 0x428C).
                    if ((mem.read32(screen + MEMCARD.row) | 0) !== 0) {
                        mem.write32(screen + MEMCARD.queued, 1);
                        wcall(trans(), MEMCARD_M.slotReset);
                    } else if (r === 4) {
                        mem.write32(screen + MEMCARD.queued, 0x6e);
                        setLine(MEMCARD_W.body, 0x1e);
                        host.messageSlotCaption(screen, widgets, 1);
                        host.widgetCall(trans(), MEMCARD_M.slotPlay, [1, 0x90]);
                    } else {
                        mem.write32(screen + MEMCARD.queued, 0x78);
                        setLine(MEMCARD_W.body, 0x1f);
                        host.messageSlotCaption(screen, widgets, 1);
                        host.widgetCall(trans(), MEMCARD_M.slotPlay, [1, 0x90]);
                    }
                    // Both input paths fall through to the card-status tail.
                } else if (padHeld(MEMCARD_BUTTON_CANCEL)) {
                    host.playSound(MEMCARD_SOUND_BACK);
                    hideAll();
                    mem.write32(screen + MEMCARD.state, 0x190);
                    mem.write32(screen + MEMCARD.cursorVisible, 0);
                    mem.write32(screen + MEMCARD.queued, 1);
                    wcall(trans(), MEMCARD_M.slotReset);
                }
                const status = host.cardStatusList(mem.read32(screen + MEMCARD.handle) | 0) | 0;
                if (status !== 0 && status !== 1) {
                    mem.write32(screen + MEMCARD.result, status | 0);
                    mem.write32(screen + MEMCARD.cursorVisible, 0);
                    host.memcardTeardown(screen, widgets);
                }
                return;
            }
            // Card absent (0x42E4): the only input is a confirm to close.
            if (padHeld(MEMCARD_BUTTON_CONFIRM)) {
                host.playSound(MEMCARD_SOUND_STEP);
                mem.write32(screen + MEMCARD.state, 0x190);
                mem.write32(screen + MEMCARD.confirmLatch, 0);
                mem.write32(screen + MEMCARD.queued, 1);
            }
            return;
        }

        case 0x6e: {
            const r = host.cardStatusC(mem.read32(screen + MEMCARD.handle) | 0) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            if (r === 1) {
                host.widgetCall(trans(), MEMCARD_M.slotPlay, [2, 0x14]);
                advance();
                return;
            }
            host.memcardTeardown(screen, widgets);
            return;
        }

        case 0x6f:
            if ((mem.read32(trans() + 0x68) | 0) !== 0) {
                host.memcardTeardown(screen, widgets);
                mem.write32(screen + MEMCARD.result, 5);
            }
            return;

        case 0x78:
            mem.write32(screen + MEMCARD.state, 0x79);
            return;

        case 0x79: {
            const r = host.cardStatusD(mem.read32(screen + MEMCARD.handle) | 0) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            if (r === 1) { advance(); return; }
            host.memcardTeardown(screen, widgets);
            return;
        }

        case 0x7a: {
            const r = host.cardService340(mem.read32(screen + MEMCARD.handle) | 0,
                MEMCARD_FILE_TABLE, 0x80, 0) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            if (r !== 1) {
                mem.write32(screen + MEMCARD.result, 0x0a);
                host.memcardTeardown(screen, widgets);
                return;
            }
            // sltiu(C+0x314 - 1, 3): only a file count of 1..3 advances.
            if (((mem.read32(MEMCARD_CARD_STRUCT + 0x314) | 0) - 1) >>> 0 < 3) {
                mem.write32(MEMCARD_CARD_STRUCT + 0x324, 0);
                advance();
                return;
            }
            mem.write32(screen + MEMCARD.result, 3);
            host.memcardTeardown(screen, widgets);
            return;
        }

        case 0x7b: {
            const index = mem.read32(MEMCARD_CARD_STRUCT + 0x324) | 0;
            const r = host.cardService340(mem.read32(screen + MEMCARD.handle) | 0,
                (mem.read32(MEMCARD_CARD_STRUCT + 0x318 + Math.imul(index, 4)) | 0) >>> 0,
                0x80, (index + 1) << 15) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            if (r !== 1) {
                mem.write32(screen + MEMCARD.result, 0x0b);
                host.memcardTeardown(screen, widgets);
                return;
            }
            // Index increment is the delay slot of the continuation branch, so
            // it always lands on the success path. Finalize if signed count-1
            // is less than the next index; the D0 byte copy is followed by the
            // final header word (D4 total).
            mem.write32(MEMCARD_CARD_STRUCT + 0x324, (index + 1) | 0);
            if (!((((mem.read32(MEMCARD_CARD_STRUCT + 0x314) | 0) - 1) < ((index + 1) | 0)))) return;
            const record = header();
            host.memZero(record, MEMCARD_HEADER_SIZE);
            mem.write32(record + 4, MEMCARD_TAG >>> 0);
            mem.write16(record + 2, MEMCARD_FORMAT);
            mem.write8(record, host.checksum(record + 4, MEMCARD_RECORD_SIZE) & 0xff);
            for (let i = 0; i < MEMCARD_RECORD_SIZE; i += 1) {
                mem.write8((box() + i) >>> 0, mem.read8(record + i));
            }
            mem.write32((box() + MEMCARD_RECORD_SIZE) >>> 0, mem.read32((record + MEMCARD_RECORD_SIZE) >>> 0));
            mem.write32(MEMCARD_STAGE, mem.read8(record + 1) | 0);
            advance();
            return;
        }

        case 0x7c: {
            const r = host.cardService340(mem.read32(screen + MEMCARD.handle) | 0,
                header(), MEMCARD_HEADER_SIZE, 1) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            host.widgetCall(trans(), MEMCARD_M.slotPlay, [2, 0x14]);
            advance();
            return;
        }

        case 0x7d:
            if ((mem.read32(trans() + 0x68) | 0) === 0) return;
            wcall(trans(), MEMCARD_M.slotReset);
            if ((mem.read32(screen + MEMCARD.result) | 0) !== 1) {
                host.memcardTeardown(screen, widgets);
                return;
            }
            mem.write32(screen + MEMCARD.state, 0x1e);
            return;

        case 0x190: {
            const r = host.cardStatusList(mem.read32(screen + MEMCARD.handle) | 0) | 0;
            mem.write32(screen + MEMCARD.result, r | 0);
            if (r === 0) return;
            // 0x436C: state 0x190 advances; only 0x191 swaps.
            advance();
            return;
        }

        case 0x191: {
            if ((mem.read32(screen + MEMCARD.result) | 0) !== 1) host.memcardTeardown(screen, widgets);
            swapState();
            return;
        }

        case 0x5a:
            blockSettle(true);
            return;

        case 0x258:
            blockSettle(false);
            return;

        case 0x259:
            host.screenCall(screen, MEMCARD.refreshCard, []);
            return;

        case 0x1f4: {
            if ((mem.read32(trans() + 0x68) | 0) === 0) return;
            if (mode() !== 0) {
                setLine(MEMCARD_W.strip, 0x12);
                mem.write32(screen + MEMCARD.queued, 0x190);
                // The load path adds one here and one more at 0x3A3C (0x1F4 ->
                // 0x1F6); the save path only adds the 0x3A3C one (-> 0x1F5).
                advance();
            } else {
                for (let i = 0; i < MEMCARD_RECORD_SIZE; i += 1) {
                    mem.write8((box() + i) >>> 0, mem.read8(header() + i));
                }
                host.screenCall(screen, MEMCARD.acceptSlot, []);
                setLine(MEMCARD_W.strip, 9);
                mem.write32(screen + MEMCARD.queued, 0x20);
            }
            // 0x3A3C: reset the slot and raise the confirm latch.
            advance();
            wcall(trans(), MEMCARD_M.slotReset);
            mem.write32(screen + MEMCARD.confirmLatch, 1);
            return;
        }

        case 0x1f5:
            if (padHeld(MEMCARD_BUTTON_CONFIRM)) {
                host.playSound(MEMCARD_SOUND_STEP);
                mem.write32(screen + MEMCARD.confirmLatch, 0);
                mem.write32(screen + MEMCARD.state, mem.read32(screen + MEMCARD.queued) | 0);
                if (mode() === 0) {
                    host.screenCall(screen, MEMCARD.handler30, []);
                    mem.write32(view() + MEMCARD.state, 6);
                    return;
                }
                setVisible(MEMCARD_W.strip, 0);
                if ((mem.read32(screen + MEMCARD.afterLoad) | 0) === 0) {
                    mem.write32(view() + MEMCARD.state, 0);
                    return;
                }
                mem.write32(screen + MEMCARD.queued, 0x258);
                mem.write32(view() + MEMCARD.state, 6);
                return;
            }
            {
                const r = host.cardStatusList(mem.read32(screen + MEMCARD.handle) | 0) | 0;
                if (r === 0 || r === 1) return;
                host.memcardHideStep(screen, widgets);
                mem.write32(screen + MEMCARD.result, 1);
            }
            return;

        case 0x1f6:
            if (padHeld(MEMCARD_BUTTON_CONFIRM)) {
                host.playSound(MEMCARD_SOUND_STEP);
                mem.write32(screen + MEMCARD.confirmLatch, 0);
                mem.write32(screen + MEMCARD.state, mem.read32(screen + MEMCARD.queued) | 0);
                setVisible(MEMCARD_W.strip, 0);
                mem.write32(screen + MEMCARD.queued, 0x258);
                mem.write32(view() + MEMCARD.state, 0);
            }
            return;
    }
}
