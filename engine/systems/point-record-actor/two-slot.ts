import type { PointActor, PointHost } from "./types.ts";
import { advanceClip, advanceState, playSound, write } from "./core.ts";

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
export function fireTwoSlot(a: PointActor, subId: number): boolean {
    const dir = a.member.twoSlot?.directions?.[String(subId)];
    if (dir === undefined) return true;
    a.state = 2;
    a.mode = dir;
    a.counter = 0;
    a.timer = 0;
    return true;
}

/** The character's `+0x54` as these arms see it, or null when there is none. */
export function charYOf(host: PointHost): number | null {
    return typeof host.charY === "function" ? host.charY() : null;
}

/**
 * Write the character's `+0x54`.  The original's arms never test the found
 * object for zero -- s261 stores through `$a0` whatever the lookup returned
 * (file 0x290 / 0x3b8) -- so this only does nothing when the HOST has no field
 * character at all, which is a stage with no player on it.
 */
export function setCharY(host: PointHost, fixed: number): void {
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

export function tickTwoSlot(a: PointActor, host: PointHost, delta: number): void {
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
