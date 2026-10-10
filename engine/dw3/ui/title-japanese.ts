// Japanese title logo, wordmark and glow object ports from pro/stdwtitl.
import { TITLE_DRAW_ORIGIN, TITLE_PACK_HANDLE_PTR } from "./title-draw.ts";
import type { TitleDrawHost } from "./title-draw.ts";
import type { TitleTaskMemory, TitleTaskHost } from "./title-tasks.ts";
import type { TitleTickMemory, TitleTickHost } from "./title-ticks.ts";

export const TITLE_JP_GLOW_TABLE = 0x80087d40;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

function create(mem: TitleTaskMemory, screen: number, host: TitleTaskHost,
    handler: number, method: number): number {
    const obj = host.allocTitleTask(handler, 0x74, 0) >>> 0;
    mem.write32(obj + 0x70, method);
    mem.write32(obj + 0x60, 0x1000);
    mem.write32(obj + 0x64, 2);
    mem.write32(obj + 0x50, screen >>> 0);
    return obj;
}

export function titleJpLogoCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    return create(mem, screen, host, 0x80084edc, 0x8008503c);
}
export function titleJpWordmarkCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    return create(mem, screen, host, 0x80084a70, 0x80084bb0);
}
export function titleJpGlowCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    return create(mem, screen, host, 0x800840a8, 0x800841e0);
}

function drawAt(mem: TitleTickMemory, obj: number, host: TitleDrawHost, clip: number): void {
    host.initDrawContext();
    host.setLayer(s32(mem.read32(obj + 0x60)), 0);
    host.setDepth(0, 0x1f0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.drawSprite(host.packResolve(mem.read32(TITLE_PACK_HANDLE_PTR) >>> 0) >>> 0,
        clip, s32(mem.read32(obj + 0x58)), s32(mem.read32(obj + 0x5c)));
}

export function titleJpLogoDraw(mem: TitleTickMemory, obj: number, host: TitleDrawHost): void {
    drawAt(mem, obj, host, 0);
}
export function titleJpWordmarkDraw(mem: TitleTickMemory, obj: number, host: TitleDrawHost): void {
    drawAt(mem, obj, host, 1);
}
export function titleJpGlowDraw(mem: TitleTickMemory, obj: number, host: TitleDrawHost): void {
    host.initDrawContext();
    if (s32(mem.read32(obj + 0x5c)) !== 0) {
        host.setLayer(s32(mem.read32(obj + 0x60)), 0);
        host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
        host.setDepth(0, 0x1f0);
        host.drawSprite(host.packResolve(mem.read32(TITLE_PACK_HANDLE_PTR) >>> 0) >>> 0, 2, 0x31, 0x79);
        host.initDrawContext();
    }
    host.setLayer(s32(mem.read32(obj + 0x60)), 0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.setFrame(s32(mem.read32(obj + 0x58)));
    host.drawSprite(host.packResolve(mem.read32(TITLE_PACK_HANDLE_PTR) >>> 0) >>> 0, 4, 0x25, 0x72);
}

function slide(mem: TitleTickMemory, obj: number, host: TitleTickHost, drawHost: TitleDrawHost,
    originX: number, y: number, left: boolean, draw: typeof titleJpLogoDraw): void {
    const state0 = s32(mem.read32(obj + 0x0c));
    if (state0 === 1) {
        const state1 = s32(mem.read32(obj + 0x10));
        if (state1 === 1) {
            mem.write32(obj + 0x54, 10);
            host.advance1(obj);
        } else if (state1 !== 2) return;
        const t = s32(mem.read32(obj + 0x54));
        if (left) {
            const x = -(t * 0x140);
            const hi = Math.floor((x * 0x66666667) / 0x100000000) | 0;
            mem.write32(obj + 0x58, (((hi >> 2) - (x >> 31)) + originX) >>> 0);
        } else mem.write32(obj + 0x58, ((t << 5) + originX) >>> 0);
        mem.write32(obj + 0x54, (t - 1) >>> 0);
        if (t <= 0) host.setState0(obj, 2);
        draw(mem, obj, drawHost);
        return;
    }
    if (state0 === 2) {
        if (s32(mem.read32(obj + 0x10)) === 0) {
            mem.write32(obj + 0x58, originX);
            mem.write32(obj + 0x5c, y);
            host.advance1(obj);
        }
        draw(mem, obj, drawHost);
        return;
    }
    if (state0 === 3) return;
    if (s32(mem.read32(obj + 0x50)) === 0) {
        mem.write32(obj + 0x58, left ? (originX - 320) >>> 0 : (originX + 320) >>> 0);
        mem.write32(obj + 0x5c, y);
        host.advance0(obj);
    } else host.setState0(obj, 2);
}

export function titleJpLogoTick(mem: TitleTickMemory, obj: number, host: TitleTickHost,
    drawHost: TitleDrawHost): void {
    slide(mem, obj, host, drawHost, 17, 61, true, titleJpLogoDraw);
}
export function titleJpWordmarkTick(mem: TitleTickMemory, obj: number, host: TitleTickHost,
    drawHost: TitleDrawHost): void {
    slide(mem, obj, host, drawHost, 207, 34, false, titleJpWordmarkDraw);
}
export function titleJpGlowTick(mem: TitleTickMemory, obj: number, host: TitleTickHost,
    drawHost: TitleDrawHost): void {
    const state0 = s32(mem.read32(obj + 0x0c));
    if (state0 === 1) {
        const state1 = s32(mem.read32(obj + 0x10));
        if (state1 === 1) {
            mem.write32(obj + 0x54, 0);
            host.advance1(obj);
        } else if (state1 !== 2) return;
        const index = s32(mem.read32(obj + 0x54));
        mem.write32(obj + 0x58, s16(mem.read16s(TITLE_JP_GLOW_TABLE + index * 2)) >>> 0);
        mem.write32(obj + 0x54, (index + 1) >>> 0);
        if (index + 1 >= 12) host.setState0(obj, 2);
        titleJpGlowDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 2) {
        if (s32(mem.read32(obj + 0x10)) === 0) {
            mem.write32(obj + 0x58, 11);
            mem.write32(obj + 0x5c, 1);
            host.advance1(obj);
        }
        titleJpGlowDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 3) return;
    if (s32(mem.read32(obj + 0x50)) === 0) {
        mem.write32(obj + 0x5c, 0);
        host.advance0(obj);
    } else host.setState0(obj, 2);
}
