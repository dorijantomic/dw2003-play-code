// The Online Center wizard's fold spellings and the three interactive panels it
// creates, translated from pro/stplnmet:
//
//   F0x80088438 wizardFoldStart        the +0x5C fold, with its two SFX
//   F0x800884CC wizardFoldTick         the fold's per-frame step
//   F0x80085E10 wizardNameEntryCreate  the account-name keyboard
//   F0x80087AC0 wizardPackListCreate   the "Choose a Starter Pack" list
//   F0x80086F60 wizardConfirmCreate    the "Register account?" panel
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-panels-oracle.test.js runs each original through
// engine/native and compares this port's calls, fields and return values.
//
// DECODED: authority-2 closures `exe-decomp/stplnmet_c/_asm/F0x80088438.s`,
// `F0x800884cc.s`, `F0x80085e10.s`, `F0x80087ac0.s`, `F0x80086f60.s` and the
// accepted wizard-sequence-callees answer.
//
// The fold context is the shared four-word record of window-fold.ts
// {+0x00 duration, +0x04 delta, +0x08 value, +0x0C active}; these two bodies
// are the stplnmet spelling reached through the overlay cells
// [0x80089BA0]/[0x80089BA4]. F0x80088438 = windowFoldStart plus the open/close
// system sounds (0x40019/0x4001A); F0x800884CC is field-for-field
// windowFoldTick, so the shared bit-exact helper is reused rather than copied.
//
// Each create is a shared factory call plus a short slot/field fixup:
//   name entry  F0x80014504(0x80085A70, 0xF8, 0x34)
//   pack list   F0x80014504(0x80087A30, 0x8C, 0x30)
//   confirm     F0x80014504(0x80086EB8, 0xE4, 0x20)
// All three set +0x54 = 0x1001 and +0x58 = 6; the pack list and confirm store
// their parent in +0x50, the name entry leaves +0x50 = 0.

import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import type { FoldMemory } from "./window-fold.ts";

export interface WizardPanelMemory extends FoldMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface WizardFoldHost {
    /** [0x80055C48] (F0x8002006C): play a packed system sound id. */
    playSound(id: number): void;
}

export interface WizardPanelHost extends WizardFoldHost {
    /** F0x80014504(handler, size, extra) -> the new panel object. */
    allocWizardPanel(handler: number, size: number, extra: number): number;
    /** F0x80085BBC(obj, saveCtx): load the saved name into the field. */
    initNameField(obj: number, saveCtx: number): void;
    /** F0x80085BB0(obj, w, h): +0x5C = w, +0x60 = h. */
    setNameFieldBox(obj: number, w: number, h: number): void;
}

/** The +0x5C fold record offsets (shared with window-fold.ts). */
export const WIZARD_FOLD_CTX = 0x5c;

export const WIZARD_NAME_ENTRY = {
    handler: 0x80085a70, size: 0xf8, extra: 0x34,
    slotLoad: 0x80085c50, slotShow: 0x80085d5c, slotState: 0x80085d50,
    target: 0x1001, layer: 6, width: 0x140, height: 0x100,
} as const;

export const WIZARD_PACK_LIST = {
    handler: 0x80087a30, size: 0x8c, extra: 0x30,
    slotShow: 0x800879e0, target: 0x1001, layer: 6,
} as const;

export const WIZARD_CONFIRM = {
    handler: 0x80086eb8, size: 0xe4, extra: 0x20,
    slotShow: 0x80086e40, slotAccept: 0x80086eac, target: 0x1001, layer: 6,
} as const;

/** The name-field width cap: 5 for the first language, 8 otherwise. */
export const WIZARD_NAME_LENGTH_FIRST_LANGUAGE = 5;
export const WIZARD_NAME_LENGTH_OTHER = 8;

export const WIZARD_LANGUAGE_PTR = 0x8005cca8;

/** F0x80088438(ctx, open): start the fold and play its open/close sound. */
export function wizardFoldStart(
    mem: WizardPanelMemory, ctx: number, open: number, host: WizardFoldHost,
): void {
    host.playSound(open !== 0 ? 0x40019 : 0x4001a);
    windowFoldStart(mem, ctx, open);
}

/** F0x800884CC(ctx): one fold frame; nonzero when finished or never started. */
export function wizardFoldTick(mem: WizardPanelMemory, ctx: number): number {
    return windowFoldTick(mem, ctx);
}

/** F0x80085E10(saveCtx): build the account-name keyboard. */
export function wizardNameEntryCreate(
    mem: WizardPanelMemory, saveCtx: number, host: WizardPanelHost,
): number {
    const o = WIZARD_NAME_ENTRY;
    const obj = host.allocWizardPanel(o.handler, o.size, o.extra) >>> 0;
    mem.write32(obj + 0xec, o.slotLoad);
    mem.write32(obj + 0xf0, o.slotShow);
    mem.write32(obj + 0xf4, o.slotState);
    mem.write32(obj + 0x54, o.target);
    mem.write32(obj + 0x58, o.layer);
    const language = mem.read32(WIZARD_LANGUAGE_PTR) >>> 0;
    mem.write32(obj + 0x50, 0);
    mem.write32(obj + 0x64, 0xffffffff);
    mem.write32(obj + 0x94,
        language !== 0 ? WIZARD_NAME_LENGTH_OTHER : WIZARD_NAME_LENGTH_FIRST_LANGUAGE);
    host.initNameField(obj, saveCtx);
    host.setNameFieldBox(obj, o.width, o.height);
    return obj;
}

/** F0x80087AC0(parent): build the starter-pack list. */
export function wizardPackListCreate(
    mem: WizardPanelMemory, parent: number, host: WizardPanelHost,
): number {
    const o = WIZARD_PACK_LIST;
    const obj = host.allocWizardPanel(o.handler, o.size, o.extra) >>> 0;
    mem.write32(obj + 0x88, o.slotShow);
    mem.write32(obj + 0x54, o.target);
    mem.write32(obj + 0x58, o.layer);
    mem.write32(obj + 0x50, parent >>> 0);
    return obj;
}

/** F0x80086F60(parent): build the register-confirm panel. */
export function wizardConfirmCreate(
    mem: WizardPanelMemory, parent: number, host: WizardPanelHost,
): number {
    const o = WIZARD_CONFIRM;
    const obj = host.allocWizardPanel(o.handler, o.size, o.extra) >>> 0;
    mem.write32(obj + 0xdc, o.slotShow);
    mem.write32(obj + 0xe0, o.slotAccept);
    mem.write32(obj + 0x54, o.target);
    mem.write32(obj + 0x58, o.layer);
    mem.write32(obj + 0x50, parent >>> 0);
    return obj;
}
