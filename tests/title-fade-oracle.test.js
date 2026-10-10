// Phase 4 oracle: engine/dw3/ui/title-fade.ts must match pro/stdwtitl's fade
// cluster and choice dispatcher. Each original runs through engine/native on the
// shipped pro_stdwtitl.bin + resident.bin with the resident services, the
// allocator and the quad submission recorded; the port uses an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    createScreenFade, screenFadeTick, startTitleFade, titleFadeFinished, titleChoiceDispatch,
} from "../engine/dw3/ui/title-fade.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF = 0x80180000;
const CHILD = 0x80181000;
const FADE = 0x80182000;
const ALLOC_STUB = 0x0fe30000;
const QUAD_STUB = 0x0fe30010;
const SET_STATE1 = 0x80014288;
const ADVANCE0 = 0x800142ac;
const FADE_FINISHED = 0x80085f38;

let EVENTS = [];
let PREV = 0;
let LANG = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return FADE;
    });
    rt.cpu.setStub(0x80085d64, (c) => { EVENTS.push(["quad", c.reg(4) | 0]); });
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
    return rt;
}

const rt = runtime();

function seedFade(o = {}) {
    EVENTS = [];
    PREV = o.prev ?? 0;
    LANG = o.lang ?? 0;
    rt.mem.write32(0x8005cca8, LANG);
    for (let i = 0; i <= 0x60; i += 4) rt.mem.write32(SELF + i, 0);
    rt.mem.write32(SELF + 0x2c, SET_STATE1);
    rt.mem.write32(SELF + 0x38, ADVANCE0);
    rt.mem.write32(SELF + 0x0c, o.state0 ?? 0);
    rt.mem.write32(SELF + 0x10, o.state1 ?? 0);
    rt.mem.write32(SELF + 0x50, o.result ?? 0);
    rt.mem.write16(SELF + 0x54, o.level ?? 0);
    rt.mem.write16(SELF + 0x56, o.counter ?? 0);
    rt.mem.write32(FADE + 0x50, o.fadeFinished ?? 1);
    rt.mem.write32(FADE + 0x5c, FADE_FINISHED);
    for (let i = 0; i < 7; i++) rt.mem.write32(CHILD + i * 4, 0);
    rt.mem.write32(CHILD, FADE);
    rt.mem.write32(SELF + 0x58, o.outcome ?? 0);
}

function fields() {
    return [rt.mem.read32(SELF + 0x0c) >>> 0, rt.mem.read32(SELF + 0x10) >>> 0,
        rt.mem.read32(SELF + 0x50) >>> 0, rt.mem.read16(SELF + 0x54), rt.mem.read16(SELF + 0x56)];
}

function portFadeHost() {
    return {
        allocate(handler, size, extra) {
            EVENTS.push(["alloc", handler >>> 0, size >>> 0, extra >>> 0]);
            return FADE;
        },
        advance0(o) {
            EVENTS.push(["advance0", 0]);
            rt.mem.write32(o + 0x0c, (rt.mem.read32(o + 0x0c) + 1) | 0);
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        setState1(o, s) {
            EVENTS.push(["setState1", s >>> 0]);
            rt.mem.write32(o + 0x10, s >>> 0);
            rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        buildVignetteQuad(level) { EVENTS.push(["quad", level | 0]); },
    };
}

function events() { return EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v >>> 0 : v))); }

test("createScreenFade matches F0x80086018", () => {
    seedFade();
    for (let i = 0; i <= 0x60; i += 4) rt.mem.write32(FADE + i, 0);
    const ret = rt.cpu.call(0x80086018, []) >>> 0;
    const oracle = { events: events(), ret, start: rt.mem.read32(FADE + 0x58) >>> 0, fin: rt.mem.read32(FADE + 0x5c) >>> 0 };

    seedFade();
    for (let i = 0; i <= 0x60; i += 4) rt.mem.write32(FADE + i, 0);
    const pRet = createScreenFade(rt.mem, portFadeHost()) >>> 0;
    assert.deepEqual(events(), oracle.events, "calls");
    assert.equal(pRet, oracle.ret, "return");
    assert.equal(rt.mem.read32(FADE + 0x58) >>> 0, oracle.start, "start slot");
    assert.equal(rt.mem.read32(FADE + 0x5c) >>> 0, oracle.fin, "finished slot");
});

test("screenFadeTick matches F0x80085F44", () => {
    const scripts = [
        [{ state0: 0 }],
        [{ state0: 5 }],
        [{ state0: -1 }],
        [{ state0: 2 }],
        [{ state0: 3 }],
        [{ state0: 1, state1: 0, level: 200 }],
        [{ state0: 1, state1: 1, counter: 0 }],
        [{ state0: 1, state1: 1, counter: 5, level: 40 }],
        [{ state0: 1, state1: 1, counter: 29, level: 240 }],
        [{ state0: 1, state1: 1, counter: 28 }],
        [{ state0: 1, state1: 1, counter: 0 }, 32],
    ];
    for (const [o, ticks = 1] of scripts) {
        seedFade(o);
        const oracle = [];
        for (let t = 0; t < ticks; t++) {
            EVENTS = [];
            rt.cpu.call(0x80085f44, [SELF]);
            oracle.push({ events: events(), fields: fields() });
        }
        seedFade(o);
        for (let t = 0; t < ticks; t++) {
            EVENTS = [];
            screenFadeTick(rt.mem, SELF, portFadeHost());
            assert.deepEqual(events(), oracle[t].events, `tick ${t} calls`);
            assert.deepEqual(fields(), oracle[t].fields, `tick ${t} fields`);
        }
    }
});

test("startTitleFade and titleFadeFinished match F0x80085F0C / F0x80085F38", () => {
    seedFade({ result: 0xdead, counter: 0xbeef, state1: 3 });
    EVENTS = [];
    rt.cpu.call(0x80085f0c, [SELF]);
    const oEvents = events();
    const oFields = fields();

    seedFade({ result: 0xdead, counter: 0xbeef, state1: 3 });
    EVENTS = [];
    startTitleFade(rt.mem, SELF, portFadeHost());
    assert.deepEqual(events(), oEvents, "start calls");
    assert.deepEqual(fields(), oFields, "start fields");

    seedFade({ result: 0x12345678 });
    const oRet = rt.cpu.call(0x80085f38, [SELF]) | 0;
    assert.equal(titleFadeFinished(rt.mem, SELF) | 0, oRet, "finished return");
});

test("titleChoiceDispatch matches F0x80086834", () => {
    const CELLS = [
        [0x8004b430, 0x0fe40000, "reset"],
        [0x8004b488, 0x0fe40010, "clearFields"],
        [0x80042b70, 0x0fe40020, "clearRegion"],
        [0x80048a7c, 0x0fe40030, "applyLanguage"],
        [0x8004b440, 0x0fe40040, "setSelector"],
        [0x8004b448, 0x0fe40050, "previous"],
    ];
    for (const [cell, stub] of CELLS) {
        rt.mem.write32(cell, stub);
        rt.cpu.setStub(stub, (c) => {
            const name = CELLS.find(([x]) => x === cell)[2];
            if (name === "previous") {
                EVENTS.push(["previous", c.reg(4) >>> 0]);
                return PREV;
            }
            if (name === "setSelector") {
                EVENTS.push(["setSelector", c.reg(4) >>> 0, c.reg(5) >>> 0]);
                return 0;
            }
            EVENTS.push([name, 0]);
            return 0;
        });
    }
    const scenarios = [
        { outcome: 0 }, { outcome: 4 }, { outcome: -1 },
        { outcome: 1 }, { outcome: 2 },
        { outcome: 3, lang: 1 },
        { outcome: 3, lang: 0, prev: 0xe01 },
        { outcome: 3, lang: 0, prev: 0x123 },
        { outcome: 1, fadeFinished: 0 },
    ];
    for (const o of scenarios) {
        seedFade(o);
        EVENTS = [];
        const oRet = rt.cpu.call(0x80086834, [SELF, CHILD]) | 0;
        const oEvents = events();

        seedFade(o);
        EVENTS = [];
        const pHost = {
            resetSaveContext() { EVENTS.push(["reset", 0]); },
            clearContextFields() { EVENTS.push(["clearFields", 0]); },
            clearRegion() { EVENTS.push(["clearRegion", 0]); },
            applyLanguage() { EVENTS.push(["applyLanguage", 0]); },
            setSelector(code, arg) { EVENTS.push(["setSelector", code >>> 0, arg >>> 0]); },
            previousScreenCode(arg) { EVENTS.push(["previous", arg >>> 0]); return PREV; },
        };
        const pRet = titleChoiceDispatch(rt.mem, SELF, CHILD, pHost) | 0;
        assert.deepEqual(events(), oEvents, `outcome ${o.outcome} lang ${o.lang ?? 0}: calls`);
        assert.equal(pRet, oRet, `outcome ${o.outcome} lang ${o.lang ?? 0}: return`);
    }
});
