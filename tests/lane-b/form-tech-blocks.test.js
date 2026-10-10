// Lane B oracle: engine/dw3/form-tech-blocks.ts must match the original EXE
// routine family behind [0x8004B46C] / [0x8004B478] / [0x8004B47C] /
// [0x8004B480] — the per-species technique blocks a roster slot carries, which
// the battle Digivolve form panel's pages one and two read.
//
// The originals run through engine/native (the interpreter) as the oracle over
// the same seeded roster slot; only the species-record lookup [0x8005CCA0] is
// stubbed, because that is the one resident service F0x80017924 calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    equippedFormsAddress, findFormTechBlock, formTechBlockAddress, readEquippedForms,
    readFormTechBlock, registerFormTechBlock, TECH_BLOCK_SIZE, writeFormTechBlock,
} from "../../engine/dw3/form-tech-blocks.ts";
import { ROSTER_SLOT_STRIDE, SAVE_CONTEXT } from "../../engine/dw3/form-ledger.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SPECIES_STUB = 0x0fdd0100;
const SPECIES_CELL = 0x8005cca0;
const DEST = 0x80170000;
const SRC = 0x80171000;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry,
        { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 }, undefined, undefined, 0x80082cb0,
        { image: resident, base: 0x80010000 });
    // The species record's address is what F0x80017924 stores its low byte from;
    // the walker stores the form level there instead (see the module header), so
    // the stub answers 0 and both sides are compared with level 0.
    rt.cpu.setStub(SPECIES_STUB, () => 0);
    rt.mem.write32(SPECIES_CELL, SPECIES_STUB);
    for (let i = 0; i < 0x40; i++) rt.mem.write32(DEST + i, 0xcccc);
    return rt;
}

/** Seed one roster slot's equipped triple and its technique blocks. */
function seedSlot(rt, slot, equipped, blocks) {
    const base = (SAVE_CONTEXT + slot * ROSTER_SLOT_STRIDE) >>> 0;
    // Zero the whole record: the equipped triple sits at +0x7B0 and the ledger
    // runs +0x7B8 .. +0xB28, so a shorter clear would leave the previous case's
    // entries in place.
    for (let i = 0; i < 0xb30; i++) rt.mem.write8(base + i, 0);
    for (let i = 0; i < 3; i++) rt.mem.write16(equippedFormsAddress(slot) + i * 2, equipped[i] ?? 0xffff);
    blocks.forEach((block, index) => {
        const at = formTechBlockAddress(slot, index);
        rt.mem.write16(at + 0x00, block.species & 0xffff);
        rt.mem.write8(at + 0x02, block.level ?? 0);
        rt.mem.write32(at + 0x04, block.dvexp ?? 0);
        for (let i = 0; i < 6; i++) rt.mem.write16(at + 0x08 + i * 2, (block.techs?.[i] ?? 0) & 0xffff);
    });
}

const destBytes = (rt) => Array.from({ length: TECH_BLOCK_SIZE }, (_, i) => rt.mem.read8(DEST + i));

test("findFormTechBlock matches F0x8001764C", () => {
    const rt = runtime();
    for (const c of [
        { name: "first block", blocks: [{ species: 0x30 }, { species: 0x50 }], species: 0x30 },
        { name: "second block", blocks: [{ species: 0x30 }, { species: 0x50 }], species: 0x50 },
        { name: "missing", blocks: [{ species: 0x30 }], species: 0x60 },
        { name: "empty table", blocks: [], species: 0x30 },
        // A stored id below 3 is a free slot and never matches.
        { name: "placeholder id", blocks: [{ species: 2 }, { species: 0x50 }], species: 2 },
        { name: "search a placeholder", blocks: [{ species: 2 }, { species: 0x50 }], species: 1 },
        { name: "negative species", blocks: [{ species: 0xffff }], species: -1 },
        // 44 blocks is the scan's bound.
        {
            name: "last of forty four",
            blocks: Array.from({ length: 44 }, (_, i) => ({ species: 3 + i })),
            species: 46,
        },
        {
            name: "beyond the table",
            blocks: Array.from({ length: 44 }, (_, i) => ({ species: 3 + i })),
            species: 47,
        },
    ]) {
        seedSlot(rt, 1, [], c.blocks);
        const original = rt.cpu.call(0x8001764c, [1, c.species]);
        const port = findFormTechBlock(rt.mem, 1, c.species);
        assert.equal(port, original | 0, c.name);
    }
});

test("readFormTechBlock matches F0x80017A1C", () => {
    const rt = runtime();
    const block = {
        species: 0x50, level: 7, dvexp: 0x1234,
        techs: [0x8005, 0x4001, 0x4002, 0, 0x1234, 0x4321],
    };
    for (const c of [
        { name: "one block", blocks: [block], species: 0x50 },
        { name: "among three", blocks: [{ species: 0x30 }, block, { species: 0x60 }], species: 0x50 },
        // A miss answers -1 and leaves the caller's buffer alone, so the panel
        // prints a stale headline instead of the row's own.
        { name: "missing leaves dest", blocks: [{ species: 0x30 }], species: 0x50 },
    ]) {
        seedSlot(rt, 0, [], c.blocks);
        for (let i = 0; i < 0x40; i++) rt.mem.write32(DEST + i, 0xcccc);
        rt.cpu.call(0x80017a1c, [0, c.species, DEST]);
        const original = destBytes(rt);
        seedSlot(rt, 0, [], c.blocks);
        for (let i = 0; i < 0x40; i++) rt.mem.write32(DEST + i, 0xcccc);
        const index = readFormTechBlock(rt.mem, 0, c.species, DEST);
        assert.deepEqual(destBytes(rt), original, `${c.name}: bytes`);
        if (c.name === "missing leaves dest") assert.equal(index, -1);
    }
});

test("readEquippedForms matches F0x800176AC", () => {
    const rt = runtime();
    for (const c of [
        { name: "all three", equipped: [0x30, 0x50, 0x60], blocks: [{ species: 0x30 }, { species: 0x50 }, { species: 0x60 }] },
        { name: "one resolves", equipped: [0x30, 0x50, 0x60], blocks: [{ species: 0x50 }] },
        { name: "none resolve", equipped: [0x30, 0x50, 0x60], blocks: [] },
        // An equipped id below 3 is not a form at all.
        { name: "placeholder equipped", equipped: [2, 0x50, 0], blocks: [{ species: 0x50 }] },
        // The block's own species halfword is tested again, and 0xFFFF fails.
        { name: "block species below three", equipped: [0x30, 0x50, 0], blocks: [{ species: 2 }] },
        { name: "empty slot", equipped: [0xffff, 0xffff, 0xffff], blocks: [{ species: 0x30 }] },
        { name: "two of three", equipped: [0x30, 0x50, 0x60], blocks: [{ species: 0x30 }, { species: 0x60 }] },
    ]) {
        seedSlot(rt, 2, c.equipped, c.blocks);
        const original = rt.cpu.call(0x800176ac, [2, DEST]);
        const originalTriple = [0, 1, 2].map((i) => rt.mem.read16(DEST + i * 2));
        seedSlot(rt, 2, c.equipped, c.blocks);
        for (let i = 0; i < 8; i++) rt.mem.write32(DEST + i, 0xcccc);
        const count = readEquippedForms(rt.mem, 2, DEST);
        assert.deepEqual([0, 1, 2].map((i) => rt.mem.read16(DEST + i * 2)), originalTriple, `${c.name}: triple`);
        assert.equal(count, original | 0, `${c.name}: count`);
    }
});

test("writeFormTechBlock matches F0x80017AB4", () => {
    const rt = runtime();
    const fill = () => {
        seedSlot(rt, 0, [], [{ species: 0x30, level: 1 }, { species: 0x50, level: 2 }]);
        for (let i = 0; i < 10; i++) rt.mem.write16(SRC + i * 2, 0x1000 + i);
    };
    fill();
    rt.cpu.call(0x80017ab4, [0, 0x50, SRC]);
    const after = Array.from({ length: 0x14 }, (_, i) => rt.mem.read16(formTechBlockAddress(0, 1) + i));
    fill();
    assert.equal(writeFormTechBlock(rt.mem, 0, 0x50, SRC), 1);
    assert.deepEqual(
        Array.from({ length: 0x14 }, (_, i) => rt.mem.read16(formTechBlockAddress(0, 1) + i)), after,
    );
    // A form that is not in the ledger is not written at all.
    fill();
    assert.equal(writeFormTechBlock(rt.mem, 0, 0x60, SRC), -1);
});

test("registerFormTechBlock matches F0x80017924", () => {
    const rt = runtime();
    for (const c of [
        { name: "claims the first free entry", blocks: [{ species: 0x30 }], species: 0x50 },
        { name: "claims after a gap", blocks: [{ species: 0 }, { species: 0x50 }], species: 0x60 },
        { name: "already acquired", blocks: [{ species: 0x30 }], species: 0x30 },
        { name: "ledger full", blocks: Array.from({ length: 44 }, (_, i) => ({ species: 3 + i })), species: 0x99 },
    ]) {
        seedSlot(rt, 1, [], c.blocks);
        const original = rt.cpu.call(0x80017924, [1, c.species]);
        const originalEntries = Array.from({ length: 44 }, (_, i) =>
            rt.mem.read16(formTechBlockAddress(1, i)));
        seedSlot(rt, 1, [], c.blocks);
        const port = registerFormTechBlock(rt.mem, 1, c.species);
        assert.deepEqual(
            Array.from({ length: 44 }, (_, i) => rt.mem.read16(formTechBlockAddress(1, i))),
            originalEntries, `${c.name}: ledger`);
        assert.equal(port, original | 0, `${c.name}: answer`);
    }
    // A freshly acquired form starts at level 1, which is the byte the Digivolve
    // panel prints as its headline.
    seedSlot(rt, 0, [], []);
    registerFormTechBlock(rt.mem, 0, 0x50);
    assert.equal(rt.mem.read8(formTechBlockAddress(0, 0) + 0x02), 1);
});