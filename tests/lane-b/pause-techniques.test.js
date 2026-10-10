// Oracle: engine/dw3/ui/native/pause-techniques.ts against the original
// pro/ststatus TECHNIQUES page bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    formEntryCopy, techniquesApplyHeal, techniquesCtor, techniquesDraw, techniquesFactory,
    techniquesHealAmount, techniquesHealList, techniquesMpCostFill, techniquesMpGate,
    techniquesNamesFill, techniquesRoot, techniquesTick,
} from "../../engine/dw3/ui/native/pause-techniques.ts";
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
const OBJ = 0x80150000, UI = 0x80154000, SCRATCH = 0x80159000, DST = 0x8015a000;
const LANG = 0x8005cca8;

let rngState = 1;
const rnd = (n) => { rngState = (Math.imul(rngState, 1103515245) + 12345) >>> 0; return (rngState >>> 8) % n; };

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    rngState = c.seed ?? 5;
    for (let i = 0; i < 0x200; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0xc0; i += 4) m.write32(UI + i, 0);
    m.write32(LANG, c.lang ?? 2);
    for (let i = 0; i < 3; i++) m.write32(CTX + 0x70 + i * 4, c.map?.[i] ?? i);
    for (let slot = 0; slot < 3; slot++) {
        const base = CTX + slot * 0x3dc;
        for (let i = 0; i < 3; i++) m.write16(base + 0x7b0 + i * 2, c.noForms ? 0xffff : 3 + i + slot);
        for (let e = 0; e < 44; e++) {
            const en = base + 0x7b8 + e * 0x14;
            m.write16(en, e < 6 ? 3 + e : 0xffff);
            for (let t = 0; t < 6; t++) m.write16(en + 8 + t * 2, rnd(3) === 0 ? 0xb8 + rnd(6) + (rnd(2) ? 0x2000 : 0) : rnd(0x100));
        }
        const rec = 0x8004949c + slot * 0x3dc;
        m.write16(rec + 0x20, c.hp?.[slot] ?? 30 + rnd(50)); m.write16(rec + 0x22, c.maxHp ?? 100);
        m.write16(rec + 0x24, c.mp?.[slot] ?? rnd(300));
        for (let k = 0; k < 0x2c; k += 2) m.write16(rec + 0x1c + k, rnd(400));
        m.write32(0x80049494 + slot * 0x3dc, slot + 3);
    }
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    const size = c.size ?? 3;
    set(0xc, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x14, c.s14 ?? 0x1f); set(0x24, UI); set(0x50, 0x80170000);
    set(0x54, 0x1000); set(0x58, 6); set(0x5c, size);
    for (let i = 0; i < 3; i++) set(0x60 + i * 4, c.frames?.[i] ?? i);
    set(0x6c, c.t6c ?? 90); set(0x70, c.a70 ?? 2); set(0x74, c.t74 ?? 95);
    set(0x78, c.f78 ?? 1); set(0x7c, c.member ?? 0); set(0x80, c.f80 ?? 0); set(0x84, c.target ?? 0); set(0x88, c.tech ?? 0);
    for (let i = 0; i < 3; i++) {
        set(0x8c + i * 0x54, 3 + i);
        const heals = c.heals ?? [0xb8, 0xb9, 0xba + (i % 2), 0xbc];
        heals.forEach((v, k) => m.write16(OBJ + i * 0x54 + 0xd0 + k * 2, v));
        set(i * 0x54 + 0xdc, c.count ?? heals.length);
    }
    set(0x188, c.f188 ?? 0); set(0x18c, c.a18c ?? 1); set(0x190, c.t190 ?? 100);
    for (let i = 0; i < 3; i++) set(0x19c + i * 0x10, c.foldCards?.[i] ?? 0x1000);
    set(0x1cc, c.foldT ?? 0x1000); set(0x1dc, c.foldB ?? 0x1000); set(0x1ec, c.foldC ?? 0x1000);
    set(0x1e4, 8);
    set(0x28, h.S.methodBase + 0x28); set(0x2c, h.S.methodBase + 0x2c); set(0x38, h.S.methodBase + 0x38);
    h.reset(c.rseed ?? 3);
    for (let i = 0; i < 0xb0; i += 4) m.write32(UI + i, h.widgetAt(8 + i / 4));
    m.write32(UI + 0xb0, h.iconAt(0));
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[OBJ, 0x200], [UI, 0xc0], [0x8004949c, 3 * 0x3dc], [DST, 0x80]];

const host = () => {
    const base = h.host();
    const mem = h.rt.mem;
    return {
        ...base,
        scratch: () => SCRATCH,
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
const bit = (n) => 1 << n;

test("factory, form copy, heal list, gate and amount match", () => {
    h.compare("factory", seed(), RANGES, () => h.rt.cpu.call(0x80096548, [0x80170000], 20000),
        () => techniquesFactory(h.rt.mem, 0x80170000, host()));
    for (const slot of [0, 1, 2]) {
        for (const form of [3, 4, 5, 6, 7, 9, 0]) {
            let o = 0, p = 0;
            h.compare(`formCopy s${slot} f${form}`, seed({ seed: slot + form }), RANGES,
                () => { o = h.rt.cpu.call(0x80017a1c, [slot, form, DST], 20000); },
                () => { p = formEntryCopy(h.rt.mem, slot, form, DST); });
            assert.equal(p | 0, o | 0, "form index");
        }
    }
    for (const sd of [1, 2, 3, 4, 5, 6, 7, 8]) {
        for (const member of [0, 1, 2]) {
            let o = 0, p = 0;
            h.compare(`healList seed${sd} m${member}`, seed({ seed: sd * 3 }), RANGES,
                () => { o = h.rt.cpu.call(0x800937a4, [OBJ, member], 100000); },
                () => { p = techniquesHealList(h.rt.mem, OBJ, member); });
            assert.equal(p | 0, o | 0, "heal count");
        }
    }
    for (const member of [0, 1, 2]) {
        for (const tech of [0, 1, 2, 3]) {
            for (const mp of [0, 5, 16, 300]) {
                let o = 0, p = 0;
                h.compare(`gate m${member} t${tech} mp${mp}`, seed({ member, tech, mp: [mp, mp, mp] }), RANGES,
                    () => { o = h.rt.cpu.call(0x80093930, [OBJ], 20000); },
                    () => { p = techniquesMpGate(h.rt.mem, OBJ); });
                assert.equal(p | 0, o | 0, "gate");
            }
        }
    }
    for (const slot of [0, 1, 2]) {
        for (const tech of [0xb8, 0xb9, 0xba, 0xbb, 0xbc]) {
            let o = 0, p = 0;
            h.compare(`amount s${slot} t${tech}`, seed({ seed: tech }), RANGES,
                () => { o = h.rt.cpu.call(0x800939e8, [slot, tech], 100000); },
                () => { p = techniquesHealAmount(h.rt.mem, slot, tech, SCRATCH); });
            assert.equal(p | 0, o | 0, "amount");
        }
    }
});

test("names, MP cost fills and the constructor match", () => {
    for (const member of [0, 1, 2]) {
        for (const tech of [0, 1, 3]) {
            for (const show of [0, 1]) {
                for (const lang of [0, 2]) {
                    h.compare(`names m${member} s${show} l${lang}`, seed({ member, lang }), RANGES,
                        () => h.rt.cpu.call(0x80094388, [OBJ, UI, show], 100000),
                        () => techniquesNamesFill(h.rt.mem, OBJ, UI, show, host()));
                    h.compare(`mpcost m${member} t${tech} s${show}`, seed({ member, tech, lang }), RANGES,
                        () => h.rt.cpu.call(0x80094558, [OBJ, UI, show], 100000),
                        () => techniquesMpCostFill(h.rt.mem, OBJ, UI, show, host()));
                }
            }
        }
    }
    for (const tech of [0, 2]) {
        h.compare(`ctor t${tech}`, seed({ tech }), RANGES, () => h.rt.cpu.call(0x80093e84, [OBJ, UI], 100000),
            () => techniquesCtor(h.rt.mem, OBJ, UI, host()));
    }
});

test("applyHeal matches for one target and the whole party", () => {
    const seen = new Set();
    for (const tech of [0, 1, 2, 3]) {
        for (const member of [0, 1, 2]) {
            for (const target of [0, 1, 2]) {
                for (const hp of [[10, 90, 100], [100, 100, 100], [99, 40, 100], [1, 1, 1]]) {
                    for (const mp of [0, 400]) {
                        for (const size of [1, 2, 3]) {
                            let o = 0, p = 0;
                            const c = { tech, member, target, hp, mp: [mp, mp, mp], size, seed: tech * 7 + member, heals: [0xb8, 0xb9, 0xba, 0xbb, 0xbc] };
                            const r = h.compare(`apply t${tech} m${member} tg${target} hp${hp} mp${mp} n${size}`, seed(c), RANGES,
                                () => { o = h.rt.cpu.call(0x80093a58, [OBJ, UI, 0x4001c], 400000); },
                                () => { p = techniquesApplyHeal(h.rt.mem, OBJ, UI, 0x4001c, host()); });
                            assert.equal(p | 0, o | 0, "healed");
                            seen.add(`${p}`);
                        }
                    }
                }
            }
        }
    }
    assert.ok(seen.has("0") && seen.has("1"), "both outcomes");
});

const pads = [
    {}, { pressed: bit(4) }, { pressed: bit(6) }, { repeat: bit(4) }, { repeat: bit(6) },
    { pressed: bit(0xd) }, { pressed: bit(0xe) }, { pressed: bit(4) | bit(0xd) },
];
const SUBS = [0, 1, 2, 3, 4, 5, 6, 7, 0xa, 0xb, 0xf, 0x10, 0x11, 0x1e, 0x1f, 0x20, 0x23, 0x24, 0x28, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x60];

test("tick matches in every sub-state", () => {
    const seenSubs = new Set();
    for (const sub of SUBS) {
        for (const size of [1, 2, 3]) {
            for (const p of pads) {
                for (const variant of [0, 1, 2]) {
                    const c = {
                        sub, size, member: variant % size, target: variant % size, tech: variant, count: variant === 2 ? 0 : 4,
                        mp: [variant === 1 ? 2 : 300, 300, 300], s14: variant % 2 ? 0x1f : 0x20, seed: sub + variant, rseed: 2 + variant,
                        pad: { pressed: 0, held: 0, repeat: 0, ...p },
                    };
                    const r = h.compare(`tick sub${sub.toString(16)} n${size} v${variant} ${JSON.stringify(p)}`, seed(c), RANGES,
                        () => h.rt.cpu.call(0x80094fbc, [OBJ, UI], 800000),
                        () => techniquesTick(h.rt.mem, OBJ, UI, host()));
                    seenSubs.add(r.snap[0x10 / 4]);
                }
            }
        }
    }
    assert.ok(seenSubs.size >= 20, `reached ${seenSubs.size} distinct next states`);
});

test("draw and root match", () => {
    for (const size of [1, 2, 3]) {
        for (const f78 of [0, 1]) {
            for (const f80 of [0, 1]) {
                for (const f188 of [0, 1]) {
                    for (const fold of [0x1000, 0x400, 0]) {
                        for (const frame of [100, 111, 140]) {
                            const c = { size, f78, f80, f188, foldCards: [fold, 0x1000, 0], foldT: fold, foldB: fold, foldC: fold, frame, sub: f78 ? 0x1e : 0x1f, t6c: 100, t74: 100, t190: 100 };
                            h.compare(`draw n${size} ${f78}${f80}${f188} fold${fold} fr${frame}`, seed(c), RANGES,
                                () => h.rt.cpu.call(0x800946bc, [OBJ], 300000), () => techniquesDraw(h.rt.mem, OBJ, host()));
                        }
                    }
                }
            }
        }
    }
    for (const state of [0, 1, 2, 3, 4, 9]) {
        for (const map of [[0, 1, 2], [0, -1, -1], [0, 1, -1]]) {
            h.compare(`root s${state} ${map}`, seed({ state, map, sub: 0x60 }), RANGES,
                () => h.rt.cpu.call(0x80096380, [OBJ, UI], 900000), () => techniquesRoot(h.rt.mem, OBJ, UI, host()));
        }
    }
});
