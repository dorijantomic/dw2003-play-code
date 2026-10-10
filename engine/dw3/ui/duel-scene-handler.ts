// The duel scene object's handler, translated from pro/cardgame:
//   F0x800A2F00 cardDuelSceneHandler — the 0x824-byte duel object's callback
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/duel-scene-handler-oracle.test.js runs the original through
// engine/native on the shipped pro_cardgame.bin + resident.bin.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s @.L0x00020250.
// The object's state word (+0xC) dispatches:
//   0 (and anything but 1..3) -> build the duel: gate on the audio-bank poll,
//       resolve the duel pack, arm the mode state, load the opponent deck,
//       create the view + the intro-voice object, set the view's two bytes,
//       install the card-view helper and upload the pack, create the outro
//       fade (white -> black over 0x64, no hold), advance the object to
//       state 2 and play the packed sound 0x609C0004.
//   1 -> run the tick (cardDuelTick port); when it reports finished, create the
//       reverse fade (black -> white, no hold), advance to state 2 and set
//       +0x303 = 1.
//   2 -> when the fade is idle, stop it and either restart the tick arm
//       (+0x303 == 0), mark +0x303 = 2, or record the duel outcome: the
//       save-block byte at [0x80048D34 + duel+0x2EC + 0x7C] increments (capped
//       at 99 while its signed read stays below) and [0x80048AC0] takes 1 when
//       +0x302 is clear, else 0. Then +0x303 = 2 and +0x10 = 1.
//   3 -> play the packed sound 0x609C0004 when +0x302 is set, else
//       0x6004001E.
//
// The five data pointers the original calls through, and what they hold in the
// shipped resident image:
//   [0x80055C60] = F0x8002043C  the audio-bank-loading poll   (loaderBusy)
//   [0x80044F4C] = F0x80013E5C  resourceGetBase(id)           (pack request)
//   [0x80044F5C] = F0x800140D8  the pack-handle resolver      (resolvePack)
//   [0x80055C48] = F0x8002006C  play a packed sound id       (playPackedSound)
//   [0x80055C68] = F0x800202D4  the packed voice command      (voiceCommand)
// Every other step reuses a port already in the engine: initDuelModeState,
// cardDuelTick, createCardBattleContext, cardViewHelperInit/SetPairA/UploadPack,
// createFadeWash/fadeWashSetColours/fadeWashStart/fadeWashIsIdle/fadeWashStop.

import {
    cardViewHelperInit,
    cardViewHelperSetPairA,
    cardViewHelperUploadPack,
    type PackUploadHost,
} from "./card-view.ts";
import { createCardBattleContext, type CardBattleHost } from "./card-battle-context.ts";
import {
    createFadeWash,
    fadeWashIsIdle,
    fadeWashSetColours,
    fadeWashStart,
    fadeWashStop,
    type FadeWashCreateHost,
} from "./fade-wash.ts";
import { initDuelModeState, type DuelModeMemory } from "./duel-mode-machine.ts";
import { cardDuelTick, type DuelTickHost } from "./duel-tick.ts";

export interface DuelSceneMemory extends DuelModeMemory {
    read16(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface DuelSceneHost extends DuelTickHost, FadeWashCreateHost, PackUploadHost, CardBattleHost {
    /** F0x8002043C(): non-zero while an audio bank is still loading. */
    loaderBusy(): number;
    /** F0x800140D8(handle): the request handle's pack base. */
    resolvePack(handle: number): number;
    /** F0x8009D6E0(duel, ctx): load the opponent's deck. */
    loadOpponentDeck(duel: number, ctx: number): void;
    /** F0x8009D6B4(): the intro voice-cue thunk's object. */
    createIntroVoice(): number;
    /** [view+0xECC](view): the view's own setup pass. */
    setupView(view: number): void;
    /** A caller-owned 0x34-byte buffer for the card-view helper (the original
     *  uses its own stack). */
    helperBuffer(): number;
    /** F0x8002006C(packed): play a packed sound id (state 0's tail). */
    playPackedSound(value: number): void;
    /** F0x800202D4(packed): the packed voice/program command (state 3). */
    voiceCommand(value: number): void;
    /** obj+0x28 (F0x80014274): the factory's set-state method. */
    setState(obj: number, state: number): void;
}

/** The scene handler's address and the state word it dispatches on. */
export const DUEL_SCENE_HANDLER_ENTRY = 0x800a2f00;
export const DUEL_SCENE_STATE = 0x0c;
/** The state the handler advances the object to in states 0 and 1. */
export const DUEL_SCENE_STATE_AFTER_SETUP = 2;
/** The createCardBattleContext parent offset (the object's own +0x50). */
export const DUEL_SCENE_VIEW_PARENT = 0x50;
/** The view bytes the setup copies from the duel. */
export const DUEL_SCENE_VIEW_BYTE_A = 0x5e;
export const DUEL_SCENE_VIEW_BYTE_B = 0x5c;
export const DUEL_SCENE_DUEL_BYTE_A = 0x2e9;
export const DUEL_SCENE_DUEL_BYTE_B = 0x2e8;
/** The duel pack request id and the handle the uploader walks. */
export const DUEL_PACK_ID = 0x25d;
export const DUEL_PACK_HANDLE = 0x025d0000;
/** The card-view helper's first VRAM destination pair. */
export const DUEL_HELPER_PAIR_X = 0x280;
/** The packet offsets on the scene/view context. */
export const DUEL_CTX_VIEW = 0x18;
export const DUEL_CTX_INTRO = 0x0;
export const DUEL_CTX_FADE = 0x4;
/** The outro fade's mode and ramp. */
export const DUEL_FADE_MODE = 2;
export const DUEL_FADE_FRAMES = 0x64;
/** The state-2 outcome fields. */
export const DUEL_OUTCOME_STATE = 0x303;
export const DUEL_OUTCOME_FLAG = 0x302;
export const DUEL_SCENE_DONE = 0x10;
export const DUEL_OUTCOME_INDEX = 0x2ec;
export const SAVE_BLOCK_BASE = 0x80048d34;
export const DUEL_OUTCOME_CELL = 0x7c;
export const DUEL_OUTCOME_CAP = 0x63;
export const DUEL_NO_DRAW_FLAG = 0x80048ac0;
/** The packed ids: state 0's tail plays 0x609C0004 through F0x8002006C, state
 *  3 plays 0x609C0004 or 0x6004001E through F0x800202D4. */
export const DUEL_SOUND_OUTRO = 0x609c0004;
export const DUEL_SOUND_REMATCH = 0x6004001e;

/**
 * F0x800A2F00(obj, ctx): the duel scene handler. `obj` is the 0x824-byte duel
 * object (its state word at +0xC) and `ctx` the screen object that carries the
 * view (+0x18), the intro object (+0x0) and the fade (+0x4).
 */
export function cardDuelSceneHandler(
    mem: DuelSceneMemory,
    host: DuelSceneHost,
    obj: number,
    ctx: number,
): void {
    const state = mem.read32(obj + DUEL_SCENE_STATE) | 0;
    if (state === 1) {
        sceneStateOne(mem, host, obj, ctx);
        return;
    }
    if (state === 2) {
        sceneStateTwo(mem, host, obj, ctx, state);
        return;
    }
    if (state === 3) {
        sceneStateThree(mem, host, obj);
        return;
    }
    sceneStateZero(mem, host, obj, ctx);
}

/** State 0: build the duel, arm the mode state and start the outro fade. */
function sceneStateZero(mem: DuelSceneMemory, host: DuelSceneHost, obj: number, ctx: number): void {
    if (host.loaderBusy() !== 0) return;
    host.resourceGetBase(DUEL_PACK_ID);
    initDuelModeState(mem, obj);
    host.loadOpponentDeck(obj, ctx);
    const view = createCardBattleContext(mem, obj + DUEL_SCENE_VIEW_PARENT, host);
    mem.write32(ctx + DUEL_CTX_VIEW, view);
    const intro = host.createIntroVoice();
    mem.write32(ctx + DUEL_CTX_INTRO, intro);
    host.setupView(view);
    const stored = mem.read32(ctx + DUEL_CTX_VIEW) | 0;
    mem.write16(stored + DUEL_SCENE_VIEW_BYTE_A, mem.read8(obj + DUEL_SCENE_DUEL_BYTE_A) & 0xffff);
    mem.write16(mem.read32(ctx + DUEL_CTX_VIEW) + DUEL_SCENE_VIEW_BYTE_B, mem.read8(obj + DUEL_SCENE_DUEL_BYTE_B) & 0xffff);

    const helper = host.helperBuffer() | 0;
    cardViewHelperInit(mem, helper);
    cardViewHelperSetPairA(mem, DUEL_HELPER_PAIR_X, 0);
    const pack = host.resolvePack(DUEL_PACK_HANDLE) | 0;
    cardViewHelperUploadPack(mem, host, pack);

    const fade = createFadeWash(mem, host, DUEL_FADE_MODE);
    mem.write32(ctx + DUEL_CTX_FADE, fade);
    fadeWashSetColours(mem, fade, 0xff, 0xff, 0xff);
    fadeWashStart(mem, fade, 0, 0, 0, DUEL_FADE_FRAMES, 0);
    host.setState(obj, DUEL_SCENE_STATE_AFTER_SETUP);
    host.playPackedSound(DUEL_SOUND_OUTRO);
}

/** State 1: tick the duel; when it finishes, start the reverse fade. */
function sceneStateOne(mem: DuelSceneMemory, host: DuelSceneHost, obj: number, ctx: number): void {
    if (cardDuelTick(mem, host, obj, ctx) === 0) return;
    const fade = createFadeWash(mem, host, DUEL_FADE_MODE);
    mem.write32(ctx + DUEL_CTX_FADE, fade);
    fadeWashSetColours(mem, fade, 0, 0, 0);
    fadeWashStart(mem, fade, 0xff, 0xff, 0xff, DUEL_FADE_FRAMES, 0);
    host.setState(obj, DUEL_SCENE_STATE_AFTER_SETUP);
    mem.write8(obj + DUEL_OUTCOME_STATE, 1);
}

/** State 2: wait for the fade, then record the outcome and finish. */
function sceneStateTwo(
    mem: DuelSceneMemory,
    host: DuelSceneHost,
    obj: number,
    _ctx: number,
    state: number,
): void {
    if ((mem.read32(obj + DUEL_SCENE_DONE) | 0) !== 0) return;
    const fade = mem.read32(_ctx + DUEL_CTX_FADE) | 0;
    if (fadeWashIsIdle(mem, fade) === 0) return;
    fadeWashStop(mem, fade);
    const marker = mem.read8(obj + DUEL_OUTCOME_STATE) & 0xff;
    if (marker === 0) {
        host.setState(obj, 1);
        mem.write32(obj + DUEL_SCENE_DONE, 1);
        return;
    }
    // the original compares the marker against the object's own state word
    // (s0, read at entry and 2 on this path), so only that value skips the
    // outcome recording
    if (marker !== (state & 0xff)) {
        if ((mem.read8(obj + DUEL_OUTCOME_FLAG) & 0xff) !== 0) {
            mem.write32(DUEL_NO_DRAW_FLAG, 0);
        } else {
            const cell = (SAVE_BLOCK_BASE + (mem.read32(obj + DUEL_OUTCOME_INDEX) | 0) + DUEL_OUTCOME_CELL) >>> 0;
            if (((mem.read8(cell) << 24) >> 24) < DUEL_OUTCOME_CAP) {
                mem.write8(cell, (mem.read8(cell) + 1) & 0xff);
            }
            mem.write32(DUEL_NO_DRAW_FLAG, 1);
        }
    }
    mem.write8(obj + DUEL_OUTCOME_STATE, DUEL_SCENE_STATE_AFTER_SETUP);
    mem.write32(obj + DUEL_SCENE_DONE, 1);
}

/** State 3: play the rematch/outro packed sound. */
function sceneStateThree(mem: DuelSceneMemory, host: DuelSceneHost, obj: number): void {
    const flag = mem.read8(obj + DUEL_OUTCOME_FLAG) & 0xff;
    host.voiceCommand(flag !== 0 ? DUEL_SOUND_OUTRO : DUEL_SOUND_REMATCH);
}
