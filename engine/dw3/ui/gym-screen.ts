// The training gym screen's constructor, translated from pro/stgtrain
// F0x80085DD8.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/gym-screen-oracle.test.js runs the original through
// engine/native with the object factory and the map-id getter stubbed and
// compares the object fields and the factory arguments.
//
// DECODED: exe-decomp/stgtrain_c/F0x80085dd8.c and its raw body in _asm/ plus
// the accepted gym-flow-tick answer UNIT 1: the screen is the universal
// 0x114-byte object built by F0x80014504(handler, 0x114, 0x80); +0x110 is the
// draw routine F0x80084370, +0x50 = 0x1000, +0x54 = 6, and +0x58 is a
// per-map constant selected from the current map id (the gym's scene id) with
// 0x2D as the default.

export interface GymScreenMemory {
    write32(addr: number, value: number): void;
}

export interface GymScreenHost {
    /** F0x80014504(handler, size, extra) -> the new screen object. */
    allocScreen(handler: number, size: number, extra: number): number;
    /** (*[0x8004B448])() -> the current map/scene id. */
    currentMapId(): number;
}

/** The screen handler installed at +0x48. */
export const GYM_SCREEN_HANDLER = 0x80085bb0;
/** The draw routine installed at +0x110. */
export const GYM_SCREEN_DRAW = 0x80084370;
/** Map id -> the per-map +0x58 constant; anything else is 0x2D. */
export const GYM_SCENE_CONSTANTS: ReadonlyMap<number, number> = new Map([
    [0x23d, 0x2e],
    [0x24b, 0x2f],
    [0x267, 0x30],
    [0x28c, 0x31],
    [0x2aa, 0x32],
    [0x2b5, 0x33],
    [0x2cf, 0x34],
]);
export const GYM_SCENE_DEFAULT = 0x2d;

/** F0x80085DD8(): build and return the gym screen object. */
export function gymScreenConstruct(mem: GymScreenMemory, host: GymScreenHost): number {
    const obj = host.allocScreen(GYM_SCREEN_HANDLER, 0x114, 0x80) >>> 0;
    mem.write32(obj + 0x110, GYM_SCREEN_DRAW);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 6);
    const id = host.currentMapId() | 0;
    mem.write32(obj + 0x58, (GYM_SCENE_CONSTANTS.get(id) ?? GYM_SCENE_DEFAULT) >>> 0);
    return obj;
}

// ── the screen tick ─────────────────────────────────────────────────────────
//
// F0x80085BB0, translated from the same overlay. Oracle:
// tests/gym-screen-tick-oracle.test.js.
//
// DECODED: exe-decomp/stgtrain_c/_asm/F0x80085bb0.s (authority 2, 281 lines)
// and the accepted gym-partner-draw answer UNIT 4. The tick dispatches on
// screen+0x0C:
//   1 -> gymFlowTick(screen, hud) then gymPartnerDraw(screen)
//   2 -> while the audio archive is still loading, return; else play
//        0x60840002 and set phase 1
//   3 -> play the exit sound 0x60840002, then request a screen transition with
//        the pending selector
//   otherwise (0 or >= 4) the +0x10 sub-machine:
//     sub != 1 -> background plate, request the text bank
//       [0x8005CCA8]+0x10B, request sound archive 0x21, sub += 1
//     sub == 1 -> while the text bank is still loading, return; else advance
//       the phase, build the HUD widgets, count the occupied party slots into
//       screen+0x64, seed the fold durations (+0xA0/+0xB0/+0xC0 = 0xA,
//       +0xD0/+0xE0/+0x100 = 0xA, +0xF0 = 8) and set phase 2
//
// callee boundaries (the answer's UNIT 5 table): F0x8008517C and F0x80084838
// are translated separately and bridged by the host; the rest are resident
// services, exactly as in gym-flow.

export interface GymScreenTickMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The tick's boundary services. */
export interface GymScreenTickHost {
    /** F0x8008B8A4: the gym scene's background plate (argument ignored). */
    backgroundPlate(): void;
    /** (*0x80044F44)(id) = F0x80013C30: touch/request a text bank load. */
    requestTextBank(id: number): void;
    /** (*0x80055C54)(0x21) = F0x80020574: request the sound archive. */
    requestSoundArchive(id: number): void;
    /** (*0x80044F3C)(id) = F0x80013A6C: nonzero while the bank is still loading. */
    textBankPending(id: number): number;
    /** F0x800142AC (screen->0x38): advance the object phase. */
    advancePhase(screen: number): void;
    /** F0x80083AEC(screen, hud): build the translated HUD widgets. */
    gymHudConstruct(screen: number, hud: number): void;
    /** (*0x8004B44C)(position) = F0x80016D94: roster slot, -1 when empty. */
    rosterSlot(position: number): number;
    /** (*0x80055C60)(1) = F0x8002043C: nonzero while audio is still loading. */
    audioPending(arg: number): number;
    /** (*0x80055C48)(id) = F0x8002006C: play a packed sound. */
    playSound(id: number): void;
    /** F0x80014274 (screen->0x28): set the object phase. */
    setPhase(screen: number, phase: number): void;
    /** (*0x80055C68)(id) = F0x800202D4: the exit sound. */
    playSoundPhaseExit(id: number): void;
    /** *(0x80048D34+0x34): the pending screen-transition selector. */
    transitionSelector(): number;
    /** (*0x80048D34+0x270C)(selector, 0) = F0x80016B88: request a transition. */
    requestScreenTransition(selector: number, arg: number): void;
    /** *(0x8005CCA8): the language index used for the bank id. */
    languageIndex(): number;
    /** F0x8008517C(screen, hud): the translated flow machine. */
    flowTick(screen: number, hud: number): void;
    /** F0x80084838(screen): the translated partner draw. */
    partnerDraw(screen: number): void;
}

export const GYM_TICK_STATE = 0x0c;
export const GYM_TICK_SUBSTATE = 0x10;
export const GYM_TICK_POD_COUNT = 0x64;
export const GYM_TICK_TEXT_BANK_OFFSET = 0x10b;
export const GYM_TICK_SOUND_ARCHIVE = 0x21;
/** The three folds opened by the HUD build (written 0xA; asm order C0,B0,A0). */
export const GYM_TICK_OPEN_FOLDS: ReadonlyArray<number> = [0xc0, 0xb0, 0xa0];
/** The three folds seeded for the close chain. */
export const GYM_TICK_CLOSE_FOLDS: ReadonlyArray<number> = [0xd0, 0xe0, 0x100];
export const GYM_TICK_FOLD_DURATION = 0x0a;
/** The closing panel fold and its duration. */
export const GYM_TICK_PANEL_FOLD = 0xf0;
export const GYM_TICK_PANEL_DURATION = 8;
export const GYM_TICK_SOUND = 0x60840002;
/** The three party positions the pod count probes. */
export const GYM_TICK_POD_SLOTS = 3;

const tick32 = (v: number): number => v | 0;

/** F0x80085BB0(screen, hud): one gym screen frame. */
export function gymScreenTick(
    mem: GymScreenTickMemory,
    screen: number,
    hud: number,
    host: GymScreenTickHost,
): void {
    const state = tick32(mem.read32(screen + GYM_TICK_STATE));

    if (state === 1) {
        host.flowTick(screen, hud);
        host.partnerDraw(screen);
        return;
    }
    if (state === 2) {
        if (tick32(host.audioPending(1)) !== 0) return;
        host.playSound(GYM_TICK_SOUND);
        host.setPhase(screen, 1);
        return;
    }
    if (state === 3) {
        host.playSoundPhaseExit(GYM_TICK_SOUND);
        host.requestScreenTransition(host.transitionSelector() >>> 0, 0);
        return;
    }

    // default band: state 0 or >= 4
    const sub = tick32(mem.read32(screen + GYM_TICK_SUBSTATE));
    if (sub !== 1) {
        host.backgroundPlate();
        const bank = (host.languageIndex() + GYM_TICK_TEXT_BANK_OFFSET) >>> 0;
        host.requestTextBank(bank);
        host.requestSoundArchive(GYM_TICK_SOUND_ARCHIVE);
        mem.write32(screen + GYM_TICK_SUBSTATE, (sub + 1) >>> 0);
        return;
    }

    const bank = (host.languageIndex() + GYM_TICK_TEXT_BANK_OFFSET) >>> 0;
    if (tick32(host.textBankPending(bank)) !== 0) return;

    host.advancePhase(screen);
    host.gymHudConstruct(screen, hud);
    let podCount = tick32(mem.read32(screen + GYM_TICK_POD_COUNT));
    for (let i = 0; i < GYM_TICK_POD_SLOTS; i++) {
        if (tick32(host.rosterSlot(i)) !== -1) {
            podCount += 1;
            mem.write32(screen + GYM_TICK_POD_COUNT, podCount >>> 0);
        }
    }
    for (const off of GYM_TICK_OPEN_FOLDS) mem.write32(screen + off, GYM_TICK_FOLD_DURATION);
    for (const off of GYM_TICK_CLOSE_FOLDS) mem.write32(screen + off, GYM_TICK_FOLD_DURATION);
    mem.write32(screen + GYM_TICK_PANEL_FOLD, GYM_TICK_PANEL_DURATION);
    host.setPhase(screen, 2);
}
