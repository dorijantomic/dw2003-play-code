// Oracle: engine/dw3/ui/native/pause-status.ts against the original pro/ststatus
// STATUS page bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    profileIndex, profileRecord, statusCtor, statusDetailTick, statusDraw, statusEquipFill, statusEquipPreview,
    statusFactory, statusFormsFill, statusHeaderFill, statusPromptFill, statusRoot, statusStatsFill, statusTick,
} from "../../engine/dw3/ui/native/pause-status.ts";
import { buildEffectiveStats } from "../../engine/dw3/effective-stats.ts";
import { itemRecord } from "../../engine/dw3/item-record.ts";
import { validateEquippedForm } from "../../engine/dw3/form-ledger.ts";
import { partyPositionToRosterSlot, persistentRosterSlot } from "../../engine/dw3/party-context.ts";

const F_START = 0x0fe20010, F_TICK = 0x0fe20014;
const DIGI = 0x8008b4cc, EQUIP = 0x800882c8;
let h;
h = createHarness({
    overlayFile: "pro_ststatus.bin",
    functions: {
        foldStart: { address: F_START, args: [0, 0] },
        foldTick: { address: F_TICK, args: [0], result: () => h.next() & 1 },
        digiFactory: { address: DIGI, args: [0], result: () => 0x80177000 },
        equipFactory: { address: EQUIP, args: [0], result: () => 0x80177100 },
    },
    tables: { 0x8009b5d8: F_START, 0x8009b5dc: F_TICK },
});
const CTX = 0x80048d34;
const OBJ = 0x80150000, UI = 0x80154000, SCRATCH = 0x80159000;
const LANG = 0x8005cca8;
const bit = (n) => 1 << n;
const FOLD_VALUES = [0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0x100, 0x110, 0x120, 0x130];

// Real item ids by kind, read from the shipped item table.
const items = { seven: [], eight: [], other: [] };
{
    const m = h.rt.mem;
    for (let id = 1; id < 0x200; id++) {
        const entry = itemRecord(id);
        const ptr = m.read32(entry) >>> 0;
        if (ptr < 0x80000000 || ptr > 0x80200000) continue;
        const kind = m.read8(ptr + 2);
        (kind === 7 ? items.seven : kind === 8 ? items.eight : items.other).push(id);
    }
}
const pick = (list, n) => list.length ? list[n % list.length] : 0;

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    for (let i = 0; i < 0x150; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0x114; i += 4) m.write32(UI + i, 0);
    m.write32(LANG, c.lang ?? 2);
    for (let i = 0; i < 3; i++) m.write32(CTX + 0x70 + i * 4, c.map?.[i] ?? i);
    let rnd = (c.rseed ?? 3) * 2654435761 >>> 0;
    const rand = () => { rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0; return rnd >>> 8; };
    for (let slot = 0; slot < 3; slot++) {
        const card = persistentRosterSlot(slot);
        for (let k = 0; k < 0x3dc; k += 2) m.write16(card + k, (rand() & 0xff) + ((c.big ? rand() & 0x3ff : 0)));
        for (let e = 0; e < 6; e++) {
            const pool = e === 4 ? items.seven : e < 4 ? items.other : items.eight;
            m.write16(card + 0x3c0 + e * 2, e === 0 && c.emptyFirst ? 0 : (rand() & 3) === 0 ? 0 : pick(pool, rand()));
        }
        m.write32(card + 0x18, rand() * 0x100 + rand());
        const pickForm = rand() % 4;
        m.write32(0x80049490 + slot * 0x3dc + 8, pickForm === 0 ? 0x0004 + slot : pickForm === 1 ? 0x10004 + slot : pickForm === 2 ? 0x0100 : 0xffff0000 + 4 + slot | 0);
    }
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    set(0xc, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x14, c.dsub ?? 0); set(0x18, c.f18 ?? 0);
    set(0x24, UI); set(0x50, 0x80170000);
    set(0x54, 0x1000); set(0x58, 6); set(0x5c, c.size ?? 3);
    for (let i = 0; i < 3; i++) set(0x60 + i * 4, c.frames?.[i] ?? i);
    set(0x6c, c.t6c ?? 90); set(0x74, c.a74 ?? 0); set(0x78, c.f78 ?? 0); set(0x7c, c.member ?? 0);
    set(0x80, c.a80 ?? 2); set(0x84, c.t84 ?? 95);
    for (const [k, off] of FOLD_VALUES.entries()) set(off, c.folds?.[k] ?? 0x1000);
    set(0x2c, h.S.methodBase + 0x2c); set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38);
    h.CTL.alloc = OBJ;
    h.reset(c.rseed ?? 3);
    for (let i = 0; i < 0x10c; i += 4) m.write32(UI + i, h.widgetAt(8 + i / 4));
    m.write32(UI + 0x98, h.iconAt(0));
    m.write32(UI + 0x10c, c.child ?? 0);
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[OBJ, 0x150], [UI, 0x114], [CTX + 0x70, 12],
    ...[0, 1, 2].map((s) => [persistentRosterSlot(s) + 0x3c0, 12])];
const host = () => {
    const base = h.host();
    const mem = h.rt.mem;
    return {
        ...base, scratch: () => SCRATCH,
        copyForms: (slot, out) => { validateEquippedForm(mem, slot, out); },
        digivolveFactory: (obj) => { h.LOG.push(["digiFactory", obj | 0]); return 0x80177000; },
        equipFactory: (obj) => { h.LOG.push(["equipFactory", obj | 0]); return 0x80177100; },
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
const original = (address, args, budget = 900000) => () => h.rt.cpu.call(address, args, budget);

test("profile helpers match", () => {
    for (const form of [0, 1, 3, 4, 5, 9, 30, 0x30, 0x51, 0x100, 0x7fff, 0xffff]) {
        for (const [name, addr, port] of [["index", 0x800134ac, profileIndex], ["record", 0x800134e8, profileRecord]]) {
            let got, want;
            h.compare(`${name} ${form}`, seed(), [],
                () => { want = h.rt.cpu.call(addr, [form], 20000) | 0; },
                () => { got = port(h.rt.mem, form) | 0; });
            assert.equal(got, want, `${name} ${form}`);
        }
    }
});

test("status factory and constructor match", () => {
    h.compare("factory", seed(), RANGES, original(0x8008e8f8, [0x80170000], 20000),
        () => statusFactory(h.rt.mem, 0x80170000, host()));
    for (const a74 of [0, 1]) {
        h.compare(`ctor ${a74}`, seed({ a74 }), RANGES, original(0x8008b520, [OBJ, UI], 200000),
            () => statusCtor(h.rt.mem, OBJ, UI, host()));
    }
});

test("status fills match", () => {
    for (const show of [0, 1]) {
        for (const member of [0, 1, 2]) {
            for (const big of [false, true]) {
                const c = { member, big, rseed: 4 + member };
                h.compare(`header m${member} s${show}`, seed(c), RANGES, original(0x8008bb88, [OBJ, UI, member, show]),
                    () => statusHeaderFill(h.rt.mem, UI, member, show, host()));
                h.compare(`prompt s${show}`, seed(c), RANGES, original(0x8008bd70, [OBJ, UI, show]),
                    () => statusPromptFill(h.rt.mem, UI, show, host()));
                h.compare(`forms m${member} s${show}`, seed(c), RANGES, original(0x8008be34, [OBJ, UI, show]),
                    () => statusFormsFill(h.rt.mem, OBJ, UI, show, host()));
                h.compare(`equip m${member} s${show}`, seed(c), RANGES, original(0x8008c02c, [OBJ, UI, show]),
                    () => statusEquipFill(h.rt.mem, OBJ, UI, show, host()));
                h.compare(`stats m${member} s${show}`, seed(c), RANGES, original(0x8008c1c0, [OBJ, UI, show]),
                    () => statusStatsFill(h.rt.mem, OBJ, UI, show, host()));
            }
        }
    }
});

test("status equipment preview matches", () => {
    const seven = pick(items.seven, 1), eight = pick(items.eight, 1), eight2 = pick(items.eight, 2), plain = pick(items.other, 3);
    for (const member of [0, 1, 2]) {
        for (const idx of [-1, 0, 1, 2, 3, 4, 5]) {
            for (const item of [0, plain, seven, eight, eight2, pick(items.other, 9), -5]) {
                for (const big of [false, true]) {
                    const c = { member, big, rseed: 5 + member + idx };
                    h.compare(`preview m${member} i${idx} item${item}`, seed(c), RANGES,
                        original(0x8008c460, [OBJ, idx, item]),
                        () => statusEquipPreview(h.rt.mem, OBJ, idx, item, host()));
                }
            }
        }
    }
});

const pads = [
    {}, { pressed: bit(4) }, { pressed: bit(6) }, { repeat: bit(4) }, { repeat: bit(6) },
    { pressed: bit(0xd) }, { pressed: bit(0xe) }, { pressed: bit(4) | bit(0xd) }, { pressed: bit(6) | bit(0xe) },
];

test("status tick matches in every sub-state", () => {
    const seen = new Set();
    const subs = [0, 1, 2, 3, 4, 5, 6, 7, 0xa, 0xb, 0xf, 0x14, 0x15, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x60];
    for (const sub of subs) {
        for (const size of [1, 2, 3]) {
            for (const p of pads) {
                for (const v of [0, 1, 2]) {
                    for (const a74 of [0, 1]) {
                        const c = {
                            sub, size, member: v % size, a74, dsub: v === 1 ? 1 : 0, child: v === 2 ? 0x80177000 : 0,
                            rseed: 2 + v, pad: { pressed: 0, held: 0, repeat: 0, ...p },
                        };
                        const r = h.compare(`tick sub${sub.toString(16)} n${size} v${v} a${a74} ${JSON.stringify(p)}`, seed(c),
                            RANGES, original(0x8008ddb0, [OBJ, UI], 1500000),
                            () => statusTick(h.rt.mem, OBJ, UI, host()));
                        seen.add(r.snap[0x10 / 4]);
                    }
                }
            }
        }
    }
    assert.ok(seen.size >= 14, `reached ${seen.size} next states`);
});

test("status detail tick matches in every sub-state", () => {
    const seen = new Set();
    for (const dsub of [0, 1, 2, 3, 4, 5, 6, 0xa, 0xb, 0xc, 0xd, 0x40]) {
        for (const f18 of [0, 1]) {
            for (const a74 of [0, 1]) {
                for (const p of pads) {
                    for (const v of [0, 1, 2]) {
                        const folds = v === 0 ? undefined : v === 1 ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] : [0x400, 0x1000, 0x1000, 0, 0x200, 0x1000, 0, 0x1000, 0, 0x1000, 0];
                        const c = { dsub, f18, a74, member: v, folds, rseed: 2 + v, pad: { pressed: 0, held: 0, repeat: 0, ...p } };
                        const r = h.compare(`detail d${dsub.toString(16)} f${f18} a${a74} v${v} ${JSON.stringify(p)}`, seed(c),
                            RANGES, original(0x8008d684, [OBJ, UI], 1500000),
                            () => statusDetailTick(h.rt.mem, OBJ, UI, host()));
                        seen.add(r.snap[0x14 / 4]);
                    }
                }
            }
        }
    }
    assert.ok(seen.size >= 8, `reached ${seen.size} next states`);
});

test("status draw and root match", () => {
    const foldSets = [
        Array(11).fill(0x1000), Array(11).fill(0), Array(11).fill(0x400),
        [0x1000, 0x600, 0, 0x1000, 0x300, 0x1000, 0x1000, 0x1000, 0x500, 0x1000, 0x700],
        [0x200, 0x1000, 0x1000, 0x200, 0x1000, 0x1000, 0x400, 0x600, 0x1000, 0x800, 0x1000],
    ];
    for (const size of [1, 2, 3]) {
        for (const folds of foldSets) {
            for (const f78 of [0, 1]) {
                for (const frame of [100, 108, 140]) {
                    for (const member of [0, size - 1]) {
                        const c = { size, folds, f78, frame, member, t6c: 100, t84: 100 };
                        h.compare(`draw n${size} ${folds} p${f78} f${frame} m${member}`, seed(c), RANGES,
                            original(0x8008c954, [OBJ], 900000), () => statusDraw(h.rt.mem, OBJ, host()));
                    }
                }
            }
        }
    }
    for (const state of [0, 1, 2, 3, 4, 9]) {
        for (const map of [[0, 1, 2], [0, -1, -1], [0, 1, -1]]) {
            h.compare(`root s${state} ${map}`, seed({ state, map, sub: 0x60 }), RANGES,
                original(0x8008e744, [OBJ, UI], 1200000), () => statusRoot(h.rt.mem, OBJ, UI, host()));
        }
    }
});
