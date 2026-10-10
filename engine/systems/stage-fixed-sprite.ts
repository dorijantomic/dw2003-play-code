/**
 * Fixed still sprites — the stage overlays' own two-layer decoration player.
 *
 * DECODE (original assembly, authority 2). Two registry records resolve, inside
 * their own stage overlay, to a builder that pins a resident state machine to
 * one map point and then runs two clip runs against the overlay's own tables:
 *
 *   member            builder      tick        position      base clip
 *   s310 id 852/0x354 F0x800a72cc  F0x800a70ac (620, 252)     20
 *   s311 id 838/0x346 F0x800a73e4  F0x800a70f8 (271, 411)     42
 *
 * Both builders are the same two instructions and the same allocator call
 * (`wstag310.s:1494-1508`, `wstag311.s:160c-1620`):
 *
 *   lui $a0, 0x800a / addiu $a0, 0x70ac      # the tick
 *   li $a1, 0x6c                             # a 108-byte object
 *   move_ $a2, $zr / jal F0x800143dc         # F0x800143dc(tick, size, 0, id)
 *
 * and then store the position, play the packed cue `0x0004001d` through the
 * resident player at `0x80055c48` and set the base clip
 * (`wstag310.s:1518-153c`; the cue's low half is in the `jalr`'s delay slot, so
 * the pair is `lui $a0, 0x4` + `ori $a0, 0x1d` -- a SOUND, not a resource id). s311's builder additionally calls
 * `obj->0x28(obj, 2)` — SET_STATE — so it starts already in its drawing state,
 * while s310's starts at 0 and takes the reset band on its first tick.
 *
 * WHAT THE PLAYER SEES. One decoration standing at that fixed point, its
 * palette cycling, plus a second sprite drawn 32 pixels higher for the length
 * of a one-shot burst. In A.o.A Headquarters that is the machinery on the wall
 * of both floors; the burst is the part that swings.
 *
 * THE STATE MACHINE (`state = obj+0xc`, the resident allocator's word; the
 * method table is EXE `F0x800143dc`, so `+0x28` SET_STATE, `+0x2c` SET_COUNTER_A
 * and `+0x38` ADV_STATE are the shared pieces):
 *
 *   state 0, or >= 4  ->  the reset band (`wstag310.s:1318-1358`): zero both
 *                        clip cursors, copy the pinned position out to
 *                        `obj+0x4` / `obj+0x8`, seed each cursor's hold timer
 *                        from its own run's entry 0, then ADV_STATE.
 *   the overlay's drawing states ->  the drawing band (`wstag310.s:135c-14d0`).
 *     s310 draws only in state 1; s311 draws in state 1 with the standing
 *     sprite alone (`wstag311.s:13b0-1414`) and in state 2 with both runs
 *     (`wstag311.s:1418-...`), which is where its builder leaves the object.
 *   any other state    ->  return.
 *
 * THE DRAWING BAND, one tick:
 *
 *   - if `obj+0x10` is clear, reseed both cursors and call SET_COUNTER_A(1);
 *   - `obj+0x64 = base clip` and `obj+0x66 = step(loop run, looping)` — both
 *     stores sit in the two `jal` delay slots, so they land before the calls
 *     return (`wstag310.s:13b0-13d8`);
 *   - `t = step(burst run, one-shot)`: `t == 255` clears `obj+0x68` and ends
 *     the object (SET_STATE(3)), `t == 300` (0x12c) clears `obj+0x68` without
 *     ending it, anything else stores `base + t` (`wstag310.s:13e0-141c`);
 *   - the front sprite is queued whenever `obj+0x64` is non-zero and the point
 *     is on screen; the burst sprite only while `obj+0x68` is non-zero, and
 *     its visibility box is the taller one 32px higher.
 *
 * THE DRAW CALLBACK (`wstag310.s:1118-11e4`) turns one queued job into a draw:
 * it reads the sprite pair at `obj+0x64 + extra*4`, opens a 320x256 window,
 * begins layer 6 for `extra == 0` and layer 4 for `extra == 1` (drawn 32px
 * higher), and submits `drawSprite(bank, pair[0], x, y)` after setting
 * `pair[1]` as the palette index. So `pair[0]` is the sprite and `pair[1]` is
 * its `ctr` byte — the walker's `point_sprites.json` already carries those as
 * the `sid@ctr` variants.
 *
 * TIMEBASE. `delta` is the display service's per-blank delta; the original
 * clamps its elapsed-tick provider to at most 4 per call, and so does this.
 * The walker calls the tick once per PAL blank through `paceStageObjects`, so
 * both runs advance as they do on the console at any monitor rate.
 */

/** One 4-byte clip record: `{s16 clip, u16 hold}`, as the overlay stores it. */
export interface FixedSpriteStep {
    clip: number;
    hold: number;
}

/** One family member, as `tools/extract_stage_fixed_sprites.py` reads it. */
export interface FixedSpriteMember {
    /** The registry id the overlay's builder registers (0x354 / 0x346). */
    id: number;
    /** Map x the builder pins, obj+0x54. */
    x: number;
    /** Map y the builder pins, obj+0x58. */
    y: number;
    /** The base sprite the burst offsets from, obj+0x50. */
    baseClip: number;
    /** 0 when the object starts on the reset band, 2 when SET_STATE(2). */
    startState: number;
    /** The state that runs BOTH clip runs (s310 1, s311 2). */
    fullState: number;
    /** Every state that queues a job; the others than `fullState` are reduced. */
    drawStates: number[];
    /** The palette run, stepped every tick and wrapping at clip 255. */
    loopSeq: FixedSpriteStep[];
    /** The one-shot burst run; clip 300 hides the sprite, 255 ends it. */
    burstSeq: FixedSpriteStep[];
    /** The packed cue the BUILDER plays, read out of the `jalr`'s delay slot. */
    buildSound?: string | null;
}

/** One live decoration. Every field is named for the offset it came from. */
export interface FixedSprite {
    id: number;
    /** obj+0xc. 0 reset band, 1 drawing, 2/3 finished. */
    state: number;
    /** obj+0x10, the counter SET_COUNTER_A raises. */
    counterA: number;
    /** obj+0x54 / obj+0x58, the pinned position. */
    x: number;
    y: number;
    /** obj+0x50, the base sprite. */
    baseClip: number;
    /** obj+0x5c / obj+0x5e, the burst cursor. */
    burstIndex: number;
    burstTimer: number;
    /** obj+0x60 / obj+0x62, the palette cursor. */
    loopIndex: number;
    loopTimer: number;
    /** obj+0x64, the standing sprite; always the base clip. */
    frontClip: number;
    /** obj+0x66, its palette index. */
    ctr: number;
    /** obj+0x68, the burst sprite: base + the burst run's clip. */
    burstClip: number;
    /** Set once the burst run has ended and the object stepped to state 3. */
    ended: boolean;
}

/** One queued layer job, already resolved into what the draw callback does. */
export interface FixedSpriteDraw {
    id: number;
    clip: number;
    ctr: number;
    x: number;
    y: number;
    /** The layer the job begins on: 6 in front, 4 behind. */
    layer: number;
    /** The key the render layer y-sorts the job on. */
    sortY: number;
}

/** The clip that ends a run: `li $v0, 0xff` in the overlay's own stepper. */
export const FIXED_SPRITE_END = 255;
/** The burst run's "hide the sprite" clip: `li $v0, 0x12c` in the tick. */
export const FIXED_SPRITE_BURST_HIDE = 300;
/** Layers the draw callback begins: `li $s0, 0x6` / `li $s0, 0x4`. */
export const FIXED_SPRITE_FRONT_LAYER = 6;
export const FIXED_SPRITE_BACK_LAYER = 4;
/** The burst sprite sits 32px higher: `addiu $s1, -0x20` in the callback. */
export const FIXED_SPRITE_BACK_Y = -0x20;
/** Its y-sort key is the standing y plus 0x12: `addiu $a3, 0x12`. */
export const FIXED_SPRITE_BACK_SORT = 0x12;
/**
 * The drawing window the callback declares: `li $a0, 0x140 / li $a1, 0x100`
 * (wstag310.s file 0x1174/0x1184), i.e. **320 x 256**.  The height is the
 * window, not the screen: the PS1 framebuffer's visible area is 320x240 and the
 * extra sixteen lines are the overscan rows the mode draws into.
 */
export const FIXED_SPRITE_CANVAS_W = 320;
export const FIXED_SPRITE_CANVAS_H = 256;
/** The visible screen, and so the box the camera box is measured against. */
export const FIXED_SPRITE_SCREEN_H = 240;

/** The cursor the stepper mutates. */
export interface FixedSpriteCursor {
    index: number;
    timer: number;
}

/**
 * The overlay's clip stepper, a port of `F0x800a6dd8`.
 *
 * `min(delta, 4)` comes off the hold timer at depth 0 only; the recursion
 * after the end marker is a tail loop, so it does not decrement twice. A
 * looping run wraps to entry 0 and adds entry 0's hold; a one-shot run returns
 * the end marker and leaves the cursor on it.
 */
export function stepFixedSpriteRun(
    cursor: FixedSpriteCursor,
    entries: FixedSpriteStep[],
    oneShot: boolean,
    delta: number,
    depth = 0,
): number {
    if (!entries.length) return FIXED_SPRITE_END;
    const step = delta < 5 ? delta : 4;
    if (depth === 0) cursor.timer -= step;
    if (cursor.timer > 0) return entries[cursor.index]?.clip ?? 0;
    const next = cursor.index + 1;
    if (next >= entries.length) return entries[entries.length - 1]!.clip;
    const entered = entries[next]!;
    cursor.index = next;
    cursor.timer += entered.hold;
    if (entered.clip === FIXED_SPRITE_END) {
        if (oneShot) return FIXED_SPRITE_END;
        cursor.index = 0;
        cursor.timer += entries[0]?.hold ?? 0;
    }
    return stepFixedSpriteRun(cursor, entries, oneShot, delta, depth + 1);
}

/**
 * The callback's visibility box, a port of `F0x800a6fe8`: the point's box must
 * reach the camera box on both axes.  Width is the declared window's 320; the
 * height is the VISIBLE screen's 240, because the camera box is what the player
 * sees and the window's extra sixteen lines are below it.
 */
export function fixedSpriteVisible(
    camX: number, camY: number, x: number, y: number, w: number, h: number,
): boolean {
    if (x + w < camX) return false;
    if (camX + FIXED_SPRITE_CANVAS_W < x) return false;
    if (y + h < camY) return false;
    return !(camY + FIXED_SPRITE_SCREEN_H < y);
}

/** The registry id -> member pairing, read out of the overlays' builders. */
export function fixedSpriteFor(
    members: FixedSpriteMember[] | undefined, id: number,
): FixedSpriteMember | null {
    for (const m of members ?? []) if (m.id === id) return m;
    return null;
}

/** Build one decoration in the state its overlay's builder leaves it in. */
export function createFixedSprite(member: FixedSpriteMember): FixedSprite {
    return {
        id: member.id,
        state: member.startState,
        counterA: 0,
        x: member.x,
        y: member.y,
        baseClip: member.baseClip,
        burstIndex: 0,
        burstTimer: 0,
        loopIndex: 0,
        loopTimer: 0,
        frontClip: 0,
        ctr: 0,
        burstClip: 0,
        ended: false,
    };
}

/**
 * One frame of the tick (`F0x800a70ac`). Returns the layer jobs it queued, in
 * the order the original queues them: the standing sprite first, the burst
 * above it second.
 */
export function tickFixedSprite(
    obj: FixedSprite,
    member: FixedSpriteMember,
    delta: number,
    camX = 0,
    camY = 0,
): FixedSpriteDraw[] {
    const jobs: FixedSpriteDraw[] = [];
    const draws = member.drawStates ?? [member.fullState ?? 1];
    if (draws.includes(obj.state)) {
        if (obj.state !== (member.fullState ?? 1)) {
            // The reduced band (s311 state 1, `wstag311.s:13b0-1414`): the
            // palette run and the standing sprite only, no burst.
            obj.frontClip = member.baseClip;
            const loop = { index: obj.loopIndex, timer: obj.loopTimer };
            obj.ctr = stepFixedSpriteRun(loop, member.loopSeq, false, delta);
            obj.loopIndex = loop.index;
            obj.loopTimer = loop.timer;
            if (obj.frontClip !== 0
                && fixedSpriteVisible(camX, camY, obj.x, obj.y, 0x20, 0x20)) {
                jobs.push({
                    id: obj.id, clip: obj.frontClip, ctr: obj.ctr, x: obj.x, y: obj.y,
                    layer: FIXED_SPRITE_FRONT_LAYER, sortY: obj.y,
                });
            }
            return jobs;
        }
        if (obj.counterA === 0) {
            obj.burstIndex = 0;
            obj.burstTimer = member.burstSeq[0]?.hold ?? 0;
            obj.loopIndex = 0;
            obj.loopTimer = member.loopSeq[0]?.hold ?? 0;
            obj.counterA = 1;
        }
        obj.frontClip = member.baseClip;
        const loop = { index: obj.loopIndex, timer: obj.loopTimer };
        obj.ctr = stepFixedSpriteRun(loop, member.loopSeq, false, delta);
        obj.loopIndex = loop.index;
        obj.loopTimer = loop.timer;

        const burst = { index: obj.burstIndex, timer: obj.burstTimer };
        const t = stepFixedSpriteRun(burst, member.burstSeq, true, delta);
        obj.burstIndex = burst.index;
        obj.burstTimer = burst.timer;
        if (t === FIXED_SPRITE_END) {
            obj.burstClip = 0;
            obj.ended = true;
        } else if (t === FIXED_SPRITE_BURST_HIDE) {
            obj.burstClip = 0;
        } else {
            obj.burstClip = member.baseClip + t;
        }
        if (obj.ended) obj.state = 3;

        if (obj.frontClip !== 0 && fixedSpriteVisible(camX, camY, obj.x, obj.y, 0x20, 0x20)) {
            jobs.push({
                id: obj.id, clip: obj.frontClip, ctr: obj.ctr, x: obj.x, y: obj.y,
                layer: FIXED_SPRITE_FRONT_LAYER, sortY: obj.y,
            });
        }
        if (obj.burstClip !== 0
            && fixedSpriteVisible(camX, camY, obj.x, obj.y + FIXED_SPRITE_BACK_Y, 0x20, 0x40)) {
            jobs.push({
                id: obj.id, clip: obj.burstClip, ctr: 0,
                x: obj.x, y: obj.y + FIXED_SPRITE_BACK_Y,
                layer: FIXED_SPRITE_BACK_LAYER, sortY: obj.y + FIXED_SPRITE_BACK_SORT,
            });
        }
        return jobs;
    }
    // States 2 and 3 are the original's parking states: it returns from them
    // without touching anything, and only state 0 and state >= 4 fall into the
    // reset band. Without that distinction a finished object would climb
    // forever and re-arm itself.
    if (obj.state !== 0 && obj.state < 4) return jobs;
    obj.burstIndex = 0;
    obj.loopIndex = 0;
    obj.burstTimer = member.burstSeq[0]?.hold ?? 0;
    obj.loopTimer = member.loopSeq[0]?.hold ?? 0;
    obj.counterA = 0;
    obj.state += 1;
    return jobs;
}

// ── the cue the builder plays ──────────────────────────────────────────────

let buildSoundSink: ((packed: number) => void) | null = null;

/**
 * Wire the packed-sound sink once (web/game.js does this through
 * `setStageObjectSound`).  Both members' builders play `0x0004001d` as they
 * build -- `lui $a0, 0x4` / `ori $a0, 0x1d`, the low half in the `jalr`'s delay
 * slot -- so it is the same resident player the field's rocks use, not a
 * separate resource load.
 */
export function setFixedSpriteBuildSound(fn: ((packed: number) => void) | null): void {
    buildSoundSink = fn;
}

/** Play `member.buildSound` if the builder has one, as the original does. */
export function playFixedSpriteBuildSound(member: FixedSpriteMember): void {
    const packed = member.buildSound;
    if (packed) buildSoundSink?.(Number(packed) >>> 0);
}
