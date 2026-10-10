// Phase 4 oracle: engine/dw3/ui/wizard-anim.ts must match pro/stplnmet's two
// wizard animation families. Family C is F0x80083748 (create) and F0x800835F0
// (tick, table dwell); family B is F0x800835C4 (create) and F0x800833E8 (tick,
// frame step). The original runs through engine/native with the draw-context
// methods, the pack resolver and the advance method stubbed; the port uses an
// equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    wizardTableDwellCreate,
    wizardTableDwellTick,
    wizardFrameStepCreate,
    wizardFrameStepTick,
    wizardIntroCreate,
    wizardIntroSetup,
    wizardIntroSetLayer,
    wizardIntroTick,
    wizardPortraitDraw,
    wizardChromeCreate,
    wizardChromeTick,
} from "../engine/dw3/ui/wizard-anim.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stplnmet = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stplnmet.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const PACK_STUB = 0x0fe60000;
const PACK_PTR = 0x80190000;
const ADV_STATE = 0x800142ac;
const CTX_PAIR_24 = 0x0fe60010;
const CTX_BIND_2C = 0x0fe60020;
const FRAME = 5000;
const ARITY = { setOrigin: 2, setLayer: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };

let EVENTS = [];
let DRAW = [];

function runtime() {
    const rt = new NativeStageRuntime(stplnmet, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8004de20, FRAME);
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        return OBJ;
    });
    rt.cpu.setStub(PACK_STUB, () => PACK_PTR);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    // Canonical context boundary (same as tests/wizard-root-oracle.test.js):
    // F0x8001FFA8 installs the two text slots the intro setup calls, and the
    // slot stubs record the pair / the layout pointer.
    rt.cpu.setStub(0x8001ffa8, (c) => {
        const ctx = c.reg(4) >>> 0;
        rt.mem.write32(ctx + 0x24, CTX_PAIR_24);
        rt.mem.write32(ctx + 0x2c, CTX_BIND_2C);
        EVENTS.push(["ctxInstall"]);
        return 0;
    });
    rt.cpu.setStub(CTX_PAIR_24, (c) => { EVENTS.push(["ctx", 0x24, c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(CTX_BIND_2C, (c) => { EVENTS.push(["ctx", 0x2c, c.reg(4)]); return 0; });
    rt.cpu.setStub(ADV_STATE, (c) => {
        const o = c.reg(4);
        const v = (rt.mem.read32(o + 0xc) + 1) | 0;
        rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        rt.mem.write32(o + 0xc, v);
        EVENTS.push(["advance", o]);
        return v;
    });
    return rt;
}

const rt = runtime();

function seed(o) {
    EVENTS = [];
    DRAW = [];
    rt.mem.write32(0x8004de20, o.frame ?? FRAME);
    for (let i = 0; i < 0x68; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x38, ADV_STATE);
    rt.mem.write32(OBJ + 0x0c, o.state ?? 0);
    rt.mem.write32(OBJ + 0x60, o.index ?? 0);
    rt.mem.write32(OBJ + 0x64, o.stamp ?? 0);
}

function fields() {
    return [0x0c, 0x60, 0x64].map((off) => rt.mem.read32(OBJ + off) >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        allocAnim(h, s, e) { EVENTS.push(["alloc", h, s, e]); return OBJ; },
        advance(o) {
            const v = (rt.mem.read32(o + 0xc) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0xc, v);
            EVENTS.push(["advance", o]);
        },
        initDrawContext() {},
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setScale(sx, sy, sz) { DRAW.push(["setScale", [sx, sy, sz, 0]]); },
        setPos(x, y) { DRAW.push(["setPos", [x, y, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
        frameTick() { return rt.mem.read32(0x8004de20) | 0; },
    };
}

/** Run one tick through the original and the ported function, compare all. */
function compareTick(label, o, handler, port, portArgs) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(handler, [OBJ]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = fields();

    seed(o);
    port(...portArgs);
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(normDraw(DRAW), oracleDraw, `${label}: draw`);
    assert.deepEqual(fields(), oracleFields, `${label}: fields`);
}

function runTick(label, o) {
    compareTick(label, o, 0x800835f0, wizardTableDwellTick, [rt.mem, OBJ, portHost()]);
}

function runFrameTick(label, o) {
    compareTick(label, o, 0x800833e8, wizardFrameStepTick, [rt.mem, OBJ, portHost()]);
}

function compareCreate(label, handler, port) {
    seed({});
    EVENTS = [];
    rt.cpu.call(handler, []);
    const oracleAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    seed({});
    EVENTS = [];
    const obj = port(rt.mem, { allocAnim(h, s, e) { EVENTS.push(["alloc", h, s, e]); return OBJ; } });
    assert.equal(obj, OBJ);
    assert.deepEqual(norm(EVENTS.filter((e) => e[0] === "alloc")), oracleAlloc, "alloc");
}

test("wizardTableDwellCreate matches F0x80083748", () => {
    compareCreate("table-dwell create", 0x80083748, wizardTableDwellCreate);
});

test("wizardTableDwellTick matches F0x800835F0", () => {
    runTick("state 0 advances", { state: 0 });
    runTick("state 4 advances", { state: 4 });
    runTick("state 2 idle", { state: 2 });
    runTick("state 3 idle", { state: 3 });
    runTick("index advances", { state: 1, index: 0, stamp: FRAME - 10 });
    runTick("threshold not met", { state: 1, index: 0, stamp: FRAME - 2 });
    runTick("high threshold held", { state: 1, index: 9, stamp: FRAME - 50 });
    runTick("high threshold passed", { state: 1, index: 9, stamp: FRAME - 100 });
    runTick("wraps at terminator", { state: 1, index: 27, stamp: FRAME - 10 });
    runTick("wraps from mid", { state: 1, index: 17, stamp: FRAME - 10 });
});

test("wizardFrameStepCreate matches F0x800835C4", () => {
    compareCreate("frame-step create", 0x800835c4, wizardFrameStepCreate);
});

test("wizardFrameStepTick matches F0x800833E8", () => {
    runFrameTick("state 0 resets and advances", { state: 0 });
    runFrameTick("state 4 resets and advances", { state: 4 });
    runFrameTick("state 5 resets and advances", { state: 5 });
    runFrameTick("state 2 idle", { state: 2 });
    runFrameTick("state 3 idle", { state: 3 });
    runFrameTick("dwell held", { state: 1, index: 0x18, stamp: FRAME - 2 });
    runFrameTick("dwell boundary holds", { state: 1, index: 0x18, stamp: FRAME - 4 });
    runFrameTick("steps once", { state: 1, index: 0x18, stamp: FRAME - 10 });
    runFrameTick("steps to last", { state: 1, index: 0x22, stamp: FRAME - 5 });
    runFrameTick("wraps at last", { state: 1, index: 0x23, stamp: FRAME - 10 });
    runFrameTick("wraps from beyond", { state: 1, index: 0x30, stamp: FRAME - 10 });
});

// --- family A (intro / entry animation) ------------------------------------

const INTRO_TABLE = 0x800885e4;
const INTRO_TABLE_VIEW = new DataView(stplnmet.buffer, stplnmet.byteOffset, stplnmet.byteLength);
const INTRO_TABLE_OFF = INTRO_TABLE - 0x80082cb0;
/** The table as shipped in the overlay: {-176, -190}. */
const INTRO_TABLE_REAL = [
    INTRO_TABLE_VIEW.getInt32(INTRO_TABLE_OFF, true),
    INTRO_TABLE_VIEW.getInt32(INTRO_TABLE_OFF + 4, true),
];

function seedIntro(o = {}) {
    EVENTS = [];
    DRAW = [];
    rt.mem.write32(0x8004de20, o.frame ?? FRAME);
    for (let i = 0; i < 0x84; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x38, ADV_STATE);
    rt.mem.write32(OBJ + 0x0c, o.state ?? 0);
    rt.mem.write32(OBJ + 0x50, o.originX ?? 0x40);
    rt.mem.write32(OBJ + 0x54, o.originY ?? 0x50);
    rt.mem.write32(OBJ + 0x58, o.enabled ?? 0);
    rt.mem.write32(OBJ + 0x5c, o.layerTarget ?? 0x1001);
    rt.mem.write32(OBJ + 0x60, o.layerBucket ?? 6);
    rt.mem.write32(OBJ + 0x64, o.stamp0 ?? 0);
    rt.mem.write32(OBJ + 0x68, o.stamp1 ?? 0);
    rt.mem.write32(OBJ + 0x6c, o.elem0X ?? 100);
    rt.mem.write32(OBJ + 0x70, o.elem0Y ?? 200);
    rt.mem.write32(OBJ + 0x74, o.elem1X ?? 50);
    rt.mem.write32(OBJ + 0x78, o.elem1Y ?? 60);
    rt.mem.write32(INTRO_TABLE + 0, INTRO_TABLE_REAL[0] >>> 0);
    rt.mem.write32(INTRO_TABLE + 4, INTRO_TABLE_REAL[1] >>> 0);
    if (o.table0 !== undefined) rt.mem.write32(INTRO_TABLE + 0, o.table0);
    if (o.table1 !== undefined) rt.mem.write32(INTRO_TABLE + 4, o.table1);
}

function introFields() {
    return [0x0c, 0x50, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x74, 0x78]
        .map((off) => rt.mem.read32(OBJ + off) >>> 0);
}

function portIntroHost() {
    return {
        allocAnim(h, s, e) { EVENTS.push(["alloc", h, s, e]); return OBJ; },
        advance(o) {
            const v = (rt.mem.read32(o + 0xc) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0xc, v);
            EVENTS.push(["advance", o]);
        },
        initDrawContext() {},
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setScale(sx, sy, sz) { DRAW.push(["setScale", [sx, sy, sz, 0]]); },
        setPos(x, y) { DRAW.push(["setPos", [x, y, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
        frameTick() { return rt.mem.read32(0x8004de20) | 0; },
        installStandardContext() { EVENTS.push(["ctxInstall"]); return 0; },
        contextCall(slot, a, b) {
            if (slot === 0x2c) EVENTS.push(["ctx", slot, a >>> 0]);
            else EVENTS.push(["ctx", slot, a >>> 0, b]);
        },
    };
}

function compareIntroTick(label, o) {
    seedIntro(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80083144, [OBJ]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = introFields();

    seedIntro(o);
    wizardIntroTick(rt.mem, OBJ, portIntroHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(normDraw(DRAW), oracleDraw, `${label}: draw`);
    assert.deepEqual(introFields(), oracleFields, `${label}: fields`);
}

test("wizardIntroCreate matches F0x800833A4", () => {
    seedIntro();
    rt.cpu.call(0x800833a4, []);
    const oracleAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const oracleSlots = [rt.mem.read32(OBJ + 0x7c) >>> 0, rt.mem.read32(OBJ + 0x80) >>> 0];

    seedIntro();
    const obj = wizardIntroCreate(rt.mem, portIntroHost());
    assert.equal(obj, OBJ);
    assert.deepEqual(norm(EVENTS.filter((e) => e[0] === "alloc")), oracleAlloc, "alloc");
    assert.deepEqual([rt.mem.read32(OBJ + 0x7c) >>> 0, rt.mem.read32(OBJ + 0x80) >>> 0],
        oracleSlots, "slots");
});

test("wizardIntroSetup matches F0x80083310 and wizardIntroSetLayer matches F0x80083398", () => {
    for (const [a1, a2] of [[0x1111, 0x2222], [0, 0], [0xfffffffe, 7]]) {
        seedIntro();
        rt.cpu.call(0x80083310, [OBJ, a1, a2]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleFields = introFields();

        seedIntro();
        wizardIntroSetup(rt.mem, OBJ, a1, a2, portIntroHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `setup ${a1},${a2}: calls`);
        assert.deepEqual(introFields(), oracleFields, `setup ${a1},${a2}: fields`);
    }

    seedIntro();
    rt.cpu.call(0x80083398, [OBJ, 0x1234, 0x5678]);
    const oracleFields = introFields();
    seedIntro();
    wizardIntroSetLayer(rt.mem, OBJ, 0x1234, 0x5678);
    assert.deepEqual(introFields(), oracleFields, "setLayer: fields");
});

test("wizardIntroTick matches F0x80083144", () => {
    compareIntroTick("state 0 disabled", { state: 0, enabled: 0 });
    compareIntroTick("state 0 enabled stamps and advances", { state: 0, enabled: 1 });
    compareIntroTick("state 2 idle", { state: 2, enabled: 1 });
    compareIntroTick("state 3 idle", { state: 3, enabled: 1 });
    compareIntroTick("state 4 enabled stamps and advances", { state: 4, enabled: 1 });
    compareIntroTick("state 1 element 0 steps", { state: 1, stamp0: FRAME - 2, stamp1: FRAME - 2 });
    compareIntroTick("state 1 element 1 steps", { state: 1, stamp0: FRAME - 1, stamp1: FRAME - 5 });
    compareIntroTick("state 1 no element steps", { state: 1, stamp0: FRAME - 1, stamp1: FRAME - 2 });
    compareIntroTick("state 1 table resets element 0", { state: 1, stamp0: FRAME - 10, stamp1: FRAME - 10, table0: 1000 });
    compareIntroTick("state 1 table keeps element 1", { state: 1, stamp0: FRAME - 10, stamp1: FRAME - 10, table1: 1000 });
    compareIntroTick("state 1 zero positions", { state: 1, stamp0: FRAME - 10, stamp1: FRAME - 10, elem0X: 1, elem0Y: 0, elem1X: 0, elem1Y: 0, table0: 0 });
    // Real table, as shipped in the overlay: {-176, -190}.
    compareIntroTick("state 1 real table no reset", { state: 1, stamp0: FRAME - 10, stamp1: FRAME - 10 });
    compareIntroTick("state 1 real table resets element 1", { state: 1, stamp0: FRAME - 10, stamp1: FRAME - 10, elem1X: -189 });
    compareIntroTick("state 1 real table keeps element 1 above threshold", { state: 1, stamp0: FRAME - 10, stamp1: FRAME - 10, elem1X: -185 });
});

test("the shipped intro threshold table is the decoded {-176, -190}", () => {
    assert.equal(INTRO_TABLE_REAL[0], -176, "threshold[0]");
    assert.equal(INTRO_TABLE_REAL[1], -190, "threshold[1]");
});

test("the real table's reset boundary is observable in the original", () => {
    // threshold[1] = -190; step x -= 2, reset when threshold >= new x.
    // elem1X = -189 -> -191 <= -190 -> reset; elem1X = -185 -> -187 keeps.
    seedIntro({ state: 1, stamp0: FRAME - 10, stamp1: FRAME - 10, elem1X: -189, elem1Y: 60 });
    rt.cpu.call(0x80083144, [OBJ]);
    assert.equal(rt.mem.read32(OBJ + 0x74) | 0, 0, "reset x");
    assert.equal(rt.mem.read32(OBJ + 0x78) | 0, 0, "reset y");
    assert.equal(rt.mem.read32(OBJ + 0x68) >>> 0, FRAME, "restamped");

    seedIntro({ state: 1, stamp0: FRAME - 10, stamp1: FRAME - 10, elem1X: -185, elem1Y: 60 });
    rt.cpu.call(0x80083144, [OBJ]);
    assert.equal(rt.mem.read32(OBJ + 0x74) | 0, -187, "stepped x");
    assert.equal(rt.mem.read32(OBJ + 0x78) | 0, 61, "stepped y");
});

// --- portrait draw (F0x80088070) -------------------------------------------

function seedPortrait(o = {}) {
    EVENTS = [];
    DRAW = [];
    for (let i = 0; i < 0x68; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x50, o.layerTarget ?? 0x1001);
    rt.mem.write32(OBJ + 0x54, o.bucket ?? 6);
    rt.mem.write32(OBJ + 0x58, o.clip ?? 0);
    rt.mem.write32(OBJ + 0x64, o.scale ?? 0x1000);
}

function comparePortrait(label, o) {
    seedPortrait(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80088070, [OBJ]);
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;

    seedPortrait(o);
    wizardPortraitDraw(rt.mem, OBJ, portIntroHost());
    assert.deepEqual(normDraw(DRAW), oracleDraw, `${label}: draw`);
}

test("wizardPortraitDraw matches F0x80088070", () => {
    comparePortrait("scale zero hides", { scale: 0 });
    comparePortrait("unit scale draws", { scale: 0x1000, clip: 4 });
    comparePortrait("half scale scales and positions", { scale: 0x800, clip: 7 });
    comparePortrait("other layer", { scale: 0x1000, clip: 0x10, layerTarget: 0x1002, bucket: 3 });
});

// --- wizard chrome (F0x80083D38 create / F0x80083774 tick) -----------------

const CHROME_OBJ = 0x801d0000;
const CHROME_ARG1 = 0x801e0000;
const WIDGET_A = 0x801f0000;
const WIDGET_B = 0x801f1000;
const RESOURCE_BASE = 0x801f2000;
const CHROME = {
    method28: 0x0fe90000, method2c: 0x0fe90010, method38: 0x0fe90020,
    widgetSlots: { page: 0x0fe90030, line: 0x0fe90040, colour: 0x0fe90050, typewriter: 0x0fe90060,
        callback: 0x0fe90070, speed: 0x0fe90080, pos: 0x0fe90090, busy: 0x0fe900a0,
        state: 0x0fe900b0, flag: 0x0fe900c0, reveal: 0x0fe900d0 },
    resource: 0x0fe900e0, pad: 0x0fe900f0, padShift: 0x0fe90100, pack: 0x0fe90110,
};
const CHROME_PAD_PTR = 0x8004b7d0 + 0x3f4;
const CHROME_PAD_SHIFT_PTR = 0x8004b7d0 + 0x408;

let CHROME_MODE = {};
let WIDGET_CALLS = 0;

function chromeRuntime() {
    const rt = new NativeStageRuntime(stplnmet, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        return CHROME_OBJ;
    });
    rt.cpu.setStub(CHROME.pack, () => PACK_PTR);
    rt.mem.write32(0x80044f5c, CHROME.pack);
    rt.cpu.setStub(0x8001ae38, (c) => {
        const w = WIDGET_CALLS === 0 ? WIDGET_A : WIDGET_B;
        WIDGET_CALLS += 1;
        EVENTS.push(["createWidget", c.reg(4), c.reg(5), c.reg(6), c.reg(7), w >>> 0]);
        for (const [off, addr] of [[0x160, CHROME.widgetSlots.page], [0x114, CHROME.widgetSlots.line],
            [0x138, CHROME.widgetSlots.colour], [0x144, CHROME.widgetSlots.typewriter],
            [0x150, CHROME.widgetSlots.callback], [0x130, CHROME.widgetSlots.speed],
            [0x134, CHROME.widgetSlots.pos], [0x168, CHROME.widgetSlots.busy],
            [0x170, CHROME.widgetSlots.state], [0x16c, CHROME.widgetSlots.flag],
            [0x128, CHROME.widgetSlots.reveal]]) {
            rt.mem.write32(w + off, addr);
        }
        return w;
    });
    const slot = (addr, name, arity) => rt.cpu.setStub(addr, (c) => {
        EVENTS.push([name, ...[c.reg(4), c.reg(5), c.reg(6)].slice(0, arity)]);
        return 0;
    });
    slot(CHROME.widgetSlots.page, "widgetPageLines", 2);
    slot(CHROME.widgetSlots.line, "widgetResourceLine", 3);
    slot(CHROME.widgetSlots.colour, "widgetColourRow", 2);
    slot(CHROME.widgetSlots.typewriter, "widgetTypewriter", 2);
    slot(CHROME.widgetSlots.callback, "widgetCallback", 2);
    slot(CHROME.widgetSlots.speed, "widgetSpeed", 2);
    slot(CHROME.widgetSlots.pos, "widgetPos", 3);
    rt.cpu.setStub(CHROME.widgetSlots.busy, (c) => { EVENTS.push(["widgetBusy", c.reg(4)]); return CHROME_MODE.busy ?? 0; });
    rt.cpu.setStub(CHROME.widgetSlots.state, (c) => { EVENTS.push(["widgetState", c.reg(4)]); return CHROME_MODE.state ?? 0; });
    rt.cpu.setStub(CHROME.widgetSlots.flag, (c) => { EVENTS.push(["widgetFlag", c.reg(4)]); return CHROME_MODE.flag ?? 0; });
    rt.cpu.setStub(CHROME.widgetSlots.reveal, (c) => { EVENTS.push(["widgetReveal", c.reg(4)]); return 0; });
    rt.cpu.setStub(CHROME.resource, (c) => { EVENTS.push(["resourceGetBase", c.reg(4)]); return RESOURCE_BASE; });
    rt.mem.write32(0x80044f4c, CHROME.resource);
    rt.cpu.setStub(CHROME.pad, (c) => { EVENTS.push(["padPressed", c.reg(4)]); return CHROME_MODE.pad ?? 0; });
    rt.cpu.setStub(CHROME.padShift, (c) => { EVENTS.push(["padShift", c.reg(4), c.reg(5)]); return CHROME_MODE.shift ?? 0xd; });
    rt.mem.write32(CHROME_PAD_PTR, CHROME.pad);
    rt.mem.write32(CHROME_PAD_SHIFT_PTR, CHROME.padShift);
    rt.cpu.setStub(CHROME.method38, (c) => { EVENTS.push(["advance", c.reg(4)]); return 0; });
    rt.cpu.setStub(CHROME.method2c, (c) => { EVENTS.push(["setSubstate", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(CHROME.method28, (c) => { EVENTS.push(["setState0", c.reg(4), c.reg(5)]); return 0; });
    return rt;
}

const rtChrome = chromeRuntime();

function seedChrome(o = {}) {
    EVENTS = [];
    DRAW = [];
    CHROME_MODE = o;
    WIDGET_CALLS = 0;
    rtChrome.mem.write32(0x8004de20, o.frame ?? FRAME);
    rtChrome.mem.write32(0x8005cca8, 0x40);
    for (let i = 0; i < 0x60; i += 4) rtChrome.mem.write32(CHROME_OBJ + i, 0);
    rtChrome.mem.write32(CHROME_OBJ + 0x0c, o.state ?? 0);
    rtChrome.mem.write32(CHROME_OBJ + 0x10, o.sub ?? 0);
    rtChrome.mem.write32(CHROME_OBJ + 0x14, o.stamp ?? 0);
    rtChrome.mem.write32(CHROME_OBJ + 0x54, o.pose ?? 0);
    rtChrome.mem.write32(CHROME_OBJ + 0x38, CHROME.method38);
    rtChrome.mem.write32(CHROME_OBJ + 0x2c, CHROME.method2c);
    rtChrome.mem.write32(CHROME_OBJ + 0x28, CHROME.method28);
    for (let i = 0; i < 0x10; i += 4) rtChrome.mem.write32(CHROME_ARG1 + i, 0);
    rtChrome.mem.write32(CHROME_ARG1 + 0, WIDGET_A);
    rtChrome.mem.write32(CHROME_ARG1 + 4, WIDGET_B);
    rtChrome.mem.write32(WIDGET_A + 0xb8, o.penX ?? 0x10);
    rtChrome.mem.write32(WIDGET_A + 0xba, o.penY ?? 0x20);
}

function chromeFields() {
    return [0x0c, 0x10, 0x14, 0x50, 0x54].map((off) => rtChrome.mem.read32(CHROME_OBJ + off) >>> 0)
        .concat([rtChrome.mem.read32(CHROME_ARG1 + 0) >>> 0, rtChrome.mem.read32(CHROME_ARG1 + 4) >>> 0]);
}

function portChromeHost() {
    return {
        allocChrome(h, s, e) { EVENTS.push(["alloc", h, s, e]); return CHROME_OBJ; },
        advance(o) { EVENTS.push(["advance", o >>> 0]); },
        setState0(o, s) { EVENTS.push(["setState0", o >>> 0, s | 0]); },
        setSubstate(o, s) { EVENTS.push(["setSubstate", o >>> 0, s | 0]); },
        resourceGetBase(id) { EVENTS.push(["resourceGetBase", id >>> 0]); return RESOURCE_BASE; },
        createWidget(v, f, x, y) {
            const w = WIDGET_CALLS === 0 ? WIDGET_A : WIDGET_B;
            WIDGET_CALLS += 1;
            EVENTS.push(["createWidget", v >>> 0, f >>> 0, x >>> 0, y >>> 0, w >>> 0]);
            return w;
        },
        widgetSetPageLines(w, n) { EVENTS.push(["widgetPageLines", w >>> 0, n | 0]); },
        widgetSetResourceLine(w, b, n) { EVENTS.push(["widgetResourceLine", w >>> 0, b >>> 0, n | 0]); },
        widgetSetColourRow(w, n) { EVENTS.push(["widgetColourRow", w >>> 0, n | 0]); },
        widgetSetTypewriter(w, n) { EVENTS.push(["widgetTypewriter", w >>> 0, n | 0]); },
        widgetSetCallback(w, cue) { EVENTS.push(["widgetCallback", w >>> 0, cue >>> 0]); },
        widgetSetTypewriterSpeed(w, n) { EVENTS.push(["widgetSpeed", w >>> 0, n | 0]); },
        widgetSetPos(w, x, y) { EVENTS.push(["widgetPos", w >>> 0, x | 0, y | 0]); },
        widgetBusy(w) { EVENTS.push(["widgetBusy", w >>> 0]); return CHROME_MODE.busy ?? 0; },
        widgetState(w) { EVENTS.push(["widgetState", w >>> 0]); return CHROME_MODE.state ?? 0; },
        widgetFlag(w) { EVENTS.push(["widgetFlag", w >>> 0]); return CHROME_MODE.flag ?? 0; },
        widgetReveal(w) { EVENTS.push(["widgetReveal", w >>> 0]); },
        padPressed(port) { EVENTS.push(["padPressed", port >>> 0]); return CHROME_MODE.pad ?? 0; },
        padShift(port, logical) { EVENTS.push(["padShift", port >>> 0, logical >>> 0]); return CHROME_MODE.shift ?? 0xd; },
        frameTick() { return rtChrome.mem.read32(0x8004de20) | 0; },
        initDrawContext() {},
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setClutRow(r) { DRAW.push(["m_0x88", [r, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
    };
}

function runChrome(label, o) {
    seedChrome(o);
    const before = rtChrome.drawCalls.length;
    rtChrome.cpu.call(0x80083774, [CHROME_OBJ, CHROME_ARG1]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleDraw = normDraw(rtChrome.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rtChrome.drawCalls.length = before;
    const oracleFields = chromeFields();

    seedChrome(o);
    wizardChromeTick(rtChrome.mem, CHROME_OBJ, CHROME_ARG1, portChromeHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(normDraw(DRAW), oracleDraw, `${label}: draw`);
    assert.deepEqual(chromeFields(), oracleFields, `${label}: fields`);
}

test("wizardChromeCreate matches F0x80083D38", () => {
    seedChrome();
    rtChrome.cpu.call(0x80083d38, [0x80190000]);
    const oracleAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const oracleScreen = rtChrome.mem.read32(CHROME_OBJ + 0x50) >>> 0;
    seedChrome();
    const obj = wizardChromeCreate(rtChrome.mem, 0x80190000, portChromeHost());
    assert.equal(obj, CHROME_OBJ);
    assert.deepEqual(norm(EVENTS.filter((e) => e[0] === "alloc")), oracleAlloc, "alloc");
    assert.equal(rtChrome.mem.read32(CHROME_OBJ + 0x50) >>> 0, oracleScreen, "screen");
});

test("wizardChromeTick matches F0x80083774", () => {
    runChrome("state 0 builds", { state: 0 });
    runChrome("state 2 idle", { state: 2 });
    runChrome("state 3 idle", { state: 3 });
    runChrome("default timer not met", { state: 1, sub: 0, pose: 1, stamp: FRAME });
    runChrome("default steps pose", { state: 1, sub: 0, pose: 1, stamp: FRAME - 6 });
    runChrome("default crosses to substate 2", { state: 1, sub: 0, pose: 3, stamp: FRAME - 6 });
    runChrome("case 2 busy closes", { state: 1, sub: 2, busy: 1, stamp: FRAME });
    runChrome("case 2 idle widget", { state: 1, sub: 2, state: 0, stamp: FRAME });
    runChrome("case 2 running flag set", { state: 1, sub: 2, state: 1, flag: 1, stamp: FRAME - 0x11 });
    runChrome("case 2 running flag clear", { state: 1, sub: 2, state: 1, flag: 0, stamp: FRAME - 9 });
    runChrome("case 2 circle reveals", { state: 1, sub: 2, state: 1, flag: 0, pad: 1 << 0xd, stamp: FRAME });
    runChrome("case 3 steps pose", { state: 1, sub: 3, pose: 3, stamp: FRAME - 6 });
    runChrome("case 3 crosses to state 3", { state: 1, sub: 3, pose: 7, stamp: FRAME - 6 });
});
