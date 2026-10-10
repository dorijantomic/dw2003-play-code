// Phase 4 oracle: engine/dw3/ui/wizard-headers.ts must match pro/stplnmet
// F0x80087B14 (build) and F0x80087BF4 (select). The original runs through
// engine/native with the text-element factory, the resource base and the
// widget method slots stubbed; the port uses an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { wizardHeaderBuild, wizardHeaderSelect } from "../engine/dw3/ui/wizard-headers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stplnmet = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stplnmet.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80180000;
const BLOCK = 0x80181000;
const WIDGET_BASE = 0x80182000;
const SOURCE = 0x80190000;
const CREATE_STUB = 0x0fe50000;
const LINE0_STUB = 0x0fe50010;
const SET138_STUB = 0x0fe50020;
const CLEAR_STUB = 0x0fe50030;
const RESOURCE_STUB = 0x0fe50040;

let EVENTS = [];
let WIDGET_NEXT = 0;

function runtime() {
    const rt = new NativeStageRuntime(stplnmet, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(CREATE_STUB, (c) => {
        EVENTS.push(["create", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        const w = (WIDGET_BASE + (WIDGET_NEXT++ % 8) * 0x100) >>> 0;
        rt.mem.write32(w + 0x114, LINE0_STUB);
        rt.mem.write32(w + 0x138, SET138_STUB);
        rt.mem.write32(w + 0x144, CLEAR_STUB);
        return w;
    });
    rt.cpu.setStub(0x8001ae38, (c) => {
        EVENTS.push(["create", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        const w = (WIDGET_BASE + (WIDGET_NEXT++ % 8) * 0x100) >>> 0;
        rt.mem.write32(w + 0x114, LINE0_STUB);
        rt.mem.write32(w + 0x138, SET138_STUB);
        rt.mem.write32(w + 0x144, CLEAR_STUB);
        return w;
    });
    rt.cpu.setStub(LINE0_STUB, (c) => { EVENTS.push(["line0", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(SET138_STUB, (c) => { EVENTS.push(["set138", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(CLEAR_STUB, (c) => { EVENTS.push(["clear", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(RESOURCE_STUB, (c) => { EVENTS.push(["resource", c.reg(4)]); return SOURCE; });
    rt.mem.write32(0x80044f4c, RESOURCE_STUB);
    return rt;
}

const rt = runtime();

function seed(o) {
    EVENTS = [];
    WIDGET_NEXT = 0;
    rt.mem.write32(0x8005cca8, o.lang ?? 0x40);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(SCREEN + i, 0);
    rt.mem.write32(SCREEN + 0x50, (o.target ?? 0x1001) & 0xffff);
    rt.mem.write32(SCREEN + 0x58, o.selector ?? 0);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(BLOCK + i, 0);
    for (let i = 0; i < 8; i++) rt.mem.write32(WIDGET_BASE + i * 0x100 + 0x114, LINE0_STUB);
    for (let i = 0; i < 8; i++) rt.mem.write32(WIDGET_BASE + i * 0x100 + 0x138, SET138_STUB);
    for (let i = 0; i < 8; i++) rt.mem.write32(WIDGET_BASE + i * 0x100 + 0x144, CLEAR_STUB);
    const widgets = o.widgets ?? [];
    for (let i = 0; i < widgets.length; i++) rt.mem.write32(BLOCK + 0x1c + i * 4, widgets[i]);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        createTextElement(target, kind, x, y) {
            EVENTS.push(["create", target, kind, x, y]);
            const w = (WIDGET_BASE + (WIDGET_NEXT++ % 8) * 0x100) >>> 0;
            rt.mem.write32(w + 0x114, LINE0_STUB);
            rt.mem.write32(w + 0x138, SET138_STUB);
            rt.mem.write32(w + 0x144, CLEAR_STUB);
            return w;
        },
        resourceGetBase(id) { EVENTS.push(["resource", id >>> 0]); return SOURCE; },
        widgetSetLine0(w, source, index) { EVENTS.push(["line0", w >>> 0, source >>> 0, index]); },
        widgetSet138(w, value) { EVENTS.push(["set138", w >>> 0, value]); },
        widgetClear(w, value) { EVENTS.push(["clear", w >>> 0, value]); },
    };
}

test("wizardHeaderBuild matches F0x80087B14", () => {
    for (const o of [{ target: 0x1001, lang: 0x40 }, { target: 0x123, lang: 0 }]) {
        seed(o);
        rt.cpu.call(0x80087b14, [SCREEN, BLOCK]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleSlots = [0, 1, 2].map((i) => rt.mem.read32(BLOCK + 0x1c + i * 4) >>> 0);

        seed(o);
        wizardHeaderBuild(rt.mem, SCREEN, BLOCK, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `build ${JSON.stringify(o)}: calls`);
        assert.deepEqual([0, 1, 2].map((i) => rt.mem.read32(BLOCK + 0x1c + i * 4) >>> 0), oracleSlots, "slots");
    }
});

test("wizardHeaderSelect matches F0x80087BF4", () => {
    const widgets = [WIDGET_BASE, WIDGET_BASE + 0x100, WIDGET_BASE + 0x200];
    for (const o of [
        { selector: 0, arg: 1 },
        { selector: 1, arg: 0 },
        { selector: 2, arg: 1 },
        { selector: 5, arg: 1 },
    ]) {
        seed({ ...o, widgets });
        rt.cpu.call(0x80087bf4, [SCREEN, BLOCK, o.arg]);
        const oracleEvents = norm(EVENTS.slice());

        seed({ ...o, widgets });
        wizardHeaderSelect(rt.mem, SCREEN, BLOCK, o.arg, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `select ${JSON.stringify(o)}`);
    }
});
