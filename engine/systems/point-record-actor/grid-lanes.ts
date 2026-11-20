import {
  POINT_RECORD_BLINK_OFF,
  POINT_RECORD_SCRIPT_END,
  type PointActor,
  type PointGrid,
  type PointHost,
  type PointMember,
} from "./types.ts";
import { advanceState, curOf, playSound, recOf, scriptOf, write } from "./core.ts";
import { stepPointRecordCursor } from "./stepper.ts";
import { charYOf, setCharY } from "./two-slot.ts";

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
export function tickSingle(a: PointActor, host: PointHost, delta: number): void {
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
export function tickRise(a: PointActor, host: PointHost, delta: number): void {
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
export function tickGrid(a: PointActor, host: PointHost, delta: number): void {
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
export function tickLanes(a: PointActor, host: PointHost, delta: number): void {
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
