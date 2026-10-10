// Oracle: engine/dw3/ui/native/pause-bag.ts against the original pro/ststatus
// bag and item-panel bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    itemsDescOrSortFill, itemsDescPanelFold, itemsOwnedCountsFill, itemsWindowReady,
    pauseBagArrowsFill, pauseBagCtor, pauseBagCursorTick, pauseBagDraw, pauseBagFactory,
    pauseBagLoadCategory, pauseBagRoot, pauseBagTabGridFill, pauseBagTick,
} from "../../engine/dw3/ui/native/pause-bag.ts";

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
const BAG = 0x80150000, BUI = 0x80153000, PARENT = 0x80154000, PUI = 0x80158000;
const LANG = 0x8005cca8;

const seedAll = (c = {}) => () => {
    const m = h.rt.mem;
    for (let i = 0; i < 0x780; i += 4) m.write32(BAG + i, 0);
    for (let i = 0; i < 0x80; i += 4) m.write32(BUI + i, 0);
    for (let i = 0; i < 0x470; i += 4) m.write32(PARENT + i, 0);
    for (let i = 0; i < 0x100; i += 4) m.write32(PUI + i, 0);
    let s = c.seed ?? 11;
    const nx = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s >>> 8; };
    for (let id = 0; id < 403; id++) {
        m.write8(CTX + id + 0x7c, nx() % 100 < (c.density ?? 25) ? 1 + (nx() % 9) : 0);
        m.write8(CTX + id + 0x20f, nx() % 100 < 10 ? 1 : 0);
    }
    m.write32(LANG, c.lang ?? 2);
    const set = (o, v) => m.write32(BAG + o, v | 0);
    set(0x0c, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x50, PARENT); set(0x54, 0x1000); set(0x58, 3);
    set(0x5c, c.tab ?? 0); set(0x60, c.choice ?? 0); set(0x64, c.f64 ?? 1); set(0x68, c.count ?? 0);
    const items = c.items ?? Array.from({ length: c.count ?? 0 }, (_, i) => 1 + ((i * 7 + 3) % 400));
    items.forEach((it, i) => m.write16(BAG + 0x6c + i * 2, it));
    if (c.count === undefined) set(0x68, items.length);
    set(0x6bc, c.idx ?? 0); set(0x6c0, c.arrow ?? 0); set(0x6c4, c.at ?? 100); set(0x6c8, c.page ?? 0);
    set(0x6cc, c.pages ?? Math.max(1, Math.ceil((c.count ?? items.length) / 16))); set(0x6d0, c.l ?? 0); set(0x6d4, c.r ?? 0);
    set(0x6dc, c.fa ?? 0xa); set(0x6e4, c.foldB ?? 0x1000); set(0x6ec, c.fb ?? 0xa); set(0x6f4, c.foldA ?? 0x1000); set(0x704, c.foldC ?? 0);
    set(0x24, BUI); set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38);
    const pset = (o, v) => m.write32(PARENT + o, v | 0);
    pset(0x24, PUI); pset(0x78, c.pitem ?? 5); pset(0x7c, c.pidx ?? 0); pset(0x38, h.S.methodBase + 0x38);
    pset(0x43c, 0xa); pset(0x448, c.pfold ?? 0x1000);
    h.reset(c.rseed ?? 3);
    for (let i = 0; i < 0x58; i += 4) m.write32(BUI + i, h.widgetAt(20 + i / 4));
    m.write32(BUI + 0x58, h.iconAt(0));
    for (let i = 0; i < 0xd4; i += 4) m.write32(PUI + i, h.widgetAt(60 + i / 4));
    m.write32(PUI + 0x98, h.iconAt(1)); m.write32(PUI + 0xb8, h.iconAt(2));
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[BAG, 0x780], [BUI, 0x60], [PARENT, 0x470], [PUI, 0xd4]];
const host = () => h.host();
const bit = (n) => 1 << n;

test("bag load, factory and small fills match", () => {
    for (const tab of [0, 1, 2, 3, 4, 5, 6, 7]) {
        h.compare(`load tab${tab}`, seedAll({ tab, density: 40 }), RANGES,
            () => h.rt.cpu.call(0x800936ec, [BAG], 200000), () => pauseBagLoadCategory(h.rt.mem, BAG));
    }
    for (const [idx, choice] of [[1, 0], [2, 5], [0, 0]]) {
        h.compare(`factory ${idx},${choice}`, seedAll(), RANGES,
            () => h.rt.cpu.call(0x80093678, [PARENT, idx, choice], 20000),
            () => pauseBagFactory(h.rt.mem, PARENT, idx, choice, h.host()));
    }
    for (const show of [0, 1]) {
        for (const item of [1, 5, 50, 300]) {
            h.compare(`owned show${show} item${item}`, seedAll({ pitem: item }), RANGES,
                () => h.rt.cpu.call(0x8008f0dc, [PARENT, show], 60000),
                () => itemsOwnedCountsFill(h.rt.mem, PARENT, show, h.host()));
            for (const mode of [1, -1, -2, 2, 0, 7]) {
                h.compare(`desc item${item} mode${mode}`, seedAll({ pitem: item }), RANGES,
                    () => h.rt.cpu.call(0x8008f2b4, [PARENT, mode], 60000),
                    () => itemsDescOrSortFill(h.rt.mem, PARENT, mode, h.host()));
            }
        }
        h.compare(`fold open${show}`, seedAll(), RANGES,
            () => h.rt.cpu.call(0x8008f4e8, [PARENT, show], 60000),
            () => itemsDescPanelFold(h.rt.mem, PARENT, show, h.host()));
    }
    for (let k = 0; k < 4; k++) {
        h.compare(`ready ${k}`, seedAll({ rseed: 5 + k }), RANGES,
            () => h.rt.cpu.call(0x8008f55c, [PARENT], 20000), () => itemsWindowReady(h.rt.mem, PARENT, h.host()));
    }
});

test("bag ctor, grid fill and arrows match", () => {
    for (const idx of [0, 1, 5, 17]) {
        h.compare(`ctor idx${idx}`, seedAll({ idx }), RANGES, () => h.rt.cpu.call(0x80091e94, [BAG, BUI], 60000),
            () => pauseBagCtor(h.rt.mem, BAG, BUI, host()));
    }
    for (const count of [0, 1, 5, 16, 17, 40, 70]) {
        for (const page of [0, 1, 2]) {
            for (const show of [0, 1]) {
                const pages = Math.max(1, Math.ceil(count / 16));
                const c = { count, page: Math.min(page, pages - 1), density: 50 };
                h.compare(`grid c${count} p${page} s${show}`, seedAll(c), RANGES,
                    () => h.rt.cpu.call(0x80092094, [BAG, BUI, show], 100000),
                    () => pauseBagTabGridFill(h.rt.mem, BAG, BUI, show, host()));
            }
            const pages = Math.max(1, Math.ceil(count / 16));
            h.compare(`arrows c${count} p${page}`, seedAll({ count, page: Math.min(page, pages - 1), idx: Math.min(count, 3) }), RANGES,
                () => h.rt.cpu.call(0x80092340, [BAG, BUI], 200000),
                () => pauseBagArrowsFill(h.rt.mem, BAG, BUI, host()));
        }
    }
});

const pads = [
    {}, { pressed: bit(4) }, { pressed: bit(6) }, { pressed: bit(7) }, { pressed: bit(5) },
    { repeat: bit(4) }, { repeat: bit(6) }, { repeat: bit(7) }, { repeat: bit(5) },
    { pressed: bit(0xa) }, { pressed: bit(0xb) }, { repeat: bit(0xa) }, { repeat: bit(0xb) },
    { pressed: bit(0xa), held: bit(0xb) }, { pressed: bit(0xb), held: bit(0xa) },
    { pressed: bit(7), held: bit(6) }, { pressed: bit(5), held: bit(4) }, { pressed: bit(0xd) }, { pressed: bit(0xe) },
];

test("bag cursor tick matches across pads, pages and cells", () => {
    for (const count of [3, 16, 33, 60]) {
        for (const page of [0, 1, 2, 3]) {
            const pages = Math.max(1, Math.ceil(count / 16));
            if (page >= pages) continue;
            for (const idx of [page * 16, page * 16 + 1, page * 16 + 2, Math.min(count - 1, page * 16 + 15)]) {
                for (const p of pads) {
                    let o = 0, q = 0;
                    h.compare(`cursor c${count} p${page} i${idx} ${JSON.stringify(p)}`,
                        seedAll({ count, page, idx, pad: { pressed: 0, held: 0, repeat: 0, ...p } }), RANGES,
                        () => { o = h.rt.cpu.call(0x80092524, [BAG, BUI], 300000); },
                        () => { q = pauseBagCursorTick(h.rt.mem, BAG, BUI, host()); });
                    assert.equal(q | 0, o | 0, "return value");
                }
            }
        }
    }
});

test("bag tick matches in every sub-state", () => {
    for (const sub of [0, 1, 2, 3, 4, 5, 9]) {
        for (const tab of [0, 1]) {
            for (const p of pads) {
                for (const pitem of [1, 5, 60, 200]) {
                    for (const rseed of [1, 2]) {
                        h.compare(`tick sub${sub} tab${tab} ${JSON.stringify(p)} item${pitem}`,
                            seedAll({ sub, tab, count: 20, idx: 3, pitem, rseed, density: 60, pad: { pressed: 0, held: 0, repeat: 0, ...p } }), RANGES,
                            () => h.rt.cpu.call(0x80092bc8, [BAG, BUI], 400000),
                            () => pauseBagTick(h.rt.mem, BAG, BUI, host()));
                    }
                }
            }
        }
    }
});

test("bag draw and root match", () => {
    for (const count of [0, 5, 20, 40]) {
        for (const f64 of [0, 1]) {
            for (const frame of [100, 111, 140]) {
                for (const fold of [0x1000, 0x400]) {
                    const pages = Math.max(1, Math.ceil(count / 16));
                    const c = { count, f64, frame, foldA: fold, foldB: fold, foldC: count % 2 ? 0 : fold, l: 1, r: 1, idx: Math.min(count, 2), page: pages - 1, at: 100, density: 70 };
                    h.compare(`draw c${count} f${f64} fr${frame} fold${fold}`, seedAll(c), RANGES,
                        () => h.rt.cpu.call(0x80092fac, [BAG], 300000), () => pauseBagDraw(h.rt.mem, BAG, host()));
                }
            }
        }
    }
    for (const state of [0, 1, 2, 3, 4, 9]) {
        for (const choice of [0, 5, 77, 999]) {
            for (const tab of [0, 2]) {
                for (const pidx of [0, 3, 17]) {
                    h.compare(`root s${state} choice${choice} tab${tab} pidx${pidx}`,
                        seedAll({ state, choice, tab, pidx, sub: 2, pitem: 5, density: 60, count: 0, items: [] }), RANGES,
                        () => h.rt.cpu.call(0x800934e0, [BAG, BUI], 800000),
                        () => pauseBagRoot(h.rt.mem, BAG, BUI, host()));
                }
            }
        }
    }
});

import { itemsApplyEffect } from "../../engine/dw3/ui/native/pause-bag.ts";
import { partyCardFillItems } from "../../engine/dw3/ui/party-card-fill.ts";
import { buildEffectiveStats } from "../../engine/dw3/effective-stats.ts";
import { itemRecord } from "../../engine/dw3/item-record.ts";
import { partyPositionToRosterSlot, persistentRosterSlot } from "../../engine/dw3/party-context.ts";

const SCRATCH = 0x80159000;
const applyHost = () => {
    const base = h.host();
    const mem = h.rt.mem;
    return {
        ...base,
        rowFill(obj, ui, row, show) {
            partyCardFillItems(mem, ui, row, show, SCRATCH, {
                rosterSlot: (r) => partyPositionToRosterSlot(mem, r),
                copyStats: (slot, dest) => buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, dest),
                cardRecord: (slot) => persistentRosterSlot(slot),
                resolveText: (off) => base.languageBank((mem.read32(LANG) | 0) + off),
                widgetSetLine0: (w, src, i) => base.callMethod(w, 0x114, [src, i]),
                widgetSetLineNumber: (w, l, v) => base.callMethod(w, 0x118, [l, v]),
                widgetSetFlagC1: (w, v) => base.callMethod(w, 0x144, [v]),
                widgetMeasure: (w, v) => base.callMethod(w, 0x148, [v]),
            });
        },
    };
};

test("item effects match F0x8008F584 for every effect type", () => {
    const mem = h.rt.mem;
    const byType = new Map();
    for (let id = 1; id < 403; id++) {
        const d = mem.read32(itemRecord(id)) >>> 0;
        if (!d) continue;
        const type = mem.read8(d + 1);
        if (!byType.has(type)) byType.set(type, id);
    }
    assert.ok(byType.size >= 3, `distinct effect types: ${byType.size}`);
    const seenFlags = new Set();
    for (const [type, id] of byType) {
        for (const member of [0, 1, 2]) {
            for (const hp of [[10, 100], [100, 100], [95, 100]]) {
                for (const boost of [0, 900, 998, 60, 98]) {
                    const seed = () => {
                        seedAll({ pitem: id, density: 60, rseed: 4 + type })();
                        for (let i = 0; i < 3; i++) mem.write32(0x80048d34 + 0x70 + i * 4, i);
                        for (let slot = 0; slot < 3; slot++) {
                            const rec = 0x8004949c + slot * 0x3dc;
                            mem.write16(rec + 0x20, hp[0]); mem.write16(rec + 0x22, hp[1]);
                            mem.write16(rec + 0x1e, type === 17 ? 90 + boost % 10 : 50);
                            for (let k = 0; k < 20; k++) mem.write16(rec + 0x1c + k * 2, boost);
                            mem.write32(0x80049494 + slot * 0x3dc, slot + 3);
                        }
                        mem.write8(0x80048d34 + id + 0x7c, 3);
                        h.rt.mem.write32(PARENT + 0x3b0, member);
                    };
                    const r = h.compare(`effect type${type} item${id} m${member} hp${hp} boost${boost}`, seed,
                        [...RANGES, [0x8004949c, 3 * 0x3dc], [0x80048d34 + id + 0x7c - (id % 4), 8]],
                        () => h.rt.cpu.call(0x8008f584, [PARENT, PUI], 800000),
                        () => itemsApplyEffect(h.rt.mem, PARENT, PUI, applyHost()));
                    seenFlags.add(r.log.some((e) => e[0] === "sound" && e[1] === 0x40014) ? "used" : "refused");
                }
            }
        }
    }
    assert.ok(seenFlags.has("used") && seenFlags.has("refused"), "both outcomes reached");
});
