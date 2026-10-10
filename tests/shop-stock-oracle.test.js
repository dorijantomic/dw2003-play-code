// Phase 4 oracle: engine/dw3/ui/shop-stock.ts shopLoad (F0x8008C488) must match
// the original: return the stock pointer and write the entry count to the stock
// cell, or return 0 when the shop id is negative or its record is empty.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { SHOP_STOCK_CELL, SHOP_STOCK_RECORDS, shopLoad } from "../engine/dw3/ui/shop-stock.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

test("shopLoad matches F0x8008C488", () => {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;

    const shops = new Map([
        [0, { count: 12, stock: 0x80190000 }],
        [3, { count: 0, stock: 0x80191000 }],
        [7, { count: 0, stock: 0 }],          // empty record
        [9, { count: 0x55, stock: 0x80192000 }],
    ]);
    for (const [id, rec] of shops) {
        rt.mem.write32(SHOP_STOCK_RECORDS + id * 8, rec.count);
        rt.mem.write32(SHOP_STOCK_RECORDS + id * 8 + 4, rec.stock);
    }

    for (const id of [0, 3, 7, 9, -1, 4, 0x1000]) {
        rt.mem.write32(SHOP_STOCK_CELL, 0xaaaa);
        const a = rt.cpu.call(0x8008c488, [id]) >>> 0;
        const cellA = rt.mem.read32(SHOP_STOCK_CELL) >>> 0;
        rt.mem.write32(SHOP_STOCK_CELL, 0xaaaa);
        const b = shopLoad(rt.mem, id) >>> 0;
        const cellB = rt.mem.read32(SHOP_STOCK_CELL) >>> 0;
        assert.equal(b, a, `id ${id}: return`);
        assert.equal(cellB, cellA, `id ${id}: stock cell`);
    }

    // Sanity: a valid shop returns its stock pointer and writes its count.
    rt.mem.write32(SHOP_STOCK_CELL, 0xaaaa);
    assert.equal(shopLoad(rt.mem, 0) >>> 0, 0x80190000);
    assert.equal(rt.mem.read32(SHOP_STOCK_CELL) >>> 0, 12);
    // A negative id leaves the cell untouched.
    rt.mem.write32(SHOP_STOCK_CELL, 0xaaaa);
    assert.equal(shopLoad(rt.mem, -1), 0);
    assert.equal(rt.mem.read32(SHOP_STOCK_CELL) >>> 0, 0xaaaa);
});
