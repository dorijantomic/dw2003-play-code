// Phase 4 oracle: engine/dw3/ui/shop-actor.ts shopActorBuy (F0x8008596C) and
// shopActorSell (F0x800873D4) must reproduce the whole object the original
// builds. The original runs through engine/native; the port on an equivalent
// zeroing allocator. The factory's extra block pointer at +0x24 differs by
// allocation and is compared as non-null with its bytes zeroed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    shopActorBuyTick,
    shopActorSellTick,
    SHOP_ACTOR_BUY_EXTRA,
    SHOP_ACTOR_BUY_SIZE,
    SHOP_ACTOR_SELL_EXTRA,
    SHOP_ACTOR_SELL_SIZE,
    shopActorBuy,
    shopActorSell,
} from "../engine/dw3/ui/shop-actor.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
let PORT_HEAP = 0x80190000;
let EVENTS = [];

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

function compareObject(label, rt, objA, objB, size, extraSize) {
    const extraA = rt.mem.read32(objA + 0x24) >>> 0;
    const extraB = rt.mem.read32(objB + 0x24) >>> 0;
    assert.notEqual(extraA, 0, `${label}: original extra block`);
    assert.notEqual(extraB, 0, `${label}: port extra block`);
    for (let i = 0; i < extraSize; i++) {
        assert.equal(rt.mem.read8(extraA + i), 0, `${label}: original extra byte ${i}`);
        assert.equal(rt.mem.read8(extraB + i), 0, `${label}: port extra byte ${i}`);
    }
    for (let off = 0; off < size; off += 4) {
        if (off === 0x24) continue;
        assert.equal(
            rt.mem.read32(objB + off) >>> 0,
            rt.mem.read32(objA + off) >>> 0,
            `${label} +0x${off.toString(16)}`,
        );
    }
}

test("shopActorBuy matches F0x8008596C", () => {
    const rt = runtime();
    for (const arg of [0x1005, 0, -1, 0x1fff]) {
        const objA = rt.cpu.call(0x8008596c, [arg]) >>> 0;
        PORT_HEAP = 0x80190000;
        const objB = shopActorBuy(rt.mem, portHost(rt), arg) >>> 0;
        compareObject(`buy arg=${arg}`, rt, objA, objB, SHOP_ACTOR_BUY_SIZE, SHOP_ACTOR_BUY_EXTRA);
    }
    const rt2 = runtime();
    const a = rt2.cpu.call(0x8008596c, [0x1005]) >>> 0;
    assert.equal(rt2.mem.read32(a + 0x50) >>> 0, 0x80085934, "BUY forwarder");
    assert.equal(rt2.mem.read32(a + 0x48) >>> 0, 0x80085890, "BUY handler");
    assert.equal(rt2.mem.read32(a + 0x54) >>> 0, 0x1005, "BUY arg");
    assert.equal(rt2.mem.read32(a + 0x20) >>> 0, 0x24 >> 2, "BUY extra count");
});

test("shopActorSell matches F0x800873D4", () => {
    const rt = runtime();
    for (const arg of [2, 0, -1, 0x1fff]) {
        const objA = rt.cpu.call(0x800873d4, [arg]) >>> 0;
        PORT_HEAP = 0x80190000;
        const objB = shopActorSell(rt.mem, portHost(rt), arg) >>> 0;
        compareObject(`sell arg=${arg}`, rt, objA, objB, SHOP_ACTOR_SELL_SIZE, SHOP_ACTOR_SELL_EXTRA);
    }
    const rt2 = runtime();
    const a = rt2.cpu.call(0x800873d4, [2]) >>> 0;
    assert.equal(rt2.mem.read32(a + 0x50) >>> 0, 0x8008739c, "SELL forwarder");
    assert.equal(rt2.mem.read32(a + 0x48) >>> 0, 0x800872f4, "SELL handler");
    assert.equal(rt2.mem.read32(a + 0x20) >>> 0, 0x38 >> 2, "SELL extra count");
});

test("shopActorBuyTick / shopActorSellTick match F0x80085890 / F0x800872F4", () => {
    const ADVANCE = 0x800142ac;
    const CALLEES = {
        0x8008360c: "call8360c",
        0x80083eb0: "call83eb0",
        0x80083970: "call83970",
        0x800859c0: "call859c0",
        0x80085f48: "call85f48",
        0x80085b18: "call85b18",
    };
    const rt = runtime();
    for (const [addr, tag] of Object.entries(CALLEES)) {
        rt.cpu.setStub(Number(addr), () => { EVENTS.push([tag]); return 0; });
    }
    rt.cpu.setStub(ADVANCE, (c) => {
        EVENTS.push(["advanceState"]);
        const o = c.reg(4);
        rt.mem.write32(o + 0xc, (rt.mem.read32(o + 0xc) | 0) + 1);
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        return 0;
    });
    const portFor = (mem) => ({
        advanceState(self) {
            EVENTS.push(["advanceState"]);
            mem.write32(self + 0xc, (mem.read32(self + 0xc) | 0) + 1);
            mem.write32(self + 0x10, 0);
            mem.write32(self + 0x14, 0);
            mem.write32(self + 0x18, 0);
        },
        call8360c() { EVENTS.push(["call8360c"]); },
        call83eb0() { EVENTS.push(["call83eb0"]); },
        call83970() { EVENTS.push(["call83970"]); },
        call859c0() { EVENTS.push(["call859c0"]); },
        call85f48() { EVENTS.push(["call85f48"]); },
        call85b18() { EVENTS.push(["call85b18"]); },
    });

    const OBJ_A = 0x80188000;
    const OBJ_B = 0x80189000;
    const CTX = 0x8018a000;
    const cases = [
        { addr: 0x80085890, name: "buy", port: shopActorBuyTick },
        { addr: 0x800872f4, name: "sell", port: shopActorSellTick },
    ];
    for (const c of cases) {
        for (const state of [0, 1, 2, 3, 4, 7]) {
            const reset = (obj) => {
                for (let o = 0; o < 0x120; o += 4) rt.mem.write32(obj + o, 0);
                rt.mem.write32(obj + 0xc, state);
                rt.mem.write32(obj + 0x38, ADVANCE);
                for (const off of [0x7c, 0x88, 0x8c, 0x98, 0x9c, 0xa8, 0xac, 0xb8, 0xbc]) {
                    rt.mem.write32(obj + off, 0xdead);
                }
            };
            reset(OBJ_A);
            EVENTS.length = 0;
            rt.cpu.call(c.addr, [OBJ_A, CTX]);
            const oracleEvents = EVENTS.slice();
            reset(OBJ_B);
            EVENTS.length = 0;
            c.port(rt.mem, portFor(rt.mem), OBJ_B, CTX);
            const portEvents = EVENTS.slice();
            assert.deepEqual(portEvents, oracleEvents, `${c.name} state=${state}: events`);
            for (let o = 0; o < 0x120; o += 4) {
                assert.equal(rt.mem.read32(OBJ_B + o) >>> 0, rt.mem.read32(OBJ_A + o) >>> 0,
                    `${c.name} state=${state} +0x${o.toString(16)}`);
            }
        }
    }

    // Sanity: the default branch armed the BUY fold timers and set +0x64.
    const obj = 0x80188000;
    for (let o = 0; o < 0x120; o += 4) rt.mem.write32(obj + o, 0);
    rt.cpu.call(0x80085890, [obj, CTX]);
    assert.equal(rt.mem.read32(obj + 0x88) >>> 0, 0xa);
    assert.equal(rt.mem.read32(obj + 0xb8) >>> 0, 0xa);
    assert.equal(rt.mem.read32(obj + 0x64) >>> 0, 1);
});
