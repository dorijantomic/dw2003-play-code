// Phase 4 oracle: engine/dw3/resource-service.ts's four cache bodies must match
// F0x80013A6C (poll), F0x80013C30 (acquire), F0x80013CDC (service pending) and
// F0x80013E20 (load blocking). Each original address runs through engine/native
// over a seeded 64-slot table and the port runs on an identical seed; the whole
// table, the active word and the recorded host calls are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    CACHE_ACTIVE,
    CACHE_SLOTS,
    CACHE_SLOT_COUNT,
    CACHE_SLOT_STRIDE,
    FRAME_CLOCK_CELL,
    LBA_LEN_SECTORS,
    cacheAcquire,
    cacheLoadBlocking,
    cachePoll,
    cacheServicePending,
    resourceGetBase,
} from "../engine/dw3/resource-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ALLOC_CELL = 0x8004b5f4;
const ALLOC_STUB = 0x800190c0;
const TRANSFER_CELL = 0x80044b34;
const TRANSFER_STUB = 0x800190d0;
const BUSY_WORD = 0x80044b04;
const BLOCK = 0x80160000;
const CLOCK = 0x12345;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** A slot shape: id, state, tick, buffer (0 fields mean "as seeded"). */
function seedSlots(rt, slots) {
    for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
        const at = CACHE_SLOTS + i * CACHE_SLOT_STRIDE;
        const s = slots[i] ?? {};
        rt.mem.write16(at + 0x0, s.state ?? 0);
        rt.mem.write16(at + 0x2, s.pad ?? 0);
        rt.mem.write32(at + 0x4, s.id ?? 0);
        rt.mem.write32(at + 0x8, s.tick ?? 0);
        rt.mem.write32(at + 0xc, s.buffer ?? 0);
    }
    rt.mem.write32(CACHE_ACTIVE, 1);
    rt.mem.write32(BUSY_WORD, 0);
    rt.mem.write32(FRAME_CLOCK_CELL, CLOCK);
    rt.mem.write16(LBA_LEN_SECTORS + 0x77 * 2, 4);
    rt.mem.write16(LBA_LEN_SECTORS + 0x78 * 2, 2);
}

function scenario(slots, busy = 0) {
    const rt = runtime();
    seedSlots(rt, slots);
    if (busy) rt.mem.write32(BUSY_WORD, busy);
    const allocs = [];
    const transfers = [];
    let next = BLOCK;
    const alloc = (size, tag) => {
        allocs.push([size | 0, tag | 0]);
        const p = next;
        next += (size + 0xf) & ~0xf;
        return p;
    };
    const startTransfer = (id, buffer) => transfers.push([id | 0, buffer >>> 0]);
    rt.cpu.setStub(ALLOC_STUB, (c) => alloc(c.reg(4) >>> 0, c.reg(5) | 0));
    rt.cpu.setStub(TRANSFER_STUB, (c) => { startTransfer(c.reg(4) | 0, c.reg(7) >>> 0); return 0; });
    rt.mem.write32(ALLOC_CELL, ALLOC_STUB);
    rt.mem.write32(TRANSFER_CELL, TRANSFER_STUB);
    return { rt, allocs, transfers, host: { alloc, startTransfer } };
}

function snapshot(rt) {
    const out = [];
    for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
        const at = CACHE_SLOTS + i * CACHE_SLOT_STRIDE;
        out.push(rt.mem.read32(at) >>> 0, rt.mem.read32(at + 0x4) >>> 0, rt.mem.read32(at + 0x8) >>> 0, rt.mem.read32(at + 0xc) >>> 0);
    }
    out.push(rt.mem.read32(CACHE_ACTIVE) >>> 0);
    return out;
}

function compare(name, a, b) {
    assert.deepEqual(snapshot(b.rt), snapshot(a.rt), `${name} slot table`);
    assert.deepEqual(b.allocs, a.allocs, `${name} allocs`);
    assert.deepEqual(b.transfers, a.transfers, `${name} transfers`);
}

const TWO = { 0: { id: 0x77, state: 1 }, 1: { id: 0x78, state: 2 } };

test("cacheAcquire matches F0x80013C30", () => {
    const cases = [
        ["cold id", {}, 0x77],
        ["resident id", { 3: { id: 0x77, state: 3, tick: 1 } }, 0x77],
        ["pending id", { 2: { id: 0x77, state: 1, tick: 5, buffer: BLOCK } }, 0x77],
    ];
    for (const [name, slots, id] of cases) {
        const a = scenario(slots);
        a.rt.cpu.call(0x80013c30, [id]);
        const b = scenario(slots);
        cacheAcquire(b.rt.mem, id, b.host);
        compare(name, a, b);
    }
});

test("cachePoll matches F0x80013A6C", () => {
    const cases = [
        ["resident", { 0: { id: 0x77, state: 3, tick: 9 } }, 0x77],
        ["pending", { 0: { id: 0x77, state: 1, tick: 9 } }, 0x77],
        ["missing", {}, 0x78],
    ];
    for (const [name, slots, id] of cases) {
        const a = scenario(slots);
        const retA = a.rt.cpu.call(0x80013a6c, [id]) | 0;
        const b = scenario(slots);
        const retB = cachePoll(b.rt.mem, id, b.host) | 0;
        assert.equal(retB, retA, `${name} return`);
        compare(name, a, b);
    }
});

test("cacheServicePending matches F0x80013CDC", () => {
    const cases = [
        ["one start one promote", TWO],
        ["inactive word", TWO, 0, (rt) => rt.mem.write32(CACHE_ACTIVE, 0)],
        ["busy gate", TWO, 1],
        ["nothing to do", { 0: { id: 0x77, state: 3 } }],
        ["pending only", { 1: { id: 0x78, state: 1, buffer: BLOCK } }],
        ["resident only clears the word", { 0: { id: 0x77, state: 3 }, 1: { id: 0x78, state: 0 } }],
        ["two pending slots start only one", { 0: { id: 0x77, state: 1, buffer: BLOCK }, 1: { id: 0x78, state: 1, buffer: BLOCK + 0x40 } }],
    ];
    for (const [name, slots, busy, tweak] of cases) {
        const a = scenario(slots, busy || 0);
        if (tweak) tweak(a.rt);
        a.rt.cpu.call(0x80013cdc, []);
        const b = scenario(slots, busy || 0);
        if (tweak) tweak(b.rt);
        cacheServicePending(b.rt.mem, b.host);
        if (name === "inactive word" || name === "busy gate") {
            assert.equal(a.rt.mem.read32(CACHE_ACTIVE) >>> 0, name === "busy gate" ? 1 : 0, `${name} active word`);
        }
        compare(name, a, b);
        if (name === "two pending slots start only one") {
            assert.equal(a.transfers.length, 1, "only the first pending slot starts");
            assert.equal(a.rt.mem.read16(CACHE_SLOTS) | 0, 2, "the first slot is dispatched");
            assert.equal(a.rt.mem.read16(CACHE_SLOTS + CACHE_SLOT_STRIDE) | 0, 1, "the second stays pending");
        }
        if (name === "one start one promote") {
            assert.equal(a.transfers.length, 1, "at most one transfer per pass");
            assert.equal(a.rt.mem.read16(CACHE_SLOTS) | 0, 2, "first slot dispatched");
        }
    }
});

test("cacheLoadBlocking matches F0x80013E20", () => {
    for (const slots of [{}, { 0: { id: 0x77, state: 2 } }]) {
        const cold = Object.keys(slots).length === 0;
        const a = scenario(slots);
        a.rt.cpu.call(0x80013e20, [0x77]);
        const b = scenario(slots);
        cacheLoadBlocking(b.rt.mem, 0x77, b.host);
        compare(cold ? "blocking cold" : "blocking with a dispatched slot", a, b);
        if (cold) assert.ok(a.transfers.length >= 1, "the loader started a transfer");
        else assert.equal(a.transfers.length, 0, "an already-dispatched slot needs no transfer");
        assert.equal(a.rt.mem.read32(CACHE_SLOTS + 0x4) | 0, 0x77, "the id is on a slot at the end");
        assert.equal(a.rt.mem.read32(CACHE_SLOTS) & 0xffff, 3, "and that slot is resident");
    }
});

// ── resourceGetBase F0x80013E5C ──────────────────────────────────────────────

test("resourceGetBase matches F0x80013E5C", () => {
    // The 0x8004DE10+0x188 pointer cell: the shipped table holds F0x8001D6F4
    // (returns the frame counter at 0x8004DE20); the runtime's own stub answers
    // the same word, so the port must refresh the slot's tick identically.
    const CLOCKS = [0, 7, 0x12345, 0xfffffff0];
    const clockStub = 0x800190e0;
    const cases = [
        ["resident slot 0", { 0: { id: 0x77, state: 3, tick: 9, buffer: BLOCK + 0x100 } }, 0x77],
        ["resident slot 37", { 37: { id: 0x1234, state: 3, tick: 0, buffer: BLOCK + 0x2000 } }, 0x1234],
        ["pending slot", { 2: { id: 0x77, state: 1, tick: 5, buffer: BLOCK } }, 0x77],
        ["missing id", {}, 0x88],
    ];
    for (const [name, slots, id] of cases) {
        const cold = slots[0] === undefined && Object.keys(slots).length === 0;
        const a = scenario(slots);
        a.rt.cpu.setStub(clockStub, () => a.rt.mem.read32(FRAME_CLOCK_CELL) | 0);
        a.rt.mem.write32(0x8004df98, clockStub);
        const retA = a.rt.cpu.call(0x80013e5c, [id]) >>> 0;
        // the port on a twin scenario, identical seed
        const b = scenario(slots);
        const bHost = {
            ...b.host,
            clock: () => b.rt.mem.read32(FRAME_CLOCK_CELL) | 0,
            busyGate: () => b.rt.mem.read32(BUSY_WORD) | 0,
        };
        const retB = resourceGetBase(b.rt.mem, id, bHost, b.transfers) >>> 0;
        assert.equal(retB, retA, `${name} return`);
        compare(name, a, b);
        if (cold) {
            // the blocking path: acquire + pump to resident, then the buffer
            assert.ok(a.transfers.length >= 1, `${name} transfer started`);
            assert.equal(retA >>> 0, BLOCK >>> 0, `${name} returns the buffer`);
            assert.equal((a.rt.mem.read32(CACHE_SLOTS) & 0xffff), 3, `${name} resident`);
        }
    }
    // the clock word the slot tick is stamped with on both sides
    for (const clk of CLOCKS) {
        const a = scenario({ 0: { id: 0x77, state: 3, tick: 1, buffer: BLOCK + 4 } });
        a.rt.mem.write32(FRAME_CLOCK_CELL, clk >>> 0);
        a.rt.cpu.setStub(clockStub, () => a.rt.mem.read32(FRAME_CLOCK_CELL) | 0);
        const retA = a.rt.cpu.call(0x80013e5c, [0x77]) >>> 0;
        const b = scenario({ 0: { id: 0x77, state: 3, tick: 1, buffer: BLOCK + 4 } });
        b.rt.mem.write32(FRAME_CLOCK_CELL, clk >>> 0);
        const bHost = {
            ...b.host,
            clock: () => b.rt.mem.read32(FRAME_CLOCK_CELL) | 0,
            busyGate: () => 0,
        };
        const retB = resourceGetBase(b.rt.mem, 0x77, bHost, b.transfers) >>> 0;
        assert.equal(retB, retA, `clock 0x${clk.toString(16)} return`);
        compare(`clock 0x${clk.toString(16)}`, a, b);
        assert.equal(retA, (BLOCK + 4) >>> 0, `clock 0x${clk.toString(16)} buffer`);
        assert.equal(a.rt.mem.read32(CACHE_SLOTS + 8) >>> 0, clk >>> 0, `clock stamped`);
    }
});
