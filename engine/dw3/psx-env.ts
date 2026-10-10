// PS1 hardware environment helpers, translated from the resident EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/psx-env-oracle.test.js runs the original addresses through
// engine/native and compares.
//
// DECODED: exe-decomp/c/F0x8002915C.c / F0x8002EB98.c and fns.norm.s.

export interface PsxEnvMemory {
    /** Required by texWindowCommand (F0x80026c88); the DRAWENV setters do not read bytes. */
    read8?(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** Signed DRAWENV width-1 / height-1 cells the E3/E4 builders clamp against. */
export const DRAW_AREA_WIDTH = 0x80055efc;
export const DRAW_AREA_HEIGHT = 0x80055efe;

const s16 = (v: number): number => (v << 16) >> 16;

function clampDrawCoord(mem: PsxEnvMemory, value: number, limitAddr: number): number {
    const signed = s16(value);
    if (signed < 0) return 0;
    if (s16(mem.read16(limitAddr)) - 1 < signed) {
        return ((mem.read16(limitAddr) & 0xffff) - 1) | 0;
    }
    return value | 0;
}

/**
 * F0x8002915C(drawEnv, abr, texPage, code): sets the draw-env "dirty" byte and
 * the 0xE1 texture-page word. Assembly order/widths:
 *   sb 1, +0x3
 *   v1 = 0xE1000000 | (texPage ? 0x200 : 0)
 *   v0 = (code & 0x9FF) | (abr ? 0x400 : 0)
 *   sw (v1 | v0), +0x4
 */
export function setDrawTPage(
    mem: PsxEnvMemory,
    drawEnv: number,
    abr: number,
    texPage: number,
    code: number,
): void {
    mem.write8(drawEnv + 0x3, 1);
    let word = 0xe1000000;
    if ((texPage | 0) !== 0) word |= 0x200;
    let flags = (code & 0x9ff) >>> 0;
    if ((abr | 0) !== 0) flags |= 0x400;
    mem.write32(drawEnv + 0x4, (word | flags) >>> 0);
}

/** The resident cell holding the interrupt-mask register address (0x1F801074). */
export const I_MASK_PTR_ADDR = 0x8005bfe0;

/**
 * F0x8002EB98(value): swap the interrupt mask and return the previous u16.
 *   v1 = [I_MASK_PTR_ADDR]; v0 = lhu [v1]; sh value, [v1]; return v0
 */
export function setIntrMask(mem: PsxEnvMemory, value: number): number {
    const addr = mem.read32(I_MASK_PTR_ADDR) >>> 0;
    const old = mem.read16(addr) & 0xffff;
    mem.write16(addr, value & 0xffff);
    return old;
}

/** The resident display-mode flag word the env setters read (F0x8002F580). */
export const DISPLAY_MODE_WORD = 0x8005c058;

/**
 * F0x8002F580(): the display-mode flag word. The original is
 * `lui v0,0x8006; lw v0,-0x3fa8(v0); jr ra` with no writes, so it is a leaf
 * read of DISPLAY_MODE_WORD.
 */
export function displayModeWord(mem: PsxEnvMemory): number {
    return mem.read32(DISPLAY_MODE_WORD) >>> 0;
}

/**
 * F0x80028FAC(env, x, y, w, h): initialise a Psy-Q DRAWENV.
 * Assembly order/widths (h is the fifth argument, read from the caller's stack):
 *   sh x,+0  sh y,+2  sh w,+4  sh 0,+0xC +0xE +0x10 +0x12
 *   sb 0,+0x19 +0x1A +0x1B   sb 1,+0x16
 *   sh h,+6
 *   +0x17 = (mode != 0 ? h < 0x121 : h < 0x101)
 *   sh x,+8  sh y,+0xA  sh 0xA,+0x14  sb 0,+0x18
 * Returns the env pointer.
 */
export function setDefDrawEnv(
    mem: PsxEnvMemory,
    env: number,
    x: number,
    y: number,
    w: number,
    h: number,
): number {
    const mode = displayModeWord(mem);
    mem.write16(env + 0x0, x & 0xffff);
    mem.write16(env + 0x2, y & 0xffff);
    mem.write16(env + 0x4, w & 0xffff);
    mem.write16(env + 0xc, 0);
    mem.write16(env + 0xe, 0);
    mem.write16(env + 0x10, 0);
    mem.write16(env + 0x12, 0);
    mem.write8(env + 0x19, 0);
    mem.write8(env + 0x1a, 0);
    mem.write8(env + 0x1b, 0);
    mem.write8(env + 0x16, 1);
    mem.write16(env + 0x6, h & 0xffff);
    mem.write8(env + 0x17, (mode !== 0 ? h < 0x121 : h < 0x101) ? 1 : 0);
    mem.write16(env + 0x8, x & 0xffff);
    mem.write16(env + 0xa, y & 0xffff);
    mem.write16(env + 0x14, 0xa);
    mem.write8(env + 0x18, 0);
    return env >>> 0;
}

/**
 * F0x8002906C(env, x, y, w, h): initialise a Psy-Q DISPENV. The original stores
 * h last (in the `jr` delay slot) but every field is independent, so the order
 * is not observable; it is kept here to mirror the listing.
 * Returns the env pointer.
 */
export function setDefDispEnv(
    mem: PsxEnvMemory,
    env: number,
    x: number,
    y: number,
    w: number,
    h: number,
): number {
    mem.write16(env + 0x0, x & 0xffff);
    mem.write16(env + 0x2, y & 0xffff);
    mem.write16(env + 0x4, w & 0xffff);
    mem.write16(env + 0x8, 0);
    mem.write16(env + 0xa, 0);
    mem.write16(env + 0xc, 0);
    mem.write16(env + 0xe, 0);
    mem.write8(env + 0x11, 0);
    mem.write8(env + 0x10, 0);
    mem.write8(env + 0x13, 0);
    mem.write8(env + 0x12, 0);
    mem.write16(env + 0x6, h & 0xffff);
    return env >>> 0;
}

/**
 * F0x80026b1c, fns.s:24843-24851; verified core-fns-80026b1c-role-2026-09-12.
 * Returns the GP0 E1 word; ori 0x200 / ori 0x400, then or with E1000000.
 */
export function drawTexPageCommand(dither: number, texPage: number, code: number): number {
    let word = 0xe1000000;
    if ((texPage | 0) !== 0) word |= 0x200;
    let flags = (code & 0x9ff) >>> 0;
    if ((dither | 0) !== 0) flags |= 0x400;
    return (word | flags) >>> 0;
}

/**
 * F0x80026b3c, fns.s:24855-24893; partially_verified gpu-drawing-area-command-builders.
 * Signed x/y clamped to [0, lhu(DRAW_AREA_*)-1], packed as GP0 E3.
 */
export function drawAreaStartCommand(mem: PsxEnvMemory, x: number, y: number): number {
    const cx = clampDrawCoord(mem, x, DRAW_AREA_WIDTH) & 0x3ff;
    const cy = clampDrawCoord(mem, y, DRAW_AREA_HEIGHT) & 0x3ff;
    return (0xe3000000 | (cy << 10) | cx) >>> 0;
}

/**
 * F0x80026bd4, fns.s:24897-24935; same claim as drawAreaStartCommand, GP0 E4.
 */
export function drawAreaEndCommand(mem: PsxEnvMemory, x: number, y: number): number {
    const cx = clampDrawCoord(mem, x, DRAW_AREA_WIDTH) & 0x3ff;
    const cy = clampDrawCoord(mem, y, DRAW_AREA_HEIGHT) & 0x3ff;
    return (0xe4000000 | (cy << 10) | cx) >>> 0;
}

/**
 * F0x80026c6c, fns.s:24939-24946; partially_verified core-q002-gpu-80026c6c-gp0builders.
 */
export function drawOffsetCommand(x: number, y: number): number {
    return (0xe5000000 | ((y & 0x7ff) << 11) | (x & 0x7ff)) >>> 0;
}

/** F0x800266b4, fns.s:24553-24679. Packet writes, not stack scratch. */
export function setDrawEnvPacket(mem: PsxEnvMemory, packet: number, env: number): number {
    return buildDrawEnvPacket(mem, packet, env, false);
}

/** F0x800268ac, fns.s:24683-24839. Uses fast fill for aligned x/width. */
export function buildDrawEnvPacket(mem: PsxEnvMemory, packet: number, env: number, fastFill = true): number {
    if (mem.read8 === undefined) throw new Error("buildDrawEnvPacket needs PsxEnvMemory.read8");
    mem.write32(packet + 4, drawAreaStartCommand(mem, s16(mem.read16(env)), s16(mem.read16(env + 2))));
    mem.write32(packet + 8, drawAreaEndCommand(mem,
        s16(mem.read16(env + 4) + mem.read16(env) - 1),
        s16(mem.read16(env + 2) + mem.read16(env + 6) - 1)));
    mem.write32(packet + 12, drawOffsetCommand(s16(mem.read16(env + 8)), s16(mem.read16(env + 10))));
    mem.write32(packet + 16, drawTexPageCommand(mem.read8(env + 23), mem.read8(env + 22), mem.read16(env + 20)));
    mem.write32(packet + 20, texWindowCommand(mem, env + 12));
    mem.write32(packet + 24, 0xe6000000);
    let count = 6;
    if (mem.read8(env + 24) !== 0) {
        let x = mem.read16(env), y = mem.read16(env + 2);
        const w = clampDrawCoord(mem, mem.read16(env + 4), DRAW_AREA_WIDTH) & 0xffff;
        const h = clampDrawCoord(mem, mem.read16(env + 6), DRAW_AREA_HEIGHT) & 0xffff;
        const fill = fastFill && (x & 63) === 0 && (w & 63) === 0;
        if (!fill) {
            x = (x - mem.read16(env + 8)) & 0xffff;
            y = (y - mem.read16(env + 10)) & 0xffff;
        }
        mem.write32(packet + 28, ((fill ? 0x02000000 : 0x60000000)
            | (mem.read8(env + 27) << 16) | (mem.read8(env + 26) << 8) | mem.read8(env + 25)) >>> 0);
        // Original lw loads BOTH temporary halfwords (m2c prints only the low one).
        mem.write32(packet + 32, ((y << 16) | x) >>> 0);
        mem.write32(packet + 36, ((h << 16) | w) >>> 0);
        count = 9;
    }
    mem.write8(packet + 3, count);
    return count;
}

/** F0x80026c88, fns.s:24950-24982; core-q002-gpu-80026c6c-gp0builders.
 * NULL returns 0; otherwise GP0 E2 from the texture-window rectangle. */
export function texWindowCommand(mem: PsxEnvMemory, rect: number): number {
    if ((rect >>> 0) === 0) return 0;
    if (mem.read8 === undefined) throw new Error("texWindowCommand needs PsxEnvMemory.read8");
    const u = (mem.read8(rect) & 0xff) >>> 3;
    const offX = ((-s16(mem.read16(rect + 4))) & 0xff) >> 3;
    const v = (mem.read8(rect + 2) & 0xff) >>> 3;
    const offY = ((-s16(mem.read16(rect + 6))) & 0xff) >> 3;
    return ((v << 15) | (u << 10) | 0xe2000000 | (offY << 5) | offX) >>> 0;
}
