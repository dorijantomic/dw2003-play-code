// Lane B Phase 4 oracle: engine/dw3/ui/native/dialogue-frame.ts must match the
// resident EXE F0x8001C050 (balloon outline pieces + translucent fill). The
// original runs through engine/native on resident.bin; the draw context, pack
// getter and ordering-table service are stubbed on both sides, so the ordered
// calls, the primitive bytes and the ordering-table link all compare.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { dialogueFrameDraw } from "../../engine/dw3/ui/native/dialogue-frame.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const WIN = 0x80151000;
const LAYEROBJ = 0x80152000;
const OT = 0x80153000;
const PRIM = 0x80154000;
const STUB = 0x0fe40000;
const PACK = 0x80777000;
const SVC = 0x8004de10;

const LOG = [];
const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
const sg = (c, n) => c.reg(4 + n) | 0;

const CTX = { 0x7c: ["setLayer", 2], 0x74: ["setOrigin", 2], 0x84: ["drawSprite", 4] };
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
rt.mem.write32(0x80044f5c, STUB + 0x18);
st(STUB + 0x18, (c) => { LOG.push(["pack", c.reg(4) >>> 0]); return PACK; });
rt.mem.write32(SVC + 0x17c, STUB + 0x20);
st(STUB + 0x20, (c) => { LOG.push(["layerObject", sg(c, 0)]); return LAYEROBJ; });
rt.mem.write32(LAYEROBJ + 0x138, STUB + 0x24);
st(STUB + 0x24, (c) => { LOG.push(["orderingHead", c.reg(4) >>> 0, sg(c, 1)]); return OT; });
rt.mem.write32(SVC + 0x158, STUB + 0x28);
st(STUB + 0x28, (c) => { LOG.push(["allocPrim", sg(c, 0), sg(c, 1)]); return PRIM; });
rt.mem.write32(SVC + 0x15c, STUB + 0x2c);
st(STUB + 0x2c, (c) => { LOG.push(["commitPrim", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]); return 0; });

const INTENTS = [];
const host = {
    initDrawContext() { LOG.push(["initDrawContext"]); },
    setLayer(a, b) { LOG.push(["setLayer", a | 0, b | 0]); },
    setOrigin(a, b) { LOG.push(["setOrigin", a | 0, b | 0]); },
    drawSprite(p, a, b, c) { LOG.push(["drawSprite", p | 0, a | 0, b | 0, c | 0]); },
    packResolve(h) { LOG.push(["pack", h >>> 0]); return PACK; },
    layerObject(l) { LOG.push(["layerObject", l | 0]); return LAYEROBJ; },
    orderingHead(o) { LOG.push(["orderingHead", o >>> 0, 0]); return OT; },
    allocPrim(a, b) { LOG.push(["allocPrim", a | 0, b | 0]); return PRIM; },
    commitPrim(next, link, mask, intent) { LOG.push(["commitPrim", next >>> 0, link >>> 0, mask >>> 0]); INTENTS.push(intent); },
};

function snap() {
    const out = [];
    for (const base of [OBJ, WIN, PRIM, OT]) for (let i = 0; i < 0x40; i += 4) out.push(rt.mem.read32(base + i) >>> 0);
    return out;
}
function seed(c = {}) {
    for (const base of [OBJ, WIN, PRIM]) for (let i = 0; i < 0x40; i += 4) rt.mem.write32(base + i, 0);
    rt.mem.write32(OT, 0xab123456);
    rt.mem.write32(PRIM, 0x5a5a5a5a);
    const f = { mode: 0, layer: 0x1234, px: 100, py: 60, w: 120, h: 40, ...c };
    rt.mem.write32(OBJ + 0x50, WIN);
    rt.mem.write32(WIN + 0x54, f.layer);
    rt.mem.write32(WIN + 0x58, f.mode);
    rt.mem.write16(WIN + 0x60, f.px);
    rt.mem.write16(WIN + 0x62, f.py);
    rt.mem.write16(WIN + 0x64, f.w);
    rt.mem.write16(WIN + 0x66, f.h);
}
function compare(name, c) {
    seed(c); LOG.length = 0; rt.cpu.call(0x8001c050, [OBJ], 20000);
    const olog = LOG.slice(); const osnap = snap();
    seed(c); LOG.length = 0; INTENTS.length = 0; dialogueFrameDraw(rt.mem, host, OBJ);
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
    return olog;
}

test("table values", () => {
    const rd = (a) => rt.mem.read16s(a);
    const outline = [[[0, -16], [0, -74], [16, -74], [16, -74]], [[0, 0], [0, 12], [16, 12], [16, 12]],
        [[-16, -16], [-26, -74], [-10, -74], [125, -74]], [[-20, 0], [-26, 12], [-10, 12], [125, 12]]];
    const fill = [[16, -74], [16, 12], [-10, -74], [-10, 12]];
    const clip0 = [3, 5, 4, 6];
    for (let m = 0; m < 4; m++) {
        for (let i = 0; i < 4; i++) assert.deepEqual([rd(0x8004dcf8 + 32 * m + 4 * i), rd(0x8004dcf8 + 32 * m + 4 * i + 2)], outline[m][i]);
        assert.deepEqual([rd(0x8004dd00 + 32 * m), rd(0x8004dd00 + 32 * m + 2)], fill[m]);
        assert.equal(rt.mem.read32(0x8004dcf8 - 4 + 32 * m) | 0, clip0[m]);
    }
});

test("frame draw matches the original over modes and geometry", () => {
    for (const mode of [0, 1, 2, 3, 4, 5, 0x20000000])
        for (const [px, py] of [[100, 60], [-20, 0x7fff], [0x8000, -1]])
            for (const [w, h] of [[120, 40], [0xffff, 0xffff], [0, 0], [0x8001, 7]])
                for (const layer of [0, 0x1234, -3])
                    compare(`m${mode} ${px},${py} ${w}x${h} l${layer}`, { mode, px, py, w, h, layer });
});

test("frame draw contract per mode (sprites and fill)", () => {
    // [clip, x, y] for pieces 0, 1, 3 at pos (100, 60), width 120, height 40.
    const want = {
        0: [[3, 100, 44], [0, -20, -14], [2, 116, -14]],
        1: [[5, 100, 60], [0, -20, 72], [2, 116, 72]],
        2: [[4, 84, 44], [0, 74, -14], [2, 206, -14]],
        3: [[6, 80, 60], [0, 74, 72], [2, 206, 72]],
    };
    const fillX = [-4, -4, 90, 90];
    const fillY = [-14, 72, -14, 72];
    for (let mode = 0; mode < 4; mode++) {
        const log = compare(`mode ${mode}`, { mode, px: 100, py: 60, w: 120, h: 40 });
        const sp = log.filter((e) => e[0] === "drawSprite").map((e) => e.slice(2));
        assert.deepEqual(sp, want[mode]);
        const x0 = fillX[mode], y0 = fillY[mode];
        assert.deepEqual(INTENTS[0].corners, [x0, y0, x0 + 120, y0, x0, y0 + 40, x0 + 120, y0 + 40]);
        assert.equal(rt.mem.read8(PRIM + 3), 9);
        assert.equal(rt.mem.read8(PRIM + 7), 0x2e);
        assert.equal(rt.mem.read16(PRIM + 0xe), 0x2c57);
        assert.equal(rt.mem.read16(PRIM + 0x16), 0x45);
        assert.deepEqual([...Array(3)].map((_, k) => rt.mem.read8(PRIM + 4 + k)), [0x80, 0x80, 0x80]);
        assert.equal(INTENTS[0].abr, 2);
        assert.equal(rt.mem.read32(OT) >>> 0, (0xab000000 | (PRIM & 0xffffff)) >>> 0);
        assert.equal(rt.mem.read32(PRIM) >>> 0, 0x09123456);
    }
});
