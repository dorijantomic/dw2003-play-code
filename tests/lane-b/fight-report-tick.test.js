// Lane B Phase 4 oracle: engine/dw3/ui/native/fight-report-tick.ts must match the
// original pro/stfgtrep F0x80084EC4 report row state machine.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// fold services, the pad, the resource base, the shared card service, the fade
// object and every widget/row method are stubbed on both sides so the ordered
// calls, the screen/row fields and the return-driven branches can be compared
// directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { reportTick } from "../../engine/dw3/ui/native/fight-report-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const report = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const entry = { size: report.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARR = 0x80160000;
const W0 = 0x80151000;
const W4 = 0x80151400;
const W8 = 0x80151800;
const ROWS = [0x80152000, 0x80152400, 0x80152800];
const FADE = 0x80153000;
const REC_PTR = 0x80170000;
const RES_PTR = 0x80171000;

const FOLD_START_PTR = 0x80089144;
const FOLD_BUSY_PTR = 0x80089148;
const PAD_READ_PTR = 0x8004b7d0 + 0x3f4;
const PAD_BUTTON_PTR = 0x8004b7d0 + 0x408;
const RESOURCE_PTR = 0x80044f4c;
const CARD_INDEX_SLOT = 0x80048d34 + 0x2718;
const CARD_RECORD_SLOT = 0x80048d34 + 0x2750;
const FADE_FN = 0x80083218;
const NAME_CONTEXT = 0x8005cca8;
const RECORD_TABLE = 0x80042b84;
const SCORE_TABLE = 0x80086a88;

const FOLD_START_STUB = 0x0fd90000;
const FOLD_BUSY_STUB = 0x0fd90004;
const PAD_READ_STUB = 0x0fd90008;
const PAD_BUTTON_STUB = 0x0fd9000c;
const RESOURCE_STUB = 0x0fd90010;
const CARD_INDEX_STUB = 0x0fd90014;
const CARD_RECORD_STUB = 0x0fd90018;
const FADE_STUB = 0x0fd9001c;
const SETSTATE_STUB = 0x0fd90020;
const SLOT_BASE = 0x0fd92000;

const SLOT_ARITY = {
    0x64: 2, 0x114: 2, 0x118: 2, 0x120: 3, 0x128: 0,
    0x130: 1, 0x144: 1, 0x148: 1, 0x160: 0, 0x164: 0, 0x168: 0, 0x170: 0,
};
const SLOTS = Object.keys(SLOT_ARITY).map((s) => Number(s));

const LOG = [];
const QUERY = new Map();
const CONTROL = { foldBusy: 0, padValue: 0, padBit: 0xd, cardIndex: 0 };

function queryKey(target, slot) { return `${target >>> 0}:${slot}`; }

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound(id) { LOG.push(["playSound", id | 0]); } };
    const rt = new NativeStageRuntime(report, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });

    rt.cpu.setStub(FOLD_START_STUB, (c) => { LOG.push(["foldStart", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(FOLD_BUSY_STUB, (c) => { LOG.push(["foldBusy", c.reg(4) | 0]); return CONTROL.foldBusy; });
    rt.cpu.setStub(PAD_READ_STUB, (c) => { LOG.push(["padRead", c.reg(4) | 0]); return CONTROL.padValue; });
    rt.cpu.setStub(PAD_BUTTON_STUB, (c) => { LOG.push(["padButton", c.reg(4) | 0, c.reg(5) | 0]); return CONTROL.padBit; });
    rt.cpu.setStub(RESOURCE_STUB, (c) => { LOG.push(["resourceBase", c.reg(4) | 0]); return RES_PTR; });
    rt.cpu.setStub(CARD_INDEX_STUB, (c) => { LOG.push(["cardIndex", c.reg(4) | 0]); return CONTROL.cardIndex; });
    rt.cpu.setStub(CARD_RECORD_STUB, (c) => { LOG.push(["cardRecord", c.reg(4) | 0]); return REC_PTR; });
    rt.cpu.setStub(FADE_FN, () => {
        LOG.push(["createFade"]);
        rt.mem.write32(FADE + 0x64, SLOT_BASE + 0x64);
        return FADE;
    });
    rt.cpu.setStub(SETSTATE_STUB, (c) => { LOG.push(["setState", c.reg(5) | 0]); return 0; });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const target = c.reg(4) | 0;
            const arity = SLOT_ARITY[slot];
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", target, slot, ...args]);
            return QUERY.get(queryKey(target, slot)) ?? 0;
        });
    }

    rt.mem.write32(FOLD_START_PTR, FOLD_START_STUB);
    rt.mem.write32(FOLD_BUSY_PTR, FOLD_BUSY_STUB);
    rt.mem.write32(PAD_READ_PTR, PAD_READ_STUB);
    rt.mem.write32(PAD_BUTTON_PTR, PAD_BUTTON_STUB);
    rt.mem.write32(RESOURCE_PTR, RESOURCE_STUB);
    rt.mem.write32(CARD_INDEX_SLOT, CARD_INDEX_STUB);
    rt.mem.write32(CARD_RECORD_SLOT, CARD_RECORD_STUB);

    // Method tables for the fake widget/row/fade objects.
    for (const target of [W0, W4, W8, ...ROWS, FADE]) {
        for (const slot of SLOTS) rt.mem.write32(target + slot, SLOT_BASE + slot);
    }
    return rt;
}

function seed(rt, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x2c, SETSTATE_STUB);
    rt.mem.write32(OBJ + 0x0c, c.screenState ?? 0);
    rt.mem.write32(OBJ + 0x10, c.state ?? 0);
    rt.mem.write32(OBJ + 0x14, c.rowIndex ?? 0);
    rt.mem.write32(OBJ + 0x60, c.count ?? 0);
    rt.mem.write32(OBJ + 0x74, c.flag ?? 0);
    for (let i = 0; i < 3; i++) rt.mem.write32(OBJ + 0x64 + i * 4, c.scores?.[i] ?? 0);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(ARR + i, 0);
    rt.mem.write32(ARR + 0x00, W0);
    rt.mem.write32(ARR + 0x04, W4);
    rt.mem.write32(ARR + 0x08, W8);
    rt.mem.write32(ARR + 0x18, 0);
    for (let i = 0; i < 3; i++) rt.mem.write32(ARR + 0x0c + i * 4, ROWS[i]);
    for (let i = 0; i < 3; i++) rt.mem.write32(ROWS[i] + 0x10, c.rowStates?.[i] ?? 0);
    rt.mem.write16(RECORD_TABLE, c.recordIndex ?? 0);
    rt.mem.write16(RECORD_TABLE + 2, c.recordCount ?? 0);
    rt.mem.write16(RECORD_TABLE + 4, c.recordCard ?? 0);
    rt.mem.write32(SCORE_TABLE + (c.recordIndex ?? 0) * 0x0c + 8, c.scoreBase ?? 0);
    rt.mem.write16(REC_PTR + 0x3c8, c.matchA ?? 0);
    rt.mem.write16(REC_PTR + 0x3ca, c.matchB ?? 0);
    rt.mem.write32(0x80048d34 + 0x6c, c.money ?? 0);
    if (c.countByteAddr !== undefined) rt.mem.write8(c.countByteAddr, c.countByte ?? 0);

    CONTROL.foldBusy = c.foldBusy ?? 0;
    CONTROL.padValue = c.padValue ?? 0;
    CONTROL.padBit = c.padBit ?? 0xd;
    CONTROL.cardIndex = c.cardIndex ?? 0;
    QUERY.clear();
    for (const [target, slot, value] of c.queries ?? []) QUERY.set(queryKey(target, slot), value);
}

function portHost(rt) {
    return {
        foldStart(ptr, flag) { LOG.push(["foldStart", ptr | 0, flag | 0]); },
        foldBusy(ptr) { LOG.push(["foldBusy", ptr | 0]); return CONTROL.foldBusy; },
        playSound(id) { LOG.push(["playSound", id | 0]); },
        padRead(port) { LOG.push(["padRead", port | 0]); return CONTROL.padValue; },
        padButton(port, code) { LOG.push(["padButton", port | 0, code | 0]); return CONTROL.padBit; },
        resourceBase(id) { LOG.push(["resourceBase", id | 0]); return RES_PTR; },
        cardIndexOf(cardId) { LOG.push(["cardIndex", cardId | 0]); return CONTROL.cardIndex; },
        cardRecord(index) { LOG.push(["cardRecord", index | 0]); return REC_PTR; },
        createFade() { LOG.push(["createFade"]); return FADE; },
        setState(value) { LOG.push(["setState", value | 0]); },
        callMethod(target, slot, args) {
            LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]);
            return QUERY.get(queryKey(target, slot)) ?? 0;
        },
    };
}

function fields(rt) {
    const out = [];
    for (const off of [0x0c, 0x10, 0x14, 0x60, 0x64, 0x68, 0x6c, 0x74]) {
        out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    }
    out.push(`arr18=${rt.mem.read32(ARR + 0x18) >>> 0}`);
    out.push(`money=${rt.mem.read32(0x80048d34 + 0x6c) >>> 0}`);
    return out;
}

function runBoth(rt, c) {
    seed(rt, c);
    LOG.length = 0;
    rt.cpu.call(0x80084ec4, [OBJ, ARR], 40000);
    const oracleLog = LOG.slice();
    const oracleFields = fields(rt);

    seed(rt, c);
    LOG.length = 0;
    reportTick(rt.mem, OBJ, ARR, portHost(rt));
    return { oracleLog, oracleFields, portLog: LOG.slice(), portFields: fields(rt) };
}

const ROW5 = [5, 5, 5];

const CASES = [
    { name: "state 1 rows", state: 1, count: 3 },
    { name: "state 1 empty", state: 1, count: 0 },
    { name: "state 4 all five", state: 4, count: 3, rowStates: ROW5 },
    { name: "state 4 one off", state: 4, count: 3, rowStates: [5, 5, 4] },
    { name: "state 4 empty", state: 4, count: 0 },
    { name: "state 5 busy", state: 5, foldBusy: 1 },
    { name: "state 5 idle", state: 5, foldBusy: 0 },
    { name: "state 6 skip zero row", state: 6, count: 2, rowIndex: 0, scores: [0, 7] },
    { name: "state 6 scored row", state: 6, count: 2, rowIndex: 0, scores: [9, 7] },
    { name: "state 6 past end", state: 6, count: 2, rowIndex: 2 },
    { name: "state 7 idle", state: 7, foldBusy: 0 },
    { name: "state 7 fills widgets", state: 7, foldBusy: 1, rowIndex: 1, scores: [0, 42, 0] },
    {
        name: "state 8 dialog done", state: 8,
        queries: [[W8, 0x168, 1]],
    },
    {
        name: "state 8 confirm plays sound", state: 8,
        queries: [[W8, 0x168, 0], [W8, 0x170, 1]], padValue: 0x2000,
    },
    {
        name: "state 8 confirm arms flag", state: 8,
        queries: [[W8, 0x168, 0], [W8, 0x170, 1]], padValue: 0,
    },
    {
        name: "state 8 idle pad press", state: 8,
        queries: [[W8, 0x168, 0], [W8, 0x170, 0]], padValue: 0x2000,
    },
    {
        name: "state 8 idle", state: 8,
        queries: [[W8, 0x168, 0], [W8, 0x170, 0]], padValue: 0,
    },
    { name: "state A current row", state: 0x0a, rowIndex: 1 },
    { name: "state B closes row", state: 0x0b, rowIndex: 0, rowStates: [5, 0, 0] },
    { name: "state B row not five", state: 0x0b, rowIndex: 0, rowStates: [4, 0, 0] },
    { name: "state C fold busy", state: 0x0c, foldBusy: 1 },
    { name: "state C fold idle", state: 0x0c, foldBusy: 0 },
    {
        name: "state 14 bonus", state: 0x14,
        recordIndex: 1, recordCard: 3, scoreBase: 100, matchA: 0x142, money: 5,
    },
    {
        name: "state 14 no bonus", state: 0x14,
        recordIndex: 1, recordCard: 3, scoreBase: 100, matchA: 0x140, matchB: 0x141, money: 5,
    },
    {
        name: "state 14 money cap", state: 0x14,
        recordIndex: 1, recordCard: 3, scoreBase: 100, matchA: 0x142, money: 0x98967f,
    },
    { name: "state 15 zero skips", state: 0x15, recordCount: 0 },
    {
        name: "state 15 increments", state: 0x15, recordCount: 2, countByteAddr: 0x80048d34 + 2 + 0x7c, countByte: 10,
    },
    {
        name: "state 15 caps at 99", state: 0x15, recordCount: 2, countByteAddr: 0x80048d34 + 2 + 0x7c, countByte: 99,
    },
    {
        name: "state 19 to 0x15", state: 0x19, rowIndex: 0,
        queries: [[W8, 0x168, 1]], flag: 1,
    },
    {
        name: "state 19 to 0x32", state: 0x19, rowIndex: 1,
        queries: [[W8, 0x168, 1]], flag: 1,
    },
    {
        name: "state 19 confirm plays sound", state: 0x19, rowIndex: 0,
        queries: [[W8, 0x168, 0], [W8, 0x170, 1]], padValue: 0x2000,
    },
    {
        name: "state 19 confirm arms flag", state: 0x19, rowIndex: 0,
        queries: [[W8, 0x168, 0], [W8, 0x170, 1]], padValue: 0,
    },
    {
        name: "state 19 idle pad press", state: 0x19, rowIndex: 0,
        queries: [[W8, 0x168, 0], [W8, 0x170, 0]], padValue: 0x2000,
    },
    { name: "state 32 spawns fade", state: 0x32 },
    { name: "state 33 fold idle", state: 0x33, foldBusy: 0 },
    { name: "state 33 rows", state: 0x33, foldBusy: 1, count: 2 },
    { name: "state 34 all fifteen", state: 0x34, count: 3, rowStates: [0xf, 0xf, 0xf] },
    { name: "state 34 one off", state: 0x34, count: 3, rowStates: [0xf, 0xe, 0xf] },
    { name: "state 35 fade done", state: 0x35, screenState: 1 },
    { name: "default zero", state: 0 },
    { name: "default high", state: 0x40 },
];

test("reportTick matches F0x80084EC4", () => {
    const rt = runtime();
    // Fade object reports state 2 for the 0x35 case.
    for (const c of CASES) {
        const cc = { ...c };
        if (cc.state === 0x35) {
            // The fade object is only created in state 0x32; seed it directly.
            seed(rt, cc);
            rt.mem.write32(ARR + 0x18, FADE);
            rt.mem.write32(FADE + 0x0c, 2);
            LOG.length = 0;
            rt.cpu.call(0x80084ec4, [OBJ, ARR], 40000);
            const oracleLog = LOG.slice();
            const oracleFields = fields(rt);
            seed(rt, cc);
            rt.mem.write32(ARR + 0x18, FADE);
            rt.mem.write32(FADE + 0x0c, 2);
            LOG.length = 0;
            reportTick(rt.mem, OBJ, ARR, portHost(rt));
            assert.deepEqual(LOG, oracleLog, `${cc.name}: calls`);
            assert.deepEqual(fields(rt), oracleFields, `${cc.name}: fields`);
            continue;
        }
        const r = runBoth(rt, cc);
        assert.deepEqual(r.portLog, r.oracleLog, `${cc.name}: calls`);
        assert.deepEqual(r.portFields, r.oracleFields, `${cc.name}: fields`);
    }
});
