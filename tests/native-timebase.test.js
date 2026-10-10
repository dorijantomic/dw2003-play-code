// The display timebase host model. 0x8004DE20 is the free-running tick counter
// (F0x8001D6F4) and 0x8004DE28 the per-frame delta (F0x8001D704). The host must
// accumulate the counter, not assign the delta to it; before the fix the shop
// cursor's gate divided against a constant and the pointer never animated.
// Claim UI-DISPLAY-TICK-CHAIN-2026-08-21 / display-frame-delta-feeder (candidate).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { spawnUiIcon } from "../engine/dw3/ui/spawn-ui-icon.ts";
import { cursorHandler } from "../engine/dw3/ui/cursor-handler.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TICK_CELL = 0x8004de20;
const DELTA_CELL = 0x8004de28;
const TICK_GETTER = 0x8001d6f4;
const DELTA_GETTER = 0x8001d704;
const TRIGGERS = [32, 38, 44, 50, 56, 88];

function runtime() {
    return new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

test("the tick counter accumulates and the delta stays separate", () => {
    const rt = runtime();
    assert.equal(rt.mem.read32(TICK_CELL) >>> 0, 0, "counter starts at 0");
    rt.tick(1);
    assert.equal(rt.mem.read32(TICK_CELL) >>> 0, 1, "counter after one frame");
    assert.equal(rt.mem.read32(DELTA_CELL) >>> 0, 1, "delta after one frame");
    rt.tick(2);
    assert.equal(rt.mem.read32(TICK_CELL) >>> 0, 3, "counter accumulates");
    assert.equal(rt.mem.read32(DELTA_CELL) >>> 0, 2, "delta is the frame's delta");
    // The resident getters read the two cells.
    assert.equal(rt.cpu.call(TICK_GETTER, []) >>> 0, 3, "F0x8001D6F4 returns the counter");
    assert.equal(rt.cpu.call(DELTA_GETTER, []) >>> 0, 2, "F0x8001D704 returns the delta");
    // Monotonic: neither the delta nor a later tick resets the counter.
    for (let i = 0; i < 40; i++) rt.tick(1);
    assert.equal(rt.mem.read32(TICK_CELL) >>> 0, 43, "counter never resets");
});

test("the real tick counter drives the shop cursor animation", () => {
    let HEAP = 0x80190000;
    const rt = runtime();
    const portHost = {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = HEAP;
            HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
        free() {},
        service: () => rt.mem.read32(TICK_CELL) >>> 0,
        advanceState(self) {
            rt.mem.write32(self + 0xc, (rt.mem.read32(self + 0xc) | 0) + 1);
            rt.mem.write32(self + 0x10, 0);
            rt.mem.write32(self + 0x14, 0);
            rt.mem.write32(self + 0x18, 0);
        },
    };
    const cursor = spawnUiIcon(rt.mem, portHost, 0x1002, 3, 0x1d, 0x24) >>> 0;
    const seen = [];
    for (let frame = 0; frame <= 90; frame++) {
        rt.tick(1);
        let calls = 0;
        cursorHandler(rt.mem, {
            ...portHost,
            service: () => { calls++; return portHost.service(); },
        }, cursor, rt.mem.read32(cursor + 0x24) >>> 0);
        if (calls === 2) seen.push(frame);
    }
    assert.deepEqual(seen, TRIGGERS, "glyph pushes with the real counter");
});
