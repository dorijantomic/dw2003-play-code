// Phase 4 oracle: engine/dw3/ui/cardgame-draw.ts must match pro/cardgame's
// F0x80096950 (waitingSpinnerDraw) and F0x80096A94 (drawDigitSprites). Each
// original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin with the frame delta and pack resolver stubbed and the draw
// context recorded; the port uses an equivalent host over the same memory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { waitingSpinnerDraw, drawDigitSprites } from "../engine/dw3/ui/cardgame-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const PACK_STUB = 0x0feb0000;
const PACK_PTR = 0x80190000;
const DELTA_STUB = 0x0fe20000;
const ARITY = { setOrigin: 2, setLayer: 2, setDepth: 2, m_0x88: 1, drawSprite: 4, setPos: 2, setScale: 3 };

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
    rt.cpu.setStub(DELTA_STUB, () => { EVENTS.push(["delta", 0]); return DELTA; });
    rt.mem.write32(0x8004df9c, DELTA_STUB);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    DELTA = o.delta ?? 1;
    for (let i = 0; i <= 0xf00; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x58, o.pos ?? 0);
    rt.mem.write8(OBJ + 0xe9c, o.frame ?? 0);
    rt.mem.write8(OBJ + 0xe9d, o.counter ?? 0);
    rt.mem.write8(OBJ + 0xe9e, o.state ?? 0);
    rt.mem.write16(OBJ + 0x00, o.value ?? 0);
    rt.mem.write16(OBJ + 0x02, o.x ?? 0);
    rt.mem.write16(OBJ + 0x04, o.y ?? 0);
    rt.mem.write16(OBJ + 0x06, o.sx ?? 0);
    rt.mem.write16(OBJ + 0x08, o.sy ?? 0);
    rt.mem.write16(OBJ + 0x0a, o.px ?? 0);
    rt.mem.write16(OBJ + 0x0c, o.py ?? 0);
    rt.mem.write8(OBJ + 0x0e, o.count ?? 1);
    rt.mem.write8(OBJ + 0x0f, o.force ?? 0);
    rt.mem.write8(OBJ + 0x10, o.layer ?? 0);
}

function fields() {
    const out = [];
    for (let off = 0x00; off <= 0x10; off += 2) out.push(rt.mem.read16(OBJ + off));
    out.push(rt.mem.read8(OBJ + 0xe9c), rt.mem.read8(OBJ + 0xe9d), rt.mem.read8(OBJ + 0xe9e));
    out.push(rt.mem.read32(OBJ + 0x58) >>> 0);
    return out;
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        setPos(x, y) { PORT_DRAW.push(["setPos", [x, y, 0, 0]]); },
        setScale(x, y, z) { PORT_DRAW.push(["setScale", [x, y, z, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        frameDelta() { EVENTS.push(["delta", 0]); return DELTA; },
    };
}

function runSpinner(label, o, ticks = 1) {
    seed(o);
    const oracle = [];
    for (let t = 0; t < ticks; t++) {
        EVENTS = [];
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80096950, [OBJ]);
        oracle.push({
            events: EVENTS.map((e) => [e[0], e[1] >>> 0]),
            draws: normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args])),
            fields: fields(),
        });
        rt.drawCalls.length = before;
    }
    seed(o);
    for (let t = 0; t < ticks; t++) {
        EVENTS = [];
        PORT_DRAW = [];
        waitingSpinnerDraw(rt.mem, OBJ, portHost());
        assert.deepEqual(EVENTS.map((e) => [e[0], e[1] >>> 0]), oracle[t].events, `${label} tick ${t}: calls`);
        assert.deepEqual(normDraw(PORT_DRAW), oracle[t].draws, `${label} tick ${t}: draw`);
        assert.deepEqual(fields(), oracle[t].fields, `${label} tick ${t}: fields`);
    }
}

function runDigits(label, o, flag) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80096a94, [OBJ, flag]);
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleEvents = EVENTS.map((e) => [e[0], e[1] >>> 0]);
    const oracleFields = fields();

    seed(o);
    drawDigitSprites(rt.mem, OBJ, flag, portHost());
    assert.deepEqual(EVENTS.map((e) => [e[0], e[1] >>> 0]), oracleEvents, `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oracleDraw, `${label}: draw`);
    assert.deepEqual(fields(), oracleFields, `${label}: fields`);
}

test("waitingSpinnerDraw matches F0x80096950", () => {
    runSpinner("idle", { state: 0 });
    runSpinner("parked", { state: 2, frame: 5 });
    runSpinner("above 2", { state: 4, frame: 3 });
    runSpinner("spinning low counter", { state: 1, counter: 0, frame: 0 });
    runSpinner("spinning step", { state: 1, counter: 4, frame: 3 });
    runSpinner("spinning clamps", { state: 1, counter: 4, frame: 11 });
    runSpinner("position mask", { state: 2, pos: 0x1234 });
    runSpinner("long spin", { state: 1, counter: 0, frame: 0 }, 8);
});

test("drawDigitSprites matches F0x80096A94", () => {
    runDigits("single zero", { value: 0, count: 1 }, 0);
    runDigits("three digits", { value: 123, count: 3, x: 50, y: 20 }, 0);
    runDigits("leading zero kept", { value: 100, count: 3 }, 0);
    runDigits("leading zero skipped", { value: 5, count: 3 }, 0);
    runDigits("force leading zeros", { value: 5, count: 3, force: 1 }, 0);
    runDigits("flag applies pos and scale", { value: 42, count: 2, px: 10, py: 11, sx: 0x800, sy: -0x1000, sx: 0 }, 1);
    runDigits("negative value", { value: -5, count: 2 }, 0);
    runDigits("zero count", { value: 9, count: 0 }, 0);
    runDigits("layer bucket", { value: 7, count: 1, layer: 3 }, 0);
});
