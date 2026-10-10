// Phase 4 oracle: engine/dw3/ui/memcard-root.ts create / identity / banks-ready
// must match pro/stgmcard F0x80087B08 / F0x80087C18 / F0x80087DF0. The original
// runs through engine/native with the save-context getters, the resident
// context/fetcher/allocator services and the pack/bank services stubbed; the
// port uses an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    memcardRootBanksReady,
    memcardRootCreate,
    memcardRootIdentity,
} from "../engine/dw3/ui/memcard-root.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgmcard = new Uint8Array(readFileSync(join(dir, "pro_stgmcard.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgmcard.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const STATE = 0x80181000;
const SHEET = 0x80182000;
const BASE = 0x80183000;
const FETCHED = 0x80184000;
const ALLOC_BASE = 0x80185000;
const SAVE_CTX = 0x80048d34;
const STUBS = {
    alloc: 0x0fe10000, cat: 0x0fe10010, side: 0x0fe10020, prev: 0x0fe10030,
    sound: 0x0fe10040, origin: 0x0fe10050, bind: 0x0fe10060, fetch: 0x0fe10070,
    push: 0x0fe10080, saveHeader: 0x0fe10090, free: 0x0fe100a0,
    allocBuf: 0x0fe100b0, requestBank: 0x0fe100c0, bankPending: 0x0fe100d0,
    packResolve: 0x0fe100e0, resourceBase: 0x0fe100f0, initState: 0x0fe10100,
    install: 0x0fe10110, initFetcher: 0x0fe10120,
};
const STAGING = 0x80088768;

let EVENTS = [];
let CATEGORY = 0x40;
let SIDE = 0x40;
let PREVIOUS = 0x200;
let PENDING = 0;
let ALLOC_NEXT = 0;
let FREE_NEXT = 0;

function runtime() {
    const rt = new NativeStageRuntime(stgmcard, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        return OBJ;
    });
    rt.cpu.setStub(STUBS.cat, () => { EVENTS.push(["selectorCategory"]); return CATEGORY; });
    rt.mem.write32(SAVE_CTX + 0x2704, STUBS.cat);
    rt.cpu.setStub(STUBS.side, () => { EVENTS.push(["sideBit"]); return SIDE; });
    rt.mem.write32(SAVE_CTX + 0x2708, STUBS.side);
    rt.cpu.setStub(STUBS.prev, () => { EVENTS.push(["previousSelector"]); return PREVIOUS; });
    rt.mem.write32(SAVE_CTX + 0x2714, STUBS.prev);
    rt.cpu.setStub(STUBS.sound, (c) => { EVENTS.push(["requestSound", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c54, STUBS.sound);
    // identity services
    rt.cpu.setStub(STUBS.install, (c) => {
        const ctx = c.reg(4) >>> 0;
        rt.mem.write32(ctx + 0x24, STUBS.origin);
        rt.mem.write32(ctx + 0x2c, STUBS.bind);
        rt.mem.write32(ctx + 0x38, STUBS.fetch);
        rt.mem.write32(ctx + 0x40, STUBS.push);
        EVENTS.push(["ctxInstall"]);
        return 0;
    });
    rt.cpu.setStub(0x8001ffa8, (c) => {
        const ctx = c.reg(4) >>> 0;
        rt.mem.write32(ctx + 0x24, STUBS.origin);
        rt.mem.write32(ctx + 0x2c, STUBS.bind);
        rt.mem.write32(ctx + 0x38, STUBS.fetch);
        rt.mem.write32(ctx + 0x40, STUBS.push);
        EVENTS.push(["ctxInstall"]);
        return 0;
    });
    rt.cpu.setStub(STUBS.origin, (c) => { EVENTS.push(["origin", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.bind, (c) => { EVENTS.push(["bind", c.reg(4)]); return 0; });
    rt.cpu.setStub(STUBS.fetch, (c) => { EVENTS.push(["fetch", c.reg(4), c.reg(5)]); return FETCHED; });
    rt.cpu.setStub(STUBS.push, (c) => { EVENTS.push(["push", c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(STUBS.saveHeader, (c) => {
        const rec = c.reg(7) >>> 0;
        EVENTS.push(["saveHeader", c.reg(5), c.reg(6), rt.mem.read32(rec), rt.mem.read32(rec + 4), rt.mem.read32(rec + 8)]);
        return 0;
    });
    rt.mem.write32(0x80048a80, STUBS.saveHeader);
    rt.cpu.setStub(STUBS.free, (c) => { EVENTS.push(["free", c.reg(4)]); FREE_NEXT++; return 0; });
    rt.mem.write32(0x8004b5dc + 0x10, STUBS.free);
    rt.cpu.setStub(STUBS.allocBuf, (c) => {
        EVENTS.push(["allocBuffer", c.reg(4), c.reg(5)]);
        const p = (ALLOC_BASE + (ALLOC_NEXT++ % 8) * 0x100) >>> 0;
        return p;
    });
    rt.mem.write32(0x8004b5dc + 0x18, STUBS.allocBuf);
    rt.cpu.setStub(STUBS.initState, (c) => { EVENTS.push(["initState", c.reg(5)]); return STATE; });
    rt.mem.write32(0x8004b5dc + 0x24, STUBS.initState);
    rt.cpu.setStub(0x8001fcc0, () => { EVENTS.push(["initFetcher"]); return 0; });
    rt.cpu.setStub(STUBS.packResolve, (c) => { EVENTS.push(["packResolve", c.reg(4)]); return SHEET; });
    rt.mem.write32(0x80044f5c, STUBS.packResolve);
    rt.cpu.setStub(STUBS.resourceBase, (c) => { EVENTS.push(["resourceGetBase", c.reg(4)]); return BASE; });
    rt.mem.write32(0x80044f4c, STUBS.resourceBase);
    rt.cpu.setStub(STUBS.requestBank, (c) => { EVENTS.push(["requestBank", c.reg(4)]); return 0; });
    rt.mem.write32(0x80044f44, STUBS.requestBank);
    rt.cpu.setStub(STUBS.bankPending, (c) => { EVENTS.push(["bankPending", c.reg(4)]); return PENDING; });
    rt.mem.write32(0x80044f3c, STUBS.bankPending);
    return rt;
}

const rt = runtime();

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function seedShared(o) {
    rt.mem.write32(STAGING + 0x0c, o.sidePtr ?? 0);
    rt.mem.write32(STAGING + 0x10, o.mainPtr ?? 0);
    rt.mem.write32(STAGING + 0x14, o.sideSize ?? 0xdead);
    rt.mem.write32(STAGING + 0x18, o.mainSize ?? 0xdead);
}

function sharedFields() {
    return [0x0c, 0x10, 0x14, 0x18].map((off) => rt.mem.read32(STAGING + off) >>> 0);
}

function portHost() {
    return {
        allocRoot(handler, size, extra) { EVENTS.push(["alloc", handler, size, extra]); return OBJ; },
        selectorCategory() { EVENTS.push(["selectorCategory"]); return CATEGORY; },
        sideBit() { EVENTS.push(["sideBit"]); return SIDE; },
        previousSelector() { EVENTS.push(["previousSelector"]); return PREVIOUS; },
        requestSoundArchive(id) { EVENTS.push(["requestSound", id >>> 0]); },
        installStandardContext() { EVENTS.push(["ctxInstall"]); return 0; },
        contextSetOrigin(ctx, x, y) { EVENTS.push(["origin", x, y]); },
        packResolve(handle) { EVENTS.push(["packResolve", handle >>> 0]); return SHEET; },
        contextBindSheet(ctx, handle) { EVENTS.push(["bind", handle >>> 0]); },
        initStateContext(kind) { EVENTS.push(["initState", kind]); return STATE; },
        initFetcher() { EVENTS.push(["initFetcher"]); },
        resourceGetBase(id) { EVENTS.push(["resourceGetBase", id >>> 0]); return BASE; },
        fetchTableEntry(base, index) { EVENTS.push(["fetch", base >>> 0, index]); return FETCHED; },
        contextPush(ctx, value, flag) { EVENTS.push(["push", value >>> 0, flag]); },
        saveBuildHeader(ctx, a1, a2, r0, r1, r2) {
            EVENTS.push(["saveHeader", a1 >>> 0, a2, r0 >>> 0, r1 >>> 0, r2 >>> 0]);
        },
        freeBuffer(ptr) { EVENTS.push(["free", ptr >>> 0]); },
        allocBuffer(size, mode) {
            EVENTS.push(["allocBuffer", size, mode]);
            return (ALLOC_BASE + (ALLOC_NEXT++ % 8) * 0x100) >>> 0;
        },
        requestBank(id) { EVENTS.push(["requestBank", id >>> 0]); },
        bankPending(id) { EVENTS.push(["bankPending", id >>> 0]); return PENDING; },
    };
}

function resetEvents() { EVENTS = []; ALLOC_NEXT = 0; FREE_NEXT = 0; }

function runCreate(label, o) {
    CATEGORY = o.category ?? 0x40; SIDE = o.side ?? 0x40; PREVIOUS = o.previous ?? 0x200;
    for (let i = 0; i < 0x70; i += 4) rt.mem.write32(OBJ + i, 0);
    resetEvents();
    rt.cpu.call(0x80087b08, []);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = [0x50, 0x54, 0x68, 0x6c].map((off) => rt.mem.read32(OBJ + off) >>> 0);

    for (let i = 0; i < 0x70; i += 4) rt.mem.write32(OBJ + i, 0);
    resetEvents();
    memcardRootCreate(rt.mem, portHost());
    const portEvents = norm(EVENTS.slice());
    const portFields = [0x50, 0x54, 0x68, 0x6c].map((off) => rt.mem.read32(OBJ + off) >>> 0);

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("memcardRootCreate matches F0x80087B08", () => {
    runCreate("first entry", { previous: 512 });
    runCreate("later entry", { previous: 515 });
    runCreate("no match", { previous: 0x7fff });
    runCreate("region 2", { category: 2, previous: 513 });
    runCreate("negative side", { side: 0x80000000, previous: 520 });
    runCreate("japanese side", { side: 0, category: 0, previous: 527 });
});

function runIdentity(label, o) {
    rt.mem.write32(0x8005cca8, 0x40);
    seedShared(o);
    resetEvents();
    rt.cpu.call(0x80087c18, []);
    const oracleEvents = norm(EVENTS.slice());
    const oracleShared = sharedFields();

    seedShared(o);
    resetEvents();
    memcardRootIdentity(rt.mem, portHost());
    const portEvents = norm(EVENTS.slice());
    const portShared = sharedFields();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portShared, oracleShared, `${label}: shared`);
}

function runBanks(label, pending) {
    PENDING = pending;
    resetEvents();
    const oracle = rt.cpu.call(0x80087df0, []) | 0;
    const oracleEvents = norm(EVENTS.slice());
    resetEvents();
    const port = memcardRootBanksReady(rt.mem, portHost()) | 0;
    assert.equal(port, oracle, `${label}: return`);
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
}

test("memcardRootIdentity matches F0x80087C18", () => {
    runIdentity("fresh buffers", {});
    runIdentity("reallocating", { mainPtr: 0x80190000, sidePtr: 0x80191000 });
    runIdentity("stale main only", { mainPtr: 0x80192000 });
    runIdentity("stale side only", { sidePtr: 0x80193000 });
});

test("memcardRootBanksReady matches F0x80087DF0", () => {
    runBanks("all loaded", 0);
    runBanks("pending", 1);
});
