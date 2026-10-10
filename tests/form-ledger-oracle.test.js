// Phase 4 oracle: engine/dw3/form-ledger.ts must reproduce the equipped-form
// matcher F0x8001764C and validator F0x800176AC. Both run on the same seeded
// save context through engine/native, and the emitted buffer plus the returned
// count are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    EQUIPPED_FORM_BASE,
    FORM_ENTRY_BASE,
    FORM_ENTRY_COUNT,
    FORM_ENTRY_STRIDE,
    ROSTER_SLOT_STRIDE,
    SAVE_CONTEXT,
    findFormLedgerIndex,
    validateEquippedForm,
} from "../engine/dw3/form-ledger.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OUT = 0x801fa000;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** Seed one roster slot's form triple and ledger entries. */
function seedSlot(rt, slot, forms, entries) {
    const base = (SAVE_CONTEXT + slot * ROSTER_SLOT_STRIDE) >>> 0;
    for (let i = 0; i < 3; i++) rt.mem.write16(base + EQUIPPED_FORM_BASE + i * 2, forms[i] & 0xffff);
    for (let i = 0; i < FORM_ENTRY_COUNT; i++) {
        const at = base + FORM_ENTRY_BASE + i * FORM_ENTRY_STRIDE;
        const id = i < entries.length ? entries[i] : 0;
        rt.mem.write16(at, id & 0xffff);
        // give each entry a distinct "name" word the validator must not copy
        rt.mem.write16(at + 2, (0x100 + i) & 0xffff);
    }
}

function outWords(rt) {
    return [rt.mem.read16(OUT), rt.mem.read16(OUT + 2), rt.mem.read16(OUT + 4)];
}

function clearOut(rt) {
    for (let i = 0; i < 3; i++) rt.mem.write16(OUT + i * 2, 0xdead);
}

// Two guards in the validator are dead in-domain and a mutation sweep cannot
// observe them: the matcher never returns an index for a form below 3 (it skips
// those ids), so "accept empty forms" changes nothing, and it never returns an
// entry whose own id is below 3, so "accept empty entries" changes nothing. The
// oracle keeps them because the original executes them.
const CASES = [
    { name: "all three resolve", slot: 0, forms: [5, 9, 12], entries: [5, 7, 9, 12] },
    { name: "form below three skipped", slot: 1, forms: [2, 9, 0], entries: [9] },
    { name: "form not in the ledger", slot: 2, forms: [0x40, 0x41, 0x42], entries: [3, 4] },
    { name: "entry id below three rejected", slot: 3, forms: [5, 6, 7], entries: [5, 0, 0, 7] },
    { name: "empty ledger", slot: 4, forms: [5, 6, 7], entries: [] },
    { name: "late entry index", slot: 5, forms: [0x30], entries: new Array(0x2a).fill(0).concat([0x30]) },
    { name: "last ledger entry", slot: 8, forms: [0x44], entries: new Array(0x2b).fill(0).concat([0x44]) },
    { name: "duplicate forms", slot: 6, forms: [8, 8, 8], entries: [8, 0, 0, 0, 0, 0, 0, 8] },
    { name: "high bit id", slot: 7, forms: [0x8000], entries: [0x8000] },
];

test("validateEquippedForm matches F0x800176AC", () => {
    for (const tc of CASES) {
        const a = runtime();
        seedSlot(a, tc.slot, tc.forms, tc.entries);
        clearOut(a);
        const retA = a.cpu.call(0x800176ac, [tc.slot, OUT]) | 0;
        const wordsA = outWords(a);

        const b = runtime();
        seedSlot(b, tc.slot, tc.forms, tc.entries);
        clearOut(b);
        const retB = validateEquippedForm(b.mem, tc.slot, OUT) | 0;
        const wordsB = outWords(b);

        assert.equal(retB, retA, `${tc.name} count`);
        assert.deepEqual(wordsB, wordsA, `${tc.name} emitted buffer`);
        assert.ok(retA >= 0 && retA <= 3, `${tc.name} count in range`);
        // padding really is 0xffff past the count
        for (let k = retA; k < 3; k++) assert.equal(wordsA[k], 0xffff, `${tc.name} pad ${k}`);
    }
});

test("findFormLedgerIndex matches F0x8001764C", () => {
    const a = runtime();
    seedSlot(a, 2, [3, 4, 5], [0, 0, 0x11, 0x12, 0x13]);
    for (const form of [0x11, 0x12, 0x13, 0x14, 0, 1, 2, 0x8000]) {
        const orig = a.cpu.call(0x8001764c, [2, form]) | 0;
        const port = findFormLedgerIndex(a.mem, 2, form) | 0;
        assert.equal(port, orig, `form=0x${(form >>> 0).toString(16)}`);
    }
    assert.equal(a.cpu.call(0x8001764c, [2, 0x12]) | 0, 3, "third entry found");
    assert.equal(a.cpu.call(0x8001764c, [2, 0x99]) | 0, -1, "absent form is -1");
    // the walk covers all 0x2C ledger entries, including the last
    const last = runtime();
    seedSlot(last, 0, [0x55, 0, 0], new Array(FORM_ENTRY_COUNT - 1).fill(0).concat([0x55]));
    assert.equal(last.cpu.call(0x8001764c, [0, 0x55]) | 0, FORM_ENTRY_COUNT - 1, "last entry index");
    assert.equal(findFormLedgerIndex(last.mem, 0, 0x55) | 0, FORM_ENTRY_COUNT - 1);
});
