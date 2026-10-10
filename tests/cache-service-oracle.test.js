// Phase 4 oracle: engine/dw3/byte-ops.ts strcpyBytes (F0x8002518C),
// engine/dw3/resource-service.ts isResourceServiceReady (F0x800138A8) and
// findFreeCacheSlot (F0x80013A34), and engine/dw3/display-view.ts setRectColour
// (F0x8001E028) must match the interpreter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { strcpyBytes } from "../engine/dw3/byte-ops.ts";
import {
    CACHE_SLOTS,
    CACHE_SLOT_COUNT,
    CACHE_SLOT_STRIDE,
    RESOURCE_SERVICE_ACTIVE,
    findCacheSlotById,
    findFreeCacheSlot,
    freeCacheSlotBlock,
    isResourceServiceReady,
} from "../engine/dw3/resource-service.ts";
import { setRectColour } from "../engine/dw3/display-view.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const SRC = 0x80150000;
const DST_A = 0x80150100;
const DST_B = 0x80150200;
const OBJ_A = 0x80150000;
const OBJ_B = 0x80150300;
const WIN = 0x80;

function runtime() {
    return new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
}

function bytes(rt, base, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rt.mem.read8(base + i));
    return out;
}

test("strcpyBytes matches the interpreter (F0x8002518C)", () => {
    const rt = runtime();
    const strings = ["", "a", "hello", "Digimon World 2003"];
    for (const s of strings) {
        for (let i = 0; i < WIN; i++) {
            rt.mem.write8(SRC + i, 0x41);
            rt.mem.write8(DST_A + i, 0xaa);
            rt.mem.write8(DST_B + i, 0xaa);
        }
        for (let i = 0; i < s.length; i++) rt.mem.write8(SRC + i, s.charCodeAt(i));
        rt.mem.write8(SRC + s.length, 0);
        const oracleRet = rt.cpu.call(0x8002518c, [DST_A, SRC]) >>> 0;
        const portRet = strcpyBytes(rt.mem, DST_B, SRC);
        assert.equal(oracleRet, DST_A, `oracle return "${s}"`);
        assert.equal(portRet, DST_B, `port return "${s}"`);
        assert.deepEqual(bytes(rt, DST_B, WIN), bytes(rt, DST_A, WIN), `bytes "${s}"`);
    }
    assert.equal(rt.cpu.call(0x8002518c, [0, SRC]) | 0, 0);
    assert.equal(rt.cpu.call(0x8002518c, [DST_A, 0]) | 0, 0);
    assert.equal(strcpyBytes(rt.mem, 0, SRC), 0);
    assert.equal(strcpyBytes(rt.mem, DST_B, 0), 0);
});

test("isResourceServiceReady matches the interpreter (F0x800138A8)", () => {
    const rt = runtime();
    for (const v of [0, 1, 0x80000000, 0xffffffff]) {
        rt.mem.write32(RESOURCE_SERVICE_ACTIVE, v >>> 0);
        assert.equal(isResourceServiceReady(rt.mem), rt.cpu.call(0x800138a8, []) | 0, `value ${v}`);
    }
});

test("findFreeCacheSlot matches the interpreter (F0x80013A34)", () => {
    const rt = runtime();
    const clear = () => {
        for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
            for (let b = 0; b < CACHE_SLOT_STRIDE; b += 4) {
                rt.mem.write32(CACHE_SLOTS + i * CACHE_SLOT_STRIDE + b, 0xdeadbeef);
            }
        }
    };
    clear();
    assert.equal(rt.cpu.call(0x80013a34, []) >>> 0, 0);
    assert.equal(findFreeCacheSlot(rt.mem), 0);
    for (const free of [0, 1, 37, 63]) {
        clear();
        rt.mem.write32(CACHE_SLOTS + free * CACHE_SLOT_STRIDE + 4, 0);
        const oracle = rt.cpu.call(0x80013a34, []) >>> 0;
        assert.equal(findFreeCacheSlot(rt.mem), oracle, `free ${free}`);
        assert.equal(oracle, (CACHE_SLOTS + free * CACHE_SLOT_STRIDE) >>> 0, `free ${free} address`);
    }
});

test("setRectColour matches the interpreter (F0x8001E028)", () => {
    const rt = runtime();
    const cases = [[0, 0, 0], [1, 2, 3], [0x100, 0, 0], [0, 0xff, 0], [-1, 0, 0], [0, 0, -1]];
    for (const [r, g, b] of cases) {
        for (let i = 0; i < WIN; i++) {
            rt.mem.write8(OBJ_A + i, 0xaa);
            rt.mem.write8(OBJ_B + i, 0xaa);
        }
        rt.cpu.call(0x8001e028, [OBJ_A, r, g, b]);
        setRectColour(rt.mem, OBJ_B, r, g, b);
        assert.deepEqual(bytes(rt, OBJ_B, WIN), bytes(rt, OBJ_A, WIN), `r=${r} g=${g} b=${b}`);
    }
});

test("findCacheSlotById matches the interpreter (F0x800139FC)", () => {
    const rt = runtime();
    // Fill the 64-slot table with distinct ids, then look for present and absent ones.
    for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
        const slot = CACHE_SLOTS + i * CACHE_SLOT_STRIDE;
        rt.mem.write32(slot + 4, 0x100 + i * 3);
        rt.mem.write32(slot + 0xc, 0x80160000 + i * 0x1000);
        rt.mem.write16(slot + 0, 3);
    }
    for (const id of [0x100, 0x103, 0x100 + 63 * 3, 0x1ff, 0, -1]) {
        const oracle = rt.cpu.call(0x800139fc, [id]) >>> 0;
        assert.equal(findCacheSlotById(rt.mem, id) >>> 0, oracle, `id=0x${(id >>> 0).toString(16)}`);
    }
    // An absent id returns 0 on both sides.
    assert.equal(rt.cpu.call(0x800139fc, [0x77]) >>> 0, 0);
    assert.equal(findCacheSlotById(rt.mem, 0x77), 0);
});

test("freeCacheSlotBlock matches the interpreter (F0x80013EFC)", () => {
    const cases = [
        { id: 0x100, state: 3 },   // resident -> freed
        { id: 0x103, state: 2 },   // in flight -> untouched
        { id: 0x77, state: 0 },    // absent -> untouched
    ];
    for (const kase of cases) {
        const rt = runtime();
        const slot = CACHE_SLOTS + CACHE_SLOT_STRIDE; // slot 1 for the fixture
        rt.mem.write16(slot + 0, 0);
        rt.mem.write16(slot + 2, 0xbeef);
        rt.mem.write32(slot + 4, kase.id);
        rt.mem.write32(slot + 8, 0x11111111);
        rt.mem.write32(slot + 0xc, 0x80160000);
        rt.mem.write16(slot + 0, kase.state);
        const freed = [];
        const freeStub = 0x0fd20000;
        rt.cpu.setStub(freeStub, (c) => {
            freed.push(c.reg(4) >>> 0);
            return 0;
        });
        rt.mem.write32(0x8004b5ec, freeStub);
        rt.cpu.call(0x80013efc, [kase.id]);

        // Port on a copy: the same slot table in a scratch buffer.
        const copy = new Uint8Array(0x1000);
        const base = 0x80170000;
        for (let i = 0; i < 0x1000; i++) copy[i] = rt.mem.read8(base + i);
        const freedPort = [];
        // Replay the fixture into the copy, then read it back the same way.
        // (The copy holds the post-original state, so rebuild the pre-state.)
        for (let i = 0; i < 0x1000; i += 4) rt.mem.write32(base + i, 0);
        rt.mem.write16(base + (slot - CACHE_SLOTS) + 0, 0);
        rt.mem.write16(base + (slot - CACHE_SLOTS) + 2, 0xbeef);
        rt.mem.write32(base + (slot - CACHE_SLOTS) + 4, kase.id);
        rt.mem.write32(base + (slot - CACHE_SLOTS) + 8, 0x11111111);
        rt.mem.write32(base + (slot - CACHE_SLOTS) + 0xc, 0x80160000);
        rt.mem.write16(base + (slot - CACHE_SLOTS) + 0, kase.state);
        const view = {
            read32: (addr) => rt.mem.read32(base + (addr - CACHE_SLOTS)) | 0,
            write32: (addr, value) => rt.mem.write32(base + (addr - CACHE_SLOTS), value),
            write16: (addr, value) => rt.mem.write16(base + (addr - CACHE_SLOTS), value),
        };
        freeCacheSlotBlock(view, kase.id, { freeBlock: (buffer) => freedPort.push(buffer >>> 0) });

        assert.deepEqual(freedPort, freed, `free arguments id=0x${kase.id.toString(16)}`);
        for (let i = 0; i < 0x10; i++) {
            assert.equal(
                rt.mem.read8(base + (slot - CACHE_SLOTS) + i),
                rt.mem.read8(slot + i),
                `slot byte +0x${i.toString(16)} id=0x${kase.id.toString(16)}`,
            );
        }
    }
});
