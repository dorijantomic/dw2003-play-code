// Phase 4 oracle: engine/dw3/ui/title-draw.ts must match pro/stdwtitl's six
// draw helpers (family B). Each original runs through engine/native with the
// runtime's draw-context stubs and the pack resolver stub; the port uses an
// equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    titleDecoLayerDraw, titleNumeralGlowDraw, titleMenuDraw, titleBackgroundDraw,
    titleTwinkleSetupDraw, titleTwinkleStepper,
} from "../engine/dw3/ui/title-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const PACK_STUB = 0x0feb0000;
const PACK_PTR = 0x80190000;
const PACK_HANDLE = 0x7abc;
const ARITY = { setOrigin: 2, setLayer: 2, setDepth: 2, "m_0x88": 1, drawSprite: 4 };

let EVENTS = [];
let DRAW = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4)]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    DRAW = [];
    rt.mem.write32(0x80088234, PACK_HANDLE);
    for (let i = 0; i < 0xa8; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write16(OBJ + 0x54, o.f54 ?? 1);
    rt.mem.write16(OBJ + 0x58, o.f58 ?? 3);
    rt.mem.write8(OBJ + 0x59, o.f59 ?? 0);
    rt.mem.write16(OBJ + 0x5a, o.f5a ?? 0);
    rt.mem.write16(OBJ + 0x56, o.f56 ?? 0);
    rt.mem.write16(OBJ + 0x5c, o.f5c ?? 0);
    rt.mem.write16(OBJ + 0x60, o.f60 ?? 0);
    rt.mem.write16(OBJ + 0x62, o.f62 ?? 0);
    rt.mem.write32(OBJ + 0x68, o.f68 ?? 0x1000);
    rt.mem.write32(OBJ + 0x7c, o.f7c ?? 0x1000);
    rt.mem.write32(OBJ + 0x8c, o.f8c ?? 0x1000);
    rt.mem.write16(OBJ + 0x6c, o.f6c ?? 0);
    rt.mem.write16(OBJ + 0x70, o.f70 ?? 0);
    if (o.lang !== undefined) rt.mem.write32(0x8005cca8, o.lang);
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        initDrawContext() {},
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setDepth(x, y) { DRAW.push(["setDepth", [x, y, 0, 0]]); },
        setFrame(n) { DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
    };
}

function compareDraw(label, addr, o, port) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(addr, [OBJ]);
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleResolve = EVENTS.map((e) => [e[0], e[1] >>> 0]);

    seed(o);
    port(rt.mem, OBJ, portHost());
    assert.deepEqual(normDraw(DRAW), oracleDraw, `${label}: draw`);
    assert.deepEqual(EVENTS.map((e) => [e[0], (e[1] ?? 0) >>> 0]), oracleResolve, `${label}: resolve`);
}

test("titleDecoLayerDraw matches F0x80083054", () => {
    compareDraw("gate off", 0x80083054, { f54: 0 }, titleDecoLayerDraw);
    compareDraw("three layers", 0x80083054, { f54: 1, f5a: 4, f62: 7 }, titleDecoLayerDraw);
});

test("titleNumeralGlowDraw matches F0x8008426C", () => {
    compareDraw("both off", 0x8008426c, { f5c: 0, f58: -1 }, titleNumeralGlowDraw);
    compareDraw("glow only", 0x8008426c, { f5c: 1, f58: -1 }, titleNumeralGlowDraw);
    compareDraw("numeral only", 0x8008426c, { f5c: 0, f58: 5 }, titleNumeralGlowDraw);
    compareDraw("both on", 0x8008426c, { f5c: 1, f58: 5 }, titleNumeralGlowDraw);
});

test("titleMenuDraw matches F0x800852F0", () => {
    compareDraw("prompt row 0", 0x800852f0, { f56: 0, f5a: 0, f58: 0, lang: 0 }, titleMenuDraw);
    compareDraw("prompt row 2", 0x800852f0, { f56: 0, f5a: 2, f58: 1, f59: 2, lang: 3 }, titleMenuDraw);
    compareDraw("split box row 1", 0x800852f0, { f56: 1, f5a: 1, f58: 1, f5c: 79, f60: 166, f6c: 79, f70: 174, lang: 2 }, titleMenuDraw);
});

test("titleBackgroundDraw matches F0x80086108", () => {
    compareDraw("three slices", 0x80086108, { f7c: 0x1002 }, titleBackgroundDraw);
});

function seedTwinkle(o = {}) {
    EVENTS = [];
    DRAW = [];
    rt.mem.write32(0x80088234, PACK_HANDLE);
    for (let i = 0; i < 0xa8; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x7c, o.f7c ?? 0x1000);
    // The eight twinkle state blocks live at +0x54..+0x70; seed them cleanly
    // (the generic seed's menu/glow fields overlap this region).
    for (let i = 0; i < 8; i++) {
        rt.mem.write16(OBJ + 0x54 + i * 4, o[`i${i}`] ?? 0);
        rt.mem.write16(OBJ + 0x56 + i * 4, o[`t${i}`] ?? 0);
    }
    rt.mem.write16(OBJ + 0x74, o.x6 ?? 10);
    rt.mem.write16(OBJ + 0x76, o.y6 ?? 20);
    rt.mem.write16(OBJ + 0x78, o.x7 ?? 30);
    rt.mem.write16(OBJ + 0x7a, o.y7 ?? 40);
}

test("titleTwinkleSetupDraw matches F0x80086228", () => {
    const seeds = [{}, { f7c: 0x1003 }, { i2: 1, t2: 0, i5: 2, t5: 0 }];
    for (const o of seeds) {
        seedTwinkle(o);
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80086228, [OBJ]);
        const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
        rt.drawCalls.length = before;
        const oracleResolve = EVENTS.map((e) => [e[0], e[1] >>> 0]);
        const oracleStates = [];
        for (let i = 0; i < 8; i++) oracleStates.push([rt.mem.read16s(OBJ + 0x54 + i * 4), rt.mem.read16s(OBJ + 0x56 + i * 4)]);

        seedTwinkle(o);
        titleTwinkleSetupDraw(rt.mem, OBJ, portHost());
        assert.deepEqual(normDraw(DRAW), oracleDraw, "twinkle: draw");
        assert.deepEqual(EVENTS.map((e) => [e[0], (e[1] ?? 0) >>> 0]), oracleResolve, "twinkle: resolve");
        const portStates = [];
        for (let i = 0; i < 8; i++) portStates.push([rt.mem.read16s(OBJ + 0x54 + i * 4), rt.mem.read16s(OBJ + 0x56 + i * 4)]);
        assert.deepEqual(portStates, oracleStates, "twinkle: states");
    }
});

function seedStepper(entries, index, timer, flag) {
    const TABLE = 0x80200000;
    const STATE = 0x80201000;
    for (const [clip, dur] of entries) {
        rt.mem.write16(TABLE, clip);
        rt.mem.write16(TABLE + 2, dur);
    }
    for (let i = 0; i < entries.length; i++) {
        rt.mem.write16(TABLE + i * 4, entries[i][0]);
        rt.mem.write16(TABLE + i * 4 + 2, entries[i][1]);
    }
    rt.mem.write16(STATE, index);
    rt.mem.write16(STATE + 2, timer);
    return { TABLE, STATE, flag };
}

test("titleTwinkleStepper matches F0x8008605C", () => {
    const cases = [
        { entries: [[5, 10], [6, 20], [0x12c, 30], [0xff, 0]], index: 0, timer: 1, flag: 0 },
        { entries: [[5, 10], [6, 20], [0x12c, 30], [0xff, 0]], index: 0, timer: 0, flag: 0 },
        { entries: [[5, 10], [6, 20], [0x12c, 30], [0xff, 0]], index: 2, timer: 0, flag: 0 },
        { entries: [[5, 10], [6, 0], [7, 4], [0xff, 0]], index: 0, timer: 0, flag: 0 },
        { entries: [[5, 10], [6, 20], [7, 30], [0xff, 0]], index: 0, timer: 0, flag: 3 },
        { entries: [[8, 5], [9, 5]], index: 1, timer: -2, flag: 0 },
    ];
    for (const c of cases) {
        const { TABLE, STATE, flag } = seedStepper(c.entries, c.index, c.timer, c.flag);
        const oracleRet = rt.cpu.call(0x8008605c, [STATE, TABLE, flag]) | 0;
        const oracleState = [rt.mem.read16s(STATE), rt.mem.read16s(STATE + 2)];

        seedStepper(c.entries, c.index, c.timer, c.flag);
        const port = titleTwinkleStepper(rt.mem, STATE, TABLE, flag) | 0;
        assert.equal(port, oracleRet, `ret idx=${c.index} t=${c.timer} f=${flag}`);
        assert.deepEqual([rt.mem.read16s(STATE), rt.mem.read16s(STATE + 2)], oracleState,
            `state idx=${c.index} t=${c.timer} f=${flag}`);
    }
});
