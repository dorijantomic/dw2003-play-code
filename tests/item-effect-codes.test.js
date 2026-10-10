// What a stat or element chip eaten on the pause ITEMS page actually DOES, per the
// original's own effect codes, and the shared seam that carries it back into the
// walker's own numbers.
//
// WHY THIS EXISTS. `docs/research/items/item-store-shared-system-2026-10-03.md` §8c
// and ledger claim field-item-effect-codes-and-readback-2026-10-03.
//
// The original's pause ITEMS applier is F0x8008F584 (pro/ststatus.s file 0xC8D4). It
// reads the chosen item's EFFECT record — `*(0x80041838 + 12*id)`, byte +1 is the
// effect selector and the halfword at +2 its value — and dispatches:
//
//   0x00  nothing at all: "no effect", and the bag keeps its copy
//   0x01  HP += value, refused at full HP, clipped at max HP
//   0x11  TP += value, refused at 99, clipped at 99
//   0x02..0x10  its own table at pro/ststatus.s file 0x17C2C (RAM 0x8009A8DC):
//               index -> record halfword, cap 9999 for max HP / max MP and 999 for
//               the six core stats and the seven element tolerances; the rise is
//               `rand() % value + 1`, clipped at the cap, refused at the cap
//   anything else  no table entry, so "no effect"
//
// Fifteen of those halfwords are numbers the WALKER keeps somewhere else
// (`maxHp`+`bonuses.hp`, `maxMp`+`bonuses.mp`, `stats[k]`+`bonuses[k]`,
// species base+`elemBonuses[element]`), so the page's write-back has to fold each
// group at one seam. This file drives the PORTED applier over the disc's own records
// and pins both halves: the decoded table, and the seam.
//
// The selector census is read out of `web/assets/native/screens/resident.bin` (the
// exe's own bytes) rather than typed in, so a re-extraction that moved a record
// fails here instead of silently changing what a chip does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeMemory } from "../engine/native/memory.ts";
import { itemsApplyEffect, ITEM_BOOST_TABLE } from "../engine/dw3/ui/native/pause-bag.ts";
import { itemRecord } from "../engine/dw3/item-record.ts";
import {
    RECORD_CORE_STATS, RECORD_BOOST_GROUPS, foldRecordCoreIntoBonuses, foldRecordStatsIntoBonuses,
} from "../engine/dw3/party-context.ts";
import { partyPositionToRosterSlot, persistentRosterSlot } from "../engine/dw3/party-context.ts";
import { elementValues, ELEMENT_KEYS } from "../engine/dw3/effective-stats.ts";
import { reconcileHeldCounts } from "../engine/dw3/item-store.ts";
import { evolvedMaxStats } from "../engine/dw3/battle-stats.ts";

const RESIDENT_BASE = 0x80010000;
const resident = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)));
const overlay = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/pro_ststatus.bin", import.meta.url)));
const OVERLAY_BASE = 0x80082cb0;
const CTX = 0x80048d34;
const OBJ = 0x80300000;
const UI = 0x80400000;

/** A member of the walker's party as state.partyStats holds it, seeded so that the
 *  walker's own numbers are EXACTLY what useOn writes into the record (core 50, the
 *  seven element values 50, max HP 1000, max MP 500) - the coherent case partySeed
 *  produces. */
function walkerMember(over = {}) {
    return {
        level: 12, tp: 40, hp: 400, maxHp: 1000, mp: 200, maxMp: 500,
        stats: { str: 50, def: 50, spt: 50, wis: 50, spd: 50, chr: 50 },
        bonuses: {}, elemBonuses: Object.fromEntries(ELEMENT_KEYS.map((k) => [k, 45])),
        ...over,
    };
}

/** Kotemon's own resistances, the species half of an element value. */
const PROFILE = { resistances: { fire: 5, water: 5, ice: 5, wind: 5, thunder: 5, machine: 5, dark: 5 } };
/** The element values partySeed hands the page: species base + elemBonuses. */
const openedElements = (rec) => elementValues(PROFILE, rec.elemBonuses);

/** Read every item's EFFECT record out of the disc: { selector, value } per id. */
function readDiscRecords() {
    const rows = new Map();
    for (let id = 1; id <= 402; id++) {
        const row = RESIDENT_BASE - 0x80010000 + (itemRecord(id) - RESIDENT_BASE);
        const master = itemRecord(id);
        const pointer = new DataView(resident.buffer, resident.byteOffset).getUint32(master - RESIDENT_BASE, true);
        void row;
        if (!pointer) { rows.set(id, { kind: "key", selector: 0, value: 0 }); continue; }
        const off = pointer - RESIDENT_BASE;
        rows.set(id, { kind: "pointer", selector: resident[off + 1], value: resident[off + 2] | (resident[off + 3] << 8) });
    }
    return rows;
}

const disc = readDiscRecords();
/** The disc's own stat-boost table, read as { selector, index, cap }. */
const boostTable = (() => {
    const view = new DataView(overlay.buffer, overlay.byteOffset);
    const out = [];
    for (let off = ITEM_BOOST_TABLE - OVERLAY_BASE; ; off += 6) {
        const selector = view.getInt16(off, true);
        if (selector === -1) break;
        out.push({ selector, index: view.getInt16(off + 2, true), cap: view.getInt16(off + 4, true) });
    }
    return out;
})();

test("the disc's effect-record census: fifteen raisable codes plus the no-effect one", () => {
    const bySelector = new Map();
    for (const [id, r] of disc) {
        if (r.kind === "key") continue;
        if (!bySelector.has(r.selector)) bySelector.set(r.selector, []);
        bySelector.get(r.selector).push(id);
    }
    // The consumable band 43..91 and the boosters 361..394 carry selectors 0..17;
    // every equipment and accessory record carries 0.
    assert.deepEqual(
        [...bySelector.keys()].sort((a, b) => a - b),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
        "the shipped item table uses effect codes 0x00..0x11 and nothing else",
    );
    const idsFor = (s) => bySelector.get(s);
    assert.deepEqual(idsFor(1), [43, 44, 45, 46], "0x01 is the four HP charges");
    assert.deepEqual(idsFor(2), [47], "0x02 is the HP Chip");
    assert.deepEqual(idsFor(3), [48], "0x03 is the MP Chip");
    assert.deepEqual(idsFor(4), [49], "0x04 is the Strength chip");
    assert.deepEqual(idsFor(9), [54], "0x09 is the Charisma Chip");
    assert.deepEqual(idsFor(10), [55], "0x0a is the Fire chip");
    assert.deepEqual(idsFor(16), [61], "0x10 is the Dark chip");
    assert.deepEqual(idsFor(17), [62, 63, 64, 65], "0x11 is the four TP chips");
    // The battle-only disks, plugs, throwables and the booster packs are selector 0,
    // so the field applier refuses them: "no effect", and the copy stays in the bag.
    for (const id of [66, 67, 68, 69, 70, 85, 86, 90, 91, 361, 394]) {
        assert.equal(disc.get(id).selector, 0, `item ${id} is a no-effect code in the field`);
    }
    // The amounts the roll divides by, which is the value halfword at +2.
    assert.deepEqual(idsFor(2).map((id) => disc.get(id).value), [30]);
    assert.deepEqual(idsFor(4).map((id) => disc.get(id).value), [10]);
    assert.deepEqual(idsFor(17).map((id) => disc.get(id).value), [1, 2, 3, 5]);
});

test("the applier's own table: index -> record halfword, cap 9999 / 999", () => {
    assert.deepEqual(boostTable, [
        { selector: 2, index: 3, cap: 9999 },   // stats block +0x1C + 6 = record +0x2A max HP
        { selector: 3, index: 5, cap: 9999 },   // +0x26 = record +0x2E max MP
        { selector: 4, index: 6, cap: 999 },    // +0x28 = record +0x30 STR
        { selector: 5, index: 7, cap: 999 },    // DEF
        { selector: 6, index: 8, cap: 999 },    // SPT
        { selector: 7, index: 9, cap: 999 },    // WIS
        { selector: 8, index: 10, cap: 999 },   // SPD
        { selector: 9, index: 11, cap: 999 },   // CHR
        { selector: 10, index: 12, cap: 999 },  // +0x3C fire
        { selector: 11, index: 13, cap: 999 },
        { selector: 12, index: 14, cap: 999 },
        { selector: 13, index: 15, cap: 999 },
        { selector: 14, index: 16, cap: 999 },
        { selector: 15, index: 17, cap: 999 },
        { selector: 16, index: 18, cap: 999 },  // +0x48 dark
    ]);
    // The walker's copy of the two scalar groups must name the same two codes.
    assert.deepEqual(RECORD_BOOST_GROUPS.map((g) => g.effect), [2, 3]);
    assert.deepEqual(RECORD_BOOST_GROUPS.map((g) => g.cap), [9999, 9999]);
    assert.equal(ELEMENT_KEYS.length, 7);
    assert.equal(RECORD_CORE_STATS.length, 6);
});

/** One applier run: seed a record, use the item, return the record and the bag. */
function useOn(item, { boost = 50, hp = 400, maxHp = 1000, mp = 200, maxMp = 500, tp = 40, rand = 0x4660, held = 3 } = {}) {
    const mem = new NativeMemory();
    mem.load(resident, RESIDENT_BASE);
    mem.load(overlay, OVERLAY_BASE);
    const calls = [];
    const host = {
        languageBank: (id) => id >>> 0,
        rand: () => rand,
        rowFill: () => {},
        playSound: (id) => calls.push(["sound", id >>> 0]),
        callMethod: (target, slot, args) => {
            if (slot === 0x114) calls.push(["line", args[1] | 0]);
            else if (slot === 0x118) calls.push(["amount", args[0] | 0, args[1] | 0]);
        },
    };
    mem.write32(CTX + 0x70, 0); mem.write32(CTX + 0x74, 1); mem.write32(CTX + 0x78, 2);
    for (let id = 0; id <= 402; id++) { mem.write8(CTX + id + 0x7c, 0); mem.write8(CTX + id + 0x20f, 0); }
    mem.write8(CTX + item + 0x7c, held);
    const rec = persistentRosterSlot(0);
    for (let k = 0; k < 0x3dc; k += 2) mem.write16(rec + k, 0);
    // The whole 24-halfword block first, then the three scalars the HP/TP arms
    // read, so a caller can set both independently.
    for (let k = 0; k < 24; k++) mem.write16(rec + 0x1c + k * 2, boost);
    mem.write16(rec + 0x20, hp);
    mem.write16(rec + 0x22, maxHp);
    mem.write16(rec + 0x24, mp);
    mem.write16(rec + 0x26, maxMp);
    mem.write16(rec + 0x1e, tp);
    mem.write32(OBJ + 0x78, item);
    mem.write32(OBJ + 0x3b0, 0);
    mem.write32(UI + 0x88, UI);
    itemsApplyEffect(mem, OBJ, UI, host);
    return {
        calls,
        held: mem.read8(CTX + item + 0x7c),
        maxHp: mem.read16(rec + 0x22),
        maxMp: mem.read16(rec + 0x26),
        tp: mem.read16(rec + 0x1e),
        core: Array.from({ length: 6 }, (_, i) => mem.read16(rec + 0x28 + i * 2)),
        elements: Array.from({ length: 7 }, (_, i) => mem.read16(rec + 0x34 + i * 2)),
        // The original consumes exactly when the effect applied, so the bag count
        // is the honest "did it work" answer; the no-effect path still prints a
        // line, so a printed line is NOT the test.
        spent: mem.read8(CTX + item + 0x7c) < held,
        lines: calls.filter((c) => c[0] === "line").map((c) => c[1]),
    };
}

/** The walker's own read model for one member, before and after the seam. */
function walkerView(member) {
    return {
        maxHp: member.maxHp,
        maxMp: member.maxMp,
        elementValues: elementValues(PROFILE, member.elemBonuses),
        total: elementValues(PROFILE, member.elemBonuses).reduce((a, b) => a + b, 0),
        evolvedHp: evolvedMaxStats({ hp: 900 }, 12, member.bonuses).maxHp,
    };
}

// ── one case per effect code the applier can raise ─────────────────────────────

test("effect code 2 (HP Chip): max HP rises, survives a digivolution, one copy spent", () => {
    const run = useOn(47);
    // rand 0x4660 % 30 = 16, +1 = 17.
    assert.equal(run.spent, true);
    assert.deepEqual(run.calls.find((c) => c[0] === "line"), ["line", 2 + 0x52]);
    assert.deepEqual(run.calls.find((c) => c[0] === "amount"), ["amount", 1, 17]);
    assert.equal(run.maxHp, 1000 + 17);
    assert.equal(run.held, 2, "one copy leaves the bag");

    const rec = walkerMember();
    const before = walkerView(rec);
    foldRecordStatsIntoBonuses(rec, { maxHp: run.maxHp, maxMp: run.maxMp, core: run.core, elements: run.elements },
            { elements: openedElements(rec) });
    const after = walkerView(rec);
    assert.equal(after.maxHp, 1017, "the walker's own max HP moved");
    assert.equal(rec.bonuses.hp, 17, "and the chip is in bonuses.hp, which is what a digivolution adds back");
    assert.equal(after.evolvedHp, before.evolvedHp + 17,
        "a digivolution rebuilds max HP as scaledHp + bonuses.hp, so the chip is not wiped");
    // Without the seam nothing in the walker's own numbers moves - the failure this
    // test exists for.
    const untouched = walkerMember();
    assert.equal(walkerView(untouched).maxHp, 1000);
    assert.equal(untouched.bonuses.hp, undefined);
});

test("effect code 3 (MP Chip): max MP rises the same way", () => {
    const run = useOn(48);
    assert.equal(run.spent, true);
    assert.equal(run.maxMp, 500 + 17);
    const rec = walkerMember();
    foldRecordStatsIntoBonuses(rec, { maxHp: run.maxHp, maxMp: run.maxMp, core: run.core, elements: run.elements },
            { elements: openedElements(rec) });
    assert.equal(rec.maxMp, 517);
    assert.equal(rec.bonuses.mp, 17);
});

test("effect codes 4..9 (the six stat chips): the named core stat rises", () => {
    const ids = [49, 50, 51, 52, 53, 54];
    const keys = RECORD_CORE_STATS;
    for (const [i, id] of ids.entries()) {
        const run = useOn(id);
        assert.equal(run.spent, true, `item ${id} applied`);
        assert.deepEqual(run.calls.find((c) => c[0] === "line"), ["line", (4 + i) + 0x52],
            `item ${id} shows the original's own message id for its selector`);
        // rand 0x4660 % 10 = 6, +1 = 7.
        assert.equal(run.core[i], 57, `item ${id} raised ${keys[i]} only`);
        for (let k = 0; k < 6; k++) if (k !== i) assert.equal(run.core[k], 50, `item ${id} left ${keys[k]} alone`);
        assert.equal(run.held, 2);

        const rec = walkerMember();
        foldRecordStatsIntoBonuses(rec, { maxHp: run.maxHp, maxMp: run.maxMp, core: run.core, elements: run.elements },
            { elements: openedElements(rec) });
        assert.equal(rec.bonuses[keys[i]], 7, `${keys[i]} chip folded into bonuses`);
        for (let k = 0; k < 6; k++) if (k !== i) assert.equal(rec.bonuses[keys[k]], undefined);
    }
});

test("effect codes 10..16 (the seven element chips): the named tolerance rises", () => {
    const ids = [55, 56, 57, 58, 59, 60, 61];
    for (const [i, id] of ids.entries()) {
        const run = useOn(id);
        assert.equal(run.spent, true, `item ${id} applied`);
        assert.deepEqual(run.calls.find((c) => c[0] === "line"), ["line", (10 + i) + 0x52]);
        assert.equal(run.elements[i], 57, `item ${id} raised ${ELEMENT_KEYS[i]} only`);
        for (let k = 0; k < 7; k++) if (k !== i) assert.equal(run.elements[k], 50);
        assert.equal(run.held, 2, "one copy leaves the bag");

        const rec = walkerMember();
        const before = walkerView(rec);
        foldRecordStatsIntoBonuses(rec, { maxHp: run.maxHp, maxMp: run.maxMp, core: run.core, elements: run.elements },
            { elements: openedElements(rec) });
        const after = walkerView(rec);
        assert.equal(rec.elemBonuses[ELEMENT_KEYS[i]], 45 + 7,
            "the chip is added to elemBonuses, which every element value is built from");
        assert.equal(after.elementValues[i], before.elementValues[i] + 7,
            `the ${ELEMENT_KEYS[i]} tolerance the battle divides by actually moved`);
        for (let k = 0; k < 7; k++) if (k !== i) assert.equal(after.elementValues[k], before.elementValues[k]);
        assert.equal(after.total, before.total + 7);
    }
});

test("the cap holds and a capped chip is still spent", () => {
    // The table caps max HP/MP at 9999 and everything else at 999.
    const hp = useOn(47, { maxHp: 9995 });
    assert.equal(hp.maxHp, 9999, "clipped at the table cap, not 9995 + roll");
    assert.equal(hp.calls.some((c) => c[0] === "amount"), true,
        "the applier still reports the rolled amount it clipped to the cap");
    assert.equal(hp.held, 2);
    const chr = useOn(54, { boost: 998 });
    assert.equal(chr.core[5], 999, "a core stat clips at 999");
    assert.equal(chr.held, 2);
    // At the cap the applier refuses: no line, and the copy stays in the bag.
    const atCap = useOn(54, { boost: 999 });
    assert.equal(atCap.spent, false);
    assert.equal(atCap.core[5], 999);
    assert.equal(atCap.held, 3, "a refused chip is not spent");
});

test("a refused item shows the original's own 'no effect' line and is not spent", () => {
    for (const id of [66, 91, 361, 1]) {
        const run = useOn(id);
        assert.equal(run.spent, false, `item ${id} applied nothing`);
        assert.deepEqual(run.lines, [0x6a], `item ${id} shows the original's no-effect line`);
        assert.equal(run.calls.some((c) => c[0] === "amount"), false, "and no amount");
        assert.equal(run.held, 3, `item ${id} keeps its copies`);
    }
    // HP full and TP at 99 are the two refusals the original has branches for.
    const full = useOn(43, { hp: 1000, maxHp: 1000 });
    assert.equal(full.spent, false);
    assert.equal(full.held, 3);
    const capped = useOn(62, { tp: 99 });
    assert.equal(capped.spent, false);
    assert.equal(capped.held, 3);
});

test("a heal clipped by max HP spends the copy and prints no amount", () => {
    const run = useOn(46, { hp: 9000, maxHp: 10000 });
    assert.equal(run.spent, true);
    assert.equal(run.held, 2);
    // The original's clipped arm uses the constant message id 0x52 and skips the
    // f118 amount call entirely, so no "9999 HP healed" figure appears.
    assert.deepEqual(run.calls.filter((c) => c[0] === "line"), [["line", 0x52]]);
    assert.equal(run.calls.some((c) => c[0] === "amount"), false);
});

test("the spent copy goes back through the shared store, so the walker's bag moves", () => {
    const run = useOn(55);
    assert.equal(run.held, 2);
    // What web/status-translated.js readBack does with the page's counts.
    const state = { inventory: [{ id: 55, qty: 3 }], equipment: [] };
    reconcileHeldCounts(state, [{ id: 55, qty: 2 }]);
    assert.deepEqual(state.inventory, [{ id: 55, qty: 2 }], "the bag is down one, through the store");
    void partyPositionToRosterSlot;
});

// ── the regression itself, spelled out ─────────────────────────────────────────

test("the old read-back lost three of the four chip groups", () => {
    // What web/status-translated.js readBack did before this change: copy every
    // written field onto the member, then fold ONLY the six core halfwords, and
    // only after the copy. An HP Chip, an MP Chip and a Fire Chip all raised the
    // record and reached nothing the walker reads - and the HP/MP ones were wiped
    // outright by the next digivolution, which rebuilds the sum from bonuses.
    const oldReadBack = (rec, record) => {
        rec.hp = record.hp; rec.maxHp = record.maxHp; rec.mp = record.mp; rec.maxMp = record.maxMp;
        rec.core = record.core; rec.elements = record.elements;
        foldRecordCoreIntoBonuses(rec, record.core);
    };
    const newReadBack = (rec, record) => {
        foldRecordStatsIntoBonuses(rec, record, { elements: openedElements(rec) });
        rec.hp = record.hp; rec.maxHp = record.maxHp; rec.mp = record.mp; rec.maxMp = record.maxMp;
        rec.core = record.core; rec.elements = record.elements;
    };

    // max HP: both leave the member field at 1017, but only the seam leaves the chip
    // in bonuses.hp, which is the number a digivolution adds back.
    const hp = useOn(47);
    const hpOld = walkerMember(), hpNew = walkerMember();
    const hpRec = { hp: 400, maxHp: hp.maxHp, mp: 200, maxMp: hp.maxMp, core: hp.core, elements: hp.elements };
    oldReadBack(hpOld, hpRec);
    newReadBack(hpNew, hpRec);
    const hpBase = walkerView(walkerMember()).evolvedHp;
    assert.equal(hpOld.maxHp, 1017);
    assert.equal(walkerView(hpOld).evolvedHp, hpBase, "the old read-back: a digivolution wipes the chip");
    assert.equal(hpNew.bonuses.hp, 17);
    assert.equal(walkerView(hpNew).evolvedHp, hpBase + 17, "the seam keeps it across a digivolution");

    // max MP: the same, through bonuses.mp.
    const mp = useOn(48);
    const mpOld = walkerMember(), mpNew = walkerMember();
    const mpRec = { hp: 400, maxHp: mp.maxHp, mp: 200, maxMp: mp.maxMp, core: mp.core, elements: mp.elements };
    oldReadBack(mpOld, mpRec);
    newReadBack(mpNew, mpRec);
    const mpBase = evolvedMaxStats({ hp: 900, mp: 400 }, 12, {}).maxMp;
    assert.equal(evolvedMaxStats({ hp: 900, mp: 400 }, 12, mpOld.bonuses).maxMp, mpBase,
        "the old read-back left bonuses.mp empty, so a digivolution dropped the chip");
    assert.equal(mpNew.bonuses.mp, 17);
    assert.equal(evolvedMaxStats({ hp: 900, mp: 400 }, 12, mpNew.bonuses).maxMp, mpBase + 17);

    // an element chip: the old read-back assigned rec.elements and nothing read it.
    const fire = useOn(55);
    const fireOld = walkerMember(), fireNew = walkerMember();
    const fireRec = { hp: 400, maxHp: fire.maxHp, mp: 200, maxMp: fire.maxMp, core: fire.core, elements: fire.elements };
    oldReadBack(fireOld, fireRec);
    newReadBack(fireNew, fireRec);
    assert.equal(fireOld.elements[0], 57, "the record value was right");
    assert.equal(walkerView(fireOld).total, 350, "and the tolerance the battle divides by was not");
    assert.equal(walkerView(fireNew).total, 357);
    assert.equal(fireNew.elemBonuses.fire, 52);

    // a core chip is unchanged by this fix - the fold that already worked still does.
    const str = useOn(49);
    const strOld = walkerMember(), strNew = walkerMember();
    const strRec = { hp: 400, maxHp: str.maxHp, mp: 200, maxMp: str.maxMp, core: str.core, elements: str.elements };
    oldReadBack(strOld, strRec);
    newReadBack(strNew, strRec);
    assert.equal(strOld.bonuses.str, 7);
    assert.equal(strNew.bonuses.str, 7, "the core group the old seam already folded still folds");
});
