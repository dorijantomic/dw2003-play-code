// The country/language select screen's root tick, translated bit-exactly from
// the original pro/cnty_sel F0x80083D18 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/country-select-tick.test.js runs the original through
// engine/native and compares the ordered calls and screen fields.
//
// F0x80083D18(obj, arg1) is the country-select lifecycle:
//   state 0 / >=4 -> build the five child objects into arg1 (+0x10, +0x8, +0x4,
//                    +0xC; +0x0 later) and reset obj+0x50/+0x52;
//   state 1       -> run the sub-state machine on obj+0x10 (0..13) posted by the
//                    child objects' +0x28 method: timed waits, the pad-driven
//                    list selection (codes 3 confirm / 4 / 6 / 5 / 7), the
//                    menu object's +0x5C readout, and the confirm that writes
//                    the chosen country byte into [0x8005CCA8];
//   state 2 / 3   -> idle.
// Every child object lives in arg1 and is a host boundary, as are the pad, the
// shared sound play and the [0x8004B440] service. The port preserves the exact
// call order, halfword arithmetic and table lookup. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts barrel
// and data/translated_functions.json.

/** The country table: byte[base + selected row]. */
export const COUNTRY_SELECT_TABLE = 0x80084424;
/** The variable the chosen country byte is written into. */
export const COUNTRY_SELECT_GLOBAL = 0x8005cca8;
/** The [0x8004B440] service and its two ids. */
export const COUNTRY_SELECT_SERVICE = 0x8004b440;
export const COUNTRY_SELECT_SERVICE_SET = 0x0e02;
export const COUNTRY_SELECT_SERVICE_CLEAR = 0x0e01;
/** The confirm and move sounds. */
export const COUNTRY_SELECT_CONFIRM_SOUND = 0x4001c;
export const COUNTRY_SELECT_MOVE_SOUND = 0x4001b;
/** The selection row count bounds. */
export const COUNTRY_SELECT_ROWS = 4;
export const COUNTRY_SELECT_LAST = 6;

export interface CountrySelectMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface CountrySelectHost {
    /** F0x800832D8(): child object A (arg1+0x10). */
    createA(): number;
    /** F0x80083804(): child object B (arg1+0x8). */
    createB(): number;
    /** F0x80083A68(): child object C (arg1+0x4). */
    createC(): number;
    /** F0x80083CEC(): child object D (arg1+0xC). */
    createD(): number;
    /** F0x80083594(): the menu object (arg1+0). */
    createMenu(): number;
    /** [0x8004B7D0+0x3F4](port): the primary pad state. */
    padReadA(port: number): number;
    /** [0x8004B7D0+0x3FC](port): the alternate pad state. */
    padReadB(port: number): number;
    /** [0x8004B7D0+0x408](port, code): the shifted button bit. */
    padButton(port: number, code: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8004B440](id, 0): the shared select service. */
    invoke(id: number, arg: number): void;
    /** target+slot(a1, a2, a3): a child/screen object method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** F0x80083D18(obj, arg1): the country-select root tick. */
export function countrySelectTick(
    mem: CountrySelectMemory,
    obj: number,
    arg1: number,
    host: CountrySelectHost,
): void {
    const slot = (off: number) => mem.read32(arg1 + off) | 0;
    const sel = () => signHalf(mem.read16(obj + 0x50));
    const block39 = (target: number) => {
        host.callMethod(target, 0x28, [2]);
        mem.write16(obj + 0x52, 0);
        host.callMethod(obj, 0x3c, []);
    };
    const tail3C = () => host.callMethod(obj, 0x3c, []);
    const tailMenu = () => host.callMethod(slot(0), 0x5c, [sel()]);

    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        switch (mem.read32(obj + 0x10) | 0) {
            case 0x0:
                block39(slot(0x04));
                return;
            case 0x1:
                tickWait(mem, obj, 6, tail3C);
                return;
            case 0x2:
                mem.write16(obj + 0x52, 0);
                host.callMethod(slot(0x0c), 0x28, [2]);
                tail3C();
                return;
            case 0x3:
                tickWait(mem, obj, 0x0b, tail3C);
                return;
            case 0x4:
                mem.write16(obj + 0x52, 0);
                host.callMethod(slot(0x08), 0x28, [2]);
                tail3C();
                return;
            case 0x5:
                tickWait(mem, obj, 6, tail3C);
                return;
            case 0x6:
                mem.write32(arg1 + 0x00, host.createMenu());
                tail3C();
                return;
            case 0x7:
                padCase(mem, obj, arg1, host, tailMenu, slot);
                return;
            case 0x8:
                tickWait(mem, obj, 0x2b, tail3C, true);
                return;
            case 0x9:
                host.callMethod(slot(0x04), 0x28, [2]);
                host.callMethod(slot(0x0c), 0x28, [2]);
                block39(slot(0x08));
                return;
            case 0x0a:
                tickWait(mem, obj, 6, tail3C, true);
                return;
            case 0x0b:
                host.callMethod(slot(0x10), 0x28, [2]);
                tail3C();
                return;
            case 0x0c:
                tickWait(mem, obj, 0x1f, tail3C, true);
                return;
            case 0x0d:
                host.invoke((mem.read32(COUNTRY_SELECT_GLOBAL) | 0) !== 0
                    ? COUNTRY_SELECT_SERVICE_SET : COUNTRY_SELECT_SERVICE_CLEAR, 0);
                host.callMethod(obj, 0x28, [3]);
                return;
            default:
                block39(slot(0x04));
                return;
        }
    }

    if (state === 2 || state === 3) return;

    mem.write32(arg1 + 0x10, host.createA());
    mem.write32(arg1 + 0x08, host.createB());
    mem.write32(arg1 + 0x04, host.createC());
    mem.write32(arg1 + 0x0c, host.createD());
    mem.write16(obj + 0x50, 0);
    mem.write16(obj + 0x52, 0);
    host.callMethod(obj, 0x38, []);
}

/** Cases 1/3/5/8/10/12: advance the +0x52 timer and fire when it reaches limit. */
function tickWait(
    mem: CountrySelectMemory,
    obj: number,
    limit: number,
    tail3C: () => void,
    compareNew = false,
): void {
    const old = mem.read16(obj + 0x52);
    const next = (old + 1) & 0xffff;
    const value = compareNew ? next : old;
    const below = signHalf(value) < limit;
    mem.write16(obj + 0x52, next);
    if (!below) tail3C();
}

/** Case 7: the pad-driven country list selection. */
function padCase(
    mem: CountrySelectMemory,
    obj: number,
    arg1: number,
    host: CountrySelectHost,
    tailMenu: () => void,
    slot: (off: number) => number,
): void {
    const pressed = (code: number): boolean => {
        const a = host.padReadA(0);
        const b = host.padButton(0, code);
        if ((((a >> b) & 1) | 0) !== 0) return true;
        const c = host.padReadB(0);
        const d = host.padButton(0, code);
        return ((((c >> d) & 1) | 0) !== 0);
    };
    const confirm = (): boolean => {
        const a = host.padReadA(0);
        const b = host.padButton(0, 3);
        return ((((a >> b) & 1) | 0) !== 0);
    };
    const sel = () => signHalf(mem.read16(obj + 0x50));

    if (confirm()) {
        host.playSound(COUNTRY_SELECT_CONFIRM_SOUND);
        host.callMethod(slot(0x00), 0x28, [2]);
        host.callMethod(obj, 0x3c, []);
        mem.write16(obj + 0x52, 0);
        mem.write8(COUNTRY_SELECT_GLOBAL, mem.read8(COUNTRY_SELECT_TABLE + sel()));
        tailMenu();
        return;
    }

    const rowSel = mem.read32(obj + 0x14) | 0;
    if (rowSel === 1) {
        if (pressed(7)) {
            const v = sel();
            if (v !== COUNTRY_SELECT_LAST) host.playSound(COUNTRY_SELECT_MOVE_SOUND);
            mem.write16(obj + 0x50, COUNTRY_SELECT_LAST);
            tailMenu();
            return;
        }
        if (pressed(5)) {
            const v = sel();
            if (v === COUNTRY_SELECT_LAST) {
                host.playSound(COUNTRY_SELECT_MOVE_SOUND);
                mem.write16(obj + 0x50, 5);
                tailMenu();
                return;
            }
            mem.write16(obj + 0x50, rowSel & 0xffff);
            host.playSound(COUNTRY_SELECT_MOVE_SOUND);
            host.callMethod(obj, 0x30, [0]);
            tailMenu();
            return;
        }
        tailMenu();
        return;
    }

    if (pressed(4)) {
        if (sel() > 0) {
            host.playSound(COUNTRY_SELECT_MOVE_SOUND);
            mem.write16(obj + 0x50, (mem.read16(obj + 0x50) - 1) & 0xffff);
        }
        tailMenu();
        return;
    }
    if (pressed(6)) {
        if (sel() < COUNTRY_SELECT_ROWS) {
            host.playSound(COUNTRY_SELECT_MOVE_SOUND);
            mem.write16(obj + 0x50, (mem.read16(obj + 0x50) + 1) & 0xffff);
        }
        tailMenu();
        return;
    }
    host.padReadA(0);
    host.padButton(0, 7);
    tailMenu();
}

function signHalf(value: number): number {
    return (value << 16) >> 16;
}
