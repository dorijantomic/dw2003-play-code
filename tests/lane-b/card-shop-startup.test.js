// Lane B Phase 4 oracle: engine/dw3/ui/native/card-shop-startup.ts must match
// the original pro/stcrdshp startup-service bodies.
//
//   F0x80088E24  shopRequestTextBanks
//   F0x80088EF4  shopTextBanksPending
//   F0x80087D00  shopRootCreateLabels
//
// The original runs through engine/native (the interpreter) as the oracle. The
// two [0x80044B38] bank slots, the pack resolver, the text/level widget
// constructors and the widget methods are stubs on both sides; the sound object
// constructor remains the shipped F0x8001FFA8. Its installed methods are
// observed explicitly, independently of the runtime's field-only stand-in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { observeUploadContext } from "../helpers/upload-context-observers.js";
import {
    SHOP_BANK_PACK,
    shopRequestTextBanks,
    shopRootCreateLabels,
    shopTextBanksPending,
} from "../../engine/dw3/ui/native/card-shop-startup.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const shop = new Uint8Array(readFileSync(join(dir, "pro_stcrdshp.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: shop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x801a0000;
const OBJ_B = 0x801a0400;
const LIST_A = 0x801a1000;
const LIST_B = 0x801a1200;
const WIDGET = (i) => 0x801b0000 + i * 0x200;
const LEVEL = 0x801b8000;
const PACK_PTR = 0x801b9000;
const SAVE_BLOCK = 0x001b9800;

const CREATE = 0x8001ae38;
const LEVEL_CTOR = 0x8001b364;
const BANK_REQ = 0x80044f44;
const BANK_PEND = 0x80044f3c;
const PACK_STUB = 0x0fd50000;
const U80 = 0x0fd50004;
const U15C = 0x0fd50008;

const BANK_REQ_CALLS = [];
const BANK_PEND_CALLS = [];
const CREATE_CALLS = [];
const LEVEL_CALLS = [];
const METHOD_CALLS = [];
const SND = [];
let made = 0;
const PENDING = {};

function runtime() {
    const rt = new NativeStageRuntime(shop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    observeUploadContext(rt, Object.fromEntries([0x24, 0x2c].map(slot => [slot, c => {
        rt.drawCalls.push({ method: `snd+0x${slot.toString(16)}`, args: [c.reg(4), c.reg(5)] });
        return 0;
    }])));
    rt.cpu.setStub(PACK_STUB, (c) => ((c.reg(4) >>> 0) === SHOP_BANK_PACK ? PACK_PTR : 0));
    rt.cpu.setStub(CREATE, (c) => {
        CREATE_CALLS.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return WIDGET(made++);
    });
    rt.cpu.setStub(LEVEL_CTOR, (c) => {
        LEVEL_CALLS.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        rt.mem.write32(LEVEL + 0x80, U80);
        return LEVEL;
    });
    rt.cpu.setStub(U80, (c) => { METHOD_CALLS.push(["u80", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(U15C, (c) => { METHOD_CALLS.push(["u15c", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(BANK_REQ, (c) => { BANK_REQ_CALLS.push(c.reg(4) | 0); return 0; });
    rt.cpu.setStub(BANK_PEND, (c) => {
        const id = c.reg(4) | 0;
        BANK_PEND_CALLS.push(id);
        return PENDING[id] ?? 0;
    });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(BANK_REQ, BANK_REQ);
    rt.mem.write32(BANK_PEND, BANK_PEND);
    rt.mem.write32(0x8005cca8, SAVE_BLOCK);
    return rt;
}

function sndFromDrawCalls(rt, before) {
    return rt.drawCalls
        .slice(before)
        .filter((d) => d.method.startsWith("snd+0x"))
        .map((d) => [d.method, d.args[0] >>> 0]);
}

function portBankHost() {
    return {
        soundCall(slot, a, b) { SND.push([`snd+0x${slot.toString(16)}`, a >>> 0, b | 0]); },
        packResolve(h) { return (h >>> 0) === SHOP_BANK_PACK ? PACK_PTR : 0; },
        bankRequest(id) { BANK_REQ_CALLS.push(id | 0); },
        bankPending(id) { BANK_PEND_CALLS.push(id | 0); return PENDING[id] ?? 0; },
    };
}

test("shopRequestTextBanks matches F0x80088E24", () => {
    const rt = runtime();
    BANK_REQ_CALLS.length = 0;
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80088e24, [], 30000);
    const oracleSnd = sndFromDrawCalls(rt, before);
    const oracleBanks = BANK_REQ_CALLS.slice();

    BANK_REQ_CALLS.length = 0;
    SND.length = 0;
    shopRequestTextBanks(rt.mem, portBankHost());
    assert.deepEqual(SND.map((x) => [x[0], x[1]]), oracleSnd, "sound calls");
    assert.deepEqual(BANK_REQ_CALLS, oracleBanks, "bank requests");
    assert.deepEqual(oracleBanks, [
        SAVE_BLOCK + 0x32, SAVE_BLOCK + 0x16, SAVE_BLOCK + 0x1d, SAVE_BLOCK + 0x94, SAVE_BLOCK + 0x6a,
    ], "bank request ids");
});

test("shopTextBanksPending matches F0x80088EF4", () => {
    const rt = runtime();
    const cases = [
        { name: "all idle", busy: {} },
        { name: "first busy", busy: { 0x32: 1 } },
        { name: "second busy", busy: { 0x16: 1 } },
        { name: "third busy", busy: { 0x1d: 1 } },
        { name: "fourth busy", busy: { 0x94: 1 } },
        { name: "last busy", busy: { 0x6a: 1 } },
    ];
    for (const c of cases) {
        for (const k of Object.keys(PENDING)) delete PENDING[k];
        for (const [off, v] of Object.entries(c.busy)) PENDING[SAVE_BLOCK + Number(off)] = v;

        BANK_PEND_CALLS.length = 0;
        const ra = rt.cpu.call(0x80088ef4, []) | 0;
        const oracleCalls = BANK_PEND_CALLS.slice();

        BANK_PEND_CALLS.length = 0;
        const rb = shopTextBanksPending(rt.mem, portBankHost()) | 0;
        assert.deepEqual(BANK_PEND_CALLS, oracleCalls, `${c.name}: polled ids`);
        assert.equal(rb, ra, `${c.name}: return`);
    }
});

function initLabels(rt, obj, list, f) {
    for (let i = 0; i < 0x400; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x50, f.target ?? 0x1005);
    rt.mem.write32(obj + 0x54, f.scale ?? 7);
    rt.mem.write32(obj + 0x6c, f.mode ?? 0);
    rt.mem.write32(obj + 0x20, f.cells ?? 3);
    rt.mem.write32(obj + 0x24, list);
    for (let i = 0; i < 8; i++) {
        const w = 0x801c0000 + i * 0x200;
        rt.mem.write32(w + 0x15c, U15C);
        rt.mem.write32(list + i * 4, w);
    }
}

test("shopRootCreateLabels matches F0x80087D00", () => {
    const rt = runtime();
    const cases = [
        { target: 0x1005, mode: 0, cells: 3 },
        { target: 0x1005, mode: 1, cells: 4 },
        { target: 0x8000, mode: 2, cells: 5 },
        { target: 0x1003, mode: 3, cells: 8 },
        { target: 0x1005, mode: 0, cells: 0 },
    ];
    for (const c of cases) {
        for (let i = 0; i < 0x40; i += 4) {
            rt.mem.write32(LIST_A + i, 0);
            rt.mem.write32(LIST_B + i, 0);
        }
        initLabels(rt, OBJ_A, LIST_A, c);
        initLabels(rt, OBJ_B, LIST_B, c);

        CREATE_CALLS.length = 0;
        LEVEL_CALLS.length = 0;
        METHOD_CALLS.length = 0;
        made = 0;
        rt.cpu.call(0x80087d00, [OBJ_A, 0x801a2000], 40000);
        const oracleCreate = CREATE_CALLS.slice();
        const oracleLevel = LEVEL_CALLS.slice();
        const oracleMethods = METHOD_CALLS.slice();

        CREATE_CALLS.length = 0;
        LEVEL_CALLS.length = 0;
        METHOD_CALLS.length = 0;
        made = 0;
        const labelsB = 0x801a2400;
        shopRootCreateLabels(rt.mem, OBJ_B, labelsB, {
            createTextElement(target, kind, x, y) {
                CREATE_CALLS.push([target | 0, kind | 0, x | 0, y | 0]);
                return WIDGET(made++);
            },
            createLevelWidget(target, kind, x, y) {
                LEVEL_CALLS.push([target | 0, kind | 0, x | 0, y | 0]);
                return LEVEL;
            },
            setWidget80(widget, value) { METHOD_CALLS.push(["u80", widget | 0, value | 0]); },
            setWidget15C(widget, value) { METHOD_CALLS.push(["u15c", widget | 0, value | 0]); },
        });

        assert.deepEqual(CREATE_CALLS, oracleCreate, `target ${c.target.toString(16)} cells ${c.cells}: create calls`);
        assert.deepEqual(LEVEL_CALLS, oracleLevel, `target ${c.target.toString(16)} cells ${c.cells}: level calls`);
        assert.deepEqual(METHOD_CALLS, oracleMethods, `target ${c.target.toString(16)} cells ${c.cells}: widget methods`);
        for (let i = 0; i < 0x28; i += 4) {
            assert.equal(rt.mem.read32(labelsB + i) >>> 0, rt.mem.read32(0x801a2000 + i) >>> 0,
                `target ${c.target.toString(16)} cells ${c.cells}: labels +0x${i.toString(16)}`);
        }
    }
});
