// The title/boot screen's object creators and their installed one-line method
// slots, translated from pro/stdwtitl (authority-2 closures; contract from the
// accepted title-screen-executed-families answer).
//
// Each creator is the standard shape: F0x80014504(handler, size, extra) then
// stores of the child's draw target / method slots and the creator argument at
// +0x50. The installed methods are the 7 one-line slots in family D: five
// advance substate 1 when the owner is in state 0 == 1, the background's
// advances state 0 to 2, and the menu's +0xA4 returns the outcome word at +0x52.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/title-tasks-oracle.test.js runs each original creator/method
// through engine/native with the factory and the state setters stubbed.

export interface TitleTaskMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
    /** Only the menu creator stores its +0x50 argument as a halfword. */
    write16(addr: number, value: number): void;
}

export interface TitleTaskHost {
    /** F0x80014504(handler, size, extra) -> the new title object. */
    allocTitleTask(handler: number, size: number, extra: number): number;
}

export interface TitleMethodHost {
    /** obj+0x28 (F0x80014274): set state0. */
    setState0(obj: number, state: number): void;
    /** obj+0x2C (F0x80014288): set state1. */
    setState1(obj: number, state: number): void;
}

/** F0x80014504 literal arguments per creator. */
export const TITLE_CREATORS = {
    decoLayer: { handler: 0x800831e8, size: 0x7c, extra: 0 },
    glow: { handler: 0x800843a4, size: 0x74, extra: 0 },
    wordmark: { handler: 0x80084cd4, size: 0x74, extra: 0 },
    logo: { handler: 0x80085160, size: 0x74, extra: 0 },
    menu: { handler: 0x80085594, size: 0xa8, extra: 0 },
    background: { handler: 0x80086544, size: 0x98, extra: 0 },
    sequence: { handler: 0x80086c70, size: 0x13c, extra: 0x1c },
} as const;

/** F0x800833E4(screen): title decoration layer. */
export function titleDecoLayerCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    const obj = host.allocTitleTask(TITLE_CREATORS.decoLayer.handler, TITLE_CREATORS.decoLayer.size,
        TITLE_CREATORS.decoLayer.extra) >>> 0;
    mem.write32(obj + 0x78, 0x800833ac);
    mem.write32(obj + 0x68, 0x1000);
    mem.write32(obj + 0x6c, 2);
    mem.write32(obj + 0x50, screen >>> 0);
    return obj;
}

/** F0x800844E8(screen): the "3" glow. */
export function titleGlowCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    const obj = host.allocTitleTask(TITLE_CREATORS.glow.handler, TITLE_CREATORS.glow.size,
        TITLE_CREATORS.glow.extra) >>> 0;
    mem.write32(obj + 0x70, 0x800841e0);
    mem.write32(obj + 0x60, 0x1000);
    mem.write32(obj + 0x64, 2);
    mem.write32(obj + 0x50, screen >>> 0);
    return obj;
}

/** F0x80084DF0(screen): the DIGIMON WORLD wordmark. */
export function titleWordmarkCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    const obj = host.allocTitleTask(TITLE_CREATORS.wordmark.handler, TITLE_CREATORS.wordmark.size,
        TITLE_CREATORS.wordmark.extra) >>> 0;
    mem.write32(obj + 0x70, 0x80084bb0);
    mem.write32(obj + 0x60, 0x1000);
    mem.write32(obj + 0x64, 2);
    mem.write32(obj + 0x50, screen >>> 0);
    return obj;
}

/** F0x8008529C(screen): the DIGIMON logo. */
export function titleLogoCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    const obj = host.allocTitleTask(TITLE_CREATORS.logo.handler, TITLE_CREATORS.logo.size,
        TITLE_CREATORS.logo.extra) >>> 0;
    mem.write32(obj + 0x70, 0x8008503c);
    mem.write32(obj + 0x60, 0x1000);
    mem.write32(obj + 0x64, 2);
    mem.write32(obj + 0x50, screen >>> 0);
    return obj;
}

/** F0x80085C68(screen): the Start/Continue menu. */
export function titleMenuCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    const obj = host.allocTitleTask(TITLE_CREATORS.menu.handler, TITLE_CREATORS.menu.size,
        TITLE_CREATORS.menu.extra) >>> 0;
    mem.write32(obj + 0x9c, 0x80085be4);
    mem.write32(obj + 0xa0, 0x80085c1c);
    mem.write32(obj + 0xa4, 0x80085c5c);
    mem.write32(obj + 0x8c, 0x1000);
    mem.write32(obj + 0x90, 2);
    // The original stores this one argument with `sh` (s16 screen), unlike
    // every other creator's word store.
    mem.write16(obj + 0x50, screen & 0xffff);
    return obj;
}

/** F0x800867E0(screen): the circuit-board background + twinkles. */
export function titleBackgroundCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    const obj = host.allocTitleTask(TITLE_CREATORS.background.handler, TITLE_CREATORS.background.size,
        TITLE_CREATORS.background.extra) >>> 0;
    mem.write32(obj + 0x94, 0x800867a8);
    mem.write32(obj + 0x7c, 0x1000);
    mem.write32(obj + 0x80, 2);
    mem.write32(obj + 0x50, screen >>> 0);
    return obj;
}

/** F0x80086DB0(screen): the title sequence owner (7-child block via extra 0x1C). */
export function titleSequenceCreate(mem: TitleTaskMemory, screen: number, host: TitleTaskHost): number {
    const obj = host.allocTitleTask(TITLE_CREATORS.sequence.handler, TITLE_CREATORS.sequence.size,
        TITLE_CREATORS.sequence.extra) >>> 0;
    mem.write32(obj + 0x5c, 0x1000);
    mem.write32(obj + 0x60, 2);
    mem.write32(obj + 0x50, screen >>> 0);
    return obj;
}

const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** F0x800833AC: deco layer prompt (advance substate 1 when state0 == 1). */
export function titleDecoLayerPrompt(mem: TitleTaskMemory, obj: number, host: TitleMethodHost): void {
    if (s32(mem.read32(obj + 0x0c)) === 1) host.setState1(obj, 1);
}

/** F0x800841E0: glow prompt. */
export function titleGlowPrompt(mem: TitleTaskMemory, obj: number, host: TitleMethodHost): void {
    if (s32(mem.read32(obj + 0x0c)) === 1) host.setState1(obj, 1);
}

/** F0x80084BB0: wordmark prompt. */
export function titleWordmarkPrompt(mem: TitleTaskMemory, obj: number, host: TitleMethodHost): void {
    if (s32(mem.read32(obj + 0x0c)) === 1) host.setState1(obj, 1);
}

/** F0x8008503C: logo prompt. */
export function titleLogoPrompt(mem: TitleTaskMemory, obj: number, host: TitleMethodHost): void {
    if (s32(mem.read32(obj + 0x0c)) === 1) host.setState1(obj, 1);
}

/** F0x80085BE4: menu prompt lead-in. */
export function titleMenuPrompt(mem: TitleTaskMemory, obj: number, host: TitleMethodHost): void {
    if (s32(mem.read32(obj + 0x0c)) === 1) host.setState1(obj, 1);
}

/** F0x80085C5C: menu outcome word (+0x52). */
export function titleMenuOutcome(mem: TitleTaskMemory, obj: number): number {
    return s16(mem.read32(obj + 0x52));
}

/** F0x800867A8: background twinkle init (advance state0 to 2 when state0 == 1). */
export function titleBackgroundInit(mem: TitleTaskMemory, obj: number, host: TitleMethodHost): void {
    if (s32(mem.read32(obj + 0x0c)) === 1) host.setState0(obj, 2);
}
