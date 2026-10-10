// Phase 4 oracle: engine/dw3/ui/shop-list-create.ts shopListCreate must
// reproduce the whole 0x704-byte object the original F0x800889A8 builds. The
// original constructor runs through engine/native from the resident image with
// the stitshop overlay loaded; the port runs on an equivalent zeroing allocator.
// The factory's secondary buffer pointer at +0x24 differs by allocation, so it
// is compared as non-null with its 0x50 bytes zeroed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    SHOP_LIST_EXTRA_SIZE,
    SHOP_LIST_SIZE,
    SHOP_LIST_TICK,
    shopListCreate,
} from "../engine/dw3/ui/shop-list-create.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
let PORT_HEAP = 0x80190000;

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function portHost(rt) {
    return {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = PORT_HEAP;
            PORT_HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
}

function compareObject(label, rt, objA, objB) {
    const extraA = rt.mem.read32(objA + 0x24) >>> 0;
    const extraB = rt.mem.read32(objB + 0x24) >>> 0;
    assert.notEqual(extraA, 0, `${label}: original extra buffer`);
    assert.notEqual(extraB, 0, `${label}: port extra buffer`);
    for (let i = 0; i < SHOP_LIST_EXTRA_SIZE; i++) {
        assert.equal(rt.mem.read8(extraA + i), 0, `${label}: original extra byte ${i}`);
        assert.equal(rt.mem.read8(extraB + i), 0, `${label}: port extra byte ${i}`);
    }
    const a = [];
    const b = [];
    for (let off = 0; off < SHOP_LIST_SIZE; off += 4) {
        a.push(rt.mem.read32(objA + off) >>> 0);
        b.push(rt.mem.read32(objB + off) >>> 0);
    }
    a[0x24 / 4] = 0;
    b[0x24 / 4] = 0;
    assert.deepEqual(b, a, label);
}

test("shopListCreate matches F0x800889A8", () => {
    const rt = runtime();
    const PARENT = 0x80170000;
    const SHOPARG = 7;
    const MODE = 0;
    const objA = rt.cpu.call(0x800889a8, [PARENT, SHOPARG, MODE]) >>> 0;
    PORT_HEAP = 0x80190000;
    const objB = shopListCreate(rt.mem, portHost(rt), PARENT, SHOPARG, MODE) >>> 0;
    compareObject("constructor", rt, objA, objB);

    // Spot-check the load-bearing fields.
    assert.equal(rt.mem.read32(objA + 0x20) >>> 0, SHOP_LIST_EXTRA_SIZE >> 2);
    assert.equal(rt.mem.read32(objA + 0x48) >>> 0, SHOP_LIST_TICK);
    assert.equal(rt.mem.read32(objA + 0x54) >>> 0, 0x1000);
    assert.equal(rt.mem.read32(objA + 0x58) >>> 0, 4);
    assert.equal(rt.mem.read32(objA + 0x50) >>> 0, PARENT);
    assert.equal(rt.mem.read32(objA + 0x5c) >>> 0, MODE);
    assert.equal(rt.mem.read32(objA + 0x60) >>> 0, SHOPARG);

    // Raw-word arguments: SELL mode and wide/negative values are not sign-shaped.
    const rt2 = runtime();
    const a1 = rt2.cpu.call(0x800889a8, [0xdeadbeef | 0, -1, 4]) >>> 0;
    PORT_HEAP = 0x80190000;
    const b1 = shopListCreate(rt2.mem, portHost(rt2), 0xdeadbeef | 0, -1, 4) >>> 0;
    compareObject("SELL/raw args", rt2, a1, b1);
    assert.equal(rt2.mem.read32(a1 + 0x5c) >>> 0, 4);
    assert.equal(rt2.mem.read32(a1 + 0x60) >>> 0, 0xffffffff);
});
