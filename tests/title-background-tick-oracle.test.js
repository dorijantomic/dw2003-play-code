// Phase 4 oracle: engine/dw3/ui/title-background-tick.ts must match pro/stdwtitl
// F0x80086544. The original runs through engine/native with the resident random
// source controlled and the runtime draw stubs; the port uses the already-proven
// titleTwinkleSetupDraw/titleBackgroundDraw and an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { titleBackgroundTick } from "../engine/dw3/ui/title-background-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const PACK_STUB = 0x0fe80000;
const PACK_PTR = 0x80190000;
const RAND_STUB = 0x0fe80010;
const SET_STATE1 = 0x80014288;
const ADVANCE0 = 0x800142ac;
const ARITY = { setOrigin: 2, setLayer: 2, setDepth: 2, m_0x88: 1, drawSprite: 4 };

let EVENTS = [];
let DRAW = [];
let RAND = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4)]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(RAND_STUB, () => { EVENTS.push(["rand"]); return RAND.length ? RAND.shift() : 0; });
    rt.mem.write32(0x8004dc0c, RAND_STUB);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    DRAW = [];
    RAND = [...(o.rand ?? [0, 0, 0, 0])];
    for (let i = 0; i <= 0x98; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x2c, SET_STATE1);
    rt.mem.write32(OBJ + 0x38, ADVANCE0);
    rt.mem.write32(OBJ + 0x0c, (o.state0 ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x10, (o.state1 ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x7c, 0x1000);
    for (let i = 0; i < 8; i++) {
        rt.mem.write16(OBJ + 0x54 + i * 4, (o.tw ?? [])[i]?.[0] ?? 0);
        rt.mem.write16(OBJ + 0x54 + i * 4 + 2, (o.tw ?? [])[i]?.[1] ?? 0);
    }
}

function fields() {
    const out = [];
    for (let off = 0x0c; off <= 0x80; off += 4) out.push(rt.mem.read32(OBJ + off) >>> 0);
    return out;
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
        advance0(o) {
            const v = (rt.mem.read32(o + 0x0c) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0x0c, v);
        },
        setState1(o, s) {
            rt.mem.write32(o + 0x10, s >>> 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        randU16() { EVENTS.push(["rand"]); return RAND.length ? RAND.shift() : 0; },
    };
}

function run(label, o) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80086544, [OBJ]);
    const oracleEvents = EVENTS.map((e) => [e[0], (e[1] ?? 0) >>> 0]);
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = fields();

    seed(o);
    titleBackgroundTick(rt.mem, OBJ, portHost());
    assert.deepEqual(EVENTS.map((e) => [e[0], (e[1] ?? 0) >>> 0]), oracleEvents, `${label}: calls`);
    assert.deepEqual(normDraw(DRAW), oracleDraw, `${label}: draw`);
    assert.deepEqual(fields(), oracleFields, `${label}: fields`);
}

test("titleBackgroundTick matches F0x80086544", () => {
    run("state 0", { state0: 0 });
    run("state 1", { state0: 1 });
    run("state 2 seed", { state0: 2, state1: 0 });
    run("state 2 seed varied", { state0: 2, state1: 0, rand: [299, 239, 2, 4] });
    run("state 2 modulus edges", { state0: 2, state1: 0, rand: [300, 240, 3, 5] });
    run("state 2 running", { state0: 2, state1: 1, tw: [[0, 5], [1, 3], [2, 1], [0, 2], [1, 1], [2, 1], [0, 1], [1, 1]] });
    run("state 3", { state0: 3 });
    run("state 7", { state0: 7 });
});
