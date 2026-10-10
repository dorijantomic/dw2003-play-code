// Phase 4 oracle: the text-element setter family in
// engine/dw3/ui/text-element-setters.ts must write exactly the bytes the
// original resident methods write, on the same object, for the same arguments.
// engine/native (the interpreter) runs each original address as the oracle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    setTextScroll,
    setTextWidgetOrigin,
    set_unk_0xc0_fns_8001a1f4,
    setVectorAndActiveFlag,
    setTextElementFlagC1,
    set_unk_0xc8_fns_8001a418,
    set_unk_0x58_fns_8001a448,
    set_unk_0xbf_fns_8001a450,
    getUnkC3,
    getUnkC1,
    isState1,
    setCurrentFetcherTable,
    CURRENT_FETCHER_TABLE,
    BOOT_GP,
} from "../engine/dw3/ui/text-element-setters.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const OBJ_A = 0x80150000;
const OBJ_B = 0x80150100;
const WIN = 0x100;

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function fill(rt, obj, unk62) {
    for (let i = 0; i < WIN; i++) rt.mem.write8(obj + i, 0xaa);
    rt.mem.write16(obj + 0x62, unk62 & 0xffff);
}

function bytes(rt, obj) {
    const out = [];
    for (let i = 0; i < WIN; i++) out.push(rt.mem.read8(obj + i));
    return out;
}

const rt = runtime();

function compare(label, addr, portFn, unk62, args) {
    fill(rt, OBJ_A, unk62);
    fill(rt, OBJ_B, unk62);
    rt.cpu.call(addr, [OBJ_A, ...args]);
    portFn(rt.mem, OBJ_B, ...args);
    assert.deepEqual(bytes(rt, OBJ_B), bytes(rt, OBJ_A), `${label} args=${JSON.stringify(args)} unk62=0x${unk62.toString(16)}`);
}

test("setTextScroll matches F0x8001A1B8", () => {
    const cases = [[1], [0], [-1], [32767], [-32768], [0x18000], [0x8000], [0xffff]];
    for (const a of cases) compare("setTextScroll", 0x8001a1b8, setTextScroll, 0x1234, a);
});

test("setTextWidgetOrigin matches F0x8001A1E8", () => {
    for (const a of [[1, 2], [0, 0], [-1, -2], [0x10001, 0x20002]]) {
        compare("setTextWidgetOrigin", 0x8001a1e8, setTextWidgetOrigin, 0x1234, a);
    }
});

test("set_unk_0xc0 matches F0x8001A1F4", () => {
    for (const a of [[0x41], [0xff], [0x100], [-1]]) {
        compare("set_unk_0xc0", 0x8001a1f4, set_unk_0xc0_fns_8001a1f4, 0x1234, a);
    }
});

test("setVectorAndActiveFlag matches F0x8001A204", () => {
    const cases = [[0, 0], [1, 0], [0, 1], [1, 2], [0x10000, 0], [0, 0x10000], [-1, 0], [0, -1], [0x8000, 0x8000]];
    for (const a of cases) compare("setVectorAndActiveFlag", 0x8001a204, setVectorAndActiveFlag, 0x1234, a);
});

test("setTextElementFlagC1 matches F0x8001A23C", () => {
    for (const unk62 of [0, 1, 0x8000]) {
        for (const a of [[5], [0xff], [0x100], [0]]) {
            compare("setTextElementFlagC1", 0x8001a23c, setTextElementFlagC1, unk62, a);
        }
    }
});

test("set_unk_0xc8 / set_unk_0x58 / set_unk_0xbf match their origins", () => {
    for (const a of [[0x12345678], [-1], [0]]) {
        compare("set_unk_0xc8", 0x8001a418, set_unk_0xc8_fns_8001a418, 0x1234, a);
        compare("set_unk_0x58", 0x8001a448, set_unk_0x58_fns_8001a448, 0x1234, a);
    }
    for (const a of [[0x7f], [0xff], [0x100], [0]]) {
        compare("set_unk_0xbf", 0x8001a450, set_unk_0xbf_fns_8001a450, 0x1234, a);
    }
});

// ── the getter/state leaves + the gp-relative fetcher-table store ───────────

test("getUnkC3 matches F0x8001A460", () => {
    for (const v of [0, 1, 0x7f, 0x80, 0xff]) {
        rt.mem.write8(OBJ_A + 0xc3, v);
        const oracle = rt.cpu.call(0x8001a460, [OBJ_A]) & 0xff;
        assert.equal(getUnkC3(rt.mem, OBJ_A), oracle, `v=0x${v.toString(16)}`);
    }
});

test("getUnkC1 matches F0x8001A46C", () => {
    for (const v of [0, 1, 0x7f, 0x80, 0xff]) {
        rt.mem.write8(OBJ_A + 0xc1, v);
        const oracle = rt.cpu.call(0x8001a46c, [OBJ_A]) & 0xff;
        assert.equal(getUnkC1(rt.mem, OBJ_A), oracle, `v=0x${v.toString(16)}`);
    }
});

test("isState1 matches F0x8001A478", () => {
    for (const v of [0, 1, 2, 3, 0xffffffff, 0x10000, 0x80000000, 0x7fffffff]) {
        rt.mem.write32(OBJ_A + 0x10, v >>> 0);
        const oracle = rt.cpu.call(0x8001a478, [OBJ_A]) | 0;
        assert.equal(isState1(rt.mem, OBJ_A), oracle, `v=0x${(v >>> 0).toString(16)}`);
    }
});

test("setCurrentFetcherTable matches F0x8001F738", () => {
    rt.cpu.gp = BOOT_GP;
    assert.equal(CURRENT_FETCHER_TABLE, (BOOT_GP + 0x1c8) >>> 0);
    for (const table of [0, 0x80010000, 0x801fffff, 0xffffffff]) {
        rt.mem.write32(CURRENT_FETCHER_TABLE, 0xdeadbeef);
        rt.cpu.call(0x8001f738, [table]);
        const oracle = rt.mem.read32(CURRENT_FETCHER_TABLE) >>> 0;
        assert.equal(oracle, table >>> 0, `store 0x${(table >>> 0).toString(16)}`);
        rt.mem.write32(CURRENT_FETCHER_TABLE, 0xdeadbeef);
        setCurrentFetcherTable(rt.mem, table);
        assert.equal(rt.mem.read32(CURRENT_FETCHER_TABLE) >>> 0, oracle, `port 0x${(table >>> 0).toString(16)}`);
    }
});
