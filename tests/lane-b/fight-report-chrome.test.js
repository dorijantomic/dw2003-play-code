// Lane B Phase 4 oracle: engine/dw3/ui/native/fight-report-chrome.ts must match
// the original pro/stfgtrep F0x80084C20 report-screen chrome painter.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// shared stack draw context F0x8001F648 is run natively and its method calls are
// recorded into rt.drawCalls; the pack resolver ([0x80044F5C]) is stubbed so the
// requested handles are compared. The timebase counter ([0x8004DE20], reached
// through [0x8004DE10+0x188]) is set per case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    REPORT_BANNER_PACK,
    REPORT_CHROME_PACK,
    reportChromeDraw,
} from "../../engine/dw3/ui/native/fight-report-chrome.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const report = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: report.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80150000;
const OBJ_B = 0x80150200;
const PACK_PTR = 0x801b9000;
const PACK_STUB = 0x0fd70000;
const TIMEBASE_VALUE = 0x8004de20;

const ARITY = { setOrigin: 2, setLayer: 2, drawSprite: 4, m_0x88: 1, setScale: 3, setPos: 2 };
const PACK_CALLS = [];
const INTENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(report, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => {
        PACK_CALLS.push(c.reg(4) >>> 0);
        return PACK_PTR;
    });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    return rt;
}

function norm(list) {
    return list.map(([m, a]) => [m, (a ?? []).slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function setFields(rt, obj, c, tb) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x50, c.f50 ?? 0x1000);
    rt.mem.write32(obj + 0x54, c.f54 ?? 7);
    rt.mem.write32(obj + 0x58, c.f58 ?? 0);
    rt.mem.write32(obj + 0x5c, c.f5c ?? 0);
    rt.mem.write32(obj + 0x74, c.f74 ?? 0);
    rt.mem.write32(obj + 0x78, c.f78 ?? 0);
    rt.mem.write32(obj + 0x7c, c.f7c ?? 0);
    rt.mem.write32(obj + 0x88, c.f88 ?? 0);
    rt.mem.write32(obj + 0x98, c.f98 ?? 0);
    rt.mem.write32(TIMEBASE_VALUE, tb);
}

function portHost(rt) {
    return {
        timebase() { return rt.mem.read32(TIMEBASE_VALUE) | 0; },
        initDrawContext() {},
        setOrigin(x, y) { INTENTS.push(["setOrigin", [x, y]]); },
        setLayer(x, y) { INTENTS.push(["setLayer", [x, y]]); },
        m_0x88(v) { INTENTS.push(["m_0x88", [v]]); },
        drawSprite(a, b, x, y) { INTENTS.push(["drawSprite", [a, b, x, y]]); },
        setScale(sx, sy, sz) { INTENTS.push(["setScale", [sx, sy, sz]]); },
        setPos(x, y) { INTENTS.push(["setPos", [x, y]]); },
        packResolve(h) { PACK_CALLS.push(h >>> 0); return PACK_PTR; },
    };
}

test("reportChromeDraw matches F0x80084C20", () => {
    const rt = runtime();
    const cases = [
        { name: "no banner, first call", f5c: 0, f58: 0, tb: 0 },
        { name: "second call scrolls", f5c: 1, f58: 5, tb: 0 },
        { name: "scroll 0x5E -> 0x5F", f5c: 1, f58: 0x5e, tb: 0 },
        { name: "scroll wraps at 0x60", f5c: 1, f58: 0x5f, tb: 0 },
        { name: "banner first tick", f74: 1, f7c: 0, f78: 0, tb: 5 },
        { name: "banner delta 4 holds", f74: 1, f7c: 2, f78: 0, tb: 4 },
        { name: "banner frame wraps", f74: 1, f7c: 4, f78: 0, tb: 10 },
        { name: "left already 0x1000", f88: 0x1000 },
        { name: "left custom scale", f88: 0x2000 },
        { name: "right custom scale", f98: 0x0800 },
        { name: "right already 0x1000", f98: 0x1000 },
        { name: "both custom", f88: 0x2000, f98: 0x0800 },
    ];
    for (const c of cases) {
        setFields(rt, OBJ_A, c, c.tb);
        setFields(rt, OBJ_B, c, c.tb);

        PACK_CALLS.length = 0;
        const before = rt.drawCalls.length;
        rt.cpu.call(0x80084c20, [OBJ_A], 40000);
        const oracleDraw = norm(rt.drawCalls.slice(before).map((x) => [x.method, x.args]));
        const oraclePacks = PACK_CALLS.slice();
        rt.drawCalls.length = before;

        INTENTS.length = 0;
        PACK_CALLS.length = 0;
        reportChromeDraw(rt.mem, OBJ_B, portHost(rt));

        assert.deepEqual(norm(INTENTS), oracleDraw, `${c.name}: draw intents`);
        assert.deepEqual(PACK_CALLS, oraclePacks, `${c.name}: pack handles`);
        for (const off of [0x58, 0x5c, 0x78, 0x7c]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                `${c.name}: +0x${off.toString(16)}`);
        }
    }
});

test("reportChromeDraw requests the banner pack only when the banner is visible", () => {
    const rt = runtime();
    // Banner visible: the 0x02860000 banner pack is requested first, then the
    // 0x079F0000 chrome pack for the scroll strip and the two side blocks.
    setFields(rt, OBJ_A, { f74: 1, f7c: 0, f78: 0, f88: 0x1000, f98: 0x1000 }, 5);
    setFields(rt, OBJ_B, { f74: 1, f7c: 0, f78: 0, f88: 0x1000, f98: 0x1000 }, 5);
    PACK_CALLS.length = 0;
    rt.cpu.call(0x80084c20, [OBJ_A], 40000);
    const oracle = PACK_CALLS.slice();
    assert.equal(oracle[0], REPORT_BANNER_PACK, "oracle requests the banner pack first");
    assert.equal(oracle.filter((h) => h === REPORT_BANNER_PACK).length, 1, "banner pack once");
    assert.equal(oracle.filter((h) => h === REPORT_CHROME_PACK).length, 3, "chrome pack three times");

    INTENTS.length = 0;
    PACK_CALLS.length = 0;
    reportChromeDraw(rt.mem, OBJ_B, portHost(rt));
    assert.deepEqual(PACK_CALLS, oracle, "port matches the oracle pack order");
});

test("reportChromeDraw without a banner only reads the chrome pack", () => {
    const rt = runtime();
    setFields(rt, OBJ_A, { f74: 0, f88: 0x1000, f98: 0x1000 }, 0);
    setFields(rt, OBJ_B, { f74: 0, f88: 0x1000, f98: 0x1000 }, 0);
    PACK_CALLS.length = 0;
    rt.cpu.call(0x80084c20, [OBJ_A], 40000);
    const oracle = PACK_CALLS.slice();
    assert.deepEqual(oracle, [REPORT_CHROME_PACK, REPORT_CHROME_PACK, REPORT_CHROME_PACK]);

    INTENTS.length = 0;
    PACK_CALLS.length = 0;
    reportChromeDraw(rt.mem, OBJ_B, portHost(rt));
    assert.deepEqual(PACK_CALLS, [REPORT_CHROME_PACK, REPORT_CHROME_PACK, REPORT_CHROME_PACK]);
});
