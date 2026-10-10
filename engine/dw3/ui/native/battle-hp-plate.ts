// The in-battle HP plate's drain: the 8-frame poll that notices a live HP change
// and the 30-frame sine tween the bar and the HP number ride out, translated from
// the original pro/fightstg plate object.
//
//   FIGHTSTG_F0x80093108  the poll.  .L0x80093108-.L0x80093288
//   FIGHTSTG_F0x8009328c  the tween. .L0x8009328c-.L0x80093360
//
// The plate is one object whose mode-1 arm runs both, in that order, once per
// displayed frame, and then draws (FIGHTSTG_F0x80093a74, `.L0x80093c6c`-
// `.L0x80093c98`: the poll at :17488, the tween on the player's block at :17490,
// the tween on the enemy's block at :17492, the draw at :17495). `hpPlateTick` is
// that arm's mode 1 with the draw left out.
//
// THE SHAPE OF THE ORIGINAL'S STATE. The plate object is 0x88 bytes and the two
// sides live at +0x58 and +0x6C, 0x14 apart, each a seven-field block:
//
//   +0x00  start   the value the bar sat at when this tween began
//   +0x04  target  the live HP this tween is going to
//   +0x08  shown   the value the bar and the HP number both display
//   +0x0C  active  halfword, 1 while a tween is running
//   +0x0E  index   halfword, the member whose HP the block is caching
//   +0x10  frame   halfword, the tween's elapsed frames
//   +0x12  length  halfword, the tween's length in frames
//
// `+0x80` is the poll's accumulator and `+0x84` its interval. `HpPlateSide` is
// those seven fields and `HpPlateState` the accumulator and the interval.
//
// WHO FILLS THE NUMBERS. CONFIRMED — the draw takes BOTH the bar's fill and the
// HP number from the same word, `+0x08`: the number element's `+0x118` setter is
// handed `lw $a2, 0x60($t1)` (`fightstg.s:17068`) and the bar's length is
// `lw $a0, 0x60($s2)` (`:17112`, then `sll $v0, $a0, 0x7` and the divide by the
// record's `+0x06` at `:17116`). So the number counts down WITH the bar, on the
// same poll and the same tween; it is not a separate "real" HP readout. This was
// the open question in docs/research/battle/battle-hud-ownership-check-2026-10-03.md
// §6 step 3, and it is why `hpPlateShown` is the one value a painter needs.
//
// `start` (+0x00) is the tween's own base, read fresh every eased frame
// (`lw $v1, ($s0)` at fightstg.s:16884), which is why a second HP change abandons the
// old tween instead of bending it: the new tween overwrites the base.

import { rsin } from "../../rsin.ts";

/** `.L0x80093c54: li $v0, 0x8` — the poll's interval, written by the build arm. */
export const HP_PLATE_POLL_INTERVAL = 8;
/** `.L0x800931e8: li $t1, 0x1e` — the tween's length, 30 frames. */
export const HP_PLATE_TWEEN_FRAMES = 30;
/** `.L0x800931b8: slti $v0, $a3, 0x2` — two sides, the player's and the enemy's. */
export const HP_PLATE_SIDES = 2;
/** `.L0x80093c48` / `.L0x80093264`: `addiu $v1, 0x14` — the side block's stride. */
export const HP_PLATE_SIDE_STRIDE = 0x14;
/** `.L0x80093154` / `.L0x80093208`: `sll $v0, 0x5` — the member record's stride. */
export const HP_PLATE_RECORD_STRIDE = 0x20;
/** `.L0x80093c20` / `.L0x80093278`: `addiu ..., 0x60` — the second side's records. */
export const HP_PLATE_SIDE_RECORD_STRIDE = 0x60;

/** One side's live member: which member, and what its record says. */
export interface HpPlateMember {
    /** The side's active member index — `[0x800a4468]` and `[0x800a446c]`. */
    index: number;
    /** The record's `+0x08`, read with `lh`. */
    hp: number;
    /** The record's `+0x06`, read with `lh`. */
    maxHp: number;
}

/** One side's seven fields, in the original's order. */
export interface HpPlateSide {
    /** `+0x00` — where the bar sat when this tween began. */
    start: number;
    /** `+0x04` — the live HP this tween is going to. */
    target: number;
    /** `+0x08` — what the bar and the HP number show. */
    shown: number;
    /** `+0x0C` — 1 while a tween runs. */
    active: number;
    /** `+0x0E` — the member index this block is caching. */
    index: number;
    /** `+0x10` — the tween's elapsed frames. */
    frame: number;
    /** `+0x12` — the tween's length in frames. */
    length: number;
}

export interface HpPlateState {
    /** `+0x80` — the poll's accumulator, in published deltas. */
    acc: number;
    /** `+0x84` — the poll's interval. */
    interval: number;
    /** `[0x58]` and `[0x6c]`. */
    sides: HpPlateSide[];
}

/**
 * `.L0x800932f4-.L0x80093350`: the value this frame shows. The base is the block's
 * `+0x00` — `lw $v0, 0x4($s0)` and `lw $v1, ($s0)` (`:16885`/`:16886`) are the
 * target and the START, and the result is written to `+0x08` (`:16897`) — so the
 * curve is measured from where the tween began on every frame, not from the last
 * frame's value.
 *
 * `.L0x800932f4-.L0x800932fc`: `div $zr, $a0, $a1` for the angle, `jal F0x8002abcc`
 * for the sine; `.L0x8009330c-.L0x80093328`: `mult $v0, $a1` + `mflo` + `bgez` /
 * `addiu $a0, 0xfff` + `sra $a0, 0xc` for the rounding-toward-zero shift by
 * twelve; `.L0x8009332c-.L0x8009334c`: the multiply by (target - start), the signed
 * divide by the length and the add.
 */
function hpPlateEaseStep(start: number, target: number, frame: number, length: number): number {
    const angle = Math.trunc((frame << 10) / length);
    let step = rsin(angle) * length;
    if (step < 0) step += 0xfff;
    step = step >> 12;
    return start + Math.trunc(Math.imul(target - start, step) / length);
}

/**
 * `.L0x8009328c`, the tween, on one side's block. `delta` is
 * `[0x8004DF9C]()` — the word the display service published for this frame
 * (`F0x8001D704` returns `[0x8004DE28]`), which is 1 on most frames and 2 on the
 * frame that crosses the 256 boundary on PAL, so the tween's frame counter is
 * advanced by a count and not by a frame index.
 */
export function hpPlateTween(side: HpPlateSide, delta: number): void {
    if (side.active === 0) return;                                  // :16850-:16852
    side.frame = (side.frame + delta) & 0xffff;                     // :16858-:16861
    const frame = (side.frame << 16) >> 16;                         // :16862-:16863
    const length = side.length;
    if (frame >= length) {                                          // :16865
        side.active = 0;                                            // :16868
        side.start = side.target;                                   // :16871 (delay slot)
        side.shown = side.target;                                   // :16869
        return;
    }
    side.shown = hpPlateEaseStep(side.start, side.target, frame, length);
}

/**
 * `.L0x80093108`, the poll, on one side's block. `hp` is the record's `+0x08`
 * read raw; the clamp is the poll's own (`.L0x80093218-.L0x80093238`), and it is
 * only on this path — the member-change snap below stores the record's HP
 * unclamped.
 */
function hpPlatePollSide(side: HpPlateSide, hp: number, maxHp: number): void {
    let live = hp | 0;                                              // :16813
    if (live <= 0) live = 0;                                        // :16814-:16816
    const max = maxHp | 0;                                          // :16817
    if (max < live) live = max;                                     // :16819-:16822
    if (live === side.target) return;                               // :16823-:16825
    side.start = side.shown;                                        // :16827/:16832
    side.target = live;                                             // :16828
    side.active = 1;                                                // :16829
    side.frame = 0;                                                 // :16830
    side.length = HP_PLATE_TWEEN_FRAMES;                            // :16831
}

/**
 * The plate object's BUILD arm, `.L0x80093bd0-.L0x80093c60`: both sides snap to
 * their member's live HP with no tween and no length, each caches its member
 * index, the accumulator is zeroed and the interval is eight.
 */
export function createHpPlateState(members: readonly HpPlateMember[]): HpPlateState {
    return {
        acc: 0,                                                     // :17482
        interval: HP_PLATE_POLL_INTERVAL,                           // :17481/:17484
        sides: members.map((m) => {
            const hp = m.hp | 0;
            return {
                start: hp,                                          // :17455
                target: hp,                                         // :17462
                shown: hp,                                          // :17470
                active: 0,                                          // :17469
                index: m.index | 0,                                 // :17475
                frame: 0,                                           // :17473
                length: 0,                                          // :17474
            };
        }),
    };
}

/**
 * The plate's mode-1 arm with the draw left out: the poll, then one tween per
 * side, in the original's order. `delta` is this displayed frame's published
 * delta (`[0x8004DF9C]()`), and this is called once per displayed frame — the
 * original's arm is the object's own tick, which the exe's per-object step
 * `F0x80018140` runs once a frame.
 *
 * The order matters in two places. The member-change snap runs BEFORE the
 * accumulator test, so a Digimon taking the field snaps its bar on the frame the
 * member index changes and not on the next poll. And the tween runs in the same
 * frame the poll started it, so the bar has already moved one frame by the time
 * it is drawn.
 */
export function hpPlateTick(
    state: HpPlateState, members: readonly HpPlateMember[], delta: number,
): void {
    const step = delta | 0;
    state.acc = (state.acc + step) | 0;                             // :16757-:16760
    for (let i = 0; i < HP_PLATE_SIDES; i++) {                      // :16761-:16788
        const side = state.sides[i];
        const member = members[i];
        if (!side || !member) continue;
        const index = member.index | 0;
        if (side.index === index) continue;                         // :16764
        const hp = member.hp | 0;                                   // :16767, read raw
        side.start = hp;                                            // :16769
        side.target = hp;                                           // :16776
        side.shown = hp;                                            // :16783
        side.active = 0;                                            // :16782
        side.index = index;                                         // :16786
    }
    if (state.interval < state.acc) {                               // :16796
        state.acc = (state.acc - state.interval) | 0;               // :16798/:16799
        for (let i = 0; i < HP_PLATE_SIDES; i++) {                  // :16800-:16833
            const side = state.sides[i];
            const member = members[i];
            if (!side || !member) continue;
            hpPlatePollSide(side, member.hp, member.maxHp);
        }
    }
    for (let i = 0; i < HP_PLATE_SIDES; i++) {                      // :17490/:17492
        const side = state.sides[i];
        if (side) hpPlateTween(side, step);
    }
}

/** What the plate shows for one side: the block's `+0x08`, which both the bar and the number read. */
export function hpPlateShown(state: HpPlateState, side: number): number {
    return state.sides[side]?.shown ?? 0;
}