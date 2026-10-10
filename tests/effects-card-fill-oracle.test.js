// Phase 4 oracle: engine/dw3/ui/effects-card-fill.ts effectsCardFill
// (F0x80089274) must make the same ordered calls and land on the same record as
// the original. The original runs through engine/native with the service cells
// and every widget method stubbed; the port runs through the same recorders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { effectsCardFill } from "../engine/dw3/ui/effects-card-fill.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const PARTY = 0x80048d34;
const SOURCE = PARTY + 0x784;
const HANDLE = 0x8004949c;
const GEAR = 0x8004949c + 0x3c0;
const BAND = 0x80180000;
const RECORD = BAND + 0x64;
const BLOCK = 0x80181000;
const SCRATCH = 0x80187000;
const SCRATCH_A = 0x80187080;
const WIDGETS = 0x80182000;
const SOURCE_PTR = 0x80190000;
const ITEM_BASE = 0x80191000;
const STUBS = {
    roster: 0x0fd90000,
    handle: 0x0fd90010,
    select: 0x0fd90020,
    preview: 0x0fd90030,
    item: 0x0fd90040,
    resolve: 0x0fd90050,
};
const WIDGET_METHODS = {
    0x800194e8: "setLine0",
    0x800195b0: "setNumber",
    0x8001a1f4: "setC0",
    0x8001a23c: "flag",
    0x8001a25c: "measure",
};
const ARITY = {
    roster: 1, handle: 1, select: 2, preview: 4, item: 1, resolve: 1,
    setLine0: 3, setNumber: 3, setC0: 2, flag: 2, measure: 2,
};

let EVENTS = [];
let SELECT = () => 0;
let ID_TO_RECORD = new Map();

function widgetAddr(k) {
    return (WIDGETS + k * 0x200) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8005cca8, 0x40);
    rt.cpu.setStub(STUBS.roster, (c) => { EVENTS.push(["roster", c.reg(4)]); return 0; });
    rt.mem.write32(0x8004b44c, STUBS.roster);
    rt.cpu.setStub(STUBS.handle, (c) => { EVENTS.push(["handle", c.reg(4)]); return HANDLE; });
    rt.mem.write32(0x8004b484, STUBS.handle);
    rt.cpu.setStub(STUBS.select, (c) => {
        EVENTS.push(["select", c.reg(4), c.reg(5)]);
        return SELECT(c.reg(4) | 0, c.reg(5) | 0);
    });
    rt.mem.write32(0x8008d1d0, STUBS.select);
    rt.cpu.setStub(STUBS.preview, (c) => {
        EVENTS.push(["preview", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        if ((c.reg(5) | 0) >= 0) rt.mem.write16(HANDLE + 0x3c0 + 2 * (c.reg(5) | 0), c.reg(6) & 0xffff);
        return 0;
    });
    rt.mem.write32(0x8008d1d4, STUBS.preview);
    rt.cpu.setStub(STUBS.item, (c) => {
        const id = c.reg(4) | 0;
        EVENTS.push(["item", id]);
        return (ID_TO_RECORD.get(id) ?? 0) >>> 0;
    });
    rt.mem.write32(0x80042b98, STUBS.item);
    rt.cpu.setStub(STUBS.resolve, (c) => { EVENTS.push(["resolve", c.reg(4)]); return SOURCE_PTR; });
    rt.mem.write32(0x80044f4c, STUBS.resolve);
    for (const [addr, name] of Object.entries(WIDGET_METHODS)) {
        rt.cpu.setStub(Number(addr), (c) => {
            EVENTS.push([name, c.reg(4), c.reg(5), c.reg(6)]);
            return 0;
        });
    }
    return rt;
}

const rt = runtime();

function armWidgets() {
    for (let k = 0; k < 20; k++) {
        const w = widgetAddr(k);
        rt.mem.write32(BLOCK + k * 4, w);
        rt.mem.write32(w + 0x114, 0x800194e8);
        rt.mem.write32(w + 0x118, 0x800195b0);
        rt.mem.write32(w + 0x138, 0x8001a1f4);
        rt.mem.write32(w + 0x144, 0x8001a23c);
        rt.mem.write32(w + 0x148, 0x8001a25c);
    }
}

function makeItem(id, klass, stats) {
    const record = ITEM_BASE + id * 0x40;
    const sp = ITEM_BASE + 0x2000 + id * 0x40;
    ID_TO_RECORD.set(id, record);
    rt.mem.write8(record + 0x9, klass & 0xff);
    rt.mem.write32(record + 0x0, sp);
    rt.mem.write16(sp + 0x00, stats.charisma ?? 0);
    rt.mem.write16(sp + 0x06, stats.amount0 ?? 0);
    rt.mem.write16(sp + 0x08, stats.amount1 ?? 0);
    rt.mem.write16(sp + 0x0a, stats.addA ?? 0);
    rt.mem.write8(sp + 0x0a, stats.codeA ?? 0);
    rt.mem.write8(sp + 0x0b, stats.codeB ?? 0);
    rt.mem.write16(sp + 0x0c, stats.addB ?? 0);
    rt.mem.write8(sp + 0x0c, stats.codeC ?? 0);
    rt.mem.write8(sp + 0x0d, stats.codeD ?? 0);
    rt.mem.write8(sp + 0x08, stats.code1 ?? 0);
}

function seed(items, gear, candidateId) {
    EVENTS = [];
    armWidgets();
    for (let i = 0; i < 0x58; i += 2) rt.mem.write16(RECORD + i, 0);
    for (let i = 0; i < 0x2c; i++) rt.mem.write8(SOURCE + i, (0x40 + i) & 0xff);
    for (let i = 0; i < 12; i++) rt.mem.write8(HANDLE + 0x3c0 + i, (0x80 + i) & 0xff);
    for (let i = 0; i < 6; i++) rt.mem.write16(GEAR + 2 * i, (gear[i] ?? 0) & 0xffff);
    rt.mem.write32(BAND + 0x1e4, candidateId >>> 0);
    rt.mem.write32(BAND + 0x58, 0);
    ID_TO_RECORD = new Map();
    for (const it of items) makeItem(it.id, it.klass, it.stats);
}

function norm(evs) {
    return evs.map(([name, ...args]) => [name, ...args.slice(0, ARITY[name]).map((v) => v >>> 0)]);
}

function runCase(label, { items, gear = [0, 0, 0, 0, 0, 0], candidateId = 0x14, select = () => 0 }) {
    SELECT = select;
    const snapshot = () => {
        const out = [];
        for (let i = 0; i < 0x58; i += 4) out.push(rt.mem.read32(RECORD + i) >>> 0);
        out.push(rt.mem.read32(RECORD + 0x58) >>> 0, rt.mem.read32(RECORD + 0x5c) >>> 0,
            rt.mem.read32(RECORD + 0x60) >>> 0, rt.mem.read32(RECORD + 0x64) >>> 0);
        for (let i = 0; i < 12; i++) out.push(rt.mem.read8(HANDLE + 0x3c0 + i));
        return out;
    };

    seed(items, gear, candidateId);
    EVENTS = [];
    rt.cpu.call(0x80089274, [BAND, BLOCK, 0]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleRecord = snapshot();

    seed(items, gear, candidateId);
    EVENTS = [];
    const portHost = {
        rosterSlot(position) { EVENTS.push(["roster", position | 0]); return 0; },
        rosterHandle(slot) { EVENTS.push(["handle", slot | 0]); return HANDLE; },
        selectSlot(slot, itemId) { EVENTS.push(["select", slot, itemId]); return SELECT(slot, itemId); },
        previewEquip(slot, slotIndex, itemId, flag) {
            EVENTS.push(["preview", slot, slotIndex, itemId, flag]);
            if (slotIndex >= 0) rt.mem.write16(HANDLE + 0x3c0 + 2 * slotIndex, itemId & 0xffff);
        },
        itemRecord(id) { EVENTS.push(["item", id | 0]); return (ID_TO_RECORD.get(id | 0) ?? 0) >>> 0; },
        resolveText(offset) { EVENTS.push(["resolve", ((rt.mem.read32(0x8005cca8) & 0xffffffff) + offset) >>> 0]); return SOURCE_PTR; },
        widgetSetLine0(widget, source, index) { EVENTS.push(["setLine0", widget, source, index]); },
        widgetSetLineNumber(widget, line, value) { EVENTS.push(["setNumber", widget, line, value]); },
        widgetSetC0(widget, code) { EVENTS.push(["setC0", widget, code]); },
        widgetSetFlagC1(widget, value) { EVENTS.push(["flag", widget, value]); },
        widgetMeasure(widget, value) { EVENTS.push(["measure", widget, value]); },
    };
    effectsCardFill(rt.mem, BAND, BLOCK, 0, portHost, SCRATCH_A);
    const portEvents = norm(EVENTS.slice());
    const portRecord = snapshot();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portRecord, oracleRecord, `${label}: record`);
}

test("effectsCardFill matches F0x80089274", () => {
    const items = [
        { id: 0x14, klass: 5, stats: { charisma: 5, amount0: 0x111, amount1: 0x122, codeC: 1, codeD: 8, addA: 0x30 } },
        { id: 0x20, klass: 5, stats: { charisma: 3, amount0: 0x50, codeC: 7, addA: 0x10 } },
        { id: 0x21, klass: 20, stats: { charisma: 2, amount0: 0x60, codeA: 2, codeB: 8, addB: 0x20 } },
        { id: 0x22, klass: 5, stats: { charisma: 1, amount0: 0x70, codeC: 0, addA: 0x4 } },
    ];
    // slot 0 (head), item class 5 -> wide default arm
    runCase("slot 0 wide", { items, gear: [0x20, 0, 0, 0, 0, 0], select: () => 0 });
    // slot 2, item class 20 -> narrow default arm
    runCase("slot 2 narrow", { items: [{ id: 0x14, klass: 20, stats: { charisma: 4, amount0: 0x80, codeA: 2, codeB: 8, addB: 0x30 } },
        { id: 0x20, klass: 5, stats: { amount0: 0x10, codeC: 1, addA: 0x8 } }], gear: [0x20, 0, 0, 0, 0, 0], select: () => 2 });
    // slot 1 (body)
    runCase("slot 1 body", { items, gear: [0, 0x20, 0, 0, 0, 0], select: () => 1 });
    // accessory with code 3 -> row1 key 2
    runCase("acc code 3", { items: [{ id: 0x14, klass: 21, stats: { charisma: 5, amount0: 0x111, code1: 3 } },
        { id: 0x20, klass: 5, stats: { amount0: 0x10, codeC: 1, addA: 0x8 } }], gear: [0x20, 0, 0, 0, 0, 0], select: () => 4 });
    // accessory with code 10 -> row1 key 8
    runCase("acc code 10", { items: [{ id: 0x14, klass: 22, stats: { charisma: 5, amount0: 0x111, code1: 10 } },
        { id: 0x20, klass: 5, stats: { amount0: 0x10, codeC: 1, addA: 0x8 } }], gear: [0x20, 0, 0, 0, 0, 0], select: () => 5 });
    // accessory status-ring arm (code 0)
    runCase("acc status ring", { items: [{ id: 0x14, klass: 21, stats: { charisma: 5, amount0: 0x111, code1: 0 } },
        { id: 0x20, klass: 5, stats: { amount0: 0x10, codeC: 1, addA: 0x8 } }], gear: [0x20, 0, 0, 0, 0, 0], select: () => 4 });
    // selector -1 -> default arm, item class 1 (narrow)
    runCase("selector -1", { items: [{ id: 0x14, klass: 1, stats: { charisma: 5 } }], select: () => -1 });
});
