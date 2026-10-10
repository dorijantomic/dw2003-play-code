// Phase 4 oracle: engine/dw3/ui/fade-wash.ts must reproduce pro/cardgame's
// colour-wash family. Each original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin, with the object factory, the frame delta and
// the three display-service boundaries stubbed identically on both sides; the
// object, the submitted packet, the bucket head and the boundary calls are
// compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    FADE_WASH,
    FADE_WASH_RECT,
    createFadeWash,
    fadeWashDraw,
    fadeWashHandler,
    fadeWashIsIdle,
    fadeWashSetColours,
    fadeWashStart,
    fadeWashStop,
    fadeWashTick,
} from "../engine/dw3/ui/fade-wash.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const CREATE = 0x800a367c;
const HANDLER = 0x800a35bc;
const TICK = 0x800a3488;
const DRAW = 0x800a32d8;
const SET_COLOURS = 0x800a3548;
const START = 0x800a3558;
const IS_IDLE = 0x800a35a4;
const STOP = 0x800a35b0;

const SERVICE = 0x8004de10;
const VIEW = 0x80190000;
const BUCKET = 0x80191000;
const CURSOR = 0x80192000;
const STACK = 0x80199000;
/** The prim cursor cell the service getter/setter read. */
const CURSOR_CELL = 0x8004de30;
/** The frame-delta cell F0x8001D704 returns. */
const DELTA_CELL = 0x8004de28;
const OBJECT_SPAN = 0x78;
const PACKET_SPAN = 0x40;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Deterministic values a runtime needs before any of the eight bodies run. */
function seed(rt, o = {}) {
    // the view the wash looks up through findRegisteredHandleByKey(0x100)
    rt.mem.write32(SERVICE + 0x60, VIEW);
    rt.mem.write32(SERVICE + 0xd8, 0x100);
    rt.mem.write32(VIEW + 0x138, 0x8001dfa8); // the view table's bucket method
    rt.mem.write32(BUCKET, o.bucket ?? 0x801abcde);
    rt.mem.write32(CURSOR_CELL, CURSOR);
    rt.mem.write32(DELTA_CELL, o.delta ?? 1);
    for (let i = 0; i < PACKET_SPAN; i += 4) rt.mem.write32(CURSOR + i, 0);
}

/** The original's boundary stubs; `events` records what the port must also call. */
function stubOriginal(rt, events) {
    rt.cpu.setStub(0x80014504, (c) => {
        events.push(["alloc", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return rt.world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0);
    });
    rt.cpu.setStub(0x8001dfa8, (c) => {
        events.push(["otBucket", c.reg(4) >>> 0, c.reg(5) | 0]);
        return BUCKET;
    });
    rt.cpu.setStub(0x8001d844, () => {
        events.push(["getCursor"]);
        return CURSOR;
    });
    rt.cpu.setStub(0x8001d854, (c) => {
        events.push(["setCursor", c.reg(4) >>> 0]);
        rt.mem.write32(CURSOR_CELL, c.reg(4) >>> 0);
    });
}

/**
 * The same host for the port. setState/advance0 reproduce the factory's base
 * methods byte for byte (engine/native/stubs.ts installCoreStubs, itself a
 * port of F0x80014274/F0x800142AC) because the original reaches them through
 * the object's own slot values.
 */
function portHost(rt, events) {
    return {
        allocate(h, s, e) {
            events.push(["alloc", h >>> 0, s >>> 0, e >>> 0]);
            return rt.world.alloc(h >>> 0, s, e, 0);
        },
        frameDelta: () => rt.mem.read32(DELTA_CELL) | 0,
        otBucket(view, depth) {
            events.push(["otBucket", view >>> 0, depth | 0]);
            return BUCKET;
        },
        getCursor() {
            events.push(["getCursor"]);
            return CURSOR;
        },
        setCursor(v) {
            events.push(["setCursor", v >>> 0]);
            rt.mem.write32(CURSOR_CELL, v >>> 0);
        },
        setState(obj, state) {
            rt.mem.write32(obj + 0xc, state | 0);
            rt.mem.write32(obj + 0x10, 0);
            rt.mem.write32(obj + 0x14, 0);
            rt.mem.write32(obj + 0x18, 0);
        },
        advance0(obj) {
            const v = (rt.mem.read32(obj + 0xc) | 0) + 1;
            rt.mem.write32(obj + 0x10, 0);
            rt.mem.write32(obj + 0x14, 0);
            rt.mem.write32(obj + 0x18, 0);
            rt.mem.write32(obj + 0xc, v | 0);
        },
    };
}

function objectBytes(rt, obj) {
    const out = [];
    for (let i = 0; i < OBJECT_SPAN; i++) out.push(rt.mem.read8(obj + i));
    return out;
}

function packetWords(rt) {
    const out = [];
    for (let i = 0; i < PACKET_SPAN; i += 4) out.push(rt.mem.read32(CURSOR + i) >>> 0);
    return out;
}

function snapshot(rt, obj) {
    return {
        obj: objectBytes(rt, obj),
        packet: packetWords(rt),
        bucket: rt.mem.read32(BUCKET) >>> 0,
        cursorCell: rt.mem.read32(CURSOR_CELL) >>> 0,
    };
}

/** Calls a routine whose 5th and 6th arguments live on the caller's stack. */
function callWithSix(rt, address, args) {
    for (let i = 0; i < 8; i++) rt.mem.write32(STACK + i * 4, 0);
    rt.mem.write32(STACK + 0x10, args[4] | 0);
    rt.mem.write32(STACK + 0x14, args[5] | 0);
    rt.cpu.sp = STACK;
    return rt.cpu.call(address, args.slice(0, 4));
}

function seedObject(rt, obj, o = {}) {
    rt.mem.write32(obj + FADE_WASH.state0, o.state0 ?? 1);
    rt.mem.write32(obj + FADE_WASH.state, o.state ?? 1);
    rt.mem.write32(obj + FADE_WASH.counter, o.counter ?? 0x10);
    rt.mem.write32(obj + FADE_WASH.duration, o.duration ?? 0x10);
    if (o.modeBits !== undefined) rt.mem.write8(obj + FADE_WASH.modeBits, o.modeBits);
    rt.mem.write8(obj + FADE_WASH.hold, o.hold ?? 0);
    for (let i = 0; i < 3; i++) {
        rt.mem.write8(obj + FADE_WASH.target + i, (o.target ?? [0x40, 0x80, 0xc0])[i]);
        rt.mem.write8(obj + FADE_WASH.previous + i, (o.previous ?? [0x10, 0x20, 0x30])[i]);
        rt.mem.write8(obj + FADE_WASH.current + i, (o.current ?? [0x10, 0x20, 0x30])[i]);
    }
}

/** Builds the object the same way on each side, then seeds it. */
function bothSides(modeBits, seedOpts = {}, rtOpts = {}) {
    const evA = [];
    const a = runtime();
    seed(a, rtOpts);
    stubOriginal(a, evA);
    const objA = a.cpu.call(CREATE, [modeBits]) >>> 0;
    seedObject(a, objA, seedOpts);

    const evB = [];
    const b = runtime();
    seed(b, rtOpts);
    const objB = createFadeWash(b.mem, portHost(b, evB), modeBits);
    seedObject(b, objB, seedOpts);
    assert.equal(objB >>> 0, objA, "both sides allocate the same object");
    return { a, b, objA, objB, evA, evB };
}

test("createFadeWash matches F0x800A367C", () => {
    for (const modeBits of [0, 1, 2, 3, 0x2a, 0xff]) {
        const { a, b, objA, objB } = bothSides(modeBits);
        assert.equal(objA, 0x800b0000, "the object comes from the stub heap base");
        assert.equal(a.mem.read32(objA + FADE_WASH.setColoursSlot) >>> 0, 0x800a3548);
        assert.equal(a.mem.read32(objA + FADE_WASH.startSlot) >>> 0, 0x800a3558);
        assert.equal(a.mem.read32(objA + FADE_WASH.isIdleSlot) >>> 0, 0x800a35a4);
        assert.equal(a.mem.read32(objA + FADE_WASH.stopSlot) >>> 0, 0x800a35b0);
        assert.equal(a.mem.read8(objA + FADE_WASH.modeBits), modeBits & 0xff);
        // the whole 0x78 bytes, so a slot or the mode byte missing, misplaced or
        // masked shows up; the factory's own base-slot writes are the same on
        // both sides (both go through the runtime's StubWorld factory)
        assert.deepEqual(snapshot(b, objB), snapshot(a, objA), `whole object modeBits=${modeBits}`);
    }
});

test("fadeWashSetColours, fadeWashIsIdle and fadeWashStop match", () => {
    for (const [r, g, b] of [[0x12, 0x34, 0x56], [0, 0, 0], [0xff, 0xff, 0xff]]) {
        const { a, b, objA, objB } = bothSides(0, { current: [0x99, 0x88, 0x77] });
        a.cpu.call(SET_COLOURS, [objA, r, g, b]);
        fadeWashSetColours(b.mem, objB, r, g, b);
        assert.deepEqual(snapshot(b, objB), snapshot(a, objA), `colours ${r},${g},${b}`);
    }
    for (const state of [0, 1, 2]) {
        const { a, b, objA, objB } = bothSides(0, { state });
        assert.equal(fadeWashIsIdle(b.mem, objB), a.cpu.call(IS_IDLE, [objA]), `isIdle state ${state}`);
        assert.deepEqual(snapshot(b, objB), snapshot(a, objA));
    }
    {
        const { a, b, objA, objB } = bothSides(0, { state: 1 });
        a.cpu.call(STOP, [objA]);
        fadeWashStop(b.mem, objB);
        assert.deepEqual(snapshot(b, objB), snapshot(a, objA), "stop");
    }
});

test("fadeWashStart matches F0x800A3558", () => {
    const CASES = [
        { r: 0x10, g: 0x20, b: 0x30, duration: 0x1e, hold: 0 },
        { r: 0x00, g: 0x00, b: 0x00, duration: 0x01, hold: 1 },
        { r: 0xff, g: 0x80, b: 0x01, duration: 0x100, hold: -1 },
    ];
    for (const tc of CASES) {
        const { a, b, objA, objB } = bothSides(0, { current: [0x40, 0x50, 0x60], state: 0 });
        callWithSix(a, START, [objA, tc.r, tc.g, tc.b, tc.duration, tc.hold]);
        fadeWashStart(b.mem, objB, tc.r, tc.g, tc.b, tc.duration, tc.hold);
        assert.deepEqual(snapshot(b, objB), snapshot(a, objA), JSON.stringify(tc));
        assert.equal(a.mem.read32(objA + FADE_WASH.state) | 0, 1);
        assert.equal(a.mem.read32(objA + FADE_WASH.counter) | 0, tc.duration);
        assert.equal(a.mem.read32(objA + FADE_WASH.duration) | 0, tc.duration);
    }
});

test("fadeWashTick matches F0x800A3488", () => {
    const CASES = [
        { counter: 0x10, delta: 1, hold: 0 },                       // mid-ramp
        { counter: 0x10, delta: 2, hold: 0 },                       // odd step
        { counter: 0x02, delta: 1, hold: 0 },                       // last ramp tick
        { counter: 0x01, delta: 1, hold: 0 },                       // lands, returns to idle
        { counter: 0x01, delta: 1, hold: 1 },                       // lands, holds
        { counter: 0x01, delta: 5, hold: 0 },                       // overshoots the end
        { counter: 0x10, delta: 3, hold: 0, target: [0x00, 0xff, 0x80], previous: [0xff, 0x00, 0x10] },
        { counter: 0x07, delta: 1, hold: 0, duration: 0x03 },
    ];
    for (const tc of CASES) {
        const { a, b, objA, objB } = bothSides(0, {
            counter: tc.counter, duration: tc.duration ?? 0x10, hold: tc.hold,
            target: tc.target, previous: tc.previous,
        }, { delta: tc.delta });
        seedObject(a, objA, {
            counter: tc.counter, duration: tc.duration ?? 0x10, hold: tc.hold,
            target: tc.target, previous: tc.previous,
        });
        const av = a.cpu.call(TICK, [objA]);
        const bv = fadeWashTick(b.mem, objB, portHost(b, []));
        assert.deepEqual(snapshot(b, objB), snapshot(a, objA), JSON.stringify(tc));
        assert.equal(bv | 0, av | 0, "return value");
    }
});

test("fadeWashDraw matches F0x800A32D8", () => {
    // the real rectangle the handler passes, plus a synthetic one
    const REAL_X = 0, REAL_Y = 0xfff1, REAL_W = 320, REAL_H = 260;
    const CASE = [
        { rect: (REAL_Y << 16) | REAL_X, size: (REAL_H << 16) | REAL_W, current: [0x11, 0x22, 0x33], modeBits: 2 },
        { rect: 0, size: 0, current: [0, 0, 0], modeBits: 0 },
        { rect: 0x12345678, size: 0x9abcdef0, current: [0xff, 0x00, 0x7f], modeBits: 3 },
    ];
    for (const tc of CASE) {
        const { a, b, objA, objB, evA, evB } = bothSides(tc.modeBits, { current: tc.current, modeBits: tc.modeBits });
        a.cpu.call(DRAW, [objA, tc.rect, tc.size]);
        fadeWashDraw(b.mem, objB, tc.rect, tc.size, portHost(b, evB));
        assert.deepEqual(snapshot(b, objB), snapshot(a, objA), JSON.stringify(tc));
        assert.deepEqual(evB, evA, "boundary calls");
        // the packet itself: tag length 5, the quad code, the colour and the
        // four vertex pairs, then the one-word draw-mode packet
        assert.equal(a.mem.read8(CURSOR + 3), 5, "quad length");
        assert.equal(a.mem.read8(CURSOR + 7), 0x2a, "quad code");
        assert.equal(a.mem.read8(CURSOR + 0x1b), 1, "draw-mode length");
        assert.equal(a.mem.read32(CURSOR + 0x1c) >>> 0, (0xe1000205 | ((tc.modeBits & 3) << 5)) >>> 0);
        assert.equal(a.mem.read32(CURSOR_CELL) >>> 0, (CURSOR + 0x20) >>> 0, "cursor published");
    }
});

test("fadeWashHandler matches F0x800A35BC", () => {
    const CASES = [
        { state0: 1, state: 1, hold: 0 },
        { state0: 1, state: 1, hold: 1 },
        { state0: 1, state: 0, hold: 0 },  // idle wash: draw only
        { state0: 1, state: 2, hold: 0 },  // finished wash: draw then setState(3)
        { state0: 0, state: 0, hold: 0 },  // the factory's advance arm
        { state0: 4, state: 0, hold: 0 },
        { state0: 2, state: 0, hold: 0 },  // 2 and 3 do nothing
        { state0: 3, state: 2, hold: 0 },
    ];
    for (const tc of CASES) {
        const { a, b, objA, objB, evB } = bothSides(1, {
            state0: tc.state0, state: tc.state, hold: tc.hold, counter: 0x02,
        });
        a.cpu.call(HANDLER, [objA]);
        fadeWashHandler(b.mem, objB, portHost(b, evB));
        assert.deepEqual(snapshot(b, objB), snapshot(a, objA), JSON.stringify(tc));
    }
    // the draw the handler submits comes from the overlay's own rectangle
    assert.equal(a_readRect() >>> 0, ((0xfff1 << 16) | 0) >>> 0, "rect table x=0 y=-15");
});

/** The rectangle table the handler reads, straight from the shipped overlay. */
function a_readRect() {
    const off = FADE_WASH_RECT - 0x80082cb0;
    const x = overlay[off] | (overlay[off + 1] << 8);
    const y = overlay[off + 2] | (overlay[off + 3] << 8);
    return ((y << 16) | x) >>> 0;
}
