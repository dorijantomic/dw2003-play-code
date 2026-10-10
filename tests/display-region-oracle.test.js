// Phase 4 oracle: engine/dw3/display-service.ts setDisplayRegion (F0x8001D8CC)
// and registerDisplayView (F0x8001DBE0) must reproduce the original's writes.
//
// Every device boundary is hooked on BOTH sides at the same point: the GPU
// driver's GsInit3D / setGeomOffset tails of the region setter, and the two
// allocators plus the ordering-table clear inside the view constructor. The
// registration's 0x5C-byte DRAWENV scratch is the original's own stack slot, so
// the test seeds the same bytes at both addresses and compares the whole view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    DISPLAY_ALLOC_ZEROED,
    DISPLAY_HEAP_ALLOC,
    DISPLAY_SERVICE,
    VIEW_SIZE,
    registerDisplayView,
    setDisplayRegion,
} from "../engine/dw3/display-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const GS_INIT = 0x8002990c;
const SET_GEOM = 0x8002b3ec;
const ZSTUB = 0x80019010;
const ASTUB = 0x80019020;
const ARENA = 0x80190000;
const ENV_SCRATCH = 0x80191000;
const RECT = 0x80191100;
const SP0 = 0x801ff000;
/** The original's stack slot for the DRAWENV: sp - 0x90 + 0x18. */
const STACK_ENV = (SP0 - 0x90 + 0x18) >>> 0;

/** The memory the region setter may touch: the service object and the alt base. */
const REGION_SPANS = [
    [DISPLAY_SERVICE, 0x80],
];

function snapshot(rt) {
    const out = [];
    for (const [base, len] of REGION_SPANS) {
        for (let i = 0; i < len; i += 4) out.push(rt.mem.read32(base + i) >>> 0);
    }
    return out;
}

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function regionScenario(flag, args) {
    const rt = runtime();
    const calls = [];
    rt.cpu.setStub(GS_INIT, () => { calls.push("gs"); return 0; });
    rt.cpu.setStub(SET_GEOM, (c) => { calls.push(`geom:${c.reg(4) | 0},${c.reg(5) | 0}`); return 0; });
    rt.mem.write32(0x8005ccb0, flag >>> 0);
    return { rt, calls, args };
}

test("setDisplayRegion matches F0x8001D8CC in all four argument shapes", () => {
    const shapes = [
        { name: "a2!=0 a3!=0", args: [0x100, 0x80, 1, 1] },
        { name: "a2!=0 a3==0", args: [0x140, 0x1e0, 1, 0] },
        { name: "a2==0 a3!=0", args: [0x140, 0x1e0, 0, 1] },
        { name: "a2==0 a3==0", args: [0x100, 0x80, 0, 0] },
        { name: "a2!=0 a3==0 negative w", args: [0xfffffec0 | 0, 0x1e0, 1, 0] },
    ];
    for (const flag of [0, 0x10]) {
        for (const shape of shapes) {
            const a = regionScenario(flag, shape.args);
            const before = snapshot(a.rt);
            a.rt.cpu.call(0x8001d8cc, shape.args);
            const after = snapshot(a.rt);

            const b = regionScenario(flag, shape.args);
            const bBefore = snapshot(b.rt);
            const portCalls = [];
            setDisplayRegion(b.rt.mem, {
                gsInit3D: () => portCalls.push("gs"),
                setGeomOffset: (x, y) => portCalls.push(`geom:${x | 0},${y | 0}`),
            }, ...shape.args);
            const bAfter = snapshot(b.rt);

            assert.deepEqual(bBefore, before, `${shape.name} flag=${flag} seeded state`);
            assert.deepEqual(bAfter, after, `${shape.name} flag=${flag} memory`);
            assert.deepEqual(portCalls, a.calls, `${shape.name} flag=${flag} device calls`);
            // the DISPENVs really changed (the oracle is not vacuous)
            assert.notDeepEqual(after, before, `${shape.name} flag=${flag} wrote something`);
        }
    }
});

test("registerDisplayView matches F0x8001DBE0", () => {
    const cases = [
        { name: "free slot 0", rect: [0x10, 0x20, 0x40, 0x30], pool: 1, handle: 0x1234, occupy: 0, mode: 1 },
        { name: "slot 0 taken -> slot 1", rect: [0, 0, 0x140, 0x1e0], pool: 6, handle: 0x99, occupy: 1, mode: 0 },
        { name: "mode 0, h above 0x100", rect: [-0x10, 0x120, 0x140, 0x120], pool: 2, handle: 7, occupy: 0, mode: 0 },
        { name: "no free slot", rect: [1, 2, 3, 4], pool: 3, handle: 5, occupy: 30, mode: 1 },
        { name: "negative h, mode 1", rect: [0, 0, 0x140, -0x100], pool: 4, handle: 3, occupy: 0, mode: 1 },
        { name: "negative h, mode 0", rect: [0, 0, 0x140, -0x100], pool: 4, handle: 3, occupy: 0, mode: 0 },
    ];
    for (const tc of cases) {
        // original: the registration builds its DRAWENV at sp-0x78, so seed that
        // exact slot with a known pattern and let the port use the same bytes.
        const pattern = [];
        for (let i = 0; i < 0x5c; i += 4) pattern.push((0xa5a5a5a5 ^ (i * 0x01010101)) >>> 0);

        const callsA = [];
        const a = runtime();
        let arenaA = ARENA;
        const bumpA = (size, zero) => {
            const p = arenaA;
            arenaA += (size + 0xf) & ~0xf;
            if (zero) for (let x = p; x < p + size; x += 4) a.mem.write32(x, 0);
            return p;
        };
        a.cpu.sp = SP0;
        a.cpu.setStub(ZSTUB, (c) => bumpA(c.reg(4) >>> 0, true));
        a.cpu.setStub(ASTUB, (c) => bumpA(c.reg(4) >>> 0, false));
        a.cpu.setStub(0x80025d54, (c) => { callsA.push(`clear:${c.reg(4) >>> 0},${c.reg(5) | 0}`); return 0; });
        a.mem.write32(DISPLAY_ALLOC_ZEROED, ZSTUB);
        a.mem.write32(DISPLAY_HEAP_ALLOC, ASTUB);
        a.mem.write32(0x8005c058, tc.mode);
        for (let i = 0; i < 0x5c; i += 4) a.mem.write32(STACK_ENV + i, pattern[i / 4]);
        for (let i = 0; i < tc.occupy; i++) {
            a.mem.write32(DISPLAY_SERVICE + i * 4 + 0x60, 0x80000000 + i);
            a.mem.write32(DISPLAY_SERVICE + i * 4 + 0xd8, 0x100 + i);
        }
        for (let i = 0; i < 4; i++) a.mem.write16(RECT + i * 2, tc.rect[i] & 0xffff);

        const retA = a.cpu.call(0x8001dbe0, [RECT, tc.pool, tc.handle]) >>> 0;
        const slotA = [];
        for (let i = 0; i < 0x1e; i++) {
            slotA.push(a.mem.read32(DISPLAY_SERVICE + i * 4 + 0x60) >>> 0);
            slotA.push(a.mem.read32(DISPLAY_SERVICE + i * 4 + 0xd8) >>> 0);
        }
        const bytesA = [];
        if (retA !== 0) for (let i = 0; i < VIEW_SIZE; i += 4) bytesA.push(a.mem.read32(retA + i) >>> 0);
        const envA = [];
        for (let i = 0; i < 0x5c; i += 4) envA.push(a.mem.read32(STACK_ENV + i) >>> 0);

        // port: same scenario, the port's scratch pre-seeded with the same bytes
        const callsB = [];
        const b = runtime();
        let arenaB = ARENA;
        const bumpB = (size, zero) => {
            const p = arenaB;
            arenaB += (size + 0xf) & ~0xf;
            if (zero) for (let x = p; x < p + size; x += 4) b.mem.write32(x, 0);
            return p;
        };
        b.mem.write32(0x8005c058, tc.mode);
        for (let i = 0; i < 0x5c; i += 4) b.mem.write32(ENV_SCRATCH + i, pattern[i / 4]);
        for (let i = 0; i < tc.occupy; i++) {
            b.mem.write32(DISPLAY_SERVICE + i * 4 + 0x60, 0x80000000 + i);
            b.mem.write32(DISPLAY_SERVICE + i * 4 + 0xd8, 0x100 + i);
        }
        for (let i = 0; i < 4; i++) b.mem.write16(RECT + i * 2, tc.rect[i] & 0xffff);
        const retB = registerDisplayView(b.mem, {
            releaseView() {},
            alloc: (size) => bumpB(size >>> 0, false),
            allocZeroed: (size) => bumpB(size >>> 0, true),
            clearOTag: (base, n) => { callsB.push(`clear:${base >>> 0},${n | 0}`); },
        }, ENV_SCRATCH, RECT, tc.pool, tc.handle) >>> 0;

        assert.equal(retB, retA, `${tc.name} return`);
        const slotB = [];
        for (let i = 0; i < 0x1e; i++) {
            slotB.push(b.mem.read32(DISPLAY_SERVICE + i * 4 + 0x60) >>> 0);
            slotB.push(b.mem.read32(DISPLAY_SERVICE + i * 4 + 0xd8) >>> 0);
        }
        assert.deepEqual(slotB, slotA, `${tc.name} service slots`);
        if (retA !== 0) {
            const bytesB = [];
            for (let i = 0; i < VIEW_SIZE; i += 4) bytesB.push(b.mem.read32(retB + i) >>> 0);
            assert.deepEqual(bytesB, bytesA, `${tc.name} view bytes`);
        }
        const envB = [];
        for (let i = 0; i < 0x5c; i += 4) envB.push(b.mem.read32(ENV_SCRATCH + i) >>> 0);
        assert.deepEqual(envB, envA, `${tc.name} draw env`);
        assert.deepEqual(callsB, callsA, `${tc.name} clear calls`);
        if (tc.occupy === 30) assert.equal(retA, 0, `${tc.name} returns 0 with no free slot`);
    }
});
