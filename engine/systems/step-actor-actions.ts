// engine/systems/step-actor-actions.ts
//
// The PLAYER ACTOR's own movement-action slots — the half of a step tile's press
// that the disc hands to the character instead of to the scene.
//
// One object, one vtable, one mode dispatcher. Nothing here is per-place: a stage
// supplies only its step program, and every stage's record is read the same way.
//
// ── the object ──
//
// `F0x800143dc(0x80090FB0, 0x15c, 0x10, 5)` (fieldstg.s:0xe4bc-0xe4fc) allocates the
// type-5 player entity: tick 0x80090FB0, 0x15c bytes, four child slots at +0x24, and
// the eight generic band methods at +0x28..+0x44 (~/ddw3/asm/dw2003/exe/fns.s:4866
// `F0x800143dc`). `+0x2c` is the band-1 setter: `F0x80014288` stores a1 at +0x10 and
// zeroes +0x14, so **`obj->+0x2c(n)` sets the MODE and clears the SUB-STEP**.
//
// The constructor then installs the action slots (fieldstg.s:0xe510-0xe57c):
//
//   +0x110  0x8008F064  file 0xc3b4  turn to the tile's facing group, mode 5
//   +0x114  0x8008F128  file 0xc478  ladder mount at the bottom end,  mode 0x43
//   +0x118  0x8008F1D4  file 0xc524  ladder mount at the top end,     mode 0x44
//   +0x11c  0x8008F280  file 0xc5d0  OP 4  — the scripted slope step, mode 0x47
//   +0x120  0x8008F304  file 0xc654  OP 7  — the cast pose,            mode 0x48
//   +0x124  0x8008F3E4  file 0xc734  the dive launcher
//   +0x158  0x8008F44C  file 0xc79c  OP 13 / OP 14 — the pad walk,      mode 1
//
// Each of the last three writes `+0x108` (the per-frame handler the mode-1 band calls
// at fieldstg.s:0xe3b4-0xe3cc), `+0x60` (the facing index) and one of the two scene
// locks. Those three are the whole of "what the press does to the actor".
//
// ── the mode dispatcher ──
//
// `F0x8008FED0` (file 0xd220) reads +0x10 and jumps through a 0x51-entry table at
// RAM 0x80083590 = file 0x8e0:
//
//   0xd244 lw $v1, 0x10($s0) ; 0xd24c sltiu $v0,$v1,0x51 ; 0xd258 addiu $v0,0x3590
//
// Everything the mode word does NOT name lands on file 0xd9ec (SETANIM 1, +0x74 = 1).
// The blocks this module ports are:
//
//   mode 0x47  file 0xdb28   the slope step (op 4)
//   mode 0x48  file 0xdc7c   the cast pose (op 7) — six sub-blocks through a second
//                            six-entry table at RAM 0x800836D8 = file 0xa28
//   mode 1     file 0xd278   the ordinary walk/idle (every action returns here)
//
// The blocks FALL THROUGH into one another, which is safe because SETANIM
// (F0x8008F4B4, file 0xc804) clears the animation-complete flag +0xe8 that the next
// block tests. That is why each sub-block below ends by moving to the next phase
// rather than by waiting a tick.
//
// ── units ──
//
// One map cell is 0x100 internal units. The ladder mount proves it:
// `arg0->unk50 = arg2 << 8` for a mount cell read straight out of the record
// (fieldstg.s:0xc4b8/:0xc4cc), and the tick recovers the cell with `+0x58 = +0x50 >> 8`
// (:0xe3e4/:0xe3ec). So `0x1000` — the op-4 sideways step — is SIXTEEN cells, and
// `0x300` — the op-4 slide rate — is three cells per tick.

import { playerPackForClip } from "./player-clip-packs.ts";

/** The player actor's action vtable slots, as the constructor installs them. */
export const ACTOR_ACTION_SLOT = {
    turn: 0x110,
    ladderBottom: 0x114,
    ladderTop: 0x118,
    slopeStep: 0x11c,
    castPose: 0x120,
    dive: 0x124,
    padWalk: 0x158,
} as const;

/** The mode word at actor+0x10, and the block `F0x8008FED0` sends it to. */
export const ACTOR_MODE = {
    /** 0x01 -> file 0xd278 — the ordinary walk/idle every action returns to. */
    walk: 1,
    /** 0x43 -> file 0xd8ec — step ONTO the rail (clip 28), then mode 0x40 = hang. */
    ladderOn: 0x43,
    /** 0x44 -> file 0xd950 — grab the rail from the top end. */
    ladderGrab: 0x44,
    /** 0x47 -> file 0xdb28 — the op-4 slope step. */
    slope: 0x47,
    /** 0x48 -> file 0xdc7c — the op-7 cast pose (the angler). */
    castPose: 0x48,
} as const;

/** The mode dispatcher's table: mode -> file offset, read out of the shipped image. */
export const MODE_BLOCK_FILE: Readonly<Record<number, number>> = {
    0x01: 0xd278, 0x40: 0xd7ec, 0x41: 0xd818, 0x42: 0xd878, 0x43: 0xd8ec,
    0x44: 0xd950, 0x45: 0xda6c, 0x46: 0xd9f8, 0x47: 0xdb28, 0x48: 0xdc7c,
    0x49: 0xde28, 0x4a: 0xde4c, 0x4b: 0xd4e0, 0x4c: 0xd434, 0x4d: 0xe020,
    0x4e: 0xe0a4, 0x4f: 0xd6bc, 0x50: 0xd764,
};

/** Where a mode word the table does not name goes (fieldstg.s:0xd9ec). */
export const MODE_DEFAULT_FILE = 0xd9ec;

// ── the slope step (op 4) ────────────────────────────────────────────────────

/** `addiu $v1,-0x1000` / `addiu $v1,-0x1000` on the other side (0xdb84/0xdb8c). */
export const SLOPE_STEP_UNITS = 0x1000;
/** The same step in map cells: 0x1000 / 0x100. */
export const SLOPE_STEP_CELLS = 16;
/**
 * `addiu $a0,$v1,-0x300` — the per-tick slide down the drop, in the `bne`'s DELAY
 * SLOT (0xdbe4), so it runs on both paths. Three cells per tick.
 */
export const SLOPE_SLIDE_UNITS = 0x300;
export const SLOPE_SLIDE_CELLS = 3;
/**
 * `subu $v0,$a0 ; slti $v0,0x1801` (0xdbf0/0xdbf4) — when the remaining drop is
 * under this, the block swaps to the `nearTop` clip. 0x1801 internal units.
 */
export const SLOPE_NEAR_TOP_UNITS = 0x1801;
/** The four SETANIM clips mode 0x47 plays, in order (0xdb58, 0xdbb4, 0xdc04, 0xdc18). */
export const SLOPE_CLIP = {
    step: 0x16,
    hold: 0x17,
    nearTop: 0x18,
    land: 0x19,
} as const;

/**
 * The sprite pack those four clips resolve through — READ from the clip-range
 * rule rather than named. 0x16..0x19 is one of its five ranges, so the slope
 * step reaches its pack by the same table as the fishing cast, the ladder and
 * the tree kick (engine/systems/player-clip-packs.ts). A census test asserts
 * every one of the four clips lands on this one pack.
 */
export const SLOPE_SPRITE = playerPackForClip(SLOPE_CLIP.step);
/**
 * `ori $a0,0x593e` into the sound pointer (0xdc34) — the landing thud. 0x8004593e
 * is PLAYER02 in docs/research/audio/soundtst-all-categories.json (row 11), so the
 * walker's sound name is `player02`.
 */
export const SLOPE_LAND_SOUND = 0x8004593e;
export const SLOPE_LAND_SFX = "player02";
/** The climb lock the slot raises on the way in and mode 0x47 clears on the way out. */
export const SLOPE_LOCK_ADDR = 0x80099de0;

// ── the cast pose (op 7) ─────────────────────────────────────────────────────
//
// Mode 0x48 is the FISHING cast, already ported as engine/systems/fishing.ts
// (its six sub-blocks, the five clips, PLAYER09/PLAYER10 and the result balloon are
// all in that module's header table). What the slot itself adds on top of the pose
// is recorded here so the oracle can compare it:
//
//   [0x80099DD8] = 1                    the scene lock, cleared by sub-block 5
//   actor->+0x108 = 0                  no per-frame handler
//   actor->+0x60 = group               on the leader AND on all three party members
//   F0x8008D744(actor->+0x58 + param0, actor->+0x5c + param1)
//
// That last call is the FLOAT (bobber tick 0x8008D27C, file 0xa5cc; constructor
// F0x8008D744, file 0xaa94) placed at the cell the record names, offset from the
// player. Mode 0x48 writes no position of its own: it is a pose, not a move.
export const CAST_LOCK_ADDR = 0x80099dd8;
/** `F0x8008D744`'s tick, stored into the float's own +0x48. */
export const FLOAT_TICK = 0x8008d27c;

// ── the pad walk (op 13 / op 14) ─────────────────────────────────────────────
//
// `+0x108 = 0x8008EEF0` — the per-frame "walk toward +0xf0/+0xf4" handler (file
// 0xc240) — then mode 1, facing 0, the scene lock raised, and the 0x74-byte
// transition controller F0x8008c130 built by F0x8008c610 (file 0x9960). That is the
// launch pad, already ported as engine/systems/launch-pad.ts; the slot adds no
// movement of its own.
export const PAD_WALK_HANDLER = 0x8008eef0;
export const PAD_WALK_TICK = 0x8008c130;
export const PAD_WALK_MODE = ACTOR_MODE.walk;
export const PAD_WALK_FACING = 0;
export const PAD_WALK_LOCK_ADDR = 0x80099dd8;

export type ActorActionKind = "slope" | "castPose" | "padWalk";

export interface ActorActionPlan {
    op: number;
    kind: ActorActionKind;
    /** the vtable slot the disc calls. */
    slot: number;
    /** the mode word `obj->+0x2c` receives. */
    mode: number;
    /** what the slot writes into actor+0x60. */
    facing: number;
    /** the scene lock the slot raises. */
    lockAddr: number;
    /** slope only: which way the player steps, +1 when the facing group is 7. */
    side: number;
    /** slope only: how many cells to the side. */
    stepCells: number;
    /** slope only: how many cells down — `param0 * 16`. */
    dropCells: number;
    /** slope only: the raw drop in internal units, `param0 << 12`. */
    dropUnits: number;
    /** cast only: the float's cell, relative to the player. */
    floatDx: number;
    floatDy: number;
    /** every write the slot makes, for the native oracle. */
    writes: { at: string; what: string }[];
}

/** `lhu $v0,0xa($v1) / sll $v0,0x4 / sll $v0,0x8` — the bare shifts, no subtract. */
function op4DropUnits(param0: number): number {
    return (((param0 & 0xffff) << 4) << 8) >>> 0;
}

/**
 * What one playback op does to the PLAYER ACTOR, read out of the three slot bodies
 * (fieldstg.s:0xc5d0 / 0xc654 / 0xc79c) and the mode blocks they enter. `null` for
 * every op that calls no actor slot.
 */
export function actorActionPlan(op: number, group: number, params: readonly number[] = []): ActorActionPlan | null {
    const g = group & 7;
    const p = (i: number) => (params[i] ?? 0) & 0xffff;
    if (op === 4) {
        // 0x8008F280 (file 0xc5d0):
        //   :c5fc sw $zr,0x108($s1)         the per-frame handler off
        //   :c5f4 li $a1,0x47 / jalr +0x2c  mode 0x47, sub-step cleared
        //   :c608 sw $s0,0x60($s1)          facing = the tile's group
        //   :c610/:c618 sw 0 or 1, 0x8c     +0x8c = (group == 7)
        //   :c620 sw $zr,0x74($s1)
        //   :c628/:c630 sw (param0<<12), 0x94 and 0x90   the drop, twice
        //   :c62c jal F0x80090e70
        //   :c648 sw 1, [0x80099DE0]        the climb lock
        // Its a2/a3 — the two engine globals [0x80082E8C]/[0x80082E90] — are stored
        // to the CALLER's dead frame slots (:c5e8/:c5ec) and read by nothing.
        const side = g === 7 ? 1 : -1;
        const drop = op4DropUnits(p(0));
        return {
            op, kind: "slope", slot: ACTOR_ACTION_SLOT.slopeStep, mode: ACTOR_MODE.slope,
            facing: g, lockAddr: SLOPE_LOCK_ADDR, side,
            stepCells: side * SLOPE_STEP_CELLS,
            dropCells: (p(0) * SLOPE_STEP_CELLS),
            dropUnits: drop,
            floatDx: 0, floatDy: 0,
            writes: [
                { at: "+0x108", what: "0 — no per-frame handler" },
                { at: "+0x2c(0x47)", what: "mode 0x47, sub-step 0" },
                { at: "+0x60", what: `the tile's facing group (${g})` },
                { at: "+0x8c", what: `group == 7 ? 1 : 0 (${g === 7 ? 1 : 0})` },
                { at: "+0x74", what: "0" },
                { at: "+0x94", what: `param0 << 12 (${drop})` },
                { at: "+0x90", what: `param0 << 12 (${drop})` },
                { at: "F0x80090e70()", what: "one call, arguments untouched" },
                { at: "[0x80099DE0]", what: "1 — the climb lock" },
            ],
        };
    }
    if (op === 7) {
        // 0x8008F304 (file 0xc654):
        //   :c68c sw 1,[0x80099DD8]          the scene lock
        //   :c69c sw $zr,0x108($s2)
        //   :c668 li $a1,0x48 / jalr +0x2c  mode 0x48
        //   :c6b0 sw $s3,0x60($s2)          facing = the group, then the same word on
        //   :c6b4-:c6e0  each of find_entity(5,i,*) for i in 0..2 — the party members
        //   :c6e4-:c708  F0x8008D744(actor+0x58 + param0, actor+0x5c + param1)
        return {
            op, kind: "castPose", slot: ACTOR_ACTION_SLOT.castPose, mode: ACTOR_MODE.castPose,
            facing: g, lockAddr: CAST_LOCK_ADDR, side: 0, stepCells: 0, dropCells: 0, dropUnits: 0,
            floatDx: p(0), floatDy: p(1),
            writes: [
                { at: "[0x80099DD8]", what: "1 — the scene lock" },
                { at: "+0x108", what: "0 — no per-frame handler" },
                { at: "+0x2c(0x48)", what: "mode 0x48, sub-step 0" },
                { at: "+0x60", what: `the tile's facing group (${g}), on the leader and all three party members` },
                { at: "F0x8008D744", what: `the float at (player cell + ${p(0)}, player cell + ${p(1)}), tick 0x8008D27C` },
            ],
        };
    }
    if (op === 13 || op === 14) {
        // 0x8008F44C (file 0xc79c):
        //   :c7a4 addiu $v0,-0xbb4 -> +0x108 = 0x8008EEF0   (0xe578/:e57c in the ctor)
        //   :c7ac li $a1,1 / jalr +0x2c                       mode 1
        //   :c7b4 sw $zr,0x60($s1)                           facing 0
        //   :c7bc sw 1,[0x80099DD8]                          the scene lock
        //   :c7c8 F0x8008c610(actor, record+0xa)              the pad controller
        return {
            op, kind: "padWalk", slot: ACTOR_ACTION_SLOT.padWalk, mode: PAD_WALK_MODE,
            facing: PAD_WALK_FACING, lockAddr: PAD_WALK_LOCK_ADDR, side: 0,
            stepCells: 0, dropCells: 0, dropUnits: 0, floatDx: 0, floatDy: 0,
            writes: [
                { at: "+0x108", what: "0x8008EEF0 — walk toward +0xf0/+0xf4" },
                { at: "+0x2c(1)", what: "mode 1 — the ordinary walk" },
                { at: "+0x60", what: "0 — facing straight down" },
                { at: "[0x80099DD8]", what: "1 — the scene lock" },
                { at: "F0x8008c610", what: `the pad controller, owner = the actor, argument = record + 0xa (param0 ${p(0)})` },
            ],
        };
    }
    return null;
}

// ── the slope controller ─────────────────────────────────────────────────────

export type SlopePhase = "step" | "slide" | "landed";

export interface SlopeState {
    phase: SlopePhase;
    /** the leader's live position, produced by the controller. */
    x: number;
    y: number;
    /** cells still to slide down. */
    remaining: number;
    dropCells: number;
    stepCells: number;
    side: number;
    facing: number;
    /** the anim clip the block is on (SLOPE_CLIP). */
    clip: number;
    /** ticks spent in the current phase. */
    frame: number;
    /** the landing thud, for one step. */
    playSound: string | null;
    /** set on the frame the actor returns to mode 1. */
    locked: boolean;
}

/** Build the controller for one op-4 activation. */
export function startSlope(
    plan: ActorActionPlan,
    from: { x: number; y: number },
): SlopeState {
    // Sub-block 0 (file 0xdb54) writes +0x50 (x) and +0x54 (y) ONCE:
    //   +0x54 += +0x94           the raw y drops by the whole drop
    //   +0x50 += ±0x1000         the raw x steps SLOPE_STEP_CELLS cells
    // but the LOGICAL cell is (+0x50 >> 8, (+0x54 - +0x90) >> 8), and +0x90 starts
    // at the same drop, so the logical y at that instant is still the tile's y.
    // Sub-block 2 then takes +0x90 down by 0x300 a tick, which moves the logical y
    // DOWN by the same amount — so the player descends `dropCells` cells while the
    // x it stepped to is already final.
    return {
        phase: "step",
        x: from.x + plan.stepCells,
        y: from.y,
        remaining: plan.dropCells,
        dropCells: plan.dropCells,
        stepCells: plan.stepCells,
        side: plan.side,
        facing: plan.facing,
        clip: SLOPE_CLIP.step,
        frame: 0,
        playSound: null,
        locked: true,
    };
}

/** Ticks the sub-block-0 step pose holds before the slide starts (its anim flag). */
export const SLOPE_STEP_HOLD_TICKS = 6;

/**
 * Advance the controller. Mutates and returns `st`; `phase === "landed"` means the
 * player has arrived, the lock is down and normal control is back.
 */
export function stepSlope(st: SlopeState, frames = 1): SlopeState {
    st.playSound = null;
    if (st.phase === "landed") return st;
    let left = frames;
    while (left > 0 && st.phase !== "landed") {
        if (st.phase === "step") {
            // Sub-block 0 runs its SETANIM and its two coordinate writes in the tick
            // the slot was called, then sub-block 1 waits on +0xe8 (the pose's own
            // length) before handing over to the slide. The disc's block falls
            // through, so this is one tick of the pose and then the slide.
            const used = Math.min(left, SLOPE_STEP_HOLD_TICKS - st.frame);
            st.frame += used;
            left -= used;
            if (st.frame >= SLOPE_STEP_HOLD_TICKS) {
                st.phase = "slide";
                st.frame = 0;
                st.clip = SLOPE_CLIP.hold;
            }
            continue;
        }
        if (st.phase === "slide") {
            // Sub-block 2 (:dbc8): +0x90 -= 0x300 every tick, and while the remaining
            // drop is under SLOPE_NEAR_TOP_UNITS the block swaps to the nearTop clip.
            const perTick = SLOPE_SLIDE_CELLS;
            const need = st.remaining / perTick;
            const used = Math.min(left, need);
            st.remaining -= used * perTick;
            st.y += used * perTick;
            st.frame += used;
            left -= used;
            if (st.remaining * 0x100 < SLOPE_NEAR_TOP_UNITS) st.clip = SLOPE_CLIP.nearTop;
            if (st.remaining <= 0) {
                st.remaining = 0;
                st.phase = "landed";
                st.frame = 0;
                st.clip = SLOPE_CLIP.land;
                st.playSound = SLOPE_LAND_SFX;
                st.locked = false;
            }
            continue;
        }
        break;
    }
    return st;
}