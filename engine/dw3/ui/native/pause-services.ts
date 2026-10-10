// The services every pause page (pro/ststatus) shares: text and cursor widget
// creation and methods, the pad service's three words, sound, the pack and bank
// resolvers, the frame counter, the panel folds and the picture calls. Each is a
// host boundary the page ports call in their original order.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md.

export interface PauseMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface PauseServices {
    /** F0x8001AE38(layer, kind, x, y): a text widget. */
    createText(layer: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(layer, order, x, y): a cursor icon. */
    createIcon(layer: number, order: number, x: number, y: number): number;
    /** target+slot(args...): a widget, cursor or task method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** [0x80044F4C](id): a text bank's base. */
    languageBank(id: number): number;
    /** [0x8004B7D0+0x3F4](n): pad bits pressed this frame. */
    padPressed(n: number): number;
    /** [0x8004B7D0+0x3F8](n): pad bits held this frame. */
    padHeld(n: number): number;
    /** [0x8004B7D0+0x3FC](n): pad auto-repeat pulses this frame. */
    padRepeat(n: number): number;
    /** [0x8004B7D0+0x408](pad, code): the shift of a logical button. */
    padBit(pad: number, code: number): number;
    /** [0x80055C48](id): a packed sound. */
    playSound(id: number): void;
    /** [0x80044F5C](id): a pack handle's directory. */
    packHandle(id: number): number;
    /** [0x8004DE10+0x188](): the frame counter. */
    frameCount(): number;
    /** [0x8009B5D8](fold, open): start a panel fold. */
    foldStart(fold: number, open: number): void;
    /** [0x8009B5DC](fold): nonzero once landed. */
    foldTick(fold: number): number;
    /** [0x8004DC0C](): the random number service. */
    rand(): number;
    drawInit(): void;
    draw74(x: number, y: number): void;
    draw78(x: number, y: number): void;
    draw7C(a: number, b: number): void;
    drawSprite(handle: number, clip: number, x: number, y: number): void;
    draw88(n: number): void;
    draw8C(a: number, b: number, c: number): void;
    draw94(a: number, b: number): void;
}

export const PAUSE_LANGUAGE_CELL = 0x8005cca8;
/** The resident party/save context. */
export const PAUSE_CTX = 0x80048d34;
/** Text bank offsets the pause pages read. */
export const BANK_ITEM_DESC = 0x63;
export const BANK_ITEM_NAME = 0x6a;
export const BANK_CHROME = 0xb0;
