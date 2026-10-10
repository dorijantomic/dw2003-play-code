// Phase 4 oracle: engine/dw3/ui/title-menu.ts must match pro/stdwtitl
// F0x80085594 (the Start/Continue menu and its five jump-table interiors). The
// original runs through engine/native with the controller-service getters and
// the sound cell stubbed, and the real menu draw F0x800852F0; the port uses an
// equivalent host plus the already-proven titleMenuDraw. Both must produce the
// same ordered calls, draw intents and fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { titleMenuTick } from "../engine/dw3/ui/title-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const PACK_STUB = 0x0feb0000;
const SOUND_STUB = 0x0feb0010;
const PACK_PTR = 0x80190000;
const PACK_HANDLE = 0x7abc;
const SET_STATE0 = 0x80014274;
const ADVANCE0 = 0x800142ac;
const ADVANCE1 = 0x800142c8;
const ARITY = { setOrigin: 2, setLayer: 2, setDepth: 2, m_0x88: 1, drawSprite: 4 };

let EVENTS = [];
let DRAW = [];
let SEED = { word: 0, repeat: 0, shift: undefined };

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80018854, (c) => { EVENTS.push(["padCall", 0x3f4, c.reg(4)]); return SEED.word; });
    rt.cpu.setStub(0x8001889c, (c) => { EVENTS.push(["padCall", 0x3fc, c.reg(4)]); return SEED.repeat; });
    rt.cpu.setStub(0x80018980, (c) => {
        const arg = c.reg(5) >>> 0;
        EVENTS.push(["padCall", 0x408, c.reg(4), arg]);
        return SEED.shift !== undefined ? SEED.shift : arg;
    });
    rt.cpu.setStub(SOUND_STUB, (c) => { EVENTS.push(["sound", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c48, SOUND_STUB);
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4)]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    DRAW = [];
    SEED = { word: o.word ?? 0, repeat: o.repeat ?? 0, shift: o.shift };
    for (let i = 0; i <= 0x90; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x0c, (o.state0 ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x10, (o.state1 ?? 0) >>> 0);
    rt.mem.write16(OBJ + 0x50, o.gate ?? 0);
    rt.mem.write16(OBJ + 0x52, o.result ?? 0);
    rt.mem.write16(OBJ + 0x54, o.timer ?? 0);
    rt.mem.write16(OBJ + 0x56, o.marker ?? 0);
    rt.mem.write8(OBJ + 0x58, o.flag ?? 0);
    rt.mem.write8(OBJ + 0x59, o.counter ?? 0);
    rt.mem.write16(OBJ + 0x5a, o.select ?? 0);
    rt.mem.write32(OBJ + 0x5c, (o.x0 ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x60, (o.y0 ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x6c, (o.x1 ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x70, (o.y1 ?? 0) >>> 0);
    rt.mem.write32(OBJ + 0x8c, 0x1002);
    rt.mem.write32(OBJ + 0x28, SET_STATE0);
    rt.mem.write32(OBJ + 0x38, ADVANCE0);
    rt.mem.write32(OBJ + 0x3c, ADVANCE1);
    rt.mem.write32(0x80088234, PACK_HANDLE);
    rt.mem.write32(0x8005cca8, 0);
}

const FIELDS = [0x0c, 0x10, 0x14, 0x18, 0x50, 0x52, 0x54, 0x56, 0x58, 0x5a, 0x5c, 0x60, 0x6c, 0x70];

function fields() {
    return FIELDS.map((off) => rt.mem.read32(OBJ + off) >>> 0);
}

function normEvents(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
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
        setState0(o, s) {
            rt.mem.write32(o + 0x0c, s >>> 0);
            rt.mem.write32(o + 0x10, 0);
            rt.mem.write32(o + 0x14, 0);
            rt.mem.write32(o + 0x18, 0);
        },
        advance0(o) {
            const v = (rt.mem.read32(o + 0x0c) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0x0c, v);
        },
        advance1(o) {
            const v = (rt.mem.read32(o + 0x10) + 1) | 0;
            rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0x10, v);
        },
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
        padCall(slot, arg) {
            if (slot === 0x3f4) { EVENTS.push(["padCall", 0x3f4, 0]); return SEED.word; }
            if (slot === 0x3fc) { EVENTS.push(["padCall", 0x3fc, 0]); return SEED.repeat; }
            EVENTS.push(["padCall", 0x408, 0, arg >>> 0]);
            return SEED.shift !== undefined ? SEED.shift : (arg >>> 0);
        },
    };
}

function run(label, o) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80085594, [OBJ]);
    const oracleEvents = normEvents(EVENTS.slice());
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = fields();

    seed(o);
    titleMenuTick(rt.mem, OBJ, portHost());
    const portEvents = normEvents(EVENTS.slice());
    const portDraw = normDraw(DRAW);
    const portFields = fields();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portDraw, oracleDraw, `${label}: draw`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("titleMenuTick matches F0x80085594", () => {
    run("default gate off", { state0: 0, gate: 0 });
    run("default gate on", { state0: 0, gate: 1 });
    run("state0 3 idle", { state0: 3 });
    run("state0 4 gate off", { state0: 4, gate: 0 });

    run("state1 0 nothing", { state0: 1, state1: 0 });
    run("idle timer 5", { state0: 1, state1: 1, timer: 5 });
    run("idle timer 6", { state0: 1, state1: 1, timer: 6 });

    run("wait start pressed", { state0: 1, state1: 2, word: 1 << 3 });
    run("wait start timeout", { state0: 1, state1: 2, timer: 0x257 });
    run("wait start no press", { state0: 1, state1: 2, timer: 0 });

    run("split frame 1", { state0: 1, state1: 3, timer: 0 });
    run("split frame 3", { state0: 1, state1: 3, timer: 2 });
    run("split group 1", { state0: 1, state1: 3, timer: 3 });
    run("split group 2", { state0: 1, state1: 3, timer: 3, counter: 1 });
    run("split done", { state0: 1, state1: 3, timer: 3, counter: 2 });

    run("separate start", { state0: 1, state1: 4, timer: 0 });
    run("separate frame 7", { state0: 1, state1: 4, timer: 6 });
    run("separate frame 14", { state0: 1, state1: 4, timer: 13 });
    run("separate done", { state0: 1, state1: 4, timer: 14 });

    run("close frame 1", { state0: 1, state1: 5, timer: 0 });
    run("close done", { state0: 1, state1: 5, timer: 5 });
    run("out of range", { state0: 1, state1: 99, timer: 5 });

    run("input option A", { state0: 2, state1: 1, word: 1 << 4, select: 1 });
    run("input option B", { state0: 2, state1: 1, word: 1 << 6, select: 0 });
    run("input repeat A", { state0: 2, state1: 1, repeat: 1 << 4, select: 0 });
    run("input confirm", { state0: 2, state1: 1, word: 1 << 0xd, select: 1 });
    run("input nothing", { state0: 2, state1: 1, select: 0 });

    run("confirm group 1", { state0: 2, state1: 2, timer: 3, counter: 0, select: 1 });
    run("confirm done selected", { state0: 2, state1: 2, timer: 3, counter: 2, select: 1 });
    run("confirm done first", { state0: 2, state1: 2, timer: 3, counter: 2, select: 0 });

    run("state2 state1 3", { state0: 2, state1: 3 });
    run("state2 default", { state0: 2, state1: 0 });
});
