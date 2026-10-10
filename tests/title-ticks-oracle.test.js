// Phase 4 oracle: engine/dw3/ui/title-ticks.ts must match pro/stdwtitl's glow,
// wordmark and logo ticks plus the wordmark/logo draw bodies. The original runs
// through engine/native with the state setters and pack resolver stubbed; the
// port calls its own translated draw bodies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    titleGlowTick, titleWordmarkTick, titleLogoTick, titleWordmarkDraw, titleLogoDraw,
} from "../engine/dw3/ui/title-ticks.ts";
import {
    titleJpGlowTick, titleJpWordmarkTick, titleJpLogoTick,
    titleJpGlowDraw, titleJpWordmarkDraw, titleJpLogoDraw,
} from "../engine/dw3/ui/title-japanese.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const PACK_STUB = 0x0fec0000;
const PACK_PTR = 0x80190000;
const PACK_HANDLE = 0x7abc;
const SET0 = 0x0fec0100;
const SET1 = 0x0fec0110;
const ADV0 = 0x0fec0120;
const ADV1 = 0x0fec0130;
const ARITY = { setOrigin: 2, setLayer: 2, setDepth: 2, "m_0x88": 1, drawSprite: 4 };

let EVENTS = [];
let DRAW = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, () => PACK_PTR);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(SET0, (c) => { EVENTS.push(["setState0", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(SET1, (c) => { EVENTS.push(["setState1", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(ADV0, (c) => { EVENTS.push(["advance0", c.reg(4)]); return 0; });
    rt.cpu.setStub(ADV1, (c) => { EVENTS.push(["advance1", c.reg(4)]); return 0; });
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    DRAW = [];
    rt.mem.write32(0x80088234, PACK_HANDLE);
    for (let i = 0; i < 0x68; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x0c, o.state0 ?? 0);
    rt.mem.write32(OBJ + 0x10, o.state1 ?? 0);
    rt.mem.write32(OBJ + 0x54, o.script ?? 0);
    rt.mem.write32(OBJ + 0x50, o.f50 ?? 1);
    rt.mem.write32(OBJ + 0x58, o.f58 ?? 0);
    rt.mem.write32(OBJ + 0x5c, o.f5c ?? 0);
    rt.mem.write32(OBJ + 0x60, o.f60 ?? 0x1000);
    rt.mem.write32(OBJ + 0x28, SET0);
    rt.mem.write32(OBJ + 0x2c, SET1);
    rt.mem.write32(OBJ + 0x38, ADV0);
    rt.mem.write32(OBJ + 0x3c, ADV1);
}

function fields() {
    return [0x0c, 0x10, 0x50, 0x54, 0x58, 0x5c].map((off) => rt.mem.read32(OBJ + off) >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        setState0(o, n) { EVENTS.push(["setState0", o >>> 0, n | 0]); },
        setState1(o, n) { EVENTS.push(["setState1", o >>> 0, n | 0]); },
        advance0(o) { EVENTS.push(["advance0", o >>> 0]); },
        advance1(o) { EVENTS.push(["advance1", o >>> 0]); },
    };
}

function portDrawHost() {
    return {
        initDrawContext() {},
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setDepth(x, y) { DRAW.push(["setDepth", [x, y, 0, 0]]); },
        setFrame(n) { DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
    };
}

function runTick(label, addr, port, o) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(addr, [OBJ]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = fields();

    seed(o);
    port(rt.mem, OBJ, portHost(), portDrawHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
    assert.deepEqual(normDraw(DRAW), oracleDraw, `${label}: draw`);
    assert.deepEqual(fields(), oracleFields, `${label}: fields`);
}

test("titleGlowTick matches F0x800843A4", () => {
    runTick("idle flag set", 0x800843a4, titleGlowTick, { state0: 0, f50: 1 });
    runTick("idle flag clear", 0x800843a4, titleGlowTick, { state0: 0, f50: 0 });
    runTick("idle out", 0x800843a4, titleGlowTick, { state0: 2, state1: 0 });
    runTick("script start", 0x800843a4, titleGlowTick, { state0: 1, state1: 1, script: 0 });
    runTick("script middle", 0x800843a4, titleGlowTick, { state0: 1, state1: 2, script: 5 });
    runTick("script end", 0x800843a4, titleGlowTick, { state0: 1, state1: 2, script: 23 });
    runTick("state 3 idle", 0x800843a4, titleGlowTick, { state0: 3 });
});

test("titleWordmarkTick matches F0x80084CD4", () => {
    runTick("setup", 0x80084cd4, titleWordmarkTick, { state0: 0 });
    runTick("slide start", 0x80084cd4, titleWordmarkTick, { state0: 1, state1: 1, script: 10 });
    runTick("slide end", 0x80084cd4, titleWordmarkTick, { state0: 1, state1: 2, script: 0 });
    runTick("idle out", 0x80084cd4, titleWordmarkTick, { state0: 2, state1: 0 });
    runTick("unknown substate", 0x80084cd4, titleWordmarkTick, { state0: 1, state1: 3 });
});

test("titleLogoTick matches F0x80085160", () => {
    runTick("setup", 0x80085160, titleLogoTick, { state0: 0 });
    runTick("slide start", 0x80085160, titleLogoTick, { state0: 1, state1: 1, script: 10 });
    runTick("slide middle", 0x80085160, titleLogoTick, { state0: 1, state1: 2, script: 7 });
    runTick("slide end", 0x80085160, titleLogoTick, { state0: 1, state1: 2, script: 0 });
    runTick("idle out", 0x80085160, titleLogoTick, { state0: 2, state1: 0 });
});

function compareDrawBody(label, addr, port) {
    seed({ f58: 0x40, f5c: 0x50, f60: 0x1000 });
    const before = rt.drawCalls.length;
    rt.cpu.call(addr, [OBJ]);
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;

    seed({ f58: 0x40, f5c: 0x50, f60: 0x1000 });
    port(rt.mem, OBJ, portDrawHost());
    assert.deepEqual(normDraw(DRAW), oracleDraw, `${label}: draw`);
}

test("titleWordmarkDraw matches F0x80084C3C", () => {
    compareDrawBody("wordmark", 0x80084c3c, titleWordmarkDraw);
});

test("titleLogoDraw matches F0x800850C8", () => {
    compareDrawBody("logo", 0x800850c8, titleLogoDraw);
});

test("Japanese title ticks match the original screen", () => {
    for (const [name, addr, port] of [
        ["glow", 0x800840a8, titleJpGlowTick],
        ["wordmark", 0x80084a70, titleJpWordmarkTick],
        ["logo", 0x80084edc, titleJpLogoTick],
    ]) {
        runTick(`${name} setup`, addr, port, { state0: 0, f50: 0 });
        runTick(`${name} slide start`, addr, port, { state0: 1, state1: 1 });
        runTick(`${name} slide middle`, addr, port, { state0: 1, state1: 2, script: 5 });
        runTick(`${name} settled`, addr, port, { state0: 2, state1: 0 });
    }
    runTick("jp glow last script step", 0x800840a8, titleJpGlowTick,
        { state0: 1, state1: 2, script: 11 });
});

test("Japanese title draws match the original screen", () => {
    compareDrawBody("jp logo", 0x80084e44, titleJpLogoDraw);
    compareDrawBody("jp wordmark", 0x800849d8, titleJpWordmarkDraw);
    compareDrawBody("jp glow", 0x80083f80, titleJpGlowDraw);
});
