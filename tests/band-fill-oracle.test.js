// Phase 4 oracle: engine/dw3/ui/band-fill.ts must make exactly the same ordered
// widget-method and boundary calls as the originals F0x80089E2C, F0x8008A0D0 and
// F0x8008A1FC. The originals run through engine/native with every widget method
// slot and every resident boundary stubbed; the port runs through the same
// recorders. The band/block bytes are compared too (the fills write neither).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    bandFillDescription,
    bandFillEffectsCards,
    bandFillNamePrice,
} from "../engine/dw3/ui/band-fill.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const BAND = 0x80180000;
const BLOCK = 0x80181000;
const RECORD = 0x80190000;
const DESC = 0x80190100;
const HANDLE = 0x80190200;
const SOURCE = 0x80190300;
const STUBS = {
    resolve: 0x0fd60000,
    item: 0x0fd60010,
    roster: 0x0fd60020,
    handle: 0x0fd60030,
    canEquip: 0x0fd60040,
    call89274: 0x0fd60050,
};
const WIDGET_METHODS = {
    0x800194e8: "setLine0",
    0x800195b0: "setNumber",
    0x8001a1f4: "setC0",
    0x8001a23c: "flag",
    0x8001a25c: "measure",
};
const LANG = 0x100;

let EVENTS = [];

function widgetAddr(k) {
    return (0x80182000 + k * 0x200) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8005cca8, LANG);
    rt.cpu.setStub(STUBS.resolve, (c) => { EVENTS.push(["resolve", c.reg(4)]); return SOURCE; });
    rt.mem.write32(0x80044f4c, STUBS.resolve);
    rt.cpu.setStub(STUBS.item, (c) => { EVENTS.push(["item", c.reg(4)]); return RECORD; });
    rt.mem.write32(0x80042b98, STUBS.item);
    rt.cpu.setStub(STUBS.roster, (c) => { EVENTS.push(["roster", c.reg(4)]); return c.reg(4) & 0x7; });
    rt.mem.write32(0x8004b44c, STUBS.roster);
    rt.cpu.setStub(STUBS.handle, (c) => { EVENTS.push(["handle", c.reg(4)]); return HANDLE; });
    rt.mem.write32(0x8004b484, STUBS.handle);
    rt.cpu.setStub(STUBS.canEquip, (c) => {
        EVENTS.push(["canEquip", c.reg(4), c.reg(5)]);
        return CAN_EQUIP(c.reg(4) | 0);
    });
    rt.mem.write32(0x8008d1cc, STUBS.canEquip);
    rt.cpu.setStub(0x80089274, (c) => { EVENTS.push(["89274", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    for (const [addr, name] of Object.entries(WIDGET_METHODS)) {
        rt.cpu.setStub(Number(addr), (c) => {
            EVENTS.push([name, c.reg(4), c.reg(5), c.reg(6)]);
            return 0;
        });
    }
    return rt;
}

let CAN_EQUIP = () => 1;

const rt = runtime();

function seed(o) {
    for (let i = 0; i < 0xb0; i += 4) rt.mem.write32(BAND + i, 0);
    rt.mem.write32(BAND + 0x58, o.mode ?? 0);
    rt.mem.write32(BAND + 0x60, o.members ?? 0);
    rt.mem.write32(BAND + 0x1e4, o.itemId ?? 0x14);
    rt.mem.write32(BAND + 0x1e8, o.quantity ?? 2);
    // Distinct, method-armed widget per block slot so the recorded receiver names the slot.
    for (let k = 0; k < 44; k++) {
        const widget = widgetAddr(k);
        rt.mem.write32(BLOCK + k * 4, widget);
        rt.mem.write32(widget + 0x114, 0x800194e8);
        rt.mem.write32(widget + 0x118, 0x800195b0);
        rt.mem.write32(widget + 0x138, 0x8001a1f4);
        rt.mem.write32(widget + 0x144, 0x8001a23c);
        rt.mem.write32(widget + 0x148, 0x8001a25c);
    }
    // Party bytes.
    const base = 0x80048d34 + (o.itemId ?? 0x14);
    rt.mem.write8(base + 0x20f, (o.equipByte ?? 3) & 0xff);
    rt.mem.write8(base + 0x7c, (o.itemsByte ?? 0xfe) & 0xff);
    // Item record and descriptor.
    rt.mem.write32(RECORD + 0x0, DESC);
    rt.mem.write16(RECORD + 0x4, o.buyPrice ?? 120);
    rt.mem.write16(RECORD + 0x6, o.sellPrice ?? 60);
    rt.mem.write8(RECORD + 0x9, o.klass ?? 0);
    rt.mem.write8(DESC + 0x2, o.descIndex ?? 1);
}

const ARITY = {
    resolve: 1, item: 1, roster: 1, handle: 1, canEquip: 2, "89274": 3,
    setLine0: 3, setNumber: 3, setC0: 2, flag: 2, measure: 2,
};
function norm(evs) {
    return evs.map(([name, ...args]) => [name, ...args.slice(0, ARITY[name]).map((v) => v >>> 0)]);
}

function runCase(label, fn, addr, o, canEquip) {
    CAN_EQUIP = canEquip ?? (() => 1);
    seed(o);
    EVENTS = [];
    rt.cpu.call(addr, [BAND, BLOCK, o.flag]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleBlock = [];
    for (let i = 0; i < 0xb0; i += 4) oracleBlock.push(rt.mem.read32(BLOCK + i) >>> 0);

    seed(o);
    EVENTS = [];
    const portHost = {
        resolveText(offset) {
            EVENTS.push(["resolve", (rt.mem.read32(0x8005cca8) + offset) >>> 0]);
            return SOURCE;
        },
        itemRecord(itemId) { EVENTS.push(["item", itemId | 0]); return RECORD; },
        rosterSlot(position) { EVENTS.push(["roster", position | 0]); return position & 0x7; },
        rosterHandle(slot) { EVENTS.push(["handle", slot | 0]); return HANDLE; },
        canEquip(slot, itemId) { EVENTS.push(["canEquip", slot | 0, itemId | 0]); return CAN_EQUIP(slot); },
        call89274(band, block, index) { EVENTS.push(["89274", band, block, index]); },
        widgetSetLine0(widget, source, index) { EVENTS.push(["setLine0", widget, source, index]); },
        widgetSetLineNumber(widget, line, value) { EVENTS.push(["setNumber", widget, line, value]); },
        widgetSetC0(widget, value) { EVENTS.push(["setC0", widget, value]); },
        widgetSetFlagC1(widget, value) { EVENTS.push(["flag", widget, value]); },
        widgetMeasure(widget, value) { EVENTS.push(["measure", widget, value]); },
    };
    fn(rt.mem, BAND, BLOCK, o.flag, portHost);
    const portEvents = norm(EVENTS.slice());
    const portBlock = [];
    for (let i = 0; i < 0xb0; i += 4) portBlock.push(rt.mem.read32(BLOCK + i) >>> 0);

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portBlock, oracleBlock, `${label}: block unchanged`);
}

test("bandFillNamePrice matches F0x80089E2C", () => {
    runCase("fill buy", bandFillNamePrice, 0x80089e2c, { flag: 1, mode: 0, itemId: 0x14, quantity: 3 });
    runCase("fill sell", bandFillNamePrice, 0x80089e2c, { flag: 1, mode: 1, itemId: 0x14, quantity: 3 });
    runCase("fill negative bytes", bandFillNamePrice, 0x80089e2c, {
        flag: 1, mode: 0, itemId: 0x14, quantity: 1, equipByte: 0x80, itemsByte: 0xff,
    });
    runCase("clear", bandFillNamePrice, 0x80089e2c, { flag: 0 });
});

test("bandFillDescription matches F0x8008A0D0", () => {
    runCase("fill class in range", bandFillDescription, 0x8008a0d0, { flag: 1, itemId: 0x14, klass: 4, descIndex: 5 });
    runCase("fill class low", bandFillDescription, 0x8008a0d0, { flag: 1, itemId: 0x14, klass: 1 });
    runCase("fill class high", bandFillDescription, 0x8008a0d0, { flag: 1, itemId: 0x14, klass: 0x0e });
    runCase("fill class max", bandFillDescription, 0x8008a0d0, { flag: 1, itemId: 0x14, klass: 0xff });
    runCase("clear", bandFillDescription, 0x8008a0d0, { flag: 0 });
});

test("bandFillEffectsCards matches F0x8008A1FC", () => {
    runCase("fill none", bandFillEffectsCards, 0x8008a1fc, { flag: 1, members: 0 });
    runCase("fill one eligible", bandFillEffectsCards, 0x8008a1fc, { flag: 1, members: 1, itemId: 0x14 }, () => 1);
    runCase("fill one not eligible", bandFillEffectsCards, 0x8008a1fc, { flag: 1, members: 1, itemId: 0x14 }, () => 0);
    runCase("fill three mixed", bandFillEffectsCards, 0x8008a1fc, { flag: 1, members: 3, itemId: 0x14 },
        (slot) => (slot === 1 ? 1 : 0));
    runCase("clear two", bandFillEffectsCards, 0x8008a1fc, { flag: 0, members: 2 });
});
