// Lane B oracle: the element value every screen prints.
//
// The original has ONE element value, and it is a sum with no subtraction in it:
//
//   F0x80017174 (`exe/fns.s:7740-7811`) copies the roster member's own 0x2C-byte
//   stat block (`D0x80048D34 + slot*0x3dc + 0x784` == record + 0x24) into the
//   caller's buffer VERBATIM. The seven element halfwords sit at copy +0x18..+0x24,
//   i.e. record +0x34..+0x40, and they ALREADY carry every trained point:
//   F0x80085e3c (`pro/stfgtrep.s`, `addiu $s6, $s1, 0x1c` then seven `sh` at
//   +0x18, stride 2, `addu` + 999 cap) writes one level-up's rolled gains straight
//   into them. Then the same scratch builder's six-slot loop over the equipped
//   keys calls F0x80017578, whose codes 8..14 land on +0x18..+0x24 (`addiu $v0,
//   $a1, -0x8; sltiu $v0, 0x7` -> `0x8 + code*2`) with `addu` and the same 999
//   cap.
//
//   The STATUS sheet reads that scratch and nothing else. F0x8008C1C0
//   (`pro/ststatus.s`, lifted from the constructor-installed pointer) takes the
//   roster slot through `[ctx+0x2718]`, calls `[ctx+0x2734]` -- the resident
//   image's own `0x80017174` -- into its stack buffer, then prints
//   `lh buffer+0x18..0x24` and caps: `slti $v0, $a2, 0x3e8 / bnez / li $v0,
//   0x3e7`. No subtraction, no floor on this path.
//
//   FIGHTSTG_F0x8009EC94 (`pro/fightstg.s:29292-29300`) is the one place that
//   also floors: `lh / lhu / blez -> sh 1`, seven times over the same scratch.
//
// So `engine/dw3/effective-stats.ts`'s `elementValue` (what every screen calls)
// and `battleElementValue` (the battle block's floor) must reproduce those
// bytes. This oracle runs the real F0x80017174 over the resident EXE image with
// real definition records and compares its seven halfwords against the helper,
// for three roster records: trained points only, a worn ring only, and both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    ELEMENT_FLOOR, ELEMENT_KEYS, battleElementValue, buildEffectiveStats, elementValue, elementValues,
    STAT_CLAMP,
} from "../../engine/dw3/effective-stats.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const digimonDB = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/digimon.json"), "utf8"),
).digimon;

const SCRATCH_BUILD = 0x80017174;  // resident EXE
const DEFINITION_CELL = 0x80042b98;
const DEFINITION_STUB = 0x800190e0;
const SPECIES_CELL = 0x8005cca0;
const PROFILE_BASE = 0x8003ef5c;
const PROFILE_STRIDE = 0x58;
const CTX = 0x80048d34;
const CUR_STATS = 0x8004949c;      // DIGIMON_CUR_STATS
const STRIDE = 0x3dc;
const BUF = 0x80170000;
const REC = 0x80171000;
const DEF = 0x80172000;
const ROW_STUB = 0x0fdc0000;
const ROW_INDEX = 0x0fdc0004;
const CTX_ROW_STUB = 0x0fdc0010;   // ctx+0x2718

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(new Uint8Array(8),
        { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
        host, undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
    rt.cpu.gp = 0x8005cb50;
    const recFor = (key) => REC + (((key | 0) - 1) * 0x20);
    rt.cpu.setStub(DEFINITION_STUB, (c) => recFor(c.reg(4)));
    rt.mem.write32(DEFINITION_CELL, DEFINITION_STUB);
    // ctx+0x2718 — the roster row a party position owns. Both F0x8008C1C0 and
    // F0x8009EC94 resolve one index through it and use it for the roster member.
    rt.cpu.setStub(CTX_ROW_STUB, (c) => c.mem.read32(ROW_INDEX));
    rt.mem.write32(CTX + 0x2718, CTX_ROW_STUB);
    rt.mem.write32(ROW_INDEX, 0);
    return { rt, host: { definitionRecord: recFor } };
}

/** The profile row a species id names, through the original's own species service. */
function speciesRow(rt, speciesId) {
    const fn = rt.mem.read32(SPECIES_CELL) >>> 0;
    assert.ok(fn !== 0, "the resident image carries the species service");
    return rt.cpu.call(fn, [speciesId], 200000) >>> 0;
}

/**
 * A definition record behind one equipped key. F0x80017174's families 2..14 arm
 * read the two coded stats at def+0xc / def+0xe with their amounts at def+0x6 /
 * def+0x8 (exe/fns.s:7904-7930), and families 15..20 read def+0xa / def+0xc.
 */
function writeRecord(rt, key, r) {
    const rec = REC + (key - 1) * 0x20;
    const def = DEF + (key - 1) * 0x40;
    rt.mem.write32(rec + 0x0, def);
    rt.mem.write8(rec + 0x9, r.family & 0xff);
    rt.mem.write16(def + 0x0, r.charisma ?? 0);
    rt.mem.write16(def + 0x6, r.amount0 ?? 0);
    rt.mem.write16(def + 0x8, r.amount1 ?? 0);
    rt.mem.write16(def + 0xa, r.bonusA ?? 0);
    rt.mem.write16(def + 0xc, r.bonusB ?? 0);
    rt.mem.write8(def + 0xa, (r.code15 ?? 0) & 0xff);
    rt.mem.write8(def + 0xc, (r.code2 ?? 0) & 0xff);
    rt.mem.write8(def + 0xe, (r.code2b ?? 0) & 0xff);
    return { rec, def };
}

/**
 * One roster record: a species id, the seven stored element halfwords the record
 * keeps (its species base plus every trained point), the equipped keys and the
 * definition records behind them.
 */
const CASES = [
    {
        name: "trained points only",
        speciesId: 383, // Monmon — the profile table's own first row
        trained: [30, 12, 25, 8, 40, 5, 18],
        equipped: {},
        records: {},
    },
    {
        name: "a worn Flame Ring (item 304, code 8, +20)",
        speciesId: 3, // Biyomon
        trained: [0, 0, 0, 0, 0, 0, 0],
        equipped: { 0: 304 },
        records: { 304: { family: 2, code2: 8, amount0: 20 } },
    },
    {
        name: "trained points and a worn ring together",
        speciesId: 385, // MetalGreymon
        trained: [5, 6, 4, 3, 7, 2, 1],
        equipped: { 0: 304 },
        records: { 304: { family: 2, code2: 8, amount0: 20 } },
    },
];

/** The shipped digimon.json row that IS that table row, field for field. */
function shippedProfile(rt, speciesId) {
    const row = speciesRow(rt, speciesId);
    assert.ok(row !== 0, `species ${speciesId} is on the original's profile table`);
    const h = (o) => rt.mem.read16(row + o);
    const raw = ELEMENT_KEYS.map((_, i) => h(0x0e + i * 2));
    const matches = digimonDB.filter((d) => ELEMENT_KEYS.every((k, i) => d.resistances[k] === raw[i]));
    assert.equal(matches.length, 1,
        `species ${speciesId} matches exactly one shipped profile (raw ${JSON.stringify(raw)})`);
    return { profile: { ...matches[0], id: speciesId }, base: raw };
}

/** Seed one roster record and run the ORIGINAL F0x80017174 over it. */
function nativeScratch(tc) {
    const { rt, host } = runtime();
    const { profile, base } = shippedProfile(rt, tc.speciesId);
    const slot = (speciesRow(rt, tc.speciesId) - PROFILE_BASE) / PROFILE_STRIDE;
    rt.mem.write32(ROW_INDEX, slot);
    const d = CUR_STATS + slot * STRIDE;
    for (let i = 0; i < STRIDE; i += 4) rt.mem.write32(d + i, 0);
    // The stored halfwords: the species row's own seven plus the trained points,
    // exactly as F0x80085e3c leaves them.
    for (let i = 0; i < 7; i++) rt.mem.write16(d + 0x34 + i * 2, base[i] + tc.trained[i]);
    for (const [index, item] of Object.entries(tc.equipped)) {
        rt.mem.write16(d + 0x3c0 + Number(index) * 2, item);
        const r = tc.records[item];
        if (r) writeRecord(rt, item, r);
    }
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(BUF + i, 0);
    rt.cpu.call(SCRATCH_BUILD, [slot, BUF], 200000);
    const native = ELEMENT_KEYS.map((_, i) => rt.mem.read16(BUF + 0x18 + i * 2));
    // The port, over the same record.
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(BUF + i, 0);
    buildEffectiveStats(rt.mem, host, slot, BUF);
    const ported = ELEMENT_KEYS.map((_, i) => rt.mem.read16(BUF + 0x18 + i * 2));
    assert.deepEqual(ported, native, `${tc.name}: buildEffectiveStats reproduces the scratch`);
    return { profile, native, base };
}

/** The walker's side of one case: the points table it holds for the record. */
function walkerPoints(tc, base) {
    // The worn ring's coded resist rides in the same field as the trained points
    // for the original (F0x80017578 vs F0x80085e3c both `addu` into the halfword),
    // so the walker carries both in `elemBonuses`.
    const points = Object.fromEntries(ELEMENT_KEYS.map((k, i) => [k, tc.trained[i]]));
    for (const [index, item] of Object.entries(tc.equipped)) {
        const r = tc.records[item];
        if (!r) continue;
        for (const [code, amount] of [[r.code2, r.amount0], [r.code2b, r.amount1]]) {
            if (code >= 8 && code <= 14) points[ELEMENT_KEYS[code - 8]] += amount;
        }
    }
    void base;
    return points;
}

test("the shared element value is the original's scratch halfword", () => {
    for (const tc of CASES) {
        const { profile, native } = nativeScratch(tc);
        const points = walkerPoints(tc);
        for (let i = 0; i < 7; i++) {
            assert.equal(elementValue(profile, points, ELEMENT_KEYS[i]), native[i],
                `${tc.name}: ${ELEMENT_KEYS[i]}`);
        }
        assert.deepEqual(elementValues(profile, points), native, `${tc.name}: all seven`);
    }
    // Not vacuous: the trained case rises above the species row and the ring case
    // rises above its stored halfword, so a helper that read only the base could
    // not pass all three.
    const [trained, ring, both] = CASES.map((tc) => nativeScratch(tc));
    assert.ok(trained.native[0] > trained.base[0], "trained points raise fire above the species row");
    assert.deepEqual(ring.native.slice(1), ring.base.slice(1),
        "a ring that codes only fire leaves the other six alone");
    assert.equal(both.native[0], both.base[0] + 5 + 20,
        "trained fire 5 and the ring's 20 are both added to the species base");
});

test("the cap is the original's 999 and the floor belongs to the battle block only", () => {
    for (const tc of CASES) {
        const { profile, native } = nativeScratch(tc);
        for (let i = 0; i < 7; i++) {
            assert.ok(native[i] <= STAT_CLAMP, `${tc.name}: ${ELEMENT_KEYS[i]} is inside the cap`);
            const v = elementValue(profile, walkerPoints(tc), ELEMENT_KEYS[i]);
            assert.equal(v, native[i], `${tc.name}: the sheet prints the uncapped-at-zero value`);
            assert.equal(battleElementValue(profile, walkerPoints(tc), ELEMENT_KEYS[i]),
                Math.max(ELEMENT_FLOOR, native[i]),
                `${tc.name}: the battle block's floor of 1`);
        }
    }
    // A species row whose own value is 0 is the case the floor exists for: the
    // sheet prints 0, the battle divisor is 1. digimon.json has 47 such rows.
    const zero = { resistances: Object.fromEntries(ELEMENT_KEYS.map((k) => [k, 0])) };
    assert.equal(elementValue(zero, {}, "fire"), 0, "the STATUS sheet prints a stored 0");
    assert.equal(battleElementValue(zero, {}, "fire"), ELEMENT_FLOOR, "the battle divisor is never 0");
});

test("a 999 store clamps and a negative point never lands on the sheet uncapped", () => {
    const profile = { resistances: { fire: STAT_CLAMP - 2 } };
    assert.equal(elementValue(profile, { fire: 1 }, "fire"), STAT_CLAMP - 1, "just under the cap");
    assert.equal(elementValue(profile, { fire: 2 }, "fire"), STAT_CLAMP, "the cap is 999, not 1000");
    assert.equal(elementValue(profile, { fire: 900 }, "fire"), STAT_CLAMP, "a huge point still caps");
    // A stored halfword is unsigned, so the sum can never go negative here; the
    // helper must not invent one either.
    assert.equal(elementValue({ resistances: { fire: 40 } }, { fire: -10 }, "fire"), 30,
        "a negative point lowers the value, as `addu` on a u16 store would");
});