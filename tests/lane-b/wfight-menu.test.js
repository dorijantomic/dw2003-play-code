// Lane B Phase 4 oracle: engine/dw3/ui/native/wfight-menu.ts must match the
// original pro/wfightmn world fight menu actor family.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, the resource/context services and every actor method are stubbed on
// both sides so the ordered calls and fields can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { observeUploadContext } from "../helpers/upload-context-observers.js";
import { wfightMenuFactory, wfightMenuTick } from "../../engine/dw3/ui/native/wfight-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const wfight = new Uint8Array(readFileSync(join(dir, "pro_wfightmn.bin")));
const entry = { size: wfight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const BASE = 0x800a5de0;

const OBJ = 0x80150000;
const ACTOR = 0x80170000;
const PACK_PTR = 0x80171000;
const RES_PTR = 0x80172000;
const STRING_BASE = 0x801c0000;

const LOADED_PTR = 0x80044b38 + 0x404;
const LOAD_PTR = 0x80044b38 + 0x40c;
const RELEASE_PTR = 0x80044b38 + 0x418;
const BASE_PTR = 0x80044b38 + 0x414;
const PACK_PTR_CELL = 0x80044b38 + 0x424;

const ALLOC_STUB = 0x0fde0000;
const LOADED_STUB = 0x0fde0004;
const LOAD_STUB = 0x0fde0008;
const RELEASE_STUB = 0x0fde000c;
const BASE_STUB = 0x0fde0010;
const PACK_STUB = 0x0fde0014;
const SLOT_BASE = 0x0fde1000;

const SLOT_ARITY = { 0x28: 1, 0x38: 0, 0x3c: 0, 0x40: 0 };
const SLOTS = Object.keys(SLOT_ARITY).map(Number);
const CTX_ARITY = { 0x20: 1, 0x24: 2, 0x2c: 1 };

const LOG = [];
const CONTROL = { loaded: 0 };

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(wfight, entry, host, undefined, undefined, BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(0x80014504, (c) => { LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return ACTOR; });
    rt.cpu.setStub(LOADED_STUB, (c) => { LOG.push(["loaded", c.reg(4) | 0]); return CONTROL.loaded; });
    rt.cpu.setStub(LOAD_STUB, (c) => { LOG.push(["load", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(RELEASE_STUB, (c) => { LOG.push(["release", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(BASE_STUB, (c) => { LOG.push(["base", c.reg(4) | 0]); return RES_PTR; });
    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const args = [];
            for (let i = 0; i < SLOT_ARITY[slot]; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }
    observeUploadContext(rt, Object.fromEntries(Object.keys(CTX_ARITY).map(Number).map(slot => [slot, (c) => {
            const args = [];
            for (let i = 0; i < CTX_ARITY[slot]; i++) args.push(c.reg(4 + i) | 0);
            LOG.push([`ctx+0x${slot.toString(16)}`, ...args]);
            return 0;
        }])));

    rt.mem.write32(LOADED_PTR, LOADED_STUB);
    rt.mem.write32(LOAD_PTR, LOAD_STUB);
    rt.mem.write32(RELEASE_PTR, RELEASE_STUB);
    rt.mem.write32(BASE_PTR, BASE_STUB);
    rt.mem.write32(PACK_PTR_CELL, PACK_STUB);
    return rt;
}

function seed(rt, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(OBJ + 0x38, SLOT_BASE + 0x38);
    rt.mem.write32(OBJ + 0x3c, SLOT_BASE + 0x3c);
    rt.mem.write32(OBJ + 0x40, SLOT_BASE + 0x40);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x10, c.sub ?? 0);
    rt.mem.write32(OBJ + 0x14, c.caseIndex ?? 0);
    rt.mem.write32(STRING_BASE, STRING_BASE);
    rt.mem.write32(0x8005cca8, STRING_BASE);
    CONTROL.loaded = c.loaded ?? 0;
}

function portHost() {
    return {
        allocateActor() { LOG.push(["alloc", 0x800a5ecc | 0, 0x54, 0]); return ACTOR; },
        resourceLoaded(id) { LOG.push(["loaded", id | 0]); return CONTROL.loaded; },
        loadResource(id) { LOG.push(["load", id | 0]); },
        releaseResource(id) { LOG.push(["release", id | 0]); },
        resourceBase(id) { LOG.push(["base", id | 0]); return RES_PTR; },
        packResolve(h) { LOG.push(["pack", h | 0]); return PACK_PTR; },
        initMenuContext() {},
        contextMethod(slot, args) { LOG.push([`ctx+0x${slot.toString(16)}`, ...args.map((a) => a | 0)]); },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

function fields(rt) {
    const out = [];
    for (const off of [0x0c, 0x10, 0x14]) out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    return out;
}

test("wfightMenuFactory matches F0x800A6414", () => {
    const rt = runtime();
    LOG.length = 0;
    rt.cpu.call(0x800a6414, [], 40000);
    const olog = LOG.slice();
    LOG.length = 0;
    const port = wfightMenuFactory(portHost());
    assert.deepEqual(LOG, olog, "calls");
    assert.equal(port, ACTOR, "actor");
});

test("wfightMenuTick matches F0x800A5ECC", () => {
    const rt = runtime();
    const cases = [
        { name: "state 0 default loads", state: 0, sub: 0, caseIndex: 0 },
        { name: "state 0 default high", state: 0, sub: 0, caseIndex: 7 },
        { name: "state 1 case 1 loaded", state: 0, sub: 0, caseIndex: 1, loaded: 1 },
        { name: "state 1 case 1 builds", state: 0, sub: 0, caseIndex: 1, loaded: 0 },
        { name: "state 1 case 2 loaded", state: 0, sub: 0, caseIndex: 2, loaded: 1 },
        { name: "state 1 case 2 builds", state: 0, sub: 0, caseIndex: 2, loaded: 0 },
        { name: "state 1 case 3 builds", state: 0, sub: 0, caseIndex: 3, loaded: 0 },
        { name: "state 1 case 4 builds", state: 0, sub: 0, caseIndex: 4, loaded: 0 },
        { name: "state 1 case 5 builds", state: 0, sub: 0, caseIndex: 5, loaded: 0 },
        { name: "state 1 case 6 releases", state: 0, sub: 0, caseIndex: 6 },
        { name: "sub 1 selection loads", state: 0, sub: 1, caseIndex: 0 },
        { name: "sub 1 selection high loads", state: 0, sub: 1, caseIndex: 5 },
        { name: "sub 1 wait free", state: 0, sub: 1, caseIndex: 1, loaded: 0 },
        { name: "sub 1 wait busy", state: 0, sub: 1, caseIndex: 1, loaded: 1 },
        { name: "state 1 sub 0", state: 1, sub: 0, caseIndex: 0 },
        { name: "state 2 idle", state: 2 },
        { name: "state 3 idle", state: 3 },
        { name: "state 4 dispatches", state: 4, sub: 0, caseIndex: 6 },
    ];
    for (const c of cases) {
        seed(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x800a5ecc, [OBJ], 40000);
        const olog = LOG.slice();
        const ofields = fields(rt);

        seed(rt, c);
        LOG.length = 0;
        wfightMenuTick(rt.mem, OBJ, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fields(rt), ofields, `${c.name}: fields`);
    }
});
