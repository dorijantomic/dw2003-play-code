// Phase 4 oracle: engine/dw3/effective-stats.ts must reproduce
// F0x80017174 (buildEffectiveStats) and F0x80017578 (addEffectiveStat). Both
// originals run through engine/native over the same seeded roster slot and
// definition records, and the whole 0x2C-byte output buffer is compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    DIGIMON_CUR_STATS,
    EFFECTIVE_BUFFER_SIZE,
    EQUIPPED_KEY_COUNT,
    EQUIPPED_KEY_OFFSET,
    EFFECTIVE_SRC_OFFSET,
    SIGNATURE_BONUS_TABLE,
    SIGNATURE_SET_TABLE,
    buildEffectiveStats,
} from "../engine/dw3/effective-stats.ts";
import { ROSTER_SLOT_STRIDE, SAVE_CONTEXT } from "../engine/dw3/form-ledger.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const DEFINITION_CELL = 0x80042b98;
const DEFINITION_STUB = 0x800190e0;
const BUF = 0x80170000;
const REC = 0x80171000;
const DEF = 0x80172000;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Definition record for `key`: its own word points at a definition block. */
function writeRecord(rt, key, family, defFields) {
    const rec = REC + (key - 1) * 0x20;
    const def = DEF + (key - 1) * 0x40;
    rt.mem.write32(rec + 0x0, def);
    rt.mem.write8(rec + 0x9, family & 0xff);
    for (const [off, value] of Object.entries(defFields)) {
        if (off === "bytes") continue;
        rt.mem.write16(def + Number(off), value & 0xffff);
    }
    for (const [off, value] of Object.entries(defFields.bytes ?? {})) rt.mem.write8(def + Number(off), value & 0xff);
    return { rec, def };
}

/** Seed every record of a case on one side. */
function seedRecords(side, records) {
    for (const [key, r] of Object.entries(records ?? {})) {
        writeRecord(side.rt, Number(key), r.family, r.fields);
    }
}

function scenario() {
    const rt = runtime();
    const recFor = (key) => REC + ((key | 0) - 1) * 0x20;
    rt.cpu.setStub(DEFINITION_STUB, (c) => recFor(c.reg(4)));
    rt.mem.write32(DEFINITION_CELL, DEFINITION_STUB);
    for (let i = 0; i < EFFECTIVE_BUFFER_SIZE; i++) rt.mem.write8(BUF + i, 0xee);
    return { rt, recFor, host: { definitionRecord: recFor } };
}

/** `block` maps even byte offsets inside the copied 0x2C block to u16 values. */
function seedSlot(rt, slot, block, keys) {
    const save = (SAVE_CONTEXT + slot * ROSTER_SLOT_STRIDE) >>> 0;
    for (let i = 0; i < EFFECTIVE_BUFFER_SIZE; i++) rt.mem.write8(save + EFFECTIVE_SRC_OFFSET + i, 0);
    for (const [off, value] of Object.entries(block)) {
        rt.mem.write16(save + EFFECTIVE_SRC_OFFSET + Number(off), value & 0xffff);
    }
    const statBase = (DIGIMON_CUR_STATS + slot * ROSTER_SLOT_STRIDE) >>> 0;
    for (let i = 0; i < EQUIPPED_KEY_COUNT; i++) {
        rt.mem.write16(statBase + EQUIPPED_KEY_OFFSET + i * 2, keys[i] ?? 0);
    }
}

function bufBytes(rt) {
    const out = [];
    for (let i = 0; i < EFFECTIVE_BUFFER_SIZE; i++) out.push(rt.mem.read8(BUF + i));
    return out;
}

/** A definition block: charisma at +0, two amounts at +6/+8, family extras. */
function defFieldsFor(family, o = {}) {
    const f = {
        0x0: o.charisma ?? 0,
        0x6: o.amount0 ?? 0,
        0x8: o.amount1 ?? 0,
        0xa: o.bonusA ?? 0,
        0xc: o.bonusB ?? 0,
    };
    f.bytes = {
        0x8: o.code21 ?? 0,
        0xa: o.code15 ?? 0,
        0xb: o.code15b ?? 0,
        0xc: o.code2 ?? 0,
        0xd: o.code2b ?? 0,
    };
    void family;
    return f;
}

// One guard is provably equivalent in-domain and a mutation sweep cannot see it:
// testing the clamp as `>= 999` instead of `>= 1000` stores 999 over a value
// that is already 999, so the buffer is identical for every input. The oracle
// keeps the original's `>= 1000` form.
const CASES = [
    { name: "no keys", block: {}, keys: [] },
    { name: "family 2 block", block: {}, keys: [5],
      records: { 5: { family: 2, fields: defFieldsFor(2, { charisma: 7, amount0: 3, code2: 1, amount1: 4, code2b: 2, bonusA: 10 }) } } },
    { name: "family 15 block", block: {}, keys: [6],
      records: { 6: { family: 15, fields: defFieldsFor(15, { charisma: 5, bonusB: 12, amount0: 2, code15: 3, amount1: 9, code15b: 4 }) } } },
    { name: "family 21 block", block: {}, keys: [7],
      records: { 7: { family: 21, fields: defFieldsFor(21, { charisma: 4, amount0: -2, code21: 5 }) } } },
    { name: "family outside the ladder", block: {}, keys: [8],
      records: { 8: { family: 30, fields: defFieldsFor(30, { charisma: 9, amount0: 9, code2: 1 }) } } },
    { name: "code 7 adds to all six", block: {}, keys: [9],
      records: { 9: { family: 2, fields: defFieldsFor(2, { charisma: 1, bonusA: 1, amount0: 5, code2: 7 }) } } },
    { name: "element code writes +0x18", block: {}, keys: [10],
      records: { 10: { family: 2, fields: defFieldsFor(2, { charisma: 1, bonusA: 1, amount0: 6, code2: 8 }) } } },
    { name: "codes outside the map do nothing", block: {}, keys: [11],
      records: { 11: { family: 2, fields: defFieldsFor(2, { charisma: 1, bonusA: 1, amount0: 6, code2: 21, amount1: 6, code2b: 7 }) } } },
    { name: "clamps at 999", block: { 0x0c: 990, 0x0e: 995, 0x16: 998 }, keys: [5],
      records: { 5: { family: 2, fields: defFieldsFor(2, { charisma: 999, amount0: 100, code2: 1, bonusA: 50 }) } } },
    { name: "floors subtract", block: { 0x0c: 3, 0x0e: 0, 0x14: 1, 0x26: 10, 0x28: 10, 0x2a: 10 }, keys: [] },
    { name: "two keys stack", block: {}, keys: [5, 6],
      records: {
          5: { family: 2, fields: defFieldsFor(2, { charisma: 2, bonusA: 3, amount0: 1, code2: 1 }) },
          6: { family: 21, fields: defFieldsFor(21, { charisma: 3, amount0: 2, code21: 2 }) },
      } },
    { name: "negative key skipped", block: {}, keys: [-3, 5],
      records: { 5: { family: 2, fields: defFieldsFor(2, { charisma: 1, bonusA: 1, amount0: 1, code2: 1 }) } } },
    { name: "duplicate key folds twice", block: {}, keys: [5, 5],
      records: { 5: { family: 2, fields: defFieldsFor(2, { charisma: 1, bonusA: 1, amount0: 1, code2: 1 }) } } },
    { name: "zero key folds its record", block: {}, keys: [0, 5],
      records: {
          0: { family: 2, fields: defFieldsFor(2, { charisma: 2, bonusA: 2, amount0: 2, code2: 2 }) },
          5: { family: 2, fields: defFieldsFor(2, { charisma: 1, bonusA: 1, amount0: 1, code2: 1 }) },
      } },
    { name: "family 14 boundary", block: {}, keys: [12],
      records: { 12: { family: 14, fields: defFieldsFor(14, { charisma: 3, bonusA: 1, amount0: 1, code2: 3 }) } } },
    { name: "family 20 boundary", block: {}, keys: [13],
      records: { 13: { family: 20, fields: defFieldsFor(20, { charisma: 3, bonusB: 1, amount0: 1, code15: 3 }) } } },
    { name: "family 24 boundary", block: {}, keys: [14],
      records: { 14: { family: 24, fields: defFieldsFor(24, { charisma: 3, amount0: 1, code21: 4 }) } } },
    { name: "helper code 6 writes charisma", block: {}, keys: [15],
      records: { 15: { family: 2, fields: defFieldsFor(2, { charisma: 1, bonusA: 1, amount0: 7, code2: 6 }) } } },
    { name: "helper code 14 writes the last element", block: {}, keys: [16],
      records: { 16: { family: 2, fields: defFieldsFor(2, { charisma: 1, bonusA: 1, amount0: 8, code2: 14 }) } } },
    { name: "floors with distinct amounts", block: { 0x0c: 30, 0x0e: 3, 0x14: 1, 0x26: 10, 0x28: 5, 0x2a: 1 }, keys: [] },
];

// The signature-set cases need the SHIPPED set table's ids for a slot, so they
// are built at test time from the loaded image (never hard-coded).
function signatureCases() {
    const probe = scenario().rt;
    const slot = 1; // a non-zero slot so the per-slot table strides are exercised
    const set = [];
    for (let i = 0; i < 4; i++) set.push(probe.mem.read16(SIGNATURE_SET_TABLE + slot * 8 + i * 2) | 0);
    const bonus = [];
    for (let i = 0; i < 6; i++) bonus.push(probe.mem.read16(SIGNATURE_BONUS_TABLE + slot * 12 + i * 2) | 0);
    // the ids must still resolve to records, so give each one an empty family
    const records = {};
    for (const id of set) records[id] = { family: 0, fields: defFieldsFor(0, {}) };
    // slot 1's set ids may be smaller than 1; keep the lookup key valid
    return [
        { name: "signature set complete adds the bonus", slot, block: {}, keys: set, records },
        { name: "three of four adds nothing", slot, block: {}, keys: [set[0], set[1], set[2], 0x7fff], records },
        { name: "bonus is not clamped", slot, block: { 0x0c: 995 }, keys: set, records, expectBonus: bonus[0] },
    ];
}

test("buildEffectiveStats matches F0x80017174", () => {
    for (const tc of [...CASES, ...signatureCases()]) {
        const slot = tc.slot ?? 0;
        const a = scenario();
        seedRecords(a, tc.records);
        seedSlot(a.rt, slot, tc.block, tc.keys);
        a.rt.cpu.call(0x80017174, [slot, BUF]);

        const b = scenario();
        seedRecords(b, tc.records);
        seedSlot(b.rt, slot, tc.block, tc.keys);
        buildEffectiveStats(b.rt.mem, b.host, slot, BUF);

        assert.deepEqual(bufBytes(b.rt), bufBytes(a.rt), tc.name);
        if (tc.expectBonus !== undefined) {
            // the bonus really moved the first stat past the ordinary cap
            const word = b.rt.mem.read16(BUF + 0xc);
            assert.equal(word, (995 + tc.expectBonus) & 0xffff, `${tc.name} unclamped bonus`);
            assert.ok(word > 999, `${tc.name} crossed the cap`);
        }
    }
    // and the complete-set case is not vacuous
    const complete = signatureCases().find((c) => c.name.startsWith("signature set complete"));
    const check = scenario();
    seedRecords(check, complete.records);
    seedSlot(check.rt, complete.slot, complete.block, complete.keys);
    buildEffectiveStats(check.rt.mem, check.host, complete.slot, BUF);
    assert.notEqual(check.rt.mem.read16(BUF + 0x16), 0, "the bonus reached charisma");
});
