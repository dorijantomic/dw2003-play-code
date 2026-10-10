// The field help menu: eight topic rows and a cursor in a folding CMFONT window; confirming a row
// types that topic's page of text UNDER the list (the page widget sits at 18,176 and the rows run
// from x 189, y 33..131), and the eighth row ("Return") closes it. Translated from wstag210
// F0x800A5E74 and its four copies (asm ~/ddw3/asm/dw2003/pro/wstag210.s, file offsets 0x094-0x9FC,
// overlay load base 0x800A5DE0); the four differ only in the overlay-local cells, the text handle,
// the relocated jumps and — for s935 event 1616 — one missing task-state compare.
//
// Oracle: tests/lane-b/help-menu-launcher.test.js runs each copy through engine/native on its own
// stage image and compares every call and every controller word frame by frame, over the whole
// player route (open, move down 3, up past 0, open a page, page through, back, close on row 7 and
// close on Cancel) and over seeded single frames.
//
// Tick F0x800A5E74(obj, extra). obj+0x0C task state, +0x10 step, +0x50 row count, +0x54 selection,
// +0x58 "nothing left to page through", +0x5C the blinking prompt's phase (0..4), +0x60 its last
// tick, +0x64 and +0x74 the two four-word window folds (values at +0x6C / +0x7C). extra+0x00..0x1C
// the eight row texts, +0x20 the cursor icon, +0x24 the page text: the whole 0x28-byte block.
//   task state 1: the step switch below, then the draw, every frame.
//   task state 3: return.  task state 2: the stage's fold pair once more on +0x64, then return
//     (four of the five copies; s935 event 1616 has no state-2 compare — stateTwoReleasesFold).
//   any other state: obj.0x38(obj), fold durations 10, rows
//     createText(0x1002,1,0xBD,0x21+14i) + 0x15C(1), cursor spawnIcon(0x1002,1,0xAF,0x21)
//     + 0x80(0), page createText(0x1002,1,0x12,0xB0) + 0x160(3), row count 8; no draw.
//   step 0 (also 8, 9 and every step >= 12 unsigned): fold start(+0x64, open), step++.
//   step 1: fold tick(+0x64); when done rows 0x114(lookup(handle), i+1) for i < rowCount — the
//     titles, 1-based — then cursor 0x80(1), step++.
//   step 2: the list. Up (button 4, word +0x3F4 then +0x3FC) -> sel-1 clamped at 0; else Down
//     (button 6, same two words) -> sel+1 clamped at rowCount-1. Changed -> SFX 0x8004513E and
//     cursor 0x84(0xAF, 0x21 + 14*sel). Unchanged -> button 0xD on +0x3F4 -> SFX 0x8004503C and
//     either step 3 (a topic) or step 10 (row rowCount-1); else button 0xE on +0x3F4 ->
//     SFX 0x800450BD, step 10.
//   step 3: cursor 0x94(1), cursor 0x88(7), fold start(+0x74, open), step++.
//   step 4: fold tick(+0x74); when done page 0x114(lookup(handle), sel+9) — the page, 1-based —
//     then page 0x130(6), step++.
//   step 5: page 0x168() nonzero -> step++. Else page 0x170() nonzero (waiting for a page turn):
//     confirm -> SFX 0x4001C, obj+0x58 = 0; otherwise obj+0x58 = 1. Page turn over (0x170 == 0):
//     confirm -> page 0x128() (the visible-window rescan).
//   step 6: fold start(+0x74, close), page 0x144(0), step++.
//   step 7: fold tick(+0x74); when done cursor 0x94(0), cursor 0x88(0), step = 2.
//   step 10: rows 0x144(0), cursor 0x80(0), fold start(+0x64, close), step++.
//   step 11: fold tick(+0x64); when done obj+0x0C = 3 (this frame still draws).
//   draw: ctx = F0x8001F648 fills the stack frame at sp+0x10, so the routine reads its methods at
//     stack offset (context field + 0x10); the port passes the CONTEXT FIELD itself, as
//     yesno-launcher.ts and ShopDrawIntents.callSlot do:
//     ctx+0x7C(0x1002,2) layer, ctx+0x74(0x140,0) origin, ctx+0x98(0) ignored.
//     obj+0x58 != 0 -> the "press to continue" marker: every 4 ticks (the cell at 0x8004DE10+0x188
//       is called twice on a trigger frame) the phase cycles 0..4, then ctx+0x88(phase) (the CLUT
//       row), ctx+0x84(CMFONT, 0x0A, 0x124, 0xCD), ctx+0x88(0) — the glyph brightens and dims.
//     obj+0x6C != 0 -> the list's scroll marker: while folding ctx+0x8C(value,0x1000,0x1000) and
//       ctx+0x94(0x140,0x56) (the pivot), then ctx+0x84(CMFONT, markerGlyphs[rowCount-5], 0xA8,0x18).
//     obj+0x7C != 0 -> the page's end-of-text marker, same pivot pair, ctx+0x84(CMFONT, 0x45, 0, 0xAC).
//
// One pack cell serves both the rows and the page: [0x80044B38 + 0x424] and [0x80044F5C] are the
// same word, 0x80044F5C. F0x8001AE38, F0x8001B364, F0x8001F648, the pad cells, the SFX cell, the
// fold pair and every object method are host boundaries. The blinking prompt reads the free-running
// tick counter the resident cursor handler also uses: cell 0x8004DE10 + 0x188 = 0x8004DF98, whose
// service (F0x8001D6F4) returns [0x8004DE20].

export const HELP_TICK_S210 = 0x800a5e74;
export const HELP_TEXT_GLOBAL = 0x8005cca8;
export const HELP_LOOKUP_CELL = 0x80044f5c; // == 0x80044B38 + 0x424
export const HELP_TICK_COUNT_CELL = 0x8004de10;
export const HELP_TICK_COUNT_SLOT = 0x188;
export const HELP_TICK_COUNT_VALUE = 0x8004de20;
export const HELP_SFX_MOVE = 0x8004513e;
export const HELP_SFX_CONFIRM = 0x8004503c;
export const HELP_SFX_CANCEL = 0x800450bd;
export const HELP_SFX_PAGE = 0x0004001c;
export const HELP_LAYER = 0x1002;
export const HELP_WINDOW_PACK = 0x02860000;
export const HELP_FOLD = 0x64;
export const HELP_PAGE_FOLD = 0x74;
export const HELP_ROW_COUNT_CELL = 0x50;
export const HELP_SELECTION = 0x54;
export const HELP_PENDING_OFF = 0x58;
export const HELP_PROMPT_PHASE = 0x5c;
export const HELP_PROMPT_STAMP = 0x60;
export const HELP_ROWS = 8;

/** Every coordinate, glyph and period below is read out of the routine; none is chosen. */
export const HELP_MENU_LAYOUT = {
    /** Row i: createText(0x1002, 1, rowX, rowY + rowStep * i). */
    rowX: 0xbd,
    rowY: 0x21,
    rowStep: 0x0e,
    /** The cursor: spawnIcon(0x1002, 1, cursorX, cursorY), then 0x84(cursorX, rowY + rowStep*sel). */
    cursorX: 0xaf,
    cursorY: 0x21,
    /** The page text: createText(0x1002, 1, pageX, pageY), then 0x160(3) at creation. */
    pageX: 0x12,
    pageY: 0xb0,
    /** cursor 0x88 (icon +0x60): the cursor's own phase word — 7 while a page is up, 0 after. */
    pageModeOn: 7,
    pageModeOff: 0,
    /** cursor 0x94 (icon +0x7C, the cursor handler's "frozen" word): 1 stops it mid-animation. */
    listOn: 1,
    listOff: 0,
    /** Both folds' duration words, written in the create case. */
    foldTicks: 10,
    /** page 0x130: the typewriter's ticks per glyph. */
    typeSpeed: 6,
    /** The blinking "press to continue" glyph: ctx 0x88(phase), 0x84(pack, 0x0A, 0x124, 0xCD), 0x88(0). */
    promptGlyph: 0x0a,
    promptX: 0x124,
    promptY: 0xcd,
    /** The phase advances when (tick - stamp) >= promptTicks, and wraps at promptFrames. */
    promptTicks: 4,
    promptFrames: 5,
    /** The list's scroll marker: ctx 0x84(pack, markerGlyphs[rowCount - 5], 0xA8, 0x18). */
    markerGlyphs: [0x1c, 0x1b, 0x19, 0x24],
    markerX: 0xa8,
    markerY: 0x18,
    /** The page's end-of-text marker: ctx 0x84(pack, 0x45, 0, 0xAC). */
    endGlyph: 0x45,
    endX: 0x00,
    endY: 0xac,
    /** While a fold is moving: ctx 0x8C(value, 0x1000, 0x1000) then 0x94(0x140, 0x56). */
    foldScale: 0x1000,
    foldPivotX: 0x140,
    foldPivotY: 0x56,
    /** The three opening draw calls, every frame (context field numbers). */
    drawLayer: 0x1002,
    drawLayerMode: 2,
    drawClipX: 0x140,
    drawClipY: 0x00,
} as const;

export interface HelpMenuParams {
    /** Full text handle (0x01120001 for s210, 0x0158000n for the Amaterasu counters). */
    textHandle: number;
    /** The per-overlay scroll-marker glyph table, read at (rowCount - 5) * 4. */
    markerGlyphs: readonly number[];
    /**
     * Four of the five copies run task state 2 as one more fold open + tick on +0x64 before
     * returning; the s935 event-1616 copy returns from state 2 and 3 alike (its dispatch is
     * slti/beq only, with no state-2 compare). Read out of each image, so the oracle proves both
     * shapes.
     */
    stateTwoReleasesFold: boolean;
}

export interface HelpMenu extends HelpMenuParams {
    module: string;
    /** Tick address inside the stage overlay. */
    address: number;
    /** Jump-table base of the step switch (relocation only). */
    jumpTable: number;
    /** Stage cells holding the fold start / fold tick pointers. */
    foldStartCell: number;
    foldTickCell: number;
    /** The fold object's own base (its method 0 is the register call of task state 2's pair). */
    releaseCell: number;
    /** The overlay's scroll-marker glyph table, read at (rowCount - 5) * 4. */
    markerCell: number;
    /** Launch label supplied with the task brief; not checked by the oracle. */
    label: number;
}

/**
 * The five copies; constants read from each image. `stateTwoReleasesFold` and the address of the
 * s935/1616 copy were read from the words (see the module header).
 */
export const HELP_MENUS: readonly HelpMenu[] = [
    { module: "pro/wstag210", address: 0x800a5e74, label: 8, textHandle: 0x01120001, jumpTable: 0x800a5de0, foldStartCell: 0x800aa090, foldTickCell: 0x800aa094, releaseCell: 0x800aa08c, markerCell: 0x800a7f84, markerGlyphs: HELP_MENU_LAYOUT.markerGlyphs, stateTwoReleasesFold: true },
    { module: "pro/wstag924", address: 0x800a60fc, label: 1602, textHandle: 0x01580001, jumpTable: 0x800a5de4, foldStartCell: 0x800a79f0, foldTickCell: 0x800a79f4, releaseCell: 0x800a79ec, markerCell: 0x800a7a34, markerGlyphs: HELP_MENU_LAYOUT.markerGlyphs, stateTwoReleasesFold: true },
    { module: "pro/wstag924", address: 0x800a6a94, label: 1604, textHandle: 0x01580002, jumpTable: 0x800a5e14, foldStartCell: 0x800a79f0, foldTickCell: 0x800a79f4, releaseCell: 0x800a79ec, markerCell: 0x800a7a44, markerGlyphs: HELP_MENU_LAYOUT.markerGlyphs, stateTwoReleasesFold: true },
    { module: "pro/wstag935", address: 0x800a60d8, label: 1616, textHandle: 0x01580008, jumpTable: 0x800a5de0, foldStartCell: 0x800a7b20, foldTickCell: 0x800a7b24, releaseCell: 0x800a7b1c, markerCell: 0x800a7b64, markerGlyphs: HELP_MENU_LAYOUT.markerGlyphs, stateTwoReleasesFold: false },
    { module: "pro/wstag935", address: 0x800a6a30, label: 1618, textHandle: 0x01580009, jumpTable: 0x800a5e10, foldStartCell: 0x800a7b20, foldTickCell: 0x800a7b24, releaseCell: 0x800a7b1c, markerCell: 0x800a7b74, markerGlyphs: HELP_MENU_LAYOUT.markerGlyphs, stateTwoReleasesFold: true },
];

export interface HelpMenuMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface HelpMenuHost {
    /** target.method[slot](target, ...args): the object's inline method, with its return value. */
    callMethod(target: number, slot: number, args: number[]): number;
    /** F0x8001AE38(layer, kind, x, y): create a text element. */
    createText(layer: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(layer, kind, x, y): spawn the cursor icon. */
    spawnIcon(layer: number, kind: number, x: number, y: number): number;
    /** [0x80044F5C](handle): resolve a pack handle (the row titles and the page text). */
    lookup(handle: number): number;
    /** [foldStartCell](fold, direction): begin the window fold. */
    foldStart(fold: number, direction: number): void;
    /** [foldTickCell](fold): advance the fold, nonzero when done. */
    foldTick(fold: number): number;
    /** [0x8004B7D0 + 0x3F4](port): the first pad word. */
    padRead(port: number): number;
    /** [0x8004B7D0 + 0x3FC](port): the second pad word. */
    padAlt(port: number): number;
    /** [0x8004B7D0 + 0x408](port, button): bit index of a logical button. */
    padShift(port: number, button: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8004DE10 + 0x188](): the resident tick counter the prompt blinks against. */
    tickCount(): number;
    /** F0x8001F648(ctx): fill a draw context, return a handle to it. */
    drawInit(): number;
    /** ctx.fn[slot](...args): one draw-context call. */
    drawCall(ctx: number, slot: number, args: number[]): void;
}

const L = HELP_MENU_LAYOUT;
const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

/** The draw-context fields the routine calls (F0x8001F648 fills them at sp+field+0x10). */
export const DRAW_LAYER = 0x7c;
export const DRAW_ORIGIN = 0x74;
export const DRAW_IGNORED = 0x98;
export const DRAW_PALETTE = 0x88;
export const DRAW_SPRITE = 0x84;
export const DRAW_SCALE = 0x8c;
export const DRAW_POS = 0x94;

/** One frame of the help menu (F0x800A5E74 and its four copies). */
export function helpMenuTick(
    mem: HelpMenuMemory,
    obj: number,
    extra: number,
    host: HelpMenuHost,
    params: HelpMenuParams,
): void {
    const taskState = s32(mem.read32(obj + 0x0c));
    if (taskState === 1) {
        helpMenuStep(mem, obj, extra, host, params);
        helpMenuDraw(mem, obj, host, params);
        return;
    }
    if (taskState === 3) return;
    if (taskState === 2) {
        if (params.stateTwoReleasesFold) {
            host.foldStart(obj + HELP_FOLD, 1);
            host.foldTick(obj + HELP_FOLD);
        }
        return;
    }
    host.callMethod(obj, 0x38, []);
    mem.write32(obj + HELP_FOLD, L.foldTicks);
    mem.write32(obj + HELP_PAGE_FOLD, L.foldTicks);
    for (let i = 0; i < HELP_ROWS; i++) {
        const row = u32(host.createText(L.drawLayer, 1, L.rowX, L.rowY + L.rowStep * i));
        mem.write32(extra + 4 * i, row);
        host.callMethod(row, 0x15c, [1]);
    }
    const icon = u32(host.spawnIcon(L.drawLayer, 1, L.cursorX, L.cursorY));
    mem.write32(extra + 0x20, icon);
    host.callMethod(icon, 0x80, [0]);
    const page = u32(host.createText(L.drawLayer, 1, L.pageX, L.pageY));
    mem.write32(extra + 0x24, page);
    host.callMethod(page, 0x160, [3]);
    mem.write32(obj + HELP_ROW_COUNT_CELL, HELP_ROWS);
}

/** The task-state-1 step switch of F0x800A5E74 (the 12-entry table at file offset 0x000). */
function helpMenuStep(mem: HelpMenuMemory, obj: number, extra: number, host: HelpMenuHost,
  params: HelpMenuParams): void {
    const advance = (): void => mem.write32(obj + 0x10, u32(mem.read32(obj + 0x10) + 1));
    const handle = (): number => u32((mem.read32(HELP_TEXT_GLOBAL) << 16) + params.textHandle);
    const bit = (word: number, shift: number): number => (s32(word) >> (shift & 31)) & 1;
    const pressed = (button: number, alt: boolean): number => {
        const word = alt ? host.padAlt(0) : host.padRead(0);
        return bit(word, host.padShift(0, button));
    };
    const cursor = (): number => u32(mem.read32(extra + 0x20));
    const page = (): number => u32(mem.read32(extra + 0x24));
    const rowCount = (): number => s32(mem.read32(obj + HELP_ROW_COUNT_CELL));

    // `sltiu step, 12`: the table covers 0..11, and every step >= 12 shares step 0's target.
    switch (u32(mem.read32(obj + 0x10)) < 12 ? u32(mem.read32(obj + 0x10)) : 0) {
        case 1: {
            if (s32(host.foldTick(obj + HELP_FOLD)) === 0) break;
            for (let i = 0; i < rowCount(); i++) {
                const pack = host.lookup(handle());
                const row = u32(mem.read32(extra + 4 * i));
                host.callMethod(row, 0x114, [pack, i + 1]);
            }
            host.callMethod(cursor(), 0x80, [L.listOn]);
            advance();
            break;
        }
        case 2: {
            const old = s32(mem.read32(obj + HELP_SELECTION));
            if (pressed(4, false) || pressed(4, true)) {
                const v = s32(mem.read32(obj + HELP_SELECTION)) - 1;
                mem.write32(obj + HELP_SELECTION, u32(v));
                if (v < 0) mem.write32(obj + HELP_SELECTION, 0);
            } else if (pressed(6, false) || pressed(6, true)) {
                const v = s32(mem.read32(obj + HELP_SELECTION)) + 1;
                const last = rowCount() - 1;
                mem.write32(obj + HELP_SELECTION, u32(v));
                if (last < v) mem.write32(obj + HELP_SELECTION, u32(last));
            }
            if (old !== s32(mem.read32(obj + HELP_SELECTION))) {
                host.playSound(HELP_SFX_MOVE);
                const sel = mem.read32(obj + HELP_SELECTION);
                host.callMethod(cursor(), 0x84, [L.cursorX, s32(Math.imul(sel, L.rowStep) + L.rowY)]);
            } else if (pressed(0xd, false)) {
                host.playSound(HELP_SFX_CONFIRM);
                if (s32(mem.read32(obj + HELP_SELECTION)) !== rowCount() - 1) advance();
                else mem.write32(obj + 0x10, 10);
            } else if (pressed(0xe, false)) {
                host.playSound(HELP_SFX_CANCEL);
                mem.write32(obj + 0x10, 10);
            }
            break;
        }
        case 3:
            host.callMethod(cursor(), 0x94, [L.listOn]);
            host.callMethod(cursor(), 0x88, [L.pageModeOn]);
            host.foldStart(obj + HELP_PAGE_FOLD, 1);
            advance();
            break;
        case 4: {
            if (s32(host.foldTick(obj + HELP_PAGE_FOLD)) === 0) break;
            const sel = s32(mem.read32(obj + HELP_SELECTION));
            host.callMethod(page(), 0x114, [host.lookup(handle()), sel + 9]);
            host.callMethod(page(), 0x130, [L.typeSpeed]);
            advance();
            break;
        }
        case 5: {
            if (s32(host.callMethod(page(), 0x168, [])) !== 0) { advance(); break; }
            if (s32(host.callMethod(page(), 0x170, [])) !== 0) {
                if (pressed(0xd, false)) {
                    host.playSound(HELP_SFX_PAGE);
                    mem.write32(obj + HELP_PENDING_OFF, 0);
                } else {
                    mem.write32(obj + HELP_PENDING_OFF, 1);
                }
            } else if (pressed(0xd, false)) {
                host.callMethod(page(), 0x128, []);
            }
            break;
        }
        case 6:
            host.foldStart(obj + HELP_PAGE_FOLD, 0);
            host.callMethod(page(), 0x144, [0]);
            advance();
            break;
        case 7:
            if (s32(host.foldTick(obj + HELP_PAGE_FOLD)) === 0) break;
            host.callMethod(cursor(), 0x94, [L.listOff]);
            host.callMethod(cursor(), 0x88, [L.pageModeOff]);
            mem.write32(obj + 0x10, 2);
            break;
        case 10:
            for (let i = 0; i < rowCount(); i++) {
                host.callMethod(u32(mem.read32(extra + 4 * i)), 0x144, [0]);
            }
            host.callMethod(cursor(), 0x80, [0]);
            host.foldStart(obj + HELP_FOLD, 0);
            advance();
            break;
        case 11:
            if (s32(host.foldTick(obj + HELP_FOLD)) === 0) break;
            mem.write32(obj + 0x0c, 3);
            break;
        default: // steps 0, 8, 9 and every step >= 12 share the step-0 target
            host.foldStart(obj + HELP_FOLD, 1);
            advance();
            break;
    }
}

/** The per-frame draw tail of F0x800A5E74 (file offset 0x7B8), run every task-state-1 frame. */
export function helpMenuDraw(mem: HelpMenuMemory, obj: number, host: HelpMenuHost,
  params: HelpMenuParams): void {
    const ctx = host.drawInit();
    host.drawCall(ctx, DRAW_LAYER, [L.drawLayer, L.drawLayerMode]);
    host.drawCall(ctx, DRAW_ORIGIN, [L.drawClipX, L.drawClipY]);
    host.drawCall(ctx, DRAW_IGNORED, [0]);
    if (s32(mem.read32(obj + HELP_PENDING_OFF)) !== 0) {
        // Called twice on a trigger frame: once to compare, once to store the stamp.
        if (s32(host.tickCount()) - s32(mem.read32(obj + HELP_PROMPT_STAMP)) >= L.promptTicks) {
            mem.write32(obj + HELP_PROMPT_STAMP, u32(host.tickCount()));
            const phase = s32(mem.read32(obj + HELP_PROMPT_PHASE)) + 1;
            mem.write32(obj + HELP_PROMPT_PHASE, u32(phase));
            if (phase >= L.promptFrames) mem.write32(obj + HELP_PROMPT_PHASE, 0);
        }
        host.drawCall(ctx, DRAW_PALETTE, [mem.read32(obj + HELP_PROMPT_PHASE) | 0]);
        host.drawCall(ctx, DRAW_SPRITE, [host.lookup(HELP_WINDOW_PACK), L.promptGlyph, L.promptX, L.promptY]);
        host.drawCall(ctx, DRAW_PALETTE, [0]);
    }
    const listFold = s32(mem.read32(obj + HELP_FOLD + 0x8));
    if (listFold !== 0) {
        if (listFold !== L.foldScale) helpFoldScale(ctx, host, listFold);
        const index = s32(mem.read32(obj + HELP_ROW_COUNT_CELL)) - 5;
        const glyph = params.markerGlyphs[index];
        if (glyph === undefined) {
            throw new Error(`HelpMenu: no scroll-marker glyph for row count ${index + 5}`);
        }
        host.drawCall(ctx, DRAW_SPRITE, [host.lookup(HELP_WINDOW_PACK), glyph, L.markerX, L.markerY]);
    }
    const pageFold = s32(mem.read32(obj + HELP_PAGE_FOLD + 0x8));
    if (pageFold !== 0) {
        if (pageFold !== L.foldScale) helpFoldScale(ctx, host, pageFold);
        host.drawCall(ctx, DRAW_SPRITE, [host.lookup(HELP_WINDOW_PACK), L.endGlyph, L.endX, L.endY]);
    }
}

function helpFoldScale(ctx: number, host: HelpMenuHost, value: number): void {
    host.drawCall(ctx, DRAW_SCALE, [value, L.foldScale, L.foldScale]);
    host.drawCall(ctx, DRAW_POS, [L.foldPivotX, L.foldPivotY]);
}