// Phase 4 oracle: engine/dw3/ui/shop-actor-build.ts shopActorBuyBuild
// (F0x8008360C) must build the same context block and make the same calls in the
// same order. createTextElement / spawnUiIcon are deterministic boundary stubs
// on the original side and callbacks on the port side.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopActorBuyBuild, shopActorSellBuild } from "../engine/dw3/ui/shop-actor-build.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const BLOCK_A = 0x80181000;
const BLOCK_B = 0x80181100;
const CURSOR = 0x80182000;
const CURSOR_STUB = 0x0fd50000;
const TARGET = 0x1005;
const ORDER = 4;

function widgetAddr(k) {
    return (0x80183000 + k * 0x200) >>> 0;
}

test("shopActorBuyBuild matches F0x8008360C", () => {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(OBJ + 0x58, TARGET);
    rt.mem.write32(OBJ + 0x5c, ORDER);
    for (let i = 0; i < 0x24; i += 4) {
        rt.mem.write32(BLOCK_A + i, 0xdead);
        rt.mem.write32(BLOCK_B + i, 0xdead);
    }
    rt.mem.write32(CURSOR + 0x80, CURSOR_STUB);

    const oracleCreate = [];
    const oracleSpawn = [];
    const oracleCursor = [];
    rt.cpu.setStub(0x8001ae38, (c) => {
        oracleCreate.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return widgetAddr(oracleCreate.length - 1);
    });
    rt.cpu.setStub(0x8001b364, (c) => {
        oracleSpawn.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return CURSOR;
    });
    rt.cpu.setStub(CURSOR_STUB, (c) => { oracleCursor.push(c.reg(4) >>> 0); return 0; });
    rt.cpu.call(0x8008360c, [OBJ, BLOCK_A]);

    const portCreate = [];
    const portSpawn = [];
    const portCursor = [];
    const hostB = {
        createTextElement(target, kind, x, y) {
            portCreate.push([target | 0, kind | 0, x | 0, y | 0]);
            return widgetAddr(portCreate.length - 1);
        },
        spawnUiIcon(target, order, x, y) {
            portSpawn.push([target | 0, order | 0, x | 0, y | 0]);
            return CURSOR;
        },
        cursorActivate(cursor) { portCursor.push(cursor >>> 0); },
    };
    shopActorBuyBuild(rt.mem, OBJ, BLOCK_B, hostB);

    assert.deepEqual(portCreate, oracleCreate, "createTextElement sequence");
    assert.deepEqual(portSpawn, oracleSpawn, "spawnUiIcon call");
    assert.deepEqual(portCursor, oracleCursor, "cursor +0x80 call");
    for (let i = 0; i < 0x24; i += 4) {
        assert.equal(rt.mem.read32(BLOCK_B + i) >>> 0, rt.mem.read32(BLOCK_A + i) >>> 0, `block +0x${i.toString(16)}`);
    }
    // Sanity: six widgets then the cursor, and the target/order are the actor's.
    assert.equal(oracleCreate.length, 6);
    assert.equal(oracleSpawn.length, 1);
    assert.equal(oracleCreate[0][2], 0xb9);
    assert.equal(oracleCreate[1][2], 0x103);
    assert.equal(oracleSpawn[0][0], TARGET);
    assert.equal(oracleSpawn[0][1], ORDER - 1);
    assert.equal(rt.mem.read32(BLOCK_A + 0x20) >>> 0, CURSOR);
});

test("shopActorSellBuild matches F0x800859C0", () => {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(OBJ + 0x58, TARGET);
    rt.mem.write32(OBJ + 0x5c, ORDER);
    for (let i = 0; i < 0x38; i += 4) {
        rt.mem.write32(BLOCK_A + i, 0xdead);
        rt.mem.write32(BLOCK_B + i, 0xdead);
    }
    rt.mem.write32(CURSOR + 0x80, CURSOR_STUB);
    const callsA = [];
    rt.cpu.setStub(0x8001ae38, (c) => {
        callsA.push(["text", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return widgetAddr(callsA.filter((row) => row[0] === "text").length - 1);
    });
    rt.cpu.setStub(0x8001b364, (c) => {
        callsA.push(["cursor", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return CURSOR;
    });
    rt.cpu.setStub(CURSOR_STUB, (c) => { callsA.push(["hide", c.reg(4) >>> 0]); return 0; });
    rt.cpu.call(0x800859c0, [OBJ, BLOCK_A]);

    const callsB = [];
    shopActorSellBuild(rt.mem, OBJ, BLOCK_B, {
        createTextElement(target, kind, x, y) {
            callsB.push(["text", target | 0, kind | 0, x | 0, y | 0]);
            return widgetAddr(callsB.filter((row) => row[0] === "text").length - 1);
        },
        spawnUiIcon(target, order, x, y) {
            callsB.push(["cursor", target | 0, order | 0, x | 0, y | 0]);
            return CURSOR;
        },
        cursorActivate(cursor) { callsB.push(["hide", cursor >>> 0]); },
    });
    assert.deepEqual(callsB, callsA);
    for (let i = 0; i < 0x38; i += 4) {
        assert.equal(rt.mem.read32(BLOCK_B + i) >>> 0, rt.mem.read32(BLOCK_A + i) >>> 0,
            `block +0x${i.toString(16)}`);
    }
    assert.equal(callsB.filter((row) => row[0] === "text").length, 11);
});
