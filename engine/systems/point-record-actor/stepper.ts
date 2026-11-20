import {
  POINT_RECORD_DELTA_CLAMP,
  POINT_RECORD_SCRIPT_END,
  type PointCursor,
  type PointEndArm,
  type PointRecord,
  type PointScriptEntry,
  type PointStepOptions,
} from "./types.ts";

/**
 * The claim walk, fieldstg F0x800894d8.  Returns the index of the first record
 * whose atlas byte is `tag`, or -1.  The original resumes from a cursor in the
 * global at 0x8005b8f8, so two claims for the same tag would return two
 * DIFFERENT records; no table read so far carries a repeated tag, and this
 * walk's first-match rule is that case.  `claimedSameTagTwice` is the census
 * hook that keeps the claim honest.
 */
export function claimRecord(
    records: readonly PointRecord[],
    tag: number,
): number {
    for (let i = 0; i < records.length; i++) {
        if (records[i]?.atlasFlag === tag) return i;
    }
    return -1;
}

/** True when any table carries a tag twice, which the first-match walk cannot
 *  express.  `tests/point-record-actors.test.js` asserts this is false for
 *  every stage in the shipped table. */
export function claimedSameTagTwice(records: readonly PointRecord[]): boolean {
    const seen = new Set<number>();
    for (const r of records) {
        if (!r?.atlasFlag) continue;
        if (seen.has(r.atlasFlag)) return true;
        seen.add(r.atlasFlag);
    }
    return false;
}

/**
 * One call of the shared stepper.  `cursor` is advanced in place; the return is
 * the entry the member is showing this blank, which is what the original's
 * callers store into a record.
 *
 * The random the original subtracts is read through the global function
 * pointer at 0x8004df9c; the walker supplies the blank count, which is what
 * that function returns off the console.
 */
export function stepPointRecordCursor(
    cursor: PointCursor,
    script: readonly PointScriptEntry[],
    opts: PointStepOptions,
): number {
    if (!script.length) return POINT_RECORD_SCRIPT_END;
    const { variant, delta = 1 } = opts;
    const arm: PointEndArm = opts.arm ?? "restart";
    const at = (i: number): PointScriptEntry =>
        script[i] ?? script[script.length - 1] as PointScriptEntry;
    // The subtraction happens ONCE, on the outermost call: the original's
    // recursion carries depth+1 in `$a3` and skips it on every later step
    // (`bnez $s4, ...` / `addiu $a3, $s4, 0x1`).
    let hold = cursor.hold - Math.min(delta, POINT_RECORD_DELTA_CLAMP);
    let i = cursor.entry;
    let value = at(i)[0];
    for (let guard = 0; guard <= script.length + 2; guard++) {
        if (hold > 0) break;
        const next = i + 1;
        hold += at(next)[1];
        value = at(next)[0];
        if (value !== POINT_RECORD_SCRIPT_END) {
            i = next;
            continue;
        }
        if (variant === "follow-u8") {
            // wstag805.s file 0x298/0x2a8: the end entry's third byte is the
            // index to continue at, and its delay byte is charged on top.
            const jumped = at(next)[2] & 0xff;
            i = jumped;
            hold += at(jumped)[1];
            value = at(jumped)[0];
            continue;
        }
        if (variant === "rise-u8") {
            // wstag680.s file 0x1a8/0x1b0/0x1b4: the end entry's THIRD byte is
            // a one-shot RISE the stepper parks in the cursor's own +4 word,
            // the index goes back to ZERO (not to that byte), and the entry-0
            // delay is charged on top -- `$s0` is the script BASE again at
            // file 0x1ac, so `lbu $v1, 0x2($s0)` is entry 0's delay, not the
            // end entry's.
            cursor.rise = at(next)[2] & 0xff;
            i = 0;
            hold += at(0)[1];
            value = at(0)[0];
            continue;
        }
        if (variant === "hold-u16") {
            // wstag415 file 0x72c-0x748: the end entry's own hold has already
            // been charged above (`lhu $v1, 0x2($s0)` at file 0x708); the end
            // arm then steps the cursor BACK onto the last real entry and
            // charges that entry's hold on top (`addiu $s0, -0x4` /
            // `addiu $v0, -0x1` / `lhu $v1, 0x2($s0)`), so the returned value
            // freezes on the last real entry for ever.
            i = next - 1;
            hold += at(i)[1];
            value = at(i)[0];
            continue;
        }
        if (variant === "stop-u16" || arm === "stop") {
            cursor.entry = next;
            cursor.hold = hold;
            return POINT_RECORD_SCRIPT_END;
        }
        // `$a2 == 0`: reset the index to 0 and charge entry 0's hold on top of
        // what it just added, then keep going in the SAME call.
        i = 0;
        hold += at(0)[1];
        value = at(0)[0];
    }
    cursor.entry = i;
    cursor.hold = hold;
    if (opts.terminates === false && cursor.entry >= script.length) {
        return POINT_RECORD_SCRIPT_END;
    }
    return value;
}

/**
 * The pad-flash copy's end test.  Its scripts carry no terminator, so the end
 * is the cursor stepping past the last entry -- which is what the old
 * materialize port detected from a non-positive hold.  Reading it off the
 * cursor is the same test and does not depend on any entry's hold being
 * non-zero.
 */
export function padSlotEnded(
    cursor: PointCursor,
    scriptLength: number,
): boolean {
    return cursor.entry >= scriptLength;
}
