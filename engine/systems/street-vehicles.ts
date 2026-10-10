// Street vehicles — the cars that drive across a city street while a broadcast
// plays on the corner screens, and the traffic-light glows the broadcast object
// draws above them.
//
// Ported from the original's per-stage native code, all of it in the Kusanagi
// City street corner overlay (wstag780.s, loaded at 0x800a5de0):
//
//   * the broadcast object      0x800a6dc4 (file 0xfe4) — created by the
//     effect-registry dispatcher 0x800a6f40 (file 0x1160) for ids 0x320/0x324,
//     which is what the stage script's `SETANIM 800 …` fires.
//   * its steady-state arm      0x800a1034-0x800a112c — the three phases and the
//     direction cycle, then the two draws below.
//   * the street-prop drawer    0x800a6b4c (file 0xd6c) — three groups of glow
//     sprites whose clip and height are picked by those direction flags.
//   * its car-spawn driver      0x800a6a04 (file 0xc24)
//   * the car spawner           0x800a605c (file 0x27c)
//   * the car tick + draw       0x800a5ec0 (file 0xe0) / 0x800a5de0 (file 0x0)
//
// The object identity is the tick passed to the allocator: `F0x800143dc` /
// `F0x80014504` install their argument as the object's tick callback, so
// 0x800a5ec0 is *the* car object and 0x800a6dc4 is the broadcast that owns the
// four car slots (its 0x10-byte extra buffer is exactly four pointers).
//
// Decode with every asm line quoted:
// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
//
// Object layout, as the original's own code reads it:
//
//   broadcast +0x0c  state          +0x10  sub1 — the phase (0, 1 or 2)
//               +0x14  the phase-1 timer, 0x79 blanks long
//               +0x50  the phase-0 direction flag (0, 1 or 2)
//               +0x54  the phase-1 direction flag (0, 1 or 2)
//               +0x58  gate A       +0x5c  gate B
//   car      +0x0c  state          +0x50  dir-y flag   +0x54  dir-x flag
//               +0x58  parked       +0x5c  variant     +0x60  sprite id
//               +0x64  anim ctr     +0x68  x (24.8)    +0x6c  y (24.8)
//
// +0x50 and +0x54 are NOT booleans. They cycle 1 -> 0 -> 2 and the tick
// normalises 2 back to 1 on entry (file 0x1078), and they are what the
// street-prop drawer switches on — so a port that stores them as 0/1 changes
// which lamp is lit.

import { STREET_VEHICLE_TABLES } from "../dw3/street-vehicle-tables.ts";

/** The effect-registry entry that constructs the broadcast object
 *  (fieldstg's registry at 0x8009b3e8, record 0: ctor 0x800a6f8c). */
export const BROADCAST_EFFECT_IDS: readonly number[] = [0x320];

/** The stage script's SETANIM is `SETANIM <registry id> <sub id> <arg>`: the
 *  fieldstg handler looks the object up by the first halfword and hands the
 *  SECOND one to the stage's dispatcher 0x800a6f40, which compares it against
 *  these two and stores 1 for 0x320 / 0 for 0x324 (file 0x116c-0x1178). */
export const BROADCAST_SUB_ONE = 0x320;
export const BROADCAST_SUB_ZERO = 0x324;

/** Per-frame travel, in the original's 24.8 fixed point (file 0x150-0x18c). */
export const VEHICLE_STEP_X = 0x500; // 5 px per frame along x
export const VEHICLE_STEP_Y = 0x280; // 2.5 px per frame along y
/** Animation counter wraps at 8 (file 0x1b4-0x1c0). */
export const VEHICLE_ANIM_MOD = 8;
/** Off-screen test in the same fixed point (file 0x224-0x234, 0x244-0x250). */
export const VEHICLE_CULL_X = 0x27fff;
/** How long the phase-1 arm holds before it flips and moves on
 *  (`slti $v1, 0x79`, file 0x10b0). */
export const BROADCAST_PHASE_FRAMES = 0x79;
/** The sprite a parked car shows (file 0x1dc, 0x3b). */
export const PARKED_SPRITE = 0x3b;

/** The street-prop drawer's three glow positions, as its own immediates read
 *  them. Each group is one column of a three-phase lamp: the drawer's arm on
 *  the flag picks the row, and the arm is
 *  `flag == 1 -> the middle row`, `flag == 0 or >= 3 -> the first`,
 *  `flag == 2 -> the last` (file 0xde8-0xe08 and the two repeats at 0xe8c and
 *  0xf30). Read live: with flag 0x50 = 2 and 0x54 = 0 the original drew clip
 *  70 at (198,196), clip 70 at (342,268) and clip 65 at (234,179) — the last
 *  row of groups 1 and 2 and the first row of group 3. */
export interface StreetPropGroup {
    /** Which object flag selects this group's row. */
    flag: "dirY" | "dirX";
    /** Clip id per row: the first, the middle, the last. */
    clips: readonly [number, number, number];
    /** Map pixel x, the same for all three rows. */
    x: number;
    /** Map pixel y per row. */
    y: readonly [number, number, number];
}

/** `li $a2, 0xc6` / `0x156` / `0xea` and `li $a3, 0xb3` / `0xbc` / `0xc4`
 *  (file 0xe20-0xe80, 0xec4-0xf24, 0xf68-0xfc8). */
export const STREET_PROP_GROUPS: readonly StreetPropGroup[] = [
    { flag: "dirY", clips: [0x44, 0x45, 0x46], x: 0xc6, y: [0xb3, 0xbc, 0xc4] },
    { flag: "dirY", clips: [0x44, 0x45, 0x46], x: 0x156, y: [0xfb, 0x104, 0x10c] },
    { flag: "dirX", clips: [0x41, 0x42, 0x43], x: 0xea, y: [0xb3, 0xbc, 0xc4] },
];
/** The ordering-table bucket the drawer sets (`li $a1, 0x2`, file 0xd94). */
export const STREET_PROP_LAYER = 2;

/** The row a direction flag selects: 1 is the middle, 2 the last, anything else
 *  (0, and the >= 3 the arms also fall into) the first. */
export function streetPropRow(flag: number): 0 | 1 | 2 {
    return flag === 1 ? 1 : flag === 2 ? 2 : 0;
}

export type RandBit = () => number;

/** One spawn recipe: the four arguments the spawner is called with, and which
 *  slot of the broadcast's extra buffer receives the result. */
interface Recipe {
    slot: number;
    a0: number;
    a1: number;
    a2: number;
    /** -1 -> take the variant from the game's random bit (`andi $a3, $v0, 0x1`,
     *  file 0xc68); otherwise the literal the call passes in a2 or a0. */
    variant: number;
}

// The driver's six fill attempts, in the original's order (file 0xc38-0xd54).
// Gate A runs when broadcast[+0x58] != 0; gate B when broadcast[+0x5c] != 0.
// Each attempt runs only while ITS OWN slot pointer is zero (a `bnez` on the
// slot word): gate A writes slots 0 `(0,0,0,rand&1)` and 3 `(1,1,0,0)`
// (file 0xc48-0xca0), and gate B writes slots 0 `(0,0,1,0)`, 3 `(0,0,1,1)`,
// 1 `(1,0,0,0)` and 2 `(0,1,0,rand&1)` (file 0xcac-0xd54). The four slots are
// the broadcast's whole 0x10-byte extra buffer; nothing clears a slot, so a
// culled car keeps its slot and the street is not refilled for that phase.
const GATE_A: readonly Recipe[] = [
    { slot: 0, a0: 0, a1: 0, a2: 0, variant: -1 },
    { slot: 3, a0: 1, a1: 1, a2: 0, variant: 0 },
];
const GATE_B: readonly Recipe[] = [
    { slot: 0, a0: 0, a1: 0, a2: 1, variant: 0 },
    { slot: 3, a0: 0, a1: 0, a2: 1, variant: 1 },
    { slot: 1, a0: 1, a1: 0, a2: 0, variant: 0 },
    { slot: 2, a0: 0, a1: 1, a2: 0, variant: -1 },
];

export interface StreetVehicle {
    /** 24.8 fixed point, exactly as the original keeps it. */
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    parked: boolean;
    variant: number;
    ctr: number;
    sprite: number;
    state: number;
    /** False until the car has run one full tick. Its first tick only advances
     *  the state word and returns before the draw (file 0x110-0x120), so the
     *  original does not put it on the canvas on the blank it is created. */
    armed: boolean;
}

export interface StreetBroadcast {
    /** The tick's phase word, +0x10. Reached 2 by the phase-1 arm's own
     *  `advanceSub1`, not by any opcode: the announcement's `SETANIM 800 800`
     *  stores 1, and 0x79 blanks later the arm flips the flags and moves on. */
    phase: number;
    /** The state-0 arm has run. */
    primed: boolean;
    /** The phase-1 timer, +0x14. */
    timer: number;
    /** +0x50 — the prop drawer's first selector, 0, 1 or 2. */
    dirY: number;
    /** +0x54 — the prop drawer's third-group selector, 0, 1 or 2. */
    dirX: number;
    gateA: number;
    gateB: number;
    /** The four slot pointers, the broadcast's whole 0x10-byte extra buffer.
     *  Slot 3 is never written by any of the driver's six attempts. */
    slots: (StreetVehicle | null)[];
    /** Every car the driver has created, in creation order — the original's
     *  object list. Nothing is ever removed from it: a culled car stays, and a
     *  car whose slot is taken over by a later spawn keeps driving. */
    cars: StreetVehicle[];
}

const runtime: Record<string, StreetBroadcast> = {};

function freshBroadcast(): StreetBroadcast {
    return {
        phase: 0,
        primed: false,
        timer: 0,
        dirY: 0,
        dirX: 0,
        gateA: 0,
        gateB: 0,
        slots: [null, null, null, null],
        cars: [],
    };
}

function broadcastFor(stageId: string): StreetBroadcast | null {
    if (!STREET_VEHICLE_TABLES[stageId]) return null;
    let b = runtime[stageId];
    if (!b) b = runtime[stageId] = freshBroadcast();
    return b;
}

function spawn(
    stageId: string,
    b: StreetBroadcast,
    recipe: Recipe,
    randBit: RandBit,
): StreetVehicle | null {
    const tables = STREET_VEHICLE_TABLES[stageId];
    if (!tables) return null;
    const index = recipe.a0 * 32 + recipe.a1 * 16 + recipe.a2 * 8;
    const start = tables.paths[index / 8];
    if (!start) return null;
    const v: StreetVehicle = {
        x: start[0] * 0x100,
        y: start[1] * 0x100,
        dirX: recipe.a1,
        dirY: recipe.a0,
        parked: recipe.a2 !== 0,
        variant: recipe.variant < 0 ? randBit() & 1 : recipe.variant,
        ctr: 0,
        sprite: PARKED_SPRITE,
        state: 0,
        armed: false,
    };
    b.slots[recipe.slot] = v;
    b.cars.push(v);
    return v;
}

/** One step of the 1 -> 0 -> 2 cycle the phase-1 arm runs on both flags
 *  (file 0x10bc-0x10e0): 0 becomes 2, 1 becomes 0, and 2 is left alone — which
 *  the arm's own entry normalisation (`2 -> 1`, file 0x1078) then picks up. */
function stepFlag(v: number): number {
    if (v === 0) return 2;
    if (v === 1) return 0;
    return v;
}

/** The broadcast's steady-state arm (file 0x1034-0x1140): set the phase's
 *  flags and gates, then fill every slot the open gate allows. */
function drive(b: StreetBroadcast, stageId: string, randBit: RandBit): void {
    if (b.phase === 1) {
        // file 0x1068-0x1124: normalise 2 -> 1 on both flags, hold for 0x79
        // blanks, then step both flags and advance the phase to 2. Either way
        // both gates are shut for this arm.
        if (b.dirY === 2) b.dirY = 1;
        if (b.dirX === 2) b.dirX = 1;
        b.timer += 1;
        if (b.timer >= BROADCAST_PHASE_FRAMES) {
            b.timer = 0;
            b.dirY = stepFlag(b.dirY);
            b.dirX = stepFlag(b.dirX);
            b.phase = 2; // advanceSub1, reached without any opcode
        }
        b.gateA = 0;
        b.gateB = 0;
        return;
    }
    if (b.phase === 2) {
        // file 0x1128-0x1130: gate A off, gate B on.
        b.gateA = 0;
        b.gateB = 1;
    } else {
        // file 0x1054-0x1064: dir-y 1, dir-x 0, gate A on, gate B off.
        b.dirY = 1;
        b.dirX = 0;
        b.gateA = 1;
        b.gateB = 0;
    }
    fill(b, GATE_A, b.gateA, stageId, randBit);
    fill(b, GATE_B, b.gateB, stageId, randBit);
}

function fill(
    b: StreetBroadcast,
    recipes: readonly Recipe[],
    gate: number,
    stageId: string,
    randBit: RandBit,
): void {
    if (!gate) return;
    for (const recipe of recipes) {
        // Every attempt runs only while its OWN slot pointer is still zero
        // (`bnez $v1, skip` on the slot word, file 0xc64 / 0xc88 / 0xcc8 /
        // 0xcf4 / 0xd18 / 0xd3c). Nothing ever clears a slot, so once a phase
        // has filled a slot that slot is not refilled.
        if (b.slots[recipe.slot]) continue;
        spawn(stageId, b, recipe, randBit);
    }
}

/**
 * The SETANIM >= 0x320 route for a broadcast object (0x800a6f40). Returns true
 * when the id belongs to the street broadcast, so the caller skips the generic
 * emote bubble. The original only stores the phase here (file 0x116c-0x194);
 * the cars appear on the object's next tick.
 */
export function fireStreetBroadcast(
    stageId: string,
    effectId: number,
    subId: number,
    _randBit?: RandBit,
): boolean {
    const b = broadcastFor(stageId);
    if (!b) return false;
    if (effectId !== 0x320) return false;
    if (subId !== BROADCAST_SUB_ONE && subId !== BROADCAST_SUB_ZERO) return false;
    b.phase = subId === BROADCAST_SUB_ONE ? 1 : 0;
    return true;
}

/** True when this stage has street vehicles at all (its tables are present). */
export function hasStreetVehicles(stageId: string): boolean {
    return Boolean(STREET_VEHICLE_TABLES[stageId]);
}

function culled(v: StreetVehicle): boolean {
    // file 0x218-0x25c: travelling +x leaves past 0x27fff; travelling -x leaves
    // at or before zero.
    return v.dirX !== 0 ? v.x > VEHICLE_CULL_X : v.x <= 0;
}

/** One frame of every live car on this stage (the car tick, file 0x128-0x268). */
export function tickStreetVehicles(
    stageId: string,
    frameDelta = 1,
    randBit: RandBit = () => (Math.random() < 0.5 ? 0 : 1),
): readonly StreetVehicle[] {
    const b = runtime[stageId];
    if (!b) return [];
    if (!b.primed) {
        // state 0: advance and return (file 0x1024-0x1030).
        b.primed = true;
        return [];
    }
    const tables = STREET_VEHICLE_TABLES[stageId];
    if (!tables) return [];
    for (const v of b.cars) {
        if (v.state === 0) {
            v.state = 1; // the tick's first arm only advances the state
            continue;
        }
        if (v.state !== 1) continue;
        if (!v.parked) {
            v.x += v.dirX ? VEHICLE_STEP_X : -VEHICLE_STEP_X;
            v.y += v.dirY ? -VEHICLE_STEP_Y : VEHICLE_STEP_Y;
        }
        v.ctr = (v.ctr + frameDelta) % VEHICLE_ANIM_MOD;
        v.sprite = v.parked
            ? PARKED_SPRITE
            : (tables.sprites[(v.ctr >> 2) + v.dirY * 2 + v.variant * 4] ?? PARKED_SPRITE);
        v.armed = true;
        if (culled(v)) {
            // setState(3): the car stops being ticked. Its slot keeps the
            // pointer — nothing in the overlay clears it — so the street is
            // not refilled for the rest of the phase.
            v.state = 3;
        }
    }
    drive(b, stageId, randBit);
    return b.cars;
}

/** What to paint this frame: sprite id and map pixel per live car. */
export function streetVehicleDraws(
    stageId: string,
): { spriteId: number; x: number; y: number }[] {
    const b = runtime[stageId];
    if (!b) return [];
    // A car whose state word is still 0 has not run its own tick yet, and that
    // tick returns before the draw (file 0x110-0x120), so it is not on screen on
    // the blank it was created; a culled one (state 3) never draws again.
    return b.cars
        .filter((v) => v.state === 1 && v.armed)
        .map((v) => ({ spriteId: v.sprite, x: v.x >> 8, y: v.y >> 8 }));
}

/**
 * The three traffic-light glows the broadcast object draws above the street,
 * every tick of its own (file 0xd6c-0xfe0). Group 1 and 2 are the two poles'
 * lamps and follow +0x50; group 3 is a second lamp column that follows +0x54.
 */
export function streetPropDraws(
    stageId: string,
): { clip: number; x: number; y: number }[] {
    const b = runtime[stageId];
    if (!b?.primed) return [];
    return STREET_PROP_GROUPS.map((g) => {
        const row = streetPropRow(g.flag === "dirY" ? b.dirY : b.dirX);
        return { clip: g.clips[row], x: g.x, y: g.y[row] };
    });
}

/** The broadcast object's own words, for tests and the browser verifier. */
export function streetBroadcastState(stageId: string): StreetBroadcast | null {
    return runtime[stageId] ?? null;
}

/** Drop every car on a stage (or everywhere) — used on a stage change. */
export function clearStreetVehicles(stageId?: string): void {
    if (stageId === undefined) {
        for (const key of Object.keys(runtime)) delete runtime[key];
        return;
    }
    delete runtime[stageId];
}
