/**
 * THE stage cast-list system: the scene descriptor's +0x4C actor list, and the
 * two loops the field's cast rebuild runs over it.  One module for every stage,
 * because the original has ONE rebuild (F0x8008AE50) that every stage's own
 * data feeds.
 *
 * ── the reader, read end to end from fieldstg.s (overlay base 0x80082cb0) ──
 *
 * THE LIST.  Descriptor+0x4C points at an array of 0-terminated pointers to
 * 20-byte records `{flagList, ptrB, slot<<16|id, y<<16|x, n}`.  The table is
 * decoded for all 281 stages by `tools/extract_cast_lists.py` into
 * web/assets/data/stage_cast_lists.json.
 *
 * LOOP A — the player (file 0x81f8-0x82cc).  Walk the records in list order;
 * a record whose +0x8 halfword is 1, 0x6a, or in [0x146, 0x148) is a player
 * candidate:
 *
 *     .L0x00008218: lh  $v1, 0x8($s1)      # the record's id
 *     .L0x0000821c: li  $v0, 0x6a
 *     .L0x00008220: beq $v1, $v0, .L0x00008254
 *     .L0x00008230: beq $v1, $s3, .L0x00008254      # $s3 == 1
 *     .L0x00008240: slti $v0, $v1, 0x148
 *     .L0x00008248: slti $v0, $v1, 0x146   # [0x146, 0x148)
 *
 * and a candidate whose gate passes wins with the FIRST pass:
 *
 *     .L0x00008254: lw  $a0, ($s1)         # record+0, the flag list
 *     .L0x0000825c: beqz $a0, .L0x0000827c # null gate -> accept
 *     .L0x00008264: lw  $v0, 0x8($s6)      # [0x80058abc+8] = F0x80016924
 *     .L0x0000826c: jalr $v0
 *     .L0x00008274: bne $v0, $s3, ...      # accept only an answer of 1
 *     .L0x0000827c: lh  $s2, 0x8($s1)      # $s2 = the winning id
 *
 * After the loop, `$s2 == 0` builds the player as id 2 and any winner builds
 * it as itself (file 0x829c-0x82d0: `li $a0, 0x2` / `move_ $a0, $s2`), through
 * F0x8009116c at scene+0x18.
 *
 * LOOP B — every other actor (file 0x83b4-0x849c).  The same walk, and every
 * record that is NOT one of the four player ids and whose gate passes is built
 * through the same constructor with the record's own slot (record+0xa) and its
 * position (record+0xc/+0xe << 8), and the record's `n` (+0x10) goes to
 * char+0x60.  There is no id filter of its own: this is why a high-id record
 * with no dialogue pointer — the special block actors, the s820 boss — is an
 * ordinary spawn.
 *
 * THE GATE is the {u16 id, u16 expected} AND-list read by F0x80016924
 * (exe/fns.s:7184-7211): every `get_flag(id) == expected` must hold, and the
 * list ends on an id halfword of 0xFFFF.  A null/empty list passes.  The two
 * call sites test it differently — loop A requires exactly 1, loop B any
 * non-zero — but F0x80016924 only ever returns 0 or 1, so one predicate
 * expresses both.
 *
 * The walker supplies the flag store through `matches`; the extracted data is
 * web/assets/data/stage_cast_lists.json (every value mined by
 * tools/extract_cast_lists.py, which also derives the dive-form-marker and
 * charId-1 files from this same decode so the three cannot drift apart).
 */

/** The player candidate ids, read out of loop A's own compares. */
export const CAST_PLAYER_IDS = [1, 0x6a, 0x146, 0x147] as const;

/** The id loop A falls back to when no candidate's gate passes (`li $a0, 0x2`). */
export const CAST_DEFAULT_PLAYER_ID = 2;

/** One `{u16 id, u16 expected}` pair of a record's gate list. */
export interface CastGateCondition {
    id: number;
    expected: number;
}

/**
 * One 20-byte cast record as `tools/extract_cast_lists.py` decodes it.
 * `ptrB` is the record's dialogue pointer, kept as the RAM address the decode
 * read (null when the record carries none — the block actors and every other
 * non-speaking actor).
 */
export interface CastRecord {
    id: number;
    slot: number;
    x: number;
    y: number;
    n: number;
    gate: CastGateCondition[];
    ptrB?: number | null;
}

/** stage id -> its cast list, in the array's own order. */
export type CastListTable = Record<string, CastRecord[]>;

/** The flag predicate the gate calls: `get_flag(id) == expected`. */
export type CastFlagMatch = (id: number, expected: number) => boolean;

/** True when the player-id set above names this record's id. */
export function isPlayerCastId(id: number): boolean {
    return (CAST_PLAYER_IDS as readonly number[]).includes(id);
}

/**
 * F0x80016924's answer for one record's gate: every pair must match, and an
 * empty list passes.  A record with no gate decodes to an empty list, which is
 * the original's null-pointer arm.
 */
export function castGatePasses(
    gate: readonly CastGateCondition[] | null | undefined,
    matches: CastFlagMatch,
): boolean {
    for (const c of gate ?? []) {
        if (!matches(c.id, c.expected)) return false;
    }
    return true;
}

/**
 * Loop A: the record that builds the player, or null when no candidate's gate
 * passes (the caller then uses `CAST_DEFAULT_PLAYER_ID`).  Records are tried in
 * list order and the FIRST pass wins — a later candidate does not displace it.
 */
export function castPlayerRecord(
    records: readonly CastRecord[] | null | undefined,
    matches: CastFlagMatch,
): CastRecord | null {
    for (const r of records ?? []) {
        if (!isPlayerCastId(r.id)) continue;
        if (castGatePasses(r.gate, matches)) return r;
    }
    return null;
}

/**
 * The player's character id: the winning candidate's id, or 2.  This is the id
 * the story scripts name as an actor (the resolver looks characters up by id),
 * and the id whose sprite the player is drawn with: 1 = P001PLAY, 2 = P002PLAY
 * (Junior), 0x6a = the Underground Path form, 0x146 = Digmon, 0x147 =
 * Submarimon.
 */
export function castPlayerId(
    records: readonly CastRecord[] | null | undefined,
    matches: CastFlagMatch,
): number {
    return castPlayerRecord(records, matches)?.id ?? CAST_DEFAULT_PLAYER_ID;
}

/**
 * Loop B: every actor the cast list builds, in list order — the records that
 * are not player candidates and whose gate passes.  `slot`, `x`, `y` and `n`
 * are the fields the constructor takes; the caller keeps them with the record.
 */
export function castActorRecords(
    records: readonly CastRecord[] | null | undefined,
    matches: CastFlagMatch,
): CastRecord[] {
    const out: CastRecord[] = [];
    for (const r of records ?? []) {
        if (isPlayerCastId(r.id)) continue;
        if (!castGatePasses(r.gate, matches)) continue;
        out.push(r);
    }
    return out;
}
