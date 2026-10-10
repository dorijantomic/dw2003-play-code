// The card folder screen's lifecycle tick, translated bit-exactly from the
// original pro/stcrddek F0x80089E98 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/folder-lifecycle.test.js runs the original through
// engine/native and compares the field writes, the ordered boundary calls and
// the chrome draw intents.
//
//   state 1     picker tick (F0x80089354); draw the chrome.
//   state 2     if the screen's +0x70 is clear, wait on *ctx and possibly call
//               the +0x28 base method; otherwise, when *ctx's +0x10 == 0x64,
//               hand the selected record to the child's +0xEC and pulse +0xF0;
//               when its +0x0C == 2, promote it to 3. Then draw the chrome.
//   state 3     run the resource service triple [0x8004B448] / [0x8004B440] /
//               [0x8004B43C].
//   else        [0x8008B830]() then advance +0x10; once +0x10 is 1 and
//               [0x8008B834]() reports ready, build the labels (F0x80088B34),
//               seed the six +0xBC/+0xCC/+0xDC/+0xEC/+0xFC/+0x10C slots with
//               0xA and call +0x38.
//
// folderDrawChrome (F0x80088E74) is the already-translated chrome draw, called
// directly. The picker, label builder, base methods, child methods and service
// cells are host boundaries. This is lane B (engine/dw3/ui/native/**).

import {
    folderDrawChrome,
    type FolderChromeHost,
    type FolderScreenMemory,
} from "./folder-screen.ts";

export type FolderLifecycleMemory = FolderScreenMemory;

export interface FolderLifecycleHost extends FolderChromeHost {
    /** F0x80089354(obj, ctx): the folder picker tick. */
    call89354(obj: number, ctx: number): void;
    /** F0x80088B34(obj, ctx): build the folder list labels. */
    call88b34(obj: number, ctx: number): void;
    /** [0x8008B830](): the screen wait step. */
    wait8330(): void;
    /** [0x8008B834](): nonzero while still waiting. */
    ready8334(): number;
    /** obj->+0x28(obj, value). */
    baseMethod28(obj: number, value: number): void;
    /** obj->+0x38(obj). */
    baseMethod38(obj: number): void;
    /** (*ctx)->+0xEC(child, arg). */
    childEC(child: number, arg: number): void;
    /** (*ctx)->+0xF0(child). */
    childF0(child: number): void;
    /** [0x8004B448](). */
    svc2714(): number;
    /** [0x8004B440](). */
    svc2708(): number;
    /** [0x8004B43C](a, b). */
    svc270c(a: number, b: number): void;
}

/** Folder screen fields written by the lifecycle. */
export const FOLDER_LIFECYCLE_FIELDS = {
    state: 0x0c,
    sub: 0x10,
    method28: 0x28,
    method38: 0x38,
    selection: 0x60,
    gate70: 0x70,
    seeds: [0xbc, 0xcc, 0xdc, 0xec, 0xfc, 0x10c],
} as const;

/** F0x80089E98(obj, ctx): the folder screen's lifecycle tick. */
export function folderScreenLifecycle(
    mem: FolderLifecycleMemory,
    obj: number,
    ctx: number,
    host: FolderLifecycleHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;

    if (state === 1) {
        host.call89354(obj, ctx);
        folderDrawChrome(mem, obj, host);
        return;
    }

    if (state === 2) {
        stepState2(mem, obj, ctx, host);
        folderDrawChrome(mem, obj, host);
        return;
    }

    if (state === 3) {
        const first = host.svc2714() | 0;
        const second = host.svc2708() | 0;
        host.svc270c(first, second);
        return;
    }

    const sub = mem.read32(obj + 0x10) | 0;
    if (sub === 1) {
        if ((host.ready8334() | 0) !== 0) return;
        host.call88b34(obj, ctx);
        for (const off of FOLDER_LIFECYCLE_FIELDS.seeds) mem.write32(obj + off, 0xa);
        host.baseMethod38(obj);
        return;
    }
    host.wait8330();
    mem.write32(obj + 0x10, (mem.read32(obj + 0x10) | 0) + 1);
}

function stepState2(
    mem: FolderLifecycleMemory,
    obj: number,
    ctx: number,
    host: FolderLifecycleHost,
): void {
    if ((mem.read32(obj + 0x70) | 0) === 0) {
        if ((mem.read32(ctx) | 0) !== 0) return;
        host.baseMethod28(obj, 1);
        return;
    }

    const sub = mem.read32(obj + 0x10) | 0;
    if (sub === 1) {
        const child = mem.read32(ctx) >>> 0;
        if ((mem.read32(child + 0x0c) | 0) === 2) {
            mem.write32(child + 0x0c, 3);
            host.baseMethod28(obj, 1);
        }
        return;
    }

    const child = mem.read32(ctx) >>> 0;
    if ((mem.read32(child + 0x10) | 0) !== 0x64) return;
    const arg = (Math.imul(mem.read32(obj + 0x60) | 0, 0x66) + 0x8004935c) | 0;
    host.childEC(child, arg);
    host.childF0(mem.read32(ctx) >>> 0);
    mem.write32(obj + 0x10, sub + 1);
}
