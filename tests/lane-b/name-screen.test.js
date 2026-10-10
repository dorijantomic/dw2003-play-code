// Lane B Phase 4 oracle: engine/dw3/ui/native/name-screen.ts must match the
// original pro/stdgname naming-screen bodies.
//
//   F0x800865B0  nameScreenCreate
//   F0x800865F0  nameScreenRequestBanks
//   F0x800866AC  nameScreenBanksReady
//   F0x80086368  nameScreenIdleShimmer
//
// The original runs through engine/native (the interpreter) as the oracle. The
// resource descriptor service [0x8004B600], the request context (F0x8001FFA8),
// the pack getter [0x80044F5C] and the request/poll services are stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    nameScreenBanksReady,
    nameScreenCreate,
    nameScreenIdleShimmer,
    nameScreenRequestBanks,
} from "../../engine/dw3/ui/native/name-screen.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const name_ = new Uint8Array(readFileSync(join(dir, "pro_stdgname.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: name_.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const REG_STUB = 0x0fd77000;
const CTX_INIT = 0x8001ffa8;
const CTX24 = 0x0fd77004;
const CTX2C = 0x0fd77008;
const PACK_STUB = 0x0fd7700c;
const REQ_STUB = 0x0fd77010;
const POLL_STUB = 0x0fd77014;
const PACK_PTR = 0x80190000;
const ARITY = { setLayer: 2, setOrigin: 2, drawSprite: 4 };

let POLL = () => 0;
const CALLS = [];

function runtime() {
    const rt = new NativeStageRuntime(name_, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(REG_STUB, (c) => { CALLS.push(["reg", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(CTX_INIT, (c) => {
        const ctx = c.reg(4) >>> 0;
        CALLS.push(["begin"]);
        rt.mem.write32(ctx + 0x24, CTX24);
        rt.mem.write32(ctx + 0x2c, CTX2C);
        return 0;
    });
    rt.cpu.setStub(CTX24, (c) => { CALLS.push(["origin", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(CTX2C, (c) => { CALLS.push(["pack", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(PACK_STUB, (c) => {
        const h = c.reg(4) >>> 0;
        CALLS.push(["packsrc", h | 0]);
        return h === 0x02880000 || h === 0x02890000 ? PACK_PTR : 0;
    });
    rt.cpu.setStub(REQ_STUB, (c) => { CALLS.push(["req", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(POLL_STUB, (c) => { const id = c.reg(4) | 0; CALLS.push(["poll", id]); return POLL(id); });
    rt.mem.write32(0x8004b600, REG_STUB);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x80044f44, REQ_STUB);
    rt.mem.write32(0x80044f3c, POLL_STUB);
    return rt;
}

function norm(list) {
    return list.map(([m, a]) => [m, (a ?? []).slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

test("nameScreenCreate matches F0x800865B0", () => {
    const rt = runtime();
    let HEAP = 0x80191000;
    const allocHost = {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = HEAP;
            HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
    for (let run = 0; run < 3; run++) {
        const a = rt.cpu.call(0x800865b0, []) >>> 0;
        HEAP = 0x80191000;
        const b = nameScreenCreate(rt.mem, allocHost) >>> 0;
        const extraA = rt.mem.read32(a + 0x24) >>> 0;
        const extraB = rt.mem.read32(b + 0x24) >>> 0;
        for (let i = 0; i < 0x10; i++) assert.equal(rt.mem.read8(extraB + i), rt.mem.read8(extraA + i), `extra +0x${i}`);
        for (let off = 0; off < 0x6c; off += 4) {
            if (off === 0x24) continue;
            assert.equal(rt.mem.read32(b + off) >>> 0, rt.mem.read32(a + off) >>> 0, `+0x${off.toString(16)}`);
        }
    }
    const rt2 = runtime();
    const obj = rt2.cpu.call(0x800865b0, []) >>> 0;
    assert.equal(rt2.mem.read32(obj + 0x48) >>> 0, 0x8008645c, "handler");
    assert.equal(rt2.mem.read32(obj + 0x68) >>> 0, 0x8008656c, "+0x68");
    assert.equal(rt2.mem.read32(obj + 0x50) >>> 0, 0x1000, "+0x50");
});

test("nameScreenRequestBanks matches F0x800865F0", () => {
    const rt = runtime();
    rt.mem.write32(0x8005cca8, 2);
    CALLS.length = 0;
    rt.cpu.call(0x800865f0, [], 20000);
    const oracle = CALLS.slice();

    CALLS.length = 0;
    nameScreenRequestBanks(rt.mem, {
        registerResource(d, n) { CALLS.push(["reg", d | 0, n | 0]); },
        beginRequestContext() { CALLS.push(["begin"]); },
        requestContextOrigin(x, y) { CALLS.push(["origin", x | 0, y | 0]); },
        requestContextPack(p) { CALLS.push(["pack", p | 0]); },
        packResolve(h) { CALLS.push(["packsrc", h | 0]); return PACK_PTR; },
        requestBank(id) { CALLS.push(["req", id | 0]); },
        pollBank() { return 0; },
    });
    assert.deepEqual(CALLS, oracle, "ordered request calls");
    // reg + begin + origin + packsrc + pack + 3 banks.
    assert.equal(oracle.length, 8);
});

test("nameScreenBanksReady matches F0x800866AC", () => {
    const rt = runtime();
    rt.mem.write32(0x8005cca8, 2);
    const save = 2;
    for (const pendingList of [[], [0x771], [save + 0x40], [save + 0x86], [0x771, save + 0x86]]) {
        const pending = new Set(pendingList);
        POLL = (id) => (pending.has(id) ? 1 : 0);
        CALLS.length = 0;
        const oracle = rt.cpu.call(0x800866ac, [], 20000) | 0;
        const oracleCalls = CALLS.slice();

        CALLS.length = 0;
        const got = nameScreenBanksReady(rt.mem, {
            beginRequestContext() {},
            requestContextOrigin() {},
            requestContextPack() {},
            packResolve() { return 0; },
            requestBank() {},
            pollBank(id) { CALLS.push(["poll", id | 0]); return POLL(id | 0); },
        }) | 0;
        assert.equal(got, oracle, `pattern ${pendingList.join(",")} result`);
        assert.deepEqual(CALLS, oracleCalls, `pattern ${pendingList.join(",")} poll order`);
    }
});

test("nameScreenIdleShimmer matches F0x80086368", () => {
    const rt = runtime();
    for (const [spin, toggle] of [[0, 0], [5, 1], [0x5e, 1], [0x5f, 1]]) {
        for (const obj of [OBJ_A, OBJ_B]) {
            for (let i = 0; i < 0x60; i += 4) rt.mem.write32(obj + i, 0);
            rt.mem.write32(obj + 0x50, 0x1000);
            rt.mem.write32(obj + 0x58, spin);
            rt.mem.write32(obj + 0x5c, toggle);
        }
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80086368, [OBJ_A], 20000);
        const oracle = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        rt.drawCalls.length = before;

        const intents = [];
        nameScreenIdleShimmer(rt.mem, OBJ_B, {
            initDrawContext() {},
            setLayer(a, b) { intents.push(["setLayer", [a, b]]); },
            setOrigin(a, b) { intents.push(["setOrigin", [a, b]]); },
            drawSprite(a, b, x, y) { intents.push(["drawSprite", [a, b, x, y]]); },
            packResolve(h) { return (h >>> 0) === 0x02880000 ? PACK_PTR : 0; },
        });
        assert.deepEqual(norm(intents), oracle, `spin ${spin} toggle ${toggle}: intents`);
        for (const off of [0x58, 0x5c]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                `spin ${spin} toggle ${toggle}: +0x${off.toString(16)}`);
        }
    }
});
