// The Online Center wizard's name write-back, translated from pro/stplnmet
// F0x80085C50 (the name-entry widget's +0xEC slot).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-name-save-oracle.test.js runs the original through
// engine/native with the text-context builder and its copy slot stubbed, and
// compares the ordered calls and every touched byte.
//
// DECODED: original `~/ddw3/asm/dw2003/pro/stplnmet.s` file 0x2FA0-0x309C
// (the lifter missed this function start, so the authority is the assembly).
// The body is the write half of the pair whose read half is F0x80085BBC:
//   1. zero `width*2` bytes at the save-context pointer (width = obj+0x94);
//   2. walk the field cells at obj+0x78 from width-1 down while they hold the
//      blank glyph 0x4081, clearing each to zero;
//   3. find the first cell from index 0 that is not 0x4081 (the name start);
//   4. build the small text context (F0x8001FCC0) and call its +0x08 slot with
//      (saveCtx, obj + start*2 + 0x78, 1) - mode 1 writes the field into the
//      save block, where F0x80085BBC used mode 0 to read it back.
// A note on the name: the earlier retrieval called this slot "load the saved
// name"; the assembly shows it is the save/write-back called at the wizard's
// hand-off step.

import { WIZARD_NAME_TEXT, WIZARD_NAME_WIDTH } from "./wizard-name-init.ts";
import { WIZARD_NAME_BLANK } from "./wizard-name-field.ts";

export interface WizardNameSaveMemory {
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
}

export interface WizardNameSaveHost {
    /** F0x8001FCC0(ctx): build the small text/fetcher context. */
    initTextContext(): void;
    /**
     * The context's +0x08 slot: copy the field text into the save block
     * (called as (saveCtx, fieldPtr, 1), the inverse of F0x80085BBC).
     */
    textContextCopy(saveCtx: number, fieldPtr: number, mode: number): void;
}


/** F0x80085C50(obj, saveCtx): write the typed name into the save block. */
export function wizardNameFieldSave(
    mem: WizardNameSaveMemory, obj: number, saveCtx: number, host: WizardNameSaveHost,
): void {
    const width = mem.read32(obj + WIZARD_NAME_WIDTH) | 0;
    for (let i = 0; i < width * 2; i++) mem.write8((saveCtx + i) >>> 0, 0);

    let index = width - 1;
    let addr = (obj + index * 2) >>> 0;
    while (index >= 0 && (mem.read16s(addr + WIZARD_NAME_TEXT) & 0xffff) === WIZARD_NAME_BLANK) {
        mem.write16(addr + WIZARD_NAME_TEXT, 0);
        index -= 1;
        addr = (addr - 2) >>> 0;
    }

    let start = 0;
    let scan = obj;
    while (start < width && (mem.read16s(scan + WIZARD_NAME_TEXT) & 0xffff) === WIZARD_NAME_BLANK) {
        start += 1;
        scan = (scan + 2) >>> 0;
    }

    host.initTextContext();
    host.textContextCopy(saveCtx >>> 0, (obj + start * 2 + WIZARD_NAME_TEXT) >>> 0, 1);
}
