/**
 * Falling objects — the stage overlay's own rockfall actor.
 *
 * DECODE (original assembly, authority 2). All addresses below are wstag415
 * (overlay load base 0x800a5de0) and are re-derived mechanically by
 * `tools/extract_falling_objects.py`, which finds the actor by a 12-instruction
 * signature at its state-0 record load rather than by a hand list, so a stage
 * that ships it is found by its own code.
 *
 * WHO OWNS THIS. A falling rock is NOT a fieldstg system. The object is one of
 * the resident allocator's state machines (EXE F0x800143dc installs the method
 * block at +0x28..+0x44 and the tick callback at +0x48), built by the stage
 * overlay for itself out of its own 16-byte record table — the same shape as the
 * type-0x17 launch pads in `launch-pad.ts`. Three pieces are genuinely shared
 * and are ported once:
 *
 *   - the state-machine object layout (EXE F0x800143dc / F0x80014274..308),
 *   - the layer-job draw path (EXE F0x8001e240, which queues
 *     {drawCb, obj, y, extra} and the render-layer runner's `drawCb(obj, extra)`),
 *   - the draw-context sprite call (EXE F0x8001ed6c `(subPtr, clip, x, y)`).
 *
 * What is per stage is the record table, the animation sequences and the physics
 * constants; those are data (`web/assets/data/falling_objects.json`).
 *
 * THE TICK (0x800a5fa8). `state = obj->0xc`:
 *
 *   state 0 -> read the record at TABLE + obj->0x4 * 16: start x/y into the
 *              8.8 accumulators obj->0x5c/0x60 (each << 8), the x step into
 *              obj->0x64, clear the bounce flag obj->0x6e and the velocity
 *              obj->0x68, then ADV_STATE (+0x38) -> state 1 and return.
 *   state 1 -> fall (below).
 *   state >=2 -> return. The draw callback also tests `state == 1`, so an actor
 *              that crosses the despawn line on this frame draws nothing.
 *
 * THE FALL. Per frame: the stage's own sequence stepper yields the clip into
 * obj->0x50; obj->0x5c += obj->0x64 (x drift, 8.8) and obj->0x54 = that >> 8;
 * obj->0x68 += frameDelta * the record's accel; obj->0x60 += obj->0x68 and
 * obj->0x58 = that >> 8 (y). The bounce is guarded by three tests in order —
 * the record's divisor is non-zero, obj->0x6e is clear, and y has reached the
 * record's bounce line — and when it fires it snaps y onto the line, sets
 * `vel = -(vel / divisor)` (signed truncating `div`, so the rock rebounds at a
 * fraction of its speed), multiplies the x step by 3, latches obj->0x6e and
 * plays packed sound 0x00040012. Finally `y >= 0x245` (581) sets state 3.
 *
 * THE SEQUENCE STEPPER (0x800a5df4). Entries are 4 bytes {s16 clip, u16 hold};
 * the end marker is clip == 255 (0xff), not -1 — the routine compares against
 * `li $v0, 0xff`, so a halfword of +255 ends the run. Each call subtracts
 * min(frameDelta, 4) from the hold timer at depth 0; when the timer is not
 * positive it advances one entry, adds that entry's hold to the timer, and on
 * the end marker resets the index and adds entry 0's hold before recursing with
 * depth+1 — which is a tail loop, because the recursion no longer decrements.
 *
 * TIMEBASE. `delta` is the display service's per-blank delta (1 on most PAL
 * blanks, 2 on 51 of every 256; engine/systems/frame-clock.ts). The walker
 * calls the tick once per PAL blank through NativeVblankClock
 * (web/stage-objects.js paceStageObjects), so the hold timer and the fall
 * speed advance as they do on the console, at any monitor rate.
 */

/** One 16-byte record: the word 0 sequence pointer plus six halfwords. */
export interface FallingObjectRecord {
    /** Animation-sequence address, as read out of the overlay. */
    seq: string;
    /** Start x in pixels; the tick stores it << 8 into the 8.8 accumulator. */
    x: number;
    /** Start y in pixels, likewise << 8. */
    y: number;
    /** Pixel y at which the rock rebounds; 0 disables the bounce entirely. */
    bounceY: number;
    /** Per-frame x drift in 8.8 fixed point. */
    xStep: number;
    /** Added to the 8.8 y velocity every frame. */
    accel: number;
    /** Signed divisor applied to the rebound velocity; 0 disables the bounce. */
    divisor: number;
}

/** One builder: the resident registry's id and the table slot it constructs. */
export interface FallingObjectBuilder {
    slot: number;
    ctor: string;
    effectId: number | null;
}

export interface FallingObjectConfig {
    tick?: string;
    draw?: string;
    stepper?: string;
    sound?: string;
    table?: string;
    stride?: number;
    slots?: number;
    despawnY?: number;
    records: FallingObjectRecord[];
    sequences: Record<string, [number, number][]>;
    builders?: FallingObjectBuilder[];
}

/** One live rock. `state` is the resident allocator's state word, obj+0xc. */
export interface FallingObject {
    /** The registry id this rock answers to (the TICK's identity argument). */
    id: number;
    /** Record index: obj+0x4, set by the stage's builder wrapper. */
    slot: number;
    /** obj+0xc — 0 = load the record, 1 = falling, 3 = despawned. */
    state: number;
    /** obj+0x50: the clip the stepper returned this frame. */
    clip: number;
    /** obj+0x54 / obj+0x58: the pixels handed to drawSprite. */
    x: number;
    y: number;
    /** obj+0x5c / obj+0x60: the 8.8 accumulators those pixels come from. */
    fixedX: number;
    fixedY: number;
    /** obj+0x64: per-frame x drift, 8.8. */
    xStep: number;
    /** obj+0x68: 8.8 y velocity. */
    vel: number;
    /** obj+0x6e: set once the rock has bounced. */
    bounced: number;
    /** The stepper's cursor at obj+0x70/0x72 (+0x14/+0x16 of obj+0x5c). */
    seqIndex: number;
    seqTimer: number;
    /** Record slice this rock runs, resolved once at construction. */
    record: FallingObjectRecord;
    sequence: [number, number][];
}

/** The sequence stepper's end marker (wstag415 0x800a5db4: `li $v0, 0xff`). */
export const FALLING_SEQUENCE_END = 255;

/** Despawn line used when a stage's table does not carry one. */
export const FALLING_DESPAWN_Y = 581;

/** The bounce sound's packed word; the `lui`/`ori` pair is one value. */
export const FALLING_BOUNCE_SOUND = 0x00040012;

/** A falling rock to draw: the clip plus the pixels the original submits. */
export interface FallingDraw {
    id: number;
    clip: number;
    x: number;
    y: number;
}

/** State the stepper mutates (obj+0x70 frame index, obj+0x72 hold timer). */
export interface SequenceCursor {
    index: number;
    timer: number;
}

/**
 * The stage's own animation-sequence stepper, a port of 0x800a5df4.
 * `min(delta, 4)` is subtracted from the hold timer at depth 0 only; the
 * recursion after the end marker is a tail loop, not a second decrement.
 */
export function stepFallingSequence(
    cursor: SequenceCursor,
    entries: [number, number][],
    delta: number,
    depth = 0,
): number {
    if (!entries.length) return 0;
    const step = delta < 5 ? delta : 4;
    if (depth === 0) cursor.timer -= step;
    if (cursor.timer > 0) return entries[cursor.index]?.[0] ?? 0;
    const next = cursor.index + 1;
    if (next >= entries.length) return entries[entries.length - 1]?.[0] ?? 0;
    const entered = entries[next]!;
    cursor.index = next;
    cursor.timer += entered[1];
    if (entered[0] === FALLING_SEQUENCE_END) {
        cursor.timer += entries[0]?.[1] ?? 0;
        cursor.index = 0;
    }
    return stepFallingSequence(cursor, entries, delta, depth + 1);
}

/** The registry id -> table slot pairing, read from the overlay's builders. */
export function fallingObjectSlot(config: FallingObjectConfig, id: number): number | null {
    for (const b of config.builders ?? []) {
        if (b.effectId === id) return b.slot;
    }
    return null;
}

/** Build one rock in state 0, as the stage's builder wrapper does. */
export function createFallingObject(
    config: FallingObjectConfig,
    id: number,
    slot: number,
): FallingObject | null {
    const record = config.records[slot];
    if (!record) return null;
    return {
        id,
        slot,
        state: 0,
        clip: 0,
        x: record.x,
        y: record.y,
        fixedX: 0,
        fixedY: 0,
        xStep: record.xStep,
        vel: 0,
        bounced: 0,
        seqIndex: 0,
        seqTimer: 0,
        record,
        sequence: config.sequences[record.seq] ?? [],
    };
}

/**
 * One frame of the tick (0x800a5fa8). Returns the clip to draw, or null when
 * the rock is not in its drawing state — the original's draw callback tests
 * `state == 1` itself, so a rock despawned on this frame draws nothing.
 */
export function tickFallingObject(
    obj: FallingObject,
    config: FallingObjectConfig,
    delta: number,
    onSound?: (word: number) => void,
): number | null {
    if (obj.state === 0) {
        obj.fixedX = obj.record.x << 8;
        obj.fixedY = obj.record.y << 8;
        obj.x = obj.record.x;
        obj.y = obj.record.y;
        obj.xStep = obj.record.xStep;
        obj.bounced = 0;
        obj.vel = 0;
        obj.state = 1;
        return null;
    }
    if (obj.state !== 1) return null;

    const cursor = { index: obj.seqIndex, timer: obj.seqTimer };
    obj.clip = stepFallingSequence(cursor, obj.sequence, delta);
    obj.seqIndex = cursor.index;
    obj.seqTimer = cursor.timer;

    obj.fixedX += obj.xStep;
    obj.x = obj.fixedX >> 8;
    obj.vel += delta * obj.record.accel;
    obj.fixedY += obj.vel;
    obj.y = obj.fixedY >> 8;

    const { bounceY, divisor } = obj.record;
    if (divisor !== 0 && !obj.bounced && obj.y >= bounceY) {
        obj.fixedY = bounceY << 8;
        obj.y = bounceY;
        obj.vel = -Math.trunc(obj.vel / divisor);
        obj.xStep = obj.record.xStep * 3;
        obj.bounced = 1;
        onSound?.(config.sound ? Number(config.sound) : FALLING_BOUNCE_SOUND);
    }

    if (obj.y >= (config.despawnY ?? FALLING_DESPAWN_Y)) obj.state = 3;
    return obj.state === 1 && obj.clip !== 0 ? obj.clip : null;
}

/** Every live rock's draw entry for this frame, in slot order. */
export function fallingObjectDraws(objects: FallingObject[]): FallingDraw[] {
    const out: FallingDraw[] = [];
    for (const o of objects) {
        if (o.state !== 1 || o.clip === 0) continue;
        out.push({ id: o.id, clip: o.clip, x: o.x, y: o.y });
    }
    return out;
}