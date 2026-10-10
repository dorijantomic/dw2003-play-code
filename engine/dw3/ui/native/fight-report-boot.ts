// The fight report's boot chain: the overlay entry constructor, the boot task it
// builds, the root constructor and the bank-ready probe, translated from the
// original pro/stfgtrep bodies (disassembled 2026-09-30 from the overlay image;
// the m2c list omits F0x80082E70, F0x80085B24 and F0x80085C08).
//
// Oracle: tests/lane-b/fight-report-boot.test.js runs each original through
// engine/native and compares the ordered boundary calls and the fields.
//
//   F0x80082F6C reportEntryCreate   overlay entry: factory(handler F0x80082E70, 0x50, extra 4).
//   F0x80082E70 reportBootTick      boot task. In state 0, a negative state or a state
//               of 4 or more it sets the display up (resident display service +0x150,
//               +0x154(0x14000), +0x174(0x140, 0xF0, 0, 0), then +0x16C(rect, 3, 0x1000)
//               returns the screen's view whose +0x12C(view, 0, 0, 0) clears its colour),
//               builds the root into extra word 0 and advances itself; states 1..3 idle.
//   F0x80085B24 reportRootCreate    factory(handler F0x800857F0, 0xA0, extra 0x1C); +0x50 =
//               0x1000 (layer), +0x54 = 7 (bucket).
//   F0x80085C08 reportBanksReady    1 while any of the three text banks (language + 0x55,
//               +0x4E, +0x6A) is still loading, else 0.
//
// The display-service calls are a documented platform boundary: their ports exist
// (resetDisplayService, setDisplayPacketIndex, setDisplayRegion, registerDisplayView,
// setRectColour) but they only prepare GPU packet buffers and registered views that the
// browser never reads; the canvas and the recorded picture calls replace them.
export const REPORT_BOOT_HANDLER = 0x80082e70;
export const REPORT_BOOT_SIZE = 0x50;
export const REPORT_BOOT_EXTRA = 4;
export const REPORT_ROOT_HANDLER = 0x800857f0;
export const REPORT_ROOT_SIZE = 0xa0;
export const REPORT_ROOT_EXTRA = 0x1c;
export const REPORT_LANGUAGE_CELL = 0x8005cca8;
export const REPORT_PACKET_BYTES = 0x14000;
export const REPORT_VIEW_KIND = 3;
export const REPORT_VIEW_PRIORITY = 0x1000;
export const REPORT_SCREEN = { width: 0x140, height: 0xf0 } as const;

export interface ReportBootMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ReportBootHost {
    /** F0x80014504(handler, size, extra): allocate a screen object. */
    alloc(handler: number, size: number, extra: number): number;
    /** [0x8004DE10+0x150](): reset the display service. */
    displayReset(): void;
    /** [0x8004DE10+0x154](bytes): size the packet buffers. */
    displayPacketSize(bytes: number): void;
    /** [0x8004DE10+0x174](width, height, interlace, high): set the display region. */
    displayRegion(width: number, height: number, a2: number, a3: number): void;
    /** [0x8004DE10+0x16C](rect, kind, priority): register the screen's view; returns it. */
    displayView(rect: { x: number; y: number; w: number; h: number }, kind: number, priority: number): number;
    /** view+0x12C(view, r, g, b): set the view's clear colour. */
    viewColour(view: number, r: number, g: number, b: number): void;
    /** self+0x38(self): the task's advance method. */
    advance(): void;
}

/** F0x80082F6C(): the overlay entry constructor. */
export function reportEntryCreate(host: Pick<ReportBootHost, "alloc">): number {
    return host.alloc(REPORT_BOOT_HANDLER, REPORT_BOOT_SIZE, REPORT_BOOT_EXTRA);
}

/** F0x80085B24(): the root object. */
export function reportRootCreate(mem: ReportBootMemory, host: Pick<ReportBootHost, "alloc">): number {
    const root = host.alloc(REPORT_ROOT_HANDLER, REPORT_ROOT_SIZE, REPORT_ROOT_EXTRA);
    mem.write32(root + 0x50, 0x1000);
    mem.write32(root + 0x54, 7);
    return root;
}

/** F0x80082E70(self, arr): the boot task's tick. */
export function reportBootTick(
    mem: ReportBootMemory,
    self: number,
    arr: number,
    host: ReportBootHost & { createRoot(): number },
): void {
    const state = mem.read32(self + 0x0c) | 0;
    if (state !== 0 && state >= 0 && state < 4) return;
    host.displayReset();
    host.displayPacketSize(REPORT_PACKET_BYTES);
    host.displayRegion(REPORT_SCREEN.width, REPORT_SCREEN.height, 0, 0);
    const view = host.displayView({ x: 0, y: 0, w: REPORT_SCREEN.width, h: REPORT_SCREEN.height },
        REPORT_VIEW_KIND, REPORT_VIEW_PRIORITY);
    host.viewColour(view, 0, 0, 0);
    mem.write32(arr, host.createRoot());
    host.advance();
}

export interface ReportBanksHost {
    /** [0x80044B38+0x404](id): nonzero while that resource is still loading. */
    pending(id: number): number;
}

/** F0x80085C08(): 1 while a report text bank is loading, else 0. */
export function reportBanksReady(mem: Pick<ReportBootMemory, "read32">, host: ReportBanksHost): number {
    const language = mem.read32(REPORT_LANGUAGE_CELL) | 0;
    if ((host.pending((language + 0x55) | 0) | 0) !== 0) return 1;
    if ((host.pending((mem.read32(REPORT_LANGUAGE_CELL) + 0x4e) | 0) | 0) !== 0) return 1;
    return (host.pending((mem.read32(REPORT_LANGUAGE_CELL) + 0x6a) | 0) | 0) !== 0 ? 1 : 0;
}
