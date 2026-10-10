// Phase 4 oracle: engine/dw3/ui/folder-list-colours.ts must recount exactly the
// 18 colour-counter words the original pro/stcrddek F0x8008924C writes, for the
// same folder id table and the same resolved card records. The overlay runs
// through engine/native (the interpreter) as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    FOLDER_IDS,
    FOLDER_IDS_STRIDE,
    folderListCountColours,
} from "../engine/dw3/ui/folder-list-colours.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stcrddek = new Uint8Array(readFileSync(join(dir, "pro_stcrddek.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stcrddek.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SELF_A = 0x80150000;
const SELF_B = 0x80151000;
const WINDOW = 0x600;
const BANK_BASE = 0x80160000;
const RECORD_STRIDE = 0x62c;
const RESOLVE_STUB = 0x0fd10000;

function runtime() {
    const rt = new NativeStageRuntime(stcrddek, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    // The card-accessor boundary: F0x8001E7EC calls D0x80044F4C(bank) for a base.
    // Hand it a stub that points every bank at one prepared record bank.
    rt.cpu.setStub(RESOLVE_STUB, () => BANK_BASE);
    rt.mem.write32(0x80044f4c, RESOLVE_STUB);
    return rt;
}

/** The accessor's own resolution, mirrored for the port's boundary callback. */
function recordOf(id) {
    if (id <= 0) return BANK_BASE;
    const idx = id - 1;
    return (BANK_BASE + (idx & 0x3f) * RECORD_STRIDE) >>> 0;
}

function bytes(rt, base) {
    const out = [];
    for (let i = 0; i < WINDOW; i++) out.push(rt.mem.read8(base + i));
    return out;
}

test("folderListCountColours matches the interpreter (F0x8008924C)", () => {
    const rt = runtime();
    // Colour patterns: includes 0 (the unguarded write below the block), an
    // out-of-range 8 (overflow into the next block) and 255 (far outside).
    const colours = [0, 1, 2, 3, 4, 5, 6, 7, 8, 255, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
        2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
    for (let id = 1; id <= 40; id++) rt.mem.write8(recordOf(id), colours[id - 1]);
    rt.mem.write8(recordOf(32767), 3);
    // Three 40-entry signed-halfword id tables. Folder 2 mixes in <=0 ids.
    for (let f = 0; f < 3; f++) {
        for (let i = 0; i < 40; i++) {
            let id = i + 1;
            if (f === 2 && i === 0) id = 0;
            if (f === 2 && i === 1) id = -1;
            if (f === 2 && i === 2) id = 0x7fff;
            rt.mem.write16(FOLDER_IDS + f * FOLDER_IDS_STRIDE + i * 2, id & 0xffff);
        }
    }
    for (let i = 0; i < WINDOW; i++) {
        rt.mem.write8(SELF_A + i, 0xaa);
        rt.mem.write8(SELF_B + i, 0xaa);
    }
    rt.cpu.call(0x8008924c, [SELF_A]);
    folderListCountColours(rt.mem, SELF_B, recordOf);
    assert.deepEqual(bytes(rt, SELF_B), bytes(rt, SELF_A));
});

test("folderListCountColours zeroes six counters per folder before counting", () => {
    const rt = runtime();
    // Every slot resolves to a record whose colour byte is 2 -> bucket index 1.
    for (let id = 1; id <= 40; id++) rt.mem.write8(recordOf(id), 2);
    for (let f = 0; f < 3; f++) {
        for (let i = 0; i < 40; i++) rt.mem.write16(FOLDER_IDS + f * FOLDER_IDS_STRIDE + i * 2, (i + 1) & 0xffff);
    }
    for (let i = 0; i < WINDOW; i++) {
        rt.mem.write8(SELF_A + i, 0xaa);
        rt.mem.write8(SELF_B + i, 0xaa);
    }
    rt.cpu.call(0x8008924c, [SELF_A]);
    folderListCountColours(rt.mem, SELF_B, recordOf);
    // Bucket 1 (colour 2) holds 40 per folder; the other five are zero.
    for (let f = 0; f < 3; f++) {
        const block = SELF_A + f * 0x18 + 0x74;
        assert.equal(rt.mem.read32(block + 4), 40, `folder ${f} bucket 1`);
        assert.equal(rt.mem.read32(block), 0, `folder ${f} bucket 0`);
        assert.equal(rt.mem.read32(block + 20), 0, `folder ${f} bucket 5`);
    }
    assert.deepEqual(bytes(rt, SELF_B), bytes(rt, SELF_A));
});
