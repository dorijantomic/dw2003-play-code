// Phase 4 oracle: engine/dw3/ui/turn-marker.ts must match pro/cardgame's
// F0x80099BE4 (turnMarkerFadeTick) and F0x800999A0 (drawTurnMarker). Each
// original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin with the draw context, the object method slots, the pack
// resolver, the resident lookup and the frame delta recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { turnMarkerFadeTick, drawTurnMarker } from "../engine/dw3/ui/turn-marker.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80180000;
const MARKER = 0x80181000;
const ALLOC = 0x80183000;
const OBJ = 0x80182000;
const PACK_STUB = 0x0feb0000;
const PACK_PTR = 0x80190000;
const DELTA_STUB = 0x0fe20000;
const SERVICE_STUB = 0x0fe60000;
const SLOT_STUBS = [[0x134, 0x0fe60100], [0x114, 0x0fe60200], [0x144, 0x0fe60300]];
const TABLE = 0x800a5aa8;
const SELECTOR = 0x8005ccb0;
const LANGUAGE = 0x8005cca8;
const ARITY = { setOrigin: 2, setLayer: 2, setPos: 2, setScale: 3, drawSprite: 4 };

let EVENTS = [];
let PORT_DRAW = [];
let DELTA = 1;
let SERVICE_RET = 5;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(DELTA_STUB, () => { EVENTS.push(["delta", 0]); return DELTA; });
    rt.mem.write32(0x8004df9c, DELTA_STUB);
    rt.cpu.setStub(SERVICE_STUB, (c) => { EVENTS.push(["service", c.reg(4) >>> 0]); return SERVICE_RET; });
    rt.mem.write32(0x80044f4c, SERVICE_STUB);
    for (const [slot, stub] of SLOT_STUBS) {
        rt.mem.write32(OBJ + slot, stub);
        rt.cpu.setStub(stub, (c) => {
            EVENTS.push([`slot${slot.toString(16)}`, c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
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
    SERVICE_RET = o.service ?? 5;
    for (let i = 0; i <= 0x60; i += 4) rt.mem.write32(VIEW + i, 0);
    for (let i = 0; i <= 0x60; i += 4) rt.mem.write32(MARKER + i, 0);
    for (let i = 0; i < 4; i++) rt.mem.write32(ALLOC + i * 4, 0);
    rt.mem.write32(ALLOC + 0x10, OBJ);
    rt.mem.write32(ALLOC + 0x14, OBJ);
    rt.mem.write32(ALLOC + 0x18, OBJ);
    rt.mem.write16(MARKER + 0x00, o.level ?? 0);
    rt.mem.write16(MARKER + 0x04, o.counter ?? 0);
    rt.mem.write16(MARKER + 0x06, o.duration ?? 0);
    rt.mem.write8(MARKER + 0x08, o.state ?? 0);
    rt.mem.write32(SELECTOR, o.selector ?? 0);
    rt.mem.write32(LANGUAGE, o.language ?? 0);
    const idx = o.selector ?? 0;
    for (let i = 0; i < 16; i += 2) rt.mem.write16(TABLE + idx * 0x10 + i, 0);
    if (o.table) {
        for (let i = 0; i < o.table.length; i++) rt.mem.write16(TABLE + idx * 0x10 + i * 2, o.table[i] & 0xffff);
    }
    // Per-index position fields: block 1 stride 0x54 and block 2 stride 0x24.
    for (let i = 0; i < 3; i++) {
        rt.mem.write16(VIEW + i * 0x54 + 0x6c, (o.px ?? 0) >> 0);
        rt.mem.write16(VIEW + i * 0x54 + 0x6e, (o.py ?? 0) >> 0);
        rt.mem.write16(VIEW + i * 0x24 + 0x6c, (o.qx ?? 0) >> 0);
        rt.mem.write16(VIEW + i * 0x24 + 0x6e, (o.qy ?? 0) >> 0);
    }
}

function fields() {
    return [rt.mem.read16(MARKER + 0x00), rt.mem.read16(MARKER + 0x04), rt.mem.read8(MARKER + 0x08)];
}
function events() { return EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v >>> 0 : v))); }
function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        frameDelta() { EVENTS.push(["delta", 0]); return DELTA; },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setPos(x, y) { PORT_DRAW.push(["setPos", [x, y, 0, 0]]); },
        setScale(x, y, z) { PORT_DRAW.push(["setScale", [x, y, z, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        callSlot(obj, slot, a1, a2) {
            EVENTS.push([`slot${slot.toString(16)}`, obj >>> 0, a1 >>> 0, a2 >>> 0]);
            return 0;
        },
        callService44F4C(arg) { EVENTS.push(["service", arg >>> 0]); return SERVICE_RET; },
    };
}

function compare(label, o, addr, isTick, index) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(addr, [VIEW, ALLOC, index, MARKER]);
    const oDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oEvents = events();
    const oFields = fields();

    seed(o);
    const h = portHost();
    if (isTick) turnMarkerFadeTick(rt.mem, VIEW, ALLOC, index, MARKER, h);
    else drawTurnMarker(rt.mem, VIEW, ALLOC, index, MARKER, h);
    assert.deepEqual(events(), oEvents, `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraw, `${label}: draw`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

const TABLE0 = [10, 20, 30, 40, -5, -6, -7, -8];

test("turnMarkerFadeTick matches F0x80099BE4", () => {
    compare("idle", { state: 0, table: TABLE0 }, 0x80099be4, true, 0);
    compare("held", { state: 2, table: TABLE0, level: 0x1000, language: 2 }, 0x80099be4, true, 1);
    compare("grow down", { state: 1, counter: 10, duration: 10, table: TABLE0 }, 0x80099be4, true, 0);
    compare("grow lands", { state: 1, counter: 1, duration: 10, table: TABLE0 }, 0x80099be4, true, 1);
    compare("shrink", { state: 3, counter: 5, duration: 10, table: TABLE0 }, 0x80099be4, true, 0);
    compare("shrink lands", { state: 3, counter: 1, duration: 10, table: TABLE0 }, 0x80099be4, true, 2);
    compare("above three", { state: 4, counter: 2, duration: 5, table: TABLE0 }, 0x80099be4, true, 0);
});

test("drawTurnMarker matches F0x800999A0", () => {
    compare("idle index0", { state: 0, table: TABLE0, px: 100, py: 50 }, 0x800999a0, false, 0);
    compare("idle index1", { state: 0, table: TABLE0, px: 100, py: 50 }, 0x800999a0, false, 1);
    compare("drawn index0", { state: 1, level: 0x800, table: TABLE0, px: 100, py: 50 }, 0x800999a0, false, 0);
    compare("drawn index1", { state: 3, level: 0x400, table: TABLE0, px: 100, py: 50 }, 0x800999a0, false, 1);
    compare("state2 text", { state: 2, level: 0x1000, table: TABLE0, qx: 7, qy: 9, language: 4 }, 0x800999a0, false, 0);
    compare("selector 2", { state: 2, table: TABLE0, selector: 2, language: 1 }, 0x800999a0, false, 2);
    // Distinct block-1 (stride 0x54) and block-2 (stride 0x24) fields so a
    // stride mix-up cannot hide.
    compare("state2 index1 distinct", { state: 2, table: TABLE0, px: 100, py: 50, qx: 7, qy: 9, language: 4 }, 0x800999a0, false, 1);
});
