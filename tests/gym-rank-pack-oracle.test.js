// Phase 4 oracle: engine/dw3/ui/gym-rank-pack.ts must match pro/stgtrain
// F0x8008B8A4. The original runs through engine/native on the shipped
// pro_stgtrain.bin + resident.bin with the resident artwork context's two
// method slots and the pack resolver recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { GYM_RANK_PACK, gymBindRankPack } from "../engine/dw3/ui/gym-rank-pack.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stgtrain.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const CTX = 0x80190000;
const RECT_STUB = 0x0fe10000;
const PACK_BIND_STUB = 0x0fe10010;
const PACK_RESOLVE_STUB = 0x0feb0000;
const PACK_PTR = 0x801a0000;

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    // F0x8001FFA8 fills the caller's 0x34-byte context; arm its two method
    // slots at the fixed address the original's stack frame is replaced with.
    rt.cpu.setStub(0x8001ffa8, (c) => {
        const ctx = c.reg(4) >>> 0;
        rt.mem.write32(ctx + 0x24, RECT_STUB);
        rt.mem.write32(ctx + 0x2c, PACK_BIND_STUB);
        return 0;
    });
    rt.cpu.setStub(RECT_STUB, (c) => {
        EVENTS.push(["rect", 0x24, c.reg(4) | 0, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(PACK_BIND_STUB, (c) => {
        EVENTS.push(["pack", 0x2c, c.reg(4) >>> 0, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(PACK_RESOLVE_STUB, (c) => { EVENTS.push(["resolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_RESOLVE_STUB);
    return rt;
}

const rt = runtime();

function portHost() {
    return {
        bindRect(slot, x, y) { EVENTS.push(["rect", slot | 0, x | 0, y | 0]); },
        bindPack(slot, pack, a1) { EVENTS.push(["pack", slot | 0, pack >>> 0, a1 | 0]); },
        packResolve(h) { EVENTS.push(["resolve", h >>> 0]); return PACK_PTR; },
    };
}

test("gymBindRankPack matches F0x8008B8A4", () => {
    for (let run = 0; run < 3; run++) {
        EVENTS = [];
        rt.cpu.call(0x8008b8a4, []);
        const oracle = EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v)));
        assert.ok(oracle.length > 0, "the original issued no calls");

        EVENTS = [];
        gymBindRankPack(portHost());
        assert.deepEqual(EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v | 0 : v))), oracle,
            `run ${run}: calls`);
    }
});

test("the bound pack and rectangle are the decoded ones", () => {
    assert.equal(GYM_RANK_PACK, 0x028d0000);
    EVENTS = [];
    gymBindRankPack(portHost());
    assert.deepEqual(EVENTS, [["rect", 0x24, 0x240, 0x100], ["resolve", 0x028d0000], ["pack", 0x2c, PACK_PTR, 0x100]]);
});
