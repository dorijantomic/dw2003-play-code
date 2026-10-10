// Lane B Phase 4 oracle: engine/dw3/ui/native/folder-lifecycle.ts must match the
// original pro/stcrddek folder screen lifecycle F0x80089E98.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// picker (0x80089354) and label builder (0x80088B34), the base methods
// (+0x28/+0x38), the child methods (+0xEC/+0xF0), the wait/ready cells
// [0x8008B830]/[0x8008B834] and the resource service cells are all stubs, so the
// ordered calls, fields and chrome draw intents can be compared. The chrome draw
// is translated (folder-screen.ts) and called directly by the port.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { folderScreenLifecycle } from "../../engine/dw3/ui/native/folder-lifecycle.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const folder = new Uint8Array(readFileSync(join(dir, "pro_stcrddek.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: folder.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const CTX_A = 0x80151000;
const CTX_B = 0x80151100;
const CHILD_A = 0x80152000;
const CHILD_B = 0x80152100;
const M28 = 0x0fd76100;
const M38 = 0x0fd76104;
const CEC = 0x0fd76108;
const CF0 = 0x0fd7610c;
const WAIT_STUB = 0x0fd76110;
const READY_STUB = 0x0fd76114;
const S2714 = 0x0fd76118;
const S2708 = 0x0fd7611c;
const S270C = 0x0fd76120;
const PACK_STUB = 0x0fd40000;
const TIME_STUB = 0x0fd40004;
const PACK_PTR = 0x80190000;

let READY = 0;
const CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(folder, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const recObj = (tag) => (c) => { CALLS.push([tag, (c.reg(4) >>> 0) - OBJ_A, c.reg(5) | 0]); return 0; };
    rt.cpu.setStub(M28, recObj("m28"));
    rt.cpu.setStub(M38, (c) => { CALLS.push(["m38", (c.reg(4) >>> 0) - OBJ_A, 0]); return 0; });
    rt.cpu.setStub(CEC, (c) => { CALLS.push(["cec", (c.reg(4) >>> 0) - CHILD_A, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(CF0, (c) => { CALLS.push(["cf0", (c.reg(4) >>> 0) - CHILD_A, 0]); return 0; });
    rt.cpu.setStub(WAIT_STUB, () => { CALLS.push(["wait", 0, 0]); return 0; });
    rt.cpu.setStub(READY_STUB, () => { CALLS.push(["ready", 0, 0]); return READY; });
    rt.cpu.setStub(S2714, () => { CALLS.push(["s2714", 0, 0]); return 0x11; });
    rt.cpu.setStub(S2708, () => { CALLS.push(["s2708", 0, 0]); return 0x22; });
    rt.cpu.setStub(S270C, (c) => { CALLS.push(["s270c", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x80089354, (c) => { CALLS.push(["picker", (c.reg(4) >>> 0) - OBJ_A, 0]); return 0; });
    rt.cpu.setStub(0x80088b34, (c) => { CALLS.push(["labels", (c.reg(4) >>> 0) - OBJ_A, 0]); return 0; });
    rt.cpu.setStub(PACK_STUB, (c) => (c.reg(4) >>> 0) === 0x063e0000 ? PACK_PTR : 0);
    rt.cpu.setStub(TIME_STUB, () => 100);
    rt.mem.write32(0x8008b830, WAIT_STUB);
    rt.mem.write32(0x8008b834, READY_STUB);
    rt.mem.write32(0x8004b448, S2714);
    rt.mem.write32(0x8004b43c, S2708);
    rt.mem.write32(0x8004b440, S270C);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x8004df98, TIME_STUB);
    return rt;
}

function portHost(intents) {
    return {
        initDrawContext() {},
        setLayer(a, b) { intents.push(["setLayer", [a, b]]); },
        setOrigin(a, b) { intents.push(["setOrigin", [a, b]]); },
        setScale(a, b, z) { intents.push(["setScale", [a, b, z]]); },
        setPos(a, b) { intents.push(["setPos", [a, b]]); },
        m_0x88(a) { intents.push(["m_0x88", [a]]); },
        drawSprite(a, b, x, y) { intents.push(["drawSprite", [a, b, x, y]]); },
        packResolve(h) { return (h >>> 0) === 0x063e0000 ? PACK_PTR : 0; },
        now() { return 100; },
        call89354(o, ctx) { CALLS.push(["picker", (o >>> 0) - OBJ_B, 0]); },
        call88b34(o, ctx) { CALLS.push(["labels", (o >>> 0) - OBJ_B, 0]); },
        wait8330() { CALLS.push(["wait", 0, 0]); },
        ready8334() { CALLS.push(["ready", 0, 0]); return READY; },
        baseMethod28(o, v) { CALLS.push(["m28", (o >>> 0) - OBJ_B, v | 0]); },
        baseMethod38(o) { CALLS.push(["m38", (o >>> 0) - OBJ_B, 0]); },
        childEC(child, arg) { CALLS.push(["cec", (child >>> 0) - CHILD_B, arg | 0]); },
        childF0(child) { CALLS.push(["cf0", (child >>> 0) - CHILD_B, 0]); },
        svc2714() { CALLS.push(["s2714", 0, 0]); return 0x11; },
        svc2708() { CALLS.push(["s2708", 0, 0]); return 0x22; },
        svc270c(a, b) { CALLS.push(["s270c", a | 0, b | 0]); },
    };
}

function norm(list) {
    const arity = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };
    return list.map(([m, a]) => [m, (a ?? []).slice(0, arity[m] ?? 4).map((v) => v >>> 0)]);
}

function setupPair(rt, f) {
    const clear = (base, size) => { for (let i = 0; i < size; i += 4) rt.mem.write32(base + i, 0); };
    clear(OBJ_A, 0x120); clear(OBJ_B, 0x120);
    clear(CTX_A, 0x10); clear(CTX_B, 0x10);
    clear(CHILD_A, 0x120); clear(CHILD_B, 0x120);
    for (const [obj, ctx, child] of [[OBJ_A, CTX_A, CHILD_A], [OBJ_B, CTX_B, CHILD_B]]) {
        rt.mem.write32(obj + 0x0c, f.state ?? 0);
        rt.mem.write32(obj + 0x10, f.sub ?? 0);
        rt.mem.write32(obj + 0x28, M28);
        rt.mem.write32(obj + 0x38, M38);
        rt.mem.write32(obj + 0x50, 0x1000);
        rt.mem.write32(obj + 0x54, 7);
        rt.mem.write32(obj + 0x60, f.sel ?? 0);
        rt.mem.write32(obj + 0x70, f.gate70 ?? 0);
        rt.mem.write32(ctx, f.child ? child : 0);
        rt.mem.write32(child + 0x0c, f.child0c ?? 0);
        rt.mem.write32(child + 0x10, f.child10 ?? 0);
        rt.mem.write32(child + 0xec, CEC);
        rt.mem.write32(child + 0xf0, CF0);
    }
}

const FIELD_OFFSETS = [0x0c, 0x10, 0x60, 0x70, 0xbc, 0xcc, 0xdc, 0xec, 0xfc, 0x10c];

function compare(label, rt, f) {
    READY = f.ready ?? 0;
    setupPair(rt, f);

    CALLS.length = 0;
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80089e98, [OBJ_A, CTX_A], 20000);
    const oracleCalls = CALLS.slice();
    const oracleIntents = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
    rt.drawCalls.length = before;

    CALLS.length = 0;
    const intents = [];
    folderScreenLifecycle(rt.mem, OBJ_B, CTX_B, portHost(intents));

    const os = f.state ?? 0;
    if (os === 1 || os === 2) {
        assert.deepEqual(norm(intents), oracleIntents, `${label}: chrome intents`);
    } else {
        assert.equal(intents.length, 0, `${label}: no draw`);
    }
    assert.deepEqual(CALLS, oracleCalls, `${label}: calls`);
    for (const off of FIELD_OFFSETS) {
        assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
            `${label}: obj +0x${off.toString(16)}`);
    }
    if (f.child) {
        assert.equal(rt.mem.read32(CHILD_B + 0x0c) >>> 0, rt.mem.read32(CHILD_A + 0x0c) >>> 0,
            `${label}: child +0x0c`);
        assert.equal(rt.mem.read32(CHILD_B + 0x10) >>> 0, rt.mem.read32(CHILD_A + 0x10) >>> 0,
            `${label}: child +0x10`);
    }
}

test("folderScreenLifecycle matches F0x80089E98", () => {
    const rt = runtime();
    compare("state 1", rt, { state: 1 });
    compare("state 3", rt, { state: 3 });
    compare("boot sub0", rt, { state: 0, sub: 0 });
    compare("boot sub1 ready", rt, { state: 0, sub: 1, ready: 1 });
    compare("boot sub1 go", rt, { state: 0, sub: 1, ready: 0 });
    compare("boot sub2", rt, { state: 0, sub: 2 });
    compare("boot sub7", rt, { state: 0, sub: 7 });
    compare("sel gate clear child none", rt, { state: 2, gate70: 0, child: 0 });
    compare("sel gate clear child set", rt, { state: 2, gate70: 0, child: 1 });
    compare("sel sub0 record", rt, { state: 2, gate70: 1, sub: 0, child: 1, child10: 0x64, sel: 2 });
    compare("sel sub0 other", rt, { state: 2, gate70: 1, sub: 0, child: 1, child10: 0x10 });
    compare("sel sub1 promote", rt, { state: 2, gate70: 1, sub: 1, child: 1, child0c: 2 });
    compare("sel sub1 other", rt, { state: 2, gate70: 1, sub: 1, child: 1, child0c: 5 });
    compare("sel sub2 record", rt, { state: 2, gate70: 1, sub: 2, child: 1, child10: 0x64 });
});
