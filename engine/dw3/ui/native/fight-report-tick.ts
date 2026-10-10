// The battle-report screen's row state machine, translated bit-exactly from the
// original pro/stfgtrep F0x80084EC4 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/fight-report-tick.test.js runs the original through
// engine/native and compares the ordered method/service calls and fields.
//
// F0x80084EC4(obj, arr) switches on obj+0x10 (0..0x35):
//   1  call every row's +0x160, then advance;
//   4  when every row state is 5, open the +0x90 fold and advance;
//   5  advance once the +0x90 fold reports ready;
//   6  walk obj+0x14 through the rows: skip score-0 rows, on a scored row open
//      the +0x80 fold, call the row's +0x170 and advance; at the end set state
//      0x14 via obj+0x2C;
//   7  once the +0x80 fold is ready, fill the name/score widgets;
//   8  close/advance the row widgets on their +0x168/+0x170 and the pad, play
//      the confirm sound, and set obj+0x74 on the pad;
//   A  call the current row's +0x168; B close the row window and step;
//   C  jump to state 6 once the +0x80 fold is ready;
//   14 award the current party record's score (with a +1/5 bonus on a 0x142
//      match), fill the widgets, add it to the money (capped) and go to 0x19;
//   15 award the second record's count (capped at 0x63) and go to 0x19;
//   19 close the row window and choose 0x15/0x32 by obj+0x14, or advance the
//      pad-driven close;
//   32 spawn the fade object and open the +0x90 fold;
//   33 once the +0x90 fold is ready, call every row's +0x164 and advance;
//   34 advance when every row state is 0xF;
//   35 set the screen state to 3 when the fade object reports state 2.
//
// The fold services ([0x80089144]/[0x80089148]), the pad ([0x8004B7D0+0x3F4/
// +0x408]), the resource base ([0x80044F4C]), the card service
// ([0x80048D34+0x2718/+0x2750]), the fade object (F0x80083218), the packed
// sound ([0x80055C48]) and every widget/row method are host boundaries; the
// port preserves the exact call order, table arithmetic and writes. This is
// lane B (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts
// barrel and data/translated_functions.json.

/** The shared global pointer whose value + 0x55 is the resource string base. */
export const REPORT_NAME_CONTEXT = 0x8005cca8;
/** The three-record configuration table. */
export const REPORT_TICK_RECORD_TABLE = 0x80042b84;
/** The per-record score table; entries are 0xC bytes, the score at +8. */
export const REPORT_TICK_SCORE_TABLE = 0x80086a88;
export const REPORT_TICK_SCORE_STRIDE = 0x0c;
export const REPORT_TICK_SCORE_FIELD = 0x8;
/** The shared card service base and its index/record slots. */
export const REPORT_TICK_SERVICE = 0x80048d34;
export const REPORT_TICK_INDEX_SLOT = 0x2718;
export const REPORT_TICK_RECORD_SLOT = 0x2750;
/** The money field and its clamp. */
export const REPORT_TICK_MONEY_OFFSET = 0x6c;
export const REPORT_TICK_MONEY_CAP = 0x98967f;
/** The card-record fields that trigger the +1/5 bonus. */
export const REPORT_TICK_MATCH_FIELD = 0x3c8;
export const REPORT_TICK_MATCH_FIELD_ALT = 0x3ca;
export const REPORT_TICK_MATCH = 0x142;
/** The packed confirm sound and the pad button that closes the row window. */
export const REPORT_TICK_CONFIRM_SOUND = 0x4001c;
export const REPORT_TICK_CONFIRM_BUTTON = 0x0d;
/** The row array base offset (row pointers start at arr+0xC). */
export const REPORT_TICK_ROWS = 0x0c;

export interface ReportTickMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ReportTickHost {
    /** [0x80089144](ptr, flag): start a window fold at ptr. */
    foldStart(ptr: number, flag: number): void;
    /** [0x80089148](ptr): nonzero while the fold at ptr is still running. */
    foldBusy(ptr: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8004B7D0+0x3F4](port): the pad state word. */
    padRead(port: number): number;
    /** [0x8004B7D0+0x408](port, code): the shifted pad button bit. */
    padButton(port: number, code: number): number;
    /** [0x80044F4C](id): the resource/string base for id. */
    resourceBase(id: number): number;
    /** [0x80048D34+0x2718](cardId): the card slot index. */
    cardIndexOf(cardId: number): number;
    /** [0x80048D34+0x2750](index): the card record. */
    cardRecord(index: number): number;
    /** F0x80083218(): the fade object. */
    createFade(): number;
    /** obj+0x2C(value): the object's set-state method. */
    setState(value: number): void;
    /** target+slot(a1, a2, a3): a widget/row/fade object method. */
    callMethod(target: number, slot: number, args: number[]): number;
}

/** F0x80084EC4(obj, arr): the report row state machine. */
export function reportTick(
    mem: ReportTickMemory,
    obj: number,
    arr: number,
    host: ReportTickHost,
): void {
    const advance = () => mem.write32(obj + 0x10, (mem.read32(obj + 0x10) + 1) | 0);
    const row = (i: number) => mem.read32(arr + REPORT_TICK_ROWS + i * 4) | 0;
    const count = () => mem.read32(obj + 0x60) | 0;

    switch (mem.read32(obj + 0x10) | 0) {
        case 0x1: {
            const n = count();
            for (let i = 0; i < n; i++) host.callMethod(row(i), 0x160, []);
            advance();
            return;
        }
        case 0x4: {
            const n = count();
            let all5 = true;
            for (let i = 0; i < n; i++) {
                if ((mem.read32(row(i) + 0x10) | 0) !== 5) { all5 = false; break; }
            }
            if (all5) {
                host.foldStart(obj + 0x90, 1);
                advance();
            }
            return;
        }
        case 0x5:
            if ((host.foldBusy(obj + 0x90) | 0) !== 0) advance();
            return;
        case 0x6: {
            const idx = mem.read32(obj + 0x14) | 0;
            if (idx < count()) {
                if ((mem.read32(obj + 0x64 + idx * 4) | 0) === 0) {
                    mem.write32(obj + 0x14, (idx + 1) | 0);
                    return;
                }
                host.foldStart(obj + 0x80, 1);
                const r = row(idx);
                host.callMethod(r, 0x170, []);
                advance();
                return;
            }
            host.setState(0x14);
            return;
        }
        case 0x7: {
            if ((host.foldBusy(obj + 0x80) | 0) === 0) return;
            const w8 = mem.read32(arr + 0x08) | 0;
            host.callMethod(w8, 0x114, [host.resourceBase((mem.read32(REPORT_NAME_CONTEXT) + 0x55) | 0), 2]);
            const score = mem.read32(obj + 0x64 + (mem.read32(obj + 0x14) | 0) * 4) | 0;
            host.callMethod(w8, 0x118, [1, score]);
            host.callMethod(w8, 0x130, [6]);
            const w0 = mem.read32(arr + 0x00) | 0;
            host.callMethod(w0, 0x118, [0, score]);
            host.callMethod(w0, 0x148, [1]);
            const w4 = mem.read32(arr + 0x04) | 0;
            host.callMethod(w4, 0x114, [host.resourceBase((mem.read32(REPORT_NAME_CONTEXT) + 0x55) | 0), 1]);
            advance();
            return;
        }
        case 0x8: {
            const w8 = mem.read32(arr + 0x08) | 0;
            if ((host.callMethod(w8, 0x168, []) | 0) !== 0) {
                mem.write32(obj + 0x74, 0);
                host.callMethod(w8, 0x144, [0]);
                mem.write32(obj + 0x10, 0x0a);
                return;
            }
            if ((host.callMethod(w8, 0x170, []) | 0) !== 0) {
                if (padConfirmed(host)) {
                    host.playSound(REPORT_TICK_CONFIRM_SOUND);
                    return;
                }
                mem.write32(obj + 0x74, 1);
                return;
            }
            if (padConfirmed(host)) host.callMethod(w8, 0x128, []);
            return;
        }
        case 0x0a: {
            const r = row(mem.read32(obj + 0x14) | 0);
            host.callMethod(r, 0x168, []);
            advance();
            return;
        }
        case 0x0b: {
            const r = row(mem.read32(obj + 0x14) | 0);
            if ((mem.read32(r + 0x10) | 0) !== 5) return;
            host.foldStart(obj + 0x80, 0);
            host.callMethod(mem.read32(arr + 0x00) | 0, 0x144, [0]);
            host.callMethod(mem.read32(arr + 0x04) | 0, 0x144, [0]);
            mem.write32(obj + 0x10, (mem.read32(obj + 0x10) + 1) | 0);
            mem.write32(obj + 0x14, (mem.read32(obj + 0x14) + 1) | 0);
            return;
        }
        case 0x0c:
            if ((host.foldBusy(obj + 0x80) | 0) !== 0) mem.write32(obj + 0x10, 6);
            return;
        case 0x14: {
            const record = host.cardRecord(host.cardIndexOf(signHalf(mem.read16(REPORT_TICK_RECORD_TABLE + 4))) | 0);
            const index = signHalf(mem.read16(REPORT_TICK_RECORD_TABLE));
            let score = mem.read32(REPORT_TICK_SCORE_TABLE + index * REPORT_TICK_SCORE_STRIDE + REPORT_TICK_SCORE_FIELD) | 0;
            if (signHalf(mem.read16(record + REPORT_TICK_MATCH_FIELD)) === REPORT_TICK_MATCH
                || signHalf(mem.read16(record + REPORT_TICK_MATCH_FIELD_ALT)) === REPORT_TICK_MATCH) {
                score = (score + Math.trunc(score / 5)) | 0;
            }
            const w8 = mem.read32(arr + 0x08) | 0;
            host.callMethod(w8, 0x114, [host.resourceBase((mem.read32(REPORT_NAME_CONTEXT) + 0x55) | 0), 0x0a]);
            host.callMethod(w8, 0x118, [1, score]);
            host.callMethod(w8, 0x130, [6]);
            mem.write32(obj + 0x10, 0x19);
            mem.write32(obj + 0x14, 0);
            const money = (mem.read32(REPORT_TICK_SERVICE + REPORT_TICK_MONEY_OFFSET) + score) | 0;
            mem.write32(REPORT_TICK_SERVICE + REPORT_TICK_MONEY_OFFSET, money);
            if (money > REPORT_TICK_MONEY_CAP) {
                mem.write32(REPORT_TICK_SERVICE + REPORT_TICK_MONEY_OFFSET, REPORT_TICK_MONEY_CAP);
            }
            return;
        }
        case 0x15: {
            const value = signHalf(mem.read16(REPORT_TICK_RECORD_TABLE + 2));
            if (value === 0) {
                mem.write32(obj + 0x10, 0x32);
                return;
            }
            const w8 = mem.read32(arr + 0x08) | 0;
            host.callMethod(w8, 0x114, [host.resourceBase((mem.read32(REPORT_NAME_CONTEXT) + 0x55) | 0), 0x0b]);
            host.callMethod(w8, 0x120, [host.resourceBase((mem.read32(REPORT_NAME_CONTEXT) + 0x6a) | 0), value, 1]);
            host.callMethod(w8, 0x130, [6]);
            mem.write32(obj + 0x10, 0x19);
            mem.write32(obj + 0x14, 1);
            const addr = REPORT_TICK_SERVICE + value + 0x7c;
            mem.write8(addr, (mem.read8(addr) + 1) & 0xff);
            const signed = (mem.read8(addr) << 24) >> 24;
            if (signed >= 0x64) mem.write8(addr, 0x63);
            return;
        }
        case 0x19: {
            const w8 = mem.read32(arr + 0x08) | 0;
            if ((host.callMethod(w8, 0x168, []) | 0) !== 0) {
                host.callMethod(w8, 0x144, [0]);
                const idx = mem.read32(obj + 0x14) | 0;
                mem.write32(obj + 0x74, 0);
                mem.write32(obj + 0x10, idx === 1 ? 0x32 : 0x15);
                return;
            }
            if ((host.callMethod(w8, 0x170, []) | 0) !== 0) {
                if (padConfirmed(host)) {
                    host.playSound(REPORT_TICK_CONFIRM_SOUND);
                    return;
                }
                mem.write32(obj + 0x74, 1);
                return;
            }
            if (padConfirmed(host)) host.callMethod(w8, 0x128, []);
            return;
        }
        case 0x32: {
            const fade = host.createFade();
            mem.write32(arr + 0x18, fade);
            host.callMethod(fade, 0x64, [0, 0x1e]);
            host.foldStart(obj + 0x90, 0);
            host.callMethod(mem.read32(arr + 0x08) | 0, 0x144, [0]);
            advance();
            return;
        }
        case 0x33: {
            if ((host.foldBusy(obj + 0x90) | 0) === 0) return;
            const n = count();
            for (let i = 0; i < n; i++) host.callMethod(row(i), 0x164, []);
            advance();
            return;
        }
        case 0x34: {
            const n = count();
            let all = true;
            for (let i = 0; i < n; i++) {
                if ((mem.read32(row(i) + 0x10) | 0) !== 0x0f) { all = false; break; }
            }
            if (all) advance();
            return;
        }
        case 0x35: {
            const fade = mem.read32(arr + 0x18) | 0;
            if ((mem.read32(fade + 0x0c) | 0) === 2) mem.write32(obj + 0x0c, 3);
            return;
        }
        default:
            advance();
            return;
    }
}

/** The pad confirm test shared by cases 8 and 0x19. */
function padConfirmed(host: ReportTickHost): boolean {
    const pad = host.padRead(0) | 0;
    const bit = host.padButton(0, REPORT_TICK_CONFIRM_BUTTON) | 0;
    return (((pad >> bit) & 1) | 0) !== 0;
}

function signHalf(value: number): number {
    return (value << 16) >> 16;
}
