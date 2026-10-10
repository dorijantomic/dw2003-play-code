// Phase 4 oracle: engine/dw3/ui/float-numbers.ts must match pro/cardgame's five
// float-number routines. Each original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the frame delta and pack resolver
// stubbed and the draw context recorded; the port uses an equivalent host over
// the same memory. Every pool byte and every ordered draw intent is compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    floatNumbersTickAll, floatNumberMove, floatNumberDraw,
    placeFloatNumber, startFloatNumberMove, floatEntry,
} from "../engine/dw3/ui/float-numbers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80180000;
const PACK_STUB = 0x0feb0000;
const PACK_PTR = 0x80190000;
const DELTA_STUB = 0x0fe20000;
const ARITY = { setOrigin: 2, setLayer: 2, setDepth: 2, m_0x88: 1, drawSprite: 4 };

let EVENTS = [];
let PORT_DRAW = [];
let DELTA = 1;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4) >>> 0]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(DELTA_STUB, () => { EVENTS.push(["delta", 0]); return DELTA; });
    rt.mem.write32(0x8004df9c, DELTA_STUB);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    PORT_DRAW = [];
    DELTA = o.delta ?? 1;
    for (let i = 0; i < 12 * 0x12 + 0x20; i += 4) rt.mem.write32(VIEW + 0xce8 + i, 0);
}

function pool() {
    const out = [];
    for (let i = 0; i < 12 * 0x12; i++) out.push(rt.mem.read8(VIEW + 0xce8 + i));
    return out;
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        frameDelta() { EVENTS.push(["delta", 0]); return DELTA; },
        setOrigin(x, y) { PORT_DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        setLayer(t, b) { PORT_DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setFrame(n) { PORT_DRAW.push(["m_0x88", [n, 0, 0, 0]]); },
        drawSprite(p, c, x, y) { PORT_DRAW.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { EVENTS.push(["packResolve", h >>> 0]); return PACK_PTR; },
    };
}

function oracleOp(op) {
    EVENTS = [];
    let draws = [];
    const before = rt.drawCalls.length;
    switch (op.op) {
        case "place": rt.cpu.call(0x8009bfcc, [VIEW, op.i, op.x, op.y]); break;
        case "start":
            rt.mem.write32(rt.cpu.sp + 0x10, op.dy & 0xffff);
            rt.cpu.call(0x8009c010, [VIEW, op.i, op.dur, op.dx]);
            break;
        case "tickAll": rt.cpu.call(0x80099ed4, [VIEW]); break;
        case "move": rt.cpu.call(0x80099d18, [floatEntry(VIEW, op.i)]); break;
        case "draw": rt.cpu.call(0x80099de8, [floatEntry(VIEW, op.i)]); break;
    }
    draws = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    return { events: EVENTS.map((e) => [e[0], e[1] >>> 0]), draws };
}

function portOp(op) {
    EVENTS = [];
    PORT_DRAW = [];
    const h = portHost();
    let ret = 0;
    switch (op.op) {
        case "place": ret = placeFloatNumber(rt.mem, VIEW, op.i, op.x, op.y); break;
        case "start": ret = startFloatNumberMove(rt.mem, VIEW, op.i, op.dur, op.dx, op.dy); break;
        case "tickAll": ret = floatNumbersTickAll(rt.mem, VIEW, h); break;
        case "move": ret = floatNumberMove(rt.mem, floatEntry(VIEW, op.i), h); break;
        case "draw": ret = floatNumberDraw(rt.mem, floatEntry(VIEW, op.i), h); break;
    }
    return {
        events: EVENTS.map((e) => [e[0], e[1] >>> 0]),
        draws: normDraw(PORT_DRAW),
        ret: ret | 0,
    };
}

function runScript(label, seedOpts, script) {
    seed(seedOpts);
    const oracleSnaps = [];
    for (const op of script) {
        const o = oracleOp(op);
        oracleSnaps.push({ ...o, pool: pool() });
    }
    seed(seedOpts);
    for (let k = 0; k < script.length; k++) {
        const p = portOp(script[k]);
        assert.deepEqual(p.events, oracleSnaps[k].events, `${label} op ${k} (${script[k].op}): calls`);
        assert.deepEqual(p.draws, oracleSnaps[k].draws, `${label} op ${k} (${script[k].op}): draw`);
        assert.deepEqual(pool(), oracleSnaps[k].pool, `${label} op ${k} (${script[k].op}): pool`);
        assert.equal(p.ret, 0, `${label} op ${k} (${script[k].op}): return`);
    }
}

test("float-number family matches pro/cardgame", () => {
    // Park, then draw the cycle far enough to hit the f>=3 phase reset.
    const draws = [];
    for (let i = 0; i < 16; i++) draws.push({ op: "draw", i: 1 });
    runScript("park+cycle", {}, [
        { op: "place", i: 1, x: 100, y: 50 },
        { op: "tickAll" },
        ...draws,
    ]);

    // A slide: tween four ticks then land, with the pump running.
    runScript("slide", {}, [
        { op: "place", i: 3, x: 100, y: 50 },
        { op: "start", i: 3, dur: 4, dx: 200, dy: 150 },
        { op: "tickAll" }, { op: "tickAll" }, { op: "tickAll" },
        { op: "tickAll" }, { op: "tickAll" }, { op: "tickAll" },
    ]);

    // duration 0 with delta 0: the move must park without dividing.
    runScript("zero duration", { delta: 0 }, [
        { op: "place", i: 5, x: 10, y: 20 },
        { op: "start", i: 5, dur: 0, dx: 10, dy: 20 },
        { op: "tickAll" },
    ]);

    // Negative coordinates store and read back as low 16 bits.
    runScript("negative coords", {}, [
        { op: "place", i: 0, x: -5, y: -300 },
        { op: "draw", i: 0 },
        { op: "start", i: 0, dur: 3, dx: -9, dy: 1000 },
        { op: "tickAll" },
    ]);

    // A big phase resets to 0 and frame 0 (drawn through the real pump).
    const resetDraws = [];
    for (let i = 0; i < 14; i++) resetDraws.push({ op: "draw", i: 7 });
    runScript("phase reset", {}, [
        { op: "place", i: 7, x: 5, y: 6 },
        ...resetDraws,
    ]);

    // Larger delta than the timer lands the number on the same tick.
    runScript("big delta landing", { delta: 9 }, [
        { op: "place", i: 2, x: 1, y: 2 },
        { op: "start", i: 2, dur: 3, dx: 30, dy: 40 },
        { op: "tickAll" },
    ]);

    // An empty pool does nothing at all.
    runScript("empty pool", {}, [{ op: "tickAll" }]);
});
