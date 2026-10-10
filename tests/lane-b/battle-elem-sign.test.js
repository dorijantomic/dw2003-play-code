// Lane B oracle: the sign of an element value.
//
// The original's battle element value is built in two steps, both ADDITIVE:
//
//   1. `F0x80017174` (`exe/fns.s:7740`) is the resident word at `0x8004B468`
//      (= the roster context's +0x2734), so it IS the scratch builder the block
//      reader calls. It copies `DIGIMON_CUR_STATS + slot*0x3dc + 0x1c` — the
//      roster member's own stored stat block — into the caller's buffer verbatim,
//      then adds every worn item's coded stat through `F0x80017578`, whose codes
//      8..14 land on scratch +0x18..+0x24 (`exe-decomp/c/F0x80017578.c:23-30`).
//   2. `FIGHTSTG_F0x8009EC94` (`pro/fightstg.s:29186`) reads that scratch and,
//      only while the live form differs from the species id the stored numbers
//      belong to, adds the live form's species-record own seven (`.L0x8009ede4`),
//      then floors the sum at 1 (`.L0x8009eee8`, `blez` -> 1).
//
// The trained element points are not a separate term at all: `F0x80085e3c`
// (`pro/stfgtrep.s`, `exe-decomp/stfgtrep_c/F0x80085e3c.c:100-118`) writes one
// level-up's rolled gains straight into `DIGIMON_CUR_STATS + 0x34..0x40` with
// `addu` and a 999 cap, so they are already inside the stored halfword step 1
// copies. Nothing anywhere subtracts them.
//
// So the value the damage leaves divide by is
//     stored halfword (species base + every trained point)
//   + every worn item's elemental resist                (F0x80017174 -> F0x80017578)
//   + the live form's own base, while the form differs         (F0x8009EC94)
//   , floored at 1                                                    (F0x8009EC94)
// and `engine/dw3/battle-combat.ts` `combatantElements` must be that sum.
//
// The oracle runs the original's own three routines for real over the resident
// EXE image (`resident.bin`) and the shipped `pro_fightstg.bin` /
// `pro_stfgtrep.bin` overlays. `0x8004B468` keeps the image's own value
// (0x80017174), so the block reader really does call the real scratch builder.
// Two context services are stubbed, because the game fills them at boot:
// `ctx+0x2718` (which roster row/slot a party position owns — the same index
// selects the roster member and its profile row) and `ctx+0x2750` (a party
// member's roster record). The item accessor `[0x80042B98]`, the species service
// `[0x8005CCA0]` and the engine's rand service address are the image's own.
//
// The walker's side is a real `Combatant`: the shipped `digimon.json` rows whose
// raw records match the table rows field for field, with the trained points in
// `elemBonuses` exactly as the game holds them — inside the stored value the
// original's copy step reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    formChangeValues, FORM_ELEMENT_KEYS,
} from "../../engine/dw3/battle-form-change.ts";
import {
    combatantElements, resolveAttack,
} from "../../engine/dw3/battle-combat.ts";
import { resolveDamage } from "../../engine/dw3/battle-formulas.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const levelup = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const OVERLAY_BASE = 0x80082cb0;
const entry = (img) => ({ size: img.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] });
const digimonDB = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/digimon.json"), "utf8"),
).digimon;

const CTX = 0x80048d34;            // the roster context every service hangs off
const CUR_STATS = 0x8004949c;      // DIGIMON_CUR_STATS
const STRIDE = 0x3dc;              // one roster member
const PARTY_RECORD = 0x800a4470;   // live battle workspace, 0x20 per combatant
const BLOCK_ATTACKER = 0x800a4580;
const BLOCK_DEFENDER = 0x800a45c0;
const SPECIES_CELL = 0x8005cca0;
const ITEM_CELL = 0x80042b98;
const SCRATCH_BUILD = 0x80017174;  // resident EXE
const BLOCK_BUILDER = 0x8009ec94;  // pro/fightstg
const LEVEL_UP = 0x80085e3c;       // pro/stfgtrep
const PROFILE_BASE = 0x8003ef5c;
const PROFILE_STRIDE = 0x58;
const ELEM_GAIN_TABLE = 0x80089288;

const SCRATCH_BUF = 0x0fdc0100;
const ROW_STUB = 0x0fdc0000;
const ROW_INDEX = 0x0fdc0004;   // the roster row the roster-row service answers with
const REC_PTR_STUB = 0x0fdc0010;
const RNG_STUB = 0x0fdc0020;
const RNG_OBJ = 0x0fdc0030;

const CORE_KEYS = ["str", "def", "spt", "wis", "spd", "chr"];

/** One runtime per overlay: both load at 0x80082cb0, so they cannot coexist. */
function runtime(overlay) {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(overlay, entry(overlay), host, undefined, undefined, OVERLAY_BASE, {
        image: resident, base: 0x80010000,
    });
    // ctx+0x2718 — the roster row a party position owns. `place` sets it.
    rt.cpu.setStub(ROW_STUB, (c) => c.mem.read32(ROW_INDEX));
    rt.mem.write32(ROW_INDEX, 0);
    // ctx+0x2750 — a party member's roster record. Both routines here act on
    // slot 0, which `place` fills.
    rt.cpu.setStub(REC_PTR_STUB, () => CUR_STATS);
    rt.mem.write32(CTX + 0x2718, ROW_STUB);
    rt.mem.write32(CTX + 0x2750, REC_PTR_STUB);
    // The engine's own rand service, for the level-up applier.
    rt.cpu.setStub(RNG_STUB, () => 0);
    rt.mem.write32(RNG_OBJ, RNG_STUB);
    rt.mem.write32(0x8004dc04, RNG_OBJ);
    return rt;
}

/**
 * The resident image already carries `0x8004B468 = 0x80017174`, so leaving that
 * word alone makes `F0x8009EC94` build its scratch with the original's own
 * routine. Assert it, because the whole oracle rests on it.
 */
function assertScratchService(rt) {
    assert.equal(rt.mem.read32(CTX + 0x2734) >>> 0, SCRATCH_BUILD,
        "the resident image's scratch-builder service is F0x80017174");
}

/** The profile row a species id names, through the original's own species service. */
function speciesRow(rt, speciesId) {
    const fn = rt.mem.read32(SPECIES_CELL) >>> 0;
    assert.ok(fn !== 0, "the resident image carries the species service");
    return rt.cpu.call(fn, [speciesId], 200000) >>> 0;
}

/**
 * Put the record in the roster at the slot whose profile row is its own species
 * row. `F0x8009EC94` resolves one index through `ctx+0x2718` and uses it for both
 * — the roster member (`F0x80017174`) and the species row its `beq` gate reads
 * (`pro/fightstg.s:29247-29250`, `$s4*0x58 + 0x8003EF5C`) — so the member and its
 * species row have to sit on the same index, which is how the game lays them out.
 */
function place(rt, rec) {
    const row = speciesRow(rt, rec.speciesId);
    assert.ok(row >= PROFILE_BASE && (row - PROFILE_BASE) % PROFILE_STRIDE === 0,
        `species ${rec.speciesId} names a row on the profile-table stride`);
    const slot = (row - PROFILE_BASE) / PROFILE_STRIDE;
    rt.mem.write32(ROW_INDEX, slot);
    const d = CUR_STATS + slot * STRIDE;
    for (let i = 0; i < STRIDE; i += 4) rt.mem.write32(d + i, 0);
    rt.mem.write16(d + 0x1c, rec.level);
    rt.mem.write16(d + 0x22, 900);
    rt.mem.write16(d + 0x26, 400);
    for (let i = 0; i < 6; i++) rt.mem.write16(d + 0x28 + i * 2, rec.core[i]);
    for (let i = 0; i < 7; i++) rt.mem.write16(d + 0x34 + i * 2, rec.stored[i]);
    for (const [off, item] of Object.entries(rec.equipped ?? {})) {
        rt.mem.write16(d + Number(off), item);
    }
    return slot;
}

const storedElems = (rt, d) => FORM_ELEMENT_KEYS.map((_, i) => rt.mem.read16(d + 0x34 + i * 2));

/** The real F0x80017174: the roster member's stored block -> scratch +0x18. */
function nativeScratch(rt, slot) {
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(SCRATCH_BUF + i, 0);
    rt.cpu.call(SCRATCH_BUILD, [slot, SCRATCH_BUF], 200000);
    return FORM_ELEMENT_KEYS.map((_, i) => rt.mem.read16(SCRATCH_BUF + 0x18 + i * 2));
}

/** The real F0x8009EC94: the block the damage leaves divide by. */
function nativeBlock(rt, slot, liveSpecies, blockAddr = BLOCK_DEFENDER) {
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(blockAddr + i, 0);
    const rec = PARTY_RECORD + slot * 0x20;
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(rec + i, 0);
    rt.mem.write16(rec, liveSpecies & 0xffff);
    rt.cpu.call(BLOCK_BUILDER, [0, blockAddr === BLOCK_ATTACKER ? 1 : 0, slot], 400000);
    return FORM_ELEMENT_KEYS.map((_, i) => rt.mem.read16(blockAddr + 0x0c + i * 2));
}

/** The shipped digimon.json entry that IS that table row, field for field. */
function shippedProfile(rt, speciesId) {
    const row = speciesRow(rt, speciesId);
    const h = (o) => rt.mem.read16(row + o);
    const raw = {
        core: CORE_KEYS.map((_, i) => h(0x02 + i * 2)),
        elements: FORM_ELEMENT_KEYS.map((_, i) => h(0x0e + i * 2)),
    };
    const matches = digimonDB.filter((d) => CORE_KEYS.every((k, i) => d[k] === raw.core[i])
        && FORM_ELEMENT_KEYS.every((k, i) => d.resistances[k] === raw.elements[i]));
    assert.equal(matches.length, 1,
        `species ${speciesId} matches exactly one shipped profile (raw ${JSON.stringify(raw)})`);
    return { profile: { ...matches[0], id: speciesId }, row, raw };
}

/**
 * Two roster records whose stored element halfwords carry trained points on top
 * of a species base: a level-12 Monmon and a level-31 Biyomon. `trained` is what
 * the walker holds in `elemBonuses` — inside the stored value for the original,
 * beside it for the port. `stored` is that species row's own seven plus
 * `trained`, which the second test checks against the table.
 */
const RECORDS = [
    {
        name: "level-12 Monmon (species 383)",
        speciesId: 383, level: 12,
        core: [140, 121, 96, 88, 74, 20],
        trained: [5, 6, 4, 3, 7, 2, 1],
        stored: [90, 131, 84, 83, 122, 102, 96],
    },
    {
        name: "level-31 Biyomon (species 3)",
        speciesId: 3, level: 31,
        core: [201, 155, 130, 111, 140, 33],
        trained: [14, 9, 12, 6, 11, 15, 8],
        stored: [144, 109, 72, 106, 106, 110, 108],
    },
];

/** The walker-shaped record for one of the two, the trained points beside the
 *  species base exactly as the walker holds them. */
function walkerRecord(rec, profile) {
    return {
        level: rec.level,
        str: rec.core[0], def: rec.core[1], spt: rec.core[2],
        wis: rec.core[3], spd: rec.core[4],
        hp: 900, maxHp: 900, mp: 400, maxMp: 400, ailments: {},
        profile,
        savedProfile: profile,
        savedSpeciesId: rec.speciesId,
        elemBonuses: Object.fromEntries(FORM_ELEMENT_KEYS.map((k, i) => [k, rec.trained[i]])),
    };
}

const walkerElems = (record) => FORM_ELEMENT_KEYS.map((k) => combatantElements(record)[k]);

test("F0x80017174 copies the stored element halfwords verbatim", () => {
    for (const rec of RECORDS) {
        const rt = runtime(levelup);
        assertScratchService(rt);
        const slot = place(rt, rec);
        assert.deepEqual(nativeScratch(rt, slot), rec.stored,
            `${rec.name}: the scratch carries the record's own seven, unaltered`);
    }
});

test("a roster record's stored halfwords are its species base plus its trained points", () => {
    for (const rec of RECORDS) {
        const rt = runtime(levelup);
        const { raw } = shippedProfile(rt, rec.speciesId);
        assert.deepEqual(rec.stored, FORM_ELEMENT_KEYS.map((k, i) => raw.elements[i] + rec.trained[i]),
            `${rec.name}: stored = the shipped profile row's own seven + the trained points`);
    }
});

test("F0x80085e3c adds a level-up's element gains into the stored halfwords", () => {
    const rec = RECORDS[0];
    const rt = runtime(levelup);
    const slot = place(rt, rec);
    const before = storedElems(rt, CUR_STATS + slot * STRIDE);
    rt.cpu.call(LEVEL_UP, [rec.speciesId, rec.level], 400000);
    const after = storedElems(rt, CUR_STATS + slot * STRIDE);
    const gains = [];
    for (let i = 0; i < 32; i++) gains.push(rt.mem.read16(ELEM_GAIN_TABLE + i * 2));
    for (let i = 0; i < 7; i++) {
        const delta = after[i] - before[i];
        assert.ok(delta >= 0, `${rec.name} ${FORM_ELEMENT_KEYS[i]}: a level-up never lowers it (${delta})`);
        assert.ok(gains.includes(delta),
            `${rec.name} ${FORM_ELEMENT_KEYS[i]}: the rise ${delta} is one of the original's own gain rows`);
        assert.ok(after[i] <= 999, `${rec.name} ${FORM_ELEMENT_KEYS[i]}: capped at 999`);
    }
});

test("the block's element values are the walker's, with the form equal and changed", () => {
    for (const rec of RECORDS) {
        const rt = runtime(fight);
        assertScratchService(rt);
        const slot = place(rt, rec);
        const own = shippedProfile(rt, rec.speciesId);
        const other = shippedProfile(rt, 385);

        // Form unchanged: the block carries the stored halfwords, nothing added.
        const record = walkerRecord(rec, own.profile);
        assert.deepEqual(walkerElems(record), nativeBlock(rt, slot, rec.speciesId),
            `${rec.name}, form unchanged`);

        // Form changed: the live form's species record is added on top.
        record.profile = other.profile;
        const diff = nativeBlock(rt, slot, 385);
        assert.deepEqual(walkerElems(record), diff, `${rec.name}, Digivolved into 385`);
        assert.deepEqual(diff, rec.stored.map((v, i) => Math.max(1, v + other.raw.elements[i])),
            `${rec.name}: the live form's own seven are added, then floored at 1`);
    }
});

test("a worn Flame Ring (item 304) is added, not taken off", () => {
    const rec = RECORDS[0];
    const rt = runtime(fight);
    assertScratchService(rt);
    const slot = place(rt, { ...rec, equipped: { 0x3c8: 304 } });
    // Item 304's own record, read through the original's own item accessor:
    // code 8 (fire) and magnitude 20.
    const item = rt.cpu.call(rt.mem.read32(ITEM_CELL) >>> 0, [304], 100000) >>> 0;
    const unknown2 = rt.mem.read32(item) >>> 0;
    assert.equal(rt.mem.read8(unknown2 + 8), 8, "item 304 codes fire");
    assert.equal(rt.mem.read16(unknown2 + 6), 20, "item 304 carries 20");

    const native = nativeBlock(rt, slot, rec.speciesId);
    assert.deepEqual(native, FORM_ELEMENT_KEYS.map((k, i) => rec.stored[i] + (i === 0 ? 20 : 0)),
        "the block's fire is the stored value plus the ring's 20");

    const own = shippedProfile(rt, rec.speciesId);
    const record = walkerRecord(rec, own.profile);
    // The ring's 20 rides in the same field as the trained points: the original
    // adds both to the stored halfword (F0x80017578 vs F0x80085e3c).
    record.elemBonuses.fire += 20;
    assert.deepEqual(walkerElems(record), native, "and the walker's element value is that same sum");
});

test("a sample attack: the trained fire points raise the divisor, so fire hurts less", () => {
    const rec = RECORDS[0];
    const rt = runtime(fight);
    assertScratchService(rt);
    const slot = place(rt, rec);
    const own = shippedProfile(rt, rec.speciesId);
    const combatant = (elemBonuses) => ({
        level: 40, str: 200, def: 200, spt: 200, wis: 200, spd: 200,
        hp: 900, maxHp: 900, mp: 400, maxMp: 400, ailments: {},
        profile: own.profile, savedProfile: own.profile, savedSpeciesId: rec.speciesId,
        elemBonuses,
    });
    const attacker = { ...combatant(), str: 300 };
    const trained = combatant(Object.fromEntries(
        FORM_ELEMENT_KEYS.map((k, i) => [k, rec.trained[i]])));
    // `damage_scalar` is the technique's own +0x8 byte (48 for a shipped fire
    // technique), the multiplier the physical tail divides by the defender's.
    const skill = {
        name: "Hot Head", element: "fire", damage_scalar: 48, power: 75,
        base_acc: 128, attack_category: "physical", target_family: 0,
    };
    const at = () => 0x1234;
    const nativeDivisor = nativeBlock(rt, slot, rec.speciesId)[0];
    assert.equal(combatantElements(trained).fire, nativeDivisor,
        "the trained points' fire value is the block's own");
    const before = resolveAttack(attacker, combatant(), skill, at).dmg;
    const after = resolveAttack(attacker, trained, skill, at).dmg;
    assert.ok(after < before, `trained fire resistance lowers the damage (${before} -> ${after})`);
    const formValues = formChangeValues(rec.speciesId, rec.speciesId, {
        resistances: own.profile.resistances,
    }, own.profile);
    assert.equal(formValues.elements.fire, own.raw.elements[0],
        "the form rule itself only ever adds");
});
// ── The other end of the same question: which way does the value bend damage ──
//
// `FIGHTSTG_F0x8009f6dc` (`pro/fightstg.s:29850`) is the physical tail, and it
// reads the defender's element halfword as a DIVISOR twice: once for a
// technique that carries its own element (`.L0x8009f7d8-.L0x8009f864`,
// `s0 += 2*s0*skill[+0x8] / defenderElement`) and once for a plain attack by an
// attacker wearing an elemental-Power accessory (`.L0x8009f804-.L0x8009f864`).
// There is no `running * element / 100` stage anywhere in it. Both are run for
// real below, over the shipped skill rows' own `damage_scalar` (= `skill[+0x8]`).

const DAMAGE_TAIL = 0x8009f6dc;
const SKILL_BASE = 0x80042bca;
const ATTACKER_BLOCK = 0x800a4580;
const DEFENDER_BLOCK = 0x800a45c0;
const FIELD_CTX = 0x800a4530;
const RNG_CELL = 0x8004dc0c;
const TAIL_RNG = 0x0fdc0040;

function tailRuntime() {
    const rt = runtime(fight);
    // The crit roll reads the engine's rand service; 0x7f7f never procs.
    rt.cpu.setStub(TAIL_RNG, () => 0x7f7f);
    rt.mem.write32(RNG_CELL, TAIL_RNG);
    rt.mem.write16(FIELD_CTX, 0);   // no elemental field, so the field stage adds 0
    return rt;
}

/** One skill row, one pair of blocks, and the tail's own answer. */
function nativeTail(rt, skillIndex, { elementByte, scalar, plain }, defenderElems, base) {
    const skill = SKILL_BASE + skillIndex * 0x12;
    for (let i = 0; i < 0x12; i += 4) rt.mem.write32(skill + i, 0);
    rt.mem.write8(skill + 7, elementByte);
    rt.mem.write8(skill + 8, scalar);
    rt.mem.write16(skill + 9, 0);        // element2 < 2: no halving
    rt.mem.write8(skill + 0x0a, 0x0b);   // not the plain-attack shape
    rt.mem.write16(skill + 0x10, 0);     // so the accessory branch is reachable
    for (let i = 0; i < 0x40; i += 4) {
        rt.mem.write32(ATTACKER_BLOCK + i, 0);
        rt.mem.write32(DEFENDER_BLOCK + i, 0);
    }
    rt.mem.write8(ATTACKER_BLOCK + 0x25, 1);   // family: no match
    rt.mem.write8(DEFENDER_BLOCK + 0x25, 2);
    for (let i = 0; i < 7; i++) {
        rt.mem.write16(ATTACKER_BLOCK + 0x0c + i * 2, 100);
        rt.mem.write16(DEFENDER_BLOCK + 0x0c + i * 2, defenderElems[i]);
    }
    if (plain) {
        rt.mem.write8(skill + 7, 0);
        rt.mem.write8(ATTACKER_BLOCK + 0x2b, plain.elementId);
        rt.mem.write16(ATTACKER_BLOCK + 0x2c, plain.magnitude);
    }
    return rt.cpu.call(DAMAGE_TAIL, [0, skillIndex, base], 400000);
}

/** The walker's own tail over the same inputs, crit and flat reduction at zero. */
function walkerTail(defenderElems, skill, base, atkExtra = {}) {
    const atk = { level: 1, str: 1, def: 1, spt: 1, wis: 1, spd: 1, crit: 0, armor: 0, resistances: {}, ...atkExtra };
    const def = {
        level: 1, str: 1, def: 1, spt: 1, wis: 1, spd: 1, crit: 0, armor: 0,
        family: 2, resistances: Object.fromEntries(FORM_ELEMENT_KEYS.map((k, i) => [k, defenderElems[i]])),
    };
    return resolveDamage(base, atk, def, {
        element: skill.element, power: 1, base_acc: 128, attack_category: "physical",
        target_family: 0, ...skill,
    }, () => 0x7f7f);
}

test("the physical tail divides by the element value, both ways", () => {
    const rt = tailRuntime();
    const BASE = 1000;
    const cases = [
        { name: "fire technique, scalar 48, fire 100", elems: [100, 100, 100, 100, 100, 100, 100],
            native: { elementByte: 2, scalar: 48 },
            walker: { element: "fire", damage_scalar: 48 } },
        { name: "fire technique, scalar 48, fire 200", elems: [200, 100, 100, 100, 100, 100, 100],
            native: { elementByte: 2, scalar: 48 },
            walker: { element: "fire", damage_scalar: 48 } },
        { name: "fire technique, scalar 48, fire 40", elems: [40, 100, 100, 100, 100, 100, 100],
            native: { elementByte: 2, scalar: 48 },
            walker: { element: "fire", damage_scalar: 48 } },
        { name: "dark technique, scalar 32, dark 85", elems: [100, 100, 100, 100, 100, 100, 85],
            native: { elementByte: 8, scalar: 32 },
            walker: { element: "dark", damage_scalar: 32 } },
    ];
    let i = 1;
    for (const c of cases) {
        assert.equal(walkerTail(c.elems, c.walker, BASE), nativeTail(rt, i++, c.native, c.elems, BASE),
            `${c.name}: the walker's physical element stage is the original's`);
    }
    // Higher value, less damage: the direction question this whole pass is about.
    const low = nativeTail(rt, 10, { elementByte: 2, scalar: 48 }, [40, 100, 100, 100, 100, 100, 100], BASE);
    const high = nativeTail(rt, 10, { elementByte: 2, scalar: 48 }, [400, 100, 100, 100, 100, 100, 100], BASE);
    assert.ok(high < low, `a higher element value takes less damage (${low} -> ${high})`);
});

test("the accessory term divides too, and a plain attack has no element stage", () => {
    const rt = tailRuntime();
    const BASE = 1000;
    const plain = { elementId: 2, magnitude: 24 };
    for (const fire of [100, 200, 50]) {
        const elems = FORM_ELEMENT_KEYS.map((k, i) => (i === 0 ? fire : 100));
        assert.equal(
            walkerTail(elems, { element: "normal", basic_attack: true }, BASE,
                { elementalAttack: { element: "fire", amount: 24 } }),
            nativeTail(rt, 20, { elementByte: 0, scalar: 0, plain }, elems, BASE),
            `plain attack by an attacker with a FirePower accessory, defender fire ${fire}`,
        );
    }
    // No accessory and no technique element: the tail leaves the base alone,
    // whatever the defender's element values are. There is no x-element stage.
    for (const fire of [50, 100, 400]) {
        const elems = FORM_ELEMENT_KEYS.map((k, i) => (i === 0 ? fire : 100));
        assert.equal(nativeTail(rt, 21, { elementByte: 0, scalar: 0 }, elems, BASE), BASE,
            `a bare attack is unaffected by the defender's fire ${fire}`);
    }
});
