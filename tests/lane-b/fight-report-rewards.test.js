// Lane B oracle: engine/dw3/ui/native/fight-report-rewards.ts must match the
// original pro/stfgtrep reward services (F0x80086184 / F0x80085E3C level curve,
// F0x8008634C evolution unlock, F0x800865C0 DV ladder, F0x8008670C /
// F0x80086844 technique learning, F0x80086924 DVEXP gain).
//
// The original runs through engine/native with the REAL resident image, so its
// record getters, ledger matcher/writers and profile lookup execute too; the port
// runs the same chain through engine/dw3 ports. Both sides start from the same
// seeded save context, use the same 16-bit random stream, and every byte of the
// slot's roster record, the save-context words the services touch and the return
// value are compared. The overlay's own data tables are the shipped ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    reportAddExperience, reportDvGain, reportDvLadder, reportLearnTechnique, reportLevelUp,
    reportMakeLoadable, reportUnlockForm, REWARD_EVOLUTION_GROUPS,
} from "../../engine/dw3/ui/native/fight-report-rewards.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SAVE = 0x80048d34;
const RECORDS = 0x80049494;
const STRIDE = 0x3dc;
const SCRATCH = 0x801fa000;
const PROFILES = 0x8003ef5c;

let stream = 1;
const rand = () => {
    stream = (Math.imul(stream, 1103515245) + 12345) >>> 0;
    return (stream >>> 8) & 0xffff;
};
function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => rand() },
        undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}
const A = runtime();
const B = runtime();

/** A small deterministic generator for the seeds (separate from the service stream). */
function makeGen(seed) {
    let s = seed >>> 0;
    return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) % n; };
}

const formValueOfProfile = (k) => A.mem.read16(PROFILES + k * 0x58);

/** Seed one roster slot's record with pseudo-random content and a ledger of real form values. */
function seedSlot(rt, slot, gen, opts = {}) {
    const rec = RECORDS + slot * STRIDE;
    for (let i = 0; i < STRIDE; i += 2) rt.mem.write16(rec + i, gen(0x10000));
    rt.mem.write32(rec + 0x20, opts.exp ?? gen(300000));
    rt.mem.write16(rec + 0x24, opts.level ?? 1 + gen(99));
    rt.mem.write16(rec + 0x26, opts.tp ?? gen(120));
    for (let k = 0; k < 6; k++) rt.mem.write16(rec + 0x30 + k * 2, gen(1200) - 100);
    for (let k = 0; k < 7; k++) rt.mem.write16(rec + 0x3c + k * 2, gen(1200) - 100);
    rt.mem.write16(rec + 0x2a, gen(11000)); rt.mem.write16(rec + 0x2e, gen(11000));
    // form ledger: 0x2C entries of 0x14 bytes at record+0x58; equipped triple at +0x50
    const forms = opts.forms ?? [];
    for (let i = 0; i < 0x2c; i++) {
        const at = rec + 0x58 + i * 0x14;
        for (let w = 0; w < 5; w++) rt.mem.write32(at + w * 4, 0);
        if (i < forms.length) {
            rt.mem.write16(at, forms[i]);
            rt.mem.write8(at + 2, opts.formLevels?.[i] ?? 1 + gen(60));
            rt.mem.write8(at + 3, 1);
            rt.mem.write32(at + 4, opts.dvexp?.[i] ?? gen(3000));
            for (let t = 0; t < 6; t++) rt.mem.write16(at + 8 + t * 2, opts.tech?.[i]?.[t] ?? 0);
        }
    }
    for (let i = 0; i < 3; i++) rt.mem.write16(rec + 0x50 + i * 2, forms[i] ?? 0xffff);
}

function slotBytes(rt, slot) {
    const out = [];
    const rec = RECORDS + slot * STRIDE;
    for (let i = 0; i < STRIDE; i += 4) out.push(rt.mem.read32(rec + i) >>> 0);
    return out;
}

/** Run the original and the port from identical seeds; compare return value and the whole record. */
function compare(label, slot, seedFn, original, port, streamSeed = 7) {
    seedFn(A); seedFn(B);
    stream = streamSeed;
    const a = original(A);
    const before = stream;
    stream = streamSeed;
    const b = port(B);
    assert.equal(b, a, `${label}: return`);
    assert.equal(stream, before, `${label}: random draws`);
    assert.deepEqual(slotBytes(B, slot), slotBytes(A, slot), `${label}: record`);
    return a;
}

const host = () => ({ rand, scratch: SCRATCH });
const BUDGET = 4_000_000;

test("reportLevelUp matches F0x80085E3C across brackets and species", () => {
    for (let slot = 0; slot < 8; slot++) {
        for (const level of [1, 4, 5, 19, 20, 39, 40, 41, 59, 60, 79, 80, 99]) {
            const gen0 = 100 + slot * 7 + level;
            compare(`slot ${slot} level ${level}`, slot,
                (rt) => seedSlot(rt, slot, makeGen(gen0)),
                (rt) => { rt.cpu.call(0x80085e3c, [slot, level], BUDGET); return 0; },
                (rt) => { reportLevelUp(rt.mem, slot, level, host()); return 0; }, gen0);
        }
    }
});

test("reportAddExperience matches F0x80086184 (curve, cap, TP, level cap)", () => {
    let leveled = 0;
    for (let slot = 0; slot < 8; slot++) {
        for (const level of [1, 3, 4, 18, 19, 38, 39, 60, 97, 98, 99]) {
            for (const gain of [0, 1, 250, 3000, 45000, 400000, 2000000]) {
                const gen0 = 1000 + slot * 31 + level * 3 + gain;
                const r = compare(`slot ${slot} level ${level} gain ${gain}`, slot,
                    (rt) => seedSlot(rt, slot, makeGen(gen0), { level, exp: (level * level * level * 3) % 700000 }),
                    (rt) => rt.cpu.call(0x80086184, [slot, gain], BUDGET) | 0,
                    (rt) => reportAddExperience(rt.mem, slot, gain, host()) | 0, gen0);
                leveled += r;
            }
        }
    }
    assert.ok(leveled > 40, `the sweep must exercise level-ups (${leveled})`);
});

test("reportUnlockForm matches F0x8008634C on random ledgers", () => {
    let unlocked = 0;
    for (let slot = 0; slot < 8; slot++) {
        const group = A.mem.read32(REWARD_EVOLUTION_GROUPS + slot * 4) >>> 0;
        const rows = [];
        for (let p = group; p < group + 0x2c0; p += 0x10) rows.push(p);
        for (let trial = 0; trial < 60; trial++) {
            const gen = makeGen(slot * 1000 + trial);
            // ledger: forms named by this slot's rows (targets and prerequisites) plus filler
            const pool = [];
            for (const row of rows) {
                for (const off of [0, 4, 8]) {
                    const idx = off === 0 ? A.mem.read32(row) : A.mem.read16(row + off);
                    if (idx > 0 && idx <= 0x34) pool.push(formValueOfProfile(idx - 1));
                }
            }
            const forms = [];
            const count = 1 + gen(10);
            for (let i = 0; i < count && pool.length; i++) forms.push(pool[gen(pool.length)]);
            const unique = [...new Set(forms)];
            const opts = {
                forms: unique, formLevels: unique.map(() => 5 + gen(90)),
                level: 1 + gen(99),
            };
            const r = compare(`slot ${slot} trial ${trial}`, slot,
                (rt) => seedSlot(rt, slot, makeGen(slot * 77 + trial), opts),
                (rt) => rt.cpu.call(0x8008634c, [slot], BUDGET) | 0,
                (rt) => reportUnlockForm(rt.mem, slot, host()) | 0);
            if (r !== 0) unlocked++;
        }
    }
    assert.ok(unlocked > 5, `the sweep must exercise unlocks (${unlocked})`);
});

test("reportDvLadder matches F0x800865C0", () => {
    let gained = 0;
    for (let k = 0; k < 0x34; k += 3) {
        const form = formValueOfProfile(k);
        for (const level of [1, 2, 9, 10, 11, 49, 50, 60, 97, 98, 99, 100]) {
            for (const gain of [0, 5, 400, 5000, 300000, 9999999, -50]) {
                const slot = k % 8;
                const gen0 = k * 100 + level + gain;
                const r = compare(`form ${form} level ${level} gain ${gain}`, slot,
                    (rt) => seedSlot(rt, slot, makeGen(gen0), { forms: [form], formLevels: [level], dvexp: [(level * 37) % 900] }),
                    (rt) => rt.cpu.call(0x800865c0, [slot, form, gain], BUDGET) | 0,
                    (rt) => reportDvLadder(rt.mem, slot, form, gain, host()) | 0);
                gained += r;
            }
        }
    }
    assert.ok(gained > 20, `the sweep must exercise form levels (${gained})`);
});

test("reportLearnTechnique and reportMakeLoadable match F0x8008670C / F0x80086844", () => {
    let learned = 0;
    let loadable = 0;
    for (let k = 0; k < 0x34; k++) {
        const form = formValueOfProfile(k);
        const slot = k % 8;
        for (const level of [1, 8, 20, 35, 60, 99]) {
            for (const pattern of [[0, 0, 0, 0, 0, 0], [0x11, 0, 0, 0, 0, 0], [0x11, 0x12, 0x2013, 0, 0, 0],
                [0x8000 | 0x5, 0x2006, 0, 0x14, 0, 0], [1, 2, 3, 4, 5, 0], [0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x8007]]) {
                const gen0 = k * 13 + level;
                const opts = { forms: [form], formLevels: [level], tech: [pattern] };
                learned += compare(`learn form ${form} level ${level} ${pattern}`, slot,
                    (rt) => seedSlot(rt, slot, makeGen(gen0), opts),
                    (rt) => rt.cpu.call(0x8008670c, [slot, form], BUDGET) & 0xffff,
                    (rt) => reportLearnTechnique(rt.mem, slot, form, host()) & 0xffff) ? 1 : 0;
                loadable += compare(`loadable form ${form} level ${level} ${pattern}`, slot,
                    (rt) => seedSlot(rt, slot, makeGen(gen0), opts),
                    (rt) => rt.cpu.call(0x80086844, [slot, form], BUDGET) | 0,
                    (rt) => reportMakeLoadable(rt.mem, slot, form, host()) | 0) ? 1 : 0;
            }
        }
    }
    assert.ok(learned > 20 && loadable > 20, `the sweep must exercise both (${learned}, ${loadable})`);
});

test("reportDvGain matches F0x80086924", () => {
    for (let k = 0; k < 0x34; k += 2) {
        const form = formValueOfProfile(k);
        const slot = k % 8;
        for (const level of [1, 7, 32, 50, 51, 99]) {
            for (const formLevel of [1, 9, 40, 99]) {
                for (const score of [0, 1, 27, 268, 5000, 123456, -30]) {
                    for (const count of [-3, 0, 1, 2, 3, 5]) {
                        const gen0 = k + level + formLevel + score + count;
                        compare(`form ${form} lv ${level} fl ${formLevel} score ${score} count ${count}`, slot,
                            (rt) => seedSlot(rt, slot, makeGen(gen0), { level, forms: [form], formLevels: [formLevel] }),
                            (rt) => rt.cpu.call(0x80086924, [slot, form, score, count], BUDGET) | 0,
                            (rt) => reportDvGain(rt.mem, slot, form, score, count, host()) | 0);
                    }
                }
            }
        }
    }
});
