// Phase 4 oracle: engine/dw3/ui/duel-view.ts must match pro/cardgame's
// F0x8009BBA8 (cardDuelViewTick) and F0x80099F60 (boardViewDraw). Both
// originals run through engine/native on the shipped pro_cardgame.bin +
// resident.bin; the constructors, the view handler, the services and the draw
// context are recording stubs, and the port uses an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { boardViewDraw, cardDuelViewTick } from "../engine/dw3/ui/duel-view.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80180000;
const RC = 0x80181000;
const SCRATCH = 0x80170000;
const PACK_STUB = 0x0feb0000;
const DELTA_STUB = 0x0fe20000;
const BANK_STUB = 0x0fe70000;
const FETCH_STUB = 0x0fed0000;
const CLOSE_STUB = 0x0fea0000;
const HANDLER_STUB = 0x0fe60000;
const METHOD_STUB = 0x0fe50000;
const PACK_PTR = 0x80190000;
const PLATE_PTR = 0x80200000;
const WIDGET_PTR = (k) => (0x80201000 + k * 0x200) >>> 0;
const CTX_ARITY = { setOrigin: 2, setLayer: 2, setPos: 2, setScale: 3, drawSprite: 4, setFrame: 1, m_0x88: 1 };

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
    rt.cpu.setStub(BANK_STUB, (c) => { EVENTS.push(["bankGet", c.reg(4) >>> 0]); return 0x1234; });
    rt.mem.write32(0x80044f4c, BANK_STUB);
    rt.cpu.setStub(0x8001fcc0, (c) => { rt.mem.write32(c.reg(4) + 4, FETCH_STUB); return 0; });
    rt.cpu.setStub(FETCH_STUB, (c) => {
        EVENTS.push(["measure", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]);
        return 42;
    });
    rt.cpu.setStub(CLOSE_STUB, (c) => { EVENTS.push(["close", c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(HANDLER_STUB, (c) => { EVENTS.push(["advancePhase", HANDLER_STUB, c.reg(4) >>> 0]); return 0; });
    return rt;
}

const rt = runtime();

function seedSetup() {
    for (let i = 0; i < 0x120; i += 4) rt.mem.write32(VIEW + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(RC + i, 0xdead0000);
    rt.mem.write32(VIEW + 0x38, HANDLER_STUB);
    rt.mem.write32(VIEW + 0x0c, 0);
    rt.mem.write32(PLATE_PTR + 0x80, METHOD_STUB + 0x80);
    rt.cpu.setStub(METHOD_STUB + 0x80, (c) => {
        EVENTS.push(["w", 0x80, c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
        return 0;
    });
    for (let k = 0; k < 13; k++) {
        rt.mem.write32(WIDGET_PTR(k) + 0x160, METHOD_STUB + 0x160);
    }
    rt.cpu.setStub(METHOD_STUB + 0x160, (c) => {
        EVENTS.push(["w", 0x160, c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
        return 0;
    });
    rt.cpu.setStub(0x8001b364, (c) => {
        EVENTS.push(["plate", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return PLATE_PTR;
    });
    let created = 0;
    rt.cpu.setStub(0x8001ae38, (c) => {
        EVENTS.push(["create", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return WIDGET_PTR(created++);
    });
}

function seedFrame(o = {}) {
    for (let i = 0; i < 0x1200; i += 4) rt.mem.write32(VIEW + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(RC + i, 0);
    // Both panel records mid-slide, both marker records fading, one float
    // number parked: the board view then really draws and writes.
    for (let side = 0; side < 2; side++) {
        const p = VIEW + 0x60 + side * 0x54;
        rt.mem.write16(p + 0x00, 5); rt.mem.write16(p + 0x02, 10);
        rt.mem.write16(p + 0x04, 1); rt.mem.write16(p + 0x06, 0);
        rt.mem.write32(p + 0x08, (o.phase ?? 7) >>> 0);
        rt.mem.write16(p + 0x0c, 0); rt.mem.write16(p + 0x0e, (side === 0 ? 0x8d : 0) & 0xffff);
        rt.mem.write16(p + 0x10, 0x123); rt.mem.write16(p + 0x12, 0x456);
        for (let i = 0; i < 5; i++) rt.mem.write8(p + 0x18 + i, i + 1);
        rt.mem.write8(p + 0x1d, 7); rt.mem.write8(p + 0x1e, 9);
        rt.mem.write16(p + 0x20, 288); rt.mem.write16(p + 0x22, (side === 0 ? 0x8f : 0x50) & 0xffff);
        rt.mem.write16(p + 0x28, 33);
        for (let i = 0; i < 5; i++) rt.mem.write8(p + 0x30 + i, i === side ? 1 : 0);
        rt.mem.write16(p + 0x3c, 0x113); rt.mem.write16(p + 0x3e, 0xbd);
        rt.mem.write32(p + 0x44, 1);
        const m = VIEW + 0xa8 + side * 0x54;
        rt.mem.write16(m + 0x04, 5); rt.mem.write16(m + 0x06, 10); rt.mem.write8(m + 0x08, 1);
        const f = VIEW + 0xce8 + (side * 0x12);
        rt.mem.write16(f + 0x00, 10 + side); rt.mem.write16(f + 0x02, 20 + side);
        rt.mem.write8(f + 0x10, 1);
    }
    // The marker path reads renderCtx[side]+0x10 as a widget and calls its
    // +0x144 slot; arm both sides with stub objects.
    for (const slot of [0x10, 0x14]) {
        const w = RC + 0x100 + slot;
        rt.mem.write32(RC + slot, w);
        for (const m of [0x114, 0x134, 0x144]) rt.mem.write32(w + m, METHOD_STUB + m);
    }
    for (const m of [0x114, 0x134, 0x144]) {
        rt.cpu.setStub(METHOD_STUB + m, (c) => {
            EVENTS.push(["slot", m, c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
            return 0;
        });
    }
    rt.mem.write32(VIEW + 0x0c, 1);
    rt.mem.write32(VIEW + 0x54, 0x12345678);
    rt.mem.write32(VIEW + 0x58, o.frameSum ?? 100);
    rt.mem.write32(0x8005ccb0, 0);
    rt.mem.write32(0x8005cca8, 2);
    DELTA = o.delta ?? 1;
}

function fields() {
    const out = [rt.mem.read32(VIEW + 0x0c) >>> 0, rt.mem.read32(VIEW + 0x38) >>> 0,
        rt.mem.read32(VIEW + 0x54) >>> 0, rt.mem.read32(VIEW + 0x58) >>> 0];
    // both panel records (0x54 bytes) and both marker records (0x10 each)
    for (const base of [VIEW + 0x60, VIEW + 0xb4]) {
        for (let off = 0; off < 0x54; off += 2) out.push(rt.mem.read16(base + off));
    }
    for (const base of [VIEW + 0xa8, VIEW + 0xfc]) {
        for (let off = 0; off < 0x10; off += 2) out.push(rt.mem.read16(base + off));
    }
    // the float pool's first two entries
    for (let off = 0; off < 0x24; off += 2) out.push(rt.mem.read16(VIEW + 0xce8 + off));
    for (let off = 0; off < 0x38; off += 4) out.push(rt.mem.read32(RC + off) >>> 0);
    return out;
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, CTX_ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function baseHost() {
    return {
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        setPos(x, y) { PORT_DRAW.push(["setPos", [x, y, 0, 0]]); },
        setScale(x, y, z) { PORT_DRAW.push(["setScale", [x, y, z, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        frameDelta() { EVENTS.push(["delta"]); return DELTA; },
        bankGet(h) { EVENTS.push(["bankGet", h >>> 0]); return 0x1234; },
        callWidgetMethod(obj, method, a1, a2) {
            EVENTS.push(["w", method, obj >>> 0, a1 | 0, a2 | 0]);
            return 0;
        },
        measureText(ptr, a1, a2) { EVENTS.push(["measure", ptr >>> 0, a1 >>> 0, a2 | 0]); return 42; },
        callViewClose(fn, view) { EVENTS.push(["close", view >>> 0]); },
        callViewCloseFunction(fn, view) { EVENTS.push(["close", view >>> 0]); },
        drawMessagePlate() { EVENTS.push(["messagePlate"]); },
        drawPileBadgePlate(view, param, index, entry) { EVENTS.push(["pileBadge", view >>> 0, param >>> 0, index | 0, entry >>> 0]); },
        callSlot(obj, slot, a1, a2) { EVENTS.push(["slot", slot, obj >>> 0, a1 | 0, a2 | 0]); return 0; },
        callService44F4C(arg) { EVENTS.push(["bankGet", arg >>> 0]); return 0x1234; },
        callSpriteStateBody(addr, view, sprite, arg) {
            EVENTS.push(["spriteBody", addr >>> 0, view >>> 0, sprite >>> 0, arg | 0]);
            return 0;
        },
        scratch() { for (let i = 0; i < 0x12; i++) rt.mem.write8(SCRATCH + i, 0); return SCRATCH; },
    };
}

function portHost() { return baseHost(); }

function setupHost() {
    let created = 0;
    return Object.assign(baseHost(), {
        callViewHandler(fn, view) { EVENTS.push(["advancePhase", fn >>> 0, view >>> 0]); },
        spawnUiIcon(a, b, c, d) { EVENTS.push(["plate", a | 0, b | 0, c | 0, d | 0]); return PLATE_PTR; },
        createTextElement(a, b, c, d) {
            EVENTS.push(["create", a | 0, b | 0, c | 0, d | 0]);
            return WIDGET_PTR(created++);
        },
    });
}

function compare(label, seedFn, original, port) {
    seedFn();
    EVENTS = [];
    rt.drawCalls.length = 0;
    original();
    const oEvents = EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v)));
    const oDraws = normDraw(rt.drawCalls.map((c) => [c.method, c.args]));
    rt.drawCalls.length = 0;
    const oFields = fields();

    seedFn();
    EVENTS = [];
    PORT_DRAW = [];
    port(rt.mem);
    assert.deepEqual(EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))), oEvents,
        `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraws, `${label}: draw`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

test("cardDuelViewTick setup arm matches F0x8009BBA8", () => {
    compare("setup", seedSetup,
        () => rt.cpu.call(0x8009bba8, [VIEW, RC]),
        (mem) => cardDuelViewTick(mem, VIEW, RC, setupHost()));
    compare("done state returns", () => { seedSetup(); rt.mem.write32(VIEW + 0x0c, 3); },
        () => rt.cpu.call(0x8009bba8, [VIEW, RC]),
        (mem) => cardDuelViewTick(mem, VIEW, RC, setupHost()));
    compare("negative state sets up", () => { seedSetup(); rt.mem.write32(VIEW + 0x0c, -1); },
        () => rt.cpu.call(0x8009bba8, [VIEW, RC]),
        (mem) => cardDuelViewTick(mem, VIEW, RC, setupHost()));
});

test("cardDuelViewTick frame arm matches F0x8009BBA8", () => {
    const frame = (label, o) => compare(label, () => seedFrame(o),
        () => rt.cpu.call(0x8009bba8, [VIEW, RC]),
        (mem) => cardDuelViewTick(mem, VIEW, RC, portHost()));
    frame("idle frame", {});
    frame("delta 4", { delta: 4, frameSum: 0xfff0 });
});

test("boardViewDraw matches F0x80099F60", () => {
    const draw = (label, o) => compare(label, () => seedFrame(o),
        () => rt.cpu.call(0x80099f60, [VIEW, RC]),
        (mem) => boardViewDraw(mem, VIEW, RC, portHost()));
    draw("idle", {});
    draw("markers active", {});
});
