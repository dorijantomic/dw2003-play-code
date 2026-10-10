// Lane B Phase 4 oracle: engine/dw3/ui/native/select-action.ts must match the
// original pro/stgdglab Select Action constructor, lifecycle and picker draw.
//
//   F0x8008A610 select_action_construct
//   F0x8008A51C select_action_lifecycle
//   F0x80089AEC select_action_draw
//
// The originals run through engine/native on the shipped pro_stgdglab.bin +
// resident.bin. The interpreter's decoded draw-context fill and 12 context hooks
// are overridden so the test records one interleaved log of every draw call and
// every resident call (packResolve / frameTick / rosterSlot /
// foldStatus / the widget factory), then compares it and the object fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    selectActionConstruct,
    selectActionLifecycle,
    selectActionDraw,
    SELECT_FIELDS,
} from "../../engine/dw3/ui/native/select-action.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const name = new Uint8Array(readFileSync(join(dir, "pro_stgdglab.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: name.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const PARENT = 0x80151000;
const ANIM_BASE = 0x80180000;

const CONSTRUCT_FN = 0x8008a610;
const LIFECYCLE_FN = 0x8008a51c;
const DRAW_FN = 0x80089aec;
const TICK_FN = 0x80088b5c;
const HELPER_FN = 0x80088808;

const CTX_SETORIGIN = 0x8001ecbc;
const CTX_SETLAYER = 0x8001ed34;
const CTX_DRAWSPRITE = 0x8001ed6c;
const CTX_PALETTE = 0x8001ecec;
const CTX_SETSCALE = 0x8001f5d0;
const CTX_SETPOS = 0x8001f608;

const ALLOC_FN = 0x80014504;
const PACK_CELL = 0x80044f5c;
const FRAME_TICK_CELL = 0x8004df98;
const ROSTER_CELL = 0x8004b45c; // == 0x80048d34 + 0x2728
const FOLD_STATUS_CELL = 0x8008fd9c;
const ANIM_TABLE_CELL = 0x8008fd68;

const STUB = 0x0fe30000;
const PACK_STUB = STUB + 0x10;
const FRAME_STUB = STUB + 0x14;
const ROSTER_STUB = STUB + 0x18;
const FOLD_STATUS_STUB = STUB + 0x20;
const TICK_STUB = STUB + 0x24;
const HELPER_STUB = STUB + 0x28;
const DESTROY_STUB = STUB + 0x2c;

const LOG = [];
let seqIndex = 0;

const CONTROL = {
    roster: [-1, -1, -1, -1, -1, -1, -1, -1],
    foldStatus: 0,
    pack: 0x0abc0000,
    frame: [],
};

function nextFrame() {
    const v = CONTROL.frame[seqIndex] ?? 0;
    seqIndex += 1;
    return v;
}

function installHooks(rt) {
    const draw = (name, arity) => (c) => {
        const args = [];
        for (let i = 0; i < arity; i++) args.push(c.reg(4 + i) | 0);
        LOG.push([name, ...args]);
        return 0;
    };
    rt.cpu.setStub(CTX_SETORIGIN, draw("setOrigin", 2));
    rt.cpu.setStub(CTX_SETLAYER, draw("setLayer", 2));
    rt.cpu.setStub(CTX_DRAWSPRITE, draw("drawSprite", 4));
    rt.cpu.setStub(CTX_PALETTE, draw("paletteShift", 1));
    rt.cpu.setStub(CTX_SETSCALE, draw("setScale", 3));
    rt.cpu.setStub(CTX_SETPOS, draw("setPos", 2));

    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["packResolve", c.reg(4) >>> 0]); return CONTROL.pack; });
    rt.cpu.setStub(FRAME_STUB, () => { LOG.push(["frameTick"]); return nextFrame(); });
    rt.cpu.setStub(ROSTER_STUB, (c) => { LOG.push(["rosterSlot", c.reg(4) | 0]); return CONTROL.roster[c.reg(4) | 0] ?? -1; });
    rt.cpu.setStub(FOLD_STATUS_STUB, (c) => { LOG.push(["foldStatus", c.reg(4) | 0]); return CONTROL.foldStatus; });
    rt.cpu.setStub(TICK_STUB, (c) => { LOG.push(["tick", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(HELPER_STUB, (c) => { LOG.push(["buildLists", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(DESTROY_STUB, (c) => { LOG.push(["method", c.reg(4) | 0, 0x38, c.reg(4) | 0]); return 0; });

    rt.mem.write32(PACK_CELL, PACK_STUB);
    rt.mem.write32(FRAME_TICK_CELL, FRAME_STUB);
    rt.mem.write32(ROSTER_CELL, ROSTER_STUB);
    rt.mem.write32(FOLD_STATUS_CELL, FOLD_STATUS_STUB);
    rt.mem.write32(ANIM_TABLE_CELL, ANIM_BASE);
}

/** A runtime that does not stub the draw under test. */
function runtime() {
    const rt = new NativeStageRuntime(name, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    installHooks(rt);
    return rt;
}

function portDrawHost() {
    return {
        initDrawContext() {},
        setOrigin(x, y) { LOG.push(["setOrigin", x | 0, y | 0]); },
        setLayer(t, b) { LOG.push(["setLayer", t | 0, b | 0]); },
        drawSprite(p, clip, x, y) { LOG.push(["drawSprite", p | 0, clip | 0, x | 0, y | 0]); },
        paletteShift(v) { LOG.push(["paletteShift", v | 0]); },
        setScale(x, y, z) { LOG.push(["setScale", x | 0, y | 0, z | 0]); },
        setPos(x, y) { LOG.push(["setPos", x | 0, y | 0]); },
        packResolve(handle) { LOG.push(["packResolve", handle >>> 0]); return CONTROL.pack; },
        frameTick() { LOG.push(["frameTick"]); return nextFrame(); },
        rosterSlot(index) { LOG.push(["rosterSlot", index | 0]); return CONTROL.roster[index | 0] ?? -1; },
    };
}

function portLifecycleHost() {
    return {
        selectTick(obj, arg1) { LOG.push(["tick", obj | 0, arg1 | 0]); },
        selectDraw(obj, arg1) { LOG.push(["draw", obj | 0, arg1 | 0]); },
        buildLists(obj, arg1) { LOG.push(["buildLists", obj | 0, arg1 | 0]); },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
        foldStatus(target) { LOG.push(["foldStatus", target | 0]); return CONTROL.foldStatus; },
    };
}

function clear(rt, addr, size) {
    for (let i = 0; i < size; i++) rt.mem.write8(addr + i, 0);
}

function seedDraw(rt, c) {
    clear(rt, OBJ, 0x120);
    clear(rt, PARENT, 0x80);
    clear(rt, ANIM_BASE, 0x100);
    rt.mem.write32(OBJ + SELECT_FIELDS.mode, c.mode ?? 0);
    rt.mem.write32(OBJ + SELECT_FIELDS.parent, PARENT);
    rt.mem.write32(OBJ + SELECT_FIELDS.layer, c.layer ?? 0x55);
    rt.mem.write32(OBJ + SELECT_FIELDS.bucket, c.bucket ?? 0x66);
    for (const [key, off] of [
        ["foldA", SELECT_FIELDS.foldA], ["foldB", SELECT_FIELDS.foldB],
        ["foldC", SELECT_FIELDS.foldC], ["foldD", SELECT_FIELDS.foldD],
        ["foldE", SELECT_FIELDS.foldE], ["foldF", SELECT_FIELDS.foldF],
        ["foldG", SELECT_FIELDS.foldG], ["foldH", SELECT_FIELDS.foldH],
        ["foldI", SELECT_FIELDS.foldI],
    ]) {
        rt.mem.write32(OBJ + off, c[key] ?? 0);
    }
    rt.mem.write32(OBJ + SELECT_FIELDS.frameTimer, c.frameTimer ?? 0);
    rt.mem.write32(OBJ + SELECT_FIELDS.clutTimer, c.clutTimer ?? 0);
    const slotFrames = c.slotFrames ?? [0, 0, 0];
    for (let i = 0; i < 3; i++) rt.mem.write32(OBJ + i * 4 + SELECT_FIELDS.slotFrame, slotFrames[i] ?? 0);
    rt.mem.write32(OBJ + SELECT_FIELDS.pickFrame, c.pickFrame ?? 0);
    rt.mem.write32(OBJ + SELECT_FIELDS.clut, c.clut ?? 0);
    rt.mem.write32(PARENT + 0x5c, c.count ?? 0);
    rt.mem.write32(PARENT + 0x64, c.selected ?? 0);

    const anim = c.anim ?? [];
    for (let i = 0; i < 0x40; i++) rt.mem.write32(ANIM_BASE + i * 4, (anim[i] ?? (0x20 + i)) | 0);

    CONTROL.roster = c.roster ?? [-1, -1, -1, -1, -1, -1, -1, -1];
    CONTROL.frame = c.frame ?? [];
    seqIndex = 0;
}

function drawSnap(rt) {
    const out = [];
    for (const off of [
        SELECT_FIELDS.mode, SELECT_FIELDS.frameTimer, SELECT_FIELDS.clutTimer,
        SELECT_FIELDS.pickFrame, SELECT_FIELDS.clut,
        SELECT_FIELDS.foldA, SELECT_FIELDS.foldB, SELECT_FIELDS.foldC,
        SELECT_FIELDS.foldD, SELECT_FIELDS.foldE, SELECT_FIELDS.foldF,
        SELECT_FIELDS.foldG, SELECT_FIELDS.foldH, SELECT_FIELDS.foldI,
    ]) {
        out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    }
    for (let i = 0; i < 3; i++) out.push(`fc${i}=${rt.mem.read32(OBJ + i * 4 + SELECT_FIELDS.slotFrame) >>> 0}`);
    return out;
}

const DRAW_CASES = [
    { name: "inactive: no folds", mode: 0 },
    {
        name: "inactive: folds mid-tween", mode: 0,
        foldA: 0x800, foldB: 0x1000, foldC: 0xfffff000,
    },
    {
        name: "active: no folds, empty picker", mode: 0xa, count: 1,
        roster: [-1, -1, -1, -1, -1, -1, -1, -1],
        frame: [100, 100, 100, 100],
    },
    {
        name: "active: portrait + pedestals advance and reset",
        mode: 0xa, count: 2,
        pickFrame: 6, slotFrames: [6, 3], roster: [2, 4, -1, -1, -1, -1, -1, -1],
        anim: Object.assign(new Array(0x40).fill(0).map((_, i) => 0x20 + i), { 21: -1, 32: -1 }),
        frame: [20, 20, 0, 0],
        foldH: 0x1000, foldG: 0x1000, foldD: 0x1000,
        foldE: 0x1000, foldF: 0x1000, foldI: 0x1000,
    },
    {
        name: "active: folds mid-tween, all panels",
        mode: 0xa, count: 3, selected: 1,
        foldH: 0x900, foldG: 0x900, foldD: 0x900,
        foldE: 0x900, foldF: 0x900, foldI: 0x900,
        roster: [0, 1, 2, -1, -1, -1, -1, -1],
        frame: [10, 10, 10, 10],
    },
    {
        name: "active: zero folds draw nothing",
        mode: 0xa, count: 1, roster: [0, -1, -1, -1, -1, -1, -1, -1],
        frame: [0, 0, 0, 0],
    },
    {
        name: "active: clut advances below the wrap",
        mode: 0xa, count: 0, clut: 2, frameTimer: 0, clutTimer: 0,
        roster: [-1, -1, -1, -1, -1, -1, -1, -1],
        frame: [0, 10, 10, 0],
    },
    {
        name: "active: frame timer just below period",
        mode: 0xa, count: 0, frameTimer: 100, clutTimer: 0,
        roster: [-1, -1, -1, -1, -1, -1, -1, -1],
        frame: [111, 111, 0, 0],
    },
    {
        name: "active: clut timer exactly at period",
        mode: 0xa, count: 0, frameTimer: 0, clutTimer: 0,
        roster: [-1, -1, -1, -1, -1, -1, -1, -1],
        frame: [0, 10, 10, 0],
    },
];

test("selectActionDraw matches F0x80089AEC", () => {
    const rt = runtime();
    for (const c of DRAW_CASES) {
        seedDraw(rt, c);
        LOG.length = 0;
        rt.cpu.call(DRAW_FN, [OBJ], 80000);
        const olog = LOG.slice();
        const osnap = drawSnap(rt);

        seedDraw(rt, c);
        LOG.length = 0;
        selectActionDraw(rt.mem, OBJ, portDrawHost());
        const plog = LOG.slice();

        assert.deepEqual(plog, olog, `${c.name}: calls`);
        assert.deepEqual(drawSnap(rt), osnap, `${c.name}: fields`);
    }
});

function seedLifecycle(rt, c) {
    clear(rt, OBJ, 0x120);
    rt.mem.write32(OBJ + SELECT_FIELDS.state, c.state ?? 0);
    rt.mem.write32(OBJ + SELECT_FIELDS.flag18, c.flag18 ?? 0);
    rt.mem.write32(OBJ + SELECT_FIELDS.destroy, DESTROY_STUB);
    for (let off = 0x60; off <= 0xe8; off += 4) rt.mem.write32(OBJ + off, 0xdead0000 + off);
    CONTROL.foldStatus = c.foldStatus ?? 0;
}

function lifecycleSnap(rt) {
    const out = [];
    for (const off of [SELECT_FIELDS.state, 0x64, 0x74, 0x84, 0x94, 0xa4, 0xb4, 0xc4, 0xd4, 0xe4]) {
        out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    }
    return out;
}

const LIFECYCLE_CASES = [
    { name: "init: state 0 folds everything", state: 0 },
    { name: "init: state 7 folds everything", state: 7 },
    { name: "state 1 ticks then draws", state: 1 },
    { name: "state 3 no-op", state: 3 },
    { name: "state 2 fold running, flag set", state: 2, foldStatus: 1, flag18: 1 },
    { name: "state 2 fold running, flag clear", state: 2, foldStatus: 1, flag18: 0 },
    { name: "state 2 fold done", state: 2, foldStatus: 0, flag18: 0 },
];

test("selectActionLifecycle matches F0x8008A51C", () => {
    const rt = runtime();
    // The lifecycle calls the tick and draw directly; intercept them here.
    rt.cpu.setStub(TICK_FN, (c) => { LOG.push(["tick", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(DRAW_FN, (c) => { LOG.push(["draw", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(HELPER_FN, (c) => { LOG.push(["buildLists", c.reg(4) | 0, c.reg(5) | 0]); return 0; });

    for (const c of LIFECYCLE_CASES) {
        seedLifecycle(rt, c);
        LOG.length = 0;
        rt.cpu.call(LIFECYCLE_FN, [OBJ, 0x80152000], 60000);
        const olog = LOG.slice();
        const osnap = lifecycleSnap(rt);

        seedLifecycle(rt, c);
        LOG.length = 0;
        selectActionLifecycle(rt.mem, OBJ, 0x80152000, portLifecycleHost());
        const plog = LOG.slice();

        assert.deepEqual(plog, olog, `${c.name}: calls`);
        assert.deepEqual(lifecycleSnap(rt), osnap, `${c.name}: fields`);
    }
});

function seedConstruct(rt) {
    clear(rt, OBJ, 0x140);
    CONTROL.frame = [];
}

test("selectActionConstruct matches F0x8008A610", () => {
    const rt = runtime();
    const allocLog = [];
    rt.cpu.setStub(ALLOC_FN, (c) => {
        allocLog.push([c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
        return OBJ;
    });

    seedConstruct(rt);
    allocLog.length = 0;
    LOG.length = 0;
    rt.cpu.call(CONSTRUCT_FN, [PARENT], 20000);
    const oalloc = allocLog.slice();
    const osnap = [rt.mem.read32(OBJ + 0x114) >>> 0, rt.mem.read32(OBJ + 0x118) >>> 0,
        rt.mem.read32(OBJ + SELECT_FIELDS.layer) >>> 0, rt.mem.read32(OBJ + SELECT_FIELDS.bucket) >>> 0,
        rt.mem.read32(OBJ + SELECT_FIELDS.parent) >>> 0];

    seedConstruct(rt);
    const palloc = [];
    const pobj = selectActionConstruct(rt.mem, {
        alloc(cb, size, extra) { palloc.push([cb >>> 0, size | 0, extra | 0]); return OBJ; },
    }, PARENT);
    const psnap = [rt.mem.read32(OBJ + 0x114) >>> 0, rt.mem.read32(OBJ + 0x118) >>> 0,
        rt.mem.read32(OBJ + SELECT_FIELDS.layer) >>> 0, rt.mem.read32(OBJ + SELECT_FIELDS.bucket) >>> 0,
        rt.mem.read32(OBJ + SELECT_FIELDS.parent) >>> 0];

    assert.deepEqual(palloc, oalloc, "alloc args");
    assert.equal(pobj >>> 0, OBJ >>> 0, "returned object");
    assert.deepEqual(psnap, osnap, "fields");
});
