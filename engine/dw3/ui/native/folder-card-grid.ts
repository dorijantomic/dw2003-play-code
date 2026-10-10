// The Card Folder editor's 40-slot card grid and its swap list, translated from
// the original pro/stcrddek bodies.
//
// This is the surface the folder chooser hands off to when the player picks
// "Edit Folder". It is the folder's own editor: the forty slots drawn nine
// across, a cursor over them, a header and a footer, the six colour counters of
// the folder being edited, an eight-row list of cards still available to place,
// a bubble sort, and the "Only four of the same card in one folder" gate.
//
// Bodies (all read from exe-decomp/stcrddek_c/*.c and, where m2c obscured the
// accessor, exe-decomp/stcrddek.fns.s):
//
//   F0x80086574 folderCardGridTick     the state-0/1/2-3 dispatcher: first-frame
//                                      init (build the chrome, arm the five
//                                      folds), or the machine plus the draw.
//   F0x8008397C folderGridCreateChrome build the children widgets (header,
//                                      footer, six counters, eight swap rows,
//                                      two detail panels, message plate).
//   F0x80085210 folderCardGridMachine  the editor state machine (states 0..0x3F).
//   F0x80084890 folderCardGridDraw     the editor's draw intents.
//   F0x800835D8 folderGridDrawSlots    draw the dealt-in cards.
//   F0x800837B4 folderGridDealIn       deal one slot per frame through the
//                                      card-view context.
//   F0x800838C4 folderGridObjectsTick  the dealt-in grid object's own tick.
//   F0x80083934 folderGridCreateObjects make the dealt-in grid object (handler
//                                      0x800838C4, size 0x70).
//   F0x80083D28 folderEditorHeader     fill the header/counters/footer and, with
//                                      a message up, the card's stat line.
//   F0x80084278 folderSwapRowsFill     fill or clear the eight swap-list rows.
//   F0x80084440 folderDetailPanel      fill the bottom card-detail panel.
//   F0x800847C0 folderWorkingTable     rebuild the "still placeable" table.
//   F0x80088AC8 folderPagerCreate      make the swap-list scroll bar (handler
//                                      0x800888B0) with its four setters.
//   F0x800888B0 folderPagerTick        the scroll bar's own tick.
//
// Host boundaries: the widget factory and widget methods, the card-view text
// context (F0x8001EBF8 / F0x8001E7EC / F0x8001EBCC and its draw slots), the
// window-fold pair (window-fold.ts), the picture service the pager draws
// through, the pack resolver, the pad, the sound player, the text-bank getter,
// the frame counter and the task registry. Nothing here executes an original
// instruction.
//
// Data, all read from the overlay, never authored here:
//   0x80048D34 + 0x3A2 + id   the per-card copy counts (owned)
//   0x8004935C + f*0x66       the three folder records (name + 40 halfword slots)
//   0x8008A484                the six cursor-pulse frame words
//   0x8008B7DC/0x8008B818/0x8008B6E4/0x8008B6FC  the keyboard tables (see
//                             folder-name-keyboard.ts)
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared barrel.

/** The card grid object: handler, allocation size and children-block size. */
export const FOLDER_GRID_HANDLER = 0x80086574;
export const FOLDER_GRID_SIZE = 0x494;
export const FOLDER_GRID_EXTRA = 0xd4;
/** The dealt-in grid object (the thing that draws and deals the slots). */
export const FOLDER_GRID_OBJECT_HANDLER = 0x800838c4;
export const FOLDER_GRID_OBJECT_SIZE = 0x70;
/** The swap-list scroll bar. */
export const FOLDER_PAGER_HANDLER = 0x800888b0;
export const FOLDER_PAGER_SIZE = 0x9c;
/** The card-grid chrome sprite pack (the card-shop pack). */
export const PACK_FOLDER_GRID = 0x063e0000;
/** The folder-record table and its stride. */
export const FOLDER_RECORDS_BASE = 0x8004935c;
export const FOLDER_RECORD_STRIDE = 0x66;
/** The folder's card slots (halfwords) and the per-folder slot stride. */
export const FOLDER_SLOTS_BASE = 0x80049372;
export const FOLDER_SLOT_STRIDE = 0x66;
export const FOLDER_SLOT_COUNT = 40;
/** Per-card copy counts and the album/seen flag: owned[id] at +0x3A2 + id. */
export const FOLDER_OWNED_BASE = 0x80048d34;
export const FOLDER_OWNED_OFF = 0x3a2;
export const FOLDER_CARD_MAX = 0x13b;
/** The language/save cell the text-bank ids derive from. */
export const FOLDER_GRID_SAVE_PTR = 0x8005cca8;
/** The six cursor-pulse frame words. */
export const FOLDER_CURSOR_FRAMES = 0x8008a484;
/** The five card ids that select the alternate detail line. */
export const FOLDER_SPECIAL_CARDS: ReadonlyArray<number> = [0x45, 0x70, 0x9b, 0xc6, 0xf1];

/** Grid geometry (from the decode): nine across, 32px cells. */
export const GRID_COLUMNS = 9;
export const GRID_CELL = 0x20;
export const GRID_X0 = 0x10;
export const GRID_Y0 = 0x3a;

/** Fields of the card grid object (G = obj). */
export const GRID_FIELDS = {
    taskState: 0x0c,
    state: 0x10,
    flag14: 0x14,
    flag18: 0x18,
    layer: 0x54,
    bucket: 0x58,
    folder: 0x5c,
    col: 0x60,
    row: 0x64,
    cursorOn: 0x70,
    listTop: 0x74,
    listCursor: 0x78,
    listCount: 0x7c,
    scrollBlink: 0x80,
    scrollBlinkTime: 0x84,
    /** The per-card "still available" s16 table, 0x13B entries. */
    avail: 0x88,
    /** The per-card remaining-count byte table, 0x13B entries. */
    remain: 0x2fe,
    messageSel: 0x43c,
    messageTimer: 0x440,
    /** The five fold objects (each +0 duration, +4 delta, +8 value, +0xC active). */
    foldWindow: 0x444,
    foldMsg: 0x454,
    foldList: 0x464,
    foldListMsg: 0x474,
    foldWarn: 0x484,
} as const;

/** Fields of the card grid's children block (C = children). */
export const GRID_CHILD = {
    header0: 0x00,
    header1: 0x08,
    footer: 0x04,
    counters: 0x0c,
    listName: 0x24,
    cardName: 0x64,
    rowCount: 0x6c,
    detailTopA: 0x28,
    detailTopB: 0x2c,
    detailTopName: 0x40,
    detailTopStatA: 0x30,
    detailTopStatB: 0x34,
    detailTopStatC: 0x38,
    detailTopStatD: 0x3c,
    detailTopStatE: 0x60,
    detailBotName: 0x44,
    detailBotPairA: 0x48,
    detailBotPairB: 0x4c,
    detailBotStatE: 0x60,
    detailBotStatB: 0x50,
    detailBotStatD: 0x54,
    detailBotStatC: 0x58,
    detailBotStatF: 0x5c,
    cursor: 0xc4,
    message: 0xc8,
    gridObject: 0xcc,
    pager: 0xd0,
} as const;

/** Fields of the dealt-in grid object (O). */
export const GRID_OBJ_FIELDS = {
    taskState: 0x0c, count: 0x5c, layer: 0x54, bucket: 0x58, folderObj: 0x50,
} as const;

/** The scroll bar's setter slots (created by folderPagerCreate). */
export const PAGER_SLOT_A = 0x80088874;
export const PAGER_SLOT_B = 0x80088880;
export const PAGER_SLOT_C = 0x80088894;
export const PAGER_SLOT_D = 0x800888a8;

export interface FolderGridMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** Everything the card grid reaches outside itself. */
export interface FolderGridHost {
    /** The task registry: allocate a registered child class. */
    allocate(handler: number, size: number, extra: number): number;
    /** obj+0x38(obj): the shared task-state advance. */
    baseMethod38(obj: number): void;
    /** obj+0x2C(obj, value): the shared task-state-1 setter. */
    baseMethod2C(obj: number, value: number): void;
    /** L->0x11C(L): the folder list's colour recount. */
    folderRecount(list: number): void;

    // The widget factory and methods.
    createWidget(target: number, kind: number, x: number, y: number): number;
    spawnUiIcon(target: number, order: number, x: number, y: number): number;
    /** w+0x15C(w, value): set_unk_0x58. */
    widget58(widget: number, value: number): void;
    /** w+0x160(w, value): set_unk_0xbf. */
    widgetBF(widget: number, value: number): void;
    /** w+0x114(w, source, index): set a resource line. */
    widgetLine(widget: number, source: number, index: number): void;
    /** w+0x118(w, flag, value): set a numbered line. */
    widgetNumber(widget: number, flag: number, value: number): void;
    /** w+0x144(w, flag): hide / set reveal flag. */
    widgetHide(widget: number, flag: number): void;
    /** w+0x148(w, flag): show. */
    widgetShow(widget: number, flag: number): void;
    /** w+0x84(w, x, y): place a cursor. */
    widget84(widget: number, x: number, y: number): void;
    /** w+0x80(w, value): cursor visible. */
    widget80(widget: number, value: number): void;
    /** w+0x88(w, value): CLUT-pulse selector. */
    widget88(widget: number, value: number): void;
    /** w+0x94(w, value): CLUT-pulse index. */
    widget94(widget: number, value: number): void;

    // The draw context.
    initDrawContext(): void;
    draw74(x: number, y: number): void;
    draw7C(layer: number, bucket: number): void;
    draw88(value: number): void;
    draw8C(a: number, b: number, c: number): void;
    draw94(a: number, b: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;

    // The resident card-view text context.
    initCardView(): void;
    /** F0x8001E7EC(id): resolve the card record. */
    cardResolve(id: number): void;
    /** F0x8001EBCC(): the current record's draw kind (nonzero = alternate). */
    cardBadge(): number;
    /** The current record's byte `index`. */
    cardByte(index: number): number;
    /** F0x8001E98C(x, y): destination pair A. */
    cardSetPairA(x: number, y: number): void;
    /** F0x8001E9A0(x, y): destination pair B. */
    cardSetPairB(x: number, y: number): void;
    /** F0x8001E9B4(col, row): the cell column/row. */
    cardSetSize(col: number, row: number): void;
    /** F0x8001E938(key, arg): dispatch the registered card view. */
    cardDispatch(layer: number, bucket: number): void;
    /** F0x8001E9E0(x, y): draw one cell primitive. */
    cardDrawCell(x: number, y: number): void;
    /** F0x8001E890(): commit the current record's artwork. */
    cardCommit(): void;

    // The window-fold pair.
    foldStart(fold: number, direction: number): void;
    foldTick(fold: number): number;

    // The picture service the pager draws through.
    /** 0x8004DE10+0x17C(layer)->+0x138(layer, bucket): the layer's draw slot. */
    pagerLayerSlot(layer: number, bucket: number): number;
    /** 0x8004DE10+0x158(): a fresh picture primitive. */
    pagerNewPrimitive(): number;
    /** 0x8004DF6C(prim + 0x18, 0xFF000000, prim): emit the primitive. */
    pagerEmit(a0: number, a1: number, a2: number): void;
    /** The pager's four setter slots (0x8C/0x90/0x94/0x98) dispatched. */
    pagerSet(bar: number, slot: number, a: number, b?: number): void;

    // The pad, sound, text banks and clock.
    padPressed(port: number): number;
    padRepeat(port: number): number;
    /** [0x8004B7D0]+0x3F8(port): the pad word held this frame. */
    padHeld(port: number): number;
    padKey(port: number, code: number): number;
    playSound(id: number): void;
    /** [0x80044F4C](id): the text-bank handle getter. */
    resourceGet(id: number): number;
    /** [0x8004DE10+0x188](): the frame counter. */
    frameCount(): number;
    /** [0x8004DF9C](): the per-tick time delta the message timer adds. */
    timeDelta(): number;
}

const G = GRID_FIELDS;
const C = GRID_CHILD;
const O = GRID_OBJ_FIELDS;

const r = (mem: FolderGridMemory, addr: number) => mem.read32(addr) | 0;
const w = (mem: FolderGridMemory, addr: number, value: number) => mem.write32(addr, value | 0);

/** The card id in slot `slot` of folder `folder`. */
function slotCard(mem: FolderGridMemory, folder: number, slot: number): number {
    return mem.read16(FOLDER_SLOTS_BASE + Math.imul(folder, FOLDER_SLOT_STRIDE) + Math.imul(slot, 2)) << 16 >> 16;
}
/** The owned count of card `id`. */
function ownedCount(mem: FolderGridMemory, id: number): number {
    return mem.read8(FOLDER_OWNED_BASE + FOLDER_OWNED_OFF + id) & 0xff;
}

/** padPressed/padRepeat bit for a button code, in the original's short-circuit order. */
function padBit(host: FolderGridHost, code: number, repeat = false): boolean {
    const pressed = host.padPressed(0) | 0;
    if (((pressed >> host.padKey(0, code)) & 1) !== 0) return true;
    if (!repeat) return false;
    const rep = host.padRepeat(0) | 0;
    return ((rep >> host.padKey(0, code)) & 1) !== 0;
}
const pressed = (host: FolderGridHost, code: number) => padBit(host, code, false);
const pressedOrRepeat = (host: FolderGridHost, code: number) => padBit(host, code, true);
/** padHeld bit for a button code (the held reads in states 5 and 0x18). */
function heldBit(host: FolderGridHost, code: number): boolean {
    const held = host.padHeld(0) | 0;
    return ((held >> host.padKey(0, code)) & 1) !== 0;
}
/** padRepeat-only bit for a button code (state 0x18's second page clause). */
function repeatBit(host: FolderGridHost, code: number): boolean {
    const rep = host.padRepeat(0) | 0;
    return ((rep >> host.padKey(0, code)) & 1) !== 0;
}

/** F0x80086574(obj, ctx): the card grid's registered tick. */
export function folderCardGridTick(
    mem: FolderGridMemory,
    obj: number,
    ctx: number,
    host: FolderGridHost,
): void {
    const state = r(mem, obj + G.taskState);
    if (state === 1) {
        folderCardGridMachine(mem, obj, ctx, host);
        folderCardGridDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.baseMethod38(obj);
    folderGridCreateChrome(mem, obj, ctx, host);
    for (const off of [G.foldWindow, G.foldMsg, G.foldList, G.foldListMsg, G.foldWarn]) {
        w(mem, obj + off, 0xa);
    }
}

/** F0x8008397C(obj, ctx): build the editor's children widgets. */
export function folderGridCreateChrome(
    mem: FolderGridMemory,
    obj: number,
    ctx: number,
    host: FolderGridHost,
): void {
    const layer = r(mem, obj + G.layer);
    const pages = r(mem, obj + G.bucket);
    const tag = (widget: number): number => { host.widget58(widget, (pages - 1) | 0); return widget; };

    let widget = host.createWidget(layer, 1, 0xc1, 0x17);
    w(mem, ctx + C.header0, widget); tag(widget);
    widget = host.createWidget(layer, 1, 0x15, 0x18);
    w(mem, ctx + C.header1, widget); tag(widget);
    for (let i = 0; i < 6; i++) {
        widget = host.createWidget(layer, 1, 0x34 + Math.imul(i, 0x23), 0x29);
        w(mem, ctx + C.counters + i * 4, widget); tag(widget);
    }
    widget = host.createWidget(layer, 1, 0x96, 0xcc); w(mem, ctx + C.footer, widget);
    widget = host.createWidget(layer, 1, 0x96, 0xbd); w(mem, ctx + C.listName, widget);
    widget = host.createWidget(layer, 1, 0x115, 0x26); w(mem, ctx + C.detailTopA, widget);
    widget = host.createWidget(layer, 1, 0x126, 0x26); w(mem, ctx + C.detailTopB, widget);
    widget = host.createWidget(layer, 1, 0x50, 0x17); w(mem, ctx + C.detailTopName, widget);
    widget = host.createWidget(layer, 1, 0xce, 0x17); w(mem, ctx + C.detailTopStatA, widget);
    widget = host.createWidget(layer, 1, 0xf0, 0x17); w(mem, ctx + C.detailTopStatB, widget);
    widget = host.createWidget(layer, 1, 0xce, 0x24); w(mem, ctx + C.detailTopStatC, widget);
    widget = host.createWidget(layer, 1, 0xf0, 0x24); w(mem, ctx + C.detailTopStatD, widget);
    for (let i = 0; i < 8; i++) {
        const y = 0x27 + Math.imul(i, 0xe);
        widget = host.createWidget(layer, 1, 0xa3, y);
        w(mem, ctx + C.cardName + Math.imul(i, 0xc), widget); tag(widget);
        widget = host.createWidget(layer, 1, 0x111, y);
        w(mem, ctx + C.listName + 0x44 + Math.imul(i, 0xc), widget); tag(widget);
        widget = host.createWidget(layer, 1, 0x120, y);
        w(mem, ctx + C.rowCount + Math.imul(i, 0xc), widget); tag(widget);
    }
    const cursor = host.spawnUiIcon(layer, (pages - 1) | 0, 0x89, 0x27) >>> 0;
    w(mem, ctx + C.cursor, cursor);
    host.widget80(cursor, 0);
    widget = host.createWidget(layer, 1, 0x88, 0xa1); w(mem, ctx + C.detailBotName, widget);
    widget = host.createWidget(layer, 1, 0x115, 0xa1); w(mem, ctx + C.detailBotPairA, widget);
    widget = host.createWidget(layer, 1, 0x126, 0xa1); w(mem, ctx + C.detailBotPairB, widget);
    widget = host.createWidget(layer, 1, 0x50, 0xb8); w(mem, ctx + C.detailTopStatE, widget);
    widget = host.createWidget(layer, 1, 0xce, 0xb8); w(mem, ctx + C.detailBotStatB, widget);
    widget = host.createWidget(layer, 1, 0xf0, 0xb8); w(mem, ctx + C.detailBotStatD, widget);
    widget = host.createWidget(layer, 1, 0xce, 0xc5); w(mem, ctx + C.detailBotStatC, widget);
    widget = host.createWidget(layer, 1, 0xf0, 0xc5); w(mem, ctx + C.detailBotStatF, widget);
    widget = host.createWidget(layer, 1, 0x3e, 0x6b); w(mem, ctx + C.message, widget);
    host.widgetBF(widget, 2);
}

/** F0x80085210(obj, ctx): the editor state machine. */
export function folderCardGridMachine(
    mem: FolderGridMemory,
    obj: number,
    ctx: number,
    host: FolderGridHost,
): void {
    const state = r(mem, obj + G.state);
    const child = (off: number) => r(mem, ctx + off);

    switch (state) {
        default: {
            host.foldStart(obj + G.foldWindow, 1);
            w(mem, obj + G.state, state + 1);
            break;
        }
        case 0x1: {
            if (host.foldTick(obj + G.foldWindow) !== 0) {
                w(mem, obj + G.messageTimer, 0);
                folderEditorHeader(mem, obj, ctx, 1, host);
                folderWorkingTable(mem, obj, host);
                w(mem, ctx + C.gridObject, folderGridCreateObjects(mem, obj, host));
                w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            }
            break;
        }
        case 0x2: {
            const gridObject = child(C.gridObject);
            if ((r(mem, gridObject + O.taskState) | 0) === 2) {
                w(mem, obj + G.cursorOn, 1);
                w(mem, obj + G.state, 5);
            }
            break;
        }
        case 0x5: {
            const before = r(mem, obj + G.col) + Math.imul(r(mem, obj + G.row), 9);
            if (pressedOrRepeat(host, 7)) {
                const next = r(mem, obj + G.col) - 1;
                w(mem, obj + G.col, next < 0 ? 0 : next);
            } else if (pressedOrRepeat(host, 5)) {
                const next = r(mem, obj + G.col) + 1;
                const limit = r(mem, obj + G.row) === 4 ? 4 : 9;
                w(mem, obj + G.col, next >= limit ? limit - 1 : next);
            }
            if (pressedOrRepeat(host, 4)) {
                const next = r(mem, obj + G.row) - 1;
                w(mem, obj + G.row, next < 0 ? 0 : next);
            } else if (pressedOrRepeat(host, 6)) {
                const next = r(mem, obj + G.row) + 1;
                if (r(mem, obj + G.col) >= 4) w(mem, obj + G.row, next >= 4 ? 3 : next);
                else w(mem, obj + G.row, next >= 5 ? 4 : next);
            }
            folderEditorHeader(mem, obj, ctx, 1, host);
            if (before !== r(mem, obj + G.col) + Math.imul(r(mem, obj + G.row), 9)) {
                host.playSound(0x4001b);
                break;
            }
            if (!heldBit(host, 0xa)) {
                if (pressed(host, 0xb)) { host.playSound(0x4001b); w(mem, obj + G.state, 0xa); break; }
            }
            if (pressed(host, 0xd)) {
                if (r(mem, obj + G.listCount) !== 0) { host.playSound(0x4001c); w(mem, obj + G.state, 0x14); break; }
            } else if (pressed(host, 0xe)) {
                host.playSound(0x800450bd); w(mem, obj + G.state, 0x32); break;
            } else if (pressed(host, 0xc)) {
                host.playSound(0x800450bd); w(mem, obj + G.state, 0x1e); break;
            }
            break;
        }
        case 0xa: {
            w(mem, obj + G.cursorOn, 0);
            const next = 1 - r(mem, obj + G.messageSel);
            w(mem, obj + G.messageSel, next);
            if (next !== 0) {
                host.foldStart(obj + G.foldMsg, 1);
                w(mem, obj + G.state, 0xb); w(mem, obj + G.flag14, 0);
            } else {
                folderEditorHeader(mem, obj, ctx, 1, host);
                host.foldStart(obj + G.foldMsg, 0);
                w(mem, obj + G.state, 0xb); w(mem, obj + G.flag14, 1);
            }
            break;
        }
        case 0xb: {
            if (host.foldTick(obj + G.foldMsg) !== 0) {
                if (r(mem, obj + G.flag14) === 0) folderEditorHeader(mem, obj, ctx, 1, host);
                w(mem, obj + G.cursorOn, 1);
                host.baseMethod2C(obj, 5);
            }
            break;
        }
        case 0x14: {
            w(mem, child(C.gridObject) + O.taskState, 3);
            folderWorkingTable(mem, obj, host);
            host.foldStart(obj + G.foldList, 1);
            for (;;) {
                const cursor = r(mem, obj + G.listCursor);
                const previous = cursor - 1;
                if (mem.read16(obj + Math.imul(cursor + r(mem, obj + G.listTop), 2) + G.avail) !== 0) break;
                w(mem, obj + G.listCursor, previous);
                if (previous < 0) {
                    w(mem, obj + G.listCursor, 0);
                    const top = r(mem, obj + G.listTop) - 1;
                    w(mem, obj + G.listTop, top < 0 ? 0 : top);
                }
            }
            w(mem, obj + G.cursorOn, 0);
            host.foldStart(obj + G.foldWindow, 0);
            if (r(mem, obj + G.messageSel) !== 0) {
                w(mem, obj + G.foldMsg + 8, 0);
                w(mem, obj + G.messageSel, 0);
            }
            folderEditorHeader(mem, obj, ctx, 0, host);
            w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            break;
        }
        case 0x15: {
            if (host.foldTick(obj + G.foldWindow) !== 0) w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            break;
        }
        case 0x16: {
            if (host.foldTick(obj + G.foldList) !== 0) {
                folderSwapRowsFill(mem, obj, ctx, 1, host);
                host.foldStart(obj + G.foldListMsg, 1);
                w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            }
            break;
        }
        case 0x17: {
            if (host.foldTick(obj + G.foldListMsg) !== 0) {
                if (r(mem, obj + G.listCount) >= 9 && child(C.pager) === 0) {
                    const pager = folderPagerCreate(mem, host);
                    w(mem, ctx + C.pager, pager);
                    host.pagerSet(pager, 0x8c, 0x125, 0xc);
                    host.pagerSet(pager, 0x90, 0x2a, 0x8f);
                    host.pagerSet(pager, 0x94, 8, r(mem, obj + G.listCount));
                    host.pagerSet(pager, 0x98, r(mem, obj + G.listTop));
                }
                const cursor = child(C.cursor);
                host.widget84(cursor, 0x89, Math.imul(r(mem, obj + G.listTop), 0xe) + 0x27);
                host.widget80(cursor, 1);
                folderDetailPanel(mem, obj, ctx, 1, host);
                w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            }
            break;
        }
        case 0x18: {
            const beforeRow = r(mem, obj + G.listCursor);
            const beforeTop = r(mem, obj + G.listTop);
            const after = beforeRow + beforeTop;
            if (r(mem, obj + G.listCount) >= 9) {
                if ((!heldBit(host, 0xb) && pressed(host, 0xa)) || (!heldBit(host, 0xb) && repeatBit(host, 0xa))) {
                    const next = r(mem, obj + G.listCursor) - 7;
                    w(mem, obj + G.listCursor, next < 0 ? 0 : next);
                } else if ((!heldBit(host, 0xa) && pressed(host, 0xb)) || (!heldBit(host, 0xa) && repeatBit(host, 0xb))) {
                    const limit = r(mem, obj + G.listCount) - 8;
                    let value = 0;
                    for (;;) {
                        const next = r(mem, obj + G.listCursor) + 1;
                        w(mem, obj + G.listCursor, next);
                        value += 1;
                        if (limit >= next) { if (value < 7) continue; }
                        else w(mem, obj + G.listCursor, limit);
                        break;
                    }
                }
            }
            if (after === r(mem, obj + G.listCursor) + r(mem, obj + G.listTop)) {
                if (pressedOrRepeat(host, 4)) {
                    const next = r(mem, obj + G.listTop) - 1;
                    w(mem, obj + G.listTop, next < 0 ? 0 : next);
                    if (next < 0) {
                        const cursor = r(mem, obj + G.listCursor) - 1;
                        w(mem, obj + G.listCursor, cursor < 0 ? 0 : cursor);
                    }
                } else if (pressedOrRepeat(host, 6)) {
                    if (r(mem, obj + G.listCount) >= 9) {
                        const next = r(mem, obj + G.listTop) + 1;
                        w(mem, obj + G.listTop, next);
                        if (next >= 8) {
                            w(mem, obj + G.listTop, 7);
                            const cursor = r(mem, obj + G.listCursor) + 1;
                            const limit = r(mem, obj + G.listCount) - 8;
                            w(mem, obj + G.listCursor, limit < cursor ? limit : cursor);
                        }
                    } else {
                        const next = r(mem, obj + G.listTop) + 1;
                        const limit = r(mem, obj + G.listCount) - 1;
                        w(mem, obj + G.listTop, limit < next ? limit : next);
                    }
                }
            }
            if (child(C.pager) !== 0 && beforeRow !== r(mem, obj + G.listCursor)) {
                pagerSetD(mem, child(C.pager), r(mem, obj + G.listCursor));
            }
            if (after !== r(mem, obj + G.listCursor) + r(mem, obj + G.listTop)) {
                host.playSound(0x8004513e);
                host.widget84(child(C.cursor), 0x89, Math.imul(r(mem, obj + G.listTop), 0xe) + 0x27);
                folderSwapRowsFill(mem, obj, ctx, 1, host);
                folderDetailPanel(mem, obj, ctx, 1, host);
            } else if (pressed(host, 0xd)) {
                const slot = r(mem, obj + G.col) + Math.imul(r(mem, obj + G.row), 9);
                const chosen = mem.read16(obj + Math.imul(r(mem, obj + G.listCursor) + r(mem, obj + G.listTop), 2) + G.avail);
                const current = slotCard(mem, r(mem, obj + G.folder), slot);
                host.playSound(0x8004503c);
                if (chosen !== current && ownedCount(mem, chosen) - mem.read8(obj + G.remain + chosen) >= 4) {
                    w(mem, obj + G.state, 0x3c);
                } else {
                    mem.write16(FOLDER_SLOTS_BASE + Math.imul(r(mem, obj + G.folder), FOLDER_SLOT_STRIDE) + Math.imul(slot, 2), chosen & 0xffff);
                    host.folderRecount(r(mem, obj + 0x50));
                    w(mem, obj + G.state, r(mem, obj + G.state) + 1);
                }
            } else if (pressed(host, 0xe)) {
                host.playSound(0x800450bd);
                w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            }
            break;
        }
        case 0x19: {
            host.foldStart(obj + G.foldList, 0);
            folderSwapRowsFill(mem, obj, ctx, 0, host);
            host.foldStart(obj + G.foldListMsg, 0);
            folderDetailPanel(mem, obj, ctx, 0, host);
            host.widget80(child(C.cursor), 0);
            if (child(C.pager) !== 0) w(mem, child(C.pager) + 0xc, 3);
            w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            break;
        }
        case 0x1a: {
            host.foldTick(obj + G.foldList);
            if (host.foldTick(obj + G.foldListMsg) !== 0) {
                w(mem, obj + G.listTop, 0);
                w(mem, obj + G.listCursor, 0);
                w(mem, obj + G.state, 0);
            }
            break;
        }
        case 0x1e: {
            w(mem, child(C.gridObject) + O.taskState, 3);
            folderWorkingTable(mem, obj, host);
            w(mem, obj + G.flag18, 0);
            w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            host.foldStart(obj + G.foldWindow, 0);
            w(mem, obj + G.cursorOn, 0);
            host.foldStart(obj + G.foldWindow, 0);
            w(mem, obj + G.foldMsg + 8, 0);
            w(mem, obj + G.messageSel, 0);
            folderEditorHeader(mem, obj, ctx, 0, host);
            break;
        }
        case 0x1f: {
            if (host.foldTick(obj + G.foldListMsg) !== 0) w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            break;
        }
        case 0x20: {
            const base = FOLDER_OWNED_BASE + 0x63e + Math.imul(r(mem, obj + G.folder), FOLDER_SLOT_STRIDE);
            for (let i = 0; i < 0x27; i++) {
                for (let j = i + 1; j < 0x28; j++) {
                    const a = mem.read16(base + i * 2) << 16 >> 16;
                    const b = mem.read16(base + j * 2) << 16 >> 16;
                    if (b < a) {
                        mem.write16(base + i * 2, b & 0xffff);
                        mem.write16(base + j * 2, a & 0xffff);
                    }
                }
            }
            w(mem, obj + G.state, 0);
            break;
        }
        case 0x32: {
            w(mem, child(C.gridObject) + O.taskState, 3);
            w(mem, obj + G.cursorOn, 0);
            host.foldStart(obj + G.foldWindow, 0);
            if (r(mem, obj + G.messageSel) !== 0) {
                w(mem, obj + G.foldMsg + 8, 0);
                w(mem, obj + G.messageSel, 0);
            }
            folderEditorHeader(mem, obj, ctx, 0, host);
            w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            break;
        }
        case 0x33: {
            if (host.foldTick(obj + G.foldWindow) !== 0) w(mem, obj + G.taskState, 3);
            break;
        }
        case 0x3c: {
            host.widget88(child(C.cursor), 7);
            host.widget94(child(C.cursor), 1);
            host.foldStart(obj + G.foldWarn, 1);
            w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            break;
        }
        case 0x3d: {
            if (host.foldTick(obj + G.foldWarn) !== 0) {
                host.widgetLine(child(C.message), host.resourceGet(r(mem, FOLDER_GRID_SAVE_PTR) + 0x32), 0x1e);
                w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            }
            break;
        }
        case 0x3e: {
            if (pressed(host, 0xd)) {
                host.playSound(0x4001c);
                host.widgetHide(child(C.message), 0);
                host.foldStart(obj + G.foldWarn, 0);
                w(mem, obj + G.state, r(mem, obj + G.state) + 1);
            }
            break;
        }
        case 0x3f: {
            if (host.foldTick(obj + G.foldWarn) !== 0) {
                host.widget88(child(C.cursor), 0);
                host.widget94(child(C.cursor), 0);
                w(mem, obj + G.state, 0x17);
            }
            break;
        }
    }

    const timer = r(mem, obj + G.messageTimer) + (host.timeDelta() | 0);
    if (timer >= 0x79) w(mem, obj + G.messageTimer, timer - 0x78);
    else w(mem, obj + G.messageTimer, timer);
}

/** F0x80083D28(obj, ctx, show): fill or clear the header, counters and footer. */
export function folderEditorHeader(
    mem: FolderGridMemory,
    obj: number,
    ctx: number,
    show: number,
    host: FolderGridHost,
): void {
    const bank = (off: number) => host.resourceGet(r(mem, FOLDER_GRID_SAVE_PTR) + off);
    const child = (off: number) => r(mem, ctx + off);
    const folder = r(mem, obj + G.folder);
    const slot = r(mem, obj + G.col) + Math.imul(r(mem, obj + G.row), 9);

    const hideTop = () => {
        host.widgetHide(child(C.detailTopA), 0);
        host.widgetHide(child(C.detailTopB), 0);
        host.widgetHide(child(C.detailTopName), 0);
    };
    const hideStats = () => {
        host.widgetHide(child(C.detailTopStatA), 0);
        host.widgetHide(child(C.detailTopStatB), 0);
        host.widgetHide(child(C.detailTopStatC), 0);
    };

    if (show !== 0) {
        host.widgetLine(child(C.header0), bank(0x32), 4);
        host.widgetLine(child(C.header1), FOLDER_RECORDS_BASE + Math.imul(folder, FOLDER_RECORD_STRIDE), -1);
        for (let i = 0; i < 6; i++) {
            const counter = r(mem, r(mem, obj + 0x50) + Math.imul(i, 4) + Math.imul(folder, 0x18) + 0x74) | 0;
            host.widgetNumber(child(C.counters + i * 4), 0, counter);
            host.widgetShow(child(C.counters + i * 4), 1);
        }
        const footer = r(mem, obj + G.messageTimer) < 0x3c ? r(mem, obj + G.messageSel) + 0x1c : 0x1f;
        host.widgetLine(child(C.footer), bank(0x32), footer);
        const card = slotCard(mem, folder, slot);
        host.widgetLine(child(C.listName), bank(0x16), card);
        if (r(mem, obj + G.messageSel) === 0) {
            hideTop();
            hideStats();
            host.widgetHide(child(C.detailTopStatD), 0);
            return;
        }
        host.initCardView();
        host.cardResolve(card);
        if (host.cardBadge() !== 0) {
            host.widgetHide(child(C.detailTopA), 0);
            host.widgetHide(child(C.detailTopB), 0);
            host.widgetLine(child(C.detailTopName), bank(0x1d), card);
            hideStats();
            host.widgetHide(child(C.detailTopStatD), 0);
            return;
        }
        host.widgetLine(child(C.detailTopA), bank(0x32), 8);
        host.widgetNumber(child(C.detailTopB), 0, host.cardByte(5));
        host.widgetShow(child(C.detailTopB), 1);
        if (FOLDER_SPECIAL_CARDS.includes(card)) {
            host.widgetLine(child(C.detailTopName), host.resourceGet(r(mem, FOLDER_GRID_SAVE_PTR) + 0x1d), card);
            hideStats();
            host.widgetHide(child(C.detailTopStatD), 0);
            return;
        }
        host.widgetHide(child(C.detailTopName), 0);
        host.widgetLine(child(C.detailTopStatA), bank(0x32), 0x11);
        host.widgetNumber(child(C.detailTopStatB), 0, host.cardByte(1));
        host.widgetShow(child(C.detailTopStatB), 1);
        host.widgetLine(child(C.detailTopStatC), bank(0x32), 0x12);
        host.widgetNumber(child(C.detailTopStatD), 0, host.cardByte(2));
        host.widgetShow(child(C.detailTopStatD), 1);
        return;
    }

    host.widgetHide(child(C.header0), 0);
    host.widgetHide(child(C.header1), 0);
    for (let i = 0; i < 6; i++) host.widgetHide(child(C.counters + i * 4), 0);
    host.widgetHide(child(C.footer), 0);
    host.widgetHide(child(C.listName), 0);
    hideTop();
    hideStats();
    host.widgetHide(child(C.detailTopStatD), 0);
}

/** F0x80084278(obj, ctx, show): fill or clear the eight swap-list rows. */
export function folderSwapRowsFill(
    mem: FolderGridMemory,
    obj: number,
    ctx: number,
    show: number,
    host: FolderGridHost,
): void {
    const base = ctx + C.cardName;
    if (show !== 0) {
        for (let i = 0; i < 8; i++) {
            const row = base + Math.imul(i, 0xc);
            const card = mem.read16(obj + Math.imul(r(mem, obj + G.listCursor) + i, 2) + G.avail) << 16 >> 16;
            if (card !== 0) {
                host.widgetLine(r(mem, row) >>> 0, host.resourceGet(r(mem, FOLDER_GRID_SAVE_PTR) + 0x16), card);
                host.widgetLine(r(mem, row + 4) >>> 0, host.resourceGet(r(mem, FOLDER_GRID_SAVE_PTR) + 0x32), 8);
                host.widgetNumber(r(mem, row + 8) >>> 0, 0, mem.read8(obj + G.remain + card) & 0xff);
                host.widgetShow(r(mem, row + 8) >>> 0, 1);
            } else {
                host.widgetHide(r(mem, row) >>> 0, 0);
                host.widgetHide(r(mem, row + 4) >>> 0, 0);
                host.widgetHide(r(mem, row + 8) >>> 0, 0);
            }
        }
        return;
    }
    for (let i = 0; i < 8; i++) {
        const row = base + Math.imul(i, 0xc);
        host.widgetHide(r(mem, row) >>> 0, 0);
        host.widgetHide(r(mem, row + 4) >>> 0, 0);
        host.widgetHide(r(mem, row + 8) >>> 0, 0);
    }
}

/** F0x80084440(obj, ctx, show): fill or clear the bottom card-detail panel. */
export function folderDetailPanel(
    mem: FolderGridMemory,
    obj: number,
    ctx: number,
    show: number,
    host: FolderGridHost,
): void {
    const bank = (off: number) => host.resourceGet(r(mem, FOLDER_GRID_SAVE_PTR) + off);
    const child = (off: number) => r(mem, ctx + off);
    const card = mem.read16(obj + Math.imul(r(mem, obj + G.listCursor) + r(mem, obj + G.listTop), 2) + G.avail) << 16 >> 16;

    if (show !== 0) {
        host.widgetLine(child(C.detailBotName), bank(0x16), card);
        host.initCardView();
        host.cardResolve(card);
        if (host.cardBadge() !== 0) {
            host.widgetHide(child(C.detailBotPairA), 0);
            host.widgetHide(child(C.detailBotPairB), 0);
            host.widgetLine(child(C.detailBotStatE), bank(0x1d), card);
            host.widgetHide(child(C.detailBotStatB), 0);
            host.widgetHide(child(C.detailBotStatD), 0);
            host.widgetHide(child(C.detailBotStatC), 0);
            host.widgetHide(child(C.detailBotStatF), 0);
            return;
        }
        host.widgetLine(child(C.detailBotPairA), bank(0x32), 8);
        host.widgetNumber(child(C.detailBotPairB), 0, host.cardByte(5));
        host.widgetShow(child(C.detailBotPairB), 1);
        if (FOLDER_SPECIAL_CARDS.includes(card)) {
            host.widgetLine(child(C.detailBotStatE), host.resourceGet(r(mem, FOLDER_GRID_SAVE_PTR) + 0x1d), card);
            host.widgetHide(child(C.detailBotStatB), 0);
            host.widgetHide(child(C.detailBotStatD), 0);
            host.widgetHide(child(C.detailBotStatC), 0);
            host.widgetHide(child(C.detailBotStatF), 0);
            return;
        }
        host.widgetHide(child(C.detailBotStatE), 0);
        host.widgetLine(child(C.detailBotStatB), bank(0x32), 0x11);
        host.widgetNumber(child(C.detailBotStatD), 0, host.cardByte(1));
        host.widgetShow(child(C.detailBotStatD), 1);
        host.widgetLine(child(C.detailBotStatC), bank(0x32), 0x12);
        host.widgetNumber(child(C.detailBotStatF), 0, host.cardByte(2));
        host.widgetShow(child(C.detailBotStatF), 1);
        return;
    }
    host.widgetHide(child(C.detailBotName), 0);
    host.widgetHide(child(C.detailBotPairA), 0);
    host.widgetHide(child(C.detailBotPairB), 0);
    host.widgetHide(child(C.detailBotStatE), 0);
    host.widgetHide(child(C.detailBotStatB), 0);
    host.widgetHide(child(C.detailBotStatD), 0);
    host.widgetHide(child(C.detailBotStatC), 0);
    host.widgetHide(child(C.detailBotStatF), 0);
}

/** F0x800847C0(obj): rebuild the "still placeable" table. */
export function folderWorkingTable(mem: FolderGridMemory, obj: number, _host: FolderGridHost): void {
    for (let i = 0; i < FOLDER_CARD_MAX; i++) {
        mem.write16(obj + Math.imul(i, 2) + G.avail, 0);
        mem.write8(obj + i + G.remain, ownedCount(mem, i));
    }
    const folder = r(mem, obj + G.folder);
    for (let i = 0; i < FOLDER_SLOT_COUNT; i++) {
        const card = slotCard(mem, folder, i);
        mem.write8(obj + card + G.remain, (mem.read8(obj + card + G.remain) - 1) & 0xff);
    }
    w(mem, obj + G.listCount, 0);
    let count = 0;
    for (let i = 0; i < FOLDER_CARD_MAX; i++) {
        const remaining = (mem.read8(obj + i + G.remain) << 24) >> 24;
        if (remaining > 0) {
            mem.write16(obj + Math.imul(count, 2) + G.avail, i);
            count += 1;
            w(mem, obj + G.listCount, r(mem, obj + G.listCount) + 1);
        }
    }
}

/** F0x80083934(obj): make the dealt-in grid object (handler 0x800838C4). */
export function folderGridCreateObjects(mem: FolderGridMemory, obj: number, host: FolderGridHost): number {
    const grid = host.allocate(FOLDER_GRID_OBJECT_HANDLER, FOLDER_GRID_OBJECT_SIZE, 0) >>> 0;
    w(mem, grid + O.layer, 0x1000);
    w(mem, grid + O.bucket, 5);
    w(mem, grid + O.folderObj, obj | 0);
    return grid;
}

/** F0x800838C4(obj): the dealt-in grid object's tick. */
export function folderGridObjectsTick(
    mem: FolderGridMemory,
    obj: number,
    host: FolderGridHost,
): void {
    const state = r(mem, obj + O.taskState);
    switch (state) {
        default:
            host.baseMethod38(obj);
            w(mem, obj + O.count, 0);
            return;
        case 1:
            folderGridDealIn(mem, obj, host);
        /* fallthrough */
        case 2:
            folderGridDrawSlots(mem, obj, host);
        /* fallthrough */
        case 3:
            return;
    }
}

/** F0x800837B4(obj): deal one slot per frame through the card-view context. */
export function folderGridDealIn(mem: FolderGridMemory, obj: number, host: FolderGridHost): void {
    const count = r(mem, obj + O.count) + 1;
    w(mem, obj + O.count, count);
    if (count >= 0x29) {
        w(mem, obj + O.taskState, 2);
        w(mem, obj + O.count, 0x28);
        return;
    }
    const folderObj = r(mem, obj + O.folderObj);
    host.initCardView();
    host.cardResolve(slotCard(mem, r(mem, folderObj + G.folder), count - 1));
    host.cardSetPairA(0x140, 0x100);
    host.cardSetPairB(0x300, 0x100);
    host.cardSetSize((count - 1) % 9, Math.trunc((count - 1) / 9));
    host.cardCommit();
}

/** F0x800835D8(obj): draw the dealt-in card faces. */
export function folderGridDrawSlots(mem: FolderGridMemory, obj: number, host: FolderGridHost): void {
    host.initDrawContext();
    host.draw74(0x280, 0);
    host.draw7C(r(mem, obj + O.layer), r(mem, obj + O.bucket));
    host.initCardView();
    host.cardSetPairA(0x140, 0x100);
    host.cardSetPairB(0x300, 0x100);
    host.cardDispatch(r(mem, obj + O.layer), r(mem, obj + O.bucket));
    const folderObj = r(mem, obj + O.folderObj);
    const count = r(mem, obj + O.count);
    for (let i = 0; i < count; i++) {
        host.cardResolve(slotCard(mem, r(mem, folderObj + G.folder), i));
        const col = i % 9;
        const row = Math.trunc(i / 9);
        const x = (col << 5) + GRID_X0;
        const y = (row << 5) + GRID_Y0;
        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), (host.cardByte(0) & 0xff) + 0x52, x, y);
        host.cardSetSize(col, row);
        host.cardDrawCell(x, y);
    }
}

/** F0x80084890(obj): the editor's draw intents. */
export function folderCardGridDraw(mem: FolderGridMemory, obj: number, host: FolderGridHost): void {
    const G_ = G;
    const layer = r(mem, obj + G_.layer);
    const bucket = r(mem, obj + G_.bucket);

    host.initDrawContext();
    host.draw74(0x280, 0);
    host.draw7C(layer, (bucket - 2) | 0);
    if (r(mem, obj + G_.cursorOn) !== 0) {
        if ((host.frameCount() - r(mem, obj + 0x6c)) >= 5) {
            w(mem, obj + 0x6c, host.frameCount());
            const frame = r(mem, obj + 0x68) + 1;
            w(mem, obj + 0x68, frame >= 6 ? 0 : frame);
        }
        host.draw88(r(mem, FOLDER_CURSOR_FRAMES + Math.imul(r(mem, obj + 0x68), 4)));
        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0x43,
            (r(mem, obj + G_.col) << 5) | GRID_X0, (r(mem, obj + G_.row) << 5) + GRID_Y0);
        host.draw88(0);
    }

    if (r(mem, obj + G_.foldMsg + 8) !== 0) {
        const value = r(mem, obj + G_.foldMsg + 8);
        if (value !== 0x1000) {
            host.draw8C(value, 0x1000, 0x1000);
            host.draw94(0x140, 0x25);
        }
        const card = slotCard(mem, r(mem, obj + G_.folder), r(mem, obj + G_.col) + Math.imul(r(mem, obj + G_.row), 9));
        host.initCardView();
        host.cardResolve(card);
        const kind = host.cardBadge();
        if (kind !== 0) {
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), kind + 0x11, 0x103, 0x24);
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xd, 0xfc, 0x22);
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xb, 0x4a, 0x12);
        } else {
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), (host.cardByte(0) & 0xff) + 0x13, 0x103, 0x24);
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xd, 0xfc, 0x22);
            if (FOLDER_SPECIAL_CARDS.includes(card)) host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xb, 0x4a, 0x12);
            else host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xc, 0xc7, 0x12);
        }
    }

    if (r(mem, obj + G_.foldWindow + 8) !== 0) {
        const value = r(mem, obj + G_.foldWindow + 8);
        host.draw8C(0x1000, value, 0x1000);
        if (value !== 0x1000) host.draw94(0xa0, 0x74);
        host.draw7C(layer, bucket);
        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0x40, 0x10, 0x15);
    }

    host.initDrawContext();
    host.draw74(0x280, 0);
    host.draw7C(layer, bucket);
    if (r(mem, obj + G_.foldList + 8) !== 0) {
        const value = r(mem, obj + G_.foldList + 8);
        if (value !== 0x1000) {
            host.draw8C(value, 0x1000, 0x1000);
            host.draw94(0x140, 0x5c);
        } else {
            let y = 0x27;
            for (let i = 0; i < 8; i++) {
                const card = mem.read16(obj + Math.imul(r(mem, obj + G_.listCursor) + i, 2) + G_.avail) << 16 >> 16;
                if (card !== 0) {
                    host.initCardView();
                    host.cardResolve(card);
                    if (host.cardBadge() !== 0) {
                        host.draw88((host.cardByte(0) & 0xff) - 1);
                        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0x4b, 0x94, y);
                    } else {
                        host.draw88(0);
                        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), (host.cardByte(0) & 0xff) + 0x4b, 0x94, y);
                    }
                    host.draw88(0);
                    host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0x31, 0x94, y);
                }
                y += 0xe;
            }
            if (r(mem, obj + G_.listCount) >= 9) {
                if ((host.frameCount() - r(mem, obj + G_.scrollBlinkTime)) >= 9) {
                    w(mem, obj + G_.scrollBlinkTime, host.frameCount());
                    w(mem, obj + G_.scrollBlink, 1 - r(mem, obj + G_.scrollBlink));
                }
                if (r(mem, obj + G_.scrollBlink) !== 0) {
                    if (r(mem, obj + G_.listCursor) > 0) host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0x45, 0x126, 0x22);
                    if (r(mem, obj + G_.listCursor) < r(mem, obj + G_.listCount) - 8) {
                        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0x46, 0x126, 0x8f);
                    }
                }
            }
        }
        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0x3f, 0x81, 0x1e);
    }

    if (r(mem, obj + G_.foldListMsg + 8) !== 0) {
        const value = r(mem, obj + G_.foldListMsg + 8);
        if (value !== 0x1000) {
            host.draw8C(value, 0x1000, 0x1000);
            host.draw94(0x140, 0x25);
        }
        const card = mem.read16(obj + Math.imul(r(mem, obj + G_.listCursor) + r(mem, obj + G_.listTop), 2) + G_.avail) << 16 >> 16;
        host.initCardView();
        host.cardResolve(card);
        if (host.cardBadge() !== 0) {
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), host.cardBadge() + 0x11, 0x103, 0x9f);
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xd, 0xfc, 0x9d);
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xb, 0x4a, 0xb3);
        } else {
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), (host.cardByte(0) & 0xff) + 0x13, 0x103, 0x9f);
            host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xd, 0xfc, 0x9d);
            if (FOLDER_SPECIAL_CARDS.includes(card)) host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xb, 0x4a, 0xb3);
            else host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xc, 0xc7, 0xb3);
        }
        if (value !== 0x1000) host.draw94(0x140, 0xa8);
        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0xa, 0x82, 0x9d);
    }

    if (r(mem, obj + G_.foldWarn + 8) !== 0) {
        const value = r(mem, obj + G_.foldWarn + 8);
        host.draw8C(0x1000, value, 0x1000);
        if (value !== 0x1000) host.draw94(0, 0x78);
        host.draw7C(layer, (bucket - 3) | 0);
        host.drawSprite(host.packResolve(PACK_FOLDER_GRID), 0x36, 0, 0x64);
    }
}

/** F0x80088AC8(): make the swap-list scroll bar. */
export function folderPagerCreate(mem: FolderGridMemory, host: FolderGridHost): number {
    const pager = host.allocate(FOLDER_PAGER_HANDLER, FOLDER_PAGER_SIZE, 0) >>> 0;
    w(mem, pager + 0x8c, PAGER_SLOT_A);
    w(mem, pager + 0x90, PAGER_SLOT_B);
    w(mem, pager + 0x94, PAGER_SLOT_C);
    w(mem, pager + 0x98, PAGER_SLOT_D);
    w(mem, pager + 0x50, 0x1000);
    w(mem, pager + 0x54, 3);
    return pager;
}

/** F0x80088874(bar, a, b): store the bar's two placement words. */
export function pagerSetA(mem: FolderGridMemory, bar: number, a: number, b: number): void {
    w(mem, bar + 0x58, a); w(mem, bar + 0x60, b);
}
/** F0x80088880(bar, a, b): store the range and enable the scroll. */
export function pagerSetB(mem: FolderGridMemory, bar: number, a: number, b: number): void {
    w(mem, bar + 0x7c, a); w(mem, bar + 0x80, b); w(mem, bar + 0x78, 1);
}
/** F0x80088894(bar, a, b): store the track size and enable. */
export function pagerSetC(mem: FolderGridMemory, bar: number, a: number, b: number): void {
    w(mem, bar + 0x6c, a); w(mem, bar + 0x70, b); w(mem, bar + 0x68, 1);
}
/** F0x800888A8(bar, value): store the current position. */
export function pagerSetD(mem: FolderGridMemory, bar: number, value: number): void {
    w(mem, bar + 0x74, value);
}

/** F0x800888B0(bar): the scroll bar's tick. */
export function folderPagerTick(
    mem: FolderGridMemory,
    bar: number,
    host: FolderGridHost,
): void {
    const state = r(mem, bar + 0xc);
    if (state !== 1) {
        if ((state < 2 || state >= 4) && r(mem, bar + 0x78) !== 0 && r(mem, bar + 0x68) !== 0) {
            const span = (r(mem, bar + 0x80) - r(mem, bar + 0x7c)) << 8;
            const step = Math.trunc(span / (r(mem, bar + 0x70) | 0));
            w(mem, bar + 0x88, step);
            const length = Math.imul(step, r(mem, bar + 0x6c));
            w(mem, bar + 0x64, length);
            host.baseMethod38(bar);
        }
        return;
    }
    const slot = host.pagerLayerSlot(r(mem, bar + 0x50), r(mem, bar + 0x54)) | 0;
    const prim = host.pagerNewPrimitive() | 0;
    const start = r(mem, bar + 0x74);
    if (start < r(mem, bar + 0x70) - 1) {
        const pos = r(mem, bar + 0x7c) + ((Math.imul(start, r(mem, bar + 0x88)) >> 8) | 0);
        const cap = r(mem, bar + 0x80) - ((r(mem, bar + 0x64) >> 8) | 0);
        w(mem, bar + 0x5c, cap < pos ? cap : pos);
    } else {
        w(mem, bar + 0x5c, r(mem, bar + 0x80) - ((r(mem, bar + 0x64) >> 8) | 0));
    }
    const v58 = r(mem, bar + 0x58);
    mem.write8(prim + 3, 5);
    mem.write8(prim + 7, 0x28);
    mem.write8(prim + 6, 0xff);
    mem.write8(prim + 5, 0xff);
    mem.write8(prim + 4, 0xff);
    mem.write16(prim + 0x10, v58 & 0xffff);
    mem.write16(prim + 0x8, v58 & 0xffff);
    const v58b = (r(mem, bar + 0x58) + r(mem, bar + 0x60)) | 0;
    mem.write16(prim + 0x14, v58b & 0xffff);
    mem.write16(prim + 0xc, v58b & 0xffff);
    const pos16 = r(mem, bar + 0x5c) & 0xffff;
    mem.write16(prim + 0xe, pos16);
    mem.write16(prim + 0xa, pos16);
    const pos2 = (pos16 + ((r(mem, bar + 0x64) >> 8) | 0)) & 0xffff;
    mem.write16(prim + 0x16, pos2);
    mem.write16(prim + 0x12, pos2);
    const slot0 = r(mem, slot) >>> 0;
    w(mem, prim, ((r(mem, prim) & 0xff000000) | (slot0 & 0xffffff)) | 0);
    w(mem, slot, ((slot0 & 0xff000000) | (prim & 0xffffff)) | 0);
    host.pagerEmit(prim + 0x18, 0xff000000 | 0, prim);
}
