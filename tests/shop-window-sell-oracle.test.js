// Phase 4 oracle: engine/dw3/ui/shop-window-sell.ts shopWindowSellTick must make
// the same ordered calls and land on the same state as the original F0x8008ADEC.
// The original runs through engine/native with the real fold steppers installed
// in their table cells and recording stubs for the two fills.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopWindowSellTick } from "../engine/dw3/ui/shop-window-sell.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const BAND = 0x80180000;
const BLOCK = 0x80181000;
const CHILDREN = [0x1f4, 0x214];
const READY = { duration: 10, delta: 0, value: 0, active: 0 };
const NOT_READY = { duration: 10, delta: 0, value: 0, active: 1 };

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8008d1b8, 0x8008c2dc);
    rt.mem.write32(0x8008d1bc, 0x8008c370);
    rt.cpu.setStub(0x80089e2c, (c) => { EVENTS.push(["89e2c", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(0x8008a0d0, (c) => { EVENTS.push(["8a0d0", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    return rt;
}

const rt = runtime();

function seed(o) {
    for (let i = 0; i < 0x220; i += 4) rt.mem.write32(BAND + i, 0);
    rt.mem.write32(BAND + 0x10, o.state);
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
    const out = [rt.mem.read32(BAND + 0x10) >>> 0, rt.mem.read32(BAND + 0xc) >>> 0];
    for (const off of CHILDREN) {
        for (let i = 0; i < 0x10; i += 4) out.push(rt.mem.read32(BAND + off + i) >>> 0);
    }
    return out;
}

function runCase(label, o) {
    const norm = (evs) => evs.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
    seed(o);
    EVENTS = [];
    rt.cpu.call(0x8008adec, [BAND, BLOCK]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = snapshot();

    seed(o);
    EVENTS = [];
    const portHost = {
        call89e2c(band, block, flag) { EVENTS.push(["89e2c", band, block, flag]); },
        call8a0d0(band, block, flag) { EVENTS.push(["8a0d0", band, block, flag]); },
    };
    shopWindowSellTick(rt.mem, BAND, BLOCK, portHost);
    const portEvents = norm(EVENTS.slice());
    const portFields = snapshot();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("shopWindowSellTick matches F0x8008ADEC", () => {
    runCase("default state 0", { state: 0 });
    runCase("state 1 ready", { state: 1, ready: { 0x1f4: true } });
    runCase("state 1 not ready", { state: 1, ready: {} });
    runCase("state 2 ready", { state: 2, ready: { 0x214: true } });
    runCase("state 2 not ready", { state: 2, ready: {} });
    runCase("state 3 noop", { state: 3 });
    runCase("state 4 default", { state: 4 });
    runCase("state 0x31 default", { state: 0x31 });
    runCase("state 0x32 clear", { state: 0x32 });
    runCase("state 0x33 settled", { state: 0x33, ready: { 0x214: true } });
    runCase("state 0x33 pending", { state: 0x33, ready: {} });
    runCase("state 0x34 default", { state: 0x34 });
});
