// Phase 4 oracle: engine/dw3/zero-fill.ts F0x80017CB0 and
// engine/dw3/party-context.ts F0x8001889C must match the interpreter. The
// resident image runs through engine/native as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { zeroFill } from "../engine/dw3/zero-fill.ts";
import {
    CHARACTER_RECORDS,
    CHARACTER_STRIDE,
    getPadButtons4A,
} from "../engine/dw3/party-context.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const BUF_A = 0x80150000;
const BUF_B = 0x80150100;
const LEN = 48;

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function bytes(rt, base) {
    const out = [];
    for (let i = 0; i < LEN; i++) out.push(rt.mem.read8(base + i));
    return out;
}

test("zeroFill matches the interpreter (F0x80017CB0)", () => {
    const rt = runtime();
    const lengths = [-8, -3, -1, 0, 1, 2, 3, 4, 5, 7, 8, 15, 16, 17, 0x1f, 0x20, 0x25];
    for (const n of lengths) {
        for (let i = 0; i < LEN; i++) {
            rt.mem.write8(BUF_A + i, 0xaa);
            rt.mem.write8(BUF_B + i, 0xaa);
        }
        rt.cpu.call(0x80017cb0, [BUF_A, n]);
        zeroFill(rt.mem, BUF_B, n);
        assert.deepEqual(bytes(rt, BUF_B), bytes(rt, BUF_A), `length ${n}`);
    }
    // Spot check the actual result: 4 bytes zeroed, byte 4 untouched.
    for (let i = 0; i < LEN; i++) rt.mem.write8(BUF_B + i, 0xaa);
    zeroFill(rt.mem, BUF_B, 4);
    assert.deepEqual(bytes(rt, BUF_B).slice(0, 5), [0, 0, 0, 0, 0xaa]);
});

test("getPadButtons4A matches the interpreter (F0x8001889C)", () => {
    const rt = runtime();
    const values = [0, 1, 0x1234, 0xffff, 0x8000, 0x00ff];
    for (let slot = 0; slot < values.length; slot++) {
        const addr = CHARACTER_RECORDS + slot * CHARACTER_STRIDE + 0x4a;
        rt.mem.write16(addr, values[slot]);
        // Neighbours must not be read.
        rt.mem.write16(addr - 2, 0xaaaa);
        rt.mem.write16(addr + 2, 0xbbbb);
    }
    for (let slot = 0; slot < values.length; slot++) {
        const oracle = rt.cpu.call(0x8001889c, [slot]) & 0xffff;
        assert.equal(getPadButtons4A(rt.mem, slot), oracle, `slot ${slot}`);
        assert.equal(oracle, values[slot], `slot ${slot} fixture`);
    }
});
