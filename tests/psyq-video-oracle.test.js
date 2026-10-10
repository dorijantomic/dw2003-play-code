// Phase 4 oracle: engine/dw3/psyq-video.ts must reproduce the three resident

// display-init helpers. PutDrawEnv (0x80025ECC), SetGeomOffset (0x8002B3EC) and

// VSync (0x8002E7FC) are stubbed identically on both sides, so the bodies' own

// writes and the arguments the two boundaries receive are what is compared.



import { test } from "node:test";

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { dirname, join, resolve } from "node:path";

import { fileURLToPath } from "node:url";

import { NativeStageRuntime } from "../engine/native/runtime.ts";

import {

    BUFFER_INDEX,

    BUFFER_X_OFFSETS,

    BUFFER_Y_OFFSETS,

    DOUBLE_BUFFER_FLAG,

    CLEAR_OTAG_HEAD,

    GPU_DEBUG_DISPATCH,

    GPU_DEBUG_ARG0,

    GPU_DEBUG_LEVEL,

    GPU_FUNCTION_TABLE,

    GPU_QUEUE_TAIL,

    GS_3D_FLAG,

    GS_3D_MODE,

    GS_3D_MAX,

    GS_3D_VIEW_HEIGHT,

    GS_3D_VIEW_WIDTH,

    VBLANK_DEADLINE,

    VBLANK_ITERATION,

    VIEW_ANCHOR,

    VIEW_DRAW_OFFSETS,

    clearOtagR,

    gsInit3D,

    gpuQueueStallCheck,

    gpuQueuePoll,
    gpuQueueDrain,
    gpuQueueSend,
    drawSync,
    putDrawEnv,
    positionDrawEnv,
    DRAW_ENV_TEMPLATE,
    GS_BUFFER_INDEX,

    setAlarm,

    updateViewAnchor,

} from "../engine/dw3/psyq-video.ts";



const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");

const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));

const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });

const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };



const SET_ALARM = 0x80027d6c;

const UPDATE_VIEW_ANCHOR = 0x8002977c;

const GS_INIT_3D = 0x8002990c;

const VSYNC = 0x8002e7fc;

const PUT_DRAW_ENV = 0x80025ecc;

const SET_GEOM_OFFSET = 0x8002b3ec;



const VBLANK_RETURN = 0x1234;

const WINDOW = 0x80081240;

const WINDOW_LEN = 0xb4; // through 0x800812f4



function makeRt() {

    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {

        image: resident,

        base: 0x80010000,

    });

    rt.cpu.gp = 0x8005cb50;

    const calls = [];

    rt.cpu.setStub(VSYNC, () => VBLANK_RETURN);

    rt.cpu.setStub(PUT_DRAW_ENV, (c) => {

        calls.push(["putDrawEnv", c.reg(4) >>> 0]);

        return 0;

    });

    rt.cpu.setStub(SET_GEOM_OFFSET, (c) => {

        calls.push(["setGeomOffset", c.reg(4) | 0, c.reg(5) | 0]);

        return 0;

    });

    return { rt, calls };

}



/** The same three boundaries, as the port sees them. */

function portHost(calls, vblank = VBLANK_RETURN) {

    return {

        vsync: () => vblank,

        putDrawEnv: (env) => {

            calls.push(["putDrawEnv", env >>> 0]);

        },

        setGeomOffset: (x, y) => {

            calls.push(["setGeomOffset", x | 0, y | 0]);

        },

    };

}

/** PutDrawEnv's own two boundaries, mirroring the interpreter's stubs. */
function putDrawEnvPortHost(calls) {
    return {
        debugLog: (tag, env) => calls.push(["debugLog", tag >>> 0, env >>> 0]),
        submit: (arg0, packet, size, flags) => calls.push(["submit", arg0 >>> 0, packet >>> 0, size >>> 0, flags >>> 0]),
    };
}

/** The env layout seed and the full state both sides of the oracle compare. */
const PDE = 0x80081258;              // matches VIEW_DRAW_ENV, far from the cache
const PUTDRAWENV_BYTES = 0x80;      // covers packet at +0x1C and the 0x5C cache copy
const PUTDRAWENV_PACKET = PDE + 0x1c;

function seedPutDrawEnv(rt, { level = 0, driver = null, logSlot = null } = {}) {
    for (let i = 0; i < PUTDRAWENV_BYTES; i++) rt.mem.write8(PDE + i, (i * 29 + 0x41) & 0xff);
    // The tail of the 0x5C cache window and packet space start distinct so the
    // copy is observable (dest cells pre-poisoned with 0xCC).
    for (let i = 0; i < 0x5c; i++) rt.mem.write8(0x80055f08 + i, 0xcc);
    rt.mem.write8(0x80055efa, level);
    rt.mem.write32(0x80055ef4, PDE_LOG);
    rt.mem.write32(0x80055ef0, PDE_DRIVER);
    rt.mem.write32(PDE_DRIVER + 8, PDE_SEND);
    rt.mem.write32(PDE_DRIVER + 0x18, 0x51515151);
    for (let i = 0; i < 0x40; i++) rt.mem.write8(PUTDRAWENV_PACKET + i, 0xee);
}

function putDrawEnvState(rt) {
    const env = [];
    for (let i = 0; i < PUTDRAWENV_BYTES; i++) env.push(rt.mem.read8(PDE + i));
    const cache = [];
    for (let i = 0; i < 0x5c; i++) cache.push(rt.mem.read8(0x80055f08 + i));
    return { env, cache };
}

/** PutDrawEnv's two boundary targets: real resident addresses whose bodies
 *  the interpreter replaces with stubs (never re-entering the interpreter). */
const PDE_LOG = 0x8002b40c;   // debug logger target stored at [0x80055ef4]
const PDE_SEND = 0x800295ec;  // driver send method stored at [driver+8]
const PDE_DRIVER = 0x80081500; // scratch driver table (outside compared cells)

/** Runtime WITHOUT the PutDrawEnv stub, so the original body executes. */
function makePutDrawEnvRt(calls) {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PDE_LOG, (c) => {
        calls.push(["debugLog", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(PDE_SEND, (c) => {
        calls.push(["submit", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
        return 0;
    });
    return rt;
}



function seed(rt, { de = 0, dc = 0, x = 0x30, y = 0x20, w = 0x140, h = 0xf0 }) {

    for (let i = 0; i < WINDOW_LEN; i++) rt.mem.write8(WINDOW + i, 0xaa);

    rt.mem.write16(BUFFER_X_OFFSETS, 0x0010);

    rt.mem.write16(BUFFER_X_OFFSETS + 2, 0xfff8);

    rt.mem.write16(BUFFER_Y_OFFSETS, 0x0020);

    rt.mem.write16(BUFFER_Y_OFFSETS + 2, 0x0004);

    rt.mem.write16(VIEW_ANCHOR, x);

    rt.mem.write16(VIEW_ANCHOR + 2, y);

    rt.mem.write16(VIEW_DRAW_OFFSETS, 0xaaaa);

    rt.mem.write16(VIEW_DRAW_OFFSETS + 2, 0xbbbb);

    rt.mem.write16(BUFFER_INDEX, dc);

    rt.mem.write16(DOUBLE_BUFFER_FLAG, de);

    rt.mem.write32(GS_3D_VIEW_WIDTH, w);

    rt.mem.write32(GS_3D_VIEW_HEIGHT, h);

    rt.mem.write32(GS_3D_MODE, 0xa5a5a5a5);

    rt.mem.write32(GS_3D_FLAG, 0xa5a5a5a5);

    rt.mem.write32(GS_3D_MAX, 0xa5a5a5a5);

    rt.mem.write32(VBLANK_DEADLINE, 0xa5a5a5a5);

    rt.mem.write32(VBLANK_ITERATION, 0xa5a5a5a5);

}



function state(rt) {

    const window = [];

    for (let i = 0; i < WINDOW_LEN; i++) window.push(rt.mem.read8(WINDOW + i));

    return {

        window,

        deadline: rt.mem.read32(VBLANK_DEADLINE) >>> 0,

        iteration: rt.mem.read32(VBLANK_ITERATION) >>> 0,

    };

}



test("putDrawEnv matches F0x80025ECC", () => {
    for (const level of [0, 1, 2, 255]) {
        const callsA = [];   // original: stubbed boundaries
        const callsB = [];   // port: host object
        const a = makePutDrawEnvRt(callsA);
        const b = makePutDrawEnvRt([]);
        seedPutDrawEnv(a, { level });
        seedPutDrawEnv(b, { level });
        const retA = a.cpu.call(0x80025ecc, [PDE]);
        const retB = putDrawEnv(b.mem, PDE, putDrawEnvPortHost(callsB));
        assert.deepEqual(putDrawEnvState(b), putDrawEnvState(a), `level=${level} state`);
        assert.deepEqual(callsB, callsA, `level=${level} boundary calls`);
        assert.equal(retB >>> 0, retA >>> 0, `level=${level} return`);
        if (level < 2) assert.equal(callsB.length, 1, "no logger call below level 2");
        if (level >= 2) assert.equal(callsB[0][0], "debugLog", "logger first at level >=2");
    }
});

test("setAlarm matches F0x80027D6C", () => {

    // The deadline wraps in u32 exactly as `addiu v0,0xf0` does.

    for (const v of [VBLANK_RETURN, 0, 0xffffff00, 0xffffffff]) {

        const a = makeRt();

        seed(a.rt, {});

        a.rt.cpu.setStub(VSYNC, () => v);

        const av = a.rt.cpu.call(SET_ALARM, []);

        const as = state(a.rt);

        const b = makeRt();

        seed(b.rt, {});

        const bv = setAlarm(b.rt.mem, portHost(b.calls, v));

        const bs = state(b.rt);

        assert.deepEqual(bs, as, `vsync=0x${v.toString(16)}`);

        assert.equal(bv | 0, av | 0, `return vsync=0x${v.toString(16)}`);

        // the two cells are the deadline and a zeroed counter

        assert.equal(as.deadline >>> 0, (v + 0xf0) >>> 0, "deadline");

        assert.equal(as.iteration >>> 0, 0, "iteration");

    }

});



// Arm A reads the anchor and its table entry with `lhu` while arm B uses `lh`;

// the two are unobservable here because the sums are truncated to 16 bits by

// `sh`, and sign extension only changes the sum by a multiple of 65536. The

// mutation sweep cannot see a signed arm-A read, and that is a property of the

// domain, not a test gap.

// GsSetDrawBuffClip's only callee is PutDrawEnv 0x80025ECC, so this oracle
// uses the established makeRt()/portHost() harness whose 0x80025ECC stub IS
// the boundary (the same pattern updateViewAnchor's oracle pins). The template
// and per-buffer offsets are read signed and every observable sum is truncated
// by `sh`, so sign extension is unobservable in the final halfwords (the same
// domain property updateViewAnchor's oracle documents); the compared state is
// the DRAWENV halfwords and the boundary call.
test("positionDrawEnv matches F0x8002988C", () => {
    const TEMPLATE = DRAW_ENV_TEMPLATE;
    const WINDOW = 0x80081240;
    const LEN = 0xa0; // through 0x800812e0: template, tables and index cell
    const seedPde = (rt, { tx = -8, ty = 0x40, w = 0x140, h = 0xf0, dc = 1,
        ox0 = 0x10, ox1 = 0xfff8, oy0 = 0x20, oy1 = 4 } = {}) => {
        for (let i = 0; i < LEN; i++) rt.mem.write8(WINDOW + i, 0x77);
        rt.mem.write16(TEMPLATE, tx); rt.mem.write16(TEMPLATE + 2, ty);
        rt.mem.write16(TEMPLATE + 4, w); rt.mem.write16(TEMPLATE + 6, h);
        rt.mem.write16(0x800812dc, dc);
        rt.mem.write16(0x80081240, ox0); rt.mem.write16(0x80081242, ox1);
        rt.mem.write16(0x80081244, oy0); rt.mem.write16(0x80081246, oy1);
    };
    const drawEnv = (rt) => [0, 2, 4, 6].map((o) => rt.mem.read16(0x80081258 + o));
    const CASES = [
        { name: "buffer 1", dc: 1 },
        { name: "buffer 0", dc: 0 },
        { name: "raw index 2", dc: 2 },
        { name: "negative template x", tx: -8 },
        { name: "negative offsets", ox0: 0xfff0, oy0: 0xffe0 },
        { name: "sum wraps u16", tx: 0x7fff, ox0: 0x7fff },
        { name: "negative index", dc: 0xffff },
    ];
    for (const tc of CASES) {
        const a = makeRt();
        seedPde(a.rt, tc);
        a.rt.cpu.call(0x8002988c, []);
        const callsB = [];
        const b = makeRt();
        seedPde(b.rt, tc);
        positionDrawEnv(b.rt.mem, portHost(callsB));
        assert.deepEqual(drawEnv(b.rt), drawEnv(a.rt), `${tc.name} draw env`);
        assert.deepEqual(callsB, a.calls, `${tc.name} boundary calls`);
        assert.deepEqual(callsB, [["putDrawEnv", 0x80081258]], `${tc.name} putDrawEnv target`);
    }
});

test("updateViewAnchor matches F0x8002977C on both arms", () => {

    const CASES = [

        { name: "single buffer, buffer 0", de: 0, dc: 0 },

        { name: "single buffer, buffer 1", de: 0, dc: 1 },

        { name: "single buffer, dc>=2", de: 0, dc: 2 },

        { name: "double buffer, buffer 0", de: 1, dc: 0 },

        { name: "double buffer, buffer 1", de: 1, dc: 1 },

        { name: "double buffer, dc=2 (raw index)", de: 1, dc: 2 },

        { name: "zero anchor", de: 0, dc: 1, x: 0, y: 0 },

        { name: "negative anchor", de: 0, dc: 1, x: 0xfff0, y: 0xffe0 },

        { name: "double buffer, negative anchor and offset", de: 1, dc: 1, x: 0xfff0, y: 0xffe0 },

        { name: "anchor plus offset wraps", de: 0, dc: 1, x: 0xffff, y: 0xfff0 },

    ];

    for (const tc of CASES) {

        const a = makeRt();

        seed(a.rt, tc);

        a.rt.cpu.call(UPDATE_VIEW_ANCHOR, []);

        const as = state(a.rt);

        const b = makeRt();

        seed(b.rt, tc);

        updateViewAnchor(b.rt.mem, portHost(b.calls));

        assert.deepEqual(state(b.rt), as, `${tc.name} state`);

        assert.deepEqual(b.calls, a.calls, `${tc.name} boundary calls`);

    }

});



test("gsInit3D matches F0x8002990C", () => {

    const SIZES = [

        [0x140, 0xf0],

        [0x100, 0x100],

        [1, 3],

        [0, 0],

        [0xffffffff, 0xfffffffd], // -1 and -3: the rounding-toward-zero edge

        [0xffff, 0xffff],

        [0x80000000, 1], // the sra edge: -2147483648 and 1

        [0x1ff, 0x2ff],

    ];

    for (const [w, h] of SIZES) {

        const tc = { w, h, de: 0, dc: 0 };

        const a = makeRt();

        seed(a.rt, tc);

        const av = a.rt.cpu.call(GS_INIT_3D, []);

        const as = state(a.rt);

        const b = makeRt();

        seed(b.rt, tc);

        const bv = gsInit3D(b.rt.mem, portHost(b.calls));

        assert.deepEqual(state(b.rt), as, `w=0x${(w >>> 0).toString(16)} h=0x${(h >>> 0).toString(16)} state`);

        assert.deepEqual(b.calls, a.calls, `w=0x${(w >>> 0).toString(16)} boundary calls`);

        assert.equal(bv | 0, av | 0, "return");

        assert.equal(av | 0, 0x3fff, "returns 0x3FFF");

        assert.equal(as.window[(GS_3D_MODE - WINDOW)], 10, "mode 10");

    }

});



// The double-buffered arm must reach PutDrawEnv with the DRAWENV pointer, and

// the single-buffered arm must reach SetGeomOffset with the two sums; a port

// that took the other arm would still pass a state comparison of zeroes, so

// each case asserts the boundary it chose.

test("the two arms reach their own boundary", () => {

    const a = makeRt();

    seed(a.rt, { de: 1, dc: 0 });

    a.rt.cpu.call(UPDATE_VIEW_ANCHOR, []);

    assert.deepEqual(a.calls, [["putDrawEnv", 0x80081258]]);

    const b = makeRt();

    seed(b.rt, { de: 0, dc: 1 });

    b.rt.cpu.call(UPDATE_VIEW_ANCHOR, []);

    assert.deepEqual(b.calls, [["setGeomOffset", 0x40, 0x40]]);

});



// F0x80027DA0, fns.s:26103-26181. Stateful device reads detect a missing

// discarded first GPU read; one event stream checks calls and write order.

function watchdogCase(tc, translated) {

    const { rt } = makeRt();

    const events = [];

    const gpu = 0x1f801810, status = 0x1f801814;

    const dma = 0x1f8010a8, control = 0x1f8010f0;

    const ports = new Map([[gpu, 0x80000011], [status, 0x98765432],

        [dma, 0xabcdef01], [control, 0x12345000]]);

    for (const [addr, value] of [

        [0x80056000, gpu], [0x80056004, status], [0x8005600c, dma],

        [0x8005601c, control], [0x80056020, tc.head ?? 3],

        [0x80056024, tc.tail ?? 62], [0x80056030, 0x5555aaaa],

        [VBLANK_DEADLINE, tc.deadline], [VBLANK_ITERATION, tc.iteration],

    ]) rt.mem.write32(addr, value);

    rt.mem.devices = {

        read(addr) {

            if (!ports.has(addr)) return undefined;

            const value = ports.get(addr);

            events.push(["read", addr, value]);

            if (addr === gpu) ports.set(addr, (value + 1) >>> 0);

            return value;

        },

        write(addr, value) {

            if (!ports.has(addr)) return false;

            events.push(["write", addr, value]);

            ports.set(addr, value);

            return true;

        },

    };

    rt.mem.onWrite = (_pc, addr, size, value) => {

        if (addr >= 0x80056000 && addr < 0x8005603c)

            events.push(["store", addr, size, value]);

    };

    const host = {

        vsync() { events.push(["vsync", -1]); return tc.frame; },

        report(...args) { events.push(["report", ...args.map(v => v >>> 0)]); },

        setIntrMask(mask) {

            events.push(["mask", mask >>> 0]);

            return tc.mask ?? 0x1234abcd;

        },

    };

    rt.cpu.setStub(VSYNC, c => {

        assert.equal(c.reg(4) | 0, -1);

        return host.vsync();

    });

    rt.cpu.setStub(0x800283fc, c => {

        host.report(c.reg(4), c.reg(5), c.reg(6), c.reg(7), rt.mem.read32(c.reg(29) + 16));

        return 0x654321;

    });

    rt.cpu.setStub(0x8002eb98, c => host.setIntrMask(c.reg(4)));

    const result = translated ? gpuQueueStallCheck(rt.mem, host) : rt.cpu.call(0x80027da0, []);

    return { result: result | 0, events, ports: [...ports],

        globals: [...rt.mem.bytes.slice(0x56000, 0x5603c)] };

}



test("gpuQueueStallCheck matches F0x80027DA0 guards, writes and device order", () => {

    const cases = [

        { name: "healthy", frame: 9, deadline: 10, iteration: 4, expected: 0 },

        { name: "deadline equality", frame: 10, deadline: 10, iteration: 0, expected: 0 },

        { name: "expired skips increment", frame: 11, deadline: 10, iteration: 7, expected: -1 },

        { name: "counter threshold equality", frame: 10, deadline: 10, iteration: 0xf0000, expected: 0 },

        { name: "counter threshold exceeded", frame: 10, deadline: 10, iteration: 0xf0001, expected: -1 },

        { name: "counter signed negative wraps", frame: 0, deadline: 1, iteration: 0xffffffff, expected: 0 },

        { name: "counter signed maximum", frame: 0, deadline: 1, iteration: 0x7fffffff, expected: -1 },

        { name: "negative deadline", frame: 0, deadline: 0xffffffff, iteration: 0, expected: -1 },

        { name: "negative frame", frame: 0x80000000, deadline: 0, iteration: 0, expected: 0 },

        { name: "backlog wraps and full-width mask", frame: 1, deadline: 0, iteration: 0,

            head: 0xffffffff, tail: 0x80000001, mask: 0xfedcba98, expected: -1 },

    ];

    for (const tc of cases) {

        const original = watchdogCase(tc, false);

        assert.equal(original.result, tc.expected, tc.name);

        assert.deepEqual(watchdogCase(tc, true), original, tc.name);

        assert.equal(original.events.filter(e => e[0] === "report").length, tc.expected === -1 ? 1 : 0, tc.name);

    }

});



// F0x80025D54 ClearOTagR (fns.s:23923-23963): a0 = OT, a1 = count. The

// interpreter stubs the same two boundaries the port receives: the debug

// dispatch pointer 0x80055ef4 and the function table's +0x2C callback.

const OTAG = 0x80084000;



function otagCase(tc, translated) {

    const { rt } = makeRt();

    const events = [];

    const table = 0x80085000, alternate = 0x80085100;

    const logger = 0x80085200, reset = 0x80085210, reset2 = 0x80085220;

    const otag = tc.alias ? CLEAR_OTAG_HEAD : OTAG;

    rt.mem.write8(GPU_DEBUG_LEVEL, tc.level);

    rt.mem.write32(GPU_DEBUG_DISPATCH, logger);

    rt.mem.write32(GPU_FUNCTION_TABLE, table);

    rt.mem.write32(table + 0x2c, reset);

    rt.mem.write32(alternate + 0x2c, reset2);

    for (let i = 0; i < 12; i++) rt.mem.write8(OTAG + i, 0xaa);

    rt.mem.write32(GPU_QUEUE_TAIL, 0x11223344);

    rt.mem.write32(CLEAR_OTAG_HEAD, 0x55667788);

    rt.mem.onWrite = (_pc, addr, size, value) => {

        if (addr >= 0x80055e00 && addr < 0x80055fc0 || addr >= OTAG && addr < OTAG + 12)

            events.push(["store", addr, size, value]);

    };

    function debug(target, a0, o, c) {

        assert.equal(target >>> 0, logger);

        events.push(["debug", target >>> 0, a0 >>> 0, o >>> 0, c | 0]);

        if (tc.swap) rt.mem.write32(GPU_FUNCTION_TABLE, alternate);

        return 0x12345678;

    }

    function callback(target, o, c) {

        events.push(["reset", target >>> 0, o >>> 0, c | 0]);

        rt.mem.write32(o, 0x77665544);

        return 0x5150;

    }

    rt.cpu.setStub(logger, c => {

        const result = debug(logger, c.reg(4), c.reg(5), c.reg(6));

        c.setReg(4, 0xdead); c.setReg(5, 0xbeef);

        return result;

    });

    for (const target of [reset, reset2])

        rt.cpu.setStub(target, c => callback(target, c.reg(4), c.reg(5)));

    const host = {

        debugDispatch(a0, o, c) { debug(rt.mem.read32(GPU_DEBUG_DISPATCH), a0, o, c); },

        reset(o, c) { callback(rt.mem.read32(rt.mem.read32(GPU_FUNCTION_TABLE) + 0x2c), o, c); },

    };

    const result = translated ? clearOtagR(rt.mem, otag, tc.count, host)

        : rt.cpu.call(0x80025d54, [otag, tc.count]);

    return { result: result | 0, events,

        tag: rt.mem.read32(CLEAR_OTAG_HEAD) >>> 0,

        untouched: rt.mem.read32(GPU_QUEUE_TAIL) >>> 0,

        otag: [...rt.mem.bytes.slice(OTAG & 0x1fffff, (OTAG & 0x1fffff) + 12)] };

}



test("clearOtagR matches F0x80025D54 dispatch, reset and fixed stores", () => {

    for (const level of [0, 1, 2, 255]) {

        for (const count of [0, 1, 3, 0x1f, -1, 0x80000000]) {

            for (const alias of [false, true]) {

                const tc = { level, count, alias, swap: true };

                const original = otagCase(tc, false);

                assert.deepEqual(otagCase(tc, true), original, JSON.stringify(tc));

                assert.equal(original.result, (alias ? CLEAR_OTAG_HEAD : OTAG) | 0);

                assert.equal(original.untouched, 0x11223344);

                assert.equal(original.tag, alias ? 0x00055fb8 : 0x04055fa4);

                assert.equal(original.events.filter(e => e[0] === "debug").length, level >= 2 ? 1 : 0);

                const reset = original.events.find(e => e[0] === "reset");

                assert.equal(reset[1], level >= 2 ? 0x80085220 : 0x80085210);

                assert.deepEqual(original.events.slice(-2), [

                    ["store", CLEAR_OTAG_HEAD, 4, 0x04055fa4],

                    ["store", alias ? CLEAR_OTAG_HEAD : OTAG, 4, 0x00055fb8],

                ]);

            }

        }

    }

});



// F0x80025868 drawSync (fns.s:23587-23614): the debug byte 0x80055efa gates
// the logger at [0x80055ef4] with (0x800103b4, original mode); the driver
// base [0x80055ef0] is loaded FRESH after any logging (the logger may mutate
// it), and base+0x3c is called with the original mode. The callee's v0 is
// returned unchanged. Both dynamic targets are stubbed identically on both
// sides; the wrapper body under test is the real 0x80025868.
const DRAWSYNC = 0x80025868;
const DRAWSYNC_LOG_TAG = 0x800103b4;
const DRAWSYNC_LOGGER = 0x80085300, DRAWSYNC_SYNC_BASE = 0x80085400;
const DRAWSYNC_SYNC = 0x80085600, DRAWSYNC_SYNC2 = 0x80085610;

function drawSyncCase(tc, translated) {
    const { rt } = makeRt();
    const events = [];
    rt.mem.write8(GPU_DEBUG_LEVEL, tc.level);
    rt.mem.write32(GPU_DEBUG_DISPATCH, DRAWSYNC_LOGGER);
    rt.mem.write32(GPU_FUNCTION_TABLE, DRAWSYNC_SYNC_BASE);
    rt.mem.write32(DRAWSYNC_SYNC_BASE + 0x3c, DRAWSYNC_SYNC);
    rt.mem.write32(0x80085500 + 0x3c, DRAWSYNC_SYNC2);
    const host = {
        debugLog(tag, mode) {
            events.push(["log", tag >>> 0, mode >>> 0]);
            if (tc.logSwapsBase) rt.mem.write32(GPU_FUNCTION_TABLE, 0x80085500);
        },
        driverSync(target, mode) {
            events.push(["sync", target >>> 0, mode >>> 0]);
            return tc.syncReturn | 0;
        },
    };
    rt.cpu.setStub(DRAWSYNC_LOGGER, c => {
        host.debugLog(c.reg(4), c.reg(5));
        c.setReg(4, 0xdead); c.setReg(5, 0xbeef);
        return 0xabcdef;
    });
    for (const target of [DRAWSYNC_SYNC, DRAWSYNC_SYNC2]) {
        rt.cpu.setStub(target, c => host.driverSync(target, c.reg(4)));
    }
    const result = translated ? drawSync(rt.mem, tc.mode, host)
        : rt.cpu.call(DRAWSYNC, [tc.mode >>> 0]);
    return { result: result | 0, events, base: rt.mem.read32(GPU_FUNCTION_TABLE) >>> 0 };
}

test("drawSync matches F0x80025868 logging, fresh base and return", () => {
    const cases = [
        { name: "debug 0, mode 0", level: 0, mode: 0, syncReturn: 0 },
        { name: "debug 1 skipped, negative mode", level: 1, mode: -1, syncReturn: -2 },
        { name: "debug 2 logs, mode 1", level: 2, mode: 1, syncReturn: 0x1234 },
        { name: "debug 255 logs, large mode", level: 255, mode: 0x80000000, syncReturn: -1 },
        { name: "logging swaps callback table", level: 2, mode: 3,
            syncReturn: 0x51, logSwapsBase: true },
    ];
    for (const tc of cases) {
        const original = drawSyncCase(tc, false);
        assert.equal(original.result, tc.syncReturn | 0, tc.name);
        assert.deepEqual(drawSyncCase(tc, true), original, tc.name);
        const expected = [["sync", tc.logSwapsBase ? DRAWSYNC_SYNC2 : DRAWSYNC_SYNC, tc.mode >>> 0]];
        if (tc.level >= 2) expected.unshift(["log", DRAWSYNC_LOG_TAG, tc.mode >>> 0]);
        assert.deepEqual(original.events, expected, tc.name);
    }
});

// F0x80027C30 gpuQueuePoll (fns.s:26003-26081): the ring head/tail cells
// D0x80056020/D0x80056024, the DMA2/GPU pointer cells D0x8005600c/D0x80056000
// and the two readiness bits (DMA2 CHCR 0x01000000 clear, GPUSTAT 0x04000000
// set). set_alarm (0x80027d6c), the queue drain (0x80027894) and the watchdog
// (0x80027da0) are scripted identically on both sides; the target body is the
// thing under test. Reads of the two device words are ordered events, so an
// arm that polls in the wrong order or skips the second device fails.
const Q_HEAD = 0x80056020, Q_TAIL = 0x80056024;
const POLL_DRAIN = 0x80027894;

function pollCase(tc, translated) {
    const { rt } = makeRt();
    const events = [];
    const dma = 0x1f8010a8, gpu = 0x1f801810;
    rt.mem.write32(0x8005600c, dma);
    rt.mem.write32(0x80056000, gpu);
    rt.mem.write32(Q_HEAD, tc.head >>> 0);
    rt.mem.write32(Q_TAIL, tc.tail >>> 0);
    let polls = 0;
    rt.mem.devices = {
        read(addr) {
            if (addr !== dma && addr !== gpu) return undefined;
            const bit = addr === dma ? 0x01000000 : 0x04000000;
            const busy = tc.busySeq?.[Math.min(polls, tc.busySeq.length - 1)] ?? false;
            events.push(["devread", addr === dma ? "dma" : "gpu", busy ? 1 : 0]);
            return addr === dma ? (busy ? bit : 0) : (busy ? 0 : bit);
        },
        write() { return false; },
    };
    rt.mem.onWrite = (_pc, addr, size, value) => {
        if (addr >= 0x80056020 && addr < 0x80056028) events.push(["store", addr, size, value >>> 0]);
    };
    rt.cpu.setStub(POLL_DRAIN, () => {
        events.push(["drain"]);
        if (tc.drainEmpties) rt.mem.write32(Q_TAIL, rt.mem.read32(Q_HEAD));
        return 0x51;
    });
    rt.cpu.setStub(SET_ALARM, () => { events.push(["alarm"]); return 0x1234; });
    rt.cpu.setStub(0x80027da0, () => {
        const r = tc.watchdogSeq?.[Math.min(hostWatchdogs, (tc.watchdogSeq?.length ?? 1) - 1)] ?? 0;
        events.push(["watchdog", r | 0]);
        return r >>> 0;
    });
    let hostDrains = 0, hostWatchdogs = 0;
    const host = {
        setAlarm() { events.push(["alarm"]); },
        drain() {
            hostDrains++;
            events.push(["drain"]);
            if (tc.drainEmpties) rt.mem.write32(Q_TAIL, rt.mem.read32(Q_HEAD));
        },
        watchdog() {
            const r = tc.watchdogSeq?.[Math.min(hostWatchdogs, (tc.watchdogSeq?.length ?? 1) - 1)] ?? 0;
            hostWatchdogs++;
            events.push(["watchdog", r | 0]);
            return r | 0;
        },
    };
    void polls;
    const result = translated ? gpuQueuePoll(rt.mem, tc.mode, host)
        : rt.cpu.call(0x80027c30, [tc.mode >>> 0]);
    return { result: result | 0, events,
        globals: [...rt.mem.bytes.slice(0x56020, 0x56028)] };
}

test("gpuQueuePoll matches F0x80027C30 over both modes", () => {
    const cases = [
        { name: "blocking, ring empty, device ready", mode: 0, head: 8, tail: 8, expected: 0 },
        { name: "blocking, backlog drains, then ready", mode: 0, head: 8, tail: 3, drainEmpties: true, expected: 0 },
        { name: "blocking, watchdog recovers mid-drain", mode: 0, head: 8, tail: 3, watchdogSeq: [-1], expected: -1 },
        { name: "nonblocking, backlog drains to ready", mode: 1, head: 8, tail: 3, drainEmpties: true, expected: 5 },
        { name: "nonblocking, empty ring with busy device", mode: 1, head: 8, tail: 8, busySeq: [true], expected: 1 },
    ];
    for (const tc of cases) {
        const original = pollCase(tc, false);
        assert.equal(original.result, tc.expected, `${tc.name}: original result`);
        assert.deepEqual(pollCase(tc, true), original, tc.name);
    }
});

// Queue drain: same scripted hardware/callback boundaries on both sides.
function drainCase(tc, translated) {
    const { rt } = makeRt();
    const events = [];
    const dma = 0x1f8010a8, gpu = 0x1f801810;
    const command = 0x80170000, complete = 0x80170010;
    for (const [a,v] of [[0x8005600c,dma],[0x80056000,gpu],
        [Q_HEAD,tc.head],[Q_TAIL,tc.tail],[0x8005602c,0xaaaa],
        [0x80055f00,tc.active ?? 1],[0x80055f04,tc.callback === false ? 0 : complete]]) rt.mem.write32(a,v);
    for (let i = 0; i < 64; i++) {
        rt.mem.write32(0x8007fa00 + i * 0x60, command);
        rt.mem.write32(0x8007fa04 + i * 0x60, i);
        rt.mem.write32(0x8007fa08 + i * 0x60, 0x1000 + i);
    }
    let busy = tc.busy ?? false, reads = 0, commands = 0;
    rt.mem.devices = {
        read(addr) {
            if (addr !== dma && addr !== gpu) return undefined;
            assert.ok(++reads < 100, 'bounded device polling');
            const value = addr === dma ? (busy ? 0x01000000 : 0) : 0x04000000;
            events.push(['read', addr, value]);
            return value;
        },
        write() { return false; },
    };
    rt.mem.onWrite = (_pc, addr, size, value) => {
        if ([Q_HEAD,Q_TAIL,0x8005602c,0x80055f00].includes(addr))
            events.push(['store', addr, size, value >>> 0]);
    };
    const host = {
        setIntrMask(mask) { events.push(['mask', mask >>> 0]); return 0x1234; },
        dmaCallback(channel, callback) { events.push(['dmaCallback', channel, callback]); },
        command(target, arg0, arg1) {
            assert.ok(++commands < 65, 'bounded queue dispatch');
            events.push(['command', target >>> 0, arg0 >>> 0, arg1 >>> 0]);
            if (tc.busyAfterCommand) busy = true;
            if (tc.moveTail) rt.mem.write32(Q_TAIL, (rt.mem.read32(Q_TAIL) + 1) & 63);
        },
        complete(target, arg0) {
            events.push(['complete', target >>> 0, arg0 >>> 0]);
            if (tc.enqueueOnComplete) rt.mem.write32(Q_HEAD, (rt.mem.read32(Q_HEAD) + 1) & 63);
        },
    };
    rt.cpu.setStub(0x8002eb98, c => host.setIntrMask(c.reg(4)));
    rt.cpu.setStub(0x8002ea7c, c => { host.dmaCallback(c.reg(4), c.reg(5)); return 0; });
    rt.cpu.setStub(command, c => { host.command(command, c.reg(4), c.reg(5)); return 0; });
    rt.cpu.setStub(complete, c => { host.complete(complete, c.reg(4)); return 0; });
    const result = translated ? gpuQueueDrain(rt.mem, host) : rt.cpu.call(POLL_DRAIN, []);
    return { result: result | 0, events, head: rt.mem.read32(Q_HEAD),
        tail: rt.mem.read32(Q_TAIL), active: rt.mem.read32(0x80055f00) };
}

test('gpuQueueDrain matches interpreter busy exits, dispatch order and callback mutations', () => {
    const cases = [
        { name: 'busy leaves queue untouched', head: 3, tail: 0, busy: true, remaining: 3, dispatched: [] },
        { name: 'drains three items', head: 3, tail: 0, remaining: 0, dispatched: [0, 1, 2] },
        { name: 'wrap and unregister last DMA callback', head: 1, tail: 63, callback: false, remaining: 0, dispatched: [63, 0] },
        { name: 'command makes DMA busy', head: 3, tail: 0, busyAfterCommand: true, remaining: 2, dispatched: [0] },
        { name: 'empty active queue completes', head: 5, tail: 5, remaining: 0, dispatched: [] },
        { name: 'inactive queue skips completion', head: 5, tail: 5, active: 0, remaining: 0, dispatched: [] },
        { name: 'completion enqueues work', head: 1, tail: 0, enqueueOnComplete: true, remaining: 1, dispatched: [0] },
        { name: 'dispatch changes tail before increment', head: 4, tail: 0, moveTail: true, remaining: 0, dispatched: [0, 2] },
    ];
    for (const tc of cases) {
        const original = drainCase(tc, false);
        assert.deepEqual(drainCase(tc, true), original, tc.name);
        assert.equal((original.head - original.tail) & 63, tc.remaining, tc.name);
        assert.deepEqual(original.events.filter(e => e[0] === 'command').map(e => e[2]), tc.dispatched, tc.name);
        assert.equal(original.result, tc.busy ? 1 : tc.remaining, tc.name);
        assert.equal(original.events.some(e => e[0] === 'complete'),
            !tc.busy && !tc.busyAfterCommand && tc.callback !== false && tc.active !== 0, tc.name);
    }
});

const SEND = 0x800275e4;
const SEND_WORKER = 0x80170000;
const SEND_BUFFER = 0x80160000;

function sendCase(tc, translated) {
    const { rt } = makeRt();
    const events = [];
    const dma = 0x1f8010a8, gpu = 0x1f801810;
    rt.mem.write32(0x8005600c, dma);
    rt.mem.write32(0x80056000, gpu);
    rt.mem.write32(Q_HEAD, (tc.head ?? 0) >>> 0);
    rt.mem.write32(Q_TAIL, (tc.tail ?? 0) >>> 0);
    rt.mem.write32(0x80056028, 0xaaaa);
    rt.mem.write8(0x80055ef9, tc.queueByte ?? 0);
    rt.mem.write32(0x80055f00, tc.active ?? 0);
    rt.mem.write32(0x80055f04, tc.callbackCell ?? 0);
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(SEND_BUFFER + i, 0x1000 + i);
    let dmaBusy = tc.dmaBusy ?? false, gpuReady = tc.gpuReady !== false, reads = 0;
    rt.mem.devices = {
        read(addr) {
            if (addr !== dma && addr !== gpu) return undefined;
            assert.ok(++reads < 100, "bounded device polling");
            const value = addr === dma ? (dmaBusy ? 0x01000000 : 0) : (gpuReady ? 0x04000000 : 0);
            events.push(["read", addr === dma ? "dma" : "gpu", value]);
            if (addr === gpu && !gpuReady) gpuReady = true;
            return value;
        },
        write() { return false; },
    };
    rt.mem.onWrite = (_pc, addr, size, value) => {
        if ([Q_HEAD, Q_TAIL, 0x80056028, 0x80055f00].includes(addr)
            || (addr >= 0x8007fa00 && addr < 0x8007fa00 + 64 * 0x60))
            events.push(["store", addr >>> 0, size, value >>> 0]);
    };
    let watchdogs = 0;
    const host = {
        setAlarm() { events.push(["alarm"]); },
        watchdog() {
            const r = tc.watchdogSeq?.[Math.min(watchdogs, (tc.watchdogSeq?.length ?? 1) - 1)] ?? 0;
            watchdogs++;
            events.push(["watchdog", r | 0]);
            return r | 0;
        },
        drain() {
            events.push(["drain"]);
            if (tc.drainFrees) rt.mem.write32(Q_TAIL, (rt.mem.read32(Q_TAIL) + 1) & 0x3f);
        },
        setIntrMask(mask) { events.push(["mask", mask >>> 0]); return 0x1234; },
        dmaCallback(channel, callback) { events.push(["dmaCallback", channel, callback >>> 0]); },
        command(target, arg0, arg1) {
            events.push(["command", target >>> 0, arg0 >>> 0, arg1 >>> 0]);
        },
    };
    rt.cpu.setStub(SET_ALARM, () => { host.setAlarm(); return 0; });
    rt.cpu.setStub(0x80027da0, () => host.watchdog() >>> 0);
    rt.cpu.setStub(POLL_DRAIN, () => { host.drain(); return 0; });
    rt.cpu.setStub(0x8002eb98, c => host.setIntrMask(c.reg(4)));
    rt.cpu.setStub(0x8002ea7c, c => { host.dmaCallback(c.reg(4), c.reg(5)); return 0; });
    rt.cpu.setStub(SEND_WORKER, c => { host.command(SEND_WORKER, c.reg(4), c.reg(5)); return 0; });
    const extra = tc.extra ?? 0x55;
    const bytes = tc.bytes ?? 0;
    const result = translated
        ? gpuQueueSend(rt.mem, SEND_WORKER, SEND_BUFFER, bytes, extra, host)
        : rt.cpu.call(SEND, [SEND_WORKER, SEND_BUFFER, bytes, extra]);
    const head = rt.mem.read32(Q_HEAD) >>> 0;
    const published = (head + 63) & 0x3f;
    const slot = [];
    for (let i = 0; i < 0x10; i += 4) slot.push(rt.mem.read32(0x8007fa00 + published * 0x60 + i) >>> 0);
    return {
        result: result | 0, events, head, tail: rt.mem.read32(Q_TAIL) >>> 0,
        maskSaved: rt.mem.read32(0x80056028) >>> 0, active: rt.mem.read32(0x80055f00) >>> 0, slot,
    };
}

test("gpuQueueSend matches F0x800275e4 guards, copy and drain", () => {
    const cases = [
        { name: "immediate via queue-mode byte 0", queueByte: 0, head: 4, tail: 4 },
        { name: "immediate via empty ready ring", queueByte: 1, head: 2, tail: 2, callbackCell: 0 },
        { name: "queue because ring is not empty", queueByte: 1, head: 5, tail: 3, bytes: 8 },
        { name: "queue because DMA is busy", queueByte: 1, head: 2, tail: 2, dmaBusy: true, bytes: 4 },
        { name: "queue because completion cell is set", queueByte: 1, head: 2, tail: 2, callbackCell: 0x80170010, bytes: 0 },
        { name: "full ring watchdog abort", head: 5, tail: 6, watchdogSeq: [-1] },
        { name: "full ring retry then immediate", queueByte: 0, head: 5, tail: 6, watchdogSeq: [0], drainFrees: true },
        { name: "zero-byte keeps caller pointer", queueByte: 1, head: 1, tail: 0, bytes: 0 },
        { name: "one-byte copies no words, internal pointer", queueByte: 1, head: 1, tail: 0, bytes: 1 },
        { name: "three-byte copies no words", queueByte: 1, head: 1, tail: 0, bytes: 3 },
        { name: "four-byte copies one word", queueByte: 1, head: 1, tail: 0, bytes: 4 },
        { name: "64-byte copy", queueByte: 1, head: 1, tail: 0, bytes: 0x40 },
        { name: "negative one copies no words", queueByte: 1, head: 1, tail: 0, bytes: -1 },
        { name: "negative four copies no words", queueByte: 1, head: 1, tail: 0, bytes: -4 },
        { name: "wrap publish at 63", queueByte: 1, head: 63, tail: 1, bytes: 8 },
        { name: "drain mutates tail before return count", queueByte: 1, head: 4, tail: 2, bytes: 8, drainFrees: true },
        { name: "immediate GPU spin then ready", queueByte: 0, head: 0, tail: 0, gpuReady: false },
    ];
    for (const tc of cases) {
        const original = sendCase(tc, false);
        assert.deepEqual(sendCase(tc, true), original, tc.name);
    }
});
