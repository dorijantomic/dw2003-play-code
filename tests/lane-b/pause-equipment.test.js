// Oracle: engine/dw3/ui/native/pause-equipment.ts against the original pro/ststatus
// EQUIPMENT page bodies and the scroll-bar object.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    equipApply, equipCtor, equipDraw, equipFactory, equipItemInfo, equipListRows, equipRoot, equipSlotHeader,
    equipSlotNames, equipTick,
    wieldCompatible,
} from "../../engine/dw3/ui/native/pause-equipment.ts";
import { itemRecord } from "../../engine/dw3/item-record.ts";
import { partyPositionToRosterSlot, persistentRosterSlot } from "../../engine/dw3/party-context.ts";

const F_START = 0x0fe20010, F_TICK = 0x0fe20014;
const AUX_FACTORY = 0x80099684;
let h;
h = createHarness({
    overlayFile: "pro_ststatus.bin",
    functions: {
        foldStart: { address: F_START, args: [0, 0] },
        foldTick: { address: F_TICK, args: [0], result: () => h.next() & 1 },
        auxFactory: { address: AUX_FACTORY, args: [], result: () => AUX },
    },
    tables: { 0x8009b5d8: F_START, 0x8009b5dc: F_TICK },
});
const CTX = 0x80048d34;
const OBJ = 0x80150000, UI = 0x80157000, PARENT = 0x80152800, AUX = 0x80153000;
const LANG = 0x8005cca8;
const LISTS = 0x8009af68;
const bit = (n) => 1 << n;

// Boundary stubs the harness does not carry: the parent's preview method and the aux methods.
const logMethod = (slot, arity) => (c) => {
    const args = [];
    for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
    h.LOG.push(["method", c.reg(4) | 0, slot, ...args]);
    return 0;
};
const STUBS = { 0x148: [0x0fe20050, 2], 0x8c: [0x0fe20060, 2], 0x90: [0x0fe20064, 2], 0x94: [0x0fe20068, 2], 0x98: [0x0fe2006c, 1], 0x38: [0x0fe20070, 2] };
for (const [slot, [addr, arity]] of Object.entries(STUBS)) h.rt.cpu.setStub(addr, logMethod(Number(slot), arity));

const items = { seven: [], eight: [], other: [] };
{
    const m = h.rt.mem;
    for (let id = 1; id < 0x193; id++) {
        const ptr = m.read32(itemRecord(id)) >>> 0;
        if (ptr < 0x80000000 || ptr > 0x80200000) continue;
        const kind = m.read8(ptr + 2);
        (kind === 7 ? items.seven : kind === 8 ? items.eight : items.other).push(id);
    }
}
const all = [...items.seven, ...items.eight, ...items.other];

const seed = (c = {}) => () => {
    const m = h.rt.mem;
    let rnd = ((c.rseed ?? 3) * 2654435761) >>> 0;
    const rand = () => { rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0; return rnd >>> 8; };
    for (let i = 0; i < 0x710; i += 4) m.write32(OBJ + i, 0);
    for (let i = 0; i < 0xa0; i += 4) m.write32(UI + i, 0);
    for (let i = 0; i < 0x160; i += 4) m.write32(PARENT + i, 0);
    m.write32(LANG, c.lang ?? 2);
    for (let i = 0; i < 3; i++) m.write32(CTX + 0x70 + i * 4, i);
    for (let id = 0; id < 403; id++) {
        m.write8(CTX + id + 0x7c, rand() % 100 < (c.density ?? 40) ? (c.bigCount ? 0x80 + (rand() & 0x7f) : 1 + (rand() % 9)) : 0);
        m.write8(CTX + id + 0x20f, rand() % 100 < 20 ? 1 : 0);
    }
    for (let slot = 0; slot < 3; slot++) {
        const card = persistentRosterSlot(slot);
        for (let k = 0; k < 0x3dc; k += 2) m.write16(card + k, rand() & 0xff);
        for (let e = 0; e < 6; e++) {
            m.write16(card + 0x3c0 + e * 2, (rand() & 3) === 0 ? 0 : all[rand() % all.length]);
        }
        if (c.hands) {
        // Give each occupied hand a known count pair so a taken-off item is
        // readable as "worn 1 -> 0, held 2 -> 3".
        for (const [slot, id] of [[0x3c4, c.hands.right], [0x3c6, c.hands.left]]) {
            m.write16(card + slot, id ?? 0);
            if (id) { m.write8(CTX + id + 0x20f, 1); m.write8(CTX + id + 0x7c, 2); }
        }
        if (c.equipItem) {
            m.write8(CTX + c.equipItem + 0x20f, 0); m.write8(CTX + c.equipItem + 0x7c, 3);
        }
        // slots 0 (head) and 1 (body) get filler; 2..5 are the case under test.
        for (let e = 0; e < 2; e++) m.write16(card + 0x3c0 + e * 2, all[rand() % all.length]);
        m.write16(card + 0x3c8, all[rand() % all.length]); m.write16(card + 0x3ca, all[rand() % all.length]);
    } else if (rand() & 1) { m.write16(card + 0x3c4, all[rand() % all.length]); m.write16(card + 0x3c6, 0); }
    }
    m.write32(PARENT + 0x7c, c.member ?? 0);
    m.write32(PARENT + 0x70, 0x55);
    m.write32(PARENT + 0x148, 0x0fe20050);
    const set = (o, v) => m.write32(OBJ + o, v | 0);
    set(0xc, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x24, UI); set(0x50, PARENT);
    set(0x54, 0x1000); set(0x58, 4); set(0x5c, c.slotOf ?? (c.member ?? 0));
    set(0x60, c.slot ?? 0); set(0x64, c.row ?? 0); set(0x68, c.count ?? 0); set(0x6c, c.top ?? 0);
    set(0x70, c.a70 ?? 0); set(0x74, c.t74 ?? 95);
    for (const [k, off] of [0x6d4, 0x6e4, 0x6f4, 0x704].entries()) set(off, c.folds?.[k] ?? 0x1000);
    set(0x6c8, c.f6c8 ?? 1);
    const list = c.list ?? [];
    for (let i = 0; i < list.length; i++) m.write16(OBJ + 0x78 + i * 2, list[i]);
    set(0x28, h.S.methodBase + 0x28); set(0x38, h.S.methodBase + 0x38);
    h.CTL.alloc = c.alloc ?? OBJ;
    h.reset(c.rseed ?? 3);
    for (let i = 0; i < 0xa0; i += 4) m.write32(UI + i, h.widgetAt(8 + i / 4));
    m.write32(UI + 0x1c, h.iconAt(0));
    m.write32(UI + 0x24, h.iconAt(1));
    m.write32(UI + 0x98, c.bar ? AUX : 0);
    for (const slot of [0x8c, 0x90, 0x94, 0x98, 0x38]) m.write32(AUX + slot, STUBS[slot][0]);
    m.write32(AUX + 0xc, 0);
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[OBJ, 0x710], [UI, 0xa0], [PARENT, 0x160], [CTX + 0x7c, 0x400], [LISTS, 0x680],
    ...[0, 1, 2].map((s) => [persistentRosterSlot(s) + 0x3c0, 12]), [AUX, 0x9c]];
const host = () => {
    const base = h.host();
    const mem = h.rt.mem;
    return {
        ...base,
        scrollBarFactory: () => { h.LOG.push(["auxFactory"]); return AUX; },
        cards: {
            rosterSlot: (r) => partyPositionToRosterSlot(mem, r),
            cardRecord: (slot) => persistentRosterSlot(slot),
        },
    };
};
const original = (address, args, budget = 900000) => () => h.rt.cpu.call(address, args, budget);

const LIST_A = [0xffff, all[0], all[1], all[2], all[3], all[4], all[5], all[6], all[7], all[8], all[9]];
const LISTS_SEEDS = [
    { list: LIST_A, count: 11 }, { list: LIST_A.slice(0, 5), count: 5 }, { list: [0xffff, 0, all[3], 0xffff], count: 4 },
    { list: [0xffff], count: 1 }, { list: [...LIST_A, all[10], all[11], all[12]], count: 14 },
];

test("wield check matches", () => {
    for (const item of [-1, 0, ...all.slice(0, 40)]) {
        for (const shift of [0, 1, 2, 3, 5]) {
            for (const slot of [0, 1, 2, 3, 4, 5]) {
                let want, got;
                h.compare(`wield ${item} ${shift} ${slot}`, seed(), [],
                    () => { want = h.rt.cpu.call(0x8009a344, [shift, slot, item], 20000) | 0; },
                    () => { got = wieldCompatible(h.rt.mem, shift, slot, item) | 0; });
                assert.equal(got, want, `wield ${item} ${shift} ${slot}`);
            }
        }
    }
});

test("equipment apply matches", () => {
    for (const member of [0, 1, 2]) {
        for (const slot of [0, 1, 2, 3, 4, 5]) {
            for (const item of [0, -3, ...items.seven.slice(0, 3), ...items.eight.slice(0, 4), ...items.other.slice(0, 5)]) {
                h.compare(`apply m${member} s${slot} i${item}`, seed({ rseed: 5 + member + slot }), RANGES,
                    original(0x8009a3e8, [member, slot, item], 200000),
                    () => equipApply(h.rt.mem, member, slot, item, host()));
            }
        }
    }
});

/** The seeded held/worn counts and hands for a member, before anything runs. */
function baseline(c) {
    seed(c)();
    const m = h.rt.mem;
    const card = persistentRosterSlot(0);
    // Plain numbers: h.compare reuses the same memory, so closures would read
    // the post-run state instead of the seed.
    const held = {}, worn = {};
    for (let id = 0; id < 403; id++) { held[id] = m.read8(CTX + id + 0x7c); worn[id] = m.read8(CTX + id + 0x20f); }
    return {
        held, worn,
        hands: [0, 1, 2, 3, 4, 5].map((e) => m.read16s(card + 0x3c0 + e * 2)),
    };
}

test("the worn-gear arm fires: a two-handed weapon takes the held weapon off", () => {
    // F0x8009A3E8 file 0x17840-0x17890: when the item being equipped is the two-handed
    // kind (its EFFECT record at *(0x80041838 + 12*id) reads 7 at byte +2), the routine
    // takes the RIGHT hand's item back to the bag when the right hand is occupied, and
    // the left hand's when only the left is.
    //
    // The census that used to say this arm "cannot fire" read byte +2 of the MASTER row
    // (0x80041838 + 12*id), whose byte 2 is the third byte of the effect-record POINTER
    // and is only ever 0/4/5/17. The routine dereferences that pointer first
    // (`lw $s2, 0($v0)`, file 0xC924), so it is the EFFECT record's byte 2 that decides,
    // and 23 shipped weapons carry 7 there: ids 176..198.
    assert.deepEqual(items.seven, Array.from({ length: 23 }, (_, i) => 176 + i),
        "the disc's two-handed band is ids 176..198 and nothing else");
    const SWORD = 93, BOW = 104;
    for (const [slot, hands] of [[2, { right: SWORD, left: 0 }], [3, { right: 0, left: BOW }],
        [0, { right: SWORD, left: BOW }]]) {
        for (const weapon of items.seven.slice(0, 3)) {
            const cfg = { rseed: 5 + slot, member: 0, slotOf: 0, slot, hands, equipItem: weapon };
            const base = baseline(cfg);
            h.compare(`worn-gear ${weapon} into slot ${slot}`, seed(cfg), RANGES,
                original(0x8009a3e8, [0, slot, weapon], 200000), () => equipApply(h.rt.mem, 0, slot, weapon, host()));
            const m = h.rt.mem;
            const card = persistentRosterSlot(0);
            const taken = hands.right ? SWORD : hands.left;
            assert.equal(base.worn[taken], 1, `item ${taken} starts worn once`);
            assert.equal(m.read8(CTX + taken + 0x20f), base.worn[taken] - 1,
                `item ${taken} stopped being worn`);
            assert.equal(m.read8(CTX + taken + 0x7c), base.held[taken] + 1,
                `item ${taken} went back into the bag`);
            assert.equal(m.read16s(card + 0x3c4), weapon, "the right hand holds the two-hander");
            assert.equal(m.read16s(card + 0x3c6), weapon, "and so does the left");
            // The original's two-handed arm writes ONLY the two hands (file
            // 0x17980-0x17988) and returns, so a hand slot's own halfword is the
            // hand and any other slot's is left exactly as it was.
            const own = m.read16s(card + 0x3c0 + slot * 2);
            assert.equal(own, slot === 2 || slot === 3 ? weapon : 0,
                `slot ${slot}'s own halfword: a two-hander fills the two hands and, `
                + `into any other slot, empties that slot and fills nothing (the original's quirk)`);
            assert.equal(m.read8(CTX + weapon + 0x20f), base.worn[weapon] + 1, "the two-hander is now worn");
            assert.equal(m.read8(CTX + weapon + 0x7c), base.held[weapon] - 1, "and out of the bag");
        }
    }
});

test("with both hands empty the original takes nothing off, and neither do we", () => {
    // The original's `beq $v0, $zero` at file 0x1784C jumps PAST the removal when both
    // hands read 0, so no phantom item-0 count is touched. The port's `at === 0` guard is
    // the same outcome; reading the .s text alone makes it look like item 0's held and
    // worn bytes are decremented, so this pins the count of both arms.
    for (const slot of [0, 2, 3]) {
        const cfg = { rseed: 9 + slot, member: 0, slotOf: 0, slot, hands: { right: 0, left: 0 } };
        const base = baseline(cfg);
        h.compare(`empty hands slot ${slot}`, seed(cfg), RANGES,
            original(0x8009a3e8, [0, slot, 176], 200000), () => equipApply(h.rt.mem, 0, slot, 176, host()));
        const m = h.rt.mem;
        assert.equal(m.read8(CTX + 0 + 0x7c), base.held[0], "item 0's held byte is untouched");
        assert.equal(m.read8(CTX + 0 + 0x20f), base.worn[0], "item 0's worn byte is untouched");
        assert.equal(m.read16s(persistentRosterSlot(0) + 0x3c4), 176);
        assert.equal(m.read16s(persistentRosterSlot(0) + 0x3c6), 176);
    }
});

test("equipment factory and constructor match", () => {
    for (const member of [0, 1, 2]) {
        h.compare(`factory ${member}`, seed({ member }), RANGES, original(0x800882c8, [PARENT]),
            () => equipFactory(h.rt.mem, PARENT, host()));
    }
    h.compare("ctor", seed(), RANGES, original(0x80086498, [OBJ, UI], 200000),
        () => equipCtor(h.rt.mem, OBJ, UI, host()));
});

test("equipment fills match", () => {
    for (const show of [0, 1]) {
        for (const member of [0, 1, 2]) {
            for (const slot of [0, 1, 2, 3, 4, 5]) {
                for (const ls of LISTS_SEEDS) {
                    for (const [row, top] of [[0, 0], [2, 0], [3, 3], [7, 2]]) {
                        for (const bigCount of [false, true]) {
                            const c = { member, slotOf: member, slot, row, top, ...ls, bigCount, rseed: 4 + slot + member };
                            h.compare(`names ${show}${member}${slot}`, seed(c), RANGES, original(0x80086680, [OBJ, UI, show]),
                                () => equipSlotNames(h.rt.mem, OBJ, UI, show, host()));
                            h.compare(`header ${show}${member}${slot}`, seed(c), RANGES, original(0x80086c78, [OBJ, UI, show]),
                                () => equipSlotHeader(h.rt.mem, OBJ, UI, show, host()));
                            h.compare(`rows ${show}${member}${slot} ${row}${top}`, seed(c), RANGES,
                                original(0x80086900, [OBJ, UI, show]), () => equipListRows(h.rt.mem, OBJ, UI, show, host()));
                        }
                    }
                }
            }
        }
    }
    for (const item of [-1, 0, 1, 5, ...all.slice(0, 12), -7]) {
        for (const slot of [0, 1, 2, 3, 4, 5]) {
            h.compare(`info ${item} ${slot}`, seed({ slot }), RANGES, original(0x800867b8, [OBJ, UI, item]),
                () => equipItemInfo(h.rt.mem, OBJ, UI, item, host()));
        }
    }
});

const pads = [
    {}, { pressed: bit(4) }, { pressed: bit(6) }, { repeat: bit(4) }, { repeat: bit(6) },
    { pressed: bit(0xd) }, { pressed: bit(0xe) }, { pressed: bit(4) | bit(0xd) },
    { pressed: bit(0xa) }, { pressed: bit(0xb) }, { repeat: bit(0xa) }, { repeat: bit(0xb) },
    { held: bit(0xb), pressed: bit(0xa) }, { held: bit(0xa), pressed: bit(0xb) }, { held: bit(0xb), repeat: bit(0xa) },
];

test("equipment tick matches in every sub-state", () => {
    const seen = new Set();
    const subs = [0, 1, 2, 3, 4, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x14, 0x15, 0x16, 0x32, 0x33, 0x34, 0x60];
    for (const sub of subs) {
        for (const p of pads) {
            for (const v of [0, 1, 2]) {
                for (const ls of LISTS_SEEDS) {
                    for (const bar of [false, true]) {
                        const c = {
                            sub, ...ls, bar, member: v, slotOf: v, slot: (v * 2 + sub) % 6, row: v * 3 % Math.max(1, Math.min(8, ls.count)),
                            top: v === 2 ? Math.max(0, ls.count - 8) : v, rseed: 2 + v, pad: { pressed: 0, held: 0, repeat: 0, ...p },
                        };
                        const r = h.compare(`tick sub${sub.toString(16)} v${v} n${ls.count} b${bar} ${JSON.stringify(p)}`, seed(c),
                            RANGES, original(0x8008744c, [OBJ, UI], 1500000), () => equipTick(h.rt.mem, OBJ, UI, host()));
                        seen.add(r.snap[0x10 / 4]);
                    }
                }
            }
        }
    }
    assert.ok(seen.size >= 12, `reached ${seen.size} next states`);
});

test("equipment draw and root match", () => {
    const foldSets = [
        Array(4).fill(0x1000), Array(4).fill(0), Array(4).fill(0x400), [0x1000, 0x300, 0, 0x1000], [0x200, 0x1000, 0x1000, 0x600],
    ];
    for (const folds of foldSets) {
        for (const ls of LISTS_SEEDS) {
            for (const frame of [100, 108, 140]) {
                for (const f6c8 of [0, 1]) {
                    for (const [row, top] of [[0, 0], [3, 2]]) {
                        const c = { folds, ...ls, frame, f6c8, row, top, slot: row % 6, t74: 100 };
                        h.compare(`draw ${folds} n${ls.count} f${frame} ${f6c8} ${row}${top}`, seed(c), RANGES,
                            original(0x80086dd4, [OBJ], 900000), () => equipDraw(h.rt.mem, OBJ, host()));
                    }
                }
            }
        }
    }
    for (const state of [0, 1, 2, 3, 4, 9, -1]) {
        h.compare(`root s${state}`, seed({ state, sub: 0x60 }), RANGES,
            original(0x80088214, [OBJ, UI], 1200000), () => equipRoot(h.rt.mem, OBJ, UI, host()));
    }
});
