// Phase 4 oracle: engine/dw3/globals.ts (the pointer getters and the current-view
// store) and engine/dw3/display-service.ts findDisplayViewCell must match the
// original addresses. engine/native runs the originals as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { CURRENT_VIEW_CELL, LOAD_CELL_B3F8, LOAD_CELL_B400, loadPtrB3F8, loadPtrB400, setCurrentView } from "../engine/dw3/globals.ts";
import { DISPLAY_SERVICE, findDisplayViewCell } from "../engine/dw3/display-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

test("the two pointer getters match F0x80016B58 / F0x80016B68", () => {
    const rt = runtime();
    for (const [cell, fn] of [[LOAD_CELL_B400, loadPtrB400], [LOAD_CELL_B3F8, loadPtrB3F8]]) {
        for (const v of [0, 1, 0x801fffff, 0xdeadbeef]) {
            rt.mem.write32(cell, v >>> 0);
            const oracle = rt.cpu.call(cell === LOAD_CELL_B400 ? 0x80016b58 : 0x80016b68, []) | 0;
            assert.equal(fn(rt.mem) | 0, oracle, `cell 0x${cell.toString(16)} v=0x${(v >>> 0).toString(16)}`);
        }
    }
});

test("setCurrentView matches F0x8001E7E0", () => {
    const rt = runtime();
    for (const v of [0, 1, 0x8004de10, 0xffffffff]) {
        rt.mem.write32(CURRENT_VIEW_CELL, 0x12345678);
        rt.cpu.call(0x8001e7e0, [v]);
        const oracle = rt.mem.read32(CURRENT_VIEW_CELL) >>> 0;
        rt.mem.write32(CURRENT_VIEW_CELL, 0x12345678);
        setCurrentView(rt.mem, v);
        assert.equal(rt.mem.read32(CURRENT_VIEW_CELL) >>> 0, oracle, `v=0x${(v >>> 0).toString(16)}`);
    }
});

test("findDisplayViewCell matches F0x8001DAD0", () => {
    const rt = runtime();
    const setSlots = (registered, handle) => {
        for (let i = 0; i < 0x1e; i++) {
            rt.mem.write32(DISPLAY_SERVICE + i * 4 + 0x60, (registered >> i) & 1 ? 0x4000 + i : 0);
            rt.mem.write32(DISPLAY_SERVICE + i * 4 + 0xd8, (handle >> i) & 1 ? 0xa000 + i : 0);
        }
    };
    const cases = [
        [0, 0],
        [0b1, 0],
        [0b1010, 0],
        [0b1, 0b1],
        [0b1010, 0b10],
        [0b1010, 0b1000],
        [0x3fffffff, 0x3fffffff],
        [0x3fffffff, 0],
    ];
    for (const [registered, handle] of cases) {
        setSlots(registered, handle);
        const before = [];
        for (let i = 0; i < 0x1e; i++) before.push(rt.mem.read32(DISPLAY_SERVICE + i * 4 + 0x60), rt.mem.read32(DISPLAY_SERVICE + i * 4 + 0xd8));
        for (const key of [0, 0xa000, 0xa003, 0xa009, 0xa01d, 0xdead]) {
            const oracle = rt.cpu.call(0x8001dad0, [key]) | 0;
            const port = findDisplayViewCell(rt.mem, key) | 0;
            assert.equal(port, oracle, `reg=0x${registered.toString(16)} handle=0x${handle.toString(16)} key=0x${key.toString(16)}`);
        }
        const after = [];
        for (let i = 0; i < 0x1e; i++) after.push(rt.mem.read32(DISPLAY_SERVICE + i * 4 + 0x60), rt.mem.read32(DISPLAY_SERVICE + i * 4 + 0xd8));
        assert.deepEqual(after, before, "the search does not write");
    }
});
