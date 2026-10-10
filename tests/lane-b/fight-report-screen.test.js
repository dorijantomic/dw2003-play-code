// Lane B Phase 4 oracle: engine/dw3/ui/native/fight-report-screen.ts must match
// the original pro/stfgtrep F0x800857F0 report-screen root tick.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// sub-screen calls (level widgets 0x80084B98, row factory 0x80084AEC, report
// state machine 0x80084EC4, chrome 0x80084C20), the shared card service
// (0x80048D34 + 0x2718 / + 0x270C), the bank request/ready probes
// ([0x8008913C]/[0x80089140]) and the row's +0x16C method are all stubbed on
// both sides so the ordered boundary calls and the screen/array fields can be
// compared directly. The three-record config table at 0x80042B84 and the score
// table at 0x80086A88 are seeded per case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { reportScreenTick } from "../../engine/dw3/ui/native/fight-report-screen.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const report = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: report.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARR = 0x80160000;
const ROW_BASE = 0x80170000;

const REQUEST_STUB = 0x0fd70000;
const READY_STUB = 0x0fd70004;
const LEVEL_STUB = 0x0fd70008;
const CARD_IDX_STUB = 0x0fd7000c;
const RELEASE_STUB = 0x0fd70010;
const ROW_STUB = 0x0fd70014;
const ROW_METHOD_STUB = 0x0fd70018;
const REPORT_TICK_STUB = 0x0fd7001c;
const CHROME_STUB = 0x0fd70020;
const BASE_STUB = 0x0fd70024;

const REQUEST_PTR = 0x8008913c;
const READY_PTR = 0x80089140;
const CARD_IDX_SLOT = 0x80048d34 + 0x2718;
const RELEASE_SLOT = 0x80048d34 + 0x270c;
const LEVEL_FN = 0x80084b98;
const ROW_FN = 0x80084aec;
const REPORT_TICK_FN = 0x80084ec4;
const CHROME_FN = 0x80084c20;
const RECORD_TABLE = 0x80042b84;
const SCORE_TABLE = 0x80086a88;
const RELEASE_ID = 0x80048d34 + 0x34;

const LOG = [];
const CARD_VALUES = [0, 1, 2];
const READY_RETURN = { value: 0 };
let made = 0;

function runtime() {
    const rt = new NativeStageRuntime(report, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(REQUEST_STUB, (c) => { LOG.push(["requestBanks", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(READY_STUB, (c) => { LOG.push(["banksReady", c.reg(4) | 0]); return READY_RETURN.value; });
    rt.cpu.setStub(LEVEL_FN, (c) => { LOG.push(["levelWidgets", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(CARD_IDX_STUB, (c) => {
        const i = c.reg(4) | 0;
        LOG.push(["cardIndex", i]);
        return CARD_VALUES[i] ?? -1;
    });
    rt.cpu.setStub(RELEASE_STUB, (c) => { LOG.push(["release", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(ROW_FN, (c) => {
        LOG.push(["createRow", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        const row = ROW_BASE + made * 0x100;
        made += 1;
        rt.mem.write32(row + 0x16c, ROW_METHOD_STUB);
        return row;
    });
    rt.cpu.setStub(ROW_METHOD_STUB, (c) => {
        LOG.push(["row16C", c.reg(4) | 0]);
        return (c.reg(4) | 0) + 0x40;
    });
    rt.cpu.setStub(REPORT_TICK_FN, (c) => { LOG.push(["reportTick", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(CHROME_FN, (c) => { LOG.push(["drawChrome", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(BASE_STUB, (c) => { LOG.push(["baseAdvance", c.reg(4) | 0]); return 0; });

    rt.mem.write32(REQUEST_PTR, REQUEST_STUB);
    rt.mem.write32(READY_PTR, READY_STUB);
    rt.mem.write32(CARD_IDX_SLOT, CARD_IDX_STUB);
    rt.mem.write32(RELEASE_SLOT, RELEASE_STUB);
    return rt;
}

function seed(rt, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x38, BASE_STUB);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x10, c.sub ?? 0);
    rt.mem.write32(OBJ + 0x60, c.count0 ?? 0);
    rt.mem.write32(OBJ + 0x70, c.stat0 ?? 0);
    rt.mem.write16(RECORD_TABLE, c.index ?? 0);
    for (let r = 0; r < 3; r++) {
        rt.mem.write8(RECORD_TABLE + r * 4 + 6, c.recFlags?.[r] ?? 0);
        for (let v = 0; v < 3; v++) {
            rt.mem.write8(RECORD_TABLE + r * 4 + v + 7, c.statFlags?.[r]?.[v] ?? 0);
        }
    }
    rt.mem.write32(SCORE_TABLE + (c.index ?? 0) * 0x0c + 4, c.scoreBase ?? 0);
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(ARR + i, 0xdead);
    CARD_VALUES[0] = c.cards?.[0] ?? 0;
    CARD_VALUES[1] = c.cards?.[1] ?? 1;
    CARD_VALUES[2] = c.cards?.[2] ?? 2;
    READY_RETURN.value = c.ready ?? 0;
}

function portHost() {
    return {
        requestBanks(flag) { LOG.push(["requestBanks", flag | 0]); },
        banksReady(flag) { LOG.push(["banksReady", flag | 0]); return READY_RETURN.value; },
        baseAdvance() { LOG.push(["baseAdvance", OBJ | 0]); },
        buildLevelWidgets(a) { LOG.push(["levelWidgets", OBJ | 0, a | 0]); },
        cardIndexOf(i) { LOG.push(["cardIndex", i | 0]); return CARD_VALUES[i] ?? -1; },
        createRow(index, score) {
            LOG.push(["createRow", OBJ | 0, index | 0, score | 0]);
            const row = ROW_BASE + made * 0x100;
            made += 1;
            return row;
        },
        rowMethod16C(row) { LOG.push(["row16C", row | 0]); return (row | 0) + 0x40; },
        releaseService(id) { LOG.push(["release", id | 0, 0]); },
        reportTick() { LOG.push(["reportTick", OBJ | 0, ARR | 0]); },
        drawChrome() { LOG.push(["drawChrome", OBJ | 0]); },
    };
}

function fields(rt) {
    const out = [];
    for (const off of [0x10, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x80, 0x90]) {
        out.push(`obj+${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    }
    for (let i = 0; i < 3; i++) {
        out.push(`arr+${(0xc + i * 4).toString(16)}=${rt.mem.read32(ARR + 0xc + i * 4) >>> 0}`);
    }
    return out;
}

function runBoth(rt, c) {
    seed(rt, c);
    LOG.length = 0;
    made = 0;
    rt.cpu.call(0x800857f0, [OBJ, ARR], 40000);
    const oracleLog = LOG.slice();
    const oracleFields = fields(rt);

    seed(rt, c);
    LOG.length = 0;
    made = 0;
    reportScreenTick(rt.mem, OBJ, ARR, portHost());
    return { oracleLog, oracleFields, portLog: LOG.slice(), portFields: fields(rt) };
}

const CASES = [
    { name: "state 0 sub 0 requests banks", state: 0, sub: 0 },
    { name: "state 0 sub 2 requests banks", state: 0, sub: 2 },
    { name: "state 0 sub 1 still loading", state: 0, sub: 1, ready: 1 },
    { name: "state 0 sub 1 no records", state: 0, sub: 1, ready: 0, cards: [-1, -1, -1], count0: 0, recFlags: [0, 0, 0] },
    {
        name: "state 0 sub 1 one record", state: 0, sub: 1, ready: 0,
        cards: [5, -1, -1], recFlags: [1, 0, 0], statFlags: [[1, 0, 1], [0, 0, 0], [0, 0, 0]],
        index: 2, scoreBase: 100,
    },
    {
        name: "state 0 sub 1 two records scale", state: 0, sub: 1, ready: 0,
        cards: [0, 1, -1], recFlags: [1, 1, 0], statFlags: [[1, 1, 1], [0, 1, 0], [0, 0, 0]],
        index: 1, scoreBase: 37,
    },
    {
        name: "state 0 sub 1 three records div3", state: 0, sub: 1, ready: 0,
        cards: [0, 1, 2], recFlags: [1, 1, 1], statFlags: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        index: 3, scoreBase: 100,
    },
    {
        name: "state 0 sub 1 negative score base", state: 0, sub: 1, ready: 0,
        cards: [3, 3, 3], recFlags: [1, 1, 0], statFlags: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
        index: 0, scoreBase: -7,
    },
    { name: "state 1 runs tick and chrome", state: 1 },
    { name: "state 2 idles", state: 2 },
    { name: "state 3 releases service", state: 3 },
];

test("reportScreenTick matches F0x800857F0", () => {
    const rt = runtime();
    for (const c of CASES) {
        const r = runBoth(rt, c);
        assert.deepEqual(r.portLog, r.oracleLog, `${c.name}: ordered boundary calls`);
        assert.deepEqual(r.portFields, r.oracleFields, `${c.name}: fields`);
    }
});

test("reportScreenTick score arithmetic follows the record flags", () => {
    const rt = runtime();
    const checks = [
        { present: 0, base: 100, expected: 0 },
        { present: 1, base: 100, expected: 100 },
        { present: 2, base: 37, expected: 22 },
        { present: 3, base: 100, expected: 33 },
    ];
    for (const c of checks) {
        const recFlags = [0, 0, 0];
        for (let r = 0; r < c.present; r++) recFlags[r] = 1;
        const kase = {
            name: `present ${c.present}`, state: 0, sub: 1, ready: 0,
            cards: [0, 1, 2], recFlags, index: 1, scoreBase: c.base,
        };
        const r = runBoth(rt, kase);
        assert.deepEqual(r.portLog, r.oracleLog, `${c.name}: ordered calls`);
        const scores = r.oracleLog.filter(([m]) => m === "createRow").map(([, , , s]) => s);
        assert.ok(scores.includes(c.expected), `${c.name}: score ${c.expected} present in ${scores}`);
    }
});
