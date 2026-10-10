// Phase 4 oracle: engine/dw3/ui/pause-items-text.ts must make the same ordered
// widget/boundary calls as the originals F0x8008EF48 and F0x8008F000. The
// originals run through engine/native with every widget method slot and the text
// resolver stubbed; the port runs through the same recorders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    pauseItemsBitBoxFill,
    pauseItemsFooterLabelsFill,
} from "../engine/dw3/ui/pause-items-text.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const ststatus = new Uint8Array(readFileSync(join(dir, "pro_ststatus.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: ststatus.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const BLOCK = 0x80180000;
const HOLDER = 0x80190000;
const RESOLVE_STUB = 0x0fd70000;
const SOURCE = 0x80190100;
const BASE = 0x2a;
const LANG = 0x40;
const WIDGET_METHODS = {
    0x800194e8: "setLine0",
    0x800195b0: "setNumber",
    0x8001a23c: "flag",
    0x8001a25c: "measure",
};
const ARITY = { resolve: 1, setLine0: 3, setNumber: 3, flag: 2, measure: 2 };

let EVENTS = [];

function widgetAddr(k) {
    return (0x80182000 + k * 0x200) >>> 0;
}

function runtime() {
    const rt = new NativeStageRuntime(ststatus, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(0x8005cca8, LANG);
    rt.cpu.setStub(RESOLVE_STUB, (c) => { EVENTS.push(["resolve", c.reg(4)]); return SOURCE; });
    rt.mem.write32(0x80044f4c, RESOLVE_STUB);
    for (const [addr, name] of Object.entries(WIDGET_METHODS)) {
        rt.cpu.setStub(Number(addr), (c) => {
            EVENTS.push([name, c.reg(4), c.reg(5), c.reg(6)]);
            return 0;
        });
    }
    rt.mem.write32(0x80048da0, 9);
    rt.mem.write32(0x8009af6c, HOLDER);
    rt.mem.write32(HOLDER + 0xb4, BASE);
    return rt;
}

const rt = runtime();

function seed() {
    for (let i = 0; i < 0xb8; i += 4) rt.mem.write32(BLOCK + i, 0);
    for (let k = 0; k < 46; k++) {
        const widget = widgetAddr(k);
        rt.mem.write32(BLOCK + k * 4, widget);
        rt.mem.write32(widget + 0x114, 0x800194e8);
        rt.mem.write32(widget + 0x118, 0x800195b0);
        rt.mem.write32(widget + 0x144, 0x8001a23c);
        rt.mem.write32(widget + 0x148, 0x8001a25c);
    }
}

function norm(evs) {
    return evs.map(([name, ...args]) => [name, ...args.slice(0, ARITY[name]).map((v) => v >>> 0)]);
}

function runCase(label, fn, addr, flag) {
    seed();
    EVENTS = [];
    rt.cpu.call(addr, [0, BLOCK, flag]);
    const oracle = norm(EVENTS.slice());

    seed();
    EVENTS = [];
    const portHost = {
        resolveText(offset) { EVENTS.push(["resolve", (rt.mem.read32(0x8005cca8) + offset) >>> 0]); return SOURCE; },
        widgetSetLine0(widget, source, index) { EVENTS.push(["setLine0", widget, source, index]); },
        widgetSetLineNumber(widget, line, value) { EVENTS.push(["setNumber", widget, line, value]); },
        widgetSetFlagC1(widget, value) { EVENTS.push(["flag", widget, value]); },
        widgetMeasure(widget, value) { EVENTS.push(["measure", widget, value]); },
    };
    fn(rt.mem, BLOCK, flag, portHost);
    const port = norm(EVENTS.slice());
    assert.deepEqual(port, oracle, label);
}

test("pauseItemsBitBoxFill matches F0x8008EF48", () => {
    runCase("fill", pauseItemsBitBoxFill, 0x8008ef48, 1);
    runCase("clear", pauseItemsBitBoxFill, 0x8008ef48, 0);
});

test("pauseItemsFooterLabelsFill matches F0x8008F000", () => {
    runCase("fill", pauseItemsFooterLabelsFill, 0x8008f000, 1);
    runCase("clear", pauseItemsFooterLabelsFill, 0x8008f000, 0);
});
