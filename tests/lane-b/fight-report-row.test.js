// Lane B Phase 4 oracle: engine/dw3/ui/native/fight-report-row.ts must match
// the original pro/stfgtrep report-row bodies.
//
//   F0x80084AEC  reportRowCreate
//   F0x80083260  reportRowWidgetsCreate
//   F0x80084B98  reportLevelWidgetsCreate
//   F0x80084A08  reportRowMethod08
//   F0x80084A14  reportRowMethod14
//   F0x80084A20  reportRowMethod20
//   F0x80084AE0  reportRowMethodE0
//   F0x80084A2C  reportRowComputeScore
//
// The original runs through engine/native (the interpreter) as the oracle. The
// text-widget constructor (F0x8001AE38), the widget +0x160 method and the
// card-index / card-record services (0x80048D34 + 0x2718 / +0x2750) are stubs on
// both sides, so the ordered call sequences, the widget array and the row fields
// can be compared directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    REPORT_ROW_EXTRA,
    REPORT_ROW_SIZE,
    reportLevelWidgetsCreate,
    reportRowComputeScore,
    reportRowCreate,
    reportRowMethod08,
    reportRowMethod14,
    reportRowMethod20,
    reportRowMethodE0,
    reportRowWidgetsCreate,
} from "../../engine/dw3/ui/native/fight-report-row.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const report = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: report.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const ARR_A = 0x80160000;
const ARR_B = 0x80160100;
const WIDGET_BASE = 0x80152000;
const REC_PTR = 0x80170000;

const CREATE = 0x8001ae38;
const U160 = 0x0fd80000;
const CARD_IDX_STUB = 0x0fd80004;
const CARD_REC_STUB = 0x0fd80008;
const CARD_IDX_SLOT = 0x80048d34 + 0x2718;
const CARD_REC_SLOT = 0x80048d34 + 0x2750;
const CARD_IDX = 7;

const CREATE_CALLS = [];
const METHOD_CALLS = [];
const CARD_CALLS = [];
let made = 0;

function runtime() {
    const rt = new NativeStageRuntime(report, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(CREATE, (c) => {
        CREATE_CALLS.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = WIDGET_BASE + made * 0x100;
        made += 1;
        rt.mem.write32(widget + 0x160, U160);
        return widget;
    });
    rt.cpu.setStub(U160, (c) => {
        METHOD_CALLS.push(["u160", c.reg(4) | 0, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(CARD_IDX_STUB, (c) => {
        CARD_CALLS.push(["idx", c.reg(4) | 0]);
        return CARD_IDX;
    });
    rt.cpu.setStub(CARD_REC_STUB, (c) => {
        CARD_CALLS.push(["rec", c.reg(4) | 0]);
        return REC_PTR;
    });
    rt.mem.write32(CARD_IDX_SLOT, CARD_IDX_STUB);
    rt.mem.write32(CARD_REC_SLOT, CARD_REC_STUB);
    return rt;
}

function clearObj(rt, obj, size = 0x180) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(obj + i, 0);
}

function portWidgetHost() {
    return {
        createTextElement(target, kind, x, y) {
            CREATE_CALLS.push([target | 0, kind | 0, x | 0, y | 0]);
            const widget = WIDGET_BASE + made * 0x100;
            made += 1;
            return widget;
        },
        setWidget160(widget, value) {
            METHOD_CALLS.push(["u160", widget | 0, value | 0]);
        },
    };
}

function portScoreHost() {
    return {
        cardIndexOf(rowIndex) {
            CARD_CALLS.push(["idx", rowIndex | 0]);
            return CARD_IDX;
        },
        cardRecord(cardIndex) {
            CARD_CALLS.push(["rec", cardIndex | 0]);
            return REC_PTR;
        },
    };
}

test("reportRowCreate matches F0x80084AEC", () => {
    const rt = runtime();
    let HEAP = 0x80190000;
    const allocHost = {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = HEAP;
            HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
    const cases = [
        [0, 0, 0],
        [0x80160000, 0, 0],
        [0x80160000, 2, 100],
        [0x12345678, 5, -7],
    ];
    for (const [screen, index, score] of cases) {
        HEAP = 0x80190000;
        const a = rt.cpu.call(0x80084aec, [screen, index, score]) >>> 0;
        const b = reportRowCreate(rt.mem, allocHost, screen, index, score) >>> 0;
        const extraA = rt.mem.read32(a + 0x24) >>> 0;
        const extraB = rt.mem.read32(b + 0x24) >>> 0;
        assert.notEqual(extraA, 0, "original extra");
        assert.notEqual(extraB, 0, "port extra");
        for (let i = 0; i < REPORT_ROW_EXTRA; i++) {
            assert.equal(rt.mem.read8(extraB + i), rt.mem.read8(extraA + i), `extra +0x${i.toString(16)}`);
        }
        for (let off = 0; off < REPORT_ROW_SIZE; off += 4) {
            if (off === 0x24) continue;
            assert.equal(rt.mem.read32(b + off) >>> 0, rt.mem.read32(a + off) >>> 0,
                `screen ${screen} index ${index}: +0x${off.toString(16)}`);
        }
    }
    const rt2 = runtime();
    const obj = rt2.cpu.call(0x80084aec, [0x80160000, 3, 42]) >>> 0;
    assert.equal(rt2.mem.read32(obj + 0x48) >>> 0, 0x800848e4, "handler");
    assert.equal(rt2.mem.read32(obj + 0x160) >>> 0, 0x80084a08, "+0x160");
    assert.equal(rt2.mem.read32(obj + 0x170) >>> 0, 0x80084ae0, "+0x170");
    assert.equal(rt2.mem.read32(obj + 0x134) >>> 0, 0xffff, "+0x134 halfword");
    assert.equal(rt2.mem.read32(obj + 0x50) >>> 0, 0x80160000, "+0x50");
    assert.equal(rt2.mem.read32(obj + 0x5c) >>> 0, 3, "+0x5c");
    assert.equal(rt2.mem.read32(obj + 0x60) >>> 0, 42, "+0x60");
});

test("reportRowWidgetsCreate matches F0x80083260", () => {
    const rt = runtime();
    const combos = [
        { index: 0, scale: 0x1000, target: 0x1005 },
        { index: 1, scale: 0x1000, target: 0x1005 },
        { index: 2, scale: 0x1000, target: 0x1005 },
        { index: 5, scale: 0x1003, target: 0x1005 },
        { index: 7, scale: 0x1000, target: 0x1001 },
        { index: 1, scale: 0x8000, target: 0x1005 },
    ];
    for (const c of combos) {
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj);
            rt.mem.write32(obj + 0x54, c.scale);
            rt.mem.write32(obj + 0x5c, c.index);
            rt.mem.write32(obj + 0x50, c.target);
        }
        for (let i = 0; i < 0x40; i += 4) {
            rt.mem.write32(ARR_A + i, 0xdead);
            rt.mem.write32(ARR_B + i, 0xdead);
        }

        CREATE_CALLS.length = 0;
        METHOD_CALLS.length = 0;
        made = 0;
        rt.cpu.call(0x80083260, [OBJ_A, ARR_A], 40000);
        const oracleCreate = CREATE_CALLS.slice();
        const oracleMethods = METHOD_CALLS.slice();

        CREATE_CALLS.length = 0;
        METHOD_CALLS.length = 0;
        made = 0;
        reportRowWidgetsCreate(rt.mem, OBJ_B, ARR_B, portWidgetHost());
        assert.deepEqual(CREATE_CALLS, oracleCreate, `index ${c.index}: createTextElement calls`);
        assert.deepEqual(METHOD_CALLS, oracleMethods, `index ${c.index}: +0x160 calls`);
        assert.equal(CREATE_CALLS.length, 12, `index ${c.index}: widget count`);
        for (let i = 0; i < 0x30; i += 4) {
            assert.equal(rt.mem.read32(ARR_B + i) >>> 0, rt.mem.read32(ARR_A + i) >>> 0,
                `index ${c.index}: widgets +0x${i.toString(16)}`);
        }
    }
});

test("reportLevelWidgetsCreate matches F0x80084B98", () => {
    const rt = runtime();
    for (const scale of [0x1000, 0x1005, 0x8000]) {
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj);
            rt.mem.write32(obj + 0x50, scale);
        }
        for (let i = 0; i < 0x20; i += 4) {
            rt.mem.write32(ARR_A + i, 0xdead);
            rt.mem.write32(ARR_B + i, 0xdead);
        }

        CREATE_CALLS.length = 0;
        METHOD_CALLS.length = 0;
        made = 0;
        rt.cpu.call(0x80084b98, [OBJ_A, ARR_A], 40000);
        const oracleCreate = CREATE_CALLS.slice();
        const oracleMethods = METHOD_CALLS.slice();

        CREATE_CALLS.length = 0;
        METHOD_CALLS.length = 0;
        made = 0;
        reportLevelWidgetsCreate(rt.mem, OBJ_B, ARR_B, portWidgetHost());
        assert.deepEqual(CREATE_CALLS, oracleCreate, `scale ${scale}: createTextElement calls`);
        assert.deepEqual(METHOD_CALLS, oracleMethods, `scale ${scale}: +0x160 calls`);
        for (let i = 0; i < 0x10; i += 4) {
            assert.equal(rt.mem.read32(ARR_B + i) >>> 0, rt.mem.read32(ARR_A + i) >>> 0,
                `scale ${scale}: widgets +0x${i.toString(16)}`);
        }
    }
});

test("report row state methods match", () => {
    const rt = runtime();
    const methods = [
        [0x80084a08, reportRowMethod08, 0x10],
        [0x80084a14, reportRowMethod14, 0x10],
        [0x80084a20, reportRowMethod20, 0x10],
        [0x80084ae0, reportRowMethodE0, 0x68],
    ];
    for (const [addr, port, off] of methods) {
        clearObj(rt, OBJ_A, 0x80);
        clearObj(rt, OBJ_B, 0x80);
        const ra = rt.cpu.call(addr, [OBJ_A]) | 0;
        const rb = port(rt.mem, OBJ_B) | 0;
        assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
            `0x${addr.toString(16)}: +0x${off.toString(16)}`);
        assert.equal(rb, ra, `0x${addr.toString(16)}: return`);
    }
});

test("reportRowComputeScore matches F0x80084A2C", () => {
    const rt = runtime();
    const cases = [
        { name: "already computed", computed: 1, score: 100, f3c8: 0, f3ca: 0, bonus: false },
        { name: "primary match", computed: 0, score: 100, f3c8: 0x141, f3ca: 0, bonus: true },
        { name: "alternate match", computed: 0, score: 100, f3c8: 0, f3ca: 0x141, bonus: true },
        { name: "no match", computed: 0, score: 100, f3c8: 0x140, f3ca: 0x142, bonus: false },
        { name: "small score", computed: 0, score: 5, f3c8: 0x141, f3ca: 0, bonus: true },
        { name: "negative score", computed: 0, score: -7, f3c8: 0x141, f3ca: 0, bonus: true },
        { name: "zero score", computed: 0, score: 0, f3c8: 0x141, f3ca: 0, bonus: false },
    ];
    for (const c of cases) {
        for (const obj of [OBJ_A, OBJ_B]) {
            clearObj(rt, obj, 0x80);
            rt.mem.write32(obj + 0x64, c.computed);
            rt.mem.write32(obj + 0x60, c.score);
            rt.mem.write32(obj + 0x5c, 3);
        }
        rt.mem.write16(REC_PTR + 0x3c8, c.f3c8);
        rt.mem.write16(REC_PTR + 0x3ca, c.f3ca);

        CARD_CALLS.length = 0;
        const ra = rt.cpu.call(0x80084a2c, [OBJ_A]) | 0;
        const oracleCalls = CARD_CALLS.slice();

        CARD_CALLS.length = 0;
        const rb = reportRowComputeScore(rt.mem, OBJ_B, portScoreHost()) | 0;
        assert.deepEqual(CARD_CALLS, oracleCalls, `${c.name}: card service calls`);
        assert.equal(oracleCalls.length, c.computed === 0 ? 2 : 0, `${c.name}: oracle lookup count`);
        assert.equal(rt.mem.read32(OBJ_B + 0x60) >>> 0, rt.mem.read32(OBJ_A + 0x60) >>> 0,
            `${c.name}: +0x60`);
        assert.equal(rt.mem.read32(OBJ_B + 0x64) >>> 0, rt.mem.read32(OBJ_A + 0x64) >>> 0,
            `${c.name}: +0x64`);
        assert.equal(rb, ra, `${c.name}: return`);

        const changed = (rt.mem.read32(OBJ_A + 0x60) | 0) !== c.score;
        assert.equal(changed, c.bonus, `${c.name}: oracle bonus applied`);
    }
});
