// The battle-report screen's root tick, translated bit-exactly from the
// original pro/stfgtrep F0x800857F0 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/fight-report-screen.test.js runs the original through
// engine/native and compares the ordered boundary calls and the screen fields.
//
// F0x800857F0(obj, arr) is the report screen's lifecycle:
//   state 1  -> run the report state machine (0x80084EC4) then draw the chrome
//               (0x80084C20);
//   state 2  -> idle return;
//   state 3  -> release the shared service ([0x80048D34+0x270C]);
//   default  -> sub-state 0 asks for the text banks ([0x8008913C]) and advances
//               obj+0x10; sub-state 1 waits on the bank-ready probe
//               ([0x80089140]), then builds the level widgets (0x80084B98),
//               counts the present card slots into obj+0x60 and the set stat
//               flags into obj+0x70, picks a score scale from the three
//               record flags at 0x80042B84 against the table at 0x80086A88,
//               builds one report row (0x80084AEC) per count slot into
//               arr+0xC (calling each row's +0x16C method into obj+0x64), and
//               seeds obj+0x80/obj+0x90 to 0xA.
//
// The sub-screen calls, the shared card service, the bank request/ready probes
// and the row factory are host boundaries; the port preserves the exact call
// order, table arithmetic and writes. This is lane B (engine/dw3/ui/native/**);
// lane A owns the shared engine/dw3/ui/index.ts barrel and
// data/translated_functions.json.

/** The three-record report configuration table (resident). */
export const REPORT_RECORD_TABLE = 0x80042b84;
/** The per-record score table in the overlay; entries are 0xC bytes, field +4. */
export const REPORT_SCORE_TABLE = 0x80086a88;
export const REPORT_SCORE_STRIDE = 0x0c;
export const REPORT_SCORE_FIELD = 0x4;
/** The per-record flag byte offsets inside the four-byte record. */
export const REPORT_RECORD_FLAG = 0x6;
export const REPORT_STAT_FLAG = 0x7;
export const REPORT_RECORD_COUNT = 3;
/** The shared card service base and its index/release slots. */
export const REPORT_SHARED_SERVICE = 0x80048d34;
export const REPORT_SHARED_INDEX_SLOT = 0x2718;
export const REPORT_RELEASE_SLOT = 0x270c;
export const REPORT_RELEASE_ARG = 0x34;
/** The two scrolls the report screen seeds when its rows are built. */
export const REPORT_SCROLL = 0x0a;

export interface ReportScreenMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ReportScreenHost {
    /** [0x8008913C](1): request the screen's text banks. */
    requestBanks(flag: number): void;
    /** [0x80089140](1): nonzero while the banks are still loading. */
    banksReady(flag: number): number;
    /** obj+0x38(obj): the base object's advance method. */
    baseAdvance(): void;
    /** F0x80084B98(obj, arr): build the screen's three level widgets. */
    buildLevelWidgets(arr: number): void;
    /** [0x80048D34+0x2718](i): the card slot index, or negative when absent. */
    cardIndexOf(index: number): number;
    /** F0x80084AEC(obj, index, score): build one report row. */
    createRow(rowIndex: number, score: number): number;
    /** row+0x16C(row): the row's score method. */
    rowMethod16C(row: number): number;
    /** [0x80048D34+0x270C]([0x80048D34+0x34], 0): release the shared service. */
    releaseService(id: number): void;
    /** F0x80084EC4(obj, arr): the report state machine. */
    reportTick(): void;
    /** F0x80084C20(obj): the report chrome draw. */
    drawChrome(): void;
}

/** F0x800857F0(obj, arr): the report screen's root tick. */
export function reportScreenTick(
    mem: ReportScreenMemory,
    obj: number,
    arr: number,
    host: ReportScreenHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        host.reportTick();
        host.drawChrome();
        return;
    }
    if (state === 2) return;
    if (state === 3) {
        host.releaseService(mem.read32(REPORT_SHARED_SERVICE + REPORT_RELEASE_ARG) | 0);
        return;
    }

    const sub = mem.read32(obj + 0x10) | 0;
    if (sub !== 1) {
        host.requestBanks(1);
        mem.write32(obj + 0x10, (sub + 1) | 0);
        return;
    }

    if ((host.banksReady(1) | 0) !== 0) return;

    host.baseAdvance();
    host.buildLevelWidgets(arr);

    for (let i = 0; i < REPORT_RECORD_COUNT; i++) {
        if ((host.cardIndexOf(i) | 0) >= 0) {
            mem.write32(obj + 0x60, (mem.read32(obj + 0x60) + 1) | 0);
        }
    }

    let present = 0;
    for (let r = 0; r < REPORT_RECORD_COUNT; r++) {
        if (mem.read8(REPORT_RECORD_TABLE + r * 4 + REPORT_RECORD_FLAG) !== 0) {
            present += 1;
            for (let v = 0; v < REPORT_RECORD_COUNT; v++) {
                if (mem.read8(REPORT_RECORD_TABLE + r * 4 + v + REPORT_STAT_FLAG) !== 0) {
                    mem.write32(obj + 0x70, (mem.read32(obj + 0x70) + 1) | 0);
                }
            }
        }
    }

    const index = (mem.read16(REPORT_RECORD_TABLE) << 16) >> 16;
    const base = mem.read32(REPORT_SCORE_TABLE + index * REPORT_SCORE_STRIDE + REPORT_SCORE_FIELD) | 0;
    let score = base;
    if (present === 2) {
        score = signedDiv30((((base << 1) + base) << 1) | 0, 10);
    } else if (present === 3) {
        score = signedDiv30(base, 3);
    }

    const count = mem.read32(obj + 0x60) | 0;
    if (count > 0) {
        for (let i = 0; i < count; i++) {
            if (mem.read8(REPORT_RECORD_TABLE + i * 4 + REPORT_RECORD_FLAG) !== 0) {
                const row = host.createRow(i, score);
                mem.write32(arr + 0x0c + i * 4, row);
                mem.write32(obj + 0x64 + i * 4, host.rowMethod16C(row));
            } else {
                mem.write32(arr + 0x0c + i * 4, host.createRow(i, 0));
            }
        }
    }

    mem.write32(obj + 0x80, REPORT_SCROLL);
    mem.write32(obj + 0x90, REPORT_SCROLL);
}

/** MIPS signed 32-bit division (truncating toward zero). */
function signedDiv30(n: number, d: number): number {
    return Math.trunc(n / d);
}
