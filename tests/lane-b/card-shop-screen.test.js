// Lane B Phase 4 oracle: engine/dw3/ui/native/card-shop-screen.ts must match the
// original pro/stcrdshp card shop screen bodies.
//
//   F0x80088CA0  shopScreenCreate
//   F0x80088B50  shopScreenLifecycle
//   F0x800880C4  shopDrawChrome
//
// The original runs through engine/native (the interpreter) as the oracle. The
// draw context is recorded into rt.drawCalls; the shop-id service, the stage
// mode service, the bank-request service, the root tick, the label builder and
// the two bank service cells (0x8008CB80 / 0x8008CB84) are stubs on both sides,
// so the ordered call sequences, the field writes and the chrome draw intents
// can be compared directly. The stage→shop table at 0x8008CB28 is the overlay's
// own real data, so the lookup branch is exercised for real.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    SHOP_SAVE_PTR_CELL,
    SHOP_SCREEN_EXTRA,
    SHOP_SCREEN_SIZE,
    SHOP_STAGE_GLOBAL,
    shopDrawChrome,
    shopScreenCreate,
    shopScreenLifecycle,
} from "../../engine/dw3/ui/native/card-shop-screen.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const shop = new Uint8Array(readFileSync(join(dir, "pro_stcrdshp.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: shop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80160000;
const CTX_A = 0x80170000;
const CTX_B = 0x80170100;
const SAVE_BLOCK = 0x8019a000;

const PACK_STUB = 0x0fd40000;
const BANK_STUB = 0x0fd40004;
const SHOPID_STUB = 0x0fd40008;
const RESCALL_STUB = 0x0fd4000c;
const MODE_STUB = 0x0fd40010;
const STARTBANK_STUB = 0x0fd40014;
const PENDING_STUB = 0x0fd40018;
const BASE38_STUB = 0x0fd40024;
const PACK_PTR = 0x80190000;

const ARITY = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, drawSprite: 4 };

let SHOP_ID = 0x1234;
let MODE = 0;
let PENDING = 0;
const BANK_CALLS = [];
const MODE_CALLS = [];
const RES_CALLS = [];
const BOUND_CALLS = [];
const INTENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(shop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => ((c.reg(4) >>> 0) === 0x063e0000 ? PACK_PTR : 0));
    rt.cpu.setStub(BANK_STUB, (c) => { BANK_CALLS.push(c.reg(4) | 0); return 0; });
    rt.cpu.setStub(SHOPID_STUB, () => SHOP_ID);
    rt.cpu.setStub(RESCALL_STUB, (c) => { RES_CALLS.push([c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(MODE_STUB, (c) => { MODE_CALLS.push(c.reg(4) | 0); return MODE; });
    rt.cpu.setStub(STARTBANK_STUB, (c) => { BOUND_CALLS.push(["start", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(PENDING_STUB, (c) => { BOUND_CALLS.push(["pending", c.reg(4) | 0]); return PENDING; });
    rt.cpu.setStub(BASE38_STUB, (c) => { BOUND_CALLS.push(["m38", (c.reg(4) >>> 0) - OBJ_A]); return 0; });
    // Cells the overlay code jumps through.
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x80044f44, BANK_STUB);
    rt.mem.write32(0x8004b43c, SHOPID_STUB);
    rt.mem.write32(0x8004b440, RESCALL_STUB);
    rt.mem.write32(0x8004b448, MODE_STUB);
    rt.mem.write32(0x8008cb80, STARTBANK_STUB);
    rt.mem.write32(0x8008cb84, PENDING_STUB);
    // The tick and label builder are direct jal targets.
    rt.cpu.setStub(0x8008838c, (c) => {
        BOUND_CALLS.push(["tick", (c.reg(4) >>> 0) - OBJ_A]);
        return 0;
    });
    rt.cpu.setStub(0x80087d00, (c) => {
        BOUND_CALLS.push(["labels", (c.reg(4) >>> 0) - OBJ_A]);
        return 0;
    });
    return rt;
}

function norm(list) {
    return list.map(([m, a]) => [m, (a ?? []).slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function clearObj(rt, obj, size) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(obj + i, 0);
}

function portCreateHost() {
    return {
        shopId: () => SHOP_ID,
        shopMode: (stageId) => { MODE_CALLS.push(stageId | 0); return MODE; },
        bankRequest: (id) => { BANK_CALLS.push(id | 0); },
    };
}

function portChromeHost() {
    return {
        initDrawContext() {},
        setLayer(a, b) { INTENTS.push(["setLayer", [a, b]]); },
        setOrigin(a, b) { INTENTS.push(["setOrigin", [a, b]]); },
        setScale(a, b, z) { INTENTS.push(["setScale", [a, b, z]]); },
        setPos(a, b) { INTENTS.push(["setPos", [a, b]]); },
        drawSprite(a, b, x, y) { INTENTS.push(["drawSprite", [a, b, x, y]]); },
        packResolve(h) { return (h >>> 0) === 0x063e0000 ? PACK_PTR : 0; },
    };
}

function portLifecycleHost() {
    const h = portChromeHost();
    return Object.assign(h, {
        call8838c(obj) { BOUND_CALLS.push(["tick", (obj >>> 0) - OBJ_B]); },
        call87d00(obj) { BOUND_CALLS.push(["labels", (obj >>> 0) - OBJ_B]); },
        startBanks(v) { BOUND_CALLS.push(["start", v | 0]); },
        banksPending(v) { BOUND_CALLS.push(["pending", v | 0]); return PENDING; },
        baseMethod38(obj) { BOUND_CALLS.push(["m38", (obj >>> 0) - OBJ_B]); },
        resourceCall(a, b) { RES_CALLS.push([a | 0, b | 0]); },
        shopIdFor() { return SHOP_ID; },
    });
}

test("shopScreenCreate matches F0x80088CA0", () => {
    const rt = runtime();
    let HEAP = 0x80191000;
    const allocHost = {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = HEAP;
            HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
    rt.mem.write32(SHOP_SAVE_PTR_CELL, SAVE_BLOCK);
    const cases = [
        { stage: 0x211, mode: 0 },
        { stage: 0x280, mode: 0 },
        { stage: 0x2d6, mode: 0 },
        { stage: 0x999, mode: 0 },
        { stage: 0x211, mode: 0x400 },
        { stage: 0, mode: 0 },
    ];
    for (const c of cases) {
        rt.mem.write32(SHOP_STAGE_GLOBAL, c.stage);
        MODE = c.mode;
        SHOP_ID = 0x1234;
        BANK_CALLS.length = 0;
        MODE_CALLS.length = 0;
        HEAP = 0x80191000;
        const a = rt.cpu.call(0x80088ca0, []) >>> 0;
        const oracleBanks = BANK_CALLS.slice();
        const oracleModes = MODE_CALLS.slice();

        BANK_CALLS.length = 0;
        MODE_CALLS.length = 0;
        HEAP = 0x80191000;
        const b = shopScreenCreate(rt.mem, Object.assign({}, allocHost, portCreateHost())) >>> 0;

        const extraA = rt.mem.read32(a + 0x24) >>> 0;
        const extraB = rt.mem.read32(b + 0x24) >>> 0;
        assert.notEqual(extraA, 0, "original extra");
        assert.notEqual(extraB, 0, "port extra");
        for (let i = 0; i < SHOP_SCREEN_EXTRA; i++) {
            assert.equal(rt.mem.read8(extraB + i), rt.mem.read8(extraA + i), `extra +0x${i.toString(16)}`);
        }
        for (let off = 0; off < SHOP_SCREEN_SIZE; off += 4) {
            if (off === 0x24) continue;
            assert.equal(rt.mem.read32(b + off) >>> 0, rt.mem.read32(a + off) >>> 0,
                `stage ${c.stage.toString(16)} mode ${c.mode.toString(16)}: +0x${off.toString(16)}`);
        }
        assert.deepEqual(BANK_CALLS, oracleBanks, `stage ${c.stage.toString(16)}: bank requests`);
        assert.deepEqual(MODE_CALLS, oracleModes, `stage ${c.stage.toString(16)}: mode calls`);
    }

    const rt2 = runtime();
    rt2.mem.write32(SHOP_SAVE_PTR_CELL, SAVE_BLOCK);
    for (const [stage, expect] of [[0x211, 0x1f], [0x280, 0x20], [0x2d6, 0x28], [0x999, 0x1f]]) {
        rt2.mem.write32(SHOP_STAGE_GLOBAL, stage);
        MODE = 0;
        const obj = rt2.cpu.call(0x80088ca0, []) >>> 0;
        assert.equal(rt2.mem.read32(obj + 0x48) >>> 0, 0x80088b50, `stage ${stage.toString(16)}: handler`);
        assert.equal(rt2.mem.read32(obj + 0x3c8) >>> 0, 0x80088afc, `stage ${stage.toString(16)}: +0x3c8`);
        assert.equal(rt2.mem.read32(obj + 0x64) >>> 0, expect, `stage ${stage.toString(16)}: shop id`);
    }
});

test("shopDrawChrome matches F0x800880C4", () => {
    const rt = runtime();
    const cases = [
        { name: "idle", spin: 0, toggle: 0 },
        { name: "spin mid", spin: 5, toggle: 1 },
        { name: "spin wrap", spin: 0x5f, toggle: 1 },
        { name: "frame a", a: 0x1000 },
        { name: "frame a partial", a: 0x800 },
        { name: "frame b", b: 0x1000 },
        { name: "frame b partial", b: 0x400 },
        { name: "frame c", c: 0x1000 },
        { name: "frame c partial", c: 0x200 },
        { name: "all frames", a: 0x1000, b: 0x1000, c: 0x1000 },
    ];
    for (const cs of cases) {
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj, 0x400);
            rt.mem.write32(obj + 0x50, 0x1000);
            rt.mem.write32(obj + 0x54, 7);
            rt.mem.write32(obj + 0x58, cs.spin ?? 0);
            rt.mem.write32(obj + 0x5c, cs.toggle ?? 0);
            rt.mem.write32(obj + 0x3a0, cs.a ?? 0);
            rt.mem.write32(obj + 0x3b0, cs.b ?? 0);
            rt.mem.write32(obj + 0x3c0, cs.c ?? 0);
        }
        const before = rt.drawCalls.length;
        rt.cpu.call(0x800880c4, [OBJ_A], 30000);
        const oracle = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        rt.drawCalls.length = before;

        INTENTS.length = 0;
        shopDrawChrome(rt.mem, OBJ_B, portChromeHost());
        assert.deepEqual(norm(INTENTS), oracle, `${cs.name}: intents`);
        for (const off of [0x58, 0x5c]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                `${cs.name}: +0x${off.toString(16)}`);
        }
    }
});

test("shopScreenLifecycle matches F0x80088B50", () => {
    const rt = runtime();
    const cases = [
        { name: "state 1", state: 1, spin: 5, toggle: 1, a: 0x1000 },
        { name: "state 2", state: 2 },
        { name: "state 3 hot", state: 3, flag68: 1 },
        { name: "state 3 cold", state: 3, flag68: 0 },
        { name: "start sub 0", state: 0, sub: 0 },
        { name: "start sub 2", state: 0, sub: 2 },
        { name: "pending", state: 0, sub: 1, pending: 1 },
        { name: "ready", state: 0, sub: 1, pending: 0 },
    ];
    for (const cs of cases) {
        PENDING = cs.pending ?? 0;
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj, 0x400);
            rt.mem.write32(obj + 0x0c, cs.state);
            rt.mem.write32(obj + 0x10, cs.sub ?? 0);
            rt.mem.write32(obj + 0x50, 0x1000);
            rt.mem.write32(obj + 0x54, 7);
            rt.mem.write32(obj + 0x58, cs.spin ?? 0);
            rt.mem.write32(obj + 0x5c, cs.toggle ?? 0);
            rt.mem.write32(obj + 0x38, BASE38_STUB);
            rt.mem.write32(obj + 0x3a0, cs.a ?? 0);
            rt.mem.write32(obj + 0x68, cs.flag68 ?? 0);
        }
        rt.mem.write32(SHOP_STAGE_GLOBAL, 0x211);
        clearObj(rt, CTX_A, 0x40);
        clearObj(rt, CTX_B, 0x40);

        BANK_CALLS.length = 0;
        RES_CALLS.length = 0;
        BOUND_CALLS.length = 0;
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80088b50, [OBJ_A, CTX_A], 30000);
        const oracleIntents = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        const oracleBound = BOUND_CALLS.slice();
        const oracleRes = RES_CALLS.slice();
        rt.drawCalls.length = before;

        RES_CALLS.length = 0;
        BOUND_CALLS.length = 0;
        INTENTS.length = 0;
        shopScreenLifecycle(rt.mem, OBJ_B, CTX_B, portLifecycleHost());
        assert.deepEqual(BOUND_CALLS, oracleBound, `${cs.name}: boundary calls`);
        assert.deepEqual(RES_CALLS, oracleRes, `${cs.name}: resource calls`);
        assert.deepEqual(norm(INTENTS), oracleIntents, `${cs.name}: chrome intents`);
        for (const off of [0x10, 0x58, 0x5c, 0x398, 0x3a8, 0x3b8]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                `${cs.name}: +0x${off.toString(16)}`);
        }
    }
});
