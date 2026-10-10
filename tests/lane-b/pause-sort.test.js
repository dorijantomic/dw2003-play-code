// Oracle: engine/dw3/ui/native/pause-sort.ts against the original pro/ststatus
// SORT page bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import { sortCtor, sortDraw, sortFactory, sortRoot, sortTick } from "../../engine/dw3/ui/native/pause-sort.ts";
import { buildEffectiveStats } from "../../engine/dw3/effective-stats.ts";
import { itemRecord } from "../../engine/dw3/item-record.ts";
import { partyPositionToRosterSlot, persistentRosterSlot } from "../../engine/dw3/party-context.ts";

const F_START = 0x0fe20010, F_TICK = 0x0fe20014;
let h;
h = createHarness({
    overlayFile: "pro_ststatus.bin",
    functions: {
        foldStart: { address: F_START, args: [0, 0] },
        foldTick: { address: F_TICK, args: [0], result: () => h.next() & 1 },
    },
    tables: { 0x8009b5d8: F_START, 0x8009b5dc: F_TICK },
});
const CTX = 0x80048d34;
const OBJ = 0x80150000, UI = 0x80154000, SCRATCH = 0x80159000;
const LANG = 0x8005cca8;
const bit = (n) => 1 << n;

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    for (let i = 0; i < 0x100; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0xb0; i += 4) m.write32(UI + i, 0);
    m.write32(LANG, c.lang ?? 2);
    for (let i = 0; i < 3; i++) m.write32(CTX + 0x70 + i * 4, c.map?.[i] ?? i);
    for (let slot = 0; slot < 3; slot++) {
        const rec = 0x8004949c + slot * 0x3dc;
        for (let k = 0; k < 0x2c; k += 2) m.write16(rec + 0x1c + k, (slot * 31 + k * 5) & 0x3ff);
        m.write32(0x80049494 + slot * 0x3dc, slot + 3);
    }
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    set(0xc, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x24, UI); set(0x50, 0x80170000);
    set(0x54, 0x1000); set(0x58, 2); set(0x5c, c.size ?? 3);
    for (let i = 0; i < 3; i++) set(0x60 + i * 4, c.frames?.[i] ?? i);
    set(0x6c, c.t6c ?? 90); set(0x70, c.f70 ?? 0); set(0x74, c.a74 ?? 1); set(0x78, c.t78 ?? 100);
    set(0x7c, c.f7c ?? 1); set(0x80, c.row ?? 0); set(0x84, c.first ?? 0); set(0x88, c.second ?? 1);
    set(0x8c, c.a8c ?? 2); set(0x90, c.t90 ?? 95);
    for (let i = 0; i < 3; i++) set(0x9c + i * 0x10, c.cards?.[i] ?? 0x1000);
    set(0xcc, c.foldT ?? 0x1000); set(0xdc, c.foldB ?? 0x1000); set(0xec, c.foldS ?? 0x800);
    set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38);
    h.CTL.alloc = OBJ;
    h.reset(c.rseed ?? 3);
    for (let i = 0; i < 0xb0; i += 4) m.write32(UI + i, h.widgetAt(8 + i / 4));
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[OBJ, 0x100], [UI, 0xb0], [CTX + 0x70, 12]];
const host = () => {
    const base = h.host();
    const mem = h.rt.mem;
    return {
        ...base, scratch: () => SCRATCH,
        cards: {
            rosterSlot: (r) => partyPositionToRosterSlot(mem, r),
            copyStats: (slot, dest) => buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, dest),
            cardRecord: (slot) => persistentRosterSlot(slot),
            resolveText: (off) => base.languageBank((mem.read32(LANG) | 0) + off),
            widgetSetLine0: (w, src, i) => base.callMethod(w, 0x114, [src, i]),
            widgetSetLineNumber: (w, l, v) => base.callMethod(w, 0x118, [l, v]),
            widgetSetFlagC1: (w, v) => base.callMethod(w, 0x144, [v]),
            widgetMeasure: (w, v) => base.callMethod(w, 0x148, [v]),
        },
    };
};

test("sort factory and constructor match", () => {
    h.compare("factory", seed(), RANGES, () => h.rt.cpu.call(0x8009824c, [0x80170000], 20000),
        () => sortFactory(h.rt.mem, 0x80170000, host()));
    h.compare("ctor", seed(), RANGES, () => h.rt.cpu.call(0x80096590, [OBJ, UI], 100000),
        () => sortCtor(h.rt.mem, OBJ, UI, host()));
});

const pads = [
    {}, { pressed: bit(4) }, { pressed: bit(6) }, { repeat: bit(4) }, { repeat: bit(6) },
    { pressed: bit(0xd) }, { pressed: bit(0xe) }, { pressed: bit(4) | bit(0xd) },
];
const SUBS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xa, 0xf, 0x10, 0x11, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x60];

test("sort tick matches in every sub-state", () => {
    const seen = new Set();
    for (const sub of SUBS) {
        for (const size of [1, 2, 3]) {
            // With one partner the pick loops cannot end; the page never enters them.
            if (size === 1 && (sub === 6 || sub === 7)) continue;
            for (const p of pads) {
                for (const v of [0, 1, 2]) {
                    const c = {
                        sub, size, row: v % size, first: v % size, second: (v + 1) % size, map: v === 2 ? [2, 0, 1] : [0, 1, 2],
                        rseed: 2 + v, pad: { pressed: 0, held: 0, repeat: 0, ...p },
                    };
                    const r = h.compare(`tick sub${sub.toString(16)} n${size} v${v} ${JSON.stringify(p)}`, seed(c), RANGES,
                        () => h.rt.cpu.call(0x8009744c, [OBJ, UI], 800000),
                        () => sortTick(h.rt.mem, OBJ, UI, host()));
                    seen.add(r.snap[0x10 / 4]);
                }
            }
        }
    }
    assert.ok(seen.size >= 14, `reached ${seen.size} next states`);
});

test("sort draw and root match", () => {
    for (const size of [1, 2, 3]) {
        for (const sub of [0, 6, 7, 8, 9]) {
            for (const cards of [[0x1000, 0x1000, 0x1000], [0x400, 0x1000, 0], [0x1000, 0x600, 0x1000]]) {
                for (const f70 of [0, 1]) {
                    for (const [first, second] of [[0, 1], [1, 0], [1, 2], [2, 0], [2, 1], [0, 2]]) {
                        for (const frame of [100, 108, 140]) {
                            const c = { size, sub, cards, f70, first, second, frame, foldT: cards[0], foldB: cards[1], t90: 100, t6c: 100, t78: 100 };
                            h.compare(`draw n${size} sub${sub} ${cards} p${f70} ${first}${second} f${frame}`, seed(c), RANGES,
                                () => h.rt.cpu.call(0x80096988, [OBJ], 300000), () => sortDraw(h.rt.mem, OBJ, host()));
                        }
                    }
                }
            }
        }
    }
    for (const state of [0, 1, 2, 3, 4, 9]) {
        for (const map of [[0, 1, 2], [0, -1, -1], [0, 1, -1]]) {
            h.compare(`root s${state} ${map}`, seed({ state, map, sub: 0x60 }), RANGES,
                () => h.rt.cpu.call(0x800980b0, [OBJ, UI], 900000), () => sortRoot(h.rt.mem, OBJ, UI, host()));
        }
    }
});
