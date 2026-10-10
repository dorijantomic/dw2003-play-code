// Phase 4 oracle: engine/dw3/ui/title-sequence-tick.ts#titleSequenceOwnerTick
// must match pro/stdwtitl F0x80086C70. The original runs through engine/native
// on the shipped overlay+resident with the nine direct-jal creators, the
// resident state setters, the sequence tick and the sound service recorded; the
// port uses an equivalent host over the same memory. Ordered calls, the child
// block, the state fields and the language arm are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { titleSequenceOwnerTick } from "../engine/dw3/ui/title-sequence-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF = 0x80180000;
const CHILD = 0x80181000;
const PTR = (i) => 0x80182000 + i * 0x100;
const SET_STATE0 = 0x80014274;
const ADVANCE0 = 0x800142ac;
const STUB_SOUND = 0x0fe100a0;

// The nine direct-jal creators and the sequence tick, by real address.
const CREATORS = [
    [0x800867e0, "background", PTR(0)],
    [0x80085074, "jpLogo", PTR(1)],
    [0x80084be8, "jpWordmark", PTR(2)],
    [0x80084218, "jpGlow", PTR(3)],
    [0x8008529c, "enLogo", PTR(4)],
    [0x80084df0, "enWordmark", PTR(5)],
    [0x800844e8, "enGlow", PTR(6)],
    [0x800833e4, "deco", PTR(7)],
    [0x80085c68, "menu", PTR(8)],
];

let EVENTS = [];
let SEQ_RET = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    for (const [addr, name, ret] of CREATORS) {
        rt.cpu.setStub(addr, () => { EVENTS.push(["create", name, 0]); return ret; });
    }
    rt.cpu.setStub(0x800869d0, (c) => {
        EVENTS.push(["seqTick", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return SEQ_RET;
    });
    rt.cpu.setStub(STUB_SOUND, (c) => { EVENTS.push(["sound", c.reg(4) >>> 0]); });
    rt.cpu.setStub(SET_STATE0, (c) => {
        EVENTS.push(["setState0", c.reg(5) >>> 0]);
        const o = c.reg(4) >>> 0;
        rt.mem.write32(o + 0x0c, c.reg(5) >>> 0);
        rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
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

function seed(o = {}) {
    EVENTS = [];
    SEQ_RET = o.seq ?? 0;
    for (let i = 0x00; i <= 0x58; i += 4) rt.mem.write32(SELF + i, 0);
    rt.mem.write32(SELF + 0x28, SET_STATE0);
    rt.mem.write32(SELF + 0x38, ADVANCE0);
    rt.mem.write32(SELF + 0x0c, o.state0 ?? 0);
    rt.mem.write32(SELF + 0x54, o.acc ?? 0x7fff);
    for (let i = 0; i < 7; i++) rt.mem.write32(CHILD + i * 4, 0xdead0000 + i);
    rt.mem.write32(0x80055c68, STUB_SOUND);
    rt.mem.write32(0x8005cca8, o.lang ?? 0);
}

function snapshot() {
    const block = [];
    for (let i = 0; i < 7; i++) block.push(rt.mem.read32(CHILD + i * 4) >>> 0);
    return {
        events: EVENTS.map((e) => [e[0], e[1] ?? 0, (e[2] ?? 0) >>> 0]),
        state0: rt.mem.read32(SELF + 0x0c) >>> 0,
        acc: rt.mem.read32(SELF + 0x54) >>> 0,
        block,
    };
}

function portHost() {
    const ret = new Map(CREATORS.map(([addr, name, val]) => [addr, { name, val }]));
    return {
        advance0(o) {
            EVENTS.push(["advance0", 0]);
            rt.mem.write32(o + 0x0c, (rt.mem.read32(o + 0x0c) + 1) | 0);
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        setState0(o, s) {
            EVENTS.push(["setState0", s >>> 0]);
            rt.mem.write32(o + 0x0c, s >>> 0);
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        createBackground() { EVENTS.push(["create", "background", 0]); return PTR(0); },
        createJpLogo() { EVENTS.push(["create", "jpLogo", 0]); return PTR(1); },
        createJpWordmark() { EVENTS.push(["create", "jpWordmark", 0]); return PTR(2); },
        createJpGlow() { EVENTS.push(["create", "jpGlow", 0]); return PTR(3); },
        createEnLogo() { EVENTS.push(["create", "enLogo", 0]); return PTR(4); },
        createEnWordmark() { EVENTS.push(["create", "enWordmark", 0]); return PTR(5); },
        createEnGlow() { EVENTS.push(["create", "enGlow", 0]); return PTR(6); },
        createDeco() { EVENTS.push(["create", "deco", 0]); return PTR(7); },
        createMenu() { EVENTS.push(["create", "menu", 0]); return PTR(8); },
        sequenceTick(self, child) {
            EVENTS.push(["seqTick", self >>> 0, child >>> 0]);
            return SEQ_RET;
        },
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
    };
}

function pass(usePort, o) {
    seed(o);
    EVENTS = [];
    if (usePort) titleSequenceOwnerTick(rt.mem, SELF, CHILD, portHost());
    else rt.cpu.call(0x80086c70, [SELF, CHILD]);
    return snapshot();
}

function run(label, o) {
    const oracle = pass(false, o);
    const port = pass(true, o);
    assert.deepEqual(port.events, oracle.events, `${label}: calls`);
    assert.equal(port.state0, oracle.state0, `${label}: state0`);
    assert.equal(port.acc, oracle.acc, `${label}: +0x54`);
    assert.deepEqual(port.block, oracle.block, `${label}: child block`);
}

test("titleSequenceOwnerTick matches F0x80086C70", () => {
    run("build jp", { state0: 0, lang: 0 });
    run("build en", { state0: 0, lang: 1 });
    run("build negative", { state0: -1, lang: 2 });
    run("build above 3", { state0: 7, lang: 0 });
    run("state1 zero", { state0: 1, seq: 0 });
    run("state1 nonzero", { state0: 1, seq: 1 });
    run("state1 returns 5", { state0: 1, seq: 5 });
    run("state2", { state0: 2 });
    run("state3", { state0: 3 });
});
