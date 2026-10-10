// Phase 4 oracle: engine/dw3/heap-alloc.ts must reproduce the resident heap
// allocator family. Each original address runs through engine/native over a
// seeded block list; the port runs on an identical seed, and the whole block
// region, the descriptor and the returned payload pointer are compared.
//
// The eviction pump the retry wrappers call through [0x80044B38+0x408] is a
// deterministic stub on BOTH sides (the test writes the stub into the pointer
// cell and passes the same body to the port), so the retry count is compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    HEAP_DESC,
    HEAP_EVICT_CELL,
    HEAP_HEAD,
    HEAP_LAST,
    heapAllocForward,
    heapAllocRetry,
    heapAllocRetryHigh,
    heapAllocReverse,
    heapAllocZeroed,
} from "../engine/dw3/heap-alloc.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const A = 0x80100000;
const B = 0x80100080;
const SENT = 0x80100100;
const REGION_END = SENT + 0x40;
const EVICT_STUB = 0x80019090;
const P = 0x8005cb50;
const GARBAGE = 0xa5a5a5a5;

/** Block shapes: which blocks exist and their flags. */
const SHAPES = {
    // one free block then the sentinel
    free1: [{ at: A, flag: 0 }],
    // the free block already carries an allocation
    alloc1: [{ at: A, flag: 2 }],
    // two free blocks in a row
    free2: [{ at: A, flag: 0 }, { at: B, flag: 0 }],
    // nothing but the sentinel
    empty: [],
    // a free block whose usable span is exactly request + 0x14 for size 0x40:
    // the split floor boundary (the original gives the leftover away)
    tight: [{ at: A, flag: 0 }, { at: A + 0x60, flag: 1 }],
};

function seedHeap(rt, shape) {
    const blocks = [{ at: SENT, flag: 1 }].concat(SHAPES[shape]);
    blocks.sort((x, y) => x.at - y.at);
    for (const b of blocks) {
        rt.mem.write32(b.at + 0x0, 0);
        rt.mem.write32(b.at + 0x4, 0);
        rt.mem.write32(b.at + 0x8, b.flag);
    }
    // payload garbage, so a mis-sized bzero is visible
    for (let a = A; a < REGION_END; a += 4) rt.mem.write32(a, GARBAGE);
    for (const b of blocks) rt.mem.write32(b.at + 0x8, b.flag);
    for (let i = 0; i < blocks.length; i++) {
        const prev = i === 0 ? blocks[i] : blocks[i - 1];
        const next = i === blocks.length - 1 ? blocks[i] : blocks[i + 1];
        rt.mem.write32(blocks[i].at + 0x0, prev.at);
        rt.mem.write32(blocks[i].at + 0x4, next.at);
    }
    rt.mem.write32(HEAP_HEAD, blocks[0].at);
    rt.mem.write32(HEAP_LAST, SENT + 0xc);
}

function scenario(shape) {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = P;
    // The screen runtime host-serves 0x80017D2C with a bump arena because the
    // original heap boot (F0x80017C5C) never runs in the browser. Drop that hook
    // so the oracle exercises the shipped fit body.
    rt.cpu.clearStub(0x80017d2c);
    seedHeap(rt, shape);
    const evicts = [];
    return { rt, evicts };
}

function snapshot(rt) {
    const out = [];
    for (let a = A; a < REGION_END; a += 4) out.push(rt.mem.read32(a) >>> 0);
    out.push(rt.mem.read32(HEAP_HEAD) >>> 0);
    out.push(rt.mem.read32(HEAP_LAST) >>> 0);
    return out;
}

/** Frees the first non-sentinel block: the deterministic eviction the oracle uses. */
function freeFirstBlock(rt, evicts) {
    const head = rt.mem.read32(HEAP_HEAD) >>> 0;
    evicts.push(head);
    rt.mem.write32(head + 0x8, 0);
}

function runOriginal(addr, shape, args, evict) {
    const s = scenario(shape);
    if (evict) {
        s.rt.cpu.setStub(EVICT_STUB, () => { freeFirstBlock(s.rt, s.evicts); return 0; });
        s.rt.mem.write32(HEAP_EVICT_CELL, EVICT_STUB);
    }
    const ret = s.rt.cpu.call(addr, args) >>> 0;
    return { ret, bytes: snapshot(s.rt), evicts: s.evicts, rt: s.rt };
}

function runPort(fn, shape, args, evict, needsHost = true) {
    const s = scenario(shape);
    const h = { evictOne: () => freeFirstBlock(s.rt, s.evicts) };
    const ret = (needsHost ? fn(s.rt.mem, h, ...args) : fn(s.rt.mem, ...args)) >>> 0;
    return { ret, bytes: snapshot(s.rt), evicts: s.evicts, rt: s.rt };
}

test("heapAllocForward matches F0x80017D2C", () => {
    const cases = [
        ["free1", 0x40, 2], ["free1", 0x40, 3], ["free1", 0xf4, 2], ["free1", 0x100, 2],
        ["free1", 0x10, 2], ["free1", 0x12, 2], ["free1", 0x0, 2], ["free1", 0xe8, 2],
        ["free1", 0xe9, 2], ["alloc1", 0x40, 2], ["free2", 0x40, 2], ["empty", 0x40, 2],
        ["tight", 0x40, 2], ["tight", 0x41, 2], ["tight", 0x3f, 2],
    ];
    for (const [shape, size, tag] of cases) {
        const a = runOriginal(0x80017d2c, shape, [size, tag], false);
        const b = runPort(heapAllocForward, shape, [size, tag], false, false);
        assert.equal(b.ret, a.ret, `${shape} size=0x${size.toString(16)} return`);
        assert.deepEqual(b.bytes, a.bytes, `${shape} size=0x${size.toString(16)} heap bytes`);
    }
});

test("heapAllocReverse matches F0x80017DDC", () => {
    const cases = [
        ["free1", 0x40, 2], ["free1", 0x40, 3], ["free1", 0xf4, 2], ["free1", 0x100, 2],
        ["free1", 0x10, 2], ["free1", 0x12, 2], ["free1", 0x10c, 2], ["free2", 0x40, 2],
        ["alloc1", 0x40, 2], ["empty", 0x40, 2],
    ];
    for (const [shape, size, tag] of cases) {
        const a = runOriginal(0x80017ddc, shape, [size, tag], false);
        const b = runPort(heapAllocReverse, shape, [size, tag], false, false);
        assert.equal(b.ret, a.ret, `${shape} size=0x${size.toString(16)} return`);
        assert.deepEqual(b.bytes, a.bytes, `${shape} size=0x${size.toString(16)} heap bytes`);
        if (shape === "free1" && size === 0x40) assert.notEqual(a.ret, 0, "reverse split found space");
    }
});

test("heapAllocRetry matches F0x80017E84 (evict once, then succeed)", () => {
    const a = runOriginal(0x80017e84, "alloc1", [0x40, 2], true);
    const b = runPort(heapAllocRetry, "alloc1", [0x40, 2], true);
    assert.equal(b.ret, a.ret, "return");
    assert.deepEqual(b.bytes, a.bytes, "heap bytes");
    assert.deepEqual(b.evicts, a.evicts, "eviction calls");
    assert.equal(a.evicts.length, 1, "the wrapper retried exactly once");
});

test("heapAllocRetryHigh matches F0x80017EEC (evict once, then succeed)", () => {
    const a = runOriginal(0x80017eec, "alloc1", [0x40, 2], true);
    const b = runPort(heapAllocRetryHigh, "alloc1", [0x40, 2], true);
    assert.equal(b.ret, a.ret, "return");
    assert.deepEqual(b.bytes, a.bytes, "heap bytes");
    assert.deepEqual(b.evicts, a.evicts, "eviction calls");
    assert.equal(a.evicts.length, 1, "the wrapper retried exactly once");
});

test("heapAllocZeroed matches F0x80017F54 (original size, not rounded)", () => {
    for (const [shape, size, evict] of [["free1", 0x12, false], ["free1", 0x40, false], ["alloc1", 0x12, true]]) {
        const a = runOriginal(0x80017f54, shape, [size, 2], evict);
        const b = runPort(heapAllocZeroed, shape, [size, 2], evict);
        assert.equal(b.ret, a.ret, `${shape} size=0x${size.toString(16)} return`);
        assert.deepEqual(b.bytes, a.bytes, `${shape} size=0x${size.toString(16)} heap bytes`);
        assert.deepEqual(b.evicts, a.evicts, `${shape} size=0x${size.toString(16)} evictions`);
        // the returned payload really is zeroed, byte for byte
        assert.notEqual(a.ret, 0, `${shape} size=0x${size.toString(16)} got a block`);
        for (let i = 0; i < size; i++) {
            assert.equal(b.rt.mem.read8(a.ret + i), 0, `${shape} payload byte +0x${i.toString(16)} zeroed`);
        }
    }
});
