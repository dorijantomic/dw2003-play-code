// The card-folder label builder, translated from pro/stcrddek F0x80088B34.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/folder-list-create-oracle.test.js.
//
// DECODED: exe-decomp/stcrddek_c/F0x80088B34.c and the accepted
// list-builder-family answer (U2). It builds 24 label widgets and one cursor
// into the caller's slot array `slots`:
//
//   slots+0x04              = create(target, 1, 0x97, 0x22)
//   for t = 0..2 (base slots+0x1C*t):
//     slots+base+0x08       = create(target, 1, 0x1C, 0x53 + 0x2D*t)
//     for i = 0..5:
//       slots+base+0x0C+4i  = create(target, 1, 0x3B + 0x23*i, 0x64 + 0x2D*t)
//   slots+0x5C              = create(target, 1, 0xA7, 0x23)
//   slots+0x60              = create(target, 1, 0xA7, 0x31)
//   slots+0x64              = spawnUiIcon(target, bucket-2, 0x9A, 0x23); cursor+0x80(cursor, 0)
//   for k = 0 .. (screen+0x20 - 3) - 1:
//     slots[1+k]->+0x15C(slots[1+k], bucket-2)
//
// target = screen+0x50, bucket = screen+0x54, count = screen+0x20 (27).
// createTextElement (F0x8001AE38) and spawnUiIcon (F0x8001B364) are explicit
// host boundaries; +0x15C is the already-translated F0x8001A448 set_unk_0x58.

import { set_unk_0x58_fns_8001a448 } from "./text-element-setters.ts";

export interface ListBuilderMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ListBuilderHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(target, value, x, y) -> cursor pointer. */
    spawnUiIcon(target: number, value: number, x: number, y: number): number;
    /** The cursor's +0x80(self, 0) call (still native). */
    cursorActivate(cursor: number): void;
}

/** F0x80088B34(screen, slots): build the folder list's labels and cursor. */
export function folderListCreateLabels(
    mem: ListBuilderMemory,
    screen: number,
    slots: number,
    host: ListBuilderHost,
): void {
    const target = mem.read32(screen + 0x50);
    const bucket = mem.read32(screen + 0x54);
    const count = mem.read32(screen + 0x20);

    mem.write32(slots + 0x04, host.createTextElement(target, 1, 0x97, 0x22));
    for (let t = 0; t < 3; t++) {
        const base = slots + t * 0x1c;
        mem.write32(base + 0x08, host.createTextElement(target, 1, 0x1c, 0x53 + 0x2d * t));
        for (let i = 0; i < 6; i++) {
            mem.write32(base + 0x0c + i * 4, host.createTextElement(target, 1, 0x3b + 0x23 * i, 0x64 + 0x2d * t));
        }
    }
    mem.write32(slots + 0x5c, host.createTextElement(target, 1, 0xa7, 0x23));
    mem.write32(slots + 0x60, host.createTextElement(target, 1, 0xa7, 0x31));

    const cursor = host.spawnUiIcon(target, (bucket - 2) | 0, 0x9a, 0x23) >>> 0;
    mem.write32(slots + 0x64, cursor);
    host.cursorActivate(cursor);

    const n = (count - 3) | 0;
    for (let k = 0; k < n; k++) {
        const widget = mem.read32(slots + 0x04 + k * 4) >>> 0;
        set_unk_0x58_fns_8001a448(mem, widget, (bucket - 2) | 0);
    }
}
