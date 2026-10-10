// Phase 4 oracle: engine/dw3/ui/fetch-table.ts must return exactly what the
// original F0x8001F744 returns for the same base table and index. The resident
// image runs through engine/native (the interpreter) as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { fetchTableEntry } from "../engine/dw3/ui/fetch-table.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

test("fetchTableEntry matches the interpreter (F0x8001F744)", () => {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    // A bank image in the scratch heap: count=3, offsets, then strings.
    const base = 0x80120000;
    const strings = ["alpha", "beta", "gamma"];
    let off = 4 + strings.length * 4;
    const offsets = [];
    for (const s of strings) {
        offsets.push(off);
        for (let i = 0; i < s.length; i++) rt.mem.write8(base + off + i, s.charCodeAt(i));
        rt.mem.write8(base + off + s.length, 0);
        off += s.length + 1;
    }
    rt.mem.write32(base, strings.length);
    offsets.forEach((o, i) => rt.mem.write32(base + 4 + i * 4, o));
    for (const index of [-1, 0, 1, 2, 3, 4, 100]) {
        const oracle = rt.cpu.call(0x8001f744, [base, index]) >>> 0;
        assert.equal(fetchTableEntry(rt.mem, base, index), oracle, `index ${index}`);
    }
    // index 1 must resolve to the second string's start.
    assert.equal(fetchTableEntry(rt.mem, base, 1), base + offsets[1]);
});
