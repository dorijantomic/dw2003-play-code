// Phase 4 oracle: engine/dw3/ui/gym-screen.ts gymScreenConstruct must build the
// same object fields for every map-id branch as the original F0x80085DD8. The
// original runs through engine/native with the object factory and the map-id
// getter stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { gymScreenConstruct } from "../engine/dw3/ui/gym-screen.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgtrain = new Uint8Array(readFileSync(join(dir, "pro_stgtrain.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgtrain.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80190000;
const ALLOC_STUB = 0x0fdb0000;
const MAP_STUB = 0x0fdb0010;

let MAP_ID = 0;
let ALLOC_CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(stgtrain, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80014504, (c) => {
        ALLOC_CALLS.push([c.reg(4), c.reg(5), c.reg(6)]);
        return OBJ;
    });
    
    rt.cpu.setStub(MAP_STUB, () => MAP_ID);
    rt.mem.write32(0x8004b448, MAP_STUB);
    return rt;
}

const rt = runtime();

test("gymScreenConstruct matches F0x80085DD8", () => {
    // One id per branch, including both sides of the binary search.
    const ids = [0x23d, 0x24b, 0x267, 0x28c, 0x2aa, 0x2b5, 0x2cf, 0x23c, 0x23e, 0x24a, 0x268, 0x28b, 0x2ab, 0x2b4, 0x2d0, 0];
    for (const id of ids) {
        MAP_ID = id;
        ALLOC_CALLS = [];
        for (let i = 0; i < 0x114; i += 4) rt.mem.write32(OBJ + i, 0xdead);
        const oracleObj = rt.cpu.call(0x80085dd8, []) >>> 0;
        const oracleCalls = ALLOC_CALLS.slice();
        const oracleFields = [rt.mem.read32(OBJ + 0x110) >>> 0, rt.mem.read32(OBJ + 0x50) >>> 0,
            rt.mem.read32(OBJ + 0x54) >>> 0, rt.mem.read32(OBJ + 0x58) >>> 0];

        ALLOC_CALLS = [];
        for (let i = 0; i < 0x114; i += 4) rt.mem.write32(OBJ + i, 0xdead);
        const portObj = gymScreenConstruct(rt.mem, {
            allocScreen(handler, size, extra) {
                ALLOC_CALLS.push([handler, size, extra]);
                return OBJ;
            },
            currentMapId() { return MAP_ID; },
        }) >>> 0;
        const portCalls = ALLOC_CALLS.slice();
        const portFields = [rt.mem.read32(OBJ + 0x110) >>> 0, rt.mem.read32(OBJ + 0x50) >>> 0,
            rt.mem.read32(OBJ + 0x54) >>> 0, rt.mem.read32(OBJ + 0x58) >>> 0];

        assert.deepEqual(portCalls.map((a) => a.map((v) => v >>> 0)), oracleCalls.map((a) => a.map((v) => v >>> 0)), `id 0x${id.toString(16)}: alloc args`);
        assert.deepEqual(portFields, oracleFields, `id 0x${id.toString(16)}: fields`);
        assert.equal(portObj >>> 0, oracleObj >>> 0);
    }
});
