// The pause screen's item grid construction and lifecycle, translated
// bit-exactly from the original pro/ststatus bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/pause-items.test.js runs the original through
// engine/native and compares the ordered calls and fields.
//
//   F0x80091E4C pauseItemsRootFactory  build the 0x45C+0xD4 items-root object.
//   F0x80091D18 items_root             the root tick: state 0/>=4 counts the
//                                      present party slots, seeds the row
//                                      counters and builds the widget grid
//                                      (items_ctor); state 1 runs the item tick
//                                      then the item draw; state 2/3 idle.
//   F0x8008E94C items_ctor             build every item-grid text widget (labels,
//                                      five stat columns per party row, the page
//                                      counter, the footer readouts) from the
//                                      layout table at [0x8009AF6C].
//
// The allocator, the text/frame widget constructors, the card-index service and
// the item tick/draw sub-screens are host boundaries; the port preserves the
// exact call order, table reads and arithmetic. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts barrel
// and data/translated_functions.json.

/** The items-root handler and geometry the factory allocates. */
export const PAUSE_ITEMS_ROOT_HANDLER = 0x80091d18;
export const PAUSE_ITEMS_ROOT_SIZE = 0x45c;
export const PAUSE_ITEMS_ROOT_EXTRA = 0xd4;
/** The layout-table pointer cell the constructor reads. */
export const PAUSE_ITEMS_LAYOUT_PTR = 0x8009af6c;
/** The card-index service slot. */
export const PAUSE_ITEMS_CARD_SERVICE = 0x80048d34;
export const PAUSE_ITEMS_CARD_INDEX_SLOT = 0x2718;
/** The widget geometry the constructor seeds at +0x50/+0x54/+0x58. */
export const PAUSE_ITEMS_SEED = [0x1000, 6] as const;
/** The row counter the root seeds to 0xA. */
export const PAUSE_ITEMS_SEED_A = 0x0a;

export interface PauseItemsMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PauseItemsHost {
    /** F0x80014504(cb, size, extra): allocate the items-root object. */
    allocateRoot(): number;
    /** [0x80048D34+0x2718](i): the present card slot index. */
    cardIndexOf(index: number): number;
    /** F0x8001AE38(target, kind, x, y): build a text widget. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(target, frame, x, y): build a framed widget. */
    createFrameElement(target: number, frame: number, x: number, y: number): number;
    /** target+slot(a1): a widget method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** F0x80090264(obj, arg1): the item grid state machine. */
    itemsTick(obj: number, arg1: number): void;
    /** F0x8008F8F0(obj): the item grid draw. */
    itemsDraw(obj: number): void;
}

/** F0x80091E4C(arg0): build the items-root object. */
export function pauseItemsRootFactory(
    mem: PauseItemsMemory,
    arg0: number,
    host: PauseItemsHost,
): number {
    const obj = host.allocateRoot();
    mem.write32(obj + 0x54, PAUSE_ITEMS_SEED[0]);
    mem.write32(obj + 0x58, PAUSE_ITEMS_SEED[1]);
    mem.write32(obj + 0x50, arg0);
    return obj;
}

/** F0x8008E94C(obj, arg1): build the item-grid widgets. */
export function pauseItemsCtor(
    mem: PauseItemsMemory,
    obj: number,
    arg1: number,
    host: PauseItemsHost,
): void {
    const target = s16(mem.read16(obj + 0x54));
    const layout = mem.read32(PAUSE_ITEMS_LAYOUT_PTR) | 0;

    const t1 = layout + 0x84;
    mem.write32(arg1 + 0x00, host.createTextElement(target, 1, s16(mem.read16(t1 + 4)), s16(mem.read16(t1 + 8))));

    const t2 = layout + 0x90;
    const x2 = s16(mem.read16(t2 + 4));
    const y2 = mem.read16(t2 + 8);
    mem.write32(arg1 + 0x88, host.createTextElement(target, 1, x2, s16(y2)));
    mem.write32(arg1 + 0x8c, host.createTextElement(target, 1, x2, s16(y2 + 0x0e)));
    mem.write32(arg1 + 0x90, host.createTextElement(target, 1, s16(mem.read16(t2 + 4) + 0x10), s16(y2 + 0x0e)));
    mem.write32(arg1 + 0x94, host.createTextElement(target, 1, s16(mem.read16(t2 + 4) + 0x42), s16(y2 + 0x0e)));
    const frame = host.createFrameElement(target, (mem.read32(obj + 0x58) - 1) | 0, x2, s16(y2 + 0x0e));
    mem.write32(arg1 + 0x98, frame);
    host.callMethod(frame, 0x80, [0]);

    let row = arg1;
    let grid = 0;
    let yOffset = 0;
    do {
        const t3 = mem.read32(PAUSE_ITEMS_LAYOUT_PTR) | 0;
        mem.write32(row + 0x04, host.createTextElement(target, 1, s16(mem.read16(t3 + 4)), s16(mem.read16(t3 + 8) + yOffset)));
        for (let k = 0; k < 5; k++) {
            const x = s16(mem.read16(t3 + 0x10 + 0xc * k));
            const y = mem.read16(t3 + 0x14 + 0xc * k);
            mem.write32(arg1 + grid + 0x08 + k * 4, host.createTextElement(target, 3, x, s16(y + yOffset)));
        }
        for (let k = 0; k < 5; k++) {
            const x = s16(mem.read16(t3 + 0x4c + 0xc * k));
            const y = mem.read16(t3 + 0x50 + 0xc * k);
            mem.write32(arg1 + grid + 0x1c + k * 4, host.createTextElement(target, 3, x, s16(y + yOffset)));
        }
        grid += 0x2c;
        row += 0x2c;
        yOffset += 0x2e;
    } while (row < arg1 + 0x84);

    mem.write32(arg1 + 0x9c, host.createTextElement(target, 3, 0x42, 0xa6));
    mem.write32(arg1 + 0xa0, host.createTextElement(target, 3, 0x46, 0xa6));
    const t4 = (mem.read32(PAUSE_ITEMS_LAYOUT_PTR) | 0) + 0xb4;
    for (let i = 0; i < 5; i++) {
        mem.write32(arg1 + 0xa4 + i * 4, host.createTextElement(target, 1, s16(mem.read16(t4 + 4)), s16(mem.read16(t4 + 8) + i * 0x0e)));
    }
    const frame2 = host.createFrameElement(target, (mem.read32(obj + 0x58) - 1) | 0, 0xb0, s16((mem.read32(obj + 0x70) * 0x0e + 0x31) | 0));
    mem.write32(arg1 + 0xb8, frame2);
    host.callMethod(frame2, 0x80, [0]);
    mem.write32(arg1 + 0xbc, host.createTextElement(target, 1, 0x25, 0xae));
    mem.write32(arg1 + 0xc0, host.createTextElement(target, 1, 0xa1, 0xaf));
    mem.write32(arg1 + 0xc4, host.createTextElement(target, 1, 0xe0, 0xaf));
    mem.write32(arg1 + 0xc8, host.createTextElement(target, 1, 0xea, 0xaf));
    mem.write32(arg1 + 0xcc, host.createTextElement(target, 1, 0x128, 0xaf));
}

/** F0x80091D18(obj, arg1): the items-root tick. */
export function pauseItemsRootTick(
    mem: PauseItemsMemory,
    obj: number,
    arg1: number,
    host: PauseItemsHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        host.itemsTick(obj, arg1);
        host.itemsDraw(obj);
        return;
    }
    if (state === 2 || state === 3) return;

    host.callMethod(obj, 0x38, []);
    for (let i = 0; i < 3; i++) {
        if ((host.cardIndexOf(i) | 0) >= 0) mem.write32(obj + 0x5c, (mem.read32(obj + 0x5c) + 1) | 0);
    }
    const count = mem.read32(obj + 0x5c) | 0;
    if (count > 0) {
        let p = obj;
        for (let j = 0; j < count; j++) {
            mem.write32(p + 0x3cc, PAUSE_ITEMS_SEED_A);
            p += 0x10;
        }
    }
    mem.write32(obj + 0x40c, PAUSE_ITEMS_SEED_A);
    mem.write32(obj + 0x3fc, PAUSE_ITEMS_SEED_A);
    mem.write32(obj + 0x41c, PAUSE_ITEMS_SEED_A);
    mem.write32(obj + 0x42c, PAUSE_ITEMS_SEED_A);
    mem.write32(obj + 0x43c, PAUSE_ITEMS_SEED_A);
    pauseItemsCtor(mem, obj, arg1, host);
}

function s16(value: number): number {
    return (value << 16) >> 16;
}

/** The item-list draw's layout-table pointer cell and geometry. */
export const PAUSE_ITEMS_TABLE_PTR = 0x8009af68;
export const PAUSE_ITEMS_FRAME_CELL = 0x8004de10 + 0x188;
export const PAUSE_ITEMS_PACK_ROWS = 0x04040000;
export const PAUSE_ITEMS_PACK_BADGE = 0x02860000;
/** The name-string service cell the 0x444 unity branch calls. */
export const PAUSE_ITEMS_NAME_CELL = 0x80042b9c;

export interface PauseItemsDrawHost {
    /** [0x8004DE10+0x188](): the frame counter. */
    frameCounter(): number;
    /** [0x80048D34+0x2718](i): the present card slot index. */
    cardIndexOf(index: number): number;
    /** [0x80042B9C](index): the card's name string. */
    cardName(index: number): number;
    /** [0x80044F5C](handle): resolve a pack handle. */
    packResolve(handle: number): number;
    /** F0x8001F648(): build the stack draw context. */
    initDrawContext(): void;
    /** ctx+0x7C(x, y): set the draw layer. */
    setLayer(x: number, y: number): void;
    /** ctx+0x74(x, y): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x8C(x, y, z): set the draw scale. */
    setScale(x: number, y: number, z: number): void;
    /** ctx+0x94(x, y): set the draw position. */
    setPos(x: number, y: number): void;
    /** ctx+0x88(n): set the palette row. */
    setPaletteRow(n: number): void;
    /** ctx+0x84(pack, id, x, y): draw a sprite. */
    drawSprite(pack: number, id: number, x: number, y: number): void;
}

/** F0x8008F8F0(obj): draw the pause item grid. */
export function pauseItemsDraw(
    mem: PauseItemsMemory,
    obj: number,
    host: PauseItemsDrawHost,
): void {
    host.initDrawContext();
    host.setLayer(mem.read32(obj + 0x54) | 0, mem.read32(obj + 0x58) | 0);

    if (((host.frameCounter() | 0) - (mem.read32(obj + 0x6c) | 0)) >= 0x0d) {
        const frame = host.frameCounter();
        mem.write32(obj + 0x6c, frame);
        const count = mem.read32(obj + 0x5c) | 0;
        if (count > 0) {
            for (let i = 0; i < count; i++) {
                const cell = obj + i * 4;
                const next = (mem.read32(cell + 0x60) + 1) | 0;
                const index = (host.cardIndexOf(i) | 0) * 7;
                mem.write32(cell + 0x60, next);
                const table = mem.read32(PAUSE_ITEMS_TABLE_PTR) | 0;
                if ((mem.read32(table + index * 4 + next * 4) | 0) === -1 || next >= 7) {
                    mem.write32(cell + 0x60, 0);
                }
            }
        }
    }

    const count = mem.read32(obj + 0x5c) | 0;
    if (count > 0) {
        let y = 0x13;
        let y2 = 0x27;
        for (let i = 0; i < count; i++) {
            const scale = mem.read32(obj + i * 0x10 + 0x3d4) | 0;
            if (scale !== 0) {
                if (scale !== 0x1000) {
                    host.setScale(scale, scale, 0x1000);
                    host.setPos(0x7c, y2);
                } else {
                    host.setScale(0x1000, 0x1000, 0x1000);
                }
                const card = host.cardIndexOf(i) | 0;
                host.setOrigin(0x280, 0x100);
                const table = mem.read32(PAUSE_ITEMS_TABLE_PTR) | 0;
                const sprite = mem.read32(table + card * 0x1c + (mem.read32(obj + i * 4 + 0x60) | 0) * 4) | 0;
                host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_ROWS), sprite, 0x6b, y);
            }
            y += 0x2e;
            y2 += 0x2e;
        }
    }

    host.setOrigin(0x140, 0);
    if (count > 0) {
        let a4 = 0x13;
        let a0 = 0x11;
        let a7 = 0x27;
        let a3 = 0x25;
        for (let i = 0; i < count; i++) {
            const scale = mem.read32(obj + i * 0x10 + 0x3d4) | 0;
            if (scale !== 0) {
                if (scale !== 0x1000) {
                    host.setScale(scale, 0x1000, 0x1000);
                    host.setPos(0, a3);
                    host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x15, 0, a0);
                    host.setScale(scale, scale, 0x1000);
                    host.setPos(0x7c, a7);
                    host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x16, 0x67, a4);
                    host.setScale(mem.read32(obj + i * 0x10 + 0x3d4) | 0, 0x1000, 0x1000);
                    host.setPos(0, a3);
                } else {
                    host.setScale(0x1000, 0x1000, 0x1000);
                    host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x15, 0, a0);
                    host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x16, 0x67, a4);
                }
                host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x17, 0, a0);
            }
            a4 += 0x2e;
            a0 += 0x2e;
            a7 += 0x2e;
            a3 += 0x2e;
        }
    }

    let fixed = mem.read32(obj + 0x404) | 0;
    if (fixed !== 0) {
        if (fixed !== 0x1000) {
            host.setScale(fixed, 0x1000, 0x1000);
            host.setPos(0x140, 0x19);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x18, 0x22, 0x0d);
    }
    fixed = mem.read32(obj + 0x424) | 0;
    if (fixed !== 0) {
        if (fixed !== 0x1000) {
            host.setScale(fixed, 0x1000, 0x1000);
            host.setPos(0x140, 0x52);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x1c, 0xa8, 0x28);
    }
    fixed = mem.read32(obj + 0x434) | 0;
    if (fixed !== 0) {
        if (fixed !== 0x1000) {
            host.setScale(fixed, 0x1000, 0x1000);
            host.setPos(0, 0xa8);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x1a, 0, 0x9e);
    }

    if ((mem.read32(obj + 0x414) | 0) !== 0) {
        if ((mem.read32(obj + 0x3c0) | 0) !== 0) {
            if (((host.frameCounter() | 0) - (mem.read32(obj + 0x3c8) | 0)) >= 4) {
                mem.write32(obj + 0x3c8, host.frameCounter());
                const next = (mem.read32(obj + 0x3c4) + 1) | 0;
                mem.write32(obj + 0x3c4, next);
                if (next >= 5) mem.write32(obj + 0x3c4, 0);
            }
            host.setOrigin(0x140, 0);
            host.setPaletteRow(mem.read32(obj + 0x3c4) | 0);
            host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_BADGE), 0x0a, 0x123, 0xd6);
            host.setPaletteRow(0);
        }
        fixed = mem.read32(obj + 0x414) | 0;
        if (fixed !== 0x1000) {
            host.setScale(fixed, 0x1000, 0x1000);
            host.setPos(0, 0xd3);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.setOrigin(0x280, 0x100);
        host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_ROWS), 0x20, 0, 0xc2);
    }

    fixed = mem.read32(obj + 0x444) | 0;
    if (fixed !== 0) {
        if (fixed !== 0x1000) {
            host.setScale(fixed, 0x1000, 0x1000);
            host.setPos(0x140, 0xb2);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
            host.setOrigin(0x140, 0);
            host.drawSprite(
                host.packResolve(PAUSE_ITEMS_PACK_BADGE),
                host.cardName(mem.read32(obj + 0x78) | 0),
                0x16, 0xae,
            );
        }
        host.setOrigin(0x280, 0x100);
        host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_ROWS), 0x2f, 0x0f, 0xa5);
    }

    if ((mem.read32(obj + 0x3b4) | 0) !== 0) {
        if (((host.frameCounter() | 0) - (mem.read32(obj + 0x3bc) | 0)) >= 9) {
            mem.write32(obj + 0x3bc, host.frameCounter());
            const next = (mem.read32(obj + 0x3b8) + 1) | 0;
            mem.write32(obj + 0x3b8, next);
            if (next >= 8) mem.write32(obj + 0x3b8, 0);
        }
        host.setScale(0x1000, 0x1000, 0x1000);
        host.setLayer(mem.read32(obj + 0x54) | 0, (mem.read32(obj + 0x58) - 1) | 0);
        host.setPaletteRow(mem.read32(obj + 0x3b8) | 0);
        host.drawSprite(host.packResolve(PAUSE_ITEMS_PACK_ROWS), 0x1e, 0, (mem.read32(obj + 0x3b0) * 0x2e + 0x11) | 0);
    }
}
