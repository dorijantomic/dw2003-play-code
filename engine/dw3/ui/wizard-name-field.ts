// The Online Center wizard's name-field methods, translated from pro/stplnmet:
//
//   F0x80085D5C nameEntry->+0xF0   show/hide the keyboard and pick the cursor
//   F0x80085BB0 shared setter      the field box size (+0x5C/+0x60)
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-name-field-oracle.test.js runs both originals through
// engine/native with the child routine stubbed and compares fields.
//
// DECODED: `exe-decomp/stplnmet_c/F0x80085d5c.c` and the raw overlay words for
// the show/hide branch (0x80085d5c..0x80085e04); `_asm/F0x80085bb0.s`. The
// field buffer is 16-bit cells at obj+0x78, obj+0x94 cells wide, filled with
// 0x4081 (the blank glyph); obj+0x90 receives the caret index reported by the
// scan. The child routine slot is obj+0x24 and the callee is F0x80084060.

export interface WizardNameFieldMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface WizardNameFieldHost {
    /** F0x80084060(obj, child, mode): the name widget's show/hide routine. */
    nameEntryChildCall(obj: number, child: number, mode: number): void;
}

export const WIZARD_NAME_FIELD = {
    child: 0x24,
    show: 2,
    hide: 1,
    text: 0x78,
    width: 0x94,
    caret: 0x90,
    boxWidth: 0x5c,
    boxHeight: 0x60,
} as const;

/** The blank name glyph filling every unused cell. */
export const WIZARD_NAME_BLANK = 0x4081;

/** F0x80085D5C(obj, on): show or hide the name keyboard and set the caret. */
export function wizardNameEntryShow(
    mem: WizardNameFieldMemory, obj: number, on: number, host: WizardNameFieldHost,
): void {
    const child = mem.read32(obj + WIZARD_NAME_FIELD.child) >>> 0;
    if (on !== 0) {
        mem.write32(obj + 0x0c, WIZARD_NAME_FIELD.show);
        host.nameEntryChildCall(obj, child, 0);
        const width = mem.read32(obj + WIZARD_NAME_FIELD.width) | 0;
        let index = width - 1;
        if (index >= 0) {
            let addr = obj + index * 2;
            while ((mem.read16(addr + WIZARD_NAME_FIELD.text) & 0xffff) === WIZARD_NAME_BLANK) {
                index -= 1;
                addr -= 2;
                if (index < 0) break;
            }
        }
        const caret = index === width - 1 ? index : index + 1;
        mem.write32(obj + WIZARD_NAME_FIELD.caret, caret >>> 0);
        return;
    }
    mem.write32(obj + 0x0c, WIZARD_NAME_FIELD.hide);
    mem.write32(obj + 0x10, 2);
    host.nameEntryChildCall(obj, child, 1);
}

/** F0x80085BB0(obj, w, h): the name box size. */
export function wizardNameFieldBox(
    mem: WizardNameFieldMemory, obj: number, w: number, h: number,
): void {
    mem.write32(obj + WIZARD_NAME_FIELD.boxWidth, w >>> 0);
    mem.write32(obj + WIZARD_NAME_FIELD.boxHeight, h >>> 0);
}
