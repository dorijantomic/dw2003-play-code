import { randU16 } from "../../dw3/random-stream.ts";
import { rsin as RSIN } from "../../dw3/rsin.ts";
import {
  POINT_RECORD_SCRIPT_END,
  type PointActor,
  type PointHost,
  type PointMember,
  type PointPatch,
  type PointScriptEntry,
  type PointTripleArm,
  type PointTripleWalk,
  type TripleChildState,
} from "./types.ts";
import { advanceState, scriptOf } from "./core.ts";
import { stepPointRecordCursor } from "./stepper.ts";

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
export function fireTriple(a: PointActor, subId: number): boolean {
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

export function tickTriple(a: PointActor, host: PointHost, delta: number): void {
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
