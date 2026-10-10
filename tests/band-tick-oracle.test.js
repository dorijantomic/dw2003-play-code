// Phase 4 oracle: engine/dw3/ui/band-tick.ts bandTick (F0x8008AF68) must emit
// the same ordered boundary/draw-intent stream and write the same band fields as
// the original. The original runs through engine/native with the draw ctx methods
// and every non-translated callee stubbed; the port runs through equivalent
// callbacks. F0x80089A44 is the translated bandLabelBuild on both sides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { bandTick } from "../engine/dw3/ui/band-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const OVERLAY_BASE = 0x80082cb0;

const BAND_A = 0x80180000;
const CTX_A = 0x80182000;
const METHOD_STUB = 0x0fd70000;
const BASE38_STUB = 0x0fd70010;
const ROSTER_STUB = 0x0fd70020;
const CLASS_STUB = 0x0fd70030;
const PACK_STUB = 0x0fd70070;
const F6_STUB = 0x0fd70080;
const ARITY = {
    base38: 1, roster: 1, create: 4, bf: 2, class: 2,
    call8a758: 2, call8a450: 2, call8adec: 2,
    setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, drawSprite: 4,
};
const CTX_METHOD_STUBS = {
    0x8001ecbc: "setOrigin",
    0x8001ed34: "setLayer",
    0x8001ed6c: "drawSprite",
    0x8001f5d0: "setScale",
    0x8001f608: "setPos",
};

function widgetAddr(k) {
    return (0x80183000 + k * 0x200) >>> 0;
}
function norm(events) {
    return events.map((e) => [e[0], e.slice(1, 1 + ARITY[e[0]]).map((v) => v >>> 0)]);
}

let EVENTS = [];
let creates = 0;

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, OVERLAY_BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    for (const [addr, name] of Object.entries(CTX_METHOD_STUBS)) {
        rt.cpu.setStub(Number(addr), (c) => {
            EVENTS.push([name, c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
            return 0;
        });
    }
    rt.cpu.setStub(BASE38_STUB, (c) => { EVENTS.push(["base38", c.reg(4)]); return 0; });
    rt.cpu.setStub(ROSTER_STUB, (c) => { EVENTS.push(["roster", c.reg(4)]); return ROSTER_VALUE(c.reg(4) | 0); });
    rt.mem.write32(0x8004b44c, ROSTER_STUB);
    rt.cpu.setStub(CLASS_STUB, (c) => {
        EVENTS.push(["class", c.reg(4), c.reg(5)]);
        return CLASS_VALUE(c.reg(4) | 0, c.reg(5) | 0);
    });
    rt.mem.write32(0x80042b98 + 8, CLASS_STUB);
    rt.cpu.setStub(0x8008a758, (c) => { EVENTS.push(["call8a758", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x8008a450, (c) => { EVENTS.push(["call8a450", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x8008adec, (c) => { EVENTS.push(["call8adec", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(PACK_STUB, (c) => (((c.reg(4) >>> 0) === 0x02860000) ? 0x80190000 : 0x80190010));
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(F6_STUB, (c) => (0x100 + (c.reg(4) & 0xff)));
    rt.mem.write32(0x80042b9c, F6_STUB);
    rt.cpu.setStub(0x8001ae38, (c) => {
        const w = widgetAddr(creates++);
        EVENTS.push(["create", c.reg(4), c.reg(5), c.reg(6), c.reg(7)]);
        return w;
    });
    rt.cpu.setStub(METHOD_STUB, (c) => { EVENTS.push(["bf", c.reg(4), c.reg(5)]); return 0; });
    return rt;
}

let ROSTER_VALUE = () => -1;
let CLASS_VALUE = () => 0;

const rt = runtime();

function seedBand(band, ctx, o) {
    for (let i = 0; i < 0x248; i += 4) rt.mem.write32(band + i, 0);
    for (let i = 0; i <= 0xac; i += 4) rt.mem.write32(ctx + i, 0xdead);
    rt.mem.write32(band + 0x38, BASE38_STUB);
    rt.mem.write32(band + 0x0c, o.state);
    rt.mem.write32(band + 0x50, o.layer ?? 0x1000);
    rt.mem.write32(band + 0x54, o.bucketSeed ?? 6);
    rt.mem.write32(band + 0x58, o.mode);
    rt.mem.write32(band + 0x60, o.memberCount ?? 0);
    rt.mem.write32(band + 0x1e4, o.itemId ?? 0x1005);
    rt.mem.write32(band + 0x1fc, o.foldMain ?? 0);
    rt.mem.write32(band + 0x21c, o.foldCards ?? 0);
    for (let k = 0; k < 48; k++) rt.mem.write32(widgetAddr(k) + 0x160, METHOD_STUB);
}

function runCase(label, o) {
    ROSTER_VALUE = (i) => (o.roster ?? [0, 6, -1])[i] ?? -1;
    CLASS_VALUE = (id, k) => (o.classes ?? {})[k] ?? 0;

    seedBand(BAND_A, CTX_A, o);
    EVENTS = [];
    creates = 0;
    rt.cpu.call(0x8008af68, [BAND_A, CTX_A]);
    const oracle = norm(EVENTS.slice());
    const oracleBand = [];
    for (let i = 0; i < 0x248; i += 4) oracleBand.push(rt.mem.read32(BAND_A + i) >>> 0);
    const oracleCtx = [];
    for (let i = 0; i <= 0xac; i += 4) oracleCtx.push(rt.mem.read32(CTX_A + i) >>> 0);

    seedBand(BAND_A, CTX_A, o);
    EVENTS = [];
    creates = 0;
    const portHost = {
        baseMethod38(band) { EVENTS.push(["base38", band]); },
        rosterSlot(position) { EVENTS.push(["roster", position]); return ROSTER_VALUE(position); },
        createTextElement(target, kind, x, y) {
            const w = widgetAddr(creates++);
            EVENTS.push(["create", target, kind, x, y]);
            return w;
        },
        setWidgetFlagBF(w, v) { EVENTS.push(["bf", w, v]); },
        itemUsableClass(id, k) { EVENTS.push(["class", id, k]); return CLASS_VALUE(id, k); },
        call8a758(band, ctx) { EVENTS.push(["call8a758", band, ctx]); },
        call8a450(band, ctx) { EVENTS.push(["call8a450", band, ctx]); },
        call8adec(band, ctx) { EVENTS.push(["call8adec", band, ctx]); },
        initDrawContext() {},
        setLayer(t, b) { EVENTS.push(["setLayer", t, b]); },
        setOrigin(x, y) { EVENTS.push(["setOrigin", x, y]); },
        setScale(x, y, z) { EVENTS.push(["setScale", x, y, z]); },
        setPos(x, y) { EVENTS.push(["setPos", x, y]); },
        drawSprite(p, cl, x, y) { EVENTS.push(["drawSprite", p, cl, x, y]); },
        packResolve(handle) { return (handle >>> 0) === 0x02860000 ? 0x80190000 : 0x80190010; },
        iconClip(id) { return 0x100 + (id & 0xff); },
    };
    bandTick(rt.mem, BAND_A, CTX_A, portHost);

    assert.deepEqual(norm(EVENTS.slice()), oracle, `${label}: event stream`);
    for (const off of [0x0c, 0x60, 0x1ec, 0x1f4, 0x204, 0x214, 0x224]) {
        assert.equal(rt.mem.read32(BAND_A + off) >>> 0, oracleBand[off >> 2], `${label}: band +0x${off.toString(16)}`);
    }
    for (let i = 0; i <= 0xac; i += 4) {
        assert.equal(rt.mem.read32(CTX_A + i) >>> 0, oracleCtx[i >> 2], `${label}: ctx +0x${i.toString(16)}`);
    }
}

test("bandTick matches F0x8008AF68", () => {
    // BUY draw, both folds open.
    runCase("buy draw open", { state: 1, mode: 0, foldMain: 0x1000, foldCards: 0x1000 });
    // SELL draw, main fold partial and cards fold closed.
    runCase("sell draw partial", { state: 1, mode: 1, foldMain: 0x800, foldCards: 0 });
    // SELL draw, cards fold partial.
    runCase("sell draw cards", { state: 1, mode: 1, foldMain: 0x1000, foldCards: 0x800 });
    // Setup, three positions with one absent, item usable by class 4.
    runCase("setup usable", { state: 0, mode: 0, roster: [0, 6, -1], classes: { 4: 1 } });
    // Setup but no usable class: hasEffects stays 0.
    runCase("setup unusable", { state: 0, mode: 0, roster: [0, 1, 2], classes: {} });
    // Setup in SELL mode: the item check is skipped entirely.
    runCase("setup sell", { state: 4, mode: 1, roster: [-1, -1, -1] });
    // States 2 and 3 do nothing.
    runCase("state 2 noop", { state: 2, mode: 0 });
    runCase("state 3 noop", { state: 3, mode: 1 });
});
