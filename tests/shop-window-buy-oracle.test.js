// Phase 4 oracle: engine/dw3/ui/shop-window-buy.ts shopWindowBuyTick must make
// the same ordered calls and land on the same state as the original F0x8008A758.
// The original runs through engine/native with the real fold steppers installed
// in their table cells and recording stubs for the four fills and the two prompt
// widget methods; the port runs through equivalent callbacks. Every touched
// band and child-fold field is compared too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopWindowBuyTick } from "../engine/dw3/ui/shop-window-buy.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const BAND = 0x80180000;
const BLOCK = 0x80181000;
const WIDGET = 0x80182000;
const SOURCE_STUB = 0x0fd50000;
const SOURCE = 0x80183000;
const CHILDREN = [0x1f4, 0x204, 0x214, 0x224];
const READY = { duration: 10, delta: 0, value: 0, active: 0 };
const NOT_READY = { duration: 10, delta: 0, value: 0, active: 1 };

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    // The real fold steppers in their table cells, as the game's init installs them.
    rt.mem.write32(0x8008d1b8, 0x8008c2dc);
    rt.mem.write32(0x8008d1bc, 0x8008c370);
    // Prompt string-bank resolver cell.
    rt.cpu.setStub(SOURCE_STUB, () => { EVENTS.push(["source"]); return SOURCE; });
    rt.mem.write32(0x80044f4c, SOURCE_STUB);
    // The four fill callees.
    rt.cpu.setStub(0x80089e2c, (c) => { EVENTS.push(["89e2c", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(0x8008a0d0, (c) => { EVENTS.push(["8a0d0", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(0x8008a1fc, (c) => { EVENTS.push(["8a1fc", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    // The prompt widget's method pointers, so the real table lookup reaches the stubs.
    rt.mem.write32(WIDGET + 0x114, 0x800194e8);
    rt.mem.write32(WIDGET + 0x144, 0x8001a23c);
    rt.cpu.setStub(0x800194e8, (c) => { EVENTS.push(["w114", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(0x8001a23c, (c) => { EVENTS.push(["w144", c.reg(4), c.reg(5)]); return 0; });
    return rt;
}

const rt = runtime();

function seed(o) {
    for (let i = 0; i < 0x250; i += 4) rt.mem.write32(BAND + i, 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(BLOCK + i, 0);
    rt.mem.write32(BAND + 0x10, o.state);
    rt.mem.write32(BAND + 0x1ec, o.hasEffects ?? 0);
    rt.mem.write32(BAND + 0x5c, o.toggle ?? 0);
    rt.mem.write32(BLOCK + 0xa8, WIDGET);
    const ready = o.ready ?? {};
    for (const off of CHILDREN) {
        const spec = ready[off] ? READY : NOT_READY;
        rt.mem.write32(BAND + off + 0x0, spec.duration);
        rt.mem.write32(BAND + off + 0x4, spec.delta);
        rt.mem.write32(BAND + off + 0x8, spec.value);
        rt.mem.write32(BAND + off + 0xc, spec.active);
    }
}

function snapshot() {
    const out = [rt.mem.read32(BAND + 0x10) >>> 0, rt.mem.read32(BAND + 0xc) >>> 0, rt.mem.read32(BAND + 0x1f0) >>> 0];
    for (const off of CHILDREN) {
        for (let i = 0; i < 0x10; i += 4) out.push(rt.mem.read32(BAND + off + i) >>> 0);
    }
    return out;
}

function runCase(label, o) {
    const norm = (evs) => evs.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);

    seed(o);
    EVENTS = [];
    rt.cpu.call(0x8008a758, [BAND, BLOCK]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = snapshot();

    seed(o);
    EVENTS = [];
    const portHost = {
        call89e2c(band, block, flag) { EVENTS.push(["89e2c", band, block, flag]); },
        call8a0d0(band, block, flag) { EVENTS.push(["8a0d0", band, block, flag]); },
        call8a1fc(band, block, flag) { EVENTS.push(["8a1fc", band, block, flag]); },
        textSource() { EVENTS.push(["source"]); return SOURCE; },
        widgetSetLine0(widget, source, index) { EVENTS.push(["w114", widget, source, index]); },
        widgetSetFlagC1(widget, flag) { EVENTS.push(["w144", widget, flag]); },
    };
    shopWindowBuyTick(rt.mem, BAND, BLOCK, portHost);
    const portEvents = norm(EVENTS.slice());
    const portFields = snapshot();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("shopWindowBuyTick matches F0x8008A758", () => {
    runCase("state 0 effects", { state: 0, hasEffects: 1 });
    runCase("state 0 no effects", { state: 0, hasEffects: 0 });
    runCase("state 1 ready effects", { state: 1, hasEffects: 1, ready: { 0x1f4: true } });
    runCase("state 1 not ready", { state: 1, hasEffects: 0, ready: {} });
    runCase("state 2 ready", { state: 2, ready: { 0x214: true } });
    runCase("state 2 not ready", { state: 2, ready: {} });
    runCase("state 3 noop", { state: 3 });
    runCase("state 4 buy", { state: 4, hasEffects: 1, toggle: 0 });
    runCase("state 4 sell", { state: 4, hasEffects: 1, toggle: 1 });
    runCase("state 5 open c", { state: 5, toggle: 0, ready: { 0x204: true } });
    runCase("state 5 skip c", { state: 5, toggle: 1, ready: { 0x204: true } });
    runCase("state 6 ready", { state: 6, ready: { 0x224: true } });
    runCase("state 7 noop", { state: 7 });
    runCase("state 8 buy", { state: 8, toggle: 0 });
    runCase("state 8 sell", { state: 8, toggle: 1 });
    runCase("state 9 effects buy", { state: 9, hasEffects: 1, toggle: 0, ready: { 0x204: true } });
    runCase("state 9 sell", { state: 9, hasEffects: 0, toggle: 1, ready: { 0x204: true } });
    runCase("state A sell", { state: 0x0a, toggle: 0 });
    runCase("state A buy", { state: 0x0a, toggle: 1 });
    runCase("state B ready", { state: 0x0b, ready: { 0x214: true } });
    runCase("state C ready", { state: 0x0c, ready: { 0x224: true } });
    runCase("state F ready", { state: 0x0f, ready: { 0x224: true } });
    runCase("state 10 ready", { state: 0x10, ready: { 0x214: true } });
    runCase("state 32 sell", { state: 0x32, hasEffects: 1, toggle: 0 });
    runCase("state 32 buy", { state: 0x32, hasEffects: 1, toggle: 1 });
    runCase("state 33 settled", { state: 0x33, hasEffects: 1, toggle: 0, ready: { 0x1f4: true } });
    runCase("state 33 sell", { state: 0x33, hasEffects: 0, toggle: 1, ready: { 0x1f4: true } });
    runCase("state 3E8 buy", { state: 0x3e8, toggle: 0, ready: { 0x214: true } });
    runCase("state 3E8 sell", { state: 0x3e8, toggle: 1, ready: { 0x214: true } });
    runCase("unknown 0x99", { state: 0x99, hasEffects: 1 });
    runCase("unknown 0x11", { state: 0x11, hasEffects: 0 });
    runCase("unknown 0x0D", { state: 0x0d });
});
