// The Online Center wizard's screen root, translated from pro/stplnmet
// F0x800882A4 (create), F0x800882E0 (request banks), F0x80088398 (banks ready)
// and F0x80088138 (tick).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/wizard-root-oracle.test.js runs the original through
// engine/native with the standard-context slots, the pack/bank/audio services,
// the header builder, the sequence, the portrait and the state method stubbed
// and compares the fields and the ordered calls.
//
// DECODED: `exe-decomp/stplnmet_c/_asm/F0x800882a4.s` / `F0x800882e0.s` /
// `F0x80088398.s` / `F0x80088138.s` (authority 2) and the accepted
// wizard-screen-families answer Family H. The root is
// F0x80014504(handler 0x80088138, size 0x6C, extra 0x28) with +0x50 = 0x1001
// and +0x54 = 5. The tick waits on four text banks (lang+0x8D, lang+0x4E,
// lang+0x86 and the literal 0x771), then builds the column headers, sets
// +0x5C = 0xA and advances to state 2; state 1 runs the sequence and the
// portrait; state 2 waits on the audio archive then plays 0x60800000 and goes
// back to state 1; state 3 plays the exit sound and requests the transition.
//
// The animation families (A-D chrome, E headers, F sequence, G portrait) are
// separate ports; here they are boundaries.

export interface WizardRootMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface WizardRootHost {
    /** F0x80014504(handler, size, extra) -> the new root object. */
    allocWizardRoot(handler: number, size: number, extra: number): number;
}

/** The root's boundary services. */
export interface WizardRootTickHost extends WizardRootHost {
    /** F0x8001FFA8(ctx): install the standard context. */
    installStandardContext(): number;
    /** ctx+0x24/0x2C: run one standard-context slot. */
    contextCall(slot: number, a: number, b: number): void;
    /** (*0x80044B38+0x424)(handle) = F0x800140D8: pack handle -> directory. */
    packResolve(handle: number): number;
    /** (*0x80044B38+0x40C)(id) = F0x80013C30: request a text bank. */
    requestBank(id: number): void;
    /** (*0x80044B38+0x404)(id) = F0x80013A6C: nonzero while loading. */
    bankPending(id: number): number;
    /** (*0x80055C54)(id) = F0x80020574: request the sound archive. */
    ensureSoundArchiveLoaded(id: number): void;
    /** F0x80087B14(obj, arg1): build the column headers. */
    buildHeaders(obj: number, arg1: number): void;
    /** F0x80087C9C(obj, arg1): run the spawn sequence. */
    runSequence(obj: number, arg1: number): void;
    /** F0x80088070(obj): draw the portrait. */
    drawPortrait(obj: number): void;
    /** obj->0x28 (F0x80014274): set the phase. */
    setState(obj: number, phase: number): void;
    /** (*0x80055C60)(arg) = F0x8002043C: nonzero while audio is loading. */
    audioPending(arg: number): number;
    /** (*0x80055C48)(id) = F0x8002006C: play a packed sound. */
    playSound(id: number): void;
    /** (*0x80055C68)(id) = F0x800202D4: the exit sound. */
    playSoundExit(id: number): void;
    /** (*0x8004B440)(selector, arg) = F0x80016B88: request a transition. */
    requestTransition(selector: number, arg: number): void;
}

export const WIZARD_ROOT_HANDLER = 0x80088138;
export const WIZARD_ROOT_SIZE = 0x6c;
export const WIZARD_ROOT_EXTRA = 0x28;
export const WIZARD_ROOT_TARGET = 0x1001;
export const WIZARD_ROOT_LAYER = 5;
export const WIZARD_ROOT_PACK = 0x028b0000;
/** The three language-relative text banks plus the literal fourth. */
export const WIZARD_ROOT_BANK_OFFSETS: ReadonlyArray<number> = [0x8d, 0x4e, 0x86];
export const WIZARD_ROOT_BANK_LITERAL = 0x771;
export const WIZARD_ENTRY_SOUND = 0x60800000;
export const WIZARD_EXIT_TRANSITION = 0x2d8;

/** Root fields. */
export const WIZARD_ROOT = {
    state: 0x0c,
    substate: 0x10,
    method: 0x28,
    target: 0x50,
    layer: 0x54,
    fold: 0x5c,
} as const;

/** F0x800882A4(): build the wizard root object. */
export function wizardRootCreate(mem: WizardRootMemory, host: WizardRootHost): number {
    const obj = host.allocWizardRoot(WIZARD_ROOT_HANDLER, WIZARD_ROOT_SIZE, WIZARD_ROOT_EXTRA) >>> 0;
    mem.write32(obj + WIZARD_ROOT.target, WIZARD_ROOT_TARGET);
    mem.write32(obj + WIZARD_ROOT.layer, WIZARD_ROOT_LAYER);
    return obj;
}

/** F0x800882E0(): bind the wizard's text page and request the four banks. */
export function wizardRootRequestBanks(mem: WizardRootMemory, host: WizardRootTickHost): void {
    host.installStandardContext();
    host.contextCall(0x24, 0x280, 0x100);
    host.contextCall(0x2c, host.packResolve(WIZARD_ROOT_PACK) >>> 0, 0);
    const language = mem.read32(0x8005cca8) >>> 0;
    for (const off of WIZARD_ROOT_BANK_OFFSETS) host.requestBank((language + off) >>> 0);
    host.requestBank(WIZARD_ROOT_BANK_LITERAL);
}

/** F0x80088398(): 1 while any of the four text banks is still loading. */
export function wizardRootBanksReady(mem: WizardRootMemory, host: WizardRootTickHost): number {
    const language = mem.read32(0x8005cca8) >>> 0;
    for (const off of WIZARD_ROOT_BANK_OFFSETS) {
        if (host.bankPending((language + off) >>> 0) !== 0) return 1;
    }
    return host.bankPending(WIZARD_ROOT_BANK_LITERAL) !== 0 ? 1 : 0;
}

/** F0x80088138(obj, arg1): one wizard-root frame. */
export function wizardRootTick(
    mem: WizardRootMemory,
    obj: number,
    arg1: number,
    host: WizardRootTickHost,
): void {
    const state = mem.read32(obj + WIZARD_ROOT.state) | 0;

    if (state === 1) {
        host.runSequence(obj, arg1);
        host.drawPortrait(obj);
        return;
    }
    if (state === 2) {
        if (host.audioPending(1) !== 0) return;
        host.playSound(WIZARD_ENTRY_SOUND);
        host.setState(obj, 1);
        return;
    }
    if (state === 3) {
        host.playSoundExit(WIZARD_ENTRY_SOUND);
        host.requestTransition(WIZARD_EXIT_TRANSITION, 0);
        return;
    }

    // default: state 0 or >= 4
    const substate = mem.read32(obj + WIZARD_ROOT.substate) | 0;
    if (substate === 1) {
        if (wizardRootBanksReady(mem, host) !== 0) return;
        host.buildHeaders(obj, arg1);
        mem.write32(obj + WIZARD_ROOT.fold, 0x0a);
        host.setState(obj, 2);
        return;
    }
    wizardRootRequestBanks(mem, host);
    host.ensureSoundArchiveLoaded(0x20);
    mem.write32(obj + WIZARD_ROOT.substate, (substate + 1) >>> 0);
}
