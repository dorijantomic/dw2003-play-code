// The title/boot screen's glow and slide ticks, translated from pro/stdwtitl
// (family C, contract from the accepted title-screen-executed-families answer;
// every branch re-read against the authority-2 closures).
//
// Each tick dispatches on +0x0C: 0 (and >= 4 / negative) is the setup branch,
// 2 and 3 idle (except the state-2 tail), 1 runs the mode script. The three
// slide scripts share one shape: an idle-in / slide / idle-out sequence that
// writes the sprite position (+0x58/+0x5C) and calls their own draw body.
// Their draw bodies (wordmark 0x80084C3C, logo 0x800850C8) live here too; the
// glow's draw is title-draw.ts's titleNumeralGlowDraw.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/title-ticks-oracle.test.js runs each original through
// engine/native with the state setters and the pack resolver stubbed.

import {
    titleDecoLayerDraw, titleNumeralGlowDraw, TITLE_PACK_HANDLE_PTR, TITLE_DRAW_ORIGIN,
} from "./title-draw.ts";
import type { TitleDrawHost, TitleDrawMemory } from "./title-draw.ts";

export interface TitleTickMemory extends TitleDrawMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface TitleTickHost {
    /** obj+0x28 (F0x80014274): set state0. */
    setState0(obj: number, state: number): void;
    /** obj+0x2C (F0x80014288): set state1. */
    setState1(obj: number, state: number): void;
    /** obj+0x38 (F0x800142AC): advance state0. */
    advance0(obj: number): void;
    /** obj+0x3C (F0x800142C8): advance state1 (zeroes +0x14/+0x18). */
    advance1(obj: number): void;
}

export const TITLE_TICK = { state0: 0x0c, state1: 0x10, script: 0x54 } as const;
export const TITLE_GLOW_SCRIPT_TABLE = 0x80087d58;
/** The glow's palette script terminator. */
export const TITLE_SCRIPT_END = -1;

const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;

/** F0x80084C3C(obj): draw the DIGIMON WORLD wordmark (title pack clip 1). */
export function titleWordmarkDraw(mem: TitleDrawMemory, obj: number, host: TitleDrawHost): void {
    const handle = mem.read32(TITLE_PACK_HANDLE_PTR) >>> 0;
    host.initDrawContext();
    host.setLayer(s32(mem.read32(obj + 0x60)), 0);
    host.setDepth(0, 0x1f0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.drawSprite(host.packResolve(handle) >>> 0, 1,
        s32(mem.read32(obj + 0x58)), s32(mem.read32(obj + 0x5c)));
}

/** F0x800850C8(obj): draw the DIGIMON logo (title pack clip 0). */
export function titleLogoDraw(mem: TitleDrawMemory, obj: number, host: TitleDrawHost): void {
    const handle = mem.read32(TITLE_PACK_HANDLE_PTR) >>> 0;
    host.initDrawContext();
    host.setLayer(s32(mem.read32(obj + 0x60)), 0);
    host.setDepth(0, 0x1f0);
    host.setOrigin(TITLE_DRAW_ORIGIN.x, TITLE_DRAW_ORIGIN.y);
    host.drawSprite(host.packResolve(handle) >>> 0, 0,
        s32(mem.read32(obj + 0x58)), s32(mem.read32(obj + 0x5c)));
}

/** F0x800843A4(obj): the "3" glow's palette-script tick. */
export function titleGlowTick(
    mem: TitleTickMemory, obj: number, host: TitleTickHost, drawHost: TitleDrawHost,
): void {
    const state0 = s32(mem.read32(obj + TITLE_TICK.state0));
    if (state0 === 1) {
        const s1 = s32(mem.read32(obj + TITLE_TICK.state1));
        if (s1 === 1) {
            mem.write32(obj + TITLE_TICK.script, 0);
            mem.write32(obj + 0x58, 0);
            host.advance1(obj);
        }
        if (s1 === 1 || s1 === 2) {
            const script = s16(mem.read32(obj + TITLE_TICK.script));
            const value = s16(mem.read16s(TITLE_GLOW_SCRIPT_TABLE + script * 2));
            mem.write32(obj + 0x58, value >>> 0);
            if (value === TITLE_SCRIPT_END) host.setState0(obj, 2);
            titleNumeralGlowDraw(mem, obj, drawHost);
            mem.write32(obj + TITLE_TICK.script, s16(script + 1) >>> 0);
        }
        return;
    }
    if (state0 === 2) {
        if (s32(mem.read32(obj + TITLE_TICK.state1)) === 0) {
            mem.write32(obj + 0x58, 0xffffffff);
            mem.write32(obj + 0x5c, 1);
            host.advance1(obj);
        }
        titleNumeralGlowDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 3) return;
    if (s32(mem.read32(obj + 0x50)) === 0) {
        mem.write32(obj + 0x5c, 0);
        host.advance0(obj);
        return;
    }
    host.setState0(obj, 2);
}

/** F0x80084CD4(obj): the wordmark's right-to-left slide. */
export function titleWordmarkTick(
    mem: TitleTickMemory, obj: number, host: TitleTickHost, drawHost: TitleDrawHost,
): void {
    const state0 = s32(mem.read32(obj + TITLE_TICK.state0));
    if (state0 === 1) {
        const s1 = s32(mem.read32(obj + TITLE_TICK.state1));
        if (s1 === 1) {
            mem.write32(obj + TITLE_TICK.script, 0x0a);
            host.advance1(obj);
        } else if (s1 !== 2) {
            return;
        }
        const t = s32(mem.read32(obj + TITLE_TICK.script));
        mem.write32(obj + 0x58, ((t << 5) + 0x13) >>> 0);
        mem.write32(obj + TITLE_TICK.script, (t - 1) >>> 0);
        if (t <= 0) host.setState0(obj, 2);
        titleWordmarkDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 2) {
        if (s32(mem.read32(obj + TITLE_TICK.state1)) === 0) {
            mem.write32(obj + 0x58, 0x13);
            mem.write32(obj + 0x5c, 0x6f);
            host.advance1(obj);
        }
        titleWordmarkDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 3) return;
    mem.write32(obj + 0x58, 0x153);
    mem.write32(obj + 0x5c, 0x6f);
    host.advance0(obj);
}

/** F0x80085160(obj): the logo's left-to-right slide (x = 19 - 8*script). */
export function titleLogoTick(
    mem: TitleTickMemory, obj: number, host: TitleTickHost, drawHost: TitleDrawHost,
): void {
    const state0 = s32(mem.read32(obj + TITLE_TICK.state0));
    if (state0 === 1) {
        const s1 = s32(mem.read32(obj + TITLE_TICK.state1));
        if (s1 === 1) {
            mem.write32(obj + TITLE_TICK.script, 0x0a);
            host.advance1(obj);
        } else if (s1 !== 2) {
            return;
        }
        const t = s32(mem.read32(obj + TITLE_TICK.script));
        const x = s32(-(t * 0x140));
        // MULT_HI(x, 0x66666667) >> 2, i.e. trunc(x / 40), then + 0x13.
        const hi = Math.floor((x * 0x66666667) / 0x100000000) | 0;
        mem.write32(obj + 0x58, (((hi >> 2) - (x >> 31)) + 0x13) >>> 0);
        mem.write32(obj + TITLE_TICK.script, (t - 1) >>> 0);
        if (t <= 0) host.setState0(obj, 2);
        titleLogoDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 2) {
        if (s32(mem.read32(obj + TITLE_TICK.state1)) === 0) {
            mem.write32(obj + 0x58, 0x13);
            mem.write32(obj + 0x5c, 0x18);
            host.advance1(obj);
        }
        titleLogoDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 3) return;
    mem.write32(obj + 0x58, 0xfffffed3);
    mem.write32(obj + 0x5c, 0x18);
    host.advance0(obj);
}

// ---------------------------------------------------------------------------
// F0x800831E8 — the decoration layer's palette walk (pro/stdwtitl).
//
// DECODED: authority-2 `_asm/F0x800831e8.s` and the accepted
// title-deco-layer-tick contract. A three-state machine on +0x0C:
//   1        sub-dispatch on +0x10: 0 returns; 1 arms (advance1, +0x54=1, the
//            index fields +0x58/+0x60 = 0) then walks; 2 walks; >=3 returns.
//            After the walk, if both done flags sum to 2 it sets state1=2, then
//            draws. The walk runs whether state1 was 1 or 2.
//   0 or <0  gate +0x50: 0 -> advance0; nonzero -> setState0(2); no draw.
//   2        if +0x10==0: +0x5a=11, +0x62=7, +0x54=1, advance1; then draw.
//   3        nothing at all (no advance, no draw).
//   > 3      same as the 0/<0 default.
// The walk steps up to two blocks once per call while their done flag (+0x5c,
// +0x64) is clear; block fields are 8 bytes apart while the table offset
// advances by 0x1A. It reads the two records of 0x80087C54 and freezes a block
// on the -1 terminator, re-reading the entry before it.
const TITLE_DECO_WALK_TABLE = 0x80087c54;
const TITLE_DECO_WALK_STRIDE = 0x1a;
const TITLE_DECO_WALK_END = -1;
const TITLE_DECO_END_A = 0x0b;
const TITLE_DECO_END_B = 0x07;

export const TITLE_DECO = {
    state0: 0x0c,
    state1: 0x10,
    setState0: 0x28,
    setState1: 0x2c,
    advance0: 0x38,
    advance1: 0x3c,
    gate: 0x50,
    drawEnable: 0x54,
    indexA: 0x58,
    shiftA: 0x5a,
    doneA: 0x5c,
    indexB: 0x60,
    shiftB: 0x62,
    doneB: 0x64,
} as const;

/** F0x800831E8(obj): one decoration-layer palette-walk frame. */
export function titleDecoLayerTick(
    mem: TitleTickMemory, obj: number, host: TitleTickHost, drawHost: TitleDrawHost,
): void {
    const state0 = s32(mem.read32(obj + TITLE_DECO.state0));
    if (state0 === 1) {
        const state1 = s32(mem.read32(obj + TITLE_DECO.state1));
        if (state1 === 1) {
            // The +0x54 store is the jalr delay slot: it lands before advance1.
            mem.write32(obj + TITLE_DECO.drawEnable, 1);
            host.advance1(obj);
            mem.write16(obj + TITLE_DECO.indexA, 0);
            mem.write16(obj + TITLE_DECO.indexB, 0);
        } else if (state1 !== 2) {
            return;
        }
        titleDecoLayerWalk(mem, obj);
        if (s32(mem.read32(obj + TITLE_DECO.doneA)) + s32(mem.read32(obj + TITLE_DECO.doneB)) === 2) {
            host.setState1(obj, 2);
        }
        titleDecoLayerDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 2) {
        if (s32(mem.read32(obj + TITLE_DECO.state1)) === 0) {
            mem.write16(obj + TITLE_DECO.shiftA, TITLE_DECO_END_A);
            mem.write16(obj + TITLE_DECO.shiftB, TITLE_DECO_END_B);
            mem.write32(obj + TITLE_DECO.drawEnable, 1);
            host.advance1(obj);
        }
        titleDecoLayerDraw(mem, obj, drawHost);
        return;
    }
    if (state0 === 3) return;
    if (s32(mem.read32(obj + TITLE_DECO.gate)) === 0) {
        host.advance0(obj);
        return;
    }
    host.setState0(obj, 2);
}

/** The two-block palette walk shared by the state-1 arms. */
function titleDecoLayerWalk(mem: TitleTickMemory, obj: number): void {
    for (let block = 0; block < 2; block++) {
        const base = obj + block * 8;
        const off = block * TITLE_DECO_WALK_STRIDE;
        const doneField = base + TITLE_DECO.doneA;
        if (s32(mem.read32(doneField)) !== 0) continue;
        const indexField = base + TITLE_DECO.indexA;
        const shiftField = base + TITLE_DECO.shiftA;
        const index0 = s16(mem.read16s(indexField));
        const first = s16(mem.read16s(TITLE_DECO_WALK_TABLE + off + index0 * 2));
        if (first === TITLE_DECO_WALK_END) {
            mem.write32(doneField, 1);
            mem.write16(indexField, u16(index0 - 1));
        }
        const index = s16(mem.read16s(indexField));
        const value = mem.read16s(TITLE_DECO_WALK_TABLE + off + index * 2) & 0xffff;
        mem.write16(indexField, u16(index + 1));
        mem.write16(shiftField, value);
    }
}
