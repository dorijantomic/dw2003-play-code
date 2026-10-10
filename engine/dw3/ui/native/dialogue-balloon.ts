// The field conversation speech balloon, translated bit-exactly from the
// resident EXE: F0x8001CE44 (build), F0x8001CAB0 (tick) and F0x8001C948
// (reposition, balloon vtable +0x68).
//
// Oracle: tests/lane-b/dialogue-balloon.test.js runs the originals through
// engine/native on resident.bin. Worklist:
// .dw3-research/screen-worklists-2026-10-01/dialogue.md.
//
// Layout table D0x8004DCF4 (0x20 bytes per mode, halfwords at +0x14 name tab
// x,y and +0x18 body x,y, relative to the anchor):
//   mode 0: tab (6,-71)   body (6,-58)    mode 1: tab (6,15)   body (6,28)
//   mode 2: tab (-20,-71) body (-20,-58)  mode 3: tab (-20,15) body (-20,28)
// Modes 0/1 then shift both windows left by the body width (0x5F..0x8B), so the
// body ends 6 right of the anchor (LEFT of it). Modes 2/3 start 20 left of the
// anchor and extend right (RIGHT of it). Modes 0/2 sit above (-58), 1/3 below (+28).
//
// Task fields: +0xC state, +0x10 open(0)/close(1), +0x14 step, +0x24 state block
// (+0 / +4 / +8 tail cells, +0xC tab, +0x10 body, +0x14 marker), +0x50 text pack,
// +0x54 kind, +0x58 mode, +0x5C counter, +0x60/+0x62 anchor, +0x64 width,
// +0x66 tail height (0x3E), +0x68 reposition method.
//
// Host boundaries: F0x80014504, F0x8001AE38, F0x8001C85C, F0x8001C4B4,
// F0x8002529C (unported), the widget methods, the pad service, the SFX entry.

import { initFetcherTable } from "../fetch-table.ts";
import type { FetcherMemory } from "../fetch-table.ts";
import { zeroFill } from "../../zero-fill.ts";
import { strcpyBytes } from "../../byte-ops.ts";
import { PAD_BLOCK } from "../../../systems/pad-block.ts";

export const BALLOON_BUILD = 0x8001ce44;
export const BALLOON_TICK = 0x8001cab0;
export const BALLOON_REPOSITION = 0x8001c948;
export const BALLOON_TASK_SIZE = 0x6c;
export const BALLOON_LAYOUT_TABLE = 0x8004dcf4;
export const BALLOON_DELAYS: readonly number[] = [0, 2, 4];
export { PAD_BLOCK as BALLOON_PAD_BASE };
export const BALLOON_SOUND_CELL = 0x80055c48;
export const BALLOON_SFX_OPEN = 0x40019;
export const BALLOON_SFX_CLOSE = 0x4001a;
export const BALLOON_BUTTON = 0xd;
export const BALLOON_UNKNOWN_NAME_STRING = 0x80048d88;
/** Scratch bytes the build needs: 0xC fetcher block, then the 0x20 name buffer at +0x10. */
export const BALLOON_SCRATCH_SIZE = 0x30;

export interface BalloonMemory extends FetcherMemory {}

export interface BalloonHost {
    /** F0x80014504(tick, size, align): create the task, return its object. */
    createTask(tick: number, size: number, align: number): number;
    /** F0x8001AE38(kind, font, x, y): create a text element. */
    createText(kind: number, font: number, x: number, y: number): number;
    /** F0x8001C85C(kind, x, y, width, height, mode): spawn the tail. */
    createTail(kind: number, x: number, y: number, width: number, height: number, mode: number): number;
    /** F0x8001C4B4(task): spawn the marker task. */
    createMarker(task: number): number;
    /** F0x8002529C(dest, src, n): bounded string copy. */
    copyBounded(dest: number, src: number, n: number): void;
    /** target.method[slot](target, ...args): return the result. */
    callMethod(target: number, slot: number, args: number[]): number;
    /** Call a fetcher block entry (FETCHER_TABLE_ENTRY / FETCHER_MEASURE_ENTRY). */
    callFetcher(fn: number, args: number[]): number;
    padRead(port: number): number;
    padShift(port: number, button: number): number;
    playSound(id: number): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** F0x8001CE44(kind, x, y, pack, line, mode): build the balloon, return the task. */
export function dialogueBalloonBuild(
    mem: BalloonMemory, host: BalloonHost, scratch: number,
    kind: number, x: number, y: number, pack: number, line: number, mode: number,
): number {
    const task = u32(host.createTask(BALLOON_TICK, BALLOON_TASK_SIZE, 0x18));
    mem.write16(task + 0x62, y);
    const state = u32(mem.read32(task + 0x24));
    mem.write32(task + 0x54, kind);
    mem.write16(task + 0x60, x);
    mem.write32(task + 0x68, BALLOON_REPOSITION);
    mem.write32(task + 0x58, mode);
    initFetcherTable(mem, scratch);
    const lay = u32(BALLOON_LAYOUT_TABLE + ((mode << 5) >>> 0));
    const tab = u32(host.createText(s16(mem.read32(task + 0x54)), 2,
        s16(mem.read16(task + 0x60) + mem.read16(lay + 0x14)),
        s16(mem.read16(task + 0x62) + mem.read16(lay + 0x16))));
    mem.write32(state + 0xc, tab);
    host.callMethod(tab, 0x160, [3]);
    const body = u32(host.createText(s16(mem.read32(task + 0x54)), 1,
        s16(mem.read16(task + 0x60) + mem.read16(lay + 0x18)),
        s16(mem.read16(task + 0x62) + mem.read16(lay + 0x1a))));
    mem.write32(state + 0x10, body);
    host.callMethod(body, 0x160, [3]);
    mem.write32(task + 0x50, pack);

    const text = u32(host.callFetcher(u32(mem.read32(scratch + 0)), [pack, line]));
    const buf = scratch + 0x10;
    let bodyText: number;
    if (mem.read8(text) === 2 && mem.read8(text + 1) === 7) {
        let n = 2;
        if (mem.read8(text + 2) !== 2) {
            let p = text + n;
            for (;;) {
                if (mem.read8(p + 1) === 7) break;
                p += 1;
                n += 1; // the bne delay slot: runs on both paths
                if (mem.read8(p) === 2) break;
                p = text + n;
            }
        }
        zeroFill(mem, buf, 0x20);
        if (mem.read8(text + 2) === 2 && mem.read8(text + 3) === 9) {
            strcpyBytes(mem, buf, BALLOON_UNKNOWN_NAME_STRING);
        } else {
            host.copyBounded(buf, text + 2, n - 2);
        }
        host.callMethod(u32(mem.read32(state + 0xc)), 0x114, [buf, -1]);
        bodyText = text + n + 2;
    } else {
        bodyText = text;
    }
    host.callMethod(u32(mem.read32(state + 0x10)), 0x114, [bodyText, -1]);
    host.callMethod(u32(mem.read32(state + 0x10)), 0x130, [6]);
    host.callMethod(u32(mem.read32(state + 0x10)), 0x14c, []);
    const b = u32(mem.read32(state + 0x10));
    let width = s32(host.callFetcher(u32(mem.read32(scratch + 4)), [b + 0x5c, mem.read32(b + 0x50), 0]));
    if (width < 0x5f) width = 0x5f;
    else if (width >= 0x8c) width = 0x8b;
    mem.write16(task + 0x66, 0x3e);
    mem.write16(task + 0x64, width);
    if (mode >>> 0 < 2) {
        const t = u32(mem.read32(state + 0xc));
        host.callMethod(t, 0x134, [s16(mem.read16(t + 0xb0) - width), s16(mem.read16(t + 0xb2))]);
        const bw = u32(mem.read32(state + 0x10));
        host.callMethod(bw, 0x134, [s16(mem.read16(bw + 0xb0) - mem.read16(task + 0x64)), s16(mem.read16(bw + 0xb2))]);
    }
    for (let i = 0; i < 2; i++) {
        host.callMethod(u32(mem.read32(state + 0xc + i * 4)), 0x138, [2]);
        host.callMethod(u32(mem.read32(state + 0xc + i * 4)), 0x144, [0]);
    }
    mem.write32(state + 0x14, host.createMarker(task));
    return task;
}

/** F0x8001CAB0(obj, state): the balloon's per-frame tick. */
export function dialogueBalloonTick(mem: BalloonMemory, host: BalloonHost, obj: number, state: number): void {
    const taskState = s32(mem.read32(obj + 0x0c));
    const cell = (off: number): number => u32(mem.read32(state + off));
    if (taskState === 1) {
        if (s32(host.callMethod(cell(0x10), 0x168, [])) !== 0) {
            host.callMethod(obj, 0x28, [2]);
            host.callMethod(obj, 0x2c, [1]);
            host.callMethod(cell(0x14), 0x28, [2]);
            host.callMethod(cell(0xc), 0x144, [0]);
            host.callMethod(cell(0x10), 0x144, [0]);
        } else {
            const pad = s32(host.padRead(0));
            const shift = s32(host.padShift(0, BALLOON_BUTTON));
            if (((pad >> shift) & 1) !== 0) host.callMethod(cell(0x10), 0x128, []);
        }
        if (s32(host.callMethod(cell(0x10), 0x170, [])) !== 0) mem.write8(cell(0x14) + 0x5c, 1);
        else mem.write8(cell(0x14) + 0x5c, 0);
        return;
    }
    if (taskState === 3) return;
    if (taskState !== 2) {
        host.callMethod(obj, 0x28, [2]);
        return;
    }
    const step = s32(mem.read32(obj + 0x14));
    if (step === 3) {
        const phase = s32(mem.read32(obj + 0x10));
        if (phase === 0) {
            if (s32(mem.read32(cell(0x8) + 0xbc)) !== 0) {
                host.callMethod(obj, 0x28, [1]);
                host.callMethod(cell(0x14), 0x28, [1]);
                host.callMethod(cell(0xc), 0x144, [1]);
                host.callMethod(cell(0x10), 0x144, [1]);
            }
        } else if (phase === 1) {
            if (u32(mem.read32(state + 0x8)) === 0) host.callMethod(obj, 0x28, [3]);
        }
        return;
    }
    if (step < 1 || step >= 3) {
        host.playSound(s32(mem.read32(obj + 0x10)) === 0 ? BALLOON_SFX_OPEN : BALLOON_SFX_CLOSE);
    }
    const counter = s32(mem.read32(obj + 0x5c));
    mem.write32(obj + 0x5c, u32(counter + 1));
    if (counter < (BALLOON_DELAYS[step] ?? 0)) return;
    const tail = u32(host.createTail(
        s32(mem.read32(obj + 0x54)), s16(mem.read16(obj + 0x60)), s16(mem.read16(obj + 0x62)),
        s16(mem.read16(obj + 0x64)), s16(mem.read16(obj + 0x66)), s32(mem.read32(obj + 0x58))));
    const slot = state + step * 4;
    mem.write32(slot, tail);
    mem.write32(tail + 0xb8, mem.read32(obj + 0x10));
    mem.write16(tail + 0x5c, s32(mem.read32(obj + 0x10)) === 0 ? 0x199 : 0x333);
    host.callMethod(obj, 0x40, []);
    mem.write32(obj + 0x5c, 0);
}

/** F0x8001C948(obj, x, y): move the balloon (vtable +0x68). */
export function dialogueBalloonReposition(mem: BalloonMemory, host: BalloonHost, obj: number, x: number, y: number): void {
    const state = u32(mem.read32(obj + 0x24));
    mem.write16(obj + 0x60, x);
    mem.write16(obj + 0x62, y);
    for (let i = 0; i < 3; i++) {
        const w = u32(mem.read32(state + i * 4));
        if (w !== 0 && s32(mem.read32(w + 0xc)) === 1) {
            mem.write16(w + 0x50, mem.read16(w + 0x6c) + x);
            mem.write16(w + 0x52, mem.read16(w + 0x6e) + y);
        }
    }
    const mode = u32(mem.read32(obj + 0x58));
    const lay = u32(BALLOON_LAYOUT_TABLE + ((mode << 5) >>> 0));
    for (const [cellOff, dx, dy] of [[0xc, 0x14, 0x16], [0x10, 0x18, 0x1a]] as const) {
        const w = u32(mem.read32(state + cellOff));
        if (w === 0) continue;
        let px = s16(mem.read16(obj + 0x60)) + s16(mem.read16(lay + dx));
        if (mode < 2) px -= s16(mem.read16(obj + 0x64));
        host.callMethod(w, 0x134, [s16(px), s16(s16(mem.read16(obj + 0x62)) + s16(mem.read16(lay + dy)))]);
    }
}
