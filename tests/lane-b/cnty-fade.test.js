// Lane B Phase 4 oracle: engine/dw3/ui/native/cnty-fade.ts must match the
// original pro/cnty_sel fade object F0x80083184 and its curve F0x80082FC4.
//
// The original runs through engine/native (the interpreter) as the oracle:
//   F0x80083184  the per-state handler (calls the row draw F0x80082EF0)
//   F0x80082FC4  the fade curve
// The row draw's intents are recorded by rt.drawCalls; the F0x80083000 prim and
// the +0x28/+0x38 base methods are stubbed and compared in order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    countrySelectFadeCurve,
    countrySelectFadeTick,
} from "../../engine/dw3/ui/native/cnty-fade.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const cnty = new Uint8Array(readFileSync(join(dir, "pro_cnty_sel.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: cnty.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const PACK_STUB = 0x0fd40000;
const PACK_PTR = 0x80190000;
const M28 = 0x0fd60028;
const M38 = 0x0fd60038;
const PRIM = 0x80083000;

const ARITY = { setLayer: 2, setOrigin: 2, setDepth: 2, setPos: 2, setScale: 3, drawSprite: 4 };

const oracleCalls = [];
const oraclePrims = [];

function runtime() {
    const rt = new NativeStageRuntime(cnty, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => (c.reg(4) >>> 0) === 0x08a30000 ? PACK_PTR : 0);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(M28, (c) => {
        oracleCalls.push(["m28", (c.reg(4) >>> 0) - OBJ_A, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(M38, (c) => {
        oracleCalls.push(["m38", (c.reg(4) >>> 0) - OBJ_A]);
        return 0;
    });
    rt.cpu.setStub(PRIM, (c) => {
        oraclePrims.push(c.reg(4) | 0);
        return 0;
    });
    return rt;
}

const rt = runtime();

function norm(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function initObj(obj, f) {
    for (let i = 0; i < 0x60; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write16(obj + 0x50, f.phase ?? 0);
    rt.mem.write16(obj + 0x52, f.progress ?? 0);
    rt.mem.write32(obj + 0x0c, f.state ?? 0);
    rt.mem.write32(obj + 0x10, f.gate ?? 0);
    rt.mem.write32(obj + 0x28, M28);
    rt.mem.write32(obj + 0x38, M38);
}

function fields(obj) {
    return [
        rt.mem.read32(obj + 0x0c) | 0,
        rt.mem.read32(obj + 0x10) | 0,
        rt.mem.read16(obj + 0x50),
        rt.mem.read16(obj + 0x52),
    ];
}

function portHost(portCalls, portPrims, portIntents) {
    return {
        initDrawContext() {},
        setLayer(a, b) { portIntents.push(["setLayer", [a, b]]); },
        setOrigin(a, b) { portIntents.push(["setOrigin", [a, b]]); },
        setDepth(a, b) { portIntents.push(["setDepth", [a, b]]); },
        setPos(a, b) { portIntents.push(["setPos", [a, b]]); },
        setScale(a, b, c) { portIntents.push(["setScale", [a, b, c]]); },
        drawSprite(a, b, c, d) { portIntents.push(["drawSprite", [a, b, c, d]]); },
        packResolve(h) { return (h >>> 0) === 0x08a30000 ? PACK_PTR : 0; },
        emitFadePrim(a) { portPrims.push(a | 0); },
        baseMethod28(o, v) { portCalls.push(["m28", (o >>> 0) - OBJ_B, v | 0]); },
        baseMethod38(o) { portCalls.push(["m38", (o >>> 0) - OBJ_B]); },
    };
}

// Compare one or more consecutive original ticks against the port. `frames`
// advances the interpreter by one call each; the port gets the same fields.
function compare(label, f, frames = 1) {
    initObj(OBJ_A, f);
    initObj(OBJ_B, f);
    for (let n = 0; n < frames; n++) {
        oracleCalls.length = 0;
        oraclePrims.length = 0;
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80083184, [OBJ_A], 5000);
        const oracleIntents = norm(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
        rt.drawCalls.length = before;

        const portCalls = [];
        const portPrims = [];
        const portIntents = [];
        countrySelectFadeTick(rt.mem, OBJ_B, portHost(portCalls, portPrims, portIntents));

        assert.deepEqual(portCalls, oracleCalls, `${label} frame ${n}: base calls`);
        assert.deepEqual(portPrims, oraclePrims, `${label} frame ${n}: prim alpha`);
        assert.deepEqual(norm(portIntents), oracleIntents, `${label} frame ${n}: row intents`);
        assert.deepEqual(fields(OBJ_A), fields(OBJ_B), `${label} frame ${n}: fields`);
    }
}

test("countrySelectFadeCurve matches F0x80082FC4", () => {
    for (const v of [-100, -1, 0, 1, 2, 14, 15, 29, 30, 31, 32, 255, 1000, 0x7fff, 0x8000, 0xffff]) {
        assert.equal(countrySelectFadeCurve(v) | 0, rt.cpu.call(0x80082fc4, [v]) | 0, `value ${v}`);
    }
});

test("countrySelectFadeTick matches F0x80083184 for every state", () => {
    for (const state of [-1, 0, 3, 4, 7]) {
        for (const phase of [0, 191, 0xffff]) {
            compare(`state ${state}`, { state, gate: 1, phase, progress: 5 });
        }
    }
});

test("countrySelectFadeTick animates the phase and row (state 1)", () => {
    for (const phase of [0, 1, 95, 96, 190, 191, 192, 255, 0x7fff, 0xffff]) {
        compare("state 1", { state: 1, gate: 1, phase });
    }
});

test("countrySelectFadeTick runs the fade curve and completion (state 2)", () => {
    // gate already set: no reset this tick.
    for (const progress of [0, 1, 28, 29, 30, 31, 0xffff, 0x8000]) {
        compare("state 2 gated", { state: 2, gate: 1, phase: 0, progress });
    }
    // gate clear: resets progress and gate, then advances.
    compare("state 2 fresh", { state: 2, gate: 0, phase: 0, progress: 123 });
    // A full 40-tick fade from the start exercises 0..29 and the >= 30 arm.
    compare("state 2 long", { state: 2, gate: 0, phase: 0, progress: 0 }, 40);
});
