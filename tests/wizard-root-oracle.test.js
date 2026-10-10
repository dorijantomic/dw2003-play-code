// Phase 4 oracle: engine/dw3/ui/wizard-root.ts must match pro/stplnmet
// F0x800882A4 (create), F0x800882E0 (request banks), F0x80088398 (banks ready)
// and F0x80088138 (tick). The original runs through engine/native with the
// standard-context slots, the pack/bank/audio services, the header builder,
// the sequence, the portrait and the state method stubbed; the port uses an
// equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    wizardRootBanksReady,
    wizardRootCreate,
    wizardRootRequestBanks,
    wizardRootTick,
} from "../engine/dw3/ui/wizard-root.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stplnmet = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stplnmet.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ROOT = 0x80180000;
const ARG1 = 0x80181000;
const SET_STATE = 0x80014274;
const STUBS = {
    alloc: 0x0fe40000, ctxPair24: 0x0fe40010, ctxBind2c: 0x0fe40020,
    packResolve: 0x0fe40030, requestBank: 0x0fe40040, bankPending: 0x0fe40050,
    soundArchive: 0x0fe40060, buildHeaders: 0x0fe40070, sequence: 0x0fe40080,
    portrait: 0x0fe40090, audioPending: 0x0fe400a0, sound: 0x0fe400b0,
    soundExit: 0x0fe400c0, transition: 0x0fe400d0,
};
const OFFSETS = [0x0c, 0x10, 0x50, 0x54, 0x5c];

let EVENTS = [];
let PENDING_ID = 0;
let AUDIO = 0;

function runtime() {
    const rt = new NativeStageRuntime(stplnmet, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        return ROOT;
    });
    rt.cpu.setStub(0x8001ffa8, (c) => {
        const ctx = c.reg(4) >>> 0;
        rt.mem.write32(ctx + 0x24, STUBS.ctxPair24);
        rt.mem.write32(ctx + 0x2c, STUBS.ctxBind2c);
        EVENTS.push(["ctxInstall"]);
        return 0;
    });
    rt.cpu.setStub(STUBS.ctxPair24, (c) => { EVENTS.push(["ctx", 0x24, c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.ctxBind2c, (c) => { EVENTS.push(["ctx", 0x2c, c.reg(4)]); return 0; });
    rt.cpu.setStub(STUBS.packResolve, (c) => { EVENTS.push(["packResolve", c.reg(4)]); return 0x80190000; });
    rt.mem.write32(0x80044f5c, STUBS.packResolve);
    rt.cpu.setStub(STUBS.requestBank, (c) => { EVENTS.push(["requestBank", c.reg(4)]); return 0; });
    rt.mem.write32(0x80044f44, STUBS.requestBank);
    rt.cpu.setStub(STUBS.bankPending, (c) => {
        const id = c.reg(4) >>> 0;
        EVENTS.push(["bankPending", id]);
        return PENDING_ID !== 0 && id === PENDING_ID ? 1 : 0;
    });
    rt.mem.write32(0x80044f3c, STUBS.bankPending);
    rt.cpu.setStub(STUBS.soundArchive, (c) => { EVENTS.push(["soundArchive", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c54, STUBS.soundArchive);
    rt.cpu.setStub(0x80087b14, (c) => { EVENTS.push(["buildHeaders", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x80087c9c, (c) => { EVENTS.push(["sequence", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x80088070, (c) => { EVENTS.push(["portrait", c.reg(4)]); return 0; });
    rt.cpu.setStub(SET_STATE, (c) => {
        const o = c.reg(4);
        rt.mem.write32(o + 0x0c, c.reg(5)); rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        EVENTS.push(["setState", o, c.reg(5)]);
        return 0;
    });
    rt.cpu.setStub(STUBS.audioPending, (c) => { EVENTS.push(["audioPending", c.reg(4)]); return AUDIO; });
    rt.mem.write32(0x80055c60, STUBS.audioPending);
    rt.cpu.setStub(STUBS.sound, (c) => { EVENTS.push(["sound", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c48, STUBS.sound);
    rt.cpu.setStub(STUBS.soundExit, (c) => { EVENTS.push(["soundExit", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c68, STUBS.soundExit);
    rt.cpu.setStub(STUBS.transition, (c) => { EVENTS.push(["transition", c.reg(4), c.reg(5)]); return 0; });
    rt.mem.write32(0x8004b440, STUBS.transition);
    return rt;
}

const rt = runtime();

function seed(o) {
    EVENTS = [];
    PENDING_ID = o.pendingId ?? 0;
    AUDIO = o.audio ?? 0;
    rt.mem.write32(0x8005cca8, o.lang ?? 0x40);
    for (let i = 0; i < 0x6c; i += 4) rt.mem.write32(ROOT + i, 0);
    rt.mem.write32(ROOT + 0x28, SET_STATE);
    rt.mem.write32(ROOT + 0x0c, o.state ?? 0);
    rt.mem.write32(ROOT + 0x10, o.substate ?? 0);
    rt.mem.write32(ROOT + 0x50, o.target ?? 0x1001);
    rt.mem.write32(ROOT + 0x54, o.layer ?? 5);
    rt.mem.write32(ROOT + 0x5c, o.fold ?? 0xdead);
}

function fields() {
    return OFFSETS.map((off) => rt.mem.read32(ROOT + off) >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        allocWizardRoot(handler, size, extra) { EVENTS.push(["alloc", handler, size, extra]); return ROOT; },
        installStandardContext() { EVENTS.push(["ctxInstall"]); return 0; },
        contextCall(slot, a, b) {
            if (slot === 0x2c) EVENTS.push(["ctx", slot, a >>> 0]);
            else EVENTS.push(["ctx", slot, a >>> 0, b]);
        },
        packResolve(handle) { EVENTS.push(["packResolve", handle >>> 0]); return 0x80190000; },
        requestBank(id) { EVENTS.push(["requestBank", id >>> 0]); },
        bankPending(id) {
            const v = id >>> 0;
            EVENTS.push(["bankPending", v]);
            return PENDING_ID !== 0 && v === PENDING_ID ? 1 : 0;
        },
        ensureSoundArchiveLoaded(id) { EVENTS.push(["soundArchive", id]); },
        buildHeaders(obj, arg1) { EVENTS.push(["buildHeaders", obj, arg1]); },
        runSequence(obj, arg1) { EVENTS.push(["sequence", obj, arg1]); },
        drawPortrait(obj) { EVENTS.push(["portrait", obj]); },
        setState(o, phase) {
            rt.mem.write32(o + 0x0c, phase >>> 0); rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            EVENTS.push(["setState", o, phase >>> 0]);
        },
        audioPending(arg) { EVENTS.push(["audioPending", arg]); return AUDIO; },
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
        playSoundExit(id) { EVENTS.push(["soundExit", id >>> 0]); },
        requestTransition(selector, arg) { EVENTS.push(["transition", selector >>> 0, arg]); },
    };
}

function runTick(label, o) {
    seed(o);
    rt.cpu.call(0x80088138, [ROOT, ARG1]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = fields();

    seed(o);
    wizardRootTick(rt.mem, ROOT, ARG1, portHost());
    const portEvents = norm(EVENTS.slice());
    const portFields = fields();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("wizardRootCreate matches F0x800882A4", () => {
    seed({});
    EVENTS = [];
    rt.cpu.call(0x800882a4, []);
    const oracleAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const oracleFields = [0x50, 0x54].map((off) => rt.mem.read32(ROOT + off) >>> 0);

    seed({});
    EVENTS = [];
    const obj = wizardRootCreate(rt.mem, { allocWizardRoot(h, s, e) { EVENTS.push(["alloc", h, s, e]); return ROOT; } });
    assert.equal(obj, ROOT);
    assert.deepEqual(norm(EVENTS.filter((e) => e[0] === "alloc")), oracleAlloc, "alloc");
    assert.deepEqual([0x50, 0x54].map((off) => rt.mem.read32(ROOT + off) >>> 0), oracleFields, "fields");
});

test("wizardRootRequestBanks matches F0x800882E0", () => {
    seed({ lang: 0x40 });
    rt.cpu.call(0x800882e0, []);
    const oracleEvents = norm(EVENTS.slice());
    seed({ lang: 0x40 });
    wizardRootRequestBanks(rt.mem, portHost());
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, "calls");
});

test("wizardRootBanksReady matches F0x80088398", () => {
    const lang = 0x40;
    for (const pendingId of [0, lang + 0x8d, lang + 0x4e, lang + 0x86, 0x771]) {
        seed({ lang, pendingId });
        const oracle = rt.cpu.call(0x80088398, []) | 0;
        const oracleEvents = norm(EVENTS.slice());
        seed({ lang, pendingId });
        const port = wizardRootBanksReady(rt.mem, portHost()) | 0;
        assert.equal(port, oracle, `pending ${pendingId}: return`);
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `pending ${pendingId}: calls`);
    }
});

test("wizardRootTick matches F0x80088138", () => {
    runTick("state 0 requests", { state: 0, substate: 0 });
    runTick("state 0 late substate", { state: 0, substate: 5 });
    runTick("state 4 requests", { state: 4, substate: 0 });
    runTick("state 0 bank 2 pending", { state: 0, substate: 1, pendingId: 0x40 + 0x4e });
    runTick("state 0 banks ready", { state: 0, substate: 1, pendingId: 0 });
    runTick("state 1 live", { state: 1 });
    runTick("state 2 audio pending", { state: 2, audio: 1 });
    runTick("state 2 ready", { state: 2, audio: 0 });
    runTick("state 3 exit", { state: 3 });
});
