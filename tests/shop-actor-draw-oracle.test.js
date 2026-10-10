// Phase 4 oracle: engine/dw3/ui/shop-actor-draw.ts shopActorBuyDraw must emit
// the same ordered draw intents and update the same blink counters as the
// original F0x80083970. The original runs through engine/native's draw-intent
// recorder; the port through an equivalent recorder. packGetEntry and the frame
// tick are shared stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopActorBuyDraw, shopActorSellDraw } from "../engine/dw3/ui/shop-actor-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ_A = 0x80180000;
const OBJ_B = 0x80181000;
const PACK_STUB = 0x0fd30000;
const PACK_PTR = 0x80190000;
const FRAME = 5000;
const ARITY = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };
const COUNTERS = [0x6c, 0x70, 0x80, 0x84];

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, () => PACK_PTR);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x8004de20, FRAME);
    return rt;
}

function norm(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function fixture(obj, o) {
    for (let i = 0; i < 0xe0; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x58, o.layer ?? 0x1000);
    rt.mem.write32(obj + 0x5c, o.bucket ?? 4);
    rt.mem.write32(obj + 0x64, o.selected ?? 0);
    rt.mem.write32(obj + 0x68, o.max ?? 0);
    rt.mem.write32(obj + 0x6c, o.blinkOn ?? 0);
    rt.mem.write32(obj + 0x70, o.lastBlinkTick ?? 0);
    rt.mem.write32(obj + 0x78, o.cardIndex ?? 0);
    rt.mem.write32(obj + 0x7c, o.cardsVisible ?? 0);
    rt.mem.write32(obj + 0x80, o.paletteK ?? 0);
    rt.mem.write32(obj + 0x84, o.lastPaletteTick ?? 0);
    rt.mem.write32(obj + 0x90, o.foldMain ?? 0);
    rt.mem.write32(obj + 0xa0, o.foldA ?? 0);
    rt.mem.write32(obj + 0xb0, o.foldB ?? 0);
    rt.mem.write32(obj + 0xc0, o.foldC ?? 0);
}

const rt = runtime();

function runCase(label, o) {
    fixture(OBJ_A, o);
    fixture(OBJ_B, o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x80083970, [OBJ_A]);
    const oracle = norm(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;

    const portIntents = [];
    const hostPort = {
        initDrawContext() {},
        setLayer(t, b) { portIntents.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { portIntents.push(["setOrigin", [x, y, 0, 0]]); },
        setScale(x, y, z) { portIntents.push(["setScale", [x, y, z, 0]]); },
        setPos(x, y) { portIntents.push(["setPos", [x, y, 0, 0]]); },
        paletteShift(v) { portIntents.push(["m_0x88", [v, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { portIntents.push(["drawSprite", [p, c, x, y]]); },
        packResolve() { return PACK_PTR; },
        frameTick: () => FRAME,
    };
    shopActorBuyDraw(rt.mem, OBJ_B, hostPort);

    assert.deepEqual(norm(portIntents), oracle, `${label}: intents`);
    for (const off of COUNTERS) {
        assert.equal(rt.mem.read32(OBJ_B + off) | 0, rt.mem.read32(OBJ_A + off) | 0, `${label} +0x${off.toString(16)}`);
    }
}

test("shopActorBuyDraw matches F0x80083970", () => {
    runCase("main open only", { foldMain: 0x1000 });
    runCase("main partial", { foldMain: 0x800 });
    runCase("main blink closed", { foldMain: 0x1000, blinkOn: 0, lastBlinkTick: FRAME });
    runCase("main blink one mark", { foldMain: 0x1000, blinkOn: 1, lastBlinkTick: FRAME - 9, selected: 1, max: 5 });
    runCase("main blink both marks", { foldMain: 0x1000, blinkOn: 1, lastBlinkTick: FRAME - 9, selected: 2, max: 5 });
    runCase("foldA open", { foldA: 0x1000 });
    runCase("foldA partial", { foldA: 0x800 });
    runCase("foldB and C", { foldB: 0x1000, foldC: 0x800 });
    runCase("cards palette open", { cardsVisible: 1, cardIndex: 3, paletteK: 0, lastPaletteTick: FRAME - 9 });
    runCase("cards palette wrap", { cardsVisible: 1, cardIndex: 0, paletteK: 7, lastPaletteTick: 0 });
    runCase("cards palette closed", { cardsVisible: 1, paletteK: 2, lastPaletteTick: FRAME });
    runCase("everything", {
        foldMain: 0x1000, blinkOn: 1, lastBlinkTick: FRAME - 9, selected: 2, max: 5,
        foldA: 0x1000, foldB: 0x1000, foldC: 0x1000,
        cardsVisible: 1, cardIndex: 3, paletteK: 0, lastPaletteTick: FRAME - 9,
    });
});

test("shopActorSellDraw matches F0x80085B18", () => {
    const cases = [
        {}, { category: 0x800 }, { category: 0x1000, list: 0x800 },
        { fold5: 0x800, list: 0x1000, selected: 1, max: 5, blink: 1, last: FRAME - 9 },
        { list: 0x1000, selected: 2, max: 5, blink: 1, last: FRAME - 9 },
        { list: 0x1000, blink: 0, last: FRAME },
        { confirm: 0x800, message: 0x1000 },
        { fold5: 0x1000, category: 0x1000, list: 0x1000, confirm: 0x1000, message: 0x800 },
    ];
    for (const o of cases) {
        for (const obj of [OBJ_A, OBJ_B]) {
            for (let i = 0; i < 0xd0; i += 4) rt.mem.write32(obj + i, 0);
            rt.mem.write32(obj + 0x58, 0x1000);
            rt.mem.write32(obj + 0x5c, 4);
            rt.mem.write32(obj + 0x68, o.selected ?? 0);
            rt.mem.write32(obj + 0x6c, o.max ?? 0);
            rt.mem.write32(obj + 0x70, o.blink ?? 0);
            rt.mem.write32(obj + 0x74, o.last ?? 0);
            rt.mem.write32(obj + 0x84, o.category ?? 0);
            rt.mem.write32(obj + 0x94, o.list ?? 0);
            rt.mem.write32(obj + 0xa4, o.confirm ?? 0);
            rt.mem.write32(obj + 0xb4, o.fold5 ?? 0);
            rt.mem.write32(obj + 0xc4, o.message ?? 0);
        }
        rt.drawCalls.length = 0;
        rt.cpu.call(0x80085b18, [OBJ_A]);
        const oracle = norm(rt.drawCalls.map(c => [c.method, c.args]));
        const calls = [];
        const hostPort = {
            initDrawContext() {},
            setLayer: (...args) => calls.push(["setLayer", args]),
            setOrigin: (...args) => calls.push(["setOrigin", args]),
            setScale: (...args) => calls.push(["setScale", args]),
            setPos: (...args) => calls.push(["setPos", args]),
            drawSprite: (...args) => calls.push(["drawSprite", args]),
            packResolve: () => PACK_PTR,
            frameTick: () => FRAME,
        };
        shopActorSellDraw(rt.mem, OBJ_B, hostPort);
        assert.deepEqual(norm(calls), oracle, `SELL ${JSON.stringify(o)} intents`);
        for (const off of [0x70, 0x74]) {
            assert.equal(rt.mem.read32(OBJ_B + off) >>> 0, rt.mem.read32(OBJ_A + off) >>> 0,
                `SELL ${JSON.stringify(o)} +${off.toString(16)}`);
        }
    }
});
