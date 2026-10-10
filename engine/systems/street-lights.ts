// Street lights — the traffic-light corner the Kusanagi City street overlay
// (wstag780) builds for itself, and which only exists for the later story beat.
//
// Ported from the original's per-stage native code, all of it inside wstag780
// (loaded at 0x800a5de0):
//
//   * the street manager        0x800a6940 (file 0xb60), ctor 0x800a69d8
//     (file 0xbf0, extra 0x1c = seven pointers). Its state-0 arm builds six
//     glow objects and the traffic-light writer and then advances its own
//     state; states 1..3 return without building anything again.
//   * the glow object           0x800a652c (file 0x74c), ctor 0x800a6678
//     (file 0x8cc) — six of them, one per record of the 8-byte table at
//     0x800a8420.
//   * the traffic-light writer  0x800a67a4 (file 0x9c4), ctor 0x800a6914
//     (file 0xb30). It owns two cursors at +0x50 and +0x58 and writes active,
//     sprite id and ctr into the two point records whose byte+1 is 1 and 2 —
//     the lamp housings on the two poles.
//   * the two sequence players the overlay carries: 0x800a66b0 (file 0x8d0),
//     which walks the writer's cursor, and 0x800a638c (file 0x5ac), which walks
//     the glow's shorter one. The same routine written twice; `advanceSequence`
//     here is both.
//
// The object identity is the tick passed to the allocator: F0x80014504 /
// F0x800143dc install their first argument as the object's tick callback, so
// 0x800a6940 IS the manager and 0x800a652c IS a glow.
//
// WHAT THE PLAYER SEES. On the street corner at the later story beat, the two
// poles' lamps start cycling: each pole's record is lit and its clip steps
// through six held frames and then a fast flicker through the rest, forever.
// Six small glows blink on and off around the corner on a two-frame clip.
//
// WHICH STORY BEAT. The overlay's street entry (0x800a74cc, file 0x16ec) is
// the only thing that ever calls the manager's ctor, and only in its
// master-ordinal 0x1B arm:
//
//   .L0x00001758: bne $v1, $v0, .L0x00001778   # $v1 = [0x8005b370], $v0 = 0x1b
//   .L0x0000175c: li $v0, 0x20
//   .L0x00001760: jal 0x800853f8                # start_event(742)
//   .L0x00001768: jal 0x800a69d8                # the street manager
//
// so the corner exists exactly when the master story ordinal is 0x1B, together
// with the stage's event 742. The walker's own gate for that event is flag
// 0x601B, because bank 0x60 bit 27 is "master ordinal == 27"
// (engine/dw3/dw3-config.ts `registerVirtualBank`) — the two agree, and this
// module takes the ordinal directly so it cannot drift from the overlay.
//
// Decode with every asm line quoted:
// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
//
// Object layout, as the original's own code reads it:
//
//   manager  +0x0c state; the extra buffer is glows 0..5 then the writer
//   glow     +0x04 which record of the lamp table, +0x0c state, +0x50 the clip
//            it is showing, +0x54 x, +0x58 y, +0x5c its {index, timer} cursor
//   writer   +0x0c state; the two cursors are {record pointer as a whole word,
//            index at +4, timer at +6}, which is why the first cursor's +0x50
//            is not a halfword at all (file 0xa88 / 0xa8c).

import {
    STREET_LIGHT_TABLES,
    type StreetLightTables,
} from "../dw3/street-light-tables.ts";

/** The master story ordinal the overlay's street entry builds the corner on
 *  (file 0x1748-0x1774). The walker's flag gate for the same beat is 0x601B. */
export const STREET_LIGHT_ORDINAL = 0x1b;
/** The stage event that same arm starts (`li $a0, 0x2e6`, file 0x175c). */
export const STREET_LIGHT_EVENT = 742;

/** The two point-record types the writer claims: the byte at record+1 compared
 *  against 1 and 2 (file 0xa58-0xa8c). The first match is the +0x50 cursor,
 *  the second the +0x58 one, and each plays its own sequence. */
export const POLE_RECORD_TYPES: readonly number[] = [1, 2];

/** The frame-delta ceiling both sequence players clamp to: `slti $v0, $v1, 0x5`
 *  followed by `li $v1, 0x4` (file 0x5ec-0x5f8 and 0x90c-0x91c). A long stall
 *  charges at most 4 blanks to one entry. */
export const SEQUENCE_MAX_CHARGE = 4;

/** The loop marker both players test for: `li $v0, 0xff` (file 0x64c, 0x970). */
export const SEQUENCE_LOOP_MARKER = 0xff;

/** A sequence cursor: which entry, and how many blanks are left on it. The
 *  entry's own hold is read from the list, never stored here — the original
 *  keeps it in the table too (file 0x95c `lhu $v1, 0x2($s0)`). */
export interface LampCursor {
    index: number;
    timer: number;
}

/** One glow object (six of them). */
export interface StreetGlow {
    /** Which record of the lamp table this glow is. */
    slot: number;
    state: number;
    /** The clip it is showing, from its own two-frame list. */
    clip: number;
    /** False until the glow has run one tick in state 1. The state-0 arm
     *  publishes clip 0 and advances (file 0x808 / 0x820) without drawing, so
     *  the original has nothing on screen on the blank it is created. */
    armed: boolean;
    x: number;
    y: number;
    cursor: LampCursor;
}

/** One point-record write the writer publishes this frame. */
export interface PoleWrite {
    /** Index into the stage's record table. */
    index: number;
    active: number;
    sprite: number;
    ctr: number;
}

export interface StreetLights {
    /** False until the manager has run its build arm. */
    built: boolean;
    glows: StreetGlow[];
    /** The writer's two cursors, +0x50 and +0x58. */
    cursors: LampCursor[];
    /** The record index each cursor claimed, in the same order. */
    poles: number[];
    /** This frame's writes into the stage's point records. */
    writes: PoleWrite[];
}

const runtime: Record<string, StreetLights> = {};

/** The stage's record table, in the two bytes the writer reads. `type` is the
 *  record's byte+1 (the pole type) and `size` its byte+2, which is the field
 *  whose zero value ends the walk. The walker's extractor carries byte+2 as the
 *  record's texture size, so that is the name used here. */
export interface PoleRecord {
    type: number;
    size: number;
}

function tablesFor(stageId: string): StreetLightTables | null {
    return STREET_LIGHT_TABLES[stageId] ?? null;
}

function freshCorner(t: StreetLightTables): StreetLights {
    return {
        built: false,
        glows: t.lamps.map((l, slot) => ({
            slot,
            state: 0,
            clip: 0,
            armed: false,
            x: l.x,
            y: l.y,
            cursor: { index: 0, timer: l.list[0]?.[1] ?? 0 },
        })),
        // The writer's state-0 arm zeroes both indices and latches each
        // sequence's first entry hold as its timer (file 0xa10-0xa3c).
        cursors: t.sequences.map((s) => ({ index: 0, timer: s[0]?.[1] ?? 0 })),
        poles: [-1, -1],
        writes: [],
    };
}

/** True when this stage carries the traffic-light corner at all. */
export function hasStreetLights(stageId: string): boolean {
    return Boolean(STREET_LIGHT_TABLES[stageId]);
}

/**
 * The one place the corner comes into existence. The original builds it from
 * the overlay's street entry when the master story ordinal is 0x1B, so that is
 * the only value that turns the lights on here. Idempotent, like the original's
 * single build arm.
 */
export function fireStreetLights(
    stageId: string,
    ordinal: number,
    records?: readonly PoleRecord[] | null,
): boolean {
    const t = tablesFor(stageId);
    if (!t) return false;
    if (ordinal !== STREET_LIGHT_ORDINAL) return false;
    const c = (runtime[stageId] ??= freshCorner(t));
    c.built = true;
    // The original's writer finds its poles in its own state-0 arm, so the
    // records are claimed as the corner is built when the caller has them.
    if (records) claimPoleRecords(stageId, records);
    return true;
}

/**
 * One frame of the sequence player both objects share.
 *
 * 0x800a66b0 (file 0x8d0) and 0x800a638c (file 0x5ac) are the same routine
 * written twice, once per cursor layout. Read from file 0x8f8:
 *
 *   lh  $v1, 0x4($s1)      the index
 *   sll $v1, 0x2           times 4 -> the {clip, hold} halfword pair
 *   slti $v0, $v1, 0x5     the frame delta, clamped to 4 by `li $v1, 0x4`
 *   bnez $s3, skip         the recursive hop passes s3+1: chain without charging
 *   lhu $v0, 0x6($s1) / subu / sh      timer -= delta
 *   bgtz -> return lh($s0)             time left: the current entry's clip
 *   index++ ; timer += the new entry's hold (`lhu $v1, 0x2($s0)`)
 *   lh $v1, ($s0) == 0xff -> index = 0, timer += list[0].hold, re-walk
 *
 * `charge` is false on the recursive hop, so a run of zero-length entries costs
 * no blanks — which is what the `s3+1` argument is for.
 */
export function advanceSequence(
    cursor: LampCursor,
    list: readonly (readonly [number, number])[],
    delta: number,
    charge = true,
): number {
    const head = list[0];
    if (!head) return 0;
    if (charge) cursor.timer -= Math.min(delta, SEQUENCE_MAX_CHARGE);
    if (cursor.timer > 0) return list[cursor.index]?.[0] ?? head[0];
    cursor.index += 1;
    const next = list[cursor.index];
    if (!next) {
        // Past the list's own end without meeting the marker: the original can
        // only get here if the table is malformed, so wrap the way the marker
        // does rather than reading past it.
        cursor.index = 0;
        cursor.timer += head[1];
        return advanceSequence(cursor, list, delta, false);
    }
    cursor.timer += next[1];
    if (next[0] === SEQUENCE_LOOP_MARKER) {
        cursor.index = 0;
        cursor.timer += head[1];
        return advanceSequence(cursor, list, delta, false);
    }
    return next[0];
}

/**
 * The writer's state-0 record search (file 0xa4c-0xaa0): walk the stage's
 * records in 18-byte strides, stop at the first whose byte+2 is zero, and keep
 * the first record of each pole type. The records live in the shared
 * point-sprite table, so the caller passes them in.
 */
export function claimPoleRecords(stageId: string, records: readonly PoleRecord[]): void {
    const c = runtime[stageId];
    if (!c?.built) return;
    const found: number[] = [];
    for (const [i, rec] of records.entries()) {
        if (!rec.size) break;
        if (POLE_RECORD_TYPES.includes(rec.type) && found.length < 2) found.push(i);
        if (found.length === 2) break;
    }
    c.poles = [found[0] ?? -1, found[1] ?? -1];
}

/**
 * One PAL blank of the whole corner, counting the same blanks the rest of the
 * field does. Returns the writes the traffic-light writer publishes into the
 * stage's point records; the caller applies them, because those records are the
 * shared point-sprite memory web/effects.js already owns.
 */
export function tickStreetLights(
    stageId: string,
    delta = 1,
    rand: () => number = Math.random,
): PoleWrite[] {
    const t = tablesFor(stageId);
    const c = runtime[stageId];
    if (!t || !c?.built) return [];
    // The glows. State 0 arms the cursor from the game's random bits —
    // index = rand & 1, timer = rand % 3 + 2 (`andi $v0, 0x1` at file 0x7dc and
    // the 0x5555556 multiply-to-divide-by-3 at file 0x7f4-0x824) — publishes
    // clip 0, and advances its state. State 1 steps the clip every blank.
    for (const glow of c.glows) {
        if (glow.state === 0) {
            const r = Math.floor(rand() * 0x10000) >>> 0;
            glow.cursor.index = r & 1;
            glow.cursor.timer = (r % 3) + 2;
            glow.clip = 0;
            glow.state = 1;
            continue;
        }
        if (glow.state !== 1) continue;
        glow.clip = advanceSequence(glow.cursor, t.lamps[glow.slot]?.list ?? [], delta);
        glow.armed = true;
    }
    // The writer: both cursors step in lockstep and each publishes its clip
    // into its own pole record with active = 1 and ctr = 0 (file 0xaec-0xb08).
    const writes: PoleWrite[] = [];
    for (const [i, cursor] of c.cursors.entries()) {
        const sprite = advanceSequence(cursor, t.sequences[i] ?? [], delta);
        const index = c.poles[i] ?? -1;
        if (index < 0) continue;
        writes.push({ index, active: 1, sprite, ctr: 0 });
    }
    c.writes = writes;
    return writes;
}

/**
 * The writes the writer published on its last tick. The stage's point records
 * are the shared point-sprite memory, so the writer only publishes and the
 * renderer (web/effects.js) applies them — the same division the interpreter's
 * memory rebase has.
 */
export function streetLightWrites(stageId: string): readonly PoleWrite[] {
    return runtime[stageId]?.writes ?? [];
}

/** The six glows' draw entries: clip id and map pixel. */
export function streetGlowDraws(stageId: string): { clip: number; x: number; y: number }[] {
    const c = runtime[stageId];
    if (!c?.built) return [];
    return c.glows.filter((g) => g.state === 1 && g.armed).map((g) => ({ clip: g.clip, x: g.x, y: g.y }));
}

/** Everything the corner holds, for the tests and the browser verifier. */
export function streetLightState(stageId: string): StreetLights | null {
    return runtime[stageId] ?? null;
}

/** The stages that carry the corner — the extractor's census, cached. */
export function streetLightStages(): string[] {
    return Object.keys(STREET_LIGHT_TABLES).sort();
}

/** Drop the corner on a stage (or everywhere) — on a stage change. */
export function clearStreetLights(stageId?: string): void {
    if (stageId === undefined) {
        for (const key of Object.keys(runtime)) delete runtime[key];
        return;
    }
    delete runtime[stageId];
}
