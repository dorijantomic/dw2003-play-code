// Oracle: the dim-quad fade object in engine/dw3/ui/native/pause-card-folders.ts
// against the original pro/ststatus F0x80084F10 family.
import { test } from "node:test";
import { createHarness } from "./helpers/screen-harness.js";
import { dimQuadDraw, dimQuadFactory, dimQuadStart, dimQuadTick } from "../../engine/dw3/ui/native/pause-card-folders.ts";

const h = createHarness({ overlayFile: "pro_ststatus.bin" });
const SERVICE = 0x8004de10;
const VIEW = 0x80190000, BUCKET = 0x80191000, CURSOR = 0x80192000, CURSOR_CELL = 0x8004de30;
const OBJ = 0x80150000;
const RANGES = [[OBJ, 0x70], [BUCKET, 4], [CURSOR, 0x40], [CURSOR_CELL, 4]];
const BUCKET_STUB = 0x8001dfa8, GET_CURSOR = 0x8001d844, SET_CURSOR = 0x8001d854;
h.rt.cpu.setStub(BUCKET_STUB, (c) => { h.LOG.push(["otBucket", c.reg(4) >>> 0, c.reg(5) | 0]); return BUCKET; });
h.rt.cpu.setStub(GET_CURSOR, () => { h.LOG.push(["getCursor"]); return CURSOR; });
h.rt.cpu.setStub(SET_CURSOR, (c) => { h.LOG.push(["setCursor", c.reg(4) >>> 0]); h.rt.mem.write32(CURSOR_CELL, c.reg(4) >>> 0); });
h.rt.cpu.setStub(0x0fe20090, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0x38, c.reg(5) | 0]); return 0; });

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    for (let i = 0; i < 0x70; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0x40; i += 4) m.write32(CURSOR + i, 0xa5a5a5a5 | 0);
    m.write32(SERVICE + 0x60, VIEW);
    m.write32(SERVICE + 0xd8, 0x100);
    m.write32(VIEW + 0x138, BUCKET_STUB);
    m.write32(BUCKET, c.bucket ?? 0x801abcde);
    m.write32(CURSOR_CELL, CURSOR);
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    set(0xc, c.state ?? 1); set(0x10, c.active ?? 1); set(0x28, h.S.methodBase + 0x28); set(0x38, 0x0fe20090);
    set(0x50, 0x100); set(0x54, c.depth ?? 0); set(0x58, c.dir ?? 0); set(0x5c, c.level ?? 0x4000); set(0x60, c.step ?? 0x1000);
    h.CTL.alloc = OBJ;
    h.reset(c.rseed ?? 3);
};
const host = () => {
    const base = h.host();
    const mem = h.rt.mem;
    return {
        ...base,
        otBucket(view, depth) { h.LOG.push(["otBucket", view >>> 0, depth | 0]); return BUCKET; },
        cursor() { h.LOG.push(["getCursor"]); return CURSOR; },
        setCursor(p) { h.LOG.push(["setCursor", p >>> 0]); mem.write32(CURSOR_CELL, p >>> 0); },
    };
};
const original = (address, args, budget = 200000) => () => h.rt.cpu.call(address, args, budget);

test("dim quad factory and start match", () => {
    h.compare("factory", seed(), RANGES, original(0x80084f10, [], 20000), () => dimQuadFactory(h.rt.mem, host()));
    for (const [dir, frames] of [[0, 10], [1, 10], [0, 7], [1, 255], [0, 1]]) {
        h.compare(`start ${dir} ${frames}`, seed(), RANGES, original(0x80084c90, [OBJ, dir, frames], 5000),
            () => dimQuadStart(h.rt.mem, OBJ, dir, frames, host()));
    }
});

test("dim quad draw and tick match", () => {
    for (const level of [0, 0x4000, 0xff00, 0x100, 0xffff, 0x7fff]) {
        h.compare(`draw ${level}`, seed({ level }), RANGES, original(0x80084d18, [OBJ]), () => dimQuadDraw(h.rt.mem, OBJ, host()));
    }
    for (const state of [0, 1, 2, 3, 4, -1]) {
        for (const active of [0, 1]) {
            for (const dir of [0, 1]) {
                for (const [level, step] of [[0x4000, 0x1000], [0xf800, 0x1000], [0x400, -0x1000], [0x400, 0x300], [0xff00, 0x100], [0, -0x400]]) {
                    h.compare(`tick s${state} a${active} d${dir} ${level} ${step}`, seed({ state, active, dir, level, step }), RANGES,
                        original(0x80084e5c, [OBJ], 300000), () => dimQuadTick(h.rt.mem, OBJ, host()));
                }
            }
        }
    }
});
