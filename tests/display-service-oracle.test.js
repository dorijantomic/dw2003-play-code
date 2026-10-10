// Phase 4 oracle: engine/dw3/display-service.ts must reproduce the original
// service object's fields. The release method [service+0x170] and the heap
// allocator [0x8004B5DC+0x1C] are stubbed to deterministic test hooks on BOTH
// sides, so the service's own writes are what is compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { DISPLAY_SERVICE, DISPLAY_SERVICE_INIT_FLAG, resetDisplayService, setDisplayPacketIndex } from "../engine/dw3/display-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const RELEASE_STUB = 0x80019000;
const ALLOC_STUB = 0x80019010;
const HEAP = 0x8004b5dc;
const ARENA = 0x80190000;

const FIELDS = [0x20, 0x24, 0x28, 0x2c, 0x30, 0x34];

function scenario(stubborn = new Set()) {
    const released = [];
    const releaseCounts = new Map();
    let arena = ARENA;
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.mem.write32(DISPLAY_SERVICE + 0x170, RELEASE_STUB);
    rt.mem.write32(HEAP + 0x1c, ALLOC_STUB);
    const releaseSlot = (handle) => {
        const h = handle >>> 0;
        released.push(h);
        const n = (releaseCounts.get(h) ?? 0) + 1;
        releaseCounts.set(h, n);
        if (stubborn.has(h) && n < 2) return; // a view that only clears on the second release
        for (let i = 0; i < 0x1e; i++) {
            const slot = DISPLAY_SERVICE + i * 4;
            if ((rt.mem.read32(slot + 0xd8) >>> 0) === h) rt.mem.write32(slot + 0x60, 0);
        }
    };
    rt.cpu.setStub(RELEASE_STUB, (c) => { releaseSlot(c.reg(4)); return 0; });
    rt.cpu.setStub(ALLOC_STUB, (c) => {
        const n = c.reg(4) >>> 0;
        const p = arena;
        arena += (n + 0xf) & ~0xf;
        return p;
    });
    const alloc = (size) => {
        const n = size >>> 0;
        const p = arena;
        arena += (n + 0xf) & ~0xf;
        return p;
    };
    return { rt, released, releaseSlot, alloc, resetArena: () => { arena = ARENA; } };
}

function serviceFields(rt) {
    const out = {};
    for (const off of FIELDS) out[`0x${off.toString(16)}`] = rt.mem.read32(DISPLAY_SERVICE + off) >>> 0;
    for (let i = 0; i < 0x1e; i++) out[`slot${i}`] = rt.mem.read32(DISPLAY_SERVICE + i * 4 + 0x60) >>> 0;
    for (const off of [0x38, 0x3c, 0x40]) out[`hdr0x${off.toString(16)}`] = rt.mem.read32(DISPLAY_SERVICE + off) >>> 0;
    return out;
}

function clearService(rt) {
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(DISPLAY_SERVICE + i, 0);
    rt.mem.write32(DISPLAY_SERVICE_INIT_FLAG, 0);
}

test("resetDisplayService matches F0x8001D714 on the first call and the view release", () => {
    // first call: init flag clear
    {
        const a = scenario();
        clearService(a.rt);
        a.rt.cpu.call(0x8001d714, []);
        const fa = serviceFields(a.rt);
        const b = scenario();
        clearService(b.rt);
        resetDisplayService(b.rt.mem, { releaseView: b.releaseSlot, alloc: b.alloc });
        assert.deepEqual(serviceFields(b.rt), fa, "first call");
        assert.equal(b.rt.mem.read32(DISPLAY_SERVICE_INIT_FLAG) >>> 0, 0x1);
    }
    // later call with three registered views; the packet header is dirtied first
    for (const slots of [[0], [0, 3, 5], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x1d]]) {
        const a = scenario();
        clearService(a.rt);
        a.rt.mem.write32(DISPLAY_SERVICE_INIT_FLAG, 1);
        for (let off = 0x20; off < 0x38; off += 4) a.rt.mem.write32(DISPLAY_SERVICE + off, 0xffffffff);
        const b = scenario();
        clearService(b.rt);
        b.rt.mem.write32(DISPLAY_SERVICE_INIT_FLAG, 1);
        for (let off = 0x20; off < 0x38; off += 4) b.rt.mem.write32(DISPLAY_SERVICE + off, 0xffffffff);
        for (const i of slots) {
            a.rt.mem.write32(DISPLAY_SERVICE + i * 4 + 0x60, 0x1111 + i);
            a.rt.mem.write32(DISPLAY_SERVICE + i * 4 + 0xd8, 0xa000 + i);
            b.rt.mem.write32(DISPLAY_SERVICE + i * 4 + 0x60, 0x1111 + i);
            b.rt.mem.write32(DISPLAY_SERVICE + i * 4 + 0xd8, 0xa000 + i);
        }
        a.rt.cpu.call(0x8001d714, []);
        const fa = serviceFields(a.rt);
        resetDisplayService(b.rt.mem, { releaseView: b.releaseSlot, alloc: b.alloc });
        assert.deepEqual(serviceFields(b.rt), fa, `slots ${slots}`);
        assert.deepEqual(
            b.released,
            slots.map((i) => 0xa000 + i),
            `released ${slots}`,
        );
    }
    // a view whose release does not clear its slot on the first call must be
    // retried in place, not skipped
    {
        const stub = new Set([0xa000]);
        const a = scenario(stub);
        clearService(a.rt);
        a.rt.mem.write32(DISPLAY_SERVICE_INIT_FLAG, 1);
        const b = scenario(stub);
        clearService(b.rt);
        b.rt.mem.write32(DISPLAY_SERVICE_INIT_FLAG, 1);
        for (const rt of [a.rt, b.rt]) {
            rt.mem.write32(DISPLAY_SERVICE + 0 * 4 + 0x60, 0x1111);
            rt.mem.write32(DISPLAY_SERVICE + 0 * 4 + 0xd8, 0xa000);
        }
        a.rt.cpu.call(0x8001d714, []);
        const fa = serviceFields(a.rt);
        resetDisplayService(b.rt.mem, { releaseView: b.releaseSlot, alloc: b.alloc });
        assert.deepEqual(serviceFields(b.rt), fa, "stubborn release fields");
        assert.deepEqual(b.released, [0xa000, 0xa000], "stubborn release retries in place");
    }
});

test("setDisplayPacketIndex matches F0x8001D7C4 for both double-buffer words", () => {
    for (const which of [0, 1]) {
        for (const size of [0x100, 0x1000]) {
            const a = scenario();
            clearService(a.rt);
            a.rt.mem.write32(DISPLAY_SERVICE + 0x34, which);
            a.rt.cpu.call(0x8001d7c4, [size]);
            const fa = serviceFields(a.rt);
            assert.equal(fa["0x2c"], size, "oracle stores the size");

            const b = scenario();
            clearService(b.rt);
            b.rt.mem.write32(DISPLAY_SERVICE + 0x34, which);
            setDisplayPacketIndex(b.rt.mem, { releaseView: b.releaseSlot, alloc: b.alloc }, size);
            assert.deepEqual(serviceFields(b.rt), fa, `which=${which} size=${size}`);
            assert.equal(b.rt.mem.read32(DISPLAY_SERVICE + 0x20) >>> 0, b.rt.mem.read32(DISPLAY_SERVICE + (which ? 0x28 : 0x24)) >>> 0);
        }
    }
});
