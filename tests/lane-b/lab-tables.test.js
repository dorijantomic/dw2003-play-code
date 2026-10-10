// Oracle: engine/dw3/ui/native/lab-tables.ts must match the original pro/stgdglab species lookups
// F0x8008F3D8 and F0x8008F424 over the shipped table and over edited copies of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKit, overlayImage } from "./gym-kit.js";
import { labSpeciesWord1, labSpeciesWord2, LAB_SPECIES_TABLE } from "../../engine/dw3/ui/native/lab-tables.ts";

const kit = createKit(overlayImage("pro_stgdglab.bin"));
const keys = [];
for (let a = LAB_SPECIES_TABLE; kit.mem.read16s(a) !== 0; a += 6) keys.push(kit.mem.read16s(a));

test("the shipped table has the 52 listed forms", () => { assert.equal(keys.length, 52); });

test("both lookups match the originals for every listed key and for misses", () => {
    const probes = [...keys, 0, 1, 2, -1, 0x7fff, 0x10000 + keys[0], 0xffff, 400, 0x8000];
    for (const key of probes) {
        for (const [addr, port] of [[0x8008f3d8, labSpeciesWord1], [0x8008f424, labSpeciesWord2]]) {
            const original = kit.call(addr, [key]);
            assert.equal(port(kit.mem, key), original, `${addr.toString(16)}(${key})`);
        }
    }
});

test("an empty table (first key zero) answers 0 from both", () => {
    const saved = kit.mem.read16(LAB_SPECIES_TABLE);
    kit.mem.write16(LAB_SPECIES_TABLE, 0);
    for (const key of [0, keys[0], keys[1]]) {
        assert.equal(kit.call(0x8008f3d8, [key]), 0);
        assert.equal(labSpeciesWord1(kit.mem, key), 0);
        assert.equal(labSpeciesWord2(kit.mem, key), 0);
    }
    kit.mem.write16(LAB_SPECIES_TABLE, saved);
});

test("a key past an early terminator is not found", () => {
    const row = LAB_SPECIES_TABLE + 6 * 3;
    const saved = kit.mem.read16(row);
    kit.mem.write16(row, 0);
    for (const key of keys.slice(2, 8)) {
        assert.equal(labSpeciesWord1(kit.mem, key), kit.call(0x8008f3d8, [key]));
        assert.equal(labSpeciesWord2(kit.mem, key), kit.call(0x8008f424, [key]));
    }
    kit.mem.write16(row, saved);
});
