// Phase 4 oracle: engine/dw3/ui/title-ticks.ts#titleDecoLayerTick must match
// pro/stdwtitl F0x800831E8. The original runs through engine/native on the
// shipped overlay+resident, with the four resident state setters and the pack
// resolver recorded, and its internal call to the already-proven
// titleDecoLayerDraw (F0x80083054) renders through the runtime's draw stubs.
// The port uses an equivalent host over the same memory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { titleDecoLayerTick } from "../engine/dw3/ui/title-ticks.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const PACK_STUB = 0x0feb0000;
const PACK_PTR = 0x80190000;
const PACK_HANDLE = 0x7abc;
const SET_STATE0 = 0x80014274;
const SET_STATE1 = 0x80014288;
const ADVANCE0 = 0x800142ac;
const ADVANCE1 = 0x800142c8;
const ARITY = { setOrigin: 2, setLayer: 2, setDepth: 2, m_0x88: 1, drawSprite: 4 };

let EVENTS = [];
let PORT_DRAW = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    // Record the resident state setters and reproduce their decoded effects.
    rt.cpu.setStub(SET_STATE0, (c) => {
        EVENTS.push(["setState0", c.reg(5) >>> 0]);
        const o = c.reg(4) >>> 0;
        rt.mem.write32(o + 0x0c, c.reg(5) >>> 0);
        rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
    });
    rt.cpu.setStub(SET_STATE1, (c) => {
        EVENTS.push(["setState1", c.reg(5) >>> 0]);
        const o = c.reg(4) >>> 0;
        rt.mem.write32(o + 0x10, c.reg(5) >>> 0);
        rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
    });
    rt.cpu.setStub(ADVANCE0, (c) => {
        EVENTS.push(["advance0", 0]);
        const o = c.reg(4) >>> 0;
        rt.mem.write32(o + 0x0c, (rt.mem.read32(o + 0x0c) + 1) | 0);
        rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
    });
    rt.cpu.setStub(ADVANCE1, (c) => {
        EVENTS.push(["advance1", 0]);
        const o = c.reg(4) >>> 0;
        rt.mem.write32(o + 0x10, (rt.mem.read32(o + 0x10) + 1) | 0);
        rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
    });
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    rt.mem.write32(0x80088234, PACK_HANDLE);
    for (let i = 0x0c; i <= 0x78; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x28, SET_STATE0);
    rt.mem.write32(OBJ + 0x2c, SET_STATE1);
    rt.mem.write32(OBJ + 0x38, ADVANCE0);
    rt.mem.write32(OBJ + 0x3c, ADVANCE1);
    rt.mem.write32(OBJ + 0x0c, o.state0 ?? 0);
    rt.mem.write32(OBJ + 0x10, o.state1 ?? 0);
    rt.mem.write32(OBJ + 0x50, o.gate ?? 0);
    rt.mem.write32(OBJ + 0x54, o.drawEnable ?? 0);
    rt.mem.write32(OBJ + 0x58, (o.indexA ?? 0) & 0xffff);
    rt.mem.write16(OBJ + 0x5a, o.shiftA ?? 0);
    rt.mem.write32(OBJ + 0x5c, o.doneA ?? 0);
    rt.mem.write32(OBJ + 0x60, (o.indexB ?? 0) & 0xffff);
    rt.mem.write16(OBJ + 0x62, o.shiftB ?? 0);
    rt.mem.write32(OBJ + 0x64, o.doneB ?? 0);
    rt.mem.write32(OBJ + 0x68, 0x1000);
}

function fields() {
    const out = [];
    for (let off = 0x0c; off <= 0x78; off += 4) out.push(rt.mem.read32(OBJ + off) >>> 0);
    return out;
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        initDrawContext() {},
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setDepth(x, y) { PORT_DRAW.push(["setDepth", [x, y, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        advance0(o) {
            EVENTS.push(["advance0", 0]);
            rt.mem.write32(o + 0x0c, (rt.mem.read32(o + 0x0c) + 1) | 0);
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        advance1(o) {
            EVENTS.push(["advance1", 0]);
            rt.mem.write32(o + 0x10, (rt.mem.read32(o + 0x10) + 1) | 0);
            rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        setState0(o, s) {
            EVENTS.push(["setState0", s >>> 0]);
            rt.mem.write32(o + 0x0c, s >>> 0);
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        setState1(o, s) {
            EVENTS.push(["setState1", s >>> 0]);
            rt.mem.write32(o + 0x10, s >>> 0);
            rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
    };
}

function pass(usePort, o, ticks) {
    seed(o);
    const out = [];
    for (let t = 0; t < ticks; t++) {
        EVENTS = [];
        let draws;
        if (!usePort) {
            const before = rt.drawCalls.length;
            rt.cpu.call(0x800831e8, [OBJ]);
            draws = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
            rt.drawCalls.length = before;
        } else {
            PORT_DRAW = [];
            titleDecoLayerTick(rt.mem, OBJ, portHost(), portHost());
            draws = normDraw(PORT_DRAW);
        }
        out.push({
            events: EVENTS.map((e) => [e[0], (e[1] ?? 0) >>> 0]),
            draws,
            fields: fields(),
        });
    }
    return out;
}

function run(label, o, ticks = 1) {
    const oracle = pass(false, o, ticks);
    const port = pass(true, o, ticks);
    for (let t = 0; t < ticks; t++) {
        assert.deepEqual(port[t].events, oracle[t].events, `${label} tick ${t}: calls`);
        assert.deepEqual(port[t].draws, oracle[t].draws, `${label} tick ${t}: draw`);
        assert.deepEqual(port[t].fields, oracle[t].fields, `${label} tick ${t}: fields`);
    }
}

test("titleDecoLayerTick matches F0x800831E8", () => {
    run("default gate 0", { state0: 0, gate: 0 });
    run("default gate 1", { state0: 0, gate: 1 });
    run("negative state0", { state0: -1, gate: 0 });
    run("state1 zero", { state0: 1, state1: 0 });
    run("state1 high", { state0: 1, state1: 5 });
    run("state3", { state0: 3, gate: 0 });
    run("state7", { state0: 7, gate: 0 });
    run("arm", { state0: 1, state1: 1 });
    run("walk one step", { state0: 1, state1: 2, indexA: 1, shiftA: 1, indexB: 1, shiftB: 1 });
    run("walk freeze A only", { state0: 1, state1: 2, indexA: 12, indexB: 1 });
    run("walk freeze both", { state0: 1, state1: 2, indexA: 12, indexB: 8 });
    run("done flags sum", { state0: 1, state1: 2, doneA: 1, doneB: 1, indexA: 12, indexB: 8 });
    run("case2 init", { state0: 2, state1: 0 });
    run("case2 running", { state0: 2, state1: 1 });
    run("four steps", { state0: 1, state1: 2 }, 4);
    run("A full walk", { state0: 1, state1: 2 }, 14);
    run("arm then walk", { state0: 1, state1: 1 }, 3);
    run("case2 init then run", { state0: 2, state1: 0 }, 3);
});
