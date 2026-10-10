// The Online Center wizard's three column headers, translated from
// pro/stplnmet F0x80087B14 (build) and F0x80087BF4 (select).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-headers-oracle.test.js runs the original through
// engine/native with the text-element factory, the language resource base and
// the widget method slots stubbed and compares the ordered calls.
//
// DECODED: `exe-decomp/stplnmet_c/_asm/F0x80087b14.s` / `F0x80087bf4.s`
// (authority 2) and the accepted wizard-screen-families answer Family E.
// Build creates three kind-3 widgets at the x table 0x80089A80 (228, 256, 284)
// and y 0x12, stores them at block+0x1C/+0x20/+0x24, and for each sets the line
// from resourceGetBase(lang+0x8D) index i+3, 0x138(1) and 0x144(0). Select
// shows all three (0x144(arg & 0xFF)) and lights the one whose index equals the
// wizard's +0x58 selector (0x138(0) selected, 0x138(1) otherwise).

export interface WizardHeaderMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface WizardHeaderHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** (*0x80044F4C)(id) = F0x80013E5C: text bank id -> RAM base. */
    resourceGetBase(id: number): number;
    /** widget+0x114 (F0x800194E8): set the line from a source. */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** widget+0x138 (F0x8001A1F4): set_unk_0xc0. */
    widgetSet138(widget: number, value: number): void;
    /** widget+0x144 (F0x8001A23C): clear/hide. */
    widgetClear(widget: number, value: number): void;
}

export const WIZARD_HEADER_COUNT = 3;
export const WIZARD_HEADER_TABLE = 0x80089a80;
export const WIZARD_HEADER_KIND = 3;
export const WIZARD_HEADER_Y = 0x12;
export const WIZARD_HEADER_SOURCE_OFFSET = 0x8d;
/** Block slots for the three header widgets. */
export const WIZARD_HEADER_BASE = 0x1c;
/** Wizard screen fields read here. */
export const WIZARD_SCREEN_TARGET = 0x50;
export const WIZARD_SCREEN_SELECTOR = 0x58;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** F0x80087B14(screen, block): build the three column headers. */
export function wizardHeaderBuild(
    mem: WizardHeaderMemory,
    screen: number,
    block: number,
    host: WizardHeaderHost,
): void {
    for (let i = 0; i < WIZARD_HEADER_COUNT; i++) {
        const x = s16(mem.read16(WIZARD_HEADER_TABLE + i * 4));
        const target = s16(mem.read16(screen + WIZARD_SCREEN_TARGET));
        const widget = host.createTextElement(target, WIZARD_HEADER_KIND, x, WIZARD_HEADER_Y) >>> 0;
        mem.write32(block + WIZARD_HEADER_BASE + i * 4, widget);
        const source = host.resourceGetBase((mem.read32(0x8005cca8) + WIZARD_HEADER_SOURCE_OFFSET) >>> 0);
        host.widgetSetLine0(widget, source, i + 3);
        host.widgetSet138(widget, 1);
        host.widgetClear(widget, 0);
    }
}

/** F0x80087BF4(screen, block, arg): show all headers, light the selected one. */
export function wizardHeaderSelect(
    mem: WizardHeaderMemory,
    screen: number,
    block: number,
    arg: number,
    host: WizardHeaderHost,
): void {
    const selector = s32(mem.read32(screen + WIZARD_SCREEN_SELECTOR));
    for (let i = 0; i < WIZARD_HEADER_COUNT; i++) {
        const widget = mem.read32(block + WIZARD_HEADER_BASE + i * 4) >>> 0;
        host.widgetClear(widget, arg & 0xff);
        host.widgetSet138(widget, selector === i ? 0 : 1);
    }
}
