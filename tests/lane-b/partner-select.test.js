// Lane B Phase 4 oracle: engine/dw3/ui/native/partner-select.ts must match the
// original pro/stdgname partner-select row builder and object tick.
//
//   F0x80085420 partnerRowBuild
//   F0x80085DE4 partnerSelectTick (with its 0x80082F58 jump-table sub-states)
//
// The original runs through engine/native (the interpreter) as the oracle. The
// row factory (F0x8001AE38), the card services (0x80048D34 + 0x2718 / +0x2750 /
// +0x2728), the shared record helper ([0x80044F4C]([0x8005CCA8]+0x40)), the
// widget enable / status cells (0x80087F48 / 0x80087F4C), the grid draw
// (F0x8008559C) and the input handler (F0x80085B70) are stubbed on both sides, so
// the ordered call sequences and the object / slot fields can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    partnerRowBuild,
    partnerSelectTick,
} from "../../engine/dw3/ui/native/partner-select.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const name = new Uint8Array(readFileSync(join(dir, "pro_stdgname.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: name.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80155000;
const ROW_BASE = 0x80160000;

const ROW_BUILD_FN = 0x80085420;
const TICK_FN = 0x80085de4;
const GRID_FN = 0x8008559c;
const INPUT_FN = 0x80085b70;
const CREATE_FN = 0x8001ae38;
const ROW_TABLE = 0x80087d98;
const SELECTION_CELL = 0x80087f38;
const WIDGET_ENABLE_CELL = 0x80087f48;
const WIDGET_STATUS_CELL = 0x80087f4c;
const CARD_INDEX_SLOT = 0x80048d34 + 0x2718;
const CARD_RECORD_SLOT = 0x80048d34 + 0x2750;
const CARD_PRESENT_SLOT = 0x80048d34 + 0x2728;
const RECORD_BASE = 0x8005cca8;
const RECORD_HELPER_CELL = 0x80044f4c;

const STUB = 0x0fe30000;
const M15C = STUB + 0x10;
const M114 = STUB + 0x14;
const M138 = STUB + 0x18;
const M144 = STUB + 0x1c;
const M38 = STUB + 0x20;
const M3C = STUB + 0x24;
const M28 = STUB + 0x28;
const ENABLE_STUB = STUB + 0x30;
const STATUS_STUB = STUB + 0x34;
const CARD_IDX_STUB = STUB + 0x38;
const CARD_REC_STUB = STUB + 0x3c;
const CARD_PRESENT_STUB = STUB + 0x40;
const HELPER_STUB = STUB + 0x44;

const LOG = [];
const CONTROL = { status: {}, cardPresent: [-1, -1, -1], cardIndex: 7, cardRecord: 0x80170000, record: 0x80171000, input: 0 };
let made = 0;

function runtime() {
    const rt = new NativeStageRuntime(name, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(CREATE_FN, (c) => {
        LOG.push(["createRow", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const row = ROW_BASE + made * 0x100;
        made += 1;
        rt.mem.write32(row + 0x15c, M15C);
        rt.mem.write32(row + 0x114, M114);
        rt.mem.write32(row + 0x138, M138);
        rt.mem.write32(row + 0x144, M144);
        return row;
    });
    const methods = [[M15C, 0x15c, 1], [M114, 0x114, 2], [M138, 0x138, 1], [M144, 0x144, 1], [M38, 0x38, 0], [M3C, 0x3c, 0], [M28, 0x28, 1]];
    for (const [addr, slot, arity] of methods) {
        rt.cpu.setStub(addr, (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }
    rt.cpu.setStub(ENABLE_STUB, (c) => { LOG.push(["setFlag", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(STATUS_STUB, (c) => {
        const widget = c.reg(4) | 0;
        LOG.push(["status", widget]);
        return CONTROL.status[(c.reg(4) >>> 0)] ?? 0;
    });
    rt.cpu.setStub(CARD_IDX_STUB, (c) => { LOG.push(["cardIndex", c.reg(4) | 0]); return CONTROL.cardIndex; });
    rt.cpu.setStub(CARD_REC_STUB, (c) => { LOG.push(["cardRecord", c.reg(4) | 0]); return CONTROL.cardRecord; });
    rt.cpu.setStub(CARD_PRESENT_STUB, (c) => { LOG.push(["cardPresent", c.reg(4) | 0]); return CONTROL.cardPresent[c.reg(4) | 0] ?? -1; });
    rt.cpu.setStub(HELPER_STUB, (c) => { LOG.push(["helper", c.reg(4) | 0]); return CONTROL.record; });
    rt.cpu.setStub(GRID_FN, (c) => { LOG.push(["gridDraw", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(INPUT_FN, (c) => { LOG.push(["input", c.reg(4) | 0, c.reg(5) | 0]); return CONTROL.input; });
    rt.mem.write32(CARD_INDEX_SLOT, CARD_IDX_STUB);
    rt.mem.write32(CARD_RECORD_SLOT, CARD_REC_STUB);
    rt.mem.write32(CARD_PRESENT_SLOT, CARD_PRESENT_STUB);
    rt.mem.write32(WIDGET_ENABLE_CELL, ENABLE_STUB);
    rt.mem.write32(WIDGET_STATUS_CELL, STATUS_STUB);
    rt.mem.write32(RECORD_HELPER_CELL, HELPER_STUB);
    return rt;
}

function portHost() {
    return {
        createRowObject(scale, kind, tableLo, tableHi) {
            LOG.push(["createRow", scale | 0, kind | 0, tableLo | 0, tableHi | 0]);
            const row = ROW_BASE + made * 0x100;
            made += 1;
            return row;
        },
        recordHelper(arg) { LOG.push(["helper", arg | 0]); return CONTROL.record; },
        cardIndexOf(cardId) { LOG.push(["cardIndex", cardId | 0]); return CONTROL.cardIndex; },
        cardRecord(index) { LOG.push(["cardRecord", index | 0]); return CONTROL.cardRecord; },
        cardPresent(index) { LOG.push(["cardPresent", index | 0]); return CONTROL.cardPresent[index | 0] ?? -1; },
        setWidgetFlag(widget, flag) { LOG.push(["setFlag", widget | 0, flag | 0]); },
        widgetStatus(widget) { LOG.push(["status", widget | 0]); return CONTROL.status[widget >>> 0] ?? 0; },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
        gridDraw(obj, arg1) { LOG.push(["gridDraw", obj | 0, arg1 | 0]); },
        inputHandler(obj, arg1) { LOG.push(["input", obj | 0, arg1 | 0]); return CONTROL.input; },
    };
}

function clear(rt, addr, size) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(addr + i, 0);
}

function seedRowBuild(rt, c) {
    clear(rt, OBJ, 0x80);
    clear(rt, ARG1, 0x40);
    clear(rt, ROW_BASE, 0x300);
    rt.mem.write32(OBJ + 0x54, c.scale ?? 0x1000);
    rt.mem.write32(ARG1, c.slot ?? 0);
    if (c.slot) {
        clear(rt, c.slot, 0x180);
        rt.mem.write32(c.slot + 0x15c, M15C);
        rt.mem.write32(c.slot + 0x114, M114);
        rt.mem.write32(c.slot + 0x138, M138);
        rt.mem.write32(c.slot + 0x144, M144);
    }
    for (let i = 0; i < 8; i++) {
        const entry = ROW_TABLE + i * 0xc;
        rt.mem.write32(entry + 0x0, c.table0 ?? (0x11110000 + i));
        rt.mem.write32(entry + 0x4, c.table4 ?? (0x10 + i));
        rt.mem.write32(entry + 0x8, c.table8 ?? (0x20 + i));
    }
    rt.mem.write32(SELECTION_CELL, c.selection ?? 0x1234);
    rt.mem.write32(RECORD_BASE, 0x801c0000);
    CONTROL.record = c.record ?? 0x80171000;
    CONTROL.cardIndex = c.cardIndex ?? 7;
    CONTROL.cardRecord = c.cardRecord ?? 0x80170000;
}

function rowSnap(rt) {
    const out = [`slot=${rt.mem.read32(ARG1) >>> 0}`];
    for (let i = 0; i < 3; i++) out.push(`row${i}50=${rt.mem.read32(ROW_BASE + i * 0x100 + 0x50) >>> 0}`);
    return out;
}

test("partnerRowBuild matches F0x80085420", () => {
    const rt = runtime();
    const cases = [
        { name: "index 0 creates", a2: 0, a3: 1 },
        { name: "index 1 creates", a2: 1, a3: 1 },
        { name: "index 2 card", a2: 2, a3: 1 },
        { name: "index 3 card", a2: 3, a3: 1 },
        { name: "index 4 card", a2: 4, a3: 1 },
        { name: "index 5 helper", a2: 5, a3: 1 },
        { name: "index 6 helper", a2: 6, a3: 1 },
        { name: "existing slot", a2: 2, a3: 1, slot: 0x80161000 },
        { name: "remove existing", a2: 0, a3: 0, slot: 0x80161000 },
        { name: "remove empty", a2: 0, a3: 0, slot: 0 },
        { name: "signed table", a2: 6, a3: 1, table4: 0x0000ffff, table8: 0x00008000, scale: 0xffff8000 },
        { name: "bad scale negative", a2: 0, a3: 1, scale: 0xffff8000 },
    ];
    for (const c of cases) {
        seedRowBuild(rt, c);
        made = 0;
        LOG.length = 0;
        rt.cpu.call(ROW_BUILD_FN, [OBJ, ARG1, c.a2, c.a3], 40000);
        const olog = LOG.slice();
        const osnap = rowSnap(rt);
        const omade = made;

        seedRowBuild(rt, c);
        made = 0;
        LOG.length = 0;
        partnerRowBuild(rt.mem, OBJ, ARG1, c.a2, c.a3, portHost());
        const plog = LOG.slice();
        assert.deepEqual(plog, olog, `${c.name}: calls`);
        assert.deepEqual(rowSnap(rt), osnap, `${c.name}: fields`);
        assert.equal(made, omade, `${c.name}: rows made`);
    }
});

function seedTick(rt, c) {
    clear(rt, OBJ, 0x100);
    clear(rt, ARG1, 0x40);
    clear(rt, ROW_BASE, 0x300);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x10, c.sub ?? 0);
    rt.mem.write32(OBJ + 0x14, c.index ?? 0);
    rt.mem.write32(OBJ + 0x78, c.count ?? 0);
    rt.mem.write32(OBJ + 0x38, M38);
    rt.mem.write32(OBJ + 0x3c, M3C);
    rt.mem.write32(OBJ + 0x28, M28);
    rt.mem.write32(OBJ + 0x54, c.scale ?? 0x1000);
    rt.mem.write32(ARG1, c.slot0 ?? 0);
    rt.mem.write32(ARG1 + 4, c.slot1 ?? 0);
    for (let i = 0; i < 8; i++) {
        const entry = ROW_TABLE + i * 0xc;
        rt.mem.write32(entry + 0x0, 0x11110000 + i);
        rt.mem.write32(entry + 0x4, 0x10 + i);
        rt.mem.write32(entry + 0x8, 0x20 + i);
    }
    rt.mem.write32(SELECTION_CELL, 0x1234);
    rt.mem.write32(RECORD_BASE, 0x801c0000);
    CONTROL.status = c.status ?? {};
    CONTROL.cardPresent = c.cardPresent ?? [-1, -1, -1];
    CONTROL.input = c.input ?? 0;
    CONTROL.record = 0x80171000;
    CONTROL.cardIndex = 7;
    CONTROL.cardRecord = 0x80170000;
}

function tickSnap(rt) {
    const out = [];
    for (const off of [0x0c, 0x10, 0x14, 0x78, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0]) {
        out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    }
    for (let i = 0; i < 6; i++) out.push(`slot${i}=${rt.mem.read32(ARG1 + i * 4) >>> 0}`);
    return out;
}

test("partnerSelectTick matches F0x80085DE4", () => {
    const rt = runtime();
    const w = (o) => (OBJ + o) >>> 0;
    const cases = [
        { name: "state 0 default", state: 0, status: {}, count: 0 },
        { name: "state 4 default", state: 4, status: {}, count: 2, cardPresent: [0, -1, 0] },
        { name: "state 2 noop", state: 2, status: { [w(0x80)]: 1 } },
        { name: "state 3 noop", state: 3 },
        { name: "sub 0 default", state: 1, sub: 0, status: {}, count: 0 },
        { name: "sub 1 banners ready", state: 1, sub: 1, status: { [w(0x80)]: 1, [w(0x90)]: 1 }, count: 0 },
        { name: "sub 1 banners not ready", state: 1, sub: 1, status: { [w(0x80)]: 1, [w(0x90)]: 0 }, count: 0 },
        { name: "sub 2 next row", state: 1, sub: 2, index: 0, count: 3, status: { [w(0xb0)]: 1 } },
        { name: "sub 2 last row", state: 1, sub: 2, index: 2, count: 3, status: { [w(0xd0)]: 1 } },
        { name: "sub 2 not ready", state: 1, sub: 2, index: 1, count: 3, status: { [w(0xc0)]: 0 } },
        { name: "sub 3 advance", state: 1, sub: 3, status: { [w(0xa0)]: 1 } },
        { name: "sub 3 hold", state: 1, sub: 3, status: { [w(0xa0)]: 0 } },
        { name: "sub 4 input", state: 1, sub: 4, input: 1, count: 2 },
        { name: "sub 4 no input", state: 1, sub: 4, input: 0, count: 2 },
        { name: "sub 5 advance", state: 1, sub: 5, status: { [w(0xa0)]: 1 } },
        { name: "sub 6 all ready", state: 1, sub: 6, count: 6, status: { [w(0x80)]: 1, [w(0x90)]: 1, [w(0xa0)]: 1, [w(0xb0)]: 1, [w(0xc0)]: 1, [w(0xd0)]: 1 } },
        { name: "sub 6 not all", state: 1, sub: 6, count: 6, status: { [w(0x80)]: 1, [w(0x90)]: 1, [w(0xa0)]: 1, [w(0xb0)]: 1, [w(0xc0)]: 1, [w(0xd0)]: 0 } },
        { name: "sub 7 default", state: 1, sub: 7, status: {} },
    ];
    for (const c of cases) {
        seedTick(rt, c);
        made = 0;
        LOG.length = 0;
        rt.cpu.call(TICK_FN, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const osnap = tickSnap(rt);
        const omade = made;

        seedTick(rt, c);
        made = 0;
        LOG.length = 0;
        partnerSelectTick(rt.mem, OBJ, ARG1, portHost());
        const plog = LOG.slice();
        assert.deepEqual(plog, olog, `${c.name}: calls`);
        assert.deepEqual(tickSnap(rt), osnap, `${c.name}: fields`);
        assert.equal(made, omade, `${c.name}: rows made`);
    }
});
