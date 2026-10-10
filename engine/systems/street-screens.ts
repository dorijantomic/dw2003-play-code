// Street screens — the wall and column screens the Kusanagi City street corner
// overlay draws for itself: the idle street loop and, when the A.O.A
// announcement runs, the news tiles on top of it.
//
// Ported from the original's per-stage native code, all of it inside wstag780
// (loaded at 0x800a5de0):
//
//   * the screen-content driver tick  0x800a72b0 (file 0x14d0)
//   * its quad builder               0x800a6fbc (file 0x11dc)
//   * the effect-registry entry      {id 0x321, ctor 0x800a749c (file 0x16bc),
//                                     draw 0x800a7450 (file 0x1670)}
//   * the street entry that builds it 0x800a74cc (file 0x16ec), whose first tick
//     calls the ctor with id 0x321 before it starts the stage's own event
//
// The object identity is the tick passed to the allocator: F0x800143dc installs
// its first argument as the object's tick callback, so 0x800a72b0 IS the driver.
//
// WHAT THE PLAYER SEES. Twenty screens: a small wall unit by the road and a row
// of big column units on the corner building. Each is drawn twice — a lit
// frame quad (semi-transparent) and the content quad inside it. The content
// cycles through a long animation program on a clock of PAL blanks; the
// announcement's `SETANIM 801 802` opcode switches the two cursors onto the
// news tiles and plays one sound.
//
// Decode with every asm line quoted:
// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
//
// Object layout, as the original's own code reads it (`s3` = the object):
//
//   +0x0c        state (the allocator's state word; 0 arms, 1 runs, 2+ returns)
//   +0x50 +0x14k cursor block k:  +0 sequence index, +4 the sequence index used
//                                on the previous tick, +8 position inside the
//                                sequence, +0xc the texture entry it latched,
//                                +0x10 frames left on that entry
//
// Why +4 exists: the loop compares the two and, when they differ, rewinds the
// block (file 0x1568-0x157c `beq $v1,$v0` / `sw $v1,0x4($s0)` / `sw $zr,0x8`
// / `sw $zr,0xc` / `sw $zr,0x10`). So it is the "the opcode moved this cursor to
// another sequence" detector, and it is why the news opcode takes effect on the
// next tick rather than immediately.

import {
    STREET_SCREEN_TABLES,
    type StreetScreenTables,
} from "../dw3/street-screen-tables.ts";

/** The bytes one GPU quad occupies in the packet (builder file 0x1464). */
export const SCREEN_QUAD_STRIDE = 0x28;
/** The header byte the builder writes at record+3 (file 0x12d0). */
export const SCREEN_QUAD_MARKER = 9;
/** The tint bytes it writes at record+4..+6 (file 0x12fc-0x1304). */
export const SCREEN_QUAD_RGB = 0x80;
/** `sb 0x2c` at record+7 — the opaque command (file 0x12d8). */
export const SCREEN_CMD_OPAQUE = 0x2c;
/** `sb 0x2e` at record+7 — the blended command (file 0x12f4). */
export const SCREEN_CMD_ABR = 0x2e;
/** `slti $v0, 0x9`: from this type up the quad is drawn blended (file 0x12e4). */
export const SCREEN_TYPE_ABR_FROM = 9;
/** `li $a0, 0x14`: a type-1 screen maps a 20x20 patch of its tile (file 0x12c8).
 *  The branch delay slot carries `li $a0, 0x28`, so every OTHER type — the type
 *  0 screens and the frame quads — maps 40x40. */
export const SCREEN_PATCH_NARROW = 0x14;
export const SCREEN_PATCH_FULL = 0x28;
/** The draw-context scroll the builder subtracts from every corner (file 0x130c
 *  reads `ctx+0x11c`, the getScroll pair F0x8001E064). The interpreter's stub
 *  context reports 0 and the field draw path applies the camera itself, so the
 *  port emits absolute map pixels and takes the scroll as an argument. */
export const SCREEN_SCROLL_DEFAULT = { x: 0, y: 0 };

/** One textured quad, the same shape the interpreter captures for the research
 *  route (engine/native/runtime.ts `screenQuads`), so both draw identically. */
export interface StreetScreenQuad {
    /** The command byte: 0x2c opaque, 0x2e blended. */
    cmd: number;
    /** Corner x, in the builder's store order (+8, +0x10, +0x18, +0x20). */
    x: number[];
    /** Corner y (+0xa, +0x12, +0x1a, +0x22). */
    y: number[];
    /** Texture u of each corner (record +0xc, +0x14, +0x1c, +0x24). */
    u: number[];
    /** Texture v of each corner (+0xd, +0x15, +0x1d, +0x25). */
    v: number[];
    /** The texpage register word (record +0x16). */
    texpage: number;
    /** The clut register word (record +0xe). */
    clut: number;
}

/** One cursor block: where it is in its sequence and for how long. */
export interface StreetScreenCursor {
    /** Which sequence table it walks. */
    sequence: number;
    /** The sequence it walked on the previous tick — the change detector. */
    last: number;
    /** Its position inside that table. */
    position: number;
    /** The texture entry index the current table entry latched. */
    value: number;
    /** PAL blanks left on the current entry. */
    remaining: number;
}

export interface StreetScreenDriver {
    state: number;
    /** The two cursor blocks, in the order the tick walks them. */
    cursors: StreetScreenCursor[];
    /** This frame's quads, empty until the driver's second tick. */
    quads: StreetScreenQuad[];
    /** The packed sound the last news opcode asked for, for the caller to play. */
    sound: number | null;
}

const runtime: Record<string, StreetScreenDriver> = {};

function tablesFor(stageId: string): StreetScreenTables | null {
    return STREET_SCREEN_TABLES[stageId] ?? null;
}

/** A fresh object: the allocator's state word is 0 and the rest is zeroed. */
function freshDriver(t: StreetScreenTables): StreetScreenDriver {
    return {
        state: 0,
        cursors: t.boot.map((sequence, k) => ({
            sequence,
            // the state-0 arm's `li $v1, -1` pair at +0x54 / +0x68
            last: -1,
            position: 0,
            value: 0,
            remaining: 0,
        })),
        quads: [],
        sound: null,
    };
}

function driverFor(stageId: string, create: boolean): StreetScreenDriver | null {
    const t = tablesFor(stageId);
    if (!t) return null;
    let d = runtime[stageId];
    if (!d && create) d = runtime[stageId] = freshDriver(t);
    return d ?? null;
}

/** True when this stage carries the screen-quad driver at all. */
export function hasStreetScreens(stageId: string): boolean {
    return Boolean(tablesFor(stageId));
}

/** Every stage the decoded tables ship, sorted: the census list. */
export function streetScreenStages(): string[] {
    return Object.keys(STREET_SCREEN_TABLES).sort();
}

function tableFor(t: StreetScreenTables, sequence: number): readonly (readonly [number, number])[] {
    return t.sequences[sequence] ?? [];
}

/**
 * One cursor's step (file 0x1590-0x1630): the frame delta comes off the timer,
 * and when the timer has run out the block moves on one entry. A zero duration
 * is a jump — the entry's value byte becomes the new position, read once, so a
 * run of zero-duration entries walks one link per tick exactly as the original
 * does.
 */
function stepCursor(
    t: StreetScreenTables,
    cursor: StreetScreenCursor,
    frameDelta: number,
): void {
    if (cursor.sequence !== cursor.last) {
        cursor.last = cursor.sequence;
        cursor.position = 0;
        cursor.value = 0;
        cursor.remaining = 0;
    }
    cursor.remaining -= frameDelta;
    if (cursor.remaining > 0) return;
    const seq = tableFor(t, cursor.sequence);
    let next = cursor.position + 1;
    if (next >= seq.length) next = 0; // never reached by the shipped tables
    const ahead = seq[next];
    if (ahead !== undefined && ahead[1] === 0) next = ahead[0];
    const entry = seq[next] ?? seq[0] ?? [0, 0];
    cursor.position = next;
    cursor.value = entry[0];
    cursor.remaining = entry[1];
}

/** The builder stores each corner with `sh` and subtracts the scroll as an
 *  unsigned 16-bit pair, so a corner can come out negative; the draw path reads
 *  it back signed, which is what the interpreter's capture hands the browser. */
function s16(v: number): number {
    const u = v & 0xffff;
    return u & 0x8000 ? u - 0x10000 : u;
}

/** The quad builder (file 0x11dc-0x14d0): one quad per screen record. */
function buildQuads(
    t: StreetScreenTables,
    cursors: readonly StreetScreenCursor[],
    scroll: { x: number; y: number },
): StreetScreenQuad[] {
    const quads: StreetScreenQuad[] = [];
    for (const record of t.records) {
        const type = record.type;
        // file 0x1274-0x12b4: a type of 0 or 1 takes the texture entry the
        // matching cursor latched (obj+0x5c / obj+0x70); every other type is a
        // fixed entry index.
        const texIndex = type >= 0 && type < cursors.length ? cursors[type]?.value ?? 0 : type;
        const tex = t.textures[texIndex];
        const size = type === 1 ? SCREEN_PATCH_NARROW : SCREEN_PATCH_FULL;
        const u = tex?.u ?? 0;
        const v = tex?.v ?? 0;
        quads.push({
            cmd: type >= SCREEN_TYPE_ABR_FROM ? SCREEN_CMD_ABR : SCREEN_CMD_OPAQUE,
            x: record.x.map((cx) => s16(cx - scroll.x)),
            y: record.y.map((cy) => s16(cy - scroll.y)),
            u: [u, u + size, u, u + size],
            v: [v, v, v + size, v + size],
            // A type outside the table cannot be painted; the original would read
            // past its own table here, so the quad carries no page instead of a
            // guess (the draw layer skips a missing combo).
            texpage: tex?.texpage ?? -1,
            clut: tex?.clut ?? -1,
        });
    }
    return quads;
}

/**
 * The SETANIM >= 0x320 route for the screen driver (registry draw 0x800a7450).
 * Returns true when the id belongs to this driver, so the caller skips the
 * generic emote bubble. The original only stores the two sequence indices and
 * plays one sound here; the cursors rewind on their next tick.
 */
export function fireStreetScreens(
    stageId: string,
    effectId: number,
    subId: number,
    onSound?: (packed: number) => void,
): boolean {
    const t = tablesFor(stageId);
    if (!t || effectId !== t.effectId || subId !== t.newsSubId) return false;
    const d = driverFor(stageId, true);
    if (!d) return false;
    d.cursors.forEach((cursor, k) => {
        if (t.news[k] !== undefined) cursor.sequence = t.news[k];
    });
    d.sound = t.newsSound;
    onSound?.(t.newsSound);
    return true;
}

/**
 * One PAL blank of the driver (the tick, file 0x14d0). Returns the quads to draw
 * this frame — empty until the driver's second tick, exactly as the original's
 * state-0 arm draws nothing.
 *
 * The driver builds itself on the stage's first tick (the street entry's own
 * first tick, file 0x1720, calls the registry ctor), so a caller that simply
 * ticks every frame gets the screens without any event.
 */
export function tickStreetScreens(
    stageId: string,
    frameDelta = 1,
    scroll: { x: number; y: number } = SCREEN_SCROLL_DEFAULT,
): readonly StreetScreenQuad[] {
    const t = tablesFor(stageId);
    if (!t) return [];
    const d = driverFor(stageId, true);
    if (!d) return [];
    if (d.state === 0) {
        // state 0: advance the state and return (file 0x1514-0x153c). The boot
        // pair was installed when the object was made.
        d.state = 1;
        d.quads = [];
        return d.quads;
    }
    if (d.state >= 2) {
        d.quads = [];
        return d.quads;
    }
    for (const cursor of d.cursors) stepCursor(t, cursor, frameDelta);
    d.quads = buildQuads(t, d.cursors, scroll);
    return d.quads;
}

/** This frame's quads (identical to the last tick's return value). */
export function streetScreenDraws(stageId: string): readonly StreetScreenQuad[] {
    return runtime[stageId]?.quads ?? [];
}

/** The driver's live cursors — the test/probe view of the original's +0x50. */
export function streetScreenState(stageId: string): StreetScreenDriver | null {
    return runtime[stageId] ?? null;
}

/** Drop the driver on a stage (or everywhere) — on a stage change. */
export function clearStreetScreens(stageId?: string): void {
    if (stageId === undefined) {
        for (const key of Object.keys(runtime)) delete runtime[key];
        return;
    }
    delete runtime[stageId];
}
