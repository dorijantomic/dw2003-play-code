/**
 * THE point-record actor system: every field stage object that claims its own
 * stage's dormant point-sprite records by their atlas tag and animates them.
 *
 * One module for every registry member of this family, because the original has ONE system
 * with five per-member state machines, not five systems.  Read out of the
 * overlays on 2026-10-04; the table is web/assets/data/point_record_actors.json
 * and every value in it is mined by tools/extract_point_record_actors.py.
 *
 * ── the three shared pieces, and the asm each is read from ────────────────
 *
 * THE CLAIM, fieldstg F0x80089548 / F0x800894d8 (fieldstg.s file 0x6898 /
 * 0x6828).  It is called by every member and there is one copy:
 *
 *     .L0x000068a0: sw  $a0, -0x4704($v0)   # 0x8005b8fc = the tag wanted
 *     .L0x000068a8: lw  $v1, -0x6270($v0)   # 0x80099d90 = the stage's table
 *     .L0x000068b8: sw  $v1, -0x4708($v0)   # 0x8005b8f8 = the walk cursor
 *     .L0x0000682c: lw  $a0, -0x4708($v0)   # resume where the last call stopped
 *     .L0x00006834: lbu $v0, 0x2($a0)       # record+2 == 0 ends the table
 *     .L0x00006850: lbu $v0, -0x1($v1)      # record+1 = the atlas tag
 *     .L0x00006870: bnez $v0, .L0x00006850  # walk on in 0x12-byte strides
 *     .L0x00006860: j   0x80089528          # match: cursor steps +0x12, ret 1
 *
 * The walk RESUMES, so asking for the next tag finds the next record; asking
 * for a tag nothing carries returns 0 with the cursor left past the end.  Every
 * tag the seventeen members claim is carried by exactly one row of that member's
 * own table, so `claimRecord`'s plain first-match walk and the original's
 * resumable one agree on everything shipped.  That is a MEASUREMENT, not an
 * assumption: over all 294 point-sprite tables, 0x00FF excluded (no overlay's
 * claim loop compares against it -- it is the FIELDCOM sentinel), seven stages
 * do carry a repeated claimable tag (s421, s555, s630, s635, s640, s645, s680)
 * and none of the seventeen members is on one.
 * `tests/point-record-actors.test.js` pins those seven names, so a member added
 * to one fails instead of quietly claiming the wrong row.
 *
 * THE STEPPER, one routine repeated at each overlay's own base.  wstag785.s
 * file 0x04, wstag810.s file 0x0, wstag212.s file 0x04, wstag795.s/wstag800.s
 * file 0x24, wstag820.s file 0x24, wstag805.s file 0x1ec are the same twenty
 * instructions.  Read once, from wstag785.s file 0x04:
 *
 *     .L0x00000034: lh  $v1, ($s1)          # cursor.entry
 *     .L0x00000038: lw  $v0, -0x2064($v0)   # 0x8004df9c, the frame-delta fn
 *     .L0x0000003c: sll $v1, 0x2
 *     .L0x00000044: addu $s0, $s2, $v1      # &entry
 *     .L0x0000004c: slti $v0, $v1, 0x5      # clamp the delta to 4
 *     .L0x00000058: li  $v1, 0x4
 *     .L0x0000005c: bnez $s4, .L0x00000074  # $a3 != 0 -> skip the decrement
 *     .L0x0000006c: subu $v0, $v1
 *     .L0x00000070: sh  $v0, 0x2($s1)      # cursor.hold -= delta
 *     .L0x0000007c: bgtz $v0, .L0x00000100 # still counting -> return
 *     .L0x0000008c: addiu $v0, 0x1
 *     .L0x00000090: sh  $v0, ($s1)         # entry += 1
 *     .L0x0000009c: addu $v0, $v1
 *     .L0x000000a8: sh  $v0, 0x2($s1)      # hold += the new entry's hold
 *     .L0x000000b0: li  $v0, 0xff
 *     .L0x000000b4: bne $v1, $v0, .L0x000000f0
 *     .L0x000000f8: jal 0x800a5de4          # tail-call self, $a3 = $s4 + 1
 *     .L0x000000fc: addiu $a3, $s4, 0x1
 *     .L0x00000100: lh  $v0, ($s0)         # return entry.value
 *
 * FOUR VARIANTS of that routine exist, and they differ in two knobs plus which
 * end arm they keep -- so they are ONE function with parameters, which is what
 * `stepPointRecordCursor` is:
 *
 *   overlay copy   hold read   end arm on value 0x00ff
 *   ------------   ---------   ---------------------------------------------
 *   base u16       lhu 0x2     `$a2 == 0`  -> reset to entry 0, charge its hold
 *   (wstag785/212/225/750/795/800, wstag790)         recurse with $a3 + 1
 *                  `$a2 != 0`  -> return 0xff with the cursor past the end
 *   base u8        lbu 0x2     the same two arms (wstag810)
 *   follow-next    lbu 0x2     ONLY this one: the end entry's THIRD byte is the
 *   (wstag805 file 0x1ec, lbu 0x3 / sh 0x4 at :0x298/:0x2a8)   next index
 *   stop           lhu 0x2     only this one: 0xff always returns 0xff with the
 *   (wstag820 file 0x24, no `$a2` test at :0xa4)               cursor past the end
 *
 * The 0x00ff marker is a VALUE, compared against `li $v0, 0xff` in every copy.
 * No copy compares against -1.
 *
 * THE METHOD BLOCK, EXE F0x800143dc, the allocator every copy calls:
 * +0x28 setState, +0x2c setClip, +0x38 advance state (clear clip, counter and
 * timer), +0x3c advance clip (clear counter and timer), +0x40 advance counter
 * (clear the timer), +0x44 tick the timer, +0x48 the per-frame callback.
 * `advanceState` / `advanceClip` / `advanceCounter` below are those three.
 *
 * ── the five per-member machines, which really are different code ──────
 *
 * `pad-flash` (s212 0x32a, s225 0x32f, s750 0x34e, s925 0x357).  The stage
 * script's `SETANIM <id> <pad>` names the pad; the actor moves its three
 * claimed records onto it and runs one script per record.  Two script VALUES
 * are special and both are read out of the copy's own tick (wstag212.s):
 *
 *     .L0x000002a0: li  $v0, 0xff          # 0x00ff ends the slot
 *     .L0x000002a4: beq $v1, $v0, .L0x000002bc
 *     .L0x000002a8: li  $v0, 0x12c         # 300 blinks the record off
 *     .L0x000002ac: beq $v1, $v0, .L0x000002c0
 *     .L0x000002b4: j   0x800a60ac
 *     .L0x000002b8: sb  $v0, ($s0)         # active = 1
 *     .L0x000002c4: j   0x800a60b0
 *     .L0x000002c8: sb  $zr, 0x4($s0)      # blink off: sprite 0
 *     .L0x000002cc: sb  $v1, 0x4($s0)      # otherwise the stepper's value
 *
 * `decor` (s785 0x343, s790 0x328/0x329, s795 0x344, s800 0x345/0x347).  One
 * to eight claimed records and a per-record script, plus two members that do
 * something the other two never do: s790 slides a record by adding 1 to its X
 * halfword (`addiu $v0, 0x1` in a delay slot, `sh $v0, 0xc($v1)`, wstag790.s
 * file 0x110) and waits on a record's LIVE `ctr`, because the ambient renderer
 * is what walks a mode-2 record up to 15.
 *
 * `point-record` (s805 0x348, s810 0x34a/0x34b/0x34c, s820 0x355).  A per-panel
 * recipe keyed on the object's state, over the same claim and stepper.  Two of
 * its recipes PIN a record byte in a `jal`'s delay slot, and the pin is the
 * whole reason the write list is data rather than a formula -- see the recipes
 * in the table, each of which cites the store it reproduces.
 *
 * `single` (s455 0x33c) and `rise` (s926 0x356) are the two in-place shapes:
 * same claim, same stepper, same method block, and NO pad, so they light the
 * row exactly where the stage's own point table already put it.  `single` runs
 * one script and ends on the 0x00ff arm; `rise` has no script at all and walks
 * its row down the screen a pixel a blank until the console's own bound stops
 * it.  "Down" is the record's own Y: the field draws that halfword straight
 * through (fieldstg file 0x635c `lh $a3, 0xc($s0)`), and Y grows downward.
 * Both arms are at the foot of this file, each quoting the overlay lines it
 * reproduces.
 *
 * ── the members, and the tick each one installs ───────────────────────────
 *
 * Beyond the registry members below, the table carries the UNREGISTERED
 * in-place copies: stages that build the same `single` tick with the
 * three-argument allocator wrapper (EXE F0x80014504), so it has no id and runs
 * from the first blank.  They are keyed by their own tick (0x800a5ed4) and
 * `registryCtor` is null, which is what makes `constructPointRecordActors`
 * build them at stage entry.  `tools/extract_point_record_actors.py` finds them
 * by scanning every overlay, not from a hand list.
 *
 *   pad-flash    s212 810 (0x32a) tick 0x800a5ef4  three download pads
 *                s225 815 (0x32f) tick 0x800a5ef0  the login-room pad
 *                s750 846 (0x34e) tick 0x800a5ef0  the chamber-room pad
 *                s925 855 (0x357) tick 0x800a6110  a construct-only copy
 *   decor        s785 835 (0x343) tick 0x800a5f04  four stacked records
 *                s790 808 (0x328) tick 0x800a6138  one record re-pointed
 *                s790 809 (0x329) tick 0x800a5df4  eight records, then a reveal
 *                s795 836 (0x344) tick 0x800a5f00  blink, then a ten-frame fire
 *                s800 837 (0x345) tick 0x800a5f00  the same shape as s795
 *                s800 839 (0x347) tick 0x800a6344  construct-only, one-shot
 *   point-record s805 840 (0x348) tick 0x800a60cc  four picture slots
 *                s810 842/843/844 (0x34a/0x34b/0x34c) tick 0x800a5f00  three
 *                        stations, one shape, atlas tags 5/3/1
 *                s820 853 (0x355) tick 0x800a5eb8  sound only
 *   single       s455 828 (0x33c) tick 0x800a5ebc  one row, one script, in place
 *   rise         s926 854 (0x356) tick 0x800a5f70  one row walked down 150 blanks
 *
 * `tools/inventory_stage_registry.py` re-checks every one of these citations
 * and reads the member list out of the table, so the census and this list
 * cannot drift apart silently.
 *
 * TIMEBASE.  One tick per PAL 50 Hz blank through `paceStageObjects` in
 * web/stage-objects.js, so a script's hold counts blanks exactly as it did on
 * the console at any monitor rate.
 */

import { rsin as RSIN } from "../dw3/rsin.ts";
import { randU16 } from "../dw3/random-stream.ts";

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

// ── the ambient tick (fieldstg F0x80089038) ────────────────────────────────
//
// The field engine's own per-frame pass over a stage's placement table: the
// SAME table the members above claim records from, but this is the renderer's
// code (fieldstg file 0x6388), not an overlay actor.  web/effects.js runs it
// once per rendered frame and draws what it resolves.
//
// The disc walks the table and applies THREE gates to each record before
// anything happens (fieldstg file 0x64bc-0x6550):
//
//   1. the LIVE active byte (record+0) -- `lbu $v0, ($s1)` / `beqz` at file
//      0x64bc: an inactive record neither animates nor draws, so its phase is
//      frozen until it is switched on;
//   2. the CAMERA CULL, four comparisons against the 0x1002 layer's screen
//      rect (`ctx+0x128` = EXE F0x8001E0C8, `{x, y, w, h}`):
//        X >= x0 - size && X <= x0 + w && Y >= y0 - size && Y <= y0 + h
//      (file 0x64f4-0x6550).  The record's size byte widens the LOW side
//      only -- the disc's own asymmetry.  A 0xFF (FIELDCOM) record is tested
//      at (X-0x32, Y-0x64); that adjustment is TEST-ONLY, the draw re-reads
//      the raw anchor (file 0x6774-0x67a0, and the walker's own field note).
//      A culled record does NOT advance its timer: an off-screen windmill is
//      frozen on the console, so its phase when it scrolls back in is the
//      phase it had when it left;
//   3. the animation-mode dispatch (record+5) -- modes 1/2/3 advance, 0 and
//      4+ draw without animating.

/** The ambient record as `point_sprites.json` carries it. */
export interface PointSpriteRecord {
    /** record+2; doubles as the cull radius. 0 terminates the table. */
    size: number;
    /** record+1, the atlas byte; 0xFF draws from FIELDCOM.BIN. */
    atlasFlag: number;
    /** the extractor's spelling of the 0xFF case (`"fieldcom"`). */
    atlas?: string;
    /** record+0 as the disc ships it. */
    active: number;
    /** record+5, the animation mode. */
    mode: number;
    /** record+6/+7, the loop bounds modes 1/2/3 cycle between. */
    min: number;
    max: number;
    /** record+8; the timer reload is `period << 8`. */
    period: number;
    x: number;
    y: number;
    /** record+14, the y-sort baseline (0 = the fixed pass). */
    ysort: number;
}

/** The per-record runtime web/effects.js keeps beside the table. */
export interface PointSpriteRuntime {
    sprite: number;
    ctr: number;
    dir: number;
    timer: number;
    active?: number;
    x?: number;
    y?: number;
    ysort?: number;
    /** record+5 override -- the s421 actor's write on the ordinary route. */
    mode?: number;
}

/** One prepared frame's rebase layers, in the order every consumer reads them. */
export interface PointSpriteFrame {
    /** The camera rect (the 0x1002 layer's screen rect); absent/null = no cull. */
    view?: { x: number; y: number; w: number; h: number } | null;
    /** Interpreter bytes on a native stage (F0x80089038's live table). */
    activeOverride?: readonly (number | null)[] | null;
    nativePos?: readonly ({ x: number; y: number; ysort: number } | null)[] | null;
    actorPos?: readonly ({ x: number; y: number; ysort?: number } | null)[] | null;
    liveMode?: readonly (number | null)[] | null;
}

/** Resolve one record's live state: interpreter overrides first, then the
 *  translated actor host's runtime, then the ROM table.  The draw and the tick
 *  read the same resolution, so they cannot disagree about a record. */
export function pointRecordLive(
    rec: PointSpriteRecord,
    st: PointSpriteRuntime | undefined,
    frame: PointSpriteFrame,
    i: number,
): { active: number; x: number; y: number; ysort: number; mode: number } {
    return {
        active: frame.activeOverride?.[i] ?? st?.active ?? rec.active,
        x: frame.actorPos?.[i]?.x ?? frame.nativePos?.[i]?.x ?? st?.x ?? rec.x,
        y: frame.actorPos?.[i]?.y ?? frame.nativePos?.[i]?.y ?? st?.y ?? rec.y,
        ysort: frame.actorPos?.[i]?.ysort ?? frame.nativePos?.[i]?.ysort ?? rec.ysort,
        mode: frame.liveMode?.[i] ?? st?.mode ?? rec.mode,
    };
}

/** The disc's camera cull (fieldstg file 0x64f4-0x6550).  A null view passes
 *  everything -- a caller with no camera (a lab) draws the whole stage. */
export function pointRecordInView(
    rec: PointSpriteRecord,
    x: number,
    y: number,
    view: { x: number; y: number; w: number; h: number } | null | undefined,
): boolean {
    if (!view) return true;
    const sx = rec.atlas === "fieldcom" ? x - 0x32 : x;
    const sy = rec.atlas === "fieldcom" ? y - 0x64 : y;
    return sx >= view.x - rec.size && sx <= view.x + view.w
        && sy >= view.y - rec.size && sy <= view.y + view.h;
}

/** One animation frame (F0x80089038's per-record body), gated.  `r.max === 0`
 *  records do not animate here: the disc's dispatch has no such test, but no
 *  shipped record carries mode 1-3 with max 0 (the extractor census), so the
 *  guard only keeps a malformed row inert. */
export function tickPointSpriteRecords(
    records: readonly PointSpriteRecord[],
    rt: readonly PointSpriteRuntime[],
    frame: PointSpriteFrame = {},
): void {
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const st = rt[i];
        if (!r || !st) continue;
        const live = pointRecordLive(r, st, frame, i);
        if (!r.max || live.mode < 1 || live.mode > 3) continue;
        if (!live.active) continue;
        if (!pointRecordInView(r, live.x, live.y, frame.view)) continue;
        if (st.timer >= 0x100) {
            st.timer -= 0x100;
            continue;
        }
        st.timer = r.period << 8;
        if (live.mode === 1) {
            st.sprite = st.sprite >= r.max ? r.min : st.sprite + 1;
        } else if (live.mode === 2) {
            st.ctr = st.ctr >= r.max ? r.min : st.ctr + 1;
        } else {
            st.ctr += st.dir;
            if (st.ctr > r.max) { st.ctr = Math.max(r.min, r.max - 1); st.dir = -1; }
            else if (st.ctr < r.min) { st.ctr = Math.min(r.max, r.min + 1); st.dir = 1; }
        }
    }
}

// ── the flag-gated mode writer (wstag421's stage actor) ────────────────────
//
// ONE overlay actor of this family claims no record and runs no stepper: at
// stage entry it walks its own stage's point table and writes the ANIMATION
// MODE byte (record+5) of every record whose atlas byte (+1) equals `tag`,
// from `get_flag(flag) != 0` (wstag421.s file 0x38-0x98: `li $a0, 0x1a0a` /
// `lw $v0, -0x7534($v0)` = get_flag / `sltu $a1, $zr, $v0` / `sb $a1,
// 0x3($v1)`).  On the console Qing Long City's windmills and fans are frozen
// until flag 0x1a0a is set (the s435 flag-set script is its producer); the
// walker's ORDINARY route never ran this actor -- it only existed behind
// ?nativeStages -- so the windmills spun regardless of the flag.

/** One mined mode-gate row (`point_record_actors.json` `modeGates`). */
export interface PointModeGate {
    /** the record's atlas byte (+1) the write applies to. */
    tag: number;
    /** the flag the mode follows. */
    flag: number;
}

/** Apply the disc's stage-entry write: mode = get_flag(flag) ? 1 : 0 on every
 *  record carrying the tag.  Idempotent, so the caller may run it at each
 *  stage entry (which is when the original actor runs its state 0). */
export function applyPointModeGates(
    records: readonly PointSpriteRecord[],
    rt: readonly PointSpriteRuntime[],
    gates: readonly PointModeGate[],
    getFlag: ((id: number) => number) | null,
): void {
    if (!gates?.length) return;
    for (const gate of gates) {
        const mode = getFlag && getFlag(gate.flag) ? 1 : 0;
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            const st = rt[i];
            if (rec?.atlasFlag === gate.tag && st) st.mode = mode;
        }
    }
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

const tables: Record<string, Record<string, PointMember>> = {};
const runtime: Record<string, PointActor[]> = {};
const modeGateRows: Record<string, PointModeGate[]> = {};

/** Register the extracted table (web/effects.js owns the fetch). */
export function loadPointRecordActors(table: PointActorTable): void {
    for (const [stage, members] of Object.entries(table.stages ?? {})) {
        tables[stage] = members;
    }
    // The family's ONE non-member: the stage-entry mode writer rows
    // (`modeGates`, mined by the same extractor).  web/effects.js applies them
    // at each stage entry -- the ordinary route's stand-in for the overlay
    // actor that only ever ran behind ?nativeStages.
    for (const row of table.modeGates ?? []) {
        const stage = String(row.stage);
        (modeGateRows[stage] ??= []).push({ tag: row.tag, flag: row.flag });
    }
}

/** The mode-gate rows a stage's actor writes, or an empty list. */
export function pointModeGatesFor(stageId: string): PointModeGate[] {
    return modeGateRows[stageId] ?? [];
}

/**
 * The child-pool parents (assets/data/child_pool_parents.json, mined by
 * `tools/extract_child_pool_parents.py`). They are the SAME machine with a child
 * array, so they land in the SAME registry and the same SETANIM route: a stage
 * that names one id does not have to know which table carried it.
 */
export function loadChildPoolParents(table: PointActorTable): void {
    for (const [stage, members] of Object.entries(table.stages ?? {})) {
        // The other table keys its members by the DECIMAL id; this one keys by
        // the hex spelling it prints in its own summary, so it is re-keyed here
        // rather than carrying two conventions into one registry.
        const keyed: Record<string, PointMember> = {};
        for (const m of Object.values(members)) keyed[String(m.id)] = m;
        tables[stage] = { ...(tables[stage] ?? {}), ...keyed };
    }
}

/**
 * The SETANIM route for a child-pool parent. Returns false when this stage has no
 * such member, which is the caller's "keep looking" answer.
 */
export function fireChildPoolParent(
    stageId: string,
    effectId: number,
    subId: number,
): boolean {
    const member = tables[stageId]?.[String(effectId)];
    // `parent` and `triple` are the two shapes of ONE machine -- both build a
    // child array through the same allocator and both live in this table.
    if (!member || (member.machine !== "parent" && member.machine !== "triple")) {
        return false;
    }
    const list = (runtime[stageId] ??= []);
    let actor = list.find((x) => x.member.id === effectId);
    if (!actor) {
        // `[0x8004b7bc]` found nothing, so the handler took the first free slot
        // of its ten-handle pool and called the registry ctor, which allocates
        // and registers the object but does NOT setState.
        //
        // For a `parent` the registry's construct handler then calls
        // setState/setClip itself (`wstag545` file 0x9c8-0xa9c), so it is
        // claiming by the time the walker holds it.  For a `triple` it does not,
        // so the actor arrives UNBUILT -- empty pool -- and the draw handler
        // below moves it straight to state 2, so its own state 0 (the build)
        // never runs.  See the ORDER NOTE above `tickTriple`.
        actor = createPointActor(member);
        list.push(actor);
    }
    if (member.machine === "triple") return fireTriple(actor, subId);
    return fireParent(actor, subId);
}

/**
 * The s415 Deeper Crevice SCENERY layer (assets/data/scroll_layers.json, mined
 * by `tools/extract_scroll_layers.py`).  It is the SAME registry and the same
 * tick loop as every other member here, so a stage that names its id gets it
 * through the one SETANIM route; only its own machine differs.
 */
export function loadScrollLayers(table: PointActorTable): void {
    for (const [stage, members] of Object.entries(table.stages ?? {})) {
        const keyed: Record<string, PointMember> = {};
        for (const m of Object.values(members)) keyed[String(m.id)] = m;
        tables[stage] = { ...(tables[stage] ?? {}), ...keyed };
    }
}

/**
 * The story-flag reader this module's two gates share, wired once by the game
 * loop to the SAME flag store the scene system reads (`web/game.js`
 * storyFlags).  Returns 1 when the flag is set.  Absent a wiring the
 * `scroll-layer` treats the stage as a first visit (what a fresh save is) and
 * the `two-slot` seeds its direction word to zero.
 */
let storyFlagGetter: ((id: number) => number) | null = null;

export function setScrollLayerFlag(fn: ((id: number) => number) | null): void {
    storyFlagGetter = typeof fn === "function" ? fn : null;
}

function readStoryFlag(id: number): number {
    if (!storyFlagGetter) return 0;
    return storyFlagGetter(id) ? 1 : 0;
}

/** Every stage the table names, for the census test. */
export function pointRecordActorStages(): string[] {
    return Object.keys(tables).sort();
}

/** stageId -> effect id -> the member's own id, for the census test. */
export function pointRecordActorIds(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [stage, members] of Object.entries(tables)) {
        out[stage] = Object.values(members)
            .map((m) => m.id)
            .sort((a, b) => a - b);
    }
    return out;
}

/** Does this stage ship an actor for that registry id? */
export function hasPointRecordActor(stageId: string, effectId: number): boolean {
    return Boolean(tables[stageId]?.[String(effectId)]);
}

function recOf(a: PointActor, slot: number): number | null {
    return a.rec[slot] ?? null;
}

function curOf(a: PointActor, slot: number): PointCursor {
    return (a.cur[slot] ??= { entry: 0, hold: 0 });
}

function scriptOf(a: PointMember, name: string | undefined): PointScriptEntry[] {
    return (name && a.scripts[name]) || [];
}

function seed(a: PointMember, name: string): number {
    return a.seedHolds?.[name] ?? 0;
}

function write(host: PointHost, index: number | null, patch: PointPatch): void {
    if (index === null) return;
    host.write(index, patch);
}

/** EXE F0x800142ac, the method at +0x38. */
function advanceState(a: PointActor): void {
    a.clip = 0;
    a.counter = 0;
    a.timer = 0;
    a.state += 1;
}

/** EXE F0x800142c8, the method at +0x3c. */
function advanceClip(a: PointActor): void {
    a.counter = 0;
    a.timer = 0;
    a.clip += 1;
}

/** EXE F0x800142e0, the method at +0x40. */
function advanceCounter(a: PointActor): void {
    a.timer = 0;
    a.counter += 1;
}

/** One map pixel right: the original adds 1 to the X high half (record+0xc). */
function slide(host: PointHost, a: PointActor, slot: number): void {
    const index = recOf(a, slot);
    if (index === null) return;
    host.write(index, { x: host.read(index).x + 1 });
}

function ctrOf(host: PointHost, a: PointActor, slot: number): number {
    const index = recOf(a, slot);
    return index === null ? -1 : host.read(index).ctr;
}

function sound(host: PointHost, a: PointActor, kase: number): void {
    const s = a.member.sounds?.find((x) => x.case === kase);
    if (s) host.sound?.(Number(s.packed) >>> 0);
}

/** The atlas tag the overlay's claim walk looks for, in its own order. */
function tagIndex(a: PointMember, tag: number): number | null {
    const rec = a.tags[String(tag)];
    return rec ? rec.index : null;
}

/**
 * THE RANGE CLAIM, in TABLE ORDER.  The pad-flash copies' claim walk matches
 * ANY record whose atlas byte is in `[lo, hi]` and parks the k-th such record
 * -- the k-th in the STAGE'S OWN TABLE, NOT the record whose tag is k -- into
 * slot k.  wstag212.s file 0x1f8-0x25c is the walk: the tag test is
 * `addiu $v0, -0x1` / `sltiu $v0, 0x3`, and the park into `obj+0x58+8*$a3`
 * bumps `$a3` once per MATCH, so the slot index counts matches, not tags.
 * wstag750.s file 0x1fc-0x25c is the same walk.
 *
 * On a table whose tags happen to run in order the two rules agree, and for
 * s212, s225 and s925 they do.  s750's table does not: its claimed records sit
 * at index 0 (tag 1), 10 (tag 3) and 11 (tag 2) -- `point_sprites.json` -- so
 * the console parks slot 1 on the tag-3 record and slot 2 on the tag-2 one,
 * and this helper finds that.  `tagIndex`-by-number would swap them.
 */
function claimRangeInOrder(a: PointMember, lo: number, hi: number): number[] {
    return Object.entries(a.tags)
        .map(([tag, rec]) => ({ tag: Number(tag), index: rec.index }))
        .filter((r) => r.tag >= lo && r.tag <= hi)
        .sort((x, y) => x.index - y.index)
        .map((r) => r.index);
}

/** Build the actor the overlay's own constructor would allocate. */
export function createPointActor(member: PointMember): PointActor {
    const a: PointActor = {
        member,
        state: 0,
        clip: 0,
        counter: 0,
        timer: 0,
        arm: 0,
        mode: 0,
        rec: [],
        cur: [],
        children: [],
        pool: [],
        built: false,
        selector: 0,
        armed: [],
        index: [],
        running: true,
        pad: null,
        blanks: 0,
        count: 0,
        wait: 0,
        cursor: 0,
        saved: [0, 0, 0, 0, 0],
        drive: { on: false, phase: 0, count: 0 },
        pic: null,
        anchor: null,
        anchorPos: null,
        ride: {
            route: 0,
            sub: 0,
            ctr: 0,
            divider: 0,
            xFixed: 0,
            yFixed: 0,
            xDrift: 0,
            vel: 0,
            x: 0,
            y: 0,
            counter: 0,
            cursor: { entry: 0, hold: 0 },
        },
        scroll: { visit: 0, xAcc: 0, yAcc: 0, xSpeed: 0, ySpeed: 0 },
    };
    switch (member.machine) {
        case "pad-flash": {
            // The claim walk grabs the records whose atlas tag is 1..N in
            // TABLE ORDER, one slot each -- NOT by tag number.  See
            // `claimRangeInOrder`; s750 is the shipped stage where the two
            // rules differ.
            const slots = member.arm?.slots ?? 0;
            const recs = claimRangeInOrder(member, 1, slots);
            for (let k = 0; k < slots; k++) {
                a.rec.push(recs[k] ?? null);
                a.cur.push({ entry: 0, hold: member.panels[k]?.hold ?? 0 });
            }
            break;
        }
        case "decor":
            switch (member.kind) {
                case "stacked":
                    // s785: the slots are obj+0x54..0x60, tags 4..1
                    a.rec = [4, 3, 2, 1].map((t) => tagIndex(member, t));
                    a.cur = [{ entry: 0, hold: 0 }, { entry: 0, hold: 0 }];
                    break;
                case "resprite":
                    a.rec = [tagIndex(member, 1)];
                    break;
                case "reveal":
                    // s790: eight consecutive slots for tags 2..9 (obj+0x50..0x6c)
                    a.rec = [2, 3, 4, 5, 6, 7, 8, 9].map((t) => tagIndex(member, t));
                    break;
                case "fire":
                    a.rec = [tagIndex(member, 1), tagIndex(member, 2)];
                    a.cur = [{ entry: 0, hold: 0 }, { entry: 0, hold: 0 }];
                    break;
                case "oneshot":
                    a.rec = [tagIndex(member, 3), tagIndex(member, 4)];
                    a.cur = [0, 1, 2, 3].map(() => ({ entry: 0, hold: 0 }));
                    a.armed = [false, false, false, false];
                    break;
                default:
                    break;
            }
            break;
        case "point-record":
            for (const panel of member.panels) {
                a.rec.push(tagIndex(member, panel.atlas));
                a.cur.push({ entry: 0, hold: panel.hold });
            }
            break;
        case "single":
        case "rise":
            // Both claim the tags their own claim loop names -- read out of that
            // loop by the extractor, never assumed to be 1.  A one-tag copy
            // (s455) has one panel; the multi-tag in-place copies (s232, its
            // family) claim two or three tags and each has its OWN script, so a
            // slot k takes panel k's hold, not panel 0's.
            Object.keys(member.tags).map(Number).sort((x, y) => x - y)
                .forEach((tag, k) => {
                    a.rec.push(tagIndex(member, tag));
                    a.cur.push({ entry: 0,
                        hold: member.panels[k]?.hold ?? member.panels[0]?.hold ?? 0 });
                });
            break;
        case "two-slot":
            // Two rows, claimed by the overlay's own two tag compares.  The
            // claim runs on the object's FIRST TICK, not at construction, but
            // the indices are known already: the extractor reads each compare's
            // LAST match out of the stage's own chain, because the walk does not
            // break out of it (wstag261 file 0x11c `bnez $v0, .L0x00000094`).
            a.rec = [...(member.twoSlot?.records ?? [null, null])];
            a.cur = [0, 1].map(() => ({ entry: 0, hold: 0 }));
            // The constructor's own flag read (file 0x4d0-0x4fc): the direction
            // word starts at the flag's value, and the claim's drop is gated on
            // it, so an object built while the flag is set is born 127 px up.
            if (member.twoSlot?.seedFlag) {
                a.mode = readStoryFlag(member.twoSlot.seedFlag.id) ? 1 : 0;
            }
            break;
        case "parent":
            // The parent claims ONE row of its own (`obj+0x58`) and builds its
            // children, each of which claims a row of its own by the tag the
            // parent stamped into it. Both claim walks happened at construction,
            // which is where the records live.
            a.rec.push(tagIndex(member, member.panels[0]?.atlas ?? 0));
            a.cur.push({ entry: 0, hold: member.panels[0]?.hold ?? 0 });
            a.children = (member.children ?? []).map((spec) => ({
                spec,
                rec: tagIndex(member, spec.atlas),
                cur: { entry: 0, hold: spec.hold },
                state: 0,
            }));
            break;
        case "triple":
            // The pool is NOT built here.  On the disc the parent's own state 0
            // builds it (wstag460 file 0x40-0xec: the three makers, then the
            // `0x1174` maker seven times, each pointer stored in its own call's
            // DELAY SLOT), and a parent that never sees state 0 -- the one the
            // SETANIM event constructs when the ordinal gate did not build it --
            // has an empty pool for its whole life and draws nothing.  See the
            // ORDER NOTE above `tickTriple`.
            break;
        case "slots":
            if (member.kind === "grid") {
                const g = member.grid;
                for (const slot of g?.slots ?? []) {
                    // The overlay's claim walk takes the rows whose atlas byte is
                    // in its own range, in TABLE ORDER, one slot each -- so a
                    // slot is "the k-th row the walk stopped at", not "the first
                    // row with this tag".  `index` carries the walk's own result
                    // so the port cannot silently re-order it.
                    a.rec.push(slot.index);
                    a.cur.push({ entry: 0, hold: 0 });
                    a.index.push(slot.start);
                }
            } else {
                const L = member.lanes;
                const total = (L?.lanes.length ?? 0) + (L?.traffic.length ?? 0);
                for (let k = 0; k < total; k++) {
                    a.rec.push(null);
                    a.cur.push({ entry: 0, hold: 0 });
                    a.index.push(0);
                }
            }
            break;
        case "ride-walker":
            // The claim walk (file 0x81c-0x858) looks for the FIRST record
            // whose atlas byte is the tag its own compare names (`li $a1, 1`)
            // and parks it at obj+0x5c.  The walk starts from the table base
            // each run and state 0 runs once, so the first-match rule is the
            // walk's own.
            if (member.rideWalker) {
                a.rec.push(tagIndex(member, member.rideWalker.tag));
            }
            break;
        case "scroll-layer":
            // The visit word obj+0x4 the scene entry stamps (wstag415 file
            // 0x1108 `sw $s0, 4($v0)`): the stage reads story flag 0x4018 and
            // passes 1 when it is already SET (a revisit).  A revisit's object
            // then advances its clip once and never gains a speed, so it stays
            // put; a first visit's has clip 0 and slides until the arrival
            // event's `SETANIM 812 822` eases it.  The flag is read here, once,
            // at construction, exactly as the scene entry reads it once.
            if (member.scrollLayer) a.scroll.visit = readStoryFlag(member.scrollLayer.flag);
            break;
    }
    return a;
}

/**
 * The SETANIM >= 0x320 route.  Returns true when the id belongs to one of these
 * actors, so the caller stops looking.  Constructing an id that is already live
 * is a no-op, exactly as fieldstg F0x80092484 looks the id up before it
 * constructs.
 */
export function firePointRecordActor(
    stageId: string,
    effectId: number,
    subId: number,
    _arg?: number,
): boolean {
    const member = tables[stageId]?.[String(effectId)];
    if (!member) return false;
    const list = (runtime[stageId] ??= []);
    let actor = list.find((x) => x.member.id === effectId);
    if (!actor) {
        actor = createPointActor(member);
        list.push(actor);
        if (member.machine === "point-record") {
            if (member.claimState) actor.state = member.claimState;
            if (member.buildSound) playSound(actor, member.buildSound);
        }
    }
    // The pad-flash arm reads its operand itself -- the operand NAMES the pad,
    // so it has to run before the null-draw test below.
    if (member.machine === "pad-flash") {
        return firePadFlash(stageId, actor, subId);
    }
    // A null draw slot in the registry means the original never looks at the
    // operands: construct and stop.
    if (!member.draw) return true;
    if (member.machine === "decor") {
        if (member.kind === "resprite" && subId === 0x32e) actor.clip = 1;
        else if (member.kind === "reveal" && subId === 0x32c) actor.clip = 1;
        else if (member.kind === "fire" && subId === 0x35b) {
            actor.arm = 1;
            curOf(actor, 0).entry = 0;
            curOf(actor, 0).hold = seed(member, "rearm");
            actor.state = 2;
        }
        return true;
    }
    if (member.machine === "slots") return fireSlots(actor, subId);
    if (member.machine === "parent") return fireParent(actor, subId);
    if (member.machine === "two-slot") return fireTwoSlot(actor, subId);
    if (member.machine === "triple") return fireTriple(actor, subId);
    if (member.machine === "picture-steps") return firePictureSteps(actor, subId);
    if (member.machine === "ride-walker") return fireRideWalker(actor, subId);
    if (member.machine === "scroll-layer") return fireScrollLayer(actor, subId);
    // point-record: the original's `if (obj && sub == C)` arm
    if (member.sub !== subId) return true;
    if (member.nextState === null || member.nextState === undefined) return true;
    actor.state = member.nextState;
    actor.running = true;
    if (member.rearm) {
        // s810's handler rewinds slot 0 from the overlay byte at 0x800A719E
        // (wstag810.s file 0x3ac-0x3c0: run flag 1, index 0, hold = that byte).
        // s805's handler calls setState(2) and touches nothing else
        // (wstag805.s file 0x618-0x628), so its sequences keep their own phase.
        const first = actor.cur[0];
        const panel = member.panels[0];
        if (first && panel) {
            first.entry = 0;
            first.hold = member.rearmHold ?? panel.hold;
        }
    }
    if (member.fireSound) playSound(actor, member.fireSound);
    return true;
}

let soundSink: ((packed: number) => void) | null = null;

// ── the `slots` machine: one object, N claimed records ───────────────────
//
// `grid` (s620 0x351) and `lanes` (s680 0x32e) are two shapes of ONE
// per-member machine, in the same style as `decor`'s five: the claim walk
// fills N slots in TABLE ORDER, each slot keeps its own `{entry, hold}` cursor
// and its own script, and each slot's arm writes its step value into one
// record byte.  They differ in three places the table carries as data, never as
// a formula: which byte the value goes into (`grid`), whether a slot's end
// entry moves its row (`lanes`, via the stepper's `rise-u8` arm) and whether a
// slot slides with no script at all (`lanes`' traffic slots).

/**
 * The `lanes` configure routine, the overlay's jump-table arm keyed on
 * `subId - base`: it lights EVERY lane slot whose atlas tag equals the mapped
 * tag by writing 1 into that slot's cursor index
 * (wstag680 file 0x57c `lh $v0, 0x5a($a0)` / `:0x584 bne $a2, $v0` /
 * `:0x58c sh $a1, 0x58($a0)` / `:0x59c addiu $a0, 0x14`), optionally starts a
 * traffic slot, optionally clears one lane slot's record pointer, and plays one
 * cue.  A subId the table does not name is the original's return arm.
 */
function fireSlots(a: PointActor, subId: number): boolean {
    const L = a.member.lanes;
    if (!L) return true;
    const key = String(subId);
    const tag = L.lights[key];
    const start = L.starts[key];
    const clear = L.clears[key];
    // SETANIM 814 891 is the drive's own arm and it is the last jump-table
    // entry (wstag680 file 0xf8 -> 0x800a6340): `li $v0, 0x1` / `j` with
    // `sh $v0, 0x148($s0)` in the delay slot, then it joins the shared light
    // loop with `$a2 = 0` -- and `$a2 == 0` is that loop's OWN entry
    // (`:0x57c beqz $a2, .L0x000005b8`), so it lights no lane.  The arm's whole
    // effect is the flag.
    if (L.driveSub !== null && subId === L.driveSub) {
        a.drive.on = true;
        a.drive.phase = 0;
        a.drive.count = 0;
        return true;
    }
    if (tag === undefined && start === undefined && clear === undefined) return true;
    const laneCount = L.lanes.length;
    if (start !== undefined) curOf(a, laneCount + start).entry = 1;
    if (clear !== undefined) a.rec[clear] = null;
    const lanes = L.lanes;
    if (tag !== undefined) {
        for (let k = 0; k < laneCount; k++) {
            if (lanes[k]?.tag !== tag) continue;
            const cur = curOf(a, k);
            cur.entry = 1;
            // The claim arm seeded the hold from the lane's own script's FIRST
            // entry (`lbu $v0, 0x2($v0)` at wstag680 file 0x2d0), and lighting
            // writes the INDEX only -- the hold is not reloaded.  Reproduced.
            cur.rise = 0;
        }
        playSound(a, L.lightSound);
    }
    return true;
}

// ── the `parent` machine: one object, a pool of child objects ──────────────
//
// s545 `0x350` (848). The parent is a two-part actor: its state 0 CLAIMS one row
// of the stage's own point table and BUILDS five child objects through the shared
// child allocator, and its state 1 runs a six-arm CLIP machine whose arms either
// step one of its own scripts or POKE one child into its state 2. Each child is
// the actor the `pad-flash` machine already models -- it claims the record
// carrying its own tag, moves that record onto the coordinates the parent gave
// it, and in its state 2 steps ONE script (wstag545 file 0x140, tick 0x800a5f20,
// script 0x800a6d24 = clips 11..23, hold 4).
//
// THE CLIP MACHINE'S ARMS OVERLAP, which is why they are flags and not kinds.
// Clip 0 stores zero into the parent's own row and then JUMPS into clip 2's body
// (file 0x7cc `sb $zr, ($s0)` in the `j`'s delay slot, target 0x950), and clips 1
// and 3 run their scripts and then fall into the same shared tail (file 0x850 /
// 0x8d4). So `fallsInto` is read out of the arm's own jump and the tail runs on
// the SAME blank, which is why a child is lit on the blank the parent's script
// ends rather than a blank later.
//
// THE SELECTOR IS ONE BASED AND ITS ZERO IS "NONE". Clip 2's arm reads the
// selector, branches on zero and only then indexes the child array
// (`wstag545` file 0x950-0x980), so a poke with no command naming a child does
// nothing at all -- which is the common case, because the scene sends 861/862/
// 863 (the scripts) BEFORE 864..868 (the child numbers).

/**
 * The parent's configure handler: the registry's own draw word, an eight-entry
 * jump table keyed on `sub - 861`. Three arms SET the clip and five store the
 * child selector; the packed cue plays on every command because the word the
 * handler tests is the one state 0 clears and nothing ever sets. Returns true
 * whenever the id was consumed, which is the original's answer either way.
 */
function fireParent(a: PointActor, subId: number): boolean {
    const m = a.member;
    // `lw $v0, 0x54($s0)` / `bnez` guards the cue, and obj+0x54 is written only
    // by the parent's own state 0 (`sw $zr, 0x54($a0)`) and never again, so the
    // cue plays on EVERY command. The handler's tail then calls setCounter(0)
    // (`lw $v0, 0x30($a0)` / `move_ $a1, $zr` / `jalr $v0`), which is what arms
    // the first blank of the new clip.
    if (m.configureCue) playSound(a, m.configureCue);
    const arm = m.configureSubs?.[String(subId)];
    if (arm) {
        if (arm.setClip !== null && arm.setClip !== undefined) setClip(a, arm.setClip);
        if (arm.selector !== null && arm.selector !== undefined) a.selector = arm.selector;
        a.counter = 0;
        a.timer = 0;
    }
    return true;
}

/** EXE F0x80014288: `obj+0x10 = n`, and the counter and timer clear with it. */
function setClip(a: PointActor, n: number): void {
    a.clip = n;
    a.counter = 0;
    a.timer = 0;
}

/**
 * One blank of a `parent`: its own row, then every child.
 *
 * The parent's state 0 is the CLAIM, and it falls out through the object's own
 * `+0x38`, so state 1 is where the object lives. That arm also zeroes the two
 * words the clip machine reads (the selector at obj+0x50 and the gate at
 * obj+0x54), which is why a freshly built parent pokes nothing until a command
 * names a child.
 */
function tickParent(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member;
    if (a.state === 0) {
        advanceState(a);
        a.selector = 0;
        return;
    }
    const clip = m.clips?.[a.clip];
    if (clip) {
        const first = a.counter === 0;
        if (first && clip.cue) playSound(a, clip.cue);
        if (clip.hidesOwnRow) write(host, recOf(a, 0), { active: 0 });
        if (clip.script) {
            const script = scriptOf(m, clip.script);
            if (first) {
                // The arm's own rewind: the cursor goes back to entry 0 and its
                // hold is re-seeded from that entry, then setCounter(1) stops the
                // rewind running again (wstag545 file 0x7ec/0x7f0/0x7f8/0x7fc).
                const cur = curOf(a, 0);
                cur.entry = 0;
                cur.hold = script[0]?.[1] ?? 0;
                a.counter = 1;
                a.timer = 0;
            }
            // The call site's THIRD argument is what the overlay passes the
            // stepper, and it is NOT the same for every arm: clips 1 and 3 pass
            // `li $a2, 1` and so STOP on the 0x00ff marker, while clip 5 passes
            // `move_ $a2, $zr` and RESTARTS -- which is why clip 5 has no endClip
            // and loops for ever.
            const v = stepPointRecordCursor(curOf(a, 0), script, {
                variant: m.stepper,
                delta,
                arm: clip.arm ?? "stop",
            });
            // `sb 1, ($s0)` then `sb $v0, 4($s0)` in the call's delay slot: the
            // row is lit and holds the step value whatever the step was.
            write(host, recOf(a, 0), { active: 1, sprite: v });
            if (v === POINT_RECORD_SCRIPT_END) {
                if (clip.endSprite !== undefined) {
                    write(host, recOf(a, 0), { sprite: clip.endSprite });
                }
                if (clip.endClip !== undefined) setClip(a, clip.endClip);
            }
        }
        if (clip.pokesChild || clip.fallsInto !== undefined) {
            // The shared tail: `beqz` on the selector, then the child at
            // `array + (selector - 1)` gets setState(2) and the selector clears.
            if (a.selector) {
                const child = a.children[a.selector - 1];
                if (child) child.state = 2;
            }
            a.selector = 0;
        }
    }
    for (const child of a.children) tickParentChild(child, m, host, delta);
}

/**
 * One blank of one child. Its state 0 is the CLAIM and it does NOT advance out of
 * it (the original's state-0 arm ends at the epilogue), so the child re-parks its
 * record every blank until a poke reaches it -- which is why the row sits exactly
 * where the parent's table put it from the moment the room loads.
 */
function tickParentChild(
    c: PointParentChild,
    m: PointMember,
    host: PointHost,
    delta: number,
): void {
    if (c.state === 0) {
        c.cur.entry = 0;
        c.cur.hold = c.spec.hold;
        write(host, c.rec, { x: c.spec.x, y: c.spec.y });
        return;
    }
    if (c.state === 1) {
        write(host, c.rec, { active: 0 });
        return;
    }
    const v = stepPointRecordCursor(c.cur, scriptOf(m, c.spec.script), {
        variant: c.spec.stepper,
        delta,
        arm: c.spec.arm,
        terminates: false,
    });
    if (v === POINT_RECORD_SCRIPT_END || v === POINT_RECORD_BLINK_OFF) {
        write(host, c.rec, { active: 0 });
        return;
    }
    write(host, c.rec, { active: 1, sprite: v });
}

/** Wire the packed-sound sink once (web/game.js does this). */
export function setPointRecordActorSound(fn: (packed: number) => void): void {
    soundSink = fn;
}

let musicSink: ((packed: number) => void) | null = null;

/**
 * The music-stem sink, wired once by web/game.js: the pad flashes' cues are
 * sequenced music pieces (env205 digi_en0..2, env011 login_dl), not sampled
 * sounds, so they go to the jingle player while `setPointRecordActorSound`
 * stays the sample sink for every other arm.
 */
export function setPointRecordActorMusic(fn: (packed: number) => void): void {
    musicSink = fn;
}

function playSound(a: PointActor, packed: string): void {
    soundSink?.(Number(packed) >>> 0);
}

/**
 * The pad-flash command handler.  A 3-slot copy's handler stores the command's
 * pad coords into the object (`sw $vX, 0x50($a0)` with an ascending
 * `addiu $v0, $zero, C` id compare, wstag212.s file 0x370-0x3ec) and a
 * construct-only copy's constructor bakes its one pad in, so any operand arms
 * it.  Returns false when the operand is not one of this copy's pads.
 */
function firePadFlash(
    stageId: string,
    a: PointActor,
    subId: number,
): boolean {
    const cmds = a.member.arm?.commands ?? {};
    const slot = Object.keys(cmds).length ? cmds[String(subId)] : 0;
    if (slot === undefined) return false;
    const coord = a.member.arm?.coords?.[slot];
    if (!coord) return false;
    // The disc's configure handler (wstag212.s file 0x368-0x418) runs on EVERY
    // fire with no live guard: it stores the pad the operand names, setClip(1)s
    // (EXE F0x80014288 -- sub-slot A = 1, B and C = 0, so the next blank
    // re-claims the records onto the new pad and runs the scripts again), and
    // plays that pad's cue through the resident play cell.  Arming only a copy
    // that had no run left pads 2 and 3 dark: their cursors sat past the ends
    // of the scripts, so the re-armed pad died on its next blank.  Each fire is
    // therefore a fresh run from the scripts' first entries, on the named pad.
    a.pad = { x: coord[0], y: coord[1], command: subId };
    a.blanks = 0;
    const slots = a.member.arm?.slots ?? 0;
    for (let k = 0; k < slots; k++) {
        a.cur[k] = { entry: 0, hold: a.member.panels[k]?.hold ?? 0 };
    }
    const sounds = a.member.arm?.slotSounds;
    const cue = (slot !== undefined && sounds ? sounds[slot] : null)
        ?? a.member.arm?.fireSound ?? null;
    if (cue) musicSink?.(Number(cue) >>> 0);
    return true;
}

/**
 * Build the actors the owning stage creates for ITSELF, with no script to fire
 * them.  Their registry construct pointer is null (the thirteen null-ctor
 * records, `stage-object-registry-2026-10-04.md` section 4), so on the console
 * they exist from the moment the stage loads -- s795's 836 and s800's 837 blink
 * at their panel long before the scene's first SETANIM.
 *
 * The two `triple` parents are the second kind, and their gate is the master
 * story ordinal: each stage's own one-shot object reads `[0x8004b370]`, and
 * builds the parent ONLY while the ordinal is below its own bound (15 for
 * s460's `0x33e`, 30 for s526's `0x33d`).  `ordinal` is that same number, so
 * above the bound this stage load builds nothing and the SETANIM event
 * constructs the parent instead -- an unbuilt one.  Returns how many it built.
 */
export function constructPointRecordActors(
    stageId: string,
    ordinal = 0,
): number {
    const members = tables[stageId];
    if (!members) return 0;
    let made = 0;
    for (const member of Object.values(members)) {
        const gate = member.stageLoadGate;
        const gated = gate !== undefined;
        if (member.registryCtor !== null && !gated) continue;
        // `slti $v0, 0xf` / `beqz $v0` -- at or above the bound the stage builds
        // nothing, and the branch is the ONLY thing between the two orders.
        if (gated && ordinal >= gate.below) continue;
        const list = (runtime[stageId] ??= []);
        if (list.some((x) => x.member.id === member.id)) continue;
        list.push(createPointActor(member));
        made += 1;
    }
    return made;
}

/** Drop every actor on a stage (or everywhere) -- on a stage change, and in tests. */
export function clearPointRecordActors(stageId?: string): void {
    if (stageId === undefined) {
        for (const k of Object.keys(runtime)) delete runtime[k];
        return;
    }
    delete runtime[stageId];
}

/**
 * This blank's pad-flash run: which pad a SETANIM named, and the packed cue
 * that goes with it.  The cue itself is played by the FIRE, down the music
 * sink (`setPointRecordActorMusic`); this read is for the headless verifiers
 * (tools/verify_point_record_actors.mjs), which check the pad a flash landed
 * on and the cue its pad carries.
 */
export function pointRecordPadRun(
    stageId: string,
): { x: number; y: number; command: number; sound: string | null } | null {
    for (const a of runtime[stageId] ?? []) {
        if (a.member.machine !== "pad-flash" || !a.pad) continue;
        const sounds = a.member.arm?.slotSounds;
        const slot = a.member.arm?.commands?.[String(a.pad.command)];
        const perPad = slot !== undefined && sounds ? sounds[slot] : null;
        const sound = perPad ?? a.member.arm?.fireSound ?? null;
        return { ...a.pad, sound };
    }
    return null;
}

/**
 * Debug dump for `window.__pointRecordActors`: the whole object the overlay's
 * would hold, including the child array a `parent` owns, so the browser verifier
 * can read each child's own state without reaching inside the module.
 */
export function pointRecordActorState(stageId: string): unknown {
    return (runtime[stageId] ?? []).map((a) => ({
        id: a.member.id,
        machine: a.member.machine,
        kind: a.member.kind,
        state: a.state,
        clip: a.clip,
        counter: a.counter,
        timer: a.timer,
        arm: a.arm,
        mode: a.mode,
        running: a.running,
        pad: a.pad,
        rec: a.rec,
        cur: a.cur.map((c) => ({ ...c })),
        armed: [...a.armed],
        index: [...a.index],
        selector: a.selector,
        wait: a.wait,
        cursor: a.cursor,
        saved: [...a.saved],
        drive: { ...a.drive },
        /** `picture-steps` only: the sheet picture this blank drew and where. */
        pic: a.pic,
        anchor: a.anchor,
        anchorPos: a.anchorPos ? { ...a.anchorPos } : null,
        /** `ride-walker` only: the walker's own words, cursor included. */
        ride: a.member.machine === "ride-walker"
            ? { ...a.ride, cursor: { ...a.ride.cursor } }
            : null,
        /** `scroll-layer` only: the visit word and the two 8.8 accumulators. */
        scroll: a.member.machine === "scroll-layer" ? { ...a.scroll } : null,
        /** `triple` only: has the parent's own state 0 run and built the pool? */
        built: a.built,
        triple: a.member.triple ? {
            draw: a.member.triple.draw,
            children: a.pool.map((c) => ({
                machine: c.spec.machine,
                arraySlot: c.spec.arraySlot,
                tags: c.spec.rows.map((r) => r.tag),
                rec: c.spec.rows.map((r) => r.index),
                state: c.state,
                arm: c.arm,
                counter: c.counter,
                tick: c.machine.tick,
                cur: c.cur.map((k) => ({ ...k })),
                words: { ...c.words },
            })),
        } : null,
        children: a.children.map((c) => ({
            atlas: c.spec.atlas,
            x: c.spec.x,
            y: c.spec.y,
            rec: c.rec,
            state: c.state,
            cur: { ...c.cur },
        })),
    }));
}

/** Advance every live actor on this stage one PAL blank. */
export function tickPointRecordActors(
    stageId: string,
    host: PointHost,
    delta = 1,
): number {
    const list = runtime[stageId];
    if (!list?.length) return 0;
    for (const a of list) {
        a.blanks += delta;
        switch (a.member.machine) {
            case "pad-flash":
                tickPadFlash(a, host, delta);
                break;
            case "decor":
                tickDecor(a, host, delta);
                break;
            case "point-record":
                tickRecord(a, host, delta);
                break;
            case "single":
                tickSingle(a, host, delta);
                break;
            case "rise":
                tickRise(a, host, delta);
                break;
            case "two-slot":
                tickTwoSlot(a, host, delta);
                break;
            case "slots":
                if (a.member.kind === "grid") tickGrid(a, host, delta);
                else tickLanes(a, host, delta);
                break;
            case "parent":
                tickParent(a, host, delta);
                break;
            case "triple":
                tickTriple(a, host, delta);
                break;
            case "picture-steps":
                tickPictureSteps(a, host, delta);
                break;
            case "ride-walker":
                tickRideWalker(a, host, delta);
                break;
            case "scroll-layer":
                tickScrollLayer(a, host, delta);
                break;
            default:
                break;
        }
    }
    return list.length;
}

// ── arm 1: pad-flash ───────────────────────────────────────────────────────

/**
 * The three-slot copies' animate phase (wstag212.s file 0x288-0x2e4): step each
 * slot's script, then store `active` and `spriteId` into the record the slot
 * claimed.  0x00ff ends the slot, 0x12c blinks it off, and when the last slot
 * has ended the records go inactive and the actor rearms -- which is the
 * original's final `jalr` through `obj+0x40`.
 */
function tickPadFlash(a: PointActor, host: PointHost, delta: number): void {
    if (!a.pad) return;
    const member = a.member;
    const slots = member.arm?.slots ?? 0;
    let live = 0;
    for (let k = 0; k < slots; k++) {
        const cur = curOf(a, k);
        const script = scriptOf(member, member.panels[k]?.recipe["1"]?.script);
        const v = stepPointRecordCursor(cur, script, {
            variant: member.stepper,
            delta,
            terminates: false,
        });
        const ended = padSlotEnded(cur, script.length) ||
            v === POINT_RECORD_SCRIPT_END;
        const geom = member.tags[String(k + 1)];
        const base = member.arm?.reposition && geom ? {
            x: a.pad.x,
            y: a.pad.y + (member.arm.yOff?.[k] ?? 0),
            ysort: a.pad.y + (member.arm.ysortOff?.[k] ?? 0),
        } : {};
        if (ended || v === POINT_RECORD_BLINK_OFF) {
            write(host, recOf(a, k), { ...base, active: 0, sprite: 0 });
            continue;
        }
        write(host, recOf(a, k), { ...base, active: 1, sprite: v });
        live += 1;
    }
    if (live === 0) {
        a.pad = null;
        a.blanks = 0;
    }
}

// ── arm 2: decor ───────────────────────────────────────────────────────────

/**
 * s785 id 835 (wstag785 0x800a5f04). State 0 claims tags 1..4 and seeds both
 * cursors; the arm word at obj+0x50 sends it to state 2 instead, which is the
 * overlay's UNREGISTERED builder's path, so the registry's own construction
 * always takes state 1.
 *
 * State 1 runs the one-shot script on cursor 1 into the tag-4 record; when it
 * reaches 0xff the record is switched off, the clip latches to 1 and cursor 1
 * reloads. Clip 1 runs the looping script into the tag-3 record. Every path
 * then steps cursor 2 into the tag-1 record.
 */
function tickStacked(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member;
    if (a.state === 0) {
        if (a.arm !== 0) {
            a.state = 2;
            return;
        }
        curOf(a, 0).entry = 0;
        curOf(a, 0).hold = seed(m, "cursor1");
        curOf(a, 1).entry = 0;
        curOf(a, 1).hold = seed(m, "cursor2");
        advanceState(a);
        return;
    }
    if (a.state === 1) {
        if (a.clip === 1) {
            const v = stepPointRecordCursor(curOf(a, 0),
                scriptOf(m, "clip1"), { variant: m.stepper, delta });
            write(host, recOf(a, 1), { ctr: v, active: 1 });
        } else if (a.clip !== 2) {
            const v = stepPointRecordCursor(curOf(a, 0),
                scriptOf(m, "clip0"), { variant: m.stepper, delta, arm: "stop" });
            if (v === POINT_RECORD_SCRIPT_END) {
                a.clip = 1;
                write(host, recOf(a, 0), { active: 0 });
                curOf(a, 0).entry = 0;
                curOf(a, 0).hold = seed(m, "cursor1_reload");
            } else {
                write(host, recOf(a, 0), { ctr: v, active: 1 });
            }
        }
        const v2 = stepPointRecordCursor(curOf(a, 1),
            scriptOf(m, "cursor2"), { variant: m.stepper, delta });
        write(host, recOf(a, 3), { ctr: v2, active: 1 });
        return;
    }
    if (a.state !== 2) return;
    if (a.clip === 0) {
        curOf(a, 0).entry = 0;
        curOf(a, 0).hold = seed(m, "state2_cursor1");
        curOf(a, 1).entry = 0;
        curOf(a, 1).hold = seed(m, "cursor2");
        advanceClip(a);
    }
    const x = stepPointRecordCursor(curOf(a, 0), scriptOf(m, "state2"),
        { variant: m.stepper, delta });
    write(host, recOf(a, 2), { ctr: x, active: 1 });
    const y = stepPointRecordCursor(curOf(a, 1), scriptOf(m, "cursor2"),
        { variant: m.stepper, delta });
    write(host, recOf(a, 3), { ctr: y, active: 1 });
}

/**
 * s790 id 808 (wstag790 0x800a6138). Construct-only until the script sends
 * `SETANIM 808 814 1`, which latches clip 1; from then on every frame re-points
 * the tag-1 record's sprite at the object's own word, which nothing writes, so
 * the record shows sprite 0 from then on. The counter test above it is
 * always true, so the block that would have derived a sprite from the timer and
 * played 0x8100303c is dead in the shipped build.
 */
function tickResprite(a: PointActor, host: PointHost): void {
    if (a.state === 0 || a.state >= 4) {
        advanceState(a);
        return;
    }
    if (a.state !== 1 || a.clip !== 1 || a.counter !== 0) return;
    write(host, recOf(a, 0), { sprite: a.arm & 0xff });
}

/**
 * s790 id 809 (wstag790 0x800a5df4). State 0 claims tags 2..9 into eight slots;
 * state 1 is a five-case jump table indexed by the counter. The slide cases add
 * 1 to the X high half of a record on every other frame. The last two switch
 * the inactive flash sprites on and off and wait for the record's own `ctr` to
 * reach 15, which is what the ambient renderer produces for a mode-2 record.
 */
function tickReveal(a: PointActor, host: PointHost): void {
    const m = a.member;
    if (a.state === 0 || a.state >= 4) {
        advanceState(a);
        return;
    }
    if (a.state !== 1 || a.clip !== 1 || a.counter >= 5) return;
    switch (a.counter) {
        case 0:
            sound(host, a, 0);
            advanceCounter(a);
            break;
        case 1:
            if (a.timer & 1) for (const slot of [0, 1, 2, 5]) slide(host, a, slot);
            a.timer += 1;
            if (a.timer === 8) {
                a.timer = 8;
                advanceCounter(a);
            }
            break;
        case 2:
            if (a.timer & 1) for (const slot of [1, 5]) slide(host, a, slot);
            a.timer += 1;
            if (a.timer === 0x10) {
                a.timer = 0x10;
                advanceCounter(a);
            }
            break;
        case 3:
            if (a.timer === 0) {
                write(host, recOf(a, 3), { active: 1 });
                sound(host, a, 3);
                a.timer += 1;
            }
            if (ctrOf(host, a, 3) === 15) advanceCounter(a);
            break;
        case 4:
            if (a.timer === 0) {
                write(host, recOf(a, 3), { active: 0 });
                write(host, recOf(a, 4), { active: 1 });
                write(host, recOf(a, 5), { active: 0 });
                write(host, recOf(a, 6), { active: 1 });
                a.timer += 1;
            }
            if (ctrOf(host, a, 6) === 15) {
                write(host, recOf(a, 6), { active: 0 });
                write(host, recOf(a, 7), { active: 1 });
                advanceCounter(a);
            }
            break;
        default:
            break;
    }
}

/**
 * s795 id 836 and s800 id 837. State 0 claims tags 1 and 2 and seeds both
 * cursors from the overlay's own script table. State 1 blinks sprite 70 through
 * a two-entry script -- with the SPRITE PINNED in the `jal`'s delay slot
 * (`sb $s5, 0x4($s0)`, wstag795.s file 0x294) and the stepper's value going to
 * `ctr` -- and keeps the second record dark. `SETANIM <id> 859 2` arms the fire
 * flag and jumps to state 2, where sprite 70 plays a ten-frame script once and
 * then holds its last frame, with sprite 81 fixed behind it at palette row 81.
 */
function tickFire(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member;
    if (a.state === 0) {
        if (a.mode !== 0) {
            curOf(a, 0).entry = 0;
            curOf(a, 0).hold = seed(m, "rearm");
            a.state = 2;
            return;
        }
        curOf(a, 0).entry = 0;
        curOf(a, 0).hold = seed(m, "tag1");
        curOf(a, 1).entry = 0;
        curOf(a, 1).hold = seed(m, "tag2");
        a.arm = 0;
        advanceState(a);
        return;
    }
    if (a.state === 1) {
        const v = stepPointRecordCursor(curOf(a, 0), scriptOf(m, "blink"),
            { variant: m.stepper, delta });
        write(host, recOf(a, 0), { active: 1, sprite: 0x46, ctr: v });
        write(host, recOf(a, 1), { active: 0 });
        return;
    }
    if (a.state !== 2) return;
    write(host, recOf(a, 0), { active: 1 });
    if (a.arm) {
        const v = stepPointRecordCursor(curOf(a, 0), scriptOf(m, "fire"),
            { variant: m.stepper, delta, arm: "stop" });
        if (v === POINT_RECORD_SCRIPT_END) {
            write(host, recOf(a, 0), { sprite: 0x50 });
            a.arm = 0;
        } else {
            write(host, recOf(a, 0), { sprite: v });
        }
    } else {
        write(host, recOf(a, 0), { sprite: 0x50 });
    }
    write(host, recOf(a, 0), { ctr: 0 });
    write(host, recOf(a, 1), { active: 1, sprite: 0x51, ctr: 0x51 });
}

/**
 * s800 id 839. Construct-only. State 0 claims tags 3 and 4 and arms two
 * cursors; state 1 runs four script passes over them. Only the first pass
 * writes an `active` byte, so only the tag-3 record is ever drawn -- the
 * original never lights the tag-4 record, and the port keeps that.
 *
 * Two original quirks are reproduced rather than tidied: the arm word and the
 * cursor's entry are the SAME word, and the overlay seeds its holds four bytes
 * past where this overlay's form-B stepper reads them, so both cursors start
 * with a hold of zero. The third and fourth passes read script pointers that
 * are not script addresses in the shipped image, and they only ever write the
 * hidden record, so nothing visible depends on them.
 */
function tickOneshot(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member;
    if (a.state === 0) {
        for (let i = 0; i < 4; i++) {
            curOf(a, i).entry = i < 2 ? 1 : 0;
            curOf(a, i).hold = 0;
            a.armed[i] = true;
        }
        advanceState(a);
        return;
    }
    if (a.state !== 1) return;
    const passes = [scriptOf(m, "pass0"), scriptOf(m, "pass1")];
    for (let pass = 0; pass < 2; pass++) {
        if (!a.armed[pass]) {
            if (pass === 0) write(host, recOf(a, 0), { active: 0 });
            continue;
        }
        const v = stepPointRecordCursor(curOf(a, pass), passes[pass] ?? [],
            { variant: m.stepper, delta, arm: "stop" });
        if (v === POINT_RECORD_SCRIPT_END) {
            a.armed[pass] = false;
            if (pass === 0) write(host, recOf(a, 0), { active: 1, sprite: v, ctr: 0 });
        } else if (pass === 0) {
            write(host, recOf(a, 0), { active: 0xff, sprite: v, ctr: 0 });
        } else {
            write(host, recOf(a, 1), { sprite: 0x33, ctr: v });
        }
    }
    if (!a.armed[0] && !a.armed[1]) a.state = 3;
}

function tickDecor(a: PointActor, host: PointHost, delta: number): void {
    switch (a.member.kind) {
        case "stacked":
            return tickStacked(a, host, delta);
        case "resprite":
            return tickResprite(a, host);
        case "reveal":
            return tickReveal(a, host);
        case "fire":
            return tickFire(a, host, delta);
        case "oneshot":
            return tickOneshot(a, host, delta);
        default:
            return;
    }
}

// ── arm 3: point-record ────────────────────────────────────────────────────

function resolve(value: RecipeByte | undefined, stepped: number, state: number): number | null {
    if (value === null || value === undefined) return null;
    if (value === "S") return stepped;
    if (value === "A") return state;
    if (typeof value === "string") {
        const m = /^S\?(-?\d+):(-?\d+)$/.exec(value);
        if (!m) throw new Error(`bad point-record recipe marker ${value}`);
        return stepped === Number(m[1]) ? Number(m[2]) : stepped;
    }
    return value;
}

function applyRecipe(
    host: PointHost,
    a: PointActor,
    slot: number,
    recipe: { active?: RecipeByte; sprite?: RecipeByte; ctr?: RecipeByte },
    stepped: number,
): void {
    const index = recOf(a, slot);
    if (index === null) return;
    const patch: PointPatch = {};
    const active = resolve(recipe.active, stepped, a.state);
    const sprite = resolve(recipe.sprite, stepped, a.state);
    const ctr = resolve(recipe.ctr, stepped, a.state);
    if (active !== null) patch.active = active;
    if (sprite !== null) patch.sprite = sprite;
    if (ctr !== null) patch.ctr = ctr;
    if (Object.keys(patch).length === 0) return;
    host.write(index, patch);
}

/**
 * One PAL blank of every panel of a `point-record` member.  The state machine
 * is the table's: `recipe[state]` names the writes and which script this state
 * steps, and each recipe is the reading of one arm of the overlay's own tick,
 * with the store it reproduces cited beside it in the extractor.
 */
function tickRecord(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member;
    for (let k = 0; k < m.panels.length; k++) {
        const panel = m.panels[k];
        if (!panel) continue;
        const recipe = panel.recipe[String(a.state)];
        if (!recipe) continue;
        if (recipe.cue && a.clip === (recipe.cueClip ?? 0)) playSound(a, recipe.cue);
        // The claim arm: the overlay walks the table, parks the record and falls
        // out through the object's own `+0x38`, so the state advances and the
        // clip/counter/timer clear.  The walk itself happened at construction.
        if (recipe.advance) {
            advanceState(a);
            continue;
        }
        let stepped = POINT_RECORD_SCRIPT_END;
        const script = scriptOf(m, recipe.script);
        if (recipe.script && (!recipe.gated || a.running) && script.length) {
            // the `li $a2, 0x1` call sites take the stop arm; every other call
            // site passes `move_ $a2, $zr`, and the two overlays whose stepper
            // has no `$a2` test ignore the argument entirely
            stepped = stepPointRecordCursor(curOf(a, k), script,
                recipe.arm === "stop"
                    ? { variant: m.stepper, delta, arm: "stop" }
                    : { variant: m.stepper, delta, arm: "restart" });
        }
        const ended = stepped === POINT_RECORD_SCRIPT_END;
        if (ended && recipe.endWrites) {
            applyRecipe(host, a, k, recipe.endWrites, stepped);
        } else if (recipe.gated && !a.running && recipe.idle) {
            applyRecipe(host, a, k, recipe.idle, stepped);
        } else {
            applyRecipe(host, a, k, recipe, stepped);
        }
        if (recipe.latchClip !== undefined && a.clip === 0) {
            a.clip = recipe.latchClip;
            a.counter = 0;
            a.timer = 0;
        }
        if (ended && recipe.onEnd) {
            if (recipe.onEnd.clearRunning) a.running = false;
            if (recipe.onEnd.state !== undefined) a.state = recipe.onEnd.state;
        }
    }
}
// ── arm 5: the in-place shapes (one record, no pad) ───────────────────────
//
// Both are the SAME actor as the pad flash: the same claim walk
// (fieldstg F0x800894d8), the same stepper copy at the overlay base
// (`jal 0x800a5de4`, wstag455 file 0x1dc) and the same method block.  What
// they do NOT have is a pad to move their record onto -- they light the row
// exactly where the stage's own point table put it.

// ── arm 4: single (s455 0x33c) ────────────────────────────────────────────
//
// wstag455's tick, file 0xdc.  State 0 is the claim: it advances the state,
// walks the table for the tag-`N` row and parks it at obj+0x50, and seeds the
// stepper's cursor hold from the script's own first entry
// (`.L0x00000128: sh $zr, 0x54($s1)` / `:0x12c lhu $v0, 0x637a($v0)` /
// `:0x134 sh $v0, 0x56($s1)`, where the halfword is `0x800A6378 + 2` -- the
// first entry's hold, the same one the pad copies seed with).  State 1 is the
// animate phase: play the cue ONCE, because its own test
// (`.L0x00000188: lw $v0, 0x10($s1)` / `.L0x00000190: bnez $v0, .L0x000001cc`)
// reads the object's second counter and only the first pass reaches the sound;
// then step the script (`.L0x000001cc`-`:0x1e0`, `move_ $a2, $zr` -> the
// restart arm) and store `active` and `spriteId` into the record
// (`.L0x00000210: sb $s2, ($s0)` / `:0x214 sb $v1, 0x4($s0)`).  The
// 0x00ff arm switches the record off and advances the state
// (`.L0x000001f4: sb $zr, ($s0)` / `:0x1f8 lw $v0, 0x28($a0)` / `:0x204 li
// $a1, 0x3`).
function tickSingle(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member;
    const n = m.arm?.slots ?? 1;
    const seedSlot = (k: number): void => {
        curOf(a, k).entry = 0;
        curOf(a, k).hold = m.panels[k]?.hold ?? m.panels[0]?.hold ?? 0;
    };
    if (a.state === 0) {
        advanceState(a);
        for (let k = 0; k < n; k++) seedSlot(k);
        return;
    }
    if (a.state === 1) {
        // the cue plays once, on the blank the object's own counter is still 0
        if (a.clip === 0) {
            a.clip = 1;
            for (let k = 0; k < n; k++) seedSlot(k);
            if (m.arm?.fireSound) playSound(a, m.arm.fireSound);
        }
        for (let k = 0; k < n; k++) {
            const panel = m.panels[k];
            const v = stepPointRecordCursor(curOf(a, k),
                scriptOf(m, panel?.recipe ? panel.recipe["1"]?.script : undefined),
                { variant: m.stepper, delta, terminates: false });
            if (v === POINT_RECORD_SCRIPT_END) {
                // `.L0x000001f4: sb $zr, ($s0)` / `.L0x000001f8: lw $v0, 0x28($a0)`
                // / `.L0x00000204: li $a1, 0x3` -- the row goes dark and the
                // state is SET to 3, not advanced.  Only the ONE-slot copy
                // (s455) reaches this: the multi-tag copies pass `move_ $a2,
                // $zr`, whose restart arm resets to entry 0 on the 0x00ff, so
                // their stepper never returns the marker.
                write(host, recOf(a, k), { active: 0 });
                if (n === 1) { a.state = 3; return; }
                continue;
            }
            write(host, recOf(a, k), { active: 1, sprite: v });
        }
    }
}

// ── arm 5: rise (s926 0x356) ──────────────────────────────────────────────
//
// wstag926's tick, file 0x190.  There is NO script: state 0 claims the tag-1
// row, parks it at obj+0x50, takes ONE PIXEL off its Y
// (`.L0x00000208: lhu $v0, 0xa($v1)` / `:0x210 addiu $v0, -0x1` /
// `:0x214 sh $v0, 0xa($v1)`, where `$v1 = record + 2`, so the record's own Y
// at +0xc) and lights it (`.L0x00000218: sb $a1, ($a0)`); state 1 then adds a
// pixel back EVERY blank (`.L0x00000254: lhu $v1, 0xc($s0)` / `:0x25c addiu
// $v1, 0x1` / `:0x260 sh $v1, 0xc($s0)`) and counts the blanks in obj+0x54
// (`:0x264`-`:0x270`), stopping at `.L0x0000028c: slti $v0, 0x96` = 150.
// The ORDER matters and is the port's whole reading: the copy moves FIRST and
// counts SECOND, so the 150th blank is the last move and the row ends 149
// pixels below where the table put it.  After the bound it takes its state-3
// arm, which is EMPTY (`.L0x000002a8` is the epilogue), so the row stays lit
// where it stopped -- which is why the run is kept rather than dropped.
//
// THE SAME BLANK ALSO MOVES THE PLAYER.  Three instructions after the record's
// own Y, and in the same arm:
//
//     .L0x00000274: lw $v1, 0x54($v0)   # the LOOKUP's result, i.e. object 5
//     .L0x0000027c: addiu $v1, 0x100     # one pixel in the character's 16.8
//     .L0x00000280: sw $v1, 0x54($v0)    # the character's world Y
//
// `$v0` is the value the `jalr` at file 0x24c returned -- `li $a0, 0x5` /
// `lw $v0, -0x4844($v0)` = [0x8004b7bc] / `jalr $v0` -- so this writes the LIVE
// FIELD CHARACTER, not this actor (whose own obj+0x54 is the blank counter read
// on either side of it at file 0x264 and 0x284).  That character is the player:
// +0x54 is its world Y in 16.8, so the row and the player travel together and
// the ROOM scrolls, which is what this member looks like in play.  See
// engine/systems/field-character.ts.
function tickRise(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member;
    const rise = m.rise;
    if (!rise) return;
    const index = recOf(a, 0);
    if (index === null) return;
    if (a.state === 0) {
        advanceState(a);
        a.count = 0;
        write(host, index, { active: 1, y: host.read(index).y + rise.claimShift });
        return;
    }
    if (a.state !== 1) return; // state 3 and up: the original's empty arm
    // moves FIRST and counts SECOND (file 0x254-0x28c), so the Nth blank is
    // the Nth move and the blank that reaches the bound is the last one.
    write(host, index, { y: host.read(index).y + rise.riseBy * delta });
    const cy = charYOf(host);
    if (cy !== null && rise.charYBy) setCharY(host, cy + rise.charYBy * delta);
    a.count += delta;
    if (a.count >= rise.riseBlanks) a.state = 3;
}

// ── arm 6: slots / grid (s620 0x351) ──────────────────────────────────────
//
// wstag620's tick, file 0x120.  State 0 is the claim plus the per-slot seeding
// (`:0x1d4`-`:0x25c`), state 1 is the four-slot loop (`:0x260`-`:0x384`), and
// states 2 and 3 fall to the epilogue at `:0x388`.  The loop reads one 0xc-byte
// slot block per pass (`$s1` from `obj+0x50`, `addiu $s1, 0xc`), takes the row
// it parked there, picks its script out of the overlay's own 8-byte-entry table
// at `slot * 0x20 + index * 8` (`:0x28c sll $v0, 0x3` / `:0x290 sll $s2, 0x5`
// / `:0x29c lw $a1, ($v0)` / `:0x2a0 lh $a2, 0x4($v0)` -- the entry's `+4` halfword
// IS the stepper's third argument) and writes the step value into ONE record
// byte: `ctr` for the three slots whose flag word is zero (`:0x324 lbu $v0,
// 0x53($s1)` / `:0x32c bnez $v0` / `:0x338 sb $s0, 0x9($s3)`) and `spriteId` for
// the one whose flag is set (`:0x368 sb $s0, 0x4($s3)`).
//
// 0x12c blinks the row off (`:0x2bc beq $s0, $v0, .L0x00000370`) and 0x00ff
// switches scripts: the entry's `+6` halfword is the next index, and zero means
// the slot goes dark (`:0x2e0 lh $v1, 0x6($v0)` / `:0x2e8 bnez $v1` /
// `:0x2f0 sh $zr, 0x50($s1)` + the record-off arm at `:0x370`).  On a switch the
// cursor is reloaded from the NEW script's first hold and the slot's writes for
// that blank are SKIPPED (`:0x31c j 0x800a6154`), which is why a switching
// blank leaves the record exactly as the previous one left it.
function tickGrid(a: PointActor, host: PointHost, delta: number): void {
    const g = a.member.grid;
    if (!g) return;
    const slots = g.slots;
    const recs = a.rec;
    const idx = a.index;
    const armed = a.armed;
    if (a.state === 0) {
        for (let k = 0; k < slots.length; k++) {
            const slot = slots[k];
            if (!slot) continue;
            recs[k] = slot.index;
            idx[k] = slot.start;
            const cur = curOf(a, k);
            cur.entry = 0;
            cur.hold = gridSeed(a.member, g, k);
            armed[k] = false;
        }
        advanceState(a);
        return;
    }
    if (a.state !== 1) return;
    for (let k = 0; k < slots.length; k++) {
        const rec = recs[k] ?? null;
        const entry = g.entries[k]?.[idx[k] ?? 0];
        if (!entry) {
            // `beqz $v0, .L0x00000370` (file 0x284): a slot whose script index is
            // zero takes no script at all and its row goes dark.
            write(host, rec, { active: 0 });
            continue;
        }
        const v = stepPointRecordCursor(curOf(a, k), scriptOf(a.member, entry.script),
            { variant: a.member.stepper, delta, arm: entry.loop ? "stop" : "restart" });
        if (v === POINT_RECORD_BLINK_OFF) {
            write(host, rec, { active: 0 });
            continue;
        }
        if (v === POINT_RECORD_SCRIPT_END) {
            if (!entry.next) {
                idx[k] = 0;
                write(host, rec, { active: 0 });
                continue;
            }
            idx[k] = entry.next;
            const cur = curOf(a, k);
            cur.entry = 0;
            cur.hold = gridSeed(a.member, g, k);
            continue; // this blank writes nothing, exactly as the overlay's `j`
        }
        write(host, rec, { active: 1 });
        if (slots[k]?.write === "ctr") {
            write(host, rec, { ctr: v });
            continue;
        }
        write(host, rec, { sprite: v });
        if (g.onceSlot === k && v === g.onceClip && !armed[k]) {
            armed[k] = true;
            playSound(a, g.onceSound);
        }
    }
}

/** Entry 0's hold of the script a slot's own index names (file 0x210-0x25c). */
function gridSeed(m: PointMember, g: PointGrid, slot: number): number {
    const entry = g.entries[slot]?.[g.slots[slot]?.start ?? 0];
    if (!entry) return 0;
    return firstHold(m, entry.script);
}

/** Entry 0's hold of the script a lane's own pointer names (file 0x2d0). */
function laneSeed(m: PointMember, script: string): number {
    return firstHold(m, script);
}

/**
 * The `{s16 value, u16 hold}` / delay-byte halfword a script seeds its cursor
 * with, read at the width the caller's own seed instruction uses
 * (`lhu $v0, 0x2($v0)` on s620, `lbu $v0, 0x2($v0)` on s680).
 */
function firstHold(m: PointMember, name: string): number {
    const script = m.scripts[name];
    return script?.[0]?.[1] ?? 0;
}

// ── arm 7: slots / lanes (s680 0x32e) ─────────────────────────────────────
//
// wstag680's tick, file 0x1f8.  State 0's claim (`:0x244`-`:0x2f4`) walks the
// point table ONCE and sorts every row into one of two slot arrays: rows whose
// atlas byte is 1..7 fill eleven 0x14-byte lane slots in TABLE ORDER (`:0x288
// slti $v0, $v1, 0x8`), each taking the next row of the overlay's own
// 11-pointer script table at `0x800a6790` (`:0x2c8 lw $v0, ($t0)` / `:0x2d4
// addiu $t0, 0x4`), and rows tagged 8..10 fill three 8-byte traffic slots
// (`:0x294 sh $zr, 0x12c($a2)` / `:0x2a4 addiu $a2, 0x8`).  A lane also stores
// its tag in two words so the configure routine can find it by tag.
//
// State 1 is two loops.  The lane loop (`:0x324`-`:0x38c`) skips a slot whose
// cursor index is zero, steps its script with `$a2 == 0`, writes the value into
// the record's `spriteId` (`:0x344 sb $v0, 0x4($s0)`), adds the rise the
// stepper's end arm parked in the slot's own `+4` word to the record's Y and
// zeroes it (`:0x34c lhu $v0, 0x54($s1)` / `:0x358 sh $v0, 0xc($s0)` /
// `:0x35c sw $zr, 0x54($s1)`), and stops the lane once the record's Y reaches
// the bound (`:0x368 slti $v0, 0x191`).  The traffic loop (`:0x3a0`-`:0x408`)
// has no script: it adds one pixel to the record's Y every blank and stops on
// the same bound (`:0x3d8 sra $v1, 0x18` is `addu $v0, $v1, 1`).
//
// The stage's script also fires the overlay's configure routine, which is what
// `fireSlots` implements.
function tickLanes(a: PointActor, host: PointHost, delta: number): void {
    const L = a.member.lanes;
    if (!L) return;
    const lanes = L.lanes;
    const traffic = L.traffic;
    const laneCount = lanes.length;
    const recs = a.rec;
    const bound = L.bound;
    const step = L.trafficBy;
    if (a.state === 0) {
        for (let k = 0; k < laneCount; k++) {
            const lane = lanes[k];
            if (!lane) continue;
            recs[k] = lane.index;
            const cur = curOf(a, k);
            cur.entry = 0;
            cur.hold = laneSeed(a.member, lane.script);
            cur.rise = 0;
        }
        for (let k = 0; k < traffic.length; k++) {
            const slot = traffic[k];
            if (!slot) continue;
            recs[laneCount + k] = slot.index;
            curOf(a, laneCount + k).entry = 0;
        }
        advanceState(a);
        return;
    }
    if (a.state !== 1) return;
    for (let k = 0; k < laneCount; k++) {
        const cur = curOf(a, k);
        if (cur.entry === 0) continue; // `beqz $v0, .L0x00000378`
        const index = recs[k];
        if (index === null || index === undefined) continue;
        const v = stepPointRecordCursor(cur,
            scriptOf(a.member, lanes[k]?.script),
            { variant: a.member.stepper, delta });
        const rise = cur.rise ?? 0;
        cur.rise = 0;
        const y = host.read(index).y;
        host.write(index, rise ? { sprite: v, y: y + rise } : { sprite: v });
        if (y + rise >= bound) cur.entry = 0;
    }
    for (let k = 0; k < traffic.length; k++) {
        const cur = curOf(a, laneCount + k);
        if (cur.entry === 0) continue;
        const index = recs[laneCount + k];
        if (index === null || index === undefined) continue;
        const y = host.read(index).y + step * delta;
        host.write(index, { y });
        if (y >= bound) cur.entry = 0;
    }
    // THE LIVE-CHARACTER DRIVE, the tail of state 1 (wstag680 file 0x40c-0x474).
    // A flag at obj+0x148, a phase halfword at obj+0x14a and a counter at obj+0x144:
    //
    //   .L0x0000040c: lh  $v0, 0x148($s5)     # the flag; zero -> nothing
    //   .L0x00000418: li $a0, 0x5              # ... and the lookup is the same
    //   .L0x00000424: lw $v0, -0x4844($v0)     # [0x8004b7bc] find-by-name call
    //   .L0x00000434: lhu $v1, 0x14a($s5)      # the phase, a halfword
    //   .L0x0000043c: addiu $v1, 0x40         # + 0x40 a blank
    //   .L0x00000440: sh $v1, 0x14a($s5)
    //   .L0x00000444: sll $v1, 0x10            # sign-extend it
    //   .L0x00000448: lw $a0, 0x54($v0)        # the character's world Y, 16.8
    //   .L0x0000044c: sra $v1, 0x10
    //   .L0x00000450: addu $a0, $v1
    //   .L0x00000454: sw $a0, 0x54($v0)        # and add the phase to it
    //   .L0x00000458: lw $v0, 0x144($s5)       # the counter
    //   .L0x00000464: addiu $v0, 0x1
    //   .L0x00000468: slti $v1, 0x79           # 121
    //   .L0x0000046c: bnez $v1, .L0x00000478  # below the bound -> keep going
    //   .L0x00000470: sw $v0, 0x144($s5)      # DELAY SLOT: always stored
    //   .L0x00000474: sh $zr, 0x148($s5)       # at the bound the flag is CLEARED
    //
    // So the player is pushed DOWN with a growing step: 0x40 (a quarter pixel)
    // on the first blank, twice that on the second, and 122 blanks later 0x1E80
    // -- a quarter of a pixel a frame to a little over two, which is a fall, not
    // a slide.  The counter store is a delay slot, so the blank that reaches the
    // bound is counted and still moves; the run stops on the NEXT blank.
    tickLaneDrive(a, host, delta);
}

/** The `lanes` member's own drive words (obj+0x144 / 0x148 / 0x14a). */
function tickLaneDrive(a: PointActor, host: PointHost, delta: number): void {
    const L = a.member.lanes;
    if (!L || L.driveSub === null) return;
    if (!a.drive.on) return;
    const cy = charYOf(host);
    if (cy === null) { a.drive.on = false; return; }
    for (let i = 0; i < Math.max(1, delta); i += 1) {
        // `slti $v1, 0x79` tests the counter as it was BEFORE this blank's
        // increment, and the increment itself is in the branch's DELAY SLOT, so
        // it always happens: the flag clears on the blank after the counter has
        // reached 121, and that blank still moves.
        const before = a.drive.count;
        a.drive.phase = (a.drive.phase + L.driveStep) & 0xffff;
        // The halfword is sign-extended before it is added (`sll`/`sra` 0x10).
        const step = (a.drive.phase << 16) >> 16;
        setCharY(host, charYOf(host)! + step);
        a.drive.count = before + 1;
        if (before >= L.driveBound) a.drive.on = false;
    }
}

// ── arm 8: two-slot (s261 0x33b) ───────────────────────────────────────────
//
// The THIRD shape of this actor, and the only member that drives the live field
// character.  Everything below is read out of `wstag261.s`, 0x434 bytes of code
// at the overlay's own base, and nothing here is a formula:
//
//   STATE 0 (file 0x5c-0x128) is the CLAIM and the only arm that walks the
//   chain.  Two explicit compares -- `beq $v0, $t0` against tag 2 and
//   `beq $v0, $a3` against tag 3 (file 0x84-0xa4) -- and the walk does NOT break
//   out of a match (`:0x11c bnez $v0, .L0x00000094`), so each slot keeps the
//   LAST row carrying its tag.  The tag-2 row is parked at obj+0x54 and turned
//   OFF (`:0xe0 sb $zr, ($a1)`, in the `j`'s delay slot); the tag-3 row is parked
//   at obj+0x50 and turned ON (`:0x10c sb $a2, ($a1)` with `$a2 = 1`).  When the
//   direction word at obj+0x58 is non-zero the claim ALSO saves each row's Y
//   (obj+0x6a / obj+0x68) and drops it by 127 pixels (`:0xd4 addiu $v0, -0x7f`),
//   and the arm clears the direction word on the way out (`:0x128 sh $zr,
//   0x58($s0)`), so a second pass cannot drop them twice.
//
//   STATES 1 and 3 are the epilogue: nothing at all.
//
//   STATE 2 (file 0x12c-0x17c) looks the live field character up by name 5 --
//   and KEEPS it in `$a0` across the dispatch (`file 0x150 move_ $a0, $v0`) --
//   then dispatches on its own second counter, obj+0x10, through the SIX-entry
//   table at the overlay base (`sltiu $v0, $v1, 0x6` / `lw $v0, ($v1)` /
//   `jr $v0`, file 0x154-0x174).  A clip of 6 or more takes clip 0's arm
//   (`:0x158 beqz`), and the six table entries are 0x800a5f5c / 5fb8 / 6020 /
//   60a0 / 6020 / 61d8 -- clips 2 and 4 are the SAME routine.
//
//     clip 0 (0x17c) lights the tag-2 row, zeroes the wait counter, saves all
//       three Y words (both rows and the character's +0x54), plays 0x8004103C
//       and advances the clip.  The sound word is the lui/ori PAIR:
//       `lui $a0, 0x8004` / `ori $a0, 0x103c` = 0x8004103C.
//     clip 1 (0x1b8) adds one frame's worth of blanks to the wait counter and
//       does NOTHING until it reaches 30 (`slti $v1, 0x1e`), then advances,
//       zeroes the per-index cursor (in the advanceClip delay slot) and plays
//       `lui $a0, 0x108` / `ori $a0, 0x1` = 0x01080001.
//     clip 2 = clip 4 (0x240) reads the signed-halfword delta table at
//       0x800a66a0 (file 0x8c0) at the cursor, and while the entry is not 1000
//       it writes saved + delta into BOTH rows' Y and into the character's
//       +0x54, then steps the cursor.  On 1000 it advances, zeroes the cursor
//       (delay slot) and stops.
//     clip 3 (0x2c0) is the 254-step BLINK.  It steps its own counter first;
//       while that is below 254 it moves both rows and the character by one
//       pixel on every OTHER index (`andi $v0, $v1, 0x1`), DOWN when the
//       direction word is one and UP when it is zero.  At 254 it restores: the
//       two rows back to the CLAIM's saved words (obj+0x68 / obj+0x6a) plus or
//       minus 127 pixels, and the character to its own clip-0 word (obj+0x64)
//       plus or minus 0x7f00 -- 127 pixels in 16.8 -- the direction word
//       choosing the sign (`:0x2e8 beqz` / `:0x310 addiu $v0, 0x7f00` in the
//       `j`'s delay slot / `:0x33c addiu $v0, -0x7f00`), re-saves the two row
//       words in the advanceClip delay slot, zeroes the cursor and advances.
//     clip 5 (0x3f8) turns the tag-2 row off, calls setState(1) and FLIPS the
//       direction word (`xori $v0, 0x1`).
//
//   THE WHOLE RUN LEAVES THE CHARACTER WHERE IT STARTED, and that is the
//   original's arithmetic rather than an accident of the port: clip 4 writes
//   `saved + delta` again, which is where clip 2 left it, so the blink's 126
//   pixels are undone.  What a player sees is the LIFT -- both rows and the
//   player travel together for 254 blanks while the camera follows, so the room
//   scrolls, and then everything comes back.
//
//   THE CONFIGURE ARM (file 0x438) answers two sub ids and does nothing for any
//   other: 840 sets state 2 and the direction word to 0 (`:0x480 sh $zr, 0x58`
//   in the `j`'s delay slot), 841 sets state 2 and the direction word to 1
//   (`:0x498 sh $v0, 0x58($s0)`).  Neither touches the clip, so the second
//   command in a room re-enters clip 5 and only flips the direction back.

/**
 * The `two-slot` configure routine: two `beq` arms keyed on the SETANIM's second
 * operand, each `setState(2)` plus one halfword store.  Any other operand is the
 * original's return arm, which is still "the id was consumed".
 */
function fireTwoSlot(a: PointActor, subId: number): boolean {
    const dir = a.member.twoSlot?.directions?.[String(subId)];
    if (dir === undefined) return true;
    a.state = 2;
    a.mode = dir;
    a.counter = 0;
    a.timer = 0;
    return true;
}

/** The character's `+0x54` as these arms see it, or null when there is none. */
function charYOf(host: PointHost): number | null {
    return typeof host.charY === "function" ? host.charY() : null;
}

/**
 * Write the character's `+0x54`.  The original's arms never test the found
 * object for zero -- s261 stores through `$a0` whatever the lookup returned
 * (file 0x290 / 0x3b8) -- so this only does nothing when the HOST has no field
 * character at all, which is a stage with no player on it.
 */
function setCharY(host: PointHost, fixed: number): void {
    host.setCharY?.(fixed | 0);
}

/** Saved Y word 0: the tag-3 row's Y at clip 0 (obj+0x60). */
const TS_ROW3 = 0;
/** Saved Y word 1: the tag-2 row's Y at clip 0 (obj+0x62). */
const TS_ROW2 = 1;
/** Saved Y word 2: the character's `+0x54` at clip 0 (obj+0x64). */
const TS_CHAR = 2;
/** Saved Y word 3: the tag-3 row's Y the CLAIM saved (obj+0x68). */
const TS_CLAIM3 = 3;
/** Saved Y word 4: the tag-2 row's Y the CLAIM saved (obj+0x6a). */
const TS_CLAIM2 = 4;

function tickTwoSlot(a: PointActor, host: PointHost, delta: number): void {
    const t = a.member.twoSlot;
    if (!t) return;
    const rec3: number | null = a.rec[0] ?? null; // the lit row, obj+0x50
    const rec2: number | null = a.rec[1] ?? null; // the dark row, obj+0x54
    // The claim runs in state 0 and in every state the dispatch does not name,
    // because the original's fall-through at file 0x58 is the claim arm.
    if (a.state === 0 || (a.state !== 1 && a.state !== 2 && a.state !== 3)) {
        if (a.mode !== 0) {
            for (const [row, claimSlot] of [[rec3, TS_CLAIM3], [rec2, TS_CLAIM2]] as const) {
                if (row === null) continue;
                const y = host.read(row).y;
                a.saved[claimSlot] = y;
                host.write(row, { y: y + t.drop });
            }
        }
        write(host, rec2, { active: 0 });
        write(host, rec3, { active: 1 });
        a.mode = 0; // `:0x128 sh $zr, 0x58($s0)`
        advanceState(a);
        return;
    }
    if (a.state !== 2) return; // states 1 and 3 are the epilogue
    const arm = t.clips[a.clip] ?? t.clips[0];
    switch (arm) {
        case "start": {
            write(host, rec2, { active: 1 });
            a.wait = 0; // `:0x184 sh $zr, 0x5a($s0)`
            if (rec3 !== null) a.saved[TS_ROW3] = host.read(rec3).y;
            if (rec2 !== null) a.saved[TS_ROW2] = host.read(rec2).y;
            const cy = charYOf(host);
            if (cy !== null) a.saved[TS_CHAR] = cy;
            playSound(a, t.startSound);
            advanceClip(a);
            return;
        }
        case "wait": {
            a.wait += delta;
            if (a.wait < t.waitBlanks) return;
            a.wait = 0;
            advanceClip(a);
            a.cursor = 0; // the advanceClip delay slot, so it is set either way
            playSound(a, t.waitSound);
            return;
        }
        case "slide": {
            const d = t.deltas[a.cursor] ?? t.deltaEnd;
            if (d === t.deltaEnd) {
                a.cursor = 0;
                advanceClip(a);
                return;
            }
            if (rec3 !== null) write(host, rec3, { y: a.saved[TS_ROW3] + d });
            if (rec2 !== null) write(host, rec2, { y: a.saved[TS_ROW2] + d });
            setCharY(host, a.saved[TS_CHAR] + d);
            a.cursor += 1;
            return;
        }
        case "blink": {
            a.cursor += 1;
            if (a.cursor >= t.blinkSteps) {
                // The run is over: the rows go back to what the CLAIM saved
                // (plus its own 127-pixel shift when there was no claim drop),
                // and the character to its clip-0 word plus the same 127 pixels
                // in 16.8.  The direction word chooses the sign of both.
                // `t.drop` is stored as the assembly's own signed immediate
                // (-0x7f and -0x7f00), so the down arms -- which ADD -- take
                // their negation: `addiu $v0, 0x7f00` at file 0x310.
                const down = a.mode !== 0;
                const rowShift = down ? 0 : t.drop;
                const charShift = down ? -t.dropFixed : t.dropFixed;
                if (rec3 !== null) write(host, rec3, { y: a.saved[TS_CLAIM3] + rowShift });
                if (rec2 !== null) write(host, rec2, { y: a.saved[TS_CLAIM2] + rowShift });
                setCharY(host, a.saved[TS_CHAR] + charShift);
                if (rec3 !== null) a.saved[TS_ROW3] = host.read(rec3).y;
                if (rec2 !== null) a.saved[TS_ROW2] = host.read(rec2).y;
                const cy = charYOf(host);
                if (cy !== null) a.saved[TS_CHAR] = cy;
                a.cursor = 0;
                advanceClip(a);
                return;
            }
            // `andi $v0, $v1, 0x1` / `beqz` -- every other index moves nothing.
            if ((a.cursor & 1) === 0) return;
            const dir = a.mode !== 0 ? 1 : -1;
            if (rec3 !== null) write(host, rec3, { y: host.read(rec3).y + dir });
            if (rec2 !== null) write(host, rec2, { y: host.read(rec2).y + dir });
            setCharY(host, (charYOf(host) ?? 0) + dir * t.blinkStep);
            return;
        }
        case "darken":
        default: {
            write(host, rec2, { active: 0 });
            a.state = 1;
            a.mode = a.mode === 0 ? 1 : 0;
            return;
        }
    }
}

// ── arm 9: triple (s460 0x33e, s526 0x33d) ─────────────────────────────────
//
// TWO members, ONE machine: a parent whose state 0 builds a dozen child OBJECTS
// and whose state 2 pokes every one of them, plus the child machine itself --
// four states over the shared method block (EXE F0x800143dc: `+0x0c` state,
// `+0x10` clip, `+0x14` counter, `+0x18` timer; `+0x28` setState, `+0x2c` setClip,
// `+0x38` advanceState, which is `state + 1` and CLEARS the three sub-slots).
//
//   PARENT state 0 (s460 file 0x40-0xec, s526 file 0x40-0x120) calls one maker
//     per child and parks the i-th pointer in the i-th slot of its companion
//     array; state 2 (0xf8-0x198 / 0x128-0x1f8) calls each child's own configure
//     routine in the same order and then `setState(1)`; states 1 and 3 are the
//     epilogue.  Its own draw handler answers ONE sub id -- 844 on s460
//     (file 0x1bc `li $v0, 0x34c`), 843 on s526 (file 0x21c) -- and its arm is
//     `setState(2)` with the literal in the `jalr`'s DELAY SLOT.
//
//   CHILD state 0 is the CLAIM: it walks the stage's own display chain for the
//     tag the maker stamped into it, parks each row it stops at, copies the
//     walking machine's four position words out of the record, seeds the two
//     cursor holds from the first entry of each of its two scripts and leaves
//     through `+0x38`, so state 1 is where the object lives.
//
//   CHILD state 1 runs its FIRST script -- the call site passes `$a2 = 0`, so
//     the stepper RESTARTS on the 0x00ff marker -- lights every row it claimed
//     while its selector is non-zero and darkens them when it is zero, and then
//     runs the SHARED TAIL the parent armed: if the selector is the parent's own
//     value, a halfword counter (obj+0x52) counts down and the blank it reaches
//     zero on calls `setState(2)` and clears the selector in the DELAY SLOT.
//
//   CHILD state 2 runs its SECOND script with `$a2 = 1`, so it STOPS on the
//     marker; the marker's own arm darkens the row, calls `setState(1)` and
//     clears the selector.  Its `obj+0x10` is the sub-slot the shared method
//     block zeroes on every state change, so the arm's one-time setup (re-seeding
//     the two holds out of the second scripts) happens on the first blank of the
//     state and never again.
//
//   CHILD state 3 is the epilogue.
//
// ORDER NOTE: the pool is built by the parent's OWN state 0, on its first
// tick -- never at construction.  For an id >= 0x320 the SETANIM handler
// (fieldstg `F0x80084dd0`, file 0x2120) first asks `[0x8004b7bc]` for an
// EXISTING instance (file 0x2180-0x2198, the resident scan `F0x8001804c`,
// which matches `obj+0x00` against the id); if one is found, `bnez $s1` at
// 0x21a0 goes straight to the draw handler `jal 0x800924c8` at 0x21f0.  Only
// if none is found does it take the first free slot of a TEN-handle pool at
// `arg2+0x10`, construct through the registry ctor `jal 0x80092484` at
// 0x21bc, and then draw on that.  The ctor is `F0x800143dc` and does NOT call
// setState; the draw handler's only arm is `setState(2)` (wstag460 file
// 0x1bc-0x1d4, wstag526 file 0x21c-0x234), with a `beqz $a0` guard in front.
// So there are exactly two orders, and both are here:
//
//   * the stage's own code built it at load, under its ordinal gate
//     (`stageLoadGate`, below 15 for s460 and below 30 for s526).  Its first
//     tick ran state 0, which built the pool, and the event then moved a BUILT
//     parent to state 2 -- the children get their countdown.
//   * the event built it.  Its first tick is already state 2: every child
//     configure call returns at once (`beqz $a0, .L0x00000540`, wstag460 file
//     0x52c -- the pointer it was handed is NULL), the parent moves to state 1,
//     and NOTHING is ever drawn.  The pool is never built.
//
// `constructPointRecordActors` is the first path and takes the ordinal; the
// event path is `fireChildPoolParent`, which constructs an UNBUILT parent when
// the gate did not build one.  There is one code path for both: the pool is
// built by `tickTriple`'s state-0 arm, so a parent that never sees state 0 has
// no pool, exactly as on the disc.
//
// THE WALKING MACHINE additionally runs its own integrator (`wstag460` file
// 0xcd0-0xe48), whose whole observable part is here: the blank counter at
// obj+0x70 gains the frame delta, the step period at obj+0x72 decides when the
// child moves at all, and a Manhattan test against the claim's own target words
// decides whether it re-aims or steps.  The integrator's own 16.8 position
// words (obj+0x64 / 0x68) and their whole-pixel copy (obj+0x6c / 0x6e) are what
// the child then writes into the record, so the row walks the map with it.
//
// THE INTEGRATOR'S HEADING IS NOW PORTED.  The integrator draws it from the
// game's ONE random stream, `[0x8004DC0C]` = `rand_u16` -- `(rand & 0xff) << 4`
// on the re-aim arm (`wstag460` file 0xd54-0xd70, `wstag526` 0x10dc-0x10f8, the
// same machine twice) and the same draw again when the pool builds the child
// (`wstag460` 0xf5c-0xf80), followed by a SECOND draw for the counter jitter,
// `(rand & 0xf) - 7` (0xd8c-0xdac).  The stream is the disc's own table walk,
// engine/dw3/random-stream.ts; it used to be `Math.random()` here, so the path a
// player sees was the walker's.  Every other number in these two members is the
// original's, and the arithmetic, the gate, the counter and the row write are
// unchanged.

/** The parent's own draw handler: one sub id, and it sets a state. */
function fireTriple(a: PointActor, subId: number): boolean {
    const arm = a.member.triple?.configureSubs?.[String(subId)];
    if (!arm) return true;
    a.state = arm.setState;
    a.clip = 0;
    a.counter = 0;
    a.timer = 0;
    return true;
}

/** The record the child claimed for its row `i`, or null when the tag is absent. */
function tripleRow(c: TripleChildState, i: number): number | null {
    const index = c.spec.rows[i]?.index;
    return index === null || index === undefined ? null : index;
}

function triplePatch(
    member: PointMember,
    c: TripleChildState,
    arm: PointTripleArm,
    step: number | null,
    row: number,
): PointPatch {
    const T = member.triple;
    const out: PointPatch = {};
    if (arm.active) out.active = arm.active.const;
    let clip: number | undefined;
    const c0 = arm.clip;
    if (c0 && typeof c0.const === "number") {
        clip = c0.const;
    } else if (c0?.byteTable && T) {
        const table = T.byteTables[c0.byteTable];
        clip = table?.[(c0.offset ?? 0) + row];
    }
    if (clip !== undefined) out.sprite = clip;
    if (arm.palette === "step" && step !== null) out.ctr = step;
    else if (arm.palette && typeof (arm.palette as { const?: number }).const === "number") {
        out.ctr = (arm.palette as { const: number }).const;
    }
    if (c0?.movesRow && c0.x !== undefined && c0.y !== undefined) {
        // `sh $v0, 0xa($row)` / `sh $v0, 0xc($row)` -- the row's x and y in whole
        // pixels, out of the integrator's own two halfwords.
        out.x = c.words[c0.x] ?? 0;
        out.y = c.words[c0.y] ?? 0;
    }
    return out;
}

/**
 * The parent's own state 0: build the pool.
 *
 * Nine children from three makers on s460 (`wstag460` file 0x40-0xec), twelve
 * from four on s526, each maker called once per child with the slot, group and
 * kind its own call carries, and each pointer parked in the DELAY SLOT of the
 * call that made it -- which is why the seventh child sits in two slots.
 *
 * Each child's own claim runs in ITS state 0, one blank later, because on the
 * disc they are separate objects that cannot tick before their maker ran.
 */
function buildTriplePool(a: PointActor): void {
    const T = a.member.triple;
    if (!T) return;
    a.pool = [];
    for (const spec of T.children) {
        const machine = T.machines[spec.machine];
        if (!machine) continue;
        a.pool.push({
            spec,
            machine,
            state: 0,
            clip: 0,
            counter: 0,
            timer: 0,
            arm: 0,
            cur: machine.rows.map(() => ({ entry: 0, hold: 0 })),
            words: {},
        });
    }
}

function tickTriple(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member;
    const T = m.triple;
    if (!T) return;
    if (a.state === 0) {
        // The parent's own state 0 IS the pool build, and it leaves through the
        // object's `+0x38` like every other arm here (`advanceState`, s460 file
        // 0xec).  A parent the event constructed never comes here: the draw
        // handler put it straight into state 2, so its pool stays empty and its
        // nine child-configure calls return at once on a NULL pointer.
        buildTriplePool(a);
        a.built = true;
        advanceState(a);
    }
    // The children tick BEFORE the parent's own state 2 pokes them, because on the
    // disc they are separate objects that claimed on an EARLIER blank: the claim
    // parks each row and the selector out of the maker's stamp, and the parent's
    // poke is what then overwrites the selector with its own countdown value.
    for (const c of a.pool) tickTripleChild(c, m, host, delta);
    if (a.state === 2) {
        // state 2 pokes the i-th child and then leaves for state 1 (`li $a1, 1`
        // in the parent's own `jalr` delay slot, s460 file 0x198).
        for (const c of a.pool) {
            c.arm = c.spec.poke.selector;
            if (c.spec.poke.hold !== undefined) c.words[0x52] = c.spec.poke.hold;
            if (c.spec.poke.wait !== undefined) c.words[0x58] = c.spec.poke.wait;
        }
        a.state = 1;
        a.clip = 0;
        a.counter = 0;
        a.timer = 0;
    }
}

/** One blank of one child, its own four-state machine. */
function tickTripleChild(
    c: TripleChildState,
    member: PointMember,
    host: PointHost,
    delta: number,
): void {
    if (c.state === 0) {
        claimTripleChild(c, member, host);
        advanceTripleChild(c);
        return;
    }
    if (!c.machine) return;
    if (c.state === 3) return;                       // the epilogue
    if (c.state === 1) {
        const w = c.machine.walk;
        if (c.arm !== 0) {
            if (w) walkTripleChild(c, w, member, delta);
            const v = stepTripleArm(c, member, c.machine.restart, delta);
            for (let i = 0; i < c.machine.rows.length; i += 1) {
                const index = tripleRow(c, i);
                if (index === null) continue;
                host.write(index, c.arm === 0
                    ? { active: 0 }
                    : triplePatch(member, c, c.machine.restart, v, i));
            }
        } else {
            for (let i = 0; i < c.machine.rows.length; i += 1) {
                const index = tripleRow(c, i);
                if (index !== null) host.write(index, { active: 0 });
            }
        }
        // THE SHARED TAIL the parent's poke armed: `lh $vX, 0x50($obj)` against the
        // poke's own selector, then the halfword counter.  The selector store is
        // the `setState(2)` call's DELAY SLOT, so it always runs.
        if (c.arm === c.spec.poke.selector) {
            if (c.spec.poke.wait !== undefined) {
                // THE WALKING COPY'S OWN ENDING.  Its countdown is the WORD at
                // obj+0x58, and when it runs out the arm JUMPS BACK TO STATE 0 --
                // `j 0x800a6ef0` is file 0xef0, the top of the claim -- with
                // `sh $v0, 0x50($s0)` (selector 3) in the DELAY SLOT
                // (wstag460 file 0x1050-0x105c, wstag526 file 0x1450-0x145c).  So
                // a walking child RE-CLAIMS every 60 blanks instead of running a
                // second script, and the claim's own `sh 1, 0x50` puts the
                // selector back to 1 -- which is why the copy's `selector == 3`
                // arm, the one that bleeds the speed by four a blank
                // (file 0xffc-0x102c), never runs.
                const left = ((c.words[0x58] ?? 0) - 1) | 0;
                c.words[0x58] = left;
                if (left <= 0) {
                    c.arm = 3;
                    setTripleState(c, 0);
                }
                return;
            }
            const left = ((c.words[0x52] ?? 0) - 1) & 0xffff;
            c.words[0x52] = left;
            if (left === 0) {
                c.arm = 0;
                setTripleState(c, 2);
            }
        }
        return;
    }
    // state 2
    const w = c.machine.walk;
    if (c.clip === 0) {
        // the arm's own one-time setup, gated on the sub-slot the method block
        // clears on every state change (`lw $v0, 0x10($s0)` / `bnez`).
        c.clip = 1;
        c.counter = 0;
        c.timer = 0;
        c.words[0x58] = 0;
        for (let i = 0; i < c.machine.rows.length; i += 1) {
            const cur = c.cur[i] ?? (c.cur[i] = { entry: 0, hold: 0 });
            const script = tripleRowScript(member, c.machine.stop.script, i);
            cur.entry = 0;
            cur.hold = script[0]?.[1] ?? 0;
        }
    }
    if (w) walkTripleChild(c, w, member, delta);
    const v = stepTripleArm(c, member, c.machine.stop, delta);
    for (let i = 0; i < c.machine.rows.length; i += 1) {
        const index = tripleRow(c, i);
        if (index === null) continue;
        if (v === POINT_RECORD_SCRIPT_END) {
            host.write(index, { active: 0 });
            c.arm = 0;
            setTripleState(c, 1);
            return;
        }
        host.write(index, triplePatch(member, c, c.machine.stop, v, i));
    }
}

/** `F0x800142ac`: `state + 1`, and the three sub-slots clear with it. */
function advanceTripleChild(c: TripleChildState): void {
    c.clip = 0;
    c.counter = 0;
    c.timer = 0;
    c.state += 1;
}

/** `F0x80014274`: `state = n`, and the three sub-slots clear with it. */
function setTripleState(c: TripleChildState, n: number): void {
    c.state = n;
    c.clip = 0;
    c.counter = 0;
    c.timer = 0;
}

function tripleScript(member: PointMember, name: string | undefined) {
    return scriptOf(member, name);
}

/**
 * One row's own script.  A single-row machine names a script; a two-row machine
 * names a POINTER TABLE the row loop walks by four (`lw $a1, ($sN)` with the
 * loop's own index, wstag460 file 0x7fc/0x820), so each row runs its own.
 */
function tripleRowScript(member: PointMember, name: string | undefined, row: number) {
    const table = tripleScript(member, name);
    if (!table.length) return table;
    const first = table[0];
    if (Array.isArray(first) && Array.isArray(first[0])) {
        const per = (table[row] ?? table[0]) as unknown as PointScriptEntry[];
        return per;
    }
    return table as unknown as PointScriptEntry[];
}

/**
 * One call of the child's own stepper, once per claimed row: the overlay keeps
 * one `{entry, hold}` cursor per row and walks them in the same loop
 * (wstag460 file 0x824/0x828), so a two-row child advances both in one pass.
 */
function stepTripleArm(
    c: TripleChildState,
    member: PointMember,
    arm: PointTripleArm,
    delta: number,
): number | null {
    if (arm.mode !== "stepper" || !arm.script) return null;
    let last: number | null = null;
    for (let i = 0; i < c.cur.length; i += 1) {
        const cur = c.cur[i] ?? (c.cur[i] = { entry: 0, hold: 0 });
        const script = tripleRowScript(member, arm.script, i);
        // The claim seeds each hold from the FIRST entry of the script this arm
        // runs, which is the halfword the overlay reads with `lhu ... 0x2($v0)`
        // (`wstag460` file 0x38c/0x398 for state 1, 0xf2c for state 2).
        if (cur.entry === 0 && cur.hold === 0) cur.hold = script[0]?.[1] ?? 0;
        last = stepPointRecordCursor(cur, script, {
            variant: c.machine.stepper,
            delta,
            arm: arm.arm ?? "stop",
        });
    }
    return last;
}

/**
 * The claim, once: park each row the maker stamped, copy the integrator's target
 * words out of the record, and seed the two counters the integrator reads.
 */
function claimTripleChild(
    c: TripleChildState,
    member: PointMember,
    host: PointHost,
): void {
    const sel = c.machine.selector;
    if (typeof sel.const === "number") c.arm = sel.const;
    const w = c.machine.walk;
    for (let i = 0; i < c.machine.rows.length; i += 1) {
        const row = c.machine.rows[i];
        const index = tripleRow(c, i);
        if (!row || index === null) continue;
        // `lh $v0, 0x8($v1)` / `lh $v0, 0xa($v1)` off the claimed row, written
        // into the integrator's target and 16.8 words (wstag460 file 0xedc-0xf10).
        const live = host.read(index);
        for (const copy of row.copies) {
            // record+0xa is the row's x halfword and record+0xc its y, and the
            // `shift` is the `sll $vX, 8` that turns whole pixels into the
            // integrator's 16.8 words (wstag460 file 0xefc/0xf00, 0xf08/0xf0c).
            const src = copy.record === 0x0a ? live.x : live.y;
            c.words[copy.object] = src << copy.shift;
        }
    }
    if (!w) {
        // the two cleared cursor halves the claim parks before it walks
        c.words[0x58] = 0;
        return;
    }
    const seed = c.machine.seed;
    // `sh $v1, 0x70($s0)` -- the counter starts at the child's own stamped word
    // (obj+0x54), the speed out of the table its stamped byte indexes, and the
    // period is the claim's own literal.
    c.words[w.phase] = c.words[seed?.counter?.copyWord ?? 0x54] ?? 0;
    c.words[w.period] = seed?.period?.const ?? 0;
    const speeds = c.machine.speeds ?? [];
    c.words[w.speed] = speeds[c.spec.args.a2 ?? 0] ?? 0;
    // obj+0x76: the heading. `wstag460` file 0xf5c-0xf80 -- one draw from the
    // game's random stream, `andi $v0, 0xff` / `sll $v0, 0x4` / `sh $v0, 0x76`.
    c.words[w.seed] = ((randU16() & 0xff) << 4) & 0xffff;
    for (let i = 0; i < c.cur.length; i += 1) {
        const cur = c.cur[i] ?? (c.cur[i] = { entry: 0, hold: 0 });
        const script = tripleRowScript(member, c.machine.restart.script, i);
        cur.entry = 0;
        cur.hold = script[0]?.[1] ?? 0;
    }
}

/**
 * The walking machine's integrator, in the original's own order: the counter
 * first, the period gate, then the Manhattan test -- re-aim when the target is
 * inside the radius, step when it is outside -- and the two position words come
 * out of the heading through rsin and rcos at the child's own speed.
 */
function walkTripleChild(
    c: TripleChildState,
    w: PointTripleWalk,
    member: PointMember,
    delta: number,
): void {
    const counter = ((c.words[w.phase] ?? 0) + delta) & 0xffff;
    c.words[w.phase] = counter;
    const period = c.words[w.period] ?? 0;
    // `slt $v0, $v1` is `slt $v0, $v0, $v1`: (period < counter).  Both halves are
    // signed halfwords (`sll $v1, 0x10` / `sra $v1, 0x10`).
    if (((period << 16) >> 16) < ((counter << 16) >> 16)) {
        const dx = (c.words[w.xPixel] ?? 0) - (c.words[w.targetX] ?? 0);
        const dy = (c.words[w.yPixel] ?? 0) - (c.words[w.targetY] ?? 0);
        // `addu $v0, $a2, $a1` with both halves negated in place, against the
        // literal 30 in the call's own argument slot.
        const far = Math.abs(dx) + Math.abs(dy) > w.radius;
        if (far) {
            const speed = (c.words[w.speed] ?? 0) << 16 >> 16;
            const step = c.words[w.seed] ?? 0;
            // `mult` / `mflo`, and the `bgez` arm's `addiu $v0, 0xfff` runs only
            // on the negative side, then `sra $v0, 0xc`.
            const sx = signedShift12(rsin(step) * speed);
            const sy = signedShift12(rcos(step) * speed);
            c.words[w.xFixed] = (c.words[w.xFixed] ?? 0) + sx;
            c.words[w.yFixed] = (c.words[w.yFixed] ?? 0) + sy;
        } else {
            // the re-aim arm (`wstag460` 0xd54-0xdac): a fresh heading
            // from the game's random stream, the counter pulled back by the
            // period, then a SECOND draw jittering it by (rand & 0xf) - 7.
            c.words[w.seed] = ((randU16() & 0xff) << 4) & 0xffff;
            c.words[w.phase] = (counter - period) & 0xffff;
            const jitter = (randU16() & w.jitterMask) - w.reset;
            c.words[w.phase] = ((c.words[w.phase] ?? 0) + jitter) & 0xffff;
        }
    }
    c.words[w.xPixel] = ((c.words[w.xFixed] ?? 0) >> 8) & 0xffff;
    c.words[w.yPixel] = ((c.words[w.yFixed] ?? 0) >> 8) & 0xffff;
}

/** `(p >= 0 ? p : p - 1) >> 12`, the integrator's own rounding. */
function signedShift12(p: number): number {
    return (p >= 0 ? p : p - 1) >> 12;
}

/** PsyQ `rsin`, engine/dw3/rsin.ts; the integrator's own sine. */
function rsin(angle: number): number {
    return RSIN(angle);
}

/** PsyQ `rcos` is `rsin` a quarter turn on: `0x1000` in the same Q12 angle. */
function rcos(angle: number): number {
    return RSIN((angle + 0x1000) & 0xffff);
}

// ── arm 9: picture-steps (s785 0x327) ───────────────────────────────────────
//
// THE one stage-object member that claims NO point record.  It draws picture
// ids straight out of the stage's own sprite directory, wherever a character
// is, from a small counter-stepped state machine.  Read end to end out of
// `wstag785.s` on 2026-10-05; every offset below is a file offset in that
// overlay (RAM = 0x800A5DE0 + offset):
//
//   THE TICK (file 0x4d4, the 0x58-byte object the registry ctor at file 0x730
//   allocates through F0x800143dc).  State `obj+0x0c` dispatches at file 0x4e8:
//
//     state 0 (0x510) calls `obj+0x38` = advanceState (EXE F0x800142ac) and
//       stops -- so an object the script has only just built walks itself to
//       state 1 on its second blank.
//
//     state 1 (0x528) dispatches the sub-slot `obj+0x10`:
//       sub 0 (0x554) draws picture 0x32; sub 1 (0x590) draws 0x33; sub 2
//       (0x5d0) draws 0x34.  Each of the three, every blank:
//           `lw $v0, -0x2064($v0)`  the frame delta [0x8004df9c],
//           `lw $v1, 0x14($s1)` / `addu` / `sw`   obj+0x14 += delta,
//           `slti $v1, 0x4` / `bnez $v1, 0x714`   below 4 -> draw and stop,
//           else `lw $v0, 0x3c($s1)` / `jalr`      advanceClip (+0x10 = +1,
//                                                   counter and timer cleared)
//       and then FALL THROUGH into the next sub's body, so the frame that
//       completes one sub already draws the next one's picture (at 0x564-0x58c
//       for sub 0, the same run repeated).
//
//       sub 3 (0x610) has no counter at all except in one arm: it dispatches
//       the ARM WORD `obj+0x50` --
//           0 -> 0x35 (file 0x638),   1 -> 0x38 + ((obj+0x14 >> 3) & 1), the
//           56/57 alternation whose counter DOES keep counting (0x640-0x66c),
//           2 -> 0x3c (0x670),       3 -> 0x3d (in the branch's delay slot,
//                                       0x630-0x634), anything else -> 0x35.
//
//     state 2 (0x678) is the same shape with two subs: sub 0 draws 0x36 and
//       advances the CLIP when its counter reaches 4 (0x690-0x6c8); sub 1
//       draws 0x37 and advances the STATE (0x6d4-0x708) -- and still draws
//       that blank, because the advance is followed by the same `0x714` tail.
//
//     state 3 (0x71c) is the epilogue: nothing.
//
//   THE DRAW (every arm tail-calls the helper at file 0x428 with `a1` = the
//   picture and `a0` = the object):
//     file 0x434-0x448  x = [obj+0x54]+0x50 >> 8  (the anchor's world X, 16.8)
//     file 0x44c-0x468  y = ([obj+0x54]+0x54 >> 8) - 0x18
//     file 0x464        builds the transient 2-D context F0x8001F648 on the
//                       stack, then block+0x7c(0x1002, 2), block+0x74(0x140,
//                       0x100), resolve(0x1c70001) and block+0x84 =
//                       F0x8001ED6C(shapeSet, picture, x, y) -- the same
//                       sprite emitter the field's 2-D shapes go through, and
//                       the same per-stage sprite directory the point-sprite
//                       sheet is cut from.  The layer rectangles add their own
//                       `dx`/`dy`, so `drawSprite` at (x, y) is exact.
//
//   THE CONFIGURE HANDLER (file 0x760, SETANIM's third routine slot; it is
//   called with the object and the script's two operands):
//     808 (0x328) -> `li $v0, 0x2 ; sw $v0, 0x50($s0)`        arm word = 2
//     809 (0x329) -> `li $v0, 0x3 ; sw $v0, 0x50($s0)`        arm word = 3
//     810 (0x32a) -> `obj+0x28(2)` = setState(2)               state 2
//     and the shared tail (file 0x7e4-0x814) runs `find(5, operand, -1)` --
//     [0x8004b7bc] = EXE F0x8001810c, the hundred-slot resident-object walk --
//     for `0x328 <= s1 < 0x32a` only, storing the found object at `obj+0x54`.
//     That object is the FIELD CHARACTER whose `+0x4` is the operand: the
//     cast rebuild (fieldstg file 0x8460-0x8490) allocates each one through
//     F0x8009116c, which stores its ID argument at `+0x4` and reads the record
//     id off `+0x8` -- so `808/809` with operand 12 anchor the pictures on the
//     character whose id is 12.  The operand is per-stage script data, and the
//     extractor refuses a member whose recovered scripts disagree.
//
// THE PORT.  One `picture-steps` machine, data-driven by the member JSON:
// states/subs/arms/configure/anchor come out of `wstag785` (mined by
// tools/extract_point_record_actors.py), the drawn pictures are the stage's
// own sheet ids, and the anchor is resolved against the live cast the host
// keeps (web/game.js wires `setPointRecordAnchor`).  Two port decisions,
// stated rather than hidden:
//
//   * the original re-reads obj+0x54's position every blank and draws at the
//     world coordinates the field's own layer scrolls; the walker's field
//     draws camera-relative (web/game.js draws the native intents the same
//     way), so the draw passes (anchor.x, anchor.y + yOff) and the existing
//     `drawStageObjectSprites` path subtracts the camera;
//   * when the find matches nothing the original stores 0 and reads position
//     words off it; the port draws nothing instead of reproducing an
//     out-of-range read.

/** The drawn picture for one arm value, exactly as the 0x610 dispatch reads it. */
function pictureStepArm(m: PointPictureSteps, arm: number, counter: number): number {
    const arms = m.states["1"]?.arms ?? {};
    const a = arms[String(arm)] ?? arms["0"];
    if (!a) return 0x35;
    if ("pic" in a) return a.pic;
    return a.alternate[0] + ((counter >> a.shift) & 1);
}

/** The `picture-steps` configure handler (wstag785 file 0x760-0x828). */
export function firePictureSteps(a: PointActor, subId: number): boolean {
    const m = a.member.pictureSteps;
    const conf = m?.configure?.[String(subId)];
    // The original's return arm: every other operand is consumed and dropped.
    if (!m || !conf) return true;
    if (conf.arm !== undefined) a.arm = conf.arm;
    if (conf.anchor) a.anchor = m.anchor.p1;
    if (conf.state !== undefined) {
        // setState: state <- n, clip/counter/timer cleared (EXE F0x80014274).
        a.state = conf.state;
        a.clip = 0;
        a.counter = 0;
        a.timer = 0;
    }
    return true;
}

/**
 * One blank of the `picture-steps` machine, in the original's own order: the
 * state dispatch, then the sub-slot walk with its fall-through, then the arm
 * dispatch, then the draw.  The counter is a word (`lw`/`sw` of obj+0x14) and
 * every comparison is against a literal 4 the extractor read out of the code.
 */
function tickPictureSteps(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member.pictureSteps;
    if (!m) return;
    if (a.state === 3) {
        // The epilogue draws nothing.  The LAST picture of a finished run is
        // cleared, which is the visible difference between "state 3" and "the
        // frame that entered it".
        a.pic = null;
        return;
    }
    if (a.state !== 1 && a.state !== 2) {
        // state 0, and any state above 3 the dispatch lets fall into it: one
        // advanceState and nothing else (wstag785 file 0x510-0x524).
        a.state += 1;
        a.clip = 0;
        a.counter = 0;
        a.timer = 0;
        a.pic = null;
        return;
    }
    const st = m.states[String(a.state)];
    const subs = st?.subs ?? [];
    // The fall-through is a loop: a completed sub advances and the SAME blank
    // continues in the next body (file 0x588 -> 0x590, 0x5c8 -> 0x5d0, ...).
    // An ordinary blank is delta 1 -- one blank, one draw -- and the loop
    // makes a catch-up blank with a larger delta carry on from the body it
    // lands in rather than dropping a step.
    for (let guard = 0; guard < 8; guard += 1) {
        if (a.clip >= subs.length) {
            a.pic = null;
            return;
        }
        const sub = subs[a.clip];
        if (!sub) {
            a.pic = null;
            return;
        }
        if ("arm" in sub) {
            // sub 3 / sub 2+: dispatch the arm word.  The alternation's
            // counter keeps counting (file 0x640-0x66c); every other arm
            // leaves it where it was.
            a.pic = pictureStepArm(m, a.arm, a.counter);
            if (a.arm === 1) a.counter += delta;
            break;
        }
        a.counter += delta;
        if (a.counter < m.hold) {
            a.pic = sub.pic;
            break;
        }
        // Counter complete: advance, then continue in the next body.
        if (sub.advance === "clip") {
            a.clip += 1;
            a.counter = 0;
            a.timer = 0;
        } else {
            a.state += 1;
            a.clip = 0;
            a.counter = 0;
            a.timer = 0;
            // advanceState is followed by the same draw tail (file 0x700-0x714),
            // so the completing blank still shows this sub's picture, and the
            // run ends there.
            a.pic = sub.pic;
            break;
        }
    }
    // The anchor is a live object: the original stored its pointer and reads
    // `+0x50`/`+0x54` at draw time, so the port re-resolves the position every
    // blank the machine draws.  `+0x50` is the character's world X in 16.8 and
    // its top byte the pixel (engine/systems/field-character.ts documents the
    // same words for name 5; every makeFieldChar object keeps them the same
    // way -- fieldstg file 0xe5e4-0xe5e8 seeds the pair).
    if (a.pic !== null) {
        a.anchorPos = null;
        if (a.anchor !== null) {
            const an = m.anchor;
            const handle = host.anchor?.(an.type, a.anchor, an.p2);
            if (handle !== null && handle !== undefined) {
                const pos = host.anchorPos?.(handle);
                if (pos) a.anchorPos = { x: pos.x, y: pos.y };
            }
        }
        if (!a.anchorPos) a.pic = null;
    } else {
        a.anchorPos = null;
    }
}

/**
 * The pictures every live `picture-steps` actor drew this blank, as the
 * browser's draw pass reads them: `{pic, x, y}` with `y` already carrying the
 * helper's `-0x18` (`obj+0x54 >> 8` -> screen row): web/effects.js resolves
 * `pic` against the stage's own sheet and y-sorts the entry at `y`.
 */
export function pictureStepDraws(
    stageId: string,
): { pic: number; x: number; y: number }[] {
    const out: { pic: number; x: number; y: number }[] = [];
    for (const a of runtime[stageId] ?? []) {
        if (a.member.machine !== "picture-steps") continue;
        if (a.pic === null || !a.anchorPos) continue;
        const yOff = a.member.pictureSteps?.anchor.yOff ?? 0;
        out.push({ pic: a.pic, x: a.anchorPos.x, y: a.anchorPos.y + yOff });
    }
    return out;
}

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
function tickRideWalker(a: PointActor, host: PointHost, delta: number): void {
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
function tickScrollLayer(a: PointActor, _host: PointHost, delta: number): void {
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
