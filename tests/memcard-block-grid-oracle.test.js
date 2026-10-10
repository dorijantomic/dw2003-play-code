// Phase 4 oracle: engine/dw3/ui/memcard-block-grid.ts create / reset /
// place-cursor / tick must match pro/stgmcard F0x800849F0 / F0x80084328 /
// F0x80084240 / F0x800843D8. The original runs through engine/native with the
// object factory, the 8.8 tween pair, the pad service, the card refresh, the
// widget factory and the draw-context methods stubbed; the port uses an
// equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    memcardBlockGridCreate,
    memcardBlockGridPlaceCursor,
    memcardBlockGridReset,
    memcardBlockGridTick,
} from "../engine/dw3/ui/memcard-block-grid.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgmcard = new Uint8Array(readFileSync(join(dir, "pro_stgmcard.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgmcard.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const GRID = 0x80180000;
const PARENT = 0x80181000;
const WIDGET = 0x80182000;
const WIDGET_PTR = 0x80183000;
const PACK_STUB = 0x0fdf0000;
const PACK_PTR = 0x80190000;
const SOURCE = 0x80191000;
const ADV_STATE = 0x800142ac;
const SHARED = 0x80088768;
const TWEEN_START_STUB = 0x0fdf0010;
const TWEEN_TICK_STUB = 0x0fdf0020;
const REFRESH_STUB = 0x0fdf0030;
const CREATE_STUB = 0x0fdf0040;
const LINE0_STUB = 0x0fdf0050;
const NUMBER_STUB = 0x0fdf0060;
const CLEAR_STUB = 0x0fdf0070;
const POSITION_STUB = 0x0fdf0080;
const PAD_PRESSED_STUB = 0x0fdf0090;
const PAD_REPEAT_STUB = 0x0fdf00a0;
const PAD_BIT_STUB = 0x0fdf00b0;
const SOUND_STUB = 0x0fdf00c0;
const RESOURCE_STUB = 0x0fdf00d0;
const FRAME = 5000;
const ARITY = { setOrigin: 2, setLayer: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };

let EVENTS = [];
let DRAW = [];
let WIDGET_NEXT = 0;
let TWEEN_TICK = 0;
let PAD_PRESSED = 0;
let PAD_REPEAT = 0;
let PAD_MAP = 0;

function runtime() {
    const rt = new NativeStageRuntime(stgmcard, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8004de20, FRAME);
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        return GRID;
    });
    rt.cpu.setStub(TWEEN_START_STUB, (c) => {
        EVENTS.push(["tweenStart", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        return 0;
    });
    rt.mem.write32(SHARED + 0x30, TWEEN_START_STUB);
    rt.cpu.setStub(TWEEN_TICK_STUB, (c) => {
        EVENTS.push(["tweenTick", c.reg(4)]);
        return TWEEN_TICK;
    });
    rt.mem.write32(SHARED + 0x34, TWEEN_TICK_STUB);
    rt.cpu.setStub(0x8001ae38, (c) => {
        EVENTS.push(["create", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        return WIDGET;
    });
    rt.cpu.setStub(LINE0_STUB, (c) => { EVENTS.push(["line0", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(NUMBER_STUB, (c) => { EVENTS.push(["number", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(CLEAR_STUB, (c) => { EVENTS.push(["clear", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(POSITION_STUB, (c) => { EVENTS.push(["position", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(REFRESH_STUB, (c) => { EVENTS.push(["refresh", c.reg(4)]); return 0; });
    rt.cpu.setStub(PAD_PRESSED_STUB, (c) => { EVENTS.push(["padPressed", c.reg(4)]); return PAD_PRESSED; });
    rt.mem.write32(0x8004b7d0 + 0x3f4, PAD_PRESSED_STUB);
    rt.cpu.setStub(PAD_REPEAT_STUB, (c) => { EVENTS.push(["padRepeat", c.reg(4)]); return PAD_REPEAT; });
    rt.mem.write32(0x8004b7d0 + 0x3fc, PAD_REPEAT_STUB);
    rt.cpu.setStub(PAD_BIT_STUB, (c) => { EVENTS.push(["padBit", c.reg(4), c.reg(5)]); return PAD_MAP; });
    rt.mem.write32(0x8004b7d0 + 0x408, PAD_BIT_STUB);
    rt.cpu.setStub(SOUND_STUB, (c) => { EVENTS.push(["sound", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c48, SOUND_STUB);
    rt.cpu.setStub(RESOURCE_STUB, (c) => { EVENTS.push(["resource", c.reg(4)]); return SOURCE; });
    rt.mem.write32(0x80044f4c, RESOURCE_STUB);
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

function seedGrid(o) {
    EVENTS = [];
    DRAW = [];
    WIDGET_NEXT = 0;
    TWEEN_TICK = o.tweenTick ?? 0;
    PAD_PRESSED = o.pressed ?? 0;
    PAD_REPEAT = o.repeat ?? 0;
    PAD_MAP = o.map ?? 0;
    const index = o.index ?? 0;
    const previous = o.previous ?? 0;
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(GRID + i, 0);
    rt.mem.write32(GRID + 0x38, ADV_STATE);
    rt.mem.write32(GRID + 0x0c, o.state ?? 0);
    rt.mem.write32(GRID + 0x10, o.substate ?? 0);
    rt.mem.write32(GRID + 0x50, PARENT);
    rt.mem.write32(GRID + 0x54, o.target ?? 0x1000);
    rt.mem.write32(GRID + 0x58, o.bucket ?? 2);
    rt.mem.write32(GRID + 0x80, o.scrollY ?? 0);
    rt.mem.write32(GRID + 0x9c, o.scrollX ?? 0);
    rt.mem.write32(GRID + 0xb8, o.cursorX ?? 0);
    rt.mem.write32(GRID + 0xcc, o.result ?? 0xdead);
    rt.mem.write32(GRID + 0xd0, o.stamp ?? FRAME);
    rt.mem.write32(GRID + 0xd4, o.clutFrame ?? 0);
    rt.mem.write32(GRID + 0xd8, o.clutDir ?? 0);
    rt.mem.write32(GRID + 0x64, o.screen64 ?? 0x11);
    // shared block
    rt.mem.write32(SHARED + 0x4, index);
    rt.mem.write32(SHARED + 0x8, previous);
    // parent screen: record slots and the refresh method slot
    for (let i = 0; i < 4; i++) {
        const rec = PARENT + i * 0x44;
        rt.mem.write8(rec + 0x74, 0);
        rt.mem.write32(rec + 0xa4, 0);
    }
    const recs = o.records ?? [];
    for (let i = 0; i < recs.length; i++) {
        const rec = PARENT + i * 0x44;
        rt.mem.write8(rec + 0x74, recs[i] ? 1 : 0);
        rt.mem.write32(rec + 0xa4, recs[i]);
    }
    rt.mem.write32(PARENT + 0x64, o.parent64 ?? 0x20);
    rt.mem.write32(PARENT + 0x2854, REFRESH_STUB);
    // label widget slot
    const hasWidget = o.hasWidget ?? true;
    rt.mem.write32(WIDGET_PTR, hasWidget ? WIDGET : 0);
    for (let i = 0; i < 0x180; i += 4) rt.mem.write32(WIDGET + i, 0);
    rt.mem.write32(WIDGET + 0x114, LINE0_STUB);
    rt.mem.write32(WIDGET + 0x118, NUMBER_STUB);
    rt.mem.write32(WIDGET + 0x134, POSITION_STUB);
    rt.mem.write32(WIDGET + 0x144, CLEAR_STUB);
}

function gridFields() {
    const out = [];
    for (let i = 0; i < 0x100; i += 4) out.push(rt.mem.read32(GRID + i) >>> 0);
    out.push(rt.mem.read32(SHARED + 0x4) >>> 0, rt.mem.read32(SHARED + 0x8) >>> 0);
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
        allocGrid(handler, size, extra) { EVENTS.push(["alloc", handler, size, extra]); return GRID; },
        tweenStart(obj, from, to, steps) { EVENTS.push(["tweenStart", obj, from, to, steps]); },
        tweenTick(obj) { EVENTS.push(["tweenTick", obj]); return TWEEN_TICK; },
        advancePhase(o) {
            const v = (rt.mem.read32(o + 0xc) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0xc, v);
            EVENTS.push(["advance", o]);
        },
        resourceGetBase(id) { EVENTS.push(["resource", id]); return SOURCE; },
        createTextElement(target, kind, x, y) {
            EVENTS.push(["create", target, kind, x, y]);
            WIDGET_NEXT++;
            return WIDGET;
        },
        widgetSetLine0(widget, source, index) { EVENTS.push(["line0", widget, source, index]); },
        widgetSetNumber(widget, a1, value) { EVENTS.push(["number", widget, a1, value]); },
        widgetClear(widget, value) { EVENTS.push(["clear", widget, value]); },
        widgetSetPosition(widget, x, y) { EVENTS.push(["position", widget, x, y]); },
        refreshCard(parent) { EVENTS.push(["refresh", parent >>> 0]); },
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
        padPressed(port) { EVENTS.push(["padPressed", port]); return PAD_PRESSED; },
        padRepeat(port) { EVENTS.push(["padRepeat", port]); return PAD_REPEAT; },
        padBit(port, logical) { EVENTS.push(["padBit", port, logical]); return PAD_MAP; },
        initDrawContext() {},
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        paletteShift(v) { DRAW.push(["m_0x88", [v, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
        frameTick() { return rt.mem.read32(0x8004de20) | 0; },
        languageIndex() { return rt.mem.read32(0x8005cca8) | 0; },
    };
}

function runCase(label, o) {
    seedGrid(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x800843d8, [GRID, WIDGET_PTR]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = gridFields();

    seedGrid(o);
    memcardBlockGridTick(rt.mem, GRID, WIDGET_PTR, portHost());
    const portEvents = norm(EVENTS.slice());
    const portDraw = normDraw(DRAW);
    const portFields = gridFields();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portDraw, oracleDraw, `${label}: draw`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("memcardBlockGridCreate matches F0x800849F0", () => {
    seedGrid({});
    EVENTS = [];
    rt.cpu.call(0x800849f0, [PARENT]);
    const oracleAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const oracleFields = [0x50, 0x54, 0x58, 0xdc, 0xe0, 0xe4, 0xe8, 0xec, 0xf0].map((off) => rt.mem.read32(GRID + off) >>> 0);

    seedGrid({});
    EVENTS = [];
    const grid = memcardBlockGridCreate(rt.mem, PARENT, {
        allocGrid(handler, size, extra) { EVENTS.push(["alloc", handler, size, extra]); return GRID; },
        tweenStart() {},
    });
    assert.equal(grid, GRID);
    const portAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const portFields = [0x50, 0x54, 0x58, 0xdc, 0xe0, 0xe4, 0xe8, 0xec, 0xf0].map((off) => rt.mem.read32(GRID + off) >>> 0);
    assert.deepEqual(portAlloc, oracleAlloc, "alloc");
    assert.deepEqual(portFields, oracleFields, "fields");
});

test("memcardBlockGridReset matches F0x80084328", () => {
    seedGrid({ substate: 5, result: 0x99, index: 1, previous: 2 });
    rt.cpu.call(0x80084328, [GRID]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = gridFields();

    seedGrid({ substate: 5, result: 0x99, index: 1, previous: 2 });
    memcardBlockGridReset(rt.mem, GRID, { allocGrid() { return GRID; }, tweenStart(o, f, t, s) { EVENTS.push(["tweenStart", o, f, t, s]); } });
    const portEvents = norm(EVENTS.slice());
    const portFields = gridFields();
    assert.deepEqual(portEvents, oracleEvents, "calls");
    assert.deepEqual(portFields, oracleFields, "fields");
});

test("memcardBlockGridPlaceCursor matches F0x80084240", () => {
    seedGrid({ index: 2, previous: 0 });
    rt.cpu.call(0x80084240, [GRID]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = gridFields();

    seedGrid({ index: 2, previous: 0 });
    memcardBlockGridPlaceCursor(rt.mem, GRID, { allocGrid() { return GRID; }, tweenStart(o, f, t, s) { EVENTS.push(["tweenStart", o, f, t, s]); } });
    const portEvents = norm(EVENTS.slice());
    const portFields = gridFields();
    assert.deepEqual(portEvents, oracleEvents, "calls");
    assert.deepEqual(portFields, oracleFields, "fields");
});

test("memcardBlockGridTick matches F0x800843D8", () => {
    runCase("state 0 empty widget", { state: 0, hasWidget: false });
    runCase("state 0 existing widget", { state: 0, hasWidget: true });
    runCase("state 4 opens", { state: 4 });
    runCase("state 2 idle", { state: 2 });
    runCase("state 3 idle", { state: 3 });
    runCase("sub 0 draws", { state: 1, substate: 0 });
    runCase("sub 8 draws", { state: 1, substate: 8 });
    runCase("sub 1 waits", { state: 1, substate: 1, tweenTick: 0 });
    runCase("sub 1 lands", { state: 1, substate: 1, tweenTick: 1 });
    runCase("sub 2 lands", { state: 1, substate: 2, tweenTick: 1 });
    runCase("sub 3 lands", { state: 1, substate: 3, tweenTick: 1 });
    runCase("sub 4 resets", { state: 1, substate: 4, tweenTick: 1 });
    runCase("sub 5 places", { state: 1, substate: 5, tweenTick: 1, index: 2 });
    runCase("sub 7 arms pad", { state: 1, substate: 7, tweenTick: 1 });
    runCase("sub 6 no pad", { state: 1, substate: 6 });
    runCase("sub 6 left moves", { state: 1, substate: 6, index: 2, pressed: 1 << 7, map: 0 });
    runCase("sub 6 left clamps", { state: 1, substate: 6, index: 0, pressed: 1 << 7, map: 0 });
    runCase("sub 6 left repeats", { state: 1, substate: 6, index: 1, repeat: 1 << 7, map: 0 });
    runCase("sub 6 right moves", { state: 1, substate: 6, index: 0, pressed: 1 << 5, map: 0 });
    runCase("sub 6 right clamps", { state: 1, substate: 6, index: 2, pressed: 1 << 5, map: 0 });
    runCase("sub 6 shifted map", { state: 1, substate: 6, index: 1, pressed: 1 << 3, map: 7 });
    runCase("draw records", { state: 1, substate: 0, records: [3, 4, 2], scrollY: 0x14, scrollX: 0x1e, cursorX: 8, screen64: 0x11 });
    runCase("clut advance", { state: 1, substate: 0, stamp: FRAME - 3, clutFrame: 3, clutDir: 0 });
    runCase("clut wrap", { state: 1, substate: 0, stamp: FRAME - 3, clutFrame: 0xb, clutDir: 0 });
    runCase("clut decay", { state: 1, substate: 0, stamp: FRAME - 3, clutFrame: 4, clutDir: 1 });
    runCase("clut decay end", { state: 1, substate: 0, stamp: FRAME - 3, clutFrame: 1, clutDir: 1 });
});
