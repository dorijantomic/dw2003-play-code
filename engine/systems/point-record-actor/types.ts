import type { PointRideWalker, PointScrollLayer, ScrollLayerState } from "./ride-scroll.ts";

// ── the shared claim ───────────────────────────────────────────────────────

/** A point-sprite placement record, the shape point_sprites.json carries. */
export interface PointRecord {
    /** record+1, the atlas byte a member claims by. */
    atlasFlag: number;
    /** record+0 as the disc ships it. */
    active: number;
    /** record+4. */
    spriteId: number;
}

// ── the shared stepper ─────────────────────────────────────────────────────

/** The animation-script end marker: `li $v0, 0xff` in every copy. */
export const POINT_RECORD_SCRIPT_END = 0xFF;

/** The pad-flash blink-off sprite value: `li $v0, 0x12c` (wstag212.s :0x2a8). */
export const POINT_RECORD_BLINK_OFF = 0x12C;

/** The stepper clamps the frame delta here (`slti $v0, $v1, 0x5`). */
export const POINT_RECORD_DELTA_CLAMP = 4;

/**
 * One 4-byte script entry.  The 0x12-byte `{s16 value, u16 hold}` form and the
 * `{s16 value, u8 delay, u8 next}` form are the same four bytes, read at
 * different widths: `h` is the halfword where the copy reads `lhu` and the
 * delay byte where it reads `lbu`, and `next` is the third byte, which only
 * wstag805's stepper ever reads (its only end arm).
 */
export type PointScriptEntry = readonly [v: number, h: number, next: number];

/** The `{entry, hold}` cursor every overlay's stepper keeps in the object. */
export interface PointCursor {
    entry: number;
    hold: number;
    /** the `rise-u8` variant's one-shot rise, in map pixels. */
    rise?: number;
}

/** Which copy of the shared routine this member's overlay carries. */
export type PointStepperVariant =
    /** u16 hold; `$a2 == 0` restarts at entry 0, `$a2 != 0` stops. */
    | "base-u16"
    /** u8 delay byte; the same two arms. */
    | "base-u8"
    /** u8 delay byte; the end entry's third byte is the next index. */
    | "follow-u8"
    /** u16 hold; 0x00ff always stops, whatever the call passes. */
    | "stop-u16"
    /**
     * u8 delay byte; the end entry's THIRD byte is a ONE-SHOT RISE in map
     * pixels which the stepper itself stores in the cursor's own `+4` word,
     * and the index goes back to 0 rather than following that byte
     * (wstag680 file 0x1a8 `lbu $v0, 0x3($s0)` / `:0x1b0 sh $zr, 0xc($s1)` /
     * `:0x1b4 sw $v0, 0x4($s1)`).  The lane's animate arm reads that word and
     * adds it to its record's Y once (`wstag680` file 0x34c/0x358), then zeroes
     * it (`:0x35c`), so a lane's end entry moves the row it drives.
     */
    | "rise-u8"
    /**
     * u16 hold; on the 0x00ff entry the cursor steps BACK one entry -- it
     * stays on the last real one -- and that entry's hold is charged on top of
     * the terminator's own, so a run ends by HOLDING its last value for ever
     * (wstag415 file 0x6f4-0x758: `addiu $s0, -0x4` / `addiu $v0, -0x1` /
     * `sh $v0, 0x14($s1)` / `lhu $v1, 0x2($s0)`).  This is the copy s415's
     * ride walker calls (`0x800a645c`), and the only one that behaves this way.
     */
    | "hold-u16";

/** What one call's third argument (`$a2`) selects on a `base-*` copy. */
export type PointEndArm = "restart" | "stop";

export interface PointStepOptions {
    /** this member's overlay copy of the routine. */
    variant: PointStepperVariant;
    /** what the call site passes in `$a2` -- ignored by `follow-u8`/`stop-u16`. */
    arm?: PointEndArm;
    /** the frame delta, already clamped by the caller. */
    delta?: number;
    /**
     * `false` for a copy that keeps the script's 0x00ff terminator on the disc.
     * The pad-flash scripts do NOT carry one (`parse_script` stops at the 0xff
     * and drops it), so their end is the cursor walking past the last entry.
     */
    terminates?: boolean;
}

// ── the table ──────────────────────────────────────────────────────────────

/** A byte a recipe can store: a literal, or one of the original's own tests. */
export type RecipeByte = number | "S" | "A" | `S?${number}:${number}` | null;

export interface PointRecipe {
    /** record+0. */
    active?: RecipeByte;
    /** record+4. */
    sprite?: RecipeByte;
    /** record+9, the palette-row offset the ambient renderer adds. */
    ctr?: RecipeByte;
    /** the script this state's arms step, by name in the member's `scripts`. */
    script?: string;
    /** written instead of the above once the sequence has ended and cleared the
     *  run flag (`obj[0x50] == 0`, wstag810.s file 0x330). */
    idle?: { active?: RecipeByte; sprite?: RecipeByte; ctr?: RecipeByte };
    /** written on the blank the stepper returns 0x00ff, when that blank differs. */
    endWrites?: { active?: RecipeByte; sprite?: RecipeByte; ctr?: RecipeByte };
    /** true for the ONE arm that tests the object's run flag (`obj[0x50]`) --
     *  s810's slot-0 state-2 arm, `beqz $v0, .L0x00000330` at wstag810.s file
     *  0x2f8.  Every other arm steps its script whatever the flag says. */
    gated?: boolean;
    /**
     * the arm ends with the object's own `+0x38` call, so the state advances
     * and the clip/counter/timer clear (EXE F0x800142ac).  This is the CLAIM
     * arm's tail in every copy of this actor: the walk walks the stage's point
     * table, parks the record it wants and then falls out through `+0x38`
     * (wstag455 file 0xdc `lw $v0, 0x38($s0)` / `:0x130 jalr $v0`;
     * wstag545 file 0x3e0 -- s545's member 0x34f -- ; wstag805 file 0x338).  The port does the walk at
     * construction, so the arm keeps only the advance.
     */
    advance?: boolean;
    /**
     * a packed sound this arm plays on ONE blank -- the blank whose own clip
     * counter equals `cueClip`.  It is the overlay's cue inside the animate
     * arm, guarded by the object's own `+0x10` (wstag545 `0x800a6184` file
     * 0x474 `lw $v0, 0x10($s0)` / `:0x47c bnez $v0` /
     * `:0x4a0 lui $a0, 0x4c` / `:0x4b4 ori $a0, 0x2` -> 0x004C0002).
     */
    cue?: string;
    /** which clip the `cue` above waits for; default 0. */
    cueClip?: number;
    /**
     * the clip this arm LATCHES once it has run -- the object's own `+0x2c`
     * setClip, which also clears the counter and the timer.  It is what makes
     * a cue that waits on the clip fire ONCE: the overlay's state-2 arm tests
     * `lw $v0, 0x10($s0)` / `bnez` and calls setClip(1) on the first pass only
     * (wstag545 file 0x474 / 0x47c / 0x498).
     */
    latchClip?: number;
    /** what this arm's call site passes in the stepper's THIRD argument: the
     *  `move_ $a2, $zr` sites take the restart arm, the `li $a2, 0x1` site takes
     *  the stop arm, and the two overlays whose stepper has no `$a2` test ignore
     *  it. */
    arm?: "restart" | "stop";
    onEnd?: { clearRunning?: boolean; state?: number };
}

export interface PointPanel {
    /** the record's atlas byte this panel claims. */
    atlas: number;
    /** the stepper header's seeded hold. */
    hold: number;
    /** the hold the command handler rewinds the first slot to (s810 only). */
    rearmHold?: number;
    /** state number -> recipe. */
    recipe: Record<string, PointRecipe>;
}

/**
 * `picture-steps` (s785 `0x327`): the one stage-object member that claims no
 * record at all and instead draws picture ids straight out of the stage's own
 * sprite directory.  Read end to end from `wstag785.s` (tick file 0x4d4,
 * configure file 0x760, the draw helper file 0x428) -- see the section at the
 * end of this file for the anchors.
 */
export interface PointPictureSteps {
    /** the counter bound every 4-blank stepper compares against (`slti $v1, 0x4`). */
    hold: number;
    /** state -> its sub-slot list and arm dispatch. */
    states: Record<string, {
        /**
         * the sub-slot bodies, in `obj+0x10` order.  `pic` draws while the
         * counter is below `hold`; `advance` is what the complete counter runs
         * (`clip` for `+0x3c`, `state` for `+0x38`); the LAST entry is the arm
         * dispatch (`arm: true`) and has no counter of its own.
         */
        subs: ({ pic: number; advance: "clip" | "state" } | { arm: true })[];
        /** the arm-word dispatch (`obj+0x50` value -> what it draws). */
        arms?: Record<string, { pic: number } | { alternate: [number, number]; shift: number }>;
    }>;
    /** SETANIM sub id -> what the configure routine does with it. */
    configure: Record<string, { arm?: number; state?: number; anchor?: boolean }>;
    /**
     * The `find` the configure routine makes: `find(5, p1, -1)`, with `p1`
     * mined from the stage's own recovered scripts (every recovered
     * `SETANIM <id> 808/809 <v2>` passes the same value, or the extractor
     * refuses), and `yOff` the draw helper's `addiu $v0, -0x18`.
     */
    anchor: { type: number; p1: number; p2: number; yOff: number };
}

export interface PointMember {
    stage: string;
    id: number;
    idHex: string;
    /** which of the per-member machines this is. */
    machine:
        | "pad-flash"
        | "decor"
        | "point-record"
        | "single"
        | "rise"
        /** `two-slot`: two explicitly compared rows and a six-arm clip machine. */
        | "two-slot"
        | "slots"
        | "parent"
        /** `triple`: a pool of FOUR-STATE row children, three makers or five. */
        | "triple"
        /**
         * `picture-steps`: s785's 0x327.  Claims NO record; draws picture ids
         * straight out of the stage's own sprite directory, stepped by a
         * four-blank counter, anchored on the character the SETANIM's second
         * operand names (`find(5, operand, -1)`).  See the section at the end
         * of this file.
         */
        | "picture-steps"
        /**
         * `ride-walker`: s415's 0x32b, the crevice ride's own actor.  Claims
         * the record carrying atlas tag 1 and drives it through five phases --
         * a still frame, a fall onto the rail with a bounce and a cue, then
         * the three roll-in sequences -- writing `{active, spriteId, X, Y}`
         * back into the claimed record every tick.  See the section at the end
         * of this file.
         */
        | "ride-walker"
        /**
         * `scroll-layer`: s415's 0x32c, the Deeper Crevice SCENERY layer -- the
         * one member of the registry that claims no point record and draws no
         * point sprite.  It slides the stage's own background art (the rock
         * wall with its pipes, rails and struts the fixed platform travels
         * past) behind everything, through the shared shape emitter.  Built by
         * the stage itself (null registry constructor), gated on story flag
         * 0x4018: a first visit slides and the arrival event's `SETANIM 812
         * 822` eases it to a stop; a revisit builds the same object but leaves
         * it still.  See the section at the end of this file.
         */
        | "scroll-layer";
    /** the per-member machine's own shape name. */
    kind?: string;
    /** this member's overlay copy of the shared stepper. */
    stepper: PointStepperVariant;
    tick: string;
    ctor: string | null;
    /**
     * `ride-walker` only: the SECOND constructor the overlay carries.  The
     * registry's construct pointer (file 0xcb8) stamps obj+0x4 = 0; the
     * overlay's own scene entry calls this one (file 0xcec), which stamps 1
     * and so starts the actor at the rail instead of in the air.  Nothing in
     * the translated route runs the scene entry today.
     */
    ctorEntry?: string | null;
    /** null means the STAGE builds the object at stage entry. */
    registryCtor: string | null;
    draw: string | null;
    /** atlas tag -> the record it claims, with the geometry it ships with. */
    tags: Record<string, {
        index: number;
        x: number; y: number; ysort: number; layer: number;
        romActive: number; romSprite: number; mode: number;
    }>;
    /** script name -> `{v, h, next}` entries. */
    scripts: Record<string, PointScriptEntry[]>;
    panels: PointPanel[];
    rearmHold?: number;
    // decor only
    seedHolds?: Record<string, number>;
    sounds?: { packed: string; case: number }[];
    scriptPtrs?: string[];
    // point-record only
    sub?: number | null;
    nextState?: number | null;
    fireSound?: string | null;
    buildSound?: string | null;
    rearm?: boolean;
    claimState?: number;
    // pad-flash only
    arm?: {
        slots?: number;
        commands?: Record<string, number>;
        coords?: [number, number][];
        yOff?: number[];
        ysortOff?: number[];
        fireSound?: string | null;
        slotSounds?: (string | null)[] | null;
        reposition?: boolean;
    };
    // `rise` only: the three numbers its own tick states, in the point
    // record's byte offsets (12 = the `s16 Y` at +0xc).  The claim takes
    // `claimShift` off it once, then `riseBy` goes back on every blank, and
    // `riseBlanks` of them stop it (`slti $v0, 0x96` on s926).
    //
    // `charYBy` is the OTHER half of the same blank, read out of the same
    // routine: s926's state 1 looks the live field character up by name and
    // adds `charYBy` to its `+0x54` -- the character's world Y in 16.8 -- every
    // blank (`wstag926` file 0x274 `lw $v1, 0x54($v0)` / `:0x27c addiu $v1,
    // 0x100` / `:0x280 sw $v1, 0x54($v0)`, in 16.8 pixels, so 0x100 = one
    // pixel).  The row and the character therefore travel together, which is
    // what makes the room scroll instead of the row sliding down the screen.
    rise?: {
        recordOffset: number;
        claimShift: number;
        riseBy: number;
        riseBlanks: number;
        /** the 16.8 fixed-point amount this member adds to the character. */
        charYBy: number;
    };
    // `slots` / `grid`: one object, N claimed records, and per slot a window
    // of the overlay's own 8-byte-entry script table (s620 `0x800a7648`).
    grid?: PointGrid;
    // `slots` / `lanes`: one object, N lane records that each step their own
    // script and drop their row by the end entry's third byte, plus traffic
    // slots that only slide (s680).
    lanes?: PointLanes;
    // `parent` only: the child array the parent's state 0 builds through the
    // shared child allocator (`tools/extract_child_pool_parents.py`).
    children?: PointParentChildSpec[];
    /** the parent's own six-arm clip table, in the overlay's table order. */
    clips?: PointParentClip[];
    // `triple` only (s460 `0x33e`, s526 `0x33d`): a parent that builds a dozen
    // FOUR-STATE row children, one machine per maker and one slot per call.
    triple?: PointTriple;
    // `picture-steps` only (s785 `0x327`): no record claim at all; the state
    // machine draws sheet pictures at a character anchor.
    pictureSteps?: PointPictureSteps;
    // `ride-walker` only (s415 `0x32b`): one claimed record, five phases, the
    // fall integrator and the three roll-in scripts.
    rideWalker?: PointRideWalker;
    // `scroll-layer` only (s415 `0x32c`): the Deeper Crevice scenery layer.  It
    // claims no record; it slides the stage's own background art at the decoded
    // speed, gated on the disc's first-visit flag.
    scrollLayer?: PointScrollLayer;
    /**
     * `triple` only: the ordinal gate under which the OWNING STAGE builds this
     * parent at load, read out of the stage's own code by
     * `tools/extract_child_pool_parents.py`.  The gate is one `slti` against
     * the master story ordinal (`wstag460` file 0x1214 `slti $v0, 0xf`, the
     * short form of `slti $v0, $v0, 0xf`, guarded by the `beqz` at 0x1218);
     * at or above `below` the stage builds nothing and the SETANIM event
     * constructs the parent itself, which leaves it UNBUILT.
     *
     * `spawnSlot` is the FIELDSTG twelve-byte spawn-table row that names the
     * poller's factory (`{factory, id, param}` at RAM 0x8009a958).  I have
     * NOT established that any instruction walks that table -- see the ORDER
     * NOTE -- so this is the citation for reachability, not a proof of it.
     */
    stageLoadGate?: PointStageLoadGate;
    // `two-slot` only (s261 `0x33b`): TWO rows claimed by explicit tag compares
    // that keep the LAST match of each, and a six-arm clip machine that drives
    // the live field character's `+0x54` with the same deltas it gives the rows.
    twoSlot?: PointTwoSlot;
    /** the registry draw word's jump table: sub id -> what its arm writes. */
    configureSubs?: Record<string, { setClip: number | null; selector: number | null }>;
    /**
     * The packed sound the configure handler plays on EVERY command, because the
     * word it tests is the one its own state 0 clears and nothing ever sets
     * (`wstag545` file 0x9bc `lw $v0, 0x54($s0)` / `:0x9c0 bnez $v0`).
     */
    configureCue?: string;
}

/** One child the parent's state 0 builds, as the extractor read it. */
export interface PointParentChildSpec {
    /** the atlas tag the child claims and which its record carries. */
    atlas: number;
    /** the map pixel the child's claim parks the record's X halfword on. */
    x: number;
    /** the map pixel the child's claim parks the record's Y halfword on. */
    y: number;
    /** the script the child steps in its state 2. */
    script: string;
    /** the hold its claim seeds -- the first entry's own hold, read from it. */
    hold: number;
    /** which copy of the shared stepper this overlay's child calls. */
    stepper: PointStepperVariant;
    /** what the child's call site passes as the stepper's THIRD argument. */
    arm: PointEndArm;
}

/** One arm of the parent's clip table. */
export interface PointParentClip {
    clip: number;
    /** `sb $zr, ($s0)`: the parent's own row goes dark on this blank. */
    hidesOwnRow: boolean;
    /** this arm calls a child's setState with 2. */
    pokesChild: boolean;
    /** this arm ends in a jump into another arm's body (the shared tail). */
    fallsInto?: number;
    script?: string;
    /** what the call site passes the stepper as its third argument (`$a2`). */
    arm?: PointEndArm;
    /** the sprite written on the 0x00ff blank, when the arm has one. */
    endSprite?: number;
    /** the clip the arm SETS itself to on that blank. */
    endClip?: number;
    /** the packed sound this arm plays. */
    cue?: string;
}

/** One live child. The words mirror the original's own child object. */
export interface PointParentChild {
    spec: PointParentChildSpec;
    /** the record the child's claim walk parked, or null when the tag is absent. */
    rec: number | null;
    cur: PointCursor;
    /** obj+0x0c: 0 claims every blank, 1 dark, 2 runs the script. */
    state: number;
}

/** One row of a `grid` member's 8-byte-entry script table. */
export interface PointGridEntry {
    /** the script this entry names, by name in the member's `scripts`. */
    script: string;
    /** the entry's `+4` halfword, which IS the stepper's third argument. */
    loop: number;
    /** the entry's `+6` halfword, the index to switch to when a script ends. */
    next: number;
}

export interface PointGridSlot {
    /** the atlas byte this slot's claim walk stopped at. */
    tag: number;
    /** the point-record row the walk parked there -- the k-th match in TABLE
     *  ORDER, which is what the original takes, not the first. */
    index: number;
    /** the object word the overlay parks this slot's fields at. */
    at: number;
    /** the script index the claim arm leaves in the slot. */
    start: number;
    /** which record byte the step value goes into. */
    write: "sprite" | "ctr";
}

export interface PointGrid {
    slots: PointGridSlot[];
    /** slot -> its four table entries, index 0 first; null where the overlay's
     *  table carries no script at that index. */
    entries: (PointGridEntry | null)[][];
    /** the one slot whose record also plays a cue, and the clip that plays it. */
    onceSlot: number | null;
    onceClip: number;
    onceSound: string;
}

export interface PointLaneSlot {
    tag: number;
    /** the point-record row the claim walk parked there, in TABLE ORDER. */
    index: number;
    /** the object word the overlay parks this slot's fields at. */
    at: number;
    /** the pointer-table row this lane steps, by name in `scripts`. */
    script: string;
}

export interface PointLanes {
    lanes: PointLaneSlot[];
    traffic: { tag: number; index: number; at: number }[];
    /** the record Y both loops stop at (`slti $v0, 0x191` = 401). */
    bound: number;
    /** pixels a blank moves a traffic row down. */
    trafficBy: number;
    /** subId -> the lane tag that subId lights. */
    lights: Record<string, number>;
    /** subId -> the traffic slot index that subId starts. */
    starts: Record<string, number>;
    /** subId -> the lane slot whose RECORD POINTER that subId clears. */
    clears: Record<string, number>;
    /** the packed sound every light plays. */
    lightSound: string;
    /** the subId that starts the live-object drive, and its own numbers. */
    driveSub: number | null;
    driveBound: number;
    driveStep: number;
}

/**
 * `two-slot` (s261 `0x33b`): TWO rows claimed by two explicit tag compares that
 * keep the LAST match of each, and a six-arm clip machine that walks both rows
 * and the live field character's world Y with the SAME delta.
 *
 * Every number here is read out of `wstag261.s` by the extractor; the machine
 * is not a formula.
 */
export interface PointTwoSlot {
    /** the two atlas tags the claim compares, in the overlay's own order. */
    tags: [number, number];
    /** the record each tag stopped at -- the LAST match, as the walk takes it. */
    records: [number, number];
    /** the Y the claim reads off each row, as the halfword offset in the record. */
    recordYOffset: number;
    /**
     * The claim's own two halfword words: `drop` is the shift a row takes once
     * when the direction word is set (`addiu $v0, -0x7f` = -127 map pixels) and
     * `dropFixed` is the same shift in the character's 16.8 fixed point
     * (`0x7f00`).
     */
    drop: number;
    dropFixed: number;
    /** the six clips' arms, in the overlay's own jump-table order. */
    clips: PointTwoSlotClip[];
    /** the per-index deltas clips 2 and 4 walk, and the value that ends them. */
    deltas: number[];
    /** the delta-table value that stops a slide (`li $v0, 0x3e8`). */
    deltaEnd: number;
    /** the blanks clip 1 waits before it lets the slide start (`slti 0x1e`). */
    waitBlanks: number;
    /** the blink's step count (`slti $v0, 0xfe`). */
    blinkSteps: number;
    /** the blink's one-pixel step in the character's 16.8 (`0x100`). */
    blinkStep: number;
    /** `subId` -> the direction word that arm writes (0 up, 1 down). */
    directions: Record<string, number>;
    /**
     * The direction word's CREATE-TIME seed (wstag261 file 0x4d0-0x4fc):
     * `li $a0, 0x1c3d` / `li $a1, 1` / get_flag / `sh v0, 0x58($s0)` (1 when
     * the flag reads set, else 0).  The claim's 127-pixel drop is gated on that
     * word, so a stage whose flag is set at construction is born with both rows
     * a lift-height up.  The shipped s261 scripts only ever fire 840/841, whose
     * arms set the word themselves before any tick, so this is the one path a
     * claim can see the seed on.
     */
    seedFlag?: { id: number; arg: number };
    /** the packed cue clip 0 plays, and the one clip 1 plays. */
    startSound: string;
    waitSound: string;
}

/** One arm of the `two-slot` clip machine, named for what it does. */
export type PointTwoSlotClip =
    | "start"
    | "wait"
    | "slide"
    | "blink"
    | "darken";

/**
 * THE `triple` pool: one parent whose state 0 builds a dozen child OBJECTS, each
 * of which is a four-state row actor with its own claim walk and its own copy of
 * the shared stepper.  Two members -- s460 `0x33e` and s526 `0x33d` -- and one
 * shape; every number is read out of the two overlays by
 * `tools/extract_child_pool_parents.py`.
 *
 * The parent's state 0 calls one maker per child, and the i-th pointer goes into
 * the i-th slot of the companion array the allocator gave it
 * (`F0x800143dc`: `+0x20` is the entry count and `+0x24` the base, from the third
 * argument `li $a2, 0x24` / `li $a2, 0x30`).  Its state 2 pokes the i-th slot, so
 * the slot list IS the parent's own order and the walker's order.
 */
/**
 * The gate under which a stage builds its own `triple` parent at load.
 * Every field is read out of the overlay's own code; none is a constant here.
 */
export interface PointStageLoadGate {
    /** the master story ordinal, `[0x8004b370]`, as `lui 0x8005` + `lw -0x4c90`. */
    ordinal: string;
    /** the gate: the parent is built only while the ordinal is BELOW this. */
    below: number;
    /** the one-shot object's tick that runs the gate. */
    pollerTick: string;
    /** its own file address of the `slti`. */
    gateAt: string;
    /** its own file address of the `beqz` that skips the build. */
    branchAt: string;
    /** its own file address of the `jal` into the member's registry ctor. */
    buildAt: string;
    /** the routine that allocates the poller, or null when nothing builds it. */
    pollerFactory: string | null;
    /** the FIELDSTG spawn-table row naming that factory, or null. */
    spawnSlot: { factory: string; id: number; param: number; file: string; ram: string } | null;
}

export interface PointTriple {
    /** the sub id the parent's own draw handler answers (844 / 843). */
    draw: number;
    /** `subId` -> the state it sets, read off the handler's own `jalr` delay slot. */
    configureSubs: Record<string, { setState: number }>;
    /** the companion array's entry count, the allocator's third argument. */
    childSlots: number;
    /** one entry per MAKER: how many children that maker builds. */
    machines: PointTripleMachine[];
    /** one entry per child, in the parent's build order. */
    children: PointTripleChild[];
    /** `addr` -> the byte tables an arm reads by its row index. */
    byteTables: Record<string, number[]>;
}

/** One maker's child MACHINE, shared by every child that maker builds. */
export interface PointTripleMachine {
    /** the child's own tick -- the first argument to its allocator. */
    tick: string;
    /** the child's object size, the allocator's second argument. */
    size: number;
    stepper: PointStepperVariant;
    makes: number;
    /** the rows the claim parks, in the overlay's own order. */
    rows: { tagSource: Record<string, number>; at: number; copies: PointTripleCopy[] }[];
    /** what the claim parks at the child's `obj+0x50`, its one-based selector. */
    selector: { const?: number; from?: string };
    /** state 1's arm: the script it restarts and what it writes. */
    restart: PointTripleArm;
    /** state 2's arm: the script it stops on and what it writes. */
    stop: PointTripleArm;
    /** true when the machine carries the heading/speed integrator. */
    walks: boolean;
    /** the integrator's own field offsets, when `walks`. */
    walk?: PointTripleWalk;
    /** the claim's three parked words, when `walks`. */
    seed?: { period?: { const: number }; counter?: { copyWord: number };
             speed?: { halfAt: string; fromByte: number; shift: number } };
    /** the speed table, one halfword per stamped group. */
    speeds?: number[];
}

/** One of the claim's `record word -> object word` copies. */
export interface PointTripleCopy {
    record: number;
    object: number;
    shift: number;
}

/** One of a child's two animate arms. */
export interface PointTripleArm {
    rows: number;
    mode: "stepper" | "constant";
    /** which end arm the call site passes the stepper. */
    arm?: PointEndArm;
    script?: string;
    /** the value the arm stores into the record's `+0` byte. */
    active?: { const: number };
    /** the record's `+4`: a literal, a byte table by row index, or a row move. */
    clip?: { const?: number; byteTable?: string; index?: string; offset?: number;
             movesRow?: boolean; x?: number; y?: number };
    /** the record's `+9`: `"step"`, or a literal. */
    palette?: "step" | { const: number } | null;
}

/** The walking children's own position words, in the overlay's offsets. */
export interface PointTripleWalk {
    /** the blank counter (obj+0x70) and the step period (obj+0x72). */
    phase: number;
    period: number;
    /** the speed (obj+0x74) and the heading (obj+0x76). */
    speed: number;
    seed: number;
    /** the 16.8 position (obj+0x64 / 0x68) and its whole-pixel copy (0x6c / 0x6e). */
    xFixed: number;
    yFixed: number;
    xPixel: number;
    yPixel: number;
    /** the target the claim copied out of the record (obj+0x5c / 0x60). */
    targetX: number;
    targetY: number;
    /** the Manhattan distance past which the child steps (obj+0x1e = 30). */
    radius: number;
    rsin: string;
    rcos: string;
    /** the `andi 0xfff` mask the angle is folded through. */
    quarterTurn: number;
    /** the `addiu -7` bias on the counter's jitter, and its `andi 0xf` mask. */
    reset: number;
    jitterMask: number;
}

/** One CHILD: which machine, its own stamped arguments and its claimed rows. */
export interface PointTripleChild {
    machine: number;
    /** the child array slot the parent's state 0 filled and state 2 pokes. */
    arraySlot: number;
    /** the maker's three arguments: the slot, the group and the kind. */
    args: { a1: number | null; a2: number | null; a3: number | null };
    /** the record each claimed row is, with the tag the claim looked for. */
    rows: { tag: number; index: number | null }[];
    /** what the parent's state 2 stores into it: the selector and the counter. */
    poke: { selector: number; hold?: number; wait?: number };
}

export interface PointActorTable {
    summary?: {
        members?: number;
        stages?: number;
        machines?: Record<string, number>;
        anchorsChecked?: number;
    };
    /**
     * The family's one non-member row set: stage-entry MODE writers (the s421
     * actor).  Optional so the sibling tables (child pools, scroll layers) can
     * load through the same function.
     */
    modeGates?: { stage: string; tag: number; flag: number }[];
    stages: Record<string, Record<string, PointMember>>;
}

/** What a driver asks the record table to change this blank. */
export interface PointPatch {
    active?: number;
    sprite?: number;
    ctr?: number;
    x?: number;
    y?: number;
    ysort?: number;
}

/** A record's live state, for the member that waits on `ctr`. */
export interface PointLive {
    sprite: number;
    ctr: number;
    x: number;
    y: number;
    ysort: number;
}

/** The record table the actors drive. */
export interface PointHost {
    write(index: number, patch: PointPatch): void;
    read(index: number): PointLive;
    /** Packed sound id, exactly as the original passes it to the player. */
    sound?(packed: number): void;
    /**
     * The live field character's world Y in 16.8 fixed point -- fieldstg's
     * resident object registered as name 5, whose `+0x54` s261 reads and writes
     * and s680 and s926 add to.  Absent when the stage has no field character
     * to drive, and then the arms that write it do nothing.
     * See engine/systems/field-character.ts.
     */
    charY?(): number;
    setCharY?(fixed: number): void;
    /**
     * `picture-steps` only: the overlay's own `find` -- `[0x8004b7bc]` =
     * EXE F0x8001810c, the hundred-slot resident-object walk, matching +0x0
     * against `type` and +0x4 against `p1` (-1 = any; see the section at the
     * end of this file).  Returns a handle the position call can re-resolve,
     * or null when no such object is live.
     */
    anchor?(type: number, p1: number, p2: number): number | null;
    /** That found object's world position in whole pixels, or null. */
    anchorPos?(handle: number): { x: number; y: number } | null;
}

// ── the live objects ───────────────────────────────────────────────────────

/** One live member.  The words mirror the original's object. */
export interface PointActor {
    member: PointMember;
    /** obj+0x0c */
    state: number;
    /** obj+0x10 */
    clip: number;
    /** obj+0x14 */
    counter: number;
    /** obj+0x18 */
    timer: number;
    /** the word the overlay's own arm reads (obj+0x50 / obj+0x52 / obj+0x58). */
    arm: number;
    /** the word only an UNREGISTERED builder stamps. */
    mode: number;
    /** claimed record index per slot, in the overlay's order. */
    rec: (number | null)[];
    /** one stepper cursor per slot. */
    cur: PointCursor[];
    /** s800's arm-words, one per pass. */
    armed: boolean[];
    /** the `grid` shape's per-slot script index (`obj+0x50`, `+0xc` per slot). */
    index: number[];
    /** s810's `obj[0x50]`: the handler sets it, the sequence clears it. */
    running: boolean;
    /** the pad-flash run's pad, once a command has named it. */
    pad: { x: number; y: number; command: number } | null;
    /** `parent` only: the child array, in the parent's own build order. */
    children: PointParentChild[];
    /** `triple` only: the child pool, in the parent's own build order. */
    pool: TripleChildState[];
    /**
     * `parent` only, obj+0x50: which child the next poke hits, ONE BASED
     * (`lw $v0, 0x50($s3)` / `beqz` / `addiu $v0, -1` / `sll $v0, 2` /
     * `addu $v0, $s1, $v0`, wstag545 file 0x950-0x964). Zero means "none", and
     * the poke is skipped rather than indexing before the array.
     */
    selector: number;
    /** `triple` only: the parent's state 0 has built the pool.  The children are
     *  separate objects on the disc, so they do not tick before their maker ran. */
    built: boolean;
    /** PAL blanks this actor has been advanced by. */
    blanks: number;
    /** the `rise` shape's own blank counter, the word the original keeps at
     *  obj+0x54 (`lw $v1, 0x54($s1)` / `addiu $v1, 0x1` / `sw $v1, 0x54($s1)`,
     *  wstag926 file 0x264-0x270).  `blanks` is the driver's own tally and is
     *  bumped before every arm, so the shape cannot use it. */
    count: number;
    /** `two-slot`: the blank counter clip 1 counts up to its bound
     *  (`lw $v1, 0x5a($s0)` / `addu $v1, $v0` / `sh $v1, 0x5a($s0)`,
     *  wstag261 file 0x1ec-0x1f8). */
    wait: number;
    /** `two-slot`: the per-index cursor clips 2 and 4 walk
     *  (`lhu $v1, 0x5c($s0)` / `sll $v1, 0x1`, wstag261 file 0x244-0x254). */
    cursor: number;
    /**
     * `two-slot`: the five Y words this member saves, indexed by the original's
     * own object offsets -- 0 the tag-3 row at clip 0 (obj+0x60), 1 the tag-2
     * row at clip 0 (obj+0x62), 2 the live character's `+0x54` at clip 0
     * (obj+0x64), 3 and 4 the two rows as the CLAIM saved them (obj+0x68 /
     * 0x6a).  A tuple rather than a record so an index cannot be misnamed.
     */
    saved: [number, number, number, number, number];
    /**
     * `slots` / `lanes`: the live-character drive's own three words -- the flag
     * at obj+0x148, the phase halfword at obj+0x14a and the counter at obj+0x144.
     * Only s680's member carries them, and its configure arm is the only thing
     * that sets the flag (wstag680 file 0x568 `sh $v0, 0x148($s0)`, in the `j`'s
     * delay slot, for SETANIM 814 891).
     */
    drive: { on: boolean; phase: number; count: number };
    /**
     * `picture-steps` only: the picture this frame's arm drew (null before the
     * first draw, or when the anchor is not live), the `+0x4` filter value the
     * configure routine's `find(5, p1, -1)` stored at obj+0x54, and that
     * character's world position in whole pixels as the host resolved it this
     * blank.
     */
    pic: number | null;
    anchor: number | null;
    anchorPos: { x: number; y: number } | null;
    /**
     * `ride-walker` only: the words the overlay keeps in the object's own
     * fields -- obj+0x4 (which constructor built it), obj+0x72 (the state-1
     * sub), obj+0x10 (the cue counter) and obj+0x14 (the periodic divider),
     * obj+0x60/0x64 (the 16.8 position the integrator moves), obj+0x68 (the
     * X drift, only ever cleared), obj+0x6c (the Y velocity), obj+0x70 (the
     * integrator's blank counter), obj+0x54/0x58 (the whole-pixel copy the
     * write-back publishes) and obj+0x74/0x76 (the one-shot stepper's cursor,
     * which is obj+0x60's `+0x14`/`+0x16` -- the shared stepper reads it at
     * those displacements).
     */
    ride: {
        route: number;
        sub: number;
        ctr: number;
        divider: number;
        xFixed: number;
        yFixed: number;
        xDrift: number;
        vel: number;
        x: number;
        y: number;
        counter: number;
        cursor: PointCursor;
    };
    /**
     * `scroll-layer` only: the four words the scenery layer keeps -- the visit
     * word obj+0x4 and the two 8.8 accumulators obj+0x50/0x54 with their speeds
     * obj+0x58/0x5c.  The draw reads the whole-pixel part of the accumulators.
     */
    scroll: ScrollLayerState;
}

/**
 * One live `triple` child.  The words mirror the original's object: the four
 * method slots are `state` / `clip` / `counter` / `timer`, the child's own
 * selector is `arm`, and `words` holds the overlay's own offsets.
 */
export interface TripleChildState {
    spec: PointTripleChild;
    machine: PointTripleMachine;
    state: number;
    clip: number;
    counter: number;
    timer: number;
    /** the child's `obj+0x50`. */
    arm: number;
    /** one stepper cursor per claimed row. */
    cur: PointCursor[];
    /** the object's own words, keyed by the overlay's file offsets. */
    words: Record<number, number>;
}
