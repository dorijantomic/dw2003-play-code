// Oracle: engine/dw3/ui/native/wizard-misc.ts against the original pro/stplnmet
// helpers (centre_on_rect, the linear tween) and the resident ScaleMatrix.
import { test } from "node:test";
import { createHarness } from "./helpers/screen-harness.js";
import {
    centreOnRect, scaleMatrix, tweenLinearStart, tweenLinearTick,
} from "../../engine/dw3/ui/native/wizard-misc.ts";

const h = createHarness({ overlayFile: "pro_stplnmet.bin" });
const OBJ = 0x80150000;
const RECT = 0x80151000;
const M = 0x80152000;
const V = 0x80153000;
const W = h.widgetAt(3);

test("centreOnRect matches F0x80082F58", () => {
    const sizes = [0, 1, 2, 3, 0x7fff, 0x8000, 0xffff, 100, 101, 0x140, 0xf1];
    for (const w of sizes) {
        for (const ht of [0, 5, 0xf0, 0x8001, 0xffff]) {
            const seed = () => {
                h.rt.mem.write16(RECT + 4, w);
                h.rt.mem.write16(RECT + 6, ht);
                h.widgetAt(3);
            };
            h.compare(`centre ${w},${ht}`, seed, [[W, 0x180]],
                () => h.rt.cpu.call(0x80082f58, [0, 0, W, RECT], 20000),
                () => centreOnRect(h.rt.mem, W, RECT, (t, s, a) => h.host().callMethod(t, s, a)));
        }
    }
});

test("tweenLinearStart and tweenLinearTick match F0x80088538 / F0x80088578", () => {
    const seed = (c = {}) => () => {
        for (let i = 0; i < 0x20; i += 4) h.rt.mem.write32(OBJ + i, c.fill ?? 0x1234);
        for (const [k, v] of Object.entries(c.set ?? {})) h.rt.mem.write32(OBJ + Number(k), v);
    };
    for (const from of [0, 1, 5, 100, -3, 0x7fff]) {
        for (const to of [0, 7, 100, 255, -20, 0x1000]) {
            for (const frames of [1, 3, 10, 30, 0x100]) {
                h.compare(`start ${from}->${to}/${frames}`, seed(), [[OBJ, 0x20]],
                    () => h.rt.cpu.call(0x80088538, [OBJ, from, to, frames], 20000),
                    () => tweenLinearStart(h.rt.mem, OBJ, from, to, frames));
            }
        }
    }
    // Run whole tweens to their end, comparing every frame.
    for (const [from, to, frames] of [[0, 100, 7], [100, 0, 9], [5, 6, 30], [0, 255, 30], [50, -50, 13]]) {
        seed()();
        h.rt.cpu.call(0x80088538, [OBJ, from, to, frames], 20000);
        const startState = Array.from({ length: 8 }, (_, i) => h.rt.mem.read32(OBJ + i * 4));
        for (let f = 0; f < frames + 3; f++) {
            const state = Array.from({ length: 8 }, (_, i) => h.rt.mem.read32(OBJ + i * 4));
            const now = () => () => state.forEach((v, i) => h.rt.mem.write32(OBJ + i * 4, v));
            const res = { o: 0, p: 0 };
            h.compare(`tick ${from}->${to} frame ${f}`, now(), [[OBJ, 0x20]],
                () => { res.o = h.rt.cpu.call(0x80088578, [OBJ], 20000); },
                () => { res.p = tweenLinearTick(h.rt.mem, OBJ); });
            if ((res.o | 0) !== (res.p | 0)) throw new Error(`tick return differs at ${from}->${to} frame ${f}: ${res.o} vs ${res.p}`);
            h.rt.cpu.call(0x80088578, [OBJ], 20000);
        }
        void startState;
    }
    // A finished or never-started tween returns 1 and changes nothing.
    h.compare("tick idle", seed({ set: { 0x18: 0 } }), [[OBJ, 0x20]],
        () => h.rt.cpu.call(0x80088578, [OBJ], 20000), () => tweenLinearTick(h.rt.mem, OBJ));
});

test("scaleMatrix matches the resident F0x8002B23C", () => {
    const cases = [
        [0x1000, 0x1000, 0x1000], [0x800, 0x1000, 0x2000], [0x29, 0x1000, 0x1000],
        [0xff4, 0x1000, 0x1000], [-0x1000, 0x1000, -0x800], [0, 0, 0],
    ];
    const mats = [
        [0x10000000 | 0x1000, 0, 0x1000 << 16, 0, 0x1000],
        [0x1234abcd, 0x87654321, 0xfedcba98, 0x0f0f0f0f, 0x7fff],
        [0x80008000, 0x7fff7fff, 0xffffffff, 0x00010001, 0x8000],
    ];
    for (const scale of cases) {
        for (const mat of mats) {
            const seed = () => {
                mat.forEach((v, i) => h.rt.mem.write32(M + i * 4, v));
                scale.forEach((v, i) => h.rt.mem.write32(V + i * 4, v));
            };
            h.compare(`scale ${scale}`, seed, [[M, 0x14]],
                () => h.rt.cpu.call(0x8002b23c, [M, V], 20000),
                () => scaleMatrix(h.rt.mem, M, V));
        }
    }
});
