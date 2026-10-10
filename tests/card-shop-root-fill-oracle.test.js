// Phase 4 oracle: engine/dw3/ui/card-shop-root-fill.ts must match pro/stcrdshp's
// F0x80087E8C (shop_root_fill_prompt) and F0x80087FAC (shop_root_fill_rows).
// Each original runs through engine/native on the shipped pro_stcrdshp.bin +
// resident.bin with the text-bank getter and every widget method recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopRootFillPrompt, shopRootFillRows } from "../engine/dw3/ui/card-shop-root-fill.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stcrdshp.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80184000;
const WIDGETS = 0x80180000;
const W = (i) => 0x80181000 + i * 0x400;
const BANK_STUB = 0x0fe70000;
const METHOD_STUBS = [[0x114, 0x0fe70100], [0x118, 0x0fe70200], [0x144, 0x0fe70300], [0x148, 0x0fe70400]];
const LANGUAGE = 0x8005cca8;
const BIT = 0x80048da0;

let EVENTS = [];
let BANK_RET = 0x1234;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(BANK_STUB, (c) => { EVENTS.push(["bank", c.reg(4) >>> 0]); return BANK_RET; });
    rt.mem.write32(0x80044f4c, BANK_STUB);
    for (const [method, stub] of METHOD_STUBS) {
        rt.cpu.setStub(stub, (c) => {
            EVENTS.push(["w", method >>> 0, c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
            return 0;
        });
    }
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    BANK_RET = o.bank ?? 0x1234;
    rt.mem.write32(LANGUAGE, o.lang ?? 0);
    rt.mem.write32(BIT, o.bit ?? 0);
    rt.mem.write32(SCREEN + 0x64, o.index ?? 0);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(WIDGETS + i, 0);
    for (let i = 0; i < 8; i++) {
        const w = W(i);
        for (let j = 0; j <= 0x150; j += 4) rt.mem.write32(w + j, 0);
        for (const [method, stub] of METHOD_STUBS) rt.mem.write32(w + method, stub);
    }
    rt.mem.write32(WIDGETS + 0x00, W(0));
    rt.mem.write32(WIDGETS + 0x04, W(1));
    rt.mem.write32(WIDGETS + 0x0c, W(2));
    rt.mem.write32(WIDGETS + 0x10, W(3));
    rt.mem.write32(WIDGETS + 0x14, W(4));
    rt.mem.write32(WIDGETS + 0x18, W(5));
    rt.mem.write32(WIDGETS + 0x1c, W(6));
}

function events() { return EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v >>> 0 : v))); }

function portHost() {
    return {
        bankGet(h) { EVENTS.push(["bank", h >>> 0]); return BANK_RET; },
        callWidgetMethod(obj, method, a1, a2) {
            EVENTS.push(["w", method >>> 0, obj >>> 0, a1 >>> 0, a2 >>> 0]);
            return 0;
        },
    };
}

function run(label, o, which) {
    seed(o);
    if (which === "prompt") rt.cpu.call(0x80087e8c, [SCREEN, WIDGETS, o.show ?? 1]);
    else rt.cpu.call(0x80087fac, [SCREEN, WIDGETS, o.show ?? 1]);
    const oracle = events();
    seed(o);
    if (which === "prompt") shopRootFillPrompt(rt.mem, SCREEN, WIDGETS, o.show ?? 1, portHost());
    else shopRootFillRows(rt.mem, WIDGETS, o.show ?? 1, portHost());
    assert.deepEqual(events(), oracle, `${label}: calls`);
}

test("shopRootFillPrompt matches F0x80087E8C", () => {
    run("show index 0 bit 0", { show: 1, index: 0, bit: 0, lang: 0 }, "prompt");
    run("show index 31 bit max", { show: 1, index: 31, bit: 9999999, lang: 2 }, "prompt");
    run("show index 40", { show: 1, index: 40, bit: 123, lang: 6, bank: 0x77 }, "prompt");
    run("hide", { show: 0, index: 40, bit: 123 }, "prompt");
});

test("shopRootFillRows matches F0x80087FAC", () => {
    run("show rows", { show: 1, lang: 0 }, "rows");
    run("show rows lang 3", { show: 1, lang: 3, bank: 0x55 }, "rows");
    run("hide rows", { show: 0, lang: 0 }, "rows");
});
