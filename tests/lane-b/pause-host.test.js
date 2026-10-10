// Lane B Phase 4 oracle: engine/dw3/ui/native/pause-host.ts must match the
// original pro/ststatus pause-host startup family.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// resource/context/pack services, the bank probes, the menu variant, the builder
// table, the draw context, the widget methods and the three factory functions
// are stubbed on both sides so the ordered calls, fields and return values can
// be compared directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { observeUploadContext } from "../helpers/upload-context-observers.js";
import {
    pauseBackdropDraw,
    pauseHostFactory,
    pauseHostTick,
    pauseScreenFactoryDispatch,
    textBanksBusy,
    textBanksRequest,
} from "../../engine/dw3/ui/native/pause-host.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const status = new Uint8Array(readFileSync(join(dir, "pro_ststatus.bin")));
const entry = { size: status.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80160000;
const CREATED = 0x80170000;
const PACK_PTR = 0x80171000;
const STRING_BASE = 0x801c0000;
const SELECT_STATE = 0x8005ccf0;
const BUILDER_TABLE = 0x8009a988;

const RES_CHECK_PTR = 0x80044b38 + 0x404;
const RES_LOAD_PTR = 0x80044b38 + 0x40c;
const PACK_PTR_PTR = 0x80044b38 + 0x424;
const BANK_REQ_PTR = 0x8009b5d0;
const BANK_READY_PTR = 0x8009b5d4;
const VARIANT_PTR = 0x8009b6ec;
const FALLBACK_FN = 0x80091e4c;
const OPEN_FN = 0x8001345c;

const RES_CHECK_STUB = 0x0fdc0000;
const RES_LOAD_STUB = 0x0fdc0004;
const PACK_RESOLVE_STUB = 0x0fdc0008;
const BANK_REQ_STUB = 0x0fdc000c;
const BANK_READY_STUB = 0x0fdc0010;
const VARIANT_STUB = 0x0fdc0014;
const BUILDER_STUB = 0x0fdc0018;
const FALLBACK_STUB = 0x0fdc001c;
const OPEN_STUB = 0x0fdc0020;
const ALLOC_STUB = 0x0fdc0024;
const CLIP_BASE = 0x80010000;
const OBJ_METHOD_28 = 0x0fdc1000;
const OBJ_METHOD_38 = 0x0fdc1004;

const LOG = [];
const LOADED = new Map();
const CONTROL = { ready: 0, variant: 0, builder: 0, fallback: 0, open: 0 };

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(status, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: CLIP_BASE,
    });
    rt.cpu.setStub(RES_CHECK_STUB, (c) => { const id = c.reg(4) | 0; LOG.push(["loaded", id]); return LOADED.get(id >>> 0) ?? 0; });
    rt.cpu.setStub(RES_LOAD_STUB, (c) => { LOG.push(["load", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(PACK_RESOLVE_STUB, (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(BANK_REQ_STUB, (c) => { LOG.push(["requestBanks", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(BANK_READY_STUB, (c) => { LOG.push(["banksReady", c.reg(4) | 0]); return CONTROL.ready; });
    rt.cpu.setStub(VARIANT_STUB, () => { LOG.push(["variant"]); return CONTROL.variant; });
    rt.cpu.setStub(BUILDER_STUB, (c) => { LOG.push(["builder", BUILDER_STUB, c.reg(4) | 0, c.reg(5) | 0]); return CONTROL.builder; });
    rt.cpu.setStub(FALLBACK_FN, (c) => { LOG.push(["fallback", c.reg(4) | 0, c.reg(5) | 0]); return CONTROL.fallback; });
    rt.cpu.setStub(OPEN_FN, (c) => { LOG.push(["open", c.reg(4) | 0, c.reg(5) | 0]); return CONTROL.open; });
    rt.cpu.setStub(0x80014504, () => CREATED);
    observeUploadContext(rt, {
        0x24: (c) => { LOG.push(["snd+0x24", c.reg(4) | 0, c.reg(5) | 0]); return 0; },
        0x28: (c) => { LOG.push(["snd+0x28", c.reg(4) | 0, c.reg(5) | 0]); return 0; },
        0x2c: (c) => { LOG.push(["snd+0x2c", c.reg(4) | 0]); return 0; },
    });
    rt.cpu.setStub(0x8001ecbc, (c) => { LOG.push(["origin", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed34, (c) => { LOG.push(["layer", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed6c, (c) => { LOG.push(["sprite", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
    rt.cpu.setStub(OBJ_METHOD_28, (c) => { LOG.push(["method", c.reg(4) | 0, 0x28, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(OBJ_METHOD_38, (c) => { LOG.push(["method", c.reg(4) | 0, 0x38]); return 0; });

    rt.mem.write32(RES_CHECK_PTR, RES_CHECK_STUB);
    rt.mem.write32(RES_LOAD_PTR, RES_LOAD_STUB);
    rt.mem.write32(PACK_PTR_PTR, PACK_RESOLVE_STUB);
    rt.mem.write32(BANK_REQ_PTR, BANK_REQ_STUB);
    rt.mem.write32(BANK_READY_PTR, BANK_READY_STUB);
    rt.mem.write32(VARIANT_PTR, VARIANT_STUB);
    rt.mem.write32(0x8005cca8, STRING_BASE);
    return rt;
}

function seedObj(rt, obj, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x28, 0x0fdc1000);
    rt.mem.write32(obj + 0x38, 0x0fdc1004);
    rt.mem.write32(obj + 0x0c, c.state ?? 0);
    rt.mem.write32(obj + 0x10, c.sub ?? 0);
    rt.mem.write32(obj + 0x50, c.layer ?? 0x1000);
    rt.mem.write32(obj + 0x54, c.scroll ?? 0);
    rt.mem.write32(obj + 0x58, c.toggle ?? 0);
    rt.mem.write32(obj + 0x60, c.variant ?? 0);
    rt.mem.write32(obj + 0x64, c.packA ?? 0);
    rt.mem.write32(obj + 0x68, c.packB ?? 0);
    rt.mem.write32(obj + 0x6c, c.packC ?? 0);
    rt.mem.write32(obj + 0x70, c.packD ?? 0);
    rt.mem.write32(obj + 0x74, c.packE ?? 0);
}

function seedArg1(rt, arg1, c) {
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(arg1 + i, 0);
    rt.mem.write32(arg1 + 0x00, c.arg0 ?? 0);
    rt.mem.write32(arg1 + 0x04, c.arg4 ?? 0);
}

function clearCreated(rt) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(CREATED + i, 0);
}

function fields(rt, obj) {
    const out = [];
    for (const off of [0x0c, 0x10, 0x50, 0x54, 0x58, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x74]) {
        out.push(`obj+${off.toString(16)}=${rt.mem.read32(obj + off) >>> 0}`);
    }
    out.push(`a1+0=${rt.mem.read32(ARG1 + 0) >>> 0}`);
    out.push(`a1+4=${rt.mem.read32(ARG1 + 4) >>> 0}`);
    return out;
}

function portHost(rt) {
    return {
        resourceLoaded(id) { LOG.push(["loaded", id | 0]); return LOADED.get(id >>> 0) ?? 0; },
        loadResource(id) { LOG.push(["load", id | 0]); },
        packResolve(h) { LOG.push(["pack", h | 0]); return PACK_PTR; },
        requestBanks(flag) { LOG.push(["requestBanks", flag | 0]); },
        banksReady(flag) { LOG.push(["banksReady", flag | 0]); return CONTROL.ready; },
        initMenuContext() {},
        contextMethod(slot, args) { LOG.push([`snd+0x${slot.toString(16)}`, ...args.map((a) => a | 0)]); },
        createHostObject() { return CREATED; },
        menuVariant() { LOG.push(["variant"]); return CONTROL.variant; },
        initDrawContext() {},
        setLayer(x, y) { LOG.push(["layer", x | 0, y | 0]); },
        setOrigin(x, y) { LOG.push(["origin", x | 0, y | 0]); },
        drawSprite(pack, id, x, y) { LOG.push(["sprite", pack | 0, id | 0, x | 0, y | 0]); },
        callFunction(fn, obj, arg) { LOG.push(["builder", fn >>> 0, obj | 0, arg | 0]); return CONTROL.builder; },
        fallback(obj, arg) { LOG.push(["fallback", obj | 0, arg | 0]); return CONTROL.fallback; },
        openSubScreen(value, arg) { LOG.push(["open", value | 0, arg | 0]); return CONTROL.open; },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

function setup(rt, c, obj = OBJ) {
    seedObj(rt, obj, c);
    seedArg1(rt, ARG1, c);
    clearCreated(rt);
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(BUILDER_TABLE + i, 0);
    rt.mem.write32(SELECT_STATE, c.selLo ?? 0);
    rt.mem.write32(SELECT_STATE + 4, c.selHi ?? 0);
    LOADED.clear();
    for (const id of c.loaded ?? []) LOADED.set(id >>> 0, 1);
    CONTROL.ready = c.ready ?? 0;
    CONTROL.variant = c.variant ?? 0;
    CONTROL.builder = c.builder ?? 0;
    CONTROL.fallback = c.fallback ?? 0;
    CONTROL.open = c.open ?? 0;
}

function runOriginal(rt, addr, c) {
    setup(rt, c);
    LOG.length = 0;
    const ret = rt.cpu.call(addr, [OBJ, ARG1], 40000);
    return { log: LOG.slice(), fields: fields(rt), ret: ret | 0 };
}

function runPort(fn, rt, c) {
    setup(rt, c);
    LOG.length = 0;
    const ret = fn(rt.mem, OBJ, ARG1, portHost(rt));
    return { log: LOG.slice(), fields: fields(rt), ret: (ret ?? 0) | 0 };
}

function check(rt, addr, fn, c, name) {
    const o = runOriginal(rt, addr, c);
    const p = runPort(fn, rt, c);
    assert.deepEqual(p.log, o.log, `${name}: calls`);
    assert.deepEqual(p.fields, o.fields, `${name}: fields`);
}

test("textBanksBusy matches F0x80099C64", () => {
    const rt = runtime();
    const cases = [
        { name: "none loaded" },
        { name: "first loaded", loaded: [STRING_BASE + 0xb0] },
        { name: "middle loaded", loaded: [STRING_BASE + 0x4e] },
        { name: "last loaded", loaded: [STRING_BASE + 0x9b] },
        { name: "several loaded", loaded: [STRING_BASE + 0x47, STRING_BASE + 0xa2] },
    ];
    for (const c of cases) {
        setup(rt, c);
        LOG.length = 0;
        const o = rt.cpu.call(0x80099c64, [OBJ, ARG1], 40000) | 0;
        const olog = LOG.slice();
        setup(rt, c);
        LOG.length = 0;
        const p = textBanksBusy(rt.mem, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.equal(p, o, `${c.name}: return`);
    }
});

test("textBanksRequest matches F0x80099B6C", () => {
    const rt = runtime();
    const c = { name: "request" };
    setup(rt, c);
    LOG.length = 0;
    rt.cpu.call(0x80099b6c, [OBJ, ARG1], 40000);
    const olog = LOG.slice();
    setup(rt, c);
    LOG.length = 0;
    textBanksRequest(rt.mem, portHost(rt));
    assert.deepEqual(LOG, olog, "request calls");
    assert.equal(LOG.filter(([m]) => m === "load").length, 7, "seven banks");
});

test("pauseBackdropDraw matches F0x800997D4", () => {
    const rt = runtime();
    const cases = [
        { name: "toggle off first", toggle: 0, scroll: 0 },
        { name: "toggle on advances", toggle: 1, scroll: 5 },
        { name: "toggle on wraps", toggle: 1, scroll: 0x5f },
        { name: "toggle off holds scroll", toggle: 0, scroll: 0x2a, layer: 0x1002 },
    ];
    for (const c of cases) check(rt, 0x800997d4, (m, o, a, h) => pauseBackdropDraw(m, o, h), c, c.name);
});

test("pauseHostFactory matches F0x80099A80", () => {
    const rt = runtime();
    const cases = [
        { name: "variant A", variant: 0 },
        { name: "variant B", variant: 1 },
        { name: "variant other", variant: 7 },
    ];
    for (const c of cases) {
        setup(rt, c);
        LOG.length = 0;
        clearCreated(rt);
        rt.cpu.call(0x80099a80, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const ofields = fields(rt, CREATED);
        setup(rt, c);
        LOG.length = 0;
        clearCreated(rt);
        const pret = pauseHostFactory(rt.mem, portHost(rt)) | 0;
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fields(rt, CREATED), ofields, `${c.name}: fields`);
        assert.equal(pret >>> 0, CREATED, `${c.name}: object`);
    }
});

test("pauseScreenFactoryDispatch matches F0x800996EC", () => {
    const rt = runtime();
    const cases = [
        { name: "build via table", sub: 0, selLo: 1, selHi: 2, arg4: 0, builder: 0x1111 },
        { name: "build via fallback", sub: 0, selLo: 3, selHi: 0, arg4: 0, fallback: 0x2222 },
        { name: "open sub-screen", sub: 1, arg4: 0, open: 0x3333, layer: 0x1000 },
        { name: "already built", sub: 1, arg4: 0x4444 },
    ];
    for (const c of cases) {
        setup(rt, c);
        // Put a table entry only for the first case's index.
        if (c.builder) rt.mem.write32(BUILDER_TABLE + ((c.selHi * 7 + c.selLo) * 4), BUILDER_STUB);
        LOG.length = 0;
        rt.cpu.call(0x800996ec, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const ofields = fields(rt);
        setup(rt, c);
        if (c.builder) rt.mem.write32(BUILDER_TABLE + ((c.selHi * 7 + c.selLo) * 4), BUILDER_STUB);
        LOG.length = 0;
        pauseScreenFactoryDispatch(rt.mem, OBJ, ARG1, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fields(rt), ofields, `${c.name}: fields`);
    }
});

test("pauseHostTick matches F0x80099894", () => {
    const rt = runtime();
    const cases = [
        { name: "state 0 requests banks", state: 0, sub: 0 },
        { name: "state 0 sub 2 requests", state: 0, sub: 2 },
        { name: "sub 1 banks loading", state: 0, sub: 1, ready: 1 },
        { name: "sub 1 pack A loading", state: 0, sub: 1, ready: 0, packA: 111, packB: 222, loaded: [111] },
        { name: "sub 1 reads opens context", state: 0, sub: 1, ready: 0, packA: 111, packB: 222, packC: 333, packD: 444, packE: 555 },
        { name: "state 1 dispatch+backdrop", state: 1, selLo: 0, selHi: 0, layer: 0x1000, toggle: 0 },
        { name: "state 2 waits", state: 2, arg0: 0x9999, toggle: 0 },
        { name: "state 2 to 1", state: 2, arg0: 0, toggle: 1, scroll: 3 },
        { name: "state 3 idle", state: 3 },
        { name: "state 4 requests", state: 4, sub: 0 },
    ];
    for (const c of cases) {
        setup(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80099894, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const ofields = fields(rt);
        setup(rt, c);
        LOG.length = 0;
        pauseHostTick(rt.mem, OBJ, ARG1, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fields(rt), ofields, `${c.name}: fields`);
    }
});
