// Phase 4 oracle: engine/dw3/ui/shop-sell-build.ts shopSellBuild (F0x800888E4)
// must match the original. The original runs through engine/native with the
// 0x80042B98 table functions stubbed to fill the buffer and resolve records; the
// port gets the same boundaries as callbacks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopSellBuild } from "../engine/dw3/ui/shop-sell-build.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80180000;
const OBJ_B = 0x80181000;
const RECORDS = 0x80182000;
const RECORD_STRIDE = 0x10;
const ENUM_STUB = 0x0fd40000;
const GETTER_STUB = 0x0fd40010;
const TABLE = 0x80042b98;

// id -> sell price. id 2 and 4 are unsellable; 0xffff exercises the signed read.
const PRICES = new Map([[1, 100], [2, 0], [3, 250], [4, 0], [5, 75], [6, 10], [0xffff, 7]]);

function recordFor(id) {
    return (RECORDS + (id & 0xff) * RECORD_STRIDE) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    // Record table: each record's +0x6 is the sell price.
    for (const [id, price] of PRICES) rt.mem.write16(recordFor(id) + 0x6, price);
    rt.mem.write32(TABLE, GETTER_STUB);
    rt.cpu.setStub(GETTER_STUB, (c) => recordFor(c.reg(4) | 0));
    rt.mem.write32(TABLE + 0xc, ENUM_STUB);
    return rt;
}

function zero(rt, base, size) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(base + i, 0);
}

function resetObj(rt, obj, category, ids) {
    zero(rt, obj, 0x720);
    rt.mem.write32(obj + 0x60, category);
    for (let i = 0; i < ids.length; i++) rt.mem.write16(obj + 0x38c + i * 2, ids[i]);
}

function portHost(mem, ids) {
    return {
        enumerateInventory(category, buffer) {
            for (let i = 0; i < ids.length; i++) mem.write16(buffer + i * 2, ids[i]);
            return ids.length;
        },
        itemRecord(id) {
            return recordFor(id);
        },
    };
}

function compare(label, rt, objA, objB) {
    for (let off = 0; off < 0x720; off += 4) {
        assert.equal(
            rt.mem.read32(objB + off) >>> 0,
            rt.mem.read32(objA + off) >>> 0,
            `${label} +0x${off.toString(16)}`,
        );
    }
}

const CASES = [
    { name: "all sellable", category: 0, ids: [1, 3, 5, 6] },
    { name: "some unsellable", category: 1, ids: [1, 2, 3, 4, 5] },
    { name: "empty", category: 2, ids: [] },
    { name: "signed high-bit id", category: 3, ids: [0xffff, 1] },
    { name: "all unsellable", category: 4, ids: [2, 4] },
];

test("shopSellBuild matches F0x800888E4", () => {
    const rt = runtime();
    for (const c of CASES) {
        resetObj(rt, OBJ_A, c.category, c.ids);
        // The original's enumerate stub writes into OBJ_A's buffer.
        rt.cpu.setStub(ENUM_STUB, (cc) => {
            const buffer = cc.reg(5) >>> 0;
            for (let i = 0; i < c.ids.length; i++) rt.mem.write16(buffer + i * 2, c.ids[i]);
            return c.ids.length;
        });
        rt.cpu.call(0x800888e4, [OBJ_A]);

        resetObj(rt, OBJ_B, c.category, c.ids);
        shopSellBuild(rt.mem, portHost(rt.mem, c.ids), OBJ_B);

        compare(c.name, rt, OBJ_A, OBJ_B);
    }

    // Sanity: the sellable subset is stored in order and counted.
    resetObj(rt, OBJ_A, 1, [1, 2, 3, 4, 5]);
    rt.cpu.setStub(ENUM_STUB, (cc) => {
        const buffer = cc.reg(5) >>> 0;
        for (const [i, id] of [1, 2, 3, 4, 5].entries()) rt.mem.write16(buffer + i * 2, id);
        return 5;
    });
    rt.cpu.call(0x800888e4, [OBJ_A]);
    assert.equal(rt.mem.read32(OBJ_A + 0x6c0) | 0, 3, "sellable count");
    assert.equal(rt.mem.read16(OBJ_A + 0x64 + 0 * 2) & 0xffff, 1);
    assert.equal(rt.mem.read16(OBJ_A + 0x64 + 1 * 2) & 0xffff, 3);
    assert.equal(rt.mem.read16(OBJ_A + 0x64 + 2 * 2) & 0xffff, 5);
});
