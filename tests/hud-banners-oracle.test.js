// Phase 4 oracle: engine/dw3/ui/hud-banners.ts must match pro/cardgame's six
// HUD banner bodies. Each original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the draw context, the pack resolver, the
// frame delta, the bank getter, the resident text measure and the widget method
// table recorded; the port uses an equivalent host over the same memory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    bannerContentDraw, bannerDrawPair, bannerPlaceText, bannerPlaceTextPair,
    hudSlotTextTick, hudSlotTextTickAll, BANNER_SLOT,
} from "../engine/dw3/ui/hud-banners.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80180000;
const PARA = 0x80181000;
const SCRATCH = 0x80170000;
const STACK = 0x801ff000;
const PACK_STUB = 0x0feb0000;
const DELTA_STUB = 0x0fe20000;
const BANK_STUB = 0x0fe70000;
const FETCH_STUB = 0x0fed0000;
const WIDGET_STUB = 0x0fe90000;
const PACK_PTR = 0x80190000;
const BANK_RET = 0x1234;
const MEASURE_RET = 42;
const COMMIT_RET = 0x40;
const LANGUAGE = 0x8005cca8;

const PARA_WIDGETS = {
    0x04: 0x80182000, 0x08: 0x80182400, 0x18: 0x80182800,
    0x20: 0x80182c00, 0x24: 0x80183000, 0x28: 0x80183400, 0x2c: 0x80183800,
};
const METHODS = [0x114, 0x118, 0x134, 0x138, 0x144, 0x148];
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
    rt.cpu.setStub(0x8001fcc0, (c) => {
        rt.mem.write32(c.reg(4) + 4, FETCH_STUB);
        return 0;
    });
    rt.cpu.setStub(FETCH_STUB, (c) => {
        EVENTS.push(["measure", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]);
        return MEASURE_RET;
    });
    for (const m of METHODS) {
        rt.cpu.setStub(WIDGET_STUB + m, (c) => {
            EVENTS.push(["w", m, c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
            return m === 0x148 ? COMMIT_RET : 0;
        });
    }
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    DELTA = o.delta ?? 1;
    for (let i = 0; i < 0x400; i += 4) rt.mem.write32(VIEW + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(PARA + i, 0);
    for (const [off, w] of Object.entries(PARA_WIDGETS)) {
        rt.mem.write32(PARA + Number(off), w);
        for (let j = 0; j < 0x200; j += 4) rt.mem.write32(w + j, 0);
        for (const m of METHODS) rt.mem.write32(w + m, WIDGET_STUB + m);
        rt.mem.write32(w + 0x50, o.widget50 ?? 0);
        rt.mem.write16(w + 0xb4, o.widgetB4 ?? 0);
    }
    rt.mem.write32(LANGUAGE, o.lang ?? 2);
    const slots = o.slots ?? [{ index: 0 }];
    for (let i = 0; i < slots.length; i++) rt.mem.write32(VIEW + 0xe0c + i * 0x18, 0);
    for (const s of slots) {
        const a = VIEW + 0xe0c + s.i * 0x18;
        for (let j = 0; j < 0x18; j += 4) rt.mem.write32(a + j, 0);
        rt.mem.write16(a + 0x00, s.x ?? 10);
        rt.mem.write16(a + 0x02, s.y ?? 20);
        rt.mem.write16(a + 0x04, s.scale ?? 0x1000);
        rt.mem.write16(a + 0x08, s.timer ?? 5);
        rt.mem.write16(a + 0x0a, s.duration ?? 10);
        rt.mem.write16(a + 0x0c, s.index ?? 0);
        rt.mem.write16(a + 0x0e, s.value ?? 0);
        rt.mem.write32(a + 0x10, s.sid ?? 0x11);
        rt.mem.write8(a + 0x14, s.b14 ?? 1);
        rt.mem.write8(a + 0x15, s.b15 ?? 2);
        rt.mem.write8(a + 0x16, s.b16 ?? 1);
        rt.mem.write8(a + 0x17, s.state ?? 1);
    }
}

function fields() {
    const out = [];
    for (let i = 0; i < 6; i++) {
        const a = VIEW + 0xe0c + i * 0x18;
        out.push(rt.mem.read16(a + 0x00), rt.mem.read16(a + 0x02), rt.mem.read16(a + 0x04),
            rt.mem.read16(a + 0x08), rt.mem.read16(a + 0x0a), rt.mem.read16(a + 0x0c),
            rt.mem.read16(a + 0x0e), rt.mem.read32(a + 0x10) >>> 0,
            rt.mem.read8(a + 0x14), rt.mem.read8(a + 0x15), rt.mem.read8(a + 0x16),
            rt.mem.read8(a + 0x17));
    }
    return out;
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, CTX_ARITY[m] ?? 4).map((v) => v >>> 0)]);
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
            return method === 0x148 ? COMMIT_RET : 0;
        },
        measureText(ptr, a1, a2) {
            EVENTS.push(["measure", ptr >>> 0, a1 >>> 0, a2 | 0]);
            return MEASURE_RET;
        },
        scratch() { for (let i = 0; i < 0x12; i++) rt.mem.write8(SCRATCH + i, 0); return SCRATCH; },
    };
}

function callStack(addr, args, stack = {}) {
    rt.cpu.sp = STACK;
    for (const [off, v] of Object.entries(stack)) rt.mem.write32(STACK + Number(off), v >>> 0);
    return rt.cpu.call(addr, args);
}

const slotAddr = (i) => VIEW + 0xe0c + i * 0x18;

function compare(label, o, original, port) {
    seed(o);
    original();
    const oEvents = EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v)));
    const oDraws = normDraw(rt.drawCalls.map((c) => [c.method, c.args]));
    rt.drawCalls.length = 0;
    const oFields = fields();

    seed(o);
    port(rt.mem);
    assert.deepEqual(EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))), oEvents,
        `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraws, `${label}: draw`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

function tick(label, o) {
    compare(label, o,
        () => callStack(0x80097508, [VIEW, PARA, slotAddr(o.slot ?? 0), o.idx ?? 0]),
        (mem) => {
            const host2 = portHost();
            hudSlotTextTick(mem, VIEW, PARA, slotAddr(o.slot ?? 0), o.idx ?? 0, host2);
        });
}

test("hudSlotTextTick matches F0x80097508", () => {
    tick("state 0", { slots: [{ i: 0, state: 0 }], slot: 0, idx: 0 });
    tick("ramp still", { slots: [{ i: 0, state: 1, timer: 5, duration: 10 }], slot: 0, idx: 0 });
    tick("ramp expires lane 0", { slots: [{ i: 0, state: 1, timer: 1, duration: 10 }], slot: 0, idx: 0 });
    tick("ramp expires lane 1", { slots: [{ i: 0, state: 1, timer: 1, duration: 10 }], slot: 0, idx: 1 });
    tick("ramp expires lane 2", { slots: [{ i: 0, state: 1, timer: 1, duration: 10 }], slot: 0, idx: 2 });
    tick("ramp expires lane 3", { slots: [{ i: 0, state: 1, timer: 1, duration: 10 }], slot: 0, idx: 3 });
    tick("ramp expires lane 4", { slots: [{ i: 0, state: 1, timer: 1, duration: 10 }], slot: 0, idx: 4 });
    tick("ramp expires lane 5 pair", { slots: [{ i: 0, state: 1, timer: 1, duration: 10, index: 5, sid: 0x11 }], slot: 0, idx: 5 });
    tick("ramp expires lane 5 plain", { slots: [{ i: 0, state: 1, timer: 1, duration: 10, index: 4, sid: 0x24 }], slot: 0, idx: 5 });
    tick("ramp out of range", { slots: [{ i: 0, state: 1, timer: 1, duration: 10 }], slot: 0, idx: 6 });
    tick("state 2 lane 2", { slots: [{ i: 0, state: 2, index: 2 }], slot: 0, idx: 2 });
    tick("state 2 lane 3", { slots: [{ i: 0, state: 2, index: 3, value: 5 }], slot: 0, idx: 3 });
    tick("state 2 lane 3 no value", { slots: [{ i: 0, state: 2, index: 3, value: 0 }], slot: 0, idx: 3 });
    tick("state 2 lane 4 blank single", { slots: [{ i: 0, state: 2, sid: 0x1f4, b16: 0 }], slot: 0, idx: 4 });
    tick("state 2 lane 4 blank pair", { slots: [{ i: 0, state: 2, sid: 0x1f4, b16: 1, b14: 7, b15: 9 }], slot: 0, idx: 4 });
    tick("state 2 lane 4 other id", { slots: [{ i: 0, state: 2, sid: 0x11 }], slot: 0, idx: 4 });
    tick("state 2 lane 0", { slots: [{ i: 0, state: 2 }], slot: 0, idx: 0 });
    tick("state 3 lane 0", { slots: [{ i: 0, state: 3, timer: 4, duration: 10 }], slot: 0, idx: 0 });
    tick("state 3 lane 2 expires", { slots: [{ i: 0, state: 3, timer: 1, duration: 10, index: 2 }], slot: 0, idx: 2 });
    tick("state 3 lane 4", { slots: [{ i: 0, state: 3, timer: 3, duration: 10, index: 4 }], slot: 0, idx: 4 });
    tick("state 3 lane 5", { slots: [{ i: 0, state: 3, timer: 3, duration: 10, index: 5 }], slot: 0, idx: 5 });
    tick("state 3 lane 1", { slots: [{ i: 0, state: 3, timer: 3, duration: 10, index: 1 }], slot: 0, idx: 1 });
    tick("state 3 out of range", { slots: [{ i: 0, state: 3, timer: 3, duration: 10 }], slot: 0, idx: 6 });
    tick("state above 3", { slots: [{ i: 0, state: 7, timer: 5, duration: 8 }], slot: 0, idx: 1 });
    tick("lane 2 shifted icon", { slots: [{ i: 0, state: 2, index: 2, b16: 1, sid: 0x11 }], slot: 0, idx: 2 });
    tick("scaled slot", { slots: [{ i: 0, state: 2, index: 3, value: 3, scale: 0x800, sid: 0x21 }], slot: 0, idx: 3 });
    tick("negative position", { slots: [{ i: 0, state: 2, x: -5, y: -20, index: 1 }], slot: 0, idx: 1 });
    tick("zero string id hides", { slots: [{ i: 0, state: 2, sid: 0, index: 2 }], slot: 0, idx: 2 });
    tick("other lane untouched", { slots: [{ i: 2, state: 1, timer: 1 }], slot: 2, idx: 2 });
});

test("hudSlotTextTickAll matches F0x800978f0", () => {
    compare("all six slots",
        { slots: [
            { i: 0, state: 1, timer: 5 }, { i: 1, state: 1, timer: 1, index: 1 },
            { i: 2, state: 2, index: 2 }, { i: 3, state: 2, index: 3, value: 2 },
            { i: 4, state: 3, timer: 2, index: 4, sid: 0x1f4, b16: 1 },
            { i: 5, state: 1, timer: 1, index: 5, sid: 0x24 },
        ] },
        () => callStack(0x800978f0, [VIEW, PARA]),
        (mem) => hudSlotTextTickAll(mem, VIEW, PARA, portHost()));
});

test("bannerContentDraw matches F0x80096e8c", () => {
    const draw = (label, o) => compare(label, o,
        () => callStack(0x80096e8c, [VIEW, PARA, slotAddr(0)]),
        (mem) => { const host2 = portHost(); bannerContentDraw(mem, slotAddr(0), host2, host2); });
    draw("idle lane 0", { slots: [{ i: 0, state: 1, index: 0 }] });
    draw("digit lane 3", { slots: [{ i: 0, state: 2, index: 3, value: 5, sid: 0x11 }] });
    draw("digit lane 3 wide", { slots: [{ i: 0, state: 2, index: 3, value: -1, sid: 0x2f }] });
    draw("shifted icon", { slots: [{ i: 0, state: 1, index: 2, b16: 1 }] });
    draw("face lane 5", { slots: [{ i: 0, state: 1, index: 5, sid: 0x03 }] });
    draw("scaled face", { slots: [{ i: 0, state: 1, index: 5, scale: 0x200 }] });
    draw("lane 1 icon", { slots: [{ i: 0, state: 1, index: 1, sid: 0x10 }] });
});

test("bannerPlaceText matches F0x80097310", () => {
    const place = (label, o, flag) => compare(label, o,
        () => callStack(0x80097310, [VIEW, slotAddr(0), PARA_WIDGETS[0x24], 2 + 0xf], { 0x10: flag }),
        (mem) => bannerPlaceText(mem, PARA_WIDGETS[0x24], slotAddr(0), 2 + 0xf, flag, portHost()));
    place("flag 0", { slots: [{ i: 0, sid: 0x11 }] }, 0);
    place("flag 1", { slots: [{ i: 0, sid: 0x11 }] }, 1);
    place("flag 2", { slots: [{ i: 0, sid: 0x11 }] }, 2);
    place("empty id hides", { slots: [{ i: 0, sid: 0 }] }, 0);
    place("negative y", { slots: [{ i: 0, y: -30 }] }, 1);
});

test("bannerPlaceTextPair matches F0x800973e4", () => {
    const pair = (label, o) => compare(label, o,
        () => callStack(0x800973e4, [VIEW, PARA, slotAddr(0), PARA_WIDGETS[0x18]], { 0x10: 2 + 0xf }),
        (mem) => bannerPlaceTextPair(mem, PARA_WIDGETS[0x18], slotAddr(0), 2 + 0xf, portHost()));
    pair("measured line", { slots: [{ i: 0, sid: 0x11 }] });
    pair("pair id flag", { slots: [{ i: 0, sid: 0x1f }] });
    pair("empty id hides", { slots: [{ i: 0, sid: 0 }] });
    pair("widget metric", { slots: [{ i: 0, sid: 0x11 }], widget50: 7, widgetB4: 3 });
});

test("bannerDrawPair matches F0x80097238", () => {
    const draw = (label, o) => compare(label, o,
        () => callStack(0x80097238, [VIEW, PARA, slotAddr(0)]),
        (mem) => { bannerDrawPair(mem, PARA, slotAddr(0), portHost()); });
    draw("bytes 1/2", { slots: [{ i: 0, b14: 1, b15: 2 }] });
    draw("bytes 0xff", { slots: [{ i: 0, b14: 0xff, b15: 0 }] });
});
