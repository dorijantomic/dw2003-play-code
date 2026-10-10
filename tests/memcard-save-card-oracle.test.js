// Phase 4 oracle: engine/dw3/ui/memcard-save-card.ts memcardSaveCardCreate,
// memcardSaveCardReset and memcardSaveCardTick must match pro/stgmcard
// F0x80083B6C / F0x80083BD8 / F0x800836C4. The original runs through
// engine/native with the object factory, the widget factory, the fold pair,
// the fill routine and the draw-context methods stubbed; the port uses an
// equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    memcardSaveCardCreate,
    memcardSaveCardReset,
    memcardSaveCardTick,
} from "../engine/dw3/ui/memcard-save-card.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgmcard = new Uint8Array(readFileSync(join(dir, "pro_stgmcard.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgmcard.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const CARD = 0x80180000;
const PARENT = 0x80181000;
const WIDGET_BASE = 0x80182000;
const WIDGET_ARRAY = 0x80183000;
const PACK_STUB = 0x0fde0000;
const PACK_PTR = 0x80190000;
const SET_SUB1 = 0x80014288;
const ADV_STATE = 0x800142ac;
const WIDGET_SETC0 = 0x0fde0010;
const FOLD_START_STUB = 0x0fde0020;
const FOLD_TICK_STUB = 0x0fde0030;
const FILL_STUB = 0x0fde0040;
const FRAME = 5000;
const ARITY = { setOrigin: 2, setLayer: 2, setScale: 3, setPos: 2, drawSprite: 4 };

let EVENTS = [];
let DRAW = [];
let ORACLE_DRAW = [];
let WIDGET_NEXT = 0;
let FOLD_TICK_RESULT = 0;
let LANG = 0x40;
let SELECTED = 0;

function runtime() {
    const rt = new NativeStageRuntime(stgmcard, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8004de20, FRAME);
    rt.mem.write32(0x8008876c, SELECTED);
    rt.mem.write32(0x8005cca8, LANG);
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        return CARD;
    });
    rt.cpu.setStub(0x8001ae38, (c) => {
        EVENTS.push(["create", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        const w = (WIDGET_BASE + (WIDGET_NEXT++ % 8) * 0x100) >>> 0;
        rt.mem.write32(w + 0x138, WIDGET_SETC0);
        return w;
    });
    rt.cpu.setStub(WIDGET_SETC0, (c) => { EVENTS.push(["setC0", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(FOLD_START_STUB, (c) => { EVENTS.push(["foldStart", c.reg(4), c.reg(5)]); return 0; });
    rt.mem.write32(0x80088790, FOLD_START_STUB);
    rt.cpu.setStub(FOLD_TICK_STUB, (c) => { EVENTS.push(["foldTick", c.reg(4)]); return FOLD_TICK_RESULT; });
    rt.mem.write32(0x80088794, FOLD_TICK_STUB);
    rt.cpu.setStub(FILL_STUB, (c) => { EVENTS.push(["fill", c.reg(4)]); return 0; });
    rt.cpu.setStub(0x8008316c, (c) => { EVENTS.push(["fill", c.reg(4)]); return 0; });
    rt.cpu.setStub(PACK_STUB, () => PACK_PTR);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(SET_SUB1, (c) => {
        const o = c.reg(4);
        rt.mem.write32(o + 0x10, c.reg(5));
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        EVENTS.push(["substate", o, c.reg(5)]);
        return 0;
    });
    rt.cpu.setStub(ADV_STATE, (c) => {
        const o = c.reg(4);
        const v = (rt.mem.read32(o + 0xc) + 1) | 0;
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        rt.mem.write32(o + 0xc, v);
        EVENTS.push(["advance", o]);
        return v;
    });
    return rt;
}

const rt = runtime();

function seedCard(o) {
    EVENTS = [];
    DRAW = [];
    WIDGET_NEXT = 0;
    FOLD_TICK_RESULT = o.foldTick ?? 0;
    LANG = o.lang ?? 0x40;
    SELECTED = o.sel ?? 0;
    rt.mem.write32(0x8005cca8, LANG);
    rt.mem.write32(0x8008876c, SELECTED);
    for (let i = 0; i < 0xe0; i += 4) rt.mem.write32(CARD + i, o.raw ? 0xdead : 0);
    rt.mem.write32(CARD + 0x2c, SET_SUB1);
    rt.mem.write32(CARD + 0x38, ADV_STATE);
    rt.mem.write32(CARD + 0x0c, o.state ?? 0);
    rt.mem.write32(CARD + 0x10, o.substate ?? 0);
    rt.mem.write32(CARD + 0x14, o.step ?? 0);
    rt.mem.write32(CARD + 0x20, o.count ?? 0);
    rt.mem.write32(CARD + 0x24, WIDGET_ARRAY);
    rt.mem.write32(CARD + 0x50, PARENT);
    rt.mem.write32(CARD + 0x54, o.target ?? 0x1000);
    rt.mem.write32(CARD + 0x58, o.bucket ?? 1);
    rt.mem.write32(CARD + 0x5c, o.visible ?? 0);
    rt.mem.write32(CARD + 0x60, o.fillFlag ?? 0);
    rt.mem.write32(CARD + 0x64, o.stamp ?? FRAME);
    rt.mem.write32(CARD + 0x68, o.anim0 ?? 0);
    rt.mem.write32(CARD + 0x6c, o.anim1 ?? 0);
    rt.mem.write32(CARD + 0x70, o.anim2 ?? 0);
    rt.mem.write32(CARD + 0x74, o.fold ?? 0);
    rt.mem.write32(CARD + 0x78, o.foldAux ?? 0);
    rt.mem.write32(CARD + 0x7c, o.foldValue ?? 0);
    // clear the parent's four slot records, then seed the selected one
    for (let s = 0; s < 4; s++) for (let i = 0; i < 4; i++) rt.mem.write32(PARENT + s * 0x44 + 0xa4 + i * 4, 0);
    const recs = o.records ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) rt.mem.write32(PARENT + SELECTED * 0x44 + 0xa4 + i * 4, recs[i] ?? 0);
    const pre = o.pre ?? [];
    for (let i = 0; i < (o.count ?? 0); i++) {
        const w = pre[i] ? (WIDGET_BASE + i * 0x100) >>> 0 : 0;
        rt.mem.write32(WIDGET_ARRAY + i * 4, w);
        if (w !== 0) rt.mem.write32(w + 0x138, WIDGET_SETC0);
    }
}

function cardFields() {
    const out = [];
    for (let i = 0; i < 0xe0; i += 4) out.push(rt.mem.read32(CARD + i) >>> 0);
    return out;
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function normEvents(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        advancePhase(o) {
            const v = (rt.mem.read32(o + 0xc) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0xc, v);
            EVENTS.push(["advance", o]);
        },
        createTextElement(target, kind, x, y) {
            EVENTS.push(["create", target, kind, x, y]);
            const w = (WIDGET_BASE + (WIDGET_NEXT++ % 8) * 0x100) >>> 0;
            rt.mem.write32(w + 0x138, WIDGET_SETC0);
            return w;
        },
        widgetSetC0(w, v) { EVENTS.push(["setC0", w >>> 0, v]); },
        foldStart(fold, dir) { EVENTS.push(["foldStart", fold >>> 0, dir]); },
        foldTick(fold) { EVENTS.push(["foldTick", fold >>> 0]); return FOLD_TICK_RESULT; },
        setSubstate(o, v) {
            rt.mem.write32(o + 0x10, v >>> 0);
            rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            EVENTS.push(["substate", o, v >>> 0]);
        },
        fill(card) { EVENTS.push(["fill", card >>> 0]); },
        initDrawContext() {},
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setScale(x, y, z) { DRAW.push(["setScale", [x, y, z, 0]]); },
        setPos(x, y) { DRAW.push(["setPos", [x, y, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
        frameTick() { return rt.mem.read32(0x8004de20) | 0; },
        selectedSlotIndex() { return rt.mem.read32(0x8008876c) | 0; },
        languageIndex() { return rt.mem.read32(0x8005cca8) | 0; },
    };
}

function runCase(label, o) {
    seedCard(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x800836c4, [CARD]);
    const oracleEvents = EVENTS.slice();
    ORACLE_DRAW = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = cardFields();

    seedCard(o);
    memcardSaveCardTick(rt.mem, CARD, portHost());
    const portEvents = EVENTS.slice();
    const portDraw = normDraw(DRAW);
    const portFields = cardFields();

    assert.deepEqual(normEvents(portEvents), normEvents(oracleEvents), `${label}: calls`);
    assert.deepEqual(portDraw, ORACLE_DRAW, `${label}: draw`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("memcardSaveCardCreate matches F0x80083B6C", () => {
    seedCard({ raw: 1 });
    EVENTS = [];
    rt.cpu.call(0x80083b6c, [PARENT]);
    const oracleAlloc = EVENTS.filter((e) => e[0] === "alloc");
    const oracleFields = [0x50, 0x54, 0x58, 0x84, 0x88, 0x8c].map((off) => rt.mem.read32(CARD + off) >>> 0);

    seedCard({ raw: 1 });
    EVENTS = [];
    const portCard = memcardSaveCardCreate(rt.mem, PARENT, {
        allocCard(handler, size, extra) { EVENTS.push(["alloc", handler, size, extra]); return CARD; },
    });
    assert.equal(portCard, CARD);
    const portAlloc = EVENTS.filter((e) => e[0] === "alloc");
    const portFields = [0x50, 0x54, 0x58, 0x84, 0x88, 0x8c].map((off) => rt.mem.read32(CARD + off) >>> 0);
    assert.deepEqual(normEvents(portAlloc), normEvents(oracleAlloc), "alloc");
    assert.deepEqual(portFields, oracleFields, "fields");
});

test("memcardSaveCardReset matches F0x80083BD8", () => {
    seedCard({ raw: 1, bucket: 3, visible: 0x55 });
    rt.cpu.call(0x80083bd8, [CARD]);
    const oracle = cardFields();

    seedCard({ raw: 1, bucket: 3, visible: 0x55 });
    memcardSaveCardReset(rt.mem, CARD);
    const port = cardFields();
    assert.deepEqual(port, oracle, "reset fields");
});

test("memcardSaveCardTick matches F0x800836C4", () => {
    runCase("state 0 empty widget list", { state: 0, count: 0 });
    runCase("state 0 builds widgets", { state: 0, count: 2 });
    runCase("state 0 keeps existing widgets", { state: 0, count: 2, pre: [1, 1] });
    runCase("state 0 first three only", { state: 0, count: 5, pre: [1, 0, 1, 0, 1] });
    runCase("state 4 opens", { state: 4, count: 1 });
    runCase("state 2 idle", { state: 2 });
    runCase("state 3 idle", { state: 3 });
    runCase("state 1 draws only when visible", { state: 1, visible: 1, records: [3, 4, 2] });
    runCase("state 1 hidden", { state: 1, visible: 0 });
    runCase("state 1 fold opens", { state: 1, substate: 1, step: 0, visible: 1, records: [3, 4, 5] });
    runCase("state 1 fold waits", { state: 1, substate: 1, step: 1, visible: 1, foldTick: 0, records: [3, 4, 5] });
    runCase("state 1 fold lands", { state: 1, substate: 1, step: 1, visible: 1, foldTick: 1, records: [3, 4, 5] });
    runCase("state 1 close starts", { state: 1, substate: 2, step: 0, visible: 1, fillFlag: 1, records: [3, 4, 5] });
    runCase("state 1 close lands", { state: 1, substate: 2, step: 1, visible: 1, foldTick: 1, records: [3, 4, 5] });
    runCase("state 1 fold partial scale", { state: 1, visible: 1, foldValue: 0x800, records: [3, 4, 5] });
    runCase("state 1 fold full scale", { state: 1, visible: 1, foldValue: 0x1000, records: [3, 4, 2] });
    runCase("anim advance", { state: 1, visible: 1, stamp: FRAME - 13, anim0: 0, anim1: 4, anim2: 7, records: [3, 4, 3] });
    runCase("anim stale", { state: 1, visible: 1, stamp: FRAME, anim0: 2, records: [3, 4, 3] });
    runCase("selected slot 2", { state: 1, visible: 1, sel: 2, records: [5, 3, 4] });
    runCase("japanese layout", { state: 1, visible: 1, lang: 0, records: [3, 4, 2] });
});
