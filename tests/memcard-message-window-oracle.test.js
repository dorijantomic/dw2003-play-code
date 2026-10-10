// Phase 4 oracle: engine/dw3/ui/memcard-message-window.ts create / tick / draw
// must match pro/stgmcard F0x80087798 / F0x80087534 / F0x80087368. The
// original runs through engine/native with the object factory, the tween
// start, the widget factory and method slots, the icon factory, the state
// machine and every draw-context method stubbed; the port uses the same host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    memcardMessageWindowCreate,
    memcardMessageWindowTick,
} from "../engine/dw3/ui/memcard-message-window.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgmcard = new Uint8Array(readFileSync(join(dir, "pro_stgmcard.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgmcard.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const MSG = 0x80180000;
const PARENT = 0x80181000;
const CHILD = 0x80184000;
const GRID = 0x80185000;
const ICON = 0x80187000;
const WIDGET_BASE = 0x80188000;
const WIDGET_PTR = 0x8018f000;
const PACK_STUB = 0x0fe00000;
const PACK_PTR = 0x80190000;
const ADV_STATE = 0x800142ac;
const TWEEN_START_STUB = 0x0fe00010;
const WIDGET_160_STUB = 0x0fe00020;
const WIDGET_15C_STUB = 0x0fe00030;
const WIDGET_144_STUB = 0x0fe00040;
const ICON_SHOW_STUB = 0x0fe00050;
const FRAME = 5000;
const ARITY = { setOrigin: 2, setLayer: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };
const OFFSETS = [0x0c, 0x10, 0x50, 0x54, 0x58, 0x5c, 0x2810, 0x2824, 0x282c,
    0x2840, 0x2844, 0x2848, 0x284c, 0x2854, 0x2858];

let EVENTS = [];
let DRAW = [];
let WIDGET_NEXT = 0;

function runtime() {
    const rt = new NativeStageRuntime(stgmcard, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8004de20, FRAME);
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        if (c.reg(5) === 0x285c) return MSG;
        if (c.reg(5) === 0xf4) return GRID;
        return 0;
    });
    rt.cpu.setStub(TWEEN_START_STUB, (c) => {
        EVENTS.push(["tweenStart", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        return 0;
    });
    rt.mem.write32(0x80088798, TWEEN_START_STUB);
    rt.cpu.setStub(0x8001ae38, (c) => {
        EVENTS.push(["create", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        const w = (WIDGET_BASE + (WIDGET_NEXT++ % 8) * 0x100) >>> 0;
        rt.mem.write32(w + 0x160, WIDGET_160_STUB);
        rt.mem.write32(w + 0x15c, WIDGET_15C_STUB);
        rt.mem.write32(w + 0x144, WIDGET_144_STUB);
        return w;
    });
    rt.cpu.setStub(WIDGET_160_STUB, (c) => { EVENTS.push(["w160", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(WIDGET_15C_STUB, (c) => { EVENTS.push(["w15c", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(WIDGET_144_STUB, (c) => { EVENTS.push(["w144", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x8001b364, (c) => {
        EVENTS.push(["icon", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        rt.mem.write32(ICON + 0x80, ICON_SHOW_STUB);
        return ICON;
    });
    rt.cpu.setStub(ICON_SHOW_STUB, (c) => { EVENTS.push(["iconShow", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x80084dcc, (c) => { EVENTS.push(["stateMachine", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(PACK_STUB, () => PACK_PTR);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(ADV_STATE, (c) => {
        const o = c.reg(4);
        const v = (rt.mem.read32(o + 0xc) + 1) | 0;
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
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
    WIDGET_NEXT = 0;
    for (let i = 0; i < 0x2884; i += 4) rt.mem.write32(MSG + i, 0);
    rt.mem.write32(MSG + 0x38, ADV_STATE);
    rt.mem.write32(MSG + 0x0c, o.state ?? 0);
    rt.mem.write32(MSG + 0x10, o.substep ?? 0);
    rt.mem.write32(MSG + 0x50, PARENT);
    rt.mem.write32(MSG + 0x54, o.target ?? 0x1000);
    rt.mem.write32(MSG + 0x58, o.boxX ?? 0);
    rt.mem.write32(MSG + 0x5c, o.boxY ?? 0);
    rt.mem.write32(MSG + 0x2810, o.foldX ?? 0);
    rt.mem.write32(MSG + 0x2824, o.tween ?? 0);
    rt.mem.write32(MSG + 0x282c, o.foldY ?? 0);
    rt.mem.write32(MSG + 0x2840, o.blinkOn ?? 0);
    rt.mem.write32(MSG + 0x2844, o.blinkStamp ?? FRAME);
    rt.mem.write32(MSG + 0x2848, o.blinkFrame ?? 0);
    rt.mem.write32(MSG + 0x284c, o.drain ?? 0);
    for (let i = 0; i < 0x24; i += 4) rt.mem.write32(CHILD + i, 0);
    if (o.child0) rt.mem.write32(CHILD + 0x00, o.child0);
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(GRID + i, 0);
}

function msgFields() {
    const out = OFFSETS.map((off) => rt.mem.read32(MSG + off) >>> 0);
    for (let i = 0; i < 0x24; i += 4) out.push(rt.mem.read32(CHILD + i) >>> 0);
    for (const off of [0x50, 0x54, 0x58, 0xdc, 0xe0, 0xe4, 0xe8, 0xec, 0xf0]) out.push(rt.mem.read32(GRID + off) >>> 0);
    return out;
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        allocMessageWindow(handler, size, extra) {
            EVENTS.push(["alloc", handler, size, extra]);
            return MSG;
        },
        allocGrid(handler, size, extra) {
            EVENTS.push(["alloc", handler, size, extra]);
            return GRID;
        },
        tweenStart(obj, from, to, steps) { EVENTS.push(["tweenStart", obj, from, to, steps]); },
        advancePhase(o) {
            const v = (rt.mem.read32(o + 0xc) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0xc, v);
            EVENTS.push(["advance", o]);
        },
        createTextElement(target, kind, x, y) {
            EVENTS.push(["create", target, kind, x, y]);
            const w = (WIDGET_BASE + (WIDGET_NEXT++ % 8) * 0x100) >>> 0;
            rt.mem.write32(w + 0x160, WIDGET_160_STUB);
            rt.mem.write32(w + 0x15c, WIDGET_15C_STUB);
            rt.mem.write32(w + 0x144, WIDGET_144_STUB);
            return w;
        },
        widgetSet160(w, v) { EVENTS.push(["w160", w >>> 0, v]); },
        widgetSet15C(w, v) { EVENTS.push(["w15c", w >>> 0, v]); },
        widgetClear(w, v) { EVENTS.push(["w144", w >>> 0, v]); },
        spawnUiIcon(target, a1, x, y) {
            EVENTS.push(["icon", target, a1, x, y]);
            rt.mem.write32(ICON + 0x80, ICON_SHOW_STUB);
            return ICON;
        },
        iconShow(icon, value) { EVENTS.push(["iconShow", icon >>> 0, value]); },
        stateMachine(screen, child) { EVENTS.push(["stateMachine", screen, child]); },
        initDrawContext() {},
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        paletteShift(v) { DRAW.push(["m_0x88", [v, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
        frameTick() { return rt.mem.read32(0x8004de20) | 0; },
    };
}

function runCase(label, o) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80087534, [MSG, CHILD]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = msgFields();

    seed(o);
    memcardMessageWindowTick(rt.mem, MSG, CHILD, portHost());
    const portEvents = norm(EVENTS.slice());
    const portDraw = normDraw(DRAW);
    const portFields = msgFields();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portDraw, oracleDraw, `${label}: draw`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("memcardMessageWindowCreate matches F0x80087798", () => {
    seed({});
    EVENTS = [];
    rt.cpu.call(0x80087798, [PARENT]);
    const oracleAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const oracleFields = [0x50, 0x54, 0x2854, 0x2858].map((off) => rt.mem.read32(MSG + off) >>> 0);

    seed({});
    EVENTS = [];
    const win = memcardMessageWindowCreate(rt.mem, PARENT, {
        allocMessageWindow(handler, size, extra) { EVENTS.push(["alloc", handler, size, extra]); return MSG; },
    });
    assert.equal(win, MSG);
    const portAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const portFields = [0x50, 0x54, 0x2854, 0x2858].map((off) => rt.mem.read32(MSG + off) >>> 0);
    assert.deepEqual(portAlloc, oracleAlloc, "alloc");
    assert.deepEqual(portFields, oracleFields, "fields");
});

test("memcardMessageWindowTick matches F0x80087534", () => {
    runCase("state 0 builds", { state: 0 });
    runCase("state 0 non-zero origin", { state: 0, boxX: 3, boxY: 7, tween: 0x1234 });
    runCase("state 4 builds", { state: 4 });
    runCase("state 3 idle", { state: 3 });
    runCase("state 1 live", { state: 1 });
    runCase("state 2 hides", { state: 2, substep: 0, child0: 0x80188000 });
    runCase("state 2 already hidden", { state: 2, substep: 1, child0: 0x80188000 });
    runCase("state 2 later step", { state: 2, substep: 5, child0: 0x80188000 });
    runCase("draw default", { state: 1 });
    runCase("draw blink advance", { state: 1, blinkOn: 1, blinkStamp: FRAME - 3, blinkFrame: 2 });
    runCase("draw blink too soon", { state: 1, blinkOn: 1, blinkStamp: FRAME - 2, blinkFrame: 2 });
    runCase("draw blink wrap", { state: 1, blinkOn: 1, blinkStamp: FRAME - 3, blinkFrame: 4 });
    runCase("draw drain", { state: 1, drain: 1 });
    runCase("draw folded window", { state: 1, boxX: 0x12, boxY: 0x20, foldX: 0x2810 - 0x2810 + 0x30, foldY: 0x40, blinkOn: 1, blinkFrame: 1 });
});
