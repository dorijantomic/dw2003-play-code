// The small pro/ststatus routines the pause pages install but no page body calls, and
// the overlay's boot tick, translated from the original bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-misc.test.js runs each original through engine/native.
//
//   F0x80083558 pauseBootTick   set up the display and build the pause host.
//   F0x80099F5C pauseGridWord   one word of the 5-wide grid at 0x8009AF40.
//   F0x8009A698 pauseStageByte  the current stage's byte in the 0x8009B5FC table, low 7 bits.
//   F0x8009A6B8 pauseSeenScan   copy each seen map cell's flag into a word table.
import type { PauseMemory } from "./pause-services.ts";
import { mapServerFromStage } from "./map-server.ts";

const GRID = 0x8009af40;
const STAGE_CELL = 0x80048d68;
const STAGE_TABLE = 0x8009b5fc;

export interface PauseBootHost {
    /** [0x8004DE10+0x150](): reset the display. */
    displayReset(): void;
    /** [0x8004DE10+0x154](size): the primitive pool size. */
    setPool(size: number): void;
    /** [0x8004DE10+0x174](w, h, x, y): the display area. */
    setArea(w: number, h: number, x: number, y: number): void;
    /** [0x8004DE10+0x16C](rect, mode, scale): a view over the rectangle. */
    createView(x: number, y: number, w: number, h: number, mode: number, scale: number): number;
    callMethod(target: number, slot: number, args: number[]): void;
    /** F0x80099A80(): build the pause host. */
    pauseHostFactory(): number;
}

/** F0x80083558(obj, out): the overlay's boot tick. */
export function pauseBootTick(mem: PauseMemory, obj: number, out: number, host: PauseBootHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state !== 0 && state >= 0 && state < 4) return;
    host.displayReset();
    host.setPool(0x14000);
    host.setArea(0x140, 0xf0, 0, 0);
    const view = host.createView(0, 0, 0x140, 0xf0, 3, 0x1000);
    host.callMethod(view, 0x12c, [0, 0, 0]);
    mem.write32(out, host.pauseHostFactory());
    host.callMethod(obj, 0x38, []);
}

/** F0x80099F5C(row, column): one word of the grid. */
export function pauseGridWord(mem: PauseMemory, row: number, column: number): number {
    return mem.read32((GRID + (Math.imul(row, 5) + column) * 4) >>> 0) | 0;
}

/** F0x8009A698(): the current stage's byte in the table, low seven bits. */
export function pauseStageByte(mem: PauseMemory): number {
    return mem.read8(STAGE_TABLE + mem.read8(STAGE_CELL)) & 0x7f;
}

/** F0x8009A6B8(table): mark each seen map cell in the word table. */
export function pauseSeenScan(mem: PauseMemory, table: number, flag: (id: number, mode: number) => number): void {
    let low = 0x270;
    let high = 0x2d6;
    if (mapServerFromStage(mem) === 0) {
        low = 0x200;
        high = 0x26f;
    }
    for (let id = low; id <= high; id++) {
        const cell = id & 0xff;
        const slot = mem.read8(STAGE_TABLE + cell) & 0x7f;
        const seen = flag(cell | 0x2000, 1);
        if (seen === 1) mem.write32(table + slot * 4, seen);
    }
}
