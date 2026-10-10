// Lane B Phase 4 oracle: engine/dw3/ui/native/folder-screen.ts must match the
// original pro/stcrddek folder screen object.
//
//   F0x8008A0B8  folderScreenCreate
//   F0x80088E74  folderDrawChrome
//
// The original runs through engine/native (the interpreter) as the oracle. The
// draw context is recorded into rt.drawCalls; the [0x80044F5C] pack getter and
// the shared time cell [0x8004DF98] are stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    folderDrawChrome,
    folderScreenCreate,
} from "../../engine/dw3/ui/native/folder-screen.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const folder = new Uint8Array(readFileSync(join(dir, "pro_stcrddek.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: folder.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const PACK_STUB = 0x0fd40000;
const TIME_STUB = 0x0fd40004;
const PACK_PTR = 0x80190000;
const ARITY = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };

let TIME = 0;

function runtime() {
    const rt = new NativeStageRuntime(folder, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => (c.reg(4) >>> 0) === 0x063e0000 ? PACK_PTR : 0);
    rt.cpu.setStub(TIME_STUB, () => TIME);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x8004df98, TIME_STUB);
    return rt;
}

function norm(list) {
    return list.map(([m, a]) => [m, (a ?? []).slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function initObj(rt, obj, f) {
    for (let i = 0; i < 0x140; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x50, f.layer ?? 0x1000);
    rt.mem.write32(obj + 0x54, f.bucket ?? 7);
    rt.mem.write32(obj + 0x58, f.spin ?? 0);
    rt.mem.write32(obj + 0x5c, f.toggle ?? 0);
    rt.mem.write32(obj + 0x60, f.sel ?? 0);
    rt.mem.write32(obj + 0x64, f.flag64 ?? 0);
    rt.mem.write32(obj + 0x68, f.frame ?? 0);
    rt.mem.write32(obj + 0x6c, f.stamp ?? 0);
    rt.mem.write32(obj + 0xc4, f.c4 ?? 0);
    rt.mem.write32(obj + 0xd4, f.d4 ?? 0);
    rt.mem.write32(obj + 0xe4, f.e4 ?? 0);
    rt.mem.write32(obj + 0xf4, f.f4a ?? 0);
    rt.mem.write32(obj + 0x104, f.f4b ?? 0);
    rt.mem.write32(obj + 0x114, f.f4c ?? 0);
}

test("folderScreenCreate matches F0x8008A0B8", () => {
    const rt = runtime();
    let HEAP = 0x80191000;
    const allocHost = {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = HEAP;
            HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
    for (let run = 0; run < 3; run++) {
        const a = rt.cpu.call(0x8008a0b8, []) >>> 0;
        HEAP = 0x80191000;
        const b = folderScreenCreate(rt.mem, allocHost) >>> 0;
        const extraA = rt.mem.read32(a + 0x24) >>> 0;
        const extraB = rt.mem.read32(b + 0x24) >>> 0;
        assert.notEqual(extraA, 0, "original extra");
        assert.notEqual(extraB, 0, "port extra");
        for (let i = 0; i < 0x6c; i++) {
            assert.equal(rt.mem.read8(extraB + i), rt.mem.read8(extraA + i), `extra +0x${i.toString(16)}`);
        }
        for (let off = 0; off < 0x120; off += 4) {
            if (off === 0x24) continue;
            assert.equal(rt.mem.read32(b + off) >>> 0, rt.mem.read32(a + off) >>> 0, `+0x${off.toString(16)}`);
        }
    }
    const rt2 = runtime();
    const obj = rt2.cpu.call(0x8008a0b8, []) >>> 0;
    assert.equal(rt2.mem.read32(obj + 0x48) >>> 0, 0x80089e98, "handler");
    assert.equal(rt2.mem.read32(obj + 0x11c) >>> 0, 0x8008924c, "+0x11c");
    assert.equal(rt2.mem.read32(obj + 0x50) >>> 0, 0x1000, "+0x50");
    assert.equal(rt2.mem.read32(obj + 0x54) >>> 0, 7, "+0x54");
});

test("folderDrawChrome matches F0x80088E74", () => {
    const rt = runtime();
    const cases = [
        { name: "idle", spin: 0, toggle: 0 },
        { name: "spin mid", spin: 5, toggle: 1 },
        { name: "spin wrap", spin: 0x5f, toggle: 1 },
        { name: "preview", c4: 0x1000 },
        { name: "preview part", c4: 0x800 },
        { name: "slots", f4a: 0x1000, f4b: 0x1000, f4c: 0x1000 },
        { name: "slots part", f4a: 0x800, f4b: 0x1000, f4c: 0 },
        { name: "d4", d4: 0x1000 },
        { name: "d4 part", d4: 0x400 },
    ];
    for (const c of cases) {
        TIME = 100;
        initObj(rt, OBJ_A, c);
        initObj(rt, OBJ_B, c);
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80088e74, [OBJ_A], 20000);
        const oracle = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        rt.drawCalls.length = before;

        const intents = [];
        folderDrawChrome(rt.mem, OBJ_B, {
            initDrawContext() {},
            setLayer(a, b) { intents.push(["setLayer", [a, b]]); },
            setOrigin(a, b) { intents.push(["setOrigin", [a, b]]); },
            setScale(a, b, z) { intents.push(["setScale", [a, b, z]]); },
            setPos(a, b) { intents.push(["setPos", [a, b]]); },
            m_0x88(a) { intents.push(["m_0x88", [a]]); },
            drawSprite(a, b, x, y) { intents.push(["drawSprite", [a, b, x, y]]); },
            packResolve(h) { return (h >>> 0) === 0x063e0000 ? PACK_PTR : 0; },
            now() { return TIME; },
        });
        assert.deepEqual(norm(intents), oracle, `${c.name}: intents`);
        for (const off of [0x58, 0x5c, 0x68, 0x6c]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                `${c.name}: +0x${off.toString(16)}`);
        }
    }
});

test("folderDrawChrome animates the extra frame against the time cell", () => {
    const rt = runtime();
    for (const [stamp, frame, expectStep] of [[95, 3, 1], [96, 3, 0], [95, 15, 1]]) {
        const f = { e4: 0x1000, flag64: 0, sel: 2, stamp, frame };
        TIME = 100;
        initObj(rt, OBJ_A, f);
        initObj(rt, OBJ_B, f);
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80088e74, [OBJ_A], 20000);
        const oracle = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        rt.drawCalls.length = before;

        const intents = [];
        folderDrawChrome(rt.mem, OBJ_B, {
            initDrawContext() {},
            setLayer(a, b) { intents.push(["setLayer", [a, b]]); },
            setOrigin(a, b) { intents.push(["setOrigin", [a, b]]); },
            setScale(a, b, z) { intents.push(["setScale", [a, b, z]]); },
            setPos(a, b) { intents.push(["setPos", [a, b]]); },
            m_0x88(a) { intents.push(["m_0x88", [a]]); },
            drawSprite(a, b, x, y) { intents.push(["drawSprite", [a, b, x, y]]); },
            packResolve(h) { return (h >>> 0) === 0x063e0000 ? PACK_PTR : 0; },
            now() { return TIME; },
        });
        assert.deepEqual(norm(intents), oracle, `stamp ${stamp} frame ${frame}: intents`);
        assert.equal(rt.mem.read32(OBJ_B + 0x68) >>> 0, rt.mem.read32(OBJ_A + 0x68) >>> 0,
            `stamp ${stamp} frame ${frame}: +0x68`);
        assert.equal(rt.mem.read32(OBJ_B + 0x6c) >>> 0, rt.mem.read32(OBJ_A + 0x6c) >>> 0,
            `stamp ${stamp} frame ${frame}: +0x6c`);
        if (expectStep) assert.notEqual(rt.mem.read32(OBJ_A + 0x68) >>> 0, f.frame >>> 0, "frame stepped");
        else assert.equal(rt.mem.read32(OBJ_A + 0x68) >>> 0, f.frame >>> 0, "frame held");
    }
});
