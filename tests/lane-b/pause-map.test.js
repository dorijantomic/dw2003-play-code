// Oracle: engine/dw3/ui/native/pause-map.ts against the original pro/ststatus MAP
// page bodies (factory, root, scroll, tick, zone, draw).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    mapDraw, mapFactory, mapRoot, mapScroll, mapTick, mapZone,
} from "../../engine/dw3/ui/native/pause-map.ts";

const F_VARIANT = 0x0fe20010, F_LEVEL = 0x0fe20014, F_FILL = 0x0fe20018, F_REQ = 0x0fe2001c,
    F_PEND = 0x0fe20020, F_LIST = 0x0fe20024;
const V = { variant: 0, level: 0, pending: 0 };
const LIST = 0x80159800;
const h = createHarness({
    overlayFile: "pro_ststatus.bin",
    functions: {
        menuVariant: { address: F_VARIANT, args: [], result: () => V.variant },
        mapLevel: { address: F_LEVEL, args: [], result: () => V.level },
        mapFill: { address: F_FILL, args: [0] },
        requestBank: { address: F_REQ, args: [0] },
        bankPending: { address: F_PEND, args: [0, 0], result: () => V.pending },
        markerList: { address: F_LIST, args: [0, 0], result: () => LIST },
    },
    tables: {
        0x8009b6ec: F_VARIANT, 0x8009b6f0: F_LEVEL, 0x8009b6f4: F_FILL,
        0x80044f44: F_REQ, 0x80044f3c: F_PEND, 0x8009b5e8: F_LIST,
    },
});
const OBJ = 0x80150000, UI = 0x80154000;
const LANG = 0x8005cca8;
const bit = (n) => 1 << n;

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    for (let i = 0; i < 0x1a0; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0x10; i += 4) m.write32(UI + i, 0);
    m.write32(LANG, c.lang ?? 2);
    m.write32(0x8004b370, c.progress ?? 0);
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    set(0xc, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x50, 0x80170000);
    set(0x54, 0x1000); set(0x58, 5); set(0x5c, 0xf0); set(0x60, 0x10);
    set(0x78, c.variant ?? 0); set(0x7c, c.t7c ?? 0);
    set(0x80, 0x07990000); set(0x84, 0x07990001); set(0x88, 0x07990002); set(0x8c, 10);
    set(0x90, c.p90 ?? -0x20); set(0x94, c.p94 ?? -0x30); set(0x98, c.s98 ?? 0x40); set(0x9c, c.s9c ?? 0x30);
    set(0xa0, c.a0 ?? 0);
    for (let z = 0; z < 47; z++) set(0xa8 + z * 4, (c.zones ?? ((i) => (i % 3 !== 1 ? 1 : 0)))(z));
    set(0x164, c.c164 ?? 0x60); set(0x168, c.c168 ?? 0x50); set(0x16c, c.c16c ?? 1);
    set(0x170, c.f170 ?? 1); set(0x174, c.f174 ?? 100);
    set(0x178, c.v178 ?? 1); set(0x17c, c.v17c ?? 1);
    set(0x180, c.z180 ?? 0); set(0x184, c.z184 ?? 3); set(0x188, c.c188 ?? 0x70); set(0x18c, c.c18c
        ?? 0x30);
    set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38);
    for (let i = 0; i < 16; i++) m.write32(LIST + i * 4, i < (c.list ?? 4) ? [1, 5, 9, 12, 3, 20, 33][i % 7] : 0);
    h.reset(c.rseed ?? 3);
    m.write32(UI, h.widgetAt(8));
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
    V.variant = c.variant ?? 0; V.level = c.level ?? 0; V.pending = c.pending ?? 0;
};
const RANGES = [[OBJ, 0x1a0], [UI, 0x10]];
const host = () => ({
    ...h.host(),
    menuVariant() { h.LOG.push(["menuVariant"]); return V.variant; },
    mapLevel() { h.LOG.push(["mapLevel"]); return V.level; },
    mapFillZones(d) { h.LOG.push(["mapFill", d | 0]); },
    requestBank(id) { h.LOG.push(["requestBank", id | 0]); },
    bankPending(id, a) { h.LOG.push(["bankPending", id | 0, a | 0]); return V.pending; },
    markerList(a, b) { h.LOG.push(["markerList", a | 0, b | 0]); return LIST; },
});

test("map factory matches for both variants", () => {
    for (const variant of [0, 1]) {
        for (const lang of [0, 2, 5]) {
            h.compare(`factory v${variant} l${lang}`, seed({ variant, lang }), RANGES,
                () => h.rt.cpu.call(0x80099324, [0x80170000], 20000),
                () => mapFactory(h.rt.mem, 0x80170000, host()));
        }
    }
});

test("map scroll matches across the three bands and both directions", () => {
    const xs = [0x10, 0x16, 0x17, 0x40, 0x9f, 0xa0, 0xa1, 0xa2, 0xc0, 0x129, 0x12a, 0x12b];
    const ys = [0x0e, 0x0f, 0x10, 0x30, 0x77, 0x78, 0x79, 0x7a, 0x80, 0xc0, 0xd0, 0xe0];
    for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
            for (const speed of [1, 2, 4]) {
                for (const p of [[-0x20, -0x30], [0, 0], [-0x47, -0x5f], [-0x48, -0x60], [-0x30, -0x10]]) {
                    for (const c164 of xs) {
                        for (const c168 of ys) {
                            h.compare(`scroll ${dx},${dy} s${speed} p${p} ${c164},${c168}`,
                                seed({ v178: speed, v17c: speed, p90: p[0], p94: p[1], c164, c168 }), RANGES,
                                () => h.rt.cpu.call(0x80098450, [OBJ, dx, dy], 20000),
                                () => mapScroll(h.rt.mem, OBJ, dx, dy));
                        }
                    }
                }
            }
        }
    }
});

const pads = [];
for (const held of [0, bit(7), bit(5), bit(4), bit(6), bit(7) | bit(4), bit(5) | bit(6)]) {
    for (const pressed of [0, held, bit(0xe), held | bit(0xe)]) {
        for (const repeat of [0, held]) pads.push({ pressed, held, repeat });
    }
}

test("map tick matches for every direction, speed step and close", () => {
    for (const p of pads) {
        for (const v of [0, 1, 3, 4, 5]) {
            h.compare(`tick ${JSON.stringify(p)} v${v}`, seed({ pad: p, v178: v, v17c: v }), RANGES,
                () => h.rt.cpu.call(0x800986c0, [OBJ], 200000), () => mapTick(h.rt.mem, OBJ, host()));
        }
    }
});

test("map zone matches on hits, misses, entry and exit", () => {
    const spots = [];
    for (let x = 0; x < 0x130; x += 0x1b) for (let y = 0; y < 0xe0; y += 0x17) spots.push([x, y]);
    for (const z180 of [0, 1]) {
        for (const [c164, c168] of spots) {
            h.compare(`zone z${z180} ${c164},${c168}`, seed({ z180, c164, c168, c18c: c168 }), RANGES,
                () => h.rt.cpu.call(0x80098294, [OBJ, UI], 200000), () => mapZone(h.rt.mem, OBJ, UI, host()));
        }
    }
    // A cursor sitting exactly on each zone hits it.
    const zones = h.rt.mem.read32(0x8009af70) | 0;
    for (let z = 1; z < 47; z++) {
        const x = h.rt.mem.read32(zones + 0xc + (z - 1) * 0xc + 4) | 0;
        const y = h.rt.mem.read32(zones + 0xc + (z - 1) * 0xc + 8) | 0;
        for (const z180 of [0, 1]) {
            h.compare(`zone-on ${z} z${z180}`, seed({ z180, c164: x + 0x20 + 0x0a - 0x20, c168: y + 0x30 + 0x0a - 0x30, p90: 0, p94: 0, zones: () => 1 }),
                RANGES, () => h.rt.cpu.call(0x80098294, [OBJ, UI], 200000),
                () => mapZone(h.rt.mem, OBJ, UI, host()));
        }
    }
});

test("map draw matches with and without a zone, at every progress tier", () => {
    for (const z180 of [0, 1]) {
        for (const c16c of [0, 1]) {
            for (const frame of [100, 103, 104, 130]) {
                for (const progress of [0, 6, 7, 14, 15, 26, 27, 29, 30, 60]) {
                    for (const c18c of [0x30, 0x78, 0x90]) {
                        for (const c164 of [0x40, 0x100]) {
                            h.compare(`draw z${z180} v${c16c} f${frame} p${progress} ${c18c} ${c164}`,
                                seed({ z180, c16c, frame, progress, c18c, c164, f170: 3, a0: 2 }), RANGES,
                                () => h.rt.cpu.call(0x80098b84, [OBJ], 400000), () => mapDraw(h.rt.mem, OBJ, host()));
                        }
                    }
                }
            }
        }
    }
});

test("map root matches in every state and load step", () => {
    for (const state of [0, 1, 2, 3, 4]) {
        for (const sub of [0, 1, 2]) {
            for (const level of [0, 1]) {
                for (const pending of [0, 1]) {
                    for (const p of [{}, { held: bit(7), pressed: bit(7) }, { pressed: bit(0xe) }]) {
                        h.compare(`root s${state} sub${sub} l${level} p${pending} ${JSON.stringify(p)}`,
                            seed({ state, sub, level, pending, pad: { pressed: 0, held: 0, repeat: 0, ...p }, c164: 0x30, c168: 0x20,
                                c16c: 0, p90: 0, p94: 0 }),
                            RANGES, () => h.rt.cpu.call(0x8009913c, [OBJ, UI], 4000000),
                            () => mapRoot(h.rt.mem, OBJ, UI, host()));
                    }
                }
            }
        }
    }
    assert.ok(true);
});
