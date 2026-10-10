// Phase 4 oracle: engine/dw3/ui/band-highlight.ts bandHighlight (F0x8008B29C)
// and bandHighlightForward (F0x80085934 / F0x8008739C) must match the original.
// The original runs through engine/native with the three band callees stubbed to
// record; the port gets the same boundaries as callbacks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { bandCreate, bandHighlight, bandHighlightForward } from "../engine/dw3/ui/band-highlight.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const BAND_A = 0x80180000;
const BAND_B = 0x80181000;
const CH_A = 0x80182000;
const CH_B = 0x80182100;
const ACTOR_A = 0x80183000;
const ACTOR_B = 0x80183100;
const CTX_A = 0x80184000;
const CTX_B = 0x80184100;
const BAND_METHOD = 0x8008b29c;

let EV = [];

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80089e2c, (c) => { EV.push(["call89e2c", c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x8008a0d0, (c) => { EV.push(["call8a0d0", c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x8008a1fc, (c) => { EV.push(["call8a1fc", c.reg(5) >>> 0, c.reg(6) | 0]); return 0; });
    return rt;
}

function zero(rt, base, size) {
    for (let i = 0; i < size; i += 4) rt.mem.write32(base + i, 0);
}

function resetBand(rt, band, ch, opts) {
    zero(rt, band, 0x220);
    rt.mem.write32(band + 0x24, ch);
    rt.mem.write32(band + 0x1e4, 0x5151);
    rt.mem.write32(band + 0x1e8, 0x6262);
    rt.mem.write32(band + 0x1f0, opts.enabled ?? 1);
    rt.mem.write32(band + 0x5c, opts.cards ?? 0);
}

function resetActor(rt, actor, ctx, band) {
    zero(rt, actor, 0x220);
    zero(rt, ctx, 0x40);
    rt.mem.write32(actor + 0x24, ctx);
    rt.mem.write32(ctx + 0x4, band);
    rt.mem.write32(band + 0x234, BAND_METHOD);
}

function portHost() {
    return {
        call89e2c(band, children, flag) { EV.push(["call89e2c", children, flag | 0]); },
        call8a0d0(band, children, flag) { EV.push(["call8a0d0", children, flag | 0]); },
        call8a1fc(band, children, flag) { EV.push(["call8a1fc", children, flag | 0]); },
    };
}

function norm(events, ch) {
    return events.map(([tag, children, flag]) => [tag, children === (ch >>> 0) ? 0 : children, flag]);
}

function compareBand(label, rt, bandA, bandB) {
    for (let off = 0; off < 0x220; off += 4) {
        if (off === 0x24) continue;
        assert.equal(
            rt.mem.read32(bandB + off) >>> 0,
            rt.mem.read32(bandA + off) >>> 0,
            `${label} band +0x${off.toString(16)}`,
        );
    }
}

const CASES = [
    { name: "enabled, cards closed", enabled: 1, cards: 0, itemId: 0x1234, quantity: 1 },
    { name: "enabled, cards open", enabled: 1, cards: 1, itemId: 0x2001, quantity: 3 },
    { name: "disabled", enabled: 0, cards: 0, itemId: 0x7777, quantity: 0 },
    { name: "disabled, cards open", enabled: 0, cards: 1, itemId: -2, quantity: -1 },
];

test("bandHighlight matches F0x8008B29C", () => {
    const rt = runtime();
    for (const c of CASES) {
        resetBand(rt, BAND_A, CH_A, c);
        EV = [];
        rt.cpu.call(0x8008b29c, [BAND_A, c.itemId, c.quantity]);
        const oracleEv = norm(EV.slice(), CH_A);

        resetBand(rt, BAND_B, CH_B, c);
        EV = [];
        bandHighlight(rt.mem, portHost(), BAND_B, c.itemId, c.quantity);
        const portEv = norm(EV.slice(), CH_B);

        assert.deepEqual(portEv, oracleEv, `${c.name}: event stream`);
        compareBand(c.name, rt, BAND_A, BAND_B);
        assert.equal(rt.mem.read32(BAND_A + 0x1e4) | 0, c.itemId | 0, `${c.name}: itemId`);
        assert.equal(rt.mem.read32(BAND_A + 0x1e8) | 0, c.quantity | 0, `${c.name}: quantity`);
    }
    // Sanity: the gated case really called the callee with a1 = band+0x24.
    resetBand(rt, BAND_A, CH_A, { enabled: 1, cards: 0 });
    EV = [];
    rt.cpu.call(0x8008b29c, [BAND_A, 5, 7]);
    assert.deepEqual(EV, [["call89e2c", CH_A, 1], ["call8a0d0", CH_A, 1]]);
});

test("bandHighlightForward matches F0x80085934 / F0x8008739C", () => {
    const rt = runtime();
    for (const [addr, label] of [[0x80085934, "BUY"], [0x8008739c, "SELL"]]) {
        for (const c of CASES) {
            resetBand(rt, BAND_A, CH_A, c);
            resetActor(rt, ACTOR_A, CTX_A, BAND_A);
            EV = [];
            rt.cpu.call(addr, [ACTOR_A, c.itemId, c.quantity]);
            const oracleEv = norm(EV.slice(), CH_A);

            resetBand(rt, BAND_B, CH_B, c);
            resetActor(rt, ACTOR_B, CTX_B, BAND_B);
            EV = [];
            bandHighlightForward(rt.mem, portHost(), ACTOR_B, c.itemId, c.quantity);
            const portEv = norm(EV.slice(), CH_B);

            assert.deepEqual(portEv, oracleEv, `${label} ${c.name}: event stream`);
            // Both forwarders share the port; compare against one original run.
            assert.equal(rt.mem.read32(BAND_B + 0x1e4) | 0, rt.mem.read32(BAND_A + 0x1e4) | 0,
                `${label} ${c.name}: itemId`);
        }
    }
    // Sanity: F0x80085934 and F0x8008739C have identical bodies.
    resetBand(rt, BAND_A, CH_A, { enabled: 1, cards: 1 });
    resetActor(rt, ACTOR_A, CTX_A, BAND_A);
    EV = [];
    rt.cpu.call(0x80085934, [ACTOR_A, 9, 2]);
    assert.deepEqual(EV, [["call89e2c", CH_A, 1], ["call8a0d0", CH_A, 0], ["call8a1fc", CH_A, 1]]);
});

test("bandCreate matches F0x8008B484", () => {
    const rt = runtime();
    const OBJ_A = 0x80186000;
    const OBJ_B = 0x80187000;
    let HEAP = 0x80190000;
    const portHost = {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = HEAP;
            HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
    for (const [mode, itemId] of [[0, 1], [1, 0x1234], [3, -1], [0x7fff, 0x2000]]) {
        const a = rt.cpu.call(0x8008b484, [mode, itemId]) >>> 0;
        HEAP = 0x80190000;
        const b = bandCreate(rt.mem, portHost, mode, itemId) >>> 0;
        const extraA = rt.mem.read32(a + 0x24) >>> 0;
        const extraB = rt.mem.read32(b + 0x24) >>> 0;
        assert.notEqual(extraA, 0, "original extra");
        assert.notEqual(extraB, 0, "port extra");
        for (let i = 0; i < 0xac; i++) assert.equal(rt.mem.read8(extraB + i), rt.mem.read8(extraA + i));
        for (let off = 0; off < 0x248; off += 4) {
            if (off === 0x24) continue;
            assert.equal(rt.mem.read32(b + off) >>> 0, rt.mem.read32(a + off) >>> 0, `+0x${off.toString(16)}`);
        }
    }
    const rt2 = runtime();
    const obj = rt2.cpu.call(0x8008b484, [2, 0x1005]) >>> 0;
    assert.equal(rt2.mem.read32(obj + 0x48) >>> 0, 0x8008af68, "band handler");
    assert.equal(rt2.mem.read32(obj + 0x234) >>> 0, 0x8008b29c, "highlight slot");
    assert.equal(rt2.mem.read32(obj + 0x58) >>> 0, 2, "mode");
    assert.equal(rt2.mem.read32(obj + 0x1e4) >>> 0, 0x1005, "item id");
    assert.equal(rt2.mem.read32(obj + 0x1f0) >>> 0, 1, "enable");
});
