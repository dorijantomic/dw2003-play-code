// Phase 4 oracle: engine/dw3/form-ledger-edit.ts must reproduce the resident
// form-ledger writers F0x800177D0, F0x80017898, F0x80017924 and F0x80017AB4 (the
// fight report's reward services call them through the save context's slot
// table). Both sides run on the same seeded save context through engine/native
// (the original executes the resident image, matcher included) and every ledger
// byte, the emitted buffers and the return values are compared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    EQUIPPED_FORM_BASE, FORM_ENTRY_BASE, FORM_ENTRY_COUNT, FORM_ENTRY_STRIDE, ROSTER_SLOT_STRIDE, SAVE_CONTEXT,
} from "../engine/dw3/form-ledger.ts";
import { acquiredForms, addForm, setEquippedForms, writeFormEntry } from "../engine/dw3/form-ledger-edit.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const IN = 0x801fa000;
const OUT = 0x801fa100;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** A deterministic ledger with distinctive words in every entry field. */
function seed(rt, slot, ids, equipped = [0, 0, 0]) {
    const base = (SAVE_CONTEXT + slot * ROSTER_SLOT_STRIDE) >>> 0;
    for (let i = 0; i < 3; i++) rt.mem.write16(base + EQUIPPED_FORM_BASE + i * 2, equipped[i] & 0xffff);
    for (let i = 0; i < FORM_ENTRY_COUNT; i++) {
        const at = base + FORM_ENTRY_BASE + i * FORM_ENTRY_STRIDE;
        for (let w = 0; w < 5; w++) rt.mem.write32(at + w * 4, (0x11110000 * (w + 1) + i * 7 + w) >>> 0);
        rt.mem.write16(at, (ids[i] ?? 0) & 0xffff);
    }
    for (let i = 0; i < 0x30; i += 4) { rt.mem.write32(IN + i, 0xa5a5a5a5); rt.mem.write32(OUT + i, 0xdeadbeef); }
}

function snapshot(rt, slot) {
    const base = (SAVE_CONTEXT + slot * ROSTER_SLOT_STRIDE) >>> 0;
    const out = [];
    for (let i = 0; i < 0x40; i++) out.push(rt.mem.read16(base + EQUIPPED_FORM_BASE + i * 2));
    for (let i = 0; i < FORM_ENTRY_COUNT * FORM_ENTRY_STRIDE; i += 4) out.push(rt.mem.read32(base + FORM_ENTRY_BASE + i) >>> 0);
    for (let i = 0; i < 0x60; i += 4) out.push(rt.mem.read32(IN + i) >>> 0, rt.mem.read32(OUT + i) >>> 0);
    return out;
}

const LEDGERS = [
    { slot: 0, ids: [] },
    { slot: 1, ids: [5, 7, 9, 12] },
    { slot: 2, ids: [0x8000, 2, 3, 0, 0x30, 0x30] },
    { slot: 3, ids: new Array(FORM_ENTRY_COUNT).fill(0).map((_, i) => 3 + i) },
    { slot: 4, ids: new Array(FORM_ENTRY_COUNT - 1).fill(0).map((_, i) => 0x20 + i) },
    { slot: 5, ids: [0, 0, 0, 0x41] },
    // slot 7, the disc's last: slots 8.. are the new partners' own record window
    // (engine/dw3/roster-records.ts), not the memory after the disc's array
    { slot: 7, ids: [1, 2, 0x44, 0, 0x45] },
];

test("setEquippedForms matches F0x800177D0", () => {
    const inputs = [[5, 9, 12], [0x44, 0x45, 0x99], [0, 1, 2], [0x8000, 3, 0x30], [7, 7, 7], [0xffff, 0x21, 0x22]];
    for (const led of LEDGERS) {
        for (const input of inputs) {
            const a = runtime(); seed(a, led.slot, led.ids, [1, 2, 3]);
            input.forEach((f, i) => a.mem.write16(IN + i * 2, f & 0xffff));
            a.cpu.call(0x800177d0, [led.slot, IN]);
            const b = runtime(); seed(b, led.slot, led.ids, [1, 2, 3]);
            input.forEach((f, i) => b.mem.write16(IN + i * 2, f & 0xffff));
            setEquippedForms(b.mem, led.slot, IN);
            assert.deepEqual(snapshot(b, led.slot), snapshot(a, led.slot), `slot ${led.slot} input ${input}`);
        }
    }
});

test("acquiredForms matches F0x80017898", () => {
    for (const led of LEDGERS) {
        const a = runtime(); seed(a, led.slot, led.ids);
        const countA = a.cpu.call(0x80017898, [led.slot, OUT]) | 0;
        const b = runtime(); seed(b, led.slot, led.ids);
        const countB = acquiredForms(b.mem, led.slot, OUT) | 0;
        assert.equal(countB, countA, `slot ${led.slot} count`);
        assert.deepEqual(snapshot(b, led.slot), snapshot(a, led.slot), `slot ${led.slot} buffer`);
    }
});

test("addForm matches F0x80017924", () => {
    for (const led of LEDGERS) {
        for (const form of [0x10, 0x30, 0x44, 5, 3, 0x8001, 0]) {
            const a = runtime(); seed(a, led.slot, led.ids);
            const retA = a.cpu.call(0x80017924, [led.slot, form]) | 0;
            const b = runtime(); seed(b, led.slot, led.ids);
            const retB = addForm(b.mem, led.slot, form) | 0;
            assert.equal(retB, retA, `slot ${led.slot} form ${form} return`);
            assert.deepEqual(snapshot(b, led.slot), snapshot(a, led.slot), `slot ${led.slot} form ${form}`);
        }
    }
});

test("writeFormEntry matches F0x80017AB4", () => {
    for (const led of LEDGERS) {
        for (const form of [5, 9, 0x30, 0x44, 0x99, 0x8000, 1]) {
            const a = runtime(); seed(a, led.slot, led.ids);
            const b = runtime(); seed(b, led.slot, led.ids);
            for (const rt of [a, b]) for (let w = 0; w < 6; w++) rt.mem.write32(IN + w * 4, (0x01020304 * (w + 1)) >>> 0);
            const retA = a.cpu.call(0x80017ab4, [led.slot, form, IN]) | 0;
            const retB = writeFormEntry(b.mem, led.slot, form, IN) | 0;
            assert.equal(retB, retA, `slot ${led.slot} form ${form} return`);
            assert.deepEqual(snapshot(b, led.slot), snapshot(a, led.slot), `slot ${led.slot} form ${form}`);
        }
    }
});
