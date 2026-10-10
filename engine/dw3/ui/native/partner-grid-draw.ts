// The partner-select / naming screen keyboard-grid draw, translated
// bit-exactly from the original pro/stdgname body F0x8008559C.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/partner-grid-draw.test.js runs the original through
// engine/native (which already installs the decoded draw-context fill and the
// 12 context-method hooks) and compares the ordered context calls and the
// object counters.
//
// F0x8001F648 builds the 0xA0-byte draw context at sp+0x10, so a stack slot
// sp+0xNN is ctx offset +0x(NN-0x10). The engine vocabulary names:
//   sp+0x84 = ctx+0x74 = setOrigin
//   sp+0x8C = ctx+0x7C = setLayer    (obj+0x54, 1 or 2)
//   sp+0x94 = ctx+0x84 = drawSprite  (pack, clip, x, y)
//   sp+0x98 = ctx+0x88 = paletteShift (CLUT row)
//   sp+0x9C = ctx+0x8C = setScale
//   sp+0xA4 = ctx+0x94 = setPos
//
// The body draws three hint icons from the 3-entry table at 0x80087BC4
// (stride 0x1C: clip, ?, x0, y0, x1, y1, flag), then a typed-character preview
// row from the anchor table 0x80087D68 (x,y per entry, 8-byte stride) and the
// glyph clip table 0x80087E58 (7 columns per card slot), then the flashing
// label pair (clips 0x1F then 0x1E) per typed character. The hand table is a
// data-driven loop that stops at a -1 clip. [0x80087F38+4] is the active page,
// used to offset the page-marked icons and to pick the glyph column; the
// per-page shift is 0x2B (43px). [0x80044F5C] is the pack resolver
// (0x02880000 = STDGNMCS); [0x8004DF98] is the free-running frame counter, read
// both for the two tick gates and for the & 3 blink gates ([0x8004DE10+0x188]
// is the same cell); the letter's card slot comes from
// [0x80048D34+0x2728]. All of those are host boundaries.
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

export const GRID_DRAW = 0x8008559c;
/** STDGNMCS pack handle the resolver is asked for. */
export const GRID_PACK = 0x02880000;
export const GRID_HINT_TABLE = 0x80087bc4;
export const GRID_HINT_COUNT = 3;
export const GRID_HINT_STRIDE = 0x1c;
export const GRID_SELECTION_CELL = 0x80087f38;
export const GRID_ANCHOR_TABLE = 0x80087d68;
export const GRID_CLIP_TABLE = 0x80087e58;
export const GRID_CLIP_COLS = 7;
export const GRID_COLUMN_PITCH = 0x2b;
export const GRID_PAGE_BLINK_MOD = 0x10;
export const GRID_LABEL_FLASH_MOD = 0x0e;
export const GRID_ANIM_PERIOD = 0x0d;

/** Screen/object fields the draw reads or writes. */
export const PARTNER_GRID_FIELDS = {
    language: 0x54,
    flash: 0x58,
    animFrame: 0x5c,
    animTimer: 0x60,
    letterCount: 0x78,
    pageBlink: 0x7c,
    widgetScale: 0x88,
} as const;

export interface GridDrawMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The draw boundary and the resident services the draw reads. */
export interface GridDrawHost {
    setOrigin(x: number, y: number): void;
    setLayer(target: number, bucket: number): void;
    drawSprite(pack: number, clip: number, x: number, y: number): void;
    /** ctx+0x88, F0x8001ECEC: CLUT row offset. */
    paletteShift(value: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8: pack handle -> directory pointer. */
    packResolve(handle: number): number;
    /** [0x8004DF98] = [0x8004DE10+0x188]: free-running frame counter. */
    frameTick(): number;
    /** [0x80048D34+0x2728](index): card slot, negative when empty. */
    cardPresent(index: number): number;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

/**
 * F0x8008559C(obj): emit the keyboard-grid draw for the partner-select / naming
 * screen and advance its two blink counters.
 */
export function partnerGridDraw(
    mem: GridDrawMemory,
    obj: number,
    host: GridDrawHost,
): void {
    const r = (off: number): number => u32(mem.read32(obj + off));
    const word = (addr: number): number => u32(mem.read32(addr));
    const sword = (addr: number): number => s32(mem.read32(addr));

    const language = r(PARTNER_GRID_FIELDS.language);
    host.setLayer(language, 2);
    host.setOrigin(0x280, 0);

    // --- loop 1: the three hint icons (table ends in a -1 clip) ---
    for (let i = 0; i < GRID_HINT_COUNT; i++) {
        const entry = GRID_HINT_TABLE + i * GRID_HINT_STRIDE;
        const clip = sword(entry);
        if (clip === -1) break;
        const scale = s32(mem.read32(obj + PARTNER_GRID_FIELDS.widgetScale + i * 0x10));
        const flag = sword(entry + 0x18);
        const page = s32(mem.read32(GRID_SELECTION_CELL + 4));
        if (scale !== 0x1000) {
            if (flag === 0) host.setScale(u32(scale), 0x1000, 0x1000);
            else host.setScale(0x1000, u32(scale), 0x1000);
            const xAlt = sword(entry + 0x10);
            const yAlt = sword(entry + 0x14);
            host.setPos(
                u32(xAlt),
                u32(clip === 0x20 ? yAlt + page * GRID_COLUMN_PITCH : yAlt),
            );
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        if (clip === 0x20) {
            if ((host.frameTick() & 3) === 3) {
                const next = u32(r(PARTNER_GRID_FIELDS.pageBlink) + 1);
                mem.write32(
                    obj + PARTNER_GRID_FIELDS.pageBlink,
                    u32(next >= GRID_PAGE_BLINK_MOD ? 0 : next),
                );
            }
            host.paletteShift(r(PARTNER_GRID_FIELDS.pageBlink));
            const pack = u32(host.packResolve(GRID_PACK));
            const x = sword(entry + 0x8);
            const y = sword(entry + 0xc);
            host.drawSprite(
                pack,
                u32(clip),
                u32(x),
                u32(y + page * GRID_COLUMN_PITCH),
            );
            host.paletteShift(0);
        } else {
            const pack = u32(host.packResolve(GRID_PACK));
            const x = sword(entry + 0x8);
            const y = sword(entry + 0xc);
            host.drawSprite(pack, u32(clip), u32(x), u32(y));
        }
    }

    // --- loop 2: the typed-character preview row ---
    if (s32(mem.read32(obj + PARTNER_GRID_FIELDS.letterCount)) > 0) {
        const anchor0x = sword(GRID_ANCHOR_TABLE);
        const anchor0y = sword(GRID_ANCHOR_TABLE + 4);
        const anchor1x = sword(GRID_ANCHOR_TABLE + 8);
        const anchor1y = sword(GRID_ANCHOR_TABLE + 0xc);
        let column = 2;
        let index = 0;
        do {
            const slot = s32(host.cardPresent(index));
            const scaleOff = PARTNER_GRID_FIELDS.widgetScale + (index + 3) * 0x10;
            if (slot >= 0 && s32(mem.read32(obj + scaleOff)) !== 0) {
                const now = s32(host.frameTick());
                if (s32(now - s32(mem.read32(obj + index * 8 + PARTNER_GRID_FIELDS.animTimer))) >= GRID_ANIM_PERIOD) {
                    mem.write32(obj + index * 8 + PARTNER_GRID_FIELDS.animTimer, u32(host.frameTick()));
                    const next = u32(r(index * 8 + PARTNER_GRID_FIELDS.animFrame) + 1);
                    mem.write32(obj + index * 8 + PARTNER_GRID_FIELDS.animFrame, next);
                    if (sword(GRID_CLIP_TABLE + (slot * GRID_CLIP_COLS + s32(next)) * 4) === -1) {
                        mem.write32(obj + index * 8 + PARTNER_GRID_FIELDS.animFrame, 0);
                    }
                }
                const scale = s32(mem.read32(obj + scaleOff));
                if (scale !== 0x1000) {
                    host.setScale(u32(scale), 0x1000, 0x1000);
                    host.setPos(u32(anchor1x + 2), u32(anchor1y + 2));
                } else {
                    host.setScale(0x1000, 0x1000, 0x1000);
                }
                const pack = u32(host.packResolve(GRID_PACK));
                const frame = s32(mem.read32(obj + index * 8 + PARTNER_GRID_FIELDS.animFrame));
                const clip = word(GRID_CLIP_TABLE + (slot * GRID_CLIP_COLS + frame) * 4);
                host.drawSprite(pack, clip, u32(anchor0x + 2), u32(anchor0y + column));
            }
            column += GRID_COLUMN_PITCH;
            index += 1;
        } while (index < s32(mem.read32(obj + PARTNER_GRID_FIELDS.letterCount)));
    }

    // --- the label flash tick ---
    if ((host.frameTick() & 3) === 3) {
        const next = u32(r(PARTNER_GRID_FIELDS.flash) + 1);
        mem.write32(
            obj + PARTNER_GRID_FIELDS.flash,
            u32(next >= GRID_LABEL_FLASH_MOD ? 0 : next),
        );
    }

    // --- loop 3: the flashing label pair per typed character ---
    if (s32(mem.read32(obj + PARTNER_GRID_FIELDS.letterCount)) > 0) {
        const anchor0x = sword(GRID_ANCHOR_TABLE);
        const anchor0y = sword(GRID_ANCHOR_TABLE + 4);
        const anchor1x = sword(GRID_ANCHOR_TABLE + 8);
        const anchor1y = sword(GRID_ANCHOR_TABLE + 0xc);
        let column = 0;
        let index = 0;
        do {
            if (s32(host.cardPresent(index)) >= 0) {
                const scaleOff = PARTNER_GRID_FIELDS.widgetScale + (index + 3) * 0x10;
                const scale = s32(mem.read32(obj + scaleOff));
                if (scale !== 0) {
                    if (scale !== 0x1000) {
                        host.setScale(u32(scale), 0x1000, 0x1000);
                        host.setPos(u32(anchor1x), u32(anchor1y + column));
                    } else {
                        host.setScale(0x1000, 0x1000, 0x1000);
                    }
                    host.setLayer(language, 1);
                    host.paletteShift(r(PARTNER_GRID_FIELDS.flash));
                    host.drawSprite(
                        u32(host.packResolve(GRID_PACK)),
                        0x1f,
                        u32(anchor0x),
                        u32(anchor0y + column),
                    );
                    host.setLayer(language, 2);
                    host.paletteShift(0);
                    host.drawSprite(
                        u32(host.packResolve(GRID_PACK)),
                        0x1e,
                        u32(anchor0x),
                        u32(anchor0y + column),
                    );
                }
            }
            column += GRID_COLUMN_PITCH;
            index += 1;
        } while (index < s32(mem.read32(obj + PARTNER_GRID_FIELDS.letterCount)));
    }
}
