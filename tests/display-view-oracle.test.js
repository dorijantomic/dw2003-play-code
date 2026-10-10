// Phase 4 oracle: engine/dw3/display-service.ts initDisplayView (F0x8001E5BC)
// must reproduce the view object the original builds. The two allocators and the
// ordering-table clear are stubbed on BOTH sides with deterministic hooks at the
// same arena, so the view's whole 0x16C bytes are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    DISPLAY_ALLOC_ZEROED,
    DISPLAY_HEAP_ALLOC,
    initDisplayView,
    VIEW_METHODS,
    VIEW_SIZE,
} from "../engine/dw3/display-service.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ZSTUB = 0x80019000;
const ASTUB = 0x80019010;
const CLEAR_STUB = 0x80019020;
const ARENA = 0x80190000;
const DRAW_ENV = 0x80191000;

function scenario() {
    const calls = [];
    let arena = ARENA;
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    const bump = (size, zero) => {
        const n = (size >>> 0 + 0) >>> 0;
        const p = arena;
        arena += (n + 0xf) & ~0xf;
        if (zero) for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
        return p;
    };
    rt.cpu.setStub(ZSTUB, (c) => bump(c.reg(4), true));
    rt.cpu.setStub(ASTUB, (c) => bump(c.reg(4), false));
    // the original calls F0x80025D54 directly, so the hook goes on that address
    rt.cpu.setStub(0x80025d54, (c) => { calls.push([c.reg(4) >>> 0, c.reg(5) | 0]); return 0; });
    rt.mem.write32(DISPLAY_ALLOC_ZEROED, ZSTUB);
    rt.mem.write32(DISPLAY_HEAP_ALLOC, ASTUB);
    const hostHooks = {
        releaseView() {},
        alloc: (size) => bump(size, false),
        allocZeroed: (size) => bump(size, true),
        clearOTag: (base, n) => { calls.push([base >>> 0, n | 0]); },
    };
    return { rt, calls, hostHooks, resetArena: () => { arena = ARENA; } };
}

function seedEnv(rt) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(DRAW_ENV + i, (0x11111111 * (i + 1)) >>> 0);
}

function viewBytes(rt, view) {
    const out = [];
    for (let i = 0; i < VIEW_SIZE; i += 4) out.push(rt.mem.read32(view + i) >>> 0);
    return out;
}

test("initDisplayView matches F0x8001E5BC", () => {
    for (const pool of [1, 2, 3, 4, 5, 6]) {
        const a = scenario();
        seedEnv(a.rt);
        const viewA = a.rt.cpu.call(0x8001e5bc, [DRAW_ENV, pool]) >>> 0;
        const bytesA = viewBytes(a.rt, viewA);
        assert.notEqual(viewA, 0);

        const b = scenario();
        seedEnv(b.rt);
        const viewB = initDisplayView(b.rt.mem, b.hostHooks, DRAW_ENV, pool) >>> 0;
        assert.deepEqual(viewBytes(b.rt, viewB), bytesA, `pool=${pool} view bytes`);
        assert.deepEqual(b.calls, a.calls, `pool=${pool} clear calls`);
        // the method table is the original's own addresses
        for (const [off, addr] of VIEW_METHODS) {
            assert.equal(b.rt.mem.read32(viewB + off) >>> 0, addr >>> 0, `pool=${pool} method +0x${off.toString(16)}`);
        }
        // the copied draw env is the caller's bytes
        for (let i = 0; i < 0x5c; i += 4) {
            assert.equal(b.rt.mem.read32(viewB + i) >>> 0, b.rt.mem.read32(DRAW_ENV + i) >>> 0, `pool=${pool} env +0x${i.toString(16)}`);
        }
    }
});
