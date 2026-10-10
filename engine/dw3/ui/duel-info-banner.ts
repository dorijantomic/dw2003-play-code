// The card duel's info-banner family (S3), translated from pro/cardgame.
//
// The mode-2 (Draw Phase) update's arms call this family through the board
// view's constructor-installed method slots:
//   F0x8009BEAC view+0xEAC open_info_banner   — a title banner is asked to appear
//   F0x8009BF5C view+0xEB0 write_banner_record — the banner record advances
//
// Neither routine is in the disassembler's function-entry list (a constructor
// installs the pointers), so the m2c C is not the source; both were read from
// the overlay assembly at their address offsets inside the F0x8009BBA8 blob:
//   F0x8009BEAC @ exe-decomp/cardgame.norm.s .L0x000191fc
//   F0x8009BF5C @ exe-decomp/cardgame.norm.s .L0x000192ac
//
// Player-visible result: a six-banner strip at the top of the board. Opening
// banner `index` snaps it to full scale, sets its mode byte to 1 and arms a
// 12-frame wipe; the record write flips the same strip's mode to 3 and a
// 6-frame wipe, which is what finally retires it. §23 named the slots and §36
// confirmed all 56 constructor-installed routines already lift; the reader of
// the mode byte is F0x80097508 (the six-banner loop F0x800978F0).

export interface BannerMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface BannerFamilyHost {
    /** `[0x80055C48]` = F0x8002006C: play a packed sound id. */
    playSound(id: number): void;
}

/** The banner strip: a 0x18-byte record per banner, six of them at view+0xE0C. */
export const BANNER_RECORD_STRIDE = 0x18;
export const BANNER_FIELD = {
    /** left x (s16) */
    x: 0xe0c,
    /** top y (s16) */
    y: 0xe0e,
    /** two byte-level wipe counters (s16) */
    wipeA: 0xe10,
    wipeB: 0xe12,
    /** wipe duration (s16, 0xC for open) */
    framesA: 0xe14,
    framesB: 0xe16,
    /** payload x (s16) */
    payloadX: 0xe18,
    /** payload word (s32) */
    payload: 0xe1c,
    /** the mode byte the reader F0x80097508 switches on */
    mode: 0xe23,
} as const;
/** The sound ids the two calls ask the packed-sound dispatcher for. */
export const BANNER_SOUND_OPEN = 0x40019;
export const BANNER_SOUND_WRITE = 0x4001a;
export const BANNER_WIPE_FRAMES_OPEN = 0xc;
export const BANNER_WIPE_FRAMES_WRITE = 6;
export const BANNER_MODE_OPEN = 1;
export const BANNER_MODE_WRITE = 3;

/**
 * F0x8009BEAC(view, index, payloadX, payloadWord, x, y): ask banner `index` to
 * appear — snap its scale to full, set the mode byte to 1 and arm the 12-frame
 * wipe, with the x/y and the two payload values the caller supplies.
 */
export function openInfoBanner(
    mem: BannerMemory, host: BannerFamilyHost, view: number, index: number,
    payloadX: number, payloadWord: number, x: number, y: number,
): void {
    host.playSound(BANNER_SOUND_OPEN);
    const r = (view + ((index | 0) * BANNER_RECORD_STRIDE | 0)) | 0;
    mem.write16(r + BANNER_FIELD.wipeB, 0x1000);
    mem.write8(r + BANNER_FIELD.mode, BANNER_MODE_OPEN);
    mem.write16(r + BANNER_FIELD.x, x & 0xffff);
    mem.write16(r + BANNER_FIELD.y, y & 0xffff);
    mem.write16(r + BANNER_FIELD.wipeA, 0);
    mem.write16(r + BANNER_FIELD.payloadX, payloadX & 0xffff);
    mem.write32(r + BANNER_FIELD.payload, payloadWord | 0);
    mem.write16(r + BANNER_FIELD.framesA, BANNER_WIPE_FRAMES_OPEN);
    mem.write16(r + BANNER_FIELD.framesB, BANNER_WIPE_FRAMES_OPEN);
}

/**
 * F0x8009BF5C(view, index): flip banner `index` to mode 3 and the 6-frame
 * wipe — the record write that retires it.
 */
export function writeBannerRecord(
    mem: BannerMemory, host: BannerFamilyHost, view: number, index: number,
): void {
    host.playSound(BANNER_SOUND_WRITE);
    const r = (view + ((index | 0) * BANNER_RECORD_STRIDE | 0)) | 0;
    mem.write16(r + BANNER_FIELD.wipeA, 0x1000);
    mem.write16(r + BANNER_FIELD.wipeB, 0x1000);
    mem.write8(r + BANNER_FIELD.mode, BANNER_MODE_WRITE);
    mem.write16(r + BANNER_FIELD.framesA, BANNER_WIPE_FRAMES_WRITE);
    mem.write16(r + BANNER_FIELD.framesB, BANNER_WIPE_FRAMES_WRITE);
}
