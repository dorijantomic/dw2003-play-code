// Phase 4 oracle: engine/dw3/save-header.ts must reproduce F0x80014930. The
// original runs through engine/native and the port on an identical image; the
// whole header block is compared, so anything either side touches (or leaves
// alone) shows up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { SAVE_HEADER_BLOCK, saveBuildHeader } from "../engine/dw3/save-header.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// Two mutations are provably equivalent in-domain and the sweep cannot see them:
// a zero-fill shortened to 0x70 leaves only +0x80..+0x8F untouched, and the
// struct-B copy overwrites exactly those bytes; and the count field at +0x314
// lies outside the filled region, so its store order does not matter.
const NAME = 0x80170000;
const STRUCT = 0x80170100;
const TABLE = 0x80170200;
const BLOCK_SPAN = 0x330;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seed(rt, { name, words }) {
    for (let i = 0; i < 0x80; i++) rt.mem.write8(NAME + i, 0);
    for (let i = 0; i < name.length; i++) rt.mem.write8(NAME + i, name.charCodeAt(i));
    for (let i = 0; i < 0x20; i++) rt.mem.write8(STRUCT + i, (0x40 + i) & 0xff);
    for (let i = 0; i < words.length; i++) rt.mem.write32(TABLE + i * 4, words[i] >>> 0);
    // a distinctive block so "left alone" is visible
    for (let i = 0; i < BLOCK_SPAN; i++) rt.mem.write8(SAVE_HEADER_BLOCK + i, 0xaa);
}

function blockWords(rt) {
    const out = [];
    for (let i = 0; i < BLOCK_SPAN; i += 4) out.push(rt.mem.read32(SAVE_HEADER_BLOCK + i) >>> 0);
    return out;
}

const CASES = [
    { name: "one word", label: "Digimon", words: [0x11223344], count: 1 },
    { name: "three words", label: "AB", words: [0x01020304, 0x05060708, 0x090a0b0c], count: 3 },
    { name: "count zero refuses", label: "Digimon", words: [0x11], count: 0 },
    { name: "count four refuses", label: "Digimon", words: [0x11], count: 4 },
    { name: "long name refuses", label: "x".repeat(0x41), words: [0x11], count: 1 },
    { name: "name of exactly 0x40", label: "y".repeat(0x40), words: [0x22], count: 2 },
    { name: "empty name", label: "", words: [0x33, 0x44], count: 2 },
];

test("saveBuildHeader matches F0x80014930", () => {
    for (const tc of CASES) {
        const a = runtime();
        seed(a, { name: tc.label, words: tc.words });
        a.rt = undefined;
        a.cpu.call(0x80014930, [NAME, STRUCT, tc.count, TABLE]);
        const wordsA = blockWords(a);

        const b = runtime();
        seed(b, { name: tc.label, words: tc.words });
        saveBuildHeader(b.mem, NAME, STRUCT, tc.count, TABLE);
        assert.deepEqual(blockWords(b), wordsA, `${tc.name} block`);
        if (tc.count >= 1 && tc.count <= 3 && tc.label.length < 0x41) {
            assert.notDeepEqual(blockWords(b), new Array(BLOCK_SPAN / 4).fill(0xaaaaaaaa), `${tc.name} wrote`);
            assert.equal(a.mem.read8(SAVE_HEADER_BLOCK + 0x10), 0x53, `${tc.name} 'S'`);
            assert.equal(a.mem.read8(SAVE_HEADER_BLOCK + 0x11), 0x43, `${tc.name} 'C'`);
            assert.equal(a.mem.read8(SAVE_HEADER_BLOCK + 0x13), 4, `${tc.name} version`);
            assert.equal(a.mem.read8(SAVE_HEADER_BLOCK + 0x12), tc.count | 0x10, `${tc.name} code byte`);
            // the name lands at +0x14, NUL included
            for (let i = 0; i < tc.label.length; i++) {
                assert.equal(b.mem.read8(SAVE_HEADER_BLOCK + 0x14 + i), tc.label.charCodeAt(i), `${tc.name} name byte ${i}`);
            }
            assert.equal(b.mem.read8(SAVE_HEADER_BLOCK + 0x14 + tc.label.length), 0, `${tc.name} name terminator`);
            // the two 16-byte struct halves
            for (let i = 0; i < 0x10; i++) {
                assert.equal(b.mem.read8(SAVE_HEADER_BLOCK + 0x70 + i), (0x40 + i) & 0xff, `${tc.name} struct A ${i}`);
                assert.equal(b.mem.read8(SAVE_HEADER_BLOCK + 0x80 + i), (0x50 + i) & 0xff, `${tc.name} struct B ${i}`);
            }
            // the count and its word table
            assert.equal(b.mem.read32(SAVE_HEADER_BLOCK + 0x314) | 0, tc.count, `${tc.name} count`);
            for (let i = 0; i < tc.count; i++) {
                assert.equal(b.mem.read32(SAVE_HEADER_BLOCK + 0x318 + i * 4) >>> 0, tc.words[i] >>> 0, `${tc.name} table ${i}`);
            }
            // the region between the zeroed header and the count is untouched
            for (let i = 0x90; i < 0x314; i += 0x80) {
                assert.equal(b.mem.read8(SAVE_HEADER_BLOCK + i), 0xaa, `${tc.name} untouched +0x${i.toString(16)}`);
            }
        } else {
            assert.deepEqual(blockWords(a), new Array(BLOCK_SPAN / 4).fill(0xaaaaaaaa), `${tc.name} refuses`);
        }
    }
});
