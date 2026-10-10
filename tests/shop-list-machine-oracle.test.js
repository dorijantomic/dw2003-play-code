// Phase 4 oracle: engine/dw3/ui/shop-list-machine.ts shopListInit (F0x80087CFC)
// and shopListTick (F0x80087EC0) must match the original. The original runs
// through engine/native with every callee stubbed to record; the port gets the
// same boundaries as callbacks. The cursor position setter is the real resident
// F0x8001B068 on the original side and the translated uiIconSetPos on the port.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopListInit, shopListTick } from "../engine/dw3/ui/shop-list-machine.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80180000;
const OBJ_B = 0x80181000;
const LCTX_A = 0x80182000;
const LCTX_B = 0x80182400;
const CUR_A = 0x80183000;
const CUR_B = 0x80183400;
const PARENT = 0x80184000;
const STOCK = 0x80185000;
const SET_STATE = 0x80014274;
const ADVANCE = 0x800142ac;
const CURSOR_POS = 0x8001b068;
const FOLD_START = 0x0fd30000;
const FOLD_TICK = 0x0fd30010;
const LOAD = 0x0fd30020;
const HIGHLIGHT = 0x0fd30030;
const SFX_STUB = 0x0fd30040;
const IDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 222, 333, 444, 555, 666, 777, 888, 999, 1010, 1111];
const STOCK_LEN = 20;
const SELL_COUNT = 17;
const BIT_L1 = 0x400;
const BIT_R1 = 0x800;
const BIT_UP = 0x10;
const BIT_RIGHT = 0x20;
const BIT_DOWN = 0x40;
const BIT_LEFT = 0x80;

let EV = [];
let LAST_SFX = 0;
let PAD = { pressed: 0, held: 0, repeat: 0, ready: 1 };

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

function installStubs(rt) {
    rt.cpu.setStub(SET_STATE, (c) => {
        EV.push(["setState", c.reg(5) | 0]);
        const o = c.reg(4);
        rt.mem.write32(o + 0xc, c.reg(5));
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        return 0;
    });
    rt.cpu.setStub(ADVANCE, (c) => {
        EV.push(["advanceState"]);
        const o = c.reg(4);
        const v = (rt.mem.read32(o + 0xc) | 0) + 1;
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        rt.mem.write32(o + 0xc, v);
        return v;
    });
    rt.cpu.setStub(0x80087428, () => { EV.push(["buildList"]); return 0; });
    rt.cpu.setStub(0x800875e0, (c) => { EV.push(["readout", c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x80087920, () => { EV.push(["drawList"]); return 0; });
    rt.cpu.setStub(0x800888e4, (c) => {
        EV.push(["sellBuild"]);
        rt.mem.write32(c.reg(4) + 0x6c0, SELL_COUNT);
        return 0;
    });
    rt.mem.write32(0x80055c48, SFX_STUB);
    rt.cpu.setStub(SFX_STUB, (c) => {
        LAST_SFX = c.reg(4) >>> 0;
        EV.push(["cursorSfx"]);
        return 0;
    });
    rt.mem.write32(0x8008d1b8, FOLD_START);
    rt.cpu.setStub(FOLD_START, (c) => { EV.push(["foldStart", c.reg(5) | 0]); return 0; });
    rt.mem.write32(0x8008d1bc, FOLD_TICK);
    rt.cpu.setStub(FOLD_TICK, () => { EV.push(["foldTick"]); return PAD.ready; });
    rt.mem.write32(0x8008d1ac, STOCK_LEN);
    rt.mem.write32(0x8008d1ac + 0x1c, LOAD);
    rt.cpu.setStub(LOAD, (c) => { EV.push(["loadStock", c.reg(4) | 0]); return STOCK; });
    rt.mem.write32(PARENT + 0x50, HIGHLIGHT);
    rt.cpu.setStub(HIGHLIGHT, (c) => {
        EV.push(["highlight", c.reg(5) | 0, c.reg(6) | 0]);
        return 0;
    });
    // Pad service cells -> constant stubs.
    rt.mem.write32(0x8004bbc4, 0x80018854);
    rt.cpu.setStub(0x80018854, () => PAD.pressed);
    rt.mem.write32(0x8004bbc8, 0x80018878);
    rt.cpu.setStub(0x80018878, () => PAD.held);
    rt.mem.write32(0x8004bbcc, 0x8001889c);
    rt.cpu.setStub(0x8001889c, () => PAD.repeat);
    rt.mem.write32(0x8004bbd8, 0x80018980);
    rt.cpu.setStub(0x80018980, (c) => c.reg(5) | 0);
}

function resetSide(rt, obj, lctx, cur, opts) {
    zero(rt, obj, 0x720);
    zero(rt, lctx, 0x50);
    zero(rt, cur, 0x98);
    rt.mem.write32(obj + 0x24, lctx);
    rt.mem.write32(obj + 0x28, SET_STATE);
    rt.mem.write32(obj + 0x38, ADVANCE);
    rt.mem.write32(obj + 0x50, PARENT);
    rt.mem.write32(lctx + 0x4c, cur);
    rt.mem.write32(cur + 0x84, CURSOR_POS);
    for (const [off, value] of [[0x10, 0x55], [0x58, 0x88], [0x5c, 0x99], [0x60, 0xaa],
        [0x64, 0x77], [0x68, 0xbb], [0x70, 0x66], [0x74, 0xdd], [0x78, 0xee], [0x7c, 0xcc]]) {
        rt.mem.write32(cur + off, value);
    }
    rt.mem.write32(obj + 0xc, opts.state ?? 2);
    rt.mem.write32(obj + 0x10, opts.state1 ?? 0);
    rt.mem.write32(obj + 0x5c, opts.mode ?? 0);
    rt.mem.write32(obj + 0x60, opts.shopId ?? 7);
    rt.mem.write32(obj + 0x6b4, STOCK);
    rt.mem.write32(obj + 0x6b8, opts.latch ?? 1);
    rt.mem.write32(obj + 0x6bc, opts.idx ?? 0);
    rt.mem.write32(obj + 0x6c0, opts.count ?? STOCK_LEN);
    rt.mem.write32(obj + 0x6c4, opts.page ?? 0);
    rt.mem.write32(obj + 0x6c8, opts.pageCount ?? 3);
    rt.mem.write32(obj + 0x6d4, opts.pageSize ?? 8);
    rt.mem.write32(obj + 0x6d8, opts.fold ?? 0);
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

function portHost(mem) {
    return {
        setState(obj, v) {
            EV.push(["setState", v | 0]);
            mem.write32(obj + 0xc, v | 0);
            mem.write32(obj + 0x10, 0);
            mem.write32(obj + 0x14, 0);
            mem.write32(obj + 0x18, 0);
        },
        advanceState(obj) {
            EV.push(["advanceState"]);
            const v = (mem.read32(obj + 0xc) | 0) + 1;
            mem.write32(obj + 0x10, 0);
            mem.write32(obj + 0x14, 0);
            mem.write32(obj + 0x18, 0);
            mem.write32(obj + 0xc, v);
        },
        foldStart(foldState, open) { EV.push(["foldStart", open | 0]); },
        foldTick() { EV.push(["foldTick"]); return PAD.ready; },
        sellBuild(obj) { EV.push(["sellBuild"]); mem.write32(obj + 0x6c0, SELL_COUNT); },
        loadStock(shopId) { EV.push(["loadStock", shopId | 0]); return STOCK; },
        readout(obj, lctx, visible) { EV.push(["readout", visible | 0]); },
        buildList() { EV.push(["buildList"]); },
        drawList() { EV.push(["drawList"]); },
        highlight(parent, itemId, flag) { EV.push(["highlight", itemId | 0, flag | 0]); },
        playCursorSfx() { EV.push(["cursorSfx"]); },
        pad: {
            pressed: () => PAD.pressed,
            held: () => PAD.held,
            repeat: () => PAD.repeat,
            buttonBit: (_port, id) => id | 0,
        },
    };
}

/** Run one init or tick case on both sides and compare events + memory. */
function runCase(label, opts, fn, pad) {
    const rt = runtime();
    installStubs(rt);
    PAD = pad ?? { pressed: 0, held: 0, repeat: 0, ready: 1 };

    resetSide(rt, OBJ_A, LCTX_A, CUR_A, opts);
    EV = [];
    fn("original", rt, OBJ_A, LCTX_A);
    const oracleEv = EV.slice();

    resetSide(rt, OBJ_B, LCTX_B, CUR_B, opts);
    EV = [];
    fn("port", rt, OBJ_B, LCTX_B);
    const portEv = EV.slice();

    assert.deepEqual(portEv, oracleEv, `${label}: event stream`);
    compare(`${label} obj`, rt, OBJ_A, OBJ_B, 0x720, [0x24]);
    compare(`${label} lctx`, rt, LCTX_A, LCTX_B, 0x50, [0x4c]);
    compare(`${label} cursor`, rt, CUR_A, CUR_B, 0x98, []);
}

test("shopListInit matches F0x80087CFC", () => {
    const init = (side, rt, obj, lctx) => {
        if (side === "original") rt.cpu.call(0x80087cfc, [obj, lctx]);
        else shopListInit(rt.mem, obj, lctx, portHost(rt.mem));
    };
    runCase("init BUY", { state1: 0, mode: 0 }, init);
    runCase("init SELL", { state1: 0, mode: 1 }, init);
    runCase("init fold open", { state1: 1 }, init);
    runCase("init fold ready", { state1: 2 }, init, { pressed: 0, held: 0, repeat: 0, ready: 1 });
    runCase("init fold waiting", { state1: 2 }, init, { pressed: 0, held: 0, repeat: 0, ready: 0 });
    runCase("init fold close", { state1: 0x32 }, init);
    runCase("init close ready", { state1: 0x33 }, init, { pressed: 0, held: 0, repeat: 0, ready: 1 });
    runCase("init idle", { state1: 0x64 }, init);
});

test("shopListTick matches F0x80087EC0", () => {
    const tick = (side, rt, obj, lctx) => {
        if (side === "original") rt.cpu.call(0x80087ec0, [obj, lctx]);
        else shopListTick(rt.mem, obj, lctx, portHost(rt.mem));
    };
    runCase("tick default", { state: 0 }, tick);
    runCase("tick case 1 BUY init", { state: 1, state1: 0, mode: 0 }, tick);
    runCase("tick case 1 fold open", { state: 1, state1: 1 }, tick);
    runCase("tick case 1 close ready", { state: 1, state1: 0x33 }, tick,
        { pressed: 0, held: 0, repeat: 0, ready: 1 });
    runCase("tick case 1 close waiting", { state: 1, state1: 0x33 }, tick,
        { pressed: 0, held: 0, repeat: 0, ready: 0 });
    runCase("tick case 3", { state: 3 }, tick);
    runCase("tick case 2 no latch", { state: 2, latch: 0, page: 1, pageCount: 3, pageSize: 8, idx: 4 }, tick);

    const base = { state: 2, latch: 1, page: 1, pageCount: 3, pageSize: 8, idx: 12 };
    runCase("page previous", base, tick, { pressed: BIT_L1, held: 0, repeat: 0, ready: 0 });
    runCase("page next", base, tick, { pressed: BIT_R1, held: 0, repeat: 0, ready: 0 });
    runCase("page previous blocked by R1 held", base, tick, { pressed: BIT_L1, held: BIT_R1, repeat: 0, ready: 0 });
    runCase("page next blocked by L1 held", base, tick, { pressed: BIT_R1, held: BIT_L1, repeat: 0, ready: 0 });
    runCase("page previous clamped", { ...base, page: 0 }, tick, { pressed: BIT_L1, held: 0, repeat: 0, ready: 0 });
    runCase("page next clamped", { ...base, page: 2 }, tick, { pressed: BIT_R1, held: 0, repeat: 0, ready: 0 });
    runCase("page next via repeat", base, tick, { pressed: 0, held: 0, repeat: BIT_R1, ready: 0 });
    runCase("page previous via repeat", base, tick, { pressed: 0, held: 0, repeat: BIT_L1, ready: 0 });

    const grid = { state: 2, latch: 1, page: 0, pageCount: 3, pageSize: 8, count: 20, idx: 4 };
    runCase("grid up", grid, tick, { pressed: BIT_UP, held: 0, repeat: 0, ready: 0 });
    runCase("grid down", grid, tick, { pressed: BIT_DOWN, held: 0, repeat: 0, ready: 0 });
    runCase("grid left", grid, tick, { pressed: BIT_LEFT, held: 0, repeat: 0, ready: 0 });
    runCase("grid right", grid, tick, { pressed: BIT_RIGHT, held: 0, repeat: 0, ready: 0 });
    runCase("grid up then left", grid, tick, { pressed: BIT_UP | BIT_LEFT, held: 0, repeat: 0, ready: 0 });
    runCase("grid left blocked by Down held", grid, tick, { pressed: BIT_LEFT, held: BIT_DOWN, repeat: 0, ready: 0 });
    runCase("grid right blocked by Up held", grid, tick, { pressed: BIT_RIGHT, held: BIT_UP, repeat: 0, ready: 0 });
    runCase("grid up clamped at page top", { ...grid, idx: 0 }, tick, { pressed: BIT_UP, held: 0, repeat: 0, ready: 0 });
    runCase("grid down clamped at page bottom", { ...grid, idx: 7 }, tick, { pressed: BIT_DOWN, held: 0, repeat: 0, ready: 0 });
    runCase("grid down via repeat", grid, tick, { pressed: 0, held: 0, repeat: BIT_DOWN, ready: 0 });
    runCase("grid no input", grid, tick, { pressed: 0, held: 0, repeat: 0, ready: 0 });

    // Sanity: page next really moved the page and reset the flat index, with SFX first.
    const rt = runtime();
    installStubs(rt);
    PAD = { pressed: BIT_R1, held: 0, repeat: 0, ready: 0 };
    resetSide(rt, OBJ_B, LCTX_B, CUR_B, base);
    EV = [];
    shopListTick(rt.mem, OBJ_B, LCTX_B, portHost(rt.mem));
    assert.equal(rt.mem.read32(OBJ_B + 0x6c4) | 0, 2, "page advanced");
    assert.equal(rt.mem.read32(OBJ_B + 0x6bc) | 0, 16, "flat index reset to page*pageSize");
    assert.equal(EV[0][0], "cursorSfx", "page-change SFX fires first");

    // Sanity: grid up moves two cells and the SFX fires last on an index change.
    PAD = { pressed: BIT_UP, held: 0, repeat: 0, ready: 0 };
    resetSide(rt, OBJ_B, LCTX_B, CUR_B, grid);
    EV = [];
    shopListTick(rt.mem, OBJ_B, LCTX_B, portHost(rt.mem));
    assert.equal(rt.mem.read32(OBJ_B + 0x6bc) | 0, 2, "index moved up two");
    assert.equal(EV[EV.length - 2][0], "cursorSfx", "index-change SFX fires after the cursor move");
});
