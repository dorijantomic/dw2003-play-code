// Lane B Phase 4 oracle: engine/dw3/ui/native/name-sequence.ts must match the
// original pro/stdgname naming-screen root tick, sequence and partner-select
// create.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, card services, character model, bank probes, idle shimmer, release
// service and every object method are stubbed on both sides so the ordered calls
// and fields can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    nameScreenSequenceTick,
    nameScreenTick,
    partnerSelectCreate,
} from "../../engine/dw3/ui/native/name-sequence.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const name = new Uint8Array(readFileSync(join(dir, "pro_stdgname.bin")));
const entry = { size: name.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80155000;
const MODEL = 0x80170000;
const PARTNER = 0x80172000;
const SELECT = 0x80174000;

const ALLOC_FN = 0x80014504;
const MODEL_FN = 0x80085364;
const SHIMMER_FN = 0x80086368;
const CARD_INDEX_SLOT = 0x80048d34 + 0x2718;
const CARD_RECORD_SLOT = 0x80048d34 + 0x2750;
const RELEASE_SLOT = 0x80048d34 + 0x270c;
const REQUEST_PTR = 0x80087f40;
const READY_PTR = 0x80087f44;

const CARD_IDX_STUB = 0x0fe20000;
const CARD_REC_STUB = 0x0fe20004;
const RELEASE_STUB = 0x0fe20008;
const REQUEST_STUB = 0x0fe2000c;
const READY_STUB = 0x0fe20010;
const SLOT_BASE = 0x0fe22000;

const SLOT_ARITY = { 0x28: 1, 0x2c: 1, 0x38: 0, 0xf0: 1, 0xf4: 0 };
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
const CONTROL = { alloc: SELECT, ready: 0 };

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(name, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(ALLOC_FN, (c) => { LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return CONTROL.alloc; });
    rt.cpu.setStub(MODEL_FN, (c) => { LOG.push(["model", c.reg(4) | 0, c.reg(5) | 0]); return MODEL; });
    rt.cpu.setStub(SHIMMER_FN, (c) => { LOG.push(["idleShimmer", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(CARD_IDX_STUB, (c) => { LOG.push(["cardIndex", c.reg(4) | 0]); return 4; });
    rt.cpu.setStub(CARD_REC_STUB, (c) => { LOG.push(["cardRecord", c.reg(4) | 0]); return MODEL; });
    rt.cpu.setStub(RELEASE_STUB, (c) => { LOG.push(["release", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(REQUEST_STUB, (c) => { LOG.push(["requestBanks", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(READY_STUB, (c) => { LOG.push(["banksReady", c.reg(4) | 0]); return CONTROL.ready; });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const args = [];
            for (let i = 0; i < SLOT_ARITY[slot]; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }
    rt.mem.write32(CARD_INDEX_SLOT, CARD_IDX_STUB);
    rt.mem.write32(CARD_RECORD_SLOT, CARD_REC_STUB);
    rt.mem.write32(RELEASE_SLOT, RELEASE_STUB);
    rt.mem.write32(REQUEST_PTR, REQUEST_STUB);
    rt.mem.write32(READY_PTR, READY_STUB);
    return rt;
}

function seed(rt, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x10, c.sub ?? 0);
    rt.mem.write32(OBJ + 0x60, c.sixty ?? 0);
    rt.mem.write32(OBJ + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(OBJ + 0x2c, SLOT_BASE + 0x2c);
    rt.mem.write32(OBJ + 0x38, SLOT_BASE + 0x38);

    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(ARG1 + i, 0);
    rt.mem.write32(ARG1 + 0x00, c.arg0 ?? 0);
    rt.mem.write32(ARG1 + 0x04, c.arg4 ?? 0);
    rt.mem.write32(ARG1 + 0x08, c.arg8 ?? PARTNER);
    rt.mem.write32(ARG1 + 0x0c, c.argC ?? 0);
    rt.mem.write32(MODEL + 0x0c, c.modelState ?? 0);
    rt.mem.write32(MODEL + 0x10, c.modelReady ?? 0);
    rt.mem.write32(PARTNER + 0x0c, c.partnerState ?? 0);
    rt.mem.write32(MODEL + 0xf0, SLOT_BASE + 0xf0);
    rt.mem.write32(MODEL + 0xf4, SLOT_BASE + 0xf4);
    rt.mem.write32(0x80087f3c, 0x1234);
    rt.mem.write32(0x8005cca8, 0x801c0000);
    CONTROL.alloc = c.alloc ?? SELECT;
    CONTROL.ready = c.ready ?? 0;
}

function portHost() {
    return {
        allocatePartnerSelect() { LOG.push(["alloc", 0x80085de4 | 0, 0xe0, 0x28]); return CONTROL.alloc; },
        cardIndexOf(cardId) { LOG.push(["cardIndex", cardId | 0]); return 4; },
        cardRecord(index) { LOG.push(["cardRecord", index | 0]); return MODEL; },
        makeCharacterModel(record, index) { LOG.push(["model", record | 0, index | 0]); return MODEL; },
        requestBanks(flag) { LOG.push(["requestBanks", flag | 0]); },
        banksReady(flag) { LOG.push(["banksReady", flag | 0]); return CONTROL.ready; },
        idleShimmer(obj) { LOG.push(["idleShimmer", obj | 0]); },
        releaseService(value, arg) { LOG.push(["release", value | 0, arg | 0]); },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

function fields(rt) {
    const out = [];
    for (const off of [0x0c, 0x10, 0x50, 0x54, 0x60]) out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    out.push(`a1_0=${rt.mem.read32(ARG1) >>> 0}`);
    out.push(`a1_4=${rt.mem.read32(ARG1 + 4) >>> 0}`);
    out.push(`m10=${rt.mem.read32(MODEL + 0x10) >>> 0}`);
    out.push(`m0c=${rt.mem.read32(MODEL + 0x0c) >>> 0}`);
    out.push(`p0c=${rt.mem.read32(PARTNER + 0x0c) >>> 0}`);
    return out;
}

test("partnerSelectCreate matches F0x80086144", () => {
    const rt = runtime();
    seed(rt, { alloc: SELECT });
    CONTROL.alloc = SELECT;
    LOG.length = 0;
    rt.cpu.call(0x80086144, [OBJ], 40000);
    const olog = LOG.slice();
    const ofields = [rt.mem.read32(SELECT + 0x50) >>> 0, rt.mem.read32(SELECT + 0x54) >>> 0];

    seed(rt, { alloc: SELECT });
    CONTROL.alloc = SELECT;
    LOG.length = 0;
    const port = partnerSelectCreate(rt.mem, OBJ, portHost());
    assert.deepEqual(LOG, olog, "calls");
    assert.equal(port, SELECT, "object");
    assert.deepEqual([rt.mem.read32(SELECT + 0x50) >>> 0, rt.mem.read32(SELECT + 0x54) >>> 0], ofields, "fields");
});

test("nameScreenSequenceTick matches F0x80086184", () => {
    const rt = runtime();
    const cases = [
        { name: "sub 0 creates", sub: 0, arg0: 0 },
        { name: "sub 0 already", sub: 0, arg0: SELECT },
        { name: "sub 6 creates", sub: 6, arg0: 0 },
        { name: "sub 1 blocked", sub: 1, arg0: SELECT },
        { name: "sub 1 advance", sub: 1, arg0: 0, sixty: 5 },
        { name: "sub 1 done", sub: 1, arg0: 0, sixty: -1 },
        { name: "sub 2 creates model", sub: 2, arg4: 0 },
        { name: "sub 2 has model", sub: 2, arg4: MODEL },
        { name: "sub 3 waits", sub: 3, arg4: MODEL, modelReady: 0x63 },
        { name: "sub 3 done", sub: 3, arg4: MODEL, modelReady: 0x64 },
        { name: "sub 4 waits", sub: 4, arg4: MODEL, modelState: 1 },
        { name: "sub 4 closes", sub: 4, arg4: MODEL, modelState: 2 },
        { name: "sub 5 waits", sub: 5, arg8: PARTNER, partnerState: 1 },
        { name: "sub 5 closes", sub: 5, arg8: PARTNER, partnerState: 2 },
    ];
    for (const c of cases) {
        seed(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80086184, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const ofields = fields(rt);

        seed(rt, c);
        LOG.length = 0;
        nameScreenSequenceTick(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fields(rt), ofields, `${c.name}: fields`);
    }
});

test("nameScreenTick matches F0x8008645C", () => {
    const rt = runtime();
    const cases = [
        { name: "state 1 runs", state: 1, sub: 0, arg0: 0 },
        { name: "state 2 advances", state: 2, argC: 0 },
        { name: "state 2 holds", state: 2, argC: 1 },
        { name: "state 3 releases", state: 3 },
        { name: "state 0 requests", state: 0, sub: 0 },
        { name: "state 0 sub 2 requests", state: 0, sub: 2 },
        { name: "sub 1 waiting", state: 0, sub: 1, ready: 1 },
        { name: "sub 1 ready", state: 0, sub: 1, ready: 0 },
        { name: "state 4 requests", state: 4, sub: 0 },
    ];
    for (const c of cases) {
        seed(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x8008645c, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const ofields = fields(rt);

        seed(rt, c);
        LOG.length = 0;
        nameScreenTick(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fields(rt), ofields, `${c.name}: fields`);
    }
});
