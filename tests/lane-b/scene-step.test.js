// Lane B oracle: engine/systems/trigger-system.ts must match the original position
// step, i.e. fieldstg's step-load `0x80088288` (pro/fieldstg.s:5501 `.L0x000055d8`)
// and its step-exec `0x8008836c` (`.L0x000056bc`).
//
// Both halves run NATIVELY out of the shipped FIELDSTG.PRO image
// (web/assets/native/fieldstg.bin, the overlay the field screen lives in, load base
// 0x80082CB0). Everything they reach outward for is stubbed identically on both sides:
//   * 0x8009b708  the type-7 zone lookup -> the SHIPPED grid byte at the player's (x,y)
//                  (web/assets/data/story_trigger_grids.json)
//   * [0x80048acc] get_flag -> one flag map, shared with the port's flag store
//   * 0x800853f8  start_event -> records the event id and hands back a runner pointer,
//                  exactly as fieldstg's own starter does (it never returns 0, so the
//                  op-8 latch at extra+4 latches)
//   * 0x80088144  the indicator-actor factory, and the vtable slots ops 1-7 / 11-13 call
// The shipped facing cone (web/assets/data/scene/step_enable_table.json, FIELDSTG.PRO
// +0x14974) is REAL memory inside the image the original reads, so the original consults
// it and the port reads the same bytes out of the same JSON.
//
// Per frame the two sides are compared on
//   step   = runner+0x5c      (the grid byte's low five bits)
//   group  = runner+0x60      (its top three bits — the required facing group)
//   live   = step-load's return value
//   fired  = whether start_event ran this frame, and with which event id
//   latch  = the controller's extra+4 word
//
// The route is a walk: one representative cell for every distinct non-zero grid byte the
// stage has (so every step index and every facing group is visited, each with all eight
// facings), then a serpentine sweep of the whole grid. Every stage in STAGES is walked
// twice — the first visit and a second one after the driver object is rebuilt — because
// op 8's latch lives exactly as long as one visit (fieldstg.s:57c0/:57e8).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { createTriggerSystem } from "../../engine/systems/trigger-system.ts";
import {
    SETUP_OPS, PLAYBACK_OPS, PLAYBACK_ACTIVE_OPS,
    indicatorKindForOp, INDICATOR_KIND, execPlaybackRecord, handoffHold,
} from "../../engine/systems/scene-step-ops.ts";
import {
    fieldDirectionFromIndex, fieldDirectionIndex,
} from "../../engine/systems/field-movement.ts";
import {
    actorActionPlan, MODE_BLOCK_FILE, MODE_DEFAULT_FILE, SLOPE_STEP_CELLS,
    PAD_WALK_HANDLER, ACTOR_MODE,
} from "../../engine/systems/step-actor-actions.ts";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const STEPS = read("web/assets/data/story_steps.json").stages;
const GRIDS = read("web/assets/data/story_trigger_grids.json").stages;
const CONE = read("web/assets/data/scene/step_enable_table.json");
const FIELDSTG = new Uint8Array(readFileSync("web/assets/native/fieldstg.bin"));

// Three stages with op-8 steps, chosen so the route crosses several distinct grid bytes
// (hence several step indices and facing groups), and including the Master Room, whose
// two event records share a flag_key.
const STAGES = [
    { id: "305", why: "Master Room: two events share flag_key 012e000a" },
    { id: "400", why: "four op-8 steps (20..23) behind different tiles" },
    { id: "580", why: "five op-8 steps (24..28), 29 distinct grid bytes" },
];

const STEP_LOAD = 0x80088288;
const STEP_EXEC = 0x8008836c;
// The type-7 zone lookup is a FUNCTION CELL inside FIELDSTG.PRO's own data, read with
// `lw $v0, -0x48f8($v0)` off lui 0x800a (fieldstg.s:5504/5509). The image ships the
// cell, not the target it holds at runtime, so the cell is WRITTEN with the stub's
// address — the same way engine/native/runtime.ts seeds the zonemgr method cells.
const GRID_CELL = 0x8009b708;
const START_EVENT = 0x800853f8; // fieldstg.s:5630  jal 0x800853f8
const ACTOR_FACTORY = 0x80088144; // fieldstg.s:5703 jal 0x80088144
// get_flag through the flag-API cell at 0x80048acc. F0x800163b0 takes (id, expected) —
// it moves a1 into a2 and hands both to the bank reader (exe/fns.s:6843-6872
// `move_ $a2, $a1`), and the step-exec gate is `beqz` on its result
// (fieldstg.s:5700/:5734). So the stub answers (stored == expected), which is the same
// comparison engine/systems/trigger-system.ts _gatePasses makes.
const GET_FLAG = 0x800163b0;
// The step program's three static dispatch tables, all inside FIELDSTG.PRO's own text:
// ops 5..13 (fieldstg.s:5597-5601), ops 1..4 (file 0x1c0) and the playback executor's
// ops 1..14 (file 0x1e8).
const DISPATCH_TABLES = [0x80082e48, 0x80082e70, 0x80082e98];

const OBJ = 0x80150000;   // the 0x68-byte driver object
const EXTRA = 0x80151000; // its 8-byte second buffer: [0] indicator actor, [4] the latch
const ENTITY = 0x80152000; // the type-5 player entity (runner+0x58)
const PROG = 0x80153000;   // the step program: 24-byte records
const ACTOR = 0x80154000; // a stand-in indicator actor
const RUNNER = 0x80155000; // the runner pointer start_event hands back
const STUB = 0x0fe40000;

/**
 * Open as many of the stage's op-8 steps as the flag map allows, deterministically: walk
 * them in program order and adopt a step's (cond -> arg) pairs only when neither entry
 * contradicts one already taken. This is the flag state the walk happens in, and BOTH
 * sides read the same map, so a gate that stays shut stays shut on both sides.
 */
function openFlags(prog, flags) {
    const own = prog.events.map((e) => e.event_id);
    for (const st of prog.steps) {
        if (st.op !== 8 || !own.includes(st.params[0])) continue;
        const want = [];
        if (st.cond_a !== 0xffff) want.push([st.cond_a, st.arg_a]);
        if (st.cond_b !== 0xffff) want.push([st.cond_b, st.arg_b]);
        if (want.some(([id, v]) => flags.has(id) && flags.get(id) !== v)) continue;
        for (const [id, v] of want) flags.set(id, v);
    }
    return flags;
}

/** The 8x8 gate table as the loaded image holds it — no JSON involved. */
function coneInImage() {
    const rt = new NativeStageRuntime(
        new Uint8Array(8),
        { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
        { setFlag() {}, getFlag: () => 0, rand16: () => 1 }, undefined, FIELDSTG,
    );
    return Array.from({ length: 8 }, (_, g) =>
        Array.from({ length: 8 }, (_, f) => rt.mem.read8(0x80097624 + g * 8 + f)));
}

function gridByteAt(grid, x, y) {
    if (grid.uniform !== undefined) return grid.uniform & 0xff;
    const cx = Math.floor(x / grid.cell), cy = Math.floor(y / grid.cell);
    if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return 0;
    return grid.grid[cy * grid.w + cx] & 0xff;
}

/** Write a stage's step program into memory as the disc's 24-byte records. */
function writeProgram(mem, prog) {
    const n = Math.max(prog.steps.length, 1);
    for (let i = 0; i < n; i++) {
        const s = prog.steps[i];
        const at = PROG + i * 24;
        mem.write16(at + 0x0, s.cond_a & 0xffff);
        mem.write16(at + 0x2, s.arg_a & 0xffff);
        mem.write16(at + 0x4, s.cond_b & 0xffff);
        mem.write16(at + 0x6, s.arg_b & 0xffff);
        mem.write16(at + 0x8, s.op & 0xffff);
        for (let k = 0; k < 6; k++) mem.write16(at + 0xa + 2 * k, (s.params?.[k] ?? 0) & 0xffff);
    }
}

/**
 * A walk over one stage: every distinct non-zero grid byte at all eight facings, then a
 * serpentine sweep of the whole grid. Positions are cell centres, so the byte under the
 * player is the byte the shipped grid claims for that cell.
 */
function route(grid) {
    const out = [];
    if (grid.uniform !== undefined) {
        for (let i = 0; i < 16; i++) out.push({ x: 32 + i * 32, y: 64 });
        return out;
    }
    const seen = new Set();
    for (let i = 0; i < grid.grid.length; i++) {
        const b = grid.grid[i] & 0xff;
        if (b === 0 || seen.has(b)) continue;
        seen.add(b);
        const cx = i % grid.w, cy = Math.floor(i / grid.w);
        for (let f = 0; f < 8; f++) out.push({ x: cx * grid.cell + 4, y: cy * grid.cell + 4, facing: f });
    }
    for (let cy = 0; cy < grid.h; cy++) {
        for (let k = 0; k < grid.w; k++) {
            const cx = cy % 2 === 0 ? k : grid.w - 1 - k;
            out.push({ x: cx * grid.cell + 4, y: cy * grid.cell + 4, facing: (cx + cy) & 7 });
        }
    }
    return out;
}

function rig(stage) {
    const prog = STEPS[stage];
    const grid = GRIDS[stage];
    const mapId = `s${stage}`;
    const flags = openFlags(prog, new Map());
    const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const events = [];       // start_event calls the ORIGINAL made
    const portEvents = [];   // playEvent calls the PORT made
    const rt = new NativeStageRuntime(
        new Uint8Array(8), entry,
        { setFlag() {}, getFlag: (id) => flags.get(id) ?? 0, rand16: () => 1 },
        undefined, FIELDSTG,
    );
    const mem = rt.mem;
    const write32 = (a, v) => mem.write32(a >>> 0, v >>> 0);
    const read32 = (a) => mem.read32(a >>> 0) >>> 0;

    // The runtime installs recording stubs at every sprite-layer method target it knows,
    // and that table's slots 0x3e4..0x400 happen to be the position step's OWN opcode
    // handlers (LAYER_METHOD_SLOTS in engine/native/runtime.ts:144-145 lists 0x80088470 =
    // op 8). Drop them so the disc's bodies run.
    for (const table of DISPATCH_TABLES) {
        for (let i = 0; i < 14; i++) {
            const target = mem.read32(table + i * 4) >>> 0;
            if (target) rt.cpu.clearStub(target);
        }
    }

writeProgram(mem, prog);
    write32(OBJ + 0x54, PROG);     // runner+0x54 = this stage's step program
    write32(OBJ + 0x58, ENTITY);   // runner+0x58 = the type-5 player entity
    write32(EXTRA + 0, ACTOR);     // extra+0 = a bubble already in hand, so the tail's
                                   // setState(1) path (fieldstg.s:58c8) runs from frame 1
    write32(ENTITY + 0x110, STUB + 0x40);
    write32(ENTITY + 0x150, STUB + 0x44);
    write32(ENTITY + 0x154, STUB + 0x48);
    write32(ENTITY + 0x158, STUB + 0x4c);
    write32(ACTOR + 0x28, STUB + 0x50);
    // op 6 calls through the function CELL at 0x8009B718 (fieldstg.s:57b4
    // `lw $v0,-0x48e8($v0)` off lui 0x800a → 0x000a0000-0x48E8). The image ships that
    // cell holding 0x80092908 (file 0xF758), which finds the type-5 player entity #1
    // and clears its +0x10c word — and never reads the argument op 6 passes. Stub the
    // cell so the call is observable.
    write32(0x8009b718, STUB + 0x54);

    const act = [];
    rt.cpu.setStub(STUB + 0x40, () => { act.push("op10"); return 0; });
    rt.cpu.setStub(STUB + 0x44, (c) => { act.push(["op11", c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(STUB + 0x48, () => { act.push(["op12"]); return 0; });
    rt.cpu.setStub(STUB + 0x4c, (c) => { act.push(["op13", c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(STUB + 0x50, (c) => { act.push(["indicator", c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(STUB + 0x54, (c) => { act.push(["op6", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(ACTOR_FACTORY, () => ACTOR);
    rt.cpu.setStub(GET_FLAG, (c) => ((flags.get(c.reg(4) | 0) ?? 0) === (c.reg(5) | 0) ? 1 : 0));
    mem.write32(GRID_CELL, STUB);
    rt.cpu.setStub(STUB, (c) => gridByteAt(grid, c.reg(6), c.reg(7)));
    // start_event allocates and returns a runner; it never returns 0, so op 8's latch
    // at extra+4 really does latch.
    rt.cpu.setStub(START_EVENT, (c) => { events.push(c.reg(4) | 0); return RUNNER; });

    const port = createTriggerSystem({
        getProgram: () => prog,
        getGrid: () => grid,
        getEnableTable: () => CONE,
        // start_event binds a record iff THIS stage's own event table owns the id
        // (fieldstg.s:2536-2562); an id from another stage binds nothing. The stage's
        // table is story_steps.json's `events` — every record, including the ones with no
        // bytecode, which the shipped wstag_events.json leaves out.
        getEventById: (_m, id) => (prog.events.some((e) => e.event_id === id) ? { id } : null),
        getEventByKey: () => null,
        flags: { get: (id) => flags.get(id) ?? 0, set: (id, v) => flags.set(id, v ? 1 : 0) },
        done: () => false,
        markDone: () => {},
        // The scene keeps playing: on the disc the latch — not a completion callback —
        // is what stops a second fire, so this must NOT call onDone.
        playEvent: (ev) => { portEvents.push(ev.id); },
    });

    /** The original: one frame of step-load, then step-exec when it reports live. */
    function originalFrame(x, y, facing) {
        write32(ENTITY + 0x58, x);   // entity+0x58 = x
        write32(ENTITY + 0x5c, y);   // entity+0x5c = y
        write32(ENTITY + 0x60, facing & 7);
        const before = events.length;
        const live = rt.cpu.call(STEP_LOAD, [OBJ], 20000);
        const step = read32(OBJ + 0x5c);
        const group = read32(OBJ + 0x60);
        if (live) {
            act.length = 0;
            rt.cpu.call(STEP_EXEC, [OBJ, EXTRA], 20000);
        }
        return {
            step, group, live: live ? 1 : 0,
            fired: events.length > before ? events[events.length - 1] : null,
            latch: read32(EXTRA + 4),
        };
    }

    /** The port, driven with the same inputs. */
    function portFrame(x, y, facing) {
        const before = portEvents.length;
        const s = port.sampleStep(mapId, x, y, facing);
        port.tick(mapId, x, y, facing);
        return {
            step: s ? s.step : 0,
            group: s ? s.group : 0,
            live: s && s.live ? 1 : 0,
            fired: portEvents.length > before ? portEvents[portEvents.length - 1] : null,
            latch: port.latched(mapId) ? 1 : 0,
        };
    }

    return {
        rt, port, originalFrame, portFrame, events, act, prog, grid, mapId, flags, mem,
        read16: (a) => mem.read16(a >>> 0),
    };
}

/** Run a whole visit on both sides, comparing every frame. Returns what fired. */
function visit(stage, frames) {
    const rigged = rig(stage);
    const fired = [];
    const otherOps = [];
    for (const f of frames) {
        rigged.act.length = 0;
        const o = rigged.originalFrame(f.x, f.y, f.facing ?? 0);
        if (rigged.act.length) otherOps.push(rigged.act[0][0]);
        const p = rigged.portFrame(f.x, f.y, f.facing ?? 0);
        const where = `s${stage} @(${f.x},${f.y}) facing ${f.facing ?? 0} byte ${
            gridByteAt(rigged.grid, f.x, f.y)}`;
        assert.deepEqual(p.step, o.step, `${where}: step index (runner+0x5c)`);
        assert.deepEqual(p.group, o.group, `${where}: facing group (runner+0x60)`);
        assert.deepEqual(p.live, o.live, `${where}: step-load return`);
        assert.deepEqual(p.fired, o.fired, `${where}: start_event`);
        assert.deepEqual(p.latch, o.latch ? 1 : 0, `${where}: the op-8 latch at extra+4`);
        if (o.fired !== null) fired.push(o.fired);
    }
    return { fired, otherOps, rig: rigged };
}

for (const { id, why } of STAGES) {
    test(`s${id}: the position step matches step-load + step-exec over a walk (${why})`, () => {
        const grid = GRIDS[id];
        const prog = STEPS[id];
        assert.ok(prog, `s${id} has a step program`);
        assert.ok(grid, `s${id} has a type-7 grid`);
        assert.ok(prog.steps.some((s) => s.op === 8), `s${id} uses op 8`);

        const frames = route(grid);
        assert.ok(frames.length >= 8, "the walk has frames");

        assert.deepEqual(coneInImage(), CONE.rows,
            "the shipped JSON is FIELDSTG.PRO's own table, byte for byte");

        // Visit 1: the driver object exists, so op 8 may latch once.
        const first = visit(id, frames);
        assert.ok(first.fired.length >= 1, `s${id} fires at least one op-8 event on the walk`);
        assert.ok(
            first.fired.every((ev) => prog.events.some((e) => e.event_id === ev)),
            "every id the original started is in this stage's own event table",
        );
        assert.equal(new Set(first.fired).size, first.fired.length,
            "the disc's latch lets op 8 fire once per stage visit");
        // The walk also crosses the indicator opcodes, and those really ran: the original
        // reached its actor factory and its vtable calls instead of trapping.
        assert.ok(first.otherOps.length > 0,
            `s${id} exercises the non-op-8 opcodes natively too (saw ${[...new Set(first.otherOps)]})`);

        // Visit 2: the driver object is rebuilt (extra+4 zeroed, fresh port state), so
        // the same walk fires again — which is what a player sees on a second visit.
        const second = visit(id, frames);
        assert.deepEqual(second.fired, first.fired, "a second visit replays the same fires");
    });
}

test("the cone gate is the shipped ±1 facing cone, per opcode class", () => {
    const { port } = rig("305");
    for (let g = 0; g < 8; g++) {
        for (let f = 0; f < 8; f++) {
            const d = (f - g + 8) % 8;
            const inside = d <= 1 || d === 7;   // {g-1, g, g+1} mod 8
            assert.equal(port._stepLive(1, g, f), inside,
                `group ${g} allows facings {${(g + 7) % 8}, ${g}, ${(g + 1) % 8}}; facing ${f}`);
            assert.equal(port._stepLive(8, g, f), true, "op 8 never reads the cone");
            assert.equal(CONE.rows[g][f], inside ? 1 : 0, "and the shipped bytes agree");
        }
    }
});

test("a grid byte of 0 is no step: the original reports not-live and fires nothing", () => {
    const { originalFrame, portFrame, grid } = rig("305");
    // s305's grid has zero cells; find one and stand on it.
    let cx = 0, cy = 0;
    outer: for (let y = 0; y < grid.h; y++) {
        for (let x = 0; x < grid.w; x++) {
            if ((grid.grid[y * grid.w + x] & 0xff) === 0) { cx = x; cy = y; break outer; }
        }
    }
    const x = cx * grid.cell + 4, y = cy * grid.cell + 4;
    assert.equal(gridByteAt(grid, x, y), 0);
    const o = originalFrame(x, y, 0);
    assert.equal(o.live, 0, "fieldstg.s:5618 beqz -> not live");
    assert.equal(o.fired, null);
    const p = portFrame(x, y, 0);
    assert.deepEqual([p.step, p.group, p.live, p.fired], [0, 0, 0, null]);

    // ... and it leaves runner+0x5c / runner+0x60 alone: the disc branches out at
    // fieldstg.s:5618 BEFORE the stores at :5628/:5634, so both sides keep the last
    // non-zero byte's values.
    const on = originalFrame(356, 228, 0);
    const pon = portFrame(356, 228, 0);
    assert.equal(on.live, 1);
    assert.equal(on.step, 1);
    assert.deepEqual([pon.live, pon.step], [1, 1]);
    const back = originalFrame(x, y, 0);
    assert.deepEqual([back.live, back.step, back.group], [0, 1, on.group],
        "the original keeps the stale step index across an empty tile");
    const pback = portFrame(x, y, 0);
    assert.deepEqual([pback.live, pback.step, pback.group], [0, 1, on.group],
        "and so does the port");
});

// ── The other operations: every opcode the setup executor runs besides op 8 ──
//
// One stage per ported opcode, chosen from the shipped data: a cell whose grid byte
// names that step index, on that stage's own type-7 grid (measured by scanning all 291
// programs against all 291 grids — op 0 has 288 records and NO cell that names one, so
// it is unreachable and is covered by the table test below instead).
//
// Per frame both sides are compared on every word the op writes:
//   ACTOR+0x8    the indicator kind (SENTINEL = this frame wrote no bubble)
//   ACTOR+0x64   the disc zeroes it beside the kind (:58ec)
//   ACTOR+0x68   (:58f8)
//   ENTITY+0x78  op 5's first word (:5788)
//   [0x8004B41C] op 5's second word (:57a0, the jump's delay slot)
//   the calls    op 6's cell call, ops 11/12/13's actor vtable slot, and the bubble's
//                setState(1) — which runs on exactly the ops that write a kind
// and on start_event for op 8.

const SENTINEL = 0x5a5a5a5a;
const IMAGE_VIEW = new DataView(FIELDSTG.buffer, FIELDSTG.byteOffset, FIELDSTG.byteLength);
const ramWord = (ram) => IMAGE_VIEW.getUint32(ram - 0x80082cb0, true) >>> 0;

/**
 * Resolve an opcode's handler the way the executor itself does, reading the two static
 * tables straight out of the shipped image: table A (file 0x198) owns ops 5..13, and
 * everything else falls through to file 0x5840, which reaches table B (file 0x1c0) for
 * ops 1..7 and the shared kind-0 tail at file 0x587c for op 0 and op >= 8.
 */
const HANDLERS = (() => {
    const out = {};
    for (let op = 0; op <= 20; op++) {
        let h = ((op - 5) >>> 0) < 9 ? ramWord(0x80082e48 + (op - 5) * 4) - 0x80082cb0 : 0x5840;
        // ops 7, 9 and 10 land on the shared fall-through at 0x5840, which then reads
        // table B — or, for ops 9/10 (past its 7 entries), the kind-0 tail at 0x587c.
        if (h === 0x5840) h = ((op - 1) >>> 0) < 7 ? ramWord(0x80082e70 + (op - 1) * 4) - 0x80082cb0 : 0x587c;
        out[op] = h;
    }
    return out;
})();
const OP_STAGES = [
    { op: 1, stage: "331", why: "the door/warp arrow (its op-1 tiles carry groups 1/3/5/7 -> kinds 6-9)" },
    { op: 1, stage: "825", why: "the only shipped tiles whose group is 4 -> the lift arrow (kind 10)" },
    { op: 2, stage: "205", why: "the ladder" },
    { op: 3, stage: "205", why: "the second ladder form" },
    { op: 4, stage: "345", why: "the door glyph" },
    { op: 5, stage: "261", why: "two word-writes, no bubble" },
    { op: 6, stage: "261", why: "the function-cell call, no bubble" },
    { op: 7, stage: "202", why: "the tool icon" },
    { op: 8, stage: "305", why: "the cutscene (start_event)" },
    { op: 9, stage: "330", why: 'the "!" bubble' },
    { op: 10, stage: "205", why: 'the second "!" bubble form' },
    { op: 11, stage: "735", why: "actor+0x150(group)" },
    { op: 12, stage: "735", why: "actor+0x154()" },
    { op: 13, stage: "735", why: "actor+0x158(param0)" },
    { op: 14, stage: "311", why: 'falls out of both tables into the "!" tail' },
];

/** The first cell of a stage's grid whose byte names `stepIdx` (and its facing group). */
function cellNaming(grid, stepIdx) {
    return cellNamingAll(grid, stepIdx)[0] ?? null;
}

/**
 * One cell per distinct facing group whose byte names `stepIdx`. Op 1's arrow is chosen
 * by the group (fieldstg.s:589c), so covering every group covers every arrow kind.
 */
function cellNamingAll(grid, stepIdx) {
    const out = [];
    const seen = new Set();
    if (grid.uniform !== undefined) {
        if ((grid.uniform & 0x1f) === stepIdx) {
            out.push({ x: 32, y: 32, byte: grid.uniform & 0xff });
        }
        return out;
    }
    for (let i = 0; i < grid.grid.length; i++) {
        const b = grid.grid[i] & 0xff;
        if (b === 0 || (b & 0x1f) !== stepIdx) continue;
        const g = b >> 5;
        if (seen.has(g)) continue;
        seen.add(g);
        const cx = i % grid.w, cy = Math.floor(i / grid.w);
        out.push({ x: cx * grid.cell + 4, y: cy * grid.cell + 4, byte: b });
    }
    return out;
}

test("every opcode the setup executor runs matches the port, one stage each", () => {
    const seenKinds = new Set();
    const seenSlots = new Set();
    for (const { op, stage, why } of OP_STAGES) {
        const prog = STEPS[stage];
        const grid = GRIDS[stage];
        const idx = prog.steps.findIndex((s) => s.op === op);
        assert.ok(idx >= 0, `s${stage} has an op-${op} record (${why})`);
        // Op 1's arrow is a function of the grid byte's group, so every op-1 record's
        // cells are walked (deduped by group) rather than only the first record's.
        const idxs = op === 1
            ? prog.steps.map((s, i) => (s.op === 1 ? i : -1)).filter((i) => i >= 0)
            : [idx];
        const seenGroups = new Set();
        const cells = [];
        for (const i of idxs) {
            for (const c of cellNamingAll(grid, i)) {
                if (seenGroups.has(c.byte >> 5)) continue;
                seenGroups.add(c.byte >> 5);
                cells.push(c);
            }
        }
        assert.ok(cells.length > 0, `s${stage} has a grid cell naming step ${idx} (op ${op})`);

        const rigged = rig(stage);
        // Open the target step's own two flag gates, on the map both sides read.
        for (const [id, want] of [[prog.steps[idx].cond_a, prog.steps[idx].arg_a],
            [prog.steps[idx].cond_b, prog.steps[idx].arg_b]]) {
            if (id !== 0xffff) rigged.flags.set(id, want);
        }

      for (const at of cells) {
        const group = at.byte >> 5;
        for (let facing = 0; facing < 8; facing++) {
            // Poison every word this op could write, so "wrote nothing" is visible.
            const w = (a) => rigged.mem.write32(a >>> 0, SENTINEL >>> 0);
            const r = (a) => rigged.mem.read32(a >>> 0) >>> 0;
            w(ACTOR + 0x8); w(ACTOR + 0x64); w(ACTOR + 0x68);
            w(ENTITY + 0x78); w(0x8004b41c);
            rigged.act.length = 0;
            const o = rigged.originalFrame(at.x, at.y, facing);
            const where = `s${stage} op ${op} step ${idx} byte ${at.byte} group ${group} facing ${facing}`;

            rigged.port.tick(rigged.mapId, at.x, at.y, facing);
            const eff = rigged.port.lastOp(rigged.mapId);
            if (!o.live) {
                assert.equal(eff, null, `${where}: not live, so no op ran`);
                assert.deepEqual(r(ACTOR + 0x8), SENTINEL, `${where}: and it wrote nothing`);
                continue;
            }
            assert.ok(eff, `${where}: live, so an op ran`);
            assert.equal(eff.op, op, `${where}: the port ran this op`);

            // The indicator: the kind word and the two words cleared beside it.
            assert.equal(r(ACTOR + 0x8) === SENTINEL ? null : r(ACTOR + 0x8), eff.kind,
                `${where}: the indicator kind (actor+0x8)`);
            if (eff.kind !== null) {
                assert.equal(r(ACTOR + 0x64), 0, `${where}: actor+0x64 is zeroed`);
                assert.equal(r(ACTOR + 0x68), 0, `${where}: actor+0x68 is zeroed`);
                seenKinds.add(eff.kind);
            }
            // The bubble's setState(1) runs on exactly the ops that write a kind.
            const sawSetState = rigged.act.some((e) => e[0] === "indicator");
            assert.equal(sawSetState, eff.kind !== null,
                `${where}: the bubble's setState(1) call`);

            // op 5's two words.
            assert.equal(r(ENTITY + 0x78) === SENTINEL ? undefined : r(ENTITY + 0x78),
                eff.actor78, `${where}: op 5's actor+0x78`);
            assert.equal(r(0x8004b41c) === SENTINEL ? undefined : r(0x8004b41c),
                eff.global4b41c, `${where}: op 5's [0x8004B41C]`);

            // op 6's call through the cell at 0x8009B718. The callee ignores its
            // argument, so only that it ran is comparable.
            const op6 = rigged.act.find((e) => e[0] === "op6");
            assert.equal(op6 !== undefined, eff.partySlot !== undefined,
                `${where}: op 6's call through [0x8009B718]`);

            const ACTOR_SLOT_NAME = { op11: 0x150, op12: 0x154, op13: 0x158 };
            // ops 11/12/13's actor vtable slot. The original passes record+0xa as a
            // POINTER for op 13, so it is normalised back to param 0.
            const slotCall = rigged.act.find((e) => ACTOR_SLOT_NAME[e[0]] !== undefined);
            const slotName = eff.actorSlot ? `0x${eff.actorSlot.toString(16)}` : null;
            assert.equal(slotCall ? `0x${ACTOR_SLOT_NAME[slotCall[0]].toString(16)}` : null, slotName,
                `${where}: the player-actor slot`);
            if (slotCall) {
                seenSlots.add(slotCall[0]);
                if (slotCall[0] === "op13") {
                    // op 13 passes &record[0xa] (addiu $a1,0xa at fieldstg.s:582c), so
                    // what is comparable is the u16 that pointer addresses.
                    assert.equal(rigged.read16(slotCall[1] >>> 0), eff.actorArg,
                        `${where}: the u16 op 13 points at`);
                } else if (slotCall[0] === "op11") {
                    assert.equal(slotCall[1], eff.actorArg, `${where}: op 11's facing group`);
                } else {
                    assert.equal(eff.actorArg, undefined, `${where}: op 12 passes no a1`);
                }
            }
        }
      }
    }
    // The ports actually reached every kind and every actor slot the data uses.
    assert.deepEqual([...seenKinds].sort((a, b) => a - b), [0, 2, 4, 5, 6, 7, 8, 9, 10],
        "kinds 1 and 3 are never written by any shipped op; the rest all were");
    assert.deepEqual([...seenSlots].sort(), ["op11", "op12", "op13"], "all three actor slots");
});

test("op 0 is unreachable in the shipped data, and its handler draws kind 0", () => {
    // 288 op-0 records exist (one per stage, all params zero) but no grid cell in any of
    // the 291 stages names one, so nothing the player can stand on reaches it.
    let cells = 0;
    for (const [mid, prog] of Object.entries(STEPS)) {
        const grid = GRIDS[mid];
        if (!grid) continue;
        const bytes = grid.uniform !== undefined ? [grid.uniform] : grid.grid;
        for (const b of bytes) {
            if (b == null || (b & 0xff) === 0) continue;
            const i = b & 0x1f;
            if (i < prog.steps.length && prog.steps[i].op === 0) cells++;
        }
    }
    assert.equal(cells, 0, "no grid cell names an op-0 record");
    // Its handler is file 0x587c, the same one ops 9/10/14+ fall into: kind 0.
    assert.equal(indicatorKindForOp(0, 0), INDICATOR_KIND.exclaim);
    assert.equal(indicatorKindForOp(9, 3), INDICATOR_KIND.exclaim);
});

test("the op -> kind table is the disc's four constants plus op 1's group arithmetic", () => {
    // fieldstg.s:587c/5884/588c/5894 and the shared tail :58b8-590c.
    assert.equal(indicatorKindForOp(2, 5), 2, "op 2 -> ladder");
    assert.equal(indicatorKindForOp(3, 5), 2, "op 3 -> ladder");
    assert.equal(indicatorKindForOp(4, 5), 4, "op 4 -> door glyph");
    assert.equal(indicatorKindForOp(7, 5), 5, "op 7 -> tool");
    // Ops table A intercepts (fieldstg.s:5750 `sltiu $v1,$v1,9` before the .L0x5840
    // fall-through), so they draw NOTHING — the walker's old "!" here was invented.
    for (const op of [5, 6, 8, 11, 12, 13]) {
        assert.equal(indicatorKindForOp(op, 3), null, `op ${op} draws no bubble`);
    }
    // op 1: kind = (group >> 1) + 6, and 10 when the group is exactly 4 (:589c-58b4).
    for (let g = 0; g < 8; g++) {
        assert.equal(indicatorKindForOp(1, g), g === 4 ? 10 : (g >> 1) + 6, `group ${g}`);
    }
    // ops 14 and up fall out of both tables into the same kind-0 tail (:587c).
    assert.equal(indicatorKindForOp(14, 1), 0);
    assert.equal(indicatorKindForOp(255, 1), 0);
    // ... and the decoded table lists each op with the handler the image really holds.
    for (const row of SETUP_OPS) {
        assert.equal(row.handler, HANDLERS[row.op], `op ${row.op}'s handler offset`);
    }
    assert.equal(SETUP_OPS.length, 15);
});

// ── exec#2: the PLAYBACK executor (`0x800885d4`) runs natively beside the port ──
//
// The half of the position step that fires when the player PRESSES on a tile. One
// routine, one static table (file 0x1e8, ops 1..14), one entry per opcode, and the
// driver's own gates in front of it (fieldstg.s:5bd8-5d84). Here the ORIGINAL is
// called directly at 0x800885d4 out of the shipped image, with everything it reaches
// outward for stubbed, and compared against `execPlaybackRecord` for one shipped place
// per opcode. Every write and every call is compared, not a summary.
//
// What is stubbed, and why each is outside the overlay's own data:
//   ENTITY+0x110/0x114/0x118/0x11c/0x120/0x124/0x158  the player actor's vtable
//   0x8008b770 / 0x8008b6d4                             the two handoff entry points,
//        which live INSIDE fieldstg, so clearStub first or the shipped bodies run
//   [0x80099d90]                                       the 0x12-stride door list POINTER,
//        `lui 0x800a / lw -0x6270` = 0x800A0000-0x6270 (fieldstg.s:59c4/59c8)
const PLAYBACK_EXEC = 0x800885d4;
const HANDOFF_WRAPPER = 0x8008b770;
const HANDOFF_BODY = 0x8008b6d4;
const DOOR_LIST_CELL = 0x80099d90;   // the pointer to the list
const ROUTE_D78 = 0x80048d78;        // lui 0x8005 / addiu -0x72cc = 0x80048D34, +0x44
const ROUTE_D7A = 0x80048d7a;        // ... +0x46
const CLIMB_X = 0x80082e8c;          // op 4's two coordinate globals, read as words
const CLIMB_Y = 0x80082e90;
const LIST = 0x80156000;
const STRIDE = 0x12;

/** The playback executor's own table, re-read out of the image (file 0x1e8). */
const PLAYBACK_HANDLERS = (() => {
    const out = {};
    for (let op = 1; op <= 14; op++) out[op] = ramWord(0x80082e98 + (op - 1) * 4) - 0x80082cb0;
    return out;
})();

/**
 * A door list the way op 1 walks it: `entry[0]` is the live flag the disc zeroes,
 * `entry[1]` is the key it compares against the record's param 5, and the next entry's
 * `entry[0]` sits at `+0x12` — that byte is the loop's continuation test
 * (fieldstg.s:59f8/:5a00), so a zero there ends the walk. `LIST+2` is the guard read
 * before the walk starts (:59d0/:59d8).
 */
function writeDoorList(mem, keys) {
    mem.write32(DOOR_LIST_CELL, LIST);
    mem.write8(LIST + 2, 1);                       // the guard: nonzero = walk at all
    for (let i = 0; i < keys.length; i++) {
        const at = LIST + i * STRIDE;
        mem.write8(at + 0, 0xa0 + i);               // live flag
        mem.write8(at + 1, keys[i]);               // the key
    }
    mem.write8(LIST + keys.length * STRIDE, 0);    // end of the list
    return keys.map((_, i) => LIST + i * STRIDE);
}

/**
 * A flag state in which EVERY condition this stage's own records ask for holds, taken
 * first-come so a stage that wants both 0 and 1 from one flag keeps the first. The
 * playback table's arm is only reachable when the record's conds pass (fieldstg.s:5700 /
 * :5734 skip the level-1 increment at :5d40), so the op-by-op comparison has to run in
 * that state — the gate itself is asserted separately, in "the Fishing Pole gate".
 */
function satisfiedFlags(prog) {
    const flags = new Map();
    for (const st of prog.steps) {
        for (const [id, v] of [[st.cond_a, st.arg_a], [st.cond_b, st.arg_b]]) {
            if (id === 0xffff) continue;
            if (!flags.has(id)) flags.set(id, v);
        }
    }
    return flags;
}

/** Every call the original's stubs saw this frame, in order. */
function playbackRig(stage, keys = [0, 0, 0, 0], flagState = null) {
    const prog = STEPS[stage];
    const grid = GRIDS[stage];
    const mapId = `s${stage}`;
    const flags = flagState ?? satisfiedFlags(prog);
    const rt = new NativeStageRuntime(
        new Uint8Array(8),
        { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
        { setFlag() {}, getFlag: (id) => flags.get(id) ?? 0, rand16: () => 1 },
        undefined, FIELDSTG,
    );
    const mem = rt.mem;
    // The runtime records a draw call at every sprite-layer method target it knows, and
    // LAYER_METHOD_SLOTS (engine/native/runtime.ts:147) lists three of the PLAYBACK
    // handlers (0x80088620 = op 1, 0x80088730 = op 2, 0x80088770 = op 3). Left in place
    // they swallow the op; drop every table target so the disc's own bodies run.
    for (let op = 1; op <= 14; op++) {
        const target = (ramWord(0x80082e98 + (op - 1) * 4)) >>> 0;
        if (target) rt.cpu.clearStub(target);
    }
    writeProgram(mem, prog);
    mem.write32(OBJ + 0x58, ENTITY);
    const listAt = writeDoorList(mem, keys);
    // Op 4 takes its two coordinates from these two globals, not from the record, so
    // they are given values the port cannot possibly have guessed from params.
    mem.write32(CLIMB_X, 0x0c0c0c0c);
    mem.write32(CLIMB_Y, 0x0d0d0d0d);

    const calls = [];
    const SLOTS = [0x110, 0x114, 0x118, 0x11c, 0x120, 0x124, 0x158];
    for (const slot of SLOTS) {
        mem.write32(ENTITY + slot, STUB + slot);
        rt.cpu.setStub(STUB + slot, (c) => {
            const sp = c.reg(29) >>> 0;
            calls.push({
                slot,
                a1: c.reg(5) >>> 0, a2: c.reg(6) >>> 0, a3: c.reg(7) >>> 0,
                s16: mem.read32(sp + 0x10) >>> 0, s18: mem.read32(sp + 0x18) >>> 0,
                s1c: mem.read32(sp + 0x1c) >>> 0,
            });
            return 0;
        });
    }
    for (const fn of [HANDOFF_WRAPPER, HANDOFF_BODY]) {
        rt.cpu.clearStub(fn);
        rt.cpu.setStub(fn, (c) => {
            const sp = c.reg(29) >>> 0;
            calls.push({
                fn,
                a0: c.reg(4) >>> 0, a1: c.reg(5) >>> 0, a2: c.reg(6) >>> 0,
                a3: c.reg(7) >>> 0, s10: mem.read32(sp + 0x10) >>> 0,
                s14: mem.read32(sp + 0x14) >>> 0,
            });
            return 0;
        });
    }
    const port = createTriggerSystem({
        getProgram: () => prog,
        getGrid: () => grid,
        getEnableTable: () => CONE,
        getEventById: () => null,
        getEventByKey: () => null,
        flags: { get: (id) => flags.get(id) ?? 0, set() {} },
        done: () => false,
        markDone: () => {},
        playEvent: () => {},
        handoffPending: () => false,
    });
    return { rt, mem, calls, listAt, prog, grid, mapId, port };
}

/** The step index + facing group of the first cell naming `op` on `stage`. */
function cellForOp(stage, op) {
    const grid = GRIDS[stage];
    const prog = STEPS[stage];
    for (let i = 0; i < grid.grid.length; i++) {
        const b = grid.grid[i] & 0xff;
        if (!b) continue;
        const idx = b & 0x1f;
        if (idx < prog.steps.length && prog.steps[idx].op === op) {
            return { step: idx, group: b >> 5, cell: i % grid.w, row: Math.floor(i / grid.w) };
        }
    }
    return null;
}

// One shipped place per opcode the playback table gives a body to, plus the six whose
// table entry is the executor's own epilogue. s630's op-1 record carries params[5]=1,
// the only shipped door-list key, so op 1's list walk and its two route halfwords are
// exercised with a real record rather than a synthetic one.
const PLAYBACK_PLACES = [
    { op: 1, stage: "200", why: "the ordinary door" },
    { op: 1, stage: "630", why: "the door with a nonzero route key (params[5] = 1)" },
    { op: 2, stage: "205", why: "the bottom of a ladder" },
    { op: 3, stage: "205", why: "the top of a ladder" },
    { op: 4, stage: "345", why: "the climb, whose two coordinates are engine globals" },
    { op: 5, stage: "261", why: "nothing — the epilogue" },
    { op: 6, stage: "261", why: "nothing — the epilogue" },
    { op: 7, stage: "202", why: "the two-cell nudge" },
    { op: 8, stage: "305", why: "nothing — the epilogue (the cutscene is setup op 8)" },
    { op: 9, stage: "330", why: "the DIGIMON dive" },
    { op: 10, stage: "205", why: "the water dive" },
    { op: 11, stage: "735", why: "nothing — the epilogue" },
    { op: 12, stage: "735", why: "nothing — the epilogue" },
    { op: 13, stage: "735", why: "nothing — the epilogue (the pad is SETUP op 13)" },
    { op: 14, stage: "311", why: "the pad-style stage handoff" },
];

test("the playback executor's table is the image's own, and its epilogue ops do nothing", () => {
    for (const row of PLAYBACK_OPS) {
        assert.equal(row.handler, PLAYBACK_HANDLERS[row.op], `op ${row.op}'s handler offset`);
    }
    assert.equal(PLAYBACK_OPS.length, 14);
    // Ops 0 and 15+ never reach a table entry: the `sltiu $v0,$v1,0xe` at :5948 sends
    // them straight to the epilogue at :5bc8, the same address five ops hold.
    const EPILOGUE = PLAYBACK_HANDLERS[5];
    for (const op of [5, 6, 8, 11, 12, 13]) {
        assert.equal(PLAYBACK_HANDLERS[op], EPILOGUE, `op ${op} holds the epilogue`);
    }
    assert.deepEqual([...PLAYBACK_ACTIVE_OPS], [1, 2, 3, 4, 7, 9, 10, 14]);
});

test("every playback opcode matches the original executor, one shipped place each", () => {
    const seen = new Set();
    for (const { op, stage, why } of PLAYBACK_PLACES) {
        const at = cellForOp(stage, op);
        assert.ok(at, `s${stage} has a grid cell naming an op-${op} record (${why})`);
        // The list carries one matching key (1) and three that cannot match, so the
        // walk's match/no-match branch and its end test all run.
        const { rt, mem, calls, listAt, prog, mapId, port } = playbackRig(stage, [1, 7, 9, 11]);
        const record = PROG + at.step * 24;
        mem.write32(OBJ + 0x60, at.group);
        mem.write32(OBJ + 0x64, record);
        // Poison the two route halfwords so "wrote nothing" is visible.
        mem.write16(ROUTE_D78, 0xbeef);
        mem.write16(ROUTE_D7A, 0xbeef);

        calls.length = 0;
        rt.cpu.call(PLAYBACK_EXEC, [OBJ], 20000);

        const x = at.cell * GRIDS[stage].cell + 4;
        const y = at.row * GRIDS[stage].cell + 4;
        const pb = port.playback(mapId, x, y, at.group, true);
        assert.ok(pb, `${why}: the port answered`);
        assert.equal(pb.op, op, `${why}: the port ran this op`);
        const eff = pb.effect;
        const where = `s${stage} op ${op} step ${at.step} group ${at.group} (${why})`;

        const slotCalls = calls.filter((c) => c.slot !== undefined);
        const handoffs = calls.filter((c) => c.fn !== undefined);

        // ── the player-actor vtable call ──
        // Op 14 calls a slot too, but the disc's call is the one setup op 13 makes, so
        // the port names it separately (`padSlot`) — it is still a player-actor call and
        // the original's stub sees it exactly like the others.
        const expectedSlot = eff.actorCall
            ?? (eff.padSlot !== undefined
                ? { slot: eff.padSlot, args: [prog.steps[at.step].params[0] ?? 0] }
                : null);
        if (!expectedSlot) {
            assert.deepEqual(slotCalls, [], `${where}: the original called no actor slot`);
        } else {
            assert.equal(slotCalls.length, 1, `${where}: exactly one actor slot`);
            const got = slotCalls[0];
            assert.equal(got.slot, expectedSlot.slot, `${where}: which slot`);
            const [a1, a2, a3] = [got.a1, got.a2, got.a3];
            const want = expectedSlot.args;
            const norm = (v) => (v === 0 ? 0 : v);
            // The port declares only the arguments the disc actually builds; a register
            // the handler never loads is 0 in the original and absent from `want`.
            const W = (i) => norm(want[i] ?? 0);
            if (op === 9 || op === 10 || op === 14) {
                // The disc passes &record[0xa] in a1; the port carries the VALUE, so
                // compare the u16 the pointer addresses.
                assert.equal(mem.read16(got.a1) & 0xffff, W(0), `${where}: a1 -> param 0`);
            } else {
                assert.equal(norm(a1), W(0), `${where}: a1`);
            }
            if (op === 4) {
                // The two globals, which the port marks as not-from-the-record.
                assert.equal(want[1], null);
                assert.equal(want[2], null);
                assert.equal(got.a2 >>> 0, 0x0c0c0c0c, `${where}: a2 = [0x80082E8C]`);
                assert.equal(got.a3 >>> 0, 0x0d0d0d0d, `${where}: a3 = [0x80082E90]`);
            } else {
                assert.equal(norm(a2), W(1), `${where}: a2`);
                assert.equal(norm(a3), W(2), `${where}: a3`);
            }
            if (op === 7) {
                // sp+0x18 and sp+0x1c, NOT sp+0x10 — and the port says so.
                assert.deepEqual(want.slice(3), [null, null, norm(want[1]), norm(want[2])]);
                // args = [a1, a2, a3, sp+0x10, sp+0x14, sp+0x18, sp+0x1c]
                assert.equal(got.s18 >>> 0, W(5), `${where}: sp+0x18`);
                assert.equal(got.s1c >>> 0, W(6), `${where}: sp+0x1c`);
            } else {
                assert.equal(got.s16 >>> 0, W(3), `${where}: sp+0x10`);
            }
        }

        // ── the stage handoff ──
        if (!eff.handoff) {
            assert.deepEqual(handoffs, [], `${where}: no handoff ran`);
        } else {
            assert.equal(handoffs.length, 1, `${where}: one handoff`);
            const got = handoffs[0];
            const h = eff.handoff;
            assert.equal(got.fn, h.fn, `${where}: which handoff entry point`);
            // Full 32-bit words: `li $a1,-1` sign-extends to 0xffffffff and the two
            // `<<8` shifts are not truncated to a halfword.
            const gotArgs = [got.a0, got.a1, got.a2, got.a3, got.s10, got.s14];
            const names = ["id", "arg 1 (li -1)", "x << 8", "y << 8", "facing", "arg 5"];
            for (let i = 0; i < 5; i++) {
                assert.equal(gotArgs[i] >>> 0, (h.args[i] ?? 0) >>> 0,
                    `${where}: handoff ${names[i]}`);
            }
            assert.equal(gotArgs[5] >>> 0, got.fn === HANDOFF_BODY ? 0x3c : 0,
                `${where}: the sixth argument (0x3c on op 14 only; op 1 writes nothing there)`);
        }

        // ── op 1's door list and the two route halfwords ──
        // The two halfwords are written UNCONDITIONALLY at the case's convergence
        // point (fieldstg.s:5a18/:5a2c, the `sh` in the final jump's delay slot), so
        // they land even when the record's route key is zero. Only the list walk is
        // conditional (:59c0 `beqz` on param 5).
        if (eff.routeWords) {
            const p5 = eff.routeWords.d78, p6 = eff.routeWords.d7a;
            assert.equal(mem.read16(ROUTE_D78) & 0xffff, p5 & 0xffff, `${where}: [0x80048D78]`);
            assert.equal(mem.read16(ROUTE_D7A) & 0xffff, p6 & 0xffff, `${where}: [0x80048D7A]`);
            assert.equal(eff.listKey, p5, `${where}: the same field drives the list key`);
            if (p5) {
                const entry = listAt[1];   // the list's key-1 entry
                assert.equal(mem.read8(entry) >>> 0, 0, `${where}: the matching entry's flag was cleared`);
                for (const other of [listAt[0], listAt[2], listAt[3]]) {
                    assert.notEqual(mem.read8(other) >>> 0, 0, `${where}: a non-matching entry is untouched`);
                }
            } else {
                for (const at of listAt) {
                    assert.notEqual(mem.read8(at) >>> 0, 0, `${where}: a zero key skips the walk`);
                }
            }
        } else {
            assert.equal(mem.read16(ROUTE_D78), 0xbeef, `${where}: no route halfword written`);
            assert.equal(mem.read16(ROUTE_D7A), 0xbeef, `${where}: no route halfword written`);
        }
        seen.add(op);
    }
    assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
        "every opcode in the table was compared against the original");
});

test("the playback executor's gates: a handoff in flight, an empty tile and no press", () => {
    const at = cellForOp("200", 1);
    const { rt, mem, prog, grid, mapId, port } = playbackRig("200", [1, 2, 3, 4]);
    const x = at.cell * grid.cell + 4, y = at.row * grid.cell + 4;

    // Circle NOT held: the tile is live and named, but nothing runs (fieldstg.s:5d08).
    const idle = port.playback(mapId, x, y, at.group, false);
    assert.equal(idle.live, true, "step-load still reports the tile live");
    assert.equal(idle.op, null, "but no op runs without the button held");
    assert.equal(idle.bubbleUsed, false);

    // A tile whose byte is 0: not live, and the disc puts the indicator away.
    let empty = null;
    for (let i = 0; i < grid.grid.length; i++) {
        if ((grid.grid[i] & 0xff) === 0) {
            empty = { x: (i % grid.w) * grid.cell + 4, y: Math.floor(i / grid.w) * grid.cell + 4 };
            break;
        }
    }
    assert.ok(empty, "s200 has an empty cell");
    const off = port.playback(mapId, empty.x, empty.y, 0, true);
    assert.equal(off.live, false);
    assert.equal(off.bubbleHidden, true, "fieldstg.s:5cc8 setState(2)");

    // The original agrees the tile is live on its own: one step-load call.
    const record = PROG + at.step * 24;
    mem.write32(OBJ + 0x60, at.group);
    mem.write32(OBJ + 0x64, record);
    assert.equal(rt.cpu.call(STEP_LOAD, [OBJ], 20000), 1, "step-load reports the tile live");

    // A handoff in flight stops everything before step-load is even consulted
    // (fieldstg.s:5c54/:5c64 read the two scene_struct guard words first).
    const held = createTriggerSystem({
        getProgram: () => prog,
        getGrid: () => grid,
        getEnableTable: () => CONE,
        getEventById: () => null,
        getEventByKey: () => null,
        flags: { get: () => 0, set() {} },
        done: () => false,
        markDone: () => {},
        playEvent: () => {},
        handoffPending: () => true,
    });
    assert.equal(held.playback(mapId, x, y, at.group, true), null,
        "no playback while the field is owned by a handoff");
});

test("the Fishing Pole gate: every op-7 record asks for item 5, and the disc refuses without it", () => {
    // The DATA half: op 7 is the fishing cast (mode 0x48, engine/systems/
    // step-actor-actions.ts), and every record that names it in the whole shipped
    // corpus carries cond_a = 0x8005 / arg_a = 1 — item 5, the rod, in the bag.
    let op7 = 0;
    const offenders = [];
    for (const [stage, prog] of Object.entries(STEPS)) {
        for (const st of prog.steps) {
            if (st.op !== 7) continue;
            op7++;
            if (st.cond_a !== 0x8005 || st.arg_a !== 1) offenders.push(`s${stage}`);
        }
    }
    assert.ok(op7 >= 200, `the corpus has op-7 records, found ${op7}`);
    assert.deepEqual(offenders, [], "every op-7 record gates on the rod");

    // The CODE half, run out of the shipped image. s202 carries a real op-7 spot.
    const at = cellForOp("202", 7);
    assert.ok(at, "s202 has a grid cell naming an op-7 record");
    const x = at.cell * GRIDS["202"].cell + 4;
    const y = at.row * GRIDS["202"].cell + 4;
    const r = rig("202");

    // step-load is the grid + cone read; it does NOT know about the rod, so it reports
    // the tile live either way (fieldstg.s:5648-56a4).
    r.mem.write32(ENTITY + 0x58, x);
    r.mem.write32(ENTITY + 0x5c, y);
    r.mem.write32(ENTITY + 0x60, at.group & 7);
    assert.equal(r.rt.cpu.call(STEP_LOAD, [OBJ], 20000), 1, "the tile is live without the rod");

    // step-exec is where the rod is read: cond A at :56dc/:5700 and cond B at
    // :5710/:5734, and its failure branch is a plain return — it never reaches the
    // level-1 increment at :5d40, which is the driver's ONLY way out of sub-state 0
    // and so the only way to the playback arm at :5cbc/:5d38.
    r.act.length = 0;
    assert.equal(r.rt.cpu.call(STEP_EXEC, [OBJ, EXTRA], 20000), 0,
        "no rod: the original's step-exec refuses the tile");
    assert.deepEqual(r.act, [], "and runs no op");

    r.flags.set(0x8005, 1);            // the rod, in the bag
    r.act.length = 0;
    assert.equal(r.rt.cpu.call(STEP_EXEC, [OBJ, EXTRA], 20000), 1,
        "with the rod: the original's step-exec runs the tile");
    assert.deepEqual(r.act, [["indicator", 1]],
        "and op 7 retags the indicator actor");
    // :58e0 `sw $s0, 0x8($v0)` — bubble+0x8 is the KIND, and op 7's constant is 5
    // (:5894 `li $s0,0x5`), the fishing row.
    assert.equal(r.mem.read32(ACTOR + 8) >>> 0, 5, "op 7 tags it with kind 5");

    // The PORT, at the same cell and the same facing: the press does nothing without
    // the rod and casts with it. This is the gate the walker lost when it started
    // asking playback() whether a fishing spot exists.
    const bare = playbackRig("202", [1], new Map());
    const pb = bare.port.playback("s202", x, y, at.group & 7, true);
    assert.equal(pb.live, false, "no rod: the tile is not armed");
    assert.equal(pb.op, null, "no rod: no op runs");
    assert.equal(pb.effect, null, "no rod: nothing is handed the actor");
    assert.equal(pb.bubbleHidden, true, "no rod: the indicator is put away");
    const held = playbackRig("202", [1], new Map([[0x8005, 1]]));
    const pb2 = held.port.playback("s202", x, y, at.group & 7, true);
    assert.equal(pb2.op, 7, "with the rod: op 7 plays back");
    assert.equal(pb2.effect?.actorAction?.kind, "castPose", "and it is the fishing cast");
    assert.equal(pb2.bubbleUsed, true, "and the indicator is switched to its used state");
});

test("a stage with no step program has no pressable tiles at all", () => {
    const { grid, port } = playbackRig("200", [1]);
    // Same system, one dep different: no program means no step tiles, so the disc's
    // driver was never created for that stage and there is nothing to press. This is
    // what the walker relies on for a stage whose doors come from the ordinary warp
    // tables rather than from a position step. The stage named here is ARBITRARY on
    // purpose: it stands for the dep, not for a place. (s210 and s220 used to be named
    // as examples and stopped qualifying on 2026-10-03 — the extractor now reads their
    // real programs, so their doors arm like every other step tile. tests/
    // exit-step-coverage.test.js measures which stages actually rely on this.)
    const bare = createTriggerSystem({
        getProgram: () => null,
        getGrid: () => grid,
        getEnableTable: () => CONE,
        getEventById: () => null,
        getEventByKey: () => null,
        flags: { get: () => 0, set() {} },
        done: () => false,
        markDone: () => {},
        playEvent: () => {},
    });
    assert.equal(bare.playback("s000", 32, 32, 0, true), null);
    assert.equal(bare.playback("s000", 32, 32, 0, false), null);
    // ... and the same stage WITH a program does answer.
    assert.ok(port.playback("s200", 32, 32, 0, true) !== null);
});

test("a program with ZERO records answers null, and that is a known gap", () => {
    // s780 is the one stage still shipping `steps: []`, because wstag780's
    // `scene+0x14` store is a function's return value rather than a constant
    // (0x10a0-0x10ac) and so names no readable program. It also ships no type-7 grid,
    // so no tile of its own could ask. Treating an empty program as "no step tiles"
    // keeps its door rows standing on their own instead of leaving them dark, and
    // changes nothing on the 290 stages that carry records.
    const empty = createTriggerSystem({
        getProgram: () => ({ steps: [], events: [] }),
        getGrid: () => GRIDS["780"],
        getEnableTable: () => CONE,
        getEventById: () => null,
        getEventByKey: () => null,
        flags: { get: () => 0, set() {} },
        done: () => false,
        markDone: () => {},
        playEvent: () => {},
    });
    assert.equal(empty.playback("s780", 32, 32, 0, true), null);
    assert.equal(empty.playback("s780", 32, 32, 4, true), null);
    assert.equal((STEPS["780"]?.steps ?? []).length, 0, "s780 still ships an empty program");
    assert.equal(GRIDS["780"], undefined, "and it ships no step grid either");
});

// ── the PLAYER ACTOR's own action slots run natively beside the port ──
//
// The three slots the position step hands the CHARACTER (rather than the scene) are
// installed by the actor's own constructor at fieldstg.s:0xe510-0xe57c and their bodies
// live inside FIELDSTG.PRO, so they run here straight out of the shipped image:
//
//   +0x11c  0x8008F280  file 0xc5d0  op 4  — mode 0x47, the scripted slope step
//   +0x120  0x8008F304  file 0xc654  op 7  — mode 0x48, the cast pose + the float
//   +0x158  0x8008F44c  file 0xc79c  op 13 / op 14 — mode 1 + the pad walk handler
//
// Only what they reach OUTWARD for is stubbed: the band setters at +0x2c/+0x30/+0x40
// (which F0x800143dc installs from the EXE, not from this image), the child array at
// +0x24, find_entity through D0x8004b610, and the three helpers the slots call
// (F0x80090e70, F0x8008D744, F0x8008c610). Every write the disc makes to the actor and
// to the two scene locks is compared against engine/systems/step-actor-actions.ts
// `actorActionPlan`, for one shipped place per slot.
const SLOT_BODIES = { 0x11c: 0x8008f280, 0x120: 0x8008f304, 0x158: 0x8008f44c };
const CLIMB_LOCK = 0x80099de0;
const HANDOFF_LOCK = 0x80099dd8;
const SLOPE_SETANIM = 0x80090e70;   // file 0xe1c0
const FLOAT_CTOR = 0x8008d744;      // file 0xaa94 — runs FOR REAL; only its allocator
const ALLOC = 0x80014504;           // (F0x80014504) is stubbed, so the float lands in FLOAT_OBJ
const FLOAT_OBJ = 0x80162000;
const PAD_CTOR = 0x8008c610;        // file 0x9960
const PARTY_SLOT_TABLE = 0x80097ca8; // lui 0x8009 / addiu 0x7ca8 — three party indices
const CHILDREN = 0x80157000;
const FIND_ENTITY = 0x8001810c;  // D0x8004b610's object search (runtime.ts:53)
const PARTY_ENTITY = 0x80159000;

/**
 * A rig whose player actor's action slots hold the disc's own bodies. `group` and the
 * record's params come from a real shipped place, so nothing here is synthetic except
 * the actor's own fields, which are poisoned first so "wrote nothing" is visible.
 */
function actorRig() {
    const rt = new NativeStageRuntime(
        new Uint8Array(8),
        { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
        { setFlag() {}, getFlag: () => 0, rand16: () => 1 }, undefined, FIELDSTG,
    );
    const mem = rt.mem;
    const seen = { setMode: [], advance: [], sub: [], setAnim: [], float: [], pad: [] };
    // The band setters and the advance stub come from the EXE (fns.s:4866), so they are
    // not in this image: record what each slot hands them instead of running them.
    mem.write32(ENTITY + 0x24, CHILDREN);
    mem.write32(ENTITY + 0x2c, STUB + 0x2c);
    mem.write32(ENTITY + 0x30, STUB + 0x30);
    mem.write32(ENTITY + 0x40, STUB + 0x40);
    rt.cpu.setStub(STUB + 0x2c, (c) => { seen.setMode.push(c.reg(5) | 0); return 0; });
    rt.cpu.setStub(STUB + 0x30, (c) => { seen.sub.push(c.reg(5) | 0); return 0; });
    rt.cpu.setStub(STUB + 0x40, () => 0);
    for (const [slot, body] of Object.entries(SLOT_BODIES)) {
        mem.write32(ENTITY + Number(slot), body);
        rt.cpu.clearStub(body);
    }
    rt.cpu.setStub(SLOPE_SETANIM, () => { seen.setAnim.push(1); return 0; });
    // The float's own constructor runs; only the allocator is intercepted, so the two
    // words it writes at +0x50/+0x54 are the disc's own arithmetic, read back from RAM.
    rt.cpu.clearStub(FLOAT_CTOR);
    rt.cpu.setStub(ALLOC, () => FLOAT_OBJ);
    rt.cpu.setStub(PAD_CTOR, (c) => { seen.pad.push([c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0x80161000; });
    // find_entity(5, i, slot) is reached through D0x8004b610's method table at +0x1ac,
    // and the runtime already points that cell at its own object-search stub (which
    // returns 0 because there is no entity world yet). Override it so the loop really
    // hands an entity back and the +0x60 write is visible.
    rt.cpu.setStub(FIND_ENTITY, () => PARTY_ENTITY);
    // Poison every observable the three slots write.
    for (const off of [0x60, 0x74, 0x8c, 0x90, 0x94, 0x108]) mem.write32(ENTITY + off, 0x5a5a5a5a);
    mem.write32(CLIMB_LOCK, 0);
    mem.write32(HANDOFF_LOCK, 0);
    mem.write32(ENTITY + 0x58, 300);   // the player's cell x
    mem.write32(ENTITY + 0x5c, 120);   // ... and y
    return { rt, mem, seen };
}

/** Every op-4/op-7/op-13 record's plan, checked against the disc for one place each. */
const ACTOR_PLACES = [
    { op: 4, stage: "345", why: "the slope step" },
    { op: 7, stage: "202", why: "the cast pose" },
    { op: 13, stage: "735", why: "the pad walk (setup op 13)" },
    { op: 14, stage: "311", why: "the pad walk, then the stage handoff" },
];

test("the player actor's three action slots match the port, one shipped place each", () => {
    const seenSlots = new Set();
    for (const { op, stage, why } of ACTOR_PLACES) {
        const at = cellForOp(stage, op);
        assert.ok(at, `s${stage} has a grid cell naming an op-${op} record (${why})`);
        const params = STEPS[stage].steps[at.step].params;
        const { rt, mem, seen } = actorRig();
        // `cpu.call` only fills a0..a3, so the FIFTH argument — the one op 4 reads at
        // its `lw $v0,0x30($sp)` (file 0xc61c, i.e. the caller's sp+0x10) — is written
        // into the call frame by hand. It is the record's own `param0 << 4`, exactly
        // what the executor builds at fieldstg.s:0x5b30-:5b34.
        mem.write32(rt.cpu.sp + 0x10, ((params[0] & 0xffff) << 4) >>> 0);
        // a2/a3 carry the record's own params — for op 7 that IS what the disc reads
        // (fieldstg.s:0xc6e4-:0xc708), and for op 4 it is what the executor's two engine
        // globals would supply, which the slot then ignores. One call shape, both cases.
        rt.cpu.call(SLOT_BODIES[actorActionPlan(op, at.group, params).slot], [
            ENTITY, at.group, params[0] & 0xffff, params[1] & 0xffff,
        ], 20000);
        const plan = actorActionPlan(op, at.group, params);
        const where = `s${stage} op ${op} step ${at.step} group ${at.group} (${why})`;
        assert.ok(SLOT_BODIES[plan.slot], `${where}: the plan names a slot this test runs`);

        // ── the mode word ──
        assert.deepEqual(seen.setMode, [plan.mode],
            `${where}: obj->+0x2c received exactly the plan's mode`);

        // ── the actor words, each poisoned first ──
        if (plan.kind === "slope") {
            assert.equal(mem.read32(ENTITY + 0x108) >>> 0, 0, `${where}: +0x108 = 0`);
            assert.equal(mem.read32(ENTITY + 0x60) >>> 0, at.group, `${where}: +0x60 = the group`);
            assert.equal(mem.read32(ENTITY + 0x8c) >>> 0, at.group === 7 ? 1 : 0,
                `${where}: +0x8c = (group == 7)`);
            assert.equal(mem.read32(ENTITY + 0x74) >>> 0, 0, `${where}: +0x74 = 0`);
            const drop = (((params[0] & 0xffff) << 4) << 8) >>> 0;
            assert.equal(mem.read32(ENTITY + 0x94) >>> 0, drop, `${where}: +0x94 = param0 << 12`);
            assert.equal(mem.read32(ENTITY + 0x90) >>> 0, drop, `${where}: +0x90 = param0 << 12`);
            assert.equal(plan.dropUnits, drop, `${where}: the plan's dropUnits`);
            assert.equal(plan.stepCells, at.group === 7 ? SLOPE_STEP_CELLS : -SLOPE_STEP_CELLS,
                `${where}: the plan's sideways step`);
            assert.deepEqual(seen.setAnim.length, 1, `${where}: F0x80090e70 was called once`);
            assert.equal(mem.read32(CLIMB_LOCK) >>> 0, 1, `${where}: [0x80099DE0] = 1`);
        } else if (plan.kind === "castPose") {
            assert.equal(mem.read32(ENTITY + 0x108) >>> 0, 0, `${where}: +0x108 = 0`);
            assert.equal(mem.read32(ENTITY + 0x60) >>> 0, at.group,
                `${where}: +0x60 = the group on the leader`);
            assert.equal(mem.read32(PARTY_ENTITY + 0x60) >>> 0, at.group,
                `${where}: ... and on the party member find_entity(5,0,*) returned`);
            assert.equal(mem.read32(HANDOFF_LOCK) >>> 0, 1, `${where}: [0x80099DD8] = 1`);
            // fieldstg.s:0xc6e4-:0xc708 computes the float's cell as (player cell) +
            // the record's params; F0x8008d744 stores them at +0x50/+0x54 (file 0xaac0).
            assert.equal(mem.read32(FLOAT_OBJ + 0x50) >>> 0,
                mem.read32(ENTITY + 0x58) + (params[0] & 0xffff),
                `${where}: the float's x = the player's cell + param0`);
            assert.equal(mem.read32(FLOAT_OBJ + 0x54) >>> 0,
                mem.read32(ENTITY + 0x5c) + (params[1] & 0xffff),
                `${where}: the float's y = the player's cell + param1`);
            // ... and the actor's own child manager takes it (:0xc710 `sw $v0,0x8($s0)`
            // with s0 = actor+0x24), which is how the disc runs it.
            assert.equal(mem.read32(CHILDREN + 8) >>> 0, FLOAT_OBJ >>> 0,
                `${where}: the float is handed to the actor's child manager`);
            assert.equal(plan.floatDx, params[0] & 0xffff, `${where}: the plan's floatDx`);
            assert.equal(plan.floatDy, params[1] & 0xffff, `${where}: the plan's floatDy`);
        } else {
            assert.equal(mem.read32(ENTITY + 0x108) >>> 0, PAD_WALK_HANDLER,
                `${where}: +0x108 = the pad walk handler`);
            assert.equal(mem.read32(ENTITY + 0x60) >>> 0, 0, `${where}: +0x60 = 0`);
            assert.equal(mem.read32(HANDOFF_LOCK) >>> 0, 1, `${where}: [0x80099DD8] = 1`);
            assert.equal(seen.pad.length, 1, `${where}: F0x8008c610 was called once`);
            assert.equal(seen.pad[0][0] >>> 0, ENTITY >>> 0,
                `${where}: the pad controller's owner is the actor`);
        }
        // Every slot leaves the child's manager slot holding whatever the spawned
        // object pointer is (fieldstg.s:0xc710 / the pad body), and none of them touch
        // the other lock.
        if (plan.kind === "slope") {
            assert.equal(mem.read32(HANDOFF_LOCK) >>> 0, 0, `${where}: the handoff lock stays clear`);
        } else {
            assert.equal(mem.read32(CLIMB_LOCK) >>> 0, 0, `${where}: the climb lock stays clear`);
        }
        seenSlots.add(plan.slot);
    }
    assert.deepEqual([...seenSlots].sort((a, b) => a - b), [0x11c, 0x120, 0x158],
        "every action slot the position step uses was compared against the disc");
});

test("op 4's two engine globals are dead words: nothing writes them and the slot ignores them", () => {
    // The disc's op-4 handler takes its two coordinates from [0x80082E8C] / [0x80082E90]
    // (fieldstg.s:0x5b18/:0x5b24) and hands them to +0x11c in a2/a3. The slot stores both
    // into the CALLER's frame above its own 0x20-byte locals (:0xc5e8 / :0xc5ec) and reads
    // neither — so its behaviour is a function of a1 and the fifth word alone. Prove it
    // by running the slot with the two globals poisoned differently and getting the same
    // actor.
    const run = (gx, gy) => {
        const { rt, mem } = actorRig();
        mem.write32(CLIMB_X, gx);
        mem.write32(CLIMB_Y, gy);
        mem.write32(rt.cpu.sp + 0x10, 6 << 4);
        rt.cpu.call(0x8008f280, [ENTITY, 3, gx, gy], 20000);
        return [0x60, 0x74, 0x8c, 0x90, 0x94, 0x108].map((o) => mem.read32(ENTITY + o) >>> 0);
    };
    assert.deepEqual(run(0, 0), run(0x0c0c0c0c, 0x0d0d0d0d),
        "the slot's writes do not depend on the two globals");
    // ... and the two words themselves are untouched by the whole program: nothing in
    // the shipped FIELDSTG.PRO text stores to them (they sit at file 0x1dc / 0x1e0, the
    // three zero words between table B and the playback table), and they ship zero.
    assert.equal(FIELDSTG[0x1dc], 0);
    assert.equal(FIELDSTG[0x1e0], 0);
});

test("the mode dispatcher's table is the image's own, and mode 0x47/0x48 reach their blocks", () => {
    for (const [mode, file] of Object.entries(MODE_BLOCK_FILE)) {
        assert.equal((ramWord(0x80083590 + Number(mode) * 4) - 0x80082cb0) | 0, file,
            `mode ${mode} dispatches to file 0x${file.toString(16)}`);
    }
    assert.equal(MODE_BLOCK_FILE[ACTOR_MODE.slope], 0xdb28, "mode 0x47 is the op-4 block");
    assert.equal(MODE_BLOCK_FILE[ACTOR_MODE.castPose], 0xdc7c, "mode 0x48 is the op-7 block");
    // `sltiu $v0,$v1,0x51 ; beqz -> .L0x0000d9ec` (fieldstg.s:0xd24c/:0xd250): every mode
    // word at or above 0x51 skips the table entirely and lands on the shared default,
    // which is the same address the table's unnamed entries hold.
    assert.equal((ramWord(0x80083590) - 0x80082cb0) | 0, MODE_DEFAULT_FILE,
        "an unnamed mode's table entry is the shared default");
    for (const mode of [6, 7, 8, 0x20, 0x3f]) {
        assert.equal((ramWord(0x80083590 + mode * 4) - 0x80082cb0) | 0, MODE_DEFAULT_FILE,
            `mode 0x${mode.toString(16)} is unnamed and shares the default`);
    }
    // The op-7 block's own six-entry sub-table, RAM 0x800836D8 = file 0xa28.
    const want = [0xdcac, 0xdcc8, 0xdd08, 0xdd48, 0xdd84, 0xdde8];
    for (let i = 0; i < 6; i++) {
        assert.equal((ramWord(0x800836d8 + i * 4) - 0x80082cb0) | 0, want[i],
            `the cast pose's sub-block ${i}`);
    }
});

// ── op 14: the pad-style stage handoff, over EVERY shipped record ──
//
// Eleven records in four stages carry op 14, and each one is a real stage change:
// the player's actor walks a launch pad (vt+0x158, the method setup op 13 also
// calls) and the SAME handler then calls 0x8008B6D4 with the record's own five
// fields plus a sixth. That sixth argument is the whole difference from a door.
// 0x8008B770 — op 1's entry point — is the same body with a zero in that slot
// (fieldstg.s:8ac0-8ad4: `sw $v0,0x30($sp)` / `sw $zr,0x14($sp)` / `jal 0x8008b6d4`),
// and 0x8008B6D4 stores the word into the type-7 scene object's `+0x68` (:8a84).
// Its phase-2 handler spends that word before loading the destination
// (:8984 `lw $v0,0x68($s4)` / `bgtz` -> :8994 the load; :898c `+0x68 -= tick`),
// so op 14 waits 0x3c ticks and an ordinary door waits none.
//
// Every record is run through the ORIGINAL handler out of the shipped image here,
// and its destination is checked against the same screen table the walker's own
// router reads (engine/dw3/screen-routing.ts over web/assets/data/screen_table.json).

const SCREEN_TABLE = read("web/assets/data/screen_table.json");

/** Every shipped step record with op 14, as {stage, index, record}. */
function op14Records() {
    const out = [];
    for (const [sid, s] of Object.entries(STEPS)) {
        for (let i = 0; i < (s.steps || []).length; i++) {
            if (s.steps[i].op === 14) out.push({ stage: sid, index: i, record: s.steps[i] });
        }
    }
    return out;
}

/** The first grid cell naming step index `idx` on `stage`, and its facing group. */
function cellForStep(stage, idx) {
    const grid = GRIDS[stage];
    if (!grid || !grid.grid) return null;
    for (let i = 0; i < grid.grid.length; i++) {
        const b = grid.grid[i] & 0xff;
        if (!b || (b & 0x1f) !== idx) continue;
        return { step: idx, group: b >> 5, cell: i % grid.w, row: Math.floor(i / grid.w) };
    }
    return null;
}

test("all eleven op-14 records match the original handler, and each names a real place", () => {
    const rows = op14Records();
    // Eleven records across four stages. Named here rather than discovered, so a
    // future extraction that grows or loses one fails loudly instead of silently
    // re-baselining the census.
    assert.deepEqual(
        rows.map((r) => `${r.stage}:${r.index}`).sort(),
        ["311:1", "750:1", "810:18", "810:19", "810:22", "810:23", "810:26",
            "815:1", "815:2", "815:3", "815:4"],
    );

    for (const { stage, index, record } of rows) {
        const at = cellForStep(stage, index);
        assert.ok(at, `s${stage} step ${index} is named by a grid cell`);
        const { rt, mem, calls, mapId, port } = playbackRig(stage);
        mem.write32(OBJ + 0x60, at.group);
        mem.write32(OBJ + 0x64, PROG + index * 24);

        calls.length = 0;
        // Through the disc's own executor (fieldstg.s:0x5924), which reads op 14 out of
        // the record at runner+0x64 and dispatches it to the table entry at file 0x5a30.
        rt.cpu.call(PLAYBACK_EXEC, [OBJ], 20000);

        const x = at.cell * GRIDS[stage].cell + 4;
        const y = at.row * GRIDS[stage].cell + 4;
        const pb = port.playback(mapId, x, y, at.group, true);
        const where = `s${stage} step ${index} group ${at.group} (screen ${record.params[0]})`;
        assert.equal(pb.op, 14, `${where}: the port ran op 14`);
        const eff = pb.effect;

        // ── the pad walk: actor->vt[0x158](actor, &record[0xa]) ──
        assert.equal(eff.padSlot, 0x158, `${where}: the pad-walk slot`);
        const slots = calls.filter((c) => c.slot !== undefined);
        assert.equal(slots.length, 1, `${where}: exactly one actor-slot call`);
        assert.equal(slots[0].slot, 0x158, `${where}: which slot the disc called`);
        assert.equal(
            mem.read16(slots[0].a1) & 0xffff, record.params[0] & 0xffff,
            `${where}: a1 points at record+0xa, whose first halfword is param 0`,
        );

        // ── the handoff: all SIX words, at full width ──
        const hs = calls.filter((c) => c.fn !== undefined);
        assert.equal(hs.length, 1, `${where}: one handoff`);
        assert.equal(hs[0].fn, HANDOFF_BODY,
            `${where}: op 14 calls 0x8008B6D4 directly, NOT op 1's 0x8008B770 wrapper`);
        const got = [hs[0].a0, hs[0].a1, hs[0].a2, hs[0].a3, hs[0].s10, hs[0].s14];
        const names = ["screen id", "the fixed -1", "x << 8", "y << 8", "facing", "the sixth word"];
        for (let i = 0; i < 6; i++) {
            assert.equal(got[i] >>> 0, (eff.handoff.args[i] ?? 0) >>> 0, `${where}: ${names[i]}`);
        }
        assert.equal(eff.handoff.holdTicks, 0x3c, `${where}: the hold is 60 ticks`);
        assert.equal(handoffHold(14), 0x3c, "op 14's hold, read through the port");
        assert.equal(handoffHold(1), 0, "op 1's wrapper passes a zero sixth word");

        // ── the destination, decoded from those same words ──
        const [screenId, , xw, yw, facing] = eff.handoff.args;
        const entry = SCREEN_TABLE[String(screenId)];
        assert.ok(entry && entry.stage != null,
            `${where}: screen ${screenId} is in the screen table with a stage`);
        const to = `s${entry.stage}`;
        const spawnX = xw >>> 8, spawnY = yw >>> 8;
        assert.equal(spawnX, record.params[1], `${where}: the spawn x is the cell the record names`);
        assert.equal(spawnY, record.params[2], `${where}: the spawn y likewise`);
        // char+0x60 IS the 0-7 facing index: 0x8008B6D4 writes the record's word to
        // [0x80099DEC] (:8aa0) and the arriving actor's spawn copies it straight into
        // char+0x60 (fieldstg.s:0xe758/:0xe760) — no translation in between. The same
        // two words are read back with `sra 8` (:0xe76c/:0xe770), which is the
        // `>>> 8` above.
        const dir = fieldDirectionFromIndex(facing);
        assert.equal(fieldDirectionIndex(dir), facing & 7, `${where}: the facing round-trips`);
        assert.deepEqual(
            { to, spawnX, spawnY, dir },
            {
                to,
                spawnX: record.params[1],
                spawnY: record.params[2],
                dir: fieldDirectionFromIndex(record.params[3] & 7),
            },
            `${where}: destination stage, position and facing come from the record`,
        );
        // The destination is a real, playable stage: its own grid must contain the
        // cell the handoff asks for.
        const dst = GRIDS[String(entry.stage)];
        assert.ok(dst && dst.grid, `${to} ships a type-7 grid`);
        assert.ok(spawnX >= 0 && spawnY >= 0
            && Math.floor(spawnX / dst.cell) < dst.w
            && Math.floor(spawnY / dst.cell) < dst.h,
            `${where}: (${spawnX},${spawnY}) is inside ${to}'s ${dst.w}x${dst.h} grid`);
    }
});

test("op 14's tile arms only when its own flag condition holds — and never asks a cone", () => {
    // s311's single op-14 record is the only one of the eleven that is gated at all
    // (cond_a = 0x6028, arg_a = 1). The disc reads it in the SETUP arm and its failure
    // branch returns past the level-1 increment the playback arm is reached through
    // (fieldstg.s:5700 -> :5d40), so the tile is dark for BOTH the bubble and the press.
    const rec = STEPS["311"].steps[1];
    assert.equal(rec.op, 14);
    assert.deepEqual([rec.cond_a, rec.arg_a, rec.cond_b], [0x6028, 1, 0xffff]);

    const at = cellForStep("311", 1);
    const { mem, mapId, port } = playbackRig("311", [0], new Map([[rec.cond_a, 0]]));
    mem.write32(OBJ + 0x60, at.group);
    mem.write32(OBJ + 0x64, PROG + 24);
    const x = at.cell * GRIDS["311"].cell + 4;
    const y = at.row * GRIDS["311"].cell + 4;

    const shut = port.playback(mapId, x, y, at.group, true);
    assert.equal(shut.live, false, "with the flag at 0 the tile is not live at all");
    assert.equal(shut.op, null, "so no op runs on a held press");
    assert.equal(shut.bubbleHidden, true, "and the disc puts the bubble away");

    // With the flag satisfied the same tile runs op 14 — from EVERY facing. Op 14 is
    // outside the enable table's opcode classes (fieldstg.s:5660/:567c return 1
    // without reading it for ops 5, 6 and 8..14), so unlike an op-1 door tile this one
    // asks no cone: you can stand on it facing any way and press.
    const open = playbackRig("311", [0], new Map([[rec.cond_a, 1]]));
    open.mem.write32(OBJ + 0x60, at.group);
    open.mem.write32(OBJ + 0x64, PROG + 24);
    const live = [];
    for (let f = 0; f < 8; f++) {
        if (open.port.playback(mapId, x, y, f, true).op === 14) live.push(f);
    }
    assert.deepEqual(live, [0, 1, 2, 3, 4, 5, 6, 7],
        "op 14 asks no facing cone, so all eight facings arm it");
    const held = open.port.playback(mapId, x, y, at.group, true);
    assert.equal(held.op, 14, "with the flag at 1 the press runs op 14");
    assert.equal(held.effect.padSlot, 0x158);
    assert.equal(held.effect.handoff.holdTicks, 0x3c);
});
