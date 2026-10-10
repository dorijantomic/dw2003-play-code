// Oracle: engine/dw3/ui/native/pause-misc.ts against the original pro/ststatus bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import { pauseBootTick, pauseGridWord, pauseSeenScan, pauseStageByte } from "../../engine/dw3/ui/native/pause-misc.ts";

const HOST_FACTORY = 0x80099a80;
const OBJ = 0x80150000, OUT = 0x80150100, TABLE = 0x80151000, RECT = 0x80159000;
let h;
h = createHarness({
    overlayFile: "pro_ststatus.bin",
    functions: { pauseHostFactory: { address: HOST_FACTORY, args: [], result: () => 0x80177000 } },
});
const SERVICE = 0x8004de10;
const FLAG_CELL = 0x80048abc + 0x10;
const STUB = { reset: 0x0fe20100, pool: 0x0fe20104, area: 0x0fe20108, view: 0x0fe2010c, flag: 0x0fe20110 };
h.rt.cpu.setStub(STUB.reset, () => { h.LOG.push(["displayReset"]); return 0; });
h.rt.cpu.setStub(STUB.pool, (c) => { h.LOG.push(["setPool", c.reg(4) | 0]); return 0; });
h.rt.cpu.setStub(STUB.area, (c) => { h.LOG.push(["setArea", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
h.rt.cpu.setStub(STUB.view, (c) => {
    const p = c.reg(4) >>> 0;
    const m = h.rt.mem;
    h.LOG.push(["createView", m.read16s(p), m.read16s(p + 2), m.read16s(p + 4), m.read16s(p + 6), c.reg(5) | 0, c.reg(6) | 0]);
    return 0x80177400;
});
h.rt.cpu.setStub(0x0fe20114, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0x12c, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
h.rt.cpu.setStub(STUB.flag, (c) => {
    const id = c.reg(4) | 0;
    h.LOG.push(["flag", id, c.reg(5) | 0]);
    return (Math.imul(id, 2654435761) >>> 28) & 1;
});
const flagOf = (id, mode) => { h.LOG.push(["flag", id | 0, mode | 0]); return (Math.imul(id, 2654435761) >>> 28) & 1; };

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    for (let i = 0; i < 0x40; i += 4) m.write32(OBJ + i, 0);
    m.write32(OBJ + 0xc, c.state ?? 0);
    m.write32(OBJ + 0x38, h.S.methodBase + 0x38);
    m.write32(SERVICE + 0x150, STUB.reset); m.write32(SERVICE + 0x154, STUB.pool);
    m.write32(SERVICE + 0x174, STUB.area); m.write32(SERVICE + 0x16c, STUB.view);
    m.write32(FLAG_CELL, STUB.flag);
    m.write32(0x80048d68, c.stage ?? 0x100);
    for (let i = 0; i < 0x100; i++) m.write8(0x8009b5fc + i, (i * 37 + (c.rseed ?? 1)) & 0xff);
    for (let i = 0; i < 0x200; i += 4) m.write32(TABLE + i, 0);
    for (let i = 0; i < 0x80; i += 4) m.write32(0x8009af40 + i, (i * 0x1234567) | 0);
    m.write32(OUT, 0);
    // the view returned by the stubbed service carries a method table
    m.write32(0x80177400 + 0x12c, 0x0fe20114);
    h.CTL.alloc = OBJ;
    h.reset(c.rseed ?? 3);
};
const RANGES = [[OBJ, 0x40], [OUT, 4], [TABLE, 0x200]];
const host = () => {
    const base = h.host();
    return {
        callMethod: base.callMethod,
        displayReset() { h.LOG.push(["displayReset"]); },
        setPool(s) { h.LOG.push(["setPool", s | 0]); },
        setArea(w, hh, x, y) { h.LOG.push(["setArea", w | 0, hh | 0, x | 0, y | 0]); },
        createView(x, y, w, hh, mode, scale) { h.LOG.push(["createView", x, y, w, hh, mode | 0, scale | 0]); return 0x80177400; },
        pauseHostFactory() { h.LOG.push(["pauseHostFactory"]); return 0x80177000; },
    };
};

test("boot tick matches in every state", () => {
    for (const state of [0, 1, 2, 3, 4, -1, 9]) {
        h.compare(`boot ${state}`, seed({ state }), RANGES, () => h.rt.cpu.call(0x80083558, [OBJ, OUT], 200000),
            () => pauseBootTick(h.rt.mem, OBJ, OUT, host()));
    }
});

test("grid, stage byte and seen scan match", () => {
    for (const [row, col] of [[0, 0], [1, 2], [3, 4], [5, 1], [0, 7]]) {
        let want, got;
        h.compare(`grid ${row}${col}`, seed(), RANGES, () => { want = h.rt.cpu.call(0x80099f5c, [row, col], 5000) | 0; },
            () => { got = pauseGridWord(h.rt.mem, row, col) | 0; });
        assert.equal(got, want);
    }
    for (const stage of [0, 1, 0x7f, 0x80, 0xff]) {
        let want, got;
        h.compare(`stagebyte ${stage}`, seed({ stage }), RANGES, () => { want = h.rt.cpu.call(0x8009a698, [], 5000) | 0; },
            () => { got = pauseStageByte(h.rt.mem) | 0; });
        assert.equal(got, want);
    }
    for (const stage of [0x100, 0x1ff, 0x26f, 0x270, 0x2d6, 0x2d7, 0x300]) {
        for (const rseed of [1, 5]) {
            h.compare(`scan ${stage} ${rseed}`, seed({ stage, rseed }), RANGES, () => h.rt.cpu.call(0x8009a6b8, [TABLE], 400000),
                () => pauseSeenScan(h.rt.mem, TABLE, flagOf));
        }
    }
    void RECT;
});
