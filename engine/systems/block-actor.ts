/**
 * THE special block actors (npc 328/351/352) and the interaction they carry.
 *
 * One module for all three, because the original has ONE branch and ONE pair
 * of mode bodies for them — read end to end from fieldstg.s on 2026-10-05 and
 * re-mined by `tools/extract_block_actors.py` (web/assets/data/block_actors.json).
 *
 * ── the actors ─────────────────────────────────────────────────────────────
 *
 * The three are ordinary class-5 cast records in the stage's own list
 * (descriptor+0x4C, engine/systems/cast-list.ts loop B), gated on a route-pair
 * flag plus their own bank-0 completion bit, and all three resolve to the
 * p188blok pack.  `blockActorRecords` selects them out of a stage's cast list;
 * 152 records over the 14 Circuit/endgame screens.
 *
 * ── the engage branch (fieldstg F0x8008E2CC, file 0xb61c-0xb7a8) ───────────
 *
 * The player's confirm path (file 0xb834-0xb860, behind the Submarimon depth
 * gate) probes for the target and calls the branch with the player as the
 * engager.  The branch tests the target's npc_id:
 *
 *     .L0x0000b6b4: lw  $v1, 0x4($s0)      # target npc_id
 *     .L0x0000b6bc: beq $v1, 0x148, .L0x0000b6dc
 *     .L0x0000b6c8: slti $v0, $v1, 0x161   # and [0x15f, 0x161)
 *
 * and for those ids, unless the target is ALREADY in state 0x4e:
 *
 *     .L0x0000b6dc: lw  $v1, 0x10($s0)     # target +0x10 == 0x4e -> refuse
 *     .L0x0000b6f0: lw  $v0, 0x2c($s0)     # target.setState(0x4e)
 *     .L0x0000b704: sw  $s1, 0x88($s0)     # target+0x88 = the engager
 *     .L0x0000b708: lw  $v0, 0x2c($s1)     # engager.setState(0x4d)
 *     .L0x0000b71c: sw  $zr, 0x108($s1)    # engager+0x108 = 0
 *
 * ── the engager's body (state 0x4d, file 0xe020-0xe0a0) ────────────────────
 *
 * First blank: `setClip(0x45)` through F0x8008F4B4 (which also clears the
 * clip's frame index, timer and complete flag), the field lock
 * `[0x80099de0] = 1` (file 0xe048), obj+0x108 = 0, then advanceCounter.  Every
 * later blank tests obj+0xe8 (the clip-complete flag) and, when set:
 *
 *     .L0x0000e074: setState(1)            # back to idle
 *     .L0x0000e088: setClip(1)
 *     .L0x0000e090: jal 0x8008fd60         # restore the default +0x108 callback
 *     .L0x0000e0a0: sw $zr, [0x80099de0]   # the field lock clears
 *
 * The clip is p123digm's 0x45: six frames, durations 10+7+2+2+10+5 = 36 ticks
 * on every facing (tools/extract_block_actors.py reads it off the pack).
 *
 * ── the target's body (state 0x4e, file 0xe0a4-0xe19c) ─────────────────────
 *
 * Sub-state 0 waits: obj+0x18 += the frame delta until `slti $v0, 0x14` fails
 * (20 ticks, file 0xe0bc-0xe0f0).  Then the action arm, once:
 *
 *     .L0x0000e0f8: setClip(0x54)          # p188blok's break-apart
 *     .L0x0000e110: jalr [0x80055c48]      # the cue request
 *     .L0x0000e114: ori $a0, 0x46c9        # packed 0x800446C9 (COMEX113)
 *     .L0x0000e118-.L0x0000e168:            # npc_id -> completion bit
 *        0x148 -> 8, 0x15f -> 9, 0x160 -> 0xa, then the bit write with 1
 *     .L0x0000e16c: advanceCounter
 *
 * Sub-state 1 waits for obj+0xe8 and then calls its own `+0x28` with 3
 * (file 0xe188-0xe198) — the field character's remove state.  The clip is
 * p188blok's 0x54: five frames, 5+4+4+4+4 = 21 ticks.
 *
 * ── the timing, and where each number comes from ───────────────────────────
 *
 * The ledger claim `world-q006-block-interaction-mechanism-and-timing-2026-10-05`
 * derives, from those frame tables, 36 ticks to control back and 41 ticks
 * total (the live capture agrees: the block starts breaking about 20 blanks
 * in, control returns about 36, the block is gone about 41).  This port counts
 * the confirm tick as tick 0 and reproduces exactly those totals: the block
 * acts on tick 20, the player's clip ends on tick 36, the block is gone on
 * tick 41.  The one tick boundary the evidence cannot settle is whether a
 * clip's own first frame is consumed by its latch tick; the accounting here
 * (the engager's latch tick counts as frame 1, the target's action tick does
 * not) is what reproduces the claim's 36/41, and is called out rather than
 * hidden.
 */

import {
    castActorRecords,
    type CastFlagMatch,
    type CastRecord,
} from "./cast-list.ts";

/** The three block actors, by npc id (not stage-object-registry id). */
export const BLOCK_ACTOR_IDS = [328, 351, 352] as const;

/** The engager's mode while the interaction plays (obj+0x10 = 0x4d). */
export const BLOCK_ENGAGER_STATE = 0x4d;
/** The target's mode while the interaction plays (obj+0x10 = 0x4e). */
export const BLOCK_TARGET_STATE = 0x4e;
/** The engager's clip: p123digm's drill dive, 36 ticks. */
export const BLOCK_ENGAGER_CLIP = 0x45;
/** The target's clip: p188blok's break-apart, 21 ticks. */
export const BLOCK_TARGET_CLIP = 0x54;
/** The wait before the target acts: `slti $v0, 0x14` = 20 ticks. */
export const BLOCK_TARGET_WAIT = 20;
/** The packed cue the target requests as it starts to move (COMEX113). */
export const BLOCK_CUE = 0x800446c9;
/** The state the target calls `+0x28` with when its clip ends: removed. */
export const BLOCK_GONE_STATE = 3;

/** The bank-0 completion bit each id writes (file 0xe118-0xe168). */
export function blockCompletionBit(id: number): number | null {
    if (id === 328) return 8;
    if (id === 351) return 9;
    if (id === 352) return 10;
    return null;
}

/** True for the three special block npc ids. */
export function isBlockActorId(id: number): boolean {
    return blockCompletionBit(id) !== null;
}

/**
 * The block rows of one stage's cast list: the same general actor loop every
 * other NPC goes through (cast-list.ts), narrowed to the three special ids.
 */
export function blockActorRecords(
    records: readonly CastRecord[] | null | undefined,
    matches: CastFlagMatch,
): CastRecord[] {
    return castActorRecords(records, matches).filter((r) => isBlockActorId(r.id));
}

/** The decoded tick lengths the machine runs on (block_actors.json). */
export interface BlockDurations {
    /** clip 0x45's total, in blanks. */
    engager: number;
    /** clip 0x54's total, in blanks. */
    target: number;
    /** the wait before the target's clip latches. */
    wait: number;
}

/** The extracted values, as `tools/extract_block_actors.py` mined them. */
export const BLOCK_DURATIONS: BlockDurations = {
    engager: 36,
    target: 21,
    wait: BLOCK_TARGET_WAIT,
};

/** One live interaction. The words mirror the two objects' own fields. */
export interface BlockEngagement {
    /** the block's npc id. */
    targetId: number;
    /** the bank-0 bit the target writes when it starts to move. */
    bit: number;
    /** the engager's obj+0x14: 0 = latch pending, 1 = waiting for the clip. */
    engagerSub: number;
    /** clip 0x45 blanks still to play. */
    engagerLeft: number;
    /** the target's obj+0x18: the wait counter. */
    targetTimer: number;
    /** the target's obj+0x14: 0 = waiting, 1 = the clip is playing. */
    targetSub: number;
    /** clip 0x54 blanks still to play. */
    targetLeft: number;
    /** `[0x80099de0]`: the field lock, raised by the engager's latch. */
    busy: boolean;
    /** blanks since the confirm tick (which is 0). */
    ticks: number;
    /** the landmarks, for the headless check and the draw. */
    actionTick: number | null;
    engagerDoneTick: number | null;
    goneTick: number | null;
}

/** What one blank of the interaction did. */
export interface BlockTickEvents {
    /** the block latched its clip: request the cue, write the completion bit. */
    action?: boolean;
    /** the player's clip ended: the field lock clears, control returns. */
    engagerDone?: boolean;
    /** the block's clip ended: it leaves the field. */
    gone?: boolean;
}

/**
 * The engage branch, as `engageBlock`: refuses anything but the three ids and
 * a target that is not already in 0x4e (the caller checks the target's live
 * state before calling).  The returned object is the pair of mode words the
 * branch's `setState` calls write.
 */
export function engageBlock(targetId: number): BlockEngagement | null {
    const bit = blockCompletionBit(targetId);
    if (bit === null) return null;
    return {
        targetId,
        bit,
        engagerSub: 0,
        engagerLeft: 0,
        targetTimer: 0,
        targetSub: 0,
        targetLeft: 0,
        busy: false,
        ticks: 0,
        actionTick: null,
        engagerDoneTick: null,
        goneTick: null,
    };
}

/**
 * One blank of both mode bodies, in the original's own order: the engager's
 * latch/complete arm, then the target's wait/action arm, then its clip arm.
 * `delta` is the frame delta the console's own delta function returns (one
 * blank on the walker's clock).
 */
export function tickBlockEngagement(
    e: BlockEngagement,
    delta: number,
    durations: BlockDurations = BLOCK_DURATIONS,
): BlockTickEvents {
    const ev: BlockTickEvents = {};
    e.ticks += delta;

    // The engager: state 0x4d (file 0xe020-0xe0a0).
    if (e.engagerSub === 0) {
        // The latch arm: setClip(0x45), busy = 1, obj+0x108 = 0, advanceCounter.
        // The latch tick shows the clip's first frame, so 35 blanks remain.
        e.engagerSub = 1;
        e.engagerLeft = Math.max(0, durations.engager - 1);
        e.busy = true;
    } else if (!e.engagerDoneTick) {
        e.engagerLeft -= delta;
        if (e.engagerLeft <= 0) {
            // setState(1), setClip(1), F0x8008FD60, busy = 0.
            e.engagerDoneTick = e.ticks;
            e.busy = false;
            ev.engagerDone = true;
        }
    }

    // The target: state 0x4e (file 0xe0a4-0xe19c).
    if (e.targetSub === 0) {
        e.targetTimer += delta;
        if (e.targetTimer >= durations.wait) {
            // The action arm: setClip(0x54), cue, completion bit, advanceCounter.
            e.targetSub = 1;
            e.targetLeft = durations.target;
            e.actionTick = e.ticks;
            ev.action = true;
        }
    } else if (!e.goneTick) {
        e.targetLeft -= delta;
        if (e.targetLeft <= 0) {
            // The target's own +0x28(3): removed from the field.
            e.goneTick = e.ticks;
            ev.gone = true;
        }
    }

    return ev;
}
