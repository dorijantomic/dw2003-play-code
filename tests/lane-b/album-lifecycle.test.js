// Lane B Phase 4 oracle: engine/dw3/ui/native/album-lifecycle.ts must match the
// original pro/stcrdabm album screen bodies.
//
//   F0x8008566C  albumScreenCreate
//   F0x80085540  albumScreenLifecycle
//   F0x80084500  albumDrawChrome
//
// The original runs through engine/native (the interpreter) as the oracle. The
// draw context is recorded into rt.drawCalls; the widget constructors/methods,
// the [0x80044B38]/[0x80044F4C] resource services, the panel/labels builder, the
// tick, the base methods and the bank service cells are stubs on both sides. The
// chrome's text context F0x8001EBF8 is a stub too, so its ordered calls are
// compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    ALBUM_SCREEN_EXTRA,
    ALBUM_SCREEN_SIZE,
    albumDrawChrome,
    albumScreenCreate,
    albumScreenLifecycle,
} from "../../engine/dw3/ui/native/album-lifecycle.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const album = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: album.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x801a0000;
const OBJ_B = 0x801a0400;
const CTX_A = 0x801a1000;
const CTX_B = 0x801a1200;
const PACK_PTR = 0x801b9000;
const TEXT_CTX = 0x801bd000;

const PACK_STUB = 0x0fd80000;
const BANKS_START = 0x0fd80004;
const BANKS_READY = 0x0fd80008;
const TEXT_CTX_FILL = 0x8001ebf8;
const M38 = 0x0fd80010;
const TICK = 0x80084c38;
const LABELS = 0x80083bfc;
const RES_CALL = 0x0fd80014;
const RES_2714 = 0x0fd80018;

const ARITY = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4, textFill: 1, textSetPos: 1, textStatus: 0 };

let READY = 0;
let FRAME = 100;
let TXT_STATUS = 0;
const BOUND_CALLS = [];
const BANK_CALLS = [];
const RES_CALLS = [];
const INTENTS = [];
const TEXT_CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(album, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.mem.write32(0x8004de20, FRAME);
    rt.cpu.setStub(PACK_STUB, (c) => ((c.reg(4) >>> 0) === 0x06050000 ? PACK_PTR : 0));
    rt.cpu.setStub(BANKS_START, (c) => { BANK_CALLS.push(["start", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(BANKS_READY, (c) => { BANK_CALLS.push(["ready", c.reg(4) | 0]); return READY; });
    rt.cpu.setStub(M38, (c) => { BOUND_CALLS.push(["m38", (c.reg(4) >>> 0) - OBJ_A]); return 0; });
    rt.cpu.setStub(TICK, (c) => { BOUND_CALLS.push(["tick", (c.reg(4) >>> 0) - OBJ_A, (c.reg(5) >>> 0) - CTX_A]); return 0; });
    rt.cpu.setStub(LABELS, (c) => { BOUND_CALLS.push(["labels", (c.reg(4) >>> 0) - OBJ_A, (c.reg(5) >>> 0) - CTX_A]); return 0; });
    rt.cpu.setStub(RES_CALL, (c) => { RES_CALLS.push([c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(RES_2714, (c) => { RES_CALLS.push(["2714", c.reg(4) | 0]); return 0x11; });
    rt.cpu.setStub(TEXT_CTX_FILL, (c) => {
        const ctx = c.reg(4) >>> 0;
        TEXT_CALLS.push("textFill");
        for (let i = 0; i < 0x60; i += 4) rt.mem.write32(ctx + i, 0);
        return 0;
    });
    // text context methods: +0x2C = setPos, +0x50 = status
    rt.cpu.setStub(0x8001ec10, (c) => { INTENTS.push(["textSetPos", [c.reg(4) | 0]]); return 0; });
    rt.cpu.setStub(0x8001ec40, () => { INTENTS.push(["textStatus", []]); return TXT_STATUS; });
    rt.mem.write32(TEXT_CTX + 0x2c, 0x8001ec10);
    rt.mem.write32(TEXT_CTX + 0x50, 0x8001ec40);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x80048d34 + 0x270c, RES_CALL);
    rt.mem.write32(0x80048d34 + 0x2714, RES_2714);
    rt.mem.write32(0x80085a64, BANKS_START);
    rt.mem.write32(0x80085a68, BANKS_READY);
    return rt;
}

function norm(list) {
    return list.map(([m, a]) => [m, (a ?? []).slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function clearObj(rt, obj, size) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(obj + i, 0);
}

function portCreateHost() {
    return { alloc: () => 0 };
}

function portChromeHost() {
    return {
        initDrawContext() {},
        setLayer(a, b) { INTENTS.push(["setLayer", [a, b]]); },
        setOrigin(a, b) { INTENTS.push(["setOrigin", [a, b]]); },
        setScale(a, b, z) { INTENTS.push(["setScale", [a, b, z]]); },
        setPos(a, b) { INTENTS.push(["setPos", [a, b]]); },
        m_0x88(a) { INTENTS.push(["m_0x88", [a]]); },
        drawSprite(a, b, x, y) { INTENTS.push(["drawSprite", [a, b, x, y]]); },
        packResolve(h) { return (h >>> 0) === 0x06050000 ? PACK_PTR : 0; },
        initTextContext() { TEXT_CALLS.push("textFill"); },
        textSetPos(x) { TEXT_CALLS.push(`textSetPos:${x | 0}`); },
        textStatus() { TEXT_CALLS.push("textStatus"); return TXT_STATUS; },
        textPage() { return 0; },
        frame() { return FRAME; },
    };
}

function portLifecycleHost() {
    const h = portChromeHost();
    return Object.assign(h, {
        call84c38(obj, ctx) { BOUND_CALLS.push(["tick", (obj >>> 0) - OBJ_B, (ctx >>> 0) - CTX_B]); },
        call83bfc(obj, ctx) { BOUND_CALLS.push(["labels", (obj >>> 0) - OBJ_B, (ctx >>> 0) - CTX_B]); },
        startBanks(v) { BANK_CALLS.push(["start", v | 0]); },
        banksPending(v) { BANK_CALLS.push(["ready", v | 0]); return READY; },
        baseMethod38(obj) { BOUND_CALLS.push(["m38", (obj >>> 0) - OBJ_B]); },
        resourceCall(a, b) { RES_CALLS.push([a | 0, b | 0]); },
        resource2714(flag) { RES_CALLS.push(["2714", flag | 0]); return 0x11; },
    });
}

test("albumScreenCreate matches F0x8008566C", () => {
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
    for (let run = 0; run < 3; run++) {
        HEAP = 0x80191000;
        const a = rt.cpu.call(0x8008566c, []) >>> 0;
        HEAP = 0x80191000;
        const b = albumScreenCreate(rt.mem, allocHost) >>> 0;
        const extraA = rt.mem.read32(a + 0x24) >>> 0;
        const extraB = rt.mem.read32(b + 0x24) >>> 0;
        assert.notEqual(extraA, 0, "original extra");
        assert.notEqual(extraB, 0, "port extra");
        for (let i = 0; i < ALBUM_SCREEN_EXTRA; i++) {
            assert.equal(rt.mem.read8(extraB + i), rt.mem.read8(extraA + i), `extra +0x${i.toString(16)}`);
        }
        for (let off = 0; off < ALBUM_SCREEN_SIZE; off += 4) {
            if (off === 0x24) continue;
            assert.equal(rt.mem.read32(b + off) >>> 0, rt.mem.read32(a + off) >>> 0, `+0x${off.toString(16)}`);
        }
    }
    const rt2 = runtime();
    const obj = rt2.cpu.call(0x8008566c, []) >>> 0;
    assert.equal(rt2.mem.read32(obj + 0x48) >>> 0, 0x80085540, "handler");
    assert.equal(rt2.mem.read32(obj + 0x50) >>> 0, 0x1000, "+0x50");
    assert.equal(rt2.mem.read32(obj + 0x54) >>> 0, 7, "+0x54");
});

test("albumDrawChrome matches F0x80084500", () => {
    const rt = runtime();
    const cases = [
        { name: "idle", spin: 0, toggle: 0 },
        { name: "spin mid", spin: 5, toggle: 1 },
        { name: "spin wrap", spin: 0x5f, toggle: 1 },
        { name: "c0 full", c0: 0x1000 },
        { name: "c0 part", c0: 0x800 },
        { name: "arrows", flag68: 1, count: 5, sel: 2, dir: 1, stamp: 0, frame: 5 },
        { name: "cursor", flag68: 1, flag7c: 1, b0: 4, b4: 0, stamp: 0, frame: 5, sel: 3 },
        { name: "text idle", d0: 0x1000, card: 0x45, status: 0 },
        { name: "text page", d0: 0x1000, card: 0x10, status: 0, page: 0 },
        { name: "text busy", d0: 0x800, card: 0x70, status: 0 },
        { name: "text busy2", d0: 0x1000, card: 0x70, status: 0 },
    ];
    for (const cs of cases) {
        FRAME = 100;
        TXT_STATUS = cs.status ?? 0;
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj, 0x100);
            rt.mem.write32(obj + 0x50, 0x1000);
            rt.mem.write32(obj + 0x54, 7);
            rt.mem.write32(obj + 0x58, cs.spin ?? 0);
            rt.mem.write32(obj + 0x5c, cs.toggle ?? 0);
            rt.mem.write32(obj + 0xc0, cs.c0 ?? 0);
            rt.mem.write32(obj + 0x60, cs.sel ?? 0);
            rt.mem.write32(obj + 0x64, cs.count ?? 0);
            rt.mem.write32(obj + 0x68, cs.flag68 ?? 0);
            rt.mem.write32(obj + 0x6c, cs.dir ?? 0);
            rt.mem.write32(obj + 0x70, cs.stamp ?? 0);
            rt.mem.write32(obj + 0x74, cs.sel ?? 0);
            rt.mem.write32(obj + 0x78, cs.card ?? 0);
            rt.mem.write32(obj + 0x7c, cs.flag7c ?? 0);
            rt.mem.write32(obj + 0xb0, cs.b0 ?? 0);
            rt.mem.write32(obj + 0xb4, cs.b4 ?? 0);
            rt.mem.write32(obj + 0xd0, cs.d0 ?? 0);
        }
        const before = rt.drawCalls.length;
        TEXT_CALLS.length = 0;
        rt.cpu.call(0x80084500, [OBJ_A], 30000);
        const oracle = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        const oracleText = TEXT_CALLS.slice();
        rt.drawCalls.length = before;

        INTENTS.length = 0;
        TEXT_CALLS.length = 0;
        albumDrawChrome(rt.mem, OBJ_B, portChromeHost());
        assert.deepEqual(norm(INTENTS), oracle, `${cs.name}: intents`);
        if ((cs.d0 ?? 0) !== 0) assert.equal(TEXT_CALLS[0], "textFill", `${cs.name}: text context reset`);
        else assert.equal(TEXT_CALLS.length, 0, `${cs.name}: no text context`);
        for (const off of [0x58, 0x5c, 0x6c, 0x70, 0xb0, 0xb4]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                `${cs.name}: +0x${off.toString(16)}`);
        }
    }
});

test("albumScreenLifecycle matches F0x80085540", () => {
    const rt = runtime();
    const cases = [
        { name: "state 1", state: 1, spin: 5, toggle: 1, c0: 0x1000 },
        { name: "state 2", state: 2 },
        { name: "state 3", state: 3 },
        { name: "start sub 0", state: 0, sub: 0 },
        { name: "start sub 2", state: 0, sub: 2 },
        { name: "pending", state: 0, sub: 1, ready: 1 },
        { name: "ready", state: 0, sub: 1, ready: 0 },
    ];
    for (const cs of cases) {
        READY = cs.ready ?? 0;
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj, 0x100);
            rt.mem.write32(obj + 0x0c, cs.state);
            rt.mem.write32(obj + 0x10, cs.sub ?? 0);
            rt.mem.write32(obj + 0x38, M38);
            rt.mem.write32(obj + 0x50, 0x1000);
            rt.mem.write32(obj + 0x54, 7);
            rt.mem.write32(obj + 0x58, cs.spin ?? 0);
            rt.mem.write32(obj + 0x5c, cs.toggle ?? 0);
            rt.mem.write32(obj + 0xc0, cs.c0 ?? 0);
        }
        clearObj(rt, CTX_A, 0x40);
        clearObj(rt, CTX_B, 0x40);

        BOUND_CALLS.length = 0;
        BANK_CALLS.length = 0;
        RES_CALLS.length = 0;
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80085540, [OBJ_A, CTX_A], 30000);
        const oracleIntents = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        const oracleBound = BOUND_CALLS.slice();
        const oracleBanks = BANK_CALLS.slice();
        const oracleRes = RES_CALLS.slice();
        rt.drawCalls.length = before;

        BOUND_CALLS.length = 0;
        BANK_CALLS.length = 0;
        RES_CALLS.length = 0;
        INTENTS.length = 0;
        albumScreenLifecycle(rt.mem, OBJ_B, CTX_B, portLifecycleHost());
        assert.deepEqual(BOUND_CALLS, oracleBound, `${cs.name}: boundary calls`);
        assert.deepEqual(BANK_CALLS, oracleBanks, `${cs.name}: bank calls`);
        assert.deepEqual(RES_CALLS, oracleRes, `${cs.name}: resource calls`);
        assert.deepEqual(norm(INTENTS), oracleIntents, `${cs.name}: chrome intents`);
        for (const off of [0x10, 0x58, 0x5c, 0x64, 0x78, 0xb8, 0xc8]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                `${cs.name}: +0x${off.toString(16)}`);
        }
    }
});
