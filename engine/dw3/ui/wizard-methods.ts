// Installed method slots of the Online Center wizard's panels, translated from
// pro/stplnmet:
//
//   F0x80085D50 nameEntry->+0xF4  the name-field's state target (0xA)
//   F0x80086E40 confirm->+0xDC    show/hide the register-confirm panel
//   F0x80086EAC confirm->+0xE0    accept the register (sub-state 0x32)
//   F0x800879E0 packList->+0x88   show/hide the starter-pack list
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-methods-oracle.test.js runs each original through
// engine/native with its child-call callee stubbed and compares fields.
//
// DECODED: authority-2 closures `F0x80086e40.s` / `F0x800879e0.s` and the raw
// overlay words for the two one-store bodies (0x24020032 / 0x2402000a), plus
// the accepted wizard-sequence-callees answer. The two show/hide bodies share
// one shape: on sets +0x0C = 2, off sets +0x0C = 1 and +0x10 = 0, then each
// calls its own child routine with (obj, obj+0x24, mode) where mode is 0 on
// show and 1 on hide. The confirm's hide also clears +0x78/+0x74/+0x70/+0x60.

export interface WizardMethodMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface WizardMethodHost {
    /** F0x80086074(obj, child, mode): the confirm panel's child routine. */
    confirmChildCall(obj: number, child: number, mode: number): void;
    /** F0x80087190(obj, child, mode): the pack list's child routine. */
    packChildCall(obj: number, child: number, mode: number): void;
}

export const WIZARD_PANEL_CHILD = 0x24;
export const WIZARD_PANEL_SHOW = 2;
export const WIZARD_PANEL_HIDE = 1;
export const WIZARD_NAME_STATE = 0x0a;
export const WIZARD_CONFIRM_ACCEPT_STATE = 0x32;

/** F0x80085D50(obj): the name field's +0x10 state target. */
export function wizardNameEntryState(mem: WizardMethodMemory, obj: number): void {
    mem.write32(obj + 0x10, WIZARD_NAME_STATE);
}

/** F0x80086EAC(obj): the register-confirm panel's accept sub-state. */
export function wizardConfirmAccept(mem: WizardMethodMemory, obj: number): void {
    mem.write32(obj + 0x10, WIZARD_CONFIRM_ACCEPT_STATE);
}

/** F0x80086E40(obj, on): show or hide the register-confirm panel. */
export function wizardConfirmShow(
    mem: WizardMethodMemory, obj: number, on: number, host: WizardMethodHost,
): void {
    const child = mem.read32(obj + WIZARD_PANEL_CHILD) >>> 0;
    let mode: number;
    if (on !== 0) {
        mem.write32(obj + 0x0c, WIZARD_PANEL_SHOW);
        mode = 0;
    } else {
        mem.write32(obj + 0x0c, WIZARD_PANEL_HIDE);
        mem.write32(obj + 0x10, 0);
        mem.write32(obj + 0x78, 0);
        mem.write32(obj + 0x74, 0);
        mem.write32(obj + 0x70, 0);
        mem.write32(obj + 0x60, 0);
        mode = 1;
    }
    host.confirmChildCall(obj, child, mode);
}

/** F0x800879E0(obj, on): show or hide the starter-pack list. */
export function wizardPackListShow(
    mem: WizardMethodMemory, obj: number, on: number, host: WizardMethodHost,
): void {
    const child = mem.read32(obj + WIZARD_PANEL_CHILD) >>> 0;
    let mode: number;
    if (on !== 0) {
        mem.write32(obj + 0x0c, WIZARD_PANEL_SHOW);
        mode = 0;
    } else {
        mem.write32(obj + 0x0c, WIZARD_PANEL_HIDE);
        mem.write32(obj + 0x10, 0);
        mode = 1;
    }
    host.packChildCall(obj, child, mode);
}
