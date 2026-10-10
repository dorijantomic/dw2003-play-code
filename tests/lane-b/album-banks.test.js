// Lane B Phase 4 oracle: engine/dw3/ui/native/album-banks.ts must match the
// original pro/stcrdabm text-bank loader.
//
//   F0x800856A8  albumRequestTextBanks
//   F0x800857A0  albumTextBanksPending
//
// The original runs through engine/native (the interpreter) as the oracle. The
// request context (F0x8001FFA8), the pack getter [0x80044F5C] and the resident
// request/poll services [0x80044F44]/[0x80044F3C] are stubs, so the ordered
// call sequence and the pending result can be compared directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    albumRequestTextBanks,
    albumTextBanksPending,
} from "../../engine/dw3/ui/native/album-banks.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const album = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: album.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const CTX_INIT = 0x8001ffa8;
const CTX24 = 0x0fd74000;
const CTX2C = 0x0fd74004;
const PACK_STUB = 0x0fd74008;
const REQ_STUB = 0x0fd7400c;
const POLL_STUB = 0x0fd74010;
const PACK_PTR = 0x80190000;

const CALLS = [];
let POLL = () => 0;

function runtime() {
    const rt = new NativeStageRuntime(album, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(CTX_INIT, (c) => {
        const ctx = c.reg(4) >>> 0;
        CALLS.push(["begin"]);
        rt.mem.write32(ctx + 0x24, CTX24);
        rt.mem.write32(ctx + 0x2c, CTX2C);
        return 0;
    });
    rt.cpu.setStub(CTX24, (c) => { CALLS.push(["origin", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(CTX2C, (c) => { CALLS.push(["pack", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(PACK_STUB, (c) => { CALLS.push(["packsrc", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(REQ_STUB, (c) => { CALLS.push(["req", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(POLL_STUB, (c) => {
        const id = c.reg(4) | 0;
        CALLS.push(["poll", id]);
        return POLL(id);
    });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x80044f44, REQ_STUB);
    rt.mem.write32(0x80044f3c, POLL_STUB);
    return rt;
}

function portHost() {
    return {
        beginRequestContext() { CALLS.push(["begin"]); },
        requestContextOrigin(x, y) { CALLS.push(["origin", x | 0, y | 0]); },
        requestContextPack(p) { CALLS.push(["pack", p | 0]); },
        packResolve(h) { CALLS.push(["packsrc", h | 0]); return PACK_PTR; },
        requestBank(id) { CALLS.push(["req", id | 0]); },
        pollBank(id) { CALLS.push(["poll", id | 0]); return POLL(id | 0); },
    };
}

test("albumRequestTextBanks matches F0x800856A8", () => {
    const rt = runtime();
    rt.mem.write32(0x8005cca8, 2);

    CALLS.length = 0;
    rt.cpu.call(0x800856a8, [], 20000);
    const oracle = CALLS.slice();

    CALLS.length = 0;
    albumRequestTextBanks(rt.mem, portHost());
    assert.deepEqual(CALLS, oracle, "ordered request calls");
    // 1 begin + origin + pack src + pack + 8 banks.
    assert.equal(oracle.length, 12);
});

test("albumTextBanksPending matches F0x800857A0", () => {
    const rt = runtime();
    rt.mem.write32(0x8005cca8, 2);
    const save = 2;
    const patterns = [
        [],
        [0x7f6],
        [0x7f7],
        [0x7f8],
        [0x7f9],
        [0x7fa],
        [save + 0x16],
        [save + 0x1d],
        [save + 0x24],
        [0x7f6, 0x7f9],
    ];
    for (const pendingList of patterns) {
        const pending = new Set(pendingList);
        POLL = (id) => (pending.has(id) ? 1 : 0);

        CALLS.length = 0;
        const oracle = rt.cpu.call(0x800857a0, [], 20000) | 0;
        const oracleCalls = CALLS.slice();

        CALLS.length = 0;
        const got = albumTextBanksPending(rt.mem, portHost()) | 0;
        assert.equal(got, oracle, `pattern ${pendingList.join(",")} result`);
        assert.deepEqual(CALLS, oracleCalls, `pattern ${pendingList.join(",")} poll order`);
    }
});
