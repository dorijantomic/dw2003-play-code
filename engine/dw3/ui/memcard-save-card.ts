// The memory-card screen's save-file card, translated from pro/stgmcard
// F0x80083B6C (create), F0x80083BD8 (reset) and F0x800836C4 (tick + draw).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/memcard-save-card-oracle.test.js runs the original through
// engine/native with the object factory, the widget factory, the fold pair,
// the fill routine and every draw-context method stubbed and compares the
// ordered calls and the card fields.
//
// DECODED: exe-decomp/stgmcard_c/_asm/F0x80083b6c.s / F0x80083bd8.s /
// F0x800836c4.s (authority 2, 59/31/601 lines) and the accepted
// memory-card-hud answer Family B. The card object is built by F0x80014504
// (handler 0x800836C4, size 0x90, extra 0x4C): +0x84/+0x88/+0x8C are three
// sub-routines, +0x54 = 0x1000 (the draw target), +0x50 = the parent screen
// (which owns the 0x44-stride slot records at +0xA4), +0x58 = 1 (the layer
// bucket). +0x20/+0x24 are the widget count and array; +0x68/+0x6C/+0x70 are
// three animation frames; +0x74 is a fold struct; +0x64 is the animation
// frame stamp; +0x7C is the fold value; +0x5C gates the draw.
//
// Tick order (derived from the raw asm):
//   state 0 or >= 4: advance the phase, write the language text offset
//     (0x21 non-Japanese, 0x20 Japanese) to the widget table at 0x80088088,
//     create each missing widget from table entry {+0x04 kind, +0x08 x,
//     +0x0C y} and set_unk_0xc0 = 1 on the first three, then +0x74 = 8
//   state 1 substate 1: step 0 -> foldStart(card+0x74, 1), step++; step 1 ->
//     foldTick(card+0x74); when it lands, card->0x2C(card, 0)
//   state 1 substate 2: step 0 -> foldStart(card+0x74, 0), +0x60 = 0,
//     fill(card), step++; step 1 -> foldTick; when it lands, +0x5C = 0 and
//     card->0x2C(card, 0)
//   state 2 or 3: nothing
//   then, if +0x5C != 0, the draw: init ctx, setOrigin(0x280,0),
//     setLayer(+0x54, +0x58), if +0x7C != 0x1000 setScale(0x1000,+0x7C,0x1000)
//     and setPos(0xA0,0x94); read the selected slot's record base
//     +0x50 + index*0x44 + 0xA4; every >= 13 ticks advance the three anim
//     frames (+0x68/6C/70) and wrap at 8 or anim == -1; draw each populated
//     slot's anim[byte-3][frame] at (0x9A+i*0x34, 0x85), then clip 0x24 at
//     (0x10,0x74), setLayer(+0x54,+0x58-1) and clip 0x25 at (0x10,0x74).
//
// The translation queue for this screen continues with 0x8008316C (fill) and
// the message window family; both keep host boundaries here.

export interface MemcardSaveCardMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** F0x80014504(handler, size, extra) -> the new child object. */
export interface MemcardSaveCardHost {
    allocCard(handler: number, size: number, extra: number): number;
}

/** The tick's boundary services. */
export interface MemcardSaveCardTickHost {
    /** card->0x38 (F0x800142AC): advance the object phase. */
    advancePhase(card: number): void;
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** widget+0x138 (F0x8001A1F4): set_unk_0xc0. */
    widgetSetC0(widget: number, value: number): void;
    /** block+0x28 (F0x80087EDC): start the 4-word fold tween. */
    foldStart(fold: number, direction: number): void;
    /** block+0x2C (F0x80087F70): step the fold; nonzero when landed. */
    foldTick(fold: number): number;
    /** card->0x2C (F0x80014288): set substate 1, clearing +0x14/+0x18. */
    setSubstate(card: number, value: number): void;
    /** F0x8008316C(card): fill the card's text widgets. */
    fill(card: number): void;
    /** F0x8001F648: reset the draw context. */
    initDrawContext(): void;
    setOrigin(x: number, y: number): void;
    setLayer(target: number, bucket: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8: pack handle -> directory pointer. */
    packResolve(handle: number): number;
    /** [0x8004DF98] = F0x8001D6F4: free-running frame tick. */
    frameTick(): number;
    /** [0x8008876C]: the selected slot index (s32). */
    selectedSlotIndex(): number;
    /** [0x8005CCA8]: the language index. */
    languageIndex(): number;
}

export const MEMCARD_CARD_HANDLER = 0x800836c4;
export const MEMCARD_CARD_SIZE = 0x90;
export const MEMCARD_CARD_EXTRA = 0x4c;
export const MEMCARD_CARD_FILL = 0x8008316c;
export const MEMCARD_CARD_DRAW_A = 0x800830b8;
export const MEMCARD_CARD_DRAW_B = 0x800830e0;

/** The widget recipe table: 0x14-byte entries, +4 kind, +8 x, +0xC y. */
export const MEMCARD_WIDGET_TABLE = 0x80088088;
export const MEMCARD_WIDGET_STRIDE = 0x14;
/** The per-slot 7-frame animation rows. */
export const MEMCARD_ANIM_TABLE = 0x80088204;
export const MEMCARD_ANIM_STRIDE = 7;
export const MEMCARD_ANIM_PERIOD = 13;
export const MEMCARD_ANIM_MOD = 8;
/** The card pack handle (STMCRDCS). */
export const MEMCARD_PACK = 0x029d0000;

/** Card object fields. */
export const MEMCARD_CARD = {
    state: 0x0c,
    substate: 0x10,
    step: 0x14,
    widgetCount: 0x20,
    widgetArray: 0x24,
    method2c: 0x2c,
    advance: 0x38,
    parent: 0x50,
    target: 0x54,
    bucket: 0x58,
    visible: 0x5c,
    fillFlag: 0x60,
    stamp: 0x64,
    anim0: 0x68,
    fold: 0x74,
    foldAux: 0x78,
    foldValue: 0x7c,
    subA: 0x84,
    subB: 0x88,
    fill: 0x8c,
    scaleB: 0x90,
    scaleC: 0x94,
} as const;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** F0x80083B6C(parent): build the save-file card child object. */
export function memcardSaveCardCreate(
    mem: MemcardSaveCardMemory,
    parent: number,
    host: MemcardSaveCardHost,
): number {
    const card = host.allocCard(MEMCARD_CARD_HANDLER, MEMCARD_CARD_SIZE, MEMCARD_CARD_EXTRA) >>> 0;
    mem.write32(card + MEMCARD_CARD.subA, MEMCARD_CARD_DRAW_A);
    mem.write32(card + MEMCARD_CARD.subB, MEMCARD_CARD_DRAW_B);
    mem.write32(card + MEMCARD_CARD.fill, MEMCARD_CARD_FILL);
    mem.write32(card + MEMCARD_CARD.target, 0x1000);
    mem.write32(card + MEMCARD_CARD.parent, parent >>> 0);
    mem.write32(card + MEMCARD_CARD.bucket, 1);
    return card;
}

/** F0x80083BD8(card): reset the card's transient state. */
export function memcardSaveCardReset(mem: MemcardSaveCardMemory, card: number): void {
    const bucket = mem.read32(card + MEMCARD_CARD.bucket);
    const visible = mem.read32(card + MEMCARD_CARD.visible);
    mem.write32(card + MEMCARD_CARD.substate, 0);
    mem.write32(card + MEMCARD_CARD.fold, 0);
    mem.write32(card + MEMCARD_CARD.foldAux, 0);
    mem.write32(card + MEMCARD_CARD.anim0, 0);
    mem.write32(card + MEMCARD_CARD.fill, 0);
    mem.write32(card + MEMCARD_CARD.scaleC, 0x1000);
    mem.write32(card + MEMCARD_CARD.scaleB, 0x1000);
    mem.write32(card + MEMCARD_CARD.subA, bucket);
    mem.write32(card + MEMCARD_CARD.subB, visible);
}

/** F0x800836C4(card): one save-file card frame. */
export function memcardSaveCardTick(
    mem: MemcardSaveCardMemory,
    card: number,
    host: MemcardSaveCardTickHost,
): void {
    const state = s32(mem.read32(card + MEMCARD_CARD.state));

    if (state !== 1) {
        if (state < 2 || state >= 4) {
            host.advancePhase(card);
            mem.write32(MEMCARD_WIDGET_TABLE, host.languageIndex() !== 0 ? 0x21 : 0x20);
            const count = s32(mem.read32(card + MEMCARD_CARD.widgetCount));
            if (count > 0) {
                let arr = mem.read32(card + MEMCARD_CARD.widgetArray) >>> 0;
                let table = MEMCARD_WIDGET_TABLE;
                const target = s16(mem.read16(card + MEMCARD_CARD.target));
                for (let i = 0; i < count; i++) {
                    let widget = mem.read32(arr) >>> 0;
                    const firstThree = i < 3;
                    if (widget === 0) {
                        widget = host.createTextElement(
                            target,
                            s16(mem.read16(table + 4)),
                            s16(mem.read16(table + 8)),
                            s16(mem.read16(table + 0xc)),
                        ) >>> 0;
                        mem.write32(arr, widget);
                    }
                    if (firstThree) host.widgetSetC0(widget, 1);
                    arr += 4;
                    table += MEMCARD_WIDGET_STRIDE;
                }
            }
            mem.write32(card + MEMCARD_CARD.fold, 8);
        }
        return;
    }

    // state 1: the fold/substate machine
    const substate = s32(mem.read32(card + MEMCARD_CARD.substate));
    if (substate === 1) {
        const step = s32(mem.read32(card + MEMCARD_CARD.step));
        if (step !== 1) {
            host.foldStart(card + MEMCARD_CARD.fold, 1);
            mem.write32(card + MEMCARD_CARD.step, (step + 1) >>> 0);
        } else if (host.foldTick(card + MEMCARD_CARD.fold) !== 0) {
            host.setSubstate(card, 0);
        }
    } else if (substate === 2) {
        const step = s32(mem.read32(card + MEMCARD_CARD.step));
        if (step !== 1) {
            host.foldStart(card + MEMCARD_CARD.fold, 0);
            mem.write32(card + MEMCARD_CARD.fillFlag, 0);
            host.fill(card);
            mem.write32(card + MEMCARD_CARD.step, (step + 1) >>> 0);
        } else if (host.foldTick(card + MEMCARD_CARD.fold) !== 0) {
            mem.write32(card + MEMCARD_CARD.visible, 0);
            host.setSubstate(card, 0);
        }
    }

    if (s32(mem.read32(card + MEMCARD_CARD.visible)) === 0) return;

    // the draw band
    host.initDrawContext();
    host.setOrigin(0x280, 0);
    host.setLayer(mem.read32(card + MEMCARD_CARD.target), mem.read32(card + MEMCARD_CARD.bucket));
    const foldValue = s32(mem.read32(card + MEMCARD_CARD.foldValue));
    if (foldValue !== 0x1000) {
        host.setScale(0x1000, foldValue >>> 0, 0x1000);
        host.setPos(0xa0, 0x94);
    }

    const recordBase = ((host.selectedSlotIndex() * 0x44) + (mem.read32(card + MEMCARD_CARD.parent) >>> 0) + 0xa4) >>> 0;
    const first = host.frameTick();
    if (s32(first - s32(mem.read32(card + MEMCARD_CARD.stamp))) >= MEMCARD_ANIM_PERIOD) {
        const now = host.frameTick();
        mem.write32(card + MEMCARD_CARD.stamp, now >>> 0);
        for (let i = 0; i < 3; i++) {
            const byte = s32(mem.read32(recordBase + i * 4));
            if (byte - 3 < 0) continue;
            let frame = s32(mem.read32(card + MEMCARD_CARD.anim0 + i * 4)) + 1;
            mem.write32(card + MEMCARD_CARD.anim0 + i * 4, frame >>> 0);
            if (frame >= MEMCARD_ANIM_MOD) {
                frame = 0;
                mem.write32(card + MEMCARD_CARD.anim0 + i * 4, 0);
            }
            if (s32(mem.read32(MEMCARD_ANIM_TABLE + ((byte - 3) * MEMCARD_ANIM_STRIDE + frame) * 4)) === -1) {
                mem.write32(card + MEMCARD_CARD.anim0 + i * 4, 0);
            }
        }
    }
    for (let i = 0; i < 3; i++) {
        const byte = s32(mem.read32(recordBase + i * 4));
        if (byte - 3 < 0) continue;
        const frame = s32(mem.read32(card + MEMCARD_CARD.anim0 + i * 4));
        host.drawSprite(
            host.packResolve(MEMCARD_PACK) >>> 0,
            mem.read32(MEMCARD_ANIM_TABLE + ((byte - 3) * MEMCARD_ANIM_STRIDE + frame) * 4) >>> 0,
            (0x9a + i * 0x34) >>> 0,
            0x85,
        );
    }
    host.drawSprite(host.packResolve(MEMCARD_PACK) >>> 0, 0x24, 0x10, 0x74);
    host.setLayer(mem.read32(card + MEMCARD_CARD.target), (mem.read32(card + MEMCARD_CARD.bucket) - 1) >>> 0);
    host.drawSprite(host.packResolve(MEMCARD_PACK) >>> 0, 0x25, 0x10, 0x74);
}
