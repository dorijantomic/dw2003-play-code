// Oracle: the list scroll bar object in engine/dw3/ui/native/pause-equipment.ts
// against the original pro/ststatus F0x80099684 family.
import { test } from "node:test";
import { createHarness } from "./helpers/screen-harness.js";
import {
    scrollBarFactory, scrollBarList, scrollBarPlace, scrollBarRun, scrollBarStep, scrollBarTick,
} from "../../engine/dw3/ui/native/pause-equipment.ts";

const h = createHarness({ overlayFile: "pro_ststatus.bin" });
const SERVICE = 0x8004de10;
const VIEW = 0x80190000, BUCKET = 0x80191000, CURSOR = 0x80192000, CURSOR_CELL = 0x8004de30;
const OBJ = 0x80150000;
const RANGES = [[OBJ, 0xa0], [BUCKET, 4], [CURSOR, 0x40], [CURSOR_CELL, 4]];
const BUCKET_STUB = 0x8001dfa8, GET_CURSOR = 0x8001d844, SET_CURSOR = 0x8001d854;
h.rt.cpu.setStub(BUCKET_STUB, (c) => { h.LOG.push(["otBucket", c.reg(4) >>> 0, c.reg(5) | 0]); return BUCKET; });
h.rt.cpu.setStub(GET_CURSOR, () => { h.LOG.push(["getCursor"]); return CURSOR; });
h.rt.cpu.setStub(SET_CURSOR, (c) => {
    h.LOG.push(["setCursor", c.reg(4) >>> 0]);
    h.rt.mem.write32(CURSOR_CELL, c.reg(4) >>> 0);
});
h.rt.cpu.setStub(0x0fe20070, (c) => { h.LOG.push(["method", c.reg(4) | 0, 0x38, c.reg(5) | 0, c.reg(6) | 0]); return 0; });

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    for (let i = 0; i < 0xa0; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0x40; i += 4) m.write32(CURSOR + i, 0xa5a5a5a5 | 0);
    m.write32(SERVICE + 0x60, VIEW);
    m.write32(SERVICE + 0xd8, 0x100);
    m.write32(VIEW + 0x138, BUCKET_STUB);
    m.write32(BUCKET, c.bucket ?? 0x801abcde);
    m.write32(CURSOR_CELL, CURSOR);
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    set(0xc, c.state ?? 1); set(0x38, 0x0fe20070); set(0x50, 0x100); set(0x54, c.depth ?? 0);
    set(0x58, c.x ?? 0x125); set(0x60, c.w ?? 0xc); set(0x5c, c.t5c ?? 0x33);
    set(0x64, c.t64 ?? 0x1400); set(0x68, c.a68 ?? 1); set(0x6c, c.a6c ?? 3); set(0x70, c.a70 ?? 14); set(0x74, c.a74 ?? 2);
    set(0x78, c.a78 ?? 1); set(0x7c, c.top ?? 0x4e); set(0x80, c.bottom ?? 0xb3); set(0x88, c.t88 ?? 0x1000);
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

test("scroll bar factory and setters match", () => {
    h.compare("factory", seed(), RANGES, original(0x80099684, [], 20000), () => scrollBarFactory(h.rt.mem, host()));
    h.compare("place", seed(), RANGES, original(0x80099430, [OBJ, 0x125, 0xc], 2000), () => scrollBarPlace(h.rt.mem, OBJ, 0x125, 0xc));
    h.compare("run", seed(), RANGES, original(0x8009943c, [OBJ, 0x4e, 0xb3], 2000), () => scrollBarRun(h.rt.mem, OBJ, 0x4e, 0xb3));
    h.compare("list", seed(), RANGES, original(0x80099450, [OBJ, 8, 14], 2000), () => scrollBarList(h.rt.mem, OBJ, 8, 14));
    h.compare("step", seed(), RANGES, original(0x80099464, [OBJ, 3], 2000), () => scrollBarStep(h.rt.mem, OBJ, 3));
});

test("scroll bar tick matches", () => {
    for (const state of [0, 1, 2, 3, 4, -1]) {
        for (const a78 of [0, 1]) {
            for (const a68 of [0, 1]) {
                for (const a70 of [1, 2, 14, 30]) {
                    for (const a74 of [0, 1, 5, 13, 29, 40]) {
                        for (const t64 of [0x800, 0x1400, 0x1f00, -0x100]) {
                            for (const top of [0x4e, 0x20]) {
                                const c = { state, a78, a68, a70, a74, t64, top, bottom: top + 0x65, t88: 0x2a00 + a74 };
                                h.compare(`tick s${state} ${a78}${a68} ${a70} ${a74} ${t64} ${top}`, seed(c), RANGES,
                                    original(0x8009946c, [OBJ, 0x77], 300000), () => scrollBarTick(h.rt.mem, OBJ, 0x77, host()));
                            }
                        }
                    }
                }
            }
        }
    }
});
