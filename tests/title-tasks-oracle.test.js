// Phase 4 oracle: engine/dw3/ui/title-tasks.ts must match pro/stdwtitl's seven
// creators and seven installed one-line methods. Each original runs through
// engine/native with F0x80014504 and the state setters stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    TITLE_CREATORS,
    titleDecoLayerCreate, titleGlowCreate, titleWordmarkCreate, titleLogoCreate,
    titleMenuCreate, titleBackgroundCreate, titleSequenceCreate,
    titleDecoLayerPrompt, titleGlowPrompt, titleWordmarkPrompt, titleLogoPrompt,
    titleMenuPrompt, titleMenuOutcome, titleBackgroundInit,
} from "../engine/dw3/ui/title-tasks.ts";
import {
    titleJpGlowCreate, titleJpWordmarkCreate, titleJpLogoCreate,
} from "../engine/dw3/ui/title-japanese.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const SCREEN = 0x80190000;
const SET0 = 0x0fea0000;
const SET1 = 0x0fea0010;

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        return OBJ;
    });
    rt.cpu.setStub(SET0, (c) => { EVENTS.push(["setState0", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(SET1, (c) => { EVENTS.push(["setState1", c.reg(4), c.reg(5)]); return 0; });
    return rt;
}

const rt = runtime();

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function objectSnapshot() {
    const out = [];
    for (let off = 0; off < 0x140; off += 4) out.push(rt.mem.read32(OBJ + off) >>> 0);
    return out;
}

function portHost() {
    return {
        allocTitleTask(h, s, e) { EVENTS.push(["alloc", h >>> 0, s >>> 0, e >>> 0]); return OBJ; },
    };
}

function compareCreator(label, addr, port, expected = TITLE_CREATORS[label]) {
    for (let off = 0; off < 0x140; off += 4) rt.mem.write32(OBJ + off, 0);
    EVENTS = [];
    rt.cpu.call(addr, [SCREEN]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleSlots = objectSnapshot();

    for (let off = 0; off < 0x140; off += 4) rt.mem.write32(OBJ + off, 0);
    EVENTS = [];
    const ret = port(rt.mem, SCREEN, portHost());
    assert.equal(ret, OBJ, `${label}: return`);
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: alloc`);
    assert.deepEqual(objectSnapshot(), oracleSlots, `${label}: object`);
    assert.deepEqual(EVENTS, [["alloc",
        expected.handler, expected.size, expected.extra]], `${label}: expected alloc`);
}

test("title creators match their F0x80014504 calls and slot stores", () => {
    compareCreator("decoLayer", 0x800833e4, titleDecoLayerCreate);
    compareCreator("glow", 0x800844e8, titleGlowCreate);
    compareCreator("wordmark", 0x80084df0, titleWordmarkCreate);
    compareCreator("logo", 0x8008529c, titleLogoCreate);
    compareCreator("menu", 0x80085c68, titleMenuCreate);
    compareCreator("background", 0x800867e0, titleBackgroundCreate);
    compareCreator("sequence", 0x80086db0, titleSequenceCreate);
    compareCreator("jp glow", 0x80084218, titleJpGlowCreate,
        { handler: 0x800840a8, size: 0x74, extra: 0 });
    compareCreator("jp wordmark", 0x80084be8, titleJpWordmarkCreate,
        { handler: 0x80084a70, size: 0x74, extra: 0 });
    compareCreator("jp logo", 0x80085074, titleJpLogoCreate,
        { handler: 0x80084edc, size: 0x74, extra: 0 });
});

function seedMethod(state) {
    for (let off = 0; off < 0x60; off += 4) rt.mem.write32(OBJ + off, 0);
    rt.mem.write32(OBJ + 0x0c, state >>> 0);
    rt.mem.write32(OBJ + 0x28, SET0);
    rt.mem.write32(OBJ + 0x2c, SET1);
    EVENTS = [];
}

function compareMethod(label, addr, port, state) {
    seedMethod(state);
    rt.cpu.call(addr, [OBJ]);
    const oracleEvents = norm(EVENTS.slice());

    seedMethod(state);
    port(rt.mem, OBJ, {
        setState0(o, s) { EVENTS.push(["setState0", o >>> 0, s | 0]); },
        setState1(o, s) { EVENTS.push(["setState1", o >>> 0, s | 0]); },
    });
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
}

test("title installed methods match their one-line bodies", () => {
    for (const state of [0, 1, 2]) {
        compareMethod("decoLayerPrompt", 0x800833ac, titleDecoLayerPrompt, state);
        compareMethod("glowPrompt", 0x800841e0, titleGlowPrompt, state);
        compareMethod("wordmarkPrompt", 0x80084bb0, titleWordmarkPrompt, state);
        compareMethod("logoPrompt", 0x8008503c, titleLogoPrompt, state);
        compareMethod("menuPrompt", 0x80085be4, titleMenuPrompt, state);
        compareMethod("backgroundInit", 0x800867a8, titleBackgroundInit, state);
    }
});

test("titleMenuOutcome returns the signed outcome word", () => {
    for (const value of [0, 1, 2, 3, 0xfffd]) {
        seedMethod(1);
        rt.mem.write32(OBJ + 0x52, value >>> 0);
        const oracle = rt.cpu.call(0x80085c5c, [OBJ]) | 0;
        const port = titleMenuOutcome(rt.mem, OBJ) | 0;
        assert.equal(port, oracle, `outcome ${value.toString(16)}`);
    }
});
