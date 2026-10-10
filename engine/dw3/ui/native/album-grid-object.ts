// The card album's grid object: its constructor and its per-state tick,
// translated bit-exactly from the original pro/stcrdabm overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/album-grid-object.test.js runs the original through
// engine/native and compares the constructed object, the field writes, the
// ordered boundary calls and the draw intents.
//
//   F0x80083A78  build the grid object (factory F0x80014504 with handler
//                0x80083848): base table +0x28..+0x4C, +0x84 = 0x80083114
//                (begin page), +0x88 = 0x8008314C, +0x54 = 0x1000,
//                +0x58 = 6, +0x50 = arg0.
//   F0x80083848  the per-state tick:
//     state 1     call 0x80083780; draw cells with flag 0.
//     state 2     by sub-state (+0x10):
//                   <2 / >=4: +0x68 += 1; if < 12 call +0x3C then stamp +0x18,
//                             else clamp +0x68 = 12 and set +0x10 = 2.
//                   ==1: if now - +0x18 >= 2 then +0x10 = +0x14.
//                   ==2: call 0x8008304C, +0x64 = 0xC, +0x6C = now, call +0x3C,
//                        and 0x80083734 -> sound 0x4001C.
//                   ==3: if display time - +0x6C >= 2 then +0x6C = display time,
//                        +0x70 += 1, and at 11 set state 1.
//                 then draw silhouettes and draw cells with flag (+0x10 < 3).
//     state 3     nothing.
//     else        call +0x38, force +0x5C = 1, begin page 1.
//
// begin page (F0x80083114) and draw silhouettes (F0x800835BC) are the
// already-translated album-grid functions, called directly so the units
// compose. The remaining callees, the object base methods and the time/sound
// services are host boundaries. This is lane B (engine/dw3/ui/native/**).

import { BASE_TABLE } from "../create-text-element.ts";
import {
    albumGridBeginPage,
    albumGridDrawSilhouettes,
    type AlbumGridHost,
    type AlbumGridMemory,
} from "./album-grid.ts";

/** The grid object's class handler installed at +0x48. */
export const GRID_HANDLER = 0x80083848;
/** Object size the constructor allocates. */
export const GRID_SIZE = 0x8c;

export interface AlbumGridCreateHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
}

/** F0x80083A78(arg0): build the grid object and return it. */
export function albumGridCreate(
    mem: AlbumGridMemory & { write32(addr: number, value: number): void },
    host: AlbumGridCreateHost,
    arg0: number,
): number {
    const obj = host.alloc(GRID_SIZE) >>> 0;
    for (const entry of BASE_TABLE) {
        const off = entry[0];
        mem.write32(obj + off, (off === 0x48 ? GRID_HANDLER : entry[1]) >>> 0);
    }
    mem.write32(obj + 0x84, 0x80083114);
    mem.write32(obj + 0x88, 0x8008314c);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 6);
    mem.write32(obj + 0x50, arg0 | 0);
    return obj;
}

/** Grid object fields read by the tick. */
export const GRID_FIELDS = {
    state: 0x0c,
    sub: 0x10,
    targetSub: 0x14,
    stamp: 0x18,
    method38: 0x38,
    method3c: 0x3c,
    cellCount: 0x64,
    visible: 0x68,
    pulseStamp: 0x6c,
    pulse: 0x70,
} as const;

export interface AlbumGridTickHost extends AlbumGridHost {
    /** obj->+0x38(obj). */
    baseMethod38(obj: number): void;
    /** obj->+0x3C(obj). */
    baseMethod3C(obj: number): void;
    /** F0x80083780(obj). */
    call83780(obj: number): void;
    /** F0x8008304C(obj). */
    call8304c(obj: number): void;
    /** F0x80083734(obj): nonzero to play the pulse sound. */
    call83734(obj: number): number;
    /** F0x80083174(obj, flag): draw the collected card cells. */
    drawCells(obj: number, flag: number): void;
    /** [0x8004DF98](): the frame/time stamp. */
    now(): number;
    /** [0x8004DE10]+0x188(): the display-pass time stamp. */
    displayTime(): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
}

const SOUND_PULSE = 0x4001c;

/** F0x80083848(obj): the album grid's per-state tick. */
export function albumGridTick(
    mem: AlbumGridMemory & { write32(addr: number, value: number): void },
    obj: number,
    host: AlbumGridTickHost,
): void {
    const state = mem.read32(obj + GRID_FIELDS.state) | 0;

    if (state === 1) {
        host.call83780(obj);
        host.drawCells(obj, 0);
        return;
    }

    if (state === 2) {
        stepSub(mem, obj, host);
        albumGridDrawSilhouettes(mem, obj, host);
        const flag = (mem.read32(obj + GRID_FIELDS.sub) | 0) < 3 ? 1 : 0;
        host.drawCells(obj, flag);
        return;
    }

    if (state === 3) return;

    host.baseMethod38(obj);
    mem.write32(obj + 0x5c, 1);
    albumGridBeginPage(mem, obj, 1, host);
}

function stepSub(
    mem: AlbumGridMemory & { write32(addr: number, value: number): void },
    obj: number,
    host: AlbumGridTickHost,
): void {
    const sub = mem.read32(obj + GRID_FIELDS.sub) | 0;

    if (sub === 1) {
        if (((host.now() | 0) - (mem.read32(obj + GRID_FIELDS.stamp) | 0)) < 2) return;
        mem.write32(obj + GRID_FIELDS.sub, mem.read32(obj + GRID_FIELDS.targetSub) | 0);
        return;
    }

    if (sub === 2) {
        host.call8304c(obj);
        mem.write32(obj + GRID_FIELDS.cellCount, 0xc);
        mem.write32(obj + GRID_FIELDS.pulseStamp, host.now() | 0);
        host.baseMethod3C(obj);
        if ((host.call83734(obj) | 0) !== 0) host.playSound(SOUND_PULSE);
        return;
    }

    if (sub === 3) {
        if (((host.displayTime() | 0) - (mem.read32(obj + GRID_FIELDS.pulseStamp) | 0)) < 2) return;
        const t2 = host.displayTime() | 0;
        const next = (mem.read32(obj + GRID_FIELDS.pulse) | 0) + 1;
        mem.write32(obj + GRID_FIELDS.pulseStamp, t2);
        mem.write32(obj + GRID_FIELDS.pulse, next);
        if (next >= 11) mem.write32(obj + GRID_FIELDS.state, 1);
        return;
    }

    // sub-state 0, negative, or >= 4.
    const advanced = (mem.read32(obj + GRID_FIELDS.visible) | 0) + 1;
    mem.write32(obj + GRID_FIELDS.visible, advanced);
    if (advanced < 12) {
        host.baseMethod3C(obj);
        mem.write32(obj + GRID_FIELDS.stamp, host.now() | 0);
        return;
    }
    mem.write32(obj + GRID_FIELDS.visible, 12);
    mem.write32(obj + GRID_FIELDS.sub, 2);
}
