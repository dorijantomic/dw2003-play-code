// The title/boot screen's draw helpers, translated from pro/stdwtitl (the
// accepted title-screen-executed-families family B). Each builds its own draw
// context through F0x8001F648 and ends in setLayer/setOrigin/setDepth/setFrame
// plus drawSprite calls from the title pack (handle mem32(0x80088234)) or the
// circuit-board packs.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/title-draw-oracle.test.js runs each original through
// engine/native with the draw context and pack resolver stubbed.

export interface TitleDrawMemory {
    read8(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface TitleDrawHost {
    initDrawContext(): void;
    setOrigin(x: number, y: number): void;
    setLayer(target: number, bucket: number): void;
    /** ctx+0x78 (F0x8001ECD8). */
    setDepth(x: number, y: number): void;
    /** ctx+0x88 (F0x8001ECEC). */
    setFrame(n: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8. */
    packResolve(handle: number): number;
}

export const TITLE_PACK_HANDLE_PTR = 0x80088234;
export const TITLE_LANGUAGE_PTR = 0x8005cca8;
export const TITLE_MENU_OPTION_TABLE = 0x80087d88;
export const TITLE_LANGUAGE_CLIP_TABLE = 0x80087da0;
export const TITLE_BACKGROUND_PACKS = [0x08870000, 0x08870001, 0x08870002] as const;
export const TITLE_TWINKLE_TABLES = [
    0x80087ddc, 0x80087e20, 0x80087e74, 0x80087f2c, 0x80087ff8, 0x800880f4, 0x8008816c, 0x800881bc,
] as const;
export const TITLE_TWINKLE_PACK_A = 0x08870003;
export const TITLE_TWINKLE_PACK_B = 0x08870008;
export const TITLE_DRAW_ORIGIN = { x: 0x280, y: 0x100 } as const;
export const TITLE_TWINKLE_NONE = 0x12c;

const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;

/** F0x80083054(obj): the title decoration layer's three sprites. */
export function titleDecoLayerDraw(mem: TitleDrawMemory, obj: number, host: TitleDrawHost): void {
    if (s32(mem.read32(obj + 0x54)) === 0) return;
    const target = s32(mem.read32(obj + 0x68));
    const handle = mem.read32(TITLE_PACK_HANDLE_PTR) >>> 0;
    host.initDrawContext();
    host.setLayer(target, 0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.drawSprite(host.packResolve(handle) >>> 0, 6, 0x1d, 0xd1);

    host.initDrawContext();
    host.setLayer(target, 0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.setFrame(s16(mem.read16s(obj + 0x5a)));
    host.drawSprite(host.packResolve(handle) >>> 0, 3, 8, 0x1c);

    host.initDrawContext();
    host.setLayer(target, 0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.setFrame(s16(mem.read16s(obj + 0x62)));
    host.drawSprite(host.packResolve(handle) >>> 0, 5, 0x14, 0xca);
}

/** F0x8008426C(obj): the "3" glow. */
export function titleNumeralGlowDraw(mem: TitleDrawMemory, obj: number, host: TitleDrawHost): void {
    const target = s32(mem.read32(obj + 0x60));
    const handle = mem.read32(TITLE_PACK_HANDLE_PTR) >>> 0;
    host.initDrawContext();
    if (s32(mem.read32(obj + 0x5c)) !== 0) {
        host.setLayer(target, 0);
        host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
        host.setDepth(0, 0x1f0);
        host.drawSprite(host.packResolve(handle) >>> 0, 2, 0xfd, 0x64);
        host.initDrawContext();
    }
    if (s32(mem.read32(obj + 0x58)) !== -1) {
        host.setLayer(target, 0);
        host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
        host.setFrame(s32(mem.read32(obj + 0x58)));
        host.drawSprite(host.packResolve(handle) >>> 0, 4, 0xf3, 0x5a);
    }
}

/** F0x800852F0(obj): the Start/Continue box and the language prompt lines. */
export function titleMenuDraw(mem: TitleDrawMemory, obj: number, host: TitleDrawHost): void {
    const target = s32(mem.read32(obj + 0x8c));
    const handle = mem.read32(TITLE_PACK_HANDLE_PTR) >>> 0;
    const row = s16(mem.read16s(obj + 0x5a));
    if (mem.read8(obj + 0x58) !== 0) {
        host.initDrawContext();
        host.setLayer(target, 0);
        host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
        host.setFrame(mem.read8(obj + 0x59));
        const option = (TITLE_MENU_OPTION_TABLE + row * 8) >>> 0;
        host.drawSprite(host.packResolve(handle) >>> 0, 7,
            mem.read32(option) >>> 0, (s32(mem.read32(option + 4)) - 1) >>> 0);
    }

    const langRecord = (TITLE_LANGUAGE_CLIP_TABLE + (mem.read32(TITLE_LANGUAGE_PTR) * 4)) >>> 0;
    if (s16(mem.read16s(obj + 0x56)) === 0) {
        host.initDrawContext();
        host.setLayer(target, 0);
        host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
        host.setFrame(row === 2 ? 0 : 1);
        host.drawSprite(host.packResolve(handle) >>> 0, mem.read8(langRecord), 0x4f, 0xa6);
        return;
    }

    host.initDrawContext();
    host.setLayer(target, 0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.setFrame(row === 0 ? 0 : 1);
    host.drawSprite(host.packResolve(handle) >>> 0, mem.read8(langRecord + 1),
        s32(mem.read32(obj + 0x5c)), s32(mem.read32(obj + 0x60)));

    host.initDrawContext();
    host.setLayer(target, 0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.setFrame(row === 1 ? 0 : 1);
    host.drawSprite(host.packResolve(handle) >>> 0, mem.read8(langRecord + 2),
        s32(mem.read32(obj + 0x6c)), s32(mem.read32(obj + 0x70)));
}

/** F0x80086108(obj): the circuit-board background's three slices. */
export function titleBackgroundDraw(mem: TitleDrawMemory, obj: number, host: TitleDrawHost): void {
    const target = s32(mem.read32(obj + 0x7c));
    host.initDrawContext();
    host.setLayer(target, 0);
    host.setDepth(0, 0x1f3);
    for (let i = 0; i < 3; i++) {
        host.setOrigin(0x300 + i * 0x40, 0);
        host.drawSprite(host.packResolve(TITLE_BACKGROUND_PACKS[i] ?? 0) >>> 0, 0, 0, 0);
    }
}

/**
 * F0x8008605C(state, table, flag): the twinkle keyframe stepper. The original
 * is genuinely recursive: each call advances at most one run of expired
 * entries and returns the clip of the *first* advanced entry (the recursion's
 * own return is discarded). The port mirrors that exactly.
 */
export function titleTwinkleStepper(
    mem: TitleDrawMemory,
    state: number,
    table: number,
    flag: number,
): number {
    let p = (table + s16(mem.read16s(state)) * 4) >>> 0;
    if (flag === 0) {
        mem.write16(state + 2, u16(mem.read16s(state + 2) - 1));
    }
    if (s16(mem.read16s(state + 2)) <= 0) {
        p = (p + 4) >>> 0;
        mem.write16(state, u16(s16(mem.read16s(state)) + 1));
        mem.write16(state + 2, u16(mem.read16s(state + 2) + mem.read16s(p + 2)));
        if ((mem.read16s(p) & 0xffff) === 0xff) {
            p = table >>> 0;
            mem.write16(state, 0);
            mem.write16(state + 2, u16(mem.read16s(state + 2) + mem.read16s(p + 2)));
        }
        titleTwinkleStepper(mem, state, table, flag + 1);
    }
    return s16(mem.read16s(p));
}

/** F0x80086228(obj): step the eight twinkles and draw the live ones. */
export function titleTwinkleSetupDraw(mem: TitleDrawMemory, obj: number, host: TitleDrawHost): void {
    const clips: number[] = [];
    for (let i = 0; i < TITLE_TWINKLE_TABLES.length; i++) {
        clips.push(titleTwinkleStepper(mem, obj + 0x54 + i * 4, TITLE_TWINKLE_TABLES[i] ?? 0, 0));
    }
    host.initDrawContext();
    host.setLayer(s32(mem.read32(obj + 0x7c)), 0);
    host.setOrigin(0x3c0, 0);
    for (let i = 0; i < clips.length; i++) {
        const clip = clips[i] ?? 0;
        if (clip === TITLE_TWINKLE_NONE) continue;
        const pack = i < 4 ? TITLE_TWINKLE_PACK_A : TITLE_TWINKLE_PACK_B;
        let x = 0;
        let y = 0;
        if (i === 6) {
            x = s16(mem.read16s(obj + 0x74));
            y = s16(mem.read16s(obj + 0x76));
        } else if (i === 7) {
            x = s16(mem.read16s(obj + 0x78));
            y = s16(mem.read16s(obj + 0x7a));
        }
        host.drawSprite(host.packResolve(pack) >>> 0, clip & 0xffff, x, y);
    }
}
