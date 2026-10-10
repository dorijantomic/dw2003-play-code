// The Online Center wizard's name-field initialiser, translated from
// pro/stplnmet F0x80085BBC.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-name-init-oracle.test.js runs the original through
// engine/native with the text-context builder, its source slot and the text
// measurer stubbed, and compares the ordered calls and the padded field.
//
// DECODED: `exe-decomp/stplnmet_c/_asm/F0x80085bbc.s` and
// `exe-decomp/stplnmet_c/F0x80085bbc.c`. The body:
//   1. builds a small text context with F0x8001FCC0 at sp+0x10;
//   2. calls its +0x08 slot with (nameField, saveCtx, 0);
//   3. measures the field with F0x8002525C and halves the result (cells);
//   4. if that is under the field width (obj+0x94), pads every remaining
//      16-bit cell at obj+0x78 with the blank glyph 0x4081.
//
import { WIZARD_NAME_BLANK } from "./wizard-name-field.ts";

// The F0x8001FCC0 context and its slots are boundary services here, matching
// the convention already used by engine/dw3/ui/memcard-root.ts.

export interface WizardNameInitMemory {
    read32(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface WizardNameInitHost {
    /** F0x8001FCC0(ctx): build the small text/fetcher context. */
    initTextContext(): void;
    /**
     * The context's +0x08 slot: point the text buffer at the saved name
     * (called as (nameField, saveCtx, 0) from the field init).
     */
    textContextSource(buffer: number, saveCtx: number, mode: number): void;
    /** F0x8002525C(buffer): the buffer's text length in bytes. */
    measureText(buffer: number): number;
}

export const WIZARD_NAME_TEXT = 0x78;
export const WIZARD_NAME_WIDTH = 0x94;

/** F0x80085BBC(obj, saveCtx): load the saved name and pad the field. */
export function wizardNameFieldInit(
    mem: WizardNameInitMemory, obj: number, saveCtx: number, host: WizardNameInitHost,
): void {
    host.initTextContext();
    const buffer = (obj + WIZARD_NAME_TEXT) >>> 0;
    host.textContextSource(buffer, saveCtx, 0);
    const cells = (host.measureText(buffer) | 0) >> 1;
    const width = mem.read32(obj + WIZARD_NAME_WIDTH) | 0;
    if (cells < width) {
        let addr = (obj + cells * 2 + WIZARD_NAME_TEXT) >>> 0;
        for (let i = cells; i < width; i++) {
            mem.write16(addr, WIZARD_NAME_BLANK);
            addr = (addr + 2) >>> 0;
        }
    }
}
