// Phase 4 oracle: engine/dw3/ui/folder-list-create.ts folderListCreateLabels
// must make the same calls, in the same order, and fill the same slot array as
// the original F0x80088B34. The two untranslated callees (createTextElement,
// spawnUiIcon) are deterministic boundary stubs on the original side and
// callbacks on the port side; the +0x15C call runs the real set_unk_0x58.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { folderListCreateLabels } from "../engine/dw3/ui/folder-list-create.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stcrddek = new Uint8Array(readFileSync(join(dir, "pro_stcrddek.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stcrddek.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80180000;
const SLOTS_A = 0x80181000;
const SLOTS_B = 0x80182000;
const WIDGET_BASE = 0x80183000;
const WIDGET_STRIDE = 0x100;
const CURSOR = 0x80185000;
const SET_UNK_58 = 0x8001a448;
const CURSOR_STUB = 0x0fd10000;
const BUCKET = 0x20;
const SLOT_COUNT = 27;

function widgetAddr(k) {
    return (WIDGET_BASE + k * WIDGET_STRIDE) >>> 0;
}

test("folderListCreateLabels matches F0x80088B34", () => {
    const rt = new NativeStageRuntime(stcrddek, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    // Fixtures.
    rt.mem.write32(SCREEN + 0x50, 0x1000);
    rt.mem.write32(SCREEN + 0x54, BUCKET);
    rt.mem.write32(SCREEN + 0x20, SLOT_COUNT);
    for (let k = 0; k < 24; k++) rt.mem.write32(widgetAddr(k) + 0x15c, SET_UNK_58);
    rt.mem.write32(CURSOR + 0x80, CURSOR_STUB);

    // Original-side boundary stubs.
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
    rt.cpu.setStub(CURSOR_STUB, (c) => {
        oracleCursor.push(c.reg(4) >>> 0);
        return 0;
    });

    rt.cpu.call(0x80088b34, [SCREEN, SLOTS_A]);

    // Original widgets' +0x15C effect.
    const oracleWidget58 = [];
    for (let k = 0; k < 24; k++) oracleWidget58.push(rt.mem.read32(widgetAddr(k) + 0x58) | 0);
    const oracleSlots = [];
    for (let i = 0; i <= 0x64 / 4; i++) oracleSlots.push(rt.mem.read32(SLOTS_A + i * 4) >>> 0);

    // Port side.
    for (let k = 0; k < 24; k++) rt.mem.write32(widgetAddr(k) + 0x58, 0xdeadbeef);
    const portCreate = [];
    const portSpawn = [];
    const portCursor = [];
    const hostB = {
        createTextElement(target, kind, x, y) {
            portCreate.push([target | 0, kind | 0, x | 0, y | 0]);
            return widgetAddr(portCreate.length - 1);
        },
        spawnUiIcon(target, value, x, y) {
            portSpawn.push([target | 0, value | 0, x | 0, y | 0]);
            return CURSOR;
        },
        cursorActivate(cursor) {
            portCursor.push(cursor >>> 0);
        },
    };
    folderListCreateLabels(rt.mem, SCREEN, SLOTS_B, hostB);

    assert.deepEqual(portCreate, oracleCreate, "createTextElement call sequence");
    assert.deepEqual(portSpawn, oracleSpawn, "spawnUiIcon call");
    assert.deepEqual(portCursor, oracleCursor, "cursor +0x80 call");
    const portWidget58 = [];
    for (let k = 0; k < 24; k++) portWidget58.push(rt.mem.read32(widgetAddr(k) + 0x58) | 0);
    assert.deepEqual(portWidget58, oracleWidget58, "widget +0x58 values");
    const portSlots = [];
    for (let i = 0; i <= 0x64 / 4; i++) portSlots.push(rt.mem.read32(SLOTS_B + i * 4) >>> 0);
    assert.deepEqual(portSlots, oracleSlots, "slot array");
    // Sanity: 24 widgets + cursor, and every +0x15C value is bucket-2.
    assert.equal(oracleSpawn.length, 1);
    assert.equal(oracleCreate.length, 24);
    for (const v of oracleWidget58) assert.equal(v, (BUCKET - 2) | 0);
});
