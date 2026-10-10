// Oracle: engine/dw3/ui/native/pause-digivolve.ts against the original pro/ststatus
// DIGIVOLVE page bodies and the tween pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    digivolveChoice, digivolveCtor, digivolveDraw, digivolveFactory, digivolveForms, digivolveRoot, digivolveSlide,
    digivolveStats, digivolveTechInfo, digivolveTick, tweenStart, tweenTick,
} from "../../engine/dw3/ui/native/pause-digivolve.ts";
import { buildEffectiveStats } from "../../engine/dw3/effective-stats.ts";
import { itemRecord } from "../../engine/dw3/item-record.ts";
import { persistentRosterSlot } from "../../engine/dw3/party-context.ts";

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
const OBJ = 0x80150000, UI = 0x80154000, SCRATCH = 0x80159000, PARENT = 0x80152800;
const LANG = 0x8005cca8;
const PROFILES = 0x8003ef5c;
const TECHS = 0x80042bdc;
const bit = (n) => 1 << n;

const profileIds = [];
for (let i = 0; i < 0x34; i++) profileIds.push(h.rt.mem.read16(PROFILES + i * 0x58));
const allForms = profileIds.filter((id) => id >= 4);
// Only forms with a ledger entry ever reach the entry copy in the real game.
const forms = allForms.slice(0, 8);

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    let rnd = ((c.rseed ?? 3) * 2654435761) >>> 0;
    const rand = () => { rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0; return rnd >>> 8; };
    for (let i = 0; i < 0x100; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0x94; i += 4) m.write32(UI + i, 0);
    for (let i = 0; i < 0x90; i += 4) m.write32(PARENT + i, 0);
    m.write32(LANG, c.lang ?? 2);
    for (let i = 0; i < 3; i++) m.write32(CTX + 0x70 + i * 4, c.map?.[i] ?? i);
    for (let slot = 0; slot < 3; slot++) {
        const card = persistentRosterSlot(slot);
        for (let k = 0; k < 0x3dc; k += 2) m.write16(card + k, rand() & 0xff);
        for (let e = 0; e < 6; e++) m.write16(card + 0x3c0 + e * 2, 0);
        m.write32(CTX + slot * 0x3dc + 0x764, (rand() & 1) ? 0 : 0x10000 + slot);
        const pickForm = rand() % 4;
        const own = forms[(rand() + slot) % forms.length];
        m.write32(CTX + slot * 0x3dc + 0x764, pickForm === 0 ? own : pickForm === 1 ? own + 0x10000 : pickForm === 2 ? 0 : 0xffff0000 + own | 0);
        for (let e = 0; e < 0x2c; e++) {
            const base = CTX + slot * 0x3dc + 0x7b8 + e * 0x14;
            m.write16(base, e < 8 ? forms[(e * 3 + slot) % forms.length] : 0);
            for (let k = 2; k < 0x14; k += 2) m.write16(base + k, rand() & 0xffff);
            for (let k = 8; k < 0x14; k += 2) {
                if (rand() % 3 === 0) m.write16(base + k, 0);
                else m.write16(base + k, (rand() % 60 + 1) | ((rand() & 3) << 14));
            }
        }
        for (let e = 0; e < 3; e++) m.write16(CTX + slot * 0x3dc + 0x7b0 + e * 2, forms[(rand() + e) % forms.length]);
    }
    for (let i = 0; i < 0x40; i++) {
        const rec = TECHS + i * 0x12;
        m.write16(rec, rand() & 0xffff);
        m.write8(rec + 4, rand() & 0xff);
    }
    for (let slot = 0; slot < 3; slot++) {
        for (let i = 0; i < 8; i++) m.write16(PROFILES + slot * 0x58 + 0x1c + i * 2, rand() % 3 === 0 ? 0 : (rand() % 60) + 1);
        m.write16(PROFILES + slot * 0x58 + 0x28, rand() % 4 === 0 ? 0 : (rand() % 60) + 1);
    }
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    m.write32(PARENT + 0x7c, c.member ?? 0);
    set(0xc, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x24, UI); set(0x50, PARENT);
    set(0x54, 0x1000); set(0x58, 6); set(0x5c, c.row ?? 0); set(0x60, c.choice ?? 0); set(0x64, c.tech ?? 0);
    set(0x68, c.count ?? 0); set(0x6c, c.f6c ?? 0); set(0x70, c.member ?? 0); set(0x7c, c.forms ?? 3); set(0x80, c.f80 ?? 0);
    for (let i = 0; i < 3; i++) m.write16(OBJ + 0x74 + i * 2, c.ids?.[i] ?? (i === 1 && c.hole ? 0 : forms[(i + (c.rseed ?? 3)) % forms.length]));
    set(0x84, 4); set(0x8c, c.slide ?? -0x22); set(0x90, (c.slide ?? -0x22) << 8); set(0x94, 0); set(0x98, c.step ?? -0x800); set(0x9c, c.active ?? 1);
    set(0xa0, c.a0 ?? 0); set(0xa4, c.a4 ?? 1); set(0xa8, c.a8 ?? 95);
    for (const [k, off] of [0xb4, 0xc4, 0xd4, 0xe4, 0xf4].entries()) set(off, c.folds?.[k] ?? 0x1000);
    set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38);
    h.CTL.alloc = c.alloc ?? OBJ;
    h.reset(c.rseed ?? 3);
    for (let i = 0; i < 0x90; i += 4) m.write32(UI + i, h.widgetAt(8 + i / 4));
    for (const off of [0xc, 0x20, 0x24]) m.write32(UI + off, h.iconAt(off / 4));
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[OBJ, 0x100], [UI, 0x94], [PARENT, 0x90], [CTX + 0x70, 12], [CTX + 0x764, 4], [CTX + 0x764 + 0x3dc, 4], [CTX + 0x764 + 0x7b8, 4]];
const host = () => {
    const base = h.host();
    const mem = h.rt.mem;
    return {
        ...base, scratch: () => SCRATCH,
        copyStats: (slot, dest) => buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, dest),
    };
};
const original = (address, args, budget = 900000) => () => h.rt.cpu.call(address, args, budget);

test("tween pair matches", () => {
    for (const [from, to, frames] of [[0, -0x22, 4], [-0x22, 0, 4], [3, 3, 4], [0, 100, 7], [50, -50, 3], [0, 1, 1]]) {
        h.compare(`start ${from} ${to} ${frames}`, seed(), RANGES, original(0x80099e5c, [OBJ + 0x84, from, to, frames], 20000),
            () => tweenStart(h.rt.mem, OBJ + 0x84, from, to, frames, host()));
    }
    for (const [slide, step, active] of [[0, -0x800, 1], [-0x22, 0x800, 1], [-0x10, -0x800, 1], [5, 0x1300, 1], [0, 0, 0], [40, 0x2000, 1]]) {
        for (let n = 0; n < 6; n++) {
            let want, got;
            h.compare(`tick ${slide} ${step} ${active} ${n}`, seed({ slide, step, active }), RANGES,
                () => { want = h.rt.cpu.call(0x80099ef0, [OBJ + 0x84], 20000) | 0; },
                () => { got = tweenTick(h.rt.mem, OBJ + 0x84) | 0; });
            assert.equal(got, want, `tick ${slide} ${step} ${active}`);
        }
    }
});

test("digivolve factory and constructor match", () => {
    for (const member of [0, 1, 2]) {
        h.compare(`factory ${member}`, seed({ member }), RANGES, original(0x8008b4cc, [PARENT], 20000),
            () => digivolveFactory(h.rt.mem, PARENT, host()));
    }
    for (const row of [0, 2]) {
        h.compare(`ctor ${row}`, seed({ row, choice: row & 1 }), RANGES, original(0x8008833c, [OBJ, UI], 200000),
            () => digivolveCtor(h.rt.mem, OBJ, UI, host()));
    }
});

test("digivolve fills match", () => {
    for (const show of [0, 1]) {
        for (const member of [0, 1, 2]) {
            for (const row of [0, 1, 2]) {
                for (const f6c of [0, 1]) {
                    for (const hole of [false, true]) {
                        for (const tech of [0, 1, 4, 5]) {
                            const c = { member, row, f6c, hole, tech, rseed: 4 + member + row };
                            const holeSeed = hole;
                            h.compare(`forms ${show}${member}${row}${hole}`, seed({ ...c, hole: holeSeed }), RANGES,
                                original(0x8008865c, [OBJ, UI, show]), () => digivolveForms(h.rt.mem, OBJ, UI, show, host()));
                            c.hole = false;
                            h.compare(`choice ${show}${member}${row}`, seed(c), RANGES, original(0x8008886c, [OBJ, UI, show]),
                                () => digivolveChoice(h.rt.mem, OBJ, UI, show, host()));
                            h.compare(`stats ${show}${member}${row}${f6c}${hole}`, seed(c), RANGES,
                                original(0x80088a44, [OBJ, UI, show]), () => digivolveStats(h.rt.mem, OBJ, UI, show, host()));
                            h.compare(`info ${show}${member}${row}${f6c}${tech}`, seed(c), RANGES,
                                original(0x8008933c, [OBJ, UI, show]), () => digivolveTechInfo(h.rt.mem, OBJ, UI, show, host()));
                        }
                    }
                }
            }
        }
    }
    for (const slide of [-0x22, -5, 0, 7, 0x30]) {
        h.compare(`slide ${slide}`, seed({ slide }), RANGES, original(0x800891a4, [OBJ, UI]),
            () => digivolveSlide(h.rt.mem, OBJ, UI, host()));
    }
});

const pads = [
    {}, { pressed: bit(4) }, { pressed: bit(6) }, { repeat: bit(4) }, { repeat: bit(6) },
    { pressed: bit(5) }, { pressed: bit(7) }, { pressed: bit(0xd) }, { pressed: bit(0xe) },
    { pressed: bit(4) | bit(0xd) }, { pressed: bit(6) | bit(0xe) }, { pressed: bit(7) | bit(0xd) },
];

test("digivolve tick matches in every sub-state", () => {
    const seen = new Set();
    const subs = [0, 1, 2, 3, 4, 5, 0xa, 0xb, 0xc, 0xd, 0x14, 0x15, 0x16, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x28, 0x29,
        0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x32, 0x33, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x60];
    for (const sub of subs) {
        for (const p of pads) {
            for (const v of [0, 1, 2, 3]) {
                const c = {
                    sub, member: v % 3, row: v % 3, choice: v & 1, f6c: v === 1 || v === 3 ? 1 : 0, forms: 1 + (v % 3),
                    tech: v === 3 ? 2 : v, count: v === 0 ? 0 : 3, hole: false, slide: v === 3 ? 0 : -0x22, step: v === 3 ? 0x800 : -0x800,
                    active: v === 1 ? 0 : 1, rseed: 2 + v, pad: { pressed: 0, held: 0, repeat: 0, ...p },
                };
                const r = h.compare(`tick sub${sub.toString(16)} v${v} ${JSON.stringify(p)}`, seed(c), RANGES,
                    original(0x80089bf0, [OBJ, UI], 2000000), () => digivolveTick(h.rt.mem, OBJ, UI, host()));
                seen.add(r.snap[0x10 / 4]);
            }
        }
    }
    assert.ok(seen.size >= 20, `reached ${seen.size} next states`);
});

test("digivolve draw and root match", () => {
    const foldSets = [
        Array(5).fill(0x1000), Array(5).fill(0), Array(5).fill(0x400), [0x1000, 0x300, 0, 0x1000, 0x600], [0x200, 0x1000, 0x1000, 0x800, 0],
    ];
    for (const folds of foldSets) {
        for (const f80 of [0, 1]) {
            for (const f6c of [0, 1]) {
                for (const a0 of [0, 1]) {
                    for (const frame of [100, 108, 140]) {
                        for (const member of [0, 2]) {
                            const c = { folds, f80, f6c, a0, frame, member, row: member, a8: 100 };
                            h.compare(`draw ${folds} ${f80}${f6c}${a0} f${frame} m${member}`, seed(c), RANGES,
                                original(0x800895c8, [OBJ], 900000), () => digivolveDraw(h.rt.mem, OBJ, host()));
                        }
                    }
                }
            }
        }
    }
    for (const state of [0, 1, 2, 3, 4, 9]) {
        for (const member of [0, 1, 2]) {
            h.compare(`root s${state} m${member}`, seed({ state, member, sub: 0x60 }), RANGES,
                original(0x8008b3c8, [OBJ, UI], 1500000), () => digivolveRoot(h.rt.mem, OBJ, UI, host()));
        }
    }
});
