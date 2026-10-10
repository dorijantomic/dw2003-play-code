// Lane B oracle: the element and status-resistance halves of the one shared
// form-change read (engine/dw3/battle-form-change.ts formChangeValues, consumed
// by engine/dw3/battle-combat.ts combatantElements / combatantStatusResist /
// effStats) must be the values FIGHTSTG_F0x8009EC94 builds.
//
// The original runs through engine/native (the interpreter) as the oracle:
// `FIGHTSTG_F0x8009EC94` (`pro/fightstg.s:29186`) executes for real over the
// real DIGIMON_PROFILES table at 0x8003EF5C (stride 0x58) in the resident
// image, and through the real species service at [0x8005CCA0] that returns a
// species id's own record. Only three resident services are stubbed, on both
// sides:
//
//   [0x8004B44C]  the roster row a party position owns  -> a fixed row index
//   [0x8004B468]  the effective-profile scratch builder -> the roster row's own
//                  level, stored core stats and seven element values
//   [0x8004B484]  the equipped-items object              -> a zeroed object, so
//                  every equipment loop reads 0 and adds nothing
//
// The two species ids are real table rows, and the port's profile objects are
// the shipped web/assets/data/digimon.json entries that match those rows field
// for field, so both sides read the same numbers out of the same table.
//
// Every field the walker reads from the block is compared: +0x00 level, +0x02..+0x0A
// the five stats, +0x0C..+0x18 fire..dark, +0x1A..+0x22 poison..ko, +0x25 the
// type/family byte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    formChangeValues, FORM_ELEMENT_KEYS, FORM_STATUS_RESIST_KEYS,
} from "../../engine/dw3/battle-form-change.ts";
import {
    effStats, combatantElements, combatantStatusResist,
} from "../../engine/dw3/battle-combat.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const digimonDB = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/digimon.json"), "utf8"),
).digimon;

const EFFECTIVE_STATS = 0x8009ec94;
const BLOCK_ATTACKER = 0x800a4580;
const BLOCK_DEFENDER = 0x800a45c0;
const PARTY_RECORD = 0x800a4470;
const PROFILE_BASE = 0x8003ef5c;
const PROFILE_STRIDE = 0x58;
const SPECIES_CELL = 0x8005cca0;
const ROSTER_ROW_CELL = 0x8004b44c;
const SCRATCH_CELL = 0x8004b468;
const EQUIP_CELL = 0x8004b484;

const ROW_STUB = 0x0fdc0000;
const SCRATCH_STUB = 0x0fdc0010;
const EQUIP_STUB = 0x0fdc0020;
const EQUIP_OBJECT = 0x0fd10000;

const CORE_KEYS = ["str", "def", "spt", "wis", "spd"];

let rosterRow = 0;
let scratch = null;

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(ROW_STUB, () => rosterRow);
    rt.cpu.setStub(SCRATCH_STUB, (c) => {
        const dst = c.reg(5) >>> 0;
        rt.mem.write16(dst, scratch.level & 0xffff);
        for (let i = 0; i < CORE_KEYS.length; i++) {
            rt.mem.write16(dst + 0x0c + i * 2, scratch.core[i] & 0xffff);
        }
        rt.mem.write16(dst + 0x16, 1);
        for (let i = 0; i < FORM_ELEMENT_KEYS.length; i++) {
            rt.mem.write16(dst + 0x18 + i * 2, scratch.elements[i] & 0xffff);
        }
        return 0;
    });
    rt.cpu.setStub(EQUIP_STUB, () => EQUIP_OBJECT);
    rt.mem.write32(ROSTER_ROW_CELL, ROW_STUB);
    rt.mem.write32(SCRATCH_CELL, SCRATCH_STUB);
    rt.mem.write32(EQUIP_CELL, EQUIP_STUB);
    for (let i = 0; i < 0x400; i += 4) rt.mem.write32(EQUIP_OBJECT + i, 0);
    return rt;
}

/** The profile row a species id names, through the original's own species service. */
function speciesRow(rt, speciesId) {
    const fn = rt.mem.read32(SPECIES_CELL) >>> 0;
    assert.ok(fn !== 0, "the resident image carries the species service");
    const row = rt.cpu.call(fn, [speciesId], 200000) >>> 0;
    assert.ok(row >= PROFILE_BASE && row < PROFILE_BASE + 0x58 * 64,
        `species ${speciesId} names a row in the profile table`);
    return row;
}

/**
 * The shipped digimon.json entry whose own fields equal the raw record, so the
 * port reads exactly the halfwords and bytes F0x8009EC94 reads. `id` is the
 * species id, the key space the original's own test uses.
 */
function shippedProfile(rt, speciesId) {
    const row = speciesRow(rt, speciesId);
    const h = (o) => rt.mem.read16(row + o);
    const b = (o) => rt.mem.read8(row + o);
    const raw = {
        core: [h(0x02), h(0x04), h(0x06), h(0x08), h(0x0a)],
        elements: FORM_ELEMENT_KEYS.map((_, i) => h(0x0e + i * 2)),
        status: FORM_STATUS_RESIST_KEYS.map((_, i) => b(0x2c + i)),
        family: b(0x56),
    };
    const matches = digimonDB.filter((d) =>
        CORE_KEYS.every((k, i) => d[k] === raw.core[i])
        && FORM_ELEMENT_KEYS.every((k, i) => d.resistances[k] === raw.elements[i])
        && FORM_STATUS_RESIST_KEYS.every((k, i) => d.status_resist[k] === raw.status[i])
        && d.family === raw.family);
    assert.equal(matches.length, 1,
        `species ${speciesId} matches exactly one shipped profile (raw ${JSON.stringify(raw)})`);
    assert.equal(rt.mem.read16(row), speciesId, "the row's own first halfword is the species id");
    return { profile: { ...matches[0], id: speciesId }, row, raw };
}

/** The block the original wrote, field by field, in the walker's names. */
function nativeBlock(rt, block) {
    const h = (o) => rt.mem.read16(block + o);
    return {
        level: h(0x00),
        core: [h(0x02), h(0x04), h(0x06), h(0x08), h(0x0a)],
        elements: FORM_ELEMENT_KEYS.map((_, i) => h(0x0c + i * 2)),
        status: FORM_STATUS_RESIST_KEYS.map((_, i) => h(0x1a + i * 2)),
        family: rt.mem.read8(block + 0x25),
    };
}

function runNative(rt, c) {
    rosterRow = c.rosterRow;
    scratch = c.scratch;
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(c.block + i, 0);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(PARTY_RECORD + i, 0);
    rt.mem.write16(PARTY_RECORD, c.liveSpeciesId & 0xffff);
    const ret = rt.cpu.call(EFFECTIVE_STATS, [0, c.block === BLOCK_ATTACKER ? 1 : 0, 0], 400000);
    assert.equal(ret >>> 0, c.block, "the routine returns the block it was asked for");
    return nativeBlock(rt, c.block);
}

/** The walker-shaped record: stored stats plus the two species rows. */
function walkerRecord(c) {
    const record = {
        level: c.scratch.level,
        str: c.scratch.core[0], def: c.scratch.core[1], spt: c.scratch.core[2],
        wis: c.scratch.core[3], spd: c.scratch.core[4],
        hp: 999, maxHp: 999, ailments: {},
        profile: c.live.profile,
        savedProfile: c.roster.profile,
        savedSpeciesId: c.roster.profile.id,
    };
    return record;
}

function walkerBlock(record) {
    const eff = effStats(record);
    return {
        level: eff.level,
        core: CORE_KEYS.map((k) => eff[k]),
        elements: FORM_ELEMENT_KEYS.map((k) => eff.resistances[k]),
        status: FORM_STATUS_RESIST_KEYS.map((k) => combatantStatusResist(record, k)),
        family: eff.family,
    };
}

/** The roster row's own scratch: its level, its stored stats, its seven elements. */
function scratchFor(rt, roster) {
    return {
        level: 12,
        core: [140, 121, 96, 88, 74],
        elements: roster.raw.elements,
    };
}

const CASES = [
    {
        name: "the live form is the roster's own",
        liveSpeciesId: 383, rosterSpeciesId: 383,
        block: BLOCK_ATTACKER,
        rows: { live: 383, roster: 383 },
    },
    {
        name: "the live form is another row's own",
        liveSpeciesId: 385, rosterSpeciesId: 383,
        block: BLOCK_ATTACKER,
        rows: { live: 385, roster: 383 },
    },
    {
        name: "the defender block, two rows apart",
        liveSpeciesId: 393, rosterSpeciesId: 385,
        block: BLOCK_DEFENDER,
        rows: { live: 393, roster: 385 },
    },
];

test("F0x8009EC94's element and status-resistance values are the port's", () => {
    const rt = runtime();
    for (const c of CASES) {
        const live = shippedProfile(rt, c.rows.live);
        const roster = shippedProfile(rt, c.rows.roster);
        const ctx = {
            ...c, live, roster, scratch: scratchFor(rt, roster),
            // [0x8004B44C] answers the row a party position owns; the table is the
            // same one the live form's species service reads.
            rosterRow: (roster.row - PROFILE_BASE) / PROFILE_STRIDE,
        };
        const native = runNative(rt, ctx);
        const walker = walkerBlock(walkerRecord(ctx));
        assert.deepEqual(walker, native, `${c.name}: every field the walker reads`);
    }
});

test("a differing form adds its own seven elements and five resistances", () => {
    const rt = runtime();
    const live = shippedProfile(rt, 385);
    const roster = shippedProfile(rt, 383);
    const ctx = {
        liveSpeciesId: 385, rosterSpeciesId: 383, block: BLOCK_ATTACKER,
        live, roster, scratch: scratchFor(rt, roster),
        rosterRow: (roster.row - PROFILE_BASE) / PROFILE_STRIDE,
    };
    const native = runNative(rt, ctx);
    // Named from the table: the roster row's own seven plus the live row's own
    // seven (pro/fightstg.s:29271-29279), and the roster row's five bytes plus
    // the live row's five (29282-29290). Nothing is floored here.
    assert.deepEqual(native.elements, roster.raw.elements.map((v, i) => v + live.raw.elements[i]));
    assert.deepEqual(native.status, roster.raw.status.map((v, i) => v + live.raw.status[i]));
    assert.deepEqual(native.core, ctx.scratch.core.map((v, i) => v + live.raw.core[i]));
    assert.equal(native.family, live.raw.family, "the type byte always comes from the live form");
});

test("an equal form adds nothing", () => {
    const rt = runtime();
    const row = shippedProfile(rt, 383);
    const ctx = {
        liveSpeciesId: 383, rosterSpeciesId: 383, block: BLOCK_ATTACKER,
        live: row, roster: row, scratch: scratchFor(rt, row),
        rosterRow: (row.row - PROFILE_BASE) / PROFILE_STRIDE,
    };
    const native = runNative(rt, ctx);
    assert.deepEqual(native.elements, row.raw.elements,
        "the roster row's own seven element values stand alone");
    assert.deepEqual(native.status, row.raw.status,
        "the roster row's own five resistance bytes stand alone");
    assert.deepEqual(native.core, ctx.scratch.core, "no core stat is added");
});

test("a record with no roster row keeps the live row's own values", () => {
    const rt = runtime();
    const live = shippedProfile(rt, 385);
    const roster = shippedProfile(rt, 383);
    const native = runNative(rt, {
        liveSpeciesId: 385, rosterSpeciesId: 383, block: BLOCK_ATTACKER,
        live, roster, scratch: scratchFor(rt, roster),
    });
    const record = walkerRecord({ live, roster, scratch: scratchFor(rt, roster) });
    delete record.savedProfile;
    delete record.savedSpeciesId;
    assert.deepEqual(
        FORM_ELEMENT_KEYS.map((k) => combatantElements(record)[k]), live.raw.elements,
        "an enemy-shaped record with no roster form adds nothing",
    );
    assert.deepEqual(
        FORM_STATUS_RESIST_KEYS.map((k) => combatantStatusResist(record, k)), live.raw.status,
        "and keeps its own five resistance bytes",
    );
    assert.notDeepEqual(
        FORM_ELEMENT_KEYS.map((k) => combatantElements(record)[k]), native.elements,
        "which is exactly why the roster row has to be named on the record",
    );
});

test("the element fold adds the points the scratch builder adds", () => {
    const record = {
        level: 12, str: 1, def: 1, spt: 1, wis: 1, spd: 1,
        hp: 1, maxHp: 1, ailments: {},
        profile: { id: 2, resistances: { fire: 60, water: 100 } },
        savedProfile: { resistances: { fire: 60, water: 100 } },
        savedSpeciesId: 1,
        elemBonuses: { fire: 10 },
    };
    assert.deepEqual(combatantElements(record),
        { fire: 130, water: 200, ice: 1, wind: 1, thunder: 1, machine: 1, dark: 1 },
        "roster 60 plus the live form's 60, then the record's own 10 points come ON, "
        + "the way F0x80017578 adds a worn item's resist (codes 8..14 -> +0x18..)");
});