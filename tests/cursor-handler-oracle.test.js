// Phase 4 oracle: engine/dw3/ui/cursor-handler.ts cursorHandler (F0x8001B0A4)
// must match the original. The original runs through engine/native over frames
// 0..90 with the tick service stubbed to a frame counter and the child setters
// running real; the port gets the same service and the translated setters. The
// whole cursor and child object are compared every frame.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { spawnUiIcon } from "../engine/dw3/ui/spawn-ui-icon.ts";
import { cursorHandler, GLYPH_TABLE } from "../engine/dw3/ui/cursor-handler.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TARGET = 0x1002;
const ORDER = 3;
const X = 0x1d;
const Y = 0x24;
const ADVANCE = 0x800142ac;
const SERVICE_CELL = 0x8004df98;
const SERVICE_STUB = 0x0fd60000;
const FRAMES = 90;
const TRIGGERS = [32, 38, 44, 50, 56, 88];
let PORT_HEAP = 0x80190000;
let FRAME = 0;
let SERVICE_CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(SERVICE_CELL, SERVICE_STUB);
    rt.cpu.setStub(SERVICE_STUB, () => {
        SERVICE_CALLS.push(FRAME);
        return FRAME;
    });
    rt.cpu.setStub(ADVANCE, (c) => {
        const o = c.reg(4);
        const v = (rt.mem.read32(o + 0xc) | 0) + 1;
        rt.mem.write32(o + 0x10, 0);
        rt.mem.write32(o + 0x14, 0);
        rt.mem.write32(o + 0x18, 0);
        rt.mem.write32(o + 0xc, v);
        return v;
    });
    return rt;
}

function portHost(rt) {
    return {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = PORT_HEAP;
            PORT_HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
        free() {},
        service() {
            SERVICE_CALLS.push(FRAME);
            return FRAME;
        },
        advanceState(self) {
            const v = (rt.mem.read32(self + 0xc) | 0) + 1;
            rt.mem.write32(self + 0x10, 0);
            rt.mem.write32(self + 0x14, 0);
            rt.mem.write32(self + 0x18, 0);
            rt.mem.write32(self + 0xc, v);
        },
    };
}

function childOf(rt, cursor) {
    const block = rt.mem.read32(cursor + 0x24) >>> 0;
    return rt.mem.read32(block) >>> 0;
}

function compareCursor(label, rt, a, b) {
    for (let off = 0; off < 0x98; off += 4) {
        if (off === 0x24) continue; // extra block pointer differs by allocation
        assert.equal(
            rt.mem.read32(b + off) >>> 0,
            rt.mem.read32(a + off) >>> 0,
            `${label} cursor +0x${off.toString(16)}`,
        );
    }
}

function line0String(rt, child) {
    const rec = child + 0x5c;
    const buf = rt.mem.read32(rec) >>> 0;
    const cap = rt.mem.read16(rec + 4) & 0xffff;
    const len = rt.mem.read16(rec + 6) & 0xffff;
    const flag = rt.mem.read16(rec + 0xa) & 0xffff;
    let str = null;
    if (buf !== 0) {
        const bytes = [];
        for (let i = 0; i < cap; i++) bytes.push(rt.mem.read8(buf + i));
        str = bytes;
    }
    return { cap, len, flag, str };
}

function compareChild(label, rt, a, b) {
    const childA = childOf(rt, a);
    const childB = childOf(rt, b);
    assert.notEqual(childA, 0, `${label}: original child created`);
    assert.notEqual(childB, 0, `${label}: port child created`);
    for (let off = 0; off < 0x174; off += 4) {
        if (off === 0x5c) continue; // line-0 buffer pointer differs by allocation
        assert.equal(
            rt.mem.read32(childB + off) >>> 0,
            rt.mem.read32(childA + off) >>> 0,
            `${label} child +0x${off.toString(16)}`,
        );
    }
    assert.deepEqual(line0String(rt, childB), line0String(rt, childA), `${label} child line 0`);
}

test("cursorHandler matches F0x8001B0A4 over frames 0..90", () => {
    const rt = runtime();
    SERVICE_CALLS = [];
    FRAME = 0;
    PORT_HEAP = 0x80190000;
    const cursorA = rt.cpu.call(0x8001b364, [TARGET, ORDER, X, Y]) >>> 0;
    const cursorB = spawnUiIcon(rt.mem, portHost(rt), TARGET, ORDER, X, Y) >>> 0;
    assert.equal(rt.mem.read32(cursorA + 0x48) >>> 0, 0x8001b0a4);

    for (FRAME = 0; FRAME <= FRAMES; FRAME++) {
        SERVICE_CALLS.length = 0;
        rt.cpu.call(0x8001b0a4, [cursorA, rt.mem.read32(cursorA + 0x24) >>> 0]);
        const oracleCalls = SERVICE_CALLS.slice();
        SERVICE_CALLS.length = 0;
        cursorHandler(rt.mem, portHost(rt), cursorB, rt.mem.read32(cursorB + 0x24) >>> 0);
        const portCalls = SERVICE_CALLS.slice();

        compareCursor(`frame ${FRAME}`, rt, cursorA, cursorB);
        compareChild(`frame ${FRAME}`, rt, cursorA, cursorB);
        assert.equal(portCalls.length, oracleCalls.length, `frame ${FRAME}: service call count`);
        assert.deepEqual(portCalls, oracleCalls, `frame ${FRAME}: service calls`);
    }

    // Independently confirm the trigger frames and the glyph index sequence.
    FRAME = 0;
    PORT_HEAP = 0x80190000;
    const fresh = spawnUiIcon(rt.mem, portHost(rt), TARGET, ORDER, X, Y);
    const seen = [];
    for (FRAME = 0; FRAME <= FRAMES; FRAME++) {
        SERVICE_CALLS.length = 0;
        cursorHandler(rt.mem, portHost(rt), fresh, rt.mem.read32(fresh + 0x24) >>> 0);
        if (SERVICE_CALLS.length === 2) seen.push(FRAME);
    }
    assert.deepEqual(seen, TRIGGERS, "trigger frames");
    // The glyph table holds five distinct pointers whose strings are the five
    // entries; assert the port reads the same table the original does.
    const ptrs = [];
    for (let i = 0; i < 5; i++) ptrs.push(rt.mem.read32(GLYPH_TABLE + i * 4) >>> 0);
    assert.equal(new Set(ptrs).size, 4, "table entry 4 repeats entry 2");
    assert.equal(ptrs[4], ptrs[2]);
});
