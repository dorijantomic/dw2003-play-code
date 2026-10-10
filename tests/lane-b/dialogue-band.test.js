// Lane B Phase 4 oracle: engine/dw3/ui/native/dialogue-band.ts must match the
// resident EXE F0x8001BB88 (band create), F0x8001BA2C (tick), F0x8001B814 (band
// draw) and F0x8001B930 (advance-blink marker). The originals run through
// engine/native on resident.bin; the task factory, SFX entry, frame counter,
// pack getter, draw-context builder and the context's function slots are stubbed
// on both sides, so memory and the ordered calls (with arguments) compare.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    dialogueBandCreate,
    dialogueBandDraw,
    dialogueBandMarker,
    dialogueBandTick,
} from "../../engine/dw3/ui/native/dialogue-band.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const STUB = 0x0fe40000;
const FRAME_CELL = 0x8004de10 + 0x188;
const PACK_CELL = 0x80044f5c;
const SOUND_CELL = 0x80055c48;
const PACK = 0x80777000;

const LOG = [];
const CTL = { frame: 0 };

const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
const sg = (c, n) => c.reg(4 + n) | 0;

// Draw-context slots, by offset from the context base (a0 of F0x8001F648).
const CTX = {
    0x7c: ["setLayer", 2], 0x74: ["setOrigin", 2], 0x8c: ["setScale", 3],
    0x94: ["setPos", 2], 0x88: ["setFrame", 1], 0x84: ["drawSprite", 4],
};
let n = 0;
const slotAddr = {};
for (const [off, [name, argc]] of Object.entries(CTX)) {
    const addr = STUB + 0x100 + 4 * n++;
    slotAddr[off] = addr;
    st(addr, (c) => { LOG.push([name, ...Array.from({ length: argc }, (_, i) => sg(c, i))]); return 0; });
}
st(0x8001f648, (c) => {
    LOG.push(["initDrawContext"]);
    for (const off of Object.keys(CTX)) rt.mem.write32((c.reg(4) >>> 0) + Number(off), slotAddr[off]);
    return 0;
});
const BASE = { 0x28: 1, 0x38: 0, 0x3c: 0 };
for (const [slot, argc] of Object.entries(BASE)) {
    const addr = STUB + 0x200 + Number(slot);
    slotAddr[slot] = addr;
    st(addr, (c) => { LOG.push(["method", c.reg(4) >>> 0, Number(slot), ...Array.from({ length: argc }, (_, i) => sg(c, 1 + i))]); return 0; });
}
st(0x80014504, (c) => { LOG.push(["task", c.reg(4) >>> 0, sg(c, 1), sg(c, 2)]); return OBJ; });
st(STUB + 0x10, (c) => { LOG.push(["sound", c.reg(4) >>> 0]); return 0; });
st(STUB + 0x14, () => { LOG.push(["frame"]); return CTL.frame; });
st(STUB + 0x18, (c) => { LOG.push(["pack", c.reg(4) >>> 0]); return PACK; });
rt.mem.write32(SOUND_CELL, STUB + 0x10);
rt.mem.write32(FRAME_CELL, STUB + 0x14);
rt.mem.write32(PACK_CELL, STUB + 0x18);

const host = {
    createTask(tick, size, align) { LOG.push(["task", tick, size, align]); return OBJ; },
    playSound(id) { LOG.push(["sound", id >>> 0]); },
    callMethod(o, slot, args) { LOG.push(["method", o >>> 0, slot, ...args.map((a) => a | 0)]); },
    frameCounter() { LOG.push(["frame"]); return CTL.frame; },
    initDrawContext() { LOG.push(["initDrawContext"]); },
    setLayer(a, b) { LOG.push(["setLayer", a | 0, b | 0]); },
    setOrigin(a, b) { LOG.push(["setOrigin", a | 0, b | 0]); },
    setScale(a, b, c) { LOG.push(["setScale", a | 0, b | 0, c | 0]); },
    setPos(a, b) { LOG.push(["setPos", a | 0, b | 0]); },
    setFrame(a) { LOG.push(["setFrame", a | 0]); },
    drawSprite(p, a, b, c) { LOG.push(["drawSprite", p | 0, a | 0, b | 0, c | 0]); },
    packResolve(h) { LOG.push(["pack", h >>> 0]); return PACK; },
};

function snap() {
    const out = [];
    for (let i = 0; i < 0x80; i += 4) out.push(rt.mem.read32(OBJ + i) >>> 0);
    return out;
}
function seed(c = {}) {
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(OBJ + i, 0);
    const f = { state: 1, step: 0, layer: 0x1234, last54: 0, n58: 0, flag5c: 0, last60: 0, f64: 0, w68: 0, sp6a: 0x199, ...c };
    rt.mem.write32(OBJ + 0x0c, f.state);
    rt.mem.write32(OBJ + 0x10, f.step);
    rt.mem.write32(OBJ + 0x28, slotAddr[0x28]);
    rt.mem.write32(OBJ + 0x38, slotAddr[0x38]);
    rt.mem.write32(OBJ + 0x3c, slotAddr[0x3c]);
    rt.mem.write32(OBJ + 0x50, f.layer);
    rt.mem.write32(OBJ + 0x54, f.last54);
    rt.mem.write32(OBJ + 0x58, f.n58);
    rt.mem.write32(OBJ + 0x5c, f.flag5c);
    rt.mem.write32(OBJ + 0x60, f.last60);
    rt.mem.write32(OBJ + 0x64, f.f64);
    rt.mem.write16(OBJ + 0x68, f.w68);
    rt.mem.write16(OBJ + 0x6a, f.sp6a);
    CTL.frame = f.frame ?? 0;
}

function compare(name, c, orig, port) {
    seed(c); LOG.length = 0; orig();
    const olog = LOG.slice(); const osnap = snap();
    seed(c); LOG.length = 0; port();
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
    return olog;
}
const orig = (addr) => () => rt.cpu.call(addr, [OBJ], 5000);

test("dialogueBandCreate matches F0x8001BB88", () => {
    for (const h of [0x1000, 0x8000, -1, 0x12345, 0]) {
        const log = compare(`create ${h}`, {},
            () => { assert.equal(rt.cpu.call(0x8001bb88, [h]) >>> 0, OBJ); },
            () => { assert.equal(dialogueBandCreate(rt.mem, host, h), OBJ); });
        assert.deepEqual(log[0], ["task", 0x8001ba2c, 0x6c, 0]);
        assert.deepEqual(log[1], ["sound", 0x40019]);
        assert.equal(rt.mem.read32(OBJ + 0x50) | 0, h);
    }
});

test("band draw: both strips, per step", () => {
    for (const step of [-1, 0, 1, 2, 3, 7])
        for (const w68 of [0, 0x199, 0x1000, 0xf000, 0x8001])
            compare(`draw step ${step} w ${w68}`, { step, w68, n58: step === 2 ? 3 : 0, layer: -5 },
                orig(0x8001b814), () => dialogueBandDraw(rt.mem, OBJ, host));
    const log = compare("draw step 0", { step: 0, w68: 0x300 }, orig(0x8001b814), () => dialogueBandDraw(rt.mem, OBJ, host));
    assert.deepEqual(log.filter((e) => e[0] === "drawSprite"), [["drawSprite", PACK | 0, 8, 0, 0xa6], ["drawSprite", PACK | 0, 9, 0, 0xa6]]);
    assert.deepEqual(log.filter((e) => e[0] === "setPos"), [["setPos", 0x140, 0xc4], ["setPos", 0, 0xc4]]);
    compare("draw step 2", { step: 2, n58: 4 }, orig(0x8001b814), () => dialogueBandDraw(rt.mem, OBJ, host));
});

test("band marker: blink timing and wrap", () => {
    for (const frame of [0, 3, 4, 5, 100, -2])
        for (const last60 of [0, 1, 96, 100])
            for (const f64 of [0, 3, 4, 9])
                compare(`marker f ${frame} l ${last60} b ${f64}`, { frame, last60, f64 },
                    orig(0x8001b930), () => dialogueBandMarker(rt.mem, OBJ, host));
    const log = compare("marker wrap", { frame: 10, last60: 0, f64: 4 }, orig(0x8001b930), () => dialogueBandMarker(rt.mem, OBJ, host));
    assert.equal(rt.mem.read32(OBJ + 0x64) | 0, 0);
    assert.deepEqual(log[log.length - 1], ["drawSprite", PACK | 0, 0xa, 0x124, 0xcd]);
});

const tickPort = () => dialogueBandTick(rt.mem, OBJ, host);

test("tick: task states other than 1 park and reset the speed", () => {
    for (const state of [-1, 0, 2, 3, 4, 9]) {
        compare(`state ${state}`, { state, step: 0, sp6a: 7 }, orig(0x8001ba2c), tickPort);
    }
    seed({ state: 0, sp6a: 7 }); rt.cpu.call(0x8001ba2c, [OBJ], 5000);
    assert.equal(rt.mem.read16(OBJ + 0x6a), 0x199);
});

test("tick step 0 / other: wipe-in, clamp and complete", () => {
    for (const step of [0, -1, 3, 9])
        for (const w68 of [0, 0x199, 0xe66, 0xe67, 0x1000, 0x7fff, 0x8000, 0xffff])
            for (const sp6a of [0x199, 0, 0x1000, 0x8000])
                compare(`step ${step} w ${w68} s ${sp6a}`, { step, w68, sp6a }, orig(0x8001ba2c), tickPort);
    const log = compare("clamp", { step: 0, w68: 0xf00, sp6a: 0x199 }, orig(0x8001ba2c), tickPort);
    assert.equal(rt.mem.read16(OBJ + 0x68), 0x1000);
    assert.ok(log.some((e) => e[0] === "method" && e[2] === 0x3c));
});

test("tick step 1: idle draws the marker only when flagged", () => {
    for (const flag5c of [0, 1, -1])
        for (const frame of [0, 4, 8])
            compare(`idle ${flag5c} ${frame}`, { step: 1, flag5c, frame, last60: 2, f64: 4 }, orig(0x8001ba2c), tickPort);
});

test("tick step 2: five-step wipe-out", () => {
    for (const frame of [0, 2, 3, 4, 50, -9])
        for (const n58 of [0, 3, 4, 5, -1])
            for (const last54 of [0, 1, 47, 50])
                compare(`out f ${frame} n ${n58} l ${last54}`, { step: 2, frame, n58, last54 }, orig(0x8001ba2c), tickPort);
    const log = compare("finish", { step: 2, frame: 9, n58: 4, last54: 0 }, orig(0x8001ba2c), tickPort);
    assert.deepEqual(log[log.length - 1], ["method", OBJ, 0x28, 3]);
    assert.ok(!log.some((e) => e[0] === "drawSprite"));
});
