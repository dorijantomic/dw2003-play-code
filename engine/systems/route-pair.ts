// engine/systems/route-pair.ts
//
// THE SHARED SYSTEM: the disc's two "which way did you come in" scalars, and the one
// predicate that reads them. This is the port of a single mechanism, not a per-place row.
//
// ── What the two halfwords actually are ──
//
// They live at `D0x80048D34 + 0x44` (0x80048D78) and `+0x46` (0x80048D7A) — two u16
// inside the resident save/party/collection block, NOT inside the two bag byte arrays at
// `+0x7C + id` and `+0x20F + id`. `F0x800161D8`, the one routine that adds or removes an
// item, never reads or writes either of them; nothing in the item system does.
//
// Their only writers in the whole disc are two sites in `pro/fieldstg.s`, and both write
// the SAME two fields of the SAME 24-byte type-7 step record:
//
//   SITE A — fieldstg.s:5773 (`sh $v0,0x44($v1)`, file 0x5A18, RAM 0x800886C8) and
//            fieldstg.s:5778 (`sh $v0,0x46($v1)`, file 0x5A2C, RAM 0x800886DC), the
//            second of them sitting in the delay slot of the case's final `j`:
//              .L0x00005a08 lw $v0,0x64($s0)      cmd = the record the step-load chose
//              .L0x00005a0c lui $v1,0x8005
//              .L0x00005a10 lhu $v0,0x14($v0)    record+0x14
//              .L0x00005a14 addiu $v1,-0x72cc    $v1 = 0x80050000-0x72CC = 0x80048D34
//              .L0x00005a18 sh $v0,0x44($v1)
//              .L0x00005a24 lhu $v0,0x16($v0)    record+0x16
//              .L0x00005a2c sh $v0,0x46($v1)    (in the `j`'s delay slot)
//            It is the convergence point of the OP 1 case of the PLAYBACK step executor
//            `F0x800885D4` (file 0x5924, the 14-entry table at file 0x1E8). There is no
//            branch and no zero test between the two stores, so a record carrying
//            params[5]=params[6]=0 writes (0,0) — which is how the pair clears.
//
//   SITE B — fieldstg.s:8780 (`sh $v0,0x44($v1)`, file 0x8914, RAM 0x8008B5C4) and
//            fieldstg.s:8785 (`sh $v0,0x46($v1)`, file 0x8928, RAM 0x8008B5D8), in the
//            type-7 transition object's handler `F0x8008AA10`:
//              .L0x00008904 lw $v0,0x7c($s4)      rec = the record POINTER stashed by the
//                                                 op 9/10 dive launcher
//              .L0x0000890c lhu $v0,0xa($v0)     rec+0x0A
//              .L0x00008914 sh $v0,0x44($v1)
//              .L0x00008920 lhu $v0,0xc($v0)     rec+0x0C
//              .L0x00008928 sh $v0,0x46($v1)
//            Ops 9 and 10 hand `record + 0xa` to the field character's vtable slot +0x124
//            (fieldstg.s:14682 installs `F0x8008F3E4` there), which reaches the transition
//            constructor `F0x8008C078`, which stores that pointer at obj+0x7C. So
//            `rec+0x0A` IS `record+0x14` and `rec+0x0C` IS `record+0x16`: site B is not
//            an independent writer, it is op 1's store reached by the other two ops.
//
// So the pair is published by exactly three opcodes — 1, 9 and 10 — and by nothing else.
// Ops 0, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13 and 14+ write neither half.
//
// ── The one reader, and the band split ──
//
// `F0x800160A8` (exe/fns.s:6679-6712) is reached from the scene VM's flag GETTER
// `F0x800163B0` — the address the image itself holds at `[0x80048ACC]` — and it is ONE
// predicate space spread over the two scalars:
//
//   F0x800160A8(index, expected):
//     $a2 = index ; if (index < 0x1E) marker = u16[0x80048D78], target = index + 1
//                                 else     marker = u16[0x80048D7A], target = index - 0x1D
//     return expected ? (marker == target) : (marker != target)
//
// The key half therefore addresses 1..30 and the companion half 1..0x1E2; the value 0 is
// addressable by no index on either side, which is what makes an unconditional (0,0) store
// a real clear.
//
// ── The bank, and a delay-slot trap ──
//
// The predicate is bank **0x7E**, not 0x80. `F0x800163B0`'s dispatch chain loads each
// bank constant in the DELAY SLOT of the previous compare, so the constant belongs to
// the next test (exe/fns.s:6934-6958: `li $v0,0x7e` at 0x80016534 is compared at
// 0x8001654C, which calls F0x800160A8). Pairing each constant with the call beside it
// shifts every bank from 0x70 up by one and makes the marker look like bank 0x80.
// `tests/route-pair-publish.test.js` also runs the image's own dispatcher for every
// bank and records which routine each one reaches:
//
//   bank 0x00-0x40 -> F0x80015590   stored bit
//   bank 0x60      -> F0x80015EC8   the current screen id
//   bank 0x70      -> F0x80015D90   the D0x80048AD8 table
//   bank 0x72      -> F0x80015FBC   the party-Charisma ladder
//   bank 0x7E      -> F0x800160A8   THIS predicate
//   bank 0x80-0x8E -> F0x80015F04   the item bag's carried/worn counts
//   bank 0x92      -> F0x80015F70   the card collection
//
// and the setter `F0x800165AC` routes banks 0x80..0x8E to `F0x800161D8`, the bag.
// Bank 0x80 is an item bank, not the marker bank.
//
// Ledger: encounter-zone-group-key-written-on-map-transition,
// encounter-zone-group-key-record-is-type7-step-record,
// encounter-zone-group-key-value-domain, encounter-companion-scalar-is-second-route-coordinate,
// route-pair-clears-on-unkeyed-warp, route-pair-gates-family-b-npc-spawns.

/** The key half, as an offset into the resident save/party/collection block. */
export const ROUTE_KEY_OFFSET = 0x44;      // 0x80048D34 + 0x44 = 0x80048D78
/** The companion half, the next u16. */
export const ROUTE_COMPANION_OFFSET = 0x46; // 0x80048D34 + 0x46 = 0x80048D7A

/** The flag bank whose GET is `F0x800160A8` (`slti $v0,$a2,0x1e` splits the space). */
export const ROUTE_PAIR_BANK = 0x7e;
/** `andi $a3,$a0,0x1ff` — the index the getter passes on. */
export const ROUTE_PAIR_INDEX_MASK = 0x1ff;
/** `slti $v0,$a2,0x1e` — below this the key half answers, at or above it the companion. */
export const ROUTE_PAIR_KEY_BAND = 0x1e;
/** `addiu $v0,$a2,0x1` on the key side. */
export const ROUTE_PAIR_KEY_BIAS = 1;
/** `addiu $v0,$a2,-0x1d` on the companion side. */
export const ROUTE_PAIR_COMPANION_BIAS = -0x1d;

/** The two step-record fields both writer sites read (`record+0x14`, `record+0x16`). */
export const ROUTE_PAIR_PARAM_FIELDS = [5, 6] as const;

/**
 * The opcodes whose handler reaches one of the two stores. Ops 1 (site A) and 9/10
 * (site B). Everything else in the 14-entry playback table returns without touching
 * either half — including op 14, which is also a stage change.
 */
export const ROUTE_PAIR_PUBLISH_OPS: readonly number[] = [1, 9, 10];

/** Does this playback opcode publish the route pair? (ops 1, 9 and 10 do.) */
export function publishesRoutePair(op: number): boolean {
    return ROUTE_PAIR_PUBLISH_OPS.includes(op);
}

/** The two scalars, as the disc holds them. */
export interface RoutePair {
    key: number;
    companion: number;
}

/**
 * A step record's own two fields, as both writer sites read them: `lhu record+0x14` and
 * `lhu record+0x16`, which are `params[5]` and `params[6]` of the 24-byte record. The
 * stores are verbatim — there is no bias here; the `+1` / `-0x1d` shifts belong to the
 * READER, and are applied by {@link routePairTarget}.
 */
export function routePairFromParams(params: readonly number[] | undefined): RoutePair {
    return {
        key: (params?.[ROUTE_PAIR_PARAM_FIELDS[0]] ?? 0) & 0xffff,
        companion: (params?.[ROUTE_PAIR_PARAM_FIELDS[1]] ?? 0) & 0xffff,
    };
}

/** Which half answers a given predicate index, and the value that half must hold. */
export function routePairTarget(index: number): { offset: number; value: number } {
    const i = index & ROUTE_PAIR_INDEX_MASK;
    return i < ROUTE_PAIR_KEY_BAND
        ? { offset: ROUTE_KEY_OFFSET, value: i + ROUTE_PAIR_KEY_BIAS }
        : { offset: ROUTE_COMPANION_OFFSET, value: i + ROUTE_PAIR_COMPANION_BIAS };
}

/**
 * `F0x800160A8` with `expected != 0` — the polarity the scene VM's spawn gates use.
 * Returns 1 only when the half this index names holds exactly the value it must.
 */
export function routePairPredicate(index: number, pair: RoutePair): 0 | 1 {
    const t = routePairTarget(index);
    const held = t.offset === ROUTE_KEY_OFFSET ? pair.key : pair.companion;
    return (held & 0xffff) === (t.value & 0xffff) ? 1 : 0;
}

/**
 * The whole routine, both polarities: `F0x800160A8(index, expected)`. `expected === 0`
 * is the mirror arm — it answers 1 when the half does NOT hold the value — so a scene can
 * ask "did I arrive by some route OTHER than this one".
 */
export function routePairTest(index: number, expected: number, pair: RoutePair): 0 | 1 {
    const hit = routePairPredicate(index, pair);
    return (expected ? hit : hit ^ 1) as 0 | 1;
}

/** The packed flag id a scene writes for `index`, as `F0x800163B0` splits it. */
export function routePairFlagId(index: number): number {
    return ((ROUTE_PAIR_BANK << 8) | (index & ROUTE_PAIR_INDEX_MASK)) & 0xffff;
}

/** What a resolved warp knows about the pair: the two shapes a transition can arrive in. */
export interface RoutePairExit {
    /** The exit was a maze self-warp whose hop resolved through the disc's exit table. */
    selfWarp?: boolean;
    /** `routeWords` from the publishing step record — site A or site B, read verbatim. */
    routeWords?: { d78: number; d7a: number };
    /** The resolved maze hop's own pair, out of that table (`entryKey`/`entryCompanion`). */
    entryKey?: number | null;
    entryCompanion?: number | null;
}

/**
 * WHAT A TRANSITION PUBLISHES — the one decision, so no screen can invent a pair.
 *
 * `null` means "this transition reaches no writer site at all", which is the answer for
 * a cutscene handoff, an op-14 pad handoff and any door on a stage with no step
 * program: the disc has no third writer, so both halves keep whatever the last step
 * left there. That is the difference the pre-2026-10-03 walker missed — it wrote a
 * zero of its own there. Measured across the 819 shipped exit rows, that is two rows
 * (s260's door to s275, s410's gondola to s440); the rest already published the same
 * numbers, read from the converted exit row instead of from the step record.
 *
 * A pair of zeros, by contrast, is a real answer: the stores have no zero test, so a
 * publishing record whose params[5] and params[6] are both 0 clears the pair, and no
 * index on either band can match a cleared half.
 */
export function routePairCommit(exit: RoutePairExit): RoutePair | null {
    if (exit.selfWarp) {
        // The self-warp stages' own step records are stale placeholders on the disc;
        // the real pair comes out of the exit table the overlay memcpy's in.
        if (exit.entryKey == null) return null;
        return { key: exit.entryKey & 0xffff, companion: (exit.entryCompanion ?? 0) & 0xffff };
    }
    if (exit.routeWords) {
        return { key: exit.routeWords.d78 & 0xffff, companion: exit.routeWords.d7a & 0xffff };
    }
    return null;
}
