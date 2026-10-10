// engine/dw3/battle-action-sequencer.ts
//
// THE SECONDARY BATTLE-ACTION SEQUENCER of `pro/wfightmn` — the shared dispatcher
// that turns one decided battle action into the sequence the player watches.
//
// It is ported ONCE from the disc, and its arms are described by their own table
// data rather than by a hand-written handler per case (the repository's
// "port the shared system, not the single case" rule). This module holds:
//
//   1. the 24-entry ACTION-ARM TABLE — `wfightmn.s` file `0x5010`..`0x506c`
//      (RAM `0x800a7418`..`0x800a9c10`), one routine per sequencer phase 3..26, read
//      by the outer lifecycle `F0x800a9cb4` at file `0x3ed4`;
//   2. the 24-entry ACTION-OPCODE TABLE — `wfightmn.s` file `0x08c`..`0x0e8`
//      (RAM `0x800a5e6c`..), 4-instruction thunks read while the phase is 1, each
//      handing the action method `ctx->m2c(ctx, N)` one opcode N;
//   3. the REQUEST STAGERS in `pro/fightstg` (RAM `0x8009c4bc`..`0x8009cf54`) that
//      arms reach to place a battle event on the fightstg request queue at `0x800A4780`;
//   4. the dispatcher itself (`waSequencerRoute`), a faithful reading of
//      `F0x800a9cb4` (wfightmn.s file `0x3ed4`).
//
// Address/table provenance (all read from `~/ddw3/asm/dw2003/pro/wfightmn.s`):
//   overlay load base = `0x800a5de0` (RAM = base + file offset)
//   arm table     file `0x5010`, 24 `.word`s  ->  wfightmn.s lines 5132-5155
//   opcode table  file `0x008c`, 24 `.word`s  ->  wfightmn.s lines 41-64
//   dispatcher    file `0x3ed4` (`F0x800a9cb4`) -> wfightmn.s line 4028
//   arm entry points, wfightmn.s per-arm line (no function labels exist in the
//   .s — it is a `.word` dump — so the line is the first instruction):
//     phase  3 0x800a7418 L1429 |   4 0x800a77b4 L1660 |   5 0x800a78d8 L1733
//     phase  6 0x800a7b08 L1873 |   7 0x800a7c00 L1935 |   8 0x800a7fe4 L2184
//     phase  9 0x800a8118 L2261 |  10 0x800a8260 L2343 |  11 0x800a8458 L2469
//     phase 12 0x800a84d0 L2499 |  13 0x800a8770 L2667 |  16 0x800a88cc L2754
//     phase 17 0x800a89f0 L2827 |  18 0x800a8ac8 L2881 |  19 0x800a8bf4 L2956
//     phase 20 0x800a8e90 L3123 |  21 0x800a8f88 L3185 |  22 0x800a9584 L3568
//     phase 23 0x800a9640 L3615 |  24 0x800a97bc L3710 |  25 0x800a988c L3762
//     phase 26 0x800a9c10 L3987
//   Request stagers, `~/ddw3/asm/dw2003/pro/fightstg.s` (base `0x80082cb0`):
//     0x8009c4bc L26477 | 0x8009c4f8 L26495 | 0x8009c534 L26513
//     0x8009c578 L26533 | 0x8009c740 L26655 | 0x8009cf54 L27202
//
// The lifted C for every arm is in `exe-decomp/wfightmn_c/F0x800a####.c`.
// Prior coverage: docs/research/battle/3d-battle-complete-model-2026-08-19.md
// §"wfightmn"; docs/research/overlays/wfightmn.md. docs/research/evidence/ledger.json
// is not touched by this module.
//
// COMMAND -> QUEUE KIND -> ARM (read from the queue's own producer side).
// The queue object at `0x800A3868` carries its method table at `+0xAF8`..`+0xB18`
// (a static `.word` block in `pro/fightstg.s:34852-34860`). `+0xAF8`/`+0xAFC` are
// enqueue/preempt; `+0xB0C` is the "is there a queued entry of this kind for this
// actor?" lookup. A queue entry's kind is the first halfword the enqueue method
// copies from the 0x10-byte request block at `0x800A4780`; the per-code stagers in
// `pro/fightstg` write that block's `+0x00` word and call one of the two methods.
// `WA_REQUEST_STAGERS` below is the full set read from the disc, and
// `WA_COMMAND_ROUTES` ties each named command to its producer, its queue kind and
// the arm that consumes it. Commands that cannot be tied to a kind from the disc
// are in `WA_UNRESOLVED_ROUTES` with the evidence that would settle them.

/** The overlay's RAM load base; every `address` below is absolute RAM. */
export const WA_SEQUENCER_BASE = 0x800a5de0;

/** The arm table's RAM base (file `0x5004`; phase 3 lands on file `0x5010`). */
export const WA_ACTION_ARM_TABLE_BASE = 0x800aade4;
/** The opcode-thunk table's RAM base (file `0x008c`). */
export const WA_ACTION_OPCODE_TABLE_BASE = 0x800a5e6c;

/**
 * One arm of the 24-entry action table. Each arm is the routine a sequencer
 * phase 3..26 jumps to; the arm fills its own presentation parameter block,
 * returns its own `ctx->m2c` opcode, and does its own queue bookkeeping.
 */
export interface WaActionArm {
    /** 0..23 = table index; equals `phase - 3`. */
    index: number;
    /** The sequencer phase (`ctx+0x10`) that selects this arm (3..26). */
    phase: number;
    /** Absolute RAM address of the original routine. */
    address: number;
    /** A short role name. */
    name: string;
    /**
     * The presentation-kind byte the arm writes to `ctx->unk50` (the shared
     * draw/effect kind), or null when the arm's default branch reads no kind.
     * `0x1000 | n` style ids are not used here; these are the raw byte values.
     */
    presentationKind: number | null;
    /** Queue kinds (0x800A3868 entry `+0x00`) the arm enqueues or clears. */
    queueKinds: readonly number[];
    /** The `ctx->m2c(ctx, N)` opcode(s) the arm hands back, in source order. */
    resultOpcodes: readonly number[];
    /**
     * True when running the arm can change player-visible battle state (a
     * fighter spawned, a party slot swapped, HP restated, a status bit cleared,
     * an enemy block spawned, the KO handler invoked).
     */
    changesBattleState: boolean;
    /** `pro/wfightmn.s` first-instruction line for the routine. */
    evidence: string;
}

/**
 * The 24 arms of `wfightmn.s` file `0x5010`..`0x506c`, in table order.
 *
 * Roles marked "unpinned" carry only the branch structure read out of the
 * lifted C; the document `wfightmn.md` is explicit that tying arms to named
 * commands needs the queue's own producer read, which is not done here.
 */
export const WA_ACTION_ARM_TABLE: readonly WaActionArm[] = [
    {
        index: 0, phase: 3, address: 0x800a7418, name: "openingBroadcast",
        presentationKind: 0x42, queueKinds: [4, 8], resultOpcodes: [2, 0x11, 0, 4, 5, 6],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:1429 (F0x800a7418) — clears queued kinds 8/4 for the actor, plays kind 0x42, then branches on the actor's queued-action byte +0x5C: 0 starts the Fight task 0x8008d37c",
    },
    {
        index: 1, phase: 4, address: 0x800a77b4, name: "playChosenMove",
        presentationKind: 0x0c, queueKinds: [], resultOpcodes: [2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:1660 (F0x800a77b4) — copies the actor's chosen move id (queue entry +0x64) into combatant +0x00 and calls 0x8008a7f4(moveId,0) to play it",
    },
    {
        index: 2, phase: 5, address: 0x800a78d8, name: "tagCommit",
        presentationKind: 0x38, queueKinds: [], resultOpcodes: [2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:1733 (F0x800a78d8) — the Tag commit: with the tagged-in fighter found it sets the active combatant slot (0x800A4460+0x8) to the candidate, spawns it via 0x80087000, then restores the slot (docs/research/battle/3d-battle-complete-model-2026-08-19.md:1346)",
    },
    {
        index: 3, phase: 6, address: 0x800a7b08, name: "techniqueAction",
        presentationKind: null, queueKinds: [3], resultOpcodes: [5, 0],
        changesBattleState: false,
        evidence: "pro/wfightmn.s:1873 (F0x800a7b08) — stages arg1->unk4->unk68 through 0x80090c44, or scans the enemy block for a present slot (m2c 5), else 0x800a6b18 + m2c 0",
    },
    {
        index: 4, phase: 7, address: 0x800a7c00, name: "battleOutcome",
        presentationKind: null, queueKinds: [0x0b], resultOpcodes: [0, 2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:1935 (F0x800a7c00) — the battle-outcome routine: writes the report item slot 0x80042b86, restates each roster record's +0x788/+0x78C from the block, spawns 0x8008aaac; the loss/exit modes 0/1/2 live in its back half",
    },
    {
        index: 5, phase: 8, address: 0x800a7fe4, name: "queuedRequest",
        presentationKind: 0x5f, queueKinds: [], resultOpcodes: [0],
        changesBattleState: false,
        evidence: "pro/wfightmn.s:2184 (F0x800a7fe4) — reads the current queue entry (+0xAF1), tests it via 0x800a4654; if present plays kind 0x5F (0x43 for the actor) and returns, else stages request 0x8009c534(0) and m2c 0",
    },
    {
        index: 6, phase: 9, address: 0x800a8118, name: "recoverCrest",
        presentationKind: 0x5a, queueKinds: [6], resultOpcodes: [2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2261 (F0x800a8118) — sweeps queue kind 6 for the acting actor, plays kind 0x5A, and marks the swept entry kind 6 or 0; Recover Crest by direct accessory-id read (3d-battle-complete-model-2026-08-19.md:1347)",
    },
    {
        index: 7, phase: 10, address: 0x800a8260, name: "hpShift",
        presentationKind: 0x0a, queueKinds: [], resultOpcodes: [0],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2343 (F0x800a8260) — computes arg0->unk18 via 0x800a4618, and when HP < max spawns 0x800aa1f0(kind 0xBD) then applies the delta through the HP primitive 0x800aa9f0",
    },
    {
        index: 8, phase: 11, address: 0x800a8458, name: "clearGuard",
        presentationKind: 0x6a, queueKinds: [], resultOpcodes: [2],
        changesBattleState: false,
        evidence: "pro/wfightmn.s:2469 (F0x800a8458) — plays kind 0x6A and clears combatant +0xD0/+0xD2",
    },
    {
        index: 9, phase: 12, address: 0x800a84d0, name: "reviveOrMove",
        presentationKind: 0x0f, queueKinds: [], resultOpcodes: [0, 2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2499 (F0x800a84d0) — spawns via 0x8008834C or 0x8008C910, applies an HP delta with 0x800aa9f0, and on the empty case calls the KO handler 0x8009cf54",
    },
    {
        index: 10, phase: 13, address: 0x800a8770, name: "ailmentRecoverA",
        presentationKind: 0x07, queueKinds: [], resultOpcodes: [0],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2667 (F0x800a8770) — shared ailment-recovery actor; kind = phase+0x1C, and clears one status bit (0xFD/0xFB/0xF7 for phase 14/15) in the enemy-block record (3d-battle-complete-model-2026-08-19.md:1336)",
    },
    {
        index: 11, phase: 14, address: 0x800a8770, name: "ailmentRecoverB",
        presentationKind: 0x07, queueKinds: [], resultOpcodes: [0],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2667 (F0x800a8770, same body) — clears bit 0xFB",
    },
    {
        index: 12, phase: 15, address: 0x800a8770, name: "ailmentRecoverC",
        presentationKind: 0x07, queueKinds: [], resultOpcodes: [0],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2667 (F0x800a8770, same body) — clears bit 0xF7",
    },
    {
        index: 13, phase: 16, address: 0x800a88cc, name: "statusClear",
        presentationKind: 0x5b, queueKinds: [], resultOpcodes: [0],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2754 (F0x800a88cc) — kind = queue entry +0x0C + 0x5B, then clears the enemy-block record field at (slot*0x60 + actor*0x20 + +0x0C*2 + 0x10)",
    },
    {
        index: 14, phase: 17, address: 0x800a89f0, name: "battleActionArm",
        presentationKind: null, queueKinds: [], resultOpcodes: [2, 0],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2827 (F0x800a89f0) — the named battleActionArm: launches the Fight task 0x8008d37c when the actor's +0x5C is 0 (else m2c 0), then re-enqueues via the stager 0x8009c4bc",
    },
    {
        index: 15, phase: 18, address: 0x800a8ac8, name: "statusClearEx",
        presentationKind: 0x57, queueKinds: [], resultOpcodes: [0],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2881 (F0x800a8ac8) — kind = entry +0x0C + 0x57, then clears a status bit `~(phase << (entry+0x0C + 4))` in the enemy-block record",
    },
    {
        index: 16, phase: 19, address: 0x800a8bf4, name: "blastCommit",
        presentationKind: 0x61, queueKinds: [0x0b], resultOpcodes: [2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:2956 (F0x800a8bf4) — the Blast on/revert handler: restores the combatant's saved HP (+0x08 = +0x06), clears status bit 4, clears queued kind 0x0B, calls 0x8009cf00, and spawns via 0x8008a7f4 (3d-battle-complete-model-2026-08-19.md:1344)",
    },
    {
        index: 17, phase: 20, address: 0x800a8e90, name: "blastRevert",
        presentationKind: 0x62, queueKinds: [], resultOpcodes: [2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:3123 (F0x800a8e90) — the Blast revert handler: restates the combatant's species/hp from its saved halfword (+0x00 = +0x02), calls the shared Tag/Blast cleanup 0x800a7328, spawns via 0x80087000",
    },
    {
        index: 18, phase: 21, address: 0x800a8f88, name: "tagBlastSpawn",
        presentationKind: 0x50, queueKinds: [], resultOpcodes: [5, 2, 7],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:3185 (F0x800a8f88) — scans the enemy block for a living slot, stages request 0x8009c534 and spawns it via 0x80087000, sets mode 0x0D; the loss branch walks 0x8009c534/0x8008cb44 later in the same body",
    },
    {
        index: 19, phase: 22, address: 0x800a9584, name: "guardClear",
        presentationKind: 0x59, queueKinds: [], resultOpcodes: [2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:3568 (F0x800a9584) — clears enemy-block +0x1B for the entry's target and plays kind 0x59",
    },
    {
        index: 20, phase: 23, address: 0x800a9640, name: "restoreActor",
        presentationKind: 0x47, queueKinds: [8], resultOpcodes: [2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:3615 (F0x800a9640) — restates the active combatant's species from 0x8004b44c, clears the queued kind 8, calls the shared cleanup 0x800a7328, spawns via 0x80087000",
    },
    {
        index: 21, phase: 24, address: 0x800a97bc, name: "awaitChild",
        presentationKind: null, queueKinds: [], resultOpcodes: [0],
        changesBattleState: false,
        evidence: "pro/wfightmn.s:3710 (F0x800a97bc) — waits while the child object is alive; when it has run past its window it signals it (child +0xB0) and m2c 0",
    },
    {
        index: 22, phase: 25, address: 0x800a988c, name: "spawnEnemyBlock",
        presentationKind: 0x16, queueKinds: [], resultOpcodes: [2],
        changesBattleState: true,
        evidence: "pro/wfightmn.s:3762 (F0x800a988c) — writes mode 6, spawns enemy-block record 2 via 0x80087000, copies the technique row's status bytes from 0x80042bca (3d-battle-complete-model-2026-08-19.md:1500, BATTLE-C009)",
    },
    {
        index: 23, phase: 26, address: 0x800a9c10, name: "stageRequestThree",
        presentationKind: null, queueKinds: [3], resultOpcodes: [2],
        changesBattleState: false,
        evidence: "pro/wfightmn.s:3987 (F0x800a9c10) — clears queued kind 3, enqueues the request record {3,1,-1} through 0x800A3868 method +0xAFC, clears combatant +0x86/+0x82",
    },
];

/**
 * One `ctx->m2c(ctx, N)` thunk read while the sequencer phase is 1
 * (`wfightmn.s` file `0x08c`..`0x0e8`). The thunk table index is the action
 * opcode minus one; the opcode N is the `li $a1, N` in the `j` delay slot.
 */
export interface WaActionOpcode {
    /** The action opcode written to `ctx+0x14` (1..24). */
    subState: number;
    /** Absolute RAM address of the thunk. */
    thunk: number;
    /** The opcode the thunk hands to the action method. */
    opcode: number;
}

/** The 24 opcode thunks, table order (subState 1..24). */
export const WA_ACTION_OPCODE_TABLE: readonly WaActionOpcode[] = [
    { subState: 1, thunk: 0x800a9e08, opcode: 0x07 },
    { subState: 2, thunk: 0x800a9df8, opcode: 0x03 },
    // subState 3's thunk is the one non-thunk: it reads the workspace mode at
    // 0x800A4460+0xD6 (5 -> 0x80090e58, 6 -> 0x800914ec, else -> 0x80088c00)
    // and always returns opcode 2.
    { subState: 3, thunk: 0x800a9e18, opcode: 0x02 },
    { subState: 4, thunk: 0x800a9eac, opcode: 0x08 },
    { subState: 5, thunk: 0x800a9ebc, opcode: 0x09 },
    { subState: 6, thunk: 0x800a9ecc, opcode: 0x0a },
    { subState: 7, thunk: 0x800a9edc, opcode: 0x0b },
    { subState: 8, thunk: 0x800a9df8, opcode: 0x03 },
    { subState: 9, thunk: 0x800a9eec, opcode: 0x0c },
    { subState: 10, thunk: 0x800a9efc, opcode: 0x0d },
    { subState: 11, thunk: 0x800a9f0c, opcode: 0x0e },
    { subState: 12, thunk: 0x800a9f1c, opcode: 0x0f },
    { subState: 13, thunk: 0x800a9f2c, opcode: 0x10 },
    { subState: 14, thunk: 0x800a9f2c, opcode: 0x10 },
    { subState: 15, thunk: 0x800a9f2c, opcode: 0x10 },
    { subState: 16, thunk: 0x800a9f3c, opcode: 0x12 },
    { subState: 17, thunk: 0x800a9f3c, opcode: 0x12 },
    { subState: 18, thunk: 0x800a9f4c, opcode: 0x13 },
    { subState: 19, thunk: 0x800a9f5c, opcode: 0x14 },
    { subState: 20, thunk: 0x800a9f6c, opcode: 0x15 },
    { subState: 21, thunk: 0x800a9f7c, opcode: 0x16 },
    { subState: 22, thunk: 0x800a9f8c, opcode: 0x17 },
    { subState: 23, thunk: 0x800a9f9c, opcode: 0x19 },
    { subState: 24, thunk: 0x800a9fac, opcode: 0x1a },
];

/**
 * A fightstg request stager: it writes one 0x10-byte request block at
 * `0x800A4780` (+0 code, +4 arg0, +8 arg1, +0xC arg2) and calls the queue
 * method `method` on it. Read from `pro/fightstg.s`. The code word is the
 * queue entry's kind.
 */
export interface WaRequestStager {
    address: number;
    /** The request code written to `0x800A4780+0x00`; becomes the queue entry kind. */
    code: number;
    /** The queue method called with the block: enqueue (`0x8009B930`) or preempt (`0x8009B9D0`). */
    method: "enqueue" | "preempt";
    evidence: string;
}

/**
 * Every request stager read from `pro/fightstg.s` (the codes are the disc's own
 * `li` immediates; the method is the `jal` in each body). Kinds 1..0x18; kind 8
 * and 0x0D..0x11 are not produced by any stager read here.
 */
export const WA_REQUEST_STAGERS: readonly WaRequestStager[] = [
    { address: 0x8009c4bc, code: 0x02, method: "enqueue", evidence: "pro/fightstg.s:26477" },
    { address: 0x8009c4f8, code: 0x03, method: "enqueue", evidence: "pro/fightstg.s:26495" },
    { address: 0x8009c534, code: 0x01, method: "preempt", evidence: "pro/fightstg.s:26513" },
    { address: 0x8009c578, code: 0x04, method: "enqueue", evidence: "pro/fightstg.s:26533" },
    { address: 0x8009c5e8, code: 0x05, method: "enqueue", evidence: "pro/fightstg.s:26563" },
    { address: 0x8009c6a4, code: 0x06, method: "enqueue", evidence: "pro/fightstg.s:26613" },
    { address: 0x8009c740, code: 0x07, method: "enqueue", evidence: "pro/fightstg.s:26655" },
    { address: 0x8009c7d4, code: 0x09, method: "enqueue", evidence: "pro/fightstg.s:26695" },
    { address: 0x8009c8b0, code: 0x0a, method: "enqueue", evidence: "pro/fightstg.s:26753" },
    { address: 0x8009c9c0, code: 0x0b, method: "enqueue", evidence: "pro/fightstg.s:26824" },
    { address: 0x8009cb10, code: 0x0c, method: "enqueue", evidence: "pro/fightstg.s:26911" },
    { address: 0x8009ced0, code: 0x12, method: "enqueue", evidence: "pro/fightstg.s:27163" },
    { address: 0x8009cf00, code: 0x13, method: "enqueue", evidence: "pro/fightstg.s:27178" },
    { address: 0x8009cf54, code: 0x14, method: "preempt", evidence: "pro/fightstg.s:27202" },
    { address: 0x8009cfb0, code: 0x15, method: "preempt", evidence: "pro/fightstg.s:27228" },
    { address: 0x8009cff4, code: 0x16, method: "preempt", evidence: "pro/fightstg.s:27248" },
    { address: 0x8009d038, code: 0x17, method: "preempt", evidence: "pro/fightstg.s:27268" },
    { address: 0x8009d06c, code: 0x18, method: "enqueue", evidence: "pro/fightstg.s:27284" },
];

/** The queue object's RAM base; its method table sits at `+0xAF8`..`+0xB18`. */
export const WA_QUEUE_BASE = 0x800a3868;

/**
 * One slot of the queue object's own method table, read from the static `.word`
 * block in `pro/fightstg.s:34852-34860` (`0x800A4360`..`0x800A4380`). The table
 * base is `queue+0xAF8`, so slot = absolute - `WA_QUEUE_BASE`.
 */
export interface WaQueueMethod {
    /** Byte offset of the pointer from the queue base (`0xAF8`..`0xB18`). */
    slot: number;
    /** The absolute RAM address stored in the slot. */
    address: number;
    name: string;
    role: string;
    evidence: string;
}

/** The nine method pointers the queue object carries. */
export const WA_QUEUE_METHODS: readonly WaQueueMethod[] = [
    { slot: 0xaf8, address: 0x8009b930, name: "enqueue", role: "copies a request block into the first free 0x1C-byte slot", evidence: "pro/fightstg.s:34852" },
    { slot: 0xafc, address: 0x8009b9d0, name: "preempt", role: "bumps every queued entry's delay by the block's +4 then enqueues it", evidence: "pro/fightstg.s:34853" },
    { slot: 0xb00, address: 0x8009ba4c, name: "pickNext", role: "picks the queued entry with the smallest delay, consumes it, sets the current index +0xAF1 and returns its kind", evidence: "pro/fightstg.s:34854" },
    { slot: 0xb04, address: 0x8009bc14, name: "seekKind", role: "seeks to the first queued entry of a kind (sets +0xAF2, +0xAF3)", evidence: "pro/fightstg.s:34855" },
    { slot: 0xb08, address: 0x8009bc54, name: "seekNext", role: "advances the seek to the next entry of the same kind", evidence: "pro/fightstg.s:34856" },
    { slot: 0xb0c, address: 0x8009bc94, name: "findKind", role: "answers \"is there a queued entry of this kind for this actor/target?\" (kind, actor, target)", evidence: "pro/fightstg.s:34857" },
    { slot: 0xb10, address: 0x8009bd44, name: "clearMatching", role: "clears every queued entry whose actor/target match a block", evidence: "pro/fightstg.s:34858" },
    { slot: 0xb14, address: 0x8009bda4, name: "kindDelay", role: "returns a per-kind frame delay (`(kind, variant)`)", evidence: "pro/fightstg.s:34859" },
    { slot: 0xb18, address: 0x8009c330, name: "clearStatus", role: "clears a combatant status bit and the queued entries of its kind (0xC0..0xC5 -> kinds 9/10/11/12)", evidence: "pro/fightstg.s:34860" },
];

/**
 * A named command's route through the queue: its queue kind, the disc routine
 * that produces that kind, and the arm that consumes it. `link` says how the
 * two ends are anchored: `armCallsProducer` = the arm body `jal`s the producer
 * (the arm is where the event is raised), `armReadsKind` = the arm body looks the
 * kind up on the queue (the arm is where the event is played).
 */
export interface WaCommandRoute {
    command: string;
    queueKind: number;
    /** Absolute RAM of the disc routine that enqueues `queueKind`. */
    producer: number;
    armPhase: number;
    armAddress: number;
    link: "armCallsProducer" | "armReadsKind";
    evidence: string;
}

/**
 * The command routes pinned from the disc. Each row is machine-checked by the
 * oracle: the stager's own `li` must equal `queueKind`, the arm table word at
 * `armPhase` must equal `armAddress`, and the arm body must carry the link
 * (`lw $v0,0xb0c` + `li $a0,queueKind` for a read, or `jal producer`).
 */
export const WA_COMMAND_ROUTES: readonly WaCommandRoute[] = [
    {
        command: "Recover Crest (held crest accessory)",
        queueKind: 0x06, producer: 0x8009c6a4,
        armPhase: 9, armAddress: 0x800a8118, link: "armReadsKind",
        evidence: "F0x800a6920 scans roster +0x3C8/+0x3CA for accessory 0x140 and calls 0x8009C6A4(0,actor,0) (pro/wfightmn.s:727, exe-decomp/wfightmn_c/F0x800a6920.c:12-13); 0x8009C6A4 enqueues kind 6 (pro/fightstg.s:26613); arm phase 9 (F0x800a8118) looks kind 6 up via the +0xB0C slot (exe-decomp/wfightmn_c/F0x800a8118.c:9)",
    },
    {
        command: "Blast (submit the Blast event)",
        queueKind: 0x13, producer: 0x8009cf00,
        armPhase: 19, armAddress: 0x800a8bf4, link: "armCallsProducer",
        evidence: "arm phase 19 (F0x800a8bf4) restores saved HP, cancels queued kind 0x0B, then calls 0x8009CF00 (exe-decomp/wfightmn_c/F0x800a8bf4.c:33,65); 0x8009CF00 enqueues kind 0x13 (pro/fightstg.s:27178,27185)",
    },
    {
        command: "KO / monster-defeat",
        queueKind: 0x14, producer: 0x8009cf54,
        armPhase: 12, armAddress: 0x800a84d0, link: "armCallsProducer",
        evidence: "arm phase 12 (F0x800a84d0) applies the HP delta and, when HP reaches 0, calls 0x8009CF54 (exe-decomp/wfightmn_c/F0x800a84d0.c:62-64); 0x8009CF54 enqueues kind 0x14 (pro/fightstg.s:27202,27206)",
    },
];


/**
 * Named commands that CANNOT be tied to a queue kind from the disc. Listed so
 * the gap is explicit rather than filled with a guess. Each says what would
 * settle it.
 */
export interface WaUnresolvedRoute {
    command: string;
    status: "arm-only" | "unresolved";
    /** What was actually read. */
    read: string;
    /** The evidence that would settle the mapping. */
    needed: string;
}

export const WA_UNRESOLVED_ROUTES: readonly WaUnresolvedRoute[] = [
    {
        command: "Tag (switch to a partner)",
        status: "arm-only",
        read: "arm phase 5 (F0x800a78d8) is the Tag commit — it copies the candidate move id from combatant +0x64, sets the active combatant slot +0x8, spawns via 0x80087000 and restores the slot; it enqueues no queue kind (exe-decomp/wfightmn_c/F0x800a78d8.c:43-44).",
        needed: "No queue kind is involved; the arm is reached with phase 5. Confirming the player-visible command (Tag menu confirm) sets phase 5 needs a read of the caller of the Turn-loop that writes ctx+0x10 = 5.",
    },
    {
        command: "Enemy-block spawn (enemy extra record)",
        status: "arm-only",
        read: "arm phase 25 (F0x800a988c) writes mode 6, spawns enemy-block record 2 via 0x80087000 with combatant +0xB0 and copies the technique row's status bytes; it enqueues no queue kind (exe-decomp/wfightmn_c/F0x800a988c.c:18-20).",
        needed: "No queue kind is involved. Which enemy block record is spawned is pinned; the command that requests it is the caller that sets phase 25.",
    },
    {
        command: "Ailment recoveries (phases 13/14/15)",
        status: "unresolved",
        read: "The four ailment appliers stage kinds 9/10/11/12 — 0x8009c7d4 (0x09, pro/fightstg.s:26695), 0x8009c8b0 (0x0a, :26753), 0x8009c9c0 (0x0b, :26824), 0x8009cb10 (0x0c, :26911) — but the recovery arms, F0x800a8770 at phases 13/14/15, read the CURRENT queue entry (+0xAF1) and pick the cleared status bit from their own phase (13 -> 0xFD, 14 -> 0xFB, 15 -> 0xF7), not from a kind lookup (exe-decomp/wfightmn_c/F0x800a8770.c:11,29-40).",
        needed: "The mapping applier-kind -> recovery-phase: read who sets ctx+0x10 to 13/14/15 after a kind 9/10/11/12 entry is picked, i.e. the Turn-loop scheduler that converts a picked kind into a phase.",
    },
];

/**
 * A battle command that does NOT route through the secondary action sequencer's 24-entry
 * arm table. The command's own screen writes a result/action code, the `wfightmn`
 * controller reads that code from its phase object and enters its own step, and that step
 * calls a FIGHTSTG routine directly — no arm of `WA_ACTION_ARM_TABLE` and no queue kind is
 * involved. Listed here so the route is recorded rather than forced into
 * `WA_COMMAND_ROUTES` (whose rows all resolve through a queue kind).
 */
export interface WaOffTableRoute {
    command: string;
    /** The action/result code the command's screen writes. */
    actionCode: number;
    /** Absolute RAM of the FIGHTSTG instruction that writes it. */
    actionCodeSite: number;
    /** The `wfightmn` controller step the code selects. */
    controllerStep: number;
    /** Absolute RAM of the `wfightmn` instruction that loads that step. */
    controllerStepSite: number;
    /** Absolute RAM of the FIGHTSTG routine the controller step calls (in `pro/fightstg`). */
    actionAddress: number;
    /** Absolute RAM of the `wfightmn` `jal` that starts it. */
    actionCallSite: number;
    /** The FIGHTSTG action callback (tick routine) the started task runs. */
    actionTick: number;
    evidence: string;
}

/**
 * The off-table routes pinned from the disc.
 *
 * DNA digivolution — the whole route, each end read from the disc:
 *
 *   1. the command phase's own screen writes the result/action code **6** at
 *      `fightstg.s:16357` (`.L0x80092b54: li $v0, 0x6`, word `0x24020006`); the DNA
 *      commit at `fightstg.s:0x800986bc` writes it through the pane's `+0x80` out pointer
 *      (digivolution-tech-system-decoded-2026-07-11.md §10f);
 *   2. the `wfightmn` controller reads it and enters its DNA step 6 — the step word is
 *      `li $a1, 0x6` at `wfightmn.s:1626` (`.L0x0000194c`, word `0x24050006`);
 *   3. the DNA step calls `F0x80090C44(0, phase+0x68)` — `wfightmn.s:1887` loads the result
 *      into `$a1` (`lw $a1, 0x68($v0)`), `:1888` is `jal 0x80090c44` with `move_ $a0, $zr`
 *      in its delay slot (word `0x0c024311`). `0x80090c44` lives in `pro/fightstg`, NOT in
 *      the `wfightmn` arm table, and its callback/tick is `F0x8008F714`
 *      (digivolution-tech-system-decoded-2026-07-11.md §10f).
 *
 * **`0x80082e70` is not the DNA trigger.** The old `fightstg-command-dispatch.md` §S5 note
 * named `STFGTREP_f0 @0x80082e70` as the in-battle DV trigger with a `+0x38` form-swap
 * method. Two things settle it against that reading:
 *
 *   * `STFGTREP_f0` (`~/ddw3/asm/dw2003/pro/stfgtrep/f0.s`, `section_STFGTREP_f0.0x80082e70`)
 *     DOES call `src->+0x38` (`lw $v0, 0x38($s1)` / `jalr $v0` / `move_ $a0, $s1` at file
 *     0x294-0x29c). But `+0x38` is not a form swap: the constructor `F0x800143dc` installs
 *     the generic resident task-state method `F0x800142ac` there, and that method only
 *     clears `+0x10/+0x14/+0x18` and bumps `+0xc` (digivolution-tech-system-decoded-2026-07-11.md
 *     §10f, correcting §10e).
 *   * `0x80082e70` is a base collision: in `pro/fightstg` (same load base `0x80082cb0`) that
 *     address is a `.word` in the method-pointer block (`fightstg.s:102`, value `0x8008bac0`),
 *     not code. So no `fightstg`/`wfightmn` battle path jumps to `STFGTREP_f0` at all; its
 *     references (`cnty_sel.s:111`, `stagslct.s:4307/4343`) are screens that share the
 *     Digivolution animation, not the battle DNA confirm.
 *
 * No arm of `WA_ACTION_ARM_TABLE` and no `WA_COMMAND_ROUTES` producer/stager is involved, so
 * DNA is reported as off-table rather than mapped onto the queue.
 */
export const WA_OFF_TABLE_ROUTES: readonly WaOffTableRoute[] = [
    {
        command: "DNA digivolution (in-battle fusion)",
        actionCode: 0x6,
        actionCodeSite: 0x80092b54,
        controllerStep: 0x6,
        controllerStepSite: 0x800a772c,
        actionAddress: 0x80090c44,
        actionCallSite: 0x800a7b44,
        actionTick: 0x8008f714,
        evidence: "FIGHTSTG command phase writes action 6 (pro/fightstg.s:16357, .L0x80092b54 li $v0,0x6); wfightmn controller enters DNA step 6 (pro/wfightmn.s:1626, .L0x0000194c li $a1,0x6); DNA step calls FIGHTSTG_F0x80090C44(0, phase+0x68) (pro/wfightmn.s:1887 lw $a1,0x68($v0); :1888 jal 0x80090c44), a pro/fightstg routine whose tick is F0x8008F714 (digivolution-tech-system-decoded-2026-07-11.md §10f). NOT the 24-arm table (all arms are in pro/wfightmn at 0x800a7418+) and NOT the queue.",
    },
];

/**
 * The `STFGTREP_f0` reading, encoded so the sequencer oracle can check it against
 * `pro_stfgtrep.bin` and `pro_fightstg.bin` rather than re-stating it as prose.
 */
export interface WaStfgtrepF0 {
    /** Absolute RAM of `STFGTREP_f0` in `pro_stfgtrep`. */
    address: number;
    /** The overlay's load base. */
    overlayBase: number;
    /** `STFGTREP_f0`'s first word — the stack-frame `addiu $sp,-0x28` (`f0.s:7`). */
    firstWord: number;
    /** The method it calls on its `src` — `lw $v0, 0x38($s1)` (`f0.s:80`). */
    methodSlot: number;
    /** Absolute RAM of that `lw`. */
    methodCallSite: number;
    /** The SAME address in `pro_fightstg` is a data word, not code: value here. */
    fightstgCollisionWord: number;
    note: string;
}

export const WA_STFGTREP_F0: WaStfgtrepF0 = {
    address: 0x80082e70,
    overlayBase: 0x80082cb0,
    firstWord: 0x27bdffd8, // addiu $sp, -0x28
    methodSlot: 0x38,
    methodCallSite: 0x80082f44, // 0x80082e70 + 0xd4
    fightstgCollisionWord: 0x8008bac0, // pro/fightstg.s:102 .L0x80082e70
    note: "STFGTREP_f0 calls src->+0x38, but +0x38 is the generic resident task-state method F0x800142ac, not a form swap: the constructor F0x800143dc installs it (exe/fns.s:4905 `la_ $v0, F0x800142ac` / :4906 `sw $v0, 0x38($s0)`), and F0x800142ac only clears +0x10/+0x14/+0x18 and bumps +0xc (exe/fns.s:4771-4777). See digivolution-tech-system-decoded-2026-07-11.md §10f, correcting §10e. It is reached from screens sharing the Digivolution animation (cnty_sel.s:111 j 0x80082e70; stagslct.s:4307/4343 pointer table), never from the battle DNA route.",
};

/**
 * The phase-21 branch, read to its convergence this pass (it was only read for
 * shape before). Arm phase 21 (F0x800a8f88) is itself a 6-state sub-machine
 * (jump table `0x800a5e3c`). In its default sub-state, when the picked queue
 * entry's acting side is non-player AND the battle-event word `0x800A4536 == 4`,
 * it plays presentation kind `0x8B` and hands opcode 5. When a party scan finds
 * no living slot to tag in, the next sub-state stages request kind 1 via
 * `0x8009C534` and spawns the class-4 task `0x8008CB44` for the player side, or
 * stages kind 1 + mode `0x0D` for the enemy side.
 */
export interface WaPhase21Branch {
    /** The predicate read to select the branch. */
    predicate: string;
    /** What the branch does. */
    action: string;
    evidence: string;
}

export const WA_PHASE21_BRANCHES: readonly WaPhase21Branch[] = [
    {
        predicate: "queue entry's acting side != 0 (non-player) AND `*(s16)0x800A4536 == 4`",
        action: "presentation kind 0x8B, then hand off opcode 5 (`ctx->unk30(ctx, 5)`), return",
        evidence: "pro/wfightmn.s:3219-3234 (.L0x00003220: lh $v1,0x4536; li $v0,4; bne; li $v0,0x8b; sw 0x50; ... li $a1,5)",
    },
    {
        predicate: "party scan (0x800A4470, 3 slots) finds no living slot (a2 == -1), acting side == 0 (player)",
        action: "stage request kind 1 via `0x8009C534(2)`; sound 0x6004|8; presentation kind 0x53; hand off opcode 2; spawn `0x8008CB44`",
        evidence: "pro/wfightmn.s:3355-3369 (.L0x00003450: jal 0x8009c534; li $a0,2; ...; jal 0x8008cb44)",
    },
    {
        predicate: "party scan finds no living slot, acting side != 0 (enemy)",
        action: "stage request kind 1 via `0x8009C534(1)`; presentation kind 0x52; hand off opcode 0x18; spawn a record with mode 0x0D",
        evidence: "pro/wfightmn.s:3373-3390 (.L0x00003498: jal 0x8009c534; li $a0,1; ...; li $v0,0x52 ...)",
    },
    {
        predicate: "party scan finds a living slot (a2 != -1)",
        action: "spawn the tagged-in fighter via 0x80087000 with the combatant's +0x0C restored, hand off opcode 2 (or set ctx+0x14 = 2/3 for the spawn sub-states)",
        evidence: "pro/wfightmn.s:3316-3347 (.L0x000033bc ... .L0x0000342c)",
    },
];

/**
 * The sequencer's supporting routines in `pro/wfightmn` — the combatant-table
 * loader, the queue sweeps and the shared Tag/Blast cleanup the arms call. They
 * are not arms of the 24-entry table; they are the machinery around it.
 */
export interface WaSequencerHelper {
    address: number;
    name: string;
    /** What it does, in the terms the arms above use. */
    role: string;
    evidence: string;
}

export const WA_SEQUENCER_HELPERS: readonly WaSequencerHelper[] = [
    {
        address: 0x800a66b0, name: "loadCombatantTable",
        role: "copies each existing party member's four fighting stats and its live species into the flat combatant table (0x800A4470) and seeds the three enemy-block records (0x800A44D0)",
        evidence: "pro/wfightmn.s:571 (F0x800a66b0); wfightmn.md:32",
    },
    {
        address: 0x800a69b8, name: "sweepQueueForCrest",
        role: "loops the three party slots and calls 0x800a6920 on each",
        evidence: "pro/wfightmn.s:765 (F0x800a69b8); wfightmn.md:35",
    },
    {
        address: 0x800a69f0, name: "markQueuedTarget",
        role: "sets the report word 0x80042B84[slot] bit 6, and bit 7 when the acting fighter's move matches the queued one",
        evidence: "pro/wfightmn.s:779 (F0x800a69f0)",
    },
    {
        address: 0x800a6b18, name: "markTargetForActor",
        role: "finds the actor's slot and marks the target's report word the same way as 0x800a69f0",
        evidence: "pro/wfightmn.s:853 (F0x800a6b18)",
    },
    {
        address: 0x800a6920, name: "recoverCrestEnqueue",
        role: "when the combatant carries accessory id 0x140 in +0x3C8/+0x3CA, stages request 0x8009c6a4",
        evidence: "pro/wfightmn.s:727 (F0x800a6920); 3d-battle-complete-model-2026-08-19.md:1525",
    },
    {
        address: 0x800a7328, name: "cancelPendingReaction",
        role: "the shared Tag/Blast cleanup: clears the actor's pending reaction (queued kinds 0x13 and 8) and its flag",
        evidence: "pro/wfightmn.s:1369 (F0x800a7328); wfightmn.md:37",
    },
    {
        address: 0x800a9cb4, name: "battleActionSequencer",
        role: "the outer lifecycle / dispatcher this module ports: phase 1 dispatch, phases 3..26 arm jump, phase 0/2 and overrun hand-offs",
        evidence: "pro/wfightmn.s:4028 (F0x800a9cb4)",
    },
];

/** The routing decision `F0x800a9cb4` reaches for one (phase, subState) pair. */
export type WaSequencerRoute =
    /** phase 1: dispatch the action opcode through its thunk; `defaulted` is the out-of-range li $a1,3 path. */
    | { action: "opcode"; subState: number; thunk: number; opcode: number; defaulted: boolean }
    /** phases 3..26: jump to the action arm. */
    | { action: "arm"; phase: number; arm: WaActionArm }
    /** phase 0: hand off with opcode 1, then refresh the queue index from [0x800a4368]. */
    | { action: "refreshIndex"; opcode: 1 }
    /** phase 2: with the child idle, hand off opcode 0. */
    | { action: "awaitChild"; opcode: 0 }
    /** phase outside 0..26: hand off opcode 1, then advance the queue. */
    | { action: "overrun"; opcode: 1 };

/** The arm a sequencer phase selects, or null when the phase is outside 3..26. */
export function waActionArmForPhase(phase: number): WaActionArm | null {
    const idx = (phase - 3) >>> 0;
    return idx < WA_ACTION_ARM_TABLE.length ? (WA_ACTION_ARM_TABLE[idx] as WaActionArm) : null;
}

/** The thunk an action opcode (subState 1..24) selects, or null. */
export function waActionOpcodeForSubState(subState: number): WaActionOpcode | null {
    const idx = (subState - 1) >>> 0;
    return idx < WA_ACTION_OPCODE_TABLE.length ? (WA_ACTION_OPCODE_TABLE[idx] as WaActionOpcode) : null;
}

/**
 * The one shared dispatcher: `F0x800a9cb4` (`wfightmn.s` file `0x3ed4`).
 *
 * It reads `ctx+0x10` (the phase). Phase 1 dispatches `ctx+0x14` (the action
 * opcode) through the 24-entry thunk table; an out-of-range opcode falls to the
 * shared `li $a1, 3` thunk. Phases 3..26 jump into the arm table. Phase 0 stages
 * a handoff and refreshes the queue index; phase 2 waits on the child and hands
 * off opcode 0; anything outside 0..26 takes the overrun path (hand off opcode 1
 * then advance the queue). The phase-2 child check is a runtime value and is
 * supplied by the caller, not by this table.
 */
export function waSequencerRoute(phase: number, subState: number): WaSequencerRoute {
    if (phase === 1) {
        const t = waActionOpcodeForSubState(subState);
        if (t) return { action: "opcode", subState, thunk: t.thunk, opcode: t.opcode, defaulted: false };
        // guard failed: wfightmn.s 0x3ff4 -> 0x4018, the shared `li $a1, 3` thunk
        return { action: "opcode", subState, thunk: 0x800a9df8, opcode: 0x03, defaulted: true };
    }
    const arm = waActionArmForPhase(phase);
    if (arm) return { action: "arm", phase, arm };
    if (phase === 0) return { action: "refreshIndex", opcode: 1 };
    if (phase === 2) return { action: "awaitChild", opcode: 0 };
    return { action: "overrun", opcode: 1 };
}
