// Lane B Phase 4 oracle: engine/dw3/ui/native/dialogue-plain-window.ts must
// match the resident EXE F0x8001BE00 (plain window build) and F0x8001BBE8 (its
// tick). The originals run through engine/native on resident.bin; the task
// factory, text factory, band spawner, widget methods, pad service and SFX
// entry are stubbed on both sides so memory and the ordered calls compare.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    dialoguePlainWindowBuild,
    dialoguePlainWindowTick,
} from "../../engine/dw3/ui/native/dialogue-plain-window.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TASK = 0x80150000;
const STATE = 0x80150100;
const WIDGET = 0x80150200;
const BAND = 0x80150400;
const NEW_BAND = 0x80150600;
const STUB = 0x0fe40000;
const PAD_READ_CELL = 0x8004b7d0 + 0x3f4;
const PAD_SHIFT_CELL = 0x8004b7d0 + 0x408;
const SOUND_CELL = 0x80055c48;
const M = { 0x160: 1, 0x114: 2, 0x144: 1, 0x130: 1, 0x168: 0, 0x16c: 0, 0x170: 0, 0x128: 0 };
const BASE = { 0x28: 1, 0x38: 0 };

const LOG = [];
const CTL = { m168: 0, m16c: 0, m170: 0, pad: 0, shift: 0 };

const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);

function result(slot) {
    return slot === 0x168 ? CTL.m168 : slot === 0x16c ? CTL.m16c : slot === 0x170 ? CTL.m170 : 0;
}
let slotIdx = 0;
const slotAddr = {};
for (const [slot, n] of [...Object.entries(M), ...Object.entries(BASE)]) {
    const s = Number(slot);
    const addr = STUB + 0x100 + 4 * slotIdx++;
    slotAddr[s] = addr;
    const base = s in BASE && !(s in M);
    st(addr, (c) => {
        const args = [];
        for (let i = 0; i < n; i++) args.push(c.reg(5 + i) | 0);
        LOG.push([base ? "base" : "method", (c.reg(4) >>> 0), s, ...args]);
        return base ? 0 : result(s);
    });
}
st(0x80014504, (c) => { LOG.push(["task", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return TASK; });
st(0x8001ae38, (c) => {
    LOG.push(["text", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
    for (const slot of Object.keys(M)) rt.mem.write32(WIDGET + Number(slot), slotAddr[slot]);
    return WIDGET;
});
st(0x8001bb88, (c) => { LOG.push(["band", c.reg(4) | 0]); return NEW_BAND; });
st(STUB + 0x10, (c) => { LOG.push(["padRead", c.reg(4) | 0]); return CTL.pad; });
st(STUB + 0x14, (c) => { LOG.push(["padShift", c.reg(4) | 0, c.reg(5) | 0]); return CTL.shift; });
st(STUB + 0x18, (c) => { LOG.push(["sound", c.reg(4) >>> 0]); return 0; });
rt.mem.write32(PAD_READ_CELL, STUB + 0x10);
rt.mem.write32(PAD_SHIFT_CELL, STUB + 0x14);
rt.mem.write32(SOUND_CELL, STUB + 0x18);

const portHost = () => ({
    createTask(tick, size, align) { LOG.push(["task", tick, size, align]); return TASK; },
    createText(t, k, x, y) { LOG.push(["text", t, k, x, y]); return WIDGET; },
    createBand(h) { LOG.push(["band", h | 0]); return NEW_BAND; },
    callMethod(t, slot, args) {
        const base = slot in BASE && !(slot in M);
        LOG.push([base ? "base" : "method", t >>> 0, slot, ...args.map((a) => a | 0)]);
        return base ? 0 : result(slot);
    },
    padRead(p) { LOG.push(["padRead", p | 0]); return CTL.pad; },
    padShift(p, b) { LOG.push(["padShift", p | 0, b | 0]); return CTL.shift; },
    playSound(id) { LOG.push(["sound", id >>> 0]); },
});

function snap() {
    const out = [];
    for (const b of [TASK, STATE, BAND, NEW_BAND]) for (let i = 0; i < 0x80; i += 4) out.push(rt.mem.read32(b + i) >>> 0);
    return out;
}
function seed(c = {}) {
    for (const b of [TASK, STATE, BAND, NEW_BAND]) for (let i = 0; i < 0x80; i += 4) rt.mem.write32(b + i, 0);
    rt.mem.write32(TASK + 0x24, STATE);
    rt.mem.write32(TASK + 0x0c, c.state ?? 1);
    rt.mem.write32(TASK + 0x10, c.step ?? 0);
    rt.mem.write32(TASK + 0x28, slotAddr[0x28]);
    rt.mem.write32(TASK + 0x38, slotAddr[0x38]);
    rt.mem.write32(STATE, WIDGET);
    rt.mem.write32(STATE + 4, c.noBand ? 0 : BAND);
    rt.mem.write32(BAND + 0x10, c.bandFlag ?? 0);
    rt.mem.write32(BAND + 0x5c, 0x77);
    Object.assign(CTL, { m168: 0, m16c: 0, m170: 0, pad: 0, shift: 0 }, c.ctl ?? {});
    for (const slot of Object.keys(M)) rt.mem.write32(WIDGET + Number(slot), slotAddr[slot]);
}

function compare(name, c, orig, port) {
    seed(c); LOG.length = 0; orig();
    const olog = LOG.slice(); const osnap = snap();
    seed(c); LOG.length = 0; port();
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
    return olog;
}

test("dialoguePlainWindowBuild matches F0x8001BE00", () => {
    for (const [h, pack, line] of [[0x1000, 0x80123456, 3], [0x8000, 0, 0], [-1, 0x7fffffff, -5], [0x12345, 1, 2]]) {
        const log = compare(`build ${h}`, {},
            () => { assert.equal(rt.cpu.call(0x8001be00, [h, pack, line]) >>> 0, TASK); },
            () => { assert.equal(dialoguePlainWindowBuild(rt.mem, portHost(), h, pack, line), TASK); });
        assert.equal(log.length, 7);
        assert.equal(rt.mem.read32(STATE + 4) >>> 0, NEW_BAND);
    }
});

const tickOrig = () => rt.cpu.call(0x8001bbe8, [TASK, STATE], 5000);
const tickPort = () => dialoguePlainWindowTick(rt.mem, TASK, STATE, portHost());

test("tick: task states other than 1", () => {
    for (const state of [-1, 0, 2, 3, 4, 9]) compare(`state ${state}`, { state, step: 1 }, tickOrig, tickPort);
});

test("tick step 1: typewriter finished closes the band", () => {
    const log = compare("close", { step: 1, bandFlag: 1, ctl: { m168: 1 } }, tickOrig, tickPort);
    assert.equal(rt.mem.read32(BAND + 0x10) >>> 0, 2);
    assert.ok(log.some((e) => e[0] === "sound" && e[1] === 0x4001a));
    compare("close nonzero value", { step: 1, ctl: { m168: -7 } }, tickOrig, tickPort);
});

test("tick step 1: pad bit and scroll-state branches", () => {
    for (const pad of [0, 1, 0x2000, 0x4000, -1])
        for (const shift of [0, 13, 33])
            for (const m170 of [0, 1, 5])
                compare(`pad ${pad} shift ${shift} m170 ${m170}`, { step: 1, ctl: { pad, shift, m170 } }, tickOrig, tickPort);
});

test("tick step 2: waits for the band to vanish", () => {
    compare("step 2 band", { step: 2 }, tickOrig, tickPort);
    const log = compare("step 2 no band", { step: 2, noBand: true }, tickOrig, tickPort);
    assert.ok(log.some((e) => e[0] === "base" && e[2] === 0x28 && e[3] === 3));
});

test("tick other steps: page button wait", () => {
    for (const step of [0, -1, 3, 4, 100])
        for (const m16c of [0, 1])
            for (const bandFlag of [0, 1, 2])
                compare(`step ${step} m16c ${m16c} band ${bandFlag}`, { step, bandFlag, ctl: { m16c } }, tickOrig, tickPort);
    compare("advance", { step: 0, bandFlag: 1 }, tickOrig, tickPort);
    assert.equal(rt.mem.read32(TASK + 0x10) | 0, 1);
});
