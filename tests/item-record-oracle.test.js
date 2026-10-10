import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { installTranslationBridge } from "../engine/native/bridge.ts";
import { itemRecord, itemIconClip, itemClassEquals } from "../engine/dw3/item-record.ts";

const resident = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)));
const rt = new NativeStageRuntime(new Uint8Array(8),
    { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 }, undefined, undefined, 0x80082cb0,
    { image: resident, base: 0x80010000 });
rt.cpu.gp = 0x8005cb50;
for (const address of [0x8001355c, 0x80013584, 0x800135b8]) rt.cpu.clearStub(address);

test("item record pointer matches original signed guard and wrapping arithmetic", () => {
    for (const id of [-2147483648, -1, 0, 1, 2, 402, 403, 0x20000000, 0x7fffffff]) {
        assert.equal(itemRecord(id), rt.cpu.call(0x8001355c, [id]) >>> 0, `id=${id}`);
    }
});

test("item icon and class consumers match original shipped records", () => {
    // Includes invalid-id null-pointer reads: the original consumers do not
    // add a guard around f5's zero result. Compare, do not invent a fallback.
    for (const id of [-1, 0, ...Array.from({ length: 402 }, (_, i) => i + 1)]) {
        assert.equal(itemIconClip(rt.mem, id), rt.cpu.call(0x80013584, [id]), `icon id=${id}`);
        for (const value of [-1, 0, 1, 2, 3, 255, 256, 0x10001]) {
            assert.equal(itemClassEquals(rt.mem, id, value), rt.cpu.call(0x800135b8, [id, value]),
                `class id=${id}, value=${value}`);
        }
    }
});

test("item bridge preserves return and caller-visible registers", () => {
    const addresses = [0x8001355c, 0x80013584, 0x800135b8];
    const cases = [];
    for (const address of addresses) for (const id of [-1, 0, 1, 2, 402]) {
        const args = [id, 3, 0x1234, 0x5678];
        const ret = rt.cpu.call(address, args);
        cases.push({ address, args, ret, regs: Array.from({ length: 32 }, (_, i) => rt.cpu.reg(i)) });
    }
    installTranslationBridge(rt.cpu, rt.mem, [], new Set(addresses));
    try {
        for (const c of cases) {
            assert.equal(rt.cpu.call(c.address, c.args), c.ret);
            assert.deepEqual(Array.from({ length: 32 }, (_, i) => rt.cpu.reg(i)), c.regs,
                `bridge registers ${c.address.toString(16)} id=${c.args[0]}`);
        }
    } finally {
        for (const address of addresses) rt.cpu.clearStub(address);
    }
});

test("item helpers preserve unsigned byte indexing and equality rather than masking", () => {
    const ptr = itemRecord(1);
    const oldClass = rt.mem.read8(ptr + 8), oldIcon = rt.mem.read8(ptr + 9);
    try {
        for (const byte of [0, 1, 3, 127, 128, 255]) {
            rt.mem.write8(ptr + 8, byte);
            rt.mem.write8(ptr + 9, byte);
            assert.equal(itemIconClip(rt.mem, 1), rt.cpu.call(0x80013584, [1]));
            for (const value of [byte, byte + 256, byte ^ 1, -1]) {
                assert.equal(itemClassEquals(rt.mem, 1, value), rt.cpu.call(0x800135b8, [1, value]));
            }
        }
    } finally {
        rt.mem.write8(ptr + 8, oldClass);
        rt.mem.write8(ptr + 9, oldIcon);
    }
});
