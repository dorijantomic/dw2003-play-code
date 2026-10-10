// The Online Center wizard's spawn sequence, translated from pro/stplnmet
// F0x80087C9C.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-sequence-oracle.test.js runs the original through
// engine/native with every collaborator stubbed and compares the ordered call
// log, the child-slot writes and the object fields against this port.
//
// DECODED: `exe-decomp/stplnmet_c/_asm/F0x80087c9c.s` (authority 2) and the
// accepted wizard-sequence-tick answer. The screen root F0x80088138 runs this
// only while root state (+0x0C) is 1. It runs its own substate machine on +0x10:
//
//   substate 0  build the intro background, the frame-step and table-dwell
//               animations and the chrome; +0x10 += 1
//   substate 1  once the chrome slot has cleared, start the +0x5C fold, create
//               the three interactive panels, clear +0x58 and advance (+0x10=2)
//   substate 2  selector machine on +0x14: 0 = open the name keyboard,
//               1 = name entry, 2 = register confirm, 3 = commit hand-off
//
// The collaborators are the overlay's own singletons (intro/chrome) and the
// three child panels it spawns; the sequence calls them through their installed
// method slots. Each is a host boundary here, matching the original's slots:
//
//   arg1 = the screen root's +0x24 child array
//   arg1[0x00] chrome        arg1[0x04] name keyboard
//   arg1[0x08] starter-pack list   arg1[0x0C] register confirm
//   arg1[0x10] intro         arg1[0x14] frame-step   arg1[0x18] table-dwell
//
// The fold context is root+0x5C: {+0x00 duration, +0x04 delta, +0x08 value,
// +0x0C active}, exactly the four-word record of window-fold.ts. The fold
// start/tick reached through the overlay cells [0x80089BA0]/[0x80089BA4] are
// F0x80088438/F0x800884CC, the stplnmet spelling of the shared fold family.

import type { FoldMemory } from "./window-fold.ts";

export interface WizardSequenceMemory extends FoldMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The stub/screen root object fields the sequence reads and writes. */
export const WIZARD_SEQ = {
    /** Root state (+0x0C); the root tick dispatches on it. */
    phase: 0x0c,
    /** The sequence's own substate. */
    substate: 0x10,
    /** Selector inside substate 2. */
    selector: 0x14,
    /** The scratch flag the selector branches set (0/1/2). */
    flag: 0x58,
    /** The four-word fold record the sequence starts and ticks. */
    fold: 0x5c,
} as const;

/** The child array (arg1) slot offsets. */
export const WIZARD_SEQ_SLOT = {
    chrome: 0x00,
    nameEntry: 0x04,
    packList: 0x08,
    confirm: 0x0c,
    intro: 0x10,
    frameStep: 0x14,
    tableDwell: 0x18,
} as const;

/** `0x80048D88`: the save context the name keyboard binds and the commit reads. */
export const WIZARD_SAVE_CONTEXT = 0x80048d88;

/** The panel sub-states the sequence waits for (0x64 ready, 0xC8 back-out). */
export const WIZARD_PANEL_READY = 0x64;
export const WIZARD_PANEL_BACK = 0xc8;

/**
 * The sequence's collaborators. Each method stands for one original call - the
 * four overlay creates, the three child-panel creates, the header/selection
 * pulse F0x80087BF4, the installed panel method slots and the starter-pack
 * commit. The host supplies the real callee; the sequence only orders them.
 */
export interface WizardSequenceHost {
    /** [0x80089BA0](ctx, open) = F0x80088438: start the +0x5C fold. */
    foldStart(ctx: number, open: number): void;
    /** [0x80089BA4](ctx) = F0x800884CC: advance the fold; nonzero when done. */
    foldTick(ctx: number): number;
    /** F0x800833A4(): create the intro background object. */
    createIntro(): number;
    /** intro->0x7C(intro, w, h): set the intro box size. */
    introSetBox(intro: number, w: number, h: number): void;
    /** intro->0x80(intro, value, n): bind the intro's target. */
    introBind(intro: number, value: number, n: number): void;
    /** F0x800835C4(): create the frame-step animation. */
    createFrameStep(): number;
    /** F0x80083748(): create the table-dwell animation. */
    createTableDwell(): number;
    /** F0x80083D38(root): create the chrome. */
    createChrome(root: number): number;
    /** F0x80085E10(0x80048D88): create the name-entry keyboard. */
    createNameEntry(saveCtx: number): number;
    /** F0x80087AC0(root): create the starter-pack list. */
    createPackList(root: number): number;
    /** F0x80086F60(root): create the register-confirm panel. */
    createConfirm(root: number): number;
    /** F0x80087BF4(root, arg1, mode): the header/selection pulse. */
    selectHeader(root: number, arg1: number, mode: number): void;
    /** nameEntry->0xF0(ne, on) = F0x80085D5C: show/hide the keyboard. */
    nameEntryShow(ne: number, on: number): void;
    /** packList->0x88(pl, on) = F0x800879E0: show/hide the pack list. */
    packListShow(pl: number, on: number): void;
    /** confirm->0xE0(cf) = F0x80086EAC: accept the register. */
    confirmAccept(cf: number): void;
    /** confirm->0xDC(cf, on) = F0x80086E40: show/hide the confirm panel. */
    confirmShow(cf: number, on: number): void;
    /** nameEntry->0xEC(ne, saveCtx) = F0x80085C50: load the saved name. */
    nameEntryLoad(ne: number, saveCtx: number): void;
    /** [0x8004B450](ptr) = F0x80016DC0: commit the registered starter name. */
    commitStarterName(namePtr: number): void;
    /** obj->0x3C(obj) = F0x800142C8: +0x10 += 1, +0x14 = 0, +0x18 = 0. */
    advanceSubstate(obj: number): void;
}

/**
 * F0x80087C9C(obj, arg1): one wizard-sequence frame.
 *
 * `obj` is the wizard screen root (the original's arg0), `arg1` its +0x24
 * child array. Every branch is the original's: substate (+0x10) 0/1/2, then the
 * +0x14 selector. Values outside those sets fall through to the epilogue.
 */
export function wizardSequenceTick(
    mem: WizardSequenceMemory,
    obj: number,
    arg1: number,
    host: WizardSequenceHost,
): void {
    const substate = mem.read32(obj + WIZARD_SEQ.substate) | 0;

    if (substate === 1) {
        // The chrome must have self-destructed (its slot reads 0) before the
        // interactive panels are created.
        if ((mem.read32(arg1 + WIZARD_SEQ_SLOT.chrome) | 0) !== 0) return;

        host.foldStart((obj + WIZARD_SEQ.fold) >>> 0, 1);
        const nameEntry = host.createNameEntry(WIZARD_SAVE_CONTEXT) >>> 0;
        mem.write32(arg1 + WIZARD_SEQ_SLOT.nameEntry, nameEntry);
        const packList = host.createPackList(obj) >>> 0;
        mem.write32(arg1 + WIZARD_SEQ_SLOT.packList, packList);
        const confirm = host.createConfirm(obj) >>> 0;
        mem.write32(arg1 + WIZARD_SEQ_SLOT.confirm, confirm);
        mem.write32(obj + WIZARD_SEQ.flag, 0);
        host.advanceSubstate(obj);
        return;
    }

    if (substate === 0) {
        const intro = host.createIntro() >>> 0;
        mem.write32(arg1 + WIZARD_SEQ_SLOT.intro, intro);
        host.introSetBox(intro, 0x1c0, 0x100);
        host.introBind(intro, mem.read32(obj + 0x50) >>> 0, 6);
        const frameStep = host.createFrameStep() >>> 0;
        mem.write32(arg1 + WIZARD_SEQ_SLOT.frameStep, frameStep);
        const tableDwell = host.createTableDwell() >>> 0;
        mem.write32(arg1 + WIZARD_SEQ_SLOT.tableDwell, tableDwell);
        const chrome = host.createChrome(obj) >>> 0;
        mem.write32(arg1 + WIZARD_SEQ_SLOT.chrome, chrome);
        mem.write32(obj + WIZARD_SEQ.substate, (substate + 1) >>> 0);
        return;
    }

    if (substate !== 2) return;

    const selector = mem.read32(obj + WIZARD_SEQ.selector) | 0;

    if (selector === 3) {
        if ((host.foldTick((obj + WIZARD_SEQ.fold) >>> 0) | 0) === 0) return;
        if ((mem.read32(arg1 + WIZARD_SEQ_SLOT.confirm) | 0) !== 0) return;
        const ne = mem.read32(arg1 + WIZARD_SEQ_SLOT.nameEntry) | 0;
        const pl = mem.read32(arg1 + WIZARD_SEQ_SLOT.packList) | 0;
        host.nameEntryLoad(ne, WIZARD_SAVE_CONTEXT);
        host.commitStarterName(mem.read32(pl + 0x6c) >>> 0);
        mem.write32(obj + WIZARD_SEQ.phase, selector);
        return;
    }

    if (selector === 1) {
        const pl = mem.read32(arg1 + WIZARD_SEQ_SLOT.packList) | 0;
        const panelState = mem.read32(pl + 0x10) | 0;
        if (panelState === WIZARD_PANEL_READY) {
            host.packListShow(pl, 1);
            const ne = mem.read32(arg1 + WIZARD_SEQ_SLOT.nameEntry) | 0;
            const confirm = mem.read32(arg1 + WIZARD_SEQ_SLOT.confirm) | 0;
            mem.write32(confirm + 0x5c, mem.read32(pl + 0x6c) >>> 0);
            mem.write32(confirm + 0x6c, (ne + 0x78) >>> 0);
            host.confirmShow(confirm, 0);
            mem.write32(obj + WIZARD_SEQ.flag, substate);
            host.selectHeader(obj, arg1, 1);
            mem.write32(obj + WIZARD_SEQ.selector, (selector + 1) >>> 0);
            return;
        }
        if (panelState === WIZARD_PANEL_BACK) {
            host.packListShow(pl, 1);
            const ne = mem.read32(arg1 + WIZARD_SEQ_SLOT.nameEntry) | 0;
            host.nameEntryShow(ne, 0);
            mem.write32(obj + WIZARD_SEQ.flag, 0);
            host.selectHeader(obj, arg1, 1);
            mem.write32(obj + WIZARD_SEQ.selector, (selector - 1) >>> 0);
        }
        return;
    }

    if (selector === 2) {
        const confirm = mem.read32(arg1 + WIZARD_SEQ_SLOT.confirm) | 0;
        const panelState = mem.read32(confirm + 0x10) | 0;
        if (panelState === WIZARD_PANEL_READY) {
            host.confirmAccept(confirm);
            host.foldStart((obj + WIZARD_SEQ.fold) >>> 0, 0);
            host.selectHeader(obj, arg1, 0);
            mem.write32(obj + WIZARD_SEQ.selector, (selector + 1) >>> 0);
            return;
        }
        if (panelState === WIZARD_PANEL_BACK) {
            host.confirmShow(confirm, 1);
            const pl = mem.read32(arg1 + WIZARD_SEQ_SLOT.packList) | 0;
            host.packListShow(pl, 0);
            mem.write32(obj + WIZARD_SEQ.flag, 1);
            host.selectHeader(obj, arg1, 1);
            mem.write32(obj + WIZARD_SEQ.selector, (selector - 1) >>> 0);
        }
        return;
    }

    // selector 0 (and anything outside 1..3): wait out the fold, then open the
    // name keyboard once it reports ready.
    if ((host.foldTick((obj + WIZARD_SEQ.fold) >>> 0) | 0) !== 0) {
        host.selectHeader(obj, arg1, 1);
    }
    const ne = mem.read32(arg1 + WIZARD_SEQ_SLOT.nameEntry) | 0;
    if ((mem.read32(ne + 0x10) | 0) !== WIZARD_PANEL_READY) return;
    host.nameEntryShow(ne, 1);
    const pl = mem.read32(arg1 + WIZARD_SEQ_SLOT.packList) | 0;
    host.packListShow(pl, 0);
    mem.write32(obj + WIZARD_SEQ.flag, 1);
    host.selectHeader(obj, arg1, 1);
    mem.write32(obj + WIZARD_SEQ.selector, (selector + 1) >>> 0);
}
