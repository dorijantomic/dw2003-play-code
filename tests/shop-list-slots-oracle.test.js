// Phase 4 oracle: engine/dw3/ui/shop-list-slots.ts must match the original shop
// list object's class slots F0x800887C4 / F0x800887EC / F0x80088830 /
// F0x80088714 / F0x80088670. Each original slot runs through engine/native from
// the stitshop overlay; the port side reuses the translated cursor setters. The
// base state setter at self+0x28 is the host-served core stub F0x80014274 on
// both sides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    shopListActivate,
    shopListMoveCursor,
    shopListReset,
    shopListSelectedId,
    shopListSetCursorVisible,
} from "../engine/dw3/ui/shop-list-slots.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80180000;
const OBJ_B = 0x80181000;
const SEC_A = 0x80182000;
const SEC_B = 0x80182100;
const CUR_A = 0x80183000;
const CUR_B = 0x80183100;
const STOCK = 0x80184000;
const SET_STATE = 0x80014274;
const CURSOR_METHODS = [
    [0x80, 0x8001b04c],
    [0x84, 0x8001b068],
    [0x88, 0x8001b07c],
    [0x94, 0x8001b09c],
];

const IDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 222, 333, 444, 555];

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function zero(rt, base, size) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(base + i, 0);
}

function initSide(rt, obj, sec, cur, opts) {
    zero(rt, obj, 0x720);
    zero(rt, sec, 0x50);
    zero(rt, cur, 0x98);
    rt.mem.write32(obj + 0x24, sec);
    rt.mem.write32(obj + 0x28, SET_STATE);
    rt.mem.write32(sec + 0x4c, cur);
    for (const [off, value] of CURSOR_METHODS) rt.mem.write32(cur + off, value);
    // Cursor sentinels so every setter's writes are visible in the comparison.
    for (const [off, value] of [[0x10, 0x55], [0x70, 0x66], [0x64, 0x77], [0x58, 0x88],
        [0x5c, 0x99], [0x60, 0xaa], [0x68, 0xbb], [0x7c, 0xcc], [0x74, 0xdd], [0x78, 0xee]]) {
        rt.mem.write32(cur + off, value);
    }
    rt.mem.write32(obj + 0x5c, opts.mode ?? 0);
    rt.mem.write32(obj + 0x6b4, STOCK);
    rt.mem.write32(obj + 0x6bc, opts.idx ?? 0);
    rt.mem.write32(obj + 0x6d4, opts.pageSize ?? 4);
    rt.mem.write32(obj + 0x6b8, 0x1234);
    for (let i = 0; i < IDS.length; i++) {
        rt.mem.write16(STOCK + i * 2, IDS[i]);
        rt.mem.write16(obj + 0x64 + i * 2, 0x8000 | IDS[i]);
    }
}

function compare(label, rt, baseA, baseB, size, masks) {
    for (let off = 0; off < size; off += 4) {
        const a = rt.mem.read32(baseA + off) >>> 0;
        const b = rt.mem.read32(baseB + off) >>> 0;
        if (masks.includes(off)) {
            assert.notEqual(a, 0, `${label} +0x${off.toString(16)} original pointer`);
            assert.notEqual(b, 0, `${label} +0x${off.toString(16)} port pointer`);
            continue;
        }
        assert.equal(b, a, `${label} +0x${off.toString(16)}`);
    }
}

function portHost(rt) {
    return {
        setState(obj, v) {
            rt.mem.write32(obj + 0xc, v | 0);
            rt.mem.write32(obj + 0x10, 0);
            rt.mem.write32(obj + 0x14, 0);
            rt.mem.write32(obj + 0x18, 0);
        },
    };
}

function runCase(label, opts, invoke) {
    const rt = runtime();
    initSide(rt, OBJ_A, SEC_A, CUR_A, opts);
    invoke(rt, "original", opts);
    initSide(rt, OBJ_B, SEC_B, CUR_B, opts);
    invoke(rt, "port", opts);
    compare(`${label} obj`, rt, OBJ_A, OBJ_B, 0x720, [0x24]);
    compare(`${label} secondary`, rt, SEC_A, SEC_B, 0x50, [0x4c]);
    compare(`${label} cursor`, rt, CUR_A, CUR_B, 0x98, []);
}

test("shopListActivate / shopListReset match F0x800887C4 / F0x800887EC", () => {
    runCase("activate", {}, (rt, side) => {
        if (side === "original") rt.cpu.call(0x800887c4, [OBJ_A]);
        else shopListActivate(rt.mem, portHost(rt), OBJ_B);
    });
    runCase("reset", {}, (rt, side) => {
        if (side === "original") rt.cpu.call(0x800887ec, [OBJ_A]);
        else shopListReset(rt.mem, portHost(rt), OBJ_B);
    });
    // Sanity: the reset really armed +0x10 and moved the cursor to row 0.
    const rt = runtime();
    initSide(rt, OBJ_A, SEC_A, CUR_A, { idx: 5, pageSize: 4 });
    rt.cpu.call(0x800887ec, [OBJ_A]);
    assert.equal(rt.mem.read32(OBJ_A + 0x10) >>> 0, 0x32, "state1");
    assert.equal(rt.mem.read32(OBJ_A + 0x6b8) >>> 0, 0, "cursor visible latch");
    assert.equal(rt.mem.read32(CUR_A + 0x64) >>> 0, 0, "cursor hidden");
});

test("shopListSelectedId matches F0x80088830", () => {
    const rt = runtime();
    for (const opts of [
        { mode: 0, idx: 0, pageSize: 4 },
        { mode: 0, idx: 3, pageSize: 4 },
        { mode: 0, idx: 13, pageSize: 8 },
        { mode: 1, idx: 0, pageSize: 4 },
        { mode: 1, idx: 5, pageSize: 8 },
        { mode: 1, idx: 13, pageSize: 8 },
    ]) {
        initSide(rt, OBJ_A, SEC_A, CUR_A, opts);
        initSide(rt, OBJ_B, SEC_B, CUR_B, opts);
        const a = rt.cpu.call(0x80088830, [OBJ_A]) | 0;
        const b = shopListSelectedId(rt.mem, OBJ_B) | 0;
        assert.equal(b, a, `selected id mode=${opts.mode} idx=${opts.idx}`);
    }
    // Sanity: the inline halfwords are high-bit set, so a signed read is visible.
    initSide(rt, OBJ_B, SEC_B, CUR_B, { mode: 1, idx: 0, pageSize: 4 });
    assert.equal(shopListSelectedId(rt.mem, OBJ_B) | 0, (0x8000 | IDS[0]) << 16 >> 16);
});

test("shopListMoveCursor / shopListSetCursorVisible match F0x80088714 / F0x80088670", () => {
    for (const opts of [
        { idx: 0, pageSize: 4 },
        { idx: 1, pageSize: 4 },
        { idx: 2, pageSize: 4 },
        { idx: 5, pageSize: 4 },
        { idx: 7, pageSize: 8 },
        { idx: 13, pageSize: 8 },
    ]) {
        runCase(`move idx=${opts.idx} page=${opts.pageSize} vis=1`, opts, (rt, side) => {
            if (side === "original") rt.cpu.call(0x80088714, [OBJ_A, 1]);
            else shopListMoveCursor(rt.mem, OBJ_B, 1);
        });
        runCase(`move idx=${opts.idx} page=${opts.pageSize} vis=0`, { ...opts, }, (rt, side) => {
            if (side === "original") rt.cpu.call(0x80088714, [OBJ_A, 0]);
            else shopListMoveCursor(rt.mem, OBJ_B, 0);
        });
    }
    runCase("cursor on", {}, (rt, side) => {
        if (side === "original") rt.cpu.call(0x80088670, [OBJ_A, 1]);
        else shopListSetCursorVisible(rt.mem, OBJ_B, 1);
    });
    runCase("cursor off", {}, (rt, side) => {
        if (side === "original") rt.cpu.call(0x80088670, [OBJ_A, 0]);
        else shopListSetCursorVisible(rt.mem, OBJ_B, 0);
    });
    // Sanity: idx 2 in a page of 4 is column 0, row 1, so x = 0x1d and
    // y = 1*0xE + 0x24.
    const rt = runtime();
    initSide(rt, OBJ_A, SEC_A, CUR_A, { idx: 2, pageSize: 4 });
    rt.cpu.call(0x80088714, [OBJ_A, 1]);
    assert.equal(rt.mem.read32(CUR_A + 0x58) | 0, 0x1d, "cursor x");
    assert.equal(rt.mem.read32(CUR_A + 0x5c) | 0, 1 * 0x0e + 0x24, "cursor y");
    assert.equal(rt.mem.read32(OBJ_A + 0x6b8) | 0, 1, "cursor latch");
});
