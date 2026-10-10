// Lane B Phase 4 oracle: engine/dw3/ui/native/album-grid-object.ts must match
// the original pro/stcrdabm album grid object.
//
//   F0x80083A78  albumGridCreate
//   F0x80083848  albumGridTick
//
// The original runs through engine/native (the interpreter) as the oracle. The
// grid's boundary callees (0x80083780 / 0x8008304C / 0x80083734 / 0x80083174),
// its base methods (+0x28/+0x38/+0x3C) and the shared time cell [0x8004DF98]
// are stubs; begin page and draw silhouettes run through the already-translated
// album-grid functions on the port side, so the draw intents are compared too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    albumGridCreate,
    albumGridTick,
} from "../../engine/dw3/ui/native/album-grid-object.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const album = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: album.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const M28 = 0x0fd75100;
const M38 = 0x0fd75104;
const M3C = 0x0fd75108;
const DRAW_CELLS = 0x80083174;
const CALL_83780 = 0x80083780;
const CALL_8304c = 0x8008304c;
const CALL_83734 = 0x80083734;
const TIME_STUB = 0x0fd75200;
const SND_STUB = 0x0fd75204;
const PACK_STUB = 0x0fd75208;
const PACK_PTR = 0x80190000;
const ARITY = { setLayer: 2, setOrigin: 2, m_0x88: 1, drawSprite: 4 };

let TIME = 0;
let CALL83734 = 0;
const CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(album, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    const rec = (tag) => (c) => { CALLS.push([tag, (c.reg(4) >>> 0) - OBJ_A, c.reg(5) | 0]); return 0; };
    rt.cpu.setStub(M28, rec("m28"));
    rt.cpu.setStub(M38, rec("m38"));
    rt.cpu.setStub(M3C, rec("m3c"));
    rt.cpu.setStub(DRAW_CELLS, rec("drawCells"));
    rt.cpu.setStub(CALL_83780, rec("call83780"));
    rt.cpu.setStub(CALL_8304c, rec("call8304c"));
    rt.cpu.setStub(CALL_83734, (c) => { CALLS.push(["call83734", (c.reg(4) >>> 0) - OBJ_A, 0]); return CALL83734; });
    rt.cpu.setStub(TIME_STUB, () => TIME);
    rt.cpu.setStub(SND_STUB, (c) => { CALLS.push(["snd", c.reg(4) | 0, 0]); return 0; });
    rt.cpu.setStub(PACK_STUB, (c) => (c.reg(4) >>> 0) === 0x06050000 ? PACK_PTR : 0);
    rt.mem.write32(0x8004df98, TIME_STUB);
    rt.mem.write32(0x80055c48, SND_STUB);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    return rt;
}

function norm(list) {
    return list.map(([m, a]) => [m, (a ?? []).slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function initObj(rt, obj, f) {
    for (let i = 0; i < 0x90; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x0c, f.state ?? 0);
    rt.mem.write32(obj + 0x10, f.sub ?? 0);
    rt.mem.write32(obj + 0x14, f.targetSub ?? 0);
    rt.mem.write32(obj + 0x18, f.stamp ?? 0);
    rt.mem.write32(obj + 0x28, M28);
    rt.mem.write32(obj + 0x38, M38);
    rt.mem.write32(obj + 0x3c, M3C);
    rt.mem.write32(obj + 0x50, f.base ?? 0);
    rt.mem.write32(obj + 0x54, 0x1000);
    rt.mem.write32(obj + 0x58, 6);
    rt.mem.write32(obj + 0x5c, f.page ?? 0);
    rt.mem.write32(obj + 0x60, 0xaaaa);
    rt.mem.write32(obj + 0x64, f.cells ?? 0);
    rt.mem.write32(obj + 0x68, f.visible ?? 0);
    rt.mem.write32(obj + 0x6c, f.pulseStamp ?? 0);
    rt.mem.write32(obj + 0x70, f.pulse ?? 0);
}

const FIELD_OFFSETS = [0x0c, 0x10, 0x14, 0x18, 0x50, 0x5c, 0x60, 0x64, 0x68, 0x6c, 0x70];

function portHost(intents) {
    const host = {
        initDrawContext() {},
        setLayer(a, b) { intents.push(["setLayer", [a, b]]); },
        setOrigin(a, b) { intents.push(["setOrigin", [a, b]]); },
        m_0x88(a) { intents.push(["m_0x88", [a]]); },
        drawSprite(a, b, x, y) { intents.push(["drawSprite", [a, b, x, y]]); },
        packResolve(h) { return (h >>> 0) === 0x06050000 ? PACK_PTR : 0; },
        pageMethod28(o, v) { CALLS.push(["m28", (o >>> 0) - OBJ_B, v | 0]); },
        baseMethod38(o) { CALLS.push(["m38", (o >>> 0) - OBJ_B, 0]); },
        baseMethod3C(o) { CALLS.push(["m3c", (o >>> 0) - OBJ_B, 0]); },
        call83780(o) { CALLS.push(["call83780", (o >>> 0) - OBJ_B, 0]); },
        call8304c(o) { CALLS.push(["call8304c", (o >>> 0) - OBJ_B, 0]); },
        call83734(o) { CALLS.push(["call83734", (o >>> 0) - OBJ_B, 0]); return CALL83734; },
        drawCells(o, flag) { CALLS.push(["drawCells", (o >>> 0) - OBJ_B, flag | 0]); },
        now() { return TIME; },
        displayTime() { return TIME; },
        playSound(id) { CALLS.push(["snd", id | 0, 0]); },
    };
    return host;
}

function compare(label, rt, f) {
    TIME = f.time ?? 0;
    CALL83734 = f.call83734 ?? 0;
    initObj(rt, OBJ_A, f);
    initObj(rt, OBJ_B, f);

    CALLS.length = 0;
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80083848, [OBJ_A], 20000);
    const oracleCalls = CALLS.slice();
    const oracleIntents = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
    rt.drawCalls.length = before;

    CALLS.length = 0;
    const intents = [];
    albumGridTick(rt.mem, OBJ_B, portHost(intents));

    assert.deepEqual(CALLS, oracleCalls, `${label}: calls`);
    assert.deepEqual(norm(intents), oracleIntents, `${label}: draw intents`);
    for (const off of FIELD_OFFSETS) {
        assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
            `${label}: +0x${off.toString(16)}`);
    }
}

test("albumGridCreate matches F0x80083A78", () => {
    const rt = runtime();
    let HEAP = 0x80191000;
    const portHostAlloc = {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = HEAP;
            HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
    for (const arg0 of [0, 1, 0x27, 0x1234]) {
        const a = rt.cpu.call(0x80083a78, [arg0]) >>> 0;
        HEAP = 0x80191000;
        const b = albumGridCreate(rt.mem, portHostAlloc, arg0) >>> 0;
        for (let off = 0; off < 0x8c; off += 4) {
            assert.equal(rt.mem.read32(b + off) >>> 0, rt.mem.read32(a + off) >>> 0,
                `arg0 ${arg0}: +0x${off.toString(16)}`);
        }
        assert.equal(rt.mem.read32(b + 0x48) >>> 0, 0x80083848, "handler");
        assert.equal(rt.mem.read32(b + 0x84) >>> 0, 0x80083114, "begin-page slot");
        assert.equal(rt.mem.read32(b + 0x88) >>> 0, 0x8008314c, "slot +0x88");
        assert.equal(rt.mem.read32(b + 0x50) >>> 0, arg0 >>> 0, "arg0 field");
    }
});

test("albumGridTick matches F0x80083848 for every state", () => {
    const rt = runtime();
    compare("state 0", rt, { state: 0 });
    compare("state 3", rt, { state: 3 });
    compare("state 4", rt, { state: 4 });
    compare("state -1", rt, { state: -1 });
    compare("state 1", rt, { state: 1 });
});

test("albumGridTick matches the state-2 sub-state machine", () => {
    const rt = runtime();
    // block 10: visible count advancing and the 12 clamp.
    for (const visible of [0, 5, 10, 11]) {
        compare(`sub0 visible ${visible}`, rt, { state: 2, sub: 0, visible, time: 500, stamp: 100 });
    }
    // sub 1: below and at the two-tick threshold.
    compare("sub1 below", rt, { state: 2, sub: 1, time: 500, stamp: 499, targetSub: 3 });
    compare("sub1 at", rt, { state: 2, sub: 1, time: 500, stamp: 498, targetSub: 3 });
    // sub 2: pulse start, with and without the sound.
    compare("sub2 silent", rt, { state: 2, sub: 2, time: 700, call83734: 0 });
    compare("sub2 sound", rt, { state: 2, sub: 2, time: 700, call83734: 1 });
    // sub 3: display-time pulse, ending at 11.
    compare("sub3 below", rt, { state: 2, sub: 3, time: 700, pulseStamp: 699, pulse: 4 });
    compare("sub3 step", rt, { state: 2, sub: 3, time: 700, pulseStamp: 698, pulse: 4 });
    compare("sub3 end", rt, { state: 2, sub: 3, time: 700, pulseStamp: 698, pulse: 10 });
    // Unknown sub-states fall through to block 10.
    compare("sub -1", rt, { state: 2, sub: -1, visible: 3, time: 500, stamp: 100 });
    compare("sub 9", rt, { state: 2, sub: 9, visible: 11, time: 500, stamp: 100 });
});
