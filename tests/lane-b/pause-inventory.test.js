// Oracle: engine/dw3/ui/native/pause-inventory.ts against the resident
// F0x800135E8 and the pro/ststatus tab list builders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    inventoryCopy, inventoryCopyFamily, inventoryCopyFiltered, inventoryDispatch,
} from "../../engine/dw3/ui/native/pause-inventory.ts";

const h = createHarness({ overlayFile: "pro_ststatus.bin" });
const CTX = 0x80048d34;
const DST = 0x80150000;
const LISTS = 0x8009af68;
const RANGES = [[DST, 0x400], [LISTS, 0x680]];

const seedBag = (seed, density) => () => {
    let s = seed;
    const next = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s >>> 8; };
    for (let id = 0; id < 403; id++) {
        h.rt.mem.write8(CTX + id + 0x7c, next() % 100 < density ? 1 + (next() % 9) : 0);
        h.rt.mem.write8(CTX + id + 0x20f, next() % 100 < density / 2 ? 1 : 0);
    }
    for (let i = 0; i < 0x400; i += 4) h.rt.mem.write32(DST + i, 0xdeadbeef);
};

test("inventoryCopy matches F0x800135E8 for every category", () => {
    for (const density of [0, 5, 30, 90]) {
        for (const idx of [0, 1, 2, 3, 4, 5, 6, 0x80000000 | 0, 0x80000001 | 0, 0x80000002 | 0, 0x80000003 | 0, 0x80000004 | 0, 0x80000005 | 0, 0x7fffffff]) {
            let orig = 0, port = 0;
            h.compare(`copy d${density} idx${idx}`, seedBag(density * 7 + 1, density), RANGES,
                () => { orig = h.rt.cpu.call(0x800135e8, [idx, DST], 200000); },
                () => { port = inventoryCopy(h.rt.mem, idx, DST); });
            assert.equal(port | 0, orig | 0, `count idx ${idx}`);
        }
    }
});

test("the family and filtered lists match F0x8009A1BC and F0x80099FF8", () => {
    for (const density of [0, 10, 60, 100]) {
        for (const family of [0, 2, 3, 4, 5, 7, 0x13]) {
            let orig = 0, port = 0;
            h.compare(`family d${density} f${family}`, seedBag(density + 3, density), RANGES,
                () => { orig = h.rt.cpu.call(0x8009a1bc, [family, DST], 400000); },
                () => { port = inventoryCopyFamily(h.rt.mem, family, DST); });
            assert.equal(port | 0, orig | 0, "family count");
        }
        let orig = 0, port = 0;
        h.compare(`filtered d${density}`, seedBag(density + 9, density), RANGES,
            () => { orig = h.rt.cpu.call(0x80099ff8, [DST], 400000); },
            () => { port = inventoryCopyFiltered(h.rt.mem, DST); });
        assert.equal(port | 0, orig | 0, "filtered count");
    }
});

test("inventoryDispatch matches F0x80099F84 for every tab", () => {
    for (const tab of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        h.compare(`dispatch tab${tab}`, seedBag(tab + 40, 40), RANGES,
            () => h.rt.cpu.call(0x80099f84, [tab, DST], 400000),
            () => inventoryDispatch(h.rt.mem, tab, DST));
    }
});
