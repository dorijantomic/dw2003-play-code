// The title screen's pacing machine, translated from pro/stdwtitl F0x800869d0.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/title-sequence-tick-oracle.test.js runs the original through
// engine/native on the shipped overlay+resident with the seven child objects,
// the resident services and the frame delta recorded, and compares the ordered
// calls, the object fields and the return value.
//
// DECODED: authority-2 `_asm/F0x800869d0.s` and the accepted
// title-sequence-tick contract. A nine-state machine on +0x10 (state1; +0x0C
// belongs to the owner tick). The dispatch is an unsigned sltiu against 9, so
// state >= 9 (including negative) aliases case 0. Cases 2..5 gate on the
// +0x54 frame-delta accumulator and, on the firing tick, zero it, fire their
// child slot(s), advance1, and then re-add the delta; cases 1..5 therefore end
// a firing tick with +0x54 == delta. Case 6 reads the menu outcome word, stores
// it at +0x58 even when zero, and on a nonzero outcome advances, creates the
// full-screen fade into child 0, and requests the field stage only for Start.
// Case 8 delegates to the choice dispatcher and returns its value; every other
// case returns 0. The body draws nothing itself.
//
// The seven-child block (a1) is 7 pointers created by create_title_sequence:
// [0] fade, [1] numeral glow, [2] DIGIMON WORLD wordmark, [3] DIGIMON logo,
// [4] deco layer, [5] title menu, [6] circuit-board background.

import { TITLE_LANGUAGE_PTR } from "./title-draw.ts";

export interface TitleSequenceMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface TitleSequenceHost {
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** obj+0x2C (F0x80014288): set state1 and clear +0x14/+0x18. */
    setState1(obj: number, state: number): void;
    /** obj+0x3C (F0x800142C8): advance1 and clear +0x14/+0x18. */
    advance1(obj: number): void;
    /** An indirect method call: read the method pointer at `obj + slot` and call it, returning $v0. */
    callSlot(obj: number, slot: number): number;
    /** `[0x80055C48](id)`: the resident sound/resource service. */
    playSound(id: number): void;
    /** `[0x80044F44](id)`: the resident screen request (0x166 = the field stage). */
    requestScreen(id: number): void;
    /** F0x80086018(): create the full-screen fade object. */
    createScreenFade(): number;
    /** F0x80086834(self, childBlock): the menu choice dispatcher; returns its outcome. */
    titleChoiceDispatch(self: number, child: number): number;
}

export const TITLE_SEQUENCE = {
    state1: 0x10,
    setState1: 0x2c,
    advance1: 0x3c,
    accumulator: 0x54,
    outcome: 0x58,
} as const;

/** The seven-child block the owner passes as a1. */
export const TITLE_SEQUENCE_CHILD = {
    fade: 0x00,
    glow: 0x04,
    wordmark: 0x08,
    logo: 0x0c,
    deco: 0x10,
    menu: 0x14,
    background: 0x18,
} as const;

/** The method slots the tick calls on the children. */
export const TITLE_SEQUENCE_SLOT = {
    startFade: 0x58,
    startSlide: 0x70,
    startDeco: 0x78,
    startBackground: 0x94,
    startPrompt: 0x9c,
    menuChoice: 0xa4,
} as const;

/** Case 2 fires once the accumulator reaches 10. */
export const TITLE_SEQUENCE_GLOW_GATE = 10;
/** Cases 3..5 fire once the accumulator reaches 12. */
export const TITLE_SEQUENCE_STAGE_GATE = 12;
/** Case 2's sound/service argument. */
export const TITLE_SEQUENCE_SOUND_ID = 0x611c0000;
/** The field-stage id requested when the player picks Start. */
export const TITLE_SEQUENCE_FIELDSTG_ID = 0x166;
/** The menu outcome that means Start. */
export const TITLE_SEQUENCE_CHOICE_START = 1;

const s32 = (v: number): number => v | 0;

/** F0x800869d0(self, child): one title-sequence frame. Returns the case-8 outcome, else 0. */
export function titleSequenceTick(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    const state = mem.read32(self + TITLE_SEQUENCE.state1) >>> 0;
    if (state === 0 || state >= 9) return titleSequenceStart(mem, self, child, host);
    switch (state) {
        case 1: return titleSequenceCase1(mem, self, child, host);
        case 2: return titleSequenceCase2(mem, self, child, host);
        case 3: return titleSequenceCase3(mem, self, host);
        case 4: return titleSequenceCase4(mem, self, child, host);
        case 5: return titleSequenceCase5(mem, self, child, host);
        case 6: return titleSequenceCase6(mem, self, child, host);
        case 7: return titleSequenceCase7(mem, self, child, host);
        default: return titleSequenceCase8(mem, self, child, host); // state 8
    }
}

/** Cases 0 and >=9: slide in the logo and wordmark, then set state1 = 2. */
function titleSequenceStart(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    host.callSlot(mem.read32(child + TITLE_SEQUENCE_CHILD.logo) >>> 0, TITLE_SEQUENCE_SLOT.startSlide);
    host.callSlot(mem.read32(child + TITLE_SEQUENCE_CHILD.wordmark) >>> 0, TITLE_SEQUENCE_SLOT.startSlide);
    // The +0x54 store is the setState1 jalr delay slot: it lands before the call.
    mem.write32(self + TITLE_SEQUENCE.accumulator, 0);
    host.setState1(self, 2);
    return 0;
}

/** Case 1: one dead-tick guard, then the wordmark re-slide and advance1. */
function titleSequenceCase1(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    const old = s32(mem.read32(self + TITLE_SEQUENCE.accumulator));
    // old + 1 is stored in the bltz delay slot, so it lands even on the return.
    mem.write32(self + TITLE_SEQUENCE.accumulator, (old + 1) >>> 0);
    if (old < 0) return 0;
    mem.write32(self + TITLE_SEQUENCE.accumulator, 0);
    host.callSlot(mem.read32(child + TITLE_SEQUENCE_CHILD.wordmark) >>> 0, TITLE_SEQUENCE_SLOT.startSlide);
    host.advance1(self);
    return 0;
}

/** Case 2: at 10 frames, start the "3" glow. */
function titleSequenceCase2(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    if (s32(mem.read32(self + TITLE_SEQUENCE.accumulator)) < TITLE_SEQUENCE_GLOW_GATE) {
        titleSequenceAddDelta(mem, self, host);
        return 0;
    }
    mem.write32(self + TITLE_SEQUENCE.accumulator, 0);
    host.playSound(TITLE_SEQUENCE_SOUND_ID);
    host.callSlot(mem.read32(child + TITLE_SEQUENCE_CHILD.glow) >>> 0, TITLE_SEQUENCE_SLOT.startSlide);
    host.advance1(self);
    titleSequenceAddDelta(mem, self, host);
    return 0;
}

/** Case 3: at 12 frames, advance with no child call. */
function titleSequenceCase3(
    mem: TitleSequenceMemory, self: number, host: TitleSequenceHost,
): number {
    if (s32(mem.read32(self + TITLE_SEQUENCE.accumulator)) < TITLE_SEQUENCE_STAGE_GATE) {
        titleSequenceAddDelta(mem, self, host);
        return 0;
    }
    mem.write32(self + TITLE_SEQUENCE.accumulator, 0);
    host.advance1(self);
    titleSequenceAddDelta(mem, self, host);
    return 0;
}

/** Case 4: at 12 frames, start the deco layer. */
function titleSequenceCase4(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    if (s32(mem.read32(self + TITLE_SEQUENCE.accumulator)) < TITLE_SEQUENCE_STAGE_GATE) {
        titleSequenceAddDelta(mem, self, host);
        return 0;
    }
    mem.write32(self + TITLE_SEQUENCE.accumulator, 0);
    host.callSlot(mem.read32(child + TITLE_SEQUENCE_CHILD.deco) >>> 0, TITLE_SEQUENCE_SLOT.startDeco);
    host.advance1(self);
    titleSequenceAddDelta(mem, self, host);
    return 0;
}

/** Case 5: at 12 frames, show "Press Start Button" and switch on the sparkles. */
function titleSequenceCase5(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    if (s32(mem.read32(self + TITLE_SEQUENCE.accumulator)) < TITLE_SEQUENCE_STAGE_GATE) {
        titleSequenceAddDelta(mem, self, host);
        return 0;
    }
    mem.write32(self + TITLE_SEQUENCE.accumulator, 0);
    host.callSlot(mem.read32(child + TITLE_SEQUENCE_CHILD.menu) >>> 0, TITLE_SEQUENCE_SLOT.startPrompt);
    host.callSlot(mem.read32(child + TITLE_SEQUENCE_CHILD.background) >>> 0, TITLE_SEQUENCE_SLOT.startBackground);
    host.advance1(self);
    titleSequenceAddDelta(mem, self, host);
    return 0;
}

/** Case 6: read the menu choice; on a nonzero outcome create the fade and stage the request. */
function titleSequenceCase6(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    const outcome = s32(host.callSlot(
        mem.read32(child + TITLE_SEQUENCE_CHILD.menu) >>> 0, TITLE_SEQUENCE_SLOT.menuChoice,
    ));
    // The +0x58 store is the beqz delay slot: it lands even when the outcome is 0.
    mem.write32(self + TITLE_SEQUENCE.outcome, outcome >>> 0);
    if (outcome === 0) return 0;
    host.advance1(self);
    mem.write32(child + TITLE_SEQUENCE_CHILD.fade, host.createScreenFade() >>> 0);
    if ((mem.read32(self + TITLE_SEQUENCE.outcome) | 0) === TITLE_SEQUENCE_CHOICE_START) {
        host.requestScreen(TITLE_SEQUENCE_FIELDSTG_ID);
    }
    return 0;
}

/** Case 7: start the fade, then advance. */
function titleSequenceCase7(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    host.callSlot(mem.read32(child + TITLE_SEQUENCE_CHILD.fade) >>> 0, TITLE_SEQUENCE_SLOT.startFade);
    host.advance1(self);
    return 0;
}

/** Case 8: hand the choice to the dispatcher and return its value. */
function titleSequenceCase8(
    _mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceHost,
): number {
    return s32(host.titleChoiceDispatch(self, child));
}

/** The shared tail: +0x54 += frame delta. */
function titleSequenceAddDelta(
    mem: TitleSequenceMemory, self: number, host: TitleSequenceHost,
): void {
    const acc = s32(mem.read32(self + TITLE_SEQUENCE.accumulator));
    mem.write32(self + TITLE_SEQUENCE.accumulator, (acc + s32(host.frameDelta())) >>> 0);
}

// ---------------------------------------------------------------------------
// F0x80086C70 — the title sequence's owner/handler tick (pro/stdwtitl).
//
// DECODED: authority-2 `_asm/F0x80086c70.s` and the accepted family-C8 contract.
// Dispatch on +0x0C (owner state0), signed `slti 2`:
//   0 / negative / > 3  create the seven children (background first, then the
//                       language's logo, wordmark, glow and the shared deco,
//                       then the menu), advance0 and zero +0x54. The
//                       background store is the bnez delay slot, so it lands on
//                       both language arms.
//   1                   run the sequence tick (F0x800869D0); a nonzero return
//                       sets state0 = 3.
//   2                   nothing.
//   3                   `[0x80055C68](0x611C0000)`; no advance. 0x80055C68 is a
//                       DIFFERENT resident cell from the sequence tick's glow
//                       gate: F0x800202D4, the immediate stop-by-id entry
//                       (docs/research/audio/sound-system.md:1766), so the owner
//                       STOPS the title track (TITLEBGM) here rather than
//                       replaying it.
// The child block is the owner's 7-pointer extra buffer; the language global is
// mem32(0x8005CCA8) (0 = Japanese, nonzero = English).
export interface TitleSequenceOwnerHost {
    /** obj+0x38 (F0x800142AC): advance state0. */
    advance0(obj: number): void;
    /** obj+0x28 (F0x80014274): set state0 and clear deeper levels. */
    setState0(obj: number, state: number): void;
    /** F0x800867E0(0): the circuit-board background + twinkles. */
    createBackground(): number;
    /** F0x80085074(0): the Japanese logo. */
    createJpLogo(): number;
    /** F0x80084BE8(0): the Japanese wordmark. */
    createJpWordmark(): number;
    /** F0x80084218(0): the Japanese "3" glow. */
    createJpGlow(): number;
    /** F0x8008529C(0): the English logo. */
    createEnLogo(): number;
    /** F0x80084DF0(0): the English wordmark. */
    createEnWordmark(): number;
    /** F0x800844E8(0): the English "3" glow. */
    createEnGlow(): number;
    /** F0x800833E4(0): the decoration layer (shared by both languages). */
    createDeco(): number;
    /** F0x80085C68(0): the Start/Continue menu. */
    createMenu(): number;
    /** F0x800869D0(self, child): the sequence tick; returns its case-8 outcome. */
    sequenceTick(self: number, child: number): number;
    /** `[0x80055C68](id)`: the resident sound/service call. */
    playSound(id: number): void;
}

/** The owner's state0 field and its accumulator. */
export const TITLE_SEQUENCE_OWNER = { state0: 0x0c, accumulator: 0x54 } as const;
/** The service id both the owner (state 3) and the sequence tick (glow gate) call. */
export const TITLE_SEQUENCE_OWNER_SOUND_ID = 0x611c0000;

/** F0x80086C70(self, child): the title sequence owner's per-frame handler. */
export function titleSequenceOwnerTick(
    mem: TitleSequenceMemory, self: number, child: number, host: TitleSequenceOwnerHost,
): void {
    const state0 = s32(mem.read32(self + TITLE_SEQUENCE_OWNER.state0));
    if (state0 === 1) {
        if (s32(host.sequenceTick(self, child)) !== 0) host.setState0(self, 3);
        return;
    }
    if (state0 === 2) return;
    if (state0 === 3) {
        host.playSound(TITLE_SEQUENCE_OWNER_SOUND_ID);
        return;
    }
    // 0, negative and > 3 all build the sequence's seven children.
    host.advance0(self);
    mem.write32(child + TITLE_SEQUENCE_CHILD.background, host.createBackground() >>> 0);
    if (s32(mem.read32(TITLE_LANGUAGE_PTR)) === 0) {
        const logo = host.createJpLogo();
        const wordmark = host.createJpWordmark();
        const deco = host.createDeco();
        const glow = host.createJpGlow();
        mem.write32(child + TITLE_SEQUENCE_CHILD.logo, logo >>> 0);
        mem.write32(child + TITLE_SEQUENCE_CHILD.wordmark, wordmark >>> 0);
        mem.write32(child + TITLE_SEQUENCE_CHILD.deco, deco >>> 0);
        mem.write32(child + TITLE_SEQUENCE_CHILD.glow, glow >>> 0);
    } else {
        const logo = host.createEnLogo();
        const wordmark = host.createEnWordmark();
        const glow = host.createEnGlow();
        const deco = host.createDeco();
        mem.write32(child + TITLE_SEQUENCE_CHILD.logo, logo >>> 0);
        mem.write32(child + TITLE_SEQUENCE_CHILD.wordmark, wordmark >>> 0);
        mem.write32(child + TITLE_SEQUENCE_CHILD.glow, glow >>> 0);
        mem.write32(child + TITLE_SEQUENCE_CHILD.deco, deco >>> 0);
    }
    mem.write32(child + TITLE_SEQUENCE_CHILD.menu, host.createMenu() >>> 0);
    mem.write32(self + TITLE_SEQUENCE_OWNER.accumulator, 0);
}
