// The title screen's vignette and the menu-choice hand-off, translated from
// pro/stdwtitl:
//   F0x80086018 create_screen_fade   — allocate the fade object
//   F0x80085F44 screen_fade_tick     — ramp the level and submit the quad
//   F0x80085F0C start_title_fade     — reset and start the ramp
//   F0x80085F38 title_fade_finished  — the finished flag
//   F0x80086834 title_choice_dispatch — act on Start / Continue / timeout
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/title-fade-oracle.test.js runs each original through
// engine/native on the shipped pro_stdwtitl.bin + resident.bin with the
// resident services and the quad submission recorded.
//
// DECODED: authority-2 `_asm/F0x80086018.s`, `F0x80085f44.s`,
// `_asm/F0x80086834.s`, `F0x80085f0c.c`, `F0x80085f38.c`, and the accepted
// title-sequence-owner-tick contract. The level curve is F0x80085CD4, already
// shipped as screen-dim.ts `titleVignetteLevel`; the quad builder F0x80085D64
// is modelled by screen-dim.ts's edge table and web/screendim.js compositing,
// so the tick submits through the host.

import { titleVignetteLevel } from "./screen-dim.ts";
import { TITLE_LANGUAGE_PTR } from "./title-draw.ts";

export interface TitleFadeMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
    read16(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface TitleFadeHost {
    /** F0x80014504(handler, size, extra) -> the new fade object. */
    allocate(handler: number, size: number, extra: number): number;
    /** obj+0x38 (F0x800142AC): advance state0. */
    advance0(obj: number): void;
    /** obj+0x2C (F0x80014288): set state1. */
    setState1(obj: number, state: number): void;
    /** F0x80085D64(level): submit the four-triangle vignette. */
    buildVignetteQuad(level: number): void;
}

export interface TitleChoiceHost {
    /** F0x80016A94: zero the save context and seed its selectors. */
    resetSaveContext(): void;
    /** F0x80016F0C: zero the save context's +0x48..+0x52. */
    clearContextFields(): void;
    /** F0x80013534: zero eight halfwords at 0x80042B74. */
    clearRegion(): void;
    /** F0x800148C0: apply the language to the save serial. */
    applyLanguage(): void;
    /** F0x80016B88(code, arg): write the transition register. */
    setSelector(code: number, arg: number): void;
    /** F0x80016B58(arg): the previous screen code. */
    previousScreenCode(arg: number): number;
}

export const TITLE_FADE = {
    state0: 0x0c,
    state1: 0x10,
    setState1: 0x2c,
    advance0: 0x38,
    handler: 0x48,
    result: 0x50,
    level: 0x54,
    counter: 0x56,
    startSlot: 0x58,
    finishedSlot: 0x5c,
} as const;

export const TITLE_FADE_HANDLER = 0x80085f44;
export const TITLE_FADE_START = 0x80085f0c;
export const TITLE_FADE_FINISHED = 0x80085f38;
export const TITLE_FADE_SIZE = 0x60;
/** Hand-over at counter 0x1E; the ramp is 30 ticks. */
export const TITLE_FADE_FRAMES = 0x1e;
/** The outcome word the sequence tick copies from the menu. */
export const TITLE_SEQUENCE_OUTCOME = 0x58;
export const TITLE_CHOICE_START = 1;
export const TITLE_CHOICE_CONTINUE = 2;
export const TITLE_CHOICE_TIMEOUT = 3;
export const TITLE_LAUNCH_START = 0x2d7;
export const TITLE_LAUNCH_CONTINUE = 0xc00;
export const TITLE_LAUNCH_MOVIE_A = 0xe01;
export const TITLE_LAUNCH_MOVIE_B = 0xe02;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** F0x80086018(): allocate the vignette object and install its two slots. */
export function createScreenFade(mem: TitleFadeMemory, host: TitleFadeHost): number {
    const obj = host.allocate(TITLE_FADE_HANDLER, TITLE_FADE_SIZE, 0) >>> 0;
    mem.write32(obj + TITLE_FADE.startSlot, TITLE_FADE_START);
    mem.write32(obj + TITLE_FADE.finishedSlot, TITLE_FADE_FINISHED);
    return obj;
}

/** F0x80085F0C(self): reset the finished flag and start the ramp. */
export function startTitleFade(mem: TitleFadeMemory, self: number, host: TitleFadeHost): void {
    // The +0x50 store is the setState1 jalr delay slot: it lands before the call.
    mem.write32(self + TITLE_FADE.result, 0);
    host.setState1(self, 1);
    mem.write16(self + TITLE_FADE.counter, 0);
}

/** F0x80085F38(self): the finished flag (+0x50). */
export function titleFadeFinished(mem: TitleFadeMemory, self: number): number {
    return mem.read32(self + TITLE_FADE.result) | 0;
}

/** F0x80085F44(self): ramp the vignette level and submit the quad. */
export function screenFadeTick(mem: TitleFadeMemory, self: number, host: TitleFadeHost): void {
    const state0 = s32(mem.read32(self + TITLE_FADE.state0));
    if (state0 === 1) {
        const state1 = s32(mem.read32(self + TITLE_FADE.state1));
        if (state1 === 1) {
            const old = mem.read16(self + TITLE_FADE.counter);
            // The counter store is the curve call's delay slot: it lands first.
            mem.write16(self + TITLE_FADE.counter, (old + 1) & 0xffff);
            const level = titleVignetteLevel(s16(old));
            // The level store is the branch delay slot: it lands on both arms.
            mem.write16(self + TITLE_FADE.level, level & 0xffff);
            if (s16(old + 1) >= TITLE_FADE_FRAMES) {
                host.setState1(self, 0);
                mem.write32(self + TITLE_FADE.result, state1 >>> 0);
            }
        }
        host.buildVignetteQuad(s16(mem.read16(self + TITLE_FADE.level)));
        return;
    }
    if (state0 === 2 || state0 === 3) return;
    // 0, negative and >= 4 all reset the ramp without submitting.
    host.advance0(self);
    mem.write16(self + TITLE_FADE.level, 0);
    mem.write16(self + TITLE_FADE.counter, 0);
    mem.write32(self + TITLE_FADE.result, 0);
}

/**
 * F0x80086834(self, child): once the fade has finished, act on the menu choice
 * the sequence tick copied to self+0x58. child is the seven-slot block; slot 0
 * is the fade object. Returns 1 when it dispatched, else 0.
 */
export function titleChoiceDispatch(
    mem: TitleFadeMemory, self: number, child: number, host: TitleChoiceHost,
): number {
    const fade = mem.read32(child) >>> 0;
    if (titleFadeFinished(mem, fade) === 0) return 0;
    const outcome = s32(mem.read32(self + TITLE_SEQUENCE_OUTCOME));
    if (outcome === TITLE_CHOICE_START) {
        host.resetSaveContext();
        host.clearContextFields();
        host.clearRegion();
        host.applyLanguage();
        host.setSelector(TITLE_LAUNCH_START, 0);
        return 1;
    }
    if (outcome === TITLE_CHOICE_CONTINUE) {
        host.resetSaveContext();
        host.clearRegion();
        host.applyLanguage();
        host.setSelector(TITLE_LAUNCH_CONTINUE, 0);
        return 1;
    }
    if (outcome === TITLE_CHOICE_TIMEOUT) {
        if (s32(mem.read32(TITLE_LANGUAGE_PTR)) !== 0) {
            host.setSelector(TITLE_LAUNCH_MOVIE_B, 0);
        } else {
            const previous = s32(host.previousScreenCode(TITLE_LAUNCH_MOVIE_B));
            host.setSelector(previous === TITLE_LAUNCH_MOVIE_A ? TITLE_LAUNCH_MOVIE_B : TITLE_LAUNCH_MOVIE_A, 0);
        }
        return 1;
    }
    return 0;
}
