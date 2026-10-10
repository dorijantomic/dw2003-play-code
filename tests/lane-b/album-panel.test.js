// Lane B Phase 4 oracle: engine/dw3/ui/native/album-panel.ts must match the
// original pro/stcrdabm album-panel bodies.
//
//   F0x80083BFC  albumPanelCreateLabels
//   F0x80083E14  albumPanelFillHeadings
//
// The original runs through engine/native (the interpreter) as the oracle. The
// createTextElement boundary (F0x8001AE38), the widget methods +0x114/+0x118/
// +0x144/+0x148/+0x15C and the [0x80044F4C] resource getter are stubs on both
// sides, so the ordered call sequences can be compared directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    albumPanelCreateLabels,
    albumPanelFillHeadings,
} from "../../engine/dw3/ui/native/album-panel.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const album = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: album.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const PANEL_A = 0x80150000;
const PANEL_B = 0x80150200;
const SLOTS_A = 0x80170000;
const SLOTS_B = 0x80170100;
const WIDGET = (i) => 0x80160000 + i * 0x100;

const CREATE = 0x8001ae38;
const U15C = 0x0fd71000;
const U114 = 0x0fd72000;
const U118 = 0x0fd72004;
const U144 = 0x0fd72008;
const U148 = 0x0fd7200c;
const RES_GET = 0x0fd73000;
const RES = 0x80190000;

const CREATE_CALLS = [];
const METHOD_CALLS = [];
let made = 0;

function runtime() {
    const rt = new NativeStageRuntime(album, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(CREATE, (c) => {
        CREATE_CALLS.push([c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = WIDGET(made++);
        rt.mem.write32(widget + 0x15c, U15C);
        return widget;
    });
    rt.cpu.setStub(U15C, (c) => { METHOD_CALLS.push(["u15c", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(U114, (c) => { METHOD_CALLS.push(["u114", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(U118, (c) => { METHOD_CALLS.push(["u118", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(U144, (c) => { METHOD_CALLS.push(["u144", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(U148, (c) => { METHOD_CALLS.push(["u148", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(RES_GET, (c) => { METHOD_CALLS.push(["res", c.reg(4) | 0]); return RES; });
    rt.mem.write32(0x80044f4c, RES_GET);
    return rt;
}

function portHost() {
    return {
        createTextElement(target, kind, x, y) {
            CREATE_CALLS.push([target | 0, kind | 0, x | 0, y | 0]);
            return WIDGET(made++);
        },
        setWidgetUnk15C(widget, value) { METHOD_CALLS.push(["u15c", widget | 0, value | 0]); },
        setWidgetLine0(widget, source, index) { METHOD_CALLS.push(["u114", widget | 0, source | 0, index | 0]); },
        setWidgetLineNumber(widget, lineIndex, value) { METHOD_CALLS.push(["u118", widget | 0, lineIndex | 0, value | 0]); },
        setWidgetFlag144(widget, value) { METHOD_CALLS.push(["u144", widget | 0, value | 0]); },
        setWidgetFlag148(widget, value) { METHOD_CALLS.push(["u148", widget | 0, value | 0]); },
        resourceGet(id) { METHOD_CALLS.push(["res", id | 0]); return RES; },
    };
}

test("albumPanelCreateLabels matches F0x80083BFC", () => {
    const rt = runtime();
    // The panel's own slot list (arg0+0x24) with per-slot +0x15C methods.
    const slotWidgets = [];
    for (let i = 0; i < 30; i++) {
        const w = WIDGET(100 + i);
        rt.mem.write32(w + 0x15c, U15C);
        slotWidgets.push(w);
    }
    const slotList = 0x80175000;
    for (let i = 0; i < slotWidgets.length; i++) rt.mem.write32(slotList + i * 4, slotWidgets[i]);

    for (const count of [0, 1, 2, 3, 27]) {
        for (const panel of [PANEL_A, PANEL_B]) {
            for (let i = 0; i < 0x60; i += 4) rt.mem.write32(panel + i, 0);
            rt.mem.write32(panel + 0x50, 0x1005);
            rt.mem.write32(panel + 0x54, 0x1000);
            rt.mem.write32(panel + 0x20, count);
            rt.mem.write32(panel + 0x24, slotList);
            for (let i = 0; i < 0x80; i += 4) {
                rt.mem.write32(SLOTS_A + i, 0xdead);
                rt.mem.write32(SLOTS_B + i, 0xdead);
            }
        }

        CREATE_CALLS.length = 0;
        METHOD_CALLS.length = 0;
        made = 0;
        rt.cpu.call(0x80083bfc, [PANEL_A, SLOTS_A], 20000);
        const oracleCreate = CREATE_CALLS.slice();
        const oracleMethods = METHOD_CALLS.slice();

        CREATE_CALLS.length = 0;
        METHOD_CALLS.length = 0;
        made = 0;
        albumPanelCreateLabels(rt.mem, PANEL_B, SLOTS_B, portHost());
        assert.deepEqual(CREATE_CALLS, oracleCreate, `count ${count}: createTextElement calls`);
        assert.deepEqual(METHOD_CALLS, oracleMethods, `count ${count}: +0x15C calls`);
        for (let i = 0; i < 0x44; i += 4) {
            assert.equal(rt.mem.read32(SLOTS_B + i) >>> 0, rt.mem.read32(SLOTS_A + i) >>> 0,
                `count ${count}: slots +0x${i.toString(16)}`);
        }
    }
});

test("albumPanelFillHeadings matches F0x80083E14", () => {
    const rt = runtime();
    const widgetBase = 0x80176000;
    for (let i = 0; i < 7; i++) {
        const w = WIDGET(i);
        rt.mem.write32(w + 0x114, U114);
        rt.mem.write32(w + 0x118, U118);
        rt.mem.write32(w + 0x144, U144);
        rt.mem.write32(w + 0x148, U148);
        rt.mem.write32(widgetBase + i * 4, w);
    }
    for (let i = 0; i < 0x60; i += 4) {
        rt.mem.write32(PANEL_A + i, 0);
        rt.mem.write32(PANEL_B + i, 0);
    }

    const combos = [
        { show: 0, heading: 0, pages: 0, extra: 0 },
        { show: 1, heading: 0, pages: 5, extra: 0 },
        { show: 1, heading: 0, pages: 5, extra: 1 },
        { show: 1, heading: 1, pages: 5, extra: 1 },
        { show: 1, heading: 4, pages: 5, extra: 1 },
        { show: 1, heading: 5, pages: 5, extra: 1 },
        { show: 2, heading: 2, pages: 3, extra: 1 },
    ];
    for (const c of combos) {
        rt.mem.write32(PANEL_A + 0x60, c.heading);
        rt.mem.write32(PANEL_A + 0x64, c.pages);
        rt.mem.write32(PANEL_A + 0x68, c.extra);
        rt.mem.write32(PANEL_B + 0x60, c.heading);
        rt.mem.write32(PANEL_B + 0x64, c.pages);
        rt.mem.write32(PANEL_B + 0x68, c.extra);

        METHOD_CALLS.length = 0;
        rt.cpu.call(0x80083e14, [PANEL_A, widgetBase, c.show], 20000);
        const oracle = METHOD_CALLS.slice();

        METHOD_CALLS.length = 0;
        albumPanelFillHeadings(rt.mem, PANEL_B, widgetBase, c.show, portHost());
        assert.deepEqual(METHOD_CALLS, oracle, `show ${c.show} heading ${c.heading} pages ${c.pages} extra ${c.extra}`);
    }
});
