// Lane B Phase 4 oracle: engine/dw3/ui/native/cnty-draw.ts must emit exactly the
// same ordered draw intents as the original pro/cnty_sel overlay bodies.
//
// The original functions run through engine/native (the interpreter) as the
// oracle, on the shipped overlay image:
//   F0x80083630  countrySelectDrawLeft
//   F0x80083894  countrySelectDrawRight
//   F0x80083B00  countrySelectDrawBottom
//   F0x80082EF0  countrySelectDrawRow
//
// The draw context itself (F0x8001F648 + its ctx method table) is the shared
// host boundary; the interpreter records it into rt.drawCalls and the port into
// an equivalent recorder. The [0x80044F5C] pack getter is a shared stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    countrySelectDrawBottom,
    countrySelectDrawLeft,
    countrySelectDrawRight,
    countrySelectDrawRow,
} from "../../engine/dw3/ui/native/cnty-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const cnty = new Uint8Array(readFileSync(join(dir, "pro_cnty_sel.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: cnty.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const PACK_STUB = 0x0fd40000;
const PACK_PTR = 0x80190000;

const ARITY = { setLayer: 2, setOrigin: 2, setDepth: 2, setPos: 2, setScale: 3, drawSprite: 4 };

function runtime() {
    const rt = new NativeStageRuntime(cnty, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => (c.reg(4) >>> 0) === 0x08a30000 ? PACK_PTR : 0);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    return rt;
}

const rt = runtime();

function norm(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function fixture(obj, fields) {
    for (let i = 0; i < 0x60; i += 4) rt.mem.write32(obj + i, 0);
    for (const [off, value] of Object.entries(fields)) rt.mem.write16(obj + Number(off), value);
}

function runCase(label, addr, port, cases) {
    for (const fields of cases) {
        fixture(OBJ_A, fields);
        fixture(OBJ_B, fields);
        const before = rt.drawCalls.length;
        rt.cpu.call(addr, [OBJ_A], 2000);
        const oracleIntents = norm(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
        rt.drawCalls.length = before;

        const portIntents = [];
        const portHost = {
            initDrawContext() {},
            setLayer(a, b) { portIntents.push(["setLayer", [a, b]]); },
            setOrigin(a, b) { portIntents.push(["setOrigin", [a, b]]); },
            setDepth(a, b) { portIntents.push(["setDepth", [a, b]]); },
            setPos(a, b) { portIntents.push(["setPos", [a, b]]); },
            setScale(a, b, c) { portIntents.push(["setScale", [a, b, c]]); },
            drawSprite(a, b, c, d) { portIntents.push(["drawSprite", [a, b, c, d]]); },
            packResolve(h) { return (h >>> 0) === 0x08a30000 ? PACK_PTR : 0; },
        };
        port(rt.mem, OBJ_B, portHost);

        assert.deepEqual(norm(portIntents), oracleIntents,
            `${label} fields ${JSON.stringify(fields)} intents`);
        // The draws write no object memory.
        for (let i = 0; i < 0x60; i += 4) {
            assert.equal(rt.mem.read32(OBJ_B + i) >>> 0, rt.mem.read32(OBJ_A + i) >>> 0,
                `${label} fields ${JSON.stringify(fields)} memory +0x${i.toString(16)}`);
        }
    }
}

test("countrySelectDrawLeft matches F0x80083630", () => {
    runCase("left", 0x80083630, countrySelectDrawLeft, [
        { 0x54: 0x1000, 0x56: 0 },
        { 0x54: 0x800, 0x56: 0x500 },
        { 0x54: 0, 0x56: 0 },
        { 0x54: 0x7fff, 0x56: 0x8000 },
        { 0x54: 0xffff, 0x56: 0x1234 },
    ]);
});

test("countrySelectDrawRight matches F0x80083894", () => {
    runCase("right", 0x80083894, countrySelectDrawRight, [
        { 0x54: 0x1000, 0x56: 0x1000 },
        { 0x54: 0x2000, 0x56: 0x400 },
        { 0x54: 0, 0x56: 0xffff },
        { 0x54: 0x7fff, 0x56: 0x7fff },
    ]);
});

test("countrySelectDrawBottom matches F0x80083B00", () => {
    runCase("bottom", 0x80083b00, countrySelectDrawBottom, [
        { 0x54: 0x1000, 0x56: 0x1000 },
        { 0x54: 0x400, 0x56: 0x1000 },
        { 0x54: 0x8000, 0x56: 0 },
        { 0x54: 0xffff, 0x56: 0xffff },
    ]);
});

test("countrySelectDrawRow matches F0x80082EF0", () => {
    runCase("row", 0x80082ef0, countrySelectDrawRow, [
        { 0x50: 0 }, { 0x50: 1 }, { 0x50: 2 }, { 0x50: 3 },
        { 0x50: 63 }, { 0x50: 64 }, { 0x50: 127 }, { 0x50: 128 },
        { 0x50: 191 }, { 0x50: 192 }, { 0x50: 193 }, { 0x50: 0x7fff },
        { 0x50: 0xffff }, { 0x50: 0x8000 }, { 0x50: 0x8001 },
    ]);
});
