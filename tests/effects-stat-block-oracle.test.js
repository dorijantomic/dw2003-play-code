// Phase 4 oracle: engine/dw3/ui/effects-card-helpers.ts effectsStatBlock
// (F0x80088A64) must produce the same 0x2C-byte stat block as the original.
// The original runs through engine/native and calls the real F0x80088DB8; the
// port calls the translated effectsStatAdd. The item-record getter is a shared
// stub on both sides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { effectsStatBlock } from "../engine/dw3/ui/effects-card-helpers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const PARTY = 0x80048d34;
const GEAR_BASE = 0x8004949c;
const SLOT = 1;
const RECORD = PARTY + SLOT * 0x3dc;
const GEAR = GEAR_BASE + SLOT * 0x3dc + 0x3c0;
const DEST_A = 0x80190000;
const DEST_B = 0x80190100;
const ITEM_STUB = 0x0fd80000;
const STATS_BASE = 0x80191000;

let ITEM_CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(ITEM_STUB, (c) => {
        const id = c.reg(4) | 0;
        ITEM_CALLS.push(id);
        return (ID_TO_RECORD.get(id) ?? 0) >>> 0;
    });
    rt.mem.write32(0x80042b98, ITEM_STUB);
    return rt;
}

const rt = runtime();
const ID_TO_RECORD = new Map();

function makeItem(id, klass, statsSeed) {
    const record = STATS_BASE + id * 0x40;
    const stats = STATS_BASE + 0x1000 + id * 0x40;
    ID_TO_RECORD.set(id, record);
    rt.mem.write8(record + 0x9, klass & 0xff);
    rt.mem.write32(record + 0x0, stats);
    rt.mem.write16(stats + 0x00, statsSeed.charisma ?? 0);
    rt.mem.write16(stats + 0x06, statsSeed.amount0 ?? 0);
    rt.mem.write16(stats + 0x08, statsSeed.amount1 ?? 0);
    rt.mem.write16(stats + 0x0a, statsSeed.addA ?? 0);
    rt.mem.write8(stats + 0x0a, statsSeed.codeA ?? 0);
    rt.mem.write8(stats + 0x0b, statsSeed.codeB ?? 0);
    rt.mem.write16(stats + 0x0c, statsSeed.addB ?? 0);
    rt.mem.write8(stats + 0x0c, statsSeed.codeC ?? 0);
    rt.mem.write8(stats + 0x0d, statsSeed.codeD ?? 0);
    rt.mem.write8(stats + 0x08, statsSeed.code1 ?? 0);
}

function seed(items, gearIds) {
    ITEM_CALLS = [];
    for (let i = 0; i < 0x2c; i++) rt.mem.write8(RECORD + 0x784 + i, (0x40 + i) & 0xff);
    for (let i = 0; i < 6; i++) rt.mem.write16(GEAR + 2 * i, (gearIds[i] ?? 0) & 0xffff);
    for (let i = 0; i < 0x30; i++) rt.mem.write8(DEST_A + i, 0xa5);
    for (let i = 0; i < 0x30; i++) rt.mem.write8(DEST_B + i, 0xa5);
    ID_TO_RECORD.clear();
    for (const it of items) makeItem(it.id, it.klass, it.stats);
}

function runCase(label, items, gearIds) {
    seed(items, gearIds);
    ITEM_CALLS = [];
    rt.cpu.call(0x80088a64, [SLOT, DEST_A]);
    const oracleCalls = ITEM_CALLS.slice();
    const oracle = [];
    for (let i = 0; i < 0x2c; i++) oracle.push(rt.mem.read8(DEST_A + i));

    seed(items, gearIds);
    ITEM_CALLS = [];
    effectsStatBlock(rt.mem, SLOT, DEST_B, {
        widgetSetLineNumber() {}, widgetMeasure() {}, widgetSetC0() {}, widgetSetFlagC1() {},
        itemRecord(id) { ITEM_CALLS.push(id | 0); return (ID_TO_RECORD.get(id | 0) ?? 0) >>> 0; },
    });
    const portCalls = ITEM_CALLS.slice();
    const port = [];
    for (let i = 0; i < 0x2c; i++) port.push(rt.mem.read8(DEST_B + i));

    assert.deepEqual(portCalls, oracleCalls, `${label}: item calls`);
    assert.deepEqual(port, oracle, `${label}: stat block`);
}

// The item-record helper signature needs itemRecord on its host type.
test("effectsStatBlock matches F0x80088A64", () => {
    const items = [
        { id: 0x10, klass: 5, stats: { charisma: 5, amount0: 0x111, amount1: 0x122, codeC: 1, codeD: 8, addA: 0x30 } },
        { id: 0x11, klass: 16, stats: { charisma: 7, amount0: 0x222, amount1: 0x333, codeA: 2, codeB: 0x0e, addB: 0x40 } },
        { id: 0x12, klass: 21, stats: { charisma: 9, amount0: 0x444, code1: 7 } },
        { id: 0x13, klass: 1, stats: { charisma: 3 } },
        { id: 0x14, klass: 25, stats: { charisma: 4 } },
        { id: 0x15, klass: 14, stats: { charisma: 2, amount0: 0x50, codeC: 7, codeD: 0 } },
        { id: 0x16, klass: 20, stats: { charisma: 1, amount0: 0x60, codeA: 0, codeB: 8, addB: 0x700 } },
        { id: 0x17, klass: 24, stats: { charisma: 6, amount0: 0x70, code1: 0 } },
    ];
    runCase("mixed gear", items, [0x10, 0x11, 0x12, 0x15, 0x16, 0x17]);
    runCase("negative skipped", items, [0xffff, 0x8000, 0, 0, 0, 0x14]);
    runCase("empty gear", items, [0, 0, 0, 0, 0, 0]);
    runCase("all classes", items, [0x13, 0x14, 0x17, 0x11, 0x12, 0x10]);
});
