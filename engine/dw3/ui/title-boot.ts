// The title screen's boot entry chain and logo-region loader, translated from
// pro/stdwtitl:
//
//   F0x8008497C create_title_boot      the mode-0 root factory
//   F0x800848EC title_boot_tick        the root tick
//   F0x80084868 title_boot_spawn_sequence  the child-block step
//   F0x80086DF8 load_title_logo_pack   the logo page loader
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/title-boot-oracle.test.js runs each original through
// engine/native with the standard-context slots, the pack resolver, the sound
// archive and the sequence ctor stubbed, and compares ordered calls and fields.
//
// DECODED: authority-2 `exe-decomp/stdwtitl_c/_asm/F0x8008497c.s`,
// `F0x800848ec.s`, `F0x80084868.s`, `F0x80086df8.s`, plus the accepted
// title-sequence-remaining-bodies answer, which found the in-overlay caller:
// `title_boot_tick` loads the word at 0x80088238 and jalr-calls it on the
// title-boot object's first tick after the audio-load poll (*0x80055C60 =
// F0x8002043C) returns zero. That is why the logo art was missing when the
// screen was booted from create_title_sequence instead of create_title_boot.
//
// The loader walks the language table at 0x8008824C (7 x 8 bytes of
// {upload, handle}) and uploads five texture pages through the small standard
// context: the language's logo tile plus the fixed 0x08870004..7. The language
// handle is stored at 0x80088234 where every logo draw reads it.

import { TITLE_LANGUAGE_PTR } from "./title-draw.ts";

export interface TitleBootMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface TitleBootHost {
    /** F0x80014504(handler, size, extra) -> the new boot object. */
    allocTitleBoot(handler: number, size: number, extra: number): number;
    /** [0x80055C54] (F0x80020574): request the sound archive. */
    requestSoundArchive(id: number): void;
    /** [0x80055C60] (F0x8002043C): nonzero while audio is still loading. */
    audioPending(): number;
    /** obj+0x38 (F0x800142AC): advance state0, zeroing +0x10/+0x14/+0x18. */
    advance0(obj: number): void;
    /** obj+0x28 (F0x80014274): set state0, zeroing +0x10/+0x14/+0x18. */
    setState0(obj: number, state: number): void;
    /** F0x80086DB0(obj): create the title sequence object. */
    createTitleSequence(obj: number): number;
    /** F0x8001FFA8(ctx): install the 0x34-byte standard context. */
    installStandardContext(): void;
    /** The installed address of a standard-context slot (ctx+0x24/0x28/0x2C). */
    contextSlot(slot: number): number;
    /** ctx+0x24/0x28/0x2C: run one standard-context slot. */
    contextCall(slot: number, a: number, b: number, c?: number): void;
    /** (*0x80044B38+0x424)(id) = F0x800140D8: pack handle -> directory. */
    packResolve(handle: number): number;
}

export const TITLE_BOOT = {
    state0: 0x0c,
    substate: 0x10,
    method: 0x28,
    advance: 0x38,
    target: 0x50,
    layer: 0x54,
} as const;

export const TITLE_BOOT_HANDLER = 0x800848ec;
export const TITLE_BOOT_SIZE = 0x58;
export const TITLE_BOOT_EXTRA = 0x04;
export const TITLE_BOOT_TARGET = 0x1000;
export const TITLE_BOOT_LAYER = 2;
export const TITLE_BOOT_SOUND_ARCHIVE = 0x47;
export const TITLE_BOOT_SEQUENCE_STATE = 3;

/** The overlay's loader cell; create_title_boot installs F0x80086DF8 there. */
export const TITLE_LOADER_PTR = 0x80088238;
/** The language table: 7 x {upload, handle}. */
export const TITLE_PACK_TABLE = 0x8008824c;
/** Where the current language's logo handle is published for the draws. */
export const TITLE_LOGO_CELL = 0x80088234;
/** The four fixed texture-page uploads after the language's logo tile. */
export const TITLE_LOGO_UPLOADS: ReadonlyArray<number> = [0x08870004, 0x08870005, 0x08870006, 0x08870007];
export const TITLE_LOGO_FIRST_PAGE = { x: 0x280, y: 0x100 } as const;
export const TITLE_LOGO_PAGE_STEP = 0x40;
export const TITLE_LOGO_UPLOAD_FIRST = 0x300;

/** F0x8008497C(): build the title-boot object. */
export function titleBootCreate(mem: TitleBootMemory, host: TitleBootHost): number {
    const obj = host.allocTitleBoot(TITLE_BOOT_HANDLER, TITLE_BOOT_SIZE, TITLE_BOOT_EXTRA) >>> 0;
    mem.write32(obj + TITLE_BOOT.target, TITLE_BOOT_TARGET);
    mem.write32(obj + TITLE_BOOT.layer, TITLE_BOOT_LAYER);
    host.requestSoundArchive(TITLE_BOOT_SOUND_ARCHIVE);
    return obj;
}

/** F0x800848EC(obj, arg1): one boot-root frame. */
export function titleBootTick(
    mem: TitleBootMemory, obj: number, arg1: number, host: TitleBootHost,
): void {
    const state = mem.read32(obj + TITLE_BOOT.state0) | 0;
    if (state === 1) {
        titleBootSpawnSequence(mem, obj, arg1, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    if (host.audioPending() !== 0) return;
    host.advance0(obj);
    loadTitleLogoPack(mem, host);
}

/** F0x80084868(obj, arg1): create the sequence once, then watch its slot. */
export function titleBootSpawnSequence(
    mem: TitleBootMemory, obj: number, arg1: number, host: TitleBootHost,
): void {
    const substate = mem.read32(obj + TITLE_BOOT.substate) | 0;
    if (substate !== 1) {
        mem.write32(arg1, host.createTitleSequence(obj) >>> 0);
        mem.write32(obj + TITLE_BOOT.substate, (substate + 1) >>> 0);
        return;
    }
    if ((mem.read32(arg1) | 0) === 0) host.setState0(obj, TITLE_BOOT_SEQUENCE_STATE);
}

/** F0x80086DF8(): load the language logo tile and the four fixed pages. */
export function loadTitleLogoPack(mem: TitleBootMemory, host: TitleBootHost): void {
    host.installStandardContext();
    host.contextCall(0x24, TITLE_LOGO_FIRST_PAGE.x, TITLE_LOGO_FIRST_PAGE.y);
    host.contextCall(0x28, 0, 0x1f0);

    const lang = mem.read32(TITLE_LANGUAGE_PTR) >>> 0;
    const table = (TITLE_PACK_TABLE + lang * 8) >>> 0;
    host.contextCall(0x2c, host.packResolve(mem.read32(table) >>> 0) >>> 0, 0);
    mem.write32(TITLE_LOGO_CELL, mem.read32(table + 4) >>> 0);
    // The original passes the ctx+0x28 slot's own address as the third argument.
    host.contextCall(0x28, 0, 0x1f3, host.contextSlot(0x28));

    for (let i = 0; i < TITLE_LOGO_UPLOADS.length; i++) {
        host.contextCall(0x24, TITLE_LOGO_UPLOAD_FIRST + i * TITLE_LOGO_PAGE_STEP, 0);
        host.contextCall(0x2c, host.packResolve(TITLE_LOGO_UPLOADS[i] as number) >>> 0, 0);
    }
}
