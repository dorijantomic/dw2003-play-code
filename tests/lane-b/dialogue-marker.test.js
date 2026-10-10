// Lane B Phase 4 oracle: engine/dw3/ui/native/dialogue-marker.ts must match the
// resident EXE F0x8001C4B4 (marker spawn), F0x8001C448 (marker tick) and
// F0x8001BEEC (marker draw). The originals run through engine/native on
// resident.bin; the task factory, frame counter, pack getter, draw-context
// builder, its function slots, F0x8001C050 and the base method are stubbed on
// both sides, so memory and the ordered calls (with arguments) compare.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    dialogueMarkerDraw,
    dialogueMarkerSpawn,
    dialogueMarkerTick,
} from "../../engine/dw3/ui/native/dialogue-marker.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const WIN = 0x80151000;
const STUB = 0x0fe40000;
const FRAME_CELL = 0x8004de10 + 0x188;
const PACK_CELL = 0x80044f5c;
const PACK = 0x80777000;

const LOG = [];
const CTL = { frame: 0 };

const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
const sg = (c, n) => c.reg(4 + n) | 0;

const CTX = {
    0x7c: ["setLayer", 2], 0x74: ["setOrigin", 2], 0x88: ["setFrame", 1], 0x84: ["drawSprite", 4],
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
slotAddr[0x28] = STUB + 0x228;
st(slotAddr[0x28], (c) => { LOG.push(["method", c.reg(4) >>> 0, 0x28, sg(c, 1)]); return 0; });
st(0x80014504, (c) => { LOG.push(["task", c.reg(4) >>> 0, sg(c, 1), sg(c, 2)]); return OBJ; });
st(0x8001c050, (c) => { LOG.push(["balloon", c.reg(4) >>> 0]); return 0; });
st(STUB + 0x14, () => { LOG.push(["frame"]); return CTL.frame; });
st(STUB + 0x18, (c) => { LOG.push(["pack", c.reg(4) >>> 0]); return PACK; });
rt.mem.write32(FRAME_CELL, STUB + 0x14);
rt.mem.write32(PACK_CELL, STUB + 0x18);

const host = {
    createTask(tick, size, align) { LOG.push(["task", tick, size, align]); return OBJ; },
    callMethod(o, slot, args) { LOG.push(["method", o >>> 0, slot, ...args.map((a) => a | 0)]); },
    drawBalloon(o) { LOG.push(["balloon", o >>> 0]); },
    frameCounter() { LOG.push(["frame"]); return CTL.frame; },
    initDrawContext() { LOG.push(["initDrawContext"]); },
    setLayer(a, b) { LOG.push(["setLayer", a | 0, b | 0]); },
    setOrigin(a, b) { LOG.push(["setOrigin", a | 0, b | 0]); },
    setFrame(a) { LOG.push(["setFrame", a | 0]); },
    drawSprite(p, a, b, c) { LOG.push(["drawSprite", p | 0, a | 0, b | 0, c | 0]); },
    packResolve(h) { LOG.push(["pack", h >>> 0]); return PACK; },
};

function snap() {
    const out = [];
    for (let i = 0; i < 0x80; i += 4) out.push(rt.mem.read32(OBJ + i) >>> 0, rt.mem.read32(WIN + i) >>> 0);
    return out;
}
function seed(c = {}) {
    for (let i = 0; i < 0x80; i += 4) { rt.mem.write32(OBJ + i, 0); rt.mem.write32(WIN + i, 0); }
    const f = { state: 1, flag: 1, f54: 0, last58: 0, mode: 0, layer: 0x1234, px: 100, py: 60, tail: 200, ...c };
    rt.mem.write32(OBJ + 0x0c, f.state);
    rt.mem.write32(OBJ + 0x28, slotAddr[0x28]);
    rt.mem.write32(OBJ + 0x50, WIN);
    rt.mem.write32(OBJ + 0x54, f.f54);
    rt.mem.write32(OBJ + 0x58, f.last58);
    rt.mem.write8(OBJ + 0x5c, f.flag);
    rt.mem.write32(WIN + 0x54, f.layer);
    rt.mem.write32(WIN + 0x58, f.mode);
    rt.mem.write16(WIN + 0x60, f.px);
    rt.mem.write16(WIN + 0x62, f.py);
    rt.mem.write16(WIN + 0x64, f.tail);
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
const drawPort = () => dialogueMarkerDraw(rt.mem, host, OBJ);
const tickPort = () => dialogueMarkerTick(rt.mem, host, OBJ);

test("D0x8004DD10 table values (x, y per mode)", () => {
    const want = [[16, -38], [16, 48], [125, -38], [125, 48]];
    for (let m = 0; m < 4; m++) {
        assert.equal(rt.mem.read16s(0x8004dd10 + m * 32), want[m][0]);
        assert.equal(rt.mem.read16s(0x8004dd10 + m * 32 + 2), want[m][1]);
    }
});

test("dialogueMarkerSpawn matches F0x8001C4B4", () => {
    for (const w of [WIN, 0x8000, -1, 0x12345, 0]) {
        const log = compare(`spawn ${w}`, {},
            () => { rt.cpu.call(0x8001c4b4, [w]); },
            () => { assert.equal(dialogueMarkerSpawn(rt.mem, host, w), OBJ); });
        assert.deepEqual(log[0], ["task", 0x8001c448, 0x60, 0]);
        assert.equal(rt.mem.read32(OBJ + 0x50) | 0, w | 0);
    }
});

test("marker draw: modes, flag, step timing, wrap", () => {
    for (const mode of [0, 1, 2, 3, 4, 5, 6, 7])
        for (const flag of [0, 1, 0x100])
            for (const frame of [0, 5, 6, 7, 100, -2])
                for (const last58 of [0, 1, 94, 100])
                    for (const f54 of [0, 2, 3, 4, 9])
                        compare(`draw m${mode} fl${flag} f${frame} l${last58} k${f54}`,
                            { mode, flag, frame, last58, f54, px: -20, py: 0x7fff, tail: 0x8001 },
                            orig(0x8001beec), drawPort);
    const log = compare("wrap", { mode: 1, frame: 10, last58: 0, f54: 3 }, orig(0x8001beec), drawPort);
    assert.equal(rt.mem.read32(OBJ + 0x54) | 0, 0);
    assert.equal(rt.mem.read32(OBJ + 0x58) | 0, 10);
    assert.deepEqual(log[log.length - 1], ["drawSprite", PACK | 0, 7, 116, 108]);
    assert.deepEqual(log.find((e) => e[0] === "pack"), ["pack", 0x02860000]);
});

test("marker draw contract per mode", () => {
    const at = (mode) => compare(`mode ${mode}`, { mode, px: 100, py: 60, tail: 200 }, orig(0x8001beec), drawPort)
        .find((e) => e[0] === "drawSprite");
    assert.deepEqual(at(0), ["drawSprite", PACK | 0, 7, 116, 22]);
    assert.deepEqual(at(1), ["drawSprite", PACK | 0, 7, 116, 108]);
    assert.deepEqual(at(2), ["drawSprite", PACK | 0, 7, 100 + 200 - 14, 22]);
    assert.deepEqual(at(3), ["drawSprite", PACK | 0, 7, 100 + 200 - 14, 108]);
});

test("marker draw: no calls when the flag is clear", () => {
    const log = compare("flag0", { flag: 0 }, orig(0x8001beec), drawPort);
    assert.deepEqual(log, []);
});

test("marker tick: state 1 draws, others close", () => {
    for (const state of [-1, 0, 1, 2, 3, 4, 9])
        for (const flag of [0, 1])
            compare(`state ${state} flag ${flag}`, { state, flag, frame: 6 }, orig(0x8001c448), tickPort);
    const log = compare("close", { state: 0 }, orig(0x8001c448), tickPort);
    assert.deepEqual(log, [["method", OBJ, 0x28, 2]]);
    const draw = compare("draw", { state: 1 }, orig(0x8001c448), tickPort);
    assert.deepEqual(draw[draw.length - 1], ["balloon", OBJ]);
    assert.deepEqual(compare("wait", { state: 2 }, orig(0x8001c448), tickPort), []);
});
