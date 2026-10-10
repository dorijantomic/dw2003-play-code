// The corner stinger — the one-shot sprite the Kusanagi City street overlay
// (wstag780) builds for the announcement, effect-registry id 0x322.
//
// Ported from the original's per-stage native code, all inside wstag780 (loaded
// at 0x800a5de0):
//
//   * the registry record   {id 0x322, ctor 0x800a635c (file 0x57c), draw 0} —
//     the draw word is NULL, so the stage script's `SETANIM 802 803` only
//     CONSTRUCTS the object and the draw pointer is skipped
//     (fieldstg F0x800924c8 null-checks it, `docs/research/field/
//     stage-object-registry-2026-10-04.md` §"The thirteen records with no
//     constructor" for the mirror case).
//   * the tick              0x800a61c8 (file 0x3e8)
//   * the draw              0x800a6130 (file 0x350)
//
// The object identity is the tick passed to the allocator: F0x800143dc installs
// its first argument as the object's tick callback, so 0x800a61c8 IS the popup.
//
// WHAT THE PLAYER SEES. A figure steps into the top-left of the corner (map
// pixel 218, 71 — usually off-screen unless the player is up that end of the
// street), the corner pillar's screen then runs through five frames of news
// art, holds the last one for 140 blanks (about three seconds), runs back
// through four frames and vanishes. One sound on the way in.
//
// Decode with every asm line quoted:
// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
//
// Object layout, as the original's own code reads it:
//
//   +0x0c state   +0x10 sub1 (the phase)   +0x14 sub2 (the hold timer)
//   +0x50 the counter the drawn clip is `>> 2` of
//
// The state machine, from file 0x3f8:
//   state 0        +0x50 = 1, play a sound, advanceState. No draw.
//   state 1        by sub1:
//     sub1 == 0/3+ +0x50 += blank; below 0x1c -> draw; at 0x1c advanceSub1
//                   (so sub1 becomes 1) and hold +0x50 at 0x1c.
//     sub1 == 1    +0x14 += blank; below 0x8c -> draw; at 0x8c advanceSub1
//                   (sub1 becomes 2). +0x50 does not move, so the last clip
//                   stays on screen for the whole hold.
//     sub1 == 2    +0x50 -= blank; below 0xd -> draw; otherwise +0x50 = 0xc and
//                   setState(3).
//   states 2, 3    return without drawing; state >= 4 would re-arm forever.

/** The effect-registry id the stage script fires (`SETANIM 802 803`). */
export const STINGER_EFFECT_ID = 0x322;
/** The sub id the script pairs with it, kept because the record has no draw to
 *  receive it — fieldstg hands it to a null pointer and drops it. */
export const STINGER_SUB_ID = 0x323;
/** The map pixel the popup's draw passes (`li $a2, 0xda`, `li $a3, 0x47`). */
export const STINGER_X = 0xda;
export const STINGER_Y = 0x47;
/** The ordering-table bucket its draw sets (`li $a1, 0x7` at file 0x378). */
export const STINGER_LAYER = 7;
/** The counter the rising phase stops at (`slti $v1, 0x1c`, file 0x4b4). */
export const STINGER_RISE_LIMIT = 0x1c;
/** The counter the hold runs on (`slti $v1, 0x8c`, file 0x4fc). */
export const STINGER_HOLD_LIMIT = 0x8c;
/** The counter the falling phase stops at (`slti $v1, 0xd`, file 0x540). */
export const STINGER_FALL_LIMIT = 0xd;
/** The counter it latches on its way out (`li $v0, 0xc`, file 0x54c). */
export const STINGER_FALL_VALUE = 0xc;
/** The counter state 0 starts from (`li $v0, 1` in the state-0 arm, file 0x3fc). */
export const STINGER_RISE_START = 1;
/** The drawn clip is the counter shifted (`sra $a1, 0x2`, file 0x3d4). */
export const STINGER_CLIP_SHIFT = 2;

/** The packed sound state 0 plays when the master story ordinal is 0x27
 *  (`lui $a0, 0x80a4` + `ori $a0, 0x203c` is the WHOLE word, file 0x434-0x440).
 *  Bits 31 and 30 are set, so this is the positional voice path. */
export const STINGER_SOUND_ORDINAL_27 = 0x80a4203c;
/** The packed sound it plays at every other ordinal (`lui $a0, 0xa4` +
 *  `ori $a0, 0x4`, file 0x444-0x44c). */
export const STINGER_SOUND_DEFAULT = 0x00a40004;
/** The master ordinal that picks the other sound (`li $v0, 0x27`, file 0x428). */
export const STINGER_SOUND_ORDINAL = 0x27;

/** Which story events fire the popup: the overlay's own recovered scripts. */
export const STINGER_EVENT_IDS: readonly number[] = [0, 971, 1500];

export interface StingerPopup {
    state: number;
    /** The phase counter, +0x10. Only the overlay's own setSub1 moves it, and
     *  the record has no draw, so it only ever advances through the tick. */
    phase: number;
    /** The hold timer, +0x14. */
    hold: number;
    /** +0x50, the counter the drawn clip is `>> 2` of. */
    counter: number;
    /** The packed sound the state-0 arm asked for, for the caller to play. */
    sound: number | null;
    /** What the last blank drew — empty on every blank that draws nothing. */
    draws: StingerDraw[];
}

export interface StingerDraw {
    clip: number;
    x: number;
    y: number;
}

const runtime: Record<string, StingerPopup> = {};

/** The sound the state-0 arm picks for a master story ordinal. */
export function stingerSoundFor(ordinal: number): number {
    return ordinal === STINGER_SOUND_ORDINAL
        ? STINGER_SOUND_ORDINAL_27
        : STINGER_SOUND_DEFAULT;
}

function fresh(): StingerPopup {
    return { state: 0, phase: 0, hold: 0, counter: 0, sound: null, draws: [] };
}

/**
 * `SETANIM` on the popup. Returns true when the id belongs to it, which is the
 * original's "the registry consumed this id" answer; the registry's draw word
 * is null, so the sub id is accepted and dropped, exactly as fieldstg does.
 */
export function fireStingerPopup(stageId: string, effectId: number, ordinal = 0): boolean {
    if (effectId !== STINGER_EFFECT_ID) return false;
    const p = (runtime[stageId] ??= fresh());
    // The overlay is the only stage that carries this object, and the walker
    // asks per stage, so a second fire on a stage that already has one live is
    // the original's "the lookup found it" no-op.
    if (p.state !== 0) return true;
    p.sound = stingerSoundFor(ordinal);
    return true;
}

/**
 * One PAL blank of the popup. Returns what it draws this frame — the draw is
 * reached by every state-1 arm and by no other state, so an empty list means
 * "nothing on the canvas this blank".
 */
export function tickStingerPopup(stageId: string, delta = 1): StingerDraw[] {
    const p = runtime[stageId];
    if (!p) return [];
    if (p.state === 0) {
        p.counter = STINGER_RISE_START;
        p.state = 1;
        p.phase = 0;
        p.hold = 0;
        p.draws = [];
        return p.draws;
    }
    if (p.state !== 1) {
        p.draws = [];
        return p.draws;
    }
    if (p.phase === 1) {
        p.hold += delta;
        if (p.hold >= STINGER_HOLD_LIMIT) p.phase = 2; // advanceSub1
    } else if (p.phase === 2) {
        p.counter -= delta;
        if (p.counter < STINGER_FALL_LIMIT) {
            p.counter = STINGER_FALL_VALUE;
            p.state = 3; // setState(3) — dead, and it stays in the object list
        }
    } else {
        p.counter += delta;
        if (p.counter >= STINGER_RISE_LIMIT) {
            p.counter = STINGER_RISE_LIMIT;
            p.phase = 1; // advanceSub1, with the counter latched at the top
        }
    }
    p.draws = [{ clip: p.counter >> STINGER_CLIP_SHIFT, x: STINGER_X, y: STINGER_Y }];
    return p.draws;
}

/** What the popup drew on its last blank — the renderer reads it, because the
 *  popup is the only s780 object whose draw is not published per frame. */
export function stingerPopupDraws(stageId: string): readonly StingerDraw[] {
    return runtime[stageId]?.draws ?? [];
}

/** Everything the popup holds, for the tests and the browser verifier. */
export function stingerPopupState(stageId: string): StingerPopup | null {
    return runtime[stageId] ?? null;
}

/** True when this stage carries a popup object at all. */
export function hasStingerPopup(stageId: string): boolean {
    return STINGER_EFFECT_STAGES.has(stageId);
}

/** The stages whose overlay carries the popup — the extractor's census. */
export function stingerPopupStages(): string[] {
    return [...STINGER_EFFECT_STAGES].sort();
}

/** Drop the popup on a stage (or everywhere) — on a stage change. */
export function clearStingerPopup(stageId?: string): void {
    if (stageId === undefined) {
        for (const key of Object.keys(runtime)) delete runtime[key];
        return;
    }
    delete runtime[stageId];
}

const STINGER_EFFECT_STAGES: ReadonlySet<string> = new Set(["s780"]);
