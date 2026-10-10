// Phase 4 oracle: engine/dw3/ui/shop-list-build.ts shopListBuild must build the
// same slot array and make the same calls, in the same order, as the original
// F0x80087428. createTextElement and spawnUiIcon are deterministic boundary
// stubs on the original side and callbacks on the port side; the widget +0x15C
// store runs the real translated set_unk_0x58 on both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopListBuild } from "../engine/dw3/ui/shop-list-build.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const SLOTS_A = 0x80181000;
const SLOTS_B = 0x80181100;
const WIDGET_BASE = 0x80182000;
const WIDGET_STRIDE = 0x200;
const CURSOR = 0x80188000;
const SET_UNK_58 = 0x8001a448;
const CURSOR_STUB = 0x0fd10000;
const TARGET = 0x1005;
const ORDER = 4;
const MODE = 1;

function widgetAddr(k) {
    return (WIDGET_BASE + k * WIDGET_STRIDE) >>> 0;
}

test("shopListBuild matches F0x80087428", () => {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(OBJ + 0x54, TARGET);
    rt.mem.write32(OBJ + 0x58, ORDER);
    rt.mem.write32(OBJ + 0x5c, MODE);
    rt.mem.write32(CURSOR + 0x80, CURSOR_STUB);

    // Original-side boundary stubs.
    const oracleCreate = [];
    const oracleSpawn = [];
    const oracleCursor = [];
    rt.cpu.setStub(0x8001ae38, (c) => {
        oracleCreate.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const w = widgetAddr(oracleCreate.length - 1);
        rt.mem.write32(w + 0x15c, SET_UNK_58);
        return w;
    });
    rt.cpu.setStub(0x8001b364, (c) => {
        oracleSpawn.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return CURSOR;
    });
    rt.cpu.setStub(CURSOR_STUB, (c) => {
        oracleCursor.push(c.reg(4) >>> 0);
        return 0;
    });

    for (let k = 0; k < 19; k++) rt.mem.write32(widgetAddr(k) + 0x58, 0xdeadbeef | 0);
    rt.cpu.call(0x80087428, [OBJ, SLOTS_A]);

    const oracleWidget58 = [];
    for (let k = 0; k < 19; k++) oracleWidget58.push(rt.mem.read32(widgetAddr(k) + 0x58) | 0);
    const oracleSlots = [];
    for (let i = 0; i <= 0x4c / 4; i++) oracleSlots.push(rt.mem.read32(SLOTS_A + i * 4) >>> 0);

    // Port side.
    for (let k = 0; k < 19; k++) rt.mem.write32(widgetAddr(k) + 0x58, 0xdeadbeef | 0);
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
        cursorActivate(cursor) {
            portCursor.push(cursor >>> 0);
        },
    };
    shopListBuild(rt.mem, OBJ, SLOTS_B, hostB);

    assert.deepEqual(portCreate, oracleCreate, "createTextElement call sequence");
    assert.deepEqual(portSpawn, oracleSpawn, "spawnUiIcon call");
    assert.deepEqual(portCursor, oracleCursor, "cursor +0x80 call");
    const portWidget58 = [];
    for (let k = 0; k < 19; k++) portWidget58.push(rt.mem.read32(widgetAddr(k) + 0x58) | 0);
    assert.deepEqual(portWidget58, oracleWidget58, "widget +0x58 values");
    const portSlots = [];
    for (let i = 0; i <= 0x4c / 4; i++) portSlots.push(rt.mem.read32(SLOTS_B + i * 4) >>> 0);
    assert.deepEqual(portSlots, oracleSlots, "slot array");

    // Sanity: 19 widgets + cursor, and every +0x58 is order-1.
    assert.equal(oracleCreate.length, 19);
    assert.equal(oracleSpawn.length, 1);
    for (const v of oracleWidget58.slice(0, 14)) assert.equal(v, (ORDER - 1) | 0);
    // The first row's x is 0x37, the second is 0x37+0x83.
    assert.equal(oracleCreate[0][2], 0x37);
    assert.equal(oracleCreate[1][2], 0x37 + 0x83);
    // The five labels and the cursor were wired at their fixed slots.
    assert.equal(oracleSlots[0x4c / 4], CURSOR);
    assert.equal(oracleSpawn[0][0], TARGET);
    assert.equal(oracleSpawn[0][1], (ORDER - 1) | 0);
    assert.equal(oracleSpawn[0][2], 0x1d);
    assert.equal(oracleSpawn[0][3], 0x24);
});
