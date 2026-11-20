import {
  POINT_RECORD_BLINK_OFF,
  POINT_RECORD_SCRIPT_END,
  type PointActor,
  type PointActorTable,
  type PointCursor,
  type PointHost,
  type PointMember,
  type PointParentChild,
  type PointPatch,
  type PointScriptEntry,
  type RecipeByte,
} from "./types.ts";
import type { PointModeGate } from "./sprites.ts";
import { fireTriple, tickTriple } from "./triple.ts";
import { fireTwoSlot, tickTwoSlot } from "./two-slot.ts";
import { firePictureSteps, tickPictureSteps } from "./picture.ts";
import { fireRideWalker, fireScrollLayer, tickRideWalker, tickScrollLayer } from "./ride-scroll.ts";
import { padSlotEnded, stepPointRecordCursor } from "./stepper.ts";
import { tickGrid, tickLanes, tickRise, tickSingle } from "./grid-lanes.ts";

export const tables: Record<string, Record<string, PointMember>> = {};

export const runtime: Record<string, PointActor[]> = {};

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

export function recOf(a: PointActor, slot: number): number | null {
    return a.rec[slot] ?? null;
}

export function curOf(a: PointActor, slot: number): PointCursor {
    return (a.cur[slot] ??= { entry: 0, hold: 0 });
}

export function scriptOf(a: PointMember, name: string | undefined): PointScriptEntry[] {
    return (name && a.scripts[name]) || [];
}

function seed(a: PointMember, name: string): number {
    return a.seedHolds?.[name] ?? 0;
}

export function write(host: PointHost, index: number | null, patch: PointPatch): void {
    if (index === null) return;
    host.write(index, patch);
}

/** EXE F0x800142ac, the method at +0x38. */
export function advanceState(a: PointActor): void {
    a.clip = 0;
    a.counter = 0;
    a.timer = 0;
    a.state += 1;
}

/** EXE F0x800142c8, the method at +0x3c. */
export function advanceClip(a: PointActor): void {
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
export function setClip(a: PointActor, n: number): void {
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

export function playSound(a: PointActor, packed: string): void {
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
