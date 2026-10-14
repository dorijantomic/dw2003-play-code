// Translation of the resident pause list: the list START opens over the field, and the
// same list the pause pages rebuild after a page closes.
// Builder 0x8001345C (hidden; docs/research/ui/pause-list-builder-decoded-2026-10-01.md),
// tick F0x8001270c, fold F0x800120b4 / F0x80012148, widgets F0x800121b4, party cards
// F0x800123e0, MAP gate F0x800126a8. The row wipe draw is drawHomeMenuPanel
// (home-menu-draw.ts, interior tail 0x80013350 of the tick).
//
// Object (0xAC bytes): +0x0C state, +0x10 step, +0x14 1 = remove / 0 = wipe on exit,
// +0x18 loop counter, +0x50 layer, +0x54 1, +0x58 row, +0x5C row count, +0x60 CARD
// FOLDERS variant, +0x64 MAP allowed, +0x68 wipe step, +0x6C wipe clock, folds at
// +0x70 cards/prompt, +0x80 rows, +0x90 BIT (+0 frames, +4 step, +8 value, +0xC running).
// Slots: +0x00 prompt, +0x04 BIT label, +0x08 money, +0x0C.. rows, +0x24 cursor,
// card c at +0x2C*c: +0x28 name, +0x2C.. five labels, +0x40.. five values.
import { drawHomeMenuPanel } from "../home-menu-draw.ts";

export interface PauseListMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PauseListHost {
    /** [0x80055C48](id): play a sound. */
    sfx(id: number): void;
    /** target+slot(target, ...args): an object or widget method. */
    callMethod(target: number, slot: number, args: number[]): number;
    /** [0x80044B38+0x414](bank): the text bank pointer. */
    textBank(bank: number): number;
    /** [0x80044B38+0x424](handle): resolve a pack handle (also [0x80044F5C]). */
    packResolve(handle: number): number;
    /** [0x8004B7D0+0x3F4](0): the pressed buttons. */
    padPressed(): number;
    /** [0x8004B7D0+0x3FC](0): the auto-repeat buttons. */
    padRepeat(): number;
    /** [0x8004B7D0+0x408](0, button): the bit of a logical button. */
    padBit(button: number): number;
    /** [0x8004DE10+0x188](): the vsync clock. */
    now(): number;
    /** [0x80048D34+0x2704]() = [0x8004B438](): the scene id that is running now. */
    sceneId(): number;
    /** [0x80048D34+0x270C](scene, 0): change scene. */
    changeScene(scene: number, arg: number): void;
    /** [0x80048D34+0x2718](card): the roster slot on party card `card`, or < 0. */
    partySlot(card: number): number;
    /** [0x80048D34+0x2750](slot): the slot's name string. */
    slotName(slot: number): number;
    /** [0x80048D34+0x2734](slot, out): the slot's stats; returns the halfword reader. */
    slotStats(slot: number): (index: number) => number;
    /** F0x8001AE38(layer, kind, x, y): create a text widget. */
    createText(layer: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(layer, kind, x, y): create the cursor widget. */
    createCursor(layer: number, kind: number, x: number, y: number): number;
    /** F0x8001F648(): build the stack draw context. */
    initDrawContext(): void;
    /** ctx+0x74(x, y) */
    setOrigin(x: number, y: number): void;
    /** ctx+0x7C(layer, bucket) */
    setLayer(layer: number, bucket: number): void;
    /** ctx+0x98(v) */
    context98(value: number): void;
    /** ctx+0x88(v): palette row for the next sprite. */
    paletteShift(value: number): void;
    /** ctx+0x8C(x, y, z): scale. */
    setScale(x: number, y: number, z: number): void;
    /** ctx+0x94(x, y): scale pivot. */
    setPivot(x: number, y: number): void;
    /** ctx+0x84(pack, clip, x, y) */
    drawSprite(pack: number, clip: number, x: number, y: number): void;
    /**
     * EXTRA (not on the disc): when the host supplies this and it returns a bank, the list gets one more row after its own,
     * labelled by string 0 of that one-string text bank (`bank` is its address). The panel behind the rows is the disc's own
     * seven-row clip. Absent or null leaves the list exactly as the disc builds it.
     */
    extraRow?(): { bank: number } | null;
}

const GAME = 0x80048d34;
const CARD_FLAG = 0x80048f42;
const MONEY = 0x80048da0;
const BANK_BASE = 0x8005cca8;
export const PAUSE_LIST_SAVED_ROW = 0x8005ccf0;
const CARD_FLAG_OUT = 0x8005ccf4;
const NAME_RECORD = 0x8003ee7c;
const LABEL_RECORDS = 0x8003ee88;
const VALUE_RECORDS = 0x8003eec4;
const STAT_INDEX = 0x8003ef00;
const ROW_TEXT = 0x8003ef14;
const PACK = 0x02860000;
const SCENE_PAUSE = 0x1000;
export const PAUSE_LIST_SFX = Object.freeze({ open: 0x40019, close: 0x4001a, cursor: 0x8004513e, confirm: 0x8004503c, back: 0x800450bd });

const s16 = (v: number) => (v << 16) >> 16;
/**
 * The cursor widget's slot: 0x24 as on the disc; with the extra seventh row that slot holds the row, so the cursor moves
 * past the party cards' slots (the third card's values end at 0xac) to 0xb0.
 */
const cursorSlot = (mem: PauseListMemory, obj: number) => ((mem.read32(obj + 0x5c) | 0) > 6 ? 0xb0 : 0x24);
/** The panel clip behind the rows: 0x1c (five rows) or 0x1b (six), exactly as on the disc, and the disc's own seven-row panel 0x19 when the extra row makes seven. */
const panelClip = (mem: PauseListMemory, obj: number) => {
    const rows = mem.read32(obj + 0x5c) | 0;
    return rows > 6 ? 0x19 : (0x21 - rows) | 0;
};
const bank = (mem: PauseListMemory, host: PauseListHost) => host.textBank((mem.read32(BANK_BASE) + 0xb0) | 0);
const slot = (mem: PauseListMemory, addr: number) => mem.read32(addr) | 0;

/** F0x800120b4(fold, open): start a window fold; plays the open or close sound. */
export function pauseListFoldStart(mem: PauseListMemory, fold: number, open: number, host: PauseListHost): void {
    mem.write32(fold + 0xc, 1);
    const frames = mem.read32(fold) | 0;
    if (open !== 0) {
        host.sfx(PAUSE_LIST_SFX.open);
        mem.write32(fold + 8, 0);
        mem.write32(fold + 4, Math.trunc(0x1000 / frames));
    } else {
        host.sfx(PAUSE_LIST_SFX.close);
        mem.write32(fold + 8, 0x1000);
        mem.write32(fold + 4, -(Math.trunc(0x1000 / frames) * 2));
    }
}

/** F0x80012148(fold): advance a fold; 1 once it is fully open or shut. */
export function pauseListFoldStep(mem: PauseListMemory, fold: number): number {
    if (mem.read32(fold + 0xc) === 0) return 1;
    const step = mem.read32(fold + 4) | 0;
    const value = ((mem.read32(fold + 8) | 0) + step) | 0;
    mem.write32(fold + 8, value);
    if (step > 0) {
        if (value < 0x1001) return 0;
        mem.write32(fold + 8, 0x1000);
    } else {
        if (value >= 0) return 0;
        mem.write32(fold + 8, 0);
    }
    mem.write32(fold + 0xc, 0);
    return 1;
}

/** F0x800126a8(): -1 on scenes 0x2D7 and above (MAP refused), else 0/1. */
export function pauseListMapGate(mem: PauseListMemory, host: PauseListHost): number {
    let scene = host.sceneId() | 0;
    if (scene === SCENE_PAUSE) scene = mem.read32(GAME + 0x34) | 0;
    if (scene >= 0x2d7) return -1;
    return scene < 0x270 ? 0 : 1;
}

/** F0x800121b4(obj, slots): create the list's widgets. */
export function pauseListWidgets(mem: PauseListMemory, obj: number, slots: number, host: PauseListHost): void {
    const layer = s16(mem.read16(obj + 0x50));
    mem.write32(slots, host.createText(layer, 1, 0x98, 0x13));
    const rows = mem.read32(obj + 0x5c) | 0;
    for (let i = 0; i < rows; i++) mem.write32(slots + 0xc + i * 4, host.createText(layer, 1, 0xbd, 0x31 + i * 0xe));
    const cursor = host.createCursor(layer, 0, 0xb0, s16((mem.read32(obj + 0x58) | 0) * 0xe + 0x31));
    mem.write32(slots + cursorSlot(mem, obj), cursor);
    host.callMethod(cursor, 0x80, [0]);
    mem.write32(slots + 4, host.createText(layer, 3, 0x46, 0xa6));
    mem.write32(slots + 8, host.createText(layer, 3, 0x42, 0xa6));
    for (let card = 0; card < 3; card++) {
        const base = slots + card * 0x2c, dy = card * 0x2e;
        const at = (rec: number) => [s16(mem.read16(rec + 4)), s16(mem.read16(rec + 8) + dy)] as const;
        const [nx, ny] = at(NAME_RECORD);
        mem.write32(base + 0x28, host.createText(layer, 1, nx, ny));
        for (let j = 0; j < 5; j++) {
            const [x, y] = at(LABEL_RECORDS + j * 0xc);
            mem.write32(base + 0x2c + j * 4, host.createText(layer, 3, x, y));
        }
        for (let j = 0; j < 5; j++) {
            const [x, y] = at(VALUE_RECORDS + j * 0xc);
            mem.write32(base + 0x40 + j * 4, host.createText(layer, 3, x, y));
        }
    }
}

/** F0x800123e0(obj, slots, card, show): fill or clear one party card's text. */
export function pauseListCard(mem: PauseListMemory, slots: number, card: number, show: number, host: PauseListHost): void {
    const base = slots + card * 0x2c;
    if (show === 0) {
        host.callMethod(slot(mem, base + 0x28), 0x144, [0]);
        for (let j = 0; j < 5; j++) {
            host.callMethod(slot(mem, base + 0x2c + j * 4), 0x144, [0]);
            host.callMethod(slot(mem, base + 0x40 + j * 4), 0x144, [0]);
        }
        return;
    }
    const roster = host.partySlot(card) | 0;
    if (roster >= 0) {
        const name = host.slotName(roster);
        const stat = host.slotStats(roster);
        host.callMethod(slot(mem, base + 0x28), 0x114, [name, -1]);
        for (let j = 0; j < 5; j++) {
            const label = slot(mem, base + 0x2c + j * 4);
            host.callMethod(label, 0x114, [bank(mem, host), mem.read32(LABEL_RECORDS + j * 0xc) | 0]);
            const value = slot(mem, base + 0x40 + j * 4);
            host.callMethod(value, 0x118, [0, s16(stat(mem.read32(STAT_INDEX + j * 4) | 0))]);
            host.callMethod(value, 0x148, [1]);
        }
        return;
    }
    host.callMethod(slot(mem, base + 0x28), 0x114, [bank(mem, host), 0xc]);
    for (let k = 0; k < 5; k++) { // five lines; the m2c loop bound reads as four
        const value = slot(mem, base + 0x40 + k * 4);
        host.callMethod(value, 0x114, [bank(mem, host), mem.read32(VALUE_RECORDS + k * 0xc) | 0]);
        host.callMethod(value, 0x148, [1]);
    }
}

/** 0x8001345C(layer, row): the list object's fields after F0x80014504 created it. */
export function pauseListBuild(mem: PauseListMemory, obj: number, layer: number, row: number): void {
    mem.write32(obj + 0x50, layer);
    mem.write32(obj + 0x54, 1);
    mem.write32(obj + 0x58, row);
}

function drawWindows(mem: PauseListMemory, obj: number, host: PauseListHost): void {
    host.initDrawContext();
    host.setOrigin(0x140, 0);
    host.setLayer(mem.read32(obj + 0x50) | 0, mem.read32(obj + 0x54) | 0);
    host.context98(0);
    const scaled = (value: number, px: number, py: number) => {
        if (value !== 0x1000) {
            host.setScale(value, 0x1000, 0x1000);
            host.setPivot(px, py);
        } else host.setScale(0x1000, 0x1000, 0x1000);
    };
    for (let card = 0; card < 3; card++) {
        const value = mem.read32(obj + 0x78 + card * 0x10) | 0;
        if (value === 0) continue;
        scaled(value, 0, 0x25 + card * 0x2e);
        host.drawSprite(host.packResolve(PACK), 0x15, 0, 0x11 + card * 0x2e);
        host.drawSprite(host.packResolve(PACK), 0x17, 0, 0x11 + card * 0x2e);
    }
    const prompt = mem.read32(obj + 0x78) | 0;
    if (prompt !== 0) {
        scaled(prompt, 0x140, 0x19);
        host.drawSprite(host.packResolve(PACK), 0x18, 0x22, 0xd);
    }
    const rows = mem.read32(obj + 0x88) | 0;
    if (rows !== 0) {
        scaled(rows, 0x140, 0x52);
        host.drawSprite(host.packResolve(PACK), panelClip(mem, obj), 0xa8, 0x28);
    }
    const bit = mem.read32(obj + 0x98) | 0;
    if (bit !== 0) {
        scaled(bit, 0, 0xa8);
        host.drawSprite(host.packResolve(PACK), 0x1a, 0, 0x9e);
    }
}

function pressed(host: PauseListHost, button: number): boolean {
    return ((host.padPressed() >> host.padBit(button)) & 1) !== 0;
}

function shut(mem: PauseListMemory, obj: number, slots: number, host: PauseListHost): void {
    pauseListFoldStart(mem, obj + 0x70, 0, host);
    pauseListFoldStart(mem, obj + 0x80, 0, host);
    pauseListFoldStart(mem, obj + 0x90, 0, host);
    pauseListCard(mem, slots, 2, 0, host);
    host.callMethod(slot(mem, slots + 4), 0x144, [0]);
    host.callMethod(slot(mem, slots + 8), 0x144, [0]);
    host.callMethod(slot(mem, slots + cursorSlot(mem, obj)), 0x80, [0]);
}

function input(mem: PauseListMemory, obj: number, slots: number, host: PauseListHost): boolean {
    const before = mem.read32(obj + 0x58) | 0;
    const held = (button: number) => pressed(host, button) || ((host.padRepeat() >> host.padBit(button)) & 1) !== 0;
    if (held(4)) {
        const row = before - 1;
        mem.write32(obj + 0x58, row < 0 ? 0 : row);
    } else if (held(6)) {
        const row = before + 1, last = (mem.read32(obj + 0x5c) | 0) - 1;
        mem.write32(obj + 0x58, last < row ? last : row);
    }
    const row = mem.read32(obj + 0x58) | 0;
    if (row !== before) {
        host.sfx(PAUSE_LIST_SFX.cursor);
        host.callMethod(slot(mem, slots + cursorSlot(mem, obj)), 0x84, [0xb0, row * 0xe + 0x31]);
        return false;
    }
    if (pressed(host, 0xd)) {
        host.sfx(PAUSE_LIST_SFX.confirm);
        if ((mem.read32(obj + 0x64) | 0) === 0 && row === 2) return false;
        mem.write32(obj + 0x14, (host.sceneId() | 0) === SCENE_PAUSE ? 1 : 0);
        mem.write32(PAUSE_LIST_SAVED_ROW, row);
        return true;
    }
    if (pressed(host, 0xe)) {
        host.sfx(PAUSE_LIST_SFX.back);
        mem.write32(obj + 0x14, (host.sceneId() | 0) === SCENE_PAUSE ? 0 : 1);
        return true;
    }
    return false;
}

function stepOpenClose(mem: PauseListMemory, obj: number, slots: number, host: PauseListHost): void {
    const next = () => mem.write32(obj + 0x10, (mem.read32(obj + 0x10) + 1) | 0);
    const rows = () => mem.read32(obj + 0x5c) | 0;
    switch (mem.read32(obj + 0x10) >>> 0) {
        case 1:
            if (!pauseListFoldStep(mem, obj + 0x80)) return;
            pauseListCard(mem, slots, 1, 1, host);
            const extra = host.extraRow?.() ?? null;
            for (let i = 0; i < rows(); i++) {
                mem.write32(obj + 0x18, i);
                if (extra && i === rows() - 1) { // the extra row's label comes from its own one-string bank
                    host.callMethod(slot(mem, slots + 0xc + i * 4), 0x114, [extra.bank, 0]);
                    continue;
                }
                const text = mem.read32(ROW_TEXT + i * 4 + (mem.read32(obj + 0x60) | 0) * 0x18) | 0;
                host.callMethod(slot(mem, slots + 0xc + i * 4), 0x114, [bank(mem, host), text]);
            }
            mem.write32(obj + 0x18, Math.max(rows(), 0) || 0);
            host.sfx(PAUSE_LIST_SFX.open);
            if ((mem.read32(obj + 0x64) | 0) === 0) host.callMethod(slot(mem, slots + 0x14), 0x138, [7]);
            next();
            return;
        case 2:
            if (!pauseListFoldStep(mem, obj + 0x90)) return;
            pauseListCard(mem, slots, 2, 1, host);
            host.callMethod(slot(mem, slots + 4), 0x114, [bank(mem, host), 5]);
            host.callMethod(slot(mem, slots + 8), 0x118, [0, mem.read32(MONEY) | 0]);
            host.callMethod(slot(mem, slots + 8), 0x148, [1]);
            host.callMethod(slot(mem, slots + cursorSlot(mem, obj)), 0x80, [1]);
            next();
            return;
        case 3:
            if (input(mem, obj, slots, host)) {
                shut(mem, obj, slots, host);
                next();
            }
            return;
        case 4:
            if (!pauseListFoldStep(mem, obj + 0x90)) return;
            pauseListCard(mem, slots, 1, 0, host);
            for (let i = 0; i < rows(); i++) {
                mem.write32(obj + 0x18, i);
                host.callMethod(slot(mem, slots + 0xc + i * 4), 0x144, [0]);
            }
            mem.write32(obj + 0x18, Math.max(rows(), 0) || 0);
            host.sfx(PAUSE_LIST_SFX.close);
            next();
            return;
        case 5:
            if (!pauseListFoldStep(mem, obj + 0x80)) return;
            pauseListCard(mem, slots, 0, 0, host);
            host.callMethod(slot(mem, slots), 0x144, [0]);
            host.sfx(PAUSE_LIST_SFX.close);
            next();
            return;
        case 6:
            if (!pauseListFoldStep(mem, obj + 0x70)) return;
            if ((mem.read32(obj + 0x14) | 0) === 0) {
                host.callMethod(obj, 0x28, [2]);
                mem.write32(obj + 0x6c, host.now());
            } else host.callMethod(obj, 0x28, [3]);
            return;
        default:
            if (!pauseListFoldStep(mem, obj + 0x70)) return;
            pauseListCard(mem, slots, 0, 1, host);
            host.callMethod(slot(mem, slots), 0x114, [bank(mem, host), 0x13]);
            host.sfx(PAUSE_LIST_SFX.open);
            next();
    }
}

function stepWipe(mem: PauseListMemory, obj: number, host: PauseListHost): void {
    const step = mem.read32(obj + 0x10) >>> 0;
    // Past the scene change the step stays put and only the draw runs (the m2c
    // "default" arm that calls +0x28 is not what the jump table does).
    if (step > 6) return;
    if (step <= 5) {
        if (((host.now() - (mem.read32(obj + 0x6c) | 0)) | 0) < 2) return;
        mem.write32(obj + 0x6c, host.now());
        const band = ((mem.read32(obj + 0x68) | 0) + 1) | 0;
        mem.write32(obj + 0x68, band);
        if (band < (step <= 2 ? 8 : 0x10)) return;
        const next = ((mem.read32(obj + 0x10) >>> 0) + 1) >>> 0;
        mem.write32(obj + 0x10, next);
        mem.write32(obj + 0x68, step <= 2 ? (next !== 3 ? 0 : 8) : (next === 6 ? 0xf : 8));
        return;
    }
    if ((host.sceneId() | 0) === SCENE_PAUSE) host.changeScene(mem.read32(GAME + 0x34) | 0, 0);
    else {
        host.changeScene(SCENE_PAUSE, 0);
        mem.write32(PAUSE_LIST_SAVED_ROW, mem.read32(obj + 0x58));
    }
    mem.write32(obj + 0x10, ((mem.read32(obj + 0x10) >>> 0) + 1) >>> 0);
}

/** F0x8001270c(obj, slots): the pause list's tick. */
export function pauseListTick(mem: PauseListMemory, obj: number, slots: number, host: PauseListHost): void {
    const state = mem.read32(obj + 0xc) >>> 0;
    if (state === 3) return;
    if (state === 1) {
        stepOpenClose(mem, obj, slots, host);
        drawWindows(mem, obj, host);
        return;
    }
    if (state === 2) {
        stepWipe(mem, obj, host);
        drawHomeMenuPanel(mem, obj, {
            initDrawContext: () => host.initDrawContext(),
            setOrigin: (x, y) => host.setOrigin(x, y),
            setLayer: (a, b) => host.setLayer(a, b),
            context98: (v) => host.context98(v),
            paletteShift: (v) => host.paletteShift(v),
            packResolve: (h) => host.packResolve(h),
            drawSprite: (p, c, x, y) => host.drawSprite(p, c, x, y),
        });
        return;
    }
    host.callMethod(obj, 0x38, []);
    mem.write32(obj + 0x90, 0xa);
    mem.write32(obj + 0x80, 0xa);
    mem.write32(obj + 0x70, 0xa);
    pauseListFoldStart(mem, obj + 0x70, 1, host);
    pauseListFoldStart(mem, obj + 0x80, 1, host);
    pauseListFoldStart(mem, obj + 0x90, 1, host);
    if (((mem.read8(CARD_FLAG) << 24) >> 24) !== 0) {
        mem.write32(CARD_FLAG_OUT, 1);
        mem.write32(obj + 0x60, 1);
    } else mem.write32(CARD_FLAG_OUT, 0);
    mem.write32(obj + 0x5c, ((mem.read32(obj + 0x60) | 0) + 5 + (host.extraRow?.() ? 1 : 0)) | 0);
    mem.write32(obj + 0x64, pauseListMapGate(mem, host) >= 0 ? 1 : 0);
    pauseListWidgets(mem, obj, slots, host);
}
