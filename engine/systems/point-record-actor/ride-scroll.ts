import type { PointActor, PointHost } from "./types.ts";
import {
  advanceClip,
  advanceState,
  createPointActor,
  playSound,
  recOf,
  runtime,
  scriptOf,
  setClip,
  tables,
} from "./core.ts";
import { stepPointRecordCursor } from "./stepper.ts";

// ── arm 10: ride-walker (s415 0x32b) ─────────────────────────────────────────
//
// THE crevice ride's own actor, read end to end from wstag415 on 2026-10-05
// (overlay base 0x800a5de0; tick file 0x778 = RAM 0x800a6558, the integrator
// file 0x8b8-0x974, the configure file 0xbac, the write-back file 0xb70, the
// one-shot stepper 0x800a645c at file 0x67c, the three scripts at RAM
// 0x800a73f0 / 0x800a7418 / 0x800a7428).  Every number below is re-decoded
// from the shipped image by tools/extract_point_record_actors.py (member
// `rideWalker`, `--check` green), never hand-copied.
//
// THE OBJECT is a 0x78-byte state machine (EXE F0x800143dc's method block).
// Two constructors build it: the registry's construct pointer (file 0xcb8)
// stamps obj+0x4 = 0, and the overlay's own scene entry (file 0x11a0) calls
// the second one (file 0xcec), which stamps 1.  `ride.route` is that word, and
// state 0 branches on it.
//
// THE TICK (file 0x778).  `state = obj+0xc`:
//
//   state 0 (and anything the dispatch lets fall through to it) -> the setup:
//     route 0: X = 0x9600, Y = 0xe600, sub/vel/drift/counter cleared;
//     route 1: X = 0x9600, Y = 0x1ae00, counter/sub cleared, and the whole
//     pixels 150/430 written too.  Then the claim walk (file 0x81c-0x858)
//     finds the FIRST record whose atlas byte is 1, and the park stores
//     obj+0x54 and then obj+0x58 into record+0xa -- BOTH into the X halfword;
//     record+0xc is never parked.  Then ADV_STATE, so the object lives in
//     state 1 from the next blank.
//   state 1 -> the five-entry sub table (the overlay image's own first words,
//     at 0x800a5de0+0): 0 a still frame, 1 the fall, 2/3/4 the three scripts.
//     Every sub ends in the write-back below.
//   states 2 and 3 -> return, writing nothing.
//
// THE SUB TABLE, in the overlay's own order:
//
//   0 (file 0x8a4)  sprite 0x32 = the first Bulbmon frame, still.
//   1 (file 0x8b0)  sprite 0x32, then the FALL: vel += 0x30 * delta;
//                   Y += vel; X += the drift (only ever 0); when the Y pixel
//                   reaches 0x1ae the position snaps onto the rail, a cue
//                   plays if the impact speed is at least 0x201, and the
//                   velocity becomes -vel/3 -- a bounce, damping by a third
//                   each impact, exactly as the falling rocks rebound.
//   2 (file 0x98c)  steps `seq1` (frames 50,52..59, holds 5..180) and cues at
//                   frame 53 (0x80044648) and 59 (0x00340001), each gated on
//                   the object's own cue counter obj+0x10.
//   3 (file 0xa20)  steps `seq2` (frames 60..62, the 999-hold on 62).
//   4 (file 0xa3c)  steps `seq3` (frames 1..47, four blanks each) and cues at
//                   frame 2 (0x00340002), 32 and 42 (0x00040012), then a
//                   blip every 32 blanks while the counter is 3 or 4.
//
// THE WRITE-BACK (file 0xb70): record+4 = obj+0x50 (the sprite), record+0xa =
// obj+0x54 (X), record+0 = 1, record+0xc = obj+0x58 (Y).  The record is the
// field's own point-sprite row, so the field renderer draws the actor with no
// draw callback of its own; a claim that matched nothing leaves the record
// pointer null and the port writes nothing (the disc would store through a
// null pointer).
//
// TIMEBASE.  One tick per PAL blank through web/stage-objects.js
// (tickPointRecordStageObjects), the same blank clock the scripts' WAITs run
// on, so a hold counts blanks as it did on the console.

/** The `ride-walker` machine's data, as the extractor mined it. */
export interface PointRideWalker {
    /** the claimed record's atlas tag (`li $a1, 1` in the walk's compare). */
    tag: number;
    /** the state-0 start position in 16.8; X is shared by both routes. */
    startX: number;
    /** route 0: the registry constructor's start Y (0xe600). */
    startY: number;
    /** route 1: the scene entry's own constructor Y (0x1ae00, on the rail). */
    startYEntry: number;
    /** the fall's velocity gain per delta (`3 << 4` = 0x30). */
    accel: number;
    /** the rail's Y in 16.8 (`0x1ae00`) and in whole pixels (`0x1ae`). */
    boundY: number;
    boundPx: number;
    /** the impact speed at which the fall plays its cue (`slti $v0, 0x201`). */
    cueVel: number;
    /** the rebound's damping divisor (the 0x2aaaaaab reciprocal is /3). */
    divisor: number;
    /** the packed cue the impact plays (0x8004474a). */
    fallCue: string;
    /** the five state-1 subs, in the overlay's own table order. */
    subs: PointRideSub[];
    /** SETANIM sub -> what the configure arm writes (file 0xbac). */
    configure: Record<string, {
        /** the state-1 sub it selects. */
        sub: number;
        /** the packed cue the arm plays as it fires. */
        cue?: string;
        /** resets the fall's position, velocity, drift and counter (817). */
        reset?: boolean;
        /** the script whose first entry's hold seeds the cursor (818/819/820). */
        rewind?: string;
        /** clears the cue counter obj+0x10 (818 and 820). */
        clearCtr?: boolean;
    }>;
    /** the record offsets the write-back stores, as the extractor read them. */
    writeBack: Record<string, number>;
    /** the overlay's own five sub pointers, as mined. */
    subTable?: string[];
}

/** One of the `ride-walker`'s five state-1 subs. */
export interface PointRideSub {
    /** what the sub runs: a literal sprite, the fall, or a script. */
    kind: "sprite" | "fall" | "script";
    /** the literal sprite subs 0 and 1 show (0x32). */
    sprite?: number;
    /** the script this sub steps through the one-shot stepper. */
    script?: string;
    /**
     * The script-value cues: each fires when the step returns `clip` while the
     * object's cue counter equals `ctr`, and bumps the counter by one.
     */
    cues?: { clip: number; ctr: number; sound: string; resetDivider?: boolean }[];
    /**
     * The periodic blip (sub 4): while the cue counter is one of `ctrs`, the
     * divider obj+0x14 counts up and every (mask + 1)th blank plays `sound`,
     * clears the divider and bumps the counter.
     */
    periodic?: { ctrs: number[]; mask: number; sound: string };
}

/**
 * The `scroll-layer` machine's data (s415 `0x32c`), mined from wstag415.s and
 * its disc resources by `tools/extract_scroll_layers.py` into
 * `web/assets/data/scroll_layers.json`.  Every runtime number is the overlay's
 * own immediate; the sheet geometry comes out of the stage's TMPK frame tables.
 *
 * The object is built by the stage's scene entry (registry constructor null),
 * and the visit word it carries decides the branch: a first visit (flag clear)
 * slides; a revisit (flag set) leaves it still.
 */
export interface PointScrollLayer {
    /** the story flag that gates visit vs revisit (`li $a0, 0x4018`). */
    flag: number;
    /** the sub the arrival event fires to ease the slide (`li $v0, 0x336`). */
    configureSub: number;
    /** both accumulators start zero (the factory's zero-fill). */
    startX: number;
    startY: number;
    /** the scroll speed 0x800 across / 0x400 up. */
    speedX: number;
    speedY: number;
    /** the per-tick deceleration `addiu $v0, -0x10`. */
    decay: number;
    /** the wrap: when x exceeds `wrapX`, x -= `wrapXSub` and y += `wrapYAdd`. */
    wrapX: number;
    wrapXSub: number;
    wrapYAdd: number;
    /** the Y bias the draw adds (`addiu $v1, 0x100`). */
    yBias: number;
    /** the tile period: 0x200 across, 0x100 down. */
    periodX: number;
    periodY: number;
    /** the packed cue the first decelerating tick plays (0x340003). */
    sound: string;
    /** the browser sheet that holds the two pictures. */
    sheet: string;
    /** per shape set: where its half is drawn, and the wrap copy's x. */
    sheets: ScrollLayerSheet[];
}

/** One shape set's half of the scenery strip, as the draw places it. */
export interface ScrollLayerSheet {
    /** the TMPK sub-entry the picture was cut from (2 or 4). */
    member: number;
    /** the x this half is drawn at when the object's x is zero. */
    drawX: number;
    /** the x its wrap copy is drawn at (one period away). */
    wrapX: number;
    /** the y its wrap copy is drawn at (+0x100). */
    wrapY: number;
}

/** The live words the `scroll-layer` object keeps. */
export interface ScrollLayerState {
    /** obj+0x4: the visit word. 0 = first visit (slides), 1 = revisit (still). */
    visit: number;
    /** obj+0x50: the x accumulator, 8.8. */
    xAcc: number;
    /** obj+0x54: the y accumulator, 8.8. */
    yAcc: number;
    /** obj+0x58: the x speed, 8.8 (`addiu $v0, -0x10` decays it). */
    xSpeed: number;
    /** obj+0x5c: the y speed, 8.8 (half the x speed). */
    ySpeed: number;
}

/**
 * The `ride-walker` configure handler (wstag415 file 0xbac).  The five SETANIM
 * subs it answers are 817 (reset the fall), 818, 819 and 820 (each plays its
 * cue, rewinds the one-shot cursor to its own script's first entry, and selects
 * its sub); every other operand -- 816's prewarm included -- is consumed and
 * dropped, which is the original's return arm.  Returns true either way.
 */
export function fireRideWalker(a: PointActor, subId: number): boolean {
    const m = a.member.rideWalker;
    if (!m) return true;
    const arm = m.configure[String(subId)];
    if (!arm) return true;
    if (arm.cue) playSound(a, arm.cue);
    if (arm.reset) {
        // 817 (file 0xc00-0xc20): X = 0x9600, Y = 0xe600, vel = 0, drift = 0,
        // counter = 0.  The whole-pixel copies are NOT set here -- the first
        // integrator tick publishes them.
        a.ride.xFixed = m.startX;
        a.ride.yFixed = m.startY;
        a.ride.vel = 0;
        a.ride.xDrift = 0;
        a.ride.counter = 0;
    }
    if (arm.rewind) {
        // The arm reloads the cursor's entry and hold from its own script's
        // first entry (`sh $zr, 0x74` / `lhu $v1, <script+2>` / `sh $v1,
        // 0x76`), which is what makes a re-fired sequence start over.
        const script = scriptOf(a.member, arm.rewind);
        a.ride.cursor.entry = 0;
        a.ride.cursor.hold = script[0]?.[1] ?? 0;
    }
    a.ride.sub = arm.sub;
    if (arm.clearCtr) a.ride.ctr = 0;
    return true;
}

/**
 * The stage entry's OWN spawn (wstag415 file 0xcec, called by the overlay's
 * scene entry at file 0x11a0).  The same object as the registry constructor
 * builds, but obj+0x4 = 1, so state 0 starts it on the rail (Y = 0x1ae00)
 * instead of in the air.  The translated route does not run the overlay's
 * scene entry today, so nothing in the game calls this yet; it is the second
 * spawn the decode carries, and the tests exercise both routes.
 */
export function spawnRideWalker(
    stageId: string,
    effectId: number,
    route: number,
): PointActor | null {
    const member = tables[stageId]?.[String(effectId)];
    if (!member || member.machine !== "ride-walker") return null;
    const list = (runtime[stageId] ??= []);
    let actor = list.find((x) => x.member.id === effectId);
    if (!actor) {
        actor = createPointActor(member);
        list.push(actor);
    }
    actor.ride.route = route;
    return actor;
}

/**
 * The write-back every state-1 arm ends with (wstag415 file 0xb70-0xb98):
 * record+4 = obj+0x50, record+0xa = obj+0x54, record+0 = 1, record+0xc =
 * obj+0x58.  `obj+0x5c` is the record the state-0 claim parked; when the claim
 * matched nothing it is null and nothing is written.
 */
function writeBackRide(a: PointActor, host: PointHost): void {
    const index = recOf(a, 0);
    if (index === null) return;
    host.write(index, {
        sprite: a.arm & 0xff,
        active: 1,
        x: a.ride.x,
        y: a.ride.y,
    });
}

/** The fall integrator (wstag415 file 0x8b8-0x978). */
function fallRide(
    a: PointActor,
    delta: number,
    m: PointRideWalker,
): void {
    const r = a.ride;
    // file 0x8cc-0x8e4: vel += (3 << 4) * delta.  The integrator reads the
    // frame delta RAW -- only the shared stepper clamps it to 4.
    r.vel += delta * m.accel;
    r.xFixed += r.xDrift; // file 0x8f4: X += the drift, which is only ever 0
    r.yFixed += r.vel; // file 0x8f8: Y += vel
    r.x = r.xFixed >> 8; // file 0x900-0x918
    r.y = r.yFixed >> 8; // file 0x908-0x90c
    if (r.y >= m.boundPx) {
        // file 0x910: the rail reached; snap, cue, rebound.
        r.yFixed = m.boundY; // file 0x91c-0x924
        r.y = m.boundPx; // file 0x938
        if (r.vel >= m.cueVel) playSound(a, m.fallCue); // file 0x930-0x950
        // file 0x954-0x974: vel = -(vel / 3), truncating -- the same
        // `-trunc(v / divisor)` the falling rocks rebound with.
        r.vel = -Math.trunc(r.vel / m.divisor);
    }
    r.counter += 1; // file 0x978
}

/**
 * One blank of the `ride-walker` (wstag415 file 0x778).  The dispatch is the
 * overlay's own: state 1 runs the sub table and writes back; states 2 and 3
 * return without a write; state 0 -- or any state above 3 the unsigned
 * `sltiu` lets fall through -- runs the setup and the claim once.
 */
export function tickRideWalker(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member.rideWalker;
    if (!m) return;
    const r = a.ride;
    if (a.state === 1) {
        const sub = m.subs[r.sub >>> 0];
        if (!sub) {
            // `sltiu $v0, $v1, 0x5` fails: the tick jumps straight to the
            // write-back, the last sprite still in obj+0x50.
            writeBackRide(a, host);
            return;
        }
        if (sub.kind === "sprite") {
            a.arm = sub.sprite ?? 0;
        } else if (sub.kind === "fall") {
            a.arm = sub.sprite ?? 0;
            fallRide(a, delta, m);
        } else {
            const v = stepPointRecordCursor(
                r.cursor,
                scriptOf(a.member, sub.script),
                { variant: "hold-u16", delta },
            );
            a.arm = v;
            for (const cue of sub.cues ?? []) {
                if (v === cue.clip && r.ctr === cue.ctr) {
                    playSound(a, cue.sound);
                    if (cue.resetDivider) r.divider = 0;
                    r.ctr += 1;
                }
            }
            if (sub.periodic && sub.periodic.ctrs.includes(r.ctr)) {
                r.divider += 1;
                if ((r.divider & sub.periodic.mask) === 0) {
                    playSound(a, sub.periodic.sound);
                    r.divider = 0;
                    r.ctr += 1;
                }
            }
        }
        writeBackRide(a, host);
        return;
    }
    if (a.state === 2 || a.state === 3) return;
    // state 0 (and >= 4): the setup, the claim and ADV_STATE.
    r.xFixed = m.startX;
    if (r.route === 0) {
        // the registry constructor's route (file 0x7a8-0x7d8)
        r.yFixed = m.startY;
        r.sub = 0;
        r.vel = 0;
        r.xDrift = 0;
        r.counter = 0;
    } else {
        // the scene entry's constructor route (file 0x7f4-0x818): the whole
        // pixels are set here too, and 0x6c/0x68 are not touched.
        r.yFixed = m.startYEntry;
        r.counter = 0;
        r.sub = 0;
        r.x = r.xFixed >> 8;
        r.y = r.yFixed >> 8;
    }
    // The claim's park (file 0x7dc-0x7f0).  The disc stores obj+0x54 and then
    // obj+0x58 into record+0xa -- BOTH into the X halfword, so the second
    // store wins; record+0xc is not parked.  Reproduced as read.
    const index = recOf(a, 0);
    if (index !== null) {
        host.write(index, { x: r.x });
        host.write(index, { x: r.y });
    }
    advanceState(a);
}

// ── arm 11: scroll-layer (s415 0x32c) ──────────────────────────────────────
//
// The Deeper Crevice's scenery layer, read out of wstag415 (overlay base
// 0x800a5de0; tick file 0xeac = RAM 0x800a6c8c, draw file 0xd24 = 0x800a6b04,
// spawner file 0x10e0, scene entry file 0x11e0/0x11a0, configure file 0x10a8)
// and confirmed against a live first-arrival capture.  Every number below is
// re-mined from the shipped image by tools/extract_scroll_layers.py
// (`--check` green), never hand-copied into the table.
//
// WHAT A PLAYER SEES.  Stage s415 ("East Sector -- Deeper Crevice") puts the
// player on a fixed platform (a gondola) and makes the world look like it is
// moving by SLIDING the crevice's own scenery -- the rock wall with its pipes,
// rails and struts -- across the screen behind the platform.  On a first visit
// the picture slides up and to the right for a couple of seconds and then eases
// to a stop; on a later visit the same object is built but stays put, so the
// crevice is a still backdrop.  It is background scenery, not a surface the
// player travels over: the platform never moves.
//
// THE OBJECT.  It is a 0x60-byte object the STAGE builds itself (the registry
// record 0x32c has a NULL constructor; the scene entry calls the allocator
// F0x800143dc at file 0x1100 and stores the visit word at obj+0x4).  It claims
// no point record and draws no point sprite: its draw paints two shape sets.
//
// THE GATE.  The scene entry (file 0x1150-0x11bc) runs only while the master
// story ordinal `[0x8004b370]` is 6, and it reads story flag 0x4018 to choose
// the visit.  The flag is set by the arrival cutscene itself, so a genuine
// first arrival arrives with it CLEAR and slides; every later arrival has it SET
// and stays still.  This is the port's OWN story-flag mechanism
// (`setScrollLayerFlag`, wired to the same store `web/game.js` gates on), read
// once at construction, exactly as the scene entry reads it once.
//
// THE TWO STATES (tick file 0xeac, `state = obj+0xc`):
//
//   state 0 (file 0xee0) draws the scenery at rest, advances the state, and
//     `ADV_CLIP`s ONLY when the visit word obj+0x4 is non-zero (a revisit) --
//     so a revisit starts with clip 1 and a first visit with clip 0.
//   state 1 (file 0xfb8) is the slide:
//     - clip != 1 (file 0xfd0): set x speed 0x800 and y speed 0x400.  NOTHING
//       decays here, so the picture slides a constant 8 px right / 4 px up per
//       tick until something moves it to clip 1.
//     - clip == 1 (file 0xfe4): on the first tick whose speed is still 0x800
//       play packed cue 0x340003; then (file 0x1008) speed -= 0x10, y speed =
//       speed >> 1, both clamped to 0 -- the ease-to-stop.
//     - then move: x += speed, y -= y speed, and wrap when x > 0x1FFFF
//       (x -= 0x20000, y += 0x10000), and draw through `F0x800a6b04`.
//   states 2 and 3 draw nothing.
//
// A REVISIT SLIDES NOTHING because its clip is 1 from its first scroll tick,
// its speed never leaves 0, and 0 - 0x10 is clamped back to 0: the position
// stays at the zero the factory set and the speed stays 0.
//
// THE EASE IS DRIVEN BY THE CUTSCENE.  The configure handler (file 0x10a8)
// answers ONE sub -- 0x336 (822), calling setClip(1).  The arrival event 150
// fires `SETANIM 812 822 812` after its `WAIT 180`, and the return event 151
// fires `SETANIM 812 822 1` at once.  So a first visit's constant slide runs
// until the event's 822 and then eases; a revisit is already at clip 1.  The
// event route already exists (`fireStageObject` -> `firePointRecordActor`), so
// nothing here is s415-specific beyond the table.
//
// THE DRAW (file 0xd24) is exact: sheet A is TMPK sub-entry 2 and sheet B
// sub-entry 4, both shape id 0 (the 14-byte frame table the extractor cuts),
// page/CLUT set per sheet, A at (x, y) with a wrap copy at (x - 0x200,
// y + 0x100) and B at (x + 0x100, y) with a wrap copy at (x - 0x100,
// y + 0x100), where x = obj+0x50 >> 8 and y = (obj+0x54 >> 8) + 0x100.  Side by
// side the two halves are one 512-px strip, and the crop of that pair is
// EXACTLY two blits of the combined strip: one at (x, y) and one at
// (x, y + 0x100).  `scrollLayerDraws` hands the browser those coordinates.

/**
 * The `scroll-layer` configure handler (wstag415 file 0x10a8).  It answers ONE
 * sub: `li $v0, 0x336` / `bne $a1, $v0` / `obj+0x2c(1)` = setClip(1), which is
 * what starts the ease.  Every other operand returns untouched, which is still
 * "the id was consumed".  Returns true either way.
 */
export function fireScrollLayer(a: PointActor, subId: number): boolean {
    const m = a.member.scrollLayer;
    if (!m) return true;
    if (subId === m.configureSub) setClip(a, 1);
    return true;
}

/**
 * One blank of the `scroll-layer` (wstag415 tick 0x800a6c8c).  The state
 * dispatch, the two clip arms, the decay, the move and the wrap are the
 * overlay's own order; `host` is unused -- this member writes no point record.
 */
export function tickScrollLayer(a: PointActor, _host: PointHost, delta: number): void {
    const m = a.member.scrollLayer;
    if (!m) return;
    const s = a.scroll;
    if (a.state === 1) {
        if (a.clip !== 1) {
            // file 0xfd0: the constant slide.  The speed is re-set every blank
            // on this arm, so nothing decays until `SETANIM 812 822` setClip(1)s
            // the object onto the other arm.
            s.xSpeed = m.speedX;
            s.ySpeed = m.speedY;
        } else {
            // file 0xfe4: the cue plays while the speed is still the full
            // 0x800, i.e. on the first decelerating tick.  Played once per
            // transition because the next tick's speed is already 0x7F0.
            if (s.xSpeed === m.speedX) playSound(a, m.sound);
            // file 0x1008: speed -= 0x10; y speed = trunc(speed / 2); both to
            // zero once the subtraction goes negative.
            if (s.xSpeed !== 0) {
                const next = s.xSpeed - m.decay;
                if (next < 0) {
                    s.xSpeed = 0;
                    s.ySpeed = 0;
                } else {
                    s.xSpeed = next;
                    s.ySpeed = next >> 1;
                }
            }
        }
        // file 0x103c: x += speed, y -= y speed, then the wrap.
        // `delta` is 1 per PAL blank; a catch-up blank runs the whole step.
        for (let i = 0; i < Math.max(1, delta); i += 1) {
            s.xAcc += s.xSpeed;
            s.yAcc -= s.ySpeed;
            if (s.xAcc > m.wrapX) {
                s.xAcc -= m.wrapXSub;
                s.yAcc += m.wrapYAdd;
            }
        }
        return;
    }
    if (a.state === 2 || a.state === 3) return;
    // state 0 (and any state above 3 the dispatch lets fall through): the
    // setup.  Both accumulators and both speeds start at zero (the allocator's
    // zero-fill), the static frame draws at (0, 0x100), then ADV_STATE and --
    // only when the visit word is non-zero -- ADV_CLIP.
    s.xAcc = m.startX;
    s.yAcc = m.startY;
    s.xSpeed = 0;
    s.ySpeed = 0;
    advanceState(a);
    if (s.visit !== 0) advanceClip(a);
}

/** One live scenery layer's draw this blank, as the browser reads it. */
export interface ScrollLayerDraw {
    /** the browser sheet that holds both pictures. */
    sheet: string;
    /** x = obj+0x50 >> 8, in whole pixels. */
    x: number;
    /** y = (obj+0x54 >> 8) + 0x100, in whole pixels. */
    y: number;
    /** the strip is redrawn this far down for its wrap copy (0x100). */
    wrapY: number;
    /** the tile period across (0x200) and down (0x100). */
    periodX: number;
    periodY: number;
    /** the visit word (0 first visit, 1 revisit), for the verifier. */
    visit: number;
    /** the live 8.8 speeds obj+0x58/0x5c, so a verifier reads the slide itself. */
    xSpeed: number;
    ySpeed: number;
}

/**
 * The scenery layers live on a stage, as the browser's draw pass reads them:
 * `{sheet, x, y, wrapY}` in whole pixels.  A stage with none returns [].
 */
export function scrollLayerDraws(stageId: string): ScrollLayerDraw[] {
    const out: ScrollLayerDraw[] = [];
    for (const a of runtime[stageId] ?? []) {
        if (a.member.machine !== "scroll-layer") continue;
        const m = a.member.scrollLayer;
        if (!m) continue;
        // states 2 and 3 draw nothing.
        if (a.state === 2 || a.state === 3) continue;
        out.push({
            sheet: m.sheet,
            x: a.scroll.xAcc >> 8,
            y: (a.scroll.yAcc >> 8) + m.yBias,
            wrapY: m.periodY,
            periodX: m.periodX,
            periodY: m.periodY,
            visit: a.scroll.visit,
            xSpeed: a.scroll.xSpeed,
            ySpeed: a.scroll.ySpeed,
        });
    }
    return out;
}
