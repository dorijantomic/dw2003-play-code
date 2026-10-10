// Phase 4 oracle: engine/dw3/ui/country-palette.ts must match pro/cnty_sel's
// F0x800833DC (palette_sprite_draw) and F0x8008347C (palette_cycle_tick). Each
// original runs through engine/native on the shipped pro_cnty_sel.bin +
// resident.bin with the draw context, the pack resolver, the palette script
// stepper and the two state slots recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { paletteSpriteDraw, paletteCycleTick } from "../engine/dw3/ui/country-palette.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cnty_sel.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const PACK_STUB = 0x0feb0000;
const PACK_PTR = 0x80190000;
const SCRIPT_STUB = 0x0fe80000;
const SET_STATE0 = 0x80014274;
const ADVANCE0 = 0x800142ac;
const SEED_PTR = 0x800843da;
const ARITY = { setOrigin: 2, setLayer: 2, m_0x88: 1, drawSprite: 4 };

let EVENTS = [];
let PORT_DRAW = [];
let SCRIPT_RET = 5;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(0x80083304, (c) => {
        EVENTS.push(["script", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return SCRIPT_RET;
    });
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    SCRIPT_RET = o.script ?? 5;
    for (let i = 0; i <= 0x60; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x28, SET_STATE0);
    rt.mem.write32(OBJ + 0x38, ADVANCE0);
    rt.cpu.setStub(SET_STATE0, (c) => {
        EVENTS.push(["setState0", c.reg(5) >>> 0]);
        rt.mem.write32(OBJ + 0x0c, c.reg(5) >>> 0);
        rt.mem.write32(OBJ + 0x10, 0); rt.mem.write32(OBJ + 0x14, 0); rt.mem.write32(OBJ + 0x18, 0);
    });
    rt.cpu.setStub(ADVANCE0, (c) => {
        EVENTS.push(["advance0", 0]);
        rt.mem.write32(OBJ + 0x0c, (rt.mem.read32(OBJ + 0x0c) + 1) | 0);
        rt.mem.write32(OBJ + 0x10, 0); rt.mem.write32(OBJ + 0x14, 0); rt.mem.write32(OBJ + 0x18, 0);
    });
    rt.mem.write32(OBJ + 0x0c, (o.state ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x10, (o.seedFlag ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x50, (o.counter ?? 0) >>> 0);
    rt.mem.write16(OBJ + 0x54, (o.frame ?? 0) & 0xffff);
    rt.mem.write16(OBJ + 0x56, (o.published ?? 0) & 0xffff);
    rt.mem.write16(OBJ + 0x58, (o.cursor ?? 0) & 0xffff);
    rt.mem.write16(OBJ + 0x5a, (o.cursorValue ?? 0) & 0xffff);
    rt.mem.write16(SEED_PTR, (o.tableSeed ?? 0x1234) & 0xffff);
}

function fields() {
    return [rt.mem.read32(OBJ + 0x0c) >>> 0, rt.mem.read32(OBJ + 0x10) >>> 0,
        rt.mem.read32(OBJ + 0x50) >>> 0, rt.mem.read16(OBJ + 0x54), rt.mem.read16(OBJ + 0x56),
        rt.mem.read16(OBJ + 0x58), rt.mem.read16(OBJ + 0x5a)];
}
function events() { return EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v >>> 0 : v))); }
function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
        advance0(obj) {
            EVENTS.push(["advance0", 0]);
            rt.mem.write32(obj + 0x0c, (rt.mem.read32(obj + 0x0c) + 1) | 0);
            rt.mem.write32(obj + 0x10, 0); rt.mem.write32(obj + 0x14, 0); rt.mem.write32(obj + 0x18, 0);
        },
        setState0(obj, s) {
            EVENTS.push(["setState0", s >>> 0]);
            rt.mem.write32(obj + 0x0c, s >>> 0);
            rt.mem.write32(obj + 0x10, 0); rt.mem.write32(obj + 0x14, 0); rt.mem.write32(obj + 0x18, 0);
        },
        stepPaletteScript(cursor, table, arg) {
            EVENTS.push(["script", cursor >>> 0, table >>> 0, arg >>> 0]);
            return SCRIPT_RET;
        },
    };
}

function compare(label, o, which) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(which === "draw" ? 0x800833dc : 0x8008347c, [OBJ]);
    const oDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oEvents = events();
    const oFields = fields();

    seed(o);
    if (which === "draw") paletteSpriteDraw(rt.mem, OBJ, portHost());
    else paletteCycleTick(rt.mem, OBJ, portHost());
    assert.deepEqual(events(), oEvents, `${label}: calls`);
    assert.deepEqual(normDraw(PORT_DRAW), oDraw, `${label}: draw`);
    assert.deepEqual(fields(), oFields, `${label}: fields`);
}

test("paletteSpriteDraw matches F0x800833DC", () => {
    compare("frame 0", { frame: 0, published: 3 }, "draw");
    compare("frame 7 published 5", { frame: 7, published: 5 }, "draw");
    compare("negative frame", { frame: -2, published: -1 }, "draw");
});

test("paletteCycleTick matches F0x8008347C", () => {
    compare("state 0 advances", { state: 0 }, "tick");
    compare("state negative advances", { state: -1 }, "tick");
    compare("state above three advances", { state: 4 }, "tick");
    compare("state 3 idle", { state: 3 }, "tick");
    for (const counter of [0, 3, 4, 30, 31, 32, 35, -1, -2, -18, -33]) {
        compare(`state 1 counter ${counter}`, { state: 1, counter, frame: 2 }, "tick");
    }
    compare("state 2 seeds then runs", { state: 2, seedFlag: 0, tableSeed: 0x1234, cursor: 9, cursorValue: 9 }, "tick");
    compare("state 2 running", { state: 2, seedFlag: 1, cursor: 4, cursorValue: 7 }, "tick");
    compare("state 2 terminator", { state: 2, seedFlag: 1, script: 0xff }, "tick");
    compare("state 2 terminator wide", { state: 2, seedFlag: 1, script: -1 }, "tick");
});
