// Phase 4 oracle: engine/dw3/ui/gym-hud.ts must build the same HUD widgets and
// make the same ordered fills as the originals F0x80083AEC, F0x80083D10,
// F0x80084064 and F0x80084270. The originals run through engine/native with the
// text factory, the service cells and every widget method stubbed; the port
// runs through the same recorders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    gymHudConstruct,
    gymHudTextFill,
    gymPartnerSummaryFill,
    gymStatReadoutsFill,
} from "../engine/dw3/ui/gym-hud.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgtrain = new Uint8Array(readFileSync(join(dir, "pro_stgtrain.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgtrain.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80180000;
const HUD = 0x80181000;
const PROJ = 0x80187000;
const PROJ_A = 0x80187080;
const HANDLE = 0x80190000;
const SOURCE = 0x80190100;
const WIDGET_BASE = 0x80182000;
const STUBS = {
    create: 0x0fda0000,
    roster: 0x0fda0010,
    handle: 0x0fda0020,
    copy: 0x0fda0030,
    resolve: 0x0fda0040,
};
const WIDGET_METHODS = {
    0x800194e8: "setLine0",
    0x800195b0: "setNumber",
    0x8001a1f4: "setC0",
    0x8001a23c: "flag",
    0x8001a25c: "measure",
};
const ARITY = { create: 4, roster: 1, handle: 1, copy: 1, resolve: 1, setLine0: 3, setNumber: 3, setC0: 2, flag: 2, measure: 2 };

// A distinct 0x2C-byte projection with every field the fills read.
const PROJECTION = new Uint8Array(0x2c);
PROJECTION[0x00] = 0x07;
PROJECTION[0x02] = 0xc8;
PROJECTION[0x04] = 0x64; PROJECTION[0x05] = 0x00;
PROJECTION[0x06] = 0xc8; PROJECTION[0x07] = 0x00;
PROJECTION[0x08] = 0x19; PROJECTION[0x09] = 0x00;
PROJECTION[0x0a] = 0x32; PROJECTION[0x0b] = 0x00;
for (let i = 0; i < 6; i++) PROJECTION[0x0c + 2 * i] = 10 + i;
for (let j = 0; j < 7; j++) PROJECTION[0x18 + 2 * j] = 20 + j;
PROJECTION[0x26] = 1;
PROJECTION[0x28] = 0;
PROJECTION[0x2a] = 1;

let EVENTS = [];
let CANNED = {};

function widgetAddr(k) {
    return (WIDGET_BASE + k * 0x200) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(stgtrain, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8005cca8, 0x40);
    rt.cpu.setStub(0x8001ae38, (c) => {
        const n = EVENTS.filter((e) => e[0] === "create").length;
        EVENTS.push(["create", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        return widgetAddr(n);
    });
    rt.cpu.setStub(STUBS.roster, (c) => { EVENTS.push(["roster", c.reg(4)]); return 0; });
    rt.mem.write32(0x8004b44c, STUBS.roster);
    rt.cpu.setStub(STUBS.handle, (c) => { EVENTS.push(["handle", c.reg(4)]); return HANDLE; });
    rt.mem.write32(0x8004b484, STUBS.handle);
    rt.cpu.setStub(STUBS.copy, (c) => {
        EVENTS.push(["copy", c.reg(4), c.reg(5)]);
        const dest = c.reg(5) >>> 0;
        for (let i = 0; i < PROJECTION.length; i++) rt.mem.write8(dest + i, PROJECTION[i]);
        return 0;
    });
    rt.mem.write32(0x8004b468, STUBS.copy);
    rt.cpu.setStub(STUBS.resolve, (c) => { EVENTS.push(["resolve", c.reg(4)]); return SOURCE; });
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

function seedHud() {
    for (let k = 0; k < 28; k++) {
        const w = widgetAddr(k);
        rt.mem.write32(HUD + k * 4, w);
        rt.mem.write32(w + 0x114, 0x800194e8);
        rt.mem.write32(w + 0x118, 0x800195b0);
        rt.mem.write32(w + 0x138, 0x8001a1f4);
        rt.mem.write32(w + 0x144, 0x8001a23c);
        rt.mem.write32(w + 0x148, 0x8001a25c);
    }
    for (let k = 0; k < 0x70; k += 4) rt.mem.write32(HUD + k, rt.mem.read32(HUD + k));
}

function norm(evs) {
    return evs.map(([name, ...args]) => [name, ...args.slice(0, ARITY[name]).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        createTextElement(target, kind, x, y) {
            const n = EVENTS.filter((e) => e[0] === "create").length;
            EVENTS.push(["create", target, kind, x, y]);
            return widgetAddr(n);
        },
        resolveText(offset) { EVENTS.push(["resolve", (rt.mem.read32(0x8005cca8) + offset) >>> 0]); return SOURCE; },
        rosterSlot(position) { EVENTS.push(["roster", position | 0]); return 0; },
        rosterHandle(slot) { EVENTS.push(["handle", slot | 0]); return HANDLE; },
        copyProjection(slot, dest) {
            EVENTS.push(["copy", slot | 0, dest]);
            for (let i = 0; i < PROJECTION.length; i++) rt.mem.write8(dest + i, PROJECTION[i]);
        },
        widgetSetLine0(widget, source, index) { EVENTS.push(["setLine0", widget, source, index]); },
        widgetSetLineNumber(widget, line, value) { EVENTS.push(["setNumber", widget, line, value]); },
        widgetSetC0(widget, code) { EVENTS.push(["setC0", widget, code]); },
        widgetSetFlagC1(widget, value) { EVENTS.push(["flag", widget, value]); },
        widgetMeasure(widget, value) { EVENTS.push(["measure", widget, value]); },
    };
}

test("gymHudConstruct matches F0x80083AEC", () => {
    rt.mem.write16(SCREEN + 0x50, 0x1005);
    for (let k = 0; k < 0x70; k += 4) rt.mem.write32(HUD + k, 0);
    EVENTS = [];
    rt.cpu.call(0x80083aec, [SCREEN, HUD]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleHud = [];
    for (let k = 0; k < 0x70; k += 4) oracleHud.push(rt.mem.read32(HUD + k) >>> 0);

    for (let k = 0; k < 0x70; k += 4) rt.mem.write32(HUD + k, 0);
    EVENTS = [];
    gymHudConstruct(rt.mem, SCREEN, HUD, portHost());
    const portEvents = norm(EVENTS.slice());
    const portHud = [];
    for (let k = 0; k < 0x70; k += 4) portHud.push(rt.mem.read32(HUD + k) >>> 0);

    assert.deepEqual(portEvents, oracleEvents, "constructor calls");
    assert.deepEqual(portHud, oracleHud, "hud pointers");
});

function runFill(label, portFn, addr, show) {
    seedHud();
    rt.mem.write32(SCREEN + 0x68, 0);
    EVENTS = [];
    rt.cpu.call(addr, [SCREEN, HUD, show]);
    const oracleEvents = norm(EVENTS.slice());

    seedHud();
    rt.mem.write32(SCREEN + 0x68, 0);
    EVENTS = [];
    portFn(rt.mem, SCREEN, HUD, show, portHost(), PROJ_A);
    const portEvents = norm(EVENTS.slice());
    assert.deepEqual(portEvents, oracleEvents, label);
}

test("gymHudTextFill matches F0x80083D10", () => {
    runFill("show", gymHudTextFill, 0x80083d10, 1);
    runFill("hide", gymHudTextFill, 0x80083d10, 0);
});

test("gymStatReadoutsFill matches F0x80084064", () => {
    runFill("show", gymStatReadoutsFill, 0x80084064, 1);
    runFill("hide", gymStatReadoutsFill, 0x80084064, 0);
});

test("gymPartnerSummaryFill matches F0x80084270", () => {
    runFill("show", gymPartnerSummaryFill, 0x80084270, 1);
    runFill("hide", gymPartnerSummaryFill, 0x80084270, 0);
});
