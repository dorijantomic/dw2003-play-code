// Phase 4 oracle: the small resident accessors in engine/dw3/disc-tables.ts and
// engine/dw3/party-context.ts must match the interpreter. The resident image
// runs through engine/native as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { LBA_LEN_SECTORS, getLbaSectorLength } from "../engine/dw3/disc-tables.ts";
import {
    CURRENT_SHOP_ID,
    PARTY_CONTEXT,
    PARTY_MAP,
    ROSTER_STRIDE,
    SCREEN_TRANSITION_A,
    SCREEN_TRANSITION_B,
    getCurrentShopId,
    getFollowerRosterSlot,
    requestScreenTransition,
} from "../engine/dw3/party-context.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

test("getLbaSectorLength matches the interpreter (F0x80014200)", () => {
    const rt = runtime();
    const lengths = [0, 1, 0x1234, 0xffff, 0x8000, 2381];
    lengths.forEach((v, i) => rt.mem.write16(LBA_LEN_SECTORS + i * 2, v));
    for (let i = 0; i < lengths.length; i++) {
        const oracle = rt.cpu.call(0x80014200, [i]) & 0xffff;
        assert.equal(getLbaSectorLength(rt.mem, i), oracle, `index ${i}`);
        assert.equal(oracle, lengths[i], `index ${i} fixture`);
    }
});

test("getCurrentShopId matches the interpreter (F0x80016B78)", () => {
    const rt = runtime();
    for (const v of [0, 7, 0x7fffffff, -1, 0x12345678]) {
        rt.mem.write32(CURRENT_SHOP_ID, v >>> 0);
        const oracle = rt.cpu.call(0x80016b78, []) | 0;
        assert.equal(getCurrentShopId(rt.mem), oracle, `value ${v}`);
    }
});

test("requestScreenTransition matches the interpreter (F0x80016B88)", () => {
    const rt = runtime();
    const WIN = PARTY_CONTEXT + 0x26c0;
    const size = 0x20;
    const snapshot = (fn) => {
        for (let i = 0; i < size; i++) rt.mem.write8(WIN + i, 0xaa);
        fn();
        const out = [];
        for (let i = 0; i < size; i++) out.push(rt.mem.read8(WIN + i));
        return out;
    };
    const cases = [[0, 0], [0x12345678, -1], [5, 9]];
    for (const [a, b] of cases) {
        const orig = snapshot(() => rt.cpu.call(0x80016b88, [a, b]));
        const port = snapshot(() => requestScreenTransition(rt.mem, a, b));
        assert.deepEqual(port, orig, `a=${a} b=${b}`);
        assert.equal(rt.mem.read32(SCREEN_TRANSITION_A) | 0, a | 0);
        assert.equal(rt.mem.read32(SCREEN_TRANSITION_B) | 0, b | 0);
    }
});

test("getFollowerRosterSlot matches the interpreter (F0x80016FD8)", () => {
    const rt = runtime();
    const slots = [0, 1, 2];
    slots.forEach((slot, pos) => {
        rt.mem.write32(PARTY_MAP + pos * 4, slot);
        rt.mem.write32(PARTY_CONTEXT + slot * ROSTER_STRIDE + 0x760, (slot + 3) >>> 0);
    });
    // A wrapping slot value exercises the 32-bit product.
    rt.mem.write32(PARTY_MAP + 0, 0x01000000);
    for (const pos of [0, 1, 2, 3, 4, -1]) {
        const oracle = rt.cpu.call(0x80016fd8, [pos]) | 0;
        assert.equal(getFollowerRosterSlot(rt.mem, pos), oracle, `position ${pos}`);
    }
});
