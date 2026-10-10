// Lane B Phase 4 oracle: engine/dw3/ui/native/wfight-panel.ts must match the
// original pro/wfightts number-editor panel (the battle test harness's smaller
// panel).
//
//   F0x800A931C wfightPanelCreate
//   F0x800A8D34 wfightPanelTick (init state 0/>=4, update+draw state 1)
//
// The original runs through engine/native (the interpreter) as the oracle. The
// editor service ([0x8004B7BC], its +0x190 category method), the category setter
// (0x800A4558+0x18), the list service ([0x80044F5C]), the widget factory
// (F0x8001AE38), the three pad reads (0x8004B7D0 + 0x3F4 / 0x3FC / 0x3F8), the
// frame counter (0x8004DE10 + 0x188) and every object method are stubbed on both
// sides, so the ordered call sequences and the panel cells can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    wfightPanelCreate,
    wfightPanelTick,
} from "../../engine/dw3/ui/native/wfight-panel.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_wfightts.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80152000;
const PANEL = 0x80160000;
const CELL_A = 0x80161000;
const CELL_B = 0x80161004;
const WIDGET_BASE = 0x80170000;
const SERVICE = 0x80180000;
const BLOCK_PTR = 0x80181000;
const LIST_PTR = 0x80182000;

const CREATE_FN = 0x800a931c;
const TICK_FN = 0x800a8d34;
const ALLOC_FN = 0x800143dc;
const WIDGET_FN = 0x8001ae38;
const SERVICE_FN = 0x8004b7bc;
const LIST_FN = 0x80044f5c;
const BLOCK_CELL = 0x800a4558 + 0x10;
const CAT_CELL = 0x800a4558 + 0x18;
const PAD_A_CELL = 0x8004b7d0 + 0x3f4;
const PAD_B_CELL = 0x8004b7d0 + 0x3fc;
const PAD_C_CELL = 0x8004b7d0 + 0x3f8;
const TIME_CELL = 0x8004de10 + 0x188;
const SELECT = 0x800a96d0;
const SELECTED_ROW = 0x800a96d8;
const COLOURS = 0x800a95e8;

const STUB = 0x0fd90000;
const SERVICE_METHOD = STUB + 0x10;
const SERVICE_OPEN_STUB = STUB + 0x40;
const CAT_STUB = STUB + 0x14;
const LIST_STUB = STUB + 0x18;
const PAD_A_STUB = STUB + 0x1c;
const PAD_B_STUB = STUB + 0x20;
const PAD_C_STUB = STUB + 0x24;
const TIME_STUB = STUB + 0x28;
const M28 = STUB + 0x30;
const M38 = STUB + 0x34;
const M144 = STUB + 0x38;
const M110 = STUB + 0x3c;

const LOG = [];
const CONTROL = { categories: [0, 0], block: 0x1234, list: LIST_PTR, buttonsA: 0, buttonsB: 0, buttonsC: 0, frame: 0 };
let made = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x800a5de0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(ALLOC_FN, (c) => {
        LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return PANEL;
    });
    rt.cpu.setStub(WIDGET_FN, (c) => {
        LOG.push(["widget", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = WIDGET_BASE + made * 0x80;
        made += 1;
        rt.mem.write32(widget + 0x144, M144);
        rt.mem.write32(widget + 0x110, M110);
        return widget;
    });
    rt.cpu.setStub(SERVICE_OPEN_STUB, (c) => { LOG.push(["openService", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return SERVICE; });
    rt.cpu.setStub(SERVICE_METHOD, (c) => { LOG.push(["serviceCategory", c.reg(4) | 0, c.reg(5) | 0]); return CONTROL.categories[(c.reg(5) | 0) >> 4] ?? 0; });
    rt.cpu.setStub(CAT_STUB, (c) => { LOG.push(["setCategory", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(LIST_STUB, (c) => { LOG.push(["resolveList", c.reg(4) | 0]); return CONTROL.list; });
    rt.cpu.setStub(PAD_A_STUB, () => CONTROL.buttonsA);
    rt.cpu.setStub(PAD_B_STUB, () => CONTROL.buttonsB);
    rt.cpu.setStub(PAD_C_STUB, () => CONTROL.buttonsC);
    rt.cpu.setStub(TIME_STUB, () => CONTROL.frame);
    const methods = [[M28, 0x28, 1], [M38, 0x38, 0], [M144, 0x144, 1], [M110, 0x110, 1]];
    for (const [addr, slot, arity] of methods) {
        rt.cpu.setStub(addr, (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }
    rt.mem.write32(SERVICE + 0x190, SERVICE_METHOD);
    rt.mem.write32(SERVICE_FN, SERVICE_OPEN_STUB);
    rt.mem.write32(CAT_CELL, CAT_STUB);
    rt.mem.write32(LIST_FN, LIST_STUB);
    rt.mem.write32(PAD_A_CELL, PAD_A_STUB);
    rt.mem.write32(PAD_B_CELL, PAD_B_STUB);
    rt.mem.write32(PAD_C_CELL, PAD_C_STUB);
    rt.mem.write32(TIME_CELL, TIME_STUB);
    rt.mem.write32(BLOCK_CELL, BLOCK_PTR);
    return rt;
}

function portHost() {
    return {
        createPanel(handler, size, extra, tag) {
            LOG.push(["alloc", handler | 0, size | 0, extra | 0, tag | 0]);
            return PANEL;
        },
        openService(a, b, c) { LOG.push(["openService", a | 0, b | 0, c | 0]); return SERVICE; },
        serviceCategory(service, arg) {
            LOG.push(["serviceCategory", service | 0, arg | 0]);
            return CONTROL.categories[arg >> 4] ?? 0;
        },
        setEntryCategory(category, entry) { LOG.push(["setCategory", category | 0, entry | 0]); },
        resolveList(block) { LOG.push(["resolveList", block | 0]); return CONTROL.list; },
        createWidget(kind, flag, y, x) {
            LOG.push(["widget", kind | 0, flag | 0, y | 0, x | 0]);
            const widget = WIDGET_BASE + made * 0x80;
            made += 1;
            return widget;
        },
        padButtons3F4() { return CONTROL.buttonsA; },
        padButtons3FC() { return CONTROL.buttonsB; },
        padButtons3F8() { return CONTROL.buttonsC; },
        frameCounter() { return CONTROL.frame; },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

function clear(rt, addr, size) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(addr + i, 0);
}

function seedCommon(rt) {
    clear(rt, OBJ, 0x100);
    clear(rt, ARG1, 0x100);
    clear(rt, PANEL, 0x100);
    clear(rt, SELECT, 0x20);
    clear(rt, LIST_PTR, 0x80);
    clear(rt, BLOCK_PTR, 0x10);
    rt.mem.write32(BLOCK_PTR + 8, CONTROL.block);
    rt.mem.write32(OBJ + 0x0c, 0);
    rt.mem.write32(OBJ + 0x28, M28);
    rt.mem.write32(OBJ + 0x38, M38);
    rt.mem.write32(OBJ + 0xf8, CELL_A);
    rt.mem.write32(OBJ + 0xfc, CELL_B);
    for (let k = 0; k < 0x20; k++) rt.mem.write32(COLOURS + k * 4, 0x9000 + k);
}

function panelSnap(rt) {
    const out = [];
    for (const off of [0x0c, 0x28, 0x38, 0xf8, 0xfc]) out.push(`obj${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    for (let row = 0; row < 2; row++) {
        for (let off = 0; off <= 0x54; off += 4) {
            out.push(`r${row}_${off.toString(16)}=${rt.mem.read32(OBJ + 0x50 + row * 0x54 + off) >>> 0}`);
        }
    }
    for (const [name, base] of [["sel", SELECT], ["row", SELECTED_ROW]]) {
        out.push(`${name}=${rt.mem.read32(base) >>> 0}`);
    }
    for (let row = 0; row < 2; row++) {
        out.push(`c${row}=${rt.mem.read32(SELECT + row * 4 + 0x0c) >>> 0}`);
        out.push(`s${row}=${rt.mem.read32(SELECT + row * 4 + 0x14) >>> 0}`);
    }
    for (let i = 0; i < 0x20; i++) out.push(`a${i}=${rt.mem.read32(ARG1 + i * 4) >>> 0}`);
    out.push(`ca=${rt.mem.read32(CELL_A) >>> 0}`);
    out.push(`cb=${rt.mem.read32(CELL_B) >>> 0}`);
    return out;
}

test("wfightPanelCreate matches F0x800A931C", () => {
    const rt = runtime();
    made = 0;
    LOG.length = 0;
    rt.cpu.call(CREATE_FN, [CELL_A, CELL_B], 40000);
    const olog = LOG.slice();
    const ofields = [rt.mem.read32(PANEL + 0xf8) >>> 0, rt.mem.read32(PANEL + 0xfc) >>> 0];

    made = 0;
    LOG.length = 0;
    const port = wfightPanelCreate(rt.mem, CELL_A, CELL_B, portHost());
    assert.deepEqual(LOG.slice(), olog, "calls");
    assert.equal(port, PANEL, "panel");
    assert.deepEqual([rt.mem.read32(PANEL + 0xf8) >>> 0, rt.mem.read32(PANEL + 0xfc) >>> 0], ofields, "fields");
});

test("wfightPanelTick init matches F0x800A8D34", () => {
    const rt = runtime();
    const listValues = (n, offset = 1) => {
        const a = new Array(0x1f).fill(0);
        for (let i = 0; i < n; i++) a[i] = offset + i;
        return a;
    };
    const cases = [
        { name: "empty list", categories: [5, 9], block: 0x1234, list: listValues(0) },
        { name: "three entries", categories: [5, 9], block: 0x1234, list: listValues(3) },
        { name: "list cap 19", categories: [5, 9], block: 0x1234, list: listValues(19) },
        { name: "gap list", categories: [5, 9], block: 0x1234, list: (() => { const a = listValues(0); a[0] = 0; a[1] = 2; a[4] = 5; return a; })() },
        { name: "no block", categories: [5, 9], block: 0, list: listValues(3) },
        { name: "same category", categories: [5, 9], block: 0x1234, list: listValues(2), entry0: 5, entry1: 9 },
        { name: "states >=4", categories: [7, 8], block: 0x1234, list: listValues(2), state: 4 },
    ];
    for (const c of cases) {
        CONTROL.categories = c.categories;
        CONTROL.block = c.block;
        CONTROL.list = LIST_PTR;

        seedCommon(rt);
        rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
        if (c.entry0 !== undefined) rt.mem.write32(SELECT, c.entry0);
        if (c.entry1 !== undefined) rt.mem.write32(SELECT + 4, c.entry1);
        for (let i = 0; i < c.list.length; i++) rt.mem.write32(LIST_PTR + i * 4, c.list[i]);
        made = 0;
        LOG.length = 0;
        rt.cpu.call(TICK_FN, [OBJ, ARG1], 60000);
        const olog = LOG.slice();
        const osnap = panelSnap(rt);
        const omade = made;

        seedCommon(rt);
        rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
        if (c.entry0 !== undefined) rt.mem.write32(SELECT, c.entry0);
        if (c.entry1 !== undefined) rt.mem.write32(SELECT + 4, c.entry1);
        for (let i = 0; i < c.list.length; i++) rt.mem.write32(LIST_PTR + i * 4, c.list[i]);
        made = 0;
        LOG.length = 0;
        wfightPanelTick(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG.slice(), olog, `${c.name}: calls`);
        assert.deepEqual(panelSnap(rt), osnap, `${c.name}: cells`);
        assert.equal(made, omade, `${c.name}: widgets made`);
    }
});

function seedUpdate(rt, c) {
    seedCommon(rt);
    clear(rt, WIDGET_BASE, 0x400);
    rt.mem.write32(OBJ + 0x0c, 1);
    rt.mem.write32(OBJ + 0xf8, CELL_A);
    rt.mem.write32(OBJ + 0xfc, CELL_B);
    CONTROL.block = 0;
    CONTROL.categories = [0, 1];
    const rows = c.rows ?? [
        { count: 3, total: 5 },
        { count: 2, total: 4 },
    ];
    for (let row = 0; row < 2; row++) {
        const rowBase = OBJ + row * 0x54;
        rt.mem.write32(rowBase + 0xa0, rows[row].count);
        rt.mem.write32(rowBase + 0x9c, rows[row].total);
        for (let i = 0; i < rows[row].count; i++) {
            rt.mem.write32(rowBase + 0x50 + i * 4, 2 + ((row + i) % 3));
            const widget = WIDGET_BASE + (row * 4 + i) * 0x80;
            rt.mem.write32(widget + 0x144, M144);
            rt.mem.write32(widget + 0x110, M110);
            rt.mem.write32(ARG1 + row * 0x38 + i * 4, widget);
        }
    }
    rt.mem.write32(SELECTED_ROW, c.selRow ?? 0);
    rt.mem.write32(SELECT + (c.selRow ?? 0) * 4 + 0x0c, c.col ?? 0);
    rt.mem.write32(SELECT + (c.selRow ?? 0) * 4 + 0x14, c.scroll ?? 0);
    for (let row = 0; row < 2; row++) {
        if (row !== (c.selRow ?? 0)) rt.mem.write32(SELECT + row * 4 + 0x0c, 0);
    }
    CONTROL.buttonsA = c.buttonsA ?? 0;
    CONTROL.buttonsB = c.buttonsB ?? 0;
    CONTROL.buttonsC = c.buttonsC ?? 0;
    CONTROL.frame = c.frame ?? 0;
}

test("wfightPanelTick update and draw match F0x800A8D34", () => {
    const rt = runtime();
    const cases = [
        { name: "idle draw", frame: 0 },
        { name: "selected blink hides", col: 1, frame: 8 },
        { name: "selected no blink", col: 1, frame: 0 },
        { name: "left col", buttonsA: 0x10, col: 2 },
        { name: "left scroll", buttonsA: 0x10, col: 0, scroll: 2 },
        { name: "left step ten", buttonsA: 0x10, buttonsC: 0x8000, col: 3 },
        { name: "right col", buttonsA: 0x40, col: 1 },
        { name: "right scroll", buttonsA: 0x40, col: 2, scroll: 0 },
        { name: "right at limit", buttonsA: 0x40, col: 2, scroll: 2 },
        { name: "select row 0", buttonsA: 0x20 },
        { name: "select row 1", buttonsA: 0x80 },
        { name: "cancel", buttonsA: 0x4000 },
        { name: "confirm filled", buttonsA: 0x2000, col: 0, scroll: 0 },
        { name: "confirm empty", buttonsA: 0x2000, col: 0, scroll: 0, rows: [{ count: 3, total: 5 }, { count: 2, total: 4 }], emptyCell: true },
        { name: "confirm row1", buttonsA: 0x2000, selRow: 1, col: 1, scroll: 0 },
        { name: "row1 draw blink", selRow: 1, col: 0, frame: 8 },
        { name: "priority left over right", buttonsA: 0x50, col: 1 },
        { name: "priority select over left", buttonsA: 0x30, col: 1 },
    ];
    for (const c of cases) {
        seedUpdate(rt, c);
        if (c.emptyCell) {
            const sum = (c.col ?? 0) + (c.scroll ?? 0);
            rt.mem.write32(OBJ + (c.selRow ?? 0) * 0x54 + sum * 4 + 0x50, 0);
        }
        made = 0;
        LOG.length = 0;
        rt.cpu.call(TICK_FN, [OBJ, ARG1], 60000);
        const olog = LOG.slice();
        const osnap = panelSnap(rt);

        seedUpdate(rt, c);
        if (c.emptyCell) {
            const sum = (c.col ?? 0) + (c.scroll ?? 0);
            rt.mem.write32(OBJ + (c.selRow ?? 0) * 0x54 + sum * 4 + 0x50, 0);
        }
        made = 0;
        LOG.length = 0;
        wfightPanelTick(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG.slice(), olog, `${c.name}: calls`);
        assert.deepEqual(panelSnap(rt), osnap, `${c.name}: cells`);
    }
});
