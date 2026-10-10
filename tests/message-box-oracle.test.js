// Phase 4 oracle: engine/dw3/ui/message-box.ts must match pro/cardgame's
// F0x80097ACC (messageBoxTick) and its two plate draws F0x80097958 /
// F0x80097A24. Each original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the draw context, pack resolver, frame
// delta, bank getter, resident measure, close prompt and widget method table
// recorded; the port uses an equivalent host over the same memory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { messageBoxTick, messageIconDraw, messagePlateDraw } from "../engine/dw3/ui/message-box.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80180000;
const PARA = 0x80181000;
const STACK = 0x801ff000;
const PACK_STUB = 0x0feb0000;
const DELTA_STUB = 0x0fe20000;
const BANK_STUB = 0x0fe70000;
const FETCH_STUB = 0x0fed0000;
const CLOSE_STUB = 0x0fea0000;
const WIDGET_STUB = 0x0fe90000;
const PACK_PTR = 0x80190000;
const BANK_RET = 0x1234;
const MEASURE_RET = 42;
const LANGUAGE = 0x8005cca8;

const PARA_WIDGETS = {
    0x00: 0x80182000, 0x04: 0x80182400, 0x08: 0x80182800,
    0x0c: 0x80182c00, 0x1c: 0x80183000, 0x34: 0x80183400,
};
// Only the argument count each method actually consumes; the rest are the
// caller's leftover registers in the original.
const METHOD_ARITY = { 0x80: 1, 0x84: 2, 0x8c: 1, 0x114: 2, 0x118: 2, 0x134: 2, 0x138: 1, 0x144: 1, 0x148: 1 };
const CTX_ARITY = { setOrigin: 2, setLayer: 2, setPos: 2, setScale: 3, drawSprite: 4, setFrame: 1 };

let EVENTS = [];
let PORT_DRAW = [];
let DELTA = 1;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(DELTA_STUB, () => { EVENTS.push(["delta"]); return DELTA; });
    rt.mem.write32(0x8004df9c, DELTA_STUB);
    rt.cpu.setStub(BANK_STUB, (c) => { EVENTS.push(["bankGet", c.reg(4) >>> 0]); return BANK_RET; });
    rt.mem.write32(0x80044f4c, BANK_STUB);
    rt.cpu.setStub(0x8001fcc0, (c) => { rt.mem.write32(c.reg(4) + 4, FETCH_STUB); return 0; });
    rt.cpu.setStub(FETCH_STUB, (c) => {
        EVENTS.push(["measure", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]);
        return MEASURE_RET;
    });
    rt.cpu.setStub(CLOSE_STUB, (c) => { EVENTS.push(["close", c.reg(4) >>> 0]); return 0; });
    for (const m of Object.keys(METHOD_ARITY).map(Number)) {
        rt.cpu.setStub(WIDGET_STUB + m, (c) => {
            EVENTS.push(["w", m, c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
            return 0;
        });
    }
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    DELTA = o.delta ?? 1;
    for (let i = 0; i < 0x1100; i += 4) rt.mem.write32(VIEW + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(PARA + i, 0);
    for (const [off, w] of Object.entries(PARA_WIDGETS)) {
        rt.mem.write32(PARA + Number(off), w);
        for (let j = 0; j < 0x200; j += 4) rt.mem.write32(w + j, 0);
        for (const m of Object.keys(METHOD_ARITY).map(Number)) rt.mem.write32(w + m, WIDGET_STUB + m);
        rt.mem.write32(w + 0x50, o.widget50 ?? 0);
        rt.mem.write16(w + 0xb4, o.widgetB4 ?? 0);
    }
    rt.mem.write32(LANGUAGE, o.lang ?? 2);
    rt.mem.write32(VIEW + 0xee8, CLOSE_STUB);
    rt.mem.write8(VIEW + 0xdfa, o.state ?? 0);
    rt.mem.write8(VIEW + 0xdfb, o.kind ?? 0);
    rt.mem.write16(VIEW + 0xdf0, (o.timer ?? 5) & 0xffff);
    rt.mem.write16(VIEW + 0xdf2, (o.duration ?? 10) & 0xffff);
    rt.mem.write16(VIEW + 0xdf4, (o.layout ?? 0) & 0xffff);
    rt.mem.write32(VIEW + 0xde4, o.lane ?? 0);
    rt.mem.write32(VIEW + 0xde8, o.id ?? 0);
    rt.mem.write16(VIEW + 0x5c, (o.v5c ?? 10) & 0xffff);
    rt.mem.write16(VIEW + 0x5e, (o.v5e ?? 0) & 0xffff);
    rt.mem.write32(VIEW + 0xa4, o.vA4 ?? 0x1111);
    rt.mem.write32(VIEW + 0xa4 + 0x54, o.vF8 ?? 0x2222);
}

function fields() {
    return [
        rt.mem.read8(VIEW + 0xdfa), rt.mem.read16(VIEW + 0xdf0), rt.mem.read16(VIEW + 0xdf2),
        rt.mem.read16(VIEW + 0xdf4), rt.mem.read32(VIEW + 0xde4) >>> 0, rt.mem.read32(VIEW + 0xde8) >>> 0,
        rt.mem.read32(VIEW + 0xa4) >>> 0, rt.mem.read32(VIEW + 0xf8) >>> 0,
    ];
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, CTX_ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function normEvents(list) {
    return list.map((e) => {
        if (e[0] === "w") return ["w", e[1], e[2], ...e.slice(3, 3 + (METHOD_ARITY[e[1]] ?? 2)).map((v) => v | 0)];
        return e.map((v) => (typeof v === "number" ? v | 0 : v));
    });
}

function portHost() {
    return {
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["setFrame", [n, 0, 0, 0]]); },
        setPos(x, y) { PORT_DRAW.push(["setPos", [x, y, 0, 0]]); },
        setScale(x, y, z) { PORT_DRAW.push(["setScale", [x, y, z, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        frameDelta() { EVENTS.push(["delta"]); return DELTA; },
        bankGet(h) { EVENTS.push(["bankGet", h >>> 0]); return BANK_RET; },
        callWidgetMethod(obj, method, a1, a2) {
            EVENTS.push(["w", method, obj >>> 0, a1 | 0, a2 | 0]);
            return 0;
        },
        measureText(ptr, a1, a2) {
            EVENTS.push(["measure", ptr >>> 0, a1 >>> 0, a2 | 0]);
            return MEASURE_RET;
        },
        callViewClose(fn, view) { EVENTS.push(["close", view >>> 0]); },
    };
}

function callStack(addr, args, stack = {}) {
    rt.cpu.sp = STACK;
    for (const [off, v] of Object.entries(stack)) rt.mem.write32(STACK + Number(off), v >>> 0);
    return rt.cpu.call(addr, args);
}

function compare(label, o, original, port) {
    seed(o);
    original();
    const oEvents = normEvents(EVENTS);
    const oDraws = normDraw(rt.drawCalls.map((c) => [c.method, c.args]));
    rt.drawCalls.length = 0;
    const oFields = fields();

    seed(o);
    port(rt.mem);
    assert.deepEqual(normEvents(EVENTS), oEvents, `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraws, `${label}: draw`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

function tick(label, o) {
    compare(label, o,
        () => callStack(0x80097acc, [VIEW, PARA]),
        (mem) => messageBoxTick(mem, VIEW, PARA, portHost()));
}

test("messageBoxTick matches F0x80097ACC", () => {
    tick("state 0", { state: 0 });
    tick("ramp still", { state: 1, timer: 5, duration: 10, kind: 1, lane: 0 });
    tick("ramp land kind 0", { state: 1, timer: 1, duration: 10, kind: 0, lane: 0 });
    tick("ramp land kind 1", { state: 1, timer: 1, duration: 10, kind: 1, lane: 0 });
    tick("ramp land kind 2", { state: 1, timer: 1, duration: 10, kind: 2, lane: 1, layout: 2 });
    tick("ramp land kind 3", { state: 1, timer: 1, duration: 10, kind: 3, lane: 2, layout: 1 });
    tick("ramp land kind 4", { state: 1, timer: 1, duration: 10, kind: 4, lane: 0 });
    tick("ramp land kind 3 lane 3", { state: 1, timer: 1, duration: 10, kind: 3, lane: 3 });
    tick("ramp zero duration", { state: 1, timer: 3, duration: 0, kind: 1 });
    tick("ramp negative timer", { state: 1, timer: -2, duration: 10, kind: 1 });
    tick("hold kind 0", { state: 2, kind: 0, lane: 0 });
    tick("hold kind 1 lane 3", { state: 2, kind: 1, lane: 3, layout: 1 });
    tick("hold kind 2", { state: 2, kind: 2, lane: 2, layout: 3 });
    tick("hold kind 3 lane 3", { state: 2, kind: 3, lane: 3 });
    tick("slide still", { state: 4, timer: 5, duration: 10, lane: 1 });
    tick("slide lands", { state: 4, timer: 1, duration: 10, lane: 0 });
    tick("slide lands lane 3", { state: 4, timer: 1, duration: 10, lane: 3 });
    tick("dismiss still", { state: 5, timer: 5, duration: 10 });
    tick("dismiss lands", { state: 5, timer: 1, duration: 10 });
    tick("dismiss zero duration", { state: 5, timer: 3, duration: 0 });
    tick("above 5 ramps", { state: 6, timer: 4, duration: 8, kind: 2 });
    tick("state 3 ramps", { state: 3, timer: 4, duration: 8, kind: 1 });
    tick("id 0 hides", { state: 1, timer: 1, duration: 10, kind: 2, lane: 1, id: 0 });
    tick("id plain", { state: 1, timer: 1, duration: 10, kind: 2, lane: 1, id: 0x11 });
    tick("id 0x13", { state: 1, timer: 1, duration: 10, kind: 2, lane: 1, id: 0x13, layout: 2, vA4: 7, vF8: 9 });
    tick("id 0x13 lane 3", { state: 1, timer: 1, duration: 10, kind: 3, lane: 3, id: 0x13 });
    tick("id 0x3e", { state: 1, timer: 1, duration: 10, kind: 2, lane: 2, id: 0x3e, v5c: 7, v5e: -3 });
    tick("id 0x3e lane 3", { state: 1, timer: 1, duration: 10, kind: 2, lane: 3, id: 0x3e, v5c: -8, v5e: 12 });
    tick("negative layout", { state: 2, kind: 2, lane: 2, layout: -1 });
    tick("frame delta 3", { state: 1, timer: 4, duration: 10, kind: 1, delta: 3 });
});

test("messagePlateDraw matches F0x80097958", () => {
    const draw = (label, o, scale, x, y) => compare(label, o,
        () => callStack(0x80097958, [VIEW, PARA, scale, x], { 0x10: y }),
        (mem) => messagePlateDraw(mem, scale, x, y, portHost()));
    draw("full scale", {}, 0x1000, 0, 138);
    draw("half scale", {}, 0x800, 10, 96);
    draw("negative", {}, -0x400, -5, -20);
    draw("high bits", {}, 0x12345678, 0x7fff, -0x8000);
});

test("messageIconDraw matches F0x80097A24", () => {
    const draw = (label, x, y) => compare(label, {},
        () => callStack(0x80097a24, [VIEW, PARA, x, y]),
        () => messageIconDraw(x, y, portHost()));
    draw("icon rest", 0x1c, 0x64);
    draw("icon negative", -1, -100);
});
